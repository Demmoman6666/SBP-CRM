// app/api/customers/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/* ------------ body reader (json/form) ------------ */
async function readBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json"))        return await req.json();
  if (ct.includes("multipart/form-data"))     return Object.fromEntries((await req.formData()).entries());
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  try { return await req.json(); } catch {}
  try {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {}
  return {};
}

/* ------------ helpers ------------ */
const toInt = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Normalize incoming country values to ISO-2 codes for Shopify friendliness
function normalizeCountry(input: unknown): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const up = raw.toUpperCase();

  // If already a 2-letter code, accept
  if (/^[A-Z]{2}$/.test(up)) return up;

  // Common name → code mappings (extend as needed)
  const map: Record<string, string> = {
    "UNITED KINGDOM": "GB",
    "GREAT BRITAIN": "GB",
    "UK": "GB",
    "ENGLAND": "GB",
    "SCOTLAND": "GB",
    "WALES": "GB",
    "NORTHERN IRELAND": "GB",

    "UNITED STATES": "US",
    "UNITED STATES OF AMERICA": "US",
    "USA": "US",
    "AMERICA": "US",

    "IRELAND": "IE",
    "REPUBLIC OF IRELAND": "IE",

    "CANADA": "CA",
    "AUSTRALIA": "AU",
    "NEW ZEALAND": "NZ",
    "FRANCE": "FR",
    "GERMANY": "DE",
    "SPAIN": "ES",
    "ITALY": "IT",
    "NETHERLANDS": "NL",
    "BELGIUM": "BE",
    "SWEDEN": "SE",
    "NORWAY": "NO",
    "DENMARK": "DK",
    "SWITZERLAND": "CH",
    "AUSTRIA": "AT",
    "PORTUGAL": "PT",
    "POLAND": "PL",
  };

  return map[up] || raw; // fall back to original text if not mapped
}

/* ------------------ POST /api/customers ------------------ */
export async function POST(req: Request) {
  try {
    const contentType = (req.headers.get("content-type") || "").toLowerCase();
    const isForm =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data");

    const body: any = await readBody(req);

    const data = {
      salonName:             (body.salonName ?? "").toString().trim(),
      customerName:          (body.customerName ?? "").toString().trim(),
      addressLine1:          (body.addressLine1 ?? "").toString().trim(),
      addressLine2:          (body.addressLine2 ?? "") || null,
      town:                  (body.town ?? "") || null,
      county:                (body.county ?? "") || null,
      postCode:              (body.postCode ?? "") || null,
      country:               normalizeCountry(body.country),          // ← NEW (normalized)
      daysOpen:              (body.daysOpen ?? "") || null,
      brandsInterestedIn:    (body.brandsInterestedIn ?? "") || null,
      notes:                 (body.notes ?? "") || null,
      salesRep:              (body.salesRep ?? "").toString().trim(), // REQUIRED
      customerNumber:        (body.customerNumber ?? "") || null,
      customerTelephone:     (body.customerTelephone ?? "") || null,
      customerEmailAddress:  (body.customerEmailAddress ?? "") || null,
      openingHours:          (body.openingHours ?? "") || null,
      numberOfChairs:        toInt(body.numberOfChairs),
    };

    if (!data.salonName || !data.customerName || !data.addressLine1) {
      return NextResponse.json(
        { error: "Missing required fields: salonName, customerName, addressLine1" },
        { status: 400 }
      );
    }

    if (!data.salesRep) {
      return NextResponse.json(
        { error: "Sales Rep is required." },
        { status: 400 }
      );
    }

    const created = await prisma.customer.create({ data });

    if (isForm) {
      return NextResponse.redirect(new URL(`/customers/${created.id}`, req.url), { status: 303 });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("Create customer error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/* ------------------ GET /api/customers (search) ------------------ */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("search") || searchParams.get("q") || "").trim();
  const takeParam = Number(searchParams.get("take") || 20);
  const take = Math.min(Math.max(takeParam, 1), 50);

  const where = q
    ? {
        OR: [
          { salonName:            { contains: q, mode: "insensitive" as const } },
          { customerName:         { contains: q, mode: "insensitive" as const } },
          { customerEmailAddress: { contains: q, mode: "insensitive" as const } },
          { town:                 { contains: q, mode: "insensitive" as const } },
          { county:               { contains: q, mode: "insensitive" as const } },
          { postCode:             { contains: q, mode: "insensitive" as const } },
          { country:              { contains: q, mode: "insensitive" as const } }, // ← NEW
        ],
      }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    orderBy: q ? { salonName: "asc" } : { createdAt: "desc" },
    take: q ? take : 50,
    select: {
      id: true,
      salonName: true,
      customerName: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      county: true,
      postCode: true,
      country: true, // ← NEW
      customerEmailAddress: true,
      customerNumber: true,
      customerTelephone: true,
      salesRep: true,
    },
  });

  return NextResponse.json(customers);
}
