"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type OrderRow = {
  id: string;
  number: string;
  date: string;
  customerName: string;
  total: number;
  salesRep?: string | null;
};

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export default function Page() {
  return (
    <Suspense fallback={<div className="small">Loading…</div>}>
      <OrdersClient />
    </Suspense>
  );
}

function OrdersClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const vendor = sp.get("vendor") ?? "";
  const start = sp.get("start") ?? "";
  const end   = sp.get("end") ?? "";

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ok = true;
    (async () => {
      setLoading(true);
      const qs = new URLSearchParams({ vendor, start, end, limit: "500" });
      const res = await fetch(`/api/reports/vendors/orders?${qs}`, { cache: "no-store" });
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
          <h1>Orders — {vendor || "All vendors"}</h1>
        </div>
        <p className="small">Range: {start || "…"} to {end || "…"}</p>
      </section>

      <section className="card" style={{ overflowX: "auto" }}>
        {loading ? (
          <div className="small">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="small">No orders found.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order #</th>
                <th>Customer</th>
                <th>Sales Rep</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.date).toLocaleDateString()}</td>
                  <td><Link className="link" href={`/orders/${r.id}`}>{r.number || r.id}</Link></td>
                  <td>{r.customerName}</td>
                  <td>{r.salesRep || "-"}</td>
                  <td style={{ textAlign: "right" }}>{gbp.format(r.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
