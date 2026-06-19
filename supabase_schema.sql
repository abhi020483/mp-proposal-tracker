-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS proposals (
  id             SERIAL PRIMARY KEY,
  company        TEXT NOT NULL,
  deliverable    TEXT NOT NULL,
  value          TEXT,
  client_contact TEXT,
  status         TEXT CHECK (status IN ('won', 'lost', 'requested', 'shared', 'discussion', NULL)),
  type           TEXT NOT NULL CHECK (type IN ('hot', 'warm', 'cold')),
  -- time_period is set by the importer (mapTimePeriod) to a month key, so it is
  -- left unconstrained — new months must never break a sync.
  time_period    TEXT,
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
  CHECK (status IN ('won', 'lost', 'requested', 'shared', 'discussion', NULL));
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_type_check;
ALTER TABLE proposals ADD  CONSTRAINT proposals_type_check
  CHECK (type IN ('hot', 'warm', 'cold'));
-- Drop the restrictive month constraint so July/Aug/… (and any future month)
-- never fail a sync. This is the cause of:
--   "violates check constraint proposals_time_period_check"
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_time_period_check;
