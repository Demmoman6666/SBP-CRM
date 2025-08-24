// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Rep = { id: string; name: string };

// Matches the fields your /api/customers GET returns (select block)
type CustomerLite = {
  id: string;
  salonName: string | null;
  customerName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
  customerEmailAddress: string | null;
  customerNumber: string | null;
  customerTelephone: string | null;
  salesRep: string | null;
};

export default function NewCallPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then(setReps)
      .catch(() => setReps([]));
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------- Predictive customer search (only enhancement) ----------------
  const [isExisting, setIsExisting] = useState<null | boolean>(null);
  const [query, setQuery] = useState("");                  // text in the Customer input
  const [results, setResults] = useState<CustomerLite[]>([]);
  const [picked, setPicked] = useState<CustomerLite | null>(null);
  const [openList, setOpenList] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  // close dropdown when clicking outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpenList(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // debounced search
  useEffect(() => {
    if (!isExisting) return;                 // only search when "existing" = yes
    setPicked(null);                         // typing clears selection
    if (timer.current) window.clearTimeout(timer.current);
    if (!query || query.trim().length < 2) {
      setResults([]);
      setOpenList(false);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/customers?search=${encodeURIComponent(query)}&take=8`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("Search failed");
        const data: CustomerLite[] = await res.json();
        setResults(data);
        setOpenList(true);
      } catch {
        setResults([]);
        setOpenList(false);
      } finally {
        setLoading(false);
      }
    }, 250) as unknown as number;
  }, [query, isExisting]);

  function pickCustomer(c: CustomerLite) {
    setPicked(c);
    setQuery(
      `${c.salonName ?? ""}${c.salonName && c.customerName ? " — " : ""}${c.customerName ?? ""}`
    );
    setOpenList(false);
  }

  function fmtAddress(c: CustomerLite | null) {
    if (!c) return "-";
    const parts = [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean);
    return parts.length ? parts.join(", ") : "-";
  }
  // -------------------------------------------------------------------------------

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    // read existing radio
    const existingRaw = fd.get("isExistingCustomer");
    const existingBool =
      String(existingRaw ?? "").toLowerCase() === "true" ? true :
      String(existingRaw ?? "").toLowerCase() === "false" ? false : null;

    // client guards (unchanged + minimal extra check for predictive)
    if (!fd.get("salesRep")) {
      setError("Please select a Sales Rep.");
      return;
    }
    if (!fd.get("summary")) {
      setError("Summary is required.");
      return;
    }
    // require a picked customer when existing = yes
    if (existingBool === true) {
      const id = fd.get("customerId") as string | null;
      if (!id) {
        setError("Please pick a customer from the suggestions.");
        return;
      }
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/calls", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save call");
      if (json.redirectTo) window.location.href = json.redirectTo;
      else window.location.href = "/";
    } catch (err: any) {
      setError(err?.message || "Failed to save call");
    } finally {
      setSubmitting(false);
    }
  }

  const timestamp = useMemo(() => {
    const d = new Date();
    return d.toLocaleString();
  }, []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Log Call</h1>
        <span className="small muted">Timestamp: {timestamp}</span>
      </section>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
        <div className="grid grid-2">
          <div className="field">
            <label>Is this an existing customer? (required)</label>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="isExistingCustomer"
                  value="true"
                  required
                  onChange={() => {
                    setIsExisting(true);
                    setQuery("");
                    setPicked(null);
                    setResults([]);
                  }}
                />
                Yes
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="isExistingCustomer"
                  value="false"
                  onChange={() => {
                    setIsExisting(false);
                    setResults([]);
                    setPicked(null);
                  }}
                />
                No
              </label>
            </div>
          </div>

          <div className="field">
            <label>Sales Rep (required)</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>— Select a Sales Rep —</option>
              {reps.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="field" ref={boxRef}>
            <label>Customer*</label>
            <input
              name="customer"
              placeholder="Type to search or free-type for new lead"
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => isExisting && query.trim().length >= 2 && setOpenList(true)}
              autoComplete="off"
            />
            {/* Hidden field to carry the picked ID (used by /api/calls) */}
            <input type="hidden" name="customerId" value={picked?.id ?? ""} />

            <div className="form-hint">
              {isExisting
                ? "Pick from suggestions for existing."
                : "Free-type for a lead."}
            </div>

            {/* Suggestions dropdown */}
            {openList && isExisting && results.length > 0 && (
              <div
                className="card"
                style={{
                  position: "absolute",
                  zIndex: 20,
                  left: 16,         // align with input padding in your design
                  right: 16,
                  marginTop: 6,
                  maxHeight: 260,
                  overflowY: "auto",
                  padding: 0,
                }}
              >
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {results.map((c) => (
                    <li
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickCustomer(c)}
                      style={{
                        padding: "10px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {c.salonName || c.customerName || "(no name)"}
                      </div>
                      <div className="small muted">
                        {c.customerName ? `Contact: ${c.customerName}` : ""}
                        {c.customerName &&
                        (c.customerTelephone || c.customerNumber || c.customerEmailAddress)
                          ? " • "
                          : ""}
                        {c.customerTelephone || c.customerNumber || ""}
                        {c.customerEmailAddress ? ` • ${c.customerEmailAddress}` : ""}
                      </div>
                      <div className="small">{fmtAddress(c)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Selected customer preview */}
            {isExisting && picked && (
              <div className="card" style={{ marginTop: 8 }}>
                <b>Customer details</b>
                <p className="small" style={{ marginTop: 6 }}>
                  {picked.salonName || "-"}
                  <br />
                  {fmtAddress(picked)}
                  <br />
                  {picked.customerEmailAddress || "-"}
                  {picked.customerTelephone || picked.customerNumber
                    ? ` • ${picked.customerTelephone || picked.customerNumber}`
                    : ""}
                </p>
              </div>
            )}

            {/* “no results” hint */}
            {isExisting && query && !loading && results.length === 0 && (
              <div className="form-hint" style={{ marginTop: 6 }}>
                No matches found.
              </div>
            )}
          </div>

          <div className="field">
            <label>Outcome</label>
            <select name="outcome" defaultValue="">
              <option value="" disabled>— Select —</option>
              <option>Sale</option>
              <option>No Sale</option>
              <option>Appointment booked</option>
              <option>Demo Booked</option>
            </select>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>Call Type</label>
            <select name="callType" defaultValue="">
              <option value="" disabled>— Select —</option>
              <option>Cold Call</option>
              <option>Booked Call</option>
              <option>Booked Demo</option>
            </select>
          </div>

          <div className="field">
            <label>Follow-up (date & time)</label>
            <div className="input-group">
              <input type="date" name="followUpAt" />
              <input type="time" name="followUpTime" />
            </div>
          </div>
        </div>

        <div className="field">
          <label>Summary (required)</label>
          <textarea name="summary" rows={4} placeholder="What was discussed?" required />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="right row" style={{ gap: 8 }}>
          <a href="/" className="btn" style={{ background: "#f3f4f6" }}>Cancel</a>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save Call"}
          </button>
        </div>
      </form>
    </div>
  );
}
