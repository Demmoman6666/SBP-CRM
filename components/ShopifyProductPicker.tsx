"use client";

import { useEffect, useState } from "react";

/* ---------- tiny safe fetch helper ---------- */
async function safeGet<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
}

/* ---------- types ---------- */
export type ShopifySearchResult = {
  variantId: number;              // required
  productTitle: string;           // required
  variantTitle?: string | null;
  sku?: string | null;
  priceExVat?: number | null;     // £ ex VAT
  available?: number | null;      // inventory qty
  image?: string | null;
};

type Props = {
  placeholder?: string;
  /** Called when user taps Save; provides ALL selected results */
  onConfirm: (items: ShopifySearchResult[]) => void;
  initialSelectedVariantIds?: number[];
  clearAfterConfirm?: boolean;
};

/* ---------- currency helper ---------- */
const fmtGBP = (n: number | null | undefined) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number.isFinite(Number(n)) ? Number(n) : 0
  );

export default function ShopifyProductPicker({
  placeholder = "Search products…",
  onConfirm,
  initialSelectedVariantIds = [],
  clearAfterConfirm = true,
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShopifySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialSelectedVariantIds)
  );

  // debounce search
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data =
          (await safeGet<ShopifySearchResult[]>(
            `/api/shopify/products/search?q=${encodeURIComponent(q)}`
          ).catch(() => [])) ?? [];
        if (alive) setResults(Array.isArray(data) ? data : []);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function confirmSelection() {
    const picked = results.filter((r) => selected.has(r.variantId));
    if (picked.length === 0) return;
    onConfirm(picked);
    if (clearAfterConfirm) clearSelection();
  }

  return (
    <div className="picker">
      {/* header row */}
      <div className="row header">
        <button type="button" className="btn" onClick={clearSelection}>
          Cancel
        </button>
        <div className="title">Products</div>
        <button
          type="button"
          className={`btn ${selected.size ? "primary" : ""}`}
          disabled={!selected.size}
          onClick={confirmSelection}
        >
          Save
        </button>
      </div>

      {/* search box */}
      <div className="search">
        <input
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search products"
        />
      </div>

      {/* results */}
      <div className="list">
        {loading && <div className="muted small">Searching…</div>}
        {!loading && q && results.length === 0 && (
          <div className="muted small">No products match “{q}”.</div>
        )}

        {results.map((r) => {
          const checked = selected.has(r.variantId);
          return (
            <label key={r.variantId} className="row item">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(r.variantId)}
              />
              {r.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.image} alt="" className="thumb" />
              ) : (
                <div className="thumb placeholder" />
              )}
              <div className="meta">
                <div className="name" title={`${r.productTitle}${r.variantTitle ? ` — ${r.variantTitle}` : ""}`}>
                  {r.productTitle}
                  {r.variantTitle ? <span className="variant"> — {r.variantTitle}</span> : null}
                </div>
                <div className="sub muted">
                  {fmtGBP(r.priceExVat || 0)}{" "}
                  {Number.isFinite(r.available as any) ? (
                    <>
                      • <span className={r.available! > 0 ? "" : "oos"}>
                        {r.available} available
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {/* plain <style> (no styled-jsx) to avoid SWC crashes */}
      <style>{`
        .picker {
          border: 1px solid var(--border, #eee);
          border-radius: 14px;
          padding: 10px;
          background: var(--card, #fff);
        }
        .row { display:flex; align-items:center; gap:10px; }
        .header { justify-content:space-between; margin-bottom:8px; }
        .title { font-weight:700; }
        .btn {
          border:1px solid #ddd; background:#fafafa; border-radius:10px;
          padding:6px 10px; font-weight:600;
        }
        .btn.primary { background:#ffb3d6; border-color:#ffb3d6; }
        .btn:disabled { opacity:.55; }
        .search { margin-bottom:8px; }
        .search input {
          width:100%; border:2px solid #f7c6de; border-radius:14px;
          padding:10px 14px; outline:none;
        }
        .list { display:grid; gap:8px; max-height:360px; overflow:auto; }
        .item { padding:8px; border-radius:12px; border:1px solid #eee; cursor:pointer; }
        .item input[type="checkbox"] { transform: scale(1.15); }
        .thumb { width:36px; height:36px; border-radius:6px; object-fit:cover; background:#f4f4f4; }
        .thumb.placeholder { display:inline-block; }
        .meta { min-width:0; }
        .name { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .variant { font-weight:600; }
        .sub { font-size:12px; }
        .muted { color:#6b7280; }
        .oos { color:#c53030; font-weight:600; }
      `}</style>
    </div>
  );
}
