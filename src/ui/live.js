// Live diagram panel: causal diagram, the equations with this quarter's numbers and
// a stacked bar chart per equation. Used by the shock lab and by the game review.
// All numbers come from src/model/decompose.js; this file only lays them out.

import { decomposeDisplay, causalFlows, toLevels, toOpenLevels, termsFor } from '../model/index.js';
import { createDiagram } from './diagram.js';
import { createBars } from './bars.js';
import { t, fmt, eqRefs } from './i18n.js';

const TERM_COLORS = {
  IS: {
    expX: 'var(--c-expx)', expPi: 'var(--c-exppi)', rate: 'var(--c-rate)', natural: 'var(--c-shock)',
    fx: 'var(--c-fx)', foreign: 'var(--c-foreign)',
  },
  NKPC: { exp: 'var(--c-exppi)', gap: 'var(--c-gap)', shock: 'var(--c-shock)', imported: 'var(--c-fx)' },
  UIP: {
    expQ: 'var(--c-expx)', expPi: 'var(--c-exppi)', rate: 'var(--c-rate)', foreignRate: 'var(--c-foreign)',
    premium: 'var(--c-shock)', intervention: 'var(--c-override)',
  },
  TR: { infl: 'var(--c-infl)', gap: 'var(--c-gap)', shock: 'var(--c-shock)', bound: 'var(--c-bound)', override: 'var(--c-override)' },
};
const BLOCK_VAR = { IS: 'x', NKPC: 'π', UIP: 'q', TR: 'i' };
const ALL_BLOCKS = ['IS', 'NKPC', 'UIP', 'TR'];
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
    <div class="bars-grid"><div data-bars="IS"></div><div data-bars="NKPC"></div><div data-bars="UIP"></div><div data-bars="TR"></div></div>`;
  const $ = (sel) => root.querySelector(sel);
  const diagram = createDiagram($('.live-diagram'));
  const bars = {};
  const hover = (q) => { if (q !== null) onQuarter(q); };
  for (const block of ALL_BLOCKS) {
    bars[block] = createBars(root.querySelector(`[data-bars="${block}"]`), { title: '', unit: '', onHover: hover });
  }
  const blocks = () => Object.keys(termsFor(ctx?.economy));
  $('.live-run select').addEventListener('change', (ev) => onRun?.(ev.target.value));

  let ctx = null;
  let q = 0;

  const open = () => ctx?.economy === 'open';
  function termLabel(block, key) {
    if (block === 'TR' && key === 'override') return t(`decomp.override.${ctx.context}`);
    if (open() && block === 'NKPC' && key !== 'imported') return t(`decomp.terms.NKPC_open.${key}`);
    if (open() && block === 'IS' && key === 'expX') return t('decomp.terms.IS_open.expX');
    return t(`decomp.terms.${block}.${key}`);
  }
  const blockKey = (base, block) => (open() && t(`${base}.${block}_open`) !== `${base}.${block}_open` ? `${base}.${block}_open` : `${base}.${block}`);

  function renderBreakdown() {
    if (!ctx) return;
    const rows = [];
    for (const block of blocks()) {
      const dec = ctx.dec[block];
      const total = dec.total[q];
      const unit = t(`decomp.units.${block}`);
      const terms = ctx.terms[block].map((key) => `<span class="bd-term"><i class="sw sq" style="background:${TERM_COLORS[block][key]}"></i>${termLabel(block, key)} <b>${signed(dec[key][q])}</b></span>`);
      const lead = ctx.terms[block].reduce((best, key) => (Math.abs(dec[key][q]) > Math.abs(dec[best][q]) ? key : best), ctx.terms[block][0]);
      const v = dec[lead][q];
      const driver = Math.abs(v) < 5e-3 ? t('live.calm')
        : t(v > 0 ? 'live.driverUp' : 'live.driverDown', { term: termLabel(block, lead), v: signed(v) });
      rows.push(`<div class="bd-row">
        <div class="bd-head"><span class="bd-name">${t(blockKey('live.blocks', block))}</span> <span class="bd-eq">${BLOCK_VAR[block]} = <b>${signed(total)}</b> ${unit}</span> ${eqRefs(`[[${open() && block === 'NKPC' ? 'CPI' : block}]]`)}</div>
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
    $('.live-intro').innerHTML = ctx ? eqRefs(`${t(`live.intro.${ctx.mode}`)}${open() ? ` ${t('live.introOpen')}` : ''}`) : '';
    $('.live-legend').innerHTML = `
      <span class="lg"><i class="lg-arrow up"></i>${t('live.legendUp')}</span>
      <span class="lg"><i class="lg-arrow down"></i>${t('live.legendDown')}</span>
      <span class="lg"><i class="lg-arrow info"></i>${t(`live.legendInfo.${ctx?.mode || 'rational'}`)}</span>
      <p>${t('live.legendWidth')}</p>`;
  }

  function diagramTexts() {
    const keys = ['expDemand', 'bankDemand', 'shockDemand', 'expInfl', 'demandInfl', 'shockInfl', 'inflBank', 'demandBank', 'shockBank', 'limitBank',
      'expFx', 'bankFx', 'interveneFx', 'fxInfl', 'fxDemand', 'foreignFx', 'shockFx', 'foreignDemand'];
    const arrowText = (k) => (open() && t(`diagram.arrows.${k}_open`) !== `diagram.arrows.${k}_open` ? t(`diagram.arrows.${k}_open`) : t(`diagram.arrows.${k}`));
    return {
      aria: t(open() ? 'live.ariaOpen' : 'live.aria'),
      nodes: { exp: t('diagram.nodes.exp'), demand: t('diagram.nodes.demand'), inflation: t('diagram.nodes.inflation'), bank: t('diagram.nodes.bank'), fx: t('diagram.nodes.fx') },
      nodesShort: { exp: t('diagram.nodes.exp'), demand: t('diagram.nodes.demand'), inflation: t('diagram.nodes.inflation'), bank: t('diagram.nodes.bankShort'), fx: t('diagram.nodes.fxShort') },
      nodeTips: {
        exp: t(`diagram.nodeTips.exp_${ctx.mode}`), demand: t(open() ? 'diagram.nodeTips.demand_open' : 'diagram.nodeTips.demand'),
        inflation: t(open() ? 'diagram.nodeTips.inflation_open' : 'diagram.nodeTips.inflation'), bank: t('diagram.nodeTips.bank'), fx: t(`diagram.nodeTips.fx_${ctx.mode}`),
      },
      arrows: Object.fromEntries(keys.map((k) => [k, arrowText(k)])),
      stubs: {
        shockDemand: 'rⁿ', shockInfl: 'u', shockBank: 'v', foreignFx: 'i*', shockFx: 'χ', foreignDemand: 'y*',
        bound: t('diagram.stubs.bound'), override: t(`diagram.stubs.override_${ctx.context}`),
      },
      realFx: t('diagram.realFx'),
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
      economy: ctx.economy,
      texts: diagramTexts(),
      format: (v) => signed(v),
      formatLevel: (v, d) => fmt(v, d),
    });
    diagram.setQuarter(q);
    for (const block of ALL_BLOCKS) root.querySelector(`[data-bars="${block}"]`).hidden = !blocks().includes(block);
    root.querySelector('.bars-grid').classList.toggle('four', blocks().length === 4);
    for (const block of blocks()) {
      const dec = ctx.dec[block];
      bars[block].setTitle(t(blockKey('live.bars', block)), t(`decomp.units.${block}`));
      bars[block].update({
        n: ctx.n,
        series: ctx.terms[block].map((key) => ({ key, label: termLabel(block, key), color: TERM_COLORS[block][key], values: dec[key] })),
        total: { label: t(blockKey('live.totals', block)), values: dec.total },
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
      const economy = result.economy === 'open' ? 'open' : 'closed';
      const levels = economy === 'open' ? toOpenLevels(result, params) : toLevels(result, params);
      const terms = {};
      for (const [block, keys] of Object.entries(termsFor(economy))) {
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
        economy,
        values: {
          x: Array.from(result.x), pi: levels.inflation, i: levels.nominal, r: levels.real,
          Epi: levels.expectedInflation, Ex: Array.from(result.Ex), w: result.w ? Array.from(result.w) : [],
          fx: levels.fx || [], q: levels.realFx || [],
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
