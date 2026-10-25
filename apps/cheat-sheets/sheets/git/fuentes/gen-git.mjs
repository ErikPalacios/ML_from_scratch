// Genera el "Cheat sheet de Git y GitHub Actions", tercera hermana de las hojas de Docker y de Kubernetes
// (sheets/kubernetes/fuentes/gen-k8s.mjs, de donde sale este archivo): mismos tokens claro/oscuro, fuentes, hero, nav de
// chips, .pad con papel cuadriculado, tabla de piezas, ejemplo con botón de copiar, "Cómo recordarla" / "Trampa",
// laboratorios plegados, chips del curso, CSS de impresión, diagnosticador, revisor (aquí, de workflows) y quiz.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal:
//   - los grafos de commits (merge, rebase, squash, reset, revert, amend, el rescate con el reflog) son SVG de 320 de
//     ancho, uno por panel: antes y después lado a lado desde 700 px, uno debajo del otro en el celular. Las filas de
//     los dos paneles miden lo mismo, así un commit queda a la misma altura antes y después. Arriba, lo más nuevo;
//   - las demás (las zonas, la cadena, el PR, el workflow, OIDC, los pipelines, los runners y las tablas) son HTML que
//     se acomoda solo; las zonas pasan de columnas a filas en el celular.
// Un color significa lo mismo en todas: azul = tú y tu máquina (ramas locales, HEAD), violeta = GitHub y el remoto
// (origin/…), tinta = lo automático (GitHub Actions), verde = nuevo, avanza o seguro, ámbar = espera o cambia,
// rojo = se pierde, reescribe o falla, gris punteado = solo en el reflog.
//
// Uso:
//   node gen-git.mjs src <dir>   → <dir>/head.html, wrap.html, script.js, revisor.js y src.html (con KaTeX de cdnjs)
//   node gen-git.mjs build       → lo anterior en ./out, pasa [data-tex] a MathML estático con tools/browser-check.mjs
//                                  (de la app ml-system-design) y escribe out/artifact.html (para el Artifact de
//                                  claude.ai) y ../cheatsheet-git.html (la página del sitio y la fuente del PDF)
//   node gen-git.mjs pdf         → build y además ../cheatsheet-git.pdf (Chrome headless, A4)
// El contenido está en content-w1/2/3.json de esta carpeta (GIT_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, grafos que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // módulos del curso y browser-check.mjs
const CONTENT = process.env.GIT_CONTENT ? resolve(process.env.GIT_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const YAML_URL = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js'; // la misma URL que el revisor de Kubernetes: el service worker la guarda una vez
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AVISOS = [];
const aviso = (m) => { if (!AVISOS.includes(m)) AVISOS.push(m); };

// ---------------------------------------------------------------- utilidades (las de gen-k8s.mjs)
const T = String.raw;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en memo, trap y en las notas: solo <b> y <code> (y entidades ya escritas, como &lt;); todo lo demás se escapa.
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>').replace(/&amp;(lt|gt|amp|quot|#39);/g, '&$1;');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const r1 = (x) => Math.round(x * 10) / 10;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// {placeholder} → variable con aspecto de variable matemática. No toca ${VAR} ni ${{ expresiones }} (bash y Actions),
// ni { mapas: yaml }; en HEAD@{n} deja las llaves, que son sintaxis de git.
const PH = /(\$|@)?\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*)\}/g;
const phs = (escaped) => escaped.replace(PH, (m, pre, name) => (pre === '$' ? m : pre === '@' ? `@{<var class="ph">${name}</var>}` : `<var class="ph">${name}</var>`));
// Las flags (-n, --force-with-lease) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
// Un número no se separa de su unidad al final de un renglón ("360 min", "10 GB", "90 días").
const nbu = (h) => h.replace(/(\d) (s|ms|min|h|días|GB|MB|MiB|GiB|KB|%|vCPU|GPU)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
const tx = (s) => nbu(nbFlags(esc(s)));
const rx = (s) => nbu(nbFlags(rich(s)));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(nbFlags(esc(s)));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Símbolo de una fórmula (t_reflog, cambio_tuyo, A..B…) → TeX para la tabla de variables.
function symTex(s) {
  const one = (p) => {
    p = p.trim();
    const m = p.match(/^([A-Za-zÀ-ÖØ-öø-ÿ]+)_(.+)$/);
    if (!m) return p.length === 1 ? p : T`\text{${p}}`;
    const base = m[1].length === 1 ? m[1] : T`\text{${m[1]}}`;
    let sub = m[2];
    const fn = sub.match(/^(\w+)\((.+)\)$/);
    if (fn) return `${base}_{\\text{${fn[1]}}}(\\text{${fn[2]}})`;
    sub = sub.length === 1 ? sub : T`\text{${sub}}`;
    return `${base}_{${sub}}`;
  };
  return s.split(/,\s*/).map(one).join(T`,\ `);
}

// Ancho aproximado de un texto en px, medido en Chrome con Archivo (las proporciones por tipo de letra) y JetBrains
// Mono (0.6 em por letra). Con un 2 % de margen: así un renglón del SVG nunca se sale de su caja.
function textW(s, px, { bold = false, mono = false } = {}) {
  if (mono) return [...String(s)].length * 0.6 * px;
  const k = bold ? { lo: 0.55, up: 0.71, dg: 0.585, sp: 0.26, pn: 0.29, br: 0.33, ot: 0.4, wd: 0.88 } : { lo: 0.5, up: 0.69, dg: 0.555, sp: 0.26, pn: 0.28, br: 0.31, ot: 0.38, wd: 0.85 };
  let w = 0;
  for (const ch of String(s)) {
    if (/[a-zà-ÿ]/.test(ch)) w += /[mw]/.test(ch) ? k.lo * 1.55 : /[iljtfr]/.test(ch) ? k.lo * 0.62 : k.lo;
    else if (/[A-ZÀ-Þ]/.test(ch)) w += /[MW]/.test(ch) ? k.up * 1.3 : /[IJ]/.test(ch) ? k.up * 0.45 : k.up;
    else if (/[0-9]/.test(ch)) w += k.dg;
    else if (ch === ' ') w += k.sp;
    else if (/[.,:;'!|]/.test(ch)) w += k.pn;
    else if (/[()[\]{}]/.test(ch)) w += k.br;
    else if (/[\u2190-\u21ff\u2700-\u27bf]/.test(ch)) w += k.wd;
    else w += k.ot;
  }
  return w * px * 1.02;
}
// Corta un texto en renglones que no pasan de maxPx.
function wrapW(s, maxPx, px, opt = {}) {
  const words = String(s).split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  const fits = (t) => textW(t, px, opt) <= (out.length || !opt.first ? maxPx : opt.first);
  for (let w of words) {
    while (!fits(w)) { // una palabra que no cabe sola: se corta donde quepa
      let i = w.length - 1;
      while (i > 1 && !fits(w.slice(0, i))) i--;
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, i)); w = w.slice(i);
    }
    if (!cur) cur = w; else if (fits(cur + ' ' + w)) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

// ---------------------------------------------------------------- comandos: separar lo copiable de la nota
const CMD_WORDS = new Set(['git', 'gh', 'ssh', 'ssh-keygen', 'kubectl', 'docker', 'aws', 'argocd', 'helm', 'curl', 'echo', 'cat', 'grep', 'sed', 'test', 'python', 'python3', 'pip', 'pytest', 'systemctl', 'sudo', 'journalctl', 'uname', 'free', 'df', 'cd', 'ls', 'export', 'jq', 'tail', 'head']);
const isCmdWord = (w) => CMD_WORDS.has(w) || /^python3(\.\d+)?$/.test(w) || /^\.\/[\w.-]+/.test(w);
const CUTS = [' (', ' en ', ' y ', ' contra ', ': ', ' → ', ' mientras '];
function splitCmd(seg) {
  const first = seg.trim().split(/\s+/)[0];
  if (!isCmdWord(first)) return null;
  let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    for (const cut of CUTS) if (seg.startsWith(cut, i)) return { cmd: seg.slice(0, i).trim(), note: seg.slice(i) };
  }
  return { cmd: seg.trim(), note: '' };
}
const copyBtn = (text) => `<button class="cp" type="button"${text === undefined ? '' : ` data-copy="${esc(text)}"`}>Copiar</button>`;
const cmdChip = (c) => `<span class="cmdw"><code class="cmd">${esc(c)}</code>${copyBtn(c)}</span>`;
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando (o con "dónde: comando") se
// muestra como código copiable.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    let pre = '', body = seg;
    if (!splitCmd(seg)) { const m = seg.match(/^([^:()]{1,40}):\s+(.+)$/); if (m && splitCmd(m[2])) { pre = m[1] + ': '; body = m[2]; } }
    const c = splitCmd(body);
    if (!c) return esc(seg);
    return `${pre ? `<span class="cmdn">${esc(pre)}</span>` : ''}${cmdChip(c.cmd)}${c.note ? `<span class="cmdn">${esc(c.note)}</span>` : ''}`;
  }).join('<span class="sep"> · </span>');
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'buildx', 'image', 'eks', 'ecr', 'sts', 'iam', 'imagetools', 'pr', 'run', 'workflow', 'stash', 'remote', 'cache', 'secret', 'variable', 'api', 'repo', 'bisect', 'app']);
function hlCode(seg, lang, st) {
  if (!seg) return '';
  if (lang === 'yaml') {
    if (st.atStart) {
      st.atStart = false;
      const m = seg.match(/^(\s*(?:-\s+)?)([A-Za-z_][\w./-]*)(:)(?=\s|$)/);
      if (m) return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(seg.slice(m[1].length + m[2].length));
    }
    return esc(seg);
  }
  if (lang === 'bash') {
    // palabras en posición de comando: inicio de línea, después de ; && || | $( ( { then do
    let out = '';
    const re = /(\s+|&&|\|\||[;|(){}]|\$\(|[^\s;|&(){}]+|&)/g;
    let m;
    while ((m = re.exec(seg))) {
      const t = m[0];
      if (/^\s+$/.test(t)) { out += t; continue; }
      if (/^(&&|\|\||[;|({]|\$\()$/.test(t)) { out += esc(t); st.cmdPos = true; st.sub = 0; continue; }
      if (t === ')' || t === '}') { out += esc(t); continue; }
      if (st.cmdPos) {
        if (/^[A-Za-z_][\w]*=/.test(t)) { out += esc(t); continue; } // VAR=valor: sigue en posición de comando
        if (/^[A-Za-z][\w.+-]*$/.test(t)) {
          out += `<span class="tk-k">${esc(t)}</span>`;
          st.cmdPos = /^(then|do|else|time|sudo|exec|!)$/.test(t);
          st.sub = /^(kubectl|docker|aws|helm|git|gh)$/.test(t) ? 2 : 0;
          continue;
        }
        st.cmdPos = false;
        out += esc(t); continue;
      }
      if (st.sub > 0 && /^[a-z][a-z-]*$/.test(t)) {
        out += `<span class="tk-k">${esc(t)}</span>`;
        st.sub = CLI_SUB.has(t) ? st.sub - 1 : 0;
        continue;
      }
      st.sub = 0;
      out += esc(t);
    }
    return out;
  }
  return esc(seg);
}
function hlLine(line, lang, st) {
  if (/^\s*#/.test(line)) return `<span class="tk-c">${esc(line)}</span>`;
  if (lang === 'text' && /^\$ /.test(line)) return `<span class="tk-p">$</span> ` + hlLine(line.slice(2), 'bash', { cmdPos: true, sub: 0 });
  let out = '', buf = '', i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) { if (line[j] === '\\' && c === '"') j++; j++; }
      if (j < line.length) {
        out += hlCode(buf, lang, st); buf = '';
        out += `<span class="tk-s">${esc(line.slice(i, j + 1))}</span>`;
        if (lang === 'bash') { st.cmdPos = false; st.sub = 0; }
        i = j + 1; continue;
      }
    }
    if (c === '#' && i > 0 && /\s/.test(line[i - 1])) {
      out += hlCode(buf, lang, st); buf = '';
      out += `<span class="tk-c">${esc(line.slice(i))}</span>`;
      i = line.length; break;
    }
    buf += c; i++;
  }
  return out + hlCode(buf, lang, st);
}
function hl(code, lang) {
  const out = []; let cont = false, here = null;
  for (const ln of String(code).split('\n')) {
    if (here) {
      if (ln.trim() === here.end) { out.push(`<span class="tk-k">${esc(ln)}</span>`); here = null; cont = false; continue; }
      out.push(hlLine(ln, here.lang, { atStart: true, cmdPos: true, sub: 0 }));
      continue;
    }
    const st = { atStart: !cont, cmdPos: !cont, sub: 0 };
    out.push(hlLine(ln, lang, st));
    cont = /\\\s*$/.test(ln) && !/^\s*#/.test(ln);
    if (lang === 'bash') {
      const h = ln.match(/<<-?\s*'?(\w+)'?/);
      if (h) {
        const f = (ln.match(/>\s*(\S+)/) || [])[1] || '';
        here = { end: h[1], lang: /\.ya?ml$/.test(f) ? 'yaml' : 'text' };
      }
    }
  }
  return out.join('\n');
}
const LANG = { yaml: 'YAML', bash: 'bash · zsh', text: 'texto', json: 'JSON' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- SVG
// Cada SVG lleva sus propios ids (marcadores): un SVG oculto con display:none no puede prestarle marcadores a otro.
let SVG_N = 0;
function defs() {
  const u = 'g' + (++SVG_N);
  const mk = (id, cls) => `<marker id="${u}-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="${cls}"/></marker>`;
  return { s: `<defs>${mk('arr', 'f-muted')}${mk('acc', 'f-accent')}</defs>`, m: (id) => `url(#${u}-${id})` };
}
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;

// ---------------------------------------------------------------- tablas HTML (se apilan en el celular)
function dataTable(head, rows, { cls = '', mono = [], cmd = [] } = {}) {
  const cell = (v, j) => {
    const content = cmd.includes(j) ? cmdHtml(v) : tx(v);
    const k = j > 0 && head[j] ? ` data-k="${esc(head[j])}"` : '';
    const c = [j === 0 ? 'rh' : '', mono.includes(j) ? 'mono' : '', cmd.includes(j) ? 'cmdc' : ''].filter(Boolean).join(' ');
    return j === 0 ? `<th scope="row"${c ? ` class="${c}"` : ''}>${content}</th>` : `<td${k}${c ? ` class="${c}"` : ''}>${content}</td>`;
  };
  return `<div class="tblw"><table class="dt stk ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const noteP = (s) => (s ? `<p class="fig__note">${rx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${rx(x)}</li>`).join('')}</ul>` : '');

// ================================================================ figuras
// ↳ · La cadena: once eslabones agrupados por quién actúa (tú, personas en GitHub, Actions, Kubernetes).
const ACTOR = [['tu', /^(editar|staging|commit|push)\b/i], ['ci', /^ci\b/i], ['cd', /^cd\b|^manifest/i], ['k8s', /^rollout|kubernetes/i], ['gh', /pull request|review|merge/i]];
const ZONE = { tu: 'Tú, en tu máquina', gh: 'En GitHub, entre personas', ci: 'Automático: CI con GitHub Actions', cd: 'Automático: CD con GitHub Actions', k8s: 'Kubernetes: hacia el tráfico', x: 'Otros pasos' };
function figChain(d) {
  const zones = [];
  (d.steps || []).forEach((s, i) => {
    const a = (ACTOR.find(([, re]) => re.test(s.label || '')) || ['x'])[0];
    const z = zones[zones.length - 1];
    if (z && z.a === a) z.items.push([i, s]); else zones.push({ a, items: [[i, s]] });
  });
  if (zones.some((z) => z.a === 'x')) aviso('cadena: un eslabón no tiene quién lo hace (tú, GitHub, Actions o Kubernetes); lo dibujé en gris');
  return `<div class="kchain">${zones.map((z) => `<div class="kz kz--${z.a}"><p class="kz__h">${esc(ZONE[z.a])}</p><ol class="kz__steps" start="${z.items[0][0] + 1}">${z.items.map(([i, s]) => `<li class="kst"><span class="kst__no" aria-hidden="true">${i + 1}</span><p class="kst__l">${esc(s.label)}</p>${s.cmd ? cmdChip(s.cmd) : ''}${s.note ? `<p class="kst__n">${rx(s.note)}</p>` : ''}</li>`).join('')}</ol></div>`).join('')}</div><p class="kleg"><span><i class="sw sw--tu"></i>tú</span><span><i class="sw sw--gh"></i>personas en GitHub</span><span><i class="sw sw--auto"></i>automático (Actions)</span><span><i class="sw sw--ok"></i>Kubernetes</span></p>`;
}

// 1 · Las zonas: columnas con flechas por comando (tablet y escritorio) y filas en el celular.
const shortZone = (z) => String(z.label).replace(/\s*\(.*\)\s*$/, '');
function figAreas(d) {
  const Z = d.zones || [], idx = Object.fromEntries(Z.map((z, i) => [z.id, i]));
  const isRemote = (z) => /remot|origin|github/i.test(`${z.id} ${z.label}`);
  const moves = (d.moves || []).filter((m) => {
    const ok = m.from in idx && m.to in idx && (!m.via || m.via in idx);
    if (!ok) aviso(`zonas: el movimiento "${m.cmd}" usa una zona que no existe`);
    return ok;
  });
  const net = (m) => isRemote(Z[idx[m.from]]) || isRemote(Z[idx[m.to]]);
  // "git fetch y después git log origin/main": cada comando de git en código, el resto en texto
  const seeHtml = (s) => esc(s).replace(/\bgit(?:\s+(?!(?:y|o|en|para|después|antes)\b)[^\s·,;]+)+/g, (m) => `<code>${m}</code>`);
  const zoneCard = (z) => `<div class="ar__z${isRemote(z) ? ' ar__z--rem' : ''}"><p class="ar__zl">${esc(z.label)}</p><p class="ar__zs">${tx(z.sub)}</p>${z.see ? `<p class="ar__see"><span class="k">Míralo con</span> ${seeHtml(z.see)}</p>` : ''}</div>`;
  const nLocal = Z.filter((z) => !isRemote(z)).length;
  // ---- ancho: una fila por movimiento; la flecha va del centro de una columna al de otra
  const lcz = (i) => { const s = shortZone(Z[i]); return s.charAt(0).toLowerCase() + s.slice(1); };
  const mvW = (m) => {
    const a = idx[m.from], b = idx[m.to], lo = Math.min(a, b), span = Math.abs(a - b) + 1;
    // el punto de "pasa por" va sobre la línea, que corre del centro de la primera columna al de la última
    const via = m.via ? `<span class="mv__via" style="left:${r1(((idx[m.via] - lo) / (span - 1)) * 100)}%"></span>` : '';
    return `<li class="mv ${b > a ? 'mv--r' : 'mv--l'}${net(m) ? ' mv--net' : ''}" style="grid-column:${lo + 1} / ${lo + span + 1};--span:${span}"><p class="mv__cmd"><code>${ph(m.cmd)}</code></p><span class="mv__line" aria-hidden="true">${via}</span>${m.note ? `<p class="mv__note">${tx(m.note)}${m.via ? ` <span class="mv__vt">(pasa por ${esc(lcz(idx[m.via]))})</span>` : ''}</p>` : ''}</li>`;
  };
  const wide = `<div class="ar-w" style="--nz:${Z.length}"><div class="ar__grp" aria-hidden="true">${nLocal ? `<span class="ar__g" style="grid-column:1 / ${nLocal + 1}">En tu máquina</span>` : ''}${Z.length > nLocal ? `<span class="ar__g ar__g--rem" style="grid-column:${nLocal + 1} / ${Z.length + 1}">En GitHub, por la red</span>` : ''}</div><div class="ar__zones">${Z.map(zoneCard).join('')}</div><div class="ar__mvw">${Z.map((z, i) => `<span class="ar__life" aria-hidden="true" style="left:${r1(((i + 0.5) / Z.length) * 100)}%"></span>`).join('')}<ol class="ar__mv">${moves.map(mvW).join('')}</ol></div></div>`;
  // ---- celular: zonas en filas; entre dos zonas, los comandos que cruzan ese borde (los largos, donde llegan)
  const gaps = Z.slice(0, -1).map(() => []);
  for (const m of moves) {
    const a = idx[m.from], b = idx[m.to];
    gaps[b > a ? b - 1 : b].push(m);
  }
  const mvN = (m) => {
    const a = idx[m.from], b = idx[m.to], far = Math.abs(a - b) > 1;
    return `<li class="mvn ${b > a ? 'mvn--d' : 'mvn--u'}${net(m) ? ' mv--net' : ''}"><span class="mvn__a" aria-hidden="true">${b > a ? '↓' : '↑'}</span><div><p class="mvn__c"><code>${ph(m.cmd)}</code></p>${far ? `<p class="mvn__far">llega desde: ${esc(lcz(a))}${m.via ? ` · pasa por: ${esc(lcz(idx[m.via]))}` : ''}</p>` : ''}${m.note ? `<p class="mvn__n">${tx(m.note)}</p>` : ''}</div></li>`;
  };
  const narrow = `<div class="ar-n"><p class="ar-n__hint">De arriba abajo: «hacia la derecha» es hacia abajo.</p>${Z.map((z, i) => zoneCard(z) + (i < gaps.length ? `<ul class="ar__gap">${gaps[i].map(mvN).join('')}</ul>` : '')).join('')}</div>`;
  return `<div class="ar">${wide}${narrow}</div><p class="kleg"><span><i class="sw sw--tu"></i>en tu máquina</span><span><i class="sw sw--gh"></i>cruza a la red (GitHub)</span><span><i class="sw sw--via"></i>pasa por esa zona</span></p>`;
}

// 2–4 · Grafos de commits: antes → después. Filas = commits (los padres primero; arriba lo más nuevo), carriles = líneas
// de la historia (main en el primero). Las etiquetas son las ramas; HEAD es "estás aquí".
const GP = { W: 320, X0: 18, LX: 26, R: 11.5, top: 26, padY: 7, pillH: 20, gap: 5, msgLH: 16, minRow: 36, mono: 12, msg: 13, chip: 11, tagP: 6 };
const HEAD_W = 7 + textW('HEAD', GP.mono, { mono: true }) + 7;
const isMainName = (n) => /^(main|master)$/.test(n);
function graphModel(tr, where) {
  const states = [tr.before || {}, tr.after || {}];
  const U = new Map(), order = [];
  states.forEach((st, k) => {
    const ids = new Set();
    for (const c of st.commits || []) {
      if (ids.has(c.id)) aviso(`${where}: el commit ${c.id} se repite`);
      ids.add(c.id);
      const ps = Array.isArray(c.parents) ? c.parents : [];
      if (!U.has(c.id)) { U.set(c.id, { id: c.id, msg: c.msg || '', parents: ps }); order.push(c.id); }
      else if (U.get(c.id).parents.join() !== ps.join()) aviso(`${where}: ${c.id} tiene otros padres antes y después`);
    }
    for (const b of st.branches || []) if (!ids.has(b.at)) aviso(`${where}: la rama ${b.name} apunta a ${b.at}, que no está ${k ? 'después' : 'antes'}`);
    if (st.head && !(st.branches || []).some((b) => b.name === st.head) && !ids.has(st.head)) aviso(`${where}: HEAD apunta a ${st.head}, que no es una rama ni un commit`);
  });
  const row = new Map(order.map((id, i) => [id, i]));
  for (const id of order) for (const p of U.get(id).parents) {
    if (!row.has(p)) aviso(`${where}: ${id} tiene de padre a ${p}, que no está`);
    else if (row.get(p) > row.get(id)) aviso(`${where}: ${p} aparece después de su hijo ${id} (van los padres primero)`);
  }
  // carriles: primero main, después las demás ramas (las de antes y luego las de después), al final los commits sueltos.
  // Cada tramo nuevo de una rama ocupa un carril entre la fila de su padre (sin incluirla) y la de su punta.
  const lane = new Map(), occ = [];
  const fits = (l, lo, hi) => !(occ[l] || []).some(([a, b]) => lo < b && a < hi);
  const place = (tip) => {
    const seg = []; let c = tip;
    while (c && U.has(c) && !lane.has(c)) { seg.push(c); c = U.get(c).parents[0]; }
    if (!seg.length) return;
    const parent = c && lane.has(c) ? c : null;
    const lo = parent ? row.get(parent) : -1, hi = row.get(seg[0]);
    let l = parent !== null && fits(lane.get(parent), lo, hi) ? lane.get(parent) : 0;
    while (!fits(l, lo, hi)) l++;
    (occ[l] = occ[l] || []).push([lo, hi]);
    seg.forEach((id) => lane.set(id, l));
  };
  for (const st of states) [...(st.branches || [])].sort((a, b) => (isMainName(b.name) - isMainName(a.name)) || (!!a.remote - !!b.remote)).forEach((b) => place(b.at));
  [...order].reverse().forEach(place);
  const nl = Math.max(1, ...[...lane.values()].map((l) => l + 1));
  const isAnc = (a, b) => { // ¿a es ancestro de b (o el mismo commit)?
    const seen = new Set(), stack = [b];
    while (stack.length) { const x = stack.pop(); if (x === a) return true; if (seen.has(x) || !U.has(x)) continue; seen.add(x); stack.push(...U.get(x).parents); }
    return false;
  };
  return { U, order, row, lane, nl, isAnc };
}
// Lo que se dibuja en cada fila de un panel: etiquetas (y fantasmas de dónde estaban), un aviso (nuevo o reflog) y el mensaje.
function panelRows(M, S, prev) {
  const present = new Map((S.commits || []).map((c) => [c.id, c]));
  const at = new Map(), push = (id, it) => { if (!at.has(id)) at.set(id, []); at.get(id).push(it); };
  const brs = [...(S.branches || [])].sort((a, b) => ((b.name === S.head) - (a.name === S.head)) || (!!a.remote - !!b.remote));
  if (S.head && present.has(S.head) && !brs.some((b) => b.name === S.head)) push(S.head, { kind: 'dhead' });
  for (const b of brs) {
    let badge = null;
    if (prev) {
      const p = (prev.branches || []).find((x) => x.name === b.name);
      if (!p) badge = ['nueva', 'ok'];
      else if (p.at !== b.at) badge = M.isAnc(p.at, b.at) ? ['↑ avanzó', 'ok'] : M.isAnc(b.at, p.at) ? ['↓ retrocedió', 'bad'] : ['↻ reescrita', 'bad'];
    }
    push(b.at, { kind: 'br', name: b.name, remote: !!b.remote, head: b.name === S.head, badge });
  }
  if (prev) for (const p of prev.branches || []) {
    const now = brs.find((x) => x.name === p.name);
    if ((!now || now.at !== p.at) && present.has(p.at)) push(p.at, { kind: 'ghost', name: p.name, gone: !now });
  }
  const rows = new Map();
  for (const [id, c] of present) {
    const items = [...(at.get(id) || [])];
    if (c.new) items.push({ kind: 'chip', text: 'nuevo', cls: 'new' });
    if (c.gone) items.push({ kind: 'chip', text: 'solo en el reflog', cls: 'gone' });
    rows.set(id, { c, items });
  }
  return rows;
}
const brText = (it) => (it.kind === 'ghost' ? `${it.name} (${it.gone ? 'borrada' : 'antes'})` : it.name);
function itemW(it) {
  if (it.kind === 'chip') return 14 + textW(it.text, GP.chip, { bold: true });
  if (it.kind === 'dhead') return HEAD_W + 6 + textW('detached', GP.chip, { bold: true });
  const tag = GP.tagP + 6 + textW(brText(it), GP.mono, { mono: true }) + 7;
  return (it.head ? HEAD_W + 13 : 0) + tag + (it.badge ? 6 + textW(it.badge[0], GP.chip, { bold: true }) : 0);
}
function layoutRow(r, aw) {
  // renglones de etiquetas (si una con su insignia no cabe, la insignia baja sola) y debajo el mensaje del commit, con
  // su aviso delante ("nuevo", "solo en el reflog"): el aviso es del commit, no de una etiqueta
  const items = [], chip = r.items.find((it) => it.kind === 'chip');
  for (const it of r.items) {
    if (it.kind === 'chip') continue;
    if (it.badge && itemW(it) > aw) { items.push({ ...it, badge: null }); items.push({ kind: 'badge', badge: it.badge }); }
    else items.push(it);
  }
  const lines = []; let cur = [], x = 0;
  for (const it of items) {
    const w = it.kind === 'badge' ? textW(it.badge[0], GP.chip, { bold: true }) : itemW(it);
    if (cur.length && x + 6 + w > aw) { lines.push(cur); cur = []; x = 0; }
    cur.push({ it, x: cur.length ? x + 6 : 0, w }); x = (cur.length > 1 ? x + 6 : 0) + w;
  }
  if (cur.length) lines.push(cur);
  const cw = chip ? itemW(chip) + 6 : 0;
  const msg = r.c.msg ? wrapW(r.c.msg, aw, GP.msg, { first: aw - cw }) : chip ? [''] : [];
  const h = GP.padY * 2 + lines.length * GP.pillH + Math.max(0, lines.length - 1) * GP.gap + (msg.length ? (lines.length ? GP.gap : 0) + msg.length * GP.msgLH + (chip ? 2 : 0) : 0);
  return { lines, msg, chip, cw, h: Math.max(GP.minRow, h) };
}
const tagPath = (x, yc, w) => { const h = GP.pillH, p = GP.tagP, t = yc - h / 2, b = yc + h / 2; return `M${r1(x)},${r1(yc)} L${r1(x + p)},${r1(t)} H${r1(x + w - 4)} Q${r1(x + w)},${r1(t)} ${r1(x + w)},${r1(t + 4)} V${r1(b - 4)} Q${r1(x + w)},${r1(b)} ${r1(x + w - 4)},${r1(b)} H${r1(x + p)} Z`; };
function itemSvg(it, x, yc, D) {
  if (it.kind === 'badge') return txt(x, yc + 4, it.badge[0], `gx-badge gx-badge--${it.badge[1]}`);
  if (it.kind === 'chip') { const w = itemW(it); return `<rect x="${r1(x)}" y="${r1(yc - 9)}" width="${r1(w)}" height="18" rx="9" class="gx-chip gx-chip--${it.cls}"/>` + txt(x + 7, yc + 3.8, it.text, `gx-chipt gx-chipt--${it.cls}`); }
  let s = '';
  const head = (hx) => `<rect x="${r1(hx)}" y="${r1(yc - GP.pillH / 2)}" width="${r1(HEAD_W)}" height="${GP.pillH}" rx="4" class="gx-head"/>` + txt(hx + 7, yc + 4.2, 'HEAD', 'gx-headt');
  if (it.kind === 'dhead') return head(x) + txt(x + HEAD_W + 6, yc + 4, 'detached', 'gx-badge gx-badge--bad');
  if (it.head) { s += head(x) + `<path d="M${r1(x + HEAD_W + 1)},${r1(yc)} H${r1(x + HEAD_W + 10)}" class="gx-harr" marker-end="${D.m('acc')}"/>`; x += HEAD_W + 13; }
  const label = brText(it), w = GP.tagP + 6 + textW(label, GP.mono, { mono: true }) + 7;
  const [shape, tcls] = it.kind === 'ghost' ? ['gx-ghost', 'gx-ghostt'] : it.remote ? ['gx-rtag', 'gx-rtagt'] : ['gx-tag', 'gx-tagt'];
  s += `<path d="${tagPath(x, yc, w)}" class="${shape}"/>` + txt(x + GP.tagP + 6, yc + 4.2, label, tcls);
  if (it.badge) s += txt(x + w + 6, yc + 4, it.badge[0], `gx-badge gx-badge--${it.badge[1]}`);
  return s;
}
function edgePath(xc, yc, xp, yp) { // hijo arriba (yc < yp) y padre abajo
  if (Math.abs(xc - xp) < 0.5) return `M${r1(xc)},${r1(yc)} V${r1(yp)}`;
  const d = Math.min(30, yp - yc);
  if (xc > xp) { const y1 = yp - d; return `M${r1(xc)},${r1(yc)} V${r1(y1)} C${r1(xc)},${r1(y1 + d * 0.55)} ${r1(xp)},${r1(yp - d * 0.5)} ${r1(xp)},${r1(yp)}`; }
  const y1 = yc + d; return `M${r1(xp)},${r1(yp)} V${r1(y1)} C${r1(xp)},${r1(y1 - d * 0.55)} ${r1(xc)},${r1(yc + d * 0.5)} ${r1(xc)},${r1(yc)}`;
}
function gxPanels(tr, where) {
  const M = graphModel(tr, where);
  const B = tr.before || {}, A = tr.after || {};
  const tx0 = GP.X0 + (M.nl - 1) * GP.LX + GP.R + 11, aw = GP.W - tx0 - 4;
  const rows = { before: panelRows(M, B, null), after: panelRows(M, A, B) };
  const lay = { before: new Map(), after: new Map() };
  for (const k of ['before', 'after']) for (const [id, r] of rows[k]) lay[k].set(id, layoutRow(r, aw));
  // filas compartidas: la altura de cada commit es la mayor de los dos paneles
  const rowsTopDown = [...M.order].reverse();
  const yTop = new Map(); let y = GP.top;
  const hOf = (id) => Math.max(lay.before.get(id)?.h || 0, lay.after.get(id)?.h || 0, GP.minRow);
  for (const id of rowsTopDown) { yTop.set(id, y); y += hOf(id); }
  const H = y + 6;
  const X = (id) => GP.X0 + M.lane.get(id) * GP.LX, Y = (id) => yTop.get(id) + GP.padY + 10;
  const panel = (k, title) => {
    const S = k === 'before' ? B : A, D = defs(), R = rows[k], present = new Map((S.commits || []).map((c) => [c.id, c]));
    let edges = '', nodes = '', text = '';
    for (const [id, c] of present) for (const p of M.U.get(id).parents) {
      if (!present.has(p)) continue;
      const cls = c.gone || present.get(p).gone ? 'gx-e gx-e--gone' : c.new ? 'gx-e gx-e--new' : 'gx-e';
      edges += `<path d="${edgePath(X(id), Y(id), X(p), Y(p))}" class="${cls}"/>`;
    }
    for (const [id, r] of R) {
      const c = r.c, cls = c.gone ? 'gone' : c.new ? 'new' : 'n';
      nodes += `<circle cx="${r1(X(id))}" cy="${r1(Y(id))}" r="${GP.R}" class="gx-n gx-n--${cls}"/>` + txt(X(id), Y(id) + 3.9, id, `gx-id gx-id--${cls}`, 'middle');
      const L = lay[k].get(id), top = yTop.get(id) + GP.padY;
      L.lines.forEach((ln, i) => { const yc = top + 10 + i * (GP.pillH + GP.gap); ln.forEach(({ it, x }) => { text += itemSvg(it, tx0 + x, yc, D); }); });
      const m0 = top + (L.lines.length ? L.lines.length * GP.pillH + (L.lines.length - 1) * GP.gap + GP.gap : 0) + (L.chip ? 1 : 0);
      if (L.chip) text += itemSvg(L.chip, tx0, m0 + 8, D);
      L.msg.forEach((m, i) => { if (m) text += txt(tx0 + (i ? 0 : L.cw), m0 + 12.5 + i * GP.msgLH, m, `gx-msg${c.gone ? ' gx-msg--gone' : ''}`); });
    }
    const aria = `${title}: ${[...R.keys()].join(', ')}`;
    // las filas de arriba que este panel no usa (los commits que solo existen después) se recortan; en el ancho los dos
    // paneles se alinean abajo, así cada commit sigue a la misma altura en los dos
    const firstId = rowsTopDown.find((id) => present.has(id));
    const cut = firstId ? yTop.get(firstId) - GP.top : 0;
    return `<svg class="chart gx-svg" viewBox="0 0 ${GP.W} ${r1(H - cut)}" role="img" aria-label="${esc(aria)}">${D.s}${txt(6, 15, title.toUpperCase(), 'gx-ph')}<g${cut ? ` transform="translate(0 ${r1(-cut)})"` : ''}>${edges}${nodes}${text}</g></svg>`;
  };
  return { before: panel('before', 'Antes'), after: panel('after', 'Después') };
}
const opHtml = (op) => (/^git\s/.test(op) ? `<code class="gx__cmd">${phs(nbFlags(esc(op)))}</code>` : `<span class="gx__gh">${phs(nbFlags(esc(op)))}</span>`);
function gxBlock(tr, k, where, extra = '') {
  const P = gxPanels(tr, `${where} · ${tr.label || tr.op}`);
  return `<div class="gx"><p class="gx__h"><span class="gx__k">${k}</span><span>${esc(tr.label || '')}</span></p>${tr.op ? `<p class="gx__op">${opHtml(tr.op)}</p>` : ''}<div class="gx__pp"><div class="gx__p">${P.before}</div><div class="gx__ar" aria-hidden="true"><span class="gx__aw">→</span><span class="gx__an">↓</span></div><div class="gx__p">${P.after}</div></div>${extra}${tr.note ? `<p class="fig__note gx__note">${rx(tr.note)}</p>` : ''}</div>`;
}
const GX_LEG = `<p class="kleg gx__leg"><span class="gx__legk">Arriba, lo más nuevo; cada línea une un commit con su padre.</span><span><i class="sw sw--cm"></i>commit</span><span><i class="sw sw--new"></i>commit nuevo</span><span><i class="sw sw--gone"></i>solo en el reflog</span><span><i class="sw sw--br"></i>rama local</span><span><i class="sw sw--rbr"></i>rama remota (origin/…)</span><span><i class="sw sw--head">HEAD</i>estás aquí</span><span><i class="sw sw--ghost"></i>dónde estaba antes</span></p>`;
function figGraph(d, sec) {
  const list = [d, ...(d.more || [])];
  return `<div class="gxs">${list.map((tr, i) => gxBlock(tr, i + 1, sec)).join('')}</div>${GX_LEG}`;
}

// 4 · Deshacer: qué mueve cada comando (tabla con niveles de color) y los grafos de reset, revert, amend y reflog.
const LV = ['keep', 'move', 'lose', 'ok', 'rewrite'];
const GLYPH = { keep: '=', move: '↻', lose: '✕', ok: '✓', rewrite: '!' };
const lvChip = (t, lv) => `<span class="lv lv--${lv}"><i aria-hidden="true">${GLYPH[lv]}</i><span>${tx(t)}</span></span>`;
function figUndo(d) {
  const cols = d.cols || [], L = d.legend || {}, keys = ['head', 'index', 'worktree', 'pushed'];
  const cell = (c, i, r) => {
    const [t, lv] = Array.isArray(c) ? c : [String(c ?? ''), 'keep'];
    if (!LV.includes(lv)) aviso(`deshacer: nivel desconocido "${lv}" en ${r.cmd}`);
    return `<td data-k="${esc(cols[i + 1] || keys[i])}">${lvChip(t, LV.includes(lv) ? lv : 'keep')}</td>`;
  };
  const table = `<div class="tblw"><table class="dt stk ud__t"><thead><tr>${cols.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${(d.rows || []).map((r) => `<tr><th scope="row" class="rh"><code class="ud__cmd">${phs(nbFlags(esc(r.cmd)))}</code></th>${keys.map((k, i) => cell(r[k], i, r)).join('')}</tr>`).join('')}</tbody></table></div>`;
  const leg = `<ul class="ud__leg">${LV.filter((k) => L[k]).map((k) => `<li><span class="lv lv--${k} lv--sw"><i aria-hidden="true">${GLYPH[k]}</i></span><span>${tx(L[k])}</span></li>`).join('')}</ul>`;
  const modes = (g) => {
    if (!g.modes || !g.modes.length) return '';
    const head = (g.after || {}).head, hb = ((g.after || {}).branches || []).find((b) => b.name === head);
    const rowsH = g.modes.map((m) => {
      const r = (d.rows || []).find((x) => String(x.cmd).includes(m.mode));
      if (!r) aviso(`deshacer: no hay fila de la tabla para el modo ${m.mode}; lo dibujé sin colores`);
      const lv = (k) => (r && Array.isArray(r[k]) && LV.includes(r[k][1]) ? r[k][1] : 'keep');
      const headT = r && Array.isArray(r.head) ? r.head[0] : hb ? `en ${hb.at}` : '';
      return `<tr><th scope="row" class="rh"><code>${esc(m.mode)}</code></th><td data-k="HEAD y la rama">${lvChip(headT, lv('head'))}</td><td data-k="Staging">${lvChip(m.staging, lv('index'))}</td><td data-k="Working tree">${lvChip(m.worktree, lv('worktree'))}</td></tr>`;
    }).join('');
    return `<div class="rm"><p class="rm__h">Los tres modos mueven la rama igual; cambia qué pasa con staging y con tus archivos</p><div class="tblw"><table class="dt stk rm__t"><thead><tr><th scope="col">Modo</th><th scope="col">HEAD y la rama</th><th scope="col">Staging</th><th scope="col">Working tree</th></tr></thead><tbody>${rowsH}</tbody></table></div></div>`;
  };
  const graphs = (d.graphs || []).map((g, i) => gxBlock(g, i + 1, 'deshacer', modes(g))).join('');
  return `<div class="ud">${table}${leg}${graphs ? `<p class="ud__gh">Los mismos comandos sobre el grafo</p><div class="gxs">${graphs}</div>${GX_LEG}` : ''}</div>`;
}

// 5 · La vida de un PR: los pasos por quién actúa y, antes del merge, las reglas de main que lo pueden frenar.
const WHO = (w) => (/^t[uú](?![a-záéíóúñ])/i.test(w) ? 'tu' : /actions|\bci\b|bot|argo/i.test(w) ? 'auto' : /kubernetes/i.test(w) ? 'k8s' : /persona|equipo|aprueba|review|github/i.test(w) ? 'gh' : 'x');
function figPr(d) {
  const st = d.stages || [], gates = d.gates || [];
  let iMerge = st.findIndex((s) => /^merge\b/i.test(s.label || ''));
  if (iMerge < 0 && gates.length) { aviso('pr: no encontré el paso Merge; puse las reglas al final'); iMerge = st.length; }
  const stage = (s, i) => `<div class="prs prs--${WHO(s.who)}" style="--i:${i}"><span class="prs__no" aria-hidden="true">${i + 1}</span><p class="prs__l">${esc(s.label)} <span class="prs__who">${esc(s.who)}</span></p>${s.cmd ? cmdChip(s.cmd) : ''}${s.note ? `<p class="prs__n">${tx(s.note)}</p>` : ''}</div>`;
  const gatesHtml = gates.length ? `<div class="prg" style="--n:${st.length}"><p class="prg__h">Antes del merge: las reglas de main</p><ul class="prg__l">${gates.map((g) => `<li><p class="prg__r">${esc(g.rule)}</p><p class="prg__s"><span class="prg__set">${esc(g.setting)}</span></p><p class="prg__b"><span class="k">Frena:</span> ${tx(g.blocks)}</p></li>`).join('')}</ul></div>` : '';
  const items = st.map(stage);
  items.splice(iMerge, 0, gatesHtml);
  return `<p class="prh"><span class="k">Pull request</span><span class="tagb">${esc(d.head || '')}</span><span class="prh__a" aria-hidden="true">→</span><span class="tagb">${esc(d.base || '')}</span><span class="prh__t">de tu rama (head) a la rama base</span></p><div class="prf">${items.join('')}</div><p class="kleg"><span><i class="sw sw--tu"></i>tú</span><span><i class="sw sw--auto"></i>GitHub Actions</span><span><i class="sw sw--gh"></i>otra persona, en GitHub</span><span><i class="sw sw--wait"></i>reglas que hacen esperar al merge</span></p>`;
}

// 6 · Anatomía de un workflow: los triggers encienden caminos; los jobs (cada uno una máquina) se esperan por needs.
function figWorkflow(d) {
  const jobs = d.jobs || [], ids = jobs.map((j) => j.id);
  jobs.forEach((j) => (j.needs || []).forEach((n) => { if (!ids.includes(n)) aviso(`workflow: ${j.id} tiene needs: ${n}, que no existe`); }));
  const lvl = {};
  const L = (id, seen = []) => {
    if (lvl[id] !== undefined) return lvl[id];
    if (seen.includes(id)) { aviso('workflow: needs en círculo'); return 0; }
    const j = jobs.find((x) => x.id === id), ns = (j && j.needs || []).filter((n) => ids.includes(n));
    return (lvl[id] = ns.length ? 1 + Math.max(...ns.map((n) => L(n, [...seen, id]))) : 0);
  };
  ids.forEach((id) => L(id));
  const nLv = Math.max(0, ...Object.values(lvl)) + 1;
  const chain = jobs.every((j, i) => (i === 0 ? !(j.needs || []).length : (j.needs || []).length === 1 && j.needs[0] === jobs[i - 1].id));
  const trig = (d.triggers || []).map((t) => {
    (t.runs || []).forEach((r) => { if (!ids.includes(r)) aviso(`workflow: el trigger ${t.event} corre ${r}, que no existe`); });
    const chips = jobs.map((j, i) => {
      const on = (t.runs || []).includes(j.id), wait = on && j.environment;
      const chip = `<span class="wj ${on ? (wait ? 'wj--wait' : 'wj--on') : 'wj--off'}">${esc(j.id)}<small>${on ? (wait ? 'espera aprobación' : 'corre') : 'skipped'}</small></span>`;
      return i && chain ? `<span class="wf__step"><span class="wf__arr" aria-hidden="true">→</span>${chip}</span>` : chip;
    }).join(' ');
    return `<li class="wf__tr"><p class="wf__ev"><span class="evp">${esc(t.event)}</span></p><p class="wf__runs">${chips}</p>${t.note ? `<p class="wf__trn">${tx(t.note)}</p>` : ''}</li>`;
  }).join('');
  const card = (j) => {
    const meta = [];
    if ((j.needs || []).length) meta.push(`<span class="wb wb--needs"><span class="k">needs</span> ${j.needs.map(esc).join(', ')}</span>`);
    if (j.if) meta.push(`<span class="wb wb--if"><span class="k">if</span> <code>${esc(j.if)}</code></span>`);
    if (j.environment) meta.push(`<span class="wb wb--env"><span class="k">environment</span> ${esc(j.environment)}</span>`);
    if ((j.outputs || []).length) meta.push(`<span class="wb wb--out"><span class="k">outputs</span> ${j.outputs.map(esc).join(', ')}</span>`);
    return `<article class="wjob"><p class="wjob__h"><span class="wjob__id">${esc(j.id)}</span><code class="wjob__ro">runs-on: ${esc(j.runs_on || '?')}</code></p>${meta.length ? `<p class="wjob__m">${meta.join('')}</p>` : ''}<ol class="wjob__s">${(j.steps || []).map((s) => `<li>${tx(s)}</li>`).join('')}</ol></article>`;
  };
  const levels = Array.from({ length: nLv }, (_, k) => jobs.filter((j) => lvl[j.id] === k));
  return `<div class="wf"><p class="wf__file"><span class="k">Archivo</span> <code>${esc(d.file || '')}</code></p><div class="wf__on"><p class="wf__h"><code>on:</code> qué evento corre qué jobs</p><ul class="wf__trs">${trig}</ul></div><div class="wf__jobs" style="--nl:${nLv}">${levels.map((g, k) => `<div class="wf__lv${k ? ' wf__lv--n' : ''}">${k ? '<span class="wf__cn" aria-hidden="true"><span class="wf__cnw">→</span><span class="wf__cnn">↓</span><small>needs</small></span>' : ''}${g.map(card).join('')}</div>`).join('')}</div></div><p class="kleg"><span><i class="sw sw--auto"></i>job: una máquina nueva, pasos en orden</span><span><i class="sw sw--off"></i>skipped (su if no se cumple)</span><span><i class="sw sw--wait"></i>espera la aprobación del environment</span></p>`;
}

// 8 · OIDC: el job pide un token, GitHub lo firma, STS compara aud y sub con la trust policy y entrega credenciales.
function policyConds(src) {
  let pol = null;
  try { pol = JSON.parse(src); } catch (e) { aviso('oidc: la trust policy no es JSON válido; no pude comparar el sub'); return { sub: null, aud: null, like: false }; }
  const find = (suffix) => {
    for (const op of ['StringEquals', 'StringLike']) {
      const c = ((pol.Condition || {})[op]) || {};
      for (const [k, v] of Object.entries(c)) if (k.endsWith(suffix)) return { v: [].concat(v), like: op === 'StringLike' };
    }
    return null;
  };
  return { sub: find(':sub'), aud: find(':aud') };
}
const globRe = (g) => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
const condOk = (c, val) => !!c && c.v.some((p) => (c.like ? globRe(p).test(val) : p === val));
function figOidc(d) {
  const hops = d.hops || [], tok = d.token || {}, C = policyConds(d.trust_policy || '{}');
  const actor = (w) => (/^job\b/i.test(w) ? 'auto' : /github/i.test(w) ? 'gh' : /aws|sts|iam|ecr/i.test(w) ? 'aws' : 'x');
  const subOk = condOk(C.sub, tok.sub), audOk = condOk(C.aud, tok.aud);
  if (!C.sub) aviso('oidc: la trust policy no tiene condición sobre sub');
  const tokCard = `<div class="oi__tok"><p class="oi__th">Token OIDC (un JWT) firmado por GitHub</p><dl class="oi__cl">${Object.entries(tok).map(([k, v]) => `<div class="${k === 'sub' || k === 'aud' ? 'hl' : ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`;
  const check = `<div class="oi__chk"><p class="oi__th">La trust policy del rol compara</p><ul>${[['aud', tok.aud, C.aud, audOk], ['sub', tok.sub, C.sub, subOk]].map(([k, v, c, ok]) => `<li class="${ok ? 'ok' : 'no'}"><span class="oi__m" aria-hidden="true">${ok ? '✓' : '✗'}</span><span><code>${k}</code> del token: <code>${esc(v)}</code><br><span class="k">${c && c.like ? 'la policy acepta (StringLike):' : 'la policy pide:'}</span> <code>${esc(c ? c.v.join(' · ') : '—')}</code></span></li>`).join('')}</ul><p class="oi__res ${subOk && audOk ? 'ok' : 'no'}">${subOk && audOk ? 'Coinciden: STS entrega credenciales.' : 'No coinciden: STS responde Not authorized.'}</p></div>`;
  let iCheck = hops.findIndex((h) => /trust policy|compara/i.test(`${h.does} ${h.detail}`)), iTok = hops.findIndex((h) => /firma|jwt/i.test(`${h.does} ${h.detail}`));
  if (iTok < 0) iTok = 1; if (iCheck < 0) iCheck = 2;
  const pol = d.trust_policy ? `<details class="oi__pol" open><summary>La trust policy entera (JSON)</summary><div class="code"><div class="code__bar"><span class="code__lang">JSON</span><span class="code__src">trust policy del rol</span>${copyBtn()}</div><pre><code>${String(d.trust_policy).split('\n').map((l) => { const m = l.match(/^(\s*)(.*)$/); return /:sub"|:aud"/.test(l) ? `${m[1]}<mark>${esc(m[2])}</mark>` : esc(l); }).join('\n')}</code></pre></div></details>` : '';
  const steps = hops.map((h, i) => {
    const a = actor(h.who), cred = /credencial/i.test(h.does);
    const panel = i === iTok ? tokCard : i === iCheck ? check + pol : '';
    return `<li class="oi__st oi--${cred ? 'ok' : a}${panel ? ' oi__st--p' : ''}"><div class="oi__t"><span class="oi__no" aria-hidden="true">${i + 1}</span><p class="oi__who">${esc(h.who)}</p><p class="oi__does">${esc(h.does)}</p>${h.detail ? `<p class="oi__det">${tx(h.detail)}</p>` : ''}</div>${panel ? `<div class="oi__pn">${panel}</div>` : ''}</li>`;
  }).join('');
  const subs = (d.subs || []).map((s) => { const ok = condOk(C.sub, s.sub); return [s.when, s.sub, ok ? '✓ entra' : '✗ Not authorized']; });
  const subsT = subs.length ? `<div class="oi__subs"><p class="oi__th">Qué sub manda cada job, contra esta trust policy</p><div class="tblw"><table class="dt stk oi__t"><thead><tr><th scope="col">Cuándo</th><th scope="col">sub del token</th><th scope="col">¿Entra?</th></tr></thead><tbody>${subs.map(([w, s, r]) => `<tr><th scope="row" class="rh">${tx(w)}</th><td data-k="sub del token" class="mono">${esc(s)}</td><td data-k="¿Entra?" class="${/^✓/.test(r) ? 'ok' : 'no'}">${esc(r)}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  return `<ol class="oi">${steps}</ol>${subsT}<p class="kleg"><span><i class="sw sw--auto"></i>el job (GitHub Actions)</span><span><i class="sw sw--gh"></i>GitHub</span><span><i class="sw sw--aws"></i>AWS</span><span><i class="sw sw--ok"></i>credenciales: vencen solas</span></p>`;
}

// 9–10 · Pipelines: una línea de tiempo por carril (imagenes) o el camino del deploy con su variante y su vuelta atrás (cd).
const pKind = (s) => (/^t[uú]$/i.test(String(s.who || '').trim()) ? 'tu' : /review|aprobaci|persona|equipo|quien aprueba/i.test(`${s.label} ${s.dur} ${s.who || ''}`) ? 'wait' : /runner|^ci\b|argo|actions/i.test(`${s.where || ''} ${s.who || ''}`) ? 'auto' : /kubernetes|eks/i.test(`${s.who || ''} ${s.where || ''}`) ? 'k8s' : /^github$/i.test(String(s.where || '').trim()) || /^t[uú]$/i.test(s.who || '') ? 'gh' : /ecr|s3|mlflow|aws/i.test(s.where || '') ? 'aws' : 'auto');
const durPill = (d) => (d && d !== '—' ? `<span class="dur">${tx(d)}</span>` : '');
function pipeLanes(d) {
  const lanes = d.lanes || [], steps = d.steps || [];
  steps.forEach((s) => { if (!lanes.some((l) => l.id === s.lane)) aviso(`pipeline: el paso "${s.label}" va en un carril que no existe (${s.lane})`); });
  const li = (s, i) => `<li class="pst pst--${pKind(s)}"><span class="pst__no" aria-hidden="true">${i + 1}</span><p class="pst__l">${tx(s.label)}${durPill(s.dur)}</p>${s.where ? `<p class="pst__w">${tx(s.where)}</p>` : ''}${s.note ? `<p class="pst__n">${tx(s.note)}</p>` : ''}</li>`;
  return `<div class="pl" style="--nl:${lanes.length}">${lanes.map((l) => `<section class="pl__lane"><p class="pl__lh">${tx(l.label)}</p><ol class="pl__steps">${steps.filter((s) => s.lane === l.id).map(li).join('')}</ol></section>`).join('')}</div>${PIPE_LEG}`;
}
const PIPE_LEG = `<p class="kleg"><span><i class="sw sw--tu"></i>tú</span><span><i class="sw sw--gh"></i>GitHub</span><span><i class="sw sw--auto"></i>automático (runner, Actions, Argo CD)</span><span><i class="sw sw--wait"></i>espera a una persona</span><span><i class="sw sw--aws"></i>AWS</span><span><i class="sw sw--ok"></i>Kubernetes</span><span><span class="dur">≈ min</span>duración estimada</span></p>`;
function pipeCd(d) {
  const st = d.steps || [], alt = d.alt, rb = d.rollback;
  const step = (s, i) => `<div class="pst pst--${pKind(s)}"><span class="pst__no" aria-hidden="true">${i + 1}</span><p class="pst__l">${tx(s.label)}${durPill(s.dur)}</p><p class="pst__w">${[s.who, s.where].filter(Boolean).map(tx).join(' · ')}</p>${s.detail ? `<p class="pst__n">${tx(s.detail)}</p>` : ''}</div>`;
  const items = st.map(step);
  let iAlt = alt ? st.findIndex((s) => s.id === alt.after) : -1;
  if (alt && iAlt < 0) { aviso(`cd: la variante sale después de "${alt.after}", que no es un paso`); iAlt = st.length - 1; }
  if (alt) {
    const rest = st.length - iAlt - 1;
    // en el ancho va en la segunda columna, al lado de los pasos que reemplaza (de la fila iAlt + 2 en adelante)
    const altHtml = `<div class="pc__alt" style="--r0:${iAlt + 2};--rn:${Math.max(1, rest)}"><p class="pc__ah"><span class="k">O, en vez de los pasos ${iAlt + 2}–${st.length}:</span> ${tx(alt.label)}</p><div class="pc__as">${(alt.steps || []).map((s, i) => `<div class="pst pst--${pKind(s)}"><span class="pst__no" aria-hidden="true">${String.fromCharCode(97 + i)}</span><p class="pst__l">${tx(s.label)}${durPill(s.dur)}</p>${s.who ? `<p class="pst__w">${tx(s.who)}</p>` : ''}${s.detail ? `<p class="pst__n">${tx(s.detail)}</p>` : ''}</div>`).join('')}</div></div>`;
    items.splice(iAlt + 1, 0, altHtml);
  }
  const rbHtml = rb ? `<div class="pc__rb"><p class="pc__rh"><span class="pc__ri" aria-hidden="true">↺</span>${tx(rb.label)}${durPill(rb.dur)}</p><ol class="pc__rs">${(rb.steps || []).map((s) => `<li>${tx(s)}</li>`).join('')}</ol>${rb.detail ? `<p class="pst__n">${tx(rb.detail)}</p>` : ''}</div>` : '';
  return `<div class="pc"><p class="pc__mh">Estilo GitOps (el del curso)</p><div class="pc__g">${items.join('')}</div>${rbHtml}</div>${PIPE_LEG}`;
}
const figPipeline = (d) => (d.lanes ? pipeLanes(d) : pipeCd(d));

// 11 · Runners: GitHub-hosted contra self-hosted, lado a lado.
function figRunners(d) {
  const L = d.left || {}, R = d.right || {};
  const head = (x, cls) => `<div class="rn__h rn__h--${cls}"><p class="rn__t">${esc(x.title)}</p>${x.runs_on ? `<p><code>${esc(x.runs_on)}</code></p>` : ''}${x.c01 ? `<p class="rn__c"><span class="k">En el C01:</span> ${tx(x.c01)}</p>` : ''}</div>`;
  const mark = (s) => tx(s).replace(/^(Alto|Bajo)\b/, (m) => `<b class="${m === 'Alto' ? 'bad' : 'good'}">${m}</b>`);
  const rows = (d.rows || []).map((r) => `<tr><th scope="row" class="rh">${tx(r[0])}</th><td data-k="${esc(L.title || '')}" class="rn__l">${mark(r[1])}</td><td data-k="${esc(R.title || '')}" class="rn__r">${mark(r[2])}</td></tr>`).join('');
  return `<div class="rn"><div class="rn__hs">${head(L, 'gh')}${head(R, 'self')}</div><div class="tblw"><table class="dt stk rn__tb"><thead><tr><th scope="col"></th><th scope="col">${esc(L.title || '')}</th><th scope="col">${esc(R.title || '')}</th></tr></thead><tbody>${rows}</tbody></table></div></div><p class="kleg"><span><i class="sw sw--gh"></i>la máquina es de GitHub</span><span><i class="sw sw--tu"></i>la máquina es tuya</span></p>`;
}

// ================================================================ secciones
// Títulos de los enlaces al curso: el registro real de la app (js/core/registry.js) con los módulos y casos cargados.
const COURSE = (() => {
  const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  const scripts = [...readFileSync(join(APP, 'index.html'), 'utf8').matchAll(/<script src="js\/((?:core\/registry|content\/[^"]+)\.js)"><\/script>/g)].map((m) => m[1]);
  for (const f of scripts) { try { vm.runInContext(readFileSync(join(APP, 'js', f), 'utf8'), ctx, { filename: f }); } catch (e) { aviso(`no pude cargar ${f} del curso: ${e.message}`); } }
  return ctx.MSD;
})();
const MODLAB = (m) => (m === 'ref-comandos' ? 'Docker y kubectl' : m === 'ref-herramientas' ? 'Herramientas' : /^m\d+$/.test(m) ? 'M' + parseInt(m.slice(1), 10) : m.toUpperCase());
function linkChip(anchor) {
  const [m, id] = anchor.replace(/^#/, '').split('.');
  const page = COURSE && COURSE.getPage ? COURSE.getPage(m) : null;
  const sec = page && (page.sections || []).find((x) => x.id === id);
  if (!sec) aviso(`enlace del curso que no existe: ${anchor}`);
  return `<a class="chip" href="https://ronda-diseno-ml.vercel.app/#${esc(anchor.replace(/^#/, ''))}" target="_blank" rel="noopener">${esc(MODLAB(m))} · ${esc(sec ? sec.title : id)}</a>`;
}

const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
const ORDER = ['bolsillo', 'cadena', 'modelo', 'dia-a-dia', 'ramas', 'deshacer', 'github', 'workflow', 'tests-ci', 'secretos', 'imagenes', 'cd', 'runners', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', modelo: '1 · Qué es Git', 'dia-a-dia': '2 · Día a día', ramas: '3 · Ramas', deshacer: '4 · Deshacer', github: '5 · GitHub', workflow: '6 · Workflow', 'tests-ci': '7 · Tests en CI', secretos: '8 · Secretos y OIDC', imagenes: '9 · Imágenes', cd: '10 · CD', runners: '11 · Runners', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF).
const TOPIC_SECTION = { basico: 'dia-a-dia', ramas: 'ramas', deshacer: 'deshacer', remoto: 'github', auth: 'github', sintaxis: 'workflow', tests: 'tests-ci', permisos: 'secretos', oidc: 'secretos', imagen: 'imagenes', deploy: 'cd', runner: 'runners', otro: 'diagnostico' };
const ERRS = W3.errores.map((e) => {
  const sec = TOPIC_SECTION[e.topic];
  if (!sec || !byId[sec]) throw new Error(`errores: topic sin sección: ${e.topic}`);
  if (e.section && e.section !== sec) aviso(`errores: "${e.msg.slice(0, 50)}…" trae section ${e.section}, pero su topic ${e.topic} va a ${sec} (usé ${sec})`);
  return { ...e, sec };
});

function stripLead(s, lead) { return String(s).replace(new RegExp('^' + lead + ':\\s*', 'i'), ''); }
function padHtml(x) {
  const tpls = x.templates.map((t) => `<div class="tpl"><pre class="tpl__code">${phT(t.code)}</pre>${t.note ? `<p class="tpl__note">${phs(rx(t.note))}</p>` : ''}</div>`).join('');
  const f = (x.formulas || []).map(mb).join('');
  const vars = `<table class="vars stk vt"><colgroup><col style="width:30%"><col style="width:38%"><col style="width:32%"></colgroup><thead><tr><th scope="col">Variable</th><th scope="col">Qué es</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.vars.map(([v, q, e]) => `<tr><th scope="row" class="rh">${/\{/.test(v) ? ph(v) : mi(symTex(v))}</th><td data-k="Qué es">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="pad"><div class="pad__grid${f ? '' : ' nofx'}"><div class="pad__tpl"><p class="tag">Sintaxis con variables</p><div class="tpls">${tpls}</div></div><div class="pad__vars"><p class="tag">Variables</p>${vars}</div>${f ? `<div class="pad__fx"><p class="tag">Fórmulas</p>${f}</div>` : ''}</div></div>`;
}
function piecesHtml(x) {
  return `<div class="card pieces"><h3>Las piezas</h3><table class="vars stk pz"><colgroup><col style="width:29%"><col style="width:41%"><col style="width:30%"></colgroup><thead><tr><th scope="col">Pieza</th><th scope="col">Qué hace</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.pieces.map(([p, q, e]) => `<tr><th scope="row" class="rh p">${ph(p)}</th><td data-k="Qué hace">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table></div>`;
}
const tableCls = (head) => (head.length >= 5 ? 'wide5' : head.length >= 4 ? 'wide4' : '');
function tablesHtml(x) {
  return (x.tables || []).map((t) => `<div class="card tbl"><h3>${esc(t.caption)}</h3>${dataTable(t.head, t.rows, { cls: tableCls(t.head) })}${noteP(t.note)}</div>`).join('');
}
const FIG = { chain: figChain, areas: figAreas, graph: figGraph, undo: figUndo, pr: figPr, workflow: figWorkflow, oidc: figOidc, pipeline: figPipeline, runners: figRunners };
const OWN_NOTE = new Set(['graph', 'undo']); // sus notas van dentro de cada grafo
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') {
    if (!D.head) throw new Error(`figura table sin head en ${x.id}`);
    inner = dataTable(D.head, D.rows, { cls: tableCls(D.head) }) + noteP(D.note);
  } else if (FIG[f.kind]) {
    inner = FIG[f.kind](D, x.id) + notesList(D.notes) + (f.kind === 'undo' || !OWN_NOTE.has(f.kind) ? noteP(D.note) : '');
  } else throw new Error('figura desconocida: ' + f.kind);
  return `<figure class="fig fig--${esc(f.kind)}${/<table/.test(inner) ? ' has-table' : ''}">${inner}<figcaption>${esc(f.caption)}</figcaption></figure>`;
}
function quizHtml(x) {
  const first = ERRS[0];
  return `<figure class="fig quiz" id="quiz">
    <div class="quiz__top"><p class="tag">Quiz · un mensaje a la vez</p><p class="quiz__n" id="q-count">Mensaje 1 de ${ERRS.length}</p></div>
    <pre class="term" id="q-msg">${esc(first.msg)}</pre>
    <div class="quiz__btns"><button class="btn primary" id="q-show" type="button">Ver respuesta</button><button class="btn" id="q-next" type="button">Siguiente</button></div>
    <div class="quiz__ans" id="q-ans" hidden></div>
    <figcaption>${esc(x.figure.caption)}</figcaption>
  </figure>
  <div class="card errs" id="errores-lista">
    <h3>Los ${ERRS.length} mensajes</h3>
    <label class="search"><span class="tag">Buscar</span><input type="search" id="err-q" placeholder="Texto del mensaje, causa o comando" autocomplete="off" spellcheck="false"></label>
    <p class="small" id="err-n" aria-live="polite">${ERRS.length} de ${ERRS.length}</p>
    <ol class="errlist">${ERRS.map((e) => `<li data-q="${esc(norm([e.msg, e.meaning, e.first, SECLAB(e.sec)].join(' ')))}"><p class="err__msg"><code>${esc(e.msg)}</code></p><p class="err__m">${tx(e.meaning)}</p><p class="err__f"><span class="k">Primero:</span> ${cmdHtml(e.first)}</p><p class="err__s">→ <a href="#${e.sec}">${esc(SECLAB(e.sec))}</a></p></li>`).join('')}</ol>
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>rejected</code> o <code>OIDC</code>).</p>
  </div>`;
}
function exampleHtml(x) {
  const e = x.example;
  return `<div class="example"><h3>Ejemplo real · ${esc(e.title)}</h3>${codeBlock(e.code, e.lang, null, e.source)}${e.notes && e.notes.length ? `<ul class="ex__notes">${e.notes.map((t) => `<li>${rx(t)}</li>`).join('')}</ul>` : ''}</div>`;
}
const notesHtml = (x) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p><p>${rx(stripLead(x.memo, 'Cómo recordarla'))}</p></div><div class="trap"><p class="tag">Trampa</p><p>${rx(stripLead(x.trap, 'Trampa'))}</p></div></div>`;
const linksHtml = (x) => (x.links && x.links.length ? `<p class="links"><span class="links__k">En el curso:</span> ${x.links.map(linkChip).join(' ')}</p>` : '');
// Nota de un laboratorio probado: la línea estándar ya dice "probado de verdad en una carpeta de prueba (git X)", así que
// se quita la oración que lo repite ("Ejecutado con git 2.50.1 (Apple Git-155) en macOS.") y se deja lo que agrega.
function vnoteExec(t, id) {
  t = String(t || '').trim();
  // la primera oración termina en un punto seguido de espacio o del final ("Python 3.14" no la corta)
  const m = t.match(/^(?:Ejecutado|Corrido|Probado)(\s+en\s+[^,.\s]+)?\s+con\s+git\s+\d[\d.]*(?:\s*\([^)]*\))?((?:[^.]|\.(?!\s|$))*)\.(?:\s+|$)([\s\S]*)$/i);
  if (!m) { if (t) aviso(`${id}: no reconocí el principio de la nota del laboratorio; la dejé entera`); return t; }
  const lead = (m[1] || '').replace(/^\s+en\s+/i, '').trim();
  let r = m[2].trim(), first = '';
  const trivial = /^(?:en\s+(?:macOS|una carpeta temporal)(?:\s+y\s+en\s+(?:macOS|una carpeta temporal))?)?$/i;
  if (trivial.test(r) && !lead) first = '';
  else if (/^y\s+/i.test(r)) first = `También con ${r.replace(/^y\s+/i, '')}.`;
  else if (/^en\s+/i.test(r) || !r) {
    const mm = r.match(/^en\s+([^,]+)(.*)$/i), locs = [lead, mm ? mm[1].trim() : ''].filter(Boolean);
    first = locs.length ? `En ${locs.join(' y ')}${mm ? mm[2] : ''}.` : '';
  } else first = `${cap(r)}.`;
  return [first, m[3].trim()].filter(Boolean).join(' ');
}
function labHtml(x) {
  const l = x.lab;
  if (!l) { if (x.lab_omitted) aviso(`${x.id}: sin laboratorio (${x.lab_omitted})`); return ''; }
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  let ver, note = String(l.verified_note || '');
  if (l.verified === 'executed') {
    const v = (note.match(/\bgit\s+(\d+\.\d+(?:\.\d+)?)/i) || [])[1];
    if (!v) aviso(`${x.id}: el laboratorio dice executed, pero su nota no trae la versión de git`);
    ver = `Probado de verdad en una carpeta de prueba${v ? ` (git ${v})` : ''}.`;
    note = vnoteExec(note, x.id);
  } else {
    if (l.verified !== 'docs') aviso(`${x.id}: verified raro en el laboratorio: ${l.verified}`);
    const partial = /\bse corrieron\b|\bse ejecutaron\b/i.test(note);
    if (partial) aviso(`${x.id}: el laboratorio dice verified "docs", pero su nota dice que una parte se corrió: la línea estándar queda en "Verificado contra la documentación."`);
    ver = partial ? 'Verificado contra la documentación.' : 'Verificado contra la documentación; no ejecutado aquí.';
    note = note.replace(/^(?:No ejecutado aquí|No se corrió aquí)(?:\s*\([^)]*\))?(?::[^.]*)?[.:]\s*/i, '');
  }
  const where = l.verified === 'executed' ? 'en tu Mac' : /cuenta de GitHub|lab-actions|repo nuevo/i.test(l.needs || '') ? 'con GitHub' : '';
  return `<details class="lab"><summary><span class="lab__t">Laboratorio${where ? ' ' + where : ''} (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
    <p class="lab__goal"><span class="k">Qué vas a provocar:</span> ${tx(l.goal)}</p>
    ${l.needs ? `<p class="lab__needs small"><span class="k">Necesitas:</span> ${tx(l.needs)}</p>` : ''}
    <ol class="lab__steps">${steps}</ol>
    <div class="lab__fix"><p class="tag">Cómo arreglarlo y confirmarlo</p><p>${tx(l.fix)}</p></div>
    <p class="verified">${ver}${note ? ` <span>${esc(note)}</span>` : ''}</p>
  </div></details>`;
}
function sectionHtml(id) {
  const x = byId[id];
  const num = x.num === null ? '↳' : String(x.num);
  const fig = id === 'errores' ? quizHtml(x) : figureHtml(x);
  return `
<section class="sec" id="${id}">
  <header class="sec__head"><span class="sec__n">${num}</span><div><h2>${esc(x.title)}</h2><p class="sec__q">${esc(x.question)}</p></div></header>
  ${padHtml(x)}
  ${piecesHtml(x)}
  ${fig}
  ${tablesHtml(x)}
  ${exampleHtml(x)}
  ${notesHtml(x)}
  ${linksHtml(x)}
  ${labHtml(x)}
</section>`;
}

// ================================================================ revisor de workflows
// Las 18 reglas de content-w2.json (revisor[].check), portadas de w2/rules.cjs con la misma semántica (los mismos campos,
// defaults y casos borde) y con dónde está cada hallazgo: job, paso y algo que buscar para dar la línea.
// Corre sobre el objeto que devuelve jsyaml.load. Son funciones normales: la página las lleva con toString().
function revisar(w, ids) {
  'use strict';
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function O(v) { return isObj(v) ? v : {}; }
  function A(v) { return Array.isArray(v) ? v : []; }
  function S(v) { return v === undefined || v === null ? '' : String(v); }
  function isTrue(v) { return v === true || S(v).trim().toLowerCase() === 'true'; }
  function isFalse(v) { return v === false || S(v).trim().toLowerCase() === 'false'; }
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  w = O(w);
  var EXPR = '\x24{{'; // el comienzo de una expresión de Actions
  function triggers() {
    var on = w.on !== undefined ? w.on : w['true']; // un parser YAML 1.1 convierte la clave on en true
    if (typeof on === 'string') return [on];
    if (Array.isArray(on)) return on.map(S);
    if (isObj(on)) return Object.keys(on);
    return [];
  }
  var JOBS = Object.keys(O(w.jobs)).map(function (id) { return [id, w.jobs[id]]; }).filter(function (p) { return isObj(p[1]); });
  function steps(j) {
    var out = [];
    A(j.steps).forEach(function (s, i) {
      if (!isObj(s)) return;
      out.push({ s: s, n: String(i + 1) });
      A(s.parallel).forEach(function (p, k) { if (isObj(p)) out.push({ s: p, n: (i + 1) + '.' + (k + 1) }); });
    });
    return out;
  }
  function usesOf(s) { return S(s.uses).trim(); }
  function usesAction(s, name) { return usesOf(s).toLowerCase().indexOf(name.toLowerCase() + '@') === 0; }
  function runText(s) { return s.run === undefined ? '' : S(s.run); }
  function labels(j) {
    var r = j['runs-on'];
    if (typeof r === 'string') return [r];
    if (Array.isArray(r)) return r.map(S);
    if (isObj(r)) return [].concat(r.labels === undefined ? [] : r.labels).map(S);
    return [];
  }
  function exprs(t) { var out = [], re = /\$\{\{([\s\S]*?)\}\}/g, m; t = S(t); while ((m = re.exec(t))) out.push(m[1]); return out; }
  function strings(x, acc) { acc = acc || []; if (typeof x === 'string') acc.push(x); else if (Array.isArray(x)) x.forEach(function (y) { strings(y, acc); }); else if (isObj(x)) Object.keys(x).forEach(function (k) { strings(x[k], acc); }); return acc; }
  function firstLine(t) { var l = S(t).split('\n').filter(function (x) { return x.trim(); })[0]; return l ? l.trim() : ''; }
  function lineWith(t, re) { var l = S(t).split('\n').filter(function (x) { return re.test(x); })[0]; return l ? l.trim() : firstLine(t); }
  function stepLabel(s) { return S(s.name) || (s.id !== undefined ? 'id: ' + S(s.id) : '') || usesOf(s) || firstLine(runText(s)); }
  var out = [];
  function add(id, f) { f.id = id; out.push(f); }
  function onStep(jid, st, detail, text) { return { job: jid, step: st.n, stepLabel: stepLabel(st.s), detail: detail || '', find: text ? { text: text } : null }; }
  var RULES = {
    'sin-permissions': function () {
      if (w.permissions !== undefined) return;
      var miss = JOBS.filter(function (p) { return p[1].permissions === undefined; }).map(function (p) { return p[0]; });
      if (miss.length) add('sin-permissions', { job: null, detail: 'jobs sin permissions: ' + miss.join(', '), find: { top: 'jobs' } });
    },
    'permisos-write-all': function () {
      if (S(w.permissions).trim() === 'write-all') add('permisos-write-all', { job: null, detail: 'en todo el workflow', find: { top: 'permissions' } });
      JOBS.forEach(function (p) { if (S(p[1].permissions).trim() === 'write-all') add('permisos-write-all', { job: p[0], detail: 'en el job', find: { key: 'permissions' } }); });
    },
    'accion-sin-sha': function () {
      JOBS.forEach(function (p) {
        function test(u, st) {
          if (!u || u.indexOf('./') === 0 || u.indexOf('docker://') === 0) return;
          var owner = u.split('/')[0].toLowerCase();
          if (owner === 'actions' || owner === 'github') return;
          var at = u.lastIndexOf('@'), ref = at < 0 ? '' : u.slice(at + 1).trim();
          if (!/^[0-9a-f]{40}$/i.test(ref)) add('accion-sin-sha', st ? onStep(p[0], st, u, u) : { job: p[0], detail: u, find: { key: 'uses' } });
        }
        test(S(p[1].uses).trim(), null);
        steps(p[1]).forEach(function (st) { test(usesOf(st.s), st); });
      });
    },
    'pr-target-con-codigo-del-pr': function () {
      var t = triggers();
      if (t.indexOf('pull_request_target') < 0 && t.indexOf('workflow_run') < 0) return;
      var PR = ['github.event.pull_request.head', 'github.head_ref', 'refs/pull/', 'github.event.workflow_run.head'];
      var CMD = /git\s+(fetch|checkout|pull)\b[^\n]*(refs\/pull\/|pull\/|github\.event\.pull_request\.head|github\.head_ref)/;
      JOBS.forEach(function (p) {
        steps(p[1]).forEach(function (st) {
          var s = st.s, wi = O(s.with), rt = runText(s);
          var co = usesAction(s, 'actions/checkout') && (PR.some(function (x) { return S(wi.ref).indexOf(x) >= 0 || S(wi.repository).indexOf(x) >= 0; }) || isTrue(wi['allow-unsafe-pr-checkout']));
          var cmd = /gh\s+pr\s+checkout/.test(rt) || CMD.test(rt);
          if (co || cmd) { var l = co ? usesOf(s) : lineWith(rt, /gh\s+pr\s+checkout|git\s+(fetch|checkout|pull)\b/); add('pr-target-con-codigo-del-pr', onStep(p[0], st, l, l)); }
        });
      });
    },
    'inyeccion-en-run': function () {
      var UNTRUSTED = /github\.event(?:\.[\w*-]+|\[[^\]]*\])*\.(body|default_branch|email|head_ref|head_branch|label|message|name|page_name|ref|title)\b|github\.head_ref\b/i;
      JOBS.forEach(function (p) {
        steps(p[1]).forEach(function (st) {
          var s = st.s, t = runText(s);
          if (usesAction(s, 'actions/github-script') && s.with) t += '\n' + S(O(s.with).script);
          var bad = exprs(t).filter(function (e) { return UNTRUSTED.test(e); });
          if (bad.length) add('inyeccion-en-run', onStep(p[0], st, bad.map(function (e) { return EXPR + e + '}}'; }).join(' '), EXPR + bad[0] + '}}'));
        });
      });
    },
    'llaves-aws-fijas': function () {
      var KEY = /secrets\.AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b/i, LIT = /\bAKIA[0-9A-Z]{16}\b/;
      function hit(x) { return strings(x).filter(function (v) { return KEY.test(v) || LIT.test(v); })[0]; }
      if (hit(w.env) !== undefined) add('llaves-aws-fijas', { job: null, detail: 'env del workflow', find: { top: 'env' } });
      JOBS.forEach(function (p) {
        var j = p[1], withKey = null;
        steps(j).forEach(function (st) { var wi = st.s.with; if (!withKey && isObj(wi) && (wi['aws-access-key-id'] !== undefined || wi['aws-secret-access-key'] !== undefined)) withKey = st; });
        var h = hit(j.env); if (h === undefined) h = hit(j.steps); if (h === undefined) h = hit(j.with); if (h === undefined) h = hit(j.secrets);
        if (!withKey && h === undefined) return;
        var m = h !== undefined ? (h.match(KEY) || h.match(LIT))[0] : 'aws-access-key-id';
        add('llaves-aws-fijas', withKey ? onStep(p[0], withKey, 'aws-access-key-id en with', 'aws-access-key-id') : { job: p[0], detail: m, find: { text: m } });
      });
    },
    'sin-timeout': function () {
      JOBS.forEach(function (p) { if (p[1].uses === undefined && p[1]['timeout-minutes'] === undefined) add('sin-timeout', { job: p[0], detail: '', find: null }); });
    },
    'deploy-sin-freno': function () {
      var NAME = /(^|[-_ ])(deploy|despliegue|desplegar|rollout|promote|promover)([-_ ]|$)/i;
      var CMD = /\b(kubectl\s+(apply|set\s+image|rollout\s+restart|patch)|helm\s+(upgrade|install)|argocd\s+app\s+sync|aws\s+ecs\s+update-service|aws\s+eks\s+update-kubeconfig|terraform\s+apply)\b/;
      JOBS.forEach(function (p) {
        var j = p[1];
        var isDeploy = NAME.test(p[0]) || NAME.test(S(j.name)) || steps(j).some(function (st) { return CMD.test(runText(st.s)); });
        if (!isDeploy) return;
        var miss = [], env = j.environment;
        if (env === undefined || S(isObj(env) ? env.name : env) === '') miss.push('environment');
        if (j.concurrency === undefined && w.concurrency === undefined) miss.push('concurrency');
        if (miss.length) add('deploy-sin-freno', { job: p[0], detail: 'falta ' + miss.join(' y '), find: null });
      });
    },
    'tag-latest': function () {
      JOBS.forEach(function (p) {
        steps(p[1]).forEach(function (st) {
          var s = st.s;
          if (usesAction(s, 'docker/build-push-action') && isObj(s.with) && isTrue(s.with.push)) {
            S(s.with.tags).split(/[\n,]/).map(function (t) { return t.trim(); }).filter(Boolean).forEach(function (t) {
              var last = t.slice(t.lastIndexOf('/') + 1);
              if (/:latest$/.test(t) || (last.indexOf(':') < 0 && t.indexOf(EXPR) < 0)) add('tag-latest', onStep(p[0], st, t, t));
            });
          }
          runText(s).split('\n').forEach(function (l) {
            if (/\bdocker\b/.test(l) && /(\bpush\b|--push\b)/.test(l) && /:latest\b/.test(l)) add('tag-latest', onStep(p[0], st, l.trim(), l.trim()));
          });
        });
      });
    },
    'set-output-deprecado': function () {
      JOBS.forEach(function (p) { steps(p[1]).forEach(function (st) { var m = /::(set-output|save-state)\b/.exec(runText(st.s)); if (m) add('set-output-deprecado', onStep(p[0], st, m[0], m[0])); }); });
    },
    'secreto-en-log': function () {
      function names(env) { return Object.keys(O(env)).filter(function (k) { return /secrets\./.test(S(env[k])); }); }
      var top = names(w.env);
      JOBS.forEach(function (p) {
        var jn = top.concat(names(p[1].env));
        steps(p[1]).forEach(function (st) {
          var nm = jn.concat(names(st.s.env));
          runText(st.s).split('\n').forEach(function (l) {
            var m = /\b(echo|printf)\b/.exec(l);
            if (!m || /::add-mask::|--password-stdin|--with-token|>/.test(l)) return;
            var after = l.slice(m.index);
            var direct = /\$\{\{\s*secrets\./.test(after);
            var viaEnv = nm.some(function (n) { return new RegExp('\\$(\\{)?' + reEsc(n) + '\\b').test(after); });
            if (direct || viaEnv) add('secreto-en-log', onStep(p[0], st, l.trim(), l.trim()));
          });
        });
      });
    },
    'self-hosted-en-pr': function () {
      var t = triggers();
      if (t.indexOf('pull_request') < 0 && t.indexOf('pull_request_target') < 0) return;
      var GATED = /github\.event_name\s*==\s*['"](push|workflow_dispatch|schedule|release|merge_group|repository_dispatch)['"]/;
      JOBS.forEach(function (p) {
        var j = p[1];
        if (labels(j).some(function (l) { return l.trim().toLowerCase() === 'self-hosted'; }) && !(GATED.test(S(j.if)) && S(j.if).indexOf('pull_request') < 0)) add('self-hosted-en-pr', { job: p[0], detail: 'runs-on: ' + labels(j).join(', '), find: { key: 'runs-on' } });
      });
    },
    'checkout-con-credenciales': function () {
      var t = triggers();
      if (!['pull_request', 'pull_request_target', 'workflow_run'].some(function (e) { return t.indexOf(e) >= 0; })) return;
      JOBS.forEach(function (p) {
        var st = steps(p[1]);
        if (!st.some(function (x) { return x.s.run !== undefined; })) return;
        st.forEach(function (x) { if (usesAction(x.s, 'actions/checkout') && !isFalse(O(x.s.with)['persist-credentials'])) add('checkout-con-credenciales', onStep(p[0], x, usesOf(x.s), usesOf(x.s))); });
      });
    },
    'pip-sin-cache': function () {
      JOBS.forEach(function (p) {
        var st = steps(p[1]), pip = null;
        st.forEach(function (x) { runText(x.s).split('\n').forEach(function (l) { if (pip === null && !/\buv\s+pip\b/.test(l) && /\b(pip3?|python3?\s+-m\s+pip)\s+install\b/.test(l)) pip = l.trim(); }); });
        if (pip === null) return;
        var cached = st.some(function (x) { var s = x.s, wi = O(s.with); return (usesAction(s, 'actions/setup-python') && S(wi.cache).trim() === 'pip') || (usesAction(s, 'actions/cache') && S(wi.path).indexOf('pip') >= 0) || usesAction(s, 'astral-sh/setup-uv'); });
        if (!cached) add('pip-sin-cache', { job: p[0], detail: pip, find: { text: pip } });
      });
    },
    'runner-latest': function () {
      JOBS.forEach(function (p) { var l = labels(p[1]).filter(function (x) { return /-latest$/i.test(x.trim()); })[0]; if (l) add('runner-latest', { job: p[0], detail: 'runs-on: ' + l.trim(), find: { key: 'runs-on' } }); });
    },
    'curl-a-shell': function () {
      var RE = [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(-\S+\s+)*((ba|z|da)?sh|python3?)\b/, /\b(ba)?sh\s+(-c\s+)?["']?\$\(\s*(curl|wget)\b/, /\b(ba)?sh\s+<\(\s*(curl|wget)\b/];
      JOBS.forEach(function (p) {
        steps(p[1]).forEach(function (st) {
          var rt = runText(st.s);
          if (!RE.some(function (r) { return r.test(rt); })) return;
          var l = rt.split('\n').filter(function (x) { return RE.some(function (r) { return r.test(x); }); })[0] || firstLine(rt);
          add('curl-a-shell', onStep(p[0], st, l.trim(), l.trim()));
        });
      });
    },
    'if-siempre-verdadero': function () {
      function bad(v) { return typeof v === 'string' && v.indexOf(EXPR) >= 0 && !(v.indexOf(EXPR) === 0 && v.slice(-2) === '}}' && v.indexOf(EXPR, 3) < 0); }
      JOBS.forEach(function (p) {
        if (bad(p[1].if)) add('if-siempre-verdadero', { job: p[0], detail: 'if: ' + p[1].if.trim(), find: { key: 'if' } });
        steps(p[1]).forEach(function (st) { if (bad(st.s.if)) add('if-siempre-verdadero', onStep(p[0], st, 'if: ' + st.s.if.trim(), st.s.if.trim().split('\n')[0])); });
      });
    },
    'tests-que-no-frenan': function () {
      var TEST = /\b(pytest|python3?\s+-m\s+pytest|tox|nox)\b/;
      JOBS.forEach(function (p) {
        steps(p[1]).forEach(function (st) {
          var s = st.s, rt = runText(s);
          if (!TEST.test(rt)) return;
          var sw = rt.split('\n').filter(function (l) { return TEST.test(l) && /\|\|\s*(true\b|:|exit\s+0\b)/.test(l); })[0];
          var stepCoe = isTrue(s['continue-on-error']), jobCoe = isTrue(p[1]['continue-on-error']);
          if (!sw && !stepCoe && !jobCoe) return;
          add('tests-que-no-frenan', sw ? onStep(p[0], st, sw.trim(), sw.trim()) : stepCoe ? onStep(p[0], st, 'continue-on-error: true en el paso', 'continue-on-error') : { job: p[0], step: st.n, stepLabel: stepLabel(s), detail: 'continue-on-error: true en el job', find: { key: 'continue-on-error' } });
        });
      });
    }
  };
  (ids || Object.keys(RULES)).forEach(function (id) { if (RULES[id]) RULES[id](); });
  return out;
}
// La línea de un hallazgo en el texto: una clave de arriba (find.top), una clave del job (find.key) o un texto dentro del
// job (find.text); si no la encuentra, la línea del job. Busca en el texto: js-yaml no da posiciones.
function ubicar(src, f) {
  'use strict';
  var L = String(src).replace(/\r\n?/g, '\n').split('\n'), i;
  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function ind(s) { return s.match(/^ */)[0].length; }
  function content(s) { return !!s.trim() && !/^\s*#/.test(s); }
  var find = (f && f.find) || {};
  if (find.top) { for (i = 0; i < L.length; i++) if (ind(L[i]) === 0 && new RegExp('^["\']?' + reEsc(find.top) + '["\']?\\s*:').test(L[i])) return i + 1; return null; }
  if (!f || f.job === null || f.job === undefined) return null;
  var J = -1;
  for (i = 0; i < L.length; i++) if (/^jobs\s*:\s*(#.*)?$/.test(L[i])) { J = i; break; }
  if (J < 0) return null;
  var ji = -1, jind = -1, end = L.length, jre = new RegExp('^( +)["\']?' + reEsc(f.job) + '["\']?\\s*:\\s*(#.*)?$');
  for (i = J + 1; i < L.length; i++) {
    if (content(L[i]) && ind(L[i]) === 0) { end = i; break; }
    var m = ji < 0 ? jre.exec(L[i]) : null;
    if (m) { ji = i; jind = m[1].length; continue; }
    if (ji >= 0 && content(L[i]) && ind(L[i]) <= jind) { end = i; break; }
  }
  if (ji < 0) return null;
  if (find.key) {
    var cind = -1;
    for (i = ji + 1; i < end; i++) if (content(L[i])) { cind = ind(L[i]); break; }
    var kre = new RegExp('^\\s*["\']?' + reEsc(find.key) + '["\']?\\s*:');
    for (i = ji + 1; i < end; i++) if (ind(L[i]) === cind && kre.test(L[i])) return i + 1;
    return ji + 1;
  }
  if (find.text) {
    var t = String(find.text).split('\n')[0].trim(), t2 = t.slice(0, 32);
    for (i = ji + 1; i < end; i++) if (t && L[i].indexOf(t) >= 0) return i + 1;
    for (i = ji + 1; i < end; i++) if (t2 && L[i].indexOf(t2) >= 0) return i + 1;
  }
  return ji + 1;
}
const REVISOR_SRC = `${revisar.toString()}\n${ubicar.toString()}`;
const RULE_IDS = [...revisar.toString().matchAll(/^ {4}'([a-z0-9-]+)': function/gm)].map((m) => m[1]);
{
  const ids = W2.revisor.map((r) => r.id);
  ids.filter((id) => !RULE_IDS.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} del contenido no tiene implementación; el revisor la salta`));
  RULE_IDS.filter((id) => !ids.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} está implementada pero el contenido ya no la trae`));
  W2.revisor.forEach((r) => { if (!['error', 'warn', 'info'].includes(r.severity)) aviso(`revisor: severidad rara en ${r.id}: ${r.severity}`); });
}

// El workflow del gateway con errores típicos: cada regla que dispara, la dispara una vez.
const BAD_EXAMPLE = `# EJEMPLO con problemas a propósito: es para probar el revisor, no lo copies
name: gateway
on:
  pull_request:
  push:
    branches: [main]

jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.13"
      - run: pip install -r requirements-dev.txt
      - run: pytest || true
      - run: echo "Probando el PR \${{ github.event.pull_request.title }}"

  imagen:
    needs: tests
    if: \${{ github.event_name }} == 'push'
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - id: tag
        run: echo "::set-output name=tag::\${GITHUB_SHA::7}"
      - run: |
          docker build -t "$REG/classifier-gateway:latest" reference/c01/gateway
          docker push "$REG/classifier-gateway:latest"

  deploy:
    needs: imagen
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - env:
          KUBE_TOKEN: \${{ secrets.KUBE_TOKEN }}
        run: |
          echo "Usando el token $KUBE_TOKEN"
          kubectl -n classifier set image deployment/gateway gateway="$REG/classifier-gateway:latest"
`;
const base = (p) => String(p).split('/').pop();
const SAMPLES = { bad: { text: BAD_EXAMPLE, label: 'EJEMPLO con problemas a propósito: bórralo y pega tu workflow', cls: '' } };
const REF_BTNS = [];
for (const [i, wf] of (W2.workflows_ref || []).entries()) {
  const key = `ref${i}`;
  SAMPLES[key] = { text: wf.yaml.endsWith('\n') ? wf.yaml : wf.yaml + '\n', label: `C01 · ${wf.path} (ilustrativo: el C01 no trae workflows)`, cls: 'ok' };
  REF_BTNS.push([i === 0 ? 'rv-c01' : `rv-c01-${i}`, key, `C01 · ${base(wf.path)}`]);
}
if (!REF_BTNS.length) aviso('revisor: el contenido no trae workflows_ref; no hay botones del C01');

// ================================================================ herramientas
function toolsHtml() {
  const D = W3.diagnosticador;
  D.forEach((g) => { if (g.causes.length < 2 || g.causes.length > 4) aviso(`diagnosticador: "${g.symptom}" tiene ${g.causes.length} causas (2–4 es lo esperado)`); });
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">Corre primero</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y una revisión rápida de tu workflow antes del push.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué correr primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de workflows</h3>
    <p class="small">Pega un workflow de GitHub Actions (un archivo de <code>.github/workflows/</code>). Revisa ${W2.revisor.length} reglas típicas en tu navegador: permisos, actions sin fijar, triggers peligrosos, secretos, timeouts y deploys sin freno. Cada hallazgo dice el job, el paso y la línea. No reemplaza la validación de GitHub, que corre al hacer push.</p>
    <label class="rv-label" for="rv-text" id="rv-label">${esc(SAMPLES.bad.label)}</label>
    <textarea id="rv-text" rows="16" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-bad" type="button">Ejemplo con problemas</button>${REF_BTNS.map(([id, , label]) => `<button class="btn" id="${id}" type="button">${esc(label)}</button>`).join('')}<button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
    <p class="small rv-note">Lee el YAML con js-yaml (de cdnjs): después de la primera visita queda guardado y funciona sin conexión.</p>
  </div>
</section>`;
}

// ================================================================ CSS
const CSS = `
/* El diseño de las hojas de Docker y Kubernetes: papel cuadriculado para la sintaxis, tinta azul, resaltador ámbar.
   Colores de las figuras (uno por idea): azul = tú y tu máquina, violeta = GitHub y el remoto, tinta = lo automático,
   verde = nuevo, avanza o seguro, ámbar = espera o cambia, rojo = se pierde, reescribe o falla, gris punteado = reflog. */
:root {
  --bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.11); --on-hi: #18212d;
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.13); --on-hi: #0e131a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.13); --on-hi: #0e131a; color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; overflow-wrap: break-word; background: var(--bg); color: var(--ink); font: 17px/1.6 var(--f-body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px; }
.wrap { max-width: 1120px; margin: 0 auto; }
h1, h2, h3, .tag, legend { font-family: var(--f-display); text-wrap: balance; }
a { color: var(--accent); }
.hero { padding-block: 40px 22px; display: grid; gap: 10px; }
.hero .kicker { font: 600 12.5px/1.3 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0; }
.hero h1 { font-size: clamp(32px, 6vw, 54px); line-height: 1.04; margin: 0; font-weight: 800; font-stretch: 112%; letter-spacing: -0.01em; }
.hero p.lead { max-width: 70ch; margin: 0; color: var(--muted); font-size: 18px; }
.legendrow { display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13px/1.4 var(--f-display); color: var(--muted); margin: 6px 0 0; }
.legendrow span { display: inline-flex; align-items: center; gap: 6px; }
.legendrow .lgk { font-weight: 700; color: var(--ink); }
.dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
nav.toc { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); margin-bottom: 8px; }
nav.toc ul { position: relative; list-style: none; display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 10px 0; scrollbar-width: thin; }
nav.toc a { display: inline-block; white-space: nowrap; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); text-decoration: none; font: 600 13px/1 var(--f-display); }
nav.toc a:hover, nav.toc a:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
nav.toc a[aria-current="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.sec { padding-block: 34px 10px; border-top: 1px solid var(--rule); scroll-margin-top: 64px; }
.tool { scroll-margin-top: 70px; }
.sec__head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
.sec__n { flex: none; min-width: 46px; height: 46px; padding: 0 6px; border-radius: 10px; display: grid; place-items: center; background: var(--accent); color: var(--paper); font: 800 22px/1 var(--f-display); }
.sec h2 { margin: 0; font-size: clamp(24px, 3.4vw, 32px); line-height: 1.1; font-weight: 800; font-stretch: 108%; }
.sec__q { margin: 4px 0 0; color: var(--muted); }
.pad__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars" "fx fx"; gap: 14px 28px; align-items: start; }
.pad__grid.nofx { grid-template-areas: "tpl vars"; }
.pad__tpl { grid-area: tpl; min-width: 0; } .pad__vars { grid-area: vars; min-width: 0; } .pad__fx { grid-area: fx; min-width: 0; border-top: 1px dashed var(--rule); padding-top: 10px; }
@media (max-width: 920px) { .pad__grid, .pad__grid.nofx { grid-template-columns: minmax(0, 1fr); grid-template-areas: "tpl" "fx" "vars"; } }
.pad .vars { margin-top: 2px; }
.pieces { margin-top: 16px; }
.pad { min-width: 0; background-color: var(--paper); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 18px 18px; border: 1px solid var(--rule); border-radius: 12px; padding: 16px 18px; }
.tpls { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.tpl__code { margin: 0; font: 600 14px/1.6 var(--f-mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.nb { white-space: nowrap; }
.tpl__note { margin: 3px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--muted); }
var.ph { font-family: var(--f-body); font-style: italic; font-weight: 600; font-size: 1.08em; letter-spacing: 0; color: var(--accent); background: var(--var-bg); border-radius: 4px; padding: 0 3px; }
.mb { overflow-x: auto; overflow-y: hidden; padding: 6px 2px; }
.mb math { font-family: var(--f-math); font-size: 1.22em; display: inline math; }
.mi math { font-family: var(--f-math); font-size: 1.08em; }
.vars { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14.5px; background: var(--paper); table-layout: fixed; }
.vars th, .dt th { text-align: left; font: 700 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: bottom; }
.vars td, .vars th.rh { border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: top; overflow-wrap: anywhere; }
.vars th.rh { font: 400 14.5px/1.5 var(--f-body); letter-spacing: 0; text-transform: none; color: var(--ink); }
.vars th.rh.p { font: 600 13px/1.5 var(--f-mono); }
.vars td.c { font: 600 13px/1.5 var(--f-mono); color: var(--accent2); }
.card { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.card > h3, .example > h3 { margin: 0 0 6px; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
.card.tbl { margin-top: 16px; }
.pieces .vars { margin-top: 4px; }
figure.fig { min-width: 0; margin: 18px 0 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 14.5px; margin-top: 12px; }
svg.chart { width: 100%; height: auto; display: block; margin: 0 auto; }
svg .t { fill: var(--muted); font: 12.5px var(--f-display); }
svg .f-accent { fill: var(--accent); } svg .f-muted { fill: var(--muted); }
.tblw { margin-top: 12px; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 7px 8px 7px 6px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt th.rh { font: 600 14px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
.dt .mono, .dt th.rh.mono { font: 600 13px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.dt td.cmdc .cmdw { display: inline-flex; }
.fig__note { color: var(--muted); font-size: 14.5px; margin: 10px 0 0; }
.fig__notes { margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 14.5px; }
.cmdw { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; }
code, code.cmd { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
code, pre, .cmd, var.ph, figure.fig, .tool { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
.cmdn { color: var(--muted); }
.sep { color: var(--muted); }
button.cp { flex: none; font: 600 11.5px/1 var(--f-display); letter-spacing: .02em; color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 7px; cursor: pointer; }
button.cp:hover, button.cp:focus-visible { border-color: var(--accent); outline: none; }
.code { margin-top: 10px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
.code__bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--rule); font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.code__lang { text-transform: uppercase; letter-spacing: .08em; flex: none; }
.code__src { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.code__bar .cp { margin-left: auto; }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 13px/1.55 var(--f-mono); color: var(--ink); tab-size: 4; }
.code pre code { font: inherit; background: none; padding: 0; overflow-wrap: normal; }
.tk-k { color: var(--syn-kw); font-weight: 700; } .tk-s { color: var(--syn-str); } .tk-c { color: var(--syn-com); font-style: italic; } .tk-p { color: var(--muted); user-select: none; }
.example { margin-top: 20px; }
ul.ex__notes { margin: 12px 0 0; padding-left: 20px; columns: 2 380px; column-gap: 34px; font-size: 15.5px; line-height: 1.5; }
ul.ex__notes li { break-inside: avoid; margin-bottom: 6px; }
.notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
@media (max-width: 720px) { .notes { grid-template-columns: minmax(0, 1fr); } }
.memo, .trap { border-radius: 10px; padding: 12px 16px; min-width: 0; }
.memo { background: var(--hi-soft); } .trap { background: var(--warn-soft); }
.memo p, .trap p { margin: 0; }
.tag { font-size: 11.5px !important; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px !important; color: var(--muted); }
.memo .tag { color: var(--hi-ink); } .trap .tag { color: var(--warn); }
.small { font-size: 14.5px; color: var(--muted); }
.k { font: 700 12.5px var(--f-display); color: var(--muted); letter-spacing: .02em; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 16px 0 0; font: 500 13px/1.35 var(--f-display); }
.links__k { color: var(--muted); font-weight: 700; }
.links .chip { border: 1px solid var(--rule); background: var(--paper); border-radius: 999px; padding: 4px 10px; color: var(--ink); text-decoration: none; }
.links a.chip:hover, .links a.chip:focus-visible { border-color: var(--accent); color: var(--accent); }
details.lab { margin-top: 14px; border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); }
details.lab > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px; padding: 11px 14px; font: 700 14px/1.3 var(--f-display); color: var(--ink); }
details.lab > summary::-webkit-details-marker { display: none; }
details.lab > summary::before { content: "▸"; color: var(--accent); transition: transform .15s; }
details.lab[open] > summary::before { transform: rotate(90deg); }
.lab__n { margin-left: auto; color: var(--muted); font-weight: 500; font-size: 13px; }
.lab__body { padding: 0 14px 14px; border-top: 1px solid var(--rule); }
.lab__goal { margin: 12px 0 4px; }
ol.lab__steps { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
ol.lab__steps > li { min-width: 0; }
.expect { margin: 6px 0 0; font-size: 15px; line-height: 1.5; }
.lab__fix { margin-top: 12px; background: var(--ok-soft); border-radius: 10px; padding: 10px 14px; }
.lab__fix .tag { color: var(--accent2); }
.lab__fix p { margin: 0; font-size: 15px; }
.verified { margin: 10px 0 0; font: 500 12.5px/1.45 var(--f-display); color: var(--muted); }
.verified span { display: block; margin-top: 2px; font-weight: 400; }
.btn { font: 600 14px/1.2 var(--f-display); color: var(--ink); background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.btn:hover, .btn:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.btn.primary:hover, .btn.primary:focus-visible { color: var(--paper); outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: .55; cursor: default; }
.quiz__top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; }
.quiz__n { margin: 0; font: 600 13px var(--f-display); color: var(--muted); }
pre.term { margin: 8px 0 0; padding: 14px 16px; border-radius: 10px; background: var(--code-bg); border: 1px solid var(--rule); font: 600 14px/1.55 var(--f-mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.quiz__btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.quiz__ans { margin-top: 12px; border-top: 1px solid var(--rule); padding-top: 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.quiz__ans p { margin: 0; }
.errs { margin-top: 14px; }
.search { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 6px; }
.search input, .dg-pick select { width: 100%; font: 500 15px var(--f-display); color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; }
.search input:focus-visible, .dg-pick select:focus-visible, #rv-text:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
ol.errlist { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
ol.errlist li { border-top: 1px solid var(--rule); padding: 10px 0; }
ol.errlist p { margin: 0; }
.err__msg code { font-weight: 600; background: none; padding: 0; }
.err__m { font-size: 15.5px; margin-top: 2px !important; }
.err__f, .err__s { font-size: 14.5px; margin-top: 4px !important; }
.err__s a, .quiz__ans a { font: 600 13.5px var(--f-display); }
.errs__none { margin: 8px 0 0; }
.tools .tool { margin-top: 14px; }
.tool > h3 { font-size: 16px; }
.dg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dg-chip { font: 500 14px/1.35 var(--f-display); text-align: left; color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 11px; cursor: pointer; max-width: 100%; }
.dg-chip:hover, .dg-chip:focus-visible { border-color: var(--accent); outline: none; }
.dg-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.dg-pick { display: none; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 10px; }
@media (max-width: 640px) {
  .dg-chips { display: none; } .dg-pick { display: grid; }
  /* en el celular, cada comando en su renglón: el " · " entre dos comandos quedaba solo en una línea */
  .dg-row .sep, .dg-first .sep, .err__f .sep, .quiz__ans .sep { display: none; }
  .dg-row .cmdw, .dg-first .cmdw, .err__f .cmdw, .quiz__ans .cmdw { display: flex; width: fit-content; margin: 4px 0 2px; }
}
.dg-empty { margin: 12px 0 0; }
.dg-panel { margin-top: 14px; border-top: 1px solid var(--rule); padding-top: 12px; }
.dg-sym { margin: 0 0 8px; font: 700 17px/1.35 var(--f-display); }
.dg-first p { margin: 0; }
ol.dg-causes { margin: 12px 0 0; padding-left: 22px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
ol.dg-causes li::marker { font: 700 14px var(--f-display); color: var(--muted); }
.dg-cause { margin: 0; font-weight: 600; }
.dg-row { margin: 3px 0 0; font-size: 15px; }
.rv-label { display: block; margin-top: 12px; font: 700 12.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--warn); }
.rv-label.ok { color: var(--accent2); } .rv-label.mine { color: var(--muted); }
#rv-text { display: block; width: 100%; margin-top: 6px; min-height: 280px; font: 13px/1.55 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; resize: vertical; white-space: pre; overflow: auto; }
.rv-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.rv-out { margin-top: 12px; }
.rv-sum { margin: 0 0 4px; font: 600 15px var(--f-display); }
.rv-objs { margin: 0 0 10px; font-size: 14px; color: var(--muted); }
ol.rv-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
ol.rv-list li { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; min-width: 0; }
ol.rv-list li.sev-error { border-left-color: var(--warn); } ol.rv-list li.sev-warn { border-left-color: var(--hi); } ol.rv-list li.sev-info { border-left-color: var(--accent); }
ol.rv-list p { margin: 3px 0 0; font-size: 15px; }
.rv-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.rv-msg { font-weight: 600; }
p.rv-obj { font: 500 13.5px/1.45 var(--f-display); color: var(--muted); }
p.rv-obj code { font-size: 12.5px; }
.rv-ln { font: 700 12.5px/1.2 var(--f-display); color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.rv-ln:hover, .rv-ln:focus-visible { border-color: var(--accent); outline: none; }
.sev { flex: none; font: 700 11px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; }
.sev.error { background: var(--warn); color: var(--onbar); } .sev.warn { background: var(--hi-soft); color: var(--hi-ink); border: 1px solid var(--hi); } .sev.info { background: var(--accent-soft); color: var(--accent); }
.rv-err { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: 10px; padding: 10px 14px; }
.rv-err p { margin: 4px 0 0; }
.rv-err__t { font: 700 16px/1.3 var(--f-display); color: var(--warn); margin: 0 !important; }
pre.rv-err__snip { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--paper); border: 1px solid var(--rule); font: 12.5px/1.5 var(--f-mono); overflow-x: auto; white-space: pre; }
.rv-note { margin: 10px 0 0; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
/* ---------- piezas comunes de las figuras */
.kleg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.kleg span { display: inline-flex; align-items: center; gap: 6px; }
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; font-style: normal; }
.sw--tu { background: var(--accent); } .sw--gh { background: var(--pu); } .sw--auto { background: var(--ink); } .sw--ok { background: var(--accent2); }
.sw--wait { background: var(--hi-soft); border: 1.5px solid var(--hi); } .sw--off { height: 0; border-top: 2px dashed var(--muted); border-radius: 0; }
.sw--aws { background: var(--free); border: 1.5px solid var(--muted); }
.sw--via { width: 11px; height: 11px; border-radius: 50%; border: 2.5px solid var(--accent); background: var(--paper); }
.sw--cm { width: 14px; height: 14px; border-radius: 50%; background: var(--free); border: 1.6px solid var(--ink); }
.sw--new { width: 14px; height: 14px; border-radius: 50%; background: var(--accent2); }
.sw--gone { width: 14px; height: 14px; border-radius: 50%; border: 1.6px dashed var(--muted); }
.sw--br { width: 24px; height: 13px; background: var(--accent); clip-path: polygon(0 50%, 26% 0, 100% 0, 100% 100%, 26% 100%); border-radius: 0 3px 3px 0; }
.sw--rbr { width: 24px; height: 13px; border: 1.5px dashed var(--pu); border-radius: 3px; }
.sw--ghost { width: 24px; height: 13px; border: 1.3px dashed var(--muted); border-radius: 3px; }
.sw--head { width: auto; height: auto; padding: 1px 4px; border: 1.5px solid var(--accent); color: var(--accent); font: 800 9.5px/1.2 var(--f-mono); }
/* ---------- la cadena */
.kchain { display: grid; gap: 10px; }
.kz { --zc: var(--muted); border: 1px solid var(--rule); border-left: 5px solid var(--zc); border-radius: 10px; padding: 10px 12px 2px; min-width: 0; }
.kz--tu { --zc: var(--accent); } .kz--gh { --zc: var(--pu); } .kz--ci, .kz--cd { --zc: var(--ink); } .kz--k8s { --zc: var(--accent2); }
.kz__h { margin: 0 0 8px; font: 800 12px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
ol.kz__steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.kst { position: relative; padding: 0 0 12px 38px; min-width: 0; }
.kst__no { position: absolute; left: 0; top: 0; width: 27px; height: 27px; border-radius: 50%; background: var(--zc); color: var(--paper); display: grid; place-items: center; font: 800 13px/1 var(--f-display); }
.kst:not(:last-child)::before { content: ""; position: absolute; left: 12.5px; top: 30px; bottom: 3px; width: 2px; background: var(--rule); }
.kst__l { margin: 1px 0 3px; font: 700 15.5px/1.35 var(--f-display); }
.kst__n { margin: 5px 0 0; font-size: 15px; line-height: 1.5; }
/* ---------- las zonas: columnas con flechas (ancho) y filas (celular) */
.ar-n { display: none; }
.ar__grp, .ar__zones, ol.ar__mv { display: grid; grid-template-columns: repeat(var(--nz), minmax(0, 1fr)); }
.ar__grp { margin-bottom: 6px; }
.ar__g { margin: 0 6px; text-align: center; font: 800 11.5px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 4px; }
.ar__g--rem { color: var(--pu); border-color: var(--pu); }
.ar__z { margin: 0 6px; border: 1.5px solid var(--accent); background: var(--accent-soft); border-radius: 10px; padding: 8px 10px; min-width: 0; }
.ar__z--rem { border-color: var(--pu); background: var(--pu-soft); }
.ar__z p { margin: 0; }
.ar__zl { font: 800 15px/1.3 var(--f-display); }
.ar__zs { font-size: 14px; line-height: 1.4; margin-top: 2px !important; }
.ar__see { font: 500 12.5px/1.5 var(--f-display); color: var(--muted); margin-top: 5px !important; }
.ar__see code { font-size: 12px; }
.ar__mvw { position: relative; }
.ar__life { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px dashed var(--rule); transform: translateX(-1px); }
ol.ar__mv { position: relative; list-style: none; margin: 0; padding: 10px 0 4px; row-gap: 2px; }
.mv { position: relative; min-width: 0; padding: 4px 0 8px; --c: var(--accent); }
.mv--net { --c: var(--pu); }
.mv__cmd, .mv__note { margin: 0 calc(50% / var(--span)); text-align: center; }
.mv__cmd code { display: inline-block; max-width: 100%; font: 700 13px/1.4 var(--f-mono); color: var(--c); background: var(--paper); border: 1px solid var(--c); padding: 1px 6px; border-radius: 5px; }
.mv__line { position: relative; display: block; height: 3px; margin: 7px calc(50% / var(--span)) 5px; background: var(--c); border-radius: 2px; }
.mv--r .mv__line::after { content: ""; position: absolute; right: -8px; top: 50%; transform: translateY(-50%); border-style: solid; border-width: 7px 0 7px 11px; border-color: transparent transparent transparent var(--c); }
.mv--l .mv__line::before { content: ""; position: absolute; left: -8px; top: 50%; transform: translateY(-50%); border-style: solid; border-width: 7px 11px 7px 0; border-color: transparent var(--c) transparent transparent; }
.mv--r .mv__line::before, .mv--l .mv__line::after { content: ""; position: absolute; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--c); }
.mv--r .mv__line::before { left: -4px; } .mv--l .mv__line::after { right: -4px; }
.mv__via { position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--paper); border: 3px solid var(--c); }
.mv__note { font-size: 13.5px; line-height: 1.4; color: var(--muted); }
.mv__vt { font-weight: 600; color: var(--c); }
.ar-n__hint { margin: 0 0 8px; font: 600 12.5px/1.4 var(--f-display); color: var(--muted); }
ul.ar__gap { list-style: none; margin: 0 0 0 16px; padding: 10px 0 10px 14px; border-left: 2px dashed var(--rule); display: grid; gap: 10px; }
.mvn { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 2px 8px; align-items: start; --c: var(--accent); }
.mvn.mv--net { --c: var(--pu); }
.mvn__a { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: var(--paper); font: 800 15px/1 var(--f-display); }
.mvn p { margin: 0; }
.mvn__c code { font: 700 13px/1.4 var(--f-mono); color: var(--c); background: none; padding: 0; }
.mvn__far { font: 700 12.5px/1.35 var(--f-display); color: var(--c); }
.mvn__n { font-size: 14px; line-height: 1.4; color: var(--muted); }
@media (max-width: 699px) { .ar-w { display: none; } .ar-n { display: block; } .ar-n .ar__z { margin: 0; } }
/* ---------- grafos de commits: antes y después */
.gxs { display: grid; gap: 14px; }
.gx { border: 1px solid var(--rule); border-radius: 12px; padding: 12px; min-width: 0; }
.gx__h { display: flex; gap: 10px; align-items: center; margin: 0; font: 700 16px/1.3 var(--f-display); }
.gx__k { flex: none; width: 26px; height: 26px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 13px/1 var(--f-display); }
.gx__op { margin: 8px 0 0; }
.gx__cmd { display: inline-block; max-width: 100%; font: 700 13.5px/1.5 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); padding: 3px 8px; border-radius: 6px; overflow-wrap: anywhere; }
.gx__gh { font: 700 14.5px/1.45 var(--f-display); }
.gx__pp { display: grid; grid-template-columns: minmax(0, 388px) 48px minmax(0, 388px); justify-content: center; align-items: end; margin-top: 10px; }
.gx__p { min-width: 0; border-radius: 10px; background: var(--bg); padding: 2px; }
.gx__p svg.chart { max-width: 380px; }
.gx__ar { align-self: center; display: grid; place-items: center; font: 800 26px/1 var(--f-display); color: var(--muted); }
.gx__an { display: none; }
.gx__note { margin-top: 10px !important; }
.gx__leg { margin-top: 12px; } .gx__legk { width: 100%; font-weight: 600; color: var(--ink); }
@media (max-width: 699px) { .gx { padding: 10px; } .gx__pp { grid-template-columns: minmax(0, 1fr); } .gx__ar { padding: 6px 0; } .gx__aw { display: none; } .gx__an { display: inline; } }
svg .gx-ph { fill: var(--muted); font: 800 10.5px var(--f-display); letter-spacing: .12em; }
svg .gx-e { fill: none; stroke: var(--muted); stroke-width: 2; }
svg .gx-e--gone { stroke-dasharray: 4 3; opacity: .75; }
svg .gx-e--new { stroke: var(--accent2); stroke-width: 2.4; }
svg .gx-n { stroke-width: 1.6; }
svg .gx-n--n { fill: var(--free); stroke: var(--ink); }
svg .gx-n--new { fill: var(--accent2); stroke: var(--accent2); }
svg .gx-n--gone { fill: var(--paper); stroke: var(--muted); stroke-dasharray: 3 2.5; }
svg .gx-id { font: 800 11px var(--f-display); }
svg .gx-id--n { fill: var(--ink); } svg .gx-id--new { fill: var(--onbar); } svg .gx-id--gone { fill: var(--muted); }
svg .gx-tag { fill: var(--accent); } svg .gx-tagt { fill: var(--onbar); font: 700 12px var(--f-mono); }
svg .gx-rtag { fill: var(--paper); stroke: var(--pu); stroke-width: 1.5; stroke-dasharray: 4 2.5; } svg .gx-rtagt { fill: var(--pu); font: 700 12px var(--f-mono); }
svg .gx-head { fill: var(--paper); stroke: var(--accent); stroke-width: 1.6; } svg .gx-headt { fill: var(--accent); font: 800 12px var(--f-mono); }
svg .gx-harr { stroke: var(--accent); stroke-width: 1.6; fill: none; }
svg .gx-ghost { fill: none; stroke: var(--muted); stroke-width: 1.3; stroke-dasharray: 3 2.5; } svg .gx-ghostt { fill: var(--muted); font: 600 12px var(--f-mono); }
svg .gx-chip { stroke-width: 1.3; } svg .gx-chip--new { fill: var(--ok-soft); stroke: var(--accent2); } svg .gx-chip--gone { fill: none; stroke: var(--muted); stroke-dasharray: 3 2.5; }
svg .gx-chipt { font: 700 11px var(--f-display); } svg .gx-chipt--new { fill: var(--accent2); } svg .gx-chipt--gone { fill: var(--muted); }
svg .gx-badge { font: 800 11px var(--f-display); } svg .gx-badge--ok { fill: var(--accent2); } svg .gx-badge--bad { fill: var(--warn); }
svg .gx-msg { fill: var(--muted); font: 400 13px var(--f-display); } svg .gx-msg--gone { font-style: italic; opacity: .85; }
/* ---------- deshacer: tabla por niveles */
.lv { display: inline-flex; align-items: baseline; gap: 6px; border-radius: 6px; padding: 2px 7px; line-height: 1.4; }
.lv i { font-style: normal; font-weight: 800; flex: none; font-family: var(--f-display); }
.lv--keep { color: var(--muted); padding-left: 2px; }
.lv--move { background: var(--hi-soft); } .lv--move i { color: var(--hi-ink); }
.lv--lose { background: var(--warn-soft); font-weight: 600; } .lv--lose i { color: var(--warn); }
.lv--ok { background: var(--ok-soft); } .lv--ok i { color: var(--accent2); }
.lv--rewrite { background: var(--warn-soft); box-shadow: inset 0 0 0 1.5px var(--warn); } .lv--rewrite i { color: var(--warn); }
.lv--sw { padding: 0 7px; min-width: 26px; justify-content: center; }
.ud__cmd { font: 700 13px/1.5 var(--f-mono); background: none; padding: 0; }
ul.ud__leg { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 6px 18px; font: 500 13.5px/1.4 var(--f-display); color: var(--muted); }
ul.ud__leg li { display: flex; gap: 8px; align-items: baseline; }
.ud__gh { margin: 20px 0 8px; font: 800 12.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.rm { margin-top: 10px; } .rm__h { margin: 0; font: 700 14px/1.35 var(--f-display); } .rm .tblw { margin-top: 6px; } .rm__t th code { white-space: nowrap; }
/* ---------- la vida de un PR */
.prh { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 14px; }
.tagb { font: 700 13px/1.2 var(--f-mono); color: var(--onbar); background: var(--accent); border-radius: 5px; padding: 4px 8px; overflow-wrap: anywhere; }
.prh__a { font: 800 18px/1 var(--f-display); color: var(--muted); }
.prh__t { font-size: 14.5px; color: var(--muted); }
.prf { display: grid; grid-template-columns: minmax(0, 1fr); }
.prs { --c: var(--muted); position: relative; padding: 0 0 14px 40px; min-width: 0; }
.prs--tu { --c: var(--accent); } .prs--gh { --c: var(--pu); } .prs--auto { --c: var(--ink); } .prs--k8s { --c: var(--accent2); }
.prs__no { position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 13px/1 var(--f-display); }
.prs::before { content: ""; position: absolute; left: 13px; top: 30px; bottom: 2px; width: 2px; background: var(--rule); }
.prs p { margin: 0; }
.prs__l { font: 700 15.5px/1.35 var(--f-display); margin-bottom: 4px !important; }
.prs__who { display: inline-block; font: 600 12px/1.3 var(--f-display); color: var(--c); border: 1px solid var(--c); border-radius: 999px; padding: 1px 8px; margin-left: 4px; }
.prs__n { font-size: 15px; line-height: 1.5; margin-top: 4px !important; }
.prg { margin: 0 0 14px 40px; border: 2px solid var(--hi); background: var(--hi-soft); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.prg__h { margin: 0 0 8px; font: 800 12.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--hi-ink); }
ul.prg__l { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.prg__l p { margin: 0; }
.prg__r { font: 700 14.5px/1.35 var(--f-display); }
.prg__s { margin-top: 3px !important; }
.prg__set { font: 600 12.5px/1.3 var(--f-display); background: var(--paper); border: 1px solid var(--hi); border-radius: 999px; padding: 1px 8px; display: inline-block; }
.prg__b { font-size: 14.5px; line-height: 1.45; margin-top: 3px !important; }
@media (min-width: 900px) {
  .prf { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); column-gap: 26px; }
  .prs { grid-column: 1; }
  .prg { grid-column: 2; grid-row: 1 / span var(--n); align-self: start; margin: 0; }
}
/* ---------- anatomía de un workflow */
.wf { display: grid; gap: 12px; }
.wf p { margin: 0; }
.wf__on { border: 1.5px solid var(--pu); background: var(--pu-soft); border-radius: 12px; padding: 10px 12px; }
.wf__h { font: 800 12.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--pu); margin-bottom: 8px !important; }
.wf__h code { text-transform: none; letter-spacing: 0; }
ul.wf__trs { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.wf__tr { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 4px 12px; align-items: start; }
.wf__trn { grid-column: 2; font-size: 14px; line-height: 1.45; color: var(--muted); }
.evp { display: inline-block; font: 700 13px/1.3 var(--f-mono); color: var(--paper); background: var(--pu); border-radius: 6px; padding: 3px 8px; }
.wf__runs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.wj { display: inline-flex; flex-direction: column; font: 700 13px/1.25 var(--f-mono); border-radius: 8px; padding: 4px 9px; border: 1.5px solid var(--ink); }
.wj small { font: 600 11px/1.2 var(--f-display); }
.wj--on { background: var(--ink); color: var(--paper); }
.wj--wait { border-color: var(--hi); background: var(--hi-soft); color: var(--hi-ink); }
.wj--off { border: 1.5px dashed var(--muted); color: var(--muted); }
.wf__arr { color: var(--muted); font-weight: 800; }
.wf__step { display: inline-flex; align-items: center; gap: 6px; }
.wf__jobs { display: grid; grid-template-columns: repeat(var(--nl), minmax(0, 1fr)); gap: 0 34px; align-items: start; }
.wf__lv { position: relative; display: grid; gap: 10px; min-width: 0; }
.wf__cn { position: absolute; left: -31px; top: 16px; width: 28px; display: grid; justify-items: center; color: var(--muted); font: 800 20px/1 var(--f-display); }
.wf__cn small { font: 700 10px/1.2 var(--f-display); }
.wf__cnn { display: none; }
.wjob { border: 2px solid var(--ink); border-radius: 12px; padding: 10px 12px; min-width: 0; background: var(--paper); }
.wjob__h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.wjob__id { font: 800 16px/1.3 var(--f-mono); }
.wjob__ro { font-size: 12px; }
.wjob__m { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px !important; }
.wb { font: 600 12.5px/1.4 var(--f-display); border-radius: 6px; padding: 2px 7px; background: var(--free); overflow-wrap: anywhere; min-width: 0; }
.wb code { font-size: 12px; background: none; padding: 0; }
.wb--env { background: var(--hi-soft); color: var(--hi-ink); } .wb--out { background: var(--ok-soft); color: var(--accent2); }
ol.wjob__s { margin: 8px 0 0; padding-left: 22px; font-size: 14.5px; line-height: 1.45; }
@media (max-width: 760px) {
  .wf__tr { grid-template-columns: minmax(0, 1fr); } .wf__trn { grid-column: 1; }
  .wf__jobs { grid-template-columns: minmax(0, 1fr); gap: 36px 0; }
  .wf__cn { left: 0; right: 0; top: -31px; width: auto; display: flex; gap: 6px; justify-content: center; align-items: center; }
  .wf__cnw { display: none; } .wf__cnn { display: inline; }
}
/* ---------- OIDC */
ol.oi { list-style: none; margin: 0; padding: 0; display: grid; }
.oi__st { --c: var(--muted); position: relative; padding: 0 0 16px 40px; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.oi--auto { --c: var(--ink); } .oi--gh { --c: var(--pu); } .oi--aws { --c: var(--muted); } .oi--ok { --c: var(--accent2); }
.oi__st::before { content: ""; position: absolute; left: 13px; top: 30px; bottom: 2px; width: 2px; background: var(--rule); }
.oi__st:last-child::before { display: none; }
.oi__no { position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 13px/1 var(--f-display); }
.oi__t, .oi__pn { min-width: 0; }
.oi__t p { margin: 0; }
.oi__who { font: 700 13px/1.35 var(--f-display); color: var(--c); overflow-wrap: anywhere; }
.oi__does { font: 700 15.5px/1.35 var(--f-display); margin-top: 2px !important; }
.oi__det { font-size: 15px; line-height: 1.5; margin-top: 3px !important; overflow-wrap: anywhere; }
@media (min-width: 860px) { .oi__st--p { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 20px; } }
.oi__tok, .oi__chk { border-radius: 12px; padding: 10px 12px; min-width: 0; }
.oi__tok { border: 2px solid var(--pu); background: var(--pu-soft); }
.oi__th { margin: 0 0 6px; font: 800 12px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
dl.oi__cl { margin: 0; display: grid; gap: 2px; }
dl.oi__cl div { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; padding: 2px 6px; border-radius: 5px; }
dl.oi__cl div.hl { background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--pu); }
dl.oi__cl dt { font: 700 12.5px/1.5 var(--f-mono); color: var(--pu); }
dl.oi__cl dd { margin: 0; font: 600 12.5px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.oi__chk { border: 2px solid var(--accent2); background: var(--ok-soft); }
.oi__chk ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.oi__chk li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 6px; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.oi__chk code { font-size: 12.5px; }
.oi__m { font: 800 18px/1.2 var(--f-display); } .oi__chk li.ok .oi__m { color: var(--accent2); } .oi__chk li.no .oi__m { color: var(--warn); }
.oi__res { margin: 8px 0 0; font: 700 14.5px/1.4 var(--f-display); } .oi__res.ok { color: var(--accent2); } .oi__res.no { color: var(--warn); }
details.oi__pol { margin-top: 8px; } details.oi__pol > summary { cursor: pointer; font: 600 13.5px var(--f-display); color: var(--accent); }
.oi__pol pre, .oi__pol pre code { white-space: pre-wrap; overflow-wrap: anywhere; }
.oi__pol mark { background: var(--hi-soft); color: inherit; box-shadow: 0 0 0 1px var(--hi); border-radius: 2px; }
.oi__subs { margin-top: 6px; }
.oi__t td.ok { color: var(--accent2); font-weight: 700; } .oi__t td.no { color: var(--warn); font-weight: 700; }
/* ---------- pipelines */
.pl { display: grid; grid-template-columns: repeat(var(--nl), minmax(0, 1fr)); gap: 16px 26px; align-items: start; }
.pl__lane { min-width: 0; }
.pl__lh { margin: 0 0 10px; font: 800 13.5px/1.35 var(--f-display); color: var(--ink); border-bottom: 2px solid var(--rule); padding-bottom: 5px; }
ol.pl__steps { list-style: none; margin: 0; padding: 0; }
.pst { --c: var(--muted); position: relative; padding: 0 0 14px 38px; min-width: 0; }
.pst--tu { --c: var(--accent); } .pst--gh { --c: var(--pu); } .pst--auto { --c: var(--ink); } .pst--wait { --c: var(--hi); } .pst--aws { --c: var(--muted); } .pst--k8s { --c: var(--accent2); }
.pst__no { position: absolute; left: 0; top: 0; width: 26px; height: 26px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 12.5px/1 var(--f-display); }
.pst--wait .pst__no { color: var(--on-hi); }
.pst::before { content: ""; position: absolute; left: 12px; top: 28px; bottom: 2px; width: 2px; background: var(--rule); }
ol.pl__steps > .pst:last-child::before, .pc__as > .pst:last-child::before { display: none; }
.pst p { margin: 0; }
.pst__l { font: 700 15px/1.35 var(--f-display); display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
.pst__w { font: 600 12.5px/1.4 var(--f-display); color: var(--c); margin-top: 2px !important; }
.pst--wait .pst__w { color: var(--hi-ink); }
.pst__n { font-size: 14.5px; line-height: 1.45; margin-top: 3px !important; }
.dur { font: 700 12px/1.35 var(--f-mono); color: var(--ink); background: var(--free); border-radius: 999px; padding: 2px 8px; overflow-wrap: anywhere; }
.kleg .dur { font-size: 11px; }
@media (max-width: 760px) { .pl { grid-template-columns: minmax(0, 1fr); } }
.pc__mh { margin: 0 0 10px; font: 800 12.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.pc__g { display: grid; grid-template-columns: minmax(0, 1fr); }
.pc__alt { margin: 0 0 14px 38px; border: 2px dashed var(--hi); border-radius: 12px; padding: 10px 12px; background: var(--paper); min-width: 0; }
.pc__ah { margin: 0 0 10px; font: 700 14.5px/1.4 var(--f-display); }
.pc__rb { margin-top: 12px; border: 2px solid var(--accent2); border-radius: 12px; padding: 10px 12px; background: var(--ok-soft); }
.pc__rh { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font: 800 15.5px/1.35 var(--f-display); }
.pc__ri { font-size: 22px; line-height: 1; color: var(--accent2); }
ol.pc__rs { margin: 8px 0 0; padding-left: 22px; display: grid; gap: 4px; font-size: 15px; line-height: 1.45; }
@media (min-width: 900px) {
  .pc__g { grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr); column-gap: 26px; }
  .pc__g > .pst { grid-column: 1; }
  .pc__alt { grid-column: 2; grid-row: var(--r0) / span var(--rn); align-self: start; margin: 0; }
  ol.pc__rs { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px 26px; }
}
/* ---------- runners */
.rn__hs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.rn__h { border-radius: 12px; padding: 10px 12px; min-width: 0; }
.rn__h p { margin: 0; } .rn__h code { font-size: 12.5px; overflow-wrap: anywhere; }
.rn__h--gh { border: 2px solid var(--pu); background: var(--pu-soft); } .rn__h--self { border: 2px solid var(--accent); background: var(--accent-soft); }
.rn__t { font: 800 16px/1.3 var(--f-display); margin-bottom: 4px !important; }
.rn__c { font-size: 14px; line-height: 1.45; margin-top: 6px !important; }
.rn__tb b.bad { color: var(--warn); } .rn__tb b.good { color: var(--accent2); }
@media (min-width: 641px) { .rn__tb td.rn__l { box-shadow: inset 3px 0 0 var(--pu); padding-left: 10px; } .rn__tb td.rn__r { box-shadow: inset 3px 0 0 var(--accent); padding-left: 10px; } }
@media (max-width: 520px) { .rn__hs { grid-template-columns: minmax(0, 1fr); } }
/* tablas: se apilan en el celular */
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  table.ud__t td, table.rm__t td { padding: 3px 0; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    --bg: #ffffff; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
    --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
    --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
    --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.11); --on-hi: #18212d; color-scheme: light;
  }
  body { font-size: 11px; line-height: 1.45; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, #herramientas, details.lab, figure.quiz, .search, #err-n, #err-none, button.cp { display: none !important; }
  .sec { break-before: page; padding-top: 0; border-top: 0; }
  #bolsillo { break-before: auto; }
  .hero { padding-top: 0; padding-bottom: 12px; gap: 6px; } .hero p.lead { font-size: 12px; } .hero h1 { font-size: 34px; } .legendrow { font-size: 10px; }
  .sec__head { margin-bottom: 10px; gap: 12px; } .sec__n { min-width: 34px; height: 34px; font-size: 17px; border-radius: 8px; } .sec h2 { font-size: 22px; } .sec__q { font-size: 12px; margin-top: 2px; }
  .pad { padding: 10px 12px; }
  .pad__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars" "fx fx"; gap: 8px 16px; }
  .pad__grid.nofx { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars"; }
  .tpls { gap: 7px; } .tpl__code { font-size: 10.5px; } .tpl__note { font-size: 10.5px; }
  .tag { font-size: 8.5px !important; }
  .vars, .dt { font-size: 10.5px; } .vars th, .dt th { font-size: 8.5px; padding: 3px 4px; } .vars td, .vars th.rh, .dt td, .dt th.rh { padding: 3px 4px; }
  .vars th.rh { font-size: 10.5px; } .vars td.c, .vars th.rh.p, .dt .mono, .dt th.rh.mono { font-size: 9.5px; } .dt th.rh { font-size: 10.5px; }
  code, code.cmd { font-size: 9.5px; }
  .code { margin-top: 6px; } .code pre { font-size: 9.5px; line-height: 1.4; padding: 7px 10px; } .code__bar { font-size: 9px; padding: 3px 8px; }
  .card { padding: 8px 10px; } .card > h3, .example > h3 { font-size: 11.5px; margin-bottom: 4px; }
  .pieces { margin-top: 10px; } .example { margin-top: 12px; } .notes { margin-top: 10px; gap: 8px; } .card.tbl { margin-top: 10px; }
  ul.ex__notes { columns: 2; column-gap: 20px; font-size: 10.5px; margin-top: 8px; }
  .memo, .trap { padding: 7px 10px; } .memo p, .trap p { font-size: 10.5px; }
  figure.fig { padding: 8px; margin-top: 10px; } figure.fig figcaption, .fig__note, .fig__notes { font-size: 10.5px; margin-top: 6px; }
  .links { font-size: 9px; margin-top: 8px; } .links .chip { padding: 2px 7px; }
  .mb { padding: 2px; } .mb math { font-size: 1.15em; }
  ol.errlist { display: block; columns: 2; column-gap: 20px; } ol.errlist li { padding: 5px 0; } .err__m, .err__f, .err__s { font-size: 10px; }
  pre, .code pre, .tpl__code, pre.term { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  .mb { overflow: visible; }
  .k { font-size: 9px; } .kleg { font-size: 9.5px; margin-top: 6px; } .sw { width: 12px; height: 9px; } .sw.sw--head { width: auto; height: auto; font-size: 7.5px; } .sw.sw--cm, .sw.sw--new, .sw.sw--gone { width: 10px; height: 10px; }
  .kchain { gap: 6px; } .kz { padding: 6px 10px 0; } .kz__h { font-size: 9px; margin-bottom: 5px; } .kst { padding: 0 0 7px 30px; } .kst__no { width: 21px; height: 21px; font-size: 10.5px; } .kst:not(:last-child)::before { left: 9.5px; top: 23px; }
  .kst__l { font-size: 11.5px; } .kst__n { font-size: 10.5px; margin-top: 3px; }
  .ar-w { display: block !important; } .ar-n { display: none !important; }
  .ar__zl { font-size: 11.5px; } .ar__zs, .ar__see { font-size: 9.5px; } .ar__z { padding: 5px 7px; margin: 0 3px; } .ar__g { font-size: 8.5px; margin: 0 3px; }
  .mv__cmd code { font-size: 9.5px; } .mv__note { font-size: 9.5px; } .mv { padding: 2px 0 5px; } .mv__line { margin-top: 4px; margin-bottom: 3px; }
  .gxs { gap: 8px; } .gx { padding: 7px 9px; } .gx__h { font-size: 12px; } .gx__k { width: 20px; height: 20px; font-size: 10.5px; } .gx__cmd { font-size: 9.5px; padding: 1px 6px; } .gx__gh { font-size: 10.5px; } .gx__op { margin-top: 4px; }
  .gx__pp { grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr) !important; margin-top: 6px; } .gx__aw { display: inline !important; } .gx__an { display: none !important; } .gx__ar { font-size: 18px; }
  .gx__p svg.chart { max-width: none; }
  ul.ud__leg { font-size: 9.5px; grid-template-columns: repeat(2, minmax(0, 1fr)); } .lv { padding: 1px 5px; }
  .prs { padding: 0 0 8px 30px; } .prs__no { width: 21px; height: 21px; font-size: 10.5px; } .prs::before { left: 9.5px; top: 23px; } .prs__l { font-size: 11.5px; } .prs__n, .prg__b { font-size: 10.5px; } .prs__who { font-size: 9px; }
  .prf { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) !important; column-gap: 14px; } .prs { grid-column: 1; } .prg { grid-column: 2; grid-row: 1 / span var(--n); align-self: start; margin: 0 !important; padding: 7px 9px; } .prg__r { font-size: 10.5px; } .prg__h { font-size: 9px; } .prg__set { font-size: 9px; } .tagb { font-size: 9.5px; } .prh__t { font-size: 10.5px; }
  .wf { gap: 8px; } .wf__on { padding: 6px 9px; } .wf__tr { grid-template-columns: 110px minmax(0, 1fr) !important; } .wf__trn { grid-column: 2 !important; font-size: 9.5px; } .evp, .wj { font-size: 9.5px; } .wj small { font-size: 8.5px; }
  .wf__jobs { grid-template-columns: repeat(var(--nl), minmax(0, 1fr)) !important; gap: 0 22px !important; } .wf__cn { left: -20px !important; top: 12px !important; width: 18px !important; right: auto !important; display: grid !important; font-size: 14px; } .wf__cnw { display: inline !important; } .wf__cnn, .wf__cn small { display: none !important; }
  .wjob { padding: 6px 8px; } .wjob__id { font-size: 11.5px; } .wjob__ro, .wb, .wb code { font-size: 9px; } ol.wjob__s { font-size: 10px; padding-left: 16px; }
  .oi__st { padding: 0 0 9px 30px; } .oi__st--p { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr) !important; gap: 12px; } .oi__no { width: 21px; height: 21px; font-size: 10.5px; } .oi__st::before { left: 9.5px; top: 23px; }
  .oi__who { font-size: 9px; } .oi__does { font-size: 11.5px; } .oi__det, .oi__chk li { font-size: 10px; } dl.oi__cl dt, dl.oi__cl dd { font-size: 9.5px; } dl.oi__cl div { grid-template-columns: 74px minmax(0, 1fr); } .oi__th { font-size: 8.5px; } .oi__res { font-size: 10.5px; } .oi__chk code { font-size: 9.5px; }
  .pl { grid-template-columns: repeat(var(--nl), minmax(0, 1fr)) !important; gap: 10px 16px; } .pst { padding: 0 0 8px 30px; } .pst__no { width: 20px; height: 20px; font-size: 10px; } .pst::before { left: 9px; top: 22px; } .pst__l { font-size: 11px; } .pst__w, .pst__n { font-size: 9.5px; } .dur { font-size: 9px; } .pl__lh, .pc__mh { font-size: 10px; }
  .pc__g { grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr) !important; column-gap: 16px; } .pc__g > .pst { grid-column: 1; } .pc__alt { grid-column: 2; grid-row: var(--r0) / span var(--rn); align-self: start; margin: 0 !important; padding: 7px 9px; } .pc__ah { font-size: 10.5px; } .pc__rb { padding: 7px 9px; } .pc__rh { font-size: 11.5px; } ol.pc__rs { font-size: 10.5px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rn__hs { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; } .rn__t { font-size: 11.5px; } .rn__c, .rn__h code { font-size: 9.5px; }
  figure.fig:not(.has-table), .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .kz, .gx, .prs, .prg, .wjob, .wf__on, .oi__st, .pst, .pc__alt, .pc__rb, .rn__h, .mv, .ar__zones, .rm { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .kz__h, .ud__gh, .pl__lh { break-after: avoid; }
}
`;

// Sin ligaduras en la letra monoespaciada (como en la hoja de vLLM): el shorthand font: de reglas como .code pre o
// .vars td.c vuelve a poner font-variant-ligatures y font-feature-settings en normal, y JetBrains Mono dibuja -> como
// una flecha, != como ≠ y >= como ≥. Esta regla va al final, con los mismos selectores que usan la letra monoespaciada
// (también los <text> de los SVG), así gana en la cascada. Los comentarios del CSS se quitan antes y los selectores se
// cortan solo en las comas de primer nivel (no en las de :not(a, b) ni en las de [x="a,b"]).
const splitSel = (s) => {
  const out = []; let depth = 0, q = '', cur = '';
  for (const ch of s) {
    if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return [...out, cur.trim()].filter(Boolean);
};
const MONO_RULES = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /var\(--f-mono\)/.test(m[2]));
const MONO_SEL = [...new Set(MONO_RULES.map((m) => m[1].trim().replace(/\s+/g, ' ')).filter((x) => x && !x.startsWith('@')).flatMap(splitSel))];
const CSS_ALL = CSS + `\n${[...MONO_SEL, 'code *', 'pre *'].join(', ')} { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }\n`;

// ================================================================ JS de la página (sin librerías; js-yaml se carga aparte)
const DATA = {
  rules: W2.revisor.map((r) => ({ id: r.id, severity: r.severity, message: r.message, why: r.why, fix: r.fix })),
  samples: SAMPLES,
  btns: REF_BTNS.map(([id, key]) => [id, key]),
  yamlUrl: YAML_URL,
  errs: ERRS.map((e) => ({ msg: e.msg, meaning: e.meaning, first: cmdHtml(e.first), sec: e.sec, lab: SECLAB(e.sec) })),
};
const JS_SRC = String.raw`
(function () {
  'use strict';
  var D = /*DATA*/;
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- copiar: clipboard dentro del clic; si lo rechaza, seleccionar el texto
  function selectEl(el) {
    try { var r = doc.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
  }
  function flash(btn, msg) {
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.textContent = msg;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); }, 1800);
  }
  doc.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button.cp') : null;
    if (!btn) return;
    var box = btn.closest('.cmdw, .code');
    var el = box ? box.querySelector('code.cmd, pre') : null;
    var text = btn.getAttribute('data-copy');
    if (text === null) text = el ? el.textContent : '';
    function fail() { if (el) selectEl(el); flash(btn, 'Seleccionado: ⌘C'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash(btn, 'Copiado'); }, fail);
      else fail();
    } catch (e) { fail(); }
  });

  // ---------- nav: marca la sección visible
  var nav = doc.querySelector('nav.toc ul'), links = {};
  doc.querySelectorAll('nav.toc a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window && nav) {
    var cur = null;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var a = links[en.target.id];
        if (!a || a === cur) return;
        if (cur) cur.removeAttribute('aria-current');
        a.setAttribute('aria-current', 'true'); cur = a;
        var l = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
        if (nav.scrollTo) nav.scrollTo({ left: Math.max(0, l), behavior: 'smooth' });
      });
    }, { rootMargin: '-30% 0px -65% 0px' });
    Object.keys(links).forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  }

  // ---------- diagnosticador
  var chips = doc.querySelectorAll('.dg-chip'), sel = $('dg-select');
  function pick(id) {
    doc.querySelectorAll('.dg-panel').forEach(function (p) { p.hidden = p.getAttribute('data-dg') !== id; });
    chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-dg') === id ? 'true' : 'false'); });
    if (sel && sel.value !== id) sel.value = id;
    $('dg-empty').hidden = !!id;
  }
  chips.forEach(function (c) { c.addEventListener('click', function () { pick(c.getAttribute('data-dg')); }); });
  if (sel) sel.addEventListener('change', function () { pick(sel.value); });

  // ---------- revisor de workflows
  /*REVISOR*/
  var RULE = {}, IDS = D.rules.map(function (r) { RULE[r.id] = r; return r.id; });
  var RANK = { error: 0, warn: 1, info: 2 }, NAME = { error: 'error', warn: 'aviso', info: 'info' };
  function plural(nn, a, b) { return nn + ' ' + (nn === 1 ? a : b); }
  // js-yaml llega de cdnjs al abrir la página: así el service worker lo guarda para usarlo sin conexión.
  var yamlWait = null;
  function loadYaml(cb) {
    if (window.jsyaml) { cb(true); return; }
    if (yamlWait) { yamlWait.push(cb); return; }
    yamlWait = [cb];
    var s = doc.createElement('script');
    function done() { var l = yamlWait; yamlWait = null; s.onload = s.onerror = null; if (!window.jsyaml && s.parentNode) s.parentNode.removeChild(s); l.forEach(function (f) { f(!!window.jsyaml); }); }
    s.src = D.yamlUrl; s.async = true; s.crossOrigin = 'anonymous'; s.onload = done; s.onerror = done;
    doc.head.appendChild(s);
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function trigs(w) { var on = w.on !== undefined ? w.on : w['true']; return typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : isObj(on) ? Object.keys(on) : []; }
  var lastText = '';
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    lastText = text;
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega un workflow (el contenido de un archivo de <code>.github/workflows/</code>) y toca Revisar.</p>'; return; }
    if (!window.jsyaml) {
      out.innerHTML = '<p class="small">Cargando el lector de YAML…</p>';
      loadYaml(function (ok) {
        if (ok) review();
        else out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">No pude cargar el lector de YAML</p><p>El revisor usa js-yaml, que se baja de cdnjs la primera vez. Conéctate a internet y toca Revisar otra vez: después queda guardado y funciona sin conexión.</p></div>';
      });
      return;
    }
    var w;
    try { w = window.jsyaml.load(text); }
    catch (e) {
      var m = e && e.mark, where = m ? 'Línea ' + (m.line + 1) + ', columna ' + (m.column + 1) : '';
      out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">El YAML no es válido: no pude leerlo</p><p>' + (where ? '<b>' + where + ':</b> ' : '') + '<code>' + esc((e && e.reason) || String(e)) + '</code></p>' + (m && m.snippet ? '<pre class="rv-err__snip">' + esc(m.snippet) + '</pre>' : '') + '<p class="small">Mira la sangría (solo espacios, nunca tabs), los dos puntos después de cada clave y las comillas sin cerrar. GitHub rechazaría este archivo igual: el run aparecería con Invalid workflow file.</p></div>';
      return;
    }
    if (!isObj(w) || !isObj(w.jobs)) { out.innerHTML = '<p class="rv-sum" id="rv-sum" data-total="0" data-jobs="0">No parece un workflow: le falta <code>jobs:</code> (un mapa con un job por clave). Un workflow tiene al menos <code>on:</code> y <code>jobs:</code>.</p>'; return; }
    var found = revisar(w, IDS).filter(function (f) { return RULE[f.id]; });
    found.forEach(function (f) { f.line = ubicar(text, f); });
    found.sort(function (a, b) { return (RANK[RULE[a.id].severity] - RANK[RULE[b.id].severity]) || ((a.line || 0) - (b.line || 0)); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[RULE[f.id].severity]++; });
    var jobs = Object.keys(w.jobs), tr = trigs(w);
    var html = '<p class="rv-sum" id="rv-sum" data-total="' + found.length + '" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '" data-jobs="' + jobs.length + '">' +
      (found.length ? plural(found.length, 'hallazgo', 'hallazgos') + ': ' + plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + IDS.length + ' reglas encontró algo.') + '</p>' +
      '<p class="rv-objs">Revisé ' + (w.name ? 'el workflow «' + esc(w.name) + '»' : 'el workflow') + ': ' + plural(jobs.length, 'job', 'jobs') + ' (' + esc(jobs.join(', ')) + ')' + (tr.length ? ' · se dispara con ' + esc(tr.join(', ')) : ' · sin on:') + '.</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var r = RULE[f.id], where = [];
      where.push(f.job ? 'job <code>' + esc(f.job) + '</code>' : 'todo el workflow');
      if (f.step) where.push('paso ' + esc(f.step) + (f.stepLabel ? ' (<code>' + esc(String(f.stepLabel).slice(0, 70)) + '</code>)' : ''));
      if (f.line) where.push('<button class="rv-ln" type="button" data-line="' + f.line + '" title="Marcar la línea en el texto">línea ' + f.line + '</button>');
      if (f.detail && (!f.stepLabel || String(f.stepLabel).indexOf(f.detail) < 0)) where.push(esc(String(f.detail).slice(0, 140)));
      return '<li class="sev-' + r.severity + '" data-rule="' + r.id + '"' + (f.line ? ' data-line="' + f.line + '"' : '') + '><div class="rv-h"><span class="sev ' + r.severity + '">' + NAME[r.severity] + '</span><span class="rv-msg">' + esc(r.message) + '</span></div>' +
        '<p class="rv-obj">' + where.join(' · ') + '</p><p>' + esc(r.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(r.fix) + '</p></li>';
    }).join('') + '</ol>';
    out.innerHTML = html;
  }
  // marcar una línea del textarea
  $('rv-out').addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.rv-ln') : null;
    if (!b) return;
    var ta = $('rv-text'), n = +b.getAttribute('data-line'), lines = ta.value.split('\n'), start = 0;
    for (var i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[n - 1] || '').length;
    ta.focus();
    try { ta.setSelectionRange(start, end); } catch (e) {}
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (n - 4) * lh);
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
  });
  function setLabel(t, cls) { var l = $('rv-label'); l.textContent = t; l.className = 'rv-label' + (cls ? ' ' + cls : ''); }
  function load(k) { var s = D.samples[k]; $('rv-text').value = s.text; setLabel(s.label, s.cls); review(); }
  $('rv-run').addEventListener('click', function () { var t = $('rv-text').value; var cur = Object.keys(D.samples).filter(function (k) { return D.samples[k].text === t; })[0]; if (!cur) setLabel('Tu workflow', 'mine'); review(); });
  $('rv-bad').addEventListener('click', function () { load('bad'); });
  D.btns.forEach(function (b) { var el = $(b[0]); if (el) el.addEventListener('click', function () { load(b[1]); }); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tu workflow', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
  review();

  // ---------- quiz de errores
  var order = [], pos = 0;
  function shuffle() {
    order = D.errs.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    pos = 0;
  }
  function showQ() {
    var e = D.errs[order[pos]];
    $('q-count').textContent = 'Mensaje ' + (pos + 1) + ' de ' + D.errs.length;
    $('q-msg').textContent = e.msg;
    var a = $('q-ans');
    a.hidden = true;
    a.innerHTML = '<p class="tag">Qué significa</p><p>' + esc(e.meaning) + '</p><p class="tag">Corre primero</p><p>' + e.first + '</p><p class="tag">Dónde está</p><p><a href="#' + e.sec + '">' + esc(e.lab) + '</a></p>';
    $('q-show').disabled = false;
  }
  $('q-show').addEventListener('click', function () { $('q-ans').hidden = false; $('q-show').disabled = true; });
  $('q-next').addEventListener('click', function () { pos++; if (pos >= order.length) shuffle(); showQ(); });
  shuffle(); showQ();

  // ---------- búsqueda en la lista de errores
  var items = doc.querySelectorAll('.errlist > li'), q = $('err-q');
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  q.addEventListener('input', function () {
    var terms = norm(q.value.trim()).split(/\s+/).filter(Boolean), nn = 0;
    items.forEach(function (li) {
      var hay = li.getAttribute('data-q'), ok = terms.every(function (t) { return hay.indexOf(t) >= 0; });
      li.hidden = !ok; if (ok) nn++;
    });
    $('err-n').textContent = nn + ' de ' + items.length;
    $('err-none').hidden = nn > 0;
  });
})();`;
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const JS = JS_SRC.replace('/*DATA*/', () => jsonForScript(DATA)).replace('/*REVISOR*/', () => REVISOR_SRC);

// ================================================================ página
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de workflows']];
const TITLE = 'Cheat sheet de Git y GitHub Actions';
const HEAD = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS_ALL}</style>`;
// Versiones del pie: salen del contenido (la de la documentación, del pie de la tabla de bolsillo; la de los laboratorios,
// de sus notas). Si el contenido cambia, el pie cambia con él.
const GIT_DOCS = ((byId.bolsillo.figure.caption || '').match(/\bGit\s+(\d+\.\d+(?:\.\d+)?)/) || [])[1];
const GIT_LABS = [...new Set(ALL.filter((x) => x.lab && x.lab.verified === 'executed').map((x) => ((x.lab.verified_note || '').match(/\bgit\s+(\d+\.\d+(?:\.\d+)?)/i) || [])[1]).filter(Boolean))];
if (!GIT_DOCS) aviso('el pie no encontró la versión de Git de la documentación (en el pie de la tabla de bolsillo)');
if (GIT_LABS.length !== 1) aviso(`los laboratorios probados no dicen una sola versión de git: ${GIT_LABS.join(', ') || 'ninguna'}`);
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · CI/CD · ejemplos de C01</p>
    <h1>${TITLE}</h1>
    <p class="lead">Para trabajar en el repo del equipo sin miedo, escribir un workflow con la documentación abierta y diagnosticar un CI en rojo rápido. Git guarda tu trabajo en commits y ramas; GitHub lo revisa en pull requests; GitHub Actions lo prueba, construye la imagen y la despliega. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y un laboratorio opcional. En la versión web, al final hay un diagnosticador de síntomas, un revisor de workflows y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span></p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--accent)"></i>tú y tu máquina</span><span><i class="dot" style="background:var(--pu)"></i>GitHub y el remoto</span><span><i class="dot" style="background:var(--ink)"></i>automático (Actions)</span><span><i class="dot" style="background:var(--accent2)"></i>nuevo, avanza o seguro</span><span><i class="dot" style="background:var(--hi)"></i>espera o cambia</span><span><i class="dot" style="background:var(--warn)"></i>se pierde, reescribe o falla</span><span><i class="dot" style="border:1.6px dashed var(--muted)"></i>solo en el reflog</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>Comandos, campos y límites revisados en octubre de 2026 contra la documentación oficial: git-scm.com${GIT_DOCS ? ` (Git ${GIT_DOCS})` : ''}, docs.github.com (GitHub Actions, protección de ramas y OIDC), los README de las actions que se citan y la documentación de AWS (IAM, STS y ECR). Los laboratorios de git se probaron de verdad en una carpeta de prueba${GIT_LABS.length === 1 ? ` con git ${GIT_LABS[0]}` : ''}; los de GitHub Actions se verificaron contra la documentación. Si tu terminal dice otra cosa, créele a tu terminal. Los ejemplos salen de <code>reference/</code> del curso; los workflows son ilustrativos: el C01 no trae ninguno.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  writeFileSync(join(dir, 'revisor.js'), REVISOR_SRC + `\nvar REVISOR_IDS = ${JSON.stringify(W2.revisor.map((r) => r.id))};\nvar REVISOR_SAMPLES = ${jsonForScript(Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.text])))};\nif (typeof module !== 'undefined') module.exports = { revisar: revisar, ubicar: ubicar, REVISOR_IDS: REVISOR_IDS, REVISOR_SAMPLES: REVISOR_SAMPLES };\n`);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · diagnosticador ${W3.diagnosticador.length} síntomas · revisor ${W2.revisor.length} reglas (${RULE_IDS.length} implementadas) · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  return texN;
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}
function pdf(pagePath) {
  const out = join(HERE, '..', 'cheatsheet-git.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'git-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* no importa */ }
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('cheatsheet-git.pdf listo');
}

const mode = process.argv[2] || 'build';
if (mode === 'src') { writeSrc(process.argv[3] || join(HERE, 'out')); report(); }
else if (mode === 'build' || mode === 'pdf') {
  const out = join(HERE, 'out');
  writeSrc(out);
  const evalJs = "(async () => { for (let i = 0; i < 150 && !window.__math; i++) await new Promise(r => setTimeout(r, 100)); const errs = [...document.querySelectorAll('.katex-error')].map(e => e.getAttribute('title') || e.textContent).slice(0, 10); return JSON.stringify({ n: window.__math || 0, total: document.querySelectorAll('[data-tex]').length, errors: errs, html: document.querySelector('.wrap').outerHTML }); })()";
  const r = spawnSync('node', [join(APP, 'tools/browser-check.mjs'), '--url', join(out, 'src.html'), '--wait', '1500', '--timeout', '120000', '--light', '--eval', evalJs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lineE = (r.stdout || '').split('\n').find((l) => l.startsWith('[eval] '));
  if (!lineE) { console.error(r.stdout, r.stderr); throw new Error('sin resultado del render'); }
  const v = JSON.parse(JSON.parse(lineE.slice(7)));
  console.log('math', v.n, 'de', v.total, '· errores', v.errors.length, v.errors);
  (r.stdout || '').split('\n').filter((l) => !l.startsWith('[eval] ')).forEach((l) => l && console.log('  ' + l));
  if (v.n !== v.total || v.errors.length) throw new Error('hay fórmulas sin renderizar');
  const page = HEAD + '\n' + v.html + '\n<script>' + JS + '</script>';
  writeFileSync(join(out, 'artifact.html'), page);
  const pagePath = join(HERE, '..', 'cheatsheet-git.html');
  writeFileSync(pagePath, '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  if (mode === 'pdf') pdf(pagePath);
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src, build o pdf)'); process.exit(2); }
