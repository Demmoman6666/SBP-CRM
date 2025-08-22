import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get('customerId') ?? undefined;

  const visits = await prisma.visit.findMany({
    where: customerId ? { customerId } : undefined,
    orderBy: { date: 'desc' },
    include: { customer: true },
  });

  return NextResponse.json(visits);
}
