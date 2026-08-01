import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, val] = line.split('=');
  if (key && val) acc[key.trim()] = val.trim();
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function clearOrders() {
  console.log('Attempting to mark all orders as COLLECTED (since DELETE might be blocked by RLS)...');
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'COLLECTED' })
    .neq('status', 'COLLECTED');
  
  if (error) {
    console.error('Failed to update orders:', error);
  } else {
    console.log('Successfully updated orders.', data);
  }
}

clearOrders();
