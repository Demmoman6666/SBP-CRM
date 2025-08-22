import { NextResponse } from 'next/server'
import prisma from '../../../lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const customerId = searchParams.get('customerId') ?? undefined

  const visits = await prisma.visit.findMany({
    where: customerId ? { customerId } : undefined,
    orderBy: { date: 'desc' },
  })
  return NextResponse.json(visits)
}

export async function POST(req: Request) {
  const { customerId, date, notes, staff } = await req.json()
  if (!customerId) return new NextResponse('Missing customerId', { status: 400 })

  const visit = await prisma.visit.create({
    data: {
      customerId,
      date: date ? new Date(date) : undefined,
      notes,
      staff,
    },
  })
  return NextResponse.json(visit, { status: 201 })
}
