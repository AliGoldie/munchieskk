import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Calendar } from 'lucide-react';
import { supabase } from '../config/supabase';

const REPORT_YEAR = 2026;

const AdminReports = () => {
  const navigate = useNavigate();
  const [downloadingMonth, setDownloadingMonth] = useState(null);

  // Pulls real orders/profiles for the selected calendar month instead of the
  // Math.random() placeholder this used to ship -- that produced a different
  // "real-looking" number on every click, which is indistinguishable from an
  // actual report unless you already know to distrust it.
  const handleDownload = async (month, monthIndex) => {
    setDownloadingMonth(month);
    try {
      const startDate = new Date(Date.UTC(REPORT_YEAR, monthIndex, 1)).toISOString();
      const endDate = new Date(Date.UTC(REPORT_YEAR, monthIndex + 1, 1)).toISOString();

      const [{ data: monthOrders, error: ordersError }, { count: newCustomers, error: profilesError }] = await Promise.all([
        supabase.from('orders').select('total, status, items').gte('created_at', startDate).lt('created_at', endDate),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startDate).lt('created_at', endDate)
      ]);

      if (ordersError) throw ordersError;
      if (profilesError) throw profilesError;

      const countedOrders = (monthOrders || []).filter(o => o.status !== 'CANCELLED');
      const totalOrders = countedOrders.length;
      const totalRevenue = countedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

      const itemCounts = {};
      countedOrders.forEach(o => {
        (o.items || []).forEach(item => {
          const name = item.name || 'Unknown Item';
          itemCounts[name] = (itemCounts[name] || 0) + (item.quantity || 1);
        });
      });
      const topItem = Object.entries(itemCounts).sort((a, b) => b[1] - a[1])[0];
      const mostPopularItem = topItem ? topItem[0] : 'No orders this month';

      // jsPDF/autoTable (~630KB combined) only loads the moment someone
      // actually downloads a report, instead of on every page that imports
      // this file.
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF();

      doc.setFontSize(20);
      doc.text(`MunchiesKK - Monthly Report`, 14, 22);
      doc.setFontSize(14);
      doc.text(`Period: ${month} ${REPORT_YEAR}`, 14, 32);

      doc.setFontSize(12);
      doc.text('Summary Overview', 14, 45);

      autoTable(doc, {
        startY: 50,
        head: [['Metric', 'Value']],
        body: [
          ['Total Orders', totalOrders.toString()],
          ['Total Revenue', `RM ${(totalRevenue / 100).toFixed(2)}`],
          ['Most Popular Item', mostPopularItem],
          ['New Customers', (newCustomers ?? 0).toString()]
        ],
        theme: 'grid',
        headStyles: { fillColor: '#c73b0f' }
      });

      doc.save(`MunchiesKK_${month}_Report_${REPORT_YEAR}.pdf`);
    } catch (err) {
      console.error('Failed to generate report:', err);
      alert('Failed to generate report: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloadingMonth(null);
    }
  };

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
        <button 
          onClick={() => navigate('/admin')}
          style={{ 
            background: 'none', 
            border: 'none', 
            display: 'flex', 
            alignItems: 'center', 
            cursor: 'pointer',
            fontSize: '1rem',
            color: '#6b6558',
            marginRight: '1rem'
          }}
        >
          <ArrowLeft size={20} style={{ marginRight: '8px' }} />
          Back to Dashboard
        </button>
        <h1 style={{ margin: 0, color: '#242320' }}>Annual Reports</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {months.map((month, index) => {
          const isPastOrCurrent = index <= new Date().getMonth();
          return (
            <div key={month} style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '1.5rem',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              display: 'flex',
              flexDirection: 'column',
              opacity: isPastOrCurrent ? 1 : 0.6,
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#242320', fontSize: '1.25rem' }}>{month}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#6b6558', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    <Calendar size={14} style={{ marginRight: '4px' }} />
                    2026
                  </div>
                </div>
                <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '0.5rem', borderRadius: '8px' }}>
                  <FileText size={24} />
                </div>
              </div>
              
              <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  onClick={() => handleDownload(month, index)}
                  disabled={!isPastOrCurrent || downloadingMonth === month}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: isPastOrCurrent ? '#c73b0f' : '#cbd5e1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: isPastOrCurrent && downloadingMonth !== month ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <Download size={18} style={{ marginRight: '8px' }} />
                  {downloadingMonth === month ? 'Generating...' : 'Download Report'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AdminReports;
