# File: app/api/reports/demand-par/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Types ---
type Timeframe = "mtd" | "lm" | "l2m" | "l3m";

function startOfMonthUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function endOfMonthUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)); }
function daysInMonthUTC(year: number, monthIndex: number) { return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(); }

function computeWindow(tf: Timeframe): { start: Date; end: Date; monthsEq: number } {
  const now = new Date(); // assume DB stores UTC timestamptz
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  if (tf === "mtd") {
    const start = startOfMonthUTC(now);
    const end = now; // up to now
    const day = now.getUTCDate();
    const dim = daysInMonthUTC(y, m);
    const monthsEq = day / dim; // scale MTD to full month equivalent
    return { start, end, monthsEq };
  }
  if (tf === "lm") {
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1)));
    return { start, end, monthsEq: 1 };
  }
  if (tf === "l2m") {
    const start = new Date(Date.UTC(y, m - 2, 1));
    const end = endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1))); // end of last month
    return { start, end, monthsEq: 2 };
  }
  // l3m
  const start = new Date(Date.UTC(y, m - 3, 1));
  const end = endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1)));
  return { start, end, monthsEq: 3 };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const brand = searchParams.get("brand");
    const timeframe = (searchParams.get("timeframe") as Timeframe) || "mtd"; // mtd|lm|l2m|l3m
    const safetyPct = parseFloat(searchParams.get("safetyPct") || "0.15");
    const coverageMonths = parseFloat(searchParams.get("coverageMonths") || "1");
    const packSize = Math.max(parseInt(searchParams.get("packSize") || "1", 10), 1); // round up to case packs
    const schema = (searchParams.get("schema") || "basic").toLowerCase(); // "basic" | "shopify"

    if (!customerId || !brand) {
      return NextResponse.json({ error: "Missing customerId or brand" }, { status: 400 });
    }

    const { start, end, monthsEq } = computeWindow(timeframe);

    let rows: Array<{ product_id: number; sku: string | null; title: string; units_window: number }> = [];

    if (schema === "shopify") {
      // Shopify-like schema using refunds tables; adjust table names if yours differ.
      // orders(order_id, customer_id, processed_at, cancelled_at, financial_status)
      // order_line_items(id, order_id, product_id, sku, title, quantity)
      // refunds(id, order_id, created_at)
      // refund_line_items(id, refund_id, order_line_item_id, quantity)
      rows = await prisma.$queryRaw<Array<{product_id:number; sku:string|null; title:string; units_window:number}>>`
        WITH base AS (
           SELECT oli.product_id,
                  COALESCE(SUM(oli.quantity),0) AS qty_positive
           FROM order_line_items oli
           JOIN orders o ON o.id = oli.order_id
           JOIN products p ON p.id = oli.product_id
           WHERE o.customer_id = ${Number(customerId)}
             AND p.brand = ${brand}
             AND o.processed_at >= ${start} AND o.processed_at <= ${end}
             AND (o.cancelled_at IS NULL)
             AND COALESCE(o.financial_status,'paid') <> 'voided'
           GROUP BY oli.product_id
         ),
         refunded AS (
           SELECT oli.product_id,
                  COALESCE(SUM(rli.quantity),0) AS qty_refunded
           FROM refund_line_items rli
           JOIN refunds r ON r.id = rli.refund_id
           JOIN order_line_items oli ON oli.id = rli.order_line_item_id
           JOIN orders o ON o.id = oli.order_id
           JOIN products p ON p.id = oli.product_id
           WHERE o.customer_id = ${Number(customerId)}
             AND p.brand = ${brand}
             AND r.created_at >= ${start} AND r.created_at <= ${end}
           GROUP BY oli.product_id
         )
         SELECT p.id AS product_id,
                p.sku,
                p.title,
                COALESCE(b.qty_positive,0) - COALESCE(rf.qty_refunded,0) AS units_window
         FROM products p
         LEFT JOIN base b ON b.product_id = p.id
         LEFT JOIN refunded rf ON rf.product_id = p.id
         WHERE p.brand = ${brand}
         ORDER BY p.title ASC;
      `;
    } else {
      // Basic schema (orders/order_items) with an optional refunded_quantity column on order_items.
      rows = await prisma.$queryRaw<Array<{product_id:number; sku:string|null; title:string; units_window:number}>>`
        SELECT p.id AS product_id,
               p.sku AS sku,
               p.title AS title,
               COALESCE(SUM(oi.quantity - COALESCE(oi.refunded_quantity,0)),0) AS units_window
        FROM order_items oi
        JOIN orders o   ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.customer_id = ${Number(customerId)}
          AND p.brand = ${brand}
          AND o.ordered_at >= ${start} AND o.ordered_at <= ${end}
          AND o.status NOT IN ('cancelled')
        GROUP BY p.id, p.sku, p.title
        ORDER BY p.title ASC;
      `;
    }

    // Business logic: normalise to months, add safety/coverage, round to pack size
    const data = rows.map(r => {
      const units = Number(r.units_window) || 0;
      const avgMonthly = monthsEq > 0 ? units / monthsEq : 0;
      const suggestedRaw = avgMonthly * (1 + safetyPct) * coverageMonths;
      const suggestedRounded = Math.max(packSize, Math.ceil(suggestedRaw / packSize) * packSize);
      return {
        productId: r.product_id,
        sku: r.sku,
        productName: r.title,
        unitsInWindow: units,
        avgMonthly,
        suggestedMonthlyPAR: suggestedRounded,
      };
    });

    return NextResponse.json({
      params: { customerId, brand, timeframe, start, end, monthsEq, safetyPct, coverageMonths, packSize, schema },
      rows: data,
    });
  } catch (err: any) {
    console.error("/api/reports/demand-par error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}

# File: app/api/par/upsert/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Optional: store agreed PAR per customer+product so you can compare vs. suggested
// Schema reference (create if you don't already have it):
// model CustomerProductPar {
//   id           Int      @id @default(autoincrement())
//   customerId   Int
//   productId    Int
//   parQty       Int
//   updatedAt    DateTime @updatedAt
//   @@unique([customerId, productId])
// }

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { customerId, productId, parQty } = body as { customerId: number; productId: number; parQty: number };
    if (!customerId || !productId || parQty == null) {
      return NextResponse.json({ error: "Missing customerId, productId or parQty" }, { status: 400 });
    }

    const upserted = await prisma.customerProductPar.upsert({
      where: { customerId_productId: { customerId, productId } },
      create: { customerId, productId, parQty },
      update: { parQty },
    });

    return NextResponse.json({ ok: true, record: upserted });
  } catch (err: any) {
    console.error("/api/par/upsert error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}

# File: app/(dashboard)/reports/demand-par/page.tsx
"use client";
import React from "react";
import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, Save } from "lucide-react";

const fetcher = (url: string) => fetch(url).then(r => r.json());

type Row = {
  productId: number;
  sku: string | null;
  productName: string;
  unitsInWindow: number;
  avgMonthly: number;
  suggestedMonthlyPAR: number;
};

type ApiRes = {
  params: { customerId: string; brand: string; timeframe: string; monthsEq: number; start: string; end: string; safetyPct: number; coverageMonths: number; packSize: number; schema: string };
  rows: Row[];
};

const TF_LABELS: Record<string,string> = { mtd: "Month to date", lm: "Last month", l2m: "Last 2 months", l3m: "Last 3 months" };

export default function DemandParReportPage() {
  const [customerId, setCustomerId] = React.useState<string>("");
  const [brand, setBrand] = React.useState<string>("");
  const [timeframe, setTimeframe] = React.useState<string>("mtd");
  const [safetyPct, setSafetyPct] = React.useState<string>("0.15");
  const [coverageMonths, setCoverageMonths] = React.useState<string>("1");
  const [packSize, setPackSize] = React.useState<string>("1");
  const [schema, setSchema] = React.useState<string>("basic");

  const qs = customerId && brand
    ? `?customerId=${encodeURIComponent(customerId)}&brand=${encodeURIComponent(brand)}&timeframe=${timeframe}&safetyPct=${safetyPct}&coverageMonths=${coverageMonths}&packSize=${packSize}&schema=${schema}`
    : "";
  const { data, isLoading } = useSWR<ApiRes>(customerId && brand ? `/api/reports/demand-par${qs}` : null, fetcher);

  const rows = data?.rows || [];

  function downloadCsv() {
    const headers = ["SKU","Product Name","Units (window)","Avg Monthly","Suggested Monthly PAR"];
    const csv = [headers.join(",")].concat(rows.map(r => [r.sku ?? "", `"${r.productName.replaceAll('"','\"')}"`, r.unitsInWindow, r.avgMonthly.toFixed(2), r.suggestedMonthlyPAR].join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `demand-par_${brand}_${timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function savePar(productId: number, parQty: number) {
    const res = await fetch("/api/par/upsert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: Number(customerId), productId, parQty }) });
    if (!res.ok) alert("Failed to save PAR");
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Customer → Brand Demand & Suggested Monthly PAR</h1>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
          <div>
            <label className="text-sm text-muted-foreground">Customer ID</label>
            <Input placeholder="e.g. 123" value={customerId} onChange={e => setCustomerId(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Brand</label>
            <Input placeholder="e.g. MyOrganics" value={brand} onChange={e => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Timeframe</label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger><SelectValue placeholder="Timeframe" /></SelectTrigger>
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
            <Input type="number" step="0.01" value={safetyPct} onChange={e => setSafetyPct(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Coverage months</label>
            <Input type="number" step="1" min="1" value={coverageMonths} onChange={e => setCoverageMonths(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Pack size (round up)</label>
            <Input type="number" step="1" min="1" value={packSize} onChange={e => setPackSize(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Schema</label>
            <Select value={schema} onValueChange={setSchema}>
              <SelectTrigger><SelectValue placeholder="Schema" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="shopify">Shopify-like</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 col-span-full sm:col-span-2 lg:col-span-1">
            <Button variant="secondary" disabled={!rows.length} onClick={downloadCsv}><Download className="w-4 h-4 mr-2"/>Export CSV</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 text-sm text-muted-foreground">
            {isLoading && <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> Loading…</span>}
            {!isLoading && data && (
              <span>
                Showing <b>{rows.length}</b> products for customer <b>{data.params.customerId}</b> / brand <b>{data.params.brand}</b> in <b>{TF_LABELS[data.params.timeframe]}</b>.
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
                  <tr key={r.productId} className="border-b hover:bg-muted/20">
                    <td className="p-3 whitespace-nowrap">{r.sku ?? ""}</td>
                    <td className="p-3">{r.productName}</td>
                    <td className="p-3 text-right">{r.unitsInWindow}</td>
                    <td className="p-3 text-right">{r.avgMonthly.toFixed(2)}</td>
                    <td className="p-3 text-right font-medium">{r.suggestedMonthlyPAR}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" onClick={() => savePar(r.productId, r.suggestedMonthlyPAR)}>
                        <Save className="w-4 h-4 mr-1"/> Set as PAR
                      </Button>
                    </td>
                  </tr>
                ))}
                {!rows.length && !isLoading && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No data yet. Choose a customer and brand above.</td></tr>
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
            <li><b>Units (window)</b> are net of refunds for the Shopify schema; for the basic schema, we subtract <code>order_items.refunded_quantity</code> if present.</li>
            <li><b>Avg Monthly</b> scales the chosen window to a per-month rate (e.g., MTD is scaled to a full calendar month).</li>
            <li><b>Suggested Monthly PAR</b> = <code>CEIL(AvgMonthly × (1 + Safety%) × Coverage)</code>, rounded up to <b>Pack size</b>.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

# Prisma model reference (adjust if different)
// model Order {
//   id           Int       @id @default(autoincrement())
//   customerId   Int
//   ordered_at   DateTime  @db.Timestamptz(6)
//   processed_at DateTime? @db.Timestamptz(6) // Shopify-like
//   cancelled_at DateTime? @db.Timestamptz(6)
//   status       String
//   financial_status String?
//   items        OrderItem[]
// }
// model OrderItem {
//   id                 Int      @id @default(autoincrement())
//   orderId            Int
//   productId          Int
//   quantity           Int
//   refunded_quantity  Int?     @default(0) // if available in your CRM
//   order              Order    @relation(fields: [orderId], references: [id])
//   product            Product  @relation(fields: [productId], references: [id])
// }
// model Product {
//   id     Int     @id @default(autoincrement())
//   sku    String? @unique
//   title  String
//   brand  String
// }
// model Customer {
//   id    Int    @id @default(autoincrement())
//   name  String
// }
// model CustomerProductPar {
//   id           Int      @id @default(autoincrement())
//   customerId   Int
//   productId    Int
//   parQty       Int
//   updatedAt    DateTime @updatedAt
//   @@unique([customerId, productId])
// }
