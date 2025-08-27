// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

// Parse the Link header to get next page_info (Shopify REST pagination)
function getNextPageInfo(linkHeader?: string | null): string | null {
  if (!linkHeader) return null;
  // Example: <https://shop.myshopify.com/admin/api/2024-07/products.json?page_info=xxx&limit=250>; rel="next"
  const parts = linkHeader.split(",");
  for (const p of parts) {
    const seg = p.trim();
    if (seg.endsWith('rel="next"')) {
      const m = seg.match(/<([^>]+)>/);
      if (!m) continue;
      try {
        const url = new URL(m[1]);
        const pi = url.searchParams.get("page_info");
        if (pi) return pi;
      } catch {}
    }
  }
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET: list stocked brands (for UI vendor filter) */
export async function GET() {
  const brands = await prisma.stockedBrand.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return NextResponse.json({ vendors: brands.map((b) => b.name) });
}

/** POST: sync StockedBrand from Shopify products' vendor field */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const rpm = Math.max(30, Math.min(Number(searchParams.get("rpm") || 120), 240)); // 30–240
  const delayMs = Math.ceil(60000 / rpm);

  const vendors = new Set<string>();
  let pageInfo: string | null = null;
  let pages = 0;
  let productsSeen = 0;

  while (true) {
    pages++;
    const qp = new URLSearchParams();
    qp.set("limit", "250");
    qp.set("fields", "id,vendor");
    qp.set("status", "any"); // include active, draft, archived
    if (pageInfo) qp.set("page_info", pageInfo);

    const res = await shopifyRest(`/products.json?${qp.toString()}`, { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Shopify products fetch failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const json = await res.json();
    const arr: any[] = json?.products ?? [];
    productsSeen += arr.length;

    for (const p of arr) {
      const v = (p?.vendor || "").toString().trim();
      if (v) vendors.add(v);
    }

    const link = res.headers.get("Link");
    pageInfo = getNextPageInfo(link);
    if (!pageInfo) break;

    await sleep(delayMs); // rate limit
  }

  const names = Array.from(vendors).sort((a, b) => a.localeCompare(b));
  if (names.length) {
    await prisma.stockedBrand.createMany({
      data: names.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    ok: true,
    pages,
    productsSeen,
    vendorsFound: names.length,
  });
}
