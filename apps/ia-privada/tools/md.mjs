// El Markdown de las lecciones: un subconjunto chico más los bloques propios de Sensei. Sin dependencias.
//
// En línea:  **negritas** · *itálicas* · `código` · [texto](url) · [[id]] o [[id|texto]] (una palabra del glosario)
//            \( fórmula \) (una ecuación en línea, con la notación de mate.mjs)
// Bloques:   ## y ### · párrafos · listas (- y 1.) · tablas (| … |) · ```código``` · > cita
// Propios:   :::idea · :::analogia [título] · :::ojo · :::nota [etiqueta] · :::ejemplo [título] · :::profundo título · :::diagrama id
//            :::catalogo · :::figura id · :::calculadora id · :::cuenta título · :::formula [título] · :::conceptos · :::chequeo · :::ejercicios · :::pasos
//            (cada uno se cierra con ::: solo en su línea)
// Secciones: «## Título {English title}» abre una sección numerada; «## Título {English} [extra]» la marca como extra
//            (para una segunda pasada). Sin marca, la sección es esencial.
// Código:    ```python … ``` y, justo después, ```salida … ``` con lo que imprime de verdad.
//
// crear({ glosario, diagrama, figura, calculadora }) devuelve render(texto) → { html, secciones, terminos, conceptos, cuenta }.
// secciones: [{ id, t, extra, palabras }]; cuenta: cuántos diagramas, figuras, calculadoras, cuentas y ejercicios trae.

import { mate } from './mate.mjs';
import { bloqueCodigo } from '../vendor/trueml/lib.mjs';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Palabras que se leen de verdad en un pedazo de Markdown (sin marcas, ids ni bloques de código).
export function palabras(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, t) => t || id)
    .replace(/^:::.*$/gm, ' ').replace(/[#*`|>{}\[\]]/g, ' ').split(/\s+/).filter((w) => /[a-záéíóúñü0-9]/i.test(w)).length;
}

// Lo que pesa cada parte de la lección para el tiempo de lectura, contado sobre el texto crudo: las palabras de cada
// sección (todas las líneas de listas, tablas y bloques; el código no), cuáles de ellas van dentro de :::profundo
// (segunda pasada) y las piezas interactivas de cada sección, separando las que van dentro de :::profundo.
// intro = lo que va antes del primer ##.
export function contar(texto) {
  const pz = () => ({ diagramas: 0, figuras: 0, calculadoras: 0, cuentas: 0, ejercicios: 0 });
  const nueva = () => ({ palabras: 0, profundo: 0, piezas: pz(), piezasProfundo: pz() });
  const intro = nueva(), secs = [];
  let cur = intro, prof = 0, profDesde = -1, ejercicios = 0, codigo = false;
  const PIEZA = { diagrama: 'diagramas', figura: 'figuras', calculadora: 'calculadoras', cuenta: 'cuentas', intenta: 'ejercicios' };
  for (const l of texto.replace(/\r/g, '').split('\n')) {
    if (l.startsWith('```')) { codigo = !codigo; continue; }
    if (codigo) continue;
    const ab = l.match(/^:::([a-z]+)\s*(.*)$/);
    if (ab) {
      prof++;
      if (PIEZA[ab[1]]) (profDesde >= 0 ? cur.piezasProfundo : cur.piezas)[PIEZA[ab[1]]]++;
      if (ab[1] === 'profundo' && profDesde < 0) profDesde = prof;
      if (ab[1] === 'ejercicios') ejercicios = prof;
      const w = palabras(ab[2]);
      cur.palabras += w; if (profDesde >= 0) cur.profundo += w;
      continue;
    }
    if (/^:::\s*$/.test(l)) {
      if (prof === profDesde) profDesde = -1;
      if (prof === ejercicios) ejercicios = 0;
      prof = Math.max(0, prof - 1);
      continue;
    }
    if (prof === 0 && /^##\s/.test(l)) { cur = nueva(); secs.push(cur); continue; }
    if (ejercicios && /^\? \[(facil|medio|reto)\]/.test(l)) (profDesde >= 0 ? cur.piezasProfundo : cur.piezas).ejercicios++;
    const w = palabras(l);
    cur.palabras += w; if (profDesde >= 0) cur.profundo += w;
  }
  return { intro, secs };
}

export function crear({ glosario, diagrama, figura, calculadora, extras = {}, contexto = '' }) {
  const fallar = (msg) => { throw new Error(`${contexto}: ${msg}`); };

  // ------------------------------------------------------------ en línea
  function inline(s, usados, guardado = []) {
    // guardado se comparte con las llamadas anidadas: el texto de un [[id|`código`]] trae marcas del nivel de arriba.
    const guarda = (html) => `\u0000${guardado.push(html) - 1}\u0000`;
    s = s.replace(/`([^`]+)`/g, (_, c) => guarda(`<code>${esc(c)}</code>`));
    s = s.replace(/\\\((.+?)\\\)/g, (_, f) => guarda(`<span class="m">${mate(f, fallar)}</span>`));
    s = s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, txt) => {
      const g = glosario.get(id);
      if (!g) fallar(`[[${id}]] no está en el glosario`);
      usados?.add(id);
      return guarda(`<a class="g" href="/glosario/#g-${id}" data-g="${id}">${inline(txt || g.termino.toLowerCase(), usados, guardado)}</a>`);
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => guarda(`<a href="${esc(url)}"${/^https?:/.test(url) ? ' rel="noopener"' : ''}>${inline(txt, usados, guardado)}</a>`));
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => guardado[+i]);
  }

  // ------------------------------------------------------------ bloques
  function bloques(texto, estado, arriba = false) {
    const lineas = texto.replace(/\r/g, '').split('\n');
    const out = [];
    let abierta = false;
    let parrafo = [];
    const cerrarParrafo = () => {
      if (parrafo.length) out.push(`<p>${inline(parrafo.join(' '), estado.terminos)}</p>`);
      parrafo = [];
    };
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      if (!l.trim()) { cerrarParrafo(); continue; }

      let m = l.match(/^:::([a-z]+)\s*(.*)$/);
      if (m) {
        cerrarParrafo();
        const [, tipo, arg] = m;
        const dentro = [];
        let prof = 1;
        for (i++; i < lineas.length; i++) {
          if (/^:::[a-z]+/.test(lineas[i])) prof++;
          else if (/^:::\s*$/.test(lineas[i]) && --prof === 0) break;
          dentro.push(lineas[i]);
        }
        if (prof !== 0) fallar(`el bloque :::${tipo} no se cierra`);
        out.push(propio(tipo, arg.trim(), dentro.join('\n'), estado));
        continue;
      }
      if (l.startsWith('```')) {
        cerrarParrafo();
        const lang = l.slice(3).trim(), code = [];
        for (i++; i < lineas.length && !lineas[i].startsWith('```'); i++) code.push(lineas[i]);
        out.push(bloqueCodigo({ codigo: code.join('\n'), lang: lang === 'salida' ? '' : lang, salida: lang === 'salida' }));
        continue;
      }
      m = l.match(/^(#{2,3})\s+(.+?)(?:\s+\{([^}]+)\})?(?:\s+\[(extra|esencial)\])?\s*$/);
      if (m) {
        cerrarParrafo();
        const nivel = m[1].length, t = m[2].trim(), en = m[3], extra = m[4] === 'extra', id = slug(t);
        if (nivel === 2 && arriba) {
          // en el nivel de arriba, cada ## abre una sección numerada (como en la Ronda) con su subtítulo en inglés
          if (abierta) out.push('</div></section>');
          estado.secciones.push({ id, t: t.replace(/[*`]/g, ''), extra, palabras: 0 });
          const n = String(estado.secciones.length).padStart(2, '0');
          out.push(`<section class="sec${extra ? ' sec--extra' : ''}" id="${id}"><div class="sec__head"><span class="sec__num">${n}</span><h2 class="sec__title">${inline(t, estado.terminos)}</h2><span class="prio prio--${extra ? 'extra' : 'core'}" title="${extra ? 'Para una segunda pasada: la lección se entiende sin ella' : 'Lo esencial de la lección'}">${extra ? 'Extra' : 'Esencial'}</span>${en ? `<p class="sec__en">${esc(en)}</p>` : ''}</div><div class="sec__body">`);
          abierta = true;
        } else {
          out.push(`<h${nivel} class="b-h${nivel}" id="${id}">${inline(t, estado.terminos)}</h${nivel}>${en ? `<p class="sec__en">${esc(en)}</p>` : ''}`);
        }
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        cerrarParrafo();
        const orden = /^\s*\d+\./.test(l), items = [];
        for (; i < lineas.length; i++) {
          const x = lineas[i];
          if (/^\s*([-*]|\d+\.)\s+/.test(x)) items.push(x.replace(/^\s*([-*]|\d+\.)\s+/, ''));
          else if (/^\s{2,}\S/.test(x) && items.length) items[items.length - 1] += ' ' + x.trim();
          else { i--; break; }
        }
        const tag = orden ? 'ol' : 'ul';
        out.push(`<${tag}>${items.map((x) => `<li>${inline(x, estado.terminos)}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (l.startsWith('|')) {
        cerrarParrafo();
        const filas = [];
        for (; i < lineas.length && lineas[i].startsWith('|'); i++) filas.push(lineas[i]);
        i--;
        const celdas = (f) => f.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
        if (filas.length < 2 || !/^\|[\s:|-]+\|$/.test(filas[1])) fallar('una tabla necesita encabezado y la fila |---|');
        const cab = celdas(filas[0]);
        const cuerpo = filas.slice(2).map(celdas);
        // en una celda, \\n (barra y n) parte la línea
        const celda = (c) => inline(c, estado.terminos).replace(/\\n/g, '<br>');
        out.push(`<div class="c-tabla"><table><thead><tr>${cab.map((c) => `<th>${celda(c)}</th>`).join('')}</tr></thead><tbody>${cuerpo.map((r) =>
          `<tr>${r.map((c, k) => (k === 0 ? `<th>${celda(c)}</th>` : `<td>${celda(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (l.startsWith('> ')) {
        cerrarParrafo();
        const q = [];
        for (; i < lineas.length && lineas[i].startsWith('> '); i++) q.push(lineas[i].slice(2));
        i--;
        out.push(`<blockquote>${inline(q.join(' '), estado.terminos)}</blockquote>`);
        continue;
      }
      parrafo.push(l.trim());
    }
    cerrarParrafo();
    if (abierta) out.push('</div></section>');
    return out.join('\n');
  }

  // ------------------------------------------------------------ bloques propios
  function propio(tipo, arg, dentro, estado) {
    const cuerpo = () => bloques(dentro, estado);
    switch (tipo) {
      case 'idea':
        return `<aside class="c-idea"><span class="c-lbl">La idea en una frase</span><div>${cuerpo()}</div></aside>`;
      case 'analogia':
        return `<aside class="c-analogia"><span class="c-lbl">Analogía</span>${arg ? `<h4>${inline(arg, estado.terminos)}</h4>` : ''}<div>${cuerpo()}</div></aside>`;
      case 'ojo':
        return `<aside class="c-ojo"><span class="c-lbl">Ojo</span><div>${cuerpo()}</div></aside>`;
      case 'nota':
        return `<aside class="c-nota">${arg ? `<span class="c-lbl">${inline(arg, estado.terminos)}</span>` : ''}<div>${cuerpo()}</div></aside>`;
      case 'ejemplo':
        return `<aside class="c-ejemplo"><span class="c-lbl">Ejemplo</span>${arg ? `<h4>${inline(arg, estado.terminos)}</h4>` : ''}<div>${cuerpo()}</div></aside>`;
      case 'profundo':
        if (!arg) fallar(':::profundo necesita un título');
        return `<details class="c-profundo"><summary><span class="c-lbl">Para ir más hondo</span><span class="c-profundo-t">${inline(arg, estado.terminos)}</span><i aria-hidden="true">+</i></summary><div>${cuerpo()}</div></details>`;
      case 'pasos': {
        // cada paso empieza con «1. Título» en su línea; lo que sigue hasta el próximo es su texto
        const pasos = [];
        for (const l of dentro.split('\n')) {
          const m = l.match(/^(\d+)\.\s+(.+)$/);
          if (m) pasos.push({ t: m[2], txt: [] });
          else if (pasos.length) pasos[pasos.length - 1].txt.push(l);
          else if (l.trim()) fallar(':::pasos empieza con «1. Título»');
        }
        return `<ol class="c-pasos">${pasos.map((p, k) => `<li><span class="c-pasos-n">${k + 1}</span><div><h4>${inline(p.t, estado.terminos)}</h4>${bloques(p.txt.join('\n'), estado)}</div></li>`).join('')}</ol>`;
      }
      case 'cuenta': {
        // filas «etiqueta | expresión | valor» (la etiqueta puede llevar « // nota»); «= texto» es el resultado
        if (!arg) fallar(':::cuenta necesita un título');
        const filas = [], res = [];
        for (const l of dentro.split('\n')) {
          if (!l.trim()) continue;
          if (l.startsWith('= ')) { res.push(l.slice(2)); continue; }
          const c = l.split(/(?<!\\)\|/).map((x) => x.replace(/\\\|/g, '|').trim());
          if (c.length !== 3) fallar(`:::cuenta «${arg}»: cada fila es «etiqueta | expresión | valor» (vino: ${l})`);
          const [et, nota] = c[0].split(' // ');
          filas.push({ et, nota, ex: c[1], v: c[2] });
        }
        if (!filas.length) fallar(`:::cuenta «${arg}» sin filas`);
        estado.cuenta.cuentas++;
        const I = (x) => inline(x, estado.terminos);
        return `<figure class="calc"><figcaption class="calc__head"><span class="calc__icon" aria-hidden="true">≈</span><span class="calc__title">${I(arg)}</span><span class="calc__tag">La cuenta</span></figcaption><div class="calc__rows">${filas.map((f) =>
          `<div class="calc__row"><div class="calc__label"><span>${I(f.et)}</span>${f.nota ? `<span class="calc__note">${I(f.nota)}</span>` : ''}</div><div class="calc__expr">${I(f.ex)}</div><div class="calc__value">${/^[≈~<>≤≥]/.test(f.v.trim().replace(/^[*_`]+/, '')) ? '' : '<span class="calc__eq" aria-hidden="true">=</span>'}${I(f.v)}</div></div>`).join('')}</div>${
          res.length ? `<div class="calc__result"><span class="calc__result-k">Resultado</span><div class="calc__result-v">${I(res.join(' '))}</div></div>` : ''}</figure>`;
      }
      case 'formula': {
        // una o más líneas con la ecuación (notación de mate.mjs) y, debajo, «- símbolo: qué es» por cada letra
        const eqs = [], vars = [];
        for (const l of dentro.split('\n')) {
          if (!l.trim()) continue;
          const v = l.match(/^- (.+?):\s+(.+)$/);
          if (v) vars.push(v.slice(1));
          else if (l.startsWith('- ')) fallar(`:::formula: cada letra va como «- símbolo: qué es» (vino: ${l})`);
          else if (vars.length) fallar(`:::formula: la ecuación va antes de la lista de letras (vino: ${l})`);
          else eqs.push(l.trim());
        }
        if (!eqs.length) fallar(':::formula sin ecuación');
        const I = (x) => inline(x, estado.terminos);
        return `<figure class="formula">${arg ? `<figcaption class="formula__t">${I(arg)}</figcaption>` : ''}<div class="formula__eqs">${eqs.map((e) => `<div class="m m--bloque">${mate(e, fallar)}</div>`).join('')}</div>${
          vars.length ? `<dl class="formula__vars"><span class="formula__donde">donde</span>${vars.map(([k, d]) => `<div><dt><span class="m">${mate(k, fallar)}</span></dt><dd>${I(d)}</dd></div>`).join('')}</dl>` : ''}</figure>`;
      }
      case 'catalogo': {
        // :::catalogo: la tabla filtrable de hardware; la arma el build con los archivos de datos (extras.catalogo)
        if (!extras.catalogo) fallar(':::catalogo no está disponible aquí');
        return extras.catalogo(arg, dentro, (s) => inline(s, estado.terminos));
      }
      case 'calculadora': {
        if (!arg) fallar(':::calculadora necesita el id');
        if (!calculadora) fallar(':::calculadora no está disponible aquí');
        estado.cuenta.calculadoras++;
        const pie = dentro.trim() ? inline(dentro.trim().replace(/\n/g, ' '), estado.terminos) : '';
        return calculadora(arg, pie, (s) => inline(s, estado.terminos));
      }
      case 'ejercicios': {
        // «? [facil|medio|reto] pregunta» abre un ejercicio; las líneas siguientes son su solución paso a paso
        const qs = [];
        for (const l of dentro.split('\n')) {
          const m2 = l.match(/^\? \[(facil|medio|reto)\]\s+(.+)$/);
          if (m2) qs.push({ nivel: m2[1], q: m2[2].trim(), a: [] });
          else if (l.startsWith('? ')) fallar(':::ejercicios: cada pregunta lleva su nivel, «? [facil] …», «? [medio] …» o «? [reto] …»');
          else if (qs.length) qs[qs.length - 1].a.push(l);
          else if (l.trim()) fallar(':::ejercicios empieza con «? [nivel] pregunta»');
        }
        if (!qs.length) fallar(':::ejercicios sin preguntas');
        estado.cuenta.ejercicios += qs.length;
        const NIV = { facil: 'Fácil', medio: 'Medio', reto: 'Reto' };
        return `<ol class="c-ejercicios">${qs.map((x, k) => `<li class="c-ej c-ej--${x.nivel}"><div class="c-ej-q"><span class="c-num">${k + 1}</span><span class="c-niv">${NIV[x.nivel]}</span><div class="c-q">${bloques(x.q, estado)}</div></div><details class="c-ej-sol"><summary>Ver la solución paso a paso</summary><div class="c-a">${bloques(x.a.join('\n'), estado)}</div></details></li>`).join('')}</ol>`;
      }
      case 'diagrama': {
        if (!arg) fallar(':::diagrama necesita el id');
        estado.cuenta.diagramas++;
        const pie = dentro.trim() ? inline(dentro.trim().replace(/\n/g, ' '), estado.terminos) : '';
        return diagrama(arg, pie, (s) => inline(s, estado.terminos));
      }
      case 'figura': {
        if (!arg) fallar(':::figura necesita el id');
        estado.cuenta.figuras++;
        const pie = dentro.trim() ? inline(dentro.trim().replace(/\n/g, ' '), estado.terminos) : '';
        return `<figure class="c-figura" id="fig-${arg}">${figura(arg)}${pie ? `<figcaption>${pie}</figcaption>` : ''}</figure>`;
      }
      case 'conceptos': {
        const ids = dentro.split(/[\s,]+/).filter(Boolean);
        for (const id of ids) {
          if (!glosario.has(id)) fallar(`:::conceptos menciona «${id}», que no está en el glosario`);
          estado.conceptos.push(id);
          estado.terminos.add(id);
        }
        return `<div class="c-conceptos">${ids.map((id) => tarjeta(glosario.get(id))).join('')}</div>`;
      }
      case 'intenta': {
        // :::intenta Título — la pregunta, una línea «???» y lo que sigue es la solución (cerrada hasta que la abres).
        // Es el «inténtalo antes de ver la solución» de los casos.
        if (!arg) fallar(':::intenta necesita un título');
        const partes = dentro.split(/^\?\?\?\s*$/m);
        if (partes.length !== 2 || !partes[0].trim() || !partes[1].trim()) fallar(':::intenta lleva la pregunta, una línea «???» y la solución');
        estado.cuenta.intentos = (estado.cuenta.intentos || 0) + 1;
        return `<div class="c-intenta"><span class="c-lbl">Inténtalo antes de seguir</span><h4>${inline(arg, estado.terminos)}</h4><div class="c-intenta-q">${bloques(partes[0], estado)}</div><details class="c-ej-sol c-intenta-sol"><summary>Ver cómo lo resolvemos</summary><div class="c-a">${bloques(partes[1], estado)}</div></details></div>`;
      }
      case 'chequeo': {
        // «? pregunta» abre una pregunta; las líneas siguientes son su respuesta
        const qs = [];
        for (const l of dentro.split('\n')) {
          if (l.startsWith('? ')) qs.push({ q: l.slice(2).trim(), a: [] });
          else if (qs.length) qs[qs.length - 1].a.push(l);
          else if (l.trim()) fallar(':::chequeo empieza con «? pregunta»');
        }
        if (!qs.length) fallar(':::chequeo sin preguntas');
        return `<ol class="c-chequeo">${qs.map((x, k) => `<li><details><summary><span class="c-num">${k + 1}</span><span class="c-q">${inline(x.q, estado.terminos)}</span><span class="c-ver">Ver respuesta</span></summary><div class="c-a">${bloques(x.a.join('\n'), estado)}</div></details></li>`).join('')}</ol>`;
      }
      default:
        fallar(`bloque desconocido :::${tipo}`);
    }
  }

  // La tarjeta de un concepto, tal como aparece al final de cada lección.
  function tarjeta(g) {
    const t = new Set();
    return `<details class="c-k" id="k-${g.id}"><summary><span class="c-k-t">${esc(g.termino)}</span>${g.en ? `<span class="c-k-en">${esc(g.en)}</span>` : ''}<span class="c-k-def">${inline(g.corto, t)}</span><span class="c-mas">Más <i aria-hidden="true">+</i></span></summary><div class="c-k-body">${
      g.largo ? `<p>${inline(g.largo, t)}</p>` : ''}${g.analogia ? `<p><b>Analogía. </b>${inline(g.analogia, t)}</p>` : ''}${g.ejemplo ? `<p><b>Ejemplo. </b>${inline(g.ejemplo, t)}</p>` : ''}<p><a href="/glosario/#g-${g.id}">Ver en el glosario →</a></p></div></details>`;
  }

  return {
    inline: (s, usados = new Set()) => inline(s, usados),
    render(texto) {
      const estado = { secciones: [], terminos: new Set(), conceptos: [], cuenta: { diagramas: 0, figuras: 0, calculadoras: 0, cuentas: 0, ejercicios: 0 } };
      const html = bloques(texto, estado, true);
      // el tiempo de lectura se cuenta aparte, sobre el texto crudo de cada sección
      const { intro, secs } = contar(texto);
      if (secs.length !== estado.secciones.length) fallar(`el conteo encontró ${secs.length} secciones y el render ${estado.secciones.length}`);
      secs.forEach((s, k) => Object.assign(estado.secciones[k], s));
      return { html, ...estado, intro };
    },
  };
}
