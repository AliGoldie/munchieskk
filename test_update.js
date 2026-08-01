import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, val] = line.split('=');
  if (key && val) acc[key.trim()] = val.trim();
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function testUpdate() {
  const { data: latestOrder } = await supabase.from('orders').select('*').limit(1).single();
  if (!latestOrder) {
    console.log("No orders found");
    return;
  }
  
  console.log("Found order:", latestOrder.id, latestOrder.status);
  
  const { data, error } = await supabase.from('orders').update({ status: 'COOKING' }).eq('id', latestOrder.id).select();
  
  console.log("Update Error:", error);
  console.log("Update Data:", data);
}

testUpdate();
