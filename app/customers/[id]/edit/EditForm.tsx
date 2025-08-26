// app/customers/[id]/edit/EditForm.tsx
"use client";

import { useMemo, useState } from "react";

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

// A small, fixed list keeps UX tight and avoids an async call.
const COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
];

function parseOpeningHoursJSON(initialJSON: string | undefined) {
  try {
    return initialJSON ? JSON.parse(initialJSON) : null;
  } catch {
    return null;
  }
}

function OpeningHoursEditor({ initialJSON }: { initialJSON?: string }) {
  // seed state from JSON if present
  const seed = parseOpeningHoursJSON(initialJSON);

  const seededDays = () => {
    const obj: Record<DayKey, DayState> =
      Object.fromEntries(DAYS.map((d) => [d, makeDefaultDay()])) as Record<
        DayKey,
        DayState
      >;

    if (seed && typeof seed === "object") {
      for (const d of DAYS) {
        const s = (seed as any)[d];
        if (s && s.open === true && typeof s.from === "string" && typeof s.to === "string") {
          const [oh, om] = String(s.from).split(":");
          const [ch, cm] = String(s.to).split(":");
          obj[d] = {
            enabled: true,
            openH: String(oh ?? "09").padStart(2, "0"),
            openM: String(om ?? "00").padStart(2, "0"),
            closeH: String(ch ?? "17").padStart(2, "0"),
            closeM: String(cm ?? "00").padStart(2, "0"),
          };
        }
      }
    }
    return obj;
  };

  const [oh, setOh] = useState<Record<DayKey, DayState>>(seededDays);

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
    setOh((prev) => ({ ...prev, [day]: { ...prev[day], [key]: val } }));
  }

  // grid cols reused for header & rows
  const gridCols = "120px 46px 64px 64px 50px 64px 64px";

  return (
    <>
      <input type="hidden" name="openingHours" value={openingHoursJSON} />
      <div className="grid" style={{ gap: 8 }}>
        <b>Opening Hours</b>

        <div className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
          {/* header */}
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

          {DAYS.map((day) => {
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
                <label className="row" style={{ gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => updateDay(day, "enabled", e.target.checked)}
                  />
                  <span>{day}</span>
                </label>

                {/* spacer under "Open" */}
                <div></div>

                {/* Open Hr / Min */}
                <select
                  aria-label={`${day} open hour`}
                  disabled={!s.enabled}
                  value={s.openH}
                  onChange={(e) => updateDay(day, "openH", e.target.value)}
                >
                  {H24.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${day} open minutes`}
                  disabled={!s.enabled}
                  value={s.openM}
                  onChange={(e) => updateDay(day, "openM", e.target.value)}
                >
                  {M05.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                {/* spacer under "Close" */}
                <div></div>

                {/* Close Hr / Min */}
                <select
                  aria-label={`${day} close hour`}
                  disabled={!s.enabled}
                  value={s.closeH}
                  onChange={(e) => updateDay(day, "closeH", e.target.value)}
                >
                  {H24.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${day} close minutes`}
                  disabled={!s.enabled}
                  value={s.closeM}
                  onChange={(e) => updateDay(day, "closeM", e.target.value)}
                >
                  {M05.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          <div className="form-hint" style={{ marginTop: 4 }}>
            Tick a day, then choose open &amp; close. Minutes step is 5.
          </div>
        </div>
      </div>
    </>
  );
}

type EditFormProps = {
  id: string;
  initial: {
    salonName: string;
    customerName: string;
    addressLine1: string;
    addressLine2?: string | null;
    town?: string | null;
    county?: string | null;
    postCode?: string | null;
    country?: string | null;                 // ← NEW
    customerTelephone?: string | null;
    customerEmailAddress?: string | null;
    brandsInterestedIn?: string | null;
    salesRep?: string | null;
    numberOfChairs?: number | undefined;
    notes?: string | null;
    openingHours?: string | null;            // ← NEW
  };
  reps: Rep[];
  brands: Brand[];
};

export default function EditForm({ id, initial, reps, brands }: EditFormProps) {
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const res = await fetch(`/api/customers/${id}`, {
      method: "PATCH",
      body: fd,
    });

    if (res.ok) {
      // go back to the customer details page
      window.location.href = `/customers/${id}`;
    } else {
      const text = await res.text().catch(() => "");
      alert(`Update failed: ${res.status}\n${text}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid" style={{ gap: 16 }}>
      <div className="grid grid-2">
        <div className="field">
          <label>Salon Name*</label>
          <input name="salonName" required defaultValue={initial.salonName} />
        </div>
        <div className="field">
          <label>Customer Name*</label>
          <input name="customerName" required defaultValue={initial.customerName} />
        </div>

        <div className="field">
          <label>Address Line 1*</label>
          <input name="addressLine1" required defaultValue={initial.addressLine1} />
        </div>
        <div className="field">
          <label>Customer Telephone Number</label>
          <input name="customerTelephone" defaultValue={initial.customerTelephone ?? ""} />
        </div>

        <div className="field">
          <label>Address Line 2</label>
          <input name="addressLine2" defaultValue={initial.addressLine2 ?? ""} />
        </div>
        <div className="field">
          <label>Customer Email Address</label>
          <input name="customerEmailAddress" type="email" defaultValue={initial.customerEmailAddress ?? ""} />
        </div>

        <div className="field">
          <label>Town</label>
          <input name="town" defaultValue={initial.town ?? ""} />
        </div>
        <div className="field">
          <label>Brands Used</label>
          <select name="brandsInterestedIn" defaultValue={initial.brandsInterestedIn ?? ""}>
            <option value="">— Select a brand —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>County</label>
          <input name="county" defaultValue={initial.county ?? ""} />
        </div>
        <div className="field">
          <label>Sales Rep*</label>
          <select name="salesRep" required defaultValue={initial.salesRep ?? ""}>
            <option value="" disabled>
              — Select a rep —
            </option>
            {reps.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="form-hint">Required</div>
        </div>

        <div className="field">
          <label>Postcode</label>
          <input name="postCode" defaultValue={initial.postCode ?? ""} />
        </div>
        <div className="field">
          <label>Country</label>
          <select name="country" defaultValue={initial.country ?? ""}>
            <option value="">— Select a country —</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Number of Chairs</label>
          <input
            name="numberOfChairs"
            type="number"
            min={0}
            defaultValue={initial.numberOfChairs ?? undefined}
            placeholder="e.g., 6"
          />
        </div>
      </div>

      {/* Opening Hours block */}
      <OpeningHoursEditor initialJSON={initial.openingHours ?? ""} />

      <div className="field">
        <label>Notes</label>
        <textarea name="notes" rows={4} defaultValue={initial.notes ?? ""} />
      </div>

      <div className="right row" style={{ gap: 8 }}>
        <a className="button" href={`/customers/${id}`}>Cancel</a>
        <button className="primary" type="submit">Save Changes</button>
      </div>
    </form>
  );
}
