// app/api/google/calendar/create-event/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createCalendarEvent } from "@/lib/google";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };
function verifyToken(token?: string | null): TokenPayload | null {
  try {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [p, sig] = parts;
    const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
    const expected = crypto.createHmac("sha256", secret).update(p).digest("base64url");
    if (expected !== sig) return null;
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  const body: any = ct.includes("application/json") ? await req.json().catch(() => ({})) : {};

  const startIso = String(body.startIso || body.start || "");
  const endIso = String(body.endIso || body.end || "");
  const summary = String(body.summary || "Follow-up");
  const description = String(body.description || "");
  const timezone = String(body.timezone || "Europe/London");
  const attendees = Array.isArray(body.attendees) ? body.attendees : undefined;

  if (!startIso) {
    return NextResponse.json({ error: "startIso is required (RFC3339)" }, { status: 400 });
  }

  let end = endIso;
  if (!end) {
    const startMs = Date.parse(startIso);
    end = isFinite(startMs) ? new Date(startMs + 30 * 60 * 1000).toISOString() : "";
  }

  try {
    const ev = await createCalendarEvent(sess.userId, {
      summary, description, startIso, endIso: end, timezone, attendees,
    });
    return NextResponse.json({ ok: true, event: ev });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create event" }, { status: 400 });
  }
}
