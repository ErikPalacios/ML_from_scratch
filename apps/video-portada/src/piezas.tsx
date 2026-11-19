// Piezas del video: fondo, la T animada, la ventana con la grabación, los textos y el barrido de colores.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from './tema';
import { MARCA, MARCA_ETIQUETAS } from './marca';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const suave = Easing.bezier(0.33, 0, 0.15, 1);

/** ¿Formato vertical (Instagram, 1080×1920)? */
export const useVertical = () => { const { width, height } = useVideoConfig(); return height > width; };

/** Entrada con resorte que empieza en `desde` (frames). */
export const useEntrada = (desde = 0, damping = 18, mass = 0.9) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - desde, fps, config: { damping, mass, stiffness: 120 } });
};

/** Fondo cuadriculado con dos resplandores que se mueven despacio. */
export const Fondo: React.FC<{ tinte?: string; tinte2?: string }> = ({ tinte = C.b, tinte2 = C.p }) => {
  const f = useCurrentFrame();
  const a = Math.sin(f / 90) * 80, b = Math.cos(f / 110) * 70;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 620px at ${22 + a / 20}% ${30 + b / 25}%, ${tinte}2e, transparent 70%), radial-gradient(800px 600px at ${80 - a / 25}% ${75 - b / 20}%, ${tinte2}26, transparent 70%)` }} />
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
        backgroundSize: '56px 56px', backgroundPosition: `${-f * 0.25}px ${-f * 0.12}px`,
        maskImage: 'radial-gradient(ellipse 85% 80% at 50% 50%, #000 40%, transparent 100%)',
      }} />
    </AbsoluteFill>
  );
};

/** La franja de seis colores de TrueML. */
export const Franja: React.FC<{ alto?: number; ancho?: number | string; progreso?: number }> = ({ alto = 6, ancho = '100%', progreso = 1 }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', height: alto, width: ancho, borderRadius: alto, overflow: 'hidden' }}>
    {ETAPAS.map((e, i) => <span key={e.id} style={{ background: e.color, transform: `scaleX(${Math.max(0, Math.min(1, progreso * 6 - i))})`, transformOrigin: 'left' }} />)}
  </div>
);

/**
 * La T de vidrio. `armado` (0..1 por etapa, en orden de ETAPAS) hace caer cada pieza a su lugar;
 * `brillo` (0..1 por etapa) apaga las que no están encendidas.
 */
export const Marca: React.FC<{ alto: number; armado?: number[]; brillo?: number[]; etiquetas?: boolean; id: string; style?: React.CSSProperties }> =
  ({ alto, armado = [1, 1, 1, 1, 1, 1], brillo = [1, 1, 1, 1, 1, 1], etiquetas = false, id, style }) => {
    const css = ETAPAS.map((e, i) => {
      const a = armado[i];
      const o = Math.min(a * 1.6, 1) * (0.14 + 0.86 * brillo[i]);
      return `.${id} g[data-stage="${e.id}"]{opacity:${o.toFixed(3)};transform:translate(0px,${(-(1 - a) * 60).toFixed(2)}px);}`;
    }).join('');
    return (
      <div className={id} style={{ height: alto, aspectRatio: etiquetas ? '180.61 / 244.49' : '144.14 / 225.2', ['--tm-ink' as string]: C.ink, ['--tm-ink3' as string]: C.ink3, ...style }}>
        <style>{css + `.${id} svg{height:100%;width:auto}`}</style>
        <div style={{ height: '100%' }} dangerouslySetInnerHTML={{ __html: etiquetas ? MARCA_ETIQUETAS : MARCA }} />
      </div>
    );
  };

/** Cámara: puntos clave {f, z, x, y} (x, y = punto de interés de 0 a 1). Devuelve el transform del contenido. */
export type Toma = { f: number; z: number; x: number; y: number };
export const camara = (frame: number, puntos: Toma[]) => {
  const fs = puntos.map((p) => p.f);
  const v = (k: 'z' | 'x' | 'y') => puntos.length === 1 ? puntos[0][k] : interpolate(frame, fs, puntos.map((p) => p[k]), { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const z = v('z');
  const lim = (1 - 1 / z) / 2;
  const tx = Math.max(-lim, Math.min(lim, 0.5 - v('x'))), ty = Math.max(-lim, Math.min(lim, 0.5 - v('y')));
  return `scale(${z}) translate(${(tx * 100).toFixed(3)}%, ${(ty * 100).toFixed(3)}%)`;
};

/** Un tramo de una grabación: `desde` (s en la grabación), `vel` (velocidad), `cam` (cámara en frames de la escena). */
export type Clip = { src: string; desde: number; vel?: number; cam?: Toma[]; dur: number };

const ClipVideo: React.FC<{ clip: Clip; local: number }> = ({ clip, local }) => (
  <div style={{ position: 'absolute', inset: 0, transform: camara(local, clip.cam || [{ f: 0, z: 1, x: 0.5, y: 0.5 }]), transformOrigin: '50% 50%', willChange: 'transform' }}>
    <OffthreadVideo src={staticFile(`capturas/${clip.src}.mp4`)} trimBefore={Math.round(clip.desde * 30)} playbackRate={clip.vel || 1} muted
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  </div>
);

/**
 * Ventana de navegador con una o varias grabaciones en fila (con fundido entre ellas).
 * Inclinada en 3D: gira despacio hacia el frente mientras dura la escena.
 */
export const Ventana: React.FC<{
  clips: Clip[]; url: string; ancho: number; x: number; y: number; desde?: number; giro?: [number, number]; inclina?: number; color?: string; sombra?: boolean; z?: number;
  /** alto / ancho del área de la grabación (16:9 por omisión; en los reels se usa más alta y se recorta a los lados). */
  proporcion?: number;
}> = ({ clips, url, ancho, x, y, desde = 0, giro = [-14, -5], inclina = 6, color = C.acc, z = 0, proporcion = 9 / 16 }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const e = useEntrada(desde, 20, 1.1);
  const alto = ancho * proporcion;
  const rot = interpolate(f, [desde, durationInFrames], giro, clamp);
  const flota = Math.sin((f + z * 40) / 38) * 6;
  // qué clip toca y su tiempo local
  let t = f - desde, acc = 0;
  const capas: React.ReactNode[] = [];
  clips.forEach((c, i) => {
    const ini = acc, fin = acc + c.dur; acc = fin;
    const fundido = 10;
    if (t < ini - fundido || t > fin + (i === clips.length - 1 ? 1e6 : 0)) return;
    const op = i === 0 ? 1 : interpolate(t, [ini - fundido, ini], [0, 1], clamp);
    capas.push(<div key={i} style={{ position: 'absolute', inset: 0, opacity: op }}><ClipVideo clip={c} local={Math.max(0, t - ini)} /></div>);
  });
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho, perspective: 2400, zIndex: 10 + z }}>
      <div style={{
        transform: `translateY(${(1 - e) * 120 + flota}px) scale(${0.86 + 0.14 * e}) rotateY(${rot}deg) rotateX(${inclina * (1 - 0.4 * e)}deg)`,
        opacity: Math.min(1, e * 1.4), transformStyle: 'preserve-3d',
      }}>
        <div style={{
          borderRadius: 18, overflow: 'hidden', background: C.card, border: `1px solid ${C.line}`,
          boxShadow: `0 50px 120px -30px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.03), 0 0 80px -20px ${color}55`,
        }}>
          <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: '#0E1430', borderBottom: `1px solid ${C.line}` }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />)}
            <div style={{ marginLeft: 14, flex: 1, maxWidth: 520, height: 24, borderRadius: 8, background: C.chip, color: C.ink3, font: `500 13px/24px ${MONO}`, padding: '0 12px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ color: C.g }}>🔒</span> {url}
            </div>
          </div>
          <div style={{ position: 'relative', width: ancho, height: alto, overflow: 'hidden', background: C.bg }}>{capas}</div>
        </div>
      </div>
    </div>
  );
};

/** Texto que sube palabra por palabra (cada palabra sale de una máscara). */
export const Sube: React.FC<{ texto: string; desde?: number; paso?: number; style?: React.CSSProperties; resaltar?: string[]; colorResalte?: string }> =
  ({ texto, desde = 0, paso = 3, style, resaltar = [], colorResalte = C.yt }) => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.26em', ...style }}>
        {texto.split(' ').map((w, i) => {
          const s = spring({ frame: f - desde - i * paso, fps, config: { damping: 16, mass: 0.7, stiffness: 140 } });
          const r = resaltar.includes(w.replace(/[.,¿?]/g, ''));
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${(1 - s) * 110}%)`, opacity: s, color: r ? colorResalte : undefined }}>{w}</span>
            </span>
          );
        })}
      </div>
    );
  };

/** Etiqueta chica en monoespaciada con un punto de color (como los kickers de las apps). */
export const Kicker: React.FC<{ texto: string; color?: string; desde?: number }> = ({ texto, color = C.yt, desde = 0 }) => {
  const e = useEntrada(desde);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderRadius: 999, background: `${C.chip}cc`, border: `1px solid ${C.line}`,
      font: `600 20px/1 ${MONO}`, letterSpacing: '0.08em', color: C.ink2, textTransform: 'uppercase', opacity: e, transform: `translateX(${(1 - e) * -30}px)` }}>
      <i style={{ width: 12, height: 12, borderRadius: 4, background: color, boxShadow: `0 0 16px ${color}` }} />{texto}
    </div>
  );
};

/** Una línea de dato con check (aparece deslizándose). */
export const Punto: React.FC<{ texto: string; desde: number; color?: string }> = ({ texto, desde, color = C.g }) => {
  const e = useEntrada(desde);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, font: `500 30px/1.25 ${SANS}`, color: C.ink2, opacity: e, transform: `translateX(${(1 - e) * 40}px)` }}>
      <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, background: `${color}22`, border: `1.5px solid ${color}`, color, display: 'grid', placeItems: 'center', font: `700 20px/1 ${SANS}` }}>✓</span>
      {texto}
    </div>
  );
};

/** Bloque de texto de una escena: kicker, título grande y bajada. */
export const Texto: React.FC<{ kicker: string; color: string; titulo: string; resaltar?: string[]; bajada?: string; x: number; y: number; ancho: number; desde?: number; tam?: number; children?: React.ReactNode }> =
  ({ kicker, color, titulo, resaltar, bajada, x, y, ancho, desde = 6, tam = 74, children }) => {
    const eb = useEntrada(desde + 18);
    return (
      <div style={{ position: 'absolute', left: x, top: y, width: ancho, zIndex: 50 }}>
        <Kicker texto={kicker} color={color} desde={desde} />
        <Sube texto={titulo} desde={desde + 6} resaltar={resaltar} colorResalte={color === C.n ? C.acc : color}
          style={{ marginTop: 28, font: `800 ${tam}px/1.04 ${SANS}`, letterSpacing: '-0.035em', color: C.ink }} />
        {bajada && <p style={{ margin: '26px 0 0', font: `400 29px/1.4 ${SANS}`, color: C.ink2, opacity: eb, transform: `translateY(${(1 - eb) * 20}px)` }}>{bajada}</p>}
        {children && <div style={{ marginTop: 34, display: 'grid', gap: 18 }}>{children}</div>}
      </div>
    );
  };

/** Barrido de seis barras de color que tapa el corte entre escenas (dura `dur`; el corte va a la mitad). */
export const Barrido: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const m = dur / 2;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 1000 }}>
      {ETAPAS.map((e, i) => {
        const d = i * 1.6;
        const entra = interpolate(f, [d, m + d * 0.3], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
        const sale = interpolate(f, [m + d * 0.3, dur], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
        const h = height / 6;
        return <div key={e.id} style={{ position: 'absolute', left: 0, top: (5 - i) * h, height: h + 1, width, background: e.color,
          transform: `translateX(${(entra - 1) * 100 + sale * 100}%)` }} />;
      })}
    </AbsoluteFill>
  );
};
