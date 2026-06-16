// MP Proposal Tracker — app.js
// Vanilla JS state + render. No frameworks, no build step.

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS = [
  { key: 'march_wk3', label: 'Mar W3', state: 'past' },
  { key: 'march_wk4', label: 'Mar W4', state: 'past' },
  { key: 'april_wk1', label: 'Apr W1', state: 'past' },
  { key: 'april_wk2', label: 'Apr W2', state: 'past' },
  { key: 'april_wk3', label: 'Apr W3', state: 'past' },
  { key: 'april_wk4', label: 'Apr W4', state: 'past' },
  { key: 'may',       label: 'May',    state: 'current' },
  { key: 'june_plus', label: 'June+',  state: 'future' },
];

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
  sortBy:         'value',
  sortDir:        'desc',
  deals:          [],
  lastSyncedAt: localStorage.getItem('lastSyncedAt')
    ? parseInt(localStorage.getItem('lastSyncedAt')) : null,
};

let authToken       = localStorage.getItem('heatmap_token');
let eventsWired     = false;

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
      if (state.period === 'may'  && d.time_period !== 'may')       return false;
      if (state.period === 'june' && d.time_period !== 'june_plus') return false;
      return matchesSearch(d);
    });
  }
  return state.deals.filter(d => {
    if (d.type === 'cold' || d.status === 'won' || d.status === 'lost') return false;
    if (state.type !== 'all' && d.type !== state.type) return false;
    if (state.period === 'may'  && d.time_period !== 'may')       return false;
    if (state.period === 'june' && d.time_period !== 'june_plus') return false;
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
    won:        ['won',     'Won'],
    lost:       ['lost',    'Lost'],
    shared:     ['shared',  'Proposal shared'],
    discussion: ['discuss', 'In discussion'],
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
  const allTotal = sumVals(state.deals);
  const wonList  = state.deals.filter(d => d.status === 'won');
  const lostList = state.deals.filter(d => d.status === 'lost');
  const wonCount = wonList.length;
  const wonVal   = sumVals(wonList);
  const lostVal  = sumVals(lostList);
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
    <div class="kpi">
      <div class="kpi__label">Total pipeline value</div>
      <div class="kpi__value" style="font-size:24px">₹${fmtNum(allTotal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta">hot + warm + cold + won</div>
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

  const visiblePeriods = PERIODS.filter(p =>
    p.state !== 'past' || forHeat.some(d => d.time_period === p.key)
  );
  const companies = [...new Set(forHeat.filter(d => d.time_period).map(d => d.company))];

  if (!companies.length) return `<div class="empty">No scheduled proposals.</div>`;

  const headCells = visiblePeriods.map(p =>
    `<div class="heatmap__hcell ${p.state === 'current' ? 'is-current' : ''}">
      ${p.state === 'current' ? '● ' : ''}${p.label}
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
      return `<div class="heatmap__cell ${cls} ${p.state === 'current' ? 'is-current' : ''} ${clickable ? 'is-clickable' : ''}"
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
  const currentPeriodKey = PERIODS.find(p => p.state === 'current')?.key || 'may';
  const deals4kanban = state.deals.filter(d => d.type !== 'cold' && d.status !== 'lost' && matchesSearch(d));
  // [U-1] Apply period filter to Kanban (same as other tabs)
  const periodFiltered = deals4kanban.filter(d => {
    if (state.period === 'may'  && d.time_period !== 'may')       return false;
    if (state.period === 'june' && d.time_period !== 'june_plus') return false;
    return true;
  });
  const all = periodFiltered;
  const bucket = d => {
    if (d.status === 'won')        return 'won';
    if (d.status === 'shared' && d.time_period === currentPeriodKey) return 'closing';
    if (d.status === 'shared')     return 'shared';
    if (d.status === 'discussion') return 'discussion';
    return 'new';  // [L-4] null status gets its own bucket instead of mixing with discussion
  };
  const cols = [
    { key: 'new',        label: 'New / No status',  dot: 'var(--ink-3)' },
    { key: 'discussion', label: 'In discussion',    dot: 'var(--discuss)' },
    { key: 'shared',     label: 'Proposal shared',  dot: 'var(--shared)' },
    { key: 'closing',    label: 'Closing now',      dot: 'var(--hot)' },
    { key: 'won',        label: 'Closed won',       dot: 'var(--won)' },
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
  // Periods that actually have deals, in PERIODS order
  const periodsWithDeals = PERIODS.filter(p =>
    deals.some(d => d.time_period === p.key)
  );
  // [L-6] Don't mutate state inside render — compute display period locally
  const displayPeriodKey = periodsWithDeals.some(p => p.key === state.closingPeriod)
    ? state.closingPeriod
    : (periodsWithDeals[0]?.key || state.closingPeriod);
  const selPeriod = PERIODS.find(p => p.key === displayPeriodKey) ||
                    { key: displayPeriodKey, label: displayPeriodKey };
  const closingDeals = deals.filter(d => d.time_period === displayPeriodKey);

  const periodOpts = periodsWithDeals.map(p =>
    `<option value="${p.key}" ${p.key === displayPeriodKey ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  const closingHeading = periodsWithDeals.length > 0
    ? `<h2 class="section-head__pick">Closing in
        <select id="closing-period-select" class="period-select">${periodOpts}</select>
       </h2>`
    : `<h2>Closing deals</h2>`;

  return `
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
  return `
    <div class="section-head" style="margin-top:0">
      <h2>Active pipeline</h2>
      <button id="pipeline-sort" class="sort-toggle" type="button"
        title="Toggle value sort order">
        ${deals.length} proposals · value ${state.pipelineDir === 'asc' ? '↑ ascending' : '↓ descending'}
      </button>
    </div>
    ${tplPipelineCards(deals)}
    <div class="section-head">
      <h2>Value by company</h2>
    </div>
    ${state.type === 'cold'
      ? `<div class="empty" style="padding:20px;text-align:left;color:var(--ink-3)">Cold deals are shown in the cold segment below — no bar chart for nurture stage.</div>`
      : tplChart(deals)}
    ${tplColdSegment()}`;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const active = activeDeals();
  const won    = wonDeals();
  const all    = allNonCold();

  // Tab counts
  const allActive = state.deals.filter(d => d.type !== 'cold' && d.status !== 'won');
  document.getElementById('tc-pipeline').textContent = allActive.length;
  document.getElementById('tc-won').textContent = state.deals.filter(d => d.status === 'won').length;
  document.getElementById('tc-data').textContent = state.deals.filter(d => d.type !== 'cold').length;

  // Results count
  const countMap = { overview: active.length, pipeline: active.length, kanban: all.length, won: won.length, data: all.length };
  document.getElementById('results-count').textContent = `${countMap[state.tab] || 0} proposals`;

  // Active tab highlight
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === state.tab));

  // Chip states
  document.querySelectorAll('#type-chips .chip').forEach(c =>
    c.classList.toggle('is-active', c.dataset.type === state.type));
  document.querySelectorAll('#period-chips .chip').forEach(c =>
    c.classList.toggle('is-active', c.dataset.period === state.period));

  // Main content
  const main = document.getElementById('main');
  switch (state.tab) {
    case 'overview': main.innerHTML = viewOverview(active); break;
    case 'pipeline': main.innerHTML = viewPipeline(active); break;
    case 'kanban':   main.innerHTML = tplKanban();          break;
    case 'won':      main.innerHTML = tplWon(won);          break;
    case 'data':     main.innerHTML = tplDataTable(all);    break;
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
  const sel = document.getElementById('closing-period-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    state.closingPeriod = sel.value;
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
