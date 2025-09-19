// app/customers/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

/* ------------ money + tiny prettifiers ------------ */
function money(n?: any, currency: string = "GBP") {
  if (n == null) return "-";
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  if (!Number.isFinite(num)) return String(n);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(num);
  } catch {
    return num.toFixed(2);
  }
}
const prettyFinancial = (s?: string | null) => {
  const k = (s || "").toLowerCase();
  if (!k) return "—";
  if (k.includes("paid")) return "Paid";
  if (k.includes("authorized") || k.includes("pending")) return "Pending";
  if (k.includes("partially")) return "Partially paid";
  if (k.includes("refunded") || k.includes("void")) return "Refunded";
  return s!;
};
const prettyFulfillment = (s?: string | null) => {
  const k = (s || "").toLowerCase();
  if (!k) return "—";
  if (k.includes("fulfilled")) return "Fulfilled";
  if (k.includes("partial")) return "Partially fulfilled";
  if (k.includes("unfulfilled")) return "Unfulfilled";
  if (k.includes("cancel")) return "Cancelled";
  return s!;
};
/* -------------------------------------------------- */

/** DD/MM/YYYY */
function fmtDate(d: any): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function CustomerPage({ params, searchParams }: PageProps) {
  const tab = (Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab) as
    | "orders"
    | "drafts"
    | undefined;
  const view: "orders" | "drafts" = tab === "drafts" ? "drafts" : "orders";

  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
  });
  if (!customer) return notFound();

  // Orders (from CRM DB) – newest first
  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  // Also fetch Shopify statuses + Shopify dates so UI can match Shopify
  const idCandidates = orders
    .map((o: any) => Number(o.shopifyOrderId ?? o.shopifyId ?? o.shopify_order_id))
    .filter((n) => Number.isFinite(n)) as number[];

  let shopifyById = new Map<
    number,
    {
      financial_status?: string | null;
      fulfillment_status?: string | null;
      created_at?: string | null;
      processed_at?: string | null;
    }
  >();

  if (idCandidates.length) {
    try {
      const idsParam = encodeURIComponent(idCandidates.join(","));
      // ⬅️ include created_at and processed_at
      const res = await shopifyRest(
        `/orders.json?ids=${idsParam}&status=any&fields=id,financial_status,fulfillment_status,created_at,processed_at`,
        { method: "GET" }
      );
      if (res.ok) {
        const json = await res.json();
        const arr: Array<any> = json?.orders || [];
        for (const o of arr) {
          shopifyById.set(Number(o.id), {
            financial_status: o.financial_status ?? null,
            fulfillment_status: o.fulfillment_status ?? null,
            created_at: o.created_at ?? null,
            processed_at: o.processed_at ?? null,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Drafts (live from Shopify for this customer) – newest first
  let drafts: any[] = [];
  if ((customer as any).shopifyCustomerId) {
    try {
      const res = await shopifyRest(`/draft_orders.json?status=open&limit=50`, { method: "GET" });
      if (res.ok) {
        const json = await res.json();
        const scid = Number((customer as any).shopifyCustomerId);
        drafts = (json?.draft_orders || [])
          .filter((d: any) => Number(d?.customer?.id) === scid)
          .sort((a: any, b: any) => {
            const ad = a?.created_at ? Date.parse(a.created_at) : 0;
            const bd = b?.created_at ? Date.parse(b.created_at) : 0;
            return bd - ad; // newest first
          });
      }
    } catch {
      drafts = [];
    }
  }

  const currency = "GBP";
  const addr = [
    (customer as any).addressLine1,
    (customer as any).addressLine2,
    (customer as any).town,
    (customer as any).county,
    (customer as any).postCode,
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

    // 1) Load the draft
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
    if (!Array.isArray(draftLines) || draftLines.length === 0) throw new Error("Draft has no line items");

    // 2) Build Prices (VAT-inclusive) and line_items for Payment Link
    const stripe = new Stripe(stripeSecret, { apiVersion: "2023-10-16" });
    const line_items: Stripe.PaymentLinkCreateParams.LineItem[] = [];

    for (const li of draftLines) {
      const ex = Number(li.price ?? 0);
      const inc = ex * (1 + VAT_RATE);
      const unit_amount = Math.round(inc * 100);
      const name = `${li.title ?? "Item"}${li.variant_title ? ` — ${li.variant_title}` : ""}`;

      const price = await stripe.prices.create({
        currency: "gbp",
        unit_amount,
        tax_behavior: "inclusive",
        product_data: {
          name,
          metadata: { variantId: li.variant_id ? String(li.variant_id) : "" },
        },
      });

      line_items.push({ price: price.id, quantity: Number(li.quantity || 1) });
    }

    const sharedMeta = {
      crmCustomerId: customer.id,
      shopifyCustomerId: (customer as any).shopifyCustomerId || "",
      crmDraftOrderId: String(draftId),
      source: "SBP-CRM",
    };

    const origin =
      process.env.APP_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : "http://localhost:3000");

    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: {
        type: "redirect",
        redirect: { url: `${origin}/customers/${customer.id}?paid=1` },
      },
      metadata: sharedMeta,
      payment_intent_data: { metadata: sharedMeta },
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
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>
            {(customer as any).salonName || (customer as any).customerName || "Customer"}
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
              {(customer as any).customerName || "-"}
              <br />
              {(customer as any).customerTelephone || "-"}
              <br />
              {(customer as any).customerEmailAddress || "-"}
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
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
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
            <p className="small muted" style={{ marginTop: 8 }}>No orders yet.</p>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "170px 140px 140px 160px 120px 120px 120px auto",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <div className="small muted">Date</div>
                <div className="small muted">Order</div>
                <div className="small muted">Payment</div>
                <div className="small muted">Fulfillment</div>
                <div className="small muted">Subtotal</div>
                <div className="small muted">Taxes</div>
                <div className="small muted">Total</div>
                <div className="small muted">Action</div>

                {orders.map((o: any) => {
                  const sid = Number(o.shopifyOrderId ?? o.shopifyId ?? o.shopify_order_id);
                  const st = Number.isFinite(sid) ? shopifyById.get(sid) : undefined;

                  // ✅ Prefer Shopify dates so UI matches Shopify
                  const displayDate =
                    st?.processed_at ||
                    st?.created_at ||
                    (o.shopifyProcessedAt as any) ||
                    (o.shopifyCreatedAt as any) ||
                    o.createdAt;

                  const created = fmtDate(displayDate);
                  const name = o.shopifyName || (o.shopifyOrderNumber ? `#${o.shopifyOrderNumber}` : "-");

                  return (
                    <div key={o.id} style={{ display: "contents" }}>
                      <div className="small">{created}</div>
                      <div className="nowrap">{name}</div>
                      <div><span className="badge">{prettyFinancial(st?.financial_status)}</span></div>
                      <div><span className="badge">{prettyFulfillment(st?.fulfillment_status)}</span></div>
                      <div>{money(o.subtotal, currency)}</div>
                      <div>{money(o.taxes, currency)}</div>
                      <div style={{ fontWeight: 600 }}>{money(o.total, currency)}</div>
                      <div>
                        <Link className="btn" href={`/orders/${o.id}`}>
                          View
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : drafts.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>No draft orders for this customer.</p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "170px 160px 140px 160px 120px 120px 120px auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div className="small muted">Created</div>
              <div className="small muted">Draft ID</div>
              <div className="small muted">Payment</div>
              <div className="small muted">Fulfillment</div>
              <div className="small muted">Subtotal</div>
              <div className="small muted">Taxes</div>
              <div className="small muted">Total</div>
              <div className="small muted">Action</div>

              {drafts.map((d: any) => {
                const adminUrl = `https://${(process.env.SHOPIFY_SHOP_DOMAIN || "")
                  .replace(/^https?:\/\//, "")
                  .replace(/\/$/, "")}/admin/draft_orders/${d.id}`;
                const subtotal = d.subtotal_price ?? d.subtotal ?? d.total_line_items_price;
                const taxes = d.total_tax ?? 0;
                const total = d.total_price ?? 0;

                return (
                  <div key={d.id} style={{ display: "contents" }}>
                    <div className="small">
                      {fmtDate(d.created_at)}
                    </div>
                    <div>#{d.id}</div>
                    <div><span className="badge">—</span></div>
                    <div><span className="badge">—</span></div>
                    <div>{money(subtotal, currency)}</div>
                    <div>{money(taxes, currency)}</div>
                    <div style={{ fontWeight: 600 }}>{money(total, currency)}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <a className="btn" href={adminUrl} target="_blank" rel="noreferrer" title="Open in Shopify">
                        View in Shopify
                      </a>
                      <form action={createPaymentLinkAction}>
                        <input type="hidden" name="draftId" value={String(d.id)} />
                        <button
                          className="primary"
                          type="submit"
                          disabled={!(customer as any).shopifyCustomerId}
                          title={
                            (customer as any).shopifyCustomerId
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
