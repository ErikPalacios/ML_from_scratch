// Reel 10 · «Cuando presumes 99 % de accuracy en la entrevista».
// Turbo (con lentes oscuros) presume su modelo de fraude; el entrevistador escribe «¿Y contra qué baseline?».
// Debug explica: si 1 de cada 100 transacciones es fraude, el modelo que siempre dice «no es fraude» también saca
// 99 % y atrapa 0 fraudes (detector de humo que nunca suena). Lo que debió responder: le gano al baseline y mido el
// recall. Remate: «¡Ahora todo es fraude!» y el entrevistador se sale de la llamada. Con voz
// (src/reels/dialogos/10-presume-99.json, tools/voz.mjs), igual que los reels 08 y 09.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, NARANJA, parpadeo, Turbo, VERDE } from './personajes';
import TIEMPOS from './dialogos/10-presume-99.tiempos.json';

const ID = '10-presume-99';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 104, t2: 252,
  n2: 4, n3: 95, t3: 310,
  n5: 6,
  n6: 4,
  t4: 6, t5: 152, d2: 184,
  n7: 12,
};
// El entrevistador no habla: escribe en el chat de la videollamada.
const PREGUNTA = 196; // escena 1
const GRACIAS = 92, SALE = 132; // escena 5

const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** Lentes oscuros encima de los ojos de Turbo (mismo marco que <Turbo>). `baja` los resbala por la nariz (0..1). */
const Lentes: React.FC<{ cx: number; pies: number; escala: number; baja?: number }> = ({ cx, pies, escala, baja = 0 }) => (
  <svg viewBox="0 0 1080 900" width={1080 * escala} height={900 * escala}
    style={{ position: 'absolute', left: cx - 540 * escala, top: pies - 815 * escala, overflow: 'visible' }}>
    <g transform={`translate(0 ${baja * 46}) rotate(${baja * -9} 540 330)`}>
      <path d="M418 318 L380 300 M662 318 L700 300" stroke="#0B0F1F" strokeWidth={9} strokeLinecap="round" />
      <path d="M526 322 Q540 310 554 322" stroke="#0B0F1F" strokeWidth={9} fill="none" />
      {[482, 598].map((x) => <g key={x}>
        <rect x={x - 62} y={296} width={124} height={70} rx={24} fill="#0B0F1F" stroke="#1C2140" strokeWidth={5} />
        <path d={`M${x - 40} ${312} L${x - 14} ${312}`} stroke="#ffffff55" strokeWidth={8} strokeLinecap="round" />
      </g>)}
    </g>
  </svg>
);

/** La ventana de la videollamada: el entrevistador es una silueta; abajo, su chat. `fuera` (0..1) = ya colgó. */
const Llamada: React.FC<{ y: number; alto: number; mensaje?: React.ReactNode; desde?: number; fuera?: number }> = ({ y, alto, mensaje, desde = 1e9, fuera = 0 }) => {
  const f = useCurrentFrame();
  const escribe = f >= desde - 22 && f < desde;
  const e = spring({ frame: f - desde, fps: 30, config: { damping: 13, mass: 0.6 } });
  const seg = 754 + Math.floor(f / 30);
  return (
    <div style={{ position: 'absolute', left: 70, top: y, width: 940, height: alto, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `600 26px/1 ${MONO}`, color: C.ink3 }}>
        <i style={{ width: 16, height: 16, borderRadius: 8, background: fuera > 0.5 ? C.n : '#EC6A3F', opacity: fuera > 0.5 || Math.floor(f / 15) % 2 ? 1 : 0.35 }} />
        <span>Entrevista · ML Engineer</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{`${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`}</span>
      </div>
      <div style={{ position: 'relative', height: alto - 64, background: 'radial-gradient(circle at 50% 35%, #2A3466, #121A36 70%)' }}>
        <svg width={940} height={alto - 64} style={{ position: 'absolute', inset: 0, opacity: 1 - fuera }}>
          <circle cx={470} cy={(alto - 64) * 0.36} r={68} fill="#5A6699" />
          <path d={`M300 ${alto - 64} Q300 ${(alto - 64) * 0.6} 470 ${(alto - 64) * 0.6} Q640 ${(alto - 64) * 0.6} 640 ${alto - 64} Z`} fill="#5A6699" />
        </svg>
        <div style={{ position: 'absolute', left: 22, top: 18, padding: '8px 16px', borderRadius: 10, background: '#0B0F1Fcc', font: `600 24px/1 ${SANS}`, color: C.ink2, opacity: 1 - fuera }}>Entrevistador</div>
        {fuera > 0 && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, opacity: fuera, background: '#0B0F1F' }}>
          <svg width={110} height={60}><rect x={0} y={0} width={110} height={60} rx={30} fill="#EC6A3F" />
            <path d="M28 34 Q55 14 82 34" stroke="#fff" strokeWidth={9} fill="none" strokeLinecap="round" /></svg>
          <div style={{ font: `650 38px/1.2 ${SANS}`, color: C.ink2 }}>El entrevistador salió de la llamada</div>
        </div>}
        {escribe && fuera === 0 && <div style={{ position: 'absolute', left: 26, bottom: 24, padding: '18px 26px', borderRadius: 22, background: '#F4F6FF', display: 'flex', gap: 10 }}>
          {[0, 1, 2].map((k) => <i key={k} style={{ width: 14, height: 14, borderRadius: 7, background: '#5A6699', opacity: 0.4 + 0.6 * Math.max(0, Math.sin((f + k * 5) / 3)) }} />)}
        </div>}
        {mensaje && f >= desde && fuera < 1 && <div style={{ position: 'absolute', left: 26, bottom: 24, maxWidth: 860, padding: '18px 28px 20px', borderRadius: 22, background: '#F4F6FF',
          opacity: Math.min(1, e * 1.4) * (1 - fuera), transform: `scale(${0.7 + 0.3 * e})`, transformOrigin: '0% 100%' }}>
          <div style={{ font: `800 20px/1 ${MONO}`, letterSpacing: '0.08em', color: '#5A6699' }}>ENTREVISTADOR</div>
          <div style={{ marginTop: 8, font: `700 46px/1.15 ${SANS}`, color: '#0B0F1F' }}>{mensaje}</div>
        </div>}
      </div>
    </div>
  );
};

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

// ── 1 · El gancho: Turbo, con lentes oscuros, presume su 99 %. El entrevistador: «¿Y contra qué baseline?».
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const presume = f >= VOZ.t1 - 4 && f < PREGUNTA;
  const shock = f >= PREGUNTA + 10;
  const baja = interpolate(f, [PREGUNTA + 10, PREGUNTA + 22], [0, 1], { ...clamp, easing: Easing.out(Easing.bounce) });
  const cara = shock ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, cachetes: 1.08 }
    : { ojos: 'normal' as const, boca: presume ? boca(vol('t1', f)) ?? 'normal' as const : 'normal' as const, parpado: parpadeo(f, 70) };
  const brazos: [number, number] = presume ? [150, -150] : shock ? [14, -14] : [-30, 30];
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 26 : 0;
  const temblor = shock && f < PREGUNTA + 30 ? Math.sin(f * 3.1) * 5 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.g, C.b, C.y, C.p, C.g, C.o]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando presumes 99% de accuracy en la entrevista" marcas={{ '99%': C.g, entrevista: C.o }} desde={-14} paso={2} tam={84} />
          <Linea desde={40} tam={34} style={{ marginTop: 18 }}><b style={{ color: C.yt }}>Accuracy</b> = de todas las predicciones, cuántas acertaste.</Linea>
        </div>
        <Llamada y={620} alto={430} mensaje="¿Y contra qué baseline?" desde={PREGUNTA} />
        <Turbo cx={540 + temblor} pies={1590 + salto} escala={0.5} pose={{ cara, brazos }} />
        <Lentes cx={540 + temblor} pies={1590 + salto} escala={0.5} baja={baja} />
        <Burbuja quien="turbo" x={250} y={940} ancho={600} desde={VOZ.t1} hasta={fin('t1') + 4} cola={290}>¡99%! ¡Soy un genio!</Burbuja>
        <Burbuja quien="turbo" x={300} y={1080} ancho={480} desde={VOZ.t2} cola={240} tam={50}>¿Base… qué?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · El baseline: 100 transacciones, 1 fraude. El modelo que siempre dice «no es fraude» saca 99 %.
const FRAUDE = 46;
const MARCA0 = 112, MARCA1 = 196; // la palomita barre las 100 celdas
const Baseline: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const lado = 56, hueco = 8, x0 = (1080 - (10 * lado + 9 * hueco)) / 2, y0 = 452;
  const barre = interpolate(f, [MARCA0, MARCA1], [0, 100], clamp);
  const escapa = interpolate(f, [MARCA1 + 6, MARCA1 + 16], [0, 1], clamp);
  const triste = f >= VOZ.t3 - 2;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Debug explica" color={C.yt} desde={0} />
          <Gancho texto="100 transacciones. Solo 1 es fraude." marcas={{ '1': NARANJA }} desde={4} paso={3} tam={70} style={{ marginTop: 20 }} />
        </div>
        <svg width={1080} height={700} style={{ position: 'absolute', left: 0, top: y0 - 10, overflow: 'visible' }}>
          {Array.from({ length: 100 }, (_, i) => {
            const r = Math.floor(i / 10), c = i % 10, x = x0 + c * (lado + hueco), y = 10 + r * (lado + hueco);
            const aparece = interpolate(f, [6 + i * 0.4, 14 + i * 0.4], [0, 1], clamp);
            const fr = i === FRAUDE;
            const marcada = barre > i;
            return <g key={i} opacity={aparece}>
              <rect x={x} y={y} width={lado} height={lado} rx={12} fill={fr ? `${NARANJA}44` : '#ffffff10'} stroke={fr ? NARANJA : C.line} strokeWidth={fr ? 4 : 2} />
              {fr && !marcada && <text x={x + lado / 2} y={y + 40} textAnchor="middle" fontFamily={SANS} fontWeight={900} fontSize={34} fill={NARANJA}>!</text>}
              {marcada && <path d={`M${x + 15} ${y + 29} L${x + 25} ${y + 39} L${x + 42} ${y + 19}`} stroke={fr ? NARANJA : VERDE} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              {fr && escapa > 0 && <circle cx={x + lado / 2} cy={y + lado / 2} r={44 + 10 * Math.sin(f / 4)} fill="none" stroke={NARANJA} strokeWidth={5} opacity={escapa} />}
            </g>;
          })}
        </svg>
        <div style={{ position: 'absolute', left: 70, top: 1100, width: 940, textAlign: 'center' }}>
          <Linea desde={MARCA0 - 6} tam={36} color={C.ink2}>Modelo que <b style={{ color: C.ink }}>siempre</b> dice «no es fraude»:</Linea>
          <div style={{ marginTop: 6, font: `850 64px/1.1 ${SANS}`, color: C.ink, letterSpacing: '-0.03em', opacity: interpolate(f, [MARCA1, MARCA1 + 8], [0, 1], clamp) }}>
            99 de 100 bien = <span style={{ color: VERDE }}>99%</span>
          </div>
          <div style={{ marginTop: 10, font: `500 34px/1.3 ${SANS}`, color: C.ink2, opacity: interpolate(f, [MARCA1 + 30, MARCA1 + 40], [0, 1], clamp) }}>
            Ese es el <b style={{ color: C.yt }}>baseline</b>: el modelo más tonto posible.<br />El tuyo tiene que ganarle.
          </div>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={0.6} habla={Math.max(vol('n2', f), vol('n3', f))} derecha />
        <Turbo cx={780} pies={1600} escala={0.34} pose={{ cara: triste ? { ojos: 'fastidio', boca: boca(vol('t3', f)) ?? 'mueca', cachetes: 1.1 } : { ojos: 'normal', parpado: parpadeo(f, 60, 20) }, brazos: triste ? [-30, 30] : [0, 0] }} />
        <Burbuja quien="turbo" x={250} y={960} ancho={720} desde={VOZ.t3} cola={530} tam={52}>…Ese es mi modelo.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 'n3', 't3']} />
    </AbsoluteFill>
  );
};

// ── 3 · La analogía: un detector de humo que nunca suena acierta casi todos los días… y falla el del incendio.
const DIA_FUEGO = 29;
const Detector: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const lado = 92, hueco = 12, x0 = (1080 - (6 * lado + 5 * hueco)) / 2, y0 = 700;
  const fuego = f >= 20 + DIA_FUEGO * 3;
  const tache = interpolate(f, [126, 134], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.o} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Es un detector de humo que nunca suena." marcas={{ nunca: C.o }} desde={0} paso={3} tam={76} />
        </div>
        <svg width={360} height={170} style={{ position: 'absolute', left: 360, top: 470, overflow: 'visible' }}>
          <rect x={60} y={0} width={240} height={20} rx={6} fill={C.line} />
          <ellipse cx={180} cy={60} rx={150} ry={46} fill="#E9ECF8" />
          <ellipse cx={180} cy={52} rx={110} ry={26} fill="#D5DAEE" />
          {[-60, -30, 0, 30, 60].map((d) => <rect key={d} x={180 + d - 8} y={44} width={16} height={6} rx={3} fill="#AEB6D8" />)}
          <circle cx={270} cy={70} r={9} fill={C.n} />
          <text x={330} y={40} fontFamily={SANS} fontWeight={800} fontSize={40} fill={C.ink3} opacity={0.4 + 0.6 * Math.abs(Math.sin(f / 18))}>z z z</text>
        </svg>
        <svg width={1080} height={520} style={{ position: 'absolute', left: 0, top: y0 - 10, overflow: 'visible' }}>
          {Array.from({ length: 30 }, (_, i) => {
            const r = Math.floor(i / 6), c = i % 6, x = x0 + c * (lado + hueco), y = 10 + r * (lado + hueco);
            const t = f - (20 + i * 3);
            if (t < 0) return null;
            const e = interpolate(t, [0, 6], [0.5, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
            const esFuego = i === DIA_FUEGO;
            return <g key={i} transform={`translate(${x + lado / 2} ${y + lado / 2}) scale(${e}) translate(${-x - lado / 2} ${-y - lado / 2})`}>
              <rect x={x} y={y} width={lado} height={lado} rx={16} fill={esFuego ? `${NARANJA}33` : `${VERDE}22`} stroke={esFuego ? NARANJA : VERDE} strokeWidth={3} />
              <text x={x + 12} y={y + 28} fontFamily={MONO} fontWeight={700} fontSize={20} fill={C.ink3}>{i + 1}</text>
              {!esFuego && <path d={`M${x + 28} ${y + 52} L${x + 42} ${y + 66} L${x + 66} ${y + 38}`} stroke={VERDE} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
              {esFuego && <g transform={`translate(${x + lado / 2} ${y + 72}) scale(${1 + 0.08 * Math.sin(f / 2)})`}>
                <path d="M0 0 C-26 0 -30 -26 -14 -44 C-12 -30 -4 -28 -2 -34 C-6 -50 6 -62 14 -66 C10 -50 30 -40 26 -18 C24 -6 14 0 0 0 Z" fill="#FF8A5C" />
                <path d="M0 0 C-12 0 -14 -14 -6 -24 C-2 -14 6 -16 6 -24 C14 -16 14 0 0 0 Z" fill="#FFC857" />
              </g>}
              {esFuego && tache > 0 && <path d={`M${x + 8} ${y + 8} L${x + lado - 8} ${y + lado - 8} M${x + lado - 8} ${y + 8} L${x + 8} ${y + lado - 8}`} stroke="#FF4D4D" strokeWidth={10} strokeLinecap="round" opacity={tache} />}
            </g>;
          })}
        </svg>
        <div style={{ position: 'absolute', left: 70, top: 1250, width: 940, textAlign: 'center' }}>
          <Linea desde={120} tam={40} color={C.ink}>29 de 30 días «bien»… y <b style={{ color: NARANJA }}>falla el único que importaba</b>.</Linea>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={1} habla={vol('n5', f)} derecha />
        <Turbo cx={780} pies={1600} escala={0.34} pose={{ cara: { ojos: fuego ? 'shock' : 'fastidio', cejas: fuego ? 'arriba' : undefined, boca: fuego ? 'grito' : 'mueca', parpado: fuego ? 0 : parpadeo(f, 50) }, brazos: fuego ? [40, -40] : [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n5']} />
    </AbsoluteFill>
  );
};

// ── 4 · Lo que debiste responder: le gano al baseline y mido el recall (cuántos fraudes reales atrapo).
const P1 = 44, P2 = 92, ATRAPA = 150;
const Respuesta: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const e1 = spring({ frame: f - P1, fps: 30, config: { damping: 14 } });
  const e2 = spring({ frame: f - P2, fps: 30, config: { damping: 14 } });
  const tarjeta = (e: number): React.CSSProperties => ({ position: 'absolute', left: 70, width: 940, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 26,
    padding: '26px 32px', boxShadow: '0 24px 70px #0007', opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 40}px)` });
  const barra = (txt: React.ReactNode, v: number, color: string, desde: number) => {
    const p = interpolate(f, [desde, desde + 20], [0, v], { ...clamp, easing: Easing.out(Easing.cubic) });
    return <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 30px/1 ${SANS}`, color: C.ink2 }}><span>{txt}</span><b style={{ color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(p)}%</b></div>
      <div style={{ marginTop: 10, height: 20, borderRadius: 10, background: '#ffffff12' }}><div style={{ width: `${Math.max(p, 0.8)}%`, height: '100%', borderRadius: 10, background: color }} /></div>
    </div>;
  };
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Lo que debiste responder" marcas={{ debiste: C.g }} desde={0} paso={3} tam={80} />
        </div>
        <div style={{ ...tarjeta(e1), top: 360 }}>
          <div style={{ font: `850 44px/1.1 ${SANS}`, color: C.ink }}><span style={{ color: VIVOS[2] }}>1 ·</span> «Le gano al baseline».</div>
          <div style={{ marginTop: 8, font: `500 30px/1.3 ${SANS}`, color: C.ink3 }}>Los dos sacan 99% de accuracy. Lo que los separa es esto:</div>
        </div>
        <div style={{ ...tarjeta(e2), top: 580 }}>
          <div style={{ font: `850 44px/1.1 ${SANS}`, color: C.ink }}><span style={{ color: VIVOS[2] }}>2 ·</span> «Mido el <span style={{ color: VIVOS[0] }}>recall</span>».</div>
          <div style={{ marginTop: 10, font: `500 34px/1.3 ${SANS}`, color: C.ink2 }}><b style={{ color: VIVOS[0] }}>Recall</b> = de los fraudes reales, cuántos atrapas.</div>
          <svg width={876} height={110} style={{ marginTop: 18, display: 'block' }}>
            {Array.from({ length: 10 }, (_, k) => {
              const x = 4 + k * 84, ok = k < 8, t = f - (ATRAPA + k * 4);
              const atrapado = ok && t >= 0;
              const se = !ok && t >= 0 ? interpolate(t, [0, 14], [0, 1], clamp) : 0;
              return <g key={k} transform={`translate(0 ${-se * 12})`} opacity={1 - se * 0.45}>
                <rect x={x} y={14} width={72} height={72} rx={14} fill={atrapado ? `${VERDE}33` : `${NARANJA}33`} stroke={atrapado ? VERDE : NARANJA} strokeWidth={4} />
                <text x={x + 36} y={64} textAnchor="middle" fontFamily={SANS} fontWeight={900} fontSize={36} fill={atrapado ? VERDE : NARANJA}>{atrapado ? '✓' : '!'}</text>
              </g>;
            })}
          </svg>
          {barra(<>Baseline («nunca es fraude»): 0 de 10</>, 0, NARANJA, ATRAPA - 10)}
          {barra(<>Tu modelo: 8 de 10</>, 80, VERDE, ATRAPA + 30)}
          <div style={{ marginTop: 14, font: `500 24px/1 ${MONO}`, color: C.ink3, opacity: interpolate(f, [ATRAPA + 40, ATRAPA + 50], [0, 1], clamp) }}>(cifras de ejemplo)</div>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1180, width: 940, textAlign: 'center' }}>
          <Linea desde={ATRAPA + 16} tam={38}>Cuando una clase es muy rara (<b style={{ color: C.ink }}>clases desbalanceadas</b>), la accuracy engaña.</Linea>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={0.6} habla={vol('n6', f)} derecha />
        <Turbo cx={780} pies={1600} escala={0.34} pose={{ cara: { ojos: 'normal', parpado: parpadeo(f, 70, 30), boca: 'normal' }, brazos: [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n6']} />
    </AbsoluteFill>
  );
};

// ── 5 · El remate: «¡Ahora todo es fraude!» El entrevistador se despide y se sale de la llamada.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const fuera = interpolate(f, [SALE, SALE + 10], [0, 1], clamp);
  const habla = Math.max(vol('t4', f), vol('t5', f));
  const cara = f < GRACIAS ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(habla) ?? 'normal' as const }
    : f < VOZ.t5 - 4 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(habla) ?? 'normal' as const, parpado: parpadeo(f, 40) };
  const brazos: [number, number] = f < GRACIAS ? [150, -150] : f >= VOZ.t5 - 4 ? [60, -10] : [20, -20];
  const salto = f < fin('t4') ? -Math.abs(Math.sin(f / 5)) * 24 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.b, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <Llamada y={240} alto={560} mensaje="Gracias. Nosotros te llamamos." desde={GRACIAS} fuera={fuera} />
        <div style={{ position: 'absolute', left: 70, top: 830, width: 940, textAlign: 'center' }}>
          <Linea desde={fin('t4') + 4} tam={36}>Recall 100%… y <b style={{ color: NARANJA }}>99 clientes bloqueados</b> sin razón.</Linea>
        </div>
        <Turbo cx={540} pies={1590 + salto} escala={0.5} pose={{ cara, brazos }} />
        <DebugEntra desde={VOZ.d2 - 16} y={1430} ceja={1} habla={vol('d2', f)} />
        <Burbuja quien="turbo" x={240} y={930} ancho={640} desde={VOZ.t4} hasta={fin('t4') + 2} cola={300}>¡Fácil! ¡Ahora TODO es fraude!</Burbuja>
        <Burbuja quien="turbo" x={360} y={960} ancho={480} desde={VOZ.t5} cola={180}>¿Eso es un sí?</Burbuja>
        <Burbuja quien="debug" x={70} y={1250} ancho={190} desde={VOZ.d2} cola={80}>No.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 't5', 'd2']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="presume-99" color={C.g} frase={<>Baseline, recall y más, <span style={{ color: VIVOS[2] }}>explicado desde cero</span></>} />
    <Voces ids={['n7']} />
  </AbsoluteFill>
);

export const ReelPresume99: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, baseline: Baseline, detector: Detector, respuesta: Respuesta, remate: Remate, cierre: CierreEscena }} />
);
