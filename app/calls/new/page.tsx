// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Rep = { id: string; name: string };
type CustomerLite = {
  id: string;
  salonName: string;
  customerName: string | null;
  customerTelephone: string | null;
  customerEmailAddress: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  county: string | null;
  postCode: string | null;
};
type BrandRow = { id: string; name: string };

export default function NewCallPage() {
  /* ====== data ====== */
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then(setReps)
      .catch(() => setReps([]));
  }, []);

  const [brands, setBrands] = useState<BrandRow[]>([]); // competitor brands (Brands used)
  const [stockedBrands, setStockedBrands] = useState<BrandRow[]>([]); // stocked brands (discussed)
  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then(setBrands)
      .catch(() => setBrands([]));
    fetch("/api/stocked-brands")
      .then((r) => r.json())
      .then(setStockedBrands)
      .catch(() => setStockedBrands([]));
  }, []);

  /* ====== predictive customer search ====== */
  const [existing, setExisting] = useState<"true" | "false">("true");
  const [custQuery, setCustQuery] = useState("");
  const [custOpts, setCustOpts] = useState<CustomerLite[]>([]);
  const [showOpts, setShowOpts] = useState(false);
  const [pickedCustomer, setPickedCustomer] = useState<CustomerLite | null>(
    null
  );

  const inputWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (existing !== "true") {
      setCustOpts([]);
      setShowOpts(false);
      return;
    }
    const q = custQuery.trim();
    if (q.length < 2) {
      setCustOpts([]);
      setShowOpts(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setCustOpts(data || []);
        setShowOpts(true);
      } catch {
        setCustOpts([]);
        setShowOpts(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [custQuery, existing]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        inputWrapRef.current &&
        !inputWrapRef.current.contains(e.target as Node)
      ) {
        setShowOpts(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  /* ====== time + duration ====== */
  const [startTime, setStartTime] = useState<string>("");
  const [finishTime, setFinishTime] = useState<string>("");
  const [duration, setDuration] = useState<number | "">("");

  useEffect(() => {
    if (!startTime || !finishTime) {
      setDuration("");
      return;
    }
    const [sh, sm] = startTime.split(":").map((n) => parseInt(n, 10));
    const [eh, em] = finishTime.split(":").map((n) => parseInt(n, 10));
    let mins = (eh - sh) * 60 + (em - sm);
    if (mins < 0) mins += 24 * 60; // cross-midnight fallback
    setDuration(mins);
  }, [startTime, finishTime]);

  const setNow = (setter: (v: string) => void) => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setter(`${hh}:${mm}`);
  };

  /* ====== multi-select checkboxes -> csv ====== */
  const [brandsUsed, setBrandsUsed] = useState<string[]>([]); // from /api/brands
  const [brandsDiscussed, setBrandsDiscussed] = useState<string[]>([]); // from /api/stocked-brands

  const toggleIn = (arr: string[], setArr: (v: string[]) => void, id: string) =>
    setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  /* ====== submit ====== */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);

    // basic client guards
    if (!fd.get("salesRep")) {
      setError("Please select a Sales Rep.");
      return;
    }
    if (!fd.get("summary")) {
      setError("Summary is required.");
      return;
    }
    if (existing === "true" && !pickedCustomer) {
      setError("Please pick a customer from the suggestions.");
      return;
    }

    // inject computed + selections
    if (pickedCustomer) fd.set("customerId", pickedCustomer.id);
    if (startTime) fd.set("startTime", startTime);
    if (finishTime) fd.set("endTime", finishTime);
    if (typeof duration === "number") fd.set("durationMinutes", String(duration));

    fd.set("brandsDiscussedCsv", brandsDiscussed.join(","));
    fd.set("brandsUsedCsv", brandsUsed.join(","));

    try {
      setSubmitting(true);
      const res = await fetch("/api/calls", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save call");
      if (json.redirectTo) window.location.href = json.redirectTo;
      else window.location.href = "/";
    } catch (err: any) {
      setError(err?.message || "Failed to save call");
    } finally {
      setSubmitting(false);
    }
  }

  const timestamp = useMemo(() => new Date().toLocaleString(), []);

  /* ====== UI ====== */
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section
        className="card row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <h1>Log Call</h1>
        <span className="small muted">Timestamp: {timestamp}</span>
      </section>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
        {/* Row 1: Existing toggle + Rep */}
        <div className="grid grid-2">
          <div className="field">
            <label>Is this an existing customer? (required)</label>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="isExistingCustomer"
                  value="true"
                  checked={existing === "true"}
                  onChange={() => {
                    setExisting("true");
                    setPickedCustomer(null);
                  }}
                  required
                />
                Yes
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="isExistingCustomer"
                  value="false"
                  checked={existing === "false"}
                  onChange={() => {
                    setExisting("false");
                    setPickedCustomer(null);
                    setCustQuery("");
                  }}
                />
                No
              </label>
            </div>
          </div>

          <div className="field">
            <label>Sales Rep (required)</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>
                — Select a Sales Rep —
              </option>
              {reps.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Customer + Outcome */}
        <div className="grid grid-2">
          <div className="field" ref={inputWrapRef} style={{ position: "relative" }}>
            <label>Customer*</label>
            <input
              name="customer"
              placeholder={
                existing === "true"
                  ? "Type to search…"
                  : "Type a salon or contact for a new lead"
              }
              value={custQuery}
              onChange={(e) => {
                setCustQuery(e.target.value);
                setPickedCustomer(null);
              }}
              required
            />
            <div className="form-hint">
              {existing === "true"
                ? "Pick from suggestions for existing."
                : "Free-type to log a lead."}
            </div>

            {existing === "true" && showOpts && custOpts.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  zIndex: 20,
                  top: "100%",
                  left: 0,
                  marginTop: 6,
                  width: "min(560px, 100%)",
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  boxShadow: "var(--shadow)",
                  overflow: "hidden",
                }}
              >
                {custOpts.map((c) => {
                  const addr = [
                    c.addressLine1,
                    c.addressLine2,
                    c.town,
                    c.county,
                    c.postCode,
                  ]
                    .filter(Boolean)
                    .join(", ");
                return (
                    <button
                      key={c.id}
                      type="button"
                      className="row"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        gap: 10,
                        borderBottom: "1px solid var(--border)",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setPickedCustomer(c);
                        setCustQuery(`${c.salonName} — ${c.customerName || ""}`.trim());
                        setShowOpts(false);
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{c.salonName}</div>
                      <div className="small" style={{ color: "var(--muted)" }}>
                        {c.customerName ? `Contact: ${c.customerName}` : ""}
                        {c.customerTelephone ? ` • ${c.customerTelephone}` : ""}
                        {c.customerEmailAddress ? ` • ${c.customerEmailAddress}` : ""}
                        {addr ? ` • ${addr}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* chosen customer confirmation */}
            {pickedCustomer && (
              <div
                className="card"
                style={{
                  background: "#fafafa",
                  borderColor: "var(--border)",
                  marginTop: 8,
                }}
              >
                <div style={{ fontWeight: 700 }}>{pickedCustomer.salonName}</div>
                <div className="small">
                  {pickedCustomer.customerName ? `Contact: ${pickedCustomer.customerName}` : ""}
                </div>
                <div className="small">
                  {pickedCustomer.customerTelephone || "-"}
                  {pickedCustomer.customerEmailAddress
                    ? ` • ${pickedCustomer.customerEmailAddress}`
                    : ""}
                </div>
                <div className="small">
                  {[
                    pickedCustomer.addressLine1,
                    pickedCustomer.addressLine2,
                    pickedCustomer.town,
                    pickedCustomer.county,
                    pickedCustomer.postCode,
                  ]
                    .filter(Boolean)
                    .join(", ") || "-"}
                </div>
                <div className="right" style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setPickedCustomer(null);
                      setCustQuery("");
                    }}
                    style={{ background: "#eee" }}
                  >
                    Change
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <label>Outcome</label>
            <select name="outcome" defaultValue="">
              <option value="" disabled>
                — Select —
              </option>
              <option>Sale</option>
              <option>No Sale</option>
              <option>Appointment booked</option>
              <option>Demo Booked</option>
            </select>
          </div>
        </div>

        {/* Row 3: Call type + Times & duration */}
        <div className="grid grid-2">
          <div className="field">
            <label>Call Type</label>
            <select name="callType" defaultValue="">
              <option value="" disabled>
                — Select —
              </option>
              <option>Cold Call</option>
              <option>Booked Call</option>
              <option>Booked Demo</option>
            </select>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field">
              <label>Start Time</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="time"
                  name="startTime_local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <button type="button" className="primary" onClick={() => setNow(setStartTime)}>
                  Now
                </button>
              </div>
            </div>
            <div className="field">
              <label>Finish Time</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="time"
                  name="endTime_local"
                  value={finishTime}
                  onChange={(e) => setFinishTime(e.target.value)}
                />
                <button type="button" className="primary" onClick={() => setNow(setFinishTime)}>
                  Now
                </button>
              </div>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Total Duration (mins)</label>
              <input value={duration === "" ? "" : String(duration)} readOnly placeholder="—" />
            </div>
          </div>
        </div>

        {/* Row 4: Brands discussed (stocked) + Brands used (competitor) */}
        <div className="grid grid-2">
          <div className="field">
            <label>What brands did you discuss? (Stocked Brands)</label>
            <div
              className="card"
              style={{ padding: 10, borderColor: "var(--border)", background: "#fff" }}
            >
              {stockedBrands.length === 0 ? (
                <div className="small muted">No stocked brands yet.</div>
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 8,
                  }}
                >
                  {stockedBrands.map((b) => (
                    <label
                      key={b.id}
                      className="row"
                      style={{
                        gap: 8,
                        padding: "6px 8px",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={brandsDiscussed.includes(b.id)}
                        onChange={() => toggleIn(brandsDiscussed, setBrandsDiscussed, b.id)}
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>Brands used (Competitor Brands)</label>
            <div
              className="card"
              style={{ padding: 10, borderColor: "var(--border)", background: "#fff" }}
            >
              {brands.length === 0 ? (
                <div className="small muted">No brands yet.</div>
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 8,
                  }}
                >
                  {brands.map((b) => (
                    <label
                      key={b.id}
                      className="row"
                      style={{
                        gap: 8,
                        padding: "6px 8px",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={brandsUsed.includes(b.id)}
                        onChange={() => toggleIn(brandsUsed, setBrandsUsed, b.id)}
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 5: Follow-up */}
        <div className="grid grid-2">
          <div className="field">
            <label>Follow-up (date & time)</label>
            <div className="input-group">
              <input type="date" name="followUpAt" />
              <input type="time" name="followUpTime" />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="field">
          <label>Summary (required)</label>
          <textarea
            name="summary"
            rows={4}
            placeholder="What was discussed?"
            required
          />
        </div>

        {/* hidden injectors for CSV selections (so APIs don’t need changes) */}
        <input type="hidden" name="brandsDiscussedCsv" value={brandsDiscussed.join(",")} />
        <input type="hidden" name="brandsUsedCsv" value={brandsUsed.join(",")} />
        {/* hidden IDs for server (only if picked) */}
        <input type="hidden" name="customerId" value={pickedCustomer?.id || ""} />
        <input type="hidden" name="startTime" value={startTime} />
        <input type="hidden" name="endTime" value={finishTime} />
        <input
          type="hidden"
          name="durationMinutes"
          value={typeof duration === "number" ? String(duration) : ""}
        />

        {error && <div className="form-error">{error}</div>}

        <div className="right row" style={{ gap: 8 }}>
          <a href="/" className="btn" style={{ background: "#f3f4f6" }}>
            Cancel
          </a>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save Call"}
          </button>
        </div>
      </form>
    </div>
  );
}
