import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Create customer
export async function POST(req: Request) {
  const body = await req.json();
  const customer = await prisma.customer.create({ data: body });
  return NextResponse.json(customer);
}

// Search customers  /api/customers?q=term
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  if (!q) {
    const latest = await prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, salonName: true, customerName: true, town: true, email: true, createdAt: true }
    });
    return NextResponse.json(latest);
  }

  const results = await prisma.customer.findMany({
    where: {
      OR: [
        { salonName: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { town: { contains: q, mode: "insensitive" } },
        { customerNumber: { contains: q, mode: "insensitive" } }
      ]
    },
    take: 50,
    orderBy: { createdAt: "desc" },
    select: { id: true, salonName: true, customerName: true, town: true, email: true, createdAt: true }
  });

  return NextResponse.json(results);
}

