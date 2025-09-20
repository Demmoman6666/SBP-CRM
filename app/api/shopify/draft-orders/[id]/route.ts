// app/api/shopify/draft-orders/[id]/route.ts
import { NextResponse } from "next/server";
import { shopifyRest } from "@/lib/shopify";

export const dynamic = "force-dynamic";
type Params = { params: { id: string } };

export async function GET(_: Request, { params }: Params) {
  const idNum = Number(params.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const resp = await shopifyRest(`/draft_orders/${idNum}.json`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    return NextResponse.json({ error: `Shopify said ${resp.status}`, shopify: text }, { status: 400 });
  }
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return NextResponse.json(json, { status: 200, headers: { "Cache-Control": "no-store" } });
}
