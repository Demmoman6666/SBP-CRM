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
  vendorName?: string | null; // used for client-side filtering if API ignores vendor param
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
    vendorName: r.vendor ?? r.vendorName ?? r.brand ?? r.brands ?? r.supplier ?? r.manufacturer ?? null,
  }));
}

async function fetchVariant(baseQS: URLSearchParams, vendor: string | null, key: "vendors" | "vendor" | "brands" | null) {
  const qs = new URLSearchParams(baseQS);
  if (key && vendor) qs.set(key, vendor);
  const res = await fetch(`/api/reports/sales-by-customer?${qs.toString()}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({ rows: [] }));
  return normaliseRows(data);
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

      const baseQS = new URLSearchParams();
      if (start) baseQS.set("start", start);
      if (end)   baseQS.set("end", end);

      // Try multiple parameter shapes your API may accept
      let best = await fetchVariant(baseQS, vendor, "vendors");
      if (!best.length) best = await fetchVariant(baseQS, vendor, "vendor");
      if (!best.length) best = await fetchVariant(baseQS, vendor, "brands");
      if (!best.length) best = await fetchVariant(baseQS, null, null); // unfiltered fallback

      // If API didn't filter by vendor, filter client-side when we can detect vendor on rows
      if (best.length && vendor) {
        const v = vendor.toLowerCase();
        const filtered = best.filter(r => (r.vendorName ?? "").toLowerCase() === v);
        if (filtered.length) best = filtered;
      }

      // sort by revenue desc
      best.sort((a, b) => b.revenue - a.revenue);

      if (!ok) return;
      setRows(best);
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
          <div className="small">No customers found for this vendor and date range.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Email</th>
                <th>City</th>
                <th style={{ textAlign: "right" }}>Orders</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                <th style={{ textAlign: "right" }}>AOV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const aov = r.orders ? r.revenue / r.orders : 0;
                return (
                  <tr key={r.id}>
                    <td><Link className="link" href={`/customers/${r.id}`}>{r.name}</Link></td>
                    <td>{r.email || "-"}</td>
                    <td>{r.city || "-"}</td>
                    <td style={{ textAlign: "right" }}>{r.orders}</td>
                    <td style={{ textAlign: "right" }}>{gbp.format(r.revenue ?? 0)}</td>
                    <td style={{ textAlign: "right" }}>{gbp.format(aov)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
