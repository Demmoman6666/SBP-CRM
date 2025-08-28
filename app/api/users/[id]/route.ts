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

/* ---------------- token helpers (match other routes) ---------------- */
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

/* ---------------- body helper ---------------- */
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
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = String(params.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

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
   Accepts any subset of fields:
   - fullName, email, phone
   - role: "ADMIN" | "MANAGER" | "REP" | "VIEWER"
   - isActive: boolean or "true"/"false"
   - password via `password` or `newPassword` (+ optional `confirm`)
   - overrides/permissions: string[] of Permission enum names
------------------------------------------------------- */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ("error" in g) return g.error;

  const id = String(params.id || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body: any = await readBody(req);

  // Basic fields (optional)
  const fullName = body.fullName != null ? String(body.fullName).trim() : undefined;
  const email    = body.email    != null ? String(body.email).trim().toLowerCase() : undefined;
  const phoneStr = body.phone    != null ? String(body.phone).trim() : undefined;
  const phone    = phoneStr === "" ? null : phoneStr;

  // Role mapping (optional)
  const roleInput = body.role != null ? String(body.role).toUpperCase() : undefined;
  const roleMap: Record<string, Role> = {
    ADMIN: Role.ADMIN,
    MANAGER: Role.MANAGER,
    REP: Role.REP,
    VIEWER: Role.VIEWER,
  };
  const role = roleInput ? (roleMap[roleInput] ?? undefined) : undefined;
  if (roleInput && !role) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // isActive (optional)
  let isActive: boolean | undefined = undefined;
  if (typeof body.isActive === "boolean") {
    isActive = body.isActive;
  } else if (body.isActive === "true" || body.isActive === "false") {
    isActive = body.isActive === "true";
  }

  // Password (optional) — supports `newPassword` OR `password`, + optional `confirm`
  const pw = body.newPassword != null ? String(body.newPassword) :
             body.password    != null ? String(body.password)    : undefined;
  const confirm = body.confirm != null ? String(body.confirm) : undefined;

  if (pw !== undefined) {
    if (pw.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (confirm !== undefined && confirm !== pw) {
      return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
    }
  }

  // Permission overrides (optional)
  const rawPerms: any[] =
    Array.isArray(body.permissions) ? body.permissions :
    Array.isArray(body.overrides)   ? body.overrides   :
    [];
  const validPerms = Array.from(
    new Set(
      rawPerms
        .map((p) => String(p).toUpperCase())
        .filter((p): p is keyof typeof Permission => p in Permission)
    )
  ) as Permission[];

  // Build update payload
  const data: any = {};
  if (fullName !== undefined) data.fullName = fullName;
  if (email    !== undefined) data.email    = email;
  if (phoneStr !== undefined) data.phone    = phone;
  if (role     !== undefined) data.role     = role;
  if (isActive !== undefined) data.isActive = isActive;
  if (pw       !== undefined) data.passwordHash = await bcrypt.hash(pw, 10);

  // Replace overrides only if caller sent overrides/permissions (even if empty)
  if (Array.isArray(body.permissions) || Array.isArray(body.overrides)) {
    data.overrides = {
      deleteMany: {},
      ...(validPerms.length ? { create: validPerms.map((perm) => ({ perm })) } : {}),
    };
  }

  try {
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
        createdAt: true,
        updatedAt: true,
        overrides: { select: { perm: true } },
      },
    });
    return NextResponse.json({ user: updated });
  } catch (e: any) {
    const msg = String(e?.message || "Update failed");
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/* Optional: POST alias for PATCH (useful for plain forms) */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  return PATCH(req, ctx);
}
