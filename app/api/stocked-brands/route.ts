// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

/* ---------- helpers ---------- */

// Parse the Link header to get next page_info (Shopify REST pagination)
function getNextPageInfo(linkHeader?: string | null): string | null {
  if (!linkHeader) return null;
  // Example:
  // <https://shop.myshopify.com/admin/api/2024-07/products.json?page_info=xxx&limit=250>; rel="next"
  const m = linkHeader.match(/<[^>]*\bpage_info=([^&>]+)[^>]*>\s*;\s*rel="next"/i);
  return m ? decodeURIComponent(m[1]) : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- GET: list stocked brands (for UI vendor filter) ---------- */
export async function GET() {
  const brands = await prisma.stockedBrand.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return NextResponse.json({ vendors: brands.map((b) => b.name) });
}

/* ---------- POST: sync StockedBrand from Shopify products' vendor field ---------- */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);

  // rate control
  const rpm = Math.max(30, Math.min(Number(searchParams.get("rpm") || 120), 240)); // 30–240
  const delayMs = Math.ceil(60000 / rpm);

  // optional: clear and re-seed
  const reset = (searchParams.get("reset") || "") === "1";
  if (reset) {
    await prisma.stockedBrand.deleteMany({});
  }

  // case-insensitive dedupe while preserving first-seen display case
  const seenLowerToDisplay = new Map<string, string>();

  let pageInfo: string | null = null;
  let pages = 0;
  let productsSeen = 0;

  while (true) {
    pages++;
    const qp = new URLSearchParams();
    qp.set("limit", "250");
    qp.set("fields", "id,vendor");           // lean response
    qp.set("published_status", "any");       // include published & unpublished
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
      const raw = (p?.vendor ?? "").toString().trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!seenLowerToDisplay.has(key)) {
        seenLowerToDisplay.set(key, raw); // preserve original case for display
      }
    }

    const link = res.headers.get("Link");
    pageInfo = getNextPageInfo(link);
    if (!pageInfo || arr.length === 0) break;

    await sleep(delayMs); // rate limit
  }

  const names = Array.from(seenLowerToDisplay.values()).sort((a, b) => a.localeCompare(b));

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
    resetApplied: reset,
  });
}
