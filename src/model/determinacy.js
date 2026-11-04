// Determinacy of the rational-expectations equilibrium under the Taylor rule.
//
// Without shocks the model can be written as E_t z_{t+1} = A z_t with z = (x, pi).
// Both x and pi are jump variables, so a unique bounded solution exists iff both
// eigenvalues of A lie outside the unit circle (Blanchard-Kahn).
//
// With m = expDiscount = 1 this is equivalent to the Taylor principle
//   kappa * (phiPi - 1) + (1 - beta) * phiX > 0   (Bullard & Mitra 2002).

import { eig2, modulus } from './linalg.js';

export function taylorPrincipleValue(p) {
  return p.kappa * (p.phiPi - 1) + (1 - p.beta) * p.phiX;
}

// Transition matrix A for (x, pi), derived from
//   IS:   x_t  = m E x_{t+1} - sigma (phiPi pi_t + phiX x_t - E pi_{t+1})
//   NKPC: pi_t = beta m E pi_{t+1} + kappa x_t
export function transitionMatrix(p) {
  const m = p.expDiscount ?? 1;
  const { beta, sigma, kappa, phiPi, phiX } = p;
  const bm = beta * m;
  return [
    [(1 + sigma * phiX + (sigma * kappa) / bm) / m, (sigma * (phiPi - 1 / bm)) / m],
    [-kappa / bm, 1 / bm],
  ];
}

export function determinacy(p) {
  const [[a, b], [c, d]] = transitionMatrix(p);
  const eigenvalues = eig2(a, b, c, d);
  const moduli = eigenvalues.map(modulus);
  const unstable = moduli.filter((r) => r > 1).length;
  return {
    determinate: unstable === 2,
    unstableCount: unstable,
    eigenvalues,
    moduli,
    taylorPrinciple: taylorPrincipleValue(p),
  };
}
