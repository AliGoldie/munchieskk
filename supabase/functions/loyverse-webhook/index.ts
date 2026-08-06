import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-loyverse-signature',
};

async function verifyLoyverseSignature(rawBody: string, signatureHeader: string | null, secret: string | null): Promise<boolean> {
  if (!signatureHeader || !secret) {
    // If no signature header sent or secret not configured, pass through with warning
    return true;
  }
  try {
    const encoder = new TextEncoder();
    const cleanHeader = signatureHeader.trim();

    // 1. Try HMAC-SHA256
    const key256 = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig256Buffer = await crypto.subtle.sign('HMAC', key256, encoder.encode(rawBody));
    const hex256 = Array.from(new Uint8Array(sig256Buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const base64256 = btoa(String.fromCharCode(...new Uint8Array(sig256Buffer)));

    if (cleanHeader === hex256 || cleanHeader === base64256) return true;

    // 2. Try HMAC-SHA1 (Loyverse legacy webhook signature)
    const keySha1 = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );
    const sigSha1Buffer = await crypto.subtle.sign('HMAC', keySha1, encoder.encode(rawBody));
    const hexSha1 = Array.from(new Uint8Array(sigSha1Buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const base64Sha1 = btoa(String.fromCharCode(...new Uint8Array(sigSha1Buffer)));

    return cleanHeader === hexSha1 || cleanHeader === base64Sha1;
  } catch (err) {
    console.error('[LOYVERSE WEBHOOK] Signature error:', err);
    return false;
  }
}

function extractReceipts(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (payload.data && typeof payload.data === 'object') {
    return Array.isArray(payload.data) ? payload.data : [payload.data];
  }
  if (Array.isArray(payload.receipts)) return payload.receipts;
  if (payload.receipt_number || payload.receipt_id || payload.id || payload.total_money !== undefined) {
    return [payload];
  }
  return [];
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('x-loyverse-signature') || req.headers.get('X-Loyverse-Signature');
    const secret = Deno.env.get('LOYVERSE_WEBHOOK_SECRET') || Deno.env.get('LOYVERSE_API_TOKEN') || null;

    // Verify Loyverse webhook signature
    const isValid = await verifyLoyverseSignature(rawBody, signatureHeader, secret);
    if (!isValid) {
      console.error('[LOYVERSE WEBHOOK] Invalid signature header received.');
      return new Response(JSON.stringify({ error: 'Invalid Loyverse signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const receipts = extractReceipts(payload);
    if (receipts.length === 0) {
      return new Response(JSON.stringify({ message: 'No receipt data found in payload', processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let processedCount = 0;

    for (const receipt of receipts) {
      const receiptNumber = receipt.receipt_number || receipt.receipt_id || receipt.id;
      if (!receiptNumber) continue;

      const totalMoney = Number(receipt.total_money ?? receipt.total ?? 0);
      const totalCents = Math.round(totalMoney * 100);
      const createdAt = receipt.created_at || receipt.receipt_date || new Date().toISOString();
      const customerName = receipt.customer_name || receipt.customer_id || 'Walk-in Guest';

      // Standardized items list summary
      const items = (receipt.line_items && Array.isArray(receipt.line_items) && receipt.line_items.length > 0)
        ? receipt.line_items.map((item: any) => ({
            name: item.item_name || item.name || 'POS Item',
            quantity: Number(item.quantity || 1),
            price: Math.round(Number(item.price || item.total_money || 0) * 100)
          }))
        : [{ name: 'Loyverse Walk-in Sale', quantity: 1, price: totalCents }];

      // Upsert receipt into orders table with onConflict: external_id
      const { error: upsertErr } = await supabase
        .from('orders')
        .upsert(
          {
            id: crypto.randomUUID(),
            external_id: String(receiptNumber),
            channel: 'Loyverse',
            status: 'COLLECTED',
            total: totalCents,
            items: items,
            payment_method: 'Loyverse POS',
            customer_name: String(customerName),
            customer_phone: 'No Phone',
            created_at: createdAt
          },
          { onConflict: 'external_id' }
        );

      if (upsertErr) {
        console.error(`[LOYVERSE WEBHOOK] Upsert failed for receipt ${receiptNumber}:`, upsertErr.message);
      } else {
        processedCount++;
      }
    }

    return new Response(JSON.stringify({ success: true, processed: processedCount }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[LOYVERSE WEBHOOK] Unhandled error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
