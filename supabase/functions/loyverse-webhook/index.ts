import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-loyverse-signature',
};

async function verifyLoyverseSignature(rawBody: string, signatureHeader: string | null, secret: string | null): Promise<boolean> {
  if (!secret) {
    console.error('[LOYVERSE WEBHOOK] Secret not configured in env vars.');
    return false;
  }
  if (!signatureHeader) {
    console.error('[LOYVERSE WEBHOOK] Missing X-Loyverse-Signature header — rejecting.');
    return false;
  }
  try {
    const encoder    = new TextEncoder();
    const cleanHdr   = signatureHeader.trim();

    const key256     = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig256     = await crypto.subtle.sign('HMAC', key256, encoder.encode(rawBody));
    const hex256     = Array.from(new Uint8Array(sig256)).map(b => b.toString(16).padStart(2, '0')).join('');
    const b64256     = btoa(String.fromCharCode(...new Uint8Array(sig256)));
    if (cleanHdr === hex256 || cleanHdr === b64256) return true;

    const keySha1    = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sigSha1    = await crypto.subtle.sign('HMAC', keySha1, encoder.encode(rawBody));
    const hexSha1    = Array.from(new Uint8Array(sigSha1)).map(b => b.toString(16).padStart(2, '0')).join('');
    const b64Sha1    = btoa(String.fromCharCode(...new Uint8Array(sigSha1)));
    if (cleanHdr === hexSha1 || cleanHdr === b64Sha1) return true;

    console.error('[LOYVERSE WEBHOOK] Signature mismatch — rejecting.');
    return false;
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody         = await req.text();
    const signatureHeader = req.headers.get('x-loyverse-signature') || req.headers.get('X-Loyverse-Signature');
    const secret          = Deno.env.get('LOYVERSE_CLIENT_SECRET') || Deno.env.get('LOYVERSE_WEBHOOK_SECRET') || Deno.env.get('LOYVERSE_API_TOKEN') || null;

    const isValid = await verifyLoyverseSignature(rawBody, signatureHeader, secret);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let payload: any = {};
    try { payload = JSON.parse(rawBody); }
    catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const receipts = extractReceipts(payload);
    if (receipts.length === 0) {
      return new Response(JSON.stringify({ message: 'No receipts in payload', processed: 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    let processedCount = 0;

    for (const receipt of receipts) {
      const receiptNumber = receipt.receipt_number || receipt.receipt_id || receipt.id;
      if (!receiptNumber) {
        console.warn('[LOYVERSE WEBHOOK] Receipt with no ID — skipping.');
        continue;
      }

      const externalId   = String(receiptNumber);
      const totalCents   = Math.round(Number(receipt.total_money ?? receipt.total ?? 0) * 100);
      const createdAt    = receipt.created_at || receipt.receipt_date || new Date().toISOString();
      const customerName = receipt.customer_name || receipt.customer_id || 'Walk-in Guest';
      const rawLineItems: any[] = Array.isArray(receipt.line_items) ? receipt.line_items : [];

      const orderItems = rawLineItems.length > 0
        ? rawLineItems.map((li: any) => ({
            name:     li.item_name || li.name || 'POS Item',
            quantity: Number(li.quantity || 1),
            price:    Math.round(Number(li.price || li.total_money || 0) * 100),
            loyverse_item_id: li.item_id || null,
          }))
        : [{ name: 'Loyverse Walk-in Sale', quantity: 1, price: totalCents, loyverse_item_id: null }];

      const { error: upsertErr } = await supabase
        .from('orders')
        .upsert(
          {
            external_id:    externalId,
            channel:        'Loyverse',
            status:         'COLLECTED',
            total:          totalCents,
            items:          orderItems,
            payment_method: 'Loyverse POS',
            customer_name:  String(customerName),
            customer_phone: 'No Phone',
            created_at:     createdAt,
          },
          { onConflict: 'external_id', ignoreDuplicates: false }
        );

      if (upsertErr) {
        console.error('[LOYVERSE WEBHOOK] Upsert failed for receipt ' + externalId + ':', upsertErr.message);
        continue;
      }

      const { data: existingOrder, error: fetchErr } = await supabase
        .from('orders')
        .select('id, stock_decremented')
        .eq('external_id', externalId)
        .single();

      if (fetchErr || !existingOrder) {
        console.error('[LOYVERSE WEBHOOK] Could not fetch order for ' + externalId + ':', fetchErr?.message);
        continue;
      }

      if (existingOrder.stock_decremented === true) {
        console.log('[LOYVERSE WEBHOOK] Receipt ' + externalId + ' already stock-decremented — skipping retry.');
        processedCount++;
        continue;
      }

      if (rawLineItems.length === 0) {
        console.log('[LOYVERSE WEBHOOK] Receipt ' + externalId + ' has no line_items — marking decremented.');
        await supabase.from('orders').update({ stock_decremented: true }).eq('id', existingOrder.id);
        processedCount++;
        continue;
      }

      const loyverseIds = rawLineItems.map((li: any) => li.item_id).filter(Boolean);

      const { data: menuMatches, error: menuErr } = await supabase
        .from('menu_items')
        .select('id, name, loyverse_item_id')
        .in('loyverse_item_id', loyverseIds.length > 0 ? loyverseIds : ['__none__']);

      if (menuErr) {
        console.error('[LOYVERSE WEBHOOK] menu_items lookup failed for ' + externalId + ':', menuErr.message);
        continue;
      }

      const menuMap = new Map<string, any>();
      (menuMatches || []).forEach((row: any) => menuMap.set(row.loyverse_item_id, row));

      const deductions: { item_id: string; quantity: number }[] = [];
      const unmappedItems: { loyverse_item_id: string; name: string; quantity: number }[] = [];

      for (const li of rawLineItems) {
        const loyId = li.item_id;
        const qty   = Number(li.quantity || 1);
        const liName = li.item_name || li.name || 'Unknown';

        if (!loyId) {
          console.warn('[LOYVERSE WEBHOOK] Line item in receipt ' + externalId + ' has no item_id — skipping line.');
          unmappedItems.push({ loyverse_item_id: '(none)', name: liName, quantity: qty });
          continue;
        }

        const menuRow = menuMap.get(loyId);
        if (!menuRow) {
          console.warn(
            '[LOYVERSE WEBHOOK] [UNMAPPED ITEM] Receipt ' + externalId + ': ' +
            'Loyverse item_id="' + loyId + '" name="' + liName + '" qty=' + qty + ' — ' +
            'no matching menu_items.loyverse_item_id. Stock NOT decremented for this line.'
          );
          unmappedItems.push({ loyverse_item_id: loyId, name: liName, quantity: qty });
          continue;
        }

        deductions.push({ item_id: menuRow.id, quantity: qty });
      }

      let allDecremented = deductions.length > 0;

      for (const { item_id, quantity } of deductions) {
        const { error: deductErr } = await supabase.rpc('deduct_stock_for_loyverse', {
          p_item_id: item_id,
          p_qty:     quantity,
        });

        if (deductErr) {
          console.error(
            '[LOYVERSE WEBHOOK] Deduction failed — item ' + item_id + ', ' +
            'receipt ' + externalId + ', qty ' + quantity + ':', deductErr.message
          );
          allDecremented = false;
        }
      }

      const updatePayload: Record<string, any> = {
        unmapped_loyverse_items: unmappedItems.length > 0 ? unmappedItems : null,
      };

      if (allDecremented || deductions.length === 0) {
        updatePayload.stock_decremented = true;
      }

      const { error: flagErr } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', existingOrder.id);

      if (flagErr) {
        console.error('[LOYVERSE WEBHOOK] Failed to update order ' + existingOrder.id + ':', flagErr.message);
      }

      processedCount++;
    }

    return new Response(
      JSON.stringify({ success: true, processed: processedCount }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    console.error('[LOYVERSE WEBHOOK] Unhandled error:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Server Error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
