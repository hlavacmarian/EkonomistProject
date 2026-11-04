// Rational-expectations solutions of the three-equation NK model.
//
//   (IS)   x_t  = m E_t x_{t+1} - sigma (i_t - E_t pi_{t+1} - rn_t)
//   (NKPC) pi_t = beta m E_t pi_{t+1} + kappa x_t + u_t
//   (TR)   i_t  = max(lb, phiPi pi_t + phiX x_t + v_t)
//
// m = expDiscount (cognitive discounting, Gabaix 2020); m = 1 is the textbook model.
//
// Two methods:
//  * undetermined coefficients (MUC) for AR(1) shocks when the lower bound never binds;
//  * perfect foresight over a horizon T with terminal condition x_T = pi_T = 0, solved
//    as one linear system; the lower bound is handled by guess-and-verify over regimes
//    (the set of quarters in which i_t sits at the bound).

import { solveLinear } from './linalg.js';
import { determinacy } from './determinacy.js';
import { shockPaths, isAr1Only } from './shocks.js';
import { policyOverrides, hasOverrides } from './policy.js';
import { lowerBoundDev } from './params.js';

const BOUND_TOL = 1e-10;

// Coefficients of x_t = a z_t, pi_t = b z_t, i_t = c z_t for a single AR(1) shock z.
export function mucCoefficients(p, kind, rho) {
  const m = p.expDiscount ?? 1;
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const crn = kind === 'rn' ? 1 : 0;
  const cu = kind === 'u' ? 1 : 0;
  const cv = kind === 'v' ? 1 : 0;
  // a (1 - m rho + sigma phiX) + b sigma (phiPi - rho) = sigma (crn - cv)
  // -kappa a + b (1 - beta m rho)                     = cu
  const a11 = 1 - m * rho + sigma * phiX;
  const a12 = sigma * (phiPi - rho);
  const a21 = -kappa;
  const a22 = 1 - beta * m * rho;
  const r1 = sigma * (crn - cv);
  const r2 = cu;
  const det = a11 * a22 - a12 * a21;
  const a = (r1 * a22 - a12 * r2) / det;
  const b = (a11 * r2 - a21 * r1) / det;
  return { a, b, c: phiPi * b + phiX * a + cv };
}

function solveMUC(p, shocks, T) {
  const x = new Float64Array(T + 1);
  const pi = new Float64Array(T + 1);
  const i = new Float64Array(T + 1);
  for (const s of shocks || []) {
    const { a, b, c } = mucCoefficients(p, s.kind, s.rho);
    for (let t = 0; t <= T; t++) {
      const z = (s.size / 4) * Math.pow(s.rho, t);
      x[t] += a * z;
      pi[t] += b * z;
      i[t] += c * z;
    }
  }
  return { x, pi, i };
}

// One perfect-foresight solve for a given regime.
// fixed[t] = forced value of i_t (bound or override), NaN where the Taylor rule holds.
function solvePF(p, paths, fixed, T) {
  const m = p.expDiscount ?? 1;
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const n = 3 * T;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  const X = (t) => t;
  const P = (t) => T + t;
  const I = (t) => 2 * T + t;
  for (let t = 0; t < T; t++) {
    // IS: x_t - m x_{t+1} + sigma i_t - sigma pi_{t+1} = sigma rn_t
    let r = X(t);
    A[r * n + X(t)] = 1;
    if (t + 1 < T) {
      A[r * n + X(t + 1)] = -m;
      A[r * n + P(t + 1)] = -sigma;
    }
    A[r * n + I(t)] = sigma;
    b[r] = sigma * paths.rn[t];
    // NKPC: pi_t - beta m pi_{t+1} - kappa x_t = u_t
    r = P(t);
    A[r * n + P(t)] = 1;
    if (t + 1 < T) A[r * n + P(t + 1)] = -beta * m;
    A[r * n + X(t)] = -kappa;
    b[r] = paths.u[t];
    // Policy: Taylor rule or fixed rate
    r = I(t);
    A[r * n + I(t)] = 1;
    if (Number.isNaN(fixed[t])) {
      A[r * n + P(t)] = -phiPi;
      A[r * n + X(t)] = -phiX;
      b[r] = paths.v[t];
    } else {
      b[r] = fixed[t];
    }
  }
  const z = solveLinear(A, b, n);
  const x = new Float64Array(T + 1);
  const pi = new Float64Array(T + 1);
  const i = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    x[t] = z[X(t)];
    pi[t] = z[P(t)];
    i[t] = z[I(t)];
  }
  return { x, pi, i }; // x[T] = pi[T] = 0 (terminal condition)
}

function solvePerfectForesight(p, paths, forced, lb, T) {
  const { phiPi, phiX } = p;
  const bound = new Uint8Array(T);
  const seen = new Set();
  let sol;
  let converged = false;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    const fixed = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      fixed[t] = !Number.isNaN(forced[t]) ? forced[t] : bound[t] ? lb : NaN;
    }
    sol = solvePF(p, paths, fixed, T);
    let changed = false;
    for (let t = 0; t < T; t++) {
      if (!Number.isNaN(forced[t])) continue;
      const shadow = phiPi * sol.pi[t] + phiX * sol.x[t] + paths.v[t];
      const next = bound[t] ? shadow < lb + BOUND_TOL : shadow < lb - BOUND_TOL;
      if (next !== Boolean(bound[t])) { bound[t] = next ? 1 : 0; changed = true; }
    }
    if (!changed) { converged = true; iterations++; break; }
    const key = bound.join('');
    if (seen.has(key)) break; // cycling between regimes
    seen.add(key);
  }
  return { ...sol, bound, converged, iterations };
}

function finalize(p, raw, paths, forced, lb, T, extra) {
  const { phiPi, phiX } = p;
  const x = raw.x.slice(0, T);
  const pi = raw.pi.slice(0, T);
  const i = raw.i.slice(0, T);
  const Ex = raw.x.slice(1, T + 1);
  const Epi = raw.pi.slice(1, T + 1);
  const r = i.map((v, t) => v - Epi[t]);
  const shadow = x.map((_, t) => phiPi * pi[t] + phiX * x[t] + paths.v[t]);
  const atBound = Array.from(i, (v) => Math.abs(v - lb) < 1e-9);
  return {
    mode: 'rational',
    determinate: true,
    T,
    lb,
    x, pi, i, r, Ex, Epi, shadow, atBound,
    forced: Array.from(forced),
    rn: paths.rn.slice(0, T),
    u: paths.u.slice(0, T),
    v: paths.v.slice(0, T),
    ...extra,
  };
}

export function solveRational(p, shocks, policy, T = 60) {
  const det = determinacy(p);
  if (!det.determinate) {
    return { mode: 'rational', determinate: false, determinacy: det, T };
  }
  const lb = lowerBoundDev(p);
  const paths = shockPaths(shocks, T + 1);
  const forced = policyOverrides(policy, T, lb);

  if (isAr1Only(shocks) && !hasOverrides(policy)) {
    const raw = solveMUC(p, shocks, T);
    let ok = true;
    for (let t = 0; t < T; t++) if (raw.i[t] < lb - BOUND_TOL) { ok = false; break; }
    if (ok) {
      return finalize(p, raw, paths, forced, lb, T, {
        method: 'muc', converged: true, iterations: 0, determinacy: det,
      });
    }
  }
  const raw = solvePerfectForesight(p, paths, forced, lb, T);
  return finalize(p, raw, paths, forced, lb, T, {
    method: 'pf',
    converged: raw.converged,
    iterations: raw.iterations,
    determinacy: det,
  });
}
