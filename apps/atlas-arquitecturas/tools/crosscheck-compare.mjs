#!/usr/bin/env node
// Cross-check calculador ↔ PyTorch (SPEC §9.3).
//   node tools/crosscheck-compare.mjs            regenera crosscheck/expected/*.json con la venv
//                                                (si existe .venv) y compara con ATLAS.Arch.
//   node tools/crosscheck-compare.mjs --no-regen solo compara con los JSON versionados.
// Sale con código 1 si algo no coincide. Exporta compareAll() (lo usa tests/crosscheck.test.cjs).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = join(ROOT, 'crosscheck', 'expected');
const FILES = ['js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/arch/resnet.js', 'js/arch/swin.js', 'js/arch/clip.js', 'js/arch/detr.js',
  'js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/arch/llm.js', 'js/arch/vlm.js', 'js/arch/diffusion.js', 'js/arch/vla.js', 'js/arch/finetune.js', 'js/arch/retrieval.js', 'js/arch/encdec.js'];
export const FLOP_TOL = 0.005;   // 0.5 % (en la práctica la diferencia es 0)

export function loadArch(root = ROOT) {
  const ctx = vm.createContext({});
  for (const f of FILES) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('ATLAS.Arch', ctx);
}

const rel = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b));
const sumOps = (by, keys) => keys.reduce((s, k) => s + (by[k] || 0), 0);

// Compara una config; devuelve [{what, calc, ref, ok, note?}].
export function compareConfig(A, exp) {
  const out = [];
  const push = (what, calc, ref, ok, note) => out.push({ what, calc, ref, ok, note });
  // calc_overrides: knobs con los que corrió la referencia (CLIP: B = 1, el batch de PyTorch).
  const ov = exp.calc_overrides || {};
  const r = A.run(exp.config_id, ov);
  const t = r.totals;

  push('params_total', t.params, exp.params_total, t.params === exp.params_total);
  for (const [node, n] of Object.entries(exp.params_by_node || {})) {
    const c = t.byNode[node] ? t.byNode[node].params : null;
    push('params[' + node + ']', c, n, c === n);
  }
  // params_by_path: nodos que repiten id en dos lugares (torres de CLIP) se comparan por su ruta.
  for (const [key, n] of Object.entries(exp.params_by_path || {})) {
    const c = t.byPath[key] ? t.byPath[key].params : null;
    push('params[' + key + ']', c, n, c === n);
  }
  for (const [id, shape] of Object.entries(exp.shapes || {})) {
    const x = r.tensors[id];
    const c = x ? x.num.join('×') : '(sin tensor)';
    push('shape[' + id + ']', c, shape.join('×'), c === shape.join('×'));
  }
  // Conteos derivados (DETR): parámetros entrenables del código oficial (congela conv1 y layer1) y buffers de BN.
  if (exp.params_official_trainable !== undefined) {
    const c = r.quantities.trainableParams;
    push('params oficiales entrenables', c, exp.params_official_trainable, c === exp.params_official_trainable);
  }
  if (exp.buffers_total !== undefined && r.quantities.bnBuffers !== undefined) {
    push('buffers de BN', r.quantities.bnBuffers, exp.buffers_total, r.quantities.bnBuffers === exp.buffers_total);
  }
  const flopsOk = (calc, ref) => rel(calc, ref) <= FLOP_TOL;
  push('flops_total', t.flops, exp.flops_total, flopsOk(t.flops, exp.flops_total),
    'FlopCounterMode = 2 × MACs de matmuls/convs; diferencia ' + (100 * rel(t.flops, exp.flops_total)).toFixed(4) + ' %');
  if (exp.flops_total_fused_sdpa !== undefined) {
    push('flops_total (sdpa)', t.flops, exp.flops_total_fused_sdpa, flopsOk(t.flops, exp.flops_total_fused_sdpa));
  }
  // Desglose por operador aten ↔ primitivas del calculador.
  const by = exp.flops_by_op || {};
  const p = (k) => (t.byPrim[k] ? t.byPrim[k].macs : 0);
  if (Object.keys(by).length) {
    const conv = sumOps(by, ['aten.convolution']);
    // conv_bn y bottleneck (backbone de DETR como bloques compuestos) son convs.
    const convCalc = 2 * (p('conv2d') + p('conv_bn') + p('bottleneck'));
    if (conv || convCalc) push('flops[convolution]', convCalc, conv, convCalc === conv);
    const lin = sumOps(by, ['aten.addmm', 'aten.mm']);
    // mm incluye la matriz de similitud de CLIP (I·Tᵀ).
    const linCalc = 2 * (p('linear') + p('classifier_head') + p('similarity_logits'));
    push('flops[addmm+mm]', linCalc, lin, linCalc === lin);
    const att = sumOps(by, ['aten.bmm', 'aten.baddbmm', 'aten._scaled_dot_product_flash_attention_for_cpu',
      'aten._scaled_dot_product_efficient_attention', 'aten._scaled_dot_product_flash_attention', 'aten._scaled_dot_product_cudnn_attention']);
    push('flops[bmm/sdpa]', 2 * (p('attention_scores') + p('attention_weighted_sum')), att,
      2 * (p('attention_scores') + p('attention_weighted_sum')) === att);
  }
  // Deformable DETR: el muestreo (grid_sample + suma ponderada) no lo cuenta FlopCounterMode. El JSON trae
  // el analítico (con las formas reales de cada llamada) y lo contado por torch sin las cabezas auxiliares.
  if (exp.flops_sampling_analytic !== undefined) {
    const samp = 2 * (p('deform_sample') + p('deform_weighted_sum'));
    push('flops[muestreo deformable, analítico]', samp, exp.flops_sampling_analytic, samp === exp.flops_sampling_analytic);
    // Grounding DINO resta además los logits de las queries de contenido (encoder_logits, solo para la pérdida).
    const counted = exp.flops_counted_torch - (exp.flops_aux_heads_torch || 0) - (exp.flops_encoder_logits_torch || 0);
    push('flops contados por torch (sin cabezas aux.)', t.flops - samp, counted, t.flops - samp === counted);
  }
  // batch_check (CLIP): con batch B, PyTorch = B × (total del calculador con ese B), porque el
  // calculador cuenta por par (la similitud, B·E por par).
  const bc = exp.batch_check;
  if (bc) {
    const rb = A.run(exp.config_id, Object.assign({}, ov, { B: bc.B }));
    const calc = bc.B * rb.totals.flops;
    push('batch B=' + bc.B + ' flops_total', calc, bc.flops_total, flopsOk(calc, bc.flops_total), 'B × FLOPs por par');
    for (const [id, shape] of Object.entries(bc.shapes || {})) {
      const x = rb.tensors[id];
      const c = x ? x.num.join('×') : '(sin tensor)';
      push('batch B=' + bc.B + ' shape[' + id + ']', c, shape.join('×'), c === shape.join('×'));
    }
  }
  // windows (Swin): ventana efectiva, shift y tabla de sesgo de cada bloque de los pares (regla de timm).
  for (const w of exp.windows || []) {
    const st = (r.config.stages || [])[w.stage - 1];
    const tag = 'window[s' + w.stage + '-b' + w.block + ']';
    if (!st) { push(tag, null, w.window_size[0], false); continue; }
    const shift = w.block === 2 ? st.shift : 0;
    push(tag + ' M', st.M, w.window_size[0], st.M === w.window_size[0]);
    push(tag + ' shift', shift, w.shift_size[0], shift === w.shift_size[0]);
    push(tag + ' bias table', (2 * st.M - 1) * (2 * st.M - 1) + '×' + st.h, w.bias_table.join('×'), (2 * st.M - 1) * (2 * st.M - 1) + '×' + st.h === w.bias_table.join('×'));
    const hasMask = !!r.tensors['s' + w.stage + '-b' + w.block + '-masked'];
    push(tag + ' mask', hasMask, !!w.attn_mask, hasMask === !!w.attn_mask);
  }
  // Fase 4. flops_by_node: FLOPs de PyTorch por bloque (módulos de la referencia, ya con el muestreo deformable
  // analítico sumado y las cabezas auxiliares restadas) ↔ 2·MACs de los nodos del calculador ('a+b' = suma).
  for (const [key, ref] of Object.entries(exp.flops_by_node || {})) {
    const calc = 2 * key.split('+').reduce((s, k) => s + (t.byNode[k] ? t.byNode[k].macs : NaN), 0);
    push('flops[' + key + ']', calc, ref, calc === ref);
  }
  // flops_by_op_groups: operadores aten ↔ primitivas (solo modelos sin compuestas mixtas, p. ej. YOLO).
  for (const grp of exp.flops_by_op_groups || []) {
    const ref = sumOps(exp.flops_by_op_torch || {}, grp.ops);
    const calc = 2 * grp.prims.reduce((s, k) => s + p(k), 0);
    push('flops[' + grp.ops.join('+') + ']', calc, ref, calc === ref);
  }
  // override_checks: la misma referencia corrida con otro knob (T de Grounding DINO, V de YOLO-World).
  for (const oc of exp.override_checks || []) {
    const ro = A.run(exp.config_id, Object.assign({}, ov, oc.calc_overrides));
    const tag = Object.entries(oc.calc_overrides).map(([k, v]) => k + '=' + v).join(',');
    if (oc.params_total !== undefined) push('[' + tag + '] params_total', ro.totals.params, oc.params_total, ro.totals.params === oc.params_total);
    push('[' + tag + '] flops_total', ro.totals.flops, oc.flops_total, flopsOk(ro.totals.flops, oc.flops_total));
    // Fase 6 (LLM): el mismo forward con sdpa (la fórmula de sdpa de FlopCounterMode no tiene término causal).
    if (oc.flops_total_sdpa !== undefined) push('[' + tag + '] flops_total (sdpa)', ro.totals.flops, oc.flops_total_sdpa, flopsOk(ro.totals.flops, oc.flops_total_sdpa));
    for (const [id, shape] of Object.entries(oc.shapes || {})) {
      const x = ro.tensors[id];
      const c = x ? x.num.join('×') : '(sin tensor)';
      push('[' + tag + '] shape[' + id + ']', c, shape.join('×'), c === shape.join('×'));
    }
  }
  // swin_windows (Grounding DINO): ventana y shift de cada bloque del backbone Swin (HF SwinBackbone, always_partition).
  for (const w of exp.swin_windows || []) {
    const st = (r.config.stages || [])[w.stage - 1];
    const tag = 'swin[s' + w.stage + '-b' + w.block + ']';
    if (!st) { push(tag, null, w.window_size, false); continue; }
    const shift = w.block % 2 === 0 ? st.shift : 0;
    push(tag + ' M', r.config.M, w.window_size, r.config.M === w.window_size);
    push(tag + ' shift', shift, w.shift_size, shift === w.shift_size);
  }
  // v2 (YOLO-World): parámetros de yolov8l-worldv2.yaml ↔ quantities.v2Params (sin image-pooling attention, BN en la cabeza).
  if (exp.v2 && r.quantities.v2Params !== undefined) push('params v2 (' + exp.v2.yaml + ')', r.quantities.v2Params, exp.v2.params_total, r.quantities.v2Params === exp.v2.params_total);
  // Grounding DINO: crudo de HF (con la LayerNorm sin uso de SwinBackbone) ↔ quantities.paramsHF.
  if (exp.params_total_hf_raw !== undefined && r.quantities.paramsHF !== undefined) push('params HF crudos', r.quantities.paramsHF, exp.params_total_hf_raw, r.quantities.paramsHF === exp.params_total_hf_raw);
  // Fase 5 (SAM). sam_windows: ventanas con relleno del ViT; rel_pos_tables: filas de las tablas relativas (2S−1)×d_h.
  const sw = exp.sam_windows;
  if (sw) {
    const cf = r.config;
    push('sam[ventana M]', cf.M, sw.window_size, cf.M === sw.window_size);
    push('sam[ventanas con relleno]', cf.nW, sw.num_windows, cf.nW === sw.num_windows);
    push('sam[tokens con relleno]', cf.padTokens, sw.padded_tokens, cf.padTokens === sw.padded_tokens);
    push('sam[bloques globales]', cf.globals.join(','), sw.global_attn_indexes.join(','), cf.globals.join(',') === sw.global_attn_indexes.join(','));
  }
  if (exp.rel_pos_tables && r.quantities.relPosWinRows !== undefined) {
    const q = r.quantities, dh = r.config.dh;
    push('rel-pos[ventana]', q.relPosWinRows + '×' + dh, exp.rel_pos_tables.window.join('×'), q.relPosWinRows + '×' + dh === exp.rel_pos_tables.window.join('×'));
    push('rel-pos[global]', q.relPosGlobalRows + '×' + dh, exp.rel_pos_tables.global.join('×'), q.relPosGlobalRows + '×' + dh === exp.rel_pos_tables.global.join('×'));
  }
  // Fase 5 (SAM 2). hiera_blocks: ancho, ventana (0 = global) y q-pooling de cada bloque de Hiera ↔ los grupos del calculador.
  if (exp.hiera_blocks && r.config.stages) {
    const blocks = [];
    for (const st of r.config.stages) {
      for (const gr of st.groups) for (const i of gr.idx) blocks[i] = { dim: gr.inC, dim_out: st.C, window_size: gr.ws, q: gr.kind === 'q', heads: st.h };
    }
    for (const b of exp.hiera_blocks) {
      const c = blocks[b.block];
      const calc = c ? [c.dim, c.dim_out, c.window_size, c.q ? 'q' : '-', c.heads].join('/') : null;
      const ref = [b.dim, b.dim_out, b.window_size, b.query_stride ? 'q' : '-', b.heads].join('/');
      push('hiera[b' + b.block + '] dim/dim_out/ventana/q-pool/cabezas', calc, ref, calc === ref);
    }
  }
  if (exp.frame && r.config.Nm !== undefined) {
    push('sam2[tokens de memoria]', r.config.Nm, exp.frame.memory_tokens, r.config.Nm === exp.frame.memory_tokens);
    push('sam2[memorias espaciales]', r.config.nMem, exp.frame.spatial_memories, r.config.nMem === exp.frame.spatial_memories);
    push('sam2[punteros]', r.config.ptrs, exp.frame.object_pointers, r.config.ptrs === exp.frame.object_pointers);
  }
  if (exp.dead_matmul_check) push('sam2[producto descartado de HF, verificado con un forward parcheado]', exp.dead_matmul_check.image_features_minus_dead, exp.dead_matmul_check.image_features_patched, !!exp.dead_matmul_check.ok);
  // Fase 6 (LLM). metrics_checks: métricas del calculador ↔ valores medidos en PyTorch (bytes de la KV cache por token
  // leídos de la DynamicCache de HF en bf16, parámetros activos de Mixtral contados sobre los módulos de expertos).
  if (exp.metrics_checks) {
    const m = A.metrics(exp.config_id, ov);
    for (const [k, ref] of Object.entries(exp.metrics_checks)) push('metrics[' + k + ']', m[k], ref, m[k] === ref);
  }
  // moe_impl_check (Mixtral diminuto con pesos reales): experts eager (bucle por experto) = batched_mm en FlopCounterMode.
  if (exp.moe_impl_check) push('moe[eager = batched_mm en FlopCounterMode]', exp.moe_impl_check.flops.batched_mm, exp.moe_impl_check.flops.eager, !!exp.moe_impl_check.eager_equals_batched_mm);
  // Fase 7 (VLM). anyres_checks: tokens de LLaVA-NeXT con la regla de HF (LlavaNextProcessor) ↔ ATLAS.Arch.vlm.llavaNextTokens;
  // smart_resize_checks: smart_resize de Qwen2VLImageProcessor ↔ ATLAS.Arch.vlm.smartResize (lados múltiplos de 28).
  for (const a of exp.anyres_checks || []) {
    const c = A.vlm.llavaNextTokens(a.H, a.W).tokens;
    push('anyres[' + a.H + '×' + a.W + '] tokens', c, a.tokens, c === a.tokens);
  }
  for (const a of exp.smart_resize_checks || []) {
    // min_pixels / max_pixels opcionales: el presupuesto con el que corrió la referencia (si faltan, el del checkpoint)
    const o = a.max_pixels !== undefined ? { minPixels: a.min_pixels, maxPixels: a.max_pixels } : undefined;
    const z = A.vlm.smartResize(a.h, a.w, o), c = z.H + '×' + z.W, ref = a.H + '×' + a.W;
    push('smart_resize[' + a.h + '×' + a.w + (o ? ', ' + o.minPixels + '–' + o.maxPixels + ' px' : '') + ']', c, ref, c === ref);
  }
  // Fase 8 (difusión). schedule_checks: ᾱ_t del scheduler de SD en diffusers (float32) ↔ ATLAS.Arch.diffusion.alphasCumprod
  // (float64; tolerancia relativa 1e-5), pasos de DDIM ↔ ddimTimesteps (exactos) y evaluaciones de PNDM ↔ pndmNfe.
  const sch = exp.schedule_checks;
  if (sch && A.diffusion) {
    const c = r.config;
    const ab = A.diffusion.alphasCumprod(c.betaSchedule, c.trainSteps, c.betaStart, c.betaEnd);
    for (const [t, ref] of Object.entries(sch.alphas_cumprod || {})) push('schedule[ᾱ_' + t + ']', ab[+t], ref, rel(ab[+t], ref) <= 1e-5);
    for (const [n, ref] of Object.entries(sch.ddim_timesteps || {})) {
      const calc = A.diffusion.ddimTimesteps(+n, c.trainSteps, 1).join(',');
      push('schedule[ddim ' + n + ' pasos]', calc, ref.join(','), calc === ref.join(','));
    }
    for (const [n, ref] of Object.entries(sch.pndm_nfe || {})) push('schedule[pndm ' + n + ' pasos: NFE]', A.diffusion.pndmNfe(+n), ref, A.diffusion.pndmNfe(+n) === ref);
  }
  // Fase 10 (LoRA / RLHF). metrics_override_checks: métricas con otros knobs (gradient checkpointing, T) ↔ lo medido con
  // loss.backward() bajo FlopCounterMode. loss_checks: fórmulas de ATLAS.Arch.finetune ↔ torch float64 (tolerancia 1e-9).
  for (const mo of exp.metrics_override_checks || []) {
    const m = A.metrics(exp.config_id, Object.assign({}, ov, mo.calc_overrides));
    const tag = Object.entries(mo.calc_overrides).map(([k, v]) => k + '=' + v).join(',');
    for (const [k, ref] of Object.entries(mo.metrics)) push('[' + tag + '] metrics[' + k + ']', m[k], ref, m[k] === ref);
  }
  const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  for (const lc of exp.loss_checks || []) {
    const fn = A.finetune && A.finetune[lc.fn];
    if (!fn) { push('loss[' + lc.fn + ']', null, lc.fn, false, 'sin la función en ATLAS.Arch.finetune'); continue; }
    const res = fn.apply(null, lc.args);
    const tag = 'loss[' + lc.fn + '(' + JSON.stringify(lc.args).slice(0, 60) + ')]';
    if (lc.out.list) {
      push(tag, res.map((x) => x.toFixed(12)).join(','), lc.out.list.map((x) => x.toFixed(12)).join(','), res.length === lc.out.list.length && res.every((x, i) => near(x, lc.out.list[i])));
      continue;
    }
    for (const [k, ref] of Object.entries(lc.out)) {
      const v = res[k];
      const ok = Array.isArray(ref) ? Array.isArray(v) && v.length === ref.length && v.every((x, i) => near(x, ref[i])) : near(v, ref);
      push(tag + '.' + k, Array.isArray(v) ? v.join(',') : v, Array.isArray(ref) ? ref.join(',') : ref, ok);
    }
  }
  for (const ac of exp.activation_checks || []) {
    const v = A.finetune.activationPerTokenLayer(ac.args).total;
    push('activaciones[' + ac.case + '] bytes por token y capa', v, ac.measured_bytes_per_token_layer, v === ac.measured_bytes_per_token_layer);
  }
  // Fase 11 (ANN). ann_checks: fórmulas de bytes del calculador (A.flat_bytes / hnsw_bytes / ivfpq_bytes con los mismos N, d, M,
  // n_list, m, nbits) ↔ lo medido en índices FAISS reales chicos (arreglos internos y serialize_index), tolerancia relativa `tol`
  // (0 = exacto; los enlaces de HNSW son una esperanza: 1 %). range_checks: una métrica del calculador con otros knobs ↔ lo medido
  // por FAISS (distancias por query): ref / calc dentro de [min_ratio, max_ratio] (la cota ≈ de HNSW).
  for (const ac of exp.ann_checks || []) {
    const fn = A[ac.fn];
    if (typeof fn !== 'function') { push('faiss[' + ac.what + ']', null, ac.ref, false, 'sin A.' + ac.fn); continue; }
    const v = fn(ac.args)[ac.key];
    push('faiss[' + ac.what + ']', v, ac.ref, ac.tol ? rel(v, ac.ref) <= ac.tol : v === ac.ref);
  }
  for (const rc of exp.range_checks || []) {
    const v = A.metrics(exp.config_id, Object.assign({}, ov, rc.calc_overrides))[rc.metric];
    const ratio = rc.ref / v;
    push('faiss[' + rc.what + '] = ' + ratio.toFixed(3), v, rc.ref, ratio >= rc.min_ratio && ratio <= rc.max_ratio, 'rango [' + rc.min_ratio + ', ' + rc.max_ratio + ']');
  }
  // Fase 12 (T5). bucket_checks: buckets de posición relativa de HF (T5Attention._relative_position_bucket, CPU) para cada
  // posición relativa de range[0] … range[1] ↔ A.t5RelativeBucket, uno por uno.
  for (const bc of exp.bucket_checks || []) {
    const calc = [];
    for (let rel = bc.range[0]; rel <= bc.range[1]; rel++) calc.push(A.t5RelativeBucket(rel, bc.bidirectional, bc.buckets, bc.max_distance));
    const bad = calc.findIndex((v, i) => v !== bc.ref[i]);
    push('buckets T5 [' + bc.what + '] ' + bc.range.join('…'), bad < 0 ? calc.length + ' iguales' : 'rel ' + (bc.range[0] + bad) + ' → ' + calc[bad], bad < 0 ? calc.length + ' iguales' : bc.ref[bad], bad < 0 && calc.length === bc.ref.length);
  }
  const hf = exp.alt && exp.alt.hf;
  if (hf) {
    push('hf params_total', t.params, hf.params_total, t.params === hf.params_total);
    push('hf flops_total', t.flops, hf.flops_total, flopsOk(t.flops, hf.flops_total));
  }
  return out;
}

export function compareAll(root = ROOT) {
  const A = loadArch(root);
  const dir = join(root, 'crosscheck', 'expected');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const results = [];
  const seen = new Set();
  for (const f of files) {
    const exp = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    seen.add(exp.config_id);
    if (!A.hasConfig(exp.config_id)) {
      results.push({ configId: exp.config_id, checks: [{ what: 'config', calc: null, ref: exp.config_id, ok: false, note: 'config desconocida para el calculador' }] });
      continue;
    }
    results.push({ configId: exp.config_id, checks: compareConfig(A, exp), exp });
  }
  for (const c of A.configs()) {
    if (!seen.has(c.id)) results.push({ configId: c.id, checks: [{ what: 'expected json', calc: c.id, ref: null, ok: false, note: 'falta crosscheck/expected/' + c.id + '.json' }] });
  }
  return results;
}

function regenerate() {
  const py = join(ROOT, '.venv', 'bin', 'python');
  if (!existsSync(py)) {
    console.log('No hay .venv: comparo solo con los JSON versionados (python3.13 -m venv .venv && .venv/bin/pip install -r crosscheck/requirements.txt).');
    return true;
  }
  for (const script of ['transformer.py', 'vit.py', 'resnet.py', 'swin.py', 'clip.py', 'detr.py', 'grounding_dino.py', 'yolo_world.py', 'sam.py', 'llm.py', 'vlm.py', 'diffusion.py', 'vla.py', 'finetune.py', 'retrieval.py', 'encdec.py']) {
    console.log('▸ .venv/bin/python crosscheck/' + script);
    const r = spawnSync(py, [script], { cwd: join(ROOT, 'crosscheck'), stdio: 'inherit', env: Object.assign({}, process.env, { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', YOLO_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' }) });
    if (r.status !== 0) { console.error('Falló crosscheck/' + script); return false; }
  }
  return true;
}

const fmtN = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));

function main() {
  const regen = !process.argv.includes('--no-regen');
  if (regen && !regenerate()) process.exit(1);
  const results = compareAll();
  let bad = 0;
  for (const r of results) {
    const fails = r.checks.filter((c) => !c.ok);
    bad += fails.length;
    const head = r.checks.find((c) => c.what === 'params_total');
    const fl = r.checks.find((c) => c.what === 'flops_total');
    console.log((fails.length ? '✗ ' : '✓ ') + r.configId.padEnd(18) +
      (head ? ' params calc ' + fmtN(head.calc) + ' / torch ' + fmtN(head.ref) : '') +
      (fl ? ' · FLOPs calc ' + fmtN(fl.calc) + ' / torch ' + fmtN(fl.ref) + ' (' + (100 * rel(fl.calc, fl.ref)).toFixed(4) + ' %)' : '') +
      ' · ' + r.checks.length + ' comprobaciones');
    for (const f of fails) console.log('    ✗ ' + f.what + ': calc ' + fmtN(f.calc) + ' ≠ ref ' + fmtN(f.ref) + (f.note ? ' — ' + f.note : ''));
  }
  console.log(bad ? '\n' + bad + ' diferencias.' : '\nTodo coincide.');
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
