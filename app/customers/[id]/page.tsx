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

/** DD/MM/YYYY date formatter (no time) */
function fmtDate(d: any): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/* ---------------- Opening hours + Sales rep helpers ---------------- */
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] as const;
function labelForDay(d: string) {
  const i = DAYS.findIndex((x) => x.toLowerCase() === d.slice(0,3).toLowerCase());
  const map = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  return i >= 0 ? map[i] : d;
}

/** Robustly extract sales rep string from common fields. */
function extractSalesRep(cust: any): string | null {
  const fields = [
    "salesRep","sales_rep","salesRepresentative","sales_representative",
    "salesperson","sales_person","accountManager","account_manager",
    "rep","repName","rep_name","territoryManager","territory_manager",
  ];
  for (const f of fields) {
    const v = cust?.[f];
    if (!v) continue;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "object") {
      const name = v.name || v.fullName || v.displayName || v.email || "";
      if (String(name).trim()) return String(name).trim();
    }
  }
  return null;
}

/** Build table rows for opening hours from JSON/per-day columns. */
function openingHoursRows(cust: any): Array<{ day: string; hours: string }> {
  // 1) JSON-like blob
  const jsonCandidates = [
    "openingHoursJson","opening_hours_json","openingHoursJSON",
    "openingHours","opening_hours","hoursJson","hours_json"
  ];
  for (const key of jsonCandidates) {
    const raw = cust?.[key];
    if (!raw) continue;

    try {
      const blob =
        typeof raw === "string" && /^[\[{]/.test(raw.trim())
          ? JSON.parse(raw)
          : typeof raw === "object"
          ? raw
          : null;

      if (blob && typeof blob === "object") {
        const rows: Array<{ day: string; hours: string }> = [];
        const keys = Object.keys(blob);
        // Accept Mon/Tue or full names
        for (const k of keys) {
          const v: any = (blob as any)[k];
          if (v == null) continue;
          const open = typeof v === "object" ? (v.open ?? v.isOpen ?? true) : true;
          const from = typeof v === "object" ? (v.from ?? v.start ?? v.openFrom) : null;
          const to   = typeof v === "object" ? (v.to ?? v.end ?? v.openTo) : null;
          const hours =
            open === false ? "Closed" :
            from && to ? `${from}–${to}` :
            typeof v === "string" ? v :
            "Open";
          rows.push({ day: labelForDay(k), hours: String(hours) });
        }
        if (rows.length) {
          // Order rows Mon..Sun
          rows.sort(
            (a,b) => DAYS.indexOf(a.day.slice(0,3) as any) - DAYS.indexOf(b.day.slice(0,3) as any)
          );
          return rows;
        }
      }
    } catch {
      // fall through
    }

    // If it's a plain string (not JSON) like "Mon: 9-5 • Tue: 9-5 …"
    if (typeof raw === "string" && raw.trim()) {
      const parts = raw.split(/[\n;•]+/).map((s) => s.trim()).filter(Boolean);
      const rows: Array<{ day: string; hours: string }> = [];
      for (const p of parts) {
        const m = p.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[:\s-]+(.+)$/i);
        if (m) rows.push({ day: labelForDay(m[1]), hours: m[2].trim() });
      }
      if (rows.length) return rows;
    }
  }

  // 2) Per-day columns
  const perDay = (name: string) =>
    cust?.[`${name}Hours`] ??
    cust?.[`${name}_hours`] ??
    cust?.[`${name}Open`] ??
    cust?.[`${name}_open`] ??
    cust?.[name];

  const rows: Array<{ day: string; hours: string }> = [];
  for (const full of ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]) {
    const v = perDay(full);
    if (v == null || v === "") continue;
    let hours = "";
    if (typeof v === "object") {
      const open = v.open ?? v.isOpen ?? true;
      const from = v.from ?? v.start;
      const to   = v.to ?? v.end;
      hours = open === false ? "Closed" : from && to ? `${from}–${to}` : JSON.stringify(v);
    } else {
      hours = String(v);
    }
    rows.push({ day: labelForDay(full), hours });
  }
  return rows;
}
/* ------------------------------------------------------------------- */

/** Load calls from a handful of likely tables/columns without crashing builds. */
async function loadCalls(customerId: string): Promise<any[]> {
  const tries: Array<{ table: string; col: string }> = [
    { table: `"Call"`, col: `"customerId"` },
    { table: `"Call"`, col: `"customer_id"` },
    { table: `"CallLog"`, col: `"customerId"` },
    { table: `"CallLog"`, col: `"customer_id"` },
    { table: `"CustomerCall"`, col: `"customerId"` },
    { table: `"CustomerCall"`, col: `"customer_id"` },
    { table: `"Calls"`, col: `"customerId"` },
    { table: `"Calls"`, col: `"customer_id"` },
  ];

  for (const t of tries) {
    try {
      const safeId = customerId.replace(/'/g, "''");
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM ${t.table} WHERE ${t.col} = '${safeId}' LIMIT 200`
      );
      if (Array.isArray(rows) && rows.length) {
        rows.sort((a, b) => {
          const ta = Date.parse(a.createdAt ?? a.created_at ?? a.date ?? a.timestamp ?? 0);
          const tb = Date.parse(b.createdAt ?? b.created_at ?? b.date ?? b.timestamp ?? 0);
          return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
        });
        return rows.slice(0, 20);
      }
    } catch {}
  }
  return [];
}

/** Load notes from likely tables/columns. */
async function loadNotes(customerId: string): Promise<any[]> {
  const tries: Array<{ table: string; col: string }> = [
    { table: `"Note"`, col: `"customerId"` },
    { table: `"Note"`, col: `"customer_id"` },
    { table: `"CustomerNote"`, col: `"customerId"` },
    { table: `"CustomerNote"`, col: `"customer_id"` },
    { table: `"Notes"`, col: `"customerId"` },
    { table: `"Notes"`, col: `"customer_id"` },
  ];
  for (const t of tries) {
    try {
      const safeId = customerId.replace(/'/g, "''");
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM ${t.table} WHERE ${t.col} = '${safeId}' LIMIT 200`
      );
      if (Array.isArray(rows) && rows.length) {
        rows.sort((a, b) => {
          const ta = Date.parse(a.createdAt ?? a.created_at ?? a.date ?? a.timestamp ?? 0);
          const tb = Date.parse(b.createdAt ?? b.created_at ?? b.date ?? b.timestamp ?? 0);
          return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
        });
        return rows.slice(0, 20);
      }
    } catch {}
  }
  return [];
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

  // Fetch the whole record so we can read optional fields (opening hours, sales rep) safely.
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

  // Enrich orders with Shopify payment/fulfillment status (best-effort)
  const idCandidates = orders
    .map((o: any) => Number(o.shopifyOrderId ?? o.shopifyId ?? o.shopify_order_id))
    .filter((n) => Number.isFinite(n)) as number[];

  let statusByShopifyId = new Map<
    number,
    { financial_status?: string | null; fulfillment_status?: string | null }
  >();
  if (idCandidates.length) {
    try {
      const idsParam = encodeURIComponent(idCandidates.join(","));
      const res = await shopifyRest(
        `/orders.json?ids=${idsParam}&status=any&fields=id,financial_status,fulfillment_status`,
        { method: "GET" }
      );
      if (res.ok) {
        const json = await res.json();
        const arr: Array<any> = json?.orders || [];
        for (const o of arr) {
          statusByShopifyId.set(Number(o.id), {
            financial_status: o.financial_status ?? null,
            fulfillment_status: o.fulfillment_status ?? null,
          });
        }
      }
    } catch {}
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

  // Calls & Notes
  const [calls, notes] = await Promise.all([
    loadCalls(customer.id),
    loadNotes(customer.id),
  ]);

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

  const openingRows = openingHoursRows(customer);
  const openingFallbackString =
    (customer as any).openingHours ??
    (customer as any).opening_hours ??
    (customer as any).openingTimes ??
    (customer as any).opening_times ??
    (customer as any).hours ??
    null;
  const salesRep = extractSalesRep(customer);

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

    // 3) Create the Payment Link (redirect back to the customer page after payment)
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
      automatic_tax: { enabled: false }, // unit amounts already include VAT
    });

    // Open the hosted checkout for this Payment Link.
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
            <Link className="btn" href={`/customers/${customer.id}/edit`}>
              Edit
            </Link>
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

            <div style={{ marginTop: 10 }}>
              <b>Sales rep</b>
              <p className="small" style={{ marginTop: 6 }}>{salesRep || "—"}</p>
            </div>
          </div>

          <div>
            <b>Location</b>
            <p className="small" style={{ marginTop: 6 }}>{addr || "-"}</p>

            <div style={{ marginTop: 10 }}>
              <b>Opening hours</b>
              {openingRows.length ? (
                <div style={{ marginTop: 6, overflowX: "auto" }}>
                  <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {openingRows.map((r) => (
                        <tr key={r.day}>
                          <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee", width: 130 }}>
                            <b>{r.day}</b>
                          </td>
                          <td style={{ padding: "4px 6px", borderBottom: "1px solid #eee" }}>
                            {r.hours || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small" style={{ marginTop: 6 }}>
                  {openingFallbackString ? String(openingFallbackString) : "—"}
                </p>
              )}
            </div>
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
                  const created = fmtDate(o.createdAt);
                  const name = o.shopifyName || (o.shopifyOrderNumber ? `#${o.shopifyOrderNumber}` : "-");
                  const sid = Number(o.shopifyOrderId ?? o.shopifyId ?? o.shopify_order_id);
                  const st = Number.isFinite(sid) ? statusByShopifyId.get(sid) : undefined;

                  return (
                    <div key={o.id} style={{ display: "contents" }}>
                      <div className="small">{created}</div>
                      <div className="nowrap">{name}</div>
                      <div><span className="badge">{prettyFinancial(st?.financial_status)}</span></div>
                      <div><span className="badge">{prettyFulfillment(st?.fulfillment_status)}</span></div>
                      <div>{money(o.subtotal, "GBP")}</div>
                      <div>{money(o.taxes, "GBP")}</div>
                      <div style={{ fontWeight: 600 }}>{money(o.total, "GBP")}</div>
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
                    <div>{money(subtotal, "GBP")}</div>
                    <div>{money(taxes, "GBP")}</div>
                    <div style={{ fontWeight: 600 }}>{money(total, "GBP")}</div>
                    <div className="row" style={{ gap: 6 }}>
                      <a className="btn" href={adminUrl} target="_blank" rel="noreferrer" title="Open in Shopify">
                        View in Shopify
                      </a>

                      {/* Create Stripe Payment Link (server action) */}
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

      {/* Calls */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Call log</h3>
        </div>

        {calls.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>No calls yet.</p>
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

              {calls.map((c: any) => {
                const when = c.createdAt || c.created_at || c.date || c.timestamp;
                const outcome = c.outcome || c.status || c.result || "—";
                const note = c.note || c.notes || c.summary || c.description || c.outcomeNotes || "";
                const id = c.id;

                const whenText = fmtDate(when);
                const noteText = String(note || "");
                const snippet = noteText.length > 120 ? noteText.slice(0, 120) + "…" : noteText;

                return (
                  <div key={String(id ?? whenText)} style={{ display: "contents" }}>
                    <div className="small">{whenText}</div>
                    <div><span className="badge">{String(outcome || "—")}</span></div>
                    <div className="small muted" title={noteText}>{snippet}</div>
                    <div>
                      <Link className="btn" href={id ? `/calls/${id}` : `/calls?customerId=${customer.id}`}>
                        View
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Notes */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Notes</h3>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" href={`/notes?customerId=${customer.id}`}>All notes</Link>
            <Link className="primary" href={`/notes/new?customerId=${customer.id}`}>Add note</Link>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>No notes yet.</p>
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

              {notes.map((n: any) => {
                const when = n.createdAt || n.created_at || n.date || n.timestamp;
                const text = n.text || n.note || n.notes || n.body || n.content || n.message || "";
                const id = n.id;

                const whenText = fmtDate(when);
                const body = String(text || "");
                const snippet = body.length > 140 ? body.slice(0, 140) + "…" : body;

                return (
                  <div key={String(id ?? whenText)} style={{ display: "contents" }}>
                    <div className="small">{whenText}</div>
                    <div className="small" title={body}>{snippet}</div>
                    <div>
                      <Link className="btn" href={id ? `/notes/${id}` : `/notes?customerId=${customer.id}`}>
                        View
                      </Link>
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
