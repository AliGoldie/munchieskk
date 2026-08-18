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
    const { loyverse_item_id, item_name, price_in_cents, category } = await req.json();

    if (!loyverse_item_id || price_in_cents === undefined) {
      return new Response(JSON.stringify({ error: 'Missing loyverse_item_id or price_in_cents' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const default_price = Number((price_in_cents / 100).toFixed(2));
    const token = Deno.env.get('LOYVERSE_API_TOKEN');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing LOYVERSE_API_TOKEN configuration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Fetch existing item from Loyverse to PRESERVE category, description, and image
    let category_id = null;
    let existingVariants: any[] = [];

    try {
      const getRes = await fetch(`https://api.loyverse.com/v1.0/items/${loyverse_item_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (getRes.ok) {
        const existingItem = await getRes.json();
        category_id = existingItem.category_id || null;
        existingVariants = existingItem.variants || [];
      }
    } catch (fetchErr) {
      console.warn('[LOYVERSE PRICE SYNC] Could not fetch existing item, proceeding with basic payload:', fetchErr);
    }

    // 2. If category_id was missing/null, map from known Loyverse category names
    if (!category_id && category) {
      const catMap: Record<string, string> = {
        'DRINKS': 'f3d4cafd-7356-4917-accc-ac325320095f',
        'SIDES': '0f882a6c-4744-4e40-8e37-5a4dc738bd3b',
        'PREMIUM': '83fcb5dc-c5be-4867-8a45-1dfcf06d3b70',
        'BBQ': 'a7ed9d88-d0ce-47c1-bc9a-f0fb483d309b'
      };
      category_id = catMap[category.toUpperCase()] || null;
    }

    // 3. Construct updated variants array
    const updatedVariants = existingVariants.length > 0
      ? existingVariants.map(v => ({
          ...v,
          default_pricing_type: 'FIXED',
          default_price: default_price,
          stores: (v.stores || []).map((s: any) => ({
            ...s,
            pricing_type: 'FIXED',
            price: default_price
          }))
        }))
      : [
          {
            item_id: loyverse_item_id,
            default_pricing_type: 'FIXED',
            default_price: default_price
          }
        ];

    // 4. Construct complete payload that preserves category_id
    const payload: any = {
      id: loyverse_item_id,
      item_name: item_name || 'Item',
      variants: updatedVariants
    };

    if (category_id) {
      payload.category_id = category_id;
    }

    // 5. Send update to Loyverse
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

    return new Response(JSON.stringify({ success: true, price: default_price, category_id, data: loyData }), {
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
