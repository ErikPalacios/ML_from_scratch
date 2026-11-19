// Las escenas del video. Cada una dura lo que dice src/tiempos.json; los frames son locales a la escena.
// Cada escena tiene dos acomodos: horizontal (1920×1080, la portada) y vertical (1080×1920, Instagram).
// En vertical, lo importante queda entre y≈220 y y≈1600: arriba y abajo Instagram pone su interfaz.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from './tema';
import { Fondo, Franja, Kicker, Marca, Punto, Sube, Texto, Ventana, useEntrada, useVertical } from './piezas';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const salida = (f: number, dur: number, n = 14) => interpolate(f, [dur - n, dur], [1, 0], clamp);

// ---------------------------------------------------------------- 1 · gancho: la T se arma
export const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const V = useVertical();
  const armado = ETAPAS.map((_, i) => interpolate(f, [4 + i * 7, 22 + i * 7], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) }));
  const zoom = interpolate(f, [0, durationInFrames], [1.0, 1.08]);
  const sale = salida(f, durationInFrames, 10);
  const eSub = useEntrada(78);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.b} />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, opacity: sale }}>
        <div style={{ position: 'absolute', left: V ? 260 : 1180, top: V ? 220 : 120, filter: `drop-shadow(0 30px 80px ${C.b}55)` }}>
          <Marca id="m-intro" alto={V ? 760 : 840} armado={armado} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: V ? 70 : 150, top: V ? 1060 : 300, width: V ? 940 : 980 }}>
          <Kicker texto="TrueML · ML engineering en español" desde={30} color={C.yt} />
          <Sube texto="¿Quieres entender ML engineering de verdad?" desde={36} paso={4} resaltar={['verdad']}
            style={{ marginTop: 34, font: `850 ${V ? 96 : 104}px/1.0 ${SANS}`, letterSpacing: '-0.045em', color: C.ink }} />
          <p style={{ margin: '36px 0 0', font: `400 ${V ? 40 : 36}px/1.35 ${SANS}`, color: C.ink2, opacity: eSub, transform: `translateY(${(1 - eSub) * 20}px)` }}>
            Mira lo que hay adentro. <b style={{ color: C.ink }}>Todo es gratis.</b>
          </p>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 2 · Laboratorio Transformer
export const Transformer: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.o} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: salida(f, d) }}>
        <Ventana url="transformer.trueml.app" ancho={V ? 980 : 1140} x={V ? 50 : 650} y={V ? 860 : 180} desde={4} giro={V ? [-7, -2] : [-12, -4]} color={C.o}
          clips={[
            { src: 'transformer', desde: 1.6, vel: 1.15, dur: 220, cam: [{ f: 0, z: 1.0, x: 0.5, y: 0.5 }, { f: 70, z: 1.32, x: 0.42, y: 0.42 }, { f: 220, z: 1.42, x: 0.5, y: 0.5 }] },
            { src: 'transformer-entrena', desde: 1.0, vel: 1.4, dur: 170, cam: [{ f: 0, z: 1.5, x: 0.18, y: 0.52 }, { f: 170, z: 1.3, x: 0.3, y: 0.55 }] },
          ]} />
        <Texto x={V ? 70 : 110} y={V ? 230 : 220} ancho={V ? 940 : 600} kicker="Laboratorio Transformer" color={C.o} desde={14} tam={V ? 80 : 74}
          titulo="Mira entrenar un transformer, operación por operación." resaltar={['transformer,']}
          bajada="Forward, pérdida, backward y actualización: cada matriz con su fórmula y sus dimensiones." />
        <Etiqueta desde={250} texto="Todo se calcula en tu navegador" color={C.o} x={V ? 70 : 110} y={V ? 1520 : 850} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Etiqueta: React.FC<{ texto: string; desde: number; color: string; x: number; y: number }> = ({ texto, desde, color, x, y }) => {
  const e = useEntrada(desde);
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 14, padding: '16px 24px', borderRadius: 16,
      background: `${color}1f`, border: `1.5px solid ${color}88`, font: `600 28px/1 ${SANS}`, color: C.ink, opacity: e, transform: `scale(${0.8 + 0.2 * e})`, transformOrigin: 'left center' }}>
      <span style={{ width: 12, height: 12, borderRadius: 6, background: color, boxShadow: `0 0 18px ${color}` }} />{texto}
    </div>
  );
};

// ---------------------------------------------------------------- 3 · Atlas de Arquitecturas
export const Atlas: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.p} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: salida(f, d) }}>
        <Ventana url="atlas.trueml.app/#vit" ancho={V ? 960 : 1080} x={V ? 30 : 70} y={V ? 800 : 110} desde={2} giro={V ? [7, 3] : [14, 6]} color={C.p}
          clips={[{ src: 'atlas-diagrama', desde: 0.5, vel: 1.25, dur: 330, cam: [{ f: 0, z: 1.15, x: 0.58, y: 0.3 }, { f: 150, z: 1.55, x: 0.6, y: 0.36 }, { f: 330, z: 1.35, x: 0.6, y: 0.55 }] }]} />
        <Ventana url="atlas.trueml.app/#vit" ancho={V ? 640 : 720} x={V ? 400 : 560} y={V ? 1230 : 600} desde={110} giro={V ? [6, 2] : [10, 3]} color={C.y} z={2}
          clips={[{ src: 'atlas-parches', desde: 0.4, vel: 1.3, dur: 230, cam: [{ f: 0, z: 1.75, x: 0.42, y: 0.3 }, { f: 230, z: 1.6, x: 0.45, y: 0.32 }] }]} />
        <Texto x={V ? 70 : 1280} y={V ? 230 : 170} ancho={V ? 940 : 560} kicker="Atlas de Arquitecturas" color={C.p} desde={12} tam={V ? 80 : 66}
          titulo="Los modelos que preguntan en entrevistas." resaltar={['entrevistas.']}
          bajada="ViT, CLIP, SAM, LLMs, difusión… Diagrama, matemáticas, dimensiones, parámetros y FLOPs, con la cuenta a la vista." />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 4 · puente: las dos apps principales
const TarjetaApp: React.FC<{ titulo: string; tag: string; texto: string; color: string; desde: number; x: number; y: number; ancho: number }> = ({ titulo, tag, texto, color, desde, x, y, ancho }) => {
  const f = useCurrentFrame();
  const e = useEntrada(desde, 16);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho, borderRadius: 28, overflow: 'hidden', background: C.card, border: `1px solid ${C.line}`,
      boxShadow: `0 40px 100px -30px rgba(0,0,0,.7), 0 0 90px -30px ${color}88`, opacity: e, transform: `translateY(${(1 - e) * 80}px) scale(${0.9 + 0.1 * e})` }}>
      <Franja alto={8} progreso={interpolate(f, [desde + 6, desde + 30], [0, 1], clamp)} />
      <div style={{ padding: '38px 44px 44px' }}>
        <div style={{ font: `600 20px/1 ${MONO}`, letterSpacing: '0.08em', color, textTransform: 'uppercase' }}>{tag}</div>
        <div style={{ marginTop: 18, font: `850 76px/1 ${SANS}`, letterSpacing: '-0.04em', color: C.ink }}>{titulo}</div>
        <div style={{ marginTop: 18, font: `400 30px/1.35 ${SANS}`, color: C.ink2 }}>{texto}</div>
      </div>
    </div>
  );
};

export const Puente: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.g} />
      <AbsoluteFill style={{ opacity: salida(f, d, 10) }}>
        <Sube texto="Y para aprenderlo de verdad, empieza aquí:" desde={4} paso={3} resaltar={['aquí:']}
          style={{ position: 'absolute', left: V ? 70 : 0, right: V ? 70 : 0, top: V ? 330 : 230, justifyContent: 'center', textAlign: 'center', font: `800 ${V ? 84 : 72}px/1.05 ${SANS}`, letterSpacing: '-0.035em', color: C.ink }} />
        <TarjetaApp titulo="Sensei" tag="01 · Teoría" texto="ML engineering desde cero, para entenderlo de verdad." color={C.yt} desde={26} x={V ? 120 : 260} y={V ? 720 : 480} ancho={V ? 840 : 640} />
        <TarjetaApp titulo="Dojo" tag="02 · Práctica" texto="Entrena cada paso del sistema, del dato al monitoreo." color={C.g} desde={36} x={V ? 120 : 1020} y={V ? 1140 : 480} ancho={V ? 840 : 640} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 5 · Sensei
export const Sensei: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: salida(f, d) }}>
        <Ventana url="sensei.trueml.app/llms/" ancho={V ? 980 : 1140} x={V ? 50 : 720} y={V ? 1010 : 160} desde={4} giro={V ? [-7, -2] : [-15, -5]} color={C.yt}
          clips={[
            { src: 'sensei-tokens', desde: 0.2, vel: 1.0, dur: 130, cam: [{ f: 0, z: 1.25, x: 0.5, y: 0.4 }, { f: 130, z: 1.55, x: 0.5, y: 0.5 }] },
            { src: 'sensei-calc', desde: 1.0, vel: 1.5, dur: 170, cam: [{ f: 0, z: 1.3, x: 0.47, y: 0.42 }, { f: 170, z: 1.45, x: 0.47, y: 0.5 }] },
            { src: 'sensei-glosario', desde: 0.9, vel: 1.0, dur: 130, cam: [{ f: 0, z: 1.25, x: 0.45, y: 0.62 }, { f: 40, z: 1.6, x: 0.38, y: 0.7 }, { f: 130, z: 1.7, x: 0.38, y: 0.7 }] },
          ]} />
        <Texto x={V ? 70 : 110} y={V ? 220 : 170} ancho={V ? 940 : 590} kicker="Empieza aquí · Teoría" color={C.yt} desde={10} tam={V ? 100 : 110} titulo="Sensei">
          <p style={{ margin: '-6px 0 10px', font: `500 36px/1.3 ${SANS}`, color: C.ink }}>ML engineering desde cero, para entenderlo de verdad.</p>
          <Punto texto="59 lecciones, de lo básico a producción" desde={40} color={C.yt} />
          <Punto texto="Figuras que muestran cómo funciona" desde={60} color={C.yt} />
          <Punto texto="Calculadoras para jugar con los números" desde={150} color={C.yt} />
          <Punto texto="Un glosario que se abre ahí mismo" desde={310} color={C.yt} />
        </Texto>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 6 · Dojo
export const Dojo: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  // la T chica se enciende etapa por etapa: del dato al monitoreo
  const brillo = ETAPAS.map((_, i) => interpolate(f, [60 + i * 22, 74 + i * 22], [0, 1], clamp));
  const eT = useEntrada(50);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: salida(f, d) }}>
        <Ventana url="dojo.trueml.app" ancho={V ? 980 : 1120} x={V ? 50 : 70} y={V ? 960 : 170} desde={4} giro={V ? [7, 2] : [15, 5]} color={C.g}
          clips={[
            { src: 'dojo-inicio', desde: 0.2, vel: 1.0, dur: 300, cam: [{ f: 0, z: 1.15, x: 0.35, y: 0.4 }, { f: 100, z: 1.2, x: 0.5, y: 0.5 }, { f: 300, z: 1.4, x: 0.5, y: 0.55 }] },
            // solo el principio de la estación (antes de que baje a las tablas)
            { src: 'dojo-estacion', desde: 0.0, vel: 0.9, dur: 90, cam: [{ f: 0, z: 1.15, x: 0.35, y: 0.42 }, { f: 90, z: 1.3, x: 0.3, y: 0.4 }] },
          ]} />
        <Texto x={V ? 70 : 1270} y={V ? 220 : 150} ancho={V ? 940 : 560} kicker="Empieza aquí · Práctica" color={C.g} desde={10} tam={V ? 100 : 110} titulo="Dojo">
          <p style={{ margin: '-6px 0 10px', font: `500 36px/1.3 ${SANS}`, color: C.ink }}>Entrena cada paso, del dato al monitoreo.</p>
          <Punto texto="Un mini-proyecto por estación" desde={150} color={C.g} />
          <Punto texto="Lo construyes con Claude Code" desde={170} color={C.g} />
          <Punto texto="Lo rehaces solo y lo arreglas cuando se rompe" desde={190} color={C.g} />
        </Texto>
        <div style={{ position: 'absolute', left: V ? 820 : 1640, top: V ? 230 : 700, opacity: eT }}>
          <Marca id="m-dojo" alto={V ? 220 : 300} brillo={brillo} />
        </div>
        <div style={{ position: 'absolute', left: V ? 70 : 1280, top: V ? 1620 : 760, width: V ? 940 : 330, display: V ? 'flex' : 'grid', flexWrap: 'wrap', gap: V ? '10px 26px' : 10 }}>
          {(V ? ETAPAS.map((e, i) => [e, i] as const) : ETAPAS.map((e, i) => [e, i] as const).reverse()).map(([e, i]) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, font: `600 ${V ? 24 : 22}px/1 ${MONO}`, color: brillo[i] > 0.5 ? C.ink : C.ink3, opacity: 0.25 + 0.75 * brillo[i] }}>
              <i style={{ width: 14, height: 14, borderRadius: 4, background: e.color, boxShadow: brillo[i] > 0.5 ? `0 0 14px ${e.color}` : 'none' }} />{String(i + 1).padStart(2, '0')} · {e.nombre}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 7 · y además
export const Ademas: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  const items = [
    { src: 'ronda', desde: 0.9, vel: 1.0, url: 'ronda.trueml.app', titulo: 'Ronda de Diseño ML', texto: 'Simulador de entrevistas de ML System Design, con 45 minutos en el reloj', color: C.b, cam: [{ f: 0, z: 1.25, x: 0.75, y: 0.3 }, { f: 250, z: 1.45, x: 0.8, y: 0.25 }] },
    { src: 'hojas', desde: 2.6, vel: 0.9, url: 'hojas.trueml.app/docker/', titulo: 'Cheat sheets', texto: 'Nueve hojas de estudio, en la web y en PDF', color: C.y, cam: [{ f: 0, z: 1.2, x: 0.45, y: 0.4 }, { f: 250, z: 1.4, x: 0.45, y: 0.35 }] },
    { src: 'tablero', desde: 1.2, vel: 1.0, url: 'tablero.trueml.app', titulo: 'Tablero de proyectos', texto: 'Tu proyecto como un mapa de metro, del dato al monitoreo', color: C.p, cam: [{ f: 0, z: 1.2, x: 0.5, y: 0.5 }, { f: 250, z: 1.35, x: 0.5, y: 0.6 }] },
  ];
  const empuje = interpolate(f, [0, d], [1, 1.05]);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: salida(f, d), transform: `scale(${empuje})` }}>
        <Sube texto="Y además:" desde={2} style={{ position: 'absolute', left: V ? 70 : 110, top: V ? 230 : 110, font: `800 ${V ? 84 : 72}px/1 ${SANS}`, letterSpacing: '-0.035em', color: C.ink }} />
        {items.map((it, i) => <Tarjeta key={it.src} {...it} i={i} V={V} />)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Tarjeta: React.FC<{ src: string; desde: number; vel: number; url: string; titulo: string; texto: string; color: string; cam: { f: number; z: number; x: number; y: number }[]; i: number; V: boolean }> =
  ({ src, desde, vel, url, titulo, texto, color, cam, i, V }) => {
    const ini = 12 + i * 16;
    const e = useEntrada(ini + 14);
    // horizontal: tres columnas; vertical: tres filas (ventana a la izquierda, texto a la derecha)
    const x = V ? 40 : 110 + i * 580, y = V ? 380 + i * 400 : 260;
    const ancho = V ? 560 : 540;
    return (
      <>
        <Ventana url={url} ancho={ancho} x={x} y={y} desde={ini} giro={V ? [8, 0] : [i === 0 ? 10 : i === 2 ? -10 : 0, 0]} inclina={8} color={color} z={i}
          clips={[{ src, desde, vel, dur: 400, cam }]} />
        <div style={{ position: 'absolute', left: V ? 640 : x, top: V ? y + 70 : 640, width: V ? 400 : 540, opacity: e, transform: `translateY(${(1 - e) * 30}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: `800 40px/1.1 ${SANS}`, letterSpacing: '-0.02em', color: C.ink }}>
            <i style={{ width: 14, height: 14, flex: 'none', borderRadius: 4, background: color, boxShadow: `0 0 16px ${color}` }} />{titulo}
          </div>
          <div style={{ marginTop: 12, font: `400 ${V ? 28 : 27}px/1.35 ${SANS}`, color: C.ink2 }}>{texto}</div>
        </div>
      </>
    );
  };

// ---------------------------------------------------------------- 8 · cierre
const Garantia: React.FC<{ texto: string; i: number }> = ({ texto, i }) => {
  const e = useEntrada(56 + i * 9, 13);
  return <span style={{ padding: '16px 28px', borderRadius: 999, background: i === 0 ? C.yt : C.chip, color: i === 0 ? C.bg : C.ink,
    border: `1px solid ${i === 0 ? C.yt : C.line}`, font: `750 34px/1 ${SANS}`, opacity: e, transform: `scale(${0.6 + 0.4 * e})` }}>{texto}</span>;
};

export const Cierre: React.FC = () => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const V = useVertical();
  const armado = ETAPAS.map((_, i) => interpolate(f, [2 + i * 5, 18 + i * 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) }));
  const ew = useEntrada(14, 14);
  const ef = useEntrada(30);
  const eu = useEntrada(100);
  const fin = interpolate(f, [d - 24, d], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.y} />
      <AbsoluteFill style={{ opacity: fin }}>
        <div style={{ position: 'absolute', left: V ? 300 : 1180, top: V ? 200 : 110, filter: `drop-shadow(0 30px 80px ${C.b}66)`, transform: `scale(${interpolate(f, [0, d], [0.97, 1.03])})` }}>
          <Marca id="m-cierre" alto={V ? 660 : 860} armado={armado} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: V ? 70 : 150, top: V ? 930 : 250, width: V ? 940 : 960, textAlign: V ? 'center' : 'left' }}>
          <div style={{ font: `850 ${V ? 180 : 190}px/0.9 ${SANS}`, letterSpacing: '-0.055em', color: C.ink, opacity: ew, transform: `translateY(${(1 - ew) * 40}px)` }}>
            True<span style={{ background: `linear-gradient(90deg, ${C.acc}, ${C.p})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>ML</span>
          </div>
          <div style={{ marginTop: 30, opacity: ef, display: 'flex', justifyContent: V ? 'center' : 'flex-start' }}><Franja alto={8} ancho={560} progreso={interpolate(f, [26, 56], [0, 1], clamp)} /></div>
          <p style={{ margin: '34px 0 0', font: `500 40px/1.3 ${SANS}`, color: C.ink2, opacity: ef }}>
            Herramientas para aprender y practicar ML engineering, de la teoría a producción.
          </p>
          <div style={{ marginTop: 40, display: 'flex', gap: 18, justifyContent: V ? 'center' : 'flex-start' }}>
            {['Gratis', 'Sin cuenta', 'En español'].map((g, i) => <Garantia key={g} texto={g} i={i} />)}
          </div>
          <div style={{ marginTop: 54, font: `600 ${V ? 34 : 30}px/1 ${MONO}`, color: C.acc, opacity: eu }}>trueml.app</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
