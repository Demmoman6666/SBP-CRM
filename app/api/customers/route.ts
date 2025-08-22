// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  // JSON payload
  if (type.includes("application/json")) {
    return await req.json();
  }

  // URL-encoded payload
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

  // multipart/form-data (file-safe) or anything else we can parse via formData()
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
    // last resort
    try { return await req.json(); } catch { return {}; }
  }
}

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(customers)
