// app/api/google/oauth/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

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
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 500 });
    }

    const origin = baseUrlFromHeaders(req);
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/google/oauth/callback`;

    const returnTo = new URL(req.url).searchParams.get("returnTo") || "/settings/account";
    const state = buildState(returnTo);
    const authUrl = googleAuthUrl({ clientId, redirectUri, state });

    // set httpOnly state cookie for callback validation (10 min)
    const res = NextResponse.redirect(authUrl);
    cookies().set("g_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "OAuth start error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
