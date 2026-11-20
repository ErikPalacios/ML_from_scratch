// Turbo, el hámster programador: las piezas que comparten todos los dibujos (colores, cabeza y pecho).
// Coordenadas: la cabeza está centrada en x=540; el cuello queda en y≈470.

export const C = {
  fondo: '#0B1026', panel: '#121A36', borde: '#1E2A55', cian: '#2BD4F0',
  pelo: '#D98A45', peloOsc: '#B96A2E', peloClaro: '#EBA866', crema: '#FBE3C4', cremaSombra: '#EFCDA6',
  rosa: '#F2A3A8', rosaPata: '#F4B6BC', nariz: '#E9808E', boca: '#6B3A22',
  aud: '#6B7FE0', audClaro: '#93A4FF', audOsc: '#3B4A9E',
  sudadera: '#222C52', sudaderaOsc: '#18203F', sudaderaClara: '#2E3A6A', camiseta: '#0B0F1F', cordon: '#C8CEE6',
  T: { azul: '#4A63E8', morado: '#7A69EE', gris: '#5A6699', verde: '#17B386', naranja: '#EC6A3F', amarillo: '#E8AE36' },
  silla: '#3E2752', rueda: '#2A3360', escritorio: '#161D3D', lata: '#2BB673', pato: '#FFC83D', patoOsc: '#F0B42A', pico: '#F07A2A',
};

// Gradientes que usan las piezas. Van dentro de <defs>.
export const defsTurbo = `<radialGradient id="mejilla" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#F48B9A" stop-opacity=".85"/><stop offset="1" stop-color="#F48B9A" stop-opacity="0"/></radialGradient>`;

// Camiseta negra con la T, solapas de la sudadera abierta y cordones (sin la panza).
export const pecho = () => `
    <path d="M444 468 Q540 452 636 468 L641 612 Q540 624 440 612 Z" fill="${C.camiseta}"/>
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
`;

export const cabeza = () => `
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
`;
