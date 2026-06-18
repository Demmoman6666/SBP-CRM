"use server";

import { redirect } from "next/navigation";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

const TERMS = [
  { value: "Due on receipt", dueInDays: null },
  { value: "Due on fulfillment", dueInDays: null },
  { value: "Net 7", dueInDays: 7 },
  { value: "Net 15", dueInDays: 15 },
  { value: "Net 30", dueInDays: 30 },
  { value: "Net 45", dueInDays: 45 },
  { value: "Net 60", dueInDays: 60 },
  { value: "Net 90", dueInDays: 90 },
];

function uiLabelToCanonicalName(input?: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  if (/^(Due on receipt|Due on fulfillment|Net (7|15|30|45|60|90)|Fixed date)$/i.test(s)) return s;
  const within = s.match(/within\s+(\d+)\s*days?/i);
  if (within) return `Net ${Number(within[1])}`;
  const m = s.match(/net\s*(\d+)/i) || s.match(/\b(\d{1,3})\b/);
  if (m) { const d = Number(m[1]); if ([7,15,30,45,60,90].includes(d)) return `Net ${d}`; }
  if (/receipt/i.test(s)) return "Due on receipt";
  if (/fulfil?ment/i.test(s)) return "Due on fulfillment";
  return null;
}

export async function savePaymentTerms(customerId: string, formData: FormData) {
  const enabled = formData.get("paymentDueLater") === "on";
  if (!enabled) {
    await prisma.customer.update({ where: { id: customerId }, data: { paymentDueLater: false, paymentTermsName: null, paymentTermsDueInDays: null } });
    redirect(`/customers/${customerId}?saved=1`);
  }
  const nameRaw = String(formData.get("paymentTermsName") || "Due on receipt").trim();
  const canonicalName = uiLabelToCanonicalName(nameRaw) || "Due on receipt";
  const term = TERMS.find(t => t.value === canonicalName);
  const dueDays = (typeof term?.dueInDays === "number" ? term.dueInDays : null) as number | null;
  await prisma.customer.update({ where: { id: customerId }, data: { paymentDueLater: true, paymentTermsName: canonicalName, paymentTermsDueInDays: dueDays } });
  redirect(`/customers/${customerId}?saved=1`);
}

export async function createPaymentLink(customerId: string, shopifyCustomerId: string | null, formData: FormData) {
  const draftId = String(formData.get("draftId") || "");
  if (!draftId) throw new Error("Missing draftId");
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) throw new Error("Missing STRIPE_SECRET_KEY");
  const resp = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
  if (!resp.ok) throw new Error(`Failed to load draft: ${resp.status}`);
  const draft = (await resp.json())?.draft_order as any;
  const draftLines = (draft?.line_items || []) as any[];
  if (!draftLines.length) throw new Error("Draft has no line items");
  const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
  const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];
  for (const li of draftLines) {
    const inc = Number(li.price ?? 0) * (1 + VAT_RATE);
    const itemName = (li.title || "Item") + (li.variant_title ? " — " + li.variant_title : "");
    const price = await stripe.prices.create({ currency: "gbp", unit_amount: Math.round(inc * 100), tax_behavior: "inclusive", product_data: { name: itemName } });
    line_items.push({ price: price.id, quantity: Number(li.quantity || 1) });
  }
  const origin = process.env.APP_URL?.replace(/\/$/, "") || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const sharedMeta = { crmCustomerId: customerId, shopifyCustomerId: shopifyCustomerId || "", crmDraftOrderId: String(draftId), source: "SBP-CRM" };
  const link = await stripe.paymentLinks.create({ line_items, after_completion: { type: "redirect", redirect: { url: `${origin}/customers/${customerId}?paid=1` } }, metadata: sharedMeta, payment_intent_data: { metadata: sharedMeta }, automatic_tax: { enabled: false } });
  redirect(link.url!);
}
