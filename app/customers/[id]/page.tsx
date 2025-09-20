// app/customers/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VAT_RATE = Number(process.env.VAT_RATE ?? "0.20");

/* ------------ helpers: money, statuses, dates ------------ */
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
/** DD/MM/YYYY */
function fmtDate(d: any): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
/* -------------------------------------------------------- */

/* Opening hours normaliser -> neat table rows */
type DayRow = { day: string; open: boolean; from?: string | null; to?: string | null };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function normaliseOpeningHours(raw: any): DayRow[] {
  if (!raw) return [];
  let data: any = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (data && !Array.isArray(data) && typeof data === "object") {
    return DAYS.map((d) => {
      const entry = data[d] || data[d.toLowerCase()] || data[d.toUpperCase()];
      if (!entry) return { day: d, open: false };
      const open = !!(entry.open ?? entry.isOpen ?? entry.enabled);
      const from = entry.from ?? entry.start ?? null;
      const to = entry.to ?? entry.end ?? null;
      return { day: d, open, from, to };
    });
  }
  if (Array.isArray(data)) {
    const byDay: Record<string, DayRow> = {};
    for (const r of data) {
      if (!r) continue;
      const key: string = r.day || r.Day || r.name || r.weekday || "";
      const d = key.slice(0, 3);
      if (!d) continue;
      byDay[d] = {
        day: d,
        open: !!(r.open ?? r.isOpen ?? r.enabled),
        from: r.from ?? r.start ?? null,
        to: r.to ?? r.end ?? null,
      };
    }
    return DAYS.map((d) => byDay[d] || { day: d, open: false });
  }
  return [];
}

/* -------- Calls & notes loaders (broadened note fields) -------- */
function pickFirstString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function loadCalls(customerId: string) {
  const modelNames = ["call", "callLog", "customerCall", "calls"];
  for (const m of modelNames) {
    try {
      const model = (prisma as any)[m];
      if (!model?.findMany) continue;
      const rows: any[] = await model.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (Array.isArray(rows) && rows.length) {
        return rows.map((r) => ({
          id: r.id ?? r.callId ?? r._id,
          createdAt: r.createdAt ?? r.created_at ?? r.date ?? r.loggedAt,
          outcome: r.outcome ?? r.result ?? r.status ?? null,
          notes:
            pickFirstString(
              r.notes,
              r.note,
              r.callNotes,
              r.callNote,
              r.comments,
              r.comment,
              r.details,
              r.detail,
              r.message,
              r.description,
              r.summary,
              r.body,
              r.content
            ) || "",
        }));
      }
    } catch {}
  }
  return [];
}

async function loadNotes(customerId: string) {
  const modelNames = ["note", "customerNote", "notes"];
  for (const m of modelNames) {
    try {
      const model = (prisma as any)[m];
      if (!model?.findMany) continue;
      const rows: any[] = await model.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (Array.isArray(rows) && rows.length) {
        return rows.map((r) => ({
          id: r.id ?? r.noteId ?? r._id,
          createdAt: r.createdAt ?? r.created_at ?? r.date ?? r.loggedAt,
          body: pickFirstString(r.body, r.text, r.note, r.content, r.details, r.description, r.message) || "",
        }));
      }
    } catch {}
  }
  return [];
}
/* --------------------------------------------------------------- */

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

/* ---------- Shopify terms we’ll show in the selector ---------- */
const TERMS: Array<{ value: string; label: string; dueInDays?: number | null }> = [
  { value: "Due on receipt", label: "Due on receipt", dueInDays: null },
  { value: "Due on fulfillment", label: "Due on fulfillment", dueInDays: null },
  { value: "Net 7", label: "Net 7 days", dueInDays: 7 },
  { value: "Net 15", label: "Net 15 days", dueInDays: 15 },
  { value: "Net 30", label: "Net 30 days", dueInDays: 30 },
  { value: "Net 45", label: "Net 45 days", dueInDays: 45 },
  { value: "Net 60", label: "Net 60 days", dueInDays: 60 },
  { value: "Net 90", label: "Net 90 days", dueInDays: 90 },
];

/* ---------- Helpers for rendering terms nicely ---------- */
function displayTerms(name?: string | null, due?: number | null) {
  if (!name) return "—";
  const base = name;
  if (typeof due === "number" && Number.isFinite(due)) return `${base} (${due} days)`;
  return base;
}

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

  // Orders (from CRM DB)
  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  // Shopify statuses + dates
  const idCandidates = orders
    .map((o: any) => Number(o.shopifyOrderId ?? o.shopifyId ?? o.shopify_order_id))
    .filter((n) => Number.isFinite(n)) as number[];

  const shopifyById = new Map<
    number,
    { financial_status?: string | null; fulfillment_status?: string | null; created_at?: string | null; processed_at?: string | null }
  >();

  if (idCandidates.length) {
    try {
      const idsParam = encodeURIComponent(idCandidates.join(","));
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
    } catch {}
  }

  // Drafts for this Shopify customer
  let drafts: any[] = [];
  const shopifyCustomerId = (customer as any).shopifyCustomerId;
  if (shopifyCustomerId) {
    try {
      const res = await shopifyRest(`/draft_orders.json?status=open&limit=50`, { method: "GET" });
      if (res.ok) {
        const json = await res.json();
        const scid = Number(shopifyCustomerId);
        drafts = (json?.draft_orders || [])
          .filter((d: any) => Number(d?.customer?.id) === scid)
          .sort((a: any, b: any) => {
            const ad = a?.created_at ? Date.parse(a.created_at) : 0;
            const bd = b?.created_at ? Date.parse(b.created_at) : 0;
            return bd - ad;
          });
      }
    } catch {
      drafts = [];
    }
  }

  const calls = await loadCalls(customer.id);
  const notes = await loadNotes(customer.id);

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

  const salesRepName =
    (customer as any).salesRepName ||
    (customer as any).sales_rep_name ||
    (customer as any).salesRep ||
    (customer as any).accountManager ||
    (customer as any).rep ||
    null;

  const openingHoursRows = normaliseOpeningHours((customer as any).openingHours ?? (customer as any).opening_hours);

  /* ---------- Server Action: save payment terms on the customer ---------- */
  async function savePaymentTermsAction(formData: FormData) {
    "use server";
    const enabled = formData.get("paymentDueLater") === "on";

    // If not enabled: only flip the flag off; do NOT set a term.
    if (!enabled) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          paymentDueLater: false,
          paymentTermsName: null,
          paymentTermsDueInDays: null,
        },
      });
      // show success banner
      redirect(`/customers/${customer.id}?saved=1`);
    }

    // Enabled: persist the chosen term; default to "Due on receipt" if not provided
    const nameRaw = String(formData.get("paymentTermsName") || "Due on receipt").trim();

    // Map common Shopify labels to "due in days"
    const daysMap: Record<string, number | null> = {
      "Due on receipt": 0,
      "Due on fulfillment": 0,
      "Within 7 days": 7,
      "Within 15 days": 15,
      "Within 30 days": 30,
      "Within 45 days": 45,
      "Within 60 days": 60,
      "Within 90 days": 90,
      "Fixed date": null,
      "Net 7": 7,
      "Net 15": 15,
      "Net 30": 30,
      "Net 45": 45,
      "Net 60": 60,
      "Net 90": 90,
    };

    let dueDays: number | null | undefined = daysMap[nameRaw];
    if (typeof dueDays === "undefined") {
      const within = nameRaw.match(/within\s+(\d+)\s*days?/i);
      const net = nameRaw.match(/net\s+(\d+)/i);
      if (within) dueDays = Number(within[1]);
      else if (net) dueDays = Number(net[1]);
      else dueDays = null;
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        paymentDueLater: true,
        paymentTermsName: nameRaw,
        paymentTermsDueInDays: dueDays,
      },
    });

    // show success banner
    redirect(`/customers/${customer.id}?saved=1`);
  }

  // ---------- Server Action: create Stripe Payment Link from a Shopify draft ----------
  async function createPaymentLinkAction(formData: FormData) {
    "use server";
    const draftId = String(formData.get("draftId") || "");
    if (!draftId) throw new Error("Missing draftId");

    const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeSecret) throw new Error("Missing STRIPE_SECRET_KEY");

    // Load draft
    const resp = await shopifyRest(`/draft_orders/${draftId}.json`, { method: "GET" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Failed to load draft: ${resp.status} ${txt}`);
    }
    const draft = (await resp.json())?.draft_order as any;
    const draftLines = (draft?.line_items || []) as Array<{
      variant_id?: number;
      quantity?: number;
      price?: string | number;
      title?: string;
      variant_title?: string | null;
    }>;
    if (!Array.isArray(draftLines) || draftLines.length === 0) throw new Error("Draft has no line items");

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
        product_data: { name, metadata: { variantId: li.variant_id ? String(li.variant_id) : "" } },
      });
      line_items.push({ price: price.id, quantity: Number(li.quantity || 1) });
    }

    const sharedMeta = {
      crmCustomerId: customer.id,
      shopifyCustomerId: shopifyCustomerId || "",
      crmDraftOrderId: String(draftId),
      source: "SBP-CRM",
    };

    const origin =
      process.env.APP_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}` : "http://localhost:3000");

    const link = await stripe.paymentLinks.create({
      line_items,
      after_completion: { type: "redirect", redirect: { url: `${origin}/customers/${customer.id}?paid=1` } },
      metadata: sharedMeta,
      payment_intent_data: { metadata: sharedMeta },
      automatic_tax: { enabled: false },
    });

    redirect(link.url!);
  }
  // -------------------------------------------------------------------------------

  const ordersCount = orders.length;
  const draftsCount = drafts.length;

  /* Payment terms values currently stored for this customer */
  const paymentDueLater = (customer as any).paymentDueLater ?? false;
  const paymentTermsName = (customer as any).paymentTermsName ?? null;
  const paymentTermsDueInDays =
    typeof (customer as any).paymentTermsDueInDays === "number"
      ? (customer as any).paymentTermsDueInDays
      : null;

  // Was a save just performed?
  const saveSuccess = (Array.isArray(searchParams?.saved) ? searchParams?.saved[0] : searchParams?.saved) === "1";

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header / identity */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>{(customer as any).salonName || (customer as any).customerName || "Customer"}</h1>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/customers/${customer.id}/edit`}>Edit</Link>
            <Link className="btn" href={`/orders/new?customerId=${customer.id}`}>Create Order</Link>
            <Link className="primary" href={`/customers`}>Back</Link>
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
              <br />
              <span className="muted">Sales rep:</span> {salesRepName || "—"}
            </p>
          </div>

          <div>
            <b>Location</b>
            <p className="small" style={{ marginTop: 6 }}>{addr || "-"}</p>

            <b style={{ display: "block", marginTop: 10 }}>Opening hours</b>
            {openingHoursRows.length === 0 ? (
              <p className="small muted" style={{ marginTop: 6 }}>No opening hours set.</p>
            ) : (
              <div style={{ marginTop: 6, overflowX: "auto" }}>
                <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>Day</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>Status</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>From</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openingHoursRows.map((r) => (
                      <tr key={r.day} style={{ borderTop: "1px solid #eee" }}>
                        <td style={{ padding: "6px" }}>{r.day}</td>
                        <td style={{ padding: "6px" }}>{r.open ? "Open" : "Closed"}</td>
                        <td style={{ padding: "6px" }}>{r.open ? (r.from || "—") : "—"}</td>
                        <td style={{ padding: "6px" }}>{r.open ? (r.to || "—") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Payment Terms / Price lists */}
      <section className="card">
        {/* success banner */}
        {saveSuccess && (
          <div
            id="save-ok"
            className="small"
            style={{
              marginBottom: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#e8f9ee",
              color: "#0f5132",
              border: "1px solid #a3e1bd",
              fontWeight: 600,
            }}
            role="status"
            aria-live="polite"
          >
            Save successful
          </div>
        )}
        {saveSuccess && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "setTimeout(function(){var n=document.getElementById('save-ok'); if(n){ n.style.transition='opacity .3s'; n.style.opacity='0'; setTimeout(function(){ n.remove(); }, 350);}}, 3000);",
            }}
          />
        )}

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Payment Terms / Price lists</h3>
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          {/* Payment terms editor */}
          <div>
            <form action={savePaymentTermsAction}>
              <b>Payment terms</b>

              <div className="row" style={{ marginTop: 8, gap: 10, alignItems: "center" }}>
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    id="pt-enabled"
                    type="checkbox"
                    name="paymentDueLater"
                    defaultChecked={!!paymentDueLater}
                    aria-label="Enable payment due later"
                  />
                  <span className="small">Payment due later</span>
                </label>

                {/* Terms select (hidden/disabled when not enabled) */}
                <div id="pt-wrap" style={{ display: paymentDueLater ? "block" : "none" }}>
                  <select
                    id="pt-select"
                    name="paymentTermsName"
                    defaultValue={paymentTermsName || "Due on receipt"}
                    disabled={!paymentDueLater}
                    style={{ minWidth: 180 }}
                  >
                    {TERMS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Optional hidden field; server calculates anyway */}
                <input
                  type="hidden"
                  name="paymentTermsDueInDays"
                  defaultValue={
                    TERMS.find((t) => t.value === (paymentTermsName || "Due on receipt"))?.dueInDays ?? ""
                  }
                />
              </div>

              <div className="small muted" style={{ marginTop: 6 }}>
                Current: {paymentDueLater ? displayTerms(paymentTermsName, paymentTermsDueInDays) : "—"}
              </div>

              {/* Toggle select visibility inline (no client component) */}
              <script
                dangerouslySetInnerHTML={{
                  __html: `
                    (function(){
                      var cb=document.getElementById('pt-enabled');
                      var wrap=document.getElementById('pt-wrap');
                      var sel=document.getElementById('pt-select');
                      if(!cb||!wrap||!sel) return;
                      function apply(){
                        if(cb.checked){
                          wrap.style.display='block';
                          sel.disabled=false;
                          if(!sel.value) sel.value='Due on receipt';
                        }else{
                          wrap.style.display='none';
                          sel.disabled=true;
                        }
                      }
                      cb.addEventListener('change', apply);
                      apply();
                    })();
                  `,
                }}
              />

              <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
                <button className="btn" type="submit">
                  Save
                </button>
              </div>
            </form>
          </div>

          {/* Price lists placeholder */}
          <div>
            <b>Price lists</b>
            <div className="small" style={{ marginTop: 6 }}>
              <div className="muted">No price lists assigned yet.</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <a className="btn" href={`/customers/${customer.id}/price-lists`}>
                  Manage
                </a>
              </div>
            </div>
            <p className="mini muted" style={{ marginTop: 6 }}>
              In future: assign multiple price lists here. If a cart item is on an active list, its custom price will be applied.
            </p>
          </div>
        </div>
      </section>

      {/* Orders / Drafts switcher */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Orders / Drafts</h3>
          <div className="row" style={{ gap: 8 }}>
            <Link href={`/customers/${customer.id}?tab=orders`} className={`btn ${view === "orders" ? "primary" : ""}`}>
              Orders ({ordersCount})
            </Link>
            <Link href={`/customers/${customer.id}?tab=drafts`} className={`btn ${view === "drafts" ? "primary" : ""}`}>
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
                  gridTemplateColumns: "170px 140px 140px 160px 120px 120px 120px auto",
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
                      <div>
                        <span className="badge">{prettyFinancial(st?.financial_status)}</span>
                      </div>
                      <div>
                        <span className="badge">{prettyFulfillment(st?.fulfillment_status)}</span>
                      </div>
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
          <p className="small muted" style={{ marginTop: 8 }}>
            No draft orders for this customer.
          </p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "170px 160px 140px 160px 120px 120px 120px auto",
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
                    <div className="small">{fmtDate(d.created_at)}</div>
                    <div>#{d.id}</div>
                    <div>
                      <span className="badge">—</span>
                    </div>
                    <div>
                      <span className="badge">—</span>
                    </div>
                    <div>{money(subtotal, currency)}</div>
                    <div>{money(taxes, currency)}</div>
                    <div style={{ fontWeight: 600 }}>{money(total, currency)}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <a className="btn" href={adminUrl} target="_blank" rel="noreferrer">
                        View in Shopify
                      </a>
                      <form action={createPaymentLinkAction}>
                        <input type="hidden" name="draftId" value={String(d.id)} />
                        <button className="primary" type="submit" disabled={!shopifyCustomerId}>
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

      {/* Call log */}
      <section className="card">
        <h3 style={{ margin: 0 }}>Call log</h3>
        {calls.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            No calls yet.
          </p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 160px 1fr auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div className="small muted">When</div>
              <div className="small muted">Outcome</div>
              <div className="small muted">Notes</div>
              <div className="small muted">Action</div>

              {calls.map((c: any) => (
                <div key={c.id} style={{ display: "contents" }}>
                  <div className="small">{fmtDate(c.createdAt)}</div>
                  <div className="small">{c.outcome || "—"}</div>
                  <div className="small">{(c.notes && c.notes.trim()) ? c.notes.slice(0, 160) : "—"}</div>
                  <div>
                    <Link className="btn" href={`/calls/${c.id}`}>
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="card">
        <h3 style={{ margin: 0 }}>Notes</h3>
        {notes.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            No notes yet.
          </p>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <div className="small muted">When</div>
              <div className="small muted">Note</div>
              <div className="small muted">Action</div>

              {notes.map((n: any) => (
                <div key={n.id} style={{ display: "contents" }}>
                  <div className="small">{fmtDate(n.createdAt)}</div>
                  <div className="small">{(n.body && n.body.trim()) ? n.body.slice(0, 200) : "—"}</div>
                  <div>
                    <Link className="btn" href={`/notes/${n.id}`}>
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
