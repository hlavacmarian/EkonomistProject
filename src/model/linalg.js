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
