import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const visits = await prisma.visit.findMany({
    where: { customerId: params.id },
    orderBy: { date: 'desc' },
  });
  return NextResponse.json(visits);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { date, summary, staff } = await req.json();

  const visit = await prisma.visit.create({
    data: {
      customerId: params.id,
      date: date ? new Date(date) : new Date(),
      ...(summary ? { summary } : {}),
      ...(staff ? { staff } : {}),
    },
  });

  return NextResponse.json(visit, { status: 201 });
}
