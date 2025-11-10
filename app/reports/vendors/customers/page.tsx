"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type CustomerRow = {
  id: string;
  name: string;
  email?: string | null;
  city?: string | null;
  orders: number;
  revenue: number;
};

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export default function Page() {
  return (
    <Suspense fallback={<div className="small">Loading…</div>}>
      <CustomersClient />
    </Suspense>
  );
}

// normalise shapes from /api/reports/sales-by-customer
function normaliseRows(data: any): CustomerRow[] {
  const arr = Array.isArray(data) ? data : data?.rows ?? data?.byCustomer ?? [];
  return arr.map((r: any, i: number): CustomerRow => ({
    id: String(r.id ?? r.customerId ?? i),
    name: r.name ?? r.customerName ?? "(no name)",
    email: r.email ?? r.customerEmail ?? null,
    city: r.city ?? r.customerCity ?? null,
    orders: Number(r.orders ?? r.orderCount ?? 0),
    revenue: Number(r.revenue ?? r.total ?? r.sales ?? 0),
  }));
}

function CustomersClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const vendor = sp.get("vendor") ?? "";
  const start = sp.get("start") ?? "";
  const end   = sp.get("end") ?? "";

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;
    (async () => {
      setLoading(true);

      // use existing sales-by-customer API, filtering by vendor + date range
      const qs = new URLSearchParams();
      if (start) qs.set("start", start);
      if (end) qs.set("end", end);
      if (vendor) qs.set("vendors", vendor); // API expects comma-separated vendors

      const res = await fetch(`/api/reports/sales-by-customer?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({ rows: [] }));
      if (!ok) return;

      setRows(normaliseRows(data));
      setLoading(false);
    })();
    return () => { ok = false; };
  }, [vendor, start, end]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <button className="btn" onClick={() => router.back()}>Back</button>
          <h1>Customers — {vendor || "All vendors"}</h1>
        </div>
        <p className="small">Range: {start || "…"} to {end || "…"}</p>
      </section>

      <section className="card" style={{ overflowX: "auto" }}>
        {loading ? (
          <div className="small">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small">No customers found.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>City</th>
                <th style={{ textAlign: "right" }}>Orders</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="link" href={`/customers/${r.id}`}>{r.name}</Link></td>
                  <td>{r.email || "-"}</td>
                  <td>{r.city || "-"}</td>
                  <td style={{ textAlign: "right" }}>{r.orders}</td>
                  <td style={{ textAlign: "right" }}>{gbp.format(r.revenue ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
