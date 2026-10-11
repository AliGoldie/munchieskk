import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../contexts/StoreContext';
import { SITE, seoForPath } from '../config/seoConfig';
import { restaurantSchema, menuSchema, cateringSchema } from '../config/seoSchema';

// Keeps the page <head> (title, description, canonical, social-share tags and
// structured data) correct as the customer moves around the app. The same
// values are also baked into each page's static HTML at build time
// (scripts/prerender-seo.mjs); this takes over once the app is running, and
// adds the live parts (today's opening hours, menu prices).

function setMeta(attr, key, value) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (value == null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', value);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(id, data) {
  let el = document.getElementById(id);
  if (!data) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export default function RouteSeo() {
  const { pathname } = useLocation();
  const { menu, categoriesList, shopSettings } = useStore();

  useEffect(() => {
    const seo = seoForPath(pathname);
    document.title = seo.title;
    setMeta('name', 'description', seo.description);
    setMeta('name', 'robots', seo.robots);
    setCanonical(seo.canonical);

    const image = `${SITE.url}${SITE.ogImage}`;
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', SITE.name);
    setMeta('property', 'og:locale', SITE.locale);
    setMeta('property', 'og:title', seo.title);
    setMeta('property', 'og:description', seo.description);
    setMeta('property', 'og:url', seo.canonical);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:image:width', String(SITE.ogImageWidth));
    setMeta('property', 'og:image:height', String(SITE.ogImageHeight));
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', seo.title);
    setMeta('name', 'twitter:description', seo.description);
    setMeta('name', 'twitter:image', image);
  }, [pathname]);

  useEffect(() => {
    const path = seoForPath(pathname).path;
    const prices = (menu || []).map(i => i.price).filter(p => typeof p === 'number' && p > 0);
    const business = restaurantSchema({
      weeklySchedule: shopSettings?.weeklySchedule,
      minPriceCents: prices.length ? Math.min(...prices) : undefined,
      maxPriceCents: prices.length ? Math.max(...prices) : undefined,
    });
    // The business appears on the pages that are about the shop itself.
    setJsonLd('ld-restaurant', path === '/' || path === '/menu' ? business : null);
    setJsonLd('ld-menu', path === '/menu' ? menuSchema(menu, categoriesList) : null);
    setJsonLd('ld-catering', path === '/catering' ? cateringSchema() : null);
  }, [pathname, menu, categoriesList, shopSettings]);

  return null;
}
