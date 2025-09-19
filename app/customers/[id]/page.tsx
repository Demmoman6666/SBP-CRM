// app/customers/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

function money(n?: any, currency: string = "GBP") {
  if (n == null) return "-";
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  if (!Number.isFinite(num)) return String(n);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(num);
  } catch {
    return num.toFixed(2);
  }
}

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function CustomerPage({ params, searchParams }: PageProps) {
  const tab = (Array.isArray(searchParams?.tab)
    ? searchParams?.tab[0]
    : searchParams?.tab) as "orders" | "drafts" | undefined;

  const view: "orders" | "drafts" = tab === "drafts" ? "drafts" : "orders";

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      salonName: true,
      customerName: true,
      customerTelephone: true,
      customerEmailAddress: true,
      addressLine1: true,
      addressLine2: true,
      town: true,
      county: true,
      postCode: true,
      shopifyCustomerId: true,
    },
  });

  if (!customer) return notFound();

  // Orders (from CRM DB)
  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  // Drafts (live from Shopify, filtered by this customer)
  let drafts: any[] = [];
  if (customer.shopifyCustomerId) {
    try {
      const res = await shopifyRest(`/draft_orders.json?status=open&limit=50`, {
        method: "GET",
      });
      if (res.ok) {
        const json = await res.json();
        const scid = Number(customer.shopifyCustomerId);
        drafts = (json?.draft_orders || []).filter(
          (d: any) => Number(d?.customer?.id) === scid
        );
      }
    } catch {
      drafts = [];
    }
  }

  const currency = "GBP";
  const addr = [
    customer.addressLine1,
    customer.addressLine2,
    customer.town,
    customer.county,
    customer.postCode,
  ]
    .filter(Boolean)
    .join(", ");

  // ---------- Server Action: create Stripe Payment Link from a Shopify draft ----------
  async function createPaymentLinkAction(formData: FormData) {
    "use server";
    const draftId = String(formData.get("draftId") || "");
    if (!draftId) throw new Error("Missing draftId");

    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) throw new Error("Missing STRIPE_SECRET_KEY");

    // 1) Load the draft (for line items and titles)
    const resp = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to load draft: ${resp.status} ${txt}`);
    }
    const draft = (await resp.json())?.draft_order as any;
    const draftLines = (draft?.line_items || []) as Array<{
      variant_id?: number;
      quantity?: number;
      price?: string | number; // unit ex VAT
      title?: string;
      variant_title?: string | null;
    }>;

    if (!Array.isArray(draftLines) || draftLines.length === 0) {
      throw new Error("Draft has no line items");
    }

    // 2) Build Prices (VAT-inclusive) and line_items for Payment Link
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
    const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];

    // create ephemeral Prices so TS stays happy (Payment Links prefers `price` over inline `price_data` in this SDK version)
    for (const li of draftLines) {
      const ex = Number(li.price ?? 0);
      const inc = ex * (1 + VAT_RATE);
      const unit_amount = Math.round(inc * 100);

      const name = `${li.title ?? "Item"}${li.variant_title ? ` — ${li.variant_title}` : ""}`;

      const price = await stripe.prices.create({
        currency: "gbp",
        unit_amount,
        tax_behavior: "inclusive", // total already includes VAT
        product_data: {
          name,
          metadata: {
            variantId: li.variant_id ? String(li.variant_id) : "",
          },
        },
      });

      line_items.push({
        price: price.id,
        quantity: Number(li.quantity || 1),
      });
    }

    const sharedMeta = {
      crmCustomerId: customer.id,
      shopifyCustomerId: customer.shopifyCustomerId || "",
      crmDraftOrderId: String(draftId),
      source: "SBP-CRM",
    };

    // 3) Create the Payment Link (redirect back to the customer after payment)
    const origin =
      process.env.APP_URL?.replace(/\/$/, "") || "https://"+(process.env.VERCEL_URL || "").replace(/\/$/,"");

    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: {
        type: "redirect",
        redirect: {
          url: `${origin}/customers/${customer.id}?paid=1`,
        },
      },
      // Make sure webhook can find the draft/order to complete:
      metadata: sharedMeta,
      payment_intent_data: { metadata: sharedMeta },
      // We already included VAT in unit_amount values:
      automatic_tax: { enabled: false },
    });

    redirect(link.url!);
  }
  // -------------------------------------------------------------------------------

  const ordersCount = orders.length;
  const draftsCount = drafts.length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header / identity */}
      <section className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <h1 style={{ margin: 0 }}>
            {customer.salonName || customer.customerName || "Customer"}
          </h1>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/orders/new?customerId=${customer.id}`}>
              Create Order
            </Link>
            <Link className="primary" href={`/customers`}>
              Back
            </Link>
          </div>
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <b>Contact</b>
            <p className="small" style={{ marginTop: 6 }}>
              {customer.customerName || "-"}
              <br />
              {customer.customerTelephone || "-"}
              <br />
              {customer.customerEmailAddress || "-"}
            </p>
          </div>
          <div>
            <b>Location</b>
            <p className="small" style={{ marginTop: 6 }}>{addr || "-"}</p>
          </div>
        </div>
      </section>

      {/* Orders / Drafts switcher */}
      <section className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <h3 style={{ margin: 0 }}>Orders / Drafts</h3>
          <div className="row" style={{ gap: 8 }}>
            <Link
              href={`/customers/${customer.id}?tab=orders`}
              className={`btn ${view === "orders" ? "primary" : ""}`}
            >
              Orders ({ordersCount})
            </Link>
            <Link
              href={`/customers/${customer.id}?tab=drafts`}
              className={`btn ${view === "drafts" ? "primary" : ""}`}
            >
              Drafts ({draftsCount})
            </Link>
          </div>
        </div>

        {view === "orders" ? (
          orders.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              No orders yet.
            </p>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px 140px 120px 120px 1fr auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <div className="small muted">Date</div>
                <div className="small muted">Order</div>
                <div className="small muted">Subtotal</div>
                <div className="small muted">Taxes</div>
                <div className="small muted">Total</div>
                <div className="small muted">Action</div>

                {orders.map((o) => (
                  <div key={o.id} style={{ display: "contents" }}>
                    <div className="small">
                      {new Date(o.createdAt).toLocaleString()}
                    </div>
                    <div>{o.shopifyName || `#${o.shopifyOrderNumber ?? "-"}`}</div>
                    <div>{money(o.subtotal, currency)}</div>
                    <div>{money(o.taxes, currency)}</div>
                    <div style={{ fontWeight: 600 }}>
                      {money(o.total, currency)}
                    </div>
                    <div>
                      <Link className="btn" href={`/orders/${o.id}`}>
                        View
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : drafts.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            No draft orders for this customer.
          </p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 160px 120px 120px 120px auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div className="small muted">Created</div>
              <div className="small muted">Draft ID</div>
              <div className="small muted">Subtotal</div>
              <div className="small muted">Taxes</div>
              <div className="small muted">Total</div>
              <div className="small muted">Action</div>

              {drafts.map((d: any) => {
                const adminUrl =
                  `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "")
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}/admin/draft_orders/${d.id}`;

                const subtotal =
                  d.subtotal_price ?? d.subtotal ?? d.total_line_items_price;
                const taxes = d.total_tax ?? 0;
                const total = d.total_price ?? 0;

                return (
                  <div key={d.id} style={{ display: "contents" }}>
                    <div className="small">
                      {d.created_at
                        ? new Date(d.created_at).toLocaleString()
                        : "-"}
                    </div>
                    <div>#{d.id}</div>
                    <div>{money(subtotal, currency)}</div>
                    <div>{money(taxes, currency)}</div>
                    <div style={{ fontWeight: 600 }}>
                      {money(total, currency)}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <a
                        className="btn"
                        href={adminUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in Shopify"
                      >
                        View in Shopify
                      </a>

                      {/* Create Stripe Payment Link (server action) */}
                      <form action={createPaymentLinkAction}>
                        <input type="hidden" name="draftId" value={String(d.id)} />
                        <button
                          className="primary"
                          type="submit"
                          disabled={!customer.shopifyCustomerId}
                          title={
                            customer.shopifyCustomerId
                              ? "Create Stripe payment link for this draft"
                              : "Customer is not linked to Shopify"
                          }
                        >
                          Payment link
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
