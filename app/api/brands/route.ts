// app/api/brands/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(brands);
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
    }
    const brand = await prisma.brand.create({
      data: { name: String(name).trim() },
    });
    return NextResponse.json(brand, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Brand already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create brand" }, { status: 500 });
  }
}
