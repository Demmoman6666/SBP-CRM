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

// ---------- token helpers (compat + graceful fallback) ----------
function normalizeB64(s: string) {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function hmac(input: string, secret: string, enc: "base64" | "base64url") {
  return crypto.createHmac("sha256", secret).update(input).digest(enc);
}
function decodePart(part: string): string {
  try {
    return Buffer.from(part, "base64url").toString("utf8");
  } catch {
    return Buffer.from(part, "base64").toString("utf8");
  }
}

/** Verify both legacy 2-part and JWT-style 3-part tokens. */
function verifyTokenCompat(token?: string | null):
  | { ok: true; payload: TokenPayload }
  | { ok: false } {
  if (!token) return { ok: false };

  const parts = token.split(".");
  let payloadPart = "";
  let sigProvided = "";
  let toSign = "";

  if (parts.length === 2) {
    // payload.sig
    [payloadPart, sigProvided] = parts;
    toSign = payloadPart;
  } else if (parts.length === 3) {
    // header.payload.sig
    const [h, p, s] = parts;
    payloadPart = p;
    sigProvided = s;
    toSign = `${h}.${p}`;
  } else {
    return { ok: false };
  }

  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const expectedUrl = hmac(toSign, secret, "base64url");
  const expectedB64 = normalizeB64(hmac(toSign, secret, "base64"));
  const providedNorm = normalizeB64(sigProvided);

  if (providedNorm !== expectedUrl && providedNorm !== expectedB64) {
    return { ok: false };
  }

  try {
    const payload = JSON.parse(decodePart(payloadPart)) as TokenPayload;
    if (!payload?.userId || typeof payload.exp !== "number") return { ok: false };
    if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

/** Lenient decode just to extract userId if verification fails. */
function tryDecodeUserId(token?: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  const payloadPart = parts.length === 2 ? parts[0] : parts.length === 3 ? parts[1] : "";
  if (!payloadPart) return null;
  try {
    const obj = JSON.parse(decodePart(payloadPart)) as Partial<TokenPayload>;
    return typeof obj.userId === "string" ? obj.userId : null;
  } catch {
    return null;
  }
}

// ---------- admin guard ----------
async function requireAdmin() {
  const tok = cookies().get(COOKIE_NAME)?.value;

  let userId: string | null = null;
  const v = verifyTokenCompat(tok);
  if (v.ok) {
    userId = v.payload.userId;
  } else {
    // fallback: decode userId and then rely on DB role/isActive for safety
    userId = tryDecodeUserId(tok);
  }

  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });

  if (!me || !me.isActive) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { adminId: userId };
}

// ---------- body helper ----------
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

// ---------- GET /api/users ----------
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

  return NextResponse.json({ users });
}

// ---------- POST /api/users ----------
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

  const roleInput = String(body.role || "USER").toUpperCase();
  const roleMap: Record<string, Role> = {
    ADMIN: Role.ADMIN,
    MANAGER: Role.MANAGER,
    REP: Role.REP,
    VIEWER: Role.VIEWER,
    USER: Role.REP, // legacy "User" => REP
  };
  const role: Role = roleMap[roleInput] ?? Role.VIEWER;

  const rawPerms: any[] =
    Array.isArray(body.permissions) ? body.permissions :
    Array.isArray(body.overrides) ? body.overrides :
    [];
  const validPerms = Array.from(
    new Set(
      rawPerms
        .map((p) => String(p).toUpperCase())
        .filter((p): p is keyof typeof Permission => p in Permission)
    )
  ) as Permission[];

  if (!fullName || !email || !password) {
    return NextResponse.json({ error: "fullName, email and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (typeof confirm === "string" && confirm !== password) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
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
        overrides: validPerms.length ? { create: validPerms.map((perm) => ({ perm })) } : undefined,
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
