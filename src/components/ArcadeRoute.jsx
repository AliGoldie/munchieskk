import { Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';

export default function ArcadeRoute() {
  const { user, loading } = useAuth();
  const { shopSettings, arcade_enabled } = useStore();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--munchies-dark)', color: 'var(--munchies-white)' }}>
        <h2>Loading...</h2>
      </div>
    );
  }

  const isArcadeActive = arcade_enabled ?? shopSettings?.arcade_enabled ?? false;
  const isAdmin = user && user.role === 'admin';

  if (isArcadeActive || isAdmin) {
    return <Outlet />;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: 'var(--munchies-dark)', color: 'var(--munchies-white)' }}>
      <h2>Coming soon</h2>
    </div>
  );
}
