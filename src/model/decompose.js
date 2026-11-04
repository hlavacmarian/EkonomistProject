// Decomposition of every variable into the contributions of the terms of its
// equation, computed directly from a solution (no new solver):
//
//   (IS)   x  = m·E x           expected demand
//              + σ·E π          expected inflation (lowers the real rate)
//              − σ·i            nominal rate set by the bank
//              + σ·rn           natural rate (demand shock)
//   (NKPC) π  = β·m·E π         expected inflation
//              + κ·x            output gap (marginal costs)
//              + u              cost-push shock
//   (TR)   i  = φπ·π            reaction to inflation
//              + φx·x           reaction to the gap
//              + v              monetary shock
//              + (max(lb, s) − s)       lift to the lower bound (s = shadow rate)
//              + (i − max(lb, s))       decision outside the rule (delay, promise, player)
//
// m = 1 in the hybrid regime. Every block sums exactly to its variable.

export const TERMS = Object.freeze({
  IS: ['expX', 'expPi', 'rate', 'natural'],
  NKPC: ['exp', 'gap', 'shock'],
  TR: ['infl', 'gap', 'shock', 'bound', 'override'],
});

// Display scale per block: the gap stays in % of potential, inflation and the
// nominal rate are annualized (p.p. p.a. relative to target / neutral rate).
export const DISPLAY_SCALE = Object.freeze({ IS: 1, NKPC: 4, TR: 4 });

export function decompose(sol, p) {
  const m = sol.mode === 'rational' ? (p.expDiscount ?? 1) : 1;
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const n = sol.x.length;
  const lb = sol.lb;
  const arr = () => new Array(n).fill(0);
  const out = {
    IS: { expX: arr(), expPi: arr(), rate: arr(), natural: arr(), total: arr() },
    NKPC: { exp: arr(), gap: arr(), shock: arr(), total: arr() },
    TR: { infl: arr(), gap: arr(), shock: arr(), bound: arr(), override: arr(), total: arr() },
  };
  for (let t = 0; t < n; t++) {
    const x = sol.x[t], pi = sol.pi[t], i = sol.i[t];
    out.IS.expX[t] = m * sol.Ex[t];
    out.IS.expPi[t] = sigma * sol.Epi[t];
    out.IS.rate[t] = -sigma * i;
    out.IS.natural[t] = sigma * sol.rn[t];
    out.IS.total[t] = x;

    out.NKPC.exp[t] = beta * m * sol.Epi[t];
    out.NKPC.gap[t] = kappa * x;
    out.NKPC.shock[t] = sol.u[t];
    out.NKPC.total[t] = pi;

    const shadow = phiPi * pi + phiX * x + sol.v[t];
    const ruled = Math.max(lb, shadow);
    out.TR.infl[t] = phiPi * pi;
    out.TR.gap[t] = phiX * x;
    out.TR.shock[t] = sol.v[t];
    out.TR.bound[t] = ruled - shadow;
    out.TR.override[t] = i - ruled;
    out.TR.total[t] = i;
  }
  return out;
}

// Same decomposition in display units (see DISPLAY_SCALE).
export function decomposeDisplay(sol, p) {
  const dec = decompose(sol, p);
  for (const [block, scale] of Object.entries(DISPLAY_SCALE)) {
    if (scale === 1) continue;
    for (const k of Object.keys(dec[block])) dec[block][k] = dec[block][k].map((v) => v * scale);
  }
  return dec;
}

// Arrows of the live diagram, per quarter, in display units. Each arrow is one
// group of terms of the equation of the node it points to, so the arrows entering
// a node add up to that node's variable.
//   expDemand   expectations -> demand      m·E x + σ·E π
//   bankDemand  bank -> demand (feedback)   −σ·i
//   shockDemand natural rate -> demand      σ·rn
//   expInfl     expectations -> inflation   β·m·E π
//   demandInfl  demand -> inflation         κ·x
//   shockInfl   cost shock -> inflation     u
//   inflBank    inflation -> bank           φπ·π
//   demandBank  demand -> bank              φx·x
//   shockBank   monetary shock -> bank      v
//   limitBank   bound + decisions outside the rule -> bank
export const FLOW_TARGET = Object.freeze({
  expDemand: 'demand', bankDemand: 'demand', shockDemand: 'demand',
  expInfl: 'inflation', demandInfl: 'inflation', shockInfl: 'inflation',
  inflBank: 'bank', demandBank: 'bank', shockBank: 'bank', limitBank: 'bank',
});

export function causalFlows(dec) {
  const n = dec.IS.total.length;
  const map = (f) => Array.from({ length: n }, (_, t) => f(t));
  return {
    expDemand: map((t) => dec.IS.expX[t] + dec.IS.expPi[t]),
    bankDemand: dec.IS.rate.slice(),
    shockDemand: dec.IS.natural.slice(),
    expInfl: dec.NKPC.exp.slice(),
    demandInfl: dec.NKPC.gap.slice(),
    shockInfl: dec.NKPC.shock.slice(),
    inflBank: dec.TR.infl.slice(),
    demandBank: dec.TR.gap.slice(),
    shockBank: dec.TR.shock.slice(),
    limitBank: map((t) => dec.TR.bound[t] + dec.TR.override[t]),
  };
}
