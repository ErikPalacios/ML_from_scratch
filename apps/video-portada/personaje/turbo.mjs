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

// ── Caras. Los valores por defecto dan la cara del diseño original.
const OJO = '#14141F';
const ojo = (cx) => `<circle cx="${cx}" cy="330" r="26" fill="${OJO}"/><circle cx="${cx + 10}" cy="319" r="8.5" fill="#fff"/><circle cx="${cx - 8}" cy="341" r="3.5" fill="#fff"/>`;
function ojosSVG(tipo = 'normal', parpado = 0) {
  if (parpado >= 0.92) return [482, 598].map((cx) => `<path d="M${cx - 24} 332 Q${cx} 344 ${cx + 24} 332" stroke="${OJO}" stroke-width="6" fill="none" stroke-linecap="round"/>`).join('');
  const escala = (svg) => (parpado > 0 ? `<g transform="translate(0 330) scale(1 ${(1 - parpado).toFixed(3)}) translate(0 -330)">${svg}</g>` : svg);
  if (tipo === 'shock') return escala([482, 598].map((cx) => `<circle cx="${cx}" cy="330" r="29" fill="#fff" stroke="${OJO}" stroke-width="5"/><circle cx="${cx}" cy="332" r="9" fill="${OJO}"/>`).join(''));
  const base = escala(`${ojo(482)}
      ${ojo(598)}`);
  if (tipo === 'fastidio') return base + [482, 598].map((cx) => `<path d="M${cx - 30} 331 A30 30 0 0 1 ${cx + 30} 331 Z" fill="${C.pelo}"/><path d="M${cx - 30} 331 L${cx + 30} 331" stroke="${C.boca}" stroke-width="5" stroke-linecap="round"/>`).join('');
  if (tipo === 'enojado') return base + `<path d="M452 310 L514 332 L514 296 L452 296 Z M628 310 L566 332 L566 296 L628 296 Z" fill="${C.pelo}"/><path d="M452 310 L514 332 M628 310 L566 332" stroke="${C.boca}" stroke-width="5" stroke-linecap="round"/>`;
  return base;
}
function cejasSVG(tipo) {
  if (tipo === 'enojado') return `<path id="cejas" d="M444 288 L512 312 M636 288 L568 312" stroke="${C.boca}" stroke-width="11" stroke-linecap="round"/>`;
  if (tipo === 'arriba') return `<path id="cejas" d="M454 286 Q482 268 510 284 M570 284 Q598 268 626 286" stroke="${C.boca}" stroke-width="8" fill="none" stroke-linecap="round"/>`;
  return '';
}
const NARIZ = `<path d="M527 368 Q540 360 553 368 Q547 382 540 383 Q533 382 527 368 Z" fill="${C.nariz}"/>`;
function bocaSVG(tipo = 'normal') {
  if (tipo === 'grito') return `      ${NARIZ}
      <path d="M512 392 Q540 382 568 392 Q566 446 540 450 Q514 446 512 392 Z" fill="#5A1E22"/>
      <ellipse cx="540" cy="436" rx="15" ry="9" fill="${C.nariz}"/>
      <rect x="530" y="390" width="20" height="17" rx="3" fill="#fff"/><path d="M540 390 L540 407" stroke="#CDBBA6" stroke-width="1.5"/>`;
  if (tipo === 'mueca') return `      ${NARIZ}
      <path d="M540 383 L540 392 M516 398 Q528 390 540 397 Q552 404 564 396" stroke="${C.boca}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <rect x="533" y="399" width="14" height="15" rx="3" fill="#fff" stroke="#CDBBA6" stroke-width="1.5"/>`;
  return `      <path d="M527 368 Q540 360 553 368 Q547 382 540 383 Q533 382 527 368 Z" fill="${C.nariz}"/>
      <path d="M540 383 L540 392 M521 391 Q530 401 540 392 Q550 401 559 391" stroke="${C.boca}" stroke-width="3" fill="none" stroke-linecap="round"/>
      <rect x="531" y="395" width="18" height="21" rx="3" fill="#fff" stroke="#CDBBA6" stroke-width="1.5"/>
      <path d="M540 395 L540 416" stroke="#CDBBA6" stroke-width="1.5"/>`;
}

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

export const cabeza = (o = {}) => `
  <g id="cabeza">
    <g id="orejas">
      <ellipse cx="398" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(-18 398 196)"/><ellipse cx="402" cy="203" rx="29" ry="31" fill="${C.rosa}" transform="rotate(-18 402 203)"/>
      <ellipse cx="682" cy="196" rx="46" ry="48" fill="${C.peloOsc}" transform="rotate(18 682 196)"/><ellipse cx="678" cy="203" rx="29" ry="31" fill="${C.rosa}" transform="rotate(18 678 203)"/>
    </g>
    <ellipse cx="540" cy="318" rx="172" ry="142" fill="${C.pelo}"/>
    <path d="M466 254 Q540 214 614 254 Q604 290 540 296 Q476 290 466 254 Z" fill="${C.peloClaro}"/>
    <path d="M516 206 Q522 182 534 196 Q540 174 552 194 Q562 180 566 206 Q541 214 516 206 Z" fill="${C.peloOsc}"/>
    <g id="cachetes"${o.cachetes && o.cachetes !== 1 ? ` transform="translate(540 420) scale(${o.cachetes}) translate(-540 -420)"` : ''}>
      <ellipse cx="444" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <ellipse cx="636" cy="412" rx="80" ry="62" fill="${C.crema}"/>
      <ellipse cx="540" cy="420" rx="92" ry="58" fill="${C.crema}"/>
      <path d="M368 400 l-10 8 l12 2 l-8 10 l13 -1 M712 400 l10 8 l-12 2 l8 10 l-13 -1" stroke="${C.crema}" stroke-width="7" fill="none" stroke-linejoin="round"/>
      <path d="M470 470 Q540 486 610 470" stroke="${C.cremaSombra}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="438" cy="374" rx="34" ry="20" fill="url(#mejilla)"/>
      <ellipse cx="642" cy="374" rx="34" ry="20" fill="url(#mejilla)"/>
    </g>
    <g id="ojos">
      ${ojosSVG(o.ojos, o.parpado)}
    </g>${cejasSVG(o.cejas)}
    <g id="boca">
${bocaSVG(o.boca)}
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

// ── Cuerpo entero (de frente y de espaldas). Marco 1080×900, centrado en x=540, pies en y≈815.
// Un brazo: manga gruesa con borde oscuro, puño y patita rosa. lado = -1 (izquierda) o 1 (derecha).
export function brazo(lado, id, ang = 0) {
  const x = (v) => 540 + lado * (540 - v); // refleja desde el lado izquierdo
  const giro = ang ? ` transform="rotate(${ang} ${x(408)} 494)"` : '';
  const manga = `M${x(408)} 494 Q${x(330)} 540 ${x(334)} 620`;
  return `<g id="${id}"${giro}>
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

export function pie(cx, id, dy = 0) {
  return `<g id="${id}"${dy ? ` transform="translate(0 ${dy})"` : ''}>
    <ellipse cx="${cx}" cy="772" rx="42" ry="34" fill="${C.pelo}"/>
    <g fill="${C.rosaPata}" stroke="#E08C96" stroke-width="2">
      <ellipse cx="${cx}" cy="800" rx="44" ry="16"/>
      <path d="M${cx - 16} 792 L${cx - 16} 804 M${cx} 790 L${cx} 805 M${cx + 16} 792 L${cx + 16} 804" fill="none"/>
    </g>
  </g>`;
}

// o: { cara: opciones de cabeza(), brazos: [grados izq, grados der], pies: [dy izq, dy der] }
export const turboCuerpo = (o = {}) => `<g id="turbo">
  <ellipse id="sombra" cx="540" cy="816" rx="210" ry="20" fill="#000" opacity=".3"/>
  ${pie(468, 'pieIzq', o.pies?.[0])}
  ${pie(612, 'pieDer', o.pies?.[1])}
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
  ${brazo(-1, 'brazoIzq', o.brazos?.[0])}
  ${brazo(1, 'brazoDer', o.brazos?.[1])}
  ${cabeza(o.cara)}
</g>`;

// Pie visto por detrás: la pierna y solo el talón rosa.
const talon = (cx, id, dy = 0) => `<g id="${id}"${dy ? ` transform="translate(0 ${dy})"` : ''}>
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

export const turboEspalda = (o = {}) => `<g id="turboEspalda">
  <ellipse id="sombra" cx="540" cy="816" rx="210" ry="20" fill="#000" opacity=".3"/>
  ${talon(468, 'pieIzq', o.pies?.[0])}
  ${talon(612, 'pieDer', o.pies?.[1])}
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
  ${brazo(-1, 'brazoIzq', o.brazos?.[0])}
  ${brazo(1, 'brazoDer', o.brazos?.[1])}
  ${nuca()}
</g>`;

// ── Debug, el pato de hule. Marco 210×145, mira a la izquierda. ceja: 0 (normal) … 1 (bien levantada).
export const pato = (o = {}) => {
  const k = o.ceja ?? 0;
  return `<g id="debug">
  <ellipse cx="110" cy="130" rx="70" ry="10" fill="#000" opacity=".25"/>
  <path d="M165 88 L200 56 L182 106 Z" fill="${C.pato}"/>
  <ellipse cx="108" cy="96" rx="68" ry="34" fill="${C.pato}"/>
  <path d="M94 85 Q126 66 150 92 Q122 110 94 98 Z" fill="${C.patoOsc}"/>
  <circle cx="68" cy="46" r="32" fill="${C.pato}"/>
  <path d="M42 40 Q18 42 8 51 Q22 60 44 57 Z" fill="${C.pico}"/>
  <circle cx="59" cy="38" r="5" fill="#14141F"/><circle cx="61" cy="36" r="1.6" fill="#fff"/>
  <path d="M47 ${30 - 8 * k} L69 ${28 - 13 * k}" stroke="#14141F" stroke-width="3.5" stroke-linecap="round" opacity="${k > 0.02 ? 1 : 0}"/>
</g>`;
};
