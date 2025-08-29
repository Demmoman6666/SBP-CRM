// app/api/google/oauth/start/route.ts
import { NextRequest, NextResponse } from "next/server";

function baseUrlFromHeaders(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) throw new Error("Missing Host header");
  return `${proto}://${host}`;
}

function buildState(returnTo: string) {
  const raw = JSON.stringify({ returnTo });
  return Buffer.from(raw).toString("base64url");
}

function googleAuthUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
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
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function handle(req: NextRequest) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "GOOGLE_CLIENT_ID is not set" },
        { status: 500 }
      );
    }

    const base = baseUrlFromHeaders(req);
    const redirectUri = `${base}/api/google/oauth/callback`;

    const url = new URL(req.url);
    const returnTo =
      url.searchParams.get("returnTo") ||
      "/settings/account"; // default: back to account page after connect

    const state = buildState(returnTo);
    const authUrl = googleAuthUrl({ clientId, redirectUri, state });

    return NextResponse.redirect(authUrl);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "OAuth start error" },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
