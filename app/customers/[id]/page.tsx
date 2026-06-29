// @refreshed
import Link from "next/link";
import AiBriefPanel from "./AiBriefPanel";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { shopifyRest } from "@/lib/shopify";
import { savePaymentTerms, createPaymentLink } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(n?: any, currency = "GBP") {
  if (n == null) return "—";
  const num = typeof n === "string" ? parseFloat(n) : Number(n);
  if (!Number.isFinite(num)) return String(n);
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(num); }
  catch { return num.toFixed(2); }
}
function fmtDate(d: any): string {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
}
const prettyFinancial = (s?: string | null) => {
  const k = (s||"").toLowerCase();
  if (!k) return "—";
  if (k.includes("paid")) return "Paid";
  if (k.includes("authorized")||k.includes("pending")) return "Pending";
  if (k.includes("partially")) return "Part paid";
  if (k.includes("refunded")||k.includes("void")) return "Refunded";
  return s!;
};
const prettyFulfillment = (s?: string | null) => {
  const k = (s||"").toLowerCase();
  if (!k) return "—";
  if (k.includes("fulfilled")&&!k.includes("un")) return "Fulfilled";
  if (k.includes("partial")) return "Partial";
  if (k.includes("unfulfilled")) return "Unfulfilled";
  if (k.includes("cancel")) return "Cancelled";
  return s!;
};

const STAGE_LABEL: Record<string, string> = {
  LEAD: "Lead", APPOINTMENT_BOOKED: "Appointment", SAMPLING: "Sampling", CUSTOMER: "Customer",
};
const STAGE_COLOR: Record<string, string> = {
  LEAD: "#e0e7ff", APPOINTMENT_BOOKED: "#fef9c3", SAMPLING: "#fce7f3", CUSTOMER: "#dcfce7",
};
const STAGE_TEXT: Record<string, string> = {
  LEAD: "#3730a3", APPOINTMENT_BOOKED: "#92400e", SAMPLING: "#9d174d", CUSTOMER: "#166534",
};

const TERMS = [
  { value: "Due on receipt", label: "Due on receipt" },
  { value: "Due on fulfillment", label: "Due on fulfillment" },
  { value: "Net 7", label: "Within 7 days" },
  { value: "Net 15", label: "Within 15 days" },
  { value: "Net 30", label: "Within 30 days" },
  { value: "Net 45", label: "Within 45 days" },
  { value: "Net 60", label: "Within 60 days" },
  { value: "Net 90", label: "Within 90 days" },
];

type DayRow = { day: string; open: boolean; from?: string|null; to?: string|null };
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
function normaliseOpeningHours(raw: any): DayRow[] {
  if (!raw) return [];
  let data: any = raw;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return []; } }
  if (data && !Array.isArray(data) && typeof data === "object") {
    return DAYS.map(d => {
      const entry = data[d]||data[d.toLowerCase()]||data[d.toUpperCase()];
      if (!entry) return { day: d, open: false };
      return { day: d, open: !!(entry.open??entry.isOpen??entry.enabled), from: entry.from??entry.start??null, to: entry.to??entry.end??null };
    });
  }
  return [];
}

function pickFirstString(...vals: any[]): string|null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

async function loadCalls(customerId: string) {
  try {
    const rows = await (prisma as any).callLog.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((r: any) => ({
      id: r.id, createdAt: r.createdAt,
      callType: r.callType||null, outcome: r.outcome||null,
      staff: r.staff||null, durationMinutes: r.durationMinutes||null,
      summary: r.summary||null, followUpAt: r.followUpAt||null,
    }));
  } catch { return []; }
}

async function loadNotes(customerId: string) {
  try {
    const rows = await (prisma as any).note.findMany({
      where: { customerId }, orderBy: { createdAt: "desc" }, take: 30,
    });
    return rows.map((r: any) => ({
      id: r.id, createdAt: r.createdAt,
      body: pickFirstString(r.text, r.body, r.content)||"", staff: r.staff||null,
    }));
  } catch { return []; }
}

type PageProps = { params: { id: string }; searchParams?: Record<string, string|string[]|undefined> };

export default async function CustomerPage({ params, searchParams }: PageProps) {
  const tab = (Array.isArray(searchParams?.tab) ? searchParams?.tab[0] : searchParams?.tab) || "overview";

  const customer = await prisma.customer.findUnique({ where: { id: params.id } });
  if (!customer) return notFound();

  const orders = await prisma.order.findMany({
    where: { customerId: customer.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  const idCandidates = orders.map((o: any) => Number(o.shopifyOrderId??o.shopifyId)).filter(n => Number.isFinite(n));
  const shopifyById = new Map<number, any>();
  if (idCandidates.length) {
    try {
      const res = await shopifyRest(`/orders.json?ids=${encodeURIComponent(idCandidates.join(","))}&status=any&fields=id,financial_status,fulfillment_status,created_at,processed_at`, { method: "GET" });
      if (res.ok) { const json = await res.json(); for (const o of json?.orders||[]) shopifyById.set(Number(o.id), o); }
    } catch {}
  }

  let drafts: any[] = [];
  const shopifyCustomerId = (customer as any).shopifyCustomerId;
  if (shopifyCustomerId) {
    try {
      const res = await shopifyRest(`/draft_orders.json?status=open&limit=50`, { method: "GET" });
      if (res.ok) {
        const json = await res.json();
        const scid = Number(shopifyCustomerId);
        drafts = (json?.draft_orders||[]).filter((d: any) => Number(d?.customer?.id) === scid)
          .sort((a: any, b: any) => Date.parse(b.created_at||0) - Date.parse(a.created_at||0));
      }
    } catch {}
  }

  const calls = await loadCalls(customer.id);
  const notes = await loadNotes(customer.id);

  const c = customer as any;
  const addr = [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean).join(", ");
  const salesRepName = c.salesRep || null;
  const openingHoursRows = normaliseOpeningHours(c.openingHours);
  const paymentDueLater = c.paymentDueLater ?? false;
  const paymentTermsName = c.paymentTermsName ?? null;
  const paymentTermsDueInDays = typeof c.paymentTermsDueInDays === "number" ? c.paymentTermsDueInDays : null;
  const saveSuccess = (Array.isArray(searchParams?.saved) ? searchParams?.saved[0] : searchParams?.saved) === "1";
  const totalRevenue = orders.reduce((s: number, o: any) => s + Number(o.total||0), 0);
  const lastOrder = orders[0];
  const lastOrderDate = lastOrder ? fmtDate((lastOrder as any).processedAt||(lastOrder as any).createdAt) : null;
  const savePaymentTermsAction = savePaymentTerms.bind(null, customer.id);
  const createPaymentLinkAction = createPaymentLink.bind(null, customer.id, shopifyCustomerId);
  const stage = c.stage || "LEAD";

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Orders (" + orders.length + ")" },
    { key: "drafts", label: "Drafts (" + drafts.length + ")" },
    { key: "calls", label: "Calls (" + calls.length + ")" },
    { key: "notes", label: "Notes (" + notes.length + ")" },
    { key: "ai", label: "AI Brief" },
  ];

  const mapsUrl = "https://maps.google.com?q=" + encodeURIComponent(addr);

  return (
    <div style={{ display: "grid", gap: 16 }}>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0 }}>{c.salonName || c.customerName || "Customer"}</h1>
              <span style={{ padding: "3px 12px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 700, background: STAGE_COLOR[stage]||"#f3f4f6", color: STAGE_TEXT[stage]||"#374151" }}>
                {STAGE_LABEL[stage]||stage}
              </span>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {c.customerName && <span className="small muted">👤 {c.customerName}</span>}
              {c.customerTelephone && <a href={"tel:" + c.customerTelephone} className="small muted" style={{ textDecoration: "none" }}>📞 {c.customerTelephone}</a>}
              {c.customerEmailAddress && <a href={"mailto:" + c.customerEmailAddress} className="small muted" style={{ textDecoration: "none" }}>✉ {c.customerEmailAddress}</a>}
              {salesRepName && <span className="small muted">🧑‍💼 {salesRepName}</span>}
              {addr && <span className="small muted">📍 {addr}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn" href={"/customers/" + customer.id + "/edit"}>Edit</Link>
            <Link className="primary" href={"/calls/new?customerId=" + customer.id}>Log Call</Link>
            <Link className="btn" href={"/customers/" + customer.id + "?tab=ai"} style={{ background: "var(--pink-light)", color: "var(--pink-dark)", border: "1px solid var(--pink)" }}>AI Brief</Link>
            <Link className="btn" href={"/education/requests/new?customerId=" + customer.id + "&salonName=" + encodeURIComponent((c.salonName || ""))}>Request Education</Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 16 }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{orders.length}</div>
            <div className="small muted">Orders</div>
          </div>
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{money(totalRevenue)}</div>
            <div className="small muted">Total spend</div>
          </div>
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{calls.length}</div>
            <div className="small muted">Calls logged</div>
          </div>
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{lastOrderDate || "—"}</div>
            <div className="small muted">Last order</div>
          </div>
          {c.numberOfChairs && (
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
              <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{c.numberOfChairs}</div>
              <div className="small muted">Chairs</div>
            </div>
          )}
        </div>
      </section>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <Link
            key={t.key}
            href={"/customers/" + customer.id + "?tab=" + t.key}
            style={{
              padding: "7px 16px", borderRadius: 999, fontSize: "0.85rem", fontWeight: 600,
              textDecoration: "none", border: "1px solid var(--border)",
              background: tab === t.key ? "var(--pink)" : "#fff",
              color: tab === t.key ? "#fff" : "var(--text)",
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {saveSuccess && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontWeight: 600, fontSize: "0.875rem" }}>
          Saved successfully
        </div>
      )}

      {tab === "overview" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>

            <section className="card">
              <h2 style={{ marginBottom: 12 }}>Contact Details</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {[
                  { label: "Salon Name", value: c.salonName },
                  { label: "Contact Name", value: c.customerName },
                  { label: "Phone", value: c.customerTelephone },
                  { label: "Email", value: c.customerEmailAddress },
                  { label: "Customer No.", value: c.customerNumber },
                  { label: "Sales Rep", value: salesRepName },
                ].map(row => row.value ? (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <span className="small muted">{row.label}</span>
                    <span className="small" style={{ fontWeight: 500, textAlign: "right" }}>{row.value}</span>
                  </div>
                ) : null)}
              </div>
            </section>

            <section className="card">
              <h2 style={{ marginBottom: 12 }}>Location</h2>
              <div style={{ display: "grid", gap: 6 }}>
                {[c.addressLine1, c.addressLine2, c.town, c.county, c.postCode, c.country].filter(Boolean).map((line: string, i: number) => (
                  <div key={i} className="small">{line}</div>
                ))}
                {addr && (
                  <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn" style={{ marginTop: 8, fontSize: "0.8rem", display: "inline-flex", width: "fit-content" }}>
                    Open in Maps
                  </a>
                )}
              </div>
              {openingHoursRows.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ marginBottom: 8, fontSize: "0.875rem" }}>Opening Hours</h3>
                  <div style={{ display: "grid", gap: 4 }}>
                    {openingHoursRows.map(r => (
                      <div key={r.day} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                        <span className="small" style={{ fontWeight: 600, width: 40 }}>{r.day}</span>
                        {r.open
                          ? <span className="small muted">{r.from||"—"} to {r.to||"—"}</span>
                          : <span className="small" style={{ color: "#dc2626" }}>Closed</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <h2 style={{ marginBottom: 12 }}>Payment Terms</h2>
              <form action={savePaymentTermsAction}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input id="pt-enabled" type="checkbox" name="paymentDueLater" defaultChecked={!!paymentDueLater} />
                  <label htmlFor="pt-enabled" className="small" style={{ textTransform: "none", letterSpacing: 0, color: "var(--text)", fontWeight: 500 }}>Payment due later</label>
                </div>
                <div style={{ display: paymentDueLater ? "block" : "none", marginBottom: 12 }}>
                  <select name="paymentTermsName" defaultValue={paymentTermsName||"Due on receipt"}>
                    {TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {paymentDueLater && paymentTermsName && (
                  <div className="small muted" style={{ marginBottom: 10 }}>
                    Current: {paymentTermsName}{paymentTermsDueInDays ? " (" + paymentTermsDueInDays + " days)" : ""}
                  </div>
                )}
                <button className="btn" type="submit" style={{ fontSize: "0.85rem" }}>Save</button>
              </form>
            </section>
          </div>

          {calls.length > 0 && (
            <section className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2>Recent Calls</h2>
                <Link href={"/customers/" + customer.id + "?tab=calls"} className="small" style={{ color: "var(--pink)" }}>View all</Link>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {calls.slice(0, 3).map((call: any) => (
                  <div key={call.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                        {call.callType && <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{call.callType}</span>}
                        {call.outcome && <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: "0.75rem", background: call.outcome?.toLowerCase().includes("sale") ? "#dcfce7" : "#f3f4f6", fontWeight: 600 }}>{call.outcome}</span>}
                      </div>
                      {call.summary && <div className="small muted">{call.summary.slice(0, 100)}{call.summary.length > 100 ? "..." : ""}</div>}
                      {call.staff && <div className="small muted">Rep: {call.staff}</div>}
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div className="small muted">{fmtDate(call.createdAt)}</div>
                      {call.durationMinutes && <div className="small muted">{call.durationMinutes}m</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "orders" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2>{orders.length} Orders</h2>
          </div>
          {orders.length === 0 ? <p className="small muted">No orders yet.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {orders.map((o: any) => {
                const sid = Number(o.shopifyOrderId??o.shopifyId);
                const st = Number.isFinite(sid) ? shopifyById.get(sid) : undefined;
                const displayDate = st?.processed_at||st?.created_at||o.processedAt||o.createdAt;
                const name = o.shopifyName||(o.shopifyOrderNumber ? "#" + o.shopifyOrderNumber : "—");
                const financial = prettyFinancial(st?.financial_status);
                const fulfillment = prettyFulfillment(st?.fulfillment_status);
                return (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 3 }}>{name}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="small muted">{fmtDate(displayDate)}</span>
                        <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: financial === "Paid" ? "#dcfce7" : "#fef9c3", color: financial === "Paid" ? "#166534" : "#92400e" }}>{financial}</span>
                        <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: "#f3f4f6" }}>{fulfillment}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: "1rem" }}>{money(o.total)}</div>
                      <Link className="btn" href={"/orders/" + o.id} style={{ fontSize: "0.8rem" }}>View</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "drafts" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2>{drafts.length} Draft Orders</h2>
          </div>
          {drafts.length === 0 ? <p className="small muted">No draft orders.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {drafts.map((d: any) => {
                const domain = (process.env.SHOPIFY_SHOP_DOMAIN||"").replace(/^https?:\/\//,"").replace(/\/$/,"");
                const adminUrl = "https://" + domain + "/admin/draft_orders/" + d.id;
                return (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 3 }}>Draft #{d.id}</div>
                      <div className="small muted">{fmtDate(d.created_at)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 700 }}>{money(d.total_price)}</div>
                      <a className="btn" href={adminUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem" }}>Shopify</a>
                      <form action={createPaymentLinkAction} style={{ display: "inline" }}>
                        <input type="hidden" name="draftId" value={String(d.id)} />
                        <button className="primary" type="submit" disabled={!shopifyCustomerId} style={{ fontSize: "0.8rem" }}>Payment link</button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === "calls" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2>{calls.length} Calls</h2>
            <Link className="primary" href={"/calls/new?customerId=" + customer.id} style={{ fontSize: "0.85rem" }}>+ Log Call</Link>
          </div>
          {calls.length === 0 ? <p className="small muted">No calls logged yet.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {calls.map((call: any) => (
                <div key={call.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4, alignItems: "center" }}>
                      <span className="small muted">{fmtDate(call.createdAt)}</span>
                      {call.callType && <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{call.callType}</span>}
                      {call.outcome && <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 600, background: call.outcome?.toLowerCase().includes("sale") ? "#dcfce7" : "#f3f4f6" }}>{call.outcome}</span>}
                      {call.durationMinutes && <span className="small muted">{call.durationMinutes}m</span>}
                    </div>
                    {call.summary && <div className="small muted" style={{ marginBottom: 4 }}>{call.summary}</div>}
                    {call.staff && <div className="small muted">Rep: {call.staff}</div>}
                    {call.followUpAt && <div className="small" style={{ color: new Date(call.followUpAt) < new Date() ? "#dc2626" : "#ca8a04" }}>Follow-up: {fmtDate(call.followUpAt)}</div>}
                  </div>
                  <Link className="btn" href={"/calls/" + call.id} style={{ fontSize: "0.8rem", flexShrink: 0 }}>View</Link>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "notes" && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2>{notes.length} Notes</h2>
          </div>
          {notes.length === 0 ? <p className="small muted">No notes yet.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {notes.map((n: any) => (
                <div key={n.id} style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="small muted">{fmtDate(n.createdAt)}</span>
                    {n.staff && <span className="small muted">Rep: {n.staff}</span>}
                  </div>
                  <div className="small" style={{ lineHeight: 1.6 }}>{n.body}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {tab === "ai" && (
        <AiBriefPanel customerId={customer.id} salonName={c.salonName || "Customer"} />
      )}
    </div>
  );
}

