/* Transformer Lab · núcleo numérico: matrices densas (Float64Array, orden por filas) y PRNG.
   Sin acceso al DOM: se ejecuta igual en el navegador y en Node (tests). */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});

  class Mat {
    constructor(r, c, data) {
      this.r = r | 0;
      this.c = c | 0;
      if (data === undefined || data === null) {
        this.d = new Float64Array(this.r * this.c);
      } else {
        if (data.length !== this.r * this.c) {
          throw new Error('Mat: el tamaño de los datos (' + data.length + ') no coincide con ' + r + '×' + c);
        }
        // Un Float64Array se adopta tal cual (sin copiar); cualquier otro array se convierte.
        this.d = data instanceof Float64Array ? data : Float64Array.from(data);
      }
    }
    get(i, j) { return this.d[i * this.c + j]; }
    set(i, j, v) { this.d[i * this.c + j] = v; return this; }
    clone() { return new Mat(this.r, this.c, this.d.slice()); }
    shape() { return [this.r, this.c]; }
    row(i) { return this.d.slice(i * this.c, (i + 1) * this.c); }
    toArray() {
      const out = [];
      for (let i = 0; i < this.r; i++) out.push(Array.from(this.d.subarray(i * this.c, (i + 1) * this.c)));
      return out;
    }
    // Máximo valor absoluto ignorando ±Infinity (y NaN).
    maxAbs() {
      let m = 0;
      const d = this.d;
      for (let k = 0; k < d.length; k++) {
        const a = Math.abs(d[k]);
        if (a > m && a !== Infinity) m = a;
      }
      return m;
    }
    min() {
      let m = Infinity;
      const d = this.d;
      for (let k = 0; k < d.length; k++) if (Number.isFinite(d[k]) && d[k] < m) m = d[k];
      return m === Infinity ? 0 : m;
    }
    max() {
      let m = -Infinity;
      const d = this.d;
      for (let k = 0; k < d.length; k++) if (Number.isFinite(d[k]) && d[k] > m) m = d[k];
      return m === -Infinity ? 0 : m;
    }
    // Norma de Frobenius (solo valores finitos).
    frob() {
      let s = 0;
      const d = this.d;
      for (let k = 0; k < d.length; k++) if (Number.isFinite(d[k])) s += d[k] * d[k];
      return Math.sqrt(s);
    }
    toString() { return 'Mat(' + this.r + '×' + this.c + ')'; }

    // ---------- constructores ----------
    static zeros(r, c) { return new Mat(r, c); }
    static ones(r, c) { const m = new Mat(r, c); m.d.fill(1); return m; }
    static from2D(arr) {
      const r = arr.length, c = r ? arr[0].length : 0;
      const m = new Mat(r, c);
      for (let i = 0; i < r; i++) {
        if (arr[i].length !== c) throw new Error('Mat.from2D: filas de distinta longitud');
        for (let j = 0; j < c; j++) m.d[i * c + j] = arr[i][j];
      }
      return m;
    }
    static fromRow(arr) { return new Mat(1, arr.length, Float64Array.from(arr)); }
    static eye(n) { const m = new Mat(n, n); for (let i = 0; i < n; i++) m.d[i * n + i] = 1; return m; }
    static randn(r, c, std, rng) {
      const m = new Mat(r, c);
      const s = std === undefined ? 1 : std;
      const g = rng || TL.rng(1);
      for (let k = 0; k < m.d.length; k++) m.d[k] = s * randn(g);
      return m;
    }

    // ---------- álgebra (siempre devuelven una Mat NUEVA) ----------
    // C = A·B. Bucle i-k-j: cada C[i,j] acumula k = 0..K-1 en orden (mismo orden que la suma ingenua).
    static matmul(A, B) {
      if (A.c !== B.r) throw new Error('matmul: dimensiones incompatibles (' + A.r + '×' + A.c + ')·(' + B.r + '×' + B.c + ')');
      const n = A.r, K = A.c, m = B.c;
      const C = new Mat(n, m);
      const a = A.d, b = B.d, c = C.d;
      for (let i = 0; i < n; i++) {
        const io = i * m, ia = i * K;
        for (let k = 0; k < K; k++) {
          const aik = a[ia + k];
          const kb = k * m;
          for (let j = 0; j < m; j++) c[io + j] += aik * b[kb + j];
        }
      }
      return C;
    }
    // C = Aᵀ·B sin materializar la transpuesta (mismo orden de suma que matmul(transpose(A), B)).
    static matmulAT(A, B) {
      if (A.r !== B.r) throw new Error('matmulAT: dimensiones incompatibles');
      const n = A.c, K = A.r, m = B.c;
      const C = new Mat(n, m);
      const a = A.d, b = B.d, c = C.d;
      for (let i = 0; i < n; i++) {
        const io = i * m;
        for (let k = 0; k < K; k++) {
          const aki = a[k * n + i];
          const kb = k * m;
          for (let j = 0; j < m; j++) c[io + j] += aki * b[kb + j];
        }
      }
      return C;
    }
    // C = A·Bᵀ sin materializar la transpuesta (mismo orden de suma que matmul(A, transpose(B))).
    static matmulBT(A, B) {
      if (A.c !== B.c) throw new Error('matmulBT: dimensiones incompatibles');
      const n = A.r, K = A.c, m = B.r;
      const C = new Mat(n, m);
      const a = A.d, b = B.d, c = C.d;
      for (let i = 0; i < n; i++) {
        const ia = i * K, io = i * m;
        for (let j = 0; j < m; j++) {
          const jb = j * K;
          let s = 0;
          for (let k = 0; k < K; k++) s += a[ia + k] * b[jb + k];
          c[io + j] = s;
        }
      }
      return C;
    }
    static transpose(A) {
      const B = new Mat(A.c, A.r);
      const a = A.d, b = B.d, r = A.r, c = A.c;
      for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) b[j * r + i] = a[i * c + j];
      return B;
    }
    static add(A, B) {
      checkSame(A, B, 'add');
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = A.d[k] + B.d[k];
      return C;
    }
    static sub(A, B) {
      checkSame(A, B, 'sub');
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = A.d[k] - B.d[k];
      return C;
    }
    // Producto elemento a elemento (Hadamard, ⊙).
    static mul(A, B) {
      checkSame(A, B, 'mul');
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = A.d[k] * B.d[k];
      return C;
    }
    static scale(A, s) {
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = A.d[k] * s;
      return C;
    }
    // Suma un vector fila 1×c a cada fila (broadcasting).
    static addRowVec(A, v) {
      if (v.c !== A.c) throw new Error('addRowVec: el vector debe ser 1×' + A.c);
      const C = new Mat(A.r, A.c);
      const a = A.d, c = C.d, w = v.d, n = A.c;
      for (let i = 0; i < A.r; i++) for (let j = 0; j < n; j++) c[i * n + j] = a[i * n + j] + w[j];
      return C;
    }
    // Suma sobre las filas → 1×c (sumas por columna).
    static sumRows(A) {
      const C = new Mat(1, A.c);
      for (let i = 0; i < A.r; i++) for (let j = 0; j < A.c; j++) C.d[j] += A.d[i * A.c + j];
      return C;
    }
    // Suma sobre las columnas → r×1.
    static sumCols(A) {
      const C = new Mat(A.r, 1);
      for (let i = 0; i < A.r; i++) {
        let s = 0;
        for (let j = 0; j < A.c; j++) s += A.d[i * A.c + j];
        C.d[i] = s;
      }
      return C;
    }
    static meanCols(A) {
      const C = Mat.sumCols(A);
      for (let i = 0; i < C.r; i++) C.d[i] /= A.c;
      return C;
    }
    static map(A, f) {
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = f(A.d[k], (k / A.c) | 0, k % A.c);
      return C;
    }
    static map2(A, B, f) {
      checkSame(A, B, 'map2');
      const C = new Mat(A.r, A.c);
      for (let k = 0; k < C.d.length; k++) C.d[k] = f(A.d[k], B.d[k], (k / A.c) | 0, k % A.c);
      return C;
    }
    static sliceCols(A, c0, c1) {
      const w = c1 - c0;
      const C = new Mat(A.r, w);
      for (let i = 0; i < A.r; i++) for (let j = 0; j < w; j++) C.d[i * w + j] = A.d[i * A.c + c0 + j];
      return C;
    }
    // Extra (no en la spec): filas r0..r1-1.
    static sliceRows(A, r0, r1) {
      return new Mat(r1 - r0, A.c, A.d.slice(r0 * A.c, r1 * A.c));
    }
    static concatCols(list) {
      const r = list[0].r;
      let c = 0;
      for (const M of list) {
        if (M.r !== r) throw new Error('concatCols: número de filas distinto');
        c += M.c;
      }
      const C = new Mat(r, c);
      let off = 0;
      for (const M of list) {
        for (let i = 0; i < r; i++) for (let j = 0; j < M.c; j++) C.d[i * c + off + j] = M.d[i * M.c + j];
        off += M.c;
      }
      return C;
    }
    // Softmax por filas estable: exp(x − max_fila) / Σ. Las entradas −∞ dan probabilidad 0.
    static rowSoftmax(A) {
      return softmaxParts(A).P;
    }
    static oneHot(ids, V) {
      const M = new Mat(ids.length, V);
      for (let t = 0; t < ids.length; t++) M.d[t * V + ids[t]] = 1;
      return M;
    }
    static gatherRows(E, ids) {
      const d = E.c;
      const M = new Mat(ids.length, d);
      for (let t = 0; t < ids.length; t++) {
        const src = ids[t] * d;
        for (let j = 0; j < d; j++) M.d[t * d + j] = E.d[src + j];
      }
      return M;
    }
  }

  function checkSame(A, B, op) {
    if (A.r !== B.r || A.c !== B.c) {
      throw new Error(op + ': formas distintas (' + A.r + '×' + A.c + ') y (' + B.r + '×' + B.c + ')');
    }
  }

  // Softmax por filas devolviendo también los intermedios (para la traza).
  function softmaxParts(A) {
    const r = A.r, c = A.c;
    const P = new Mat(r, c), exps = new Mat(r, c), rowMax = new Mat(r, 1), rowSum = new Mat(r, 1);
    const a = A.d;
    for (let i = 0; i < r; i++) {
      const o = i * c;
      let mx = -Infinity;
      for (let j = 0; j < c; j++) { const x = a[o + j]; if (x > mx) mx = x; }
      if (mx === -Infinity) mx = 0; // fila completamente enmascarada (no debería ocurrir)
      let s = 0;
      for (let j = 0; j < c; j++) {
        const x = a[o + j];
        const e = x === -Infinity ? 0 : Math.exp(x - mx);
        exps.d[o + j] = e;
        s += e;
      }
      rowMax.d[i] = mx;
      rowSum.d[i] = s;
      const inv = s > 0 ? 1 / s : 0;
      for (let j = 0; j < c; j++) P.d[o + j] = exps.d[o + j] * inv;
    }
    return { P, exps, rowMax, rowSum };
  }
  Mat.softmaxParts = softmaxParts;

  // PRNG determinista mulberry32. La función devuelta expone getState/setState (para snapshots).
  function rng(seed) {
    let a = (seed >>> 0) || 0;
    const f = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.getState = () => a;
    f.setState = (s) => { a = s | 0; };
    return f;
  }

  // Normal estándar por Box–Muller (sin caché del segundo valor, para que sea fácil de reproducir).
  function randn(g) {
    let u1 = g();
    while (u1 <= 1e-300) u1 = g();
    const u2 = g();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  TL.Mat = Mat;
  TL.rng = rng;
  TL.randn = randn;
})(typeof window !== 'undefined' ? window : globalThis);
