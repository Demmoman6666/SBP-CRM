// app/api/customers/[id]/visits/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { date, summary, staff } = await req.json();

  const visit = await prisma.visit.create({
    data: {
      customerId: params.id,
      date: date ? new Date(date) : new Date(),
      summary: summary || null,
      staff: staff || null,
    },
  });

  return NextResponse.json(visit, { status: 201 });
}
