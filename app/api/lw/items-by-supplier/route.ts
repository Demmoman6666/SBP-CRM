import { NextRequest, NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supplierId = req.nextUrl.searchParams.get("supplierId");
  const entriesPerPage = Number(req.nextUrl.searchParams.get("pageSize") || 200);
  const hardLimit = Number(req.nextUrl.searchParams.get("limit") || 1000); // safety cap

  if (!supplierId) {
    return NextResponse.json({ ok: false, error: "Missing supplierId" }, { status: 400 });
  }

  try {
    const { token, server } = await lwSession();
    const items: any[] = [];
    let pageNumber = 1;

    while (items.length < hardLimit) {
      const body = {
        keyword: "", // get all
        entriesPerPage,
        pageNumber,
        dataRequirements: ["Supplier"], // also available: StockLevels, Images, etc.
        // searchTypes may be ["SKU","Title","Barcode"], but we’re not filtering here
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

      // Keep only items that have this supplier
      for (const it of page) {
        const suppliers: any[] = Array.isArray(it?.Suppliers) ? it.Suppliers : [];
        if (suppliers.some(s => (s?.SupplierID ?? s?.fkSupplierId) === supplierId)) {
          items.push({
            stockItemId: it?.StockItemId ?? it?.pkStockItemId ?? it?.Id ?? null,
            sku:
              it?.SKU ??
              it?.ItemNumber ??
              // sometimes SKU appears inside stock levels rows; fall back to top-level if missing
              it?.StockLevels?.[0]?.SKU ??
              "",
            title: it?.ItemTitle ?? it?.Title ?? it?.ItemName ?? "",
          });
        }
      }

      if (page.length < entriesPerPage) break; // last page
      pageNumber += 1;
    }

    // De-dupe by SKU
    const uniq = new Map<string, any>();
    items.forEach(x => { if (x?.sku) uniq.set(x.sku, x); });

    return NextResponse.json({
      ok: true,
      count: uniq.size,
      items: Array.from(uniq.values()),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
