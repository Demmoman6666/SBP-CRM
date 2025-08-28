// app/api/auth/logout/route.ts
import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "sbp_session";

function clearCookie(res: NextResponse, name: string) {
  // Clear by expiring (works across all browsers/edges)
  res.cookies.set(name, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearCookie(res, COOKIE_NAME);
  clearCookie(res, "sbp_email"); // legacy helper cookie (if present)
  return res;
}

// (Optional) allow GET so you can hit /api/auth/logout directly in the address bar
export const GET = POST;
