// app/api/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("ping") === "1") {
    return NextResponse.json({ ok: true, method: "GET" });
  }
  return NextResponse.json({ ok: true });
}

type Row = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: "ADMIN" | "MANAGER" | "REP" | "VIEWER";
  isActive: boolean;
};

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json().catch(() => ({} as any));
    const e = String(email || "").trim();
    const p = String(password || "");
    if (!e || !p) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, "fullName", email, phone, role, "isActive"
      FROM "User"
      WHERE lower(email) = lower(${e})
        AND "isActive" = true
        AND "passwordHash" = crypt(${p}, "passwordHash")
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = rows[0];
    const cookieVal = user.email.toLowerCase();

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    });

    res.cookies.set("sbp_email", cookieVal, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.set("email", cookieVal, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
