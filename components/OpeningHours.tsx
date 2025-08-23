'use client';

import { useMemo, useState } from 'react';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
type DayHours = { open: boolean; from: string | null; to: string | null };
type OpeningHours = Record<DayKey, DayHours>;

const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun'
};

const defaultHours: OpeningHours = {
  mon: { open: false, from: null, to: null },
  tue: { open: false, from: null, to: null },
  wed: { open: false, from: null, to: null },
  thu: { open: false, from: null, to: null },
  fri: { open: false, from: null, to: null },
  sat: { open: false, from: null, to: null },
  sun: { open: false, from: null, to: null },
};

export default function OpeningHoursFieldset({
  name = 'openingHoursJson',
  initialJson,
}: {
  /** Name of hidden input which carries JSON to the server action */
  name?: string;
  /** Optional existing JSON to prefill (when editing) */
  initialJson?: string | null;
}) {
  const initial: OpeningHours = useMemo(() => {
    if (!initialJson) return defaultHours;
    try {
      const parsed = JSON.parse(initialJson) as Partial<OpeningHours>;
      return { ...defaultHours, ...parsed };
    } catch {
      return defaultHours;
    }
  }, [initialJson]);

  const [hours, setHours] = useState<OpeningHours>(initial);
  const json = useMemo(() => JSON.stringify(hours), [hours]);

  return (
    <fieldset className="grid" style={{ gap: 10 }}>
      {/* Hidden field actually submitted with the form */}
      <input type="hidden" name={name} value={json} />

      {DAY_KEYS.map((k) => {
        const d = hours[k];
        return (
          <div
            key={k}
            className="row"
            style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <label className="nowrap" style={{ width: 76 }}>
              <input
                type="checkbox"
                checked={d.open}
                onChange={(e) =>
                  setHours((prev) => ({
                    ...prev,
                    [k]: {
                      ...prev[k],
                      open: e.target.checked,
                      // If toggled off, clear times so we don’t save stale values
                      from: e.target.checked ? prev[k].from : null,
                      to: e.target.checked ? prev[k].to : null,
                    },
                  }))
                }
              />
              {' '}{DAY_LABELS[k]}
            </label>

            <div className="row" style={{ gap: 8, opacity: d.open ? 1 : 0.5 }}>
              <label className="small" style={{ width: 42 }}>Open</label>
              <input
                type="time"
                disabled={!d.open}
                value={d.from ?? ''}
                onChange={(e) =>
                  setHours((prev) => ({
                    ...prev,
                    [k]: { ...prev[k], from: e.target.value || null },
                  }))
                }
              />
              <label className="small" style={{ width: 45 }}>Close</label>
              <input
                type="time"
                disabled={!d.open}
                value={d.to ?? ''}
                onChange={(e) =>
                  setHours((prev) => ({
                    ...prev,
                    [k]: { ...prev[k], to: e.target.value || null },
                  }))
                }
              />
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
