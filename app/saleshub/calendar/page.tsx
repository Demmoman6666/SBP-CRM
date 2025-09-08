// app/saleshub/calendar/page.tsx
import FollowUpsCalendar from "@/components/FollowUpsCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Calendar</h1>
        <p className="small">Booked follow-ups from your Call Log. Click a day to see details and jump to the call or customer.</p>
      </section>

      <FollowUpsCalendar />
    </div>
  );
}
