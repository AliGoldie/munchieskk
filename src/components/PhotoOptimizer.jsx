import { useState } from 'react';
import { ImageDown } from 'lucide-react';

const STORAGE_MARK = '/storage/v1/object/public/menu-images/';
const MIN_BYTES = 150 * 1024; // only touch photos bigger than this

// One-off clean-up for photos uploaded before uploads were compressed.
// Runs in the admin's browser (which can reach Supabase storage): downloads
// each big menu/add-on photo, uploadImage() shrinks it to WebP, and the item
// is pointed at the new file. The old file stays in storage, untouched.
export default function PhotoOptimizer({ menu, addons, uploadImage, updateMenuItem, updateAddon }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');

  const run = async () => {
    const targets = [
      ...(menu || []).map(m => ({ kind: 'menu', id: m.id, name: m.name, url: m.image })),
      ...(addons || []).map(a => ({ kind: 'addon', id: a.id, name: a.name, url: a.image })),
    ].filter(t => typeof t.url === 'string' && t.url.includes(STORAGE_MARK) && !/\.webp(\?|$)/i.test(t.url));

    if (targets.length === 0) { setStatus('All photos are already optimised.'); return; }
    if (!window.confirm(`Check ${targets.length} photo(s) and shrink the big ones? This can take a minute. Keep this page open.`)) return;

    setRunning(true);
    // Several items can share one photo: shrink each file once.
    const done = new Map();
    let shrunk = 0, savedBytes = 0, skipped = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      setStatus(`Checking ${i + 1} of ${targets.length}: ${t.name}`);
      try {
        let newUrl = done.get(t.url);
        if (newUrl === undefined) {
          const res = await fetch(t.url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (blob.size < MIN_BYTES) {
            done.set(t.url, null);
            skipped++;
            continue;
          }
          const file = new File([blob], t.url.split('/').pop().split('?')[0], { type: blob.type });
          newUrl = await uploadImage(file);
          done.set(t.url, newUrl);
          // uploadImage keeps the original when it can't make it smaller
          if (newUrl && !/\.webp(\?|$)/i.test(newUrl)) { skipped++; continue; }
          savedBytes += blob.size;
          shrunk++;
        }
        if (!newUrl) continue;
        if (t.kind === 'menu') await updateMenuItem(t.id, { image: newUrl });
        else await updateAddon(t.id, { image: newUrl });
      } catch (e) {
        console.warn('[PhotoOptimizer]', t.name, e);
        failed++;
      }
    }
    setRunning(false);
    setStatus(`Done. ${shrunk} photo(s) shrunk${shrunk ? ` (were ${Math.round(savedBytes / 1024)} KB in total)` : ''}, ${skipped} already small${failed ? `, ${failed} failed (see console)` : ''}.`);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', margin: '0 0 1rem' }}>
      <button type="button" className="btn btn-sm btn-secondary" onClick={run} disabled={running}>
        <ImageDown size={14} /> {running ? 'Optimising…' : 'Optimise photos'}
      </button>
      <span className="text-muted" style={{ fontSize: '0.78rem' }}>
        {status || 'Shrinks big menu & add-on photos so the site loads faster. New uploads are shrunk automatically.'}
      </span>
    </div>
  );
}
