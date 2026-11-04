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
// inflation has been from target, s_t = (1 - lambda) s_{t-1} + lambda |4 pi_t|, and
//   w_{t+1} = wbar * exp(-max(0, s_t - band) / band),
// so credibility erodes only when inflation stays outside the band for a while and
// rebuilds once it is back near target.

import { shockPaths } from './shocks.js';
import { policyOverrides } from './policy.js';
import { lowerBoundDev } from './params.js';

const EXPLOSIVE = 1e4;

export function nextAnchoring(p, memory) {
  const band = p.anchorBand;
  return p.anchoring * Math.exp(-Math.max(0, memory - band) / band);
}

export function solveHybrid(p, shocks, policy, T = 40) {
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const lb = lowerBoundDev(p);
  const paths = shockPaths(shocks, T);
  const forced = policyOverrides(policy, T, lb);
  const out = {
    x: new Float64Array(T), pi: new Float64Array(T), i: new Float64Array(T),
    r: new Float64Array(T), Ex: new Float64Array(T), Epi: new Float64Array(T),
    shadow: new Float64Array(T), w: new Float64Array(T), memory: new Float64Array(T),
  };
  const atBound = new Array(T).fill(false);
  let xPrev = 0;
  let piPrev = 0;
  let w = p.anchoring;
  let memory = 0;
  let stable = true;

  for (let t = 0; t < T; t++) {
    const Epi = (1 - w) * piPrev;
    const Ex = xPrev;
    const rn = paths.rn[t];
    const u = paths.u[t];
    const v = paths.v[t];
    const given = (i) => {
      const x = Ex - sigma * (i - Epi - rn);
      return { x, pi: beta * Epi + kappa * x + u };
    };
    let i;
    if (!Number.isNaN(forced[t])) {
      i = forced[t];
    } else {
      // Unconstrained: substitute NKPC and TR into IS and solve for x.
      const x = (Ex - sigma * (phiPi * (beta * Epi + u) + v - Epi - rn)) /
        (1 + sigma * phiX + sigma * phiPi * kappa);
      const pi = beta * Epi + kappa * x + u;
      i = Math.max(lb, phiPi * pi + phiX * x + v);
    }
    const { x, pi } = given(i);
    out.x[t] = x; out.pi[t] = pi; out.i[t] = i;
    out.Ex[t] = Ex; out.Epi[t] = Epi; out.r[t] = i - Epi;
    out.shadow[t] = phiPi * pi + phiX * x + v;
    out.w[t] = w;
    atBound[t] = Math.abs(i - lb) < 1e-9;
    if (!(Math.abs(x) < EXPLOSIVE && Math.abs(pi) < EXPLOSIVE)) stable = false;

    const lambda = p.anchorMemory;
    memory = (1 - lambda) * memory + lambda * Math.abs(4 * pi);
    out.memory[t] = memory;
    if (p.endogenousAnchoring) w = nextAnchoring(p, memory);
    xPrev = x;
    piPrev = pi;
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
