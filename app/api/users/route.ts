// app/api/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { getUserByEmail, hashPassword } from "@/lib/auth";
import type { Role, Permission } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function currentUser() {
  const jar = cookies();
  const email =
    jar.get("sbp_email")?.value ??
    jar.get("userEmail")?.value ??
    "";
  return email ? await getUserByEmail(email) : null;
}

function isManager(me: { role: Role; features?: Permission[] | null } | null) {
  if (!me) return false;
  if (me.role === "ADMIN") return true;
  return !!me.features?.includes("MANAGE_USERS");
}

/**
 * POST /api/users
 * Body: { name, email, phone?, password, role? ("ADMIN"|"USER"), features?: Permission[] }
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!isManager(me)) return bad("Forbidden", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON");
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = (String(body.phone || "").trim() || null) as string | null;
  const password = String(body.password || "");
  const role = (body.role as Role) || "USER";

  // Accept a list of permissions; coerce to unique, valid strings
  const rawFeatures = Array.isArray(body.features) ? body.features : [];
  const features = Array.from(new Set(rawFeatures)).filter(Boolean) as Permission[];

  if (!name) return bad("Name is required");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Valid email is required");
  if (password.length < 8) return bad("Password must be at least 8 characters");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return bad("Email already in use", 409);

  // Admins always get these capabilities
  let finalFeatures = features;
  if (role === "ADMIN") {
    const set = new Set<Permission>([
      ...features,
      "VIEW_SETTINGS" as Permission,
      "MANAGE_USERS" as Permission,
    ]);
    finalFeatures = Array.from(set);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      phone,
      role,
      features: finalFeatures,
      passwordHash,
    },
    select: { id: true, email: true, name: true, role: true, features: true, createdAt: true },
  });

  // Optional: audit trail (ignore failures)
  try {
    await prisma.auditLog.create({
      data: {
        userId: me!.id,
        action: "CREATE_USER",
        details: `Created user ${user.email} (${user.id})`,
      },
    });
  } catch {}

  return NextResponse.json({ ok: true, user });
}

/**
 * GET /api/users
 * List users (no password hashes). Restricted to managers.
 */
export async function GET() {
  const me = await currentUser();
  if (!isManager(me)) return bad("Forbidden", 403);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      features: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ users });
}
