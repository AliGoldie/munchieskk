import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Menu from './pages/Menu';
import Cart from './pages/Cart';
import AdminRoute from './components/AdminRoute';
import ArcadeRoute from './components/ArcadeRoute';

// Every customer downloading Home/Menu/Cart was paying for the entire admin
// dashboard (7000+ lines), the full recharts library, and jsPDF/autoTable --
// none of which anyone but staff ever needs. Lazy-loading these two routes
// keeps that weight out of the bundle every customer actually downloads.
const Signup = lazy(() => import('./pages/Signup'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Profile = lazy(() => import('./pages/Profile'));
const Payment = lazy(() => import('./pages/Payment'));
const Loyalty = lazy(() => import('./pages/Loyalty'));
const Arcade = lazy(() => import('./pages/Arcade'));
const OrderStatus = lazy(() => import('./pages/OrderStatus'));
const Catering = lazy(() => import('./pages/Catering'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminReports = lazy(() => import('./pages/AdminReports'));

// Fetch the other customer pages once the home page has settled, so tapping
// a link never waits on a download.
const prefetchPages = () => {
  [() => import('./pages/Payment'), () => import('./pages/Loyalty'), () => import('./pages/Profile'),
    () => import('./pages/Catering'), () => import('./pages/OrderStatus'), () => import('./pages/Arcade'),
    () => import('./pages/Signup')].forEach(load => load().catch(() => {}));
};

function App() {
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 3000));
    const handle = idle(prefetchPages, { timeout: 8000 });
    return () => (window.cancelIdleCallback || clearTimeout)(handle);
  }, []);
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="menu" element={<Menu />} />
        <Route path="profile" element={<Profile />} />
        <Route path="loyalty" element={<Loyalty />} />
        <Route element={<ArcadeRoute />}>
          <Route path="arcade" element={<Arcade />} />
        </Route>
        <Route path="cart" element={<Cart />} />
        <Route path="payment" element={<Payment />} />
        <Route path="order/:id" element={<OrderStatus />} />
        <Route path="catering" element={<Catering />} />
        <Route element={<AdminRoute />}>
          <Route path="admin" element={
            <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
              <Admin />
            </Suspense>
          } />
          <Route path="admin/reports" element={
            <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>}>
              <AdminReports />
            </Suspense>
          } />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
