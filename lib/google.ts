// lib/google.ts
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email", "profile"];

function getRedirectUri(origin?: string) {
  // Build callback URL for the current host (works in previews + prod)
  const base = origin || process.env.APP_BASE_URL; // fallback if you prefer
  return `${base?.replace(/\/$/, "")}/api/google/oauth/callback`;
}

export function getOAuthClient(origin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = getRedirectUri(origin);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(origin: string, state: string) {
  const oauth2 = getOAuthClient(origin);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures refresh_token the first time
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(origin: string, code: string) {
  const oauth2 = getOAuthClient(origin);
  const { tokens } = await oauth2.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, id_token, ... }
}

export async function ensureAccessToken(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  });
  if (!user) throw new Error("User not found");
  if (!user.googleRefreshToken) throw new Error("Google account not connected");

  const now = Date.now();
  const exp = user.googleTokenExpiresAt ? new Date(user.googleTokenExpiresAt).getTime() : 0;

  // if token valid for >60s, reuse
  if (user.googleAccessToken && exp - now > 60_000) {
    return user.googleAccessToken;
  }

  // refresh
  const oauth2 = getOAuthClient();
  oauth2.setCredentials({
    refresh_token: user.googleRefreshToken,
  });
  const { credentials } = await oauth2.refreshAccessToken();
  const access = credentials.access_token!;
  const expiryMs = credentials.expiry_date || now + 3500_000;

  await prisma.user.update({
    where: { id: userId },
    data: {
      googleAccessToken: access,
      googleTokenExpiresAt: new Date(expiryMs),
    },
  });

  return access;
}

export async function createCalendarEvent(userId: string, ev: {
  summary: string;
  description?: string;
  startIso: string; // RFC3339
  endIso: string;   // RFC3339
  timezone?: string; // default "Europe/London"
  attendees?: { email: string; displayName?: string }[];
}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleCalendarId: true, googleEmail: true },
  });
  if (!user) throw new Error("User not found");

  const accessToken = await ensureAccessToken(userId);
  const auth = getOAuthClient();
  auth.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: "v3", auth });
  const tz = ev.timezone || "Europe/London";
  const calendarId = user.googleCalendarId || "primary";

  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: ev.summary,
      description: ev.description || "",
      start: { dateTime: ev.startIso, timeZone: tz },
      end: { dateTime: ev.endIso, timeZone: tz },
      attendees: ev.attendees,
    },
  });

  return res.data; // returns created event
}
