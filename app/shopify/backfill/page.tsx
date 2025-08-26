// app/shopify/backfill/page.tsx
import { redirect } from "next/navigation";

const BASE_PATH = "/api/shopify/backfill"; // your existing endpoints prefix
const ADMIN_TOKEN = process.env.SYNC_ADMIN_TOKEN!;

// Helper to safely build a URL to our internal API
function apiUrl(path: string, pageInfo?: string | null) {
  let u = `${BASE_PATH}${path}`;
  if (pageInfo) {
    u += `?page_info=${encodeURIComponent(pageInfo)}`;
  }
  return u;
}

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function ShopifyBackfillPage({ searchParams }: PageProps) {
  // Read last results from the query string so we can show them after a run
  const custImported = Number(searchParams?.custImported ?? 0) || undefined;
  const custNext = (searchParams?.custNext as string) || "";

  const ordImported = Number(searchParams?.ordImported ?? 0) || undefined;
  const ordNext = (searchParams?.ordNext as string) || "";

  // -------- Server actions (one batch per submit)
  async function runCustomersAction(formData: FormData) {
    "use server";
    const pageInfo = (formData.get("page_info") as string | null) || null;

    const res = await fetch(apiUrl("/customers", pageInfo), {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    const imported = json?.imported ?? 0;
    const next = json?.nextPageInfo ?? "";

    redirect(
      `/shopify/backfill?custImported=${imported}&custNext=${encodeURIComponent(
        next
      )}&ordImported=${ordImported ?? ""}&ordNext=${encodeURIComponent(
        ordNext
      )}`
    );
  }

  async function runOrdersAction(formData: FormData) {
    "use server";
    const pageInfo = (formData.get("page_info") as string | null) || null;

    const res = await fetch(apiUrl("/orders", pageInfo), {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    const imported = json?.imported ?? 0;
    const next = json?.nextPageInfo ?? "";

    redirect(
      `/shopify/backfill?ordImported=${imported}&ordNext=${encodeURIComponent(
        next
      )}&custImported=${custImported ?? ""}&custNext=${encodeURIComponent(
        custNext
      )}`
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Shopify Backfill</h1>
        <p className="small muted">
          Run one batch at a time. If the response shows a{" "}
          <code>nextPageInfo</code>, paste it and run again until it’s empty.
        </p>
      </section>

      {/* ===== Customers tile ===== */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Customers</h3>
        </div>

        {typeof custImported !== "undefined" && (
          <div className="small muted">
            Last batch imported: <b>{custImported}</b>{" "}
            {custNext ? (
              <>
                • nextPageInfo:{" "}
                <code style={{ wordBreak: "break-all" }}>{custNext}</code>
              </>
            ) : (
              "• No nextPageInfo (done)"
            )}
          </div>
        )}

        <form action={runCustomersAction} className="grid" style={{ gap: 8 }}>
          <label className="small">page_info (optional for first run)</label>
          <input
            name="page_info"
            defaultValue={custNext}
            placeholder="Paste nextPageInfo here"
            style={{ width: "100%" }}
          />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                redirect(
                  `/shopify/backfill?ordImported=${ordImported ?? ""}&ordNext=${encodeURIComponent(
                    ordNext
                  )}`
                )
              }
            >
              Clear
            </button>
            <button type="submit" className="primary">
              Run 1 batch
            </button>
          </div>
        </form>
      </section>

      {/* ===== Orders tile ===== */}
      <section className="card" style={{ display: "grid", gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Orders</h3>
        </div>

        {typeof ordImported !== "undefined" && (
          <div className="small muted">
            Last batch imported: <b>{ordImported}</b>{" "}
            {ordNext ? (
              <>
                • nextPageInfo:{" "}
                <code style={{ wordBreak: "break-all" }}>{ordNext}</code>
              </>
            ) : (
              "• No nextPageInfo (done)"
            )}
          </div>
        )}

        <form action={runOrdersAction} className="grid" style={{ gap: 8 }}>
          <label className="small">page_info (optional for first run)</label>
          <input
            name="page_info"
            defaultValue={ordNext}
            placeholder="Paste nextPageInfo here"
            style={{ width: "100%" }}
          />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                redirect(
                  `/shopify/backfill?custImported=${custImported ?? ""}&custNext=${encodeURIComponent(
                    custNext
                  )}`
                )
              }
            >
              Clear
            </button>
            <button type="submit" className="primary">
              Run 1 batch
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
