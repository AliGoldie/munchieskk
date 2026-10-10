// Single source of truth for how each page appears in Google and when a link
// is shared (WhatsApp, Facebook...). Used by the running app (RouteSeo), and
// by scripts/prerender-seo.mjs at build time so the same text is baked into
// each page's HTML for crawlers and link previews that don't run JavaScript.
//
// Plain JS (no JSX, no imports) so Node can load it too.

import { SLIDER_TRAYS, SLIDERS_PER_TRAY } from './cateringConfig.js';

export const SITE = {
  url: 'https://www.munchieskk.my',
  name: 'MunchiesKK',
  locale: 'en_MY',
  phone: '+60103818100',
  locality: 'Kota Kinabalu',
  region: 'Sabah',
  country: 'MY',
  // Add when known so Google can show the exact pin: street, postcode, coords.
  streetAddress: '',
  postalCode: '',
  latitude: null,
  longitude: null,
  ogImage: '/og-image.jpg',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  sameAs: [
    'https://www.instagram.com/munchieskk.burger/',
    'https://www.facebook.com/munchieskk.burger',
    'https://www.tiktok.com/@munchieskk',
    'https://www.threads.com/@munchieskk.burger',
  ],
};

const cheapestPack = Math.min(...SLIDER_TRAYS.map(t => t.price)) / 100;

export const ROUTE_SEO = {
  '/': {
    title: 'MunchiesKK | Smash Burgers in Kota Kinabalu, Sabah',
    description: "MunchiesKK serves hand-pressed smash burgers, loaded fries and sharing platters in Kota Kinabalu, Sabah. Order online for pickup or GrabFood delivery.",
    changefreq: 'daily',
    priority: '1.0',
  },
  '/menu': {
    title: 'Menu: Burgers, Fries & Platters | MunchiesKK Kota Kinabalu',
    description: 'The full MunchiesKK menu: smash burgers, Sabah-style Sumandak, loaded Monsta Fries, platters and drinks. Order online for pickup in Kota Kinabalu.',
    changefreq: 'daily',
    priority: '0.9',
  },
  '/catering': {
    title: 'Slider Catering in Kota Kinabalu | MunchiesKK',
    description: `Slider catering packs in Kota Kinabalu: ${SLIDERS_PER_TRAY} sliders per pack from RM${cheapestPack}. Book 5 days ahead for office lunches, birthdays and kenduri.`,
    changefreq: 'weekly',
    priority: '0.8',
  },
  '/loyalty': {
    title: 'Rewards & Prize Vault | MunchiesKK',
    description: 'Join MunchiesKK free: earn points on every order and unlock free burgers, fries and drinks from the Prize Vault.',
    changefreq: 'weekly',
    priority: '0.5',
  },
};

// Pages that should never be indexed (private, per-user or transactional).
export const NOINDEX_PREFIXES = [
  '/admin', '/cart', '/payment', '/profile', '/order', '/login', '/signup',
  '/reset-password', '/arcade',
];

export function normalizePath(pathname) {
  const p = (pathname || '/').split('?')[0].split('#')[0];
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
}

// What the <head> should say for a path.
export function seoForPath(pathname) {
  const path = normalizePath(pathname);
  const known = ROUTE_SEO[path];
  if (known) {
    return { ...known, path, canonical: `${SITE.url}${path === '/' ? '/' : path}`, robots: 'index, follow', known: true };
  }
  const isPrivate = NOINDEX_PREFIXES.some(p => path === p || path.startsWith(`${p}/`));
  return {
    title: isPrivate ? `${SITE.name}` : `Page not found | ${SITE.name}`,
    description: ROUTE_SEO['/'].description,
    path,
    canonical: null,
    robots: 'noindex, nofollow',
    known: false,
  };
}
