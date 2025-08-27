// components/ProfitCalculator.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ─────────────────────────────
   Data (brands, products, prices)
   ───────────────────────────── */

type Product = {
  id: string;
  name: string;
  cost: number; // salon cost (excl VAT)
  rrp: number;  // retail price (incl VAT if you price it that way)
};

type Brand = {
  id: string;
  name: string;
  products: Product[];
};

const CATALOGUE: Brand[] = [
  {
    id: "ref",
    name: "REF Stockholm",
    products: [
      { id: "ref-gift-set", name: "REF Stockholm Gift Set", cost: 27.10, rrp: 49.99 },
      { id: "ref-shampoo",  name: "REF Shampoo 285ml",       cost: 7.50,  rrp: 14.99 },
    ],
  },
  {
    id: "goddess",
    name: "Goddess Maintenance Company",
    products: [
      {
        id: "goddess-mask-50",
        name: "Goddess Leave in Restorative Hair Mask 50ml",
        cost: 15.00,
        rrp: 30.00,
      },
    ],
  },
  {
    id: "my-organics",
    name: "MY.ORGANICS",
    products: [
      { id: "myo-shampoo-250",     name: "MY.ORGANICS Shampoo 250ml",     cost: 10.45, rrp: 20.99 },
      { id: "myo-conditioner-250", name: "MY.ORGANICS Conditioner 250ml", cost: 11.20, rrp: 21.99 },
    ],
  },
];

/* ─────────────────────────────
   Helpers
   ───────────────────────────── */

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "£0.00";
  return n < 0
    ? `-£${Math.abs(n).toFixed(2)}`
    : `£${n.toFixed(2)}`;
}

function clampNum(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/* ─────────────────────────────
   Component
   ───────────────────────────── */

export default function ProfitCalculator() {
  // selections
  const [brandId, setBrandId] = useState<string>(CATALOGUE[0]?.id || "");
  const selectedBrand = useMemo(
    () => CATALOGUE.find((b) => b.id === brandId) || CATALOGUE[0],
    [brandId]
  );

  const [productId, setProductId] = useState<string>(
    selectedBrand?.products[0]?.id || ""
  );
  const selectedProduct = useMemo(
    () => selectedBrand?.products.find((p) => p.id === productId) || selectedBrand?.products[0],
    [selectedBrand, productId]
  );

  // pricing (editable, autopopulates from selected product)
  const [cost, setCost] = useState<number>(selectedProduct?.cost ?? 0);
  const [rrp, setRrp] = useState<number>(selectedProduct?.rrp ?? 0);

  // salon inputs
  const [days, setDays] = useState<number>(5);
  const [stylists, setStylists] = useState<number>(1);
  const [unitsPerStylistPerDay, setUnitsPerStylistPerDay] = useState<number>(1);

  // results
  const [calculated, setCalculated] = useState<{
    unitsPerDay: number;
    totalUnits: number;
    totalCost: number;
    revenue: number;
    profit: number;
  } | null>(null);

  // when brand changes, jump to first product
  useEffect(() => {
    const first = selectedBrand?.products[0];
    if (!first) return;
    setProductId(first.id);
    setCost(first.cost);
    setRrp(first.rrp);
  }, [selectedBrand]);

  // when product changes, auto-populate price fields
  useEffect(() => {
    if (!selectedProduct) return;
    setCost(selectedProduct.cost);
    setRrp(selectedProduct.rrp);
  }, [selectedProduct]);

  const unitProfit = Math.max(0, (rrp ?? 0) - (cost ?? 0));

  function onCalculate() {
    const d = clampNum(Math.floor(Number(days) || 0), 0, 365);
    const s = clampNum(Math.floor(Number(stylists) || 0), 0, 500);
    const u = clampNum(Number(unitsPerStylistPerDay) || 0, 0, 1_000);

    const unitsPerDay = s * u;
    const totalUnits = unitsPerDay * d;

    const totalCost = totalUnits * (Number(cost) || 0);
    const revenue = totalUnits * (Number(rrp) || 0);
    const profit = revenue - totalCost;

    setCalculated({ unitsPerDay, totalUnits, totalCost, revenue, profit });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Top two cards */}
      <div
        className="grid"
        style={{
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          alignItems: "start",
        }}
      >
        {/* Product & Pricing */}
        <section className="card">
          <h3>Product &amp; Pricing</h3>

          {/* Brand */}
          <div style={{ marginTop: 12 }}>
            <label>Brand</label>
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
            >
              {CATALOGUE.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Product */}
          <div style={{ marginTop: 10 }}>
            <label>Product (by brand)</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {selectedBrand?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Prices */}
          <div
            className="row"
            style={{ gap: 10, marginTop: 10, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <label>Salon Cost</label>
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Salon RRP</label>
              <input
                type="number"
                step="0.01"
                value={rrp}
                onChange={(e) => setRrp(Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
          </div>

          <p className="small" style={{ marginTop: 8 }}>
            Salon Profit (per unit): <b>{fmtMoney(unitProfit)}</b>
          </p>
        </section>

        {/* Salon Info */}
        <section className="card">
          <h3>Salon Information</h3>

          <div style={{ marginTop: 12 }}>
            <label>How many days are you running this promotion?</label>
            <input
              type="number"
              min={0}
              step="1"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              placeholder="e.g., 5"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label>How many stylist do you have?</label>
            <input
              type="number"
              min={0}
              step="1"
              value={stylists}
              onChange={(e) => setStylists(Number(e.target.value))}
              placeholder="e.g., 1"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label>How many do you think each stylist can sell a day</label>
            <input
              type="number"
              min={0}
              step="1"
              value={unitsPerStylistPerDay}
              onChange={(e) => setUnitsPerStylistPerDay(Number(e.target.value))}
              placeholder="e.g., 1"
            />
          </div>

          <button
            className="primary"
            style={{ marginTop: 12, width: "100%" }}
            onClick={onCalculate}
          >
            Calculate
          </button>
        </section>
      </div>

      {/* Results */}
      {calculated && (
        <div
          className="grid"
          style={{
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            alignItems: "stretch",
          }}
        >
          {/* Outcome */}
          <section className="card">
            <h3>Outcome</h3>
            <div className="small" style={{ marginTop: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>your stylist will sell (per day)</div>
                <div>{calculated.unitsPerDay}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>Your stylist will sell (Time you are running the promotion)</div>
                <div>{calculated.totalUnits}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>This will cost you -</div>
                <div>{fmtMoney(calculated.totalCost)}</div>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Tip: change brand/product to auto-populate pricing, then hit Calculate.
            </p>
          </section>

          {/* Profit Summary */}
          <section className="card" style={{ background: "var(--tint, #f3fff6)" }}>
            <h3>PROFIT</h3>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <div className="small muted">Revenue Generated</div>
              <div className="small" style={{ fontWeight: 600 }}>
                {fmtMoney(calculated.revenue)}
              </div>
            </div>
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                marginTop: 12,
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 700 }}>PROFIT</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(calculated.profit)}</div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
