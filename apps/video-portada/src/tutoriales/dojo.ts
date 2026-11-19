// Cómo se usa el Dojo: elegir el entrenamiento, leer la estación, bajar el kit, las cuatro rondas y el tablero.
import { C } from '../tema';
import type { Guion } from './tiempo';

const U = 'taller-ai-engineer.vercel.app';
const KIT = U + '/c01/datos/proyecto-con-kit/';

export const DOJO: Guion = {
  id: 'dojo', app: 'Dojo', url: U, color: '#2FD3A0', color2: C.b,
  titulo: 'Cómo usar *el Dojo*',
  que: 'La práctica de TrueML: construyes un proyecto real de punta a punta en tu Mac, estación por estación, con Claude Code.',
  intro: 150, cierre: 240,
  pasos: [
    {
      titulo: 'Elige un entrenamiento',
      tramos: [{
        src: 'dojo-t-inicio', url: U, vel: 1.15,
        cam: [{ f: 0, z: 1.15, m: 'titulo', dy: 0.1 }, { fm: 'como', df: -5, z: 1.15, m: 'titulo', dy: 0.1 }, { fm: 'como', df: 20, z: 1.05, x: 0.5, y: 0.5 },
          { fm: 'rondas', df: 0, z: 1.05, x: 0.5, y: 0.5 }, { fm: 'rondas', df: 25, z: 1.4, m: 'rondas' }, { fm: 'c01', df: -15, z: 1.4, m: 'rondas' }, { fm: 'c01', df: 15, z: 1.3, m: 'c01' }],
        aros: [{ m: 'rondas', s: 2.6 }, { m: 'c01', s: 2.4, texto: 'Clasificación de imágenes' }],
      }],
      subs: [
        { f: 0, t: 'El Dojo es la práctica: eliges *un proyecto real* y lo construyes de punta a punta en tu Mac.' },
        { m: 'como', t: 'La web es *la guía*. El trabajo pasa en tu terminal, con un kit y *Claude Code*.' },
        { m: 'rondas', t: 'Cada estación la haces *cuatro veces*: la construyes con ayuda y solo, y la arreglas rota con ayuda y solo.' },
        { m: 'c01', t: 'Para empezar: *Clasificación de imágenes*. Sus 12 estaciones ya están listas.' },
      ],
    },
    {
      titulo: 'Ubica la estación en el mapa',
      tramos: [{
        src: 'dojo-t-mapa', url: U + '/c01/', vel: 1.1, a: 'st12', despues: 2.6,
        cam: [{ f: 0, z: 1.1, m: 'mapa' }, { fm: 'st1', df: -10, z: 1.1, m: 'mapa' }, { fm: 'st1', df: 15, z: 1.3, m: 'mapa' }],
        aros: [{ m: 'st1', s: 1.8 }, { m: 'st6', s: 1.8 }, { m: 'st12', s: 1.8 }],
      }],
      subs: [
        { f: 0, t: 'Cada entrenamiento es *un mapa de metro*: 12 estaciones, del dato al monitoreo.' },
        { m: 'st1', t: 'Pasa el cursor por una estación y te dice *qué recibe* y *qué entrega*.' },
        { m: 'st12', df: -20, t: 'Vas en orden: lo que sale de una estación *entra a la siguiente*.' },
      ],
    },
    {
      titulo: 'Lee la estación',
      tramos: [{
        src: 'dojo-t-estacion', url: U + '/c01/datos/', vel: 1.15,
        cam: [{ f: 0, z: 1.3, m: 'titulo', dy: 0.08 }, { fm: 'donde', df: -10, z: 1.3, m: 'titulo', dy: 0.08 }, { fm: 'donde', df: 20, z: 1.1, x: 0.5, y: 0.5 },
          { fm: 'caminos', df: 0, z: 1.1, x: 0.5, y: 0.5 }, { fm: 'caminos', df: 20, z: 1.3, m: 'caminos' }, { fm: 'concepto', df: -10, z: 1.3, m: 'caminos' }, { fm: 'concepto', df: 25, z: 1.3, m: 'concepto', dy: 0.15 }],
        aros: [{ m: 'caminos', s: 4.0 }, { m: 'concepto', s: 1.8 }],
      }],
      subs: [
        { f: 0, t: 'Cada estación abre con *su pregunta*: el problema real que vas a resolver.' },
        { m: 'donde', t: '*Dónde estás*: qué entra, qué sale y cómo se ve en una empresa de verdad.' },
        { m: 'caminos', t: 'Luego, *los caminos en orden*: dos prácticas desde cero y el proyecto con kit.' },
        { m: 'concepto', t: 'Y los *conceptos exprés*: una analogía, por qué importa y la trampa típica.' },
      ],
    },
    {
      titulo: 'Baja el kit y levanta el mundo',
      tramos: [{
        src: 'dojo-t-kit', url: KIT, vel: 1.05,
        cam: [{ f: 0, z: 1.1, m: 'arranque' }, { fm: 'kit', df: 0, z: 1.1, m: 'arranque' }, { fm: 'kit', df: 25, z: 1.55, m: 'kit' },
          { fm: 'comandos', df: -10, z: 1.55, m: 'kit' }, { fm: 'comandos', df: 20, z: 1.45, m: 'comandos' }],
        aros: [{ m: 'kit', s: 2.6, texto: 'Bajar el kit' }, { m: 'comandos', s: 3.6 }],
      }],
      subs: [
        { f: 0, t: 'Para practicar, *arrancas en 3 pasos*. Lo primero es bajar el kit.' },
        { m: 'kit', t: 'El *kit* es una carpeta con los datos, los servicios y las pruebas que dicen si ya quedó.' },
        { m: 'comandos', t: 'Copias los comandos, levantas *el mundo* con Docker y corres *verificar.py*: todo en verde.' },
      ],
    },
    {
      titulo: 'Elige tu ronda',
      tramos: [{
        src: 'dojo-t-rondas', url: KIT + '#rondas', vel: 1.1,
        cam: [{ f: 0, z: 1.15, m: 'rejilla' }, { fm: 'copiar', df: -10, z: 1.15, m: 'rejilla' }, { fm: 'copiar', df: 20, z: 1.5, m: 'copiar' },
          { fm: 'prompt', df: -5, z: 1.5, m: 'copiar' }, { fm: 'prompt', df: 25, z: 1.3, m: 'prompt' }],
        aros: [{ m: 'copiar', s: 2.0, texto: 'Copiar el prompt' }],
      }],
      subs: [
        { f: 0, t: 'Ya con todo corriendo, eliges *cómo practicar*: cuatro rondas, de la más guiada a la más difícil.' },
        { m: 'copiar', t: 'Cada ronda trae su *prompt*: lo copias y lo pegas en Claude Code, abierto en la carpeta del kit.' },
        { m: 'prompt', t: 'El prompt le dice a Claude *cómo ayudarte*: en la guiada te explica; en la solo, no te da código.' },
      ],
    },
    {
      titulo: 'Constrúyelo: guiado y solo',
      tramos: [{
        src: 'dojo-t-guiado', url: KIT + '#guiado', vel: 1.1,
        cam: [{ f: 0, z: 1.2, x: 0.5, y: 0.42 }, { f: 90, z: 1.15, x: 0.5, y: 0.5 }, { fm: 'objetivos', df: 0, z: 1.2, x: 0.5, y: 0.5 }, { fm: 'objetivos', df: 25, z: 1.3, m: 'objetivos', dy: -0.1 }],
      }],
      subs: [
        { f: 0, t: '*Guiado*: paso a paso, con el código de referencia y lo que te debe salir en la terminal.' },
        { m: 'objetivos', df: -70, t: '*Solo*: nada más los objetivos. Cada uno se comprueba con *verificar.py*, sin trampa.' },
      ],
    },
    {
      titulo: 'Rómpelo y arréglalo',
      tramos: [{
        src: 'dojo-t-romper', url: KIT + '#romper', vel: 1.1,
        cam: [{ f: 0, z: 1.45, m: 'comandos' }, { fm: 'catalogo', df: -10, z: 1.45, m: 'comandos' }, { fm: 'catalogo', df: 15, z: 1.3, m: 'catalogo' }, { fm: 'falla', df: -15, z: 1.3, m: 'catalogo' }, { fm: 'falla', df: 10, z: 1.25, m: 'falla', dx: 0.2 }],
        aros: [{ m: 'comandos', s: 3.4 }, { m: 'catalogo', s: 1.6 }],
      }],
      subs: [
        { f: 0, t: 'Después viene lo bueno: *romper.py* mete una falla real en tu sistema.' },
        { m: 'comandos', df: 55, t: '*Con ayuda*, Claude sabe cuál es. *Solo*, está escondida y te toca investigar.' },
        { m: 'catalogo', t: 'La diagnosticas y la arreglas, como en producción. Al final, *el catálogo* explica cada falla.' },
      ],
    },
    {
      titulo: 'Lleva tu registro',
      tramos: [{
        src: 'dojo-t-tablero', url: U + '/tablero/', vel: 1.1,
        cam: [{ f: 0, z: 1.3, m: 'stats' }, { fm: 'pegado', df: -10, z: 1.3, m: 'stats' }, { fm: 'pegado', df: 20, z: 1.3, m: 'pegado' },
          { fm: 'res', df: 0, z: 1.3, m: 'pegado' }, { fm: 'res', df: 20, z: 1.35, m: 'res' }, { fm: 'estaciones', df: -5, z: 1.35, m: 'res' }, { fm: 'estaciones', df: 20, z: 1.15, x: 0.5, y: 0.45 }],
        aros: [{ m: 'importar', s: 1.6, texto: 'Importar lo pegado' }, { m: 'hecha', s: 2.0 }],
      }],
      subs: [
        { f: 0, t: 'Tu avance queda en *Tu tablero*. Mientras trabajas, el kit lo va anotando en *progreso.json*.' },
        { m: 'pegado', t: 'Lo importas: subes el archivo o *pegas su contenido*. Sin cuenta: se queda en tu navegador.' },
        { m: 'res', t: 'Y ves tus rondas, las fallas que arreglaste y *tu bitácora*.' },
        { m: 'hecha', t: 'También puedes *marcar una ronda* a mano cuando la terminas.' },
      ],
    },
  ],
  invita: 'Empieza por la *estación 1*.',
  ideas: ['La web es *la guía*; el trabajo, en tu Mac con *Claude Code*.', 'Cada estación, *cuatro rondas*: construir y romper, con ayuda y solo.', 'Importa *progreso.json* y mira tu avance.'],
};
