// app/reports/gap-products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export default function GapByProductPage() {
  const [vendors, setVendors] = useState<string[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);

  // form state
  const [vendor, setVendor] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  // results
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        setLoadingVendors(true);
        const r = await fetch("/api/vendors", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (stale) return;
        if (r.ok && Array.isArray(j?.vendors)) {
          setVendors(j.vendors);
        } else {
          // graceful fallback – leave vendors empty, user can still type (if we ever add a free-text input again)
          console.warn("Vendors fetch failed:", j?.error || r.status);
        }
      } finally {
        if (!stale) setLoadingVendors(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, []);

  async function runReport() {
    setError(null);
    setRows(null);
    setRunning(true);
    try {
      const payload = { vendor: vendor || null, since: since || null, until: until || null };
      const r = await fetch("/api/reports/gap-products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Report failed: ${r.status}`);
      setRows(Array.isArray(j?.rows) ? j.rows : []);
    } catch (e: any) {
      setError(e?.message || "Report failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>GAP Analysis (By Product)</h1>
        <a className="btn" href="/reports/customers">Back</a>
      </div>

      <section className="card" style={{ maxWidth: 720 }}>
        <label>Brand (vendor)</label>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            disabled={loadingVendors}
            style={{ flex: 1, minHeight: 40 }}
            aria-label="Select brand/vendor"
          >
            <option value="">{loadingVendors ? "Loading vendors…" : "— Select a vendor —"}</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          {vendor && (
            <button
              type="button"
              className="btn"
              onClick={() => setVendor("")}
              title="Clear vendor"
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ height: 10 }} />

        <label>Since</label>
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          placeholder="dd/mm/yyyy"
        />

        <label style={{ marginTop: 8 }}>Until</label>
        <input
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          placeholder="dd/mm/yyyy"
        />

        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="primary" onClick={runReport} disabled={running || !vendor}>
            {running ? "Running…" : "Run report"}
          </button>
          {!vendor && (
            <span className="small muted">Pick a brand to enable the report.</span>
          )}
        </div>

        <p className="mini muted" style={{ marginTop: 8 }}>
          Run the report to see results.
        </p>
      </section>

      {error && (
        <section className="card" style={{ color: "#842029", background: "#f8d7da", borderColor: "#f5c2c7" }}>
          <b>Error</b>
          <div className="small" style={{ marginTop: 6 }}>{error}</div>
        </section>
      )}

      {rows && (
        <section className="card" style={{ overflowX: "auto" }}>
          {rows.length === 0 ? (
            <div className="small muted">No results.</div>
          ) : (
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px" }}>Product</th>
                  <th style={{ textAlign: "left", padding: "6px" }}>SKU</th>
                  <th style={{ textAlign: "right", padding: "6px" }}>Customers Bought</th>
                  <th style={{ textAlign: "right", padding: "6px" }}>Customers Missing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px" }}>{r.title || "—"}</td>
                    <td style={{ padding: "6px" }}>{r.sku || "—"}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{r.boughtCount ?? 0}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{r.missingCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
