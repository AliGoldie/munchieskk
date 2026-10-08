-- These five functions are trigger handlers only (RETURNS trigger, wired up
-- via CREATE TRIGGER ... EXECUTE FUNCTION) -- they were never meant to be
-- called directly. Revoking direct EXECUTE does not affect their normal
-- trigger firing: Postgres invokes a trigger function through the trigger
-- manager, which bypasses EXECUTE privilege checks entirely. It only closes
-- off the unintended direct call path PostgREST exposes automatically for
-- any SECURITY DEFINER function in the public schema
-- (/rest/v1/rpc/<function_name>), which let anyone manipulate loyalty
-- points/stock outside the real order/signup flow.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_order_placed() from public, anon, authenticated;
revoke execute on function public.handle_order_collected() from public, anon, authenticated;
revoke execute on function public.log_stock_adjustment() from public, anon, authenticated;
revoke execute on function public.log_ingredient_adjustment() from public, anon, authenticated;
