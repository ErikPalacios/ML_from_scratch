// Genera el "Cheat sheet de Kubernetes", hermana de la hoja de Docker (sheets/docker/fuentes/gen-docker.mjs):
// mismos tokens claro/oscuro, fuentes, hero, nav de chips, .pad con papel cuadriculado, tabla de piezas,
// ejemplo con botón de copiar, figuras, "Cómo recordarla" / "Trampa", laboratorios plegados y CSS de impresión.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal:
//   - las de texto largo son HTML y se acomodan solas (la cadena, el cluster, el lazo de control, la jerarquía,
//     la red, los recursos, el scheduling y el autoscaling);
//   - las que van a escala sobre un eje (probes, rollout, estados del pod) traen dos SVG: uno ancho (tablet,
//     escritorio e impresión) y uno angosto para el celular; una media query muestra uno u otro.
// Un color significa lo mismo en todas: azul = lo que pides (spec), verde = listo, ámbar = esperando,
// rojo = falla, violeta = GPU, tinta = control plane.
//
// Uso:
//   node gen-k8s.mjs src <dir>   → <dir>/head.html, wrap.html, script.js, revisor.js y src.html (con KaTeX de cdnjs)
//   node gen-k8s.mjs build       → lo anterior en ./out, renderiza [data-tex] a MathML estático con
//                                  tools/browser-check.mjs (de la app ml-system-design) y escribe out/artifact.html
//                                  (HEAD + wrap + script, para el Artifact de claude.ai) y ../cheatsheet-kubernetes.html
//                                  (con doctype/html/head/body: la página del sitio y la fuente del PDF)
// El contenido está en content-w1/2/3.json de esta carpeta (K8S_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, cuentas que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // manifests del curso, módulos y browser-check.mjs
const CONTENT = process.env.K8S_CONTENT ? resolve(process.env.K8S_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C01 = {
  gateway: readFileSync(join(APP, 'reference/c01/k8s/gateway.yaml'), 'utf8'),
  triton: readFileSync(join(APP, 'reference/c01/k8s/triton.yaml'), 'utf8'),
};
const YAML_URL = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
const AVISOS = [];
const aviso = (m) => { if (!AVISOS.includes(m)) AVISOS.push(m); };

// ---------------------------------------------------------------- utilidades (las de gen-docker.mjs)
const T = String.raw;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en memo, trap y en las notas: solo <b> y <code> (y entidades ya escritas, como &lt;); todo lo demás se escapa.
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>').replace(/&amp;(lt|gt|amp|quot|#39);/g, '&$1;');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const n = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const r1 = (x) => Math.round(x * 10) / 10;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// {placeholder} → variable con aspecto de variable matemática. No toca {.status…} ni {"\n"} ni { mapas: yaml }.
const PH = /\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*)\}/g;
const phs = (escaped) => escaped.replace(PH, '<var class="ph">$1</var>');
// Las flags (-n, --previous) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
// Un número no se separa de su unidad al final de un renglón ("300 s", "6 GiB", "25 %").
const nbu = (h) => h.replace(/(\d) (s|ms|min|h|GiB|Gi|MiB|Mi|GB|MB|TB|%|CPU|GPU|GPUs|cores?)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
const tx = (s) => nbu(nbFlags(esc(s)));
const rx = (s) => nbu(nbFlags(rich(s)));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(nbFlags(esc(s)));

// Símbolo de una fórmula (t_gracia, n_señal, request_nuevo…) → TeX para la tabla de variables.
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
const CMD_WORDS = new Set(['kubectl', 'docker', 'aws', 'helm', 'kind', 'git', 'curl', 'echo', 'cat', 'grep', 'base64', 'nslookup', 'sleep', 'time', 'python', 'python3', 'nvidia-smi', 'jq', 'watch', 'ls', 'head', 'tail', 'printf', 'cd', 'export']);
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
const cmdChip = (c) => `<span class="cmdw"><code class="cmd">${esc(c)}</code>${copyBtn(c)}</span>`;
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando se muestra como código copiable.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    const c = splitCmd(seg);
    if (!c) return esc(seg);
    return `${cmdChip(c.cmd)}${c.note ? `<span class="cmdn">${esc(c.note)}</span>` : ''}`;
  }).join('<span class="sep"> · </span>');
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'top', 'argo', 'rollouts', 'compose', 'buildx', 'image', 'eks', 'ecr', 'sts', 'elbv2', 'imagetools']);
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
          st.sub = /^(kubectl|docker|aws|helm)$/.test(t) ? 2 : 0;
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
        here = { end: h[1], lang: /\.ya?ml$/.test(f) || /kubectl\s+(apply|create|diff)\b.*-f\s+-/.test(ln) ? 'yaml' : 'text' };
      }
    }
  }
  return out.join('\n');
}
const LANG = { yaml: 'YAML', bash: 'bash · zsh', text: 'texto' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- SVG
// Cada SVG lleva sus propios ids (marcadores): un SVG oculto con display:none no puede prestarle marcadores a otro.
let SVG_N = 0;
function defs() {
  const u = 'k' + (++SVG_N);
  const mk = (id, cls) => `<marker id="${u}-${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="${cls}"/></marker>`;
  return { s: `<defs>${mk('arr', 'f-muted')}${mk('hi', 'f-hi')}${mk('warn', 'f-warn')}${mk('ok', 'f-accent2')}</defs>`, m: (id) => `url(#${u}-${id})` };
}
const svgFig = (W, H, body, label, cls, maxW) => `<svg class="chart ${cls}" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet" style="max-width:${maxW}px">${body}</svg>`;
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const tlines = (x, y, lines, cls = 't', anchor = 'start', lh = 15) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${lines.map((l, i) => `<tspan x="${r1(x)}" dy="${i ? lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(h)}" class="${cls}" ${extra}/>`;
const path = (d, cls = 's-muted', extra = '') => `<path d="${d}" class="${cls}" fill="none" ${extra}/>`;
const numMark = (x, y, k) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="9" class="f-ink"/>` + txt(x, y + 4, String(k), 'tnum', 'middle');
const checkMark = (x, y) => `<path d="M${r1(x - 3.2)},${r1(y + 0.2)} l2.2,2.4 l4.2,-4.8" class="s-paper" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
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
// ↳ · La cadena: once eslabones agrupados por quién actúa.
const ACTOR = [['tu', /manifest|yaml|kubectl|apply/i], ['nodo', /kubelet|containerd|runtime|pod ready/i], ['red', /endpoint|tr[aá]fico|kube-proxy/i], ['cp', /api|etcd|controller|scheduler|admission/i]];
const ZONE = { tu: 'Tú, con kubectl', cp: 'Control plane: guarda y decide', nodo: 'En el nodo: arranca el contenedor', red: 'Hacia el tráfico', x: 'Otros pasos' };
function figChain(d) {
  const zones = [];
  (d.steps || []).forEach((s, i) => {
    const a = (ACTOR.find(([, re]) => re.test(s.label || '')) || ['x'])[0];
    const z = zones[zones.length - 1];
    if (z && z.a === a) z.items.push([i, s]); else zones.push({ a, items: [[i, s]] });
  });
  if (zones.some((z) => z.a === 'x')) aviso('cadena: un eslabón no tiene quién lo hace (tú, control plane, nodo o tráfico); lo dibujé en gris');
  return `<div class="kchain">${zones.map((z) => `<div class="kz kz--${z.a}"><p class="kz__h">${esc(ZONE[z.a])}</p><ol class="kz__steps" start="${z.items[0][0] + 1}">${z.items.map(([i, s]) => `<li class="kst"><span class="kst__no" aria-hidden="true">${i + 1}</span><p class="kst__l">${esc(s.label)}</p>${s.cmd ? cmdChip(s.cmd) : ''}${s.note ? `<p class="kst__n">${rx(s.note)}</p>` : ''}</li>`).join('')}</ol></div>`).join('')}</div>`;
}

// 1 · El cluster: control plane arriba (lo opera AWS en EKS), nodos abajo con sus pods.
const APP_PODS = /^(gateway|triton)\b/i;
function figCluster(d) {
  const nodes = (d.nodes || []).map((nd) => {
    const parts = String(nd.labels || '').split(/\s+·\s+/).filter((p) => p && p !== '—');
    const taints = parts.filter((p) => /^taint\b/i.test(p)).map((p) => p.replace(/^taint\s+/i, ''));
    const labels = parts.filter((p) => !/^taint\b/i.test(p));
    const gpu = /gpu/i.test(`${nd.name} ${nd.labels}`);
    return `<div class="kn${gpu ? ' kn--gpu' : ''}"><p class="kn__h"><span class="kn__badge">${gpu ? 'GPU' : 'CPU'}</span>${esc(nd.name)}</p>${labels.map((l) => `<p class="kn__lab"><span class="k">label</span> <code>${esc(l)}</code></p>`).join('')}${taints.map((t) => `<p class="kn__taint"><span class="k">taint</span> <code>${esc(t)}</code></p>`).join('')}<ul class="kn__pods" aria-label="Pods del nodo">${(nd.pods || []).map((p) => `<li${APP_PODS.test(p) ? ' class="app"' : ''}>${esc(p)}</li>`).join('')}</ul><p class="kn__base">kubelet · containerd</p></div>`;
  }).join('');
  return `<div class="kcl"><div class="kcl__cp"><p class="kcl__cph"><span>Control plane</span><small>en EKS lo opera AWS</small></p><ul class="kcl__comp">${(d.control_plane || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div><p class="kcl__link"><span class="kcl__wire" aria-hidden="true"></span>cada kubelet le habla al API server: recibe sus pods y reporta cómo van</p><div class="kcl__nodes">${nodes}</div><p class="kleg"><span><i class="sw sw--app"></i>pods del C01</span><span><i class="sw sw--sys"></i>add-ons (también son pods)</span><span><i class="sw sw--gpu"></i>nodo GPU</span></p>${noteP(d.managed_note)}</div>`;
}

// 2 · El lazo de control, como un lazo: deseado (spec) contra real (status) y los pasos que los igualan.
function loopSvg(k) {
  const C = 110, R = 80, ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / k, pt = (a) => [C + R * Math.cos(a), C + R * Math.sin(a)];
  const D = defs(); let s = D.s;
  for (let i = 0; i < k; i++) {
    const last = i === k - 1, [x0, y0] = pt(ang(i) + 0.25), [x1, y1] = pt(ang(i + 1) - 0.27);
    s += `<path d="M${r1(x0)},${r1(y0)} A${R},${R} 0 0 1 ${r1(x1)},${r1(y1)}" class="${last ? 's-muted' : 's-hi'}" fill="none" stroke-width="${last ? 2 : 3.2}"${last ? ' stroke-dasharray="5 4"' : ''} marker-end="${D.m(last ? 'arr' : 'hi')}"/>`;
  }
  for (let i = 0; i < k; i++) {
    const [x, y] = pt(ang(i)), ok = i === k - 1;
    s += `<circle cx="${r1(x)}" cy="${r1(y)}" r="14" class="${ok ? 'f-accent2' : 'f-hi'}"/>` + txt(x, y + 5, String(i + 1), ok ? 'tl tb tw' : 'tl tb ton-hi', 'middle');
  }
  s += tlines(C, C - 4, ['¿spec', '= status?'], 'tl tb tbig', 'middle', 19);
  return `<svg class="chart kloop__svg" viewBox="0 0 220 220" role="img" aria-label="Un lazo: compara spec con status y actúa hasta que coinciden">${s}</svg>`;
}
function figControlLoop(d) {
  const acts = d.actions || [];
  return `<div class="kloop"><div class="kloop__state kloop__want"><p class="tag">Deseado · spec</p><p>${esc(d.desired)}</p></div><div class="kloop__mid">${loopSvg(acts.length || 4)}</div><div class="kloop__state kloop__real"><p class="tag">Real · status</p><p>${esc(d.actual)}</p></div><ol class="kloop__acts">${acts.map((a, i) => `<li><span class="kno${i === acts.length - 1 ? ' ok' : ''}">${i + 1}</span><span>${esc(a)}</span></li>`).join('')}</ol>${d.who ? `<p class="kloop__who"><span class="k">Quién corre el lazo:</span> ${esc(d.who)}</p>` : ''}</div>`;
}

// 3 · Jerarquía: Deployment → ReplicaSet → Pod; cada nivel mira al de abajo.
const KIND_WHO = { Deployment: 'lo escribes tú', ReplicaSet: 'lo crea el Deployment', Pod: 'lo crea el ReplicaSet' };
function figHierarchy(d) {
  let h = '';
  (d.chain || []).forEach((c, i) => {
    const lv = Math.min(i, 3);
    if (i) h += `<p class="kh__arrow lv${lv}"><span>↓ crea y controla</span><span>↑ ownerReferences: apunta a su dueño</span></p>`;
    h += `<div class="kh kh--${lv}"><p class="kh__k"><span class="kh__kind">${esc(c.kind)}</span><code>${esc(c.name)}</code>${KIND_WHO[c.kind] ? `<span class="kh__who">${esc(KIND_WHO[c.kind])}</span>` : ''}</p>${c.note ? `<p class="kh__n">${tx(c.note)}</p>` : ''}</div>`;
  });
  return `<div class="khier">${h}${d.selector ? `<p class="khier__sel"><span class="k">Se encuentran por labels:</span> ${tx(d.selector)}</p>` : ''}</div>`;
}

// 4 · La red: el camino del request (riel verde) y, aparte, lo que no está en el camino (de ahí saca las IPs el controller).
function figNetwork(d) {
  const hops = d.hops || [];
  const iAlb = hops.findIndex((h) => /\bALB\b|Ingress/i.test(h.name));
  const iPods = hops.findIndex((h, i) => iAlb >= 0 && i > iAlb && /^Pods?\b/i.test(h.name));
  const sideOk = iAlb >= 0 && iPods > iAlb + 1 && hops.slice(iAlb + 1, iPods).some((h) => /no est[aá] en el camino/i.test(h.note || ''));
  const hop = (h, cls = '') => `<li class="hop${cls}"><p class="hop__h"><span>${esc(h.name)}</span>${h.port ? `<code class="hop__p">${esc(h.port)}</code>` : ''}</p>${h.note ? `<p class="hop__n">${tx(h.note)}</p>` : ''}</li>`;
  const dns = d.dns ? `<p class="knet__dns"><span class="knet__dnsk">DNS</span><span>${tx(d.dns)}</span></p>` : '';
  if (!sideOk) {
    aviso('red: no encontré el tramo que "no está en el camino" del ALB; dibujé los saltos en una sola lista');
    return `<div class="knet knet--plain"><ol class="knet__path">${hops.map((h) => hop(h)).join('')}</ol>${dns}</div>`;
  }
  const a = hops.slice(0, iAlb + 1), side = hops.slice(iAlb + 1, iPods), b = hops.slice(iPods);
  return `<div class="knet"><p class="knet__lg"><span><i class="sw sw--path"></i>camino del request</span><span><i class="sw sw--side"></i>fuera del camino</span></p><ol class="knet__path knet__a">${a.map((h) => hop(h)).join('')}</ol><div class="knet__side"><p class="knet__sideh">Fuera del camino: de aquí saca las IPs el controller del ALB</p><ol class="knet__path">${side.map((h) => hop(h, ' hop--side')).join('')}</ol></div><ol class="knet__path knet__b" start="${iPods + 1}"><li class="hop hop--jump"><p class="hop__j">target-type ip: el ALB va directo a la IP de cada pod</p></li>${b.map((h) => hop(h)).join('')}</ol>${dns}</div>`;
}

// 5 · Probes: carriles sobre un eje de segundos, a escala. Arriba el arranque; abajo el apagado.
const LANE_NAME = { startup: 'startup', readiness: 'readiness', liveness: 'liveness', shutdown: 'apagado' };
const periodOf = (list) => { for (const e of list) { const m = String(e.label).match(/cada\s+(\d+(?:[.,]\d+)?)\s*s\b/); if (m) return parseFloat(m[1].replace(',', '.')); } return null; };
function probesSvg(evs, lanes, T, W, mode, grace) {
  const narrow = W < 500, D = defs();
  const X0 = narrow ? 82 : 108, X1 = W - 18, top = 8, LH = 44, y0 = top + 32;
  const x = (t) => X0 + (Math.max(0, Math.min(t, T)) / T) * (X1 - X0);
  const yL = (i) => y0 + i * LH;
  const yAx = mode === 'stop' ? yL(0) + 66 : yL(lanes.length - 1) + 26;
  let s = D.s, marks = '';
  for (let t = 0; t <= T + 1e-9; t += 10) s += line(x(t), top + 6, x(t), yAx, 'grid');
  lanes.forEach((ln, i) => {
    const y = yL(i), le = evs.filter((e) => e.lane === ln).sort((a, b) => a.t - b.t);
    s += txt(10, y + 4.5, LANE_NAME[ln] || ln, 'tm tb');
    if (mode === 'start') {
      const per = periodOf(le);
      if (ln === 'startup' && le.length > 1) {
        const tOK = le[le.length - 1].t;
        s += rect(x(0), y - 7, x(tOK) - x(0), 14, 'f-hi-soft s-hi', 'rx="3"');
        if (per) for (let t = 0; t < tOK - 1e-9; t += per) s += `<path d="M${r1(x(t) + 2.5)},${r1(y - 3.5)} l5,7 m0,-7 l-5,7" class="s-warn" stroke-width="1.7" fill="none"/>`;
        if (tOK < T) s += line(x(tOK) + 8, y, x(T), y, 'l-off');
        s += `<circle cx="${r1(x(tOK))}" cy="${y}" r="7" class="f-accent2"/>` + checkMark(x(tOK), y);
      } else if (le.length) {
        const t0 = le[0].t;
        if (t0 > 0) s += line(x(0), y, x(t0) - 8, y, 'l-dash');
        if (ln === 'readiness') s += rect(x(t0), y - 6, x(T) - x(t0), 12, 'f-accent2', 'rx="3"');
        else {
          s += line(x(t0), y, x(T), y, 'l-ok');
          if (per) for (let t = t0 + per; t <= T + 1e-9; t += per) s += `<circle cx="${r1(x(t))}" cy="${y}" r="4" class="f-paper s-accent2" stroke-width="2"/>`;
        }
        s += `<circle cx="${r1(x(t0))}" cy="${y}" r="7" class="f-accent2"/>` + checkMark(x(t0), y);
      }
    } else {
      const bounds = le.map((e) => e.t);
      if (grace > (bounds.length ? bounds[bounds.length - 1] : -1)) bounds.push(grace);
      for (let k = 0; k < bounds.length - 1; k++) {
        const a = bounds[k], b = bounds[k + 1], lab = String((le[k] || {}).label || '');
        const kind = /preStop/i.test(lab) ? 'pre' : /SIGTERM/.test(lab) ? 'drain' : 'margin';
        s += rect(x(a), y - 10, x(b) - x(a), 20, { pre: 'f-hi-soft s-hi', drain: 'f-ok-soft s-accent2', margin: 'f-free s-rule' }[kind], 'rx="3"');
        const cap = { pre: 'preStop', drain: 'drena', margin: 'margen' }[kind];
        if (x(b) - x(a) > cap.length * 7.5 + 10) s += txt((x(a) + x(b)) / 2, y + 4.5, cap, 'tl tb', 'middle');
      }
      if (grace) {
        s += line(x(grace), y - 15, x(grace), y + 15, 'l-kill');
        const yb = y + 22;
        s += path(`M${r1(x(0))},${yb} V${yb + 6} H${r1(x(grace))} V${yb}`, 's-muted', 'stroke-width="1.3"');
        s += txt((x(0) + x(grace)) / 2, yb + 21, narrow ? `plazo de gracia: ${grace} s` : `plazo: terminationGracePeriodSeconds = ${grace} s`, 't tb', 'middle');
      }
    }
    le.forEach((e) => { marks += numMark(x(e.t), y - 21, e._n); });
  });
  s += marks + line(x(0), yAx, x(T), yAx, 'ax');
  for (let t = 0; t <= T + 1e-9; t += narrow ? 10 : 5) {
    s += line(x(t), yAx, x(t), yAx + 5, 'ax');
    if (t % 10 === 0) s += txt(x(t), yAx + 18, t >= T ? `${t} s` : String(t), 't', t >= T ? 'end' : 'middle');
  }
  return { s, H: yAx + 26 };
}
function figProbes(d) {
  const evs = (d.events || []).filter((e) => e && typeof e.t === 'number').map((e) => ({ ...e }));
  const grace = Number(d.grace_s) || 0;
  const T = Math.max(10, Math.ceil(Math.max(grace, ...evs.map((e) => e.t)) / 10) * 10);
  const A = evs.filter((e) => e.lane !== 'shutdown'), B = evs.filter((e) => e.lane === 'shutdown');
  const lanesA = ['startup', 'readiness', 'liveness'].filter((l) => A.some((e) => e.lane === l));
  for (const e of A) if (!lanesA.includes(e.lane)) { aviso(`probes: carril desconocido "${e.lane}"`); lanesA.push(e.lane); }
  const ord = (list, lanes) => list.sort((a, b) => a.t - b.t || lanes.indexOf(a.lane) - lanes.indexOf(b.lane));
  ord(A, lanesA).forEach((e, i) => { e._n = i + 1; });
  ord(B, ['shutdown']).forEach((e, i) => { e._n = A.length + i + 1; });
  const o = d.origins || {};
  // el carril solo se nombra si el texto no empieza por él (y nunca en el apagado: ahí hay un solo carril)
  const item = (e) => {
    const ln = LANE_NAME[e.lane] || e.lane, show = e.lane !== 'shutdown' && !norm(e.label).startsWith(norm(ln));
    return `<li><span class="kev__n">${e._n}</span><span class="kev__t">${n(e.t, 1)} s</span><span class="kev__x">${show ? `<b>${esc(ln)}</b> · ` : ''}${tx(e.label)}</span></li>`;
  };
  const panel = (title, origin, list, lanes, mode, aria) => {
    if (!list.length) return '';
    const w = probesSvg(list, lanes, T, 760, mode, grace), nw = probesSvg(list, lanes, T, 330, mode, grace);
    return `<div class="kpr__p"><p class="kpr__h">${esc(title)}${origin ? ` <span>· ${esc(origin)}</span>` : ''}</p>${svgFig(760, w.H, w.s, aria, 'fv-w', 860)}${svgFig(330, nw.H, nw.s, aria, 'fv-n', 470)}<ol class="kev">${list.map(item).join('')}</ol></div>`;
  };
  return `<div class="kpr">${panel('Arranque', o.startup, A, lanesA, 'start', `Arranque de un pod en segundos, a escala: startup, readiness y liveness`)}${panel('Apagado', o.shutdown, B, ['shutdown'], 'stop', `Apagado de un pod en segundos, a escala, con el plazo de gracia de ${grace} s`)}<p class="kleg"><span><i class="sw sw--wait"></i>la startup prueba y falla</span><span><i class="sw sw--ok"></i>pasa: Ready y en los endpoints</span><span><i class="sw sw--off"></i>espera a la startup</span><span><i class="sw sw--kill"></i>SIGKILL</span></p></div>`;
}

// 6 · Recursos: requests y limits contra la capacidad del nodo, a escala; el contraejemplo, una ventana de CFS.
const CAP_KEY = { cpu: 'cpu', memory: 'memory_gib', 'nvidia.com/gpu': 'nvidia.com/gpu' };
const CAP_LAB = { cpu: (v) => `${n(v, 2)} CPU`, memory_gib: (v) => `${n(v, 2)} GiB`, 'nvidia.com/gpu': (v) => `${n(v)} GPU` };
function figResources(d) {
  const nodes = d.nodes || [], rows = d.rows || [];
  const groups = nodes.map((nd) => ({ nd, rows: rows.filter((r) => r.node && r.node !== '—' && String(nd.name).startsWith(r.node)) }));
  const loose = rows.filter((r) => !groups.some((g) => g.rows.includes(r)));
  const val = (v, u) => (v === null || v === undefined ? '—' : `${n(v, 2)} ${Number(v) === 1 && /^(cores|GPUs)$/.test(u) ? u.slice(0, -1) : u}`);
  const rowHtml = (r, cap) => {
    const unit = r.unit || '', capV = cap ? cap[CAP_KEY[r.resource]] : null;
    let bar = '';
    if (r.resource === 'nvidia.com/gpu' && capV) {
      bar = `<div class="gslots" role="img" aria-label="${esc(`${r.request} de ${capV} GPU`)}">${Array.from({ length: capV }, (_, i) => `<span class="gslot${i < (r.request || 0) ? ' on' : ''}"></span>`).join('')}<span class="gslots__t">${esc(`${n(r.request || 0)} de ${n(capV)}: entera`)}</span></div>`;
    } else if (capV) {
      const pr = Math.min(100, ((r.request || 0) / capV) * 100), pl = r.limit === null || r.limit === undefined ? null : Math.min(100, (r.limit / capV) * 100);
      bar = `<div class="rbar" role="img" aria-label="${esc(`request ${val(r.request, unit)}, ${pl === null ? 'sin limit' : `limit ${val(r.limit, unit)}`}, de ${CAP_LAB[CAP_KEY[r.resource]](capV)}`)}"><span class="rbar__req" style="width:${r1(pr)}%"></span>${pl === null ? `<span class="rbar__free" style="left:${r1(pr)}%"></span>` : `<span class="rbar__lim ${r.resource === 'cpu' ? 'cpu' : ''}" style="left:${r1(pl)}%"></span>`}</div><p class="rbar__ax"><span>0</span><span>${esc(CAP_LAB[CAP_KEY[r.resource]](capV))} del nodo</span></p>`;
    }
    const kind = r.limit === null || r.limit === undefined ? '' : r.resource === 'memory' ? 'bad' : r.resource === 'cpu' ? 'wait' : '';
    return `<div class="krr"><div class="krr__l"><p class="krr__name">${esc(r.container)} · ${esc(r.resource)}</p><p class="krr__vals">request ${esc(val(r.request, unit))} · ${r.limit === null || r.limit === undefined ? 'sin limit' : `limit ${esc(val(r.limit, unit))}`}</p></div><div class="krr__b">${bar}</div><p class="krr__over ${kind}"><span class="k">Si se pasa:</span> ${tx(r.over)}</p></div>`;
  };
  const cfs = (r) => {
    const m = String(r.over || '').match(/(\d+)\s*hilos/), thr = m ? +m[1] : 0;
    if (r.resource !== 'cpu' || !r.limit || !thr) return rowHtml(r, null);
    const tA = (r.limit * 100) / thr, said = String(r.over).match(/(\d+(?:[.,]\d+)?)\s*ms/);
    if (said && Math.abs(parseFloat(said[1].replace(',', '.')) - tA) > 0.01) aviso(`recursos: el contraejemplo dice ${said[1]} ms, pero limit × 100 ms / hilos = ${n(tA, 2)} ms`);
    return `<div class="krr krr--cfs"><div class="krr__l"><p class="krr__name">${esc(r.container)} · cpu</p><p class="krr__vals">request ${esc(val(r.request, r.unit))} · limit ${esc(val(r.limit, r.unit))} · ${thr} hilos</p></div><div class="krr__b"><div class="kcfs" role="img" aria-label="${esc(`Ventana de 100 ms: corre ${n(tA, 1)} ms y queda congelado ${n(100 - tA, 1)} ms`)}"><span class="kcfs__run" style="width:${r1(tA)}%">corre</span><span class="kcfs__thr">congelado: throttling</span></div><p class="kcfs__ax"><span style="left:0">0</span><span style="left:${r1(tA)}%">${n(tA, 1)} ms</span><span style="left:100%">100 ms</span></p></div><p class="krr__over wait"><span class="k">Si se pasa:</span> ${tx(r.over)}</p></div>`;
  };
  const head = (nd) => {
    const cap = nd.capacity || {};
    const caps = Object.keys(CAP_LAB).filter((k) => cap[k] !== undefined).map((k) => CAP_LAB[k](cap[k])).join(' · ');
    return `<p class="krn__h">${esc(nd.name)}</p><p class="krn__cap">capacidad: ${esc(caps)}</p>${nd.note ? `<p class="krn__note">${tx(nd.note)}</p>` : ''}`;
  };
  return `<div class="kres"><p class="kleg"><span><i class="sw sw--req"></i>request: la reserva</span><span><i class="sw sw--lim"></i>limit de memoria: el techo (si lo pasa, OOMKilled)</span><span><i class="sw sw--free"></i>sin limit: usa lo libre del nodo</span></p>${groups.filter((g) => g.rows.length).map((g) => `<div class="krn${/gpu/i.test(JSON.stringify(g.nd.capacity || {})) ? ' krn--gpu' : ''}">${head(g.nd)}${g.rows.map((r) => rowHtml(r, g.nd.capacity || {})).join('')}</div>`).join('')}${loose.length ? `<div class="krn krn--x"><p class="krn__h">Contraejemplo: con limit de CPU</p>${loose.map(cfs).join('')}</div>` : ''}</div>`;
}

// 8 · Scheduling: nodos (labels, taints, GPU libre) contra pods (selector, tolerations, requests), ✓ / ✗.
function figScheduling(d) {
  const nodes = d.nodes || [], pods = d.pods || [], M = d.matrix || [];
  if (M.length !== pods.length || M.some((r) => (r || []).length !== nodes.length)) aviso(`scheduling: la matriz no es de ${pods.length} × ${nodes.length}`);
  const isGpu = (nd) => /gpu/i.test([nd.name, nd.labels, nd.taints].join(' '));
  const has = (v) => v && v !== '—';
  // corte suave después de = : / , (la clave, el valor y el efecto de un taint quedan enteros si caben)
  const brk = (s) => esc(s).replace(/([=:/,])(?=\S)/g, '$1<wbr>');
  const nodeCard = (nd) => `<div class="ksn${isGpu(nd) ? ' ksn--gpu' : ''}"><p class="ksn__name">${esc(nd.name)}</p><p class="ksn__meta">${esc([nd.type, nd.zone].filter(Boolean).join(' · '))}</p>${has(nd.labels) ? `<p class="ksn__lab"><span class="k">label</span> ${brk(nd.labels)}</p>` : ''}${has(nd.taints) ? `<p class="ksn__taint"><span class="k">taint</span> ${brk(nd.taints)}</p>` : ''}${isGpu(nd) ? `<p class="ksn__gpu"><span class="gslot sm${nd.gpu_free > 0 ? '' : ' on'}"></span>${nd.gpu_free > 0 ? esc(`${nd.gpu_free} GPU libre${nd.gpu_free > 1 ? 's' : ''}`) : 'GPU ocupada'}</p>` : ''}${nd.note ? `<p class="ksn__note">${esc(nd.note)}</p>` : ''}</div>`;
  const pl = (k, v, none) => `<p class="ksp__l"><span class="k">${k}</span> ${has(v) ? brk(v) : `<i>${none}</i>`}</p>`;
  const podCard = (p) => `<div class="ksp"><p class="ksp__name">${esc(p.name)}</p>${pl('nodeSelector', p.selector, 'ninguno')}${pl('toleration', p.tolerations, 'ninguna')}${pl('pide', p.requests, '—')}${p.spread ? pl('spread', p.spread, '') : ''}</div>`;
  const cell = (s, nd) => {
    const ok = /^\s*✓/.test(s || ''), reason = String(s || '').replace(/^\s*[✓✗]\s*/, '');
    return `<div class="ksc ${ok ? 'ksc--ok' : 'ksc--no'}" data-node="${esc(nd.name)}"><span class="ksc__m" aria-label="${ok ? 'puede ir' : 'no puede ir'}">${ok ? '✓' : '✗'}</span><span class="ksc__r">${reason ? esc(reason) : ok ? 'cabe' : ''}</span></div>`;
  };
  return `<div class="ksch" style="--nn:${nodes.length}"><div class="ksch__nodes"><div class="ksch__corner"><p class="k">pods ↓ · nodos →</p></div>${nodes.map(nodeCard).join('')}</div>${pods.map((p, i) => `<div class="ksch__row">${podCard(p)}<div class="ksch__cells">${nodes.map((nd, j) => cell((M[i] || [])[j], nd)).join('')}</div></div>`).join('')}</div><p class="kleg"><span><i class="sw sw--ok"></i>✓ el scheduler puede ponerlo ahí</span><span><i class="sw sw--kill"></i>✗ el motivo que verías en FailedScheduling</span><span><i class="sw sw--gpu"></i>nodo GPU</span></p>${d.after ? `<div class="ksch__after"><p><span class="k">Y después:</span> ${tx(d.after)}</p></div>` : ''}`;
}

// 9 · Autoscaling: la fórmula del HPA con pods que se ven, y una línea de tiempo en minutos (rangos de inicio y fin).
function figAutoscale(d) {
  const cur = Number(d.current), met = Number(d.metric), tgt = Number(d.target), max = Number(d.max) || 0;
  const raw = Math.ceil((cur * met) / tgt), des = d.desired !== undefined ? Number(d.desired) : raw;
  if (des !== raw) aviso(`autoscale: desired ${des} ≠ ⌈${cur} × ${met} / ${tgt}⌉ = ${raw}`);
  const fin = max ? Math.min(des, max) : des;
  const pods = (run, want, cut) => `<span class="pods">${'<span class="pod pod--run"></span>'.repeat(Math.max(0, run))}${'<span class="pod pod--want"></span>'.repeat(Math.max(0, want))}${'<span class="pod pod--cut"></span>'.repeat(Math.max(0, cut))}</span>`;
  const rows = [
    ['Ahora', pods(cur, 0, 0), `${n(cur)} réplicas Ready · métrica ${n(met, 2)} contra objetivo ${n(tgt, 2)}`],
    ['El HPA pide', pods(cur, des - cur, 0), `⌈${n(cur)} × ${n(met, 2)} / ${n(tgt, 2)}⌉ = ${n(des)}`],
  ];
  if (max && des > max) rows.push(['Recorta al máximo', pods(cur, fin - cur, des - fin), `máximo ${n(max)}: queda en ${n(fin)}`]);
  const tl = (d.timeline || []).filter((e) => e && typeof (e.t_max ?? e.t_min) === 'number');
  const Tm = Math.max(1, Math.ceil(Math.max(...tl.map((e) => Number(e.t_max ?? e.t_min)))));
  const pct = (t) => r1((Math.max(0, Math.min(t, Tm)) / Tm) * 100);
  const range = (e) => (e.t_min === e.t_max ? `${n(e.t_min, 2)} min` : `${n(e.t_min, 2)}–${n(e.t_max, 2)} min`);
  // marcas cada 2 min; la última par lleva la unidad (una impar al final se pisaría con ella)
  const even = Array.from({ length: Tm + 1 }, (_, t) => t).filter((t) => t % 2 === 0);
  const ticks = even.map((t, i) => `<span style="left:${pct(t)}%"${t === 0 ? ' class="start"' : t === Tm ? ' class="end"' : ''}>${i === even.length - 1 ? `${t} min` : t}</span>`).join('');
  const tlRows = tl.map((e) => {
    const lane = /nodo/i.test(e.lane) ? 'nodos' : 'pods', a = Number(e.t_min ?? e.t_max), b = Number(e.t_max ?? e.t_min);
    const bar = b - a > 1e-9 ? `<span class="ktrack__bar ${lane}" style="left:${pct(a)}%;width:${r1(pct(b) - pct(a))}%"></span>` : `<span class="ktrack__dot ${lane}" style="left:${pct(a)}%"></span>`;
    return `<li class="ktr"><span class="ktr__lane ${lane}">${esc(e.lane)}</span><p class="ktr__label">${tx(e.label)} <span class="ktr__t">${esc(range(e))}</span></p><div class="ktrack" style="--n:${Tm}">${bar}</div></li>`;
  }).join('');
  return `<div class="kas"><div class="kas__calc"><p class="kas__m"><span class="k">Métrica:</span> ${esc(d.metric_name || '')}${d.metric_type ? ` · <code>metricType: ${esc(d.metric_type)}</code>` : ''}</p>${rows.map(([k, p, t]) => `<div class="kas__row"><p class="kas__lab">${esc(k)}</p><div class="kas__v">${p}<span class="kas__eq">${esc(t)}</span></div></div>`).join('')}${(d.steps || []).length ? `<ol class="kas__steps">${d.steps.map((s) => `<li>${tx(s)}</li>`).join('')}</ol>` : ''}<p class="kleg"><span><i class="pod pod--run"></i>réplica Ready</span><span><i class="pod pod--want"></i>la pide el HPA</span><span><i class="pod pod--cut"></i>no entra: pasa el máximo</span></p></div>${tl.length ? `<div class="ktl"><p class="ktl__h">Línea de tiempo, en minutos: cada barra va del inicio al fin del rango</p><ol class="ktl__rows">${tlRows}</ol><div class="ktl__ax" aria-hidden="true"><span class="ktl__axl"></span><div class="ktl__ticks">${ticks}</div></div></div>` : ''}${d.down ? `<p class="fig__note"><span class="k">Al bajar:</span> ${tx(d.down.replace(/^Al bajar:\s*/i, ''))}</p>` : ''}</div>`;
}

// 10 · Rollout: una línea de tiempo por pasos, con los pods viejos y nuevos a la vista.
function rolloutCalc(d) {
  const r = Number(d.replicas) || 0;
  const pct = (v, def, up) => { if (v === undefined || v === null) v = def; if (typeof v === 'string' && /%\s*$/.test(v)) return (up ? Math.ceil : Math.floor)((r * parseFloat(v)) / 100); return Number(v) || 0; };
  const surge = pct(d.max_surge, '25%', true), unav = pct(d.max_unavailable, '25%', false);
  return { r, surge, unav, maxT: r + surge, minR: r - unav };
}
function podRect(x, y, w, h, kind) {
  const cls = { old: 'f-free s-muted', ready: 'f-accent2 s-accent2', wait: 'f-paper s-hi' }[kind];
  const extra = kind === 'wait' ? 'rx="5" stroke-dasharray="4 3" stroke-width="2"' : 'rx="5" stroke-width="1.4"';
  return rect(x, y, w, h, cls, extra) + txt(x + w / 2, y + h / 2 + 4.5, kind === 'old' ? 'v1' : 'v2', kind === 'old' ? 'tl tb' : kind === 'ready' ? 'tl tb tw' : 'tl tb thi', 'middle');
}
const podKinds = (p) => [...Array(Math.max(0, p.old | 0)).fill('old'), ...Array(Math.max(0, p.ready_new | 0)).fill('ready'), ...Array(Math.max(0, (p.new | 0) - (p.ready_new | 0))).fill('wait')];
function rolloutWide(d, c) {
  const st = d.steps || [], N = Math.max(1, st.length), W = 760, X0 = 64, cw = (W - X0 - 6) / N;
  const SH = 30, SG = 6, top = 50, slots = Math.max(c.maxT, ...st.map((p) => podKinds(p).length));
  const base = top + slots * (SH + SG), yOf = (k) => base - (k + 1) * (SH + SG) + SG;
  const yMax = base - c.maxT * (SH + SG) + SG / 2 - 1, yMin = base - c.minR * (SH + SG) + SG / 2;
  let s = defs().s, maxL = 1;
  s += line(X0 - 6, yMax, W - 4, yMax, 'l-max') + tlines(6, yMax - 17, ['máx.', `${c.maxT} pods`], 't tb twarn', 'start', 13);
  s += line(X0 - 6, yMin, W - 4, yMin, 'l-min') + tlines(6, yMin + 15, [`mín. ${c.minR}`, 'listos'], 't tb ta2', 'start', 13);
  st.forEach((p, i) => {
    const cx = X0 + cw * (i + 0.5), pw = Math.min(cw - 14, 60);
    s += `<circle cx="${r1(cx)}" cy="20" r="12" class="f-ink"/>` + txt(cx, 24.5, String(i + 1), 'tnum', 'middle');
    podKinds(p).forEach((k, j) => { s += podRect(cx - pw / 2, yOf(j), pw, SH, k); });
    const ls = wrap(p.label || '', Math.max(10, Math.floor(cw / 6.7)));
    s += tlines(cx, base + 18, ls, 't', 'middle', 15);
    maxL = Math.max(maxL, ls.length);
  });
  return { s, H: base + 18 + (maxL - 1) * 15 + 12 };
}
function rolloutNarrow(d, c) {
  const st = d.steps || [], W = 330, X0 = 34, SW = 32, SG = 5, SH = 24;
  const slots = Math.max(c.maxT, ...st.map((p) => podKinds(p).length));
  const xs = (k) => X0 + k * (SW + SG), xMin = xs(c.minR) - SG / 2, xMax = xs(c.maxT) - SG / 2;
  const XL = xs(slots) + 4, maxCh = Math.max(12, Math.floor((W - XL - 4) / 6.5));
  let s = defs().s, y = 36, rows = '';
  st.forEach((p, i) => {
    const ls = wrap(p.label || '', maxCh), rh = Math.max(SH + 14, ls.length * 15 + 12), cy = y + rh / 2;
    rows += `<circle cx="14" cy="${r1(cy)}" r="11" class="f-ink"/>` + txt(14, cy + 4, String(i + 1), 'tnum', 'middle');
    podKinds(p).forEach((k, j) => { rows += podRect(xs(j), cy - SH / 2, SW, SH, k); });
    rows += tlines(XL, cy - ((ls.length - 1) * 15) / 2 + 4.5, ls, 't', 'start', 15);
    if (i < st.length - 1) rows += line(4, y + rh, W - 4, y + rh, 'grid');
    y += rh;
  });
  s += line(xMin, 28, xMin, y, 'l-min') + line(xMax, 28, xMax, y, 'l-max');
  s += txt(xMin - 3, 20, `mín. ${c.minR} listos`, 't tb ta2', 'end') + txt(xMax + 3, 20, `máx. ${c.maxT}`, 't tb twarn', 'start');
  return { s: s + rows, H: y + 6 };
}
function figRollout(d) {
  const c = rolloutCalc(d);
  for (const [i, p] of (d.steps || []).entries()) {
    const ready = (p.old | 0) + (p.ready_new | 0), total = (p.old | 0) + (p.new | 0);
    if (total > c.maxT || ready < c.minR) aviso(`rollout: el paso ${i + 1} tiene ${total} pods y ${ready} listos (límites: máx. ${c.maxT}, mín. ${c.minR} listos)`);
  }
  const w = rolloutWide(d, c), nw = rolloutNarrow(d, c);
  const aria = `Rolling update paso a paso: ${c.r} réplicas, maxSurge ${c.surge}, maxUnavailable ${c.unav}`;
  return `<p class="kro__h"><span><b>r = ${c.r}</b> réplicas</span><span><b>maxSurge ${esc(String(d.max_surge))}</b> → nunca más de ${c.maxT} pods</span><span><b>maxUnavailable ${esc(String(d.max_unavailable))}</b> → nunca menos de ${c.minR} listos</span></p>${svgFig(760, w.H, w.s, aria, 'fv-w', 860)}${svgFig(330, nw.H, nw.s, aria, 'fv-n', 470)}<p class="kleg"><span><i class="pod pod--old">v1</i>versión vieja (sirve)</span><span><i class="pod pod--wait">v2</i>nueva, todavía no Ready</span><span><i class="pod pod--ready">v2</i>nueva y Ready</span><span><i class="sw sw--min"></i>mínimo de listos</span><span><i class="sw sw--max"></i>máximo de pods</span></p>`;
}

// 12 · Estados del pod: máquina de estados por fase. Flechas numeradas; la lista de abajo dice qué las dispara.
const lk = (s) => norm(s).replace(/\s+/g, ' ').trim();
const LC = {
  wide: {
    W: 840, H: 300, cw: 8, cls: 'lc-w',
    pos: { pending: [80, 150, 112], containercreating: [262, 150, 156], imagepullbackoff: [262, 45, 156], createcontainerconfigerror: [262, 255, 222], 'running · 0/1': [474, 150, 128], 'running · 1/1': [654, 150, 128], crashloopbackoff: [564, 255, 152], terminating: [654, 45, 128], evicted: [785, 255, 96] },
    bands: { Pending: [8, 8, 368, 284], Running: [384, 8, 340, 284], Failed: [732, 8, 104, 284] }, route: {},
  },
  narrow: {
    W: 340, H: 548, cw: 7.4, cls: 'lc-n',
    pos: { pending: [80, 62, 136], containercreating: [80, 150, 136], imagepullbackoff: [255, 104, 146], createcontainerconfigerror: [255, 188, 146], 'running · 0/1': [80, 282, 136], crashloopbackoff: [255, 334, 146], 'running · 1/1': [80, 386, 136], terminating: [80, 460, 136], evicted: [255, 516, 120] },
    bands: { Pending: [4, 10, 332, 212], Running: [4, 230, 332, 252], Failed: [4, 490, 332, 52] },
    route: { 'imagepullbackoff>running · 0/1': { d: 'M330,104 H335 V252 L150,277', m: [335, 178] } },
  },
};
const stateCls = (s) => (/backoff|error|evicted|crash|failed/i.test(s) ? 'bad' : /1\/1|succeeded/i.test(s) ? 'ok' : /terminating|unknown/i.test(s) ? 'end' : 'wait');
const STATE_FILL = { bad: 'f-warn-soft s-warn', ok: 'f-ok-soft s-accent2', end: 'f-free s-muted', wait: 'f-hi-soft s-hi' };
// Nombre de estado en una línea si cabe; si no, en dos, cortando en la mayúscula que deja las líneas más parejas.
function stateLines(name, w, cw) {
  if (name.length <= Math.floor((w - 14) / cw)) return [name];
  let best = null;
  for (let i = 1; i < name.length; i++) {
    if (!/[A-Z]/.test(name[i]) || !/[a-z]/.test(name[i - 1])) continue;
    const a = name.slice(0, i).trim(), b = name.slice(i).trim(), m = Math.max(a.length, b.length);
    if (!best || m < best.m) best = { m, l: [a, b] };
  }
  return best ? best.l : wrap(name, Math.floor((w - 14) / cw));
}
function lifecycleSvg(d, L, edges) {
  const D = defs(); let s = D.s;
  const box = {}, H0 = 36;
  for (const [ph, [x, y, w, h]] of Object.entries(L.bands)) {
    s += rect(x, y, w, h, `band band--${ph.toLowerCase()}`, 'rx="10"') + txt(x + 10, y + 17, `FASE ${ph.toUpperCase()}`, 'bandl');
  }
  (d.states || []).forEach((st, i) => {
    const p = L.pos[lk(st)] || [L.W / 2, 30 + i * 50, 140];
    if (!L.pos[lk(st)]) aviso(`estados: no tengo lugar para "${st}"; lo puse en el centro`);
    const ls = stateLines(st, p[2], L.cw), h = H0 + (ls.length - 1) * 15;
    box[st] = { x: p[0], y: p[1], hw: p[2] / 2, hh: h / 2 };
  });
  const clip = (b, tx2, ty2) => { const dx = tx2 - b.x, dy = ty2 - b.y; const t = Math.min(dx ? b.hw / Math.abs(dx) : 1e9, dy ? b.hh / Math.abs(dy) : 1e9); return [b.x + dx * t, b.y + dy * t]; };
  let marks = '';
  edges.forEach((e) => {
    const A = box[e.from], B = box[e.to];
    if (!A || !B) return;
    const cls = stateCls(e.to) === 'bad' ? ['s-warn', 'warn'] : stateCls(e.from) === 'bad' ? ['s-accent2', 'ok'] : ['s-muted', 'arr'];
    const r = L.route[`${lk(e.from)}>${lk(e.to)}`];
    let d2, mx, my;
    if (r) { d2 = r.d; [mx, my] = r.m; }
    else {
      const rev = edges.some((f) => f.from === e.to && f.to === e.from);
      let [x1, y1] = clip(A, B.x, B.y), [x2, y2] = clip(B, A.x, A.y);
      if (rev) { const len = Math.hypot(x2 - x1, y2 - y1) || 1, ox = ((y2 - y1) / len) * 7, oy = (-(x2 - x1) / len) * 7; x1 += ox; y1 += oy; x2 += ox; y2 += oy; }
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      x1 += ux * 3; y1 += uy * 3; x2 -= ux * 4; y2 -= uy * 4;
      // en un par de ida y vuelta, cada número va cerca de su origen: así no se pisan
      const at = rev ? 0.3 : 0.5;
      d2 = `M${r1(x1)},${r1(y1)} L${r1(x2)},${r1(y2)}`; mx = x1 + (x2 - x1) * at; my = y1 + (y2 - y1) * at;
    }
    s += `<path d="${d2}" class="${cls[0]}" fill="none" stroke-width="1.8" marker-end="${D.m(cls[1])}"/>`;
    marks += numMark(mx, my, e.k);
  });
  for (const st of d.states || []) {
    const b = box[st], ls = stateLines(st, b.hw * 2, L.cw);
    s += rect(b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 2, STATE_FILL[stateCls(st)], 'rx="9" stroke-width="1.6"');
    s += tlines(b.x, b.y + 4.5 - ((ls.length - 1) * 15) / 2, ls, 'tst', 'middle', 15);
  }
  return s + marks;
}
function figLifecycle(d) {
  const edges = (d.edges || []).map(([from, to, label], i) => ({ from, to, label, k: i + 1 }));
  const known = new Set(d.states || []);
  edges.forEach((e) => { if (!known.has(e.from) || !known.has(e.to)) aviso(`estados: la flecha ${e.k} usa un estado que no está en la lista`); });
  for (const [ph, list] of Object.entries(d.phases || {})) for (const st of list) {
    const b = LC.wide.bands[ph], p = LC.wide.pos[lk(st)];
    if (b && p && (p[0] < b[0] || p[0] > b[0] + b[2])) aviso(`estados: "${st}" está en la fase ${ph}, pero lo dibujé fuera de su banda`);
  }
  const w = lifecycleSvg(d, LC.wide, edges), nw = lifecycleSvg(d, LC.narrow, edges);
  const aria = 'Estados de un pod agrupados por fase, con flechas numeradas entre ellos';
  return `${svgFig(LC.wide.W, LC.wide.H, w, aria, 'fv-w lc-w', 940)}${svgFig(LC.narrow.W, LC.narrow.H, nw, aria, 'fv-n lc-n', 470)}<p class="kleg"><span><i class="sw sw--wait"></i>esperando</span><span><i class="sw sw--ok"></i>listo</span><span><i class="sw sw--kill"></i>falla</span><span><i class="sw sw--off"></i>apagándose</span></p><ol class="kev klc">${edges.map((e) => `<li><span class="kev__n">${e.k}</span><span class="kev__x"><b>${esc(e.from)} → ${esc(e.to)}</b>: ${tx(e.label)}</span></li>`).join('')}</ol>`;
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
const MODLAB = (m) => (m === 'ref-comandos' ? 'Docker y kubectl' : /^m\d+$/.test(m) ? 'M' + parseInt(m.slice(1), 10) : m.toUpperCase());
function linkChip(anchor) {
  const [m, id] = anchor.replace(/^#/, '').split('.');
  const page = COURSE && COURSE.getPage ? COURSE.getPage(m) : null;
  const sec = page && (page.sections || []).find((x) => x.id === id);
  if (!sec) aviso(`enlace del curso que no existe: ${anchor}`);
  return `<a class="chip" href="https://ronda-diseno-ml.vercel.app/#${esc(anchor.replace(/^#/, ''))}" target="_blank" rel="noopener">${esc(MODLAB(m))} · ${esc(sec ? sec.title : id)}</a>`;
}

const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
const ORDER = ['bolsillo', 'cadena', 'que-es', 'manifest', 'deployments', 'servicios', 'probes', 'recursos', 'config', 'scheduling', 'autoscaling', 'rollouts', 'kubectl', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', 'que-es': '1 · Qué es', manifest: '2 · Manifest', deployments: '3 · Deployments', servicios: '4 · Services', probes: '5 · Probes', recursos: '6 · Recursos', config: '7 · Config', scheduling: '8 · Scheduling', autoscaling: '9 · Autoscaling', rollouts: '10 · Rollouts', kubectl: '11 · kubectl', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF).
const TOPIC_SECTION = { scheduling: 'scheduling', gpu: 'scheduling', imagen: 'diagnostico', arranque: 'diagnostico', probes: 'probes', recursos: 'recursos', red: 'servicios', config: 'config', almacenamiento: 'config', rbac: 'kubectl', api: 'kubectl', conexion: 'kubectl', rollout: 'rollouts', autoscaling: 'autoscaling', manifest: 'manifest' };
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
const FIG = { chain: figChain, cluster: figCluster, 'control-loop': figControlLoop, hierarchy: figHierarchy, network: figNetwork, probes: figProbes, resources: figResources, scheduling: figScheduling, autoscale: figAutoscale, rollout: figRollout, lifecycle: figLifecycle };
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') {
    if (!D.head) throw new Error(`figura table sin head en ${x.id}`);
    inner = dataTable(D.head, D.rows, { cls: tableCls(D.head), mono: x.id === 'bolsillo' ? [0] : [], cmd: x.id === 'kubectl' ? [1] : [] }) + noteP(D.note);
  } else if (FIG[f.kind]) {
    inner = FIG[f.kind](D) + (f.kind === 'cluster' ? '' : notesList(D.notes) + (D.note && !['table'].includes(f.kind) ? noteP(D.note) : ''));
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
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>OOMKilled</code> o <code>taint</code>).</p>
  </div>`;
}
function exampleHtml(x) {
  const e = x.example;
  return `<div class="example"><h3>Ejemplo real · ${esc(e.title)}</h3>${codeBlock(e.code, e.lang, null, e.source)}${e.notes && e.notes.length ? `<ul class="ex__notes">${e.notes.map((t) => `<li>${rx(t)}</li>`).join('')}</ul>` : ''}</div>`;
}
const notesHtml = (x) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p><p>${rx(stripLead(x.memo, 'Cómo recordarla'))}</p></div><div class="trap"><p class="tag">Trampa</p><p>${rx(stripLead(x.trap, 'Trampa'))}</p></div></div>`;
const linksHtml = (x) => (x.links && x.links.length ? `<p class="links"><span class="links__k">En el curso:</span> ${x.links.map(linkChip).join(' ')}</p>` : '');
function labHtml(x) {
  const l = x.lab;
  if (!l) { if (x.lab_omitted) aviso(`${x.id}: sin laboratorio (${x.lab_omitted})`); return ''; }
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  const ver = l.verified === 'executed' ? 'Ejecutado en un cluster local.' : 'Verificado contra la documentación; no ejecutado aquí.';
  // la línea estándar ya dice "no ejecutado aquí": no repetirlo al inicio de la nota del contenido
  const vnote = (t) => String(t || '').replace(/^No ejecutado aquí(?::[^.]*)?[.:]\s*/i, '');
  return `<details class="lab"><summary><span class="lab__t">Laboratorio en tu Mac (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
    <p class="lab__goal"><span class="k">Qué vas a provocar:</span> ${tx(l.goal)}</p>
    ${l.needs ? `<p class="lab__needs small"><span class="k">Necesitas:</span> ${tx(l.needs)}</p>` : ''}
    <ol class="lab__steps">${steps}</ol>
    <div class="lab__fix"><p class="tag">Cómo arreglarlo y confirmarlo</p><p>${tx(l.fix)}</p></div>
    <p class="verified">${ver}${vnote(l.verified_note) ? ` <span>${esc(vnote(l.verified_note))}</span>` : ''}</p>
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

// ================================================================ revisor de YAML
// Las 18 reglas de content-w1.json (revisor[].check), portadas de w1/revisor_check.py con la misma semántica:
// los mismos campos, defaults y casos borde. Corre sobre los objetos que devuelve jsyaml.loadAll.
// Devuelve hallazgos { id, doc, obj, container, detail } en el orden de las reglas y de los documentos.
const REVISOR_SRC = String.raw`function revisar(docs, ids) {
  'use strict';
  var WL = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob'];
  var TEMPLATED = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'];
  var CLUSTER_SCOPED = ['Namespace', 'Node', 'PersistentVolume', 'StorageClass', 'CustomResourceDefinition', 'PriorityClass', 'IngressClass', 'RuntimeClass', 'CSIDriver', 'CSINode', 'VolumeAttachment', 'APIService', 'MutatingWebhookConfiguration', 'ValidatingWebhookConfiguration', 'ValidatingAdmissionPolicy', 'ValidatingAdmissionPolicyBinding', 'MutatingAdmissionPolicy', 'MutatingAdmissionPolicyBinding', 'VolumeAttributesClass', 'DeviceClass', 'ResourceSlice', 'GatewayClass', 'NodePool', 'EC2NodeClass'];
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function O(v) { return isObj(v) ? v : {}; }
  function A(v) { return Array.isArray(v) ? v : []; }
  function has(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }
  function get(o, k, d) { return has(o, k) ? o[k] : d; }
  function nz(v) { return v === undefined ? null : v; }
  // verdad de Python: None, False, 0, '', [] y {} son falsos
  function truthy(v) { if (v === null || v === undefined || v === false || v === 0 || v === '') return false; if (Array.isArray(v)) return v.length > 0; if (isObj(v)) return Object.keys(v).length > 0; return true; }
  function pyStr(v) { if (v === null || v === undefined) return 'None'; if (v === true) return 'True'; if (v === false) return 'False'; return String(v); }
  function num(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var t = v.trim(); if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return parseFloat(t); if (/^[+-]?inf(inity)?$/i.test(t)) return t.charAt(0) === '-' ? -Infinity : Infinity; }
    return 0;
  }
  function pyInt(v) { if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'number') return isFinite(v) ? Math.trunc(v) : null; if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10); return null; }
  function ns(o) { var v = O(o.metadata).namespace; return truthy(v) ? v : ''; }
  function name(o) { var v = O(o.metadata).name; return truthy(v) ? v : ''; }
  function podSpec(o) { var s = O(o.spec); if (o.kind === 'Pod') return s; if (o.kind === 'CronJob') return O(O(O(O(s.jobTemplate).spec).template).spec); return O(O(s.template).spec); }
  function podLabels(o) { var s = O(o.spec), t; if (o.kind === 'Pod') return O(O(o.metadata).labels); if (o.kind === 'CronJob') t = O(O(O(s.jobTemplate).spec).template); else t = O(s.template); return O(O(t.metadata).labels); }
  function containers(ps) { return A(ps.containers).filter(isObj).concat(A(ps.initContainers).filter(isObj)); }
  function mains(ps) { return A(ps.containers).filter(isObj); }
  function pairs(m) { return Object.keys(O(m)).map(function (k) { return k + '=' + pyStr(m[k]); }).join(', '); }
  function mapMatch(sel, labels) { return Object.keys(sel).every(function (k) { return has(labels, k) && pyStr(labels[k]) === pyStr(sel[k]); }); }
  function lsMatch(sel, labels) {
    if (!isObj(sel)) return false;
    var ml = O(sel.matchLabels), k, ex = A(sel.matchExpressions);
    for (k in ml) if (has(ml, k) && (!has(labels, k) || pyStr(labels[k]) !== pyStr(ml[k]))) return false;
    for (var i = 0; i < ex.length; i++) {
      var e = O(ex[i]), key = e.key, op = e.operator, vals = A(e.values).map(pyStr);
      var present = typeof key === 'string' && has(labels, key), inVals = present && vals.indexOf(pyStr(labels[key])) >= 0;
      if (op === 'In' && !inVals) return false;
      if (op === 'NotIn' && inVals) return false;
      if (op === 'Exists' && !present) return false;
      if (op === 'DoesNotExist' && present) return false;
    }
    return true;
  }
  var wls = docs.filter(function (o) { return WL.indexOf(o.kind) >= 0; });
  var services = docs.filter(function (o) { return o.kind === 'Service'; });
  function svcSelects(s, w) { var sp = O(s.spec), sel = sp.selector; return sp.type !== 'ExternalName' && isObj(sel) && truthy(sel) && ns(s) === ns(w) && mapMatch(sel, podLabels(w)); }
  function lrDefault(o, res, which) {
    return docs.some(function (d) {
      return d.kind === 'LimitRange' && ns(d) === ns(o) && A(O(d.spec).limits).some(function (it) {
        return isObj(it) && it.type === 'Container' && which.some(function (w) { return has(O(it[w]), res); });
      });
    });
  }
  function gpuReq(c) { var r = O(c.resources); return Math.max(num(O(r.limits)['nvidia.com/gpu']), num(O(r.requests)['nvidia.com/gpu'])); }
  function tolerates(t, x) {
    var op = truthy(t.operator) ? t.operator : 'Equal';
    var keyOk = (!truthy(t.key) && t.operator === 'Exists') || (nz(t.key) === nz(x.key) && (t.operator === 'Exists' || (op === 'Equal' && pyStr(truthy(t.value) ? t.value : '') === pyStr(truthy(x.value) ? x.value : ''))));
    return keyOk && (!truthy(t.effect) || t.effect === x.effect);
  }
  function scalersFor(w) {
    return {
      hpas: docs.filter(function (h) { var r = O(O(h.spec).scaleTargetRef); return h.kind === 'HorizontalPodAutoscaler' && ns(h) === ns(w) && nz(r.kind) === nz(w.kind) && nz(r.name) === name(w); }),
      sos: docs.filter(function (s) { var r = O(O(s.spec).scaleTargetRef); return s.kind === 'ScaledObject' && pyStr(get(s, 'apiVersion', '')).indexOf('keda.sh/') === 0 && ns(s) === ns(w) && nz(r.name) === name(w) && (truthy(r.kind) ? r.kind : 'Deployment') === w.kind; })
    };
  }
  var NAME_TOK = ['PASSWORD', 'PASSWD', 'SECRET', 'APIKEY', 'CREDENTIAL', 'CREDENTIALS'];
  var PAIR_FIRST = ['API', 'ACCESS', 'SECRET', 'PRIVATE', 'ENCRYPTION', 'SIGNING'];
  var LAST_OK = ['FILE', 'PATH', 'DIR', 'URL', 'URI', 'ENDPOINT', 'NAME', 'ARN'];
  var VAL_RES = [/^AKIA[0-9A-Z]{16}$/, /^gh[pousr]_[A-Za-z0-9]{36,}$/, /^hf_[A-Za-z0-9]{30,}$/, /^sk-[A-Za-z0-9_-]{20,}$/, /^xox[abposr]-/];
  function nameSecret(nm, value) {
    var toks = pyStr(nm).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    if (!toks.length || LAST_OK.indexOf(toks[toks.length - 1]) >= 0 || pyStr(value).charAt(0) === '/') return false;
    if (toks.some(function (t) { return NAME_TOK.indexOf(t) >= 0; })) return true;
    var last = toks[toks.length - 1];
    if (last === 'TOKEN' || last === 'PASS' || (last === 'PWD' && toks.length > 1)) return true;
    for (var i = 0; i + 1 < toks.length; i++) if (PAIR_FIRST.indexOf(toks[i]) >= 0 && toks[i + 1] === 'KEY') return true;
    return false;
  }
  function valueSecret(v) {
    v = pyStr(v);
    var v2 = v.charAt(v.length - 1) === '\n' ? v.slice(0, -1) : v; // el $ de Python también calza antes de un \n final
    return VAL_RES.some(function (r) { return r.test(v2); }) || (v.indexOf('-----BEGIN') >= 0 && v.indexOf('PRIVATE KEY-----') >= 0);
  }
  function normProbe(p) {
    var h = null;
    if (truthy(p.httpGet)) { var g = O(p.httpGet); h = ['httpGet', get(g, 'path', '/'), nz(g.port), nz(g.host), get(g, 'scheme', 'HTTP')]; }
    else if (truthy(p.tcpSocket)) h = ['tcpSocket', nz(O(p.tcpSocket).port)];
    else if (truthy(p.grpc)) h = ['grpc', nz(O(p.grpc).port), nz(O(p.grpc).service)];
    else if (truthy(p.exec)) h = ['exec', A(O(p.exec).command)];
    return JSON.stringify([h, get(p, 'initialDelaySeconds', 0), get(p, 'periodSeconds', 10), get(p, 'timeoutSeconds', 1), get(p, 'failureThreshold', 3)]);
  }
  function prestopSecs(p) {
    var sl = O(p.sleep);
    if (sl.seconds !== null && sl.seconds !== undefined) return num(sl.seconds);
    var cmd = A(O(p.exec).command);
    if (cmd.length === 2 && (cmd[0] === 'sleep' || cmd[0] === '/bin/sleep')) return num(cmd[1]);
    if (cmd.length === 3 && ['sh', '/bin/sh', 'bash', '/bin/bash'].indexOf(cmd[0]) >= 0 && cmd[1] === '-c') {
      var m = /^\s*sleep\s+(\d+)\s*$/.exec(pyStr(cmd[2]));
      if (m) return parseFloat(m[1]);
    }
    return null;
  }
  var out = [];
  function add(id, o, x) { x = x || {}; out.push({ id: id, doc: docs.indexOf(o), obj: (o.kind || '?') + '/' + (name(o) || '(sin nombre)'), container: x.c === undefined ? null : pyStr(x.c), detail: x.d || '' }); }
  var RULES = {
    'sin-requests': function () {
      wls.forEach(function (o) {
        containers(podSpec(o)).forEach(function (c) {
          var r = O(c.resources), req = O(r.requests), lim = O(r.limits);
          var miss = ['cpu', 'memory'].filter(function (x) { var eff = has(req, x) ? req[x] : lim[x]; return (eff === null || eff === undefined) && !lrDefault(o, x, ['defaultRequest', 'default']); });
          if (miss.length) add('sin-requests', o, { c: c.name, d: 'falta el request de ' + miss.join(' y de ') });
        });
      });
    },
    'sin-limite-memoria': function () {
      wls.forEach(function (o) {
        containers(podSpec(o)).forEach(function (c) {
          var r = O(c.resources), rm = O(r.requests).memory, lm = O(r.limits).memory;
          if (rm !== null && rm !== undefined && (lm === null || lm === undefined) && !lrDefault(o, 'memory', ['default'])) add('sin-limite-memoria', o, { c: c.name, d: 'request de memoria ' + pyStr(rm) + ' y ningún limit' });
        });
      });
    },
    'sin-readiness': function () {
      docs.forEach(function (o) {
        if (TEMPLATED.indexOf(o.kind) < 0) return;
        var by = services.filter(function (s) { return svcSelects(s, o); });
        if (by.length && !mains(podSpec(o)).some(function (c) { return truthy(c.readinessProbe); })) add('sin-readiness', o, { d: 'lo selecciona el Service ' + name(by[0]) });
      });
    },
    'imagen-sin-tag': function () {
      wls.forEach(function (o) {
        containers(podSpec(o)).forEach(function (c) {
          var img = c.image;
          if (!truthy(img)) { add('imagen-sin-tag', o, { c: c.name, d: 'sin image' }); return; }
          img = String(img);
          if (img.indexOf('@') >= 0) return;
          var last = img.split('/').pop(), i = last.indexOf(':');
          if (i < 0 || last.slice(i + 1) === 'latest') add('imagen-sin-tag', o, { c: c.name, d: img });
        });
      });
    },
    'selector-no-coincide': function () {
      docs.forEach(function (o) {
        if (TEMPLATED.indexOf(o.kind) < 0) return;
        var sp = O(o.spec), sel = sp.selector, labels = O(O(O(sp.template).metadata).labels);
        if (!isObj(sel) || !truthy(sel) || (!truthy(sel.matchLabels) && !truthy(sel.matchExpressions)) || !lsMatch(sel, labels))
          add('selector-no-coincide', o, { d: 'selector ' + (isObj(sel) ? pairs(sel.matchLabels) || 'matchExpressions' : 'vacío') + ' · labels del template: ' + (pairs(labels) || 'ninguna') });
      });
    },
    'service-sin-pods': function () {
      if (!wls.length) return;
      services.forEach(function (s) {
        var sp = O(s.spec);
        if (sp.type === 'ExternalName' || !truthy(sp.selector)) return;
        if (!wls.some(function (w) { return svcSelects(s, w); })) add('service-sin-pods', s, { d: 'selector ' + pairs(sp.selector) + (ns(s) ? ' en ' + ns(s) : ' sin namespace') });
      });
    },
    'targetport-sin-puerto': function () {
      services.forEach(function (s) {
        var sp = O(s.spec);
        if (!truthy(sp.selector)) return;
        var selW = wls.filter(function (w) { return svcSelects(s, w); });
        if (!selW.length) return;
        var cand = [];
        selW.forEach(function (w) {
          var ps = podSpec(w);
          A(ps.containers).filter(isObj).concat(A(ps.initContainers).filter(function (c) { return isObj(c) && c.restartPolicy === 'Always'; })).forEach(function (c) { A(c.ports).filter(isObj).forEach(function (p) { cand.push(p); }); });
        });
        A(sp.ports).filter(isObj).forEach(function (p) {
          var tp = has(p, 'targetPort') ? p.targetPort : p.port;
          if (typeof tp === 'string') { if (!cand.some(function (cp) { return cp.name === tp; })) add('targetport-sin-puerto', s, { d: 'targetPort "' + tp + '": ningún puerto del contenedor se llama así' }); }
          else if (cand.length && !cand.some(function (cp) { return nz(cp.containerPort) === nz(tp); })) add('targetport-sin-puerto', s, { d: 'targetPort ' + pyStr(tp) + ': ningún containerPort tiene ese número' });
        });
      });
    },
    'gpu-sin-toleration': function () {
      var nodes = docs.filter(function (d) { return d.kind === 'Node'; });
      var gpuNodes = nodes.filter(function (nd) { return num(O(O(nd.status).allocatable)['nvidia.com/gpu']) > 0; });
      wls.forEach(function (o) {
        var ps = podSpec(o);
        if (!containers(ps).some(function (c) { return gpuReq(c) > 0; })) return;
        var tols = A(ps.tolerations).filter(isObj);
        if (nodes.length) {
          if (gpuNodes.length && gpuNodes.every(function (nd) { return A(O(nd.spec).taints).filter(isObj).some(function (x) { return (x.effect === 'NoSchedule' || x.effect === 'NoExecute') && !tols.some(function (t) { return tolerates(t, x); }); }); }))
            add('gpu-sin-toleration', o, { d: 'ningún Node GPU del YAML lo acepta con sus taints' });
        } else if (!tols.some(function (t) { var op = truthy(t.operator) ? t.operator : 'Equal'; return ((t.key === 'nvidia.com/gpu' && (op === 'Exists' || op === 'Equal')) || (!truthy(t.key) && t.operator === 'Exists')) && (!truthy(t.effect) || t.effect === 'NoSchedule'); }))
          add('gpu-sin-toleration', o, { d: 'pide nvidia.com/gpu y no tolera el taint nvidia.com/gpu' });
      });
    },
    'privilegiado': function () {
      wls.forEach(function (o) {
        var ps = podSpec(o), why = [];
        ['hostNetwork', 'hostPID', 'hostIPC'].forEach(function (h) { if (ps[h] === true) why.push(h + ': true'); });
        containers(ps).forEach(function (c) {
          var sc = O(c.securityContext), ad = O(sc.capabilities).add;
          var inc = function (v) { return (Array.isArray(ad) || typeof ad === 'string') && ad.indexOf(v) >= 0; };
          if (sc.privileged === true) why.push('privileged: true en ' + pyStr(c.name));
          if (inc('ALL') || inc('SYS_ADMIN')) why.push('capabilities.add en ' + pyStr(c.name));
        });
        if (why.length) add('privilegiado', o, { d: why.join(' · ') });
      });
    },
    'sin-runasnonroot': function () {
      wls.forEach(function (o) {
        var ps = podSpec(o), psc = O(ps.securityContext);
        containers(ps).forEach(function (c) {
          var sc = O(c.securityContext);
          var nr = has(sc, 'runAsNonRoot') ? sc.runAsNonRoot : psc.runAsNonRoot, ru = has(sc, 'runAsUser') ? sc.runAsUser : psc.runAsUser;
          if (nr !== true || ru === 0 || ru === false) add('sin-runasnonroot', o, { c: c.name, d: ru === 0 || ru === false ? 'runAsUser: 0 (root)' : 'falta runAsNonRoot: true' });
        });
      });
    },
    'secreto-literal': function () {
      docs.forEach(function (o) {
        if (WL.indexOf(o.kind) >= 0) {
          containers(podSpec(o)).forEach(function (c) {
            A(c.env).filter(isObj).forEach(function (e) {
              var v = e.value;
              if (typeof v === 'string' && v && (nameSecret(e.name, v) || valueSecret(v))) add('secreto-literal', o, { c: c.name, d: 'env ' + pyStr(e.name) });
            });
          });
        } else if (o.kind === 'ConfigMap') {
          var data = O(o.data);
          Object.keys(data).forEach(function (k) { if (nameSecret(k, data[k]) || valueSecret(data[k])) add('secreto-literal', o, { d: 'data.' + k }); });
        }
      });
    },
    'hostpath': function () {
      wls.forEach(function (o) {
        A(podSpec(o).volumes).filter(isObj).forEach(function (v) { if (has(v, 'hostPath')) add('hostpath', o, { d: 'volumen ' + pyStr(v.name) + (isObj(v.hostPath) && v.hostPath.path ? ' → ' + v.hostPath.path : '') }); });
      });
    },
    'replicas-con-autoscaler': function () {
      docs.forEach(function (o) {
        if ((o.kind !== 'Deployment' && o.kind !== 'StatefulSet') || !has(O(o.spec), 'replicas')) return;
        var sc = scalersFor(o);
        if (sc.hpas.length || sc.sos.length) add('replicas-con-autoscaler', o, { d: 'replicas: ' + pyStr(o.spec.replicas) + ' y lo escala ' + (sc.hpas.length ? 'el HPA ' + name(sc.hpas[0]) : 'el ScaledObject ' + name(sc.sos[0])) });
      });
    },
    'pdb-bloquea': function () {
      docs.forEach(function (p) {
        if (p.kind !== 'PodDisruptionBudget') return;
        var sp = O(p.spec), mu = sp.maxUnavailable, ma = sp.minAvailable;
        if (mu === 0 || mu === false || mu === '0%' || ma === '100%') { add('pdb-bloquea', p, { d: ma === '100%' ? 'minAvailable: 100%' : 'maxUnavailable: ' + pyStr(mu) }); return; }
        if (ma === null || ma === undefined) return;
        var sel = has(sp, 'selector') ? sp.selector : null, R = 0, known = false;
        docs.forEach(function (w) {
          if (['Deployment', 'StatefulSet', 'ReplicaSet'].indexOf(w.kind) < 0 || ns(w) !== ns(p)) return;
          if (sel === null || sel === undefined || !lsMatch(sel, podLabels(w))) return;
          var sc = scalersFor(w), k;
          if (sc.hpas.length) k = get(O(sc.hpas[0].spec), 'minReplicas', 1);
          else if (sc.sos.length) k = get(O(sc.sos[0].spec), 'minReplicaCount', 0);
          else if (has(O(w.spec), 'replicas')) k = w.spec.replicas;
          else return;
          k = pyInt(k);
          if (k === null) return;
          R += k; known = true;
        });
        if (!known) return;
        var need = (typeof ma === 'string' && ma.slice(-1) === '%') ? Math.ceil(parseFloat(ma.slice(0, -1)) / 100 * R) : pyInt(ma);
        if (need !== null && need >= R) add('pdb-bloquea', p, { d: 'minAvailable ' + pyStr(ma) + ' con ' + R + (R === 1 ? ' réplica mínima' : ' réplicas mínimas') });
      });
    },
    'liveness-igual-readiness': function () {
      wls.forEach(function (o) {
        mains(podSpec(o)).forEach(function (c) {
          var L = c.livenessProbe, R = c.readinessProbe;
          if (!truthy(L) || !isObj(L)) return;
          var pth = O(L.httpGet).path; pth = truthy(pth) ? String(pth) : '';
          if (pth.toLowerCase().indexOf('ready') >= 0) add('liveness-igual-readiness', o, { c: c.name, d: 'la liveness pregunta ' + pth });
          else if (truthy(R) && isObj(R) && normProbe(L) === normProbe(R)) add('liveness-igual-readiness', o, { c: c.name, d: 'liveness y readiness son la misma prueba' });
        });
      });
    },
    'gracia-menor-prestop': function () {
      wls.forEach(function (o) {
        var ps = podSpec(o), G = get(ps, 'terminationGracePeriodSeconds', 30);
        if (G === null) G = 30;
        mains(ps).forEach(function (c) {
          var p = O(c.lifecycle).preStop;
          if (!truthy(p) || !isObj(p)) return;
          var D = prestopSecs(p);
          if (D !== null && D >= G) add('gracia-menor-prestop', o, { c: c.name, d: 'preStop de ' + D + ' s con un plazo de ' + G + ' s' });
        });
      });
    },
    'namespace-faltante': function () {
      var objs = docs.filter(function (o) { return truthy(o.kind) && CLUSTER_SCOPED.indexOf(o.kind) < 0 && String(o.kind).indexOf('Cluster') !== 0; });
      var withNs = objs.filter(function (o) { return ns(o); }), without = objs.filter(function (o) { return !ns(o); });
      if (!withNs.length || !without.length) return;
      var where = withNs.map(ns).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
      without.forEach(function (o) { add('namespace-faltante', o, { d: 'los demás van en ' + where }); });
    },
    'gpu-sin-startup': function () {
      wls.forEach(function (o) {
        mains(podSpec(o)).forEach(function (c) {
          var L = c.livenessProbe;
          if (gpuReq(c) > 0 && truthy(L) && isObj(L) && !truthy(c.startupProbe)) {
            var t = get(L, 'initialDelaySeconds', 0) + get(L, 'periodSeconds', 10) * get(L, 'failureThreshold', 3);
            if (t < 300) add('gpu-sin-startup', o, { c: c.name, d: 'la liveness lo reinicia a los ' + t + ' s' });
          }
        });
      });
    }
  };
  (ids || Object.keys(RULES)).forEach(function (id) { if (RULES[id]) RULES[id](); });
  return out;
}`;
const RULE_IDS = [...REVISOR_SRC.matchAll(/^ {4}'([a-z0-9-]+)': function/gm)].map((m) => m[1]);
{
  const ids = W1.revisor.map((r) => r.id);
  ids.filter((id) => !RULE_IDS.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} del contenido no tiene implementación; el revisor la salta`));
  RULE_IDS.filter((id) => !ids.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} está implementada pero el contenido ya no la trae`));
  W1.revisor.forEach((r) => { if (!['error', 'warn', 'info'].includes(r.severity)) aviso(`revisor: severidad rara en ${r.id}: ${r.severity}`); });
}

// Un gateway como el del C01 con errores típicos: dispara 9 reglas, cada una una vez.
const BAD_EXAMPLE = `# EJEMPLO con errores a propósito: es para probar el revisor, no lo copies
apiVersion: v1
kind: ConfigMap
metadata:
  name: gateway-config
data:
  MODEL_NAME: classifier
  HF_TOKEN: hf_EJEMPLOnoUsarEstoEnProduccion1234
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  namespace: classifier
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: gateway
  template:
    metadata:
      labels:
        app.kubernetes.io/name: gateway
    spec:
      containers:
        - name: gateway
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/classifier-gateway:latest
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: gateway-config
          resources:
            requests:
              cpu: "1"
              memory: 1Gi
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
          livenessProbe:
            httpGet:
              path: /readyz
              port: http
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "45"]
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: classifier
spec:
  selector:
    app.kubernetes.io/name: gateway
  ports:
    - name: http
      port: 8080
      targetPort: web
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gateway
  namespace: classifier
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gateway
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
`;
const kindsOf = (yaml) => [...yaml.matchAll(/^kind:\s*(\S+)/gm)].map((m) => m[1]);
const listEs = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);
const SAMPLES = {
  bad: { text: BAD_EXAMPLE, label: 'EJEMPLO con errores a propósito: bórralo y pega tus manifests', cls: '' },
  gw: { text: C01.gateway, label: `C01 · reference/c01/k8s/gateway.yaml (${listEs(kindsOf(C01.gateway))})`, cls: 'ok' },
  tr: { text: C01.triton, label: `C01 · reference/c01/k8s/triton.yaml (${listEs(kindsOf(C01.triton))})`, cls: 'ok' },
};

// ================================================================ herramientas
function toolsHtml() {
  const D = W3.diagnosticador;
  D.forEach((g) => { if (g.causes.length < 2 || g.causes.length > 4) aviso(`diagnosticador: "${g.symptom}" tiene ${g.causes.length} causas (el brief pide 2–4)`); });
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">Corre primero</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y una revisión rápida de tus manifests antes del apply.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué correr primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de YAML</h3>
    <p class="small">Pega uno o más manifests (separados con <code class="nb">---</code>). Revisa ${W1.revisor.length} reglas típicas en tu navegador: lee el YAML y mira campos, labels, puertos y probes. No reemplaza a <code>kubectl apply <span class="nb">--dry-run=server</span></code>, que valida contra tu cluster.</p>
    <label class="rv-label" for="rv-text" id="rv-label">${esc(SAMPLES.bad.label)}</label>
    <textarea id="rv-text" rows="16" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-bad" type="button">Ejemplo con errores</button><button class="btn" id="rv-c01" type="button">C01 · gateway.yaml</button><button class="btn" id="rv-c01t" type="button">C01 · triton.yaml</button><button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
    <p class="small rv-note">Lee el YAML con js-yaml (de cdnjs): después de la primera visita queda guardado y funciona sin conexión.</p>
  </div>
</section>`;
}

// ================================================================ CSS
const CSS = `
/* El diseño de la hoja de Docker: papel cuadriculado para la sintaxis, tinta azul, resaltador ámbar.
   Colores de las figuras (uno por idea): azul = lo que pides, verde = listo, ámbar = esperando, rojo = falla,
   violeta = GPU, tinta = control plane. */
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
.card.tbl { margin-top: 16px; }
.pieces .vars { margin-top: 4px; }
figure.fig { min-width: 0; margin: 18px 0 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 14.5px; margin-top: 12px; }
svg.chart { width: 100%; height: auto; display: block; margin: 0 auto; }
svg .t { fill: var(--muted); font: 12.5px var(--f-display); } svg .tl { fill: var(--ink); font: 13px var(--f-display); } svg .tb { font-weight: 700; }
svg .tm { fill: var(--ink); font: 12.5px var(--f-mono); } svg .tbig { font-size: 15px; }
svg .ta { fill: var(--accent); } svg .ta2 { fill: var(--accent2); } svg .twarn { fill: var(--warn); } svg .thi { fill: var(--hi-ink); }
svg .halo { paint-order: stroke; stroke: var(--paper); stroke-width: 4px; stroke-linejoin: round; }
svg .tw { fill: var(--onbar); font-weight: 700; } svg .ton-hi { fill: var(--on-hi); font-weight: 700; }
svg .tnum { fill: var(--paper); font: 800 11.5px var(--f-display); }
svg .tst { fill: var(--ink); font: 700 13.5px var(--f-display); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .l-dash { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 5 4; } svg .l-off { stroke: var(--rule); stroke-width: 2; }
svg .l-ok { stroke: var(--accent2); stroke-width: 3; } svg .l-kill { stroke: var(--warn); stroke-width: 3.2; }
svg .l-max { stroke: var(--warn); stroke-width: 1.6; stroke-dasharray: 6 4; } svg .l-min { stroke: var(--accent2); stroke-width: 1.8; stroke-dasharray: 6 4; }
svg .s-accent { stroke: var(--accent); } svg .s-accent2 { stroke: var(--accent2); } svg .s-muted { stroke: var(--muted); } svg .s-rule { stroke: var(--rule); stroke-width: 1.2; } svg .s-ink { stroke: var(--ink); stroke-width: 1.2; } svg .s-hi { stroke: var(--hi); stroke-width: 1.6; } svg .s-warn { stroke: var(--warn); stroke-width: 1.4; } svg .s-paper { stroke: var(--paper); }
svg .f-accent { fill: var(--accent); } svg .f-accent-soft { fill: var(--accent-soft); } svg .f-accent2 { fill: var(--accent2); } svg .f-ok-soft { fill: var(--ok-soft); } svg .f-ink { fill: var(--ink); }
svg .f-hi { fill: var(--hi); } svg .f-hi-soft { fill: var(--hi-soft); } svg .f-warn { fill: var(--warn); } svg .f-warn-soft { fill: var(--warn-soft); } svg .f-paper { fill: var(--paper); } svg .f-muted { fill: var(--muted); } svg .f-free { fill: var(--free); }
svg .band { fill: var(--free); opacity: .5; } svg .band--failed { fill: var(--warn-soft); opacity: .7; }
svg .bandl { fill: var(--muted); font: 800 10.5px var(--f-display); letter-spacing: .12em; }
/* dos dibujos por figura a escala: el ancho (tablet, escritorio, impresión) y el angosto (celular) */
svg.chart.fv-n { display: none; }
@media (max-width: 679px) { svg.chart.fv-w { display: none; } svg.chart.fv-n { display: block; } figure.fig { padding: 12px; } }
svg.lc-w .tst { font-size: 14.5px; } svg.lc-w .tnum { font-size: 12.5px; }
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
code, pre, .cmd, var.ph { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
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
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; }
.sw--app { background: var(--accent2); } .sw--sys { background: var(--bg); border: 1px solid var(--rule); } .sw--gpu { background: var(--pu-soft); border: 2px solid var(--pu); }
.sw--path { height: 4px; background: var(--accent2); } .sw--side { height: 0; border-top: 2px dashed var(--muted); border-radius: 0; }
.sw--wait { background: var(--hi-soft); border: 1.5px solid var(--hi); } .sw--ok { background: var(--accent2); } .sw--off { height: 0; border-top: 2px dashed var(--muted); border-radius: 0; } .sw--kill { background: var(--warn); }
.sw--req { background: var(--accent); } .sw--lim { width: 4px; height: 16px; background: var(--warn); } .sw--free { border: 1.5px dashed var(--accent); }
.sw--min { height: 0; border-top: 2px dashed var(--accent2); border-radius: 0; } .sw--max { height: 0; border-top: 2px dashed var(--warn); border-radius: 0; }
.pod { display: inline-grid; place-items: center; flex: none; width: 30px; height: 22px; border-radius: 5px; font: 700 11px/1 var(--f-display); font-style: normal; }
.pod--old { background: var(--free); border: 1.4px solid var(--muted); color: var(--ink); }
.pod--ready, .pod--run { background: var(--accent2); color: var(--onbar); }
.pod--wait { border: 2px dashed var(--hi); color: var(--hi-ink); background: var(--paper); }
.pod--want { border: 2px dashed var(--accent); background: var(--paper); }
.pod--cut { position: relative; border: 2px solid var(--warn); background: var(--warn-soft); }
.pod--cut::after { content: ""; position: absolute; left: 2px; right: 2px; top: calc(50% - 1px); height: 2px; background: var(--warn); transform: rotate(-32deg); }
.kno { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; font: 800 12.5px/1 var(--f-display); background: var(--hi); color: var(--on-hi); }
.kno.ok { background: var(--accent2); color: var(--onbar); }
ol.kev { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; font-size: 15px; line-height: 1.45; }
ol.kev li { display: grid; grid-template-columns: 22px 46px minmax(0, 1fr); gap: 8px; align-items: baseline; }
ol.kev.klc li { grid-template-columns: 22px minmax(0, 1fr); }
.kev__n { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11.5px/1 var(--f-display); }
.kev__t { font: 700 13px/1.4 var(--f-mono); color: var(--muted); }
.kev__x b { font-family: var(--f-display); }
@media (min-width: 900px) { ol.kev.klc { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; } }
/* ---------- la cadena */
.kchain { display: grid; gap: 10px; }
.kz { --zc: var(--muted); border: 1px solid var(--rule); border-left: 5px solid var(--zc); border-radius: 10px; padding: 10px 12px 2px; min-width: 0; }
.kz--tu { --zc: var(--accent); } .kz--cp { --zc: var(--ink); } .kz--nodo { --zc: var(--hi); } .kz--red { --zc: var(--accent2); }
.kz__h { margin: 0 0 8px; font: 800 12px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
ol.kz__steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.kst { position: relative; padding: 0 0 12px 38px; min-width: 0; }
.kst__no { position: absolute; left: 0; top: 0; width: 27px; height: 27px; border-radius: 50%; background: var(--zc); color: var(--paper); display: grid; place-items: center; font: 800 13px/1 var(--f-display); }
.kz--nodo .kst__no { color: var(--on-hi); }
.kst:not(:last-child)::before { content: ""; position: absolute; left: 12.5px; top: 30px; bottom: 3px; width: 2px; background: var(--rule); }
.kst__l { margin: 1px 0 3px; font: 700 15.5px/1.35 var(--f-display); }
.kst__n { margin: 5px 0 0; font-size: 15px; line-height: 1.5; }
/* ---------- el cluster */
.kcl__cp { background: var(--ink); color: var(--paper); border-radius: 12px; padding: 12px 14px; }
.kcl__cph { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; margin: 0 0 8px; font: 800 16px/1.3 var(--f-display); }
.kcl__cph small { font: 600 12.5px/1.3 var(--f-display); opacity: .85; }
ul.kcl__comp { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
ul.kcl__comp li { font: 500 13.5px/1.35 var(--f-display); border: 1px solid color-mix(in srgb, var(--paper) 38%, transparent); border-radius: 8px; padding: 4px 9px; }
.kcl__link { display: flex; align-items: center; gap: 10px; margin: 0; padding: 6px 0 6px 18px; color: var(--muted); font: 600 13px/1.35 var(--f-display); }
.kcl__wire { flex: none; width: 2px; height: 30px; background: var(--ink); position: relative; }
.kcl__wire::before, .kcl__wire::after { content: ""; position: absolute; left: -4px; border: 5px solid transparent; }
.kcl__wire::before { top: -5px; border-bottom-color: var(--ink); border-top-width: 0; } .kcl__wire::after { bottom: -5px; border-top-color: var(--ink); border-bottom-width: 0; }
.kcl__nodes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 979px) { .kcl__nodes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 519px) { .kcl__nodes { grid-template-columns: minmax(0, 1fr); } }
.kn { display: flex; flex-direction: column; gap: 5px; min-width: 0; border: 1.5px solid var(--rule); border-radius: 12px; padding: 10px 12px; }
.kn--gpu { border: 2px solid var(--pu); background: var(--pu-soft); }
.kn p { margin: 0; }
.kn__h { font: 700 14.5px/1.35 var(--f-display); }
.kn__badge { display: inline-block; margin-right: 7px; padding: 3px 6px; border-radius: 5px; background: var(--muted); color: var(--paper); font: 800 10.5px/1 var(--f-display); letter-spacing: .08em; vertical-align: 2px; }
.kn--gpu .kn__badge { background: var(--pu); }
.kn__lab, .kn__taint { font-size: 13.5px; line-height: 1.4; }
.kn__taint code { color: var(--warn); }
ul.kn__pods { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 5px; }
ul.kn__pods li { font: 500 13px/1.3 var(--f-display); border: 1px solid var(--rule); background: var(--bg); border-radius: 6px; padding: 3px 7px; }
ul.kn__pods li.app { background: var(--accent2); border-color: var(--accent2); color: var(--onbar); font-weight: 700; }
.kn__base { margin-top: auto !important; padding-top: 6px; border-top: 1px dashed var(--rule); font: 600 12px/1.3 var(--f-mono); color: var(--muted); }
/* ---------- el lazo de control */
.kloop { display: grid; grid-template-columns: minmax(0, 1fr) 220px minmax(0, 1fr); grid-template-areas: "want loop real" "acts acts acts" "who who who"; gap: 12px 18px; align-items: center; }
.kloop__want { grid-area: want; } .kloop__real { grid-area: real; } .kloop__mid { grid-area: loop; } .kloop__acts { grid-area: acts; } .kloop__who { grid-area: who; }
.kloop__state { border: 2px solid; border-radius: 12px; padding: 10px 12px; min-width: 0; }
.kloop__state p { margin: 0; font-size: 15.5px; line-height: 1.5; }
.kloop__want { border-color: var(--accent); background: var(--accent-soft); } .kloop__want .tag { color: var(--accent) !important; }
.kloop__real { border-color: var(--hi); background: var(--hi-soft); } .kloop__real .tag { color: var(--hi-ink) !important; }
svg.kloop__svg { max-width: 220px; }
ol.kloop__acts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 14px; }
ol.kloop__acts li { display: flex; gap: 8px; align-items: flex-start; font-size: 15px; line-height: 1.45; min-width: 0; }
.kloop__who { margin: 0; font-size: 15px; }
@media (max-width: 760px) {
  .kloop { grid-template-columns: minmax(0, 1fr); grid-template-areas: "want" "real" "loop" "acts" "who"; }
  ol.kloop__acts { grid-template-columns: minmax(0, 1fr); }
  svg.kloop__svg { max-width: 200px; }
}
/* ---------- la jerarquía */
.kh { border: 1.5px solid var(--rule); border-radius: 10px; padding: 9px 12px; min-width: 0; }
.kh--0 { border: 2px solid var(--accent); background: var(--accent-soft); }
.kh--1 { margin-left: 26px; } .kh--2, .kh--3 { margin-left: 52px; background: var(--ok-soft); border-color: var(--accent2); }
.kh p { margin: 0; }
.kh__k { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.kh__kind { font: 800 16px/1.3 var(--f-display); }
.kh__who { font: 600 12.5px/1.3 var(--f-display); color: var(--muted); }
.kh__n { margin-top: 4px !important; font-size: 15px; line-height: 1.5; }
.kh__arrow { display: flex; flex-wrap: wrap; gap: 2px 18px; margin: 0; padding: 5px 0 5px 40px; font: 600 12.5px/1.3 var(--f-display); color: var(--muted); }
.kh__arrow.lv2, .kh__arrow.lv3 { margin-left: 26px; }
.khier__sel { margin: 12px 0 0; font-size: 15px; }
@media (max-width: 520px) { .kh--1 { margin-left: 12px; } .kh--2, .kh--3 { margin-left: 24px; } .kh__arrow { padding-left: 20px; } .kh__arrow.lv2, .kh__arrow.lv3 { margin-left: 12px; } }
/* ---------- la red */
.knet { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); grid-template-areas: "lg lg" "a side" "b side" "dns dns"; gap: 0 26px; align-items: start; }
.knet__lg { grid-area: lg; margin: 0 0 10px; } .knet__a { grid-area: a; } .knet__b { grid-area: b; } .knet__side { grid-area: side; } .knet__dns { grid-area: dns; }
.knet--plain { display: block; }
.knet__lg { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.knet__lg span { display: inline-flex; align-items: center; gap: 6px; }
ol.knet__path { list-style: none; margin: 0; padding: 0; }
.hop { position: relative; padding: 0 0 14px 32px; min-width: 0; }
.hop::before { content: ""; position: absolute; left: 9px; top: 6px; bottom: -6px; width: 4px; background: var(--accent2); border-radius: 2px; }
.hop::after { content: ""; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: var(--paper); border: 4px solid var(--accent2); box-sizing: border-box; }
.knet__b .hop:last-child::before, .knet--plain .hop:last-child::before { display: none; }
.hop p { margin: 0; }
.hop__h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 8px; font: 700 15px/1.35 var(--f-display); }
.hop__p { font: 600 12.5px/1.45 var(--f-mono); }
.hop__n { margin-top: 3px !important; font-size: 15px; line-height: 1.5; }
.hop--jump { padding-bottom: 10px; } .hop--jump::after { display: none; }
.hop__j { font: 700 13px/1.35 var(--f-display); color: var(--accent2); }
.knet__side { border: 1.5px dashed var(--muted); border-radius: 12px; padding: 10px 12px 0; background: var(--bg); min-width: 0; }
.knet__sideh { margin: 0 0 10px; font: 800 12px/1.35 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.hop--side::before { background: none; border-left: 2px dashed var(--muted); width: 0; left: 10px; }
.hop--side::after { border-color: var(--muted); border-width: 3px; }
.knet__side .hop--side:last-child::before { display: none; }
.knet__dns { display: flex; gap: 10px; align-items: baseline; margin: 6px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 15px; line-height: 1.5; }
.knet__dnsk { flex: none; font: 800 11px/1 var(--f-display); letter-spacing: .1em; padding: 4px 7px; border-radius: 5px; background: var(--accent); color: var(--paper); }
@media (max-width: 699px) {
  .knet { grid-template-columns: minmax(0, 1fr); grid-template-areas: "lg" "a" "side" "b" "dns"; }
  .knet__side { position: relative; margin: 0 0 14px 32px; }
  .knet__side::before { content: ""; position: absolute; left: -23px; top: -6px; bottom: -14px; width: 4px; border-radius: 2px; background: var(--accent2); }
}
/* ---------- probes */
.kpr { display: grid; gap: 18px; }
.kpr__h { margin: 0 0 6px; font: 800 13px/1.35 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--ink); }
.kpr__h span { font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--muted); }
/* ---------- recursos */
.kres { display: grid; gap: 12px; }
.kres > .kleg { margin: 0; }
.krn { border: 1.5px solid var(--rule); border-radius: 12px; padding: 10px 12px 2px; min-width: 0; }
.krn--gpu { border: 2px solid var(--pu); }
.krn--x { border-style: dashed; }
.krn p { margin: 0; }
.krn__h { font: 700 15.5px/1.35 var(--f-display); }
.krn__cap { font: 600 12.5px/1.5 var(--f-mono); color: var(--muted); }
.krn__note { font-size: 14px; color: var(--muted); }
.krr { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 4px 14px; padding: 10px 0; border-top: 1px solid var(--rule); align-items: center; margin-top: 8px; }
.krr + .krr { margin-top: 0; }
.krr__name { font: 700 13.5px/1.35 var(--f-mono); }
.krr__vals { font: 500 12.5px/1.4 var(--f-mono); color: var(--muted); }
.krr__over { grid-column: 1 / -1; font-size: 14.5px; line-height: 1.45; }
.krr__over.bad { color: var(--warn); } .krr__over.wait { color: var(--hi-ink); }
.rbar { position: relative; height: 16px; border-radius: 4px; background: var(--free); }
.rbar__req { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 4px 0 0 4px; }
.rbar__lim { position: absolute; top: -5px; bottom: -5px; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--warn); }
.rbar__lim.cpu { background: var(--hi); }
.rbar__free { position: absolute; top: 3px; bottom: 3px; right: 0; border: 1.5px dashed var(--accent); border-left: 0; border-radius: 0 4px 4px 0; }
p.rbar__ax { display: flex; justify-content: space-between; margin-top: 3px !important; font: 500 11.5px/1.3 var(--f-mono); color: var(--muted); }
.gslots { display: flex; align-items: center; gap: 6px; }
.gslot { display: inline-block; flex: none; width: 34px; height: 22px; border-radius: 5px; border: 2px solid var(--pu); background: var(--paper); }
.gslot.on { background: var(--pu); }
.gslot.sm { width: 20px; height: 14px; border-radius: 3px; }
.gslots__t { font: 600 12.5px var(--f-display); color: var(--pu); }
.kcfs { display: flex; height: 26px; border-radius: 5px; overflow: hidden; font: 700 12px/26px var(--f-display); }
.kcfs__run { flex: none; background: var(--accent2); color: var(--onbar); text-align: center; white-space: nowrap; overflow: hidden; }
.kcfs__thr { flex: 1; min-width: 0; padding-left: 8px; color: var(--hi-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: repeating-linear-gradient(45deg, var(--hi-soft) 0 6px, color-mix(in srgb, var(--hi) 35%, var(--hi-soft)) 6px 8px); }
p.kcfs__ax { position: relative; height: 16px; margin-top: 3px !important; font: 500 11.5px/1.3 var(--f-mono); color: var(--muted); }
.kcfs__ax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.kcfs__ax span:first-child { transform: none; } .kcfs__ax span:last-child { transform: translateX(-100%); }
@media (max-width: 600px) { .krr { grid-template-columns: minmax(0, 1fr); } }
/* ---------- scheduling */
.ksch { display: grid; grid-template-columns: minmax(170px, 1.45fr) repeat(var(--nn), minmax(0, 1fr)); gap: 6px; }
.ksch__nodes, .ksch__row, .ksch__cells { display: contents; }
.ksch__corner { display: flex; align-items: flex-end; padding: 0 4px 6px; }
.ksch__corner p { margin: 0; }
.ksn, .ksp, .ksc { min-width: 0; border-radius: 10px; padding: 8px 9px; }
.ksn { border: 1.5px solid var(--rule); }
.ksn--gpu { border: 2px solid var(--pu); background: var(--pu-soft); }
.ksn p, .ksp p { margin: 0; }
.ksn__name { font: 700 14px/1.3 var(--f-mono); }
.ksn__meta { font: 500 12.5px/1.35 var(--f-display); color: var(--muted); }
.ksn__lab, .ksn__taint, .ksn__note { margin-top: 4px !important; font: 500 12px/1.35 var(--f-mono); overflow-wrap: anywhere; }
.ksn__taint { color: var(--warn); } .ksn__note { font-family: var(--f-display); color: var(--muted); }
.ksn__gpu { display: flex; align-items: center; gap: 6px; margin-top: 5px !important; font: 700 12px/1.3 var(--f-display); color: var(--pu); }
.ksn .k, .ksp .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-right: 2px; }
.ksp { border: 2px solid var(--accent); background: var(--accent-soft); }
.ksp__name { font: 700 14.5px/1.3 var(--f-display); }
.ksp__l { margin-top: 3px !important; font-size: 13.5px; line-height: 1.4; overflow-wrap: anywhere; }
.ksc { display: flex; gap: 7px; align-items: center; font: 500 13px/1.35 var(--f-display); }
.ksc--ok { background: var(--ok-soft); color: var(--accent2); }
.ksc--no { background: var(--warn-soft); color: var(--warn); }
.ksc__m { flex: none; font: 800 19px/1 var(--f-display); }
.ksc__r { min-width: 0; overflow-wrap: anywhere; }
.ksch__after { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--hi-soft); border-left: 4px solid var(--hi); }
.ksch__after p { margin: 0; font-size: 15px; line-height: 1.5; }
@media (max-width: 699px) {
  .ksch { display: block; }
  .ksch__corner { display: none; }
  .ksch__nodes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .ksch__row { display: block; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--rule); }
  .ksch__cells { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 6px; }
  .ksc { align-items: baseline; }
  .ksc::before { content: attr(data-node); flex: none; min-width: 52px; font: 700 12.5px/1.35 var(--f-mono); color: var(--ink); }
  .ksc__m { font-size: 16px; }
}
/* ---------- autoscaling */
.kas { display: grid; gap: 16px; }
.kas__calc { display: grid; gap: 8px; }
.kas p { margin: 0; }
.kas__m { font-size: 15px; }
.kas__row { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 4px 12px; align-items: center; }
.kas__lab { font: 700 13px/1.35 var(--f-display); color: var(--muted); }
.kas__v { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-width: 0; }
.pods { display: inline-flex; flex-wrap: wrap; gap: 5px; }
.kas__eq { font: 600 13.5px/1.4 var(--f-mono); }
ol.kas__steps { margin: 4px 0 0; padding-left: 22px; font-size: 15px; line-height: 1.5; }
.ktl__h { font: 800 12px/1.35 var(--f-display) !important; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
ol.ktl__rows { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
.ktr { display: grid; grid-template-columns: 62px minmax(0, 1fr) minmax(0, 0.95fr); gap: 4px 12px; align-items: center; }
.ktr__lane { justify-self: start; font: 800 10.5px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; padding: 4px 6px; border-radius: 5px; }
.ktr__lane.pods { background: var(--accent-soft); color: var(--accent); } .ktr__lane.nodos { background: var(--pu-soft); color: var(--pu); }
.ktr__label { font-size: 14.5px; line-height: 1.4; }
.ktr__t { font: 600 12px var(--f-mono); color: var(--muted); white-space: nowrap; }
.ktrack { position: relative; height: 16px; border-radius: 3px; background-color: var(--bg); background-image: repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px calc(100% / var(--n))); border: 1px solid var(--rule); }
.ktrack__bar { position: absolute; top: 2px; bottom: 2px; border-radius: 3px; min-width: 4px; }
.ktrack__bar.pods { background: var(--accent); } .ktrack__bar.nodos { background: var(--pu); }
.ktrack__dot { position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; }
.ktrack__dot.pods { background: var(--accent); } .ktrack__dot.nodos { background: var(--pu); }
.ktl__ax { display: grid; grid-template-columns: 62px minmax(0, 1fr) minmax(0, 0.95fr); gap: 0 12px; margin-top: 4px; }
.ktl__axl { grid-column: 1 / 3; }
.ktl__ticks { position: relative; height: 16px; font: 500 11.5px/1.3 var(--f-mono); color: var(--muted); }
.ktl__ticks span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.ktl__ticks span.start { transform: none; } .ktl__ticks span.end { transform: translateX(-100%); }
@media (max-width: 699px) {
  .kas__row { grid-template-columns: minmax(0, 1fr); }
  .ktr { grid-template-columns: 62px minmax(0, 1fr); }
  .ktrack { grid-column: 1 / -1; }
  .ktl__ax { grid-template-columns: minmax(0, 1fr); }
  .ktl__axl { display: none; }
}
/* ---------- rollout */
.kro__h { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 10px; font: 500 14px/1.4 var(--f-display); color: var(--muted); }
.kro__h b { color: var(--ink); }
/* tablas: se apilan en el celular */
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
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
  svg.chart.fv-n { display: none !important; } svg.chart.fv-w { display: block !important; }
  .k { font-size: 9px; } .ksn .k, .ksp .k, .kn .k { font-size: 7.5px; }
  .kleg, .knet__lg, .kro__h { font-size: 9.5px; margin-top: 6px; } .sw { width: 12px; height: 9px; } .pod { width: 24px; height: 17px; font-size: 9px; }
  .kchain { gap: 6px; } .kz { padding: 6px 10px 0; } .kz__h { font-size: 9px; margin-bottom: 5px; } .kst { padding: 0 0 7px 30px; } .kst__no { width: 21px; height: 21px; font-size: 10.5px; } .kst:not(:last-child)::before { left: 9.5px; top: 23px; }
  .kst__l { font-size: 11.5px; } .kst__n { font-size: 10.5px; margin-top: 3px; }
  .kcl__cp { padding: 8px 10px; } .kcl__cph { font-size: 12px; margin-bottom: 5px; } .kcl__cph small { font-size: 9.5px; } ul.kcl__comp li { font-size: 10px; padding: 2px 6px; }
  .kcl__link { font-size: 10px; padding: 3px 0 3px 14px; } .kcl__wire { height: 20px; }
  .kcl__nodes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; } .kn { padding: 6px 8px; gap: 3px; } .kn__h { font-size: 10.5px; } .kn__lab, .kn__taint { font-size: 9.5px; } ul.kn__pods li { font-size: 9.5px; padding: 1px 5px; } .kn__base { font-size: 9px; }
  .kloop { grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1fr); grid-template-areas: "want loop real" "acts acts acts" "who who who"; gap: 8px 12px; }
  .kloop__state { padding: 6px 9px; } .kloop__state p, ol.kloop__acts li, .kloop__who { font-size: 10.5px; } svg.kloop__svg { max-width: 150px; }
  ol.kloop__acts { grid-template-columns: repeat(4, minmax(0, 1fr)); } .kno { width: 18px; height: 18px; font-size: 9.5px; }
  .kh { padding: 5px 9px; } .kh__kind { font-size: 12px; } .kh__who { font-size: 9.5px; } .kh__n, .khier__sel { font-size: 10.5px; } .kh__arrow { font-size: 9.5px; padding-top: 3px; padding-bottom: 3px; }
  .knet { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); grid-template-areas: "lg lg" "a side" "b side" "dns dns"; }
  .knet__side { margin: 0; } .knet__side::before { display: none; }
  .hop { padding: 0 0 8px 26px; } .hop__h { font-size: 11px; } .hop__p { font-size: 9.5px; } .hop__n, .knet__dns { font-size: 10.5px; } .hop__j { font-size: 10px; } .knet__sideh { font-size: 9px; }
  ol.kev { font-size: 10.5px; gap: 3px; } ol.kev li { grid-template-columns: 17px 36px minmax(0, 1fr); gap: 6px; } ol.kev.klc li { grid-template-columns: 17px minmax(0, 1fr); } ol.kev.klc { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; }
  .kev__n { width: 17px; height: 17px; font-size: 9px; } .kev__t { font-size: 9.5px; } .kpr { gap: 10px; } .kpr__h { font-size: 10px; }
  .krn { padding: 6px 9px 0; } .krn__h { font-size: 11.5px; } .krn__cap, .krn__note { font-size: 9.5px; }
  .krr { grid-template-columns: 160px minmax(0, 1fr); padding: 6px 0; } .krr__name { font-size: 10px; } .krr__vals, p.rbar__ax, p.kcfs__ax { font-size: 9px; } .krr__over { font-size: 10.5px; }
  .rbar { height: 11px; } .gslot { width: 26px; height: 16px; } .kcfs { height: 18px; font-size: 9.5px; line-height: 18px; }
  .ksch { display: grid; grid-template-columns: minmax(120px, 1.1fr) repeat(var(--nn), minmax(0, 1fr)); gap: 4px; }
  .ksch__nodes, .ksch__row, .ksch__cells { display: contents; } .ksch__corner { display: flex; }
  .ksc::before { content: none; } .ksn, .ksp, .ksc { padding: 5px 6px; } .ksn__name, .ksp__name { font-size: 10.5px; } .ksn__meta, .ksn__lab, .ksn__taint, .ksn__note, .ksn__gpu, .ksp__l, .ksc { font-size: 9.5px; } .ksc__m { font-size: 13px; }
  .ksch__after { padding: 6px 9px; margin-top: 8px; } .ksch__after p { font-size: 10.5px; }
  .kas { gap: 10px; } .kas__m, ol.kas__steps, .ktr__label { font-size: 10.5px; } .kas__row { grid-template-columns: 110px minmax(0, 1fr); } .kas__lab { font-size: 10px; } .kas__eq { font-size: 10px; }
  .ktr { grid-template-columns: 50px minmax(0, 1fr) minmax(0, 0.95fr); gap: 2px 8px; } ol.ktl__rows { gap: 4px; } .ktrack { height: 11px; grid-column: auto; } .ktr__t { font-size: 9px; }
  .ktl__ax { grid-template-columns: 50px minmax(0, 1fr) minmax(0, 0.95fr); gap: 0 8px; } .ktl__axl { display: block; } .ktl__ticks { font-size: 9px; } .ktl__h { font-size: 9px !important; }
  figure.fig:not(.has-table), .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .kz, .kn, .kh, .hop, .krn, .krr, .ksp, .ksc, .ksn, .ktr, ol.kev li, .kpr__p, .kloop, .kas__calc { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .kpr__h, .kz__h { break-after: avoid; }
}
`;

// ================================================================ JS de la página (sin librerías; js-yaml se carga aparte)
const DATA = {
  rules: W1.revisor.map((r) => ({ id: r.id, severity: r.severity, message: r.message, why: r.why, fix: r.fix })),
  samples: SAMPLES,
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

  // ---------- revisor de YAML
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
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega uno o más manifests (separados con <code>---</code>) y toca Revisar.</p>'; return; }
    if (!window.jsyaml) {
      out.innerHTML = '<p class="small">Cargando el lector de YAML…</p>';
      loadYaml(function (ok) {
        if (ok) review();
        else out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">No pude cargar el lector de YAML</p><p>El revisor usa js-yaml, que se baja de cdnjs la primera vez. Conéctate a internet y toca Revisar otra vez: después queda guardado y funciona sin conexión.</p></div>';
      });
      return;
    }
    var docs;
    try { docs = window.jsyaml.loadAll(text); }
    catch (e) {
      var m = e && e.mark, where = m ? 'Línea ' + (m.line + 1) + ', columna ' + (m.column + 1) : '';
      out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">El YAML no es válido: no pude leerlo</p><p>' + (where ? '<b>' + where + ':</b> ' : '') + '<code>' + esc((e && e.reason) || String(e)) + '</code></p>' + (m && m.snippet ? '<pre class="rv-err__snip">' + esc(m.snippet) + '</pre>' : '') + '<p class="small">Mira la sangría (solo espacios, nunca tabs), los dos puntos después de cada clave y las comillas sin cerrar. kubectl apply rechazaría este archivo igual.</p></div>';
      return;
    }
    var objs = docs.filter(isObj);
    if (!objs.length) { out.innerHTML = '<p class="rv-sum" id="rv-sum" data-total="0" data-objs="0">No encontré ningún objeto: el texto no trae un manifest (un mapa con apiVersion, kind y metadata).</p>'; return; }
    var found = revisar(objs, IDS).filter(function (f) { return RULE[f.id]; });
    found.sort(function (a, b) { return (RANK[RULE[a.id].severity] - RANK[RULE[b.id].severity]) || (a.doc - b.doc); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[RULE[f.id].severity]++; });
    var names = objs.map(function (o) { return (o.kind || '(sin kind)') + '/' + ((o.metadata && o.metadata.name) || '(sin nombre)'); });
    var html = '<p class="rv-sum" id="rv-sum" data-total="' + found.length + '" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '" data-objs="' + objs.length + '">' +
      (found.length ? plural(found.length, 'hallazgo', 'hallazgos') + ': ' + plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + IDS.length + ' reglas encontró algo.') + '</p>' +
      '<p class="rv-objs">Revisé ' + plural(objs.length, 'objeto', 'objetos') + ': ' + esc(names.join(', ')) + '.</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var r = RULE[f.id];
      var where = '<code>' + esc(f.obj) + '</code>' + (f.container ? ' · contenedor <code>' + esc(f.container) + '</code>' : '') + (f.detail ? ' · ' + esc(f.detail) : '');
      return '<li class="sev-' + r.severity + '" data-rule="' + r.id + '"><div class="rv-h"><span class="sev ' + r.severity + '">' + NAME[r.severity] + '</span><span class="rv-msg">' + esc(r.message) + '</span></div>' +
        '<p class="rv-obj">' + where + '</p><p>' + esc(r.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(r.fix) + '</p></li>';
    }).join('') + '</ol>';
    out.innerHTML = html;
  }
  function setLabel(t, cls) { var l = $('rv-label'); l.textContent = t; l.className = 'rv-label' + (cls ? ' ' + cls : ''); }
  function load(k) { var s = D.samples[k]; $('rv-text').value = s.text; setLabel(s.label, s.cls); review(); }
  $('rv-run').addEventListener('click', review);
  $('rv-bad').addEventListener('click', function () { load('bad'); });
  $('rv-c01').addEventListener('click', function () { load('gw'); });
  $('rv-c01t').addEventListener('click', function () { load('tr'); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tus manifests', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
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
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de YAML']];
const HEAD = `<title>Cheat sheet de Kubernetes</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS}</style>`;
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Orquestación · ejemplos de C01</p>
    <h1>Cheat sheet de Kubernetes</h1>
    <p class="lead">Para escribir y leer manifests con la documentación abierta, operar con kubectl y diagnosticar un pod roto rápido. Docker construye la imagen; Kubernetes la corre, la escala y la reinicia. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y un laboratorio opcional para un cluster local. En la versión web, al final hay un diagnosticador de síntomas, un revisor de YAML y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span></p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--accent)"></i>lo que pides (spec)</span><span><i class="dot" style="background:var(--accent2)"></i>listo</span><span><i class="dot" style="background:var(--hi)"></i>esperando</span><span><i class="dot" style="background:var(--warn)"></i>falla</span><span><i class="dot" style="background:var(--pu)"></i>GPU</span><span><i class="dot" style="background:var(--ink)"></i>control plane</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>Comandos y campos para Kubernetes 1.37 (octubre de 2026), revisados contra la documentación oficial: kubernetes.io, Amazon EKS, el AWS Load Balancer Controller, KEDA, NVIDIA y Argo Rollouts. Los laboratorios no se ejecutaron al escribir esta hoja: si tu terminal dice otra cosa, créele a tu terminal. Los ejemplos salen de <code>reference/</code> del curso.</footer>
</div>`;
if (!/1\.37/.test(JSON.stringify(W1))) aviso('el pie dice Kubernetes 1.37, pero el contenido ya no lo menciona: revisa la versión');

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  writeFileSync(join(dir, 'revisor.js'), REVISOR_SRC + `\nvar REVISOR_IDS = ${JSON.stringify(W1.revisor.map((r) => r.id))};\nvar REVISOR_SAMPLES = ${jsonForScript(Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.text])))};\n`);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · diagnosticador ${W3.diagnosticador.length} síntomas · revisor ${W1.revisor.length} reglas · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  return texN;
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}

const mode = process.argv[2] || 'build';
if (mode === 'src') { writeSrc(process.argv[3] || join(HERE, 'out')); report(); }
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
  writeFileSync(join(out, 'artifact.html'), page);
  writeFileSync(join(HERE, '..', 'cheatsheet-kubernetes.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src o build)'); process.exit(2); }
