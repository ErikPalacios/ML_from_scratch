// Calculador ↔ referencias PyTorch versionadas en crosscheck/expected/*.json (SPEC §9.3).
// No necesita Python: compara con los JSON. Parámetros y formas exactos; FLOPs dentro de 0.5 %
// (FlopCounterMode cuenta 2 FLOPs por MAC de matmuls/convs/sdpa, igual que el calculador, así que
// la diferencia esperada es 0; sesgos, normas, softmax y GELU no cuentan en ninguno de los dos).
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const load = () => import(pathToFileURL(path.join(ROOT, 'tools', 'crosscheck-compare.mjs')).href);

test('hay un JSON de referencia por cada config del calculador', async () => {
  const { compareAll } = await load();
  const missing = compareAll(ROOT).filter((r) => r.checks.some((c) => c.what === 'expected json' || c.what === 'config'));
  assert.deepStrictEqual(missing.map((r) => r.configId), []);
});

test('parámetros, formas y FLOPs coinciden con PyTorch (timm / HF / nn.TransformerEncoderLayer)', async () => {
  const { compareAll } = await load();
  const results = compareAll(ROOT);
  assert.ok(results.length >= 8, 'se esperaban ≥ 8 configs');
  for (const r of results) {
    const fails = r.checks.filter((c) => !c.ok).map((c) => c.what + ': calc ' + c.calc + ' ≠ ref ' + c.ref);
    assert.deepStrictEqual(fails, [], r.configId);
    // Debe haberse comparado algo sustancial: total, al menos 9 formas y los FLOPs.
    assert.ok(r.checks.some((c) => c.what === 'params_total'), r.configId + ' sin params_total');
    assert.ok(r.checks.filter((c) => c.what.startsWith('shape[')).length >= 9, r.configId + ' con pocas formas');
    assert.ok(r.checks.some((c) => c.what === 'flops_total'), r.configId + ' sin flops_total');
  }
});

test('ViT-B/16: el JSON dice que timm no tiene pre-logits y usa la cabeza de 1000 clases', async () => {
  const { compareAll } = await load();
  const vb = compareAll(ROOT).find((r) => r.configId === 'vit-b16-224');
  assert.strictEqual(vb.exp.params_total, 86567656);
  assert.strictEqual(vb.exp.flops_total, 2 * 17563828224);
  assert.ok(vb.exp.notes.some((n) => /pre-logits/.test(n)));
  assert.match(vb.exp.source.ctor, /pretrained=False/);
});
