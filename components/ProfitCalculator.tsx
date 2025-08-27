// components/ProfitCalculator.tsx
"use client";

import { useMemo, useState } from "react";

/* ---------- tiny helpers ---------- */
function toNum(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function fmtMoney(n: number, currency = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(n || 0);
  } catch {
    // fallback if currency code ever unknown
    return `£${(n || 0).toFixed(2)}`;
  }
}
function pct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/* ---------- small inputs ---------- */
function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  prefix,
  suffix,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label>{label}</label>
      <div className="row" style={{ gap: 6 }}>
        {prefix ? <span className="small muted" style={{ alignSelf: "center" }}>{prefix}</span> : null}
        <input
          inputMode="decimal"
          step={step}
          min={min as any}
          max={max as any}
          placeholder={placeholder}
          value={Number.isFinite(value) ? String(value) : ""}
          onChange={(e) => onChange(toNum(e.target.value))}
          style={{ flex: 1 }}
        />
        {suffix ? <span className="small muted" style={{ alignSelf: "center" }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

function PercentField(p: Omit<Parameters<typeof NumberField>[0], "suffix" | "step">) {
  return <NumberField {...p} step={0.1} suffix="%" />;
}

/* ============================================================
   Profit Calculator
   - Two modes: "Retail" (product sale) and "Service" (appointment)
   ============================================================ */
export default function ProfitCalculator() {
  const [currency, setCurrency] = useState<"GBP" | "EUR" | "USD">("GBP");
  const [mode, setMode] = useState<"retail" | "service">("retail");

  // VAT default 20% (UK)
  const [vatPct, setVatPct] = useState(20);

  /* ---------- Retail inputs ---------- */
  const [sellIncVat, setSellIncVat] = useState(19.99);
  const [unitCostExVat, setUnitCostExVat] = useState(8.0);
  const [discountPct, setDiscountPct] = useState(0);
  const [qty, setQty] = useState(1);
  const [targetMarginPct, setTargetMarginPct] = useState(60);

  /* ---------- Service inputs ---------- */
  const [servicePriceIncVat, setServicePriceIncVat] = useState(60);
  const [durationMins, setDurationMins] = useState(60);
  const [staffCostPerHour, setStaffCostPerHour] = useState(14); // wage + NI/pension etc
  const [productCostPerService, setProductCostPerService] = useState(4);
  const [overheadPerHour, setOverheadPerHour] = useState(6);    // rent, utilities, etc
  const [svcDiscountPct, setSvcDiscountPct] = useState(0);
  const [svcTargetMarginPct, setSvcTargetMarginPct] = useState(60);

  /* ---------- Retail calculations ---------- */
  const retail = useMemo(() => {
    const vat = clamp(vatPct / 100, 0, 1);
    const priceInc = Math.max(0, sellIncVat);
    const priceEx = priceInc / (1 + vat);

    const costEx = Math.max(0, unitCostExVat);
    const discount = clamp(discountPct / 100, 0, 1);

    const netPriceEx = priceEx * (1 - discount);

    const profitPerUnit = netPriceEx - costEx;                // ex VAT basis
    const margin = netPriceEx > 0 ? profitPerUnit / netPriceEx : 0;
    const markup = costEx > 0 ? profitPerUnit / costEx : 0;

    const totalRevenueEx = netPriceEx * qty;
    const totalProfit = profitPerUnit * qty;

    // price needed (inc VAT) for target margin on ex-VAT price
    const targetMargin = clamp(targetMarginPct / 100, 0, 0.99);
    const neededEx = costEx / (1 - targetMargin);
    const neededInc = neededEx * (1 + vat);

    return {
      priceInc,
      priceEx,
      netPriceEx,
      costEx,
      profitPerUnit,
      margin,
      markup,
      totalRevenueEx,
      totalProfit,
      neededIncForTargetMargin: neededInc,
    };
  }, [vatPct, sellIncVat, unitCostExVat, discountPct, qty, targetMarginPct]);

  /* ---------- Service calculations ---------- */
  const service = useMemo(() => {
    const vat = clamp(vatPct / 100, 0, 1);
    const priceInc = Math.max(0, servicePriceIncVat);
    const priceEx = priceInc / (1 + vat);
    const discount = clamp(svcDiscountPct / 100, 0, 1);
    const netPriceEx = priceEx * (1 - discount);

    const hours = Math.max(0, durationMins) / 60;
    const labour = hours * Math.max(0, staffCostPerHour);
    const overhead = hours * Math.max(0, overheadPerHour);
    const product = Math.max(0, productCostPerService);

    const totalCost = labour + overhead + product;
    const profit = netPriceEx - totalCost;
    const margin = netPriceEx > 0 ? profit / netPriceEx : 0;
    const profitPerHour = hours > 0 ? profit / hours : 0;

    const targetMargin = clamp(svcTargetMarginPct / 100, 0, 0.99);
    const neededEx = totalCost / (1 - targetMargin);
    const neededInc = neededEx * (1 + vat);

    return {
      priceInc,
      priceEx,
      netPriceEx,
      labour,
      overhead,
      product,
      totalCost,
      profit,
      margin,
      profitPerHour,
      neededIncForTargetMargin: neededInc,
    };
  }, [
    vatPct,
    servicePriceIncVat,
    durationMins,
    staffCostPerHour,
    overheadPerHour,
    productCostPerService,
    svcDiscountPct,
    svcTargetMarginPct,
  ]);

  return (
    <div className="grid" style={{ gap: 12 }}>
      {/* top controls */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="segmented" role="tablist" aria-label="Mode">
          <button
            type="button"
            aria-selected={mode === "retail"}
            className={mode === "retail" ? "primary" : ""}
            onClick={() => setMode("retail")}
          >
            Retail (Products)
          </button>
          <button
            type="button"
            aria-selected={mode === "service"}
            className={mode === "service" ? "primary" : ""}
            onClick={() => setMode("service")}
          >
            Services
          </button>
        </div>

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <label className="small">Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value as any)}>
            <option value="GBP">GBP £</option>
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
          </select>
        </div>

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <label className="small">VAT</label>
          <input
            style={{ width: 80 }}
            inputMode="decimal"
            value={vatPct}
            onChange={(e) => setVatPct(clamp(toNum(e.target.value, 20), 0, 50))}
          />
          <span className="small muted">%</span>
        </div>
      </div>

      {/* INPUTS */}
      {mode === "retail" ? (
        <div className="grid grid-2" style={{ gap: 12 }}>
          <NumberField
            label="Selling price (inc VAT)"
            value={sellIncVat}
            onChange={setSellIncVat}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.01}
          />
          <NumberField
            label="Unit cost (ex VAT)"
            value={unitCostExVat}
            onChange={setUnitCostExVat}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.01}
          />
          <PercentField label="Discount" value={discountPct} onChange={setDiscountPct} />
          <NumberField label="Quantity" value={qty} onChange={(n) => setQty(Math.max(1, Math.round(n)))} />
          <PercentField
            label="Target margin"
            value={targetMarginPct}
            onChange={(n) => setTargetMarginPct(clamp(n, 0, 95))}
          />
        </div>
      ) : (
        <div className="grid grid-2" style={{ gap: 12 }}>
          <NumberField
            label="Service price (inc VAT)"
            value={servicePriceIncVat}
            onChange={setServicePriceIncVat}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.5}
          />
          <NumberField label="Duration" value={durationMins} onChange={(n) => setDurationMins(Math.max(0, n))} suffix="mins" />
          <NumberField
            label="Staff cost per hour"
            value={staffCostPerHour}
            onChange={setStaffCostPerHour}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.5}
          />
          <NumberField
            label="Overhead per hour"
            value={overheadPerHour}
            onChange={setOverheadPerHour}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.5}
          />
          <NumberField
            label="Product/consumables per service"
            value={productCostPerService}
            onChange={setProductCostPerService}
            prefix={currency === "USD" ? "$" : currency === "EUR" ? "€" : "£"}
            step={0.1}
          />
          <PercentField label="Discount" value={svcDiscountPct} onChange={setSvcDiscountPct} />
          <PercentField
            label="Target margin"
            value={svcTargetMarginPct}
            onChange={(n) => setSvcTargetMarginPct(clamp(n, 0, 95))}
          />
        </div>
      )}

      {/* RESULTS */}
      <div className="grid" style={{ gap: 10 }}>
        <b>Results</b>

        {mode === "retail" ? (
          <div className="grid grid-3" style={{ gap: 10 }}>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Net price (ex VAT)</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(retail.netPriceEx, currency)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Gross profit / unit</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(retail.profitPerUnit, currency)} ({pct(retail.margin)})</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Markup</div>
              <div style={{ fontWeight: 700 }}>{pct(retail.markup)}</div>
            </div>

            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Total revenue (ex VAT)</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(retail.totalRevenueEx, currency)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Total profit</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(retail.totalProfit, currency)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Price needed for target margin</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(retail.neededIncForTargetMargin, currency)} (inc VAT)</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-3" style={{ gap: 10 }}>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Revenue (ex VAT)</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(service.netPriceEx, currency)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Total cost</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(service.totalCost, currency)}</div>
              <div className="small muted" style={{ marginTop: 6 }}>
                Labour {fmtMoney(service.labour, currency)} · Overhead {fmtMoney(service.overhead, currency)} · Products {fmtMoney(service.product, currency)}
              </div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Profit</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(service.profit, currency)} ({pct(service.margin)})</div>
              <div className="small muted" style={{ marginTop: 6 }}>Per hour {fmtMoney(service.profitPerHour, currency)}</div>
            </div>

            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Break-even (ex VAT)</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(service.totalCost, currency)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="small muted">Price needed for target margin</div>
              <div style={{ fontWeight: 700 }}>{fmtMoney(service.neededIncForTargetMargin, currency)} (inc VAT)</div>
            </div>
          </div>
        )}
      </div>

      {/* quick scenarios (retail only) */}
      {mode === "retail" && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Quick scenarios</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="primary" onClick={() => setSellIncVat(+((sellIncVat * 1.05).toFixed(2)))}>+5% price</button>
            <button className="primary" onClick={() => setSellIncVat(+((sellIncVat * 1.10).toFixed(2)))}>+10% price</button>
            <button onClick={() => setDiscountPct(0)}>Clear discount</button>
            <button onClick={() => setQty(1)}>Qty 1</button>
            <button onClick={() => setQty(6)}>Qty 6</button>
            <button onClick={() => setQty(12)}>Qty 12</button>
          </div>
        </div>
      )}
    </div>
  );
}
