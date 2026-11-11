-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS proposals (
  id             SERIAL PRIMARY KEY,
  company        TEXT NOT NULL,
  deliverable    TEXT NOT NULL,
  value          TEXT,
  client_contact TEXT,
  category       TEXT,
  closure_text   TEXT,
  bd             TEXT,
  status         TEXT CHECK (status IN ('won', 'lost', 'requested', 'shared', 'discussion', NULL)),
  type           TEXT NOT NULL CHECK (type IN ('super', 'hot', 'warm', 'cold')),
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
  CHECK (type IN ('super', 'hot', 'warm', 'cold'));
-- Drop the restrictive month constraint so July/Aug/… (and any future month)
-- never fail a sync. This is the cause of:
--   "violates check constraint proposals_time_period_check"
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_time_period_check;
-- Project category (new sheet column) used by the Insights tab.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS category TEXT;
-- Column K raw expected-closure text ("Oct Wk-2") and column L BD owner.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS closure_text TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS bd TEXT;

-- Inflow log: first-seen date per proposal (survives the sync's full-replace)
-- powering the "proposals logged per month" analysis. Rows present at the
-- very first sync are marked seeded (pre-tracking baseline).
CREATE TABLE IF NOT EXISTS proposal_log (
  key        TEXT PRIMARY KEY,
  company    TEXT,
  value      TEXT,
  seeded     BOOLEAN DEFAULT FALSE,
  first_seen DATE DEFAULT CURRENT_DATE
);
ALTER TABLE proposal_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "log read"  ON proposal_log;
DROP POLICY IF EXISTS "log write" ON proposal_log;
CREATE POLICY "log read"  ON proposal_log FOR SELECT USING (true);
CREATE POLICY "log write" ON proposal_log FOR INSERT WITH CHECK (true);

-- Focus-tab notes: shared comment thread per proposal, keyed company|deliverable
-- so notes survive the sync's full replace of the proposals table.
CREATE TABLE IF NOT EXISTS proposal_notes (
  id         BIGSERIAL PRIMARY KEY,
  deal_key   TEXT NOT NULL,
  author     TEXT,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposal_notes_key ON proposal_notes (deal_key);
ALTER TABLE proposal_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notes read"   ON proposal_notes;
DROP POLICY IF EXISTS "notes write"  ON proposal_notes;
DROP POLICY IF EXISTS "notes delete" ON proposal_notes;
CREATE POLICY "notes read"   ON proposal_notes FOR SELECT USING (true);
CREATE POLICY "notes write"  ON proposal_notes FOR INSERT WITH CHECK (true);
CREATE POLICY "notes delete" ON proposal_notes FOR DELETE USING (true);
-- Make the API see the new table immediately.
NOTIFY pgrst, 'reload schema';

-- Path to Target: shared partial amounts per open PO (company|project|PO no).
CREATE TABLE IF NOT EXISTS po_overrides (
  po_key     TEXT PRIMARY KEY,
  amount     NUMERIC NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE po_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po read"   ON po_overrides;
DROP POLICY IF EXISTS "po write"  ON po_overrides;
DROP POLICY IF EXISTS "po update" ON po_overrides;
DROP POLICY IF EXISTS "po delete" ON po_overrides;
CREATE POLICY "po read"   ON po_overrides FOR SELECT USING (true);
CREATE POLICY "po write"  ON po_overrides FOR INSERT WITH CHECK (true);
CREATE POLICY "po update" ON po_overrides FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "po delete" ON po_overrides FOR DELETE USING (true);
NOTIFY pgrst, 'reload schema';
