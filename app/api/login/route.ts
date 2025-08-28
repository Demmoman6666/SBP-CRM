// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const e = String(email || "").trim().toLowerCase();
    const p = String(password || "");

    if (!e || !p) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    // Verify in Postgres with pgcrypto (same logic you ran in Neon)
    const rows = await prisma.$queryRaw<
      { id: string; fullName: string; email: string; phone: string | null; role: Role; isActive: boolean }[]
    >(Prisma.sql`
      SELECT id, "fullName", email, phone, role, "isActive"
      FROM "User"
      WHERE email = ${e}
        AND "isActive" = true
        AND "passwordHash" = crypt(${p}, "passwordHash")
      LIMIT 1
    `);

    if (!rows.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = rows[0];

    // Set login cookie for getCurrentUser()
    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role } });
    res.cookies.set("sbp_email", e, {
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
