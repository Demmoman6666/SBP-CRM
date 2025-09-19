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

// robustly turn Shopify ids (including GIDs) into a number
function toNumericId(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v);
  const m = s.match(/(\d+)(?!.*\d)/); // last run of digits
  return m ? Number(m[1]) : null;
}

// parse prices from many shapes ("£3.71", "3,71", MoneyV2, etc.)
function parsePrice(val: any): number | null {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "object") {
    if (typeof val.amount === "string" || typeof val.amount === "number") {
      return parsePrice(val.amount);
    }
  }
  const s = String(val).trim();
  let cleaned = s.replace(/[^\d.,-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normaliseRow(row: any): Item | null {
  if (!row) return null;

  // ----- ALWAYS resolve a VARIANT id (never a product id) -----
  // 1) direct variant id fields
  let rawVariantId =
    row.variantId ??
    row.variant_id ??
    row.variantID ??
    row.variant?.id ??
    row.node?.id; // GraphQL may return a variant id here

  // 2) if we still don't have a variant id, many search endpoints return product-level rows
  //    -> take the first variant from common shapes
  if (!rawVariantId) {
    rawVariantId =
      row?.variants?.[0]?.id ??
      row?.product?.variants?.[0]?.id ??
      row?.node?.variants?.edges?.[0]?.node?.id ??
      row?.node?.product?.variants?.edges?.[0]?.node?.id;
  }

  const variantId = toNumericId(rawVariantId);
  if (!Number.isFinite(Number(variantId))) return null;
  // ------------------------------------------------------------

  const productTitle =
    row.productTitle ??
    row.product_title ??
    row.product?.title ??
    row.title?.product ??
    row.node?.product?.title ??
    row.title ??
    row.title?.split(" / ")?.[0] ?? // sometimes combined "Product / Variant"
    "Product";

  // prefer explicit variant title; otherwise try the first variant on product-level rows
  const variantTitle =
    row.variantTitle ??
    row.variant_title ??
    row.variant?.title ??
    row.title?.variant ??
    row.node?.title ??
    row?.variants?.[0]?.title ??
    row?.product?.variants?.[0]?.title ??
    row?.node?.variants?.edges?.[0]?.node?.title ??
    null;

  const sku =
    row.sku ??
    row.variant?.sku ??
    row.node?.sku ??
    row?.variants?.[0]?.sku ??
    row?.product?.variants?.[0]?.sku ??
    row?.node?.variants?.edges?.[0]?.node?.sku ??
    null;

  // price fallbacks (ex VAT preferred, but show something if present)
  const priceExVatRaw =
    row.priceExVat ??
    row.price_ex_vat ??
    row.unit_price ??
    row.price ??
    row.variant?.price ??
    row.price?.amount ?? // MoneyV2
    row.node?.price ??
    row.node?.priceV2?.amount ?? // MoneyV2
    row.node?.unitPrice?.amount ?? // MoneyV2
    row.presentment_prices?.[0]?.price?.amount ??
    row?.variants?.[0]?.price ??
    row?.product?.variants?.[0]?.price ??
    row?.node?.variants?.edges?.[0]?.node?.price;

  const priceExVat = parsePrice(priceExVatRaw);

  const availableRaw =
    row.available ??
    row.inventoryQuantity ??
    row.inventory_quantity ??
    row.inventory ??
    row.variant?.inventoryQuantity ??
    row.node?.availableForSaleQuantity ??
    row?.variants?.[0]?.inventory_quantity ??
    row?.product?.variants?.[0]?.inventory_quantity ??
    row?.node?.variants?.edges?.[0]?.node?.inventoryQuantity;

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
    row.node?.image?.src ??
    row?.variants?.[0]?.image?.src ??
    row?.node?.variants?.edges?.[0]?.node?.image?.src ??
    null;

  return {
    variantId: Number(variantId),
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

// show "—" when price is missing (don’t coerce to 0)
function fmtGBP(n?: number | null) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(
    Number(n)
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

  // Keep: price hydration via /api/shopify/variant-prices (works with variant ids)
  useEffect(() => {
    const missing = items.filter(
      (i) => (i.priceExVat == null || !Number.isFinite(Number(i.priceExVat))) && Number.isFinite(i.variantId)
    );
    if (missing.length === 0) return;

    (async () => {
      try {
        const r = await fetch("/api/shopify/variant-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids: missing.map((m) => m.variantId) }),
        });
        const j = await r.json().catch(() => ({}));
        const map = (j?.prices || {}) as Record<string, { priceExVat?: number }>;

        if (map && typeof map === "object") {
          setItems((prev) =>
            prev.map((it) => {
              const hit = map[String(it.variantId)];
              if (!hit || hit.priceExVat == null) return it;
              return { ...it, priceExVat: Number(hit.priceExVat) };
            })
          );
        }
      } catch {
        /* ignore */
      }
    })();
  }, [items]);

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
                  {fmtGBP(v.priceExVat)}
                  {v.available != null ? ` • ${v.available} available` : ""}
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
