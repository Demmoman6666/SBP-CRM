// app/api/settings/brand-visibility/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

/* ---------- tiny auth helpers (mirror middleware token) ---------- */
type TokenPayload = { userId: string; exp: number };

function b64urlToBuf(s: string): Buffer {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? "====".slice(norm.length % 4) : "";
  return Buffer.from(norm + pad, "base64");
}

function bufToB64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto.createHmac("sha256", secret).update(b64urlToBuf(payloadB64)).digest();
  if (bufToB64url(expected) !== sigB64) return null;

  try {
    const json = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function currentUser(req: NextRequest) {
  const tok = req.cookies.get(COOKIE_NAME)?.value;
  const payload = verifyToken(tok);
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, fullName: true },
  });
}

/* ---------- helpers ---------- */
type Kind = "stocked" | "competitor";
function kindFromReq(req: NextRequest): Kind {
  const t = (req.nextUrl.searchParams.get("type") || "stocked").toLowerCase();
  return t === "competitor" ? "competitor" : "stocked";
}

/* ================================================================
   GET /api/settings/brand-visibility?type=stocked|competitor
   Anyone signed-in may read the list; PATCH below is admin-only.
================================================================ */
export async function GET(req: NextRequest) {
  // (Auth is enforced by middleware; we don't hard-fail here to avoid false negatives.)
  const type = kindFromReq(req);

  if (type === "stocked") {
    const rows = await prisma.stockedBrand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, visibleInCallLog: true },
    });
    return NextResponse.json({ rows });
  }

  const rows = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true },
  });
  return NextResponse.json({ rows });
}

/* ================================================================
   PATCH /api/settings/brand-visibility?type=stocked|competitor
   Body: { id: string, visible: boolean }
   Admin only.
================================================================ */
export async function PATCH(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type = kindFromReq(req);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body?.id || "");
  const visible = body?.visible;
  if (!id || typeof visible !== "boolean") {
    return NextResponse.json({ error: "id and visible are required" }, { status: 400 });
  }

  try {
    if (type === "stocked") {
      const updated = await prisma.stockedBrand.update({
        where: { id },
        data: { visibleInCallLog: visible },
        select: { id: true, name: true, visibleInCallLog: true },
      });
      return NextResponse.json(updated);
    } else {
      const updated = await prisma.brand.update({
        where: { id },
        data: { visibleInCallLog: visible },
        select: { id: true, name: true, visibleInCallLog: true },
      });
      return NextResponse.json(updated);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 400 });
  }
}
