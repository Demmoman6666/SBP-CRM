// app/api/customers/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  const data = await req.json();
  const created = await prisma.customer.create({ data });
  return NextResponse.json(created, { status: 201 });
}
