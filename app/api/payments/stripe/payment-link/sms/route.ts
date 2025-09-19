import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

// --- utils -------------------------------------------------------------

function toE164(input: string, defaultCountry = "GB"): string {
  let s = (input || "").trim();
  if (!s) return s;
  // strip spaces, dashes, parentheses
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return s;
  // naive UK normaliser: 0xxxx -> +44xxxx (drop leading 0)
  if (defaultCountry === "GB") {
    if (s.startsWith("0")) return `+44${s.slice(1)}`;
    if (s.length === 10 || s.length === 11) return `+44${s}`;
  }
  // fallback: assume already international without '+'
  return `+${s}`;
}

async function sendTwilioSMS(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM || "";

  if (!sid || !token || !from) {
    throw new Error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM env vars");
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw new Error(`Twilio send failed: ${resp.status} ${text}`);
  return text;
}

async function readBody(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await req.json()) as any;
  }
  // support simple form posts
  const fd = await req.formData();
  const obj: Record<string, any> = {};
  fd.forEach((v, k) => (obj[k] = String(v)));
  return obj;
}

// --- main --------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const { draftId, customerId, to: toRaw } = await readBody(req);

    if (!draftId) {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    // Pull CRM customer (to get phone + shopify id) if not provided explicitly
    let crm: { id: string; tel?: string | null; shopifyCustomerId?: string | null } | null = null;
    if (customerId) {
      const c = await prisma.customer.findUnique({
        where: { id: String(customerId) },
        select: { id: true, customerTelephone: true, shopifyCustomerId: true },
      });
      crm = c ? { id: c.id, tel: c.customerTelephone, shopifyCustomerId: c.shopifyCustomerId } : null;
    }

    // Destination number
    const toNumber = toE164(String(toRaw || crm?.tel || ""));
    if (!toNumber) {
      return NextResponse.json({ error: "Destination phone number missing" }, { status: 400 });
    }

    // Load the draft order from Shopify (for lines & titles)
    const draftRes = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
    const draftText = await draftRes.text().catch(() => "");
    if (!draftRes.ok) {
      return NextResponse.json(
        { error: `Failed to load draft: ${draftRes.status} ${draftText}` },
        { status: 502 }
      );
    }
    const draft = JSON.parse(draftText)?.draft_order as any;
    const draftLines = (draft?.line_items || []) as Array<{
      variant_id?: number;
      quantity?: number;
      price?: string | number; // unit EX VAT from Shopify
      title?: string;
      variant_title?: string | null;
    }>;

    if (!Array.isArray(draftLines) || draftLines.length === 0) {
      return NextResponse.json({ error: "Draft has no line items" }, { status: 400 });
    }

    // Build Stripe Payment Link (VAT inclusive)
    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY env var" }, { status: 500 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });

    const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];
    for (const li of draftLines) {
      const ex = Number(li.price ?? 0);
      const inc = ex * (1 + VAT_RATE);
      const unit_amount = Math.round(inc * 100);

      const name = `${li.title ?? "Item"}${li.variant_title ? ` — ${li.variant_title}` : ""}`;

      // Create ephemeral price (Payment Links SDK prefers price id over inline price_data in this version)
      const price = await stripe.prices.create({
        currency: "gbp",
        unit_amount,
        tax_behavior: "inclusive",
        product_data: {
          name,
          metadata: {
            variantId: li.variant_id ? String(li.variant_id) : "",
            crmDraftOrderId: String(draftId),
          },
        },
      });

      line_items.push({
        price: price.id,
        quantity: Number(li.quantity || 1),
      });
    }

    const sharedMeta = {
      crmCustomerId: crm?.id || "",
      shopifyCustomerId: crm?.shopifyCustomerId || String(draft?.customer?.id || ""),
      crmDraftOrderId: String(draftId),
      source: "SBP-CRM",
    };

    const origin =
      process.env.APP_URL?.replace(/\/$/, "") ||
      "https://" + (process.env.VERCEL_URL || "").replace(/\/$/, "");

    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: {
        type: "redirect",
        redirect: { url: `${origin}/customers/${crm?.id || ""}?paid=1` },
      },
      metadata: sharedMeta,
      payment_intent_data: { metadata: sharedMeta },
      automatic_tax: { enabled: false },
    });

    // Fire the SMS
    const msg = `Salon Brands Pro – secure payment link: ${link.url}`;
    await sendTwilioSMS(toNumber, msg);

    // Optional: annotate draft for audit
    try {
      await shopifyRest(`/draft_orders/${draftId}.json`, {
        method: "PUT",
        body: JSON.stringify({
          draft_order: {
            id: Number(draftId),
            note: `${draft?.note ? draft.note + "\n" : ""}Payment link sent by SMS to ${toNumber}`,
          },
        }),
      });
    } catch {}

    return NextResponse.json({ ok: true, url: link.url, to: toNumber }, { status: 200 });
  } catch (err: any) {
    console.error("SMS payment link error:", err);
    return NextResponse.json({ error: err?.message || "Failed to send SMS" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
