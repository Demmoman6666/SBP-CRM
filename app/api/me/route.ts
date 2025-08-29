// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pull Google fields (tokens never sent to client)
  const g = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      googleEmail: true,
      googleAccessToken: true,
      googleTokenExpiresAt: true,
      googleCalendarId: true,
    },
  });

  const now = new Date();
  const googleConnected =
    Boolean(g?.googleAccessToken) &&
    (!g?.googleTokenExpiresAt || g.googleTokenExpiresAt > now);

  const res = NextResponse.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    phone: me.phone,
    role: me.role,
    isActive: me.isActive,
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,

    // 👇 what the Account page & GoogleCalendarConnect need
    googleConnected,
    googleEmail: g?.googleEmail ?? null,
    googleCalendarId: g?.googleCalendarId ?? null,
  });

  res.headers.set("Cache-Control", "no-store");
  return res;
}
