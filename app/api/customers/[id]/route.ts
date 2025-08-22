import { NextResponse } from 'next/server'
import prisma from '../../../../lib/prisma'

type Params = { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      visits: { orderBy: { date: 'desc' } },
      notes:  { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!customer) return new NextResponse('Not found', { status: 404 })
  return NextResponse.json(customer)
}

export async function PATCH(req: Request, { params }: Params) {
  const data = await req.json()
  const updated = await prisma.customer.update({
    where: { id: params.id },
    data,
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: Params) {
  await prisma.customer.delete({ where: { id: params.id } })
  return new NextResponse(null, { status: 204 })
}
