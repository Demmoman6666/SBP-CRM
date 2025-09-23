"use client";

import { useMemo, useState } from "react";

type Product = { id: number; title: string; sku: string | null };
type Row = {
  customerId: string;
  customerName: string;
  products: Array<{ productId: number; bought: boolean }>;
  boughtCount: number;
  gapCount: number;
};

export default function GapProductsClient() {
  const [vendor, setVendor] = useState("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    vendor: string;
    products: Product[];
    customers: Row[];
  } | null>(null);

  async function load() {
    if (!vendor.trim()) return alert("Enter a brand (vendor).");
    setLoading(true);
    try {
      const r = await fetch("/api/reports/gap-products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          vendor: vendor.trim(),
          since: since || undefined,
          until: until || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Load failed: ${r.status}`);
      setData({ vendor: j.vendor, products: j.products, customers: j.customers });
    } catch (e: any) {
      alert(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const csvHref = useMemo(() => {
    if (!data) return null;
    const headers = ["Customer", ...data.products.map(p => p.title)];
    const lines = [headers.join(",")];
    for (const row of data.customers) {
      const cells = [row.customerName, ...data.products.map(p => (row.products.find(x => x.productId === p.id)?.bought ? "YES" : "NO"))];
      lines.push(cells.map(s => `"${String(s).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    return URL.createObjectURL(blob);
  }, [data]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>GAP Analysis (By Product)</h1>
        <a className="btn" href="/reports">Back</a>
      </div>

      <section className="card">
        <div className="grid grid-4" style={{ gap: 10 }}>
          <div>
            <label>Brand (vendor)</label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Hair Tools" />
          </div>
          <div>
            <label>Since</label>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
          <div>
            <label>Until</label>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button className="primary" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Run report"}
            </button>
            {csvHref && (
              <a className="btn" href={csvHref} download={`gap-${data?.vendor.replace(/\s+/g, "_")}.csv`}>
                Export CSV
              </a>
            )}
          </div>
        </div>
      </section>

      {!data ? (
        <p className="small muted">Run the report to see results.</p>
      ) : data.products.length === 0 ? (
        <p className="small muted">No active products found for “{data.vendor}”.</p>
      ) : (
        <section className="card" style={{ overflowX: "auto" }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Showing {data.customers.length} customers × {data.products.length} products.
          </div>
          <table className="small" style={{ borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", position: "sticky", left: 0, background: "white", zIndex: 1 }}>Customer</th>
                {data.products.map((p) => (
                  <th key={p.id} title={p.sku || ""} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    {p.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.customers.map((row) => (
                <tr key={row.customerId} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "6px 8px", position: "sticky", left: 0, background: "white" }}>
                    {row.customerName}
                    <div className="mini muted">Bought {row.boughtCount} / Gap {row.gapCount}</div>
                  </td>
                  {data.products.map((p) => {
                    const bought = row.products.find((x) => x.productId === p.id)?.bought;
                    return (
                      <td key={p.id} style={{ padding: "6px 8px", textAlign: "center" }}>
                        <span
                          className="badge"
                          style={{
                            background: bought ? "#e8f9ee" : "#fff4f4",
                            color: bought ? "#0f5132" : "#842029",
                            border: "1px solid " + (bought ? "#a3e1bd" : "#f0b6b6"),
                          }}
                        >
                          {bought ? "Yes" : "No"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
