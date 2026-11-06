// Live causal diagram of the three-equation model.
//
//                 Expectations
//              /      |        (dotted: where expectations come from)
//        Demand  ->  Inflation  ->  Bank
//           ^ \_____________________/ |      inner arc: phi_x x (demand -> bank)
//            \________________________/      outer arc: -sigma i (rate feeds back into demand)
//
// Arrow width is proportional to the size of the contribution in the current
// quarter (one common scale over the whole horizon), the colour shows its sign
// (warm = pushes the target variable up, cool = pushes it down) and a flowing,
// pulsing overlay runs faster for bigger contributions. Elements are created once
// per layout and only their attributes change from quarter to quarter, so the
// animation stays smooth while the timeline plays.

const SVG = 'http://www.w3.org/2000/svg';
const EPS = 5e-4;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

const norm = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};

// Open economy: the exchange rate sits top right, above the bank; net exports are
// routed around the top of the drawing into the demand node.
function layout(W, open = false) {
  const compact = W < 540;
  const pad = 6;
  const padL = open ? (compact ? 16 : 22) : pad;
  const gap = compact ? 36 : 64;
  const bw = (W - padL - pad - 2 * gap) / 3;
  const bh = compact ? 58 : 66;
  const eh = compact ? 66 : 72;
  const fxStub = compact ? 24 : 28;
  const top = open ? fxStub + (compact ? 30 : 34) : 6;
  const box = (k, y) => ({ x: padL + k * (bw + gap), y, w: bw, h: bh });
  let exp;
  if (open) {
    const I0 = box(1, 0);
    const right = I0.x + bw / 2 + Math.max(24, 0.22 * bw);
    const left = Math.max(padL, right - (compact ? 220 : 340));
    exp = { x: left, y: top, w: right - left, h: eh };
  } else {
    const ew = Math.min(W - 2 * pad, compact ? 250 : 300);
    exp = { x: (W - ew) / 2, y: top, w: ew, h: eh };
  }
  const yLow = exp.y + eh + (compact ? 100 : 116);
  const nodes = { exp, demand: box(0, yLow), inflation: box(1, yLow), bank: box(2, yLow) };
  if (open) nodes.fx = { x: nodes.bank.x, y: top, w: bw, h: eh };
  for (const n of Object.values(nodes)) { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; }
  const { demand: D, inflation: I, bank: B } = nodes;
  const bottom = yLow + bh;
  const inner = compact ? 34 : 40;
  const outer = compact ? 70 : 82;
  const stub = compact ? 36 : 42;
  const midY = yLow + bh * 0.6;

  // Straight arrow; its label sits at fraction `at` along the arrow, `off` px to one side.
  const line = (a, b, side = 1, off = 12, at = 0.5) => {
    const d = norm(a, b);
    const n = { x: -d.y * side, y: d.x * side };
    return { type: 'line', a, b, label: { x: a.x + (b.x - a.x) * at + n.x * off, y: a.y + (b.y - a.y) * at + n.y * off + 4 } };
  };
  const arc = (a, b, depth) => ({ type: 'arc', a, b, depth, label: { x: (a.x + b.x) / 2, y: a.y + depth * 0.75 + 15 } });
  // Shock stubs enter a node from above; labels at the outer edges are aligned
  // inwards so they never leave the drawing.
  const stubAt = (x, node, anchor = 'middle', lift = 0, len = stub) => ({
    type: 'line', stub: true, a: { x, y: node.y - len - lift }, b: { x, y: node.y },
    label: { x: anchor === 'end' ? x + 8 : anchor === 'start' ? x - 6 : x, y: node.y - len - lift - 6, anchor },
  });

  const expDemandA = { x: exp.x + exp.w * 0.16, y: exp.y + eh };
  const expDemandB = { x: D.cx + D.w * 0.14, y: yLow };
  const arrows = {
    expDemand: line(expDemandA, expDemandB, 1, 14, open ? 0.2 : 0.36),
    expInfl: line({ x: I.cx - 9, y: exp.y + eh }, { x: I.cx - 9, y: yLow }, 1, 12, 0.4),
    demandInfl: { ...line({ x: D.x + D.w, y: midY }, { x: I.x, y: midY }), label: { x: (D.x + D.w + I.x) / 2, y: midY - 9 } },
    inflBank: { ...line({ x: I.x + I.w, y: midY }, { x: B.x, y: midY }), label: { x: (I.x + I.w + B.x) / 2, y: midY - 9 } },
    demandBank: arc({ x: D.cx + D.w * 0.12, y: bottom }, { x: B.cx - B.w * 0.12, y: bottom }, inner),
    bankDemand: arc({ x: B.cx + B.w * 0.26, y: bottom }, { x: D.cx - D.w * 0.26, y: bottom }, outer),
    shockDemand: stubAt(D.x + Math.min(18, D.w * 0.16), D, 'start'),
    shockInfl: stubAt(I.x + I.w - Math.min(18, I.w * 0.16), I, 'start'),
    shockBank: stubAt(B.x + B.w * (open ? 0.12 : 0.3), B),
    limitBank: stubAt(B.x + B.w - Math.min(18, B.w * 0.16), B, 'end', open ? (compact ? 26 : 20) : 0),
  };
  if (open) {
    const F = nodes.fx;
    const fBottom = F.y + F.h;
    Object.assign(arrows, {
      expFx: { ...line({ x: exp.x + exp.w, y: F.y + F.h / 2 }, { x: F.x, y: F.y + F.h / 2 }), label: { x: (exp.x + exp.w + F.x) / 2, y: F.y + F.h / 2 - 9 } },
      bankFx: line({ x: B.cx - 10, y: yLow }, { x: B.cx - 10, y: fBottom }, -1, 12, 0.5),
      interveneFx: line({ x: B.cx + 10, y: yLow }, { x: B.cx + 10, y: fBottom }, 1, 12, 0.5),
      fxInfl: line({ x: F.x + F.w * 0.12, y: fBottom }, { x: I.x + I.w, y: yLow + bh * 0.22 }, 1, 10, 0.62),
      fxDemand: {
        type: 'route', a: { x: F.x + F.w * 0.3, y: F.y }, topY: F.y - (compact ? 16 : 18), leftX: D.x - 11,
        b: { x: D.x, y: yLow + bh * 0.45 },
        label: { x: (F.x + F.w * 0.3 + D.x) / 2, y: F.y - (compact ? 22 : 24) },
      },
      foreignFx: stubAt(F.x + F.w * 0.62, F, 'middle', 0, fxStub),
      shockFx: stubAt(F.x + F.w - Math.min(16, F.w * 0.14), F, 'end', 0, fxStub),
      foreignDemand: stubAt(D.x + Math.min(36, D.w * 0.32), D, 'start', compact ? 15 : 16),
    });
    arrows.fxInfl.label.anchor = 'end';
  }
  // Dotted information arrows: expectations are formed from the variables
  // (parallel to the causal arrows, on their inner side, pointing up).
  const d = norm(expDemandA, expDemandB);
  const inward = { x: d.y, y: -d.x };
  const shift = 14;
  const atY = (y) => {
    const base = { x: expDemandA.x + inward.x * shift, y: expDemandA.y + inward.y * shift };
    const s = (y - base.y) / d.y;
    return { x: base.x + d.x * s, y };
  };
  const infoDemand = { type: 'line', a: atY(yLow), b: atY(exp.y + eh) };
  // Labels near the upper end, clear of the shock stubs' labels.
  const upper = 0.72;
  infoDemand.label = {
    x: infoDemand.a.x + (infoDemand.b.x - infoDemand.a.x) * upper + inward.x * 8,
    y: infoDemand.a.y + (infoDemand.b.y - infoDemand.a.y) * upper + inward.y * 8 + 4,
  };
  const info = {
    infoDemand,
    infoInfl: { type: 'line', a: { x: I.cx + 9, y: yLow }, b: { x: I.cx + 9, y: exp.y + eh }, label: { x: I.cx + 14, y: yLow + (exp.y + eh - yLow) * upper + 4 } },
  };
  const height = Math.ceil(bottom + outer * 0.75 + 24);
  return { compact, open, nodes, arrows, info, width: W, height };
}

// Geometry of a shaft that ends at the base of its arrowhead, plus the head itself.
function shaft(g, head) {
  if (g.type === 'route') {
    // Up, left along the top, down the left margin, then right into the node.
    const r = 10;
    const { a, b, topY, leftX } = g;
    const end = { x: b.x - head, y: b.y };
    return {
      d: `M ${a.x} ${a.y} L ${a.x} ${topY + r} Q ${a.x} ${topY} ${a.x - r} ${topY} L ${leftX + r} ${topY}`
        + ` Q ${leftX} ${topY} ${leftX} ${topY + r} L ${leftX} ${b.y - r} Q ${leftX} ${b.y} ${leftX + r} ${b.y} L ${end.x} ${end.y}`,
      tip: b, dir: { x: 1, y: 0 },
    };
  }
  if (g.type === 'arc') {
    const end = { x: g.b.x, y: g.b.y + head };
    return {
      d: `M ${g.a.x} ${g.a.y} C ${g.a.x} ${g.a.y + g.depth}, ${g.b.x} ${g.b.y + g.depth}, ${end.x} ${end.y}`,
      tip: g.b, dir: { x: 0, y: -1 },
    };
  }
  const dir = norm(g.a, g.b);
  const end = { x: g.b.x - dir.x * head, y: g.b.y - dir.y * head };
  return { d: `M ${g.a.x} ${g.a.y} L ${end.x} ${end.y}`, tip: g.b, dir };
}

function headPoints(tip, dir, len, hw) {
  const c = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
  const n = { x: -dir.y, y: dir.x };
  return `${tip.x},${tip.y} ${c.x + n.x * hw},${c.y + n.y * hw} ${c.x - n.x * hw},${c.y - n.y * hw}`;
}

export function createDiagram(container) {
  container.classList.add('diagram');
  const svg = el('svg', { role: 'img' });
  container.innerHTML = '';
  container.appendChild(svg);
  let data = null;
  let q = 0;
  let geo = null;
  let refs = null;
  let lastWidth = 0;

  function build() {
    if (!data) return;
    const W = Math.max(300, Math.round(container.clientWidth));
    lastWidth = W;
    geo = layout(W, data.economy === 'open');
    svg.setAttribute('viewBox', `0 0 ${W} ${geo.height}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', geo.height);
    svg.setAttribute('aria-label', data.texts.aria);
    svg.classList.toggle('compact', geo.compact);
    svg.innerHTML = '';
    refs = { arrows: {}, nodes: {} };
    const tx = data.texts;

    // Information arrows (behind everything)
    const infoLayer = el('g', { class: 'info-arrows' }, svg);
    for (const g of Object.values(geo.info)) {
      const s = shaft(g, 7);
      const grp = el('g', {}, infoLayer);
      el('title', {}, grp).textContent = tx.infoTitle;
      el('path', { d: s.d, class: 'info-shaft' }, grp);
      el('polygon', { points: headPoints(s.tip, s.dir, 7, 3.5), class: 'info-head' }, grp);
      const label = el('text', { x: g.label.x, y: g.label.y, class: 'info-label', 'text-anchor': 'start' }, grp);
      label.textContent = tx.infoLabel;
    }

    // Causal arrows
    const arrowLayer = el('g', { class: 'arrows' }, svg);
    for (const [key, g] of Object.entries(geo.arrows)) {
      const grp = el('g', { class: 'arrow' }, arrowLayer);
      el('title', {}, grp).textContent = tx.arrows[key] || '';
      const path = el('path', { class: 'shaft' }, grp);
      const flow = el('path', { class: 'flow' }, grp);
      const head = el('polygon', { class: 'head' }, grp);
      const label = el('text', { x: g.label.x, y: g.label.y, class: 'arrow-label', 'text-anchor': g.label.anchor || 'middle' }, grp);
      refs.arrows[key] = { grp, path, flow, head, label, g };
    }

    // Nodes
    const nodeLayer = el('g', { class: 'nodes' }, svg);
    for (const [key, r] of Object.entries(geo.nodes)) {
      const grp = el('g', { class: `node node-${key}` }, nodeLayer);
      el('title', {}, grp).textContent = tx.nodeTips[key] || '';
      el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 10, class: 'node-box' }, grp);
      const title = el('text', { x: r.cx, y: r.y + (geo.compact ? 17 : 20), 'text-anchor': 'middle', class: 'node-title' }, grp);
      title.textContent = geo.compact ? tx.nodesShort[key] : tx.nodes[key];
      const lines = [];
      const count = key === 'exp' ? (data.mode === 'hybrid' ? 3 : 2) : key === 'bank' || key === 'fx' ? 2 : 1;
      if (key === 'exp') {
        // Expectations: values side by side on one line, credibility below.
        const v = el('text', { x: r.cx, y: r.y + (geo.compact ? 37 : 42), 'text-anchor': 'middle', class: 'node-value small' }, grp);
        lines.push(v);
        if (count === 3) lines.push(el('text', { x: r.cx, y: r.y + (geo.compact ? 55 : 61), 'text-anchor': 'middle', class: 'node-sub' }, grp));
      } else {
        lines.push(el('text', { x: r.cx, y: r.y + (geo.compact ? 37 : 42), 'text-anchor': 'middle', class: 'node-value' }, grp));
        if (count === 2) lines.push(el('text', { x: r.cx, y: r.y + (geo.compact ? 52 : 58), 'text-anchor': 'middle', class: 'node-sub' }, grp));
      }
      refs.nodes[key] = lines;
    }
    paint();
  }

  function paint() {
    if (!data || !refs) return;
    const tx = data.texts;
    const max = Math.max(data.maxFlow, 1e-6);
    for (const [key, r] of Object.entries(refs.arrows)) {
      const v = data.flows[key]?.[q] ?? 0;
      const rel = Math.min(1, Math.abs(v) / max);
      const idle = Math.abs(v) < EPS;
      const sw = idle ? 1 : 1.25 + 12 * rel;
      const headLen = idle ? 6 : 7 + sw * 0.9;
      const s = shaft(r.g, headLen - 1);
      r.path.setAttribute('d', s.d);
      r.flow.setAttribute('d', s.d);
      r.path.setAttribute('stroke-width', sw.toFixed(2));
      r.flow.setAttribute('stroke-width', Math.max(1.6, sw * 0.42).toFixed(2));
      r.head.setAttribute('points', headPoints(s.tip, s.dir, headLen, idle ? 3.5 : 3.5 + sw * 0.55));
      r.grp.setAttribute('class', `arrow ${idle ? 'idle' : v > 0 ? 'up' : 'down'}${idle ? '' : ' live'}`);
      r.grp.style.setProperty('--dur', `${(2.4 - 1.8 * rel).toFixed(2)}s`);
      let text = idle ? '0' : data.format(v);
      if (r.g.stub) {
        let name = tx.stubs[key];
        if (key === 'limitBank') {
          const b = Math.abs(data.limitSplit.bound[q] || 0);
          const o = Math.abs(data.limitSplit.override[q] || 0);
          name = b >= o ? tx.stubs.bound : tx.stubs.override;
        }
        // In the narrow open layout the inputs carry only their names (values are
        // in the breakdown next to the diagram and in the arrow widths).
        if (geo.compact && geo.open) text = name || text;
        else if (name) text = `${name} ${text}`;
      }
      // Channels that stay silent over the whole horizon are hidden.
      if (r.g.stub || key === 'interveneFx') r.grp.style.display = data.active[key] ? '' : 'none';
      r.label.textContent = text;
    }
    const val = data.values;
    const f = data.formatLevel;
    const n = refs.nodes;
    const open = data.economy === 'open';
    n.exp[0].textContent = open ? `Eπᴴ ${f(val.Epi[q], 1)} % · Ec ${f(val.Ex[q], 1)} %` : `Eπ ${f(val.Epi[q], 1)} % · Ex ${f(val.Ex[q], 1)} %`;
    if (open) {
      n.fx[0].textContent = geo.compact ? f(val.fx[q], 2) : `${f(val.fx[q], 2)} CZK/EUR`;
      n.fx[1].textContent = `${tx.realFx} ${val.q[q] > 0.005 ? '+' : ''}${f(val.q[q], 1)} %`;
    }
    if (n.exp[1]) n.exp[1].textContent = `${tx.credibility} w = ${f(val.w[q], 2)}`;
    n.demand[0].textContent = `x ${f(val.x[q], 2)} %`;
    n.inflation[0].textContent = `π ${f(val.pi[q], 2)} %`;
    n.bank[0].textContent = `i ${f(val.i[q], 2)} %`;
    n.bank[1].textContent = `${tx.real} ${f(val.r[q], 2)} %`;
  }

  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - lastWidth) >= 1) build();
  });
  ro.observe(container);

  return {
    // data = { flows, maxFlow, values: {x, pi, i, r, Epi, Ex, w, fx?, q?}, limitSplit: {bound, override},
    //          mode, economy, texts, format(v), formatLevel(v, digits) }
    update(next) {
      const active = {};
      for (const [k, arr] of Object.entries(next.flows)) active[k] = arr.some((v) => Math.abs(v) > EPS);
      data = { ...next, active };
      build();
    },
    setQuarter(next) { q = next; paint(); },
    destroy() { ro.disconnect(); },
  };
}
