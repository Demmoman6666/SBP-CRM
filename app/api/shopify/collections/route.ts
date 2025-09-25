import { NextResponse } from "next/server";
import { shopifyGraphql } from "@/lib/shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    type Gx = {
      collections: {
        edges: Array<{ cursor: string; node: { id: string; title: string } }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    };
    const query = `
      query Colls($first:Int!, $after:String) {
        collections(first: $first, after: $after) {
          edges { cursor node { id title } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const out: { id: string; title: string }[] = [];
    let after: string | undefined = undefined;
    for (let i = 0; i < 10; i++) {
      const data = await shopifyGraphql<Gx>(query, { first: 200, after });
      data.collections.edges.forEach(e => out.push({ id: e.node.id, title: e.node.title }));
      if (!data.collections.pageInfo.hasNextPage) break;
      after = data.collections.pageInfo.endCursor || undefined;
    }
    return NextResponse.json({ ok: true, collections: out });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
