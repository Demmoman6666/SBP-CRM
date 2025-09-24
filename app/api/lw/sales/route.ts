import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

// body: { fromISO: string, toISO: string, skuList?: string[] }
export async function POST(req: Request) {
  const { fromISO, toISO, skuList } = await req.json();
  const { token, host } = await getLW();
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
  const r = await fetch(`https://${host}/api/ProcessedOrders/SearchProcessedOrders`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ request }),
    cache: "no-store",
  });
  const data = await r.json();
  return NextResponse.json(data);
}
