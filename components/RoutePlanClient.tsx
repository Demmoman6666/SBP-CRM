// components/RoutePlanClient.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };

type Customer = {
  id: string;
  salonName: string;
  customerName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  country: string | null;
  customerNumber: string | null;
  customerEmailAddress: string | null;
  salesRep: string | null;
};

const DAYS = [
  { val: "MONDAY", label: "Monday" },
  { val: "TUESDAY", label: "Tuesday" },
  { val: "WEDNESDAY", label: "Wednesday" },
  { val: "THURSDAY", label: "Thursday" },
  { val: "FRIDAY", label: "Friday" },
] as const;

export default function RoutePlanClient({ reps }: { reps: Rep[] }) {
  const [rep, setRep] = useState<string>("");
  const [week, setWeek] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (rep) p.set("reps", rep); // comma-list; single rep is fine
    if (week) p.set("week", week);
    if (day) p.set("day", day);
    p.set("onlyPlanned", "1");
    p.set("limit", "1000");
    return p.toString();
  }, [rep, week, day]);

  useEffect(() => {
    if (!rep || !week || !day) {
      setRows([]);
      return;
    }
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;

    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/route-planning?${qs}`, { cache: "no-store", signal: ac.signal });
        setRows(r.ok ? await r.json() : []);
      } catch (e: any) {
        if (e?.name !== "AbortError") setRows([]);
      } finally {
        if (acRef.current === ac) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [qs, rep, week, day]);

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Filters</h2>

      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {/* Sales Rep */}
        <div className="field" style={{ minWidth: 260 }}>
          <label>Sales Rep</label>
          <select
            value={rep}
            onChange={(e) => {
              setRep(e.target.value);
              setWeek("");
              setDay("");
            }}
          >
            <option value="">— Select a rep —</option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Week */}
        <div className="field" style={{ minWidth: 160 }}>
          <label>Week</label>
          <select
            value={week}
            onChange={(e) => {
              setWeek(e.target.value);
              setDay("");
            }}
            disabled={!rep}
          >
            <option value="">— Select week —</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={String(n)}>
                Week {n}
              </option>
            ))}
          </select>
        </div>

        {/* Day */}
        <div className="field" style={{ minWidth: 180 }}>
          <label>Day</label>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            disabled={!rep || !week}
          >
            <option value="">— Select day —</option>
            {DAYS.map((d) => (
              <option key={d.val} value={d.val}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Day’s Route</h3>
          <div className="small muted">
            {rep && week && day
              ? loading
                ? "Loading…"
                : `${rows.length} salon${rows.length === 1 ? "" : "s"}`
              : "Select rep, week, and day to view"}
          </div>
        </div>

        {!rep || !week || !day ? (
          <p className="small" style={{ marginTop: 12 }}>Awaiting selections…</p>
        ) : !rows.length ? (
          <p className="small" style={{ marginTop: 12 }}>
            {loading ? "Loading…" : "No matches found."}
          </p>
        ) : (
          <div className="table" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Salon</th>
                  <th>Contact</th>
                  <th>Town</th>
                  <th>Postcode</th>
                  <th>Sales Rep</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small" style={{ maxWidth: 260, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
                      {r.salonName}
                      <div className="small" style={{ color: "var(--muted)" }}>
                        {r.addressLine1}
                        {r.addressLine2 ? `, ${r.addressLine2}` : ""}
                        {r.town ? `, ${r.town}` : ""}
                        {r.county ? `, ${r.county}` : ""}
                        {r.postCode ? `, ${r.postCode}` : ""}
                        {r.country ? `, ${r.country}` : ""}
                      </div>
                    </td>
                    <td className="small">{r.customerName || "—"}</td>
                    <td className="small">{r.town || "—"}</td>
                    <td className="small">{r.postCode || "—"}</td>
                    <td className="small">{r.salesRep || "—"}</td>
                    <td className="small right">
                      <Link href={`/customers/${r.id}`} className="btn small">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
