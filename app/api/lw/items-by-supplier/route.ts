import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supplierId = req.nextUrl.searchParams.get("supplierId");
  const entriesPerPage = Number(req.nextUrl.searchParams.get("pageSize") || 200);
  const hardLimit = Number(req.nextUrl.searchParams.get("limit") || 1000);

  if (!supplierId) {
    return NextResponse.json({ ok: false, error: "Missing supplierId" }, { status: 400 });
  }

  try {
    const { token, server } = await lwSession();

    const items: any[] = [];
    let pageNumber = 1;

    while (items.length < hardLimit) {
      // Ask LW to include supplier array on each item
      const body = {
        keyword: "",
        loadCompositeParents: false,
        loadVariationParents: false,
        entriesPerPage,
        pageNumber,
        dataRequirements: ["Supplier"], // <- docs show this is the right flag
      };

      const res = await fetch(`${server}/api/Stock/GetStockItemsFull`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      let page: any[] = [];
      try {
        page = await res.json();
      } catch {
        return NextResponse.json(
          { ok: false, error: `Non-JSON from LW (items), status ${res.status}` },
          { status: 502 }
        );
      }

      if (!Array.isArray(page) || page.length === 0) break;

      for (const it of page) {
        const suppliers: any[] = Array.isArray(it?.Suppliers) ? it.Suppliers : [];
        const matches = suppliers.some((s) => {
          const sid =
            s?.SupplierID ?? s?.SupplierId ?? s?.fkSupplierId ?? s?.pkSupplierId ?? s?.Id ?? null;
          return sid && String(sid).toLowerCase() === supplierId.toLowerCase();
        });

        if (matches) {
          items.push({
            stockItemId: it?.StockItemId ?? it?.pkStockItemId ?? it?.Id ?? null,
            sku:
              it?.SKU ??
              it?.ItemNumber ??
              it?.ItemSku ??
              it?.StockLevels?.[0]?.SKU ??
              "",
            title: it?.ItemTitle ?? it?.Title ?? it?.ItemName ?? "",
          });
        }
      }

      // no more pages
      if (page.length < entriesPerPage) break;
      pageNumber += 1;
      if (pageNumber > 50) break; // safety
    }

    // de-dupe by SKU
    const uniq = new Map<string, any>();
    items.forEach((x) => { if (x?.sku) uniq.set(x.sku, x); });

    return NextResponse.json({
      ok: true,
      count: uniq.size,
      items: Array.from(uniq.values()),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
