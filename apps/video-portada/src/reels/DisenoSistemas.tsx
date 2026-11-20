// Reel 12 · Diseño de sistemas: «Cuando te piden diseñar un sistema de recomendaciones y empiezas por el modelo».
// Turbo llega a la entrevista y suelta «¡un transformer de 7 mil millones de parámetros!»; el entrevistador (solo
// texto, sin voz) lo frena. Debug da lo que debió responder, en orden: problema, métrica, datos, modelo (simple
// primero, y el embudo de candidatos → ranking) y cómo se sirve y se vigila. Con voz (dialogos/12-diseno-sistemas.json).
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/12-diseno-sistemas.tiempos.json';

const ID = '12-diseno-sistemas';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 130, t2: 296,
  n2: 4, n3: 96, n4: 262, n5: 400, t3: 448, n6: 492, n7: 742,
  t4: 50, d1: 96,
  n8: 12,
};
const PREGUNTA = 250; // el entrevistador lo frena (escena 1)
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** Entra con resorte a partir de `desde` (0..1). */
const useResorte = (desde: number, damping = 13) => {
  const f = useCurrentFrame();
  return spring({ frame: f - desde, fps: 30, config: { damping, mass: 0.6, stiffness: 170 } });
};

/** La videollamada de la entrevista: el entrevistador (silueta, sin nombre ni marca) y sus mensajes, con el reloj de 45:00. */
const Llamada: React.FC<{ top: number; mensajes: { desde: number; texto: string }[]; segundo0: number; corre?: boolean; colgada?: number }> =
  ({ top, mensajes, segundo0, corre = true, colgada = 1e9 }) => {
    const f = useCurrentFrame();
    const seg = Math.max(0, 45 * 60 - segundo0 - (corre ? Math.floor(f / 30) : 0));
    const reloj = `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;
    const actual = mensajes.reduce((a, m, i) => (f >= m.desde ? i : a), 0);
    const m = mensajes[actual];
    const e = spring({ frame: f - m.desde, fps: 30, config: { damping: 12, mass: 0.5, stiffness: 190 } });
    const fuera = interpolate(f, [colgada, colgada + 8], [0, 1], clamp);
    return (
      <div style={{ position: 'absolute', left: 70, top, width: 940, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `650 26px/1 ${MONO}`, color: C.ink3 }}>
          <i style={{ width: 16, height: 16, borderRadius: 8, background: fuera > 0.5 ? C.ink3 : '#EC6A3F', boxShadow: fuera > 0.5 ? 'none' : '0 0 14px #EC6A3F' }} />
          <span>{fuera > 0.5 ? 'LLAMADA TERMINADA' : 'ENTREVISTA · DISEÑO DE SISTEMAS DE ML'}</span>
          <span style={{ marginLeft: 'auto', color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{reloj}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '26px 30px', opacity: 1 - 0.6 * fuera }}>
          <svg width={120} height={120} viewBox="0 0 120 120" style={{ flex: 'none' }}>
            <circle cx={60} cy={60} r={58} fill="#1E264A" stroke={C.line} strokeWidth={3} />
            <circle cx={60} cy={46} r={20} fill="#3A4577" />
            <path d="M22 104 C26 78 44 70 60 70 C76 70 94 78 98 104 Z" fill="#3A4577" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ font: `700 26px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>ENTREVISTADOR</div>
            <div style={{ marginTop: 14, font: `700 50px/1.12 ${SANS}`, color: C.ink, letterSpacing: '-0.02em',
              opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 20}px)` }}>{m.texto}</div>
          </div>
        </div>
      </div>
    );
  };

// ── 1 · El gancho: «diseña un sistema de recomendaciones» → Turbo suelta el modelo gigante → el entrevistador lo frena.
const Entrevista: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const presume = f >= VOZ.t1 - 4 && f < PREGUNTA;
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 36 : 0;
  const cara = f < VOZ.t1 - 4 ? { parpado: parpadeo(f, 70), boca: 'normal' as const }
    : presume ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'grito' as const }
    : f < VOZ.t2 - 4 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const, cachetes: 1.1 }
    : { ojos: 'fastidio' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'mueca' as const };
  const brazos: [number, number] = presume ? [150, -150] : f >= PREGUNTA ? [14, -14] : [0, 0];
  const temblor = f >= PREGUNTA && f < PREGUNTA + 18 ? Math.sin(f * 3.1) * 6 : 0;
  // el «7B» que se infla mientras presume
  const infla = interpolate(f, [VOZ.t1 + 60, VOZ.t1 + 110], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) }) * interpolate(f, [PREGUNTA, PREGUNTA + 8], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.b, C.p, C.y, C.o, C.b, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Cuando te piden diseñar un sistema de recomendaciones y empiezas por el modelo" marcas={{ recomendaciones: C.acc, modelo: C.o }} desde={-14} paso={2} tam={74} />
        </div>
        <Llamada top={600} segundo0={0} mensajes={[{ desde: 0, texto: 'Diseña un sistema de recomendaciones.' }, { desde: PREGUNTA, texto: 'Espera. ¿Recomendar qué? ¿A quién?' }]} />
        {infla > 0.01 && <div style={{ position: 'absolute', left: 640, top: 1120, transform: `scale(${infla}) rotate(-8deg)`, transformOrigin: '50% 50%',
          font: `900 120px/1 ${SANS}`, color: '#FF8A5C', letterSpacing: '-0.05em', textShadow: '0 0 40px #EC6A3F99, 6px 6px 0 #0B0F1F' }}>7B</div>}
        <Turbo cx={420 + temblor} pies={1575 + salto} escala={0.58} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={110} y={930} ancho={860} desde={VOZ.t1} hasta={PREGUNTA - 2} cola={300} tam={50}>¡Fácil! ¡Un transformer de 7 mil millones de parámetros!</Burbuja>
        <Burbuja quien="turbo" x={150} y={1000} ancho={480} desde={VOZ.t2} cola={260}>¿Eh… cosas?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · Lo que debió hacer: cinco pasos en orden. Arriba, el avance; en medio, el paso actual con su dibujito.
const INICIO = [VOZ.n3, VOZ.n4, VOZ.n5, VOZ.n6, VOZ.n7];
const CORTO = ['Problema', 'Métrica', 'Datos', 'Modelo', 'Servir'];
const TITULO = ['Aclara el problema', '¿Cómo mides el éxito?', '¿Qué datos tienes?', 'El modelo, empezando simple', 'Servirlo y vigilarlo'];

/** Tarjetita de pregunta → respuesta. */
const Tarjeta: React.FC<{ q: string; a: string; color: string; desde: number }> = ({ q, a, color, desde }) => {
  const e = useResorte(desde);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 26px', borderRadius: 20, background: '#ffffff0c', border: `2px solid ${color}88`,
      opacity: Math.min(1, e * 1.4), transform: `translateX(${(1 - e) * 60}px)` }}>
      <span style={{ font: `600 36px/1.1 ${SANS}`, color: C.ink2 }}>{q}</span>
      <span style={{ font: `800 38px/1 ${MONO}`, color }}>{a}</span>
    </div>
  );
};

/** El embudo de los recomendadores: millones → cientos → los pocos que ves. */
const Embudo: React.FC<{ t: number }> = ({ t }) => {
  const filas = [
    { ancho: 880, n: 'millones de videos', nota: 'todo el catálogo', col: VIVOS[5] },
    { ancho: 620, n: 'unos cientos', nota: '1 · candidatos (rápido)', col: VIVOS[3] },
    { ancho: 480, n: 'los ~10 que ves', nota: '2 · ranking (fino)', col: VIVOS[2] },
  ];
  // la narración llega al truco a mitad de la línea n6
  const k0 = 92;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {filas.map((r, i) => {
        const e = spring({ frame: t - k0 - i * 26, fps: 30, config: { damping: 13, mass: 0.6, stiffness: 160 } });
        return <React.Fragment key={i}>
          {i > 0 && <div style={{ font: `900 26px/1 ${SANS}`, color: C.ink3, opacity: e }}>▼</div>}
          <div style={{ width: r.ancho, padding: '12px 0', borderRadius: 18, background: `${r.col}26`, border: `3px solid ${r.col}`, textAlign: 'center',
            opacity: Math.min(1, e * 1.4), transform: `scaleX(${0.4 + 0.6 * e})` }}>
            <div style={{ font: `850 38px/1 ${SANS}`, color: C.ink, letterSpacing: '-0.02em' }}>{r.n}</div>
            <div style={{ marginTop: 8, font: `650 26px/1 ${MONO}`, color: r.col }}>{r.nota}</div>
          </div>
        </React.Fragment>;
      })}
    </div>
  );
};

/** Lo de cada paso (940 de ancho). `t` = frames desde que empezó el paso. */
const Contenido: React.FC<{ i: number; t: number; desde: number }> = ({ i, t, desde }) => {
  const col = VIVOS[i];
  if (i === 0) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ font: `650 26px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>POR EJEMPLO</div>
      <Tarjeta q="¿Qué recomiendas?" a="videos" color={col} desde={desde + 22} />
      <Tarjeta q="¿A cuántos usuarios?" a="10 millones" color={col} desde={desde + 56} />
      <Tarjeta q="¿Qué tan rápido responde?" a="< 200 ms" color={col} desde={desde + 104} />
    </div>;
  }
  if (i === 1) {
    const ojo = interpolate(t, [60, 74], [0, 1], clamp);
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Tarjeta q="¿Le dan clic?" a="clics" color={col} desde={desde + 30} />
      <Tarjeta q="¿Lo ven completo?" a="minutos vistos" color={col} desde={desde + 62} />
      <div style={{ marginTop: 8, padding: '20px 26px', borderRadius: 20, background: '#EC6A3F1f', border: '2px dashed #FF8A5C', font: `550 34px/1.3 ${SANS}`, color: C.ink2,
        opacity: ojo, transform: `translateY(${(1 - ojo) * 20}px)` }}>
        <b style={{ color: '#FF8A5C' }}>Ojo:</b> si solo cuentas clics, ganan los títulos tramposos (<i>clickbait</i>).
      </div>
    </div>;
  }
  if (i === 2) {
    const filas = [['ana', 'video 17', '✓', '♥'], ['ana', 'video 42', '✕', ''], ['beto', 'video 17', '✓', ''], ['beto', 'video 8', '✓', '♥']];
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 10, font: `650 32px/1 ${MONO}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.4fr 1fr', padding: '0 22px', color: C.ink3, fontSize: 24, letterSpacing: '0.06em' }}>
        <span>USUARIO</span><span>VIO</span><span>¿COMPLETO?</span><span>LIKE</span>
      </div>
      {filas.map((r, k) => {
        const e = interpolate(t, [6 + k * 6, 14 + k * 6], [0, 1], clamp);
        return <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.4fr 1fr', padding: '16px 22px', borderRadius: 14, background: '#ffffff0c', border: `2px solid ${C.line}`, color: C.ink, opacity: e, transform: `translateX(${(1 - e) * 40}px)` }}>
          <span>{r[0]}</span><span>{r[1]}</span><span style={{ color: r[2] === '✓' ? '#2FD3A0' : '#FF8A5C' }}>{r[2]}</span><span style={{ color: '#FF8A5C' }}>{r[3]}</span>
        </div>;
      })}
      <div style={{ marginTop: 6, font: `550 32px/1.3 ${SANS}`, color: C.ink2, opacity: interpolate(t, [36, 46], [0, 1], clamp) }}>El historial de quién vio qué: con eso aprende el modelo.</div>
    </div>;
  }
  if (i === 3) {
    const primero = interpolate(t, [8, 20], [0, 1], clamp);
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ padding: '16px 24px', borderRadius: 18, background: `${col}22`, border: `2px solid ${col}`, font: `600 34px/1.25 ${SANS}`, color: C.ink, opacity: primero }}>
        Primero lo simple: <b style={{ color: col }}>lo más visto</b>. Es la base que tu modelo tiene que superar.
      </div>
      <Embudo t={t} />
    </div>;
  }
  // servir y vigilar: el reloj de la respuesta y la métrica en producción
  const p = interpolate(t, [4, 60], [0, 1], clamp);
  const pts = Array.from({ length: 31 }, (_, k) => { const x = k / 30; return [30 + x * 400, 120 - (x < 0.55 ? x * 60 : 33 - (x - 0.55) * 150) + Math.sin(k * 1.9) * 5]; });
  const vis = pts.slice(0, Math.max(2, Math.round(31 * p)));
  const alerta = interpolate(t, [58, 64], [0, 1], clamp);
  return <div style={{ display: 'flex', gap: 20 }}>
    <div style={{ flex: 1, padding: '22px 24px', borderRadius: 20, background: '#ffffff0c', border: `2px solid ${col}` }}>
      <div style={{ font: `650 24px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>SERVIR</div>
      <div style={{ marginTop: 18, font: `850 64px/1 ${MONO}`, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{Math.round(interpolate(t, [4, 30], [0, 140], clamp))} ms</div>
      <div style={{ marginTop: 12, font: `550 30px/1.25 ${SANS}`, color: C.ink2 }}>Responde antes del límite que pactaste.</div>
    </div>
    <div style={{ flex: 1.1, padding: '22px 24px', borderRadius: 20, background: '#ffffff0c', border: `2px solid ${col}` }}>
      <div style={{ font: `650 24px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>VIGILAR · MINUTOS VISTOS</div>
      <svg width={460} height={160} style={{ marginTop: 10 }}>
        <path d={'M' + vis.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} stroke={col} strokeWidth={7} fill="none" strokeLinecap="round" />
        <g opacity={alerta} transform={`translate(400 110) scale(${0.6 + 0.4 * alerta})`}>
          <path d="M0 -34 L32 22 L-32 22 Z" fill="#FF8A5C" stroke="#0B1026" strokeWidth={4} strokeLinejoin="round" />
          <text x={0} y={15} textAnchor="middle" fontFamily={SANS} fontWeight={900} fontSize={34} fill="#0B1026">!</text>
        </g>
      </svg>
      <div style={{ font: `550 30px/1.25 ${SANS}`, color: C.ink2 }}>Si baja, te enteras tú, no el jefe.</div>
    </div>
  </div>;
};

const Pasos: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const actual = INICIO.reduce((a, s, i) => (f >= s ? i : a), -1);
  const i = Math.max(0, actual);
  const t = f - INICIO[i];
  const e = actual < 0 ? 0 : interpolate(t, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const habla = Math.max(...(['n2', 'n3', 'n4', 'n5', 'n6', 'n7'] as Linea[]).map((id) => vol(id, f)));
  const turbo = f >= VOZ.t3 - 4 && f < VOZ.n6 + 20;
  const cara = turbo ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t3', f)) ?? 'grito' as const }
    : f >= VOZ.n6 + 20 && f < VOZ.n7 ? { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 20) }
    : { ojos: 'normal' as const, boca: 'normal' as const, parpado: parpadeo(f, 70, 10) };
  const brazos: [number, number] = turbo ? [150, -150] : [-10, 10];
  const salto = turbo ? -Math.abs(Math.sin((f - VOZ.t3) / 4)) * 26 : 0;
  return (
    <AbsoluteFill>
      <Fondo tinte={VIVOS[i]} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <App texto="Lo que debiste responder" color={C.yt} desde={0} />
          <Gancho texto="El modelo va casi al final." marcas={{ final: C.o }} desde={VOZ.n2 + 6} paso={3} tam={76} style={{ marginTop: 22 }} />
        </div>
        {/* el avance: cinco puntos */}
        <div style={{ position: 'absolute', left: 70, top: 470, width: 940, height: 130 }}>
          <div style={{ position: 'absolute', left: 60, right: 60, top: 34, height: 6, borderRadius: 3, background: C.line }} />
          <div style={{ position: 'absolute', left: 60, top: 34, height: 6, borderRadius: 3, background: C.yt, width: actual < 1 ? 0 : (820 * (actual - 1 + Math.min(1, t / 16))) / 4 }} />
          {CORTO.map((c, k) => {
            const on = k <= actual;
            const ent = pulso(k, actual, f);
            return <div key={c} style={{ position: 'absolute', left: 60 + (820 * k) / 4 - 90, top: 0, width: 180, textAlign: 'center' }}>
              <div style={{ margin: '0 auto', width: 74, height: 74, borderRadius: 37, display: 'grid', placeItems: 'center', background: on ? VIVOS[k] : C.card, border: `4px solid ${on ? VIVOS[k] : C.line}`,
                color: on ? C.bg : C.ink3, font: `900 38px/1 ${SANS}`, boxShadow: k === actual ? `0 0 40px ${VIVOS[k]}` : 'none', transform: `scale(${1 + 0.25 * ent})` }}>{k + 1}</div>
              <div style={{ marginTop: 12, font: `700 26px/1 ${SANS}`, color: on ? C.ink : C.ink3 }}>{c}</div>
            </div>;
          })}
        </div>
        {/* el paso actual */}
        {actual >= 0 && <div style={{ position: 'absolute', left: 70, top: 650, width: 940, opacity: e, transform: `translateY(${(1 - e) * 30}px)` }}>
          <div style={{ font: `700 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>PASO {i + 1} DE 5</div>
          <div style={{ marginTop: 12, font: `850 62px/1 ${SANS}`, letterSpacing: '-0.04em', color: VIVOS[i] }}>{TITULO[i]}</div>
          <div style={{ marginTop: 28 }}><Contenido i={i} t={t} desde={INICIO[i]} /></div>
        </div>}
        <Debug x={60} y={1440} escala={1.1} ceja={0.6} habla={habla} derecha />
        <Turbo cx={730} pies={1625 + salto} escala={0.38} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={120} y={1205} ancho={840} desde={VOZ.t3} hasta={fin('t3') + 10} cola={610} tam={44}>¡Ahora sí el transformer!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 'n3', 'n4', 'n5', 't3', 'n6', 'n7']} />
    </AbsoluteFill>
  );
};

/** Pulso del punto del avance cuando se enciende. */
const pulso = (k: number, actual: number, f: number) => (k === actual ? interpolate(f - INICIO[k], [0, 6, 16], [0, 1, 0], clamp) : 0);

// ── 3 · El remate: «nosotros te llamamos». Turbo pregunta si sí; Debug: «No.» Turbo se desploma.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const cae = VOZ.d1 + 8;
  const giro = interpolate(f, [cae, cae + 12], [0, 88], { ...clamp, easing: Easing.in(Easing.quad) });
  const cara = f < VOZ.t4 - 4 ? { ojos: 'normal' as const, parpado: parpadeo(f, 60, 30), boca: 'normal' as const }
    : f < VOZ.d1 + 2 ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t4', f)) ?? 'normal' as const, cachetes: 1.08 }
    : { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'grito' as const, cachetes: 1.12 };
  const brazos: [number, number] = f < VOZ.d1 + 2 ? [-24, 24] : [60, -60];
  const debugX = interpolate(f, [VOZ.d1 - 16, VOZ.d1 - 2], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.b, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Primero el problema. El modelo, casi al final." marcas={{ problema: C.g }} desde={0} paso={3} tam={70} />
        </div>
        <Llamada top={470} segundo0={52} corre={false} colgada={VOZ.d1 + 30} mensajes={[{ desde: 4, texto: 'Gracias. Nosotros te llamamos.' }]} />
        <Turbo cx={450} pies={1560} escala={0.58} giro={giro} pose={{ cara, brazos }} />
        <Debug x={debugX} y={1440} escala={1.1} ceja={1} habla={vol('d1', f)} derecha />
        <Burbuja quien="turbo" x={150} y={900} ancho={640} desde={VOZ.t4} hasta={VOZ.d1 + 6} cola={300}>¿Sí me van a llamar?</Burbuja>
        <Burbuja quien="debug" x={70} y={1260} ancho={190} desde={VOZ.d1} cola={80}>No.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 'd1']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="diseno-sistemas" color={C.b} frase={<>Practica esta entrevista en la <span style={{ color: VIVOS[3] }}>Ronda de Diseño ML</span></>} />
    <Voces ids={['n8']} />
  </AbsoluteFill>
);

export const ReelDisenoSistemas: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ entrevista: Entrevista, pasos: Pasos, remate: Remate, cierre: CierreEscena }} />
);
