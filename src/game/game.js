// "Be the central bank": the player sets the nominal rate every quarter.
// Pure game logic, no DOM. The economy is the hybrid model with endogenous
// anchoring (rational expectations would require a known policy rule, which a
// human player does not have).
//
// Timeline (absolute quarter index k = 0 .. T-1, T = warmup + length):
//   k < warmup     history: the previous governor followed the Taylor rule
//   k >= warmup    the player's quarters; in quarter k the player sees data for
//                  quarters < k only, with measurement noise, and sets i_k
// Random shocks and measurement noise are drawn from a seeded generator, one fixed
// block of draws per quarter, so the same seed always gives the same game (and a
// longer game with the same seed starts with exactly the same quarters).
//
// The game can be played in the closed economy or in the small open economy
// (config.economy = 'open'): foreign shocks then come from a separate stream of
// the same seed, so the domestic shocks of a seed are the same in both.

import { withDefaults, lowerBoundDev, steadyNominalAnn } from '../model/params.js';
import { fxLevel } from '../model/open.js';
import { mulberry32, gaussian, normalizeSeed } from './rng.js';
import { gameModel, shockAt } from './economy.js';

export const RATE_STEP = 0.25;
export const GAME_LENGTH = Object.freeze({ min: 8, max: 40, step: 1 });
export const DIFFICULTY = Object.freeze({ easy: 0.6, medium: 1, hard: 1.35 });

export const GAME_DEFAULTS = Object.freeze({
  seed: 1998, // the year the Czech National Bank switched to inflation targeting
  length: 24,
  difficulty: 'medium',
  warmup: 4,
  economy: 'closed',
});

// Credibility starts below its ceiling and has to be earned (see hybrid.js).
export const GAME_PARAMS = Object.freeze({
  endogenousAnchoring: true,
  anchoring: 0.9,
  anchorInit: 0.6,
  anchorSpeed: 0.3,
});

// Shock processes in annualized p.p.: AR(1) with Gaussian innovations plus rare
// large "events" (an energy price spike, a collapse in demand) that make the news.
// Difficulty scales both innovations and events. The demand shocks are kept small
// enough that the lower bound binds only occasionally: with backward-looking
// expectations a long stay at the bound can turn into a deflation trap that no rate
// setting can escape (it still happens in rare hard games).
export const SHOCK_PROCESS = Object.freeze({
  rn: { rho: 0.7, sd: 0.4, eventProb: 0.06, eventSize: 3.5, eventUp: 0.45 },
  u: { rho: 0.7, sd: 0.4, eventProb: 0.06, eventSize: 4, eventUp: 0.75 },
});

// Foreign shocks of the open economy (foreign rate and risk premium in annualized
// p.p., foreign demand in % of potential); events make the news too.
export const FOREIGN_PROCESS = Object.freeze({
  istar: { rho: 0.9, sd: 0.15, eventProb: 0, eventSize: 0, eventUp: 0.5 },
  ystar: { rho: 0.8, sd: 0.4, eventProb: 0.05, eventSize: 3, eventUp: 0.4 },
  chi: { rho: 0.7, sd: 0.7, eventProb: 0.05, eventSize: 3.5, eventUp: 0.6 },
});
const SCALE = { rn: 4, u: 4, istar: 4, ystar: 1, chi: 4 };

// Measurement noise of the first data release (standard deviations): the output
// gap is much harder to measure than inflation.
export const NOISE = Object.freeze({ inflation: 0.3, gap: 0.9, expectations: 0.2 });

// The government replaces the board when the economy gets out of hand (true
// values after the quarter, inflation in p.p. from target, gap in % of potential).
// The game then ends early and the quarters played are reviewed.
export const FIRE = Object.freeze({ inflation: 10, gap: 12 });

const round = (v, step) => Math.round(v / step) * step;

export function rateToModel(level, p) {
  return (level - steadyNominalAnn(p)) / 4;
}
export function rateToLevel(i, p) {
  return 4 * i + steadyNominalAnn(p);
}
export const inflationLevel = (pi, p) => 4 * pi + p.targetAnn;

// One AR(1) process with events: fills ann[k] and news[k].
function evolve(sp, z, e, k, prev, scale, calm, warmup, kind, news) {
  let innovation = calm * scale * sp.sd * z;
  if (k >= warmup && e < sp.eventProb) {
    // Rescale the uniform below eventProb to a fresh uniform for the sign.
    const up = e / sp.eventProb < sp.eventUp;
    innovation += (up ? 1 : -1) * scale * sp.eventSize * sp.sd;
    if (!news[k] || Math.abs(innovation / sp.sd) > Math.abs(news[k].size)) news[k] = { kind, sign: up ? 1 : -1, size: innovation / sp.sd };
  }
  return sp.rho * prev + innovation;
}

// Shocks, measurement noise and news for T quarters from one seed.
export function drawGame(seed, T, difficulty = 'medium', warmup = 0, economy = 'closed') {
  const rand = mulberry32(normalizeSeed(seed));
  const scale = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const ann = { rn: new Array(T).fill(0), u: new Array(T).fill(0) };
  const noise = { inflation: [], gap: [], expectations: [] };
  const news = new Array(T).fill(null);
  const prev = { rn: 0, u: 0 };
  for (let k = 0; k < T; k++) {
    // Fixed block of draws per quarter: 2 innovations, 2 event uniforms, 3 noises.
    const z = { rn: gaussian(rand), u: gaussian(rand) };
    const e = { rn: rand(), u: rand() };
    noise.inflation.push(NOISE.inflation * gaussian(rand));
    noise.gap.push(NOISE.gap * gaussian(rand));
    noise.expectations.push(NOISE.expectations * gaussian(rand));
    const calm = k < warmup ? 0.5 : 1;
    for (const kind of ['rn', 'u']) {
      ann[kind][k] = evolve(SHOCK_PROCESS[kind], z[kind], e[kind], k, prev[kind], scale, calm, warmup, kind, news);
      prev[kind] = ann[kind][k];
    }
  }
  if (economy === 'open') {
    // Separate stream: the domestic draws of a seed do not depend on the economy.
    const frand = mulberry32((normalizeSeed(seed) ^ 0x5bd1e995) >>> 0 || 1);
    const fnews = new Array(T).fill(null);
    for (const kind of Object.keys(FOREIGN_PROCESS)) { ann[kind] = new Array(T).fill(0); prev[kind] = 0; }
    for (let k = 0; k < T; k++) {
      const draws = Object.keys(FOREIGN_PROCESS).map((kind) => [kind, gaussian(frand), frand()]);
      const calm = k < warmup ? 0.5 : 1;
      for (const [kind, z, e] of draws) {
        ann[kind][k] = evolve(FOREIGN_PROCESS[kind], z, e, k, prev[kind], scale, calm, warmup, kind, fnews);
        prev[kind] = ann[kind][k];
      }
      if (!news[k] && fnews[k]) news[k] = fnews[k];
    }
  }
  const paths = { v: new Array(T).fill(0) };
  for (const [kind, arr] of Object.entries(ann)) paths[kind] = arr.map((v) => v / SCALE[kind]);
  return { paths, noise, news: news.map((n) => (n ? { kind: n.kind, sign: n.sign } : null)) };
}

const emptyPath = (T, keys) => Object.fromEntries(keys.map((k) => [k, new Array(T).fill(NaN)]));

function record(path, k, step) {
  for (const key of Object.keys(path)) path[key][k] = step[key];
}

// config = { seed, length, difficulty, warmup, params }
// overrides (tests): { paths, noise, news } replace the random draws.
export function createGame(config = {}, overrides = {}) {
  const cfg = { ...GAME_DEFAULTS, ...config };
  cfg.seed = normalizeSeed(cfg.seed);
  const params = withDefaults({ ...GAME_PARAMS, ...(config.params || {}) });
  const T = cfg.warmup + cfg.length;
  const model = gameModel(cfg.economy);
  const drawn = drawGame(cfg.seed, T, cfg.difficulty, cfg.warmup, cfg.economy);
  const paths = overrides.paths || drawn.paths;
  const noise = overrides.noise || drawn.noise;
  const news = overrides.news || drawn.news;
  const path = emptyPath(T, model.pathKeys);
  const rates = [];
  let state = model.init(params);
  for (let k = 0; k < cfg.warmup; k++) {
    const step = model.step(params, state, shockAt(model, paths, k), null);
    record(path, k, step);
    rates.push(rateToLevel(step.i, params));
    state = step.state;
  }
  return { config: cfg, params, T, warmup: cfg.warmup, paths, noise, news, t: cfg.warmup, state, path, rates, fired: null };
}

export const isOver = (game) => game.t >= game.T || Boolean(game.fired);

// Everything the player is allowed to see at the start of quarter game.t:
// noisy data for earlier quarters, the rates already set and today's news.
// The true state of the economy is deliberately not part of it.
export function observe(game) {
  const p = game.params;
  const history = [];
  for (let k = 0; k < game.t; k++) {
    history.push({
      k,
      inflation: inflationLevel(game.path.pi[k], p) + game.noise.inflation[k],
      gap: game.path.x[k] + game.noise.gap[k],
      expectations: inflationLevel(game.path.Epi[k], p) + game.noise.expectations[k],
      rate: game.rates[k],
      // The exchange rate is a market price, seen exactly (open economy only).
      ...(game.config.economy === 'open' ? { fx: fxLevel(game.path.e[k], p) } : {}),
    });
  }
  return {
    t: game.t,
    quarter: game.t - game.warmup + 1, // 1-based number of the quarter being decided
    length: game.config.length,
    warmup: game.warmup,
    economy: game.config.economy,
    over: isOver(game),
    history,
    news: isOver(game) ? null : game.news[game.t],
    lastRate: game.rates[game.t - 1],
    lowerBound: p.lowerBoundAnn,
    target: p.targetAnn,
    neutral: steadyNominalAnn(p),
  };
}

// Round a requested rate to the 0.25 p.p. grid and keep it above the lower bound.
export function clampRate(level, p) {
  return Math.max(p.lowerBoundAnn, round(level, RATE_STEP));
}

// The player sets the nominal rate (% p.a.) for quarter game.t. Returns a new game.
export function submitRate(game, level) {
  if (isOver(game)) throw new Error('The game is over');
  if (!Number.isFinite(level)) throw new Error('Rate must be a number');
  const p = game.params;
  const k = game.t;
  const chosen = clampRate(level, p);
  const model = gameModel(game.config.economy);
  const step = model.step(p, game.state, shockAt(model, game.paths, k), Math.max(lowerBoundDev(p), rateToModel(chosen, p)));
  const path = Object.fromEntries(Object.entries(game.path).map(([key, arr]) => [key, arr.slice()]));
  record(path, k, step);
  const inflDev = inflationLevel(step.pi, p) - p.targetAnn;
  let fired = null;
  if (Math.abs(inflDev) > FIRE.inflation) fired = { k, reason: inflDev > 0 ? 'inflation' : 'deflation', value: inflDev + p.targetAnn };
  else if (Math.abs(step.x) > FIRE.gap) fired = { k, reason: step.x > 0 ? 'boom' : 'slump', value: step.x };
  return { ...game, t: k + 1, state: step.state, path, rates: [...game.rates, chosen], fired };
}

// Forced rates (model units) of the player's run: NaN = Taylor rule (history).
export function playerRates(game) {
  const p = game.params;
  return game.rates.map((r, k) => (k < game.warmup ? NaN : rateToModel(r, p)));
}
