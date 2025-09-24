import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { fromISO, toISO, skuList } = await req.json();
  const { token, base } = await getLW();
  const request = {
    DateField: "processed",
    FromDate: fromISO,
    ToDate: toISO,
    ResultsPerPage: 200,
    PageNumber: 1,
    ...(skuList?.length
      ? { SearchFilters: [{ SearchField: "ItemIdentifier", SearchTerm: skuList.join(",") }] }
      : {}),
  };
  const r = await fetch(`${base}/api/ProcessedOrders/SearchProcessedOrders`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ request }),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) return NextResponse.json({ ok:false, error:"LW sales search failed", status:r.status, body:text }, { status: 500 });
  return NextResponse.json(JSON.parse(text));
}
