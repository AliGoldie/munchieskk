import { LOCAL_VARIANTS } from './localImageVariants';

// Pick a right-sized copy of a menu photo.
//  - Photos in /images/ have pre-built thumbs/ (192px) and md/ (800px) WebP
//    copies (scripts/make-image-variants.py).
//  - Photos uploaded through Admin are saved as <name>.webp next to a
//    <name>-thumb.webp (192px) and <name>-md.webp (800px), so their
//    addresses can be worked out. Older uploads may have neither: <img>
//    callers pass onThumbError to fall back to the full photo.
const STORAGE_MARK = '/storage/v1/object/public/menu-images/';

function localName(src) {
  if (typeof src !== 'string' || !src.startsWith('/images/')) return null;
  const name = src.slice('/images/'.length);
  return LOCAL_VARIANTS.has(name) ? name.replace(/\.[^.]+$/, '') : null;
}

export function thumbSrc(src) {
  const local = localName(src);
  if (local) return `/images/thumbs/${local}.webp`;
  if (typeof src === 'string' && src.includes(STORAGE_MARK) && /\.webp$/i.test(src) && !/-(thumb|md)\.webp$/i.test(src)) {
    return src.replace(/\.webp$/i, '-thumb.webp');
  }
  return src;
}

// Card-size copy for an <img> (pair with onThumbError). Unlike mediumSrc it
// may point at a file that doesn't exist yet, so it is not for CSS backgrounds.
export function cardSrc(src) {
  const local = localName(src);
  if (local) return `/images/md/${local}.webp`;
  if (typeof src === 'string' && src.includes(STORAGE_MARK) && /\.webp$/i.test(src) && !/-(thumb|md)\.webp$/i.test(src)) {
    return src.replace(/\.webp$/i, '-md.webp');
  }
  return src;
}

// Preload photos and resolve with the first of `candidates` that loads (or
// null), so a CSS background can swap in without a blank flash.
export function loadFirst(candidates) {
  return new Promise((resolve) => {
    const list = candidates.filter(Boolean);
    const next = (i) => {
      if (i >= list.length) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(list[i]);
      img.onerror = () => next(i + 1);
      img.src = list[i];
    };
    next(0);
  });
}

// Only ever returns a file that is known to exist (safe for CSS backgrounds).
export function mediumSrc(src) {
  const local = localName(src);
  return local ? `/images/md/${local}.webp` : src;
}

// onError for a thumbnail <img>: swap to the full photo once.
export function onThumbError(fullSrc) {
  return (e) => {
    const img = e.currentTarget;
    if (fullSrc && img.dataset.fellBack !== '1') {
      img.dataset.fellBack = '1';
      img.src = fullSrc;
    }
  };
}
