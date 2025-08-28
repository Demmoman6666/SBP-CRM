// lib/session.ts
import crypto from "crypto";
import { NextResponse } from "next/server";

export const COOKIE_NAME = "sbp_session";

export type TokenPayload = { userId: string; exp: number };
export type VerifyFail = "NoCookie" | "BadFormat" | "BadToken" | "Expired";

// Require AUTH_SECRET for both sign & verify (no silent fallback)
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) {
  throw new Error("AUTH_SECRET is not set — add it in Vercel env (Preview & Prod) and redeploy.");
}

/* ---------------- base64url helpers ---------------- */
function b64urlEncodeJSON(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function b64urlDecodeToString(s: string) {
  return Buffer.from(s, "base64url").toString();
}

/* ---------------- token creation ---------------- */
export function signToken(payload: TokenPayload): string {
  const p = b64urlEncodeJSON(payload);                           // base64url(JSON)
  const sig = crypto.createHmac("sha256", SECRET!).update(p).digest("base64url"); // HMAC over *p*
  return `${p}.${sig}`;
}

/** Convenience: create a token that expires in `maxAgeSeconds`. */
export function createSessionToken(userId: string, maxAgeSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  return signToken({ userId, exp });
}

/* ---------------- token verification ---------------- */
export function verifyTokenVerbose(
  token?: string | null
): { ok: true; payload: TokenPayload } | { ok: false; reason: VerifyFail } {
  if (!token) return { ok: false, reason: "NoCookie" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "BadFormat" };
  const [p, sig] = parts;

  // Must HMAC the base64url payload string (same bytes as signToken)
  const expected = crypto.createHmac("sha256", SECRET!).update(p).digest("base64url");
  if (expected !== sig) return { ok: false, reason: "BadToken" };

  try {
    const json = JSON.parse(b64urlDecodeToString(p)) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return { ok: false, reason: "BadFormat" };
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "Expired" };
    return { ok: true, payload: json };
  } catch {
    return { ok: false, reason: "BadFormat" };
  }
}

/** Simple helper: returns payload or null. */
export function verifyToken(token?: string | null): TokenPayload | null {
  const v = verifyTokenVerbose(token);
  return (v as any).ok ? (v as any).payload : null;
}

/* ---------------- cookie helpers ---------------- */
export function setSessionCookie(res: NextResponse, token: string, maxAgeSeconds?: number) {
  // If maxAge not provided, infer from token.exp (fallback 14d)
  let maxAge = maxAgeSeconds;
  if (maxAge == null) {
    const v = verifyTokenVerbose(token);
    if ((v as any).ok) {
      const exp = (v as any).payload.exp as number;
      maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000));
    } else {
      maxAge = 60 * 60 * 24 * 14;
    }
  }

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
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
