// Shock lab UI. All economics lives in src/model; this file only wires state,
// controls, charts and explanatory text together.

import {
  DEFAULT_PARAMS, PARAM_META, simulate, determinacy, taylorPrincipleValue,
} from '../model/index.js';
import { SCENARIOS, scenarioById, buildRuns } from '../scenarios.js';
import { createChart } from './chart.js';
import { createTimeline } from './timeline.js';
import { createLivePanel } from './live.js';
import { createGameView } from './game.js';
import { loadLocale, t, fmt, getLang, applyStatic, eqRefs, LANGS } from './i18n.js';

const MAX_PINS = 4;
const PIN_COLORS = ['var(--s3)', 'var(--s7)', 'var(--s5)', 'var(--s6)'];
const MODE_COLORS = { rational: 'var(--s1)', hybrid: 'var(--s2)' };
const ALT_DASH = '7 5';

const SHOCK_META = {
  size: { min: -8, max: 8, step: 0.25 },
  rho: { min: 0, max: 0.97, step: 0.01 },
  duration: { min: 1, max: 16, step: 1 },
  horizon: { min: 20, max: 40, step: 1 },
  delay: { min: 0, max: 8, step: 1 },
  fg: { min: 0, max: 8, step: 1 },
};

const state = {
  scenarioId: 'custom',
  params: { ...DEFAULT_PARAMS },
  settings: { ...SCENARIOS[0].defaults },
  pins: [],
  pinCounter: 0,
  quarter: 0, // timeline position, shared by the charts and the live diagram
  liveRun: null, // which run the live diagram shows
  tab: 'lab',
  openTips: new Set(),
};

const $ = (sel) => document.querySelector(sel);
const charts = {};
let lastResults = [];
let timeline = null;
let live = null;
let gameView = null;

// ---------------------------------------------------------------------------
// Persistence of per-viewer conveniences (language only).
function savedLang() {
  try { return localStorage.getItem('nk-lang'); } catch { return null; }
}
function saveLang(l) {
  try { localStorage.setItem('nk-lang', l); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Helpers

const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

function ranges(list) {
  const out = [];
  for (let k = 0; k < list.length; k++) {
    let j = k;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(j > k ? `${list[k]}–${list[j]}` : `${list[k]}`);
    k = j;
  }
  return out.join(', ');
}

function boundQuarters(res) {
  return res.atBound.map((b, q) => (b ? q : -1)).filter((q) => q >= 0);
}

function runLabel(run) {
  const s = state.settings;
  const base = t(`runs.${run.label.replace('run.', '')}`, { n: run.label === 'run.delayed' ? s.delay : s.fg });
  return `${base} · ${t(`runs.mode_${run.mode}`)}`;
}

function paramSummary(params, settings, scenario) {
  const parts = [];
  const sym = { beta: 'β', sigma: 'σ', kappa: 'κ', phiPi: 'φπ', phiX: 'φx', targetAnn: 'π*', neutralRealAnn: 'r*', lowerBoundAnn: 'LB', expDiscount: 'm', anchoring: 'w', anchorBand: 'band', anchorMemory: 'λ' };
  const ref = { ...DEFAULT_PARAMS, ...scenario.params };
  for (const k of Object.keys(sym)) {
    if (params[k] !== ref[k]) parts.push(`${sym[k]} ${fmt(params[k], decimals(PARAM_META[k].step))}`);
  }
  if (params.endogenousAnchoring !== ref.endogenousAnchoring) parts.push(params.endogenousAnchoring ? 'w↓' : 'w fix');
  const d = scenario.defaults;
  if (settings.kind !== d.kind) parts.push(settings.kind);
  if (settings.size !== d.size) parts.push(`${t('shock.size').toLowerCase()} ${fmt(settings.size, 2)}`);
  if (settings.shape === 'ar1' && settings.rho !== d.rho) parts.push(`ρ ${fmt(settings.rho, 2)}`);
  if (settings.shape !== d.shape) parts.push(t(`shock.shapes.${settings.shape}`));
  if (settings.shape === 'step' && settings.duration !== d.duration) parts.push(`${settings.duration} ${t('shock.durationUnit')}`);
  if (settings.delay !== d.delay) parts.push(`${t('extras.delay').toLowerCase()} ${settings.delay}`);
  if (settings.shape === 'step' && settings.fg !== d.fg) parts.push(`N ${settings.fg}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Controls

function infoButton(id) {
  const open = state.openTips.has(id);
  return `<button type="button" class="info" data-tip="${id}" aria-expanded="${open}" aria-controls="tip-${id}" title="${t('buttons.info')}">?</button>`;
}
function tipBox(id, html, extra = '') {
  const open = state.openTips.has(id);
  return `<div class="tip" id="tip-${id}" ${open ? '' : 'hidden'}>${html}${extra}</div>`;
}

function sliderRow({ id, label, value, meta, unit = '', tip, extra = '', group }) {
  return `<div class="ctl" data-row="${id}">
    <div class="ctl-head">
      <label for="ctl-${id}">${label}</label>
      <output id="out-${id}">${fmt(value, decimals(meta.step))}${unit ? ` ${unit}` : ''}</output>
      ${tip ? infoButton(id) : ''}
    </div>
    <input type="range" id="ctl-${id}" data-group="${group}" data-key="${id.replace(/^s-/, '')}"
      min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${value}">
    ${tip ? tipBox(id, tip, extra) : ''}
  </div>`;
}

function paramRow(key, extra = '') {
  return sliderRow({
    id: key,
    label: t(`params.${key}.label`),
    value: state.params[key],
    meta: PARAM_META[key],
    unit: t(`params.${key}.unit`) === `params.${key}.unit` ? '' : t(`params.${key}.unit`),
    tip: t(`params.${key}.tip`),
    extra,
    group: 'param',
  });
}

function settingRow(key, label, unit, tip) {
  return sliderRow({
    id: `s-${key}`, label, value: state.settings[key], meta: SHOCK_META[key], unit, tip, group: 'setting',
  });
}

function renderControls() {
  const sc = scenarioById(state.scenarioId);
  const s = state.settings;
  const mobile = window.matchMedia('(max-width: 860px)').matches;
  const openAttr = (always) => (always || !mobile ? 'open' : '');
  const advancedOpen = ['zlb', 'deanchor'].includes(sc.id) || state.settings.mode !== 'rational';

  const scenarioOptions = SCENARIOS.map((x) =>
    `<option value="${x.id}" ${x.id === sc.id ? 'selected' : ''}>${t(`scenarios.${x.id}.title`)}</option>`).join('');
  const modeButtons = ['rational', 'hybrid', 'both'].map((m) =>
    `<button type="button" data-mode="${m}" aria-pressed="${s.mode === m}">${t(`modes.${m}`)}</button>`).join('');
  const kindOptions = ['rn', 'u', 'v'].map((k) =>
    `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${t(`shock.kinds.${k}`)}</option>`).join('');
  const shapeOptions = ['ar1', 'step'].map((k) =>
    `<option value="${k}" ${k === s.shape ? 'selected' : ''}>${t(`shock.shapes.${k}`)}</option>`).join('');

  const extras = [];
  if (sc.extras.includes('delay')) {
    extras.push(settingRow('delay', t('extras.delay'), t('extras.delayUnit'), t('extras.delayTip')));
  }
  if (sc.extras.includes('fg')) {
    extras.push(settingRow('fg', t('extras.fg'), t('extras.fgUnit'), t('extras.fgTip')) +
      `<p class="ctl-note" data-row="fg-note">${t('extras.fgNeedsStep')}</p>`);
  }

  $('#controls').innerHTML = `
    <details open>
      <summary>${t('sections.scenario')}</summary>
      <div class="ctl">
        <select id="scenario" aria-label="${t('sections.scenario')}">${scenarioOptions}</select>
        <p class="scenario-short">${t(`scenarios.${sc.id}.short`)}</p>
      </div>
      <div class="ctl">
        <div class="ctl-head"><label>${t('sections.expectations')}</label>${infoButton('mode')}</div>
        <div class="seg" role="group" aria-label="${t('sections.expectations')}">${modeButtons}</div>
        ${tipBox('mode', t('modes.tip'))}
      </div>
    </details>

    <details ${openAttr(true)}>
      <summary>${t('sections.shock')}</summary>
      <div class="ctl ${sc.fixedKind ? 'disabled' : ''}">
        <div class="ctl-head"><label for="kind">${t('shock.kind')}</label></div>
        <select id="kind" ${sc.fixedKind ? 'disabled' : ''}>${kindOptions}</select>
      </div>
      ${settingRow('size', t('shock.size'), t('shock.sizeUnit'), t(`shock.sizeTip.${s.kind}`))}
      <div class="ctl ${sc.fixedShape ? 'disabled' : ''}">
        <div class="ctl-head"><label for="shape">${t('shock.shape')}</label>${infoButton('shape')}</div>
        <select id="shape" ${sc.fixedShape ? 'disabled' : ''}>${shapeOptions}</select>
        ${tipBox('shape', t('shock.shapeTip'))}
      </div>
      ${settingRow('rho', t('shock.rho'), '', t('shock.rhoTip'))}
      ${settingRow('duration', t('shock.duration'), t('shock.durationUnit'), '')}
      ${settingRow('horizon', t('shock.horizon'), t('shock.horizonUnit'), t('shock.horizonTip'))}
    </details>

    ${extras.length ? `<details open><summary>${t('sections.scenarioControls')}</summary>${extras.join('')}</details>` : ''}

    <details ${openAttr(false)}>
      <summary>${t('sections.model')}</summary>
      ${paramRow('beta')}
      ${paramRow('sigma', `<br><button type="button" class="btn small" data-set="sigma" data-value="0.2">${t('buttons.tryHall')}</button>`)}
      ${paramRow('kappa')}
    </details>

    <details ${openAttr(false)}>
      <summary>${t('sections.policy')}</summary>
      ${paramRow('phiPi')}
      ${paramRow('phiX')}
      ${paramRow('targetAnn')}
      ${paramRow('neutralRealAnn')}
      ${paramRow('lowerBoundAnn')}
    </details>

    <details ${advancedOpen && !mobile ? 'open' : ''}>
      <summary>${t('sections.advanced')}</summary>
      ${paramRow('expDiscount', `<br><button type="button" class="btn small" data-set="expDiscount" data-value="0.85">${t('buttons.tryDiscount')}</button>`)}
      ${paramRow('anchoring')}
      <div class="ctl check" data-row="endogenousAnchoring">
        <div class="ctl-head">
          <label><input type="checkbox" id="ctl-endogenousAnchoring" ${state.params.endogenousAnchoring ? 'checked' : ''}> ${t('params.endogenousAnchoring.label')}</label>
          ${infoButton('endogenousAnchoring')}
        </div>
        ${tipBox('endogenousAnchoring', t('params.endogenousAnchoring.tip'))}
      </div>
      ${paramRow('anchorBand')}
      ${paramRow('anchorMemory')}
    </details>

    <div class="reset-row">
      <button type="button" class="btn ghost" id="reset" title="${t('buttons.resetTitle')}">${t('buttons.reset')}</button>
    </div>`;
  syncControlVisibility();
}

function syncControlVisibility() {
  const s = state.settings;
  const show = (row, on) => {
    const node = document.querySelector(`[data-row="${row}"]`);
    if (node) node.hidden = !on;
  };
  show('s-rho', s.shape === 'ar1');
  show('s-duration', s.shape === 'step');
  const fgRow = document.querySelector('[data-row="s-fg"]');
  if (fgRow) {
    const ok = s.shape === 'step';
    fgRow.classList.toggle('disabled', !ok);
    fgRow.querySelector('input').disabled = !ok;
    show('fg-note', !ok);
  }
  const hybridOn = s.mode !== 'rational';
  for (const k of ['anchoring', 'endogenousAnchoring', 'anchorBand', 'anchorMemory']) {
    document.querySelector(`[data-row="${k}"]`)?.classList.toggle('disabled', !hybridOn);
  }
  for (const k of ['anchorBand', 'anchorMemory']) {
    if (!state.params.endogenousAnchoring) document.querySelector(`[data-row="${k}"]`)?.classList.add('disabled');
  }
  document.querySelector('[data-row="expDiscount"]')?.classList.toggle('disabled', s.mode === 'hybrid');
}

function setOutput(id, value, meta, unit) {
  const out = document.getElementById(`out-${id}`);
  if (out) out.textContent = `${fmt(value, decimals(meta.step))}${unit ? ` ${unit}` : ''}`;
}

function bindControls() {
  const root = $('#controls');
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.type === 'range') {
      const key = el.dataset.key;
      const v = Number(el.value);
      if (el.dataset.group === 'param') {
        state.params[key] = v;
        const unit = t(`params.${key}.unit`);
        setOutput(key, v, PARAM_META[key], unit === `params.${key}.unit` ? '' : unit);
      } else {
        state.settings[key] = v;
        const units = { size: t('shock.sizeUnit'), duration: t('shock.durationUnit'), horizon: t('shock.horizonUnit'), delay: t('extras.delayUnit'), fg: t('extras.fgUnit') };
        setOutput(`s-${key}`, v, SHOCK_META[key], units[key] || '');
      }
      refresh();
    } else if (el.id === 'ctl-endogenousAnchoring') {
      state.params.endogenousAnchoring = el.checked;
      syncControlVisibility();
      refresh();
    }
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'scenario') selectScenario(el.value);
    else if (el.id === 'kind') {
      state.settings.kind = el.value;
      renderControls();
      refresh();
    } else if (el.id === 'shape') {
      state.settings.shape = el.value;
      syncControlVisibility();
      refresh();
    }
  });
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.mode) {
      state.settings.mode = btn.dataset.mode;
      for (const b of root.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b === btn));
      syncControlVisibility();
      refresh();
    } else if (btn.dataset.tip) {
      const id = btn.dataset.tip;
      const box = document.getElementById(`tip-${id}`);
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) state.openTips.add(id); else state.openTips.delete(id);
    } else if (btn.dataset.set) {
      setParam(btn.dataset.set, Number(btn.dataset.value));
    } else if (btn.id === 'reset') {
      selectScenario(state.scenarioId);
    }
  });
}

function setParam(key, value) {
  state.params[key] = value;
  const input = document.getElementById(`ctl-${key}`);
  if (input) input.value = value;
  const unit = t(`params.${key}.unit`);
  setOutput(key, value, PARAM_META[key], unit === `params.${key}.unit` ? '' : unit);
  refresh();
}

function selectScenario(id) {
  const sc = scenarioById(id);
  state.scenarioId = sc.id;
  state.params = { ...DEFAULT_PARAMS, ...sc.params };
  state.settings = { ...sc.defaults };
  renderControls();
  refresh();
}

// ---------------------------------------------------------------------------
// Equations

function equationsHtml(mode = state.settings.mode, m = state.params.expDiscount) {
  const mTxt = m !== 1 && mode !== 'hybrid' ? `<b>m</b>·` : '';
  const eqs = [
    ['IS', `x<sub>t</sub> = ${mTxt}E<sub>t</sub>x<sub>t+1</sub> − σ (i<sub>t</sub> − E<sub>t</sub>π<sub>t+1</sub> − r<sup>n</sup><sub>t</sub>)`],
    ['NKPC', `π<sub>t</sub> = β${mTxt ? '·' + mTxt : ''}E<sub>t</sub>π<sub>t+1</sub> + κ x<sub>t</sub> + u<sub>t</sub>`],
    ['TR', `i<sub>t</sub> = max( i<sub>LB</sub> , φ<sub>π</sub>π<sub>t</sub> + φ<sub>x</sub>x<sub>t</sub> + v<sub>t</sub> )`],
    ['E', `E<sub>t</sub>π<sub>t+1</sub> = w<sub>t</sub>·π* + (1 − w<sub>t</sub>)·π<sub>t−1</sub> ,&nbsp;&nbsp; E<sub>t</sub>x<sub>t+1</sub> = x<sub>t−1</sub>`],
  ];
  return `<div class="eqs">${eqs.map(([id, math]) => `
      <div class="eq ${id === 'E' && mode === 'rational' ? 'off' : ''}" data-eqrow="${id}">
        <div class="eq-tag">(${id})</div>
        <div class="eq-math">${math}</div>
        <div class="eq-desc">${t(`equations.${id}`)}</div>
      </div>`).join('')}
    </div>`;
}

function renderEquations() {
  $('#equations').innerHTML = `<h2>${t('sections.equations')}</h2>
    ${equationsHtml()}
    <p class="eq-levels">${t('equations.levels')}</p>`;
}

const activeView = () => document.getElementById(state.tab === 'game' ? 'view-game' : 'view-lab');

function highlightEq(id, on) {
  for (const row of activeView().querySelectorAll('[data-eqrow]')) {
    row.classList.toggle('hl', on && row.dataset.eqrow === id);
  }
}

// ---------------------------------------------------------------------------
// Simulation + rendering

function computeResults() {
  const sc = scenarioById(state.scenarioId);
  const built = sc.build({ ...state.params }, { ...state.settings });
  const runs = buildRuns(built, state.settings.mode);
  return runs.map((run) => ({ ...run, res: simulate(run.spec, run.mode) }));
}

function seriesFor(results, pins, key, extra = []) {
  const out = [];
  for (const r of results) {
    if (!r.res.determinate) continue;
    const values = key === 'w' ? r.res.w : r.res.levels[key];
    if (!values) continue;
    out.push({
      key: r.key,
      label: runLabel(r),
      color: MODE_COLORS[r.mode],
      dash: r.variant === 'alt' ? ALT_DASH : null,
      width: r.variant === 'alt' ? 1.75 : 2.25,
      values,
    });
  }
  for (const p of pins) {
    const values = key === 'w' ? p.w : p.levels[key];
    if (!values) continue;
    out.push({ key: p.id, label: pinLabel(p), color: p.color, width: 1.75, values });
  }
  return out.concat(extra);
}

function pinLabel(p) {
  return `${t('runs.pinPrefix', { n: p.num })} · ${t(`runs.mode_${p.mode}`)}`;
}

function refresh() {
  const results = computeResults();
  const s = state.settings;
  const p = state.params;
  const n = s.horizon;
  const det = determinacy(p);
  // With the current parameters indeterminate, no rational path is drawn at all
  // (not even a comparison run that happens to be determinate).
  const valid = results.filter((r) => r.res.determinate && (det.determinate || r.mode !== 'rational'));
  lastResults = valid;
  const primary = valid[0];
  const quarterLabel = (q) => t('app.quarterTitle', { t: q });
  const format = (v, d) => fmt(v, d);
  const pins = state.pins;

  // Determinacy box
  const showDet = !det.determinate && s.mode !== 'hybrid';
  const detBox = $('#determinacy');
  detBox.hidden = !showDet;
  if (showDet) {
    const th = 1 - ((1 - p.beta) * p.phiX) / p.kappa;
    detBox.innerHTML = `<h2>${t('determinacy.title')}</h2>
      <p>${t('determinacy.body1', { v: fmt(taylorPrincipleValue(p), 4), th: fmt(th, 2) })}</p>
      <p>${t('determinacy.body2')}</p>
      <p>${t('determinacy.body3', { eig: det.moduli.map((r) => fmt(r, 3)).join(' / ') })}</p>
      ${p.expDiscount !== 1 ? `<p>${t('determinacy.discountNote')}</p>` : ''}
      ${s.mode === 'both' ? `<p>${t('determinacy.hybridNote')}</p>` : ''}
      <button type="button" class="btn small" id="fix-det">${t('buttons.fixDeterminacy')}</button>`;
    detBox.querySelector('#fix-det').onclick = () => setParam('phiPi', 1.5);
  }

  // Charts
  const bandsFrom = primary ? ranges(boundQuarters(primary.res)) : '';
  const bands = [];
  if (primary) {
    const q = boundQuarters(primary.res);
    for (let k = 0; k < q.length; k++) {
      let j = k;
      while (j + 1 < q.length && q[j + 1] === q[j] + 1) j++;
      bands.push([q[k], q[j]]);
      k = j;
    }
  }
  const naturalSeries = primary ? [{
    key: 'natural', label: t('charts.natural'), color: 'var(--natural)', dash: '2 4', width: 2, values: primary.res.levels.natural,
  }] : [];
  const common = { n, format, quarterLabel };
  charts.gap.update({ ...common, series: seriesFor(valid, pins, 'gap'), refs: [] });
  charts.inflation.update({ ...common, series: seriesFor(valid, pins, 'inflation'), refs: [{ y: p.targetAnn, label: `${t('charts.target')} ${fmt(p.targetAnn, 1)} %` }] });
  charts.nominal.update({ ...common, series: seriesFor(valid, pins, 'nominal'), bands, refs: [{ y: p.lowerBoundAnn, label: `${t('charts.lowerBound')} ${fmt(p.lowerBoundAnn, 2)} %` }] });
  charts.real.update({ ...common, series: seriesFor(valid, pins, 'real', naturalSeries), refs: [{ y: p.neutralRealAnn, label: `${t('charts.neutral')} ${fmt(p.neutralRealAnn, 1)} %` }] });
  const anchorRuns = p.endogenousAnchoring ? valid.filter((r) => r.mode === 'hybrid') : [];
  const anchorSeries = seriesFor(anchorRuns, pins.filter((x) => x.endogenous), 'w');
  const anchorEl = $('#chart-anchoring');
  anchorEl.hidden = anchorSeries.length === 0;
  if (anchorSeries.length) {
    charts.anchoring.update({ ...common, series: anchorSeries, refs: [], yDomain: [0, 1], maxHeight: 190 });
  }
  timeline.setN(n);
  state.quarter = Math.min(state.quarter, n - 1);
  for (const c of Object.values(charts)) c.setCursor(state.quarter);
  updateLive(valid);

  renderLegend(valid, primary, bands.length > 0);
  renderStatus(results);
  renderExplain(valid, bandsFrom);
  renderNumbers(valid);
  renderEquations();
  $('#pin').disabled = valid.length === 0;
  $('#clear-pins').disabled = state.pins.length === 0;
}

function lineSwatch(color, dash, width = 2.25) {
  return `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" style="stroke:${color}" stroke-width="${width}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;
}

function renderLegend(valid, primary, hasBands) {
  const items = valid.map((r) => `<span class="legend-item">${lineSwatch(MODE_COLORS[r.mode], r.variant === 'alt' ? ALT_DASH : null)}${runLabel(r)}</span>`);
  for (const p of state.pins) {
    items.push(`<span class="legend-item" title="${p.summary}">${lineSwatch(p.color, null, 1.75)}${pinLabel(p)}${p.summary ? ` <span class="legend-note">(${p.summary})</span>` : ''}<button type="button" class="unpin" data-unpin="${p.id}" aria-label="${t('buttons.unpin')}" title="${t('buttons.unpin')}">×</button></span>`);
  }
  if (primary) items.push(`<span class="legend-item">${lineSwatch('var(--natural)', '2 4', 2)}${t('charts.natural')}</span>`);
  if (hasBands) items.push(`<span class="legend-note">${t('charts.atBound')}</span>`);
  $('#legend').innerHTML = items.join('');
}

function renderStatus(results) {
  const lines = [];
  const seen = new Set();
  for (const r of results) {
    if (!r.res.determinate || r.variant !== 'main' || seen.has(r.mode)) continue;
    seen.add(r.mode);
    const res = r.res;
    const prefix = results.some((x) => x.mode !== r.mode) ? t('status.modeLabel', { mode: t(`modes.${r.mode}`) }) : '';
    let text = res.method === 'muc' ? t('status.muc')
      : res.method === 'pf' ? t('status.pf', { T: res.T }) : t('status.forward');
    if (res.method === 'pf' && boundQuarters(res).length) text += ` ${t('status.pfBound', { iter: res.iterations })}`;
    lines.push(`<div class="ok">${prefix}${text} ${t('status.residual', { r: res.residual.toExponential(1) })}</div>`);
    if (!res.converged) lines.push(`<div class="bad">${t('status.nonconv')}</div>`);
    if (res.stable === false) lines.push(`<div class="bad">${t('status.unstable')}</div>`);
  }
  $('#status').innerHTML = lines.join('');
}

function renderExplain(valid, boundList) {
  const sc = scenarioById(state.scenarioId);
  const s = state.settings;
  const paras = sc.id === 'custom' ? t(`explain.custom.${s.kind}`) : t(`scenarios.${sc.id}.explain`);
  const notes = [];
  if (s.mode === 'hybrid' && sc.id !== 'deanchor') notes.push(t('explain.mode.hybrid'));
  if (s.mode === 'both') notes.push(t('explain.mode.both'));
  if (boundList) notes.push(t('explain.note.bound', { lb: fmt(state.params.lowerBoundAnn, 2), list: boundList }));
  if (s.delay > 0 && sc.id !== 'deanchor') notes.push(t('explain.note.delay', { n: s.delay }));
  if (state.params.expDiscount !== 1 && s.mode !== 'hybrid') notes.push(t('explain.note.discount', { m: fmt(state.params.expDiscount, 2) }));
  $('#explain').innerHTML = `<h2>${t('sections.explain')}<small>${t(`scenarios.${sc.id}.title`)}: ${t(`scenarios.${sc.id}.short`)}</small></h2>
    ${(Array.isArray(paras) ? paras : []).map((x) => `<p>${eqRefs(x)}</p>`).join('')}
    ${notes.map((x) => `<p class="note">${eqRefs(x)}</p>`).join('')}`;
}

function stats(levels, atBound, p) {
  const n = levels.gap.length;
  let gapExt = 0, inflExt = p.targetAnn, rmin = Infinity, rmax = -Infinity, loss = 0;
  for (let k = 0; k < n; k++) {
    if (Math.abs(levels.gap[k]) > Math.abs(gapExt)) gapExt = levels.gap[k];
    if (Math.abs(levels.inflation[k] - p.targetAnn) > Math.abs(inflExt - p.targetAnn)) inflExt = levels.inflation[k];
    rmin = Math.min(rmin, levels.nominal[k]);
    rmax = Math.max(rmax, levels.nominal[k]);
    loss += (levels.inflation[k] - p.targetAnn) ** 2 + 0.5 * levels.gap[k] ** 2;
  }
  return { gapExt, inflExt, rmin, rmax, loss, bound: atBound ? atBound.filter(Boolean).length : 0 };
}

function renderNumbers(valid) {
  const rows = valid.map((r) => ({
    swatch: lineSwatch(MODE_COLORS[r.mode], r.variant === 'alt' ? ALT_DASH : null),
    label: runLabel(r),
    st: stats(r.res.levels, r.res.atBound, state.params),
  }));
  for (const p of state.pins) rows.push({ swatch: lineSwatch(p.color, null, 1.75), label: pinLabel(p), st: p.stats });
  $('#numbers').innerHTML = `<h2>${t('sections.numbers')}</h2>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${t('numbers.run')}</th><th>${t('numbers.gapExt')}</th><th>${t('numbers.inflExt')}</th>
        <th>${t('numbers.rateMin')}</th><th>${t('numbers.rateMax')}</th><th>${t('numbers.atBound')}</th>
        <th title="${t('numbers.lossTip')}">${t('numbers.loss')}</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.swatch}${r.label}</td>
        <td>${fmt(r.st.gapExt, 2)} %</td><td>${fmt(r.st.inflExt, 2)} %</td>
        <td>${fmt(r.st.rmin, 2)} %</td><td>${fmt(r.st.rmax, 2)} %</td>
        <td>${r.st.bound}</td><td>${fmt(r.st.loss, 1)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="numbers-note">${t('numbers.lossTip')}</p>`;
}

// ---------------------------------------------------------------------------
// Timeline + live diagram

function setQuarter(q, fromUser = false) {
  state.quarter = q;
  if (fromUser) timeline.stop();
  timeline.setQuarter(q);
  for (const c of Object.values(charts)) c.setCursor(q);
  live.setQuarter(q);
}

function updateLive(valid) {
  const card = $('#live');
  card.hidden = valid.length === 0;
  if (!valid.length) return;
  const run = valid.find((r) => r.key === state.liveRun) || valid[0];
  state.liveRun = run.key;
  live.update({
    result: run.res,
    params: { ...state.params, ...(run.spec.params || {}) },
    runs: valid.map((r) => ({ key: r.key, label: runLabel(r) })),
    runKey: run.key,
    quarterLabel: (q) => t('app.quarterTitle', { t: q }),
    context: 'lab',
  });
  live.setQuarter(state.quarter);
}

const timelineTexts = () => ({
  play: t('timeline.play'), pause: t('timeline.pause'), back: t('timeline.back'),
  forward: t('timeline.forward'), start: t('timeline.start'), slider: t('timeline.slider'),
});

// ---------------------------------------------------------------------------
// Tabs

function showTab(tab, push = true) {
  state.tab = tab === 'game' ? 'game' : 'lab';
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  $('#view-lab').hidden = state.tab !== 'lab';
  $('#view-game').hidden = state.tab !== 'game';
  if (state.tab !== 'lab') timeline.stop();
  if (push) {
    try { history.replaceState(null, '', state.tab === 'game' ? '#game' : '#lab'); } catch { /* not allowed */ }
  }
}

// ---------------------------------------------------------------------------
// Pins

function pinCurrent() {
  const sc = scenarioById(state.scenarioId);
  const mains = lastResults.filter((r) => r.res.determinate && r.variant === 'main');
  if (state.pins.length + mains.length > MAX_PINS) {
    state.pins.splice(0, state.pins.length + mains.length - MAX_PINS);
  }
  const used = new Set(state.pins.map((p) => p.color));
  for (const r of mains) {
    const color = PIN_COLORS.find((c) => !used.has(c)) || PIN_COLORS[0];
    used.add(color);
    state.pinCounter += 1;
    state.pins.push({
      id: `pin-${state.pinCounter}`,
      num: state.pinCounter,
      mode: r.mode,
      color,
      levels: r.res.levels,
      w: r.res.w,
      endogenous: r.mode === 'hybrid' && state.params.endogenousAnchoring,
      stats: stats(r.res.levels, r.res.atBound, state.params),
      summary: `${t(`scenarios.${sc.id}.title`)}${paramSummary(state.params, state.settings, sc) ? ' · ' + paramSummary(state.params, state.settings, sc) : ''}`,
    });
  }
  refresh();
}

// ---------------------------------------------------------------------------
// Boot

function createCharts() {
  // Hovering a chart moves the shared timeline (leaving it keeps the position).
  const onHover = (q) => { if (q !== null) setQuarter(q, true); };
  const defs = [
    ['gap', 'charts.gap', 'charts.gapUnit'],
    ['inflation', 'charts.inflation', 'charts.inflationUnit'],
    ['nominal', 'charts.nominal', 'charts.nominalUnit'],
    ['real', 'charts.real', 'charts.realUnit'],
    ['anchoring', 'charts.anchoring', 'charts.anchoringUnit'],
  ];
  for (const [id, title, unit] of defs) {
    if (charts[id]) charts[id].setTitle(t(title), t(unit));
    else charts[id] = createChart(document.getElementById(`chart-${id}`), { title: t(title), unit: t(unit), onHover });
  }
}

async function setLanguage(l) {
  await loadLocale(l);
  saveLang(l);
  applyStatic();
  createCharts();
  timeline.render();
  renderControls();
  refresh();
  gameView.render();
}

function bindGlobal() {
  $('#lang').addEventListener('click', () => {
    const next = getLang() === 'cs' ? 'en' : 'cs';
    setLanguage(next);
  });
  $('#pin').addEventListener('click', pinCurrent);
  $('#clear-pins').addEventListener('click', () => { state.pins = []; refresh(); });
  $('#legend').addEventListener('click', (ev) => {
    const id = ev.target.closest('[data-unpin]')?.dataset.unpin;
    if (!id) return;
    state.pins = state.pins.filter((p) => p.id !== id);
    refresh();
  });
  // Equation references in texts highlight the equation of the visible view.
  const content = document.body;
  content.addEventListener('mouseover', (ev) => {
    const ref = ev.target.closest('.eqref');
    if (ref) highlightEq(ref.dataset.eq, true);
  });
  content.addEventListener('mouseout', (ev) => {
    if (ev.target.closest('.eqref')) highlightEq(null, false);
  });
  content.addEventListener('click', (ev) => {
    const ref = ev.target.closest('.eqref');
    if (!ref) return;
    highlightEq(ref.dataset.eq, true);
    activeView().querySelector(`[data-eqrow="${ref.dataset.eq}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => highlightEq(null, false), 1800);
  });
  content.addEventListener('focusin', (ev) => {
    const ref = ev.target.closest('.eqref');
    if (ref) highlightEq(ref.dataset.eq, true);
  });
  content.addEventListener('focusout', (ev) => {
    if (ev.target.closest('.eqref')) highlightEq(null, false);
  });
  $('.tabs').addEventListener('click', (ev) => {
    const tab = ev.target.closest('[data-tab]')?.dataset.tab;
    if (tab) showTab(tab);
  });
  $('.tabs').addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const next = state.tab === 'lab' ? 'game' : 'lab';
    showTab(next);
    document.getElementById(`tab-${next}`).focus();
  });
  window.addEventListener('hashchange', () => showTab(location.hash === '#game' ? 'game' : 'lab', false));
  document.addEventListener('keydown', (ev) => {
    if (state.tab === 'game' && gameView.handleKey(ev)) ev.preventDefault();
  });
}

async function main() {
  const stored = savedLang();
  await loadLocale(LANGS.includes(stored) ? stored : 'cs');
  applyStatic();
  createCharts();
  timeline = createTimeline($('#timeline'), {
    onChange: (q) => setQuarter(q),
    label: (q) => t('app.quarterTitle', { t: q }),
    texts: timelineTexts,
  });
  live = createLivePanel($('#live'), {
    onQuarter: (q) => setQuarter(q, true),
    onRun: (key) => { state.liveRun = key; updateLive(lastResults); },
  });
  gameView = createGameView($('#view-game'), { equationsHtml: () => equationsHtml('hybrid', 1) });
  gameView.setTimelineTexts(timelineTexts);
  bindControls();
  bindGlobal();
  renderControls();
  refresh();
  gameView.render();
  showTab(location.hash === '#game' ? 'game' : 'lab', false);
}

main();
