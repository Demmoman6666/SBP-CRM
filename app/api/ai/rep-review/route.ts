import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { repId } = await req.json();
  if (!repId) return NextResponse.json({ error: "repId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const rep = await prisma.salesRep.findUnique({ where: { id: repId } });
  if (!rep) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [calls, totalCustomers, customersByStage, newCustomers, overdueFollowUps] = await Promise.all([
    (prisma as any).callLog.findMany({
      where: {
        OR: [{ repId: rep.id }, { staff: { equals: rep.name, mode: "insensitive" } }],
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        createdAt: true, callType: true, outcome: true, durationMinutes: true,
        followUpRequired: true, followUpAt: true, summary: true,
      },
    }),
    prisma.customer.count({ where: { salesRepId: rep.id } }),
    prisma.customer.groupBy({ by: ["stage"], where: { salesRepId: rep.id }, _count: { _all: true } }),
    prisma.customer.count({ where: { salesRepId: rep.id, createdAt: { gte: thirtyDaysAgo } } }),
    (prisma as any).callLog.count({
      where: {
        OR: [{ repId: rep.id }, { staff: { equals: rep.name, mode: "insensitive" } }],
        followUpRequired: true,
        followUpAt: { lt: new Date() },
      },
    }),
  ]);

  const orders = await prisma.order.findMany({
    where: { customer: { salesRepId: rep.id }, processedAt: { gte: thirtyDaysAgo } },
    select: { total: true },
  });
  const revenue = orders.reduce((s, o) => s + Number((o as any).total || 0), 0);

  const totalCalls = calls.length;
  const callTypeBreakdown: Record<string, number> = {};
  const outcomeBreakdown: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;

  for (const c of calls) {
    const t = c.callType || "Unspecified";
    callTypeBreakdown[t] = (callTypeBreakdown[t] || 0) + 1;
    const o = c.outcome || "Unspecified";
    outcomeBreakdown[o] = (outcomeBreakdown[o] || 0) + 1;
    if (typeof c.durationMinutes === "number") {
      totalDuration += c.durationMinutes;
      durationCount++;
    }
  }

  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;
  const stageBreakdown = customersByStage.map((s: any) => s.stage + ": " + s._count._all).join(", ");

  const prompt = `You are a sales manager reviewing one of your field reps for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK.

REP: ${rep.name}
PERIOD: Last 30 days

ACTIVITY DATA
Total calls logged: ${totalCalls}
Average call duration: ${avgDuration} minutes
Call types: ${Object.entries(callTypeBreakdown).map(([k, v]) => k + ": " + v).join(", ") || "None"}
Call outcomes: ${Object.entries(outcomeBreakdown).map(([k, v]) => k + ": " + v).join(", ") || "None"}
Overdue follow-ups: ${overdueFollowUps}

CUSTOMER BOOK
Total customers assigned: ${totalCustomers}
New customers added (last 30 days): ${newCustomers}
Pipeline by stage: ${stageBreakdown || "No data"}

REVENUE
Revenue generated (last 30 days, attributed to this rep's customers): GBP ${revenue.toFixed(2)}

INSTRUCTIONS
Write a short, honest, manager-ready performance summary. Maximum 200 words. Structure:

## Summary
2-3 sentences on overall performance this period - direct and specific, using the actual numbers.

## Strengths
1-2 bullet points on what's going well.

## Watch Areas
1-2 bullet points on anything concerning - low call volume, high overdue follow-ups, low conversion, etc. Only flag genuine concerns, don't invent problems if the data looks healthy.

## Suggested Talking Point for 1:1
One specific, actionable thing to discuss with this rep in their next check-in.

Be direct and data-driven. This is for internal management use.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || "API error");
    const text = json?.content?.[0]?.text || "";
    return NextResponse.json({ review: text, repName: rep.name });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
