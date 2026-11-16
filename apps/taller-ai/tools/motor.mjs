#!/usr/bin/env node
// Copia el motor del tablero (apps/tablero-ml/web/js/shared) a site/tablero/motor/. El Dojo se despliega solo desde su
// carpeta, así que lleva su copia; la fuente es el tablero. «Tu tablero» usa sus ops y su validación (ver
// site/tablero/modelo.mjs).
//
//   node tools/motor.mjs           copia
//   node tools/motor.mjs --check   solo revisa que la copia esté al día (sale con 1 si se desfasó)
//
// En Vercel la fuente no existe (solo sube esta carpeta): ahí no se revisa nada y el build usa la copia.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = join(ROOT, '..', 'tablero-ml', 'web', 'js', 'shared');
const DESTINO = join(ROOT, 'site', 'tablero', 'motor');
export const ARCHIVOS = ['ops.mjs', 'model.mjs', 'calc.mjs'];

export function revisarMotor() {
  if (!existsSync(FUENTE)) return { fuente: false, desfasados: [] };
  const desfasados = ARCHIVOS.filter((f) => !existsSync(join(DESTINO, f)) || readFileSync(join(DESTINO, f), 'utf8') !== readFileSync(join(FUENTE, f), 'utf8'));
  return { fuente: true, desfasados };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const r = revisarMotor();
    if (!r.fuente) console.log('[motor] sin apps/tablero-ml al lado: no hay nada que revisar');
    else if (r.desfasados.length) { console.error(`[motor] desfasado: ${r.desfasados.join(', ')} (corre node tools/motor.mjs)`); process.exit(1); }
    else console.log('[motor] la copia está al día');
  } else {
    if (!existsSync(FUENTE)) { console.error('[motor] no encuentro apps/tablero-ml/web/js/shared'); process.exit(1); }
    mkdirSync(DESTINO, { recursive: true });
    for (const f of ARCHIVOS) writeFileSync(join(DESTINO, f), readFileSync(join(FUENTE, f), 'utf8'));
    console.log(`[motor] copiados ${ARCHIVOS.join(', ')} a site/tablero/motor/`);
  }
}
