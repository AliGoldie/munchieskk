// Runs after `vite build` (npm "postbuild"). Turns the single-page-app shell
// into one HTML file per public page, each with its own title, description,
// canonical link, social-share tags and structured data, plus a plain-text
// fallback for browsers/crawlers without JavaScript. Also writes sitemap.xml.
//
// Why: Facebook / WhatsApp / X link previews and some search crawlers do not
// run JavaScript, so without this every link would show the home page's
// details. (Google does run JavaScript; the running app keeps the same
// values up to date through RouteSeo.)
//
// dist/index.html  -> "/"           dist/menu.html -> "/menu"  (cleanUrls)
import fs from 'node:fs';
import path from 'node:path';
import { SITE, ROUTE_SEO } from '../src/config/seoConfig.js';
import { restaurantSchema, cateringSchema } from '../src/config/seoSchema.js';

const dist = path.resolve('dist');
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const START = '<!--seo:start-->';
const END = '<!--seo:end-->';
if (!template.includes(START) || !template.includes(END)) {
  throw new Error('index.html is missing the <!--seo:start--> / <!--seo:end--> markers');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (id, data) =>
  `<script type="application/ld+json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function headFor(route, seo) {
  const canonical = `${SITE.url}${route === '/' ? '/' : route}`;
  const image = `${SITE.url}${SITE.ogImage}`;
  const lines = [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE.name)}" />`,
    `<meta property="og:locale" content="${SITE.locale}" />`,
    `<meta property="og:title" content="${esc(seo.title)}" />`,
    `<meta property="og:description" content="${esc(seo.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="${SITE.ogImageWidth}" />`,
    `<meta property="og:image:height" content="${SITE.ogImageHeight}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(seo.title)}" />`,
    `<meta name="twitter:description" content="${esc(seo.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];
  if (route === '/' || route === '/menu') lines.push(jsonLd('ld-restaurant', restaurantSchema()));
  if (route === '/catering') lines.push(jsonLd('ld-catering', cateringSchema()));
  return lines.map((l) => `    ${l}`).join('\n');
}

function noscriptFor(route, seo) {
  const h1 = route === '/' ? 'MunchiesKK: smash burgers in Kota Kinabalu, Sabah' : seo.title.split(' | ')[0].split(': ')[0];
  return `<noscript>
      <main style="font-family:sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">
        <h1>${esc(h1)}</h1>
        <p>${esc(seo.description)}</p>
        <p><a href="/menu">Menu</a> · <a href="/catering">Catering</a> · <a href="https://wa.me/${SITE.phone.replace('+', '')}">WhatsApp ${esc(SITE.phone)}</a></p>
        <p>Please turn on JavaScript to order online.</p>
      </main>
    </noscript>`;
}

const written = [];
for (const [route, seo] of Object.entries(ROUTE_SEO)) {
  let html = template.replace(
    new RegExp(`${START}[\\s\\S]*?${END}`),
    `${START}\n${headFor(route, seo)}\n    ${END}`
  );
  html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    ${noscriptFor(route, seo)}`);
  const file = route === '/' ? 'index.html' : `${route.slice(1)}.html`;
  fs.writeFileSync(path.join(dist, file), html);
  written.push(file);
}

const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.entries(ROUTE_SEO).map(([route, seo]) => `  <url>
    <loc>${SITE.url}${route === '/' ? '/' : route}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${seo.changefreq}</changefreq>
    <priority>${seo.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
console.log(`[seo] wrote ${written.join(', ')} and sitemap.xml`);
