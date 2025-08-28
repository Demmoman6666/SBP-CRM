// app/api/auth/logout/route.ts
import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

function clearCookie(res: NextResponse, name: string) {
  // Expire immediately; no domain on purpose so it clears on this exact host.
  res.cookies.set(name, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // true on Vercel previews & prod
    maxAge: 0,
  });
}

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Cache-Control", "no-store");
  clearCookie(res, COOKIE_NAME);
  clearCookie(res, "sbp_email"); // legacy helper cookie (safe to remove if unused)
  return res;
}

// Optional GET so you can hit /api/auth/logout in the address bar
export const GET = POST;
