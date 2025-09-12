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
function fmtTime(d?: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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
    include: {
      customer: { select: { salonName: true, customerName: true } }, // relation names
    },
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

  // Derive booked like the report (works even if appointmentBooked flag wasn't set)
  const apptBooked =
    !!(call as any).appointmentBooked ||
    (call as any).outcome === "Appointment booked" ||
    (call as any).callType === "Booked Call" ||
    (call as any).stage === "APPOINTMENT_BOOKED";

  const customerLabel = call.isExistingCustomer
    ? (call.customer?.salonName ?? call.customer?.customerName ?? "—")
    : (call.customerName ?? "—");

  // ---- location fields (safe access) ----
  const lat = (call as any).latitude as number | undefined | null;
  const lng = (call as any).longitude as number | undefined | null;
  const accuracyM = (call as any).accuracyM as number | undefined | null;
  const geoCollectedAt = (call as any).geoCollectedAt as Date | undefined | null;

  const hasLocation =
    lat != null &&
    lng != null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));

  const coordStr = hasLocation ? `${lat},${lng}` : "";
  const mapsOpenUrl = hasLocation
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordStr)}`
    : "";
  const mapsEmbedSrc = hasLocation
    ? `https://www.google.com/maps?q=${encodeURIComponent(coordStr)}&z=15&output=embed`
    : "";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>Call</h1>
            <div className="small muted">Logged: {fmt(call.createdAt)}</div>
          </div>
          <Link href="/calls" className="btn">Back</Link>
        </div>
      </section>

      <section className="card">
        <div className="grid" style={{ gap: 16 }}>
          {/* top section: details */}
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <b>Sales Rep</b>
              <p className="small" style={{ marginTop: 6 }}>{call.staff || "—"}</p>
            </div>

            <div>
              <b>Customer</b>
              <p className="small" style={{ marginTop: 6 }}>{customerLabel}</p>
            </div>

            <div>
              <b>Type</b>
              <p className="small" style={{ marginTop: 6 }}>{call.callType || "—"}</p>
            </div>

            <div>
              <b>Outcome</b>
              <p className="small" style={{ marginTop: 6 }}>{call.outcome || "—"}</p>
            </div>

            <div>
              <b>Stage</b>
              <p className="small" style={{ marginTop: 6 }}>{(call as any).stage || "—"}</p>
            </div>

            <div>
              <b>Appointment Booked</b>
              <p className="small" style={{ marginTop: 6 }}>{apptBooked ? "Yes" : "No"}</p>
            </div>

            <div>
              <b>Start Time</b>
              <p className="small" style={{ marginTop: 6 }}>{fmtTime((call as any).startTime)}</p>
            </div>

            <div>
              <b>End Time</b>
              <p className="small" style={{ marginTop: 6 }}>{fmtTime((call as any).endTime)}</p>
            </div>

            <div>
              <b>Duration (mins)</b>
              <p className="small" style={{ marginTop: 6 }}>
                {duration ?? (call as any).durationMinutes ?? "—"}
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
          </div>

          {/* summary */}
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

          {/* location block */}
          <div style={{ gridColumn: "1 / -1" }}>
            <b>Location</b>
            <div className="small muted" style={{ marginTop: 6 }}>
              {hasLocation ? (
                <>
                  {geoCollectedAt ? <>Captured: {fmt(geoCollectedAt)} • </> : null}
                  {accuracyM != null ? <>Accuracy: ±{Math.round(Number(accuracyM))}m • </> : null}
                  Coords: {coordStr}
                </>
              ) : (
                "No location captured for this call."
              )}
            </div>

            {hasLocation && (
              <div className="grid" style={{ gap: 8, marginTop: 8 }}>
                <div
                  style={{
                    width: "100%",
                    height: 280,
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                  }}
                >
                  <iframe
                    title="Call location"
                    src={mapsEmbedSrc}
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>

                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                  <a className="btn small" href={mapsOpenUrl} target="_blank" rel="noopener noreferrer">
                    Open in Google Maps
                  </a>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => navigator.clipboard?.writeText(coordStr)}
                  >
                    Copy coords
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
