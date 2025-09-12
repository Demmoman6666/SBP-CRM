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

export default function NewCallPage() {
  /* Sales reps */
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps")
      .then((r) => r.json())
      .then(setReps)
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
        setStockedBrands(Array.isArray(s) ? s.map(norm) : []);
        setCompetitorBrands(Array.isArray(b) ? b.map(norm) : []);
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
      if (custWrapRef.current && !custWrapRef.current.contains(e.target as Node)) {
        setCustOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (!isExisting) {
      // free-typing a lead
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
        const j = await res.json();
        setCustHits(Array.isArray(j) ? j : []);
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
    // handle overnight (finish after midnight)
    const diff = e >= s ? e - s : e + 24 * 60 - s;
    return String(diff);
  }, [start, finish]);

  /* GEO — mandatory */
  type GeoState = "prompt" | "granted" | "denied" | "unsupported";
  const [geoState, setGeoState] = useState<GeoState>("prompt");
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [geoAt, setGeoAt] = useState<string | null>(null);

  const insecureContext =
    typeof window !== "undefined" &&
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost";

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) {
      setGeoState("unsupported");
      return;
    }
    // Probe permission if supported
    // @ts-ignore
    if (navigator.permissions?.query) {
      // @ts-ignore
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((p: any) => {
        setGeoState(p.state as GeoState);
        p.onchange = () => setGeoState(p.state as GeoState);
        // If already granted, capture immediately
        if (p.state === "granted" && !lat && !lng) {
          void captureLocation();
        }
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) return reject(new Error("Geolocation not supported"));
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  async function captureLocation() {
    setGeoErr(null);
    setLocating(true);
    try {
      const pos = await getPosition();
      const { latitude, longitude, accuracy } = pos.coords;
      setLat(latitude);
      setLng(longitude);
      setAccuracyM(Number.isFinite(accuracy) ? accuracy : null);
      setGeoAt(new Date().toISOString());
      setGeoState("granted");
    } catch (e: any) {
      const msg =
        e?.code === 1
          ? "Permission denied. Please allow location."
          : e?.code === 2
          ? "Position unavailable. Try again."
          : e?.code === 3
          ? "Timed out. Try again."
          : "Could not get your location.";
      setGeoErr(msg);
      if (e?.code === 1) setGeoState("denied");
    } finally {
      setLocating(false);
    }
  }

  const hasLocation = Number.isFinite(lat as any) && Number.isFinite(lng as any);

  /* Submission state */
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (insecureContext) {
      setError("Location requires HTTPS (or localhost in dev). Open the secure site to log a call.");
      return;
    }

    // Ensure we have location
    if (!hasLocation) {
      // One last attempt (uses user gesture from submit)
      await captureLocation();
      if (!hasLocation) {
        setError("Location is required. Please tap “Use my location” and allow permission.");
        return;
      }
    }

    const fd = new FormData(e.currentTarget);

    // Must have a rep & summary
    if (!fd.get("salesRep")) {
      setError("Please select a Sales Rep.");
      return;
    }
    if (!fd.get("summary")) {
      setError("Summary is required.");
      return;
    }

    // require start & finish times
    const s = String(fd.get("startTime") || "").trim();
    const f = String(fd.get("endTime") || "").trim();
    if (!s || !f) {
      setError("Start Time and Finish Time are required.");
      return;
    }

    const existing = fd.get("isExistingCustomer") === "true";

    // If existing customer, ensure a suggestion was actually picked
    if (existing && !fd.get("customerId")) {
      setError("Please pick a customer from the suggestions.");
      return;
    }

    // If NOT existing, copy the typed customer value into 'customerName'
    if (!existing) {
      const typed = (fd.get("customer") || "").toString().trim();
      if (!typed) {
        setError("Please enter a customer/lead name.");
        return;
      }
      fd.set("customerName", typed);
    }

    // GEO → append mandatory hidden fields
    fd.set("latitude", hasLocation ? String(lat) : "");
    fd.set("longitude", hasLocation ? String(lng) : "");
    if (accuracyM != null) fd.set("accuracyM", String(accuracyM));
    if (geoAt) fd.set("geoCollectedAt", geoAt);

    // Combine follow-up date + time into a single ISO string
    const fDate = (fd.get("followUpAt") || "").toString().trim();
    const fTime = (fd.get("followUpTime") || "").toString().trim();
    if (fDate && fTime) {
      fd.set("followUpAt", `${fDate}T${fTime}`);
    }
    fd.delete("followUpTime"); // server doesn't use it

    try {
      setSubmitting(true);
      const res = await fetch("/api/calls", { method: "POST", body: fd });
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

  const timestamp = useMemo(() => new Date().toLocaleString(), []);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Log Call</h1>
        <span className="small muted">Timestamp: {timestamp}</span>
      </section>

      <form onSubmit={onSubmit} className="card grid" style={{ gap: 12 }}>
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
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
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

        {/* GEO (MANDATORY) */}
        <div className="card" style={{ background: "#fafafa" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>Location (required)</strong>
              <div className="small muted">
                We store your current location with this call for auditing and route insights.
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={captureLocation}
                disabled={locating || insecureContext}
                title={insecureContext ? "Location requires HTTPS or localhost" : "Get location"}
              >
                {locating ? "Getting location…" : hasLocation ? "Refresh location" : "Use my location"}
              </button>
            </div>
          </div>

          <div className="small" style={{ marginTop: 6 }}>
            Status:{" "}
            <span style={{ color: geoState === "denied" ? "var(--danger,#b91c1c)" : "inherit" }}>
              {insecureContext ? "Unavailable (open HTTPS site)" : geoState}
            </span>
            {hasLocation && (
              <>
                {" • "}
                <span>
                  {lat?.toFixed(5)}, {lng?.toFixed(5)}{accuracyM ? ` • ±${Math.round(accuracyM)}m` : ""}{" "}
                  {geoAt ? `• ${new Date(geoAt).toLocaleTimeString()}` : ""}
                </span>
              </>
            )}
            {geoErr && <div className="small" style={{ color: "var(--danger,#b91c1c)" }}>{geoErr}</div>}
          </div>

          {/* Hidden fields posted to API */}
          <input type="hidden" name="latitude" value={hasLocation ? String(lat) : ""} />
          <input type="hidden" name="longitude" value={hasLocation ? String(lng) : ""} />
          <input type="hidden" name="accuracyM" value={accuracyM != null ? String(accuracyM) : ""} />
          <input type="hidden" name="geoCollectedAt" value={geoAt || ""} />

          {!hasLocation && !insecureContext && (
            <div className="small" style={{ marginTop: 6 }}>
              Tip: If you dismissed the prompt, enable location for this site in your browser settings and tap “Use my
              location” again.
            </div>
          )}
          {insecureContext && (
            <div className="small" style={{ marginTop: 6 }}>
              Geolocation prompts require HTTPS (or localhost in dev). Open the secure URL to continue.
            </div>
          )}
        </div>

        {/* Call type + follow-up */}
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
                  {/* Multiple of same name -> FormData.getAll("stockedBrandIds") */}
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
          <button
            className="primary"
            type="submit"
            disabled={
              submitting ||
              insecureContext ||
              !hasLocation // hard block until location present
            }
            title={
              insecureContext ? "Open the HTTPS site to enable location" :
              !hasLocation ? "Location is required" :
              undefined
            }
          >
            {submitting ? "Saving…" : "Save Call"}
          </button>
        </div>
      </form>
    </div>
  );
}
