// app/customers/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ----------------------- tiny safe fetch helper ----------------------- */
async function safeGetArray<T = any>(url: string): Promise<T[]> {
  try {
    const r = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? (j as T[]) : [];
  } catch (e) {
    console.error(`[fetch] ${url} failed`, e);
    return [];
  }
}

/* ------------------------------- types ------------------------------- */
type Rep   = { id: string; name: string };
type Brand = { id: string; name: string };
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

type DayState = {
  enabled: boolean;
  openH: string;
  openM: string;
  closeH: string;
  closeM: string;
};

const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const H24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const M05 = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

const makeDefaultDay = (): DayState => ({
  enabled: false,
  openH: "09",
  openM: "00",
  closeH: "17",
  closeM: "00",
});

/** Compact list of common countries (ISO-2 code + display name) */
const COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "BE", name: "Belgium" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
];

export default function NewCustomerPage() {
  /* data sources */
  const [reps, setReps] = useState<Rep[]>([]);
  // competitor brands shown as checkboxes
  const [competitorBrands, setCompetitorBrands] = useState<Brand[]>([]);
  // selected “brands used” – we’ll submit this as a comma-separated string
  const [brandsUsed, setBrandsUsed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [repsArr, compArr] = await Promise.all([
        safeGetArray<Rep>("/api/sales-reps"),
        // This route already exists in your project and powers the call log checkboxes
        safeGetArray<Brand>("/api/settings/visible-competitor-brands"),
      ]);
      if (!cancelled) {
        setReps(repsArr);
        setCompetitorBrands(compArr);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* toggle checkbox */
  function toggleBrand(name: string) {
    setBrandsUsed(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }

  /* opening hours state */
  const [oh, setOh] = useState<Record<DayKey, DayState>>(
    () => Object.fromEntries(DAYS.map(d => [d, makeDefaultDay()])) as Record<DayKey, DayState>
  );

  const openingHoursJSON = useMemo(() => {
    const obj: Record<DayKey, any> = {} as any;
    for (const d of DAYS) {
      const s = oh[d];
      obj[d] = s.enabled
        ? { open: true, from: `${s.openH}:${s.openM}`, to: `${s.closeH}:${s.closeM}` }
        : { open: false };
    }
    return JSON.stringify(obj);
  }, [oh]);

  function updateDay<K extends keyof DayState>(day: DayKey, key: K, val: DayState[K]) {
    setOh(prev => ({ ...prev, [day]: { ...prev[day], [key]: val } }));
  }

  /* opening-hours grid columns (header & rows share this) */
  const gridCols =
    "120px 46px 64px 64px 50px 64px 64px"; // [Day] [Open] [Hr] [Min] [Close] [Hr] [Min]

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Create Customer</h1>
      </section>

      <form method="POST" action="/api/customers" className="card grid" style={{ gap: 16 }}>
        <input type="hidden" name="openingHours" value={openingHoursJSON} />
        {/* Submit selected brands as a single string to match your current Prisma field (String?) */}
        <input type="hidden" name="brandsInterestedIn" value={brandsUsed.join(", ")} />

        <div className="grid grid-2">
          <div className="field">
            <label>Salon Name*</label>
            <input name="salonName" required placeholder="Salon Ltd" />
          </div>
          <div className="field">
            <label>Customer Name*</label>
            <input name="customerName" required placeholder="Main contact" />
          </div>

          <div className="field">
            <label>Address Line 1*</label>
            <input name="addressLine1" required />
          </div>
          <div className="field">
            <label>Customer Telephone Number</label>
            <input name="customerTelephone" />
          </div>

          <div className="field">
            <label>Address Line 2</label>
            <input name="addressLine2" />
          </div>
          <div className="field">
            <label>Customer Email Address</label>
            <input name="customerEmailAddress" type="email" />
          </div>

          <div className="field">
            <label>Town</label>
            <input name="town" />
          </div>

          {/* ⬇️ Brands Used (checkboxes from Competitor Brands) */}
          <div className="field">
            <label>Brands Used</label>
            {competitorBrands.length === 0 ? (
              <div className="small muted">No competitor brands configured.</div>
            ) : (
              <div
                className="grid"
                style={{ gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
              >
                {competitorBrands.map(b => {
                  const checked = brandsUsed.includes(b.name);
                  return (
                    <label key={b.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBrand(b.name)}
                      />
                      <span>{b.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div className="form-hint">Pick all brands the salon currently uses.</div>
          </div>

          <div className="field">
            <label>County</label>
            <input name="county" />
          </div>
          <div className="field">
            <label>Sales Rep*</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>— Select a rep —</option>
              {(reps ?? []).map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <div className="form-hint">Required</div>
          </div>

          {/* NEW: Customer Stage */}
          <div className="field">
            <label>Customer Stage</label>
            <select name="stage" defaultValue="LEAD">
              <option value="LEAD">Lead</option>
              <option value="APPOINTMENT_BOOKED">Appointment booked</option>
              <option value="SAMPLING">Sampling</option>
              <option value="CUSTOMER">Customer</option>
            </select>
            <div className="form-hint">Optional – defaults to Lead if not changed.</div>
          </div>
          <div className="field">{/* spacer to keep grid alignment */}</div>

          <div className="field">
            <label>Postcode</label>
            <input name="postCode" />
          </div>
          <div className="field">
            <label>Number of Chairs</label>
            <input name="numberOfChairs" type="number" min={0} />
          </div>

          {/* Country directly under Postcode (spacer on the right keeps layout) */}
          <div className="field">
            <label>Country</label>
            <select name="country" defaultValue="GB">
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">{/* spacer to keep grid alignment */}</div>
        </div>

        {/* Opening Hours */}
        <div className="grid" style={{ gap: 8 }}>
          <b>Opening Hours</b>

          <div className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
            {/* header aligned to exact columns */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                columnGap: 8,
                alignItems: "end",
                marginBottom: 8,
              }}
            >
              <div></div>
              <div className="small muted" style={{ textAlign: "left" }}>Open</div>
              <div className="small muted" style={{ textAlign: "left" }}>Hour</div>
              <div className="small muted" style={{ textAlign: "left" }}>Min</div>
              <div className="small muted" style={{ textAlign: "left" }}>Close</div>
              <div className="small muted" style={{ textAlign: "left" }}>Hour</div>
              <div className="small muted" style={{ textAlign: "left" }}>Min</div>
            </div>

            {DAYS.map(day => {
              const s = oh[day];
              return (
                <div
                  key={day}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    columnGap: 8,
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  {/* Day + checkbox */}
                  <label className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={e => updateDay(day, "enabled", e.target.checked)}
                    />
                    <span>{day}</span>
                  </label>

                  {/* spacer under "Open" header column */}
                  <div></div>

                  {/* Open Hr / Min */}
                  <select
                    aria-label={`${day} open hour`}
                    disabled={!s.enabled}
                    value={s.openH}
                    onChange={e => updateDay(day, "openH", e.target.value)}
                  >
                    {H24.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    aria-label={`${day} open minutes`}
                    disabled={!s.enabled}
                    value={s.openM}
                    onChange={e => updateDay(day, "openM", e.target.value)}
                  >
                    {M05.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>

                  {/* spacer under "Close" header column */}
                  <div></div>

                  {/* Close Hr / Min */}
                  <select
                    aria-label={`${day} close hour`}
                    disabled={!s.enabled}
                    value={s.closeH}
                    onChange={e => updateDay(day, "closeH", e.target.value)}
                  >
                    {H24.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    aria-label={`${day} close minutes`}
                    disabled={!s.enabled}
                    value={s.closeM}
                    onChange={e => updateDay(day, "closeM", e.target.value)}
                  >
                    {M05.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              );
            })}

            <div className="form-hint" style={{ marginTop: 4 }}>
              Tick a day, then choose open &amp; close. Minutes step is 5.
            </div>
          </div>
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea name="notes" rows={4} placeholder="Anything useful…" />
        </div>

        <div className="right">
          <button className="primary" type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
