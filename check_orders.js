import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, val] = line.split('=');
  if (key && val) acc[key.trim()] = val.trim();
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkOrders() {
  const { data, error } = await supabase.from('orders').select('*');
  console.log('Orders in DB:', data ? data.length : 0);
  if (error) console.error(error);
}

checkOrders();
