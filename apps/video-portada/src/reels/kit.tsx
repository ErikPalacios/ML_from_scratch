// Piezas de los reels (1080×1920). Se apoyan en src/piezas.tsx (Fondo, Marca, Ventana, Franja, Barrido…) y suman
// lo que un reel necesita: un gancho que ya se lee en el frame 0, fondos con los seis colores de la T y un cierre corto.
// Zona segura: lo importante entre y≈220 e y≈1600; abajo a la derecha (x > 940, y > 1100) van los botones de Instagram.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from '../tema';
import { Barrido, Franja, Marca, useEntrada } from '../piezas';
import R from './reels.json';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const COLORES = ETAPAS.map((e) => e.color);
/** Los seis colores en versión clara, para texto sobre fondo oscuro (el gris de monitoreo se aclara). */
export const VIVOS = [C.yt, '#FF8A5C', '#2FD3A0', '#7C93FF', '#A08FFF', '#9AA6D6'];

export type Escenas = Record<string, React.FC>;
export const reel = (id: string) => {
  const r = R.reels.find((x) => x.id === id);
  if (!r) throw new Error(`no hay reel ${id}`);
  return r;
};
export const duracion = (id: string) => reel(id).escenas.reduce((s, e) => s + e.dur, 0);

/** El reel completo: las escenas en fila, el barrido al entrar a las que lo piden y la pista. */
export const Reel: React.FC<{ id: string; escenas: Escenas; sonido?: boolean; volMusica?: number }> = ({ id, escenas, sonido = true, volMusica = 1 }) => {
  const r = reel(id);
  let t = 0;
  const piezas: React.ReactNode[] = [];
  r.escenas.forEach((e, i) => {
    const Escena = escenas[e.id];
    piezas.push(<Sequence key={'e' + i} from={t} durationInFrames={e.dur}><Escena /></Sequence>);
    if ((e as { barrido?: boolean }).barrido) piezas.push(<Sequence key={'b' + i} from={t - R.barrido / 2} durationInFrames={R.barrido}><Barrido dur={R.barrido} /></Sequence>);
    t += e.dur;
  });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {piezas}
      {sonido && <Audio src={staticFile(`reels/${id}.wav`)} volume={volMusica} />}
    </AbsoluteFill>
  );
};

/** Opacidad de salida en los últimos `n` frames de la escena. */
export const useSalida = (n = 12) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  return interpolate(f, [d - n, d], [1, 0], clamp);
};

/** Fondo con seis resplandores (uno por color de la T) que giran despacio sobre la cuadrícula. */
export const Aurora: React.FC<{ fuerza?: number; colores?: string[] }> = ({ fuerza = 1, colores = COLORES }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const a = Math.round(0x30 * fuerza).toString(16).padStart(2, '0');
  const capas = colores.map((c, i) => {
    const ang = (i / colores.length) * Math.PI * 2 + f / 150;
    const x = 50 + Math.cos(ang) * 34, y = 48 + Math.sin(ang * 1.3) * 30;
    return `radial-gradient(${width * 0.62}px ${height * 0.32}px at ${x}% ${y}%, ${c}${a}, transparent 70%)`;
  });
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: capas.join(',') }} />
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
        backgroundSize: '56px 56px', backgroundPosition: `${-f * 0.25}px ${-f * 0.12}px`,
        maskImage: 'radial-gradient(ellipse 85% 80% at 50% 50%, #000 40%, transparent 100%)',
      }} />
    </AbsoluteFill>
  );
};

/**
 * Texto de gancho: palabras grandes que saltan una por una. Las palabras de `marcas` llevan un marcador del color
 * dado (texto oscuro sobre color). `desde` puede ser negativo para que el frame 0 ya muestre las primeras palabras.
 */
export const Gancho: React.FC<{ texto: string; marcas?: Record<string, string>; desde?: number; paso?: number; tam?: number; style?: React.CSSProperties; centro?: boolean }> =
  ({ texto, marcas = {}, desde = 0, paso = 3, tam = 104, style, centro = false }) => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.24em', rowGap: '0.06em', justifyContent: centro ? 'center' : 'flex-start',
        font: `850 ${tam}px/1.02 ${SANS}`, letterSpacing: '-0.045em', color: C.ink, ...style }}>
        {texto.split(' ').map((w, i) => {
          const s = spring({ frame: f - desde - i * paso, fps, config: { damping: 13, mass: 0.6, stiffness: 170 } });
          const limpia = w.replace(/[.,¿?¡!:«»]/g, '');
          const m = marcas[limpia];
          return (
            <span key={i} style={{ display: 'inline-block', opacity: Math.min(1, s * 1.5), transform: `translateY(${(1 - s) * 60}px) scale(${0.7 + 0.3 * s})`, transformOrigin: '50% 80%' }}>
              {m ? <span style={{ background: m, color: C.bg, padding: '0 0.14em', borderRadius: '0.14em', boxDecorationBreak: 'clone', boxShadow: `0 0 50px ${m}66` }}>{w}</span> : w}
            </span>
          );
        })}
      </div>
    );
  };

/** Píldora de color que entra con resorte. `activo` (0..1) la enciende. */
export const Chip: React.FC<{ texto: string; color: string; desde: number; activo?: number; tam?: number }> = ({ texto, color, desde, activo = 1, tam = 34 }) => {
  const e = useEntrada(desde, 14);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: `${tam * 0.42}px ${tam * 0.7}px`, borderRadius: 999,
      background: activo > 0.5 ? color : `${color}1c`, color: activo > 0.5 ? C.bg : C.ink, border: `2px solid ${color}`,
      boxShadow: activo > 0.5 ? `0 0 40px ${color}88` : 'none', font: `750 ${tam}px/1 ${SANS}`, letterSpacing: '-0.01em',
      opacity: e, transform: `scale(${0.6 + 0.4 * e})` }}>{texto}</span>
  );
};

/** Línea secundaria que entra subiendo. */
export const Linea: React.FC<{ children: React.ReactNode; desde: number; tam?: number; color?: string; style?: React.CSSProperties }> = ({ children, desde, tam = 44, color = C.ink2, style }) => {
  const e = useEntrada(desde);
  return <div style={{ font: `500 ${tam}px/1.3 ${SANS}`, color, opacity: e, transform: `translateY(${(1 - e) * 26}px)`, ...style }}>{children}</div>;
};

/** Etiqueta de app (kicker) con punto de color, más grande que el de piezas.tsx para el formato vertical. */
export const App: React.FC<{ texto: string; color: string; desde?: number }> = ({ texto, color, desde = 0 }) => {
  const e = useEntrada(desde);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '12px 22px', borderRadius: 999, background: `${C.chip}dd`, border: `1px solid ${color}88`,
      font: `650 26px/1 ${MONO}`, letterSpacing: '0.06em', color: C.ink, textTransform: 'uppercase', opacity: e, transform: `translateX(${(1 - e) * -30}px)` }}>
      <i style={{ width: 14, height: 14, borderRadius: 4, background: color, boxShadow: `0 0 18px ${color}` }} />{texto}
    </div>
  );
};

/** Cierre de todos los reels: la T se arma sobre la aurora, la marca, las garantías y a dónde ir. */
export const Cierre: React.FC<{ id: string; frase: React.ReactNode; color: string }> = ({ id, frase, color }) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const armado = ETAPAS.map((_, i) => interpolate(f, [4 + i * 5, 20 + i * 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) }));
  const ew = useEntrada(12, 14);
  const ea = useEntrada(30);
  const el = useEntrada(66);
  const fin = interpolate(f, [d - 14, d], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <Aurora fuerza={1.1} />
      <AbsoluteFill style={{ opacity: fin }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 240, display: 'flex', justifyContent: 'center', filter: `drop-shadow(0 30px 90px ${color}77)`,
          transform: `scale(${interpolate(f, [0, d], [0.96, 1.04])})` }}>
          <Marca id={`m-cierre-${id}`} alto={560} armado={armado} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: 70, right: 70, top: 860, textAlign: 'center' }}>
          <div style={{ font: `850 170px/0.9 ${SANS}`, letterSpacing: '-0.055em', color: C.ink, opacity: ew, transform: `translateY(${(1 - ew) * 40}px)` }}>
            True<span style={{ background: `linear-gradient(90deg, ${C.acc}, ${C.p})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>ML</span>
          </div>
          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center' }}><Franja alto={8} ancho={520} progreso={interpolate(f, [20, 50], [0, 1], clamp)} /></div>
          <div style={{ marginTop: 34, font: `600 40px/1.3 ${SANS}`, color: C.ink, opacity: ea }}>
            {frase}
          </div>
          <div style={{ marginTop: 26, display: 'flex', gap: 16, justifyContent: 'center' }}>
            {['Gratis', 'Sin cuenta', 'En español'].map((g, i) => <Chip key={g} texto={g} color={[color, C.g, C.acc][i]} desde={40 + i * 8} tam={30} activo={i === 0 ? 1 : 0} />)}
          </div>
          <div style={{ marginTop: 50, opacity: el, transform: `scale(${0.85 + 0.15 * el})` }}>
            <div style={{ font: `800 46px/1 ${SANS}`, color: C.ink }}>Link en la bio</div>
            <div style={{ marginTop: 16, font: `600 32px/1 ${MONO}`, color: C.acc }}>trueml.app</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
