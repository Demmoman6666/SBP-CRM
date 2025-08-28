// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

// small helper because raw SQL booleans can arrive as true/'t'/1
function asBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return v === "t" || v === "true" || v === "1";
  return false;
}

// Quick sanity endpoint to verify the deployed file
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("ping")) {
    return NextResponse.json({ ok: true, method: "GET", time: Date.now() });
  }
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function POST(req: Request) {
  try {
    // Accept JSON or form posts
    const ct = req.headers.get("content-type") || "";
    let email = "";
    let password = "";

    if (ct.includes("application/json")) {
      const b = await req.json().catch(() => ({}));
      email = String(b?.email || "").trim();
      password = String(b?.password || "");
    } else {
      const form = await req.formData();
      email = String(form.get("email") || "").trim();
      password = String(form.get("password") || "");
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Verify against Postgres with pgcrypto/bcrypt
    const rows = await prisma.$queryRaw<
      {
        id: string;
        fullName: string;
        email: string;
        phone: string | null;
        role: Role;
        isActive: boolean | "t" | "f" | 1 | 0;
        ok: boolean | "t" | "f" | 1 | 0;
      }[]
    >(Prisma.sql`
      SELECT
        id,
        "fullName",
        email,
        phone,
        role,
        "isActive",
        ("passwordHash" = crypt(${password}, "passwordHash")) AS ok
      FROM "User"
      WHERE lower(email) = lower(${email})
      LIMIT 1
    `);

    const row = rows[0];
    if (!row || !asBool(row.ok) || !asBool(row.isActive)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Set the cookie that getCurrentUser() reads
    const res = NextResponse.json({
      ok: true,
      user: { id: row.id, email: row.email, fullName: row.fullName, role: row.role },
    });

    const cookieVal = row.email.toLowerCase();

    // primary cookie
    res.cookies.set("sbp_email", cookieVal, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // legacy fallback (since getCurrentUser() also checks `email`)
    res.cookies.set("email", cookieVal, {
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
