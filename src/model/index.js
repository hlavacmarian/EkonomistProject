// Public entry point of the model core. No DOM, no rendering.

import { withDefaults, toLevels } from './params.js';
import { solveRational } from './rational.js';
import { solveHybrid } from './hybrid.js';
import { residuals } from './check.js';
import { shockEnd } from './shocks.js';

export * from './params.js';
export { determinacy, taylorPrincipleValue, transitionMatrix } from './determinacy.js';
export { solveRational, mucCoefficients } from './rational.js';
export { solveHybrid, nextAnchoring } from './hybrid.js';
export { residuals } from './check.js';
export { shockPaths, shockEnd } from './shocks.js';

// Solver horizon for perfect foresight: long enough that the terminal condition
// x_T = pi_T = 0 is harmless for the displayed window.
export function solverHorizon(horizon) {
  return Math.max(60, horizon + 40);
}

// Run one scenario in one expectations mode.
//   spec = { params, shocks, policy, horizon, forwardGuidance }
//   forwardGuidance = N  -> hold the rate at the bound N quarters after the
//                           (step) shock ends
export function simulate(spec, mode) {
  const p = withDefaults(spec.params);
  const horizon = spec.horizon ?? 24;
  const policy = { ...(spec.policy || {}) };
  if (spec.forwardGuidance > 0) {
    policy.holdUntil = shockEnd(spec.shocks) + spec.forwardGuidance;
  }
  const sol = mode === 'hybrid'
    ? solveHybrid(p, spec.shocks, policy, horizon)
    : solveRational(p, spec.shocks, policy, solverHorizon(horizon));
  if (!sol.determinate) return { ...sol, horizon };
  const check = residuals(sol, p);
  const trim = (a) => Array.from(a).slice(0, horizon);
  const view = {};
  for (const k of ['x', 'pi', 'i', 'r', 'Ex', 'Epi', 'rn', 'u', 'v', 'shadow', 'atBound', 'forced']) {
    view[k] = trim(sol[k]);
  }
  if (sol.w) view.w = trim(sol.w);
  return {
    ...sol,
    ...view,
    horizon,
    residual: check.max,
    levels: toLevels(view, p),
  };
}
