const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function main() {
  const env = fs.readFileSync('.env', 'utf8');
  const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1];
  const anon = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1];
  const supabase = createClient(url, anon);

  const newOrder = {
      id: 'test-order-id-1234',
      items: [],
      total: 100,
      status: 'PENDING',
      payment_method: 'Cash',
      customer_name: 'Test',
      customer_phone: '123'
    };

  const { data, error } = await supabase.rpc('place_order', { 
      deductions: [], 
      payload: newOrder 
    });
  console.log("RPC Data:", data);
  console.log("RPC Error:", error);
}

main();
