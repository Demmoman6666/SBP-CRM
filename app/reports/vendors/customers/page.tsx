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
      const qs = new URLSearchParams({ vendor, start, end, limit: "500" });
      const res = await fetch(`/api/reports/vendors/customers?${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!ok) return;
      setRows(Array.isArray(data) ? data : data?.rows ?? []);
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
