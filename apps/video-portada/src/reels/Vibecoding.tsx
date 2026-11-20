// Reel 11 · «Cuando crees que el vibecoding es suficiente».
// Turbo entrega una API que escribió la IA y que «funciona»; en la entrevista le piden explicar una línea
// (`except Exception: pass`) y resulta que su API solo escondía los errores. Debug le da lo que debió saber:
// leer el error, poder explicar cada línea y escribir un test. Remate: Turbo le pide a la IA que lo arregle y ella
// solo pide perdón en loop. Con voz (src/reels/dialogos/11-vibecoding.json, tools/voz.mjs), igual que el reel 09.
// Sin marcas reales: «la IA», «el entrevistador».
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/11-vibecoding.tiempos.json';

const ID = '11-vibecoding';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 82,
  n2: 6, t2: 78, n3: 128, t3: 284,
  n4: 4, n5: 196, n6: 354, n7: 458,
  t4: 4, t5: 146,
  n8: 10,
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

const ROJO = '#FF8A5C', VERDE = '#2FD3A0';

// La API que escribió la IA. Las líneas 5 y 6 son el problema: se tragan cualquier error.
const API = [
  '@app.get("/precio/{id}")',
  'def precio(id: int):',
  '    try:',
  '        return {"precio": tabla[id]}',
  '    except Exception:',
  '        pass',
];

/** Colorea una línea de Python lo justo para que se lea como código. */
const Py: React.FC<{ s: string }> = ({ s }) => {
  const partes = s.split(/("[^"]*"|\b(?:def|return|try|except|pass|assert)\b|@\w+(?:\.\w+)?|\b\d+\b)/g);
  return <>{partes.map((p, i) => {
    const color = /^"/.test(p) ? C.yt : /^(def|return|try|except|pass|assert)$/.test(p) ? '#C9A4FF' : /^@/.test(p) ? VERDE : /^\d+$/.test(p) ? ROJO : undefined;
    return <span key={i} style={color ? { color } : undefined}>{p}</span>;
  })}</>;
};

/** Ventana de editor con líneas de código. `ver` = cuántas líneas se ven (para el «tecleo»); `marca` resalta líneas. */
const Editor: React.FC<{ x: number; y: number; w: number; titulo: string; lineas: string[]; ver?: number; marca?: number[]; colorMarca?: string; tam?: number; extra?: React.ReactNode; derecha?: React.ReactNode }> =
  ({ x, y, w, titulo, lineas, ver = lineas.length, marca = [], colorMarca = C.yt, tam = 31, extra, derecha }) => (
    <div style={{ position: 'absolute', left: x, top: y, width: w, background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 26, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: `2px solid ${C.line}`, font: `600 25px/1 ${MONO}`, color: C.ink3 }}>
        {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />)}
        <span style={{ marginLeft: 12, flex: 1 }}>{titulo}</span>
        {derecha}
      </div>
      <div style={{ padding: '16px 0', font: `500 ${tam}px/1.5 ${MONO}`, color: C.ink, whiteSpace: 'pre' }}>
        {lineas.map((l, i) => i < Math.floor(ver) && (
          <div key={i} style={{ display: 'flex', padding: '0 24px', background: marca.includes(i) ? `${colorMarca}2a` : undefined, boxShadow: marca.includes(i) ? `inset 6px 0 0 ${colorMarca}` : undefined }}>
            <span style={{ width: 44, color: C.ink3, flexShrink: 0 }}>{i + 1}</span><Py s={l} />
          </div>
        ))}
        {extra}
      </div>
    </div>
  );

/** Debug entra deslizándose desde la izquierda. */
const DebugEntra: React.FC<{ desde: number; y: number; ceja: number; habla: number }> = ({ desde, y, ceja, habla }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [desde, desde + 14], [-260, 60], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return <Debug x={x} y={y} escala={1.15} ceja={ceja} habla={habla} derecha />;
};

/** Píldora de estado (200 OK, FAILED…) que entra con resorte. */
const Estado: React.FC<{ texto: string; color: string; desde: number; tam?: number }> = ({ texto, color, desde, tam = 26 }) => {
  const e = useEntrada(desde, 12);
  if (useCurrentFrame() < desde) return null;
  return <span style={{ padding: '8px 16px', borderRadius: 999, background: color, color: C.bg, font: `800 ${tam}px/1 ${MONO}`, opacity: e, transform: `scale(${0.5 + 0.5 * e})`, display: 'inline-block', boxShadow: `0 0 30px ${color}88` }}>{texto}</span>;
};

// ── 1 · El gancho: la IA escribe la API, responde 200 y Turbo festeja sin haberla leído.
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const ver = interpolate(f, [8, 58], [0, API.length], clamp);
  const festeja = f >= VOZ.t1 - 4 && f < fin('t1') + 6;
  const salto = festeja ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 40 : 0;
  const cara = festeja ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'grito' as const }
    : { parpado: parpadeo(f, 60, 10), boca: 'normal' as const };
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.p, C.b, C.g, C.p, C.y, C.b]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando crees que el vibecoding es suficiente" marcas={{ vibecoding: C.p }} desde={-14} paso={2} tam={92} />
          <Linea desde={24} tam={36} style={{ marginTop: 20 }}><b style={{ color: C.yt }}>Vibecoding</b> = pedirle todo el código a la IA y aceptarlo sin leerlo.</Linea>
        </div>
        <Editor x={70} y={640} w={940} titulo="api.py · lo escribió la IA" lineas={API} ver={ver} tam={26}
          derecha={<Estado texto="✓ 200 OK" color={VERDE} desde={64} />} />
        <Turbo cx={540} pies={1610 + salto} escala={0.6} pose={{ cara, brazos: festeja ? [150, -150] : [0, 0] }} />
        <Burbuja quien="turbo" x={110} y={1010} ancho={860} desde={VOZ.t1} cola={430}>¡Ni la leí y funciona! ¡Contrátenme!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1']} />
    </AbsoluteFill>
  );
};

// ── 2 · La entrevista: «explícame esta línea». Turbo no sabe; Debug: se traga los errores y la API responde 200… con nada.
const Entrevista: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const revela = f >= VOZ.n3;
  const cara = f >= VOZ.t3 - 4 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t3', f)) ?? 'normal' as const, cachetes: 1.1 }
    : f >= VOZ.t2 - 4 && f < VOZ.n3 ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'mueca' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 70, 30) };
  const brazos: [number, number] = f >= VOZ.t2 - 4 && f < VOZ.n3 ? [60, -60] : f >= VOZ.t3 - 4 ? [150, -150] : [-8, 8];
  const temblor = f >= VOZ.t3 && f < VOZ.t3 + 20 ? Math.sin(f * 3.1) * 6 : 0;
  const flecha = interpolate(f, [22, 34], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
  return (
    <AbsoluteFill>
      <Fondo tinte={C.b} tinte2={C.o} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <App texto="Entrevista · en vivo" color={C.o} desde={0} />
          <div style={{ marginTop: 22, font: `700 30px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>EL ENTREVISTADOR:</div>
          <Gancho texto="«Explícame esta línea.»" marcas={{ línea: C.yt }} desde={6} paso={3} tam={84} style={{ marginTop: 10 }} />
        </div>
        <Editor x={70} y={500} w={940} titulo="api.py" lineas={API} marca={f >= 20 ? [4, 5] : []} colorMarca={revela ? ROJO : C.yt} tam={30} />
        <div style={{ position: 'absolute', left: 600, top: 760, opacity: flecha, transform: `translateX(${(1 - flecha) * 40}px)`, font: `800 40px/1 ${SANS}`, color: revela ? ROJO : C.yt }}>
          ← {revela ? 'se traga el error' : '¿esto?'}
        </div>
        {revela && (
          <div style={{ position: 'absolute', left: 70, top: 890, width: 940 }}>
            <Linea desde={VOZ.n3} tam={40} color={C.ink}><b style={{ color: ROJO, fontFamily: MONO }}>except: pass</b> = si algo falla, hazte de la vista gorda.</Linea>
            <Linea desde={VOZ.n3 + 66} tam={34} style={{ marginTop: 18 }}>
              <span style={{ fontFamily: MONO, color: C.ink }}>GET /precio/99</span>{'  →  '}
              <span style={{ fontFamily: MONO, color: VERDE, fontWeight: 800 }}>200 OK</span>
              <span style={{ fontFamily: MONO, color: C.ink3 }}>{'  ·  null'}</span>
            </Linea>
            <Linea desde={VOZ.n3 + 80} tam={34} style={{ marginTop: 6 }}>No «funcionaba»: <b style={{ color: C.ink }}>escondía los errores</b>.</Linea>
          </div>
        )}
        <DebugEntra desde={VOZ.n3 - 16} y={1415} ceja={interpolate(f, [VOZ.n3, VOZ.n3 + 8], [0, 1], clamp)} habla={vol('n3', f)} />
        <Turbo cx={790 + temblor} pies={1590} escala={0.5} pose={{ cara, brazos }} />
        <Burbuja quien="turbo" x={450} y={1080} ancho={560} desde={VOZ.t2} hasta={fin('t2') + 16} cola={330} tam={50}>Eh… ¿es decoración?</Burbuja>
        <Burbuja quien="turbo" x={330} y={1150} ancho={360} desde={VOZ.t3} cola={320} tam={66}>¡¿QUÉ?!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n2', 't2', 'n3', 't3']} />
    </AbsoluteFill>
  );
};

// ── 3 · Lo que debiste saber: la IA escribe, tú lees, depuras y explicas. Tres cosas concretas.
const INICIO = [VOZ.n5, VOZ.n6, VOZ.n7];
const TITULOS = ['Lee el error de abajo hacia arriba', 'Si no puedes explicar una línea, no la entregues', 'Escribe un test'];
const TRACEBACK = [
  'Traceback (most recent call last):',
  '  …',
  '  File "api.py", line 4, in precio',
  '    return {"precio": tabla[id]}',
  'KeyError: 99',
];
const TEST = [
  'def test_precio_que_no_existe():',
  '    r = client.get("/precio/99")',
  '    assert r.status_code == 404',
];

const Punto: React.FC<{ i: number; t: number }> = ({ i, t }) => {
  if (i === 0) {
    const ult = interpolate(t, [20, 32], [0, 1], clamp), donde = interpolate(t, [60, 72], [0, 1], clamp);
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ background: '#070B19', border: `2px solid ${C.line}`, borderRadius: 22, padding: '26px 30px', font: `500 33px/1.6 ${MONO}`, color: C.ink2, whiteSpace: 'pre' }}>
          {TRACEBACK.map((l, k) => (
            <div key={k} style={{ color: k === 4 ? (ult > 0.5 ? ROJO : C.ink) : k === 2 && donde > 0.5 ? C.yt : undefined, fontWeight: k === 4 ? 800 : 500,
              background: k === 4 ? `${ROJO}${Math.round(ult * 0x30).toString(16).padStart(2, '0')}` : k === 2 ? `${C.yt}${Math.round(donde * 0x22).toString(16).padStart(2, '0')}` : undefined, borderRadius: 8, padding: '0 8px', margin: '0 -8px' }}>{l}</div>
          ))}
        </div>
        <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ opacity: ult, font: `800 46px/1.2 ${SANS}`, color: ROJO }}>↑ La última línea: qué falló.</span>
          <span style={{ opacity: donde, font: `800 46px/1.2 ${SANS}`, color: C.yt }}>Arriba de ella: dónde.</span>
        </div>
        <div style={{ marginTop: 16, font: `500 28px/1.3 ${SANS}`, color: C.ink3 }}>(Resumido. Así se ve sin el «except: pass».)</div>
      </div>
    );
  }
  if (i === 1) {
    const n = interpolate(t, [10, 60], [0, API.length], clamp);
    return (<>
      <div style={{ background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 22, padding: '24px 0', font: `500 30px/2 ${MONO}`, color: C.ink, whiteSpace: 'pre' }}>
        {API.map((l, k) => {
          const visto = k < n, malo = k >= 4;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', padding: '0 24px' }}>
              <span style={{ flex: 1 }}><Py s={l} /></span>
              <span style={{ width: 230, textAlign: 'right', font: `800 28px/1 ${SANS}`, color: malo ? ROJO : VERDE, opacity: visto ? 1 : 0 }}>{malo ? '¿por qué?' : '✓ sé qué hace'}</span>
            </div>
          );
        })}
      </div>
      <Linea desde={VOZ.n6 + 66} tam={42} style={{ marginTop: 30 }}>«Lo escribió la IA» <b style={{ color: C.ink }}>no es una explicación</b>.</Linea>
    </>);
  }
  const corre = t >= 60;
  return (
    <div>
      <Editor x={0} y={0} w={940} titulo="test_api.py" lineas={TEST} tam={32} />
      <div style={{ position: 'absolute', left: 0, top: 290, width: 940, display: 'flex', alignItems: 'center', gap: 18, opacity: corre ? 1 : 0 }}>
        <Estado texto="FAILED" color={ROJO} desde={VOZ.n7 + 60} tam={36} />
        <span style={{ font: `600 36px/1 ${MONO}`, color: C.ink2 }}>assert 200 == 404</span>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 380, width: 940 }}>
        {t >= 76 && <Linea desde={VOZ.n7 + 76} tam={46} color={C.ink}>Bug atrapado <b style={{ color: VERDE }}>antes</b> de la entrevista.</Linea>}
      </div>
    </div>
  );
};

const Leccion: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const enPuntos = f >= INICIO[0] - 6;
  const actual = INICIO.reduce((a, s, i) => (f >= s ? i : a), 0);
  const t = f - INICIO[actual];
  const e = interpolate(t, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const intro = interpolate(f, [INICIO[0] - 14, INICIO[0] - 2], [1, 0], clamp);
  const habla = Math.max(...(['n4', 'n5', 'n6', 'n7'] as Linea[]).map((id) => vol(id, f)));
  const cara = f >= VOZ.n7 + 60 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 80, 20) };
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <App texto="Lo que debiste saber" color={C.yt} desde={0} />
        </div>
        {intro > 0 && (
          <div style={{ position: 'absolute', left: 70, top: 330, width: 940, opacity: intro }}>
            <Gancho texto="La IA escribe el código." marcas={{ IA: C.p }} desde={30} paso={3} tam={84} />
            <Gancho texto="Leerlo, depurarlo y explicarlo te toca a ti." marcas={{ ti: C.g }} desde={80} paso={3} tam={84} style={{ marginTop: 26 }} />
            <Linea desde={110} tam={42} style={{ marginTop: 40 }}>Y en la entrevista en vivo, <b style={{ color: C.ink }}>no hay IA</b>.</Linea>
          </div>
        )}
        {enPuntos && (
          <>
            <div style={{ position: 'absolute', left: 70, top: 320, width: 940, opacity: e, transform: `translateY(${(1 - e) * 20}px)` }}>
              <div style={{ font: `700 30px/1 ${MONO}`, color: C.ink3, letterSpacing: '0.08em' }}>{actual + 1} DE 3</div>
              <div style={{ marginTop: 14, font: `850 ${actual === 1 ? 64 : 76}px/1.04 ${SANS}`, letterSpacing: '-0.04em', color: VIVOS[[0, 2, 4][actual]] }}>{TITULOS[actual]}</div>
            </div>
            <div style={{ position: 'absolute', left: 70, top: 560, width: 940, opacity: e }}>
              <Punto i={actual} t={t} />
            </div>
          </>
        )}
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={habla} derecha />
        <Turbo cx={800} pies={1590} escala={0.45} pose={{ cara, brazos: [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n4', 'n5', 'n6', 'n7']} />
    </AbsoluteFill>
  );
};

// ── 4 · El remate: Turbo le pide a la IA que lo arregle y la IA solo pide perdón, en loop.
const PERDON = [52, 86, 118, 186];
const Remate: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sale = useSalida(10);
  const enojado = f >= VOZ.t5 - 4;
  const cara = enojado ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t5', f)) ?? 'mueca' as const }
    : f < fin('t4') ? { ojos: 'normal' as const, cejas: 'enojado' as const, boca: boca(vol('t4', f)) ?? 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 40, 5) };
  const temblor = enojado && f < VOZ.t5 + 40 ? Math.sin(f * 3.1) * 7 : 0;
  const mensajes: { de: 'yo' | 'ia'; desde: number }[] = [{ de: 'yo', desde: 14 }, ...PERDON.map((d) => ({ de: 'ia' as const, desde: d }))];
  const n = mensajes.filter((m) => f >= m.desde).length;
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.b, C.o, C.p]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 236, width: 940, height: 700, background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 28, boxShadow: '0 30px 80px #0008', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 26px', borderBottom: `2px solid ${C.line}`, font: `700 28px/1 ${SANS}`, color: C.ink }}>
            <span style={{ width: 40, height: 40, borderRadius: 20, background: `linear-gradient(135deg, ${C.p}, ${C.acc})`, display: 'grid', placeItems: 'center', fontSize: 24 }}>✦</span>
            Chat con la IA
            <span style={{ marginLeft: 'auto', font: `700 26px/1 ${MONO}`, color: ROJO, opacity: n > 2 ? 1 : 0 }}>perdones: {Math.max(0, n - 1)}</span>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 80, bottom: 0, overflow: 'hidden', padding: '0 26px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 18 }}>
            {mensajes.slice(0, n).map((m, i) => {
              const e = spring({ frame: f - m.desde, fps, config: { damping: 13, mass: 0.5, stiffness: 200 } });
              return m.de === 'yo'
                ? <div key={i} style={{ alignSelf: 'flex-end', maxWidth: 560, padding: '18px 24px', borderRadius: 24, background: C.o, color: C.bg, font: `800 34px/1.2 ${SANS}`, transform: `scale(${0.6 + 0.4 * e})`, transformOrigin: '100% 100%' }}>arregla mi API</div>
                : <div key={i} style={{ alignSelf: 'flex-start', maxWidth: 760, padding: '18px 24px', borderRadius: 24, background: '#1E2752', border: `2px solid ${C.p}66`, transform: `scale(${0.6 + 0.4 * e})`, transformOrigin: '0% 100%' }}>
                  <div style={{ font: `600 32px/1.25 ${SANS}`, color: C.ink }}>¡Tienes razón! Perdón por la confusión. Aquí está el código corregido. ✨</div>
                  {f >= m.desde + 14 && <div style={{ marginTop: 10, font: `800 28px/1 ${MONO}`, color: ROJO }}>✕ sigue fallando</div>}
                </div>;
            })}
          </div>
        </div>
        <Turbo cx={540 + temblor} pies={1590} escala={0.6} pose={{ cara, brazos: enojado ? [44, -44] : [20, -20] }} />
        <Burbuja quien="turbo" x={250} y={990} ancho={640} desde={VOZ.t4} hasta={fin('t4') + 10} cola={290}>¡Bah! ¡IA, arregla mi API!</Burbuja>
        <Burbuja quien="turbo" x={230} y={990} ancho={660} desde={VOZ.t5} cola={310} tam={58}>¡DEJA DE PEDIR PERDÓN!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 't5']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="vibecoding" color={C.p} frase={<>Leer, depurar y explicar, <span style={{ color: VIVOS[4] }}>paso a paso</span></>} />
    <Voces ids={['n8']} />
  </AbsoluteFill>
);

export const ReelVibecoding: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, entrevista: Entrevista, leccion: Leccion, remate: Remate, cierre: CierreEscena }} />
);
