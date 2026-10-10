import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Gamepad2, X } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';
import SocialFillIcons from './SocialFillIcons';
import './CateringPausedModal.css';

// Shown on /catering while Admin has catering switched off. The customer can
// still close it to look at the packs, but the form can't be sent.
export default function CateringPausedModal({ loggedIn, onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const waUrl = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent("Hi MunchiesKK! I'd like to ask about catering.")}`;

  return (
    <div className="cpm-backdrop" onClick={onClose}>
      <div
        className="cpm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="cpm-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <p className="cpm-eyebrow">SLIDER CATERING</p>
        <h2 id="cpm-title">We're taking a short break from catering</h2>
        <p className="cpm-text">
          Sorry! We're not accepting catering orders right now. We'll be back soon.
          Planning something? Message us and we'll do our best to help.
        </p>

        <a href={waUrl} target="_blank" rel="noopener noreferrer" className="cpm-wa">
          <MessageCircle size={18} /> Chat with us on WhatsApp
        </a>

        <div className="cpm-block">
          <p className="cpm-block-title">Follow us. Win stuff.</p>
          <p className="cpm-block-text">Like our page for giveaways and the first heads-up when catering opens again.</p>
          <SocialFillIcons />
        </div>

        <div className="cpm-block cpm-block--arcade">
          <Gamepad2 size={22} className="cpm-arcade-icon" />
          <div>
            <p className="cpm-block-title">Members play. Members win.</p>
            <p className="cpm-block-text">Join MunchiesKK for free and play our arcade games to win points, free food and prizes.</p>
            <Link to={loggedIn ? '/arcade' : '/signup'} className="cpm-arcade-link">
              {loggedIn ? 'Play the arcade' : 'Join free'} &rarr;
            </Link>
          </div>
        </div>

        <button type="button" className="cpm-browse" onClick={onClose}>Just browsing the packs</button>
      </div>
    </div>
  );
}
