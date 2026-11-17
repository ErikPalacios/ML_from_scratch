// Las tomas del video: qué página se abre y qué se hace mientras se graba (en tiempo real).
// El montaje (src/) decide qué tramo de cada toma se usa y a qué velocidad.
import { APPS } from './apps.mjs';
import { clic, mover, desplazar, llevar, centro, arrastrar } from './grabador.mjs';

const espera = (p, ms) => p.waitForTimeout(ms);
const quitarGuia = (p) => p.locator('button:has-text("×"), [aria-label*="Cerrar"]').first().click({ timeout: 2000 }).catch(() => {});

export const TOMAS = [
  {
    nombre: 'portada',
    url: APPS.portada,
    async accion(p) {
      await mover(p, 1150, 520, 900);
      await espera(p, 1500);
      await mover(p, 1220, 380, 900);
      await espera(p, 1200);
      await desplazar(p, 900, 1800);
      await espera(p, 1500);
    },
  },
  {
    nombre: 'transformer',
    url: APPS.transformer + '/#paso',
    async preparar(p) { await quitarGuia(p); await p.locator('#tl-speed [data-speed="2"]').click().catch(() => {}); },
    async accion(p) {
      await espera(p, 400);
      await clic(p, '#tl-play', 900);
      await mover(p, 1000, 500, 900);
      await espera(p, 11000);
    },
  },
  {
    nombre: 'transformer-entrena',
    url: APPS.transformer + '/#entrenamiento',
    async preparar(p) { await quitarGuia(p); },
    async accion(p) {
      await espera(p, 500);
      await clic(p, 'button:has-text("+100")', 900);
      await espera(p, 2500);
      await clic(p, 'button:has-text("+100")', 500);
      await espera(p, 2500);
      await clic(p, 'button:has-text("+100")', 500);
      await espera(p, 2500);
    },
  },
  {
    nombre: 'atlas-diagrama',
    url: APPS.atlas + '/#vit',
    async preparar(p) { await llevar(p, 'figure.b-diagram', 20, 10); await espera(p, 600); },
    async accion(p) {
      // recorre los bloques del diagrama con el cursor (cada uno muestra su forma y sus parámetros)
      const r = await p.locator('figure.b-diagram svg').first().boundingBox();
      const en = (fx, fy, ms = 800) => mover(p, r.x + r.width * fx, r.y + r.height * fy, ms);
      await espera(p, 400);
      for (const [fx, fy] of [[0.5, 0.1], [0.5, 0.2], [0.5, 0.29], [0.35, 0.38], [0.5, 0.52], [0.5, 0.62]]) { await en(fx, fy); await espera(p, 1000); }
      await espera(p, 600);
    },
  },
  {
    nombre: 'atlas-parches',
    url: APPS.atlas + '/#vit',
    async preparar(p) { await llevar(p, 'figure.b-viz', 40, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 500);
      for (const b of ['P = 8', '512×512', 'P = 32', '224×224', 'P = 16']) { await clic(p, `figure.b-viz button.viz-chip:has-text("${b}")`, 600); await espera(p, 1100); }
      await espera(p, 600);
    },
  },
  {
    nombre: 'sensei-tokens',
    url: APPS.sensei + '/llms/',
    async preparar(p) { await llevar(p, '#fig-llms-tokens', 30, 10); await espera(p, 600); },
    async accion(p) {
      await mover(p, 820, 300, 900);
      await espera(p, 1200);
      await desplazar(p, (await p.evaluate(() => scrollY)) + 380, 2200);
      await espera(p, 1500);
    },
  },
  {
    nombre: 'sensei-calc',
    url: APPS.sensei + '/llms/',
    async preparar(p) {
      const y = await p.locator('input[type=range]').first().evaluate((i) => i.getBoundingClientRect().top + scrollY);
      await desplazar(p, y - 330, 10); await espera(p, 600);
    },
    async accion(p) {
      const r = p.locator('input[type=range]');
      await espera(p, 400);
      await arrastrar(p, r.nth(1), 1500, 1600);
      await espera(p, 700);
      await arrastrar(p, r.nth(4), 80, 1300);
      await espera(p, 700);
      await arrastrar(p, r.nth(0), 6500, 1200);
      await espera(p, 1500);
    },
  },
  {
    nombre: 'sensei-glosario',
    url: APPS.sensei + '/llms/',
    async preparar(p) { await llevar(p, 'a.g[data-g="ttft"]', 360, 10); await espera(p, 600); },
    async accion(p) {
      await espera(p, 400);
      await clic(p, 'a.g[data-g="ttft"]', 1000);
      await espera(p, 3500);
    },
  },
  {
    nombre: 'sensei-inicio',
    url: APPS.sensei,
    async accion(p) {
      await mover(p, 1100, 380, 900);
      await espera(p, 1200);
      await desplazar(p, 600, 2000);
      await espera(p, 1500);
    },
  },
  {
    nombre: 'dojo-inicio',
    url: APPS.dojo,
    async accion(p) {
      await mover(p, 1350, 420, 900);
      await espera(p, 1500);
      await llevar(p, '#mapa', 0, 2200);
      await espera(p, 600);
      await desplazar(p, (await p.evaluate(() => scrollY)) + 420, 1800);
      await espera(p, 2000);
    },
  },
  {
    nombre: 'dojo-estacion',
    url: APPS.dojo + '/c01/datos/',
    async accion(p) {
      await mover(p, 700, 500, 900);
      await espera(p, 1200);
      await desplazar(p, 1300, 2600);
      await espera(p, 1800);
    },
  },
  {
    nombre: 'ronda',
    url: APPS.ronda + '/#practica-c01',
    async accion(p) {
      await espera(p, 600);
      await clic(p, 'button:has-text("Empezar")', 1000);
      await espera(p, 4500);
    },
  },
  {
    nombre: 'hojas',
    url: APPS.hojas + '/docker/',
    async accion(p) {
      await espera(p, 600);
      await desplazar(p, 900, 1600);
      await espera(p, 800);
      await desplazar(p, 2400, 2000);
      await espera(p, 1500);
    },
  },
  {
    nombre: 'tablero',
    url: APPS.tablero + '/#/p/sample',
    async accion(p) {
      await espera(p, 600);
      await desplazar(p, 600, 2000);
      await mover(p, 800, 600, 900);
      await espera(p, 2500);
    },
  },
];
