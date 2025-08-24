// app/api/stocked-brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/stocked-brands  -> { name: string }
export async function POST(req: Request) {
  try {
    const { name } = await req.json().catch(() => ({} as any));
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Stocked brand name is required." }, { status: 400 });
    }

    const created = await prisma.stockedBrand.create({
      data: { name: trimmed },
      select: { id: true, name: true, createdAt: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    // handle unique constraint nicely
    if (String(err?.code) === "P2002") {
      return NextResponse.json({ error: "That stocked brand already exists." }, { status: 409 });
    }
    console.error("POST /api/stocked-brands failed:", err);
    return NextResponse.json({ error: "Failed to add stocked brand." }, { status: 500 });
  }
}

// GET /api/stocked-brands[?q=]
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  const where = q
    ? { name: { contains: q, mode: "insensitive" as const } }
    : {};

  const rows = await prisma.stockedBrand.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json(rows);
}
