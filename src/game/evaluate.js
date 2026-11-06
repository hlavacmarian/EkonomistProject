// After the game: loss function, the Taylor-rule autopilot on the same shocks and a
// rule-based review of the biggest mistakes (no language model involved: every
// finding comes from explicit thresholds below).

import { steadyNominalAnn } from '../model/params.js';
import { fxLevel } from '../model/open.js';
import { gameModel, shockAt } from './economy.js';
import { rateToLevel, rateToModel, inflationLevel, clampRate, playerRates, isOver } from './game.js';

// Loss per quarter: (pi - pi*)^2 + gap * x^2 + rate * (i_t - i_{t-1})^2,
// inflation and rates in % p.a., the gap in % of potential.
export const LOSS_WEIGHTS = Object.freeze({ gap: 0.5, rate: 0.25 });

// Thresholds of the review (p.p. p.a. unless stated otherwise).
export const RULES = Object.freeze({
  band: 1, // tolerance band around the target
  lateQuarters: 2, // consecutive decisions without an adequate reaction
  lateGap: 0.75, // the rate stays this far on the wrong side of the rule on your data
  lateMove: 0.25, // ... and moves by at most this much in the right direction
  overMove: 0.75, // minimum move that can be an overreaction
  overBeyond: 1.25, // the move takes the rate this far past the rule on your data
  overGap: 2, // ... and the gap later overshoots by this much (% of potential)
  noiseMove: 0.5, // minimum move that counts as a reaction
  noiseSize: 0.6, // part of the rule-implied rate that was measurement noise
  supplyShock: 0.5, // cost-push shock u (annualized) that counts as a supply shock
  supplyCut: 0.25, // rate cut during it
  supplyBelow: 0.25, // ... that takes the rate below the rule on your data
  window: 4, // quarters after a mistake over which its cost is measured
});

// When one decision matches several single-quarter patterns, only the most
// specific one is reported.
const PRIORITY = { supply: 3, over: 2, noise: 1 };

// Textbook Taylor rule applied to annualized data: what the rule suggests for the
// data a policymaker sees.
export function dataRule(p, inflation, gap) {
  return steadyNominalAnn(p) + p.phiPi * (inflation - p.targetAnn) + 4 * p.phiX * gap;
}

export function levelsOf(sol, p) {
  const n = sol.x.length;
  return {
    inflation: Array.from({ length: n }, (_, k) => inflationLevel(sol.pi[k], p)),
    gap: Array.from(sol.x),
    rate: Array.from({ length: n }, (_, k) => rateToLevel(sol.i[k], p)),
    real: Array.from({ length: n }, (_, k) => 4 * sol.r[k] + p.neutralRealAnn),
    expected: Array.from({ length: n }, (_, k) => inflationLevel(sol.Epi[k], p)),
    natural: Array.from({ length: n }, (_, k) => 4 * sol.rn[k] + p.neutralRealAnn),
    cost: Array.from({ length: n }, (_, k) => 4 * sol.u[k]),
    w: Array.from(sol.w),
    ...(sol.economy === 'open' ? {
      fx: Array.from({ length: n }, (_, k) => fxLevel(sol.e[k], p)),
      domestic: Array.from({ length: n }, (_, k) => inflationLevel(sol.piH[k], p)),
      imported: Array.from({ length: n }, (_, k) => inflationLevel(sol.piF[k], p)),
      foreignRate: Array.from({ length: n }, (_, k) => 4 * sol.istar[k] + steadyNominalAnn(p)),
      foreignDemand: Array.from(sol.ystar),
      premium: Array.from({ length: n }, (_, k) => 4 * sol.chi[k]),
    } : {}),
  };
}

export function lossBreakdown(levels, p, from = 0, weights = LOSS_WEIGHTS) {
  const per = [];
  const sum = { inflation: 0, gap: 0, rate: 0, total: 0 };
  for (let k = from; k < levels.inflation.length; k++) {
    const prev = k > 0 ? levels.rate[k - 1] : steadyNominalAnn(p);
    const q = {
      inflation: (levels.inflation[k] - p.targetAnn) ** 2,
      gap: weights.gap * levels.gap[k] ** 2,
      rate: weights.rate * (levels.rate[k] - prev) ** 2,
    };
    q.total = q.inflation + q.gap + q.rate;
    per.push(q);
    for (const key of Object.keys(sum)) sum[key] += q[key];
  }
  return { ...sum, perQuarter: per, quarters: per.length };
}

// Player's run: the rates actually set, history under the Taylor rule.
export function playerSolution(game) {
  return gameModel(game.config.economy).solve(game.params, game.paths, { rates: playerRates(game) }, game.t);
}

// Autopilot: the Taylor rule of the model (true, current data) on the same shocks,
// over the quarters actually played (fewer if the player was replaced early).
export function autopilotSolution(game) {
  return gameModel(game.config.economy).solve(game.params, game.paths, {}, game.t);
}

// The same rule, but applied to what the player could see: last quarter's noisy
// data, rounded to the 0.25 p.p. grid. Measures how much the information problem
// alone costs.
export function dataRuleSolution(game) {
  const p = game.params;
  const model = gameModel(game.config.economy);
  let state = model.init(p);
  let prev = null;
  const rates = [];
  for (let k = 0; k < game.t; k++) {
    let rate = null;
    if (k >= game.warmup) {
      const inflation = inflationLevel(prev.pi, p) + game.noise.inflation[k - 1];
      const gap = prev.x + game.noise.gap[k - 1];
      rate = rateToModel(clampRate(dataRule(p, inflation, gap), p), p);
    }
    rates.push(rate ?? NaN);
    prev = model.step(p, state, shockAt(model, game.paths, k), rate);
    state = prev.state;
  }
  return model.solve(p, game.paths, { rates }, game.t);
}

// ---------------------------------------------------------------------------
// Rule-based review

function episodes(flags) {
  const out = [];
  for (let k = 0; k < flags.length; k++) {
    if (!flags[k]) continue;
    let j = k;
    while (j + 1 < flags.length && flags[j + 1] && flags[j + 1].dir === flags[k].dir) j++;
    out.push({ from: k, to: j, first: flags[k] });
    k = j;
  }
  return out;
}

// game: a finished game; returns findings sorted by how much they cost.
// Quarters in findings are absolute indices k; q = k - warmup + 1 is the game quarter.
export function analyze(game, player, autopilot, rules = RULES) {
  const p = game.params;
  const W = game.warmup;
  const T = player.x.length;
  const L = levelsOf(player, p);
  const A = levelsOf(autopilot, p);
  const lossP = lossBreakdown(L, p, 0).perQuarter;
  const lossA = lossBreakdown(A, p, 0).perQuarter;
  const excess = (from, to) => {
    let s = 0;
    for (let k = from; k <= Math.min(T - 1, to + rules.window); k++) s += lossP[k].total - lossA[k].total;
    return s;
  };
  const obsInfl = (k) => L.inflation[k] + game.noise.inflation[k];
  const obsGap = (k) => L.gap[k] + game.noise.gap[k];
  const findings = [];
  const late = new Array(T).fill(null);
  const supply = new Array(T).fill(null);

  for (let k = Math.max(1, W); k < T; k++) {
    const rate = L.rate[k];
    const move = rate - L.rate[k - 1];
    const seenInfl = obsInfl(k - 1);
    const seenGap = obsGap(k - 1);
    // What the rule suggests, never below the lower bound (it cannot be set lower).
    const ruleSeen = Math.max(p.lowerBoundAnn, dataRule(p, seenInfl, seenGap));
    const ruleTrue = Math.max(p.lowerBoundAnn, dataRule(p, L.inflation[k - 1], L.gap[k - 1]));
    const devSeen = seenInfl - p.targetAnn;
    const devTrue = L.inflation[k - 1] - p.targetAnn;
    const base = { k, rate, move, seenInfl, seenGap, ruleSeen, ruleTrue };

    // Late reaction: inflation was (really) out of the band, the data showed it,
    // and the rate stayed well on the wrong side of the rule.
    if (devSeen > rules.band && devTrue > rules.band && rate < ruleSeen - rules.lateGap && move <= rules.lateMove) {
      late[k] = { ...base, dir: 'high' };
    } else if (devSeen < -rules.band && devTrue < -rules.band && rate > ruleSeen + rules.lateGap &&
      move >= -rules.lateMove && rate > p.lowerBoundAnn + 1e-9) {
      late[k] = { ...base, dir: 'low' };
    }

    // Overreaction: a move in the direction the data called for (tighten when the rule
    // on the data is above neutral, ease when below) that carries the rate far past
    // the rule, after which the economy overshoots in the opposite direction.
    const called = Math.sign(ruleSeen - steadyNominalAnn(p));
    if (Math.abs(move) >= rules.overMove && Math.sign(move) === called &&
      Math.sign(move) * (rate - ruleSeen) > rules.overBeyond) {
      const ahead = [];
      for (let s = k; s <= Math.min(T - 1, k + rules.window); s++) ahead.push(s);
      const up = move > 0;
      const inflOver = ahead.find((s) => (up ? L.inflation[s] < p.targetAnn - rules.band : L.inflation[s] > p.targetAnn + rules.band));
      const gapOver = ahead.find((s) => (up ? L.gap[s] < -rules.overGap : L.gap[s] > rules.overGap));
      const hit = inflOver ?? gapOver;
      if (hit !== undefined) {
        findings.push({
          type: 'over', dir: up ? 'up' : 'down', from: k, to: k,
          data: { ...base, consequence: inflOver !== undefined ? 'inflation' : 'gap', at: hit, value: inflOver !== undefined ? L.inflation[hit] : L.gap[hit] },
        });
      }
    }

    // Reaction to noise: the move follows what measurement noise suggested, noise
    // accounts for at least half of the move, and the true data justified less than
    // half of it (or the opposite).
    const noiseInfl = p.phiPi * game.noise.inflation[k - 1];
    const noiseGap = 4 * p.phiX * game.noise.gap[k - 1];
    const noise = noiseInfl + noiseGap;
    const justified = ruleTrue - L.rate[k - 1];
    if (Math.abs(move) >= rules.noiseMove && Math.sign(move) === Math.sign(noise) &&
      Math.abs(noise) >= Math.max(rules.noiseSize, Math.abs(move) / 2) && move * justified < (move * move) / 2) {
      const variable = Math.abs(noiseGap) >= Math.abs(noiseInfl) ? 'gap' : 'inflation';
      findings.push({
        type: 'noise', dir: move > 0 ? 'up' : 'down', from: k, to: k,
        data: { ...base, variable, seen: variable === 'gap' ? seenGap : seenInfl, truth: variable === 'gap' ? L.gap[k - 1] : L.inflation[k - 1] },
      });
    }

    // Easing during a supply shock: a cost-push shock is lifting inflation, the data
    // already show inflation above target, and the rate is cut below what the rule
    // would set on those data (so it is not just a return towards normal).
    const cost = Math.max(L.cost[k], L.cost[k - 1]);
    if (cost > rules.supplyShock && move <= -rules.supplyCut && devSeen > 0 && rate < ruleSeen - rules.supplyBelow) {
      supply[k] = { ...base, dir: 'down', cost };
    }
  }

  for (const ep of episodes(late)) {
    if (ep.to - ep.from + 1 < rules.lateQuarters) continue;
    findings.push({ type: 'late', dir: ep.first.dir, from: ep.from, to: ep.to, data: { ...ep.first, quarters: ep.to - ep.from + 1 } });
  }
  for (const ep of episodes(supply)) {
    let cut = 0;
    for (let k = ep.from; k <= ep.to; k++) cut += L.rate[k] - L.rate[k - 1];
    const end = Math.min(T - 1, ep.to + rules.window);
    findings.push({
      type: 'supply', dir: 'down', from: ep.from, to: ep.to,
      data: { ...ep.first, cut, wFrom: L.w[ep.from], wTo: Math.min(...L.w.slice(ep.from, end + 1)) },
    });
  }

  // One single-quarter finding per decision.
  const best = new Map();
  const kept = [];
  for (const f of findings) {
    if (f.type === 'late') { kept.push(f); continue; }
    for (let k = f.from; k <= f.to; k++) {
      const cur = best.get(k);
      if (!cur || PRIORITY[f.type] > PRIORITY[cur.type]) best.set(k, f);
    }
  }
  for (const f of new Set(best.values())) kept.push(f);
  for (const f of kept) f.severity = excess(f.from, f.to);
  kept.sort((a, b) => b.severity - a.severity || a.from - b.from);
  return kept;
}

function summary(levels, p, from) {
  const n = levels.inflation.length;
  let inBand = 0, changes = 0, absMove = 0, worst = from;
  for (let k = from; k < n; k++) {
    const dev = Math.abs(levels.inflation[k] - p.targetAnn);
    if (dev <= RULES.band) inBand++;
    if (dev > Math.abs(levels.inflation[worst] - p.targetAnn)) worst = k;
    const move = levels.rate[k] - levels.rate[k - 1];
    if (Math.abs(move) > 1e-9) { changes++; absMove += Math.abs(move); }
  }
  const w = levels.w.slice(from);
  return {
    inBand, quarters: n - from, changes, meanMove: changes ? absMove / changes : 0,
    worst, worstInflation: levels.inflation[worst],
    credibility: { start: w[0], end: w[w.length - 1], min: Math.min(...w) },
  };
}

// Everything the results screen needs.
export function evaluateGame(game) {
  if (!isOver(game)) throw new Error('The game is not finished yet');
  const p = game.params;
  const W = game.warmup;
  const runs = { player: playerSolution(game), autopilot: autopilotSolution(game), dataRule: dataRuleSolution(game) };
  const levels = {};
  const loss = {};
  const stats = {};
  for (const [key, sol] of Object.entries(runs)) {
    levels[key] = levelsOf(sol, p);
    loss[key] = lossBreakdown(levels[key], p, W);
    stats[key] = summary(levels[key], p, W);
  }
  const observed = {
    inflation: levels.player.inflation.map((v, k) => v + game.noise.inflation[k]),
    gap: levels.player.gap.map((v, k) => v + game.noise.gap[k]),
  };
  return { runs, levels, loss, stats, observed, fired: game.fired, findings: analyze(game, runs.player, runs.autopilot) };
}
