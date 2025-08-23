// components/VisitForm.tsx
"use client";

import { useMemo, useState } from "react";

type Props = {
  onSubmit: (formData: FormData) => void | Promise<void>; // server action
  reps: string[]; // sales rep names
};

export default function VisitForm({ onSubmit, reps }: Props) {
  const [date, setDate] = useState<string>("");
  const [staff, setStaff] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [startTime, setStartTime] = useState<string>(""); // "HH:MM"
  const [endTime, setEndTime] = useState<string>(""); // "HH:MM"

  const durationMinutes = useMemo(() => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return null;

    const d = new Date();
    const s = new Date(d);
    const e = new Date(d);
    s.setHours(sh, sm, 0, 0);
    e.setHours(eh, em, 0, 0);

    const diff = e.getTime() - s.getTime();
    return diff >= 0 ? Math.round(diff / 60000) : null;
  }, [startTime, endTime]);

  return (
    <form action={onSubmit} className="grid" style={{ gap: 8 }}>
      <div className="grid grid-2">
        <div>
          <label>Date</label>
          <input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label>Sales Rep (optional)</label>
          <select name="staff" value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">— Select Sales Rep —</option>
            {reps.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <label>Start Time</label>
          <input
            type="time"
            name="startTime"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div>
          <label>Finish Time</label>
          <input
            type="time"
            name="endTime"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label>Total Duration (mins)</label>
        <input readOnly value={durationMinutes ?? ""} placeholder="—" aria-label="Total duration in minutes" />
      </div>

      <div>
        <label>Summary</label>
        <textarea
          name="summary"
          rows={3}
          placeholder="What happened?"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <button className="primary" type="submit">
        Save Visit
      </button>
    </form>
  );
}
