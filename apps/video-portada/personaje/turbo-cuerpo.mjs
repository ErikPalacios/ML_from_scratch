// Turbo de cuerpo entero, de frente y parado. Genera personaje/turbo-cuerpo.svg.
// turboCuerpo() devuelve solo al personaje (sin fondo) para usarlo en cualquier escena: mide 1080×900,
// centrado en x=540, con los pies en y≈815. Cada parte que se anima tiene su id.
// Uso: node personaje/turbo-cuerpo.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { C, cabeza, pecho, defsTurbo } from './turbo.mjs';

// Un brazo: manga gruesa con borde oscuro, puño y patita rosa. lado = -1 (izquierda) o 1 (derecha).
export function brazo(lado, id) {
  const x = (v) => 540 + lado * (540 - v); // refleja desde el lado izquierdo
  const manga = `M${x(408)} 494 Q${x(330)} 540 ${x(334)} 620`;
  return `<g id="${id}">
    <path d="${manga}" stroke="${C.sudaderaOsc}" stroke-width="72" fill="none" stroke-linecap="round"/>
    <path d="${manga}" stroke="${C.sudadera}" stroke-width="62" fill="none" stroke-linecap="round"/>
    <path d="M${x(366)} 516 Q${x(344)} 556 ${x(346)} 598" stroke="${C.sudaderaClara}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="${x(334)}" cy="636" rx="33" ry="13" fill="${C.sudaderaClara}"/>
    <g fill="${C.rosaPata}" stroke="#E08C96" stroke-width="2">
      <ellipse cx="${x(335)}" cy="660" rx="25" ry="22"/>
      <path d="M${x(326)} 668 L${x(326)} 678 M${x(342)} 668 L${x(342)} 678" fill="none"/>
    </g>
  </g>`;
}

export function pie(cx, id) {
  return `<g id="${id}">
    <ellipse cx="${cx}" cy="772" rx="42" ry="34" fill="${C.pelo}"/>
    <g fill="${C.rosaPata}" stroke="#E08C96" stroke-width="2">
      <ellipse cx="${cx}" cy="800" rx="44" ry="16"/>
      <path d="M${cx - 16} 792 L${cx - 16} 804 M${cx} 790 L${cx} 805 M${cx + 16} 792 L${cx + 16} 804" fill="none"/>
    </g>
  </g>`;
}

export const turboCuerpo = () => `<g id="turbo">
  <ellipse id="sombra" cx="540" cy="816" rx="210" ry="20" fill="#000" opacity=".3"/>
  ${pie(468, 'pieIzq')}
  ${pie(612, 'pieDer')}
  <g id="cuerpo">
    <ellipse cx="540" cy="680" rx="168" ry="108" fill="${C.pelo}"/>
    <ellipse cx="540" cy="700" rx="114" ry="80" fill="${C.crema}"/>
    <ellipse cx="540" cy="478" rx="196" ry="62" fill="${C.sudaderaOsc}"/>
    <path d="M380 640 Q362 520 410 472 Q540 444 670 472 Q718 520 700 640 Q694 664 668 664 L640 654 L440 654 L412 664 Q386 664 380 640 Z" fill="${C.sudadera}"/>
    <path d="M386 652 Q396 666 414 662 L440 654 M694 652 Q684 666 666 662 L640 654" stroke="${C.sudaderaClara}" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M442 606 Q540 622 640 606 L641 660 L441 660 Z" fill="${C.crema}"/>
    <ellipse cx="540" cy="660" rx="7" ry="4" fill="#D9A27A"/>
    ${pecho()}
  </g>
  ${brazo(-1, 'brazoIzq')}
  ${brazo(1, 'brazoDer')}
  ${cabeza()}
</g>`;

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
