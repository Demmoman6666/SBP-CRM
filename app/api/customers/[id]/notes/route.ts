// app/api/customers/[id]/notes/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const notes = await prisma.note.findMany({
    where: { customerId: params.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(notes);
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const { text, staff } = await req.json();
  if (!text) return new NextResponse('Missing text', { status: 400 });

  const note = await prisma.note.create({
    data: { text, staff, customerId: params.id },
  });

  return NextResponse.json(note, { status: 201 });
}
