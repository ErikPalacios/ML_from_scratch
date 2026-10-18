// Genera el "Cheat sheet de Docker" con el diseño del Formulario de estimaciones (formulario/gen.mjs):
// mismos tokens claro/oscuro, fuentes, hero, nav de chips, .pad con papel cuadriculado, tabla .vars,
// figuras SVG a escala, notas "Cómo recordarla" / "Trampa" y CSS de impresión.
//
// Uso:
//   node gen-docker.mjs src <dir>   → <dir>/head.html, wrap.html, script.js y src.html (con KaTeX de cdnjs)
//   node gen-docker.mjs build       → lo anterior en ./out, renderiza [data-tex] a MathML estático con
//                                     tools/browser-check.mjs y escribe cheatsheet-docker.html (HEAD + wrap + script)
//                                     y local.html (con doctype/html/head/body, para ver y para el PDF)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = '/Users/erikpalacios/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design';
const readJSON = (f) => JSON.parse(readFileSync(join(HERE, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C01_DOCKERFILE = readFileSync(join(APP, 'reference/c01/gateway/Dockerfile'), 'utf8');

// ---------------------------------------------------------------- utilidades
const T = String.raw;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en memo, trap, note y notes: solo <b> y <code>; todo lo demás se escapa.
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const n = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const r1 = (x) => Math.round(x * 10) / 10;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// {placeholder} → variable con aspecto de variable matemática. No toca {{.Go}} ni { mapas: yaml }.
const PH = /\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*)\}/g;
const phs = (escaped) => escaped.replace(PH, '<var class="ph">$1</var>');
// Las flags (-p, --network) no se parten en el guion.
// Flags cortas enteras; en las largas, al menos los guiones con su primera palabra (nunca queda un "--" suelto).
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
const tx = (s) => nbFlags(esc(s));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(nbFlags(esc(s)));
const svgPh = (s) => esc(s).replace(PH, '<tspan class="tph">$1</tspan>');

// Símbolo de una fórmula (n_señal, S_final, CUDA_max(driver)…) → TeX para la tabla de variables.
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

// ---------------------------------------------------------------- comandos: separar lo copiable de la nota
const CMD_WORDS = new Set(['docker', 'git', 'lsof', 'ls', 'uname', 'nvidia-smi', 'nvidia-ctk', 'python', 'python3', 'head', 'cat', 'echo', 'curl', 'id', 'sed', 'grep', 'od', 'tr', 'aws', 'kubectl', 'du', 'pip', 'sort', 'time', 'cd', 'printf', 'tail']);
const CUTS = [' (', ' en ', ' y ', ' contra ', ': ', ' → ', ' mientras '];
function splitCmd(seg) {
  const first = seg.trim().split(/\s+/)[0];
  if (!CMD_WORDS.has(first)) return null;
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
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando se muestra como código copiable.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    const c = splitCmd(seg);
    if (!c) return esc(seg);
    return `<span class="cmdw"><code class="cmd">${esc(c.cmd)}</code>${copyBtn(c.cmd)}</span>${c.note ? `<span class="cmdn">${esc(c.note)}</span>` : ''}`;
  }).join('<span class="sep"> · </span>');
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const DF_INSTR = new Set(['FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL']);
const SH_SUB = new Set(['compose', 'buildx', 'image', 'volume', 'network', 'builder', 'system', 'context', 'container', 'ecr']);
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
      const m = seg.match(/^(\s*(?:-\s+)?)([A-Za-z_][\w.-]*)(:)(?=\s|$)/);
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
          st.sub = t === 'docker' ? 2 : 0;
          continue;
        }
        st.cmdPos = false;
        out += esc(t); continue;
      }
      if (st.sub > 0 && /^[a-z][a-z-]*$/.test(t)) {
        out += `<span class="tk-k">${esc(t)}</span>`;
        st.sub = SH_SUB.has(t) ? st.sub - 1 : 0;
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
  if (lang === 'text' && /^\$ /.test(line)) {
    const s2 = { cmdPos: true, sub: 0 };
    return `<span class="tk-p">$</span> ` + hlLine(line.slice(2), 'bash', s2);
  }
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
function hl(code, lang) {
  const out = []; let cont = false, here = null;
  for (const line of String(code).split('\n')) {
    if (here) {
      if (line.trim() === here.end) { out.push(`<span class="tk-k">${esc(line)}</span>`); here = null; cont = false; continue; }
      const st = { atStart: !here.cont, cmdPos: !here.cont, sub: 0 };
      out.push(hlLine(line, here.lang, st));
      here.cont = /\\\s*$/.test(line); continue;
    }
    const st = { atStart: !cont, cmdPos: !cont, sub: 0 };
    out.push(hlLine(line, lang, st));
    cont = /\\\s*$/.test(line) && !/^\s*#/.test(line);
    if (lang === 'bash') {
      const h = line.match(/<<-?\s*'?(\w+)'?/);
      if (h) {
        const f = (line.match(/>\s*(\S+)/) || [])[1] || '';
        here = { end: h[1], lang: /dockerfile/i.test(f) ? 'dockerfile' : /\.ya?ml$/.test(f) ? 'yaml' : 'text', cont: false };
      }
    }
  }
  return out.join('\n');
}
const LANG = { dockerfile: 'Dockerfile', yaml: 'YAML', bash: 'bash · zsh', text: 'texto' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- SVG
const svgBox = (w, h, body, label, k = 0.8) => `<div class="scroll"><svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet" style="min-width:${Math.round(w * k)}px;max-width:${Math.round(w * 1.12)}px">${body}</svg></div>`;
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const tlines = (x, y, lines, cls = 't', anchor = 'start', lh = 15) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${lines.map((l, i) => `<tspan x="${r1(x)}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(h)}" class="${cls}" ${extra}/>`;
const path = (d, cls = 's-muted', extra = '') => `<path d="${d}" class="${cls}" fill="none" ${extra}/>`;
const arrow = (d, cls = 's-muted', w = 1.6, dash = false) => `<path d="${d}" class="${cls}" fill="none" stroke-width="${w}"${dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#arr)"/>`;
const DEFS = `<defs>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="f-paper"/><line x1="0" y1="0" x2="0" y2="6" class="s-muted" stroke-width="2"/></pattern>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-muted"/></marker>
  <marker id="arrhi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-hi"/></marker>
</defs>`;
function wrap(s, max) {
  const words = String(s).split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      let cut = Math.max(w.lastIndexOf('/', max - 1), w.lastIndexOf('-', max - 1), w.lastIndexOf(':', max - 1), w.lastIndexOf('.', max - 1));
      cut = cut < max * 0.4 ? max : cut + 1;
      out.push(w.slice(0, cut)); w = w.slice(cut);
    }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
// Nombre de imagen en ≤ 2 líneas, cortando en un separador.
function wrapName(s, max) {
  if (s.length <= max) return [s];
  let cut = -1;
  for (const sep of ['-ubuntu', ':', '/']) { const i = s.lastIndexOf(sep, max); if (i > max * 0.4) { cut = i; break; } }
  if (cut < 0) cut = max;
  return [s.slice(0, cut), s.slice(cut)];
}

// ---------------------------------------------------------------- tablas HTML
function dataTable(head, rows, { cls = '', firstHead = true, phCells = false, mono = [] } = {}) {
  const cell = (v, j) => {
    const content = phCells ? phs(nbFlags(esc(v))) : tx(v);
    const k = j > 0 && head[j] ? ` data-k="${esc(head[j])}"` : '';
    const c = [j === 0 && firstHead ? 'rh' : '', mono.includes(j) ? 'mono' : '', j === 0 && phCells ? 'nw' : ''].filter(Boolean).join(' ');
    return j === 0 && firstHead ? `<th scope="row"${c ? ` class="${c}"` : ''}>${content}</th>` : `<td${k}${c ? ` class="${c}"` : ''}>${content}</td>`;
  };
  return `<div class="tscroll"><table class="dt stk ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const noteP = (s) => (s ? `<p class="fig__note">${tx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${tx(x)}</li>`).join('')}</ul>` : '');

// ---------------------------------------------------------------- figuras
// 0 · Tamaños de imagen (escala logarítmica: cada marca ×10).
function figSizes(d) {
  const W = 840, X0 = 312, D = 132, top = 50;
  const x = (mb) => X0 + (Math.log10(mb) - 1) * D;
  const items = d.rows.map((r) => {
    const unit = /GB/.test(r[1]) ? 1000 : 1;
    const nums = (r[1].match(/\d+(?:\.\d+)?/g) || []).map(Number);
    const variants = (r[0].match(/\{([^}]+)\}/) || [])[1];
    const names = variants ? variants.split(',') : [null];
    return { name: r[0], label: r[1], bars: nums.map((v, i) => ({ mb: v * unit, tag: names[i] || null, raw: nums.length > 1 ? `${names[i] || ''} ≈ ${v} ${unit === 1000 ? 'GB' : 'MB'}`.trim() : r[1] })) };
  });
  let y = top, body = '';
  const fam = (s) => (/^python/.test(s) ? 'f-c2' : /^nvidia\/cuda/.test(s) ? 'f-c1' : 'f-c4');
  for (const it of items) {
    const h = it.bars.length > 1 ? 46 : 36;
    const nl = wrapName(it.name, 37);
    body += tlines(16, y + (nl.length > 1 ? h / 2 - 3 : h / 2 + 4), nl, 'tm', 'start', 14);
    it.bars.forEach((b, i) => {
      const bh = it.bars.length > 1 ? 13 : 16, by = it.bars.length > 1 ? y + 7 + i * 18 : y + h / 2 - 8;
      body += rect(X0, by, x(b.mb) - X0, bh, fam(it.name), 'rx="2"') + txt(x(b.mb) + 7, by + bh - 3, b.raw, 'tl tb');
    });
    y += h;
  }
  let grid = '';
  for (let k = 1; k <= 4; k++) for (let m = 1; m <= 9; m++) {
    const v = m * 10 ** k; if (v > 10000) break;
    grid += line(x(v), top - 8, x(v), y + 2, m === 1 ? 'grid-s' : 'grid');
  }
  const ticks = [[10, '10 MB'], [100, '100 MB'], [1000, '1 GB'], [10000, '10 GB']].map(([v, l]) => txt(x(v), y + 20, l, 't tb', 'middle')).join('');
  const head = txt(16, 24, d.head[0], 't tb') + txt(X0, 24, `${d.head[1]} · escala logarítmica: cada marca es ×10`, 't tb');
  return svgBox(W, y + 34, DEFS + grid + head + body + ticks, 'Tamaño comprimido de imágenes base comunes, en escala logarítmica', 0.8);
}

// ↳ · La cadena: cuatro cosas unidas por cinco comandos.
function figChain(d) {
  const W = 960, bw = 172, by = 64, gap = (W - 20 - 4 * bw) / 3;
  const arts = [], verbs = [];
  let pending = [];
  for (const s of d.steps) {
    if (s.type === 'artifact') { if (arts.length) verbs.push(pending); arts.push(s); pending = []; }
    else pending.push(s);
  }
  let s = DEFS, bh = 0;
  const lines = arts.map((a) => wrap(a.detail || '', 22));
  bh = 44 + Math.max(...lines.map((l) => l.length)) * 15;
  arts.forEach((a, i) => {
    const x0 = 10 + i * (bw + gap);
    s += rect(x0, by, bw, bh, 'f-paper s-rule', 'rx="9"') + rect(x0, by, bw, 30, 'f-accent-soft', 'rx="9"') + rect(x0, by + 20, bw, 10, 'f-accent-soft');
    s += txt(x0 + bw / 2, by + 20, a.label, 'tl tb tbig', 'middle') + tlines(x0 + 12, by + 50, lines[i], 't', 'start', 15);
    if (i < arts.length - 1) {
      const xa = x0 + bw + 4, xb = x0 + bw + gap - 4, ym = by + bh / 2;
      s += arrow(`M${r1(xa)},${r1(ym)} L${r1(xb)},${r1(ym)}`, 's-accent', 2);
      s += tlines((xa + xb) / 2, ym - 10 - (verbs[i].length - 1) * 16, verbs[i].map((v) => v.label), 'tm tb ta', 'middle', 16);
    }
  });
  // zonas
  const zone = (i0, i1, lab) => {
    const xa = 10 + i0 * (bw + gap), xb = 10 + i1 * (bw + gap) + bw, yz = by + bh + 14;
    return path(`M${r1(xa)},${yz} V${yz + 8} H${r1(xb)} V${yz}`, 's-muted') + txt((xa + xb) / 2, yz + 26, lab, 't tb', 'middle');
  };
  s += zone(0, 1, 'tu máquina, o CI') + zone(2, 2, 'el registry') + zone(3, 3, 'otra máquina');
  s += txt(10, 30, `${arts.length} cosas unidas por ${d.steps.filter((x) => x.type === 'command').length} comandos`, 't tb');
  return svgBox(W, by + bh + 52, s, 'La cadena: Dockerfile, build, imagen, tag y push, registry, pull y run, contenedor', 0.8);
}
function chainCmds(d) {
  return `<ol class="chain">${d.steps.filter((x) => x.type === 'command').map((c) => `<li><span class="chain__v">${esc(c.label)}</span><span class="cmdw"><code class="cmd">${esc(c.cmd)}</code>${copyBtn(c.cmd)}</span>${c.out ? `<span class="chain__out">imprime <code>${esc(c.out)}</code></span>` : ''}</li>`).join('')}</ol>`;
}

// 1 · Anatomía: cuándo actúa cada instrucción y si deja una capa.
function figAnatomy(d) {
  const W = 800, colW = 186, gx = (W - 20 - 4 * colW) / 3, top = 64, chipH = 30, chipG = 10;
  const cols = [['Solo en el build', []], ['En el build y al correr', []], ['Solo al correr', []], ['En ninguno: metadato', []]];
  for (const r of d.rows) {
    const when = r[2], fs = r[1];
    const build = /build/i.test(when), run = /\brun\b/i.test(when), none = /^ningun/i.test(when);
    const kind = /^(Sí|Pone las capas)/i.test(fs) ? 'layer' : /^Solo crea/i.test(fs) ? 'dir' : 'cfg';
    const ci = none ? 3 : build && run ? 1 : build ? 0 : 2;
    cols[ci][1].push({ name: r[0], kind });
  }
  let s = DEFS, maxN = 0;
  cols.forEach(([lab, list], i) => {
    const x0 = 10 + i * (colW + gx);
    s += rect(x0, 18, colW, 30, i === 3 ? 'f-free' : 'f-accent-soft', 'rx="7"') + txt(x0 + colW / 2, 38, lab, 'tl tb', 'middle');
    list.forEach((c, j) => {
      const y = top + j * (chipH + chipG);
      const cls = c.kind === 'layer' ? 'f-accent' : 'f-paper ' + (c.kind === 'dir' ? 's-accent' : 's-rule');
      s += rect(x0 + 10, y, colW - 20, chipH, cls, `rx="6"${c.kind === 'dir' ? ' stroke-dasharray="5 3" stroke-width="1.6"' : ''}`);
      s += txt(x0 + colW / 2, y + 20, c.name, c.kind === 'layer' ? 'tw tm' : 'tm tb', 'middle');
    });
    maxN = Math.max(maxN, list.length);
  });
  const ly = top + maxN * (chipH + chipG) + 16;
  s += rect(10, ly - 12, 18, 14, 'f-accent', 'rx="3"') + txt(34, ly, 'deja una capa (contenido)', 't');
  s += rect(250, ly - 12, 18, 14, 'f-paper s-accent', 'rx="3" stroke-dasharray="4 2"') + txt(274, ly, 'solo crea el directorio si falta', 't');
  s += rect(530, ly - 12, 18, 14, 'f-paper s-rule', 'rx="3"') + txt(554, ly, 'solo configuración', 't');
  return svgBox(W, ly + 14, s, 'Instrucciones del Dockerfile según cuándo actúan y si dejan una capa', 0.8);
}

// 2 · Capas: la cascada de invalidación, con los tamaños a escala.
function figLayers(d) {
  const W = 880, top = 46, rh = 34, X0 = 520, BW = 200;
  const L = d.layers, k = d.changed_at, maxMb = Math.max(...L.map((l) => l.size_mb));
  let s = DEFS;
  s += txt(16, 26, 'i', 't tb') + txt(42, 26, 'Instrucción (en el orden del Dockerfile)', 't tb') + txt(X0, 26, 'Tamaño comprimido (a escala)', 't tb') + txt(W - 14, 26, 'En el build', 't tb', 'end');
  L.forEach((l, i) => {
    const y = top + i * rh, changed = i === k, rebuilt = i >= k;
    if (rebuilt) s += rect(8, y + 2, W - 16, rh - 4, changed ? 'f-hi-soft' : 'f-warn-soft', 'rx="6"');
    s += txt(16, y + 22, String(i), 'tm', 'start') + txt(42, y + 22, l.instr, 'tm');
    const w = l.size_mb > 0 ? Math.max(2, (l.size_mb / maxMb) * BW) : 0;
    if (w) s += rect(X0, y + 10, w, 14, rebuilt ? 'f-warn' : 'f-accent2', 'rx="2"');
    s += txt(X0 + w + (w ? 8 : 0), y + 22, `${n(l.size_mb, 2)} MB`, 'tl');
    const chip = changed ? ['cambió', 'f-hi', 'tl ton-hi'] : rebuilt ? ['se rehace', 'f-warn', 'tl tw'] : ['CACHED', 'f-accent2', 'tl tw'];
    s += rect(W - 104, y + 8, 90, 20, chip[1], 'rx="10"') + txt(W - 59, y + 22, chip[0], chip[2], 'middle');
  });
  const yEnd = top + L.length * rh;
  const sum = L.slice(k).reduce((a, l) => a + l.size_mb, 0);
  s += `<text x="16" y="${yEnd + 26}" class="tl tb">Desde k = ${k}: se rehacen ${L.length - k} de ${L.length} pasos y vuelven a viajar Σ s<tspan dy="4" font-size="10">i</tspan><tspan dy="-4"> (i ≥ ${k}) ≈ ${n(sum, 0)} MB en cada deploy.</tspan></text>`;
  return svgBox(W, yEnd + 40, s, 'Cascada de invalidación de la caché: desde la instrucción que cambió se rehace todo lo que sigue', 0.8);
}

// 3 · Multi-stage: dos etapas, lo que cruza y el tamaño de cada base a escala.
function figMultistage(d) {
  const W = 920, bw = 390, gap = W - 20 - 2 * bw, top = 20;
  const st = d.stages, wraps = st.map((x) => x.steps.map((t) => wrap(t, 46)));
  const bodyH = Math.max(...wraps.map((ws) => ws.reduce((a, l) => a + l.length * 15 + 8, 0)));
  const bh = 70 + bodyH + 8;
  let s = DEFS;
  const maxMb = 5000, scale = (bw - 20) / maxMb;
  st.forEach((g, i) => {
    const x0 = 10 + i * (bw + gap), final = i === st.length - 1;
    s += rect(x0, top, bw, bh, final ? 'f-paper s-accent2' : 'f-paper s-rule', `rx="10"${final ? ' stroke-width="1.8"' : ' stroke-dasharray="6 4"'}`);
    s += txt(x0 + 14, top + 24, `etapa ${g.name}`, 'tl tb tbig') + txt(x0 + bw - 14, top + 24, final ? 'imagen final: lo que se publica' : 'no viaja en la imagen final', final ? 't ta2 tb' : 't tb', 'end');
    s += txt(x0 + 14, top + 48, `FROM ${g.base}`, 'tm tb');
    let yy = top + 74;
    wraps[i].forEach((ls, j) => {
      const isCopy = /COPY --from/.test(g.steps[j]);
      if (isCopy) s += rect(x0 + 8, yy - 13, bw - 16, ls.length * 15 + 6, 'f-accent2-soft', 'rx="4"');
      s += tlines(x0 + 14, yy, ls, 'tm', 'start', 15); yy += ls.length * 15 + 8;
    });
    // tamaño de la base, a escala
    const yb = top + bh + 18;
    s += rect(x0 + 10, yb, g.size_mb * scale, 16, final ? 'f-accent2' : 'f-warn', 'rx="2"');
    s += txt(x0 + 10 + g.size_mb * scale + 8, yb + 13, `≈ ${n(g.size_mb / 1000, 2)} GB`, 'tl tb');
    s += txt(x0 + 10, yb + 36, 'base comprimida (amd64)', 't');
  });
  // la copia
  const ya = top + bh / 2 + 10;
  s += arrow(`M${10 + bw + 6},${ya} L${10 + bw + gap - 8},${ya}`, 's-accent2', 2.4);
  for (const c of d.copies) {
    const what = c.what.split(' (')[0];
    s += txt(10 + bw + gap / 2, ya - 10, 'COPY --from', 'tm tb ta2', 'middle') + txt(10 + bw + gap / 2, ya + 22, what, 'tm', 'middle');
  }
  const yAxis = top + bh + 18 + 72;
  s += txt(10, yAxis, `Cruza a la etapa final: ${d.copies.map((c) => c.what).join(' · ')}`, 'tl tb');
  return svgBox(W, yAxis + 14, s, 'Build multi-stage: la etapa builder sobre la imagen devel y la final sobre runtime; solo cruza el venv', 0.8);
}

// 4 · Ciclo de vida: máquina de estados con la disposición a mano y las aristas de los datos.
const LC_POS = { imagen: [90, 220], created: [310, 220], running: [560, 220], paused: [560, 70], restarting: [830, 220], exited: [560, 410], dead: [830, 410], eliminado: [90, 410] };
const LC_ROUTE = {
  'imagen>created': { d: 'M152,220 H243', at: [197, 207, 'middle'] },
  'imagen>running': { d: 'M90,198 V150 H520 V198', at: [305, 140, 'middle'] },
  'created>running': { d: 'M377,220 H493', at: [435, 207, 'middle'] },
  'running>paused': { d: 'M575,198 V92', at: [567, 122, 'end'] },
  'paused>running': { d: 'M605,92 V198', at: [613, 122, 'start'] },
  'running>restarting': { d: 'M627,210 H763', at: [695, 181, 'middle'], wrap: 24 },
  'restarting>running': { d: 'M763,232 H627', at: [695, 252, 'middle'], wrap: 22 },
  'running>exited': { d: 'M575,242 V388', at: [619, 290, 'start'], wrap: 34, pre: '↓ ' },
  'exited>running': { d: 'M605,388 V242', at: [619, 344, 'start'], pre: '↑ ' },
  'created>eliminado': { d: 'M292,242 L84,388', at: [176, 322, 'end'] },
  'running>eliminado': { d: 'M497,242 L136,388', at: [338, 333, 'start'] },
  'exited>eliminado': { d: 'M493,410 H154', at: [322, 401, 'middle'] },
  'exited>dead': { d: 'M627,410 H763', at: [695, 384, 'middle'], wrap: 18 },
};
function figLifecycle(d) {
  const W = 920, H = 460, pseudo = new Set(d.pseudo || []);
  let s = DEFS;
  for (const [a, b, lab] of d.edges) {
    const r = LC_ROUTE[`${a}>${b}`];
    const pa = LC_POS[a], pb = LC_POS[b];
    const route = r || { d: `M${pa[0]},${pa[1]} L${pb[0]},${pb[1]}`, at: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 - 8, 'middle'] };
    const bad = /kill|SIGKILL|OOM|falló/i.test(lab);
    s += arrow(route.d, b === 'restarting' || a === 'restarting' ? 's-hi' : 's-muted', 1.6);
    const ls = route.wrap ? wrap((route.pre || '') + lab, route.wrap) : [(route.pre || '') + lab];
    s += tlines(route.at[0], route.at[1], ls, bad ? 't halo' : 't halo', route.at[2], 14);
  }
  for (const st of d.states) {
    const [cx, cy] = LC_POS[st] || [W / 2, H / 2], w = pseudo.has(st) ? 120 : 130;
    const cls = pseudo.has(st) ? 'f-bg s-muted' : st === 'running' ? 'f-accent2-soft s-accent2' : st === 'dead' ? 'f-warn-soft s-warn' : st === 'paused' || st === 'restarting' ? 'f-hi-soft s-hi' : 'f-paper s-ink';
    s += rect(cx - w / 2, cy - 20, w, 40, cls, `rx="${pseudo.has(st) ? 6 : 20}"${pseudo.has(st) ? ' stroke-dasharray="5 4"' : ''}`);
    s += txt(cx, cy + 5, st, pseudo.has(st) ? 't tb' : 'tm tb tbig', 'middle');
  }
  s += txt(14, 20, 'Recuadros punteados: no son estados del contenedor (la imagen de partida y el contenedor ya borrado).', 't');
  return svgBox(W, H, s, 'Estados de un contenedor y los comandos que lo mueven', 0.8);
}

// 5 · Señales: línea de tiempo a escala, un carril por PID 1.
function figSignals(d) {
  const W = 860, X0 = 26, X1 = 746, tMax = 12, T0 = 70, LH = 82;
  const x = (t) => X0 + (Math.min(t, tMax) / tMax) * (X1 - X0);
  const lanes = d.lanes || [];
  const yAxis = T0 + lanes.length * LH + 4;
  let s = DEFS;
  s += rect(x(0), T0 - 8, x(d.grace_s) - x(0), yAxis - T0 + 8, 'f-free', 'opacity="0.55"');
  for (const e of d.events) {
    s += line(x(e.t), T0 - 26, x(e.t), yAxis, e.t === 0 ? 'l-accent' : 'l-hi-d');
    s += txt(x(e.t) + (e.t === 0 ? 0 : 0), T0 - 32, e.label, e.t === 0 ? 'tl tb' : 'tl tb thi', e.t === 0 ? 'start' : 'end');
  }
  lanes.forEach((ln, i) => {
    const y0 = T0 + i * LH + 6, tEnd = Math.max(...ln.events.map((e) => e.t));
    const ex = String(ln.exit), cls = /137/.test(ex) ? ['f-warn', 'f-warn-soft', 'twarn'] : /143/.test(ex) ? ['f-hi', 'f-hi-soft', 'thi'] : ['f-accent2', 'f-ok-soft', 'ta2'];
    s += txt(X0, y0 + 12, ln.name, 'tl tb');
    const exl = `exit ${ex}`, ew = exl.length * 7.1 + 18;
    s += rect(W - 14 - ew, y0, ew, 20, cls[1], 'rx="10"') + txt(W - 14 - ew / 2, y0 + 14, exl, `tl tb ${cls[2]}`, 'middle');
    s += rect(x(0), y0 + 22, Math.max(3, x(tEnd) - x(0)), 12, cls[0], 'rx="3"');
    const m = ln.name.match(/(\d+)\s*s\b/);
    if (m && +m[1] > d.grace_s && tEnd >= d.grace_s) {
      s += rect(x(d.grace_s), y0 + 22, x(tMax) - x(d.grace_s), 12, 'f-paper s-warn', 'rx="3" stroke-dasharray="4 3"') + txt(x(tMax) + 6, y0 + 32, `→ ${m[1]} s`, 't twarn');
    }
    ln.events.forEach((e) => { s += `<circle cx="${r1(x(e.t))}" cy="${y0 + 28}" r="4.5" class="f-paper s-ink"/>`; });
    const first = ln.events[0], last = ln.events[ln.events.length - 1];
    s += txt(x(first.t), y0 + 54, first.label, 't');
    if (last !== first) {
      if (x(last.t) > x(5)) s += txt(x(last.t), y0 + 70, last.label, 't tb', 'end');
      else s += txt(x(last.t) + 10, y0 + 33, `${n(last.t, 1)} s: ${last.label}`, 't tb halo');
    }
  });
  s += line(x(0), yAxis, x(tMax), yAxis, 'ax');
  for (let t = 0; t <= tMax; t += 2) s += line(x(t), yAxis, x(t), yAxis + 6, 'ax') + txt(x(t), yAxis + 20, `${t} s`, 't', t === 0 ? 'start' : 'middle');
  s += txt((x(0) + x(d.grace_s)) / 2, yAxis + 38, `plazo de docker stop: ${d.grace_s} s (a escala)`, 't tb', 'middle');
  return svgBox(W, yAxis + 48, s, 'Qué pasa cuando docker stop manda SIGTERM: cuatro casos de PID 1 con su código de salida', 0.8);
}

// 6 · Redes: tu Mac, la VM de Docker Desktop, la red del proyecto y los contenedores.
function figNetwork(d) {
  const W = 980, cs = d.containers, ch = 96, cx = 440, cw = 372, top = 132, gapY = 150;
  const H = top + (cs.length - 1) * gapY + ch + 44;
  let s = DEFS;
  s += rect(8, 8, W - 16, H - 16, 'f-bg s-rule', 'rx="14" stroke-width="1.4"') + txt(26, 34, d.host, 'tl tb tbig');
  s += rect(258, 46, W - 278, H - 66, 'f-free s-rule', 'rx="12"') + tlines(276, 70, wrap(d.vm, 80), 'tl tb', 'start', 15);
  s += rect(286, 90, W - 318, H - 116, 'f-paper s-accent', 'rx="10" stroke-dasharray="6 4"') + txt(302, 112, `red ${d.network}`, 'tm tb ta');
  s += rect(26, 90, 210, H - 116, 'f-paper s-rule', 'rx="10"') + txt(40, 112, 'desde el Mac (navegador, curl)', 't tb');
  const pos = {};
  cs.forEach((c, i) => {
    const y = top + i * gapY;
    pos[c.name] = i;
    s += rect(cx, y, cw, ch, 'f-paper s-ink', 'rx="10"') + txt(cx + 14, y + 24, c.name, 'tm tb tbig');
    s += txt(cx + 14, y + 44, `DNS: ${c.dns || c.name} · escucha en 0.0.0.0:${c.port}`, 't');
    s += txt(cx + 14, y + 63, `publicado: ${c.published}`, 'tm');
    if (c.calls) s += txt(cx + 14, y + 83, `llama a: ${c.calls.join(' · ')}`, 'tm tb ta2');
    const hostPorts = c.published.split('·').map((p) => p.trim().split(':')[0]);
    s += txt(40, y + 40, `localhost:${hostPorts[0]}`, 'tm tb');
    if (hostPorts.length > 1) s += txt(40, y + 57, hostPorts.slice(1).map((p) => ':' + p).join(' · '), 'tm');
    s += txt(40, y + (hostPorts.length > 1 ? 74 : 57), `→ ${c.name}`, 't');
    s += arrow(`M238,${y + ch / 2} H${cx - 4}`, 's-accent', 2);
  });
  // llamadas entre contenedores: vecinos con una flecha corta; si salta una tarjeta, por la derecha
  let side = 0;
  const nAdj = {};
  cs.forEach((c) => (c.calls || []).forEach((call) => {
    const to = call.split(':')[0];
    if (!(to in pos)) return;
    const i = pos[c.name], j = pos[to];
    if (Math.abs(i - j) === 1) {
      const gi = Math.min(i, j), k = nAdj[gi] = (nAdj[gi] || 0) + 1;
      const xa = cx + cw - 60 - (k - 1) * 120, yTop = top + gi * gapY + ch, yBot = top + (gi + 1) * gapY;
      s += arrow(i > j ? `M${xa},${yBot - 2} V${yTop + 4}` : `M${xa},${yTop + 2} V${yBot - 4}`, 's-accent2', 2);
      s += txt(xa - 10, (yTop + yBot) / 2 + 5, call, 'tm tb ta2', 'end');
    } else {
      const xr = cx + cw + 30 + side * 24, y1 = top + i * gapY + ch / 2, y2 = top + j * gapY + ch / 2;
      s += arrow(`M${cx + cw + 2},${y1} H${xr} V${y2} H${cx + cw + 4}`, 's-accent2', 2);
      s += txt(xr - 6, (y1 + y2) / 2 + 5, call, 'tm tb ta2 halo', 'end');
      side++;
    }
  }));
  return svgBox(W, H, s, 'La red de Compose de C01 vista desde tu Mac: puertos publicados y nombres DNS entre contenedores', 0.8);
}

// 7 · Volúmenes: de dónde salen los datos de cada montaje y qué sobrevive.
function figVolumes(d) {
  const W = 960, H = 396;
  const row = (k) => d.rows.find((r) => r[0] === k) || [];
  const flags = row('Con -v'), where = row('Dónde viven los datos'), alive = row('¿Sobrevive a docker rm?');
  const parse = (f) => {
    const m = f.match(/(?:-v|--tmpfs)\s+(\S+)/); const parts = (m ? m[1] : f).split(':');
    return f.startsWith('--tmpfs') ? { src: '', dst: parts[0], opt: parts[1] || '' } : { src: parts[0], dst: parts[1], opt: parts[2] || '' };
  };
  const mts = [1, 2, 3].map((i) => ({ kind: d.head[i], flag: flags[i], ...parse(flags[i] || ''), where: where[i], alive: alive[i] }));
  const ys = [128, 222, 316];
  let s = DEFS;
  s += rect(8, 34, 236, H - 44, 'f-bg s-rule', 'rx="12"') + txt(24, 58, 'tu Mac', 'tl tb tbig');
  s += rect(262, 34, W - 270, H - 44, 'f-free s-rule', 'rx="12"') + txt(280, 58, 'VM Linux de Docker Desktop', 'tl tb tbig');
  s += rect(668, 70, W - 686, H - 88, 'f-paper s-ink', 'rx="10"') + txt(684, 92, 'contenedor', 't tb');
  mts.forEach((m, i) => {
    const y = ys[i];
    let sx;
    if (i === 0) { // carpeta del Mac
      s += `<path d="M30,${y - 22} h40 l8,8 h122 v38 h-170 z" class="f-paper s-accent" stroke-width="1.4"/>` + txt(42, y + 6, m.src, 'tm tb ta') + tlines(30, y + 36, wrap(m.where, 28), 't', 'start', 14);
      sx = 202;
    } else {
      const wl = wrap(m.where, 30), hasT = i === 1, bh2 = 18 + wl.length * 14 + (hasT ? 18 : 0);
      s += rect(282, y - bh2 / 2, 200, bh2, i === 1 ? 'f-paper s-accent' : 'f-hi-soft s-hi', 'rx="8"');
      if (hasT) s += txt(292, y - bh2 / 2 + 20, `volumen «${m.src}»`, 'tm tb ta');
      s += tlines(292, y - bh2 / 2 + (hasT ? 38 : 22), wl, 't', 'start', 14);
      sx = 484;
    }
    s += arrow(`M${sx},${y} H664`, i === 2 ? 's-hi' : 's-accent', 2);
    const mid = i === 0 ? 470 : (sx + 664) / 2;
    s += txt(mid, y - 22, m.kind, 'tl tb', 'middle') + txt(mid, y - 7, m.flag, 'tm', 'middle');
    s += txt(684, y + 4, m.dst + (m.opt ? `  (${m.opt})` : ''), 'tm tb tbig');
    s += tlines(684, y + 22, wrap(`¿sobrevive a docker rm? ${m.alive}`, 36), m.alive && /^no/i.test(m.alive) ? 't twarn' : 't ta2', 'start', 14);
  });
  return svgBox(W, H, s, 'Bind mount, volumen nombrado y tmpfs: de dónde salen los datos y si sobreviven a docker rm', 0.8);
}

// 8 · Compose: servicios, depends_on con su condición y el orden de arranque.
function figCompose(d) {
  const W = 1000, cw = 272, gap = (W - 20 - 3 * cw) / 2, top = 96;
  const sv = d.services, idx = Object.fromEntries(sv.map((x, i) => [x.name, i]));
  const keys = [['build', 'build'], ['image', 'image'], ['ports', 'ports'], ['healthcheck', 'healthcheck'], ['extra', ''], ['restart', 'restart'], ['env', 'environment'], ['volumes', 'volumes']];
  const cards = sv.map((x) => {
    const ls = [];
    for (const [k, lab] of keys) if (x[k]) wrap(lab ? `${lab}: ${x[k]}` : x[k], 36).forEach((l, i) => ls.push({ t: l, k: i === 0 ? k : '' }));
    return ls;
  });
  const ch = 44 + Math.max(...cards.map((c) => c.length)) * 16;
  let s = DEFS;
  s += txt(14, 26, `proyecto ${d.project} · red ${d.network}`, 'tm tb ta');
  const x0 = (i) => 10 + i * (cw + gap);
  sv.forEach((x, i) => {
    s += rect(x0(i), top, cw, ch, x.healthcheck ? 'f-paper s-accent2' : 'f-paper s-ink', `rx="10"${x.healthcheck ? ' stroke-width="1.8"' : ''}`);
    s += txt(x0(i) + 14, top + 26, x.name, 'tm tb tbig');
    cards[i].forEach((l, j) => { s += txt(x0(i) + 14, top + 50 + j * 16, l.t, l.k === 'healthcheck' || (!l.k && cards[i].slice(0, j).reverse().find((q) => q.k)?.k === 'healthcheck') ? 't ta2' : 't'); });
  });
  // depends_on
  let below = 0;
  sv.forEach((x, i) => (x.depends_on || []).forEach(([dep, cond]) => {
    const j = idx[dep]; if (j === undefined) return;
    const healthy = cond === 'service_healthy', cls = healthy ? 's-hi' : 's-muted';
    if (Math.abs(i - j) === 1) {
      const y = top + 40, xa = i > j ? x0(i) - 2 : x0(i) + cw + 2, xb = i > j ? x0(j) + cw + 4 : x0(j) - 4;
      s += `<path d="M${r1(xa)},${y} L${r1(xb)},${y}" class="${cls}" fill="none" stroke-width="${healthy ? 2.6 : 1.6}"${healthy ? '' : ' stroke-dasharray="5 4"'} marker-end="url(#${healthy ? 'arrhi' : 'arr'})"/>`;
      s += txt((xa + xb) / 2, top - 22, 'espera a que esté', 't', 'middle') + txt((xa + xb) / 2, top - 7, cond, healthy ? 'tm tb thi' : 'tm', 'middle');
    } else {
      const yb = top + ch + 26 + below * 22, xa = x0(i) + 40, xb = x0(j) + cw - 40;
      s += `<path d="M${xa},${top + ch + 2} V${yb} H${xb} V${top + ch + 4}" class="${cls}" fill="none" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arr)"/>`;
      s += txt((xa + xb) / 2, yb + 16, `espera a que esté ${cond}`, 'tm', 'middle');
      below++;
    }
  }));
  // orden de arranque
  const yo = top + ch + 26 + below * 22 + 54;
  s += txt(14, yo - 18, 'Orden de arranque', 't tb');
  let xx = 14;
  d.order.forEach((o, i) => {
    const lab = `${i + 1}  ${o}`, w = lab.length * 6.9 + 22;
    s += rect(xx, yo - 4, w, 26, i === 1 ? 'f-hi-soft s-hi' : 'f-paper s-rule', 'rx="13"') + txt(xx + w / 2, yo + 13, lab, 'tl', 'middle');
    if (i < d.order.length - 1) s += arrow(`M${r1(xx + w + 3)},${yo + 9} H${r1(xx + w + 25)}`, 's-muted', 1.4);
    xx += w + 30;
  });
  return svgBox(W, yo + 34, s, 'El compose de C01: triton tiene que estar healthy para que arranque el gateway', 0.8);
}

// 9 · GPU: lo que viaja en la imagen y lo que pone el host.
function figGpu(d) {
  const W = 900, cL = 112, cC = 304, cK = 596, top = 78;
  const rows = d.rows.map((r) => ({ ...r, c01: wrap(r.c01, 36), check: wrap(r.check, 38) }));
  let s = DEFS, y = top;
  s += rect(10, 10, W - 20, 34, 'f-accent-soft', 'rx="8"') + txt(24, 32, `La GPU se pide al correr: ${d.request}`, 'tl tb');
  s += txt(cL + 6, top - 12, 'Capa', 't tb') + txt(cC, top - 12, 'En C01', 't tb') + txt(cK, top - 12, 'Compruébalo con', 't tb');
  let prev = null, gStart = y;
  const groups = [];
  rows.forEach((r, i) => {
    if (prev !== null && r.where !== prev) {
      groups.push([prev, gStart, y]);
      if (prev === 'imagen') { // la frontera
        const ls = wrap(d.rule, 96);
        s += rect(10, y + 4, W - 20, 12 + ls.length * 15, 'f-hi-soft s-hi', 'rx="6"') + tlines(24, y + 19, ls, 'tl tb', 'start', 15);
        y += 24 + ls.length * 15;
      } else y += 6;
      gStart = y;
    }
    const h = Math.max(r.c01.length, r.check.length) * 15 + 18;
    s += rect(cL, y, W - 10 - cL, h - 4, r.where === 'imagen' ? 'f-paper s-accent' : r.where === 'host' ? 'f-paper s-rule' : 'f-free s-rule', 'rx="6"');
    s += txt(cL + 12, y + 20, r.layer, 'tl tb') + tlines(cC, y + 20, r.c01, 'tl', 'start', 15) + tlines(cK, y + 20, r.check, 'tm', 'start', 15);
    if (r.where !== 'imagen') s += txt(W - 18, y + h - 10, '✗ no en tu Mac', 't twarn tb', 'end');
    y += h; prev = r.where;
  });
  groups.push([prev, gStart, y]);
  for (const [g, a, b] of groups) s += path(`M${cL - 10},${a + 4} H${cL - 18} V${b - 8} H${cL - 10}`, 's-muted', 'stroke-width="1.4"') + txt(cL - 26, (a + b) / 2 + 4, g, 'tl tb', 'end');
  const ml = wrap(d.mac, 110);
  s += rect(10, y + 8, W - 20, 14 + ml.length * 15, 'f-warn-soft', 'rx="6"') + tlines(24, y + 25, ml, 'tl', 'start', 15);
  y += 26 + ml.length * 15;
  return svgBox(W, y + 8, s, 'La pila de GPU: servidor, framework y CUDA en la imagen; toolkit, driver y GPU en el host', 0.8);
}

// 10 · Arquitecturas: dónde construiste contra dónde corre.
function figArch(d) {
  const W = 900, cB = 14, cI = 330, cR = [508, 704], cw = 186, top = 56;
  let s = DEFS, y = top;
  s += txt(cB, 34, 'Cómo construiste', 't tb') + txt(cI, 34, 'Imagen', 't tb');
  d.run_on.forEach((r, i) => { s += rect(cR[i], 16, cw, 28, 'f-accent-soft', 'rx="7"') + txt(cR[i] + cw / 2, 35, `corre en ${r}`, 'tl tb', 'middle'); });
  for (const r of d.rows) {
    const b = wrap(r.build, 40), im = wrap(r.image, 22), cells = r.cells.map((c) => wrap(c.text, 22));
    const h = Math.max(b.length, im.length, ...cells.map((c) => c.length + 0.4)) * 15 + 22;
    s += rect(8, y, W - 16, h - 6, 'f-paper s-rule', 'rx="8"');
    s += tlines(cB + 6, y + 20, b, 'tl', 'start', 15) + tlines(cI, y + 20, im, 'tm tb', 'start', 15);
    r.cells.forEach((c, i) => {
      s += rect(cR[i], y + 5, cw, h - 16, c.ok ? 'f-ok-soft' : 'f-warn-soft', 'rx="6"');
      s += txt(cR[i] + 10, y + 21, c.ok ? '✓' : '✗', c.ok ? 'tl tb ta2' : 'tl tb twarn') + tlines(cR[i] + 26, y + 21, cells[i], 'tl', 'start', 15);
    });
    y += h;
  }
  return svgBox(W, y + 4, s, 'Matriz de arquitecturas: imagen arm64, amd64 o multi-plataforma contra tu Mac y el servidor', 0.8);
}

// 11 · Registries: anatomía de una referencia de imagen.
function figRef(d) {
  const W = 900, cw = 9.0, x0 = 30, yS = 70;
  const val = (k) => (d.rows.find((r) => r[0] === k) || [])[1] || '';
  const parts = [
    { k: '{registry}', t: val('{registry}'), cls: 'ta' },
    { k: '/', t: '/', cls: 'tmu' },
    { k: '{repo}', t: val('{repo}'), cls: 'ta2' },
    { k: ':{tag}', t: val(':{tag}'), cls: 'thi' },
    { k: '@sha256:{digest}', t: val('@sha256:{digest}').split(' (')[0], cls: 'tpu' },
  ];
  let s = DEFS, x = x0;
  const spans = [];
  for (const p of parts) { spans.push({ ...p, xa: x, xb: x + p.t.length * cw }); x += p.t.length * cw; }
  s += `<text x="${x0}" y="${yS}" class="tref">${spans.map((p) => `<tspan class="${p.cls}">${esc(p.t)}</tspan>`).join('')}</text>`;
  const rowOf = (k) => d.rows.find((r) => r[0] === k) || [];
  let tier = 0;
  for (const p of spans) {
    if (p.k === '/') continue;
    const r = rowOf(p.k), mid = (p.xa + p.xb) / 2, yb = yS + 12;
    s += path(`M${r1(p.xa + 2)},${yb} V${yb + 7} H${r1(p.xb - 2)} V${yb}`, 's-muted', 'stroke-width="1.3"');
    const ly = yb + 32 + tier * 52;
    s += line(mid, yb + 7, mid, ly - 16, 'ax');
    const est = Math.max(p.k.length * 7.6, (`si falta: ${r[2]}`).length * 6.6) / 2, anchor = 'middle', lx = Math.min(Math.max(mid, est + 8), W - est - 8);
    s += `<text x="${r1(lx)}" y="${ly}" class="tm tb" text-anchor="${anchor}">${svgPh(p.k)}</text>`;
    s += txt(lx, ly + 16, `si falta: ${r[2]}`, 't', anchor);
    tier = 1 - tier;
  }
  const ns = rowOf('{namespace}');
  const sl = spans[1];
  s += `<text x="${r1(sl.xa + 4)}" y="${yS - 30}" class="t tb" text-anchor="middle">${svgPh('{namespace}')}: ${esc(ns[1])}</text>` + line(sl.xa + 4, yS - 26, sl.xa + 4, yS - 16, 'ax');
  return svgBox(W, yS + 134, s, 'Las partes de una referencia de imagen con los valores de C01', 0.8);
}

// ---------------------------------------------------------------- secciones
const reg = (() => {
  const out = {};
  const ctx = { MSD: { register(o) { out[o.id] = o; }, addSection(id, sec) { (out[id] = out[id] || { id, sections: [] }).sections = (out[id].sections || []).concat([sec]); }, files: {} } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['m05-contenedores.js', 'm06-orquestacion.js', 'm11-despliegue.js', 'm15-seguridad.js', 'ref-comandos.js', 'c01-archivos.js']) {
    try { vm.runInContext(readFileSync(join(APP, 'js/content', f), 'utf8'), ctx, { filename: f }); } catch (e) { console.warn('aviso: no pude cargar', f, e.message); }
  }
  return out;
})();
const MODLAB = (m) => (m === 'ref-comandos' ? 'Docker y kubectl' : /^m\d+$/.test(m) ? 'M' + parseInt(m.slice(1), 10) : m.toUpperCase());
const missingLinks = [];
function linkChip(anchor) {
  const [m, id] = anchor.replace(/^#/, '').split('.');
  const sec = (reg[m]?.sections || []).find((x) => x.id === id);
  if (!sec) missingLinks.push(anchor);
  return `<a class="chip" href="https://ronda-diseno-ml.vercel.app/#${esc(anchor.replace(/^#/, ""))}" target="_blank" rel="noopener">${esc(MODLAB(m))} · ${esc(sec ? sec.title : id)}</a>`;
}

const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
const ORDER = ['bolsillo', 'cadena', 'anatomia', 'capas-cache', 'imagenes-chicas', 'run', 'pid1', 'redes', 'volumenes', 'compose', 'gpu', 'arquitecturas', 'registries', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', anatomia: '1 · Anatomía', 'capas-cache': '2 · Capas y caché', 'imagenes-chicas': '3 · Imágenes chicas', run: '4 · docker run', pid1: '5 · PID 1', redes: '6 · Redes', volumenes: '7 · Volúmenes', compose: '8 · Compose', gpu: '9 · GPU', arquitecturas: '10 · arm64 / amd64', registries: '11 · Registries', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje apunta a la mejor de las 15 secciones según su tema, con casos puntuales.
const TOPIC_SECTION = { daemon: 'diagnostico', cli: 'diagnostico', registry: 'registries', compose: 'compose', red: 'redes', arquitectura: 'arquitecturas', gpu: 'gpu', memoria: 'run', disco: 'diagnostico', build: 'capas-cache', cmd: 'anatomia' };
const ERR_OVERRIDE = [
  [/^exec \/entrypoint\.sh: no such file/, 'diagnostico'],       // CRLF en el shebang: lo explica la tabla de la sección 12
  [/^failed to solve: process/, 'arquitecturas'],                 // un RUN que falla: el caso típico es el wheel de otra arquitectura
  [/^invalid reference format/, 'registries'],                    // nombre de imagen con mayúsculas
  [/^unknown flag: --gpu\b/, 'gpu'],                              // typo de --gpus
  [/\bnot a TTY\b|TTY-enabled container/, 'run'],                  // -it sin terminal
];
const ERRS = W3.errores.map((e) => {
  const o = ERR_OVERRIDE.find(([re]) => re.test(e.msg));
  const sec = o ? o[1] : TOPIC_SECTION[e.topic];
  if (!byId[sec]) throw new Error('sin sección para ' + e.topic);
  return { ...e, sec, was: e.section };
});
// Si una edición del contenido deja a un caso puntual sin mensaje, que falle el build y no en silencio.
ERR_OVERRIDE.forEach(([re, sec]) => { const n = W3.errores.filter((e) => re.test(e.msg)).length; if (n !== 1) throw new Error(`ERR_OVERRIDE ${re} → ${sec} coincide con ${n} mensajes`); });

function stripLead(s, lead) { return String(s).replace(new RegExp('^' + lead + ':\\s*', 'i'), ''); }

function padHtml(x) {
  const tpls = x.templates.map((t) => `<div class="tpl"><pre class="tpl__code">${phT(t.code)}</pre>${t.note ? `<p class="tpl__note">${phs(nbFlags(rich(t.note)))}</p>` : ''}</div>`).join('');
  const f = (x.formulas || []).map(mb).join('');
  const vars = `<table class="vars stk vt"><colgroup><col style="width:30%"><col style="width:38%"><col style="width:32%"></colgroup><thead><tr><th scope="col">Variable</th><th scope="col">Qué es</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.vars.map(([v, q, e]) => `<tr><th scope="row" class="rh">${/\{/.test(v) ? ph(v) : mi(symTex(v))}</th><td data-k="Qué es">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="pad"><div class="pad__grid${f ? '' : ' nofx'}"><div class="pad__tpl"><p class="tag">Sintaxis con variables</p><div class="tpls">${tpls}</div></div><div class="pad__vars"><p class="tag">Variables</p>${vars}</div>${f ? `<div class="pad__fx"><p class="tag">Fórmulas</p>${f}</div>` : ''}</div></div>`;
}
function piecesHtml(x) {
  return `<div class="card pieces"><h3>Las piezas</h3><table class="vars stk pz"><colgroup><col style="width:29%"><col style="width:41%"><col style="width:30%"></colgroup><thead><tr><th scope="col">Pieza</th><th scope="col">Qué hace</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.pieces.map(([p, q, e]) => `<tr><th scope="row" class="rh p">${ph(p)}</th><td data-k="Qué hace">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table></div>`;
}
function tablesHtml(x) {
  return (x.tables || []).map((t) => `<div class="card tbl"><h3>${esc(t.caption)}</h3>${dataTable(t.head, t.rows, { cls: t.head.length >= 4 ? 'wide4' : '' })}${t.note ? `<p class="fig__note">${tx(t.note)}</p>` : ''}</div>`).join('');
}
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner = '';
  switch (f.kind) {
    case 'layers': inner = figLayers(D); break;
    case 'multistage': inner = figMultistage(D); break;
    case 'lifecycle': inner = figLifecycle(D); break;
    case 'signals': inner = figSignals(D); break;
    case 'network': inner = figNetwork(D) + notesList(D.notes); break;
    case 'volumes': inner = figVolumes(D) + dataTable(D.head, D.rows, { cls: 'wide4' }) + notesList(D.notes); break;
    case 'compose': inner = figCompose(D); break;
    case 'gpu-stack': inner = figGpu(D); break;
    case 'arch': inner = figArch(D); break;
    case 'chain': inner = figChain(D) + chainCmds(D) + notesList(D.notes); break;
    case 'table': {
      const tb = D.head ? dataTable(D.head, D.rows, { cls: D.head.length >= 5 ? 'wide5' : 'wide4', phCells: x.id === 'registries', mono: x.id === 'diagnostico' ? [2] : x.id === 'bolsillo' ? [0] : x.id === 'anatomia' ? [0] : [] }) + noteP(D.note) : '';
      inner = (x.id === 'bolsillo' ? figSizes(D) : x.id === 'anatomia' ? figAnatomy(D) : x.id === 'registries' ? figRef(D) : '') + tb;
      break;
    }
    default: throw new Error('figura desconocida: ' + f.kind);
  }
  const hasTable = /<table/.test(inner);
  return `<figure class="fig${hasTable ? ' has-table' : ''}">${inner}<figcaption>${esc(f.caption)}</figcaption></figure>`;
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
  </div>`;
}
function exampleHtml(x) {
  const e = x.example;
  return `<div class="example"><h3>Ejemplo real · ${esc(e.title)}</h3>${codeBlock(e.code, e.lang, null, e.source)}${e.notes && e.notes.length ? `<ul class="ex__notes">${e.notes.map((t) => `<li>${nbFlags(rich(t))}</li>`).join('')}</ul>` : ''}</div>`;
}
const notesHtml = (x) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p><p>${nbFlags(rich(stripLead(x.memo, 'Cómo recordarla')))}</p></div><div class="trap"><p class="tag">Trampa</p><p>${nbFlags(rich(stripLead(x.trap, 'Trampa')))}</p></div></div>`;
const linksHtml = (x) => (x.links && x.links.length ? `<p class="links"><span class="links__k">En el curso:</span> ${x.links.map(linkChip).join(' ')}</p>` : '');
function labHtml(x) {
  const l = x.lab; if (!l) return '';
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  const ver = l.verified === 'executed' ? 'Ejecutado en una sesión con Docker.' : 'Verificado contra la documentación; no ejecutado aquí.';
  return `<details class="lab"><summary><span class="lab__t">Laboratorio en tu Mac (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
    <p class="lab__goal"><span class="k">Qué vas a provocar:</span> ${tx(l.goal)}</p>
    ${l.needs ? `<p class="lab__needs small"><span class="k">Necesitas:</span> ${tx(l.needs)}</p>` : ''}
    <ol class="lab__steps">${steps}</ol>
    <div class="lab__fix"><p class="tag">Cómo arreglarlo y confirmarlo</p><p>${tx(l.fix)}</p></div>
    <p class="verified">${ver}${l.verified_note ? ` <span>${esc(l.verified_note)}</span>` : ''}</p>
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

// ---------------------------------------------------------------- herramientas
const BAD_EXAMPLE = `# EJEMPLO con errores a propósito: es para probar el revisor, no lo copies
FROM python:latest
ARG HF_TOKEN
WORKDIR /app
COPY . .
RUN pip install -r requirements.txt
RUN apt-get update
RUN apt-get install -y ffmpeg
RUN cd /app && curl -fsSL https://example.com/install.sh | sh
ADD config.yaml /app/config.yaml
EXPOSE 8080 # puerto de la API
CMD python app.py
`;
function toolsHtml() {
  const D = W3.diagnosticador;
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">Corre primero</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y una revisión rápida de tu Dockerfile.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué correr primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de Dockerfile</h3>
    <p class="small">Revisa ${W1.revisor.length} reglas típicas con expresiones regulares, en tu navegador: detecta lo común, no reemplaza construir la imagen.</p>
    <label class="rv-label" for="rv-text" id="rv-label">EJEMPLO con errores a propósito: bórralo y pega tu Dockerfile</label>
    <textarea id="rv-text" rows="14" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-c01" type="button">Cargar el Dockerfile del gateway de C01</button><button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
  </div>
</section>`;
}

// ---------------------------------------------------------------- CSS
const CSS = `
/* Mismo diseño que el Formulario de estimaciones: papel cuadriculado para la sintaxis, tinta azul, resaltador ámbar. */
:root {
  --bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --c1: #2f6fbd; --c2: #2a9d8f; --c3: #e0a32b; --c4: #8a6fc7; --c5: #c8566f;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --on-hi: #18212d;
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --c1: #6ea8ff; --c2: #4fcfbf; --c3: #f2c14e; --c4: #b39cf0; --c5: #f08aa0;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --on-hi: #0e131a; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --c1: #6ea8ff; --c2: #4fcfbf; --c3: #f2c14e; --c4: #b39cf0; --c5: #f08aa0;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --on-hi: #0e131a; color-scheme: dark; }
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
.dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
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
.pieces .vars { margin-top: 4px; }
figure.fig { min-width: 0; margin: 18px 0 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 14.5px; margin-top: 10px; }
.scroll { overflow-x: auto; overflow-y: hidden; }
svg.chart { width: 100%; height: auto; display: block; margin: 0 auto; }
svg .t { fill: var(--muted); font: 12.5px var(--f-display); } svg .tl { fill: var(--ink); font: 13px var(--f-display); } svg .tb { font-weight: 700; }
svg .tm { fill: var(--ink); font: 12.5px var(--f-mono); } svg .tmu { fill: var(--muted); font: 15px var(--f-mono); } svg .tbig { font-size: 15px; }
svg .tref { font: 600 15px var(--f-mono); } svg .tpu { fill: var(--pu); }
svg .ta { fill: var(--accent); } svg .ta2 { fill: var(--accent2); } svg .twarn { fill: var(--warn); } svg .thi { fill: var(--hi-ink); }
svg .halo { paint-order: stroke; stroke: var(--paper); stroke-width: 4px; stroke-linejoin: round; }
svg .tw { fill: var(--onbar); font-weight: 700; } svg .ton-hi { fill: var(--on-hi); font-weight: 700; }
svg .tph { font-family: var(--f-body); font-style: italic; font-weight: 600; fill: var(--accent); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .grid-s { stroke: var(--muted); stroke-width: 1; opacity: .45; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .l-dash { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 5 4; } svg .l-accent { stroke: var(--accent); stroke-width: 1.8; } svg .l-hi { stroke: var(--hi); stroke-width: 2.4; } svg .l-hi-d { stroke: var(--hi); stroke-width: 2.2; stroke-dasharray: 6 4; }
svg .s-accent { stroke: var(--accent); } svg .s-accent2 { stroke: var(--accent2); } svg .s-muted { stroke: var(--muted); } svg .s-rule { stroke: var(--rule); stroke-width: 1.2; } svg .s-ink { stroke: var(--ink); stroke-width: 1.2; } svg .s-hi { stroke: var(--hi); stroke-width: 1.6; } svg .s-warn { stroke: var(--warn); stroke-width: 1.4; } svg .s-paper { stroke: var(--paper); }
svg .f-accent { fill: var(--accent); } svg .f-accent-soft { fill: var(--accent-soft); } svg .f-accent2 { fill: var(--accent2); } svg .f-accent2-soft { fill: var(--accent2-soft); } svg .f-ok-soft { fill: var(--ok-soft); }
svg .f-hi { fill: var(--hi); } svg .f-hi-soft { fill: var(--hi-soft); } svg .f-warn { fill: var(--warn); } svg .f-warn-soft { fill: var(--warn-soft); } svg .f-paper { fill: var(--paper); } svg .f-bg { fill: var(--bg); } svg .f-muted { fill: var(--muted); } svg .f-free { fill: var(--free); }
svg .f-c1 { fill: var(--c1); } svg .f-c2 { fill: var(--c2); } svg .f-c3 { fill: var(--c3); } svg .f-c4 { fill: var(--c4); } svg .f-c5 { fill: var(--c5); }
.tscroll { overflow-x: auto; margin-top: 12px; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 7px 8px 7px 6px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt th.rh { font: 600 14px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
.dt .mono, .dt th.rh.mono { font: 600 13px/1.5 var(--f-mono); }
.dt td.mono { font-weight: 400; }
.dt th.rh.nw { white-space: nowrap; }
.fig__note { color: var(--muted); font-size: 14.5px; margin: 8px 0 0; }
.fig__notes { margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 14.5px; }
ol.chain { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; font-size: 14.5px; }
ol.chain li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.chain__v { flex: none; min-width: 52px; font: 700 12px/1.4 var(--f-mono); color: var(--accent); text-transform: uppercase; letter-spacing: .05em; }
.chain__out { color: var(--muted); font-size: 13.5px; }
.cmdw { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; }
code, code.cmd { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
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
.tools .tool { margin-top: 14px; }
.tool > h3 { font-size: 16px; }
.dg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dg-chip { font: 500 14px/1.35 var(--f-display); text-align: left; color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 11px; cursor: pointer; max-width: 100%; }
.dg-chip:hover, .dg-chip:focus-visible { border-color: var(--accent); outline: none; }
.dg-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.dg-pick { display: none; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 10px; }
@media (max-width: 640px) { .dg-chips { display: none; } .dg-pick { display: grid; } }
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
#rv-text { display: block; width: 100%; margin-top: 6px; min-height: 260px; font: 13px/1.55 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; resize: vertical; white-space: pre; overflow: auto; }
.rv-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.rv-out { margin-top: 12px; }
.rv-sum { margin: 0 0 8px; font: 600 15px var(--f-display); }
ol.rv-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
ol.rv-list li { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; }
ol.rv-list li.sev-error { border-left-color: var(--warn); } ol.rv-list li.sev-warn { border-left-color: var(--hi); } ol.rv-list li.sev-info { border-left-color: var(--accent); }
ol.rv-list p { margin: 3px 0 0; font-size: 15px; }
.rv-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.rv-msg { font-weight: 600; }
.rv-line { font: 500 12.5px var(--f-display); color: var(--muted); }
.sev { flex: none; font: 700 11px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; }
.sev.error { background: var(--warn); color: var(--onbar); } .sev.warn { background: var(--hi-soft); color: var(--hi-ink); border: 1px solid var(--hi); } .sev.info { background: var(--accent-soft); color: var(--accent); }
.rv-skip { margin-top: 8px; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
}
@media (max-width: 820px) and (min-width: 641px) {
  table.wide5 { min-width: 760px; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    --bg: #ffffff; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
    --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
    --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
    --c1: #2f6fbd; --c2: #2a9d8f; --c3: #e0a32b; --c4: #8a6fc7; --c5: #c8566f;
    --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --on-hi: #18212d; color-scheme: light;
  }
  body { font-size: 11px; line-height: 1.45; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, #herramientas, details.lab, figure.quiz, .search, #err-n, button.cp { display: none !important; }
  .sec { break-before: page; padding-top: 0; border-top: 0; }
  #bolsillo { break-before: auto; }
  .hero { padding-top: 0; padding-bottom: 12px; gap: 6px; } .hero p.lead { font-size: 12px; } .hero h1 { font-size: 34px; }
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
  .pieces { margin-top: 10px; } .example { margin-top: 12px; } .notes { margin-top: 10px; gap: 8px; }
  ul.ex__notes { columns: 2; column-gap: 20px; font-size: 10.5px; margin-top: 8px; }
  .memo, .trap { padding: 7px 10px; } .memo p, .trap p { font-size: 10.5px; }
  figure.fig { padding: 8px; margin-top: 10px; } figure.fig figcaption, .fig__note, .fig__notes, ol.chain { font-size: 10.5px; }
  .links { font-size: 9px; margin-top: 8px; } .links .chip { padding: 2px 7px; }
  .mb { padding: 2px; } .mb math { font-size: 1.15em; }
  ol.errlist { display: block; columns: 2; column-gap: 20px; } ol.errlist li { padding: 5px 0; } .err__m, .err__f, .err__s { font-size: 10px; }
  pre, .code pre, .tpl__code, pre.term { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  .scroll, .tscroll, .mb { overflow: visible; }
  svg.chart { min-width: 0 !important; }
  table.wide5 { min-width: 0; }
  figure.fig:not(.has-table), figure.has-table .scroll, .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag { break-after: avoid; }
}
`;

// ---------------------------------------------------------------- JS (sin librerías)
const DATA = {
  rules: W1.revisor,
  c01: C01_DOCKERFILE,
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

  // ---------- revisor de Dockerfile
  var compiled = D.rules.map(function (r) {
    try { return { r: r, re: new RegExp(r.pattern, r.flags + (r.test === 'match' ? 'g' : '')) }; }
    catch (e) { return { r: r, err: String((e && e.message) || e) }; }
  });
  var RANK = { error: 0, warn: 1, info: 2 }, NAME = { error: 'error', warn: 'aviso', info: 'info' };
  function lineOf(text, i) { return text.slice(0, i).split('\n').length; }
  function plural(nn, a, b) { return nn + ' ' + (nn === 1 ? a : b); }
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega un Dockerfile y vuelve a revisar.</p>'; return; }
    var found = [], skipped = [];
    compiled.forEach(function (c) {
      if (!c.re) { skipped.push(c.r.id); return; }
      if (c.r.test === 'match') {
        c.re.lastIndex = 0;
        var m, lines = [];
        while ((m = c.re.exec(text))) { lines.push(lineOf(text, m.index)); if (m[0] === '') c.re.lastIndex++; }
        if (lines.length) found.push({ r: c.r, lines: lines });
      } else if (!c.re.test(text)) found.push({ r: c.r, lines: [] });
    });
    found.sort(function (a, b) { return (RANK[a.r.severity] - RANK[b.r.severity]) || ((a.lines[0] || 1e9) - (b.lines[0] || 1e9)); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[f.r.severity] = (cnt[f.r.severity] || 0) + 1; });
    var html = '<p class="rv-sum" id="rv-sum" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '">' +
      (found.length ? plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + (compiled.length - skipped.length) + ' reglas encontró algo.') + '</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var where = f.lines.length ? (f.lines.length === 1 ? 'línea ' + f.lines[0] : 'líneas ' + f.lines.join(', ')) : 'en todo el archivo';
      return '<li class="sev-' + f.r.severity + '"><div class="rv-h"><span class="sev ' + f.r.severity + '">' + NAME[f.r.severity] + '</span><span class="rv-msg">' + esc(f.r.message) + '</span><span class="rv-line">' + where + '</span></div>' +
        '<p>' + esc(f.r.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(f.r.fix) + '</p></li>';
    }).join('') + '</ol>';
    if (skipped.length) html += '<p class="small rv-skip">Este navegador no pudo compilar ' + plural(skipped.length, 'regla', 'reglas') + ' (usan lookbehind de longitud variable) y se omitieron: ' + esc(skipped.join(', ')) + '.</p>';
    out.innerHTML = html;
  }
  function setLabel(t, cls) { var l = $('rv-label'); l.textContent = t; l.className = 'rv-label' + (cls ? ' ' + cls : ''); }
  $('rv-run').addEventListener('click', review);
  $('rv-c01').addEventListener('click', function () { $('rv-text').value = D.c01; setLabel('Dockerfile del gateway de C01 (reference/c01/gateway/Dockerfile)', 'ok'); review(); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tu Dockerfile', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
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
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  q.addEventListener('input', function () {
    var terms = norm(q.value.trim()).split(/\s+/).filter(Boolean), nn = 0;
    items.forEach(function (li) {
      var hay = li.getAttribute('data-q'), ok = terms.every(function (t) { return hay.indexOf(t) >= 0; });
      li.hidden = !ok; if (ok) nn++;
    });
    $('err-n').textContent = nn + ' de ' + items.length;
  });
})();`;
const JS = JS_SRC.replace('/*DATA*/', JSON.stringify(DATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));

// ---------------------------------------------------------------- página
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de Dockerfile']];
const HEAD = `<title>Cheat sheet de Docker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS}</style>`;
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Contenedores · ejemplos de C01</p>
    <h1>Cheat sheet de Docker</h1>
    <p class="lead">Para escribir un Dockerfile con la documentación abierta y diagnosticar una falla en minutos. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y, cuando se puede, un laboratorio opcional para tu Mac. En la versión web, al final hay un diagnosticador de síntomas y un revisor de Dockerfile.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>Comandos para Docker Engine 29.x, Compose v2 o posterior y el NVIDIA Container Toolkit, revisados contra la documentación oficial (docs.docker.com, la especificación de Compose y la documentación de NVIDIA). Los laboratorios no se ejecutaron al escribir esta hoja: si tu terminal dice otra cosa, créele a tu terminal. Los ejemplos salen de <code>reference/</code> del curso.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  if (missingLinks.length) console.log('enlaces del curso sin título:', missingLinks.join(', '));
  return texN;
}

const mode = process.argv[2] || 'build';
if (mode === 'src') writeSrc(process.argv[3] || join(HERE, 'out'));
else if (mode === 'build') {
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
  writeFileSync(join(HERE, 'cheatsheet-docker.html'), page);
  writeFileSync(join(HERE, 'local.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
}
