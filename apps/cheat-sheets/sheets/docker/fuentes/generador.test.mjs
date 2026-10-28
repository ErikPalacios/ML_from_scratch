// Tests del generador de Dockerfile: node --test generador.test.mjs (desde fuentes/)
//   - cada preset genera; el del C01 coincide instrucción por instrucción con reference/c01/gateway/Dockerfile
//     y el de Triton con reference/c01/triton/Dockerfile;
//   - TODAS las combinaciones recomendadas (enumeradas, no muestreadas) pasan las 16 reglas del revisor con 0 hallazgos,
//     sin contar las reglas que no aplican a ese servicio (NOT_APPLICABLE: HEALTHCHECK y EXPOSE en un worker o un
//     entrenamiento), y nunca llevan una instrucción que solo sirva para callar al revisor;
//   - las opciones que el revisor marca a propósito (root; sin HEALTHCHECK en una API) dan exactamente su hallazgo;
//   - cada salida es sintácticamente sana; el .dockerignore nunca deja fuera lo que el Dockerfile copia;
//   - la fuente que lleva la página (toPageScript) da exactamente lo mismo que el módulo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './generador.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = join(HERE, '../../../../ml-system-design/reference/c01');
const W1 = JSON.parse(readFileSync(join(HERE, 'content-w1.json'), 'utf8'));
const RULES = G.compileRules(W1.revisor);
const LEVELS = ['none', 'brief', 'detailed'];

// ---------------------------------------------------------------- utilidades
// Instrucciones lógicas: sin comentarios ni líneas en blanco, con las continuaciones unidas y los espacios colapsados.
function instructions(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (cur === null && (/^\s*#/.test(line) || !line.trim())) continue;
    if (cur !== null && /^\s*#/.test(line)) continue;
    const cont = /\\$/.test(line);
    const piece = (cont ? line.slice(0, -1) : line).trim();
    cur = cur === null ? piece : cur + ' ' + piece;
    if (!cont) { out.push(cur.replace(/\s+/g, ' ')); cur = null; }
  }
  if (cur !== null) out.push(cur.replace(/\s+/g, ' '));
  return out;
}
const KNOWN = new Set(['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL']);

// Revisión de sintaxis: devuelve una lista de problemas (vacía = sano).
function sanity(df) {
  const bad = [];
  const lines = df.split('\n');
  if (lines[0] !== '# syntax=docker/dockerfile:1') bad.push('la línea 1 no es la directiva syntax');
  if (!df.endsWith('\n') || df.endsWith('\n\n')) bad.push('el archivo no termina en un solo salto de línea');
  // continuaciones: cada \ final sigue en una línea con texto que no es comentario
  lines.forEach((l, i) => {
    if (/\\\s*$/.test(l) && !/^\s*#/.test(l)) {
      const nx = lines[i + 1];
      if (nx === undefined || !nx.trim() || /^\s*#/.test(nx)) bad.push(`continuación abierta en la línea ${i + 1}`);
    }
    if (/[ \t]$/.test(l)) bad.push(`espacio al final de la línea ${i + 1}`);
  });
  // comentario después de una instrucción (un # precedido de espacio fuera de comillas)
  let inInstr = false;
  lines.forEach((l, i) => {
    if (/^\s*#/.test(l) && !inInstr) return;
    if (!l.trim()) { inInstr = false; return; }
    let q = null;
    for (let j = 0; j < l.length; j++) {
      const ch = l[j];
      if (q) { if (ch === '\\') j++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '#' && j > 0 && /\s/.test(l[j - 1])) { bad.push(`comentario al final de la línea ${i + 1}`); break; }
    }
    inInstr = /\\\s*$/.test(l);
  });
  const ins = instructions(df);
  const stages = [];
  let healthInStage = 0;
  for (const s of ins) {
    const kw = s.split(' ')[0];
    if (!KNOWN.has(kw)) { bad.push(`instrucción desconocida: ${kw}`); continue; }
    if (kw !== kw.toUpperCase()) bad.push(`instrucción en minúsculas: ${kw}`);
    const rest = s.slice(kw.length + 1);
    if (kw === 'FROM') {
      const m = rest.match(/^(\S+)(?: AS ([a-z][a-z0-9_.-]*))?$/);
      if (!m) { bad.push(`FROM raro: ${s}`); continue; }
      const img = m[1];
      if (!/:[^/@]+(@|$)/.test(img.split('/').pop())) bad.push(`FROM sin tag: ${img}`);
      if (/:latest\b/.test(img)) bad.push(`FROM con latest: ${img}`);
      if (m[2]) { if (stages.includes(m[2])) bad.push(`etapa repetida: ${m[2]}`); stages.push(m[2]); }
      healthInStage = 0;
    }
    if (kw === 'HEALTHCHECK' && ++healthInStage > 1) bad.push('dos HEALTHCHECK en la misma etapa');
    // forma exec: JSON válido, todo strings, comillas dobles
    let execArr = null;
    if (kw === 'CMD' || kw === 'ENTRYPOINT') execArr = rest;
    if (kw === 'HEALTHCHECK' && rest !== 'NONE') { const m = rest.match(/ CMD (.*)$/); if (!m) bad.push(`HEALTHCHECK sin CMD: ${s}`); else execArr = m[1]; }
    if (kw === 'RUN' && /^\[/.test(rest)) execArr = rest;
    if (execArr !== null) {
      if (!/^\[/.test(execArr)) bad.push(`${kw} en forma shell: ${s}`);
      else { try { const a = JSON.parse(execArr); if (!Array.isArray(a) || !a.length || a.some((x) => typeof x !== 'string')) bad.push(`${kw}: el arreglo no es de strings: ${execArr}`); } catch (e) { bad.push(`${kw}: JSON inválido: ${execArr}`); } }
    }
    // COPY --from / RUN --mount=from: una etapa anterior o una imagen
    for (const m of rest.matchAll(/--(?:mount=)?from=([^\s,]+)/g)) {
      const src = m[1];
      if (/[/:]/.test(src)) { if (!/:[^/]+$/.test(src.split('@')[0].split('/').pop())) bad.push(`imagen sin tag en --from: ${src}`); }
      else if (!stages.includes(src)) bad.push(`--from=${src} no es una etapa anterior`);
    }
    if (kw === 'USER' && !/^(\d+|root)$/.test(rest)) bad.push(`USER no numérico: ${rest}`);
    if (kw === 'EXPOSE' && !rest.split(' ').every((p) => /^\d+$/.test(p) && +p > 0 && +p < 65536)) bad.push(`EXPOSE raro: ${rest}`);
    if (kw === 'ENV') {
      const pairs = rest.match(/[A-Za-z_][A-Za-z0-9_]*=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)/g) || [];
      if (pairs.join(' ') !== rest) bad.push(`ENV raro: ${rest}`);
    }
    if (kw === 'ADD') bad.push('ADD: el generador siempre usa COPY');
  }
  if (!ins.length || !ins[ins.length - 1].startsWith('CMD') && !ins[ins.length - 1].startsWith('ENTRYPOINT')) bad.push('no termina en CMD o ENTRYPOINT');
  return bad;
}
// el revisor genérico (el de la hoja) y el del generador, que sabe qué servicio es
const findings = (df) => G.lint(df, RULES).found.map((f) => f.r.id);
const findingsFor = (cfg, df) => G.lintFor(G.normalize(cfg).cfg, df, RULES).found.map((f) => f.r.id);
const NA_IDS = (svc) => Object.keys(G.NOT_APPLICABLE[svc] || {}).sort();

// ---------------------------------------------------------------- enumeración del espacio recomendado
// G.space(): cada pregunta de opciones en el orden de la interfaz, solo las opciones que se ven y aplican; sin las que
// el revisor marca a propósito (optionFlag), salvo space(true). Una pregunta escondida conserva su valor.
const SEGS = G.SCHEMA.flatMap((g) => g.qs).filter((q) => q.type === 'seg' && q.k !== 'comments');
const enumerate = (flagged) => G.space(!!flagged);
// Variaciones de los campos de texto y de las casillas, en rotación (cada combinación lleva una).
const VARIANTS = [
  {},
  { workers: '4', flags: ['keepalive', 'noaccess', 'graceful'], uid: '20001', image: 'org/equipo-x', envx: 'LOG_LEVEL=info\nAPP_NAME="mi app #1"' },
  { flags: [], env: [], code: 'src/ config/ settings.py', app: '', port: '9000', hpath: '/livez', aptList: 'libpq5 curl' },
  { modelPath: 'weights/v3/model.onnx', s3: 's3://modelos-prod/repo', source: 'https://gitlab.com/equipo/servicio' },
];

const ALL = G.space();

// ---------------------------------------------------------------- tests
test('cada preset genera un Dockerfile, un .dockerignore y comandos, sanos y sin hallazgos', () => {
  for (const p of G.PRESETS) {
    for (const level of LEVELS) {
      const o = G.generate({ ...p.cfg, comments: level });
      assert.ok(o.dockerfile.length > 100 && o.dockerignore.length > 20 && o.commands.length > 50, p.id);
      assert.deepEqual(sanity(o.dockerfile), [], `${p.id} (${level})`);
      assert.deepEqual(findingsFor(p.cfg, o.dockerfile), [], `${p.id} (${level}): hallazgos del revisor`);
      assert.deepEqual(o.meta.errs, {}, `${p.id}: errores de entrada`);
    }
  }
});

test('el preset C01 · gateway da las mismas instrucciones que reference/c01/gateway/Dockerfile', () => {
  const ref = instructions(readFileSync(join(REF, 'gateway/Dockerfile'), 'utf8'));
  for (const level of LEVELS) {
    const got = instructions(G.generate({ ...G.PRESETS.find((p) => p.id === 'c01-gateway').cfg, comments: level }).dockerfile);
    assert.deepEqual(got, ref, `nivel ${level}`);
  }
});

test('con comentarios detallados, el preset C01 · gateway es casi el archivo del C01 (≥ 90 % de las líneas iguales)', () => {
  const ref = readFileSync(join(REF, 'gateway/Dockerfile'), 'utf8').split('\n');
  const got = G.generate({ ...G.PRESETS.find((p) => p.id === 'c01-gateway').cfg, comments: 'detailed' }).dockerfile.split('\n');
  const same = G.diffLines(ref.join('\n'), got.join('\n')).filter((ch) => !ch).length;
  assert.ok(same / ref.length >= 0.9, `solo ${same} de ${ref.length} líneas iguales`);
});

test('el preset C01 · Triton da las mismas instrucciones que reference/c01/triton/Dockerfile', () => {
  const ref = instructions(readFileSync(join(REF, 'triton/Dockerfile'), 'utf8'));
  for (const level of LEVELS) {
    const got = instructions(G.generate({ ...G.PRESETS.find((p) => p.id === 'c01-triton').cfg, comments: level }).dockerfile);
    assert.deepEqual(got, ref, `nivel ${level}`);
  }
});

// Una sola pasada por todo el espacio recomendado: cada combinación se genera una vez y se revisa entera.
test(`espacio recomendado: las ${ALL.length} combinaciones pasan las 16 reglas con 0 hallazgos (sin contar las que no aplican al servicio), son sanas y coherentes`, () => {
  assert.equal(RULES.filter((r) => !r.re).length, 0, 'alguna regla no compila en node');
  assert.equal(RULES.length, 16);
  assert.ok(ALL.length > 1000, `muy pocas combinaciones: ${ALL.length}`);
  const fails = {};
  const fail = (kind, cfg, msg) => { (fails[kind] = fails[kind] || []).push(`${G.encodeState(cfg)} → ${msg}`); };
  ALL.forEach((c, n) => {
    const cfg = { ...c, ...VARIANTS[n % VARIANTS.length], comments: LEVELS[n % 3] };
    const o = G.generate(cfg), x = G.derive(cfg), df = o.dockerfile, cmd = o.commands;
    // 1 · el revisor del generador: 0 hallazgos; las reglas que no aplican, solo en un worker o un entrenamiento
    const lf = G.lintFor(x.cfg, df, RULES), f = lf.found.map((r) => r.r.id);
    if (f.length) fail('revisor', cfg, f.join(', '));
    if (JSON.stringify(lf.na.map((n) => n.id).sort()) !== JSON.stringify(NA_IDS(x.svc))) fail('no aplica', cfg, lf.na.map((n) => n.id).join(', '));
    // 1b · nada escrito solo para callar al revisor: HEALTHCHECK NONE solo si se eligió (o si la base define uno que no
    // aplica) y EXPOSE solo con un puerto de verdad (métricas del worker, rank 0 con varios nodos)
    if (x.svc === 'worker' || x.svc === 'train') {
      const none = /^HEALTHCHECK NONE$/m.test(df), expose = /^EXPOSE /m.test(df);
      if (none !== (x.cfg.health === 'none' || x.healthInherited)) fail('instrucción de más', cfg, 'HEALTHCHECK NONE');
      if (expose !== (x.svc === 'worker' ? x.cfg.metrics === 'yes' : x.cfg.nodes === 'multi')) fail('instrucción de más', cfg, 'EXPOSE');
      if (/^HEALTHCHECK --/m.test(df)) fail('instrucción de más', cfg, 'HEALTHCHECK HTTP en un servicio sin HTTP');
    }
    // 2 · sintaxis
    const s = sanity(df);
    if (s.length) fail('sintaxis', cfg, s.join('; '));
    // 3 · los comentarios nunca cambian una instrucción (cada 7.ª combinación, en los otros dos niveles)
    if (n % 7 === 0) {
      const ref = instructions(df);
      for (const level of LEVELS.filter((l) => l !== cfg.comments)) if (JSON.stringify(instructions(G.generate({ ...cfg, comments: level }).dockerfile)) !== JSON.stringify(ref)) fail('comentarios', cfg, level);
    }
    // 4 · .dockerignore: nunca deja fuera lo que se copia; siempre deja fuera .git, .env, .venv y tests
    const pats = o.dockerignore.split('\n').filter((l) => l && !l.startsWith('#'));
    const inputs = G.contextInputs(x);
    for (const fl of inputs) if (G.ignored(pats, fl)) fail('dockerignore', cfg, `deja fuera ${fl}`);
    // secretos en cualquier carpeta (F8): COPY app/ ./app/ no puede llevarse app/.env ni un certificado
    for (const fl of ['.git/HEAD', '.env', '.venv/bin/python', 'tests/test_api.py', 'app/.env', 'src/config/.env.local', 'app/certs/tls.pem', 'worker/keys/id.key']) if (!G.ignored(pats, fl)) fail('dockerignore', cfg, `no deja fuera ${fl}`);
    for (const ins of instructions(df).filter((i) => /^COPY (?!--from)/.test(i))) for (const src of ins.split(' ').slice(1, -1)) if (!inputs.some((fl) => fl === src.replace(/\/$/, '') || fl.startsWith(src))) fail('dockerignore', cfg, `${src} no está en contextInputs`);
    // 5 · Build & run
    if (!/docker buildx build --platform linux\/amd64 \\/.test(cmd)) fail('comandos', cfg, 'sin --platform linux/amd64');
    if (/--gpus all/.test(cmd) !== x.gpu) fail('comandos', cfg, '--gpus');
    if (/--init\b/.test(cmd.replace(/^#.*$/gm, '')) !== (x.init === 'docker')) fail('comandos', cfg, '--init');
    if (/--secret id=hf_token,env=HF_TOKEN/.test(cmd) !== (x.weights === 'build')) fail('comandos', cfg, '--secret');
    // credenciales de S3 al arrancar (F2): por nombre, sin valor, y solo cuando hacen falta
    const aws = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_DEFAULT_REGION'];
    if (aws.every((k) => new RegExp(`-e ${k} \\\\$`, 'm').test(cmd)) !== (x.weights === 'startup')) fail('comandos', cfg, 'credenciales de S3');
    if (/AWS_[A-Z_]+=/.test(cmd)) fail('comandos', cfg, 'un valor de AWS escrito en el comando');
    // lock con hashes (F9) y torch para CPU (F6)
    if (/uv pip compile requirements\.in --generate-hashes --python-version (\S+) --python-platform linux/.test(cmd) !== x.hashes) fail('comandos', cfg, 'lock con hashes');
    if (x.hashes && !cmd.includes(`--python-version ${x.py} `)) fail('comandos', cfg, 'lock con otra versión de Python');
    if (/download\.pytorch\.org\/whl\/cpu|pytorch-cpu/.test(cmd) !== x.cpuTorch) fail('comandos', cfg, 'torch para CPU');
    if (cfg.comments !== 'none' && x.cpuTorch && x.svc === 'train' && !/whl\/cpu/.test(df)) fail('cpu torch', cfg, 'falta el índice whl/cpu');
    if (/download\.pytorch\.org\/whl\/cpu|whl\/cpu/.test(df) && !x.cpuTorch) fail('cpu torch', cfg, 'índice de CPU en una imagen con GPU o sin torch');
    // el driver según la base (F1): el aviso de GeForce solo con la base de CUDA, que exige CUDA ≥ 13.4
    if (/NVIDIA_DISABLE_REQUIRE=1/.test(cmd) !== (x.gpu && x.base === 'cuda')) fail('driver', cfg, 'aviso de GeForce');
    if (/pide la rama R580/.test(df)) fail('driver', cfg, 'el texto viejo del driver');
    // HOME propio en imágenes de ML (F10), cache de HF en los pesos del build (F11), los usuarios de distroless y Triton (F12, F17)
    if (/useradd /.test(df) && /--create-home/.test(df) !== x.home) fail('usuario', cfg, '--create-home');
    if (x.weights === 'build' && !/--mount=type=cache,target=\/root\/\.cache\/huggingface/.test(df)) fail('pesos', cfg, 'cache de HF');
    if (x.base === 'distroless' && x.user === 'uid' && !String(cfg.uid || '').trim() && !/^USER 65532$/m.test(df)) fail('usuario', cfg, 'distroless sin su nonroot');
    if (x.triton && x.user === 'uid' && (!/^USER 1000$/m.test(df) || /useradd/.test(df))) fail('usuario', cfg, 'Triton sin triton-server');
    cmd.split('\n').forEach((l, i, a) => { if (/\\$/.test(l) && !(a[i + 1] && a[i + 1].trim())) fail('comandos', cfg, 'continuación abierta'); });
    // 6 · secretos del build: solo como --mount=type=secret
    if (x.weights === 'build' && !/--mount=type=secret,id=hf_token,env=HF_TOKEN,required=true/.test(df)) fail('secretos', cfg, 'sin --mount=type=secret');
    if (/^\s*(ARG|ENV)\b[^\n]*(TOKEN|SECRET|PASSWORD)/im.test(df)) fail('secretos', cfg, 'ARG o ENV con un secreto');
    // 7 · marcador de digest solo si se pidió digest
    if (cfg.pin !== 'digest' && df.includes('<digest>')) fail('digest', cfg, 'marcador sin pedir digest');
    if (cfg.pin === 'digest' && x.images.some((img) => !df.includes(img + '@sha256:'))) fail('digest', cfg, 'una imagen sin @sha256');
  });
  const kinds = Object.keys(fails);
  assert.equal(kinds.length, 0, kinds.map((k) => `${k}: ${fails[k].length} casos, p. ej. ${fails[k].slice(0, 3).join(' | ')}`).join('\n'));
});

test('las opciones que el revisor marca a propósito dan exactamente su hallazgo; lo que no aplica al servicio, no', () => {
  // [config, hallazgos del generador, hallazgos del revisor genérico de la hoja]
  const cases = [
    [{ user: 'root' }, ['sin-user'], ['sin-user']],
    [{ health: 'omit' }, ['sin-healthcheck'], ['sin-healthcheck']],
    [{ svc: 'worker' }, [], ['sin-expose', 'sin-healthcheck']],
    [{ svc: 'worker', metrics: 'yes' }, [], ['sin-healthcheck']],
    [{ svc: 'worker', health: 'none' }, [], ['sin-expose']],
    [{ svc: 'train', hw: 'gpu', base: 'pytorch' }, [], ['sin-expose', 'sin-healthcheck']],
    [{ svc: 'train', hw: 'gpu', base: 'pytorch', nodes: 'multi', user: 'root' }, ['sin-user'], ['sin-healthcheck', 'sin-user']],
    [{ svc: 'worker', hw: 'gpu', base: 'ngc', health: 'omit' }, [], ['sin-expose']], // NGC: el revisor genérico no pide HEALTHCHECK
    [{ hw: 'gpu', base: 'ngc', health: 'omit' }, [], []],
    [{ svc: 'triton', health: 'omit', user: 'root' }, ['sin-user'], ['sin-user']],
    [{ base: 'distroless', user: 'root' }, ['sin-user'], ['sin-user']],
    [{ envx: 'HF_TOKEN=abc' }, ['secreto-en-env-arg'], ['secreto-en-env-arg']],
  ];
  for (const [cfg, want, generic] of cases) for (const level of LEVELS) {
    const df = G.generate({ ...cfg, comments: level }).dockerfile;
    assert.deepEqual(findingsFor(cfg, df).sort(), want.sort(), `${JSON.stringify(cfg)} (${level})`);
    assert.deepEqual(findings(df).sort(), generic.sort(), `${JSON.stringify(cfg)} (${level}), revisor genérico`);
  }
  // y en todo el espacio con antipatrones: solo aparecen esos hallazgos
  const anti = G.space(true);
  const allowed = new Set(['sin-user', 'sin-healthcheck']);
  let flagged = 0;
  anti.filter((_, n) => n % 11 === 0).forEach((c) => {
    const f = findingsFor(c, G.generate(c).dockerfile);
    if (f.length) flagged++;
    assert.ok(f.every((id) => allowed.has(id)), `${G.encodeState(c)}: ${f}`);
    const want = SEGS.filter((q) => G.isShown(c, q.k)).map((q) => G.optionFlag(c, q.k, c[q.k])).filter(Boolean);
    assert.deepEqual([...new Set(f)].sort(), [...new Set(want)].sort(), `${G.encodeState(c)}: ${f} contra ${want}`);
  });
  assert.ok(flagged > 0);
});

test('normalize: nunca deja una opción que no aplica, es idempotente y cada pregunta cae a una opción válida', () => {
  const sample = G.space(true).filter((_, n) => n % 11 === 0);
  // entradas desordenadas: cada combinación con el servicio y el hardware cambiados encima
  for (const c of sample) for (const over of [{ svc: 'triton' }, { hw: 'gpu' }, { hw: 'cpu', base: 'ngc' }, { base: 'distroless', pm: 'uv', apt: 'ffmpeg', init: 'tini', weights: 'startup' }]) {
    const { cfg } = G.normalize({ ...c, ...over });
    for (const q of SEGS) if (G.isShown(cfg, q.k)) assert.equal(G.optionReason(cfg, q.k, cfg[q.k]), '', `${q.k}=${cfg[q.k]} quedó elegida sin aplicar (${JSON.stringify(over)})`);
    assert.deepEqual(G.normalize(cfg).cfg, cfg, 'normalize no es idempotente');
  }
  // basura en la entrada
  const { cfg, errs } = G.normalize({ svc: 'nada', hw: 7, port: '99999', uid: '0', image: 'Mi Imagen', envx: 'malo\nOK=1\nPATH=/x', code: '../x . app/', aptList: 'libpq5 rm;-rf', digests: { 'python:3.13-slim': 'sha256:xyz' } });
  assert.equal(cfg.svc, 'api');
  assert.equal(cfg.hw, 'cpu');
  for (const k of ['port', 'uid', 'image', 'envx', 'code', 'aptList', 'digests']) assert.ok(errs[k], `falta el error de ${k}`);
});

test('los textos de la interfaz entran al Dockerfile bien escritos (ENV con comillas, COPY de archivos y carpetas)', () => {
  const o = G.generate({ envx: 'APP_NAME=mi app #1\nURL=https://x.y/z?a=1', code: 'src/ settings.py main.py', apt: 'custom', aptList: 'libpq5 curl=8.14.1-2' });
  assert.match(o.dockerfile, /^ENV APP_NAME="mi app #1" \\\n {4}URL=https:\/\/x\.y\/z\?a=1$/m);
  assert.match(o.dockerfile, /^COPY src\/ \.\/src\/$/m);
  assert.match(o.dockerfile, /^COPY settings\.py main\.py \.\/$/m);
  assert.match(o.dockerfile, /--no-install-recommends libpq5 curl=8\.14\.1-2 &&/);
  assert.deepEqual(sanity(o.dockerfile), []);
  assert.deepEqual(findings(o.dockerfile), []);
});

test('digest: cada imagen lleva @sha256 (el pegado o un marcador visible) y los comandos dicen cómo leerlo', () => {
  const d64 = 'sha256:' + 'ab'.repeat(32);
  const o1 = G.generate({ pin: 'digest' });
  assert.deepEqual(o1.meta.digestsMissing, ['python:3.13.18-slim-trixie']);
  assert.match(o1.dockerfile, /^FROM python:3\.13\.18-slim-trixie@sha256:<digest> AS builder$/m);
  assert.match(o1.commands, /docker buildx imagetools inspect python:3\.13\.18-slim-trixie/);
  const o2 = G.generate({ pin: 'digest', digests: { 'python:3.13.18-slim-trixie': d64 } });
  assert.deepEqual(o2.meta.digestsMissing, []);
  assert.ok(!o2.dockerfile.includes('<digest>'));
  assert.equal((o2.dockerfile.match(new RegExp('@' + d64, 'g')) || []).length, 2);
});




test('.dockerignore: las reglas de coincidencia que usamos se comportan como las de Docker', () => {
  assert.equal(G.ignored(['**/*.pt', '!model/**'], 'model/model.pt'), false);
  assert.equal(G.ignored(['**/*.pt', '!model/**'], 'scripts/old.pt'), true);
  assert.equal(G.ignored(['**/__pycache__/'], 'app/x/__pycache__/m.pyc'), true);
  assert.equal(G.ignored(['tests/'], 'app/tests/x.py'), false);
  assert.equal(G.ignored(['.env.*'], '.env.local'), true);
  assert.equal(G.ignored(['*.key'], 'app/keys/x.key'), false);
  assert.equal(G.ignored(['**/*.key'], 'app/keys/x.key'), true);
  assert.equal(G.ignored(['**/.env'], 'app/.env'), true);
  assert.equal(G.ignored(['**/.env.*'], '.env.local'), true);
});

test('fact-check: el driver según la base, GPU con python slim y los textos corregidos', () => {
  const det = (c) => G.generate({ ...c, comments: 'detailed' }).dockerfile;
  assert.match(det({ hw: 'gpu', base: 'cuda' }), /exige CUDA ≥ 13\.4 \(NVIDIA_REQUIRE_CUDA\): en GeForce, driver R615\+/);
  assert.match(det({ hw: 'gpu', base: 'cuda' }), /R535, R570, R580, R590, R595 o R610/);
  assert.match(det({ hw: 'gpu', base: 'pytorch' }), /corren con R580\+ \(compatibilidad de versión menor\)/);
  assert.match(det({ hw: 'gpu', base: 'ngc' }), /guía de compatibilidad de CUDA/);
  // D2: python slim con GPU (el CUDA viene en los wheels de torch); distroless sigue siendo solo CPU
  assert.equal(G.optionReason({ ...G.DEFAULTS, hw: 'gpu' }, 'base', 'slim'), '');
  assert.ok(G.optionReason({ ...G.DEFAULTS, hw: 'gpu' }, 'base', 'distroless'));
  const slimGpu = G.generate({ hw: 'gpu', base: 'slim', comments: 'detailed' });
  assert.match(slimGpu.dockerfile, /el torch de PyPI trae su CUDA 13\.2 en wheels/);
  assert.match(slimGpu.commands, /--gpus all/);
  assert.match(slimGpu.commands, /driver R580\+/);
  // F3, F13, F17, F18
  for (const c of [{ base: 'distroless', comments: 'detailed' }, { comments: 'detailed' }]) assert.ok(!/sin apt ni pip|pip, compiladores/.test(G.generate(c).dockerfile));
  assert.match(det({ base: 'distroless' }), /ENTRYPOINT \["\/usr\/bin\/python3\.13"\]/);
  assert.match(det({ svc: 'triton', user: 'k8s' }), /runAsUser: 1000 \(triton-server/);
  assert.doesNotMatch(det({ hw: 'gpu', base: 'cuda' }), /onnxruntime-gpu, TensorRT/);
  // F7: la base de PyTorch nombra el torch que trae y los pines de CUDA de PyPI
  assert.match(det({ hw: 'gpu', base: 'pytorch' }), /2\.15\.0\+cu134/);
  assert.match(G.generate({ hw: 'gpu', base: 'pytorch' }).dockerfile, /sin torch ni nvidia-\*\/cuda-toolkit\/triton/);
  // F12: el UID de la interfaz sugiere el nonroot de distroless
  assert.equal(G.QMAP.uid.ph({ ...G.DEFAULTS, base: 'distroless' }), '65532');
  assert.equal(G.QMAP.uid.ph({ ...G.DEFAULTS }), '10001');
});

test('estado en la URL: decode(encode(cfg)) vuelve a la misma configuración', () => {
  ALL.filter((_, n) => n % 13 === 0).forEach((c, n) => {
    const cfg = G.normalize({ ...c, ...VARIANTS[n % VARIANTS.length], digests: n % 2 ? { 'python:3.13.18-slim-trixie': 'sha256:' + 'cd'.repeat(32) } : {} }).cfg;
    const back = G.normalize(G.decodeState(G.encodeState(cfg))).cfg;
    assert.deepEqual(back, cfg, G.encodeState(cfg));
  });
  assert.equal(G.encodeState(G.normalize({}).cfg), '', 'la configuración por defecto no lleva nada en la URL');
  assert.deepEqual(G.decodeState('svc=worker&nada=1&flags=&dg=python%3A3.13-slim%7Csha256%3Aab'), { svc: 'worker', flags: [], digests: { 'python:3.13-slim': 'sha256:ab' } });
});

test('diffLines marca exactamente las líneas nuevas o cambiadas', () => {
  assert.deepEqual(G.diffLines('a\nb\nc', 'a\nx\nc\nd'), [false, true, false, true]);
  assert.deepEqual(G.diffLines('', 'a'), [true]);
  assert.deepEqual(G.diffLines('a\nb', 'a\nb'), [false, false]);
});

test('la fuente de la página (toPageScript) da exactamente lo mismo que el módulo', () => {
  const src = readFileSync(join(HERE, 'generador.mjs'), 'utf8');
  const P = new Function(`return ${G.toPageScript(src)};`)();
  for (const k of ['generate', 'normalize', 'lint', 'lintFor', 'NOT_APPLICABLE', 'compileRules', 'encodeState', 'decodeState', 'diffLines', 'SCHEMA', 'PRESETS', 'VERSIONS']) assert.ok(P[k], `la página no recibe ${k}`);
  const PR = P.compileRules(W1.revisor);
  ALL.filter((_, n) => n % 17 === 0).concat(G.PRESETS.map((p) => p.cfg)).forEach((c) => {
    const a = G.generate(c), b = P.generate(c);
    assert.equal(b.dockerfile, a.dockerfile);
    assert.equal(b.dockerignore, a.dockerignore);
    assert.equal(b.commands, a.commands);
    assert.deepEqual(P.lint(b.dockerfile, PR).found.map((f) => f.r.id), G.lint(a.dockerfile, RULES).found.map((f) => f.r.id));
    const nc = G.normalize(c).cfg;
    assert.deepEqual(P.lintFor(nc, b.dockerfile, PR).na.map((n) => n.id), G.lintFor(nc, a.dockerfile, RULES).na.map((n) => n.id));
  });
});

test('el revisor compilado aquí da lo mismo que siempre con los ejemplos de cada regla', () => {
  // example_bad dispara su regla y example_good no (contrato de content-w1.json)
  for (const r of W1.revisor) {
    const one = G.compileRules([r]);
    assert.equal(G.lint(r.example_bad, one).found.length, 1, `${r.id}: example_bad`);
    assert.equal(G.lint(r.example_good, one).found.length, 0, `${r.id}: example_good`);
  }
  assert.deepEqual(findings(readFileSync(join(REF, 'gateway/Dockerfile'), 'utf8')), []);
});
