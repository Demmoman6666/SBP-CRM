// components/FollowUpsCalendar.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
function ukDateTime(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function ukTime(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function FollowUpsCalendar() {
  const [viewDate, setViewDate] = useState(() => monthStart(new Date())); // first of month
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);

  const from = useMemo(() => ymd(viewDate), [viewDate]);
  const to = useMemo(() => ymd(nextMonthStart(viewDate)), [viewDate]);

  // group events by YYYY-MM-DD (Europe/London)
  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const dUK = new Date(e.at).toLocaleDateString("en-CA", { // en-CA gives YYYY-MM-DD
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      if (!map.has(dUK)) map.set(dUK, []);
      map.get(dUK)!.push(e);
    }
    // sort within a day by time
    for (const [, arr] of map) {
      arr.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    }
    return map;
  }, [events]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/followups?from=${from}&to=${to}`, { cache: "no-store" });
        setEvents(r.ok ? await r.json() : []);
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  // Build calendar grid (Mon start)
  const grid = useMemo(() => {
    const ms = viewDate; // first day of month
    const last = new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    const firstDowSun0 = ms.getDay(); // 0=Sun..6=Sat
    const firstDowMon0 = (firstDowSun0 + 6) % 7; // 0=Mon..6=Sun

    const cells: { date: Date; inMonth: boolean }[] = [];
    // days from previous month
    for (let i = firstDowMon0 - 1; i >= 0; i--) {
      cells.push({ date: new Date(ms.getFullYear(), ms.getMonth(), -i), inMonth: false });
    }
    // current month
    for (let d = 1; d <= last; d++) {
      cells.push({ date: new Date(ms.getFullYear(), ms.getMonth(), d), inMonth: true });
    }
    // trailing to complete weeks
    while (cells.length % 7 !== 0) {
      const lastCell = cells[cells.length - 1].date;
      cells.push({ date: new Date(lastCell.getFullYear(), lastCell.getMonth(), lastCell.getDate() + 1), inMonth: false });
    }
    return cells;
  }, [viewDate]);

  function prevMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)); setSelectedDay(null); }
  function nextMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)); setSelectedDay(null); }
  function today()     { const t = monthStart(new Date()); setViewDate(t); setSelectedDay(ymd(new Date())); }

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>
            {viewDate.toLocaleString("en-GB", { month: "long", year: "numeric" })}
          </h2>
          <span className="small muted">{loading ? "Loading…" : `${events.length} follow-ups`}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={today}>Today</button>
          <button className="btn" onClick={prevMonth}>‹ Prev</button>
          <button className="btn" onClick={nextMonth}>Next ›</button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid" style={{ marginTop: 12, gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {DOW.map((d) => (
          <div key={d} className="small" style={{ textAlign: "center", color: "var(--muted)" }}>{d}</div>
        ))}

        {grid.map(({ date, inMonth }, i) => {
          const key = date.toLocaleDateString("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
          const dayEvents = eventsByDay.get(key) || [];
          const isSelected = selectedDay === key;
          return (
            <button
              key={i}
              className="card"
              onClick={() => setSelectedDay(isSelected ? null : key)}
              style={{
                padding: 8,
                textAlign: "left",
                border: isSelected ? "2px solid #111" : "1px solid var(--border)",
                background: inMonth ? "#fff" : "#fafafa",
                cursor: "pointer",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <b className="small">{date.getDate()}</b>
                {dayEvents.length > 0 && (
                  <span className="badge">{dayEvents.length}</span>
                )}
              </div>
              {/* Peek first two */}
              {dayEvents.slice(0, 2).map((e) => (
                <div key={e.id} className="small" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ukTime(e.at)} • {e.customerLabel}
                </div>
              ))}
              {dayEvents.length > 2 && (
                <div className="small muted" style={{ marginTop: 4 }}>+{dayEvents.length - 2} more…</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Day details */}
      {selectedDay && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>
              {new Date(selectedDay).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </h3>
            <span className="small muted">{(eventsByDay.get(selectedDay) || []).length} follow-up(s)</span>
          </div>

          {(eventsByDay.get(selectedDay) || []).length === 0 ? (
            <p className="small">No follow-ups.</p>
          ) : (
            <div className="grid" style={{ gap: 8, marginTop: 8 }}>
              {(eventsByDay.get(selectedDay) || []).map((e) => (
                <div key={e.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                  <div>
                    <div className="small" style={{ color: "var(--muted)" }}>{ukDateTime(e.at)}{e.staff ? ` • ${e.staff}` : ""}</div>
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
