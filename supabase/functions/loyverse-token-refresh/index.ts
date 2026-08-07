import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get('LOYVERSE_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('LOYVERSE_CLIENT_SECRET') || '';

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch existing token record
    const { data: tokenRow, error: fetchErr } = await supabase
      .from('loyverse_oauth_tokens')
      .select('*')
      .eq('id', 'main')
      .maybeSingle();

    if (fetchErr || !tokenRow || !tokenRow.refresh_token) {
      return new Response(JSON.stringify({ error: 'No refresh token found in database' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Refresh the access token with Loyverse API
    const refreshRes = await fetch('https://api.loyverse.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const refreshData = await refreshRes.json();
    if (!refreshRes.ok || !refreshData.access_token) {
      console.error('Failed to refresh Loyverse token:', refreshData);
      return new Response(JSON.stringify({ error: 'Token refresh failed', details: refreshData }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const expiresInSeconds = Number(refreshData.expires_in || 2592000);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // Update database record
    await supabase
      .from('loyverse_oauth_tokens')
      .upsert({
        id: 'main',
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || tokenRow.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      });

    return new Response(JSON.stringify({ success: true, expires_at: expiresAt }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('Unhandled error in loyverse-token-refresh:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
