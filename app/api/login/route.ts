// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Accept JSON *or* form posts
    let email = "";
    let password = "";
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      email = String(body?.email || "").trim();
      password = String(body?.password || "");
    } else {
      const form = await req.formData();
      email = String(form.get("email") || "").trim();
      password = String(form.get("password") || "");
    }

    if (!email || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Verify using pgcrypto (case-insensitive email match)
    const rows = await prisma.$queryRaw<
      { id: string; fullName: string; email: string; phone: string | null; role: Role; isActive: boolean; ok: boolean }[]
    >(Prisma.sql`
      SELECT
        id, "fullName", email, phone, role, "isActive",
        ("passwordHash" = crypt(${password}, "passwordHash")) AS ok
      FROM "User"
      WHERE lower(email) = lower(${email})
        AND "isActive" = true
      LIMIT 1
    `);

    const row = rows[0];
    if (!row || !row.ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Set the cookie used by getCurrentUser()
    const res = NextResponse.json({
      ok: true,
      user: { id: row.id, email: row.email, fullName: row.fullName, role: row.role },
    });

    res.cookies.set("sbp_email", row.email.toLowerCase(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
