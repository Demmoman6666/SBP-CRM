// app/saleshub/calendar/page.tsx
import { prisma } from "@/lib/prisma";
import FollowUpsCalendar from "@/components/FollowUpsCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const reps = await prisma.salesRep.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Calendar</h1>
        <p className="small">
          Showing follow-ups where <b>Outcome</b> is <i>Appointment booked</i> and a follow-up
          <b> date &amp; time</b> is set. Filter by rep to narrow down.
        </p>
      </section>

      <FollowUpsCalendar reps={reps} />
    </div>
  );
}
