// Las muestras: un vistazo corto (≈ 40 s) a las herramientas que no llevan tutorial completo.
import { C } from '../tema';
import type { Guion } from './tiempo';

const corta = { intro: 120, cierre: 180, kicker: 'Una muestra' };

export const TRANSFORMER: Guion = {
  ...corta, id: 'transformer', app: 'Laboratorio Transformer', url: 'laboratorio-transformer.vercel.app', color: '#FF8A5C', color2: C.b,
  titulo: 'Mira entrenar *un transformer*',
  que: 'Un transformer pequeño que entrena de verdad en tu navegador, y te enseña cada operación con su fórmula.',
  pasos: [
    {
      titulo: 'Dale play',
      tramos: [{ src: 'transformer', url: 'laboratorio-transformer.vercel.app/#paso', de: 1.4, vel: 1.15,
        cam: [{ f: 0, z: 1.0, x: 0.5, y: 0.5 }, { f: 70, z: 1.32, x: 0.42, y: 0.42 }, { f: 200, z: 1.45, x: 0.5, y: 0.5 }, { f: 330, z: 1.3, x: 0.45, y: 0.45 }] }],
      subs: [
        { f: 0, t: 'Le das *play* y el modelo avanza un paso de entrenamiento, *operación por operación*.' },
        { f: 140, t: 'Cada matriz trae *su fórmula y sus dimensiones*: forward, pérdida, backward y actualización.' },
      ],
    },
    {
      titulo: 'Míralo aprender',
      tramos: [{ src: 'transformer-entrena', url: 'laboratorio-transformer.vercel.app/#entrenamiento', de: 0.8, vel: 1.3,
        cam: [{ f: 0, z: 1.5, x: 0.2, y: 0.52 }, { f: 220, z: 1.3, x: 0.32, y: 0.55 }] }],
      subs: [
        { f: 0, t: 'Con *+100* corre cien pasos seguidos…' },
        { f: 90, t: '…y la pérdida *baja*: lo estás viendo aprender, con números reales.' },
      ],
    },
  ],
  invita: 'Dale *play* tú.',
  ideas: ['Todo corre *en tu navegador*.', 'Cada operación, con *su fórmula*.', 'Lo ves *aprender* paso a paso.'],
};

export const ATLAS: Guion = {
  ...corta, id: 'atlas', app: 'Atlas de Arquitecturas', url: 'atlas-arquitecturas.vercel.app', color: '#A08FFF', color2: C.b,
  titulo: 'Las arquitecturas, *por dentro*',
  que: 'ViT, LLaMA, LLaVA y más: cada bloque con su forma, sus parámetros y una calculadora verificada contra PyTorch.',
  pasos: [
    {
      titulo: 'Recorre el diagrama',
      tramos: [{ src: 'atlas-diagrama', url: 'atlas-arquitecturas.vercel.app/#vit', de: 0.4, vel: 1.25,
        cam: [{ f: 0, z: 1.2, x: 0.58, y: 0.3 }, { f: 150, z: 1.6, x: 0.6, y: 0.36 }, { f: 300, z: 1.45, x: 0.6, y: 0.55 }] }],
      subs: [
        { f: 0, t: 'Cada arquitectura, *bloque por bloque*.' },
        { f: 90, t: 'Pasa el cursor y ves *la forma del tensor* y cuántos parámetros tiene cada pieza.' },
      ],
    },
    {
      titulo: 'Mueve los números',
      tramos: [{ src: 'atlas-parches', url: 'atlas-arquitecturas.vercel.app/#vit', de: 0.4, vel: 1.2,
        cam: [{ f: 0, z: 1.75, x: 0.42, y: 0.3 }, { f: 240, z: 1.6, x: 0.45, y: 0.32 }] }],
      subs: [
        { f: 0, t: 'Cambia el tamaño del parche o de la imagen…' },
        { f: 100, t: '…y mira cómo cambian *los tokens* y la memoria. Las cuentas cuadran con PyTorch.' },
      ],
    },
  ],
  invita: 'Abre *el ViT* y juega.',
  ideas: ['Diagramas *que se exploran*.', 'Formas y parámetros *exactos*.', 'Calculadoras *verificadas*.'],
};

export const RONDA: Guion = {
  ...corta, id: 'ronda', app: 'Ronda de Diseño ML', url: 'ronda-diseno-ml.vercel.app', color: '#7C93FF', color2: C.p,
  titulo: 'Practica la entrevista de *diseño de ML*',
  que: 'Un simulador de entrevista de ML system design: el caso, el reloj, un esqueleto de 7 pasos y la rúbrica para calificarte.',
  pasos: [
    {
      titulo: 'Empieza el caso',
      tramos: [{ src: 'm-ronda', url: 'ronda-diseno-ml.vercel.app/#practica-c01', vel: 1.1, a: 'esqueleto', despues: 0.2,
        cam: [{ f: 0, z: 1.2, x: 0.5, y: 0.35 }, { fm: 'reloj', df: -10, z: 1.2, x: 0.5, y: 0.35 }, { fm: 'reloj', df: 15, z: 1.6, m: 'reloj' }],
        aros: [{ m: 'reloj', s: 2.2 }] }],
      subs: [
        { f: 0, t: 'El entrevistador te da *un caso real*: «expón este clasificador como servicio».' },
        { m: 'reloj', t: 'Corre *el reloj*: 45 minutos, como en la entrevista de verdad.' },
      ],
    },
    {
      titulo: 'Diseña en 7 pasos',
      tramos: [{ src: 'm-ronda', url: 'ronda-diseno-ml.vercel.app/#practica-c01', vel: 1.1, de: 'esqueleto', antes: 0.6,
        cam: [{ f: 0, z: 1.4, m: 'esqueleto' }, { fm: 'diseno', df: 10, z: 1.25, m: 'diseno', dy: -0.15 }, { f: 220, z: 1.25, x: 0.75, y: 0.6 }],
        aros: [{ m: 'esqueleto', s: 1.6, texto: 'Insertar esqueleto' }] }],
      subs: [
        { f: 0, t: '*Insertar esqueleto* te deja los 7 pasos: preguntas, requisitos, estimaciones, arquitectura…' },
        { f: 150, t: 'Al terminar, te calificas con *la rúbrica* y comparas con *la solución*.' },
      ],
    },
  ],
  invita: 'Haz *tu primera ronda*.',
  ideas: ['Casos *de entrevista real*.', 'El reloj y *los 7 pasos*.', 'Rúbrica y solución *para compararte*.'],
};

export const HOJAS: Guion = {
  ...corta, id: 'hojas', app: 'Cheat sheets', url: 'cheat-sheets-ml.vercel.app', color: C.yt, color2: C.o,
  titulo: 'Lo esencial, *en una hoja*',
  que: 'Docker, Kubernetes, Triton, vLLM, Prometheus, estimaciones… en hojas que se leen en el celular y se imprimen en PDF.',
  pasos: [
    {
      titulo: 'Elige una hoja',
      tramos: [{ src: 'm-hojas', url: 'cheat-sheets-ml.vercel.app', vel: 1.15,
        cam: [{ f: 0, z: 1.1, x: 0.5, y: 0.45 }, { f: 250, z: 1.2, x: 0.5, y: 0.5 }] }],
      subs: [
        { f: 0, t: 'Nueve hojas con *lo que sí vas a usar*: comandos, cifras y conceptos clave.' },
        { f: 140, t: 'Todas funcionan *sin internet* y se imprimen en PDF.' },
      ],
    },
    {
      titulo: 'Léela de un vistazo',
      tramos: [{ src: 'hojas', url: 'cheat-sheets-ml.vercel.app/docker/', de: 0.2, vel: 1.1,
        cam: [{ f: 0, z: 1.45, x: 0.3, y: 0.35 }, { f: 220, z: 1.5, x: 0.45, y: 0.4 }] }],
      subs: [
        { f: 0, t: 'Explicadas en *lenguaje sencillo*, con cifras fáciles de recordar.' },
        { f: 120, t: 'Perfectas para *repasar antes* de una entrevista o un deploy.' },
      ],
    },
  ],
  invita: 'Guarda *tus hojas*.',
  ideas: ['*Nueve hojas* y vienen más.', 'Se leen bien *en el celular*.', '*Offline* y en PDF.'],
};
