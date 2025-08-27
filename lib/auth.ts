// lib/auth.ts
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import type { Permission, Role } from "@prisma/client";

/** Role → default permissions (you can tweak these) */
const ALL_PERMS = [
  "VIEW_SALES_HUB",
  "VIEW_REPORTS",
  "VIEW_CUSTOMERS",
  "EDIT_CUSTOMERS",
  "VIEW_CALLS",
  "EDIT_CALLS",
  "VIEW_PROFIT_CALC",
  "VIEW_SETTINGS",
] as const satisfies Permission[];

const roleDefaults: Record<Role, Permission[]> = {
  ADMIN: ALL_PERMS.slice() as Permission[],
  MANAGER: [
    "VIEW_SALES_HUB",
    "VIEW_REPORTS",
    "VIEW_CUSTOMERS",
    "EDIT_CUSTOMERS",
    "VIEW_CALLS",
    "EDIT_CALLS",
    "VIEW_PROFIT_CALC",
    "VIEW_SETTINGS",
  ],
  REP: [
    "VIEW_SALES_HUB",
    "VIEW_CUSTOMERS",
    "VIEW_CALLS",
    "VIEW_PROFIT_CALC",
    "VIEW_REPORTS",
  ],
  VIEWER: ["VIEW_REPORTS", "VIEW_CUSTOMERS"],
};

/** Merge role defaults + per-user overrides into a stable list */
function computePermissions(role: Role, overrides: { perm: Permission }[]): Permission[] {
  const base = new Set<Permission>(roleDefaults[role] ?? []);
  for (const o of overrides) base.add(o.perm);
  return Array.from(base);
}

export type SafeUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Role;
  /** Keep exposing `features` for the UI (these are Permission strings) */
  features: Permission[];
};

/** Get a user by email, returning a SafeUser for the UI */
export async function getUserByEmail(email: string): Promise<SafeUser | null> {
  const u = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      // Load per-user overrides (no `features` column anymore)
      overrides: { select: { perm: true } },
    },
  });
  if (!u || !u.isActive) return null;
  const features = computePermissions(u.role, u.overrides);
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone ?? null,
    role: u.role,
    features,
  };
}

/** Get a user by id, returning a SafeUser for the UI */
export async function getUserById(id: string): Promise<SafeUser | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      overrides: { select: { perm: true } },
    },
  });
  if (!u || !u.isActive) return null;
  const features = computePermissions(u.role, u.overrides);
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone ?? null,
    role: u.role,
    features,
  };
}

/** Verify login; returns SafeUser on success, else null */
export async function verifyLogin(email: string, password: string): Promise<SafeUser | null> {
  const u = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      passwordHash: true,
      overrides: { select: { perm: true } },
    },
  });
  if (!u || !u.isActive) return null;

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return null;

  const features = computePermissions(u.role, u.overrides);
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone ?? null,
    role: u.role,
    features,
  };
}

/** Utility to hash a password for seeding/admin tools */
export async function hashPassword(plain: string) {
  // 10 is reasonable for serverless; increase if you have headroom
  const saltRounds = 10;
  return bcrypt.hash(plain, saltRounds);
}
