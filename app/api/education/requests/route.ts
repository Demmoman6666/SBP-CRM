// app/api/education/requests/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { EducationType, EducationRequestStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/* -------------------- helpers -------------------- */
function isFormRequest(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  return ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded");
}

async function readJsonBody(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

// Normalize human strings → enum values
function normalizeEduType(v: unknown): EducationType | null {
  const s0 = String(v ?? "").trim().toLowerCase();
  if (!s0) return null;

  const s = s0
    .replace(/-/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/hair colour/g, "colour") // tolerate "hair colour"
    .replace(/permenant/g, "permanent") // common typo
    .trim();

  if (s === "permanent colour") return "PERMANENT_COLOUR";
  if (s === "semi permanent colour") return "SEMI_PERMANENT_COLOUR";
  if (s === "care range") return "CARE_RANGE";
  if (s === "styling range") return "STYLING_RANGE";

  // Also allow exact enum strings already
  const sUpper = String(v).trim().toUpperCase();
  if (["PERMANENT_COLOUR","SEMI_PERMANENT_COLOUR","CARE_RANGE","STYLING_RANGE"].includes(sUpper)) {
    return sUpper as EducationType;
  }
  return null;
}

function normalizeStatus(v: unknown): EducationRequestStatus {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "BOOKED") return "BOOKED";
  if (s === "CANCELLED") return "CANCELLED";
  return "REQUESTED";
}

/* -------------------- POST /api/education/requests -------------------- */
export async function POST(req: Request) {
  try {
    const isForm = isFormRequest(req);

    // Read body and support multi-value fields for form posts
    let payload: any = {};
    let multi: Record<string, string[]> = {};

    if (isForm) {
      const fd = await req.formData();

      // Single-value helpers
      const getS = (k: string) => {
        const v = fd.get(k);
        return v == null ? "" : String(v);
      };

      // Multi-value (checkbox) helpers
      const getAll = (k: string) => fd.getAll(k).map(String);

      // Core ids
      const customerId = getS("customerId");

      // Brands: prefer IDs then resolve to names; fallback to brandNames
      const brandIds = getAll("brandIds");
      const brandNamesDirect = getAll("brandNames"); // optional

      // Education types: accept either "educationTypes" or "eduTypes"
      const eduTypesRaw = [...new Set([...getAll("educationTypes"), ...getAll("eduTypes")])];

      payload = {
        customerId,
        salonName: getS("salonName") || null,
        contactName: getS("contactName") || getS("customerName") || null,
        phone: getS("phone") || getS("customerTelephone") || null,
        email: getS("email") || getS("customerEmailAddress") || null,
        addressLine1: getS("addressLine1") || null,
        addressLine2: getS("addressLine2") || null,
        town: getS("town") || null,
        county: getS("county") || null,
        postCode: getS("postCode") || null,
        country: getS("country") || null,
        notes: getS("notes") || null,
        status: getS("status") || "REQUESTED",
      };
      multi = { brandIds, brandNames: brandNamesDirect, eduTypes: eduTypesRaw };
    } else {
      // JSON
      const j = await readJsonBody(req);
      payload = {
        customerId: String(j.customerId || ""),
        salonName: j.salonName ?? null,
        contactName: j.contactName ?? null,
        phone: j.phone ?? null,
        email: j.email ?? null,
        addressLine1: j.addressLine1 ?? null,
        addressLine2: j.addressLine2 ?? null,
        town: j.town ?? null,
        county: j.county ?? null,
        postCode: j.postCode ?? null,
        country: j.country ?? null,
        notes: j.notes ?? null,
        status: j.status ?? "REQUESTED",
      };
      multi = {
        brandIds: Array.isArray(j.brandIds) ? j.brandIds.map(String) : [],
        brandNames: Array.isArray(j.brandNames) ? j.brandNames.map(String) : [],
        eduTypes: Array.isArray(j.educationTypes)
          ? j.educationTypes.map(String)
          : Array.isArray(j.eduTypes)
          ? j.eduTypes.map(String)
          : [],
      };
    }

    // Validate required
    if (!payload.customerId) {
      return NextResponse.json({ error: "customerId is required" }, { status: 400 });
    }

    // Ensure customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: payload.customerId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Resolve brand names
    let brandNames: string[] = [];
    if (multi.brandIds && multi.brandIds.length > 0) {
      const uniqIds = [...new Set(multi.brandIds)];
      const brands = await prisma.stockedBrand.findMany({
        where: { id: { in: uniqIds } },
        select: { name: true },
      });
      brandNames = brands.map(b => b.name);
    } else if (multi.brandNames && multi.brandNames.length > 0) {
      brandNames = [...new Set(multi.brandNames.map(String))];
    }

    // Normalize edu types to enum values
    const eduTypes: EducationType[] = [...new Set(
      (multi.eduTypes || [])
        .map(normalizeEduType)
        .filter((x): x is EducationType => x != null)
    )];

    // Status
    const status = normalizeStatus(payload.status);

    // Create request
    const created = await prisma.educationRequest.create({
      data: {
        customerId: payload.customerId,
        status,
        salonName: payload.salonName,
        contactName: payload.contactName,
        phone: payload.phone,
        email: payload.email,
        addressLine1: payload.addressLine1,
        addressLine2: payload.addressLine2,
        town: payload.town,
        county: payload.county,
        postCode: payload.postCode,
        country: payload.country,
        brands: brandNames,                 // String[]
        educationTypes: { set: eduTypes },  // Enum[]
        notes: payload.notes,
      },
      select: { id: true, customerId: true },
    });

    if (isForm) {
      // Go to the list where you can review and book
      return NextResponse.redirect(new URL("/education/requests", req.url), { status: 303 });
    }
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err: any) {
    console.error("[education] create request error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/* -------------------- GET /api/education/requests -------------------- */
/* Query:
   - status=REQUESTED|BOOKED|CANCELLED (default REQUESTED)
   - take=number (default 50)
*/
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusQ = searchParams.get("status") || "REQUESTED";
  const take = Math.min(Math.max(Number(searchParams.get("take") || 50), 1), 200);

  const status = normalizeStatus(statusQ);

  const rows = await prisma.educationRequest.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take,
    include: {
      customer: { select: { id: true, salonName: true, customerName: true, salesRep: true } },
      booking: true,
    },
  });

  return NextResponse.json(rows);
}
