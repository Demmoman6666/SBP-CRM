import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { customerId, mode } = await req.json();
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { rep: { select: { name: true } } },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const calls = await (prisma as any).callLog.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const orders = await prisma.order.findMany({
    where: { customerId, processedAt: { gte: sixMonthsAgo } },
    orderBy: { processedAt: "desc" },
    take: 20,
    include: { lineItems: { select: { productVendor: true, productTitle: true, quantity: true, total: true } } },
  });

  const allOrders = await prisma.order.findMany({
    where: { customerId },
    orderBy: { processedAt: "desc" },
    take: 50,
    include: { lineItems: { select: { productVendor: true, productTitle: true, quantity: true, total: true } } },
  });

  const notes = await (prisma as any).note.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const c = customer as any;

  const brandSpend: Record<string, number> = {};
  const brandProducts: Record<string, Set<string>> = {};
  for (const order of allOrders) {
    for (const li of order.lineItems) {
      if (li.productVendor) {
        brandSpend[li.productVendor] = (brandSpend[li.productVendor] || 0) + Number(li.total || 0);
        if (!brandProducts[li.productVendor]) brandProducts[li.productVendor] = new Set();
        brandProducts[li.productVendor].add(li.productTitle || "Unknown");
      }
    }
  }

  const totalSpend = allOrders.reduce((s, o) => s + Number((o as any).total || 0), 0);
  const last6mSpend = orders.reduce((s, o) => s + Number((o as any).total || 0), 0);
  const lastOrder = allOrders[0];
  const daysSinceLast = lastOrder?.processedAt
    ? Math.floor((Date.now() - new Date(lastOrder.processedAt).getTime()) / 86400000)
    : null;

  const OUR_BRANDS = ["REF Stockholm", "Neal & Wolf", "Goddess Maintenance Company", "Procare"];
  const missingBrands = OUR_BRANDS.filter(b => !brandSpend[b]);
  const topBrand = Object.entries(brandSpend).sort((a, b) => b[1] - a[1])[0]?.[0];

  const customerProfile = `
Salon: ${c.salonName || "Unknown"}
Contact: ${c.customerName || "Unknown"}
Phone: ${c.customerTelephone || "Unknown"}
Address: ${[c.addressLine1, c.town, c.postCode].filter(Boolean).join(", ")}
Chairs: ${c.numberOfChairs || "Unknown"}
Stage: ${c.stage || "Unknown"}
Rep: ${c.rep?.name || c.salesRep || "Unknown"}
Notes: ${notes.map((n: any) => n.text || n.body || "").filter(Boolean).join(" | ") || "None"}`;

  const orderHistory = `
Total lifetime spend: GBP ${totalSpend.toFixed(2)}
Last 6 months spend: GBP ${last6mSpend.toFixed(2)}
Total orders (all time): ${allOrders.length}
Last order: ${lastOrder ? daysSinceLast + " days ago" : "Never ordered"}
Brand breakdown: ${Object.entries(brandSpend).sort((a, b) => b[1] - a[1]).map(([b, s]) => b + ": GBP " + s.toFixed(2)).join(", ") || "None"}
Brands NOT bought: ${missingBrands.join(", ") || "Buys all brands"}
Top brand: ${topBrand || "None"}`;

  const callHistory = calls.length === 0 ? "No calls logged." : calls.map((c: any, i: number) =>
    (i + 1) + ". [" + new Date(c.createdAt).toLocaleDateString("en-GB") + "] " + (c.callType || "Call") + " | Outcome: " + (c.outcome || "Unknown") + " | " + (c.summary || "No notes") + (c.followUpAt ? " | Follow-up: " + new Date(c.followUpAt).toLocaleDateString("en-GB") : "")
  ).join("\n");

  let prompt = "";

  if (mode === "snapshot") {
    prompt = `You are a sales analyst for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK. Generate a comprehensive business snapshot report for this customer.

CUSTOMER PROFILE
${customerProfile}

ORDER HISTORY (last 6 months + all time)
${orderHistory}

CALL HISTORY (last 10 calls)
${callHistory}

OUR 4 BRANDS: REF Stockholm, Neal & Wolf, Goddess Maintenance Company, Procare

Generate a structured business snapshot report:

## Business Snapshot: ${c.salonName}
Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}

## Account Overview
Summary of the account status, relationship length, and overall health.

## Revenue Analysis (Last 6 Months)
Break down their spending patterns, trends, and how they compare to a typical active account.

## Brand Performance
For each of our 4 brands, show what they buy, what they spend, and rate penetration as Strong / Moderate / Low / None.

## GAP Analysis
Which brands or product categories are they NOT buying that similar salons are? Be specific about the opportunity value.

## Opportunity Areas
Top 3 specific revenue opportunities with estimated values based on their salon size and current spending patterns.

## Relationship Health
Based on call frequency, outcomes, and order patterns - rate the relationship and explain why.

## Recommended Actions
5 specific next steps to grow this account over the next 90 days.

## Key Numbers
Quick bullet summary of the most important metrics.

Be specific, data-driven and direct. This is a professional business document.`;
  } else {
    prompt = `You are a sales coach for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK. Generate a concise pre-call intelligence brief for a rep about to visit this salon.

CUSTOMER PROFILE
${customerProfile}

ORDER HISTORY
${orderHistory}

CALL HISTORY (last 10 calls)
${callHistory}

OUR 4 BRANDS: REF Stockholm, Neal & Wolf, Goddess Maintenance Company, Procare

Generate a focused pre-call brief. Max 300 words. Be specific and direct.

## Visit Objective
One sentence: what is the number 1 goal for this visit?

## Account Status
2-3 bullets on current status, order trend, engagement level.

## Opportunity
Which brands are they NOT buying? Specific product to pitch based on their history and salon size.

## Talking Points
3 specific things to mention or ask, based on their actual call history and orders.

## Watch Out For
Any red flags, overdue follow-ups, or things to handle carefully.`;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || "API error");
    const text = json?.content?.[0]?.text || "";
    return NextResponse.json({ brief: text, customerName: c.salonName, mode });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
