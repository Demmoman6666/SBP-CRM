// components/FollowUpsCalendar.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };
type EventItem = {
  id: string;
  at: string;
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
function ukShortDate(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function ukLongDate(dt: string | Date) {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function isToday(dateStr: string) { return ymd(new Date()) === dateStr; }
function isPast(dateStr: string) { return dateStr < ymd(new Date()); }

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function FollowUpsCalendar({ reps }: { reps: Rep[] }) {
  const [viewDate, setViewDate] = useState(() => monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedReps, setSelectedReps] = useState<string[]>([]);
  const [view, setView] = useState<"agenda" | "grid">("agenda");

  const from = useMemo(() => ymd(viewDate), [viewDate]);
  const to = useMemo(() => ymd(nextMonthStart(viewDate)), [viewDate]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const key = new Date(e.at).toLocaleDateString("en-CA", {
        timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const [, arr] of map) arr.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return map;
  }, [events]);

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

  const agendaDays = useMemo(() => Array.from(eventsByDay.keys()).sort(), [eventsByDay]);

  const grid = useMemo(() => {
    const ms = viewDate;
    const last = new Date(ms.getFullYear(), ms.getMonth() + 1, 0).getDate();
    const firstDowSun0 = ms.getDay();
    const firstDowMon0 = (firstDowSun0 + 6) % 7;
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
  function goToday() { setViewDate(monthStart(new Date())); setSelectedDay(ymd(new Date())); }
  function toggleRep(name: string) {
    setSelectedReps(p => p.includes(name) ? p.filter(n => n !== name) : [...p, name]);
  }

  const monthLabel = viewDate.toLocaleString("en-GB", { month: "long", year: "numeric" });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>{monthLabel}</h2>
            <div className="small muted">{loading ? "Loading…" : `${events.length} follow-up${events.length !== 1 ? "s" : ""}`}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={goToday}>Today</button>
            <button className="btn" onClick={prevMonth}>‹ Prev</button>
            <button className="btn" onClick={nextMonth}>Next ›</button>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              <button onClick={() => setView("agenda")} style={{ padding: "8px 14px", fontSize: "0.8rem", fontWeight: 600, background: view === "agenda" ? "var(--pink)" : "#fff", color: view === "agenda" ? "#fff" : "var(--muted)", border: "none", cursor: "pointer" }}>Agenda</button>
              <button onClick={() => setView("grid")} style={{ padding: "8px 14px", fontSize: "0.8rem", fontWeight: 600, background: view === "grid" ? "var(--pink)" : "#fff", color: view === "grid" ? "#fff" : "var(--muted)", border: "none", cursor: "pointer" }}>Grid</button>
            </div>
          </div>
        </div>

        {reps.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span className="small" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" }}>Filter by Rep</span>
              {selectedReps.length > 0 && <button className="btn" style={{ fontSize: "0.75rem", padding: "3px 10px", minHeight: "unset" }} onClick={() => setSelectedReps([])}>Clear</button>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {reps.map((r) => {
                const active = selectedReps.includes(r.name);
                return (
                  <button key={r.id} onClick={() => toggleRep(r.name)} style={{ padding: "5px 12px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 600, border: "1px solid var(--border)", cursor: "pointer", background: active ? "var(--text)" : "#fff", color: active ? "#fff" : "var(--text)" }}>
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {view === "agenda" && (
        <section className="card">
          {agendaDays.length === 0 ? (
            <p className="small muted">No follow-ups this month.</p>
          ) : (
            <div style={{ display: "grid", gap: 0 }}>
              {agendaDays.map((day, di) => {
                const dayEvents = eventsByDay.get(day) || [];
                const today = isToday(day);
                const past = isPast(day);
                return (
                  <div key={day} style={{ borderBottom: di < agendaDays.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div style={{ padding: "10px 0 6px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: today ? "var(--pink)" : past ? "var(--surface-2)" : "#fff", border: today ? "none" : "1px solid var(--border)", fontWeight: 700, color: today ? "#fff" : past ? "var(--muted)" : "var(--text)", fontSize: "0.9rem" }}>
                        {new Date(day + "T12:00:00").getDate()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.9rem", color: today ? "var(--pink-dark)" : past ? "var(--muted)" : "var(--text)" }}>{ukShortDate(day + "T12:00:00")}</div>
                        <div className="small muted">{dayEvents.length} follow-up{dayEvents.length !== 1 ? "s" : ""}</div>
                      </div>
                    </div>
                    <div style={{ paddingLeft: 50, paddingBottom: 12, display: "grid", gap: 8 }}>
                      {dayEvents.map((e) => (
                        <div key={e.id} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
                              <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>{ukTime(e.at)}</span>
                              {e.staff && <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: "0.7rem", background: "var(--pink-light)", color: "var(--pink-dark)", fontWeight: 600 }}>{e.staff}</span>}
                            </div>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{e.customerLabel}</div>
                            {e.summary && <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{e.summary}</div>}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                            {e.customerId && <Link href={`/customers/${e.customerId}`} className="btn" style={{ fontSize: "0.75rem", padding: "4px 10px", minHeight: "unset" }}>Customer</Link>}
                            <Link href={`/calls/${e.id}`} className="btn" style={{ fontSize: "0.75rem", padding: "4px 10px", minHeight: "unset" }}>Call</Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {view === "grid" && (
        <section className="card" style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 560 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
              {DOW.map((d) => (
                <div key={d} className="small" style={{ textAlign: "center", color: "var(--muted)", fontWeight: 700, padding: "4px 0", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.04em" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
              {grid.map(({ date, inMonth }, i) => {
                const key = date.toLocaleDateString("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
                const dayEvents = eventsByDay.get(key) || [];
                const today = isToday(key);
                const isSelected = selectedDay === key;
                return (
                  <button key={i} onClick={() => setSelectedDay(isSelected ? null : key)} style={{ padding: 8, textAlign: "left", borderRadius: 10, border: isSelected ? "2px solid var(--text)" : today ? "2px solid var(--pink)" : "1px solid var(--border)", background: inMonth ? "#fff" : "#fafafa", minHeight: 72, cursor: "pointer", opacity: inMonth ? 1 : 0.4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: today ? 700 : 500, fontSize: "0.85rem", color: today ? "var(--pink-dark)" : "var(--text)" }}>{date.getDate()}</span>
                      {dayEvents.length > 0 && <span style={{ background: "var(--pink)", color: "#fff", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, padding: "1px 6px" }}>{dayEvents.length}</span>}
                    </div>
                    <div style={{ display: "grid", gap: 2 }}>
                      {dayEvents.slice(0, 2).map((e) => (
                        <div key={e.id} style={{ fontSize: "0.65rem", background: "var(--pink-light)", color: "var(--pink-dark)", borderRadius: 4, padding: "2px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
                          {ukTime(e.at)} {e.customerLabel}
                        </div>
                      ))}
                      {dayEvents.length > 2 && <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>+{dayEvents.length - 2} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          {selectedDay && (
            <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>{ukLongDate(selectedDay + "T12:00:00")}</h3>
                <span className="small muted">{(eventsByDay.get(selectedDay) || []).length} follow-up(s)</span>
              </div>
              {(eventsByDay.get(selectedDay) || []).length === 0 ? <p className="small muted">No follow-ups.</p> : (
                <div style={{ display: "grid", gap: 8 }}>
                  {(eventsByDay.get(selectedDay) || []).map((e) => (
                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)", gap: 8 }}>
                      <div>
                        <div className="small muted">{ukTime(e.at)}{e.staff ? ` • ${e.staff}` : ""}</div>
                        <div style={{ fontWeight: 600 }}>{e.customerLabel}</div>
                        {e.summary && <div className="small muted">{e.summary}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {e.customerId && <Link href={`/customers/${e.customerId}`} className="btn" style={{ fontSize: "0.75rem" }}>Customer</Link>}
                        <Link href={`/calls/${e.id}`} className="btn" style={{ fontSize: "0.75rem" }}>Call</Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
