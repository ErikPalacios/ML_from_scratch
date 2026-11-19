// Reel 07 · Cheat sheets y tablero: «La noche antes de la entrevista».
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from '../tema';
import { Fondo, Ventana } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, COLORES, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';

// las nueve hojas (apps/cheat-sheets/sheets.json), con nombres cortos
const HOJAS = ['Estimaciones', 'Docker', 'Kubernetes', 'Del dato a producción', 'Git y GitHub Actions', 'De PyTorch a Triton', 'FastAPI en producción', 'Prometheus y Grafana', 'Serving con vLLM'];

const Baraja: React.FC<{ desde: number; paso: number }> = ({ desde, paso }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', left: 70, top: 640, width: 880 }}>
      {HOJAS.map((h, i) => {
        const s = spring({ frame: f - desde - i * paso, fps, config: { damping: 14, mass: 0.7, stiffness: 150 } });
        const c = COLORES[i % 6];
        const giro = (i % 2 ? 1 : -1) * (2 + (i % 3));
        return (
          <div key={h} style={{ position: 'absolute', left: (i % 3) * 18, top: i * 92, width: 840, height: 150, borderRadius: 22, background: C.card,
            border: `2px solid ${c}`, boxShadow: `0 30px 60px -20px rgba(0,0,0,.8), 0 0 40px -10px ${c}88`, overflow: 'hidden',
            opacity: Math.min(1, s * 1.4), transform: `translateX(${(1 - s) * 900}px) rotate(${giro * (1 - s) * 3 + giro * 0.3}deg)`, zIndex: i }}>
            <div style={{ height: 10, background: c }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, padding: '18px 30px' }}>
              <span style={{ font: `700 30px/1 ${MONO}`, color: c }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ font: `800 44px/1.05 ${SANS}`, letterSpacing: '-0.03em', color: C.ink }}>{h}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const GanchoEscena: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.9} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Cheat sheets" color={C.yt} desde={-20} />
          <Gancho texto="La noche antes de la entrevista:" marcas={{ noche: C.yt }} desde={-10} paso={3} tam={106} style={{ marginTop: 28 }} />
        </div>
        <Baraja desde={22} paso={8} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Hojas: React.FC = () => {
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="9 cheat sheets para repasar rápido." marcas={{ 9: C.yt, cheat: C.yt, sheets: C.yt }} desde={4} paso={3} tam={92} />
          <Linea desde={40} style={{ marginTop: 20 }}>Números, comandos y fórmulas, al grano. <b style={{ color: C.ink }}>En la web y en PDF.</b></Linea>
        </div>
        <Ventana url="hojas.trueml.app/docker/" ancho={1000} x={40} y={760} desde={2} giro={[6, 1]} proporcion={0.78} color={C.y}
          clips={[{ src: 'hojas', desde: 0.2, vel: 1.0, dur: 195, cam: [{ f: 0, z: 1.45, x: 0.3, y: 0.35 }, { f: 195, z: 1.5, x: 0.45, y: 0.4 }] }]} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Tablero: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.p} tinte2={C.g} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <App texto="Tablero de proyectos" color={VIVOS[4]} desde={0} />
          <Gancho texto="Y tu proyecto, como un mapa de metro." marcas={{ metro: VIVOS[4], 'metro.': VIVOS[4] }} desde={6} paso={3} tam={92} style={{ marginTop: 24 }} />
        </div>
        <Ventana url="tablero.trueml.app" ancho={1000} x={40} y={680} desde={2} giro={[-6, -1]} proporcion={0.62} color={C.p}
          clips={[{ src: 'tablero', desde: 0.6, vel: 0.95, dur: 195, cam: [{ f: 0, z: 1.4, x: 0.5, y: 0.55 }, { f: 195, z: 1.55, x: 0.5, y: 0.62 }] }]} />
        <div style={{ position: 'absolute', left: 70, width: 860, top: 1395, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {ETAPAS.map((et, i) => <Chip key={et.id} texto={et.nombre} color={VIVOS[i]} desde={25 + i * 12} activo={interpolate(f, [30 + i * 12, 32 + i * 12], [0, 1], clamp)} tam={28} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelHojas: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id="07-hojas" sonido={sonido} escenas={{
    gancho: GanchoEscena, hojas: Hojas, tablero: Tablero,
    cierre: () => <Cierre id="hojas" color={C.y} frase={<>Todo <span style={{ color: C.yt }}>TrueML</span> es gratis</>} />,
  }} />
);
