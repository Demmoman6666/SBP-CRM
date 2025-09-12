// components/CallLocation.tsx
import React from "react";

type Props = {
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  collectedAt?: string | Date | null;
  height?: number;
};

export default function CallLocation({
  lat,
  lng,
  accuracyM,
  collectedAt,
  height = 260,
}: Props) {
  if (
    lat == null ||
    lng == null ||
    Number.isNaN(Number(lat)) ||
    Number.isNaN(Number(lng))
  ) {
    return (
      <div className="small muted">
        No location captured for this call.
      </div>
    );
  }

  const q = `${lat},${lng}`;
  const openUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    q
  )}`;
  const embedSrc = `https://www.google.com/maps?q=${encodeURIComponent(
    q
  )}&z=15&output=embed`;

  return (
    <div className="grid" style={{ gap: 8 }}>
      <div
        style={{
          width: "100%",
          height,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        <iframe
          title="Call location"
          src={embedSrc}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div className="small muted">
          {collectedAt ? (
            <>
              Captured: {new Date(collectedAt).toLocaleString()}
              {accuracyM != null ? ` • ±${Math.round(accuracyM)}m` : ""}
            </>
          ) : (
            accuracyM != null ? <>Accuracy: ±{Math.round(accuracyM)}m</> : null
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn small" href={openUrl} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              navigator.clipboard?.writeText(`${lat},${lng}`)
            }
          >
            Copy coords
          </button>
        </div>
      </div>
    </div>
  );
}
