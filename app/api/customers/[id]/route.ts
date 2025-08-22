// app/api/customers/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits: { orderBy: { date: 'desc' } },
      notes: { orderBy: { createdAt: 'desc' } }, // <-- use "notes", not "notesLog"
    },
  });

  if (!customer) {
    return new NextResponse('Not found', { status: 404 });
  }

  return NextResponse.json(customer);
}
