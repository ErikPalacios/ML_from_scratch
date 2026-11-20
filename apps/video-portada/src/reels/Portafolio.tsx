// Reel 15 · «Cuando tu portafolio son 5 notebooks del Titanic».
// Turbo presume sus notebooks de tutorial; el reclutador les da unos 7 segundos (estudio de eye-tracking de Ladders,
// 2018: 7.4 s en la primera revisión de un CV) y esos mismos notebooks los tienen miles. Debug: lo que sí ayuda es un
// proyecto completo y propio (problema real, link que se pueda probar, README con resultado, código ordenado).
// Remate: el «proyecto original» de Turbo es otro Titanic… con icebergs. Con voz, igual que los reels 08 y 09.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/15-portafolio.tiempos.json';

const ID = '15-portafolio';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 82, n2: 224, t2: 352,
  n3: 4,
  n4: 4, n5: 80, n6: 176, n7: 304, t3: 422,
  t4: 4, d1: 66, t5: 88,
  n8: 12,
};
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

/** Un iceberg chiquito (para el «proyecto original» de Turbo). */
const Iceberg: React.FC<{ tam: number }> = ({ tam }) => (
  <svg width={tam} height={tam} viewBox="0 0 60 60" style={{ flex: 'none' }}>
    <path d="M8 36 L22 12 L30 22 L38 8 L52 36 Z" fill="#E8F4FF" stroke="#9ED0FF" strokeWidth={2.5} strokeLinejoin="round" />
    <path d="M4 36 L56 36 L46 54 L14 54 Z" fill="#7C93FF55" />
    <path d="M2 36 Q10 32 18 36 T34 36 T50 36 T58 36" stroke="#7C93FF" strokeWidth={3} fill="none" />
  </svg>
);

const ARCHIVOS = ['titanic.ipynb', 'iris.ipynb', 'mnist.ipynb', 'titanic_v2.ipynb', 'titanic_final_final.ipynb'];

/** La ventana «tu repo» con los notebooks. `luz[i]` (0..1) enciende cada fila; `tachado` (0..1) los marca como vistos. */
const Repo: React.FC<{ x: number; y: number; w: number; luz: number[]; tachado?: number; extra?: React.ReactNode; tenue?: number }> =
  ({ x, y, w, luz, tachado = 0, extra, tenue = 1 }) => (
    <div style={{ position: 'absolute', left: x, top: y, width: w, background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `600 26px/1 ${MONO}`, color: C.ink3 }}>
        {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
        <span style={{ marginLeft: 14 }}>tu repo / portafolio</span>
      </div>
      <div style={{ padding: '10px 0' }}>
        {ARCHIVOS.map((a, i) => (
          <div key={a} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 18, padding: '12px 30px', opacity: tenue,
            background: `rgba(124,147,255,${0.16 * luz[i]})`, font: `600 36px/1.2 ${MONO}`, color: luz[i] > 0.5 ? C.ink : C.ink2 }}>
            <span style={{ width: 30, height: 36, borderRadius: 5, background: a.startsWith('titanic') ? '#FF8A5C' : '#7C93FF', opacity: 0.85, flex: 'none' }} />
            {a}
            {tachado > 0 && <i style={{ position: 'absolute', left: 80, top: '52%', height: 5, borderRadius: 3, background: '#FF8A5C', width: `${Math.min(1, Math.max(0, tachado * 5 - i)) * 620}px` }} />}
          </div>
        ))}
        {extra}
      </div>
    </div>
  );

// ── 1 · El gancho: Turbo presume sus notebooks; el reclutador los pasa en 7 segundos y los mismos los tienen miles.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const luz = [95, 125, 125, 182, 196].map((s) => interpolate(f, [s, s + 6], [0, 1], clamp) * interpolate(f, [VOZ.n2, VOZ.n2 + 8], [1, 0.25], clamp));
  // La revisión del reclutador: 7 → 0 en un segundo y medio, y la lista se tacha.
  const reloj = interpolate(f, [VOZ.n2 + 6, VOZ.n2 + 66], [7, 0], clamp);
  const tachado = interpolate(f, [VOZ.n2 + 6, VOZ.n2 + 66], [0, 1], clamp);
  const eReloj = interpolate(f, [VOZ.n2, VOZ.n2 + 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
  // «Los tienen miles»: copias de la ventana que se abren en abanico detrás.
  const copias = interpolate(f, [VOZ.n2 + 70, VOZ.n2 + 100], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const presume = f >= VOZ.t1 - 4 && f < VOZ.n2;
  const shock = f >= VOZ.t2 - 4;
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t1) / 6)) * 26 : 0;
  const temblor = shock && f < VOZ.t2 + 30 ? Math.sin(f * 3.1) * 7 : 0;
  const cara = presume ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'normal' as const }
    : shock ? { ojos: 'shock' as const, cejas: 'enojado' as const, boca: boca(vol('t2', f)) ?? 'mueca' as const, cachetes: 1.1 }
    : f >= VOZ.n2 ? { ojos: 'normal' as const, parpado: parpadeo(f, 60, 10) }
    : { parpado: parpadeo(f, 70), boca: 'normal' as const };
  const brazos: [number, number] = presume ? [150, -150] : shock ? [40, -40] : [0, 0];
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.o, C.b, C.y, C.p, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Cuando tu portafolio son 5 notebooks del Titanic" marcas={{ '5': C.o, Titanic: C.b }} desde={-14} paso={2} tam={86} />
        </div>
        {[4, 3, 2, 1, -1, -2].map((k) => (
          <div key={k} style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, opacity: copias * (0.75 - Math.abs(k) * 0.12),
            transform: `translate(${copias * k * 30}px, ${copias * Math.abs(k) * 22}px) rotate(${copias * k * 3}deg) scale(${1 - copias * Math.abs(k) * 0.03})`, transformOrigin: '540px 760px' }}>
            <Repo x={70} y={560} w={940} luz={[0, 0, 0, 0, 0]} />
          </div>
        ))}
        <Repo x={70} y={560} w={940} luz={luz} tachado={tachado} />
        {/* El reloj del reclutador */}
        <div style={{ position: 'absolute', right: 70, top: 470, opacity: eReloj * interpolate(f, [VOZ.n2 + 70, VOZ.n2 + 84], [1, 0], clamp),
          transform: `scale(${0.6 + 0.4 * eReloj})`, transformOrigin: '100% 50%', display: 'flex', alignItems: 'center', gap: 16,
          padding: '14px 24px', borderRadius: 999, background: '#0B0F1F', border: '4px solid #FF8A5C', boxShadow: '0 0 50px #FF8A5C66' }}>
          <span style={{ font: `700 26px/1 ${MONO}`, color: C.ink2, letterSpacing: '0.06em' }}>RECLUTADOR</span>
          <span style={{ font: `850 54px/1 ${MONO}`, color: '#FF8A5C', fontVariantNumeric: 'tabular-nums' }}>{reloj.toFixed(1)} s</span>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1030, width: 940, textAlign: 'center', opacity: interpolate(f, [VOZ.t2 - 6, VOZ.t2], [1, 0], clamp) }}>
          <Linea desde={VOZ.n2 + 4} tam={42} color={C.ink}>≈ <b style={{ color: '#FF8A5C' }}>7 segundos</b>: la primera revisión de un CV.</Linea>
          <Linea desde={VOZ.n2 + 74} tam={40} style={{ marginTop: 8 }}>Y esos mismos notebooks los tienen <b style={{ color: C.ink }}>miles</b>.</Linea>
        </div>
        <Turbo cx={640 + temblor} pies={1590 + salto} escala={0.5} pose={{ cara, brazos }} />
        <Debug x={60} y={1415} escala={1.15} ceja={interpolate(f, [VOZ.n2, VOZ.n2 + 8], [0, 0.8], clamp)} habla={Math.max(vol('n1', f), vol('n2', f))} derecha />
        <Burbuja quien="turbo" x={200} y={1020} ancho={740} desde={VOZ.t1} hasta={fin('t1') + 4} cola={440} tam={50}>¡Mírelos! Titanic, iris… ¡y el Titanic final final!</Burbuja>
        <Burbuja quien="turbo" x={330} y={1060} ancho={600} desde={VOZ.t2} cola={310}>¿¡SIETE!? ¡Tardé una semana!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 'n2', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · La analogía: cinco maquetas armadas con el mismo instructivo.
const Casita: React.FC<{ e: number; color: string }> = ({ e, color }) => (
  <svg width={136} height={136} viewBox="0 0 100 100" style={{ opacity: e, transform: `translateY(${(1 - e) * 40}px) scale(${0.7 + 0.3 * e})` }}>
    <path d="M14 46 L50 16 L86 46" fill="none" stroke={color} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
    <rect x={22} y={44} width={56} height={44} rx={4} fill={`${color}33`} stroke={color} strokeWidth={5} />
    <rect x={44} y={62} width={14} height={26} fill={color} />
    <rect x={30} y={54} width={10} height={10} fill={color} opacity={0.7} />
    <rect x={62} y={54} width={10} height={10} fill={color} opacity={0.7} />
  </svg>
);

const Maquetas: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const hoja = interpolate(f, [8, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Debug explica" color={C.yt} desde={0} />
          <Gancho texto="Un arquitecto con 5 maquetas del mismo instructivo." marcas={{ mismo: C.o }} desde={2} paso={2} tam={80} style={{ marginTop: 24 }} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 720, width: 940, display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ width: 170, height: 220, borderRadius: 14, background: '#F4F6FF', boxShadow: '0 20px 50px #0008', padding: 18, flex: 'none',
            opacity: hoja, transform: `rotate(${-6 * hoja}deg) scale(${0.6 + 0.4 * hoja})` }}>
            <div style={{ font: `800 20px/1.1 ${MONO}`, color: '#1A1A2E' }}>INSTRUCTIVO</div>
            {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} style={{ marginTop: 14, height: 9, borderRadius: 5, background: '#1A1A2E33', width: `${90 - (k % 3) * 18}%` }} />)}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[0, 1, 2, 3, 4].map((k) => <Casita key={k} e={interpolate(f, [16 + k * 5, 28 + k * 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) })} color={VIVOS[3]} />)}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1130, width: 940, textAlign: 'center' }}>
          <Linea desde={40} tam={46} color={C.ink}>Prueba que sabes <b style={{ color: VIVOS[3] }}>seguir pasos</b>.</Linea>
          <Linea desde={56} tam={40} style={{ marginTop: 10 }}>No que sabes <b style={{ color: C.ink }}>resolver un problema</b>.</Linea>
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={vol('n3', f)} derecha />
      </AbsoluteFill>
      <Voces ids={['n3']} />
    </AbsoluteFill>
  );
};

// ── 3 · Lo que sí ayuda: cuatro tarjetas que se van palomeando.
const PUNTOS: { titulo: string; sub: React.ReactNode; voz: Linea }[] = [
  { titulo: 'Un problema real, y tuyo', sub: <>No el dataset del tutorial.</>, voz: 'n4' },
  { titulo: 'Completo, con un link', sub: <>Que cualquiera lo pueda <b style={{ color: C.ink }}>probar</b>.</>, voz: 'n5' },
  { titulo: 'Un README con resultado', sub: <>Qué resolviste, cómo y <b style={{ color: C.ink }}>con qué cifra</b>.</>, voz: 'n6' },
  { titulo: 'Código ordenado', sub: <>No un notebook de <b style={{ color: C.ink }}>300 celdas</b>.</>, voz: 'n7' },
];

const Ayuda: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const habla = Math.max(...PUNTOS.map((p) => vol(p.voz, f)));
  const duda = f >= VOZ.t3 - 4;
  const cara = duda ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t3', f)) ?? 'normal' as const, cachetes: 1.08 }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 20) };
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Lo que sí ayuda: un proyecto completo y propio" marcas={{ completo: C.g, propio: C.y }} desde={0} paso={2} tam={74} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 470, width: 940, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {PUNTOS.map((p, i) => {
            const s = VOZ[p.voz];
            const e = interpolate(f, [s, s + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
            const activo = f >= s && (i === 3 || f < VOZ[PUNTOS[i + 1].voz]);
            const check = interpolate(f, [s + 8, s + 22], [0, 1], clamp);
            const col = VIVOS[[0, 2, 3, 4][i]];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '18px 30px', borderRadius: 26,
                background: activo ? `${C.card}f8` : `${C.card}c0`, border: `3px solid ${activo ? col : C.line}`, boxShadow: activo ? `0 0 50px ${col}44` : 'none',
                opacity: e, transform: `translateX(${(1 - e) * 60}px)` }}>
                <svg width={78} height={78} viewBox="0 0 78 78" style={{ flex: 'none' }}>
                  <circle cx={39} cy={39} r={34} fill={`${col}22`} stroke={col} strokeWidth={5} />
                  <path d="M22 40 L34 52 L57 27" stroke={col} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={60} strokeDashoffset={60 * (1 - check)} />
                </svg>
                <div>
                  <div style={{ font: `800 46px/1.1 ${SANS}`, letterSpacing: '-0.02em', color: C.ink }}>{p.titulo}</div>
                  <div style={{ marginTop: 8, font: `500 34px/1.25 ${SANS}`, color: C.ink2 }}>{p.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={habla} derecha />
        <Turbo cx={760} pies={1600} escala={0.42} pose={{ cara, brazos: duda ? [20, -20] : [-10, 10] }} />
        <Burbuja quien="turbo" x={400} y={1112} ancho={530} desde={VOZ.t3} cola={360} tam={50}>¿300 es mucho?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n4', 'n5', 'n6', 'n7', 't3']} />
    </AbsoluteFill>
  );
};

// ── 4 · El remate: el «proyecto 100 % original» de Turbo es otro Titanic… con icebergs.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const nuevo = interpolate(f, [VOZ.t4 + 10, VOZ.t4 + 24], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
  const enojo = f >= VOZ.t5 - 4;
  const cara = enojo ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t5', f)) ?? 'mueca' as const, cachetes: 1.1 }
    : f >= VOZ.d1 ? { ojos: 'normal' as const, parpado: parpadeo(f, 50, 5) }
    : { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t4', f)) ?? 'normal' as const };
  const brazos: [number, number] = enojo ? [44, -44] : f < VOZ.d1 ? [150, -150] : [0, 0];
  const temblor = enojo && f < VOZ.t5 + 30 ? Math.sin(f * 3.1) * 7 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.b, C.p, C.o, C.b, C.g, C.y]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Chip texto="Proyecto nuevo de Turbo" color={C.o} desde={0} tam={32} />
        </div>
        <Repo x={70} y={340} w={940} luz={[0, 0, 0, 0, 0]} tenue={0.4} extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '6px 16px 6px', padding: '14px 16px', borderRadius: 16,
            background: '#7C93FF26', border: '3px solid #9ED0FF', opacity: nuevo, transform: `scale(${0.7 + 0.3 * nuevo})`, transformOrigin: '10% 50%',
            font: `700 34px/1.2 ${MONO}`, color: C.ink }}>
            <Iceberg tam={52} />titanic_v6_con_icebergs.ipynb
          </div>
        } />
        <Turbo cx={600 + temblor} pies={1590} escala={0.55} pose={{ cara, brazos }} />
        <DebugEntra desde={VOZ.d1 - 16} y={1415} ceja={1} habla={vol('d1', f)} />
        <Burbuja quien="turbo" x={220} y={940} ancho={720} desde={VOZ.t4} hasta={VOZ.d1 - 2} cola={380}>¡Listo! Proyecto 100% original.</Burbuja>
        <Burbuja quien="debug" x={70} y={1220} ancho={300} desde={VOZ.d1} hasta={VOZ.t5 + 30} cola={90}>Turbo…</Burbuja>
        <Burbuja quien="turbo" x={310} y={940} ancho={620} desde={VOZ.t5} cola={290}>¿¡QUÉ!? ¡Tiene icebergs!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 'd1', 't5']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="portafolio" color={C.o} frase={<>Un proyecto completo, <span style={{ color: VIVOS[2] }}>paso a paso</span>, en el Dojo</>} />
    <Voces ids={['n8']} />
  </AbsoluteFill>
);

export const ReelPortafolio: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, maquetas: Maquetas, ayuda: Ayuda, remate: Remate, cierre: CierreEscena }} />
);
