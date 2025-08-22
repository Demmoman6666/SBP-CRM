import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

export async function POST(req: Request, { params }: Params) {
  const { date, summary, staff } = await req.json();
  const visit = await prisma.visit.create({
    data: {
      customerId: params.id,
      date: date ? new Date(date) : new Date(),
      summary,
      staff
    }
  });
  return NextResponse.json(visit);
}
