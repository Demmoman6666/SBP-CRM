// app/api/calls/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createGoogleCalendarEvent } from "@/lib/google";

export const dynamic = "force-dynamic";

/* ---------------- google helper ---------------- */
const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(p).digest("base64url");
  if (expected !== sig) return null;

  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function currentUserIdFromCookie() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const s = verifyToken(tok);
  return s?.userId ?? null;
}

async function maybeCreateFollowUpEvent(saved: {
  id: string;
  summary: string | null;
  customerName: string | null;
  followUpRequired: boolean;
  followUpAt: Date | null;
}) {
  try {
    if (!saved.followUpRequired || !saved.followUpAt) return;

    const userId = await currentUserIdFromCookie();
    if (!userId) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
    if (!user?.googleAccessToken) return; // user hasn't connected Google

    const start = new Date(saved.followUpAt);
    const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 minutes
    const summary =
      saved.summary?.trim() || `Follow-up: ${saved.customerName ?? "Customer"}`;
    const description =
      `CRM follow-up for ${saved.customerName ?? "customer"}` +
      (saved.summary ? `\n\nNotes: ${saved.summary}` : "");

    const evt = await createGoogleCalendarEvent({
      userId: user.id,
      calendarId: user.googleCalendarId || "primary",
      summary,
      description,
      start,
      end,
      attendees: user.email
        ? [{ email: user.email, displayName: user.fullName || undefined }]
        : [],
    });

    // If you later add a googleEventId column to CallLog, persist it:
    // await prisma.callLog.update({ where: { id: saved.id }, data: { googleEventId: evt.id } });
  } catch (err) {
    // Never block the request if Calendar fails — just log.
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
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
    const d2 = new Date(iso);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

/* date filter helpers for GET */
function parseDateStart(raw?: string | null): Date | null {
  if (!raw) return null;
  // if just yyyy-mm-dd, anchor to 00:00
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

    // allow client timestamp (not required)
    const clientLoggedAt = body.clientLoggedAt ? new Date(String(body.clientLoggedAt)) : null;

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
        ...(clientLoggedAt && !isNaN(clientLoggedAt.getTime())
          ? { createdAt: clientLoggedAt }
          : {}),
      },
      select: { id: true, customerId: true },
    });

    // 🔔 After-save: try to create the Google Calendar event if applicable
    await maybeCreateFollowUpEvent({
      id: created.id,
      summary,
      customerName,
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
/**
 * Query params:
 *  - from=yyyy-mm-dd (or ISO)
 *  - to=yyyy-mm-dd   (or ISO)
 *  - callType=Cold Call|Booked Call|Booked Demo
 *  - outcome=Sale|No Sale|Appointment booked|Demo Booked
 *  - staff=<rep name>
 *  - customerId=<cuid> (optional)
 *  - limit=number (default 100, max 200)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const from = parseDateStart(searchParams.get("from"));
  const to   = parseDateEnd(searchParams.get("to"));

  const callType = searchParams.get("callType") || undefined;
  const outcome  = searchParams.get("outcome") || undefined;
  const staff    = searchParams.get("staff") || undefined;
  const customerId = searchParams.get("customerId") || undefined;

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
