// app/api/vendors/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Returns vendors from StockedBrand (primary source).
 * If none exist there, falls back to distinct OrderLineItem.productVendor.
 *
 * Shape (for maximum compatibility):
 * {
 *   vendors: [{ id: string, name: string }],   // object shape
 *   names:   string[],                          // plain strings
 *   source:  "stocked" | "orders",
 *   count:   number
 * }
 *
 * Pages that previously expected a plain array can just read `names`.
 */
export async function GET() {
  // 1) Primary: StockedBrand names (alphabetical)
  const stocked = await prisma.stockedBrand.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const stockedNames = stocked
    .map((b) => (b.name ?? "").trim())
    .filter(Boolean);

  // case-insensitive unique & sort (safety)
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  const uniqStockedNames = Array.from(new Set(stockedNames)).sort(
    collator.compare
  );

  let vendors =
    uniqStockedNames.length > 0
      ? uniqStockedNames.map((name) => ({
          id: name, // use name as id (your UI filters by name)
          name,
        }))
      : [];

  let names = uniqStockedNames;
  let source: "stocked" | "orders" = "stocked";

  // 2) Fallback: distinct productVendor seen in orders
  if (vendors.length === 0) {
    const rows = await prisma.orderLineItem.findMany({
      where: { productVendor: { not: null } },
      select: { productVendor: true },
      distinct: ["productVendor"],
    });

    const orderNames = rows
      .map((r) => (r.productVendor ?? "").trim())
      .filter(Boolean);

    const uniqOrderNames = Array.from(new Set(orderNames)).sort(
      collator.compare
    );

    vendors = uniqOrderNames.map((name) => ({ id: name, name }));
    names = uniqOrderNames;
    source = "orders";
  }

  return NextResponse.json(
    { vendors, names, source, count: names.length },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
