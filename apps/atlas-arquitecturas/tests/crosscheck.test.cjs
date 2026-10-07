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

test('parámetros, formas y FLOPs coinciden con PyTorch (timm / HF / torchvision / nn.TransformerEncoderLayer)', async () => {
  const { compareAll } = await load();
  const results = compareAll(ROOT);
  assert.ok(results.length >= 20, 'se esperaban ≥ 20 configs (fase 1 + Swin, ResNet-50, CLIP + DETR, Deformable DETR)');
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

// ---------------------------------------------------------------- fase 2
const find = async (id) => { const { compareAll } = await load(); return compareAll(ROOT).find((r) => r.configId === id); };

test('Swin: timm swin_*(pretrained=False), ventanas y shift por bloque, notas MACs vs FLOPs', async () => {
  const t = await find('swin-t-224');
  assert.strictEqual(t.exp.params_total, 28288354);
  assert.strictEqual(t.exp.flops_total, 2 * 4490566656);
  assert.match(t.exp.source.ctor, /swin_tiny_patch4_window7_224', pretrained=False/);
  assert.ok(t.exp.notes.some((n) => /4\.5G/.test(n) && /MACs/.test(n)));
  const s4 = t.exp.windows.filter((w) => w.stage === 4);
  assert.deepStrictEqual(s4.map((w) => w.shift_size[0]), [0, 0]);   // mapa 7×7 = ventana: sin shift
  assert.ok(t.checks.filter((c) => c.what.startsWith('window[')).length >= 32);
  for (const id of ['swin-s-224', 'swin-b-224', 'swin-b-384']) {
    const r = await find(id);
    assert.ok(r.checks.filter((c) => c.what.startsWith('shape[')).length >= 80, id + ' con pocas formas');
  }
});

test('ResNet-50: torchvision resnet50(weights=None), C2…C5 y buffers de BN', async () => {
  const r = await find('resnet50-224');
  assert.strictEqual(r.exp.params_total, 25557032);
  assert.strictEqual(r.exp.flops_total, 2 * 4089184256);
  assert.deepStrictEqual(r.exp.shapes.c5, [7, 7, 2048]);
  assert.strictEqual(r.exp.buffers_total, 53173);
  assert.ok(r.exp.notes.some((n) => /v1\.5/.test(n)));
});

test('CLIP: HF CLIPModel construido en código, totales por par (B = 1) y batch_check (B = 4)', async () => {
  for (const id of ['clip-vit-b16', 'clip-vit-b32', 'clip-vit-l14', 'clip-vit-l14-336']) {
    const r = await find(id);
    assert.deepStrictEqual(r.exp.calc_overrides, { B: 1 });
    assert.strictEqual(r.exp.batch_check.B, 4);
    assert.ok(r.checks.some((c) => c.what === 'batch B=4 flops_total' && c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'params[txt-encoder>tok-embed]' && c.ok), id);
    assert.match(r.exp.source.ctor, /CLIPModel\._from_config\(CLIPConfig\(/);
  }
  const b = await find('clip-vit-b16');
  assert.strictEqual(b.exp.params_total, 149620737);
  assert.deepStrictEqual(b.exp.batch_check.shapes.logits, [4, 4]);
  assert.ok(b.exp.notes.some((n) => /OpenAI/.test(n)));
});

// ---------------------------------------------------------------- fase 3
test('DETR: HF DetrForObjectDetection construido en código, FrozenBN = buffers (como el oficial), FLOPs exactos', async () => {
  for (const id of ['detr-r50-800x1216', 'detr-r50-640']) {
    const r = await find(id);
    assert.strictEqual(r.exp.params_total, 41524768, id);
    assert.strictEqual(r.exp.buffers_total, 106240, id);                // 4·26,560: γ, β, media y varianza congeladas
    assert.strictEqual(r.exp.params_official_trainable, 41302368, id);  // el n_parameters del código oficial
    assert.strictEqual(r.exp.source.backbone.use_pretrained_backbone, false);
    assert.match(r.exp.source.ctor, /DetrForObjectDetection\._from_config\(DetrConfig\(/);
    assert.match(r.exp.source.ctor, /'auxiliary_loss': False/);
    for (const w of ['params oficiales entrenables', 'buffers de BN', 'flops[convolution]', 'flops[addmm+mm]', 'flops[bmm/sdpa]']) {
      assert.ok(r.checks.some((c) => c.what === w && c.ok), id + ' ' + w);
    }
    assert.ok(r.checks.filter((c) => c.what.startsWith('shape[')).length >= 50, id + ' con pocas formas');
    assert.ok(r.exp.notes.some((n) => /FrozenBatchNorm2d/.test(n)));
  }
  const c = await find('detr-r50-800x1216');
  assert.strictEqual(c.exp.flops_total, 2 * 91932364800);
  assert.deepStrictEqual(c.exp.shapes['e-attn'], [8, 950, 950]);
  assert.deepStrictEqual(c.exp.shapes['d-cross-attn'], [8, 100, 950]);
  assert.deepStrictEqual(c.exp.shapes.c5, [25, 38, 2048]);
});

test('Deformable DETR: HF DeformableDetrForObjectDetection, muestreo analítico y cabezas auxiliares restadas', async () => {
  const r = await find('deformable-detr-r50');
  assert.strictEqual(r.exp.params_total, 40069665);
  assert.deepStrictEqual(r.exp.levels, [[100, 152], [50, 76], [25, 38], [13, 19]]);
  assert.strictEqual(r.exp.msda_calls, 12);                             // 6 del encoder + 6 de la cross-attention
  assert.strictEqual(r.exp.flops_total, r.exp.flops_counted_torch - r.exp.flops_aux_heads_torch + r.exp.flops_sampling_analytic);
  assert.strictEqual(r.exp.flops_total, 2 * 187717110784);
  assert.ok(r.checks.some((c) => c.what === 'flops[muestreo deformable, analítico]' && c.ok));
  assert.ok(r.checks.some((c) => c.what === 'flops contados por torch (sin cabezas aux.)' && c.ok));
  assert.deepStrictEqual(r.exp.shapes['e-sampled'], [8, 20197, 16, 32]);
  assert.ok(r.exp.notes.some((n) => /grid_sample/.test(n)));
  assert.match(r.exp.source.ctor, /DeformableDetrForObjectDetection\._from_config\(DeformableDetrConfig\(/);
});

// ---------------------------------------------------------------- fase 4
test('Grounding DINO: HF GroundingDinoForObjectDetection sin pesos ni tokenizer; LayerNorm sin uso restada; FLOPs por bloque exactos', async () => {
  const r = await find('grounding-dino-t');
  assert.strictEqual(r.exp.params_total, 172249090);
  assert.strictEqual(r.exp.params_total_hf_raw, 172250626);
  assert.strictEqual(r.exp.params_unused_swin_layernorm, 1536);
  assert.strictEqual(r.exp.flops_total, r.exp.flops_counted_torch - r.exp.flops_aux_heads_torch - r.exp.flops_encoder_logits_torch + r.exp.flops_sampling_analytic);
  assert.strictEqual(r.exp.flops_total, 2 * 459478198272);
  assert.strictEqual(r.exp.msda_calls, 12);
  assert.deepStrictEqual(r.exp.levels, [[112, 168], [56, 84], [28, 42], [14, 21]]);
  assert.strictEqual(r.exp.text_input.T, 16);
  assert.match(r.exp.source.ctor, /GroundingDinoForObjectDetection\._from_config\(GroundingDinoConfig\(\)/);
  assert.strictEqual(r.exp.source.text.model_type, 'bert');
  assert.strictEqual(r.exp.source.backbone.model_type, 'swin');
  for (const w of ['flops[img-backbone]', 'flops[txt-backbone]', 'flops[enhancer]', 'flops[query-select]', 'flops[decoder]', 'flops[contrastive-head+box-head]',
    'flops[muestreo deformable, analítico]', 'flops contados por torch (sin cabezas aux.)', '[T=64] flops_total', '[T=64] shape[logits]', 'params HF crudos',
    'params[enhancer>enh-layer>i2t]', 'params[enhancer>enh-layer>t2i]', 'params[decoder>ref-head]']) {
    assert.ok(r.checks.some((c) => c.what === w && c.ok), w);
  }
  // Swin: ventana 7 y shift 3 en los bloques impares de los 4 stages (SwinBackbone, always_partition)
  assert.strictEqual(r.exp.swin_windows.length, 12);
  assert.ok(r.exp.swin_windows.every((w) => w.window_size === 7 && w.shift_size === (w.block % 2 === 0 ? 3 : 0)));
  assert.ok(r.checks.filter((c) => c.what.startsWith('swin[')).length === 24);
  assert.ok(r.checks.filter((c) => c.what.startsWith('shape[')).length >= 120, 'pocas formas');
  assert.deepStrictEqual(r.exp.shapes['i-enh-i2t-attn'], [4, 24990, 16]);
  assert.deepStrictEqual(r.exp.shapes.logits, [900, 16]);
  assert.ok(r.exp.notes.some((n) => /pooler/.test(n)) && r.exp.notes.some((n) => /grid_sample/.test(n)));
});

test('YOLOv8-L y YOLO-World-L: Ultralytics desde los YAML, sin pesos ni CLIP; parámetros, FLOPs por bloque y por operador exactos', async () => {
  const y = await find('yolov8l-640');
  assert.strictEqual(y.exp.params_total, 43691520);
  assert.strictEqual(y.exp.flops_total, 165148518400);
  assert.strictEqual(y.exp.source.lib, 'ultralytics');
  assert.match(y.exp.source.ctor, /DetectionModel\('yolov8l\.yaml'/);
  const w = await find('yolo-world-l-640');
  assert.strictEqual(w.exp.params_total, 47553970);
  assert.strictEqual(w.exp.flops_total, 176958220288);
  assert.match(w.exp.source.ctor, /WorldModel\('yolov8l-world\.yaml'.*clip_model = None/);
  assert.strictEqual(w.exp.v2.params_total, 46832050);
  assert.strictEqual(w.exp.v2.contrastive_head, 'BNContrastiveHead');
  for (const r of [y, w]) {
    for (const k of ['flops[backbone]', 'flops[neck]', 'flops[head-box]', 'flops[aten.convolution]', 'flops[aten.addmm+aten.mm]', 'flops[aten.bmm]', 'params[head-box>dfl]']) {
      assert.ok(r.checks.some((c) => c.what === k && c.ok), r.configId + ' ' + k);
    }
    assert.ok(r.exp.notes.some((n) => /SPPF/.test(n)));
  }
  for (const k of ['[V=20] flops_total', '[V=20] params_total', 'params v2 (yolov8l-worldv2.yaml)', 'params[neck>img-pool-attn]', 'params[neck>bu-p5>t-csp>max-sigmoid]', 'flops[head-text]']) {
    assert.ok(w.checks.some((c) => c.what === k && c.ok), k);
  }
  assert.deepStrictEqual(w.exp.shapes['logits-p3'], [6400, 80]);
  assert.deepStrictEqual(w.exp.shapes['td3-tg-scores'], [4, 6400, 80]);
  assert.ok(w.exp.notes.some((n) => /ORIGINAL/.test(n)));
});
