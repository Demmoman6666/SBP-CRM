// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only read what's needed. Never return tokens to the client.
  const g = await prisma.user.findUnique({
    where: { id: me.id },
    select: {
      googleEmail: true,
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
      googleCalendarId: true,
    },
  });

  const now = new Date();
  const hasAccess = Boolean(g?.googleAccessToken);
  const hasRefresh = Boolean(g?.googleRefreshToken);
  const isExpired =
    g?.googleTokenExpiresAt ? g.googleTokenExpiresAt.getTime() <= now.getTime() : false;

  // Treat as connected if:
  //  - we have a refresh token (best), OR
  //  - we have a non-expired access token (still usable)
  const googleConnected = hasRefresh || (hasAccess && !isExpired);

  const res = NextResponse.json({
    id: me.id,
    email: me.email,
    fullName: me.fullName,
    phone: me.phone,
    role: me.role,
    isActive: me.isActive,
    createdAt: me.createdAt,
    updatedAt: me.updatedAt,

    // for UI
    googleConnected,
    googleEmail: g?.googleEmail ?? null,
    googleCalendarId: g?.googleCalendarId ?? "primary",

    // safe diagnostics (no secrets)
    googleHasAccessToken: hasAccess,
    googleHasRefreshToken: hasRefresh,
    googleTokenExpired: isExpired,
  });

  res.headers.set("Cache-Control", "no-store");
  return res;
}
