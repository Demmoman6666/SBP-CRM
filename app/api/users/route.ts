// app/api/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

/** Simple role gates */
function canViewUsers(role?: Role | null) {
  return role === "ADMIN" || role === "MANAGER";
}
function canCreateUsers(role?: Role | null) {
  return role === "ADMIN";
}

/** GET /api/users
 *  List users (ADMIN & MANAGER)
 */
export async function GET() {
  const me = await getCurrentUser();
  if (!me || !canViewUsers(me.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
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

  return NextResponse.json(users);
}

/** POST /api/users
 *  Create a new user (ADMIN only)
 *  Body: { fullName, email, phone?, password, role?, isActive? }
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me || !canCreateUsers(me.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = String(body?.fullName ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = (body?.phone ?? "").toString().trim() || null;
  const password = String(body?.password ?? "").trim();
  const role: Role = (["ADMIN", "MANAGER", "REP", "VIEWER"] as const).includes(
    String(body?.role ?? "").toUpperCase() as Role
  )
    ? (String(body.role).toUpperCase() as Role)
    : "VIEWER";
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;

  if (!fullName || !email || !password) {
    return NextResponse.json(
      { error: "fullName, email and password are required" },
      { status: 400 }
    );
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const created = await prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        passwordHash,
        role,
        isActive,
      },
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

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    // Unique email violation
    if (e?.code === "P2002" && Array.isArray(e?.meta?.target) && e.meta.target.includes("email")) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 400 });
    }
    return NextResponse.json({ error: e?.message ?? "Create failed" }, { status: 400 });
  }
}
