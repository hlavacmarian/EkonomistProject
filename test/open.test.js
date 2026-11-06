import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  withDefaults, simulate, solveRational, solveHybrid, solveOpenRational, solveOpenHybrid, stepOpen,
  initialOpenState, openDeterminacy, openResiduals, determinacy, shockPaths, fxDeviation, fxLevel,
  decompose, decomposeDisplay, causalFlows, OPEN_TERMS, OPEN_FLOW_TARGET, lowerBoundDev,
} from '../src/model/index.js';
import { solveLinear, solveBanded, eigenvalues } from '../src/model/linalg.js';
import { SCENARIOS, buildRuns } from '../src/scenarios.js';

const TOL = 1e-9;
const P = withDefaults();
const ar1 = (kind, size, rho = 0.8) => ({ kind, size, rho, shape: 'ar1' });
const step = (kind, size, duration) => ({ kind, size, shape: 'step', duration });
const NO_TRADE = { alpha: 0, delta: 0, gamma: 0 };

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('linear algebra helpers', () => {
  test('the banded solver agrees with dense elimination', () => {
    const rand = rng(3);
    const n = 60, kl = 5, ku = 7;
    const A = new Float64Array(n * n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = Math.max(0, i - kl); j <= Math.min(n - 1, i + ku); j++) A[i * n + j] = rand() - 0.5;
      A[i * n + i] += i % 4 === 0 ? 0 : 3; // some zero-ish pivots force row swaps
      b[i] = rand();
    }
    const d = solveLinear(A, b, n), z = solveBanded(A, b, n, kl, ku);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(d[i] - z[i]) < 1e-9);
  });

  test('eigenvalues of small matrices', () => {
    const ev = eigenvalues([[2, 1, 0], [1, 3, 1], [0, 1, 4]]).map((e) => e.re).sort((a, b) => a - b);
    const want = [3 - Math.sqrt(3), 3, 3 + Math.sqrt(3)];
    ev.forEach((v, k) => assert.ok(Math.abs(v - want[k]) < 1e-9));
    const rot = eigenvalues([[0, -1], [1, 0]]);
    assert.ok(rot.every((e) => Math.abs(Math.hypot(e.re, e.im) - 1) < 1e-12 && Math.abs(e.re) < 1e-12));
  });
});

describe('open economy reduces to the closed model without trade', () => {
  const cases = [
    ['demand AR(1)', [ar1('rn', -2)], {}],
    ['cost AR(1)', [ar1('u', 1.5)], {}],
    ['monetary AR(1)', [ar1('v', 1, 0.5)], {}],
    ['bound + promise', [step('rn', -5, 6)], { holdUntil: 8 }],
    ['delay', [ar1('u', 2.5, 0.85)], { delay: 4 }],
  ];
  for (const [name, shocks, policy] of cases) {
    test(name, () => {
      const p = withDefaults(NO_TRADE);
      // Force the closed perfect-foresight solver with a zero step shock (same horizon).
      const closed = solveRational(p, [...shocks, step('v', 0, 1)], policy, 60);
      const open = solveOpenRational(p, shocks, policy, 60);
      for (let t = 0; t < 60; t++) for (const k of ['x', 'pi', 'i']) assert.ok(Math.abs(closed[k][t] - open[k][t]) < TOL, `${k} ${t}`);
      const q = { ...p, endogenousAnchoring: true };
      const ch = solveHybrid(q, shocks, policy, 40), oh = solveOpenHybrid(q, shocks, policy, 40);
      for (let t = 0; t < 40; t++) for (const k of ['x', 'pi', 'i', 'w']) assert.ok(Math.abs(ch[k][t] - oh[k][t]) < TOL, `hybrid ${k} ${t}`);
    });
  }
});

describe('open economy: solutions satisfy every equation', () => {
  const floor = { fxFloor: { level: fxDeviation(27, P), from: 1, to: 13 } };
  const scenario = [step('rn', -2, 10), step('ystar', -1.5, 10), step('istar', -1, 10)];
  const cases = [
    ['domestic demand', [ar1('rn', -2)], {}, {}],
    ['cost push', [ar1('u', 1.5)], {}, {}],
    ['monetary', [ar1('v', 1, 0.5)], {}, {}],
    ['foreign rate', [ar1('istar', 1)], {}, {}],
    ['foreign demand', [ar1('ystar', -2)], {}, {}],
    ['risk premium', [ar1('chi', 2)], {}, {}],
    ['bound + promise', [step('rn', -5, 6)], { holdUntil: 8 }, {}],
    ['exchange-rate floor', scenario, floor, { ruleDomestic: 1 }],
    ['floor with a CPI rule', scenario, floor, {}],
    ['discounting + immediate pass-through', [ar1('chi', 2), ar1('rn', -1)], {}, { expDiscount: 0.85, passThrough: 1 }],
  ];
  for (const [name, shocks, policy, params] of cases) {
    test(`rational: ${name}`, () => {
      const p = withDefaults(params);
      const sol = solveOpenRational(p, shocks, policy, 100);
      assert.equal(sol.converged, true);
      const r = openResiduals(sol, p);
      assert.ok(r.max < TOL, JSON.stringify(r));
    });
    test(`hybrid: ${name}`, () => {
      const p = withDefaults({ ...params, endogenousAnchoring: true });
      const sol = solveOpenHybrid(p, shocks, policy, 40);
      const r = openResiduals(sol, p);
      assert.ok(r.max < TOL, JSON.stringify(r));
    });
  }

  test('stepping quarter by quarter reproduces solveOpenHybrid', () => {
    const p = withDefaults({ endogenousAnchoring: true });
    const shocks = [ar1('chi', 2), step('rn', -2, 5)];
    const policy = { fxFloor: { level: 3, from: 2, to: 8 }, delay: 1 };
    const T = 20;
    const full = solveOpenHybrid(p, shocks, policy, T);
    const paths = shockPaths(shocks, T);
    let state = initialOpenState(p);
    for (let t = 0; t < T; t++) {
      const shock = Object.fromEntries(Object.keys(paths).map((k) => [k, paths[k][t]]));
      const forced = t < 1 ? Math.max(0, lowerBoundDev(p)) : null;
      const s = stepOpen(p, state, shock, forced, t >= 2 && t < 8 ? 3 : null);
      for (const k of ['x', 'pi', 'q', 'i', 'e', 'xi', 'w']) assert.equal(s[k], full[k][t], `${k} ${t}`);
      state = s.state;
    }
  });

  test('the perfect-foresight horizon is long enough for the displayed window', () => {
    const shocks = [ar1('chi', 2, 0.9), ar1('rn', -1, 0.9)];
    const a = simulate({ shocks, economy: 'open', horizon: 32 }, 'rational');
    const b = solveOpenRational(P, shocks, {}, 300);
    for (let t = 0; t < 32; t++) {
      assert.ok(Math.abs(a.q[t] - b.q[t]) < 1e-4 && Math.abs(a.x[t] - b.x[t]) < 1e-4 && Math.abs(a.pi[t] - b.pi[t]) < 1e-4, `t=${t}`);
    }
  });
});

describe('open economy: signs', () => {
  for (const mode of ['rational', 'hybrid']) {
    const sim = (shocks, params = {}) => simulate({ shocks, params, economy: 'open' }, mode);
    test(`${mode}: a foreign recession lowers output and inflation and weakens the koruna`, () => {
      const r = sim([ar1('ystar', -2)]);
      assert.ok(r.x[0] < 0 && r.piH[0] < 0, 'output and domestic inflation fall');
      assert.ok(r.q[0] > 0, 'the bank cuts rates, the koruna depreciates');
      // The weaker koruna can lift CPI on impact through import prices; over a year it falls.
      assert.ok(r.pi.slice(0, 4).reduce((s, v) => s + v, 0) < 0);
    });
    test(`${mode}: a risk-premium shock weakens the koruna and raises CPI inflation`, () => {
      const r = sim([ar1('chi', 2)]);
      assert.ok(r.q[0] > 0 && r.e[0] > 0);
      assert.ok(r.pi[0] > 0 && r.piF[0] > 0);
      assert.ok(r.i[0] > 0, 'the bank leans against imported inflation');
    });
    test(`${mode}: a higher foreign rate weakens the koruna`, () => {
      const r = sim([ar1('istar', 1)]);
      assert.ok(r.q[0] > 0 && r.pi[0] > 0);
    });
    test(`${mode}: monetary tightening strengthens the koruna and lowers output and inflation`, () => {
      const r = sim([ar1('v', 1, 0.5)]);
      assert.ok(r.q[0] < 0 && r.e[0] < 0);
      assert.ok(r.x[0] < 0 && r.pi[0] < 0);
    });
    test(`${mode}: the exchange-rate channel makes CPI react faster to the rate than in the closed economy`, () => {
      const open = sim([ar1('v', 1, 0.5)]);
      const closed = simulate({ shocks: [ar1('v', 1, 0.5)] }, mode);
      assert.ok(open.pi[0] < closed.pi[0]);
    });
  }

  test('no shocks -> steady state, koruna at its steady-state level', () => {
    for (const mode of ['rational', 'hybrid']) {
      const r = simulate({ shocks: [], economy: 'open' }, mode);
      for (const k of ['x', 'pi', 'i', 'q', 'e', 'xi']) assert.ok(r[k].every((v) => Math.abs(v) < 1e-13), `${mode} ${k}`);
      assert.ok(r.levels.fx.every((v) => Math.abs(v - P.eurCzk) < 1e-10));
    }
  });
});

describe('open economy: lower bound, floor and determinacy', () => {
  test('nominal rate never below the bound, floor always respected (fuzzed)', () => {
    const rand = rng(11);
    for (let k = 0; k < 60; k++) {
      const params = {
        sigma: 0.3 + rand(), kappa: 0.03 + 0.2 * rand(), phiPi: 1.2 + 1.5 * rand(), alpha: 0.6 * rand(),
        delta: 0.3 * rand(), gamma: rand(), passThrough: 0.2 + 0.8 * rand(), fxExpect: 0.9 * rand(),
        ruleDomestic: rand() < 0.5 ? 0 : 1, endogenousAnchoring: rand() < 0.5,
      };
      const shocks = [step('rn', -6 * rand(), 1 + Math.floor(8 * rand())), ar1('chi', 4 * (rand() - 0.5)), ar1('istar', 2 * (rand() - 0.5))];
      const policy = rand() < 0.5 ? { fxFloor: { level: 6 * rand(), from: 1, to: 2 + Math.floor(10 * rand()) } } : {};
      for (const mode of ['rational', 'hybrid']) {
        const r = simulate({ params, shocks, policy, economy: 'open', horizon: 32 }, mode);
        if (!r.determinate || !r.converged) continue;
        assert.ok(r.levels.nominal.every((v) => v >= -1e-9), `${mode} case ${k}`);
        r.floor.forEach((f, t) => { if (!Number.isNaN(f)) assert.ok(r.e[t] >= f - 1e-9, `${mode} case ${k} floor at ${t}`); });
        assert.ok(r.xi.every((v) => v >= -1e-9), 'interventions only weaken the koruna');
        assert.ok(r.residual < TOL, `${mode} case ${k} residual ${r.residual}`);
      }
    }
  });

  test('interventions happen only at the floor', () => {
    const shocks = [step('rn', -2, 10), step('ystar', -1.5, 10), step('istar', -1, 10)];
    const policy = { fxFloor: { level: fxDeviation(27, P), from: 1, to: 13 } };
    for (const mode of ['rational', 'hybrid']) {
      const r = simulate({ shocks, policy, params: { ruleDomestic: 1 }, economy: 'open', horizon: 32 }, mode);
      let active = 0;
      for (let t = 0; t < 32; t++) {
        if (r.xi[t] > 1e-9) {
          active++;
          assert.ok(Math.abs(fxLevel(r.e[t], P) - 27) < 1e-9, 'the koruna sits exactly at 27 CZK/EUR');
        }
      }
      assert.ok(active >= 3, `${mode}: the floor actually binds`);
    }
  });

  test('the exchange-rate commitment fights deflation at the bound (rational)', () => {
    const shocks = [step('rn', -2, 10), step('ystar', -1.5, 10), step('istar', -1, 10)];
    const base = { shocks, params: { ruleDomestic: 1 }, economy: 'open', horizon: 32 };
    const without = simulate(base, 'rational');
    const withFloor = simulate({ ...base, policy: { fxFloor: { level: fxDeviation(27, P), from: 1, to: 13 } } }, 'rational');
    assert.ok(without.atBound.filter(Boolean).length >= 3, 'without it the rate is stuck at the bound');
    assert.ok(Math.min(...without.levels.inflation.slice(0, 4)) < 0, 'and there is deflation');
    assert.ok(withFloor.levels.inflation[0] > without.levels.inflation[0] + 3);
    assert.ok(withFloor.x[0] > without.x[0]);
  });

  test('determinacy: default is determinate, a passive rule is not, and rational mode refuses paths', () => {
    assert.equal(openDeterminacy(P).determinate, true);
    assert.equal(openDeterminacy({ ...P, phiPi: 0.8, phiX: 0 }).determinate, false);
    const r = simulate({ params: { phiPi: 0.8, phiX: 0 }, shocks: [ar1('chi', 1)], economy: 'open' }, 'rational');
    assert.equal(r.determinate, false);
    assert.equal(r.x, undefined);
  });

  test('without trade the open determinacy matches the closed one', () => {
    const rand = rng(5);
    for (let k = 0; k < 300; k++) {
      const p = withDefaults({ ...NO_TRADE, sigma: 0.1 + 3 * rand(), kappa: 0.01 + 0.4 * rand(), phiPi: 3 * rand(), phiX: rand() });
      if (Math.abs(p.kappa * (p.phiPi - 1) + (1 - p.beta) * p.phiX) < 1e-4) continue;
      assert.equal(openDeterminacy(p).determinate, determinacy(p).determinate, JSON.stringify(p));
    }
  });
});

describe('open economy: decomposition', () => {
  const cases = [
    [[ar1('chi', 2), ar1('rn', -1)], {}, {}],
    [[step('rn', -2, 10), step('ystar', -1.5, 10), step('istar', -1, 10)], { fxFloor: { level: 5, from: 1, to: 13 } }, { ruleDomestic: 1 }],
    [[step('rn', -5, 6)], { holdUntil: 8 }, { ruleDomestic: 0.5 }],
  ];
  for (const mode of ['rational', 'hybrid']) {
    test(`${mode}: contributions add up and arrows into each node equal its value`, () => {
      for (const [shocks, policy, params] of cases) {
        const r = simulate({ shocks, policy, params, economy: 'open', horizon: 32 }, mode);
        const p = withDefaults(params);
        const dec = decompose(r, p);
        const vars = { IS: r.x, NKPC: r.pi, UIP: r.q, TR: r.i };
        for (const [block, terms] of Object.entries(OPEN_TERMS)) {
          for (let t = 0; t < 32; t++) {
            const sum = terms.reduce((s, k) => s + dec[block][k][t], 0);
            assert.ok(Math.abs(sum - vars[block][t]) < TOL, `${block} ${t}`);
          }
        }
        const disp = decomposeDisplay(r, p);
        const flows = causalFlows(disp);
        const target = { demand: disp.IS.total, inflation: disp.NKPC.total, bank: disp.TR.total, fx: disp.UIP.total };
        for (let t = 0; t < 32; t++) {
          const sums = { demand: 0, inflation: 0, bank: 0, fx: 0 };
          for (const [k, node] of Object.entries(OPEN_FLOW_TARGET)) sums[node] += flows[k][t];
          for (const node of Object.keys(sums)) assert.ok(Math.abs(sums[node] - target[node][t]) < TOL, `${node} ${t}`);
        }
        if (policy.fxFloor) assert.ok(dec.UIP.intervention.some((v) => v > 1e-6), 'interventions show up');
      }
    });
  }
});

describe('scenarios in the open economy', () => {
  test('every scenario offering the open economy solves accurately', () => {
    for (const sc of SCENARIOS) {
      const settings = { ...sc.defaults, economy: sc.fixedEconomy || 'open' };
      const runs = buildRuns(sc.build({ ...withDefaults(), ...sc.params }, settings), settings.mode === 'both' ? 'both' : settings.mode);
      for (const run of runs) {
        const r = simulate(run.spec, run.mode);
        assert.equal(r.determinate, true, sc.id);
        assert.ok(r.residual < TOL, `${sc.id} ${run.mode} ${r.residual}`);
      }
    }
  });
});
