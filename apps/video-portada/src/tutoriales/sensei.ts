// Cómo se usa Sensei: de la portada al repaso con tarjetas.
import { C } from '../tema';
import type { Guion } from './kit';

const U = 'sensei.trueml.app';

export const SENSEI: Guion = {
  id: 'sensei', app: 'Sensei', url: U, color: C.yt, color2: C.b,
  titulo: 'Cómo usar *Sensei*',
  que: 'El curso de teoría de TrueML: ML engineering desde cero, para entenderlo de verdad. Sin cuenta y gratis.',
  intro: 150, cierre: 240,
  pasos: [
    {
      titulo: 'Empieza en la portada',
      tramos: [{
        src: 'sen-inicio', url: U, vel: 1.15,
        cam: [{ f: 0, z: 1.05, x: 0.5, y: 0.45 }, { fm: 'empezar', df: -10, z: 1.05, x: 0.5, y: 0.45 }, { fm: 'empezar', df: 15, z: 1.5, m: 'empezar' },
          { fm: 'avance', df: -20, z: 1.5, m: 'empezar' }, { fm: 'avance', df: 10, z: 1.35, m: 'avance' }, { fm: 'temario', df: -5, z: 1.35, m: 'avance' },
          { fm: 'temario', df: 20, z: 1.12, x: 0.5, y: 0.5 }, { fm: 'como', df: -10, z: 1.12, x: 0.5, y: 0.5 }, { fm: 'como', df: 20, z: 1.3, m: 'como' }],
        aros: [{ m: 'empezar', s: 2.4, texto: 'Empezar' }, { m: 'avance', s: 2.4 }, { m: 'como', s: 3.2 }],
      }],
      subs: [
        { f: 0, t: 'Sensei es el curso de teoría: *59 lecciones* de ML engineering, desde lo más básico.' },
        { m: 'empezar', t: '*Empezar* te lleva a la primera lección. Cuando ya vas avanzando, dice *Seguir* y te lleva a la que toca.' },
        { m: 'avance', t: '*Tu avance* se guarda solo en tu navegador: no necesitas cuenta ni contraseña.' },
        { m: 'temario', t: 'El *temario* va en orden: 15 módulos, del mapa general hasta llevar un modelo a producción.' },
        { m: 'como', t: 'Y aquí te dice *cómo se lee*: primero lo esencial, luego juegas, practicas y repasas.' },
      ],
    },
    {
      titulo: 'Mira el camino de un modelo',
      tramos: [{
        src: 'sen-camino', url: U, vel: 1.1,
        cam: [{ f: 0, z: 1.15, m: 'diagrama' }, { fm: 'nodo', df: -10, z: 1.15, m: 'diagrama' }, { fm: 'nodo', df: 20, z: 1.45, m: 'nota' },
          { fm: 'vuelta', df: -10, z: 1.45, m: 'nota' }, { fm: 'vuelta', df: 20, z: 1.3, m: 'paso' }],
        aros: [{ m: 'nodo', s: 1.8 }, { m: 'vuelta', s: 1.8, texto: 'Una vuelta completa' }],
      }],
      subs: [
        { f: 0, t: 'En la portada está *el camino de un modelo*: seis etapas, de los datos al monitoreo.' },
        { m: 'nodo', t: 'Toca una etapa y te explica *por qué está ahí*.' },
        { m: 'vuelta', t: 'O pide *una vuelta completa*: te lleva paso a paso por todo el recorrido.' },
      ],
    },
    {
      titulo: 'Abre una lección',
      tramos: [{
        src: 'sen-leccion', url: U + '/llms/', vel: 1.15,
        cam: [{ f: 0, z: 1.3, m: 'cabeza' }, { fm: 'meta', df: 10, z: 1.5, m: 'meta' }, { fm: 'indice', df: -10, z: 1.5, m: 'meta' }, { fm: 'indice', df: 20, z: 1.45, m: 'indice' },
          { fm: 'pregunta', df: -25, z: 1.45, m: 'indice' }, { fm: 'pregunta', df: 10, z: 1.35, m: 'pregunta' }, { fm: 'idea', df: 10, z: 1.35, m: 'idea' },
          { fm: 'esencial', df: 10, z: 1.4, m: 'seccion' }],
        aros: [{ m: 'meta', s: 2.2 }, { m: 'indice', s: 2.2, texto: 'En esta página', lado: 'izq' }, { m: 'esencial', s: 2.6, texto: 'Esencial' }],
      }],
      subs: [
        { f: 0, t: 'Cada lección empieza igual. Arriba ves *cuánto dura* y qué trae: conceptos, calculadoras y ejercicios.' },
        { m: 'indice', t: 'A la derecha va *el índice*: marca en qué sección vas mientras lees.' },
        { m: 'pregunta', t: 'Primero, *la pregunta* que vas a poder contestar al terminar…' },
        { m: 'idea', t: '…y *la idea en una frase*, por si solo tienes un minuto.' },
        { m: 'esencial', t: 'Cada sección dice si es *Esencial* o *Extra*. Con lo esencial ya entiendes la lección.' },
      ],
    },
    {
      titulo: 'Toca las palabras subrayadas',
      tramos: [{
        src: 'sen-glosario', url: U + '/llms/', vel: 1.1,
        cam: [{ f: 0, z: 1.4, m: 'palabra' }, { fm: 'pop', df: -5, z: 1.55, m: 'palabra' }, { fm: 'pop', df: 20, z: 1.45, m: 'pop' }],
        aros: [{ m: 'palabra', s: 2.0 }],
      }],
      subs: [
        { f: 0, t: '¿Una palabra que no conoces? Si está *subrayada*, tiene su definición.' },
        { m: 'pop', t: 'Un clic y aparece: *qué es*, cómo se dice en inglés y en qué lección se explica a fondo.' },
      ],
    },
    {
      titulo: 'Juega con la calculadora',
      tramos: [{
        src: 'sen-calc', url: U + '/llms/', vel: 1.1,
        cam: [{ f: 0, z: 1.12, m: 'calc' }, { fm: 'slider-n', df: 0, z: 1.12, m: 'calc' }, { fm: 'slider-n', df: 30, z: 1.35, m: 'calc' }],
        aros: [{ m: 'slider-n', s: 2.6 }, { m: 'resultado', s: 2.4 }, { m: 'slider-vd', s: 2.4 }, { m: 'resultado2', s: 2.6 }],
      }],
      subs: [
        { f: 0, t: 'Las *calculadoras* usan las fórmulas reales. Mueve un número y mira qué pasa.' },
        { m: 'slider-n', t: '¿Respuestas más largas? El tiempo total *sube*, y ves de dónde sale cada parte.' },
        { m: 'slider-vd', t: '¿Un servidor que genera más rápido? Vuelve a bajar. Así la fórmula *se siente*.' },
      ],
    },
    {
      titulo: 'Practica y marca tu avance',
      tramos: [
        {
          src: 'sen-practica', url: U + '/llms/', vel: 1.15, a: 'leer', despues: 2.4,
          cam: [{ f: 0, z: 1.3, m: 'ejercicio' }, { fm: 'solucion', df: 10, z: 1.3, m: 'solucion', dy: 0.1 }, { fm: 'leer', df: -10, z: 1.3, m: 'solucion', dy: 0.1 }, { fm: 'leer', df: 15, z: 1.5, m: 'leer' }],
          aros: [{ m: 'ver-sol', s: 2.0 }, { m: 'leer', s: 2.2, texto: 'Marcar como leída' }],
        },
        {
          src: 'sen-practica', url: U + '/llms/', vel: 1.15, de: 'leida', antes: 0.8,
          cam: [{ f: 0, z: 1.4, m: 'leida' }, { fm: 'progreso', df: -5, z: 1.4, m: 'leida' }, { fm: 'progreso', df: 15, z: 1.7, m: 'progreso' }, { fm: 'sigue', df: -10, z: 1.7, m: 'progreso' }, { fm: 'sigue', df: 15, z: 1.35, m: 'sigue' }],
          aros: [{ m: 'leida', s: 1.6 }, { m: 'progreso', s: 1.8 }, { m: 'sigue', s: 2.0 }],
        },
      ],
      subs: [
        { f: 0, t: 'Al final hay *ejercicios* de tres niveles: fácil, medio y reto.' },
        { m: 'ver-sol', t: 'Inténtalo primero. Después abre *la solución paso a paso*.' },
        { m: 'leer', t: 'Cada sección se puede *marcar como leída*: el tanque de arriba se va llenando.' },
        { k: 1, m: 'leida', t: 'Al terminar, *marca la lección*: aparece la palomita y tu contador sube.' },
        { k: 1, m: 'sigue', t: 'Y abajo te espera *la siguiente lección*.' },
      ],
    },
    {
      titulo: 'Busca cualquier concepto',
      tramos: [{
        src: 'sen-buscar', url: U + '/llms/', vel: 1.1, a: 'llego', despues: 1.6,
        cam: [{ f: 0, z: 1.6, m: 'caja', dy: 0.15, dx: 0.15 }, { fm: 'llego', df: -10, z: 1.6, m: 'caja', dy: 0.15, dx: 0.15 }, { fm: 'llego', df: 10, z: 1.1, x: 0.5, y: 0.45 }],
        aros: [{ m: 'caja', s: 1.6 }, { m: 'resultados', s: 2.4 }],
      }],
      subs: [
        { f: 0, t: '¿Buscas algo concreto? Escribe en *el buscador* de la izquierda.' },
        { m: 'resultados', t: 'Salen las lecciones y los términos del glosario. *Un clic* y estás ahí.' },
      ],
    },
    {
      titulo: 'Repasa con tarjetas',
      tramos: [{
        src: 'sen-repaso', url: U + '/repaso/', vel: 1.1,
        cam: [{ f: 0, z: 1.25, m: 'elegir' }, { fm: 'frente', df: -5, z: 1.25, m: 'elegir' }, { fm: 'frente', df: 15, z: 1.3, m: 'frente', dy: 0.08 }],
        aros: [{ m: 'empezar', s: 1.4 }, { m: 'voltear', s: 1.5 }, { m: 'facil', s: 1.4 }, { m: 'costo', s: 1.4 }],
      }],
      subs: [
        { f: 0, t: 'Para que no se te olvide: *el repaso con tarjetas*. Eliges qué lecciones repasar.' },
        { m: 'frente', t: 'Lees la pregunta y tratas de contestarla *de memoria*.' },
        { m: 'voltear', t: 'Volteas la tarjeta y comparas con la respuesta…' },
        { m: 'facil', t: '…y dices qué tan fácil fue. Las que te *cuestan* regresan más pronto.' },
      ],
    },
  ],
  invita: 'Empieza por *El camino completo*.',
  ideas: ['Lee *lo esencial* de cada lección, en orden.', '*Juega* con las calculadoras y haz los ejercicios.', '*Repasa* con tarjetas para que se quede.'],
};
