"use client";

import React, { useMemo, useState } from "react";

type Row = {
  sku: string;
  productName: string;
  unitsInWindow: number;
  avgMonthly: number;
  suggestedMonthlyPAR: number;
};

type ApiRes = {
  params: {
    customerId: string;
    brand: string;
    timeframe: "mtd" | "lm" | "l2m" | "l3m";
    monthsEq: number;
    start: string;
    end: string;
    safetyPct: number;
    coverageMonths: number;
    packSize: number;
  };
  rows: Row[];
};

const TF_LABELS: Record<ApiRes["params"]["timeframe"], string> = {
  mtd: "Month to date",
  lm: "Last month",
  l2m: "Last 2 months",
  l3m: "Last 3 months",
};

export default function DemandParReportPage() {
  const [customerId, setCustomerId] = useState("");
  const [brand, setBrand] = useState("");
  const [timeframe, setTimeframe] = useState<ApiRes["params"]["timeframe"]>("mtd");
  const [safetyPct, setSafetyPct] = useState("0.15");
  const [coverageMonths, setCoverageMonths] = useState("1");
  const [packSize, setPackSize] = useState("1");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRun = useMemo(() => customerId.trim() && brand.trim(), [customerId, brand]);

  async function runReport() {
    try {
      setLoading(true);
      setError(null);
      setData(null);

      const qs = new URLSearchParams({
        customerId,
        brand,
        timeframe,
        safetyPct,
        coverageMonths,
        packSize,
      }).toString();

      const res = await fetch(`/api/reports/demand-par?${qs}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      const json = (await res.json()) as ApiRes;
      // normalise rows.sku to non-null string
      json.rows = (json.rows || []).map((r) => ({ ...r, sku: r.sku ?? "" }));
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!data?.rows?.length) return;
    const rows = data.rows;
    const headers = ["SKU", "Product Name", "Units (window)", "Avg Monthly", "Suggested Monthly PAR"];
    const csv = [headers.join(",")]
      .concat(
        rows.map((r) =>
          [
            r.sku,
            `"${(r.productName || "").replaceAll('"', '\\"')}"`,
            r.unitsInWindow,
            r.avgMonthly.toFixed(2),
            r.suggestedMonthlyPAR,
          ].join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `demand-par_${brand}_${timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function savePar(sku: string, parQty: number) {
    try {
      const res = await fetch("/api/par/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, sku, parQty }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      // Optional: toast/indicator
      alert(`Saved PAR ${parQty} for ${sku}`);
    } catch (e: any) {
      alert(e?.message || "Failed to save PAR");
    }
  }

  const rows = data?.rows || [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Customer → Brand Demand & Suggested Monthly PAR</h1>

      {/* Controls */}
      <div className="p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
        <div>
          <label className="block text-sm text-gray-500 mb-1">Customer ID</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="e.g. cus_123"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Brand (vendor)</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="e.g. MyOrganics"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Timeframe</label>
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as typeof timeframe)}
          >
            <option value="mtd">Month to date</option>
            <option value="lm">Last month</option>
            <option value="l2m">Last 2 months</option>
            <option value="l3m">Last 3 months</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Safety %</label>
          <input
            type="number"
            step="0.01"
            className="w-full border rounded-lg px-3 py-2"
            value={safetyPct}
            onChange={(e) => setSafetyPct(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Coverage months</label>
          <input
            type="number"
            step="1"
            min={1}
            className="w-full border rounded-lg px-3 py-2"
            value={coverageMonths}
            onChange={(e) => setCoverageMonths(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-500 mb-1">Pack size (round up)</label>
          <input
            type="number"
            step="1"
            min={1}
            className="w-full border rounded-lg px-3 py-2"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={runReport}
            disabled={!canRun || loading}
            className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
          >
            {loading ? "Running…" : "Run report"}
          </button>
          <button
            onClick={downloadCsv}
            disabled={!rows.length}
            className="px-4 py-2 rounded-lg border"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Status line */}
      <div className="text-sm text-gray-600">
        {loading && <span>Loading…</span>}
        {!loading && error && <span className="text-red-600">Error: {error}</span>}
        {!loading && !error && data && (
          <span>
            Showing <b>{rows.length}</b> SKUs for customer <b>{data.params.customerId}</b> / brand{" "}
            <b>{data.params.brand}</b> in <b>{TF_LABELS[data.params.timeframe]}</b>.
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border rounded-2xl">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-3">SKU</th>
              <th className="text-left p-3">Product</th>
              <th className="text-right p-3">Units (window)</th>
              <th className="text-right p-3">Avg Monthly</th>
              <th className="text-right p-3">Suggested Monthly PAR</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-b hover:bg-gray-50">
                <td className="p-3 whitespace-nowrap">{r.sku}</td>
                <td className="p-3">{r.productName}</td>
                <td className="p-3 text-right">{r.unitsInWindow}</td>
                <td className="p-3 text-right">{r.avgMonthly.toFixed(2)}</td>
                <td className="p-3 text-right font-medium">{r.suggestedMonthlyPAR}</td>
                <td className="p-3 text-right">
                  <button
                    className="px-3 py-1 rounded-md border"
                    onClick={() => savePar(r.sku, r.suggestedMonthlyPAR)}
                  >
                    Set as PAR
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && !error && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No data yet. Enter a Customer ID and Brand, then run the report.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Notes */}
      <div className="p-4 text-xs text-gray-500">
        <p className="mb-1">Notes:</p>
        <ul className="list-disc ml-5 space-y-1">
          <li>
            <b>Units (window)</b> are net of refunds via <code>OrderLineItem.refundedQuantity</code>.
          </li>
          <li>
            <b>Avg Monthly</b> scales the window to a monthly rate (e.g., MTD scales to full month).
          </li>
          <li>
            <b>Suggested Monthly PAR</b> = <code>CEIL(AvgMonthly × (1 + Safety%) × Coverage)</code>, rounded up to <b>Pack size</b>.
          </li>
        </ul>
      </div>
    </div>
  );
}
