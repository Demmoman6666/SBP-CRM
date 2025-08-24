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

function formatNow(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function joinAddressLines(c?: CustomerLite | null) {
  if (!c) return { lines: "", contact: "" };
  const lines = [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean);
  const contact = [c.customerEmailAddress, c.customerNumber || c.customerTelephone]
    .filter(Boolean)
    .join(" • ");
  return { lines: lines.join("\n"), contact };
}

function minutesBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (
    [sh, sm, eh, em].some((n) => Number.isNaN(n) || n! < 0) ||
    sh! > 23 ||
    eh! > 23 ||
    sm! > 59 ||
    em! > 59
  )
    return null;
  const s = sh! * 60 + sm!;
  const e = eh! * 60 + em!;
  const diff = e - s;
  return diff < 0 ? 0 : diff;
}

export default function NewCallPage() {
  // Live timestamp
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // existing customer?
  const [isExisting, setIsExisting] = useState<null | boolean>(null);

  // predictive search
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpts, setCustomerOpts] = useState<CustomerLite[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);
  const addressBlock = useMemo(
    () => (selectedCustomer ? joinAddressLines(selectedCustomer) : null),
    [selectedCustomer]
  );

  // sales reps
  const [reps, setReps] = useState<SalesRepLite[]>([]);
  const [salesRep, setSalesRep] = useState("");

  // call details
  const [callType, setCallType] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [followDate, setFollowDate] = useState<string>(""); // yyyy-mm-dd
  const [followTime, setFollowTime] = useState<string>(""); // HH:mm
  const [summary, setSummary] = useState<string>("");

  // timing + duration + appointment booked
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [duration, setDuration] = useState<number | null>(null);
  const [appointmentBooked, setAppointmentBooked] = useState<null | boolean>(null);

  // auto duration
  useEffect(() => {
    setDuration(minutesBetween(startTime, endTime));
  }, [startTime, endTime]);

  // fetch reps
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/sales-reps", { cache: "no-store" });
        if (r.ok) setReps(await r.json());
      } catch {}
    })();
  }, []);

  // predictive customers
  useEffect(() => {
    if (isExisting !== true) return;
    const q = customerQuery.trim();
    if (!q) {
      setCustomerOpts([]);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/customers?q=${encodeURIComponent(q)}&take=8`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (r.ok) setCustomerOpts(await r.json());
      } catch {}
    })();
    return () => ctrl.abort();
  }, [customerQuery, isExisting]);

  function handlePickCustomer(c: CustomerLite) {
    setSelectedCustomer(c);
    setCustomerQuery(`${c.salonName} — ${c.customerName}`);
    setCustomerOpts([]);
  }

  function hhmm(d = new Date()) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isExisting === null) return alert("Please choose if this is an existing customer.");
    if (!salesRep) return alert("Please select a Sales Rep.");
    if (!summary.trim()) return alert("Please add a summary.");

    let followUpAt: string | undefined;
    if (followDate) {
      const time = followTime || "00:00";
      followUpAt = `${followDate}T${time}`;
    }

    const payload: any = {
      isExistingCustomer: isExisting ? "true" : "false",
      salesRep,
      callType: callType || null,
      outcome: outcome || null,
      summary,
      followUpAt,
      startTime: startTime || null,
      endTime: endTime || null,
      appointmentBooked:
        appointmentBooked === true ? "true" : appointmentBooked === false ? "false" : "",
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
    else {
      alert("Saved.");
      window.location.href = "/";
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1>Log Call</h1>
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            <span className="small muted">Timestamp: {formatNow(now)}</span>
            <Link href="/" className="small" style={{ textDecoration: "none" }}>
              ← Back
            </Link>
          </div>
        </div>
      </section>

      <section className="card">
        <form className="grid" style={{ gap: 12 }} onSubmit={onSubmit}>
          <div className="grid grid-2">
            {/* Existing? */}
            <div>
              <label>Is this an existing customer? (required)</label>
              <div className="row" style={{ gap: 16, marginTop: 6 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="existing"
                    checked={isExisting === true}
                    onChange={() => {
                      setIsExisting(true);
                      setSelectedCustomer(null);
                      setCustomerQuery("");
                      setCustomerOpts([]);
                    }}
                  />
                  Yes
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="existing"
                    checked={isExisting === false}
                    onChange={() => {
                      setIsExisting(false);
                      setSelectedCustomer(null);
                      setCustomerOpts([]);
                    }}
                  />
                  No
                </label>
              </div>
            </div>

            {/* Sales Rep */}
            <div>
              <label>Sales Rep (required)</label>
              <select
                value={salesRep}
                onChange={(e) => setSalesRep(e.target.value)}
                required
                style={{ width: "100%" }}
              >
                <option value="">— Select a Sales Rep —</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Customer picker / free entry */}
          {isExisting === true && (
            <div>
              <label>Customer *</label>
              <div style={{ position: "relative" }}>
                {/* Set type="search" so it matches your global input styles */}
                <input
                  type="search"
                  value={customerQuery}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setSelectedCustomer(null);
                  }}
                  placeholder="Type to search…"
                  required
                />
                {customerOpts.length > 0 && (
                  <div
                    className="card"
                    style={{
                      position: "absolute",
                      zIndex: 20,
                      width: "100%",
                      marginTop: 6,
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {customerOpts.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => handlePickCustomer(c)}
                        style={{ padding: "8px 10px", cursor: "pointer" }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {c.salonName} — {c.customerName}
                        </div>
                        <div className="small muted">
                          {[c.town, c.county, c.postCode].filter(Boolean).join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedCustomer && (
                <div className="card" style={{ marginTop: 8 }}>
                  <b>Customer details</b>
                  <div className="small" style={{ marginTop: 6, whiteSpace: "pre-line" }}>
                    {addressBlock?.lines || "-"}
                    <br />
                    {addressBlock?.contact || "-"}
                  </div>
                </div>
              )}
            </div>
          )}

          {isExisting === false && (
            <div>
              <label>Customer (free entry)</label>
              {/* Also set explicit type here so it styles like the others */}
              <input
                type="text"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Type a business/name"
              />
            </div>
          )}

          <div className="grid grid-2">
            {/* Call Type (with Booked Demo) */}
            <div>
              <label>Call Type</label>
              <select value={callType} onChange={(e) => setCallType(e.target.value)}>
                <option value="">— Select —</option>
                <option>Cold Call</option>
                <option>Booked Call</option>
                <option>Booked Demo</option>
              </select>
            </div>

            {/* Outcome dropdown */}
            <div>
              <label>Outcome</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value="">— Select —</option>
                <option>Sale</option>
                <option>No Sale</option>
                <option>Appointment booked</option>
                <option>Demo Booked</option>
              </select>
            </div>
          </div>

          {/* Start/Finish/Duration + Appointment Booked */}
          <div className="grid grid-2">
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label>Start Time</label>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    type="time"
                    step={60}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setStartTime(hhmm())}
                    title="Use current time"
                  >
                    Now
                  </button>
                </div>
              </div>
              <div>
                <label>Finish Time</label>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    type="time"
                    step={60}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEndTime(hhmm())}
                    title="Use current time"
                  >
                    Now
                  </button>
                </div>
              </div>
              <div>
                <label>Total Duration (mins)</label>
                <input value={duration ?? ""} readOnly placeholder="—" />
              </div>
            </div>

            <div>
              <label>Appointment booked?</label>
              <div className="row" style={{ gap: 16, marginTop: 6 }}>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="appt"
                    checked={appointmentBooked === true}
                    onChange={() => setAppointmentBooked(true)}
                  />
                  Yes
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="radio"
                    name="appt"
                    checked={appointmentBooked === false}
                    onChange={() => setAppointmentBooked(false)}
                  />
                  No
                </label>
              </div>
            </div>
          </div>

          {/* Follow-up */}
          <div className="grid grid-2">
            <div>
              <label>Follow-up (date & time)</label>
              <div className="row" style={{ gap: 8 }}>
                <input type="date" value={followDate} onChange={(e) => setFollowDate(e.target.value)} />
                <input type="time" value={followTime} onChange={(e) => setFollowTime(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Summary */}
          <div>
            <label>Summary (required)</label>
            <textarea
              rows={4}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What was discussed?"
              required
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <Link href="/" className="btn">
              Cancel
            </Link>
            <button className="primary" type="submit">
              Save Call
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
