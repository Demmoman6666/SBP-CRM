// app/api/sales-reps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const reps = await prisma.salesRep.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return NextResponse.json(reps);
  } catch (err) {
    console.error("GET /api/sales-reps failed:", err);
    return NextResponse.json({ error: "Failed to load sales reps" }, { status: 500 });
  }
}
