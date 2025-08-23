// app/api/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* helpers */
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

const toDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

/* -----------------------------
   POST /api/calls
   Save a call log (JSON or Form)
------------------------------ */
export async function POST(req: Request) {
  try {
    const body: any = await readBody(req);

    // required fields
    const isExisting = toBool(body.isExistingCustomer);
    if (isExisting === null)
      return NextResponse.json({ error: "Please choose if this is an existing customer." }, { status: 400 });

    const staff = (body.salesRep || body.staff || "").toString().trim();
    if (!staff)
      return NextResponse.json({ error: "Sales Rep is required." }, { status: 400 });

    const summary = (body.summary || "").toString().trim();
    if (!summary)
      return NextResponse.json({ error: "Summary is required." }, { status: 400 });

    // if existing, need a customerId
    let customerId: string | null = null;
    if (isExisting) {
      customerId = (body.customerId || body.customer || "").toString().trim() || null;
      if (!customerId)
        return NextResponse.json({ error: "Pick a customer from the list." }, { status: 400 });
    }

    // optional fields
    const callType = body.callType ? String(body.callType) : null;
    const outcome  = body.outcome ? String(body.outcome) : null;
    const followUpAt = toDate(body.followUpAt);

    // lead-style snapshot if NOT existing (optional, extend if you wish)
    const customerName  = !isExisting && body.customerName ? String(body.customerName) : null;
    const contactPhone  = !isExisting && body.contactPhone ? String(body.contactPhone) : null;
    const contactEmail  = !isExisting && body.contactEmail ? String(body.contactEmail) : null;

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

    // return JSON (client page can redirect to the customer if we have one)
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
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/* -----------------------------
   GET /api/calls?customerId=...
   (optional listing for debugging)
------------------------------ */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");

  const where = customerId ? { customerId } : {};
  const calls = await prisma.callLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(calls);
}
