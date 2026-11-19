import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import './PromoBanner.css';

// One banner look for the whole app: dark card, yellow edge, gentle motion.
// variant: 'coins' (floating coins), 'pixels' (arcade squares) or 'lock'
// (a glowing padlock with coins). All motion is decoration only and is turned
// off for people who ask for reduced motion (see PromoBanner.css).
const PromoBanner = forwardRef(function PromoBanner(
  { kicker, title, text, to, cta, secondary, state, variant = 'coins', className = '' },
  ref,
) {
  return (
    <div ref={ref} className={`card promo-banner ${className}`.trim()}>
      <span className="promo-sheen" aria-hidden="true" />
      <span className="promo-decor" aria-hidden="true">
        {variant === 'pixels' ? (
          <>
            <i className="promo-pixel promo-pixel-1" />
            <i className="promo-pixel promo-pixel-2" />
            <i className="promo-pixel promo-pixel-3" />
          </>
        ) : (
          <>
            {variant === 'lock' ? (
              <i className="promo-lock"><Lock size={20} /></i>
            ) : (
              <i className="promo-coin promo-coin-1" />
            )}
            <i className="promo-coin promo-coin-2" />
            <i className="promo-coin promo-coin-3" />
          </>
        )}
      </span>
      <div className="promo-body">
        {kicker && <span className="promo-kicker">{kicker}</span>}
        <h3 className="promo-title">{title}</h3>
        {text && <p className="promo-text">{text}</p>}
        <div className="promo-actions">
          {to && (
            <Link to={to} state={state} className="promo-cta">
              {cta} <span className="promo-cta-arrow" aria-hidden="true">&rarr;</span>
            </Link>
          )}
          {secondary && <Link to={secondary.to} state={state} className="promo-link">{secondary.label}</Link>}
        </div>
      </div>
    </div>
  );
});

export default PromoBanner;
