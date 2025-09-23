"use client";

import { useMemo, useState } from "react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ApiResp = {
  vendor: string;
  products: Array<{ id: number; title: string; sku: string | null }>;
  customers: Array<{
    customerId: string;
    customerName: string;
    products: Array<{ productId: number; bought: boolean }>;
    boughtCount: number;
    gapCount: number;
  }>;
  totals: { productCount: number; customerCount: number };
};

export default function GapProductsPage() {
  const [vendor, setVendor] = useState("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setErr(null);
    setData(null);
    if (!vendor.trim()) {
      setErr("Enter a brand (vendor).");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/reports/gap-products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          vendor: vendor.trim(),
          since: since || undefined,
          until: until || undefined,
          // you can extend with customerIds if you add a picker
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Request failed: ${r.status}`);
      setData(j as ApiResp);
    } catch (e: any) {
      setErr(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  const csvHref = useMemo(() => {
    if (!data) return null;
    const headers = ["Customer", ...data.products.map((p) => p.title)];
    const rows = data.customers.map((c) => {
      const map = new Map(c.products.map((p) => [p.productId, p.bought]));
      return [c.customerName, ...data.products.map((p) => (map.get(p.id) ? "YES" : ""))];
    });
    const csv =
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [data]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <a className="btn" href="/reports/customers">Back</a>
          <h2 style={{ margin: 0 }}>GAP Analysis (By Product)</h2>
        </div>
      </div>

      <section className="card">
        <div className="grid grid-3" style={{ gap: 10 }}>
          <div>
            <label>Brand (vendor)</label>
            <input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. REF Stockholm"
            />
          </div>
          <div>
            <label>Since (optional)</label>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label>Until (optional)</label>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run report"}
          </button>
          {data && csvHref && (
            <a className="btn" href={csvHref} download={`gap-products-${data.vendor}.csv`}>
              Download CSV
            </a>
          )}
        </div>

        {err && (
          <div
            className="small"
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: "#fee",
              border: "1px solid #f5c2c7",
              color: "#842029",
            }}
          >
            {err}
          </div>
        )}
      </section>

      {data && (
        <section className="card" style={{ overflowX: "auto" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b>Brand:</b> {data.vendor} &nbsp; • &nbsp;
              <b>Products:</b> {data.totals.productCount} &nbsp; • &nbsp;
              <b>Customers:</b> {data.totals.customerCount}
            </div>
          </div>

          <div style={{ marginTop: 12, minWidth: 720 }}>
            {/* header */}
            <div
              className="small muted"
              style={{
                display: "grid",
                gridTemplateColumns: `220px repeat(${data.products.length}, 140px)`,
                gap: 6,
                paddingBottom: 6,
                borderBottom: "1px solid #eee",
              }}
            >
              <div>Customer</div>
              {data.products.map((p) => (
                <div key={p.id} className="nowrap" title={p.title}>
                  {p.title}
                </div>
              ))}
            </div>

            {/* rows */}
            {data.customers.map((c) => {
              const map = new Map(c.products.map((p) => [p.productId, p.bought]));
              return (
                <div
                  key={c.customerId}
                  className="small"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `220px repeat(${data.products.length}, 140px)`,
                    gap: 6,
                    padding: "8px 0",
                    borderBottom: "1px solid #f4f4f4",
                    alignItems: "center",
                  }}
                >
                  <div className="nowrap" style={{ fontWeight: 600 }}>{c.customerName}</div>
                  {data.products.map((p) => (
                    <div key={p.id}>
                      {map.get(p.id) ? (
                        <span className="badge" style={{ background: "#e7f7ec", color: "#0f5132" }}>YES</span>
                      ) : (
                        <span className="badge" style={{ background: "#fff3cd", color: "#664d03" }}>—</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
