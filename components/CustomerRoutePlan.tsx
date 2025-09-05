"use client";

import { useState } from "react";

type Props = {
  customerId: string;
  initialEnabled: boolean;
  initialWeeks: number[];
  initialDays: ("MONDAY"|"TUESDAY"|"WEDNESDAY"|"THURSDAY"|"FRIDAY")[];
};

const DAY_LABELS = [
  ["MONDAY","Monday"],
  ["TUESDAY","Tuesday"],
  ["WEDNESDAY","Wednesday"],
  ["THURSDAY","Thursday"],
  ["FRIDAY","Friday"],
] as const;

export default function CustomerRoutePlan({
  customerId,
  initialEnabled,
  initialWeeks,
  initialDays,
}: Props) {
  const [enabled, setEnabled] = useState<boolean>(!!initialEnabled);
  const [weeks, setWeeks] = useState<Set<number>>(new Set(initialWeeks));
  const [days, setDays] = useState<Set<string>>(new Set(initialDays));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function toggleWeek(n: number) {
    const next = new Set(weeks);
    next.has(n) ? next.delete(n) : next.add(n);
    setWeeks(next);
  }
  function toggleDay(d: string) {
    const next = new Set(days);
    next.has(d) ? next.delete(d) : next.add(d);
    setDays(next);
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/customers/${customerId}/route-plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          weeks: Array.from(weeks).sort((a,b) => a-b),
          days: Array.from(days),
        }),
      });
      if (!r.ok) throw new Error("Save failed");
      setSavedAt(Date.now());
    } catch (e) {
      alert("Could not save route plan. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Route Planning</h2>

      <div className="field">
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Add To Route Plan</span>
        </label>
        <div className="form-hint">
          Include this salon in the 4-week Mon–Fri cycle.
        </div>
      </div>

      {enabled && (
        <div className="grid" style={{ gap: 16, gridTemplateColumns: "1fr 2fr" }}>
          {/* Weeks */}
          <div className="field">
            <label>Weeks</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {[1,2,3,4].map(n => (
                <label key={n} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, padding: "6px 10px", cursor: "pointer",
                  background: weeks.has(n) ? "#111" : "#fff",
                  color: weeks.has(n) ? "#fff" : "inherit",
                }}>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={weeks.has(n)}
                    onChange={() => toggleWeek(n)}
                  />
                  Week {n}
                </label>
              ))}
            </div>
            <div className="form-hint">Pick one or more of the 4 weeks.</div>
          </div>

          {/* Days */}
          <div className="field">
            <label>Days</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {DAY_LABELS.map(([val, label]) => (
                <label key={val} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, padding: "6px 10px", cursor: "pointer",
                  background: days.has(val) ? "#111" : "#fff",
                  color: days.has(val) ? "#fff" : "inherit",
                }}>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={days.has(val)}
                    onChange={() => toggleDay(val)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="form-hint">Pick one or more days (Mon–Fri).</div>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, marginTop: 16, alignItems: "center" }}>
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && <span className="small muted">Saved just now</span>}
      </div>
    </section>
  );
}
