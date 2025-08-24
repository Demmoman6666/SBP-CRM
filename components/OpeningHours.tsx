// components/OpeningHours.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
type DayState = { open: boolean; from: string; to: string };

const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function makeBlank(): Record<Day, DayState> {
  return DAYS.reduce((acc, d) => {
    (acc as any)[d] = { open: false, from: "", to: "" };
    return acc;
  }, {} as Record<Day, DayState>);
}

function parseInitial(json?: string | null): Record<Day, DayState> {
  const blank = makeBlank();
  if (!json) return blank;
  try {
    const parsed = JSON.parse(json);
    for (const d of DAYS) {
      const src = (parsed && parsed[d]) || {};
      blank[d] = {
        open: !!src.open,
        from: typeof src.from === "string" ? src.from : "",
        to: typeof src.to === "string" ? src.to : "",
      };
    }
  } catch {
    // fall back to blank
  }
  return blank;
}

export default function OpeningHours({
  name = "openingHours",
  defaultValue,
  label = "Opening Hours",
}: {
  name?: string;
  defaultValue?: string | null;
  label?: string;
}) {
  const [state, setState] = useState<Record<Day, DayState>>(
    () => parseInitial(defaultValue)
  );

  useEffect(() => {
    setState(parseInitial(defaultValue));
  }, [defaultValue]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  // 5-minute increments
  const minutes = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 5), []);

  const set = (day: Day, patch: Partial<DayState>) =>
    setState((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));

  const json = JSON.stringify(state);

  return (
    <div>
      <label>{label}</label>
      {/* send as hidden JSON string */}
      <input type="hidden" name={name} value={json} />

      <div
        className="card"
        style={{
          padding: 12,
          marginTop: 6,
        }}
      >
        <div className="grid" style={{ gap: 8 }}>
          {DAYS.map((d) => {
            const v = state[d];
            return (
              <div
                key={d}
                className="row"
                style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}
              >
                <label className="row" style={{ gap: 8, width: 64 }}>
                  <input
                    type="checkbox"
                    checked={v.open}
                    onChange={(e) => set(d, { open: e.target.checked })}
                  />
                  <span className="small">{d}</span>
                </label>

                <span className="small" style={{ width: 36, color: "var(--muted)" }}>
                  Open
                </span>
                <TimeSelect
                  disabled={!v.open}
                  value={v.from}
                  onChange={(val) => set(d, { from: val })}
                  hours={hours}
                  minutes={minutes}
                />

                <span className="small" style={{ width: 44, color: "var(--muted)" }}>
                  Close
                </span>
                <TimeSelect
                  disabled={!v.open}
                  value={v.to}
                  onChange={(val) => set(d, { to: val })}
                  hours={hours}
                  minutes={minutes}
                />
              </div>
            );
          })}
        </div>
        <p className="form-hint" style={{ marginTop: 8 }}>
          Tick a day to enter opening and closing times. Minutes advance in 5-minute steps.
        </p>
      </div>
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
  disabled,
  hours,
  minutes,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hours: number[];
  minutes: number[];
}) {
  const [hh, mm] = (value || "").split(":");
  const setHH = (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange(`${e.target.value || ""}:${mm || ""}`);
  const setMM = (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange(`${hh || ""}:${e.target.value || ""}`);

  return (
    <div className="row" style={{ gap: 6 }}>
      <select disabled={disabled} value={hh || ""} onChange={setHH} style={{ width: 74 }}>
        <option value="">— —</option>
        {hours.map((h) => {
          const v = String(h).padStart(2, "0");
          return (
            <option key={v} value={v}>
              {v}
            </option>
          );
        })}
      </select>
      <span>:</span>
      <select disabled={disabled} value={mm || ""} onChange={setMM} style={{ width: 74 }}>
        <option value="">— —</option>
        {minutes.map((m) => {
          const v = String(m).padStart(2, "0");
          return (
            <option key={v} value={v}>
              {v}
            </option>
          );
        })}
      </select>
    </div>
  );
}
