// app/saleshub/coverage-map/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export const dynamic = 'force-dynamic';

// ---- TS: let the compiler know about the Google Maps object & our loader promise
declare global {
  interface Window {
    google?: any;
    __gmapsLoader?: Promise<void>;
  }
}

// Simple loader that injects the Google Maps script once per page
function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoader) return window.__gmapsLoader;

  window.__gmapsLoader = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Maps JS API'));
    document.head.appendChild(s);
  });

  return window.__gmapsLoader;
}

type Rep = { id: string; name: string };
type CallPoint = {
  id: string;
  customerName?: string | null;
  latitude: number;
  longitude: number;
  repId?: string | null;
  repName?: string | null;
  createdAt?: string;
};

export default function CoverageMapPage() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [repId, setRepId] = useState<string>('');
  const [points, setPoints] = useState<CallPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  // Load reps list
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/sales-reps', { cache: 'no-store' });
        const data = await r.json();
        if (Array.isArray(data)) setReps(data);
      } catch (e: any) {
        console.error(e);
      }
    })();
  }, []);

  // Load call points for selected rep (or all)
  useEffect(() => {
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (repId) qs.set('repId', repId);
        const r = await fetch(`/api/calls/coverage?${qs.toString()}`, { cache: 'no-store' });
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || 'Failed to load coverage data');
        setPoints(Array.isArray(j.points) ? j.points : []);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, [repId]);

  // Init map once & update markers when points change
  useEffect(() => {
    if (!apiKey) {
      setError('Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (cancelled) return;

        // Create the map if needed
        if (!mapObj.current && mapRef.current && window.google?.maps) {
          mapObj.current = new window.google.maps.Map(mapRef.current, {
            center: { lat: 54.5, lng: -2.5 }, // UK-ish center
            zoom: 5,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
        }

        // Clear old markers
        markersRef.current.forEach(m => m.setMap(null));
        markersRef.current = [];

        if (!mapObj.current || !window.google?.maps) return;

        // Add markers
        const bounds = new window.google.maps.LatLngBounds();
        for (const p of points) {
          const pos = { lat: Number(p.latitude), lng: Number(p.longitude) };
          if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) continue;

          const marker = new window.google.maps.Marker({
            position: pos,
            map: mapObj.current,
            title: p.customerName || 'Call',
          });

          const info = new window.google.maps.InfoWindow({
            content: `
              <div style="min-width:200px">
                <div><strong>${p.customerName ?? 'Call'}</strong></div>
                ${p.repName ? `<div>Rep: ${p.repName}</div>` : ''}
                ${p.createdAt ? `<div>${new Date(p.createdAt).toLocaleString()}</div>` : ''}
              </div>
            `,
          });
          marker.addListener('click', () => info.open({ map: mapObj.current, anchor: marker }));

          markersRef.current.push(marker);
          bounds.extend(pos);
        }

        if (points.length > 0) {
          mapObj.current.fitBounds(bounds);
        }
      } catch (e: any) {
        console.error(e);
        setError(String(e?.message ?? e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiKey, points]);

  const repOptions = useMemo(
    () => [{ id: '', name: 'All reps' }, ...reps],
    [reps]
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Coverage Map</h1>
        <p className="small">Filter by rep to see where calls have been logged.</p>
      </section>

      <section className="card" style={{ padding: 12 }}>
        <label className="small" style={{ display: 'inline-block', minWidth: 220 }}>
          Sales rep
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            style={{ marginLeft: 8, padding: '6px 8px' }}
          >
            {repOptions.map(r => (
              <option key={r.id || 'all'} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        {loading && <span className="small" style={{ marginLeft: 12 }}>Loading…</span>}
        {error && <div className="small" style={{ color: '#b91c1c', marginTop: 8 }}>{error}</div>}
      </section>

      <section className="card" style={{ padding: 0 }}>
        <div ref={mapRef} style={{ width: '100%', height: '70vh' }} />
      </section>
    </div>
  );
}
