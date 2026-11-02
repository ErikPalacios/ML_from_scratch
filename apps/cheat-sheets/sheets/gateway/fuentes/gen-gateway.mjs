// Genera "El gateway: FastAPI en producción", quinta hermana de las hojas de Docker, Kubernetes, Git y Triton
// (sheets/triton/fuentes/gen-triton.mjs, de donde sale este archivo): mismos tokens claro/oscuro, fuentes, hero, nav de
// chips, .pad con papel cuadriculado, fórmulas (KaTeX → MathML), tabla de piezas, ejemplo con botón de copiar (con
// resaltado de Python y de Dockerfile), "Cómo recordarla" / "Trampa", laboratorios plegados, chips del curso, CSS de
// impresión, diagnosticador, revisor (aquí, de código Python del gateway, con un escáner por líneas) y quiz.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal: casi todas son HTML que se acomoda solo (barras con
// anchos en %, grillas que pasan de columnas a filas); la del apagado es un SVG con una variante para el celular, alineada
// con la de la hoja de Kubernetes. A escala donde hay números: el presupuesto del request (ms), la línea de tiempo del
// event loop, los topes anidados y los reintentos, el apagado (s), los spans de la traza y lo medido en los laboratorios.
// Un color significa lo mismo en todas:
//   azul = CPU del gateway (decode, validar, Python) · ámbar = espera (red, cola, turno, un tope de tiempo) ·
//   verde azulado = la GPU (Triton) · verde = ok (2xx, termina bien) · violeta = rechazado a propósito (4xx o 503 con
//   Retry-After: el portero dice que no) · rojo = falla (500, 502, 504, se corta, SIGKILL) · gris = fuera del gateway.
//
// Uso:
//   node gen-gateway.mjs src <dir>   → <dir>/head.html, wrap.html, script.js, revisor.js y src.html (con KaTeX de cdnjs)
//   node gen-gateway.mjs build       → lo anterior en ./out, pasa [data-tex] a MathML estático con tools/browser-check.mjs
//                                      (de la app ml-system-design) y escribe out/artifact.html (para el Artifact de
//                                      claude.ai) y ../cheatsheet-gateway.html (la página del sitio y la fuente del PDF)
//   node gen-gateway.mjs pdf         → build y además ../cheatsheet-gateway.pdf (Chrome headless, A4)
//   node gen-gateway.mjs cmds        → muestra cómo se parte cada texto con comandos: [código copiable] «nota»
// El contenido está en content-w1/2/3.json de esta carpeta (GATEWAY_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, figuras que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // módulos del curso, browser-check.mjs y reference/c01
const CONTENT = process.env.GATEWAY_CONTENT ? resolve(process.env.GATEWAY_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C01_GW = join(APP, 'reference/c01/gateway');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AVISOS = [];
const aviso = (m) => { if (!AVISOS.includes(m)) AVISOS.push(m); };

// ---------------------------------------------------------------- utilidades (las de gen-triton.mjs)
const T = String.raw;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en memo, trap y en las notas: solo <b> y <code> (y entidades ya escritas, como &lt;); todo lo demás se escapa.
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>').replace(/&amp;(lt|gt|amp|quot|#39);/g, '&$1;');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (f) => `${r2(Math.max(0, Math.min(1, f)) * 100)}%`;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// 24532532 → 24,532,532 (el contenido usa coma de miles y punto decimal)
const fmtN = (x) => { const [i, d] = String(x).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
// {placeholder} → variable con aspecto de variable matemática; acepta puntos ({modelo.onnx}). No toca ${VAR} (bash),
// %{http_code} (curl -w), { mapas: con espacio } ni {"clave": …} (JSON y dicts de Python).
const PH = /(\$|@|%)?\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*(?:\.[\wÀ-ÖØ-öø-ÿ]+)*)\}/g;
const phs = (escaped) => escaped.replace(PH, (m, pre, name) => (pre === '$' || pre === '%' ? m : pre === '@' ? `@{<var class="ph">${name}</var>}` : `<var class="ph">${name}</var>`));
// Las flags (--workers, --timeout-graceful-shutdown) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
// Un número no se separa de su unidad al final de un renglón ("250 ms", "10 MB", "16 en vuelo" no: solo unidades).
const nbu = (h) => h.replace(/(\d) (s|ms|µs|min|h|días|GB|MB|KB|B|MiB|GiB|Gi|TB|%|vCPU|GPU|GPUs|MP|px|req\/s|Gb\/s|GB\/s|bytes|cores|hilos|pods|req)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
const tx = (s) => nbu(nbFlags(esc(s)));
const rx = (s) => nbu(nbFlags(rich(s)));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(nbFlags(esc(s)));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Símbolo de una variable (λ, t_CPU, q̂, t̄_bloqueo, c_ℓ, t_caller … t_cola, U(a, b), MAX_INFLIGHT…) → TeX para la tabla.
const GREEK = { α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', θ: '\\theta', λ: '\\lambda', μ: '\\mu', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\varphi', ω: '\\omega', Δ: '\\Delta', ℓ: '\\ell' };
const SUB_D = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUP_D = { '¹': '1', '²': '2', '³': '3' };
const texText = (s) => `\\text{${String(s).replace(/([&%$#_{}])/g, '\\$1')}}`;
function symTex(s) {
  const base = (h) => {
    let pre = '';
    if (h.length > 1 && h[0] === 'Δ') { pre = '\\Delta '; h = h.slice(1); }
    const m = h.match(/^(.)([\u0302\u0304]?)([¹²³]?)([₀-₉]*)$/u);
    if (m && !/\d/.test(m[1])) {
      let b = GREEK[m[1]] || m[1];
      if (m[2] === '\u0302') b = `\\hat{${b}}`;
      if (m[2] === '\u0304') b = `\\bar{${b}}`;
      if (m[3]) b += `^{${SUP_D[m[3]]}}`;
      if (m[4]) b += `_{${[...m[4]].map((c) => SUB_D[c]).join('')}}`;
      return pre + b;
    }
    return pre + texText(h);
  };
  const one = (p) => {
    p = p.trim();
    if (!p) return '';
    if (p.includes('…')) return p.split(/\s*…\s*/).map(one).join(' \\ldots ');
    if (p.includes(' × ')) return p.split(' × ').map((q) => (/^[\d.]+$/.test(q.trim()) ? q.trim() : one(q))).join(' \\times ');
    const mx = p.match(/^max\|(.+)\|$/);
    if (mx) return `\\max|${base(mx[1])}|`;
    if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(p) || (p.match(/_/g) || []).length >= 2) return `\\texttt{${p.replace(/_/g, '\\_')}}`;
    const fn1 = p.match(/^([A-Za-z])\((.+)\)$/); // U(a, b)
    if (fn1) return `${base(fn1[1])}(${fn1[2].split(/\s*,\s*/).map(one).join(',\\ ')})`;
    const i = p.indexOf('_');
    if (i > 0 && !/\s/.test(p.slice(0, i))) {
      const head = p.slice(0, i), sub = p.slice(i + 1);
      const fn = sub.match(/^(\w+)\((.+)\)$/);
      if (fn) return `${base(head)}_{\\text{${fn[1]}}}(${fn[2]})`;
      return `${base(head)}_{${[...sub].length === 1 ? (GREEK[sub] || sub) : texText(sub)}}`;
    }
    if (/\s/.test(p)) return texText(p);
    return base(p);
  };
  // separa por "," y "·" fuera de paréntesis: U(a, b) queda entero
  const parts = []; let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && (ch === ',' || ch === '·')) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(one).filter(Boolean).join(T`,\ `);
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
    else if (/[←-⇿✀-➿]/.test(ch)) w += k.wd;
    else w += k.ot;
  }
  return w * px * 1.02;
}

// ---------------------------------------------------------------- comandos: separar lo copiable de la nota
const CMD_WORDS = new Set(['git', 'kubectl', 'docker', 'aws', 'curl', 'echo', 'cat', 'grep', 'sed', 'test', 'python', 'python3', 'pip', 'pip3', 'pytest', 'cd', 'ls', 'export', 'jq', 'tail', 'head', 'uvicorn', 'gunicorn', 'fastapi', 'py-spy', 'locust', 'bash', 'top', 'find', 'mkdir', 'rm', 'source', 'df', 'printf', 'sort', 'wc', 'uniq', 'tr', 'lsof', 'file', 'kill', 'pkill', 'ps', 'opentelemetry-instrument', 'opentelemetry-bootstrap', 'hey', 'ab', 'wrk', 'openssl', 'nc', 'brew']);
// también "VAR=valor comando" (PYTHONASYNCIODEBUG=1 uvicorn …)
const isCmdWord = (w) => CMD_WORDS.has(w) || /^python3(\.\d+)?$/.test(w) || /^\.\/[\w.-]+/.test(w);
const firstCmd = (s) => { const ws = String(s).trim().split(/\s+/); let k = 0; while (k < ws.length - 1 && /^[A-Z_][A-Z0-9_]*=\S*$/.test(ws[k])) k++; return ws[k] || ''; };
const PROMQL = /^(?:sum|rate|irate|increase|histogram_quantile|avg|max|min|count)(?:\s+(?:by|without)\s*\([^)]*\))?\s*\(|^[a-z_:][a-z0-9_:]*\{/;
const CALL = /^[A-Za-z_][\w.]*\(/; // una llamada de Python: print(…), torch.cuda.memory_summary()
const CUTS = [' (', ' en ', ' y, ', ' y ', ' o ', ' contra ', ': ', ' → ', ' mientras ', ' para '];
// Un tramo que empieza con un comando (o con una expresión de PromQL o de Python) → { cmd, note }. Las comillas y los
// paréntesis no se cortan; una expresión termina en el primer espacio que no sigue con un operador.
function splitCmd(seg) {
  const s = String(seg).trim();
  if (/^[A-Z_][A-Z0-9_]*=\S+$/.test(s)) return { cmd: s, note: '' };
  const first = firstCmd(s);
  const expr = !isCmdWord(first) && (PROMQL.test(s) || CALL.test(s));
  if (!isCmdWord(first) && !expr) return null;
  let q = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (expr) {
      if (c !== ' ') continue;
      const rest = s.slice(i + 1), before = s.slice(0, i);
      const words = /^\((?:[A-Za-zÀ-ÿ¿?]+[\s,]+)+[A-Za-zÀ-ÿ¿?]+\)/.test(rest); // "(batch promedio)": texto, no código
      if (!words && (/^(?:\/|\*|\+|-\s|>|<|==|!=|and\b|or\b|by\b|without\b|\(|\[)/.test(rest) || /[/*+><=-]$/.test(before) || /\b(?:by|without)$/.test(before))) continue;
      return { cmd: before, note: s.slice(i) };
    }
    for (const cut of CUTS) {
      if (s.startsWith(cut, i)) {
        const cmd = s.slice(0, i), tail = (cmd.match(/[,;]$/) || [''])[0];
        return { cmd: cmd.slice(0, cmd.length - tail.length), note: tail + s.slice(i) };
      }
    }
  }
  return { cmd: s, note: '' };
}
const copyBtn = (text) => `<button class="cp" type="button"${text === undefined ? '' : ` data-copy="${esc(text)}"`}>Copiar</button>`;
const cmdChip = (c) => `<span class="cmdw"><code class="cmd">${esc(c)}</code>${copyBtn(c)}</span>`;
// La nota que sigue a un comando: si empezaba con ": " (el corte), pasa a " — " para no dejar dos puntos sueltos; si es
// " y <otro comando>" o " y, adentro, <otro comando>", ese otro comando también va como código copiable.
function cmdNote(n) {
  const m = String(n).match(/^(\s+[yo](?:,\s*[^,]{1,24},)?\s+)(.+)$/);
  if (m) { const c = splitCmd(m[2]); if (c) return `<span class="cmdn">${esc(m[1])}</span>${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`; }
  return `<span class="cmdn">${esc(String(n).replace(/^:\s+/, ' — '))}</span>`;
}
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando (o con "dónde: comando") se
// muestra como código copiable.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    let pre = '', body = seg;
    if (!splitCmd(seg)) { const m = seg.match(/^([^:()]{1,40}):\s+(.+)$/); if (m && splitCmd(m[2])) { pre = m[1] + ': '; body = m[2]; } }
    const c = splitCmd(body);
    if (!c) return esc(seg);
    return `${pre ? `<span class="cmdn">${esc(pre)}</span>` : ''}${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>');
}
// El cmd de una figura siempre es código (una ruta, una línea de Python): lo que no se reconoce como comando va entero
// como código copiable.
function codeChips(s) {
  if (!s) return '';
  return `<p class="cc">${String(s).split(' · ').map((seg) => {
    const c = splitCmd(seg);
    if (!c) return cmdChip(seg.trim());
    return `${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>')}</p>`;
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'image', 'run', 'logs', 'debug', 'get', 'describe', 'exec', 'top']);
const DF_INSTR = new Set(['FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL']);
function hlCode(seg, lang, st) {
  if (!seg) return '';
  if (lang === 'dockerfile') {
    if (st.atStart) {
      st.atStart = false;
      const m = seg.match(/^(\s*)([A-Za-z]+)(?=\s|$)/);
      if (m && DF_INSTR.has(m[2].toUpperCase())) {
        const rest = seg.slice(m[0].length).replace(/(\s)(AS)(?=\s)/, '$1\u0000$2\u0001');
        return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(rest).replace(/\u0000/g, '<span class="tk-k">').replace(/\u0001/g, '</span>');
      }
    }
    return esc(seg);
  }
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
          st.sub = /^(kubectl|docker|git|pip|pip3)$/.test(t) ? 2 : 0;
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
    if (c === '#' && lang !== 'dockerfile' && i > 0 && /\s/.test(line[i - 1])) {
      out += hlCode(buf, lang, st); buf = '';
      out += `<span class="tk-c">${esc(line.slice(i))}</span>`;
      i = line.length; break;
    }
    buf += c; i++;
  }
  return out + hlCode(buf, lang, st);
}
// Python: comentarios, strings (también los de triple comilla, que cruzan renglones) y palabras clave.
const PY_KW = new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'class', 'lambda', 'None', 'True', 'False', 'async', 'await', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal', 'assert', 'del']);
function hlPy(code) {
  const re = /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|\b[rRbBfFuU]{1,2}"(?:\\.|[^"\\\n])*"?|\b[rRbBfFuU]{1,2}'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|#[^\n]*|@[A-Za-z_][\w.]*|\b[A-Za-z_]\w*\b)/g;
  let out = '', last = 0, m;
  const s = String(code);
  while ((m = re.exec(s))) {
    const t = m[0];
    out += esc(s.slice(last, m.index));
    if (t[0] === '#') out += `<span class="tk-c">${esc(t)}</span>`;
    else if (t[0] === '@') out += `<span class="tk-d">${esc(t)}</span>`;
    else if (/^[rRbBfFuU]{0,2}["']/.test(t)) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (PY_KW.has(t)) out += `<span class="tk-k">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(s.slice(last));
}
// JSON (el body de un error, una línea de log): claves, strings y números.
function hlJson(code) {
  return esc(code).replace(/(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)/g, (m, str, colon, num) => {
    if (str) return colon ? `<span class="tk-k">${str}</span>${colon}` : `<span class="tk-s">${str}</span>`;
    return `<span class="tk-n">${num}</span>`;
  });
}
// El cuerpo de un heredoc de bash: Python si lo lee python o si va a un .py.
function heredocLang(ln) {
  if (/\bpython3?(?:\.\d+)?\s+-\s*<</.test(ln)) return 'python';
  const f = (ln.match(/>\s*(\S+)\s*<</) || ln.match(/>\s*(\S+)/) || [])[1] || '';
  return /\.py$/.test(f) ? 'python' : /\.ya?ml$/.test(f) ? 'yaml' : /dockerfile/i.test(f) ? 'dockerfile' : /\.json$/.test(f) ? 'json' : 'text';
}
const hlBody = (h) => (h.lang === 'python' ? hlPy(h.body.join('\n')) : h.lang === 'json' ? hlJson(h.body.join('\n')) : h.body.map((l) => hlLine(l, h.lang, { atStart: true, cmdPos: true, sub: 0 })).join('\n'));
function hl(code, lang) {
  if (lang === 'python') return hlPy(code);
  if (lang === 'json') return hlJson(code);
  const out = []; let cont = false, here = null;
  for (const ln of String(code).split('\n')) {
    if (here) {
      if (ln.trim() === here.end) { if (here.body.length) out.push(hlBody(here)); out.push(`<span class="tk-k">${esc(ln)}</span>`); here = null; cont = false; continue; }
      here.body.push(ln);
      continue;
    }
    const st = { atStart: !cont, cmdPos: !cont, sub: 0 };
    out.push(hlLine(ln, lang, st));
    cont = /\\\s*$/.test(ln) && !/^\s*#/.test(ln);
    if (lang === 'bash') {
      const h = ln.match(/<<-?\s*'?(\w+)'?/);
      if (h) here = { end: h[1], lang: heredocLang(ln), body: [] };
    }
  }
  if (here && here.body.length) out.push(hlBody(here));
  return out.join('\n');
}
const LANG = { python: 'Python', bash: 'bash · zsh', text: 'texto', json: 'JSON', yaml: 'YAML', dockerfile: 'Dockerfile' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- códigos HTTP: un color por clase
// ok = 2xx · rechazado a propósito = 4xx y 503 (con Retry-After: «ahora no») · falla = 500, 502, 504 y demás 5xx.
const codeClass = (c) => { c = +c; return c < 400 ? 'ok' : c < 500 || c === 503 ? 'rej' : 'fail'; };
const hcChip = (c) => `<span class="hc hc--${codeClass(c)}">${c}</span>`;
// Dentro de un texto ya escapado: cada código HTTP (100–599) que no es una cantidad ("150 ms", "500 valores") → chip.
// Solo los códigos registrados (RFC 9110 y 6585) más el 499 de nginx: un "150" o un "250" sueltos son tiempos. No toca
// 1,554 ni 0.503 (la coma de miles y el punto decimal no son separadores) ni un número seguido de su unidad.
const HTTP_CODES = new Set([200, 201, 202, 204, 206, 400, 401, 403, 404, 405, 406, 408, 409, 410, 411, 413, 414, 415, 416, 421, 422, 425, 428, 429, 431, 451, 499, 500, 501, 502, 503, 504, 505, 511]);
const CODE_RE = /(^|[\s(>;·→=])([1-5]\d\d)(?![.,]\d)(?!(?:\s|&nbsp;)*(?:ms|s|µs|MB|KB|MP|px|%|req|bytes|valores|requests|clientes|fotos|B)(?![\wÀ-ÿ]))(?=$|[\s),;:.·+]|&nbsp;)/g;
const codeify = (h) => h.replace(CODE_RE, (m, pre, c) => (HTTP_CODES.has(+c) ? `${pre}${hcChip(c)}` : m));

// ---------------------------------------------------------------- tablas HTML (se apilan en el celular)
function dataTable(head, rows, { cls = '', mono = [], cmd = [], codes = [], colCls = [] } = {}) {
  const cell = (v, j) => {
    let content = cmd.includes(j) ? cmdHtml(v) : tx(v);
    if (codes.includes(j)) content = codeify(content);
    const k = j > 0 && head[j] ? ` data-k="${esc(head[j])}"` : '';
    const c = [j === 0 ? 'rh' : '', mono.includes(j) ? 'mono' : '', cmd.includes(j) ? 'cmdc' : '', codes.includes(j) ? 'codes' : '', /^[—–-]$/.test(String(v).trim()) ? 'nil' : '', colCls[j] || ''].filter(Boolean).join(' ');
    return j === 0 ? `<th scope="row"${c ? ` class="${c}"` : ''}>${content}</th>` : `<td${k}${c ? ` class="${c}"` : ''}>${content}</td>`;
  };
  return `<div class="tblw"><table class="dt stk ${cls}"><thead><tr>${head.map((h, j) => `<th scope="col"${colCls[j] ? ` class="tier ${colCls[j]}"` : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
}
// columnas donde un número es un código HTTP (por el encabezado)
const codeCols = (head) => head.map((h, j) => (/^(?:Código|Códigos|Al vencer|Si está llena|En el C01|Responde)$/i.test(String(h).trim()) ? j : -1)).filter((j) => j >= 0);
const noteP = (s) => (s ? `<p class="fig__note">${rx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${rx(x)}</li>`).join('')}</ul>` : '');

// ---------------------------------------------------------------- SVG (solo el apagado; mismos trazos que la hoja de Kubernetes)
let SVG_N = 0;
const svgFig = (W, H, body, label, cls, maxW) => `<svg class="chart ${cls}" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet" style="max-width:${maxW}px">${body}</svg>`;
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(h)}" class="${cls}" ${extra}/>`;
const path = (d, cls = 's-muted', extra = '') => `<path d="${d}" class="${cls}" fill="none" ${extra}/>`;
const numMark = (x, y, k, cls = 'f-ink') => `<circle cx="${r1(x)}" cy="${r1(y)}" r="9" class="${cls}"/>` + txt(x, y + 4, String(k), 'tnum', 'middle');

// ---------------------------------------------------------------- piezas comunes de las figuras
const msR = (a) => (Array.isArray(a) ? a : [a, a]).map(Number);
const fmtR = ([a, b]) => (a === b ? fmtN(a) : `${fmtN(a)}–${fmtN(b)}`);
// "503 + Retry-After: 1", "415 · 413", "413 (> 40 MP) · 400" → chips con su resto de texto
function codesHtml(s) {
  return String(s || '').split(/\s+·\s+/).filter(Boolean).map((part) => {
    const m = part.match(/^([1-5]\d\d)\b\s*(.*)$/);
    return m ? `<span class="hcw">${hcChip(m[1])}${m[2] ? `<span class="hc__x">${tx(m[2])}</span>` : ''}</span>` : `<span class="hcw"><span class="hc__x">${tx(part)}</span></span>`;
  }).join('');
}
// Eje de tiempo con posiciones en %; en el celular se ve una etiqueta de cada dos. La unidad la dice la figura (en su
// título o en su leyenda): pegada a un número, chocaba con el siguiente en 375 px.
const axisHtml = (ticks, X, unit, cls = '') => `<div class="tax ${cls}" aria-hidden="true">${ticks.map((t, i) => `<span class="${[i === 0 ? 'is-0' : i === ticks.length - 1 ? 'is-n' : '', i % 2 ? 'is-odd' : ''].filter(Boolean).join(' ')}" style="left:${X(t)}%">${fmtN(t)}</span>`).join('')}</div>`;
// El mesero (el event loop) y el portero (el control de admisión): dibujos chicos para recordar las figuras.
const ICON_WAITER = '<svg class="ic ic--waiter" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="3"/><path d="M4.5 22v-8.5a4.5 4.5 0 0 1 9 0V22"/><path class="ic__l" d="M13.5 13.5h5.5"/><path d="M15 12.6a2.8 2.8 0 0 1 5.6 0z"/></svg>';
const ICON_DOOR = '<svg class="ic ic--door" viewBox="0 0 54 40" aria-hidden="true"><circle cx="9" cy="7" r="4"/><path d="M3 38V20a6 6 0 0 1 12 0v18"/><path class="ic__l" d="M14 22l7-4"/><rect class="ic__sign" x="20" y="5" width="33" height="15" rx="2"/><text x="36.5" y="15.4" text-anchor="middle">LLENO</text></svg>';
const ICON_KITCHEN = '<svg class="ic ic--kitchen" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10a5 5 0 0 1 10 0"/><path d="M5 10h14v3H5z"/><path d="M8 13v8M16 13v8M12 3v3"/></svg>';
const kindLeg = (kinds) => `<p class="kleg">${kinds.map((k) => ({
  cpu: '<span><i class="sw sw--cpu"></i>CPU del gateway</span>',
  io: '<span><i class="sw sw--io"></i>espera: red, cola o turno</span>',
  gpu: '<span><i class="sw sw--gpu"></i>la GPU (Triton)</span>',
  edge: '<span><i class="sw sw--edge"></i>fuera del gateway (ALB)</span>',
  ok: '<span><i class="sw sw--ok"></i>ok</span>',
  rej: '<span><i class="sw sw--rej"></i>rechazado a propósito (4xx o 503)</span>',
  fail: '<span><i class="sw sw--fail"></i>falla (500, 502, 504)</span>',
}[k] || '')).join('')}</p>`;

// ================================================================ figuras
// ↳ · La cadena: el camino de un request con el presupuesto del C01. Arriba, los p99 uno detrás del otro contra el SLO,
// el deadline y el timeout del caller (a escala); abajo, cada paso con su p50 y su p99 a escala y el código si falla.
function stepKind(s) {
  const w = `${s.label || ''} ${s.where || ''}`;
  if (/\bGPU\b|\bT4\b|Cómputo/i.test(w)) return 'gpu';
  if (/borde|\bALB\b/i.test(w)) return 'edge';
  if (/espera|\bcola\b|salto|red interna|\bVPC\b|lectura del body/i.test(w)) return 'io';
  return 'cpu';
}
function figRequestPath(d) {
  const st = d.steps || [], unit = d.unit || 'ms', tot = d.total || {};
  const inB = st.filter((s) => s.in_budget !== false);
  const sum = r1(inB.reduce((a, s) => a + msR(s.p99_ms)[1], 0));
  const p50 = [inB.reduce((a, s) => a + msR(s.p50_ms)[0], 0), inB.reduce((a, s) => a + msR(s.p50_ms)[1], 0)];
  if (tot.p99_pesimista_ms && Math.abs(sum - tot.p99_pesimista_ms) > 0.06 * tot.p99_pesimista_ms) aviso(`cadena: los p99 de los pasos suman ${sum} ${unit}, pero total dice ${tot.p99_pesimista_ms}`);
  if (tot.p50_ms && (Math.abs(p50[0] - msR(tot.p50_ms)[0]) > 3 || Math.abs(p50[1] - msR(tot.p50_ms)[1]) > 3)) aviso(`cadena: los p50 suman ${fmtR(p50)} ${unit}, pero total dice ${fmtR(msR(tot.p50_ms))}`);
  const marks = [['SLO', d.slo_ms], ['deadline del gateway', d.deadline_ms], ['timeout del caller', d.caller_timeout_ms]].filter((m) => +m[1] > 0).sort((a, b) => a[1] - b[1]);
  const span = Math.max(sum, ...marks.map((m) => +m[1]));
  const X = (v) => r2((v / span) * 100);
  let acc = 0;
  const segs = st.map((s, i) => {
    const w = msR(s.p99_ms)[1];
    if (s.in_budget === false || !(w > 0)) return '';
    const left = acc; acc += w;
    const phone = (w / span) * 290 >= 15, wide = (w / span) * 980 >= 16; // el eje mide ≈ 290 px en un celular y ≈ 1,000 en una pantalla grande
    return `<span class="rq__seg rq--${stepKind(s)}" style="left:${X(left)}%;width:${X(w)}%" title="${esc(`${i + 1} · ${s.label}: p99 ${fmtR(msR(s.p99_ms))} ${unit}`)}">${phone ? `<b>${i + 1}</b>` : wide ? `<b class="rq__wd">${i + 1}</b>` : ''}</span>`;
  }).join('');
  const ticks = []; for (let t = 50; t < span; t += 50) ticks.push(`<span class="rq__tk" style="left:${X(t)}%"></span>`);
  const mk = marks.map(([name, v], k) => `<span class="rq__ml" style="left:${X(v)}%;height:${42 + k * 19}px"></span><span class="rq__mt" style="right:${r2(100 - X(v))}%;top:${32 + k * 19}px">${esc(name)} <b>${fmtN(v)}&nbsp;${esc(unit)}</b></span>`).join('');
  const aria = `Los p99 de los pasos suman ≈ ${sum} ${unit}; ${marks.map(([n, v]) => `${n} ${v} ${unit}`).join(', ')}.`;
  // los pasos que no entran en la suma (la espera de un slot: un tope, no una medida), dichos con su número
  const outs = st.map((s, i) => [s, i]).filter(([s]) => s.in_budget === false).map(([s, i]) => `«${esc(s.label)}» (paso ${i + 1})`);
  const budget = `<div class="rq__bud"><p class="rq__bh">Los p99 de los pasos, uno detrás del otro: <b>≈&nbsp;${fmtN(tot.p99_pesimista_ms || sum)}&nbsp;${esc(unit)}</b>${tot.p50_ms ? ` · en el p50, ${fmtR(msR(tot.p50_ms))}&nbsp;${esc(unit)}` : ''}</p>
    <div class="rq__bw" style="height:${32 + marks.length * 19 + 4}px" role="img" aria-label="${esc(aria)}"><div class="rq__bar">${segs}${ticks.join('')}</div>${mk}<span class="rq__z">0</span></div>
    <p class="rq__bn">A escala, de 0 a ${fmtN(span)}&nbsp;${esc(unit)}; cada color es un paso de la lista, con su número.${outs.length ? ` ${cap(outs.join(' y '))} no entra en la suma: es un tope, no una medida.` : ''}</p></div>`;
  // cada paso: barra de 0 al mayor p99 (≈ 50 ms), con el rango del p50 (lleno) y el del p99 (rayado)
  const sMax = Math.max(1, ...st.map((s) => msR(s.p99_ms)[1]));
  const Y = (v) => r2((v / sMax) * 100);
  const range = (r, cls) => { const [a, b] = r; return `<span class="${cls}" style="left:${Y(a)}%;width:calc(${Y(Math.max(0, b - a))}% + 3px)"></span>`; };
  const items = st.map((s, i) => {
    const k = stepKind(s), micro = !!s.micro, out = s.in_budget === false;
    const vals = micro ? '<p class="rq__v"><span class="rq__mu">µs</span> microsegundos: no se ve a esta escala</p>'
      : `<div class="rq__trk${out ? ' rq__trk--out' : ''}" aria-hidden="true">${range(msR(s.p99_ms), 'rq__p99')}${range(msR(s.p50_ms), 'rq__p50')}</div><p class="rq__v"><span>p50 <b>${fmtR(msR(s.p50_ms))}</b></span><span>p99 <b>${fmtR(msR(s.p99_ms))}</b>&nbsp;${esc(unit)}</span>${out ? '<span class="rq__out">tope, fuera de la suma</span>' : ''}</p>`;
    return `<li class="rq__s rq--${k}${micro ? ' rq--micro' : ''}"><span class="rq__no" aria-hidden="true">${i + 1}</span>
      <div class="rq__a"><p class="rq__l">${esc(s.label)}</p><p class="rq__w">${tx(s.where)}</p></div>
      <div class="rq__b">${vals}${s.fail ? `<p class="rq__f"><span class="k">Si no pasa:</span> ${codesHtml(s.fail)}</p>` : ''}${s.note ? `<p class="rq__n">${tx(s.note)}</p>` : ''}</div></li>`;
  }).join('');
  return `${budget}<p class="rq__sh">Paso a paso: barras a escala de 0 a ${fmtN(sMax)}&nbsp;${esc(unit)} · <i class="sw sw--p50"></i>p50 · <i class="sw sw--p99"></i>p99</p><ol class="rq__st">${items}</ol>${kindLeg(['edge', 'cpu', 'io', 'gpu', 'rej', 'fail'])}`;
}

// 3 · El event loop: un mesero para todas las mesas. Arriba, quién trabaja (el loop y los hilos); abajo, cada request
// (su espera y cuándo recibe la respuesta). Mismo eje en ms para los dos escenarios.
const ELB = { mal: 'Un solo mesero (el event loop) atiende todas las mesas. Si se pone a cocinar (un decode dentro de async def), ninguna mesa avanza: ni siquiera /healthz.', bien: 'El mesero manda el plato a la cocina (los hilos del threadpool) y sigue atendiendo: /healthz responde al instante.' };
function figEventLoop(d) {
  const scs = d.scenarios || [], unit = d.unit || 'ms';
  const all = scs.flatMap((sc) => [...(sc.spans || []).map((s) => +s.end), ...(sc.waits || []).map((w) => +w.end), ...Object.values(sc.done || {}).map(Number)]);
  const maxT = Math.max(10, ...all), stp = maxT <= 100 ? 10 : maxT <= 220 ? 20 : 50;
  const T = Math.ceil((maxT * 1.06) / stp) * stp;
  const X = (t) => r2((Math.max(0, Math.min(T, t)) / T) * 100);
  const ticks = []; for (let t = 0; t <= T + 1e-9; t += stp) ticks.push(t);
  const arrive = (who) => +(d[`${who}_arrives_ms`] || 0);
  const axis = `<span></span>${axisHtml(ticks, X, unit, 'el__ax')}<span></span>`;
  const grid = ticks.map((t) => `<span class="el__gl" style="left:${X(t)}%"></span>`).join('');
  const sc = (s) => {
    const bad = /^mal/i.test(s.id || '') || /^Mal\b/.test(s.label || '');
    const spans = s.spans || [], waits = s.waits || [], done = s.done || {};
    const lanes = s.lanes || [...new Set(spans.map((x) => x.lane))];
    const who = Object.keys(done);
    const blk = (x) => /bloquea/i.test(x.what || '');
    if (done.healthz !== undefined && s.healthz_latency_ms !== undefined && Math.abs(done.healthz - arrive('healthz') - s.healthz_latency_ms) > 0.5) aviso(`event-loop: en "${s.label}" healthz termina a los ${done.healthz} y llega a los ${arrive('healthz')}, pero healthz_latency_ms dice ${s.healthz_latency_ms}`);
    const laneRow = (ln) => {
      const mine = spans.filter((x) => x.lane === ln);
      const isLoop = /event loop/i.test(ln);
      const blocked = isLoop && mine.some(blk);
      const body = mine.map((x) => (x.end > x.start
        ? `<span class="el__sp${blk(x) ? ' el__sp--blk' : ''}" style="left:${X(x.start)}%;width:${r2(X(x.end) - X(x.start))}%" title="${esc(`${x.who}: ${x.what} (${x.start}–${x.end} ${unit})`)}"><span>${esc(x.who)}</span></span>`
        : `<span class="el__pt" style="left:${X(x.start)}%" title="${esc(`${x.who}: ${x.what} (${x.start} ${unit})`)}"><b aria-hidden="true">✓</b><span>${esc(x.who)}</span></span>`)).join('');
      return `<p class="el__ln${blocked ? ' el__ln--blk' : ''}">${isLoop ? ICON_WAITER : ICON_KITCHEN}<span>${esc(ln)}<small>${isLoop ? (blocked ? 'el mesero, cocinando' : 'el mesero') : 'la cocina'}</small></span></p><div class="el__trk${blocked ? ' el__trk--blk' : ''}">${grid}${body}</div><span></span>`;
    };
    // cada request: su espera (ámbar), su CPU (azul) y cuándo recibe la respuesta; los ms, en su propia columna
    const reqRow = (w) => {
      const a = arrive(w), e = +done[w], lat = r1(e - a);
      const own = spans.filter((x) => x.who === w && x.end > x.start).map((x) => `<span class="el__own${blk(x) ? ' el__own--blk' : ''}" style="left:${X(x.start)}%;width:${r2(X(x.end) - X(x.start))}%" title="${esc(`${w}: ${x.what}`)}"></span>`).join('');
      const wt = waits.filter((x) => x.who === w).map((x) => `<span class="el__wt" style="left:${X(x.start)}%;width:${r2(Math.max(0, X(x.end) - X(x.start)))}%" title="${esc(`${w}: ${x.what} (${x.start}–${x.end} ${unit})`)}"></span>`).join('');
      return `<p class="el__ln el__ln--rq"><code>${esc(w)}</code></p><div class="el__trk el__trk--rq">${grid}<span class="el__base" style="left:${X(a)}%;width:${r2(Math.max(0, X(e) - X(a)))}%"></span>${own}${wt}<span class="el__dn" style="left:${X(e)}%" aria-hidden="true">✓</span></div><span class="el__lat">${fmtN(lat)}&nbsp;${esc(unit)}</span>`;
    };
    const meas = (d.measured || {})[s.id];
    const aria = `${s.label}. ` + who.map((w) => `${w} responde a los ${done[w]} ${unit}`).join(', ') + '.';
    return `<div class="el__sc${bad ? ' el--bad' : ' el--good'}"><p class="el__h"><span class="el__bd" aria-hidden="true">${bad ? '✗' : '✓'}</span><span>${esc(s.label)}</span></p>
      ${ELB[s.id] ? `<p class="el__meta">${esc(ELB[s.id])}</p>` : ''}
      <div class="el__g" role="img" aria-label="${esc(aria)}"><p class="el__gh">Quién trabaja</p>${lanes.map(laneRow).join('')}<p class="el__gh">Cada request: espera y respuesta<span>tarda</span></p>${who.map(reqRow).join('')}${axis}</div>
      ${meas ? `<p class="el__ms"><span class="k">Medido en el laboratorio:</span> ${Object.entries(meas).map(([k, v]) => `<code>${esc(k)}</code>&nbsp;${fmtN(v)}`).join(' · ')}&nbsp;${esc(unit)}</p>` : ''}</div>`;
  };
  const note = (d.measured || {}).note;
  return `<div class="el">${scs.map(sc).join('')}</div>${note ? `<p class="fig__note">${tx(note)}.</p>` : ''}<p class="kleg"><span><i class="sw sw--cpu"></i>CPU: el decode</span><span><i class="sw sw--blk"></i>CPU dentro del event loop: bloquea a todos</span><span><i class="sw sw--io"></i>espera: a Triton, a un slot o a su turno</span><span><i class="sw sw--done"></i>recibe la respuesta</span><span>eje en ${esc(unit)}, a escala</span></p>`;
}

// 4 · Qué código devuelve el C01, en su orden real: cada pregunta solo si pasaron las anteriores.
const whoCls = (w) => (/^FastAPI$/i.test(w) ? 'fw' : /preprocess|decode/i.test(w) ? 'cpu' : /_infer/.test(w) ? 'gpu' : 'gw');
function figStatus(d) {
  const nodes = d.nodes || [];
  const items = nodes.map((n, i) => {
    const no = n.no || {};
    const ra = no.retry_after ? `<span class="hdr">Retry-After: ${esc(no.retry_after)}</span>` : '';
    const cost = String(n.cost || '').trim();
    return `<li class="st__n st--${whoCls(no.who || '')}"><div class="st__q"><span class="st__k" aria-hidden="true">${i + 1}</span><p class="st__a">${tx(n.ask)}</p>${cost && !/^[—–-]$/.test(cost) ? `<span class="st__c" title="lo que cuesta esta revisión">${tx(cost)}</span>` : ''}</div>
      <div class="st__x"><span class="st__no">no →</span>${String(no.code || '').split(/\s*·\s*/).filter(Boolean).map(hcChip).join('')}${ra}${no.who ? `<code class="st__who">${esc(no.who)}</code>` : ''}${no.note ? `<span class="st__nt">${tx(no.note)}</span>` : ''}</div></li>`;
  }).join('');
  const end = d.end ? `<p class="st__end"><span class="st__yes">sí a todo →</span>${hcChip(d.end.code || 200)}${d.end.note ? `<span class="st__nt">${tx(d.end.note)}</span>` : ''}</p>` : '';
  const els = (d.elsewhere || []).length ? `<div class="st__else"><p class="st__eh">Fuera de este árbol</p><ul>${d.elsewhere.map((e) => `<li>${hcChip(e.code)}<span>${tx(e.note)}</span></li>`).join('')}</ul></div>` : '';
  return `${d.start ? `<p class="st__in"><span aria-hidden="true">↓</span> ${tx(d.start)}</p>` : ''}<ol class="st">${items}</ol>${end}${els}
    <p class="kleg"><span><i class="sw sw--ok"></i>ok</span><span><i class="sw sw--rej"></i>rechazado a propósito: 4xx o 503 (con <code>Retry-After</code>, «vuelve en un momento»)</span><span><i class="sw sw--fail"></i>falla: se acabó el tiempo o un bug</span><span><span class="st__c">µs</span>lo que cuesta esa revisión</span></p>`;
}

// 5 · Timeouts: los topes anidados a escala, un request que agota el plazo, reintentos con backoff y jitter, y la
// amplificación de reintentos entre capas.
function figTimeouts(d) {
  const B = [...(d.budgets || [])], unit = d.unit || 'ms';
  for (let i = 1; i < B.length; i++) if (!(B[i].ms < B[i - 1].ms)) aviso(`timeouts: el tope "${B[i].name}" (${B[i].ms}) no es menor que el de afuera (${B[i - 1].ms})`);
  const maxB = Math.max(1, ...B.map((b) => +b.ms));
  const X = (v) => r2((Math.max(0, Math.min(maxB, v)) / maxB) * 100);
  const n = B.length;
  const doll = B.map((b, i) => `<span class="to__d" style="width:${X(b.ms)}%;--k:${n > 1 ? r2(i / (n - 1)) : 1}"></span>`).join('');
  // etiquetas al final de cada tope, de adentro hacia afuera, una por renglón
  const inner = [...B].sort((a, b) => a.ms - b.ms);
  const lab = inner.map((b, k) => `<span class="to__ml" style="left:${X(b.ms)}%;height:${38 + k * 19}px"></span><span class="to__mt" style="right:${r2(100 - X(b.ms))}%;top:${30 + k * 19}px">${esc(String(b.name).replace(/\s*\(.*\)\s*$/, ''))} <b>${fmtN(b.ms)}</b></span>`).join('');
  const nest = `<div class="to__nest"><p class="to__h">Topes anidados, a escala (de 0 a ${fmtN(maxB)}&nbsp;${esc(unit)})</p><div class="to__dw" style="height:${30 + n * 19 + 6}px" role="img" aria-label="${esc(B.map((b) => `${b.name}: ${b.ms} ${unit}`).join('; '))}"><div class="to__dl">${doll}</div>${lab}</div>
    <ul class="to__list">${B.map((b, i) => `<li><i class="to__sw" style="--k:${n > 1 ? r2(i / (n - 1)) : 1}"></i><p><b>${tx(b.name)}</b> · ${fmtN(b.ms)}&nbsp;${esc(unit)}</p><p class="to__w"><span class="k">Dónde:</span> ${tx(b.where)}</p><p class="to__w"><span class="k">Al vencer:</span> ${codeify(tx(b.expires))}</p></li>`).join('')}</ul></div>`;
  // un request del lab
  const ex = d.example_request;
  let exHtml = '';
  if (ex) {
    const st = ex.steps || [];
    const dl = B.find((b) => /deadline/i.test(b.name)), tri = B.find((b) => /Triton/i.test(b.name) && !/cola/i.test(b.name));
    const kindOf = (s) => (/decode|preproces/i.test(s.name) ? 'cpu' : 'io');
    const bars = st.map((s) => `<span class="to__xs to--${kindOf(s)}" style="left:${X(s.start_ms)}%;width:${r2(X(s.start_ms + s.ms) - X(s.start_ms))}%" title="${esc(`${s.name}: ${s.ms} ${unit}`)}">${(s.ms / maxB) * 290 >= 44 ? `<span>${esc(String(s.name).split(':')[0])}</span>` : ''}</span>`).join('');
    const last = st[st.length - 1];
    const ghost = tri && last && /Triton/i.test(last.name) ? `<span class="to__gh" style="left:${X(last.start_ms + last.ms)}%;width:${r2(X(last.start_ms + (+tri.ms)) - X(last.start_ms + last.ms))}%" title="${esc(`los ${tri.ms} ${unit} que hubiera tenido`)}"></span>` : '';
    const cut = dl ? `<span class="to__cut" style="left:${X(dl.ms)}%"></span><span class="to__cutl" style="right:${r2(100 - X(dl.ms))}%">deadline ${fmtN(dl.ms)}</span>` : '';
    exHtml = `<div class="to__ex"><p class="to__h">${tx(cap(ex.label || 'un request'))}</p><div class="to__xw" role="img" aria-label="${esc(st.map((s) => `${s.name}: de ${s.start_ms} a ${s.start_ms + s.ms} ${unit}`).join('; '))}">${bars}${ghost}${cut}</div>
      <ul class="to__xl">${st.map((s) => `<li><i class="sw sw--${kindOf(s)}"></i>${tx(s.name)}${String(s.name).includes(String(s.ms)) ? '' : ` · ${fmtN(s.ms)}&nbsp;${esc(unit)}`}</li>`).join('')}${ghost ? `<li><i class="sw sw--ghost"></i>los ${fmtN(tri.ms)}&nbsp;${esc(unit)} que hubiera tenido Triton</li>` : ''}</ul>
      ${ex.result ? `<p class="to__res">${codeify(tx(ex.result))}</p>` : ''}</div>`;
  }
  // reintentos: ventanas de espera (backoff exponencial) y cuándo vuelve cada cliente con full jitter
  const R = d.retries;
  let rtHtml = '';
  if (R) {
    const nj = R.no_jitter_at_ms || [], cl = R.clients_full_jitter_at_ms || [], mw = R.max_wait_ms || [];
    const tMax = Math.max(1, ...nj, ...cl.flatMap((c) => c.at_ms || []));
    const rs = tMax <= 400 ? 50 : tMax <= 900 ? 100 : 200;
    const TR = Math.ceil((tMax * 1.08) / rs) * rs;
    const Z = (t) => r2((Math.max(0, Math.min(TR, t)) / TR) * 100);
    let prev = 0;
    nj.forEach((t, k) => { if (mw[k] !== undefined && Math.abs(t - prev - mw[k]) > 0.5) aviso(`reintentos: sin jitter, el intento ${k + 1} sale a los ${t} y la espera máxima es ${mw[k]}`); prev = t; });
    const gl = []; for (let t = 0; t <= TR + 1e-9; t += rs) gl.push(t);
    const grid = gl.map((t) => `<span class="el__gl" style="left:${Z(t)}%"></span>`).join('');
    const storm = R.storm || {};
    const row = (label, inner, cls = '') => `<p class="rt__ln${cls}">${label}</p><div class="rt__trk">${grid}${inner}</div>`;
    // sin jitter: la ventana de cada espera (se duplica) y, al final de cada una, todos los clientes a la vez
    let pj = 0;
    const njInner = nj.map((t, k) => {
      const win = `<span class="rt__win" style="left:${Z(pj)}%;width:${r2(Z(t) - Z(pj))}%" title="${esc(`espera ${k + 1}: ${t - pj} ${unit}`)}">${((t - pj) / TR) * 230 >= 26 ? `<span>${fmtN(r1(t - pj))}</span>` : ''}</span>`;
      pj = t;
      return `${win}<span class="rt__sp" style="left:${Z(t)}%" title="${esc(`intento ${k + 1}: todos a los ${t} ${unit}`)}"><b>${k + 1}</b></span>`;
    }).join('');
    const njRow = row(`sin jitter${storm.clients ? `<small>${fmtN(storm.clients)} clientes</small>` : ''}`, njInner, ' rt__ln--bad');
    // con full jitter: cada cliente vuelve en un momento al azar dentro de su ventana (los intentos pares, un poco más abajo)
    const clRows = cl.map((c) => {
      let p = 0;
      const inner = (c.at_ms || []).map((t, k) => {
        const w = mw[k] !== undefined ? +mw[k] : null;
        if (w !== null && t - p > w + 1e-6) aviso(`reintentos: ${c.name} vuelve a los ${t}, fuera de su ventana (${p} + ${w})`);
        p = t;
        return `<span class="rt__dot${k % 2 ? ' rt__dot--lo' : ''}" style="left:${Z(t)}%" title="${esc(`${c.name}, intento ${k + 1}: ${t} ${unit}`)}">${k + 1}</span>`;
      }).join('');
      return row(`${esc(c.name)}<small>full jitter</small>`, inner);
    }).join('');
    const ax = `<span></span>${axisHtml(gl, Z, unit)}`;
    const pk = storm.peak_no_jitter && storm.peak_full_jitter ? `<div class="rt__st"><p class="to__h">El pico de ${fmtN(storm.clients || '')} clientes${storm.window_ms ? ` en una ventana de ${fmtN(storm.window_ms)}&nbsp;${esc(unit)}` : ''}</p>
      <p class="rt__pk"><span>sin jitter</span><span class="rt__pt"><span class="rt__pb rt__pb--bad" style="width:${pct(storm.peak_no_jitter / storm.peak_no_jitter)}"></span></span><b>${fmtN(storm.peak_no_jitter)}</b></p>
      <p class="rt__pk"><span>full jitter</span><span class="rt__pt"><span class="rt__pb" style="width:${pct(storm.peak_full_jitter / storm.peak_no_jitter)}"></span></span><b>${fmtN(storm.peak_full_jitter)}</b></p>
      ${storm.windows_no_jitter && storm.windows_full_jitter ? `<p class="rt__wn">Ventanas con tráfico: ${fmtN(storm.windows_no_jitter)} sin jitter contra ${fmtN(storm.windows_full_jitter)} con jitter: la misma carga, repartida.</p>` : ''}</div>` : '';
    rtHtml = `<div class="rt"><p class="to__h">Reintentos: backoff exponencial${R.base_ms ? ` (base ${fmtN(R.base_ms)}&nbsp;${esc(unit)})` : ''} y full jitter</p>
      <div class="rt__g" role="img" aria-label="${esc(`Sin jitter, todos vuelven a los ${nj.join(', ')} ${unit}. ` + cl.map((c) => `${c.name}: ${(c.at_ms || []).join(', ')} ${unit}`).join('. '))}">${njRow}${clRows}${ax}</div>
      <p class="kleg"><span><i class="sw sw--win"></i>la espera máxima: ${mw.map((w) => fmtN(w)).join(', ')}&nbsp;${esc(unit)}, se duplica</span><span><i class="sw sw--spike"></i>sin jitter, todos vuelven a la vez</span><span><i class="sw sw--dot"></i>con full jitter, cada uno vuelve al azar, entre 0 y su espera máxima</span><span>eje en ${esc(unit)}, a escala</span></p>${pk}</div>`;
  }
  // amplificación entre capas: (1 + r)^capas intentos abajo por cada request de arriba
  const A = d.amplification;
  let ampHtml = '';
  if (A && A.layers && A.retries_per_layer !== undefined) {
    const per = 1 + (+A.retries_per_layer), L = +A.layers;
    if (A.attempts_at_bottom && per ** L !== +A.attempts_at_bottom) aviso(`amplificación: (1 + ${A.retries_per_layer})^${L} = ${per ** L}, pero attempts_at_bottom dice ${A.attempts_at_bottom}`);
    const rows = []; for (let k = 1; k <= L; k++) rows.push(per ** k);
    ampHtml = `<div class="amp"><p class="to__h">Amplificación: ${A.retries_per_layer} reintentos en cada una de ${L} capas</p><ol class="amp__rows"><li><span class="amp__k">arriba</span><span class="amp__dots"><i class="amp__u"></i></span><span class="amp__n">1 request</span></li>${rows.map((v, k) => `<li class="${k === rows.length - 1 ? 'amp--last' : ''}"><span class="amp__k">capa ${k + 1}</span><span class="amp__dots" aria-hidden="true">${'<i></i>'.repeat(v)}</span><span class="amp__n">(1 + ${A.retries_per_layer})${k ? `<sup>${k + 1}</sup>` : ''} = <b>${fmtN(v)}</b> intentos</span></li>`).join('')}</ol></div>`;
  }
  return `${nest}${exHtml}${rtHtml}${ampHtml}<p class="kleg"><span><i class="sw sw--io"></i>un tope de tiempo o una espera</span><span><i class="sw sw--cpu"></i>CPU del gateway</span><span><i class="sw sw--fail"></i>se corta: 504</span><span><i class="sw sw--rej"></i>rechazado: 503</span></p>`;
}

// 6 · Control de admisión: el portero con 16 lugares, los 2 slots de CPU y la cola de Triton; lo que midió el README y
// lo que dio el laboratorio (cola sin tope contra las puertas).
function figAdmission(d) {
  const G = d.gates || [];
  const gate = (g, i) => {
    const slots = +g.slots || 0;
    const sq = slots ? `<div class="ad__sl${slots <= 4 ? ' ad__sl--big' : ''}" role="img" aria-label="${slots} lugares">${'<i></i>'.repeat(slots)}</div>` : '';
    const timer = g.wait_ms ? `<p class="ad__tm"><span class="ad__tb" aria-hidden="true"></span>espera ≤ ${fmtN(g.wait_ms)}&nbsp;ms</p>` : '';
    const what = slots ? `${fmtN(slots)} ${slots === 1 ? 'lugar' : 'lugares'}${i === 0 ? ' por proceso' : ' a la vez'}` : 'sin lugares fijos: un tope de tiempo';
    return `<li class="ad__g"><div class="ad__gh"><span class="ad__no">${i + 1}</span><p class="ad__gn">${tx(cap(g.name))}</p>${i === 0 ? ICON_DOOR : ''}</div>
      ${sq}<p class="ad__tp">${what}</p>${timer}
      <p class="ad__r"><span class="k">Dónde:</span> ${tx(g.where)}</p>
      <p class="ad__r ad__fl"><span class="k">Si está llena:</span> ${codeify(tx(g.full))}${g.header ? ` <span class="hdr">${esc(g.header)}</span>` : ''}</p>
      ${g.cost ? `<p class="ad__r"><span class="k">Ya se gastó:</span> ${tx(g.cost)}</p>` : ''}</li>`;
  };
  const flow = `<div class="ad__flow"><p class="ad__end">llegan requests</p><ol class="ad__gates">${G.map(gate).join('')}</ol><p class="ad__end ad__end--gpu">la GPU</p></div>`;
  const M = d.measured || [];
  const meas = M.length ? `<div class="ad__m"><p class="to__h">Lo que midió el README del C01</p>${M.map((m) => {
    if (m.ok_200 + m.fast_503 !== m.arrivals) aviso(`admisión: "${m.label}" dice ${m.arrivals} llegadas, pero ${m.ok_200} + ${m.fast_503}`);
    return `<div class="ad__mr"><p class="ad__ml">${tx(m.label)}</p><p class="ad__u" role="img" aria-label="${esc(`${m.ok_200} con 200 y ${m.fast_503} con 503 rápido`)}">${'<i class="u--ok"></i>'.repeat(m.ok_200)}${'<i class="u--rej"></i>'.repeat(m.fast_503)}</p><p class="ad__mv"><span>${hcChip(200)} ${fmtN(m.ok_200)}</span><span>${hcChip(503)} ${fmtN(m.fast_503)} rápidos</span><span>p50 ${fmtN(m.p50_ms)}&nbsp;ms</span></p></div>`;
  }).join('')}</div>` : '';
  const S = d.simulation;
  const sim = S && (S.rows || []).length ? `<div class="ad__sim"><p class="to__h">${tx(cap(S.label || 'laboratorio'))}</p>${S.rows.map((r) => {
    const tot = r.on_time_pct + r.rejected_pct + r.late_pct;
    if (Math.abs(tot - 100) > 0.6) aviso(`admisión: "${r.strategy}" suma ${r2(tot)} %`);
    const seg = (v, cls, lab) => (v > 0 ? `<span class="ad__ss ${cls}" style="width:${pct(v / 100)}" title="${esc(`${lab}: ${v} %`)}">${v >= 12 ? `${fmtN(r1(v))}&nbsp;%` : ''}</span>` : '');
    return `<div class="ad__sr"><p class="ad__sl2"><b>${tx(cap(r.strategy))}</b></p><p class="ad__sb" role="img" aria-label="${esc(`${r.strategy}: ${r.on_time_pct} % a tiempo, ${r.rejected_pct} % rechazados, ${r.late_pct} % tarde`)}">${seg(r.on_time_pct, 'u--ok', 'a tiempo')}${seg(r.rejected_pct, 'u--rej', 'rechazados')}${seg(r.late_pct, 'u--fail', 'tarde')}</p>
      <p class="ad__sv"><span>p99 de los que llegan a tiempo: <b>${fmtN(r.p99_on_time_ms)}&nbsp;ms</b></span><span>pico en vuelo: <b>${fmtN(r.peak_in_flight)}</b></span><span>CPU gastada en respuestas tardías: <b>${fmtN(r.cpu_wasted_pct)}&nbsp;%</b></span></p></div>`;
  }).join('')}<p class="kleg"><span><i class="sw sw--ok"></i>a tiempo</span><span><i class="sw sw--rej"></i>rechazado rápido (503)</span><span><i class="sw sw--fail"></i>tarde: el caller ya se fue</span></p></div>` : '';
  return `${flow}${meas}${sim}`;
}

// 7 · La escalera de degradación: de arriba (normal) hacia abajo (servicio caído); el color va de ok a falla.
function figDegradation(d) {
  const S = d.steps || [], n = S.length;
  const items = S.map((s, i) => `<li class="lad__s" style="--k:${n > 1 ? r2(i / (n - 1)) : 0}"><span class="lad__no" aria-hidden="true">${i + 1}</span>
    <div class="lad__a"><p class="lad__n">${tx(s.name)}</p><p class="lad__t"><span class="k">Cuándo:</span> ${tx(s.trigger)}</p></div>
    <div class="lad__b"><p><span class="k">Qué hace:</span> ${tx(s.action)}</p><p><span class="k">El usuario ve:</span> ${tx(s.user_sees)}</p><p class="lad__g"><span class="k">El gateway responde:</span> ${codeify(tx(s.gateway))}</p></div></li>`).join('');
  return `<div class="lad"><div class="lad__rail" aria-hidden="true"><span>sano</span><span>caído</span></div><ol class="lad__l">${items}</ol></div>${d.rule ? `<p class="callout">${tx(d.rule)}</p>` : ''}${kindLeg(['ok', 'rej', 'fail'])}`;
}

// 8 · El apagado: los plazos a escala (preStop, drenado, margen y SIGKILL, como en la hoja de Kubernetes) y qué hace cada
// actor; los eventos van numerados en el dibujo y explicados abajo. SVG ancho y angosto.
const SPAN_KIND = (l) => (/preStop/i.test(l) ? 'pre' : /drena/i.test(l) ? 'drain' : 'margin');
function shutdownSvg(d, lanes, evs, W) {
  const narrow = W < 500, grace = +d.grace_s || 0;
  const T = Math.max(10, Math.ceil(Math.max(grace, ...evs.map((e) => e.t)) / 10) * 10);
  const X0 = narrow ? 90 : 132, X1 = W - 16;
  const x = (t) => X0 + (Math.max(0, Math.min(t, T)) / T) * (X1 - X0);
  const yb = 30, LH = 38, y0 = yb + 72;
  const yL = (i) => y0 + i * LH, yAx = yL(lanes.length - 1) + 24;
  let s = '';
  for (let t = 0; t <= T + 1e-9; t += 10) s += line(x(t), 8, x(t), yAx, 'grid');
  // la banda de plazos
  s += txt(10, yb + 4.5, narrow ? 'plazos' : 'los plazos', 'tm tb');
  (d.spans || []).forEach((sp) => {
    const k = SPAN_KIND(sp.label), a = +sp.from, b = +sp.to, w = x(b) - x(a);
    s += rect(x(a), yb - 11, w, 22, { pre: 'f-hi-soft s-hi', drain: 'f-ok-soft s-ok', margin: 'f-free s-rule' }[k], 'rx="3"');
    const full = String(sp.label), short = { pre: 'preStop', drain: 'drenado', margin: 'margen' }[k];
    const lab = !narrow && textW(full, 12.5) + 12 < w ? full : textW(short, 12.5, { bold: true }) + 8 < w ? short : '';
    if (lab) s += txt((x(a) + x(b)) / 2, yb + 4.5, lab, 'tl tb', 'middle');
  });
  if (grace) {
    s += line(x(grace), yb - 16, x(grace), yAx, 'l-kill');
    const yk = yb + 24;
    s += path(`M${r1(x(0))},${yk} V${yk + 6} H${r1(x(grace))} V${yk}`, 's-muted', 'stroke-width="1.3"');
    s += txt((x(0) + x(grace)) / 2, yk + 20, narrow ? `plazo de gracia: ${grace} s` : `plazo: terminationGracePeriodSeconds = ${grace} s`, 't tb', 'middle');
  }
  // un carril por actor, con sus eventos numerados (si dos caen encima, el segundo se corre y lo marca una línea)
  lanes.forEach((ln, i) => {
    const y = yL(i);
    s += line(x(0), y, x(Math.min(T, grace || T)), y, 'l-lane');
    // el nombre del carril, en dos renglones si no cabe antes del eje
    const words = String(ln).split(' ');
    if (textW(ln, 12, { bold: true }) > X0 - 16 && words.length > 1) {
      let k = words.length - 1;
      while (k > 1 && textW(words.slice(0, k).join(' '), 12, { bold: true }) > X0 - 16) k--;
      s += `<text x="10" y="${r1(y - 2)}" class="tm tb"><tspan x="10">${esc(words.slice(0, k).join(' '))}</tspan><tspan x="10" dy="14">${esc(words.slice(k).join(' '))}</tspan></text>`;
    } else s += txt(10, y + 4.5, ln, 'tm tb');
    let prevX = -99;
    evs.filter((e) => e.lane === ln).sort((a, b) => a.t - b.t).forEach((e) => {
      const xt = x(e.t), xm = Math.max(xt, prevX + 19);
      if (xm - xt > 1) s += path(`M${r1(xt)},${y} L${r1(xm)},${y - 9}`, 's-muted', 'stroke-width="1.2"');
      else s += `<circle cx="${r1(xt)}" cy="${y}" r="2.5" class="f-muted"/>`;
      s += numMark(xm, y - 12, e._n, /SIGKILL/.test(e.label) ? 'f-warn' : 'f-ink');
      prevX = xm;
    });
  });
  s += line(x(0), yAx, x(T), yAx, 'ax');
  for (let t = 0; t <= T + 1e-9; t += narrow ? 10 : 5) {
    s += line(x(t), yAx, x(t), yAx + 5, 'ax');
    if (t % 10 === 0) s += txt(x(t), yAx + 18, t >= T ? `${t} s` : String(t), 't', t >= T ? 'end' : 'middle');
  }
  return { s, H: yAx + 26 };
}
function figShutdown(d) {
  const lanes = d.lanes || [];
  const evs = (d.events || []).filter((e) => e && typeof e.t === 'number').map((e) => ({ ...e }));
  evs.forEach((e) => { if (!lanes.includes(e.lane)) { aviso(`apagado: carril desconocido "${e.lane}"`); lanes.push(e.lane); } });
  evs.sort((a, b) => a.t - b.t || lanes.indexOf(a.lane) - lanes.indexOf(b.lane)).forEach((e, i) => { e._n = i + 1; });
  const g = +d.grace_s, p = +d.prestop_s, dr = +d.drain_max_s;
  if (g && p && dr && p + dr > g) aviso(`apagado: preStop ${p} s + drenado ${dr} s pasa la gracia de ${g} s`);
  const sp = d.spans || [];
  if (sp.length && Math.abs(Math.max(...sp.map((x) => +x.to)) - g) > 1e-6) aviso('apagado: los plazos no terminan en la gracia');
  const aria = `Apagado de un pod del gateway en segundos, a escala: ${sp.map((x) => `${x.label} de ${x.from} a ${x.to} s`).join(', ')}; SIGKILL a los ${g} s.`;
  const w = shutdownSvg(d, lanes, evs, 760), nw = shutdownSvg(d, lanes, evs, 330);
  const tfmt = (t) => `${fmtN(t)}&nbsp;s`;
  return `${svgFig(760, w.H, w.s, aria, 'fv-w', 860)}${svgFig(330, nw.H, nw.s, aria, 'fv-n', 470)}
    <ol class="kev">${evs.map((e) => `<li><span class="kev__n${/SIGKILL/.test(e.label) ? ' kev__n--kill' : ''}">${e._n}</span><span class="kev__t">${tfmt(e.t)}</span><span class="kev__x"><b>${esc(e.lane)}</b> · ${tx(e.label)}</span></li>`).join('')}</ol>
    <p class="kleg"><span><i class="sw sw--pre"></i>preStop: espera a que el ALB lo saque</span><span><i class="sw sw--drain"></i>drenado: termina lo que está en curso</span><span><i class="sw sw--margin"></i>margen</span><span><i class="sw sw--kill"></i>SIGKILL</span></p>`;
}

// 9 · Observabilidad: un request y lo que deja (la línea de log, las métricas y los spans de la traza, a escala); el
// request_id une los tres.
function figObservability(d) {
  const R = d.request || {}, id = String(R.request_id || '');
  const idHtml = (h) => (id ? h.split(esc(id)).join(`<mark class="ob__id">${esc(id)}</mark>`) : h);
  const head = `<p class="ob__rq"><span class="ob__m">${esc(R.method || 'POST')}</span><code>${esc(R.path || '')}</code>${R.status ? hcChip(R.status) : ''}${R.latency_ms !== undefined ? `<span class="ob__lat">${fmtN(R.latency_ms)}&nbsp;ms</span>` : ''}${id ? `<span class="ob__rid"><span class="k">request_id</span> <mark class="ob__id">${esc(id)}</mark></span>` : ''}</p>`;
  const lb = d.log_bytes || (d.log_line ? Buffer.byteLength(d.log_line) : 0);
  if (d.log_line && d.log_bytes && Math.abs(Buffer.byteLength(d.log_line) - d.log_bytes) > 2) aviso(`observabilidad: la línea de log mide ${Buffer.byteLength(d.log_line)} bytes, pero log_bytes dice ${d.log_bytes}`);
  const log = d.log_line ? `<section class="ob__p ob__log"><p class="ob__h"><span class="ob__k">1</span>Una línea de log${lb ? `<span class="ob__hs">${fmtN(lb)} bytes</span>` : ''}</p><pre class="ob__json">${idHtml(hlJson(d.log_line))}</pre></section>` : '';
  const met = (d.metrics || []).length ? `<section class="ob__p ob__met"><p class="ob__h"><span class="ob__k">2</span>Métricas: ${d.metrics.length} series suben</p><ul class="ob__ml">${d.metrics.map((m) => {
    const nm = String(m.name), suf = (nm.match(/_(total|bucket|count|sum)$/) || [])[0] || '';
    return `<li><p class="ob__mn"><code>${esc(nm.slice(0, nm.length - suf.length))}<span class="ob__suf">${esc(suf)}</span></code></p>${m.labels ? `<p class="ob__lb"><code>{${esc(m.labels)}}</code></p>` : ''}<p class="ob__ch">${tx(m.change)}</p></li>`;
  }).join('')}</ul></section>` : '';
  const S = [...(d.spans || [])].sort((a, b) => a.start_ms - b.start_ms || b.ms - a.ms);
  let tr = '';
  if (S.length) {
    const tot = Math.max(...S.map((x) => x.start_ms + x.ms));
    const step = tot <= 20 ? 5 : tot <= 50 ? 10 : 25, TT = Math.ceil(tot / step) * step;
    const P = (v) => r2((v / TT) * 100);
    // la profundidad: un span cuelga del último que lo contiene
    const depth = S.map((x, i) => { let dd = 0; for (let j = 0; j < i; j++) if (S[j].start_ms <= x.start_ms + 1e-9 && S[j].start_ms + S[j].ms >= x.start_ms + x.ms - 1e-9) dd++; return dd; });
    const kind = (x, i) => (i === 0 && !depth[i] ? 'root' : x.kind === 'client' ? 'io' : /Triton/i.test(`${x.who} ${x.name}`) ? 'gpu' : 'cpu');
    const ticks = []; for (let t = 0; t <= TT + 1e-9; t += step) ticks.push(t);
    tr = `<section class="ob__p ob__tr"><p class="ob__h"><span class="ob__k">3</span>Trazas: un árbol de spans, a escala (ms)</p><ol class="ob__sp">${S.map((x, i) => `<li style="--d:${depth[i]}"><p class="ob__sn"><code>${esc(x.name)}</code><span class="ob__kd">${esc(x.kind)}</span><span class="ob__ms">${fmtN(x.ms)}&nbsp;ms</span></p><div class="ob__trk"><span class="ob__bar ob--${kind(x, i)}" style="left:${P(x.start_ms)}%;width:${P(x.ms)}%"></span></div><p class="ob__who">${tx(x.who)}</p></li>`).join('')}</ol>
      ${axisHtml(ticks, P, 'ms', 'ob__ax')}</section>`;
  }
  const join = d.join ? `<p class="ob__join"><span class="ob__jk" aria-hidden="true">↔</span><span><span class="k">Lo que une los tres:</span> ${tx(d.join)}</span></p>` : '';
  return `${head}${log}<div class="ob__g">${met}${tr}</div>${join}<p class="kleg"><span><i class="sw sw--root"></i>el request entero</span><span><i class="sw sw--cpu"></i>CPU del gateway</span><span><i class="sw sw--io"></i>esperando a Triton</span><span><i class="sw sw--gpu"></i>dentro de Triton</span><span><mark class="ob__id">id</mark>el mismo request_id</span></p>`;
}

// 11 · Hilos, procesos y pods: un pod, un proceso uvicorn, el event loop y el threadpool con su semáforo; para más
// capacidad, más pods. Abajo, lo medido en el laboratorio, a escala.
function figThreads(d) {
  const P = d.pod || {}, Pr = d.process || {}, Lp = d.loop || {}, Tp = d.threadpool || {}, G = Tp.gate || {}, Sc = d.scale || {}, M = d.measured;
  const chips = (arr, cls) => (arr || []).map((w) => `<li class="${cls}">${tx(w)}</li>`).join('');
  const nT = +Tp.threads || 0, nS = +G.slots || 0;
  const threads = nT ? `<p class="th__ts" role="img" aria-label="${esc(`${nT} hilos; ${nS} decodes a la vez`)}">${Array.from({ length: nT }, (_, i) => `<i class="${i < nS ? 'on' : ''}"></i>`).join('')}</p><p class="th__tn">${fmtN(nT)} hilos, pero solo ${fmtN(nS)} decodes a la vez: los deja pasar el semáforo</p>` : '';
  const gate = G.label ? `<div class="th__gate"><p><span class="th__gl">${tx(G.label)}</span> · ${fmtN(nS)} slots · espera ≤ ${fmtN(r2((+G.wait_s || 0) * 1000))}&nbsp;ms</p><p class="th__go"><span class="k">Si no hay slot a tiempo:</span> ${codeify(tx(G.on_timeout || ''))}</p></div>` : '';
  const box = `<div class="th__pod"><p class="th__h"><b>${tx(P.label || 'pod')}</b>${P.cpu_request ? `<span class="th__t">CPU request ${esc(P.cpu_request)}</span>` : ''}${P.memory_limit ? `<span class="th__t">memoria ${esc(P.memory_limit)}</span>` : ''}</p>
    <div class="th__pr"><p class="th__h"><b>${tx(Pr.label || 'proceso')}</b>${Pr.workers !== undefined ? `<span class="th__t">--workers ${esc(Pr.workers)}</span>` : ''}</p>
      <div class="th__cols">
        <div class="th__loop"><p class="th__h">${ICON_WAITER}<b>${tx(Lp.label || 'event loop')}</b></p><ul class="th__w">${chips(Lp.work, 'w--loop')}</ul></div>
        <div class="th__mid" aria-hidden="true"><span>→ CPU →</span></div>
        <div class="th__pool"><p class="th__h">${ICON_KITCHEN}<b>${tx(Tp.label || 'threadpool')}</b></p>${gate}${threads}<ul class="th__w">${chips(Tp.work, 'w--cpu')}</ul></div>
      </div></div></div>`;
  const scale = Sc.yes || Sc.no ? `<div class="th__sc"><p class="th__sh">${tx(cap(Sc.label || 'más capacidad'))}</p>${Sc.yes ? `<p class="th__yes"><b aria-hidden="true">✓</b> ${tx(Sc.yes)}</p>` : ''}${Sc.no ? `<p class="th__no"><b aria-hidden="true">✗</b> ${tx(Sc.no)}</p>` : ''}</div>` : '';
  let meas = '';
  if (M && (M.rows || []).length) {
    const keys = ['p50', 'p99', 'healthz'].filter((k) => M.rows.some((r) => r[k] !== undefined));
    const mx = Math.max(1, ...M.rows.flatMap((r) => keys.map((k) => +r[k] || 0)));
    const unit = M.unit || 'ms';
    meas = `<div class="th__m"><p class="to__h">${tx(cap(M.label || 'medido'))}</p>${M.rows.map((r) => `<div class="th__mr"><p class="th__mm"><b>${tx(cap(r.mode))}</b></p>${keys.map((k) => `<p class="th__b"><span class="th__bk">${k === 'healthz' ? '/healthz' : k}</span><span class="th__bt"><span class="th__bb${k === 'healthz' ? ' th__bb--hz' : ''}" style="width:${pct((+r[k] || 0) / mx)}"></span></span><span class="th__bv">${fmtN(r[k])}&nbsp;${esc(unit)}</span></p>`).join('')}</div>`).join('')}<p class="th__mn">A escala, de 0 a ${fmtN(mx)}&nbsp;${esc(unit)}.</p></div>`;
  }
  return `${box}${scale}${meas}<p class="kleg"><span><i class="sw sw--loop"></i>lo hace el event loop: esperas de I/O y pasos cortos</span><span><i class="sw sw--cpu"></i>CPU pesada: va a un hilo</span><span><i class="sw sw--rej"></i>sin slot a tiempo: 503</span></p>`;
}

// 2 y 12 · Cadenas de pasos: lo que hace FastAPI con cada request (con el paso que escribes tú marcado) y el método de
// diagnóstico, de afuera hacia adentro.
function figChain(d, sec) {
  const st = d.steps || [];
  if (st.some((s) => s.ask || s.look)) {
    const track = `<p class="ch__tr">${st.map((s, i) => `<span class="ch__tp"><b>${i + 1}</b>${esc(s.label)}</span>`).join('<span class="ch__ta" aria-hidden="true">→</span>')}</p>`;
    const li = st.map((s, i) => `<li class="ch__s ch--probe" style="--k:${st.length > 1 ? r2(i / (st.length - 1)) : 0}"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(s.label)}</p>${s.ask ? `<p class="ch__ask">${tx(s.ask)}</p>` : ''}${s.look ? `<div class="ch__lk"><span class="k">Mira:</span><ul>${String(s.look).split(' · ').map((seg) => `<li>${cmdHtml(seg)}</li>`).join('')}</ul></div>` : ''}</li>`).join('');
    return `${track}<ol class="ch">${li}</ol>${d.rule ? `<p class="callout">${tx(d.rule)}</p>` : ''}`;
  }
  const mine = (s) => /^tu función/i.test(s.label || '');
  return `<ol class="ch">${st.map((s, i) => `<li class="ch__s${mine(s) ? ' ch--mine' : ''}"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(s.label)}${mine(s) ? '<span class="ch__wh">lo escribes tú</span>' : ''}</p>${codeChips(s.cmd)}${s.note ? `<p class="ch__n">${tx(s.note)}</p>` : ''}</li>`).join('')}</ol>${d.rule ? `<p class="callout">${tx(d.rule)}</p>` : ''}`;
}

// ================================================================ secciones
const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
// Títulos de los enlaces al curso: el registro real de la app (js/core/registry.js) con los módulos y casos cargados.
const COURSE = (() => {
  const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  const scripts = [...readFileSync(join(APP, 'index.html'), 'utf8').matchAll(/<script src="js\/((?:core\/registry|content\/[^"]+)\.js)"><\/script>/g)].map((m) => m[1]);
  for (const f of scripts) { try { vm.runInContext(readFileSync(join(APP, 'js', f), 'utf8'), ctx, { filename: f }); } catch (e) { aviso(`no pude cargar ${f} del curso: ${e.message}`); } }
  return ctx.MSD;
})();
const MODLAB = (m) => (m === 'ref-comandos' ? 'Docker y kubectl' : m === 'ref-numeros' ? 'Números' : m === 'ref-herramientas' ? 'Herramientas' : /^m\d+$/.test(m) ? 'M' + parseInt(m.slice(1), 10) : m.toUpperCase());
function linkChip(anchor) {
  const [m, id] = anchor.replace(/^#/, '').split('.');
  const page = COURSE && COURSE.getPage ? COURSE.getPage(m) : null;
  const sec = page && (page.sections || []).find((x) => x.id === id);
  if (!sec) aviso(`enlace del curso que no existe: ${anchor}`);
  return `<a class="chip" href="https://ronda-diseno-ml.vercel.app/#${esc(anchor.replace(/^#/, ''))}" target="_blank" rel="noopener">${esc(MODLAB(m))} · ${esc(sec ? sec.title : id)}</a>`;
}
// Las hojas hermanas que siguen el mismo tema (el brief pide no contradecirlas: mejor enlazarlas).
const SHEET_LINKS = {
  bolsillo: [['estimaciones', 'Formulario de estimaciones']],
  cadena: [['recorrido', 'Del dato a producción']],
  upstream: [['triton', 'De PyTorch a Triton']],
  salud: [['kubernetes', 'Kubernetes'], ['docker', 'Docker']],
  tests: [['git', 'Git y GitHub Actions']],
};
const sheetChip = ([id, t]) => `<a class="chip chip--sheet" href="https://cheat-sheets-ml.vercel.app/${id}/">Hoja · ${esc(t)}</a>`;

const ORDER = ['bolsillo', 'cadena', 'gateway', 'fastapi', 'async', 'contrato', 'upstream', 'backpressure', 'degradacion', 'salud', 'observabilidad', 'tests', 'rendimiento', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', gateway: '1 · Gateway', fastapi: '2 · FastAPI', async: '3 · async', contrato: '4 · Contrato', upstream: '5 · Llamar a Triton', backpressure: '6 · Admisión', degradacion: '7 · Degradación', salud: '8 · Salud y apagado', observabilidad: '9 · Observabilidad', tests: '10 · Tests', rendimiento: '11 · Rendimiento', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF).
const TOPIC_SECTION = { fastapi: 'fastapi', async: 'async', validacion: 'contrato', upstream: 'upstream', timeout: 'upstream', carga: 'backpressure', error: 'degradacion', salud: 'salud', apagado: 'salud', logs: 'observabilidad', metricas: 'observabilidad', tests: 'tests', rendimiento: 'rendimiento', otro: 'diagnostico' };
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
  return (x.tables || []).map((t) => `<div class="card tbl"><h3>${esc(t.caption)}</h3>${dataTable(t.head, t.rows, { cls: tableCls(t.head), codes: codeCols(t.head) })}${noteP(t.note)}</div>`).join('');
}
// tablas que son figuras: la de los límites, la de quién hace qué (una columna por capa, con su color) y la de los tests
function figTable(D, id) {
  if (!D.head) throw new Error(`figura table sin head en ${id}`);
  const tiers = D.head.map((h, j) => (!j ? '' : /ALB|borde/i.test(h) ? 'edge' : /Triton|GPU/i.test(h) ? 'gpu' : /Gateway|FastAPI/i.test(h) ? 'cpu' : ''));
  const isTiers = tiers.filter(Boolean).length >= 2;
  const mono = D.head.map((h, j) => (/^Test\b/i.test(h) ? j : -1)).filter((j) => j >= 0);
  const codes = [...new Set([...codeCols(D.head), ...(isTiers ? tiers.map((t, j) => (t ? j : -1)).filter((j) => j >= 0) : [])])];
  return dataTable(D.head, D.rows, { cls: `${tableCls(D.head)}${isTiers ? ' tiers' : ''}`, codes, mono, colCls: isTiers ? tiers.map((t) => (t ? `tier--${t}` : '')) : [] }) + noteP(D.note);
}
const FIG = { 'request-path': figRequestPath, 'event-loop': figEventLoop, status: figStatus, timeouts: figTimeouts, admission: figAdmission, degradation: figDegradation, shutdown: figShutdown, observability: figObservability, threads: figThreads, chain: figChain };
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') inner = figTable(D, x.id);
  else if (FIG[f.kind]) inner = FIG[f.kind](D, x.id) + notesList(D.notes) + noteP(D.note);
  else throw new Error('figura desconocida: ' + f.kind);
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
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>timeout</code> o <code>503</code>).</p>
  </div>`;
}
function exampleHtml(x) {
  const e = x.example;
  if (!LANG[e.lang]) aviso(`${x.id}: lenguaje de ejemplo sin resaltado: ${e.lang}`);
  return `<div class="example"><h3>Ejemplo real · ${esc(e.title)}</h3>${codeBlock(e.code, e.lang, null, e.source)}${e.notes && e.notes.length ? `<ul class="ex__notes">${e.notes.map((t) => `<li>${rx(t)}</li>`).join('')}</ul>` : ''}</div>`;
}
const notesHtml = (x) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p><p>${rx(stripLead(x.memo, 'Cómo recordarla'))}</p></div><div class="trap"><p class="tag">Trampa</p><p>${rx(stripLead(x.trap, 'Trampa'))}</p></div></div>`;
const linksHtml = (x) => {
  const sh = SHEET_LINKS[x.id] || [];
  return (x.links && x.links.length) || sh.length ? `<p class="links"><span class="links__k">En el curso:</span> ${(x.links || []).map(linkChip).join(' ')}${sh.length ? ` ${sh.map(sheetChip).join(' ')}` : ''}</p>` : '';
};
// Nota de un laboratorio probado. Si la nota dice dónde y con qué se corrió ("Ejecutado con Python 3.13.16 y 3.14.3 en
// macOS (Apple M4): …"), eso pasa a la línea estándar y queda el resto. Si no, la nota va entera, sin inventar versiones.
function execLine(l) {
  const t = String(l.verified_note || '').trim();
  if (!t) return { ver: 'Probado de verdad en un Mac.', note: '' };
  const m = t.match(/^(?:Ejecutado|Corrido|Probado)\s+con\s+([^:]+?)\s+en\s+(macOS(?:\s*\([^)]*\))?)\s*[:.]\s*([\s\S]*)$/i);
  if (!m || m[1].length > 90) return { ver: 'Probado de verdad en un Mac.', note: t };
  return { ver: `Probado de verdad en ${m[2]}, con ${m[1]}.`, note: cap(m[3].trim()) };
}
function labHtml(x) {
  const l = x.lab;
  if (!l) {
    if (!x.lab_omitted) return '';
    return `<p class="nolab"><span class="k">Sin laboratorio:</span> ${esc(String(x.lab_omitted).split(/(?<=\.)\s/)[0])}</p>`;
  }
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  let ver, note = String(l.verified_note || '');
  if (l.verified === 'executed') ({ ver, note } = execLine(l));
  else {
    if (l.verified !== 'docs') aviso(`${x.id}: verified raro en el laboratorio: ${l.verified}`);
    ver = 'Verificado contra la documentación; no ejecutado aquí.';
    note = note.replace(/^(?:No ejecutado aquí|No se corrió aquí)(?:\s*\([^)]*\))?[.:;]?\s*/i, '');
    note = note ? cap(note) : '';
  }
  return `<details class="lab"><summary><span class="lab__t">Laboratorio (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
    <p class="lab__goal"><span class="k">Qué vas a provocar:</span> ${tx(l.goal)}</p>
    ${l.needs ? `<p class="lab__needs small"><span class="k">Necesitas:</span> ${tx(l.needs)}</p>` : ''}
    <ol class="lab__steps">${steps}</ol>
    <div class="lab__fix"><p class="tag">Cómo arreglarlo y confirmarlo</p><p>${tx(l.fix)}</p></div>
    <p class="verified">${esc(ver)}${note ? ` <span>${esc(note)}</span>` : ''}</p>
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

// ================================================================ revisor de código del gateway (Python)
// El escáner por líneas de w1/scanner.mjs, portado con la misma semántica (lo prueba un test diferencial contra el
// original): 1) quita comentarios y docstrings (los strings de una línea quedan); 2) junta en una línea lógica lo que
// tiene corchetes abiertos o termina en "\"; 3) arma los bloques de def / async def por sangría, con sus decoradores (una
// ruta es @<obj>.get/post/…( ); 4) el lifespan (lifespan=NOMBRE o una función llamada lifespan) no cuenta como async_def:
// su lectura de archivos corre una vez, antes del tráfico; 5) cada regla aplica pattern (y not_pattern) a las líneas de su
// scope: file, module, any_def, async_def o route. Un hallazgo por regla y línea lógica, en su primera línea física.
// Es una función normal: la página la lleva con toString(). opts.stats recibe cuántas líneas y funciones vio.
function pyScan(source, rules, opts) {
  'use strict';
  var mode = (opts && opts.mode) || 'logical';
  var ROUTE_DECORATOR = /^@\s*[A-Za-z_][\w.]*\.(?:get|post|put|patch|delete|head|options|trace|api_route|websocket)\s*\(/;
  var DEF_LINE = /^(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
  function stripLine(raw, state) {
    var out = '', depthDelta = 0, i = 0, n = raw.length;
    while (i < n) {
      if (state.triple) {
        var end = raw.indexOf(state.triple, i);
        if (end === -1) { i = n; break; }
        i = end + 3;
        state.triple = null;
        continue;
      }
      var c = raw[i];
      if (c === '#') break; // comentario hasta el final de la línea
      if ((c === '"' || c === "'") && raw.substr(i, 3) === c + c + c) { out += '""'; state.triple = c + c + c; i += 3; continue; }
      if (c === '"' || c === "'") { // string de una línea: se copia, con sus escapes
        var j = i + 1;
        while (j < n && raw[j] !== c) j += raw[j] === '\\' ? 2 : 1;
        out += raw.slice(i, Math.min(j + 1, n));
        i = j + 1;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depthDelta++;
      else if (c === ')' || c === ']' || c === '}') depthDelta--;
      out += c;
      i++;
    }
    return { code: out.replace(/\s+$/, ''), depthDelta: depthDelta };
  }
  function indentOf(raw) {
    var w = 0;
    for (var k = 0; k < raw.length; k++) { var ch = raw[k]; if (ch === ' ') w += 1; else if (ch === '\t') w = (Math.floor(w / 8) + 1) * 8; else break; }
    return w;
  }
  function logicalLines(src) {
    var raws = src.split(/\r?\n/), state = { triple: null }, out = [], cur = null, depth = 0;
    for (var k = 0; k < raws.length; k++) {
      var raw = raws[k], wasInTriple = Boolean(state.triple);
      var r = stripLine(raw, state), code = r.code;
      if (cur === null) {
        if (code.trim() === '' && !state.triple) continue; // en blanco, solo comentario o el final de un docstring
        cur = { start: k + 1, indent: wasInTriple ? null : indentOf(raw), parts: [], physical: [] };
      }
      if (code.trim() !== '' || state.triple) { cur.parts.push(code.trim()); cur.physical.push({ line: k + 1, code: code, raw: raw }); }
      if (cur.indent === null && code.trim() !== '') cur.indent = indentOf(raw);
      depth = Math.max(0, depth + r.depthDelta);
      if (depth > 0 || /\\$/.test(code) || state.triple) continue;
      var joined = cur.parts.join(' ').replace(/\\ /g, ' ').trim();
      if (joined !== '') out.push({ start: cur.start, indent: cur.indent == null ? 0 : cur.indent, code: joined, physical: cur.physical });
      cur = null;
    }
    if (cur && cur.parts.length) out.push({ start: cur.start, indent: cur.indent == null ? 0 : cur.indent, code: cur.parts.join(' ').trim(), physical: cur.physical });
    return out;
  }
  var lines = logicalLines(String(source));
  var lifespans = Object.create(null), defs = [];
  lifespans.lifespan = true;
  lines.forEach(function (l) { var re = /\blifespan\s*=\s*([A-Za-z_]\w*)/g, m; while ((m = re.exec(l.code))) lifespans[m[1]] = true; });
  var stack = [], pending = [];
  lines.forEach(function (l) {
    while (stack.length && l.indent <= stack[stack.length - 1].indent) stack.pop();
    var top = stack[stack.length - 1];
    l.scopes = {
      file: true,
      module: stack.length === 0,
      any_def: stack.length > 0,
      async_def: Boolean(top && top.isAsync && !stack.some(function (f) { return f.isLifespan; })),
      route: Boolean(top && top.isRoute),
    };
    l.func = top ? top.name : null;
    var d = l.code.match(DEF_LINE);
    if (d) {
      var decs = pending.filter(function (x) { return x.indent === l.indent; });
      var fn = { name: d[2], indent: l.indent, isAsync: Boolean(d[1]), isRoute: decs.some(function (x) { return ROUTE_DECORATOR.test(x.code); }), isLifespan: lifespans[d[2]] === true };
      stack.push(fn); defs.push(fn);
      pending = [];
    } else if (l.code.charAt(0) === '@') pending.push(l);
    else pending = [];
  });
  var findings = [];
  for (var ri = 0; ri < rules.length; ri++) {
    var rule = rules[ri];
    var re = new RegExp(rule.pattern, rule.flags || '');
    var notRe = rule.not_pattern ? new RegExp(rule.not_pattern, rule.flags || '') : null;
    for (var li = 0; li < lines.length; li++) {
      var l = lines[li];
      if (!l.scopes[rule.scope]) continue;
      var texts = mode === 'physical' ? l.physical.map(function (p) { return { line: p.line, code: p.code, raw: p.raw }; })
        : [{ line: l.start, code: l.code, raw: l.physical[0] && l.physical[0].raw != null ? l.physical[0].raw : '' }];
      for (var ti = 0; ti < texts.length; ti++) {
        var t = texts[ti];
        if (re.test(t.code) && !(notRe && notRe.test(t.code))) {
          findings.push({ id: rule.id, severity: rule.severity, line: t.line, func: l.func, text: t.raw.trim() });
          break; // un hallazgo por regla y línea lógica
        }
      }
    }
  }
  findings.sort(function (a, b) { return a.line - b.line || a.id.localeCompare(b.id); });
  if (opts && opts.stats) {
    opts.stats.logical = lines.length;
    opts.stats.funcs = defs.length;
    opts.stats.asyncDefs = defs.filter(function (f) { return f.isAsync; }).length;
    opts.stats.routes = defs.filter(function (f) { return f.isRoute; }).length;
    opts.stats.lifespans = defs.filter(function (f) { return f.isLifespan; }).map(function (f) { return f.name; });
  }
  return findings;
}
const REVISOR_SRC = pyScan.toString();
const RULES = W1.revisor;
{
  const SCOPES = ['file', 'module', 'any_def', 'async_def', 'route'];
  RULES.forEach((r) => {
    if (!['error', 'warn', 'info'].includes(r.severity)) aviso(`revisor: severidad rara en ${r.id}: ${r.severity}`);
    if (!SCOPES.includes(r.scope)) aviso(`revisor: scope desconocido en ${r.id}: ${r.scope} (no se aplica en ninguna línea)`);
    try { new RegExp(r.pattern, r.flags || ''); if (r.not_pattern) new RegExp(r.not_pattern, r.flags || ''); } catch (e) { aviso(`revisor: la regla ${r.id} no compila: ${e.message}`); }
  });
}

// Un gateway con errores típicos: cada regla que dispara, la dispara por un error distinto.
const BAD_EXAMPLE = `# EJEMPLO con problemas a propósito: es para probar el revisor, no lo copies
import asyncio
import json
import time

import aiohttp
import requests
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from starlette.concurrency import run_in_threadpool

from .preprocess import preprocess

Image.MAX_IMAGE_PIXELS = None  # "así no falla con fotos grandes"
app = FastAPI(title="classifier-gateway")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)
triton = aiohttp.ClientSession()


@app.on_event("startup")
async def arrancar():
    app.state.labels = leer_labels()


def leer_labels():
    try:
        with open("labels.json") as f:
            return json.load(f)
    except:
        return []


@app.post("/v1/classify")
async def classify(file: UploadFile, request: Request):
    print("llegó un request", request.headers.get("x-request-id"))
    data = await file.read()
    with open("/tmp/ultima.jpg", "wb") as f:
        f.write(data)
    modelo = torch.load("model.pt")
    vista = Image.open(file.file).convert("RGB")
    time.sleep(0.05)
    tarifas = requests.get("http://precios.internal/api/tarifas")
    tensor = await asyncio.wait_for(run_in_threadpool(preprocess, data), timeout=0.1)
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=1)) as s:
            r = await s.post("http://triton:8000/v2/models/classifier/infer", data=tensor.tobytes())
    except asyncio.TimeoutError:
        raise HTTPException(500, "timeout de Triton")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return await r.json()


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
`;
const readSrc = (f) => { const t = readFileSync(join(C01_GW, f), 'utf8'); return t.endsWith('\n') ? t : t + '\n'; };
const SAMPLES = {
  bad: { text: BAD_EXAMPLE, label: 'EJEMPLO con problemas a propósito: bórralo y pega tu código', cls: '' },
  c01: { text: readSrc('app/main.py'), label: 'C01 · gateway/app/main.py (el archivo real)', cls: 'ok' },
  c01p: { text: readSrc('app/preprocess.py'), label: 'C01 · gateway/app/preprocess.py (el archivo real)', cls: 'ok' },
};
// Revisión en el build: los dos archivos reales del C01 no dan hallazgos, el ejemplo malo dispara varias reglas y cada
// ejemplo del contenido hace lo que dice (example_bad dispara su regla; example_good no dispara ninguna).
const REV_CHECK = (() => {
  const c01 = pyScan(SAMPLES.c01.text, RULES), c01p = pyScan(SAMPLES.c01p.text, RULES), bad = pyScan(BAD_EXAMPLE, RULES);
  if (c01.length) aviso(`revisor: main.py del C01 da ${c01.length} hallazgos: ${c01.map((f) => `${f.id}@${f.line}`).join(', ')}`);
  if (c01p.length) aviso(`revisor: preprocess.py del C01 da ${c01p.length} hallazgos: ${c01p.map((f) => `${f.id}@${f.line}`).join(', ')}`);
  const ex = { fired: 0, quiet: 0, bad: [] };
  for (const r of RULES) {
    const b = pyScan(r.example_bad, RULES), g = pyScan(r.example_good, RULES);
    if (b.some((f) => f.id === r.id)) ex.fired++; else ex.bad.push(`${r.id}: example_bad no la dispara`);
    if (!g.length) ex.quiet++; else ex.bad.push(`${r.id}: example_good dispara ${g.map((f) => f.id).join(', ')}`);
  }
  ex.bad.forEach((m) => aviso('revisor: ' + m));
  const badIds = [...new Set(bad.map((f) => f.id))];
  RULES.filter((r) => !badIds.includes(r.id)).forEach((r) => aviso(`revisor: el ejemplo con problemas no dispara ${r.id}`));
  return { c01: c01.length, c01p: c01p.length, bad: bad.length, badIds, ex };
})();

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
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y una revisión rápida del código de tu gateway antes de abrir el pull request.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué correr primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de código del gateway</h3>
    <p class="small">Pega un archivo de Python de tu gateway (FastAPI). Revisa ${RULES.length} reglas típicas en tu navegador: lo que bloquea el event loop dentro de un <code>async def</code>, clientes HTTP sin timeout o creados en cada request, bodies leídos sin tope, errores que filtran detalles internos o que responden 500 a un timeout, <code>except</code> que se tragan el error, el modo de desarrollo y CORS abierto con credenciales. Cada hallazgo dice la línea.</p>
    <p class="small">Es heurístico: lee el código por líneas (sin comentarios ni docstrings) y no lo ejecuta, así que puede pasar algo por alto o marcar algo que está bien.</p>
    <label class="rv-label" for="rv-text" id="rv-label">${esc(SAMPLES.bad.label)}</label>
    <textarea id="rv-text" rows="18" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-bad" type="button">Ejemplo con problemas</button><button class="btn" id="rv-c01" type="button">C01 · main.py</button><button class="btn" id="rv-c01p" type="button">C01 · preprocess.py</button><button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
    <p class="small rv-note">Corre en tu navegador, sin bajar nada: funciona sin conexión.</p>
  </div>
</section>`;
}

// ================================================================ CSS
const TOKENS_LIGHT = `--bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --syn-dec: #0f7a6e; --syn-num: #8a5a00; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --on-hi: #18212d;
  --cpu: #1f5fae; --cpu-soft: rgba(31, 95, 174, 0.10); --gpu: #0f7a6e; --gpu-soft: rgba(15, 122, 110, 0.13); --io: #d99a12;
  --okc: #2a7a36; --okc-soft: rgba(42, 122, 54, 0.12); --rej: #7a4fb8; --rej-soft: rgba(122, 79, 184, 0.11); --edge: #7b8594;`;
const TOKENS_DARK = `--bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --syn-dec: #4fcfbf; --syn-num: #f2c14e; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --on-hi: #0e131a;
  --cpu: #7db1ff; --cpu-soft: rgba(125, 177, 255, 0.12); --gpu: #4fcfbf; --gpu-soft: rgba(79, 207, 191, 0.15); --io: #f2c14e;
  --okc: #7fd18b; --okc-soft: rgba(127, 209, 139, 0.14); --rej: #c7b0f5; --rej-soft: rgba(199, 176, 245, 0.13); --edge: #8592a3; color-scheme: dark;`;
const CSS = `
/* El diseño de las hojas de Docker, Kubernetes, Git y Triton: papel cuadriculado para la sintaxis, tinta azul, resaltador
   ámbar. Colores de las figuras (uno por idea): azul = CPU del gateway, ámbar = espera (red, cola, turno, un tope de
   tiempo), verde azulado = la GPU (Triton), verde = ok, violeta = rechazado a propósito (4xx o 503), rojo = falla
   (500, 502, 504, se corta), gris = fuera del gateway. */
:root {
  ${TOKENS_LIGHT}
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  ${TOKENS_DARK} } }
:root[data-theme="dark"] {
  ${TOKENS_DARK} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
.tblw { margin-top: 12px; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 7px 8px 7px 6px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt th.rh { font: 600 14px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
.dt .mono, .dt th.rh.mono { font: 600 13px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.dt td.cmdc .cmdw { display: inline-flex; }
.dt td.nil { color: var(--muted); }
.dt th.tier { color: var(--ink); border-bottom: 3px solid var(--rule); }
.dt th.tier--edge { border-bottom-color: var(--edge); } .dt th.tier--cpu { border-bottom-color: var(--cpu); } .dt th.tier--gpu { border-bottom-color: var(--gpu); }
.fig__note { color: var(--muted); font-size: 14.5px; margin: 10px 0 0; }
.fig__notes { margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 14.5px; }
.cmdw { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; }
code, code.cmd { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
code, pre, .cmd, var.ph, figure.fig, .tool { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
.cmdn { color: var(--muted); }
.sep { color: var(--muted); }
p.cc { margin: 6px 0 0; }
p.cc .cmdw { display: inline-flex; }
button.cp { flex: none; font: 600 11.5px/1 var(--f-display); letter-spacing: .02em; color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 7px; cursor: pointer; }
button.cp:hover, button.cp:focus-visible { border-color: var(--accent); outline: none; }
.code { margin-top: 10px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
.code__bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--rule); font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.code__lang { text-transform: uppercase; letter-spacing: .08em; flex: none; }
.code__src { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.code__bar .cp { margin-left: auto; }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 13px/1.55 var(--f-mono); color: var(--ink); tab-size: 4; }
.code pre code { font: inherit; background: none; padding: 0; overflow-wrap: normal; }
.tk-k { color: var(--syn-kw); font-weight: 700; } .tk-s { color: var(--syn-str); } .tk-c { color: var(--syn-com); font-style: italic; } .tk-p { color: var(--muted); user-select: none; } .tk-d { color: var(--syn-dec); font-weight: 700; } .tk-n { color: var(--syn-num); }
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
.links .chip--sheet { border-color: var(--accent); color: var(--accent); }
.links a.chip:hover, .links a.chip:focus-visible { border-color: var(--accent); color: var(--accent); }
details.lab { margin-top: 14px; border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); }
details.lab > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px; padding: 11px 14px; font: 700 14px/1.3 var(--f-display); color: var(--ink); }
details.lab > summary::-webkit-details-marker { display: none; }
details.lab > summary::before { content: "▸"; color: var(--accent); transition: transform .15s; }
details.lab[open] > summary::before { transform: rotate(90deg); }
.lab__n { margin-left: auto; color: var(--muted); font-weight: 500; font-size: 13px; flex: none; }
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
p.nolab { margin: 14px 0 0; font: 500 13.5px/1.4 var(--f-display); color: var(--muted); }
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
  .dg-row .sep, .dg-first .sep, .err__f .sep, .quiz__ans .sep, p.cc .sep { display: none; }
  .dg-row .cmdw, .dg-first .cmdw, .err__f .cmdw, .quiz__ans .cmdw, p.cc .cmdw { display: flex; width: fit-content; margin: 4px 0 2px; }
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
#rv-text { display: block; width: 100%; margin-top: 6px; min-height: 300px; font: 13px/1.55 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; resize: vertical; white-space: pre; overflow: auto; tab-size: 4; }
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
pre.rv-code { margin: 6px 0 0; padding: 6px 9px; border-radius: 6px; background: var(--code-bg); border: 1px solid var(--rule); font: 12.5px/1.5 var(--f-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.rv-ln { font: 700 12.5px/1.2 var(--f-display); color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.rv-ln:hover, .rv-ln:focus-visible { border-color: var(--accent); outline: none; }
.sev { flex: none; font: 700 11px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; }
.sev.error { background: var(--warn); color: var(--onbar); } .sev.warn { background: var(--hi-soft); color: var(--hi-ink); border: 1px solid var(--hi); } .sev.info { background: var(--accent-soft); color: var(--accent); }
.rv-note { margin: 10px 0 0; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
/* ---------- piezas comunes de las figuras */
.kleg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.kleg span { display: inline-flex; align-items: center; gap: 6px; }
.kleg code { font-size: 12px; }
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; font-style: normal; }
.sw--cpu { background: var(--cpu); } .sw--gpu { background: var(--gpu); } .sw--io { background: var(--io); } .sw--edge { background: var(--edge); }
.sw--ok { background: var(--okc); } .sw--rej { background: var(--rej); } .sw--fail { background: var(--warn); }
.sw--p50 { height: 8px; background: var(--ink); } .sw--p99 { background: repeating-linear-gradient(135deg, var(--ink) 0 2px, transparent 2px 5px); opacity: .7; }
.sw--blk { background: var(--cpu); box-shadow: inset 0 0 0 2px var(--warn); }
.sw--done { width: 14px; height: 14px; border-radius: 50%; background: var(--okc); }
.sw--ghost { border: 1.5px dashed var(--hi); }
.sw--win { background: var(--hi-soft); border: 1px solid var(--hi); }
.sw--dot { width: 12px; height: 12px; border-radius: 50%; background: var(--ink); }
.sw--spike { width: 5px; height: 14px; border-radius: 1px; background: var(--warn); }
.sw--pre { background: var(--hi-soft); border: 1.5px solid var(--hi); } .sw--drain { background: var(--okc-soft); border: 1.5px solid var(--okc); } .sw--margin { background: var(--free); border: 1.5px solid var(--rule); }
.sw--kill { width: 0; height: 14px; border-left: 3px solid var(--warn); border-radius: 0; }
.sw--root { background: var(--muted); opacity: .55; }
.sw--loop { background: var(--paper); border: 1.5px solid var(--ink); border-radius: 999px; }
/* códigos HTTP: ok, rechazado a propósito, falla */
.hc { display: inline-block; font: 800 12px/1.3 var(--f-mono); border-radius: 5px; padding: 0 6px; color: var(--onbar); vertical-align: baseline; white-space: nowrap; }
.hc--ok { background: var(--okc); } .hc--rej { background: var(--rej); } .hc--fail { background: var(--warn); }
.hcw { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 5px; margin-right: 6px; min-width: 0; }
.hc__x { font-size: 13px; color: var(--muted); }
.hdr { display: inline-block; font: 600 11.5px/1.3 var(--f-mono); border: 1px solid var(--rej); color: var(--rej); border-radius: 4px; padding: 0 5px; white-space: nowrap; }
.callout { margin: 12px 0 0; padding: 8px 12px; border-left: 4px solid var(--ink); background: var(--free); border-radius: 0 8px 8px 0; font: 700 14.5px/1.4 var(--f-display); }
.to__h { margin: 0 0 6px; font: 800 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ic { width: 20px; height: 20px; flex: none; fill: var(--ink); stroke: var(--ink); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.ic .ic__l { fill: none; stroke-width: 1.8; }
.ic--kitchen { fill: none; stroke: var(--cpu); stroke-width: 1.8; }
.ic--door { width: 66px; height: 49px; margin-left: auto; }
.ic--door .ic__sign { fill: var(--rej); stroke: none; }
.ic--door text { fill: var(--onbar); stroke: none; font: 800 8px var(--f-display); letter-spacing: .03em; }
/* ---------- ↳ · el camino de un request */
.rq__bud { border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px 8px; }
.rq__bh { margin: 0 0 8px; font: 600 14px/1.4 var(--f-display); }
.rq__bh b { font-family: var(--f-mono); }
.rq__bw { position: relative; margin: 0 2px; }
.rq__bar { position: absolute; left: 0; right: 0; top: 0; height: 26px; border-radius: 5px; background: var(--free); overflow: hidden; }
.rq__seg { position: absolute; top: 0; bottom: 0; display: grid; place-items: center; border-right: 1.5px solid var(--paper); font: 800 11px/1 var(--f-display); color: var(--onbar); }
.rq__seg.rq--cpu { background: var(--cpu); } .rq__seg.rq--io { background: var(--io); color: var(--on-hi); } .rq__seg.rq--gpu { background: var(--gpu); } .rq__seg.rq--edge { background: var(--edge); }
.rq__tk { position: absolute; bottom: 0; height: 6px; border-left: 1px solid var(--paper); }
@media (max-width: 760px) { .rq__wd { display: none; } }
.rq__ml { position: absolute; top: -4px; width: 0; border-left: 2px dashed var(--ink); }
.rq__mt { position: absolute; white-space: nowrap; font: 600 12px/16px var(--f-display); color: var(--muted); padding-right: 5px; }
.rq__mt b { color: var(--ink); font-family: var(--f-mono); font-weight: 700; }
.rq__z { position: absolute; left: 0; top: 30px; font: 600 11px/16px var(--f-mono); color: var(--muted); }
.rq__bn { margin: 2px 0 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
.rq__sh { margin: 16px 0 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 600 12.5px/1.4 var(--f-display); color: var(--muted); }
ol.rq__st { list-style: none; margin: 0; padding: 0; display: grid; }
.rq__s { --c: var(--cpu); --ci: var(--cpu); position: relative; display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 2px 22px; padding: 0 0 14px 40px; min-width: 0; }
.rq__s.rq--io { --c: var(--io); --ci: var(--hi-ink); } .rq__s.rq--gpu { --c: var(--gpu); --ci: var(--gpu); } .rq__s.rq--edge { --c: var(--edge); --ci: var(--muted); }
.rq__s::before { content: ""; position: absolute; left: 13px; top: 30px; bottom: 2px; width: 3px; background: var(--c); opacity: .35; border-radius: 2px; }
.rq__s:last-child::before { display: none; }
.rq__no { position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--c); color: var(--onbar); display: grid; place-items: center; font: 800 13px/1 var(--f-display); }
.rq__s.rq--io .rq__no { color: var(--on-hi); }
.rq__s p { margin: 0; }
.rq__a, .rq__b { min-width: 0; }
.rq__l { font: 700 15.5px/1.35 var(--f-display); padding-top: 3px; }
.rq__w { margin-top: 2px !important; font: 600 12.5px/1.4 var(--f-display); color: var(--ci); }
.rq__trk { position: relative; height: 14px; margin-top: 6px; background: var(--free); border-radius: 3px; }
.rq__trk--out { background: none; box-shadow: inset 0 0 0 1.5px var(--c); }
.rq__p99 { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: repeating-linear-gradient(135deg, var(--c) 0 3px, transparent 3px 6px); }
.rq__p50 { position: absolute; top: 3px; bottom: 3px; border-radius: 2px; background: var(--c); }
.rq__v { margin-top: 3px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; font: 500 12.5px/1.4 var(--f-display); color: var(--muted); }
.rq__v b { font-family: var(--f-mono); color: var(--ink); }
.rq__mu { font: 800 11px/1 var(--f-mono); border: 1.5px solid var(--c); color: var(--ci); border-radius: 999px; padding: 2px 6px; }
.rq--micro .rq__v { margin-top: 6px !important; }
.rq__out { border: 1px dashed var(--muted); border-radius: 999px; padding: 0 7px; font-size: 11.5px; }
.rq__f { margin-top: 6px !important; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 4px; font-size: 13.5px; }
.rq__n { margin-top: 4px !important; font-size: 14px; line-height: 1.45; color: var(--muted); }
@media (max-width: 760px) { .rq__s { grid-template-columns: minmax(0, 1fr); } }
/* ---------- 3 · el event loop (el mesero) */
.el { display: grid; gap: 14px; }
.el__sc { border: 1px solid var(--rule); border-left: 4px solid var(--okc); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.el--bad { border-left-color: var(--warn); }
.el__h { margin: 0; display: flex; gap: 8px; align-items: center; font: 800 15px/1.35 var(--f-display); }
.el__bd { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--onbar); background: var(--okc); font: 800 13px/1 var(--f-display); }
.el--bad .el__bd { background: var(--warn); }
.el__meta { margin: 4px 0 4px; font-size: 14.5px; line-height: 1.45; color: var(--muted); }
.el__g { display: grid; grid-template-columns: 96px minmax(0, 1fr) 56px; column-gap: 8px; row-gap: 3px; align-items: center; }
.el__gh { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 8px; margin: 8px 0 0; font: 800 11px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.el__ln { margin: 0; display: flex; align-items: center; gap: 5px; min-width: 0; font: 700 12.5px/1.15 var(--f-display); }
.el__ln small { display: block; font: 500 11px/1.25 var(--f-display); color: var(--muted); }
.el__ln--blk small { color: var(--warn); font-weight: 700; }
.el__ln--blk .ic { fill: var(--warn); stroke: var(--warn); }
.el__ln--rq code { font: 700 12px var(--f-mono); background: none; padding: 0; }
.el__trk { position: relative; height: 30px; min-width: 0; }
.el__trk--rq { height: 22px; }
.el__gl { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--rule); }
.el__sp { position: absolute; top: 3px; bottom: 3px; display: grid; place-items: center; overflow: hidden; border-radius: 4px; border-right: 1.5px solid var(--paper); background: var(--cpu); color: var(--onbar); font: 700 11px/1 var(--f-mono); }
.el__sp--blk { box-shadow: inset 0 0 0 2.5px var(--warn); }
.el__pt { position: absolute; top: 5px; height: 20px; display: flex; align-items: center; gap: 3px; margin-left: -10px; white-space: nowrap; font: 600 11px/1 var(--f-mono); }
.el__pt b { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--okc); color: var(--onbar); font: 800 11px/1 var(--f-display); }
.el__base { position: absolute; top: 10px; height: 2px; background: var(--muted); opacity: .5; }
.el__own { position: absolute; top: 6px; height: 10px; border-radius: 2px; background: var(--cpu); }
.el__own--blk { box-shadow: inset 0 0 0 1.5px var(--warn); }
.el__wt { position: absolute; top: 7px; height: 8px; min-width: 2px; border-radius: 2px; background: var(--io); }
.el__dn { position: absolute; top: 2px; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; display: grid; place-items: center; background: var(--okc); color: var(--onbar); font: 800 10px/1 var(--f-display); z-index: 1; }
.el__lat { font: 700 12.5px/1.2 var(--f-mono); text-align: right; white-space: nowrap; }
.tax { position: relative; height: 16px; margin-top: 2px; font: 600 11px/16px var(--f-mono); color: var(--muted); }
.tax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.tax span.is-0 { transform: none; } .tax span.is-n { transform: translateX(-100%); }
@media (max-width: 640px) { .tax span.is-odd { display: none; } .el__g { grid-template-columns: 74px minmax(0, 1fr) 48px; column-gap: 6px; } .el__ln .ic { display: none; } }
.el__ms { margin: 8px 0 0; font-size: 13.5px; color: var(--muted); }
.el__ms code { background: none; padding: 0; font-size: 12.5px; color: var(--ink); }
/* ---------- 4 · qué código devuelve el C01 */
.st__in { margin: 0 0 8px; font: 700 14px/1.4 var(--f-display); }
.st__in span { color: var(--okc); }
ol.st { list-style: none; margin: 0; padding: 0; display: grid; }
.st__n { position: relative; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 4px 16px; align-items: center; padding: 0 0 8px; }
.st__n::before { content: ""; position: absolute; left: 17px; top: 20px; bottom: -2px; width: 3px; background: var(--okc); opacity: .45; }
.st__q { position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 8px; min-width: 0; border: 1.5px solid var(--rule); border-radius: 10px; padding: 6px 10px 6px 6px; background: var(--paper); }
.st__q .st__a { flex: 1 1 170px; }
.st__q .st__c { margin-left: auto; }
.st__k { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11.5px/1 var(--f-display); }
.st--fw .st__k { background: var(--edge); color: var(--onbar); } .st--cpu .st__k { background: var(--cpu); color: var(--onbar); } .st--gpu .st__k { background: var(--gpu); color: var(--onbar); }
.st__a { margin: 0; flex: 1; min-width: 0; font: 600 14.5px/1.4 var(--f-display); }
.st__c { flex: none; align-self: center; font: 700 11px/1.3 var(--f-mono); color: var(--hi-ink); background: var(--hi-soft); border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
.st__x { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; font-size: 13.5px; }
.st__no { font: 800 12px/1 var(--f-display); color: var(--rej); white-space: nowrap; }
.st__who { font: 600 12px var(--f-mono); }
.st__nt { color: var(--muted); font-size: 13.5px; line-height: 1.4; }
.st__end { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 2px 0 0; padding: 8px 10px; border: 2px solid var(--okc); border-radius: 10px; background: var(--okc-soft); font-size: 14px; }
.st__yes { font: 800 12.5px/1 var(--f-display); color: var(--okc); }
.st__end .st__nt { color: var(--ink); }
.st__else { margin-top: 12px; border: 1px dashed var(--muted); border-radius: 10px; padding: 8px 12px; }
.st__eh { margin: 0 0 4px; font: 800 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.st__else ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 14px; line-height: 1.4; }
.st__else li { display: flex; gap: 8px; align-items: baseline; }
@media (max-width: 720px) { .st__n { grid-template-columns: minmax(0, 1fr); } .st__x { padding-left: 32px; } }
/* ---------- 5 · timeouts, reintentos y amplificación */
.to__nest { min-width: 0; }
.to__ex, .rt, .amp { margin-top: 18px; border-top: 1px dashed var(--rule); padding-top: 12px; min-width: 0; }
.to__dw { position: relative; margin: 0 2px; }
.to__dl { position: absolute; left: 0; right: 0; top: 0; height: 24px; }
.to__d, .to__sw { background: color-mix(in srgb, var(--io) calc(18% + var(--k) * 72%), var(--paper)); border: 1.5px solid var(--hi); }
.to__d { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
.to__ml { position: absolute; top: -3px; width: 0; border-left: 2px solid var(--hi-ink); }
.to__mt { position: absolute; white-space: nowrap; font: 600 12px/16px var(--f-display); color: var(--muted); padding-right: 5px; }
.to__mt b { color: var(--ink); font-family: var(--f-mono); }
ul.to__list { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 22px; }
.to__list li { position: relative; padding-left: 22px; font-size: 14px; line-height: 1.4; min-width: 0; }
.to__list p { margin: 0; }
.to__sw { position: absolute; left: 0; top: 3px; width: 14px; height: 14px; border-radius: 3px; }
.to__w { color: var(--muted); font-size: 13.5px; }
@media (max-width: 640px) { ul.to__list { grid-template-columns: minmax(0, 1fr); } }
.to__xw { position: relative; height: 34px; margin: 22px 2px 0; background: var(--free); border-radius: 5px; }
.to__xs { position: absolute; top: 4px; bottom: 4px; display: grid; place-items: center; overflow: hidden; border-radius: 3px; font: 700 11.5px/1 var(--f-display); white-space: nowrap; }
.to--cpu { background: var(--cpu); color: var(--onbar); } .to--io { background: var(--io); color: var(--on-hi); }
.to__gh { position: absolute; top: 4px; bottom: 4px; border: 1.5px dashed var(--hi); border-left: 0; border-radius: 0 3px 3px 0; }
.to__cut { position: absolute; top: -6px; bottom: -6px; width: 0; border-left: 3px solid var(--warn); }
.to__cutl { position: absolute; top: -21px; padding-right: 5px; font: 700 11.5px/14px var(--f-display); color: var(--warn); white-space: nowrap; }
ul.to__xl { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
ul.to__xl li { display: inline-flex; align-items: center; gap: 6px; }
.to__res { margin: 6px 0 0; font-size: 14.5px; }
.rt__g { display: grid; grid-template-columns: 96px minmax(0, 1fr); column-gap: 8px; row-gap: 4px; align-items: center; }
.rt__ln { margin: 0; font: 700 12.5px/1.15 var(--f-display); }
.rt__ln small { display: block; font: 500 11px/1.25 var(--f-display); color: var(--muted); }
.rt__ln--bad { color: var(--warn); }
.rt__trk { position: relative; height: 32px; min-width: 0; }
.rt__win { position: absolute; top: 8px; height: 16px; border-radius: 3px; background: var(--hi-soft); border: 1px solid var(--hi); border-right: 0; }
.rt__win span { position: absolute; left: 50%; top: 0; transform: translateX(-50%); font: 700 10.5px/14px var(--f-mono); color: var(--hi-ink); white-space: nowrap; }
.rt__sp { position: absolute; top: 2px; bottom: 2px; width: 5px; margin-left: -2.5px; border-radius: 2px; background: var(--warn); z-index: 1; }
.rt__sp b { position: absolute; left: 7px; top: -1px; font: 800 11px/14px var(--f-display); color: var(--warn); }
.rt__dot { position: absolute; top: 1px; width: 17px; height: 17px; margin-left: -8.5px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 10px/1 var(--f-display); box-shadow: 0 0 0 1.5px var(--paper); z-index: 1; }
.rt__dot--lo { top: 13px; }
@media (max-width: 640px) { .rt__g { grid-template-columns: 78px minmax(0, 1fr); } }
.rt__st { margin-top: 12px; }
.rt__pk { margin: 4px 0 0; display: grid; grid-template-columns: 80px minmax(0, 1fr) 54px; gap: 8px; align-items: center; font: 600 13px/1.3 var(--f-display); }
.rt__pk b { font-family: var(--f-mono); text-align: right; }
.rt__pt { display: block; height: 14px; background: var(--free); border-radius: 3px; overflow: hidden; }
.rt__pb { display: block; height: 100%; background: var(--okc); }
.rt__pb--bad { background: var(--warn); }
.rt__wn { margin: 6px 0 0; font-size: 13.5px; color: var(--muted); }
ol.amp__rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
ol.amp__rows li { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 2px 10px; align-items: center; }
.amp__k { font: 700 12px/1.3 var(--f-display); color: var(--muted); }
.amp__dots { display: flex; flex-wrap: wrap; gap: 3px; max-width: 420px; }
.amp__dots i { width: 9px; height: 9px; border-radius: 2px; background: var(--ink); opacity: .7; }
.amp--last .amp__dots i { background: var(--warn); opacity: 1; }
.amp__dots i.amp__u { background: var(--okc); opacity: 1; }
.amp__n { grid-column: 2; font: 600 13px/1.3 var(--f-display); }
.amp__n b { font-family: var(--f-mono); }
/* ---------- 6 · control de admisión (el portero) */
.ad__flow { display: grid; gap: 10px; }
.ad__end { margin: 0; justify-self: start; font: 700 13px/1.3 var(--f-display); border-radius: 999px; padding: 4px 12px; border: 1.5px solid var(--ink); }
.ad__end--gpu { border-color: var(--gpu); color: var(--gpu); background: var(--gpu-soft); }
ol.ad__gates { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 24px; }
.ad__g { position: relative; min-width: 0; border: 1.5px solid var(--rule); border-radius: 12px; padding: 10px 12px; }
.ad__g:first-child { border: 2px solid var(--ink); }
.ad__g:not(:last-child)::after { content: "→"; position: absolute; right: -19px; top: 36px; font: 800 16px/1 var(--f-display); color: var(--muted); }
@media (max-width: 900px) { ol.ad__gates { grid-template-columns: minmax(0, 1fr); gap: 24px; } .ad__g:not(:last-child)::after { content: "↓"; right: auto; left: 22px; top: auto; bottom: -22px; } }
.ad__g p { margin: 0; }
.ad__gh { display: flex; align-items: center; gap: 8px; }
.ad__no { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 12px/1 var(--f-display); }
.ad__gn { flex: 1; min-width: 0; font: 800 15px/1.3 var(--f-display); }
.ad__sl { display: grid; grid-template-columns: repeat(8, 16px); gap: 4px; margin-top: 8px; }
.ad__sl i { width: 16px; height: 16px; border-radius: 3px; background: var(--ink); opacity: .8; }
.ad__sl--big { grid-template-columns: repeat(4, 26px); }
.ad__sl--big i { width: 26px; height: 26px; background: var(--cpu); opacity: 1; }
.ad__tp { margin-top: 6px !important; font: 700 13px/1.35 var(--f-display); }
.ad__tm { margin-top: 6px !important; display: flex; align-items: center; gap: 8px; font: 700 13px/1.35 var(--f-display); color: var(--hi-ink); }
.ad__tb { flex: none; width: 40px; height: 10px; border-radius: 3px; background: linear-gradient(90deg, var(--hi) 62%, var(--hi-soft) 62%); border: 1px solid var(--hi); }
.ad__r { margin-top: 5px !important; font-size: 14px; line-height: 1.45; }
.ad__m, .ad__sim { margin-top: 16px; border-top: 1px dashed var(--rule); padding-top: 12px; }
.ad__mr { margin-top: 8px; }
.ad__mr p { margin: 0; }
.ad__ml { font: 700 13.5px/1.35 var(--f-display); }
.ad__u { margin-top: 4px !important; display: flex; flex-wrap: wrap; gap: 3px; }
.ad__u i { width: 13px; height: 13px; border-radius: 3px; }
.u--ok { background: var(--okc); } .u--rej { background: var(--rej); } .u--fail { background: var(--warn); }
.ad__mv { margin-top: 4px !important; display: flex; flex-wrap: wrap; gap: 4px 14px; font: 600 13px/1.4 var(--f-display); color: var(--muted); }
.ad__sr { margin-top: 10px; }
.ad__sr p { margin: 0; }
.ad__sl2 { font: 700 14px/1.35 var(--f-display); }
.ad__sb { margin-top: 4px !important; display: flex; height: 22px; border-radius: 5px; overflow: hidden; background: var(--free); }
.ad__ss { display: grid; place-items: center; overflow: hidden; white-space: nowrap; font: 800 11.5px/1 var(--f-mono); color: var(--onbar); }
.ad__sv { margin-top: 5px !important; display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 13.5px; color: var(--muted); }
.ad__sv b { color: var(--ink); font-family: var(--f-mono); }
/* ---------- 7 · la escalera de degradación */
.lad { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 12px; }
.lad__rail { border-radius: 13px; background: linear-gradient(180deg, var(--okc), var(--hi) 55%, var(--warn)); display: flex; flex-direction: column; justify-content: space-between; align-items: center; padding: 8px 0; }
.lad__rail span { writing-mode: vertical-rl; transform: rotate(180deg); font: 800 10.5px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--onbar); white-space: nowrap; }
ol.lad__l { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; min-width: 0; }
.lad__s { --c: color-mix(in oklch, var(--warn) calc(var(--k) * 100%), var(--okc)); position: relative; display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 4px 18px; min-width: 0; border: 1px solid var(--rule); border-left: 5px solid var(--c); border-radius: 10px; padding: 8px 12px 8px 42px; }
.lad__no { position: absolute; left: 9px; top: 9px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: var(--onbar); font: 800 12px/1 var(--f-display); }
.lad__s p { margin: 0; }
.lad__a, .lad__b { min-width: 0; }
.lad__n { font: 800 15px/1.35 var(--f-display); }
.lad__t { margin-top: 3px !important; font-size: 14px; line-height: 1.4; color: var(--muted); }
.lad__b p { font-size: 14px; line-height: 1.45; }
.lad__b p + p { margin-top: 3px; }
@media (max-width: 720px) { .lad__s { grid-template-columns: minmax(0, 1fr); } .lad { grid-template-columns: 18px minmax(0, 1fr); gap: 8px; } .lad__rail span { font-size: 9px; } }
/* ---------- 8 · el apagado (como en la hoja de Kubernetes) */
svg .t { fill: var(--muted); font: 12.5px var(--f-display); } svg .tl { fill: var(--ink); font: 12.5px var(--f-display); } svg .tb { font-weight: 700; }
svg .tm { fill: var(--ink); font: 12px var(--f-display); }
svg .tnum { fill: var(--paper); font: 800 11.5px var(--f-display); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .l-kill { stroke: var(--warn); stroke-width: 3.2; } svg .l-lane { stroke: var(--rule); stroke-width: 2; }
svg .s-muted { stroke: var(--muted); } svg .s-rule { stroke: var(--rule); stroke-width: 1.2; } svg .s-hi { stroke: var(--hi); stroke-width: 1.6; } svg .s-ok { stroke: var(--okc); stroke-width: 1.6; }
svg .f-ink { fill: var(--ink); } svg .f-warn { fill: var(--warn); } svg .f-muted { fill: var(--muted); }
svg .f-hi-soft { fill: var(--hi-soft); } svg .f-ok-soft { fill: var(--okc-soft); } svg .f-free { fill: var(--free); }
svg.chart.fv-n { display: none; }
@media (max-width: 679px) { svg.chart.fv-w { display: none; } svg.chart.fv-n { display: block; } }
ol.kev { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; font-size: 15px; line-height: 1.45; }
ol.kev li { display: grid; grid-template-columns: 22px 64px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.kev__n { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11.5px/1 var(--f-display); }
.kev__n--kill { background: var(--warn); color: var(--onbar); }
.kev__t { font: 700 13px/1.4 var(--f-mono); color: var(--muted); }
.kev__x b { font-family: var(--f-display); }
/* ---------- 9 · observabilidad */
.ob__rq { margin: 0 0 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.ob__m { font: 800 11px/1 var(--f-mono); background: var(--ink); color: var(--paper); border-radius: 4px; padding: 4px 6px; }
.ob__rq > code { font: 700 13.5px var(--f-mono); background: none; padding: 0; }
.ob__lat { font: 700 13px var(--f-mono); }
.ob__rid { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; min-width: 0; max-width: 100%; }
mark.ob__id { background: var(--hi-soft); color: var(--ink); box-shadow: inset 0 -2px 0 var(--hi); font-family: var(--f-mono); font-size: 12.5px; word-break: break-all; padding: 0 2px; border-radius: 2px; }
.ob__p { border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.ob__p p { margin: 0; }
.ob__h { margin: 0 0 6px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 800 13.5px/1.3 var(--f-display); }
.ob__k { width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11px/1 var(--f-display); }
.ob__hs { font: 600 12px var(--f-mono); color: var(--muted); }
pre.ob__json { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--code-bg); font: 12.5px/1.55 var(--f-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
pre.ob__json mark.ob__id { font-size: inherit; }
.ob__g { margin-top: 10px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: start; }
@media (max-width: 860px) { .ob__g { grid-template-columns: minmax(0, 1fr); } }
ul.ob__ml { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ob__ml li { border-top: 1px solid var(--rule); padding-top: 5px; min-width: 0; }
.ob__mn code { font: 700 12.5px var(--f-mono); background: none; padding: 0; overflow-wrap: anywhere; }
.ob__suf { color: var(--accent); }
.ob__lb { line-height: 1.35; }
.ob__lb code { font-size: 11.5px; line-height: 1.35; color: var(--muted); background: none; padding: 0; overflow-wrap: anywhere; }
.ob__ch { font-size: 13.5px; }
ol.ob__sp { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.ob__sp li { min-width: 0; }
.ob__sn { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; padding-left: calc(var(--d) * 14px); }
.ob__sn code { font: 700 12px var(--f-mono); background: none; padding: 0; overflow-wrap: anywhere; }
.ob__kd { font: 700 10.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--rule); border-radius: 999px; padding: 0 6px; }
.ob__ms { margin-left: auto; font: 700 12px var(--f-mono); }
.ob__trk { position: relative; height: 12px; margin-top: 3px; background: var(--free); border-radius: 3px; }
.ob__bar { position: absolute; top: 0; bottom: 0; min-width: 3px; border-radius: 3px; }
.ob--root { background: var(--muted); opacity: .55; } .ob--cpu { background: var(--cpu); } .ob--io { background: var(--io); } .ob--gpu { background: var(--gpu); }
.ob__who { margin-top: 2px !important; padding-left: calc(var(--d) * 14px); font-size: 12.5px; line-height: 1.35; color: var(--muted); }
.ob__ax { margin-top: 4px; }
.ob__join { margin: 10px 0 0; display: flex; gap: 8px; align-items: baseline; font-size: 14.5px; }
.ob__jk { font: 800 16px var(--f-display); color: var(--hi-ink); }
/* ---------- 11 · hilos, procesos y pods */
.th__pod { border: 2px solid var(--ink); border-radius: 14px; padding: 10px; }
.th__pr { margin-top: 8px; border: 1.5px dashed var(--muted); border-radius: 12px; padding: 10px; }
.th__h { margin: 0 0 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 600 13.5px/1.35 var(--f-display); }
.th__h b { font-weight: 800; }
.th__t { font: 600 11.5px/1.4 var(--f-mono); border: 1px solid var(--rule); border-radius: 999px; padding: 0 7px; color: var(--muted); }
.th__cols { display: grid; grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1.35fr); gap: 8px; align-items: stretch; }
.th__loop { border: 2px solid var(--ink); border-radius: 10px; padding: 8px 10px; min-width: 0; }
.th__pool { border: 2px solid var(--cpu); border-radius: 10px; padding: 8px 10px; background: var(--cpu-soft); min-width: 0; }
.th__mid { display: grid; place-items: center; font: 800 11px/1.2 var(--f-display); color: var(--cpu); text-align: center; white-space: nowrap; }
ul.th__w { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 6px; }
.th__w li { font: 600 12.5px/1.3 var(--f-display); border-radius: 999px; padding: 2px 9px; background: var(--paper); }
.w--loop { border: 1.5px solid var(--ink); } .w--cpu { border: 1.5px solid var(--cpu); }
.th__gate { border: 1.5px solid var(--rej); background: var(--paper); border-radius: 8px; padding: 6px 8px; font-size: 13.5px; line-height: 1.4; }
.th__gate p { margin: 0; }
.th__gl { font: 700 12.5px var(--f-mono); }
.th__go { margin-top: 2px !important; }
.th__ts { margin: 8px 0 0; display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 3px; max-width: 360px; }
.th__ts i { height: 14px; border-radius: 2px; background: var(--paper); border: 1px solid var(--rule); }
.th__ts i.on { background: var(--cpu); border-color: var(--cpu); }
.th__tn { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
@media (max-width: 760px) { .th__cols { grid-template-columns: minmax(0, 1fr); } .th__mid span { display: inline-block; transform: rotate(90deg); } .th__mid { height: 30px; } }
.th__sc { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.th__sh { margin: 0; font: 800 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.th__yes, .th__no { margin: 0; font: 600 14px/1.35 var(--f-display); border-radius: 8px; padding: 4px 10px; }
.th__yes { background: var(--okc-soft); border: 1.5px solid var(--okc); } .th__yes b { color: var(--okc); }
.th__no { background: var(--warn-soft); border: 1.5px solid var(--warn); } .th__no b { color: var(--warn); }
.th__m { margin-top: 14px; border-top: 1px dashed var(--rule); padding-top: 10px; }
.th__mr { margin-top: 8px; }
.th__mr p { margin: 0; }
.th__mm { margin-bottom: 3px !important; font: 700 14px/1.35 var(--f-display); }
.th__b { margin-top: 2px !important; display: grid; grid-template-columns: 64px minmax(0, 1fr) 62px; gap: 8px; align-items: center; font: 600 12.5px var(--f-display); }
.th__bk { color: var(--muted); font-family: var(--f-mono); }
.th__bt { display: block; height: 12px; background: var(--free); border-radius: 3px; overflow: hidden; }
.th__bb { display: block; height: 100%; background: var(--io); }
.th__bv { font: 700 12px var(--f-mono); text-align: right; }
.th__mn { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
/* ---------- 2 y 12 · cadenas de pasos */
ol.ch { list-style: none; margin: 0; padding: 0; display: grid; }
.ch__s { --c: var(--ink); position: relative; padding: 0 0 18px 44px; min-width: 0; }
.ch__s::before { content: ""; position: absolute; left: 14px; top: 32px; bottom: 4px; width: 3px; background: var(--c); opacity: .35; border-radius: 2px; }
.ch__s:last-child::before { display: none; }
.ch__no { position: absolute; left: 0; top: 0; width: 31px; height: 31px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 14px/1 var(--f-display); }
.ch--mine { --c: var(--accent); }
.ch--mine .ch__l { color: var(--accent); }
.ch__s p { margin: 0; }
.ch__l { font: 800 16.5px/1.35 var(--f-display); padding-top: 3px; }
.ch__wh { display: inline-block; margin-left: 8px; font: 700 11px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); border: 1.5px solid var(--accent); border-radius: 999px; padding: 1px 7px; vertical-align: 2px; }
.ch__n { margin-top: 6px !important; font-size: 15px; line-height: 1.5; }
.ch__ask { margin-top: 4px !important; font-size: 15px; line-height: 1.45; font-style: italic; }
.ch__lk { margin-top: 5px; font-size: 14.5px; line-height: 1.5; }
.ch__lk ul { list-style: none; margin: 2px 0 0; padding: 0; display: grid; gap: 3px; }
.ch__lk li { min-width: 0; }
p.ch__tr { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 16px; }
.ch__tp { display: inline-flex; align-items: center; gap: 5px; font: 700 13px/1.3 var(--f-display); border: 1px solid var(--rule); border-radius: 999px; padding: 3px 9px 3px 4px; background: var(--paper); }
.ch__tp b { width: 19px; height: 19px; border-radius: 50%; background: var(--ink); color: var(--paper); display: inline-grid; place-items: center; font: 800 10.5px/1 var(--f-display); }
.ch__ta { color: var(--muted); font-weight: 800; }
.ch--probe .ch__no { background: color-mix(in srgb, var(--ink) calc(55% + var(--k) * 45%), var(--paper)); }
/* tablas: se apilan en el celular */
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  table.stk td.nil::before, table.stk td.codes::before { display: inline-block; margin-right: 8px; }
  table.stk td.tier--edge::before { color: var(--edge); } table.stk td.tier--cpu::before { color: var(--cpu); } table.stk td.tier--gpu::before { color: var(--gpu); }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    ${TOKENS_LIGHT} --bg: #ffffff; --paper: #ffffff; color-scheme: light;
  }
  body { font-size: 11px; line-height: 1.45; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, #herramientas, details.lab, p.nolab, figure.quiz, .search, #err-n, #err-none, button.cp { display: none !important; }
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
  .k { font-size: 9px; } .kleg { font-size: 9.5px; margin-top: 6px; } .sw { width: 12px; height: 9px; }
  .hc { font-size: 9px; padding: 0 4px; } .hc__x, .hdr { font-size: 9px; } .callout { font-size: 10.5px; padding: 5px 9px; } .to__h { font-size: 8.5px; }
  .rq__bh, .rq__bn, .rq__sh { font-size: 10px; } .rq__mt { font-size: 9.5px; } .rq__s { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr) !important; padding: 0 0 7px 30px; gap: 1px 14px; } .rq__no { width: 22px; height: 22px; font-size: 10px; } .rq__s::before { left: 10px; top: 24px; }
  .rq__l { font-size: 11px; } .rq__w, .rq__v, .rq__f { font-size: 9.5px; } .rq__n { font-size: 9.5px; } .rq__trk { height: 10px; margin-top: 3px; }
  .el__sc { padding: 6px 8px; } .el__h { font-size: 11px; } .el__meta, .el__ms { font-size: 9.5px; } .el__g { grid-template-columns: 90px minmax(0, 1fr) 48px !important; } .el__ln { font-size: 9.5px; } .el__ln small { font-size: 8.5px; } .el__trk { height: 22px; } .el__trk--rq { height: 18px; } .el__sp, .el__lat, .tax { font-size: 8.5px; } .tax span.is-odd { display: inline !important; }
  .st__a { font-size: 10.5px; } .st__x, .st__nt, .st__end, .st__else ul { font-size: 9.5px; } .st__q { padding: 3px 8px 3px 4px; } .st__n { padding-bottom: 5px; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important; } .st__x { padding-left: 0 !important; } .st__k { width: 18px; height: 18px; font-size: 9.5px; } .st__n::before { left: 13px; }
  .to__list li, .to__res, ul.to__xl { font-size: 9.5px; } .to__mt { font-size: 9.5px; } ul.to__list { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; } .rt__ln, .rt__pk, .amp__n, .amp__k { font-size: 9.5px; } .rt__wn { font-size: 9.5px; }
  .ad__gn { font-size: 11px; } .ad__r, .ad__tp, .ad__tm, .ad__ml, .ad__mv, .ad__sv, .ad__sl2 { font-size: 9.5px; } ol.ad__gates { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px 18px !important; } .ad__g:not(:last-child)::after { content: "→" !important; right: -15px !important; left: auto !important; top: 30px !important; bottom: auto !important; } .ic--door { width: 40px; height: 36px; }
  .lad__n { font-size: 11px; } .lad__t, .lad__b p { font-size: 9.5px; } .lad__s { padding: 5px 9px 5px 34px; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) !important; } .lad__no { width: 19px; height: 19px; font-size: 9.5px; left: 7px; top: 6px; }
  svg.chart.fv-n { display: none !important; } svg.chart.fv-w { display: block !important; }
  ol.kev { font-size: 10px; gap: 3px; } ol.kev li { grid-template-columns: 17px 42px minmax(0, 1fr); } .kev__n { width: 17px; height: 17px; font-size: 9px; } .kev__t { font-size: 9.5px; }
  .ob__h { font-size: 10px; } pre.ob__json { font-size: 9px; } .ob__mn code, .ob__sn code { font-size: 9px; } .ob__lb code, .ob__who, .ob__ch, .ob__join { font-size: 9px; } .ob__g { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; }
  .th__h, .th__w li, .th__gate, .th__tn, .th__b, .th__mm, .th__yes, .th__no { font-size: 9.5px; } .th__cols { grid-template-columns: minmax(0, 1fr) 40px minmax(0, 1.35fr) !important; } .th__mid span { transform: none !important; }
  .ch__s { padding: 0 0 9px 32px; } .ch__no { width: 23px; height: 23px; font-size: 11px; } .ch__s::before { left: 10px; top: 25px; } .ch__l { font-size: 12px; padding-top: 1px; } .ch__n, .ch__ask, .ch__lk { font-size: 10px; } .ch__wh { font-size: 8px; } .ch__tp { font-size: 9.5px; }
  .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .rq__s, .rq__bud, .el__sc, .st__n, .to__nest, .to__ex, .rt, .amp, .ad__g, .ad__m, .ad__sim, .lad__s, ol.kev li, .ob__p, .th__pod, .th__m, .ch__s { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .to__h, .code__bar { break-after: avoid; }
  .links { break-before: avoid; }
}
`;

// Sin ligaduras en la letra monoespaciada (como en la hoja de vLLM): el shorthand font: de reglas como .code pre o
// .vars td.c vuelve a poner font-variant-ligatures y font-feature-settings en normal, y JetBrains Mono dibuja -> como
// una flecha, != como ≠ y >= como ≥. Esta regla va al final, con los mismos selectores que usan la letra monoespaciada
// (también los <text> de los SVG), así gana en la cascada. Los comentarios del CSS se quitan antes (el de .hc tiene
// comas) y los selectores se cortan solo en las comas de primer nivel (no en las de :not(a, b) ni en [x="a,b"]).
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

// ================================================================ JS de la página (sin librerías)
const DATA = {
  rules: RULES.map((r) => ({ id: r.id, severity: r.severity, scope: r.scope, pattern: r.pattern, flags: r.flags || '', not_pattern: r.not_pattern || '', message: r.message, why: r.why, fix: r.fix })),
  samples: SAMPLES,
  btns: [['rv-c01', 'c01'], ['rv-c01p', 'c01p']],
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

  // ---------- revisor de código del gateway (Python)
  /*REVISOR*/
  // Las reglas que este navegador no puede compilar (lookbehind en Safari viejo) se saltan y se avisa: el resto corre igual.
  var RULE = {}, USABLE = [], BROKEN = [];
  D.rules.forEach(function (r) {
    RULE[r.id] = r;
    try { new RegExp(r.pattern, r.flags || ''); if (r.not_pattern) new RegExp(r.not_pattern, r.flags || ''); USABLE.push(r); } catch (e) { BROKEN.push(r.id); }
  });
  var RANK = { error: 0, warn: 1, info: 2 }, NAME = { error: 'error', warn: 'aviso', info: 'info' };
  function plural(nn, a, b) { return nn + ' ' + (nn === 1 ? a : b); }
  function lineBtn(n) { return '<button class="rv-ln" type="button" data-line="' + n + '" title="Marcar la línea en el texto">línea ' + n + '</button>'; }
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega el código de tu gateway (por ejemplo, tu <code>main.py</code>) y toca Revisar.</p>'; return; }
    var st = {}, found = pyScan(text, USABLE, { stats: st });
    found.sort(function (a, b) { return (RANK[a.severity] - RANK[b.severity]) || (a.line - b.line); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[f.severity]++; });
    var html = '<p class="rv-sum" id="rv-sum" data-total="' + found.length + '" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '">' +
      (found.length ? plural(found.length, 'hallazgo', 'hallazgos') + ': ' + plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + USABLE.length + ' reglas encontró algo.') + '</p>' +
      '<p class="rv-objs">Revisé ' + plural(st.logical, 'línea lógica', 'líneas lógicas') + ' y ' + plural(st.funcs, 'función', 'funciones') + ' (' + st.asyncDefs + ' async def, ' + plural(st.routes, 'ruta', 'rutas') + ').' +
      (st.lifespans && st.lifespans.length ? ' El lifespan (<code>' + esc(st.lifespans.join(', ')) + '</code>) no cuenta como async def: lo que lee ahí corre una vez, antes del tráfico.' : '') + '</p>';
    if (BROKEN.length) html += '<p class="small">Este navegador no puede correr ' + plural(BROKEN.length, 'regla', 'reglas') + ' (' + esc(BROKEN.join(', ')) + '): actualízalo para revisarlas.</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var rr = RULE[f.id];
      return '<li class="sev-' + rr.severity + '" data-rule="' + rr.id + '" data-line="' + f.line + '"><div class="rv-h"><span class="sev ' + rr.severity + '">' + NAME[rr.severity] + '</span><span class="rv-msg">' + esc(rr.message) + '</span></div>' +
        '<p class="rv-obj">' + lineBtn(f.line) + (f.func ? ' · en <code>' + esc(f.func) + '()</code>' : ' · fuera de toda función') + '</p>' +
        '<pre class="rv-code">' + esc(String(f.text).slice(0, 240)) + '</pre>' +
        '<p>' + esc(rr.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(rr.fix) + '</p></li>';
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
  $('rv-run').addEventListener('click', function () { var t = $('rv-text').value; var cur = Object.keys(D.samples).filter(function (k) { return D.samples[k].text === t; })[0]; if (!cur) setLabel('Tu código', 'mine'); review(); });
  $('rv-bad').addEventListener('click', function () { load('bad'); });
  D.btns.forEach(function (b) { var el = $(b[0]); if (el) el.addEventListener('click', function () { load(b[1]); }); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tu código', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
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
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de código']];
const TITLE = 'El gateway: FastAPI en producción';
const HEAD = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS_ALL}</style>`;
// Versiones del pie: las fijadas en requirements.txt del C01 y el Python de su Dockerfile. Si el C01 cambia, el pie también.
const VER = (() => {
  const req = readFileSync(join(C01_GW, 'requirements.txt'), 'utf8');
  const pin = (name) => (req.match(new RegExp(`^${name}(?:\\[[^\\]]*\\])?==([\\d.]+)`, 'mi')) || [])[1];
  const py = (readFileSync(join(C01_GW, 'Dockerfile'), 'utf8').match(/FROM python:(\d+\.\d+)/) || [])[1];
  const v = { FastAPI: pin('fastapi'), Starlette: pin('starlette'), Pydantic: pin('pydantic'), uvicorn: pin('uvicorn'), tritonclient: pin('tritonclient'), aiohttp: pin('aiohttp'), 'prometheus-client': pin('prometheus-client'), Pillow: pin('pillow') };
  Object.entries(v).forEach(([k, x]) => { if (!x) aviso(`el pie no encontró la versión de ${k} en requirements.txt`); });
  return { list: Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`), py };
})();
const N_EXEC = ORDER.filter((id) => byId[id].lab && byId[id].lab.verified === 'executed').length;
const N_LABS = ORDER.filter((id) => byId[id].lab).length;
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · APIs de serving · ejemplos de C01</p>
    <h1>${TITLE}</h1>
    <p class="lead">Para escribir desde cero, con la documentación abierta, la API que está entre los clientes y el servidor de modelos, y para diagnosticar por qué va lenta, devuelve 503 o se traba. El gateway del C01 recibe la foto, la valida, la decodifica en CPU sin frenar a los demás requests, llama a Triton con un plazo, rechaza rápido lo que no puede atender a tiempo y deja una línea de log y sus métricas por cada request. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y un laboratorio opcional. En la versión web, al final hay un diagnosticador de síntomas, un revisor de código del gateway y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span></p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--cpu)"></i>CPU del gateway</span><span><i class="dot" style="background:var(--io)"></i>espera: red, cola o turno</span><span><i class="dot" style="background:var(--gpu)"></i>la GPU (Triton)</span><span><i class="dot" style="background:var(--okc)"></i>ok</span><span><i class="dot" style="background:var(--rej)"></i>rechazado a propósito: 4xx o 503</span><span><i class="dot" style="background:var(--warn)"></i>falla: 500, 502, 504 o se corta</span><span><i class="dot" style="background:var(--edge)"></i>fuera del gateway</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>APIs, defaults, códigos y mensajes revisados en octubre de 2026 contra la documentación oficial de FastAPI, Starlette, Pydantic, uvicorn, AnyIO, httpx, aiohttp, tritonclient, prometheus_client y OpenTelemetry, contra los RFC de HTTP y contra los archivos de <code>reference/c01</code> del curso. Las versiones son las del C01${VER.py ? ` (Python ${esc(VER.py)}` : ''}${VER.list.length ? `${VER.py ? ', ' : ': '}${esc(VER.list.join(', '))}` : ''}${VER.py ? ')' : ''}; cuando la versión actual cambia algo, la sección lo dice. De los ${N_LABS} laboratorios, ${N_EXEC} se corrieron de verdad en un Mac; los demás se verificaron contra la documentación. Si tu terminal dice otra cosa, créele a tu terminal.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  writeFileSync(join(dir, 'revisor.js'), REVISOR_SRC + `\nvar REVISOR_RULES = ${jsonForScript(DATA.rules)};\nvar REVISOR_SAMPLES = ${jsonForScript(Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.text])))};\nif (typeof module !== 'undefined') module.exports = { pyScan: pyScan, REVISOR_RULES: REVISOR_RULES, REVISOR_SAMPLES: REVISOR_SAMPLES };\n`);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · laboratorios ${N_LABS} (${N_EXEC} probados) · diagnosticador ${W3.diagnosticador.length} síntomas · revisor ${RULES.length} reglas · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  console.log(`revisor: C01 main.py ${REV_CHECK.c01} hallazgos · preprocess.py ${REV_CHECK.c01p} · ejemplo con problemas ${REV_CHECK.bad} hallazgos (${REV_CHECK.badIds.length} reglas) · example_bad que disparan ${REV_CHECK.ex.fired}/${RULES.length} · example_good en silencio ${REV_CHECK.ex.quiet}/${RULES.length}`);
  return texN;
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}
function pdf(pagePath) {
  const out = join(HERE, '..', 'cheatsheet-gateway.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'gateway-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* no importa */ }
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('cheatsheet-gateway.pdf listo');
}

const mode = process.argv[2] || 'build';
if (mode === 'cmds') {
  // para revisar a ojo cómo se parte cada texto con comandos: [código] y «nota»
  const show = (h) => h.replace(/<button[^>]*>Copiar<\/button>/g, '').replace(/<code class="cmd">([\s\S]*?)<\/code>/g, '[$1]').replace(/<span class="cmdn">([\s\S]*?)<\/span>/g, '«$1»').replace(/<span class="sep"> · <\/span>/g, ' · ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const g of W3.diagnosticador) { console.log(`\n# ${g.id}\n  first: ${show(cmdHtml(g.first))}`); g.causes.forEach((c) => console.log(`  check: ${show(cmdHtml(c.check))}`)); }
  console.log('\n# errores'); ERRS.forEach((e) => console.log(`  first: ${show(cmdHtml(e.first))}`));
  console.log('\n# figuras'); ALL.forEach((x) => ((x.figure.data || {}).steps || []).forEach((s) => { if (s.cmd) console.log(`  ${x.id}: ${show(codeChips(s.cmd))}`); if (s.look) console.log(`  ${x.id} (look): ${show(cmdHtml(s.look))}`); }));
  process.exit(0);
}
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
  const pagePath = join(HERE, '..', 'cheatsheet-gateway.html');
  writeFileSync(pagePath, '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  if (mode === 'pdf') pdf(pagePath);
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src, build, pdf o cmds)'); process.exit(2); }
