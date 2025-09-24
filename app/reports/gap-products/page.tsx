// app/reports/gap-products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type VendorObj = { id: string; name: string };

export default function GapByProductPage() {
  // vendor dropdown state
  const [vendors, setVendors] = useState<VendorObj[]>([]);
  const [loadingVendors, setLoadingVendors] = useState<boolean>(true);
  const [vendorsError, setVendorsError] = useState<string | null>(null);

  // form state
  const [vendor, setVendor] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  // report state
  const [running, setRunning] = useState<boolean>(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load vendors safely
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingVendors(true);
      setVendorsError(null);
      try {
        const r = await fetch("/api/vendors", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();

        // Accept both shapes:
        // 1) { vendors: [{id,name}], names: string[] }
        // 2) string[]
        let list: VendorObj[] = [];
        if (Array.isArray(j)) {
          list = j
            .filter((s) => typeof s === "string" && s.trim())
            .map((name: string) => ({ id: name, name }));
        } else if (j && Array.isArray(j.vendors)) {
          list = j.vendors
            .map((v: any) => ({
              id: String(v?.id ?? v?.name ?? "").trim(),
              name: String(v?.name ?? v?.id ?? "").trim(),
            }))
            .filter((v: VendorObj) => v.id && v.name);
        } else if (j && Array.isArray(j.names)) {
          list = j.names
            .filter((s: any) => typeof s === "string" && s.trim())
            .map((name: string) => ({ id: name, name }));
        }

        // dedupe + sort
        const seen = new Set<string>();
        const cleaned: VendorObj[] = [];
        for (const v of list) {
          const key = v.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          cleaned.push(v);
        }
        cleaned.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

        if (!alive) return;
        setVendors(cleaned);
      } catch (e: any) {
        if (!alive) return;
        setVendorsError(e?.message || "Failed to load vendors");
        setVendors([]);
      } finally {
        if (alive) setLoadingVendors(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function runReport() {
    setRunning(true);
    setError(null);
    setRows(null);
    try {
      if (!vendor) throw new Error("Pick a brand (vendor) first.");

      const params = new URLSearchParams();
      params.set("vendor", vendor);
      if (since) params.set("since", since);
      if (until) params.set("until", until);

      const r = await fetch(`/api/reports/gap-products?${params.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      const data: any[] = Array.isArray(j?.rows) ? j.rows : Array.isArray(j) ? j : [];
      setRows(data);
    } catch (e: any) {
      setError(e?.message || "Report failed");
    } finally {
      setRunning(false);
    }
  }

  const canRun = useMemo(() => !!vendor && !running, [vendor, running]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>GAP Analysis (By Product)</h1>
          <a className="btn" href="/reports/customers">Back</a>
        </div>
      </section>

      <section className="card">
        <label>Brand (vendor)</label>
        {loadingVendors ? (
          <div className="small muted" style={{ marginTop: 6 }}>Loading brands…</div>
        ) : vendorsError ? (
          <div className="small" style={{ marginTop: 6, color: "#a30000" }}>
            {vendorsError}
          </div>
        ) : (
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          >
            <option value="">— Select a brand —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        )}

        <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
          <div>
            <label>Since</label>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              placeholder="dd/mm/yyyy"
            />
          </div>
          <div>
            <label>Until</label>
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              placeholder="dd/mm/yyyy"
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={!canRun} onClick={runReport}>
            {running ? "Running…" : "Run report"}
          </button>
        </div>

        {!rows && !error && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Run the report to see results.
          </p>
        )}
        {error && (
          <p className="small" style={{ marginTop: 10, color: "#a30000" }}>
            {error}
          </p>
        )}
      </section>

      {Array.isArray(rows) && rows.length > 0 && (
        <section className="card">
          <b>Results</b>
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px" }}>Customer</th>
                  <th style={{ textAlign: "left", padding: "6px" }}>Product</th>
                  <th style={{ textAlign: "left", padding: "6px" }}>SKU</th>
                  <th style={{ textAlign: "right", padding: "6px" }}>Last Ordered</th>
                  <th style={{ textAlign: "right", padding: "6px" }}>Qty Bought</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px" }}>{r.customerName ?? "—"}</td>
                    <td style={{ padding: "6px" }}>{r.productTitle ?? "—"}</td>
                    <td style={{ padding: "6px" }}>{r.sku ?? "—"}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{r.lastOrdered ?? "—"}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{r.qty ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
