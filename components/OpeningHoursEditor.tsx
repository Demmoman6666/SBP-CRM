"use client";

import { useMemo, useState } from "react";

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type DayState = {
  enabled: boolean;
  openH: string;
  openM: string;
  closeH: string;
  closeM: string;
};

const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL: Record<DayKey, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
const H24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const M05 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

const makeDefaultDay = (): DayState => ({
  enabled: false,
  openH: "09",
  openM: "00",
  closeH: "17",
  closeM: "00",
});

function parseOpeningHoursJSON(initialJSON: string | undefined) {
  try {
    return initialJSON ? JSON.parse(initialJSON) : null;
  } catch {
    return null;
  }
}

export default function OpeningHoursEditor({ initialJSON }: { initialJSON?: string }) {
  const seed = parseOpeningHoursJSON(initialJSON);

  const seededDays = () => {
    const obj: Record<DayKey, DayState> = Object.fromEntries(
      DAYS.map(d => [d, makeDefaultDay()])
    ) as Record<DayKey, DayState>;

    if (seed && typeof seed === "object") {
      for (const d of DAYS) {
        const s = (seed as any)[d];
        if (s && s.open === true && typeof s.from === "string" && typeof s.to === "string") {
          const [oh, om] = String(s.from).split(":");
          const [ch, cm] = String(s.to).split(":");
          obj[d] = {
            enabled: true,
            openH: String(oh ?? "09").padStart(2, "0"),
            openM: String(om ?? "00").padStart(2, "0"),
            closeH: String(ch ?? "17").padStart(2, "0"),
            closeM: String(cm ?? "00").padStart(2, "0"),
          };
        }
      }
    }
    return obj;
  };

  const [oh, setOh] = useState<Record<DayKey, DayState>>(seededDays);

  const openingHoursJSON = useMemo(() => {
    const obj: Record<DayKey, any> = {} as any;
    for (const d of DAYS) {
      const s = oh[d];
      obj[d] = s.enabled
        ? { open: true, from: s.openH + ":" + s.openM, to: s.closeH + ":" + s.closeM }
        : { open: false };
    }
    return JSON.stringify(obj);
  }, [oh]);

  function updateDay<K extends keyof DayState>(day: DayKey, key: K, val: DayState[K]) {
    setOh(prev => ({ ...prev, [day]: { ...prev[day], [key]: val } }));
  }

  function applyToAll(day: DayKey) {
    const source = oh[day];
    setOh(prev => {
      const next = { ...prev };
      for (const d of DAYS) next[d] = { ...source };
      return next;
    });
  }

  return (
    <div>
      <input type="hidden" name="openingHours" value={openingHoursJSON} />

      <div style={{ display: "grid", gap: 6 }}>
        {DAYS.map(day => {
          const s = oh[day];
          return (
            <div
              key={day}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                background: s.enabled ? "var(--pink-light)" : "var(--surface-2)",
                border: "1px solid " + (s.enabled ? "var(--pink)" : "var(--border)"),
                transition: "all 0.15s ease",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: 0 }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={e => updateDay(day, "enabled", e.target.checked)}
                />
                <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text)", textTransform: "none", letterSpacing: 0 }}>
                  {day}
                </span>
              </label>

              {s.enabled ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <select
                      aria-label={day + " open hour"}
                      value={s.openH}
                      onChange={e => updateDay(day, "openH", e.target.value)}
                      style={{ height: 34, minWidth: 64, padding: "4px 24px 4px 10px", fontSize: "0.8rem" }}
                    >
                      {H24.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className="small muted">:</span>
                    <select
                      aria-label={day + " open minutes"}
                      value={s.openM}
                      onChange={e => updateDay(day, "openM", e.target.value)}
                      style={{ height: 34, minWidth: 60, padding: "4px 24px 4px 10px", fontSize: "0.8rem" }}
                    >
                      {M05.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <span className="small muted">to</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <select
                      aria-label={day + " close hour"}
                      value={s.closeH}
                      onChange={e => updateDay(day, "closeH", e.target.value)}
                      style={{ height: 34, minWidth: 64, padding: "4px 24px 4px 10px", fontSize: "0.8rem" }}
                    >
                      {H24.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className="small muted">:</span>
                    <select
                      aria-label={day + " close minutes"}
                      value={s.closeM}
                      onChange={e => updateDay(day, "closeM", e.target.value)}
                      style={{ height: 34, minWidth: 60, padding: "4px 24px 4px 10px", fontSize: "0.8rem" }}
                    >
                      {M05.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyToAll(day)}
                    className="small"
                    style={{ background: "none", border: "none", color: "var(--pink-dark)", textDecoration: "underline", cursor: "pointer", padding: 0, minHeight: "auto", fontWeight: 600 }}
                  >
                    Apply to all days
                  </button>
                </div>
              ) : (
                <span className="small muted">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-hint" style={{ marginTop: 8 }}>
        Tick a day to set its hours. Minutes step in increments of 5.
      </div>
    </div>
  );
}
