// app/api/debug/backfill-orders/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };

// --- minimal cookie token verify (mirrors your middleware secret) ---
function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(p).digest("base64url");
  if (expected !== sig) return null;

  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch { return null; }
}

// --- small helpers ---
function parseWindowToISO(sp: URLSearchParams): string {
  // Accept ?since=ISO or ?window=24h|7d|30d (default 7d)
  const since = sp.get("since");
  if (since) {
    const d = new Date(since);
    if (!isNaN(d as any)) return d.toISOString();
  }
  const w = (sp.get("window") || "7d").toLowerCase();
  const now = new Date();
  const d = new Date(now);
  if (w.endsWith("h")) d.setHours(now.getHours() - Number(w.replace("h","")) || 24);
  else if (w.endsWith("d")) d.setDate(now.getDate() - Number(w.replace("d","")) || 7);
  else d.setDate(now.getDate() - 7);
  return d.toISOString();
}

function nextLinkFromHeaders(h: Headers): string | null {
  // Shopify REST cursor pagination: Link header with rel="next"
  // Example: <https://shop.myshopify.com/.../orders.json?limit=250&page_info=abc>; rel="next"
  const link = h.get("link");
  if (!link) return null;
  const parts = link.split(",").map(s => s.trim());
  for (const p of parts) {
    if (p.endsWith('rel="next"')) {
      const m = p.match(/<([^>]+)>/);
      return m?.[1] ?? null;
    }
  }
  return null;
}

export async function GET(req: Request) {
  // -------- 0) Auth: must be signed in (or pass ?token=BACKFILL_TOKEN) --------
  const cookies = (await import("next/headers")).cookies();
  const tokenCookie = cookies.get(COOKIE_NAME)?.value;
  const sess = verifyToken(tokenCookie);
  const qp = new URL(req.url).searchParams;
  const tokenParam = qp.get("token");
  const allowViaToken = tokenParam && process.env.BACKFILL_TOKEN && tokenParam === process.env.BACKFILL_TOKEN;

  if (!sess && !allowViaToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // -------- 1) Config / query params --------
  const SHOP = process.env.SHOPIFY_STORE;         // e.g. "your-store"
  const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!SHOP || !ADMIN_TOKEN) {
    return NextResponse.json({ error: "Missing SHOPIFY_STORE or SHOPIFY_ADMIN_TOKEN envs" }, { status: 500 });
  }

  const sinceISO = parseWindowToISO(qp);          // default last 7d
  const dryRun = qp.get("dryRun") === "1";        // ?dryRun=1 to test without DB changes
  const statusAny = qp.get("status") || "any";    // passthrough, default "any"
  // You can switch created_at_min to updated_at_min if you prefer to re-sync edits:
  const baseUrl = `https://${SHOP}.myshopify.com/admin/api/2024-07/orders.json?limit=250&status=${encodeURIComponent(statusAny)}&created_at_min=${encodeURIComponent(sinceISO)}`;

  let url = baseUrl;
  let pages = 0;

  // counters
  let scanned = 0;
  let inserted = 0;
  let updated = 0;
  let attached = 0;

  // -------- 2) Page through Shopify orders --------
  while (url) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const bodyTxt = await res.text().catch(() => "");
      return NextResponse.json({ error: "Shopify fetch failed", status: res.status, body: bodyTxt }, { status: 502 });
    }

    const json = await res.json();
    const orders: any[] = json.orders || [];
    pages += 1;

    for (const order of orders) {
      scanned += 1;

      const createdAt = order.created_at ? new Date(order.created_at) : new Date();
      const processedAt = order.processed_at ? new Date(order.processed_at) : createdAt;
      const currency = order.currency || "GBP";
      const subtotal = Number(order.subtotal_price ?? 0);
      const taxes = Number(order.total_tax ?? 0);
      const total = Number(order.total_price ?? 0);
      const financialStatus = order.financial_status ?? null;
      const fulfillmentStatus = order.fulfillment_status ?? null;
      const shopifyName: string | null = order.name ?? null; // "#1234"
      const shopifyOrderNumber: string | null = order.order_number ? String(order.order_number) : null;

      // try to find a matching customer
      let customerId: string | null = null;
      const email: string | null = order?.email || order?.customer?.email || null;
      if (email) {
        const found = await prisma.customer.findFirst({
          where: { customerEmailAddress: email.toLowerCase() },
          select: { id: true },
        });
        customerId = found?.id ?? null;
      }

      if (dryRun) {
        // skip DB writes, but count what would happen
        const existing = await prisma.order.findFirst({
          where: {
            OR: [
              shopifyName ? { shopifyName } : undefined,
              shopifyOrderNumber ? { shopifyOrderNumber } : undefined,
            ].filter(Boolean) as any,
          },
          select: { id: true, customerId: true },
        });

        if (existing) {
          updated += 1; // would update
          if (!existing.customerId && customerId) attached += 1;
        } else {
          inserted += 1; // would insert
          if (customerId) attached += 1; // attach on insert
        }
        continue;
      }

      // Upsert-ish (find then create/update) because we don't necessarily have a unique constraint
      const existing = await prisma.order.findFirst({
        where: {
          OR: [
            shopifyName ? { shopifyName } : undefined,
            shopifyOrderNumber ? { shopifyOrderNumber } : undefined,
          ].filter(Boolean) as any,
        },
        select: { id: true, customerId: true },
      });

      if (!existing) {
        await prisma.order.create({
          data: {
            createdAt,
            processedAt,
            currency,
            subtotal,
            taxes,
            total,
            financialStatus,
            fulfillmentStatus,
            shopifyName,
            shopifyOrderNumber,
            customerId, // may be null
          },
        });
        inserted += 1;
        if (customerId) attached += 1;
      } else {
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            // keep the latest derived values
            processedAt,
            currency,
            subtotal,
            taxes,
            total,
            financialStatus,
            fulfillmentStatus,
            // only attach if we didn't have a link before
            ...(existing.customerId ? {} : { customerId: customerId ?? null }),
          },
        });
        updated += 1;
        if (!existing.customerId && customerId) attached += 1;
      }
    }

    // next page?
    const nextUrl = nextLinkFromHeaders(res.headers);
    url = nextUrl || "";
  }

  return NextResponse.json({
    ok: true,
    since: sinceISO,
    pages,
    scanned,
    inserted,
    updated,
    attached,
    dryRun,
  });
}
