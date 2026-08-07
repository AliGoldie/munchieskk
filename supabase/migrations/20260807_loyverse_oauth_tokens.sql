-- Table to store Loyverse OAuth 2.0 tokens securely
CREATE TABLE IF NOT EXISTS loyverse_oauth_tokens (
  id text PRIMARY KEY DEFAULT 'main',
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE loyverse_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Restrict all public access (Service Role only can read/write sensitive OAuth tokens)
DROP POLICY IF EXISTS "Service role only access to loyverse_oauth_tokens" ON loyverse_oauth_tokens;
CREATE POLICY "Service role only access to loyverse_oauth_tokens" 
  ON loyverse_oauth_tokens 
  FOR ALL 
  USING (false);
