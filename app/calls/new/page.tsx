"use client";

import { useEffect, useMemo, useState } from "react";

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
  salesRep?: string | null; // <-- important
};

type Rep = { id: string; name: string };

export default function LogCallPage() {
  const [isExisting, setIsExisting] = useState<boolean | null>(null);

  // customer search + selection
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerLite[]>([]);
  const [selected, setSelected] = useState<CustomerLite | null>(null);

  // reps + selected rep name
  const [reps, setReps] = useState<Rep[]>([]);
  const [salesRep, setSalesRep] = useState("");

  const [saving, setSaving] = useState(false);

  // load reps
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setReps(data))
      .catch(() => {});
  }, []);

  // predictive search when "existing" and user types
  useEffect(() => {
    if (!isExisting || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const p = new URLSearchParams({ q: query, take: "8" });
    fetch(`/api/customers?${p.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((data) => Array.isArray(data) && setResults(data))
      .catch(() => {});
    return () => ctrl.abort();
  }, [isExisting, query]);

  // when a customer is picked, auto-fill the sales rep (if any)
  useEffect(() => {
    if (!selected) return;
    const name = (selected.salesRep || "").trim();
    if (name) setSalesRep((prev) => prev || name); // don’t override if user already chose
  }, [selected]);

  const addressBlock = useMemo(() => {
    if (!selected) return "";
    const lines = [
      selected.addressLine1,
      selected.addressLine2,
      selected.town,
      selected.county,
      selected.postCode,
    ]
      .filter(Boolean)
      .join(", ");

    const contact = [
      selected.customerEmailAddress,
      selected.customerTelephone || selected.customerNumber,
    ]
      .filter(Boolean)
      .join(" • ");

    return { lines, contact };
  }, [selected]);

  function pickCustomer(c: CustomerLite) {
    setSelected(c);
    setQuery(`${c.salonName} — ${c.customerName}`);
    setResults([]);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isExisting === null) {
      alert("Please choose if this is an existing customer.");
      return;
    }
    if (!salesRep) {
      alert("Please pick a Sales Rep.");
      return;
    }

    const fd = new FormData(e.currentTarget);
    fd.set("isExistingCustomer", isExisting ? "true" : "false");
    fd.set("salesRep", salesRep);

    if (isExisting) {
      if (!selected?.id) {
        alert("Please pick a customer from the list.");
        return;
      }
      fd.set("customerId", selected.id);
      // free-text fields are only for new leads, so strip them if existing:
      fd.delete("customerName");
      fd.delete("contactPhone");
      fd.delete("contactEmail");
    }

    setSaving(true);
    const res = await fetch("/api/calls", { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      alert(json?.error || "Failed to save call");
      return;
    }

    // API returns redirectTo when attached to an existing customer
    if (json.redirectTo) {
      window.location.href = json.redirectTo as string;
      return;
    }
    alert("Call saved");
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <h1>Log Call</h1>
      </div>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
        {/* existing / new */}
        <div className="grid grid-2">
          <fieldset className="card" style={{ padding: 12 }}>
            <legend className="small">Is this an existing customer? *</legend>
            <label className="row" style={{ alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name="existing"
                checked={isExisting === true}
                onChange={() => {
                  setIsExisting(true);
                  setSelected(null);
                  setQuery("");
                }}
              />
              Yes
            </label>
            <label className="row" style={{ alignItems: "center", gap: 8 }}>
              <input
                type="radio"
                name="existing"
                checked={isExisting === false}
                onChange={() => {
                  setIsExisting(false);
                  setSelected(null);
                  setQuery("");
                }}
              />
              No
            </label>
            <p className="small muted" style={{ marginTop: 6 }}>
              You must choose one.
            </p>
          </fieldset>

          {/* Sales rep (required) */}
          <div>
            <label>Sales Rep *</label>
            <select
              name="salesRep"
              required
              value={salesRep}
              onChange={(e) => setSalesRep(e.target.value)}
            >
              <option value="">— Select Sales Rep —</option>
              {reps.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* existing picker OR free text */}
        {isExisting ? (
          <>
            <div>
              <label>Customer *</label>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null); // clear selection if user edits text
                }}
                placeholder="Start typing: salon name, contact, town, postcode…"
              />
              {/* suggestion list */}
              {results.length > 0 && (
                <div
                  className="card"
                  style={{
                    marginTop: 6,
                    maxHeight: 220,
                    overflow: "auto",
                    borderStyle: "dashed",
                  }}
                >
                  {results.map((c) => (
                    <div
                      key={c.id}
                      className="row"
                      style={{
                        padding: "8px 6px",
                        cursor: "pointer",
                        justifyContent: "space-between",
                        borderBottom: "1px solid var(--border)",
                      }}
                      onClick={() => pickCustomer(c)}
                    >
                      <div>
                        <div className="small">
                          <b>{c.salonName}</b> — {c.customerName}
                        </div>
                        <div className="small muted">
                          {[c.town, c.county, c.postCode].filter(Boolean).join(", ")}
                        </div>
                      </div>
                      <div className="small muted">{c.salesRep || ""}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* show selected details + hidden input for ID */}
            {selected && (
              <>
                <input type="hidden" name="customerId" value={selected.id} />
                <div className="card">
                  <b>Customer details</b>
                  <div className="small" style={{ marginTop: 6 }}>
                    {addressBlock.lines || "-"}
                    <br />
                    {addressBlock.contact || "-"}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* New lead—free text fields */}
            <div className="grid grid-2">
              <div>
                <label>Customer / Salon Name *</label>
                <input name="customerName" required placeholder="Who is calling?" />
              </div>
              <div>
                <label>Contact Phone</label>
                <input name="contactPhone" placeholder="Phone" />
              </div>
            </div>
            <div>
              <label>Contact Email</label>
              <input name="contactEmail" type="email" placeholder="Email" />
            </div>
          </>
        )}

        {/* call meta */}
        <div className="grid grid-2">
          <div>
            <label>Call Type</label>
            <select name="callType" defaultValue="">
              <option value="">— Select —</option>
              <option>Enquiry</option>
              <option>Order</option>
              <option>Complaint</option>
              <option>Support</option>
            </select>
          </div>

          <div>
            <label>Follow-up (optional)</label>
            <input type="datetime-local" name="followUpAt" />
          </div>
        </div>

        <div>
          <label>Summary *</label>
          <textarea name="summary" rows={3} required placeholder="What was discussed?" />
        </div>

        <div>
          <label>Outcome</label>
          <select name="outcome" defaultValue="">
            <option value="">— Select —</option>
            <option>Left message</option>
            <option>Resolved</option>
            <option>Call back scheduled</option>
            <option>Escalated</option>
          </select>
        </div>

        <div className="right">
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save Call"}
          </button>
        </div>
      </form>
    </div>
  );
}
