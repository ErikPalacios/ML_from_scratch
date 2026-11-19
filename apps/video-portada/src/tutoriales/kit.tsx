// Piezas de los videos explicativos (1920×1080): cómo se usa cada herramienta, paso a paso.
// A la izquierda va la lista de pasos (el actual encendido). A la derecha, una ventana plana con la grabación real,
// con una cámara que se acerca a lo importante y aros que rodean el botón o el bloque del que se habla
// (las cajas salen de src/marcas.json, que escribe la grabación). Abajo, el subtítulo que explica qué está pasando.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, ETAPAS, MONO, SANS } from '../tema';
import { camara, Franja, Fondo, Marca, useEntrada } from '../piezas';
import { durPaso, durTramo, frameMarca, frameSub, inicioTramo, marca, type Aro, type Caja, type Guion, type Paso, type Sub, type Tramo } from './tiempo';
export * from './tiempo';
const FPS = 30;

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
// ----------------------------------------------------------------- texto con *resaltes*
export const Rico: React.FC<{ t: string; color: string }> = ({ t, color }) => (
  <>{t.split('*').map((s, i) => i % 2 ? <b key={i} style={{ color, fontWeight: 750 }}>{s}</b> : <React.Fragment key={i}>{s}</React.Fragment>)}</>
);

// ----------------------------------------------------------------- la grabación con cámara y aros
const AroVisible: React.FC<{ caja: Caja; local: number; ini: number; fin: number; color: string; texto?: string; lado?: Aro['lado'] }> = ({ caja, local, ini, fin, color, texto, lado = 'arriba' }) => {
  const { fps } = useVideoConfig();
  const e = spring({ frame: local - ini, fps, config: { damping: 14, mass: 0.6, stiffness: 160 } });
  const sale = interpolate(local, [fin - 8, fin], [1, 0], clamp);
  if (local < ini || local > fin) return null;
  const pulso = 1 + 0.025 * Math.sin((local - ini) / 5);
  const s = (1.25 - 0.25 * e) * pulso;
  const pos: React.CSSProperties = lado === 'abajo' ? { top: '100%', left: 0, marginTop: 14 } : lado === 'izq' ? { right: '100%', top: '50%', marginRight: 16, transform: 'translateY(-50%)' }
    : lado === 'der' ? { left: '100%', top: '50%', marginLeft: 16, transform: 'translateY(-50%)' } : { bottom: '100%', left: 0, marginBottom: 14 };
  return (
    <div style={{ position: 'absolute', left: `${caja.x! * 100}%`, top: `${caja.y! * 100}%`, width: `${caja.w! * 100}%`, height: `${caja.h! * 100}%`, opacity: e * sale, zIndex: 5 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 14, border: `4px solid ${color}`, boxShadow: `0 0 0 6px ${color}33, 0 0 40px ${color}88`, transform: `scale(${s})` }} />
      {texto && (
        <div style={{ position: 'absolute', ...pos, whiteSpace: 'nowrap', padding: '10px 18px', borderRadius: 12, background: color, color: C.bg, font: `750 24px/1 ${SANS}`, boxShadow: `0 10px 30px -8px ${color}` }}>{texto}</div>
      )}
    </div>
  );
};

const TramoVideo: React.FC<{ tramo: Tramo; local: number; color: string; adelanto: number }> = ({ tramo, local, color, adelanto }) => {
  const ini = inicioTramo(tramo), vel = tramo.vel || 1;
  // segundo de grabación → frame local
  const aFrame = (t: number) => ((t - ini) / vel) * FPS;
  const cam = (tramo.cam || [{ f: 0, z: 1, x: 0.5, y: 0.5 }]).map((c) => {
    const f = c.fm ? frameMarca(tramo, c.fm) + (c.df ?? 0) : (c.f ?? 0);
    if (!c.m) return { f, z: c.z, x: c.x ?? 0.5, y: c.y ?? 0.5 };
    const b = marca(tramo.src, c.m);
    return { f, z: c.z, x: b.x! + b.w! / 2 + (c.dx ?? 0), y: b.y! + b.h! / 2 + (c.dy ?? 0) };
  }).sort((a, b) => a.f - b.f);
  return (
    <div style={{ position: 'absolute', inset: 0, transform: camara(local, cam), transformOrigin: '50% 50%', willChange: 'transform' }}>
      <OffthreadVideo src={staticFile(`capturas/${tramo.src}.mp4`)} trimBefore={Math.max(0, Math.round(ini * FPS - adelanto * vel))} playbackRate={vel} muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      {(tramo.aros || []).map((a, i) => {
        const b = marca(tramo.src, a.m);
        return <AroVisible key={i} caja={b} local={local} ini={aFrame(b.t)} fin={aFrame(b.t + (a.s ?? 2.4))} color={a.color || color} texto={a.texto} lado={a.lado} />;
      })}
    </div>
  );
};

/** Ventana de navegador casi plana (un tutorial se tiene que leer), con los tramos en fila y fundido entre ellos. */
export const Pantalla: React.FC<{ tramos: Tramo[]; x: number; y: number; ancho: number; color: string; desde?: number }> = ({ tramos, x, y, ancho, color, desde = 0 }) => {
  const f = useCurrentFrame();
  const e = useEntrada(desde, 20, 1.1);
  const alto = ancho * 9 / 16;
  const t = f - desde;
  let acc = 0, url = tramos[0]?.url ?? '';
  const capas: React.ReactNode[] = [];
  tramos.forEach((c, i) => {
    const ini = acc, fin = acc + durTramo(c); acc = fin;
    if (t >= ini) url = c.url;
    const fundido = 8;
    if (t < ini - fundido || t > fin + (i === tramos.length - 1 ? 1e6 : 0)) return;
    const op = i === 0 ? 1 : interpolate(t, [ini - fundido, ini], [0, 1], clamp);
    // cada grabación corre con su propio reloj: su Sequence empieza cuando empieza su fundido
    const adelanto = i === 0 ? 0 : fundido;
    capas.push(
      <Sequence key={i} from={desde + ini - adelanto} durationInFrames={i === tramos.length - 1 ? undefined : durTramo(c) + adelanto + 1}>
        <div style={{ position: 'absolute', inset: 0, opacity: op }}><TramoVideo tramo={c} local={Math.max(0, t - ini)} color={color} adelanto={adelanto} /></div>
      </Sequence>,
    );
  });
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho, perspective: 3000 }}>
      <div style={{ transform: `translateY(${(1 - e) * 80}px) scale(${0.94 + 0.06 * e}) rotateX(${2 * (1 - e)}deg)`, opacity: Math.min(1, e * 1.4) }}>
        <div style={{ borderRadius: 16, overflow: 'hidden', background: C.card, border: `1px solid ${C.line}`,
          boxShadow: `0 40px 100px -30px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.03), 0 0 70px -24px ${color}66` }}>
          <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: '#0E1430', borderBottom: `1px solid ${C.line}` }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.85 }} />)}
            <div style={{ marginLeft: 14, flex: 1, maxWidth: 640, height: 24, borderRadius: 8, background: C.chip, color: C.ink2, font: `500 14px/24px ${MONO}`, padding: '0 12px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ color: C.g }}>●</span> {url}
            </div>
          </div>
          <div style={{ position: 'relative', width: ancho, height: alto, overflow: 'hidden', background: C.bg }}>{capas}</div>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------- la lista de pasos (izquierda)
const Pasos: React.FC<{ g: Guion; actual: number; avance: number }> = ({ g, actual, avance }) => (
  <div style={{ display: 'grid', gap: 10 }}>
    {g.pasos.map((p, i) => {
      const hecho = i < actual, ahora = i === actual;
      return (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 14,
          background: ahora ? `${g.color}1f` : 'transparent', border: `1.5px solid ${ahora ? g.color + 'aa' : 'transparent'}`, position: 'relative', overflow: 'hidden' }}>
          {ahora && <div style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${avance * 100}%`, background: g.color }} />}
          <span style={{ width: 38, height: 38, flex: 'none', borderRadius: 11, display: 'grid', placeItems: 'center', font: `750 19px/1 ${MONO}`,
            background: ahora ? g.color : hecho ? `${C.g}26` : C.chip, color: ahora ? C.bg : hecho ? C.g : C.ink3, border: hecho ? `1.5px solid ${C.g}` : 'none' }}>
            {hecho ? '✓' : i + 1}
          </span>
          <span style={{ font: `${ahora ? 700 : 550} 25px/1.2 ${SANS}`, color: ahora ? C.ink : hecho ? C.ink2 : C.ink3, letterSpacing: '-0.01em' }}>{p.titulo}</span>
        </div>
      );
    })}
  </div>
);

/** El subtítulo de abajo: cambia con un deslizamiento corto. */
const Subtitulo: React.FC<{ p: Paso; local: number; color: string; paso: number; total: number }> = ({ p, local, color, paso, total }) => {
  const { fps } = useVideoConfig();
  const fs = p.subs.map((s) => frameSub(p, s));
  const i = fs.reduce((k, f, j) => (local >= f ? j : k), -1);
  if (i < 0) return null;
  const s = p.subs[i], titulo = p.titulo;
  const e = spring({ frame: local - fs[i], fps, config: { damping: 18, mass: 0.7, stiffness: 150 } });
  return (
    <div>
      <div style={{ font: `650 18px/1 ${MONO}`, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>Paso {paso + 1} de {total} · <span style={{ color: C.ink3 }}>{titulo}</span></div>
      <div style={{ marginTop: 14, font: `500 37px/1.3 ${SANS}`, color: C.ink, letterSpacing: '-0.01em', opacity: e, transform: `translateY(${(1 - e) * 18}px)` }}>
        <Rico t={s.t} color={color} />
      </div>
    </div>
  );
};

/** El cuerpo del tutorial: lista de pasos, pantalla y subtítulos. */
const Cuerpo: React.FC<{ g: Guion }> = ({ g }) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const todos = g.pasos.flatMap((p) => p.tramos);
  let acc = 0, actual = 0, local = 0;
  g.pasos.forEach((p, i) => { const dp = durPaso(p); if (f >= acc) { actual = i; local = f - acc; } acc += dp; });
  const p = g.pasos[actual];
  const er = useEntrada(4);
  const sale = interpolate(f, [d - 12, d], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: sale }}>
      <Fondo tinte={g.color} tinte2={g.color2} />
      <div style={{ position: 'absolute', left: 64, top: 64, width: 420, opacity: er, transform: `translateX(${(1 - er) * -30}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Marca id={`m-tut-${g.id}`} alto={64} />
          <div>
            <div style={{ font: `800 34px/1 ${SANS}`, color: C.ink, letterSpacing: '-0.03em' }}>{g.app}</div>
            <div style={{ marginTop: 8, font: `600 16px/1 ${MONO}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: g.color }}>{g.kicker ?? 'Cómo se usa'}</div>
          </div>
        </div>
        <div style={{ marginTop: 26, marginBottom: 26 }}><Franja alto={4} /></div>
        <Pasos g={g} actual={actual} avance={local / durPaso(p)} />
      </div>
      <Pantalla tramos={todos} x={520} y={52} ancho={1336} color={g.color} desde={0} />
      <div style={{ position: 'absolute', left: 520, top: 872, width: 1336 }}>
        <Subtitulo p={p} local={local} color={g.color} paso={actual} total={g.pasos.length} />
      </div>
    </AbsoluteFill>
  );
};

// ----------------------------------------------------------------- portada y cierre
const Intro: React.FC<{ g: Guion }> = ({ g }) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const armado = ETAPAS.map((_, i) => interpolate(f, [2 + i * 5, 18 + i * 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) }));
  const ek = useEntrada(8), et = useEntrada(16, 16), eq = useEntrada(34), eu = useEntrada(52);
  const sale = interpolate(f, [d - 12, d], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <Fondo tinte={g.color} tinte2={g.color2} />
      <AbsoluteFill style={{ opacity: sale, transform: `scale(${interpolate(f, [0, d], [1, 1.04])})` }}>
        <div style={{ position: 'absolute', right: 170, top: 150, filter: `drop-shadow(0 30px 90px ${g.color}66)` }}>
          <Marca id={`m-tut-intro-${g.id}`} alto={760} armado={armado} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: 150, top: 250, width: 1000 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderRadius: 999, background: `${C.chip}cc`, border: `1px solid ${g.color}88`,
            font: `650 22px/1 ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink, opacity: ek }}>
            <i style={{ width: 13, height: 13, borderRadius: 4, background: g.color, boxShadow: `0 0 16px ${g.color}` }} />{g.app} · {(g.kicker ?? 'Cómo se usa').toLowerCase()}
          </div>
          <div style={{ marginTop: 34, font: `850 108px/1.0 ${SANS}`, letterSpacing: '-0.045em', color: C.ink, opacity: et, transform: `translateY(${(1 - et) * 40}px)` }}>
            <Rico t={g.titulo} color={g.color} />
          </div>
          <div style={{ marginTop: 34, font: `400 36px/1.4 ${SANS}`, color: C.ink2, opacity: eq, transform: `translateY(${(1 - eq) * 20}px)` }}>{g.que}</div>
          <div style={{ marginTop: 40, display: 'flex', gap: 14, alignItems: 'center', opacity: eu }}>
            <span style={{ font: `600 26px/1 ${MONO}`, color: C.acc }}>{g.url}</span>
            <span style={{ font: `500 24px/1 ${SANS}`, color: C.ink3 }}>· {g.pasos.length} pasos</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Cierre: React.FC<{ g: Guion }> = ({ g }) => {
  const f = useCurrentFrame();
  const { durationInFrames: d } = useVideoConfig();
  const et = useEntrada(4, 16);
  const eu = useEntrada(30 + g.ideas.length * 12);
  const fin = interpolate(f, [d - 15, d], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <Fondo tinte={g.color} tinte2={g.color2} />
      <AbsoluteFill style={{ opacity: fin }}>
        <div style={{ position: 'absolute', right: 200, top: 230, filter: `drop-shadow(0 30px 90px ${g.color}55)`, transform: `scale(${interpolate(f, [0, d], [0.97, 1.03])})` }}>
          <Marca id={`m-tut-cierre-${g.id}`} alto={620} etiquetas />
        </div>
        <div style={{ position: 'absolute', left: 150, top: 200, width: 1050 }}>
          <div style={{ font: `850 92px/1.02 ${SANS}`, letterSpacing: '-0.045em', color: C.ink, opacity: et, transform: `translateY(${(1 - et) * 30}px)` }}>
            <Rico t={g.invita} color={g.color} />
          </div>
          <div style={{ marginTop: 50, display: 'grid', gap: 22 }}>
            {g.ideas.map((t, i) => <Idea key={i} t={t} desde={24 + i * 12} color={g.color} n={i + 1} />)}
          </div>
          <div style={{ marginTop: 54, opacity: eu, transform: `scale(${0.9 + 0.1 * eu})`, transformOrigin: 'left center' }}>
            <span style={{ display: 'inline-block', padding: '18px 28px', borderRadius: 16, background: g.color, color: C.bg, font: `750 34px/1 ${MONO}`, boxShadow: `0 20px 60px -16px ${g.color}` }}>{g.url}</span>
            <span style={{ marginLeft: 22, font: `500 28px/1 ${SANS}`, color: C.ink2 }}>Gratis · sin cuenta · en español</span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
const Idea: React.FC<{ t: string; desde: number; color: string; n: number }> = ({ t, desde, color, n }) => {
  const e = useEntrada(desde);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, font: `500 36px/1.3 ${SANS}`, color: C.ink2, opacity: e, transform: `translateX(${(1 - e) * 40}px)` }}>
      <span style={{ width: 46, height: 46, flex: 'none', borderRadius: 13, background: `${color}22`, border: `2px solid ${color}`, color, display: 'grid', placeItems: 'center', font: `750 24px/1 ${MONO}` }}>{n}</span>
      <span><Rico t={t} color={C.ink} /></span>
    </div>
  );
};

/** El video completo: portada, cuerpo y cierre, con la pista. */
export const Tutorial: React.FC<{ g: Guion; sonido?: boolean }> = ({ g, sonido = true }) => {
  const cuerpo = g.pasos.reduce((s, p) => s + durPaso(p), 0);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence durationInFrames={g.intro}><Intro g={g} /></Sequence>
      <Sequence from={g.intro} durationInFrames={cuerpo}><Cuerpo g={g} /></Sequence>
      <Sequence from={g.intro + cuerpo} durationInFrames={g.cierre}><Cierre g={g} /></Sequence>
      {sonido && <Audio src={staticFile(`tutoriales/${g.id}.wav`)} />}
    </AbsoluteFill>
  );
};
