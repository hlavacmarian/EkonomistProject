import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, drawGame, observe, submitRate, isOver, evaluateGame, analyze, playerSolution,
  autopilotSolution, dataRuleSolution, lossBreakdown, levelsOf, dataRule, rateToModel, clampRate,
  mulberry32, gaussian, normalizeSeed, GAME_DEFAULTS, DIFFICULTY, NOISE, LOSS_WEIGHTS, FIRE,
} from '../src/game/index.js';
import { solveHybrid, solveOpenHybrid, residuals, openResiduals } from '../src/model/index.js';

const TOL = 1e-9;
const W = GAME_DEFAULTS.warmup;

// Play a whole game with a strategy (observation -> rate in % p.a.).
function play(game, strategy) {
  let g = game;
  while (!isOver(g)) g = submitRate(g, strategy(observe(g), g));
  return g;
}
const hold = (o) => o.lastRate;

// Hand-made games: zero shocks and noise except where a case needs them.
function scripted({ length = 12, u = {}, rn = {}, noiseGap = {}, noiseInfl = {} } = {}) {
  const T = W + length;
  const z = () => new Array(T).fill(0);
  const paths = { rn: z(), u: z(), v: z() };
  const noise = { inflation: z(), gap: z(), expectations: z() };
  for (const [k, val] of Object.entries(u)) paths.u[k] = val / 4;
  for (const [k, val] of Object.entries(rn)) paths.rn[k] = val / 4;
  for (const [k, val] of Object.entries(noiseGap)) noise.gap[k] = val;
  for (const [k, val] of Object.entries(noiseInfl)) noise.inflation[k] = val;
  return createGame({ length }, { paths, noise, news: new Array(T).fill(null) });
}
const range = (a, b, v) => Object.fromEntries(Array.from({ length: b - a }, (_, j) => [a + j, v]));

describe('seeded generator', () => {
  test('mulberry32 is deterministic and roughly uniform; gaussian has unit variance', () => {
    const a = mulberry32(5), b = mulberry32(5);
    for (let k = 0; k < 100; k++) assert.equal(a(), b());
    const r = mulberry32(11);
    let s = 0, s2 = 0;
    const n = 20000;
    for (let k = 0; k < n; k++) { const z = gaussian(r); s += z; s2 += z * z; }
    assert.ok(Math.abs(s / n) < 0.03);
    assert.ok(Math.abs(s2 / n - 1) < 0.05);
  });

  test('seeds: integers are kept, text is hashed to a positive integer', () => {
    assert.equal(normalizeSeed(42), 42);
    assert.equal(normalizeSeed('42'), 42);
    const h = normalizeSeed('CNB');
    assert.ok(Number.isInteger(h) && h > 0);
    assert.equal(h, normalizeSeed('CNB'));
  });
});

describe('game: repeatability and observations', () => {
  test('same seed -> same shocks, noise, news and the same outcome for the same decisions', () => {
    const a = createGame({ seed: 123 });
    const b = createGame({ seed: 123 });
    assert.deepEqual(a.paths, b.paths);
    assert.deepEqual(a.noise, b.noise);
    assert.deepEqual(a.news, b.news);
    const strat = (o) => o.lastRate + (o.history.at(-1).inflation > o.target ? 0.25 : -0.25);
    const ea = evaluateGame(play(a, strat));
    const eb = evaluateGame(play(b, strat));
    assert.deepEqual(ea.levels, eb.levels);
    assert.deepEqual(ea.findings, eb.findings);
    assert.notDeepEqual(createGame({ seed: 124 }).paths, a.paths);
  });

  test('a longer game with the same seed starts with exactly the same quarters', () => {
    const short = drawGame(9, 20, 'medium', W);
    const long = drawGame(9, 44, 'medium', W);
    for (const k of ['rn', 'u']) assert.deepEqual(long.paths[k].slice(0, 20), short.paths[k]);
    assert.deepEqual(long.noise.gap.slice(0, 20), short.noise.gap);
  });

  test('difficulty scales the shocks, not the measurement noise', () => {
    const easy = drawGame(3, 28, 'easy', W);
    const hard = drawGame(3, 28, 'hard', W);
    const ratio = DIFFICULTY.hard / DIFFICULTY.easy;
    for (let k = 0; k < 28; k++) {
      assert.ok(Math.abs(hard.paths.rn[k] - ratio * easy.paths.rn[k]) < 1e-12);
      assert.ok(Math.abs(hard.paths.u[k] - ratio * easy.paths.u[k]) < 1e-12);
    }
    assert.deepEqual(hard.noise, easy.noise);
  });

  test('the player sees only earlier quarters, with noise, and no true values', () => {
    const g = submitRate(submitRate(createGame({ seed: 77 }), 3), 3.25);
    const o = observe(g);
    assert.equal(o.t, W + 2);
    assert.equal(o.quarter, 3);
    assert.equal(o.history.length, W + 2, 'data up to the previous quarter');
    const last = o.history.at(-1);
    assert.deepEqual(Object.keys(last).sort(), ['expectations', 'gap', 'inflation', 'k', 'rate']);
    assert.equal(last.rate, 3.25);
    const truth = levelsOf(playerSolution(g), g.params);
    assert.ok(Math.abs(last.inflation - truth.inflation[W + 1] - g.noise.inflation[W + 1]) < TOL);
    assert.ok(Math.abs(last.gap - truth.gap[W + 1] - g.noise.gap[W + 1]) < TOL);
    for (const key of ['path', 'state', 'paths']) assert.equal(o[key], undefined);
  });

  test('the output gap is measured with more noise than inflation', () => {
    const d = drawGame(1, 4000, 'medium', 0);
    const sd = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    assert.ok(Math.abs(sd(d.noise.gap) - NOISE.gap) < 0.05);
    assert.ok(Math.abs(sd(d.noise.inflation) - NOISE.inflation) < 0.02);
    assert.ok(sd(d.noise.gap) > 2 * sd(d.noise.inflation));
  });

  test('rates are rounded to 0.25 p.p. and never set below the lower bound', () => {
    const g0 = createGame({ seed: 5 });
    assert.equal(clampRate(1.13, g0.params), 1.25);
    const g = submitRate(g0, -2);
    assert.equal(g.rates.at(-1), g0.params.lowerBoundAnn);
    const sol = playerSolution(g);
    assert.ok(Math.abs(sol.i[W] - rateToModel(g0.params.lowerBoundAnn, g0.params)) < TOL);
    assert.throws(() => submitRate(g0, NaN));
  });

  test('no evaluation before the end, no decisions after it', () => {
    const g = createGame({ seed: 1, length: 8 });
    assert.throws(() => evaluateGame(g));
    const done = play(g, hold);
    assert.ok(isOver(done));
    assert.throws(() => submitRate(done, 3));
  });
});

describe('game: dismissal', () => {
  test('letting inflation run away gets the board replaced and ends the game early', () => {
    const g = play(scripted({ length: 24, u: range(W, W + 24, 4) }), (o) => Math.max(0, o.lastRate - 0.5));
    assert.ok(isOver(g));
    assert.ok(g.fired, 'the government stepped in');
    assert.equal(g.fired.reason, 'inflation');
    assert.ok(g.t < g.T);
    assert.ok(g.fired.value - g.params.targetAnn > FIRE.inflation);
    assert.throws(() => submitRate(g, 3));
    const ev = evaluateGame(g);
    assert.equal(ev.levels.player.inflation.length, g.t);
    assert.equal(ev.levels.autopilot.inflation.length, g.t, 'the autopilot is compared over the same quarters');
    assert.equal(ev.loss.player.quarters, g.t - W);
    assert.ok(ev.findings.some((f) => f.type === 'late' || f.type === 'supply'));
  });

  test('ordinary play is never cut short', () => {
    const g = play(createGame({ seed: 21 }), (o, game) => {
      const last = o.history.at(-1);
      return dataRule(game.params, last.inflation, last.gap);
    });
    assert.equal(g.fired, null);
    assert.equal(g.t, g.T);
  });
});

describe('game: model consistency and benchmarks', () => {
  test('quarter-by-quarter play equals solveHybrid with the same rates and solves the equations', () => {
    const g = play(createGame({ seed: 31 }), (o) => o.lastRate + (o.quarter % 3 === 0 ? 0.5 : -0.25));
    const sol = playerSolution(g);
    for (const k of ['x', 'pi', 'i', 'w']) {
      for (let t = 0; t < g.T; t++) assert.ok(Math.abs(sol[k][t] - g.path[k][t]) < TOL, `${k} ${t}`);
    }
    assert.ok(residuals(sol, g.params).max < TOL);
  });

  test('the autopilot is solveHybrid with the Taylor rule on the same shocks', () => {
    const g = play(createGame({ seed: 8, difficulty: 'hard' }), hold);
    const auto = autopilotSolution(g);
    const ref = solveHybrid(g.params, g.paths, {}, g.t);
    assert.deepEqual(Array.from(auto.x), Array.from(ref.x));
    assert.ok(residuals(auto, g.params).max < TOL);
    // History is common to every run.
    const player = playerSolution(g);
    for (let k = 0; k < W; k++) assert.equal(player.i[k], auto.i[k]);
  });

  test('a player who applies the rule to the observed data reproduces the data-rule benchmark', () => {
    const g = play(createGame({ seed: 12 }), (o, game) => {
      const last = o.history.at(-1);
      return dataRule(game.params, last.inflation, last.gap);
    });
    const ev = evaluateGame(g);
    assert.ok(Math.abs(ev.loss.player.total - ev.loss.dataRule.total) < TOL);
    assert.ok(residuals(dataRuleSolution(g), g.params).max < TOL);
  });

  test('loss = squared inflation miss + weighted gap + weighted rate changes', () => {
    const p = createGame().params;
    const levels = { inflation: [2, 3, 1], gap: [0, -2, 1], rate: [3, 4, 3.5] };
    const L = lossBreakdown(levels, p, 1);
    const expect = (1 + LOSS_WEIGHTS.gap * 4 + LOSS_WEIGHTS.rate * 1) + (1 + LOSS_WEIGHTS.gap * 1 + LOSS_WEIGHTS.rate * 0.25);
    assert.ok(Math.abs(L.total - expect) < 1e-12);
    assert.equal(L.quarters, 2);
    assert.ok(Math.abs(L.inflation + L.gap + L.rate - L.total) < 1e-12);
  });

  test('credibility is earned by keeping inflation at target and lost by letting it drift', () => {
    const calm = evaluateGame(play(scripted({ length: 16 }), hold));
    const w = calm.levels.player.w;
    assert.ok(w[W + 15] > w[W] && w[W + 15] > 0.85);
    const drift = evaluateGame(play(scripted({ length: 16, u: range(W, W + 10, 3) }), hold));
    assert.ok(drift.stats.player.credibility.min < 0.4);
    assert.ok(drift.stats.autopilot.credibility.min > drift.stats.player.credibility.min);
  });
});

describe('game: rule-based review', () => {
  const types = (ev) => ev.findings.map((f) => f.type);

  test('a calm game played calmly has nothing to criticise', () => {
    const ev = evaluateGame(play(scripted(), hold));
    assert.deepEqual(ev.findings, []);
  });

  test('late reaction: inflation stays above the band while the rate does not move', () => {
    const ev = evaluateGame(play(scripted({ u: range(W, W + 8, 3) }), hold));
    const late = ev.findings.find((f) => f.type === 'late');
    assert.ok(late, JSON.stringify(types(ev)));
    assert.equal(late.dir, 'high');
    assert.ok(late.to - late.from + 1 >= 2);
    assert.ok(late.severity > 0, 'it was costly compared with the autopilot');
  });

  test('overreaction: a huge hike after a modest inflation rise, then a slump', () => {
    const g = scripted({ u: { [W]: 1.5, [W + 1]: 1.5 } });
    const ev = evaluateGame(play(g, (o) => (o.quarter === 2 ? o.lastRate + 5 : o.lastRate)));
    const over = ev.findings.find((f) => f.type === 'over');
    assert.ok(over, JSON.stringify(types(ev)));
    assert.equal(over.dir, 'up');
    assert.equal(over.from, W + 1);
  });

  test('reaction to noise: cutting on a gap reading that was only measurement noise', () => {
    const g = scripted({ noiseGap: { [W + 2]: -3 } });
    const ev = evaluateGame(play(g, (o) => (o.quarter === 4 ? o.lastRate - 1 : o.lastRate)));
    const noise = ev.findings.find((f) => f.type === 'noise');
    assert.ok(noise, JSON.stringify(types(ev)));
    assert.equal(noise.data.variable, 'gap');
    assert.equal(noise.from, W + 3);
    assert.ok(Math.abs(noise.data.truth) < 0.5 && noise.data.seen < -2.5);
  });

  test('no noise finding when the data were right', () => {
    const g = scripted({ rn: range(W, W + 6, -3) });
    const ev = evaluateGame(play(g, (o) => (o.quarter === 2 ? o.lastRate - 1 : o.lastRate)));
    assert.ok(!ev.findings.some((f) => f.type === 'noise'));
  });

  test('easing during a supply shock: cutting while a cost shock lifts inflation', () => {
    const g = scripted({ u: range(W, W + 4, 2) });
    const ev = evaluateGame(play(g, (o) => (o.quarter === 2 ? o.lastRate - 1 : o.lastRate)));
    const supply = ev.findings.find((f) => f.type === 'supply');
    assert.ok(supply, JSON.stringify(types(ev)));
    assert.equal(supply.from, W + 1);
    assert.ok(supply.data.cost > 1);
    // A single decision gets one single-quarter finding (late reactions are episodes).
    assert.equal(ev.findings.filter((f) => f.type !== 'late' && f.from === W + 1).length, 1);
  });

  test('findings are sorted from the most to the least costly', () => {
    const g = play(createGame({ seed: 4, difficulty: 'hard' }), (o) => o.lastRate + (o.quarter % 2 ? 1 : -1));
    const ev = evaluateGame(g);
    for (let k = 1; k < ev.findings.length; k++) assert.ok(ev.findings[k - 1].severity >= ev.findings[k].severity);
    assert.deepEqual(analyze(g, ev.runs.player, ev.runs.autopilot), ev.findings);
  });
});

describe('game in the open economy', () => {
  const dataPlayer = (o, game) => {
    const last = o.history.at(-1);
    return dataRule(game.params, last.inflation, last.gap);
  };

  test('same seed -> same game; the domestic shocks are those of the closed game', () => {
    const a = createGame({ seed: 77, economy: 'open' });
    const b = createGame({ seed: 77, economy: 'open' });
    assert.deepEqual(a.paths, b.paths);
    assert.deepEqual(a.news, b.news);
    const closed = createGame({ seed: 77 });
    assert.deepEqual(a.paths.rn, closed.paths.rn);
    assert.deepEqual(a.paths.u, closed.paths.u);
    assert.deepEqual(a.noise, closed.noise);
    assert.ok(a.paths.chi.some((v) => v !== 0) && a.paths.ystar.some((v) => v !== 0));
    assert.equal(closed.paths.chi, undefined, 'the closed game has no foreign shocks');
  });

  test('the koruna is seen exactly, the rest with noise and a lag', () => {
    const g = submitRate(createGame({ seed: 5, economy: 'open' }), 3);
    const o = observe(g);
    const sol = playerSolution(g);
    const truth = levelsOf(sol, g.params);
    for (const h of o.history) assert.ok(Math.abs(h.fx - truth.fx[h.k]) < 1e-12);
    assert.equal(o.history.length, g.t);
    assert.equal(o.economy, 'open');
  });

  test('play = solveOpenHybrid with the same rates; autopilot = solveOpenHybrid with the rule', () => {
    const g = play(createGame({ seed: 41, economy: 'open' }), (o) => o.lastRate + (o.quarter % 3 === 0 ? 0.5 : -0.25));
    const sol = playerSolution(g);
    for (const k of ['x', 'pi', 'i', 'w', 'q', 'e']) {
      for (let t = 0; t < g.t; t++) assert.ok(Math.abs(sol[k][t] - g.path[k][t]) < TOL, `${k} ${t}`);
    }
    assert.ok(openResiduals(sol, g.params).max < TOL);
    const auto = autopilotSolution(g);
    const ref = solveOpenHybrid(g.params, g.paths, {}, g.t);
    assert.deepEqual(Array.from(auto.q), Array.from(ref.q));
    assert.ok(openResiduals(auto, g.params).max < TOL);
  });

  test('a player who applies the rule to the observed data reproduces the data-rule benchmark', () => {
    for (const seed of [3, 9, 1998]) {
      const ev = evaluateGame(play(createGame({ seed, economy: 'open' }), dataPlayer));
      assert.ok(Math.abs(ev.loss.player.total - ev.loss.dataRule.total) < TOL);
      assert.ok(ev.levels.player.fx.every(Number.isFinite));
    }
  });

  test('the lagged rule on noisy data stays stable in the open economy (calibration)', () => {
    let fired = 0;
    for (let seed = 1; seed <= 40; seed++) if (play(createGame({ seed, economy: 'open' }), dataPlayer).fired) fired++;
    assert.equal(fired, 0);
  });

  test('raising the rate strengthens the koruna in the same quarter', () => {
    const g0 = scripted({ length: 6 });
    const p = g0.params;
    const z = (T) => new Array(T).fill(0);
    const T = g0.T;
    const og = createGame({ length: 6, economy: 'open' }, {
      paths: { rn: z(T), u: z(T), v: z(T), istar: z(T), ystar: z(T), chi: z(T) },
      noise: g0.noise, news: g0.news,
    });
    const after = submitRate(og, observe(og).neutral + 2);
    assert.ok(after.path.q[W] < 0 && after.path.e[W] < 0);
    assert.ok(observe(after).history.at(-1).fx < p.eurCzk);
  });
});
