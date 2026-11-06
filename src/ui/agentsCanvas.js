// Canvas view of the agent economy: households as dots clustered around the firm
// they work for, firms on a ring, the bank in the middle, the central bank, the state
// and (open economy) the rest of the world as labelled nodes. Payments of the current
// quarter are drawn as lines whose width grows with the amount, with "money" dots
// travelling from payer to payee. Households are coloured by whether they spend more
// than their income or save; a firm that changes its price flashes (warm = up,
// cool = down).
//
// The static part of a quarter (lines, dots) is painted once into an offscreen
// canvas; each animation frame only adds the moving money and the flashes.

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const KINDS = ['cons', 'wage', 'input', 'tax', 'benefit', 'interest', 'dividend', 'trade'];

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function toRgb(c) {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) return hex[1].match(/\w\w/g).map((h) => parseInt(h, 16));
  const short = c.match(/^#([0-9a-f]{3})$/i);
  if (short) return short[1].split('').map((h) => parseInt(h + h, 16));
  const rgb = c.match(/rgba?\(([^)]+)\)/);
  if (rgb) return rgb[1].split(',').slice(0, 3).map((v) => parseFloat(v));
  return [128, 128, 128];
}

function mixColor(a, b, t) {
  const pa = toRgb(a), pb = toRgb(b);
  const c = pa.map((v, k) => Math.round(v + (pb[k] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function createAgentsCanvas(container, { onHover, texts }) {
  container.classList.add('abm-canvas');
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  const tip = document.createElement('div');
  tip.className = 'chart-tip abm-tip';
  tip.hidden = true;
  container.append(canvas, tip);
  const ctx = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');

  let run = null;
  let q = 0;
  let geo = null;
  let lines = [];
  let particles = [];
  let flashStart = 0;
  let raf = 0;
  let active = true;
  let colors = {};
  let dpr = 1;
  let hoverIdx = null;
  let hidden = new Set(); // flow kinds switched off in the legend
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function readColors() {
    const c = (n, f) => cssVar(container, n, f);
    colors = {
      cons: c('--abm-cons', '#2a78d6'), wage: c('--abm-wage', '#1baf7a'), input: c('--abm-input', '#6250d6'),
      tax: c('--abm-tax', '#898781'), benefit: c('--abm-benefit', '#e0a100'), interest: c('--abm-interest', '#d55181'),
      dividend: c('--abm-dividend', '#8a6a3b'), trade: c('--abm-trade', '#0f8f9a'),
      save: c('--abm-save', '#2a78d6'), spend: c('--abm-spend', '#eb6834'), neutral: c('--abm-neutral', '#9d9b93'),
      up: c('--up', '#d6542a'), down: c('--down', '#1f7fb8'), ink: c('--ink', '#0b0b0b'), ink2: c('--ink-2', '#52514e'),
      surface: c('--surface', '#fcfcfb'), surface2: c('--surface-2', '#f3f2ee'), border: c('--axis', '#c3c2b7'),
      page: c('--page', '#f9f9f7'),
    };
  }

  function layout() {
    const W = Math.max(300, container.clientWidth);
    const Hc = Math.round(W < 560 ? W * 1.12 : Math.min(640, W * 0.66));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, layer]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(Hc * dpr);
    }
    canvas.style.width = `${W}px`;
    canvas.style.height = `${Hc}px`;
    const { world } = run;
    const F = world.F;
    const cx = W / 2, cy = Hc / 2 + (W < 560 ? 10 : 0);
    const m = Math.min(W, Hc);
    const ringR = m * 0.27;
    const clusterR = m * 0.43;
    const maxCount = Math.max(...world.counts);
    const wedge = (TAU * clusterR) / F / 2;
    const spread = Math.min(wedge * 0.95, m * 0.07) / Math.sqrt(maxCount);
    const firms = [];
    const clusters = [];
    for (let j = 0; j < F; j++) {
      const a = -Math.PI / 2 + (j / F) * TAU;
      firms.push({ x: cx + ringR * Math.cos(a), y: cy + ringR * Math.sin(a), a });
      clusters.push({ x: cx + clusterR * Math.cos(a), y: cy + clusterR * Math.sin(a) });
    }
    const hh = new Float32Array(world.H * 2);
    world.workers.forEach((list, j) => {
      list.forEach((k, n) => {
        const r = spread * Math.sqrt(n + 0.5);
        const t = n * GOLDEN;
        hh[k * 2] = clusters[j].x + r * Math.cos(t);
        hh[k * 2 + 1] = clusters[j].y + r * Math.sin(t);
      });
    });
    const nodes = {
      bank: { x: cx, y: cy, label: texts().bank },
      cb: { x: cx, y: cy - m * 0.13, label: texts().cb },
      state: { x: cx, y: cy + m * 0.13, label: texts().state },
    };
    if (run.economy === 'open') nodes.abroad = { x: W - Math.max(46, m * 0.09), y: Math.max(28, m * 0.06), label: texts().abroad };
    geo = { W, H: Hc, cx, cy, m, firms, clusters, hh, nodes, dot: Math.max(1.4, Math.min(2.6, 2.6 * Math.sqrt(600 / world.H))) };
  }

  // Lines of the current quarter: { kind, x1, y1, x2, y2, w, amt, via? }
  function buildLines() {
    const m = run.micro[q];
    const { world } = run;
    const out = [];
    // Width grows with the square root of the amount (about one household's quarterly
    // income = 1); summed flows of a whole group are drawn on a gentler scale.
    const width = (amt, kind) => {
      const a = Math.max(0, amt);
      if (kind === 'cons') return Math.min(3, 0.35 + 1.1 * Math.sqrt(a));
      if (kind === 'wage') return Math.min(4, 0.4 + 1.4 * Math.sqrt(a));
      return Math.min(7, 0.4 + 0.9 * Math.sqrt(a));
    };
    const add = (kind, a, b, amt, from, to, via) => {
      if (amt > 1e-6) out.push({ kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: width(amt, kind), amt, via, from, to });
    };
    const H = world.H, F = world.F;
    const P = (k) => ({ x: geo.hh[k * 2], y: geo.hh[k * 2 + 1] });
    for (let k = 0; k < H; k++) {
      for (let s = 0; s < 3; s++) add('cons', P(k), geo.firms[world.shops[k * 3 + s]], m.cons[k * 3 + s], `h${k}`, `f${world.shops[k * 3 + s]}`);
      add('wage', geo.firms[world.employer[k]], P(k), m.wage[k], `f${world.employer[k]}`, `h${k}`);
    }
    for (let j = 0; j < F; j++) {
      for (let s = 0; s < 2; s++) add('input', geo.firms[j], geo.firms[world.suppliers[j * 2 + s]], m.inputs[j * 2 + s], `f${j}`, `f${world.suppliers[j * 2 + s]}`, { x: geo.cx, y: geo.cy });
    }
    // Flows with the bank, the state and abroad are summed per cluster of households.
    const byCluster = (arr, sign = 1) => {
      const sums = new Float64Array(F);
      for (let k = 0; k < H; k++) sums[world.employer[k]] += sign * arr[k];
      return sums;
    };
    const taxes = byCluster(m.tax), benefits = byCluster(m.benefit), divs = byCluster(m.dividend);
    const depInt = new Float64Array(F), loanIntH = new Float64Array(F), imports = byCluster(m.imports);
    for (let k = 0; k < H; k++) {
      if (m.hhInterest[k] > 0) depInt[world.employer[k]] += m.hhInterest[k];
      else loanIntH[world.employer[k]] -= m.hhInterest[k];
    }
    const N = geo.nodes;
    for (let j = 0; j < F; j++) {
      const c = geo.clusters[j];
      add('tax', c, N.state, taxes[j], `c${j}`, 'state');
      add('benefit', N.state, c, benefits[j], 'state', `c${j}`);
      add('interest', N.bank, c, depInt[j], 'bank', `c${j}`);
      add('interest', c, N.bank, loanIntH[j], `c${j}`, 'bank');
      const fi = m.firmInterest[j];
      if (fi < 0) add('interest', geo.firms[j], N.bank, -fi, `f${j}`, 'bank'); else add('interest', N.bank, geo.firms[j], fi, 'bank', `f${j}`);
      add('dividend', geo.firms[j], c, m.dividendPaid[j], `f${j}`, `c${j}`);
      if (N.abroad) {
        add('trade', c, N.abroad, imports[j], `c${j}`, 'abroad');
        add('trade', N.abroad, geo.firms[j], m.exports[j], 'abroad', `f${j}`);
      }
    }
    if (m.stateInterest < 0) add('interest', N.state, N.bank, -m.stateInterest, 'state', 'bank');
    else add('interest', N.bank, N.state, m.stateInterest, 'bank', 'state');
    if (m.bankDiv > 0) {
      const share = byCluster(Array.from(m.dividend, (v, k) => (world.htm[k] ? 0 : 1)));
      const total = share.reduce((a, b) => a + b, 0) || 1;
      for (let j = 0; j < F; j++) add('dividend', N.bank, geo.clusters[j], (m.bankDiv * share[j]) / total, 'bank', `c${j}`);
    }
    lines = out.filter((l) => !hidden.has(l.kind));
    // Moving money: every aggregated flow plus a sample of the households' payments.
    const big = lines.filter((l) => l.kind !== 'cons' && l.kind !== 'wage');
    const small = lines.filter((l) => l.kind === 'cons' || l.kind === 'wage');
    const step = Math.max(1, Math.floor(small.length / 500));
    const pick = big.concat(small.filter((_, k) => k % step === 0));
    particles = pick.map((l, k) => ({ l, phase: ((k * 0.618) % 1), r: Math.max(1.3, Math.min(3.2, 0.9 + l.w * 0.45)) }));
  }

  function pointOn(l, t) {
    if (l.via) {
      // Quadratic curve bowed towards the centre (supplier network).
      const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
      const cx = mx + (l.via.x - mx) * 0.55, cy = my + (l.via.y - my) * 0.55;
      const u = 1 - t;
      return { x: u * u * l.x1 + 2 * u * t * cx + t * t * l.x2, y: u * u * l.y1 + 2 * u * t * cy + t * t * l.y2 };
    }
    return { x: l.x1 + (l.x2 - l.x1) * t, y: l.y1 + (l.y2 - l.y1) * t };
  }

  function drawStatic() {
    const g = lctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, geo.W, geo.H);
    const m = run.micro[q];
    const { world } = run;
    // payment lines, faint
    g.lineCap = 'round';
    const ALPHA = { cons: 0.09, wage: 0.3, input: 0.32, tax: 0.22, benefit: 0.22, interest: 0.3, dividend: 0.26, trade: 0.32 };
    for (const kind of KINDS) {
      g.strokeStyle = colors[kind];
      g.globalAlpha = ALPHA[kind];
      for (const l of lines) if (l.kind === kind) strokeLine(g, l, l.w);
    }
    g.globalAlpha = 1;
    // households: colour by saving rate; hand-to-mouth with a dark rim
    for (let k = 0; k < world.H; k++) {
      const inc = m.income[k];
      const sRate = inc > 1e-9 ? (inc - m.spend[k]) / inc : 0;
      const t = Math.max(-1, Math.min(1, sRate / 0.12));
      const col = t >= 0 ? mixColor(colors.neutral, colors.save, t) : mixColor(colors.neutral, colors.spend, -t);
      g.fillStyle = col;
      g.beginPath();
      g.arc(geo.hh[k * 2], geo.hh[k * 2 + 1], geo.dot, 0, TAU);
      g.fill();
      if (world.htm[k]) {
        g.strokeStyle = colors.ink;
        g.globalAlpha = 0.55;
        g.lineWidth = 0.8;
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    // firms: size by output
    const outMax = Math.max(...m.output);
    for (let j = 0; j < world.F; j++) {
      const f = geo.firms[j];
      const scale = Math.max(0.55, Math.min(1, geo.m / 520));
      const r = (3.5 + 6 * Math.sqrt(m.output[j] / outMax)) * scale;
      g.fillStyle = colors.surface;
      g.strokeStyle = colors.ink;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(f.x, f.y, r, 0, TAU);
      g.fill();
      g.stroke();
      f.r = r;
    }
    // institutions
    g.font = `600 ${geo.W < 560 ? 11 : 12.5}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const n of Object.values(geo.nodes)) {
      const w = g.measureText(n.label).width + 16;
      const h = geo.W < 560 ? 22 : 26;
      g.fillStyle = colors.surface;
      g.strokeStyle = colors.ink2;
      g.lineWidth = 1.3;
      roundRect(g, n.x - w / 2, n.y - h / 2, w, h, 7);
      g.fill();
      g.stroke();
      g.fillStyle = colors.ink;
      g.fillText(n.label, n.x, n.y + 0.5);
      n.w = w; n.h = h;
    }
  }

  function strokeLine(g, l, w) {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(l.x1, l.y1);
    if (l.via) {
      const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
      g.quadraticCurveTo(mx + (l.via.x - mx) * 0.55, my + (l.via.y - my) * 0.55, l.x2, l.y2);
    } else g.lineTo(l.x2, l.y2);
    g.stroke();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function frame(now) {
    if (!run || !geo) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.page;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const time = now / 1000;
    // Hovered agent: its own payments at full strength.
    if (hoverIdx) {
      const id = hoverIdx.type === 'firm' ? `f${hoverIdx.id}` : `h${hoverIdx.id}`;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.95;
      for (const l of lines) {
        if (l.from !== id && l.to !== id) continue;
        ctx.strokeStyle = colors[l.kind];
        strokeLine(ctx, l, Math.max(1.6, l.w * 1.3));
      }
      ctx.globalAlpha = 1;
    }
    if (!reduced) {
      for (const pt of particles) {
        const t = (pt.phase + time / 1.6) % 1;
        const p = pointOn(pt.l, t);
        ctx.fillStyle = colors[pt.l.kind];
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pt.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Price changes: expanding rings during the first second of the quarter.
    const m = run.micro[q];
    const age = (now - flashStart) / 1000;
    if (age < 1.1 || reduced) {
      const a = reduced ? 1 : Math.max(0, 1 - age / 1.1);
      for (let j = 0; j < run.world.F; j++) {
        const dir = m.reset[j];
        if (!dir) continue;
        const f = geo.firms[j];
        ctx.strokeStyle = dir > 0 ? colors.up : colors.down;
        ctx.globalAlpha = a;
        ctx.lineWidth = geo.m < 520 ? 1.8 : 2.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, (f.r || 6) + 2 + (reduced ? 2 : age * (geo.m < 520 ? 6 : 10)), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // Labels of the institutions with this quarter's numbers.
    const info = texts().info?.(q);
    if (info) {
      ctx.font = `600 ${geo.W < 560 ? 10.5 : 11.5}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const [key, text] of Object.entries(info)) {
        const n = geo.nodes[key];
        if (!n || !text) continue;
        ctx.strokeStyle = colors.page;
        ctx.lineWidth = 4;
        ctx.strokeText(text, n.x, n.y + n.h / 2 + 10);
        ctx.fillStyle = colors.ink;
        ctx.fillText(text, n.x, n.y + n.h / 2 + 10);
      }
    }
    if (hoverIdx) {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hoverIdx.x, hoverIdx.y, hoverIdx.r + 3, 0, TAU);
      ctx.stroke();
    }
    if (active && !reduced) raf = requestAnimationFrame(frame);
  }

  function restart() {
    cancelAnimationFrame(raf);
    if (active) raf = requestAnimationFrame(frame);
  }

  function rebuild() {
    if (!run) return;
    readColors();
    layout();
    buildLines();
    drawStatic();
    flashStart = performance.now();
    restart();
  }

  // Hover: the nearest household or firm.
  canvas.addEventListener('pointermove', (ev) => {
    if (!run || !geo) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * geo.W;
    const y = ((ev.clientY - rect.top) / rect.height) * geo.H;
    let best = null, bd = 12 * 12;
    for (let j = 0; j < run.world.F; j++) {
      const f = geo.firms[j];
      const d = (f.x - x) ** 2 + (f.y - y) ** 2;
      if (d < bd) { bd = d; best = { type: 'firm', id: j, x: f.x, y: f.y, r: f.r || 6 }; }
    }
    if (!best || best.type !== 'firm') {
      for (let k = 0; k < run.world.H; k++) {
        const d = (geo.hh[k * 2] - x) ** 2 + (geo.hh[k * 2 + 1] - y) ** 2;
        if (d < bd) { bd = d; best = { type: 'household', id: k, x: geo.hh[k * 2], y: geo.hh[k * 2 + 1], r: geo.dot }; }
      }
    }
    hoverIdx = best;
    const html = best ? onHover?.(best, q) : '';
    if (html) {
      tip.innerHTML = html;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(geo.W - tw, best.x + 12))}px`;
      tip.style.top = `${Math.max(0, best.y - 10)}px`;
    } else tip.hidden = true;
    if (reduced) frame(performance.now());
  });
  canvas.addEventListener('pointerleave', () => { hoverIdx = null; tip.hidden = true; if (reduced) frame(performance.now()); });

  let lastW = 0;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - lastW) >= 1) { lastW = container.clientWidth; rebuild(); }
  });
  ro.observe(container);

  return {
    update(next) { run = next; q = Math.min(q, run.micro.length - 1); rebuild(); },
    setQuarter(next) {
      if (!run) return;
      q = Math.max(0, Math.min(run.micro.length - 1, next));
      buildLines();
      drawStatic();
      flashStart = performance.now();
      restart();
    },
    setActive(on) { active = on; if (on) restart(); else cancelAnimationFrame(raf); },
    setHidden(kinds) { hidden = new Set(kinds); if (run) { buildLines(); drawStatic(); restart(); } },
    refreshColors() { rebuild(); },
  };
}
