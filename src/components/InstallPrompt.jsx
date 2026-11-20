import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Share, X } from 'lucide-react';
import { useInstallApp } from '../hooks/useInstallApp';
import './InstallPrompt.css';

// A slim banner under the header that offers "install the app". It waits a
// little, never interrupts checkout, login or the admin screens, goes away for
// two weeks when closed, and never shows once the app is installed.
// A link with ?install=1 (for a poster QR code) shows it straight away.
const KEY = 'munchies_install_prompt_until';
const WAIT_MS = 12000;
const SNOOZE_MS = 14 * 24 * 3600 * 1000;
const QUIET_ROUTES = [/^\/admin/, /^\/(cart|payment)/, /^\/order\//, /^\/(login|signup|reset-password)/];

const snoozed = () => {
  try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch { return false; }
};

export default function InstallPrompt() {
  const { pathname, search } = useLocation();
  const { standalone, isIOS, canPrompt, install } = useInstallApp();
  const forced = new URLSearchParams(search).get('install') === '1';
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (forced) { setReady(true); return undefined; }
    const t = setTimeout(() => setReady(true), WAIT_MS);
    return () => clearTimeout(t);
  }, [forced]);

  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const canOffer = canPrompt || isIOS || isAndroid;
  const quiet = QUIET_ROUTES.some((r) => r.test(pathname));

  if (standalone || closed || quiet || !ready || !canOffer) return null;
  if (!forced && snoozed()) return null;

  const close = () => {
    try { localStorage.setItem(KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    setClosed(true);
  };
  const onInstall = async () => {
    if (isIOS) { setHelp(true); return; }
    const result = await install();
    if (result === 'help') setHelp(true);
    else setClosed(true);
  };

  return (
    <div className="install-prompt" role="region" aria-label="Install the MunchiesKK app">
      <img className="install-prompt-icon" src="/icons/icon-192.png" alt="" width="44" height="44" />
      <div className="install-prompt-text">
        <strong>Get the MunchiesKK app</strong>
        <span>One tap to reorder, collect coins and play.</span>
        {help && (
          <span className="install-prompt-help">
            {isIOS
              ? <>Tap <Share size={14} aria-label="Share" /> at the bottom of Safari, then &lsquo;Add to Home Screen&rsquo;.</>
              : <>Open your browser menu and choose &lsquo;Install app&rsquo; or &lsquo;Add to Home screen&rsquo;.</>}
          </span>
        )}
      </div>
      <button type="button" className="install-prompt-btn" onClick={onInstall}>
        <Download size={15} /> {isIOS ? 'How to install' : 'Install'}
      </button>
      <button type="button" className="install-prompt-x" onClick={close} aria-label="Not now">
        <X size={16} />
      </button>
    </div>
  );
}
