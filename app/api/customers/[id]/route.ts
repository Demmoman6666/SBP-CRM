// app/api/customers/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits: { orderBy: { date: 'desc' } },
      notesLog: { orderBy: { createdAt: 'desc' } }
    }
  });
  if (!customer) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(customer);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const data = await req.json();
  const updated = await prisma.customer.update({ where: { id: params.id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.visit.deleteMany({ where: { customerId: params.id } });
  await prisma.note.deleteMany({ where: { customerId: params.id } });
  await prisma.customer.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
}
