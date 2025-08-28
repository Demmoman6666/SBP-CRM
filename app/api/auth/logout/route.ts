// app/api/auth/logout/route.ts
import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "sbp_session";

function clearCookie(res: NextResponse, name: string) {
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
  clearCookie(res, "sbp_email");
  return res;
}

export const GET = POST;
