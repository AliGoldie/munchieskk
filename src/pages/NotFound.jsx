import { Link } from 'react-router-dom';

// Shown for any address that doesn't exist. RouteSeo marks it noindex, so a
// mistyped or old link never ends up in Google as a duplicate of the home page.
export default function NotFound() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '1rem', padding: '2rem 1rem' }}>
      <h1 style={{ margin: 0, fontFamily: "'Archivo Black', sans-serif", fontSize: 'clamp(2rem, 8vw, 3rem)' }}>PAGE NOT FOUND</h1>
      <p style={{ margin: 0, maxWidth: '32ch' }}>That page doesn't exist, but the burgers do.</p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/menu" className="btn btn-primary">See the menu</Link>
        <Link to="/" className="btn btn-secondary">Back to home</Link>
      </div>
    </div>
  );
}
