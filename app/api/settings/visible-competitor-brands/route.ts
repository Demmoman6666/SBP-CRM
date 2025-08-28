import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.brand.findMany({
    where: { visibleInCallLog: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json(rows);
}
