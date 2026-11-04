// Residual checks: plug a solution back into the model equations.
// Used by the unit tests and shown in the UI as a "verified" indicator.

export function residuals(sol, p) {
  const m = sol.mode === 'rational' ? (p.expDiscount ?? 1) : 1;
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const T = sol.x.length;
  let is = 0, nkpc = 0, policy = 0, expectations = 0, bound = 0;
  for (let t = 0; t < T; t++) {
    const { x, pi, i, Ex, Epi, rn, u, v } = {
      x: sol.x[t], pi: sol.pi[t], i: sol.i[t], Ex: sol.Ex[t], Epi: sol.Epi[t],
      rn: sol.rn[t], u: sol.u[t], v: sol.v[t],
    };
    is = Math.max(is, Math.abs(x - (m * Ex - sigma * (i - Epi - rn))));
    nkpc = Math.max(nkpc, Math.abs(pi - (beta * m * Epi + kappa * x + u)));

    // Expectations must be consistent with the expectations regime.
    if (sol.mode === 'rational') {
      const xNext = t + 1 < T ? sol.x[t + 1] : null;
      const piNext = t + 1 < T ? sol.pi[t + 1] : null;
      if (xNext !== null) {
        expectations = Math.max(expectations, Math.abs(Ex - xNext), Math.abs(Epi - piNext));
      }
    } else {
      const xPrev = t > 0 ? sol.x[t - 1] : 0;
      const piPrev = t > 0 ? sol.pi[t - 1] : 0;
      expectations = Math.max(expectations, Math.abs(Ex - xPrev),
        Math.abs(Epi - (1 - sol.w[t]) * piPrev));
    }

    // Policy: forced rate, or Taylor rule with complementary slackness at the bound.
    const taylor = phiPi * pi + phiX * x + v;
    const forced = sol.forced[t];
    if (!Number.isNaN(forced)) {
      policy = Math.max(policy, Math.abs(i - forced));
    } else {
      policy = Math.max(policy, Math.abs(i - Math.max(sol.lb, taylor)));
    }
    bound = Math.max(bound, Math.max(0, sol.lb - i));
  }
  return { is, nkpc, policy, expectations, bound, max: Math.max(is, nkpc, policy, expectations, bound) };
}
