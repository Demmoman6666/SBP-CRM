// app/api/reports/demand-par/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Timeframe = "mtd" | "lm" | "l2m" | "l3m";

function startOfMonthUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function endOfMonthUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)); }
function daysInMonthUTC(y: number, m: number) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

function computeWindow(tf: Timeframe): { start: Date; end: Date; monthsEq: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (tf === "mtd") {
    const start = startOfMonthUTC(now);
    const end = now;
    return { start, end, monthsEq: now.getUTCDate() / daysInMonthUTC(y, m) };
  }
  if (tf === "lm")
    return {
      start: new Date(Date.UTC(y, m - 1, 1)),
      end: endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1))),
      monthsEq: 1,
    };
  if (tf === "l2m")
    return {
      start: new Date(Date.UTC(y, m - 2, 1)),
      end: endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1))),
      monthsEq: 2,
    };
  return {
    start: new Date(Date.UTC(y, m - 3, 1)),
    end: endOfMonthUTC(new Date(Date.UTC(y, m - 1, 1))),
    monthsEq: 3,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const brand = searchParams.get("brand");
    const timeframe = (searchParams.get("timeframe") as Timeframe) || "mtd";
    const safetyPct = parseFloat(searchParams.get("safetyPct") || "0.15");
    const coverageMonths = parseFloat(searchParams.get("coverageMonths") || "1");
    const packSize = Math.max(parseInt(searchParams.get("packSize") || "1", 10), 1);

    if (!customerId || !brand) {
      return NextResponse.json({ error: "Missing customerId or brand" }, { status: 400 });
    }

    const { start, end, monthsEq } = computeWindow(timeframe);

    // --- Variant-aware, grouped by SKU (uses variantTitle when present) ---
    type Row = {
      sku: string | null;
      product_title: string | null;
      variant_title: string | null;
      units_window: number | null;
    };

    const rows = (await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT
        oli."sku" AS sku,
        MAX(NULLIF(oli."productTitle", '')) AS product_title,
        MAX(NULLIF(oli."variantTitle", '')) AS variant_title,
        COALESCE(SUM(oli."quantity" - COALESCE(oli."refundedQuantity", 0)), 0) AS units_window
      FROM "OrderLineItem" oli
      JOIN "Order" o ON o."id" = oli."orderId"
      WHERE o."customerId" = ${customerId}
        AND oli."productVendor" = ${brand}
        AND o."processedAt" >= ${start} AND o."processedAt" <= ${end}
      GROUP BY oli."sku"
      ORDER BY product_title ASC NULLS LAST, variant_title ASC NULLS LAST;
    `));

    const data = (rows || []).map((r) => {
      const units = Number(r.units_window ?? 0);
      const avgMonthly = monthsEq > 0 ? units / monthsEq : 0;
      const suggestedRaw = avgMonthly * (1 + safetyPct) * coverageMonths;
      const suggestedRounded = Math.max(packSize, Math.ceil(suggestedRaw / packSize) * packSize);

      const product = (r.product_title || "").trim();
      const variant = (r.variant_title || "").trim();
      const showVariant =
        variant &&
        !/^default title$/i.test(variant) &&
        !product.toLowerCase().includes(variant.toLowerCase());
      const productName = showVariant ? `${product} — ${variant}` : product;

      return {
        sku: r.sku ?? "",
        productName,
        unitsInWindow: units,
        avgMonthly,
        suggestedMonthlyPAR: suggestedRounded,
      };
    });

    return NextResponse.json({
      params: { customerId, brand, timeframe, start, end, monthsEq, safetyPct, coverageMonths, packSize },
      rows: data,
    });
  } catch (err: any) {
    console.error("/api/reports/demand-par error", err);
    return NextResponse.json({ error: err?.message || "Unknown error" }, { status: 500 });
  }
}
