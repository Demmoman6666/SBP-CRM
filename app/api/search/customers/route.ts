import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const take = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const results = await prisma.customer.findMany({
      where: {
        OR: [
          { salonName: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
          { customerEmailAddress: { contains: q, mode: "insensitive" } },
          { postCode: { contains: q, mode: "insensitive" } },
          { town: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        salonName: true,
        customerName: true,
        town: true,
        postCode: true,
      },
      take,
      orderBy: { updatedAt: "desc" },
    });

    const shaped = results.map((c) => {
      const name = c.salonName || c.customerName || "Unnamed";
      const extra = [c.town, c.postCode].filter(Boolean).join(" · ");
      return { id: c.id, name, extra };
    });

    return NextResponse.json({ results: shaped });
  } catch (err: any) {
    console.error("/api/search/customers error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
