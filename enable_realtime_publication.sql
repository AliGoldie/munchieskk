-- SQL Migration to ensure all critical tables are in supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.addons;
ALTER PUBLICATION supabase_realtime ADD TABLE public.item_addons;
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
