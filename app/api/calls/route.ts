// app/api/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* ---------------- helpers ---------------- */
async function readBody(req: Request) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json")) return req.json();
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    return Object.fromEntries(fd.entries());
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  }

  // fallbacks
  try { return await req.json(); } catch {}
  try {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text));
  } catch {}
  return {};
}

const toBool = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  return ["1", "true", "yes", "on"].includes(s);
};

const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);

/** Accepts:
 *  - 2025-08-29T21:02
 *  - 29/08/2025 21:02
 *  - 29/08/2025, 21:02
 *  - 29-08-2025 21:02
 */
function parseFollowUp(val: unknown): Date | null {
  if (!val) return null;
  const raw = String(val).trim();

  // try native first
  const d1 = new Date(raw);
  if (!isNaN(d1.getTime())) return d1;

  // try dd/mm/yyyy hh:mm
  const m = raw.match(
    /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ ,T]+(\d{2}):(\d{2}))?$/
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "00", min = "00"] = m;
    // use local time; adjust if you prefer UTC:
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

/* --------------- POST /api/calls --------------- */
export async function POST(req: Request) {
  try {
    const body: any = await readBody(req);

    // required: existing? (yes/no)
    const isExisting =
      toBool(body.isExistingCustomer ?? body.existingCustomer ?? body.existing);
    if (isExisting === null) {
      return NextResponse.json(
        { error: "Please choose if this is an existing customer." },
        { status: 400 }
      );
    }

    // required: sales rep (staff)
    const staff = String(body.salesRep ?? body.staff ?? "").trim();
    if (!staff) {
      return NextResponse.json(
        { error: "Sales Rep is required." },
        { status: 400 }
      );
    }

    // required: summary
    const summary = String(body.summary ?? "").trim();
    if (!summary) {
      return NextResponse.json(
        { error: "Summary is required." },
        { status: 400 }
      );
    }

    // if existing, we need a valid customerId (cuid)
    let customerId: string | null = null;
    if (isExisting) {
      // prefer explicit field, otherwise fall back to "customer"
      const candidate = String(
        body.customerId ?? body.customer ?? ""
      ).trim();

      if (!candidate || !isCuid(candidate)) {
        return NextResponse.json(
          {
            error:
              "Pick a customer from the list (don’t type free text) so we can attach the call to the account.",
          },
          { status: 400 }
        );
      }
      customerId = candidate;
    }

    // optional fields
    const callType = body.callType ? String(body.callType) : null;
    const outcome = body.outcome ? String(body.outcome) : null;
    const followUpAt = parseFollowUp(
      body.followUpAt ?? body.followUp ?? body.followupAt
    );

    // if NOT existing, keep a small lead snapshot (optional)
    const customerName =
      !isExisting && body.customerName ? String(body.customerName) : null;
    const contactPhone =
      !isExisting && body.contactPhone ? String(body.contactPhone) : null;
    const contactEmail =
      !isExisting && body.contactEmail ? String(body.contactEmail) : null;

    const created = await prisma.callLog.create({
      data: {
        isExistingCustomer: !!isExisting,
        customerId,
        customerName,
        contactPhone,
        contactEmail,
        callType,
        summary,
        outcome,
        staff,
        followUpRequired: !!followUpAt,
        followUpAt,
      },
      select: { id: true, customerId: true },
    });

    return NextResponse.json(
      {
        ok: true,
        id: created.id,
        customerId: created.customerId,
        redirectTo: created.customerId ? `/customers/${created.customerId}` : null,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Create call error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

/* --------------- GET /api/calls?customerId=... --------------- */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId") || undefined;

  const calls = await prisma.callLog.findMany({
    where: { ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(calls);
}
