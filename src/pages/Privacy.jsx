import { Link } from 'react-router-dom';
import './Privacy.css';

// Plain-language privacy policy. Keep it in step with what the app really does
// (see docs/PAYMENTS_PLAN.md for the payment provider). Last reviewed 19 Nov 2026.
const UPDATED = '19 November 2026';

export default function Privacy() {
  return (
    <div className="privacy-page">
      <h1>PRIVACY POLICY</h1>
      <p className="privacy-updated">Last updated {UPDATED}</p>

      <p>
        MunchiesKK is a burger kitchen in Kota Kinabalu, Sabah. This page explains, in plain words, what
        information we collect when you use munchieskk.my or our app, why, and what you can ask us to do.
        We follow Malaysia&rsquo;s Personal Data Protection Act 2010.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Your account:</strong> name, email, phone number and password. Your password is handled by our login service and we cannot read it. You may also add your birthday (day and month only) and a nickname for the leaderboard.</li>
        <li><strong>Your orders:</strong> what you ordered, the total, pickup time, any notes you write, and which rewards you used.</li>
        <li><strong>Monsta Coins and the arcade:</strong> your coin balance and history, game scores, leaderboard nickname and contest results.</li>
        <li><strong>Things you send us:</strong> catering requests, messages, and any screenshot you upload to claim a share bonus.</li>
        <li><strong>Payments:</strong> when online payment is available, it is handled by our payment provider. We receive confirmation that an order was paid and the amount. We never see or store your card or bank login details.</li>
        <li><strong>On your device:</strong> your login session, the items in your bag and small settings (for example, that you closed the install prompt) are kept in your browser storage so the app works. We do not use advertising cookies.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To take, prepare and hand over your order, and to contact you about it.</li>
        <li>To run Monsta Coins, rewards, referrals, the arcade and its contests.</li>
        <li>To keep the service safe, prevent abuse and fix problems.</li>
        <li>To keep the business records the law requires (for example sales and tax records).</li>
      </ul>

      <h2>Who else sees it</h2>
      <p>We do not sell your personal information. We share it only with the services that help us run MunchiesKK:</p>
      <ul>
        <li><strong>Supabase</strong> hosts our database (in Singapore) and handles sign-in.</li>
        <li><strong>Vercel</strong> hosts the website.</li>
        <li><strong>Loyverse</strong> is our till system. It sends us sales totals; we send it menu items and prices, not your personal details.</li>
        <li><strong>Our payment provider</strong> processes online payments once they are switched on.</li>
        <li><strong>OpenStreetMap</strong> receives the address text you type when you search for a place on a map.</li>
        <li><strong>Have I Been Pwned</strong> checks, without learning your password, whether a password has appeared in a known data breach.</li>
        <li><strong>Google Fonts</strong> supplies the lettering on our pages.</li>
      </ul>
      <p>
        Other players can see your leaderboard nickname (or your first name if you have not set one). You can
        hide yourself from the leaderboard in your Profile. We may also share information if the law requires it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account information while your account is active. Order and payment records are kept for as
        long as we need them for accounting, tax and dispute purposes. If you ask us to delete your account we
        will remove or anonymise your personal information, except for records we are required to keep.
      </p>

      <h2>Keeping it safe</h2>
      <p>
        Your information travels over an encrypted connection, access to our systems is limited to people who need
        it, and staff accounts are separate from customer accounts. No system is perfectly secure, so please use a
        strong password and tell us straight away if you think your account was used by someone else.
      </p>

      <h2>Your choices</h2>
      <p>You can ask us to show you the information we hold about you, correct it, or delete it, and you can stop receiving messages from us at any time. Contact us below and we will reply as soon as we can.</p>

      <h2>Children</h2>
      <p>MunchiesKK is not made for children under 13. If you think a child has given us personal information, please contact us and we will remove it.</p>

      <h2>Changes</h2>
      <p>If we change how we handle your information we will update this page and the date at the top.</p>

      <h2>Contact us</h2>
      <p>
        Email: <a href="mailto:munchieskk.sabah@gmail.com">munchieskk.sabah@gmail.com</a><br />
        WhatsApp: <a href="https://wa.me/60103818100" target="_blank" rel="noopener noreferrer">+60 10-381 8100</a><br />
        MunchiesKK, Kota Kinabalu, Sabah, Malaysia
      </p>

      <p><Link to="/" className="privacy-back">&larr; Back to MunchiesKK</Link></p>
    </div>
  );
}
