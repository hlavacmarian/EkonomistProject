// Policy overrides on top of the Taylor rule.
//
// policy = {
//   delay:     L   -> the bank keeps the rate at its neutral level for quarters t < L
//   holdUntil: q   -> forward guidance: the rate is held at the lower bound for t < q
// }
// Returns an array where entry t is the forced rate (model units) or NaN if the
// Taylor rule (subject to the lower bound) applies.

export function policyOverrides(policy, T, lb) {
  const forced = new Float64Array(T).fill(NaN);
  const delay = policy?.delay || 0;
  const holdUntil = policy?.holdUntil || 0;
  for (let t = 0; t < T; t++) {
    if (t < delay) forced[t] = Math.max(0, lb);
    if (t < holdUntil) forced[t] = lb;
  }
  return forced;
}

export function hasOverrides(policy) {
  return (policy?.delay || 0) > 0 || (policy?.holdUntil || 0) > 0;
}
