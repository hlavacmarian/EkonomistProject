// "Be the central bank" game screen: setup, one decision per quarter, review.
// The game logic lives in src/game; this file only renders it.

import {
  createGame, observe, submitRate, isOver, evaluateGame, clampRate, RATE_STEP,
  GAME_DEFAULTS, GAME_LENGTH, DIFFICULTY, LOSS_WEIGHTS, NOISE, RULES,
} from '../game/index.js';
import { createChart } from './chart.js';
import { createTimeline } from './timeline.js';
import { createLivePanel } from './live.js';
import { t, fmt, eqRefs } from './i18n.js';

const RUN_COLORS = { player: 'var(--s1)', autopilot: 'var(--s3)', dataRule: 'var(--s7)' };
const RUN_DASH = { player: null, autopilot: '7 5', dataRule: '2 4' };
const SETTINGS_KEY = 'nk-game-settings';
const signed = (v, d = 2) => (v > 0.5 * 10 ** -d ? '+' : '') + fmt(v, d);
const swatch = (color, dash) => `<svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" style="stroke:${color}" stroke-width="2.25" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      length: Number.isInteger(s.length) && s.length >= GAME_LENGTH.min && s.length <= GAME_LENGTH.max ? s.length : GAME_DEFAULTS.length,
      difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : GAME_DEFAULTS.difficulty,
      seed: Number.isInteger(s.seed) && s.seed > 0 ? s.seed : GAME_DEFAULTS.seed,
      economy: s.economy === 'open' ? 'open' : 'closed',
    };
  } catch {
    return { length: GAME_DEFAULTS.length, difficulty: GAME_DEFAULTS.difficulty, seed: GAME_DEFAULTS.seed, economy: 'closed' };
  }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function createGameView(root, { equationsHtml }) {
  const ui = {
    phase: 'setup',
    settings: loadSettings(),
    game: null,
    rate: null,
    ev: null,
    openTips: new Set(),
    quarter: 0,
    liveRun: 'player',
  };
  let charts = [];
  let timeline = null;
  let live = null;

  const W = () => ui.game.warmup;
  const open = () => ui.game?.config.economy === 'open';
  const qNum = (k) => k - W() + 1;
  const xLabel = (k) => String(qNum(k));
  const quarterLabel = (k) => (k < W() ? t('game.qHistory', { q: qNum(k) }) : t('game.qGame', { q: qNum(k), n: ui.game.config.length }));
  const format = (v, d) => fmt(v, d);

  function destroyCharts() {
    for (const c of charts) c.destroy?.();
    charts = [];
    timeline?.stop();
    timeline = null;
    live = null;
  }

  function infoButton(id) {
    return `<button type="button" class="info" data-tip="${id}" aria-expanded="${ui.openTips.has(id)}" aria-controls="gtip-${id}" title="${t('buttons.info')}">?</button>`;
  }
  function tipBox(id, html) {
    return `<div class="tip" id="gtip-${id}" ${ui.openTips.has(id) ? '' : 'hidden'}>${html}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Setup

  function renderSetup() {
    const s = ui.settings;
    const diffButtons = Object.keys(DIFFICULTY).map((d) =>
      `<button type="button" data-diff="${d}" aria-pressed="${s.difficulty === d}">${t(`game.difficulty.${d}`)}</button>`).join('');
    root.innerHTML = `
      <div class="game-grid">
        <section class="card game-setup">
          <h2>${t('game.title')}</h2>
          <p class="lead">${t('game.lead')}</p>
          <ul class="rules">${t('game.rules').map((r) => `<li>${eqRefs(r)}</li>`).join('')}</ul>
          <div class="ctl">
            <div class="ctl-head"><label for="g-length">${t('game.length')}</label><output id="g-length-out">${s.length} ${t('game.qUnit')}</output>${infoButton('length')}</div>
            <input type="range" id="g-length" min="${GAME_LENGTH.min}" max="${GAME_LENGTH.max}" step="${GAME_LENGTH.step}" value="${s.length}">
            ${tipBox('length', t('game.lengthTip'))}
          </div>
          <div class="ctl">
            <div class="ctl-head"><label>${t('economy.label')}</label>${infoButton('economy')}</div>
            <div class="seg" role="group" aria-label="${t('economy.label')}">${['closed', 'open'].map((e) =>
    `<button type="button" data-geconomy="${e}" aria-pressed="${s.economy === e}">${t(`economy.${e}`)}</button>`).join('')}</div>
            ${tipBox('economy', t('game.economyTip'))}
          </div>
          <div class="ctl">
            <div class="ctl-head"><label>${t('game.difficultyLabel')}</label>${infoButton('difficulty')}</div>
            <div class="seg" role="group" aria-label="${t('game.difficultyLabel')}">${diffButtons}</div>
            ${tipBox('difficulty', t('game.difficultyTip', { easy: fmt(DIFFICULTY.easy, 2), hard: fmt(DIFFICULTY.hard, 2) }))}
          </div>
          <div class="ctl">
            <div class="ctl-head"><label for="g-seed">${t('game.seed')}</label>${infoButton('seed')}</div>
            <div class="seed-row">
              <input type="number" id="g-seed" min="1" max="999999" step="1" value="${s.seed}" inputmode="numeric">
              <button type="button" class="btn ghost" id="g-dice">${t('game.randomSeed')}</button>
            </div>
            ${tipBox('seed', t('game.seedTip'))}
          </div>
          <button type="button" class="btn big" id="g-start">${t('game.start')}</button>
        </section>
        <section class="card game-explain">
          <h2>${t('sections.explain')}</h2>
          ${t('game.explain').map((x) => `<p>${eqRefs(x)}</p>`).join('')}
          <p class="note">${t('game.lossNote', { wg: fmt(LOSS_WEIGHTS.gap, 2), wr: fmt(LOSS_WEIGHTS.rate, 2) })}</p>
          <div class="game-eqs">${equationsHtml(ui.settings.economy)}</div>
        </section>
      </div>`;
  }

  function start(seed = ui.settings.seed) {
    ui.settings.seed = seed;
    saveSettings(ui.settings);
    ui.game = createGame({ seed, length: ui.settings.length, difficulty: ui.settings.difficulty, economy: ui.settings.economy });
    ui.rate = clampRate(observe(ui.game).lastRate, ui.game.params);
    ui.ev = null;
    ui.phase = 'play';
    render();
    root.querySelector('#g-submit')?.focus();
  }

  // ---------------------------------------------------------------------------
  // Play

  function renderPlay() {
    root.innerHTML = `
      <div class="game-grid play">
        <section class="card decision" id="g-decision"></section>
        <section class="g-observed">
          <p class="g-observed-note">${t('game.observedNote', { gi: fmt(NOISE.inflation, 1), gx: fmt(NOISE.gap, 1) })}</p>
          <div class="charts">
            <div id="g-c-inflation"></div><div id="g-c-gap"></div>
            <div id="g-c-rate"></div><div id="g-c-expect"></div>
            ${open() ? '<div id="g-c-fx" class="wide"></div>' : ''}
          </div>
        </section>
      </div>`;
    const defs = [
      ['inflation', 'game.charts.inflationSeen', 'charts.inflationUnit'],
      ['gap', 'game.charts.gapSeen', 'charts.gapUnit'],
      ['rate', 'game.charts.rateYours', 'charts.nominalUnit'],
      ['expect', 'game.charts.expectSeen', 'charts.inflationUnit'],
      ...(open() ? [['fx', 'game.charts.fxSeen', 'charts.fxUnit']] : []),
    ];
    charts = defs.map(([id, title, unit]) => {
      const c = createChart(root.querySelector(`#g-c-${id}`), { title: t(title), unit: t(unit), onHover: () => {} });
      c.id = id;
      return c;
    });
    updatePlay();
  }

  function updatePlay() {
    const g = ui.game;
    const o = observe(g);
    const p = g.params;
    const last = o.history.at(-1);
    const T = g.T;
    const series = (key) => {
      const arr = new Array(T).fill(NaN);
      for (const h of o.history) arr[h.k] = h[key];
      return arr;
    };
    const common = { n: T, format, quarterLabel, xLabel, tickFrom: W(), bands: [[0, W() - 1, 'hist']] };
    const lineOf = (key, label) => [{ key, label, color: 'var(--s1)', values: series(key), width: 2 }];
    for (const c of charts) {
      if (c.id === 'inflation') c.update({ ...common, series: lineOf('inflation', t('game.charts.seen')), refs: [{ y: p.targetAnn, label: `${t('charts.target')} ${fmt(p.targetAnn, 1)} %` }], hbands: [{ from: p.targetAnn - RULES.band, to: p.targetAnn + RULES.band }] });
      if (c.id === 'gap') c.update({ ...common, series: lineOf('gap', t('game.charts.seen')), refs: [] });
      if (c.id === 'rate') c.update({ ...common, series: lineOf('rate', t('game.charts.yourRate')), refs: [{ y: p.lowerBoundAnn, label: `${t('charts.lowerBound')} ${fmt(p.lowerBoundAnn, 2)} %` }, { y: o.neutral, label: `${t('game.neutral')} ${fmt(o.neutral, 1)} %` }] });
      if (c.id === 'expect') c.update({ ...common, series: lineOf('expectations', t('game.charts.survey')), refs: [{ y: p.targetAnn, label: `${t('charts.target')} ${fmt(p.targetAnn, 1)} %` }] });
      if (c.id === 'fx') c.update({ ...common, maxHeight: 200, series: lineOf('fx', t('game.charts.fxMarket')), refs: [{ y: p.eurCzk, label: `${t('charts.fxSteady')} ${fmt(p.eurCzk, 2)}` }] });
    }

    const move = ui.rate - o.lastRate;
    const atBound = ui.rate <= p.lowerBoundAnn + 1e-9;
    const news = o.news ? t(`game.news.${o.news.kind}_${o.news.sign > 0 ? 'up' : 'down'}`) : t('game.news.none');
    const pct = ((o.quarter - 1) / o.length) * 100;
    root.querySelector('#g-decision').innerHTML = `
      <div class="g-progress">
        <div class="g-q">${t('game.quarterOf', { q: o.quarter, n: o.length })}</div>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${o.length}" aria-valuenow="${o.quarter - 1}"><i style="width:${pct}%"></i></div>
      </div>
      <div class="g-news ${o.news ? 'hot' : ''}"><span class="g-news-tag">${t('game.newsTag')}</span> ${news}</div>
      <div class="g-latest">
        <h3>${t('game.latest', { q: qNum(o.t - 1) })}</h3>
        <dl>
          <dt>${t('game.data.inflation')}</dt><dd>${fmt(last.inflation, 1)} % <small>${t('game.data.vsTarget', { d: signed(last.inflation - p.targetAnn, 1) })}</small></dd>
          <dt>${t('game.data.gap')}</dt><dd>${fmt(last.gap, 1)} %</dd>
          <dt>${t('game.data.expectations')}</dt><dd>${fmt(last.expectations, 1)} %</dd>
          <dt>${t('game.data.lastRate')}</dt><dd>${fmt(o.lastRate, 2)} %</dd>
          ${open() ? `<dt>${t('game.data.fx')}</dt><dd>${fmt(last.fx, 2)} <small>CZK/EUR</small></dd>` : ''}
        </dl>
      </div>
      <div class="g-rate">
        <label for="g-rate-out">${t('game.setRate', { q: o.quarter })}</label>
        <div class="stepper">
          <button type="button" class="btn ghost" data-d="-1" aria-label="−1 p. b.">−1</button>
          <button type="button" class="btn ghost" data-d="-0.25" aria-label="−0,25 p. b." ${atBound ? 'disabled' : ''}>−¼</button>
          <output id="g-rate-out" aria-live="polite">${fmt(ui.rate, 2)} %</output>
          <button type="button" class="btn ghost" data-d="0.25" aria-label="+0,25 p. b.">+¼</button>
          <button type="button" class="btn ghost" data-d="1" aria-label="+1 p. b.">+1</button>
        </div>
        <div class="g-delta">${Math.abs(move) < 1e-9 ? t('game.noChange') : t('game.change', { d: signed(move, 2) })}${atBound ? ` · ${t('game.atBound')}` : ''}</div>
      </div>
      <button type="button" class="btn big" id="g-submit">${o.quarter === o.length ? t('game.submitLast') : t('game.submit')}</button>
      <p class="ctl-note">${t('game.keys')}</p>
      <button type="button" class="btn ghost small" id="g-quit">${t('game.quit')}</button>`;
  }

  function changeRate(delta) {
    if (ui.phase !== 'play') return;
    const focused = document.activeElement?.dataset?.d;
    ui.rate = clampRate(ui.rate + delta, ui.game.params);
    updatePlay();
    // The panel is re-rendered: keep keyboard focus where it was.
    const again = focused && root.querySelector(`[data-d="${focused}"]`);
    if (again && !again.disabled) again.focus();
    else if (focused) root.querySelector('#g-submit')?.focus();
  }

  function submit() {
    if (ui.phase !== 'play') return;
    ui.game = submitRate(ui.game, ui.rate);
    if (isOver(ui.game)) {
      ui.ev = evaluateGame(ui.game);
      ui.phase = 'done';
      ui.quarter = W();
      ui.liveRun = 'player';
      render();
      root.querySelector('.verdict')?.scrollIntoView({ block: 'start' });
      return;
    }
    updatePlay();
    root.querySelector('#g-submit')?.focus();
  }

  // ---------------------------------------------------------------------------
  // Review

  function verdict(ev) {
    const P = ev.loss.player.total, A = ev.loss.autopilot.total, D = ev.loss.dataRule.total;
    const worst = Math.max(...ev.levels.player.inflation.slice(W()).map((v) => Math.abs(v - ui.game.params.targetAnn)));
    const ratio = P / Math.max(A, 1e-9);
    const key = worst > 10 ? 'lost' : ratio <= 1 ? 'better' : ratio <= 1.25 ? 'close' : ratio <= 2 ? 'worse' : 'muchWorse';
    const vsData = P <= D ? t('game.verdict.beatData', { d: fmt(D, 1) }) : t('game.verdict.lostData', { d: fmt(D, 1) });
    const fired = ev.fired
      ? `${t(`game.fired.${ev.fired.reason}`, { q: `Q${qNum(ev.fired.k)}`, v: fmt(ev.fired.value, 1), n: ui.game.config.length })} `
      : '';
    const main = ev.fired ? t('game.verdict.firedLoss', { p: fmt(P, 1), a: fmt(A, 1) }) : t(`game.verdict.${key}`, { p: fmt(P, 1), a: fmt(A, 1) });
    return `${fired}${main} ${vsData}`;
  }

  function findingText(f) {
    const d = f.data;
    const q = f.from === f.to ? `Q${qNum(f.from)}` : `Q${qNum(f.from)}–Q${qNum(f.to)}`;
    const vars = {
      q, n: d.quarters, rate: fmt(d.rate, 2), rule: fmt(d.ruleSeen, 2), infl: fmt(d.seenInfl, 1), gap: fmt(d.seenGap, 1),
      move: fmt(Math.abs(d.move), 2), at: `Q${qNum(d.at ?? f.from)}`, value: fmt(d.value ?? 0, 1),
      seen: fmt(d.seen ?? 0, 1), truth: fmt(d.truth ?? 0, 1), cost: fmt(d.cost ?? 0, 1), cut: fmt(Math.abs(d.cut ?? 0), 2),
      w0: fmt(d.wFrom ?? 0, 2), w1: fmt(d.wTo ?? 0, 2),
    };
    let key = `${f.type}.${f.dir}`;
    if (f.type === 'over') key = `over.${f.dir}_${d.consequence}`;
    if (f.type === 'noise') key = `noise.${f.dir}_${d.variable}`;
    let text = t(`game.findings.${key}`, vars);
    if (f.type === 'supply' && d.wFrom - d.wTo > 0.03) text += ` ${t('game.findings.supply.credibility', vars)}`;
    return { title: t(`game.findingTitles.${f.type}`), q, text };
  }

  function renderDone() {
    const ev = ui.ev;
    const g = ui.game;
    const p = g.params;
    const rows = ['player', 'autopilot', 'dataRule'].map((key) => {
      const L = ev.loss[key];
      const st = ev.stats[key];
      return `<tr>
        <td>${swatch(RUN_COLORS[key], RUN_DASH[key])}${t(`game.runs.${key}`)}</td>
        <td><b>${fmt(L.total, 1)}</b></td><td>${fmt(L.inflation, 1)}</td><td>${fmt(L.gap, 1)}</td><td>${fmt(L.rate, 1)}</td>
        <td>${st.inBand} / ${st.quarters}</td><td>${fmt(st.credibility.end, 2)}</td>
      </tr>`;
    }).join('');
    const shown = ev.findings.filter((f) => f.severity > 0.05).slice(0, 5);
    const items = shown.map((f) => {
      const x = findingText(f);
      return `<li class="finding finding-${f.type}">
        <div class="finding-head"><span class="badge">${x.title}</span> <span class="finding-q">${x.q}</span>
          <span class="finding-cost" title="${t('game.costTip', { n: RULES.window })}">${t('game.cost', { v: fmt(f.severity, 1) })}</span></div>
        <p>${eqRefs(x.text)}</p>
      </li>`;
    }).join('');
    const sp = ev.stats.player;
    const sa = ev.stats.autopilot;
    const facts = [
      t('game.facts.credibility', { w0: fmt(sp.credibility.start, 2), w1: fmt(sp.credibility.end, 2), wmin: fmt(sp.credibility.min, 2), wa: fmt(sa.credibility.end, 2) }),
      t('game.facts.moves', { n: sp.changes, N: sp.quarters, m: fmt(sp.meanMove, 2), na: sa.changes, ma: fmt(sa.meanMove, 2) }),
      t('game.facts.worst', { q: `Q${qNum(sp.worst)}`, v: fmt(sp.worstInflation, 1) }),
    ];

    root.innerHTML = `
      <section class="card verdict">
        <h2>${t('game.reviewTitle')} <small>${t('game.reviewMeta', { seed: g.config.seed, n: g.config.length, d: t(`game.difficulty.${g.config.difficulty}`) })} · ${t(`economy.${g.config.economy}`)}</small></h2>
        <p class="verdict-line">${verdict(ev)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>${t('game.table.run')}</th><th>${t('game.table.loss')}</th><th>${t('game.table.inflation')}</th><th>${t('game.table.gap')}</th><th>${t('game.table.rate')}</th><th>${t('game.table.inBand')}</th><th>${t('game.table.credibility')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="note">${t('game.lossNote', { wg: fmt(LOSS_WEIGHTS.gap, 2), wr: fmt(LOSS_WEIGHTS.rate, 2) })} ${t('game.autopilotNote')}</p>
      </section>
      <section class="card review">
        <h2>${t('game.mistakesTitle')}</h2>
        ${items ? `<ol class="findings">${items}</ol>` : `<p>${t('game.noMistakes')}</p>`}
        <ul class="facts">${facts.map((x) => `<li>${x}</li>`).join('')}</ul>
        <p class="note">${t('game.rulesNote')}</p>
      </section>
      <div id="g-timeline" class="sticky-timeline"></div>
      <div class="legend g-legend">${['player', 'autopilot', 'dataRule'].map((key) => `<span class="legend-item">${swatch(RUN_COLORS[key], RUN_DASH[key])}${t(`game.runs.${key}`)}</span>`).join('')}
        <span class="legend-item"><svg width="22" height="8" aria-hidden="true"><circle cx="11" cy="4" r="3" style="fill:var(--s1)" opacity="0.5"/></svg>${t('game.charts.seenYou')}</span>
        <span class="legend-item">${swatch('var(--natural)')}${t('game.charts.naturalDev')}</span>
        <span class="legend-item">${swatch('var(--s2)')}${t('game.charts.cost')}</span>
        ${open() ? `<span class="legend-item">${swatch('var(--c-foreign)')}${t('game.charts.foreignDemand')}</span><span class="legend-item">${swatch('var(--c-fx)')}${t('game.charts.premium')}</span>` : ''}
        <span class="legend-note">${t('game.charts.histNote')}</span></div>
      <div class="charts g-result-charts">
        <div id="g-r-inflation"></div><div id="g-r-gap"></div>
        <div id="g-r-rate"></div><div id="g-r-w"></div>
        ${open() ? '<div id="g-r-fx" class="wide"></div>' : ''}
        <div id="g-r-shocks" class="wide"></div>
      </div>
      <article class="card" id="g-live"></article>
      <div class="g-actions">
        <button type="button" class="btn" id="g-replay">${t('game.replay')}</button>
        <button type="button" class="btn ghost" id="g-new">${t('game.newGame')}</button>
        <button type="button" class="btn ghost" id="g-setup">${t('game.toSetup')}</button>
      </div>`;

    const T = g.t; // quarters played (fewer if the board was replaced)
    const onHover = (k) => { if (k !== null) setQuarter(k, true); };
    const mk = (id, title, unit) => {
      const c = createChart(root.querySelector(`#g-r-${id}`), { title: t(title), unit: t(unit), onHover });
      charts.push(c);
      return c;
    };
    const common = { n: T, format, quarterLabel, xLabel, tickFrom: W(), bands: [[0, W() - 1, 'hist']] };
    const runsFor = (key) => ['player', 'autopilot', 'dataRule'].map((r) => ({
      key: r, label: t(`game.runs.${r}`), color: RUN_COLORS[r], dash: RUN_DASH[r], width: r === 'player' ? 2.25 : 1.75, values: ev.levels[r][key],
    }));
    const target = { y: p.targetAnn, label: `${t('charts.target')} ${fmt(p.targetAnn, 1)} %` };
    mk('inflation', 'game.charts.inflationTrue', 'charts.inflationUnit').update({
      ...common, refs: [target], hbands: [{ from: p.targetAnn - RULES.band, to: p.targetAnn + RULES.band }],
      series: [...runsFor('inflation'), { key: 'seen', label: t('game.charts.seenYou'), color: 'var(--s1)', points: true, opacity: 0.45, values: ev.observed.inflation }],
    });
    mk('gap', 'game.charts.gapTrue', 'charts.gapUnit').update({
      ...common, refs: [],
      series: [...runsFor('gap'), { key: 'seen', label: t('game.charts.seenYou'), color: 'var(--s1)', points: true, opacity: 0.45, values: ev.observed.gap }],
    });
    mk('rate', 'charts.nominal', 'charts.nominalUnit').update({
      ...common, series: runsFor('rate'), refs: [{ y: p.lowerBoundAnn, label: `${t('charts.lowerBound')} ${fmt(p.lowerBoundAnn, 2)} %` }],
    });
    mk('w', 'charts.anchoring', 'charts.anchoringUnit').update({ ...common, series: runsFor('w'), refs: [], yDomain: [0, 1], maxHeight: 220 });
    if (open()) {
      mk('fx', 'charts.fx', 'charts.fxUnit').update({
        ...common, maxHeight: 220, series: runsFor('fx'), refs: [{ y: p.eurCzk, label: `${t('charts.fxSteady')} ${fmt(p.eurCzk, 2)}` }],
      });
    }
    const L = ev.levels.player;
    mk('shocks', 'game.charts.shocks', 'game.charts.shocksUnit').update({
      ...common, maxHeight: 200, refs: [{ y: 0, label: '' }],
      series: [
        { key: 'rn', label: t('game.charts.naturalDev'), color: 'var(--natural)', width: 2, values: L.natural.map((v) => v - p.neutralRealAnn) },
        { key: 'u', label: t('game.charts.cost'), color: 'var(--s2)', width: 2, values: L.cost },
        ...(open() ? [
          { key: 'ystar', label: t('game.charts.foreignDemand'), color: 'var(--c-foreign)', width: 1.75, values: L.foreignDemand },
          { key: 'chi', label: t('game.charts.premium'), color: 'var(--c-fx)', width: 1.75, values: L.premium },
        ] : []),
      ],
    });

    timeline = createTimeline(root.querySelector('#g-timeline'), {
      onChange: (k) => setQuarter(k, false),
      label: (k) => quarterLabel(k),
      texts: timelineTexts,
    });
    timeline.setN(T);
    live = createLivePanel(root.querySelector('#g-live'), {
      onQuarter: (k) => setQuarter(k, true),
      onRun: (key) => { ui.liveRun = key; updateLive(); },
    });
    updateLive();
    setQuarter(ui.quarter, true);
  }

  function updateLive() {
    if (!live) return;
    const ev = ui.ev;
    live.update({
      result: ev.runs[ui.liveRun],
      params: ui.game.params,
      runs: ['player', 'autopilot', 'dataRule'].map((key) => ({ key, label: t(`game.runs.${key}`) })),
      runKey: ui.liveRun,
      quarterLabel,
      xLabel,
      tickFrom: W(),
      context: 'game',
    });
    live.setQuarter(ui.quarter);
  }

  function setQuarter(k, fromUser) {
    ui.quarter = k;
    if (fromUser) timeline?.stop();
    timeline?.setQuarter(k);
    for (const c of charts) c.setCursor(k);
    live?.setQuarter(k);
  }

  let timelineTexts = () => ({});

  // ---------------------------------------------------------------------------

  function render() {
    destroyCharts();
    if (ui.phase === 'setup') renderSetup();
    else if (ui.phase === 'play') renderPlay();
    else renderDone();
  }

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'g-length') {
      ui.settings.length = Number(el.value);
      root.querySelector('#g-length-out').textContent = `${ui.settings.length} ${t('game.qUnit')}`;
      saveSettings(ui.settings);
    } else if (el.id === 'g-seed') {
      const v = Math.floor(Number(el.value));
      if (v > 0) { ui.settings.seed = v; saveSettings(ui.settings); }
    }
  });
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tip) {
      const id = btn.dataset.tip;
      const box = root.querySelector(`#gtip-${id}`);
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) ui.openTips.add(id); else ui.openTips.delete(id);
    } else if (btn.dataset.geconomy) {
      ui.settings.economy = btn.dataset.geconomy;
      saveSettings(ui.settings);
      render(); // the equations shown next to the rules depend on the economy
    } else if (btn.dataset.diff) {
      ui.settings.difficulty = btn.dataset.diff;
      saveSettings(ui.settings);
      for (const b of root.querySelectorAll('[data-diff]')) b.setAttribute('aria-pressed', String(b === btn));
    } else if (btn.id === 'g-dice') {
      ui.settings.seed = 1 + Math.floor(Math.random() * 999999);
      root.querySelector('#g-seed').value = ui.settings.seed;
      saveSettings(ui.settings);
    } else if (btn.id === 'g-start') {
      const v = Math.floor(Number(root.querySelector('#g-seed').value));
      start(v > 0 ? v : GAME_DEFAULTS.seed);
    } else if (btn.dataset.d) {
      changeRate(Number(btn.dataset.d));
    } else if (btn.id === 'g-submit') {
      submit();
    } else if (btn.id === 'g-quit' || btn.id === 'g-setup') {
      ui.phase = 'setup';
      render();
    } else if (btn.id === 'g-replay') {
      start(ui.game.config.seed);
    } else if (btn.id === 'g-new') {
      start(1 + Math.floor(Math.random() * 999999));
    }
  });

  return {
    render,
    setTimelineTexts(fn) { timelineTexts = fn; },
    // Keyboard shortcuts while deciding: arrows change the rate, Enter submits.
    handleKey(ev) {
      if (ui.phase !== 'play') return false;
      const tag = ev.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        const step = ev.shiftKey ? 1 : RATE_STEP;
        changeRate(ev.key === 'ArrowUp' ? step : -step);
        return true;
      }
      // Enter on a focused button is handled by the button itself.
      if (ev.key === 'Enter' && tag !== 'BUTTON') {
        submit();
        return true;
      }
      return false;
    },
  };
}
