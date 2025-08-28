// app/api/settings/account/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };

// --- token helpers (mirror middleware) ---
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

async function requireSelf() {
  const cookie = (await import("next/headers")).cookies();
  const token = cookie.get(COOKIE_NAME)?.value;
  const sess = verifyToken(token);
  if (!sess) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: sess.userId as string };
}

// Accept POST, PATCH, PUT -> all behave the same
export async function POST(req: Request) {
  return handleUpdate(req);
}
export async function PATCH(req: Request) {
  return handleUpdate(req);
}
export async function PUT(req: Request) {
  return handleUpdate(req);
}

async function handleUpdate(req: Request) {
  const guard = await requireSelf();
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fullName = (body.fullName ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  const data: any = {};
  if (fullName) data.fullName = fullName;
  if (phone) data.phone = phone;
  if (email) data.email = email;

  try {
    // If changing password, verify current password matches
    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password required" }, { status: 400 });
      }
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!me) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const ok = await bcrypt.compare(currentPassword, me.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
      }
      const newHash = await bcrypt.hash(newPassword, 10);
      data.passwordHash = newHash;
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
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
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "Update failed";
    // Handle unique email constraint nicely
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
