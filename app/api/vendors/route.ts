// app/api/vendors/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // 1) Primary source: StockedBrand (alphabetical)
  const stocked = await prisma.stockedBrand.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });

  let vendors = stocked.map((b) => b.name?.trim()).filter(Boolean) as string[];

  // 2) Fallback (only if none in StockedBrand): distinct vendors seen in orders
  if (vendors.length === 0) {
    const rows = await prisma.orderLineItem.findMany({
      where: { productVendor: { not: null } },
      select: { productVendor: true },
      distinct: ["productVendor"],
    });

    const names = rows
      .map((r) => (r.productVendor ?? "").trim())
      .filter(Boolean);

    // case-insensitive unique + sort
    const collator = new Intl.Collator("en", { sensitivity: "base" });
    vendors = Array.from(new Set(names)).sort(collator.compare);
  }

  return NextResponse.json(vendors, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
