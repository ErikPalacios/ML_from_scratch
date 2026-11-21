// Reel 18 · «Cuando toda tu IA es un request con tu key». Guiño al reel 16 (la key en el frontend).
// Turbo, en una entrevista de AI Engineer: «¿Cómo ve una imagen un modelo como ViT?» → «¡Le mando la imagen a la API!
// ¡Ella ve! ¡Yo no!». Debug da lo que debió responder, desde cero: ViT corta la foto de 224×224 en cuadritos de
// 16×16 (14×14 = 196), aplana cada uno y una capa lo vuelve un vector (un token, como una palabra), le suma la
// posición y un token extra [CLS] (197), y entran al mismo transformer que lee texto: una foto = 196 palabras.
// Remate: «¡Mando 196 requests! Con mi key: está en el frontend, ¿te la paso?». Cierre: el Atlas de Arquitecturas.
// Cifras: paper de ViT (Dosovitskiy et al. 2020, «An Image is Worth 16x16 Words») y la ficha de ViT del Atlas
// (crosscheck vit-b16-224: 197×768, 86 567 656 parámetros).
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, NARANJA, parpadeo, Turbo, VERDE } from './personajes';
import TIEMPOS from './dialogos/18-atlas-vit.tiempos.json';

const ID = '18-atlas-vit';
const LILA = '#A08FFF';
type Voz = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Voz, number> = {
  n1: 2, t1: 118, t2: 206,
  n2: 6, n3: 148,
  n4: 6, n5: 162,
  n6: 6,
  t3: 8, t4: 108,
  n7: 10,
};
// El entrevistador no habla: escribe en el chat de la videollamada.
const PREGUNTA = 70; // escena 1
const GRACIAS = 232, SALE = 264; // escena 5

const fin = (id: Voz) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Voz, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);

const Voces: React.FC<{ ids: Voz[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

/** La videollamada: el entrevistador es una silueta; su chat va arriba. `fuera` (0..1) = ya colgó. */
const Llamada: React.FC<{ y: number; alto: number; mensaje?: React.ReactNode; desde?: number; fuera?: number }> = ({ y, alto, mensaje, desde = 1e9, fuera = 0 }) => {
  const f = useCurrentFrame();
  const escribe = f >= desde - 22 && f < desde;
  const e = spring({ frame: f - desde, fps: 30, config: { damping: 13, mass: 0.6 } });
  const seg = 512 + Math.floor(f / 30);
  const h = alto - 64;
  return (
    <div style={{ position: 'absolute', left: 70, top: y, width: 940, height: alto, background: `${C.card}f2`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `600 26px/1 ${MONO}`, color: C.ink3 }}>
        <i style={{ width: 16, height: 16, borderRadius: 8, background: fuera > 0.5 ? C.n : '#EC6A3F', opacity: fuera > 0.5 || Math.floor(f / 15) % 2 ? 1 : 0.35 }} />
        <span>Entrevista · AI Engineer</span>
        <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{`${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`}</span>
      </div>
      <div style={{ position: 'relative', height: h, background: 'radial-gradient(circle at 50% 45%, #2A3466, #121A36 70%)' }}>
        <svg width={940} height={h} style={{ position: 'absolute', inset: 0, opacity: 1 - fuera }}>
          <circle cx={470} cy={h * 0.5} r={62} fill="#5A6699" />
          <path d={`M310 ${h} Q310 ${h * 0.72} 470 ${h * 0.72} Q630 ${h * 0.72} 630 ${h} Z`} fill="#5A6699" />
        </svg>
        <div style={{ position: 'absolute', right: 22, bottom: 18, padding: '8px 16px', borderRadius: 10, background: '#0B0F1Fcc', font: `600 24px/1 ${SANS}`, color: C.ink2, opacity: 1 - fuera }}>Entrevistador</div>
        {fuera > 0 && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, opacity: fuera, background: '#0B0F1F' }}>
          <svg width={110} height={60}><rect x={0} y={0} width={110} height={60} rx={30} fill="#EC6A3F" />
            <path d="M28 34 Q55 14 82 34" stroke="#fff" strokeWidth={9} fill="none" strokeLinecap="round" /></svg>
          <div style={{ font: `650 38px/1.2 ${SANS}`, color: C.ink2 }}>El entrevistador salió de la llamada</div>
        </div>}
        {escribe && fuera === 0 && <div style={{ position: 'absolute', left: 26, top: 22, padding: '18px 26px', borderRadius: 22, background: '#F4F6FF', display: 'flex', gap: 10 }}>
          {[0, 1, 2].map((k) => <i key={k} style={{ width: 14, height: 14, borderRadius: 7, background: '#5A6699', opacity: 0.4 + 0.6 * Math.max(0, Math.sin((f + k * 5) / 3)) }} />)}
        </div>}
        {mensaje && f >= desde && fuera < 1 && <div style={{ position: 'absolute', left: 26, top: 22, maxWidth: 860, padding: '18px 28px 20px', borderRadius: 22, background: '#F4F6FF',
          opacity: Math.min(1, e * 1.4) * (1 - fuera), transform: `scale(${0.7 + 0.3 * e})`, transformOrigin: '0% 0%', boxShadow: '0 14px 40px #0006' }}>
          <div style={{ font: `800 20px/1 ${MONO}`, letterSpacing: '0.08em', color: '#5A6699' }}>ENTREVISTADOR</div>
          <div style={{ marginTop: 8, font: `700 46px/1.15 ${SANS}`, color: '#0B0F1F' }}>{mensaje}</div>
        </div>}
      </div>
    </div>
  );
};

/** Tarjetita de código de Turbo (la key a la vista). */
const Codigo: React.FC<{ x: number; y: number; ancho: number; desde: number; lineas: React.ReactNode[]; tam?: number }> = ({ x, y, ancho, desde, lineas, tam = 30 }) => {
  const f = useCurrentFrame();
  const e = spring({ frame: f - desde, fps: 30, config: { damping: 14 } });
  if (f < desde) return null;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho, padding: '18px 26px', borderRadius: 20, background: '#070B18', border: `2px solid ${C.line}`,
      boxShadow: '0 20px 60px #0008', font: `600 ${tam}px/1.45 ${MONO}`, color: C.ink2, opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 30}px)` }}>
      {lineas.map((l, i) => <div key={i} style={{ whiteSpace: 'pre' }}>{l}</div>)}
    </div>
  );
};
const KEY = <span style={{ color: NARANJA }}>"mi-key-123"</span>;

/**
 * La «foto»: una selfie de Turbo de 224×224 (aquí `lado` px). Con `zoom` y (`col`, `fila`) muestra solo ese cuadrito
 * de 16×16, ampliado. Se dibuja con el mismo <Turbo>, recortado.
 */
const Selfie: React.FC<{ lado: number; cara?: Parameters<typeof Turbo>[0]['pose'] }> = ({ lado, cara }) => {
  const e = 1.02 * lado / 560;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: lado, height: lado, overflow: 'hidden', background: 'linear-gradient(160deg, #3B4A8F, #1A2250 55%, #2B1F4F)' }}>
      <div style={{ position: 'absolute', left: lado * 0.08, top: lado * 0.1, width: lado * 0.26, height: lado * 0.3, borderRadius: lado * 0.02, background: '#2FD3A033', border: `${lado * 0.006}px solid #2FD3A066` }} />
      <div style={{ position: 'absolute', right: lado * 0.07, top: lado * 0.16, width: lado * 0.22, height: lado * 0.22, borderRadius: '50%', background: '#FFC85733' }} />
      <Turbo cx={lado / 2} pies={lado * 0.47 + 485 * e} escala={e} pose={cara ?? { cara: { ojos: 'normal', boca: 'normal', cachetes: 1.1 }, brazos: [150, -150] }} />
    </div>
  );
};
const Recorte: React.FC<{ x: number; y: number; tam: number; col: number; fila: number }> = ({ x, y, tam, col, fila }) => {
  const lado = tam * 14; // el cuadrito ocupa `tam` px → la foto entera mide 14·tam
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: tam, height: tam, overflow: 'hidden', borderRadius: 10, border: `4px solid ${C.yt}`, boxShadow: `0 0 40px ${C.yt}55` }}>
      <div style={{ position: 'absolute', left: -col * tam, top: -fila * tam }}><Selfie lado={lado} /></div>
    </div>
  );
};

// ── 1 · El gancho: la entrevista. «¿Cómo ve una imagen un modelo como ViT?» → «¡Le mando la imagen a la API!»
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const presume = f >= VOZ.t1 - 4 && f < VOZ.t2 - 2;
  const encoge = f >= VOZ.t2 - 2;
  const cara = encoge ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, parpado: parpadeo(f, 40) }
    : presume ? { ojos: 'normal' as const, boca: boca(vol('t1', f)) ?? 'normal' as const }
    : { ojos: 'normal' as const, boca: 'normal' as const, parpado: parpadeo(f, 70) };
  const brazos: [number, number] = presume ? [150, -150] : encoge ? [80, -80] : [-30, 30];
  const salto = presume ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 24 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.p, C.o, C.b, C.y, C.p, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Cuando toda tu IA es un request con tu key" marcas={{ IA: LILA, key: NARANJA }} desde={-14} paso={2} tam={84} />
        </div>
        <Codigo x={70} y={436} ancho={940} desde={18} tam={30} lineas={[
          <><span style={{ color: C.ink3 }}>const</span> KEY = {KEY}<span style={{ color: C.ink3 }}>  // en el frontend</span></>,
          <>ia.<span style={{ color: VERDE }}>ver</span>(foto, KEY)<span style={{ color: C.ink3 }}>  // toda mi IA</span></>,
        ]} />
        <Llamada y={596} alto={440} mensaje="¿Cómo ve una imagen un modelo como ViT?" desde={PREGUNTA} />
        <Turbo cx={540} pies={1600 + salto} escala={0.5} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={200} y={960} ancho={680} desde={VOZ.t1} hasta={fin('t1') + 2} cola={330}>¡Fácil! ¡Le mando la imagen a la API!</Burbuja>
        <Burbuja quien="turbo" x={300} y={1040} ancho={480} desde={VOZ.t2} cola={240}>¡Ella ve! ¡Yo no!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 't2']} />
    </AbsoluteFill>
  );
};

// ── 2 · Los cuadritos: la foto de 224×224 se corta en cuadritos de 16×16 → 14×14 = 196.
const OJO = [5, 6] as const; // el cuadrito que se sigue: el ojo de Turbo (columna, fila)
const S = 560, X0 = (1080 - S) / 2, Y0 = 520, CELDA = S / 14;
const REJILLA = 52, CORTE = VOZ.n3 + 6, CUENTA0 = VOZ.n3 + 40, CUENTA1 = VOZ.n3 + 118;
const Parches: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const traza = interpolate(f, [REJILLA, REJILLA + 30], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const grosor = interpolate(f, [CORTE, CORTE + 14], [2, 7], clamp);
  const cuenta = Math.round(interpolate(f, [CUENTA0, CUENTA1], [0, 196], clamp));
  const total = spring({ frame: f - CUENTA1, fps: 30, config: { damping: 12 } });
  const medidas = interpolate(f, [REJILLA + 20, REJILLA + 32], [0, 1], clamp);
  const uno = interpolate(f, [REJILLA + 40, REJILLA + 50], [0, 1], clamp);
  const corta = f >= CORTE;
  return (
    <AbsoluteFill>
      <Fondo tinte={LILA} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <App texto="Lo que debiste responder" color={C.g} desde={0} />
          <Gancho texto="ViT corta la foto en cuadritos" marcas={{ cuadritos: C.yt }} desde={4} paso={3} tam={72} style={{ marginTop: 18 }} />
        </div>
        <div style={{ position: 'absolute', left: X0, top: Y0, width: S, height: S, borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px #0009' }}>
          <Selfie lado={S} cara={{ cara: corta ? { ojos: 'shock', cejas: 'arriba', boca: 'grito', cachetes: 1.1 } : { ojos: 'normal', boca: 'normal', cachetes: 1.1, parpado: parpadeo(f, 60) }, brazos: corta ? [40, -40] : [150, -150] }} />
          <svg width={S} height={S} style={{ position: 'absolute', inset: 0 }}>
            {Array.from({ length: 13 }, (_, k) => {
              const p = (k + 1) * CELDA, l = S * traza;
              return <g key={k} stroke={corta ? C.bg : '#FFFFFFcc'} strokeWidth={grosor}>
                <line x1={p} y1={0} x2={p} y2={l} /><line x1={0} y1={p} x2={l} y2={p} />
              </g>;
            })}
            {Array.from({ length: 196 }, (_, i) => i < cuenta && <rect key={i} x={(i % 14) * CELDA + 3} y={Math.floor(i / 14) * CELDA + 3} width={CELDA - 6} height={CELDA - 6} rx={4}
              fill={i === cuenta - 1 ? C.yt : `${C.yt}22`} />)}
            <rect x={OJO[0] * CELDA} y={OJO[1] * CELDA} width={CELDA} height={CELDA} fill="none" stroke={C.yt} strokeWidth={5} opacity={uno * (f < CUENTA0 ? 1 : 0)} />
          </svg>
        </div>
        {/* medidas */}
        <div style={{ position: 'absolute', left: X0, top: Y0 - 50, width: S, textAlign: 'center', font: `700 32px/1 ${MONO}`, color: C.ink2, opacity: medidas }}>← 224 px →</div>
        <div style={{ position: 'absolute', left: X0 + OJO[0] * CELDA + CELDA + 14, top: Y0 + OJO[1] * CELDA - 4, padding: '6px 12px', borderRadius: 10, background: C.yt, color: C.bg, font: `800 26px/1 ${MONO}`,
          opacity: uno * (f < CUENTA0 ? 1 : 0) }}>16×16 px</div>
        <div style={{ position: 'absolute', left: 70, top: Y0 + S + 34, width: 940, textAlign: 'center' }}>
          <div style={{ font: `850 76px/1 ${SANS}`, letterSpacing: '-0.03em', color: C.ink, opacity: interpolate(f, [CUENTA0 - 10, CUENTA0], [0, 1], clamp) }}>
            14 × 14 = <span style={{ color: C.yt, fontVariantNumeric: 'tabular-nums', display: 'inline-block', transform: `scale(${1 + 0.25 * total * (1 - total) * 4 * 0.3})` }}>{cuenta}</span>
          </div>
          <Linea desde={CUENTA1 + 4} tam={34} style={{ marginTop: 14 }}>224 ÷ 16 = 14 por lado → <b style={{ color: C.ink }}>196 cuadritos</b></Linea>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={0.6} habla={Math.max(vol('n2', f), vol('n3', f))} derecha />
        <Turbo cx={860} pies={1600} escala={0.34} pose={{ cara: corta ? { ojos: 'shock', cejas: 'arriba', boca: 'grito' } : { ojos: 'normal', parpado: parpadeo(f, 60, 20) }, brazos: corta ? [40, -40] : [0, 0] }} />
        <Burbuja quien="turbo" x={430} y={1262} ancho={330} desde={CORTE + 8} cola={300} tam={44}>¡Mi cara!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 'n3']} />
    </AbsoluteFill>
  );
};

// ── 3 · Cada cuadrito → un token. Se aplana (16·16·3 = 768 números), una capa lo vuelve vector. + posición + [CLS] = 197.
const PLANO = 40, VECTOR = 86, TOKEN = 112;
const POS = VOZ.n5 + 18, CLS = VOZ.n5 + 56, SIETE = VOZ.n5 + 100;
const Flecha: React.FC<{ x: number; y: number; desde: number; texto: string }> = ({ x, y, desde, texto }) => {
  const f = useCurrentFrame();
  const e = interpolate(f, [desde, desde + 10], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 110, textAlign: 'center', opacity: e }}>
      <div style={{ font: `600 22px/1.1 ${MONO}`, color: C.ink3 }}>{texto}</div>
      <svg width={110} height={40} style={{ display: 'block' }}><path d={`M8 20 L${8 + 86 * e} 20 M${84 * e} 8 L${8 + 86 * e} 20 L${84 * e} 32`} stroke={C.ink2} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
};
const COLS_PLANO = ['#3B4A8F', '#C98A5B', '#E9C29B', '#1A2250', '#F1D7BE', '#0B0F1F', '#FF9FB0', '#7A5236', '#2B1F4F', '#E9C29B', '#C98A5B', '#3B4A8F'];
const Tokens: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const ePlano = interpolate(f, [PLANO, PLANO + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const eVec = spring({ frame: f - VECTOR, fps: 30, config: { damping: 13 } });
  const ePos = interpolate(f, [POS, POS + 10], [0, 1], clamp);
  const eCls = spring({ frame: f - CLS, fps: 30, config: { damping: 12 } });
  const eSiete = spring({ frame: f - SIETE, fps: 30, config: { damping: 12 } });
  const fila = [1, 2, 3, 4, 5, 196];
  const ch = 104, gap = 14;
  return (
    <AbsoluteFill>
      <Fondo tinte={C.yt} tinte2={LILA} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Cada cuadrito se vuelve un token" marcas={{ token: LILA }} desde={0} paso={3} tam={72} />
          <Linea desde={TOKEN} tam={32} style={{ marginTop: 12 }}><b style={{ color: LILA }}>Token</b> = la pieza que lee un transformer. En texto, una palabra (o un pedazo).</Linea>
        </div>
        {/* el cuadrito → los números en fila → el vector */}
        <Recorte x={70} y={520} tam={170} col={OJO[0]} fila={OJO[1]} />
        <div style={{ position: 'absolute', left: 70, top: 700, width: 170, textAlign: 'center', font: `600 24px/1.2 ${MONO}`, color: C.ink3 }}>16×16 px<br /><b style={{ color: C.ink }}>(un ojo)</b></div>
        <Flecha x={246} y={565} desde={PLANO - 6} texto="aplanar" />
        <div style={{ position: 'absolute', left: 362, top: 520, width: 300, height: 170, display: 'flex', gap: 2, opacity: ePlano, transform: `scaleX(${0.3 + 0.7 * ePlano})`, transformOrigin: '0% 50%' }}>
          {Array.from({ length: 48 }, (_, k) => <i key={k} style={{ flex: 1, height: `${55 + 45 * Math.abs(Math.sin(k * 1.7))}%`, alignSelf: 'center', borderRadius: 2, background: COLS_PLANO[(k * 5) % COLS_PLANO.length] }} />)}
        </div>
        <div style={{ position: 'absolute', left: 362, top: 700, width: 300, textAlign: 'center', font: `600 24px/1.2 ${MONO}`, color: C.ink3, opacity: ePlano }}>16·16·3 colores<br /><b style={{ color: C.ink }}>= 768 números</b></div>
        <Flecha x={668} y={565} desde={VECTOR - 8} texto="capa" />
        <div style={{ position: 'absolute', left: 790, top: 506, width: 70, display: 'flex', flexDirection: 'column', gap: 4, opacity: Math.min(1, eVec * 1.4), transform: `scale(${0.6 + 0.4 * eVec})` }}>
          {Array.from({ length: 10 }, (_, k) => <i key={k} style={{ height: 16, borderRadius: 4, background: LILA, opacity: 0.35 + 0.65 * Math.abs(Math.sin(k * 2.3 + 1)) }} />)}
        </div>
        <div style={{ position: 'absolute', left: 870, top: 540, width: 150, font: `700 28px/1.2 ${SANS}`, color: LILA, opacity: interpolate(f, [TOKEN - 6, TOKEN + 4], [0, 1], clamp) }}>vector<br />= token</div>
        {/* la fila de tokens: [CLS] + 1 … 196, cada uno con su posición */}
        <div style={{ position: 'absolute', left: 70, top: 830, width: 940, opacity: interpolate(f, [VOZ.n5 - 12, VOZ.n5], [0, 1], clamp) }}>
          <div style={{ font: `600 30px/1.2 ${SANS}`, color: C.ink2 }}>La foto, como una frase:</div>
          <div style={{ position: 'relative', marginTop: 22, height: ch + 44 }}>
            {fila.map((n, i) => {
              const x = (ch + gap) * (i + (i === 5 ? 0.6 : 0)) + eCls * (ch + gap);
              return <div key={n} style={{ position: 'absolute', left: x, top: 0, width: ch, height: ch, borderRadius: 16, background: `${LILA}2a`, border: `3px solid ${LILA}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 34px/1 ${MONO}`, color: C.ink }}>
                ▦
                <span style={{ position: 'absolute', bottom: -40, left: 0, right: 0, textAlign: 'center', font: `700 24px/1 ${MONO}`, color: C.yt, opacity: ePos }}>+p{n}</span>
              </div>;
            })}
            <div style={{ position: 'absolute', left: (ch + gap) * 5 + eCls * (ch + gap) - 6, top: 30, font: `800 40px/1 ${SANS}`, color: C.ink3 }}>…</div>
            <div style={{ position: 'absolute', left: 0, top: 0, width: ch, height: ch, borderRadius: 16, background: C.yt, display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: `850 28px/1 ${MONO}`, color: C.bg, opacity: Math.min(1, eCls * 1.4), transform: `scale(${0.4 + 0.6 * eCls})`, boxShadow: `0 0 40px ${C.yt}88` }}>[CLS]
              <span style={{ position: 'absolute', bottom: -40, left: 0, right: 0, textAlign: 'center', font: `700 24px/1 ${MONO}`, color: C.yt }}>+p0</span>
            </div>
          </div>
          <Linea desde={POS} tam={30} style={{ marginTop: 6 }}><b style={{ color: C.yt }}>+p</b> = su posición: dónde iba el cuadrito.</Linea>
          <Linea desde={CLS + 6} tam={30} style={{ marginTop: 6 }}><b style={{ color: C.yt }}>[CLS]</b> = un token extra que resume toda la imagen.</Linea>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1262, width: 940, textAlign: 'center', font: `850 70px/1 ${SANS}`, letterSpacing: '-0.03em', color: C.ink,
          opacity: Math.min(1, eSiete * 1.4), transform: `scale(${0.7 + 0.3 * eSiete})` }}>
          196 + 1 = <span style={{ color: C.yt }}>197 tokens</span>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={0.6} habla={Math.max(vol('n4', f), vol('n5', f))} derecha />
        <Turbo cx={800} pies={1600} escala={0.34} pose={{ cara: { ojos: f > SIETE ? 'shock' : 'normal', cejas: f > SIETE ? 'arriba' : undefined, parpado: f > SIETE ? 0 : parpadeo(f, 55, 10) }, brazos: [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n4', 'n5']} />
    </AbsoluteFill>
  );
};

// ── 4 · El mismo transformer que lee texto: una foto = 196 palabras.
const TXT = 20, IMG = 40, CAJA = 60, PALABRAS = 92;
const Palabras: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const eCaja = spring({ frame: f - CAJA, fps: 30, config: { damping: 13 } });
  const eGrande = spring({ frame: f - PALABRAS, fps: 30, config: { damping: 11, mass: 0.7 } });
  const fichas = (lista: string[], desde: number, y: number, color: string) => lista.map((t, i) => {
    const e = spring({ frame: f - desde - i * 3, fps: 30, config: { damping: 14 } });
    return <div key={i} style={{ position: 'absolute', left: 70 + i * 132, top: y, width: 120, height: 76, borderRadius: 14, background: `${color}26`, border: `3px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', font: `700 28px/1 ${SANS}`, color: C.ink, opacity: Math.min(1, e * 1.4), transform: `translateY(${(1 - e) * 30}px)` }}>{t}</div>;
  });
  return (
    <AbsoluteFill>
      <Fondo tinte={LILA} tinte2={C.g} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 226, width: 940 }}>
          <Gancho texto="Y entran al mismo transformer que lee texto" marcas={{ mismo: C.g }} desde={0} paso={2} tam={70} />
        </div>
        <div style={{ position: 'absolute', left: 70, top: 440, font: `600 26px/1 ${MONO}`, color: C.ink3, opacity: interpolate(f, [TXT, TXT + 8], [0, 1], clamp) }}>TEXTO</div>
        {fichas(['El', 'gato', 'duerme', 'en', 'la', 'silla', '…'], TXT, 478, C.g)}
        <div style={{ position: 'absolute', left: 70, top: 584, font: `600 26px/1 ${MONO}`, color: C.ink3, opacity: interpolate(f, [IMG, IMG + 8], [0, 1], clamp) }}>FOTO</div>
        {fichas(['[CLS]', '▦ 1', '▦ 2', '▦ 3', '▦ 4', '▦ 5', '…'], IMG, 622, LILA)}
        <svg width={1080} height={120} style={{ position: 'absolute', left: 0, top: 706, opacity: eCaja }}>
          {[160, 540, 920].map((x) => <path key={x} d={`M${x} 10 L${540 + (x - 540) * 0.3} 100`} stroke={C.ink3} strokeWidth={5} strokeDasharray="10 10" strokeDashoffset={-f} fill="none" />)}
        </svg>
        <div style={{ position: 'absolute', left: 190, top: 826, width: 700, padding: '30px 34px', borderRadius: 26, background: `linear-gradient(135deg, ${C.card}, #1E2450)`,
          border: `3px solid ${C.acc}`, boxShadow: `0 0 ${50 * eCaja}px ${C.acc}66`, textAlign: 'center', opacity: Math.min(1, eCaja * 1.4), transform: `scale(${0.8 + 0.2 * eCaja})` }}>
          <div style={{ font: `850 52px/1 ${SANS}`, color: C.ink }}>Transformer</div>
          <div style={{ marginTop: 12, font: `500 28px/1.3 ${SANS}`, color: C.ink2 }}>compara cada token con todos los demás (<b style={{ color: C.ink }}>atención</b>)</div>
        </div>
        <div style={{ position: 'absolute', left: 70, top: 1080, width: 940, textAlign: 'center', opacity: Math.min(1, eGrande * 1.4), transform: `scale(${0.6 + 0.4 * eGrande})` }}>
          <div style={{ font: `850 96px/1 ${SANS}`, letterSpacing: '-0.04em', color: C.ink }}>1 foto = <span style={{ color: C.yt }}>196</span> palabras</div>
          <div style={{ marginTop: 18, font: `500 28px/1.3 ${MONO}`, color: C.ink3 }}>ViT-B/16 · foto de 224×224 · ≈86 M parámetros</div>
        </div>
        <Debug x={60} y={1440} escala={1} ceja={0.6} habla={vol('n6', f)} derecha />
        <Turbo cx={800} pies={1600} escala={0.34} pose={{ cara: { ojos: f > PALABRAS ? 'shock' : 'normal', cejas: f > PALABRAS ? 'arriba' : undefined, boca: f > PALABRAS ? 'grito' : 'normal', parpado: f > PALABRAS ? 0 : parpadeo(f, 50) }, brazos: f > PALABRAS ? [90, -90] : [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n6']} />
    </AbsoluteFill>
  );
};

// ── 5 · El remate: «¡Mando 196 requests! Con mi key: está en el frontend, ¿te la paso?». El entrevistador cuelga.
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const fuera = interpolate(f, [SALE, SALE + 10], [0, 1], clamp);
  const req = Math.round(interpolate(f, [VOZ.t3 + 20, VOZ.t3 + 90], [0, 196], { ...clamp, easing: Easing.in(Easing.quad) }));
  const habla = Math.max(vol('t3', f), vol('t4', f));
  const cara = f < GRACIAS ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(habla) ?? 'normal' as const, parpado: parpadeo(f, 45) }
    : { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const };
  const brazos: [number, number] = f < fin('t3') ? [150, -150] : f < GRACIAS ? [100, -20] : [20, -20];
  const salto = f < fin('t3') ? -Math.abs(Math.sin(f / 5)) * 24 : 0;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.b, C.o, C.g]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <Llamada y={226} alto={480} mensaje="Gracias. Nosotros te llamamos." desde={GRACIAS} fuera={fuera} />
        <Codigo x={70} y={736} ancho={940} desde={VOZ.t3 + 14} tam={30} lineas={[
          <><span style={{ color: C.ink3 }}>for</span> (i = 0; i {'<'} 196; i++)</>,
          <>  ia.<span style={{ color: VERDE }}>ver</span>(cuadrito[i], KEY)</>,
          <><span style={{ color: C.ink3 }}>// requests enviados: </span><b style={{ color: req === 196 ? NARANJA : C.ink, fontVariantNumeric: 'tabular-nums' }}>{req}</b></>,
        ]} />
        <Turbo cx={540} pies={1600 + salto} escala={0.5} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={200} y={1000} ancho={680} desde={VOZ.t3} hasta={fin('t3') + 2} cola={330}>¡Ya entendí! ¡Mando 196 requests!</Burbuja>
        <Burbuja quien="turbo" x={200} y={960} ancho={680} desde={VOZ.t4} hasta={GRACIAS + 20} cola={330}>¡Con mi key! Está en el frontend. ¿Te la paso?</Burbuja>
        <Debug x={60} y={1440} escala={1} ceja={1} habla={0} derecha />
      </AbsoluteFill>
      <Voces ids={['t3', 't4']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="atlas-vit" color={LILA} frase={<>ViT, CLIP, SAM y más: <span style={{ color: VIVOS[2] }}>diagrama, dimensiones y parámetros</span>, en el Atlas de Arquitecturas</>} />
    <Voces ids={['n7']} />
  </AbsoluteFill>
);

export const ReelAtlasVit: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, parches: Parches, tokens: Tokens, palabras: Palabras, remate: Remate, cierre: CierreEscena }} />
);
