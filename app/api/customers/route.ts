// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Force Node runtime (ensures req.formData() works consistently)
export const runtime = "nodejs";

async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json()) as Record<string, any>;
  }
  // Handles classic HTML <form method="post"> (multipart/form-data or urlencoded)
  const fd = await req.formData();
  const obj: Record<string, any> = {};
  fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : String(v)));
  return obj;
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

    // 🔁 Map legacy keys → schema keys. Only whitelist what Prisma should see.
    const data = {
      salonName:             norm(b.salonName),
      customerName:          norm(b.customerName),

      // accept both new and old names
      addressLine1:          norm(b.addressLine1 ?? b.address1),
      addressLine2:          norm(b.addressLine2 ?? b.address2),

      town:                  norm(b.town),
      county:                norm(b.county),
      postCode:              norm(b.postCode),

      daysOpen:              norm(b.daysOpen),
      brandsInterestedIn:    norm(b.brandsInterestedIn ?? b.brands),
      notes:                 norm(b.notes),
      salesRep:              norm(b.salesRep),
      customerNumber:        norm(b.customerNumber),

      // accept both new and old names
      customerEmailAddress:  norm(b.customerEmailAddress ?? b.email),

      openingHours:          norm(b.openingHours),
      numberOfChairs:        toInt(b.numberOfChairs ?? b.chairs),
    };

    // Quick visibility in logs to verify mapping worked
    console.log("POST /api/customers received keys:", Object.keys(b));
    console.log("POST /api/customers normalized data:", data);

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        {
          error: "Missing required fields (salonName, customerName, addressLine1).",
          receivedKeys: Object.keys(b),
        },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201
