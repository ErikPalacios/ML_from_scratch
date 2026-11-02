// Every browser module must at least parse: the API tests never load web/js/app.js or sync.js, so a typo there
// (an unclosed string, a stray quote in a template) would only show up as a blank board in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'js');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('all web/js modules parse', () => {
  const files = walk(WEB).filter((f) => /\.(m?js)$/.test(f));
  assert.ok(files.length > 10);
  for (const f of files) {
    assert.doesNotThrow(() => execFileSync('node', ['--check', f], { stdio: 'pipe' }), f);
  }
});
