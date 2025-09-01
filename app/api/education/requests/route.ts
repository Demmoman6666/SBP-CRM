// app/api/education/requests/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toArray(v: FormDataEntryValue | FormDataEntryValue[] | null): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}

export async function POST(req: Request) {
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    const isForm =
      ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data");

    const data: any = isForm ? Object.fromEntries((await req.formData()).entries()) : await req.json();

    // Multi-value fields come through as repeated keys; make sure we normalize
    // For forms, fetch all occurrences:
    if (isForm) {
      const fd = await req.formData();
      data.brandNames = fd.getAll("brandNames").map(String);
      data.educationTypes = fd.getAll("educationTypes").map(String);
    } else {
      data.brandNames = Array.isArray(data.brandNames) ? data.brandNames : [];
      data.educationTypes = Array.isArray(data.educationTypes) ? data.educationTypes : [];
    }

    console.log("[education] request", {
      at: new Date().toISOString(),
      customerId: data.customerId || null,
      salonName: data.salonName || null,
      contact: data.customerName || null,
      phone: data.customerTelephone || null,
      email: data.customerEmailAddress || null,
      address: [
        data.addressLine1,
        data.addressLine2,
        data.town,
        data.county,
        data.postCode,
        data.country,
      ].filter(Boolean),
      brandNames: data.brandNames,
      educationTypes: data.educationTypes,
      notes: data.notes || null,
    });

    // TODO: Persist with Prisma once you add a model (EducationRequest)

    // Redirect to the list
    const url = new URL("/education/requests?created=1", req.url);
    return NextResponse.redirect(url, { status: 303 });
  } catch (e: any) {
    console.error("Education request error:", e);
    return NextResponse.json({ error: e?.message || "Failed to submit request" }, { status: 500 });
  }
}
