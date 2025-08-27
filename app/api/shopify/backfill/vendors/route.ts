import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Cache to avoid re-fetching the same product many times
const vendorCache = new Map<string, string | null>();

async function fetchProductVendor(productId: string): Promise<string | null> {
  if (!productId) return null;
  if (vendorCache.has(productId)) return vendorCache.get(productId)!;
  try {
    const res = await shopifyRest(`/products/${productId}.json`, { method: "GET" });
    if (!res.ok) { vendorCache.set(productId, null); return null; }
    const json = await res.json();
    const v = (json?.product?.vendor || "").toString().trim() || null;
    vendorCache.set(productId, v);
    return v;
  } catch {
    vendorCache.set(productId, null);
    return null;
  }
}

/**
 * POST /api/shopify/backfill/vendors?rpm=120
 * - Finds line items with missing vendor (NULL or empty string)
 * - Groups by productId and looks up product.vendor from Shopify
 * - Updates all line items of that productId
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const rpm = Math.max(30, Math.min(Number(searchParams.get("rpm") || 120), 240));
  const delayMs = Math.ceil(60000 / rpm);

  // Count how many are missing (null OR empty)
  const missingCount = await prisma.orderLineItem.count({
    where: {
      productId: { not: null },
      OR: [{ productVendor: null }, { productVendor: "" }],
    },
  });

  // If nothing is missing, exit early
  if (missingCount === 0) {
    return NextResponse.json({
      productIds: 0, lookedUp: 0, updated: 0, skipped: 0, missingCount: 0,
      note: "No line items with NULL/empty productVendor found.",
    });
  }

  // Distinct productIds that need a vendor
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
        where: { productId: pid, OR: [{ productVendor: null }, { productVendor: "" }] },
        data:  { productVendor: vendor },
      });
      updated += res.count;
    } else {
      skipped++;
    }

    // Rate limit
    await sleep(delayMs);
  }

  return NextResponse.json({
    productIds: groups.length, lookedUp, updated, skipped, missingCount,
  });
}
