// app/api/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role, Permission } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";
type TokenPayload = { userId: string; exp: number };

function json(data: any, init?: number | ResponseInit) {
  const headers = { "cache-control": "no-store" };
  if (typeof init === "number") return NextResponse.json(data, { status: init, headers });
  return NextResponse.json(data, { ...(init || {}), headers });
}

/* ---------------- token helpers (mirror middleware) ---------------- */
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
  if (!tok) return { error: json({ error: "Unauthorized", reason: "NoCookie" }, 401) };

  const sess = verifyToken(tok);
  if (!sess) return { error: json({ error: "Unauthorized", reason: "BadToken" }, 401) };

  const me = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { role: true, isActive: true },
  });

  if (!me) return { error: json({ error: "Forbidden", reason: "NoUser" }, 403) };
  if (!me.isActive) return { error: json({ error: "Forbidden", reason: "Inactive" }, 403) };
  if (me.role !== "ADMIN") return { error: json({ error: "Forbidden", reason: "NotAdmin" }, 403) };

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

/* ---------------- GET /api/users (list) ---------------- */
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

  return json({ users });
}

/* ---------------- POST /api/users (create) ---------------- */
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

  // Map incoming role to Prisma enum. Legacy "USER" -> REP by default.
  const roleInput = String(body.role || "USER").toUpperCase();
  const roleMap: Record<string, Role> = {
    ADMIN: Role.ADMIN,
    MANAGER: Role.MANAGER,
    REP: Role.REP,
    VIEWER: Role.VIEWER,
    USER: Role.REP,
  };
  const role: Role = roleMap[roleInput] ?? Role.VIEWER;

  // Optional permission overrides: accept `permissions` or `overrides`, string or array.
  const rawPermsAny =
    body.permissions ?? body.overrides ?? [];
  const rawPerms: string[] = Array.isArray(rawPermsAny)
    ? rawPermsAny.map(String)
    : String(rawPermsAny || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  const validPerms = Array.from(
    new Set(
      rawPerms
        .map((p) => p.toUpperCase())
        .filter((p): p is keyof typeof Permission => p in Permission)
    )
  ) as Permission[];

  if (!fullName || !email || !password) {
    return json({ error: "fullName, email and password are required" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "Password must be at least 8 characters" }, 400);
  }
  if (typeof confirm === "string" && confirm !== password) {
    return json({ error: "Passwords do not match" }, 400);
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
        overrides:
          validPerms.length > 0
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

    return json({ user: created }, 201);
  } catch (e: any) {
    const msg = String(e?.message || "Create failed");
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return json({ error: "Email already in use" }, 409);
    }
    return json({ error: msg }, 400);
  }
}
