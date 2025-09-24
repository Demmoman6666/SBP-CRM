import { NextResponse } from 'next/server';
import { lwSession } from '@/lib/linnworks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = { skus: string[]; days30?: boolean; days60?: boolean };

function isoDaysAgo(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function readJsonSafe(res: Response) {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return null; }
}

export async function POST(req: Request) {
  let body: Body | null = null;
  try { body = await req.json(); } catch {}
  if (!body || !Array.isArray(body.skus) || body.skus.length === 0) {
    return NextResponse.json({ ok: false, error: 'Body must include skus[]' }, { status: 400 });
  }

  const want30 = body.days30 !== false;
  const want60 = body.days60 !== false;

  try {
    const { token, server } = await lwSession();

    async function countViaPaged(sku: string, days: number) {
      const { from, to } = isoDaysAgo(days);
      const params = new URLSearchParams({
        from,
        to,
        dateType: 'PROCESSED',
        searchField: 'SKU',
        exactMatch: 'true',
        searchTerm: sku,
        pageNum: '1',
        numEntriesPerPage: '200',
      });

      let page = 1;
      let total = 0;

      while (true) {
        params.set('pageNum', String(page));
        const res = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrdersPaged?${params}`, {
          method: 'POST',
          headers: { Authorization: token, Accept: 'application/json' },
          cache: 'no-store',
        });

        const data: any = await readJsonSafe(res);
        const rows: any[] = data?.Data || data?.Rows || [];

        for (const r of rows) {
          if (Array.isArray(r?.Items)) {
            for (const it of r.Items) {
              const s = it?.SKU ?? it?.Sku ?? it?.ItemNumber;
              if (s === sku) total += Number(it?.Qty ?? it?.Quantity ?? 0);
            }
          } else {
            // some shapes flatten
            total += Number(r?.Qty ?? r?.Quantity ?? 0);
          }
        }

        const perPage = Number(data?.EntriesPerPage ?? data?.PageSize ?? 200);
        const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!perPage || page * perPage >= totalCount) break;
        page += 1;
        if (page > 30) break; // safety
      }

      return total;
    }

    // fallback that tries the body-based search if paged endpoint isn’t available
    async function countViaBodySearch(sku: string, days: number) {
      const { from, to } = isoDaysAgo(days);
      let page = 1;
      let total = 0;

      while (true) {
        const reqBody = {
          request: {
            DateField: 'processed',
            FromDate: from,
            ToDate: to,
            ResultsPerPage: 200,
            PageNumber: page,
            SearchFilters: [{ SearchField: 'ItemIdentifier', SearchTerm: sku }],
          },
        };

        const res = await fetch(`${server}/api/ProcessedOrders/SearchProcessedOrders`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(reqBody),
          cache: 'no-store',
        });

        const data: any = await readJsonSafe(res);
        const rows: any[] = data?.Data || data?.Rows || [];

        for (const r of rows) {
          if (Array.isArray(r?.Items)) {
            for (const it of r.Items) {
              const s = it?.SKU ?? it?.Sku ?? it?.ItemNumber;
              if (s === sku) total += Number(it?.Qty ?? it?.Quantity ?? 0);
            }
          } else {
            total += Number(r?.Qty ?? r?.Quantity ?? 0);
          }
        }

        const perPage = Number(data?.ResultsPerPage ?? data?.PageSize ?? 200);
        const totalCount = Number(data?.TotalResults ?? data?.TotalCount ?? rows.length);
        if (!perPage || page * perPage >= totalCount) break;
        page += 1;
        if (page > 30) break;
      }

      return total;
    }

    async function countSku(sku: string, days: number) {
      try {
        return await countViaPaged(sku, days);
      } catch {
        return await countViaBodySearch(sku, days);
      }
    }

    const skus = body.skus.slice(0, 500);
    const out: Record<string, { d30?: number; d60?: number }> = {};
    const concurrency = 8;
    let idx = 0;

    async function worker() {
      while (idx < skus.length) {
        const i = idx++;
        const sku = skus[i];
        const rec: any = {};
        if (want30) rec.d30 = await countSku(sku, 30);
        if (want60) rec.d60 = await countSku(sku, 60);
        out[sku] = rec;
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, skus.length) }, worker));

    return NextResponse.json({ ok: true, sales: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sales-by-sku error' }, { status: 500 });
  }
}
