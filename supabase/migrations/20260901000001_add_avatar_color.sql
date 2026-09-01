-- Lets customers pick one of 5 brand-colored avatar badges on their
-- Profile page instead of having no avatar at all.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_color text DEFAULT 'ember';
