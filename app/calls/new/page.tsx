// app/calls/new/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type CustomerLite = {
  id: string;
  salonName: string;
  customerName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  customerEmailAddress: string | null;
  customerNumber: string | null;
  customerTelephone: string | null;
};

type SalesRep = { id: string; name: string };

export default function NewCallPage() {
  // form state
  const [existing, setExisting] = useState<"yes" | "no" | "">("");
  const [salesRepId, setSalesRepId] = useState("");
  const [callType, setCallType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState("");
  const [followUpAt, setFollowUpAt] = useState<string>("");

  // customers (predictive when existing === "yes")
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CustomerLite[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | null>(null);

  // “no” path – loose entry
  const [leadName, setLeadName] = useState("");

  // sales reps
  const [reps, setReps] = useState<SalesRep[]>([]);

  // load reps
  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then((r) => r.json())
      .then((rows) => setReps(rows ?? []))
      .catch(() => setReps([]));
  }, []);

  // predictive search
  useEffect(() => {
    if (existing !== "yes") return;
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      const r = await fetch(`/api/customers?search=${encodeURIComponent(query)}&take=8`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const rows: CustomerLite[] = await r.json();
      setSuggestions(rows);
    }, 250);
    return () => clearTimeout(handle);
  }, [query, existing]);

  // clear fields when toggling existing/ new
  useEffect(() => {
    setSelectedCustomer(null);
    setQuery("");
    setLeadName("");
    setSuggestions([]);
  }, [existing]);

  const addr = useMemo(() => {
    if (!selectedCustomer) return "";
    const { addressLine1, addressLine2, town, county, postCode } = selectedCustomer;
    return [addressLine1, addressLine2, town, county, postCode].filter(Boolean).join(", ");
  }, [selectedCustomer]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!salesRepId) {
      alert("Please select a Sales Rep.");
      return;
    }
    if (existing === "") {
      alert("Please answer whether this is an existing customer.");
      return;
    }
    if (existing === "yes" && !selectedCustomer) {
      alert("Please choose a customer from the suggestions.");
      return;
    }
    if (existing === "no" && !leadName.trim()) {
      alert("Please enter a company/salon name.");
      return;
    }

    const payload: any = {
      isExistingCustomer: existing === "yes",
      staff: reps.find((r) => r.id === salesRepId)?.name ?? "",
      callType: callType || null,
      outcome: outcome || null,
      summary,
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
    };

    if (existing === "yes" && selectedCustomer) {
      payload.customerId = selectedCustomer.id;
    } else {
      payload.customerName = leadName.trim();
    }

    const r = await fetch("/api/call-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j?.error || "Failed to save call");
      return;
    }

    // go back home after save
    window.location.href = "/";
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2>Log Call</h2>
      </section>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-2">
          <fieldset>
            <label>Is this an existing customer? *</label>
            <div className="row" style={{ gap: 16 }}>
              <label>
                <input
                  type="radio"
                  name="existing"
                  value="yes"
                  checked={existing === "yes"}
                  onChange={() => setExisting("yes")}
                />{" "}
                Yes
              </label>
              <label>
                <input
                  type="radio"
                  name="existing"
                  value="no"
                  checked={existing === "no"}
                  onChange={() => setExisting("no")}
                />{" "}
                No
              </label>
            </div>
            {existing === "" && <div className="small muted">You must choose one.</div>}
          </fieldset>

          <div>
            <label>Sales Rep *</label>
            <select
              required
              value={salesRepId}
              onChange={(e) => setSalesRepId(e.target.value)}
            >
              <option value="">— Select Sales Rep —</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {existing === "yes" ? (
          <>
            <div>
              <label>Customer *</label>
              <input
                placeholder="Start typing salon or contact…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedCustomer(null);
                }}
                autoComplete="off"
              />
              {/* suggestions */}
              {suggestions.length > 0 && !selectedCustomer && (
                <div
                  className="card"
                  style={{
                    marginTop: 6,
                    padding: 6,
                    borderRadius: 10,
                    maxHeight: 220,
                    overflow: "auto",
                  }}
                >
                  {suggestions.map((c) => (
                    <div
                      key={c.id}
                      className="row"
                      style={{
                        padding: "8px 6px",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                      }}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setQuery(`${c.salonName} — ${c.customerName}`);
                        setSuggestions([]);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {c.salonName} — {c.customerName}
                        </div>
                        <div className="small muted">
                          {[c.addressLine1, c.town, c.postCode].filter(Boolean).join(", ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedCustomer && (
              <div className="card" style={{ background: "#fafafa" }}>
                <b>Customer details</b>
                <div className="small">
                  {[selectedCustomer.addressLine1, selectedCustomer.addressLine2]
                    .filter(Boolean)
                    .join(", ")}
                  <br />
                  {[selectedCustomer.town, selectedCustomer.county, selectedCustomer.postCode]
                    .filter(Boolean)
                    .join(", ")}
                  <br />
                  {selectedCustomer.customerEmailAddress || "-"} •{" "}
                  {selectedCustomer.customerTelephone || selectedCustomer.customerNumber || "-"}
                </div>
              </div>
            )}
          </>
        ) : existing === "no" ? (
          <div>
            <label>Company / Salon *</label>
            <input
              value={leadName}
              onChange={(e) => setLeadName(e.target.value)}
              placeholder="Who called?"
              required
            />
          </div>
        ) : null}

        <div className="grid grid-2">
          <div>
            <label>Call Type</label>
            <select value={callType} onChange={(e) => setCallType(e.target.value)}>
              <option value="">— Select —</option>
              <option value="enquiry">Enquiry</option>
              <option value="order">Order</option>
              <option value="support">Support</option>
              <option value="followup">Follow-up</option>
            </select>
          </div>

          <div>
            <label>Follow-up (optional)</label>
            <input
              type="datetime-local"
              value={followUpAt}
              onChange={(e) => setFollowUpAt(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label>Summary *</label>
          <textarea
            required
            rows={4}
            placeholder="What was discussed?"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <div>
          <label>Outcome</label>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">— Select —</option>
            <option value="left_message">Left message</option>
            <option value="resolved">Resolved</option>
            <option value="needs_followup">Needs follow-up</option>
            <option value="escalated">Escalated</option>
          </select>
        </div>

        <div className="right">
          <button className="primary" type="submit">
            Save Call
          </button>
        </div>
      </form>
    </div>
  );
}
