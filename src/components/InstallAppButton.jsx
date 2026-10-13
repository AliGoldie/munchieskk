import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useInstallApp } from '../hooks/useInstallApp';
import './InstallAppButton.css';

const DISMISS_KEY = 'munchies_install_dismissed';

// "Install app": one tap puts the MunchiesKK icon on the phone's home screen.
//   variant="card"   -> a small dismissible card, only where the browser can install
//   variant="button" -> an always-available button (hidden once installed)
export default function InstallAppButton({ variant = 'button' }) {
  const { standalone, isIOS, canPrompt, install } = useInstallApp();
  const [help, setHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (standalone) return null;
  if (variant === 'card' && (dismissed || !(canPrompt || isIOS))) return null;

  const onClick = async () => {
    if (isIOS) { setHelp(true); return; }
    const result = await install();
    if (result === 'help') setHelp(true);
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div className={`install-app install-app-${variant}`}>
      {variant === 'card' && (
        <button type="button" className="install-app-x" onClick={dismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
      <div className="install-app-row">
        <div className="install-app-text">
          <strong>Add MunchiesKK to your home screen</strong>
          <span>One tap to reorder and play.</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm install-app-btn" onClick={onClick}>
          <Download size={16} /> Install app
        </button>
      </div>
      {help && (
        <p className="install-app-help">
          {isIOS
            ? "Tap the Share button at the bottom of Safari, then 'Add to Home Screen'."
            : "Open your browser menu and tap 'Install app' or 'Add to Home screen'."}
        </p>
      )}
    </div>
  );
}
