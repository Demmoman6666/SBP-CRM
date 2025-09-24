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
      const body = {
        keyword: "",
        entriesPerPage,
        pageNumber,
        dataRequirements: ["Supplier"], // we just need suppliers for filtering
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
      try { page = await res.json(); } catch { page = []; }
      if (!Array.isArray(page) || page.length === 0) break;

      for (const it of page) {
        const sups: any[] = Array.isArray(it?.Suppliers) ? it.Suppliers : [];
        // 🔧 normalise supplier id(s) on each item
        const hasSupplier = sups.some((s) => {
          const sid =
            s?.SupplierId ??
            s?.SupplierID ??
            s?.fkSupplierId ??
            s?.pkSupplierId ??
            s?.Id ??
            null;
          return sid && String(sid).toLowerCase() === supplierId.toLowerCase();
        });

        if (hasSupplier) {
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

      if (page.length < entriesPerPage) break;
      pageNumber += 1;
      if (pageNumber > 25) break; // safety
    }

    const uniq = new Map<string, any>();
    items.forEach((x) => { if (x?.sku) uniq.set(x.sku, x); });

    return NextResponse.json({
      ok: true,
      count: uniq.size,
      items: Array.from(uniq.values()),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
