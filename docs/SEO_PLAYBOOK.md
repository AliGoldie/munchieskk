# SEO playbook: MunchiesKK

Goal: show up when people in Sabah search for burgers and local food.
Honest expectation: nobody can guarantee a #1 spot. Google ranks local food
searches mostly on the **Google Business Profile** (the map pack), reviews and
local links, and only then on the website. The website work below makes sure the
site is never the thing holding you back; the checklist further down is where
most of the ranking is won.

## Done in code (this branch)

- Each public page (`/`, `/menu`, `/catering`, `/loyalty`) has its own title,
  description, canonical link, WhatsApp/Facebook link preview and structured
  data, baked into the static HTML so crawlers and link previews that do not run
  JavaScript still see them. Source of truth: `src/config/seoConfig.js`.
- Structured data (schema.org): Restaurant with **live opening hours** and
  price range, the full **Menu** with live prices and stock, and the catering
  **packs with prices**. Built in `src/config/seoSchema.js`.
- `sitemap.xml` (regenerated on every build) and `robots.txt` pointing to it;
  private pages (admin, cart, profile, login...) and unknown URLs are `noindex`.
- A real "Page not found" page instead of showing the home page for any URL.
- Share image (`/og-image.jpg`, 1200x630), `lang="en-MY"`, theme colour.
- Plain-language "Burgers made in Kota Kinabalu" section on the home page with
  links to the menu, catering and rewards.
- Speed work (images, fonts, layout shift) also counts: speed is a ranking input.

## Needed from you (the site cannot know these)

1. **Street address, postcode and map pin** of the kitchen. Add them in
   `SITE` in `src/config/seoConfig.js` (`streetAddress`, `postalCode`,
   `latitude`, `longitude`) and Google will show the exact location.
2. **Confirm the Threads address** `threads.com/@munchieskk.burger`.

## Do these this week (biggest impact first)

1. **Google Business Profile** (business.google.com). Claim it, set category
   "Hamburger restaurant" (plus "Fast food restaurant"), exact address and pin,
   the same opening hours as the site, phone 010-381 8100, website
   `https://www.munchieskk.my/`, menu link `/menu`, order link `/menu`. Add 20+
   real photos (food, kitchen, team, exterior), post an update weekly.
2. **Reviews.** Ask every happy customer for a Google review (you already have the
   direct link in `siteConfig.googleReviewUrl`; put it on the receipt, WhatsApp
   order confirmation and a counter QR code). Reply to every review. Review
   count, rating and freshness are the strongest local signal.
3. **Google Search Console** (search.google.com/search-console): add
   `https://www.munchieskk.my/`, verify (DNS record at Exabytes), submit
   `sitemap.xml`, then use URL Inspection > Request indexing on `/`, `/menu`,
   `/catering`. Do the same in **Bing Webmaster Tools** (it also feeds
   ChatGPT/Copilot search).
4. **Same name, address, phone everywhere.** "MunchiesKK", the same address and
   010-381 8100 on Facebook, Instagram, TikTok, Threads, Tripadvisor, GrabFood,
   Foodpanda, Apple Maps (Apple Business Connect) and Bing Places.
5. **Local links.** Ask Sabah food bloggers, KK food Facebook groups and
   Instagram foodies, event organisers, office parks and schools you cater for to
   link to `munchieskk.my`. A handful of real local links beats hundreds of
   directories.

## Keep doing

- Post on Instagram/TikTok/Threads and tag the location (Kota Kinabalu); link the
  site in every bio.
- Check Search Console monthly: which searches show you, which pages are indexed,
  any errors. Look for "burger kota kinabalu", "burger near me", "makanan sabah".
- When the menu or hours change, nothing to do on the site: schema and menu read
  live data. Update the Google Business Profile hours too.
- After each deploy, spot-check a link preview (paste `/menu` into WhatsApp) and
  the Rich Results Test (search.google.com/test/rich-results) on the home page.

## Not worth doing

- Keyword stuffing, hidden text, buying links, fake reviews (all can get the
  business profile suspended).
- A blog for its own sake. If you add content, make it genuinely useful, such as
  "Sabahan burger flavours explained" or catering guides.
