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
  const v = val.toLowerCase().trim();
  // Legacy weekly Mar/Apr buckets (kept for backward compat with old sheets)
  const w = v.replace(/[\s\-_]+/g, '');
  if (/mar.*wk?3|march.*3/.test(w)) return 'march_wk3';
  if (/mar.*wk?4|march.*4/.test(w)) return 'march_wk4';
  if (/apr.*wk?1|april.*1/.test(w)) return 'april_wk1';
  if (/apr.*wk?2|april.*2/.test(w)) return 'april_wk2';
  if (/apr.*wk?3|april.*3/.test(w)) return 'april_wk3';
  if (/apr.*wk?4|april.*4/.test(w)) return 'april_wk4';
  // [B-3] Monthly buckets — match a month name/abbreviation anywhere in the
  // free-text closure cell (e.g. "July", "June-Wk-4", "Connect after 24th June").
  const MONTHS = [
    ['may', /\bmay/],          ['june', /\bjun/],       ['july', /\bjul/],
    ['august', /\baug/],       ['september', /\bsep/],  ['october', /\boct/],
    ['november', /\bnov/],     ['december', /\bdec/],   ['january', /\bjan/],
    ['february', /\bfeb/],
  ];
  for (const [key, re] of MONTHS) if (re.test(v)) return key;
  // [E-9] Unknown/free-text closures return null — row still inserted, appears
  // in "All periods" only.
  return null;
}

function mapStatus(val) {
  if (!val) return null;
  const v = val.toLowerCase().trim();
  // [B-4] Won is ONLY "Closed won" (column I). Do NOT infer it from loose
  // tokens like a bare "closed" or from the Type="Converted" column — those
  // were the source of false "Won" cards. Lost is detected first so a future
  // "closed lost" isn't mistaken for won.
  if (v.includes('lost') || v.includes('dropped') || v.includes('declined') || v.includes('dead')) return 'lost';
  if (v.includes('won')) return 'won';
  if (v.includes('requested')) return 'requested';
  if (v.includes('shared')) return 'shared';
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

    // [B-5] Locate the real header row — the sheet's first row is a totals row,
    // so scan the first few lines for one that contains "company". Without this,
    // header detection silently fails and positional fallbacks mis-map columns
    // whenever a column is inserted (as happened when Category was added).
    let headerRow = 0;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const cells = parseCSVLine(lines[i]).map(h => h.toLowerCase().trim());
      if (cells.some(h => h.includes('company'))) { headerRow = i; break; }
    }
    const headers = parseCSVLine(lines[headerRow]).map(h => h.toLowerCase().trim());
    const find = (...terms) => headers.findIndex(h => terms.some(t => h.includes(t)));

    const idx = {
      type:        find('type'),
      company:     find('company'),
      client:      find('client'),
      category:    find('category'),
      deliverable: find('deliverable'),
      value:       find('value'),
      status:      find('status'),
      closure:     find('closure', 'expected'),
    };

    // Positional fallbacks matching the current sheet layout
    if (idx.type < 0)        idx.type = 1;
    if (idx.company < 0)     idx.company = 2;
    if (idx.client < 0)      idx.client = 3;
    if (idx.category < 0)    idx.category = 4;
    if (idx.deliverable < 0) idx.deliverable = 5;
    if (idx.value < 0)       idx.value = 7;
    if (idx.status < 0)      idx.status = 9;
    if (idx.closure < 0)     idx.closure = 10;

    const proposals = [];
    for (const line of lines.slice(headerRow + 1)) {
      const cols = parseCSVLine(line);
      const rawType = (cols[idx.type] || '').toLowerCase().trim();

      // [B-4] Status is column I (idx.status) ONLY — the second "Status" column
      // (K, index 10) holds junk (a stray number) and must not key won/lost.
      const rawStatus  = cols[idx.status]?.trim()  || '';
      const rawClosure = cols[idx.closure]?.trim() || '';

      // [B-1] Won is driven by the Status column ("Closed won"), NOT the Type
      // column. The sheet marks closed deals "Converted" in Type, which discards
      // the original hot/warm temperature. Resolve the two independently:
      //   • genuine hot/warm/cold  → keep that temperature
      //   • Converted + Closed won  → won deal, shown as 'hot' (temp lost)
      //   • Converted but not won   → data quirk (e.g. "Qualified Lead") → 'cold'
      //   • blank/unknown type      → skip
      const mappedStatus = mapStatus(rawStatus);
      const isWon = mappedStatus === 'won';
      let type;
      if (rawType === 'hot' || rawType === 'warm' || rawType === 'cold') type = rawType;
      else if (isWon)                  type = 'hot';
      else if (rawType === 'converted') type = 'cold';
      else continue;

      const company = (cols[idx.company] || '').trim();
      const deliverable = (cols[idx.deliverable] || '').trim();
      if (!company) continue;

      proposals.push({
        type,
        company,
        client_contact: cols[idx.client]?.trim() || null,
        category:       cols[idx.category]?.trim() || null,
        deliverable:    deliverable || '—',
        value:          cols[idx.value]?.trim() || null,
        status:         mappedStatus,
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

// ─── Sales (MIS "Plan vs Actual") ────────────────────────────────────────────
// Reads the finance MIS Google Sheet and returns the current-FY monthly plan
// and actual revenue (Service + Connect total), in ₹ Lakhs.
const MIS_SHEET_ID = process.env.MIS_SHEET_ID || '1KYREgiO4ClwlSTQHX8vKs6eKs04HLceC';
const MIS_CSV_URL = `https://docs.google.com/spreadsheets/d/${MIS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Plan vs Actual')}`;

function parseMISNumber(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, '');
  if (!s || s === '-') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

let _salesCache = null; // { at, payload }
app.get('/api/sales', requireAuth, async (req, res) => {
  try {
    if (_salesCache && Date.now() - _salesCache.at < 5 * 60 * 1000 && !req.query.fresh) {
      return res.json(_salesCache.payload);
    }
    const r = await fetch(MIS_CSV_URL);
    if (!r.ok) throw new Error(`MIS sheet fetch failed: ${r.status}`);
    const rows = (await r.text()).split('\n').map(parseCSVLine);

    const monthRow   = rows.find(c => (c[0] || '').trim() === 'Month>>');
    const revenueRow = rows.find(c => (c[0] || '').trim() === 'Revenue');
    if (!monthRow || !revenueRow) throw new Error('Could not locate Month>>/Revenue rows in Plan vs Actual');

    // Current FY: Apr <startYear> → Mar <startYear+1>
    const now = new Date();
    const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

    const months = [];
    monthRow.forEach((cell, i) => {
      const m = (cell || '').trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
      if (!m) return;
      const [, mon, yy] = m;
      const year = 2000 + Number(yy);
      const expectYear = ['Jan','Feb','Mar'].includes(mon) ? fyStart + 1 : fyStart;
      if (year !== expectYear || !MONTHS.includes(mon)) return;
      // Group layout: [i]=Plan, [i+1]=Actual Service, [i+2]=Actual Connect, [i+3]=Actual Total
      months.push({
        key:    mon,
        label:  `${mon} ${String(year).slice(2)}`,
        plan:   parseMISNumber(revenueRow[i]),
        actual: parseMISNumber(revenueRow[i + 3]),
      });
    });
    if (!months.length) throw new Error('No current-FY month columns found');
    months.sort((a, b) => MONTHS.indexOf(a.key) - MONTHS.indexOf(b.key));

    // Last FY actual total (the completed year block) for growth context:
    // month cells of fyStart-1, Total column = [i+2] in the 3-wide layout.
    let lastFY = 0;
    monthRow.forEach((cell, i) => {
      const m = (cell || '').trim().match(/^([A-Z][a-z]{2})-(\d{2})$/);
      if (!m) return;
      const [, mon, yy] = m;
      const year = 2000 + Number(yy);
      const expectYear = ['Jan','Feb','Mar'].includes(mon) ? fyStart : fyStart - 1;
      if (year === expectYear) lastFY += parseMISNumber(revenueRow[i + 2]) || 0;
    });

    const payload = { months, lastFY: +lastFY.toFixed(1), fyLabel: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, fetchedAt: new Date().toISOString() };
    _salesCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
