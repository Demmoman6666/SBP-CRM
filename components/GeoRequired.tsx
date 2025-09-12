// components/GeoRequired.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Optional: override hidden input names if you already use something else */
  names?: {
    lat?: string;
    lng?: string;
    acc?: string;
    ts?: string;
  };
};

/**
 * Mandatory geolocation for forms.
 * - Requests navigator.geolocation on mount.
 * - Writes coords into hidden inputs.
 * - Disables the nearest form submit until coords exist.
 * - Blocks submit if coords missing (denied/insecure).
 */
export default function GeoRequired({ names }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"idle" | "ok" | "denied" | "error" | "unsupported">("idle");
  const [message, setMessage] = useState<string>("");

  const n = {
    lat: names?.lat || "lat",
    lng: names?.lng || "lng",
    acc: names?.acc || "acc",
    ts:  names?.ts  || "geoTs",
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const form = el.closest("form") as HTMLFormElement | null;
    if (!form) return;

    const latInput = document.createElement("input");
    latInput.type = "hidden"; latInput.name = n.lat;

    const lngInput = document.createElement("input");
    lngInput.type = "hidden"; lngInput.name = n.lng;

    const accInput = document.createElement("input");
    accInput.type = "hidden"; accInput.name = n.acc;

    const tsInput = document.createElement("input");
    tsInput.type = "hidden"; tsInput.name = n.ts;

    form.appendChild(latInput);
    form.appendChild(lngInput);
    form.appendChild(accInput);
    form.appendChild(tsInput);

    // Find a submit button to toggle (best-effort)
    const submits = form.querySelectorAll<HTMLButtonElement>('button[type="submit"], input[type="submit"]');
    const setDisabled = (v: boolean) => submits.forEach((b) => (b.disabled = v));

    // Request geolocation
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      setMessage("Device does not support geolocation.");
      setDisabled(true);
    } else if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      setStatus("error");
      setMessage("Geolocation requires HTTPS (or localhost).");
      setDisabled(true);
    } else {
      setMessage("Requesting location…");
      setDisabled(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          latInput.value = String(latitude);
          lngInput.value = String(longitude);
          accInput.value = Number.isFinite(accuracy) ? String(accuracy) : "";
          tsInput.value = String(Date.now());
          setStatus("ok");
          setMessage(`Location captured (±${Math.round(accuracy || 0)}m).`);
          setDisabled(false);
        },
        (err) => {
          setStatus("denied");
          setMessage(err?.message || "Location permission denied.");
          setDisabled(true);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    }

    // Guard submission if location missing
    const onSubmit = (e: Event) => {
      if (!latInput.value || !lngInput.value) {
        e.preventDefault();
        e.stopPropagation();
        setStatus("denied");
        if (!message) setMessage("Location is required. Please allow location access.");
        alert("Location is required to log a call. Please allow location.");
      }
    };
    form.addEventListener("submit", onSubmit);

    return () => {
      form.removeEventListener("submit", onSubmit);
      latInput.remove(); lngInput.remove(); accInput.remove(); tsInput.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const color =
    status === "ok" ? "var(--success,#065f46)" :
    status === "denied" || status === "error" ? "var(--danger,#b91c1c)" :
    "var(--muted,#6b7280)";

  return (
    <div ref={rootRef} className="small" style={{ color, marginTop: 8 }}>
      {message || "Location ready."}
    </div>
  );
}
