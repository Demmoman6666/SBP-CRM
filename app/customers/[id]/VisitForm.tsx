"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function fmtDuration(mins: number | null): string {
  if (mins == null || mins < 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export default function VisitForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [date, setDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [staff, setStaff] = useState<string>("");
  const [summary, setSummary] = useState<string>("");

  const durationMins = useMemo(() => {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    const mins = end >= start ? end - start : end + 24 * 60 - start; // crosses midnight
    return mins;
  }, [startTime, endTime]);

  const invalid = startTime && endTime ? false : true;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/customers/${customerId}/visits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        startTime,
        endTime,
        summary,
        staff,
      }),
    });
    if (res.ok) {
      setSummary("");
      setStaff("");
      setStartTime("");
      setEndTime("");
      router.refresh();
    } else {
      alert("Failed to save visit");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid" style={{ gap: 8 }}>
      <div className="grid grid-2">
        <div>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div>
          <label>Staff (optional)</label>
          <input value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="Your name" />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <div>
            <label>Start Time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div>
            <label>Finish Time</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <div>
            <label>Total Duration</label>
            <input value={fmtDuration(durationMins)} readOnly placeholder="—" />
          </div>
        </div>
      </div>

      <div>
        <label>Summary</label>
        <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened?" />
      </div>

      <button className="primary" type="submit" disabled={invalid}>
        Save Visit
      </button>
    </form>
  );
}
