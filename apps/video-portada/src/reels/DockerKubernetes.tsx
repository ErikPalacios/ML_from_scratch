// Reel 13 · «Cuando pusiste Docker y Kubernetes en el CV y te preguntan la diferencia».
// Turbo se congela y responde con los logos (la ballenita y el timón). Debug da «lo que debiste responder»:
// Docker mete tu app con todo lo que necesita en una caja (la imagen es el molde; cada caja corriendo, un
// contenedor); Kubernetes («timonel» en griego, K8s) maneja muchos contenedores en muchas máquinas: mantiene las
// copias que pides, levanta otra si una se cae y escala si sube el tráfico. Las copias son mini-Turbos.
// Con voz (src/reels/dialogos/13-docker-kubernetes.json, tools/voz.mjs), igual que los reels 08 y 09.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, corre, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/13-docker-kubernetes.tiempos.json';

const ID = '13-docker-kubernetes';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 180, d1: 250,
  n2: 4, n3: 214,
  n4: 4, n5: 172, t2: 300, n6: 368,
  t3: 6, d2: 70, t4: 106,
  n7: 8,
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

const AZUL = VIVOS[3], MORADO = VIVOS[4], VERDE = VIVOS[2], ROJO = VIVOS[1];

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

/** El círculo de «cargando…» sobre la cabeza de Turbo mientras se congela. */
const Cargando: React.FC<{ cx: number; cy: number; desde: number; hasta: number }> = ({ cx, cy, desde, hasta }) => {
  const f = useCurrentFrame();
  if (f < desde || f > hasta) return null;
  const e = interpolate(f, [desde, desde + 6, hasta - 6, hasta], [0, 1, 1, 0], clamp);
  return (
    <svg width={140} height={140} style={{ position: 'absolute', left: cx - 70, top: cy - 70, opacity: e, transform: `scale(${0.6 + 0.4 * e})` }}>
      <circle cx={70} cy={70} r={50} fill="#0B0F1Fcc" stroke={C.line} strokeWidth={6} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const brillo = ((i - Math.floor((f - desde) / 3)) % 8 + 8) % 8;
        return <circle key={i} cx={70 + Math.cos(a) * 30} cy={70 + Math.sin(a) * 30} r={8} fill={C.ink} opacity={0.15 + 0.85 * (brillo / 7)} />;
      })}
    </svg>
  );
};

// ── 1 · El gancho: el CV dice Docker y Kubernetes. Le preguntan la diferencia, se congela y responde con los logos.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const congelado = f >= 137 && f < VOZ.t1 - 2;
  const cara = f < 120 ? { parpado: parpadeo(f, 60), boca: 'normal' as const }
    : congelado ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'mueca' as const, cachetes: 1.1 }
    : f < VOZ.d1 ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const };
  const brazos: [number, number] = congelado ? [8, -8] : f >= VOZ.t1 - 2 && f < VOZ.d1 ? [-20, 150] : [0, 0];
  const tiembla = congelado ? Math.sin(f * 2.7) * 3 : 0;
  const resalta = (desde: number) => interpolate(f, [desde, desde + 8], [0, 1], clamp);
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.b, C.p, C.o, C.b, C.p, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando pusiste Docker y Kubernetes en el CV y te preguntan la diferencia" marcas={{ Docker: C.b, Kubernetes: C.p }} desde={-14} paso={2} tam={80} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 610, width: 940, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `600 26px/1 ${MONO}`, color: C.ink3 }}>
            {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
            <span style={{ marginLeft: 14 }}>cv_turbo_FINAL_v3.pdf</span>
          </div>
          <div style={{ padding: '22px 30px 28px' }}>
            <div style={{ font: `700 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.06em' }}>HABILIDADES</div>
            <div style={{ marginTop: 18, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              <Chip texto="Python" color={C.y} desde={6} tam={30} activo={0} />
              <Chip texto="PyTorch" color={C.o} desde={10} tam={30} activo={0} />
              <Chip texto="Docker ✓" color={C.b} desde={14} tam={30} activo={resalta(40)} />
              <Chip texto="Kubernetes ✓" color={C.p} desde={18} tam={30} activo={resalta(60)} />
            </div>
          </div>
        </div>
        <Turbo cx={540 + tiembla} pies={1560} escala={0.6} pose={{ cara, brazos }} />
        <Cargando cx={540} cy={1000} desde={137} hasta={VOZ.t1 - 2} />
        <DebugEntra desde={VOZ.d1 - 16} y={1415} ceja={interpolate(f, [VOZ.d1, VOZ.d1 + 8], [0, 1], clamp)} habla={vol('d1', f)} />
        <Burbuja quien="turbo" x={250} y={880} ancho={720} desde={VOZ.t1} hasta={VOZ.d1 - 4} cola={290} tam={50}>¿Uno es la ballenita… y el otro el timón?</Burbuja>
        <Burbuja quien="debug" x={70} y={900} ancho={480} desde={VOZ.d1} cola={90}>Esos son los logos.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 'd1']} />
    </AbsoluteFill>
  );
};

/** Un contenedor de barco (con puertas que se cierran) y una etiqueta. */
const CajaBarco: React.FC<{ w: number; h: number; cierre: number; etiqueta?: string; color?: string }> = ({ w, h, cierre, etiqueta, color = C.b }) => (
  <svg width={w} height={h} style={{ overflow: 'visible' }}>
    <rect x={0} y={0} width={w} height={h} rx={14} fill={`${color}22`} stroke={AZUL} strokeWidth={6} />
    {Array.from({ length: Math.floor(w / 46) }, (_, i) => <path key={i} d={`M${30 + i * 46} 14 L${30 + i * 46} ${h - 14}`} stroke={`${AZUL}55`} strokeWidth={5} />)}
    {/* las puertas se cierran desde los lados */}
    <rect x={0} y={0} width={(w / 2) * cierre} height={h} rx={14} fill={color} opacity={0.92} />
    <rect x={w - (w / 2) * cierre} y={0} width={(w / 2) * cierre} height={h} rx={14} fill={color} opacity={0.92} />
    {cierre > 0.98 && <>
      <path d={`M${w / 2} 10 L${w / 2} ${h - 10}`} stroke="#0B1026" strokeWidth={5} />
      {[w / 2 - 24, w / 2 + 24].map((x) => <rect key={x} x={x - 5} y={h * 0.3} width={10} height={h * 0.4} rx={5} fill="#0B1026" opacity={0.5} />)}
    </>}
    {etiqueta && cierre > 0.98 && <g>
      <rect x={w / 2 - 240} y={h / 2 - 36} width={480} height={72} rx={14} fill="#0B1026" stroke={C.ink} strokeWidth={3} />
      <text x={w / 2} y={h / 2 + 13} textAnchor="middle" fontFamily={MONO} fontWeight={800} fontSize={38} fill={C.ink}>{etiqueta}</text>
    </g>}
  </svg>
);

// ── 2 · Docker: la caja. Lo que necesita la app entra al contenedor, la puerta se cierra; el molde es la imagen y
// cada caja corriendo es un contenedor, igual en cualquier máquina.
const COSAS = ['tu app', 'Python 3.11', 'librerías', 'configuración'];
const MAQUINAS = ['tu compu', 'servidor', 'la nube'];
const DockerEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const cierre = interpolate(f, [128, 150], [0, 1], { ...clamp, easing: Easing.out(Easing.bounce) });
  const molde = f >= VOZ.n3;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Lo que debiste responder" color={C.yt} desde={0} />
          <Gancho texto="Docker = la caja" marcas={{ Docker: C.b }} desde={4} paso={3} tam={92} style={{ marginTop: 22 }} />
        </div>
        <div style={{ position: 'absolute', left: 160, top: 560 }}>
          <div style={{ position: 'absolute', left: 0, top: 0 }}>
            <CajaBarco w={760} h={330} cierre={cierre} etiqueta={molde ? 'IMAGEN = el molde' : 'tu app + todo'} />
          </div>
          {COSAS.map((s, i) => {
            const d = 30 + i * 22;
            const caeY = interpolate(f, [d, d + 18], [-200, 70 + Math.floor(i / 2) * 120], { ...clamp, easing: Easing.out(Easing.quad) });
            const op = interpolate(f, [d, d + 6, 126, 134], [0, 1, 1, 0], clamp);
            return <div key={s} style={{ position: 'absolute', left: i % 2 ? 400 : 60, top: caeY, opacity: op,
              padding: '14px 24px', borderRadius: 14, background: '#0B1026', border: `3px solid ${AZUL}`, font: `700 34px/1 ${MONO}`, color: C.ink, whiteSpace: 'nowrap' }}>{s}</div>;
          })}
        </div>
        {/* las copias corriendo, una por máquina */}
        <div style={{ position: 'absolute', left: 70, top: 960, width: 940, display: 'flex', justifyContent: 'space-between' }}>
          {MAQUINAS.map((m, i) => {
            const e = spring({ frame: f - (VOZ.n3 + 56 + i * 8), fps: 30, config: { damping: 12 } });
            const corriendo = f >= VOZ.n3 + 70 + i * 8;
            return (
              <div key={m} style={{ width: 290, opacity: Math.min(1, e * 1.3), transform: `translateY(${(1 - e) * -80}px) scale(${0.6 + 0.4 * e})` }}>
                <div style={{ height: 150, borderRadius: 18, background: `${C.card}ee`, border: `2px solid ${C.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                  <CajaBarco w={170} h={70} cierre={1} />
                  <div style={{ font: `700 26px/1 ${MONO}`, color: corriendo ? VERDE : C.ink3 }}>{corriendo ? '▶ contenedor' : '…'}</div>
                </div>
                <div style={{ marginTop: 10, textAlign: 'center', font: `600 30px/1 ${SANS}`, color: C.ink2 }}>{m}</div>
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1230, width: 940, textAlign: 'center' }}>
          <Linea desde={VOZ.n3 + 84} tam={44} color={C.ink}>Funciona <b style={{ color: AZUL }}>igual en cualquier máquina</b>.</Linea>
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={Math.max(vol('n2', f), vol('n3', f))} derecha />
        <Turbo cx={740} pies={1600} escala={0.4} pose={{ cara: { ojos: 'fastidio', boca: 'mueca', parpado: parpadeo(f, 80, 20) }, brazos: [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n2', 'n3']} />
    </AbsoluteFill>
  );
};

// ── 3 · Kubernetes: el timonel. Tres máquinas, copias (mini-Turbos en su caja). Una se cae y aparece otra; sube
// el tráfico y pasan de 3 a 10.
type Copia = { maq: number; slot: number; entra: number; cae?: number };
const CAE = 232, NUEVA = 262, ESCALA = 385;
const COPIAS: Copia[] = [
  { maq: 0, slot: 0, entra: 40 }, { maq: 1, slot: 0, entra: 55, cae: CAE }, { maq: 2, slot: 0, entra: 70 },
  { maq: 2, slot: 1, entra: NUEVA },
  ...[[0, 1], [1, 1], [1, 2], [0, 2], [1, 3], [2, 2], [0, 3]].map(([maq, slot], i) => ({ maq, slot, entra: ESCALA + i * 6 })),
];
const NODO_X = [70, 395, 720], NODO_Y = 560, NODO_W = 290;

const CopiaTurbo: React.FC<{ c: Copia; f: number }> = ({ c, f }) => {
  const e = spring({ frame: f - c.entra, fps: 30, config: { damping: 10, mass: 0.6 } });
  if (f < c.entra) return null;
  const x = NODO_X[c.maq] + 12 + (c.slot % 2) * 136, y = NODO_Y + 64 + Math.floor(c.slot / 2) * 146;
  const cayendo = c.cae !== undefined && f >= c.cae;
  const k = cayendo ? interpolate(f, [c.cae!, c.cae! + 26], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) }) : 0;
  if (k >= 1) return null;
  const roja = c.cae !== undefined && f >= c.cae - 12;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 130, height: 136, opacity: 1 - k,
      transform: `translateY(${k * 420}px) rotate(${k * 50}deg) scale(${0.5 + 0.5 * e})` }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 16, background: roja ? '#EC6A3F33' : `${C.p}26`, border: `4px solid ${roja ? ROJO : MORADO}`, overflow: 'hidden' }}>
        <Turbo cx={65} pies={176} escala={0.2} pose={{ cara: roja ? { ojos: 'shock', cejas: 'arriba', boca: 'grito' } : { parpado: parpadeo(f, 70, c.entra), boca: 'normal' } }} />
      </div>
      {roja && <div style={{ position: 'absolute', right: -10, top: -14, width: 42, height: 42, borderRadius: 21, background: ROJO, color: C.bg, font: `900 30px/42px ${SANS}`, textAlign: 'center' }}>✕</div>}
    </div>
  );
};

const KubernetesEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const vivas = COPIAS.filter((c) => f >= c.entra && !(c.cae !== undefined && f >= c.cae - 12)).length;
  const pedidas = f >= ESCALA - 10 ? 10 : 3;
  const ok = vivas >= pedidas;
  const escalando = !ok && f >= ESCALA - 10;
  const fase = f < VOZ.n5 ? 0 : f < VOZ.n6 ? 1 : 2;
  const TEXTOS: React.ReactNode[] = [
    <>Reparte <b style={{ color: C.ink }}>muchos contenedores</b> en <b style={{ color: C.ink }}>muchas máquinas</b>.</>,
    <>Tú pides 3 copias. Si una se cae, <b style={{ color: C.ink }}>levanta otra sola</b>.</>,
    <>¿Sube el tráfico? <b style={{ color: C.ink }}>De 3 a 10 copias</b>.</>,
  ];
  const turboHabla = vol('t2', f);
  const cara = f >= VOZ.t2 - 2 && f < VOZ.n6 ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(turboHabla) ?? 'mueca' as const }
    : f >= CAE && f < VOZ.t2 - 2 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : f >= ESCALA ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { parpado: parpadeo(f, 70), boca: 'normal' as const };
  const brazos: [number, number] = f >= VOZ.t2 - 2 && f < VOZ.t2 + 40 ? [44, -44] : f >= ESCALA ? [150, -150] : [0, 0];
  const temblor = f >= VOZ.t2 && f < VOZ.t2 + 24 ? Math.sin(f * 3.1) * 6 : 0;
  const trafico = interpolate(f, [VOZ.n6, VOZ.n6 + 24], [0.25, 1], clamp);
  const nodos = [useEntrada(10), useEntrada(16), useEntrada(22)];
  const eBarra = useEntrada(40);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.p} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Lo que debiste responder" color={C.yt} desde={0} />
          <Gancho texto="Kubernetes = el timonel" marcas={{ Kubernetes: C.p }} desde={4} paso={3} tam={84} style={{ marginTop: 22 }} />
          <div style={{ marginTop: 22, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Chip texto="«timonel» en griego" color={C.p} desde={24} tam={28} activo={0} />
            <Chip texto="K8s = K + 8 letras + s" color={C.y} desde={34} tam={28} activo={0} />
          </div>
        </div>
        {NODO_X.map((x, i) => {
          const e = nodos[i];
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: NODO_Y, width: NODO_W, height: 370, borderRadius: 22, background: `${C.card}e8`,
              border: `2px solid ${C.line}`, opacity: e, transform: `translateY(${(1 - e) * 30}px)` }}>
              <div style={{ padding: '16px 20px', font: `700 26px/1 ${MONO}`, color: C.ink3 }}>máquina {i + 1}</div>
            </div>
          );
        })}
        {COPIAS.map((c, i) => <CopiaTurbo key={i} c={c} f={f} />)}
        <div style={{ position: 'absolute', left: 70, top: 960, width: 940, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: eBarra }}>
          <div style={{ font: `800 40px/1 ${MONO}`, color: ok ? VERDE : escalando ? C.yt : ROJO, fontVariantNumeric: 'tabular-nums' }}>
            copias: {vivas} / {pedidas} {ok ? '✓' : escalando ? '↑' : '✕'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: fase === 2 ? 1 : 0.35 }}>
            <span style={{ font: `700 30px/1 ${SANS}`, color: C.ink2 }}>tráfico</span>
            <div style={{ width: 200, height: 26, borderRadius: 13, background: '#ffffff14', border: `2px solid ${C.line}`, overflow: 'hidden' }}>
              <div style={{ width: `${trafico * 100}%`, height: '100%', background: `linear-gradient(90deg, ${C.g}, ${C.y}, ${C.o})` }} />
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1050, width: 940, font: `500 44px/1.28 ${SANS}`, color: C.ink2 }}>
          {TEXTOS[fase]}
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={Math.max(vol('n4', f), vol('n5', f), vol('n6', f))} derecha />
        <Turbo cx={760 + temblor} pies={1590} escala={0.42} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={430} y={1170} ancho={540} desde={VOZ.t2} hasta={fin('t2') + 8} cola={330} tam={50}>¡Oye! ¡Ese era yo!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n4', 'n5', 't2', 'n6']} />
    </AbsoluteFill>
  );
};

// ── 4 · El remate: «¿Me contratan?» — «Nosotros te llamamos». Turbo explota y se va de espaldas.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(8);
  const voltea = fin('t4') + 8;
  const andar = f >= voltea ? f - voltea : 0;
  const c = corre(andar, 0.9);
  const cx = interpolate(f, [voltea + 2, 150], [540, 1250], { ...clamp, easing: Easing.in(Easing.quad) });
  const habla = Math.max(vol('t3', f), vol('t4', f));
  const cara = f < VOZ.d2 ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(habla) ?? 'normal' as const }
    : f < VOZ.t4 - 2 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const, cachetes: 1.1 }
    : { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(habla) ?? 'mueca' as const };
  const brazos: [number, number] = f < VOZ.d2 ? [150, -150] : f >= VOZ.t4 - 2 ? [44, -44] : [10, -10];
  const temblor = f >= VOZ.t4 && f < voltea ? Math.sin(f * 3.1) * 7 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.b, C.p, C.o, C.b, C.p, C.y]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Gancho texto="Docker empaqueta. Kubernetes administra." marcas={{ Docker: C.b, Kubernetes: C.p }} desde={0} paso={3} tam={80} />
          <Linea desde={14} tam={40} style={{ marginTop: 16 }}>La caja y el timonel. <b style={{ color: C.ink }}>Eso era todo.</b></Linea>
        </div>
        <Turbo cx={cx + temblor} pies={1520 + (andar ? c.rebote : 0)} escala={0.6} espalda={f >= voltea}
          pose={f >= voltea ? { brazos: [c.brazos[0] * 1.4, c.brazos[1] * 1.4], pies: c.pies } : { cara, brazos }} />
        <DebugEntra desde={VOZ.d2 - 16} y={1430} ceja={1} habla={vol('d2', f)} />
        <Burbuja quien="turbo" x={300} y={760} ancho={620} desde={VOZ.t3} hasta={VOZ.d2 - 2} cola={240}>¡Ya entendí! ¿Me contratan?</Burbuja>
        <Burbuja quien="debug" x={70} y={900} ancho={520} desde={VOZ.d2} hasta={140} cola={90}>Nosotros te llamamos.</Burbuja>
        <Burbuja quien="turbo" x={380} y={780} ancho={500} desde={VOZ.t4} hasta={voltea + 10} cola={160} tam={76}>¿¡#@$%&!?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t3', 'd2', 't4']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="docker-k8s" color={C.b} frase={<>Las hojas de repaso de <span style={{ color: AZUL }}>Docker</span> y <span style={{ color: MORADO }}>Kubernetes</span></>} />
    <Voces ids={['n7']} />
  </AbsoluteFill>
);

export const ReelDockerKubernetes: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, docker: DockerEscena, kubernetes: KubernetesEscena, remate: Remate, cierre: CierreEscena }} />
);
