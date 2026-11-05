// Las calculadoras de las lecciones (content/calculadoras/<id>.json): controles que mueves y resultados que cambian al
// instante. El build revisa la spec, evalúa las fórmulas con los valores iniciales (si una falla o no da un número, el
// build falla) y deja la calculadora dibujada con esos valores, así que se lee igual sin JavaScript. app.js la anima.
//
// Formato:
//   { "titulo": "Softmax en vivo",
//     "intro": "Mueve los logits y mira cómo cambian las probabilidades.",          (opcional, admite Markdown en línea)
//     "entradas": [ { "id": "a", "label": "Logit de Tenis", "min": -5, "max": 10, "paso": 0.1, "valor": 3,
//                     "unidad": "ms", "tipo": "rango" | "numero" } ],
//     "calculos": [ { "id": "ea", "formula": "exp(a)" } ],                          (opcionales: pasos intermedios)
//     "salidas":  [ { "label": "P(Tenis)", "formula": "ea / (ea + eb + ec)", "formato": "pct", "decimales": 1,
//                     "barra": true, "nota": "…" } ],
//     "nota": "Lo que conviene notar al jugar con ella." }                          (opcional)
// Las fórmulas son expresiones de JavaScript con los ids de arriba y las funciones de Math sin prefijo
// (exp, log, log2, log10, sqrt, pow, min, max, abs, round, floor, ceil, sin, cos, PI, E).
// Formatos: num (por omisión), int (miles con coma), pct (×100 y %), sci (notación científica), bytes (B/KB/MB/GB/TB
// decimales), ms (ms o s), x (veces). «barra» dibuja una barra proporcional (para pct, sobre 100 %; para los demás,
// relativa a la salida más grande con barra).
import { esc } from './md.mjs';

const MATH = ['exp', 'log', 'log2', 'log10', 'sqrt', 'pow', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'PI', 'E'];
const FORMATOS = new Set(['num', 'int', 'pct', 'sci', 'bytes', 'ms', 'x']);
const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function compilar(formula, nombres) {
  // eslint-disable-next-line no-new-func
  return new Function(...nombres, `const {${MATH.join(',')}} = Math; return (${formula});`);
}

// Evalúa calculos y salidas con unos valores de entrada; devuelve { valores, salidas: [número] }.
export function evaluar(c, valores) {
  const v = { ...valores };
  for (const k of c.calculos || []) v[k.id] = compilar(k.formula, Object.keys(v))(...Object.values(v));
  const salidas = c.salidas.map((s) => compilar(s.formula, Object.keys(v))(...Object.values(v)));
  return { valores: v, salidas };
}

export function formatear(x, formato = 'num', dec) {
  if (typeof x !== 'number' || !isFinite(x)) return '—';
  const fijo = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const auto = (n) => (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  switch (formato) {
    case 'int': return fijo(Math.round(x), 0);
    case 'pct': return `${fijo(x * 100, dec ?? 1)} %`;
    case 'sci': { if (x === 0) return '0'; const e = Math.floor(Math.log10(Math.abs(x))); const m = x / 10 ** e; return `${fijo(m, dec ?? 2)} × 10^${e}`; }
    case 'bytes': { const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let k = 0, n = x; while (Math.abs(n) >= 1000 && k < u.length - 1) { n /= 1000; k++; } return `${fijo(n, dec ?? auto(n))} ${u[k]}`; }
    case 'ms': return Math.abs(x) >= 1000 ? `${fijo(x / 1000, dec ?? 2)} s` : `${fijo(x, dec ?? auto(x))} ms`;
    case 'x': return `${fijo(x, dec ?? auto(x))}×`;
    default: return fijo(x, dec ?? auto(x));
  }
}

export function validar(c, id) {
  const e = [];
  if (!c.titulo) e.push('falta «titulo»');
  if (!Array.isArray(c.entradas) || !c.entradas.length) e.push('necesita al menos una entrada');
  if (!Array.isArray(c.salidas) || !c.salidas.length) e.push('necesita al menos una salida');
  const vistos = new Set();
  for (const x of [...(c.entradas || []), ...(c.calculos || [])]) {
    if (!ID.test(x.id || '') || MATH.includes(x.id)) e.push(`id inválido o reservado: «${x.id}»`);
    if (vistos.has(x.id)) e.push(`id repetido: «${x.id}»`);
    vistos.add(x.id);
  }
  for (const x of c.entradas || []) {
    for (const k of ['min', 'max', 'valor']) if (typeof x[k] !== 'number') e.push(`entrada ${x.id}: falta «${k}» numérico`);
    if (!x.label) e.push(`entrada ${x.id}: falta «label»`);
    if (x.valor < x.min || x.valor > x.max) e.push(`entrada ${x.id}: «valor» fuera de [min, max]`);
    if (x.tipo && !['rango', 'numero'].includes(x.tipo)) e.push(`entrada ${x.id}: tipo «${x.tipo}»`);
  }
  for (const s of c.salidas || []) {
    if (!s.label || !s.formula) e.push('cada salida necesita «label» y «formula»');
    if (s.formato && !FORMATOS.has(s.formato)) e.push(`salida «${s.label}»: formato «${s.formato}» no existe`);
  }
  if (!e.length) {
    // probar con los valores iniciales y con los extremos de cada entrada
    const base = Object.fromEntries(c.entradas.map((x) => [x.id, x.valor]));
    const pruebas = [base, ...c.entradas.flatMap((x) => [{ ...base, [x.id]: x.min }, { ...base, [x.id]: x.max }])];
    for (const p of pruebas) {
      try {
        const r = evaluar(c, p);
        r.salidas.forEach((y, k) => { if (typeof y !== 'number' || Number.isNaN(y)) e.push(`salida «${c.salidas[k].label}» no da un número con ${JSON.stringify(p)}`); });
      } catch (err) { e.push(`una fórmula falla con ${JSON.stringify(p)}: ${err.message}`); break; }
    }
  }
  return [...new Set(e)].map((x) => `calculadora ${id}: ${x}`);
}

// El HTML: los controles con su valor inicial y las salidas ya calculadas; la spec va en data-calc para app.js.
export function dibujar(c, id, pie, inline) {
  const base = Object.fromEntries(c.entradas.map((x) => [x.id, x.valor]));
  const { salidas } = evaluar(c, base);
  const maxBarra = Math.max(1e-12, ...c.salidas.map((s, k) => (s.barra && s.formato !== 'pct' ? Math.abs(salidas[k]) : 0)));
  const ancho = (s, y) => (s.formato === 'pct' ? Math.max(0, Math.min(1, y)) : Math.max(0, Math.min(1, Math.abs(y) / maxBarra))) * 100;
  const entradas = c.entradas.map((x) => {
    const paso = x.paso ?? (Number.isInteger(x.min) && Number.isInteger(x.max) && Number.isInteger(x.valor) ? 1 : 0.01);
    const tipo = x.tipo === 'numero' ? 'number' : 'range';
    return `<label class="cx-in"><span class="cx-in__l">${inline(x.label)}</span><input type="${tipo}" data-id="${esc(x.id)}" min="${x.min}" max="${x.max}" step="${paso}" value="${x.valor}" aria-label="${esc(x.label.replace(/[*`[\]]/g, ''))}"><output class="cx-in__v" data-out="${esc(x.id)}">${esc(formatear(x.valor, 'num', decimalesDe(paso)))}${x.unidad ? ` ${esc(x.unidad)}` : ''}</output></label>`;
  }).join('');
  const outs = c.salidas.map((s, k) => `<div class="cx-out${s.barra ? ' cx-out--barra' : ''}"><span class="cx-out__l">${inline(s.label)}${s.nota ? `<small>${inline(s.nota)}</small>` : ''}</span><b class="cx-out__v" data-salida="${k}">${esc(formatear(salidas[k], s.formato, s.decimales))}</b>${s.barra ? `<span class="cx-bar"><i data-barra="${k}" style="width:${ancho(s, salidas[k]).toFixed(1)}%"></i></span>` : ''}</div>`).join('');
  const spec = { entradas: c.entradas.map((x) => ({ id: x.id, unidad: x.unidad || '', paso: x.paso })), calculos: c.calculos || [], salidas: c.salidas.map((s) => ({ formula: s.formula, formato: s.formato || 'num', decimales: s.decimales, barra: !!s.barra })) };
  return `<figure class="cx-calc" id="calc-${esc(id)}" data-calc="${esc(JSON.stringify(spec))}">
<figcaption class="calc__head"><span class="calc__icon" aria-hidden="true">⇄</span><span class="calc__title">${inline(c.titulo)}</span><span class="calc__tag">Calculadora</span></figcaption>
${c.intro ? `<p class="cx-intro">${inline(c.intro)}</p>` : ''}<div class="cx-ins">${entradas}</div><div class="cx-outs" aria-live="polite">${outs}</div>${c.nota ? `<p class="cx-nota">${inline(c.nota)}</p>` : ''}${pie ? `<p class="cx-pie">${pie}</p>` : ''}
</figure>`;
}

const decimalesDe = (paso) => { const s = String(paso); return s.includes('.') ? s.split('.')[1].length : 0; };
