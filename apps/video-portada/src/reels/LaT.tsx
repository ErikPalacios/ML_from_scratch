// Reel 09 · La T: «Cuando tu modelo saca 95 % y ya te crees ML Engineer».
// Turbo cree que entrenar es todo el trabajo; Debug le enseña que es una pieza de seis (las de la T de TrueML:
// datos, modelo, API, contenedor, orquestación y monitoreo). Analogía: cocinar el platillo no es tener un
// restaurante. Con voz (src/reels/dialogos/09-la-t.json, tools/voz.mjs), igual que el reel 08.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from '../tema';
import { Fondo, Marca, useEntrada } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, corre, Debug, parpadeo, Rueda, Turbo } from './personajes';
import TIEMPOS from './dialogos/09-la-t.tiempos.json';

const ID = '09-la-t';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 120, d1: 202, t2: 266,
  n2: 4,
  n3: 4, n4: 130, t3: 182, n5: 206, n6: 296, t4: 476, n7: 514, n8: 656,
  t5: 8, d2: 42, t6: 70,
  n9: 12,
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

/** Confeti con los seis colores de la T: cae desde arriba a partir de `desde`. */
const Confeti: React.FC<{ desde: number; n?: number }> = ({ desde, n = 46 }) => {
  const f = useCurrentFrame() - desde;
  if (f < 0 || f > 120) return null;
  const azar = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  return (
    <>{Array.from({ length: n }, (_, i) => {
      const x = azar(i, 1) * 1080, v = 9 + azar(i, 2) * 9, y = -60 + f * v - azar(i, 3) * 300;
      const color = VIVOS[i % 6];
      return <div key={i} style={{ position: 'absolute', left: x + Math.sin(f / 8 + i) * 30, top: y, width: 18, height: 30, borderRadius: 4, background: color,
        transform: `rotate(${f * (6 + azar(i, 4) * 10) + i * 40}deg)`, opacity: interpolate(f, [90, 120], [1, 0], clamp) }} />;
    })}</>
  );
};

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

// ── 1 · El gancho: el notebook dice 95 %, Turbo festeja… y Debug pregunta cómo lo va a usar alguien.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const acc = Math.round(interpolate(f, [6, 70], [0, 95], { ...clamp, easing: Easing.out(Easing.cubic) }));
  const festeja = f >= VOZ.t1 - 4 && f < VOZ.d1;
  const salto = festeja ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 40 : 0;
  const cara = f < VOZ.t1 - 4 ? { parpado: parpadeo(f, 70), boca: 'normal' as const }
    : festeja ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'grito' as const }
    : f < VOZ.t2 - 4 ? { ojos: 'normal' as const, parpado: parpadeo(f, 50, 10) }
    : { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, cachetes: 1.08 };
  const brazos: [number, number] = festeja ? [150, -150] : f >= VOZ.t2 - 4 ? [12, -12] : [0, 0];
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.g, C.b, C.y, C.p, C.g, C.o]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando tu modelo saca 95% y ya te crees ML Engineer" marcas={{ '95%': C.g, Engineer: C.o }} desde={-14} paso={2} tam={86} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 600, width: 940, height: 250, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `600 26px/1 ${MONO}`, color: C.ink3 }}>
            {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
            <span style={{ marginLeft: 14 }}>mi_modelo.ipynb</span>
          </div>
          <div style={{ padding: '22px 30px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ font: `600 34px/1 ${MONO}`, color: C.ink2 }}>accuracy en test</span>
            <span style={{ font: `850 120px/1 ${MONO}`, color: C.ink, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 50px ${C.g}aa` }}>{acc}%</span>
          </div>
        </div>
        <Turbo cx={540} pies={1560 + salto} escala={0.6} pose={{ cara, brazos }} />
        <DebugEntra desde={VOZ.d1 - 16} y={1415} ceja={interpolate(f, [VOZ.d1, VOZ.d1 + 8], [0, 1], clamp)} habla={vol('d1', f)} />
        <Confeti desde={VOZ.t1} />
        <Burbuja quien="turbo" x={300} y={890} ancho={700} desde={VOZ.t1} hasta={fin('t1') + 4} cola={240}>¡95 por ciento! ¡Contrátenme!</Burbuja>
        <Burbuja quien="debug" x={70} y={900} ancho={640} desde={VOZ.d1} hasta={VOZ.t2 - 4} cola={90}>Bien. ¿Y cómo lo usa alguien?</Burbuja>
        <Burbuja quien="turbo" x={330} y={900} ancho={560} desde={VOZ.t2} cola={210} tam={50}>¿Le… le mando el notebook?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 'd1', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · La analogía: cocinar el platillo no es tener un restaurante. Solo se enciende la pieza «Modelo».
const Restaurante: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const armado = ETAPAS.map((_, i) => interpolate(f, [56 + i * 4, 72 + i * 4], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) }));
  return (
    <AbsoluteFill>
      <Fondo tinte={C.o} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Debug explica" color={C.yt} desde={0} />
          <Gancho texto="Cocinar el platillo no es tener un restaurante." marcas={{ platillo: C.o, restaurante: C.p }} desde={4} paso={3} tam={84} style={{ marginTop: 24 }} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', justifyContent: 'center', filter: `drop-shadow(0 30px 90px ${C.o}66)` }}>
          <Marca id="m-09-rest" alto={620} armado={armado} brillo={[0, 1, 0, 0, 0, 0]} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1360, width: 940, textAlign: 'center' }}>
          <Linea desde={66} tam={46} color={C.ink}>Entrenar el modelo es <b style={{ color: VIVOS[1] }}>1 pieza de 6</b>.</Linea>
        </div>
        <Debug x={60} y={1470} escala={1} ceja={0.6} habla={vol('n2', f)} derecha />
      </AbsoluteFill>
      <Voces ids={['n2']} />
    </AbsoluteFill>
  );
};

// ── 3 · Las seis piezas, una por una. La T se va encendiendo; cada pieza trae su dibujito.
const INICIO = [VOZ.n3, VOZ.n4, VOZ.n5, VOZ.n6, VOZ.n7, VOZ.n8];
const TECH = ['dataset', 'PyTorch', 'FastAPI', 'Docker', 'Kubernetes', 'Prometheus · Grafana'];
const TEXTO: React.ReactNode[] = [
  <>Que sigan llegando, y <b style={{ color: C.ink }}>limpios</b>. No un CSV que bajaste una vez.</>,
  <>Entrenarlo y evaluarlo. <b style={{ color: C.ink }}>Esto ya lo tienes.</b></>,
  <>La puerta por la que otras apps le mandan datos y <b style={{ color: C.ink }}>reciben la predicción</b>.</>,
  <>Una caja con el modelo y todo lo que necesita. Adiós al <b style={{ color: C.ink }}>«en mi compu sí funciona»</b>.</>,
  <>Muchas copias del servicio. Si una se cae, <b style={{ color: C.ink }}>otra la reemplaza sola</b>.</>,
  <>El mundo cambia y tu modelo <b style={{ color: C.ink }}>empieza a fallar sin avisar</b>. Alguien tiene que vigilarlo.</>,
];

/** Dibujito de cada pieza (500×300). `t` = frames desde que empezó la pieza. */
const Dibujo: React.FC<{ i: number; t: number }> = ({ i, t }) => {
  const col = ETAPAS[i].color, viv = VIVOS[i];
  const caja = { fill: `${col}22`, stroke: viv, strokeWidth: 4 };
  const txt = { fill: C.ink, fontFamily: MONO, fontSize: 24, fontWeight: 700 } as const;
  if (i === 0) { // filas de datos que siguen llegando
    return <svg width={500} height={300}>{Array.from({ length: 6 }, (_, k) => {
      const y = ((k * 52 + t * 2.2) % 312) - 12;
      return <g key={k} transform={`translate(${30 + Math.sin(k) * 10} ${300 - y})`} opacity={interpolate(y, [0, 40, 250, 300], [0, 1, 1, 0], clamp)}>
        {[0, 1, 2, 3].map((c) => <rect key={c} x={c * 112} y={-34} width={100} height={34} rx={8} fill={c === 0 ? `${col}55` : '#ffffff14'} stroke={c === 0 ? viv : C.line} strokeWidth={2} />)}
      </g>;
    })}</svg>;
  }
  if (i === 1) { // la palomita
    const p = interpolate(t, [6, 24], [0, 1], clamp);
    return <svg width={500} height={300}><circle cx={250} cy={150} r={110} {...caja} />
      <path d="M195 152 L237 192 L310 112" stroke={viv} strokeWidth={22} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={200} strokeDashoffset={200 * (1 - p)} /></svg>;
  }
  if (i === 2) { // apps → API → modelo
    const d = (t * 4) % 120;
    return <svg width={500} height={300}>
      {[60, 150, 240].map((y, k) => <g key={k}><rect x={10} y={y - 30} width={110} height={60} rx={12} fill="#ffffff10" stroke={C.line} strokeWidth={3} />
        <text x={65} y={y + 8} textAnchor="middle" {...txt} fontSize={22} fill={C.ink2}>app</text>
        <path d={`M124 ${y} L196 150`} stroke={C.line} strokeWidth={3} />
        <circle cx={124 + (72 * d) / 120} cy={y + ((150 - y) * d) / 120} r={8} fill={viv} /></g>)}
      <rect x={200} y={100} width={130} height={100} rx={16} {...caja} />
      <text x={265} y={160} textAnchor="middle" {...txt} fontSize={32}>API</text>
      <path d="M334 150 L372 150" stroke={viv} strokeWidth={4} />
      <rect x={376} y={110} width={114} height={80} rx={14} fill={`${ETAPAS[1].color}22`} stroke={VIVOS[1]} strokeWidth={3} />
      <text x={433} y={158} textAnchor="middle" {...txt} fontSize={20}>modelo</text>
    </svg>;
  }
  if (i === 3) { // la caja se cierra
    const tapa = interpolate(t, [40, 70], [-70, 0], { ...clamp, easing: Easing.out(Easing.bounce) });
    return <svg width={500} height={300}>
      <rect x={90} y={90} width={320} height={190} rx={16} {...caja} />
      {['modelo', 'Python 3.11', 'librerías'].map((s, k) => <text key={s} x={250} y={150 + k * 44} textAnchor="middle" {...txt} fontSize={26} opacity={interpolate(t, [8 + k * 8, 18 + k * 8], [0, 1], clamp)}>{s}</text>)}
      <rect x={76} y={60 + tapa} width={348} height={36} rx={10} fill={viv} />
    </svg>;
  }
  if (i === 4) { // copias: una se cae y otra la reemplaza
    const cae = interpolate(t, [50, 80], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
    const nueva = spring({ frame: t - 86, fps: 30, config: { damping: 11 } });
    return <svg width={500} height={300} style={{ overflow: 'visible' }}>
      {[0, 1, 2, 3].map((k) => {
        const x = 20 + k * 120, rota = k === 2;
        return <g key={k}>
          <g transform={rota ? `translate(0 ${cae * 260}) rotate(${cae * 35} ${x + 50} 150)` : undefined} opacity={rota ? 1 - cae : 1}>
            <rect x={x} y={100} width={100} height={100} rx={14} fill={rota && t > 40 ? '#EC6A3F33' : `${col}22`} stroke={rota && t > 40 ? '#FF8A5C' : viv} strokeWidth={4} />
            <text x={x + 50} y={160} textAnchor="middle" {...txt}>{rota && t > 40 ? '✕' : '✓'}</text>
          </g>
          {rota && nueva > 0.01 && <g transform={`translate(${x + 50} 150) scale(${nueva}) translate(${-x - 50} -150)`}>
            <rect x={x} y={100} width={100} height={100} rx={14} fill={`${col}44`} stroke={viv} strokeWidth={4} />
            <text x={x + 50} y={160} textAnchor="middle" {...txt}>✓</text></g>}
        </g>;
      })}
    </svg>;
  }
  // monitoreo: la precisión real baja poco a poco y salta la alerta
  const p = interpolate(t, [4, 90], [0, 1], clamp);
  const pts = Array.from({ length: 41 }, (_, k) => { const x = k / 40; return [40 + x * 420, 70 + (x < 0.35 ? 0 : (x - 0.35) * 260) + Math.sin(k * 1.7) * 6]; });
  const visibles = pts.slice(0, Math.max(2, Math.round(41 * p)));
  const alerta = interpolate(t, [92, 100], [0, 1], clamp);
  return <svg width={500} height={300}>
    <path d="M40 30 L40 260 L470 260" stroke={C.ink3} strokeWidth={3} fill="none" />
    <path d="M40 70 L470 70" stroke={C.ink3} strokeWidth={2} strokeDasharray="8 10" />
    <text x={46} y={58} {...txt} fontSize={20} fill={C.ink3}>95% en el notebook</text>
    <path d={'M' + visibles.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} stroke={viv} strokeWidth={7} fill="none" strokeLinecap="round" />
    <text x={470} y={290} textAnchor="end" {...txt} fontSize={20} fill={C.ink2}>semanas en producción →</text>
    <g opacity={alerta} transform={`translate(420 190) scale(${0.6 + 0.4 * alerta})`}>
      <path d="M0 -40 L38 26 L-38 26 Z" fill="#FF8A5C" stroke="#0B1026" strokeWidth={4} strokeLinejoin="round" />
      <text x={0} y={18} textAnchor="middle" fontFamily={SANS} fontWeight={900} fontSize={40} fill="#0B1026">!</text>
    </g>
  </svg>;
};

const Piezas: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const actual = INICIO.reduce((a, s, i) => (f >= s ? i : a), 0);
  const t = f - INICIO[actual];
  const brillo = ETAPAS.map((_, i) => (i === 1 ? 1 : i < actual ? 1 : i === actual ? interpolate(t, [0, 10], [0.2, 1], clamp) : 0));
  const e = interpolate(t, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const habla = Math.max(...(['n3', 'n4', 'n5', 'n6', 'n7', 'n8'] as Linea[]).map((id) => vol(id, f)));
  const turboHabla = Math.max(vol('t3', f), vol('t4', f));
  const cara = f >= VOZ.t3 - 2 && f < VOZ.n5 ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(turboHabla) ?? 'normal' as const }
    : f >= VOZ.t4 - 2 && f < VOZ.n7 + 20 ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(turboHabla) ?? 'mueca' as const }
    : f >= VOZ.n8 + 40 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 20) };
  const brazos: [number, number] = f >= VOZ.t3 - 2 && f < VOZ.t3 + 26 ? [-20, 150] : f >= VOZ.t4 - 2 && f < VOZ.t4 + 34 ? [44, -44] : [-10, 10];
  const temblor = f >= VOZ.t4 && f < VOZ.t4 + 24 ? Math.sin(f * 3.1) * 6 : 0;
  return (
    <AbsoluteFill>
      <Fondo tinte={ETAPAS[actual].color} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 60, top: 236, filter: `drop-shadow(0 20px 60px ${ETAPAS[actual].color}66)` }}>
          <Marca id="m-09-piezas" alto={560} brillo={brillo} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: 500, top: 250, width: 520, opacity: e, transform: `translateX(${(1 - e) * 40}px)` }}>
          <div style={{ font: `700 30px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>PIEZA {actual + 1} DE 6</div>
          <div style={{ marginTop: 14, font: `850 ${actual === 4 ? 78 : 92}px/1 ${SANS}`, letterSpacing: '-0.045em', color: VIVOS[actual] }}>{ETAPAS[actual].nombre}</div>
          <div style={{ marginTop: 22 }}><Chip texto={TECH[actual]} color={ETAPAS[actual].color} desde={INICIO[actual] + 4} tam={30} /></div>
          <div style={{ marginTop: 26 }}><Dibujo i={actual} t={t} /></div>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 880, width: 940, font: `500 46px/1.28 ${SANS}`, color: C.ink2, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
          {TEXTO[actual]}
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={habla} derecha />
        <Turbo cx={780 + temblor} pies={1590} escala={0.45} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={520} y={1090} ancho={340} desde={VOZ.t3} hasta={VOZ.t3 + 40} cola={250}>¡Obvio!</Burbuja>
        <Burbuja quien="turbo" x={460} y={1090} ancho={500} desde={VOZ.t4} hasta={VOZ.t4 + 40} cola={300} tam={76}>¿¡#@$%&!?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n3', 'n4', 't3', 'n5', 'n6', 't4', 'n7', 'n8']} />
    </AbsoluteFill>
  );
};

// ── 4 · El remate: ¿me faltan cinco? Sí. Turbo se sube a la ruedita: corre muchísimo y no llega a ningún lado.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const corriendo = f >= VOZ.t6 - 4;
  const k = corriendo ? f - VOZ.t6 + 4 : 0;
  const c = corre(k, 1.1);
  const ang = corriendo ? (k * k) / 6 + k * 6 : 0;
  const cara = !corriendo ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t5', f)) ?? 'normal' as const, cachetes: 1.1 }
    : { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t6', f)) ?? 'mueca' as const };
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.b, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Entrenar es 1 pieza de 6." marcas={{ '1': C.o }} desde={0} paso={3} tam={80} />
          <Linea desde={14} tam={40} style={{ marginTop: 16 }}>Las otras cinco son lo que lo vuelve <b style={{ color: C.ink }}>un producto</b>.</Linea>
        </div>
        <Rueda cx={540} cy={1250} r={290} ang={ang} />
        <Turbo cx={540} pies={1512 + (corriendo ? c.rebote : 0)} escala={0.6} pose={corriendo ? { cara, brazos: c.brazos, pies: c.pies } : { cara, brazos: [30, -30] }} />
        <DebugEntra desde={VOZ.d2 - 16} y={1430} ceja={1} habla={vol('d2', f)} />
        <Burbuja quien="turbo" x={360} y={700} ancho={560} desde={VOZ.t5} hasta={VOZ.d2 + 8} cola={200}>¿Me faltan CINCO?</Burbuja>
        <Burbuja quien="debug" x={70} y={1200} ancho={190} desde={VOZ.d2} hasta={VOZ.t6} cola={80}>Sí.</Burbuja>
        <Burbuja quien="turbo" x={340} y={700} ancho={580} desde={VOZ.t6} cola={200}>¡Ya casi llego!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t5', 'd2', 't6']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="la-t" color={C.p} frase={<>Las seis piezas, <span style={{ color: VIVOS[4] }}>paso a paso</span></>} />
    <Voces ids={['n9']} />
  </AbsoluteFill>
);

export const ReelLaT: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, restaurante: Restaurante, piezas: Piezas, remate: Remate, cierre: CierreEscena }} />
);
