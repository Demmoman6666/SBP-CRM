// lib/session.ts
import crypto from "crypto";
import { NextResponse } from "next/server";

export const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };

// Require AUTH_SECRET everywhere (no silent fallback)
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) {
  throw new Error("AUTH_SECRET is not set — add it in Vercel env (Preview & Prod) and redeploy.");
}

function b64urlFromJSON(json: any) {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

export function signToken(payload: TokenPayload): string {
  const p = b64urlFromJSON(payload);
  const sig = crypto.createHmac("sha256", SECRET!).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export type VerifyFail = "NoCookie" | "BadFormat" | "BadToken" | "Expired" | "BadPayload";

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
    if (!json?.userId || typeof json.exp !== "number") return { ok: false, reason: "BadPayload" };
    if (json.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "Expired" };
    return { ok: true, payload: json };
  } catch {
    return { ok: false, reason: "BadFormat" };
  }
}

export function setSessionCookie(res: NextResponse, token: string, maxAgeSeconds: number) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
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

// Back-compat helper if any old code imports this name
export function createSessionToken(userId: string, maxAgeSeconds: number) {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  return signToken({ userId, exp });
}
