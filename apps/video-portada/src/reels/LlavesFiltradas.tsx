// Reel 16 · «Cuando lanzas tu app hecha con IA y crees que nadie la ve».
// Basado en un caso que se hizo viral: una app hecha con IA tenía sus llaves secretas en el JavaScript que descarga
// cada visitante (variables VITE_), y en dos semanas el servidor registró 212 intentos de leer /.env, sin que nadie
// conociera la app. Debug explica con la analogía del folleto: el bundle se reparte a cada visitante; lo que empieza
// con VITE_ va impreso ahí a propósito (docs de Vite: «VITE_* variables should not contain sensitive information»);
// .gitignore cuida el repo, no el folleto. Gag: Turbo la renombra «súper secreta» y sigue empezando con VITE_.
// Lo que sí sirve: rotar, tope de gasto y la llave en el servidor. Cierra con la prueba de 5 minutos (build + grep).
// Sin marcas en pantalla: «la IA», «el chat», «los pagos». Voz: src/reels/dialogos/16-llaves-filtradas.json.
import React from 'react';
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { C, MONO, SANS } from '../tema';
import { Fondo, useEntrada } from '../piezas';
import { App, Aurora, Cierre, clamp, Gancho, Linea, Reel, useSalida, VIVOS } from './kit';
import { Burbuja, Debug, parpadeo, Turbo } from './personajes';
import TIEMPOS from './dialogos/16-llaves-filtradas.tiempos.json';

const ID = '16-llaves-filtradas';
type Linea = keyof typeof TIEMPOS;

// En qué frame de su escena empieza cada línea (las duraciones salen de los audios).
const VOZ: Record<Linea, number> = {
  n1: 2, t1: 90, n2: 156, t2: 349, n3: 403,
  n4: 4, t3: 185, n5: 252,
  t4: 4, n6: 76, t5: 141,
  n7: 4,
  n8: 4,
  n9: 8,
};
const fin = (id: Linea) => VOZ[id] + TIEMPOS[id].frames;
const vol = (id: Linea, f: number) => {
  const k = f - VOZ[id];
  return k >= 0 && k < TIEMPOS[id].frames ? TIEMPOS[id].env[k] : 0;
};
const boca = (v: number) => (v > 0.22 ? 'grito' as const : undefined);
const hablaDebug = (ids: Linea[], f: number) => Math.max(...ids.map((id) => vol(id, f)));

const Voces: React.FC<{ ids: Linea[] }> = ({ ids }) => (
  <>{ids.map((id) => <Sequence key={id} from={VOZ[id]} durationInFrames={TIEMPOS[id].frames + 2}><Audio src={staticFile(`reels/voz/${ID}/${id}.wav`)} /></Sequence>)}</>
);

const ROJO = '#FF8A5C', VERDE = '#2FD3A0', PAPEL = '#FFF4D6', TINTA = '#2A2540';

/** Tarjeta oscura con barra de ventana (editor o terminal). */
const Tarjeta: React.FC<{ x: number; y: number; w: number; titulo: string; children: React.ReactNode; opacity?: number; derecha?: React.ReactNode; style?: React.CSSProperties }> =
  ({ x, y, w, titulo, children, opacity = 1, derecha, style }) => (
    <div style={{ position: 'absolute', left: x, top: y, width: w, opacity, background: `${C.card}f4`, border: `2px solid ${C.line}`, borderRadius: 26, boxShadow: '0 30px 80px #0008', overflow: 'hidden', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: `2px solid ${C.line}`, font: `600 25px/1 ${MONO}`, color: C.ink3 }}>
        {['#EC6A3F', '#E8AE36', '#17B386'].map((c) => <i key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />)}
        <span style={{ marginLeft: 12, flex: 1 }}>{titulo}</span>
        {derecha}
      </div>
      {children}
    </div>
  );

/** Una persona (visitante) muy simple: cabeza y hombros. */
const Persona: React.FC<{ x: number; y: number; color: string; e: number }> = ({ x, y, color, e }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 70, height: 90, opacity: e, transform: `scale(${0.5 + 0.5 * e})` }}>
    <div style={{ position: 'absolute', left: 20, top: 0, width: 30, height: 30, borderRadius: 15, background: color }} />
    <div style={{ position: 'absolute', left: 4, top: 36, width: 62, height: 40, borderRadius: '30px 30px 10px 10px', background: color }} />
  </div>
);

// ── 1 · El gancho: Turbo festeja que nadie conoce su app… y el log del servidor ya está lleno de GET /.env.
const LOG = ['lun 03:12', 'lun 03:47', 'lun 09:05', 'mar 01:33', 'mar 14:20', 'mié 06:02', 'jue 22:41', 'sáb 04:18', 'dom 11:56', 'lun 02:09'];
const GanchoEscena: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const log = interpolate(f, [VOZ.n2 - 10, VOZ.n2 + 4], [0, 1], clamp);
  const lineas = Math.floor(interpolate(f, [VOZ.n2 + 10, VOZ.n2 + 110], [0, LOG.length], clamp));
  const cuenta = Math.round(interpolate(f, [VOZ.n2 + 30, VOZ.n2 + 110], [0, 212], { ...clamp, easing: Easing.out(Easing.cubic) }));
  const festeja = f >= VOZ.t1 - 4 && f < fin('t1') + 6;
  const salto = festeja ? -Math.abs(Math.sin((f - VOZ.t1) / 5)) * 40 : 0;
  const susto = f >= VOZ.t2 - 4;
  const cara = susto ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: boca(vol('t2', f)) ?? 'normal' as const, cachetes: 1.1 }
    : festeja ? { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t1', f)) ?? 'grito' as const }
    : { parpado: parpadeo(f, 60, 10), boca: 'normal' as const };
  const temblor = susto && f < VOZ.t2 + 24 ? Math.sin(f * 3.1) * 7 : 0;
  const enLinea = useEntrada(14, 12);
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.7} colores={[C.g, C.b, C.p, C.g, C.y, C.b]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 230, width: 940 }}>
          <Gancho texto="Cuando lanzas tu app hecha con IA y crees que nadie la ve" marcas={{ nadie: C.o }} desde={-14} paso={2} tam={84} />
        </div>
        {/* Antes del log: la app recién publicada. */}
        {log < 1 && (
          <Tarjeta x={70} y={560} w={940} titulo="tu-app.com" opacity={(1 - log) * enLinea}>
            <div style={{ padding: '46px 40px', textAlign: 'center' }}>
              <div style={{ font: `850 64px/1.1 ${SANS}`, color: C.ink, letterSpacing: '-0.03em' }}>¡Ya está en línea! 🎉</div>
              <div style={{ marginTop: 22, font: `600 32px/1 ${MONO}`, color: C.ink3 }}>reservas · pagos · chat con IA</div>
            </div>
          </Tarjeta>
        )}
        {/* El log del servidor: bots pidiendo /.env. */}
        {log > 0 && (
          <Tarjeta x={70} y={560} w={940} titulo="access.log · tu servidor" opacity={log}
            derecha={<span style={{ font: `800 24px/1 ${MONO}`, color: C.yt }}>UN CASO QUE SE HIZO VIRAL</span>}>
            <div style={{ display: 'flex', padding: '18px 26px 22px', gap: 26 }}>
              <div style={{ flex: 1, height: 262, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', font: `500 27px/1.55 ${MONO}`, color: C.ink2, whiteSpace: 'pre' }}>
                {LOG.slice(0, lineas).slice(-6).map((t, i) => (
                  <div key={t}><span style={{ color: C.ink3 }}>{t}</span>  GET <b style={{ color: C.ink }}>/.env</b>  <span style={{ color: ROJO }}>404</span></div>
                ))}
              </div>
              <div style={{ width: 300, textAlign: 'center', alignSelf: 'center' }}>
                <div style={{ font: `850 130px/0.9 ${SANS}`, color: ROJO, letterSpacing: '-0.05em', textShadow: `0 0 60px ${ROJO}66` }}>{cuenta}</div>
                <div style={{ marginTop: 10, font: `700 30px/1.2 ${SANS}`, color: C.ink }}>intentos en<br />2 semanas</div>
              </div>
            </div>
          </Tarjeta>
        )}
        <div style={{ position: 'absolute', left: 70, top: 975, width: 940 }}>
          {f >= VOZ.n2 + 140 && <Linea desde={VOZ.n2 + 140} tam={46} color={C.ink}>Y nadie conocía la app.</Linea>}
          {f >= VOZ.n3 + 8 && <Linea desde={VOZ.n3 + 8} tam={38} style={{ marginTop: 8 }}>🤖 <b style={{ color: C.ink }}>Bots</b>: prueban <span style={{ fontFamily: MONO, color: C.yt }}>/.env</span> en todos los sitios, todo el día.</Linea>}
        </div>
        <Turbo cx={680 + temblor} pies={1600 + salto} escala={0.6} pose={{ cara, brazos: festeja ? [150, -150] : susto ? [150, -150] : [0, 0] }} />
        {f >= VOZ.n2 && <Debug x={60} y={1415} escala={1.15} ceja={0.5} habla={hablaDebug(['n2', 'n3'], f)} derecha />}
        <Burbuja quien="turbo" x={150} y={960} ancho={800} desde={VOZ.t1} hasta={fin('t1') + 14} cola={530}>¡Nadie conoce mi app! ¡Estoy a salvo!</Burbuja>
        <Burbuja quien="turbo" x={330} y={1060} ancho={640} desde={VOZ.t2} hasta={fin('t2') + 10} cola={350}>¡¿Quiénes son esos?!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n1', 't1', 'n2', 't2', 'n3']} />
    </AbsoluteFill>
  );
};

// ── 2 · El folleto: el bundle se reparte a cada visitante y lo que empieza con VITE_ va impreso en él.
const ENV = [
  ['VITE_CHAT_KEY', 'sk-••••••••••'],
  ['VITE_PAGOS_KEY', 'sk_live_••••••'],
  ['VITE_CORREO_KEY', '••••••••••••'],
];
const PUBLICO = [[720, 640], [850, 620], [960, 660], [700, 790], [830, 770], [950, 810], [740, 930], [870, 920]];
const Folleto: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  const papel = useEntrada(6, 13);
  const imprime = interpolate(f, [VOZ.n4 + 110, VOZ.n4 + 140], [0, 1], clamp);
  const envVe = useEntrada(VOZ.n4 + 92, 14);
  const split = f >= VOZ.n5 - 2;
  const queja = f >= VOZ.t3 - 4 && f < fin('t3') + 6;
  const cara = queja ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t3', f)) ?? 'mueca' as const }
    : split ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const }
    : { ojos: 'fastidio' as const, boca: 'mueca' as const, parpado: parpadeo(f, 70, 30) };
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.b} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232 }}><App texto="Dónde estaban las llaves" color={C.yt} desde={0} /></div>
        {/* El .env: las variables VITE_ que escribió la IA para que el chat funcionara desde el navegador. */}
        <Tarjeta x={70} y={320} w={940} titulo=".env" opacity={envVe} style={{ transform: `translateY(${(1 - envVe) * 20}px)` }}>
          <div style={{ padding: '14px 26px 18px', font: `500 31px/1.55 ${MONO}`, color: C.ink }}>
            {ENV.map(([k, v]) => (
              <div key={k}><span style={{ background: `${ROJO}${Math.round(imprime * 0x44).toString(16).padStart(2, '0')}`, color: imprime > 0.5 ? ROJO : C.ink, borderRadius: 6, fontWeight: 700 }}>VITE_</span>{k.slice(5)}=<span style={{ color: C.yt }}>{v}</span></div>
            ))}
          </div>
        </Tarjeta>
        <div style={{ position: 'absolute', left: 120, top: 560, font: `700 28px/1 ${MONO}`, color: C.ink3, opacity: envVe }}>↓ npm run build</div>
        {/* El folleto (el JavaScript de la app) con las llaves impresas. */}
        <div style={{ position: 'absolute', left: 80, top: 610, width: 560, padding: '26px 30px', background: PAPEL, borderRadius: 14, boxShadow: '0 24px 60px #0009',
          transform: `rotate(-3deg) scale(${0.7 + 0.3 * papel})`, opacity: papel, color: TINTA }}>
          <div style={{ font: `850 40px/1 ${SANS}`, letterSpacing: '-0.03em' }}>Tu app 📄</div>
          <div style={{ marginTop: 6, font: `600 22px/1 ${MONO}`, color: '#7A7290' }}>assets/index-8f3a.js</div>
          <div style={{ marginTop: 8, font: `600 24px/1.2 ${SANS}`, color: '#7A7290' }}>el JavaScript que descarga cada visitante</div>
          <div style={{ marginTop: 18, font: `500 23px/1.5 ${MONO}`, color: '#5B5470', wordBreak: 'break-all' }}>
            function n(e){'{'}return e.map(…){'}'}
            {ENV.slice(0, 2).map(([k, v], i) => (
              <div key={k} style={{ opacity: imprime, transform: `translateY(${(1 - imprime) * -14}px)`, color: '#C2410C', fontWeight: 700, background: `${ROJO}33`, borderRadius: 6, padding: '0 6px', margin: '4px -6px' }}>
                const {['k', 'p'][i]}="{v}"
              </div>
            ))}
            fetch("/reservas",…)
          </div>
        </div>
        {/* Cada visitante recibe una copia. */}
        {PUBLICO.map(([x, y], i) => {
          const d = 24 + i * 6;
          const t = interpolate(f, [d, d + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          return (
            <React.Fragment key={i}>
              {t < 1 && t > 0 && <div style={{ position: 'absolute', left: interpolate(t, [0, 1], [360, x + 10]), top: interpolate(t, [0, 1], [780, y + 40]), width: 46, height: 58, background: PAPEL, borderRadius: 4, transform: `rotate(${t * 30}deg)` }} />}
              <Persona x={x} y={y} color={[C.acc, VERDE, C.yt, '#C9A4FF'][i % 4]} e={t} />
              {t >= 1 && <div style={{ position: 'absolute', left: x + 46, top: y + 46, width: 26, height: 32, background: PAPEL, borderRadius: 3, boxShadow: imprime > 0.5 ? `0 0 0 3px ${ROJO}` : undefined }} />}
            </React.Fragment>
          );
        })}
        <div style={{ position: 'absolute', left: 70, top: 1045, width: 940, opacity: interpolate(f, [VOZ.t3 - 8, VOZ.t3], [1, 0], clamp) }}>
          {f >= VOZ.n4 + 120 && <Linea desde={VOZ.n4 + 120} tam={42} color={C.ink}><b style={{ fontFamily: MONO, color: ROJO }}>VITE_</b> = público <b>por diseño</b>. Va al folleto en el build.</Linea>}
          {f >= VOZ.n4 + 140 && <Linea desde={VOZ.n4 + 140} tam={27} style={{ marginTop: 6 }}>La guía de Vite: las variables VITE_* no deben llevar «información sensible, como API keys».</Linea>}
        </div>
        {split && (
          <div style={{ position: 'absolute', left: 70, top: 1045, width: 940, display: 'flex', gap: 20 }}>
            {[{ t: 'EL REPO', d: '.gitignore: el .env no se sube ✓', c: VERDE, desde: VOZ.n5 }, { t: 'EL FOLLETO', d: 'la llave ya va impresa ✗', c: ROJO, desde: VOZ.n5 + 22 }].map((b) => {
              const e = interpolate(f, [b.desde, b.desde + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) });
              return (
                <div key={b.t} style={{ flex: 1, padding: '20px 24px', borderRadius: 22, background: `${b.c}1f`, border: `3px solid ${b.c}`, opacity: e, transform: `scale(${0.7 + 0.3 * e})` }}>
                  <div style={{ font: `800 26px/1 ${MONO}`, color: b.c, letterSpacing: '0.06em' }}>{b.t}</div>
                  <div style={{ marginTop: 10, font: `700 32px/1.2 ${SANS}`, color: C.ink }}>{b.d}</div>
                </div>
              );
            })}
          </div>
        )}
        <Debug x={60} y={1415} escala={1.15} ceja={split ? 1 : 0.5} habla={hablaDebug(['n4', 'n5'], f)} derecha />
        <Turbo cx={800} pies={1600} escala={0.42} pose={{ cara, brazos: queja ? [70, -70] : [-8, 8] }} />
        <Burbuja quien="turbo" x={110} y={1110} ancho={860} desde={VOZ.t3} hasta={fin('t3') + 8} cola={690} tam={50}>¡Pero mi .env está en el .gitignore!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['n4', 't3', 'n5']} />
    </AbsoluteFill>
  );
};

// ── 3 · La «solución» de Turbo: le cambia el nombre. Sigue empezando con VITE_.
const Renombre: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const cambio = interpolate(f, [VOZ.t4 + 30, VOZ.t4 + 42], [0, 1], clamp);
  const alarma = f >= VOZ.n6;
  const pulso = alarma ? 0.6 + 0.4 * Math.abs(Math.sin((f - VOZ.n6) / 6)) : 0;
  const enojado = f >= VOZ.t5 - 4;
  const cara = enojado ? { ojos: 'enojado' as const, cejas: 'enojado' as const, boca: boca(vol('t5', f)) ?? 'mueca' as const }
    : alarma ? { ojos: 'fastidio' as const, boca: 'mueca' as const }
    : { ojos: 'normal' as const, cejas: 'arriba' as const, boca: boca(vol('t4', f)) ?? 'grito' as const };
  const temblor = enojado && f < VOZ.t5 + 36 ? Math.sin(f * 3.1) * 7 : 0;
  const flecha = interpolate(f, [VOZ.n6 + 4, VOZ.n6 + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
  return (
    <AbsoluteFill>
      <Aurora fuerza={0.6} colores={[C.o, C.p, C.y, C.o, C.b, C.p]} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232 }}><App texto="La solución de Turbo" color={C.o} desde={0} /></div>
        <Tarjeta x={70} y={330} w={940} titulo=".env">
          <div style={{ padding: '26px 30px 30px', font: `600 40px/1.4 ${MONO}`, color: C.ink }}>
            {cambio < 1 && <div style={{ opacity: 1 - cambio, textDecoration: cambio > 0 ? 'line-through' : undefined, color: C.ink3 }}>VITE_CHAT_KEY=<span style={{ color: C.yt }}>sk-•••</span></div>}
            {cambio > 0 && (
              <div style={{ opacity: cambio, transform: `translateY(${(1 - cambio) * 16}px)` }}>
                <span style={{ background: `${ROJO}${Math.round(pulso * 0x66).toString(16).padStart(2, '0')}`, color: alarma ? ROJO : C.ink, borderRadius: 8, padding: '0 4px', boxShadow: alarma ? `0 0 ${30 * pulso}px ${ROJO}` : undefined }}>VITE_</span>
                <span style={{ color: VERDE }}>SUPER_SECRETA</span>=<span style={{ color: C.yt }}>sk-•••</span>
              </div>
            )}
          </div>
        </Tarjeta>
        <div style={{ position: 'absolute', left: 90, top: 540, opacity: flecha, transform: `translateY(${(1 - flecha) * 20}px)` }}>
          <div style={{ font: `800 46px/1.15 ${SANS}`, color: ROJO }}>↑ El nombre da igual.</div>
          <div style={{ marginTop: 10, font: `600 38px/1.25 ${SANS}`, color: C.ink }}>Manda el prefijo: sigue siendo público.</div>
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={alarma ? 1 : 0.4} habla={vol('n6', f)} derecha />
        <Turbo cx={660 + temblor} pies={1600} escala={0.6} pose={{ cara, brazos: enojado ? [44, -44] : alarma ? [-8, 8] : [150, -150] }} />
        <Burbuja quien="turbo" x={150} y={890} ancho={820} desde={VOZ.t4} hasta={fin('t4') + 8} cola={520}>¡Ya sé! ¡La llamo súper secreta!</Burbuja>
        <Burbuja quien="turbo" x={210} y={900} ancho={760} desde={VOZ.t5} cola={460} tam={58}>¡Nadie te preguntó, pato!</Burbuja>
      </AbsoluteFill>
      <Voces ids={['t4', 'n6', 't5']} />
    </AbsoluteFill>
  );
};

// ── 4 · Lo que sí sirve: rotar, tope de gasto y la llave en el servidor.
const ARREGLOS = [
  { desde: 30, titulo: 'Rota las llaves', detalle: 'Borrarlas del código no basta: alguien ya las pudo copiar.' },
  { desde: 61, titulo: 'Ponles un tope de gasto', detalle: 'Un tope corta el gasto. Una alerta solo avisa.' },
  { desde: 95, titulo: 'La llave vive en el servidor', detalle: '' },
];
const Arreglo: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida();
  return (
    <AbsoluteFill>
      <Fondo tinte={C.g} tinte2={C.p} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232 }}><App texto="Lo que sí sirve" color={C.g} desde={0} /></div>
        {ARREGLOS.map((a, i) => {
          const e = interpolate(f, [a.desde, a.desde + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
          const color = VIVOS[[2, 0, 3][i]];
          return (
            <div key={i} style={{ position: 'absolute', left: 70, top: 320 + i * 250, width: 940, padding: '26px 30px', borderRadius: 26, background: `${C.card}f2`, border: `2px solid ${color}88`,
              boxShadow: `inset 8px 0 0 ${color}`, opacity: e, transform: `translateX(${(1 - e) * 60}px)` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
                <span style={{ font: `850 60px/1 ${SANS}`, color }}>{i + 1}</span>
                <span style={{ font: `850 50px/1.05 ${SANS}`, color: C.ink, letterSpacing: '-0.03em' }}>{a.titulo}</span>
              </div>
              {a.detalle && <div style={{ marginTop: 14, font: `500 34px/1.3 ${SANS}`, color: C.ink2 }}>{a.detalle}</div>}
              {i === 2 && (
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14, font: `700 30px/1 ${SANS}`, color: C.ink }}>
                  <span style={{ padding: '14px 18px', borderRadius: 16, background: C.chip }}>Navegador</span>
                  <span style={{ color: C.ink3 }}>→</span>
                  <span style={{ padding: '14px 18px', borderRadius: 16, background: `${color}33`, border: `2px solid ${color}` }}>Tu servidor 🔑</span>
                  <span style={{ color: C.ink3 }}>→</span>
                  <span style={{ padding: '14px 18px', borderRadius: 16, background: C.chip }}>la API</span>
                </div>
              )}
              {i === 2 && <div style={{ marginTop: 14, font: `500 34px/1.3 ${SANS}`, color: C.ink2 }}>El navegador nunca ve la llave.</div>}
            </div>
          );
        })}
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={vol('n7', f)} derecha />
        <Turbo cx={820} pies={1600} escala={0.42} pose={{ cara: { ojos: 'fastidio', boca: 'mueca', parpado: parpadeo(f, 60, 20) }, brazos: [-10, 10] }} />
      </AbsoluteFill>
      <Voces ids={['n7']} />
    </AbsoluteFill>
  );
};

// ── 5 · La prueba de 5 minutos (para guardar): build y buscar las llaves en la carpeta de salida.
const COMANDOS = [
  { d: 44, s: 'npm run build' },
  { d: 72, s: 'grep -rn "sk-" dist/' },
  { d: 84, s: 'grep -rn "sk_" dist/' },
  { d: 96, s: 'grep -rni "key" dist/' },
];
const Prueba: React.FC = () => {
  const f = useCurrentFrame();
  const sale = useSalida(10);
  const sale5 = f >= 112;
  const cara = sale5 ? { ojos: 'shock' as const, cejas: 'arriba' as const, boca: 'normal' as const, cachetes: 1.1 }
    : { ojos: 'normal' as const, boca: 'normal' as const, parpado: parpadeo(f, 60, 5) };
  return (
    <AbsoluteFill>
      <Fondo tinte={C.y} tinte2={C.g} />
      <AbsoluteFill style={{ opacity: sale }}>
        <div style={{ position: 'absolute', left: 70, top: 232, width: 940 }}>
          <App texto="Guárdalo · la prueba de 5 minutos" color={C.yt} desde={0} />
          <Gancho texto="Busca tus llaves antes que los bots." marcas={{ bots: C.o }} desde={4} paso={2} tam={72} style={{ marginTop: 22 }} />
        </div>
        <Tarjeta x={70} y={520} w={940} titulo="terminal · tu proyecto">
          <div style={{ padding: '18px 28px 24px', font: `500 33px/1.65 ${MONO}`, color: C.ink, whiteSpace: 'pre' }}>
            {COMANDOS.map((c) => f >= c.d && (
              <div key={c.s}><span style={{ color: VERDE }}>$ </span>{c.s.split(/("[^"]*")/).map((p, i) => <span key={i} style={/^"/.test(p) ? { color: C.yt } : undefined}>{p}</span>)}</div>
            ))}
            {sale5 && (
              <div style={{ color: ROJO, fontWeight: 700, background: `${ROJO}22`, borderRadius: 8, padding: '0 8px', margin: '4px -8px 0', whiteSpace: 'normal', fontSize: 30 }}>
                dist/assets/index-8f3a.js: …"sk_live_••••••"
              </div>
            )}
          </div>
        </Tarjeta>
        <div style={{ position: 'absolute', left: 70, top: 1000, width: 940 }}>
          {f >= 100 && <Linea desde={100} tam={28}><span style={{ fontFamily: MONO, color: C.ink }}>dist/</span> es la carpeta que sale del build. «key» sale en muchos lados: fíjate en los valores largos.</Linea>}
          {f >= 130 && <Linea desde={130} tam={44} color={C.ink} style={{ marginTop: 18 }}>¿Salió una? <b style={{ color: ROJO }}>Rótala</b> y muévela al servidor.</Linea>}
        </div>
        <Debug x={60} y={1415} escala={1.15} ceja={0.6} habla={vol('n8', f)} derecha />
        <Turbo cx={820} pies={1600} escala={0.42} pose={{ cara, brazos: sale5 ? [150, -150] : [-8, 8] }} />
      </AbsoluteFill>
      <Voces ids={['n8']} />
    </AbsoluteFill>
  );
};

const CierreEscena: React.FC = () => (
  <AbsoluteFill>
    <Cierre id="llaves" color={C.g} frase={<>A producción, <span style={{ color: VIVOS[2] }}>paso a paso</span>, en el Dojo</>} />
    <Voces ids={['n9']} />
  </AbsoluteFill>
);

export const ReelLlavesFiltradas: React.FC<{ sonido?: boolean }> = ({ sonido }) => (
  <Reel id={ID} sonido={sonido} volMusica={0.3} escenas={{ gancho: GanchoEscena, folleto: Folleto, renombre: Renombre, arreglo: Arreglo, prueba: Prueba, cierre: CierreEscena }} />
);
