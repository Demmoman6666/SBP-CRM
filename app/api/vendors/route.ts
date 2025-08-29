import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type VendorDto = { id: string; name: string };

export async function GET() {
  // get distinct vendor names from order line items
  const rows = await prisma.orderLineItem.findMany({
    where: { productVendor: { not: null } },
    select: { productVendor: true },
    distinct: ["productVendor"],
  });

  // clean, de-dupe, sort (case-insensitive), then map to { id, name }
  const collator = new Intl.Collator("en", { sensitivity: "base" });

  const vendors: VendorDto[] = Array.from(
    new Set(
      rows
        .map((r) => (r.productVendor ?? "").trim())
        .filter(Boolean)
    )
  )
    .sort(collator.compare)
    .map((name) => ({ id: name, name }));

  return NextResponse.json(
    { vendors },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
