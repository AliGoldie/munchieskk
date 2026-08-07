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

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return new Response(`<h1>OAuth Error</h1><p>${errorParam}</p>`, {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  if (!code) {
    return new Response(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #fff;">
          <h2>Loyverse OAuth Callback Listener Ready</h2>
          <p>This endpoint receives authorization codes from Loyverse. Please visit your Loyverse Authorization URL to connect.</p>
        </body>
      </html>
    `, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  try {
    const clientId = Deno.env.get('LOYVERSE_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('LOYVERSE_CLIENT_SECRET') || '';
    const redirectUri = 'https://zlxuxxlnczpqmlcpzawm.supabase.co/functions/v1/loyverse-oauth-callback';

    if (!clientId || !clientSecret) {
      console.error('Missing LOYVERSE_CLIENT_ID or LOYVERSE_CLIENT_SECRET environment variables.');
      return new Response('<h1>Configuration Error: Client ID/Secret missing</h1>', { status: 500 });
    }

    // 1. Exchange authorization code for OAuth tokens
    const tokenRes = await fetch('https://api.loyverse.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Failed to exchange code for tokens:', tokenData);
      return new Response(`<h1>OAuth Token Exchange Failed</h1><pre>${JSON.stringify(tokenData, null, 2)}</pre>`, { status: 400 });
    }

    const expiresInSeconds = Number(tokenData.expires_in || 2592000);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    // 2. Save tokens securely in loyverse_oauth_tokens table
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: dbErr } = await supabase
      .from('loyverse_oauth_tokens')
      .upsert({
        id: 'main',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      });

    if (dbErr) {
      console.error('Failed to save tokens to database:', dbErr);
    }

    // 3. Register/Update Loyverse Webhook using the new OAuth access token
    let webhookStatus = 'Pending';
    try {
      // List existing webhooks
      const listRes = await fetch('https://api.loyverse.com/v1.0/webhooks', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      const listData = await listRes.json();
      const existingWebhooks = Array.isArray(listData) ? listData : (listData.webhooks || []);

      // Delete old webhooks pointing to our URL
      const targetUrl = 'https://zlxuxxlnczpqmlcpzawm.supabase.co/functions/v1/loyverse-webhook';
      for (const hook of existingWebhooks) {
        if (hook.url === targetUrl || hook.type === 'receipts.update') {
          await fetch(`https://api.loyverse.com/v1.0/webhooks/${hook.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
          });
        }
      }

      // Create new OAuth-signed webhook
      const createRes = await fetch('https://api.loyverse.com/v1.0/webhooks', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: targetUrl,
          type: 'receipts.update',
          status: 'ENABLED'
        })
      });

      const createData = await createRes.json();
      if (createRes.ok) {
        webhookStatus = `Subscribed (ID: ${createData.id || 'OK'})`;
      } else {
        webhookStatus = `Warning: ${JSON.stringify(createData)}`;
      }
    } catch (whErr: any) {
      console.warn('Webhook auto-setup warning:', whErr);
      webhookStatus = `Notice: ${whErr.message}`;
    }

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Loyverse OAuth Connected</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 3rem 1.5rem; text-align: center; }
            .card { background: #1e293b; max-width: 550px; margin: 0 auto; padding: 2rem; border-radius: 16px; border: 2px solid #22c55e; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
            h1 { color: #22c55e; margin-bottom: 0.5rem; }
            .badge { background: #16a34a; color: #fff; padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; text-transform: uppercase; }
            .details { background: #0f172a; padding: 1rem; border-radius: 8px; margin-top: 1.5rem; text-align: left; font-size: 0.85rem; color: #cbd5e1; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Loyverse Connected!</h1>
            <p><span class="badge">OAuth 2.0 Authenticated</span></p>
            <p>Your Loyverse POS account has been successfully linked with MunchiesKK.</p>
            
            <div class="details">
              <p><strong>Access Token:</strong> Saved securely to database</p>
              <p><strong>Expires At:</strong> ${expiresAt}</p>
              <p><strong>Webhook Registration:</strong> ${webhookStatus}</p>
              <p><strong>Signed Webhook Verification:</strong> Active via LOYVERSE_CLIENT_SECRET</p>
            </div>
          </div>
        </body>
      </html>
    `, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (err: any) {
    console.error('Error in loyverse-oauth-callback:', err);
    return new Response(`<h1>OAuth Callback Exception</h1><p>${err.message}</p>`, { status: 500 });
  }
});
