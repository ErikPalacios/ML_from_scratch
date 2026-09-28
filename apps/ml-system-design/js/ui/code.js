/* =============================================================================
   Ronda de Diseño ML — js/ui/code.js
   MSD.Code.render(files, {title, caption}) → HTMLElement   (SPEC §5.5)
   MSD.Code.highlight(text, lang) → [html de cada línea]   (útil para pruebas)

   Visor de código con pestañas (una por archivo), números de línea que no se
   copian, resaltado ligero por lenguaje, botón "Copiar", ajuste de líneas y
   nota opcional. Los archivos con `src` se leen de MSD.files (generado por
   tools/embed-reference.mjs). El resaltado nunca altera el texto: solo envuelve
   fragmentos en <span>; el texto escapado concatenado es idéntico al original.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  let seq = 0;
  const COLLAPSE_AT = 40;   // archivos con más líneas se muestran plegados
  const LANG_NAMES = {
    python: 'Python', dockerfile: 'Dockerfile', yaml: 'YAML', bash: 'Bash', pbtxt: 'pbtxt',
    json: 'JSON', toml: 'TOML', text: 'Texto', promql: 'PromQL', ini: 'INI',
  };
  const ALIASES = { py: 'python', docker: 'dockerfile', yml: 'yaml', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
    protobuf: 'pbtxt', prototxt: 'pbtxt', txt: 'text', plain: 'text', cfg: 'ini', conf: 'ini', env: 'ini' };

  const str = (v) => (v == null ? '' : String(v));
  function esc(s) {
    return str(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'on') { for (const ev of Object.keys(v)) e.addEventListener(ev, v[ev]); }
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (Array.isArray(kids) ? kids : kids == null ? [] : [kids]).forEach((c) => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  // ------------------------------------------------------------ gramáticas
  // Cada lenguaje: lista ordenada [clase, fuente de regex SIN grupos de captura].
  // En cada posición gana la coincidencia que empieza antes; a igual inicio, la primera regla.
  // Así un '#' dentro de un string nunca se toma como comentario (el string empieza antes).
  const DQ = '"(?:\\\\.|[^"\\\\\\n])*"?';
  const SQ = "'(?:\\\\.|[^'\\\\\\n])*'?";
  const NUM = '\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?\\b';
  const VAL = '(?<=(?:^|[:\\[,{]|^[ \\t]*-)[ \\t]*)';          // inicio de un valor YAML
  const VAL_END = '(?=[ \\t]*(?:$|#|[,\\]}]))';

  const GRAMMARS = {
    python: {
      flags: 'gm',
      rules: [
        ['com', '#[^\\n]*'],
        ['str', "(?<![\\w])(?:[rRbBuUfF]{1,2})?(?:\"\"\"[\\s\\S]*?(?:\"\"\"|(?![\\s\\S]))|'''[\\s\\S]*?(?:'''|(?![\\s\\S]))|" + DQ + '|' + SQ + ')'],
        ['dec', '(?<=^[ \\t]*)@[A-Za-z_][\\w.]*'],
        ['fn', '(?<=\\b(?:def|class)[ \\t]+)[A-Za-z_]\\w*'],
        ['kw', '\\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\\b'],
        ['num', NUM],
      ],
    },
    dockerfile: {
      flags: 'gmi',
      rules: [
        // Docker solo trata como comentario la línea que EMPIEZA con '#'. En RUN (forma shell)
        // el shell sí ignora un '# …' final, así que ahí también se resalta.
        ['com', '(?<=^[ \\t]*)#[^\\n]*'],
        ['com', '(?=#)(?<=^[ \\t]*RUN\\b(?:[^\\n]*\\\\\\n)*[^\\n]*[ \\t])#[^\\n]*'],
        ['kw', '(?<=^[ \\t]*)(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\\b'],
        ['kw', '(?=AS\\b)(?<=^[ \\t]*FROM\\b[^\\n]*[ \\t])AS\\b'],
        ['str', DQ + '|' + SQ],
        ['var', '\\$\\{[^}\\n]*\\}|\\$[A-Za-z_]\\w*'],
        ['num', '\\b\\d+(?:\\.\\d+)*\\b'],
      ],
    },
    yaml: {
      flags: 'gm',
      rules: [
        ['com', '(?<=^|[ \\t])#[^\\n]*'],
        ['dec', '^(?:---|\\.\\.\\.)(?=[ \\t]*$)'],
        ['key', '(?<=^[ \\t]*(?:-[ \\t]+)?)(?:"[^"\\n]*"|\'[^\'\\n]*\'|[^\\s:#\'"\\-\\[\\]{},][^\\n:#]*?|-[^\\s:#][^\\n:#]*?)(?=[ \\t]*:(?:[ \\t]|$))'],
        ['str', VAL + '(?:' + DQ + '|\'(?:[^\'\\n]|\'\')*\'?)'],
        ['lit', VAL + '(?:true|false|null|True|False|Null|TRUE|FALSE|NULL|yes|no|~)' + VAL_END],
        ['num', VAL + '[-+]?(?:\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?|\\.inf|\\.nan)' + VAL_END],
        ['dec', '[&*][A-Za-z_][\\w-]*|!![A-Za-z]+|(?<=:[ \\t]*)[|>][-+]?(?=[ \\t]*$)'],
      ],
    },
    bash: {
      flags: 'gm',
      rules: [
        ['com', '(?<=^|[ \\t])#[^\\n]*'],
        ['str', DQ + "|'[^'\\n]*'?"],
        ['var', '\\$\\{[^}\\n]*\\}|\\$[A-Za-z_]\\w*|\\$[@#?*!$0-9]'],
        ['kw', '\\b(?:if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|export|local|readonly|set|unset|exit|source)\\b'],
        ['fn', '(?<=^[ \\t]*(?:\\$[ \\t]+)?|(?:&&|\\|\\||[|;(])[ \\t]*)(?<!\\\\\\n[ \\t]*)(?![A-Za-z_]\\w*=)[A-Za-z_.\\/][\\w.\\/-]*'],
        ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
      ],
    },
    pbtxt: {
      flags: 'gm',
      rules: [
        ['com', '#[^\\n]*'],
        ['str', DQ + '|' + SQ],
        ['key', '\\b[A-Za-z_]\\w*(?=[ \\t]*[:{\\[])'],
        ['lit', '\\b(?:true|false|[A-Z][A-Z0-9]*_[A-Z0-9_]+)\\b'],
        ['num', '[-+]?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
      ],
    },
    json: {
      flags: 'gm',
      rules: [
        ['key', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'],
        ['str', DQ],
        ['lit', '\\b(?:true|false|null)\\b'],
        ['num', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
      ],
    },
    toml: {
      flags: 'gm',
      rules: [
        ['com', '#[^\\n]*'],
        ['sec', '(?<=^[ \\t]*)\\[\\[?[^\\]\\n]*\\]\\]?'],
        ['key', '(?<=^[ \\t]*)(?:[A-Za-z0-9_-]+|"[^"\\n]*")(?:\\.(?:[A-Za-z0-9_-]+|"[^"\\n]*"))*(?=[ \\t]*=)'],
        ['str', '"""[\\s\\S]*?(?:"""|(?![\\s\\S]))|\'\'\'[\\s\\S]*?(?:\'\'\'|(?![\\s\\S]))|' + DQ + "|'[^'\\n]*'?"],
        ['lit', '\\b(?:true|false)\\b'],
        ['num', '\\b\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?)?\\b|[-+]?\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
      ],
    },
    ini: {
      flags: 'gm',
      rules: [
        ['com', '(?<=^[ \\t]*)[;#][^\\n]*'],
        ['sec', '(?<=^[ \\t]*)\\[[^\\]\\n]*\\]'],
        ['key', '(?<=^[ \\t]*)[^\\s=;#\\[][^=\\n]*?(?=[ \\t]*=)'],
        ['str', DQ],
        ['lit', '\\b(?:true|false|yes|no|on|off)\\b'],
        ['num', '\\b\\d+(?:\\.\\d+)?\\b'],
      ],
    },
    promql: {
      flags: 'gm',
      rules: [
        ['com', '#[^\\n]*'],
        ['str', DQ + '|' + SQ + '|`[^`]*`?'],
        ['fn', '\\b(?:rate|irate|increase|delta|idelta|deriv|sum|avg|min|max|count|stddev|stdvar|topk|bottomk|quantile|count_values|group|histogram_quantile|abs|ceil|floor|round|clamp|clamp_min|clamp_max|label_replace|label_join|absent|absent_over_time|changes|resets|predict_linear|time|vector|scalar|sort|sort_desc|avg_over_time|min_over_time|max_over_time|sum_over_time|count_over_time|quantile_over_time|last_over_time|stddev_over_time)\\b(?=\\s*\\(|\\s+(?:by|without)\\b)'],
        ['kw', '\\b(?:by|without|on|ignoring|group_left|group_right|offset|bool|and|or|unless)\\b'],
        ['key', '\\b[A-Za-z_]\\w*(?=\\s*(?:=~|!~|!=|=)\\s*["\'`])'],
        ['num', '\\b\\d+(?:ms|[smhdwy])\\b|\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b'],
      ],
    },
  };

  const compiled = {};
  function grammar(lang) {
    if (compiled[lang] !== undefined) return compiled[lang];
    const g = GRAMMARS[lang];
    if (!g) { compiled[lang] = null; return null; }
    try {
      compiled[lang] = { re: new RegExp(g.rules.map((r) => '(' + r[1] + ')').join('|'), g.flags), classes: g.rules.map((r) => r[0]) };
    } catch (e) {
      // Motor sin lookbehind u otra falla: sin resaltado, pero el texto se muestra igual.
      compiled[lang] = null;
    }
    return compiled[lang];
  }

  function normLang(lang) {
    const l = str(lang).toLowerCase().trim();
    if (LANG_NAMES[l]) return l;
    return ALIASES[l] || 'text';
  }

  // Tokeniza el texto completo (los strings multilínea funcionan) y lo reparte en líneas.
  function highlight(text, lang) {
    const src = str(text);
    const g = grammar(normLang(lang));
    const lines = [''];
    const push = (cls, chunk) => {
      const parts = chunk.split('\n');
      parts.forEach((p, i) => {
        if (i > 0) lines.push('');
        if (p) lines[lines.length - 1] += cls ? '<span class="tk-' + cls + '">' + esc(p) + '</span>' : esc(p);
      });
    };
    if (!g) { push(null, src); return lines; }
    const re = g.re;
    re.lastIndex = 0;
    let last = 0, m, guard = 0;
    while ((m = re.exec(src)) && guard++ < 200000) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (m.index > last) push(null, src.slice(last, m.index));
      let cls = null;
      for (let i = 1; i < m.length; i++) { if (m[i] !== undefined) { cls = g.classes[i - 1]; break; } }
      push(cls, m[0]);
      last = m.index + m[0].length;
    }
    if (last < src.length) push(null, src.slice(last));
    return lines;
  }

  // ---------------------------------------------------------------- copiar
  function selectContents(el) {
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      const sel = root.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* nada */ }
  }

  // Copia con textarea oculto (funciona en iframes sin permiso de portapapeles).
  function execCopy(text) {
    let ta = null;
    try {
      ta = h('textarea', { class: 'cx__offscreen', readonly: true, 'aria-hidden': 'true', tabindex: '-1' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      return !!ok;
    } catch (e) {
      return false;
    } finally {
      if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
  }

  function copyText(text, fallbackEl) {
    // Con MSD.dom.copyText se pasa null como respaldo: así usa un textarea con el texto exacto
    // (no la selección renderizada). Si igual falla, se selecciona el código para Ctrl/⌘+C.
    const after = (ok) => { if (!ok) selectContents(fallbackEl); return !!ok; };
    try {
      if (MSD.dom && typeof MSD.dom.copyText === 'function') {
        return Promise.resolve(MSD.dom.copyText(text, null)).then(after, () => after(false));
      }
    } catch (e) { /* sigue con el camino propio */ }
    const fallback = () => {
      if (execCopy(text)) return true;
      selectContents(fallbackEl);
      return false;
    };
    try {
      if (root.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(() => true, fallback);
      }
    } catch (e) { /* abajo */ }
    return Promise.resolve(fallback());
  }

  // ---------------------------------------------------------------- render
  function render(files, opts) {
    opts = opts || {};
    try {
      return build(files, opts);
    } catch (err) {
      try { if (root.console) console.warn('[MSD.Code] no se pudo mostrar el código', err); } catch (e) { /* nada */ }
      try {
        return h('div', { class: 'cx cx--error' }, h('p', { class: 'cx__warn', role: 'note', text: 'No se pudo mostrar este bloque de código' + (err && err.message ? ': ' + err.message : '.') }));
      } catch (e) { return document.createElement('div'); }
    }
  }

  function resolveFile(f, i) {
    const name = str(f && f.name) || (f && f.src ? str(f.src).split('/').pop() : 'archivo-' + (i + 1));
    const lang = normLang(f && f.lang);
    let text = null, missing = null;
    if (f && typeof f.code === 'string') text = f.code;
    else if (f && f.src) {
      const lib = MSD.files || {};
      if (typeof lib[f.src] === 'string') text = lib[f.src];
      else missing = str(f.src);
    } else missing = '';
    return { name, lang, src: f && f.src ? str(f.src) : '', note: str(f && f.note), text, missing };
  }

  function build(files, opts) {
    const uid = 'cx' + (++seq);
    const list = (Array.isArray(files) ? files : files ? [files] : []).filter((f) => f && typeof f === 'object').map(resolveFile);
    const title = str(opts.title);
    const fig = h('figure', { class: 'cx' + (list.length > 1 ? ' cx--tabs' : '') });

    if (title || opts.caption) {
      fig.appendChild(h('figcaption', { class: 'cx__head' }, [
        h('span', { class: 'cx__eyebrow', text: list.length > 1 ? 'Archivos · ' + list.length : 'Código' }),
        title ? h('span', { class: 'cx__title', text: title }) : null,
        opts.caption ? h('span', { class: 'cx__caption', html: str(opts.caption) }) : null,
      ]));
    }
    if (!list.length) {
      fig.appendChild(h('p', { class: 'cx__warn', role: 'note', text: 'Este bloque de código no tiene archivos.' }));
      return fig;
    }

    const box = h('div', { class: 'cx__box' });
    fig.appendChild(box);
    const state = { wrap: false, active: 0 };
    const wrapBtns = [];
    const tabs = [], panels = [];

    // Barra de pestañas (o encabezado con el nombre si hay un solo archivo)
    let tablist = null;
    if (list.length > 1) {
      tablist = h('div', { class: 'cx__tabs', role: 'tablist', 'aria-label': title ? 'Archivos: ' + title : 'Archivos' });
      box.appendChild(h('div', { class: 'cx__tabbar' }, tablist));
    }

    list.forEach((f, i) => {
      const tabId = uid + '-tab-' + i, panelId = uid + '-panel-' + i;
      if (tablist) {
        const tab = h('button', {
          type: 'button', class: 'cx__tab', role: 'tab', id: tabId, 'aria-controls': panelId,
          'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1', title: f.src ? 'reference/' + f.src : f.name,
          on: { click: () => activate(i, false) },
        }, [h('span', { class: 'cx__tab-name', text: f.name }), f.missing != null ? h('span', { class: 'cx__tab-warn', 'aria-label': ' (falta)', text: '!' }) : null]);
        tabs.push(tab);
        tablist.appendChild(tab);
      }
      const panel = buildPanel(f, i, panelId, tablist ? tabId : null);
      panel.hidden = i !== 0;
      panels.push(panel);
      box.appendChild(panel);
    });

    if (tablist) {
      tablist.addEventListener('keydown', (ev) => {
        const n = tabs.length;
        let j = null;
        if (ev.key === 'ArrowRight') j = (state.active + 1) % n;
        else if (ev.key === 'ArrowLeft') j = (state.active - 1 + n) % n;
        else if (ev.key === 'Home') j = 0;
        else if (ev.key === 'End') j = n - 1;
        if (j == null) return;
        ev.preventDefault();
        activate(j, true);
      });
    }

    function activate(i, focus) {
      state.active = i;
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); t.tabIndex = k === i ? 0 : -1; });
      panels.forEach((p, k) => { p.hidden = k !== i; });
      if (focus && tabs[i]) {
        try { tabs[i].focus(); } catch (e) { /* nada */ }
      }
      if (tabs[i] && tabs[i].scrollIntoView && tablist.scrollWidth > tablist.clientWidth) {
        try { tabs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* nada */ }
      }
    }

    function setWrap(on) {
      state.wrap = on;
      fig.classList.toggle('is-wrap', on);
      wrapBtns.forEach((b) => b.setAttribute('aria-pressed', on ? 'true' : 'false'));
    }

    function buildPanel(f, i, panelId, tabId) {
      const panel = h('div', { class: 'cx__panel', id: panelId, role: tabId ? 'tabpanel' : 'group', 'aria-labelledby': tabId, 'aria-label': tabId ? null : f.name });
      const meta = h('div', { class: 'cx__meta' });
      const info = h('div', { class: 'cx__info' });
      if (!tabId) info.appendChild(h('span', { class: 'cx__fname', text: f.name }));
      info.appendChild(h('span', { class: 'cx__lang', text: LANG_NAMES[f.lang] || f.lang }));
      meta.appendChild(info);

      if (f.missing != null) {
        panel.appendChild(meta);
        panel.appendChild(h('div', { class: 'cx__warn', role: 'note' }, f.missing
          ? ['No se encontró el archivo de referencia ', h('code', { text: f.missing }), '. Regenera los archivos incrustados con ', h('code', { text: 'node tools/embed-reference.mjs' }), '.']
          : ['Este archivo no tiene contenido (falta ', h('code', { text: 'src' }), ' o ', h('code', { text: 'code' }), ').']));
        if (f.note) panel.appendChild(h('div', { class: 'cx__note', html: f.note }));
        return panel;
      }

      const text = f.text.replace(/\r\n?/g, '\n');
      const body = text.endsWith('\n') ? text.slice(0, -1) : text;
      const lines = highlight(body, f.lang);
      const n = lines.length;
      info.appendChild(h('span', { class: 'cx__count', text: n + (n === 1 ? ' línea' : ' líneas') }));
      if (f.src) info.appendChild(h('span', { class: 'cx__path', title: 'Ruta en el repositorio', text: 'reference/' + f.src }));

      const digits = String(n).length;
      const code = h('code', { class: 'cx__code', 'data-lang': f.lang });
      code.style.setProperty('--cx-digits', String(Math.max(2, digits)));
      code.innerHTML = lines.map((ln, k) => '<span class="cx__l"><span class="cx__n" data-n="' + (k + 1) + '" aria-hidden="true"></span><span class="cx__t">' + (ln || '<br>') + '</span></span>').join('');
      // <br> en líneas vacías: sin él, copiar una selección manual pierde las líneas en blanco.
      const pre = h('pre', { class: 'cx__pre' }, code);
      const scroll = h('div', { class: 'cx__scroll', tabindex: '0', role: 'region', 'aria-label': 'Código de ' + f.name }, pre);

      const status = h('span', { class: 'cx__status', role: 'status', 'aria-live': 'polite' });
      const copyLabel = h('span', { text: 'Copiar' });
      const copyBtn = h('button', { type: 'button', class: 'cx__btn cx__btn--copy', 'aria-label': 'Copiar ' + f.name }, [iconCopy(), copyLabel]);
      let timer = null;
      copyBtn.addEventListener('click', () => {
        copyText(f.text, code).then((ok) => {
          clearTimeout(timer);
          copyBtn.classList.toggle('is-done', ok);
          status.classList.toggle('is-ok', ok);
          copyLabel.textContent = ok ? 'Copiado' : 'Copiar';
          status.textContent = ok ? 'Copiado al portapapeles.' : 'No se pudo copiar: el código quedó seleccionado; usa Ctrl+C o ⌘C.';
          timer = setTimeout(() => { copyBtn.classList.remove('is-done'); copyLabel.textContent = 'Copiar'; status.textContent = ''; }, ok ? 1800 : 6000);
        });
      });
      const wrapBtn = h('button', { type: 'button', class: 'cx__btn cx__btn--wrap', 'aria-pressed': state.wrap ? 'true' : 'false', title: 'Ajustar las líneas largas al ancho', on: { click: () => setWrap(!state.wrap) } }, [iconWrap(), h('span', { text: 'Ajustar' })]);
      wrapBtns.push(wrapBtn);
      meta.appendChild(h('div', { class: 'cx__actions' }, [status, wrapBtn, copyBtn]));
      panel.appendChild(meta);

      const frame = h('div', { class: 'cx__frame' }, scroll);
      panel.appendChild(frame);

      if (n > COLLAPSE_AT) {
        panel.classList.add('is-collapsible', 'is-collapsed');
        const more = h('button', { type: 'button', class: 'cx__more', 'aria-expanded': 'false', 'aria-controls': panelId });
        const setLabel = () => { more.textContent = panel.classList.contains('is-collapsed') ? 'Mostrar las ' + n + ' líneas' : 'Mostrar menos'; };
        setLabel();
        more.addEventListener('click', () => {
          const collapsed = !panel.classList.contains('is-collapsed');
          panel.classList.toggle('is-collapsed', collapsed);
          more.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          setLabel();
          if (collapsed) {
            try {
              const r = panel.getBoundingClientRect();
              if (r.top < 0) panel.scrollIntoView({ block: 'start' });
            } catch (e) { /* nada */ }
          }
        });
        frame.appendChild(h('div', { class: 'cx__fade' }, more));
      }
      if (f.note) panel.appendChild(h('div', { class: 'cx__note', html: f.note }));
      return panel;
    }

    return fig;
  }

  function svgIcon(d) {
    const span = document.createElement('span');
    span.className = 'cx__icon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return span;
  }
  const iconCopy = () => svgIcon('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>');
  const iconWrap = () => svgIcon('<path d="M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H9"/><path d="M10.5 10.5 9 12l1.5 1.5"/><path d="M2.5 12h4"/>');

  MSD.Code = { render, highlight, LANG_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
