// Agent-based economy: hundreds to thousands of households, dozens of firms, one
// commercial bank, the state, the central bank and (open economy) the rest of the
// world. Every payment debits one account and credits another, so the total of all
// balances never changes (stock-flow consistency, tested). No DOM.
//
// Units: like the three-equation model, everything runs around a steady state with
// zero trend inflation (prices ~1, display adds the target π*). Interest rates are
// annual and "internal" = displayed rate − π*, so the neutral policy rate is r*.
//
// One quarter:
//  1. Wages W grow with expected inflation and last quarter's labour-market tightness
//     (output gap): the source of the Phillips curve.
//  2. Each firm may reset its price with probability θ (Calvo). A resetting firm sets
//     markup × marginal cost (wages + inputs from its suppliers), indexed to expected
//     inflation over the price spell and nudged by its recent demand. Others keep
//     their price.
//  3. Households decide spending. Hand-to-mouth households spend the pay cheque they
//     just received; the others smooth (Euler equation): they keep last quarter's
//     consumption, cut it by σ % for every p.p. the real interest rate is above neutral
//     (or a demand shock makes them save), drift towards their permanent (average)
//     income and steer their deposits towards a buffer.
//     Spending goes to a few favourite shops (cheaper and more popular shops get more)
//     and, in the open economy, partly to imports.
//  4. The central bank sets the rate: Taylor rule on this quarter's CPI inflation and
//     output gap (solved jointly with demand), or a rate chosen by the user.
//  5. Firms produce what is demanded, buy inputs from their suppliers (a network of
//     firm-to-firm payments), hire hours from their workers and pay wages; the state
//     taxes wages and pays transfers plus benefits for lost hours; the bank charges
//     interest on loans and pays interest on deposits; firms and the bank pay out
//     profits to their owners.

import { normalizeSeed } from '../game/rng.js';
import { shockPaths } from '../model/shocks.js';
import { withDefaults } from '../model/params.js';

export const ABM_DEFAULTS = Object.freeze({
  households: 600,
  firms: 40,
  htmShare: 0.2, // hand-to-mouth households
  resetProb: 0.25, // Calvo: probability that a firm may change its price in a quarter
  stabilizer: 0.5, // share of lost labour income the state replaces
  seed: 7,
});

export const ABM_LIMITS = Object.freeze({
  households: { min: 200, max: 2000, step: 100 },
  firms: { min: 10, max: 80, step: 5 },
  htmShare: { min: 0, max: 0.8, step: 0.05 },
  resetProb: { min: 0.1, max: 0.6, step: 0.05 },
  stabilizer: { min: 0, max: 1, step: 0.1 },
});

// Structural constants (not exposed as sliders).
export const ABM_STRUCT = Object.freeze({
  markup: 0.2,
  inputShare: 0.3, // share of intermediate inputs in gross output
  shops: 3, // favourite shops per household
  suppliers: 2, // suppliers per firm
  elasticity: 4, // substitution between shops
  pressure: 0.05, // how much a resetting firm leans on its recent demand
  wageGap: 0.4, // wage growth per 1 % output gap (with Calvo θ = 0.25 this gives κ ≈ 0.1)
  incomeGain: 0.25, // speed at which permanent income follows actual income
  incomePull: 0.25, // speed at which smoothers' consumption moves towards permanent income
  bufferSpeed: 0.08, // speed at which households steer deposits to their buffer
  taxRate: 0.25,
  loanSpread: 2, // annual p.p. above the policy rate
  depositSpread: 0.5, // annual p.p. below the policy rate
  payout: 0.25, // dividends = profit + this share of cash above (below) the target position
  fiscalRule: 0.05, // transfers lean against state debt
  fiscalBalance: 0.1, // ... and the base transfer adjusts until the budget balances
  bufferDrift: 0.02, // households slowly get used to the wealth they actually have
  popularityRho: 0.8,
  popularitySd: 0.05,
  exportElasticity: 1.5,
  foreignDemand: 0.8, // exports respond to the foreign output gap
  burnIn: 60, // quarters simulated before t = 0 so that the economy settles
});

// mulberry32 with its state kept in a plain object, so that a whole world (agents
// and random-number generator) can be copied with structuredClone.
function nextRandom(rs) {
  rs.a = (rs.a + 0x6d2b79f5) >>> 0;
  let t = rs.a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gaussianRandom(rs) {
  const u1 = 1 - nextRandom(rs);
  const u2 = nextRandom(rs);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function shuffle(arr, rand) {
  for (let k = arr.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    const t = arr[k]; arr[k] = arr[j]; arr[j] = t;
  }
  return arr;
}

function pickDistinct(n, count, rand, exclude = -1) {
  const out = [];
  while (out.length < count) {
    const j = Math.floor(rand() * n);
    if (j !== exclude && !out.includes(j)) out.push(j);
  }
  return out;
}

// Build agents and the steady state they start from (deterministic from the seed).
export function buildWorld(config = {}, params = {}) {
  const cfg = { ...ABM_DEFAULTS, ...config };
  const p = withDefaults(params);
  const open = cfg.economy === 'open';
  const S = ABM_STRUCT;
  const rs = { a: normalizeSeed(cfg.seed) >>> 0 };
  const rand = () => nextRandom(rs);
  const H = Math.round(cfg.households);
  const F = Math.round(cfg.firms);
  const alpha = open ? p.alpha : 0;

  const htm = new Uint8Array(H);
  const order = shuffle([...Array(H).keys()], rand);
  const nHtm = Math.round(H * cfg.htmShare);
  for (let k = 0; k < nHtm; k++) htm[order[k]] = 1;

  const shops = new Int32Array(H * S.shops);
  for (let i = 0; i < H; i++) pickDistinct(F, S.shops, rand).forEach((j, k) => { shops[i * S.shops + k] = j; });
  const suppliers = new Int32Array(F * S.suppliers);
  for (let j = 0; j < F; j++) pickDistinct(F, S.suppliers, rand, j).forEach((k, m) => { suppliers[j * S.suppliers + m] = k; });

  // Workers go to firms in proportion to the labour their steady-state demand needs.
  const f0 = new Float64Array(F);
  for (let i = 0; i < H; i++) for (let k = 0; k < S.shops; k++) f0[shops[i * S.shops + k]] += (1 - alpha) / S.shops;
  if (open) for (let j = 0; j < F; j++) f0[j] += (alpha * H) / F;
  const y0 = leontief(f0, suppliers, F, S);
  const labour = Array.from(y0, (y) => (1 - S.inputShare) * y);
  const total = labour.reduce((a, b) => a + b, 0);
  const quota = labour.map((l) => Math.max(1, (l / total) * H));
  const counts = quota.map((q) => Math.floor(q));
  let rest = H - counts.reduce((a, b) => a + b, 0);
  const byRemainder = quota.map((q, j) => [q - Math.floor(q), j]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % F, rest--) counts[byRemainder[k][1]]++;
  while (counts.reduce((a, b) => a + b, 0) > H) {
    const j = counts.indexOf(Math.max(...counts));
    counts[j]--;
  }
  const employer = new Int32Array(H);
  const perm = shuffle([...Array(H).keys()], rand);
  let pos = 0;
  for (let j = 0; j < F; j++) for (let c = 0; c < counts[j]; c++) employer[perm[pos++]] = j;
  const workers = Array.from({ length: F }, () => []);
  for (let i = 0; i < H; i++) workers[employer[i]].push(i);
  const owners = workers.map((list) => list.filter((i) => !htm[i]));
  const smoothers = [];
  for (let i = 0; i < H; i++) if (!htm[i]) smoothers.push(i);

  // Steady state: prices 1, wage from markup pricing, working-capital loans = one
  // quarter's wage bill, matched by households' deposits.
  const W0 = (1 / (1 + S.markup) - S.inputShare) / (1 - S.inputShare);
  const L0 = counts.map((c) => W0 * c);
  const state = {
    t: 0,
    price: new Float64Array(F).fill(1),
    pop: new Float64Array(F),
    firmBal: Float64Array.from(L0, (l) => -l),
    normal: Float64Array.from(y0),
    pressure: new Float64Array(F).fill(1),
    hours: new Float64Array(F).fill(1),
    W: W0,
    hhBal: new Float64Array(H),
    target: new Float64Array(H),
    ybar: new Float64Array(H),
    cPrev: new Float64Array(H),
    lastIncome: new Float64Array(H),
    stateBal: 0,
    bankBal: 0,
    abroadBal: 0,
    transfer: S.taxRate * W0,
    piPrev: 0,
    xPrev: 0,
    CPI: 1,
    PH: 1,
    PF: 1,
    lnE: 0,
    weights: Float64Array.from(y0, (y) => y / y0.reduce((a, b) => a + b, 0)),
  };
  const deposit = smoothers.length ? (W0 * H) / smoothers.length : 0;
  for (let i = 0; i < H; i++) {
    state.hhBal[i] = htm[i] ? 0 : deposit;
    state.target[i] = state.hhBal[i];
  }
  if (!smoothers.length) { // everyone hand-to-mouth: firms hold the deposits
    for (let j = 0; j < F; j++) state.firmBal[j] = 0;
  }
  calibrateSteadyState({ cfg, p, open, alpha, H, F, htm, shops, suppliers, employer, owners, smoothers, counts, W0, L0, state });
  return {
    cfg, p, open, alpha, H, F, htm, shops, suppliers, employer, workers, owners, smoothers, counts, W0, L0, y0,
    rs, state,
  };
}

// Consistent steady state: every household spends exactly its income, firms pay out
// exactly their profit, the bank its margin and the state budget balances. Found by
// iterating on incomes (hours per firm depend on where the spending goes).
function calibrateSteadyState(w) {
  const { p, open, alpha, H, F, htm, shops, suppliers, employer, owners, smoothers, counts, W0, L0, state } = w;
  const S = ABM_STRUCT;
  const rStar = p.neutralRealAnn;
  const loanRate = (rStar + S.loanSpread) / 400;
  const depRate = Math.max(-p.targetAnn, rStar - S.depositSpread) / 400;
  const interest = (bal) => (bal < 0 ? bal * loanRate : bal * depRate);
  const income = Float64Array.from({ length: H }, (_, i) => (htm[i] ? W0 : W0 + (smoothers.length ? ((1 - W0) * H) / smoothers.length : 0)));
  let y = null, profit = new Float64Array(F), bankIncome = 0, transfer = S.taxRate * W0;
  for (let it = 0; it < 60; it++) {
    const f = new Float64Array(F);
    for (let i = 0; i < H; i++) for (let k = 0; k < S.shops; k++) f[shops[i * S.shops + k]] += ((1 - alpha) * income[i]) / S.shops;
    if (open) for (let j = 0; j < F; j++) f[j] += (alpha * H) / F;
    y = leontief(f, suppliers, F, S);
    // Firms sit at their target position (working-capital loan) and pay out their profit.
    bankIncome = 0;
    for (let j = 0; j < F; j++) {
      const int = interest(-L0[j]);
      profit[j] = y[j] * (1 - S.inputShare) * (1 - W0) + int;
      bankIncome -= int;
    }
    let benefitsLost = 0, taxes = 0;
    for (let i = 0; i < H; i++) {
      const h = ((1 - S.inputShare) * y[employer[i]]) / counts[employer[i]];
      taxes += S.taxRate * W0 * h;
      benefitsLost += w.cfg.stabilizer * W0 * Math.max(0, 1 - h);
    }
    transfer = (taxes - benefitsLost) / H;
    const dividend = new Float64Array(H);
    for (let j = 0; j < F; j++) {
      const rec = owners[j].length ? owners[j] : smoothers;
      for (const k of rec) dividend[k] += profit[j] / rec.length;
    }
    for (let i = 0; i < H; i++) bankIncome -= interest(state.hhBal[i]);
    for (const k of smoothers) dividend[k] += bankIncome / smoothers.length;
    for (let i = 0; i < H; i++) {
      const h = ((1 - S.inputShare) * y[employer[i]]) / counts[employer[i]];
      const wage = W0 * h;
      income[i] = wage * (1 - S.taxRate) + transfer + w.cfg.stabilizer * W0 * Math.max(0, 1 - h) + interest(state.hhBal[i]) + dividend[i];
    }
  }
  for (let j = 0; j < F; j++) {
    state.firmBal[j] = smoothers.length ? -L0[j] : 0;
    state.normal[j] = y[j];
    state.hours[j] = ((1 - S.inputShare) * y[j]) / counts[j];
  }
  const ySum = y.reduce((a, b) => a + b, 0);
  for (let j = 0; j < F; j++) state.weights[j] = y[j] / ySum;
  state.bankBal = 0;
  state.transfer = transfer;
  state.transferBase = transfer;
  for (let i = 0; i < H; i++) {
    state.ybar[i] = income[i];
    state.cPrev[i] = income[i];
    state.lastIncome[i] = income[i];
  }
}

// Gross output from final demand through the supplier network: each unit of gross
// output needs inputShare units of inputs, bought equally from the firm's suppliers.
function leontief(f, suppliers, F, S) {
  const y = Float64Array.from(f);
  const inter = new Float64Array(F);
  for (let it = 0; it < 80; it++) {
    inter.fill(0);
    for (let k = 0; k < F; k++) {
      const buy = (S.inputShare * y[k]) / S.suppliers;
      for (let m = 0; m < S.suppliers; m++) inter[suppliers[k * S.suppliers + m]] += buy;
    }
    let diff = 0;
    for (let j = 0; j < F; j++) {
      const v = f[j] + inter[j];
      diff = Math.max(diff, Math.abs(v - y[j]));
      y[j] = v;
    }
    if (diff < 1e-13) break;
  }
  return y;
}

export function totalMoney(world) {
  const s = world.state;
  let m = s.stateBal + s.bankBal + s.abroadBal;
  for (const v of s.hhBal) m += v;
  for (const v of s.firmBal) m += v;
  return m;
}

// One quarter. shock = { rn, u, v, istar, ystar, chi } in model units (quarterly %,
// y* in %); rate = annual internal policy rate chosen by the user, or null for the
// rule. record = keep the micro data (payments, agent states) for the visualization.
export function stepWorld(world, shock = {}, rate = null, record = false) {
  const { p, cfg, open, alpha, H, F, htm, shops, suppliers, employer, workers, owners, smoothers, counts } = world;
  const S = ABM_STRUCT;
  const s = world.state;
  const rs = world.rs;
  const sh = { rn: 0, u: 0, v: 0, istar: 0, ystar: 0, chi: 0, ...shock };
  const rStar = p.neutralRealAnn;
  const lb = p.lowerBoundAnn - p.targetAnn;
  const theta = cfg.resetProb;

  // 1. expectations and wages (quarterly %)
  const piE = (1 - p.anchoring) * s.piPrev;
  const W = s.W * (1 + (piE + S.wageGap * s.xPrev) / 100);

  // 2. idiosyncratic popularity and Calvo draws (always the same number of draws)
  const resetDraw = new Float64Array(F);
  for (let j = 0; j < F; j++) {
    s.pop[j] = S.popularityRho * s.pop[j] + S.popularitySd * gaussianRandom(rs);
    resetDraw[j] = nextRandom(rs);
  }

  // 3. price setting
  const oldPrice = Float64Array.from(s.price);
  const reset = new Int8Array(F);
  const spell = (1 / theta - 1) / 2;
  const markupShock = sh.u / theta; // a cost-push of u lifts inflation by about u on impact
  let resets = 0;
  for (let j = 0; j < F; j++) {
    if (resetDraw[j] >= theta) continue;
    let sup = 0;
    for (let m = 0; m < S.suppliers; m++) sup += oldPrice[suppliers[j * S.suppliers + m]];
    sup /= S.suppliers;
    const mc = (1 - S.inputShare) * W + S.inputShare * sup;
    const target = (1 + S.markup) * (1 + markupShock / 100) * mc * (1 + piE / 100) ** spell * s.pressure[j] ** S.pressure;
    reset[j] = target > oldPrice[j] * (1 + 1e-6) ? 1 : target < oldPrice[j] * (1 - 1e-6) ? -1 : 0;
    s.price[j] = target;
    resets++;
  }
  let lnPH = 0;
  for (let j = 0; j < F; j++) lnPH += s.weights[j] * Math.log(s.price[j] / oldPrice[j]);
  const PH = s.PH * Math.exp(lnPH);

  // Shop shares: expenditure ∝ popularity × price^(1 − ε) among a household's shops.
  const attract = new Float64Array(F);
  for (let j = 0; j < F; j++) attract[j] = Math.exp(s.pop[j]) * s.price[j] ** (1 - S.elasticity);
  const K = new Float64Array(H); // real domestic goods per CZK spent
  for (let i = 0; i < H; i++) {
    let den = 0, inv = 0;
    for (let k = 0; k < S.shops; k++) den += attract[shops[i * S.shops + k]];
    for (let k = 0; k < S.shops; k++) { const j = shops[i * S.shops + k]; inv += attract[j] / den / s.price[j]; }
    K[i] = inv;
  }
  let attractAll = 0;
  for (let j = 0; j < F; j++) attractAll += attract[j];
  let KX = 0; // real export goods per CZK of foreign spending
  for (let j = 0; j < F; j++) KX += attract[j] / attractAll / s.price[j];

  // 4. household plans: smoothers' real consumption is linear in the real-rate gap g
  const cpiPrev = s.CPI;
  let SA = 0, SB = 0, SH = 0;
  const planA = new Float64Array(H), planB = new Float64Array(H), htmSpend = new Float64Array(H);
  for (let i = 0; i < H; i++) {
    if (htm[i]) {
      htmSpend[i] = Math.max(0, s.lastIncome[i] + S.bufferSpeed * s.hhBal[i]);
      SH += htmSpend[i] * K[i];
    } else {
      const c0 = s.cPrev[i];
      planA[i] = c0 * (1 + (p.sigma * sh.rn) / 100) + S.incomePull * (s.ybar[i] - c0) + S.bufferSpeed * (s.hhBal[i] / cpiPrev - s.target[i]);
      planB[i] = (c0 * p.sigma) / 100;
      SA += planA[i] * K[i];
      SB += planB[i] * K[i];
    }
  }
  const X0 = alpha * H;
  const fxTheta = p.fxExpect;
  const psi = p.passThrough;

  // Everything that depends on the policy rate i (annual, internal).
  const evalRate = (i) => {
    const g = (i - rStar) / 4 - piE; // perceived real-rate gap, quarterly %
    let CPI = PH, PF = s.PF, lnE = s.lnE, q = 0, X = 0;
    if (open) {
      q = -(g - sh.istar - sh.chi) / (1 - fxTheta);
      lnE = (q + 100 * Math.log(PH)) / 100;
      PF = s.PF * (Math.exp(lnE) / s.PF) ** psi;
      CPI = PH ** (1 - alpha) * PF ** alpha;
      X = X0 * (1 + S.foreignDemand * sh.ystar / 100) * (PH / Math.exp(lnE)) ** -S.exportElasticity;
    }
    const finalReal = (1 - alpha) * (CPI * (SA - SB * g) + SH) + (open ? X * PH * KX : 0);
    const x = 100 * (finalReal / H - 1);
    const pi = 100 * Math.log(CPI / cpiPrev);
    return { g, CPI, PF, lnE, q, X, x, pi };
  };
  const rule = (o) => rStar + p.phiPi * 4 * o.pi + 4 * p.phiX * o.x + 4 * sh.v;
  let i;
  if (rate !== null && rate !== undefined && Number.isFinite(rate)) {
    i = Math.max(lb, rate);
  } else {
    const f = (r) => r - Math.max(lb, rule(evalRate(r)));
    if (f(lb) >= 0) i = lb;
    else {
      let lo = lb, hi = lb + 10;
      while (f(hi) < 0 && hi < lb + 400) hi += 10;
      for (let it = 0; it < 80; it++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid; else hi = mid;
      }
      i = (lo + hi) / 2;
    }
  }
  const o = evalRate(i);

  // 5. realized spending, production and payments
  const cons = record ? new Float32Array(H * S.shops) : null;
  const imports = new Float64Array(H);
  const spend = new Float64Array(H);
  const sales = new Float64Array(F); // nominal revenue
  const finalQ = new Float64Array(F); // real final demand
  for (let i2 = 0; i2 < H; i2++) {
    const nominal = htm[i2] ? htmSpend[i2] : Math.max(0.05 * s.ybar[i2], planA[i2] - planB[i2] * o.g) * o.CPI;
    spend[i2] = nominal;
    imports[i2] = alpha * nominal;
    const dom = (1 - alpha) * nominal;
    let den = 0;
    for (let k = 0; k < S.shops; k++) den += attract[shops[i2 * S.shops + k]];
    for (let k = 0; k < S.shops; k++) {
      const j = shops[i2 * S.shops + k];
      const pay = (dom * attract[j]) / den;
      sales[j] += pay;
      finalQ[j] += pay / s.price[j];
      if (cons) cons[i2 * S.shops + k] = pay;
    }
  }
  const exportPay = new Float64Array(F);
  if (open) {
    const foreignSpend = o.X * PH;
    for (let j = 0; j < F; j++) {
      exportPay[j] = (foreignSpend * attract[j]) / attractAll;
      sales[j] += exportPay[j];
      finalQ[j] += exportPay[j] / s.price[j];
    }
  }
  const y = leontief(finalQ, suppliers, F, S);
  const inputPay = record ? new Float32Array(F * S.suppliers) : null;
  const inputCost = new Float64Array(F);
  for (let k = 0; k < F; k++) {
    const qty = (S.inputShare * y[k]) / S.suppliers;
    for (let m = 0; m < S.suppliers; m++) {
      const j = suppliers[k * S.suppliers + m];
      const pay = qty * s.price[j];
      inputCost[k] += pay;
      sales[j] += pay;
      if (inputPay) inputPay[k * S.suppliers + m] = pay;
    }
  }
  const wageBill = new Float64Array(F);
  let hoursTotal = 0;
  for (let j = 0; j < F; j++) {
    const n = ((1 - S.inputShare) * y[j]);
    hoursTotal += n;
    s.hours[j] = n / counts[j];
    wageBill[j] = W * n;
  }

  // Interest on the balances at the start of the quarter.
  const loanRate = (i + S.loanSpread) / 400;
  const depRate = Math.max(-p.targetAnn, i - S.depositSpread) / 400;
  const interest = (bal) => (bal < 0 ? bal * loanRate : bal * depRate); // + received, − paid
  const firmInt = new Float64Array(F);
  for (let j = 0; j < F; j++) firmInt[j] = interest(s.firmBal[j]);
  const hhInt = new Float64Array(H);
  for (let k = 0; k < H; k++) hhInt[k] = interest(s.hhBal[k]);
  const stateInt = s.stateBal < 0 ? (s.stateBal * i) / 400 : s.stateBal * depRate;

  // Households: wages, taxes, transfers and benefits for lost hours.
  const wage = new Float64Array(H), tax = new Float64Array(H), benefit = new Float64Array(H);
  for (let k = 0; k < H; k++) {
    const j = employer[k];
    const h = s.hours[j];
    wage[k] = W * h;
    tax[k] = S.taxRate * wage[k];
    benefit[k] = s.transfer + cfg.stabilizer * W * Math.max(0, 1 - h);
  }

  // Firms: profit and dividends to the owners (smoothers working there).
  const dividendPaid = new Float64Array(F);
  const dividend = new Float64Array(H);
  for (let j = 0; j < F; j++) {
    const profit = sales[j] - wageBill[j] - inputCost[j] + firmInt[j];
    const targetBal = -world.L0[j] * (W / world.W0);
    const pay = smoothers.length ? Math.max(0, profit + S.payout * (s.firmBal[j] - targetBal)) : 0;
    const after = s.firmBal[j] + profit;
    dividendPaid[j] = pay;
    const recipients = owners[j].length ? owners[j] : smoothers;
    for (const k of recipients) dividend[k] += pay / recipients.length;
    s.firmBal[j] = after - pay;
  }
  // Bank: interest margin, paid out to all owners (smoothers).
  let bankIncome = 0;
  for (let j = 0; j < F; j++) bankIncome -= firmInt[j];
  for (let k = 0; k < H; k++) bankIncome -= hhInt[k];
  bankIncome -= stateInt;
  const bankAfter = s.bankBal + bankIncome;
  const bankDiv = smoothers.length ? Math.max(0, bankIncome + S.payout * s.bankBal) : 0;
  for (const k of smoothers) dividend[k] += bankDiv / smoothers.length;
  s.bankBal = bankAfter - bankDiv;

  // Household balances and income.
  const income = new Float64Array(H);
  let taxes = 0, benefits = 0, importTotal = 0, consTotal = 0, htmCons = 0, smoothCons = 0;
  for (let k = 0; k < H; k++) {
    income[k] = wage[k] - tax[k] + benefit[k] + hhInt[k] + dividend[k];
    s.hhBal[k] += income[k] - spend[k];
    taxes += tax[k];
    benefits += benefit[k];
    importTotal += imports[k];
    consTotal += spend[k];
    if (htm[k]) htmCons += spend[k]; else smoothCons += spend[k];
  }
  // Firms' cash already includes profit; the state and the rest of the world:
  let exportTotal = 0;
  for (let j = 0; j < F; j++) exportTotal += exportPay[j];
  s.stateBal += taxes - benefits + stateInt;
  s.abroadBal += importTotal - exportTotal;

  // 6. bookkeeping for the next quarter
  const x = 100 * (hoursTotal / H - 1);
  for (let k = 0; k < H; k++) {
    s.lastIncome[k] = income[k];
    s.ybar[k] = (1 - S.incomeGain) * s.ybar[k] + (S.incomeGain * income[k]) / o.CPI;
    s.cPrev[k] = spend[k] / o.CPI;
  }
  let ySum = 0;
  for (let j = 0; j < F; j++) ySum += y[j];
  for (let j = 0; j < F; j++) {
    s.normal[j] = 0.9 * s.normal[j] + 0.1 * y[j];
    s.pressure[j] = y[j] / s.normal[j];
    s.weights[j] = y[j] / ySum;
  }
  // Fiscal rule: the base transfer moves until the budget balances, transfers are
  // indexed to wages and lean against state debt.
  s.transferBase += (S.fiscalBalance * (taxes - benefits + stateInt)) / H / (W / world.W0);
  s.transfer = s.transferBase * (W / world.W0) + (S.fiscalRule * s.stateBal) / H;
  for (let k = 0; k < H; k++) s.target[k] += S.bufferDrift * (s.hhBal[k] / o.CPI - s.target[k]);
  s.W = W;
  s.piPrev = o.pi;
  s.xPrev = x;
  s.CPI = o.CPI;
  s.PH = PH;
  s.PF = o.PF;
  s.lnE = o.lnE;
  s.t++;

  const agg = {
    x, pi: o.pi, piH: 100 * lnPH, piE, i, real: i - 4 * piE, rn: sh.rn, q: o.q, lnE: o.lnE,
    W, CPI: o.CPI, resets: resets / F, htmCons, smoothCons, consumption: consTotal,
    imports: importTotal, exports: exportTotal, taxes, benefits, stateBal: s.stateBal, bankBal: s.bankBal,
    abroadBal: s.abroadBal, money: totalMoney(world),
    wages: wageBill.reduce((a, b) => a + b, 0), inputs: inputCost.reduce((a, b) => a + b, 0),
    dividends: dividendPaid.reduce((a, b) => a + b, 0) + bankDiv,
    interest: -firmInt.reduce((a, b) => a + b, 0) - stateInt, // paid to the bank
    depositInterest: hhInt.reduce((a, b) => a + Math.max(0, b), 0) + Math.max(0, stateInt) + firmInt.reduce((a, b) => a + Math.max(0, b), 0),
  };
  if (!record) return { agg };
  return {
    agg,
    micro: {
      price: Float32Array.from(s.price), reset, output: Float32Array.from(y), hours: Float32Array.from(s.hours),
      firmBal: Float32Array.from(s.firmBal), exports: Float32Array.from(exportPay), dividendPaid: Float32Array.from(dividendPaid),
      firmInterest: Float32Array.from(firmInt), sales: Float32Array.from(sales), wageBill: Float32Array.from(wageBill),
      inputs: inputPay, cons,
      wage: Float32Array.from(wage), tax: Float32Array.from(tax), benefit: Float32Array.from(benefit),
      hhInterest: Float32Array.from(hhInt), dividend: Float32Array.from(dividend), imports: Float32Array.from(imports),
      income: Float32Array.from(income), spend: Float32Array.from(spend), hhBal: Float32Array.from(s.hhBal),
      bankDiv, stateInterest: stateInt,
    },
  };
}

// Simulate the shocked economy and the same economy without shocks (common random
// numbers), after a burn-in that lets the agents settle.
//   spec = { config, params, shocks, policy: { rates?: annual displayed rates or null }, horizon }
// Worlds after the burn-in and baseline runs are cached: they do not depend on the
// shock or on the user's rates, only on the agents' configuration and parameters.
const cache = new Map();
const CACHE_SIZE = 6;
function cached(key, make) {
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const v = make();
  cache.set(key, v);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return v;
}

export function runABM(spec) {
  const cfg = { ...ABM_DEFAULTS, ...(spec.config || {}), economy: spec.economy || 'closed' };
  const p = withDefaults(spec.params);
  const T = spec.horizon ?? 24;
  const paths = shockPaths(spec.shocks || [], T);
  const manual = spec.policy?.rates || [];
  const key = JSON.stringify([cfg, p]);
  const settled = cached(`w${key}`, () => {
    const w = buildWorld(cfg, p);
    for (let k = 0; k < ABM_STRUCT.burnIn; k++) stepWorld(w, {}, null, false);
    return w;
  });
  const baseline = cached(`b${T}${key}`, () => {
    const b = structuredClone(settled);
    const out = [];
    for (let t = 0; t < T; t++) out.push(stepWorld(b, {}, null, false).agg);
    return out;
  });
  const world = structuredClone(settled);
  const startMoney = totalMoney(world);
  const history = [];
  const micro = [];
  for (let t = 0; t < T; t++) {
    const shock = Object.fromEntries(Object.keys(paths).map((k) => [k, paths[k][t]]));
    const m = manual[t];
    const rate = m !== null && m !== undefined && Number.isFinite(m) ? m - p.targetAnn : null;
    const step = stepWorld(world, shock, rate, spec.record !== false);
    history.push(step.agg);
    if (step.micro) micro.push(step.micro);
  }
  return {
    config: cfg, params: p, horizon: T, economy: cfg.economy, history, baseline, micro, startMoney,
    world: {
      H: world.H, F: world.F, htm: world.htm, employer: world.employer, shops: world.shops,
      suppliers: world.suppliers, workers: world.workers, counts: world.counts, owners: world.owners,
    },
    levels: abmLevels(history, baseline, p),
  };
}

// Display levels. Raw levels of the simulated economy, and the response to the shock
// (difference from the same economy without it, which removes idiosyncratic noise)
// mapped to levels like the three-equation model.
export function abmLevels(history, baseline, p) {
  const n = history.length;
  const map = (f) => Array.from({ length: n }, (_, t) => f(history[t], baseline[t]));
  return {
    raw: {
      gap: map((h) => h.x),
      inflation: map((h) => 4 * h.pi + p.targetAnn),
      nominal: map((h) => h.i + p.targetAnn),
      real: map((h) => h.real),
      fx: map((h) => p.eurCzk * Math.exp(h.lnE)),
    },
    response: {
      gap: map((h, b) => h.x - b.x),
      inflation: map((h, b) => 4 * (h.pi - b.pi) + p.targetAnn),
      nominal: map((h, b) => h.i - b.i + p.neutralRealAnn + p.targetAnn),
      real: map((h, b) => h.real - b.real + p.neutralRealAnn),
      natural: map((h) => 4 * h.rn + p.neutralRealAnn),
      fx: map((h, b) => p.eurCzk * Math.exp(h.lnE - b.lnE)),
      expectedInflation: map((h, b) => 4 * (h.piE - b.piE) + p.targetAnn),
    },
  };
}

// The three-equation model "at the corresponding calibration": the rate sensitivity
// of demand comes only from the households that smooth (hand-to-mouth households
// react to income, not to rates), and the Phillips-curve slope from the Calvo
// probability times the wage response to the gap.
export function matchedParams(config = {}, params = {}) {
  const cfg = { ...ABM_DEFAULTS, ...config };
  const p = withDefaults(params);
  return {
    ...p,
    sigma: p.sigma * (1 - cfg.htmShare),
    kappa: cfg.resetProb * ABM_STRUCT.wageGap,
  };
}

