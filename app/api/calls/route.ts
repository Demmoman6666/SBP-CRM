// app/api/calls/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent } from "@/lib/google";
import { getCurrentUser } from "@/lib/auth";

type Stage = "LEAD" | "APPOINTMENT_BOOKED" | "SAMPLING" | "CUSTOMER";

function normalizeStage(input: unknown): Stage | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/[_-]+/g, " ");
  switch (s) {
    case "lead": return "LEAD";
    case "appointment booked":
    case "appointmentbooked": return "APPOINTMENT_BOOKED";
    case "sampling": return "SAMPLING";
    case "customer": return "CUSTOMER";
    default: return null;
  }
}

/* ---------------- calendar helper ---------------- */
async function maybeCreateFollowUpEvent(saved: {
  id: string;
  summary: string | null;
  customerName: string | null;
  followUpRequired: boolean;
  followUpAt: Date | null;
}) {
  try {
    if (!saved.followUpRequired || !saved.followUpAt) return;

    const me = await getCurrentUser();
    if (!me) return;

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true, fullName: true, email: true,
        googleAccessToken: true, googleRefreshToken: true,
        googleTokenExpiresAt: true, googleCalendarId: true,
      },
    });
    if (!user?.googleAccessToken) return;

    const start = new Date(saved.followUpAt);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const title = `Follow-up: ${saved.customerName ?? "Customer"}`;
    const description =
      (saved.customerName ? `Customer: ${saved.customerName}\n` : "") +
      (saved.summary ? `\nNotes:\n${saved.summary}` : "");

    await createCalendarEvent(me.id, {
      summary: title,
      description,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: user.email ? [{ email: user.email, displayName: user.fullName || undefined }] : [],
    });
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
  try { return await req.json(); } catch {}
  try { const text = await req.text(); return Object.fromEntries(new URLSearchParams(text)); } catch {}
  return {};
}

const toBool = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  return ["1", "true", "yes", "on"].includes(s);
};

const isCuid = (s: string) => /^c[a-z0-9]{24,}$/i.test(s);

const toNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Accepts:
 *  - 2025-08-29T21:02
 *  - 29/08/2025 21:02
 *  - 29/08/2025, 21:02
 *  - 29-08-2025 21:02
 */
function parseFollowUp(val: unknown): Date | null {
  if (!val) return null;
  const raw = String(val).trim();
  const d1 = new Date(raw);
  if (!isNaN(d1.getTime())) return d1;
  const m = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ ,T]+(\d{2}):(\d{2}))?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", min = "00"] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

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

/* HH:mm -> minutes since midnight */
function hhmmToMinutes(v: unknown): number {
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return NaN;
  return h * 60 + min;
}
/* Combine an anchor date with HH:mm to a Date */
function combineDateTime(anchor: Date, hhmm: string): Date {
  const [hh, mm] = hhmm.split(":").map((n) => Number(n));
  const d = new Date(anchor);
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

/* ensure value is always an array (string -> [string]) */
function toArr<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/* --------------- POST /api/calls --------------- */
export async function POST(req: Request) {
  try {
    const body: any = await readBody(req);

    const isExisting = toBool(body.isExistingCustomer ?? body.existingCustomer ?? body.existing);
    if (isExisting === null) {
      return NextResponse.json({ error: "Please choose if this is an existing customer." }, { status: 400 });
    }

    const staff = String(body.salesRep ?? body.staff ?? "").trim();
    if (!staff) {
      return NextResponse.json({ error: "Sales Rep is required." }, { status: 400 });
    }

    const summary = String(body.summary ?? "").trim();
    if (!summary) {
      return NextResponse.json({ error: "Summary is required." }, { status: 400 });
    }

    // ⛔️ HARD REQUIREMENT: geolocation must be present
    const latitude  = toNum(body.latitude ?? body.lat ?? body.coords?.latitude);
    const longitude = toNum(body.longitude ?? body.lng ?? body.coords?.longitude);
    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: "Location is required to log a call." }, { status: 400 });
    }
    const accuracyM = toNum(body.accuracyM ?? body.accuracy ?? body.coords?.accuracy);
    const geoCollectedAt =
      body.geoCollectedAt ? new Date(String(body.geoCollectedAt)) : new Date();

    // required times + compute duration (allow across midnight)
    const startHHMM = String(body.startTime ?? body.start ?? "").trim();
    const endHHMM   = String(body.endTime ?? body.finishTime ?? body.finish ?? "").trim();
    if (!startHHMM || !endHHMM) {
      return NextResponse.json({ error: "Start Time and Finish Time are required." }, { status: 400 });
    }
    const sMin = hhmmToMinutes(startHHMM);
    const eMin = hhmmToMinutes(endHHMM);
    if (!Number.isFinite(sMin) || !Number.isFinite(eMin)) {
      return NextResponse.json({ error: "Invalid Start/Finish time." }, { status: 400 });
    }
    let durationMinutes = eMin - sMin;
    if (durationMinutes <= 0) durationMinutes += 24 * 60; // wrap past midnight
    durationMinutes = Math.max(1, Math.round(durationMinutes));

    const stageProvided = normalizeStage(body.stage ?? body.customerStage ?? body.stageValue);

    // existing customer must have valid id
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
    const outcome  = body.outcome ? String(body.outcome) : null;
    const followUpAt = parseFollowUp(body.followUpAt ?? body.followUp ?? body.followupAt);

    // derive appointment flag
    const appointmentBooked =
      outcome === "Appointment booked" ||
      callType === "Booked Call" ||
      stageProvided === "APPOINTMENT_BOOKED";

    // Use client-provided logged time as the anchor day if present, else now.
    const clientLoggedAtRaw = body.clientLoggedAt ? new Date(String(body.clientLoggedAt)) : null;
    const hasClientLoggedAt = !!(clientLoggedAtRaw && !isNaN(clientLoggedAtRaw.getTime()));
    const anchor = hasClientLoggedAt ? clientLoggedAtRaw! : new Date();

    // Build DateTime values for start/end from HH:mm + anchor day
    const startTime = combineDateTime(anchor, startHHMM);
    let endTime = combineDateTime(anchor, endHHMM);
    if (endTime <= startTime) {
      // across midnight -> next day
      endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
    }

    // For non-existing, capture the free-typed customer name
    const leadCustomerName = !isExisting ? (String(body.customer ?? "").trim() || null) : null;

    // Lookup display name for existing customer (nice for calendar)
    let displayCustomerName: string | null = leadCustomerName;
    if (isExisting && customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { salonName: true, customerName: true },
      });
      displayCustomerName = cust?.salonName || cust?.customerName || null;
    }

    // Normalize multi-selects so .map() is always safe
    const stockedBrandIds = toArr<string>(body.stockedBrandIds ?? body.stocked ?? body.stockedBrands).filter(Boolean);
    const competitorBrandIds = toArr<string>(body.competitorBrandIds ?? body.competitors ?? body.competitorBrands).filter(Boolean);

    const created = await prisma.callLog.create({
      data: {
        isExistingCustomer: !!isExisting,
        customerId,
        customerName: leadCustomerName,
        contactPhone: !isExisting && body.contactPhone ? String(body.contactPhone) : null,
        contactEmail: !isExisting && body.contactEmail ? String(body.contactEmail) : null,
        callType,
        summary,
        outcome,
        staff,
        stage: stageProvided ?? undefined,
        followUpRequired: !!followUpAt,
        followUpAt,

        // times & derived metrics
        startTime,
        endTime,
        durationMinutes,
        appointmentBooked,

        // ✅ persist geolocation
        latitude,
        longitude,
        accuracyM: accuracyM != null ? Math.round(accuracyM) : null,
        geoCollectedAt,

        ...(hasClientLoggedAt ? { createdAt: anchor } : {}),

        // ✅ optional join-table links (safe whether string or array came in)
        ...(stockedBrandIds.length
          ? {
              stockedBrandLinks: {
                create: stockedBrandIds.map((brandId) => ({ brandId: String(brandId) })),
              },
            }
          : {}),
        ...(competitorBrandIds.length
          ? {
              competitorBrandLinks: {
                create: competitorBrandIds.map((brandId) => ({ brandId: String(brandId) })),
              },
            }
          : {}),
      },
      select: { id: true, customerId: true },
    });

    if (stageProvided && customerId) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { stage: stageProvided },
      });
    }

    await maybeCreateFollowUpEvent({
      id: created.id,
      summary,
      customerName: displayCustomerName,
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
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

/* --------------- GET /api/calls (filterable) --------------- */
export async function GET(req: Request) {
  // 🔒 Robustly construct URL so searchParams is always present
  let url: URL;
  try {
    // In very rare cases req.url can be empty/undefined in some runtimes
    const raw = (req as any)?.url;
    url = typeof raw === "string" && raw ? new URL(raw) : new URL("http://local.invalid/");
  } catch {
    url = new URL("http://local.invalid/");
  }
  const searchParams = url.searchParams ?? new URLSearchParams();

  const from = parseDateStart(searchParams.get("from"));
  const to   = parseDateEnd(searchParams.get("to"));

  const callType   = searchParams.get("callType") || undefined;
  const outcome    = searchParams.get("outcome") || undefined;
  const staff      = searchParams.get("staff") || undefined;
  const customerId = searchParams.get("customerId") || undefined;

  const stageParam  = searchParams.get("stage");
  const stageFilter = stageParam ? normalizeStage(stageParam) : null;

  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);

  const where: any = { ...(customerId ? { customerId } : {}) };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to)   where.createdAt.lte = to;
  }
  if (callType)   where.callType = callType;
  if (outcome)    where.outcome  = outcome;
  if (staff)      where.staff    = staff;
  if (stageFilter) where.stage   = stageFilter;

  const calls = await prisma.callLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      customer: { select: { salonName: true, customerName: true } },
    },
  });

  return NextResponse.json(calls);
}
