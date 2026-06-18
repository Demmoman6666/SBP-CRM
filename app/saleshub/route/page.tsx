"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Rep = { id: string; name: string; cycleStartDate?: string | null };
type Customer = {
  id: string;
  salonName: string;
  customerName: string | null;
  town: string | null;
  postCode: string | null;
  routeWeeks: number[];
  routeDays: string[];
  stage: string;
  salesRep: string | null;
};

const DAYS = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];
const DAY_LABELS: Record<string,string> = { MONDAY:"Mon", TUESDAY:"Tue", WEDNESDAY:"Wed", THURSDAY:"Thu", FRIDAY:"Fri" };
const DAY_FULL: Record<string,string> = { MONDAY:"Monday", TUESDAY:"Tuesday", WEDNESDAY:"Wednesday", THURSDAY:"Thursday", FRIDAY:"Friday" };

const STAGE_COLOR: Record<string,string> = {
  LEAD: "#e0e7ff", APPOINTMENT_BOOKED: "#fef9c3", SAMPLING: "#fce7f3", CUSTOMER: "#dcfce7"
};
const STAGE_LABEL: Record<string,string> = {
  LEAD:"Lead", APPOINTMENT_BOOKED:"Appt", SAMPLING:"Sampling", CUSTOMER:"Customer"
};

function pad(n: number) { return String(n).padStart(2,"0"); }
function toYmd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// Work out which week (1-4) a given date falls in relative to a cycle start
function getCycleWeek(date: Date, cycleStart: Date): number {
  const msPerDay = 86400000;
  const daysDiff = Math.floor((date.getTime() - cycleStart.getTime()) / msPerDay);
  if (daysDiff < 0) {
    const adjusted = ((daysDiff % 28) + 28) % 28;
    return Math.floor(adjusted / 7) + 1;
  }
  return (Math.floor(daysDiff / 7) % 4) + 1;
}

function getDayOfWeek(date: Date): string {
  const days = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  return days[date.getDay()];
}

// Get the Monday of the week containing a date
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0,0,0,0);
  return d;
}

function BriefModal({ customerId, customerName, onClose }: { customerId: string; customerName: string; onClose: () => void }) {
  const [brief, setBrief] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/ai/pre-call-brief?customerId=${customerId}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        setBrief(j.brief);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  function renderBrief(text: string) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("## ")) return <h3 key={i} style={{ fontSize: "1rem", fontWeight: 700, marginTop: 16, marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid var(--border)" }}>{line.slice(3)}</h3>;
      if (line.startsWith("- ") || line.startsWith("• ")) return <li key={i} style={{ marginLeft: 16, marginBottom: 3, fontSize: "0.875rem", lineHeight: 1.6 }}>{line.slice(2)}</li>;
      if (line.startsWith("✅") || line.startsWith("⚠️") || line.startsWith("💬") || line.startsWith("💰") || line.startsWith("📊") || line.startsWith("🎯") || line.startsWith("📞")) return <p key={i} style={{ margin: "4px 0", fontSize: "0.875rem", lineHeight: 1.7 }}>{line}</p>;
      if (line.trim() === "") return <div key={i} style={{ height: 4 }} />;
      return <p key={i} style={{ margin: "3px 0", fontSize: "0.875rem", lineHeight: 1.6 }}>{line}</p>;
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 640, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>✨ Pre-Call Brief</div>
            <div className="small muted">{customerName}</div>
          </div>
          <button className="btn" style={{ minHeight: "unset", padding: "6px 12px", fontSize: "0.8rem" }} onClick={onClose}>Close</button>
        </div>
        {/* Content */}
        <div style={{ overflowY: "auto", padding: "16px 20px 32px", flex: 1 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: "2rem", marginBottom: 12 }}>✨</div>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Generating your brief…</p>
              <p className="small muted">Reading call history, orders and gaps. 10-20 seconds.</p>
            </div>
          )}
          {error && <p className="small" style={{ color: "var(--red)" }}>{error}</p>}
          {brief && !loading && <div>{renderBrief(brief)}</div>}
        </div>
      </div>
    </div>
  );
}

function CustomerCard({ customer, onBrief }: { customer: Customer; onBrief: (id: string, name: string) => void }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: 2 }}>{customer.salonName}</div>
        <div className="small muted">{[customer.town, customer.postCode].filter(Boolean).join(" · ")}</div>
        <div style={{ marginTop: 4 }}>
          <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 600, background: STAGE_COLOR[customer.stage] || "#f3f4f6" }}>
            {STAGE_LABEL[customer.stage] || customer.stage}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
        <button
          className="primary"
          style={{ fontSize: "0.75rem", padding: "5px 10px", minHeight: "unset" }}
          onClick={() => onBrief(customer.id, customer.salonName)}
        >
          ✨ Brief
        </button>
        <Link href={`/customers/${customer.id}`} className="btn" style={{ fontSize: "0.75rem", padding: "5px 10px", minHeight: "unset", textAlign: "center" }}>
          Profile
        </Link>
      </div>
    </div>
  );
}

export default function RoutePlannerPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [selectedRepId, setSelectedRepId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"today" | "week" | "cycle">("today");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [briefCustomer, setBriefCustomer] = useState<{id: string; name: string} | null>(null);
  const [cycleStart, setCycleStart] = useState<string>("");
  const [savingCycle, setSavingCycle] = useState(false);

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayDow = getDayOfWeek(today);
  const monday = getMonday(today);

  useEffect(() => {
    fetch("/api/salesreps", { cache: "no-store" })
      .then(r => r.json())
      .then(j => {
        if (Array.isArray(j)) setReps(j);
      });
  }, []);

  // When rep changes, load their cycle start
  useEffect(() => {
    const rep = reps.find(r => r.id === selectedRepId);
    if (rep?.cycleStartDate) {
      setCycleStart(rep.cycleStartDate.slice(0, 10));
    } else {
      setCycleStart("");
    }
  }, [selectedRepId, reps]);

  // Load customers on rep change
  useEffect(() => {
    if (!selectedRepId) { setCustomers([]); return; }
    setLoading(true);
    const qs = new URLSearchParams({ repId: selectedRepId, routePlanEnabled: "1", limit: "500" });
    fetch(`/api/customers?${qs}`, { cache: "no-store" })
      .then(r => r.json())
      .then(j => setCustomers(Array.isArray(j) ? j : Array.isArray(j?.customers) ? j.customers : []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [selectedRepId]);

  // Work out current cycle week
  const currentCycleWeek = useMemo(() => {
    if (!cycleStart) return null;
    const start = new Date(cycleStart);
    return getCycleWeek(today, start);
  }, [cycleStart]);

  // Get customers for a specific week + day
  function getCustomers(week: number, day: string): Customer[] {
    return customers.filter(c => c.routeWeeks.includes(week) && c.routeDays.includes(day));
  }

  // Today's customers
  const todayCustomers = useMemo(() => {
    if (!currentCycleWeek) return [];
    return getCustomers(currentCycleWeek, todayDow);
  }, [customers, currentCycleWeek, todayDow]);

  // This week's customers by day
  const weekCustomers = useMemo(() => {
    if (!currentCycleWeek) return {};
    const result: Record<string, Customer[]> = {};
    for (const day of DAYS) {
      result[day] = getCustomers(currentCycleWeek, day);
    }
    return result;
  }, [customers, currentCycleWeek]);

  async function saveCycleStart() {
    if (!selectedRepId || !cycleStart) return;
    setSavingCycle(true);
    try {
      await fetch(`/api/salesreps/${selectedRepId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleStartDate: cycleStart }),
      });
      setReps(prev => prev.map(r => r.id === selectedRepId ? { ...r, cycleStartDate: cycleStart } : r));
    } finally {
      setSavingCycle(false);
    }
  }

  const selectedRep = reps.find(r => r.id === selectedRepId);

  return (
    <div className="grid" style={{ gap: 16 }}>

      {/* Header */}
      <section className="card">
        <h1 style={{ marginBottom: 4 }}>Route Planner</h1>
        <p className="small muted">4-week cycle route management with AI pre-call briefs</p>
      </section>

      {/* Rep selector + cycle setup */}
      <section className="card" style={{ overflow: "visible" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "flex-end" }}>
          <div className="field">
            <label>Sales Rep</label>
            <select value={selectedRepId} onChange={e => setSelectedRepId(e.target.value)}>
              <option value="">Select rep…</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {selectedRepId && (
            <div className="field">
              <label>Cycle start date</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="date" value={cycleStart} onChange={e => setCycleStart(e.target.value)} />
                <button className="btn" disabled={savingCycle || !cycleStart} onClick={saveCycleStart} style={{ flexShrink: 0 }}>
                  {savingCycle ? "…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>

        {selectedRepId && currentCycleWeek && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "var(--pink-light)", borderRadius: 8, display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--pink-dark)" }}>
              Currently in Week {currentCycleWeek} of 4
            </span>
            <span className="small muted">· {today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</span>
          </div>
        )}

        {selectedRepId && !cycleStart && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef9c3", borderRadius: 8 }}>
            <p className="small" style={{ color: "#92400e", margin: 0 }}>
              Set a cycle start date above to enable week-based filtering.
            </p>
          </div>
        )}
      </section>

      {selectedRepId && (
        <>
          {/* View toggle */}
          <section className="card">
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { key: "today", label: `Today (${todayCustomers.length})` },
                { key: "week", label: "This Week" },
                { key: "cycle", label: "Full Cycle" },
              ].map(v => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key as any)}
                  style={{ padding: "7px 16px", borderRadius: 999, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: view === v.key ? "var(--pink)" : "#fff", color: view === v.key ? "#fff" : "var(--text)" }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </section>

          {loading && <section className="card"><p className="small muted">Loading…</p></section>}

          {/* TODAY VIEW */}
          {view === "today" && !loading && (
            <section className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2>
                  <div className="small muted">{currentCycleWeek ? `Week ${currentCycleWeek} · ` : ""}{todayCustomers.length} customer{todayCustomers.length !== 1 ? "s" : ""}</div>
                </div>
              </div>
              {todayCustomers.length === 0 ? (
                <p className="small muted">{currentCycleWeek ? "No customers scheduled for today." : "Set a cycle start date to see today's schedule."}</p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {todayCustomers.map(c => (
                    <CustomerCard key={c.id} customer={c} onBrief={(id, name) => setBriefCustomer({ id, name })} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* WEEK VIEW */}
          {view === "week" && !loading && (
            <div style={{ display: "grid", gap: 10 }}>
              {DAYS.map(day => {
                const dayCusts = weekCustomers[day] || [];
                const isToday = day === todayDow;
                return (
                  <section key={day} className="card" style={{ border: isToday ? "2px solid var(--pink)" : undefined }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dayCusts.length > 0 ? 12 : 0, cursor: "pointer" }} onClick={() => setSelectedDay(selectedDay === day ? null : day)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: isToday ? "var(--pink)" : "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.8rem", color: isToday ? "#fff" : "var(--muted)", flexShrink: 0 }}>
                          {DAY_LABELS[day]}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{DAY_FULL[day]}{isToday ? " (Today)" : ""}</div>
                          <div className="small muted">{dayCusts.length} customer{dayCusts.length !== 1 ? "s" : ""}</div>
                        </div>
                      </div>
                      {dayCusts.length > 0 && <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{selectedDay === day ? "▲" : "▼"}</span>}
                    </div>
                    {(selectedDay === day || isToday) && dayCusts.length > 0 && (
                      <div style={{ display: "grid", gap: 8 }}>
                        {dayCusts.map(c => (
                          <CustomerCard key={c.id} customer={c} onBrief={(id, name) => setBriefCustomer({ id, name })} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* FULL CYCLE VIEW */}
          {view === "cycle" && !loading && (
            <div style={{ display: "grid", gap: 16 }}>
              {[1,2,3,4].map(week => (
                <section key={week} className="card">
                  <h2 style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                    Week {week}
                    {currentCycleWeek === week && <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: "var(--pink)", color: "#fff" }}>Current</span>}
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                    {DAYS.map(day => {
                      const custs = getCustomers(week, day);
                      const isToday = week === currentCycleWeek && day === todayDow;
                      return (
                        <div key={day} style={{ border: isToday ? "2px solid var(--pink)" : "1px solid var(--border)", borderRadius: 10, padding: 10, background: isToday ? "var(--pink-light)" : "#fff" }}>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, marginBottom: 6, color: isToday ? "var(--pink-dark)" : "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{DAY_LABELS[day]}</div>
                          {custs.length === 0 ? (
                            <div style={{ fontSize: "0.7rem", color: "#ccc" }}>—</div>
                          ) : (
                            <div style={{ display: "grid", gap: 4 }}>
                              {custs.slice(0, 3).map(c => (
                                <div key={c.id} style={{ fontSize: "0.7rem", background: STAGE_COLOR[c.stage] || "#f3f4f6", borderRadius: 4, padding: "2px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, cursor: "pointer" }} onClick={() => setBriefCustomer({ id: c.id, name: c.salonName })} title={c.salonName}>
                                  {c.salonName}
                                </div>
                              ))}
                              {custs.length > 3 && <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>+{custs.length - 3} more</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {!selectedRepId && !loading && (
        <section className="card" style={{ textAlign: "center" as const, padding: 40 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Select a sales rep to view their route</p>
          <p className="small muted">Each rep manages their own 4-week cycle independently</p>
        </section>
      )}

      {/* Pre-call brief modal */}
      {briefCustomer && (
        <BriefModal
          customerId={briefCustomer.id}
          customerName={briefCustomer.name}
          onClose={() => setBriefCustomer(null)}
        />
      )}
    </div>
  );
}
