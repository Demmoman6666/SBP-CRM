// app/api/login/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// --- small helpers for the signed cookie your middleware verifies ---
const COOKIE_NAME = "sbp_session";

function b64url(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return Buffer.from(bin, "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payloadJson: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const sig = await crypto.subtle.sign("HMAC", key, payloadBytes);
  return `${b64url(payloadBytes)}.${b64url(new Uint8Array(sig))}`;
}

// GET /api/login?ping=1 — simple health check
export async function GET(req: NextRequest) {
  const ping = req.nextUrl.searchParams.get("ping");
  if (ping) return NextResponse.json({ ok: true, method: "GET" });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  try {
    // Accept JSON or form posts
    let email = "";
    let password = "";

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = await req.json().catch(() => ({}));
      email = String(j?.email ?? "");
      password = String(j?.password ?? "");
    } else {
      const fd = await req.formData();
      email = String(fd.get("email") ?? "");
      password = String(fd.get("password") ?? "");
    }

    email = email.trim().toLowerCase();
    password = password ?? "";

    if (!email || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Verify user in Postgres using pgcrypto's `crypt`
    // (requires CREATE EXTENSION IF NOT EXISTS pgcrypto;)
    const rows = await prisma.$queryRaw<
      { id: string; fullName: string; email: string; role: string; isActive: boolean }[]
    >`
      SELECT "id","fullName","email","role","isActive"
      FROM "User"
      WHERE lower(trim("email")) = ${email}
        AND "isActive" = true
        AND "passwordHash" = crypt(${password}, "passwordHash")
      LIMIT 1;
    `;

    if (!rows.length) {
      // either no such email (after trim/lower) or password mismatch
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = rows[0];

    // Create a short self-signed session token (HMAC, same scheme as middleware)
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
    const token = await sign(JSON.stringify({ userId: user.id, exp }));

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });

    // Primary cookie used by middleware
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    // Optional legacy helper (if any server code still reads sbp_email)
    res.cookies.set("sbp_email", email, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
