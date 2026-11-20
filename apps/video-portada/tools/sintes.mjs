// El sintetizador de las pistas (sin muestras ni música de terceros): música electrónica suave a 120 BPM en la menor
// (Am · F · C · G) y efectos para sincronizar con la imagen. Lo usan tools/sonido.mjs (el video completo) y
// tools/sonido-reel.mjs (cada reel). Cada pista decide cuánto suena cada capa con su propio `nivel`.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const FPS = 30, SR = 44100;
export const BEAT = 0.5, ORIGEN = 1.0; // compás de 2 s; el compás 0 empieza en 1 s
export const ESCALA = [69, 72, 74, 76, 79, 81]; // la menor pentatónica: una nota por etapa de la T, de datos a monitoreo
export const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
export const tramos = (t, pts) => { for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])); return pts.at(-1)[1]; };

/** Una mezcla vacía de `DUR` segundos con los instrumentos listos para escribir en ella. */
export function mezcla(DUR) {
  const N = Math.ceil(DUR * SR) + SR; // un segundo de cola para la reverb (se corta al final)
  const L = new Float32Array(N), R = new Float32Array(N);       // mezcla seca
  const RL = new Float32Array(N), RR = new Float32Array(N);     // envío a reverb

  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const suma = (t0, len, f, pan = 0, rev = 0) => {          // f(i, tiempo local) → muestra
    const a = Math.round(t0 * SR), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < len * SR; i++) {
      const k = a + i; if (k < 0 || k >= N) continue;
      const s = f(i, i / SR); if (!s) continue;
      L[k] += s * gl; R[k] += s * gr; if (rev) { RL[k] += s * gl * rev; RR[k] += s * gr * rev; }
    }
  };
  // filtro de variable de estado (paso bajo / banda / alto)
  const svf = () => { let lo = 0, bp = 0; return (x, fc, q = 0.7) => { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR); lo += f * bp; const hi = x - lo - q * bp; bp += f * hi; return { lo, bp, hi }; }; };
  // acordes: Am, F, C, G (notas MIDI) — uno por compás
  const ACORDES = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]];
  const acorde = (t) => ACORDES[((Math.floor((t - ORIGEN) / (4 * BEAT)) % 4) + 4) % 4];

  const nota = (t0, m, len, g, pan = 0, rev = 0.25) => { let ph = 0; suma(t0, len + 0.3, (i, t) => { ph += hz(m) / SR; const tri = 2 * Math.abs(2 * (ph % 1) - 1) - 1; const env = Math.min(1, t * 400) * Math.exp(-t * 6 / len); return tri * env * g; }, pan, rev); };

  /** La música: pad, batería, bajo y arpegio. `nivel` dice cuánto suena cada capa en cada instante (en s). */
  const musica = (nivel) => {
    // pad: sierras desafinadas por un paso bajo que respira
    {
      const fl = svf(), fr = svf(); const fases = new Float64Array(12);
      for (let k = 0; k < N - SR; k++) {
        const t = k / SR, a = nivel.pad(t); if (!a) continue;
        const ac = acorde(t); let l = 0, r = 0;
        ac.forEach((m, v) => [0, 1].forEach((d) => {
          const j = v * 2 + d, f = hz(m) * (d ? 1.006 : 0.995);
          fases[j] = (fases[j] + f / SR) % 1; const saw = 2 * fases[j] - 1;
          if (d) r += saw; else l += saw;
          fases[j + 6] = (fases[j + 6] + f / 2 / SR) % 1; const sub = Math.sin(2 * Math.PI * fases[j + 6]) * 0.6;
          l += sub * 0.5; r += sub * 0.5;
        }));
        // «sidechain»: el pad se agacha cuando pega el bombo
        const fase = ((t - ORIGEN) / BEAT) % 1, duck = nivel.bombo(t) ? 0.55 + 0.45 * Math.min(1, Math.max(0, fase) * 2.2) : 1;
        const fc = nivel.corte(t) * (1 + 0.15 * Math.sin(t * 0.7));
        const g = 0.045 * a * duck;
        const yl = fl(l, fc, 0.9).lo * g, yr = fr(r, fc, 0.9).lo * g;
        L[k] += yl; R[k] += yr; RL[k] += yl * 0.5; RR[k] += yr * 0.5;
      }
    }
    // batería y bajo en el pulso
    const pulsos = []; for (let t = ORIGEN; t < DUR; t += BEAT) pulsos.push(+t.toFixed(4));
    const bombo = (t0, g = 1) => { let ph = 0; suma(t0, 0.45, (i, t) => { const f = 45 + 95 * Math.exp(-t * 28); ph += f / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5) * 0.55 * g + (i < 60 ? azar() * 0.08 * g : 0); }); };
    const hat = (t0, g = 1) => { const f = svf(); suma(t0, 0.08, (i, t) => f(azar(), 9000, 0.4).hi * Math.exp(-t * 60) * 0.12 * g, 0.25, 0.1); };
    pulsos.forEach((t, n) => {
      if (nivel.bombo(t)) bombo(t, n % 4 === 0 ? 1 : 0.85);
      if (nivel.hat(t)) { hat(t + BEAT / 2, 1); if (n % 2) hat(t + BEAT * 0.75, 0.5); }
      if (nivel.bajo(t)) {
        const raiz = acorde(t)[0] - 12;
        [0, 0.5].forEach((o) => { let ph = 0; suma(t + o * BEAT, BEAT * 0.45, (i, tt) => { ph += hz(raiz) / SR; const x = Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph); return Math.tanh(x * 1.6) * Math.min(1, tt * 300) * Math.exp(-tt * 5) * 0.16; }); });
      }
      // arpegio en dieciseisavos: notas del acorde una octava arriba, alternando lados
      const ga = nivel.arpegio(t);
      if (ga) { const ac = acorde(t); [0, 1, 2, 1].forEach((v, q) => nota(t + q * BEAT / 4, ac[v] + 12 + (q === 3 && n % 2 ? 7 : 0), 0.18, 0.05 * ga, q % 2 ? 0.45 : -0.45, 0.35)); }
    });
  };

  // ------------------------------------------------------------ efectos sincronizados con la imagen
  // barrido de colores: ruido por un filtro de banda que sube y baja, de izquierda a derecha (como las barras)
  const whoosh = (centro, len, g = 1) => { const f = svf(); suma(centro - len / 2, len + 0.2, (i, t) => {
    const k = t / len, env = Math.sin(Math.PI * Math.min(1, k)) ** 2, fc = 250 + 4800 * Math.sin(Math.PI * Math.min(1, k)) ** 1.5;
    return f(azar(), fc, 0.35).bp * env * 0.33 * g; }, 0, 0.4); };
  // golpe grave (inicio de sección)
  const golpe = (t0, g = 1) => { let ph = 0; const f = svf(); suma(t0, 1.8, (i, t) => { ph += (38 + 70 * Math.exp(-t * 12)) / SR; return (Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.4) * 0.6 + f(azar(), 1800, 0.6).lo * Math.exp(-t * 5) * 0.25) * g; }, 0, 0.5); };
  // subida de ruido hacia un golpe
  const subida = (t0, t1, g = 1) => { const f = svf(); suma(t0, t1 - t0, (i, t) => { const k = t / (t1 - t0); return f(azar(), 400 + 6000 * k * k, 0.5).bp * k * k * 0.22 * g; }, 0, 0.3); };
  // «pop» musical: una nota corta con brillo (para piezas que aparecen)
  const pop = (t0, m, g = 1, pan = 0) => { let ph = 0, ph2 = 0; suma(t0, 0.5, (i, t) => { ph += hz(m) / SR; ph2 += hz(m + 12) / SR; return (Math.sin(2 * Math.PI * ph) + 0.35 * Math.sin(2 * Math.PI * ph2)) * Math.min(1, t * 600) * Math.exp(-t * 11) * 0.13 * g; }, pan, 0.45); };
  const tic = (t0, g = 1, pan = 0) => { const f = svf(); suma(t0, 0.06, (i, t) => f(azar(), 3500, 0.5).bp * Math.exp(-t * 90) * 0.35 * g, pan, 0.2); };

  // ------------------------------------------------------------ reverb (peines + pasa todo, estilo Schroeder) y master
  const reverb = (x) => {
    const y = new Float32Array(N);
    [1557, 1617, 1491, 1422, 1277, 1356].forEach((d) => { const b = new Float32Array(d); let p = 0; for (let k = 0; k < N; k++) { const o = b[p]; y[k] += o / 6; b[p] = x[k] + o * 0.82; p = (p + 1) % d; } });
    [225, 556, 441].forEach((d) => { const b = new Float32Array(d); let p = 0; for (let k = 0; k < N; k++) { const o = b[p], v = y[k]; y[k] = -v + o; b[p] = v + o * 0.5; p = (p + 1) % d; } });
    return y;
  };
  /** Mezcla final: reverb, saturación suave, pico en −1 dBFS; luego −14 LUFS (el volumen que piden las redes). */
  const escribir = (crudo, final) => {
    const rl = reverb(RL), rr = reverb(RR);
    const largo = Math.round(DUR * SR);
    let pico = 0;
    for (let k = 0; k < largo; k++) {
      L[k] = Math.tanh((L[k] + rl[k] * 0.35) * 1.2); R[k] = Math.tanh((R[k] + rr[k] * 0.35) * 1.2);
      pico = Math.max(pico, Math.abs(L[k]), Math.abs(R[k]));
    }
    const g = 0.89 / pico;
    const fin = (k) => Math.min(1, (largo - k) / (SR * 0.05)); // sin clic al final
    const buf = Buffer.alloc(44 + largo * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + largo * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(largo * 4, 40);
    for (let k = 0; k < largo; k++) { buf.writeInt16LE(Math.round(L[k] * g * fin(k) * 32767), 44 + k * 4); buf.writeInt16LE(Math.round(R[k] * g * fin(k) * 32767), 46 + k * 4); }
    writeFileSync(crudo, buf);
    // picos reales por debajo de −1.5 dBTP
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', crudo, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', String(SR), final]);
  };

  // efectos de caricatura para Turbo
  const pasito = (t0, g = 1, pan = 0) => { let ph = 0; suma(t0, 0.06, (i, t) => { ph += (1700 - 9000 * t) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 70) * 0.09 * g; }, pan, 0.1); };
  const rechinido = (t0, g = 1) => { let ph = 0; suma(t0, 0.16, (i, t) => { ph += (2300 + 260 * Math.sin(2 * Math.PI * 38 * t)) / SR; return Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * t / 0.16) * 0.035 * g; }, 0.35, 0.3); };
  const boing = (t0, g = 1, pan = 0) => { let ph = 0; suma(t0, 0.45, (i, t) => { ph += (170 + 260 * Math.min(1, t * 5) + 25 * Math.sin(2 * Math.PI * 13 * t)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t * 6) * 0.2 * g; }, pan, 0.25); };
  const caida = (t0, g = 1) => { let ph = 0; suma(t0, 0.4, (i, t) => { ph += (1900 * Math.exp(-t * 3.5)) / SR; return Math.sin(2 * Math.PI * ph) * Math.min(1, t * 80) * Math.exp(-t * 2) * 0.08 * g; }, 0, 0.3); };
  return { musica, nota, whoosh, golpe, subida, pop, tic, pasito, rechinido, boing, caida, escribir };
}
