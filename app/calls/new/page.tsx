// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type CustomerLite = {
  id: string;
  salonName: string;
  customerName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
  customerEmailAddress?: string | null;
  customerNumber?: string | null;
  customerTelephone?: string | null;
};

type SalesRepLite = { id: string; name: string };

function pad(n: number) { return String(n).padStart(2, "0"); }
function formatNow(d: Date) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function hhmm(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function minutesBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  const diff = e - s;
  return diff < 0 ? 0 : diff;
}

function toAddressBlock(c?: CustomerLite | null) {
  if (!c) return { lines: "", contact: "" };
  const lines = [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean).join("\n");
  const contact = [c.customerEmailAddress, c.customerNumber || c.customerTelephone].filter(Boolean).join(" • ");
  return { lines, contact };
}

export default function NewCallPage() {
  // live timestamp
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // form state
  const [isExisting, setIsExisting] = useState<null | boolean>(null);
  const [reps, setReps] = useState<SalesRepLite[]>([]);
  const [salesRep, setSalesRep] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpts, setCustomerOpts] = useState<CustomerLite[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);

  const [callType, setCallType] = useState("");
  const [outcome, setOutcome] = useState("");

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  const [appointmentBooked, setAppointmentBooked] = useState<null | boolean>(null);
  const [followDate, setFollowDate] = useState(""); // yyyy-mm-dd
  const [followTime, setFollowTime] = useState(""); // HH:mm

  const [summary, setSummary] = useState("");

  useEffect(() => { setDuration(minutesBetween(startTime, endTime)); }, [startTime, endTime]);

  // load reps
  useEffect(() => { (async () => { try { const r = await fetch("/api/sales-reps",{cache:"no-store"}); if(r.ok) setReps(await r.json()); } catch {} })(); }, []);

  // predictive customers when existing = yes
  useEffect(() => {
    if (isExisting !== true) return;
    const q = customerQuery.trim();
    if (!q) { setCustomerOpts([]); return; }
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/customers?q=${encodeURIComponent(q)}&take=8`, { signal: ctrl.signal, cache: "no-store" });
        if (r.ok) setCustomerOpts(await r.json());
      } catch {}
    })();
    return () => ctrl.abort();
  }, [customerQuery, isExisting]);

  const addressBlock = useMemo(() => toAddressBlock(selectedCustomer), [selectedCustomer]);

  function pickCustomer(c: CustomerLite) {
    setSelectedCustomer(c);
    setCustomerQuery(`${c.salonName} — ${c.customerName}`);
    setCustomerOpts([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isExisting === null) return alert("Please choose if this is an existing customer.");
    if (!salesRep) return alert("Please select a Sales Rep.");
    if (!summary.trim()) return alert("Please add a summary.");

    let followUpAt: string | undefined;
    if (followDate) followUpAt = `${followDate}T${followTime || "00:00"}`;

    const payload: any = {
      isExistingCustomer: isExisting ? "true" : "false",
      salesRep,
      callType: callType || null,
      outcome: outcome || null,
      summary,
      followUpAt,
      startTime: startTime || null,
      endTime: endTime || null,
      appointmentBooked: appointmentBooked === null ? "" : appointmentBooked ? "true" : "false",
      clientLoggedAt: new Date().toISOString(),
    };

    if (isExisting) {
      if (!selectedCustomer?.id) return alert("Please pick a customer from the list.");
      payload.customerId = selectedCustomer.id;
    } else {
      payload.customerName = customerQuery || null;
    }

    const r = await fetch("/api/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) return alert(data?.error || "Failed to save call");

    if (data.redirectTo) window.location.href = data.redirectTo as string;
    else window.location.href = "/";
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Header */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Log Call</h1>
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            <span className="small muted">Timestamp: {formatNow(now)}</span>
            <Link href="/" className="small" style={{ textDecoration: "none" }}>← Back</Link>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="card">
        <form className="grid" style={{ gap: 14 }} onSubmit={onSubmit}>
          {/* Row 1: Sales rep + Existing? */}
          <div className="grid grid-2">
            <div>
              <label>Sales Rep (required)</label>
              <select value={salesRep} onChange={(e) => setSalesRep(e.target.value)} required style={{ width: "100%" }}>
                <option value="">— Select a Sales Rep —</option>
                {reps.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label>Is this an existing customer? (required)</label>
              <div className="row" style={{ gap: 16, marginTop: 6 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input type="radio" name="existing" checked={isExisting === true}
                    onChange={() => { setIsExisting(true); setSelectedCustomer(null); setCustomerQuery(""); setCustomerOpts([]); }} />
                  Yes
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input type="radio" name="existing" checked={isExisting === false}
                    onChange={() => { setIsExisting(false); setSelectedCustomer(null); setCustomerOpts([]); }} />
                  No
                </label>
              </div>
            </div>
          </div>

          {/* Row 2: Customer field (full width) */}
          {isExisting === true && (
            <div>
              <label>Customer *</label>
              <div style={{ position: "relative" }}>
                <input
                  type="search"
                  value={customerQuery}
                  onChange={(e) => { setCustomerQuery(e.target.value); setSelectedCustomer(null); }}
                  placeholder="Type to search…"
                  required
                />
                {customerOpts.length > 0 && (
                  <div className="card" style={{ position: "absolute", zIndex: 20, width: "100%", marginTop: 6, maxHeight: 260, overflowY: "auto" }}>
                    {customerOpts.map((c) => (
                      <div key={c.id} onClick={() => pickCustomer(c)}
                        style={{ padding: "8px 10px", cursor: "pointer" }}>
                        <div style={{ fontWeight: 600 }}>{c.salonName} — {c.customerName}</div>
                        <div className="small muted">{[c.town, c.county, c.postCode].filter(Boolean).join(", ")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {isExisting === false && (
            <div>
              <label>Customer (free entry)</label>
              <input type="text" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Type a business/name" />
              <div className="small muted" style={{ marginTop: 6 }}>For non-customers we’ll store the name as a lead snapshot.</div>
            </div>
          )}

          {/* Row 3: Customer details preview */}
          {selectedCustomer && (
            <div className="card" style={{ marginTop: 2 }}>
              <b>Customer details</b>
              <div className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>
                {addressBlock.lines || "-"}
                <br />
                {addressBlock.contact || "-"}
              </div>
            </div>
          )}

          {/* Row 4: Call Type + Outcome */}
          <div className="grid grid-2">
            <div>
              <label>Call Type</label>
              <select value={callType} onChange={(e) => setCallType(e.target.value)} style={{ width: "100%" }}>
                <option value="">— Select —</option>
                <option>Cold Call</option>
                <option>Booked Call</option>
                <option>Booked Demo</option>
              </select>
            </div>
            <div>
              <label>Outcome</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ width: "100%" }}>
                <option value="">— Select —</option>
                <option>Sale</option>
                <option>No Sale</option>
                <option>Appointment booked</option>
                <option>Demo Booked</option>
              </select>
            </div>
          </div>

          {/* Row 5: Timing + Appointment/Follow-up */}
          <div className="grid grid-2">
            {/* Left: Start/Finish/Duration */}
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label>Start Time</label>
                <div className="row" style={{ gap: 6 }}>
                  <input type="time" step={60} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  <button type="button" className="btn" onClick={() => setStartTime(hhmm())}>Now</button>
                </div>
              </div>
              <div>
                <label>Finish Time</label>
                <div className="row" style={{ gap: 6 }}>
                  <input type="time" step={60} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  <button type="button" className="btn" onClick={() => setEndTime(hhmm())}>Now</button>
                </div>
              </div>
              <div>
                <label>Total Duration (mins)</label>
                <input readOnly value={duration ?? ""} placeholder="—" />
              </div>
            </div>

            {/* Right: Appointment booked + Follow-up */}
            <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 10 }}>
              <div>
                <label>Appointment booked?</label>
                <div className="row" style={{ gap: 16, marginTop: 6 }}>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="radio" name="appt" checked={appointmentBooked === true} onChange={() => setAppointmentBooked(true)} /> Yes
                  </label>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="radio" name="appt" checked={appointmentBooked === false} onChange={() => setAppointmentBooked(false)} /> No
                  </label>
                </div>
              </div>
              <div>
                <label>Follow-up (date & time)</label>
                <div className="row" style={{ gap: 8 }}>
                  <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} />
                  <input type="time" value={followTime} onChange={(e) => setFollowTime(e.target.value)} />
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  If set, we’ll mark this call as requiring follow-up.
                </div>
              </div>
            </div>
          </div>

          {/* Row 6: Summary */}
          <div>
            <label>Summary (required)</label>
            <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed?" required />
          </div>

          {/* Actions */}
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <Link href="/" className="btn">Cancel</Link>
            <button className="primary" type="submit">Save Call</button>
          </div>
        </form>
      </section>
    </div>
  );
}
