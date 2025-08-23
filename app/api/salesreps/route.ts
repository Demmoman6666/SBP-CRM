// app/api/salesreps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const reps = await prisma.salesRep.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(reps);
}

export async function POST(req: Request) {
  try {
    const { name, email } = await req.json();
    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const rep = await prisma.salesRep.create({
      data: { name: String(name).trim(), email: email ? String(email).trim() : null },
    });
    return NextResponse.json(rep, { status: 201 });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Sales rep already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create sales rep" }, { status: 500 });
  }
}
