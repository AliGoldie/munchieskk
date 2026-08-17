import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { loyverse_item_id, item_name, price_in_cents } = await req.json();

    if (!loyverse_item_id || price_in_cents === undefined) {
      return new Response(JSON.stringify({ error: 'Missing loyverse_item_id or price_in_cents' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const default_price = Number((price_in_cents / 100).toFixed(2));
    const token = Deno.env.get('LOYVERSE_API_TOKEN') || 'REDACTED_ROTATED_TOKEN';

    const payload = {
      id: loyverse_item_id,
      item_name: item_name || 'Item',
      variants: [
        {
          item_id: loyverse_item_id,
          default_pricing_type: 'FIXED',
          default_price: default_price
        }
      ]
    };

    const loyverseRes = await fetch('https://api.loyverse.com/v1.0/items', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const loyData = await loyverseRes.json();

    if (!loyverseRes.ok) {
      console.error('[LOYVERSE PRICE SYNC] Error from Loyverse API:', loyData);
      return new Response(JSON.stringify({ success: false, loyverse_status: loyverseRes.status, error: loyData }), {
        status: loyverseRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, price: default_price, data: loyData }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[LOYVERSE PRICE SYNC] Unhandled error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
