// components/ProfitCalculator.tsx
"use client";

import { useMemo, useState } from "react";

/** ------- Demo data (edit to suit your brands/products/prices) ------- */
type Product = { id: string; name: string; cost: number; rrp: number };
type Brand = { id: string; name: string; products: Product[] };

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
    id: "neal-wolf",
    name: "Neal & Wolf",
    products: [
      { id: "nw-gift",  name: "Neal & Wolf Gift Set", cost: 22.00, rrp: 44.00 },
      { id: "nw-oil",   name: "Neal & Wolf Velvet Oil", cost: 10.00, rrp: 19.99 },
    ],
  },
  {
    id: "procare",
    name: "Procare",
    products: [
      { id: "pc-foil", name: "Procare Foil 100m", cost: 5.40, rrp: 9.99 },
    ],
  },
  {
    id: "my-organics",
    name: "MY.ORGANICS",
    products: [
      { id: "myo-mask", name: "MY.O Mask 250ml", cost: 12.50, rrp: 24.00 },
    ],
  },
  {
    id: "goddess",
    name: "Goddess Maintenance Company",
    products: [
      { id: "gmc-scrub", name: "Scalp Scrub 200ml", cost: 8.50, rrp: 16.00 },
    ],
  },
];

/** ------- helpers ------- */
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function ProfitCalculator() {
  const [brandId, setBrandId] = useState<string>(CATALOGUE[0]?.id ?? "");
  const products = useMemo(() => CATALOGUE.find(b => b.id === brandId)?.products ?? [], [brandId]);

  const [productId, setProductId] = useState<string>(products[0]?.id ?? "");
  // pricing (editable – auto-fills when product changes)
  const [salonCost, setSalonCost] = useState<string>("");
  const [salonRrp, setSalonRrp] = useState<string>("");

  // salon inputs
  const [days, setDays] = useState<string>("5");
  const [stylists, setStylists] = useState<string>("1");
  const [perStylistPerDay, setPerStylistPerDay] = useState<string>("1");

  // calculated
  const [didCalc, setDidCalc] = useState(false);
  const [units, setUnits] = useState(0);
  const [revenue, setRevenue] = useState(0);
  const [cost, setCost] = useState(0);
  const [profit, setProfit] = useState(0);

  // when brand changes, reset product to first of that brand
  function onBrandChange(id: string) {
    setBrandId(id);
    const first = (CATALOGUE.find(b => b.id === id)?.products ?? [])[0];
    if (first) {
      setProductId(first.id);
      setSalonCost(first.cost.toString());
      setSalonRrp(first.rrp.toString());
    } else {
      setProductId("");
      setSalonCost("");
      setSalonRrp("");
    }
    setDidCalc(false);
  }

  // when product changes, auto-fill pricing
  function onProductChange(id: string) {
    setProductId(id);
    const p = products.find(p => p.id === id);
    if (p) {
      setSalonCost(p.cost.toString());
      setSalonRrp(p.rrp.toString());
    }
    setDidCalc(false);
  }

  // initialise default pricing for first mount
  useMemo(() => {
    if (!salonCost && !salonRrp && products[0]) {
      setProductId(products[0].id);
      setSalonCost(products[0].cost.toString());
      setSalonRrp(products[0].rrp.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const perUnitProfit = Math.max(0, toNum(salonRrp) - toNum(salonCost));

  function calculate() {
    const d = Math.max(0, Math.floor(toNum(days)));
    const s = Math.max(0, Math.floor(toNum(stylists)));
    const u = Math.max(0, toNum(perStylistPerDay));

    const totalUnits = d * s * u;
    const totalRevenue = totalUnits * toNum(salonRrp);
    const totalCost = totalUnits * toNum(salonCost);
    const totalProfit = totalRevenue - totalCost;

    setUnits(totalUnits);
    setRevenue(totalRevenue);
    setCost(totalCost);
    setProfit(totalProfit);
    setDidCalc(true);
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      {/* top grid */}
      <div className="grid grid-2" style={{ gap: 12 }}>
        {/* Product & Pricing */}
        <div className="card">
          <b>Product &amp; Pricing</b>

          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            <label>Brand</label>
            <select value={brandId} onChange={e => onBrandChange(e.target.value)}>
              {CATALOGUE.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <label>Product (by brand)</label>
            <select value={productId} onChange={e => onProductChange(e.target.value)}>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label>Salon Cost</label>
                <input
                  inputMode="decimal"
                  value={salonCost}
                  onChange={e => setSalonCost(e.target.value)}
                  placeholder="e.g., 27.10"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Salon RRP</label>
                <input
                  inputMode="decimal"
                  value={salonRrp}
                  onChange={e => setSalonRrp(e.target.value)}
                  placeholder="e.g., 49.99"
                />
              </div>
            </div>

            <div className="small muted">
              Salon Profit (per unit): <b>{fmtMoney(perUnitProfit)}</b>
            </div>
          </div>
        </div>

        {/* Salon Information */}
        <div className="card">
          <b>Salon Information</b>

          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            <label>How many days are you running this promotion?</label>
            <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />

            <label>How many stylist do you have?</label>
            <input inputMode="numeric" value={stylists} onChange={e => setStylists(e.target.value)} />

            <label>How many do you think each stylist can sell a day</label>
            <input
              inputMode="decimal"
              value={perStylistPerDay}
              onChange={e => setPerStylistPerDay(e.target.value)}
            />

            <button className="primary" onClick={calculate} style={{ marginTop: 6 }}>
              Calculate
            </button>
          </div>
        </div>
      </div>

      {/* results */}
      {didCalc ? (
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="card">
            <b>Outcome</b>
            <div className="grid" style={{ gap: 6, marginTop: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small">Your stylist will sell (per day)</div>
                <div className="small">{toNum(perStylistPerDay)}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small">Your stylist will sell (Time you are running the promotion)</div>
                <div className="small">{units}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small">This will cost you –</div>
                <div className="small">{fmtMoney(cost)}</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ borderColor: "var(--success)", background: "rgba(16,185,129,0.08)" }}>
            <b>PROFIT</b>
            <div className="grid" style={{ gap: 8, marginTop: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small">Revenue Generated</div>
                <div className="small" style={{ fontWeight: 600 }}>{fmtMoney(revenue)}</div>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="small">PROFIT</div>
                <div className="small" style={{ fontWeight: 700 }}>{fmtMoney(profit)}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="small muted">
            Tip: change brand/product to auto-populate pricing, then hit Calculate.
          </div>
        </div>
      )}
    </div>
  );
}
