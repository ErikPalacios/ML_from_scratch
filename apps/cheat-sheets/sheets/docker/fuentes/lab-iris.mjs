// Laboratorio Iris: la copia de sus archivos y las revisiones que la mantienen honesta.
//
// Los archivos del lab viven en otro repo (Caso1, carpeta iris-lab). Para que el build de esta hoja no dependa de él,
// se copian en lab-iris/ con las mismas rutas, y lab-iris/manifest.json dice de dónde salió cada uno:
//   repo           en el repo, igual al commit del manifest (copiado byte por byte)
//   untracked      en la carpeta del repo, todavía sin commit (copiado byte por byte)
//   prompt-tested  solo en CHEATSHEET_PROMPT.md, probado en una carpeta temporal (su bloque de código, tal cual)
//   prompt-draft   solo en CHEATSHEET_PROMPT.md, borrador sin probar (su bloque de código, tal cual)
// CHEATSHEET_PROMPT.md también se copia: es la especificación de la sección y la fuente de los bloques de arriba.
//
// Uso (desde fuentes/):
//   node lab-iris.mjs check      las mismas revisiones que corre gen-docker.mjs build, con sus avisos
//   node lab-iris.mjs snapshot   vuelve a copiar todo desde iris-lab y actualiza sha256, bytes, líneas, commit y fecha
// La carpeta de iris-lab sale del manifest (source_dir) o de la variable IRIS_LAB. Si no existe en esta máquina, el
// build usa la copia sin compararla.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LAB_DIR = join(HERE, 'lab-iris');
const MAN_PATH = join(LAB_DIR, 'manifest.json');
const CONTENT_PATH = join(HERE, 'content-lab-iris.json');
export const PROMPT = 'CHEATSHEET_PROMPT.md';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const lineCount = (s) => s.replace(/\n$/, '').split('\n').length;
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en la hora local
export const loadManifest = () => JSON.parse(readFileSync(MAN_PATH, 'utf8'));
export const labDir = (man) => process.env.IRIS_LAB || man.source_dir;

// El bloque de código que sigue a la primera línea del prompt que empieza con `label`: de la línea "```<fence>" a la
// siguiente "```", con un salto de línea al final, como queda un archivo de texto.
export function promptBlock(prompt, label, fence) {
  const L = prompt.split('\n');
  const i = L.findIndex((l) => l.startsWith(label));
  const j = i < 0 ? -1 : L.findIndex((l, k) => k > i && l === '```' + fence);
  const k = j < 0 ? -1 : L.findIndex((l, m) => m > j && l === '```');
  return k < 0 ? null : L.slice(j + 1, k).join('\n') + '\n';
}

// 1 · La copia contra el manifest, contra su propio prompt y, si iris-lab está en esta máquina, contra la fuente.
export function checkSnapshot(man = loadManifest()) {
  const avisos = [];
  const iris = labDir(man);
  const live = !!iris && existsSync(iris);
  const read = (p) => readFileSync(join(LAB_DIR, p));
  const prompt = read(PROMPT).toString('utf8');
  const livePrompt = live && existsSync(join(iris, PROMPT)) ? readFileSync(join(iris, PROMPT), 'utf8') : null;
  for (const f of man.files) {
    if (!existsSync(join(LAB_DIR, f.path))) throw new Error(`lab-iris: falta la copia de ${f.path}`);
    const buf = read(f.path), text = buf.toString('utf8');
    if (sha(buf) !== f.sha256) avisos.push(`${f.path}: la copia no coincide con el sha256 del manifest (¿se editó a mano?)`);
    if (f.origin.startsWith('prompt')) {
      const b = promptBlock(prompt, f.label, f.fence);
      if (b === null) avisos.push(`${f.path}: no encuentro su bloque en la copia del prompt («${f.label}»)`);
      else if (b !== text) avisos.push(`${f.path}: no es igual a su bloque en la copia del prompt`);
      if (live) {
        const bl = livePrompt === null ? null : promptBlock(livePrompt, f.label, f.fence);
        if (bl === null) avisos.push(`${f.path}: ya no encuentro su bloque en iris-lab/${PROMPT} («${f.label}»)`);
        else if (bl !== text) avisos.push(`${f.path}: su bloque cambió en iris-lab/${PROMPT} (la copia es del ${man.date})`);
      }
    } else if (live) {
      const src = join(iris, f.path);
      if (!existsSync(src)) avisos.push(`${f.path}: ya no existe en iris-lab`);
      else if (!readFileSync(src).equals(buf)) avisos.push(`${f.path}: cambió en iris-lab (la copia es del ${man.date})`);
    }
    // un archivo del repo que el prompt también trae: los dos tienen que decir lo mismo (sin contar el salto final)
    if (f.also_prompt) {
      const b = promptBlock(prompt, f.also_prompt.label, f.also_prompt.fence);
      if (b === null || b !== text.replace(/\n?$/, '\n')) avisos.push(`${f.path}: el repo y el prompt ya no dicen lo mismo`);
    }
  }
  return { avisos, live, iris };
}

// 2 · El contenido de la sección contra la copia: comandos, fragmentos y salidas tal cual del prompt, y los números
// que el texto repite (paquetes fijados y versiones) iguales a los de los requirements.txt copiados.
const stripTags = (s) => String(s).replace(/<\/?(b|code)>/g, '');
const codeSpans = (s) => [...String(s).matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => m[1]);
export function checkContent(lab, man = loadManifest()) {
  const avisos = [];
  const prompt = readFileSync(join(LAB_DIR, PROMPT), 'utf8');
  const has = (s) => prompt.includes(s);
  const shown = new Map(); // archivo → pasos donde aparece
  const walk = (x, at) => {
    if (Array.isArray(x)) return x.forEach((y) => walk(y, at));
    if (!x || typeof x !== 'object') return;
    if (typeof x.cmd === 'string') {
      if (!has(x.cmd)) avisos.push(`${at}: el comando no está tal cual en el prompt: ${x.cmd}`);
      if (x.out !== undefined && !has(stripTags(x.out))) avisos.push(`${at}: la salida no está tal cual en el prompt: ${x.out}`);
    }
    if (x.type === 'fragment' && !has(x.code)) avisos.push(`${at}: el fragmento no está tal cual en el prompt: ${x.code.split('\n')[0]}…`);
    if (x.type === 'out') for (const it of x.items) for (const c of codeSpans(it)) if (!has(c)) avisos.push(`${at}: salida esperada que no está en el prompt: ${c}`);
    if (typeof x.got === 'string') for (const c of codeSpans(x.got)) if (!has(c)) avisos.push(`${at}: resultado que no está en el prompt: ${c}`);
    if (x.type === 'files') for (const it of x.items) shown.set(it.path, [...(shown.get(it.path) || []), at]);
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, at);
  };
  walk(lab.intro, 'paso 0');
  lab.steps.forEach((s) => walk(s, `paso ${s.n}`));
  const known = new Set(man.files.map((f) => f.path));
  for (const [p, at] of shown) {
    if (!known.has(p)) throw new Error(`lab-iris: ${at.join(', ')} muestra ${p}, que no está en el manifest`);
    if (at.length > 1) avisos.push(`${p} aparece en más de un paso (${at.join(', ')}): muéstralo en uno solo`);
  }
  for (const f of man.files) if (f.path !== PROMPT && !shown.has(f.path)) avisos.push(`${f.path} está en la copia pero ningún paso lo muestra`);
  for (const [p, nPins] of Object.entries(lab.checks.pins)) {
    const got = (readFileSync(join(LAB_DIR, p), 'utf8').match(/^[A-Za-z0-9._-]+==/gm) || []).length;
    if (got !== nPins) avisos.push(`${p}: el texto dice ${nPins} paquetes y la copia fija ${got}`);
  }
  const reqs = Object.keys(lab.checks.pins).map((p) => readFileSync(join(LAB_DIR, p), 'utf8')).join('\n');
  for (const [pkg, ver] of lab.checks.versions) if (!new RegExp(`^${pkg.replace(/[.-]/g, '\\$&')}==${ver.replace(/\./g, '\\.')}\\b`, 'm').test(reqs)) avisos.push(`el texto dice ${pkg} ${ver} y los requirements.txt copiados no`);
  return { avisos, shown };
}

// node lab-iris.mjs snapshot: copia de nuevo desde iris-lab (los archivos del repo byte por byte; los del prompt, su
// bloque) y actualiza el manifest. Los orígenes, las etiquetas y las notas del manifest se editan a mano.
function snapshot() {
  const man = loadManifest();
  const iris = labDir(man);
  if (!existsSync(iris)) throw new Error('no encuentro iris-lab en ' + iris + ' (usa IRIS_LAB=<carpeta>)');
  const git = (...a) => execFileSync('git', ['-C', iris, ...a]);
  const tracked = new Set(git('ls-files').toString('utf8').split('\n'));
  const prompt = readFileSync(join(iris, PROMPT), 'utf8');
  for (const f of man.files) {
    let buf;
    if (f.origin.startsWith('prompt')) {
      const b = promptBlock(prompt, f.label, f.fence);
      if (b === null) throw new Error(`${f.path}: no encuentro su bloque en el prompt («${f.label}», \`\`\`${f.fence})`);
      buf = Buffer.from(b, 'utf8');
    } else {
      buf = readFileSync(join(iris, f.path));
      if (f.origin === 'repo' && !tracked.has(f.path)) throw new Error(`${f.path}: el manifest dice "repo" pero no tiene commit`);
      if (f.origin === 'untracked' && tracked.has(f.path)) console.log(`nota: ${f.path} ya tiene commit; cambia su origen a "repo" en el manifest`);
      if (f.origin === 'repo' && !git('show', 'HEAD:./' + f.path).equals(buf)) console.log(`nota: ${f.path} tiene cambios sin commit`);
    }
    mkdirSync(dirname(join(LAB_DIR, f.path)), { recursive: true });
    writeFileSync(join(LAB_DIR, f.path), buf);
    Object.assign(f, { sha256: sha(buf), bytes: buf.length, lines: lineCount(buf.toString('utf8')) });
  }
  man.commit = git('rev-parse', '--short', 'HEAD').toString('utf8').trim();
  man.branch = git('rev-parse', '--abbrev-ref', 'HEAD').toString('utf8').trim();
  man.date = today();
  writeFileSync(MAN_PATH, JSON.stringify(man, null, 2) + '\n');
  console.log(`copia: ${man.files.length} archivos de ${iris} · ${man.branch} @ ${man.commit} · ${man.date}`);
}

export function report(lab) {
  const man = loadManifest();
  const s = checkSnapshot(man), c = checkContent(lab, man);
  const avisos = [...s.avisos, ...c.avisos];
  avisos.forEach((a) => console.log('aviso: lab-iris: ' + a));
  if (s.avisos.length) console.log('  → si cambiaste el lab a propósito: node lab-iris.mjs snapshot y revisa content-lab-iris.json');
  console.log(`lab-iris: ${man.files.length} archivos copiados (${man.date}, ${man.commit}) · ${s.live ? 'comparados con ' + s.iris : 'iris-lab no está en esta máquina: uso la copia sin comparar'} · ${avisos.length} avisos`);
  return avisos;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2] || 'check';
  if (mode === 'snapshot') snapshot();
  else if (mode !== 'check') { console.error('uso: node lab-iris.mjs check | snapshot'); process.exit(2); }
  const lab = existsSync(CONTENT_PATH) ? JSON.parse(readFileSync(CONTENT_PATH, 'utf8')) : null;
  if (lab) process.exit(report(lab).length ? 1 : 0);
  const s = checkSnapshot();
  s.avisos.forEach((a) => console.log('aviso: lab-iris: ' + a));
  process.exit(s.avisos.length ? 1 : 0);
}
