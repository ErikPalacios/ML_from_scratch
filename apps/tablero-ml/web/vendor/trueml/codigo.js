/* TrueML · bloques de código: un solo formato para todas las herramientas.
   Sirve en el navegador (window.TrueMLCodigo) y en los builds de Node (lib.mjs → bloqueCodigo / resaltar).
     TrueMLCodigo.resaltar(codigo, lang)         → HTML con <span class="tk-…"> (ya escapado)
     TrueMLCodigo.bloque({codigo, lang, titulo, id, salida}) → el bloque completo <figure class="tm-code">
     TrueMLCodigo.mejorar(raiz?)                 → en el navegador: a cada <figure class="tm-code"> sin barra le pone la
                                                   barra (lenguaje, título, copiar) y resalta su <pre>; si `todo`, también
                                                   envuelve cualquier <pre> suelto (data-tm-codigo="todo" en <html>)
   El diseño vive en piezas.css (.tm-code, .tk-*). Los colores salen de los --tm-* y --tk-*. */
(function (raiz) {
  'use strict';

  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };

  // ---------------------------------------------------------------- lenguajes
  var PY_KW = 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case';
  var PY_BI = 'print len range int float str bool list dict set tuple type isinstance enumerate zip map filter sorted sum min max abs open super self cls round any all iter next input repr hash id format reversed property staticmethod classmethod';
  var JS_KW = 'abstract async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of package private protected public return static super switch this throw try type typeof var void while with yield as';
  var SQL_KW = 'select from where group by order having limit offset join left right inner outer full cross on as and or not in is null like between exists union all distinct insert into values update set delete create table index view drop alter add column primary key foreign references default unique with case when then else end asc desc count sum avg min max over partition';
  var DOCKER_KW = 'FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS';
  var palabras = function (s) { return '\\b(?:' + s.split(' ').join('|') + ')\\b'; };

  // Cada regla: [clase, patrón]. Se prueban en orden en cada posición; gana la primera que encaja.
  var STR2 = '"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'';
  var NUM = '\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b';
  var LANGS = {
    python: [
      ['c', '#[^\\n]*'],
      ['s', '[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')'],
      ['s', '[rRbBfFuU]{0,2}(?:' + STR2 + ')'],
      ['d', '@[A-Za-z_][\\w.]*'],
      ['k', palabras(PY_KW)],
      ['v', '\\b(?:True|False|None)\\b'],
      ['f', '\\b(?:' + PY_BI.split(' ').join('|') + ')(?=\\()'],
      ['f', '(?<=\\bdef\\s|\\bclass\\s)[A-Za-z_]\\w*'],
      ['f', '\\b[A-Za-z_]\\w*(?=\\()'],
      ['n', NUM]
    ],
    bash: [
      ['c', '(?<![\\w$])#[^\\n]*'],
      ['p', '^[ \\t]*[$#%](?= )'],
      ['s', '"(?:[^"\\\\]|\\\\[\\s\\S])*"|\'[^\']*\''],
      ['v', '\\$(?:\\{[^}\\n]*\\}|\\([^)\\n]*\\)|[A-Za-z_]\\w*|[0-9@#?*!$-])'],
      ['a', '(?<=\\s|^)--?[A-Za-z][\\w-]*(?:=[^\\s]*)?'],
      ['k', '\\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|local|set|unset|source|alias)\\b'],
      ['f', '(?:^|(?<=[|;&(]\\s)|(?<=[|;&(]))[ \\t]*[A-Za-z_./][\\w./-]*', 'cmd'],
      ['o', '\\|\\||&&|[|;&<>]+']
    ],
    json: [
      ['a', '"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:)'],
      ['s', '"(?:[^"\\\\\\n]|\\\\.)*"'],
      ['v', '\\b(?:true|false|null)\\b'],
      ['n', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b']
    ],
    yaml: [
      ['c', '#[^\\n]*'],
      ['a', '^[ \\t]*(?:-[ \\t]+)?[A-Za-z_][\\w./-]*(?=:(?:\\s|$))'],
      ['s', STR2],
      ['v', '\\b(?:true|false|null|yes|no|on|off)\\b'],
      ['v', '[&*][\\w-]+'],
      ['n', NUM]
    ],
    docker: [
      ['c', '^[ \\t]*#[^\\n]*'],
      ['k', '^[ \\t]*(?:' + DOCKER_KW.split(' ').join('|') + ')\\b'],
      ['s', STR2],
      ['v', '\\$(?:\\{[^}\\n]*\\}|[A-Za-z_]\\w*)'],
      ['a', '(?<=\\s)--[\\w-]+(?:=[^\\s]*)?'],
      ['n', NUM]
    ],
    js: [
      ['c', '//[^\\n]*|/\\*[\\s\\S]*?\\*/'],
      ['s', '`(?:[^`\\\\]|\\\\[\\s\\S])*`|' + STR2],
      ['k', palabras(JS_KW)],
      ['v', '\\b(?:true|false|null|undefined|NaN)\\b'],
      ['f', '\\b[A-Za-z_$][\\w$]*(?=\\()'],
      ['n', NUM]
    ],
    sql: [
      ['c', '--[^\\n]*|/\\*[\\s\\S]*?\\*/'],
      ['s', '\'(?:[^\']|\'\')*\''],
      ['k', '(?i:' + palabras(SQL_KW) + ')'],
      ['f', '\\b[A-Za-z_]\\w*(?=\\()'],
      ['n', NUM]
    ],
    toml: [
      ['c', '#[^\\n]*'],
      ['a', '^[ \\t]*\\[[^\\]\\n]+\\]|^[ \\t]*[A-Za-z_][\\w.-]*(?=\\s*=)'],
      ['s', STR2],
      ['v', '\\b(?:true|false)\\b'],
      ['n', NUM]
    ]
  };
  var ALIAS = { py: 'python', python3: 'python', ipython: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
    bash: 'bash', yml: 'yaml', dockerfile: 'docker', docker: 'docker', javascript: 'js', typescript: 'js', ts: 'js', jsx: 'js', tsx: 'js', mjs: 'js',
    node: 'js', postgres: 'sql', postgresql: 'sql', sql: 'sql', json: 'json', jsonc: 'json', yaml: 'yaml', toml: 'toml', ini: 'toml', js: 'js' };
  var NOMBRE = { python: 'Python', bash: 'Terminal', json: 'JSON', yaml: 'YAML', docker: 'Dockerfile', js: 'JavaScript', sql: 'SQL', toml: 'TOML' };

  // El motor de expresiones de JS no tiene (?i:…): lo emulo con la bandera i por regla.
  var cache = {};
  function compilar(lang) {
    if (cache[lang]) return cache[lang];
    var reglas = LANGS[lang].map(function (r) {
      var pat = r[1], flags = 'gm';
      if (pat.indexOf('(?i:') === 0) { pat = '(?:' + pat.slice(4); flags = 'gmi'; }
      try { return { c: r[0], re: new RegExp(pat, flags), cmd: r[2] === 'cmd' }; } catch (e) { return null; }
    }).filter(Boolean);
    cache[lang] = reglas;
    return reglas;
  }

  function lenguaje(lang) { var l = String(lang || '').toLowerCase().trim(); return ALIAS[l] || (LANGS[l] ? l : ''); }

  /** Detecta el lenguaje cuando el bloque no lo dice (solo lo evidente; si no, texto sin color). */
  function adivinar(codigo) {
    var t = String(codigo);
    if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(t) && /"\s*:/.test(t)) return 'json';
    if (/^\s*(?:\$ |docker |pip |git |curl |kubectl |npm |python |cd |ls |export |brew |uv )/m.test(t)) return 'bash';
    if (/^\s*(?:def |class |import |from \S+ import |@\w)/m.test(t)) return 'python';
    if (/^FROM \S/m.test(t) && /^(?:RUN|COPY|CMD|WORKDIR)\b/m.test(t)) return 'docker';
    return '';
  }

  function resaltar(codigo, lang) {
    var texto = String(codigo == null ? '' : codigo).replace(/\r\n?/g, '\n');
    var l = lenguaje(lang) || adivinar(texto);
    if (!l) return esc(texto);
    var reglas = compilar(l), out = '', i = 0, n = texto.length;
    var sig = n;
    // Para cada regla se guarda su siguiente coincidencia; en cada paso se toma la más cercana (empate: la primera regla).
    var prox = reglas.map(function () { return null; });
    function buscar(k, desde) {
      var re = reglas[k].re; re.lastIndex = desde;
      var m = re.exec(texto);
      while (m && m[0] === '') { re.lastIndex++; m = re.exec(texto); if (re.lastIndex > n) { m = null; break; } }
      prox[k] = m;
    }
    for (var k = 0; k < reglas.length; k++) buscar(k, 0);
    while (i < n) {
      var mejor = -1, pos = sig;
      for (var j = 0; j < reglas.length; j++) {
        if (prox[j] && prox[j].index < i) buscar(j, i);
        if (prox[j] && prox[j].index < pos) { pos = prox[j].index; mejor = j; }
      }
      if (mejor < 0) { out += esc(texto.slice(i)); break; }
      var m = prox[mejor];
      if (pos > i) out += esc(texto.slice(i, pos));
      var tok = m[0];
      // en bash, el comando va sin los espacios de sangría delante
      if (reglas[mejor].cmd) { var sp = /^[ \t]*/.exec(tok)[0]; out += esc(sp); tok = tok.slice(sp.length); }
      out += '<span class="tk-' + reglas[mejor].c + '">' + esc(tok) + '</span>';
      i = pos + m[0].length;
      for (var q = 0; q < reglas.length; q++) if (prox[q] && prox[q].index < i) buscar(q, i);
    }
    return out;
  }

  var ICO_COPIAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';

  function barra(l, titulo, copiarId) {
    var nombre = l ? NOMBRE[l] : '';
    return '<div class="tm-code__bar">' +
      (nombre ? '<span class="tm-code__lang">' + esc(nombre) + '</span>' : '') +
      (titulo ? '<span class="tm-code__title">' + esc(titulo) + '</span>' : '<span class="tm-code__title"></span>') +
      '<button type="button" class="tm-code__copy" data-tm-copiar' + (copiarId ? '="' + esc(copiarId) + '"' : '') + ' aria-label="Copiar el código">' + ICO_COPIAR + '<span>Copiar</span></button></div>';
  }

  /** El bloque completo. salida:true lo pinta como la salida real de un comando (verde, sin resaltado). */
  function bloque(o) {
    o = o || {};
    var texto = String(o.codigo == null ? '' : o.codigo).replace(/^\s*\n/, '').replace(/\s+$/, '');
    var l = o.salida ? '' : (lenguaje(o.lang) || adivinar(texto));
    var cuerpo = o.salida ? esc(texto) : resaltar(texto, l);
    var id = o.id ? ' id="' + esc(o.id) + '"' : '';
    var barraHtml = o.salida
      ? '<div class="tm-code__bar"><span class="tm-code__lang">Salida</span><span class="tm-code__title">' + esc(o.titulo || '') + '</span></div>'
      : barra(l, o.titulo, o.id ? 'pre-' + o.id : '');
    return '<figure class="tm-code' + (o.salida ? ' tm-code--salida' : '') + '"' + (l ? ' data-lang="' + l + '"' : '') + '>' + barraHtml +
      '<pre' + (o.id && !o.salida ? ' id="pre-' + esc(o.id) + '"' : id.replace(/^ id=/, ' data-id=')) + ' tabindex="0"><code>' + cuerpo + '</code></pre></figure>';
  }

  // ---------------------------------------------------------------- navegador
  function copiarTexto(texto) {
    function viejo() {
      var ta = document.createElement('textarea');
      ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto).catch(viejo);
    return viejo();
  }

  function mejorar(contenedor) {
    if (typeof document === 'undefined') return;
    var ra = contenedor || document;
    var todo = document.documentElement.getAttribute('data-tm-codigo') === 'todo';
    var pres = ra.querySelectorAll(todo ? 'pre:not([data-tm-ok])' : '.tm-code pre:not([data-tm-ok])');
    Array.prototype.forEach.call(pres, function (pre) {
      if (pre.closest('[data-tm-no-codigo]')) return;
      var fig = pre.closest('.tm-code');
      if (!fig) {
        if (!todo || pre.closest('.tm-code, .cx, .code')) return;   // los visores propios de una herramienta se quedan como están
        fig = document.createElement('figure'); fig.className = 'tm-code';
        pre.parentNode.insertBefore(fig, pre); fig.appendChild(pre);
      }
      pre.setAttribute('data-tm-ok', '');
      var code = pre.querySelector('code') || pre;
      var l = lenguaje(fig.getAttribute('data-lang') || (code.className.match(/language-([\w-]+)/) || [])[1] || pre.getAttribute('data-lang'));
      var texto = code.textContent;
      if (!l) l = adivinar(texto);
      if (l) { fig.setAttribute('data-lang', l); if (!code.querySelector('[class^="tk-"]')) code.innerHTML = resaltar(texto.replace(/^\s*\n/, '').replace(/\s+$/, ''), l); }
      if (!fig.querySelector('.tm-code__bar') && !fig.classList.contains('tm-code--sinbarra')) {
        var tmp = document.createElement('div');
        tmp.innerHTML = barra(l, fig.getAttribute('data-titulo') || '', '');
        fig.insertBefore(tmp.firstChild, fig.firstChild);
      }
      if (!pre.hasAttribute('tabindex')) pre.setAttribute('tabindex', '0');
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-tm-copiar]');
      if (!b) return;
      var fig = b.closest('.tm-code'), id = b.getAttribute('data-tm-copiar');
      var pre = (id && document.getElementById(id)) || (fig && fig.querySelector('pre'));
      if (!pre) return;
      if (b.closest('summary')) ev.preventDefault();
      var span = b.querySelector('span'), antes = span ? span.textContent : '';
      copiarTexto(pre.textContent.replace(/\n$/, '')).then(function () {
        b.classList.add('is-ok'); if (span) span.textContent = 'Copiado';
        setTimeout(function () { b.classList.remove('is-ok'); if (span) span.textContent = antes; }, 1600);
      }, function () { if (span) span.textContent = 'No se pudo'; setTimeout(function () { if (span) span.textContent = antes; }, 1600); });
    });
    var arrancar = function () { mejorar(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
  }

  raiz.TrueMLCodigo = { resaltar: resaltar, bloque: bloque, mejorar: mejorar, lenguaje: lenguaje, adivinar: adivinar, esc: esc };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
