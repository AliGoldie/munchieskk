const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function main() {
  const env = fs.readFileSync('.env', 'utf8');
  const url = env.match(/VITE_SUPABASE_URL=(.*)/)[1];
  const anon = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1];
  const supabase = createClient(url, anon);

  const { data, error } = await supabase.rpc('run_sql', {
    query: "SELECT prosrc FROM pg_proc WHERE proname = 'place_order';"
  });
  console.log(data, error);
}

main();
