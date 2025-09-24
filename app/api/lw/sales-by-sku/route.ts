import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = {
  skus: string[];                 // SKUs shown in your table (stock SKUs)
  locationName?: string | null;   // human name from Locations dropdown (e.g., "Warehouse")
  days30?: boolean;               // default true
  days60?: boolean;               // default true
  debug?: boolean;                // optional: include notes on which script/columns were used
};

/* ---------- small helpers ---------- */

const NORM = (s: any) => String(s ?? "").trim().toUpperCase();
const uniq = (arr: any[]) => [...new Set((Array.isArray(arr) ? arr : []).map(v => String(v ?? "").trim()).filter(Boolean))];

function agoISO(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function readJson(r: Response) {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

/** Execute a Query Data script with paging. */
async function execQD(
  server: string,
  token: string,
  scriptId: number,
  parameters: any[],
  pageSize = 1000,
  maxPages = 15
) {
  let page = 1;
  const all: any[] = [];
  while (page <= maxPages) {
    const body =
      `scriptId=${scriptId}` +
      `&parameters=${encodeURIComponent(JSON.stringify(parameters))}` +
      `&entriesPerPage=${pageSize}&pageNumber=${page}`;
    const res = await fetch(`${server}/api/Dashboards/ExecuteCustomPagedScript`, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    const data: any = await readJson(res);
    const rows: any[] = Array.isArray(data?.Data) ? data.Data : Array.isArray(data?.Rows) ? data.Rows : [];
    all.push(...rows);
    if (!rows.length || rows.length < pageSize) break;
    page += 1;
  }
  return all;
}

/** Pick likely SKU field from a QD row. (varies by tenant/script) */
function pickSku(row: any): string | undefined {
  return (
    row?.StockItemSKU ??
    row?.SKU ??
    row?.Sku ??
    row?.ItemNumber ??
    row?.SKUCode ??
    row?.ChannelSKU ??
    row?.StockItemSku ??
    undefined
  );
}

/** Pick likely quantity field from a QD row. */
function pickQty(row: any): number {
  const n =
    row?.UnitsSold ??
    row?.DespatchedQty ??
    row?.SoldQty ??
    row?.QtyProcessed ??
    row?.Quantity ??
    row?.Qty ??
    row?.ShippedQty ??
    0;
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Pick likely location name from a QD row (when script 53 is used). */
function pickLoc(row: any): string | undefined {
  return (
    row?.LocationName ??
    row?.StockLocation ??
    row?.Location ??
    row?.Warehouse ??
    undefined
  );
}

/* ---------- main handler ---------- */

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => ({}))) as Input;
  const skus = uniq(payload.skus).slice(0, 800); // safety cap
  if (!skus.length) return NextResponse.json({ ok: false, error: "No SKUs provided" }, { status: 400 });

  const want30 = payload.days30 !== false;
  const want60 = payload.days60 !== false;
  const wantDebug = !!payload.debug;
  const locationName = (payload.locationName || "").trim() || null;

  try {
    const { token, server } = await lwSession();

    const out: Record<string, { d30?: number; d60?: number }> = {};
    for (const s of skus) out[s] = { d30: want30 ? 0 : undefined, d60: want60 ? 0 : undefined };

    const dbg: any = { used: "", notes: [] as string[], cols30: [] as string[], cols60: [] as string[] };

    // Standard date parameter name variants used by QD
    const dateParamSets = (fromISO: string, toISO: string) => ([
      [{ Type: "DateTime", Name: "fromDate",  Value: fromISO }, { Type: "DateTime", Name: "toDate",  Value: toISO }],
      [{ Type: "DateTime", Name: "startDate", Value: fromISO }, { Type: "DateTime", Name: "endDate", Value: toISO }],
      [{ Type: "DateTime", Name: "dateFrom",  Value: fromISO }, { Type: "DateTime", Name: "dateTo",  Value: toISO }],
    ]);

    // Optional location param name variants for script 53
    const withLoc = (pars: any[]) =>
      !locationName
        ? [pars]
        : [
            [...pars, { Type: "Select", Name: "locationName",  Value: locationName }],
            [...pars, { Type: "Select", Name: "Location",      Value: locationName }],
            [...pars, { Type: "Select", Name: "StockLocation", Value: locationName }],
          ];

    async function fetchWindow(days: number) {
      const { from, to } = agoISO(days);

      // Try script 53 (location-aware) with each date param variant (and each location param name if provided)
      for (const base of dateParamSets(from, to)) {
        for (const pars of withLoc(base)) {
          const rows = await execQD(server, token, 53, pars);
          if (rows.length) return { script: 53, rows, pars };
        }
      }

      // Fallback to script 47 (granular, no location filter)
      for (const base of dateParamSets(from, to)) {
        const rows = await execQD(server, token, 47, base);
        if (rows.length) return { script: 47, rows, pars: base };
      }

      return { script: 0, rows: [] as any[], pars: [] as any[] };
    }

    // 60-day pull
    let rows60: any[] = [];
    if (want60) {
      const r60 = await fetchWindow(60);
      rows60 = r60.rows;
      if (wantDebug) {
        dbg.notes.push(`60d: script ${r60.script} rows=${rows60.length}`);
        dbg.cols60 = rows60[0] ? Object.keys(rows60[0]) : [];
      }
      if (!rows60.length) dbg.notes.push("60d: no Query Data rows");
    }

    // 30-day pull
    let rows30: any[] = [];
    if (want30) {
      const r30 = await fetchWindow(30);
      rows30 = r30.rows;
      if (wantDebug) {
        dbg.notes.push(`30d: script ${r30.script} rows=${rows30.length}`);
        dbg.cols30 = rows30[0] ? Object.keys(rows30[0]) : [];
      }
      if (!rows30.length) dbg.notes.push("30d: no Query Data rows");
    }

    // Aggregate by SKU (and location filter when provided & present in rows)
    const want = new Set(skus.map(NORM));

    function sumRows(rows: any[]) {
      const sums: Record<string, number> = {};
      for (const s of skus) sums[s] = 0;

      for (const r of rows) {
        const sku = pickSku(r);
        if (!sku || !want.has(NORM(sku))) continue;

        if (locationName) {
          const loc = pickLoc(r);
          if (loc && NORM(loc) !== NORM(locationName)) continue;
        }

        sums[sku] += pickQty(r);
      }
      return sums;
    }

    if (want60 && rows60.length) {
      const s60 = sumRows(rows60);
      for (const k of Object.keys(s60)) out[k].d60 = s60[k] ?? 0;
    }
    if (want30 && rows30.length) {
      const s30 = sumRows(rows30);
      for (const k of Object.keys(s30)) out[k].d30 = s30[k] ?? 0;
    }

    // If both windows produced zero rows, surface a clear message.
    const hadAny = (want60 && rows60.length) || (want30 && rows30.length);
    if (!hadAny) {
      return NextResponse.json({
        ok: false,
        error: "No Query Data rows returned. Ensure your Linnworks app has access to Query Data (Dashboards) and that scripts #53/#47 exist for your account.",
        hint: "If needed I can add a tiny /api/lw/qdebug to list available scripts & columns.",
      }, { status: 404 });
    }

    if (wantDebug) dbg.used = "QueryData";
    return NextResponse.json({ ok: true, source: "QueryData", sales: out, ...(wantDebug ? { debug: dbg } : {}) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

// keep file as a module even if tree-shaken
export {};
