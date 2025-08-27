// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */
function getNextPageInfo(linkHeader?: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<[^>]*\bpage_info=([^&>]+)[^>]*>\s*;\s*rel="next"/i);
  return m ? decodeURIComponent(m[1]) : null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------
   GET  /api/stocked-brands
   Returns the union of:
     - StockedBrand table (manually/previously synced)
     - DISTINCT productVendor values already in OrderLineItem
   This guarantees the Vendor filter shows EVERYTHING you sell.
---------------------------------------------------------- */
export async function GET() {
  const [brands, orderVendors] = await Promise.all([
    prisma.stockedBrand.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    prisma.orderLineItem.findMany({
      where: { productVendor: { not: null } },
      distinct: ["productVendor"],
      select: { productVendor: true },
    }),
  ]);

  const names = new Set<string>();
  for (const b of brands) if (b.name?.trim()) names.add(b.name.trim());
  for (const v of orderVendors) {
    const s = (v.productVendor || "").trim();
    if (s) names.add(s);
  }

  return NextResponse.json({ vendors: Array.from(names).sort((a, b) => a.localeCompare(b)) });
}

/* ---------------------------------------------------------
   POST /api/stocked-brands
   Sync vendors from Shopify Products and (optionally) reset table.

   Query params:
     - mode=products|orders|all   (default: all)
     - rpm=120                    (rate limit; 30–240)
     - reset=1                    (wipe StockedBrand before seeding)
---------------------------------------------------------- */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get("mode") || "all").toLowerCase();
  const rpm = Math.max(30, Math.min(Number(searchParams.get("rpm") || 120), 240));
  const reset = (searchParams.get("reset") || "") === "1";
  const delayMs = Math.ceil(60000 / rpm);

  if (reset) {
    await prisma.stockedBrand.deleteMany({});
  }

  // Case-insensitive map (preserve first-seen display casing)
  const seen = new Map<string, string>();

  // A) Always include vendors already present in orders (so UI never misses them)
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

  // B) Pull vendors from *all* Shopify products (active/archived/draft)
  let pages = 0;
  let productsSeen = 0;
  let statusesChecked: string[] = [];
  if (mode === "products" || mode === "all") {
    const statuses = ["active", "archived", "draft"] as const;
    statusesChecked = [...statuses];

    for (const status of statuses) {
      let pageInfo: string | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        pages++;
        const qp = new URLSearchParams();
        qp.set("limit", "250");
        qp.set("fields", "id,vendor");
        qp.set("status", status);
        qp.set("published_status", "any");
        if (pageInfo) qp.set("page_info", pageInfo);

        const res = await shopifyRest(`/products.json?${qp.toString()}`, { method: "GET" });
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

  // Upsert into StockedBrand
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
