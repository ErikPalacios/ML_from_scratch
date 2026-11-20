// Turbo (el hámster que la riega) y Debug (el pato que sabe), listos para los reels.
// Los dibujos salen de personaje/turbo.mjs (la misma fuente que los SVG de referencia); aquí solo se colocan,
// se animan y se les ponen las burbujas de texto. No hay voz: Turbo habla en burbujas negras, gruesas y en
// mayúsculas (su «voz grave»); Debug, en burbujas claras y tranquilas.
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS } from '../tema';
// @ts-ignore — módulo JS sin tipos, compartido con los scripts de personaje/
import { defsTurbo, pato, turboCuerpo, turboEspalda } from '../../personaje/turbo.mjs';
import { clamp } from './kit';

export type Cara = { ojos?: 'normal' | 'enojado' | 'shock' | 'fastidio'; cejas?: 'enojado' | 'arriba'; boca?: 'normal' | 'grito' | 'mueca'; parpado?: number; cachetes?: number };
export type Pose = { cara?: Cara; brazos?: [number, number]; pies?: [number, number] };

/** Parpadeo automático: cierra los ojos 4 frames cada `cada` frames. */
export const parpadeo = (f: number, cada = 75, fase = 0) => {
  const t = (f + fase) % cada;
  return t < 2 ? t / 2 : t < 4 ? 1 : t < 6 ? 1 - (t - 4) / 2 : 0;
};

/** Pose de carrera: pies alternados, brazos que se balancean y el rebote del cuerpo. */
export const corre = (f: number, vel = 0.9) => {
  const s = Math.sin(f * vel);
  return {
    pies: [-30 * Math.max(0, s), -30 * Math.max(0, -s)] as [number, number],
    brazos: [-18 * s - 6, -18 * s + 6] as [number, number],
    rebote: -10 * Math.abs(s),
  };
};

/** Turbo colocado por el punto entre sus pies (cx, pies). `escala` 1 = 1080×900. */
export const Turbo: React.FC<{ cx: number; pies: number; escala: number; pose?: Pose; espalda?: boolean; giro?: number; opacidad?: number }> =
  ({ cx, pies, escala, pose = {}, espalda = false, giro = 0, opacidad = 1 }) => {
    const html = `<defs>${defsTurbo}</defs>${espalda ? turboEspalda(pose) : turboCuerpo(pose)}`;
    return (
      <svg viewBox="0 0 1080 900" width={1080 * escala} height={900 * escala}
        style={{ position: 'absolute', left: cx - 540 * escala, top: pies - 815 * escala, overflow: 'visible', opacity: opacidad,
          transform: `rotate(${giro}deg)`, transformOrigin: `${540 * escala}px ${815 * escala}px` }}
        dangerouslySetInnerHTML={{ __html: html }} />
    );
  };

/** Debug, el pato. (x, y) = esquina de arriba a la izquierda; mira a la izquierda salvo con `derecha`. */
export const Debug: React.FC<{ x: number; y: number; escala?: number; ceja?: number; habla?: number; derecha?: boolean }> = ({ x, y, escala = 1, ceja = 0, habla = 0, derecha = false }) => (
  <svg viewBox="0 0 210 145" width={210 * escala} height={145 * escala}
    style={{ position: 'absolute', left: x, top: y, overflow: 'visible', transform: derecha ? 'scaleX(-1)' : undefined }}
    dangerouslySetInnerHTML={{ __html: pato({ ceja, habla }) }} />
);

/** La ruedita, vista de frente. `ang` gira los peldaños y los rayos. */
export const Rueda: React.FC<{ cx: number; cy: number; r: number; ang: number }> = ({ cx, cy, r, ang }) => {
  const peldanos = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg width={1080} height={1920} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
      <path d={`M${cx} ${cy} L${cx - r * 0.55} ${cy + r + 70} M${cx} ${cy} L${cx + r * 0.55} ${cy + r + 70}`} stroke={C.line} strokeWidth={16} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill="#10173A" fillOpacity={0.85} stroke="#2A3360" strokeWidth={18} />
      <g transform={`rotate(${ang} ${cx} ${cy})`}>
        {peldanos.map((a) => <rect key={a} x={cx - 4} y={cy - r + 10} width={8} height={22} rx={3} fill="#2A3360" transform={`rotate(${a} ${cx} ${cy})`} />)}
        {[0, 60, 120].map((a) => <path key={a} d={`M${cx} ${cy - r + 20} L${cx} ${cy + r - 20}`} stroke="#1E264A" strokeWidth={8} transform={`rotate(${a} ${cx} ${cy})`} />)}
      </g>
      <circle cx={cx} cy={cy} r={r * 0.45} fill="none" stroke="#1E264A" strokeWidth={5} />
      <circle cx={cx} cy={cy} r={20} fill="#2A3360" />
    </svg>
  );
};

/**
 * Burbuja de diálogo. Turbo: negra, borde blanco grueso, mayúsculas pesadas y un temblor al entrar (habla
 * fuerte). Debug: clara y tranquila. `cola` = x de la colita, medida desde el borde izquierdo de la burbuja.
 */
export const Burbuja: React.FC<{ quien: 'turbo' | 'debug'; x: number; y: number; ancho: number; desde: number; hasta?: number; cola?: number; colaArriba?: boolean; tam?: number; children: React.ReactNode }> =
  ({ quien, x, y, ancho, desde, hasta = 1e9, cola = 60, colaArriba = false, tam, children }) => {
    const f = useCurrentFrame();
    const { fps } = useVideoConfig();
    const e = spring({ frame: f - desde, fps, config: { damping: 11, mass: 0.5, stiffness: 190 } });
    const sale = interpolate(f, [hasta, hasta + 6], [1, 0], clamp);
    if (f < desde || sale <= 0) return null;
    const turbo = quien === 'turbo';
    const fuerza = turbo ? interpolate(f - desde, [0, 14], [7, 1.5], clamp) : 0;
    const dx = Math.sin(f * 2.1) * fuerza, dy = Math.cos(f * 2.9) * fuerza;
    const fondo = turbo ? '#0B0F1F' : '#FFF7DA';
    const borde = turbo ? '#F4F6FF' : '#E8C766';
    return (
      <div style={{ position: 'absolute', left: x, top: y, width: ancho, opacity: Math.min(1, e * 1.4) * sale,
        transform: `translate(${dx}px, ${dy}px) scale(${0.6 + 0.4 * e})`, transformOrigin: `${cola}px ${colaArriba ? '0%' : '100%'}` }}>
        <div style={{ position: 'relative', background: fondo, border: `${turbo ? 7 : 4}px solid ${borde}`, borderRadius: turbo ? 26 : 44,
          padding: turbo ? '26px 32px' : '24px 34px', boxShadow: turbo ? '0 18px 60px #0009, 8px 8px 0 #EC6A3F' : '0 18px 60px #0007' }}>
          <div style={{ position: 'absolute', top: -30, left: 26, padding: '6px 16px', borderRadius: 999, background: turbo ? C.o : C.yt,
            color: C.bg, font: `800 24px/1 ${MONO}`, letterSpacing: '0.08em' }}>{turbo ? 'TURBO' : 'DEBUG'}</div>
          <div style={turbo
            ? { font: `900 ${tam ?? 54}px/1.04 ${SANS}`, letterSpacing: '-0.02em', textTransform: 'uppercase', color: '#fff' }
            : { font: `600 ${tam ?? 44}px/1.22 ${SANS}`, color: '#1A1A2E' }}>{children}</div>
          <div style={{ position: 'absolute', left: cola - 22, [colaArriba ? 'top' : 'bottom']: -26, width: 40, height: 40, background: fondo,
            borderRight: `${turbo ? 7 : 4}px solid ${borde}`, borderBottom: `${turbo ? 7 : 4}px solid ${borde}`,
            transform: `rotate(${colaArriba ? 225 : 45}deg)` } as React.CSSProperties} />
        </div>
      </div>
    );
  };

// ── La gráfica de loss por epoch. Las curvas son ilustrativas (forma típica, no un entrenamiento real).
export const lossEntreno = (e: number) => 0.15 + 1.2 * Math.exp(-e / 60);
export const lossValida = (e: number) => 0.32 + 1.05 * Math.exp(-e / 45) + 0.00162 * e;
export const MEJOR_EPOCH = (() => { let m = 0; for (let e = 1; e <= 500; e++) if (lossValida(e) < lossValida(m)) m = e; return m; })();
export const VERDE = '#2FD3A0', NARANJA = '#FF8A5C';

export const Grafica: React.FC<{ x: number; y: number; w: number; h: number; entreno: number; valida: number; marca?: number }> = ({ x, y, w, h, entreno, valida, marca = 0 }) => {
  const pad = { l: 92, r: 30, t: 84, b: 76 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const px = (e: number) => pad.l + (e / 500) * iw;
  const py = (l: number) => pad.t + ih - (l / 1.5) * ih;
  const camino = (fn: (e: number) => number, p: number) => {
    const fin = Math.max(1, Math.round(500 * p));
    let d = `M${px(0)} ${py(fn(0))}`;
    for (let e = 4; e <= fin; e += 4) d += ` L${px(e).toFixed(1)} ${py(fn(e)).toFixed(1)}`;
    return d;
  };
  const punta = (fn: (e: number) => number, p: number, color: string) => p > 0.01 && p < 0.999
    ? <circle cx={px(500 * p)} cy={py(fn(500 * p))} r={11} fill={color} stroke="#0B1026" strokeWidth={4} /> : null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: `${C.card}ee`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008' }}>
      <div style={{ position: 'absolute', left: 30, top: 24, display: 'flex', gap: 26, font: `700 30px/1 ${SANS}`, color: C.ink }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: entreno > 0 ? 1 : 0.3 }}><i style={{ width: 30, height: 8, borderRadius: 4, background: VERDE }} />entrenamiento</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: valida > 0 ? 1 : 0.3 }}><i style={{ width: 30, height: 8, borderRadius: 4, background: NARANJA }} />validación</span>
      </div>
      <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <path d={`M${pad.l} ${pad.t - 10} L${pad.l} ${pad.t + ih} L${pad.l + iw} ${pad.t + ih}`} stroke={C.ink3} strokeWidth={3} fill="none" />
        {[0, 100, 200, 300, 400, 500].map((e) => <text key={e} x={px(e)} y={pad.t + ih + 40} fill={C.ink3} fontSize={26} fontFamily={MONO} textAnchor="middle">{e}</text>)}
        <text x={pad.l + iw} y={pad.t + ih + 72} fill={C.ink2} fontSize={26} fontFamily={SANS} fontWeight={700} textAnchor="end">epoch</text>
        <text x={26} y={pad.t + 10} fill={C.ink2} fontSize={26} fontFamily={SANS} fontWeight={700}>loss</text>
        {marca > 0 && <g opacity={marca}>
          <path d={`M${px(MEJOR_EPOCH)} ${pad.t - 6} L${px(MEJOR_EPOCH)} ${pad.t + ih}`} stroke={C.yt} strokeWidth={4} strokeDasharray="10 10" />
          <circle cx={px(MEJOR_EPOCH)} cy={py(lossValida(MEJOR_EPOCH))} r={16 * marca} fill={C.yt} stroke="#0B1026" strokeWidth={4} />
          <text x={px(MEJOR_EPOCH) + 18} y={pad.t + 22} fill={C.yt} fontSize={30} fontFamily={SANS} fontWeight={800}>mejor modelo · epoch {MEJOR_EPOCH}</text>
        </g>}
        {entreno > 0 && <path d={camino(lossEntreno, entreno)} stroke={VERDE} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {valida > 0 && <path d={camino(lossValida, valida)} stroke={NARANJA} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        {punta(lossEntreno, entreno, VERDE)}
        {punta(lossValida, valida, NARANJA)}
      </svg>
    </div>
  );
};
