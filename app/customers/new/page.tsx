// app/customers/new/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* ------------ types ------------ */
type Rep = { id: string; name: string };
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

type DayState = {
  enabled: boolean;
  openH: string;  // "00".."23"
  openM: string;  // "00","05",...,"55"
  closeH: string; // "00".."23"
  closeM: string; // "00","05",...,"55"
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

/* ------------ component ------------ */
export default function NewCustomerPage() {
  /* sales reps */
  const [reps, setReps] = useState<Rep[]>([]);
  useEffect(() => {
    fetch("/api/sales-reps")
      .then(r => r.json())
      .then(setReps)
      .catch(() => setReps([]));
  }, []);

  /* opening hours state */
  const [oh, setOh] = useState<Record<DayKey, DayState>>(() =>
    Object.fromEntries(DAYS.map(d => [d, makeDefaultDay()])) as Record<DayKey, DayState>
  );

  const openingHoursJSON = useMemo(() => {
    // Serialize to a compact JSON object the API can store in `openingHours`
    const obj: Record<DayKey, any> = {} as any;
    for (const d of DAYS) {
      const s = oh[d];
      if (!s.enabled) {
        obj[d] = { open: false };
      } else {
        obj[d] = {
          open: true,
          from: `${s.openH}:${s.openM}`,
          to: `${s.closeH}:${s.closeM}`,
        };
      }
    }
    return JSON.stringify(obj);
  }, [oh]);

  function updateDay<K extends keyof DayState>(day: DayKey, key: K, val: DayState[K]) {
    setOh(prev => ({ ...prev, [day]: { ...prev[day], [key]: val } }));
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Create Customer</h1>
      </section>

      <form method="POST" action="/api/customers" className="card grid" style={{ gap: 16 }}>
        {/* keep the serialized openingHours in sync */}
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
            <input name="brandsInterestedIn" placeholder="e.g. Wella" />
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
            {/* header row */}
            <div className="row" style={{ gap: 8, fontSize: ".85rem", color: "var(--muted)", marginBottom: 8 }}>
              <div style={{ width: 48 }}></div>
              <div style={{ width: 46 }}>Open</div>
              <div className="row" style={{ gap: 6 }}>
                <div style={{ width: 64 }}>Hour</div>
                <div style={{ width: 64 }}>Min</div>
              </div>
              <div style={{ width: 50, marginLeft: 8 }}>Close</div>
              <div className="row" style={{ gap: 6 }}>
                <div style={{ width: 64 }}>Hour</div>
                <div style={{ width: 64 }}>Min</div>
              </div>
            </div>

            {DAYS.map(day => {
              const s = oh[day];
              return (
                <div key={day} className="row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <label className="row" style={{ gap: 8, width: 120, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={e => updateDay(day, "enabled", e.target.checked)}
                    />
                    <span>{day}</span>
                  </label>

                  {/* Open label */}
                  <span className="small" style={{ width: 46, color: "var(--muted)" }}>Open</span>

                  {/* Open time selects */}
                  <select
                    aria-label={`${day} open hour`}
                    disabled={!s.enabled}
                    value={s.openH}
                    onChange={e => updateDay(day, "openH", e.target.value)}
                    style={{ width: 64 }}
                  >
                    {H24.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    aria-label={`${day} open minutes`}
                    disabled={!s.enabled}
                    value={s.openM}
                    onChange={e => updateDay(day, "openM", e.target.value)}
                    style={{ width: 64 }}
                  >
                    {M05.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>

                  {/* Close label */}
                  <span className="small" style={{ width: 50, color: "var(--muted)", marginLeft: 8 }}>Close</span>

                  {/* Close time selects */}
                  <select
                    aria-label={`${day} close hour`}
                    disabled={!s.enabled}
                    value={s.closeH}
                    onChange={e => updateDay(day, "closeH", e.target.value)}
                    style={{ width: 64 }}
                  >
                    {H24.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <select
                    aria-label={`${day} close minutes`}
                    disabled={!s.enabled}
                    value={s.closeM}
                    onChange={e => updateDay(day, "closeM", e.target.value)}
                    style={{ width: 64 }}
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
