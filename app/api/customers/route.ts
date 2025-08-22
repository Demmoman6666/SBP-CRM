// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  try {
    const b = await req.json();

    const data = {
      salonName: b.salonName,
      customerName: b.customerName,
      addressLine1: b.addressLine1,
      addressLine2: b.addressLine2 ?? null,
      town: b.town ?? null,
      county: b.county ?? null,
      postCode: b.postCode ?? null,
      daysOpen: b.daysOpen ?? null,
      brandsInterestedIn: b.brandsInterestedIn ?? null,
      notes: b.notes ?? null,
      salesRep: b.salesRep ?? null,
      customerNumber: b.customerNumber ?? null,
      customerEmailAddress: b.customerEmailAddress ?? null,
      openingHours: b.openingHours ?? null,
      numberOfChairs:
        b.numberOfChairs === "" || b.numberOfChairs == null ? null : Number(b.numberOfChairs),
    };

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        { error: "Salon Name, Customer Name and Address Line 1 are required." },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("Create customer failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown error creating customer" },
      { status: 500 }
    );
  }
}
