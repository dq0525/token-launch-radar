// Token Launch Radar dashboard (radar-3).
//
// A static page over data.js: no fetch, no framework, no network. It renders the ranked
// board exactly as board.json carries it, and adds the reading layer the model ships in
// data.js — a launch-readiness score and tier per row, one plain risk flag per row, and the
// per-category calibration the implied value's base multiple was drawn from.
//
// Views are addressable for the entry's screenshots and for sharing:
//   ?category=Lending   start filtered to one category
//   ?tier=ready         start filtered to one readiness tier
//   ?detail=<slug>      start with that protocol's detail open
//   ?tab=live           start on the live-token market view
//   ?q=<text>           start with a search term in the box
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var root = document.getElementById('board');
  var params = new URLSearchParams(location.search);

  var state = {
    tab: params.get('tab') === 'live' ? 'live' : 'board',
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    tier: params.get('tier') || 'all',
    sort: params.get('sort') || 'implied',
    selected: params.get('detail') || null,
  };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var maxImplied = 0;
  DATA.rows.forEach(function (r) { if (r.implied_value_usd > maxImplied) maxImplied = r.implied_value_usd; });

  /** The shared formula, recomputed for one row so the detail view can show its working. */
  function recompute(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return {
      growth: growth, growthMult: growthMult, maturity: maturity,
      implied: Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity)),
    };
  }

  // --- static sections ---------------------------------------------------------

  function renderHero() {
    var hero = el('header', { class: 'hero' });
    hero.appendChild(el('h1', null, 'Token Launch Radar'));
    hero.appendChild(el('p', { class: 'lede' },
      'Protocols that have users, TVL and no token yet — ranked by what a token would be worth ' +
      'if this market priced it the way it prices the tokens it already has, and scored for how ' +
      'ready a launch looks. Every figure comes from one frozen snapshot; nothing here phones home.'));
    var meta = el('div', { class: 'meta' });
    var bits = [
      ['Snapshot', DATA.as_of],
      ['Source', DATA.source],
      ['Model', DATA.model_version],
      ['Watchlist floor', fmtUsd(DATA.floor_usd)],
    ];
    bits.forEach(function (b) {
      var span = el('span');
      span.appendChild(el('b', null, b[0] + ': '));
      span.appendChild(document.createTextNode(b[1]));
      meta.appendChild(span);
    });
    hero.appendChild(meta);

    var tiers = { ready: 0, building: 0, early: 0 };
    DATA.rows.forEach(function (r) { tiers[r.tier] += 1; });
    var stats = el('div', { class: 'stat-row' });
    [
      ['Board rows', String(DATA.board_size), DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early finds'],
      ['Top implied value', fmtUsd(DATA.rows[0].implied_value_usd), DATA.rows[0].name + ', rank 1'],
      ['Ready tier', String(tiers.ready), 'readiness 60 or more'],
      ['Building tier', String(tiers.building), 'readiness 35 to 59'],
      ['Live tokens aside', String(DATA.live_size), 'already trade; shown as market fact'],
    ].forEach(function (s) {
      var card = el('div', { class: 'stat' });
      card.appendChild(el('div', { class: 'k' }, s[0]));
      card.appendChild(el('div', { class: 'v' }, s[1]));
      card.appendChild(el('div', { class: 's' }, s[2]));
      stats.appendChild(card);
    });
    hero.appendChild(stats);
    return hero;
  }

  function renderModel() {
    var m = DATA.model;
    var panel = el('section', { class: 'panel' });
    panel.appendChild(el('h2', null, 'How the ranking is priced'));
    panel.appendChild(el('p', null,
      'One formula for every row, no name special-cased. The base multiple is calibrated, not chosen: ' +
      'the live-token protocols inside this same snapshot carry a median market-cap / TVL ratio of 0.1691, ' +
      'and the model rounds it to ' + m.base_multiple + '. Growth is the clamped 7-day TVL change; maturity ' +
      'grows with the protocol\u2019s age in days. Readiness is a separate 0\u2013100 reading (age 40, scale ' +
      'against the floor 30, momentum 20, chain reach 10) shown beside the price, never folded into it.'));
    panel.appendChild(el('code', { class: 'formula' },
      'implied = round( tvl_usd x ' + m.base_multiple +
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')' +
      ' x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'));
    var top = DATA.categories.slice(0, 8);
    if (top.length > 0) {
      panel.appendChild(el('p', null, 'What the market pays per $1 of TVL, by category, inside this snapshot:'));
      var table = el('table', { class: 'mini' });
      var head = el('tr');
      ['Category', 'Live tokens', 'Pre-token', 'Median mcap / TVL'].forEach(function (h, i) {
        head.appendChild(el('th', i > 0 ? { class: 'num' } : null, h));
      });
      table.appendChild(head);
      top.forEach(function (c) {
        var tr = el('tr');
        tr.appendChild(el('td', null, c.category));
        tr.appendChild(el('td', { class: 'num' }, String(c.live_count)));
        tr.appendChild(el('td', { class: 'num' }, String(c.pre_token_count)));
        tr.appendChild(el('td', { class: 'num' }, c.median_multiple === null ? 'n/a' : c.median_multiple.toFixed(2) + 'x'));
        table.appendChild(tr);
      });
      panel.appendChild(table);
    }
    return panel;
  }

  // --- controls and board --------------------------------------------------------

  var controlsHost = el('div');
  var boardHost = el('div');
  var detailHost = el('div');

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      readiness: function (r) { return r.readiness; },
      tvl: function (r) { return r.tvl_usd; },
      growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    }[state.sort] || function (r) { return r.implied_value_usd; };
    rows.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return rows;
  }

  function renderControls() {
    clear(controlsHost);
    var bar = el('div', { class: 'controls' });
    var tabs = el('div', { class: 'tabs' });
    [['board', 'Pre-token board'], ['live', 'Live tokens']].forEach(function (t) {
      var b = el('button', { 'aria-pressed': state.tab === t[0] ? 'true' : 'false' }, t[1]);
      b.addEventListener('click', function () { state.tab = t[0]; render(); });
      tabs.appendChild(b);
    });
    bar.appendChild(tabs);
    if (state.tab === 'board') {
      var search = el('input', { type: 'search', placeholder: 'Search name, slug, category', value: state.q, 'aria-label': 'Search the board' });
      search.addEventListener('input', function () { state.q = search.value; renderBoard(); });
      bar.appendChild(search);
      var cat = el('select', { 'aria-label': 'Filter by category' });
      cat.appendChild(el('option', { value: 'all' }, 'All categories'));
      categories().forEach(function (c) {
        var o = el('option', { value: c }, c);
        if (state.category === c) o.setAttribute('selected', 'selected');
        cat.appendChild(o);
      });
      cat.addEventListener('change', function () { state.category = cat.value; renderBoard(); });
      bar.appendChild(cat);
      var tier = el('select', { 'aria-label': 'Filter by readiness tier' });
      [['all', 'All tiers'], ['ready', 'Ready (60+)'], ['building', 'Building (35-59)'], ['early', 'Early (under 35)']].forEach(function (t) {
        var o = el('option', { value: t[0] }, t[1]);
        if (state.tier === t[0]) o.setAttribute('selected', 'selected');
        tier.appendChild(o);
      });
      tier.addEventListener('change', function () { state.tier = tier.value; renderBoard(); });
      bar.appendChild(tier);
      var sort = el('select', { 'aria-label': 'Sort the board' });
      [['implied', 'Sort: implied value'], ['readiness', 'Sort: readiness'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7d growth']].forEach(function (s) {
        var o = el('option', { value: s[0] }, s[1]);
        if (state.sort === s[0]) o.setAttribute('selected', 'selected');
        sort.appendChild(o);
      });
      sort.addEventListener('change', function () { state.sort = sort.value; renderBoard(); });
      bar.appendChild(sort);
      bar.appendChild(el('span', { class: 'count', id: 'row-count' }, ''));
    }
    controlsHost.appendChild(bar);
  }

  function tierChip(row) {
    return el('span', { class: 'chip tier-' + row.tier }, row.tier + ' ' + row.readiness);
  }

  function renderBoard() {
    clear(boardHost);
    if (state.tab === 'live') { renderLive(); return; }
    var rows = visibleRows();
    var count = document.getElementById('row-count');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' rows';
    var wrap = el('div', { class: 'board-wrap' });
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var hr = el('tr');
    [['Rank'], ['Protocol'], ['Category'], ['TVL', 'num'], ['7d', 'num'], ['Implied value', 'num'], ['Readiness'], ['Risk flag', 'risk-cell']].forEach(function (h) {
      hr.appendChild(el('th', h[1] ? { class: h[1] } : null, h[0]));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', state.selected === r.slug ? { class: 'selected' } : null);
      tr.appendChild(el('td', { class: 'rank' }, String(r.rank)));
      var nameCell = el('td');
      var nameLine = el('div');
      nameLine.appendChild(el('span', { class: 'name' }, r.name));
      if (r.tvl_usd < DATA.floor_usd) {
        nameLine.appendChild(document.createTextNode(' '));
        nameLine.appendChild(el('span', { class: 'chip early-find' }, 'early find'));
      }
      nameCell.appendChild(nameLine);
      nameCell.appendChild(el('div', { class: 'slug' }, r.slug + ' \u00b7 ' + (r.chains.join(', ') || 'no chain named')));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', null, r.category || 'n/a'));
      tr.appendChild(el('td', { class: 'num' }, fmtUsd(r.tvl_usd)));
      var g = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d));
      tr.appendChild(g);
      var imp = el('td', { class: 'num' });
      imp.appendChild(el('div', null, fmtUsd(r.implied_value_usd)));
      var barOuter = el('div', { class: 'bar' });
      var fill = el('i');
      fill.style.width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
      barOuter.appendChild(fill);
      imp.appendChild(barOuter);
      tr.appendChild(imp);
      var ready = el('td');
      ready.appendChild(tierChip(r));
      tr.appendChild(ready);
      var flagged = /fell|only \d+ days|no listing date|Small TVL/.test(r.risk_note);
      tr.appendChild(el('td', { class: 'risk-cell' }, ''));
      tr.lastChild.appendChild(el('span', { class: 'risk' + (flagged ? ' flagged' : '') }, r.risk_note));
      tr.addEventListener('click', function () {
        state.selected = state.selected === r.slug ? null : r.slug;
        renderBoard();
        renderDetail();
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    boardHost.appendChild(wrap);
  }

  function renderLive() {
    var wrap = el('div', { class: 'board-wrap' });
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var hr = el('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap', '7d'].forEach(function (h, i) {
      hr.appendChild(el('th', i >= 2 ? { class: 'num' } : null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      var nameCell = el('td');
      nameCell.appendChild(el('span', { class: 'name' }, r.name));
      nameCell.appendChild(el('div', { class: 'slug' }, r.slug));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', null, r.category || 'n/a'));
      tr.appendChild(el('td', { class: 'num' }, fmtUsd(r.tvl_usd)));
      tr.appendChild(el('td', { class: 'num' }, fmtUsd(r.mcap_usd)));
      tr.appendChild(el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') }, fmtPct(r.change_7d)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    boardHost.appendChild(wrap);
    var note = el('p', { class: 'sub' }, 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; their median is what calibrates it.');
    note.style.marginTop = '10px';
    boardHost.appendChild(note);
  }

  // --- detail ----------------------------------------------------------------------

  function renderDetail() {
    clear(detailHost);
    if (!state.selected) return;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return;
    var calc = recompute(row);
    var panel = el('section', { class: 'detail', id: 'detail' });
    var close = el('button', { class: 'close' }, 'Close');
    close.addEventListener('click', function () { state.selected = null; renderBoard(); renderDetail(); });
    panel.appendChild(close);
    panel.appendChild(el('h2', null, row.name));
    panel.appendChild(el('p', { class: 'sub' },
      'Rank ' + row.rank + ' of ' + DATA.board_size + ' \u00b7 ' + (row.category || 'uncategorised') +
      ' \u00b7 ' + (row.chains.join(', ') || 'no chain named') +
      (row.tvl_usd < DATA.floor_usd ? ' \u00b7 early find below the watchlist floor' : ' \u00b7 on the watchlist')));
    var grid = el('div', { class: 'detail-grid' });
    [
      ['Implied value', fmtUsd(row.implied_value_usd), 'recomputed below from the stated model'],
      ['TVL', fmtUsd(row.tvl_usd), row.listed_at ? 'listed ' + row.listed_at : 'no listing date in the snapshot'],
      ['7d TVL change', fmtPct(row.change_7d), 'clamped to ' + calc.growth + '% in the model'],
      ['Readiness', row.tier + ' \u00b7 ' + row.readiness + ' / 100', 'age, scale, momentum, chain reach'],
      ['Category median', row.category_median_multiple === null ? 'n/a' : row.category_median_multiple.toFixed(2) + 'x', 'what live ' + (row.category || '') + ' protocols trade at'],
      ['Age', row.age_days === null ? 'unknown' : row.age_days + ' days', 'maturity multiplier ' + calc.maturity.toFixed(3)],
    ].forEach(function (cell) {
      var d = el('div');
      d.appendChild(el('div', { class: 'k' }, cell[0]));
      d.appendChild(el('div', { class: 'v' }, cell[1]));
      d.appendChild(el('div', { class: 's' }, cell[2]));
      grid.appendChild(d);
    });
    panel.appendChild(grid);
    panel.appendChild(el('p', null,
      'The model\u2019s working: ' + fmtUsd(row.tvl_usd) + ' TVL x ' + DATA.model.base_multiple + ' base x ' +
      calc.growthMult.toFixed(3) + ' growth x ' + calc.maturity.toFixed(3) + ' maturity = ' + fmtUsd(calc.implied) +
      ', which is the board\u2019s figure for this row.'));
    var risk = el('p');
    risk.appendChild(el('b', null, 'Risk flag: '));
    risk.appendChild(document.createTextNode(row.risk_note));
    panel.appendChild(risk);
    panel.appendChild(el('h3', null, 'Farm plan'));
    var plan = el('ol', { class: 'plan' });
    row.farm_steps.forEach(function (s) { plan.appendChild(el('li', null, s)); });
    panel.appendChild(plan);
    detailHost.appendChild(panel);
  }

  function render() {
    renderControls();
    renderBoard();
    renderDetail();
  }

  clear(root);
  root.removeAttribute('aria-busy');
  root.appendChild(renderHero());
  root.appendChild(renderModel());
  root.appendChild(controlsHost);
  root.appendChild(boardHost);
  root.appendChild(detailHost);
  var foot = el('footer', { class: 'foot' },
    'Built from the sealed snapshot only: no live prices, no network calls, no protocol named by hand. ' +
    'An implied value is a model\u2019s reading of TVL, growth and age, not a promise that a token will ' +
    'exist or trade at that figure; the farm plans are starting points to check against each protocol\u2019s own documentation.');
  root.appendChild(foot);
  render();
})();
