// app/reports/customers/gap-analysis/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ---------------- types ---------------- */
type Rep = { id: string; name: string };

type VendorSpendRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  perVendor: Record<string, number>;
  subtotal: number;
  taxes: number;
  total: number;
};
type VendorSpendResp = {
  vendors: string[];
  rows: VendorSpendRow[];
};

/* ----------- helpers ----------- */
function fmtMoney(n?: number, currency = "GBP") {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v);
}

function vendorSpendCsvHref({
  start,
  end,
  reps,
  vendors,
}: {
  start?: string | null;
  end?: string | null;
  reps: string[];
  vendors: string[];
}) {
  const qs = new URLSearchParams();
  if (start) { qs.set("start", start); qs.set("from", start); }  // send both names
  if (end)   { qs.set("end", end);     qs.set("to", end); }
  if (reps?.length) qs.set("reps", reps.join(","));
  if (vendors?.length) qs.set("vendors", vendors.join(","));
  qs.set("format", "csv");
  return `/api/reports/vendor-spend?${qs.toString()}`;
}

/** Normalize /api/vendors responses to a simple string[] of vendor names. */
function normalizeVendorNames(json: any): string[] {
  if (Array.isArray(json)) return json.map(String);
  if (Array.isArray(json?.names)) return json.names.map(String);
  if (Array.isArray(json?.vendors)) {
    return json.vendors.map((v: any) => String(v?.name ?? "")).filter(Boolean);
  }
  return [];
}

/** Multi-select with a prominent “All N” pill summary */
function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "All",
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => o.toLowerCase().includes(s));
  }, [options, q]);

  // Summary: show a single white bordered pill like your date inputs
  let summary: React.ReactNode;
  if (value.length === 0) {
    summary = <span className="muted">{placeholder}</span>;
  } else if (value.length === options.length) {
    summary = (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 10px",
          border: "1px solid var(--border)",
          borderRadius: 999,
          background: "#fff",
          fontWeight: 700,
          lineHeight: "20px",
        }}
      >
        All <span>{options.length}</span>
      </span>
    );
  } else {
    const more = value.length > 3 ? ` +${value.length - 3}` : "";
    summary = value.slice(0, 3).join(", ") + more;
  }

  return (
    <div ref={ref} className="field" style={{ position: "relative", minWidth: 280 }}>
      <label>{label}</label>
      <button
        type="button"
        className="input"
        onClick={() => setOpen((v) => !v)}
        style={{
          textAlign: "left",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#fff",
          gap: 8,
        }}
      >
        <span>{summary}</span>
        <span className="muted">▾</span>
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 6,
            padding: 8,
            background: "#fff",
            border: "1px solid var(--border)",
            maxHeight: 320,
            overflow: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
        >
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="chip" onClick={() => onChange(options)} title="Select all">
              All
            </button>
            <button type="button" className="chip" onClick={() => onChange([])} title="Clear all">
              None
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="small muted">No matches.</div>
          ) : (
            <div className="grid" style={{ gap: 6 }}>
              {filtered.map((opt) => {
                const checked = value.includes(opt);
                return (
                  <label key={opt} className="row small" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onChange(e.target.checked ? [...value, opt] : value.filter((v) => v !== opt))
                      }
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- page ---------------- */
export default function GapAnalysisPage() {
  /* ---------- filters ---------- */
  const [start, setStart] = useState<string | null>(null); // yyyy-mm-dd
  const [end, setEnd] = useState<string | null>(null);     // yyyy-mm-dd

  const [reps, setReps] = useState<Rep[]>([]);
  const [repSel, setRepSel] = useState<string[]>([]);

  const [vendorOptions, setVendorOptions] = useState<string[]>([]);
  const [vendorSel, setVendorSel] = useState<string[]>([]);

  /* ---------- data ---------- */
  const [data, setData] = useState<VendorSpendResp | null>(null);
  const [loading, setLoading] = useState(false);

  /* ---------- bootstrap ---------- */
  useEffect(() => {
    (async () => {
      try {
        const [repsRes, vendorsRes] = await Promise.all([
          fetch("/api/sales-reps?ts=" + Date.now(), { cache: "no-store", credentials: "include" })
            .then((r) => r.json())
            .catch(() => []),
          // ✅ use the vendors endpoint and normalize
          fetch("/api/vendors?ts=" + Date.now(), { cache: "no-store", credentials: "include" })
            .then((r) => r.json())
            .then(normalizeVendorNames)
            .catch(() => []),
        ]);

        const repsList: Rep[] = Array.isArray(repsRes) ? repsRes : [];
        const vendorsList: string[] = Array.isArray(vendorsRes) ? vendorsRes : [];

        setReps(repsList);
        setRepSel(repsList.map((r) => r.name)); // default: all reps

        vendorsList.sort((a, b) => a.localeCompare(b));
        setVendorOptions(vendorsList);
        setVendorSel(vendorsList); // default: all vendors
      } catch {
        setReps([]);
        setVendorOptions([]);
        setVendorSel([]);
      }
    })();
  }, []);

  /* ---------- quick ranges ---------- */
  function setRange(kind: "wtd" | "lw" | "mtd" | "ytd" | "clear") {
    const now = new Date();
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (kind === "clear") {
      setStart(null);
      setEnd(null);
      return;
    }

    if (kind === "wtd") {
      const tmp = new Date(now);
      const dow = tmp.getDay();
      const diff = dow === 0 ? -6 : 1 - dow; // Monday
      tmp.setDate(tmp.getDate() + diff);
      setStart(ymd(tmp));
      setEnd(ymd(now));
    } else if (kind === "lw") {
      const tmp = new Date(now);
      const dow = tmp.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(tmp);
      mon.setDate(mon.getDate() + diff - 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      setStart(ymd(mon));
      setEnd(ymd(sun));
    } else if (kind === "mtd") {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setStart(ymd(first));
      setEnd(ymd(now));
    } else if (kind === "ytd") {
      const first = new Date(now.getFullYear(), 0, 1);
      setStart(ymd(first));
      setEnd(ymd(now));
    }
  }

  /* ---------- query ---------- */
  async function run() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (start) { qs.set("start", start); qs.set("from", start); }
      if (end)   { qs.set("end", end);     qs.set("to", end); }
      if (repSel.length) qs.set("reps", repSel.join(","));
      if (vendorSel.length) qs.set("vendors", vendorSel.join(","));

      const res = await fetch(`/api/reports/vendor-spend?${qs.toString()}`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = (await res.json()) as VendorSpendResp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- totals row ---------- */
  const totals = useMemo(() => {
    if (!data) return null;
    const byVendor: Record<string, number> = {};
    let subtotal = 0,
      taxes = 0,
      total = 0;

    for (const r of data.rows) {
      subtotal += r.subtotal || 0;
      taxes += r.taxes || 0;
      total += r.total || 0;
      for (const v of data.vendors) {
        byVendor[v] = (byVendor[v] || 0) + (r.perVendor[v] || 0);
      }
    }
    return { byVendor, subtotal, taxes, total };
  }, [data]);

  /* ---------- dynamic columns ---------- */
  const gridCols = useMemo(() => {
    const vendorCols = (data?.vendors ?? []).map(() => "140px").join(" ");
    return `minmax(240px, 1.5fr) 160px ${vendorCols} 120px 120px 120px`;
  }, [data?.vendors]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>GAP Analysis</h1>
        <p className="small">Spend by customer &amp; vendor, filterable by Sales Rep.</p>
      </section>

      {/* Filters */}
      <section className="card grid" style={{ gap: 12, overflow: "visible" }}>
        {/* Row: Date range + quick picks */}
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field">
            <label>Start</label>
            <input type="date" value={start ?? ""} onChange={(e) => setStart(e.target.value || null)} />
          </div>
          <div className="field">
            <label>End</label>
            <input type="date" value={end ?? ""} onChange={(e) => setEnd(e.target.value || null)} />
          </div>

          <div className="row small" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="muted">Quick ranges:</span>
            <button type="button" className="chip" onClick={() => setRange("wtd")}>Week to date</button>
            <button type="button" className="chip" onClick={() => setRange("lw")}>Last week</button>
            <button type="button" className="chip" onClick={() => setRange("mtd")}>Month to date</button>
            <button type="button" className="chip" onClick={() => setRange("ytd")}>Year to date</button>
            <button type="button" className="chip" onClick={() => setRange("clear")}>Clear</button>
          </div>
        </div>

        {/* Row: Rep + Vendor selectors */}
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <MultiSelect
            label="Sales Reps"
            options={reps.map((r) => r.name)}
            value={repSel}
            onChange={setRepSel}
            placeholder="All reps"
          />
          <MultiSelect
            label="Vendors"
            options={vendorOptions}
            value={vendorSel}
            onChange={setVendorSel}
            placeholder="All vendors"
          />
        </div>

        {/* Row: Actions */}
        <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
          <a
            href={vendorSpendCsvHref({ start, end, reps: repSel, vendors: vendorSel })}
            className="chip"
            target="_blank"
            rel="noopener"
            download={`gap-analysis.csv`}
            title="Download CSV"
          >
            Export CSV
          </a>
        </div>
      </section>

      {/* Results */}
      <section className="card">
        {!data ? (
          <p className="small">Set filters and click <b>Run</b>.</p>
        ) : data.rows.length === 0 ? (
          <p className="small">No results.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            {/* header */}
            <div
              className="small"
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                columnGap: 12,
                fontWeight: 600,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>Customer</div>
              <div>Sales Rep</div>
              {data.vendors.map((v) => (
                <div key={v}>{v}</div>
              ))}
              <div>Subtotal</div>
              <div>Taxes</div>
              <div>Total</div>
            </div>

            {/* rows */}
            {data.rows.map((r) => (
              <div
                key={r.customerId}
                className="small"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  columnGap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div>{r.salonName}</div>
                <div>{r.salesRep || "—"}</div>
                {data.vendors.map((v) => (
                  <div key={v}>{fmtMoney(r.perVendor[v])}</div>
                ))}
                <div>{fmtMoney(r.subtotal)}</div>
                <div>{fmtMoney(r.taxes)}</div>
                <div style={{ fontWeight: 700 }}>{fmtMoney(r.total)}</div>
              </div>
            ))}

            {/* totals */}
            {/* eslint-disable react/jsx-key */}
            {totals && (
              <div
                className="small"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  columnGap: 12,
                  paddingTop: 10,
                  fontWeight: 700,
                }}
              >
                <div>Totals</div>
                <div></div>
                {data.vendors.map((v) => (
                  <div key={v}>{fmtMoney(totals.byVendor[v])}</div>
                ))}
                <div>{fmtMoney(totals.subtotal)}</div>
                <div>{fmtMoney(totals.taxes)}</div>
                <div>{fmtMoney(totals.total)}</div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
