"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Rep = { id: string; name: string };
type Customer = {
  id: string;
  salonName: string;
  customerName: string | null;
  addressLine1: string;
  town: string | null;
  postCode: string | null;
  salesRep: string | null;
  routeWeeks: number[];
  routeDays: string[];
  customerTelephone: string | null;
};

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WEEKS = [1, 2, 3, 4];

function getMondayOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getCycleWeek(today: Date, cycleStart: Date): number {
  const monday = getMondayOfWeek(today);
  const startMonday = getMondayOfWeek(cycleStart);
  const diffMs = monday.getTime() - startMonday.getTime();
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  return ((diffWeeks % 4) + 4) % 4 + 1;
}

function getTodayDay(): string {
  const d = new Date().getDay();
  return d >= 1 && d <= 5 ? DAYS[d - 1] : "MONDAY";
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
  const [briefText, setBriefText] = useState("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const briefRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then(r => r.json())
      .then(j => setReps(Array.isArray(j) ? j : []))
      .catch(() => {});
    fetch("/api/cycle-settings", { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        if (j.cycleStartDate) {
          setCycleStart(j.cycleStartDate);
          setCycleStartInput(j.cycleStartDate);
          const week = getCycleWeek(new Date(), new Date(j.cycleStartDate));
          setCurrentWeek(week);
          setSelectedWeek(week);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRepName || !selectedWeek || !selectedDay) {
      setCustomers([]);
      return;
    }
    setLoading(true);
    const qs = new URLSearchParams({
      reps: selectedRepName,
      week: String(selectedWeek),
      day: selectedDay,
      onlyPlanned: "1",
      limit: "100",
    });
    fetch("/api/route-planning?" + qs.toString(), { cache: "no-store" })
      .then(r => r.json())
      .then(j => setCustomers(Array.isArray(j) ? j : []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [selectedRepName, selectedWeek, selectedDay]);

  function handleRepChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedRepId(e.target.value);
    setSelectedRepName(reps.find(r => r.id === e.target.value)?.name || "");
  }

  function handleDayClick(week: number, day: string) {
    setSelectedWeek(week);
    setSelectedDay(day);
  }

  function handleCopyBrief() {
    if (navigator.clipboard) navigator.clipboard.writeText(briefText);
  }

  function handleCloseBrief() {
    setBriefCustomerId(null);
    setBriefText("");
  }

  function handleSaveCycle() {
    if (!cycleStartInput) return;
    setSavingCycle(true);
    fetch("/api/cycle-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cycleStartDate: cycleStartInput }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.cycleStartDate) {
          setCycleStart(j.cycleStartDate);
          const week = getCycleWeek(new Date(), new Date(j.cycleStartDate));
          setCurrentWeek(week);
          setSelectedWeek(week);
        }
      })
      .catch(() => {})
      .finally(() => setSavingCycle(false));
  }

  function handleGenerateBrief(customerId: string) {
    setBriefCustomerId(customerId);
    setBriefText("");
    setBriefError(null);
    setBriefLoading(true);
    fetch("/api/ai/precall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    })
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        setBriefText(j.brief || "");
        setTimeout(() => briefRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      })
      .catch((e: any) => setBriefError(e.message))
      .finally(() => setBriefLoading(false));
  }

  const todayDay = getTodayDay();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <h1 style={{ marginBottom: 4 }}>Route Plan</h1>
        <p className="small muted">
          {cycleStart ? "Currently in Week " + currentWeek + " of the 4-week cycle" : "Set your cycle start date below"}
        </p>
      </section>

      <section className="card">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={selectedRepId} onChange={handleRepChange}>
              <option value="">Select rep</option>
              {reps.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Cycle start date (Week 1 Monday)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" value={cycleStartInput} onChange={e => setCycleStartInput(e.target.value)} />
              <button className="btn" onClick={handleSaveCycle} disabled={savingCycle}>
                {savingCycle ? "..." : "Set"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>4-Week Cycle</h2>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 500 }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px repeat(5, 1fr)", gap: 4, marginBottom: 4 }}>
              <div />
              {DAY_SHORT.map(d => (
                <div key={d} style={{ textAlign: "center", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", padding: "4px 0" }}>
                  {d}
                </div>
              ))}
            </div>
            {WEEKS.map(week => (
              <div key={week} style={{ display: "grid", gridTemplateColumns: "60px repeat(5, 1fr)", gap: 4, marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: week === currentWeek && cycleStart ? "var(--pink)" : "var(--surface-2)", color: week === currentWeek && cycleStart ? "#fff" : "var(--muted)" }}>
                    {"W" + week}
                  </span>
                </div>
                {DAYS.map((day, di) => {
                  const isThisToday = week === currentWeek && day === todayDay && cycleStart !== null;
                  const isSelected = selectedWeek === week && selectedDay === day;
                  return (
                    <button
                      key={day}
                      onClick={() => handleDayClick(week, day)}
                      style={{ padding: "8px 4px", borderRadius: 8, textAlign: "center", cursor: "pointer", border: isSelected ? "2px solid var(--pink)" : isThisToday ? "2px solid var(--text)" : "1px solid var(--border)", background: isSelected ? "var(--pink-light)" : isThisToday ? "#f8fafc" : "#fff", fontSize: "0.75rem", fontWeight: isThisToday ? 700 : 400, color: isSelected ? "var(--pink-dark)" : "var(--text)" }}
                    >
                      {DAY_SHORT[di]}
                      {isThisToday && <div style={{ fontSize: "0.6rem", color: "var(--pink-dark)", marginTop: 2 }}>Today</div>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedRepName && (
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ marginBottom: 2 }}>
                {"Week " + selectedWeek + " - " + DAY_SHORT[DAYS.indexOf(selectedDay)]}
                {selectedWeek === currentWeek && selectedDay === todayDay && cycleStart !== null && (
                  <span style={{ marginLeft: 8, padding: "2px 10px", borderRadius: 999, fontSize: "0.75rem", background: "var(--pink)", color: "#fff", fontWeight: 600 }}>Today</span>
                )}
              </h2>
              <p className="small muted">{selectedRepName + " - " + (loading ? "Loading..." : customers.length + " stops")}</p>
            </div>
            {customers.length > 0 && (
              <a href={"https://www.google.com/maps/dir/" + customers.map(c => encodeURIComponent([c.addressLine1, c.town, c.postCode].filter(Boolean).join(", "))).join("/")} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: "0.8rem" }}>
                Maps
              </a>
            )}
          </div>

          {!loading && customers.length === 0 && (
            <p className="small muted">No customers scheduled for this day.</p>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {customers.map((c, i) => (
              <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 14px", gap: 10 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--pink)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.8rem", flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 3 }}>{c.salonName}</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {c.customerName && <span className="small muted">{c.customerName}</span>}
                        {c.customerTelephone && <a href={"tel:" + c.customerTelephone} className="small muted" style={{ textDecoration: "none" }}>{c.customerTelephone}</a>}
                        {(c.town || c.postCode) && <span className="small muted">{[c.town, c.postCode].filter(Boolean).join(", ")}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <Link href={"/customers/" + c.id} className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }}>Profile</Link>
                    <Link href={"/calls/new?customerId=" + c.id} className="btn" style={{ fontSize: "0.78rem", padding: "5px 10px" }}>Log Call</Link>
                    <button className="primary" style={{ fontSize: "0.78rem", padding: "5px 10px" }} onClick={() => handleGenerateBrief(c.id)} disabled={briefLoading && briefCustomerId === c.id}>
                      {briefLoading && briefCustomerId === c.id ? "..." : "AI Brief"}
                    </button>
                  </div>
                </div>

                {briefCustomerId === c.id && (briefLoading || briefText || briefError) && (
                  <div ref={briefRef} style={{ borderTop: "1px solid var(--border)", padding: "14px", background: "#fafbfc" }}>
                    {briefLoading && <p className="small muted">Generating pre-call brief...</p>}
                    {briefError && <p className="small" style={{ color: "var(--red)" }}>{briefError}</p>}
                    {briefText && !briefLoading && (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Pre-Call Brief</span>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn" style={{ fontSize: "0.72rem", padding: "3px 8px" }} onClick={handleCopyBrief}>Copy</button>
                            <button className="btn" style={{ fontSize: "0.72rem", padding: "3px 8px" }} onClick={handleCloseBrief}>Close</button>
                          </div>
                        </div>
                        <div style={{ fontSize: "0.85rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{briefText}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!selectedRepName && (
        <section className="card" style={{ textAlign: "center", padding: 40 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Select a sales rep to view their route plan</p>
          <p className="small muted">Then tap any day in the grid to see scheduled customers</p>
        </section>
      )}
    </div>
  );
}
