// Public entry point of the model core. No DOM, no rendering.

import { withDefaults, toLevels, steadyNominalAnn } from './params.js';
import { solveRational } from './rational.js';
import { solveHybrid } from './hybrid.js';
import { residuals } from './check.js';
import { shockEnd } from './shocks.js';
import { solveOpenRational, solveOpenHybrid, openResiduals, fxLevel } from './open.js';

export * from './params.js';
export { determinacy, taylorPrincipleValue, transitionMatrix } from './determinacy.js';
export { solveRational, mucCoefficients } from './rational.js';
export { solveHybrid, stepHybrid, initialHybridState, nextAnchoring } from './hybrid.js';
export { residuals } from './check.js';
export { shockPaths, shockEnd, SHOCK_KINDS, CLOSED_KINDS, OPEN_KINDS, SHOCK_SCALE } from './shocks.js';
export {
  solveOpenRational, solveOpenHybrid, stepOpen, initialOpenState, openDeterminacy, openTransition,
  openResiduals, floorPath, fxLevel, fxDeviation,
} from './open.js';
export {
  decompose, decomposeDisplay, causalFlows, TERMS, OPEN_TERMS, termsFor, DISPLAY_SCALE, FLOW_TARGET,
  OPEN_FLOW_TARGET, flowTargetFor,
} from './decompose.js';

// Solver horizon for perfect foresight: long enough that the terminal condition
// x_T = pi_T = 0 is harmless for the displayed window.
export function solverHorizon(horizon, economy = 'closed') {
  // The open model has slower components (exchange rate, import prices), so its
  // terminal condition is placed further out; the banded solver keeps this cheap.
  return economy === 'open' ? Math.max(130, horizon + 90) : Math.max(60, horizon + 40);
}

// Annualized levels of the open-economy variables for display.
export function toOpenLevels(view, p) {
  const n = view.x.length;
  const map = (arr, scale, shift) => Array.from({ length: n }, (_, t) => scale * arr[t] + shift);
  return {
    ...toLevels(view, p),
    domestic: map(view.piH, 4, p.targetAnn),
    imported: map(view.piF, 4, p.targetAnn),
    foreignRate: map(view.istar, 4, steadyNominalAnn(p)),
    fx: Array.from({ length: n }, (_, t) => fxLevel(view.e[t], p)),
    realFx: Array.from(view.q),
    intervention: map(view.xi, 4, 0),
    fxFloor: Array.from({ length: n }, (_, t) => (Number.isNaN(view.floor[t]) ? NaN : fxLevel(view.floor[t], p))),
  };
}

// toOpenLevels needs the full fields of an open solution (game runs included).
const CLOSED_VIEW = ['x', 'pi', 'i', 'r', 'Ex', 'Epi', 'rn', 'u', 'v', 'shadow', 'atBound', 'forced'];
const OPEN_VIEW = [...CLOSED_VIEW, 'c', 'piH', 'piF', 'd', 'q', 'P', 'e', 'xi', 'Eq', 'istar', 'ystar', 'chi', 'atFloor', 'floor'];

// Run one scenario in one expectations mode.
//   spec = { params, shocks, policy, horizon, forwardGuidance }
//   shocks = list of shock specs, or ready-made paths { rn, u, v } (model units)
//   policy = { delay, holdUntil, rates }  (see policy.js)
//   forwardGuidance = N  -> hold the rate at the bound N quarters after the
//                           (step) shock ends
export function simulate(spec, mode) {
  const p = withDefaults(spec.params);
  const horizon = spec.horizon ?? 24;
  const open = spec.economy === 'open';
  const policy = { ...(spec.policy || {}) };
  if (spec.forwardGuidance > 0) {
    policy.holdUntil = shockEnd(spec.shocks) + spec.forwardGuidance;
  }
  let sol;
  if (open) {
    sol = mode === 'hybrid'
      ? solveOpenHybrid(p, spec.shocks, policy, horizon)
      : solveOpenRational(p, spec.shocks, policy, solverHorizon(horizon, 'open'));
  } else {
    sol = mode === 'hybrid'
      ? solveHybrid(p, spec.shocks, policy, horizon)
      : solveRational(p, spec.shocks, policy, solverHorizon(horizon));
  }
  if (!sol.determinate) return { ...sol, economy: open ? 'open' : 'closed', horizon };
  const check = open ? openResiduals(sol, p) : residuals(sol, p);
  const trim = (a) => Array.from(a).slice(0, horizon);
  const view = {};
  for (const k of open ? OPEN_VIEW : CLOSED_VIEW) view[k] = trim(sol[k]);
  if (sol.w) view.w = trim(sol.w);
  return {
    ...sol,
    ...view,
    economy: open ? 'open' : 'closed',
    horizon,
    residual: check.max,
    levels: open ? toOpenLevels(view, p) : toLevels(view, p),
  };
}
