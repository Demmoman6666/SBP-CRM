// app/api/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role, Permission } from "@prisma/client";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifyTokenVerbose, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

/* ---------------- body helper (JSON or form) ---------------- */
async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await req.json();
  if (ct.includes("multipart/form-data") || ct.includes("application/x-www-form-urlencoded")) {
    const fd = await req.formData();
    return Object.fromEntries(fd.entries());
  }
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/* ---------------- admin guard (shared) ---------------- */
async function requireAdmin() {
  const tok = cookies().get(COOKIE_NAME)?.value ?? null;
  const v = verifyTokenVerbose(tok);

  if (v.ok === false) {
    // Not signed in / bad cookie / expired / bad format
    return {
      error: NextResponse.json(
        { error: "Unauthorized", reason: v.reason },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  // v.ok === true
  const me = await prisma.user.findUnique({
    where: { id: v.payload.userId },
    select: { role: true, isActive: true },
  });

  if (!me || !me.isActive) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized", reason: "InactiveOrMissing" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }
  if (me.role !== "ADMIN") {
    return {
      error: NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return { adminId: v.payload.userId };
}

/* ---------------- GET /api/users  (list) ---------------- */
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      overrides: { select: { perm: true } },
    },
  });

  return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
}

/* ---------------- POST /api/users  (create) ---------------- */
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  const body: any = await readBody(req);

  const fullName = String(body.fullName || body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phoneRaw = body.phone == null ? "" : String(body.phone).trim();
  const phone = phoneRaw || null;
  const password = String(body.password || "");
  const confirm = body.confirm != null ? String(body.confirm) : undefined;

  // Role: keep legacy "USER" => REP default
  const roleInput = String(body.role || "USER").toUpperCase();
  const roleMap: Record<string, Role> = {
    ADMIN: Role.ADMIN,
    MANAGER: Role.MANAGER,
    REP: Role.REP,
    VIEWER: Role.VIEWER,
    USER: Role.REP,
  };
  const role: Role = roleMap[roleInput] ?? Role.VIEWER;

  // Optional permission overrides (accepts `permissions` or `overrides`)
  const rawPerms: any[] = Array.isArray(body.permissions)
    ? body.permissions
    : Array.isArray(body.overrides)
    ? body.overrides
    : [];
  const validPerms = Array.from(
    new Set(
      rawPerms
        .map((p) => String(p).toUpperCase())
        .filter((p): p is keyof typeof Permission => p in Permission)
    )
  ) as Permission[];

  // Validation
  if (!fullName || !email || !password) {
    return NextResponse.json(
      { error: "fullName, email and password are required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }
  if (typeof confirm === "string" && confirm !== password) {
    return NextResponse.json(
      { error: "Passwords do not match" },
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
        isActive: true,
        overrides: validPerms.length
          ? { create: validPerms.map((perm) => ({ perm })) }
          : undefined,
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
        overrides: { select: { perm: true } },
      },
    });

    return NextResponse.json({ user: created }, { status: 201 });
  } catch (e: any) {
    const msg = String(e?.message || "Create failed");
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
