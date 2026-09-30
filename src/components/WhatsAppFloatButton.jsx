import { WhatsAppIcon } from './icons';
import { siteConfig } from '../config/siteConfig';

// Small persistent contact shortcut, bottom-left. Deliberately NOT bottom-
// right: CookingPopup.jsx (the live "your order is cooking" card) already
// owns that corner whenever a customer has an active order, up to 300px
// wide -- placing this there too would overlap it.
export default function WhatsAppFloatButton() {
  const href = `https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="whatsapp-float-btn"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
    >
      <WhatsAppIcon size={26} color="#fff" />
    </a>
  );
}
