// app/api/admin/backfill-customer-stages/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

/* ---- auth (same pattern you use in /api/users) ---- */
type BadReason = "NoCookie" | "BadFormat" | "BadToken" | "Expired";
type TokenCheck =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: BadReason };

function verifyTokenVerbose(token?: string | null): TokenCheck {
  if (!token) return { ok: false, reason: "NoCookie" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "BadFormat" };
  const [payloadB64url, sigB64url] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64url)
    .digest("base64url");
  if (expected !== sigB64url) return { ok: false, reason: "BadToken" };

  try {
    const payload = JSON.parse(Buffer.from(payloadB64url, "base64url").toString()) as TokenPayload;
    if (!payload?.userId || typeof payload.exp !== "number") return { ok: false, reason: "BadToken" };
    if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "Expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "BadToken" };
  }
}

async function requireAdmin() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const v = verifyTokenVerbose(tok);
  if (!v.ok) {
    const reason = "reason" in v ? v.reason : "BadToken";
    return { error: NextResponse.json({ error: "Unauthorized", reason }, { status: 401 }) };
  }
  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: { role: true, isActive: true },
  });
  if (!me || !me.isActive || me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: v.payload.userId };
}

/* ---- GET = preview count (how many would be updated) ---- */
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(`
    SELECT COUNT(*)::int AS count
    FROM "Customer" c
    WHERE c."stage" <> 'CUSTOMER'
      AND EXISTS (
        SELECT 1 FROM "Order" o
        WHERE o."customerId" = c."id"
          AND (o."processedAt" IS NOT NULL OR o."total" IS NOT NULL)
      )
  `);

  const count = rows?.[0]?.count ?? 0;
  return NextResponse.json({ wouldUpdate: count });
}

/* ---- POST = perform the backfill ---- */
export async function POST() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Customer" c
    SET "stage" = 'CUSTOMER'
    WHERE c."stage" <> 'CUSTOMER'
      AND EXISTS (
        SELECT 1 FROM "Order" o
        WHERE o."customerId" = c."id"
          AND (o."processedAt" IS NOT NULL OR o."total" IS NOT NULL)
      )
  `);

  return NextResponse.json({ updated });
}
