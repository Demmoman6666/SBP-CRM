// lib/auth.ts
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import type { Role, Permission } from "@prisma/client";

/**
 * Hash a plaintext password using bcrypt.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const salt = await bcrypt.genSalt(rounds);
  return bcrypt.hash(plaintext, salt);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Look up a user by email (case-insensitive), returning safe public fields.
 */
export async function getUserByEmail(email: string) {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;

  return prisma.user.findUnique({
    where: { email: e },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      features: true,
      createdAt: true,
      updatedAt: true,
      // passwordHash is intentionally NOT selected
    },
  });
}

/**
 * Resolve the current user from cookies.
 * Looks for common cookie names: sbp_email, userEmail, email.
 * If none found, returns null.
 */
export async function getCurrentUser() {
  const jar = cookies();
  const email =
    jar.get("sbp_email")?.value ||
    jar.get("userEmail")?.value ||
    jar.get("email")?.value ||
    "";

  if (!email) return null;
  return getUserByEmail(email);
}

/**
 * Simple helper: does the user have a permission?
 * Admins are treated as having all permissions.
 */
export function hasPermission(
  user: { role: Role; features?: Permission[] | null } | null,
  perm: Permission
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return !!user.features?.includes(perm);
}
