"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };
type Customer = {
  id: string; salonName: string; customerName: string | null;
  addressLine1: string; town: string | null; postCode: string | null;
  salesRep: string | null; routeWeeks: number[]; routeDays: string[];
  customerTelephone: string | null;
};

const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];
const DAY_SHORT = ["Mon","Tue","Wed","Thu","Fri"];
const WEEKS = [1,2,3,4];

function getMondayOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function getCycleWeek(today: Date, cycleStart: Date): number {
  const monday = getMondayOfWeek(today);
  const startMonday = getMondayOfWeek(cycleStart);
  const diffMs = monday.getTime() - startMonday.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return ((diffWeeks % 4) + 4) % 4 + 1; // 1-4
}

function getTodayDay(): string {
  const d = new Date().getDay();
  return d >= 1 && d <= 5 ? DAYS[d-1] : "MONDAY";
}

function renderBrief(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <div key={i} style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: 14, marginBottom: 4, color: "var(--text)" }}>{line.slice(3)}</div>;
    if (line.startsWith("- ") || line.startsWith("• ")) return <div key={i} style={{ paddingLeft: 14, marginBottom: 3, fontSize: "0.82rem", lineHeight: 1.5, color: "var(--text-2)" }}>• {line.slice(2)}</div>;
    if (line.trim() === "") return <div key={i} style={{ height: 4 }} />;
    return <div key={i} style={{ fontSize: "0.82rem", lineHeight: 1.5, color: "var(--text-2)", marginBottom: 2 }}>{line}</div>;
  });
}

export default function RoutePlanPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedRepId, setSelectedRepId] = useState("");
  const [selectedRepName, setSelectedRepName] = useState("");
  const [cycleStart, setCycleStart] = useState<string | null>(null);
  const [cycleStartInput, setCycleStartInput] = useState("");
  const [savingCycle, setSavingCycle] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedDay, setSelectedDay] = useState(getTodayDay());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [briefCustomerId, setBriefCustomerId] = useState<string | null>(null);
  const [briefText, setBriefText] = useState<string>("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefRef = useRef<HTMLDivElement>(null);

  // Load reps and cycle settings
  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json()).then(j => setReps(Array.isArray(j) ? j : [])).catch(() => {});
    fetch("/api/cycle-settings", { cache: "no-store" })
      .then(r => r.json()).then(j => {
        if (j.cycleStartDate) {
          setCycleStart(j.cycleStartDate);
          setCycleStartInput(j.cycleStartDate);
          const week = getCycleWeek(new Date(), new Date(j.cycleStartDate));
          setCurrentWeek(week);
          setSelectedWeek(week);
        }
      }).catch(() => {});
  }, []);

  // Load customers when rep/week/day changes
  useEffect(() => {
    if (!selectedRepName || !selectedWeek || !selectedDay) { setCustomers([]); return; }
    setLoading(true);
    const qs = new URLSearchParams({
      reps: selectedRepName, week: String(selectedWeek),
      day: selectedDay, onlyPlanned: "1", limit: "100",
    });
    fetch(`/api/route-planning?${qs}`, { cache: "no-store" })
      .then(r => r.json()).then(j => setCustomers(Array.isArray(j) ? j : []))
      .catch(() => setCustomers([])).finally(() => setLoading(false));
  }, [selectedRepName, selectedWeek, selectedDay]);

  async function saveCycleStart() {
    if (!cycleStartInput) return;
    setSavingCycle(true);
    try {
      const r = await fetch("/api/cycle-settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleStartDate: cycleStartInput }),
      });
      const j = await r.json();
      if (r.ok) {
        setCycleStart(j.cycleStartDate);
        const week = getCycleWeek(new Date(), new Date(j.cycleStartDate));
        setCurrentWeek(week);
        setSelectedWeek(week);
      }
    } finally { setSavingCycle(false); }
  }

  async function generateBrief(customerId: string) {
    setBriefCustomerId(customerId);
    setBriefText(""); setBriefError(null); setBriefLoading(true);
    try {
      const r = await fetch("/api/ai/precall", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setBriefText(j.brief || "");
      setTimeout(() => briefRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e: any) {
      setBriefError(e.message);
    } finally { setBriefLoading(false); }
  }

  const today = new Date();
  const todayDay = getTodayDay();
  const isToday = (week: number, day: string) => week === currentWeek && day === todayDay && cycleStart !== null;

  const selectedCustomer = customers.find(c => c.id === briefCustomerId);

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* Header */}
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>Route Plan</h1>
            <p className="small muted">
              {cycleStart
                ? `Currently in Week ${currentWeek} of the 4-week cycle`
                : "Set your cycle start date to track which week you're in"}
            </p>
          </div>
        </div>
      </section>

      {/* Cycle setup + Rep selector */}
      <section className="card" style={{ overflow: "visible" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={selectedRepId} onChange={e => {
              setSelectedRepId(e.target.value);
              setSelectedRepName(reps.find(r => r.id === e.target.value)?.name || "");
            }}>
              <option value="">— Select rep —</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Cycle start date (Week 1 Monday)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" value={cycleStartInput} onChange={e => setCycleStartInput(e.target.value)} />
              <button className="btn" onClick={saveCycleStart} disabled={savingCycle} style={{ flexShrink: 0 }}>
                {savingCycle ? "…" : "Set"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 4-week grid */}
      <section className="card">
        <h2 style={{ marginBottom: 12 }}>4-Week Cycle</h2>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 500 }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "60px repeat(5, 1fr)", gap: 4, marginBottom: 4 }}>
              <div />
              {DAY_SHORT.map(d => (
                <div key={d} style={{ textAlign: "center", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", padding: "4px 0" }}>{d}</div>
              ))}
            </div>
            {/* Week rows */}
            {WEEKS.map(week => (
              <div key={week} style={{ display: "grid", gridTemplateColumns: "60px repeat(5, 1fr)", gap: 4, marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{
                    fontSize: "0.75rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                    background: week === currentWeek && cycleStart ? "var(--pink)" : "var(--surface-2)",
                    color: week === currentWeek && cycleStart ? "#fff" : "var(--muted)",
                  }}>W{week}</span>
                </div>
                {DAYS.map((day, di) => {
                  const isTodayCell = isToday(week, day);
                  const isSelected = selectedWeek === week && selectedDay === day;
                  return (
                    <button
                      key={day}
                      onClick={() => { setSelectedWeek(week); setSelectedDay(day); }}
                      style={{
                        padding: "8px 4px", borderRadius: 8, textAlign: "center", cursor: "pointer",
                        border: isSelected ? "2px solid var(--pink)" : isTodayCell ? "2px solid var(--text)" : "1px solid var(--border)",
                        background: isSelected ? "var(--pink-light)" : isTodayCell ? "#f8fafc" : "#fff",
                        fontSize: "0.75rem", fontWeight: isTodayCell ? 700 : 400,
                        color: isSelected ? "var(--pink-dark)" : "var(--text)",
                        transition: "all 0.1s",
                      }}
                    >
                      {DAY_SHORT[di]}
                      {isTodayCell && <div style={{ fontSize: "0.6rem", color: "var(--pink-dark)", marginTop: 2 }}>Today</div>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Selected day customers */}
      {selectedRepName && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>
                Week {selectedWeek} — {DAY_SHORT[DAYS.indexOf(selectedDay)]}
                {isToday(selectedWeek, selectedDay) && (
                  <span style={{ marginLeft: 8, padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", background: "var(--pink)", color: "#fff", fontWeight: 600 }}>Today</span>
                )}
              </h2>
              <p className="small muted">{selectedRepName} · {loading ? "Loading…" : `${customers.length} stops`}</p>
            </div>
            {customers.length > 0 && (
              
                href={`https://www.google.com/maps/dir/${customers.map(c => encodeURIComponent([c.addressLine1, c.town, c.postCode].filter(Boolean).join(", "))).join("/")}`}
                target="_blank" rel="noreferrer"
                className="btn"
                style={{ fontSize: "0.8rem" }}
              >
                Open in Maps
              </a>
            )}
          </div>

          {!loading && customers.length === 0 && (
            <p className="small muted">No customers scheduled for this day. Add customers to this slot from their profile page.</p>
          )}

          {customers.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {customers.map((c, i) => (
                <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 14px", gap: 10 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--pink)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.8rem", flexShrink: 0, marginTop: 2 }}>
                        {i + 1}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 3 }}>{c.salonName}</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {c.customerName && <span className="small muted">👤 {c.customerName}</span>}
                          {c.customerTelephone && <a href={`tel:${c.customerTelephone}`} className="small muted" style={{ textDecoration: "none" }}>📞 {c.customerTelephone}</a>}
                          {(c.town || c.postCode) && <span className="small muted">📍 {[c.town, c.postCode].filter(Boolean).join(", ")}</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                      <Link href={`/customers/${c.id}`} className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }}>Profile</Link>
                      <Link href={`/calls/new?customerId=${c.id}`} className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }}>Log Call</Link>
                      <button
                        className="primary"
                        style={{ fontSize: "0.78rem", padding: "5px 10px" }}
                        onClick={() => generateBrief(c.id)}
                        disabled={briefLoading && briefCustomerId === c.id}
                      >
                        {briefLoading && briefCustomerId === c.id ? "…" : "✨ Brief"}
                      </button>
                    </div>
                  </div>

                  {/* AI Brief panel */}
                  {briefCustomerId === c.id && (briefLoading || briefText || briefError) && (
                    <div ref={briefRef} style={{ borderTop: "1px solid var(--border)", padding: "14px 14px 14px 54px", background: "#fafbfc" }}>
                      {briefLoading && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: "1.2rem" }}>✨</span>
                          <span className="small muted">Generating pre-call brief…</span>
                        </div>
                      )}
                      {briefError && <div className="small" style={{ color: "var(--red)" }}>{briefError}</div>}
                      {briefText && !briefLoading && (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: "1rem" }}>✨</span>
                              <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Pre-Call Brief</span>
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button className="btn" style={{ fontSize: "0.72rem", padding: "3px 8px", minHeight: "unset" }} onClick={() => navigator.clipboard?.writeText(briefText)}>Copy</button>
                              <button className="btn" style={{ fontSize: "0.72rem", padding: "3px 8px", minHeight: "unset" }} onClick={() => { setBriefCustomerId(null); setBriefText(""); }}>Close</button>
                            </div>
                          </div>
                          {renderBrief(briefText)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!selectedRepName && (
        <section className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontSize: "1.5rem", marginBottom: 8 }}>📋</p>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Select a sales rep to view their route plan</p>
          <p className="small muted">Then tap any day in the grid to see that day's scheduled customers</p>
        </section>
      )}
    </div>
  );
}
