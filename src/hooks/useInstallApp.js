import { useEffect, useState } from 'react';

// Captures the browser's "install app" prompt as early as possible (this module
// is imported from main.jsx), so a button anywhere in the app can use it later.
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function useInstallApp() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const standalone = typeof window !== 'undefined'
    && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canPrompt = !!deferredPrompt;

  // One tap installs where the browser allows it; otherwise returns 'help' so
  // the button can show how to add it from the browser menu.
  const install = async () => {
    if (!deferredPrompt) return 'help';
    deferredPrompt.prompt();
    let outcome = 'dismissed';
    try { outcome = (await deferredPrompt.userChoice).outcome; } catch { /* ignore */ }
    deferredPrompt = null;
    notify();
    return outcome;
  };

  return { standalone, isIOS, canPrompt, install };
}
