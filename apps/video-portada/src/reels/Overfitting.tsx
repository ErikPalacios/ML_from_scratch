// Reel 08 · Turbo y el overfitting: «Cuando entrenas 500 epochs para que tu modelo aprenda MÁS».
// Turbo (tierno, chillón y grosero) corre en su ruedita creyendo que más vueltas = más listo; Debug (el narrador)
// le enseña la curva de validación. Con voz (src/reels/dialogos/08-overfitting.json, tools/voz.mjs): cada línea
// suena en su frame (VOZ), las burbujas duran lo que dura el audio y las bocas se mueven con su volumen.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Chip, Cierre, clamp, Gancho, Linea, Reel, useSalida } from './kit';
import { Burbuja, corre, Debug, Grafica, MEJOR_EPOCH, parpadeo, Rueda, Turbo } from './personajes';
import TIEMPOS from './dialogos/08-overfitting.tiempos.json';

const ID = '08-overfitting';
const DE_MAS = 500 - MEJOR_EPOCH;
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 117,
  n2: 4, t2: 152, d1: 254, t3: 376,
  n3: 4, n4: 138, t4: 296,
  n5: 4, t5: 220, d2: 306, t6: 318,
  n6: 18,
};
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
/** Volumen (0..1) de la línea en el frame f de la escena: 0 si no está sonando. */
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** Debug entra deslizándose desde la izquierda y mira a Turbo. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const salto = f > desde + 14 && f < desde + 22 ? -Math.sin(((f - desde - 14) / 8) * Math.PI) * 18 : 0;
  return <Debug x={x} y={y + salto} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

// ── 1 · El gancho: Turbo corre en la ruedita y el contador de epochs vuela.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const c = corre(f);
  const epoch = Math.max(1, Math.round(interpolate(f, [0, 200], [1, 500], { ...clamp, easing: Easing.in(Easing.quad) })));
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.o, C.b, C.y, C.p, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Conoce a Turbo" color={C.o} desde={-20} />
          <Gancho texto="Cuando entrenas 500 epochs para que tu modelo aprenda MÁS" marcas={{ MÁS: C.o }} desde={-14} paso={2} tam={88} style={{ marginTop: 26 }} />
          <Linea desde={40} tam={38} style={{ marginTop: 18 }}><b style={{ color: C.yt }}>Epoch</b> = una vuelta completa a todos los datos de entrenamiento.</Linea>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 790 }}>
          <div style={{ font: `700 28px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.1em' }}>EPOCH</div>
          <div style={{ font: `850 110px/1 ${MONO}`, color: C.ink, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 50px ${C.o}88` }}>{String(epoch).padStart(3, '0')}</div>
        </div>
        <Rueda cx={540} cy={1290} r={290} ang={f * 9} />
        <Turbo cx={540} pies={1552 + c.rebote} escala={0.6} pose={{ cara: { ojos: 'enojado', cejas: 'enojado', boca: boca(vol('t1', f)) ?? 'mueca' }, brazos: c.brazos, pies: c.pies }} />
        <Burbuja quien="turbo" x={430} y={800} ancho={590} desde={VOZ.t1} cola={130}>Más vueltas, más listo. No me discutas.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1']} />
    </AbsoluteFill>
  );
};

// ── 2 · La gráfica: la de entrenamiento baja… y Debug pregunta por la de validación.
const GraficaEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const para = 371;
  const corriendo = f < para;
  const c = corre(f);
  const ang = corriendo ? f * 8 : para * 8 + 8 * 12 * (1 - Math.exp(-(f - para) / 12));
  const pose = corriendo
    ? { cara: { ojos: 'fastidio' as const, boca: boca(vol('t2', f)) ?? 'mueca' as const }, brazos: c.brazos, pies: c.pies }
    : { cara: { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'grito' as const, cachetes: 1.12 }, brazos: [38, -38] as [number, number] };
  const temblor = !corriendo ? Math.sin(f * 3.1) * interpolate(f, [para, para + 20], [6, 1], clamp) : 0;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940 }}>
          <Linea desde={VOZ.n2} tam={40} color={C.ink}><b style={{ color: C.yt }}>Loss</b> (pérdida) = qué tanto se equivoca el modelo. Más bajo, mejor.</Linea>
        </div>
        <Grafica x={70} y={360} w={940} h={470} entreno={interpolate(f, [8, 130], [0, 1], clamp)} valida={interpolate(f, [326, 386], [0, 1], clamp)} />
        <Rueda cx={620} cy={1330} r={240} ang={ang} />
        <Turbo cx={620 + temblor} pies={1545 + (corriendo ? c.rebote : 0)} escala={0.5} pose={pose} />
        <DebugEntra desde={232} y={1410} ceja={interpolate(f, [241, 248], [0, 1], clamp)} habla={vol('d1', f)} />
        <Burbuja quien="turbo" x={400} y={880} ancho={620} desde={VOZ.t2} hasta={fin('t2') + 6} cola={230}>¿Ves? Baja y baja. Soy una bestia.</Burbuja>
        <Burbuja quien="debug" x={70} y={890} ancho={640} desde={VOZ.d1} hasta={Math.max(fin('d1') + 6, 366)} cola={90}>¿Y la de <b>validación</b>? <span style={{ color: '#6B5A2E' }}>(datos que el modelo nunca vio)</span></Burbuja>
        <Burbuja quien="turbo" x={430} y={900} ancho={520} desde={VOZ.t3} cola={190} tam={84}>¿¡#@$%&!?</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 't2', 'd1', 't3']} />
    </AbsoluteFill>
  );
};

// ── 3 · La explicación (Debug): deja de aprender y empieza a memorizar.
const Explica: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.o} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <App texto="Debug explica" color={C.yt} desde={0} />
          <Gancho texto="Pasado cierto punto, el modelo deja de aprender y empieza a memorizar." marcas={{ memorizar: C.o }} desde={VOZ.n3 + 2} paso={3} tam={78} style={{ marginTop: 24 }} />
          <Linea desde={VOZ.n4} tam={40} style={{ marginTop: 22 }}>Como memorizar el examen de práctica y <b style={{ color: C.ink }}>reprobar el de verdad</b>.</Linea>
          <div style={{ marginTop: 28 }}><Chip texto="Eso es overfitting (sobreajuste)" color={C.o} desde={fin('n4') - 42} tam={34} /></div>
        </div>
        <Turbo cx={700} pies={1572} escala={0.6} pose={{ cara: { ojos: 'fastidio', boca: boca(vol('t4', f)) ?? 'mueca', parpado: parpadeo(f, 60, 30) }, brazos: [-22, 22] }} />
        <Debug x={60} y={1415} escala={1.15} ceja={1} habla={Math.max(vol('n3', f), vol('n4', f))} derecha />
        <Burbuja quien="turbo" x={390} y={990} ancho={600} desde={VOZ.t4} cola={300}>Nadie te preguntó, pato.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n3', 'n4', 't4']} />
    </AbsoluteFill>
  );
};

// ── 4 · La solución: early stopping. Turbo hace la cuenta, se enoja y se va (de espaldas, con todo y nalgas).
const Solucion: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const voltea = 372;
  const andar = f >= voltea ? f - voltea : 0;
  const c = corre(andar, 0.8);
  const cx = interpolate(f, [voltea + 4, 425], [690, 1320], { ...clamp, easing: Easing.in(Easing.quad) });
  const habla = Math.max(vol('t5', f), vol('t6', f));
  const cara = f < VOZ.t5 ? { parpado: parpadeo(f, 70) }
    : f < VOZ.t6 - 2 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(habla) ?? 'normal' as const }
    : { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(habla) ?? 'mueca' as const };
  const e = useEntrada(14, 14);
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="La solución: early stopping" marcas={{ early: C.g, stopping: C.g }} desde={0} paso={3} tam={92} />
        </div>
        <Grafica x={70} y={450} w={940} h={400} entreno={1} valida={1} marca={interpolate(f, [14, 34], [0, 1], clamp) * e} />
        <div style={{ position: 'absolute', left: 70, top: 872, width: 940 }}>
          <Linea desde={40} tam={36}>Si la validación lleva varias epochs sin mejorar (a esa espera se le llama <b style={{ color: C.g }}>patience</b>), paras y te quedas con el <b style={{ color: C.yt }}>mejor modelo</b>.</Linea>
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={f > VOZ.d2 ? 1 : 0.3} habla={Math.max(vol('n5', f), vol('d2', f))} derecha />
        <Turbo cx={cx} pies={1580 + (andar ? c.rebote : 0)} escala={0.5} espalda={f >= voltea}
          pose={f >= voltea ? { brazos: [c.brazos[0] * 1.4, c.brazos[1] * 1.4], pies: c.pies } : { cara, brazos: f >= VOZ.t6 - 2 ? [44, -44] : [0, 0] }} />
        <Burbuja quien="turbo" x={360} y={1040} ancho={660} desde={VOZ.t5} hasta={fin('t5') + 4} cola={330} tam={50}>¿O sea que corrí {DE_MAS} epochs de más?</Burbuja>
        <Burbuja quien="debug" x={70} y={1220} ancho={190} desde={VOZ.d2} hasta={VOZ.d2 + 60} cola={80}>Sí.</Burbuja>
        <Burbuja quien="turbo" x={400} y={1060} ancho={600} desde={VOZ.t6} hasta={fin('t6') + 14} cola={300}>Me voy. No me hablen.</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n5', 't5', 'd2', 't6']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="overfitting" color={C.o} frase={<>Overfitting y más, <span style={{ color: C.o }}>explicado desde cero</span></>} />
    <Voces ids={['n6']} />
  </AbsoluteFill>
);

export const ReelOverfitting: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, grafica: GraficaEscena, explica: Explica, solucion: Solucion, cierre: CierreEscena }} />
);
