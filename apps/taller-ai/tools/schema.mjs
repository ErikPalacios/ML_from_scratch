// El molde de una estación del Taller: qué piezas tiene y de qué forma. Lo usan validate.mjs y build.mjs.
// Sin dependencias: cada forma es una función que devuelve la lista de errores con su ruta.
//
// Una estación = mapa + precálculos + conceptos exprés + mundo (el kit) + Guiado + Solo + fallas + listo + repaso + prompts.
// Las salidas de los comandos solo pueden ser reales: `salida` es null hasta que el kit se corre (fase 2), y
// entonces se llena con lo que salió, nunca con lo que «debería» salir.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const str = (opts = {}) => (v, p) => {
  if (typeof v !== 'string') return [`${p}: se esperaba texto`];
  if (!opts.empty && !v.trim()) return [`${p}: está vacío`];
  if (opts.max && v.length > opts.max) return [`${p}: ${v.length} caracteres (máximo ${opts.max})`];
  if (opts.re && !opts.re.test(v)) return [`${p}: «${v}» no cumple ${opts.re}`];
  return [];
};
export const int = (min = -Infinity, max = Infinity) => (v, p) =>
  Number.isInteger(v) && v >= min && v <= max ? [] : [`${p}: se esperaba un entero entre ${min} y ${max}`];
export const oneOf = (...vals) => (v, p) => (vals.includes(v) ? [] : [`${p}: «${v}» no es uno de ${vals.join(', ')}`]);
export const nullable = (shape) => (v, p) => (v === null ? [] : shape(v, p));
export const arr = (item, { min = 0, max = Infinity } = {}) => (v, p) => {
  if (!Array.isArray(v)) return [`${p}: se esperaba una lista`];
  const errs = v.length < min || v.length > max ? [`${p}: ${v.length} elementos (se esperan ${min}–${max})`] : [];
  return errs.concat(v.flatMap((x, i) => item(x, `${p}[${i}]`)));
};
// Las llaves que terminan en «?» son opcionales; cualquier llave que no esté en el molde es un error (atrapa typos).
export const obj = (fields) => (v, p) => {
  if (!isObj(v)) return [`${p}: se esperaba un objeto`];
  const errs = [];
  for (const [k, shape] of Object.entries(fields)) {
    const opt = k.endsWith('?');
    const key = opt ? k.slice(0, -1) : k;
    if (!(key in v)) { if (!opt) errs.push(`${p}.${key}: falta`); continue; }
    errs.push(...shape(v[key], `${p}.${key}`));
  }
  const known = new Set(Object.keys(fields).map((k) => k.replace(/\?$/, '')));
  for (const k of Object.keys(v)) if (!known.has(k)) errs.push(`${p}.${k}: llave desconocida`);
  return errs;
};

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const id = str({ re: ID });
const txt = str();
const corto = str({ max: 220 });

const nota = str({ empty: true });
const comando = obj({
  code: txt,
  nota,
  'salida?': nullable(str({ empty: true })),   // null = todavía no se corre; texto = salida real recortada
  'donde?': oneOf('mac', 'contenedor', 'navegador'),
});
const codigo = obj({ lang: oneOf('python', 'sql', 'bash', 'yaml', 'json', 'markdown', 'text'), 'path?': txt, code: txt, nota });

export const estacion = obj({
  id,
  patron: oneOf('sincrono', 'batch', 'llm', 'streaming', 'edge', 'asincrono', 'hibrido'),
  caso: str({ re: /^c\d\d$/ }),
  num: int(1, 20),
  titulo: txt,
  nav: str({ max: 30 }),
  pregunta: txt,
  version: str({ re: /^\d{4}-\d{2}-\d{2}$/ }),
  mapa: obj({
    resumen: txt,
    entra: arr(txt, { min: 1 }),
    sale: arr(txt, { min: 1 }),
    escala: arr(obj({ que: txt, c01: txt, taller: txt }), { min: 3 }),
    'hoja?': txt,                                   // enlace a la estación en la cheat sheet del recorrido
  }),
  // Las cuentas de servilleta de la estación, antes de escribir código: la misma cuenta en C01 y en el taller.
  // Cada una se comprueba con un comando sobre el mundo recién creado (salida real) o apunta al paso que la confirma.
  precalculos: obj({
    intro: txt,
    cuentas: arr(obj({
      id,
      pregunta: txt,
      formula: txt,                                 // la fórmula con palabras, sin números
      c01: obj({ cuenta: txt, valor: txt }),
      taller: obj({ cuenta: txt, valor: txt }),
      decide: txt,                                  // qué decides con el número
      conceptos: arr(id, { min: 1 }),
      'comprueba?': comando,
      'confirma?': txt,
    }), { min: 3, max: 10 }),
  }),
  conceptos: arr(obj({
    id,
    termino: txt,
    en: txt,
    def: corto,
    analogia: txt,
    importa: txt,
    trampa: txt,
  }), { min: 8, max: 18 }),
  mundo: obj({
    resumen: txt,
    trae: arr(obj({ que: txt, detalle: txt }), { min: 3 }),
    tu_pipeline: arr(obj({ archivo: txt, hace: txt }), { min: 3 }),
    requisitos: arr(txt, { min: 1 }),
    sustituciones: arr(obj({ nube: txt, local: txt, diferencia: txt }), { min: 1 }),
  }),
  guiado: arr(obj({
    n: int(0, 30),
    id,
    titulo: txt,
    objetivo: txt,
    conceptos: arr(id, { min: 1 }),
    explica: txt,                                   // la explicación rápida del paso, en el momento en que se usa
    codigo: arr(codigo),
    comandos: arr(comando),
    verifica: txt,                                  // cómo sabes que el paso quedó (lo mismo que revisa verificar.py)
    'ojo?': txt,                                    // la trampa típica de este paso
  }), { min: 4 }),
  solo: obj({
    reglas: arr(txt, { min: 1 }),
    objetivos: arr(obj({ n: int(1, 30), objetivo: txt, check: id, 'pista?': txt }), { min: 4 }),
  }),
  fallas: arr(obj({
    id,
    titulo: txt,
    tipo: oneOf('mundo', 'config', 'infra', 'entorno'),   // dónde la mete romper.py (nunca en tu código)
    historia: txt,                                         // qué «pasó» en la empresa ficticia
    sintoma: txt,
    hipotesis: arr(txt, { min: 2 }),
    confirma: comando,
    arreglo: txt,
    concepto: id,
    check: id,                                             // el check de verificar.py que la detecta
  }), { min: 6 }),
  listo: arr(txt, { min: 3 }),
  repaso: obj({
    memo: txt,
    trampa: txt,
    entrevista: arr(obj({ q: txt, a: txt }), { min: 3 }),
  }),
  prompts: obj({ claude_md: txt, guiado: txt, solo: txt, romper_ayuda: txt, romper_solo: txt }),
  'practicas?': arr(txt, { min: 1 }),             // rutas a las prácticas desde cero de la estación (forma: `practica`)
});

// Una práctica desde cero: sin kit, en una carpeta vacía, con su propia página. El código de cada paso
// puede venir escrito (`code`) o de un archivo de la solución probada (`desde`), para que no se desfasen.
const codigoP = obj({ lang: oneOf('python', 'sql', 'bash', 'yaml', 'json', 'markdown', 'text'), 'path?': txt, 'code?': txt, 'desde?': txt, nota });
export const practica = obj({
  id,
  orden: int(1, 9),
  titulo: txt,
  nav: str({ max: 30 }),
  subtitulo: txt,
  cuando: txt,                                      // en qué momento del ciclo de vida pasa esto
  escena: txt,
  chips: arr(str({ max: 40 }), { min: 2, max: 6 }),
  requisitos: arr(txt, { min: 1 }),
  resultado: arr(txt, { min: 2 }),
  precalculos: arr(obj({
    id,
    pregunta: txt,
    cuenta: txt,
    valor: txt,
    'c01?': txt,
    decide: txt,
    conceptos: arr(id, { min: 1 }),
    'comprueba?': comando,
    'confirma?': txt,
  }), { min: 2, max: 6 }),
  conceptos: arr(obj({ id, termino: txt, en: txt, def: corto, analogia: txt, importa: txt, trampa: txt }), { max: 10 }),
  pasos: arr(obj({
    n: int(1, 30),
    id,
    titulo: txt,
    objetivo: txt,
    conceptos: arr(id, { min: 1 }),
    explica: txt,
    codigo: arr(codigoP),
    comandos: arr(comando),
    verifica: txt,
    'ojo?': txt,
  }), { min: 4 }),
  solo: arr(txt, { min: 3 }),
  prompts: obj({ guiado: txt, solo: txt }),
});

// `conocidos`: los ids de conceptos que una práctica puede usar (los de su estación y los de todas sus prácticas).
export function cruzadasPractica(p, conocidos, existe) {
  const errs = [];
  const dup = (xs, what) => xs.filter((x, i) => xs.indexOf(x) !== i).forEach((x) => errs.push(`${p.id}: ${what} repetido: ${x}`));
  dup(p.pasos.map((x) => x.id), 'paso');
  dup(p.precalculos.map((x) => x.id), 'precálculo');
  p.pasos.forEach((x, i) => {
    if (x.n !== i + 1) errs.push(`${p.id}.pasos[${i}].n = ${x.n}; los pasos van numerados 1, 2, 3…`);
    x.conceptos.forEach((c) => conocidos.has(c) || errs.push(`${p.id}.${x.id}: concepto desconocido «${c}»`));
    x.codigo.forEach((c, j) => {
      if (!!c.code === !!c.desde) errs.push(`${p.id}.${x.id}.codigo[${j}]: lleva «code» o «desde», uno de los dos`);
      if (c.desde && !existe(c.desde)) errs.push(`${p.id}.${x.id}.codigo[${j}]: no existe ${c.desde}`);
    });
  });
  p.precalculos.forEach((x) => {
    x.conceptos.forEach((c) => conocidos.has(c) || errs.push(`${p.id}.precalculos.${x.id}: concepto desconocido «${c}»`));
    if (!x.comprueba && !x.confirma) errs.push(`${p.id}.precalculos.${x.id}: necesita «comprueba» o «confirma»`);
    if (x.comprueba && typeof x.comprueba.salida !== 'string') errs.push(`${p.id}.precalculos.${x.id}: la salida de «comprueba» tiene que ser la real`);
  });
  for (const rel of Object.values(p.prompts)) if (!existe(rel)) errs.push(`${p.id}.prompts: no existe ${rel}`);
  return errs;
}

// Reglas entre piezas que el molde solo no puede ver.
export function cruzadas(e) {
  const errs = [];
  const conceptos = new Set(e.conceptos.map((c) => c.id));
  const checks = new Set(e.solo.objetivos.map((o) => o.check));
  const dup = (xs, what) => xs.filter((x, i) => xs.indexOf(x) !== i).forEach((x) => errs.push(`${what} repetido: ${x}`));
  dup(e.conceptos.map((c) => c.id), 'concepto');
  dup(e.guiado.map((g) => g.id), 'paso');
  dup(e.fallas.map((f) => f.id), 'falla');
  e.guiado.forEach((g, i) => {
    if (g.n !== i) errs.push(`guiado[${i}].n = ${g.n}; los pasos van numerados 0, 1, 2…`);
    g.conceptos.forEach((c) => conceptos.has(c) || errs.push(`guiado.${g.id}: concepto desconocido «${c}»`));
  });
  e.fallas.forEach((f) => {
    if (!conceptos.has(f.concepto)) errs.push(`fallas.${f.id}: concepto desconocido «${f.concepto}»`);
    if (!checks.has(f.check)) errs.push(`fallas.${f.id}: el check «${f.check}» no está en solo.objetivos`);
  });
  e.precalculos.cuentas.forEach((x) => {
    x.conceptos.forEach((c) => conceptos.has(c) || errs.push(`precalculos.${x.id}: concepto desconocido «${c}»`));
    if (!x.comprueba && !x.confirma) errs.push(`precalculos.${x.id}: necesita «comprueba» (un comando) o «confirma» (el paso que la confirma)`);
    if (x.comprueba && typeof x.comprueba.salida !== 'string') errs.push(`precalculos.${x.id}: la salida de «comprueba» tiene que ser la real`);
  });
  dup(e.precalculos.cuentas.map((x) => x.id), 'precálculo');
  const usados = new Set([...e.guiado.flatMap((g) => g.conceptos), ...e.fallas.map((f) => f.concepto)]);
  conceptos.forEach((c) => usados.has(c) || errs.push(`concepto «${c}» no lo usa ningún paso ni falla`));
  return errs;
}
