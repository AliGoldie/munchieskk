import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder_anon_key';

// PKCE (not the default 'implicit' flow) exchanges a one-time code for the
// session via a POST request, so access/refresh tokens never appear in the
// URL at all — closes the #access_token=... exposure seen on OAuth/password-
// reset redirects under the implicit flow.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce'
  }
});
