// "Agents" tab: the agent-based economy (src/abm) drawn as dots and payments, its
// aggregates in the same charts as the shock lab, and the three-equation model at the
// corresponding calibration for comparison. This file only wires things together.

import { runABM, matchedParams, ABM_DEFAULTS, ABM_LIMITS } from '../abm/model.js';
import { simulate, DEFAULT_PARAMS, CLOSED_KINDS, OPEN_KINDS, steadyNominalAnn } from '../model/index.js';
import { createChart } from './chart.js';
import { createTimeline } from './timeline.js';
import { createAgentsCanvas } from './agentsCanvas.js';
import { t, fmt, eqRefs } from './i18n.js';

const SHOCK_META = {
  size: { min: -8, max: 8, step: 0.25 },
  rho: { min: 0, max: 0.97, step: 0.01 },
  duration: { min: 1, max: 16, step: 1 },
  horizon: { min: 20, max: 40, step: 1 },
  manualLevel: { min: 0, max: 10, step: 0.25 },
};
const ABM_COLOR = 'var(--s3)';
const NK_COLOR = 'var(--s2)';
const FLOW_KINDS = ['cons', 'wage', 'input', 'tax', 'benefit', 'interest', 'dividend', 'trade'];
const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 ? (Math.round(step * 100) % 10 ? 2 : 1) : 2);

export function createAgentsView(root, { timelineTexts }) {
  const state = {
    economy: 'closed',
    shock: { kind: 'rn', size: -2, rho: 0.8, shape: 'ar1', duration: 4 },
    config: { ...ABM_DEFAULTS },
    policy: 'rule',
    manual: [],
    manualLevel: steadyNominalAnn(DEFAULT_PARAMS),
    horizon: 24,
    quarter: 0,
    openTips: new Set(),
    active: false,
    hiddenFlows: new Set(),
  };
  const p = { ...DEFAULT_PARAMS };
  let result = null;
  let nk = null;
  let charts = {};
  let timeline = null;
  let view = null;
  let pending = 0;

  root.innerHTML = `
    <aside class="controls" id="a-controls" aria-label="Controls"></aside>
    <section class="content">
      <div class="card abm-intro" id="a-intro"></div>
      <div id="a-timeline" class="sticky-timeline"></div>
      <article class="card abm-world">
        <div class="abm-head"><h2></h2><span class="abm-qlabel"></span></div>
        <div id="a-canvas"></div>
        <div class="abm-legend" id="a-legend"></div>
      </article>
      <div class="legend" id="a-chart-legend"></div>
      <div class="charts">
        <div id="a-chart-gap"></div><div id="a-chart-inflation"></div>
        <div id="a-chart-nominal"></div><div id="a-chart-real"></div>
        <div id="a-chart-fx" class="wide" hidden></div>
      </div>
      <div class="panels">
        <article class="card" id="a-explain"></article>
        <article class="card" id="a-flows"></article>
      </div>
    </section>`;
  const $ = (sel) => root.querySelector(sel);

  // ---------------------------------------------------------------------------
  // Controls

  const infoButton = (id) => `<button type="button" class="info" data-tip="${id}" aria-expanded="${state.openTips.has(id)}" aria-controls="atip-${id}" title="${t('buttons.info')}">?</button>`;
  const tipBox = (id, html) => `<div class="tip" id="atip-${id}" ${state.openTips.has(id) ? '' : 'hidden'}>${eqRefs(html)}</div>`;
  function slider(id, label, value, meta, unit, tip, group) {
    return `<div class="ctl" data-row="${id}">
      <div class="ctl-head"><label for="a-${id}">${label}</label><output id="a-out-${id}">${fmtVal(id, value, meta)}${unit ? ` ${unit}` : ''}</output>${tip ? infoButton(id) : ''}</div>
      <input type="range" id="a-${id}" data-group="${group}" data-key="${id}" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${value}">
      ${tip ? tipBox(id, tip) : ''}
    </div>`;
  }
  const fmtVal = (id, v, meta) => (id === 'htmShare' || id === 'stabilizer' || id === 'resetProb' ? `${fmt(v * 100, 0)} %` : fmt(v, decimals(meta.step)));

  function renderControls() {
    const s = state.shock;
    const kinds = state.economy === 'open' ? [...CLOSED_KINDS, ...OPEN_KINDS] : CLOSED_KINDS;
    const cfg = state.config;
    $('#a-controls').innerHTML = `
      <details open>
        <summary>${t('agents.sections.world')}</summary>
        <div class="ctl">
          <div class="ctl-head"><label>${t('economy.label')}</label>${infoButton('economy')}</div>
          <div class="seg" role="group" aria-label="${t('economy.label')}">${['closed', 'open'].map((e) => `<button type="button" data-aeconomy="${e}" aria-pressed="${state.economy === e}">${t(`economy.${e}`)}</button>`).join('')}</div>
          ${tipBox('economy', t('agents.tips.economy'))}
        </div>
        ${slider('households', t('agents.params.households'), cfg.households, ABM_LIMITS.households, '', t('agents.tips.households'), 'config')}
        ${slider('firms', t('agents.params.firms'), cfg.firms, ABM_LIMITS.firms, '', t('agents.tips.firms'), 'config')}
        ${slider('htmShare', t('agents.params.htmShare'), cfg.htmShare, ABM_LIMITS.htmShare, '', t('agents.tips.htmShare'), 'config')}
        ${slider('resetProb', t('agents.params.resetProb'), cfg.resetProb, ABM_LIMITS.resetProb, '', t('agents.tips.resetProb'), 'config')}
        ${slider('stabilizer', t('agents.params.stabilizer'), cfg.stabilizer, ABM_LIMITS.stabilizer, '', t('agents.tips.stabilizer'), 'config')}
        <div class="ctl">
          <div class="ctl-head"><label for="a-seed">${t('agents.params.seed')}</label>${infoButton('seed')}</div>
          <div class="seed-row"><input type="number" id="a-seed" min="1" max="999999" step="1" value="${cfg.seed}" inputmode="numeric"><button type="button" class="btn ghost" id="a-dice">${t('game.randomSeed')}</button></div>
          ${tipBox('seed', t('agents.tips.seed'))}
        </div>
      </details>
      <details open>
        <summary>${t('sections.shock')}</summary>
        <div class="ctl">
          <div class="ctl-head"><label for="a-kind">${t('shock.kind')}</label></div>
          <select id="a-kind">${kinds.map((k) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${t(`shock.kinds.${k}`)}</option>`).join('')}</select>
        </div>
        ${slider('size', t('shock.size'), s.size, SHOCK_META.size, s.kind === 'ystar' ? '%' : t('shock.sizeUnit'), t(`shock.sizeTip.${s.kind}`), 'shock')}
        <div class="ctl">
          <div class="ctl-head"><label for="a-shape">${t('shock.shape')}</label></div>
          <select id="a-shape">${['ar1', 'step'].map((k) => `<option value="${k}" ${k === s.shape ? 'selected' : ''}>${t(`shock.shapes.${k}`)}</option>`).join('')}</select>
        </div>
        <div data-row-wrap="rho" ${s.shape === 'ar1' ? '' : 'hidden'}>${slider('rho', t('shock.rho'), s.rho, SHOCK_META.rho, '', '', 'shock')}</div>
        <div data-row-wrap="duration" ${s.shape === 'step' ? '' : 'hidden'}>${slider('duration', t('shock.duration'), s.duration, SHOCK_META.duration, t('shock.durationUnit'), '', 'shock')}</div>
        ${slider('horizon', t('shock.horizon'), state.horizon, SHOCK_META.horizon, t('shock.horizonUnit'), '', 'horizon')}
      </details>
      <details open>
        <summary>${t('sections.policy')}</summary>
        <div class="ctl">
          <div class="ctl-head"><label>${t('agents.params.policy')}</label>${infoButton('policy')}</div>
          <div class="seg" role="group" aria-label="${t('agents.params.policy')}">${['rule', 'manual'].map((m) => `<button type="button" data-apolicy="${m}" aria-pressed="${state.policy === m}">${t(`agents.policy.${m}`)}</button>`).join('')}</div>
          ${tipBox('policy', t('agents.tips.policy'))}
        </div>
        <div data-row-wrap="manual" ${state.policy === 'manual' ? '' : 'hidden'}>
          ${slider('manualLevel', t('agents.params.manualLevel', { q: state.quarter }), state.manualLevel, SHOCK_META.manualLevel, '% p.a.', t('agents.tips.manualLevel'), 'manual')}
        </div>
      </details>
      <div class="reset-row"><button type="button" class="btn ghost" id="a-reset">${t('buttons.reset')}</button></div>`;
  }

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.type !== 'range') {
      if (el.id === 'a-seed') {
        const v = Math.floor(Number(el.value));
        if (v > 0) { state.config.seed = v; schedule(); }
      }
      return;
    }
    const key = el.dataset.key;
    const v = Number(el.value);
    const group = el.dataset.group;
    if (group === 'config') state.config[key] = v;
    else if (group === 'shock') state.shock[key] = v;
    else if (group === 'horizon') state.horizon = v;
    else if (group === 'manual') {
      state.manualLevel = v;
      for (let k = state.quarter; k < 40; k++) state.manual[k] = v;
    }
    const meta = ABM_LIMITS[key] || SHOCK_META[key];
    const unit = key === 'size' ? (state.shock.kind === 'ystar' ? '%' : t('shock.sizeUnit')) : key === 'duration' || key === 'horizon' ? t('shock.durationUnit') : key === 'manualLevel' ? '% p.a.' : '';
    const out = root.querySelector(`#a-out-${key}`);
    if (out) out.textContent = `${fmtVal(key, v, meta)}${unit ? ` ${unit}` : ''}`;
    schedule();
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'a-kind') { state.shock.kind = el.value; renderControls(); schedule(0); }
    if (el.id === 'a-shape') { state.shock.shape = el.value; renderControls(); schedule(0); }
  });
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tip) {
      const id = btn.dataset.tip;
      const box = root.querySelector(`#atip-${id}`);
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) state.openTips.add(id); else state.openTips.delete(id);
    } else if (btn.dataset.flow) {
      const k = btn.dataset.flow;
      if (state.hiddenFlows.has(k)) state.hiddenFlows.delete(k); else state.hiddenFlows.add(k);
      btn.setAttribute('aria-pressed', String(!state.hiddenFlows.has(k)));
      view.setHidden([...state.hiddenFlows]);
    } else if (btn.dataset.aeconomy) {
      state.economy = btn.dataset.aeconomy;
      if (state.economy === 'closed' && OPEN_KINDS.includes(state.shock.kind)) state.shock.kind = 'rn';
      renderControls();
      schedule(0);
    } else if (btn.dataset.apolicy) {
      state.policy = btn.dataset.apolicy;
      if (state.policy === 'manual' && result) {
        // Start from the path the rule produced, so nothing jumps until the slider moves.
        state.manual = result.levels.raw.nominal.map((v) => Math.round(v * 4) / 4);
        state.manualLevel = state.manual[state.quarter];
      }
      renderControls();
      schedule(0);
    } else if (btn.id === 'a-dice') {
      state.config.seed = 1 + Math.floor(Math.random() * 999999);
      root.querySelector('#a-seed').value = state.config.seed;
      schedule(0);
    } else if (btn.id === 'a-reset') {
      Object.assign(state, {
        economy: 'closed', shock: { kind: 'rn', size: -2, rho: 0.8, shape: 'ar1', duration: 4 },
        config: { ...ABM_DEFAULTS }, policy: 'rule', manual: [], horizon: 24,
      });
      renderControls();
      schedule(0);
    }
  });

  // Recompute after the slider settles (a run takes tens of milliseconds).
  function schedule(delay = 90) {
    clearTimeout(pending);
    pending = setTimeout(compute, delay);
  }

  function compute() {
    const shock = { ...state.shock };
    const manual = state.policy === 'manual' ? state.manual.slice(0, state.horizon) : [];
    result = runABM({ config: state.config, params: p, economy: state.economy, shocks: [shock], horizon: state.horizon, policy: { rates: manual } });
    const nkPolicy = manual.length ? { rates: manual.map((v) => (Number.isFinite(v) ? (v - steadyNominalAnn(p)) / 4 : NaN)) } : {};
    nk = simulate({ params: matchedParams(state.config, p), shocks: [shock], horizon: state.horizon, economy: state.economy, policy: nkPolicy }, 'hybrid');
    state.quarter = Math.min(state.quarter, state.horizon - 1);
    timeline.setN(state.horizon);
    view.update(result);
    view.setQuarter(state.quarter);
    renderCharts();
    renderTexts();
    renderFlows();
  }

  // ---------------------------------------------------------------------------
  // Charts, texts

  function renderCharts() {
    const n = state.horizon;
    const R = result.levels.response;
    const common = { n, format: (v, d) => fmt(v, d), quarterLabel: (q) => t('app.quarterTitle', { t: q }) };
    const pair = (abm, model) => [
      { key: 'abm', label: t('agents.series.abm'), color: ABM_COLOR, width: 2.25, values: abm },
      { key: 'nk', label: t('agents.series.nk'), color: NK_COLOR, dash: '7 5', width: 1.75, values: model },
    ];
    const bands = [];
    result.levels.raw.nominal.forEach((v, k) => { if (Math.abs(v - p.lowerBoundAnn) < 1e-9) bands.push([k, k]); });
    charts.gap.update({ ...common, series: pair(R.gap, nk.levels.gap), refs: [] });
    charts.inflation.update({ ...common, series: pair(R.inflation, nk.levels.inflation), refs: [{ y: p.targetAnn, label: `${t('charts.target')} ${fmt(p.targetAnn, 1)} %` }] });
    charts.nominal.update({ ...common, bands, series: pair(R.nominal, nk.levels.nominal), refs: [{ y: p.lowerBoundAnn, label: `${t('charts.lowerBound')} ${fmt(p.lowerBoundAnn, 2)} %` }] });
    charts.real.update({
      ...common,
      series: [...pair(R.real, nk.levels.real), { key: 'natural', label: t('charts.natural'), color: 'var(--natural)', dash: '2 4', width: 2, values: R.natural }],
      refs: [{ y: p.neutralRealAnn, label: `${t('charts.neutral')} ${fmt(p.neutralRealAnn, 1)} %` }],
    });
    const open = state.economy === 'open';
    $('#a-chart-fx').hidden = !open;
    if (open) charts.fx.update({ ...common, maxHeight: 200, series: pair(R.fx, nk.levels.fx), refs: [{ y: p.eurCzk, label: `${t('charts.fxSteady')} ${fmt(p.eurCzk, 2)}` }] });
    for (const c of Object.values(charts)) c.setCursor(state.quarter);
    $('#a-chart-legend').innerHTML = `
      <span class="legend-item">${swatch(ABM_COLOR)}${t('agents.series.abm')}</span>
      <span class="legend-item">${swatch(NK_COLOR, '7 5')}${t('agents.series.nk')}</span>
      <span class="legend-note">${t('agents.matched', { sigma: fmt(matchedParams(state.config, p).sigma, 2), kappa: fmt(matchedParams(state.config, p).kappa, 3) })}</span>`;
  }

  const swatch = (color, dash) => `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" style="stroke:${color}" stroke-width="2.25" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;

  function renderTexts() {
    $('#a-intro').innerHTML = `<h2>${t('agents.title')}</h2>${t('agents.intro').map((x) => `<p>${eqRefs(x)}</p>`).join('')}<p class="note">${t('agents.qualitative')}</p>`;
    $('.abm-head h2').textContent = t('agents.worldTitle');
    $('.abm-head .abm-qlabel').textContent = t('app.quarterTitle', { t: state.quarter });
    const dot = (color, extra = '') => `<i class="lg-dot" style="background:${color};${extra}"></i>`;
    $('#a-legend').innerHTML = `
      <div class="abm-legend-row">
        <span class="lg">${dot('var(--abm-spend)')}${t('agents.legend.spend')}</span>
        <span class="lg">${dot('var(--abm-neutral)')}${t('agents.legend.neutral')}</span>
        <span class="lg">${dot('var(--abm-save)')}${t('agents.legend.save')}</span>
        <span class="lg">${dot('var(--abm-neutral)', 'box-shadow:0 0 0 1.5px var(--ink)')}${t('agents.legend.htm')}</span>
        <span class="lg"><i class="lg-ring" style="border-color:var(--up)"></i>${t('agents.legend.priceUp')}</span>
        <span class="lg"><i class="lg-ring" style="border-color:var(--down)"></i>${t('agents.legend.priceDown')}</span>
      </div>
      <div class="abm-legend-row abm-flow-toggles" role="group" aria-label="${t('agents.legend.toggles')}">${FLOW_KINDS.filter((k) => k !== 'trade' || state.economy === 'open').map((k) => `<button type="button" class="lg lg-toggle" data-flow="${k}" aria-pressed="${!state.hiddenFlows.has(k)}"><i class="lg-arrow" style="background:var(--abm-${k})"></i>${t(`agents.flows.${k}`)}</button>`).join('')}</div>
      <p>${t('agents.legend.width')} ${t('agents.legend.hoverHint')}</p>`;
    const paras = t('agents.explain');
    const shockText = t(`agents.shockExplain.${state.shock.kind}`);
    $('#a-explain').innerHTML = `<h2>${t('sections.explain')}</h2>
      <p>${eqRefs(shockText)}</p>
      ${paras.map((x) => `<p>${eqRefs(x)}</p>`).join('')}
      ${state.policy === 'manual' ? `<p class="note">${t('agents.manualNote')}</p>` : ''}`;
  }

  function renderFlows() {
    const h = result.history[state.quarter];
    const m = result.micro[state.quarter];
    let deposits = 0, firmDebt = 0;
    for (const v of m.hhBal) deposits += v;
    for (const v of m.firmBal) firmDebt += Math.min(0, v);
    const rows = [
      ['cons', h.consumption], ['wage', h.wages], ['input', h.inputs], ['tax', h.taxes], ['benefit', h.benefits],
      ['interest', h.interest], ['dividend', h.dividends],
      ...(state.economy === 'open' ? [['imports', h.imports], ['exports', h.exports]] : []),
    ];
    const per = (v) => fmt(v / result.world.H, 3);
    $('#a-flows').innerHTML = `<h2>${t('agents.flowsTitle')} <small>${t('app.quarterTitle', { t: state.quarter })}</small></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>${t('agents.table.flow')}</th><th>${t('agents.table.total')}</th><th>${t('agents.table.perHousehold')}</th></tr></thead>
        <tbody>${rows.map(([k, v]) => `<tr><td>${t(`agents.flowsRows.${k}`)}</td><td>${fmt(v, 1)}</td><td>${per(v)}</td></tr>`).join('')}</tbody>
      </table></div>
      <ul class="facts">
        <li>${t('agents.stocks.deposits', { v: fmt(deposits, 1), d: fmt(-firmDebt, 1) })}</li>
        <li>${t('agents.stocks.state', { v: fmt(h.stateBal, 1) })}</li>
        <li>${t('agents.stocks.money', { v: fmt(h.money, 6), s: fmt(result.startMoney, 6) })}</li>
        <li>${t('agents.stocks.resets', { v: fmt(h.resets * 100, 0), p: fmt(state.config.resetProb * 100, 0) })}</li>
        <li>${t('agents.stocks.htm', { v: fmt((100 * h.htmCons) / h.consumption, 0) })}</li>
      </ul>
      <p class="numbers-note">${t('agents.unitsNote')}</p>`;
  }

  function hoverText(hit, q) {
    const m = result.micro[q];
    const w = result.world;
    if (hit.type === 'firm') {
      const j = hit.id;
      const dir = m.reset[j] > 0 ? '↑' : m.reset[j] < 0 ? '↓' : '–';
      return `<div class="tip-title">${t('agents.hover.firm', { n: j + 1 })}</div>
        <div>${t('agents.hover.price', { v: fmt(m.price[j], 3), d: dir })}</div>
        <div>${t('agents.hover.output', { v: fmt(m.output[j], 1), n: w.counts[j], h: fmt(m.hours[j] * 100, 0) })}</div>
        <div>${t('agents.hover.balance', { v: fmt(m.firmBal[j], 2) })}</div>
        ${state.economy === 'open' ? `<div>${t('agents.hover.exports', { v: fmt(m.exports[j], 2) })}</div>` : ''}`;
    }
    const k = hit.id;
    const inc = m.income[k];
    const sRate = inc > 1e-9 ? (100 * (inc - m.spend[k])) / inc : 0;
    return `<div class="tip-title">${t(w.htm[k] ? 'agents.hover.htm' : 'agents.hover.smoother', { n: k + 1, f: w.employer[k] + 1 })}</div>
      <div>${t('agents.hover.income', { w: fmt(m.wage[k], 3), tx: fmt(m.tax[k], 3), b: fmt(m.benefit[k], 3), d: fmt(m.dividend[k], 3) })}</div>
      <div>${t('agents.hover.spend', { v: fmt(m.spend[k], 3), s: fmt(sRate, 0) })}</div>
      <div>${t('agents.hover.deposits', { v: fmt(m.hhBal[k], 2) })}</div>`;
  }

  function setQuarter(q, fromUser = false) {
    state.quarter = q;
    if (fromUser) timeline.stop();
    timeline.setQuarter(q);
    view.setQuarter(q);
    for (const c of Object.values(charts)) c.setCursor(q);
    $('.abm-head .abm-qlabel').textContent = t('app.quarterTitle', { t: q });
    const lbl = root.querySelector('label[for="a-manualLevel"]');
    if (lbl) lbl.textContent = t('agents.params.manualLevel', { q });
    if (state.policy === 'manual') {
      state.manualLevel = state.manual[q] ?? state.manualLevel;
      const input = root.querySelector('#a-manualLevel');
      if (input) { input.value = state.manualLevel; root.querySelector('#a-out-manualLevel').textContent = `${fmt(state.manualLevel, 2)} % p.a.`; }
    }
    renderFlows();
  }

  function buildCharts() {
    for (const c of Object.values(charts)) c.destroy?.();
    charts = {};
    const onHover = (q) => { if (q !== null) setQuarter(q, true); };
    for (const [id, title, unit] of [
      ['gap', 'charts.gap', 'charts.gapUnit'], ['inflation', 'charts.inflation', 'charts.inflationUnit'],
      ['nominal', 'charts.nominal', 'charts.nominalUnit'], ['real', 'charts.real', 'charts.realUnit'],
      ['fx', 'charts.fx', 'charts.fxUnit'],
    ]) charts[id] = createChart($(`#a-chart-${id}`), { title: t(title), unit: t(unit), onHover });
  }

  const canvasTexts = () => ({
    bank: t('agents.nodes.bank'), cb: t('agents.nodes.cb'), state: t('agents.nodes.state'), abroad: t('agents.nodes.abroad'),
    info: (q) => {
      if (!result) return null;
      const h = result.history[q];
      return {
        cb: t('agents.nodes.cbInfo', { v: fmt(h.i + p.targetAnn, 2) }),
        state: t('agents.nodes.stateInfo', { v: fmt(h.taxes - h.benefits, 2) }),
        abroad: state.economy === 'open' ? t('agents.nodes.abroadInfo', { v: fmt(h.exports - h.imports, 2) }) : '',
      };
    },
  });

  timeline = createTimeline($('#a-timeline'), {
    onChange: (q) => setQuarter(q),
    label: (q) => t('app.quarterTitle', { t: q }),
    texts: timelineTexts,
  });
  view = createAgentsCanvas($('#a-canvas'), { onHover: hoverText, texts: canvasTexts });
  view.setActive(false);

  return {
    render() {
      buildCharts();
      timeline.render();
      renderControls();
      compute();
    },
    setActive(on) {
      state.active = on;
      view.setActive(on);
      if (!on) timeline.stop();
      if (on) view.refreshColors();
    },
  };
}
