/**
 * Natural periods of a shear-building model (one mass per floor, one spring per story).
 * Ported from the prototype's eigSym() and computeNatBeat(), extended to N floors with
 * unequal masses. No rendering imports: this runs in Node tests too.
 */

/** Eigenvalues of a symmetric matrix by cyclic Jacobi rotations, sorted ascending. */
export function eigSym(A: number[][]): number[] {
  const n = A.length;
  const a = A.map(r => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    }
  }
  return a.map((r, i) => r[i]).sort((x, y) => x - y);
}

/**
 * Periods in seconds, longest first. `masses[i]` is floor i+1 (kg), `stiffness[i]` is the
 * story below it (N/m), so stiffness[0] ties floor 1 to the ground.
 * Solves K x = w^2 M x through the symmetric form M^-1/2 K M^-1/2.
 */
export function shearBuildingPeriods(masses: number[], stiffness: number[]): number[] {
  const n = masses.length;
  if (stiffness.length !== n) throw new Error('need one story stiffness per floor');
  const K = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    K[i][i] += stiffness[i];
    if (i + 1 < n) {
      K[i][i] += stiffness[i + 1];
      K[i][i + 1] -= stiffness[i + 1];
      K[i + 1][i] -= stiffness[i + 1];
    }
  }
  const r = masses.map(m => 1 / Math.sqrt(m));
  const A = K.map((row, i) => row.map((k, j) => k * r[i] * r[j]));
  return eigSym(A).map(w2 => 2 * Math.PI / Math.sqrt(Math.max(w2, 1e-12)));
}

/**
 * Scales a stiffness profile so the first (longest) period equals `targetT`.
 * Periods scale with 1/sqrt(k), so one multiplication is exact.
 */
export function tuneToPeriod(masses: number[], profile: number[], targetT: number): number[] {
  const T1 = shearBuildingPeriods(masses, profile)[0];
  const f = (T1 / targetT) ** 2;
  return profile.map(k => k * f);
}
