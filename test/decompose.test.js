import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  withDefaults, simulate, solveHybrid, stepHybrid, initialHybridState, residuals,
  decompose, decomposeDisplay, causalFlows, TERMS, FLOW_TARGET, shockPaths, lowerBoundDev,
} from '../src/model/index.js';

const TOL = 1e-9;
const ar1 = (kind, size, rho = 0.8) => ({ kind, size, rho, shape: 'ar1' });
const step = (kind, size, duration) => ({ kind, size, shape: 'step', duration });

const CASES = [
  ['demand AR(1)', { shocks: [ar1('rn', -2)] }],
  ['cost AR(1)', { shocks: [ar1('u', 1.5)] }],
  ['monetary AR(1)', { shocks: [ar1('v', 1)] }],
  ['lower bound', { shocks: [step('rn', -5, 6)], horizon: 32 }],
  ['forward guidance', { shocks: [step('rn', -5, 6)], forwardGuidance: 2, horizon: 32 }],
  ['delay + anchoring', { params: { endogenousAnchoring: true, anchoring: 0.8 }, shocks: [ar1('u', 2.5, 0.85)], policy: { delay: 4 }, horizon: 32 }],
  ['discounting', { params: { expDiscount: 0.85 }, shocks: [step('rn', -5, 6)], forwardGuidance: 3, horizon: 32 }],
  ['combined', { shocks: [ar1('rn', -1, 0.9), ar1('u', 0.6, 0.5), ar1('v', 0.4, 0.3)] }],
];

describe('decomposition into contributions', () => {
  for (const [name, spec] of CASES) {
    for (const mode of ['rational', 'hybrid']) {
      test(`${mode}: ${name}: contributions add up to each variable`, () => {
        const r = simulate(spec, mode);
        const p = withDefaults(spec.params);
        const dec = decompose(r, p);
        const vars = { IS: r.x, NKPC: r.pi, TR: r.i };
        let maxErr = 0;
        for (const [block, terms] of Object.entries(TERMS)) {
          for (let t = 0; t < r.x.length; t++) {
            const sum = terms.reduce((s, k) => s + dec[block][k][t], 0);
            maxErr = Math.max(maxErr, Math.abs(sum - vars[block][t]), Math.abs(dec[block].total[t] - vars[block][t]));
          }
        }
        assert.ok(maxErr < TOL, `max error ${maxErr}`);
      });
    }
  }

  test('display units: inflation and rate blocks are annualized, the gap is not', () => {
    const r = simulate({ shocks: [ar1('u', 1.5)] }, 'rational');
    const p = withDefaults();
    const raw = decompose(r, p);
    const disp = decomposeDisplay(r, p);
    for (let t = 0; t < 5; t++) {
      assert.ok(Math.abs(disp.NKPC.total[t] - (r.levels.inflation[t] - p.targetAnn)) < TOL);
      assert.ok(Math.abs(disp.TR.total[t] - (r.levels.nominal[t] - p.neutralRealAnn - p.targetAnn)) < TOL);
      assert.equal(disp.IS.rate[t], raw.IS.rate[t]);
    }
  });

  test('arrows entering a node of the diagram add up to its variable', () => {
    for (const [, spec] of CASES) {
      for (const mode of ['rational', 'hybrid']) {
        const r = simulate(spec, mode);
        const p = withDefaults(spec.params);
        const dec = decomposeDisplay(r, p);
        const flows = causalFlows(dec);
        const target = { demand: dec.IS.total, inflation: dec.NKPC.total, bank: dec.TR.total };
        for (let t = 0; t < r.x.length; t++) {
          const sums = { demand: 0, inflation: 0, bank: 0 };
          for (const [k, node] of Object.entries(FLOW_TARGET)) sums[node] += flows[k][t];
          for (const node of Object.keys(sums)) assert.ok(Math.abs(sums[node] - target[node][t]) < TOL);
        }
      }
    }
  });

  test('bound term is positive exactly when the rate sits at the bound; no override without one', () => {
    const r = simulate({ shocks: [step('rn', -5, 6)], horizon: 32 }, 'rational');
    const dec = decompose(r, withDefaults());
    for (let t = 0; t < r.x.length; t++) {
      if (r.atBound[t] && r.shadow[t] < r.lb - 1e-9) assert.ok(dec.TR.bound[t] > 0);
      if (!r.atBound[t]) assert.ok(Math.abs(dec.TR.bound[t]) < TOL);
      assert.ok(Math.abs(dec.TR.override[t]) < TOL, 'pure rule + bound: nothing outside the rule');
    }
  });

  test('a promise shows up as a decision outside the rule', () => {
    const r = simulate({ shocks: [step('rn', -5, 6)], forwardGuidance: 3, horizon: 32 }, 'rational');
    const dec = decompose(r, withDefaults());
    assert.ok(dec.TR.override.some((v) => v < -1e-6), 'the rate is held below what the rule would set');
  });

  test('without shocks every contribution is zero', () => {
    for (const mode of ['rational', 'hybrid']) {
      const dec = decompose(simulate({ shocks: [] }, mode), withDefaults());
      for (const block of Object.values(dec)) {
        for (const arr of Object.values(block)) assert.ok(arr.every((v) => Math.abs(v) < 1e-14));
      }
    }
  });
});

describe('hybrid step API', () => {
  const p = withDefaults({ endogenousAnchoring: true, anchoring: 0.8 });

  test('stepping one quarter at a time reproduces solveHybrid exactly', () => {
    const shocks = [ar1('u', 2.5, 0.85), step('rn', -3, 5)];
    const policy = { delay: 3 };
    const T = 30;
    const full = solveHybrid(p, shocks, policy, T);
    const paths = shockPaths(shocks, T);
    let state = initialHybridState(p);
    for (let t = 0; t < T; t++) {
      const forced = t < 3 ? Math.max(0, lowerBoundDev(p)) : null;
      const s = stepHybrid(p, state, { rn: paths.rn[t], u: paths.u[t], v: paths.v[t] }, forced);
      for (const k of ['x', 'pi', 'i', 'Epi', 'Ex', 'w']) assert.equal(s[k], full[k][t], `${k} at ${t}`);
      state = s.state;
    }
  });

  test('stepHybrid does not modify its input state', () => {
    const state = initialHybridState(p);
    const copy = { ...state };
    stepHybrid(p, state, { u: 0.5 }, null);
    assert.deepEqual(state, copy);
  });

  test('a forced rate below the bound is lifted to the bound', () => {
    const lb = lowerBoundDev(p);
    const s = stepHybrid(p, initialHybridState(p), { rn: -1 }, lb - 2);
    assert.equal(s.i, lb);
    assert.equal(s.atBound, true);
  });

  test('explicit rates (player) and ready-made shock paths solve the equations', () => {
    const T = 24;
    const paths = { rn: Array.from({ length: T }, (_, t) => -0.3 * Math.sin(t / 3)), u: Array.from({ length: T }, (_, t) => (t === 5 ? 0.5 : 0)) };
    const rates = Array.from({ length: T }, (_, t) => (t % 3 === 0 ? null : 0.1 * Math.cos(t)));
    const sol = solveHybrid(p, paths, { rates }, T);
    assert.ok(residuals(sol, p).max < TOL);
    for (let t = 0; t < T; t++) if (rates[t] !== null) assert.equal(sol.i[t], Math.max(sol.lb, rates[t]));
    // Rational mode accepts the same inputs (perfect foresight over the given rates).
    const rat = simulate({ shocks: paths, policy: { rates }, horizon: T }, 'rational');
    assert.equal(rat.method, 'pf');
    assert.ok(rat.residual < TOL);
  });

  test('slow anchoring: credibility rises towards the ceiling while inflation stays near target', () => {
    const q = withDefaults({ endogenousAnchoring: true, anchoring: 0.9, anchorInit: 0.5, anchorSpeed: 0.3 });
    const sol = solveHybrid(q, [], {}, 20);
    assert.equal(sol.w[0], 0.5);
    for (let t = 1; t < 20; t++) assert.ok(sol.w[t] > sol.w[t - 1]);
    assert.ok(sol.w[19] > 0.88 && sol.w[19] <= 0.9);
  });

  test('slow anchoring: credibility falls when inflation is left to drift', () => {
    const q = withDefaults({ endogenousAnchoring: true, anchoring: 0.9, anchorInit: 0.9, anchorSpeed: 0.3 });
    const neutral = (q.neutralRealAnn + q.targetAnn - q.neutralRealAnn - q.targetAnn) / 4; // 0 in model units
    const sol = solveHybrid(q, [ar1('u', 3, 0.9)], { rates: new Array(16).fill(neutral) }, 16);
    assert.ok(Math.min(...sol.w) < 0.6);
  });
});
