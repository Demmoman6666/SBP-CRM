// app/api/calls/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/google";
import { getCurrentUser } from "@/lib/auth";

// Accepted stage literals (must match Prisma enum)
type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

function normalizeStage(input: unknown): Stage | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/[_-]+/g, " ");
  switch (s) {
    case "lead":
      return "LEAD";
    case "appointment booked":
    case "appointmentbooked":
      return "APPOINTMENT_BOOKED";
    case "sampling":
      return "SAMPLING";
    case "customer":
      return "CUSTOMER";
    default:
      return null;
  }
}

/* ---------------- calendar helper ---------------- */
async function maybeCreateFollowUpEvent(saved: {
  id: string;
  summary: string | null;        // notes from the call
  customerName: string | null;   // display name for the event
  followUpRequired: boolean;
  followUpAt: Date | null;
}) {
  try {
    if (!saved.followUpRequired || !saved.followUpAt) return;

    const me = await getCurrentUser();
    if (!me) {
      console.log("[calendar] skip: no authenticated user");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiresAt: true,
        googleCalendarId: true,
      },
    });
    if (!user?.googleAccessToken) {
      console.log("[calendar] skip: user has not connected Google", { userId: me.id });
      return;
    }

    const start = new Date(saved.followUpAt);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 minutes

    const title = `Follow-up: ${saved.customerName ?? "Customer"}`;
    const description =
      (saved.customerName ? `Customer: ${saved.customerName}\n` : "") +
      (saved.summary ? `\nNotes:\n${saved.summary}` : "");

    console.log("[calendar] creating event", {
      userId: me.id,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      title,
    });

    await createCalendarEvent(me.id, {
      summary: title,
      description,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: user.email
        ? [{ email: user.email, displayName: user.fullName || undefined }]
        : [],
    });

    console.log("[calendar] event created for call", saved.id);
  } catch (err) {
    console.error("Calendar event create failed (non-fatal):", err);
  }
}

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

/** Accepts common inputs:
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
  const m = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ ,T]+(\d{2}):(\d{2}))?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", min = "00"] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

/* date filter helpers for GET */
function parseDateStart(raw?: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
function parseDateEnd(raw?: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999`);
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
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

    // required: summary (notes)
    const summary = String(body.summary ?? "").trim();
    if (!summary) {
      return NextResponse.json(
        { error: "Summary is required." },
        { status: 400 }
      );
    }

    // stage (optional, but validated)
    const stageProvided = normalizeStage(body.stage ?? body.customerStage ?? body.stageValue);

    // if existing, we need a valid customerId (cuid)
    let customerId: string | null = null;
    if (isExisting) {
      const candidate = String(body.customerId ?? body.customer ?? "").trim();
      if (!candidate || !isCuid(candidate)) {
        return NextResponse.json(
          { error: "Pick a customer from the list (don’t type free text) so we can attach the call to the account." },
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

    // allow client timestamp (not required)
    const clientLoggedAt = body.clientLoggedAt ? new Date(String(body.clientLoggedAt)) : null;

    // if NOT existing, keep a small lead snapshot (optional)
    const leadCustomerName =
      !isExisting && body.customerName ? String(body.customerName) : null;

    // For existing customers, look up a display name to use as event title
    let displayCustomerName: string | null = leadCustomerName;
    if (isExisting && customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { salonName: true, customerName: true },
      });
      displayCustomerName = cust?.salonName || cust?.customerName || null;
    }

    const created = await prisma.callLog.create({
      data: {
        isExistingCustomer: !!isExisting,
        customerId,
        customerName: leadCustomerName, // stores typed name for non-existing
        contactPhone: !isExisting && body.contactPhone ? String(body.contactPhone) : null,
        contactEmail: !isExisting && body.contactEmail ? String(body.contactEmail) : null,
        callType,
        summary,
        outcome,
        staff,
        stage: stageProvided ?? undefined, // NEW: capture stage on the call
        followUpRequired: !!followUpAt,
        followUpAt,
        ...(clientLoggedAt && !isNaN(clientLoggedAt.getTime())
          ? { createdAt: clientLoggedAt }
          : {}),
      },
      select: { id: true, customerId: true },
    });

    // If a stage was provided and this is an existing customer, update their current stage
    if (stageProvided && customerId) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { stage: stageProvided },
      });
    }

    // After-save: try to create the Google Calendar event if applicable
    await maybeCreateFollowUpEvent({
      id: created.id,
      summary, // notes
      customerName: displayCustomerName, // title source
      followUpRequired: !!followUpAt,
      followUpAt,
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

/* --------------- GET /api/calls (filterable) --------------- */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const from = parseDateStart(searchParams.get("from"));
  const to   = parseDateEnd(searchParams.get("to"));

  const callType = searchParams.get("callType") || undefined;
  const outcome  = searchParams.get("outcome") || undefined;
  const staff    = searchParams.get("staff") || undefined;
  const customerId = searchParams.get("customerId") || undefined;

  // NEW: filter by stage if provided (accepts human or enum forms)
  const stageParam = searchParams.get("stage");
  const stageFilter = stageParam ? normalizeStage(stageParam) : null;

  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);

  const where: any = { ...(customerId ? { customerId } : {}) };

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to)   where.createdAt.lte = to;
  }
  if (callType) where.callType = callType;
  if (outcome)  where.outcome  = outcome;
  if (staff)    where.staff    = staff;
  if (stageFilter) where.stage = stageFilter;

  const calls = await prisma.callLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      customer: {
        select: { salonName: true, customerName: true }
      }
    }
  });

  return NextResponse.json(calls);
}
