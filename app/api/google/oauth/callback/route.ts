// app/api/google/oauth/callback/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForTokens, getOAuthClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import jwtDecode from "jwt-decode";

type IdToken = { email?: string; name?: string; sub?: string };

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const stateCookie = cookies().get("gc_oauth_state")?.value || null;
  const userId = cookies().get("gc_user")?.value || null;

  // always clear short-lived cookies
  const clear = (res: NextResponse) => {
    res.cookies.set("gc_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("gc_user", "", { path: "/", maxAge: 0 });
  };

  if (err) {
    const res = NextResponse.redirect(new URL("/settings/account?gc=error", req.url));
    clear(res);
    return res;
  }
  if (!code || !state || !stateCookie || state !== stateCookie || !userId) {
    const res = NextResponse.redirect(new URL("/settings/account?gc=state", req.url));
    clear(res);
    return res;
  }

  try {
    const tokens = await exchangeCodeForTokens(req.nextUrl.origin, code);
    const access = tokens.access_token!;
    const refresh = tokens.refresh_token || null; // may be null if user already granted; that’s ok
    const expiry = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3500_000);

    // Get email from id_token if present
    let googleEmail: string | undefined;
    if (tokens.id_token) {
      try {
        const idt = jwtDecode<IdToken>(tokens.id_token);
        if (idt?.email) googleEmail = idt.email;
      } catch {}
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleEmail: googleEmail || undefined,
        googleAccessToken: access,
        googleRefreshToken: refresh ?? undefined,
        googleTokenExpiresAt: expiry,
        googleCalendarId: "primary",
      },
    });

    const res = NextResponse.redirect(new URL("/settings/account?gc=ok", req.url));
    clear(res);
    return res;
  } catch (e: any) {
    const res = NextResponse.redirect(new URL("/settings/account?gc=error", req.url));
    clear(res);
    return res;
  }
}
