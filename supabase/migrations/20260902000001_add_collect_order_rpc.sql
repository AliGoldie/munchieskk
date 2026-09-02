-- Customers can no longer actually collect their own order. The RLS
-- lockdown in 20260826000002_drop_public_write_policies.sql dropped the
-- only UPDATE policy that covered non-admins ("Allow Update", qual: true),
-- leaving "Admins can update orders" (is_admin()) as the sole UPDATE policy
-- on public.orders. But OrderStatus.jsx's handleCollect() calls the exact
-- same raw client-side supabase.from('orders').update({status:'COLLECTED'})
-- as the admin flow (StoreContext.jsx updateOrderState) -- for a real
-- (non-admin) customer that update now matches 0 rows under RLS. PostgREST
-- doesn't treat an RLS-filtered 0-row UPDATE as an error, so the customer's
-- optimistic UI thought it worked while the row never actually changed --
-- their order silently reverts to READY on the next 5s poll and "TAP TO
-- COLLECT FOOD" never progresses.
--
-- Fixed with a narrow SECURITY DEFINER RPC (same pattern as place_order /
-- cancel_order) instead of a broader RLS UPDATE policy for owners -- an
-- ownership-only UPDATE policy would let a customer's own PATCH request
-- smuggle other field changes (total, items, etc.) in alongside the status
-- flip, not just READY -> COLLECTED.

CREATE OR REPLACE FUNCTION public.collect_order(p_order_id text)
RETURNS boolean AS $$
DECLARE
  v_owner uuid;
  v_status text;
BEGIN
  SELECT user_id, status INTO v_owner, v_status
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized to collect this order';
  END IF;

  IF v_status <> 'READY' THEN
    RAISE EXCEPTION 'Order % is not ready for collection (current status: %)', p_order_id, v_status;
  END IF;

  UPDATE public.orders SET status = 'COLLECTED' WHERE id = p_order_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.collect_order(text) TO authenticated;
