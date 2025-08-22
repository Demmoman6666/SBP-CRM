// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Small helper
function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Backwards-compatible mapping for older field names (address1/address2/email)
    const pick = <T>(...vals: T[]) => vals.find(v => v !== undefined && v !== null);

    const data = {
      salonName: String(body.salonName ?? "").trim(),
      customerName: String(body.customerName ?? "").trim(),
      addressLine1: pick(trimOrNull(body.addressLine1), trimOrNull(body.address1)),
      addressLine2: pick(trimOrNull(body.addressLine2), trimOrNull(body.address2)),
      town: trimOrNull(body.town),
      county: trimOrNull(body.county),
      postCode: trimOrNull(body.postCode),
      daysOpen: trimOrNull(body.daysOpen),
      brandsInterestedIn: trimOrNull(body.brandsInterestedIn),
      notes: trimOrNull(body.notes),
      salesRep: trimOrNull(body.salesRep),
      customerNumber: trimOrNull(body.customerNumber),
      customerEmailAddress: pick(
        trimOrNull(body.customerEmailAddress),
        trimOrNull(body.email)
      ),
      openingHours: trimOrNull(body.openingHours),
      numberOfChairs:
        body.numberOfChairs === "" || body.numberOfChairs == null
          ? null
          : Number(body.numberOfChairs),
    };

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        { error: "Missing required fields: salonName, customerName, addressLine1" },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
