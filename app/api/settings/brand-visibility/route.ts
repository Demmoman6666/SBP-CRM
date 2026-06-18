import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

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
  } catch { return null; }
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

export async function GET(req: NextRequest) {
  const type = (req.nextUrl.searchParams.get("type") || "stocked").toLowerCase();
  if (type === "stocked") {
    const rows = await prisma.stockedBrand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, visibleInCallLog: true, visibleInReports: true },
    });
    return NextResponse.json({ rows });
  }
  const rows = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true },
  });
  return NextResponse.json({ rows });
}

export async function PATCH(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const type = (req.nextUrl.searchParams.get("type") || "stocked").toLowerCase();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: any = {};
  if (typeof body.visible === "boolean") data.visibleInCallLog = body.visible;
  if (typeof body.visibleInCallLog === "boolean") data.visibleInCallLog = body.visibleInCallLog;
  if (typeof body.visibleInReports === "boolean") data.visibleInReports = body.visibleInReports;

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    if (type === "stocked") {
      const updated = await prisma.stockedBrand.update({
        where: { id },
        data,
        select: { id: true, name: true, visibleInCallLog: true, visibleInReports: true },
      });
      return NextResponse.json(updated);
    } else {
      const updated = await prisma.brand.update({
        where: { id },
        data: { visibleInCallLog: data.visibleInCallLog ?? undefined },
        select: { id: true, name: true, visibleInCallLog: true },
      });
      return NextResponse.json(updated);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 400 });
  }
}
