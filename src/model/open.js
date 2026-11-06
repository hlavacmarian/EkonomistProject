// Small open economy: a simplified model in the spirit of Galí & Monacelli (2005),
// written in the semi-structural form used by inflation-targeting central banks
// (uncovered interest parity with a risk premium instead of complete risk sharing,
// so that exchange-rate shocks and an exchange-rate floor can be studied).
//
// All variables are deviations from steady state in quarterly units (%), q and e in %.
//
//   (IS)   x_t   = c_t + δ q_t + γ y*_t                           demand = domestic demand + net exports
//          c_t   = m E_t c_{t+1} − σ (i_t − E_t πH_{t+1} − rn_t)   domestic demand (Euler equation)
//   (NKPC) πH_t  = β m E_t πH_{t+1} + κ x_t + u_t                  domestic (producer) inflation
//   (CPI)  π_t   = (1 − α) πH_t + α πF_t                           consumer inflation, import share α
//          πF_t  = ψ (d_{t−1} + Δe_t),  d_t = (1 − ψ)(d_{t−1} + Δe_t)
//                  import prices close a share ψ of their gap d to the exchange rate each quarter
//   (UIP)  q_t   = E_t q_{t+1} − (i_t − E_t πH_{t+1} − i*_t) + χ_t + ξ_t
//                  real exchange rate (+ = weaker koruna); i* foreign rate, χ risk premium,
//                  ξ ≥ 0 central-bank interventions that keep the koruna at a floor
//          e_t   = q_t + PH_t,  PH_t = PH_{t−1} + πH_t,  Δe_t = e_t − e_{t−1}   (foreign prices fixed)
//   (TR)   i_t   = max(lb, φπ πR_t + φx x_t + v_t),  πR = (1 − ω) π + ω πH
//                  the bank reacts to CPI inflation (ω = 0) or looks through the direct
//                  effect of import prices and reacts to domestic inflation (ω = 1)
//   floor  e_t ≥ ē during an exchange-rate commitment, ξ_t (e_t − ē) = 0
//
// With α = δ = γ = 0 and no foreign shocks the domestic block is exactly the closed
// model (tested). Expectations:
//   rational  perfect foresight over the horizon (identical to rational expectations for
//             the deterministic paths shown, AR(1) shocks included), one linear system
//             solved with a banded eliminator; the lower bound and the floor are handled
//             by guess-and-verify over regimes
//   hybrid    E c_{t+1} = c_{t−1}, E πH_{t+1} = (1 − w_t) πH_{t−1}, and regressive
//             exchange-rate expectations E q_{t+1} = θ q_t; solved quarter by quarter

import { solveBanded, eigenvalues, modulus } from './linalg.js';
import { shockPaths } from './shocks.js';
import { policyOverrides } from './policy.js';
import { lowerBoundDev } from './params.js';
import { nextAnchoring } from './hybrid.js';
import { taylorPrincipleValue } from './determinacy.js';

const VARS = ['x', 'c', 'piH', 'pi', 'piF', 'd', 'q', 'i', 'P'];
const NV = VARS.length;
const IDX = Object.fromEntries(VARS.map((v, k) => [v, k]));
const TOL = 1e-10;
const EXPLOSIVE = 1e4;

// Exchange-rate commitment: policy.fxFloor = { level, from, to }, level in % above
// the steady-state exchange rate (weaker koruna), active for from <= t < to.
export function floorPath(policy, T) {
  const f = new Float64Array(T).fill(NaN);
  const fl = policy?.fxFloor;
  if (!fl) return f;
  for (let t = Math.max(0, fl.from || 0); t < Math.min(T, fl.to ?? T); t++) f[t] = fl.level;
  return f;
}

// CZK per EUR <-> % deviation of the nominal exchange rate from steady state.
export const fxLevel = (e, p) => p.eurCzk * (1 + e / 100);
export const fxDeviation = (level, p) => (level / p.eurCzk - 1) * 100;

// ---------------------------------------------------------------------------
// Rational expectations: perfect foresight

// Inflation the rule reacts to.
const ruleInflation = (p, pi, piH) => (1 - (p.ruleDomestic || 0)) * pi + (p.ruleDomestic || 0) * piH;

function solvePF(p, paths, fixedRate, floorBind, floor, T) {
  const m = p.expDiscount ?? 1;
  const { beta, sigma, kappa, phiPi, phiX, alpha, delta, gamma, passThrough: psi } = p;
  const omega = p.ruleDomestic || 0;
  const n = NV * T;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  const set = (r, v, t, val) => { if (t >= 0 && t < T) A[r * n + t * NV + IDX[v]] += val; };
  for (let t = 0; t < T; t++) {
    const r0 = t * NV;
    // demand = domestic demand + net exports
    set(r0, 'x', t, 1); set(r0, 'c', t, -1); set(r0, 'q', t, -delta);
    b[r0] = gamma * paths.ystar[t];
    // Euler equation (terminal condition c_T = πH_T = 0)
    set(r0 + 1, 'c', t, 1); set(r0 + 1, 'c', t + 1, -m); set(r0 + 1, 'i', t, sigma); set(r0 + 1, 'piH', t + 1, -sigma);
    b[r0 + 1] = sigma * paths.rn[t];
    // Phillips curve for domestic goods
    set(r0 + 2, 'piH', t, 1); set(r0 + 2, 'piH', t + 1, -beta * m); set(r0 + 2, 'x', t, -kappa);
    b[r0 + 2] = paths.u[t];
    // import prices: πF = ψ(d_{t-1} + Δe), Δe = q - q_{t-1} + πH
    set(r0 + 3, 'piF', t, 1); set(r0 + 3, 'd', t - 1, -psi);
    set(r0 + 3, 'q', t, -psi); set(r0 + 3, 'q', t - 1, psi); set(r0 + 3, 'piH', t, -psi);
    // gap between import prices and the exchange rate
    set(r0 + 4, 'd', t, 1); set(r0 + 4, 'd', t - 1, -(1 - psi));
    set(r0 + 4, 'q', t, -(1 - psi)); set(r0 + 4, 'q', t - 1, 1 - psi); set(r0 + 4, 'piH', t, -(1 - psi));
    // CPI
    set(r0 + 5, 'pi', t, 1); set(r0 + 5, 'piH', t, -(1 - alpha)); set(r0 + 5, 'piF', t, -alpha);
    // UIP (terminal condition q_T = 0), or the exchange rate held at the floor
    if (floorBind[t]) {
      set(r0 + 6, 'q', t, 1); set(r0 + 6, 'P', t, 1);
      b[r0 + 6] = floor[t];
    } else {
      set(r0 + 6, 'q', t, 1); set(r0 + 6, 'q', t + 1, -1); set(r0 + 6, 'i', t, 1); set(r0 + 6, 'piH', t + 1, -1);
      b[r0 + 6] = paths.istar[t] + paths.chi[t];
    }
    // policy: Taylor rule on CPI inflation, or a fixed rate
    set(r0 + 7, 'i', t, 1);
    if (Number.isNaN(fixedRate[t])) {
      set(r0 + 7, 'pi', t, -phiPi * (1 - omega)); set(r0 + 7, 'piH', t, -phiPi * omega); set(r0 + 7, 'x', t, -phiX);
      b[r0 + 7] = paths.v[t];
    } else {
      b[r0 + 7] = fixedRate[t];
    }
    // domestic price level
    set(r0 + 8, 'P', t, 1); set(r0 + 8, 'P', t - 1, -1); set(r0 + 8, 'piH', t, -1);
  }
  const z = solveBanded(A, b, n, 2 * NV, 2 * NV);
  const out = {};
  for (const v of VARS) out[v] = Float64Array.from({ length: T }, (_, t) => z[t * NV + IDX[v]]);
  return out;
}

function derive(p, raw, paths, T, mode) {
  const { phiPi, phiX, fxExpect: theta } = p;
  const lead = (a, t) => (t + 1 < T ? a[t + 1] : 0);
  const Ex = new Float64Array(T), Epi = new Float64Array(T), Eq = new Float64Array(T);
  const e = new Float64Array(T), xi = new Float64Array(T), r = new Float64Array(T), shadow = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    if (mode === 'rational') {
      Ex[t] = lead(raw.c, t); Epi[t] = lead(raw.piH, t); Eq[t] = lead(raw.q, t);
    } else {
      Ex[t] = raw.Ex[t]; Epi[t] = raw.Epi[t]; Eq[t] = theta * raw.q[t];
    }
    e[t] = raw.q[t] + raw.P[t];
    r[t] = raw.i[t] - Epi[t];
    xi[t] = raw.q[t] - (Eq[t] - (raw.i[t] - Epi[t] - paths.istar[t]) + paths.chi[t]);
    shadow[t] = phiPi * ruleInflation(p, raw.pi[t], raw.piH[t]) + phiX * raw.x[t] + paths.v[t];
  }
  return { Ex, Epi, Eq, e, xi, r, shadow };
}

export function solveOpenRational(p, shocks, policy, T = 60) {
  const det = openDeterminacy(p);
  if (!det.determinate) return { mode: 'rational', economy: 'open', determinate: false, determinacy: det, T };
  const lb = lowerBoundDev(p);
  const paths = shockPaths(shocks, T);
  const forced = policyOverrides(policy, T, lb);
  const floor = floorPath(policy, T);
  const bound = new Uint8Array(T);
  const floorBind = new Uint8Array(T);
  const seen = new Set();
  let raw, extra, converged = false, iterations = 0;
  for (; iterations < 300; iterations++) {
    const fixed = new Float64Array(T);
    for (let t = 0; t < T; t++) fixed[t] = !Number.isNaN(forced[t]) ? forced[t] : bound[t] ? lb : NaN;
    raw = solvePF(p, paths, fixed, floorBind, floor, T);
    extra = derive(p, raw, paths, T, 'rational');
    let changed = false;
    for (let t = 0; t < T; t++) {
      if (Number.isNaN(forced[t])) {
        const s = extra.shadow[t];
        const next = bound[t] ? s < lb + TOL : s < lb - TOL;
        if (next !== Boolean(bound[t])) { bound[t] = next ? 1 : 0; changed = true; }
      }
      if (!Number.isNaN(floor[t])) {
        const next = floorBind[t] ? extra.xi[t] > -TOL : extra.e[t] < floor[t] - TOL;
        if (next !== Boolean(floorBind[t])) { floorBind[t] = next ? 1 : 0; changed = true; }
      }
    }
    if (!changed) { converged = true; iterations++; break; }
    const key = `${bound.join('')}|${floorBind.join('')}`;
    if (seen.has(key)) break;
    seen.add(key);
  }
  return finalize(p, raw, extra, paths, forced, floor, lb, T, 'rational', {
    method: 'pf', converged, iterations, determinacy: det, atFloor: Array.from(floorBind, Boolean),
  });
}

function finalize(p, raw, extra, paths, forced, floor, lb, T, mode, more) {
  const atBound = Array.from(raw.i, (v) => Math.abs(v - lb) < 1e-9);
  return {
    mode,
    economy: 'open',
    determinate: true,
    T,
    lb,
    x: raw.x, c: raw.c, pi: raw.pi, piH: raw.piH, piF: raw.piF, d: raw.d, q: raw.q, i: raw.i, P: raw.P,
    ...extra,
    atBound,
    forced: Array.from(forced),
    floor: Array.from(floor),
    rn: paths.rn, u: paths.u, v: paths.v, istar: paths.istar, ystar: paths.ystar, chi: paths.chi,
    ...more,
  };
}

// ---------------------------------------------------------------------------
// Hybrid expectations: one quarter at a time

export function initialOpenState(p) {
  return { cPrev: 0, piHPrev: 0, qPrev: 0, dPrev: 0, PPrev: 0, w: p.anchorInit ?? p.anchoring, memory: 0 };
}

// One quarter. shock = { rn, u, v, istar, ystar, chi } (model units), rate = forced
// rate or null (Taylor rule with the bound), floor = exchange-rate floor (% above
// steady state) or null/NaN. Inputs are not modified.
export function stepOpen(p, state, shock = {}, rate = null, floor = null) {
  const { beta, sigma, kappa, phiPi, phiX, alpha, delta, gamma, passThrough: psi, fxExpect: theta } = p;
  const lb = lowerBoundDev(p);
  const w = state.w;
  const Epi = (1 - w) * state.piHPrev;
  const Ec = state.cPrev;
  const s = { rn: 0, u: 0, v: 0, istar: 0, ystar: 0, chi: 0, ...shock };
  // Every current variable is affine in the rate i and the intervention ξ.
  const at = (i, xi) => {
    const q = (-(i - Epi - s.istar) + s.chi + xi) / (1 - theta);
    const c = Ec - sigma * (i - Epi - s.rn);
    const x = c + delta * q + gamma * s.ystar;
    const piH = beta * Epi + kappa * x + s.u;
    const de = q - state.qPrev + piH;
    const piF = psi * (state.dPrev + de);
    const d = (1 - psi) * (state.dPrev + de);
    const pi = (1 - alpha) * piH + alpha * piF;
    const P = state.PPrev + piH;
    return { q, c, x, piH, piF, d, pi, P, e: q + P, rule: phiPi * ruleInflation(p, pi, piH) + phiX * x + s.v };
  };
  const o = at(0, 0), ai = at(1, 0), ax = at(0, 1);
  const Si = ai.rule - o.rule, Sx = ax.rule - o.rule; // Taylor-implied rate, slope in i and ξ
  const Ei = ai.e - o.e, Exi = ax.e - o.e; // exchange rate, slope in i and ξ
  const isForced = rate !== null && rate !== undefined && Number.isFinite(rate);
  const rateFor = (xi) => (isForced ? Math.max(lb, rate) : Math.max(lb, (o.rule + Sx * xi) / (1 - Si)));
  let xi = 0;
  let i = rateFor(0);
  const hasFloor = floor !== null && floor !== undefined && Number.isFinite(floor);
  if (hasFloor && o.e + Ei * i < floor - TOL) {
    // Intervene so that the koruna sits exactly at the floor.
    if (isForced) {
      xi = (floor - o.e - Ei * i) / Exi;
    } else {
      xi = (floor - o.e - Ei * o.rule / (1 - Si)) / (Ei * Sx / (1 - Si) + Exi);
      i = (o.rule + Sx * xi) / (1 - Si);
      if (i < lb) { i = lb; xi = (floor - o.e - Ei * lb) / Exi; }
    }
  }
  const v = at(i, xi);
  const lambda = p.anchorMemory;
  const memory = (1 - lambda) * state.memory + lambda * Math.abs(4 * v.pi);
  const wNext = p.endogenousAnchoring ? nextAnchoring(p, memory, w) : w;
  return {
    x: v.x, c: v.c, pi: v.pi, piH: v.piH, piF: v.piF, d: v.d, q: v.q, i, P: v.P, e: v.e, xi,
    r: i - Epi, Ex: Ec, Epi, Eq: theta * v.q, shadow: v.rule,
    rn: s.rn, u: s.u, v: s.v, istar: s.istar, ystar: s.ystar, chi: s.chi,
    w, memory,
    atBound: Math.abs(i - lb) < 1e-9,
    atFloor: xi > TOL,
    forced: isForced ? i : NaN,
    stable: Math.abs(v.x) < EXPLOSIVE && Math.abs(v.pi) < EXPLOSIVE,
    state: { cPrev: v.c, piHPrev: v.piH, qPrev: v.q, dPrev: v.d, PPrev: v.P, w: wNext, memory },
  };
}

const STEP_KEYS = ['x', 'c', 'pi', 'piH', 'piF', 'd', 'q', 'i', 'P', 'e', 'xi', 'r', 'Ex', 'Epi', 'Eq', 'shadow', 'w', 'memory'];

export function solveOpenHybrid(p, shocks, policy, T = 40) {
  const lb = lowerBoundDev(p);
  const paths = shockPaths(shocks, T);
  const forced = policyOverrides(policy, T, lb);
  const floor = floorPath(policy, T);
  const out = Object.fromEntries(STEP_KEYS.map((k) => [k, new Float64Array(T)]));
  const atBound = new Array(T).fill(false);
  const atFloor = new Array(T).fill(false);
  let state = initialOpenState(p);
  let stable = true;
  for (let t = 0; t < T; t++) {
    const shock = Object.fromEntries(Object.keys(paths).map((k) => [k, paths[k][t]]));
    const st = stepOpen(p, state, shock, Number.isNaN(forced[t]) ? null : forced[t], floor[t]);
    for (const k of STEP_KEYS) out[k][t] = st[k];
    atBound[t] = st.atBound;
    atFloor[t] = st.atFloor;
    if (!st.stable) stable = false;
    state = st.state;
  }
  return {
    mode: 'hybrid', economy: 'open', method: 'forward', determinate: true, converged: true, stable, T, lb,
    ...out, atBound, atFloor,
    forced: Array.from(forced), floor: Array.from(floor),
    rn: paths.rn, u: paths.u, v: paths.v, istar: paths.istar, ystar: paths.ystar, chi: paths.chi,
  };
}

// ---------------------------------------------------------------------------
// Determinacy (rational regime, Taylor rule, no bound): E_t z_{t+1} = A z_t with
// z = (c, πH, q, q_{t−1}, d_{t−1}). c, πH and q are jump variables, the lags are
// predetermined, so a unique bounded solution needs exactly three eigenvalues of A
// outside the unit circle (Blanchard-Kahn). One eigenvalue is always exactly 1: a
// permanent real depreciation offset one for one by lower domestic demand
// (Δc = −δ Δq) leaves output, inflation and the rate unchanged. As in other UIP
// models without a stationarity device, the long-run condition q_∞ = c_∞ = 0 (the
// terminal condition of the perfect-foresight solver) pins it down, so it is counted
// with the unstable roots of the jump variables.

export function openTransition(p) {
  const m = p.expDiscount ?? 1;
  const { beta, sigma, kappa, phiPi, phiX, alpha, delta, passThrough: psi } = p;
  const next = ([c, piH, q, ql, dl]) => {
    const x = c + delta * q;
    const de = q - ql + piH;
    const piF = psi * (dl + de);
    const pi = (1 - alpha) * piH + alpha * piF;
    const i = phiPi * ruleInflation(p, pi, piH) + phiX * x;
    const EpiH = (piH - kappa * x) / (beta * m);
    const Ec = (c + sigma * i - sigma * EpiH) / m;
    const Eq = q + i - EpiH;
    return [Ec, EpiH, Eq, q, (1 - psi) * (dl + de)];
  };
  const cols = [0, 1, 2, 3, 4].map((k) => next([0, 1, 2, 3, 4].map((j) => (j === k ? 1 : 0))));
  return [0, 1, 2, 3, 4].map((r) => cols.map((col) => col[r]));
}

export function openDeterminacy(p) {
  const ev = eigenvalues(openTransition(p));
  const moduli = ev.map(modulus);
  const unstable = moduli.filter((r) => r > 1 - 1e-7).length;
  return {
    determinate: unstable === 3,
    unstableCount: unstable,
    eigenvalues: ev,
    moduli,
    taylorPrinciple: taylorPrincipleValue(p),
  };
}

// ---------------------------------------------------------------------------
// Residuals: plug a solution back into every equation of the open model.

export function openResiduals(sol, p) {
  const m = sol.mode === 'rational' ? (p.expDiscount ?? 1) : 1;
  const { beta, sigma, kappa, phiPi, phiX, alpha, delta, gamma, passThrough: psi, fxExpect: theta } = p;
  const T = sol.x.length;
  const r = { is: 0, nkpc: 0, cpi: 0, uip: 0, policy: 0, expectations: 0, bound: 0, floor: 0 };
  const up = (k, v) => { r[k] = Math.max(r[k], Math.abs(v)); };
  for (let t = 0; t < T; t++) {
    const prev = (a) => (t > 0 ? a[t - 1] : 0);
    up('is', sol.x[t] - (sol.c[t] + delta * sol.q[t] + gamma * sol.ystar[t]));
    up('is', sol.c[t] - (m * sol.Ex[t] - sigma * (sol.i[t] - sol.Epi[t] - sol.rn[t])));
    up('nkpc', sol.piH[t] - (beta * m * sol.Epi[t] + kappa * sol.x[t] + sol.u[t]));
    const de = sol.q[t] - prev(sol.q) + sol.piH[t];
    up('cpi', sol.piF[t] - psi * (prev(sol.d) + de));
    up('cpi', sol.d[t] - (1 - psi) * (prev(sol.d) + de));
    up('cpi', sol.pi[t] - ((1 - alpha) * sol.piH[t] + alpha * sol.piF[t]));
    up('cpi', sol.P[t] - (prev(sol.P) + sol.piH[t]));
    up('uip', sol.q[t] - (sol.Eq[t] - (sol.i[t] - sol.Epi[t] - sol.istar[t]) + sol.chi[t] + sol.xi[t]));
    if (sol.mode === 'rational') {
      if (t + 1 < T) up('expectations', Math.max(Math.abs(sol.Ex[t] - sol.c[t + 1]), Math.abs(sol.Epi[t] - sol.piH[t + 1]), Math.abs(sol.Eq[t] - sol.q[t + 1])));
    } else {
      up('expectations', Math.max(Math.abs(sol.Ex[t] - prev(sol.c)), Math.abs(sol.Epi[t] - (1 - sol.w[t]) * prev(sol.piH)), Math.abs(sol.Eq[t] - theta * sol.q[t])));
    }
    const taylor = phiPi * ruleInflation(p, sol.pi[t], sol.piH[t]) + phiX * sol.x[t] + sol.v[t];
    if (!Number.isNaN(sol.forced[t])) up('policy', sol.i[t] - sol.forced[t]);
    else up('policy', sol.i[t] - Math.max(sol.lb, taylor));
    r.bound = Math.max(r.bound, sol.lb - sol.i[t]);
    // Floor: interventions only in one direction and only when the koruna is at the floor.
    const f = sol.floor[t];
    if (Number.isNaN(f)) up('floor', sol.xi[t]);
    else {
      r.floor = Math.max(r.floor, f - sol.e[t], -sol.xi[t], Math.min(Math.abs(sol.xi[t]), Math.abs(sol.e[t] - f)));
    }
  }
  r.bound = Math.max(0, r.bound);
  r.floor = Math.max(0, r.floor);
  r.max = Math.max(...Object.values(r));
  return r;
}
