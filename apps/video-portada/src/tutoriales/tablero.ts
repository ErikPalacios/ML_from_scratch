// Cómo se usa el tablero de proyectos (la demo pública): el mapa, la puerta de entrada, el registro y Claude Code.
import { C } from '../tema';
import type { Guion } from './tiempo';

const U = 'tablero-ml-demo.vercel.app';
const P = U + '/#/p/sample';

export const TABLERO: Guion = {
  id: 'tablero', app: 'Tablero', url: U, color: C.acc, color2: C.p,
  titulo: 'Cómo usar *el tablero*',
  que: 'Tu proyecto de ML como un mapa de metro: cada paso con sus cuentas, su definición de hecho y tu registro de sesiones.',
  intro: 150, cierre: 240,
  pasos: [
    {
      titulo: 'Tus proyectos',
      tramos: [{
        src: 'tab-proyecto', url: U + '/#/', vel: 1.1, a: 'abre', despues: 0.2,
        cam: [{ f: 0, z: 1.1, x: 0.5, y: 0.5 }, { f: 30, z: 1.4, m: 'tarjeta' }],
        aros: [{ m: 'tarjeta', s: 2.4 }],
      }],
      subs: [{ f: 0, t: 'El tablero sigue *tus proyectos de ML*. Cada tarjeta dice cuánto llevas y *cuál es el siguiente paso*.' }],
    },
    {
      titulo: 'Retoma donde te quedaste',
      tramos: [{
        src: 'tab-proyecto', url: P, vel: 1.1, de: 'abre', antes: 0.1,
        cam: [{ f: 0, z: 1.25, m: 'estado' }, { f: 60, z: 1.5, m: 'estado', dx: -0.15 }, { f: 160, z: 1.5, m: 'estado', dx: -0.15 }, { f: 200, z: 1.5, m: 'estado', dx: 0.2 }],
      }],
      subs: [
        { f: 0, t: 'Al abrir un proyecto, lo primero es *dónde te quedaste* y *qué sigue*: retomas en segundos.' },
        { f: 165, t: 'A la derecha: días sin tocarlo, pasos hechos, *bloqueos* abiertos y tu última sesión.' },
      ],
    },
    {
      titulo: 'Lee el mapa',
      tramos: [{
        src: 'tab-mapa', url: P, vel: 1.1, a: 'st8', despues: 2.2,
        cam: [{ f: 0, z: 1.05, m: 'mapa' }, { fm: 'st1', df: 0, z: 1.05, m: 'mapa' }, { fm: 'st1', df: 25, z: 1.3, m: 'mapa' }],
        aros: [{ m: 'st7', s: 2.0, texto: 'Siguiente acción' }, { m: 'st8', s: 2.0, texto: 'Bloqueado' }],
      }],
      subs: [
        { f: 0, t: 'Tu proyecto es *un mapa de metro*: cada estación es un paso, del dato al monitoreo.' },
        { m: 'st7', t: 'El aro amarillo marca *tu siguiente acción*. Al pasar el cursor, la T enciende su etapa.' },
        { m: 'st8', t: 'El *!* es un paso bloqueado, con su razón. Los punteados *no aplican* a este proyecto.' },
      ],
    },
    {
      titulo: 'Abre un paso',
      tramos: [{
        src: 'tab-mapa', url: P + '/step/serving', vel: 1.1, de: 'paso', antes: 0.3, a: 'toast', despues: 2.4,
        cam: [{ f: 0, z: 1.25, m: 'cabeza' }, { fm: 'hecho', df: -10, z: 1.25, m: 'cabeza' }, { fm: 'hecho', df: 15, z: 1.6, m: 'hecho' }],
        aros: [{ m: 'hecho', s: 2.6, texto: 'Done' }],
      }],
      subs: [
        { f: 0, t: 'Cada estación abre su página: estado, *puerta de entrada*, definición de hecho, notas y comandos.' },
        { m: 'hecho', t: '¿Marcarlo como hecho? Todavía no se puede: *la puerta de entrada* sigue abierta.' },
      ],
    },
    {
      titulo: 'Haz las cuentas de la puerta',
      tramos: [{
        src: 'tab-mapa', url: P + '/step/serving', vel: 1.15, de: 'puerta', antes: 0.2, a: 'abierta', despues: 2.0,
        cam: [{ f: 0, z: 1.4, m: 'calc1' }, { fm: 'resp2', df: -15, z: 1.4, m: 'calc1' }, { fm: 'resp2', df: 15, z: 1.5, m: 'resp2' },
          { fm: 'abierta', df: -10, z: 1.5, m: 'resp2' }, { fm: 'abierta', df: 15, z: 1.5, m: 'abierta' }],
        aros: [{ m: 'formula', s: 1.6, texto: 'Formula' }, { m: 'mal', s: 1.6, color: C.o }, { m: 'bien', s: 1.6, color: C.g }, { m: 'abierta', s: 2.0, color: C.g }],
      }],
      subs: [
        { f: 0, t: 'La puerta son *cuentas de dimensionamiento*: antes de construir, calculas cuánto debe aguantar.' },
        { m: 'formula', t: '¿No te acuerdas? *Formula* te muestra la fórmula y los datos del proyecto.' },
        { m: 'mal', t: 'Si te equivocas, te lo dice: *✗ off*.' },
        { m: 'bien', t: 'Corriges y sale *✓ matches*. Cada cuenta revisa tu número con su tolerancia.' },
        { m: 'abierta', t: 'Con todas las cuentas bien, *la puerta se cumple*.' },
      ],
    },
    {
      titulo: 'Ciérralo y míralo en el mapa',
      tramos: [{
        src: 'tab-mapa', url: P, vel: 1.1, de: 'cerrar', antes: 0.2,
        cam: [{ f: 0, z: 1.6, m: 'hecho2' }, { fm: 'vuelta', df: -5, z: 1.6, m: 'hecho2' }, { fm: 'vuelta', df: 10, z: 1.25, m: 'st7b' }, { fm: 'cuenta', df: -5, z: 1.25, m: 'st7b' }, { fm: 'cuenta', df: 20, z: 1.5, m: 'cuenta' }],
        aros: [{ m: 'hecho2', s: 1.6, color: C.g }, { m: 'st7b', s: 2.2, color: C.g }, { m: 'cuenta', s: 2.0 }],
      }],
      subs: [
        { f: 0, t: 'Ahora sí: *Done*. El paso queda cerrado.' },
        { m: 'vuelta', t: 'De vuelta en el mapa, la estación tiene su *✓* y la T brilla un poco más.' },
        { m: 'cuenta', t: 'Y el contador de pasos *sube*.' },
      ],
    },
    {
      titulo: 'Registra cada sesión',
      tramos: [{
        src: 'tab-registro', url: P, vel: 1.25, a: 'brief', despues: 0,
        cam: [{ f: 0, z: 1.4, m: 'boton' }, { fm: 'dialogo', df: 0, z: 1.4, m: 'boton' }, { fm: 'dialogo', df: 20, z: 1.3, m: 'dialogo' }, { fm: 'entrada', df: -10, z: 1.3, m: 'dialogo' }, { fm: 'entrada', df: 15, z: 1.25, m: 'entrada' }],
        aros: [{ m: 'boton', s: 1.4, texto: 'Log session' }, { m: 'entrada', s: 2.0 }],
      }],
      subs: [
        { f: 0, t: 'Al terminar de trabajar, *Log session*: qué hiciste, qué mediste y qué sigue.' },
        { m: 'entrada', t: 'Queda en el *Work log*, y lo que sigue se vuelve tu próxima acción.' },
      ],
    },
    {
      titulo: 'Conéctalo con Claude Code',
      tramos: [{
        src: 'tab-registro', url: P + '/settings', vel: 1.1, de: 'brief', antes: 0,
        cam: [{ f: 0, z: 1.2, x: 0.5, y: 0.5 }, { fm: 'claude', df: -10, z: 1.2, x: 0.5, y: 0.5 }, { fm: 'claude', df: 20, z: 1.5, m: 'curl' }],
        aros: [{ m: 'curl', s: 3.0 }],
      }],
      subs: [
        { f: 0, t: '*Resume brief* arma un resumen del proyecto para pegarlo al empezar una sesión de *Claude Code*.' },
        { m: 'claude', t: 'En tu tablero, Claude Code lo lee y *lo actualiza solo* con un token. En esta demo, todo se queda en tu navegador.' },
      ],
    },
    {
      titulo: 'Crea tu propio proyecto',
      tramos: [{
        src: 'tab-nuevo', url: U + '/#/new', vel: 1.1,
        cam: [{ f: 0, z: 1.3, x: 0.45, y: 0.35 }, { fm: 'patrones', df: 0, z: 1.3, x: 0.45, y: 0.35 }, { fm: 'patrones', df: 20, z: 1.15, x: 0.5, y: 0.5 }],
        aros: [{ m: 'linea', s: 2.0 }],
      }],
      subs: [
        { f: 0, t: 'Para empezar uno nuevo: ponle nombre y *elige su patrón*.' },
        { m: 'patrones', df: 30, t: 'Cada patrón trae *sus pasos* y sus cuentas: síncrono, LLM y RAG, streaming, edge…' },
      ],
    },
  ],
  invita: 'Pruébalo con *el proyecto de ejemplo*.',
  ideas: ['Cada proyecto es *un mapa*, del dato al monitoreo.', 'Ningún paso se cierra sin *sus cuentas*.', 'Cada sesión deja *dónde te quedaste* y qué sigue.'],
};
