// app/api/education/requests/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ReadPayload =
  | {
      kind: "form";
      fd: FormData;
      obj: Record<string, FormDataEntryValue>;
      brandIds: string[];
      brandNames: string[];
      eduTypes: string[];
    }
  | {
      kind: "json";
      obj: any;
      brandIds: string[];
      brandNames: string[];
      eduTypes: string[];
    };

function pickString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

// 🔒 Read the body ONCE (form OR json)
async function readPayload(req: Request): Promise<ReadPayload> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData(); // <-- single read
    const obj = Object.fromEntries(fd); // last value wins for dup keys (fine for scalar fields)

    // Multi-select/checkbox values — collect all
    const brandIds   = (fd.getAll("brandIds") as string[]).map(String);
    const brandNames = (fd.getAll("brandNames") as string[]).map(String); // optional if you also send names
    const eduTypes   = (fd.getAll("educationTypes") as string[]).map(String);

    return { kind: "form", fd, obj, brandIds, brandNames, eduTypes };
  }

  // JSON fallback
  const obj = (await req.json().catch(() => ({}))) as any; // <-- single read
  return {
    kind: "json",
    obj,
    brandIds: Array.isArray(obj?.brandIds) ? obj.brandIds.map(String) : [],
    brandNames: Array.isArray(obj?.brandNames) ? obj.brandNames.map(String) : [],
    eduTypes: Array.isArray(obj?.educationTypes) ? obj.educationTypes.map(String) : [],
  };
}

export async function POST(req: Request) {
  try {
    const payload = await readPayload(req);

    const get = (k: string): string | null => {
      const raw =
        payload.kind === "form" ? (payload.fd.get(k) ?? null) : (payload.obj?.[k] ?? null);
      return pickString(raw);
    };

    // Required/primary fields (adjust to your schema)
    const customerId  = get("customerId");
    const salonName   = get("salonName");
    const contactName = get("contactName");
    const email       = get("email");
    const telephone   = get("telephone");

    // Address & meta
    const addressLine1 = get("addressLine1");
    const addressLine2 = get("addressLine2");
    const town         = get("town");
    const county       = get("county");
    const postCode     = get("postCode");
    const country      = get("country");
    const notes        = get("notes");

    if (!customerId) {
      return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
    }

    // 💾 Persist — field names here assume you created an EducationRequest model
    const created = await prisma.educationRequest.create({
      data: {
        customerId,
        salonName,
        contactName,
        email,
        telephone,
        addressLine1,
        addressLine2,
        town,
        county,
        postCode,
        country,
        brandIds: payload.brandIds,            // string[]
        brandNames: payload.brandNames,        // optional string[]
        educationTypes: payload.eduTypes,      // string[]
        notes,
        status: "REQUESTED",                   // or whatever enum/string you use
      },
      select: { id: true },
    });

    // Send user to the request detail/list
    return NextResponse.redirect(
      new URL(`/education/requests/${created.id}`, req.url),
      { status: 303 }
    );
  } catch (err: any) {
    console.error("Education request error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
