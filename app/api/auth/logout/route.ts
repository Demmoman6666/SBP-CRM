// app/api/auth/logout/route.ts
import { NextResponse, NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}

// Allow GET in the address bar
export const GET = POST;
