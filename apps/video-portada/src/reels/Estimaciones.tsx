// Reel 14 · Estimaciones: «Cuando te preguntan cuántos servidores necesitas y dices "muchos"».
// En la entrevista, Turbo responde «muchos». Debug le da lo que debió responder: la cuenta rápida
// (back-of-the-envelope) para 1 millón de requests al día. Un día = 86,400 s → ≈ 12 req/s en promedio → pico ×3 =
// 36 req/s → si cada request tarda 100 ms, un servidor atiende 10 req/s → 4 servidores → +1 de repuesto = 5.
// Es la misma regla de la hoja de estimaciones: divide por el día, multiplica por el pico, súmale margen.
// Con voz (src/reels/dialogos/14-estimaciones.json, tools/voz.mjs), igual que los reels 08 y 09.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/14-estimaciones.tiempos.json';

const ID = '14-estimaciones';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 180, d1: 232, t2: 262,
  n2: 4, t3: 172, n3: 242, n4: 370, n5: 534, n6: 722,
  t4: 6, d2: 78, t5: 112,
  n7: 10,
};
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

// ── 1 · El gancho: la pregunta de la entrevista y la respuesta de Turbo.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const tarjeta = useEntrada(46, 15);
  const presume = f >= VOZ.t1 - 4 && f < VOZ.d1;
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 34 : 0;
  const cara = f < VOZ.t1 - 4 ? { ojos: 'normal' as const, parpado: parpadeo(f, 70), boca: 'normal' as const }
    : presume ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'grito' as const }
    : f < VOZ.t2 - 4 ? { ojos: 'normal' as const, parpado: parpadeo(f, 50, 10) }
    : { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, cachetes: 1.08 };
  const brazos: [number, number] = presume ? [150, -150] : f >= VOZ.t2 - 4 ? [12, -12] : [0, 0];
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.b, C.o, C.y, C.p, C.b, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando te preguntan cuántos servidores necesitas y dices «muchos»" marcas={{ servidores: VIVOS[3], muchos: C.o }} desde={-24} paso={2} tam={80} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 620, width: 940, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden',
          opacity: tarjeta, transform: `translateY(${(1 - tarjeta) * 30}px)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 26px', borderBottom: `2px solid ${C.line}`, font: `600 24px/1 ${MONO}`, color: C.ink3 }}>
            {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
            <span style={{ marginLeft: 14 }}>entrevista · system design</span>
          </div>
          <div style={{ padding: '20px 30px 26px' }}>
            <div style={{ font: `700 24px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>EL ENTREVISTADOR</div>
            <div style={{ marginTop: 12, font: `600 40px/1.25 ${SANS}`, color: C.ink }}>
              Tu app recibe <b style={{ color: VIVOS[0] }}>1,000,000 de requests al día</b>. ¿Cuántos servidores necesitas?
            </div>
          </div>
        </div>
        <Turbo cx={600} pies={1560 + salto} escala={0.6} pose={{ cara, brazos }} />
        <DebugEntra desde={VOZ.d1 - 16} y={1430} ceja={interpolate(f, [VOZ.d1, VOZ.d1 + 8], [0, 1], clamp)} habla={vol('d1', f)} />
        <Burbuja quien="turbo" x={360} y={920} ancho={560} desde={VOZ.t1} hasta={fin('t1') + 4} cola={240}>¡Muchos, obvio!</Burbuja>
        <Burbuja quien="debug" x={70} y={930} ancho={560} desde={VOZ.d1} hasta={VOZ.t2 - 4} cola={90}>¿Cuántos son muchos?</Burbuja>
        <Burbuja quien="turbo" x={390} y={920} ancho={500} desde={VOZ.t2} cola={210}>¿Más de tres?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 'd1', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · Lo que debió responder: la cuenta rápida, una fila por paso, al ritmo de la voz.
type Fila = { tag: string; color: string; form: string; res: string; en: number; formEn?: number; resEn: number; curva?: boolean; grande?: boolean };
const FILAS: Fila[] = [
  { tag: 'Un día', color: VIVOS[0], form: '24 × 60 × 60', res: '86,400 s', en: VOZ.n2 + 90, resEn: VOZ.n2 + 118 },
  { tag: 'Promedio', color: VIVOS[2], form: '1,000,000 ÷ 86,400', res: '≈ 12 req/s', en: VOZ.n3, resEn: VOZ.n3 + 36 },
  { tag: 'Pico · supón el triple', color: VIVOS[1], form: '12 × 3', res: '36 req/s', en: VOZ.n4, formEn: VOZ.n4 + 88, resEn: VOZ.n4 + 133, curva: true },
  { tag: '1 servidor: 100 ms por request → 10 req/s', color: VIVOS[3], form: '36 ÷ 10 = 3.6', res: '→ 4', en: VOZ.n5, formEn: VOZ.n5 + 112, resEn: VOZ.n5 + 158 },
  { tag: '+1 de repuesto (por si uno se cae)', color: VIVOS[4], form: '4 + 1', res: '5 servidores', en: VOZ.n6, resEn: VOZ.n6 + 80, grande: true },
];

/** Las requests de un día (forma ilustrativa): de noche casi nada, a media tarde el pico. */
const Curva: React.FC<{ t: number }> = ({ t }) => {
  const w = 300, h = 76;
  const v = (x: number) => { const hr = x * 24; return 0.12 + 0.55 * Math.exp(-(((hr - 11) / 2.6) ** 2)) + 0.88 * Math.exp(-(((hr - 17.5) / 2.4) ** 2)); };
  const pts = Array.from({ length: 49 }, (_, k) => [k / 48 * w, h - v(k / 48) * h] as const);
  const prom = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
  const p = interpolate(t, [0, 40], [0, 1], clamp);
  const pico = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  return (
    <svg width={w} height={h + 6} style={{ overflow: 'visible' }}>
      <path d={'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} stroke={VIVOS[1]} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={900} strokeDashoffset={900 * (1 - p)} />
      <path d={`M0 ${prom} L${w} ${prom}`} stroke={VIVOS[2]} strokeWidth={3} strokeDasharray="8 8" opacity={interpolate(t, [30, 44], [0, 1], clamp)} />
      <circle cx={pico[0]} cy={pico[1]} r={11 * interpolate(t, [40, 50], [0, 1], clamp)} fill={VIVOS[1]} stroke="#0B1026" strokeWidth={4} />
    </svg>
  );
};

const FilaCuenta: React.FC<{ fila: Fila; i: number }> = ({ fila, i }) => {
  const f = useCurrentFrame();
  const e = useEntrada(fila.en, 15);
  const ef = useEntrada(fila.formEn ?? fila.en, 15);
  const er = useEntrada(fila.resEn, 11);
  if (f < fila.en - 1) return null;
  return (
    <div style={{ position: 'absolute', left: 30, right: 30, top: 24 + i * 128, height: 118, borderTop: i ? `2px solid ${C.line}` : 'none', paddingTop: i ? 16 : 4,
      opacity: e, transform: `translateX(${(1 - e) * -30}px)` }}>
      <div style={{ font: `700 27px/1 ${MONO}`, letterSpacing: '0.05em', textTransform: 'uppercase', color: fila.color }}>{fila.tag}</div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 66 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
          <span style={{ font: `600 48px/1 ${MONO}`, color: C.ink2, opacity: ef, fontVariantNumeric: 'tabular-nums' }}>{fila.form}</span>
          {fila.curva && <Curva t={f - fila.en} />}
        </div>
        <span style={{ font: `850 ${fila.grande ? 62 : 54}px/1 ${SANS}`, letterSpacing: '-0.03em', color: fila.grande ? C.bg : C.ink, opacity: Math.min(1, er * 1.5),
          transform: `scale(${0.6 + 0.4 * er})`, transformOrigin: '100% 50%', fontVariantNumeric: 'tabular-nums',
          ...(fila.grande ? { background: VIVOS[2], padding: '6px 18px', borderRadius: 14, boxShadow: `0 0 60px ${VIVOS[2]}99` } : {}) }}>{fila.res}</span>
      </div>
    </div>
  );
};

const Cuenta: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const habla = Math.max(...(['n2', 'n3', 'n4', 'n5', 'n6'] as Linea[]).map((id) => vol(id, f)));
  const final = VOZ.n6 + 80;
  const cara = f >= VOZ.t3 - 2 && f < VOZ.t3 + 70 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t3', f)) ?? 'normal' as const, cachetes: 1.08 }
    : f >= final ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 20) };
  const brazos: [number, number] = f >= VOZ.t3 - 2 && f < VOZ.t3 + 50 ? [44, -44] : [-10, 10];
  const temblor = f >= VOZ.t3 && f < VOZ.t3 + 24 ? Math.sin(f * 3.1) * 6 : 0;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.g} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Lo que debiste responder" color={C.yt} desde={0} />
          <Gancho texto="La cuenta rápida." marcas={{ rápida: C.yt }} desde={4} paso={3} tam={84} style={{ marginTop: 22 }} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 420, width: 940, height: 672, background: `${C.card}ee`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008' }}>
          {FILAS.map((fila, i) => <FilaCuenta key={i} fila={fila} i={i} />)}
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={habla} derecha />
        <Turbo cx={760 + temblor} pies={1590} escala={0.45} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={300} y={1080} ancho={640} desde={VOZ.t3} hasta={fin('t3') + 6} cola={460} tam={46}>¿Matemáticas? ¿En una entrevista?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 't3', 'n3', 'n4', 'n5', 'n6']} />
    </AbsoluteFill>
  );
};

// ── 3 · El remate: Turbo jura que él lo calculó «al tanteo».
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const hoja = useEntrada(VOZ.t4, 13);
  const sello = useEntrada(VOZ.t4 + 34, 10);
  const cinco = useEntrada(VOZ.t5 + 14, 11);
  const presume = f >= VOZ.t4 - 2 && f < VOZ.d2 - 2;
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t4) / 5)) * 30 : 0;
  const cara = presume ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t4', f)) ?? 'grito' as const }
    : f >= VOZ.d2 - 2 && f < VOZ.t5 - 2 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const, cachetes: 1.1 }
    : f >= VOZ.t5 - 2 ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t5', f)) ?? 'mueca' as const }
    : { ojos: 'normal' as const, parpado: parpadeo(f, 60), boca: 'normal' as const };
  const brazos: [number, number] = presume ? [150, -150] : f >= VOZ.t5 - 2 ? [44, -44] : [12, -12];
  const temblor = f >= VOZ.t5 && f < VOZ.t5 + 24 ? Math.sin(f * 3.1) * 6 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.g, C.p, C.y, C.b, C.g, C.o]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Respuesta: 5 servidores." marcas={{ '5': C.g }} desde={0} paso={3} tam={80} />
          <Linea desde={12} tam={38} style={{ marginTop: 16 }}>Divide por el día, multiplica por el pico <b style={{ color: C.ink }}>y súmale margen</b>.</Linea>
        </div>
        <div style={{ position: 'absolute', left: 230, top: 590, width: 620, padding: '26px 36px 30px', background: '#FFF7DA', borderRadius: 10, boxShadow: '0 24px 70px #0009',
          opacity: hoja, transform: `rotate(-3deg) scale(${0.7 + 0.3 * hoja})` }}>
          <div style={{ font: `800 24px/1 ${MONO}`, letterSpacing: '0.08em', color: '#8C7A4A' }}>CUENTA DE TURBO</div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 22, font: `italic 800 92px/1 ${SANS}`, color: '#1A1A2E', letterSpacing: '-0.03em' }}>
            muchos
            <span style={{ color: '#EC6A3F', opacity: cinco, transform: `scale(${0.5 + 0.5 * cinco})`, display: 'inline-block' }}>= 5</span>
          </div>
          <div style={{ position: 'absolute', right: -26, top: -22, padding: '10px 18px', border: '5px solid #EC6A3F', borderRadius: 12, color: '#EC6A3F', background: '#FFF7DAee',
            font: `900 30px/1 ${SANS}`, letterSpacing: '0.04em', opacity: sello, transform: `rotate(9deg) scale(${2 - sello})` }}>AL TANTEO ✓</div>
        </div>
        <Turbo cx={600 + temblor} pies={1560 + salto} escala={0.6} pose={{ cara, brazos }} />
        <DebugEntra desde={VOZ.d2 - 16} y={1430} ceja={1} habla={vol('d2', f)} />
        <Burbuja quien="turbo" x={330} y={880} ancho={640} desde={VOZ.t4} hasta={VOZ.d2 - 4} cola={270} tam={50}>¡Eso mismo calculé yo! ¡Al tanteo!</Burbuja>
        <Burbuja quien="debug" x={70} y={930} ancho={500} desde={VOZ.d2} hasta={VOZ.t5 - 2} cola={90}>Dijiste «muchos».</Burbuja>
        <Burbuja quien="turbo" x={330} y={880} ancho={640} desde={VOZ.t5} cola={270} tam={50}>¡Pues cinco son muchos!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 'd2', 't5']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="estimaciones" color={C.y} frase={<>Las cuentas rápidas, en la <span style={{ color: VIVOS[0] }}>hoja de estimaciones</span></>} />
    <Voces ids={['n7']} />
  </AbsoluteFill>
);

export const ReelEstimaciones: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, cuenta: Cuenta, remate: Remate, cierre: CierreEscena }} />
);
