// lib/session.ts
import crypto from "crypto";
import { NextResponse } from "next/server";

export const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };

// Require AUTH_SECRET for both sign & verify (no silent fallback)
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) {
  throw new Error("AUTH_SECRET is not set — add it in Vercel env (Preview & Prod) and redeploy.");
}

function b64url(json: any) {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

export function signToken(payload: TokenPayload): string {
  const p = b64url(payload);
  const sig = crypto.createHmac("sha256", SECRET!).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export type VerifyFail = "NoCookie" | "BadFormat" | "BadToken" | "Expired";

export function verifyTokenVerbose(
  token?: string | null
): { ok: true; payload: TokenPayload } | { ok: false; reason: VerifyFail } {
  if (!token) return { ok: false, reason: "NoCookie" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "BadFormat" };
  const [p, sig] = parts;

  const expected = crypto.createHmac("sha256", SECRET!).update(p).digest("base64url");
  if (expected !== sig) return { ok: false, reason: "BadToken" };

  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return { ok: false, reason: "BadFormat" };
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "Expired" };
    return { ok: true, payload: json };
  } catch {
    return { ok: false, reason: "BadFormat" };
  }
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14, // 14 days
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
