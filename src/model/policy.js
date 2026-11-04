// Policy overrides on top of the Taylor rule.
//
// policy = {
//   delay:     L   -> the bank keeps the rate at its neutral level for quarters t < L
//   holdUntil: q   -> forward guidance: the rate is held at the lower bound for t < q
//   rates:     [i_0, i_1, ...] -> explicit nominal rates (model units) chosen by a
//                 player; NaN/null entries leave the Taylor rule in charge
// }
// Returns an array where entry t is the forced rate (model units) or NaN if the
// Taylor rule (subject to the lower bound) applies. Forced rates never go below
// the lower bound.

export function policyOverrides(policy, T, lb) {
  const forced = new Float64Array(T).fill(NaN);
  const delay = policy?.delay || 0;
  const holdUntil = policy?.holdUntil || 0;
  const rates = policy?.rates || [];
  for (let t = 0; t < T; t++) {
    if (t < delay) forced[t] = Math.max(0, lb);
    if (t < holdUntil) forced[t] = lb;
    const r = rates[t];
    if (r !== null && r !== undefined && Number.isFinite(r)) forced[t] = Math.max(lb, r);
  }
  return forced;
}

export function hasOverrides(policy) {
  return (policy?.delay || 0) > 0 || (policy?.holdUntil || 0) > 0 ||
    (policy?.rates || []).some((r) => r !== null && r !== undefined && Number.isFinite(r));
}
