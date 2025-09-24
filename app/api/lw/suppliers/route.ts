import { NextResponse } from "next/server";
import { lwSession } from "@/lib/linnworks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, server } = await lwSession();
    const r = await fetch(`${server}/api/Inventory/GetSuppliers`, {
      headers: { Authorization: token, Accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: "LW GetSuppliers failed", status: r.status, body: text },
        { status: 500 }
      );
    }

    // normalise whatever Linnworks returns into { id, name }
    let raw: any;
    try { raw = JSON.parse(text); } catch { raw = []; }
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.Data) ? raw.Data : [];

    const suppliers = arr.map((s: any) => ({
      id:
        s?.Id ??
        s?.id ??
        s?.SupplierId ??
        s?.SupplierID ??
        s?.pkSupplierId ??
        s?.pkSupplierID ??
        s?.fkSupplierId ??
        null,
      name: s?.Name ?? s?.name ?? s?.SupplierName ?? s?.supplierName ?? "Unknown",
    })).filter((x: any) => x.id);

    return NextResponse.json({ ok: true, suppliers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "LW suppliers error" }, { status: 500 });
  }
}
