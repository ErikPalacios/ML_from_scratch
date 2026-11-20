// Turbo de espaldas, parado. Genera personaje/turbo-espalda.svg y personaje/turbo-hoja.svg (frente + espalda).
// turboEspalda() usa el mismo marco que turboCuerpo(): 1080×900, centrado en x=540, pies en y≈815.
// Uso: node personaje/turbo-espalda.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { C, defsTurbo, turboCuerpo, turboEspalda } from './turbo.mjs';

const marco = (ancho, contenido, extraDefs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} 900" width="${ancho}" height="900">
<defs>
  ${defsTurbo}
  <radialGradient id="foco" cx="540" cy="430" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2A3A8A" stop-opacity=".55"/><stop offset="1" stop-color="#2A3A8A" stop-opacity="0"/></radialGradient>
  ${extraDefs}
</defs>
<rect width="${ancho}" height="900" fill="${C.fondo}"/>
${contenido}
</svg>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const aqui = (f) => fileURLToPath(new URL(f, import.meta.url));
  writeFileSync(aqui('./turbo-espalda.svg'), marco(1080, `<rect width="1080" height="900" fill="url(#foco)"/>${turboEspalda()}`));
  const hoja = `<rect width="1080" height="900" fill="url(#foco)"/>
  <g transform="translate(-60 0)">${turboCuerpo()}</g>
  <g transform="translate(960 0)"><rect width="1080" height="900" fill="url(#foco)"/></g>
  <g transform="translate(900 0)">${turboEspalda()}</g>`;
  writeFileSync(aqui('./turbo-hoja.svg'), marco(1920, hoja));
  console.log('listo: turbo-espalda.svg y turbo-hoja.svg');
}
