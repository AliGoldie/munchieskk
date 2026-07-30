import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envStr = fs.readFileSync(join(__dirname, '.env'), 'utf8');

const env = {};
envStr.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length > 0) env[key.trim()] = rest.join('=').trim();
});

const url = env.VITE_SUPABASE_URL + '/rest/v1/menu_items?select=*';
const key = env.VITE_SUPABASE_ANON_KEY;

fetch(url, {
  headers: {
    'apikey': key,
    'Authorization': 'Bearer ' + key
  }
})
.then(res => res.json())
.then(data => {
  console.log(JSON.stringify(data.slice(0, 5), null, 2));
})
.catch(err => console.error(err));
