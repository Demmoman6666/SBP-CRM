// app/(dashboard)/reports/demand-par/page.tsx
"use client";
import React from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, Save } from "lucide-react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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
    timeframe: string;
    monthsEq: number;
    start: string;
    end: string;
    safetyPct: number;
    coverageMonths: number;
    packSize: number;
  };
  rows: Row[];
};

const TF_LABELS: Record<string, string> = {
  mtd: "Month to date",
  lm: "Last month",
  l2m: "Last 2 months",
  l3m: "Last 3 months",
};

export default function DemandParReportPage() {
  const [customerId, setCustomerId] = React.useState("");
  const [brand, setBrand] = React.useState("");
  const [timeframe, setTimeframe] = React.useState("mtd");
  const [safetyPct, setSafetyPct] = React.useState("0.15");
  const [coverageMonths, setCoverageMonths] = React.useState("1");
  const [packSize, setPackSize] = React.useState("1");

  const qs =
    customerId && brand
      ? `?customerId=${encodeURIComponent(customerId)}&brand=${encodeURIComponent(
          brand
        )}&timeframe=${timeframe}&safetyPct=${safetyPct}&coverageMonths=${coverageMonths}&packSize=${packSize}`
      : "";

  const { data, isLoading } = useSWR<ApiRes>(customerId && brand ? `/api/reports/demand-par${qs}` : null, fetcher);
  const rows = (data?.rows || []).map((r) => ({ ...r, sku: r.sku ?? "" }));

  function downloadCsv() {
    const headers = ["SKU", "Product Name", "Units (window)", "Avg Monthly", "Suggested Monthly PAR"];
    const csv = [headers.join(",")]
      .concat(
        rows.map((r) =>
          [r.sku, `"${r.productName.replaceAll('"', '\\"')}"`, r.unitsInWindow, r.avgMonthly.toFixed(2), r.suggestedMonthlyPAR].join(",")
        )
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
    const res = await fetch("/api/par/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, sku, parQty }),
    });
    if (!res.ok) alert("Failed to save PAR");
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Customer → Brand Demand & Suggested Monthly PAR</h1>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-sm text-muted-foreground">Customer ID</label>
            <Input placeholder="e.g. cus_123" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Brand (vendor)</label>
            <Input placeholder="e.g. MyOrganics" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Timeframe</label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger>
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mtd">Month to date</SelectItem>
                <SelectItem value="lm">Last month</SelectItem>
                <SelectItem value="l2m">Last 2 months</SelectItem>
                <SelectItem value="l3m">Last 3 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Safety %</label>
            <Input type="number" step="0.01" value={safetyPct} onChange={(e) => setSafetyPct(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Coverage months</label>
            <Input type="number" step="1" min="1" value={coverageMonths} onChange={(e) => setCoverageMonths(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Pack size (round up)</label>
            <Input type="number" step="1" min="1" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
          </div>

          <div className="flex gap-2 col-span-full sm:col-span-2 lg:col-span-1">
            <Button variant="secondary" disabled={!rows.length} onClick={downloadCsv}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {isLoading && (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </span>
            )}
            {!isLoading && data && (
              <span>
                Showing <b>{rows.length}</b> SKUs for customer <b>{data.params.customerId}</b> / brand <b>{data.params.brand}</b> in{" "}
                <b>{TF_LABELS[data.params.timeframe]}</b>.
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
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
                  <tr key={r.sku} className="border-b hover:bg-muted/20">
                    <td className="p-3 whitespace-nowrap">{r.sku}</td>
                    <td className="p-3">{r.productName}</td>
                    <td className="p-3 text-right">{r.unitsInWindow}</td>
                    <td className="p-3 text-right">{r.avgMonthly.toFixed(2)}</td>
                    <td className="p-3 text-right font-medium">{r.suggestedMonthlyPAR}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" onClick={() => savePar(r.sku, r.suggestedMonthlyPAR)}>
                        <Save className="w-4 h-4 mr-1" /> Set as PAR
                      </Button>
                    </td>
                  </tr>
                ))}
                {!rows.length && !isLoading && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      No data yet. Choose a customer and brand above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
