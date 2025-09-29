'use client';

import { useEffect, useMemo, useRef, useState } from "react";

type Point = {
  id: string;
  lat: number;
  lng: number;
  time: string;
  staff: string | null;
  customerId: string | null;
  customerName: string;
  summary: string;
  outcome: string;
};

declare global {
  interface Window { __gmapsLoader?: Promise<void>; }
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoader) return window.__gmapsLoader;

  window.__gmapsLoader = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return window.__gmapsLoader;
}

export default function CoverageMapPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);

  const [loading, setLoading] = useState(false);
  const [reps, setReps] = useState<string[]>([]);
  const [rep, setRep] = useState<string>("");
  const [days, setDays] = useState<number>(90);
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);

  // init map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!apiKey) throw new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
        await loadGoogleMaps(apiKey);
        if (cancelled || !mapEl.current) return;
        mapRef.current = new google.maps.Map(mapEl.current, {
          center: { lat: 53.5, lng: -2 }, // UK-ish
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        infoRef.current = new google.maps.InfoWindow();
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [apiKey]);

  // get reps for filter
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/sales-reps", { cache: "no-store" });
      const json = await res.json().catch(() => ({ ok: false }));
      if (json?.ok) setReps(json.reps || []);
    })();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      if (rep) qs.set("rep", rep);
      if (days) qs.set("days", String(days));
      const res = await fetch(`/api/calls/geo?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed to load points");
      setPoints(json.points || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  // first load + whenever filters change
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rep, days]);

  // render markers whenever points change
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return;

    // clear old
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    if (!points.length) return;

    const bounds = new google.maps.LatLngBounds();

    for (const p of points) {
      if (Number.isNaN(p.lat) || Number.isNaN(p.lng)) continue;
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: p.customerName,
      });

      marker.addListener("click", () => {
        const d = new Date(p.time);
        const html = `
          <div style="min-width:240px">
            <div style="font-weight:600">${p.customerName}</div>
            <div style="color:#6b7280; font-size:12px">${d.toLocaleString()}</div>
            ${p.staff ? `<div style="margin-top:4px">Rep: <b>${p.staff}</b></div>` : ""}
            ${p.summary ? `<div style="margin-top:6px">${escapeHtml(p.summary)}</div>` : ""}
            ${p.outcome ? `<div style="margin-top:4px"><i>${escapeHtml(p.outcome)}</i></div>` : ""}
          </div>
        `;
        infoRef.current!.setContent(html);
        infoRef.current!.open({ anchor: marker, map: mapRef.current! });
      });

      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
    }

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds);
      // clamp zoom so we don't zoom into a roof
      const listener = google.maps.event.addListenerOnce(mapRef.current, "bounds_changed", () => {
        if (mapRef.current!.getZoom()! > 16) mapRef.current!.setZoom(16);
      });
      setTimeout(() => google.maps.event.removeListener(listener), 1000);
    }
  }, [points]);

  const summary = useMemo(() => {
    const total = points.length;
    return `${total} call${total === 1 ? "" : "s"} plotted`;
  }, [points]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Coverage map</h1>
        <p className="small">Pins show logged calls with coordinates. Filter by rep and date window.</p>
      </section>

      <section className="card">
        <div className="flex" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label className="po-field">
            <span>Rep</span>
            <select value={rep} onChange={e => setRep(e.target.value)} className="input">
              <option value="">All reps</option>
              {reps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          <label className="po-field">
            <span>Window</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="input">
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
            </select>
          </label>

          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>

          <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 12 }}>{summary}</div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div ref={mapEl} style={{ width: "100%", height: "70vh" }} />
      </section>

      {error && <div className="card" style={{ color: "#991b1b", borderColor: "#fecaca" }}>{error}</div>}
    </div>
  );
}

// tiny sanitizer for info window
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
}
