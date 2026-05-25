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
  tab:         'overview',
  query:       '',
  type:        'all',
  period:      'all',
  sortBy:      'value',
  sortDir:     'desc',
  deals:       [],
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
  if (n == null) return null;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function sumVals(deals) {
  return deals.reduce((s, d) => s + (d._val || 0), 0);
}

const _colorCache = {};
function coColor(name) {
  if (_colorCache[name]) return _colorCache[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7FFFFFFF;
  return (_colorCache[name] = CO_PALETTE[h % CO_PALETTE.length]);
}

function coShort(name) {
  return name.replace(/[^A-Za-z\s]/g, '').trim()
    .split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
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
  // Hot + Warm, not won, not cold — with all filters
  return state.deals.filter(d => {
    if (d.type === 'cold' || d.status === 'won') return false;
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
  return state.deals.filter(d => d.type === 'cold');
}

function allNonCold() {
  // For data table: hot+warm+won, searchable, type-filterable
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
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusBadge(status) {
  if (!status) return `<span class="badge badge--null">no status</span>`;
  const MAP = {
    won:        ['won',     'Won'],
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
  if (hasHot && hasWarm && lvl >= 3) return `h-mix-${Math.min(lvl, 4)}`;
  return hasHot ? `h-hot-${lvl}` : `h-warm-${lvl}`;
}

function sparkSvg(vals, color) {
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
  // deals = activeDeals() → used for Active Pipeline (non-won, non-cold)
  // Hot/Warm tiles count ALL deals of that type (incl. won) — matches sheet total
  const allNonCold = state.deals.filter(d => d.type !== 'cold');
  const hot  = allNonCold.filter(d => d.type === 'hot');
  const warm = allNonCold.filter(d => d.type === 'warm');
  const tv  = sumVals(deals);
  const hv  = sumVals(hot);
  const wv  = sumVals(warm);
  const wonHot  = hot.filter(d => d.status === 'won').length;
  const wonWarm = warm.filter(d => d.status === 'won').length;
  const allTotal  = sumVals(state.deals);
  const wonCount  = state.deals.filter(d => d.status === 'won').length;
  const coldCount = state.deals.filter(d => d.type === 'cold').length;
  return `<div class="kpis">
    <div class="kpi">
      <div class="kpi__label">Active pipeline</div>
      <div class="kpi__value">₹${fmtNum(tv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${deals.length}</strong> open hot + warm</div>
      ${sparkSvg([3,4,5,7,6,8,10,9,12],'var(--ink-2)')}
    </div>
    <div class="kpi kpi--hot">
      <div class="kpi__label"><span class="ddot" style="background:var(--hot)"></span>Hot</div>
      <div class="kpi__value">₹${fmtNum(hv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${hot.length}</strong> deals${wonHot ? ` · ${wonHot} won` : ''}</div>
      ${sparkSvg([2,3,3,5,6,5,7,8,8],'var(--hot)')}
    </div>
    <div class="kpi kpi--warm">
      <div class="kpi__label"><span class="ddot" style="background:var(--warm)"></span>Warm</div>
      <div class="kpi__value">₹${fmtNum(wv) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta"><strong>${warm.length}</strong> deals${wonWarm ? ` · ${wonWarm} won` : ''}</div>
      ${sparkSvg([4,4,5,6,5,6,6,7,7],'var(--warm)')}
    </div>
    <div class="kpi">
      <div class="kpi__label">Total pipeline value</div>
      <div class="kpi__value" style="font-size:28px">₹${fmtNum(allTotal) || '0'}<span class="kpi__unit">L</span></div>
      <div class="kpi__delta">incl. <strong>${wonCount} won</strong> · <strong>${coldCount} cold</strong></div>
    </div>
  </div>`;
}

function tplClosingWeek(deals) {
  const closing = deals.filter(d => d.time_period === 'may');
  if (!closing.length) return `<div class="empty">No proposals closing in May.</div>`;
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
    if (d.type === 'cold') return false;
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
  const sorted = [...deals].sort((a, b) => (b._val || 0) - (a._val || 0));
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

function tplChart(deals) {
  const byCompany = {};
  for (const d of deals.filter(d => d.status !== 'won')) {
    if (!byCompany[d.company]) byCompany[d.company] = { hot: 0, warm: 0 };
    byCompany[d.company][d.type] = (byCompany[d.company][d.type] || 0) + (d._val || 0);
  }
  const rows = Object.entries(byCompany)
    .map(([co, v]) => ({ co, hot: v.hot || 0, warm: v.warm || 0, total: (v.hot || 0) + (v.warm || 0) }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return '';
  const max = rows[0].total || 1;
  return `<div class="chart">
    ${rows.map(r => `<div class="chart-row">
      <div>${coAvatar(r.co)}</div>
      <div class="chart-row__bars">
        ${r.hot  > 0 ? `<div class="chart-row__bar chart-row__bar--hot"  style="width:${(r.hot/max*100).toFixed(1)}%" title="Hot ₹${r.hot}L"></div>` : ''}
        ${r.warm > 0 ? `<div class="chart-row__bar chart-row__bar--warm" style="width:${(r.warm/max*100).toFixed(1)}%" title="Warm ₹${r.warm}L"></div>` : ''}
      </div>
      <div class="chart-row__total">₹${fmtNum(r.total)}<span class="muted" style="margin-left:3px">L</span></div>
    </div>`).join('')}
  </div>`;
}

function tplKanban() {
  const all = state.deals.filter(d => d.type !== 'cold' && matchesSearch(d));
  const bucket = d => {
    if (d.status === 'won')        return 'won';
    if (d.status === 'shared' && d.time_period === 'may') return 'closing';
    if (d.status === 'shared')     return 'shared';
    return 'discussion';  // null status + 'discussion' status
  };
  const cols = [
    { key: 'discussion', label: 'In discussion',   dot: 'var(--discuss)' },
    { key: 'shared',     label: 'Proposal shared', dot: 'var(--shared)' },
    { key: 'closing',    label: 'Closing now',     dot: 'var(--hot)' },
    { key: 'won',        label: 'Closed won',      dot: 'var(--won)' },
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
          return `<div class="kb-card">
            <div class="kb-card__head">
              ${coAvatar(d.company)}
              ${typeBadge(d.type)}
            </div>
            <div class="kb-card__title">${d.deliverable && d.deliverable !== '—' ? esc(d.deliverable) : 'Untitled'}</div>
            <div class="kb-card__foot">
              <span class="mono" style="font-size:11px">${pInfo.label || '—'}</span>
              <span class="kb-card__value ${d._val == null ? 'is-tbd' : ''}">${d._val != null ? '₹' + fmtNum(d._val) + 'L' : 'TBD'}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function tplWonChart(deals) {
  const byCompany = {};
  for (const d of deals) {
    if (!byCompany[d.company]) byCompany[d.company] = { hot: 0, warm: 0 };
    byCompany[d.company][d.type] = (byCompany[d.company][d.type] || 0) + (d._val || 0);
  }
  const rows = Object.entries(byCompany)
    .map(([co, v]) => ({ co, hot: v.hot || 0, warm: v.warm || 0, total: (v.hot || 0) + (v.warm || 0) }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return '';
  const max = rows[0].total || 1;
  return `<div class="chart">
    ${rows.map(r => `<div class="chart-row">
      <div>${coAvatar(r.co)}</div>
      <div class="chart-row__bars">
        ${r.hot  > 0 ? `<div class="chart-row__bar chart-row__bar--won" style="width:${(r.hot/max*100).toFixed(1)}%" title="Hot won ₹${r.hot}L"></div>` : ''}
        ${r.warm > 0 ? `<div class="chart-row__bar chart-row__bar--won" style="width:${(r.warm/max*100).toFixed(1)}%;opacity:.6" title="Warm won ₹${r.warm}L"></div>` : ''}
      </div>
      <div class="chart-row__total">₹${fmtNum(r.total)}<span class="muted" style="margin-left:3px">L</span></div>
    </div>`).join('')}
  </div>`;
}

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
        <div class="won-stat__value">₹${fmtNum(total / sorted.length) || '—'}<span class="u">L</span></div>
        <div class="won-stat__sub">across ${sorted.length} deals</div>
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
  return `
    <div class="section-head" style="margin-top:0"><h2>Key metrics</h2></div>
    ${tplKpis(deals)}
    <div class="section-head">
      <h2>Closing in May</h2>
      <span class="muted">${deals.filter(d => d.time_period === 'may').length} proposals</span>
    </div>
    ${tplClosingWeek(deals)}
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
      <span class="muted">${deals.length} proposals · sorted by value</span>
    </div>
    ${tplPipelineCards(deals)}
    <div class="section-head">
      <h2>Value by company</h2>
    </div>
    ${tplChart(deals)}
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
  const countMap = { overview: active.length, pipeline: active.length, kanban: allNonCold().length, won: won.length, data: all.length };
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
}

function wireTooltips() {
  const tip = document.getElementById('tooltip');
  document.querySelectorAll('.heat-mini[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', e => {
      document.getElementById('tt-title').textContent   = el.dataset.tip;
      document.getElementById('tt-value').textContent   = el.dataset.val;
      document.getElementById('tt-status').textContent  = el.dataset.status;
      document.getElementById('tt-contact').textContent = el.dataset.contact;
      tip.style.display = 'block';
      moveTip(e);
    });
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

function moveTip(e) {
  const tip = document.getElementById('tooltip');
  let x = e.pageX + 14, y = e.pageY + 14;
  if (x + 280 > window.innerWidth)  x = e.pageX - 280 - 10;
  if (y + 120 > window.innerHeight) y = e.pageY - 120 - 10;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

function wireCellClicks() {
  document.querySelectorAll('.heatmap__cell.is-clickable, .heat-more').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const co     = el.dataset.cellCo || el.dataset.cellCo;
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
  const onKey = e => { if (e.key === 'Escape') closePopover(); };
  document.addEventListener('keydown', onKey);
  pop._onKey = onKey;
}

function closePopover() {
  const pop = document.getElementById('cpop');
  if (pop) { document.removeEventListener('keydown', pop._onKey); pop.remove(); }
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

setInterval(updateSyncPill, 30000);

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
  }
  return res;
}

async function loadData() {
  const [pRes, sRes] = await Promise.all([apiFetch('/api/proposals'), apiFetch('/api/summary')]);
  if (!pRes || !sRes || !pRes.ok || !sRes.ok) return;
  const proposals = await pRes.json();
  state.deals = proposals.map(mapDeal);
  render();
}

async function doSync() {
  const btn = document.getElementById('sync-btn');
  btn.disabled = true;
  btn.textContent = '↻ Syncing…';
  try {
    const res = await apiFetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    state.lastSyncedAt = Date.now();
    localStorage.setItem('lastSyncedAt', state.lastSyncedAt);
    updateSyncPill();
    await loadData();
  } catch (err) {
    alert('Sync failed: ' + err.message);
  } finally {
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

  document.getElementById('main').innerHTML = '<div class="empty">Loading proposals…</div>';
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
    if (!res.ok) throw new Error('invalid');
    const { token } = await res.json();
    authToken = token;
    localStorage.setItem('heatmap_token', token);
    showApp();
  } catch {
    err.textContent = 'Incorrect password. Try again.';
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
