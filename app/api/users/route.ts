// app/api/users/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const COOKIE_NAME = "sbp_session";

type TokenPayload = { userId: string; exp: number };

// ---- token helpers (same shape as other secured routes) ----
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
  const cookieStore = (await import("next/headers")).cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const sess = verifyToken(token);
  if (!sess) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const me = await prisma.user.findUnique({
    where: { id: sess.userId },
    select: { id: true, role: true },
  });
  if (!me) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (me.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { adminId: me.id };
}

// ---- POST /api/users -> create a user ----
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // accept either `fullName` or `name`
  const fullName = String(body.fullName ?? body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim(); // schema seems non-null; use empty string if not provided
  const role = (String(body.role ?? "USER").toUpperCase() === "ADMIN" ? "ADMIN" : "USER") as
    | "ADMIN"
    | "USER";

  const password = String(body.password ?? "");
  const confirm = String(body.confirm ?? body.confirmPassword ?? "");

  // --- server-side validation (includes confirm) ---
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
  if (!confirm || confirm !== password) {
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
        phone, // if your column is nullable, you can pass phone || null instead
        passwordHash,
        role,
        isActive: true,
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

    // NOTE: We intentionally ignore `features` / `permissions` in request.
    // If you later add a permissions table, we can upsert those here.

    return NextResponse.json({ user: created });
  } catch (e: any) {
    const msg = String(e?.message || "Create failed");
    if (msg.toLowerCase().includes("unique") && msg.toLowerCase().includes("email")) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
