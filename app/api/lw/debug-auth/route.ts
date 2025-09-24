import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("https://api.linnworks.net/api/Auth/AuthorizeByApplication", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ApplicationId: process.env.LINNWORKS_APP_ID,
        ApplicationSecret: process.env.LINNWORKS_APP_SECRET,
        Token: process.env.LINNWORKS_INSTALL_TOKEN,
      }),
      cache: "no-store",
    });

    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, body: json ?? text },
        { status: 500 }
      );
    }

    // { Token, Server }
    return NextResponse.json({
      ok: true,
      server: json?.Server,
      tokenPreview: typeof json?.Token === "string" ? json.Token.slice(0, 6) + "…" : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
