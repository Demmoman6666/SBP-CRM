// app/api/vendors/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rows = await prisma.orderLineItem.findMany({
    where: { productVendor: { not: null } },
    select: { productVendor: true },
    distinct: ["productVendor"],
    orderBy: { productVendor: "asc" as const },
  });
  const vendors = rows.map(r => r.productVendor).filter(Boolean) as string[];
  return NextResponse.json(vendors);
}
