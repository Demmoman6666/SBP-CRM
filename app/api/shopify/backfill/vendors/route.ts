import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

async function fetchProductVendor(productId: string): Promise<string | null> {
  try {
    const res = await shopifyRest(`/products/${productId}.json`, { method: "GET" });
    if (!res.ok) return null;
    const json = await res.json();
    const v = (json?.product?.vendor || "").toString().trim() || null;
    return v;
  } catch { return null; }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const perMinute = Math.max(1, Math.min(Number(searchParams.get("rpm") ?? 120), 240)); // gentle throttle
  const delayMs = Math.round(60000 / perMinute);

  // distinct productIds where vendor missing
  const groups = await prisma.orderLineItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      OR: [{ productVendor: null }, { productVendor: "" }],
    },
    _count: { _all: true },
  });

  let lookedUp = 0, updated = 0, skipped = 0;

  for (const g of groups) {
    const pid = g.productId as string | null;
    if (!pid) { skipped++; continue; }

    const vendor = await fetchProductVendor(pid);
    lookedUp++;

    if (vendor) {
      const res = await prisma.orderLineItem.updateMany({
        where: { productId: pid },
        data: { productVendor: vendor },
      });
      updated += res.count;
    }

    await sleep(delayMs); // rate limit
  }

  return NextResponse.json({ productIds: groups.length, lookedUp, updated, skipped });
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST this endpoint to backfill vendors." });
}
