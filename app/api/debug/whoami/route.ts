// app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

type VerifyFail =
  | "NoCookie"
  | "BadFormat"
  | "BadToken"
  | "Expired"
  | "BadJSON"
  | "BadPayload";

function verifyTokenVerbose(
  token?: string | null
):
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: VerifyFail } {
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
    const payload = JSON.parse(
      Buffer.from(payloadB64url, "base64url").toString()
    ) as TokenPayload;

    if (!payload?.userId || typeof payload.exp !== "number") {
      return { ok: false, reason: "BadPayload" };
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: "Expired" };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "BadJSON" };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = url.host;
  const tok = cookies().get(COOKIE_NAME)?.value;
  const v = verifyTokenVerbose(tok);

  // no-store to avoid any proxy/browser caching
  const headers = {
    "Cache-Control": "no-store, max-age=0",
  } as const;

  if (v.ok !== true) {
    const reason = (v as { ok: false; reason: VerifyFail }).reason;
    return NextResponse.json(
      {
        ok: false,
        host,
        hasCookie: Boolean(tok),
        reason,
        hint:
          reason === "NoCookie"
            ? "Not signed in on this hostname. Visit /login here."
            : reason === "Expired" || reason === "BadToken"
            ? "Session cookie is invalid or expired. POST /api/logout then sign in again on this hostname."
            : undefined,
      },
      { headers }
    );
  }

  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!me) {
    return NextResponse.json(
      { ok: false, host, reason: "BadPayload", detail: "User not found" },
      { headers }
    );
  }

  return NextResponse.json(
    { ok: true, host, me, payload: v.payload },
    { headers }
  );
}
