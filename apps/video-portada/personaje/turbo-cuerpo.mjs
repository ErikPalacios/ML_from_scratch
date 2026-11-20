// Turbo de cuerpo entero, de frente y parado. Genera personaje/turbo-cuerpo.svg.
// turboCuerpo() devuelve solo al personaje (sin fondo) para usarlo en cualquier escena: mide 1080×900,
// centrado en x=540, con los pies en y≈815. Cada parte que se anima tiene su id.
// Uso: node personaje/turbo-cuerpo.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { C, defsTurbo, turboCuerpo } from './turbo.mjs';
export { turboCuerpo };

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 900" width="1080" height="900">
<defs>
  ${defsTurbo}
  <radialGradient id="foco" cx="540" cy="430" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2A3A8A" stop-opacity=".55"/><stop offset="1" stop-color="#2A3A8A" stop-opacity="0"/></radialGradient>
</defs>
<rect width="1080" height="900" fill="${C.fondo}"/>
<rect width="1080" height="900" fill="url(#foco)"/>
${turboCuerpo()}
</svg>`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const salida = fileURLToPath(new URL('./turbo-cuerpo.svg', import.meta.url));
  writeFileSync(salida, svg);
  console.log('listo:', salida);
}
