import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

// Get by id
export async function GET(_req: Request, { params }: Params) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: { visits: { orderBy: { date: "desc" } }, notesLog: { orderBy: { createdAt: "desc" } } }
  });
  if (!customer) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(customer);
}

// Update basic fields (partial)
export async function PATCH(req: Request, { params }: Params) {
  const data = await req.json();
  const customer = await prisma.customer.update({ where: { id: params.id }, data });
  return NextResponse.json(customer);
}
