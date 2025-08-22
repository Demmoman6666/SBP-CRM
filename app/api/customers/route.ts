// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Helper: read JSON or form-data, then normalize keys
async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json()) as Record<string, any>;
  }
  // Fallback for form posts
  const fd = await req.formData();
  const obj: Record<string, any> = {};
  fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : String(v)));
  return obj;
}

const pick = (o: Record<string, any>, ...keys: string[]) =>
  keys.find((k) => o[k] != null && o[k] !== "") ? o[keys.find((k) => o[k] != null && o[k] !== "") as string] : null;

const toInt = (v: any) => {
  if (v == null || v === "") return null;
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
    const body = await readBody(req);

    // Accept both the new and old field names
    const data = {
      salonName: pick(body, "salonName"),
      customerName: pick(body, "customerName"),
      addressLine1: pick(body, "addressLine1", "address1"),
      addressLine2: pick(body, "addressLine2", "address2"),
      town: pick(body, "town"),
      county: pick(body, "county"),
      postCode: pick(body, "postCode"),
      daysOpen: pick(body, "daysOpen"),
      brandsInterestedIn: pick(body, "brandsInterestedIn", "brands"),
      notes: pick(body, "notes"),
      salesRep: pick(body, "salesRep"),
      customerNumber: pick(body, "customerNumber"),
      customerEmailAddress: pick(body, "customerEmailAddress", "email"),
      openingHours: pick(body, "openingHours"),
      numberOfChairs: toInt(pick(body, "numberOfChairs", "chairs")),
    };

    // Validate required fields
    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: salonName, customerName, addressLine1",
        },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/customers failed:", err);
    return NextResponse.json(
      { error: "Could not save customer" },
      { status: 500 }
    );
  }
}
