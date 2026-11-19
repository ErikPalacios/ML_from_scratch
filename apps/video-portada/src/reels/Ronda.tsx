// Reel 06 · Ronda de Diseño ML: «Tienes 45 minutos para diseñar un sistema de ML».
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, Punto, useEntrada, Ventana } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Reel, useSalida, VIVOS } from './kit';

const URL = 'ronda.trueml.app';
const AZUL = '#7C93FF';
// el framework de 7 pasos de la Ronda (apps/ml-system-design/js/core/registry.js), con sus minutos
const PASOS = [
  { t: 'Aclarar el problema', de: 0, a: 5 },
  { t: 'Requisitos y métricas', de: 5, a: 10 },
  { t: 'Estimaciones', de: 10, a: 15 },
  { t: 'Arquitectura de alto nivel', de: 15, a: 25 },
  { t: 'Deep dives', de: 25, a: 37 },
  { t: 'Evaluación, despliegue y monitoreo', de: 37, a: 42 },
  { t: 'Fallas, trade-offs y cierre', de: 42, a: 45 },
];
const COL7 = [...VIVOS.slice(0, 5), '#9AA6D6', C.acc];

/** Reloj de 45:00 que corre en tiempo real, con un anillo de los siete pasos. */
const Reloj: React.FC<{ tam: number }> = ({ tam }) => {
  const f = useCurrentFrame();
  const seg = 45 * 60 - Math.floor(f / 30);
  const mm = String(Math.floor(seg / 60)).padStart(2, '0'), ss = String(seg % 60).padStart(2, '0');
  const r = tam / 2 - 26, cir = 2 * Math.PI * r;
  const late = 1 + 0.025 * Math.max(0, 1 - (f % 30) / 8);
  let acc = 0;
  return (
    <div style={{ position: 'relative', width: tam, height: tam, transform: `scale(${late})` }}>
      <svg width={tam} height={tam} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke={C.line} strokeWidth={30} />
        {PASOS.map((p, i) => {
          const largo = ((p.a - p.de) / 45) * cir, ini = acc; acc += largo;
          return <circle key={p.t} cx={tam / 2} cy={tam / 2} r={r} fill="none" stroke={COL7[i]} strokeWidth={30}
            strokeDasharray={`${Math.max(0, largo - 8)} ${cir}`} strokeDashoffset={-ini} style={{ filter: `drop-shadow(0 0 12px ${COL7[i]}88)` }} />;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div style={{ font: `800 ${tam * 0.27}px/1 ${MONO}`, letterSpacing: '-0.04em', color: C.ink, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 60px ${C.b}` }}>{mm}:{ss}</div>
          <div style={{ marginTop: 16, font: `600 30px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.1em' }}>EN MARCHA</div>
        </div>
      </div>
    </div>
  );
};

const GanchoEscena: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.8} colores={[C.b, C.p, C.b, C.y, C.b, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Ronda de Diseño ML" color={AZUL} desde={-20} />
          <Gancho texto="Tienes 45 minutos para diseñar un sistema de ML." marcas={{ 45: C.yt, minutos: C.yt }} desde={-10} paso={3} tam={100} style={{ marginTop: 28 }} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 840, display: 'flex', justifyContent: 'center' }}><Reloj tam={620} /></div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Pasos: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  // el minuto que «va» el reloj: 45 min en 7 × 20 frames
  const minuto = interpolate(f, [15, 155], [0, 45], clamp);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="7 pasos. El reloj te dice en cuál deberías ir." marcas={{ 7: C.yt, pasos: C.yt }} desde={4} paso={3} tam={84} />
        </div>
        <div style={{ position: 'absolute', left: 70, width: 860, top: 650, display: 'grid', gap: 18 }}>
          {PASOS.map((p, i) => <FilaPaso key={p.t} i={i} p={p} minuto={minuto} />)}
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1500, font: `700 40px/1 ${MONO}`, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
          minuto <span style={{ color: C.yt }}>{String(Math.floor(minuto)).padStart(2, '0')}</span> / 45
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FilaPaso: React.FC<{ i: number; p: (typeof PASOS)[number]; minuto: number }> = ({ i, p, minuto }) => {
  const e = useEntrada(4 + i * 3, 16);
  const lleno = Math.max(0, Math.min(1, (minuto - p.de) / (p.a - p.de)));
  const activo = minuto >= p.de && minuto < p.a + 0.01;
  const c = COL7[i];
  return (
    <div style={{ opacity: e, transform: `translateX(${(1 - e) * 60}px)` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, font: `${activo ? 800 : 600} 34px/1.1 ${SANS}`, color: activo ? C.ink : C.ink2 }}>
        <span style={{ font: `700 28px/1 ${MONO}`, color: c }}>{i + 1}</span>{p.t}
        <span style={{ marginLeft: 'auto', font: `500 24px/1 ${MONO}`, color: C.ink3 }}>{p.de}–{p.a}′</span>
      </div>
      <div style={{ marginTop: 8, height: 14, borderRadius: 7, background: C.line, width: `${12 + ((p.a - p.de) / 12) * 88}%`, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${lleno * 100}%`, background: c, boxShadow: `0 0 20px ${c}` }} />
      </div>
    </div>
  );
};

const Caso: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Un caso real, con el reloj corriendo." marcas={{ reloj: C.yt }} desde={4} paso={3} tam={92} />
        </div>
        <Ventana url={URL + '/#practica-c01'} ancho={1000} x={40} y={600} desde={2} giro={[6, 1]} proporcion={0.62} color={C.b}
          clips={[{ src: 'ronda', desde: 0.2, vel: 0.95, dur: 210, cam: [{ f: 0, z: 1.2, x: 0.52, y: 0.32 }, { f: 210, z: 1.35, x: 0.6, y: 0.3 }] }]} />
        <div style={{ position: 'absolute', left: 70, width: 860, top: 1300, display: 'grid', gap: 22 }}>
          {['El framework de 7 pasos a la vista', 'Autoevaluación con rúbrica', 'Y la solución, al final'].map((t, i) => (
            <div key={t} style={{ transform: 'scale(1.25)', transformOrigin: 'left center' }}><Punto texto={t} desde={90 + i * 30} color={[AZUL, C.yt, C.g][i]} /></div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelRonda: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id="06-ronda" sonido={sonido} escenas={{
    gancho: GanchoEscena, pasos: Pasos, ronda: Caso,
    cierre: () => <Cierre id="ronda" color={C.b} frase={<><span style={{ color: AZUL }}>La Ronda</span> es gratis</>} />,
  }} />
);

