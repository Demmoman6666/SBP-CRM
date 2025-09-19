// components/ShopifyProductPicker.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Item = {
  variantId: number;
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  priceExVat?: number | null;
  available?: number | null;
  imageUrl?: string | null;
};

type Props = {
  /** Placeholder for the search input */
  placeholder?: string;
  /** Called when the user clicks Save with all selected items */
  onConfirm: (items: Item[]) => void;
};

/* ---------- helpers ---------- */

function normaliseRow(row: any): Item | null {
  if (!row) return null;

  // Try multiple common shapes from Shopify-search endpoints and normalize.
  const variantId = Number(
    row.variantId ??
      row.variant_id ??
      row.variantID ??
      row.id ??
      row.variant?.id ??
      row.node?.id ??
      NaN
  );
  if (!Number.isFinite(variantId)) return null;

  const productTitle =
    row.productTitle ??
    row.product_title ??
    row.product?.title ??
    row.title?.product ??
    row.title ??
    "Product";

  const variantTitle =
    row.variantTitle ??
    row.variant_title ??
    row.variant?.title ??
    row.title?.variant ??
    null;

  const sku = row.sku ?? row.variant?.sku ?? null;

  const priceExVatRaw =
    row.priceExVat ??
    row.price_ex_vat ??
    row.price ??
    row.variant?.price ??
    row.unit_price;
  const priceExVat =
    priceExVatRaw == null || priceExVatRaw === ""
      ? null
      : Number.isFinite(Number(priceExVatRaw))
      ? Number(priceExVatRaw)
      : null;

  const availableRaw =
    row.available ??
    row.inventoryQuantity ??
    row.inventory_quantity ??
    row.inventory ??
    row.variant?.inventoryQuantity;
  const available =
    availableRaw == null || availableRaw === ""
      ? null
      : Number.isFinite(Number(availableRaw))
      ? Number(availableRaw)
      : null;

  const imageUrl =
    row.imageUrl ??
    row.image_url ??
    row.image?.src ??
    row.product?.image?.src ??
    row.variant?.image?.src ??
    null;

  return {
    variantId,
    productTitle,
    variantTitle: variantTitle ?? null,
    sku: sku ?? null,
    priceExVat,
    available,
    imageUrl,
  };
}

async function fetchProducts(q: string): Promise<Item[]> {
  if (!q.trim()) return [];

  // Try a few likely endpoints — whichever you have will respond.
  const endpoints = [
    `/api/shopify/products/search?q=${encodeURIComponent(q)}`,
    `/api/shopify/search-products?q=${encodeURIComponent(q)}`,
    `/api/shopify/products?q=${encodeURIComponent(q)}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json();

      // Accept: [], {items:[]}, {results:[]}, {variants:[]}
      const rows: any[] = Array.isArray(j)
        ? j
        : Array.isArray(j?.items)
        ? j.items
        : Array.isArray(j?.results)
        ? j.results
        : Array.isArray(j?.variants)
        ? j.variants
        : [];

      const items = rows.map(normaliseRow).filter(Boolean) as Item[];
      return items;
    } catch {
      // try next endpoint
    }
  }
  return [];
}

function fmtGBP(n?: number | null) {
  if (!Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number(n || 0)
  );
}

/* ---------- component ---------- */

export default function ShopifyProductPicker({ placeholder, onConfirm }: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Record<number, Item>>({});
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) {
        setItems([]);
        return;
      }
      setBusy(true);
      try {
        const res = await fetchProducts(query);
        setItems(res);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const selectedList = useMemo(() => Object.values(selected), [selected]);

  function toggle(v: Item) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[v.variantId]) delete next[v.variantId];
      else next[v.variantId] = v;
      return next;
    });
  }

  function cancel() {
    setSelected({});
    setQuery("");
    setItems([]);
    inputRef.current?.focus();
  }

  function confirm() {
    if (selectedList.length === 0) return;
    onConfirm(selectedList);
    setSelected({});
    setQuery("");
    setItems([]);
    inputRef.current?.focus();
  }

  return (
    <div>
      {/* Header with Cancel / Products / Save */}
      <div className="row" style={{ alignItems: "center", marginBottom: 6, gap: 8 }}>
        <button className="btn" type="button" onClick={cancel} aria-label="Cancel selection">
          Cancel
        </button>
        <div className="small muted" style={{ flex: 1, textAlign: "center" }}>
          Products
        </div>
        <button
          className="primary"
          type="button"
          onClick={confirm}
          disabled={selectedList.length === 0}
          aria-label="Save selected products"
        >
          Save
        </button>
      </div>

      {/* Search box */}
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder || "Search products…"}
      />

      {/* Results */}
      <div style={{ marginTop: 8 }}>
        {busy && <div className="small muted">Searching…</div>}

        {!busy && query && items.length === 0 && (
          <div className="small muted">No products match “{query}”.</div>
        )}

        {items.map((v) => {
          const isChecked = !!selected[v.variantId];
          return (
            <label
              key={v.variantId}
              className="row"
              style={{
                gap: 10,
                alignItems: "center",
                padding: "10px 0",
                borderTop: "1px solid #eee",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(v)}
                aria-label={`Select ${v.productTitle} ${v.variantTitle || ""}`}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {v.productTitle}
                  {v.variantTitle ? ` — ${v.variantTitle}` : ""}
                </div>
                <div className="small muted">
                  {fmtGBP(v.priceExVat)} • {v.available ?? 0} available
                  {v.sku ? ` • SKU ${v.sku}` : ""}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
