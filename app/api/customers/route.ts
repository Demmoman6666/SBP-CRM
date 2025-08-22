// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Read body as JSON or form-data */
async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json()) as Record<string, any>;
  }
  const fd = await req.formData();
  const obj: Record<string, any> = {};
  fd.forEach((v, k) => (obj[k] = typeof v === "string" ? v : String(v)));
  return obj;
}

/** First non-empty key from the list */
function first(body: Record<string, any>, ...keys: string[]) {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
}
function toInt(v: any) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const customers = await prisma.customer.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(customers);
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    // DEBUG logs will show in Vercel "Function Logs"
    console.log("POST /api/customers incoming keys:", Object.keys(body));

    // Map old -> new keys
    const data = {
      salonName: first(body, "salonName"),
      customerName: first(body, "customerName"),
      addressLine1: first(body, "addressLine1", "address1"),
      addressLine2: first(body, "addressLine2", "address2"),
      town: first(body, "town"),
      county: first(body, "county"),
      postCode: first(body, "postCode"),
      daysOpen: first(body, "daysOpen"),
      brandsInterestedIn: first(body, "brandsInterestedIn", "brands"),
      notes: first(body, "notes"),
      salesRep: first(body, "salesRep"),
      customerNumber: first(body, "customerNumber"),
      customerEmailAddress: first(body, "customerEmailAddress", "email"),
      openingHours: first(body, "openingHours"),
      numberOfChairs: toInt(first(body, "numberOfChairs", "chairs")),
    };

    console.log("POST /api/customers normalized data:", data);

    // Validate required
    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        { error: "Missing required: salonName, customerName, addressLine1" },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/customers failed:", err);
    return NextResponse.json({ error: "Could not save customer" }, { status: 500 });
  }
}
