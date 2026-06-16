-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS proposals (
  id             SERIAL PRIMARY KEY,
  company        TEXT NOT NULL,
  deliverable    TEXT NOT NULL,
  value          TEXT,
  client_contact TEXT,
  status         TEXT CHECK (status IN ('won', 'lost', 'shared', 'discussion', NULL)),
  type           TEXT NOT NULL CHECK (type IN ('hot', 'warm', 'cold')),
  time_period    TEXT CHECK (time_period IN (
                   'march_wk3','march_wk4',
                   'april_wk1','april_wk2','april_wk3','april_wk4',
                   'may','june_plus', NULL)),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Enable public read access (RLS)
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON proposals
  FOR SELECT USING (true);

CREATE POLICY "Allow authenticated write" ON proposals
  FOR ALL USING (auth.role() = 'authenticated');

-- ── Migration (run on an EXISTING database to allow 'lost' + 'cold') ──────────
-- Safe to run repeatedly. Without this, syncing a deal marked "Lost"/"Closed
-- lost" in the sheet will fail the status CHECK constraint.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD  CONSTRAINT proposals_status_check
  CHECK (status IN ('won', 'lost', 'shared', 'discussion', NULL));
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_type_check;
ALTER TABLE proposals ADD  CONSTRAINT proposals_type_check
  CHECK (type IN ('hot', 'warm', 'cold'));
