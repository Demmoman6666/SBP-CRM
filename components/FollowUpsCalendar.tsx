// components/FollowUpsCalendar.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };

type EventItem = {
  id: string;
  at: string; // ISO date string
  staff: string | null;
  summary: string | null;
  customerId: string | null;
  customerLabel: string;
  isLead: boolean;
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function nextMonthStart(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }
function ukTime(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
}
function ukLongDate(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function FollowUpsCalendar({ reps }: { reps: Rep[] }) {
  // View
  const [viewDate, setViewDate] = useState(() => monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Data
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);

  // Filters
  const [selectedReps, setSelectedReps] = useState<string[]>([]); // by name (CallLog.staff matches names)

  const from = useMemo(() => ymd(viewDate), [viewDate]);
  const to = useMemo(() => ymd(nextMonthStart(viewDate)), [viewDate]);

  // Group by YYYY-MM-DD (UK tz)
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const key = new Date(e.at).toLocaleDateString("en-CA", {
        timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    }
    return map;
  }, [events]);

  // Fetch data when month or reps filter changes
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from, to });
        if (selectedReps.length) params.set("reps", selectedReps.join(","));
        const r = await fetch(`/api/followups?${params.toString()}`, { cache: "no-store" });
        setEvents(r.ok ? await r.json() : []);
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to, selectedReps]);

  // Build calendar grid (Mon start)
  const grid = useMemo(() => {
    const ms = viewDate;
    const last = new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    const firstDowSun0 = ms.getDay(); // 0=Sun..6=Sat
    const firstDowMon0 = (firstDowSun0 + 6) % 7; // 0=Mon..6=Sun

    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = firstDowMon0 - 1; i >= 0; i--) {
      cells.push({ date: new Date(ms.getFullYear(), ms.getMonth(), -i), inMonth: false });
    }
    for (let d = 1; d <= last; d++) {
      cells.push({ date: new Date(ms.getFullYear(), ms.getMonth(), d), inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const lastCell = cells[cells.length - 1].date;
      cells.push({ date: new Date(lastCell.getFullYear(), lastCell.getMonth(), lastCell.getDate() + 1), inMonth: false });
    }
    return cells;
  }, [viewDate]);

  function prevMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)); setSelectedDay(null); }
  function nextMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)); setSelectedDay(null); }
  function today()     { const t = monthStart(new Date()); setViewDate(t); setSelectedDay(ymd(new Date())); }

  function toggleRep(repName: string) {
    setSelectedReps(prev => prev.includes(repName) ? prev.filter(n => n !== repName) : [...prev, repName]);
  }

  // ---- Styles (inline to match your system) ----
  const dayCardBase: React.CSSProperties = {
    padding: 10,
    textAlign: "left",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "#fff",
    minHeight: 84,
    transition: "background 120ms ease, border 120ms ease, box-shadow 120ms ease",
  };

  return (
    <section className="card" style={{ borderRadius: 14 }}>
      {/* Header */}
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          background: "linear-gradient(180deg, #fafafa, #fff)",
          borderRadius: 12,
          padding: 10,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>{viewDate.toLocaleString("en-GB", { month: "long", year: "numeric" })}</h2>
          <div className="small muted">{loading ? "Loading…" : `${events.length} follow-ups (Appointment booked)`}</div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={today}>Today</button>
          <button className="btn" onClick={prevMonth}>‹ Prev</button>
          <button className="btn" onClick={nextMonth}>Next ›</button>
        </div>
      </div>

      {/* Rep filter */}
      <div className="card" style={{ marginTop: 12, padding: 10, borderRadius: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <b>Filter by Sales Rep</b>
          <button
            className="btn small"
            onClick={() => setSelectedReps([])}
            disabled={selectedReps.length === 0}
          >
            Clear
          </button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {reps.length === 0 && <span className="small muted">No reps</span>}
          {reps.map((r) => {
            const active = selectedReps.includes(r.name);
            return (
              <button
                key={r.id}
                className="small"
                onClick={() => toggleRep(r.name)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "6px 10px",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "inherit",
                  cursor: "pointer",
                }}
              >
                {r.name}
              </button>
            );
          })}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Showing follow-ups where Outcome is <b>Appointment booked</b>.
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid" style={{ marginTop: 10, gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {DOW.map((d) => (
          <div key={d} className="small" style={{ textAlign: "center", color: "var(--muted)" }}>{d}</div>
        ))}

        {/* Calendar grid */}
        {grid.map(({ date, inMonth }, i) => {
          const key = date.toLocaleDateString("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
          const dayEvents = eventsByDay.get(key) || [];
          const isToday = ymd(new Date()) === ymd(date);
          const isSelected = selectedDay === key;

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(isSelected ? null : key)}
              style={{
                ...dayCardBase,
                background: inMonth ? "#fff" : "#fbfbfb",
                border: isSelected ? "2px solid #111" : "1px solid var(--border)",
                boxShadow: isToday ? "0 0 0 2px #e2e8f0 inset" : undefined,
                cursor: "pointer",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <b className="small">{date.getDate()}</b>
                {dayEvents.length > 0 && (
                  <span className="badge">{dayEvents.length}</span>
                )}
              </div>

              {/* Event chips (max 3) */}
              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                {dayEvents.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    className="small"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      border: "1px solid #e5e7eb",
                      background: "#f8fafc",
                      color: "#0f172a",
                      padding: "3px 6px",
                      borderRadius: 999,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${ukTime(e.at)} • ${e.customerLabel}${e.staff ? ` • ${e.staff}` : ""}`}
                  >
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{ukTime(e.at)}</span>
                    <span>• {e.customerLabel}</span>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="small muted">+{dayEvents.length - 3} more…</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Day drawer */}
      {selectedDay && (
        <div className="card" style={{ marginTop: 12, borderRadius: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>{ukLongDate(selectedDay)}</h3>
            <span className="small muted">{(eventsByDay.get(selectedDay) || []).length} follow-up(s)</span>
          </div>

          {(eventsByDay.get(selectedDay) || []).length === 0 ? (
            <p className="small">No follow-ups.</p>
          ) : (
            <div className="grid" style={{ gap: 10, marginTop: 10 }}>
              {(eventsByDay.get(selectedDay) || []).map((e) => (
                <div
                  key={e.id}
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div>
                    <div className="small" style={{ color: "var(--muted)" }}>
                      {ukTime(e.at)}{e.staff ? ` • ${e.staff}` : ""}
                    </div>
                    <div><b>{e.customerLabel}</b></div>
                    <div className="small">{e.summary || "-"}</div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {e.customerId && (
                      <Link href={`/customers/${e.customerId}`} className="btn small">Customer</Link>
                    )}
                    <Link href={`/calls/${e.id}`} className="btn small">Call</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
