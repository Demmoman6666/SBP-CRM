// app/saleshub/coverage-map/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: any;
    __gmapsLoader?: Promise<void>;
    __onGMapsReady?: () => void;
  }
}

function loadGoogleMaps(apiKey: string) {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsLoader) return window.__gmapsLoader;

  window.__gmapsLoader = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__onGMapsReady`;
    s.async = true;
    window.__onGMapsReady = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
  return window.__gmapsLoader;
}

type MarkerRow = {
  lat: number | string;
  lng: number | string;
  rep?: string | null;
  infoHtml?: string | null;
};

export default function CoverageMapPage() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [repOptions, setRepOptions] = useState<string[]>([]);
  const [repFilter, setRepFilter] = useState<string>(''); // empty = All reps

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  // Load Google Maps
  useEffect(() => {
    (async () => {
      try {
        await loadGoogleMaps(apiKey);
        if (!mapDivRef.current) return;
        mapRef.current = new window.google.maps.Map(mapDivRef.current, {
          center: { lat: 52.5, lng: -2.5 },
          zoom: 6,
          streetViewControl: false,
          mapTypeControl: false,
        });
      } catch (e) {
        console.error('Google Maps load failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [apiKey]);

  // Load rep options (handle multiple API shapes)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sales-reps', { cache: 'no-store' });
        const data = await res.json();

        let names: string[] = [];
        if (Array.isArray(data)) {
          names = typeof data[0] === 'string' ? (data as string[]) : (data as any[]).map((r) => r?.name);
        } else if (Array.isArray(data?.reps)) {
          names = typeof data.reps[0] === 'string' ? (data.reps as string[]) : (data.reps as any[]).map((r) => r?.name);
        }

        const dedup = Array.from(new Set(names.map((n) => String(n || '').trim()).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        setRepOptions(dedup);
      } catch (e) {
        console.error('Failed to load reps:', e);
        setRepOptions([]);
      }
    })();
  }, []);

  // Load markers for current filter
  async function loadMarkers(rep: string) {
    try {
      const qs = new URLSearchParams();
      if (rep) {
        qs.set('rep', rep);   // current endpoint
        qs.set('staff', rep); // compatibility with older endpoints
      }
      // Optional, but helps if backend supports time windows:
      // qs.set('days', '365');

      const res = await fetch(`/api/saleshub/calls-geo?${qs.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      const rows: MarkerRow[] = json?.rows ?? [];

      // clear old
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      if (!mapRef.current || !window.google?.maps) return;

      const bounds = new window.google.maps.LatLngBounds();
      const info = new window.google.maps.InfoWindow();

      for (const r of rows) {
        const lat = Number((r as any).lat);
        const lng = Number((r as any).lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // ← robust coercion

        const marker = new window.google.maps.Marker({
          position: { lat, lng },
          map: mapRef.current,
        });
        markersRef.current.push(marker);
        bounds.extend(marker.getPosition());

        if (r.infoHtml) {
          marker.addListener('click', () => {
            info.setContent(String(r.infoHtml));
            info.open({ map: mapRef.current, anchor: marker });
          });
        }
      }

      if (markersRef.current.length > 0) {
        mapRef.current.fitBounds(bounds);
        const listener = window.google.maps.event.addListenerOnce(mapRef.current, 'bounds_changed', () => {
          if (mapRef.current.getZoom() > 15) mapRef.current.setZoom(12);
        });
        setTimeout(() => window.google.maps.event.removeListener(listener), 0);
      }
    } catch (e) {
      console.error('Failed to load markers:', e);
    }
  }

  // initial + on change
  useEffect(() => {
    if (!loading) loadMarkers(repFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, repFilter]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h1>Coverage map</h1>
        <p className="small">View logged calls; filter by sales rep.</p>
      </section>

      <section className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label className="po-field" style={{ width: 320 }}>
          <span>Sales rep</span>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All reps</option>
            {repOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div ref={mapDivRef} style={{ width: '100%', height: 560 }} />
      </section>
    </div>
  );
}
