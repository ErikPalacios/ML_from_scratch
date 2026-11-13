// Ecuaciones chicas, sin dependencias y sin conexión: lo justo para escribir fórmulas legibles en las lecciones.
//
//   frac{a}{b}     fracción apilada (se pueden anidar)
//   sqrt{x}        raíz cuadrada
//   x_i  x_{antes} subíndice (una letra o un grupo entre llaves)
//   x^2  e^{-x}    superíndice
//   text{palabra}  texto normal dentro de la fórmula
//   sum  prod      Σ y Π grandes; sum_{i=1}^{n} lleva sus límites
//
// Las letras sueltas (L, w, x, λ…) son variables y van en cursiva; las palabras (min, max, log, exp, RTT) van rectas.
// El guion «-» y el asterisco «*» se muestran como «−» y «×». Lo demás (números, =, +, ÷, ≈, ≤, paréntesis) va tal cual.
// En línea, una fórmula se escribe \( … \); en bloque, con :::formula (ver md.mjs).

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LETRA = /[A-Za-zÁÉÍÓÚáéíóúÑñüΑ-Ωα-ωµ]/;
const GRIEGA = /[Α-Ωα-ωµ]/;
const OPS = new Set(['=', '+', '−', '×', '÷', '·', '≈', '≤', '≥', '<', '>', '±', '→', '≠', '∝']);
const GRANDES = { sum: '∑', prod: '∏' };

// Lee un grupo {…} a partir de s[i] === '{'; devuelve [contenido, índice después del cierre].
function grupo(s, i, error) {
  if (s[i] !== '{') error(`se esperaba «{» en «${s}»`);
  let prof = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') prof++;
    else if (s[j] === '}' && --prof === 0) return [s.slice(i + 1, j), j + 1];
  }
  return error(`falta cerrar «{» en «${s}»`);
}

export function mate(s, error = (m) => { throw new Error(m); }) {
  let out = '';
  let i = 0;
  // un argumento de _ o ^: un grupo {…} o un solo carácter
  const arg = () => {
    if (s[i] === '{') { const [g, j] = grupo(s, i, error); i = j; return g; }
    return s[i++] || '';
  };
  while (i < s.length) {
    const c = s[i];
    const resto = s.slice(i);
    let m;
    if ((m = resto.match(/^frac\{/))) {
      i += 4;
      const [a, j] = grupo(s, i, error); i = j;
      const [b, k] = grupo(s, i, error); i = k;
      out += `<span class="m-frac"><span class="m-num">${mate(a, error)}</span><span class="m-den">${mate(b, error)}</span></span>`;
    } else if ((m = resto.match(/^sqrt\{/))) {
      i += 4;
      const [a, j] = grupo(s, i, error); i = j;
      out += `<span class="m-raiz"><span class="m-raiz-s">√</span><span class="m-raiz-x">${mate(a, error)}</span></span>`;
    } else if ((m = resto.match(/^text\{/))) {
      i += 4;
      const [a, j] = grupo(s, i, error); i = j;
      out += `<span class="m-t">${esc(a)}</span>`;
    } else if ((m = resto.match(/^(sum|prod)(?![A-Za-z])/))) {
      i += m[1].length;
      let abajo = '', arriba = '';
      for (let k = 0; k < 2; k++) {
        if (s[i] === '_') { i++; abajo = arg(); } else if (s[i] === '^') { i++; arriba = arg(); }
      }
      out += `<span class="m-op-g">${arriba ? `<span class="m-lim">${mate(arriba, error)}</span>` : ''}<span class="m-sig">${GRANDES[m[1]]}</span>${abajo ? `<span class="m-lim">${mate(abajo, error)}</span>` : ''}</span>`;
    } else if (c === '_' || c === '^') {
      i++;
      const a = arg();
      const x = a.trim() === '*' ? '∗' : mate(a, error);   // p^* es «p estrella», no una multiplicación
      out += c === '_' ? `<sub>${x}</sub>` : `<sup>${x}</sup>`;
    } else if (GRIEGA.test(c)) {
      // una letra griega es su propio símbolo: minúscula en cursiva (λ, ρ), mayúscula recta (Δ, Σ), así «Δt» sale Δ y t
      i++;
      out += c === c.toLowerCase() ? `<i class="m-v">${c}</i>` : `<span class="m-w">${c}</span>`;
    } else if (LETRA.test(c)) {
      let j = i;
      while (j < s.length && LETRA.test(s[j]) && !GRIEGA.test(s[j])) j++;
      const w = s.slice(i, j); i = j;
      out += w.length === 1 ? `<i class="m-v">${esc(w)}</i>` : `<span class="m-w">${esc(w)}</span>`;
    } else if (/[0-9]/.test(c)) {
      const n = resto.match(/^[0-9][0-9.,]*[0-9]|^[0-9]/)[0];
      i += n.length;
      out += `<span class="m-n">${esc(n)}</span>`;
    } else if (c === '-' || c === '*' || OPS.has(c)) {
      i++;
      const o = c === '-' ? '−' : c === '*' ? '×' : c;
      // un «−» al principio o después de otro operador o de «(» es un signo, no una resta
      const signo = o === '−' && /(^|<span class="m-o">[^<]*<\/span>|\(\s*)$/.test(out);
      out += signo ? '−' : `<span class="m-o">${esc(o)}</span>`;
    } else if (c === ' ') {
      i++;
    } else if (c === '{' || c === '}') {
      i++;   // llaves sueltas: agrupan sin dibujarse
    } else {
      i++;
      out += esc(c);
    }
  }
  return out;
}

export const mateLinea = (s, error) => `<span class="m">${mate(s, error)}</span>`;
export const mateBloque = (s, error) => `<div class="m m--bloque">${mate(s, error)}</div>`;
