// Pruebas de contenido: el validador pasa y el archivo embebido está al día.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const run = (script, args = []) => spawnSync(process.execPath, [join(ROOT, 'tools', script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('validate-content: sin errores', () => {
  const r = run('validate-content.mjs', ['--quiet']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('reference-files.js está al día con reference/**', () => {
  const r = run('embed-reference.mjs', ['--check']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
