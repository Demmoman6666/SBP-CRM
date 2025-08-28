// app/api/users/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role, Permission } from "@prisma/client";
import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function verifyToken(token?: string | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64url, sigB64url] = parts;

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64url)
    .digest("base64url");

  if (expected !== sigB64url) return null;

  try {
    const json = JSON.parse(Buffer.from(payloadB64url, "base64url").toString()) as TokenPayload;
    if (!json?.userId || typeof json.exp !== "number") return null;
    if (json.exp < Math.floor(Date.now() / 1000)) return null;
    return json;
  } catch {
    return null;
  }
}

async function requireAdmin() {
  const tok = cookies().get(COOKIE_NAME)?.value;
  const sess = verifyToken(tok);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const me = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { role: true, isActive: true },
  });
  if (!me || !me.isActive || me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: sess.userId };
}

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

/* ---------------- GET /api/users/:id ---------------- */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = String(params.id);
  const user = await prisma.user.findUnique({
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
      overrides: { select: { perm: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user });
}

/* ---------------- PATCH /api/users/:id ----------------
   Accepts JSON or form body with any of:
   - isActive: boolean
   - role: "ADMIN" | "MANAGER" | "REP" | "VIEWER"
   - overrides / permissions: Permission[] (enum names)
   - newPassword + confirm: string (>=8, must match)
------------------------------------------------------- */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = String(params.id);
  const body: any = await readBody(req);

  // Role
  let data: any = {};
  if (typeof body.role === "string") {
    const map: Record<string, Role> = {
      ADMIN: Role.ADMIN,
      MANAGER: Role.MANAGER,
      REP: Role.REP,
      VIEWER: Role.VIEWER,
    };
    const r = map[body.role.toUpperCase()];
    if (!r) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    data.role = r;
  }

  // isActive
  if (typeof body.isActive === "boolean" || body.isActive === "true" || body.isActive === "false") {
    data.isActive = typeof body.isActive === "boolean" ? body.isActive : body.isActive === "true";
  }

  // Password
  const newPassword = body.newPassword ? String(body.newPassword) : "";
  const confirm = body.confirm ? String(body.confirm) : "";
  if (newPassword || confirm) {
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (newPassword !== confirm) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(newPassword, 10);
  }

  // Apply base updates
  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
    },
  });

  // Overrides
  const raw = Array.isArray(body.overrides)
    ? body.overrides
    : Array.isArray(body.permissions)
    ? body.permissions
    : [];

  if (raw.length > 0 || "overrides" in body || "permissions" in body) {
    const validPerms = Array.from(
      new Set(
        raw
          .map((p: any) => String(p).toUpperCase())
          .filter((p): p is keyof typeof Permission => p in Permission)
      )
    ) as Permission[];

    // Replace overrides
    await prisma.userPermission.deleteMany({ where: { userId: id } });
    if (validPerms.length) {
      await prisma.userPermission.createMany({
        data: validPerms.map((perm) => ({ userId: id, perm })),
        skipDuplicates: true,
      });
    }
  }

  const finalUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      overrides: { select: { perm: true } },
      updatedAt: true,
    },
  });

  return NextResponse.json({ user: finalUser });
}

/* Optional: allow POST as alias for PATCH (handy for HTML forms) */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  return PATCH(req, ctx);
}
