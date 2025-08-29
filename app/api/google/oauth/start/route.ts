// app/api/google/oauth/start/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getAuthUrl } from "@/lib/google";

// minimal cookie token verifier (matches your signed cookie shape)
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
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // require logged-in user
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return NextResponse.redirect(new URL("/login", req.url));

  // CSRF state
  const state = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.redirect(getAuthUrl(req.nextUrl.origin, state));
  res.cookies.set("gc_oauth_state", state, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
  });
  // stash who initiated (helps callback)
  res.cookies.set("gc_user", sess.userId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
  });
  return res;
}
