// Punto de entrada de `node --test tests/`: en Node ≥ 22 un directorio pasado a --test se ejecuta
// como módulo (tests/index.js), así que aquí se cargan todos los *.test.cjs de la carpeta.
// (En Node 20 el directorio se recorre y este archivo se ignora: no coincide con los patrones de test.)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
for (const f of fs.readdirSync(__dirname).filter((n) => /\.test\.c?js$/.test(n)).sort()) {
  require(path.join(__dirname, f));
}
