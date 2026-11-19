// Los videos explicativos registrados (composición «Tutorial-<id>», 1920×1080): tres tutoriales completos
// (Sensei, Dojo y el tablero) y cuatro muestras cortas.
import type { Guion } from './tiempo';
import { SENSEI } from './sensei';
import { DOJO } from './dojo';
import { TABLERO } from './tablero';
import { ATLAS, HOJAS, RONDA, TRANSFORMER } from './muestras';

export const GUIONES: Guion[] = [SENSEI, DOJO, TABLERO, TRANSFORMER, ATLAS, RONDA, HOJAS];
