// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SalesRep = { id: string; name: string };
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
};

function labelFor(c: CustomerLite) {
  const bits = [c.salonName, "—", c.customerName].filter(Boolean);
  return bits.join(" ");
}

export default function NewCallPage() {
  // form state
  const [existing, setExisting] = useState<"yes" | "no" | "">("");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerLite[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);

  const [reps, setReps] = useState<SalesRep[]>([]);
  const [salesRep, setSalesRep] = useState<string>(""); // store rep name (to match your schema)

  const [callType, setCallType] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [followUpAt, setFollowUpAt] = useState<string>("");

  // free-text fields if NOT existing (you can expand later)
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");

  // load sales reps
  useEffect(() => {
    fetch("/api/sales-reps")
      .then(r => r.json())
      .then((data: SalesRep[]) => setReps(data))
      .catch(() => setReps([]));
  }, []);

  // predictive search when existing === "yes"
  useEffect(() => {
    if (existing !== "yes") return; // only search when “existing” path
    const ctrl = new AbortController();
    const q = search.trim();
    if (!q) {
      setSuggestions([]);
      setSelectedCustomer(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/customers?search=${encodeURIComponent(q)}&take=12`, { signal: ctrl.signal })
        .then(r => r.json())
        .then((rows: CustomerLite[]) => setSuggestions(rows))
        .catch(() => {});
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [search, existing]);

  // when user types a label that matches a suggestion, lock selection
  useEffect(() => {
    if (existing !== "yes") return;
    const match = suggestions.find(s => labelFor(s).toLowerCase() === search.trim().toLowerCase());
    if (match) setSelectedCustomer(match);
  }, [search, suggestions, existing]);

  const details = useMemo(() => {
    const c = selectedCustomer;
    if (!c) return null;
    const addrLines = [
      c.addressLine1,
      c.addressLine2,
      c.town,
      c.county,
      c.postCode,
    ].filter(Boolean);
    const email = c.customerEmailAddress;
    return { addr: addrLines.join(", "), email };
  }, [selectedCustomer]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    // build payload exactly as API expects
    const payload: any = {
      isExistingCustomer: existing === "yes",
      salesRep,               // required
      summary,                // required
      callType: callType || null,
      outcome: outcome || null,
      followUpAt: followUpAt || null, // datetime-local (API accepts this)
    };

    if (existing === "yes") {
      payload.customerId = selectedCustomer?.id || "";
    } else if (existing === "no") {
      payload.customerName = leadName || null;
      payload.contactPhone = leadPhone || null;
      payload.contactEmail = leadEmail || null;
    }

    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = "Failed to save call";
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {}
      alert(msg);
      return;
    }

    const data = await res.json();
    if (data?.redirectTo) {
      window.location.href = data.redirectTo as string;
    } else {
      alert("Saved");
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Log Call</h1>
      </section>

      <section className="card">
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <div className="grid grid-2">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <label>Is this an existing customer? *</label>
              <div className="row">
                <label><input type="radio" name="existing" onChange={() => setExisting("yes")} checked={existing==="yes"} /> Yes</label>
                <label><input type="radio" name="existing" onChange={() => setExisting("no")}  checked={existing==="no"} /> No</label>
              </div>
              {existing === "" && <div className="form-hint">You must choose one.</div>}
            </fieldset>

            <div>
              <label>Sales Rep *</label>
              <select
                required
                value={salesRep}
                onChange={e => setSalesRep(e.target.value)}
              >
                <option value="">— Select Sales Rep —</option>
                {reps.map(r => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Existing customer predictive */}
          {existing === "yes" && (
            <>
              <div>
                <label>Customer *</label>
                <input
                  list="customer-list"
                  placeholder="Type to search…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedCustomer(null);
                  }}
                  required
                />
                <datalist id="customer-list">
                  {suggestions.map(s => (
                    <option key={s.id} value={labelFor(s)} />
                  ))}
                </datalist>
                <div className="form-hint">Pick a suggestion so we capture the correct account.</div>
              </div>

              {details && (
                <div className="card" style={{ background: "#fafafa" }}>
                  <b>Customer details</b>
                  <div className="small">
                    {details.addr || "-"}
                    {details.email ? <> • {details.email}</> : null}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Lead capture if NOT existing */}
          {existing === "no" && (
            <div className="grid grid-2">
              <div>
                <label>Business / Contact Name</label>
                <input value={leadName} onChange={e => setLeadName(e.target.value)} />
              </div>
              <div>
                <label>Phone</label>
                <input value={leadPhone} onChange={e => setLeadPhone(e.target.value)} />
              </div>
              <div>
                <label>Email</label>
                <input type="email" value={leadEmail} onChange={e => setLeadEmail(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-2">
            <div>
              <label>Call Type</label>
              <select value={callType} onChange={e => setCallType(e.target.value)}>
                <option value="">— Select —</option>
                <option>Enquiry</option>
                <option>Order</option>
                <option>Complaint</option>
                <option>Support</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label>Follow-up (optional)</label>
              <input
                type="datetime-local"
                value={followUpAt}
                onChange={e => setFollowUpAt(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label>Summary *</label>
            <textarea rows={3} required value={summary} onChange={e => setSummary(e.target.value)} placeholder="What was discussed?" />
          </div>

          <div>
            <label>Outcome</label>
            <select value={outcome} onChange={e => setOutcome(e.target.value)}>
              <option value="">— Select —</option>
              <option>Resolved</option>
              <option>Left message</option>
              <option>Call back requested</option>
              <option>No answer</option>
              <option>Escalated</option>
            </select>
          </div>

          <div className="right">
            <button className="primary" type="submit">Save Call</button>
          </div>
        </form>
      </section>
    </div>
  );
}
