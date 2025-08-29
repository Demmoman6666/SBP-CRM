// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pull only the Google fields we need to determine connection (tokens are NOT returned)
  const g = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      googleEmail: true,
      googleAccessToken: true,
      googleRefreshToken: true,      // used only to decide connected state
      googleTokenExpiresAt: true,
      googleCalendarId: true,
    },
  });

  // Consider the account "connected" if we have a refresh token (access token may be expired)
  const googleConnected = Boolean(g?.googleRefreshToken);

  const res = NextResponse.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    phone: me.phone,
    role: me.role,
    isActive: me.isActive,
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,

    // Fields used by Account page / GoogleCalendarConnect
    googleConnected,
    googleEmail: g?.googleEmail ?? null,
    googleCalendarId: g?.googleCalendarId ?? "primary",
  });

  res.headers.set("Cache-Control", "no-store");
  return res;
}
