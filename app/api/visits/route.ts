// app/api/visits/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma'; // use the named export

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId');

    const visits = await prisma.visit.findMany({
      where: customerId ? { customerId } : undefined,
      orderBy: { date: 'desc' },
    });

    return NextResponse.json(visits);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to fetch visits' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { customerId, date, notes } = body as {
      customerId?: string;
      date?: string | Date;
      notes?: string;
    };

    if (!customerId || !date) {
      return NextResponse.json(
        { error: 'customerId and date are required' },
        { status: 400 }
      );
    }

    const visit = await prisma.visit.create({
      data: {
        customerId,
        date: new Date(date),
        notes: notes ?? '',
      },
    });

    return NextResponse.json(visit, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Failed to create visit' }, { status: 500 });
  }
}
