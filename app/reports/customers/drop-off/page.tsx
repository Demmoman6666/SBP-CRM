// app/reports/customers/customer-dropoff/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* ───────────────────────── tiny reusable multiselect ───────────────────────── */
type MultiSelectProps = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxHeight?: number;
};

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "Filter…",
  maxHeight = 260,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => o.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const toggle = (opt: string) => {
    const set = new Set(selected);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    onChange(Array.from(set));
  };

  return (
    <div className="field" ref={wrapRef} style={{ position: "relative" }}>
      <label>{label}</label>
      <div
        className="row"
        onClick={() => setOpen(v => !v)}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "6px 10px",
          minHeight: 36,
          cursor: "pointer",
          flexWrap: "wrap",
          gap: 6,
          background: "var(--card)",
        }}
      >
        {selected.length === 0 ? (
          <span className="muted small">All</span>
        ) : (
          selected.map(s => (
            <span
              key={s}
              className="tag"
              onClick={(e) => { e.stopPropagation(); toggle(s); }}
              style={{ userSelect: "none" }}
            >
              {s} ✕
            </span>
          ))
        )}
        <div style={{ marginLeft: "auto" }} className="small muted">▼</div>
      </div>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            zIndex: 1000,
            left: 0,
            right: 0,
            marginTop: 4,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 8,
            background: "var(--card)",
          }}
        >
          <input
            placeholder={placeholder}
            value={q}
            onChange={e => setQ(e.target.value)}
            className="small"
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "6px 8px",
              marginBottom: 8,
            }}
          />
          <div
            style={{
              maxHeight,
              overflow: "auto",
              display: "grid",
              gap: 4,
            }}
          >
            {filtered.length === 0 && (
              <div className="small muted" style={{ padding: 6 }}>No matches</div>
            )}
            {filtered.map(opt => {
              const checked = selected.includes(opt);
              return (
                <label
                  key={opt}
                  className="row"
                  style={{ gap: 8, alignItems: "center", cursor: "pointer" }}
                  onClick={() => toggle(opt)}
                >
                  <input type="checkbox" checked={checked} readOnly />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
            <button
              type="button"
              className="small"
              onClick={() => onChange([])}
              style={{ textDecoration: "underline" }}
            >
              Clear
            </button>
            <button type="button" className="primary small" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── page component ───────────────────────────── */

type Rep = { id: string; name: string };
type DropRow = {
  customerId: string;
  salonName: string;
  salesRep: string | null;
  lastOrderAt: string | null; // ISO
  daysSince?: number;
};

type SortKey = "name" | "days";

export default function CustomerDropOffReport() {
  const [reps, setReps] = useState<string[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [thresholdDays, setThresholdDays] = useState<number>(7);
  const [customDays, setCustomDays] = useState<string>("");

  const [sortKey, setSortKey] = useState<SortKey>("name");

  const [rows, setRows] = useState<DropRow[]>([]);
  const [loading, setLoading] = useState(false);

  // load reps
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps").then(x => x.json());
        const names: string[] = Array.isArray(r)
          ? (r as Rep[]).map(s => s.name)
          : (r?.map?.((s: Rep) => s.name) ?? []);
        setReps(names.sort((a, b) => a.localeCompare(b)));
      } catch {
        setReps([]);
      }
    })();
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams();
      qp.set("thresholdDays", String(thresholdDays));
      if (selectedReps.length) {
        selectedReps.forEach(r => qp.append("rep", r));
        qp.set("reps", selectedReps.join(","));
      }
      const res = await fetch(`/api/reports/customer-dropoff?${qp.toString()}`, { cache: "no-store" });
      const json = await res.json();
      const data: DropRow[] = Array.isArray(json?.rows) ? json.rows : [];

      const withDays = data.map(d => {
        if (typeof d.daysSince === "number") return d;
        const last = d.lastOrderAt ? new Date(d.lastOrderAt) : null;
        const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
        return { ...d, daysSince: days ?? undefined };
      });

      // Group by rep
      const grouped = new Map<string, DropRow[]>();
      for (const r of withDays) {
        const key = r.salesRep || "(Unassigned)";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r);
      }

      // sort inside each group based on sortKey
      for (const [key, list] of grouped.entries()) {
        if (sortKey === "name") {
          list.sort((a, b) => (a.salonName || "").localeCompare(b.salonName || ""));
        } else {
          list.sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1)); // desc: longest inactive first
        }
        grouped.set(key, list);
      }

      // flatten with group order stable A–Z
      const flat: DropRow[] = [];
      Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b)).forEach(k => {
        flat.push(...(grouped.get(k) || []));
      });

      setRows(flat);
    } catch (e) {
      console.error("Drop-off fetch failed", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // first load + refetch on filter/sort changes
  useEffect(() => { fetchReport(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { fetchReport(); /* eslint-disable-next-line */ }, [thresholdDays, JSON.stringify(selectedReps), sortKey]);

  const setQuick = (days: number) => {
    setThresholdDays(days);
    setCustomDays("");
  };

  const applyCustom = () => {
    const n = Number(customDays);
    if (Number.isFinite(n) && n > 0) setThresholdDays(Math.floor(n));
  };

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "Never";
    return d.toLocaleDateString();
  };

  // Build grouped view for render (rep → rows)
  const groups = useMemo(() => {
    const m = new Map<string, DropRow[]>();
    for (const r of rows) {
      const k = r.salesRep || "(Unassigned)";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Customer Drop-off</h1>
        <p className="small">Customers who haven’t ordered in the selected period. Filter by Sales Rep.</p>
      </section>

      {/* Filters */}
      <section className="card grid" style={{ gap: 12, overflow: "visible" }}>
        <div className="grid grid-4" style={{ gap: 12 }}>
          <MultiSelect
            label="Sales Reps"
            options={reps}
            selected={selectedReps}
            onChange={setSelectedReps}
            placeholder="Filter reps…"
          />

          <div className="field">
            <label>Quick range</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={thresholdDays === 7  ? "primary" : ""} onClick={() => setQuick(7)}>1 week</button>
              <button type="button" className={thresholdDays === 14 ? "primary" : ""} onClick={() => setQuick(14)}>2 weeks</button>
              <button type="button" className={thresholdDays === 21 ? "primary" : ""} onClick={() => setQuick(21)}>3 weeks</button>
              <button type="button" className={thresholdDays === 28 ? "primary" : ""} onClick={() => setQuick(28)}>4 weeks</button>
            </div>
          </div>

          <div className="field">
            <label>Custom (days)</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                value={customDays}
                onChange={e => setCustomDays(e.target.value)}
                placeholder="e.g. 45"
                inputMode="numeric"
                style={{ maxWidth: 120 }}
              />
              <button type="button" onClick={applyCustom}>Apply</button>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Current threshold: <b>{thresholdDays}</b> days
            </div>
          </div>

          <div className="field">
            <label>Sort by</label>
            <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
              <option value="name">Name (A–Z)</option>
              <option value="days">Last order days (desc)</option>
            </select>
          </div>
        </div>

        <div className="right">
          <button className="primary" type="button" onClick={fetchReport} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {/* Results */}
      <section className="card">
        {loading && <div className="small muted">Loading…</div>}
        {!loading && groups.length === 0 && (
          <div className="small muted">No customers found for this filter.</div>
        )}

        {!loading && groups.length > 0 && (
          <div className="grid" style={{ gap: 16 }}>
            {groups.map(([rep, list]) => (
              <div key={rep} className="card" style={{ border: "1px solid var(--border)" }}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                  <h3>{rep}</h3>
                  <div className="small muted">{list.length} customer{list.length === 1 ? "" : "s"}</div>
                </div>

                <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8 }}>
                  {list.map((r) => (
                    <div
                      key={r.customerId}
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        borderBottom: "1px solid var(--border)",
                        padding: "8px 0",
                      }}
                    >
                      <div style={{ minWidth: 240 }}>{r.salonName}</div>
                      <div className="small muted" style={{ minWidth: 120, textAlign: "right" }}>
                        Last order: {fmtDate(r.lastOrderAt)}
                      </div>
                      <div className="small" style={{ minWidth: 130, textAlign: "right" }}>
                        {typeof r.daysSince === "number" ? `${r.daysSince} days` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
