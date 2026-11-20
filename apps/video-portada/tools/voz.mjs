// Voces de los reels con ElevenLabs. La key va en apps/video-portada/.env (ELEVENLABS_API_KEY=…), nunca en el repo.
// Busca el .env en esta carpeta y, si se corre desde un worktree, en la misma carpeta del checkout principal.
//
//   node tools/voz.mjs creditos                 → créditos usados / disponibles del mes
//   node tools/voz.mjs disenar <quien>          → 3 muestras en out/voces/<quien>-{1,2,3}.mp3 (descripción en VOCES)
//   node tools/voz.mjs guardar <quien> <n>      → guarda la muestra n como voz y anota su id en src/reels/voces.json
//   node tools/voz.mjs decir <reel>             → genera cada línea de src/reels/dialogos/<reel>.json en public/reels/voz/<reel>/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.elevenlabs.io/v1';

function key() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const lugares = [join(ROOT, '.env')];
  try {
    const comun = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT }).toString().trim();
    lugares.push(join(dirname(comun), 'apps', 'video-portada', '.env'));
  } catch { /* sin git */ }
  for (const f of lugares) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error('No encontré ELEVENLABS_API_KEY en apps/video-portada/.env');
}

async function llamar(ruta, { metodo = 'GET', cuerpo, binario = false } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'xi-api-key': key(), ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return binario ? Buffer.from(await r.arrayBuffer()) : r.json();
}

// Cómo suena cada personaje. La frase de muestra es suya (la API pide 100+ caracteres).
export const VOCES = {
  debug: {
    nombre: 'Debug (TrueML)',
    descripcion: 'A calm, warm, clear male narrator in his thirties speaking neutral Latin American Spanish. Friendly and patient like a good teacher, slightly dry and witty, medium pitch, clean studio quality, unhurried pace.',
    muestra: 'Pasado cierto punto, el modelo deja de aprender y empieza a memorizar. Es como aprenderte de memoria las respuestas del examen de práctica: en el examen de verdad, repruebas.',
  },
  turbo: {
    nombre: 'Turbo (TrueML)',
    descripcion: 'An extremely high-pitched, tiny, squeaky cartoon animal voice, like a little mouse or a tiny hamster character in an animated movie, speaking neutral Latin American Spanish. Super shrill and squeaky, cute but cranky and rude, fast and comedic, clean studio quality.',
    muestra: '¿Ves? Baja y baja. Soy una bestia. Más vueltas, más listo, no me discutas. ¿O sea que corrí trescientas ochenta epochs de más? Me voy. No me hablen.',
  },
};

const vocesJson = join(ROOT, 'src', 'reels', 'voces.json');
const leerVoces = () => (existsSync(vocesJson) ? JSON.parse(readFileSync(vocesJson, 'utf8')) : {});

const [, , cmd, a, b] = process.argv;
const OUT = join(ROOT, 'out', 'voces');

if (cmd === 'creditos') {
  const s = await llamar('/user/subscription');
  console.log(`plan: ${s.tier} · usados ${s.character_count} de ${s.character_limit} · se renueva ${new Date(s.next_character_count_reset_unix * 1000).toISOString().slice(0, 10)}`);
} else if (cmd === 'disenar') {
  const v = VOCES[a];
  if (!v) throw new Error(`no hay voz «${a}» (opciones: ${Object.keys(VOCES).join(', ')})`);
  mkdirSync(OUT, { recursive: true });
  const r = await llamar('/text-to-voice/design', { metodo: 'POST', cuerpo: { voice_description: v.descripcion, text: v.muestra, model_id: 'eleven_multilingual_ttv_v2' } });
  const ids = r.previews.map((p, i) => {
    writeFileSync(join(OUT, `${a}-${i + 1}.mp3`), Buffer.from(p.audio_base_64, 'base64'));
    return p.generated_voice_id;
  });
  writeFileSync(join(OUT, `${a}.json`), JSON.stringify({ ids }, null, 2));
  console.log(`✓ ${ids.length} muestras en out/voces/${a}-*.mp3`);
} else if (cmd === 'guardar') {
  const v = VOCES[a];
  const { ids } = JSON.parse(readFileSync(join(OUT, `${a}.json`), 'utf8'));
  const gen = ids[Number(b) - 1];
  if (!gen) throw new Error(`no hay muestra ${b}`);
  const r = await llamar('/text-to-voice', { metodo: 'POST', cuerpo: { voice_name: v.nombre, voice_description: v.descripcion, generated_voice_id: gen } });
  const todas = leerVoces();
  todas[a] = r.voice_id;
  writeFileSync(vocesJson, JSON.stringify(todas, null, 2) + '\n');
  console.log(`✓ voz de ${a} guardada: ${r.voice_id}`);
} else if (cmd === 'decir') {
  const dialogo = JSON.parse(readFileSync(join(ROOT, 'src', 'reels', 'dialogos', `${a}.json`), 'utf8'));
  const voces = leerVoces();
  const dir = join(ROOT, 'public', 'reels', 'voz', a);
  mkdirSync(dir, { recursive: true });
  for (const l of dialogo.lineas) {
    const mp3 = join(dir, `${l.id}.mp3`);
    if (existsSync(mp3) && !b) { console.log(`· ${l.id} (ya estaba)`); continue; }
    const voz = voces[l.quien];
    if (!voz) throw new Error(`falta la voz de ${l.quien} en src/reels/voces.json`);
    const audio = await llamar(`/text-to-speech/${voz}?output_format=mp3_44100_128`, {
      metodo: 'POST', binario: true,
      cuerpo: { text: l.texto, model_id: 'eleven_multilingual_v2', voice_settings: { stability: l.quien === 'turbo' ? 0.35 : 0.5, similarity_boost: 0.8, style: l.quien === 'turbo' ? 0.6 : 0.2, use_speaker_boost: true } },
    });
    writeFileSync(mp3, audio);
    console.log(`✓ ${l.id}`);
  }
  // Procesado: Turbo sube ~4 semitonos y va 1.3× más rápido (chillón y atropellado); Debug, 1.1× más rápido; todos a −16 LUFS, mono 44.1 kHz.
  // Después, la duración en frames y la envolvente por frame (0..1) para mover la boca: <reel>.tiempos.json.
  const tiempos = {};
  for (const l of dialogo.lineas) {
    const mp3 = join(dir, `${l.id}.mp3`), wav = join(dir, `${l.id}.wav`);
    const tono = l.quien === 'turbo' ? 'asetrate=44100*1.25,aresample=44100,atempo=1.05,' : 'atempo=1.1,';
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', mp3, '-af', `${tono}silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5`, '-ar', '44100', '-ac', '1', wav]);
    const pcm = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', wav, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 28 });
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const porFrame = 44100 / 30, env = [];
    for (let k = 0; k * porFrame < x.length; k++) {
      let s = 0; const a0 = Math.floor(k * porFrame), a1 = Math.min(x.length, Math.floor((k + 1) * porFrame));
      for (let i = a0; i < a1; i++) s += x[i] * x[i];
      env.push(Math.sqrt(s / Math.max(1, a1 - a0)));
    }
    const max = Math.max(...env);
    tiempos[l.id] = { quien: l.quien, frames: env.length, env: env.map((v) => Math.round((v / max) * 100) / 100) };
  }
  writeFileSync(join(ROOT, 'src', 'reels', 'dialogos', `${a}.tiempos.json`), JSON.stringify(tiempos) + '\n');
  console.log('✓ tiempos:', Object.entries(tiempos).map(([k, v]) => `${k}=${v.frames}`).join(' '));
} else {
  console.log('uso: node tools/voz.mjs creditos | disenar <quien> | guardar <quien> <n> | decir <reel> [--otra-vez]');
}
