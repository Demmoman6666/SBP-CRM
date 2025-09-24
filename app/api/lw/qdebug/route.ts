import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readJson(r: Response) { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }

async function runScript(server: string, token: string, scriptId: number, pars: any[]) {
  const body = `scriptId=${scriptId}&parameters=${encodeURIComponent(JSON.stringify(pars))}&entriesPerPage=50&pageNumber=1`;
  const res = await fetch(`${server}/api/Dashboards/ExecuteCustomPagedScript`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body, cache: "no-store",
  });
  const data: any = await readJson(res);
  const rows: any[] = Array.isArray(data?.Data) ? data.Data : Array.isArray(data?.Rows) ? data.Rows : [];
  return rows;
}

function isoDaysAgo(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function GET() {
  try {
    const { token, server } = await lwSession();
    const { from, to } = isoDaysAgo(30);

    const paramSets = [
      [{ Type: "DateTime", Name: "fromDate", Value: from }, { Type: "DateTime", Name: "toDate", Value: to }],
      [{ Type: "DateTime", Name: "startDate", Value: from }, { Type: "DateTime", Name: "endDate", Value: to }],
      [{ Type: "DateTime", Name: "dateFrom", Value: from }, { Type: "DateTime", Name: "dateTo", Value: to }],
    ];

    // Try script 53 (by location & source), then 47 (sold granular)
    let rows53: any[] = [];
    for (const p of paramSets) {
      rows53 = await runScript(server, token, 53, p);
      if (rows53.length) break;
    }

    let rows47: any[] = [];
    for (const p of paramSets) {
      rows47 = await runScript(server, token, 47, p);
      if (rows47.length) break;
    }

    // return only a sample and the list of column names
    const sample53 = rows53.slice(0, 5);
    const cols53 = sample53[0] ? Object.keys(sample53[0]) : [];
    const sample47 = rows47.slice(0, 5);
    const cols47 = sample47[0] ? Object.keys(sample47[0]) : [];

    return NextResponse.json({
      ok: true,
      info: "First 5 rows from Query Data scripts",
      script53: { count: rows53.length, cols: cols53, sample: sample53 },
      script47: { count: rows47.length, cols: cols47, sample: sample47 },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
