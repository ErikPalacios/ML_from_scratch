// Los reels registrados (cada uno con su composición «Reel-<id>»). El reel 01 es la composición Instagram.
import React from 'react';
import { duracion } from './kit';
import { ReelTransformer } from './Transformer';
import { ReelSensei } from './Sensei';
import { ReelDojo } from './Dojo';
import { ReelAtlas } from './Atlas';
import { ReelRonda } from './Ronda';
import { ReelHojas } from './Hojas';
import { ReelOverfitting } from './Overfitting';
import { ReelLaT } from './LaT';
import { ReelPresume99 } from './Presume99';
import { ReelVibecoding } from './Vibecoding';

const lista: [string, React.FC<{ sonido?: boolean }>][] = [
  ['02-transformer', ReelTransformer],
  ['03-sensei', ReelSensei],
  ['04-dojo', ReelDojo],
  ['05-atlas', ReelAtlas],
  ['06-ronda', ReelRonda],
  ['07-hojas', ReelHojas],
  ['08-overfitting', ReelOverfitting],
  ['09-la-t', ReelLaT],
  ['10-presume-99', ReelPresume99],
  ['11-vibecoding', ReelVibecoding],
];
export const REELS = lista.map(([id, componente]) => ({ id, componente, dur: duracion(id) }));
