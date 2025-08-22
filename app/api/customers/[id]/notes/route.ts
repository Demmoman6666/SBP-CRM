// app/api/customers/[id]/notes/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

type Params = { params: { id: string } };

// List notes for a customer
export async function GET(_req: Request, { params }: Params) {
  const notes = await prisma.note.findMany({
    where: { customerId: params.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(notes);
}

// Add a note for a customer
export async function POST(req: Request, { params }: Params) {
  const { text, staff } = await req.json();
  if (!text) {
    return NextResponse.json({ error: 'Missing text' }, { status: 400 });
  }

  const note = await prisma.note.create({
    data: {
      text,
      staff: staff ?? null,
      customerId: params.id,
    },
  });

  return NextResponse.json(note, { status: 201 });
}
