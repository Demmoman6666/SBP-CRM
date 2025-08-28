// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";
import { cookies } from "next/headers";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/* ----------------------- auth helpers ----------------------- */
const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64url, sigB64url] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64url)
    .digest("base64url");

  if (expected !== sigB64url) return null;

  try {
    const json = JSON.parse(Buffer.from(payloadB64url, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function requireUser() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { id: true, isActive: true, role: true },
  });
  if (!user || !user.isActive) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

async function requireAdmin() {
  const g = await requireUser();
  if ("error" in g) return g;
  if (g.user.role !== "ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return g;
}

/* ----------------------- body helper ----------------------- */
async function readBody(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) return await req.json();
    if (ct.includes("form")) {
      const fd = await req.formData();
      const obj: Record<string, any> = {};
      fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : String(v)));
      return obj;
    }
  } catch {}
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/* ----------------------- Shopify helpers ----------------------- */
function getNextPageInfo(linkHeader?: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<[^>]*\bpage_info=([^&>]+)[^>]*>\s*;\s*rel="next"/i);
  return m ? decodeURIComponent(m[1]) : null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ================================================================
   GET  /api/stocked-brands
   Returns: Array<{ id, name, visibleInCallLog }>
================================================================ */
export async function GET() {
  const g = await requireUser();
  if ("error" in g) return g.error;

  const list = await prisma.stockedBrand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json(list);
}

/* ================================================================
   POST /api/stocked-brands
   Two modes:
   1) Create one brand  -> body { name }
   2) Sync from Shopify -> no 'name' in body, use query ?mode=orders|products|all (default all)
      Optional: &reset=1, &rpm=120
================================================================ */
export async function POST(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const body = await readBody(req);
  const hasName = typeof body?.name === "string" && body.name.trim().length > 0;

  if (hasName) {
    // ---- Create single brand ----
    const name = body.name.trim();
    try {
      const created = await prisma.stockedBrand.create({
        data: { name }, // visibleInCallLog defaults to false; toggle via PATCH
        select: { id: true, name: true, visibleInCallLog: true },
      });
      return NextResponse.json(created, { status: 201 });
    } catch (e: any) {
      if (e?.code === "P2002" || (typeof e?.message === "string" && e.message.toLowerCase().includes("unique"))) {
        return NextResponse.json({ error: "Brand already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: e?.message || "Create failed" }, { status: 400 });
    }
  }

  // ---- Sync from Shopify (your existing logic) ----
  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") || "all").toLowerCase(); // orders|products|all
  const rpm = Math.max(30, Math.min(Number(searchParams.get("rpm") || 120), 240));
  const reset = (searchParams.get("reset") || "") === "1";
  const delayMs = Math.ceil(60000 / rpm);

  if (reset) await prisma.stockedBrand.deleteMany({});

  // Collect vendors (case-insensitive, preserve display casing)
  const seen = new Map<string, string>();

  // A) From order line items
  if (mode === "orders" || mode === "all") {
    const rows = await prisma.orderLineItem.findMany({
      where: { productVendor: { not: null } },
      select: { productVendor: true },
    });
    for (const r of rows) {
      const v = (r.productVendor || "").trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    }
  }

  // B) From Shopify products (active + archived + draft)
  let pages = 0;
  let productsSeen = 0;
  const statusesChecked: string[] = [];

  if (mode === "products" || mode === "all") {
    const statuses = ["active", "archived", "draft"] as const;

    for (const status of statuses) {
      statusesChecked.push(status);
      let pageInfo: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        pages++;

        let path: string;
        if (!pageInfo) {
          const qp = new URLSearchParams();
          qp.set("limit", "250");
          qp.set("fields", "id,vendor");
          qp.set("status", status);
          qp.set("published_status", "any");
          path = `/products.json?${qp.toString()}`;
        } else {
          const qp = new URLSearchParams();
          qp.set("limit", "250");
          qp.set("fields", "id,vendor");
          qp.set("page_info", pageInfo);
          path = `/products.json?${qp.toString()}`;
        }

        const res = await shopifyRest(path, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return NextResponse.json(
            { error: `Shopify products fetch failed (${status}): ${res.status} ${text}` },
            { status: 502 }
          );
        }

        const json = await res.json();
        const arr: any[] = json?.products ?? [];
        productsSeen += arr.length;

        for (const p of arr) {
          const raw = (p?.vendor ?? "").toString().trim();
          if (!raw) continue;
          const key = raw.toLowerCase();
          if (!seen.has(key)) seen.set(key, raw);
        }

        const link = res.headers.get("Link");
        pageInfo = getNextPageInfo(link);
        if (!pageInfo || arr.length === 0) break;

        await sleep(delayMs);
      }
    }
  }

  // Upsert vendors into StockedBrand
  const names = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  if (names.length) {
    await prisma.stockedBrand.createMany({
      data: names.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    ok: true,
    vendorsSaved: names.length,
    productsSeen,
    pages,
    statusesChecked,
    resetApplied: reset,
    mode,
  });
}

/* ================================================================
   PATCH /api/stocked-brands
   Body: { id: string, visible: boolean }  -> toggles visibleInCallLog
================================================================ */
export async function PATCH(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const body = await readBody(req);
  const id = String(body?.id || "");
  const visible = body?.visible;

  if (!id || typeof visible !== "boolean") {
    return NextResponse.json({ error: "id and visible are required" }, { status: 400 });
  }

  try {
    const updated = await prisma.stockedBrand.update({
      where: { id },
      data: { visibleInCallLog: visible },
      select: { id: true, name: true, visibleInCallLog: true },
    });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 400 });
  }
}

/* ================================================================
   DELETE /api/stocked-brands?id=...
================================================================ */
export async function DELETE(req: Request) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    await prisma.stockedBrand.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 400 });
  }
}
