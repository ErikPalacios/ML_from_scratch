// Genera personaje/hamster-2d.svg: el hámster programador en 2D, por capas con id para poder animarlo.
// Uso: node personaje/hamster-2d.mjs   (y luego node personaje/foto-svg.mjs para el PNG)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const C = {
  fondo: '#0B1026', panel: '#121A36', borde: '#1E2A55', cian: '#2BD4F0',
  pelo: '#D98A45', peloOsc: '#B96A2E', peloClaro: '#EBA866', crema: '#FBE3C4', cremaSombra: '#EFCDA6',
  rosa: '#F2A3A8', rosaPata: '#F4B6BC', nariz: '#E9808E', boca: '#6B3A22',
  aud: '#6B7FE0', audClaro: '#93A4FF', audOsc: '#3B4A9E',
  sudadera: '#222C52', sudaderaOsc: '#18203F', sudaderaClara: '#2E3A6A', camiseta: '#0B0F1F', cordon: '#C8CEE6',
  T: { azul: '#4A63E8', morado: '#7A69EE', gris: '#5A6699', verde: '#17B386', naranja: '#EC6A3F', amarillo: '#E8AE36' },
  silla: '#3E2752', rueda: '#2A3360', escritorio: '#161D3D', lata: '#2BB673', pato: '#FFC83D', patoOsc: '#F0B42A', pico: '#F07A2A',
};

// Pseudoaleatorio fijo para que el código de los monitores salga igual siempre.
let semilla = 7;
const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);

function codigo(x0, y0, ancho, filas) {
  const colores = ['#2B3C70', '#2A6E7A', '#4D3F86', '#2B3C70', '#6A5A2E'];
  let s = '';
  for (let i = 0; i < filas; i++) {
    let x = x0 + (i % 4 === 0 ? 0 : 20 + Math.floor(azar() * 3) * 18);
    const y = y0 + i * 22;
    const trozos = 1 + Math.floor(azar() * 3);
    for (let j = 0; j < trozos && x < x0 + ancho - 30; j++) {
      const w = Math.min(30 + Math.floor(azar() * 110), x0 + ancho - x - 10);
      s += `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="${colores[Math.floor(azar() * colores.length)]}"/>`;
      x += w + 10;
    }
  }
  return s;
}

function teclado() {
  let s = `<polygon points="300,650 820,650 806,712 314,712" fill="#1A2244" stroke="${C.cian}" stroke-opacity=".45" stroke-width="2"/>`;
  for (let f = 0; f < 4; f++) {
    const y = 657 + f * 13.5, xi = 312 + f * 3.5, xf = 808 - f * 3.5;
    for (let x = xi; x < xf - 18; x += 25) s += `<rect x="${x.toFixed(1)}" y="${y}" width="21" height="9" rx="2" fill="url(#teclas)"/>`;
  }
  return s;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1300 820" width="1300" height="820">
<defs>
  <radialGradient id="brilloCian" cx="330" cy="330" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.cian}" stop-opacity=".28"/><stop offset="1" stop-color="${C.cian}" stop-opacity="0"/></radialGradient>
  <radialGradient id="brilloMorado" cx="1020" cy="260" r="460" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7A3FB0" stop-opacity=".35"/><stop offset="1" stop-color="#7A3FB0" stop-opacity="0"/></radialGradient>
  <linearGradient id="teclas" x1="300" x2="820" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3FE0F5"/><stop offset=".6" stop-color="#7FA0FF"/><stop offset="1" stop-color="#B27BFF"/></linearGradient>
  <linearGradient id="lataBrillo" x1="0" x2="1"><stop offset="0" stop-color="#1E9A5E"/><stop offset=".35" stop-color="#3FD08A"/><stop offset="1" stop-color="#178A52"/></linearGradient>
  <radialGradient id="mejilla" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#F48B9A" stop-opacity=".85"/><stop offset="1" stop-color="#F48B9A" stop-opacity="0"/></radialGradient>
  <linearGradient id="sombraCuerpo" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
</defs>

<g id="fondo">
  <rect width="1300" height="820" fill="${C.fondo}"/>
  <rect width="1300" height="820" fill="url(#brilloMorado)"/>
  <rect x="150" y="-12" width="420" height="330" rx="10" fill="${C.panel}" stroke="${C.borde}" stroke-width="3"/>
  ${codigo(185, 12, 360, 13)}
  <rect x="680" y="-12" width="500" height="282" rx="10" fill="${C.panel}" stroke="${C.borde}" stroke-width="3"/>
  ${codigo(715, 12, 440, 11)}
  <rect width="1300" height="820" fill="url(#brilloCian)"/>
  <path d="M0 40 Q120 120 60 260" stroke="#1A2246" stroke-width="5" fill="none"/>
  <path d="M1180 60 Q1260 140 1300 120" stroke="#1A2246" stroke-width="5" fill="none"/>
</g>

<g id="rueda">
  <path d="M1095 425 L1035 648 M1095 425 L1155 648" stroke="${C.rueda}" stroke-width="10" stroke-linecap="round"/>
  <circle cx="1095" cy="425" r="130" fill="#10173A" stroke="${C.rueda}" stroke-width="12"/>
  <circle cx="1095" cy="425" r="114" fill="none" stroke="#1E264A" stroke-width="4" stroke-dasharray="6 9"/>
  <circle cx="1095" cy="425" r="60" fill="none" stroke="#1E264A" stroke-width="3"/>
  <path d="M1095 297 L1095 553 M967 425 L1223 425" stroke="#1E264A" stroke-width="4"/>
  <circle cx="1095" cy="425" r="13" fill="${C.rueda}"/>
</g>

<g id="aparato">
  <rect x="1212" y="518" width="70" height="44" rx="8" fill="#151C3A" stroke="${C.borde}" stroke-width="2"/>
  <circle cx="1234" cy="538" r="7" fill="#B57BFF"/><circle cx="1258" cy="538" r="7" fill="#B57BFF"/>
  <path d="M1246 562 Q1240 640 1180 690 Q1120 740 1150 820" stroke="#1A2246" stroke-width="6" fill="none"/>
  <path d="M1270 562 Q1275 660 1300 700" stroke="#1A2246" stroke-width="6" fill="none"/>
</g>

<g id="silla"><path d="M690 262 Q700 236 760 238 L838 246 Q862 252 860 284 L852 600 L700 600 Z" fill="${C.silla}"/><path d="M845 260 Q858 270 856 290 L850 590" stroke="#553672" stroke-width="6" fill="none"/></g>

<g id="monitorFrente">
  <rect x="-20" y="268" width="302" height="336" rx="12" fill="#141B39" stroke="${C.borde}" stroke-width="3"/>
  <path d="M283 290 L283 584" stroke="${C.cian}" stroke-opacity=".65" stroke-width="4" stroke-linecap="round"/>
  <rect x="80" y="604" width="90" height="40" fill="#11173A"/>
</g>

<g id="hamster">
  <g id="cuerpo">
    <ellipse cx="540" cy="478" rx="196" ry="62" fill="${C.sudaderaOsc}"/>
    <path d="M346 645 Q330 520 400 470 Q540 440 680 470 Q750 520 736 645 Z" fill="${C.sudadera}"/>
    <path d="M444 468 Q540 452 636 468 L641 612 Q540 624 440 612 Z" fill="${C.camiseta}"/>
    <path d="M442 606 Q540 622 640 606 L642 648 L440 648 Z" fill="${C.crema}"/>
    <ellipse cx="540" cy="632" rx="6" ry="3.5" fill="#D9A27A"/>
    <path d="M440 466 Q428 560 438 648" stroke="${C.sudaderaClara}" stroke-width="16" fill="none" stroke-linecap="round"/>
    <path d="M640 466 Q652 560 642 648" stroke="${C.sudaderaClara}" stroke-width="16" fill="none" stroke-linecap="round"/>
    <path d="M470 476 Q461 520 465 560" stroke="${C.cordon}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="461" y="558" width="9" height="15" rx="3" fill="#E6E9F5"/>
    <path d="M610 476 Q619 520 615 560" stroke="${C.cordon}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="611" y="558" width="9" height="15" rx="3" fill="#E6E9F5"/>
    <g id="T">
      <rect x="506" y="498" width="22" height="22" rx="3" fill="${C.T.azul}"/>
      <rect x="530" y="498" width="22" height="22" rx="3" fill="${C.T.morado}"/>
      <rect x="554" y="498" width="22" height="22" rx="3" fill="${C.T.gris}"/>
      <rect x="530" y="522" width="22" height="22" rx="3" fill="${C.T.verde}"/>
      <rect x="530" y="546" width="22" height="22" rx="3" fill="${C.T.naranja}"/>
      <rect x="530" y="570" width="22" height="22" rx="3" fill="${C.T.amarillo}"/>
    </g>
  </g>

  <g id="cabeza">
    <g id="orejas">
      <ellipse cx="398" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(-18 398 196)"/><ellipse cx="402" cy="203" rx="29" ry="31" fill="${C.rosa}" transform="rotate(-18 402 203)"/>
      <ellipse cx="682" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(18 682 196)"/><ellipse cx="678" cy="203" rx="29" ry="31" fill="${C.rosa}" transform="rotate(18 678 203)"/>
    </g>
    <ellipse cx="540" cy="318" rx="172" ry="142" fill="${C.pelo}"/>
    <path d="M466 254 Q540 214 614 254 Q604 290 540 296 Q476 290 466 254 Z" fill="${C.peloClaro}"/>
    <path d="M516 206 Q522 182 534 196 Q540 174 552 194 Q562 180 566 206 Q541 214 516 206 Z" fill="${C.peloOsc}"/>
    <g id="cachetes">
      <ellipse cx="444" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <ellipse cx="636" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <ellipse cx="540" cy="420" rx="92" ry="58" fill="${C.crema}"/>
      <path d="M368 400 l-10 8 l12 2 l-8 10 l13 -1 M712 400 l10 8 l-12 2 l8 10 l-13 -1" stroke="${C.crema}" stroke-width="7" fill="none" stroke-linejoin="round"/>
      <path d="M470 470 Q540 486 610 470" stroke="${C.cremaSombra}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="438" cy="374" rx="34" ry="20" fill="url(#mejilla)"/>
      <ellipse cx="642" cy="374" rx="34" ry="20" fill="url(#mejilla)"/>
    </g>
    <g id="ojos">
      <circle cx="482" cy="330" r="26" fill="#14141F"/><circle cx="492" cy="319" r="8.5" fill="#fff"/><circle cx="474" cy="341" r="3.5" fill="#fff"/>
      <circle cx="598" cy="330" r="26" fill="#14141F"/><circle cx="608" cy="319" r="8.5" fill="#fff"/><circle cx="590" cy="341" r="3.5" fill="#fff"/>
    </g>
    <g id="boca">
      <path d="M527 368 Q540 360 553 368 Q547 382 540 383 Q533 382 527 368 Z" fill="${C.nariz}"/>
      <path d="M540 383 L540 392 M521 391 Q530 401 540 392 Q550 401 559 391" stroke="${C.boca}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="531" y="395" width="18" height="21" rx="3" fill="#fff" stroke="#CDBBA6" stroke-width="1.5"/>
      <path d="M540 395 L540 416" stroke="#CDBBA6" stroke-width="1.5"/>
    </g>
    <g id="audifonos">
      <path d="M368 322 Q362 168 540 158 Q718 168 712 322" stroke="${C.aud}" stroke-width="20" fill="none" stroke-linecap="round"/>
      <path d="M380 300 Q378 182 540 172 Q702 182 700 300" stroke="${C.audClaro}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>
      <rect x="340" y="280" width="54" height="98" rx="26" fill="${C.aud}"/><rect x="353" y="294" width="30" height="70" rx="15" fill="${C.audOsc}"/>
      <rect x="686" y="280" width="54" height="98" rx="26" fill="${C.aud}"/><rect x="697" y="294" width="30" height="70" rx="15" fill="${C.audOsc}"/>
      <path d="M712 352 Q694 400 604 402" stroke="${C.aud}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <ellipse cx="598" cy="402" rx="13" ry="9" fill="#1F2440"/>
    </g>
  </g>
</g>

<g id="escritorio">
  <rect x="0" y="642" width="1300" height="178" fill="${C.escritorio}"/>
  <path d="M0 642 L1300 642" stroke="#263063" stroke-width="3"/>
  ${teclado()}
  <rect x="245" y="714" width="650" height="100" rx="14" fill="#11172F"/>
  <path d="M262 715 L878 715" stroke="${C.cian}" stroke-width="4" stroke-linecap="round" opacity=".85"/>
</g>

<g id="brazos">
  <path d="M398 474 Q336 520 356 600 Q374 652 436 652 L458 624 Q420 600 426 540 Z" fill="${C.sudadera}"/>
  <path d="M682 474 Q744 520 724 600 Q706 652 644 652 L622 624 Q660 600 654 540 Z" fill="${C.sudadera}"/>
  <path d="M372 520 Q360 580 390 630" stroke="${C.sudaderaClara}" stroke-width="5" fill="none" opacity=".7" stroke-linecap="round"/>
  <g id="patas" fill="${C.rosaPata}" stroke="#E08C96" stroke-width="2">
    <path d="M420 650 Q420 630 444 630 Q468 630 468 650 Q468 664 444 664 Q420 664 420 650 Z"/>
    <path d="M612 650 Q612 630 636 630 Q660 630 660 650 Q660 664 636 664 Q612 664 612 650 Z"/>
    <path d="M436 652 L436 662 M452 652 L452 662 M628 652 L628 662 M644 652 L644 662" fill="none"/>
  </g>
</g>

<g id="lata">
  <circle cx="226" cy="532" r="4.5" fill="#4DDB8F"/><circle cx="236" cy="514" r="3.5" fill="#4DDB8F"/><circle cx="216" cy="548" r="3" fill="#4DDB8F"/>
  <rect x="185" y="566" width="72" height="126" rx="10" fill="url(#lataBrillo)"/>
  <ellipse cx="221" cy="566" rx="36" ry="10" fill="#C9D1E6"/><ellipse cx="221" cy="566" rx="26" ry="6" fill="#9AA4C4"/>
  <ellipse cx="221" cy="690" rx="36" ry="8" fill="#14804B"/>
  <polygon points="230,598 205,636 221,636 212,668 240,624 224,624" fill="#FFC857"/>
  <circle cx="198" cy="600" r="3" fill="#fff" opacity=".45"/><circle cx="244" cy="650" r="2.5" fill="#fff" opacity=".4"/>
</g>

<g id="pato">
  <ellipse cx="900" cy="690" rx="70" ry="10" fill="#000" opacity=".25"/>
  <path d="M955 648 L990 616 L972 666 Z" fill="${C.pato}"/>
  <ellipse cx="898" cy="656" rx="68" ry="34" fill="${C.pato}"/>
  <path d="M884 645 Q916 626 940 652 Q912 670 884 658 Z" fill="${C.patoOsc}"/>
  <circle cx="858" cy="606" r="32" fill="${C.pato}"/>
  <path d="M832 600 Q808 602 798 611 Q812 620 834 617 Z" fill="${C.pico}"/>
  <circle cx="849" cy="598" r="5" fill="#14141F"/><circle cx="851" cy="596" r="1.6" fill="#fff"/>
</g>
</svg>`;

const salida = fileURLToPath(new URL('./hamster-2d.svg', import.meta.url));
writeFileSync(salida, svg);
console.log('listo:', salida);
