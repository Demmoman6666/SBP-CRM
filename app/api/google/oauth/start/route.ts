// app/api/google/oauth/start/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

function baseUrlFromHeaders(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) throw new Error("Missing Host header");
  return `${proto}://${host}`;
}

function buildState(returnTo: string) {
  const raw = JSON.stringify({ returnTo, t: Date.now() });
  return Buffer.from(raw).toString("base64url");
}

function googleAuthUrl(opts: { clientId: string; redirectUri: string; state: string }) {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar",
    ].join(" "),
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function handle(req: NextRequest) {
  try {
    // must be logged in so we know who to attach tokens to
    const me = await getCurrentUser();
    if (!me) {
      const login = new URL("/login", req.url);
      login.searchParams.set("next", "/settings/account");
      return NextResponse.redirect(login);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 500 });
    }

    const origin = baseUrlFromHeaders(req);
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/google/oauth/callback`;

    const returnTo = new URL(req.url).searchParams.get("returnTo") || "/settings/account";
    const state = buildState(returnTo);
    const authUrl = googleAuthUrl({ clientId, redirectUri, state });

    // set httpOnly cookies the callback will verify
    const res = NextResponse.redirect(authUrl);
    res.cookies.set("gc_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600, // 10 minutes
    });
    res.cookies.set("gc_user", me.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "OAuth start error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
