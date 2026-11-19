// Las tomas de los videos explicativos (src/tutoriales/): qué se abre y qué se hace, en tiempo real.
// marcar(p, sel, id) anota dónde está un elemento en ese instante (src/marcas.json): el montaje lo usa para
// apuntar la cámara y dibujar el aro. momento(p, id) anota solo el segundo (para empezar un tramo ahí).
import { APPS } from './apps.mjs';
import { clic, mover, desplazar, llevar, centro, arrastrar, marcar, momento, teclear } from './grabador.mjs';

const espera = (p, ms) => p.waitForTimeout(ms);
// sin los botones flotantes («Volver a TrueML», «Notas»): tapan las esquinas de la grabación
const LIMPIO = `addEventListener('DOMContentLoaded', () => { const s = document.createElement('style');
  s.textContent = '.tm-dock,.tm-notas-btn{display:none!important}'; document.head.appendChild(s); });`;
const oscuro = (clave) => `try { localStorage.setItem('${clave}', 'dark') } catch (e) {}; ${LIMPIO}`;
const sinSW = { serviceWorkers: 'block' };
const arriba = async (p, sel, y = 120, ms = 1400) => llevar(p, sel, y, ms);

// ------------------------------------------------------------------------------------------- Sensei
const SENSEI = [
  {
    nombre: 'sen-inicio', url: APPS.sensei + '/', init: oscuro('sensei-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await marcar(p, '.home-hero h1', 'titulo', 14);
      await mover(p, 1000, 330, 900);
      await espera(p, 1800);
      await marcar(p, 'a[data-seguir]', 'empezar');
      await mover(p, (await centro(p, 'a[data-seguir]')).x, (await centro(p, 'a[data-seguir]')).y, 900);
      await espera(p, 1800);
      await arriba(p, '#h-prog', 110, 1600);
      await espera(p, 400);
      await marcar(p, 'section:has(#h-prog) .prog', 'avance');
      await espera(p, 2200);
      await arriba(p, '#temario', 80, 1800);
      await espera(p, 400);
      await marcar(p, '#temario ol.mods', 'temario', 0);
      await mover(p, 900, 450, 900);
      await espera(p, 1000);
      await desplazar(p, (await p.evaluate(() => scrollY)) + 700, 2600);
      await espera(p, 1200);
      await arriba(p, '#h-como', 90, 1800);
      await espera(p, 400);
      await marcar(p, 'section:has(#h-como) ol.ruta', 'como', 6);
      await espera(p, 3200);
    },
  },
  {
    nombre: 'sen-camino', url: APPS.sensei + '/', init: oscuro('sensei-tema'), contexto: sinSW,
    async preparar(p) { await p.waitForSelector('.dg-mount.is-listo', { timeout: 15000 }).catch(() => {}); await arriba(p, '#h-camino', 70, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'section:has(#h-camino) .dg-mount', 'diagrama', 0);
      await marcar(p, 'section:has(#h-camino) g.dg-node[data-node="modelo"]', 'nodo');
      await clic(p, 'section:has(#h-camino) g.dg-node[data-node="modelo"]', 1000);
      await espera(p, 600);
      await marcar(p, 'section:has(#h-camino) .dg__note', 'nota');
      await espera(p, 2600);
      await marcar(p, 'section:has(#h-camino) button.dg__flowbtn', 'vuelta');
      await clic(p, 'section:has(#h-camino) button.dg__flowbtn', 900);
      await espera(p, 1800);
      for (let i = 0; i < 3; i++) {
        await clic(p, 'section:has(#h-camino) .dg__btn--primary', 700);
        if (i === 0) await marcar(p, 'section:has(#h-camino) .dg__step', 'paso');
        await espera(p, 1700);
      }
      await espera(p, 800);
    },
  },
  {
    nombre: 'sen-leccion', url: APPS.sensei + '/llms/', init: oscuro('sensei-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'header.phead', 'cabeza', 10);
      await mover(p, 760, 260, 900);
      await espera(p, 1400);
      await marcar(p, '.phead__meta', 'meta', 8);
      await espera(p, 2200);
      await marcar(p, 'aside.toc', 'indice', 6);
      await mover(p, 1420, 380, 1000);
      await espera(p, 2200);
      await arriba(p, '.c-pregunta', 140, 1600);
      await espera(p, 300);
      await marcar(p, '.c-pregunta', 'pregunta', 10);
      await espera(p, 2000);
      await marcar(p, 'aside.c-idea', 'idea', 10);
      await espera(p, 2200);
      await arriba(p, 'section.sec', 110, 1600);
      await espera(p, 300);
      await marcar(p, 'section.sec .sec__title', 'seccion', 10);
      await marcar(p, 'section.sec .prio--core', 'esencial', 8);
      await espera(p, 2600);
    },
  },
  {
    nombre: 'sen-glosario', url: APPS.sensei + '/llms/', init: oscuro('sensei-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, 'section.sec a.g[data-g="token"]', 330, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'section.sec a.g[data-g="token"]', 'palabra', 6);
      await mover(p, (await centro(p, 'section.sec a.g[data-g="token"]')).x, (await centro(p, 'section.sec a.g[data-g="token"]')).y, 1000);
      await espera(p, 1200);
      await clic(p, 'section.sec a.g[data-g="token"]', 300);
      await espera(p, 500);
      await marcar(p, '.g-pop', 'pop', 8);
      await espera(p, 4200);
      await clic(p, '.g-pop .g-pop-x', 800);
      await espera(p, 900);
    },
  },
  {
    nombre: 'sen-calc', url: APPS.sensei + '/llms/', init: oscuro('sensei-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#calc-llms-tiempo', 60, 10); await espera(p, 600); },
    async accion(p) {
      const s = (id) => p.locator(`#calc-llms-tiempo input[type=range][data-id="${id}"]`);
      await espera(p, 500);
      await marcar(p, '#calc-llms-tiempo', 'calc', 0);
      await espera(p, 1200);
      await marcar(p, '#calc-llms-tiempo input[data-id="n"]', 'slider-n', 10);
      await arrastrar(p, s('n'), 1500, 1800);
      await espera(p, 400);
      await marcar(p, '#calc-llms-tiempo .cx-out', 'resultado', 8);
      await espera(p, 2200);
      await marcar(p, '#calc-llms-tiempo input[data-id="vd"]', 'slider-vd', 10);
      await arrastrar(p, s('vd'), 90, 1600);
      await espera(p, 400);
      await marcar(p, '#calc-llms-tiempo .cx-out', 'resultado2', 8);
      await espera(p, 2600);
    },
  },
  {
    nombre: 'sen-practica', url: APPS.sensei + '/llms/', init: oscuro('sensei-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#ejercicios .c-ej', 120, 10); await espera(p, 600); },
    async accion(p) {
      const sol = '#ejercicios li.c-ej details.c-ej-sol > summary';
      await espera(p, 500);
      await marcar(p, '#ejercicios li.c-ej', 'ejercicio', 8);
      await espera(p, 1800);
      await marcar(p, sol, 'ver-sol', 6);
      await clic(p, sol, 900);
      await espera(p, 600);
      await marcar(p, '#ejercicios li.c-ej details.c-ej-sol', 'solucion', 6);
      await espera(p, 3000);
      // marcar la sección de ejercicios como leída
      const leer = '#ejercicios button.tm-leer';
      await arriba(p, leer, 520, 1600);
      await espera(p, 300);
      await marcar(p, leer, 'leer', 8);
      await clic(p, leer, 800);
      await espera(p, 1800);
      // el cierre: toda la lección leída
      await arriba(p, 'section.cierre', 160, 2000);
      await espera(p, 300);
      await marcar(p, 'button.c-leida', 'leida', 8);
      await clic(p, 'button.c-leida', 800);
      await espera(p, 900);
      await marcar(p, '.side-prog', 'progreso', 8);
      await espera(p, 1600);
      await marcar(p, 'section.cierre a.card', 'sigue', 6);
      await mover(p, (await centro(p, 'section.cierre a.card')).x, (await centro(p, 'section.cierre a.card')).y, 900);
      await espera(p, 2000);
    },
  },
  {
    nombre: 'sen-buscar', url: APPS.sensei + '/llms/', init: oscuro('sensei-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'input[data-buscar-nav]', 'caja', 6);
      await teclear(p, 'input[data-buscar-nav]', 'kv cache', 110);
      await espera(p, 600);
      await marcar(p, 'ul.side-res', 'resultados', 6);
      await espera(p, 2600);
      await clic(p, 'ul.side-res a', 800);
      await p.waitForLoadState('load');
      await espera(p, 1500);
      await momento(p, 'llego');
      await mover(p, 900, 400, 900);
      await espera(p, 2200);
    },
  },
  {
    nombre: 'sen-repaso', url: APPS.sensei + '/repaso/?l=llms', init: oscuro('sensei-tema'), contexto: sinSW,
    async preparar(p) { await p.waitForSelector('[data-rp-empezar]:not([disabled])', { timeout: 20000 }); },
    async accion(p) {
      await espera(p, 600);
      await marcar(p, '[data-rp-elegir]', 'elegir', 6);
      await espera(p, 1600);
      await marcar(p, 'button[data-rp-empezar]', 'empezar');
      await clic(p, 'button[data-rp-empezar]', 900);
      await espera(p, 900);
      await marcar(p, '[data-rp-t]', 'frente', 14);
      await espera(p, 2400);
      await marcar(p, 'button[data-rp-voltear]', 'voltear');
      await clic(p, 'button[data-rp-voltear]', 800);
      await espera(p, 2600);
      await marcar(p, 'button[data-nota="3"]', 'facil');
      await clic(p, 'button[data-nota="3"]', 800);
      await espera(p, 1800);
      await clic(p, 'button[data-rp-voltear]', 800);
      await espera(p, 2000);
      await marcar(p, 'button[data-nota="2"]', 'costo');
      await clic(p, 'button[data-nota="2"]', 800);
      await espera(p, 1600);
    },
  },
];

// ------------------------------------------------------------------------------------------- Dojo
const PROGRESO = JSON.stringify({
  estacion: 'c01-datos',
  rondas: {
    guiado: { estado: 'hecha', inicio: '2026-11-17T10:05:12-06:00', fin: '2026-11-17T12:40:00-06:00' },
    solo: { estado: 'hecha', inicio: '2026-11-18T09:00:00-06:00', fin: '2026-11-18T10:20:00-06:00', pistas: 1 },
    romper_ayuda: { estado: 'en_curso', fallas: [{ id: 'feedback-loop', inicio: '2026-11-19T09:10:00-06:00', fin: '2026-11-19T09:34:00-06:00', minutos: 24, pistas: 0, rendido: false, aprendi: 'La sugerencia preseleccionada contaminaba los labels.' }] },
    romper_solo: { estado: 'pendiente', fallas: [] },
  },
  bitacora: [{ fecha: '2026-11-18T10:20:00-06:00', ronda: 'solo', paso: 'debil', hice: 'Rehice el pipeline sin ver el código.', medi: 'Acuerdo entre anotadores 0.81.', sigue: 'Romper con ayuda.' }],
  verificaciones: [{ fecha: '2026-11-18T10:18:00-06:00', pasan: ['mundo', 'senales'], fallan: [] }],
}, null, 1);

const DOJO = [
  {
    nombre: 'dojo-t-inicio', url: APPS.dojo + '/', init: oscuro('taller-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await marcar(p, 'h1', 'titulo', 12);
      await mover(p, 900, 380, 900);
      await espera(p, 2600);
      await arriba(p, '#como', 70, 1800);
      await espera(p, 300);
      await marcar(p, '#como', 'como', 0);
      await espera(p, 1500);
      await marcar(p, '#como .d-rondas, #como [class*="rondas"], #como article:nth-of-type(3)', 'rondas', 8);
      await espera(p, 2600);
      await arriba(p, '#entrenamientos', 70, 1800);
      await espera(p, 300);
      await marcar(p, '#entrenamiento-c01', 'c01', 8);
      await mover(p, (await centro(p, '#entrenamiento-c01')).x, (await centro(p, '#entrenamiento-c01')).y, 900);
      await espera(p, 1800);
      await clic(p, '#entrenamiento-c01 a:has-text("Entrar al entrenamiento")', 900);
      await p.waitForLoadState('load');
      await espera(p, 600);
    },
  },
  {
    nombre: 'dojo-t-mapa', url: APPS.dojo + '/c01/', init: oscuro('taller-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#mapa', 60, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '#mapa svg.d-metro', 'mapa', 0);
      for (const [i, id] of [[0, 'st1'], [5, 'st6'], [11, 'st12']]) {
        const s = `#mapa svg.d-metro a[data-st="${i}"]`;
        await mover(p, (await centro(p, s)).x, (await centro(p, s)).y, 1000);
        await marcar(p, s, id, 10);
        await espera(p, 1900);
      }
      await clic(p, '#mapa svg.d-metro a[data-st="0"]', 1000);
      await p.waitForLoadState('load');
      await espera(p, 800);
    },
  },
  {
    nombre: 'dojo-t-estacion', url: APPS.dojo + '/c01/datos/', init: oscuro('taller-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'h1', 'titulo', 12);
      await espera(p, 2400);
      await arriba(p, '#mapa', 70, 1700);
      await espera(p, 300);
      await marcar(p, '#mapa', 'donde', 0);
      await espera(p, 2600);
      await arriba(p, '#ruta', 70, 1700);
      await espera(p, 300);
      await marcar(p, '#ruta ol.d-camino', 'caminos', 8);
      for (let i = 1; i <= 3; i++) {
        const s = `#ruta ol.d-camino > li:nth-child(${i})`;
        await mover(p, (await centro(p, s)).x, (await centro(p, s)).y, 800);
        await espera(p, 1300);
      }
      await arriba(p, '#conceptos', 70, 1700);
      await espera(p, 300);
      await marcar(p, '#conceptos details.d-k > summary', 'concepto', 6);
      await clic(p, '#conceptos details.d-k > summary', 900);
      await espera(p, 3000);
    },
  },
  {
    nombre: 'dojo-t-kit', url: APPS.dojo + '/c01/datos/proyecto-con-kit/', init: oscuro('taller-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#arranque', 60, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '#arranque', 'arranque', 0);
      await espera(p, 1200);
      const kit = '#arranque a.d-btn[download]';
      await marcar(p, kit, 'kit', 8);
      await mover(p, (await centro(p, kit)).x, (await centro(p, kit)).y, 1000);
      await espera(p, 2400);
      const code = '#arranque .tm-code';
      await marcar(p, code, 'comandos', 6);
      await mover(p, (await centro(p, code)).x, (await centro(p, code)).y, 1000);
      await espera(p, 1400);
      await clic(p, '#arranque .tm-code__copy', 700);
      await espera(p, 2400);
    },
  },
  {
    nombre: 'dojo-t-rondas', url: APPS.dojo + '/c01/datos/proyecto-con-kit/', init: oscuro('taller-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#rondas', 60, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '#rondas .d-rondas', 'rejilla', 6);
      await mover(p, 800, 520, 900);
      await espera(p, 2800);
      const r1 = '#rondas .d-ronda:nth-of-type(1)';
      await marcar(p, `${r1} [data-tm-copiar]`, 'copiar', 6);
      await clic(p, `${r1} [data-tm-copiar]`, 900);
      await espera(p, 500);
      await marcar(p, '.d-toast', 'toast', 6).catch(() => {});
      await espera(p, 2000);
      await clic(p, `${r1} details.d-prompt > summary`, 800);
      await espera(p, 600);
      await marcar(p, `${r1} details.d-prompt`, 'prompt', 6);
      await espera(p, 3200);
    },
  },
  {
    nombre: 'dojo-t-guiado', url: APPS.dojo + '/c01/datos/proyecto-con-kit/', init: oscuro('taller-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#guiado', 60, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '#guiado details.d-paso[open]', 'paso1', 4);
      await espera(p, 2600);
      await desplazar(p, (await p.evaluate(() => scrollY)) + 650, 2200);
      await espera(p, 1600);
      await arriba(p, '#solo', 60, 2000);
      await espera(p, 300);
      await marcar(p, '#solo .d-obj', 'objetivos', 6);
      await mover(p, 800, 500, 900);
      await espera(p, 3200);
    },
  },
  {
    nombre: 'dojo-t-romper', url: APPS.dojo + '/c01/datos/proyecto-con-kit/', init: oscuro('taller-tema'), contexto: sinSW,
    async preparar(p) { await arriba(p, '#romper', 60, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '#romper pre', 'comandos', 6);
      await mover(p, (await centro(p, '#romper pre')).x, (await centro(p, '#romper pre')).y, 1000);
      await espera(p, 3200);
      const cat = '#romper details.d-catalogo > summary';
      await arriba(p, cat, 200, 1400);
      await marcar(p, cat, 'catalogo', 6);
      await clic(p, cat, 900);
      await espera(p, 900);
      await marcar(p, '#romper .d-falla', 'falla', 6);
      await espera(p, 3000);
    },
  },
  {
    nombre: 'dojo-t-tablero', url: APPS.dojo + '/tablero/', init: oscuro('taller-tema'), contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await marcar(p, '#t-stats', 'stats', 8);
      await espera(p, 2200);
      await arriba(p, '#importar', 60, 1800);
      await espera(p, 300);
      await marcar(p, '#t-pegado', 'pegado', 6);
      await clic(p, '#t-pegado', 800);
      // pegar el progreso.json del kit (como si viniera del portapapeles), con un poco de tecleo al final
      await p.locator('#t-pegado').fill(PROGRESO.slice(0, -1));
      await p.keyboard.type('}', { delay: 120 });
      await espera(p, 1500);
      await marcar(p, '#t-importar-pegado', 'importar', 6);
      await clic(p, '#t-importar-pegado', 900);
      await espera(p, 800);
      await marcar(p, '#t-res', 'res', 6);
      await espera(p, 2600);
      await arriba(p, '#estaciones', 40, 2000);
      await espera(p, 400);
      await marcar(p, '#t-estaciones', 'estaciones', 0);
      await espera(p, 1200);
      const s = '#t-estaciones button[data-ronda="romper-con-ayuda"][data-valor="hecha"]';
      await marcar(p, s, 'hecha', 6).catch(() => {});
      await clic(p, s, 1000).catch(() => {});
      await espera(p, 2400);
    },
  },
];

// ------------------------------------------------------------------------------------------- Tablero
const TAB = APPS.tablero;
const TABLERO = [
  {
    nombre: 'tab-proyecto', url: TAB + '/#/', init: oscuro('tml:theme'), contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await marcar(p, 'a.pcard[href="#/p/sample"]', 'tarjeta', 8);
      await mover(p, (await centro(p, 'a.pcard[href="#/p/sample"]')).x, (await centro(p, 'a.pcard[href="#/p/sample"]')).y, 1000);
      await espera(p, 2400);
      await clic(p, 'a.pcard[href="#/p/sample"]', 500);
      await p.waitForSelector('section.resume');
      await espera(p, 700);
      await momento(p, 'abre');
      await marcar(p, 'section.resume', 'estado', 6);
      await espera(p, 1200);
      await mover(p, 520, 400, 900);
      await espera(p, 1600);
      await mover(p, 560, 480, 800);
      await espera(p, 1600);
      await marcar(p, 'section.resume .stat, section.resume [class*="stat"]', 'stats', 6).catch(() => {});
      await mover(p, 1130, 360, 900);
      await espera(p, 2200);
    },
  },
  {
    // una sola toma larga: el mapa, abrir Serving, la puerta de entrada, marcarlo hecho y volver al mapa con ✓
    nombre: 'tab-mapa', url: TAB + '/#/p/sample', init: oscuro('tml:theme'), contexto: sinSW,
    async preparar(p) { await p.waitForSelector('section.map'); await arriba(p, 'section.map', 20, 10); await espera(p, 800); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, 'section.map', 'mapa', 0);
      await espera(p, 1200);
      for (const [i, id] of [[0, 'st1'], [6, 'st7'], [7, 'st8']]) {
        const s = `a.st[data-i="${i}"]`;
        await mover(p, (await centro(p, s)).x, (await centro(p, s)).y, 1000);
        await marcar(p, s, id, 6);
        await espera(p, 2000);
      }
      await marcar(p, '.map__t', 'te', 6).catch(() => {});
      // abrir la estación siguiente (Serving Code)
      await clic(p, 'a.st[data-i="6"]', 700);
      await p.waitForSelector('section.gate');
      await espera(p, 900);
      await momento(p, 'paso');
      await marcar(p, 'header.shead', 'cabeza', 8);
      await mover(p, 700, 250, 900);
      await espera(p, 1600);
      const hecho = '.seg button[data-act=step-status][data-v=hecho]';
      await marcar(p, hecho, 'hecho', 6);
      await clic(p, hecho, 900);
      await espera(p, 500);
      await marcar(p, '#toast', 'toast', 6).catch(() => {});
      await espera(p, 2600);
      // la puerta de entrada: las dos cuentas abiertas
      // etiqueta las dos cuentas abiertas (querySelector no entiende :has-text)
      // (la página se vuelve a pintar tras cada respuesta: hay que volver a etiquetar antes de cada uso)
      const tag = () => p.evaluate(() => document.querySelectorAll('li.calc').forEach((l) => {
        if (l.innerText.includes('in flight at design')) l.dataset.toma = 'c1';
        if (l.innerText.includes('inside Triton')) l.dataset.toma = 'c2';
      }));
      await tag();
      const c1 = 'li.calc[data-toma="c1"]', c2 = 'li.calc[data-toma="c2"]';
      await tag();
      await arriba(p, c1, 200, 1800);
      await espera(p, 300);
      await momento(p, 'puerta');
      await tag();
      await marcar(p, c1, 'calc1', 4);
      await espera(p, 1400);
      await tag();
      await marcar(p, `${c1} [data-act=fx]`, 'formula', 6);
      await tag();
      await clic(p, `${c1} [data-act=fx]`, 800);
      await espera(p, 2600);
      await tag();
      await marcar(p, `${c1} input[data-calc]`, 'resp1', 6);
      await tag();
      await teclear(p, `${c1} input[data-calc]`, '50', 160);
      await p.keyboard.press('Enter');
      await espera(p, 1200);
      await tag();
      await marcar(p, c1, 'mal', 4);
      await espera(p, 1800);
      await tag();
      await p.locator(`${c1} input[data-calc]`).click({ clickCount: 3 });
      await p.keyboard.type('5', { delay: 160 });
      await p.keyboard.press('Enter');
      await espera(p, 1200);
      await tag();
      await marcar(p, c1, 'bien', 4);
      await espera(p, 1800);
      await tag();
      await llevar(p, c2, 260, 1200);
      await espera(p, 300);
      await tag();
      await marcar(p, `${c2} input[data-calc]`, 'resp2', 6);
      await tag();
      await teclear(p, `${c2} input[data-calc]`, '0.4', 160);
      await p.keyboard.press('Enter');
      await espera(p, 1200);
      await arriba(p, 'section.gate', 120, 1500);
      await espera(p, 300);
      await marcar(p, 'section.gate h2, section.gate h3', 'abierta', 10);
      await espera(p, 2200);
      // ahora sí: hecho
      await arriba(p, '.seg', 260, 1500);
      await espera(p, 300);
      await momento(p, 'cerrar');
      await marcar(p, hecho, 'hecho2', 6);
      await clic(p, hecho, 900);
      await espera(p, 2200);
      // de vuelta al mapa
      await p.goto(TAB + '/#/p/sample');
      await p.waitForSelector('section.map');
      await arriba(p, 'section.map', 20, 10);
      await espera(p, 600);
      await momento(p, 'vuelta');
      await mover(p, (await centro(p, 'a.st[data-i="6"]')).x, (await centro(p, 'a.st[data-i="6"]')).y, 1000);
      await marcar(p, 'a.st[data-i="6"]', 'st7b', 6);
      await espera(p, 2400);
      await marcar(p, '.map__head', 'cuenta', 6);
      await espera(p, 2200);
    },
  },
  {
    nombre: 'tab-registro', url: TAB + '/#/p/sample', init: oscuro('tml:theme'), contexto: sinSW,
    async preparar(p) { await p.waitForSelector('section.resume'); },
    async accion(p) {
      await espera(p, 500);
      await marcar(p, '[data-act=session-new]', 'boton', 6);
      await clic(p, '[data-act=session-new]', 900);
      await p.waitForSelector('dialog[open]');
      await espera(p, 700);
      await marcar(p, 'dialog[open] form', 'dialogo', 4);
      const campo = async (n, t) => { const loc = p.locator('dialog[open] textarea').nth(n); const r = await loc.boundingBox(); await mover(p, r.x + 60, r.y + r.height / 2, 600); await loc.click(); await p.keyboard.type(t, { delay: 45 }); await espera(p, 500); };
      await campo(0, 'Serving Code: answered the entry gate and closed the step.');
      await campo(1, 'In-flight requests at design QPS: 5.');
      await campo(2, 'Packaging (Docker) once registry access lands.');
      await espera(p, 600);
      const guardar = 'dialog[open] button[data-i="1"]';
      await clic(p, guardar, 900);
      await espera(p, 1200);
      await clic(p, 'nav.tabs a:has-text("Work log"), nav.tabs button:has-text("Work log")', 900);
      await espera(p, 900);
      await marcar(p, 'main article, main .card', 'entrada', 6).catch(() => {});
      await espera(p, 2600);
      // el brief para Claude Code
      await momento(p, 'brief');
      await clic(p, '[data-act=summary]', 900);
      await p.waitForSelector('dialog[open]');
      await espera(p, 600);
      await marcar(p, 'dialog[open]', 'brief', 0);
      await mover(p, 800, 480, 900);
      await espera(p, 3200);
      await clic(p, 'dialog[open] [data-close]', 800);
      await espera(p, 600);
      await clic(p, 'nav.tabs a:has-text("Settings"), nav.tabs button:has-text("Settings")', 900);
      await espera(p, 800);
      const cc = 'section:has-text("Claude Code"), .card:has-text("Claude Code")';
      await p.evaluate(() => { const e = [...document.querySelectorAll('pre, code')].find((x) => x.textContent.includes('api/claude')); if (e) e.dataset.toma = 'curl'; });
      await arriba(p, '[data-toma="curl"]', 260, 1600);
      await espera(p, 300);
      await momento(p, 'claude');
      await marcar(p, '[data-toma="curl"]', 'curl', 8);
      await espera(p, 3400);
    },
  },
  {
    nombre: 'tab-nuevo', url: TAB + '/#/new', init: oscuro('tml:theme'), contexto: sinSW,
    async preparar(p) { await p.waitForSelector('button.pat'); },
    async accion(p) {
      await espera(p, 500);
      await teclear(p, 'input[name=name]', 'Fraud scoring API', 70);
      await espera(p, 600);
      await arriba(p, 'button.pat', 150, 1400);
      await espera(p, 300);
      await marcar(p, 'button.pat[data-v="sincrono"]', 'patrones', 6);
      for (const v of ['llm', 'streaming', 'edge', 'sincrono']) {
        await clic(p, `button.pat[data-v="${v}"]`, 800);
        await espera(p, 600);
        if (v === 'llm') await marcar(p, 'ol.patline', 'linea', 6);
        await espera(p, 900);
      }
      await espera(p, 1200);
    },
  },
];

// ------------------------------------------------------------------------------------------- Muestras
// (el Laboratorio Transformer y el Atlas usan las tomas de tools/tomas.mjs)
const MUESTRAS = [
  {
    nombre: 'm-ronda', url: APPS.ronda + '/#practica-c01', init: LIMPIO, contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await clic(p, 'button:has-text("Empezar")', 1000);
      await espera(p, 1200);
      await marcar(p, 'blockquote, [class*="dice"]', 'dice', 8).catch(() => {});
      await espera(p, 2400);
      await marcar(p, '.clock', 'reloj', 6);
      await mover(p, (await centro(p, '.clock')).x, (await centro(p, '.clock')).y, 900);
      await espera(p, 2000);
      await marcar(p, 'button:has-text("Insertar esqueleto")', 'esqueleto', 6);
      await clic(p, 'button:has-text("Insertar esqueleto")', 900);
      await espera(p, 1400);
      await marcar(p, 'textarea', 'diseno', 4);
      await espera(p, 2600);
      await desplazar(p, 300, 1400);
      await espera(p, 400);
      await marcar(p, 'text=Framework', 'pasos', 6).catch(() => {});
      await mover(p, 1310, 520, 900);
      await espera(p, 2600);
    },
  },
  {
    nombre: 'm-hojas', url: APPS.hojas + '/', init: LIMPIO, contexto: sinSW,
    async accion(p) {
      await espera(p, 600);
      await mover(p, 900, 420, 900);
      await espera(p, 1500);
      await desplazar(p, 650, 2200);
      await espera(p, 1800);
      await desplazar(p, 1300, 2200);
      await espera(p, 1800);
    },
  },
];

export const TUTORIALES = [...SENSEI, ...DOJO, ...TABLERO, ...MUESTRAS];
