import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS, withDefaults, lowerBoundDev, simulate, solveRational, solveHybrid,
  residuals, determinacy, taylorPrincipleValue, transitionMatrix, mucCoefficients,
} from '../src/model/index.js';
import { SCENARIOS, buildRuns } from '../src/scenarios.js';

const P = withDefaults();
const TOL = 1e-9;
const ar1 = (kind, size, rho = 0.8) => ({ kind, size, rho, shape: 'ar1' });
const step = (kind, size, duration) => ({ kind, size, shape: 'step', duration });

// Deterministic pseudo-random numbers for parameter fuzzing.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('residuals: solutions satisfy the model equations', () => {
  const cases = [
    ['demand AR(1)', [ar1('rn', -2)], {}],
    ['cost AR(1)', [ar1('u', 1.5)], {}],
    ['monetary AR(1)', [ar1('v', 1)], {}],
    ['combined AR(1), different persistence', [ar1('rn', -1, 0.9), ar1('u', 0.5, 0.5), ar1('v', 0.3, 0.3)], {}],
    ['step demand hitting the bound', [step('rn', -5, 6)], {}],
    ['bound + forward guidance', [step('rn', -5, 6)], { holdUntil: 8 }],
    ['delayed reaction', [ar1('u', 2.5, 0.85)], { delay: 4 }],
    ['large AR(1) demand hitting the bound', [ar1('rn', -6, 0.85)], {}],
  ];
  for (const [name, shocks, policy] of cases) {
    test(`rational: ${name}`, () => {
      const sol = solveRational(P, shocks, policy, 60);
      assert.equal(sol.converged, true);
      assert.ok(residuals(sol, P).max < TOL, JSON.stringify(residuals(sol, P)));
    });
    test(`hybrid: ${name}`, () => {
      const p = { ...P, endogenousAnchoring: true };
      const sol = solveHybrid(p, shocks, policy, 40);
      assert.ok(residuals(sol, p).max < TOL, JSON.stringify(residuals(sol, p)));
    });
  }

  test('rational with cognitive discounting', () => {
    const p = { ...P, expDiscount: 0.85 };
    for (const shocks of [[ar1('rn', -2)], [step('rn', -5, 6)]]) {
      const sol = solveRational(p, shocks, { holdUntil: 7 }, 60);
      assert.ok(residuals(sol, p).max < TOL);
    }
  });

  test('method of undetermined coefficients is used when the bound does not bind', () => {
    assert.equal(solveRational(P, [ar1('rn', -2)], {}, 60).method, 'muc');
    assert.equal(solveRational(P, [ar1('rn', -6, 0.85)], {}, 60).method, 'pf');
    assert.equal(solveRational(P, [step('rn', -1, 4)], {}, 60).method, 'pf');
  });

  test('MUC coefficients solve the undetermined-coefficient equations exactly', () => {
    const { beta, sigma, kappa, phiPi, phiX } = P;
    for (const kind of ['rn', 'u', 'v']) {
      const rho = 0.7;
      const { a, b } = mucCoefficients(P, kind, rho);
      const i = phiPi * b + phiX * a + (kind === 'v' ? 1 : 0);
      const isRes = a - (rho * a - sigma * (i - rho * b - (kind === 'rn' ? 1 : 0)));
      const nkRes = b - (beta * rho * b + kappa * a + (kind === 'u' ? 1 : 0));
      assert.ok(Math.abs(isRes) < 1e-12 && Math.abs(nkRes) < 1e-12);
    }
  });

  test('perfect foresight converges to the MUC solution for AR(1) shocks', () => {
    const shocks = [ar1('rn', -2)];
    const muc = solveRational(P, shocks, {}, 80);
    assert.equal(muc.method, 'muc');
    // Force the PF solver by adding a zero-size step shock; the truncation error
    // of the terminal condition is of order rho^T.
    const pf = solveRational(P, [...shocks, step('v', 0, 1)], {}, 80);
    assert.equal(pf.method, 'pf');
    for (let t = 0; t < 30; t++) {
      assert.ok(Math.abs(pf.x[t] - muc.x[t]) < 1e-6);
      assert.ok(Math.abs(pf.pi[t] - muc.pi[t]) < 1e-6);
    }
  });
});

describe('signs of impulse responses', () => {
  for (const mode of ['rational', 'hybrid']) {
    test(`${mode}: demand slump lowers the gap and inflation`, () => {
      const r = simulate({ shocks: [ar1('rn', -2)] }, mode);
      assert.ok(r.x[0] < 0 && r.pi[0] < 0);
      assert.ok(r.x.slice(0, 8).every((v) => v < 0));
      assert.ok(r.pi.slice(0, 8).every((v) => v < 0));
    });
    test(`${mode}: cost-push shock raises inflation and, under the Taylor rule, lowers the gap`, () => {
      const r = simulate({ shocks: [ar1('u', 1.5)] }, mode);
      assert.ok(r.pi[0] > 0 && r.x[0] < 0);
      assert.ok(r.i[0] > 0, 'the bank raises the nominal rate');
    });
    test(`${mode}: monetary tightening lowers the gap and inflation`, () => {
      const r = simulate({ shocks: [ar1('v', 1)] }, mode);
      assert.ok(r.x[0] < 0 && r.pi[0] < 0);
      assert.ok(r.r[0] > 0, 'the real rate rises');
    });
  }
});

describe('lower bound and steady state', () => {
  test('no shocks -> the economy stays in steady state in both modes', () => {
    for (const mode of ['rational', 'hybrid']) {
      const r = simulate({ shocks: [] }, mode);
      for (const k of ['x', 'pi', 'i', 'r']) assert.ok(r[k].every((v) => Math.abs(v) < 1e-14), `${mode} ${k}`);
      assert.ok(r.levels.inflation.every((v) => Math.abs(v - P.targetAnn) < 1e-12));
    }
  });

  test('nominal rate never goes below the lower bound (fuzzed)', () => {
    const rand = rng(42);
    for (let k = 0; k < 150; k++) {
      const params = {
        sigma: 0.2 + 2 * rand(), kappa: 0.02 + 0.3 * rand(), phiPi: 1.1 + 2 * rand(),
        phiX: rand() * 0.5, lowerBoundAnn: -0.5 + 1.5 * rand(), expDiscount: 0.8 + 0.2 * rand(),
        endogenousAnchoring: rand() < 0.5,
      };
      const shocks = [
        rand() < 0.5 ? ar1('rn', -8 * rand(), 0.5 + 0.45 * rand()) : step('rn', -8 * rand(), 1 + Math.floor(8 * rand())),
        ar1('u', 4 * (rand() - 0.5), 0.8), ar1('v', 2 * (rand() - 0.5), 0.5),
      ];
      const fg = rand() < 0.3 ? Math.floor(4 * rand()) : 0;
      for (const mode of ['rational', 'hybrid']) {
        const r = simulate({ params, shocks, forwardGuidance: fg, horizon: 40 }, mode);
        if (!r.determinate || !r.converged) continue;
        const lbAnn = params.lowerBoundAnn;
        assert.ok(r.levels.nominal.every((v) => v >= lbAnn - 1e-9), `${mode} case ${k}`);
        assert.ok(r.residual < TOL, `${mode} case ${k} residual ${r.residual}`);
      }
    }
  });

  test('regimes at the bound satisfy complementary slackness', () => {
    const sol = solveRational(P, [step('rn', -5, 6)], {}, 60);
    const lb = lowerBoundDev(P);
    let atBound = 0;
    for (let t = 0; t < 60; t++) {
      if (sol.atBound[t]) {
        atBound++;
        assert.ok(sol.shadow[t] <= lb + 1e-9, 'shadow rate below the bound when the bound binds');
      } else {
        assert.ok(Math.abs(sol.i[t] - sol.shadow[t]) < 1e-9);
      }
    }
    assert.ok(atBound >= 3, 'the scenario actually hits the bound');
  });

  test('forward guidance raises output at impact; discounting weakens it', () => {
    const shocks = [step('rn', -5, 6)];
    const gain = (m) => {
      const params = { expDiscount: m };
      const base = simulate({ params, shocks, horizon: 32 }, 'rational');
      const fg = simulate({ params, shocks, horizon: 32, forwardGuidance: 2 }, 'rational');
      return fg.x[0] - base.x[0];
    };
    assert.ok(gain(1) > 0);
    assert.ok(gain(0.85) > 0 && gain(0.85) < gain(1));
  });

  test('longer promises have ever larger effects (forward guidance puzzle)', () => {
    const shocks = [step('rn', -5, 6)];
    const x0 = [0, 1, 2, 4].map((N) => simulate({ shocks, forwardGuidance: N, horizon: 32 }, 'rational').x[0]);
    for (let k = 1; k < x0.length; k++) assert.ok(x0[k] > x0[k - 1]);
  });
});

describe('determinacy', () => {
  test('analytic Taylor principle matches the eigenvalue condition (m = 1)', () => {
    const rand = rng(7);
    let agree = 0;
    for (let k = 0; k < 2000; k++) {
      const p = withDefaults({
        beta: 0.9 + 0.099 * rand(), sigma: 0.05 + 4 * rand(), kappa: 0.005 + 0.5 * rand(),
        phiPi: 3 * rand(), phiX: 1.5 * rand(),
      });
      const tp = taylorPrincipleValue(p);
      if (Math.abs(tp) < 1e-6) continue;
      assert.equal(determinacy(p).determinate, tp > 0, JSON.stringify(p));
      agree++;
    }
    assert.ok(agree > 1900);
  });

  test('default calibration is determinate; phiPi = 0.8 is not', () => {
    assert.equal(determinacy(P).determinate, true);
    assert.equal(determinacy({ ...P, phiPi: 0.8, phiX: 0 }).determinate, false);
  });

  test('rational mode refuses to produce paths when indeterminate', () => {
    const r = simulate({ params: { phiPi: 0.8, phiX: 0 }, shocks: [ar1('rn', -2)] }, 'rational');
    assert.equal(r.determinate, false);
    assert.equal(r.x, undefined);
  });

  test('indeterminacy <=> a bounded sunspot equilibrium exists without any shock', () => {
    for (const [p, expectSunspot] of [[{ ...P, phiPi: 0.8, phiX: 0 }, true], [P, false]]) {
      const [[a, b], [c, d]] = transitionMatrix(p);
      const det = determinacy(p);
      const stable = det.eigenvalues.find((z) => Math.hypot(z.re, z.im) < 1 && z.im === 0);
      assert.equal(Boolean(stable), expectSunspot);
      if (!stable) continue;
      // Eigenvector of the stable root: (a - l) v1 + b v2 = 0.
      const l = stable.re;
      const v = Math.abs(b) > 1e-12 ? [b, l - a] : [l - d, c];
      const T = 40;
      const x = Array.from({ length: T + 1 }, (_, t) => v[0] * l ** t);
      const pi = Array.from({ length: T + 1 }, (_, t) => v[1] * l ** t);
      for (let t = 0; t < T; t++) {
        const i = p.phiPi * pi[t] + p.phiX * x[t];
        assert.ok(Math.abs(x[t] - (x[t + 1] - p.sigma * (i - pi[t + 1]))) < 1e-9);
        assert.ok(Math.abs(pi[t] - (p.beta * pi[t + 1] + p.kappa * x[t])) < 1e-9);
      }
      assert.ok(Math.abs(x[T]) < Math.abs(x[0]), 'the sunspot path is bounded (decays)');
    }
  });
});

describe('hybrid expectations and anchoring', () => {
  test('anchoring erodes under a long miss and recovers afterwards', () => {
    const r = simulate({
      params: { endogenousAnchoring: true, anchoring: 0.8 },
      shocks: [ar1('u', 2.5, 0.85)], policy: { delay: 4 }, horizon: 40,
    }, 'hybrid');
    const minW = Math.min(...r.w);
    assert.ok(minW < 0.4);
    assert.ok(r.w[39] > minW);
  });

  test('a delayed reaction lets inflation settle in higher than a timely one', () => {
    const base = { params: { endogenousAnchoring: true, anchoring: 0.8 }, shocks: [ar1('u', 2.5, 0.85)], horizon: 32 };
    const late = simulate({ ...base, policy: { delay: 4 } }, 'hybrid');
    const timely = simulate(base, 'hybrid');
    const cum = (r) => r.pi.reduce((s, v) => s + Math.abs(v), 0);
    assert.ok(cum(late) > 1.5 * cum(timely));
  });

  test('fully anchored expectations (w = 1) make inflation expectations equal the target', () => {
    const r = simulate({ params: { anchoring: 1 }, shocks: [ar1('u', 2)] }, 'hybrid');
    assert.ok(r.Epi.every((v) => Math.abs(v) < 1e-14));
  });
});

describe('scenarios', () => {
  test('every predefined scenario runs and solves accurately in every mode it offers', () => {
    for (const sc of SCENARIOS) {
      const runs = buildRuns(sc.build({ ...DEFAULT_PARAMS }, sc.defaults), sc.defaults.mode);
      assert.ok(runs.length > 0, sc.id);
      for (const run of runs) {
        const r = simulate(run.spec, run.mode);
        assert.equal(r.determinate, true, sc.id);
        assert.ok(r.residual < TOL, `${sc.id} ${run.mode}`);
      }
    }
  });
});
