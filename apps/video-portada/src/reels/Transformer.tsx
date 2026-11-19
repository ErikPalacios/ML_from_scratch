// Reel 02 · Laboratorio Transformer: «Esto es un transformer aprendiendo».
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../tema';
import { Fondo, Ventana } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida } from './kit';

const URL = 'laboratorio-transformer.vercel.app';

const GanchoEscena: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.8} colores={[C.o, C.y, C.o, C.b, C.p, C.o]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <Ventana url={URL} ancho={1000} x={40} y={800} desde={-30} giro={[-5, 0]} proporcion={0.74} color={C.o}
          clips={[{ src: 'transformer', desde: 5.2, vel: 0.9, dur: 200, cam: [{ f: 0, z: 1.5, x: 0.36, y: 0.42 }, { f: 160, z: 1.25, x: 0.42, y: 0.45 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Laboratorio Transformer" color={C.o} desde={-20} />
          <Gancho texto="Esto es un transformer aprendiendo." marcas={{ transformer: C.o }} desde={-10} paso={3} tam={112} style={{ marginTop: 28 }} />
          <Linea desde={44} style={{ marginTop: 24 }}>Operación por operación. <b style={{ color: C.ink }}>En tu navegador.</b></Linea>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PASOS = [
  { t: 'Forward', c: C.y },
  { t: 'Pérdida', c: C.o },
  { t: 'Backward', c: C.g },
  { t: 'Actualización', c: C.b },
];

const Pasos: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.o} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Cada matriz, con su fórmula y sus dimensiones." marcas={{ fórmula: C.yt, dimensiones: C.g }} desde={6} paso={3} tam={84} />
          <div style={{ marginTop: 36, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {PASOS.map((p, i) => <Chip key={p.t} texto={p.t} color={p.c} desde={30 + i * 6} activo={interpolate(f, [40 + i * 40, 44 + i * 40], [0, 1], clamp)} tam={32} />)}
          </div>
        </div>
        <Ventana url={URL + '/#paso'} ancho={1000} x={40} y={720} desde={2} giro={[6, 1]} proporcion={0.8} color={C.o}
          clips={[{ src: 'transformer', desde: 0.4, vel: 1.45, dur: 240, cam: [{ f: 0, z: 1.3, x: 0.3, y: 0.35 }, { f: 90, z: 1.45, x: 0.4, y: 0.45 }, { f: 240, z: 1.3, x: 0.5, y: 0.45 }] }]} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Entrena: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Cientos de iteraciones. Mira cómo baja la pérdida." marcas={{ baja: C.g }} desde={6} paso={3} tam={84} />
        </div>
        <Ventana url={URL + '/#entrenamiento'} ancho={1000} x={40} y={640} desde={2} giro={[-6, -1]} proporcion={0.8} color={C.g}
          clips={[{ src: 'transformer-entrena', desde: 1.0, vel: 1.5, dur: 195, cam: [{ f: 0, z: 1.55, x: 0.3, y: 0.55 }, { f: 195, z: 1.35, x: 0.35, y: 0.55 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 1500 }}>
          <Chip texto="Todo se calcula en tu navegador" color={C.g} desde={35} tam={32} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelTransformer: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id="02-transformer" sonido={sonido} escenas={{ gancho: GanchoEscena, pasos: Pasos, entrena: Entrena, cierre: () => <Cierre id="transformer" color={C.o} frase={<><span style={{ color: '#FF8A5C' }}>El Laboratorio Transformer</span> es gratis</>} /> }} />
);
