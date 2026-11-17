// Genera src/marca.ts con la T de vidrio de TrueML (el SVG real de apps/trueml, en tema oscuro).
// Cada etapa queda en <g data-stage="..."> para animarla por separado en el video.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marca } from '../../trueml/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sin = marca({});
const con = marca({ etiquetas: true });
writeFileSync(join(ROOT, 'src', 'marca.ts'), `// Generado por tools/marca.mjs desde apps/trueml — no editar a mano.\nexport const MARCA = ${JSON.stringify(sin)};\nexport const MARCA_ETIQUETAS = ${JSON.stringify(con)};\n`);
console.log('✓ src/marca.ts', sin.length, con.length);
