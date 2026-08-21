import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ResetPassword from './pages/ResetPassword';
import Menu from './pages/Menu';
import Profile from './pages/Profile';
import Cart from './pages/Cart';
import Payment from './pages/Payment';
import Admin from './pages/Admin';
import Loyalty from './pages/Loyalty';
import Arcade from './pages/Arcade';
import OrderStatus from './pages/OrderStatus';
import AdminRoute from './components/AdminRoute';
import ArcadeRoute from './components/ArcadeRoute';

import AdminReports from './pages/AdminReports';

function App() {
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
        <Route element={<AdminRoute />}>
          <Route path="admin" element={<Admin />} />
          <Route path="admin/reports" element={<AdminReports />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
