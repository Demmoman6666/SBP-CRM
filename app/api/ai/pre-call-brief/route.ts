import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  try {
    // Fetch customer with full history
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        callLogs: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: {
            stockedBrandLinks: { include: { brand: true } },
            competitorBrandLinks: { include: { brand: true } },
          },
        },
        notesLog: { orderBy: { createdAt: "desc" }, take: 5 },
        visits: { orderBy: { date: "desc" }, take: 5 },
        orders: {
          orderBy: { processedAt: "desc" },
          take: 20,
          include: {
            lineItems: {
              select: { productTitle: true, productVendor: true, quantity: true, price: true },
            },
          },
        },
      },
    });

    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Get stocked brands for gap analysis
    const stockedBrands = await prisma.stockedBrand.findMany({
      where: { visibleInReports: true },
      select: { name: true },
    });
    const brandNames = stockedBrands.map(b => b.name);

    // Work out which brands this customer has ordered
    const orderedBrands = new Set<string>();
    for (const order of customer.orders) {
      for (const li of order.lineItems) {
        if (li.productVendor && brandNames.includes(li.productVendor)) {
          orderedBrands.add(li.productVendor);
        }
      }
    }
    const missingBrands = brandNames.filter(b => !orderedBrands.has(b));

    // Last order date and value
    const lastOrder = customer.orders[0];
    const daysSinceLastOrder = lastOrder?.processedAt
      ? Math.floor((Date.now() - new Date(lastOrder.processedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // Average order value
    const orderValues = customer.orders
      .filter(o => o.total && Number(o.total) > 0)
      .map(o => Number(o.total));
    const avgOrderValue = orderValues.length
      ? orderValues.reduce((a, b) => a + b, 0) / orderValues.length
      : 0;

    // Total spend
    const totalSpend = orderValues.reduce((a, b) => a + b, 0);

    // Most recent call summary
    const recentCalls = customer.callLogs.slice(0, 5).map(c => ({
      date: c.createdAt.toISOString().slice(0, 10),
      type: c.callType || "Unknown",
      outcome: c.outcome || "Unknown",
      summary: c.summary?.slice(0, 200) || null,
      stockedBrands: c.stockedBrandLinks.map(l => l.brand.name),
      competitorBrands: c.competitorBrandLinks.map(l => l.brand.name),
      followUp: c.followUpAt ? c.followUpAt.toISOString().slice(0, 10) : null,
    }));

    // Top products ordered
    const productCounts = new Map<string, number>();
    for (const order of customer.orders) {
      for (const li of order.lineItems) {
        if (li.productTitle) {
          productCounts.set(li.productTitle, (productCounts.get(li.productTitle) || 0) + (li.quantity || 1));
        }
      }
    }
    const topProducts = Array.from(productCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, qty]) => `${name} (×${qty})`);

    const prompt = `You are a sales coach for Salon Brands Pro, a professional hair and beauty product distributor in South Wales, UK. You are generating a PRE-CALL INTELLIGENCE BRIEF for a sales rep who is about to visit this salon.

SALON DETAILS
Name: ${customer.salonName}
Contact: ${customer.customerName || "Unknown"}
Address: ${[customer.addressLine1, customer.addressLine2, customer.town, customer.county, customer.postCode].filter(Boolean).join(", ")}
Chairs: ${customer.numberOfChairs || "Unknown"}
Stage: ${customer.stage}
Phone: ${customer.customerTelephone || "Not on file"}
Email: ${customer.customerEmailAddress || "Not on file"}

ORDER HISTORY
Total Orders: ${customer.orders.length}
Total Spend: £${totalSpend.toFixed(2)}
Average Order Value: £${avgOrderValue.toFixed(2)}
Last Order: ${lastOrder?.processedAt ? `${daysSinceLastOrder} days ago (${lastOrder.processedAt.toISOString().slice(0, 10)})` : "Never ordered"}
Top Products: ${topProducts.length ? topProducts.join(", ") : "None on record"}

BRAND ANALYSIS
Brands they buy from us: ${orderedBrands.size > 0 ? Array.from(orderedBrands).join(", ") : "None yet"}
Brands they DON'T buy from us: ${missingBrands.length > 0 ? missingBrands.join(", ") : "Stocks all our brands"}

RECENT CALL HISTORY (last ${recentCalls.length} calls)
${recentCalls.length === 0 ? "No calls on record" : recentCalls.map((c, i) =>
  `${i+1}. [${c.date}] ${c.type} | Outcome: ${c.outcome}${c.summary ? ` | "${c.summary}"` : ""}${c.followUp ? ` | Follow-up: ${c.followUp}` : ""}${c.competitorBrands.length ? ` | Competitor brands: ${c.competitorBrands.join(", ")}` : ""}`
).join("\n")}

NOTES
${customer.notesLog.slice(0, 3).map(n => `- ${n.createdAt.toISOString().slice(0, 10)}: ${n.text}`).join("\n") || "No notes on record"}

INSTRUCTIONS
Write a concise, practical pre-call brief the rep can read in 60 seconds on their phone before walking into the salon. Structure it exactly like this:

## 🎯 Objective for This Visit
One clear sentence — what should the rep try to achieve today?

## 📊 Quick Stats
3-4 bullet points with the most important numbers (last order, spend, days since contact etc)

## 💰 Sales Opportunity
What's the biggest revenue opportunity here? Be specific — which product or brand to pitch and why, based on their history and gaps.

## 📞 Last Visit Summary
What happened last time? What was promised or discussed? Any follow-up required?

## ⚠️ Watch Points
Any concerns — overdue follow-ups, declining spend, competitor brands they're stocking, objections previously raised.

## 💬 Conversation Starters
2-3 specific, natural opening lines the rep can actually use when they walk in.

## ✅ Must Do Today
A checklist of 2-3 specific actions the rep should complete during this visit.

Keep it tight, honest and actionable. No waffle. This is for a rep standing outside the salon door.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const aiJson = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiJson?.error?.message || "AI error");
    const text = aiJson?.content?.[0]?.text || "";

    return NextResponse.json({ brief: text, customer: { name: customer.salonName, stage: customer.stage, daysSinceLastOrder } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
