import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Calendar } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const AdminReports = () => {
  const navigate = useNavigate();

  const handleDownload = (month) => {
    const doc = new jsPDF();
    
    // Simple report generation
    doc.setFontSize(20);
    doc.text(`MunchiesKK - Monthly Report`, 14, 22);
    doc.setFontSize(14);
    doc.text(`Period: ${month} 2026`, 14, 32);
    
    doc.setFontSize(12);
    doc.text('Summary Overview', 14, 45);
    
    doc.autoTable({
      startY: 50,
      head: [['Metric', 'Value']],
      body: [
        ['Total Orders', Math.floor(Math.random() * 500) + 100],
        ['Total Revenue', `RM ${(Math.random() * 10000 + 2000).toFixed(2)}`],
        ['Most Popular Item', 'Original Ice Blended Bandung'],
        ['New Customers', Math.floor(Math.random() * 100) + 20]
      ],
      theme: 'grid',
      headStyles: { fillColor: '#e05943' }
    });
    
    doc.save(`MunchiesKK_${month}_Report_2026.pdf`);
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
            color: '#64748b',
            marginRight: '1rem'
          }}
        >
          <ArrowLeft size={20} style={{ marginRight: '8px' }} />
          Back to Dashboard
        </button>
        <h1 style={{ margin: 0, color: '#1e293b' }}>Annual Reports</h1>
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
                  <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.25rem' }}>{month}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
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
                  onClick={() => handleDownload(month)}
                  disabled={!isPastOrCurrent}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: isPastOrCurrent ? '#e05943' : '#cbd5e1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: isPastOrCurrent ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <Download size={18} style={{ marginRight: '8px' }} />
                  Download Report
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
