// Reel 03 · Sensei: «¿Cómo lee un LLM esta frase?».
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, ETAPAS, SANS } from '../tema';
import { Fondo, useEntrada, Ventana } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';

const URL = 'sensei.trueml.app/llms/';

const GanchoEscena: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.8} colores={[C.y, C.b, C.y, C.p, C.y, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <Ventana url={URL} ancho={1000} x={40} y={780} desde={-30} giro={[-5, 0]} proporcion={0.76} color={C.yt}
          clips={[{ src: 'sensei-tokens', desde: 0.1, vel: 1.0, dur: 200, cam: [{ f: 0, z: 1.75, x: 0.45, y: 0.3 }, { f: 165, z: 1.55, x: 0.45, y: 0.38 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Sensei · teoría" color={C.yt} desde={-20} />
          <Gancho texto="¿Cómo lee un LLM esta frase?" marcas={{ LLM: C.yt }} desde={-10} paso={3} tam={112} style={{ marginTop: 28 }} />
          <Linea desde={66} style={{ marginTop: 22 }}>No ve palabras: <b style={{ color: C.yt }}>ve tokens.</b></Linea>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Calc: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Mueve los números. Mira qué pasa." marcas={{ números: C.yt }} desde={6} paso={3} tam={96} />
          <Linea desde={60} style={{ marginTop: 22 }}>Calculadoras dentro de las lecciones.</Linea>
        </div>
        <Ventana url={URL} ancho={1000} x={40} y={720} desde={2} giro={[6, 1]} proporcion={0.78} color={C.yt}
          clips={[{ src: 'sensei-calc', desde: 1.0, vel: 1.5, dur: 210, cam: [{ f: 0, z: 1.5, x: 0.45, y: 0.36 }, { f: 210, z: 1.6, x: 0.45, y: 0.45 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 1500 }}><Chip texto="¿Cuánto tarda una respuesta?" color={C.yt} desde={95} tam={32} /></div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Glosario: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="¿Una palabra nueva? Se explica ahí mismo." marcas={{ ahí: C.g, mismo: C.g }} desde={6} paso={3} tam={96} />
        </div>
        <Ventana url={URL} ancho={1000} x={40} y={720} desde={2} giro={[-6, -1]} proporcion={0.78} color={C.g}
          clips={[{ src: 'sensei-glosario', desde: 0.9, vel: 1.0, dur: 150, cam: [{ f: 0, z: 1.3, x: 0.42, y: 0.62 }, { f: 40, z: 1.7, x: 0.38, y: 0.7 }, { f: 150, z: 1.8, x: 0.38, y: 0.7 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 1500 }}><Chip texto="Glosario integrado" color={C.g} desde={55} tam={32} /></div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Cifras: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const n = Math.round(interpolate(f, [8, 60], [0, 59], clamp));
  const e = useEntrada(4, 14);
  return (
    <AbsoluteFill>
      <Aurora fuerza={1} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 260, textAlign: 'center', opacity: e }}>
          <div style={{ font: `850 360px/0.9 ${SANS}`, letterSpacing: '-0.06em', color: C.yt, textShadow: `0 0 120px ${C.y}88`, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
          <div style={{ marginTop: 10, font: `800 92px/1 ${SANS}`, letterSpacing: '-0.04em', color: C.ink }}>lecciones</div>
          <Linea desde={30} tam={46} style={{ marginTop: 26 }}>Desde cero, de lo básico a producción.</Linea>
        </div>
        <div style={{ position: 'absolute', left: 70, right: 140, top: 1040, display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
          {ETAPAS.map((et, i) => <Chip key={et.id} texto={et.nombre} color={VIVOS[i]} desde={10 + i * 8} activo={interpolate(f, [12 + i * 8, 14 + i * 8], [0, 1], clamp)} tam={34} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelSensei: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id="03-sensei" sonido={sonido} escenas={{
    gancho: GanchoEscena, calc: Calc, glosario: Glosario, cifras: Cifras,
    cierre: () => <Cierre id="sensei" color={C.yt} frase={<><span style={{ color: C.yt }}>Sensei</span> es gratis</>} />,
  }} />
);
