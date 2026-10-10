import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed } from 'lucide-react';
import './DeliveryMap.css';
import { pinLinks } from '../utils/mapLinks';

// Kota Kinabalu city centre: where the map opens before a pin is set.
const KK_CENTER = [5.9804, 116.0735];
const START_ZOOM = 13;
const PINNED_ZOOM = 17;

// The pin is fixed at the centre of the map and the customer drags the map
// under it (Grab/Uber style). On a phone that is far easier than hitting a
// small draggable marker, and it never needs marker image assets.
export default function DeliveryMap({ value, onChange, onAddressSuggestion }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const geocodeTimer = useRef(null);
  const onChangeRef = useRef(onChange);
  const onSuggestRef = useRef(onAddressSuggestion);
  // The default city-centre view is not the customer's location, so the
  // centre only counts as a pin once they've dragged the map or used GPS.
  const pinnedRef = useRef(Boolean(value));
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');

  onChangeRef.current = onChange;
  onSuggestRef.current = onAddressSuggestion;

  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: value ? [value.lat, value.lng] : KK_CENTER,
      zoom: value ? PINNED_ZOOM : START_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    const report = () => {
      const c = map.getCenter().wrap();
      onChangeRef.current({ lat: c.lat, lng: c.lng });
      // Reverse-geocode to suggest a street address. OpenStreetMap's
      // Nominatim allows ~1 request/second, so wait until the map has been
      // still for a moment rather than querying on every drag.
      clearTimeout(geocodeTimer.current);
      geocodeTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat}&lon=${c.lng}&zoom=18&addressdetails=0&accept-language=en`,
            { signal: AbortSignal.timeout(6000) }
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.display_name) onSuggestRef.current?.(data.display_name);
        } catch {
          // Address suggestion is a convenience only; the pin itself is what matters.
        }
      }, 1200);
    };

    // moveend fires after a drag, a zoom (pinch zoom shifts the centre) and
    // the GPS setView once its animation finishes -- so the reported centre
    // is always the settled one.
    map.on('dragstart', () => { pinnedRef.current = true; });
    map.on('moveend', () => { if (pinnedRef.current) report(); });
    mapRef.current = map;

    // The map sits in a form that can reflow (e.g. the address field
    // appears); re-measure so tiles don't render half-grey.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      clearTimeout(geocodeTimer.current);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    setLocateError('');
    if (!navigator.geolocation) {
      setLocateError('Your browser can\'t share location. Drag the map to your spot instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        pinnedRef.current = true;
        map.setView([pos.coords.latitude, pos.coords.longitude], PINNED_ZOOM);
      },
      (err) => {
        setLocating(false);
        setLocateError(err.code === 1
          ? 'Location permission was blocked. Drag the map to your spot instead.'
          : 'Couldn\'t get your location. Drag the map to your spot instead.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const links = value ? pinLinks(value) : null;

  return (
    <div className="dmap">
      <div className="dmap-frame">
        <div ref={containerRef} className="dmap-map" role="application" aria-label="Map. Drag to place the pin on your delivery location." />
        <div className="dmap-pin" aria-hidden="true">
          <svg viewBox="0 0 24 36" width="34" height="50"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 36 12 36s12-15.2 12-24.1C24 5.3 18.6 0 12 0z" fill="#c73b0f" stroke="#1a1a1a" strokeWidth="1.5" /><circle cx="12" cy="12" r="4.5" fill="#FFC72C" stroke="#1a1a1a" strokeWidth="1.2" /></svg>
        </div>
        <div className="dmap-pin-shadow" aria-hidden="true" />
      </div>
      <div className="dmap-actions">
        <button type="button" className="dmap-locate" onClick={useMyLocation} disabled={locating}>
          <LocateFixed size={18} /> {locating ? 'Finding you...' : 'Use my current location'}
        </button>
        <p className={`dmap-status${value ? ' is-set' : ''}`} aria-live="polite">
          {value
            ? <>Pinned &middot; <a href={links.google} target="_blank" rel="noopener noreferrer">check on Google Maps</a></>
            : 'Drag the map so the pin sits on your delivery spot.'}
        </p>
      </div>
      {locateError && <p className="dmap-error" role="alert">{locateError}</p>}
    </div>
  );
}
