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

type ParRecord = { sku: string; parQty: number; updatedAt: string };

const TF_LABELS: Record<ApiRes["params"]["timeframe"], string> = {
  mtd: "Month to date",
  lm: "Last month",
  l2m: "Last 2 months",
  l3m: "Last 3 months",
};

type SortKey =
  | "sku"
  | "productName"
  | "unitsInWindow"
  | "avgMonthly"
  | "suggestedMonthlyPAR"
  | "agreedPar"
  | "delta";
type SortDir = "asc" | "desc";

export default function StockOrderParPage() {
  const [customerId, setCustomerId] = useState("");
  const [brand, setBrand] = useState("");
  const [timeframe, setTimeframe] = useState<ApiRes["params"]["timeframe"]>("mtd");
  const [safetyPct, setSafetyPct] = useState("0.15");
  const [coverageMonths, setCoverageMonths] = useState("1");
  const [packSize, setPackSize] = useState("1");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiRes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pars, setPars] = useState<Record<string, ParRecord>>({});
  const [editPar, setEditPar] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("productName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const canRun = useMemo(() => customerId.trim() && brand.trim(), [customerId, brand]);

  async function runReport() {
    try {
      setLoading(true);
      setError(null);
      setData(null);
      setEditPar({});

      const qs = new URLSearchParams({
        customerId,
        brand,
        timeframe,
        safetyPct,
        coverageMonths,
        packSize,
      }).toString();

      const r1 = await fetch(`/api/reports/demand-par?${qs}`);
      if (!r1.ok) throw new Error((await r1.json().catch(() => ({})))?.error || `Report failed (${r1.status})`);
      const json = (await r1.json()) as ApiRes;
      json.rows = (json.rows || []).map((r) => ({ ...r, sku: r.sku ?? "" }));
      setData(json);

      const r2 = await fetch(`/api/par/list?customerId=${encodeURIComponent(customerId)}`);
      if (r2.ok) {
        const j = (await r2.json()) as { records: ParRecord[] };
        const bySku: Record<string, ParRecord> = {};
        (j.records || []).forEach((rec) => {
          if (rec.sku) bySku[rec.sku] = rec;
        });
        setPars(bySku);

        const seed: Record<string, string> = {};
        (json.rows || []).forEach((row) => {
          const agreed = bySku[row.sku]?.parQty ?? null;
          seed[row.sku] = String(agreed ?? row.suggestedMonthlyPAR);
        });
        setEditPar(seed);
      } else {
        setPars({});
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  function setEdit(sku: string, val: string) {
    setEditPar((s) => ({ ...s, [sku]: val }));
  }

  async function saveOne(sku: string) {
    const val = editPar[sku];
    const n = Number(val);
    if (!sku) return alert("Missing SKU");
    if (!Number.isFinite(n) || n < 0) return alert("Enter a valid non-negative number");
    const res = await fetch("/api/par/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, sku, parQty: Math.round(n) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return alert(j?.error || "Save failed");
    }
    setPars((p) => ({ ...p, [sku]: { sku, parQty: Math.round(n), updatedAt: new Date().toISOString() } }));
    alert(`Saved PAR ${Math.round(n)} for ${sku}`);
  }

  async function saveAllVisible() {
    if (!data?.rows?.length) return;
    const toSave = data.rows
      .filter((r) => r.sku)
      .map((r) => ({ sku: r.sku, parQty: Math.max(0, Math.round(Number(editPar[r.sku] ?? r.suggestedMonthlyPAR))) }));

    for (const item of toSave) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch("/api/par/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, sku: item.sku, parQty: item.parQty }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return alert(j?.error || `Failed on ${item.sku}`);
      }
    }
    alert("Saved PAR for all visible rows.");

    const r2 = await fetch(`/api/par/list?customerId=${encodeURIComponent(customerId)}`);
    if (r2.ok) {
      const j = (await r2.json()) as { records: ParRecord[] };
      const bySku: Record<string, ParRecord> = {};
      (j.records || []).forEach((rec) => {
        if (rec.sku) bySku[rec.sku] = rec;
      });
      setPars(bySku);
    }
  }

  const rows = useMemo(() => {
    const base = data?.rows || [];
    const withAgreed = base.map((r) => {
      const agreed = pars[r.sku]?.parQty ?? null;
      const delta = (r.suggestedMonthlyPAR ?? 0) - (agreed ?? 0);
      return { ...r, agreedPar: agreed, delta };
    });

    const sorted = [...withAgreed].sort((a: any, b: any) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return sorted;
  }, [data, pars, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  function downloadCsv() {
    if (!rows.length) return;
    const headers = [
      "SKU",
      "Product Name",
      "Units (window)",
      "Avg Monthly",
      "Suggested Monthly PAR",
      "Agreed PAR",
      "Delta",
    ];
    const csv = [headers.join(",")]
      .concat(
        rows.map((r: any) =>
          [
            r.sku,
            `"${(r.productName || "").replaceAll('"', '\\"')}"`,
            r.unitsInWindow,
            Number(r.avgMonthly ?? 0).toFixed(2),
            r.suggestedMonthlyPAR,
            r.agreedPar ?? "",
            r.delta ?? "",
          ].join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-par_${brand}_${timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Customers · Stock & Order (PAR)</h1>

      <div className="p-4 rounded-2xl border grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-3 items-end">
        <div className="lg:col-span-2">
          <label className="block text-sm text-gray-500 mb-1">Customer ID</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="e.g. cus_123"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </div>

        <div className="lg:col-span-2">
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
          <button onClick={downloadCsv} disabled={!rows.length} className="px-4 py-2 rounded-lg border">
            Export CSV
          </button>
          <button
            onClick={saveAllVisible}
            disabled={!rows.length || loading}
            className="px-4 py-2 rounded-lg border"
            title="Saves the current 'Edit PAR' values for every visible row"
          >
            Save all
          </button>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        {loading && <span>Loading…</span>}
        {!loading && error && <span className="text-red-600">Error: {error}</span>}
        {!loading && !error && data && (
          <span>
            Showing <b>{(data.rows || []).length}</b> SKUs for customer <b>{data.params.customerId}</b> / brand{" "}
            <b>{data.params.brand}</b> in <b>{TF_LABELS[data.params.timeframe]}</b>.
          </span>
        )}
      </div>

      <div className="overflow-x-auto border rounded-2xl">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {([
                ["sku", "SKU"],
                ["productName", "Product"],
                ["unitsInWindow", "Units (window)"],
                ["avgMonthly", "Avg Monthly"],
                ["suggestedMonthlyPAR", "Suggested PAR"],
                ["agreedPar", "Agreed PAR"],
                ["delta", "Δ (Sug - Agr)"],
                ["edit", "Edit PAR"],
                ["act", "Actions"],
              ] as const).map(([key, label]) => (
                <th
                  key={key}
                  className={`text-left p-3 ${key !== "edit" && key !== "act" ? "cursor-pointer select-none" : ""}`}
                  onClick={() => {
                    if (key === "edit" || key === "act") return;
                    toggleSort(key as any);
                  }}
                  title={key !== "edit" && key !== "act" ? "Click to sort" : ""}
                >
                  <div className="flex items-center gap-1">
                    <span>{label}</span>
                    {sortKey === (key as any) && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => {
              const editVal = editPar[r.sku] ?? String(r.agreedPar ?? r.suggestedMonthlyPAR ?? 0);
              return (
                <tr key={r.sku || r.productName} className="border-b hover:bg-gray-50">
                  <td className="p-3 whitespace-nowrap">{r.sku || <em className="text-gray-400">—</em>}</td>
                  <td className="p-3">{r.productName}</td>
                  <td className="p-3 text-right">{r.unitsInWindow}</td>
                  <td className="p-3 text-right">{Number(r.avgMonthly ?? 0).toFixed(2)}</td>
                  <td className="p-3 text-right font-medium">{r.suggestedMonthlyPAR}</td>
                  <td className="p-3 text-right">{r.agreedPar ?? <span className="text-gray-400">—</span>}</td>
                  <td className={`p-3 text-right ${Number(r.delta) > 0 ? "text-amber-700" : Number(r.delta) < 0 ? "text-emerald-700" : ""}`}>
                    {r.delta ?? 0}
                  </td>
                  <td className="p-3">
                    <input
                      className="w-28 border rounded-md px-2 py-1 text-right"
                      type="number"
                      step="1"
                      min={0}
                      value={editVal}
                      onChange={(e) => setEdit(r.sku, e.target.value)}
                      disabled={!r.sku}
                      title={!r.sku ? "Missing SKU" : "Set PAR"}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <button
                      className="px-3 py-1 rounded-md border disabled:opacity-50"
                      onClick={() => saveOne(r.sku)}
                      disabled={!r.sku}
                      title={!r.sku ? "Missing SKU" : "Save PAR for this SKU"}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && !error && (
              <tr>
                <td colSpan={9} className="p-6 text-center text-gray-500">
                  No data yet. Enter a Customer ID and Brand, then run the report.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 text-xs text-gray-500">
        <p className="mb-1">Notes:</p>
        <ul className="list-disc ml-5 space-y-1">
          <li><b>Units (window)</b> are net of refunds via <code>OrderLineItem.refundedQuantity</code>.</li>
          <li><b>Avg Monthly</b> scales the window to a monthly rate (e.g., MTD → full month).</li>
          <li><b>Suggested PAR</b> = <code>CEIL(AvgMonthly × (1 + Safety%) × Coverage)</code>, rounded up to <b>Pack size</b>.</li>
          <li><b>Agreed PAR</b> is stored in <code>CustomerProductPar</code> keyed by <code>customerId + sku</code>.</li>
        </ul>
      </div>
    </div>
  );
}
