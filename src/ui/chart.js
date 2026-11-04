// Small dependency-free SVG line chart with reference lines, shaded bands,
// a shared crosshair cursor and a hover tooltip.
//
// update(data): data = { n, series, refs, bands, hbands, format, quarterLabel,
//   xLabel?, tickFrom?, yDomain?, maxHeight? }
//   series[k] = { label, color, values, dash?, width?, opacity?, points?, noTip? }
//     points: draw markers instead of a line (e.g. noisy observations)
//   bands  = [[from, to, className?], ...] shaded quarter ranges
//   hbands = [{ from, to, label? }, ...] shaded value ranges (e.g. a tolerance band)
//   xLabel(t) labels the x ticks (default: t), placed every 4 quarters from tickFrom

const SVG = 'http://www.w3.org/2000/svg';
const M = { top: 10, right: 12, bottom: 26, left: 40 };

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceStep(range, target) {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
}

export function createChart(container, { title, unit, onHover }) {
  container.classList.add('chart');
  container.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'chart-head';
  const h = document.createElement('h3');
  h.textContent = title;
  const u = document.createElement('span');
  u.className = 'chart-unit';
  u.textContent = unit || '';
  head.append(h, u);
  const body = document.createElement('div');
  body.className = 'chart-body';
  const svg = el('svg', { role: 'img' });
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  body.append(svg, tip);
  container.append(head, body);

  let data = null;
  let cursor = null;
  let showTip = false;
  let geom = null;
  let curLayer = null;

  function render() {
    if (!data) return;
    const width = Math.max(240, body.clientWidth);
    const height = Math.max(160, Math.round(Math.min(data.maxHeight || 260, width * 0.55)));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.innerHTML = '';
    svg.setAttribute('aria-label', title);

    const n = data.n;
    let lo = Infinity, hi = -Infinity;
    for (const s of data.series) for (let t = 0; t < Math.min(n, s.values.length); t++) {
      const v = s.values[t];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    for (const r of data.refs || []) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
    for (const b of data.hbands || []) { lo = Math.min(lo, b.from); hi = Math.max(hi, b.to); }
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    if (data.yDomain) [lo, hi] = data.yDomain;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;

    const pw = width - M.left - M.right;
    const ph = height - M.top - M.bottom;
    const X = (t) => M.left + (n <= 1 ? 0 : (t / (n - 1)) * pw);
    const Y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * ph;
    geom = { X, Y, n, pw, width, height };

    // Grid + y ticks
    const grid = el('g', { class: 'grid' }, svg);
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Y(v);
      el('line', { x1: M.left, x2: width - M.right, y1: y, y2: y, class: Math.abs(v) < step / 1e6 ? 'zero' : '' }, grid);
      const label = el('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', class: 'tick' }, grid);
      label.textContent = data.format(Math.abs(v) < step / 1e6 ? 0 : v, step < 1 ? (step < 0.1 ? 2 : 1) : 0);
    }
    // x ticks every 4 quarters
    const tickFrom = ((data.tickFrom || 0) % 4 + 4) % 4;
    for (let t = tickFrom; t < n; t += 4) {
      const label = el('text', { x: X(t), y: height - 8, 'text-anchor': 'middle', class: 'tick' }, grid);
      label.textContent = data.xLabel ? data.xLabel(t) : String(t);
    }

    // Shaded value ranges (e.g. the tolerance band around the target)
    for (const b of data.hbands || []) {
      const y0 = Y(Math.min(hi, b.to));
      const y1 = Y(Math.max(lo, b.from));
      el('rect', { x: M.left, y: y0, width: pw, height: Math.max(1, y1 - y0), class: 'hband' }, svg);
    }

    // Shaded bands (e.g. quarters at the lower bound)
    for (const [a, b, cls] of data.bands || []) {
      const x0 = X(Math.max(0, a - 0.5));
      const x1 = X(Math.min(n - 1, b + 0.5));
      el('rect', { x: x0, y: M.top, width: Math.max(1, x1 - x0), height: ph, class: cls || 'band' }, svg);
    }

    // Reference lines
    for (const r of data.refs || []) {
      const y = Y(r.y);
      el('line', { x1: M.left, x2: width - M.right, y1: y, y2: y, class: 'ref' }, svg);
      const label = el('text', { x: width - M.right - 2, y: y - 4, 'text-anchor': 'end', class: 'ref-label' }, svg);
      label.textContent = r.label;
    }

    // Series
    for (const s of data.series) {
      if (s.points) {
        const g = el('g', { style: `fill:${s.color}`, opacity: s.opacity ?? 1 }, svg);
        for (let t = 0; t < Math.min(n, s.values.length); t++) {
          if (Number.isFinite(s.values[t])) el('circle', { cx: X(t), cy: Y(s.values[t]), r: 2.6 }, g);
        }
        continue;
      }
      const pts = [];
      for (let t = 0; t < Math.min(n, s.values.length); t++) {
        if (Number.isFinite(s.values[t])) pts.push(`${X(t).toFixed(1)},${Y(s.values[t]).toFixed(1)}`);
      }
      el('polyline', {
        points: pts.join(' '),
        fill: 'none',
        style: `stroke:${s.color}`,
        'stroke-width': s.width || 2,
        'stroke-dasharray': s.dash || 'none',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        opacity: s.opacity ?? 1,
      }, svg);
    }

    curLayer = el('g', { class: 'cursor' }, svg);
    renderCursor();

    // Hit area
    const hit = el('rect', { x: M.left, y: 0, width: pw, height: height, class: 'hit' }, svg);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * width;
      const t = Math.round(((px - M.left) / pw) * (n - 1));
      showTip = true;
      const q = Math.max(0, Math.min(n - 1, t));
      if (q === cursor) renderTip();
      onHover?.(q);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { showTip = false; renderTip(); onHover?.(null); });
  }

  function renderCursor() {
    if (!curLayer || !geom) return;
    curLayer.innerHTML = '';
    if (cursor !== null && cursor < geom.n) {
      const x = geom.X(cursor);
      el('line', { x1: x, x2: x, y1: M.top, y2: geom.height - M.bottom, class: 'crosshair' }, curLayer);
      for (const s of data.series) {
        const v = s.values[cursor];
        if (!Number.isFinite(v)) continue;
        el('circle', { cx: x, cy: geom.Y(v), r: 4, style: `fill:${s.color}`, class: 'dot' }, curLayer);
      }
    }
    renderTip();
  }

  function renderTip() {
    if (!data || cursor === null || !showTip || !geom) { tip.hidden = true; return; }
    const rows = data.series
      .filter((s) => Number.isFinite(s.values[cursor]) && !s.noTip)
      .map((s) => `<div class="tip-row"><span class="sw" style="background:${s.color}"></span><span class="tip-label">${s.label}</span><span class="tip-val">${data.format(s.values[cursor], 2)}</span></div>`)
      .join('');
    tip.innerHTML = `<div class="tip-title">${data.quarterLabel(cursor)}</div>${rows}`;
    tip.hidden = false;
    const x = geom.X(cursor);
    const tw = tip.offsetWidth;
    const left = x + 12 + tw > geom.width ? x - 12 - tw : x + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${M.top}px`;
  }

  const ro = new ResizeObserver(() => render());
  ro.observe(body);

  return {
    update(next) { data = next; render(); },
    setCursor(t) {
      if (t === cursor) return;
      cursor = t;
      if (t === null) showTip = false;
      renderCursor();
    },
    setTitle(text, unitText) { h.textContent = text; u.textContent = unitText || ''; },
    hideTip() { showTip = false; renderTip(); },
    destroy() { ro.disconnect(); },
  };
}
