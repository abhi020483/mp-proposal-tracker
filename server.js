require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Derive a stable token from the password — same password always gives same token,
// so server restarts don't invalidate existing browser sessions.
function deriveToken(password) {
  return crypto.createHmac('sha256', password)
    .update(process.env.APP_PASSWORD)
    .digest('hex');
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  const expected = deriveToken(process.env.APP_PASSWORD);
  if (!token || token !== expected) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Auth
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = deriveToken(password);
  res.json({ token });
});

// Serve static files (public index.html)
app.use(express.static(path.join(__dirname, 'public')));

// GET all proposals (protected)
app.get('/api/proposals', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('proposals')
    .select('*')
    .order('company')
    .order('time_period');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET summary stats (protected)
app.get('/api/summary', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('proposals').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const parseValue = (v) => {
    if (!v || v === 'TBD') return 0;
    const n = parseFloat(v.replace(/[₹L\s,]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const won = data.filter(p => p.status === 'won');
  const active = data.filter(p => p.status !== 'won');
  const hot = active.filter(p => p.type === 'hot');
  const warm = active.filter(p => p.type === 'warm');
  const cold = data.filter(p => p.type === 'cold');
  const closingNow = active.filter(p => p.time_period === 'may');

  res.json({
    hot_count: hot.length,
    hot_value: hot.reduce((s, p) => s + parseValue(p.value), 0),
    warm_count: warm.length,
    warm_value: warm.reduce((s, p) => s + parseValue(p.value), 0),
    cold_count: cold.length,
    cold_value: cold.reduce((s, p) => s + parseValue(p.value), 0),
    closing_now: closingNow.length,
    won_count: won.length,
    won_value: won.reduce((s, p) => s + parseValue(p.value), 0),
    total_value: data.reduce((s, p) => s + parseValue(p.value), 0),
  });
});

// CSV helpers
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current.trim());
  return result;
}

function mapTimePeriod(val) {
  if (!val) return null;
  const v = val.toLowerCase().replace(/[\s\-_]+/g, '');
  if (/mar.*wk?3|march.*3/.test(v)) return 'march_wk3';
  if (/mar.*wk?4|march.*4/.test(v)) return 'march_wk4';
  if (/apr.*wk?1|april.*1/.test(v)) return 'april_wk1';
  if (/apr.*wk?2|april.*2/.test(v)) return 'april_wk2';
  if (/apr.*wk?3|april.*3/.test(v)) return 'april_wk3';
  if (/apr.*wk?4|april.*4/.test(v)) return 'april_wk4';
  if (/^may/.test(v)) return 'may';
  if (/^jun/.test(v)) return 'june_plus';
  return null;
}

function mapStatus(val) {
  if (!val) return null;
  const v = val.toLowerCase().trim();
  if (v.includes('won') || v.includes('closed') || v === 'completed') return 'won';
  if (v.includes('shared') || v.includes('requested')) return 'shared';
  if (v.includes('discussion')) return 'discussion';
  return null;
}

// Sync from Google Sheets — Pipeline tracker tab (protected)
app.post('/api/sync', requireAuth, async (req, res) => {
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LqPp8lbv13kXGfZJZnRWrO_AZmV5iwlGk66JgqcSNm8/export?format=csv&gid=942230714';

  try {
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);
    const text = await response.text();
    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length < 2) throw new Error('No data found in sheet');

    // Detect column positions from header row
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const find = (...terms) => headers.findIndex(h => terms.some(t => h.includes(t)));

    const idx = {
      type:        find('type'),
      company:     find('company'),
      client:      find('client'),
      deliverable: find('deliverable'),
      value:       find('value'),
      status:      find('status'),
      closure:     find('closure', 'expected', 'period'),
    };

    // Positional fallbacks (B=1, C=2, D=3, E=4, G=6, I=8, J=9)
    if (idx.type < 0)        idx.type = 1;
    if (idx.company < 0)     idx.company = 2;
    if (idx.client < 0)      idx.client = 3;
    if (idx.deliverable < 0) idx.deliverable = 4;
    if (idx.value < 0)       idx.value = 6;
    if (idx.status < 0)      idx.status = 8;
    if (idx.closure < 0)     idx.closure = 9;

    const proposals = [];
    for (const line of lines.slice(1)) {
      const cols = parseCSVLine(line);
      const type = (cols[idx.type] || '').toLowerCase().trim();
      if (type !== 'hot' && type !== 'warm' && type !== 'cold') continue;
      const company = (cols[idx.company] || '').trim();
      const deliverable = (cols[idx.deliverable] || '').trim();
      if (!company) continue; // allow empty deliverable (e.g. Viatris)

      // Some rows have extra blank columns — fall back to cols 10/11 if primary status/closure cols are empty
      const rawStatus = cols[idx.status]?.trim() || cols[10]?.trim() || '';
      const rawClosure = cols[idx.closure]?.trim() || cols[11]?.trim() || '';

      proposals.push({
        type,
        company,
        client_contact: cols[idx.client]?.trim() || null,
        deliverable: deliverable || '—',
        value: cols[idx.value]?.trim() || null,
        status: mapStatus(rawStatus),
        time_period: mapTimePeriod(rawClosure),
      });
    }

    // Replace all proposals with sheet data
    const { error: delError } = await supabase.from('proposals').delete().neq('id', 0);
    if (delError) throw new Error(delError.message);

    if (proposals.length > 0) {
      const { error: insError } = await supabase.from('proposals').insert(proposals);
      if (insError) throw new Error(insError.message);
    }

    res.json({ synced: proposals.length, message: `Successfully synced ${proposals.length} proposals` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
