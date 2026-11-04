// Calibration, parameter metadata and unit conversions.
//
// Internal units: quarterly rates as deviations from steady state, in percent
// (pi = 0.5 means inflation 0.5 p.p. per quarter above target, i.e. 2 p.p.
// annualized). The output gap x is in percent of potential output.
// UI-facing shock sizes and levels are annualized (p.p. per annum).

export const DEFAULT_PARAMS = Object.freeze({
  beta: 0.99, // discount factor
  sigma: 1, // intertemporal elasticity of substitution
  kappa: 0.1, // slope of the Phillips curve
  phiPi: 1.5, // Taylor-rule response to inflation
  phiX: 0.125, // Taylor-rule response to the output gap (quarterly units; 0.5 annualized)
  rho: 0.8, // default shock persistence
  targetAnn: 2, // inflation target, % p.a.
  neutralRealAnn: 1, // neutral real rate, % p.a.
  lowerBoundAnn: 0, // lower bound on the nominal rate, % p.a.
  expDiscount: 1, // cognitive discounting of expectations (1 = fully rational)
  anchoring: 0.6, // hybrid mode: weight w of the target in inflation expectations
  endogenousAnchoring: false, // hybrid mode: w falls when inflation stays far from target
  anchorBand: 1, // tolerance band (p.p. p.a.) before credibility starts to erode
  anchorMemory: 0.3, // weight of the latest miss in the running memory of misses
});

// Slider metadata for every numeric parameter (ranges are deliberately wide
// enough to reach indeterminacy, e.g. phiPi < 1).
export const PARAM_META = Object.freeze({
  beta: { min: 0.9, max: 0.999, step: 0.001 },
  sigma: { min: 0.05, max: 5, step: 0.05 },
  kappa: { min: 0.005, max: 0.5, step: 0.005 },
  phiPi: { min: 0, max: 4, step: 0.05 },
  phiX: { min: 0, max: 1.5, step: 0.025 },
  rho: { min: 0, max: 0.97, step: 0.01 },
  targetAnn: { min: 0, max: 6, step: 0.1 },
  neutralRealAnn: { min: -2, max: 4, step: 0.1 },
  lowerBoundAnn: { min: -1, max: 2, step: 0.05 },
  expDiscount: { min: 0.5, max: 1, step: 0.01 },
  anchoring: { min: 0, max: 1, step: 0.05 },
  anchorBand: { min: 0.25, max: 4, step: 0.25 },
  anchorMemory: { min: 0.05, max: 1, step: 0.05 },
});

export function withDefaults(params = {}) {
  return { ...DEFAULT_PARAMS, ...params };
}

// Steady-state nominal rate in % p.a. (Fisher: real + expected inflation).
export function steadyNominalAnn(p) {
  return p.neutralRealAnn + p.targetAnn;
}

// The lower bound expressed in the model's units (quarterly deviation of i).
export function lowerBoundDev(p) {
  return (p.lowerBoundAnn - steadyNominalAnn(p)) / 4;
}

// Convert a model solution (quarterly deviations) to annualized levels for display.
export function toLevels(sol, p) {
  const n = sol.x.length;
  const map = (arr, scale, shift) => Array.from({ length: n }, (_, t) => scale * arr[t] + shift);
  return {
    gap: Array.from(sol.x),
    inflation: map(sol.pi, 4, p.targetAnn),
    nominal: map(sol.i, 4, steadyNominalAnn(p)),
    real: map(sol.r, 4, p.neutralRealAnn),
    natural: map(sol.rn, 4, p.neutralRealAnn),
    expectedInflation: map(sol.Epi, 4, p.targetAnn),
  };
}
