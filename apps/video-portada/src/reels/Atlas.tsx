// Reel 05 · Atlas de Arquitecturas: «¿Te piden dibujar ViT en la entrevista?».
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { C, MONO } from '../tema';
import { Fondo, useEntrada, Ventana } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';

const URL = 'atlas.trueml.app/#vit';
const LILA = '#A08FFF';

// El gancho y el diagrama son una sola escena: la ventana sigue corriendo y solo cambia el título.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const t1 = interpolate(f, [120, 132], [1, 0], clamp);
  const y = interpolate(f, [118, 150], [770, 700], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.8} colores={[C.p, C.o, C.p, C.b, C.p, C.y]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <Ventana url={URL} ancho={1000} x={40} y={y} desde={-30} giro={[-5, 4]} proporcion={0.78} color={C.p}
          clips={[{ src: 'atlas-diagrama', desde: 0.3, vel: 1.25, dur: 400, cam: [{ f: 0, z: 1.7, x: 0.58, y: 0.26 }, { f: 150, z: 1.85, x: 0.6, y: 0.36 }, { f: 330, z: 1.6, x: 0.6, y: 0.55 }] }]} />
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940, opacity: t1 }}>
          <App texto="Atlas de Arquitecturas" color={LILA} desde={-20} />
          <Gancho texto="¿Te piden dibujar ViT en la entrevista?" marcas={{ ViT: LILA }} desde={-10} paso={3} tam={108} style={{ marginTop: 28 }} />
          <Linea desde={60} style={{ marginTop: 22 }}>Aquí está, <b style={{ color: C.ink }}>bloque por bloque.</b></Linea>
        </div>
        {f >= 126 && (
          <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
            <Gancho texto="Cada bloque, con su forma y sus parámetros." marcas={{ forma: C.yt, parámetros: '#2FD3A0' }} desde={130} paso={3} tam={88} />
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const CHIPS = ['Diagrama', 'Matemáticas', 'Dimensiones', 'Parámetros', 'FLOPs', 'La cuenta a la vista'];

const Parches: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const em = useEntrada(130);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.p} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Una imagen se vuelve una fila de parches." marcas={{ parches: C.yt }} desde={6} paso={3} tam={88} />
        </div>
        <Ventana url={URL} ancho={1000} x={40} y={600} desde={2} giro={[6, 1]} proporcion={0.6} color={C.y}
          clips={[{ src: 'atlas-parches', desde: 0.4, vel: 1.3, dur: 225, cam: [{ f: 0, z: 2.0, x: 0.42, y: 0.28 }, { f: 225, z: 1.85, x: 0.45, y: 0.3 }] }]} />
        <div style={{ position: 'absolute', left: 70, width: 870, top: 1270, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {CHIPS.map((t, i) => <Chip key={t} texto={t} color={VIVOS[i]} desde={50 + i * 10} activo={interpolate(f, [55 + i * 10, 57 + i * 10], [0, 1], clamp)} tam={28} />)}
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1500, font: `600 30px/1 ${MONO}`, color: C.ink2, opacity: em }}>ViT · CLIP · SAM · LLMs · difusión…</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReelAtlas: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
    <Reel id="05-atlas" sonido={sonido} escenas={{
      gancho: GanchoEscena, parches: Parches,
      cierre: () => <Cierre id="atlas" color={C.p} frase={<><span style={{ color: LILA }}>El Atlas</span> es gratis</>} />,
    }} />
);
