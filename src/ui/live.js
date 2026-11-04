// Live diagram panel: causal diagram, the equations with this quarter's numbers and
// a stacked bar chart per equation. Used by the shock lab and by the game review.
// All numbers come from src/model/decompose.js; this file only lays them out.

import { decomposeDisplay, causalFlows, toLevels, TERMS } from '../model/index.js';
import { createDiagram } from './diagram.js';
import { createBars } from './bars.js';
import { t, fmt, eqRefs } from './i18n.js';

const TERM_COLORS = {
  IS: { expX: 'var(--c-expx)', expPi: 'var(--c-exppi)', rate: 'var(--c-rate)', natural: 'var(--c-shock)' },
  NKPC: { exp: 'var(--c-exppi)', gap: 'var(--c-gap)', shock: 'var(--c-shock)' },
  TR: { infl: 'var(--c-infl)', gap: 'var(--c-gap)', shock: 'var(--c-shock)', bound: 'var(--c-bound)', override: 'var(--c-override)' },
};
const BLOCK_VAR = { IS: 'x', NKPC: 'π', TR: 'i' };
const signed = (v, d = 2) => (v > 0.5 * 10 ** -d ? '+' : '') + fmt(v, d);

export function createLivePanel(root, { onQuarter, onRun }) {
  root.classList.add('live');
  root.innerHTML = `
    <div class="live-head">
      <h2></h2>
      <label class="live-run" hidden><span></span><select></select></label>
    </div>
    <div class="live-intro"></div>
    <div class="live-grid">
      <div class="live-diagram"></div>
      <div class="live-side">
        <div class="live-qtitle"></div>
        <div class="live-breakdown" aria-live="polite"></div>
        <div class="live-legend"></div>
      </div>
    </div>
    <div class="bars-grid"><div data-bars="IS"></div><div data-bars="NKPC"></div><div data-bars="TR"></div></div>`;
  const $ = (sel) => root.querySelector(sel);
  const diagram = createDiagram($('.live-diagram'));
  const bars = {};
  const hover = (q) => { if (q !== null) onQuarter(q); };
  for (const block of Object.keys(TERMS)) {
    bars[block] = createBars(root.querySelector(`[data-bars="${block}"]`), { title: '', unit: '', onHover: hover });
  }
  $('.live-run select').addEventListener('change', (ev) => onRun?.(ev.target.value));

  let ctx = null;
  let q = 0;

  function termLabel(block, key) {
    if (block === 'TR' && key === 'override') return t(`decomp.override.${ctx.context}`);
    return t(`decomp.terms.${block}.${key}`);
  }

  function renderBreakdown() {
    if (!ctx) return;
    const rows = [];
    for (const block of Object.keys(TERMS)) {
      const dec = ctx.dec[block];
      const total = dec.total[q];
      const unit = t(`decomp.units.${block}`);
      const terms = ctx.terms[block].map((key) => `<span class="bd-term"><i class="sw sq" style="background:${TERM_COLORS[block][key]}"></i>${termLabel(block, key)} <b>${signed(dec[key][q])}</b></span>`);
      const lead = ctx.terms[block].reduce((best, key) => (Math.abs(dec[key][q]) > Math.abs(dec[best][q]) ? key : best), ctx.terms[block][0]);
      const v = dec[lead][q];
      const driver = Math.abs(v) < 5e-3 ? t('live.calm')
        : t(v > 0 ? 'live.driverUp' : 'live.driverDown', { term: termLabel(block, lead), v: signed(v) });
      rows.push(`<div class="bd-row">
        <div class="bd-head"><span class="bd-name">${t(`live.blocks.${block}`)}</span> <span class="bd-eq">${BLOCK_VAR[block]} = <b>${signed(total)}</b> ${unit}</span> ${eqRefs(`[[${block}]]`)}</div>
        <div class="bd-terms">${terms.join('')}</div>
        <div class="bd-driver">${driver}</div>
      </div>`);
    }
    $('.live-qtitle').textContent = ctx.quarterLabel(q);
    $('.live-breakdown').innerHTML = rows.join('');
  }

  function renderTexts() {
    $('.live-head h2').textContent = t('live.title');
    $('.live-run span').textContent = t('live.run');
    $('.live-intro').innerHTML = ctx ? eqRefs(t(`live.intro.${ctx.mode}`)) : '';
    $('.live-legend').innerHTML = `
      <span class="lg"><i class="lg-arrow up"></i>${t('live.legendUp')}</span>
      <span class="lg"><i class="lg-arrow down"></i>${t('live.legendDown')}</span>
      <span class="lg"><i class="lg-arrow info"></i>${t(`live.legendInfo.${ctx?.mode || 'rational'}`)}</span>
      <p>${t('live.legendWidth')}</p>`;
  }

  function diagramTexts() {
    const keys = ['expDemand', 'bankDemand', 'shockDemand', 'expInfl', 'demandInfl', 'shockInfl', 'inflBank', 'demandBank', 'shockBank', 'limitBank'];
    return {
      aria: t('live.aria'),
      nodes: { exp: t('diagram.nodes.exp'), demand: t('diagram.nodes.demand'), inflation: t('diagram.nodes.inflation'), bank: t('diagram.nodes.bank') },
      nodesShort: { exp: t('diagram.nodes.exp'), demand: t('diagram.nodes.demand'), inflation: t('diagram.nodes.inflation'), bank: t('diagram.nodes.bankShort') },
      nodeTips: { exp: t(`diagram.nodeTips.exp_${ctx.mode}`), demand: t('diagram.nodeTips.demand'), inflation: t('diagram.nodeTips.inflation'), bank: t('diagram.nodeTips.bank') },
      arrows: Object.fromEntries(keys.map((k) => [k, t(`diagram.arrows.${k}`)])),
      stubs: { shockDemand: 'rⁿ', shockInfl: 'u', shockBank: 'v', bound: t('diagram.stubs.bound'), override: t(`diagram.stubs.override_${ctx.context}`) },
      infoLabel: t(`diagram.info.${ctx.mode}`),
      infoTitle: t(`diagram.infoTitle.${ctx.mode}`),
      credibility: t('diagram.credibility'),
      real: t('diagram.real'),
    };
  }

  function renderAll() {
    if (!ctx) return;
    renderTexts();
    const sel = $('.live-run select');
    $('.live-run').hidden = ctx.runs.length < 2;
    sel.innerHTML = ctx.runs.map((r) => `<option value="${r.key}" ${r.key === ctx.runKey ? 'selected' : ''}>${r.label}</option>`).join('');
    diagram.update({
      flows: ctx.flows,
      maxFlow: ctx.maxFlow,
      values: ctx.values,
      limitSplit: { bound: ctx.dec.TR.bound, override: ctx.dec.TR.override },
      mode: ctx.mode,
      texts: diagramTexts(),
      format: (v) => signed(v),
      formatLevel: (v, d) => fmt(v, d),
    });
    diagram.setQuarter(q);
    for (const block of Object.keys(TERMS)) {
      const dec = ctx.dec[block];
      bars[block].setTitle(t(`live.bars.${block}`), t(`decomp.units.${block}`));
      bars[block].update({
        n: ctx.n,
        series: ctx.terms[block].map((key) => ({ key, label: termLabel(block, key), color: TERM_COLORS[block][key], values: dec[key] })),
        total: { label: t(`live.totals.${block}`), values: dec.total },
        format: (v, d) => fmt(v, d),
        quarterLabel: ctx.quarterLabel,
        xLabel: ctx.xLabel,
        tickFrom: ctx.tickFrom,
        maxHeight: 170,
      });
      bars[block].setCursor(q);
    }
    renderBreakdown();
  }

  return {
    // opts = { result, params, runs: [{key, label}], runKey, quarterLabel, xLabel?, tickFrom?,
    //          context: 'lab' | 'game' }
    update(opts) {
      const { result, params } = opts;
      const n = result.x.length;
      const dec = decomposeDisplay(result, params);
      const flows = causalFlows(dec);
      let maxFlow = 0;
      for (const arr of Object.values(flows)) for (const v of arr) maxFlow = Math.max(maxFlow, Math.abs(v));
      const levels = toLevels(result, params);
      const terms = {};
      for (const [block, keys] of Object.entries(TERMS)) {
        terms[block] = keys.filter((k) => dec[block][k].some((v) => Math.abs(v) > 1e-9));
        if (!terms[block].length) terms[block] = [keys[0]];
      }
      ctx = {
        ...opts,
        n,
        dec,
        flows,
        maxFlow,
        terms,
        mode: result.mode,
        values: {
          x: Array.from(result.x), pi: levels.inflation, i: levels.nominal, r: levels.real,
          Epi: levels.expectedInflation, Ex: Array.from(result.Ex), w: result.w ? Array.from(result.w) : [],
        },
      };
      q = Math.min(q, n - 1);
      renderAll();
    },
    setQuarter(next) {
      if (!ctx) return;
      q = Math.max(0, Math.min(ctx.n - 1, next));
      diagram.setQuarter(q);
      for (const b of Object.values(bars)) b.setCursor(q);
      renderBreakdown();
    },
    render: renderAll,
  };
}
