// Turbo de espaldas, parado. Genera personaje/turbo-espalda.svg y personaje/turbo-hoja.svg (frente + espalda).
// turboEspalda() usa el mismo marco que turboCuerpo(): 1080×900, centrado en x=540, pies en y≈815.
// Uso: node personaje/turbo-espalda.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { C, defsTurbo } from './turbo.mjs';
import { brazo, turboCuerpo } from './turbo-cuerpo.mjs';

// Pie visto por detrás: la pierna y solo el talón rosa.
const talon = (cx, id) => `<g id="${id}">
    <ellipse cx="${cx}" cy="772" rx="42" ry="34" fill="${C.pelo}"/>
    <ellipse cx="${cx}" cy="803" rx="36" ry="11" fill="${C.rosaPata}" stroke="#E08C96" stroke-width="2"/>
    <ellipse cx="${cx}" cy="790" rx="40" ry="16" fill="${C.pelo}"/>
  </g>`;

const nuca = () => `<g id="cabeza">
    <g id="cachetes">
      <ellipse cx="444" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <ellipse cx="636" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <path d="M368 400 l-10 8 l12 2 l-8 10 l13 -1 M712 400 l10 8 l-12 2 l8 10 l-13 -1" stroke="${C.crema}" stroke-width="7" fill="none" stroke-linejoin="round"/>
    </g>
    <g id="orejas">
      <ellipse cx="398" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(-18 398 196)"/>
      <ellipse cx="682" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(18 682 196)"/>
    </g>
    <ellipse cx="540" cy="318" rx="172" ry="142" fill="${C.pelo}"/>
    <ellipse cx="540" cy="300" rx="110" ry="96" fill="${C.peloOsc}" opacity=".18"/>
    <path d="M516 222 Q522 198 534 212 Q540 190 552 210 Q562 196 566 222 Q541 230 516 222 Z" fill="${C.peloOsc}"/>
    <g id="audifonos">
      <path d="M368 322 Q362 168 540 158 Q718 168 712 322" stroke="${C.aud}" stroke-width="20" fill="none" stroke-linecap="round"/>
      <path d="M380 300 Q378 182 540 172 Q702 182 700 300" stroke="${C.audClaro}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
      <rect x="340" y="280" width="54" height="98" rx="26" fill="${C.aud}"/><rect x="348" y="300" width="18" height="58" rx="9" fill="${C.audClaro}" opacity=".5"/>
      <rect x="686" y="280" width="54" height="98" rx="26" fill="${C.aud}"/><rect x="714" y="300" width="18" height="58" rx="9" fill="${C.audClaro}" opacity=".5"/>
      <path d="M356 352 Q352 380 362 396" stroke="${C.aud}" stroke-width="6" fill="none" stroke-linecap="round"/>
    </g>
  </g>`;

export const turboEspalda = () => `<g id="turboEspalda">
  <ellipse id="sombra" cx="540" cy="816" rx="210" ry="20" fill="#000" opacity=".3"/>
  ${talon(468, 'pieIzq')}
  ${talon(612, 'pieDer')}
  <g id="cuerpo">
    <ellipse cx="540" cy="680" rx="168" ry="108" fill="${C.pelo}"/>
    <g id="nalgas">
      <ellipse cx="482" cy="720" rx="76" ry="66" fill="${C.pelo}"/>
      <ellipse cx="598" cy="720" rx="76" ry="66" fill="${C.pelo}"/>
      <path d="M408 708 Q410 784 482 786 Q526 787 540 762 Q554 787 598 786 Q670 784 672 708" stroke="${C.peloOsc}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M540 692 Q546 728 540 762" stroke="${C.peloOsc}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <ellipse cx="466" cy="704" rx="24" ry="14" fill="${C.peloClaro}" opacity=".8" transform="rotate(-20 466 704)"/>
      <ellipse cx="614" cy="704" rx="24" ry="14" fill="${C.peloClaro}" opacity=".8" transform="rotate(20 614 704)"/>
    </g>
    <circle id="colita" cx="540" cy="678" r="13" fill="${C.peloClaro}" stroke="${C.peloOsc}" stroke-width="2"/>
    <path d="M380 640 Q362 520 410 472 Q540 444 670 472 Q718 520 700 640 Q694 664 668 664 L412 664 Q386 664 380 640 Z" fill="${C.sudadera}"/>
    <path d="M392 654 Q540 674 688 654" stroke="${C.sudaderaClara}" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M540 600 L540 650" stroke="${C.sudaderaOsc}" stroke-width="3" opacity=".6"/>
    <g id="capucha">
      <path d="M418 468 Q540 446 662 468 Q676 560 540 600 Q404 560 418 468 Z" fill="${C.sudaderaOsc}"/>
      <path d="M432 476 Q540 458 648 476 Q656 548 540 580 Q424 548 432 476 Z" fill="none" stroke="${C.sudaderaClara}" stroke-width="6" opacity=".8"/>
    </g>
  </g>
  ${brazo(-1, 'brazoIzq')}
  ${brazo(1, 'brazoDer')}
  ${nuca()}
</g>`;

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
