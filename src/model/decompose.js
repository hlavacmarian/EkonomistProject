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
//
// Open economy (sol.economy === 'open', see open.js):
//   (IS)   x  = m·E c + σ·E πH − σ·i + σ·rn + δ·q (net exports: exchange rate) + γ·y* (foreign demand)
//   (NKPC) π  = (1−α)·[β·m·E πH + κ·x + u] + α·πF     CPI = domestic goods + imported goods
//   (UIP)  q  = E q + E πH − i + i* + χ + ξ             expected rate, real-rate gap, premium, interventions
//   (TR)   as above, with the inflation the rule reacts to (CPI or domestic)

export const TERMS = Object.freeze({
  IS: ['expX', 'expPi', 'rate', 'natural'],
  NKPC: ['exp', 'gap', 'shock'],
  TR: ['infl', 'gap', 'shock', 'bound', 'override'],
});

export const OPEN_TERMS = Object.freeze({
  IS: ['expX', 'expPi', 'rate', 'natural', 'fx', 'foreign'],
  NKPC: ['exp', 'gap', 'shock', 'imported'],
  UIP: ['expQ', 'expPi', 'rate', 'foreignRate', 'premium', 'intervention'],
  TR: ['infl', 'gap', 'shock', 'bound', 'override'],
});

export const termsFor = (economy) => (economy === 'open' ? OPEN_TERMS : TERMS);

// Display scale per block: the gap and the exchange rate stay in %, inflation and
// the nominal rate are annualized (p.p. p.a. relative to target / neutral rate).
export const DISPLAY_SCALE = Object.freeze({ IS: 1, NKPC: 4, UIP: 1, TR: 4 });

function decomposeOpen(sol, p) {
  const m = sol.mode === 'rational' ? (p.expDiscount ?? 1) : 1;
  const { beta, sigma, kappa, phiPi, phiX, alpha, delta, gamma } = p;
  const omega = p.ruleDomestic || 0;
  const n = sol.x.length;
  const out = {};
  for (const [block, keys] of Object.entries(OPEN_TERMS)) {
    out[block] = Object.fromEntries([...keys, 'total'].map((k) => [k, new Array(n).fill(0)]));
  }
  for (let t = 0; t < n; t++) {
    const { IS, NKPC, UIP, TR } = out;
    IS.expX[t] = m * sol.Ex[t];
    IS.expPi[t] = sigma * sol.Epi[t];
    IS.rate[t] = -sigma * sol.i[t];
    IS.natural[t] = sigma * sol.rn[t];
    IS.fx[t] = delta * sol.q[t];
    IS.foreign[t] = gamma * sol.ystar[t];
    IS.total[t] = sol.x[t];

    NKPC.exp[t] = (1 - alpha) * beta * m * sol.Epi[t];
    NKPC.gap[t] = (1 - alpha) * kappa * sol.x[t];
    NKPC.shock[t] = (1 - alpha) * sol.u[t];
    NKPC.imported[t] = alpha * sol.piF[t];
    NKPC.total[t] = sol.pi[t];

    UIP.expQ[t] = sol.Eq[t];
    UIP.expPi[t] = sol.Epi[t];
    UIP.rate[t] = -sol.i[t];
    UIP.foreignRate[t] = sol.istar[t];
    UIP.premium[t] = sol.chi[t];
    UIP.intervention[t] = sol.xi[t];
    UIP.total[t] = sol.q[t];

    const piR = (1 - omega) * sol.pi[t] + omega * sol.piH[t];
    const shadow = phiPi * piR + phiX * sol.x[t] + sol.v[t];
    const ruled = Math.max(sol.lb, shadow);
    TR.infl[t] = phiPi * piR;
    TR.gap[t] = phiX * sol.x[t];
    TR.shock[t] = sol.v[t];
    TR.bound[t] = ruled - shadow;
    TR.override[t] = sol.i[t] - ruled;
    TR.total[t] = sol.i[t];
  }
  return out;
}

export function decompose(sol, p) {
  if (sol.economy === 'open') return decomposeOpen(sol, p);
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
    if (scale === 1 || !dec[block]) continue;
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

// Open economy: the exchange rate is one more node.
//   fxDemand      exchange rate -> demand (net exports)      δ·q
//   foreignDemand foreign demand -> demand                    γ·y*
//   fxInfl        exchange rate -> inflation (import prices)  α·πF
//   expFx         expectations -> exchange rate               E q + E πH
//   bankFx        bank -> exchange rate (interest rate)       −i
//   foreignFx     foreign rate -> exchange rate               i*
//   shockFx       risk premium -> exchange rate               χ
//   interveneFx   bank interventions -> exchange rate         ξ
export const OPEN_FLOW_TARGET = Object.freeze({
  ...FLOW_TARGET,
  fxDemand: 'demand', foreignDemand: 'demand', fxInfl: 'inflation',
  expFx: 'fx', bankFx: 'fx', foreignFx: 'fx', shockFx: 'fx', interveneFx: 'fx',
});

export const flowTargetFor = (economy) => (economy === 'open' ? OPEN_FLOW_TARGET : FLOW_TARGET);

export function causalFlows(dec) {
  const n = dec.IS.total.length;
  const map = (f) => Array.from({ length: n }, (_, t) => f(t));
  const flows = {
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
  if (dec.UIP) {
    Object.assign(flows, {
      fxDemand: dec.IS.fx.slice(),
      foreignDemand: dec.IS.foreign.slice(),
      fxInfl: dec.NKPC.imported.slice(),
      expFx: map((t) => dec.UIP.expQ[t] + dec.UIP.expPi[t]),
      bankFx: dec.UIP.rate.slice(),
      foreignFx: dec.UIP.foreignRate.slice(),
      shockFx: dec.UIP.premium.slice(),
      interveneFx: dec.UIP.intervention.slice(),
    });
  }
  return flows;
}
