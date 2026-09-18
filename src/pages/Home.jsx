import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Gamepad2, Star, Users } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { getItemPoints } from '../utils/pointsCalculator';
import { formatTime12Hour } from '../utils/timeUtils';
import { loyaltyConfig } from '../config/loyaltyConfig';
import { siteConfig } from '../config/siteConfig';
import ItemModal from '../components/ItemModal';
import Modal from '../components/Modal';
import { BurgerIcon } from '../components/icons';
import { InstagramIcon, FacebookIcon, TiktokIcon } from '../components/SocialIcons';
import './Home.css';

const SOCIAL_ICONS = { instagram: InstagramIcon, facebook: FacebookIcon, tiktok: TiktokIcon };

// Category tag colors for the typographic menu -- text color on a dark
// pill, matching the actual 1b prototype (colored label text, not a
// colored pill fill). BBQ/PLATTERS/SIDES aren't specified in the
// prototype beyond PREMIUM/DRINKS, so they're picked from the same
// --munchies-* palette for a consistent family.
const CATEGORY_TAG_COLOR = {
  BBQ: 'var(--munchies-orange)',
  PREMIUM: 'var(--munchies-premium)',
  PLATTERS: 'var(--munchies-green-light)',
  SIDES: 'var(--munchies-yellow)',
  DRINKS: 'var(--munchies-blue)',
};
const CATEGORY_ORDER = ['BBQ', 'PREMIUM', 'PLATTERS', 'SIDES', 'DRINKS'];

// Real reviews from the Penampang Google Business listing (Munchies KK,
// 4.5 stars / 76 reviews), pulled 2026-09-18. Not live data -- update this
// list by hand if the business wants fresher quotes rotated in.
const GOOGLE_RATING = 4.5;
const GOOGLE_REVIEW_COUNT = 76;
const REVIEWS = [
  { quote: `It tasted absolutely delicious and the service was v good... Have ordered 4x from them and will definitely come back for more. Highly recommend the place.`, author: 'Mich. L.', dark: false },
  { quote: `Juicy burger! We had Sumandak Burger and Mushy Burger. Both were tasty. Will definitely come again!`, author: 'Shamiera Z.', dark: true },
  { quote: `Burger mantap! Patty juicy, generous portion! Sgt berbaloi.`, author: 'Stalin Umoe', dark: false },
  { quote: `About as close to burger heaven as you're going to get short of dying.`, author: 'Nor kron', dark: true },
  { quote: `5 star burger... the juiciness of the patty, the fresh vegetables, the cheese... you just can't stop eating after one bite.`, author: 'Queen Deziree', dark: false },
];

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function findByName(menu, name) {
  const needle = name.toLowerCase();
  return menu.find(m => m.name?.toLowerCase() === needle);
}

function findByPattern(list, pattern) {
  return list.find(x => pattern.test(x.name || ''));
}

export default function Home() {
  const {
    menu, addons, isPromoActive,
    points, loyaltyPrizes, shopSettings, isShopOpenNow,
  } = useStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedItem, setSelectedItem] = useState(null);
  const [dealCountdown, setDealCountdown] = useState('');

  // ---- Hero / sticky bar: one fixed signature item, not a rotation ----
  const heroItem = useMemo(
    () => findByName(menu, 'Sumandak Burger') || menu[0],
    [menu]
  );

  // ---- Real open/closed status (no fake urgency) ----
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todaySchedule = shopSettings?.weeklySchedule?.[todayKey];
  const openStr = todaySchedule?.enabled === false ? null : (todaySchedule?.open || shopSettings?.openingTime);
  const closeStr = todaySchedule?.enabled === false ? null : (todaySchedule?.close || shopSettings?.closingTime);
  const shopOpen = isShopOpenNow();

  // ---- Real deal countdown: soonest-ending active promo, or nothing ----
  const soonestPromoEnd = useMemo(() => {
    const ends = menu
      .filter(isPromoActive)
      .map(m => m.promo_end && new Date(m.promo_end))
      .filter(Boolean);
    if (ends.length === 0) return null;
    return new Date(Math.min(...ends.map(d => d.getTime())));
  }, [menu, isPromoActive]);

  useEffect(() => {
    if (!soonestPromoEnd) { setDealCountdown(''); return; }
    const tick = () => {
      const diff = Math.max(0, soonestPromoEnd.getTime() - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setDealCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [soonestPromoEnd]);

  // ---- Reviews rail: auto-advance every few seconds, stop at the last card
  // (no loop back to the start), pause while the visitor is actually
  // touching/hovering it, skip entirely for reduced motion. Tracks its own
  // step index instead of reading rail.scrollLeft live -- the live value
  // doesn't reliably reflect an in-progress smooth scroll next to this
  // rail's own scroll-snap-type: mandatory, which was causing the computed
  // target to plateau at the same position every tick (looked stuck). ----
  const reviewRailRef = useRef(null);
  const [reviewCTAOpen, setReviewCTAOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rail = reviewRailRef.current;
    if (!rail) return;
    let paused = false;
    let idx = 0;
    const advance = () => {
      if (paused) return;
      if (idx >= rail.children.length - 1) { clearInterval(id); return; }
      idx += 1;
      const card = rail.children[idx];
      if (card) rail.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
    };
    const pause = () => { paused = true; };
    const resume = () => { paused = false; };
    rail.addEventListener('pointerenter', pause);
    rail.addEventListener('pointerleave', resume);
    rail.addEventListener('touchstart', pause, { passive: true });
    rail.addEventListener('touchend', resume);
    const id = setInterval(advance, 3500);
    return () => {
      clearInterval(id);
      rail.removeEventListener('pointerenter', pause);
      rail.removeEventListener('pointerleave', resume);
      rail.removeEventListener('touchstart', pause);
      rail.removeEventListener('touchend', resume);
    };
  }, []);

  // ---- Craving rail: real items, matched by name ----
  const cravingNames = ['Jucy Bae', 'Monsta Fries', 'Kawan Monsta', 'CZ Chix Burger'];
  const cravingItems = cravingNames
    .map(n => findByName(menu, n))
    .filter(Boolean);

  // ---- "RM 6 turns any burger into a meal" -- live arithmetic, not literals ----
  const comboAddon = findByPattern(addons, /combo.*fries|fries.*combo/i) || findByPattern(addons, /combo/i);
  const regularFries = findByName(menu, 'Regular Fries');
  const pepsi = findByName(menu, 'Pepsi');
  const comboPrice = comboAddon?.price ?? null;
  const separatePrice = (regularFries?.price ?? 0) + (pepsi?.price ?? 0);
  const comboSavings = comboPrice != null ? separatePrice - comboPrice : null;

  const mealLadderNames = ['BBQ Eggy', 'BBQ Beef', 'Sumandak Burger', 'Jucy Bae'];
  const mealLadder = mealLadderNames
    .map(n => findByName(menu, n))
    .filter(Boolean)
    .map(item => ({ item, withSet: comboPrice != null ? item.price + comboPrice : null }));
  const cheapestMeal = mealLadder.reduce((min, cur) => (
    cur.withSet != null && (min == null || cur.withSet < min.withSet) ? cur : min
  ), null);

  const kawanMonsta = findByName(menu, 'Kawan Monsta');
  const kawanPerHead = kawanMonsta ? kawanMonsta.price / 4 : null;

  // ---- Arcade / loyalty vault -- real prize + real points ----
  const userPoints = points || 0;
  const freeBurgerPrize = loyaltyPrizes.find(p => /free\s*burger/i.test(p.name))
    || (loyaltyPrizes.length > 0 ? loyaltyPrizes[loyaltyPrizes.length - 1] : null);
  const vaultTarget = freeBurgerPrize?.points_cost ?? null;
  const pointsAway = vaultTarget != null ? Math.max(0, vaultTarget - userPoints) : null;
  const vaultProgress = vaultTarget ? Math.min(100, Math.round((userPoints / vaultTarget) * 100)) : 0;

  // ---- Full real menu, grouped for the typographic list ----
  const menuByCategory = useMemo(() => {
    const groups = {};
    for (const item of menu) {
      const cat = (item.category || '').toUpperCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    return groups;
  }, [menu]);
  const orderedCategories = [
    ...CATEGORY_ORDER.filter(c => menuByCategory[c]?.length),
    ...Object.keys(menuByCategory).filter(c => !CATEGORY_ORDER.includes(c)),
  ];

  const money = (cents) => (cents / 100).toFixed(2);
  const cookTimeMin = Math.round(loyaltyConfig.DEFAULT_COOK_TIME_SECONDS / 60);

  const openItem = (item) => setSelectedItem(item);

  return (
    <div className="craving-page">
      {/* ================= HERO ================= */}
      <section
        className="c-hero"
        style={{ backgroundImage: `url('${heroItem?.image || '/images/hero_burger.png'}')` }}
      >
        <div className="c-hero-scrim" />
        <img src="/images/Trex.png" alt="" className="c-hero-mascot" aria-hidden="true" />
        <div className="c-hero-content">
          <p className="c-eyebrow">MADE WITH LOVE TO SATISFY YOUR HUNGER</p>
          <h1 className="c-hero-h1">EAT LIKE<br /><span>A MONSTA.</span></h1>
          <p className="c-hero-body">
            Sabah's loudest burgers. 100g hand-pressed patties, loaded fries, platters that
            feed the whole kawan — stack extra patties, cheese or beef strips on anything.
          </p>
          <button className="btn c-hero-cta" onClick={() => navigate('/menu')}>
            START AN ORDER <ChevronRight size={18} />
          </button>
          <p className="c-hero-ready">Ready in ~{cookTimeMin} min</p>
          <div className="c-hero-status">
            <span className={`c-status-dot ${shopOpen ? 'is-open' : ''}`} />
            {shopOpen
              ? <span>KITCHEN OPEN{closeStr ? ` · CLOSES ${formatTime12Hour(closeStr)}` : ''}</span>
              : <span>CLOSED{openStr ? ` · OPENS ${formatTime12Hour(openStr)}` : ''}</span>}
            {dealCountdown && <span className="c-deal-timer"> · {dealCountdown} LEFT ON TONIGHT'S DEALS</span>}
          </div>
        </div>
      </section>

      {/* ================= STICKY BUY BAR ================= */}
      {heroItem && (
        <div className="c-buybar">
          <img src={heroItem.image} alt="" className="c-buybar-thumb" />
          <div className="c-buybar-info">
            <span className="c-buybar-eyebrow">TONIGHT'S HERO</span>
            <span className="c-buybar-name">
              {heroItem.name.toUpperCase()} · RM {money(isPromoActive(heroItem) ? heroItem.promo_price : heroItem.price)}
            </span>
          </div>
          <span className="c-buybar-pts">+{getItemPoints(heroItem)} PTS</span>
          <button className="btn c-buybar-add" onClick={() => openItem(heroItem)}>ADD TO CART</button>
        </div>
      )}

      {/* ================= CRAVING RAIL ================= */}
      {cravingItems.length > 0 && (
        <section className="c-section c-craving">
          <div className="c-section-head">
            <h2>WHAT KK IS<br />ORDERING RIGHT NOW</h2>
            <span className="c-swipe-hint">SWIPE <ChevronRight size={16} /></span>
          </div>
          <div className="c-craving-rail">
            {cravingItems.map((item, i) => (
              <button key={item.id} className="c-craving-card" onClick={() => openItem(item)}>
                <img src={item.image} alt="" className="c-craving-img" />
                <div className="c-craving-scrim" />
                {i === 0 && <span className="c-craving-badge"><Star size={12} fill="currentColor" /> BEST SELLER</span>}
                {/^kawan monsta$/i.test(item.name) && <span className="c-craving-badge"><Users size={12} /> FEEDS 3–4</span>}
                <div className="c-craving-info">
                  <h3>{item.name.toUpperCase()}</h3>
                  <span className="c-craving-price">RM {money(isPromoActive(item) ? item.promo_price : item.price)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ================= RM 6 MEAL DEAL BAND ================= */}
      <section className="c-section c-deals">
        <p className="c-eyebrow c-eyebrow-dark">THINK IT'S PRICEY? DO THE MATH.</p>
        <h2 className="c-deals-h2">RM {comboPrice != null ? money(comboPrice) : '6.00'} TURNS ANY<br />BURGER INTO A MEAL.</h2>
        <div className="c-deals-grid">
          <div className="c-deal-card">
            <h4>THE SET ADD-ON</h4>
            {regularFries && pepsi ? (
              <>
                <p className="c-deal-line">Fries {money(regularFries.price)} + Pepsi {money(pepsi.price)} = <s>RM {money(separatePrice)}</s></p>
                <p className="c-deal-big">RM {money(comboPrice)}</p>
                {comboSavings != null && <p className="c-deal-save">SAVE RM {money(comboSavings)}</p>}
              </>
            ) : <p className="c-deal-line">Combo pricing unavailable right now.</p>}
          </div>
          <div className="c-deal-card">
            <h4>FULL MEALS, SET PRICE</h4>
            {mealLadder.length > 0 ? (
              <>
                {cheapestMeal && <p className="c-deal-big">FROM RM {money(cheapestMeal.withSet)}</p>}
                <ul className="c-meal-ladder">
                  {mealLadder.map(({ item, withSet }) => (
                    <li key={item.id}>{item.name} <span>{withSet != null ? `RM ${money(withSet)}` : '—'}</span></li>
                  ))}
                </ul>
              </>
            ) : <p className="c-deal-line">Menu loading…</p>}
          </div>
          <div className="c-deal-card c-deal-card--highlight">
            <h4>KAWAN MONSTA</h4>
            {kawanMonsta ? (
              <>
                <p className="c-deal-line">Feeds 3–4 · RM {money(kawanPerHead)}/head</p>
                <p className="c-deal-big">RM {money(kawanMonsta.price)}</p>
                <span className="c-best-value">BEST VALUE</span>
              </>
            ) : <p className="c-deal-line">Platter pricing unavailable right now.</p>}
          </div>
        </div>
      </section>

      {/* ================= PORTION EDITORIAL ================= */}
      <section className="c-section c-portion">
        <div className="c-portion-img" style={{ backgroundImage: "url('/images/monsta_fries.jpg')" }}>
          <span className="c-portion-badge">150g<small>OF FRIES PER PORTION · +RM 4.50 FOR BEEF STRIPS</small></span>
        </div>
        <div className="c-portion-copy">
          <h2>THE REVIEWS ALL<br />SAY THE SAME THING</h2>
          <div className="c-review-rail" ref={reviewRailRef}>
            {REVIEWS.map(r => (
              <blockquote
                key={r.author}
                className={r.dark ? 'dark' : ''}
                role="button"
                tabIndex={0}
                onClick={() => setReviewCTAOpen(true)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReviewCTAOpen(true); } }}
              >
                "{r.quote}"<cite>{r.author} · Google Review</cite>
              </blockquote>
            ))}
          </div>
          <p className="c-rating">
            <span className="c-star-row" role="img" aria-label={`${GOOGLE_RATING} out of 5 stars`}>
              {[0, 1, 2, 3, 4].map(i => (
                <Star key={i} size={18} fill={i < Math.floor(GOOGLE_RATING) ? 'var(--munchies-yellow)' : 'var(--munchies-muted-dark)'} stroke="none" />
              ))}
            </span>
            {GOOGLE_RATING} <span>from {GOOGLE_REVIEW_COUNT} Google reviews</span>
          </p>
        </div>
      </section>

      {/* ================= ARCADE / REWARD BAND ================= */}
      <section className="c-section c-arcade">
        <div className="c-arcade-copy">
          <p className="c-eyebrow">THE REWARD LAYER</p>
          <h2>ORDER. PLAY.<br /><span>EAT FREE.</span></h2>
          <p className="c-arcade-body">
            Every paid order unlocks three arcade runs while the kitchen works. Beat the
            score, the prize drops straight into your vault — free fries, free drinks,
            {vaultTarget != null ? ` free burger at ${vaultTarget.toLocaleString()} pts.` : ' a free burger at a real points threshold.'}
          </p>
          <div className="c-arcade-games">
            <Link to="/arcade" className="c-game-thumb">
              <img src="/images/munchman_game.jpg" alt="" />
              <span><Gamepad2 size={12} /> MUNCH-MAN</span>
            </Link>
            <Link to="/arcade" className="c-game-thumb">
              <img src="/images/trex_runner_game.jpg" alt="" />
              <span><Gamepad2 size={12} /> T-REX RUNNER</span>
            </Link>
            <Link to="/arcade" className="c-game-thumb">
              <img src="/images/fry_catch.png" alt="" />
              <span><Gamepad2 size={12} /> SPEED GRAB</span>
            </Link>
          </div>
          <Link to="/arcade" className="btn c-arcade-cta">PLAY NOW</Link>
        </div>
        <div className="c-vault-card">
          <p className="c-vault-label">YOUR VAULT</p>
          <p className="c-vault-points">{userPoints.toLocaleString()} PTS</p>
          {vaultTarget != null && (
            <>
              <div className="c-vault-bar"><div className="c-vault-fill" style={{ width: `${vaultProgress}%` }} /></div>
              <p className="c-vault-sub">
                {pointsAway > 0
                  ? `${pointsAway.toLocaleString()} pts away — ${freeBurgerPrize?.name?.toUpperCase() || 'FREE BURGER'} at ${vaultTarget.toLocaleString()}`
                  : `You have enough for ${freeBurgerPrize?.name || 'a prize'} — tap to claim.`}
              </p>
            </>
          )}
        </div>
      </section>

      {/* ================= TYPOGRAPHIC MENU ================= */}
      <section className="c-section c-typemenu">
        <div className="c-section-head">
          <h2>THE WHOLE MENU</h2>
          <span className="c-menu-count">{menu.length} items · prices live from your CRM</span>
        </div>
        {orderedCategories.map(cat => (
          <div key={cat} className="c-type-group">
            {menuByCategory[cat].map(item => (
              <button key={item.id} className="c-type-row" onClick={() => openItem(item)} disabled={!item.inStock}>
                <img src={item.image} alt="" className="c-type-thumb" />
                <span className="c-type-name">{item.name.toUpperCase()}</span>
                <span className="c-type-tag" style={{ color: CATEGORY_TAG_COLOR[cat] || 'var(--munchies-muted-dark)' }}>{cat}</span>
                <span className="c-type-pts">+{getItemPoints(item)} pts</span>
                <span className="c-type-price">
                  {!item.inStock ? 'SOLD OUT' : `RM ${money(isPromoActive(item) ? item.promo_price : item.price)}`}
                </span>
              </button>
            ))}
          </div>
        ))}
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="c-footer">
        <div className="c-footer-brand">
          <img src="/images/logo.png" alt="MunchiesKK" />
          <div>
            <strong>MUNCHIESKK</strong>
            <p>Kota Kinabalu · {formatTime12Hour(shopSettings?.openingTime)}–{formatTime12Hour(shopSettings?.closingTime)} · WhatsApp {siteConfig.whatsappNumber}</p>
          </div>
        </div>
        <div className="c-footer-social">
          {Object.entries(siteConfig.social).map(([platform, url]) => {
            if (!url) return null;
            const Icon = SOCIAL_ICONS[platform];
            return (
              <a key={platform} href={url} target="_blank" rel="noopener noreferrer" className="c-footer-social-link" aria-label={platform}>
                <Icon size={18} />
              </a>
            );
          })}
        </div>
        <div className="c-footer-links">
          {user?.short_code && (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/signup?ref=${user.short_code}`)}
              className="btn c-footer-pill"
            >
              REFER A MATE
            </button>
          )}
          <a
            href={`https://wa.me/${siteConfig.whatsappNumber}?text=${encodeURIComponent(siteConfig.whatsappGreeting)}`}
            target="_blank" rel="noopener noreferrer"
            className="btn c-footer-pill"
          >
            CONTACT US
          </a>
        </div>
      </footer>

      {selectedItem && <ItemModal item={selectedItem} onClose={() => setSelectedItem(null)} />}
      {reviewCTAOpen && (
        <Modal onClose={() => setReviewCTAOpen(false)} className="c-review-cta-modal" ariaLabel="Leave us a review">
          <div className="c-review-cta">
            <BurgerIcon size={36} color="var(--munchies-orange)" />
            <h3>LOVED BY KK</h3>
            <p>Got a sec? Leave us a review on Google — it really helps a local kawan-run kitchen out.</p>
            <a
              href={siteConfig.googleReviewUrl}
              target="_blank" rel="noopener noreferrer"
              className="btn c-review-cta-btn"
              onClick={() => setReviewCTAOpen(false)}
            >
              WRITE A REVIEW
            </a>
            <div className="c-review-cta-stars" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => (
                <Star key={i} size={22} fill="var(--munchies-yellow)" stroke="none" style={{ '--stagger-i': i }} />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
