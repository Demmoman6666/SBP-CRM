import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { customerId } = await req.json();
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  // Fetch all customer data
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      rep: { select: { name: true } },
    },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  // Last 10 call logs
  const calls = await (prisma as any).callLog.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Last 12 months orders
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const orders = await prisma.order.findMany({
    where: { customerId, processedAt: { gte: twelveMonthsAgo } },
    orderBy: { processedAt: "desc" },
    take: 20,
    include: { lineItems: { select: { productVendor: true, productTitle: true, quantity: true, total: true } } },
  });

  // Notes
  const notes = await (prisma as any).note.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // Build brand spend summary
  const brandSpend: Record<string, number> = {};
  for (const order of orders) {
    for (const li of order.lineItems) {
      if (li.productVendor) {
        brandSpend[li.productVendor] = (brandSpend[li.productVendor] || 0) + Number(li.total || 0);
      }
    }
  }

  const totalSpend = orders.reduce((s, o) => s + Number((o as any).total || 0), 0);
  const lastOrder = orders[0];
  const daysSinceLastOrder = lastOrder?.processedAt
    ? Math.floor((Date.now() - new Date(lastOrder.processedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const prompt = `You are a sales coach for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK. Generate a concise pre-call intelligence brief for a field sales rep who is about to visit this salon.

CUSTOMER PROFILE
Salon: ${(customer as any).salonName || "Unknown"}
Contact: ${(customer as any).customerName || "Unknown"}
Phone: ${(customer as any).customerTelephone || "Unknown"}
Address: ${[(customer as any).addressLine1, (customer as any).town, (customer as any).postCode].filter(Boolean).join(", ")}
Chairs: ${(customer as any).numberOfChairs || "Unknown"}
Stage: ${(customer as any).stage || "Unknown"}
Sales Rep: ${(customer as any).rep?.name || (customer as any).salesRep || "Unknown"}
Notes on file: ${notes.map((n: any) => n.text || n.body || "").filter(Boolean).join(" | ") || "None"}

ORDER HISTORY (last 12 months)
Total spend: £${totalSpend.toFixed(2)}
Total orders: ${orders.length}
Last order: ${lastOrder ? `${daysSinceLastOrder} days ago (£${Number((lastOrder as any).total || 0).toFixed(2)})` : "Never ordered"}
Brand breakdown: ${Object.entries(brandSpend).sort((a,b) => b[1]-a[1]).map(([b,s]) => `${b}: £${s.toFixed(2)}`).join(", ") || "No orders"}

CALL HISTORY (last 10 calls)
${calls.length === 0 ? "No calls logged yet." : calls.map((c: any, i: number) => `${i+1}. [${new Date(c.createdAt).toLocaleDateString("en-GB")}] ${c.callType||"Call"} | Outcome: ${c.outcome||"Unknown"} | ${c.summary||"No notes"}${c.followUpAt ? ` | Follow-up: ${new Date(c.followUpAt).toLocaleDateString("en-GB")}` : ""}`).join("\n")}

OUR 4 BRANDS: REF Stockholm, Neal & Wolf, Goddess Maintenance Company, Procare

Generate a brief structured as follows. Be specific, direct and actionable. Max 300 words total.

## 🎯 Visit Objective
One sentence: what is the #1 goal for this visit?

## 📊 Account Status
2-3 bullet points on their current status — order trend, engagement level, how long since last order.

## 💡 Opportunity
Which of our 4 brands are they NOT buying or under-buying? Specific product opportunity based on their history.

## 📝 Key Talking Points
3 specific things to mention or ask during this visit, based on their history.

## ⚠️ Watch Out For
Any red flags, overdue follow-ups, or things to be aware of.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || "API error");
    const text = json?.content?.[0]?.text || "";
    return NextResponse.json({ brief: text, customerName: (customer as any).salonName });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
