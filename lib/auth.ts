// lib/auth.ts
import { prisma } from "@/lib/prisma";
import { headers as nextHeaders, cookies as nextCookies } from "next/headers";
import type { User } from "@prisma/client";
import crypto from "crypto";

export type SafeUser = Pick<
  User,
  "id" | "fullName" | "email" | "phone" | "role" | "isActive" | "createdAt" | "updatedAt"
>;

const COOKIE_NAME = "sbp_session";
const LEGACY_EMAIL_COOKIE = "sbp_email";

type TokenPayload = { userId: string; exp: number };

// ----- token helpers (Node HMAC; middleware mirrors with WebCrypto) -----
function sign(payloadB64: string) {
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createSessionToken(userId: string, maxAgeSec = 60 * 60 * 24 * 30) {
  const payload: TokenPayload = { userId, exp: Math.floor(Date.now() / 1000) + maxAgeSec };
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(p);
  return `${p}.${sig}`;
}

function verifySessionToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;
  const expected = sign(p);
  if (sig !== expected) return null;

  try {
    const json = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

// ----- user lookups -----
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
 * Current user helper (server-side):
 * 1) Prefer sbp_session HMAC token (matches middleware).
 * 2) Fallback to legacy x-user-email / sbp_email for previews.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const hdrs = nextHeaders();
    const cookies = nextCookies();

    // 1) New signed session cookie
    const token = cookies.get(COOKIE_NAME)?.value;
    const payload = verifySessionToken(token);
    if (payload?.userId) {
      return getUserById(payload.userId);
    }

    // 2) Legacy preview/dev fallback
    const emailFromHeader = hdrs.get("x-user-email") || hdrs.get("x-user");
    const emailFromCookie = cookies.get(LEGACY_EMAIL_COOKIE)?.value || cookies.get("email")?.value;
    const email = (emailFromHeader || emailFromCookie || "").trim().toLowerCase();
    if (email) return getUserByEmail(email);

    return null;
  } catch {
    return null;
  }
}

/** Convenience guard */
export function isAdmin(user: SafeUser | null | undefined): boolean {
  return !!user && user.isActive && user.role === "ADMIN";
}
