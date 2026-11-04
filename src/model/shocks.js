// Shock specifications and their deterministic paths.
//
// A shock spec is { kind: 'rn' | 'u' | 'v', size, rho, shape, duration, start }:
//   kind     rn = natural real rate (demand), u = cost-push, v = monetary policy
//   size     impact in p.p. annualized (converted to quarterly model units here)
//   shape    'ar1'  -> z_t = size * rho^(t - start)
//            'step' -> z_t = size for start <= t < start + duration, 0 afterwards
//   start    quarter in which the shock hits (default 0)
//
// Instead of a list of specs, the solvers also accept ready-made paths
// { rn: [...], u: [...], v: [...] } in model units (used by the game, whose shocks
// are random draws). Missing entries count as zero.

export const SHOCK_KINDS = ['rn', 'u', 'v'];

export const isPathSet = (shocks) => Boolean(shocks) && !Array.isArray(shocks);

export function shockPaths(shocks, T) {
  const paths = { rn: new Float64Array(T), u: new Float64Array(T), v: new Float64Array(T) };
  if (isPathSet(shocks)) {
    for (const k of SHOCK_KINDS) {
      const src = shocks[k] || [];
      for (let t = 0; t < Math.min(T, src.length); t++) paths[k][t] = src[t] || 0;
    }
    return paths;
  }
  for (const s of shocks || []) {
    const start = s.start || 0;
    const q = s.size / 4;
    for (let t = start; t < T; t++) {
      if (s.shape === 'step') {
        if (t < start + (s.duration || 1)) paths[s.kind][t] += q;
      } else {
        paths[s.kind][t] += q * Math.pow(s.rho, t - start);
      }
    }
  }
  return paths;
}

// Last quarter (exclusive) in which a step shock is active; used by forward guidance.
export function shockEnd(shocks) {
  let end = 0;
  if (isPathSet(shocks)) return end;
  for (const s of shocks || []) {
    if (s.shape === 'step') end = Math.max(end, (s.start || 0) + (s.duration || 1));
  }
  return end;
}

// The method of undetermined coefficients applies when every shock is an AR(1)
// that hits in quarter 0 (otherwise agents would be foreseeing a future shock).
// Ready-made paths are treated as known in advance (perfect foresight).
export function isAr1Only(shocks) {
  if (isPathSet(shocks)) return false;
  return (shocks || []).every((s) => s.shape !== 'step' && !(s.start > 0));
}
