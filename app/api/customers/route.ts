// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Read JSON or form-data bodies
async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json()) as Record<string, any>;
  }
  const fd = await req.formData();
  const o: Record<string, any> = {};
  fd.forEach((v, k) => (o[k] = typeof v === "string" ? v : String(v)));
  return o;
}
const norm = (v: unknown) =>
  v === undefined || v === null ? null : String(v).trim() || null;
const toInt = (v: unknown) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  try {
    const b = await readBody(req);

    // Map legacy -> new names (address1->addressLine1, address2->addressLine2, email->customerEmailAddress)
    const data = {
      salonName: norm(b.salonName),
      customerName: norm(b.customerName),

      addressLine1: norm(b.addressLine1 ?? b.address1),
      addressLine2: norm(b.addressLine2 ?? b.address2),

      town: norm(b.town),
      county: norm(b.county),
      postCode: norm(b.postCode),

      daysOpen: norm(b.daysOpen),
      brandsInterestedIn: norm(b.brandsInterestedIn ?? b.brands),

      notes: norm(b.notes),
      salesRep: norm(b.salesRep),
      customerNumber: norm(b.customerNumber),
      customerEmailAddress: norm(b.customerEmailAddress ?? b.email),
      openingHours: norm(b.openingHours),
      numberOfChairs: toInt(b.numberOfChairs ?? b.chairs),
    };

    // Validate required fields
    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        {
          error:
            "Missing required fields. Need salonName, customerName, addressLine1.",
          receivedKeys: Object.keys(b),
          normalized: data,
        },
        { status: 400 }
      );
    }

    // Only the whitelisted keys above are sent to Prisma (so legacy keys cannot sneak in)
    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/customers failed:", err);
    return NextResponse.json({ error: "Could not save customer" }, { status: 500 });
  }
}
