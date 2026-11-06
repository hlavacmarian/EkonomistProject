// Dense linear algebra helpers (the systems here are at most a few hundred unknowns).

// Solve A z = b by Gaussian elimination with partial pivoting.
// A is a row-major Float64Array of size n*n; both inputs are left untouched.
export function solveLinear(Ain, bin, n) {
  const A = Float64Array.from(Ain);
  const b = Float64Array.from(bin);
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(A[k * n + k]);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(A[r * n + k]);
      if (v > max) { max = v; piv = r; }
    }
    if (max < 1e-14) throw new Error('Singular system');
    if (piv !== k) {
      for (let c = k; c < n; c++) {
        const tmp = A[k * n + c]; A[k * n + c] = A[piv * n + c]; A[piv * n + c] = tmp;
      }
      const tb = b[k]; b[k] = b[piv]; b[piv] = tb;
    }
    const akk = A[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = A[r * n + k] / akk;
      if (f === 0) continue;
      for (let c = k; c < n; c++) A[r * n + c] -= f * A[k * n + c];
      b[r] -= f * b[k];
    }
  }
  const z = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * z[c];
    z[r] = s / A[r * n + r];
  }
  return z;
}

// Eigenvalues of a real 2x2 matrix [[a, b], [c, d]] as {re, im} pairs.
export function eig2(a, b, c, d) {
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [{ re: (tr + s) / 2, im: 0 }, { re: (tr - s) / 2, im: 0 }];
  }
  const s = Math.sqrt(-disc);
  return [{ re: tr / 2, im: s / 2 }, { re: tr / 2, im: -s / 2 }];
}

export const modulus = (z) => Math.hypot(z.re, z.im);

// Solve A z = b for a banded matrix (kl sub-diagonals, ku super-diagonals) by
// Gaussian elimination with partial pivoting. A is dense row-major storage of
// size n*n, but only the band (widened by kl through pivoting) is touched, so the
// cost is O(n * kl * (kl + ku)) instead of O(n^3). Inputs are left untouched.
export function solveBanded(Ain, bin, n, kl, ku) {
  const A = Float64Array.from(Ain);
  const b = Float64Array.from(bin);
  const width = kl + ku; // upper bandwidth after row swaps
  for (let k = 0; k < n; k++) {
    const rowEnd = Math.min(n - 1, k + kl);
    const colEnd = Math.min(n - 1, k + width);
    let piv = k;
    let max = Math.abs(A[k * n + k]);
    for (let r = k + 1; r <= rowEnd; r++) {
      const v = Math.abs(A[r * n + k]);
      if (v > max) { max = v; piv = r; }
    }
    if (max < 1e-14) throw new Error('Singular system');
    if (piv !== k) {
      for (let c = k; c <= colEnd; c++) {
        const tmp = A[k * n + c]; A[k * n + c] = A[piv * n + c]; A[piv * n + c] = tmp;
      }
      const tb = b[k]; b[k] = b[piv]; b[piv] = tb;
    }
    const akk = A[k * n + k];
    for (let r = k + 1; r <= rowEnd; r++) {
      const f = A[r * n + k] / akk;
      if (f === 0) continue;
      for (let c = k; c <= colEnd; c++) A[r * n + c] -= f * A[k * n + c];
      b[r] -= f * b[k];
    }
  }
  const z = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    const colEnd = Math.min(n - 1, r + width);
    for (let c = r + 1; c <= colEnd; c++) s -= A[r * n + c] * z[c];
    z[r] = s / A[r * n + r];
  }
  return z;
}

// Characteristic polynomial of a square matrix (array of rows) by the
// Faddeev-LeVerrier recursion: returns [1, c1, ..., cn] for
// lambda^n + c1 lambda^(n-1) + ... + cn.
export function charPoly(M) {
  const n = M.length;
  const mul = (X, Y) => X.map((row, i) => Y[0].map((_, j) => row.reduce((s, _v, k) => s + X[i][k] * Y[k][j], 0)));
  const coeffs = [1];
  let Mk = M.map((row) => row.slice());
  for (let k = 1; k <= n; k++) {
    let tr = 0;
    for (let i = 0; i < n; i++) tr += Mk[i][i];
    const c = -tr / k;
    coeffs.push(c);
    if (k < n) {
      const shifted = Mk.map((row, i) => row.map((v, j) => v + (i === j ? c : 0)));
      Mk = mul(M, shifted);
    }
  }
  return coeffs;
}

// All complex roots of a monic polynomial [1, c1, ..., cn] (Durand-Kerner).
export function polyRoots(coeffs) {
  const n = coeffs.length - 1;
  if (n === 0) return [];
  const evalAt = (zr, zi) => {
    let pr = 1, pi = 0;
    for (let k = 1; k <= n; k++) {
      const r = pr * zr - pi * zi + coeffs[k];
      pi = pr * zi + pi * zr;
      pr = r;
    }
    return [pr, pi];
  };
  const bound = 1 + Math.max(...coeffs.slice(1).map(Math.abs));
  let roots = Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n + 0.4;
    return [0.5 * bound * Math.cos(a), 0.5 * bound * Math.sin(a)];
  });
  for (let it = 0; it < 2000; it++) {
    let moved = 0;
    roots = roots.map(([zr, zi], k) => {
      let [nr, ni] = evalAt(zr, zi);
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const dr = zr - roots[j][0], di = zi - roots[j][1];
        const den = dr * dr + di * di || 1e-300;
        const qr = (nr * dr + ni * di) / den;
        const qi = (ni * dr - nr * di) / den;
        nr = qr; ni = qi;
      }
      moved = Math.max(moved, Math.hypot(nr, ni));
      return [zr - nr, zi - ni];
    });
    if (moved < 1e-14) break;
  }
  return roots.map(([re, im]) => ({ re, im: Math.abs(im) < 1e-10 ? 0 : im }));
}

// Eigenvalues of a small real matrix via its characteristic polynomial.
export function eigenvalues(M) {
  return polyRoots(charPoly(M));
}
