// app/calls/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateTimeUK } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* --- helpers --- */
function fmt(d?: Date | null) {
  if (!d) return "—";
  try {
    return formatDateTimeUK(d);
  } catch {
    return new Date(d).toLocaleString("en-GB");
  }
}

function minsFrom(log: { durationMinutes?: number | null; startTime?: Date | null; endTime?: Date | null }) {
  if (typeof log.durationMinutes === "number" && !isNaN(log.durationMinutes)) {
    return Math.max(0, Math.round(log.durationMinutes));
  }
  if (log.startTime && log.endTime) {
    const ms = new Date(log.endTime).getTime() - new Date(log.startTime).getTime();
    if (!isNaN(ms) && ms > 0) return Math.round(ms / 60000);
  }
  return null;
}

export default async function CallLogViewPage({ params }: { params: { id: string } }) {
  const call = await prisma.callLog.findUnique({
    where: { id: params.id },
    // No select: return all scalar fields we might have; relations aren’t needed for read-only
  });

  if (!call) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Call not found</h2>
        <Link href="/calls" className="btn">Back to Call Log</Link>
      </div>
    );
  }

  const duration = minsFrom(call as any);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>Call</h1>
            <div className="small muted">Logged: {fmt((call as any).createdAt)}</div>
          </div>
          <Link href="/calls" className="btn">Back</Link>
        </div>
      </section>

      <section className="card">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div>
            <b>Sales Rep</b>
            <p className="small" style={{ marginTop: 6 }}>{(call as any).staff || "—"}</p>
          </div>

          <div>
            <b>Customer</b>
            <p className="small" style={{ marginTop: 6 }}>
              {(call as any).customerName || (call as any).salonName || "—"}
            </p>
          </div>

          <div>
            <b>Type</b>
            <p className="small" style={{ marginTop: 6 }}>{(call as any).callType || "—"}</p>
          </div>

          <div>
            <b>Outcome</b>
            <p className="small" style={{ marginTop: 6 }}>{(call as any).outcome || "—"}</p>
          </div>

          {"stage" in call && (
            <div>
              <b>Stage</b>
              <p className="small" style={{ marginTop: 6 }}>{(call as any).stage || "—"}</p>
            </div>
          )}

          {"appointmentBooked" in call && (
            <div>
              <b>Appointment Booked</b>
              <p className="small" style={{ marginTop: 6 }}>
                {(call as any).appointmentBooked ? "Yes" : "No"}
              </p>
            </div>
          )}

          <div>
            <b>Start Time</b>
            <p className="small" style={{ marginTop: 6 }}>{fmt((call as any).startTime)}</p>
          </div>

          <div>
            <b>End Time</b>
            <p className="small" style={{ marginTop: 6 }}>{fmt((call as any).endTime)}</p>
          </div>

          <div>
            <b>Duration (mins)</b>
            <p className="small" style={{ marginTop: 6 }}>
              {duration ?? ((call as any).durationMinutes ?? "—")}
            </p>
          </div>

          <div>
            <b>Follow-up</b>
            <p className="small" style={{ marginTop: 6 }}>{fmt((call as any).followUpAt)}</p>
          </div>

          <div>
            <b>Contact Phone</b>
            <p className="small" style={{ marginTop: 6 }}>{(call as any).contactPhone || "—"}</p>
          </div>

          <div>
            <b>Contact Email</b>
            <p className="small" style={{ marginTop: 6 }}>{(call as any).contactEmail || "—"}</p>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <b>Summary</b>
            <p className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
              {(call as any).summary || "—"}
            </p>
          </div>

          {"notes" in call && (call as any).notes && (
            <div style={{ gridColumn: "1 / -1" }}>
              <b>Notes</b>
              <p className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                {(call as any).notes}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
