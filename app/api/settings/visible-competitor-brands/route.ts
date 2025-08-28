import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const toggles = await prisma.visibilityToggle.findMany({
    where: { type: "COMPETITOR", visible: true },
    select: { brandId: true },
  });
  const ids = toggles.map(t => t.brandId);
  if (ids.length === 0) return NextResponse.json([]);

  const brands = await prisma.brand.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json(brands);
}
