// lib/auth.ts
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/**
 * We use an HMAC-signed, base64url token stored in cookie `sbp_session`.
 * Payload: { userId: string, exp: number } (exp in seconds)
 */
const COOKIE_NAME = "sbp_session";
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";

/* ---------------- Types ---------------- */
export type SafeUser = Pick<
  User,
  "id" | "fullName" | "email" | "phone" | "role" | "isActive" | "createdAt" | "updatedAt"
>;

/* ---------------- Base64url helpers (Node) ---------------- */
function b64urlEncode(buf: Buffer) {
  return buf.toString("base64url");
}
function b64urlDecodeToBuf(s: string) {
  return Buffer.from(s, "base64url");
}

/* ---------------- Session token helpers (Node/Server) ---------------- */
export function createSessionToken(userId: string, maxAgeSec = DEFAULT_MAX_AGE) {
  const payload = { userId, exp: Math.floor(Date.now() / 1000) + maxAgeSec };
  const p = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined | null
): { userId: string; exp: number } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [p, sig] = parts;

  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(p).digest("base64url");
  // Timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const json = JSON.parse(b64urlDecodeToBuf(p).toString("utf8")) as {
      userId: string;
      exp: number;
    };
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

/* ---------------- Public helpers ---------------- */

/** Look up a user by email (case-insensitive) and return a safe subset of fields. */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  if (!email) return null;
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
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

/** For login flow only: includes passwordHash for verification. */
export async function getUserWithPasswordByEmail(email: string) {
  if (!email) return null;
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      passwordHash: true,
    },
  });
}

/**
 * Current user (server-only).
 * Reads and verifies the signed `sbp_session` cookie, then fetches the user.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const token = cookies().get(COOKIE_NAME)?.value;
    const sess = verifySessionToken(token);
    if (!sess) return null;

    const user = await prisma.user.findUnique({
      where: { id: sess.userId },
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

    if (!user || !user.isActive) return null;
    return user;
  } catch {
    return null;
  }
}

/** Password helpers */
export async function hashPassword(plain: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}
export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Convenience guard */
export function isAdmin(user: SafeUser | null | undefined): boolean {
  return !!user && user.role === "ADMIN";
}
