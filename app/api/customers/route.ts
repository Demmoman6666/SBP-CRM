// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Required fields (match your Prisma schema)
    for (const key of ["salonName", "customerName", "addressLine1"] as const) {
      if (!body[key] || !String(body[key]).trim()) {
        return NextResponse.json({ error: `${key} is required` }, { status: 400 });
      }
    }

    // Coerce/clean inputs
    const clean = (v: unknown) => {
      const s = String(v ?? "").trim();
      return s === "" ? null : s;
    };

    const numberOfChairs =
      body.numberOfChairs === undefined || body.numberOfChairs === null || String(body.numberOfChairs).trim() === ""
        ? null
        : Number(body.numberOfChairs);

    const data = {
      salonName: String(body.salonName).trim(),
      customerName: String(body.customerName).trim(),
      addressLine1: String(body.addressLine1).trim(),
      addressLine2: clean(body.addressLine2),
      town: clean(body.town),
      county: clean(body.county),
      postCode: clean(body.postCode),
      daysOpen: clean(body.daysOpen),
      brandsInterestedIn: clean(body.brandsInterestedIn),
      notes: clean(body.notes),
      salesRep: clean(body.salesRep),
      customerNumber: clean(body.customerNumber),
      customerEmailAddress: clean(body.customerEmailAddress),
      openingHours: clean(body.openingHours),
      numberOfChairs, // Int? in schema
    };

    const customer = await prisma.customer.create({ data });
    return NextResponse.json(customer, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/customers error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error while saving customer" },
      { status: 500 }
    );
  }
}
