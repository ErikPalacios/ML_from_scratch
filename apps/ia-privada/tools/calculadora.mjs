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
// decimales), ms (ms o s), x (veces), corto (hasta «decimales» decimales, 3 por omisión, sin ceros de sobra: 16 · 4.156). «barra» dibuja una barra proporcional (para pct, sobre 100 %; para los demás,
// relativa a la salida más grande con barra).
//
// Lo que IA Privada le suma al formato de Sensei (una spec de Sensei funciona igual aquí):
//   entradas con "tipo": "opcion" y "opciones": [{ "valor": 80, "label": "NVIDIA H100 SXM · 80 GB" }]: una lista para
//     elegir; «valor» es el número que reciben las fórmulas. El build puede llenar las opciones desde datos (gpus.json).
//   "preajustes": { "label": "Modelo de ejemplo", "inicial": 0, "opciones": [{ "label": "…", "valores": { "id": 1 },
//     "nota": "…" }] }: una lista que, al elegir, pone varios controles de una vez (y dice de dónde salen sus números).
//   en una salida, "cuenta": la cuenta paso a paso con los números de ese momento. Cada {{expresión}} o
//     {{expresión|formato|decimales}} se evalúa como una fórmula y se reescribe al mover los controles.
//   en una salida, "sin_valor": "Nunca": el texto que se muestra cuando la fórmula no da un número finito (en las cuentas,
//     una división entre cero se escribe ∞).
//   en una salida, "veredicto": { "si": "Cabe", "no": "No cabe" }: en vez de un número dice «si» cuando la fórmula da
//     0 o más y «no» cuando da menos de 0.
//   "preajustes" también puede ser una lista de listas ([{ modelos }, { GPUs }]): cada una con su propio selector. El build
//     llena una lista desde datos con "datos": "gpus" | "apis", "campos": { "B": "ancho_banda_gbs" } e "inicial": "<id>".
//   "comparar": { "titulo": "…", "lista": 1, "columnas": [{ "label": "GPUs", "formula": "…", "formato": "int" }],
//     "orden": 0, "nota": "…" }: una tabla con una fila por cada opción de esa lista de preajustes, recalculada con los
//     controles del momento (todo lo demás igual, solo cambian los valores de esa opción). «orden» ordena de menor a mayor
//     por esa columna (con "desc": true, de mayor a menor; los «—» al final).
//   Una página de herramienta toma valores de la dirección (así la abren los casos): /herramientas/sizing/?p1=l40s&r=200.
//     «p<k>» elige la opción de la lista de preajustes k (por su id de datos o su índice); cada otro nombre es el id de una
//     entrada (en una lista de GPUs, su id o su VRAM). Primero los preajustes, después las entradas. El build revisa cada
//     enlace (tools/build.mjs, enlacesHerramienta) y app.js los aplica.
import { esc } from './md.mjs';

const MATH = ['exp', 'log', 'log2', 'log10', 'sqrt', 'pow', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'PI', 'E'];
const FORMATOS = new Set(['num', 'int', 'pct', 'sci', 'bytes', 'ms', 'x', 'corto']);
const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// «preajustes» como lista de listas, aunque venga como una sola (el formato de la fase 1).
export function listasDe(c) {
  if (!c.preajustes) return [];
  if (!Array.isArray(c.preajustes)) c.preajustes = [c.preajustes];
  return c.preajustes;
}

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
  if (x === Infinity) return '∞';
  if (x === -Infinity) return '−∞';
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
    case 'corto': return x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec ?? 3 });
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
    // una lista no tiene rango: sus extremos son su opción más chica y la más grande
    if (x.tipo === 'opcion' && Array.isArray(x.opciones) && x.opciones.length) { const vs = x.opciones.map((o) => o.valor); x.min ??= Math.min(...vs); x.max ??= Math.max(...vs); }
    for (const k of ['min', 'max', 'valor']) if (typeof x[k] !== 'number') e.push(`entrada ${x.id}: falta «${k}» numérico`);
    if (!x.label) e.push(`entrada ${x.id}: falta «label»`);
    if (x.valor < x.min || x.valor > x.max) e.push(`entrada ${x.id}: «valor» fuera de [min, max]`);
    if (x.tipo && !['rango', 'numero', 'opcion'].includes(x.tipo)) e.push(`entrada ${x.id}: tipo «${x.tipo}»`);
    if (x.tipo === 'opcion') {
      if (!Array.isArray(x.opciones) || !x.opciones.length) e.push(`entrada ${x.id}: una «opcion» necesita «opciones»`);
      else {
        for (const o of x.opciones) if (typeof o.valor !== 'number' || !o.label) e.push(`entrada ${x.id}: cada opción necesita «valor» numérico y «label»`);
        if (!x.opciones.some((o) => o.valor === x.valor)) e.push(`entrada ${x.id}: «valor» no es el de ninguna opción`);
      }
    }
  }
  const porId = new Map((c.entradas || []).map((x) => [x.id, x]));
  for (const pa of listasDe(c)) {
    if (!pa.label || !Array.isArray(pa.opciones) || !pa.opciones.length) { e.push('cada lista de «preajustes» necesita «label» y «opciones»'); continue; }
    if (pa.inicial !== undefined && !pa.opciones[pa.inicial]) e.push(`«${pa.label}»: «inicial» no es una opción`);
    for (const o of pa.opciones) {
      if (!o.label || !o.valores) { e.push('cada preajuste necesita «label» y «valores»'); continue; }
      for (const [k, v] of Object.entries(o.valores)) {
        const x = porId.get(k);
        if (!x) e.push(`preajuste «${o.label}»: «${k}» no es una entrada`);
        else if (typeof v !== 'number' || v < x.min || v > x.max) e.push(`preajuste «${o.label}»: ${k} = ${v} fuera de [${x.min}, ${x.max}]`);
        else if (x.tipo === 'opcion' && !x.opciones.some((q) => q.valor === v)) e.push(`preajuste «${o.label}»: ${k} = ${v} no es una opción`);
      }
    }
    // el preajuste inicial tiene que coincidir con los valores iniciales: así la página sin JavaScript no se contradice
    const ini = pa.opciones[pa.inicial ?? 0];
    if (ini && ini.valores) for (const [k, v] of Object.entries(ini.valores)) if (porId.get(k) && porId.get(k).valor !== v) e.push(`el preajuste inicial de «${pa.label}» pone ${k} = ${v}, pero su «valor» es ${porId.get(k).valor}`);
  }
  if (c.comparar) {
    const cm = c.comparar;
    if (!listasDe(c)[cm.lista]) e.push('«comparar.lista» no es una lista de preajustes');
    if (!Array.isArray(cm.columnas) || !cm.columnas.length) e.push('«comparar» necesita «columnas»');
    else for (const col of cm.columnas) { if (!col.label || !col.formula) e.push('cada columna de «comparar» necesita «label» y «formula»'); if (col.formato && !FORMATOS.has(col.formato)) e.push(`columna «${col.label}»: formato «${col.formato}»`); }
  }
  for (const s of c.salidas || []) {
    if (!s.label || !s.formula) e.push('cada salida necesita «label» y «formula»');
    if (s.formato && !FORMATOS.has(s.formato)) e.push(`salida «${s.label}»: formato «${s.formato}» no existe`);
    if (s.veredicto && (!s.veredicto.si || !s.veredicto.no)) e.push(`salida «${s.label}»: «veredicto» necesita «si» y «no»`);
    for (const t of trozos(s.cuenta)) if (t.fmt && !FORMATOS.has(t.fmt)) e.push(`salida «${s.label}»: formato «${t.fmt}» en la cuenta`);
  }
  if (!e.length) {
    // probar con los valores iniciales y con los extremos de cada entrada
    const base = Object.fromEntries(c.entradas.map((x) => [x.id, x.valor]));
    const pruebas = [base, ...c.entradas.flatMap((x) => [{ ...base, [x.id]: x.min }, { ...base, [x.id]: x.max }]),
      ...listasDe(c).flatMap((pa) => pa.opciones.map((o) => ({ ...base, ...o.valores })))];
    for (const p of pruebas) {
      try {
        const r = evaluar(c, p);
        r.salidas.forEach((y, k) => { if (typeof y !== 'number' || Number.isNaN(y)) e.push(`salida «${c.salidas[k].label}» no da un número con ${JSON.stringify(p)}`); });
        for (const s of c.salidas) for (const t of trozos(s.cuenta)) { const y = valorDe(t.expr, r.valores); if (typeof y !== 'number' || Number.isNaN(y)) e.push(`salida «${s.label}»: {{${t.expr}}} no da un número con ${JSON.stringify(p)}`); }
        for (const col of c.comparar?.columnas || []) { const y = valorDe(col.formula, r.valores); if (typeof y !== 'number' || Number.isNaN(y)) e.push(`columna «${col.label}» no da un número con ${JSON.stringify(p)}`); }
      } catch (err) { e.push(`una fórmula falla con ${JSON.stringify(p)}: ${err.message}`); break; }
    }
  }
  return [...new Set(e)].map((x) => `calculadora ${id}: ${x}`);
}

// Los {{expresión|formato|decimales}} de una cuenta.
const RE_TROZO = /\{\{([^|}]+)(?:\|([a-z]+))?(?:\|(\d+))?\}\}/g;
export function trozos(cuenta) {
  if (!cuenta) return [];
  return [...cuenta.matchAll(RE_TROZO)].map((m) => ({ expr: m[1].trim(), fmt: m[2] || 'num', dec: m[3] === undefined ? undefined : Number(m[3]) }));
}
const valorDe = (expr, v) => compilar(expr, Object.keys(v))(...Object.values(v));
// La cuenta en HTML: el texto pasa por Markdown en línea y cada {{…}} queda como <span data-t="k"> con su número.
function cuentaHtml(cuenta, valores, inline) {
  const ts = trozos(cuenta);
  let k = 0;
  const marcado = cuenta.replace(RE_TROZO, () => `\uE000${k++}\uE000`);
  return inline(marcado).replace(/\uE000(\d+)\uE000/g, (_, i) => { const t = ts[Number(i)]; return `<span class="cx-t" data-t="${i}">${esc(formatear(valorDe(t.expr, valores), t.fmt, t.dec))}</span>`; });
}

// El HTML: los controles con su valor inicial y las salidas ya calculadas; la spec va en data-calc para app.js.
export function dibujar(c, id, pie, inline) {
  const base = Object.fromEntries(c.entradas.map((x) => [x.id, x.valor]));
  const { salidas, valores } = evaluar(c, base);
  const maxBarra = Math.max(1e-12, ...c.salidas.map((s, k) => (s.barra && s.formato !== 'pct' ? Math.abs(salidas[k]) : 0)));
  const ancho = (s, y) => (s.formato === 'pct' ? Math.max(0, Math.min(1, y)) : Math.max(0, Math.min(1, Math.abs(y) / maxBarra))) * 100;
  const entradas = c.entradas.map((x) => {
    const paso = x.paso ?? (Number.isInteger(x.min) && Number.isInteger(x.max) && Number.isInteger(x.valor) ? 1 : 0.01);
    if (x.tipo === 'opcion') {
      return `<label class="cx-in cx-in--opcion"><span class="cx-in__l">${inline(x.label)}</span><select data-id="${esc(x.id)}" aria-label="${esc(x.label.replace(/\\[()]/g, '').replace(/[*`[\]]/g, ''))}">${x.opciones.map((o, k) => `<option value="${o.valor}"${k === (x.seleccion ?? x.opciones.findIndex((q) => q.valor === x.valor)) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    }
    const tipo = x.tipo === 'numero' ? 'number' : 'range';
    return `<label class="cx-in"><span class="cx-in__l">${inline(x.label)}</span><input type="${tipo}" data-id="${esc(x.id)}" min="${x.min}" max="${x.max}" step="${paso}" value="${x.valor}" aria-label="${esc(x.label.replace(/\\[()]/g, '').replace(/[*`[\]]/g, ''))}"><output class="cx-in__v" data-out="${esc(x.id)}">${esc(formatear(x.valor, 'num', decimalesDe(paso)))}${x.unidad ? ` ${esc(x.unidad)}` : ''}</output></label>`;
  }).join('');
  const texto = (s, y) => (s.veredicto ? (y >= 0 ? s.veredicto.si : s.veredicto.no) : s.sin_valor && !isFinite(y) ? s.sin_valor : formatear(y, s.formato, s.decimales));
  const clase = (s, y) => (s.veredicto ? (y >= 0 ? ' cx-out--si' : ' cx-out--no') : '');
  const outs = c.salidas.map((s, k) => `<div class="cx-out${s.barra ? ' cx-out--barra' : ''}${s.veredicto ? ' cx-out--veredicto' : ''}${clase(s, salidas[k])}" data-caja="${k}"><span class="cx-out__l"><span>${inline(s.label)}</span>${s.nota ? `<small>${inline(s.nota)}</small>` : ''}</span><b class="cx-out__v" data-salida="${k}">${esc(texto(s, salidas[k]))}</b>${s.barra ? `<span class="cx-bar"><i data-barra="${k}" style="width:${ancho(s, salidas[k]).toFixed(1)}%"></i></span>` : ''}${s.cuenta ? `<span class="cx-cuenta" data-cuenta="${k}">${cuentaHtml(s.cuenta, valores, inline)}</span>` : ''}</div>`).join('');
  const listas = listasDe(c);
  const preajustes = listas.map((pa, j) => { const ini = pa.inicial ?? 0; return `<div class="cx-pre"><label class="cx-in cx-in--opcion"><span class="cx-in__l">${inline(pa.label)}</span><select data-preajuste="${j}" aria-label="${esc(pa.label.replace(/\\[()]/g, '').replace(/[*`[\]]/g, ''))}">${pa.opciones.map((o, k) => `<option value="${k}"${k === ini ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}<option value="-1">Otro (mueve los controles)</option></select></label>${pa.opciones.some((o) => o.nota) ? `<p class="cx-pre__nota" data-preajuste-nota="${j}">${pa.opciones[ini].nota ? inline(pa.opciones[ini].nota) : ''}</p>` : ''}</div>`; }).join('');
  const cm = c.comparar;
  const tabla = cm ? `<div class="cx-cmp"><p class="cx-cmp__t">${inline(cm.titulo || 'Comparación')}</p><div class="cx-cmp__scroll"><table><thead><tr><th scope="col">${esc(listas[cm.lista].label.replace(/\s*\(.*$/, ''))}</th>${cm.columnas.map((col) => `<th scope="col">${inline(col.label)}</th>`).join('')}</tr></thead><tbody data-comparar>${filasComparar(c, valores).map((f) => `<tr data-fila="${f.k}"${f.k === (listas[cm.lista].inicial ?? 0) ? ' class="is-sel"' : ''}><th scope="row">${esc(f.label)}</th>${f.celdas.map((t) => `<td>${esc(t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${cm.nota ? `<p class="cx-cmp__nota">${inline(cm.nota)}</p>` : ''}</div>` : '';
  const spec = { entradas: c.entradas.map((x) => ({ id: x.id, unidad: x.unidad || '', paso: x.paso, ...(x.opciones?.some((o) => o.id) ? { ids: x.opciones.map((o) => o.id || null) } : {}) })), calculos: c.calculos || [],
    salidas: c.salidas.map((s) => ({ formula: s.formula, formato: s.formato || 'num', decimales: s.decimales, barra: !!s.barra, veredicto: s.veredicto || null, sinValor: s.sin_valor || null, cuenta: trozos(s.cuenta) })),
    preajustes: listas.map((pa) => pa.opciones.map((o) => ({ ...(o.id ? { id: o.id } : {}), valores: o.valores, nota: o.nota ? inline(o.nota) : '', label: o.label }))),
    comparar: cm ? { lista: cm.lista, orden: cm.orden ?? null, desc: !!cm.desc, columnas: cm.columnas.map((col) => ({ formula: col.formula, formato: col.formato || 'num', decimales: col.decimales })) } : null };
  return `<figure class="cx-calc" id="calc-${esc(id)}" data-calc="${esc(JSON.stringify(spec))}">
<figcaption class="calc__head"><span class="calc__icon" aria-hidden="true">⇄</span><span class="calc__title">${inline(c.titulo)}</span><span class="calc__tag">Calculadora</span></figcaption>
${c.intro ? `<p class="cx-intro">${inline(c.intro)}</p>` : ''}${preajustes}<div class="cx-ins">${entradas}</div><div class="cx-outs" aria-live="polite">${outs}</div>${tabla}${c.nota ? `<p class="cx-nota">${inline(c.nota)}</p>` : ''}${pie ? `<p class="cx-pie">${pie}</p>` : ''}
</figure>`;
}

// Las filas de «comparar» con unos valores: cada opción de la lista pone sus valores sobre las entradas y se recalcula.
export function filasComparar(c, valores) {
  const cm = c.comparar, pa = listasDe(c)[cm.lista];
  const entradas = Object.fromEntries(c.entradas.map((x) => [x.id, valores[x.id]]));
  const filas = pa.opciones.map((o, k) => {
    const v = evaluar({ ...c, salidas: [] }, { ...entradas, ...o.valores }).valores;
    const ys = cm.columnas.map((col) => { try { return valorDe(col.formula, v); } catch { return NaN; } });
    return { k, label: o.label, ys, celdas: ys.map((y, j) => formatear(y, cm.columnas[j].formato || 'num', cm.columnas[j].decimales)) };
  });
  const sg = cm.desc ? -1 : 1;
  if (cm.orden !== undefined && cm.orden !== null) filas.sort((a, b) => { const x = sg * a.ys[cm.orden], y = sg * b.ys[cm.orden]; return (isFinite(x) ? x : Infinity) - (isFinite(y) ? y : Infinity); });
  return filas;
}

const decimalesDe = (paso) => { const s = String(paso); return s.includes('.') ? s.split('.')[1].length : 0; };
