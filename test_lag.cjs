const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient('https://zlxuxxlnczpqmlcpzawm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpseHV4eGxuY3pwcW1sY3B6YXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyMjEwMjgsImV4cCI6MjEwMDc5NzAyOH0.5-zCWKTUECd0d0ASpoHxJ4IEUZ1LClgq5GjhBkaYqH8');

async function run() {
  console.log("Setting up realtime listener...");
  let startMs = 0;
  let received = false;

  const channel = supabase.channel('schema-db-changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, payload => {
      if (payload.new.status === 'COOKING' && startMs > 0) {
        const gap = Date.now() - startMs;
        console.log(`[Realtime Event Received] for order ${payload.new.id}`);
        console.log(`=> Actual Gap: ${gap}ms`);
        received = true;
        process.exit(0);
      }
    })
    .subscribe();

  // Wait a second for subscription to establish
  await new Promise(r => setTimeout(r, 1000));

  // Find a pending order or create one
  const { data: orders } = await supabase.from('orders').select('id').eq('status', 'PENDING').limit(1);
  let orderId;
  
  if (orders && orders.length > 0) {
    orderId = orders[0].id;
  } else {
    // Insert dummy order
    console.log("No pending orders, creating a dummy order...");
    const { data: rpcData, error: insertError } = await supabase.rpc('place_order', {
      deductions: [],
      payload: {
        id: crypto.randomUUID(),
        customer_name: 'Test Realtime',
        customer_phone: 'No Phone',
        items: [],
        total: 100,
        subtotal: 100,
        payment_method: 'cash',
        order_type: 'dine-in',
        status: 'PENDING'
      }
    });
    if (insertError) {
      console.error("RPC Error:", insertError);
      process.exit(1);
    }
    orderId = rpcData;
  }

  console.log(`Updating order ${orderId} to COOKING...`);
  
  const { error } = await supabase.from('orders').update({ status: 'COOKING' }).eq('id', orderId);
  
  if (error) {
    console.error("Failed to update:", error);
    process.exit(1);
  }

  startMs = Date.now();
  console.log(`[DB Write Succeeded] at ${startMs}`);

  // Wait for realtime event
  setTimeout(() => {
    if (!received) {
      console.error("=> TIMEOUT: No realtime event received after 5 seconds! Replication is likely DISABLED for the 'orders' table in Supabase.");
      process.exit(1);
    }
  }, 5000);
}

run();
