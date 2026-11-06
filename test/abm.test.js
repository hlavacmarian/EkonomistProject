import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, stepWorld, runABM, totalMoney, matchedParams, ABM_DEFAULTS } from '../src/abm/model.js';
import { simulate, withDefaults } from '../src/model/index.js';

const ar1 = (kind, size, rho = 0.8) => ({ kind, size, rho, shape: 'ar1' });
const step = (kind, size, duration) => ({ kind, size, shape: 'step', duration });
const sum = (a, n = a.length) => a.slice(0, n).reduce((s, v) => s + v, 0);
const P = withDefaults();

describe('agents: structure and accounting', () => {
  test('every household works for one firm, every firm has workers, shares as configured', () => {
    const w = buildWorld({ households: 500, firms: 25, htmShare: 0.3 });
    assert.equal(w.employer.length, 500);
    assert.equal(w.counts.reduce((a, b) => a + b, 0), 500);
    assert.ok(w.counts.every((c) => c >= 1));
    assert.equal(w.htm.reduce((a, b) => a + b, 0), 150);
    for (let j = 0; j < 25; j++) for (let m = 0; m < 2; m++) assert.notEqual(w.suppliers[j * 2 + m], j, 'no firm supplies itself');
  });

  test('every payment moves money from one account to another: the total never changes', () => {
    for (const [economy, shocks, rates] of [
      ['closed', [ar1('rn', -3), ar1('u', 1)], null],
      ['open', [ar1('chi', 2), ar1('ystar', -2), ar1('istar', 1)], null],
      ['closed', [step('rn', -6, 6)], [3, 2, 1, 0, 0, 0, 5, 5]],
    ]) {
      const r = runABM({ shocks, economy, horizon: 24, policy: rates ? { rates } : {}, record: false });
      for (const h of r.history) assert.ok(Math.abs(h.money - r.startMoney) < 1e-8, `${economy}: ${h.money} vs ${r.startMoney}`);
    }
  });

  test('the starting point is a steady state: the first quarter barely moves (only idiosyncratic noise)', () => {
    const w = buildWorld({});
    const money = totalMoney(w);
    const r = stepWorld(w, {}, null, false).agg;
    assert.ok(Math.abs(r.x) < 0.05, `gap ${r.x}`);
    assert.ok(Math.abs(r.pi) < 0.05, `inflation ${r.pi}`);
    assert.ok(Math.abs(r.i - P.neutralRealAnn) < 0.3);
    assert.ok(Math.abs(totalMoney(w) - money) < 1e-9);
  });

  test('same seed -> same economy; another seed -> another one', () => {
    const a = runABM({ shocks: [ar1('rn', -2)], horizon: 16, record: false, config: { seed: 11 } });
    const b = runABM({ shocks: [ar1('rn', -2)], horizon: 16, record: false, config: { seed: 11 } });
    assert.deepEqual(a.history, b.history);
    const c = runABM({ shocks: [ar1('rn', -2)], horizon: 16, record: false, config: { seed: 12 } });
    assert.notDeepEqual(a.history.map((h) => h.x), c.history.map((h) => h.x));
  });

  test('without shocks the economy stays close to its steady state', () => {
    for (const config of [{}, { seed: 3 }, { htmShare: 0.6 }, { households: 2000, firms: 80 }]) {
      for (const economy of ['closed', 'open']) {
        const r = runABM({ shocks: [], horizon: 40, config, economy, record: false });
        const gap = r.levels.raw.gap, infl = r.levels.raw.inflation;
        assert.ok(Math.abs(sum(gap) / 40) < 0.3, `${JSON.stringify(config)} ${economy} mean gap`);
        assert.ok(Math.abs(sum(infl) / 40 - P.targetAnn) < 0.6, `${JSON.stringify(config)} ${economy} mean inflation`);
        assert.ok(gap.every((v) => Math.abs(v) < 3) && infl.every((v) => Math.abs(v - P.targetAnn) < 4));
      }
    }
  });

  test('Calvo: on average the configured share of firms changes its price', () => {
    for (const resetProb of [0.15, 0.25, 0.5]) {
      const r = runABM({ shocks: [], horizon: 40, record: false, config: { resetProb, firms: 80, households: 800 } });
      const share = sum(r.history.map((h) => h.resets)) / 40;
      assert.ok(Math.abs(share - resetProb) < 0.04, `${resetProb}: ${share}`);
    }
  });

  test('recorded micro data add up: household balances change by income minus spending', () => {
    const r = runABM({ shocks: [ar1('rn', -2)], horizon: 4 });
    for (let t = 1; t < 4; t++) {
      const m = r.micro[t], prev = r.micro[t - 1];
      for (let k = 0; k < r.world.H; k += 37) {
        const change = m.hhBal[k] - prev.hhBal[k];
        assert.ok(Math.abs(change - (m.income[k] - m.spend[k])) < 1e-4);
      }
      for (const j of [0, 5]) {
        const resets = m.reset[j];
        assert.ok([-1, 0, 1].includes(resets));
      }
    }
  });
});

describe('agents: aggregate behaviour', () => {
  const resp = (shocks, extra = {}) => runABM({ shocks, horizon: 24, record: false, ...extra }).levels.response;

  test('a demand slump lowers output, inflation and the rate', () => {
    const r = resp([ar1('rn', -2)]);
    assert.ok(Math.min(...r.gap.slice(0, 6)) < -0.3);
    assert.ok(sum(r.inflation, 6) / 6 < P.targetAnn);
    assert.ok(sum(r.nominal, 6) / 6 < P.neutralRealAnn + P.targetAnn);
  });

  test('a cost-push shock raises inflation and, under the rule, lowers output', () => {
    const r = resp([ar1('u', 1.5)]);
    assert.ok(r.inflation[0] > P.targetAnn + 1);
    assert.ok(r.gap[0] < 0 && sum(r.gap, 4) < 0);
    assert.ok(r.nominal[0] > P.neutralRealAnn + P.targetAnn + 1);
  });

  test('monetary tightening lowers output and inflation', () => {
    const r = resp([ar1('v', 1, 0.5)]);
    assert.ok(r.gap[0] < 0 && sum(r.gap, 4) < 0);
    assert.ok(sum(r.inflation, 4) / 4 < P.targetAnn);
  });

  test('open economy: a risk-premium shock weakens the koruna and raises inflation; a foreign recession lowers output', () => {
    const chi = resp([ar1('chi', 2)], { economy: 'open' });
    assert.ok(chi.fx[0] > P.eurCzk && chi.inflation[0] > P.targetAnn);
    const ys = resp([ar1('ystar', -2)], { economy: 'open' });
    assert.ok(ys.gap[0] < 0 && sum(ys.gap, 4) < 0);
  });

  test('the rate never goes below the lower bound, also with a user-set path', () => {
    const r = runABM({ shocks: [step('rn', -10, 8)], horizon: 24, record: false });
    assert.ok(r.levels.raw.nominal.every((v) => v >= P.lowerBoundAnn - 1e-9));
    assert.ok(r.levels.raw.nominal.some((v) => Math.abs(v - P.lowerBoundAnn) < 1e-9), 'the bound binds');
    const manual = runABM({ shocks: [], horizon: 8, record: false, policy: { rates: [5, 5, -3, 1, null, null, 2, 2] } });
    const got = manual.levels.raw.nominal;
    assert.ok(Math.abs(got[0] - 5) < 1e-9 && Math.abs(got[2] - P.lowerBoundAnn) < 1e-9 && Math.abs(got[3] - 1) < 1e-9);
  });

  test('hand-to-mouth households amplify a demand shock relative to the matched three-equation model', () => {
    const ratio = (htmShare) => {
      const config = { htmShare };
      const abm = runABM({ shocks: [ar1('rn', -2)], horizon: 12, record: false, config }).levels.response;
      const nk = simulate({ params: matchedParams(config), shocks: [ar1('rn', -2)], horizon: 12 }, 'hybrid');
      return Math.min(...abm.gap.slice(0, 4)) / Math.min(...nk.levels.gap.slice(0, 4));
    };
    assert.ok(ratio(0.6) > ratio(0));
  });

  test('qualitative agreement with the three-equation model (hybrid, matched calibration)', () => {
    for (const shocks of [[ar1('rn', -2)], [ar1('u', 1.5)], [ar1('v', 1, 0.5)]]) {
      const abm = runABM({ shocks, horizon: 12, record: false }).levels.response;
      const nk = simulate({ params: matchedParams(ABM_DEFAULTS), shocks, horizon: 12 }, 'hybrid').levels;
      const sign = (a, base) => Math.sign(sum(a.map((v) => v - base), 4));
      assert.equal(sign(abm.gap, 0), sign(nk.gap, 0), `${shocks[0].kind} gap`);
      assert.equal(sign(abm.inflation, P.targetAnn), sign(nk.inflation, P.targetAnn), `${shocks[0].kind} inflation`);
      assert.equal(sign(abm.nominal, 3), sign(nk.nominal, 3), `${shocks[0].kind} rate`);
    }
  });

  test('matched calibration: σ from the smoothers, κ from Calvo × wage response', () => {
    const m = matchedParams({ htmShare: 0.2, resetProb: 0.25 });
    assert.ok(Math.abs(m.sigma - 0.8) < 1e-12);
    assert.ok(Math.abs(m.kappa - 0.1) < 1e-12);
  });
});
