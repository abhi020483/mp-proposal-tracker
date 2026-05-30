require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// [C-2] Guard: fail fast if critical env vars are missing
if (!process.env.APP_PASSWORD) {
  console.error('FATAL: APP_PASSWORD env var is not set. Exiting.');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('FATAL: SUPABASE_URL or SUPABASE_ANON_KEY env var is not set. Exiting.');
  process.exit(1);
}

const app = express();

// [S-2] Restrict CORS to a known origin when configured; otherwise reflect (dev default)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN } : {}));

// [S-7] Security headers (manual — no helmet dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// [C-1] Derive a stable token using a dedicated server secret as the HMAC key,
// and the password as the signed data. Falls back to APP_PASSWORD-derived secret
// if TOKEN_SECRET is not set (keeps single-password tooling working).
const TOKEN_SECRET = process.env.TOKEN_SECRET || (process.env.APP_PASSWORD + ':mp-tracker-hmac-key');
function deriveToken(password) {
  return crypto.createHmac('sha256', TOKEN_SECRET)
    .update(String(password))
    .digest('hex');
}

// [S-3 partial] Constant-time token comparison to avoid timing attacks
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  const expected = deriveToken(process.env.APP_PASSWORD);
  if (!token || !safeEqual(token, expected)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// [S-1] Simple in-memory rate limiter for /api/auth (brute-force protection).
// 8 attempts per IP per 15 min window. No external dependency.
const authAttempts = new Map(); // ip -> { count, resetAt }
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 8;
function rateLimitAuth(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + AUTH_WINDOW_MS };
    authAttempts.set(ip, rec);
  }
  if (rec.count >= AUTH_MAX_ATTEMPTS) {
    const retrySec = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader('Retry-After', retrySec);
    return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(retrySec / 60)} min.` });
  }
  rec.count++;
  next();
}

// Periodically prune expired rate-limit records to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authAttempts) if (now > rec.resetAt) authAttempts.delete(ip);
}, AUTH_WINDOW_MS).unref?.();

// Auth
app.post('/api/auth', rateLimitAuth, (req, res) => {
  const { password } = req.body;
  if (!password || !safeEqual(password, process.env.APP_PASSWORD)) {
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

// [D-1] /api/summary is kept for backwards compat but client no longer calls it.
// It remains available for debugging / curl inspection.
app.get('/api/summary', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('proposals').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const parseValue = (v) => {
    if (!v || v === 'TBD') return 0;
    const n = parseFloat(v.replace(/[₹L\s,]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const won  = data.filter(p => p.status === 'won');
  const active = data.filter(p => p.status !== 'won');
  const hot  = active.filter(p => p.type === 'hot');
  const warm = active.filter(p => p.type === 'warm');
  // [L-3] Cold excludes won deals to be consistent with hot/warm treatment
  const cold = data.filter(p => p.type === 'cold' && p.status !== 'won');
  const closingNow = active.filter(p => p.time_period === 'may');

  res.json({
    hot_count:   hot.length,
    hot_value:   hot.reduce((s, p) => s + parseValue(p.value), 0),
    warm_count:  warm.length,
    warm_value:  warm.reduce((s, p) => s + parseValue(p.value), 0),
    cold_count:  cold.length,
    cold_value:  cold.reduce((s, p) => s + parseValue(p.value), 0),
    closing_now: closingNow.length,
    won_count:   won.length,
    won_value:   won.reduce((s, p) => s + parseValue(p.value), 0),
    total_value: data.reduce((s, p) => s + parseValue(p.value), 0),
  });
});

// CSV helpers
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // [L-9] Handle RFC 4180 escaped double-quotes ("")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
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
  // [E-9] Unknown periods return null — row still inserted, appears in "All periods" only
  return null;
}

function mapStatus(val) {
  if (!val) return null;
  const v = val.toLowerCase().trim();
  if (v.includes('won') || v.includes('closed') || v === 'completed') return 'won';
  if (v.includes('shared') || v.includes('requested')) return 'shared';
  if (v.includes('discussion')) return 'discussion';
  // [L-10] Log unrecognized statuses so they can be diagnosed
  if (v.length > 0) console.warn(`[sync] Unrecognized status value: "${val}" — stored as null`);
  return null;
}

// Sync from Google Sheets — Pipeline tracker tab (protected)
app.post('/api/sync', requireAuth, async (req, res) => {
  const SHEET_URL = process.env.SHEET_URL ||
    'https://docs.google.com/spreadsheets/d/1LqPp8lbv13kXGfZJZnRWrO_AZmV5iwlGk66JgqcSNm8/export?format=csv&gid=942230714';

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
      if (!company) continue;

      // Some rows have extra blank columns — fall back to cols 10/11 if primary cols empty
      const rawStatus  = cols[idx.status]?.trim()  || cols[10]?.trim() || '';
      const rawClosure = cols[idx.closure]?.trim() || cols[11]?.trim() || '';

      proposals.push({
        type,
        company,
        client_contact: cols[idx.client]?.trim() || null,
        deliverable:    deliverable || '—',
        value:          cols[idx.value]?.trim() || null,
        status:         mapStatus(rawStatus),
        time_period:    mapTimePeriod(rawClosure),
      });
    }

    // Replace all proposals with sheet data
    const { error: delError } = await supabase.from('proposals').delete().neq('id', 0);
    if (delError) throw new Error(delError.message);

    if (proposals.length > 0) {
      const { error: insError } = await supabase.from('proposals').insert(proposals);
      if (insError) {
        // If DB still has old type constraint (hot/warm only), retry without cold rows
        if (insError.message.includes('type_check') || insError.message.includes('violates check')) {
          const filtered = proposals.filter(p => p.type !== 'cold');
          if (filtered.length > 0) {
            const { error: retryErr } = await supabase.from('proposals').insert(filtered);
            if (retryErr) throw new Error(retryErr.message);
          }
          return res.json({
            synced: filtered.length,
            cold_skipped: proposals.length - filtered.length,
            message: `Synced ${filtered.length} proposals. ${proposals.length - filtered.length} cold proposals skipped — update the DB type constraint to include 'cold' to enable cold sync.`,
          });
        }
        throw new Error(insError.message);
      }
    }

    res.json({ synced: proposals.length, message: `Successfully synced ${proposals.length} proposals` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
