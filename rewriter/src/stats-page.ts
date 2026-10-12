// /.well-known/ip-stats — a small SPA over the in-memory metrics in ./stats.ts.
//
// The HTML shell carries no app code: a tiny loader injects app.css and app.js at
// runtime, and the app fetches data.json and re-renders on its own. Everything is
// noindex (meta + X-Robots-Tag) and no-store, so neither search engines nor the souin
// edge cache keep a copy.
//
// The JS/CSS live here as String.raw literals so the single-file bun bundle stays
// self-contained; they deliberately avoid backticks and "${".

import { snapshot } from './stats'

export const STATS_PREFIX = '/.well-known/ip-stats'

const BASE_HEADERS = {
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
}

const SHELL_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>Relay stats</title>
<style>
  :root { color-scheme: light dark; }
  html { background: #fafafa; }
  @media (prefers-color-scheme: dark) { html { background: #0b0b0c; } }
  body { margin: 0; }
  .boot { font: 13px/1.4 system-ui, sans-serif; color: #888; padding: 32px; }
</style>
</head>
<body>
<div id="app"><div class="boot">Loading…</div></div>
<script>
  (function () {
    var base = location.pathname.replace(/\/+$/, '');
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + '/app.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = base + '/app.js';
    js.async = true;
    document.body.appendChild(js);
  })();
</script>
</body>
</html>`

const APP_CSS = String.raw`
:root {
  --bg: oklch(0.985 0 0);
  --surface: oklch(1 0 0);
  --text: oklch(0.21 0 0);
  --muted: oklch(0.55 0 0);
  --faint: oklch(0.92 0 0);
  --ring: oklch(0 0 0 / 0.06);
  --shadow: 0 0 0 1px var(--ring), 0 1px 2px oklch(0 0 0 / 0.04), 0 4px 12px oklch(0 0 0 / 0.03);
  --ok: oklch(0.70 0.15 155);
  --fail: oklch(0.63 0.21 25);
  --other: oklch(0.80 0.02 260);
  --line: oklch(0.55 0.14 260);
  --line2: oklch(0.75 0.10 260);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --radius: 16px;
  --pad: 20px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: oklch(0.15 0 0);
    --surface: oklch(0.19 0 0);
    --text: oklch(0.95 0 0);
    --muted: oklch(0.65 0 0);
    --faint: oklch(0.26 0 0);
    --ring: oklch(1 0 0 / 0.08);
    --shadow: 0 0 0 1px var(--ring), 0 1px 2px oklch(0 0 0 / 0.3);
    --other: oklch(0.42 0.02 260);
  }
}
* { box-sizing: border-box; }
html, body { background: var(--bg); }
body {
  margin: 0;
  color: var(--text);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 48px; }
.num { font-variant-numeric: tabular-nums; }

header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
.right { display: flex; align-items: center; gap: 14px; }
.live { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.dot[data-state="stale"] { background: var(--fail); }

/* Segmented control: outer radius 10 = inner 7 + padding 3 (concentric). */
.seg { position: relative; display: inline-flex; padding: 3px; border-radius: 10px; background: var(--faint); }
.seg button {
  position: relative; z-index: 1; border: 0; background: none; color: var(--muted);
  font: 500 13px/1 inherit; font-family: inherit; padding: 8px 12px; border-radius: 7px; cursor: pointer;
  transition-property: color, scale; transition-duration: 150ms; transition-timing-function: ease-out;
}
.seg button[aria-pressed="true"] { color: var(--text); }
.seg button:active { scale: 0.96; }
.seg .pill {
  position: absolute; top: 3px; bottom: 3px; left: 0; border-radius: 7px;
  background: var(--surface); box-shadow: var(--shadow);
  transition-property: translate, width; transition-duration: 200ms; transition-timing-function: var(--ease-out);
}

.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
@media (max-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: var(--pad); }
.kpi .label { color: var(--muted); font-size: 12px; font-weight: 500; }
.kpi .value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; margin-top: 6px; }
.kpi .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
.kpi .value small { font-size: 14px; font-weight: 500; color: var(--muted); margin-left: 2px; }
.bad { color: var(--fail); }

.panel { margin-bottom: 12px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; gap: 12px; flex-wrap: wrap; }
.panel-head h2 { font-size: 13px; font-weight: 600; margin: 0; }
.legend { display: flex; gap: 14px; color: var(--muted); font-size: 12px; }
.legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: 0; }

.chart { position: relative; height: 160px; }
.chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.chart rect { transform-box: fill-box; transform-origin: bottom; transition-property: transform; transition-duration: 200ms; transition-timing-function: var(--ease-out); }
.axis { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; margin-top: 8px; }

.tip {
  position: absolute; top: 0; pointer-events: none; z-index: 2;
  background: var(--surface); box-shadow: var(--shadow), 0 8px 24px oklch(0 0 0 / 0.08);
  border-radius: 10px; padding: 8px 10px; font-size: 12px; white-space: nowrap;
  opacity: 0; scale: 0.97; transform-origin: bottom center;
  transition-property: opacity, scale; transition-duration: 125ms; transition-timing-function: ease-out;
}
.tip[data-open="true"] { opacity: 1; scale: 1; }
.tip[data-instant="true"] { transition-duration: 0ms; }
.tip b { font-weight: 600; }
.tip .row { display: flex; justify-content: space-between; gap: 16px; color: var(--muted); }
.tip .row span:last-child { color: var(--text); }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 0 0 10px; }
td { padding: 10px 0; border-top: 1px solid var(--faint); }
th:not(:first-child), td:not(:first-child) { text-align: right; }

.outcomes { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; gap: 8px; align-items: baseline; padding: 6px 10px; border-radius: 8px; background: var(--faint); font-size: 12px; }
.chip span { color: var(--muted); }

footer { color: var(--muted); font-size: 12px; margin-top: 20px; }
.loading { opacity: 0.6; transition-property: opacity; transition-duration: 150ms; }

/* Staged entrance on first load only: sections in order, 100ms apart. */
.enter { opacity: 0; translate: 0 8px; animation: in 300ms var(--ease-out) forwards; animation-delay: calc(var(--i, 0) * 100ms); }
@keyframes in { to { opacity: 1; translate: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .enter { translate: none; animation-duration: 150ms; animation-delay: 0ms; }
  .chart rect, .seg .pill { transition-duration: 0ms; }
}
`

const APP_JS = String.raw`
(function () {
  'use strict';
  var BASE = location.pathname.replace(/\/+$/, '');
  var RANGES = [['1h', 60], ['6h', 360], ['24h', 1440]];
  var POLL_MS = 10000;
  var state = { range: rangeFromHash(), data: null, lastOk: 0, timer: null, first: true, hover: -1 };
  var app = document.getElementById('app');

  function rangeFromHash() {
    var h = location.hash.replace('#', '');
    for (var i = 0; i < RANGES.length; i++) if (RANGES[i][0] === h) return RANGES[i][1];
    return 60;
  }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var nf = new Intl.NumberFormat('en-US');
  function fmtN(n) { return nf.format(n || 0); }
  function fmtMs(ms) { return ms == null ? '—' : ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + ' s' : ms + ' ms'; }
  function fmtRate(r) { return r < 10 ? r.toFixed(1) : nf.format(Math.round(r)); }
  function fmtPct(x) { return (x * 100).toFixed(x > 0 && x < 0.001 ? 3 : 2) + '%'; }
  function fmtTime(t) { var d = new Date(t); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function ago(ms) { var s = Math.round(ms / 1000); return s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; }

  function load() {
    app.classList.add('loading');
    return fetch(BASE + '/data.json?range=' + state.range, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { state.data = d; state.lastOk = Date.now(); render(); })
      .catch(function () { renderLive(); })
      .then(function () { app.classList.remove('loading'); });
  }
  function schedule() {
    clearTimeout(state.timer);
    if (document.hidden) return;
    state.timer = setTimeout(function () { load().then(schedule); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load().then(schedule); else clearTimeout(state.timer); });
  window.addEventListener('hashchange', function () { state.range = rangeFromHash(); render(); load().then(schedule); });
  setInterval(renderLive, 1000);

  function kpi(label, value, unit, meta, cls) {
    return el('div', { class: 'card kpi' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value num' + (cls ? ' ' + cls : '') }, [value, unit ? el('small', { text: unit }) : null]),
      meta ? el('div', { class: 'meta num', text: meta }) : null,
    ]);
  }

  function segmented() {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
    var pill = el('div', { class: 'pill' });
    seg.appendChild(pill);
    RANGES.forEach(function (r) {
      seg.appendChild(el('button', {
        type: 'button', 'aria-pressed': String(r[1] === state.range), text: r[0],
        onclick: function () { location.hash = r[0]; },
      }));
    });
    requestAnimationFrame(function () {
      var active = seg.querySelector('[aria-pressed="true"]');
      if (!active) return;
      pill.style.width = active.offsetWidth + 'px';
      pill.style.translate = active.offsetLeft + 'px 0';
    });
    return seg;
  }

  function barsChart(series) {
    var wrap = el('div', { class: 'chart' });
    var max = 1;
    series.forEach(function (p) { max = Math.max(max, p.ok + p.failed + p.other); });
    var n = series.length;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + n + ' 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Requests over time by outcome');
    function rect(x, y, h, color) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x + 0.12); r.setAttribute('width', 0.76);
      r.setAttribute('y', y); r.setAttribute('height', Math.max(h, 0));
      r.setAttribute('fill', color); r.setAttribute('rx', 0.15);
      svg.appendChild(r);
    }
    series.forEach(function (p, i) {
      var y = 100;
      [[p.ok, 'var(--ok)'], [p.other, 'var(--other)'], [p.failed, 'var(--fail)']].forEach(function (s) {
        var h = (s[0] / max) * 100;
        y -= h;
        if (h > 0) rect(i, y, h, s[1]);
      });
    });
    wrap.appendChild(svg);
    var tip = el('div', { class: 'tip', 'aria-hidden': 'true' });
    wrap.appendChild(tip);
    var everOpen = false;
    wrap.addEventListener('pointermove', function (e) {
      var box = wrap.getBoundingClientRect();
      var i = Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n)));
      var p = series[i];
      tip.innerHTML = '';
      tip.appendChild(el('b', { class: 'num', text: fmtTime(p.t) }));
      [['OK', fmtN(p.ok)], ['Failed', fmtN(p.failed)], ['4xx / rejected', fmtN(p.other)], ['p50 / p90', fmtMs(p.p50) + ' / ' + fmtMs(p.p90)]]
        .forEach(function (r) { tip.appendChild(el('div', { class: 'row num' }, [el('span', { text: r[0] }), el('span', { text: r[1] })])); });
      var x = ((i + 0.5) / n) * box.width;
      var w = tip.offsetWidth;
      tip.style.left = Math.min(box.width - w, Math.max(0, x - w / 2)) + 'px';
      tip.style.translate = '0 calc(-100% - 8px)';
      tip.dataset.instant = String(everOpen);
      tip.dataset.open = 'true';
      everOpen = true;
    });
    wrap.addEventListener('pointerleave', function () { tip.dataset.open = 'false'; everOpen = false; });
    return wrap;
  }

  function latencyChart(series) {
    var wrap = el('div', { class: 'chart', style: 'height:120px' });
    var max = 1;
    series.forEach(function (p) { if (p.p90) max = Math.max(max, p.p90); });
    var n = series.length;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + n + ' 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Latency p50 and p90 over time');
    [['p90', 'var(--line2)'], ['p50', 'var(--line)']].forEach(function (s) {
      var pts = [];
      series.forEach(function (p, i) { if (p[s[0]] != null) pts.push((i + 0.5) + ',' + (100 - (p[s[0]] / max) * 96)); });
      if (!pts.length) return;
      if (pts.length === 1) pts.push(pts[0]);
      var pl = document.createElementNS(NS, 'polyline');
      pl.setAttribute('points', pts.join(' '));
      pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', s[1]); pl.setAttribute('stroke-width', '2');
      pl.setAttribute('vector-effect', 'non-scaling-stroke'); pl.setAttribute('stroke-linejoin', 'round'); pl.setAttribute('stroke-linecap', 'round');
      svg.appendChild(pl);
    });
    wrap.appendChild(svg);
    return wrap;
  }

  function axis(series) {
    if (!series.length) return null;
    var mid = series[Math.floor(series.length / 2)];
    return el('div', { class: 'axis num' }, [el('span', { text: fmtTime(series[0].t) }), el('span', { text: fmtTime(mid.t) }), el('span', { text: 'now' })]);
  }

  var liveEl = null;
  function renderLive() {
    if (!liveEl) return;
    var stale = !state.lastOk || Date.now() - state.lastOk > POLL_MS * 3;
    liveEl.innerHTML = '';
    liveEl.appendChild(el('span', { class: 'dot', 'data-state': stale ? 'stale' : 'ok' }));
    liveEl.appendChild(el('span', { class: 'num', text: stale ? 'Not updating' : 'Updated ' + ago(Date.now() - state.lastOk) }));
  }

  function section(node, i) {
    if (state.first) { node.classList.add('enter'); node.style.setProperty('--i', i); }
    return node;
  }

  function render() {
    var d = state.data;
    var root = el('div', { class: 'wrap' });
    liveEl = el('div', { class: 'live', role: 'status' });
    root.appendChild(section(el('header', null, [
      el('div', null, [el('h1', { text: 'Relay stats' }), el('div', { class: 'sub', text: location.host })]),
      el('div', { class: 'right' }, [liveEl, segmented()]),
    ]), 0));

    if (!d) { app.replaceChildren(root); renderLive(); return; }

    var o = d.outcomes;
    var fails = o.failed + o.serverError;
    var L = d.latency;
    root.appendChild(section(el('div', { class: 'grid' }, [
      kpi('Requests', fmtN(d.requests), '', fmtRate(d.requests / Math.max(1, d.rangeMinutes)) + ' / min'),
      kpi('Failure rate', fmtPct(d.failureRate), '', fmtN(fails) + ' failed · ' + fmtN(d.retried) + ' retried', d.failureRate > 0.01 ? 'bad' : ''),
      kpi('Response p50', fmtMs(L.total.p50), '', 'p90 ' + fmtMs(L.total.p90) + ' · p99 ' + fmtMs(L.total.p99)),
      kpi('Upstream p50', fmtMs(L.upstream.p50), '', 'p90 ' + fmtMs(L.upstream.p90) + ' · p99 ' + fmtMs(L.upstream.p99)),
    ]), 1));

    root.appendChild(section(el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [
        el('h2', { text: 'Requests' }),
        el('div', { class: 'legend' }, [
          el('span', null, [el('i', { style: 'background:var(--ok)' }), 'OK']),
          el('span', null, [el('i', { style: 'background:var(--other)' }), '4xx / rejected']),
          el('span', null, [el('i', { style: 'background:var(--fail)' }), 'Failed']),
        ]),
      ]),
      barsChart(d.series),
      axis(d.series),
    ]), 2));

    root.appendChild(section(el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [
        el('h2', { text: 'Response time' }),
        el('div', { class: 'legend' }, [
          el('span', null, [el('i', { style: 'background:var(--line)' }), 'p50']),
          el('span', null, [el('i', { style: 'background:var(--line2)' }), 'p90']),
        ]),
      ]),
      latencyChart(d.series),
      axis(d.series),
    ]), 3));

    var chips = [['2xx', o.ok], ['3xx', o.redirect], ['4xx', o.clientError], ['404', o.notFound], ['5xx', o.serverError], ['All attempts failed', o.failed], ['Rejected', o.rejected]];
    root.appendChild(section(el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: 'Outcomes' })]),
      el('div', { class: 'outcomes' }, chips.map(function (c) { return el('div', { class: 'chip num' }, [el('span', { text: c[0] }), fmtN(c[1])]); })),
    ]), 4));

    var rows = d.hosts.map(function (h) {
      return el('tr', null, [
        el('td', { text: h.host }),
        el('td', { class: 'num', text: fmtN(h.count) }),
        el('td', { class: 'num' + (h.failed ? ' bad' : ''), text: fmtN(h.failed) }),
        el('td', { class: 'num', text: fmtMs(h.avgMs) }),
      ]);
    });
    root.appendChild(section(el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: 'By upstream' })]),
      rows.length
        ? el('table', null, [el('thead', null, [el('tr', null, ['Upstream', 'Requests', 'Failed', 'Avg'].map(function (t) { return el('th', { text: t }); }))]), el('tbody', null, rows)])
        : el('div', { class: 'sub', text: 'No requests in this range yet.' }),
    ]), 5));

    root.appendChild(el('footer', { class: 'num', text: 'Collecting since ' + new Date(d.startedAt).toLocaleString() + ' · in-memory, resets when the relay restarts' }));

    app.replaceChildren(root);
    renderLive();
    state.first = false;
  }

  render();
  load().then(schedule);
})();
`

export function serveStats(pathname: string, url: URL): Response {
  const sub = pathname.slice(STATS_PREFIX.length).replace(/\/+$/, '')
  if (sub === '/data.json') {
    const range = Number(url.searchParams.get('range')) || 60
    return Response.json(snapshot(range), { headers: BASE_HEADERS })
  }
  if (sub === '/app.js')
    return new Response(APP_JS, { headers: { ...BASE_HEADERS, 'content-type': 'application/javascript; charset=utf-8' } })
  if (sub === '/app.css')
    return new Response(APP_CSS, { headers: { ...BASE_HEADERS, 'content-type': 'text/css; charset=utf-8' } })
  if (sub === '')
    return new Response(SHELL_HTML, { headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8' } })
  return new Response('Not found', { status: 404, headers: BASE_HEADERS })
}
