// Hybrid / adaptive expectations, solved by stepping forward in time.
//
//   E_t pi_{t+1} = w_t * 0 + (1 - w_t) pi_{t-1}     (0 = target, in deviations)
//   E_t x_{t+1}  = x_{t-1}
//
// In every quarter the IS curve, the Phillips curve and the Taylor rule with the
// lower bound are solved simultaneously. Because the Taylor-implied rate is a
// decreasing function of the actual rate, i_t = max(lb, T(i_t)) has a unique solution:
// either the unconstrained Taylor solution, or the rate pinned at the bound.
//
// Endogenous anchoring (optional): s_t is a running memory of how far annualized
// inflation has been from target, s_t = (1 - lambda) s_{t-1} + lambda |4 pi_t|. The
// credibility the public would grant after such a record is
//   w*_t = wbar * exp(-max(0, s_t - band) / band),
// and w moves towards it at speed g:  w_{t+1} = w_t + g (w*_t - w_t).
// With the default g = 1 this is simply w_{t+1} = w*_t, so credibility erodes only
// when inflation stays outside the band for a while and rebuilds once it is back
// near target. The game uses g < 1 and a starting value below wbar, so credibility
// has to be earned gradually.
//
// The model is exposed both as a single step (stepHybrid, used by the game, where
// the player sets the rate one quarter at a time) and as a whole path (solveHybrid).

import { shockPaths } from './shocks.js';
import { policyOverrides } from './policy.js';
import { lowerBoundDev } from './params.js';

const EXPLOSIVE = 1e4;

export function nextAnchoring(p, memory, w = p.anchoring) {
  const band = p.anchorBand;
  const target = p.anchoring * Math.exp(-Math.max(0, memory - band) / band);
  const speed = p.anchorSpeed ?? 1;
  return w + speed * (target - w);
}

// State carried from one quarter to the next.
export function initialHybridState(p) {
  return { xPrev: 0, piPrev: 0, w: p.anchorInit ?? p.anchoring, memory: 0 };
}

// One quarter of the hybrid model.
//   state  { xPrev, piPrev, w, memory } from initialHybridState or a previous step
//   shock  { rn, u, v } in model units (missing = 0)
//   rate   forced nominal rate in model units, or null/NaN for the Taylor rule;
//          a forced rate below the lower bound is lifted to the bound
// Returns the quarter's variables and the next state; the inputs are not modified.
export function stepHybrid(p, state, shock = {}, rate = null) {
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const lb = lowerBoundDev(p);
  const w = state.w;
  const Epi = (1 - w) * state.piPrev;
  const Ex = state.xPrev;
  const rn = shock.rn || 0;
  const u = shock.u || 0;
  const v = shock.v || 0;
  const isForced = rate !== null && rate !== undefined && Number.isFinite(rate);
  let i;
  if (isForced) {
    i = Math.max(lb, rate);
  } else {
    // Unconstrained: substitute NKPC and TR into IS and solve for x.
    const xu = (Ex - sigma * (phiPi * (beta * Epi + u) + v - Epi - rn)) /
      (1 + sigma * phiX + sigma * phiPi * kappa);
    const piu = beta * Epi + kappa * xu + u;
    i = Math.max(lb, phiPi * piu + phiX * xu + v);
  }
  const x = Ex - sigma * (i - Epi - rn);
  const pi = beta * Epi + kappa * x + u;

  const lambda = p.anchorMemory;
  const memory = (1 - lambda) * state.memory + lambda * Math.abs(4 * pi);
  const wNext = p.endogenousAnchoring ? nextAnchoring(p, memory, w) : w;
  return {
    x, pi, i, r: i - Epi, Ex, Epi, rn, u, v,
    shadow: phiPi * pi + phiX * x + v,
    w,
    memory,
    atBound: Math.abs(i - lb) < 1e-9,
    forced: isForced ? i : NaN,
    stable: Math.abs(x) < EXPLOSIVE && Math.abs(pi) < EXPLOSIVE,
    state: { xPrev: x, piPrev: pi, w: wNext, memory },
  };
}

// Whole path: shocks are specs or ready-made paths (see shocks.js), policy as in
// policy.js (delay, holdUntil, explicit rates).
export function solveHybrid(p, shocks, policy, T = 40) {
  const lb = lowerBoundDev(p);
  const paths = shockPaths(shocks, T);
  const forced = policyOverrides(policy, T, lb);
  const out = {
    x: new Float64Array(T), pi: new Float64Array(T), i: new Float64Array(T),
    r: new Float64Array(T), Ex: new Float64Array(T), Epi: new Float64Array(T),
    shadow: new Float64Array(T), w: new Float64Array(T), memory: new Float64Array(T),
  };
  const atBound = new Array(T).fill(false);
  let state = initialHybridState(p);
  let stable = true;

  for (let t = 0; t < T; t++) {
    const shock = { rn: paths.rn[t], u: paths.u[t], v: paths.v[t] };
    const step = stepHybrid(p, state, shock, Number.isNaN(forced[t]) ? null : forced[t]);
    for (const k of Object.keys(out)) out[k][t] = step[k];
    atBound[t] = step.atBound;
    if (!step.stable) stable = false;
    state = step.state;
  }

  return {
    mode: 'hybrid',
    method: 'forward',
    determinate: true,
    converged: true,
    stable,
    T,
    lb,
    ...out,
    atBound,
    forced: Array.from(forced),
    rn: paths.rn, u: paths.u, v: paths.v,
  };
}
