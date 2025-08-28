// lib/auth.ts
import crypto from "crypto";
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";

export type SafeUser = Pick<
  User,
  "id" | "fullName" | "email" | "phone" | "role" | "isActive" | "createdAt" | "updatedAt"
>;

const SESSION_COOKIE = "sbp_session";
const LEGACY_EMAIL_COOKIES = ["sbp_email", "email"]; // legacy fallback

// ---- session token helpers (must match middleware) ----
type SessionPayload = { id: string; exp: number };

function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";

  const expected = crypto
    .createHmac("sha256", secret)
    .update(p)
    .digest("base64url");

  if (expected !== sig) return null;

  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as SessionPayload;
    if (!json?.id || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

// ---- lookups ----
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  if (!email) return null;
  return prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getUserById(id: string): Promise<SafeUser | null> {
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

/**
 * Current user (server). Prefers the signed sbp_session token,
 * falls back to legacy email cookie/header for compatibility.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const cookies = nextCookies();

    // 1) session token
    const tok = cookies.get(SESSION_COOKIE)?.value;
    const sess = verifySessionToken(tok);
    if (sess?.id) {
      const u = await getUserById(sess.id);
      if (u?.isActive) return u;
      return null;
    }

    // 2) legacy: headers/cookies with email
    const hdrs = nextHeaders();
    const emailFromHeader = hdrs.get("x-user-email") || hdrs.get("x-user");
    const emailFromCookie =
      LEGACY_EMAIL_COOKIES.map((n) => cookies.get(n)?.value).find(Boolean) || undefined;

    const email = (emailFromHeader || emailFromCookie || "").trim().toLowerCase();
    if (!email) return null;

    const u = await getUserByEmail(email);
    return u && u.isActive ? u : null;
  } catch {
    return null;
  }
}

export function isAdmin(user: SafeUser | null | undefined): boolean {
  return !!user && user.role === "ADMIN";
}
