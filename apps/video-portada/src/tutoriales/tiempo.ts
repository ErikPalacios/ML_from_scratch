// Los tiempos de los videos explicativos, sin React: los usa el montaje (kit.tsx) y la pista (tools/sonido-tutorial.mjs).
import MARCAS from '../marcas.json';
import DURACIONES from '../duraciones.json';

const FPS = 30;
export type Caja = { t: number; x?: number; y?: number; w?: number; h?: number };
const M = MARCAS as Record<string, Record<string, Caja>>;
export const marca = (src: string, id: string): Caja => {
  const m = M[src]?.[id];
  if (!m) throw new Error(`no hay marca ${src}:${id} (graba la toma: node tools/capturar.mjs ${src})`);
  return m;
};

/** Punto de cámara en frames del tramo (`f`) o en el instante de una marca (`fm`, más `df` frames).
 *  Posición: `m` = id de una marca (apunta a su centro, más `dx`/`dy`) o x, y explícitos (0..1). */
export type Cam = { f?: number; fm?: string; df?: number; z: number; x?: number; y?: number; m?: string; dy?: number; dx?: number };
/** Aro sobre un elemento: aparece cuando la grabación llega a la marca y dura `s` segundos de grabación. */
export type Aro = { m: string; s?: number; color?: string; texto?: string; lado?: 'arriba' | 'abajo' | 'izq' | 'der' };
/**
 * Un tramo de grabación, de `de` a `a` (segundos de la grabación o ids de marcas; `a` vacío = hasta el final).
 * Con una marca, `antes` / `despues` dan margen en segundos. `vel`: velocidad.
 */
export type Tramo = { src: string; url: string; de?: number | string; a?: number | string; antes?: number; despues?: number; vel?: number; cam?: Cam[]; aros?: Aro[] };
/** Subtítulo: entra en el frame `f` del paso, o cuando el tramo `k` (0 por omisión) llega a la marca `m` (más `df`). Lo que va entre *asteriscos* se resalta. */
export type Sub = { f?: number; m?: string; k?: number; df?: number; t: string };
export type Paso = { titulo: string; tramos: Tramo[]; subs: Sub[] };
export type Guion = {
  id: string; app: string; url: string; color: string; color2: string;
  /** «Cómo se usa» (tutorial completo) o «Una muestra» (las herramientas que solo se asoman). */
  kicker?: string;
  /** Portada: título (con *resalte*) y una frase de qué es. */
  titulo: string; que: string;
  intro: number; cierre: number;
  pasos: Paso[];
  /** El cierre: tres ideas para llevarse y una invitación. */
  ideas: string[]; invita: string;
};

export const inicioTramo = (t: Tramo) => typeof t.de === 'string' ? Math.max(0, marca(t.src, t.de).t - (t.antes ?? 0.5)) : (t.de ?? 0);
const finTramo = (t: Tramo) => typeof t.a === 'string' ? marca(t.src, t.a).t + (t.despues ?? 1.2) : (t.a ?? (DURACIONES as Record<string, number>)[t.src] ?? 0);
/** Frames que dura un tramo en el video. */
export const durTramo = (t: Tramo) => Math.max(15, Math.round(((finTramo(t) - inicioTramo(t)) / (t.vel || 1)) * FPS));
/** Frame (local al tramo) en que la grabación llega a la marca `m`. */
export const frameMarca = (t: Tramo, m: string) => ((marca(t.src, m).t - inicioTramo(t)) / (t.vel || 1)) * FPS;
export const durPaso = (p: Paso) => p.tramos.reduce((s, t) => s + durTramo(t), 0);
export const duracionGuion = (g: Guion) => g.intro + g.pasos.reduce((s, p) => s + durPaso(p), 0) + g.cierre;
/** Frame del paso en que entra cada subtítulo. */
export const frameSub = (p: Paso, s: Sub) => {
  if (s.m == null) return s.f ?? 0;
  const k = s.k ?? 0;
  const antes = p.tramos.slice(0, k).reduce((a, t) => a + durTramo(t), 0);
  return Math.max(0, Math.round(antes + frameMarca(p.tramos[k], s.m) + (s.df ?? -6)));
};
/** Los frames (desde el inicio del cuerpo) donde empieza cada paso: los usa la pista para sus efectos. */
export const iniciosPasos = (g: Guion) => { let a = 0; return g.pasos.map((p) => { const i = a; a += durPaso(p); return i; }); };

