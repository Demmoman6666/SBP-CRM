import { NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";

type Payload = {
  skus: string[];        // up to ~200 at a time (we’ll batch internally)
  days30?: boolean;      // default true
  days60?: boolean;      // default true
};

export async function POST(req: Request) {
  let body: Payload | null = null;
  try { body = await req.json(); } catch {}
  if (!body || !Array.isArray(body.skus) || body.skus.length === 0) {
    return NextResponse.json({ ok: false, error: "Body must include skus[]" }, { status: 400 });
  }

  const want30 = body.days30 !== false;
  const want60 = body.days60 !== false;

  try {
    const { token, server } = await lwSession();

    async function countSkuInRange(sku: string, days: number) {
      // SearchProcessedOrdersPaged, exact match by SKU, limited 3-month windows (fine for 30/60)
      // See “Search Definitions…” doc for params. We’ll use PROCESSED dateType.  [oai_citation:3‡Support Center](https://help.linnworks.com/support/solutions/articles/7000013425-search-definitions-for-searchprocessedorderspaged-call)
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);

      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
        dateType: "PROCESSED",
        searchField: "SKU",
        exactMatch: "true",
        searchTerm: sku,
        pageNum: "1",
        numEntriesPerPage: "200",
      });

      let total = 0;
      let page = 1;

      while (true) {
        params.set("pageNum", String(page));
        const res = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${params.toString()}`, {
          method: "POST",
          headers: { Authorization: token, Accept: "application/json" },
        });

        let data: any;
        try { data = await res.json(); } catch { data = null; }
        const rows: any[] =
          data?.Data ??
          data?.Rows ??
          data?.items ??
          [];

        // Try common shapes: each row may contain Items with Qty or a flat Qty/Quantity
        for (const r of rows) {
          if (Array.isArray(r?.Items)) {
            for (const li of r.Items) {
              if ((li?.SKU ?? li?.Sku) === sku) {
                total += Number(li?.Qty ?? li?.Quantity ?? 0);
              }
            }
          } else {
            total += Number(r?.Qty ?? r?.Quantity ?? 0);
          }
        }

        const pageSize = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
        const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!pageSize || (page * pageSize) >= totalCount) break;
        page += 1;
        if (page > 20) break; // hard stop
      }

      return total;
    }

    // Batch calls to avoid hammering the API
    const skus = body.skus.slice(0, 500); // client can page if needed
    const out: Record<string, { d30?: number; d60?: number }> = {};
    const concurrency = 8;
    let idx = 0;

    async function worker() {
      while (idx < skus.length) {
        const i = idx++;
        const sku = skus[i];
        const rec: any = {};
        if (want30) rec.d30 = await countSkuInRange(sku, 30);
        if (want60) rec.d60 = await countSkuInRange(sku, 60);
        out[sku] = rec;
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, skus.length) }, worker));

    return NextResponse.json({ ok: true, sales: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
