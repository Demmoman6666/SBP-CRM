import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type VendorDto = { id: string; name: string };

export async function GET() {
  const client = prisma as any; // allow optional model probing
  let vendors: VendorDto[] = [];

  // 1) Prefer explicit "stocked brands" table if it exists
  if (client.stockedBrand?.findMany) {
    const rows = await client.stockedBrand.findMany({
      where: { isActive: true }, // adjust if your flag is different
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    vendors = rows.map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
    }));
  }

  // 2) Try a Brand model with an isStocked flag
  if (!vendors.length && client.brand?.findMany) {
    const rows = await client.brand.findMany?.({
      where: { isStocked: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }).catch(() => null);

    if (rows?.length) {
      vendors = rows.map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? r.id),
      }));
    }
  }

  // 3) Try a Brand model with a stocked flag
  if (!vendors.length && client.brand?.findMany) {
    const rows = await client.brand.findMany?.({
      where: { stocked: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }).catch(() => null);

    if (rows?.length) {
      vendors = rows.map((r: any) => ({
        id: String(r.id),
        name: String(r.name ?? r.id),
      }));
    }
  }

  // 4) Final fallback: distinct productVendor from orders
  if (!vendors.length) {
    const rows = await prisma.orderLineItem.findMany({
      where: { productVendor: { not: null } },
      select: { productVendor: true },
      distinct: ["productVendor"],
    });

    const collator = new Intl.Collator("en", { sensitivity: "base" });
    vendors = Array.from(
      new Set(
        rows
          .map((r) => (r.productVendor ?? "").trim())
          .filter(Boolean)
      )
    )
      .sort(collator.compare)
      .map((name) => ({ id: name, name }));
  }

  return NextResponse.json(
    { vendors },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
