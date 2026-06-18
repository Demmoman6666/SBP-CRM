// app/api/vendors/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam && Number.isFinite(Number(limitParam)) && Number(limitParam) > 0
      ? Math.floor(Number(limitParam)) : undefined;
    const sourceParam = (url.searchParams.get("source") || "").toLowerCase();
    const sourcePref = ["stocked", "orders", "both"].includes(sourceParam)
      ? (sourceParam as "stocked" | "orders" | "both") : null;
    const wantPlain = (url.searchParams.get("format") || "").toLowerCase() === "plain";
    const contextParam = (url.searchParams.get("context") || "").toLowerCase();
    const reportsOnly = contextParam === "reports";

    const collator = new Intl.Collator("en", { sensitivity: "base" });
    const uniq = (arr: string[]) =>
      Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))).sort(collator.compare);

    async function fetchStocked(): Promise<string[]> {
      const stocked = await prisma.stockedBrand.findMany({
        where: reportsOnly ? { visibleInReports: true } : undefined,
        select: { name: true },
        orderBy: { name: "asc" },
      });
      return stocked.map((b) => (b.name ?? "")).filter(Boolean);
    }

    async function fetchOrders(): Promise<string[]> {
      const rows = await prisma.orderLineItem.findMany({
        where: { productVendor: { not: null } },
        select: { productVendor: true },
        distinct: ["productVendor"],
      });
      return rows.map((r) => (r.productVendor ?? "")).filter(Boolean);
    }

    let names: string[] = [];
    let source: "stocked" | "orders" | "both" = "stocked";

    if (sourcePref === "stocked") {
      names = uniq(await fetchStocked()); source = "stocked";
    } else if (sourcePref === "orders") {
      names = uniq(await fetchOrders()); source = "orders";
    } else if (sourcePref === "both") {
      const [a, b] = await Promise.all([fetchStocked(), fetchOrders()]);
      names = uniq([...a, ...b]); source = "both";
    } else {
      const stocked = uniq(await fetchStocked());
      if (stocked.length > 0) { names = stocked; source = "stocked"; }
      else { names = uniq(await fetchOrders()); source = "orders"; }
    }

    if (q) { const needle = q.toLowerCase(); names = names.filter((n) => n.toLowerCase().includes(needle)); }
    if (limit && names.length > limit) names = names.slice(0, limit);

    const vendors = names.map((name) => ({ id: name, name }));
    if (wantPlain) return NextResponse.json(names, { headers: { "Cache-Control": "no-store, max-age=0" } });
    return NextResponse.json({ vendors, names, source, count: names.length }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
