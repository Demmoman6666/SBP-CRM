// app/reports/gap-products/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Vendor = { id: string; name: string };
type SalesRep = { id: string; name: string };

type ApiRow = {
  customerId?: string;
  customerName?: string;
  productId?: string;
  productTitle?: string;
  sku?: string | null;
  qty?: number | null;
  lastOrdered?: string | null; // ISO
};

export default function GapByProductPage() {
  // dropdown data
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);

  // form
  const [vendor, setVendor] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  // running + results
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ApiRow[] | null>(null);

  // load dropdowns
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingLists(true);
      setListsError(null);
      try {
        // Vendors (accepts {vendors:[], names:[]} OR string[])
        const vReq = fetch("/api/vendors", { headers: { Accept: "application/json" }, cache: "no-store" });
        // Sales reps (expects { reps: [{id,name}] } OR users:[] OR [] of {id,name})
        const sReq = fetch("/api/sales-reps", { headers: { Accept: "application/json" }, cache: "no-store" });

        const [vr, sr] = await Promise.all([vReq, sReq]);
        if (!vr.ok) throw new Error(`Vendors HTTP ${vr.status}`);
        if (!sr.ok) throw new Error(`Sales reps HTTP ${sr.status}`);

        const vj = await vr.json();
        const sj = await sr.json();

        const vList: Vendor[] = (() => {
          if (Array.isArray(vj)) {
            return vj
              .filter((s: any) => typeof s === "string" && s.trim())
              .map((name: string) => ({ id: name, name }));
          }
          if (Array.isArray(vj?.vendors)) {
            return vj.vendors
              .map((x: any) => ({ id: String(x?.id ?? x?.name ?? ""), name: String(x?.name ?? x?.id ?? "") }))
              .filter((x: Vendor) => x.id && x.name);
          }
          if (Array.isArray(vj?.names)) {
            return vj.names
              .filter((s: any) => typeof s === "string" && s.trim())
              .map((name: string) => ({ id: name, name }));
          }
          return [];
        })();

        const sList: SalesRep[] = (() => {
          const arr = Array.isArray(sj?.reps)
            ? sj.reps
            : Array.isArray(sj?.users)
            ? sj.users
            : Array.isArray(sj)
            ? sj
            : [];
          return arr
            .map((u: any) => ({
              id: String(u?.id ?? "").trim(),
              name: String(u?.name ?? u?.fullName ?? u?.email ?? u?.id ?? "").trim(),
            }))
            .filter((u: SalesRep) => u.id && u.name);
        })();

        // sort (case-insensitive)
        vList.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        sList.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

        if (!alive) return;
        setVendors(vList);
        setSalesReps(sList);
      } catch (e: any) {
        if (!alive) return;
        setListsError(e?.message || "Failed to load dropdowns");
      } finally {
        if (alive) setLoadingLists(false);
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

      // ✅ POST (the API expects POST)
      const r = await fetch("/api/reports/gap-products", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          vendor, // brand/vendor name
          salesRepId: salesRepId || undefined, // optional filter
          since: since || undefined,
          until: until || undefined,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      const data: ApiRow[] = Array.isArray(j?.rows) ? j.rows : Array.isArray(j) ? j : [];
      setRows(data);
    } catch (e: any) {
      setError(e?.message || "Report failed");
    } finally {
      setRunning(false);
    }
  }

  const canRun = useMemo(() => !!vendor && !running, [vendor, running]);

  // Build pivot: customers as rows, products as columns
  const pivot = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const customers: { id: string; name: string }[] = [];
    const products: { id: string; title: string }[] = [];
    const cMap = new Map<string, number>();
    const pMap = new Map<string, number>();

    // unique lists
    for (const r of rows) {
      const cid = String(r.customerId ?? r.customerName ?? "").trim();
      const cname = String(r.customerName ?? r.customerId ?? "").trim();
      if (cid && !cMap.has(cid)) {
        cMap.set(cid, customers.length);
        customers.push({ id: cid, name: cname || cid });
      }
      const pid = String(r.productId ?? r.productTitle ?? "").trim();
      const ptitle = String(r.productTitle ?? r.productId ?? "").trim();
      if (pid && !pMap.has(pid)) {
        pMap.set(pid, products.length);
        products.push({ id: pid, title: ptitle || pid });
      }
    }

    // stable sort
    customers.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    products.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

    // grid of values (qty or ✓)
    const matrix: (number | string | null)[][] = Array.from({ length: customers.length }, () =>
      Array.from({ length: products.length }, () => null),
    );

    for (const r of rows) {
      const ci = customers.findIndex((c) => c.id === String(r.customerId ?? r.customerName ?? "").trim());
      const pi = products.findIndex((p) => p.id === String(r.productId ?? r.productTitle ?? "").trim());
      if (ci === -1 || pi === -1) continue;

      const val = Number(r.qty ?? 0);
      matrix[ci][pi] = val > 0 ? val : "✓";
    }

    return { customers, products, matrix };
  }, [rows]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>GAP Analysis (By Product)</h1>
          <a className="btn" href="/reports/customers">Back</a>
        </div>
      </section>

      <section className="card">
        {listsError && (
          <div className="small" style={{ color: "#a30000", marginBottom: 10 }}>{listsError}</div>
        )}

        <label>Brand (vendor)</label>
        {loadingLists ? (
          <div className="small muted" style={{ marginTop: 6 }}>Loading…</div>
        ) : (
          <select value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
            <option value="">— Select a brand —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.name}>{v.name}</option>
            ))}
          </select>
        )}

        <div className="grid grid-3" style={{ gap: 10, marginTop: 10 }}>
          <div>
            <label>Sales Rep (optional)</label>
            {loadingLists ? (
              <div className="small muted" style={{ marginTop: 6 }}>Loading…</div>
            ) : (
              <select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
                <option value="">All reps</option>
                {salesReps.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label>Since</label>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} placeholder="dd/mm/yyyy" />
          </div>

          <div>
            <label>Until</label>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} placeholder="dd/mm/yyyy" />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!canRun} onClick={runReport}>
            {running ? "Running…" : "Run report"}
          </button>
        </div>

        {!rows && !error && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Pick a brand and run the report to see results.
          </p>
        )}
        {error && (
          <p className="small" style={{ marginTop: 10, color: "#a30000" }}>
            {error}
          </p>
        )}
      </section>

      {pivot && (
        <section className="card" style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px", position: "sticky", left: 0, background: "#fff" }}>
                    Customer
                  </th>
                  {pivot.products.map((p) => (
                    <th key={p.id} style={{ textAlign: "left", padding: "6px" }}>{p.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pivot.customers.map((c, ci) => (
                  <tr key={c.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px", position: "sticky", left: 0, background: "#fff", fontWeight: 600 }}>
                      {c.name}
                    </td>
                    {pivot.matrix[ci].map((val, pi) => (
                      <td key={pivot.products[pi].id} style={{ padding: "6px", textAlign: "center" }}>
                        {val == null ? "—" : val}
                      </td>
                    ))}
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
