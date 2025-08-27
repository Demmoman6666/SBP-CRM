// lib/auth.ts
import { prisma } from "@/lib/prisma";
import { headers as nextHeaders, cookies as nextCookies } from "next/headers";
import type { User } from "@prisma/client";

export type SafeUser = Pick<
  User,
  "id" | "fullName" | "email" | "phone" | "role" | "isActive" | "createdAt" | "updatedAt"
>;

/** Look up a user by email and return a safe subset of fields. */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  if (!email) return null;
  return prisma.user.findUnique({
    where: { email },
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
 * Minimal “current user” helper for server code.
 * - Reads `x-user-email` (or `x-user`) header first (useful in previews).
 * - Falls back to cookies: `sbp_email` or `email`.
 * Return null if not present.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  try {
    const hdrs = nextHeaders();
    const emailFromHeader = hdrs.get("x-user-email") || hdrs.get("x-user");
    const cookies = nextCookies();
    const emailFromCookie = cookies.get("sbp_email")?.value || cookies.get("email")?.value;

    const email = (emailFromHeader || emailFromCookie || "").trim();
    if (!email) return null;

    return await getUserByEmail(email);
  } catch {
    return null;
  }
}

/** Convenience guard */
export function isAdmin(user: SafeUser | null | undefined): boolean {
  return !!user && user.role === "ADMIN";
}
