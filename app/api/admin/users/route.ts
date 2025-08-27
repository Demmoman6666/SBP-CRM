// app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

/** Ensure the caller is an ADMIN */
async function requireAdmin(): Promise<NextResponse | null> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null; // <- no `as const`
}

/** Coerce any input to a valid Role enum (or undefined) */
function coerceRole(input: any): Role | undefined {
  if (!input) return undefined;
  const v = String(input).toUpperCase();
  return (Object.values(Role) as string[]).includes(v) ? (v as Role) : undefined;
}

/** GET /api/admin/users — list all users (admin only) */
export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(users);
}

/** POST /api/admin/users — create a user (admin only)
 *  body: { fullName, email, password, phone?, role?, isActive? }
 */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = (body?.fullName || "").trim();
  const email = (body?.email || "").trim().toLowerCase();
  const phone = (body?.phone || "").trim();
  const password = String(body?.password || "").trim();
  const role = coerceRole(body?.role) ?? Role.USER;
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
        phone: phone || null,
        passwordHash,
        role,
        isActive,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    const msg =
      e?.code === "P2002"
        ? "A user with that email already exists"
        : e?.message || "Create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
