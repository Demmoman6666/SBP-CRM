// app/saleshub/coverage-map/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";

/** Google Maps loader (kept on window to avoid double insert) */
declare global {
  interface Window {
    google?: any;
    __gmapsLoader?: Promise<void>;
    __gmapsCb__?: () => void;
  }
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoader) return window.__gmapsLoader;

  window.__gmapsLoader = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__gmapsCb__`;
    s.async = true;
    s.defer = true;
    window.__gmapsCb__ = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });

  return window.__gmapsLoader;
}

/** Utilities */
type Rep = { id: string; name: string };
type CallRow = {
  id: string;
  staff: string | null;
  callType: string | null;
  summary: string | null;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  customer?: { salonName?: string | null; customerName?: string | null };
};

function normReps(payload: any): Rep[] {
  const arr = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.reps)
    ? payload.reps
    : [];

  return arr
    .map((r: any): Rep =>
      typeof r === "string" ? { id: r, name: r } : { id: String(r.id ?? r.name ?? ""), name: String(r.name ?? r.id ?? "") }
    )
    .filter((r) => r.name);
}

function yyyy_mm_dd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function svgPin(color: string) {
  // Simple SVG pin (24x40) with shadow-ish stroke
  const svg = `
    <svg width="24" height="40" viewBox="0 0 24 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C6.477 0 2 4.477 2 10c0 7.5 8.5 17.5 9.1 18.2a1.2 1.2 0 0 0 1.8 0C13.5 27.5 22 17.5 22 10 22 4.477 17.523 0 12 0z" fill="${color}" stroke="#1f2937" stroke-width="1"/>
      <circle cx="12" cy="10" r="4.5" fill="#fff"/>
    </svg>`;
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    size: new window.google.maps.Size(24, 40),
    anchor: new window.google.maps.Point(12, 36),
    scaledSize: new window.google.maps.Size(24, 40),
  };
}

function colorForType(t?: string | null) {
  const s = (t || "").toLowerCase();
  if (s === "cold call") return "#3b82f6";   // blue
  if (s === "booked call") return "#fb923c"; // orange
  if (s === "booked demo") return "#ef4444"; // red
  return "#6b7280";                           // grey (unknown)
}

export default function CoverageMapPage() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);

  // filters
  const [reps, setReps] = useState<Rep[]>([]);
  const [repFilter, setRepFilter] = useState<string>("");
  const [day, setDay] = useState<string>(yyyy_mm_dd(new Date())); // default today

  // load reps + maps
  useEffect(() => {
    (async () => {
      try {
        const [repRes] = await Promise.all([
          fetch("/api/sales-reps", { cache: "no-store" }),
        ]);
        const repJson = await repRes.json().catch(() => []);
        setReps(normReps(repJson));
      } finally {
        // maps
        const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!;
        await loadGoogleMaps(key);
        if (!mapRef.current && mapDivRef.current && window.google?.maps) {
          mapRef.current = new window.google.maps.Map(mapDivRef.current, {
            center: { lat: 52.477, lng: -1.898 }, // UK-ish center
            zoom: 6,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          infoRef.current = new window.google.maps.InfoWindow();
        }
        setLoading(false);
      }
    })();
  }, []);

  // fetch calls when filters change
  useEffect(() => {
    if (!mapRef.current || loading) return;

    (async () => {
      try {
        // clear markers
        for (const m of markersRef.current) m.setMap(null);
        markersRef.current = [];

        const qs = new URLSearchParams({ limit: "1000" });
        if (repFilter) qs.set("staff", repFilter);
        if (day) {
          qs.set("from", day);
          qs.set("to", day);
        }

        const res = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" });
        const rows: CallRow[] = await res.json();

        const bounds = new window.google.maps.LatLngBounds();
        for (const r of rows) {
          const lat = Number(r.latitude);
          const lng = Number(r.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          const icon = svgPin(colorForType(r.callType));
          const marker = new window.google.maps.Marker({
            position: { lat, lng },
            map: mapRef.current,
            icon,
            title: r.customer?.salonName || r.customer?.customerName || r.summary || r.callType || "Call",
          });

          marker.addListener("click", () => {
            const when = new Date(r.createdAt).toLocaleString();
            const who = r.customer?.salonName || r.customer?.customerName || "(no name)";
            const staff = r.staff || "-";
            const type = r.callType || "-";
            const html = `
              <div style="min-width:220px">
                <div style="font-weight:700">${who}</div>
                <div style="color:#6b7280;margin:4px 0">${when}</div>
                <div><b>Rep:</b> ${staff}</div>
                <div><b>Type:</b> ${type}</div>
                ${r.summary ? `<div style="margin-top:6px">${(r.summary || "").replace(/</g,"&lt;")}</div>` : ""}
              </div>
            `;
            infoRef.current.setContent(html);
            infoRef.current.open({ anchor: marker, map: mapRef.current });
          });

          markersRef.current.push(marker);
          bounds.extend(marker.getPosition());
        }

        // fit or reset
        if (markersRef.current.length > 0) {
          mapRef.current.fitBounds(bounds);
          // prevent zooming in too far for a single marker
          const l = markersRef.current.length;
          const listener = window.google.maps.event.addListenerOnce(mapRef.current, "bounds_changed", () => {
            if (l === 1 && mapRef.current.getZoom() > 14) mapRef.current.setZoom(14);
          });
          setTimeout(() => window.google.maps.event.removeListener(listener), 1000);
        } else {
          // nothing to show – recentre UK
          mapRef.current.setCenter({ lat: 52.477, lng: -1.898 });
          mapRef.current.setZoom(6);
        }
      } catch (e) {
        console.error("Failed to load markers:", e);
      }
    })();
  }, [repFilter, day, loading]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Coverage map</h1>
        <p className="small">View logged calls; filter by sales rep and day. Pins are colour-coded by call type.</p>
      </section>

      {/* Filters */}
      <section className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="field" style={{ width: 320 }}>
          <label>Sales rep</label>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r.id || r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="field" style={{ width: 220 }}>
          <label>Day</label>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setDay(yyyy_mm_dd(new Date()))}
            >
              Today
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setDay(yyyy_mm_dd(d));
              }}
            >
              Yesterday
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setDay("")}
              title="Show all dates"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="row" style={{ gap: 14, marginLeft: "auto" }}>
          <span className="small"><span style={{ display: "inline-block", width: 12, height: 12, background: "#3b82f6", borderRadius: 3, marginRight: 6 }} />Cold Call</span>
          <span className="small"><span style={{ display: "inline-block", width: 12, height: 12, background: "#fb923c", borderRadius: 3, marginRight: 6 }} />Booked Call</span>
          <span className="small"><span style={{ display: "inline-block", width: 12, height: 12, background: "#ef4444", borderRadius: 3, marginRight: 6 }} />Booked Demo</span>
        </div>
      </section>

      {/* Map */}
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={mapDivRef} style={{ width: "100%", height: 560 }} />
      </section>
    </div>
  );
}
