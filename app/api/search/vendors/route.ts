import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    // Only our own stocked brands (the same list managed in Brand Management)
    const brands = await prisma.stockedBrand.findMany({
      where: {
        visibleInReports: true,
        ...(q.length >= 2 ? { name: { contains: q, mode: "insensitive" } } : {}),
      },
      select: { name: true },
      orderBy: { name: "asc" },
      take: limit,
    });

    const results = brands.map(b => b.name.trim()).filter(s => s.length > 0);

    return NextResponse.json({ results });
  } catch (err: any) {
    console.error("/api/search/vendors error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
