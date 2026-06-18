import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const settings = await (prisma as any).cycleSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({ cycleStartDate: settings?.cycleStartDate?.toISOString().slice(0, 10) || null });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!isAdmin(me)) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { cycleStartDate } = await req.json();
  if (!cycleStartDate) return NextResponse.json({ error: "cycleStartDate required" }, { status: 400 });
  const settings = await (prisma as any).cycleSettings.upsert({
    where: { id: 1 },
    create: { id: 1, cycleStartDate: new Date(cycleStartDate) },
    update: { cycleStartDate: new Date(cycleStartDate) },
  });
  return NextResponse.json({ cycleStartDate: settings.cycleStartDate.toISOString().slice(0, 10) });
}
