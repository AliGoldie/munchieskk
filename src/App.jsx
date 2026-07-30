import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Menu from './pages/Menu';
import Profile from './pages/Profile';
import Cart from './pages/Cart';
import Payment from './pages/Payment';
import Admin from './pages/Admin';
import Loyalty from './pages/Loyalty';
import Arcade from './pages/Arcade';
import OrderStatus from './pages/OrderStatus';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="menu" element={<Menu />} />
        <Route path="profile" element={<Profile />} />
        <Route path="loyalty" element={<Loyalty />} />
        <Route path="arcade" element={<Arcade />} />
        <Route path="cart" element={<Cart />} />
        <Route path="payment" element={<Payment />} />
        <Route path="order/:id" element={<OrderStatus />} />
        <Route path="admin" element={<Admin />} />
      </Route>
    </Routes>
  );
}

export default App;
