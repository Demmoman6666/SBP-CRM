// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

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
};

type SalesRepLite = { id: string; name: string };

export default function LogCallPage() {
  // form state
  const [isExisting, setIsExisting] = useState<boolean | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);

  // typed address block (ALWAYS an object)
  const [addressBlock, setAddressBlock] = useState<{ lines: string; contact: string }>({
    lines: "",
    contact: "",
  });

  // suggestions
  const [suggestions, setSuggestions] = useState<CustomerLite[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // sales reps
  const [salesReps, setSalesReps] = useState<SalesRepLite[]>([]);
  const [loadingReps, setLoadingReps] = useState(true);

  // ui messages
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // load reps once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/sales-reps", { cache: "no-store" });
        const data = (await res.json()) as SalesRepLite[] | { error?: string };
        if (mounted) {
          if (Array.isArray(data)) setSalesReps(data);
          setLoadingReps(false);
        }
      } catch {
        if (mounted) setLoadingReps(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // debounce predictive search
  useEffect(() => {
    if (!isExisting) return; // only when "Yes"
    if (customerQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    setSearching(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const t = setTimeout(async () => {
      try {
        const u = new URL("/api/customers", window.location.origin);
        u.searchParams.set("search", customerQuery.trim());
        u.searchParams.set("take", "10");

        const res = await fetch(u.toString(), {
          signal: ctrl.signal,
          headers: { "accept": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as CustomerLite[];
        setSuggestions(data);
      } catch {
        /* ignore */
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [customerQuery, isExisting]);

  const pickLabel = (c: CustomerLite) =>
    [c.salonName, c.customerName].filter(Boolean).join(" — ") || "(unnamed)";

  function handlePickCustomer(c: CustomerLite) {
    setCustomerId(c.id);
    setCustomerQuery(pickLabel(c));
    setShowSuggest(false);
    // Fill address & contact block
    setAddressBlock({
      lines: [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode]
        .filter(Boolean)
        .join("\n"),
      contact: [c.customerNumber || c.customerTelephone, c.customerEmailAddress]
        .filter(Boolean)
        .join(" • "),
    });
  }

  // Reset customer details if they toggle "No"
  useEffect(() => {
    if (isExisting === false) {
      setCustomerId(null);
      setCustomerQuery("");
      setSuggestions([]);
      setAddressBlock({ lines: "", contact: "" });
      setShowSuggest(false);
    }
  }, [isExisting]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    const fd = new FormData(e.currentTarget);

    // validations
    if (isExisting === null) {
      setError("Please choose if this is an existing customer.");
      return;
    }
    const salesRep = String(fd.get("salesRep") || "").trim();
    if (!salesRep) {
      setError("Sales Rep is required.");
      return;
    }
    const summary = String(fd.get("summary") || "").trim();
    if (!summary) {
      setError("Summary is required.");
      return;
    }

    // payload
    const payload: any = {
      isExistingCustomer: isExisting,
      salesRep,
      callType: String(fd.get("callType") || "") || null,
      outcome: String(fd.get("outcome") || "") || null,
      followUpAt: String(fd.get("followUpAt") || "") || null, // API will parse
      summary,
    };

    if (isExisting) {
      if (!customerId) {
        setError("Pick a customer from the list.");
        return;
      }
      payload.customerId = customerId;
    } else {
      payload.customerName = String(fd.get("customerName") || "") || null;
      payload.contactPhone = String(fd.get("contactPhone") || "") || null;
      payload.contactEmail = String(fd.get("contactEmail") || "") || null;
    }

    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await res.json();

      if (!res.ok) {
        setError(out?.error || "Failed to save call.");
        return;
      }

      // success
      if (out?.redirectTo) {
        window.location.href = out.redirectTo as string;
        return;
      }
      setOkMsg("Call saved.");
      formRef.current?.reset();
      setIsExisting(null);
      setCustomerId(null);
      setCustomerQuery("");
      setAddressBlock({ lines: "", contact: "" });
      setSuggestions([]);
      setShowSuggest(false);
    } catch (err: any) {
      setError(err?.message || "Failed to save call.");
    }
  }

  const canSearch = isExisting === true;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Log Call</h1>
        <Link href="/" className="small">← Back</Link>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="card grid" style={{ gap: 12 }}>
        {/* Existing customer? */}
        <div className="grid grid-2">
          <div>
            <label>Is this an existing customer? <span className="small muted">(required)</span></label>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="existing"
                  value="yes"
                  checked={isExisting === true}
                  onChange={() => setIsExisting(true)}
                />
                Yes
              </label>
              <label className="row" style={{ alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="existing"
                  value="no"
                  checked={isExisting === false}
                  onChange={() => setIsExisting(false)}
                />
                No
              </label>
            </div>
          </div>

          {/* Sales Rep (required) */}
          <div>
            <label>Sales Rep <span className="small muted">(required)</span></label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>
                {loadingReps ? "Loading…" : "Select a Sales Rep"}
              </option>
              {salesReps.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Existing → predictive search + address */}
        {canSearch ? (
          <div className="grid grid-2" style={{ alignItems: "start" }}>
            <div style={{ position: "relative" }}>
              <label>Customer (type to search)</label>
              <input
                type="search"
                placeholder="e.g. Salon name or customer name"
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setShowSuggest(true);
                }}
                onFocus={() => setShowSuggest(true)}
                autoComplete="off"
              />
              {/* Hidden field that mirrors selected id (useful for debugging) */}
              <input type="hidden" name="customerId" value={customerId || ""} />

              {/* Suggestion panel */}
              {showSuggest && (customerQuery.trim().length >= 2) && (
                <div
                  className="card"
                  style={{
                    position: "absolute",
                    zIndex: 30,
                    width: "100%",
                    marginTop: 6,
                    maxHeight: 260,
                    overflowY: "auto",
                    padding: 0,
                  }}
                >
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                    <b>{searching ? "Searching…" : "Results"}</b>
                  </div>

                  {suggestions.length === 0 ? (
                    <div className="small" style={{ padding: "10px 12px" }}>
                      {searching ? "…" : "No matches"}
                    </div>
                  ) : (
                    suggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="row"
                        onClick={() => handlePickCustomer(c)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          gap: 8,
                          padding: "10px 12px",
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>{pickLabel(c)}</div>
                          <div className="small muted">
                            {[c.addressLine1, c.town, c.county, c.postCode]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        </div>
                      </button>
                    ))
                  )}

                  <div className="small" style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
                    Click a result to select.
                  </div>
                </div>
              )}
            </div>

            {/* Selected customer's details */}
            <div>
              <label>Customer details</label>
              <div className="card small" style={{ whiteSpace: "pre-line" }}>
                {addressBlock.lines || "-"}
                <br />
                {addressBlock.contact || "-"}
              </div>
            </div>
          </div>
        ) : isExisting === false ? (
          // Not existing → free text fields
          <div className="grid grid-2">
            <div>
              <label>Customer / Business Name</label>
              <input name="customerName" placeholder="Name" />
            </div>
            <div className="grid">
              <div>
                <label>Contact Phone</label>
                <input name="contactPhone" placeholder="07..., 02..." />
              </div>
              <div>
                <label>Contact Email</label>
                <input type="email" name="contactEmail" placeholder="name@example.com" />
              </div>
            </div>
          </div>
        ) : null}

        {/* meta */}
        <div className="grid grid-2">
          <div>
            <label>Call Type</label>
            <input name="callType" placeholder="e.g. Order, Support, Enquiry" />
          </div>
          <div>
            <label>Outcome</label>
            <input name="outcome" placeholder="e.g. Left message, Resolved, Order placed" />
          </div>
        </div>

        <div className="grid grid-2">
          <div>
            <label>Follow-up (date & time)</label>
            <input type="datetime-local" name="followUpAt" />
          </div>
        </div>

        <div>
          <label>Summary <span className="small muted">(required)</span></label>
          <textarea name="summary" rows={4} placeholder="What was discussed?" required />
        </div>

        {error && <div className="form-error">{error}</div>}
        {okMsg && <div className="form-success">{okMsg}</div>}

        <div className="right" style={{ gap: 8 }}>
          <Link href="/" className="btn">Cancel</Link>
          <button className="primary" type="submit">Save Call</button>
        </div>
      </form>
    </div>
  );
}
