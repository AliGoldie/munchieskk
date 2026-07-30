import { useState, useEffect, useRef } from 'react';
import { useStore } from '../contexts/StoreContext';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { startNewOrderAlert, stopNewOrderAlert } from '../utils/soundAlert';
import './Admin.css';

export default function Admin() {
  const { user } = useAuth();
  const { 
    menu, toggleStock, updatePrice, addMenuItem, updateStock, setStockQuantity,
    orders, updateOrderState, acceptOrder,
    addons, itemAddons, addAddon, deleteAddon, toggleItemAddon, uploadImage
  } = useStore();
  
  const [editingPrice, setEditingPrice] = useState({});
  const [editingStock, setEditingStock] = useState({});
  const [activeTab, setActiveTab] = useState('inventory');
  
  // New Addon State
  const [newAddonName, setNewAddonName] = useState('');
  const [newAddonPrice, setNewAddonPrice] = useState('');
  const [newAddonImageFile, setNewAddonImageFile] = useState(null);

  // New Menu Item State
  const [newItem, setNewItem] = useState({
    name: '', category: 'BBQ', price: '', image: '', description: '', inStock: true
  });
  const [newItemImageFile, setNewItemImageFile] = useState(null);
  
  const [isUploading, setIsUploading] = useState(false);

  if (!user || user.role !== 'admin') {
    return <Navigate to="/login" replace />;
  }

  const pendingOrders = orders.filter(o => o.status === 'PENDING');
  const activeOrders = orders.filter(o => o.status !== 'COLLECTED');
  
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Start / stop looping alert sound based on pending orders
  useEffect(() => {
    if (pendingOrders.length > 0) {
      startNewOrderAlert();
    } else {
      stopNewOrderAlert();
    }
    return () => stopNewOrderAlert();
  }, [pendingOrders.length]);

  const getElapsedTime = (startedAt) => {
    const diff = Math.floor((now - startedAt) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCookTimeLeft = (order) => {
    if (!order.cooking_started_at) return null;
    const cookSecs = order.cook_time_seconds || 900;
    const elapsed = Math.floor((now - order.cooking_started_at) / 1000);
    const left = Math.max(0, cookSecs - elapsed);
    const m = Math.floor(left / 60);
    const s = left % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const advanceOrderState = (id, currentStatus) => {
    if (currentStatus === 'COOKING') updateOrderState(id, 'READY');
    else if (currentStatus === 'READY') updateOrderState(id, 'COLLECTED');
  };

  const handleAccept = (orderId) => {
    acceptOrder(orderId);
  };

  const handlePriceChange = (id, value) => setEditingPrice({ ...editingPrice, [id]: value });
  const savePrice = (id) => {
    if (editingPrice[id] !== undefined && editingPrice[id] !== '') {
      updatePrice(id, parseFloat(editingPrice[id]));
      setEditingPrice({ ...editingPrice, [id]: undefined });
    }
  };

  const handleAddAddon = async (e) => {
    e.preventDefault();
    if (newAddonName) {
      setIsUploading(true);
      try {
        const imageUrl = newAddonImageFile ? await uploadImage(newAddonImageFile) : null;
        await addAddon(newAddonName, newAddonPrice, imageUrl);
        setNewAddonName('');
        setNewAddonPrice('');
        setNewAddonImageFile(null);
      } catch (err) {
        console.error("Full upload error:", err);
        alert('Upload failed: ' + (err.message || JSON.stringify(err)));
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleAddMenuItem = async (e) => {
    e.preventDefault();
    if (newItem.name && newItem.price) {
      setIsUploading(true);
      try {
        const imageUrl = newItemImageFile ? await uploadImage(newItemImageFile) : (newItem.image || '/images/hero_burger.png');
        await addMenuItem({
          ...newItem,
          price: parseFloat(newItem.price),
          image: imageUrl
        });
        setNewItem({ name: '', category: 'BBQ', price: '', image: '', description: '', inStock: true });
        setNewItemImageFile(null);
      } catch (err) {
        console.error("Full upload error:", err);
        alert('Upload failed: ' + (err.message || JSON.stringify(err)));
      } finally {
        setIsUploading(false);
      }
    }
  };

  return (
    <div className="admin-page">
      <div className="container" style={{ maxWidth: '1000px' }}>
        <div className="admin-header-section mb-6">
          <h1>Admin Dashboard</h1>
          <p className="text-muted">Manage stock, add-ons, and track incoming orders.</p>
        </div>

        <div style={{display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap'}}>
          <button
            className={`btn ${activeTab === 'orders' ? 'btn-primary' : 'btn-secondary'} ${pendingOrders.length > 0 ? 'tab-btn-alert' : ''}`}
            onClick={() => setActiveTab('orders')}
            style={{position: 'relative'}}
          >
            Live Orders
            {pendingOrders.length > 0 && (
              <span className="tab-alert-dot">{pendingOrders.length}</span>
            )}
          </button>
          <button className={`btn ${activeTab === 'inventory' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('inventory')}>Menu CRM</button>
          <button className={`btn ${activeTab === 'addons' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('addons')}>Add-ons CRM</button>
        </div>

        {activeTab === 'orders' && (
        <div className="admin-card">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.5rem'}}>
            <h3 style={{margin:0}}>Live Orders</h3>
            {pendingOrders.length > 0 && (
              <span className="pending-badge-pill">{pendingOrders.length} NEW</span>
            )}
          </div>

          {/* ── PENDING ORDER ALERT CARDS ── */}
          {pendingOrders.map(order => (
            <div key={order.id} className="pending-alert-card">
              <div className="pending-alert-top">
                <div className="pending-alert-icon">🔔</div>
                <div className="pending-alert-info">
                  <div className="pending-alert-title">NEW ORDER INCOMING!</div>
                  <div className="pending-alert-id">{order.id} · RM {(order.total / 100).toFixed(2)}</div>
                  <div className="pending-alert-items">
                    {order.items.map((item, i) => (
                      <span key={i}>{item.quantity}× {item.name}{i < order.items.length - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                </div>
                <button
                  className="pending-accept-btn"
                  onClick={() => handleAccept(order.id)}
                >
                  ✓ Accept<br/>
                  <span style={{fontSize:'0.65rem', opacity:0.85}}>
                    {order.total >= 10000 ? '20 min' : '15 min'} timer
                  </span>
                </button>
              </div>
            </div>
          ))}

          {activeOrders.filter(o => o.status !== 'PENDING').length === 0 && pendingOrders.length === 0 ? (
            <p className="text-muted">No active orders right now.</p>
          ) : activeOrders.filter(o => o.status !== 'PENDING').length > 0 && (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Countdown</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.filter(o => o.status !== 'PENDING').map(order => (
                    <tr key={order.id}>
                      <td className="font-medium">{order.id}</td>
                      <td className={`font-black ${getCookTimeLeft(order) === '0:00' ? 'text-danger' : 'text-orange'}`}>
                        {getCookTimeLeft(order) || '—'}
                      </td>
                      <td>
                      <div className="flex flex-col text-sm">
                        {order.items.map((item, i) => (
                          <div key={i} className="mb-1">
                            <span className="font-bold">{item.quantity}x</span> {item.name}
                            {item.selectedAddons && item.selectedAddons.length > 0 && (
                              <div className="text-muted text-xs ml-4">
                                + {item.selectedAddons.map(a => a.name).join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${order.status === 'READY' ? 'in-stock' : 'out-stock'}`}>
                          {order.status}
                        </span>
                      </td>
                      <td>
                        {order.status === 'COOKING' && (
                          <button className="btn btn-sm btn-primary" onClick={() => advanceOrderState(order.id, 'COOKING')}>
                            Mark Ready
                          </button>
                        )}
                        {order.status === 'READY' && (
                          <button className="btn btn-sm btn-dark" onClick={() => advanceOrderState(order.id, 'READY')}>
                            Mark Collected
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}


        {activeTab === 'inventory' && (
        <div className="admin-card">
          <h3>Add New Menu Item</h3>
          <form onSubmit={handleAddMenuItem} className="new-item-form">
            <div className="form-group">
              <label>Name</label>
              <input type="text" className="price-input" placeholder="e.g. Double Cheeseburger" required value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Category</label>
              <select className="price-input" value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}>
                <option value="BBQ">BBQ</option>
                <option value="PREMIUM">PREMIUM</option>
                <option value="PLATTERS">PLATTERS</option>
                <option value="SIDES">SIDES</option>
                <option value="DRINKS">DRINKS</option>
              </select>
            </div>
            <div className="form-group">
              <label>Price (RM)</label>
              <input type="number" step="0.10" className="price-input" placeholder="0.00" required value={newItem.price} onChange={e => setNewItem({...newItem, price: e.target.value})} />
            </div>
            <div className="form-group">
              <label>Image Upload</label>
              <input type="file" accept="image/*" className="price-input" onChange={e => setNewItemImageFile(e.target.files[0])} />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn btn-primary" style={{ width: '200px' }} disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Add Item'}
              </button>
            </div>
          </form>

          <h3 className="mt-6">Menu Inventory</h3>
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Price (RM)</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...menu].sort((a, b) => a.category.localeCompare(b.category)).map(item => {
                  // Determine badge color based on category
                  const getCategoryColor = (cat) => {
                    const colors = {
                      BBQ: '#ef4444',     // Red
                      PREMIUM: '#8b5cf6', // Purple
                      PLATTERS: '#f59e0b',// Orange
                      SIDES: '#10b981',   // Green
                      DRINKS: '#3b82f6'   // Blue
                    };
                    return colors[cat] || '#64748b'; // Default slate
                  };

                  return (
                    <tr key={item.id} className={!item.inStock ? 'row-inactive' : ''}>
                      <td className="font-medium">{item.name}</td>
                      <td>
                        <span style={{
                          backgroundColor: getCategoryColor(item.category),
                          color: '#fff',
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          display: 'inline-block'
                        }}>
                          {item.category}
                        </span>
                      </td>
                    <td>
                      <div className="price-edit-group">
                        <input 
                          type="number" step="0.10"
                          value={editingPrice[item.id] !== undefined ? editingPrice[item.id] : (item.price / 100).toFixed(2)}
                          onChange={(e) => handlePriceChange(item.id, e.target.value)}
                          className="price-input"
                        />
                        {editingPrice[item.id] !== undefined && (
                          <button className="btn btn-sm btn-primary" onClick={() => savePrice(item.id)}>Save</button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="qty-control">
                        <button
                          className="qty-btn qty-btn-minus"
                          onClick={() => updateStock(item.id, -1)}
                          disabled={!item.inStock && (item.stock_quantity ?? 0) === 0}
                        >−</button>
                        <input
                          type="number"
                          min="0"
                          className="qty-input"
                          value={editingStock[item.id] !== undefined ? editingStock[item.id] : (item.stock_quantity ?? 99)}
                          onChange={e => setEditingStock({ ...editingStock, [item.id]: e.target.value })}
                          onBlur={e => {
                            if (editingStock[item.id] !== undefined) {
                              setStockQuantity(item.id, editingStock[item.id]);
                              setEditingStock({ ...editingStock, [item.id]: undefined });
                            }
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              setStockQuantity(item.id, editingStock[item.id] ?? item.stock_quantity);
                              setEditingStock({ ...editingStock, [item.id]: undefined });
                              e.target.blur();
                            }
                          }}
                          style={{
                            color: (editingStock[item.id] !== undefined ? Number(editingStock[item.id]) : (item.stock_quantity ?? 99)) === 0 ? '#ef4444' : '#1e293b'
                          }}
                        />
                        <button
                          className="qty-btn qty-btn-plus"
                          onClick={() => updateStock(item.id, +1)}
                        >+</button>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className={`status-badge ${item.inStock ? 'in-stock' : 'out-stock'}`}>
                          {item.inStock ? 'In Stock' : 'Sold Out'}
                        </span>
                        <button className={`btn btn-sm ${item.inStock ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleStock(item.id)}>
                          {item.inStock ? 'Mark Sold Out' : 'Restock'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {activeTab === 'addons' && (
        <div className="admin-card">
          <h3>Add-ons CRM</h3>
          
          <form onSubmit={handleAddAddon} className="new-item-form" style={{ gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'end' }}>
            <div className="form-group">
              <label>Addon Name</label>
              <input type="text" placeholder="e.g. Extra Cheese" required value={newAddonName} onChange={e => setNewAddonName(e.target.value)} className="price-input" />
            </div>
            <div className="form-group">
              <label>Price (RM)</label>
              <input type="number" step="0.10" placeholder="Leave blank for TBD" value={newAddonPrice} onChange={e => setNewAddonPrice(e.target.value)} className="price-input" />
            </div>
            <div className="form-group">
              <label>Image Upload</label>
              <input type="file" accept="image/*" className="price-input" onChange={e => setNewAddonImageFile(e.target.files[0])} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ height: '40px' }} disabled={isUploading}>
              {isUploading ? 'Uploading...' : 'Add Add-on'}
            </button>
          </form>

          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Addon</th>
                  <th>Price</th>
                  <th>Assign to Items</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {addons.map(addon => (
                  <tr key={addon.id}>
                    <td className="font-medium">{addon.name}</td>
                    <td>{addon.price === null ? 'TBD' : `RM ${(addon.price / 100).toFixed(2)}`}</td>
                    <td>
                      <div style={{display: 'flex', gap: '0.5rem', flexWrap: 'wrap', maxWidth: '400px'}}>
                        {menu.map(m => (
                          <label key={m.id} style={{fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px'}}>
                            <input 
                              type="checkbox" 
                              checked={itemAddons[m.id]?.includes(addon.id) || false}
                              onChange={() => toggleItemAddon(m.id, addon.id)}
                            />
                            {m.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteAddon(addon.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
