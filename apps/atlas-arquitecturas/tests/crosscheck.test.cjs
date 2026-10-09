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

// ---------------------------------------------------------------- fase 6
test('LLM: HF LlamaForCausalLM / MixtralForCausalLM en el dispositivo meta; prefill, decode con KV cache y what-if nKV exactos', async () => {
  const want = { 'llama3-8b': [8030261248, 32938104193024, 17156800512], 'llama3-70b': [70553706496, 295674138591232, 149740847104],
    'llama2-7b': [6738415616, 29261612187648, 15361638400], 'mixtral-8x7b': [46702792704, 54417235640320, 27644657664] };
  for (const [id, [params, flops, decFlops]] of Object.entries(want)) {
    const r = await find(id);
    assert.strictEqual(r.exp.params_total, params, id);
    assert.strictEqual(r.exp.flops_total, flops, id);
    assert.deepStrictEqual([r.exp.T, r.exp.ctx], [2048, 4096], id);
    assert.match(r.exp.source.ctor, /with torch\.device\('meta'\)/);
    assert.match(r.exp.source.ctor, /tie_word_embeddings=False/);
    const dec = r.exp.override_checks.find((o) => o.calc_overrides.decode === 1);
    assert.strictEqual(dec.flops_total, decFlops, id + ' decode');
    for (const k of ['flops[attn]', 'flops[ffn]', 'flops[lm-head]', 'flops[aten.mm]', 'flops[aten.bmm]', '[T=64] flops_total', '[T=64] flops_total (sdpa)',
      '[decode=1,ctx=4096] flops_total', '[decode=1,ctx=4096] shape[k-ctx]', '[decode=1,ctx=4096] shape[attn]', 'metrics[kvBytesPerToken]', 'metrics[activeParams]',
      'params[embed]', 'params[lm-head]', 'params[k-proj]', 'params[ffn]']) {
      assert.ok(r.checks.some((c) => c.what === k && c.ok), id + ' ' + k);
    }
    assert.deepStrictEqual(dec.shapes.attn, [id === 'llama3-70b' ? 64 : 32, 1, 4096], id);
    assert.ok(r.exp.notes.some((n) => /máscara causal NO divide/.test(n)), id);
    assert.ok(r.exp.notes.some((n) => /meta/.test(n)), id);
  }
  const l3 = await find('llama3-8b');
  assert.deepStrictEqual(l3.exp.shapes['k-rope'], [8, 2048, 128]);
  assert.deepStrictEqual(l3.exp.shapes.attn, [32, 2048, 2048]);
  assert.strictEqual(l3.exp.metrics_checks.kvBytesPerToken, 131072);     // DynamicCache de HF: 2·32·8·128 elementos × 2 bytes
  for (const k of ['[nKV=32] params_total', '[nKV=32] flops_total', '[nKV=1] params_total', '[nKV=1] shape[k-rope]']) assert.ok(l3.checks.some((c) => c.what === k && c.ok), k);
  assert.ok(l3.exp.notes.some((n) => /128,256/.test(n)));
  const mx = await find('mixtral-8x7b');
  assert.strictEqual(mx.exp.metrics_checks.activeParams, 12879925248);
  assert.strictEqual(mx.exp.source.experts_implementation, 'batched_mm');
  assert.ok(mx.exp.moe_impl_check.eager_equals_batched_mm && mx.exp.moe_impl_check.grouped_mm_undercounts);
  assert.ok(mx.checks.some((c) => c.what === 'moe[eager = batched_mm en FlopCounterMode]' && c.ok));
  for (const k of ['flops[router]', 'flops[experts]', 'params[router]', 'params[experts]', '[decode=1,ctx=4096] shape[x-routed]']) assert.ok(mx.checks.some((c) => c.what === k && c.ok), k);
  assert.deepStrictEqual(mx.exp.shapes.gate, [4096, 14336]);              // 2T filas enrutadas
  assert.ok(mx.exp.notes.some((n) => /gate_up_proj/.test(n)));
  const l2 = await find('llama2-7b');
  assert.ok(l2.exp.notes.some((n) => /MHA/.test(n)));
  // configs de decode (revisión de la fase 6): un paso de decode de HF con DynamicCache = el grafo decode del calculador
  for (const [id, of, decFlops] of [['llama3-8b-decode', 'llama3-8b', 17156800512], ['mixtral-8x7b-decode', 'mixtral-8x7b', 27644657664]]) {
    const r = await find(id);
    assert.deepStrictEqual([r.exp.decode_of, r.exp.ctx, r.exp.flops_total], [of, 4096, decFlops], id);
    assert.ok(r.checks.every((c) => c.ok), id + ': ' + r.checks.filter((c) => !c.ok).map((c) => c.what).join(', '));
    for (const k of ['flops_total', 'shape[k-ctx]', 'shape[attn]', 'shape[logits]', 'flops[attn]', 'flops[aten.bmm]', '[ctx=8192] flops_total', '[ctx=8192] shape[k-ctx]', 'metrics[kvBytesPerToken]']) {
      assert.ok(r.checks.some((c) => c.what === k && c.ok), id + ' ' + k);
    }
    assert.deepStrictEqual(r.exp.shapes['k-ctx'], [8, 4096, 128], id);
    assert.strictEqual(r.exp.metrics_checks.kvBytesPerToken, 131072, id);
  }
});

// ---------------------------------------------------------------- fase 7
test('VLM: HF Llava / Qwen2VL en meta con todas las capas; capa 24 de CLIP contada; AnyRes y smart_resize de HF', async () => {
  for (const id of ['llava15-7b', 'llava15-13b', 'qwen2-vl-7b', 'qwen2-vl-2b', 'qwen2-vl-72b']) {
    const r = await find(id);
    assert.match(r.exp.source.ctor, /torch\.device\('meta'\)/, id);
    assert.ok(r.checks.some((c) => c.what === 'metrics[kvBytesPerToken]' && c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'metrics[visualTokens]' && c.ok), id);
  }
  const l = await find('llava15-7b');
  assert.strictEqual(l.exp.params_total, 7063427072);
  assert.ok(l.exp.notes.some((n) => /hidden_states\[−2\]/.test(n) && /capa 24/.test(n)));
  assert.ok(l.checks.some((c) => c.what === 'flops[last-layer]' && c.ok));
  assert.ok(l.checks.filter((c) => c.what.startsWith('anyres[') && c.ok).length >= 8);
  const q = await find('qwen2-vl-7b');
  assert.strictEqual(q.exp.params_total, 8291375616);
  assert.strictEqual(q.exp.metrics_checks.visualModuleParams, 675759104);
  assert.deepStrictEqual(q.exp.shapes['pos-ids'], [3, 905]);
  assert.ok(q.checks.filter((c) => c.what.startsWith('smart_resize[') && c.ok).length >= 10);
  assert.ok(q.checks.some((c) => c.what === '[frames=4] flops_total' && c.ok));
  assert.strictEqual((await find('qwen2-vl-2b')).exp.params_by_node['lm-head'], 0);
});

// ---------------------------------------------------------------- fase 8
test('Difusión: diffusers UNet2DConditionModel / AutoencoderKL / DiTTransformer2DModel + CLIPTextModel en meta; DiT = oficial (embedders sin duplicar); schedule de SD', async () => {
  for (const id of ['sd15-unet', 'sd15-train', 'sdxl-unet', 'dit-xl2-256', 'dit-xl2-512', 'dit-xl4-256', 'dit-xl8-256', 'dit-b2-256', 'dit-xl2-256-fm']) {
    const r = await find(id);
    assert.ok(r.checks.every((c) => c.ok), id + ': ' + r.checks.filter((c) => !c.ok).map((c) => c.what).join(', '));
    assert.match(r.exp.source.ctor, /torch\.device\('meta'\)/, id);
    assert.strictEqual(r.exp.source.lib, 'diffusers');
    assert.ok(r.checks.some((c) => c.what.startsWith('metrics[') && c.ok), id + ' sin metrics_checks');
    assert.ok(r.checks.some((c) => c.what.startsWith('[') && c.what.endsWith('flops_total') && c.ok) || /dit-xl[248]-|dit-b2|fm|512/.test(id), id + ' sin override_checks');
  }
  const sd = await find('sd15-unet');
  assert.deepStrictEqual([sd.exp.params_by_node.unet, sd.exp.params_by_node['text-encoder'], sd.exp.params_by_node['vae-encoder'], sd.exp.params_by_node['vae-decoder']],
    [859520964, 123060480, 34163664, 49490199]);
  assert.strictEqual(sd.exp.flops_by_node.unet, 2 * 401636720640);
  assert.deepStrictEqual(sd.exp.shapes['d1-attn1-sa-attn'], [8, 4096, 4096]);
  assert.deepStrictEqual(sd.exp.shapes['d1-attn1-ca-attn'], [8, 4096, 77]);
  assert.strictEqual(sd.exp.schedule_checks.pndm_nfe['50'], 51);
  assert.ok(sd.checks.filter((c) => c.what.startsWith('schedule[') && c.ok).length >= 12);
  assert.ok(sd.exp.notes.some((n) => /NÚMERO de cabezas/.test(n)));
  const xl = await find('sdxl-unet');
  assert.strictEqual(xl.exp.params_by_node.unet, 2567463684);
  assert.deepStrictEqual(xl.exp.shapes['text-emb'], [77, 2048]);
  const d = await find('dit-xl2-256');
  assert.deepStrictEqual([d.exp.params_total, d.exp.params_total_diffusers_raw, d.exp.pos_embed_values], [674834720, 749826464, 256 * 1152]);
  assert.strictEqual(d.exp.flops_total, 2 * 118621421568);
  assert.strictEqual(d.exp.flops_total, d.exp.flops_total_diffusers_raw - d.exp.flops_duplicated_embedders);
  assert.strictEqual(d.exp.metrics_checks.officialParams, 675129632);
  assert.strictEqual(d.exp.paper_gflops, 118.6);
  assert.ok(d.exp.notes.some((n) => /son MACs/.test(n)) && d.exp.notes.some((n) => /DUPLICA/.test(n)));
  assert.deepStrictEqual(d.exp.shapes.attn, [16, 256, 256]);
});

// ================================================================ FASE 9 (VLA) — bloque del agente arch
test('VLA: OpenVLA = el checkpoint (7,541,237,184) con timm + HF Llama en meta; π0 = PaliGemma + experto (port de openpi) en meta; todo exacto', async () => {
  for (const id of ['openvla-7b', 'pi0', 'pi0-1cam']) {
    const r = await find(id);
    assert.ok(r, id + ' sin JSON');
    assert.ok(r.checks.every((c) => c.ok), id + ': ' + r.checks.filter((c) => !c.ok).map((c) => c.what).join(', '));
    assert.match(r.exp.source.ctor, /torch\.device\('meta'\)/, id);
    assert.ok(r.checks.filter((c) => c.what.startsWith('metrics[') && c.ok).length >= 8, id + ' metrics_checks');
    assert.ok(r.checks.filter((c) => c.what.startsWith('flops[') && c.ok).length >= 6, id + ' flops_by_node');
  }
  const o = await find('openvla-7b');
  assert.deepStrictEqual([o.exp.params_total, o.exp.params_checkpoint], [7541237184, 7541237184]);
  assert.strictEqual(o.exp.flops_total, o.exp.flops_prefill + o.exp.flops_decode_steps.reduce((s, d) => s + d.flops, 0));
  assert.deepStrictEqual(o.exp.flops_decode_steps.map((d) => d.ctx), [279, 280, 281, 282, 283, 284]);
  assert.deepStrictEqual([o.exp.shapes['d-x0'], o.exp.shapes['vis-feats'], o.exp.shapes['proj-h1'], o.exp.shapes.prompt], [[261, 1024], [256, 2176], [256, 8704], [278, 4096]]);
  assert.ok(o.exp.notes.some((n) => /TRES lineales/.test(n)) && o.exp.notes.some((n) => /0\.9\.16/.test(n)));
  for (const tag of ['[T=64] flops_total', '[res=448] params_total', '[res=448] flops_total', '[da=4] flops_total']) assert.ok(o.checks.some((c) => c.what === tag && c.ok), tag);
  const p = await find('pi0');
  assert.deepStrictEqual([p.exp.params_total, p.exp.params_paligemma_hf, p.exp.metrics_checks.expertParams], [3238048528, 2923335408, 311464960]);
  assert.strictEqual(p.exp.flops_total, p.exp.flops_prefix + p.exp.flops_flow);
  assert.deepStrictEqual([p.exp.shapes['a-attn'], p.exp.shapes['a-k-all'], p.exp.shapes['k-rope'], p.exp.shapes.attn], [[8, 51, 867], [1, 867, 256], [1, 816, 256], [8, 816, 816]]);
  assert.strictEqual(p.exp.metrics_checks.kvBytesPerToken, 18432);
  for (const tag of ['[steps=5] flops_total', '[H=25] flops_total', '[T=16] flops_total', '[cams=2] flops_total']) assert.ok(p.checks.some((c) => c.what === tag && c.ok), tag);
  assert.ok(p.exp.notes.some((n) => /215abfb/.test(n)));
});
// ================================================================ fin del bloque de la fase 9

// ================================================================ FASE 10 (LoRA / QLoRA, RLHF / DPO / GRPO) — bloque del agente arch
test('LoRA / QLoRA / full FT: PEFT en meta (print_trainable_parameters exacto), forward + backward con FlopCounterMode, NF4 + DQ, activaciones medidas', async () => {
  for (const id of ['lora-llama3-8b-r16', 'lora-llama3-8b-r16-qv', 'lora-llama3-8b-r64', 'qlora-llama3-8b-r16', 'full-ft-llama3-8b']) {
    const r = await find(id);
    assert.ok(r, id + ' sin JSON');
    assert.ok(r.checks.every((c) => c.ok), id + ': ' + r.checks.filter((c) => !c.ok).map((c) => c.what).join(', '));
    assert.match(r.exp.source.ctor, /torch\.device\('meta'\)/, id);
    for (const k of ['metrics[forwardMacsPerSeq]', 'metrics[trainStepMacsPerSeq]', 'metrics[trainableParams]', '[gradCkpt=1] metrics[trainStepMacsPerSeq]', '[T=512] metrics[trainStepMacsPerSeq]']) {
      assert.ok(r.checks.some((c) => c.what === k && c.ok), id + ' ' + k);
    }
    const st = r.exp.flops_train_step;
    assert.ok(st.backward_ckpt_nonreentrant_hf_default <= st.backward_ckpt_reentrant, id);
  }
  const c = await find('lora-llama3-8b-r16');
  assert.strictEqual(c.exp.print_trainable_parameters, 'trainable params: 41,943,040 || all params: 8,072,204,288 || trainable%: 0.5196');
  assert.strictEqual((await find('lora-llama3-8b-r16-qv')).exp.print_trainable_parameters, 'trainable params: 6,815,744 || all params: 8,037,076,992 || trainable%: 0.0848');
  assert.strictEqual((await find('lora-llama3-8b-r64')).exp.metrics_checks.trainableParams, 167772160);
  for (const tag of ['[r=8] params_total', '[r=8] flops_total', '[targets=4] params_total', '[targets=2] flops_total']) assert.ok(c.checks.some((x) => x.what === tag && x.ok), tag);
  assert.strictEqual(c.exp.activation_checks.length, 4);
  assert.ok(c.checks.filter((x) => x.what.startsWith('activaciones[') && x.ok).length === 4);
  // full FT: backward = 2 × forward exacto
  const f = await find('full-ft-llama3-8b');
  assert.strictEqual(f.exp.flops_train_step.backward, 2 * f.exp.flops_train_step.forward);
  // QLoRA: la cuenta NF4 (bitsandbytes) en las nn.Linear reales: 0.5 → 0.127 bits por parámetro de constantes
  const q = await find('qlora-llama3-8b-r16');
  assert.ok(Math.abs(q.exp.nf4_accounting.const_bits_per_param_no_dq - 0.5) < 1e-12);
  assert.ok(Math.abs(q.exp.nf4_accounting.const_bits_per_param_dq - 0.127) < 1e-3);
  for (const k of ['metrics[baseWeightBytes]', 'metrics[baseWeightBytes4NoDQ]', 'metrics[quantConstBytes]']) assert.ok(q.checks.some((x) => x.what === k && x.ok), k);
  assert.ok(q.exp.notes.some((n) => /bitsandbytes no corre/.test(n)));
});

test('RLHF (PPO), DPO, GRPO y DPO + LoRA: un modelo HF por rol en meta (reward / crítico = SeqCls num_labels 1), costo del update medido, pérdidas en float64', async () => {
  for (const id of ['rlhf-llama3-8b', 'dpo-llama3-8b', 'grpo-llama3-8b', 'ppo-llama3-8b-lora', 'dpo-llama3-8b-lora']) {
    const r = await find(id);
    assert.ok(r, id + ' sin JSON');
    assert.ok(r.checks.every((c) => c.ok), id + ': ' + r.checks.filter((c) => !c.ok).map((c) => c.what).join(', '));
    assert.ok(r.checks.some((c) => c.what === 'metrics[policyTrainStepMacsPerSeq]' && c.ok), id);
    assert.ok(r.checks.filter((c) => c.what.startsWith('flops[') && c.ok).length >= 2, id + ' flops por rol');
  }
  const p = await find('rlhf-llama3-8b');
  assert.deepStrictEqual([p.exp.params_total, p.exp.params_by_node.reward, p.exp.params_by_node.critic], [31070380032, 7504928768, 7504928768]);
  assert.ok(p.checks.some((c) => c.what === 'metrics[criticTrainStepMacsPerSeq]' && c.ok));
  assert.deepStrictEqual([p.exp.shapes['reward-scores'], p.exp.shapes.reward, p.exp.shapes['critic-values']], [[1024, 1], [1], [1024, 1]]);
  const lc = p.checks.filter((c) => c.what.startsWith('loss['));
  assert.ok(lc.length >= 20 && lc.every((c) => c.ok), 'loss_checks');
  assert.deepStrictEqual([(await find('dpo-llama3-8b')).exp.sequences, (await find('grpo-llama3-8b')).exp.sequences], [2, 8]);
  const l = await find('dpo-llama3-8b-lora');
  assert.deepStrictEqual([l.exp.params_total, l.exp.params_by_node.reference], [8072204288, 0]);
  assert.ok(l.exp.notes.some((n) => /disable_adapter/.test(n)));
  const pl = await find('ppo-llama3-8b-lora');
  assert.strictEqual(pl.exp.params_by_node.reference, 0);
  for (const k of ['metrics[criticTrainStepMacsPerSeq]', 'metrics[trainableParams]']) assert.ok(pl.checks.some((c) => c.what === k && c.ok), k);
});
// ================================================================ fin del bloque de la fase 10

// ---------------------------------------------------------------- fase 11 (BERT, recuperación densa, ANN)
test('F11 BERT: HF BertForPreTraining en meta, decoder del MLM atado, reparto por módulo y T = 512', async () => {
  for (const [id, params, flops] of [['bert-base', 110106428, 2 * 14250149376], ['bert-large', 336226108, 2 * 43595859968]]) {
    const r = await find(id);
    assert.strictEqual(r.exp.params_total, params, id);
    assert.strictEqual(r.exp.flops_total, flops, id);
    assert.strictEqual(r.exp.tied_decoder, true, id);
    assert.match(r.exp.source.ctor, /BertForPreTraining\(BertConfig\(/);
    for (const w of ['params[embed]', 'params[encoder]', 'params[pooler]', 'params[mlm-head]', 'params[nsp-head]', 'flops[encoder]', 'flops[mlm-head]', 'flops[nsp-head]',
      '[T=512] flops_total', 'metrics[mlmTiedParams]', 'metrics[mlmHeadParams]']) {
      assert.ok(r.checks.some((c) => c.what === w && c.ok), id + ' ' + w);
    }
    assert.ok(r.exp.notes.some((n) => /gather_indexes/.test(n)));
  }
  const b = await find('bert-base');
  assert.deepStrictEqual(b.exp.shapes['mlm-logits'], [128, 30522]);
  assert.deepStrictEqual(b.exp.shapes.qkv, [128, 2304]);
});

test('F11 recuperación: DPR (dos torres), Sentence-BERT (siamés), cross-encoder, ColBERT; búsqueda y rerank medidos en meta', async () => {
  const d = await find('dpr-bert-base');
  assert.strictEqual(d.exp.params_total, 2 * 108891648 + 22713601);
  for (const w of ['params[query-encoder]', 'params[doc-encoder]', 'params[rerank]', 'flops[ann-search]', 'flops[rerank]', '[rerank=0] flops_total', 'metrics[bruteForceMacs]', 'metrics[crossEncoderMacsPerPair]']) {
    assert.ok(d.checks.some((c) => c.what === w && c.ok), 'dpr ' + w);
  }
  assert.deepStrictEqual(d.exp.shapes['doc-scores'], [21015324]);
  assert.deepStrictEqual(d.exp.shapes['rerank-scores'], [100, 1]);
  const s = await find('sbert-minilm');
  assert.strictEqual(s.exp.params_by_path['doc-encoder'], 0);
  assert.ok(s.checks.some((c) => c.what === 'params[doc-encoder]' && c.ok));
  const c = await find('cross-encoder-minilm');
  assert.strictEqual(c.exp.params_total, 22713601);
  assert.ok(c.checks.some((x) => x.what === '[Tq=16,Td=128] flops_total' && x.ok));
  const cb = await find('colbert-v2');
  assert.strictEqual(cb.exp.params_total, 109482240 + 768 * 128);
  assert.ok(cb.checks.some((x) => x.what === 'flops[maxsim]' && x.ok));
  assert.ok(cb.checks.some((x) => x.what === 'metrics[colbertV2BytesPerVector]' && x.ok));
});

test('F11 ANN: encoder DPR en meta + búsqueda; bytes y distancias contra índices FAISS reales (faiss-cpu)', async () => {
  for (const id of ['hnsw-1m-768', 'ivfpq-1m-768', 'flat-1m-768', 'ivfpq-1b-768']) {
    const r = await find(id);
    assert.match(r.exp.source.faiss, /^1\.15/, id);
    const faiss = r.checks.filter((c) => c.what.startsWith('faiss['));
    assert.ok(faiss.length >= 9, id + ': ' + faiss.length + ' comprobaciones de FAISS');
    assert.ok(faiss.every((c) => c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'flops[encode]' && c.ok), id);
  }
  const h = await find('hnsw-1m-768');
  assert.deepStrictEqual(h.exp.shapes.links, [1000000, 64]);                        // nb_neighbors(0) = 2M
  assert.ok(h.exp.range_checks.length >= 6);
  assert.deepStrictEqual([h.exp.faiss_measured.faiss_defaults.efConstruction, h.exp.faiss_measured.faiss_defaults.efSearch], [40, 16]);
  const p = await find('ivfpq-1m-768');
  assert.deepStrictEqual(p.exp.shapes.lut, [16, 96, 256]);
  assert.ok(p.checks.some((c) => c.what === 'metrics[precomputedTableBytes]' && c.ok));
  const b = await find('ivfpq-1b-768');
  assert.strictEqual(b.exp.metrics_checks.precomputedTableBytes, 0);                 // 2²⁰·96·256·4 B > 2 GiB: FAISS no la precalcula
});

// ---------------------------------------------------------------- fase 13
test('F13 two-tower y DLRM: módulos de PyTorch en meta desde las configs citadas; totales, módulos, FLOPs por operador y lote exactos', async () => {
  for (const id of ['two-tower-base', 'two-tower-small', 'two-tower-no-ids']) {
    const r = await find(id);
    assert.deepStrictEqual(r.exp.calc_overrides, { B: 1 }, id);
    assert.strictEqual(r.exp.batch_check.B, 4);
    for (const w of ['batch B=4 flops_total', 'batch B=4 shape[logits]', 'params[user-tower]', 'params[item-tower]', 'params[user-tower>mlp]', 'flops[user-tower]', 'flops[item-tower]',
      'metrics[embeddingParams]', 'metrics[userTowerMacs]', 'metrics[bruteForceMacs]']) assert.ok(r.checks.some((c) => c.what === w && c.ok), id + ' ' + w);
  }
  const b = await find('two-tower-base');
  assert.strictEqual(b.exp.params_total, 768189984);
  assert.strictEqual(b.exp.params_by_path['user-tower>hist-embed'], 0);                 // tabla de ítems compartida: se cuenta una vez
  assert.deepStrictEqual(b.exp.batch_check.shapes.logits, [4, 4]);
  for (const id of ['dlrm-criteo-kaggle', 'dlrm-mlperf', 'dlrm-dcnv2', 'wide-and-deep']) {
    const r = await find(id);
    assert.ok(r.checks.some((c) => c.what === 'params[embeddings]' && c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'flops[top-mlp]' && c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'metrics[embeddingParams]' && c.ok) && r.checks.some((c) => c.what === 'metrics[totalRows]' && c.ok), id);
    assert.ok(r.checks.filter((c) => c.what.startsWith('flops[aten.')).every((c) => c.ok), id);
  }
  const k = await find('dlrm-criteo-kaggle');
  assert.strictEqual(k.exp.params_total, 540677217);
  assert.strictEqual(k.exp.source.rows_sum, 33762577);
  assert.deepStrictEqual([k.exp.shapes.gram, k.exp.shapes.pairs, k.exp.shapes['top-in']], [[27, 27], [351], [367]]);
  assert.strictEqual(k.exp.metrics_checks.interactionMacs, 27 * 27 * 16);                // bmm de la matriz entera
  assert.ok(k.checks.some((c) => c.what === 'flops[aten.bmm]' && c.ok));
  const d = await find('dlrm-dcnv2');
  assert.strictEqual(d.exp.params_total, 26151671809);
  assert.strictEqual(d.exp.metrics_checks.lookupsPerSample, 214);
  assert.strictEqual(d.exp.params_by_node.interaction, 3 * (2 * 3456 * 512 + 3456));
  assert.match(d.exp.source.ctor, /'rank': 512/);
});

test('F13 GBDT: modelos reales de xgboost / lightgbm / catboost (N = 50,000); defaults, estructura, nodos medidos y bytes guardados', async () => {
  for (const id of ['xgboost-500-d6', 'lightgbm-500-l31', 'xgboost-2000-d8', 'catboost-oblivious-d6']) {
    const r = await find(id);
    assert.deepStrictEqual(r.exp.calc_overrides, { N: 50000 }, id);
    assert.strictEqual(r.exp.flops_total, 0, id);
    assert.ok(r.checks.some((c) => c.what === 'metrics[measuredNodes]' && c.ok), id);
    assert.ok(r.checks.some((c) => c.what === 'metrics[nTrees]' && c.ok), id);
    assert.ok(r.checks.some((c) => /^faiss\[bytes/.test(c.what) && c.ok), id + ': bytes del modelo guardado');
    assert.ok(r.exp.notes.some((n) => /FLOPs = 0/.test(n)), id);
  }
  const x = await find('xgboost-500-d6');
  assert.match(x.exp.source.xgboost, /^3\.4/);
  assert.deepStrictEqual([x.exp.defaults.max_bin, x.exp.defaults.max_depth_default, x.exp.defaults.lambda, x.exp.defaults.updater], [256, 6, 1, 'grow_quantile_histmaker']);
  assert.deepStrictEqual(x.exp.shapes.hist, [100, 257, 2]);                              // max_bin + 1 cortes por feature
  assert.ok(x.exp.params_real_total < x.exp.params_total);                                // XGBoost poda: el real queda bajo la cota llena
  const l = await find('lightgbm-500-l31');
  assert.deepStrictEqual([l.exp.defaults.num_leaves, l.exp.defaults.max_depth, l.exp.defaults.max_bin], ['31', '-1', '255']);
  assert.strictEqual(l.exp.params_real_total, l.exp.params_total);                        // 31 hojas en los 500 árboles
  assert.strictEqual(l.exp.measured.base_folded_into_tree_1, true);
  assert.ok(l.checks.some((c) => c.what === 'metrics[comparisonsMeasured]' && c.ok));
  const c = await find('catboost-oblivious-d6');
  assert.deepStrictEqual([c.exp.defaults.depth_default, c.exp.defaults.border_count, c.exp.defaults.grow_policy], [6, 254, 'SymmetricTree']);
  assert.strictEqual(c.exp.params_real_total, 500 * 70 + 1);
});
