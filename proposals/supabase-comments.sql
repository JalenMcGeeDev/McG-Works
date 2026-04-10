-- ==========================================================
-- McG Works — Proposal Codes + Comments Schema
-- ==========================================================
-- Run this in your Supabase SQL Editor:
--   https://supabase.com/dashboard → your project → SQL Editor
-- ==========================================================


-- =====================
-- PROPOSAL ACCESS CODES
-- =====================

-- 1. Create the codes table
CREATE TABLE proposal_codes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  proposal_path TEXT NOT NULL,
  client_name   TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Index for fast code lookups
CREATE INDEX idx_codes_code ON proposal_codes(code);

-- 3. Enable Row Level Security
ALTER TABLE proposal_codes ENABLE ROW LEVEL SECURITY;

-- 4. No public access — only Edge Functions (using service_role key) can read this table
--    The anon key has ZERO access to proposal codes

-- 5. Seed the proposal codes (plaintext, case-insensitive matching)
INSERT INTO proposal_codes (code, proposal_path, client_name)
VALUES 
  ('ALERT-DINING', 'alert-dining', 'Alert Dining'),
  ('TASTE-OF-BLK', 'taste-of-blk', 'Taste of BLK');

-- =============================================
-- HOW TO ADD A NEW PROPOSAL CODE
-- =============================================
-- 1. Pick a code (e.g. "ACME-2026")
-- 2. Run this SQL in Supabase:
--
--    INSERT INTO proposal_codes (code, proposal_path, client_name)
--    VALUES ('ACME-2026', 'acme-2026', 'Acme Corp');
--
-- 3. Create the folder: proposals/acme-2026/index.html
-- 4. To deactivate a code:
--    UPDATE proposal_codes SET is_active = false WHERE client_name = 'Acme Corp';
-- =============================================


-- ==================
-- PROPOSAL COMMENTS
-- ==================

-- 1. Create the comments table
CREATE TABLE proposal_comments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  parent_id   UUID REFERENCES proposal_comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  is_mcg      BOOLEAN DEFAULT FALSE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Index for fast lookups by proposal
CREATE INDEX idx_comments_proposal ON proposal_comments(proposal_id, created_at);

-- 3. Index for fast reply lookups
CREATE INDEX idx_comments_parent ON proposal_comments(parent_id);

-- 4. Enable Row Level Security
ALTER TABLE proposal_comments ENABLE ROW LEVEL SECURITY;

-- 5. No public access — only Edge Functions (using service_role key) can read/write
--    The anon key has ZERO access to comments


-- ========================
-- PROPOSAL SIGNATURES
-- ========================

-- 1. Create signatures table
CREATE TABLE proposal_signatures (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id  TEXT NOT NULL,
  code         TEXT NOT NULL UNIQUE,
  client_name  TEXT NOT NULL,
  client_email TEXT NOT NULL,
  ip_address   TEXT,
  signed_at    TIMESTAMPTZ DEFAULT now()
);

-- 2. Index for fast lookup by code
CREATE INDEX idx_signatures_code ON proposal_signatures(code);

-- 3. Enable Row Level Security
ALTER TABLE proposal_signatures ENABLE ROW LEVEL SECURITY;

-- 4. No public access — only Edge Functions (using service_role key) can access
