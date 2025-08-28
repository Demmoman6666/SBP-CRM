// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    phone: me.phone,
    role: me.role,
    isActive: me.isActive,
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,
  });
}
