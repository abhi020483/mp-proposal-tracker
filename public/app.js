// MP Proposal Tracker — app.js
// Vanilla JS state + render. No frameworks, no build step.

// ─── Constants ────────────────────────────────────────────────────────────────

// Monthly closure buckets across the FY. Legacy weekly Mar/Apr buckets are
// kept so already-synced historical rows still resolve to a label.
const PERIODS = [
  { key: 'march_wk3', label: 'Mar W3' },
  { key: 'march_wk4', label: 'Mar W4' },
  { key: 'april_wk1', label: 'Apr W1' },
  { key: 'april_wk2', label: 'Apr W2' },
  { key: 'april_wk3', label: 'Apr W3' },
  { key: 'april_wk4', label: 'Apr W4' },
  { key: 'may',       label: 'May'       },
  { key: 'june',      label: 'June'      },
  { key: 'july',      label: 'July'      },
  { key: 'august',    label: 'August'    },
  { key: 'september', label: 'September' },
  { key: 'october',   label: 'October'   },
  { key: 'november',  label: 'November'  },
  { key: 'december',  label: 'December'  },
  { key: 'january',   label: 'January'   },
  { key: 'february',  label: 'February'  },
];

// Current month resolved from today's date (not hardcoded), used for the
// "current" column highlight and the Kanban "Closing now" bucket.
const _MONTH_KEYS = ['january','february','march','april','may','june',
                     'july','august','september','october','november','december'];
const CURRENT_PERIOD = _MONTH_KEYS[new Date().getMonth()];

// True when a deal's closure month matches the active period chip.
// 'all' = no filter; otherwise an exact month-key match.
function matchesPeriod(d) {
  if (state.period === 'all') return true;
  return d.time_period === state.period;
}

const CO_PALETTE = [
  '#1F4ED8','#7C3AED','#0E9F6E','#D97706',
  '#0EA5E9','#DB2777','#475569','#B45309',
  '#C8332E','#14B8A6','#9333EA','#0D9488',
];

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  tab:            'overview',
  query:          '',
  type:           'all',
  period:         'all',
  closingPeriod:  'may',
  pipelineDir:    'desc',
  pipelineCompany:'all',
  requestedCompany:'all',
  focusMin:       'all',
  bdMon:          {},
  sortBy:         'value',
  sortDir:        'desc',
  deals:          [],
  lastSyncedAt: localStorage.getItem('lastSyncedAt')
    ? parseInt(localStorage.getItem('lastSyncedAt')) : null,
};

let authToken       = localStorage.getItem('heatmap_token');
let eventsWired     = false;

// ─── BD KPI dashboard data (read-only feed) ──────────────────────────────────
// The BD dashboard persists its full state to its own Supabase store; we read
// the same payload here to surface team-performance insights. Anon key is
// already public in that deployed dashboard.
const BD_SUPA_URL = 'https://ukjkibxtxxanhhurbfwo.supabase.co/rest/v1/app_data?store_key=eq.main_data&select=data,updated_at';
const BD_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVramtpYnh0eHhhbmhodXJiZndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTU2NDgsImV4cCI6MjA5MTczMTY0OH0.b-oV2ol7hdBXhvJprT9bBamIsFJyat8AqsmEcWR47Bk';
const BD_COLORS = { Sonali:'#01696f', Rohit:'#2563eb', Ranjana:'#9333ea', Sahil:'#ea580c', Purvi:'#16a34a', Rutvi:'#db2777', Blessy:'#b45309' };
let bdData = null, bdError = null, bdUpdatedAt = null;

async function loadBDData() {
  try {
    const r = await fetch(BD_SUPA_URL, { headers: { apikey: BD_SUPA_KEY, Authorization: `Bearer ${BD_SUPA_KEY}` } });
    if (!r.ok) throw new Error(`BD feed HTTP ${r.status}`);
    const rows = await r.json();
    bdData = rows[0]?.data || null;
    bdUpdatedAt = rows[0]?.updated_at || null;
    bdError = bdData ? null : 'BD dashboard store is empty';
  } catch (e) {
    bdError = e.message;
  }
  if (state.tab === 'bdteam' || state.tab === 'insights') render();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseValue(v) {
  if (v == null || v === 'TBD' || v === '—') return null;
  const n = parseFloat(String(v).replace(/[₹L\s,]/g, ''));
  return isNaN(n) ? null : n;
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return null;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function sumVals(deals) {
  return deals.reduce((s, d) => s + (d._val || 0), 0);
}

const _colorCache = {};
let _colorCacheSize = 0;
function coColor(name) {
  if (_colorCache[name]) return _colorCache[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7FFFFFFF;
  // [P-7] Cap the cache so it can't grow unbounded over a long-lived session
  if (_colorCacheSize > 500) { for (const k in _colorCache) delete _colorCache[k]; _colorCacheSize = 0; }
  _colorCacheSize++;
  return (_colorCache[name] = CO_PALETTE[h % CO_PALETTE.length]);
}

function coShort(name) {
  const letters = name.replace(/[^A-Za-z\s]/g, '').trim();
  const initials = letters.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return initials || name.slice(0, 2).toUpperCase() || '??';
}

function periodInfo(key) {
  return PERIODS.find(p => p.key === key) || {
    key, label: key ? key.replace(/_/g, ' ') : '—', state: 'future',
  };
}

function relTime(ts) {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)    return 'just now';
  if (d < 3600)  return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} hr ago`;
  return `${Math.floor(d / 86400)} days ago`;
}

function fmtDate(dt = new Date()) {
  return {
    day: dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    sub: dt.toLocaleDateString('en-IN', { weekday: 'long' }),
  };
}

function mapDeal(d) {
  return { ...d, _val: parseValue(d.value) };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function matchesSearch(d) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return `${d.deliverable || ''} ${d.company || ''} ${d.client_contact || ''}`.toLowerCase().includes(q);
}

function activeDeals() {
  // Hot + Warm open deals — respects type chip (incl. cold chip), period, search
  // When type chip = 'cold', returns cold deals instead of hot+warm
  if (state.type === 'cold') {
    return state.deals.filter(d => {
      if (d.type !== 'cold') return false;
      if (d.status === 'won' || d.status === 'lost') return false;
      if (!matchesPeriod(d)) return false;
      return matchesSearch(d);
    });
  }
  return state.deals.filter(d => {
    if (d.type === 'cold' || d.status === 'won' || d.status === 'lost') return false;
    if (state.type !== 'all' && d.type !== state.type) return false;
    if (!matchesPeriod(d)) return false;
    return matchesSearch(d);
  });
}

function wonDeals() {
  return state.deals.filter(d => d.status === 'won' && matchesSearch(d));
}

function coldDeals() {
  return state.deals.filter(d => d.type === 'cold' && matchesSearch(d));
}

function allNonCold() {
  // For data table: hot+warm+won, searchable, type-filterable
  // Cold chip on Data tab shows only cold deals (not all non-cold)
  if (state.type === 'cold') {
    return state.deals.filter(d => d.type === 'cold' && matchesSearch(d));
  }
  return state.deals.filter(d => {
    if (d.type === 'cold') return false;
    if (state.type !== 'all' && d.type !== state.type) return false;
    return matchesSearch(d);
  });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function coAvatar(name, showName = true) {
  const color = coColor(name);
  const short = coShort(name);
  return `<span class="co-avatar">
    <span class="co-avatar__dot" style="background:${color}">${short}</span>
    ${showName ? `<span class="co-avatar__name">${esc(name)}</span>` : ''}
  </span>`;
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusBadge(status) {
  if (!status) return `<span class="badge badge--null">no status</span>`;
  const MAP = {
    won:        ['won',       'Won'],
    lost:       ['lost',      'Lost'],
    requested:  ['requested', 'Proposal requested'],
    shared:     ['shared',    'Proposal shared'],
    discussion: ['discuss',   'In discussion'],
  };
  const [cls, label] = MAP[status] || ['null', esc(status)];
  return `<span class="badge badge--${cls}"><span class="dot"></span>${label}</span>`;
}

function typeBadge(type) {
  const cls = type === 'cold' ? 'cold' : type;
  return `<span class="badge badge--${cls}">${type.toUpperCase()}</span>`;
}

function valHtml(val, size = 32) {
  if (val == null) return `<span class="pl-card__value is-tbd">— TBD</span>`;
  const sz = size !== 32 ? `style="font-size:${size}px"` : '';
  return `<span class="pl-card__value" ${sz}>₹${fmtNum(val)}<span class="u">L</span></span>`;
}

function heatClass(deals) {
  if (!deals.length) return '';
  const total   = sumVals(deals);
  const hasHot  = deals.some(d => d.type === 'hot');
  const hasWarm = deals.some(d => d.type === 'warm');
  let lvl = 1;
  if      (total >= 120) lvl = 5;
  else if (total >= 80)  lvl = 4;
  else if (total >= 50)  lvl = 3;
  else if (total >= 25)  lvl = 2;
  if (hasHot && hasWarm && lvl >= 3) return `h-mix-${lvl}`;
  return hasHot ? `h-hot-${lvl}` : `h-warm-${lvl}`;
}

function sparkSvg(vals, color) {
  if (!vals || vals.length < 2) return '';
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * 64;
    const y = 22 - (v / max) * 18 - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="kpi__spark" viewBox="0 0 64 22" fill="none">
    <polyline points="${pts}" stroke="${color}" stroke-width="1.25"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

function tplKpis(deals) {
  // deals = activeDeals() → non-won, non-cold, with current filters applied
  // Hot/Warm tiles use same active pool so Hot + Warm = Active Pipeline
  const hot  = deals.filter(d => d.type === 'hot');
  const warm = deals.filter(d => d.type === 'warm');
  const cold = state.deals.filter(d => d.type === 'cold' && d.status !== 'won' && d.status !== 'lost');
  const tv  = sumVals(deals);
  const hv  = sumVals(hot);
  const wv  = sumVals(warm);
  const cv  = sumVals(cold);
  // Total pipeline = open pipeline only (hot + warm + cold). Won/Lost are
  // closed outcomes and deliberately excluded so they sit outside this total.
  const allTotal = sumVals(state.deals.filter(d => d.status !== 'won' && d.status !== 'lost'));
  const wonList  = state.deals.filter(d => d.status === 'won');
  const lostList = state.deals.filter(d => d.status === 'lost');
  const reqList  = state.deals.filter(d => d.status === 'requested');
  const wonCount = wonList.length;
  const wonVal   = sumVals(wonList);
  const lostVal  = sumVals(lostList);
  const reqVal   = sumVals(reqList);
  return `<div class="kpis">
    <div class="kpi">
      <div class="kpi__label">Active pipeline</div>
      <div class="kpi__value">₹${fmtNum(tv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${deals.length}</strong> ${state.type === 'cold' ? 'cold deals' : 'open hot + warm'}</div>
      ${sparkSvg([3,4,5,7,6,8,10,9,12],'var(--ink-2)')}
    </div>
    <div class="kpi kpi--hot">
      <div class="kpi__label"><span class="ddot" style="background:var(--hot)"></span>Hot</div>
      <div class="kpi__value">₹${fmtNum(hv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${hot.length}</strong> open deals</div>
      ${sparkSvg([2,3,3,5,6,5,7,8,8],'var(--hot)')}
    </div>
    <div class="kpi kpi--warm">
      <div class="kpi__label"><span class="ddot" style="background:var(--warm)"></span>Warm</div>
      <div class="kpi__value">₹${fmtNum(wv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${warm.length}</strong> open deals</div>
      ${sparkSvg([4,4,5,6,5,6,6,7,7],'var(--warm)')}
    </div>
    <div class="kpi kpi--cold">
      <div class="kpi__label"><span class="ddot" style="background:var(--cold)"></span>Cold</div>
      <div class="kpi__value" style="font-size:28px">₹${fmtNum(cv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${cold.length}</strong> deals · nurture stage</div>
    </div>
    <div class="kpi kpi--clickable" id="kpi-requested" role="button" tabindex="0"
      title="View all proposals requested">
      <div class="kpi__label">Proposal requested</div>
      <div class="kpi__value" style="font-size:28px">₹${fmtNum(reqVal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${reqList.length}</strong> deal${reqList.length !== 1 ? 's' : ''} · view →</div>
    </div>
    <div class="kpi">
      <div class="kpi__label">Total pipeline value</div>
      <div class="kpi__value" style="font-size:24px">₹${fmtNum(allTotal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta">hot + warm + cold</div>
    </div>
    <div class="kpi kpi--won">
      <div class="kpi__label"><span class="ddot" style="background:var(--won)"></span>Closed won</div>
      <div class="kpi__value" style="font-size:28px">₹${fmtNum(wonVal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${wonCount}</strong> deal${wonCount !== 1 ? 's' : ''} closed</div>
    </div>
    <div class="kpi kpi--lost">
      <div class="kpi__label"><span class="ddot" style="background:var(--ink-3)"></span>Lost</div>
      <div class="kpi__value" style="font-size:28px">₹${fmtNum(lostVal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${lostList.length}</strong> deal${lostList.length !== 1 ? 's' : ''} lost</div>
    </div>
  </div>`;
}

function tplClosingWeek(closing, periodLabel) {
  if (!closing.length) return `<div class="empty">No proposals closing in ${periodLabel}.</div>`;
  return `<div class="closing-week">
    ${closing.map(d => {
      const v = d._val;
      return `<div class="cw-card">
        <span class="type-ribbon type-ribbon--${d.type}"></span>
        <div class="cw-card__head">
          ${coAvatar(d.company)}
          ${typeBadge(d.type)}
        </div>
        <div class="cw-card__title">${d.deliverable && d.deliverable !== '—'
          ? esc(d.deliverable) : '<em style="color:var(--ink-3)">Untitled proposal</em>'}</div>
        <div class="cw-card__row">
          ${v != null
            ? `<span class="cw-card__value">₹${fmtNum(v)}<span class="u">L</span></span>`
            : `<span class="cw-card__value is-tbd">TBD</span>`}
          ${statusBadge(d.status)}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function tplHeatmap() {
  // Heatmap shows all non-cold deals (including won), search + type filtered
  const forHeat = state.deals.filter(d => {
    if (d.type === 'cold' || d.status === 'lost') return false;
    if (state.type !== 'all' && d.type !== state.type) return false;
    return matchesSearch(d);
  });

  // Show the current month plus any period that actually has deals.
  const visiblePeriods = PERIODS.filter(p =>
    p.key === CURRENT_PERIOD || forHeat.some(d => d.time_period === p.key)
  );
  const companies = [...new Set(forHeat.filter(d => d.time_period).map(d => d.company))];

  if (!companies.length) return `<div class="empty">No scheduled proposals.</div>`;

  const headCells = visiblePeriods.map(p =>
    `<div class="heatmap__hcell ${p.key === CURRENT_PERIOD ? 'is-current' : ''}">
      ${p.key === CURRENT_PERIOD ? '● ' : ''}${p.label}
    </div>`
  ).join('');

  const rows = companies.map(co => {
    const coDeals = forHeat.filter(d => d.company === co);
    const activeTotal = sumVals(coDeals.filter(d => d.status !== 'won'));

    const cells = visiblePeriods.map(p => {
      const cellDeals = forHeat.filter(d => d.company === co && d.time_period === p.key);
      const activeCell = cellDeals.filter(d => d.status !== 'won');
      const cls = heatClass(activeCell);
      const visible = cellDeals.slice(0, 2);
      const overflow = cellDeals.length - visible.length;
      const minis = visible.map(d => {
        const isWon = d.status === 'won';
        const v = d._val;
        const dlv = d.deliverable && d.deliverable !== '—' ? d.deliverable : '—';
        return `<div class="heat-mini ${isWon ? 'heat-mini--won' : ''}"
          data-tip="${esc(co)} · ${esc(dlv)}"
          data-val="${v != null ? '₹' + fmtNum(v) + 'L' : 'TBD'}"
          data-status="${esc(d.status || 'Active')}"
          data-contact="${esc(d.client_contact || '—')}">
          <span class="heat-mini__pip heat-mini__pip--${d.type}"></span>
          <span class="heat-mini__v ${v == null ? 'is-tbd' : ''}">${v != null ? '₹' + fmtNum(v) + 'L' : 'TBD'}</span>
          <span class="heat-mini__d">${esc(dlv)}</span>
        </div>`;
      }).join('');
      const moreHtml = overflow > 0
        ? `<button class="heat-more" data-cell-co="${esc(co)}" data-cell-period="${p.key}">+${overflow} more</button>`
        : '';
      const clickable = cellDeals.length > 0;
      return `<div class="heatmap__cell ${cls} ${p.key === CURRENT_PERIOD ? 'is-current' : ''} ${clickable ? 'is-clickable' : ''}"
        ${clickable ? `data-cell-co="${esc(co)}" data-cell-period="${p.key}"` : ''}>
        ${minis}${moreHtml}
      </div>`;
    }).join('');

    return `<div class="heatmap__row">
      <div class="heatmap__company">
        ${coAvatar(co)}
        <span class="total">${coDeals.length}</span>
      </div>
      ${cells}
      <div class="heatmap__rowtotal">₹${fmtNum(activeTotal) || '0'}<span class="u">L</span></div>
    </div>`;
  }).join('');

  return `<div class="heatmap" style="--cols:${visiblePeriods.length}">
    <div class="heatmap__head">
      <div class="heatmap__hcell">Company</div>
      ${headCells}
      <div class="heatmap__hcell" style="text-align:right;justify-content:flex-end">Total</div>
    </div>
    ${rows}
  </div>`;
}

function tplPipelineCards(deals) {
  const dir = state.pipelineDir === 'asc' ? 1 : -1;
  // [A-2] Keep TBD (no value) deals at the bottom in BOTH sort directions,
  // rather than letting them sort as 0 and jump to the top when ascending.
  const sorted = [...deals].sort((a, b) => {
    const av = a._val, bv = b._val;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
  if (!sorted.length) return `<div class="empty">No proposals match the current filter.</div>`;
  return `<div class="pipeline">
    ${sorted.map(d => {
      const pInfo = periodInfo(d.time_period);
      const hasTitle = d.deliverable && d.deliverable !== '—';
      return `<div class="pl-card">
        <span class="type-ribbon type-ribbon--${d.type}"></span>
        <div class="pl-card__head">
          ${coAvatar(d.company)}
          ${typeBadge(d.type)}
        </div>
        <div class="pl-card__title ${!hasTitle ? 'is-empty' : ''}">
          ${hasTitle ? esc(d.deliverable) : 'Untitled proposal'}
        </div>
        ${valHtml(d._val)}
        <div class="pl-card__foot">
          <span class="mono" style="font-size:11px;color:var(--ink-3)">${pInfo.label || 'No date'}</span>
          ${statusBadge(d.status)}
        </div>
        ${d.client_contact ? `<div class="pl-card__contact">${esc(d.client_contact)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

// [D-5] Unified value-by-company chart. mode: 'active' (color by type, exclude won)
// or 'won' (won deals; hot-won solid green, warm-won striped green — [U-10]).
function tplValueChart(deals, mode = 'active') {
  const src = mode === 'won' ? deals : deals.filter(d => d.status !== 'won');
  const byCompany = {};
  for (const d of src) {
    if (!byCompany[d.company]) byCompany[d.company] = { hot: 0, warm: 0 };
    byCompany[d.company][d.type] = (byCompany[d.company][d.type] || 0) + (d._val || 0);
  }
  const rows = Object.entries(byCompany)
    .map(([co, v]) => ({ co, hot: v.hot || 0, warm: v.warm || 0, total: (v.hot || 0) + (v.warm || 0) }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return '';
  const max = rows[0].total || 1;
  const hotCls  = mode === 'won' ? 'chart-row__bar--won'      : 'chart-row__bar--hot';
  const warmCls = mode === 'won' ? 'chart-row__bar--won-warm' : 'chart-row__bar--warm';
  const hotTip  = mode === 'won' ? 'Hot won'  : 'Hot';
  const warmTip = mode === 'won' ? 'Warm won' : 'Warm';
  return `<div class="chart">
    ${rows.map(r => `<div class="chart-row">
      <div>${coAvatar(r.co)}</div>
      <div class="chart-row__bars">
        ${r.hot  > 0 ? `<div class="chart-row__bar ${hotCls}"  style="width:${(r.hot/max*100).toFixed(1)}%" title="${hotTip} ₹${fmtNum(r.hot)}L"></div>` : ''}
        ${r.warm > 0 ? `<div class="chart-row__bar ${warmCls}" style="width:${(r.warm/max*100).toFixed(1)}%" title="${warmTip} ₹${fmtNum(r.warm)}L"></div>` : ''}
      </div>
      <div class="chart-row__total">₹${fmtNum(r.total)}<span class="muted" style="margin-left:3px">L</span></div>
    </div>`).join('')}
  </div>`;
}

function tplChart(deals) { return tplValueChart(deals, 'active'); }

function tplKanban() {
  // [L-5] Use the dynamically-current period rather than hardcoded 'may'
  const currentPeriodKey = CURRENT_PERIOD;
  const deals4kanban = state.deals.filter(d => d.type !== 'cold' && matchesSearch(d));
  // [U-1] Apply period filter to Kanban (same as other tabs)
  const periodFiltered = deals4kanban.filter(matchesPeriod);
  const all = periodFiltered;
  const bucket = d => {
    if (d.status === 'won')        return 'won';
    if (d.status === 'lost')       return 'lost';
    // Requested and shared share the "Proposal shared" column on the board.
    const sharedish = d.status === 'shared' || d.status === 'requested';
    if (sharedish && d.time_period === currentPeriodKey) return 'closing';
    if (sharedish)                 return 'shared';
    if (d.status === 'discussion') return 'discussion';
    return 'new';  // [L-4] null status gets its own bucket instead of mixing with discussion
  };
  const cols = [
    { key: 'new',        label: 'New / No status',  dot: 'var(--ink-3)' },
    { key: 'discussion', label: 'In discussion',    dot: 'var(--discuss)' },
    { key: 'shared',     label: 'Proposal shared',  dot: 'var(--shared)' },
    { key: 'closing',    label: 'Closing now',      dot: 'var(--hot)' },
    { key: 'won',        label: 'Closed won',       dot: 'var(--won)' },
    { key: 'lost',       label: 'Lost',             dot: 'var(--ink-3)' },
  ];
  return `<div class="kanban">
    ${cols.map(col => {
      const items = all.filter(d => bucket(d) === col.key);
      return `<div class="kb-col">
        <div class="kb-col__head">
          <div class="kb-col__title"><span class="dot" style="background:${col.dot}"></span>${col.label}</div>
          <span class="kb-col__count">${items.length}</span>
        </div>
        ${items.map(d => {
          const pInfo = periodInfo(d.time_period);
          const hasTitle = d.deliverable && d.deliverable !== '—';
          return `<div class="kb-card">
            <div class="kb-card__head">
              ${coAvatar(d.company)}
              ${typeBadge(d.type)}
            </div>
            <div class="kb-card__title ${!hasTitle ? 'is-empty' : ''}">${hasTitle ? esc(d.deliverable) : 'Untitled'}</div>
            ${d.client_contact ? `<div class="kb-card__contact">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              ${esc(d.client_contact)}
            </div>` : ''}
            <div class="kb-card__foot">
              <span class="kb-card__period">${pInfo.label || '—'}</span>
              <span class="kb-card__value ${d._val == null ? 'is-tbd' : ''}">${d._val != null ? '₹' + fmtNum(d._val) + 'L' : 'TBD'}</span>
            </div>
            ${d.status ? `<div class="kb-card__status">${statusBadge(d.status)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function tplWonChart(deals) { return tplValueChart(deals, 'won'); }

function tplWon(deals) {
  if (!deals.length) return `<div class="empty">No closed won deals yet.</div>`;
  const sorted = [...deals].sort((a, b) => (b._val || 0) - (a._val || 0));
  const total  = sumVals(sorted);
  const hot    = sorted.filter(d => d.type === 'hot');
  const warm   = sorted.filter(d => d.type === 'warm');
  const hv     = sumVals(hot);
  const wv     = sumVals(warm);

  // Group by company for the count
  const companies = [...new Set(sorted.map(d => d.company))];

  return `
    <div class="won-banner">
      <span class="won-banner__val">₹${fmtNum(total) || '0'}<span class="u">L</span></span>
      <span class="won-banner__sub">${sorted.length} deal${sorted.length !== 1 ? 's' : ''} closed · ${companies.length} compan${companies.length !== 1 ? 'ies' : 'y'}</span>
    </div>

    <div class="won-stats">
      <div class="won-stat">
        <div class="won-stat__label"><span class="ddot" style="background:var(--hot)"></span>Hot won</div>
        <div class="won-stat__value">₹${fmtNum(hv) || '0'}<span class="u">L</span></div>
        <div class="won-stat__sub">${hot.length} deal${hot.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="won-stat">
        <div class="won-stat__label"><span class="ddot" style="background:var(--warm)"></span>Warm won</div>
        <div class="won-stat__value">₹${fmtNum(wv) || '0'}<span class="u">L</span></div>
        <div class="won-stat__sub">${warm.length} deal${warm.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="won-stat won-stat--avg">
        <div class="won-stat__label">Avg deal size</div>
        <div class="won-stat__value">${sorted.some(d => d._val != null) ? `₹${fmtNum(total / sorted.filter(d => d._val != null).length) || '—'}<span class="u">L</span>` : '<span style="color:var(--ink-3)">—</span>'}</div>
        <div class="won-stat__sub">across ${sorted.filter(d => d._val != null).length} valued deals</div>
      </div>
    </div>

    <div class="section-head">
      <h2>Won by company</h2>
      <span class="muted">Total value closed per account</span>
    </div>
    ${tplWonChart(sorted)}

    <div class="section-head">
      <h2>Closed deals</h2>
      <span class="muted">${sorted.length} deal${sorted.length !== 1 ? 's' : ''} · sorted by value</span>
    </div>
    <div class="pipeline">
      ${sorted.map(d => {
        const pInfo = periodInfo(d.time_period);
        const hasTitle = d.deliverable && d.deliverable !== '—';
        return `<div class="pl-card" style="border-top:2px solid var(--won)">
          <div class="pl-card__head">
            ${coAvatar(d.company)}
            <span class="badge badge--won"><span class="dot"></span>Won</span>
          </div>
          <div class="pl-card__title ${!hasTitle ? 'is-empty' : ''}">
            ${hasTitle ? esc(d.deliverable) : 'Untitled proposal'}
          </div>
          ${valHtml(d._val)}
          <div class="pl-card__foot">
            <span class="mono" style="font-size:11px;color:var(--ink-3)">${pInfo.label || '—'}</span>
            ${d.client_contact ? `<span class="pl-card__contact">${esc(d.client_contact)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function tplDataTable(deals) {
  if (!deals.length) return `<div class="empty">No proposals match the current filter.</div>`;
  const si = col => {
    if (state.sortBy !== col) return `<span style="opacity:.3;margin-left:4px">↕</span>`;
    return `<span style="margin-left:4px">${state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
  };
  const sorted = [...deals].sort((a, b) => {
    let va = a[state.sortBy], vb = b[state.sortBy];
    if (state.sortBy === 'value') { va = a._val || 0; vb = b._val || 0; }
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return `<div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th data-sort="company">Company${si('company')}</th>
        <th data-sort="deliverable">Deliverable${si('deliverable')}</th>
        <th>Type</th>
        <th data-sort="time_period">Period${si('time_period')}</th>
        <th>Status</th>
        <th data-sort="value" style="text-align:right">Value${si('value')}</th>
      </tr></thead>
      <tbody>
        ${sorted.map(d => {
          const pInfo = periodInfo(d.time_period);
          const hasTitle = d.deliverable && d.deliverable !== '—';
          return `<tr>
            <td>${coAvatar(d.company)}</td>
            <td style="color:${hasTitle ? 'var(--ink)' : 'var(--ink-3)'}">${hasTitle ? esc(d.deliverable) : '— (untitled)'}</td>
            <td>${typeBadge(d.type)}</td>
            <td class="mono" style="font-size:12px">${pInfo.label || '—'}</td>
            <td>${statusBadge(d.status)}</td>
            <td class="num">${d._val != null ? `₹${fmtNum(d._val)}<span class="muted" style="margin-left:2px">L</span>` : '<span class="muted">TBD</span>'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function tplColdSegment() {
  const cold = coldDeals();
  if (!cold.length) return '';
  const total = sumVals(cold);
  return `<div class="cold-section">
    <div class="cold-section__head">
      <span class="cold-section__title">● Cold pipeline — nurture stage</span>
      <span class="cold-section__sub">${cold.length} proposals · ₹${fmtNum(total) || '0'}L potential · tracked separately</span>
    </div>
    <div class="cold-grid">
      ${cold.map(d => `<div class="cold-card">
        <div class="cold-card__co">${esc(d.company)}</div>
        <div class="cold-card__title">${d.deliverable && d.deliverable !== '—' ? esc(d.deliverable) : '<em style="color:var(--ink-3)">Untitled</em>'}</div>
        <div class="cold-card__foot">
          <span style="font-size:11px;color:var(--ink-3)">${esc(d.client_contact || '—')}</span>
          <span class="cold-card__val">${d._val != null ? '₹' + fmtNum(d._val) + 'L' : 'TBD'}</span>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ─── Tab views ────────────────────────────────────────────────────────────────

function viewOverview(deals) {
  // The "Closing in" picker is its own month filter, sourced from every
  // Expected-closure month (Column J) that has an open deal — including
  // cold/nurture — so all sheet months are selectable, regardless of the
  // global period chip. Won/Lost (closed) deals are excluded.
  const closingPool = state.deals.filter(d =>
    d.status !== 'won' && d.status !== 'lost' &&
    (state.type === 'all' || d.type === state.type) &&
    matchesSearch(d)
  );
  const periodsWithDeals = PERIODS.filter(p =>
    closingPool.some(d => d.time_period === p.key)
  );
  // [L-6] Don't mutate state inside render — compute display period locally.
  // Default to the saved pick, else the current month, else the first month.
  const displayPeriodKey =
    periodsWithDeals.some(p => p.key === state.closingPeriod) ? state.closingPeriod
    : periodsWithDeals.some(p => p.key === CURRENT_PERIOD)     ? CURRENT_PERIOD
    : (periodsWithDeals[0]?.key || state.closingPeriod);
  const selPeriod = PERIODS.find(p => p.key === displayPeriodKey) ||
                    { key: displayPeriodKey, label: displayPeriodKey };
  const closingDeals = closingPool.filter(d => d.time_period === displayPeriodKey);

  const periodPills = periodsWithDeals.map(p =>
    `<button class="mpick ${p.key === displayPeriodKey ? 'is-active' : ''}" data-closing="${p.key}">${p.label}</button>`
  ).join('');

  const closingHeading = periodsWithDeals.length > 0
    ? `<h2 class="section-head__pick">Closing in
        <span class="mpick-group" id="closing-pills">${periodPills}</span>
       </h2>`
    : `<h2>Closing deals</h2>`;

  // Combined potential = full open pipeline (hot + warm) + everything already
  // won. Computed from all deals (filter-independent) as a headline figure.
  const openHW    = state.deals.filter(d => (d.type === 'hot' || d.type === 'warm') && d.status !== 'won' && d.status !== 'lost');
  const wonAll    = state.deals.filter(d => d.status === 'won');
  const activeVal = sumVals(openHW);
  const wonVal    = sumVals(wonAll);
  const combined  = activeVal + wonVal;

  return `
    <div class="combined-banner">
      <div class="combined-banner__main">
        <span class="combined-banner__label">Total combined potential · FY 2025-26</span>
        <span class="combined-banner__value">₹${fmtNum(combined) || '0'}<span class="combined-banner__unit">L</span></span>
        <span class="combined-banner__note">Where we could land — active pipeline that closes + business already won</span>
      </div>
      <div class="combined-banner__break">
        <div class="combined-banner__part">
          <span class="combined-banner__pnum">₹${fmtNum(activeVal) || '0'}L</span>
          <span class="combined-banner__plabel">Active pipeline</span>
        </div>
        <span class="combined-banner__plus">+</span>
        <div class="combined-banner__part">
          <span class="combined-banner__pnum">₹${fmtNum(wonVal) || '0'}L</span>
          <span class="combined-banner__plabel">Closed won</span>
        </div>
      </div>
    </div>
    <div class="section-head" style="margin-top:0"><h2>Key metrics</h2></div>
    ${tplKpis(deals)}
    <div class="section-head">
      ${closingHeading}
      <span class="muted">${closingDeals.length} proposal${closingDeals.length !== 1 ? 's' : ''}</span>
    </div>
    ${tplClosingWeek(closingDeals, selPeriod.label)}
    <div class="section-head">
      <h2>Closure timeline</h2>
      <span class="muted">Heat map by company × period · click any cell to expand</span>
    </div>
    ${tplHeatmap()}
    ${tplColdSegment()}`;
}

function viewPipeline(deals) {
  // Company filter (pipeline-only). Companies are derived from the deals that
  // already passed the type/period/search filters.
  const companies = [...new Set(deals.map(d => d.company))].sort((a, b) => a.localeCompare(b));
  const activeCo  = companies.includes(state.pipelineCompany) ? state.pipelineCompany : 'all';
  const shown     = activeCo === 'all' ? deals : deals.filter(d => d.company === activeCo);

  const coTabs = `<div class="co-tabs" id="co-tabs">
    <button class="co-tab ${activeCo === 'all' ? 'is-active' : ''}" data-co="all">
      All <span class="co-tab__n">${deals.length}</span>
    </button>
    ${companies.map(co => `<button class="co-tab ${activeCo === co ? 'is-active' : ''}" data-co="${esc(co)}">
        ${esc(co)} <span class="co-tab__n">${deals.filter(d => d.company === co).length}</span>
      </button>`).join('')}
  </div>`;

  return `
    <div class="section-head" style="margin-top:0">
      <h2>Active pipeline</h2>
      <button id="pipeline-sort" class="sort-toggle" type="button"
        title="Toggle value sort order">
        ${shown.length} proposals · value ${state.pipelineDir === 'asc' ? '↑ ascending' : '↓ descending'}
      </button>
    </div>
    ${coTabs}
    ${tplPipelineCards(shown)}
    <div class="section-head">
      <h2>Value by company</h2>
    </div>
    ${state.type === 'cold'
      ? `<div class="empty" style="padding:20px;text-align:left;color:var(--ink-3)">Cold deals are shown in the cold segment below — no bar chart for nurture stage.</div>`
      : tplChart(shown)}
    ${tplColdSegment()}`;
}

function viewRequested() {
  // All proposals whose Status (Column I) is "Proposal requested", respecting
  // search. Grouped company-wise via the same pill tabs as the pipeline page.
  const deals = state.deals.filter(d => d.status === 'requested' && matchesSearch(d));
  const total = sumVals(deals);
  const companies = [...new Set(deals.map(d => d.company))].sort((a, b) => a.localeCompare(b));
  const activeCo  = companies.includes(state.requestedCompany) ? state.requestedCompany : 'all';
  const shown     = activeCo === 'all' ? deals : deals.filter(d => d.company === activeCo);
  const sorted    = [...shown].sort((a, b) => {
    const av = a._val, bv = b._val;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });

  if (!deals.length) {
    return `<div class="section-head" style="margin-top:0"><h2>Proposals requested</h2></div>
      <div class="empty">No proposals requested right now.</div>`;
  }

  const coTabs = `<div class="co-tabs" id="req-co-tabs">
    <button class="co-tab ${activeCo === 'all' ? 'is-active' : ''}" data-co="all">
      All <span class="co-tab__n">${deals.length}</span>
    </button>
    ${companies.map(co => `<button class="co-tab ${activeCo === co ? 'is-active' : ''}" data-co="${esc(co)}">
        ${esc(co)} <span class="co-tab__n">${deals.filter(d => d.company === co).length}</span>
      </button>`).join('')}
  </div>`;

  return `
    <div class="section-head" style="margin-top:0">
      <h2>Proposals requested</h2>
      <span class="muted">${deals.length} proposal${deals.length !== 1 ? 's' : ''} · ₹${fmtNum(total) || '0'}L</span>
    </div>
    ${coTabs}
    <div class="pipeline">
      ${sorted.map(d => {
        const pInfo = periodInfo(d.time_period);
        const hasTitle = d.deliverable && d.deliverable !== '—';
        return `<div class="pl-card">
          <span class="type-ribbon type-ribbon--${d.type}"></span>
          <div class="pl-card__head">
            ${coAvatar(d.company)}
            ${typeBadge(d.type)}
          </div>
          <div class="pl-card__title ${!hasTitle ? 'is-empty' : ''}">
            ${hasTitle ? esc(d.deliverable) : 'Untitled proposal'}
          </div>
          ${valHtml(d._val)}
          <div class="pl-card__foot">
            <span class="mono" style="font-size:11px;color:var(--ink-3)">${pInfo.label || 'No date'}</span>
            ${statusBadge(d.status)}
          </div>
          ${d.client_contact ? `<div class="pl-card__contact">${esc(d.client_contact)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function viewFocus() {
  // Ticket-size discussion view: every open deal ranked by value descending,
  // hot before warm at equal footing — companies intentionally mixed. Cold,
  // won and lost are excluded; search + period filters respected.
  const open = state.deals.filter(d =>
    (d.type === 'hot' || d.type === 'warm') &&
    d.status !== 'won' && d.status !== 'lost' &&
    matchesPeriod(d) && matchesSearch(d)
  );
  if (!open.length) {
    return `<div class="section-head" style="margin-top:0"><h2>Focus — ticket size</h2></div>
      <div class="empty">No open deals match the current filter.</div>`;
  }
  // Hot outranks warm only as a tiebreak — value is the primary axis.
  const ranked = [...open].sort((a, b) => {
    const av = a._val, bv = b._val;
    if (av == null && bv == null) return a.type === 'hot' ? -1 : 1;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (bv !== av) return bv - av;
    return a.type === 'hot' ? -1 : (b.type === 'hot' ? 1 : 0);
  });
  // Ticket-size segments: collapse to a size band during a review.
  // TBD-value deals only show on "All" (they have no ticket size to qualify).
  const SEGMENTS = [
    { key: 'all',  label: 'All tickets', test: () => true },
    { key: 'lt10', label: '< ₹10L',      test: d => d._val != null && d._val < 10 },
    { key: '10',   label: '≥ ₹10L',      test: d => (d._val || 0) >= 10 },
    { key: '25',   label: '≥ ₹25L',      test: d => (d._val || 0) >= 25 },
    { key: '50',   label: '≥ ₹50L',      test: d => (d._val || 0) >= 50 },
  ];
  const seg = SEGMENTS.find(s => s.key === String(state.focusMin)) || SEGMENTS[0];
  const shown = seg.key === 'all' ? ranked : ranked.filter(seg.test);
  const hidden = ranked.length - shown.length;

  const minChips = `<div class="mpick-group" id="focus-min">
    ${SEGMENTS.map(s => `<button class="mpick ${s.key === seg.key ? 'is-active' : ''}" data-min="${s.key}">
      ${s.label}
    </button>`).join('')}
  </div>`;

  const top5    = shown.slice(0, 5).filter(d => d._val != null);
  const top5Val = sumVals(top5);
  const totVal  = sumVals(shown);

  return `
    <div class="section-head" style="margin-top:0">
      <h2>Focus — ticket size</h2>
      <span class="muted">${shown.length} deal${shown.length !== 1 ? 's' : ''} · ₹${fmtNum(totVal) || '0'}L · top ${top5.length} = ₹${fmtNum(top5Val) || '0'}L (${totVal ? Math.round(top5Val / totVal * 100) : 0}%)${hidden > 0 ? ` · ${hidden} outside this band` : ''}</span>
    </div>
    ${minChips}
    ${!shown.length ? `<div class="empty">No open deals at this ticket size.</div>` : ''}
    <div class="focus-list" style="margin-top:14px">
      ${shown.map((d, i) => {
        const pInfo = periodInfo(d.time_period);
        const hasTitle = d.deliverable && d.deliverable !== '—';
        return `<div class="focus-row ${d.type === 'hot' ? 'is-hot' : ''}">
          <span class="focus-row__rank">${i + 1}</span>
          <div class="focus-row__val ${d._val == null ? 'is-tbd' : ''}">
            ${d._val != null ? `₹${fmtNum(d._val)}<span class="u">L</span>` : 'TBD'}
          </div>
          <div class="focus-row__body">
            <div class="focus-row__top">
              ${coAvatar(d.company)}
              ${typeBadge(d.type)}
              ${statusBadge(d.status)}
            </div>
            <div class="focus-row__title ${!hasTitle ? 'is-empty' : ''}">
              ${hasTitle ? esc(d.deliverable) : 'Untitled proposal'}
            </div>
          </div>
          <div class="focus-row__meta">
            <span class="mono" style="font-size:11px;color:var(--ink-3)">${pInfo.label || 'No date'}</span>
            ${d.client_contact ? `<span class="focus-row__contact">${esc(d.client_contact)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

// ─── Insights ─────────────────────────────────────────────────────────────────

// SVG donut from segments [{label, value, color}]. Pure SVG, no libs.
function donutSvg(segs, size = 170, stroke = 30) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) return '';
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let cum = 0;
  const rings = segs.map(s => {
    const frac = s.value / total;
    const ring = `<circle r="${r}" cx="${size/2}" cy="${size/2}" fill="none"
      stroke="${s.color}" stroke-width="${stroke}"
      stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}"
      stroke-dashoffset="${(-cum * C).toFixed(2)}"/>`;
    cum += frac;
    return ring;
  }).join('');
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">${rings}</svg>`;
}

// Donut card: title + donut + centre total + legend with % and ₹.
function tplDonutCard(title, entries, opts = {}) {
  // entries: [{label, value}] — collapse beyond topN into "Other"
  const topN = opts.topN || 6;
  const sorted = entries.filter(e => e.value > 0).sort((a, b) => b.value - a.value);
  if (!sorted.length) return '';
  const head = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const segsIn = rest.length
    ? [...head, { label: `Other (${rest.length})`, value: rest.reduce((s, e) => s + e.value, 0), muted: true }]
    : head;
  const total = segsIn.reduce((s, e) => s + e.value, 0);
  const isCount = opts.unit === 'count';
  const fmtV = v => isCount ? String(Math.round(v)) : `₹${fmtNum(v)}L`;
  const segs = segsIn.map(e => ({ ...e, color: e.muted ? 'var(--line-2)' : (opts.colorFn || coColor)(e.label) }));
  const legend = segs.map(s => `<div class="legend-row">
      <span class="legend-dot" style="background:${s.color}"></span>
      <span class="legend-label">${esc(s.label)}</span>
      <span class="legend-val">${fmtV(s.value)}</span>
      <span class="legend-pct">${Math.round(s.value / total * 100)}%</span>
    </div>`).join('');
  return `<div class="chart-card">
    <div class="chart-card__title">${title}</div>
    <div class="donut-wrap">
      <div class="donut-holder">
        ${donutSvg(segs)}
        <div class="donut-centre"><strong>${isCount ? Math.round(total) : '₹' + fmtNum(total)}</strong><span>${isCount ? (opts.unitLabel || '') : 'L'}</span></div>
      </div>
      <div class="legend">${legend}</div>
    </div>
  </div>`;
}

function viewInsights() {
  // Analysis of the FULL book — deliberately ignores the filter bar so the
  // discussion numbers stay stable.
  const all  = state.deals;
  const open = all.filter(d => (d.type === 'hot' || d.type === 'warm') && d.status !== 'won' && d.status !== 'lost');
  const won  = all.filter(d => d.status === 'won');
  const lost = all.filter(d => d.status === 'lost');
  const cold = all.filter(d => d.type === 'cold' && d.status !== 'won' && d.status !== 'lost');
  if (!all.length) return `<div class="empty">No data yet — run a sync.</div>`;

  const openVal = sumVals(open), wonVal = sumVals(won), lostVal = sumVals(lost);
  const priced  = open.filter(d => d._val != null);
  const unpriced = open.length - priced.length;
  const avgTicket = priced.length ? openVal / priced.length : 0;
  const biggest  = priced.reduce((m, d) => (d._val > (m?._val || 0) ? d : m), null);

  // Aggregations
  const agg = (list, keyFn) => {
    const m = {};
    for (const d of list) {
      const k = keyFn(d) || 'Uncategorised';
      m[k] = (m[k] || 0) + (d._val || 0);
    }
    return Object.entries(m).map(([label, value]) => ({ label, value }));
  };
  const byCompany  = agg(open, d => d.company);
  const byCategory = agg(open, d => d.category);
  const hasCategories = open.some(d => d.category);

  // Ticket-size histogram (priced open deals)
  const BUCKETS = [
    { label: '< ₹5L',    min: 0,  max: 5 },
    { label: '₹5–15L',   min: 5,  max: 15 },
    { label: '₹15–30L',  min: 15, max: 30 },
    { label: '₹30–60L',  min: 30, max: 60 },
    { label: '₹60L+',    min: 60, max: Infinity },
  ].map(b => {
    const ds = priced.filter(d => d._val >= b.min && d._val < b.max);
    return { ...b, count: ds.length, value: sumVals(ds) };
  });
  const maxBucketVal = Math.max(...BUCKETS.map(b => b.value), 1);
  const hist = `<div class="chart-card">
    <div class="chart-card__title">Ticket-size distribution <span class="muted-inline">open deals · bar = value</span></div>
    <div class="hist">
      ${BUCKETS.map(b => `<div class="hist-col">
        <div class="hist-col__value">₹${fmtNum(b.value) || 0}L</div>
        <div class="hist-col__bar" style="height:${Math.max(4, b.value / maxBucketVal * 120)}px"></div>
        <div class="hist-col__count">${b.count} deal${b.count !== 1 ? 's' : ''}</div>
        <div class="hist-col__label">${b.label}</div>
      </div>`).join('')}
    </div>
    ${unpriced ? `<div class="chart-card__foot">+ ${unpriced} unpriced (TBD) deal${unpriced !== 1 ? 's' : ''} not shown — pricing these is an action item</div>` : ''}
  </div>`;

  // Status funnel (open deals by stage, plus won)
  const STAGES = [
    { key: null,         label: 'New / no status',   color: 'var(--ink-3)' },
    { key: 'discussion', label: 'In discussion',     color: 'var(--discuss)' },
    { key: 'requested',  label: 'Proposal requested',color: 'var(--warm)' },
    { key: 'shared',     label: 'Proposal shared',   color: 'var(--shared)' },
  ].map(s => {
    const ds = open.filter(d => (d.status || null) === s.key);
    return { ...s, count: ds.length, value: sumVals(ds) };
  });
  const maxStage = Math.max(...STAGES.map(s => s.value), wonVal, 1);
  const funnel = `<div class="chart-card">
    <div class="chart-card__title">Stage funnel <span class="muted-inline">open value by stage → closed</span></div>
    <div class="funnel">
      ${STAGES.map(s => `<div class="funnel-row">
        <span class="funnel-row__label">${s.label}</span>
        <div class="funnel-row__track"><div class="funnel-row__bar" style="width:${Math.max(2, s.value / maxStage * 100)}%;background:${s.color}"></div></div>
        <span class="funnel-row__num">₹${fmtNum(s.value) || 0}L · ${s.count}</span>
      </div>`).join('')}
      <div class="funnel-row funnel-row--won">
        <span class="funnel-row__label">Closed won</span>
        <div class="funnel-row__track"><div class="funnel-row__bar" style="width:${Math.max(2, wonVal / maxStage * 100)}%;background:var(--won)"></div></div>
        <span class="funnel-row__num">₹${fmtNum(wonVal) || 0}L · ${won.length}</span>
      </div>
    </div>
  </div>`;

  // Auto-generated talking points
  const share = (part, whole) => whole ? Math.round(part / whole * 100) : 0;
  const topCo  = [...byCompany].sort((a, b) => b.value - a.value)[0];
  const topCat = hasCategories ? [...byCategory].sort((a, b) => b.value - a.value)[0] : null;
  const top5Val = sumVals([...priced].sort((a, b) => b._val - a._val).slice(0, 5));
  const hotVal  = sumVals(open.filter(d => d.type === 'hot'));
  const bullets = [
    topCo   && `<strong>${esc(topCo.label)}</strong> carries ₹${fmtNum(topCo.value)}L — ${share(topCo.value, openVal)}% of the open pipeline. ${share(topCo.value, openVal) > 40 ? 'High concentration: a slip there moves the whole year.' : 'Reasonably diversified.'}`,
    `The <strong>top 5 tickets hold ${share(top5Val, openVal)}%</strong> of open value (₹${fmtNum(top5Val)}L) — effort belongs there first (see the Focus tab).`,
    topCat  && `Biggest category: <strong>${esc(topCat.label)}</strong> at ₹${fmtNum(topCat.value)}L (${share(topCat.value, openVal)}%).`,
    `Hot deals are <strong>${share(hotVal, openVal)}% of open value</strong> (₹${fmtNum(hotVal)}L) — the rest needs warming or requalifying.`,
    biggest && `Single biggest open ticket: <strong>${esc(biggest.company)} · ${esc(biggest.deliverable !== '—' ? biggest.deliverable : 'untitled')}</strong> at ₹${fmtNum(biggest._val)}L (${share(biggest._val, openVal)}% of pipeline).`,
    unpriced > 0 && `<strong>${unpriced} open deal${unpriced !== 1 ? 's have' : ' has'} no value</strong> (TBD) — pricing them could move every number on this page.`,
    won.length + lost.length > 0 && `Closed so far: <strong>₹${fmtNum(wonVal)}L won</strong> across ${won.length} deals${lost.length ? ` vs ₹${fmtNum(lostVal)}L lost (${lost.length})` : ' — nothing lost yet'}.`,
    cold.length > 0 && `₹${fmtNum(sumVals(cold))}L sits in <strong>${cold.length} cold deals</strong> — a nurture backlog worth a quarterly review.`,
  ].filter(Boolean);

  return `
    <div class="section-head" style="margin-top:0">
      <h2>Pipeline insights</h2>
      <span class="muted">full book analysis · filters ignored</span>
    </div>
    <div class="ins-stats">
      <div class="ins-stat"><span class="ins-stat__label">Open pipeline</span><span class="ins-stat__val">₹${fmtNum(openVal) || 0}L</span><span class="ins-stat__sub">${open.length} deals</span></div>
      <div class="ins-stat"><span class="ins-stat__label">Closed won</span><span class="ins-stat__val" style="color:var(--won)">₹${fmtNum(wonVal) || 0}L</span><span class="ins-stat__sub">${won.length} deals</span></div>
      <div class="ins-stat"><span class="ins-stat__label">Avg open ticket</span><span class="ins-stat__val">₹${fmtNum(avgTicket) || 0}L</span><span class="ins-stat__sub">${priced.length} priced deals</span></div>
      <div class="ins-stat"><span class="ins-stat__label">Conversion (value)</span><span class="ins-stat__val">${share(wonVal, wonVal + openVal + lostVal)}%</span><span class="ins-stat__sub">won ÷ (won + open + lost)</span></div>
    </div>
    <div class="ins-grid">
      ${tplDonutCard('Open pipeline by company', byCompany)}
      ${hasCategories
        ? tplDonutCard('Open pipeline by category', byCategory)
        : `<div class="chart-card"><div class="chart-card__title">Open pipeline by category</div>
             <div class="empty" style="padding:30px 16px">No category data yet — fill the new Category column in the sheet and sync.</div></div>`}
      ${hist}
      ${funnel}
    </div>
    <div style="margin-bottom:12px">${tplBDInsightsSection()}</div>
    <div class="chart-card">
      <div class="chart-card__title">Talking points</div>
      <ul class="ins-bullets">${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
    </div>`;
}

// ─── BD Team performance ──────────────────────────────────────────────────────

const FY_MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

// Default monthly meeting target per BD — mirrors the BD dashboard's built-in
// targets (its cloud payload stores targets only when overridden).
const BD_DEFAULT_MEET_TARGET = 20;
function bdMeetTarget(targets, m) {
  return Number(targets?.[m]?.meetings) || BD_DEFAULT_MEET_TARGET;
}

function bdMonthsElapsed() {
  // FY runs Apr→Mar; return the FY months up to and including the current one.
  const now = new Date();
  const key = now.toLocaleDateString('en', { month: 'short' });
  const i = FY_MONTHS.indexOf(key);
  return i >= 0 ? FY_MONTHS.slice(0, i + 1) : FY_MONTHS;
}

function bdColor(name) { return BD_COLORS[name] || coColor(name); }

// Sum a KPI across the given months for one BD.
function bdSum(kpis, bd, months, field) {
  return months.reduce((s, m) => s + (Number(kpis[bd]?.[m]?.[field]) || 0), 0);
}

// The BD dashboard recomputes meetings/proposals LIVE from its meetings/deals
// logs; its stored kpis are a snapshot that can lag. Mirror its exact logic
// (count by calendar month, exclude phone calls, keep manual entries via max).
const BD_MONTH_NUM = { Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',Jan:'01',Feb:'02',Mar:'03' };
function bdMonthPrefix(mk) {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const year = ['Jan','Feb','Mar'].includes(mk) ? fyStart + 1 : fyStart;
  return `${year}-${BD_MONTH_NUM[mk]}`;
}
function bdMeetCount(kpis, meetings, bd, months) {
  return months.reduce((s, mk) => {
    const pre = bdMonthPrefix(mk);
    const live = meetings.filter(m => m.bd === bd && (m.date || '').startsWith(pre) &&
      (m.type || 'Physical').toLowerCase() !== 'call').length;
    return s + Math.max(live, Number(kpis[bd]?.[mk]?.meetings) || 0);
  }, 0);
}
function bdPropSum(kpis, deals, bd, months) {
  return months.reduce((s, mk) => {
    const pre = bdMonthPrefix(mk);
    const live = deals.filter(d => d.bd === bd && (d.meetDate || '').startsWith(pre) && Number(d.value) > 0)
      .reduce((x, d) => x + Number(d.value), 0);
    return s + Math.max(live, Number(kpis[bd]?.[mk]?.proposals) || 0);
  }, 0);
}

function tplBDStrip(stats) {
  return `<div class="ins-stats">${stats.map(s =>
    `<div class="ins-stat"><span class="ins-stat__label">${s.label}</span>
     <span class="ins-stat__val" ${s.color ? `style="color:${s.color}"` : ''}>${s.val}</span>
     <span class="ins-stat__sub">${s.sub || ''}</span></div>`).join('')}</div>`;
}

function viewBDTeam() {
  if (!bdData) {
    if (!bdError) { loadBDData(); return `<div class="loading-state">Loading BD dashboard data…</div>`; }
    return `<div class="empty" style="color:var(--hot)">Could not load the BD KPI dashboard feed: ${esc(bdError)}
      <br><button class="mpick" style="margin-top:10px" onclick="bdError=null;render()">Retry</button></div>`;
  }
  const kpis     = bdData.kpis || {};
  const targets  = bdData.targets || {};
  const meetings = bdData.meetings || [];
  const deals    = bdData.deals || [];
  const inactive = bdData.bdInactive || [];
  const months   = bdMonthsElapsed();
  const curMon   = months[months.length - 1];
  const bds      = Object.keys(kpis)
    .filter(bd => !inactive.includes(bd))
    .filter(bd => months.some(m => Object.values(kpis[bd]?.[m] || {}).some(v => Number(v) > 0)) ||
                  meetings.some(x => x.bd === bd));

  // FY totals — meetings/proposals derived live from the logs (matches the
  // BD dashboard's own recompute), fieldDays only exists in the kpi snapshot.
  const totMeet  = bds.reduce((s, bd) => s + bdMeetCount(kpis, meetings, bd, months), 0);
  const totProp  = bds.reduce((s, bd) => s + bdPropSum(kpis, deals, bd, months), 0);
  const totField = bds.reduce((s, bd) => s + bdSum(kpis, bd, months, 'fieldDays'), 0);
  const meetTarget = months.reduce((s, m) => s + bdMeetTarget(targets, m), 0) * bds.length;

  // Per-card month scope: each card has its own "FY total | Apr | … " dropdown.
  const scopeMonths = key => {
    const sel = state.bdMon[key] || 'fy';
    return months.includes(sel) ? [sel] : months;
  };
  const scopeLabel = key => {
    const sel = state.bdMon[key] || 'fy';
    return months.includes(sel) ? sel : 'FY total';
  };
  const monSelect = key => `<select class="bd-mon" data-card="${key}">
      <option value="fy" ${(state.bdMon[key] || 'fy') === 'fy' ? 'selected' : ''}>FY total</option>
      ${months.map(m => `<option value="${m}" ${state.bdMon[key] === m ? 'selected' : ''}>${m}</option>`).join('')}
    </select>`;

  // Leaderboard by meetings (per-card scope)
  const leadMonths = scopeMonths('lead');
  const rows = bds.map(bd => ({
    bd,
    meet:  bdMeetCount(kpis, meetings, bd, leadMonths),
    prop:  bdPropSum(kpis, deals, bd, scopeMonths('prop')),
    field: bdSum(kpis, bd, months, 'fieldDays'),
    calls: Number(kpis[bd]?.[curMon]?.callsPerDay) || 0,
  })).sort((a, b) => b.meet - a.meet);
  const maxMeet = Math.max(...rows.map(r => r.meet), 1);
  const perBDTarget = leadMonths.reduce((s, m) => s + bdMeetTarget(targets, m), 0);

  const leaderboard = `<div class="chart-card">
    <div class="chart-card__title">BD leaderboard — meetings <span class="muted-inline">target ${perBDTarget}/BD</span>${monSelect('lead')}</div>
    <div class="funnel">
      ${rows.map(r => {
        const pct = Math.round(r.meet / (perBDTarget || 1) * 100);
        return `<div class="funnel-row">
          <span class="funnel-row__label"><span class="legend-dot" style="background:${bdColor(r.bd)};display:inline-block;margin-right:6px"></span>${esc(r.bd)}</span>
          <div class="funnel-row__track">
            <div class="funnel-row__bar" style="width:${Math.max(2, r.meet / maxMeet * 100)}%;background:${bdColor(r.bd)}"></div>
          </div>
          <span class="funnel-row__num">${r.meet} · ${pct}% of tgt</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // Monthly meetings trend vs team target
  const monthTeamMeet = m => bds.reduce((s, bd) => s + bdMeetCount(kpis, meetings, bd, [m]), 0);
  const trendMax = Math.max(...months.map(monthTeamMeet),
                            ...months.map(m => bdMeetTarget(targets, m) * bds.length), 1);
  const trend = `<div class="chart-card">
    <div class="chart-card__title">Meetings by month <span class="muted-inline">line marker = team target</span></div>
    <div class="hist">
      ${months.map(m => {
        const v = monthTeamMeet(m);
        const t = bdMeetTarget(targets, m) * bds.length;
        return `<div class="hist-col">
          <div class="hist-col__value">${v}</div>
          <div class="hist-col__stack" style="height:130px">
            ${t ? `<div class="hist-col__target" style="bottom:${Math.min(126, t / trendMax * 126)}px"></div>` : ''}
            <div class="hist-col__bar" style="height:${Math.max(3, v / trendMax * 126)}px;background:${v >= t ? 'var(--won)' : 'var(--warm)'}"></div>
          </div>
          <div class="hist-col__label">${m}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // Meeting outcomes donut + accounts coverage donut — filterable by the
  // meeting's own date month via each card's dropdown.
  const meetMonth = x => {
    const dt = new Date(x.date);
    return isNaN(dt) ? null : dt.toLocaleDateString('en', { month: 'short' });
  };
  const meetingsIn = key => {
    const sel = state.bdMon[key] || 'fy';
    return months.includes(sel) ? meetings.filter(x => meetMonth(x) === sel) : meetings;
  };
  const toEntries = (list, keyFn) => Object.entries(list.reduce((m, x) => { const k = keyFn(x) || '—'; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .map(([label, value]) => ({ label, value }));
  const outcomeEntries = toEntries(meetingsIn('out'), x => x.status);
  const accountEntries = toEntries(meetingsIn('acc'), x => x.account);

  const countDonut = (title, entries, key) =>
    entries.length
      ? tplDonutCard(`${title}${monSelect(key)}`, entries, { unit: 'count', unitLabel: 'mtgs' })
      : `<div class="chart-card"><div class="chart-card__title">${title}${monSelect(key)}</div>
         <div class="empty" style="padding:24px">No meetings in ${scopeLabel(key)}.</div></div>`;

  // BD-originated deals summary
  const dealVal = deals.reduce((s, d) => s + (parseValue(d.value) || 0), 0);
  const stages  = Object.entries(deals.reduce((m, d) => { const k = d.stage || '—'; m[k] = (m[k] || 0) + 1; return m; }, {}));

  const proposals = rows.filter(r => r.prop > 0).sort((a, b) => b.prop - a.prop);
  const propMax = Math.max(...proposals.map(r => r.prop), 1);
  const propCard = `<div class="chart-card">
    <div class="chart-card__title">Proposal value originated <span class="muted-inline">₹L</span>${monSelect('prop')}</div>
    <div class="funnel">
      ${proposals.map(r => `<div class="funnel-row">
        <span class="funnel-row__label"><span class="legend-dot" style="background:${bdColor(r.bd)};display:inline-block;margin-right:6px"></span>${esc(r.bd)}</span>
        <div class="funnel-row__track"><div class="funnel-row__bar" style="width:${Math.max(2, r.prop / propMax * 100)}%;background:${bdColor(r.bd)}"></div></div>
        <span class="funnel-row__num">₹${fmtNum(r.prop)}L</span>
      </div>`).join('')}
      ${!proposals.length ? `<div class="empty" style="padding:14px">No proposal value logged in ${scopeLabel('prop')}.</div>` : ''}
    </div>
  </div>`;

  const upd = bdUpdatedAt ? new Date(bdUpdatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  return `
    <div class="section-head" style="margin-top:0">
      <h2>BD team performance</h2>
      <span style="display:inline-flex;align-items:center;gap:10px">
        <span class="muted">from BD KPI dashboard · sheets auto-sync daily · updated ${upd}</span>
        <button id="bd-sync" class="sort-toggle" type="button" title="Re-pull the latest BD dashboard data">↻ Sync BD data</button>
      </span>
    </div>
    ${tplBDStrip([
      { label: 'Team meetings FY', val: totMeet, sub: `target ${meetTarget} · ${meetTarget ? Math.round(totMeet / meetTarget * 100) : 0}%` },
      { label: 'Proposal value originated', val: `₹${fmtNum(totProp) || 0}L`, sub: 'FY to date' },
      { label: 'Field days', val: totField, sub: 'FY to date' },
      { label: 'Active BDs', val: bds.length, sub: bds.join(' · ') },
      { label: 'BD pipeline deals', val: deals.length, sub: `₹${fmtNum(dealVal) || 0}L · ${stages.map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}` },
    ])}
    <div class="ins-grid">
      ${leaderboard}
      ${propCard}
      ${trend}
      ${countDonut('Meeting outcomes', outcomeEntries, 'out')}
      ${countDonut('Meetings by account', accountEntries, 'acc')}
    </div>`;
}

// Compact BD section for the Insights tab.
function tplBDInsightsSection() {
  if (!bdData) {
    if (!bdError) loadBDData();
    return `<div class="chart-card"><div class="chart-card__title">BD activity engine</div>
      <div class="empty" style="padding:20px">${bdError ? 'BD feed unavailable: ' + esc(bdError) : 'Loading BD dashboard data…'}</div></div>`;
  }
  const kpis    = bdData.kpis || {};
  const targets = bdData.targets || {};
  const months  = bdMonthsElapsed();
  const inactive = bdData.bdInactive || [];
  const bds = Object.keys(kpis).filter(bd => !inactive.includes(bd));
  const rows = bds.map(bd => ({
    bd,
    meet: bdMeetCount(kpis, bdData.meetings || [], bd, months),
    prop: bdPropSum(kpis, bdData.deals || [], bd, months),
  })).filter(r => r.meet > 0 || r.prop > 0).sort((a, b) => b.meet - a.meet);
  const totMeet = rows.reduce((s, r) => s + r.meet, 0);
  const totProp = rows.reduce((s, r) => s + r.prop, 0);
  const meetTarget = months.reduce((s, m) => s + bdMeetTarget(targets, m), 0) * rows.length;
  const topBD = rows[0];
  const perMeeting = totMeet ? totProp / totMeet : 0;
  const openVal = sumVals(state.deals.filter(d => (d.type === 'hot' || d.type === 'warm') && d.status !== 'won' && d.status !== 'lost'));

  return `<div class="chart-card">
    <div class="chart-card__title">BD activity engine <span class="muted-inline">from the BD KPI dashboard — the effort feeding this pipeline</span></div>
    ${tplBDStrip([
      { label: 'Team meetings FY', val: totMeet, sub: meetTarget ? `${Math.round(totMeet / meetTarget * 100)}% of target` : '' },
      { label: 'Proposal value originated', val: `₹${fmtNum(totProp) || 0}L`, sub: 'FY to date' },
      { label: 'Value per meeting', val: `₹${fmtNum(perMeeting) || 0}L`, sub: 'proposals ÷ meetings' },
      { label: 'Top contributor', val: topBD ? esc(topBD.bd) : '—', sub: topBD ? `${topBD.meet} meetings · ₹${fmtNum(topBD.prop) || 0}L` : '' },
    ])}
    <ul class="ins-bullets" style="margin-top:12px">
      <li>Every ₹1L of the current ₹${fmtNum(openVal) || 0}L open pipeline is backed by team activity of <strong>${totMeet} meetings</strong> — activity is the leading indicator: if meetings dip, the pipeline follows in 1–2 months.</li>
      ${topBD ? `<li><strong>${esc(topBD.bd)}</strong> leads on activity (${topBD.meet} meetings). See the BD Team tab for the full leaderboard vs targets.</li>` : ''}
    </ul>
  </div>`;
}

// Build the period filter chips dynamically: "All periods" + one chip per
// month that actually has deals, in calendar order. New months (July, Aug, …)
// appear automatically once their deals sync. Legacy weekly buckets are skipped.
function renderPeriodChips() {
  const bar = document.getElementById('period-chips');
  if (!bar) return;
  const present = PERIODS.filter(p =>
    !p.key.includes('_wk') && state.deals.some(d => d.time_period === p.key)
  );
  // If the active month chip no longer has deals, fall back to "All periods".
  if (state.period !== 'all' && !present.some(p => p.key === state.period)) {
    state.period = 'all';
  }
  // Show the deal count per month — Expected closure (col J) is sparse in the
  // sheet, so without counts a month chip looks broken when it matches 1–2 deals.
  bar.innerHTML =
    `<button class="chip ${state.period === 'all' ? 'is-active' : ''}" data-period="all">All periods</button>` +
    present.map(p => {
      const n = state.deals.filter(d => d.time_period === p.key).length;
      return `<button class="chip ${state.period === p.key ? 'is-active' : ''}" data-period="${p.key}">${p.label} <span class="chip__n">${n}</span></button>`;
    }).join('');
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const active = activeDeals();
  const won    = wonDeals();
  const all    = allNonCold();

  // Tab counts
  const allActive = state.deals.filter(d => d.type !== 'cold' && d.status !== 'won');
  const reqCount = state.deals.filter(d => d.status === 'requested').length;
  document.getElementById('tc-pipeline').textContent = allActive.length;
  document.getElementById('tc-won').textContent = state.deals.filter(d => d.status === 'won').length;
  document.getElementById('tc-data').textContent = state.deals.filter(d => d.type !== 'cold').length;
  const tcReq = document.getElementById('tc-requested');
  if (tcReq) tcReq.textContent = reqCount;
  const tcFocus = document.getElementById('tc-focus');
  if (tcFocus) tcFocus.textContent = allActive.length;

  // Results count
  const countMap = { overview: active.length, pipeline: active.length, kanban: all.length, won: won.length, data: all.length, requested: reqCount, focus: allActive.length, insights: state.deals.length, bdteam: (bdData?.meetings || []).length };
  document.getElementById('results-count').textContent = `${countMap[state.tab] || 0} proposals`;

  // Active tab highlight
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === state.tab));

  // Chip states
  document.querySelectorAll('#type-chips .chip').forEach(c =>
    c.classList.toggle('is-active', c.dataset.type === state.type));
  renderPeriodChips();

  // Main content
  const main = document.getElementById('main');
  switch (state.tab) {
    case 'overview': main.innerHTML = viewOverview(active); break;
    case 'pipeline': main.innerHTML = viewPipeline(active); break;
    case 'kanban':   main.innerHTML = tplKanban();          break;
    case 'won':      main.innerHTML = tplWon(won);          break;
    case 'data':     main.innerHTML = tplDataTable(all);    break;
    case 'requested':main.innerHTML = viewRequested();      break;
    case 'focus':    main.innerHTML = viewFocus();           break;
    case 'insights': main.innerHTML = viewInsights();        break;
    case 'bdteam':   main.innerHTML = viewBDTeam();          break;
    default:         main.innerHTML = viewOverview(active);
  }

  wirePerRender();
}

// ─── Per-render DOM wiring ────────────────────────────────────────────────────

function wirePerRender() {
  wireTooltips();
  wireCellClicks();
  wireTableSort();
  wireClosingPeriodSelect();
  wirePipelineSort();
  wireCompanyTabs();
  wireRequestedTabs();
  wireRequestedTile();
  wireFocusMin();
  wireBDMonthSelects();
  wireBDSync();
}

function wireBDSync() {
  const btn = document.getElementById('bd-sync');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '↻ Syncing…';
    bdError = null;
    await loadBDData(); // re-renders the tab when it lands
  });
}

function wireBDMonthSelects() {
  document.querySelectorAll('.bd-mon').forEach(sel => {
    sel.addEventListener('change', () => {
      state.bdMon[sel.dataset.card] = sel.value;
      render();
    });
  });
}

function wireFocusMin() {
  const bar = document.getElementById('focus-min');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    state.focusMin = b.dataset.min;
    render();
  });
}

function wireCompanyTabs() {
  const bar = document.getElementById('co-tabs');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const t = e.target.closest('[data-co]');
    if (!t) return;
    state.pipelineCompany = t.dataset.co;
    render();
  });
}

function wireRequestedTabs() {
  const bar = document.getElementById('req-co-tabs');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const t = e.target.closest('[data-co]');
    if (!t) return;
    state.requestedCompany = t.dataset.co;
    render();
  });
}

function wireRequestedTile() {
  const tile = document.getElementById('kpi-requested');
  if (!tile) return;
  const go = () => { state.tab = 'requested'; state.requestedCompany = 'all'; render(); };
  tile.addEventListener('click', go);
  tile.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });
}

function wirePipelineSort() {
  const btn = document.getElementById('pipeline-sort');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.pipelineDir = state.pipelineDir === 'asc' ? 'desc' : 'asc';
    render();
  });
}

function wireClosingPeriodSelect() {
  const grp = document.getElementById('closing-pills');
  if (!grp) return;
  grp.addEventListener('click', e => {
    const b = e.target.closest('[data-closing]');
    if (!b) return;
    state.closingPeriod = b.dataset.closing;
    render();
  });
}

// [P-2] Single delegated listener on the heatmap instead of 3 listeners per mini.
function wireTooltips() {
  const map = document.querySelector('.heatmap');
  if (!map) return;
  map.addEventListener('mouseover', e => {
    const el = e.target.closest('.heat-mini[data-tip]');
    if (!el) return;
    document.getElementById('tt-title').textContent   = el.dataset.tip;
    document.getElementById('tt-value').textContent   = el.dataset.val;
    document.getElementById('tt-status').textContent  = el.dataset.status;
    document.getElementById('tt-contact').textContent = el.dataset.contact;
    _TIP.style.display = 'block';
    moveTip(e);
  });
  map.addEventListener('mousemove', e => {
    if (e.target.closest('.heat-mini[data-tip]')) moveTip(e);
  });
  map.addEventListener('mouseout', e => {
    const to = e.relatedTarget;
    if (!to || !to.closest || !to.closest('.heat-mini[data-tip]')) _TIP.style.display = 'none';
  });
}

// [P-3] Cache tooltip element once rather than querying on every mousemove
const _TIP = document.getElementById('tooltip');

function moveTip(e) {
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + 280 > window.innerWidth)  x = e.clientX - 280 - 10;
  if (y + 120 > window.innerHeight) y = e.clientY - 120 - 10;
  _TIP.style.left = x + 'px';
  _TIP.style.top  = y + 'px';
}

function wireCellClicks() {
  document.querySelectorAll('.heatmap__cell.is-clickable, .heat-more').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const co     = el.dataset.cellCo || el.closest('[data-cell-co]')?.dataset.cellCo;
      const period = el.dataset.cellPeriod;
      if (!co || !period) return;
      openPopover(el.closest('.heatmap__cell')?.getBoundingClientRect() || el.getBoundingClientRect(), co, period);
    });
  });
}

function wireTableSort() {
  document.querySelectorAll('.data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      if (state.sortBy === th.dataset.sort) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy  = th.dataset.sort;
        state.sortDir = th.dataset.sort === 'value' ? 'desc' : 'asc';
      }
      render();
    });
  });
}

// ─── Cell popover ─────────────────────────────────────────────────────────────

// [E-6] Store popover keydown handler at module level to prevent listener leaks
let _popKeyHandler = null;

function openPopover(rect, company, periodKey) {
  closePopover();
  const pInfo = periodInfo(periodKey);
  const cellDeals = state.deals.filter(d =>
    d.company === company && d.time_period === periodKey && d.type !== 'cold'
  );
  const total = sumVals(cellDeals);

  const items = cellDeals.map(d => {
    const isWon = d.status === 'won';
    const hasT = d.deliverable && d.deliverable !== '—';
    return `<div class="cell-pop__item type-${d.type} ${isWon ? 'is-won' : ''}">
      <div class="cell-pop__itemTop">
        ${typeBadge(d.type)}
        <span class="cell-pop__value ${d._val == null ? 'is-tbd' : ''}">
          ${d._val != null ? `₹${fmtNum(d._val)}<span class="u">L</span>` : 'TBD'}
        </span>
      </div>
      <div class="cell-pop__title ${!hasT ? 'is-empty' : ''}">${hasT ? esc(d.deliverable) : 'Untitled proposal'}</div>
      <div class="cell-pop__meta">
        ${statusBadge(d.status)}
        <span class="cell-pop__contact">${esc(d.client_contact || '—')}</span>
      </div>
    </div>`;
  }).join('');

  const popW = 340;
  const popH = Math.min(cellDeals.length * 108 + 100, window.innerHeight * 0.75);
  const below = window.innerHeight - rect.bottom;
  const above = rect.top;
  const top = below >= popH + 16 ? rect.bottom + 8
    : above >= popH + 16 ? rect.top - popH - 8
    : Math.max(12, window.innerHeight / 2 - popH / 2);
  let left = rect.left + rect.width / 2 - popW / 2;
  left = Math.max(12, Math.min(window.innerWidth - popW - 12, left));

  const backdrop = document.createElement('div');
  backdrop.className = 'cell-pop__backdrop';
  backdrop.id = 'cpop-bg';
  backdrop.addEventListener('click', closePopover);

  const pop = document.createElement('div');
  pop.className = 'cell-pop';
  pop.id = 'cpop';
  pop.style.cssText = `top:${top}px;left:${left}px;width:${popW}px;max-height:${Math.round(popH)}px`;
  pop.innerHTML = `
    <div class="cell-pop__head">
      ${coAvatar(company)}
      <span class="cell-pop__period">${pInfo.label}</span>
      <button class="cell-pop__close" id="cpop-close">✕</button>
    </div>
    <div class="cell-pop__sub">
      ${cellDeals.length} proposal${cellDeals.length !== 1 ? 's' : ''}
      <strong>₹${fmtNum(total) || '0'}<span class="muted" style="margin-left:3px;font-family:var(--font-sans)">L</span></strong>
    </div>
    <div class="cell-pop__list">${items}</div>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(pop);

  document.getElementById('cpop-close').addEventListener('click', closePopover);
  _popKeyHandler = e => { if (e.key === 'Escape') closePopover(); };
  document.addEventListener('keydown', _popKeyHandler);
}

function closePopover() {
  if (_popKeyHandler) {
    document.removeEventListener('keydown', _popKeyHandler);
    _popKeyHandler = null;
  }
  document.getElementById('cpop')?.remove();
  document.getElementById('cpop-bg')?.remove();
}

// ─── Sync indicator ───────────────────────────────────────────────────────────

function updateSyncPill() {
  const label = document.getElementById('sync-label');
  const pill  = document.getElementById('sync-pill');
  if (!label) return;
  const t = relTime(state.lastSyncedAt);
  label.textContent = t ? `Synced ${t}` : 'Never synced';
  if (state.lastSyncedAt) pill.title = new Date(state.lastSyncedAt).toLocaleString('en-IN');
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  if (theme === 'dark') {
    icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  } else {
    icon.innerHTML = `<circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>  <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>  <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  }
}

// ─── Auth + API ───────────────────────────────────────────────────────────────

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('heatmap_token');
    authToken = null;
    eventsWired = false;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'flex';
    const err = document.getElementById('auth-err');
    err.textContent = 'Session expired — please log in again.';
    // [A-1] Return null so callers' `if (!res) return` guards actually fire,
    // instead of falling through to throw/alert over the auth overlay.
    return null;
  }
  return res;
}

async function loadData() {
  const res = await apiFetch('/api/proposals');
  if (!res) return; // 401 handled inside apiFetch
  if (!res.ok) throw new Error(`Failed to load proposals (HTTP ${res.status})`);
  const proposals = await res.json();
  // [D-6] Only overwrite state once we have a valid array — preserves last-good data
  if (!Array.isArray(proposals)) throw new Error('Malformed proposals response');
  state.deals = proposals.map(mapDeal);
  render();
}

let _syncing = false; // [E-10] guard against concurrent syncs
async function doSync() {
  if (_syncing) return;
  _syncing = true;
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '↻ Syncing…';
  try {
    const res = await apiFetch('/api/sync', { method: 'POST' });
    if (!res) return; // 401 handled inside apiFetch
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    state.lastSyncedAt = Date.now();
    localStorage.setItem('lastSyncedAt', state.lastSyncedAt);
    updateSyncPill();
    await loadData();
    if (data.cold_skipped) alert(data.message); // surface partial-sync notice
  } catch (err) {
    alert('Sync failed: ' + err.message); // [D-6] state.deals untouched on failure
  } finally {
    _syncing = false;
    btn.disabled = false;
    btn.textContent = '↻ Sync';
  }
}

// ─── Static event wiring (called once on showApp) ─────────────────────────────

function wireStaticEvents() {
  if (eventsWired) return;
  eventsWired = true;

  // Tabs
  document.getElementById('tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { state.tab = tab.dataset.tab; render(); }
  });

  // Type chips
  document.getElementById('type-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-type]');
    if (chip) { state.type = chip.dataset.type; render(); }
  });

  // Period chips
  document.getElementById('period-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-period]');
    if (chip) { state.period = chip.dataset.period; render(); }
  });

  // Search
  const search = document.getElementById('search-input');
  search.addEventListener('input', () => { state.query = search.value.trim(); render(); });

  // ⌘K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); search.focus(); }
  });

  // Sync button
  document.getElementById('sync-btn').addEventListener('click', doSync);

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur  = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mp-theme', next);
    updateThemeIcon(next);
  });
}

// ─── Show app ─────────────────────────────────────────────────────────────────

async function showApp() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';

  const { day, sub } = fmtDate();
  document.getElementById('date-block').innerHTML =
    `<span class="date-block__day">${day}</span><span class="date-block__sub">${sub}</span>`;

  updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');
  updateSyncPill();
  wireStaticEvents();
  // [P-4] Start refresh interval only after login, not at module load.
  // [U-4] Also refresh the displayed date so it doesn't go stale past midnight.
  if (!window._syncPillInterval) {
    window._syncPillInterval = setInterval(() => {
      updateSyncPill();
      const { day, sub } = fmtDate();
      const db = document.getElementById('date-block');
      if (db) db.innerHTML = `<span class="date-block__day">${day}</span><span class="date-block__sub">${sub}</span>`;
    }, 30000);
  }

  loadBDData(); // fire-and-forget: BD Team / Insights re-render when it lands

  document.getElementById('main').innerHTML = '<div class="loading-state">Loading proposals…</div>';
  try {
    await loadData();
  } catch (e) {
    document.getElementById('main').innerHTML =
      `<div class="empty" style="color:var(--hot)">Error loading data: ${e.message}</div>`;
  }
}

// ─── Auth flow ────────────────────────────────────────────────────────────────

async function login() {
  const pw  = document.getElementById('pw').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('auth-err');
  if (!pw) return;
  btn.disabled = true;
  btn.textContent = 'Verifying…';
  err.textContent = '';
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    // [A-3] Tell apart a wrong password (401), rate-limit (429), and other
    // server/network failures instead of always blaming the password.
    if (res.status === 401) throw new Error('Incorrect password. Try again.');
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Too many attempts. Please wait and retry.');
    }
    if (!res.ok) throw new Error(`Login failed (HTTP ${res.status}). Try again.`);
    const { token } = await res.json();
    authToken = token;
    localStorage.setItem('heatmap_token', token);
    showApp();
  } catch (e) {
    err.textContent = (e instanceof TypeError)
      ? 'Network error — check your connection and retry.'
      : (e.message || 'Login failed. Try again.');
    btn.disabled = false;
    btn.textContent = 'Access dashboard →';
    document.getElementById('pw').value = '';
    document.getElementById('pw').focus();
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// Apply theme icon immediately (before auth check)
updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

if (authToken) {
  showApp();
} else {
  document.getElementById('auth-overlay').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
}
