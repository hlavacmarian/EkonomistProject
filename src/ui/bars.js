// Stacked bar chart over time: each bar splits a variable into the contributions of
// the terms of its equation (positive terms stack up from zero, negative terms
// down); a line with dots marks the total. Shares the cursor with the line charts.
//
// update(data): data = { n, series: [{ key, label, color, values }], total: { label, values },
//   format, quarterLabel, xLabel?, tickFrom?, maxHeight? }

const SVG = 'http://www.w3.org/2000/svg';
const M = { top: 8, right: 10, bottom: 24, left: 40 };

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

export function createBars(container, { title, unit, onHover }) {
  container.classList.add('chart', 'bars');
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
    const height = Math.max(140, Math.round(Math.min(data.maxHeight || 210, width * 0.5)));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.innerHTML = '';
    svg.setAttribute('aria-label', title);
    const n = data.n;

    let lo = 0, hi = 0;
    for (let t = 0; t < n; t++) {
      let pos = 0, neg = 0;
      for (const s of data.series) {
        const v = s.values[t] || 0;
        if (v >= 0) pos += v; else neg += v;
      }
      lo = Math.min(lo, neg, data.total.values[t]);
      hi = Math.max(hi, pos, data.total.values[t]);
    }
    if (hi - lo < 0.2) { hi = Math.max(hi, 0.1); lo = Math.min(lo, -0.1); }
    const pad = (hi - lo) * 0.06;
    lo -= pad; hi += pad;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;

    const pw = width - M.left - M.right;
    const ph = height - M.top - M.bottom;
    const slot = pw / n;
    const X = (t) => M.left + (t + 0.5) * slot;
    const Y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * ph;
    geom = { X, Y, n, slot, width, height, ph };

    const grid = el('g', { class: 'grid' }, svg);
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Y(v);
      el('line', { x1: M.left, x2: width - M.right, y1: y, y2: y, class: Math.abs(v) < step / 1e6 ? 'zero' : '' }, grid);
      const label = el('text', { x: M.left - 6, y: y + 3.5, 'text-anchor': 'end', class: 'tick' }, grid);
      label.textContent = data.format(Math.abs(v) < step / 1e6 ? 0 : v, step < 1 ? (step < 0.1 ? 2 : 1) : 0);
    }
    const tickFrom = ((data.tickFrom || 0) % 4 + 4) % 4;
    for (let t = tickFrom; t < n; t += 4) {
      const label = el('text', { x: X(t), y: height - 8, 'text-anchor': 'middle', class: 'tick' }, grid);
      label.textContent = data.xLabel ? data.xLabel(t) : String(t);
    }

    curLayer = el('g', { class: 'cursor' }, svg);

    const bw = Math.max(1.5, Math.min(22, slot * 0.72));
    const bars = el('g', { class: 'stack' }, svg);
    for (let t = 0; t < n; t++) {
      let pos = 0, neg = 0;
      for (const s of data.series) {
        const v = s.values[t] || 0;
        if (Math.abs(v) < 1e-12) continue;
        const from = v >= 0 ? pos : neg;
        const to = from + v;
        if (v >= 0) pos = to; else neg = to;
        const y0 = Y(Math.max(from, to));
        const y1 = Y(Math.min(from, to));
        el('rect', { x: X(t) - bw / 2, y: y0, width: bw, height: Math.max(0.5, y1 - y0), style: `fill:${s.color}` }, bars);
      }
    }
    const pts = [];
    for (let t = 0; t < n; t++) pts.push(`${X(t).toFixed(1)},${Y(data.total.values[t]).toFixed(1)}`);
    el('polyline', { points: pts.join(' '), class: 'total-line' }, svg);
    for (let t = 0; t < n; t++) el('circle', { cx: X(t), cy: Y(data.total.values[t]), r: Math.min(3, bw / 3 + 1), class: 'total-dot' }, svg);

    renderCursor();

    const hit = el('rect', { x: M.left, y: 0, width: pw, height, class: 'hit' }, svg);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * width;
      const q = Math.max(0, Math.min(n - 1, Math.floor((px - M.left) / slot)));
      showTip = true;
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
      el('rect', { x: geom.X(cursor) - geom.slot / 2, y: M.top, width: geom.slot, height: geom.ph, class: 'cur-band' }, curLayer);
    }
    renderTip();
  }

  function renderTip() {
    if (!data || cursor === null || !showTip || !geom) { tip.hidden = true; return; }
    const rows = data.series
      .filter((s) => Math.abs(s.values[cursor] || 0) > 5e-4)
      .map((s) => `<div class="tip-row"><span class="sw sq" style="background:${s.color}"></span><span class="tip-label">${s.label}</span><span class="tip-val">${data.format(s.values[cursor], 2)}</span></div>`)
      .join('');
    tip.innerHTML = `<div class="tip-title">${data.quarterLabel(cursor)}</div>${rows}
      <div class="tip-row tip-total"><span></span><span class="tip-label">${data.total.label}</span><span class="tip-val">${data.format(data.total.values[cursor], 2)}</span></div>`;
    tip.hidden = false;
    const x = geom.X(cursor);
    const tw = tip.offsetWidth;
    const left = x + 14 + tw > geom.width ? x - 14 - tw : x + 14;
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
      renderCursor();
    },
    setTitle(text, unitText) { h.textContent = text; u.textContent = unitText || ''; },
    destroy() { ro.disconnect(); },
  };
}
