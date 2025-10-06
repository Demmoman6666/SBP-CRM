// app/calls/new/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/* Types */
type Rep = { id: string; name: string };
type CustomerHit = {
  id: string;
  salonName: string | null;
  customerName: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postCode?: string | null;
  customerTelephone?: string | null;
  customerEmailAddress?: string | null;
};
type BrandOpt = { id: string; name: string };

/* Helpers */
function fmtCustomerLine(c?: CustomerHit | null) {
  if (!c) return "";
  const a = c.salonName ?? "";
  const b = c.customerName ?? "";
  const s = `${a}${a && b ? " — " : ""}${b}`.trim();
  return s || a || b || "";
}
function addressLines(c: CustomerHit) {
  return [c.addressLine1, c.addressLine2, c.town, c.county, c.postCode].filter(Boolean) as string[];
}
function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return NaN;
}
function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/* Normalize reps from either ["Name", ...] or [{id,name}, ...] or { ok, reps: [...] } */
function normalizeReps(payload: any): Rep[] {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.reps)
    ? payload.reps
    : [];

  return arr.map((r: any): Rep =>
    typeof r === "string"
      ? { id: r, name: r }
      : { id: String(r.id ?? r.name ?? ""), name: String(r.name ?? r.id ?? "") }
  ).filter((r: Rep) => r.name);
}

export default function NewCallPage() {
  /* Sales reps */
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setReps(normalizeReps(j)))
      .catch(() => setReps([]));
  }, []);

  /* Brand lists (only those toggled to be visible in Global Settings) */
  const [stockedBrands, setStockedBrands] = useState<BrandOpt[]>([]);
  const [competitorBrands, setCompetitorBrands] = useState<BrandOpt[]>([]);
  useEffect(() => {
    const norm = (x: any): BrandOpt => ({ id: String(x.id), name: String(x.name) });
    Promise.all([
      fetch("/api/settings/visible-stocked-brands", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch("/api/settings/visible-competitor-brands", { cache: "no-store" }).then((r) => r.json()).catch(() => []),
    ])
      .then(([s, b]) => {
        const ss = Array.isArray(s) ? s : Array.isArray((s as any)?.brands) ? (s as any).brands : [];
        const bb = Array.isArray(b) ? b : Array.isArray((b as any)?.brands) ? (b as any).brands : [];
        setStockedBrands(ss.map(norm));
        setCompetitorBrands(bb.map(norm));
      })
      .catch(() => {
        setStockedBrands([]);
        setCompetitorBrands([]);
      });
  }, []);

  /* Existing customer toggle */
  const [isExisting, setIsExisting] = useState<boolean>(true);

  /* Predictive search */
  const [custTerm, setCustTerm] = useState("");
  const [custHits, setCustHits] = useState<CustomerHit[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const [custSelected, setCustSelected] = useState<CustomerHit | null>(null);
  const custWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (custWrapRef.current && !custWrapRef.current.contains(e.target as Node)) setCustOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!isExisting) {
      setCustHits([]);
      setCustSelected(null);
      return;
    }
    const q = custTerm.trim();
    if (q.length < 2) {
      setCustHits([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&take=8`, { signal: ac.signal });
        const j = await res.json().catch(() => null);
        setCustHits(Array.isArray(j) ? (j as CustomerHit[]) : []);
        setCustOpen(true);
      } catch {
        setCustHits([]);
      }
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [custTerm, isExisting]);

  function handlePickCustomer(c: CustomerHit) {
    setCustSelected(c);
    setCustTerm(fmtCustomerLine(c));
    setCustOpen(false);
  }
  function clearPickedCustomer() {
    setCustSelected(null);
    setCustTerm("");
    setCustHits([]);
    setCustOpen(false);
  }

  /* Times + duration */
  const [start, setStart] = useState<string>("");
  const [finish, setFinish] = useState<string>("");
  const duration = useMemo(() => {
    if (!start || !finish) return "";
    const s = toMinutes(start);
    const e = toMinutes(finish);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return "";
    const diff = e >= s ? e - s : e + 24 * 60 - s; // overnight
    return String(diff);
  }, [start, finish]);

  /* NEW — Mandatory geolocation */
  type GeoStatus = "prompt" | "fetching" | "granted" | "denied" | "unsupported";
  const [geoStatus, setGeoStatus] = useState<GeoStatus>("prompt");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [geoTs, setGeoTs] = useState<string | null>(null);
  const insecureContext =
    typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost";

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) { setGeoStatus("unsupported"); return; }

    // Check permission state where supported
    // @ts-ignore
    if (navigator.permissions?.query) {
      // @ts-ignore
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((p: any) => {
        setGeoStatus(p.state as GeoStatus);
        p.onchange = () => setGeoStatus(p.state as GeoStatus);
      }).catch(() => {});
    }

    // Auto-request once on load if secure context (will show prompt)
    if (!insecureContext) requestLocationOnce();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestLocationOnce() {
    if (!("geolocation" in navigator)) { setGeoStatus("unsupported"); return; }
    setGeoStatus("fetching");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus("granted");
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setAcc(Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null);
        setGeoTs(new Date().toISOString());
      },
      () => { setGeoStatus("denied"); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* Submission state */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Hard gate: must have coords
    if (insecureContext) {
      setError("Location requires HTTPS (or localhost in dev). Open the HTTPS site to log a call.");
      return;
    }
    if (lat == null || lng == null) {
      // try one more time to prompt
      requestLocationOnce();
      setError("We need your location to log this call. Tap “Enable location” and allow access.");
      return;
    }

    const fd = new FormData(e.currentTarget);

    if (!fd.get("salesRep")) { setError("Please select a Sales Rep."); return; }
    if (!fd.get("summary")) { setError("Summary is required."); return; }

    // require start & finish
    const s = String(fd.get("startTime") || "").trim();
    const f = String(fd.get("endTime") || "").trim();
    if (!s || !f) { setError("Start Time and Finish Time are required."); return; }

    const existing = fd.get("isExistingCustomer") === "true";
    if (existing && !fd.get("customerId")) {
      setError("Please pick a customer from the suggestions.");
      return;
    }
    if (!existing) {
      const typed = (fd.get("customer") || "").toString().trim();
      if (!typed) { setError("Please enter a customer/lead name."); return; }
      fd.set("customerName", typed);
    }

    // Combine follow-up date + time
    const fDate = (fd.get("followUpAt") || "").toString().trim();
    const fTime = (fd.get("followUpTime") || "").toString().trim();
    if (fDate && fTime) fd.set("followUpAt", `${fDate}T${fTime}`);
    fd.delete("followUpTime");

    // Add geo fields (hidden inputs are present too, but set here to be sure)
    fd.set("latitude", String(lat));
    fd.set("longitude", String(lng));
    if (acc != null) fd.set("accuracyM", String(Math.round(acc)));
    if (geoTs) fd.set("geoCollectedAt", geoTs);

    try {
      setSubmitting(true);
      const res = await fetch("/api/calls", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.error || "Failed to save call");
      if ((json as any).redirectTo) window.location.href = (json as any).redirectTo;
      else window.location.href = "/";
    } catch (err: any) {
      setError(err?.message || "Failed to save call");
    } finally {
      setSubmitting(false);
    }
  }

  const timestamp = useMemo(() => new Date().toLocaleString(), []);

  const geoBadge =
    insecureContext ? "unavailable (use HTTPS or localhost)" :
    geoStatus === "fetching" ? "capturing…" :
    geoStatus;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Log Call</h1>
        <span className="small muted">Timestamp: {timestamp}</span>
      </section>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
        {/* MANDATORY location capture */}
        <div className="field" style={{ marginBottom: 4 }}>
          <label>Location (required)</label>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="small" style={{ color: geoStatus === "denied" ? "var(--danger,#b91c1c)" : "var(--muted)" }}>
              {lat != null && lng != null
                ? `Captured: ${lat.toFixed(5)}, ${lng.toFixed(5)}${acc != null ? ` • ±${Math.round(acc)}m` : ""}`
                : `Location: ${geoBadge}`}
            </span>
            <button type="button" className="btn" onClick={requestLocationOnce}>
              {lat == null ? "Enable location" : "Refresh location"}
            </button>
            {insecureContext && (
              <span className="small muted">Open the HTTPS site to enable geolocation.</span>
            )}
          </div>

          {/* Hidden fields sent to server */}
          <input type="hidden" name="latitude" value={lat ?? ""} />
          <input type="hidden" name="longitude" value={lng ?? ""} />
          <input type="hidden" name="accuracyM" value={acc ?? ""} />
          <input type="hidden" name="geoCollectedAt" value={geoTs ?? ""} />
        </div>

        {/* Row: Existing? + Rep */}
        <div className="grid grid-2">
          <div className="field">
            <label>Is this an existing customer? (required)</label>
            <div className="row" style={{ gap: 16 }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="radio"
                  name="isExistingCustomer"
                  value="true"
                  checked={isExisting}
                  onChange={() => {
                    setIsExisting(true);
                    setCustTerm("");
                    setCustSelected(null);
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
                  checked={!isExisting}
                  onChange={() => {
                    setIsExisting(false);
                    setCustHits([]);
                    setCustSelected(null);
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
                <option key={r.id || r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* NEW: Call Type directly under Sales Rep (aligned in the right column) */}
        <div className="grid grid-2">
          <div />{/* keeps alignment */}
          <div className="field">
            <label>Call Type</label>
            <select name="callType" defaultValue="">
              <option value="" disabled>— Select —</option>
              <option>Cold Call</option>
              <option>Booked Call</option>
              <option>Booked Demo</option>
            </select>
          </div>
        </div>

        {/* Row: Customer + Outcome */}
        <div className="grid grid-2">
          <div className="field" ref={custWrapRef} style={{ position: "relative" }}>
            <label>Customer*</label>
            <input
              name="customer"
              placeholder={isExisting ? "Type to search" : "Type a name for this lead"}
              value={custTerm}
              onChange={(e) => {
                setCustTerm(e.target.value);
                if (custSelected) setCustSelected(null);
                if (isExisting) setCustOpen(true);
              }}
              onFocus={() => {
                if (isExisting && custTerm.trim().length >= 2) setCustOpen(true);
              }}
              required
              autoComplete="off"
            />
            {/* Hidden values server can use */}
            <input type="hidden" name="customerId" value={custSelected?.id || ""} />
            <input type="hidden" name="customerResolved" value={fmtCustomerLine(custSelected) || ""} />

            {/* Suggestion panel */}
            {isExisting && custOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  left: 0,
                  width: "min(620px, 92vw)",
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  boxShadow: "var(--shadow)",
                  padding: 6,
                  zIndex: 40,
                }}
              >
                {custHits.length === 0 ? (
                  <div className="small" style={{ padding: 10 }}>No matches found.</div>
                ) : (
                  custHits.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handlePickCustomer(c)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid transparent",
                        cursor: "pointer",
                        background: "transparent",
                      }}
                      onFocus={(e) => {
                        // prevent any global :focus pink styling
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.borderColor = "transparent";
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget.style.background = "#fafafa");
                        (e.currentTarget.style.borderColor = "#eee");
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget.style.background = "transparent");
                        (e.currentTarget.style.borderColor = "transparent");
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{c.salonName || "-"}</div>
                      <div className="small">
                        Contact: {c.customerName || "-"}
                        {c.customerTelephone ? ` • ${c.customerTelephone}` : ""}
                        {c.customerEmailAddress ? ` • ${c.customerEmailAddress}` : ""}
                      </div>
                      <div className="small muted">{addressLines(c).join(", ") || "-"}</div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Selected customer card */}
            {isExisting && custSelected && (
              <div className="card" style={{ marginTop: 8, padding: 10, borderRadius: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{custSelected.salonName || "-"}</div>
                <div className="small">
                  Contact: {custSelected.customerName || "-"}
                  {custSelected.customerTelephone ? ` • ${custSelected.customerTelephone}` : ""}
                  {custSelected.customerEmailAddress ? ` • ${custSelected.customerEmailAddress}` : ""}
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>{addressLines(custSelected).join(", ") || "-"}</div>
                <div className="right" style={{ marginTop: 8 }}>
                  <button type="button" className="btn" onClick={clearPickedCustomer}>Change</button>
                </div>
              </div>
            )}

            {!isExisting && <div className="form-hint">Free-type for a lead.</div>}
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

        {/* NEW: Customer Stage */}
        <div className="field">
          <label>Customer Stage</label>
          <select name="stage" defaultValue="">
            <option value="">— Select stage —</option>
            <option value="LEAD">Lead</option>
            <option value="APPOINTMENT_BOOKED">Appointment booked</option>
            <option value="SAMPLING">Sampling</option>
            <option value="CUSTOMER">Customer</option>
          </select>
          <div className="form-hint">Optional. If chosen for an existing customer, their profile stage will be updated.</div>
        </div>

        {/* Times & duration (NOW REQUIRED) */}
        <div className="grid grid-2">
          <div className="field">
            <label>Start Time <span className="small muted">(required)</span></label>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="time"
                name="startTime"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
              <button type="button" className="btn" onClick={() => setStart(nowHHMM())}>Now</button>
            </div>
          </div>

          <div className="field">
            <label>Finish Time <span className="small muted">(required)</span></label>
            <div className="row" style={{ gap: 8 }}>
              <input
                type="time"
                name="endTime"
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                required
              />
              <button type="button" className="btn" onClick={() => setFinish(nowHHMM())}>Now</button>
            </div>
          </div>
        </div>

        <div className="field">
          <label>Total Duration (mins)</label>
          <input name="durationMinutes" value={duration} readOnly placeholder="—" />
        </div>

        {/* Follow-up (call type moved above) */}
        <div className="grid grid-2">
          <div className="field">
            <label>Follow-up (date & time)</label>
            <div className="input-group">
              <input type="date" name="followUpAt" />
              <input type="time" name="followUpTime" />
            </div>
            <div className="form-hint">If both are set, we’ll create a 30-minute calendar event.</div>
          </div>
        </div>

        {/* Brands discussed (STOCKED — visible only) */}
        <div className="field">
          <label>What brands did you discuss? (Stocked Brands)</label>
          <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr" }}>
            {stockedBrands.length > 0 ? (
              stockedBrands.map((b) => (
                <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="stockedBrandIds" value={b.id} />
                  {b.name}
                </label>
              ))
            ) : (
              <div className="small muted">No stocked brands are toggled to show. Ask an admin to enable them in Global Settings.</div>
            )}
          </div>
        </div>

        {/* Competitor brands (visible only) */}
        <div className="field">
          <label>Brands used (Competitor Brands)</label>
          <div className="grid" style={{ gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            {competitorBrands.length > 0 ? (
              competitorBrands.map((b) => (
                <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="competitorBrandIds" value={b.id} />
                  {b.name}
                </label>
              ))
            ) : (
              <div className="small muted">No competitor brands are toggled to show. Ask an admin to enable them in Global Settings.</div>
            )}
          </div>
        </div>

        {/* Summary */}
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
