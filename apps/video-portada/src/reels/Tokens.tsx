// Reel 17 · «¿Qué es un token y por qué te lo cobran?». Secuela del reel 16 (la key robada), pero se entiende solo.
// A Turbo le llega la cuenta «por token». Debug explica qué es un token (un pedazo de texto; «hamster» = 1 token,
// «hámster» = 3), que en español el mismo texto sale ≈ 1.5× más largo, que el modelo escribe un token a la vez y cada
// uno recorre todas las capas (atención + FFN) y la cifra: ≈ 2 × parámetros operaciones por token (Kaplan et al.,
// 2020) → 7 B = 14 000 000 000. Remate: Turbo se cambia el nombre a «hamster». Cierre: Laboratorio Transformer.
// Los cortes de los tokens son reales (tiktoken, cl100k_base). Sin marcas reales en pantalla. Con voz
// (src/reels/dialogos/17-tokens.json, tools/voz.mjs).
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/17-tokens.tiempos.json';

const ID = '17-tokens';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 4, t1: 106,
  n2: 4, t2: 210, n3: 256,
  n4: 4, n5: 266, t3: 500,
  t4: 6, n6: 82,
  n7: 6,
};
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);
const habla = (ids: Linea[], f: number) => Math.max(...ids.map((id) => vol(id, f)));

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

const ROJO = '#FF8A5C', VERDE = '#2FD3A0';
const COLOR_TOKEN = [C.yt, '#7C93FF', '#2FD3A0', '#FF8A5C', '#A08FFF'];
const miles = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Una ficha de token: el pedazo de texto en monoespaciada, con su color, que cae en su lugar. */
const Ficha: React.FC<{ texto: string; color: string; desde: number; tam?: number }> = ({ texto, color, desde, tam = 46 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - desde, fps, config: { damping: 12, mass: 0.5, stiffness: 190 } });
  if (f < desde) return null;
  return (
    <span style={{ display: 'inline-block', padding: `${tam * 0.24}px ${tam * 0.34}px`, borderRadius: 14, background: `${color}26`, border: `3px solid ${color}`,
      font: `700 ${tam}px/1 ${MONO}`, color: C.ink, whiteSpace: 'pre', transform: `translateY(${(1 - e) * -40}px) scale(${0.7 + 0.3 * e})`, opacity: Math.min(1, e * 1.5),
      boxShadow: `0 0 24px ${color}44` }}>{texto}</span>
  );
};

/** Una fila: etiqueta del idioma, la palabra cortada en tokens y cuántos son. */
const Fila: React.FC<{ y: number; idioma: string; piezas: string[]; desde: number; tam?: number; destaca?: boolean }> = ({ y, idioma, piezas, desde, tam = 46, destaca }) => {
  const f = useCurrentFrame();
  const e = useEntrada(desde - 4);
  const cuenta = useEntrada(desde + piezas.length * 6 + 4, 12);
  if (f < desde - 4) return null;
  return (
    <div style={{ position: 'absolute', left: 70, top: y, width: 940, display: 'flex', alignItems: 'center', gap: 14, opacity: e }}>
      <span style={{ width: 70, font: `800 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.06em' }}>{idioma}</span>
      <div style={{ display: 'flex', gap: 8, flex: 1 }}>
        {piezas.map((p, i) => <Ficha key={i} texto={p} color={COLOR_TOKEN[i % COLOR_TOKEN.length]} desde={desde + i * 6} tam={tam} />)}
      </div>
      <span style={{ font: `850 ${tam * 0.95}px/1 ${SANS}`, color: destaca ? ROJO : VERDE, opacity: cuenta, transform: `scale(${0.6 + 0.4 * cuenta})`, whiteSpace: 'nowrap' }}>
        {piezas.length} {piezas.length === 1 ? 'token' : 'tokens'}
      </span>
    </div>
  );
};

// ── 1 · El gancho: la cuenta llega «por token» y Turbo no sabe qué es un token.
const FACTURA: [string, number][] = [['Tokens de entrada', 18204551], ['Tokens de salida', 23668654]];
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const grita = f >= VOZ.t1 - 4;
  const cara = grita ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t1', f)) ?? 'mueca' as const, cachetes: 1.1 }
    : f >= 40 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { parpado: parpadeo(f, 60, 10), boca: 'normal' as const };
  const temblor = grita && f < VOZ.t1 + 30 ? Math.sin(f * 3.1) * 7 : 0;
  const total = interpolate(f, [34, 70], [0, FACTURA[0][1] + FACTURA[1][1]], { ...clamp, easing: Easing.out(Easing.cubic) });
  const sello = interpolate(f, [74, 84], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.o, C.p, C.y, C.o, C.b, C.p]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <Gancho texto="¿Qué es un token y por qué te lo cobran?" marcas={{ token: C.yt }} desde={-40} paso={2} tam={92} />
        </div>
        <div style={{ position: 'absolute', left: 110, top: 520, width: 860, background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 28,
          padding: '30px 38px', boxShadow: '0 30px 80px #0008', transform: `rotate(-1.5deg) translateY(${(1 - useEntrada(6)) * 80}px)`, opacity: useEntrada(6) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: `800 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>
            <span>CUENTA DEL MES · KEY DE TURBO</span>
          </div>
          {FACTURA.map(([t, n], i) => (
            <div key={t} style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22, font: `500 32px/1.2 ${MONO}`, color: C.ink2, opacity: interpolate(f, [16 + i * 8, 24 + i * 8], [0, 1], clamp) }}>
              <span>{t}</span><span>{miles(n)}</span>
            </div>
          ))}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `2px dashed ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ font: `800 34px/1 ${SANS}`, color: C.ink }}>Total</span>
            <span style={{ font: `850 48px/1 ${MONO}`, color: ROJO }}>{miles(total)} tokens</span>
          </div>
          <div style={{ position: 'absolute', right: 30, top: -34, padding: '10px 22px', border: `5px solid ${ROJO}`, borderRadius: 12, color: ROJO, background: `${C.bg}dd`,
            font: `900 34px/1 ${SANS}`, letterSpacing: '0.04em', transform: `rotate(8deg) scale(${2 - sello})`, opacity: sello }}>KEY ROBADA</div>
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.4} habla={vol('n1', f)} derecha />
        <Turbo cx={700 + temblor} pies={1600} escala={0.5} pose={{ cara, brazos: grita ? [150, -150] : [-10, 10] }} />
        <Burbuja quien="turbo" x={130} y={930} ancho={860} desde={VOZ.t1} cola={560} tam={52}>¿QUÉ #@$% ES UN TOKEN? ¡¿Y POR QUÉ LO PAGO?!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1']} />
    </AbsoluteFill>
  );
};

// ── 2 · Qué es un token: un pedazo de texto. «hamster» = 1, «hámster» = 3. En español, ≈ 1.5× más tokens.
const TokenEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const n3 = VOZ.n3;
  const asustado = f >= VOZ.t2 - 4;
  const cara = asustado ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, cachetes: 1.15 }
    : { ojos: 'normal' as const, boca: 'normal' as const, parpado: parpadeo(f, 70, 20) };
  const temblor = f >= VOZ.t2 && f < VOZ.t2 + 24 ? Math.sin(f * 3.1) * 6 : 0;
  const stat = useEntrada(n3 + 54);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <App texto="Qué es un token" color={C.yt} desde={0} />
          <Gancho texto="Token = un pedazo de texto." marcas={{ Token: C.yt }} desde={8} paso={3} tam={84} style={{ marginTop: 22 }} />
          <Linea desde={30} tam={32} style={{ marginTop: 14 }}>El modelo no lee letras ni palabras: lee <b style={{ color: C.ink }}>tokens</b>.</Linea>
        </div>
        <Fila y={620} idioma="EN" piezas={['hamster']} desde={VOZ.n2 + 66} />
        <Fila y={740} idioma="ES" piezas={['h', 'ám', 'ster']} desde={VOZ.n2 + 143} destaca />
        <Fila y={900} idioma="EN" piezas={['un', 'fortunately']} desde={n3 + 4} tam={40} />
        <Fila y={1000} idioma="ES" piezas={['des', 'afort', 'un', 'adamente']} desde={n3 + 22} tam={40} destaca />
        {f >= n3 + 50 && (
          <div style={{ position: 'absolute', left: 70, top: 1110, width: 600, opacity: stat, transform: `translateY(${(1 - stat) * 24}px)` }}>
            <div style={{ font: `600 30px/1.25 ${SANS}`, color: C.ink2 }}>El mismo texto, en español:</div>
            <div style={{ font: `850 92px/1 ${SANS}`, letterSpacing: '-0.04em', color: ROJO, marginTop: 6 }}>≈ 1.5× tokens</div>
            <div style={{ font: `500 22px/1.3 ${MONO}`, color: C.ink3, marginTop: 10 }}>Cortes de un tokenizador real · ≈ 1.5×: Petrov et al., 2023</div>
          </div>
        )}
        <Debug x={60} y={1415} escala={1.15} ceja={0.5} habla={habla(['n2', 'n3'], f)} derecha />
        <Turbo cx={810 + temblor} pies={1600} escala={0.42} pose={{ cara, brazos: asustado ? [140, -140] : [-8, 8] }} />
        <Burbuja quien="turbo" x={380} y={1080} ancho={620} desde={VOZ.t2} hasta={n3 + 40} cola={420} tam={60}>¡¿YO CUESTO TRES?!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 't2', 'n3']} />
    </AbsoluteFill>
  );
};

// ── 3 · Por qué cuesta: un token a la vez, y cada uno recorre todas las capas. Luego la cuenta: ≈ 2 × parámetros.
const CONTEXTO = ['el', 'gato', 'come'];
const NUEVOS = ['pescado', '.'];
const CAPAS = ['capa 1', 'capa 2', '⋮', 'capa N'];
const PASADA = 70; // frames que tarda un token en subir por todas las capas
const INICIO_PASADA = [74, 150, 222];

const Pila: React.FC<{ f: number }> = ({ f }) => {
  // Qué pasada va (cada pasada = un token nuevo) y en qué capa está el token.
  const pasada = INICIO_PASADA.reduce((a, s, i) => (f >= s ? i : a), -1);
  const t = pasada >= 0 ? (f - INICIO_PASADA[pasada]) / PASADA : -1;
  const dur = pasada === 2 ? 0.55 : 1; // la última («una y otra vez») va más rápido
  const p = pasada >= 0 ? Math.min(1, t / dur) : -1;
  const nuevos = INICIO_PASADA.filter((s, i) => i < NUEVOS.length && f >= s + PASADA * (i === 2 ? 0.55 : 1)).length;
  const enAtencion = f >= VOZ.n4 + 143 && f < VOZ.n4 + 172;
  const enFFN = f >= VOZ.n4 + 173 && f < VOZ.n4 + 215;
  const X = 150, W = 780, ALTO = 132, Y0 = 1040; // capa 1 abajo, capa N arriba
  const yCapa = (i: number) => Y0 - i * (ALTO + 22);
  const yToken = p >= 0 && p < 1 ? interpolate(p, [0, 1], [Y0 + ALTO + 60, yCapa(3) - 70]) : null;
  const capaActiva = yToken === null ? -1 : CAPAS.findIndex((_, i) => yToken >= yCapa(i) - 10 && yToken <= yCapa(i) + ALTO + 10);
  return (
    <>
      {CAPAS.map((c, i) => {
        const y = yCapa(i);
        if (c === '⋮') return <div key={i} style={{ position: 'absolute', left: X, top: y, width: W, height: ALTO, display: 'grid', placeItems: 'center', font: `800 64px/1 ${SANS}`, color: C.ink3 }}>⋮</div>;
        const activa = capaActiva === i;
        return (
          <div key={i} style={{ position: 'absolute', left: X, top: y, width: W, height: ALTO, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px',
            background: `${C.card}f0`, border: `2px solid ${activa ? C.yt : C.line}`, borderRadius: 24, boxShadow: activa ? `0 0 40px ${C.yt}55` : '0 20px 50px #0006' }}>
            <span style={{ width: 120, font: `700 24px/1 ${MONO}`, color: C.ink3 }}>{c}</span>
            {[['Atención', C.b, enAtencion], ['FFN', C.p, enFFN]].map(([t, col, luz]) => (
              <span key={t as string} style={{ flex: 1, height: 84, display: 'grid', placeItems: 'center', borderRadius: 16, font: `800 36px/1 ${SANS}`, color: C.ink,
                background: luz || activa ? (col as string) : `${col}33`, border: `2px solid ${col}`, boxShadow: luz ? `0 0 40px ${col}aa` : 'none' }}>{t as string}</span>
            ))}
          </div>
        );
      })}
      {/* El texto: contexto abajo; cada token nuevo sale por arriba y se suma a la fila. */}
      <div style={{ position: 'absolute', left: 70, top: Y0 + ALTO + 36, width: 940, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: `700 24px/1 ${MONO}`, color: C.ink3, marginRight: 6 }}>texto:</span>
        {CONTEXTO.map((w, i) => <Ficha key={w} texto={w} color={COLOR_TOKEN[i]} desde={-20} tam={38} />)}
        {NUEVOS.slice(0, nuevos).map((w, i) => <Ficha key={w} texto={w} color={VERDE} desde={INICIO_PASADA[i] + PASADA * (i === 2 ? 0.55 : 1)} tam={38} />)}
      </div>
      {yToken !== null && (
        <div style={{ position: 'absolute', left: X + W / 2 - 60, top: yToken - 30, width: 120, height: 60, borderRadius: 30, background: C.yt, boxShadow: `0 0 50px ${C.yt}`,
          display: 'grid', placeItems: 'center', font: `800 26px/1 ${MONO}`, color: C.bg, zIndex: 5 }}>token</div>
      )}
    </>
  );
};

const CapasEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const B = VOZ.n5;
  const pila = interpolate(f, [B - 10, B + 4], [1, 0], clamp);
  const cuenta = useEntrada(B + 34);
  const modelo = useEntrada(B + 100);
  const total = interpolate(f, [B + 160, B + 215], [0, 14e9], { ...clamp, easing: Easing.out(Easing.cubic) });
  const choque = f >= VOZ.t3 - 4;
  const cara = choque ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t3', f)) ?? 'grito' as const, cachetes: 1.2 }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 15) };
  const temblor = choque ? Math.sin(f * 3.1) * 7 : 0;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <App texto="Por qué cuesta" color={C.o} desde={0} />
        </div>
        {pila > 0 && (
          <AbsoluteFill style={{ opacity: pila }}>
            <div style={{ position: 'absolute', left: 70, top: 320, width: 940 }}>
              <Linea desde={6} tam={42} color={C.ink}>El modelo escribe <b style={{ color: C.yt }}>un token a la vez</b>.</Linea>
              <Linea desde={VOZ.n4 + 70} tam={34} style={{ marginTop: 8 }}>Y cada uno recorre <b style={{ color: C.ink }}>todas las capas</b>.</Linea>
            </div>
            <Pila f={f} />
          </AbsoluteFill>
        )}
        {f >= B - 4 && (
          <div style={{ position: 'absolute', left: 70, top: 330, width: 940 }}>
            <Linea desde={B} tam={38}>Regla clásica, por cada token:</Linea>
            <div style={{ marginTop: 14, opacity: cuenta, transform: `scale(${0.8 + 0.2 * cuenta})`, transformOrigin: '0% 50%', font: `850 96px/1.05 ${SANS}`, letterSpacing: '-0.045em', color: C.ink }}>
              ≈ <span style={{ color: C.yt }}>2 ×</span> parámetros
            </div>
            <div style={{ opacity: cuenta, font: `600 34px/1.3 ${SANS}`, color: C.ink2, marginTop: 6 }}>operaciones (una multiplicación y una suma por peso)</div>
            <div style={{ marginTop: 56, opacity: modelo, transform: `translateY(${(1 - modelo) * 30}px)`, background: `${C.card}f0`, border: `2px solid ${C.line}`, borderRadius: 26, padding: '28px 34px' }}>
              <div style={{ font: `700 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.06em' }}>UN MODELO DE 7 B</div>
              <div style={{ marginTop: 16, font: `700 46px/1.2 ${MONO}`, color: C.ink }}>2 × 7 000 000 000</div>
              <div style={{ marginTop: 10, font: `850 82px/1 ${MONO}`, letterSpacing: '-0.03em', color: total > 0 ? ROJO : C.ink3 }}>= {miles(total)}</div>
              <div style={{ marginTop: 10, font: `700 36px/1.2 ${SANS}`, color: C.ink }}>operaciones <span style={{ color: ROJO }}>por cada token</span></div>
            </div>
            <div style={{ marginTop: 18, font: `500 22px/1.3 ${MONO}`, color: C.ink3, opacity: modelo }}>Solo el forward, sin los embeddings · Kaplan et al., 2020</div>
            <Linea desde={B + 222} tam={40} color={C.ink} style={{ marginTop: 40 }}>Y una respuesta larga son <b style={{ color: C.yt }}>cientos de tokens</b>.</Linea>
          </div>
        )}
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={habla(['n4', 'n5'], f)} derecha />
        <Turbo cx={820 + temblor} pies={1600} escala={0.42} pose={{ cara, brazos: choque ? [150, -150] : [-8, 8] }} />
        <Burbuja quien="turbo" x={390} y={1140} ancho={560} desde={VOZ.t3} cola={420} tam={64}>¡¿POR CADA UNO?!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n4', 'n5', 't3']} />
    </AbsoluteFill>
  );
};

// ── 4 · El remate: Turbo se cambia el nombre a «hamster» para pagar un token y no tres. Debug: mejor un tope de gasto.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const cambia = interpolate(f, [VOZ.t4 + 40, VOZ.t4 + 52], [0, 1], clamp);
  const orgullo = f >= VOZ.t4 - 4 && f < VOZ.n6;
  const cara = orgullo ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t4', f)) ?? 'grito' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 40, 5) };
  const salto = orgullo ? -Math.abs(Math.sin((f - VOZ.t4) / 5)) * 30 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.y, C.p, C.o, C.b, C.y, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 140, top: 300, width: 800, background: '#FFF7DA', borderRadius: 30, border: `6px solid ${ROJO}`, overflow: 'hidden',
          boxShadow: '0 30px 80px #0008', transform: `rotate(${-3 + cambia * 2}deg)` }}>
          <div style={{ background: ROJO, padding: '18px 0', textAlign: 'center', font: `900 44px/1 ${SANS}`, color: '#fff', letterSpacing: '0.06em' }}>HOLA, ME LLAMO</div>
          <div style={{ position: 'relative', height: 190, display: 'grid', placeItems: 'center' }}>
            <span style={{ position: 'absolute', font: `900 110px/1 ${SANS}`, color: '#1A1A2E', opacity: 1 - cambia, transform: `scale(${1 - cambia * 0.3})` }}>hámster</span>
            <span style={{ position: 'absolute', font: `900 110px/1 ${SANS}`, color: '#1A1A2E', opacity: cambia, transform: `scale(${0.7 + cambia * 0.3})` }}>hamster</span>
          </div>
          <div style={{ padding: '0 0 22px', textAlign: 'center', font: `800 36px/1 ${MONO}`, color: cambia > 0.5 ? '#118A63' : '#C2410C' }}>
            {cambia > 0.5 ? '1 token ✓' : '3 tokens'}
          </div>
        </div>
        <Turbo cx={560} pies={1580 + salto} escala={0.62} pose={{ cara, brazos: orgullo ? [150, -150] : [20, -20] }} />
        <Burbuja quien="turbo" x={110} y={760} ancho={860} desde={VOZ.t4} hasta={VOZ.n6 - 4} cola={450} tam={56}>¡YA SÉ! ¡ME CAMBIO EL NOMBRE A «HAMSTER»!</Burbuja>
        <Debug x={60} y={1415} escala={1.15} ceja={1} habla={vol('n6', f)} derecha />
        <Burbuja quien="debug" x={110} y={800} ancho={860} desde={VOZ.n6} cola={130} tam={46}>Mejor ponle un tope de gasto a tu key.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 'n6']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="tokens" color={C.o} frase={<>Cada operación de un transformer, <span style={{ color: VIVOS[1] }}>en tu navegador</span>: el Laboratorio Transformer</>} />
    <Voces ids={['n7']} />
  </AbsoluteFill>
);

export const ReelTokens: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, token: TokenEscena, capas: CapasEscena, remate: Remate, cierre: CierreEscena }} />
);
