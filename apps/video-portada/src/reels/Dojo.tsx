// Reel 04 · Dojo: «Constrúyelo. Rómpelo. Arréglalo.»
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, ETAPAS } from '../tema';
import { Fondo, Marca, Punto, Ventana } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Reel, useSalida, VIVOS } from './kit';

const URL = 'dojo.trueml.app';

const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  // la T se enciende pieza por pieza, de datos a monitoreo
  const brillo = ETAPAS.map((_, i) => interpolate(f, [76 + i * 7, 84 + i * 7], [0, 1], clamp));
  const lineas = [
    { t: 'Constrúyelo.', c: C.g, d: -6 },
    { t: 'Rómpelo.', c: C.o, d: 30 },
    { t: 'Arréglalo.', c: C.b, d: 60 },
  ];
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.9} colores={[C.g, C.o, C.b, C.g, C.p, C.y]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Dojo · práctica" color={C.g} desde={-20} />
          <div style={{ marginTop: 30, display: 'grid', gap: 18 }}>
            {lineas.map((l) => <Gancho key={l.t} texto={l.t} marcas={{ [l.t.replace('.', '')]: l.c }} desde={l.d} tam={132} />)}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 900, display: 'flex', justifyContent: 'center', filter: `drop-shadow(0 30px 90px ${C.g}55)`,
          transform: `scale(${interpolate(f, [0, 150], [0.94, 1.04])})` }}>
          <Marca id="m-dojo-gancho" alto={620} brillo={brillo} etiquetas />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Mapa: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Del dato al monitoreo, estación por estación." marcas={{ dato: C.yt, monitoreo: '#9AA6D6' }} desde={6} paso={3} tam={88} />
        </div>
        <Ventana url={URL} ancho={1000} x={40} y={640} desde={2} giro={[6, 1]} proporcion={0.68} color={C.g}
          clips={[{ src: 'dojo-inicio', desde: 0.2, vel: 1.2, dur: 240, cam: [{ f: 0, z: 1.3, x: 0.4, y: 0.42 }, { f: 120, z: 1.2, x: 0.5, y: 0.5 }, { f: 240, z: 1.45, x: 0.5, y: 0.45 }] }]} />
        <div style={{ position: 'absolute', left: 70, width: 860, top: 1395, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {ETAPAS.map((et, i) => <Chip key={et.id} texto={et.nombre} color={VIVOS[i]} desde={60 + i * 20} activo={interpolate(f, [65 + i * 20, 67 + i * 20], [0, 1], clamp)} tam={28} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Estacion: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Cada estación es un mini-proyecto." marcas={{ 'mini-proyecto': C.g }} desde={6} paso={3} tam={92} />
        </div>
        <Ventana url={URL + '/c01/datos/'} ancho={1000} x={40} y={560} desde={2} giro={[-6, -1]} proporcion={0.64} color={C.g}
          clips={[{ src: 'dojo-estacion', desde: 0.0, vel: 0.8, dur: 210, cam: [{ f: 0, z: 1.35, x: 0.32, y: 0.38 }, { f: 210, z: 1.5, x: 0.3, y: 0.4 }] }]} />
        <div style={{ position: 'absolute', left: 70, width: 860, top: 1300, display: 'grid', gap: 22 }}>
          {['Lo construyes con Claude Code', 'Lo rehaces solo', 'Lo arreglas cuando se rompe'].map((t, i) => (
            <div key={t} style={{ transform: 'scale(1.25)', transformOrigin: 'left center' }}><Punto texto={t} desde={60 + i * 30} color={[C.g, C.yt, C.o][i]} /></div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelDojo: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id="04-dojo" sonido={sonido} escenas={{
    gancho: GanchoEscena, mapa: Mapa, estacion: Estacion,
    cierre: () => <Cierre id="dojo" color={C.g} frase={<><span style={{ color: '#2FD3A0' }}>El Dojo</span> es gratis</>} />,
  }} />
);

