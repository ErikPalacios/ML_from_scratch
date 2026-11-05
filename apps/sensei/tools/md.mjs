// El Markdown de las lecciones: un subconjunto chico más los bloques propios de Sensei. Sin dependencias.
//
// En línea:  **negritas** · *itálicas* · `código` · [texto](url) · [[id]] o [[id|texto]] (una palabra del glosario)
// Bloques:   ## y ### · párrafos · listas (- y 1.) · tablas (| … |) · ```código``` · > cita
// Propios:   :::idea · :::analogia [título] · :::ojo · :::nota [etiqueta] · :::ejemplo [título] · :::profundo título · :::diagrama id
//            :::figura id · :::conceptos · :::chequeo · :::pasos  (cada uno se cierra con ::: solo en su línea)
//
// crear({ glosario, diagrama, figura }) devuelve render(texto) → { html, secciones, terminos, conceptos }.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function crear({ glosario, diagrama, figura, contexto = '' }) {
  const fallar = (msg) => { throw new Error(`${contexto}: ${msg}`); };

  // ------------------------------------------------------------ en línea
  function inline(s, usados) {
    const guardado = [];
    const guarda = (html) => `\u0000${guardado.push(html) - 1}\u0000`;
    s = s.replace(/`([^`]+)`/g, (_, c) => guarda(`<code>${esc(c)}</code>`));
    s = s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, txt) => {
      const g = glosario.get(id);
      if (!g) fallar(`[[${id}]] no está en el glosario`);
      usados?.add(id);
      return guarda(`<a class="g" href="/glosario/#g-${id}" data-g="${id}">${inline(txt || g.termino.toLowerCase(), usados)}</a>`);
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) => guarda(`<a href="${esc(url)}"${/^https?:/.test(url) ? ' rel="noopener"' : ''}>${inline(txt, usados)}</a>`));
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
        out.push(`<div class="c-code"${lang ? ` data-lang="${esc(lang)}"` : ''}><pre><code>${esc(code.join('\n'))}</code></pre></div>`);
        continue;
      }
      m = l.match(/^(#{2,3})\s+(.+?)(?:\s+\{([^}]+)\})?\s*$/);
      if (m) {
        cerrarParrafo();
        const nivel = m[1].length, t = m[2].trim(), en = m[3], id = slug(t);
        if (nivel === 2 && arriba) {
          // en el nivel de arriba, cada ## abre una sección numerada (como en la Ronda) con su subtítulo en inglés
          if (abierta) out.push('</div></section>');
          estado.secciones.push([id, t.replace(/[*`]/g, '')]);
          const n = String(estado.secciones.length).padStart(2, '0');
          out.push(`<section class="sec" id="${id}"><div class="sec__head"><span class="sec__num">${n}</span><h2 class="sec__title">${inline(t, estado.terminos)}</h2>${en ? `<p class="sec__en">${esc(en)}</p>` : ''}</div><div class="sec__body">`);
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
      case 'diagrama': {
        if (!arg) fallar(':::diagrama necesita el id');
        const pie = dentro.trim() ? inline(dentro.trim().replace(/\n/g, ' '), estado.terminos) : '';
        return diagrama(arg, pie, (s) => inline(s, estado.terminos));
      }
      case 'figura': {
        if (!arg) fallar(':::figura necesita el id');
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
      const estado = { secciones: [], terminos: new Set(), conceptos: [] };
      const html = bloques(texto, estado, true);
      return { html, ...estado };
    },
  };
}
