// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Helpers
function coerceString(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function coerceInt(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function readBody(req: Request): Promise<Record<string, any>> {
  const type = (req.headers.get("content-type") || "").toLowerCase();

  // JSON payloads
  if (type.includes("application/json")) {
    return await req.json();
  }

  // URL-encoded payloads
  if (type.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    const get = (k: string) => coerceString(params.get(k));
    const getInt = (k: string) => {
      const val = params.get(k);
      return val == null ? null : coerceInt(val);
    };
    return {
      salonName: get("salonName"),
      customerName: get("customerName"),
      addressLine1: get("addressLine1") ?? get("address1"),
      addressLine2: get("addressLine2") ?? get("address2"),
      town: get("town"),
      county: get("county"),
      postCode: get("postCode") ?? get("postcode"),
      daysOpen: get("daysOpen"),
      brandsInterestedIn: get("brandsInterestedIn") ?? get("brands"),
      notes: get("notes"),
      salesRep: get("salesRep"),
      customerNumber: get("customerNumber"),
      customerEmailAddress: get("customerEmailAddress") ?? get("email"),
      openingHours: get("openingHours"),
      numberOfChairs: getInt("numberOfChairs"),
    };
  }

  // multipart/form-data or fallback to formData()
  try {
    const form = await req.formData();
    const get = (k: string) => coerceString(form.get(k));
    const getInt = (k: string) => coerceInt(form.get(k));
    return {
      salonName: get("salonName"),
      customerName: get("customerName"),
      addressLine1: get("addressLine1") ?? get("address1"),
      addressLine2: get("addressLine2") ?? get("address2"),
      town: get("town"),
      county: get("county"),
      postCode: get("postCode") ?? get("postcode"),
      daysOpen: get("daysOpen"),
      brandsInterestedIn: get("brandsInterestedIn") ?? get("brands"),
      notes: get("notes"),
      salesRep: get("salesRep"),
      customerNumber: get("customerNumber"),
      customerEmailAddress: get("customerEmailAddress") ?? get("email"),
      openingHours: get("openingHours"),
      numberOfChairs: getInt("numberOfChairs"),
    };
  } catch {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }
}

// GET /api/customers
export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(customers);
}

// POST /api/customers
export async function POST(req: Request) {
  try {
    const body = await readBody(req);

    const data = {
      salonName: body.salonName ?? null,
      customerName: body.customerName ?? null,
      addressLine1: body.addressLine1 ?? null,
      addressLine2: body.addressLine2 ?? null,
      town: body.town ?? null,
      county: body.county ?? null,
      postCode: body.postCode ?? null,
      daysOpen: body.daysOpen ?? null,
      brandsInterestedIn: body.brandsInterestedIn ?? null,
      notes: body.notes ?? null,
      salesRep: body.salesRep ?? null,
      customerNumber: body.customerNumber ?? null,
      customerEmailAddress: body.customerEmailAddress ?? null,
      openingHours: body.openingHours ?? null,
      numberOfChairs: body.numberOfChairs ?? null,
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
    console.error("Create customer error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
