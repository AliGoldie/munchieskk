// schema.org structured data ("rich" business info for Google). Built from
// live data where it can change (opening hours, prices), so what Google reads
// always matches what customers see. Plain JS so the build script can reuse it.

import { SITE } from './seoConfig.js';
import { SLIDER_TRAYS, SLIDERS_PER_TRAY, FRIES_TRAY } from './cateringConfig.js';

const DAYS = [
  ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'],
  ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday'],
];

const abs = (path) => (path.startsWith('http') ? path : `${SITE.url}${path}`);

export function openingHoursFromSchedule(weeklySchedule) {
  if (!weeklySchedule) return undefined;
  const specs = [];
  for (const [key, name] of DAYS) {
    const day = weeklySchedule[key];
    if (day && day.enabled !== false && day.open && day.close) {
      specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: name, opens: day.open, closes: day.close });
    }
  }
  return specs.length ? specs : undefined;
}

export function restaurantSchema({ weeklySchedule, minPriceCents, maxPriceCents } = {}) {
  const address = {
    '@type': 'PostalAddress',
    addressLocality: SITE.locality,
    addressRegion: SITE.region,
    addressCountry: SITE.country,
  };
  if (SITE.streetAddress) address.streetAddress = SITE.streetAddress;
  if (SITE.postalCode) address.postalCode = SITE.postalCode;

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${SITE.url}/#restaurant`,
    name: SITE.name,
    url: `${SITE.url}/`,
    image: abs(SITE.ogImage),
    logo: abs('/images/logo.png'),
    telephone: SITE.phone,
    description: 'Smash burgers, loaded fries and sharing platters in Kota Kinabalu, Sabah. Order online for pickup or GrabFood delivery.',
    servesCuisine: ['Burgers', 'Fast food', 'Loaded fries', 'Sabahan'],
    address,
    areaServed: { '@type': 'City', name: SITE.locality },
    hasMenu: `${SITE.url}/menu`,
    acceptsReservations: false,
    sameAs: SITE.sameAs,
    potentialAction: {
      '@type': 'OrderAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/menu`, actionPlatform: ['http://schema.org/DesktopWebPlatform', 'http://schema.org/MobileWebPlatform'] },
      deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModePickUp',
    },
  };
  if (SITE.latitude != null && SITE.longitude != null) {
    data.geo = { '@type': 'GeoCoordinates', latitude: SITE.latitude, longitude: SITE.longitude };
  }
  if (minPriceCents != null && maxPriceCents != null) {
    data.priceRange = `RM${(minPriceCents / 100).toFixed(0)} - RM${(maxPriceCents / 100).toFixed(0)}`;
  } else {
    data.priceRange = 'RM';
  }
  const hours = openingHoursFromSchedule(weeklySchedule);
  if (hours) data.openingHoursSpecification = hours;
  return data;
}

// Menu with live items. `categories` = [{code,label}], items need name, category, price (cents).
export function menuSchema(menu = [], categories = []) {
  const labelFor = (code) => categories.find(c => c.code === code || c.label === code)?.label || code;
  const groups = new Map();
  for (const item of menu) {
    if (!item || !item.name || item.price == null) continue;
    const key = item.category || 'Menu';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  if (!groups.size) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': `${SITE.url}/menu#menu`,
    name: `${SITE.name} menu`,
    url: `${SITE.url}/menu`,
    inLanguage: 'en',
    hasMenuSection: [...groups.entries()].map(([code, items]) => ({
      '@type': 'MenuSection',
      name: labelFor(code),
      hasMenuItem: items.map(i => {
        const useDeal = i.promo_price != null && (!i.promo_end || new Date(i.promo_end) > new Date()) && (!i.promo_start || new Date(i.promo_start) <= new Date());
        const entry = {
          '@type': 'MenuItem',
          name: i.name,
          offers: {
            '@type': 'Offer',
            price: ((useDeal ? i.promo_price : i.price) / 100).toFixed(2),
            priceCurrency: 'MYR',
            availability: i.in_stock === false || i.inStock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
          },
        };
        if (i.description) entry.description = i.description;
        if (i.image && /^(\/|https?:)/.test(i.image)) entry.image = abs(i.image);
        return entry;
      }),
    })),
  };
}

export function cateringSchema() {
  const offers = [...SLIDER_TRAYS, FRIES_TRAY].map(t => ({
    '@type': 'Offer',
    name: `${t.name} (${t.contents})`,
    price: (t.price / 100).toFixed(2),
    priceCurrency: 'MYR',
    availability: 'https://schema.org/InStock',
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SITE.url}/catering#service`,
    serviceType: 'Slider catering',
    name: `${SITE.name} slider catering`,
    description: `Catering packs of ${SLIDERS_PER_TRAY} sliders for offices, birthdays and kenduri in Kota Kinabalu. Book at least 5 days ahead.`,
    url: `${SITE.url}/catering`,
    provider: { '@id': `${SITE.url}/#restaurant` },
    areaServed: { '@type': 'City', name: SITE.locality },
    hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Catering packs', itemListElement: offers },
  };
}
