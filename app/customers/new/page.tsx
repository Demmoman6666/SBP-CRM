// app/customers/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ------------ types ------------ */
type Rep = { id: string; name: string };
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

export default function NewCustomerPage() {
  /* data sources */
  const [reps, setReps] = useState<Rep[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  useEffect(() => {
    fetch("/api/sales-reps").then(r => r.json()).then(setReps).catch(() => setReps([]));
    fetch("/api/brands").then(r => r.json()).then(setBrands).catch(() => setBrands([]));
  }, []);

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
          <div className="field">
            <label>Brands Used</label>
            <select name="brandsInterestedIn" defaultValue="">
              <option value="">— Select a brand —</option>
              {brands.map(b => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>County</label>
            <input name="county" />
          </div>
          <div className="field">
            <label>Sales Rep*</label>
            <select name="salesRep" required defaultValue="">
              <option value="" disabled>— Select a rep —</option>
              {reps.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <div className="form-hint">Required</div>
          </div>

          <div className="field">
            <label>Postcode</label>
            <input name="postCode" />
          </div>
          <div className="field">
            <label>Number of Chairs</label>
            <input name="numberOfChairs" type="number" min={0} />
          </div>
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
              Tick a day, then choose open & close. Minutes step is 5.
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
