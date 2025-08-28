// app/api/settings/brand-visibility/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };
function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64url, sigB64url] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64url)
    .digest("base64url");

  if (expected !== sigB64url) return null;
  try {
    const json = JSON.parse(Buffer.from(payloadB64url, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function requireAdmin() {
  const token = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(token);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const me = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { role: true },
  });
  if (!me || me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const };
}

// GET ?type=stocked|competitor -> list all brands with their current flag
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = (url.searchParams.get("type") || "").toLowerCase();

  if (type !== "stocked" && type !== "competitor") {
    return NextResponse.json({ error: "type must be 'stocked' or 'competitor'" }, { status: 400 });
  }

  if (type === "stocked") {
    const items = await prisma.stockedBrand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, visibleInCallLog: true },
    });
    return NextResponse.json({ type, items });
  }

  const items = await prisma.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, visibleInCallLog: true },
  });
  return NextResponse.json({ type, items });
}

// PATCH { type: 'stocked'|'competitor', ids: string[] } -> sets the visible set
export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type: string = String(body?.type || "").toLowerCase();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];

  if (type !== "stocked" && type !== "competitor") {
    return NextResponse.json({ error: "type must be 'stocked' or 'competitor'" }, { status: 400 });
  }

  if (type === "stocked") {
    await prisma.$transaction([
      prisma.stockedBrand.updateMany({ data: { visibleInCallLog: false } }),
      ...(ids.length
        ? [prisma.stockedBrand.updateMany({ where: { id: { in: ids } }, data: { visibleInCallLog: true } })]
        : []),
    ]);
    return NextResponse.json({ ok: true, type, count: ids.length });
  }

  await prisma.$transaction([
    prisma.brand.updateMany({ data: { visibleInCallLog: false } }),
    ...(ids.length
      ? [prisma.brand.updateMany({ where: { id: { in: ids } }, data: { visibleInCallLog: true } })]
      : []),
  ]);
  return NextResponse.json({ ok: true, type, count: ids.length });
}
