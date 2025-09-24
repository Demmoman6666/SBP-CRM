import { NextResponse } from "next/server";
import { getLW } from "@/lib/linnworks";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { token, host } = await getLW();
    const r = await fetch(`https://${host}/api/Inventory/GetSuppliers`, {
      headers: { Authorization: token },
      cache: "no-store",
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: "LW GetSuppliers failed", status: r.status, body: text }, { status: 500 });
    }

    const raw = JSON.parse(text);
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.Data) ? raw.Data : [];
    const suppliers = arr.map((s: any) => ({
      Id: s.Id ?? s.id ?? s.SupplierId ?? s.pkSupplierId ?? s.pkSupplierID,
      Name: s.Name ?? s.name ?? s.SupplierName ?? s.supplierName ?? "Unknown",
    })).filter((x: any) => x.Id);

    return NextResponse.json({ ok: true, suppliers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "LW suppliers error" }, { status: 500 });
  }
}
