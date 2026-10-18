// Genera el formulario de estimaciones (C01) como HTML con fórmulas en TeX (data-tex) y gráficas SVG a escala.
// Uso: node gen.mjs <salida.html>   → después render.mjs convierte el TeX a MathML estático con Chrome.
import { writeFileSync } from 'node:fs';

const T = String.raw;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const n = (x, d = 0) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- SVG
const svg = (w, h, body, label, cls = '') => `<svg class="chart ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;
const txt = (x, y, s, cls = 't', anchor = 'start', extra = '') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}" ${extra}>${s}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(h)}" class="${cls}" ${extra}/>`;
const DEFS = `<defs>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="f-paper"/><line x1="0" y1="0" x2="0" y2="6" class="s-muted" stroke-width="2"/></pattern>
  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="f-muted"/></marker>
</defs>`;

// 1 · Tráfico: curva diaria con promedio 115.7 y pico 347.2 (factor 3) sobre una forma de dos jorobas.
function trafficChart() {
  const W = 600, H = 280, L = 48, R = 150, Tp = 14, B = 36;
  const x = (h) => L + (h / 24) * (W - L - R);
  const y = (v) => Tp + (1 - v / 560) * (H - Tp - B);
  const g = (h) => 0.12 + 0.95 * Math.exp(-(((h - 10) / 2.4) ** 2)) + 0.8 * Math.exp(-(((h - 20.3) / 2.1) ** 2)) + 0.42 * Math.exp(-(((h - 14.6) / 2.6) ** 2));
  const hs = Array.from({ length: 97 }, (_, i) => i / 4);
  const gv = hs.map(g);
  const mean = gv.slice(0, 96).reduce((a, b) => a + b, 0) / 96, max = Math.max(...gv);
  const a = (347.2 - 115.74) / (max - mean), b = 115.74 - a * mean;
  const v = gv.map((q) => a * q + b);
  const pts = hs.map((h, i) => `${r1(x(h))},${r1(y(v[i]))}`).join(' ');
  let s = DEFS;
  for (const t of [0, 100, 200, 300, 400, 500]) s += line(L, y(t), W - R, y(t), 'grid') + txt(L - 6, y(t) + 4, n(t), 't', 'end');
  for (const h of [0, 6, 12, 18, 24]) s += txt(x(h), H - B + 22, h + ' h', 't', h === 0 ? 'start' : 'middle');
  s += `<polygon points="${r1(x(0))},${r1(y(0))} ${pts} ${r1(x(24))},${r1(y(0))}" class="f-accent-soft"/>`;
  s += `<polyline points="${pts}" class="s-accent" fill="none" stroke-width="2.5"/>`;
  s += line(L, y(115.74), W - R, y(115.74), 'l-dash') + txt(W - R + 8, y(115.74) + 4, 'λ̄ ≈ 116 promedio', 'tl');
  s += line(L, y(347.2), W - R, y(347.2), 'l-accent2') + txt(W - R + 8, y(347.2) + 4, 'λ pico ≈ 350 (×3)', 'tl');
  s += line(L, y(500), W - R, y(500), 'l-hi') + txt(W - R + 8, y(500) + 4, 'λ diseño = 500 (×1.4)', 'tl tb');
  s += txt(x(3.2), y(282), 'área bajo la curva', 't', 'middle') + txt(x(3.2), y(256), '= 10 M requests', 't tb', 'middle') + `<path d="M${r1(x(3.6))},${r1(y(236))} L${r1(x(5.2))},${r1(y(60))}" class="s-muted" fill="none" stroke-width="1.2" marker-end="url(#arr)"/>`;
  s += txt(14, Tp + 6, 'req/s', 't', 'start');
  return svg(W, H, s, 'Curva de tráfico de un día: promedio 116 req/s, pico 350 y pico de diseño 500');
}

// 2 · Presupuesto de latencia: barra apilada con los p99 de C01 (cotas altas) contra el SLO de 200 ms.
const HOPS = [
  ['ALB + routing', 10, 'c1'], ['Leer el body', 30, 'c2'], ['Decode + resize + crop', 50, 'c3'], ['Normalizar → tensor', 2, 'c4'],
  ['Hop gateway → Triton', 10, 'c5'], ['Cola de batching', 2, 'c1'], ['Cómputo GPU', 15, 'c2'], ['Postproceso + JSON', 3, 'c4'], ['Overhead de Python', 30, 'c5'],
];
function latencyChart() {
  const W = 620, H = 120, L = 14, R = 14, sc = (W - L - R) / 200, Y = 34, BH = 36;
  let s = DEFS, x0 = L, sum = 0;
  for (const [, ms, c] of HOPS) { s += rect(x0, Y, ms * sc, BH, 'f-' + c); s += `<line x1="${r1(x0 + ms * sc)}" y1="${Y}" x2="${r1(x0 + ms * sc)}" y2="${Y + BH}" class="s-paper" stroke-width="1.5"/>`; x0 += ms * sc; sum += ms; }
  s += rect(x0, Y, (200 - sum) * sc, BH, '', 'fill="url(#hatch)"');
  s += txt(x0 + ((200 - sum) * sc) / 2, Y + BH / 2 + 4, 'margen ≈ 48', 'tl tb', 'middle');
  for (const t of [0, 50, 100, 150, 200]) s += line(L + t * sc, Y + BH + 4, L + t * sc, Y + BH + 10, 'ax') + txt(L + t * sc, Y + BH + 24, t + ' ms', 't', t === 0 ? 'start' : t === 200 ? 'end' : 'middle');
  s += line(L + 200 * sc, Y - 12, L + 200 * sc, Y + BH + 4, 'l-hi') + txt(L + 200 * sc, Y - 16, 'SLO p99 = 200 ms', 'tl tb', 'end');
  s += txt(L, Y - 16, 'Σ p99 de los tramos ≈ 152 ms', 'tl', 'start');
  return svg(W, H, s, 'Presupuesto de latencia: suma de p99 por tramo de 152 ms contra un SLO de 200 ms');
}
const latencyLegend = () => `<ul class="legend">${HOPS.map(([k, ms, c]) => `<li><i class="sw f-${c}"></i>${k} <b>${ms}</b></li>`).join('')}<li><i class="sw hatch"></i>margen <b>≈ 48</b></li></ul>`;

// 3 · GPUs: curva W/S = 1/(1−ρ) y la carga real de cada GPU.
function queueChart() {
  const W = 330, H = 250, L = 40, R = 16, Tp = 16, B = 40;
  const x = (r) => L + r * (W - L - R), y = (v) => Tp + (1 - v / 12) * (H - Tp - B);
  let s = DEFS;
  s += rect(x(0.5), Tp, x(0.7) - x(0.5), H - Tp - B, 'f-accent-soft');
  s += txt((x(0.5) + x(0.7)) / 2, Tp + 12, 'planeas aquí', 't tb', 'middle');
  for (const t of [0, 2, 4, 6, 8, 10]) s += line(L, y(t), W - R, y(t), 'grid') + txt(L - 6, y(t) + 4, t + '×', 't', 'end');
  for (const t of [0, 0.25, 0.5, 0.75, 1]) s += txt(x(t), H - B + 18, n(t * 100) + ' %', 't', 'middle');
  const pts = []; for (let r = 0; r <= 0.917; r += 0.005) pts.push(`${r1(x(r))},${r1(y(1 / (1 - r)))}`);
  s += `<polyline points="${pts.join(' ')}" class="s-accent" fill="none" stroke-width="2.5"/>`;
  for (const [r, lab] of [[0.5, '2×'], [0.7, '3.3×'], [0.9, '10×']]) s += `<circle cx="${r1(x(r))}" cy="${r1(y(1 / (1 - r)))}" r="4.5" class="f-hi s-ink"/>` + txt(x(r) - 8, y(1 / (1 - r)) - 4, lab, 'tl tb', 'end');
  s += txt(L + 2, H - 6, 'ρ = utilización', 't', 'start') + txt(14, Tp + 4, 'W/S', 't', 'start');
  return svg(W, H, s, 'Tiempo en el sistema relativo al de servicio contra utilización: 2 veces a 50 %, 3.3 a 70 %, 10 a 90 %');
}
function loadChart() {
  const W = 330, H = 190, L = 112, R = 40, Tp = 22;
  const x = (u) => L + u * (W - L - R);
  const rows = [['Promedio', 0.048, 'f-accent2'], ['Pico de diseño', 0.208, 'f-accent'], ['Si cae una GPU', 0.417, 'f-warn']];
  let s = DEFS + line(x(0.5), Tp - 10, x(0.5), Tp + 3 * 44 - 10, 'l-hi') + txt(x(0.5), Tp + 3 * 44 + 6, 'ρ obj = 50 %', 't tb', 'middle');
  rows.forEach(([lab, u, c], i) => { const yy = Tp + i * 44; s += txt(L - 8, yy + 16, lab, 'tl', 'end') + rect(L, yy, x(u) - L, 24, c) + txt(x(u) + 6, yy + 16, n(u * 100) + ' %', 'tl tb halo'); });
  for (const t of [0, 0.25, 0.5, 0.75]) s += txt(x(t), H - 4, n(t * 100) + ' %', 't', 'middle');
  return svg(W, H, s, 'Carga por GPU respecto al máximo medido: 5 % en promedio, 21 % en el pico de diseño, 42 % si cae una GPU');
}

// 4 · ¿Y sin GPU?: costo mensual facturado.
function cpuOnlyChart() {
  const W = 600, H = 150, L = 190, R = 70, Tp = 18;
  const x = (v) => L + (v / 900) * (W - L - R);
  let s = DEFS;
  for (const t of [0, 300, 600, 900]) s += line(x(t), Tp - 6, x(t), H - 26, 'grid') + txt(x(t), H - 8, 'US$' + n(t), 't', 'middle');
  s += txt(L - 10, Tp + 18, '2 × T4 (N+1, 24/7)', 'tl', 'end') + rect(L, Tp, x(768) - L, 28, 'f-accent') + txt(x(768) + 6, Tp + 18, '≈ US$768', 'tl tb');
  s += txt(L - 10, Tp + 66, 'CPU INT8 que sigue la curva', 'tl', 'end') + rect(L, Tp + 48, x(125) - L, 28, 'f-accent2') + rect(x(125), Tp + 48, x(250) - x(125), 28, 'f-accent2-soft') + txt(x(250) + 6, Tp + 66, '≈ US$125–250', 'tl tb');
  return svg(W, H, s, 'Costo mensual: dos T4 cuestan unos 768 dólares; CPU INT8 que sigue la curva diaria, 125 a 250');
}

// 5 · VRAM: la T4 de 16 GB y un zoom de los ≈ 1.5 GB usados.
function vramChart() {
  const W = 620, H = 234, L = 14, R = 14;
  const X = (gb) => L + (gb / 16) * (W - L - R);
  const z0 = 60, zW = W - L - R - 60, Z = (gb) => L + z0 / 2 + (gb / 1.6) * zW;
  const segs = [['Contexto CUDA + libs', 0.55, 'f-c5'], ['Instancia 1: engine', 0.1, 'f-c1'], ['activaciones b=32', 0.35, 'f-c2'], ['entrada', 0.02, 'f-c3'], ['Instancia 2 (duplicada)', 0.47, 'f-c4']];
  let s = DEFS, acc = 0;
  s += txt(L, 16, 'T4 · 16 GB', 'tl tb') ;
  for (const [, gb, c] of segs) { s += rect(X(acc), 24, X(acc + gb) - X(acc), 30, c); acc += gb; }
  s += rect(X(acc), 24, X(16) - X(acc), 30, 'f-free');
  s += txt((X(acc) + X(16)) / 2, 44, `libre ≈ ${n(16 - acc, 1)} GB`, 'tl', 'middle');
  for (const t of [0, 4, 8, 12, 16]) s += txt(X(t), 70, t + ' GB', 't', t === 0 ? 'start' : t === 16 ? 'end' : 'middle');
  // zoom
  s += `<path d="M${r1(X(0))},78 L${r1(Z(0))},118 M${r1(X(acc))},78 L${r1(Z(acc))},118" class="s-muted" fill="none" stroke-dasharray="3 3"/>`;
  acc = 0; let i = 0;
  for (const [lab, gb, c] of segs) { const xa = Z(acc), xb = Z(acc + gb); s += rect(xa, 118, xb - xa, 34, c); const mid = (xa + xb) / 2; const yy = 170 + (i % 2) * 30; s += line(mid, 152, mid, yy - 12, 'ax') + txt(mid, yy, lab, 't', 'middle') + txt(mid, yy + 13, (gb < 0.05 ? n(gb * 1000) + ' MB' : n(gb, 2) + ' GB'), 't tb', 'middle'); acc += gb; i++; }
  s += txt(Z(acc) + 8, 140, `≈ ${n(acc, 1)} GB`, 'tl tb');
  return svg(W, H, s, 'Memoria de una T4: unos 1.5 GB usados de 16 GB, con zoom del contexto CUDA y de las dos instancias del modelo');
}

// 6 · CPU para preprocesamiento: el pipeline y quién se come la CPU en la mezcla.
function prepChart() {
  const W = 620, H = 210;
  const boxes = [['JPEG', '≈ 200 KB'], ['decode', 'draft mode'], ['resize 256', 'crop 224'], ['normalizar', 'CHW FP32'], ['tensor', '602 KB']];
  let s = DEFS; const bw = 100, gap = (W - 28 - 5 * bw) / 4;
  boxes.forEach(([a, b], i) => { const x0 = 14 + i * (bw + gap); s += rect(x0, 14, bw, 46, i === 4 ? 'f-hi-soft s-hi' : 'f-paper s-rule', 'rx="6"') + txt(x0 + bw / 2, 33, a, 'tl tb', 'middle') + txt(x0 + bw / 2, 50, b, 't', 'middle'); if (i < 4) s += `<line x1="${r1(x0 + bw + 3)}" y1="37" x2="${r1(x0 + bw + gap - 4)}" y2="37" class="s-muted" stroke-width="1.6" marker-end="url(#arr)"/>`; });
  const Lb = 14, Wb = W - 28, Y = 110;
  s += txt(Lb, Y - 10, 'CPU por imagen en la mezcla (originales: 85 % móvil ≈ 5 ms · 15 % web ≈ 60 ms)', 'tl', 'start');
  s += rect(Lb, Y, Wb * 0.32, 34, 'f-accent2') + rect(Lb + Wb * 0.32, Y, Wb * 0.68, 34, 'f-warn');
  s += txt(Lb + Wb * 0.16, Y + 22, '85 % de las fotos → 32 %', 'tw', 'middle') + txt(Lb + Wb * 0.66, Y + 22, '15 % de las fotos → 68 % de la CPU', 'tw', 'middle');
  s += txt(Lb, Y + 58, '0.85 × 5 ms = 4.25 ms', 't', 'start') + txt(Lb + Wb, Y + 58, '0.15 × 60 ms = 9 ms', 't', 'end');
  s += txt(W / 2, Y + 84, 'total ≈ 13.25 ms por imagen: el promedio lo dominan las fotos grandes', 'tl tb', 'middle');
  return svg(W, H, s, 'Pipeline de preprocesamiento y reparto de la CPU: el 15 % de fotos web consume el 68 %');
}

// 7 · Red entre tiers: Gb/s a 500 req/s según lo que viaja.
function netChart() {
  const W = 560, H = 270, L = 46, R = 150, Tp = 16, B = 52;
  const bars = [['JPEG móvil', '200 KB', 0.8, 'f-accent2'], ['Tensor FP32', '602 KB', 2.41, 'f-warn'], ['FP16', '301 KB', 1.2, 'f-accent'], ['UINT8', '150 KB', 0.6, 'f-accent']];
  const y = (v) => Tp + (1 - v / 3.5) * (H - Tp - B);
  const slot = (W - L - R) / bars.length;
  let s = DEFS;
  for (const t of [0, 1, 2, 3]) s += line(L, y(t), W - R, y(t), 'grid') + txt(L - 6, y(t) + 4, t, 't', 'end');
  bars.forEach(([a, kb, v, c], i) => { const x0 = L + i * slot + slot * 0.18, bw = slot * 0.64; s += rect(x0, y(v), bw, y(0) - y(v), c) + txt(x0 + bw / 2, y(v) - 6, n(v, 1), 'tl tb', 'middle') + txt(x0 + bw / 2, H - B + 18, a, 'tl', 'middle') + txt(x0 + bw / 2, H - B + 33, kb, 't', 'middle'); });
  s += line(L, y(1.56), W - R, y(1.56), 'l-hi') + txt(W - R + 8, y(1.56) + 4, '1 nodo c6i.xlarge', 'tl') + txt(W - R + 8, y(1.56) + 18, 'baseline 1.56 Gb/s', 't');
  s += line(L, y(3.12), W - R, y(3.12), 'l-dash') + txt(W - R + 8, y(3.12) + 4, '2 nodos: 3.12 Gb/s', 't');
  s += txt(12, Tp + 4, 'Gb/s', 't', 'start');
  return svg(W, H, s, 'Ancho de banda a 500 req/s: JPEG 0.8 Gb/s, tensor FP32 2.4, FP16 1.2, UINT8 0.6');
}

// 8 · Costo mensual: barra apilada contra el presupuesto de US$3k.
const COST = [['GPUs (2 × g4dn.xlarge)', 768, 'c1'], ['ALB (hora + GB)', 503, 'c3'], ['Gateway (2 × c6i.xlarge)', 248, 'c2'], ['Logs, métricas, S3', 100, 'c4'], ['EKS', 73, 'c5'], ['EBS, NAT, transferencia', 58, 'c4']];
function costChart() {
  const W = 620, H = 120, L = 14, R = 14, sc = (W - L - R) / 3000, Y = 34;
  let s = DEFS, x0 = L, sum = 0;
  for (const [, v, c] of COST) { s += rect(x0, Y, v * sc, 36, 'f-' + c); s += `<line x1="${r1(x0 + v * sc)}" y1="${Y}" x2="${r1(x0 + v * sc)}" y2="${Y + 36}" class="s-paper" stroke-width="1.5"/>`; x0 += v * sc; sum += v; }
  s += rect(x0, Y, 250 * sc, 36, 'f-accent2-soft') + rect(x0 + 250 * sc, Y, 250 * sc, 36, '', 'fill="url(#hatch)"');
  s += txt(x0 + 250 * sc, Y - 8, 'etiquetado US$250–500', 't', 'middle');
  s += txt(L, Y - 8, 'infra ≈ US$1.75k', 'tl tb', 'start');
  for (const t of [0, 1000, 2000, 3000]) s += line(L + t * sc, Y + 40, L + t * sc, Y + 46, 'ax') + txt(L + t * sc, Y + 60, 'US$' + n(t), 't', t === 0 ? 'start' : t === 3000 ? 'end' : 'middle');
  s += line(L + 3000 * sc, Y - 18, L + 3000 * sc, Y + 40, 'l-hi') + txt(L + 3000 * sc - 4, Y - 20, 'presupuesto US$3k', 'tl tb', 'end');
  return svg(W, H, s, 'Costo mensual de C01: infraestructura cerca de 1,750 dólares más etiquetado, contra un presupuesto de 3,000');
}
const costLegend = () => `<ul class="legend">${COST.map(([k, v, c]) => `<li><i class="sw f-${c}"></i>${k} <b>≈ US$${n(v)}</b> <span class="pct">${n((v / 1750) * 100)} %</span></li>`).join('')}</ul>`;

// 9 · Backfill: horas contra máquinas; las GPU-horas no cambian.
function backfillChart() {
  const W = 600, H = 260, L = 46, R = 190, Tp = 16, B = 40;
  const x = (k) => L + ((k - 1) / 9) * (W - L - R), y = (h) => Tp + (1 - h / 60) * (H - Tp - B);
  let s = DEFS;
  for (const t of [0, 15, 30, 45, 60]) s += line(L, y(t), W - R, y(t), 'grid') + txt(L - 6, y(t) + 4, t + ' h', 't', 'end');
  for (let k = 1; k <= 10; k++) s += txt(x(k), H - B + 18, k, 't', 'middle');
  const pts = []; for (let k = 1; k <= 10; k += 0.05) pts.push(`${r1(x(k))},${r1(y(55.6 / k))}`);
  s += `<polyline points="${pts.join(' ')}" class="s-accent" fill="none" stroke-width="2.5"/>`;
  for (const k of [1, 2, 4, 8]) s += `<circle cx="${r1(x(k))}" cy="${r1(y(55.6 / k))}" r="${k === 4 ? 6 : 4}" class="${k === 4 ? 'f-hi s-ink' : 'f-accent'}"/>` + txt(x(k) + 9, y(55.6 / k) - 6, `${n(55.6 / k, 1)} h`, k === 4 ? 'tl tb' : 't');
  s += txt(L + 4, H - 6, 'n = máquinas (1 T4 cada una)', 't', 'start');
  const bx = W - R + 18;
  s += txt(bx, Tp + 24, 'n · T = GPU-horas', 'tl tb') + txt(bx, Tp + 42, '= 200 M ÷ 1,000 img/s', 't') + txt(bx, Tp + 58, '≈ 55.6 GPU-h siempre', 't');
  s += txt(bx, Tp + 92, '× US$0.752/h', 't') + txt(bx, Tp + 110, '≈ US$42 con 1, 4 u 8', 'tl tb');
  s += txt(bx, Tp + 144, 'Más máquinas:', 't') + txt(bx, Tp + 160, 'menos horas,', 't') + txt(bx, Tp + 176, 'mismo costo.', 'tl tb');
  return svg(W, H, s, 'Horas del backfill contra número de máquinas: 55.6 con una, 13.9 con cuatro; las GPU-horas no cambian');
}

// La cadena: de qué depende cada número.
function chainDiagram() {
  const W = 1000, H = 310;
  const box = (x0, y0, w, a, b, cls = 'f-paper s-rule') => rect(x0, y0, w, 44, cls, 'rx="7"') + txt(x0 + w / 2, y0 + 19, a, 'tl tb', 'middle') + (b ? txt(x0 + w / 2, y0 + 35, b, 't', 'middle') : '');
  const ar = (x1, y1, x2, y2, lab, lx, ly) => `<path d="M${x1},${y1} L${x2},${y2}" class="s-muted" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>` + (lab ? txt(lx !== undefined ? lx : (x1 + x2) / 2, ly !== undefined ? ly : (y1 + y2) / 2 - 7, lab, 't', 'middle') : '');
  let s = DEFS;
  s += box(10, 30, 120, 'N día', '10 M req') + ar(130, 52, 178, 52, '÷ 86,400');
  s += box(180, 30, 120, 'λ̄ promedio', '116 req/s') + ar(300, 52, 348, 52, '× f pico');
  s += box(350, 30, 120, 'λ pico', '350 req/s') + ar(470, 52, 518, 52, '× margen');
  s += box(520, 30, 130, 'λ diseño', '500 req/s', 'f-hi-soft s-hi');
  s += ar(650, 52, 718, 22) + ar(650, 52, 718, 80) + ar(650, 52, 718, 138);
  s += box(720, 0, 150, 'GPUs', '⌈λ ÷ ρμ⌉ + 1 → 2') + box(720, 58, 150, 'CPU prep', 'λ·t ÷ ρ → 5 vCPU') + box(720, 116, 150, 'Red', 'λ·s·8 → 2.4 Gb/s') + box(720, 174, 150, 'Almacenamiento', 'N día × bytes');
  s += `<path d="M70,74 L70,196 L718,196" class="s-muted" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>` + txt(395, 189, 'N día × bytes por registro', 't', 'middle');
  s += box(890, 87, 100, 'Costo', '× 730 h × US$/h', 'f-hi-soft s-hi');
  s += ar(870, 22, 888, 96) + ar(870, 80, 888, 104) + ar(870, 138, 888, 116) + ar(870, 196, 888, 124);
  s += box(10, 250, 120, 'Catálogo', '200 M imágenes') + ar(130, 272, 178, 272, '÷ (n·μ)') + box(180, 250, 140, 'Backfill', '≈ 14 h con 4 T4');
  s += box(370, 250, 120, 'Modelo', 'P, bytes, batch') + ar(490, 272, 538, 272) + box(540, 250, 130, 'VRAM', 'P·b + activ. + ctx') + ar(670, 272, 718, 272) + txt(726, 268, '¿cabe en la GPU?', 'tl tb', 'start') + txt(726, 284, 'si no, otra GPU', 't', 'start');
  return svg(W, H, s, 'Cadena de estimaciones: del volumen diario al tráfico de diseño, de ahí a GPUs, CPU, red y almacenamiento, y todo al costo mensual');
}

// ---------------------------------------------------------------- contenido
const vars = (rows) => `<table class="vars"><thead><tr><th>Símbolo</th><th>Qué es</th><th>Unidad</th><th>En C01</th></tr></thead><tbody>${rows.map(([s, q, u, c]) => `<tr><td>${mi(s)}</td><td>${q}</td><td class="u">${u}</td><td class="c">${c}</td></tr>`).join('')}</tbody></table>`;
const steps = (list) => `<ol class="steps">${list.map((t) => `<li>${mb(t)}</li>`).join('')}</ol>`;
const notes = (memo, trap) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p>${memo}</div><div class="trap"><p class="tag">Trampa</p>${trap}</div></div>`;
const section = (id, num, title, question, formula, fig, worked, nts) => `
<section class="sec" id="${id}">
  <header class="sec__head"><span class="sec__n">${num}</span><div><h2>${title}</h2><p class="sec__q">${question}</p></div></header>
  <div class="sec__grid">
    <div class="pad">${formula}</div>
    <figure class="fig">${fig}</figure>
  </div>
  <div class="worked"><h3>Con los números de C01</h3>${worked}</div>
  ${nts}
</section>`;

const S = [];
S.push(section('trafico', 1, 'Tráfico', '¿Cuántos requests por segundo tienes que aguantar?',
  mb(T`\bar{\lambda} \;=\; \frac{N_{\text{día}}}{86{,}400\ \text{s}}`) + mb(T`\lambda_{\text{pico}} \;=\; f_{\text{pico}}\cdot\bar{\lambda} \qquad f_{\text{pico}} \approx 24\cdot s_{\text{hora pico}}`) + mb(T`\lambda_{\text{diseño}} \;=\; m\cdot\lambda_{\text{pico}}`) +
  vars([[T`N_{\text{día}}`, 'requests (o imágenes) por día', 'req/día', '10 M'], [T`\bar{\lambda}`, 'tasa promedio', 'req/s', '≈ 116'], [T`f_{\text{pico}}`, 'factor de pico diurno (2–5×)', '—', '3'], [T`s_{\text{hora pico}}`, 'fracción del día en la hora pico', '—', '12.5 % → 3×'], [T`m`, 'margen por spikes y crecimiento (1.3–1.5)', '—', '≈ 1.4'], [T`\lambda_{\text{diseño}}`, 'tasa para la que dimensionas', 'req/s', '500']]),
  trafficChart() + '<figcaption>La curva de un día. El área bajo la curva son los 10 M requests; el promedio la reparte parejo; dimensionas para la línea de diseño.</figcaption>',
  steps([T`\bar{\lambda} = \frac{10{,}000{,}000}{86{,}400\ \text{s}} \approx 116\ \text{req/s}`, T`\lambda_{\text{pico}} = 3 \times 116 \approx 350\ \text{req/s}`, T`\lambda_{\text{diseño}} = 1.4 \times 350 \approx 490 \;\rightarrow\; \boxed{500\ \text{req/s}}\ \ \text{(redondeas hacia arriba)}`, T`\text{por GPU con 2 GPUs: } \frac{500}{2} = 250\ \text{req/s}`]),
  notes(`<p><b>Divide por el día, multiplica por el pico, súmale margen.</b> Atajo: ${mi(T`1\ \text{M/día} \approx 11.6\ \text{req/s}`)}. Con ${mi(T`10^5`)} s por día subestimas ≈ 14 %.</p>`, `<p>Dimensionar con el promedio. El pico decide cuántas máquinas pones; el promedio decide cuánto pagas, porque la mayor parte del día el sistema trabaja muy por debajo de su capacidad.</p>`)));

S.push(section('latencia', 2, 'Presupuesto de latencia', '¿Cuántos milisegundos le tocan a cada tramo?',
  mb(T`\text{SLO}_{p99} \;\ge\; \sum_{i} b_i \;+\; \text{margen}`) + mb(T`b_{\text{modelo}} \;=\; \text{SLO} \;-\; \sum_{i\,\neq\,\text{modelo}} b_i \;-\; \text{margen}`) + mb(T`p99(X+Y) \;\neq\; p99(X) + p99(Y)`) +
  vars([[T`\text{SLO}_{p99}`, 'objetivo de latencia server-side', 'ms', '200'], [T`b_i`, 'presupuesto p99 del tramo i', 'ms', 'ver la barra'], [T`\text{margen}`, 'lo que no está en la tabla: fotos gigantes, GC, throttling', 'ms', '≈ 48'], [T`t_{\text{timeout}}`, 'tiempo máximo hacia el tramo siguiente', 'ms', '150 (gateway → Triton)']]),
  latencyChart() + latencyLegend() + '<figcaption>Las cotas altas de p99 de cada tramo, apiladas. Suman ≈ 152 ms y quedan ≈ 48 ms de margen contra el SLO.</figcaption>',
  steps([T`\sum b_i \approx 10 + 30 + 50 + 2 + 10 + 2 + 15 + 3 + 30 \approx 152\ \text{ms}`, T`\text{margen} = 200 - 152 \approx 48\ \text{ms}`, T`t_{\text{timeout}}^{\,\text{gateway}\to\text{Triton}} = 150\ \text{ms}\ \ \text{(después ya no cumples el SLO: falla rápido)}`, T`b_{\text{cola de batching}} \le \texttt{max\_queue\_delay} = 2\ \text{ms}`]),
  notes(`<p><b>Reparte el SLO antes de elegir tecnología.</b> Primero la cuenta y después el stack: así sabes dónde puedes gastar (2 ms de cola de batching) y dónde no (decodificar un JPEG de 12 MP sin cuidado).</p>`, `<p>Los percentiles no se suman. La suma de p99 suele sobrestimar el p99 total, pero no es una cota garantizada: úsala para repartir y mide el p99 de punta a punta. Y la subida de la foto no entra: el SLO es server-side.</p>`)));

S.push(section('gpus', 3, 'GPUs', '¿Cuántas GPUs pones y qué tan cargadas van?',
  mb(T`\mu_{\text{plan}} \;=\; \rho_{\text{obj}}\cdot\mu_{\max}`) + mb(T`n_{\text{thr}} \;=\; \left\lceil \frac{\lambda_{\text{diseño}}}{\mu_{\text{plan}}} \right\rceil \qquad n \;=\; \max\!\big(n_{\text{thr}}+1,\; n_{\text{AZ}}\big)`) + mb(T`u \;=\; \frac{\lambda}{n\,\mu_{\max}}`) + mb(T`W \;=\; \frac{S}{1-\rho} \qquad p99 \approx 4.6\,W \qquad L \;=\; \lambda\, W`) +
  vars([[T`\mu_{\max}`, 'máximo medido por GPU (perf_analyzer)', 'img/s', '≈ 1,200 (T4)'], [T`\rho_{\text{obj}}`, 'utilización objetivo (50–70 %)', '—', '0.5'], [T`n_{\text{thr}}`, 'GPUs por throughput', 'GPU', '1'], [T`n_{\text{AZ}}`, 'una por zona (disponibilidad)', 'GPU', '2'], [T`u`, 'carga real sobre el máximo', '%', '5–42 %'], [T`W,\,S`, 'tiempo en el sistema y de servicio', 's', '—'], [T`L`, 'requests en vuelo (Little)', '—', '—']]),
  `<div class="duo">${queueChart()}${loadChart()}</div><figcaption>Izquierda: cerca de la saturación la espera explota (M/M/1). Derecha: la carga real de cada T4 en C01; el número de GPUs lo fija la disponibilidad, no el throughput.</figcaption>`,
  steps([T`\mu_{\text{plan}} = 0.5 \times 1{,}200 = 600\ \text{img/s}`, T`n_{\text{thr}} = \left\lceil \tfrac{500}{600} \right\rceil = \lceil 0.83 \rceil = 1`, T`n = \max(1+1,\ 2) = \boxed{2\ \text{T4}}\ \ \text{(una por AZ)}`, T`u_{\text{diseño}} = \tfrac{500}{2 \times 1{,}200} \approx 21\,\% \qquad u_{\text{falla}} = \tfrac{500}{1{,}200} \approx 42\,\% \qquad u_{\text{prom}} = \tfrac{116}{2\times 1{,}200} \approx 5\,\%`, T`\text{PyTorch eager FP32: } \tfrac{500}{\approx 100\ \text{img/s}} \approx 5\ \text{GPUs}`]),
  notes(`<p><b>Mide, baja a ρ, redondea hacia arriba, suma una.</b> El orden importa: primero el máximo medido, luego la utilización objetivo, luego el techo, al final N+1. Y con Little, ${mi(T`L=\lambda W`)}: 500 req/s × 50 ms = 25 requests en vuelo.</p>`, `<p>Planear al 90 %: con ${mi(T`\rho = 0.9`)} el tiempo en el sistema es 10× el de servicio. Y <code>nv_gpu_utilization</code> no mide capacidad usada: marca tiempo con kernels corriendo.</p>`)));

S.push(section('sin-gpu', 4, '¿Y sin GPU?', '¿Cuántos vCPU harían el mismo trabajo y cuánto cuestan?',
  mb(T`C_{\text{ocup}} \;=\; \lambda\cdot t_{\text{CPU}}`) + mb(T`C_{\text{prov}} \;=\; \frac{\lambda\, t_{\text{CPU}}}{\rho_{\text{HPA}}}`) + mb(T`\text{Costo}_{\text{mes}} \;=\; C_{\text{facturado}}\cdot p_{\text{vCPU-h}}\cdot 730\ \text{h}`) +
  vars([[T`t_{\text{CPU}}`, 'segundos de CPU por imagen por vCPU', 's', 'FP32 0.04–0.08 · INT8 0.008–0.025'], [T`C_{\text{ocup}}`, 'vCPU ocupados (Little con S = t)', 'vCPU', '—'], [T`\rho_{\text{HPA}}`, 'objetivo de CPU del autoscaler', '—', '0.6'], [T`C_{\text{facturado}}`, 'promedio que pagas (sigue la curva + mínimos)', 'vCPU', '≈ 4–8'], [T`p_{\text{vCPU-h}}`, 'precio por vCPU-hora', 'US$', '≈ 0.0425']]),
  cpuOnlyChart() + '<figcaption>Las GPUs con N+1 no bajan de 2 las 24 horas; la CPU puede seguir la curva diaria. Con INT8, CPU-only puede costar igual o menos.</figcaption>',
  steps([T`\text{FP32: } 500 \times (0.04\text{–}0.08)\ \text{s} = 20\text{–}40\ \text{vCPU ocupados en el pico}`, T`\text{INT8, pico: } \frac{500 \times (0.008\text{–}0.025)}{0.6} \approx 7\text{–}21\ \text{vCPU}`, T`\text{INT8, promedio: } \frac{116 \times (0.008\text{–}0.025)}{0.6} \approx 2\text{–}5\ \text{vCPU}\ \ (+\ \text{mínimos} \Rightarrow 4\text{–}8)`, T`(4\text{–}8) \times 0.0425 \times 730 \approx \text{US}\$125\text{–}250/\text{mes} \quad\text{vs}\quad 2 \times 0.526 \times 730 \approx \text{US}\$768`]),
  notes(`<p><b>vCPU ocupados = tráfico × segundos de CPU por imagen.</b> Es Little otra vez: cada vCPU es un “servidor” y ${mi(T`t_{\text{CPU}}`)} su tiempo de servicio.</p>`, `<p>Comparar pico contra pico. La diferencia está en el promedio: la CPU escala con la curva y la GPU con N+1 se queda encendida. Y lo mides la primera semana: latencia por vCPU y pérdida de INT8 en el golden set.</p>`)));

S.push(section('vram', 5, 'Memoria de GPU (VRAM)', '¿Cabe el modelo en la GPU, y cuánto sobra?',
  mb(T`M_{\text{pesos}} \;=\; P\cdot b`) + mb(T`M_{\text{entrada}} \;=\; B\cdot C\cdot H\cdot W\cdot b_{\text{in}}`) + mb(T`M_{\text{total}} \;\approx\; M_{\text{CUDA}} \;+\; k\,\big(M_{\text{engine}} + M_{\text{act}}(B) + M_{\text{entrada}}(B)\big)`) + `<p class="small">Para LLMs, lo que domina es el KV cache: ${mi(T`M_{\text{KV/token}} = 2\cdot L_{\text{capas}}\cdot H_{\text{kv}}\cdot d_{\text{head}}\cdot b`)} (Llama 3 8B en BF16: ${mi(T`2\cdot 32\cdot 8\cdot 128\cdot 2 = 128\ \text{KiB}`)} por token).</p>` +
  vars([[T`P`, 'parámetros del modelo', '—', '25.6 M (ResNet-50)'], [T`b`, 'bytes por parámetro: FP32 4 · FP16 2 · INT8 1', 'B', '2 (FP16)'], [T`B`, 'tamaño del batch', '—', '32'], [T`C\cdot H\cdot W`, 'canales × alto × ancho de la entrada', '—', '3 × 224 × 224'], [T`k`, 'instancias del modelo en la GPU', '—', '2'], [T`M_{\text{CUDA}}`, 'contexto CUDA + librerías', 'GB', '≈ 0.3–0.8']]),
  vramChart() + '<figcaption>Arriba, la T4 completa; abajo, el zoom de lo que sí se usa. La VRAM no es la restricción en C01.</figcaption>',
  steps([T`M_{\text{pesos}} = 25.6\ \text{M} \times 2\ \text{B} \approx 51\ \text{MB}`, T`M_{\text{entrada}} = 32 \times 3 \times 224 \times 224 \times 4\ \text{B} \approx 19\ \text{MB}`, T`M_{\text{act}}(32) \approx 0.2\text{–}0.5\ \text{GB} \qquad M_{\text{CUDA}} \approx 0.3\text{–}0.8\ \text{GB}`, T`M_{\text{total}} \approx 1\text{–}3\ \text{GB} \;\ll\; 16\ \text{GB}\ \Rightarrow\ \text{la VRAM no limita}`]),
  notes(`<p><b>Parámetros × bytes es el piso, no el total.</b> Súmale el contexto CUDA, las activaciones del batch y una copia por instancia.</p>`, `<p>Creer que solo pesan los pesos. En visión casi siempre sobra memoria; en LLMs el KV cache crece con los tokens en vuelo y es lo que decide cuántas conversaciones caben.</p>`)));

S.push(section('cpu-prep', 6, 'CPU para preprocesamiento', '¿Cuántos vCPU necesita el gateway que decodifica y prepara la imagen?',
  mb(T`\bar{t}_{\text{prep}} \;=\; \sum_k w_k\, t_k`) + mb(T`C_{\text{ocup}} \;=\; \lambda_{\text{diseño}}\cdot \bar{t}_{\text{prep}} \qquad C_{\text{req}} \;=\; \frac{C_{\text{ocup}}}{\rho_{\text{HPA}}}`) + mb(T`n_{\text{nodos}} \;=\; \max\!\left(\left\lceil \frac{C_{\text{req}}}{\text{vCPU por nodo}} \right\rceil,\; n_{\text{AZ}}\right)`) +
  vars([[T`w_k`, 'fracción del tráfico de cada tipo de imagen', '—', '85 % móvil · 15 % web'], [T`t_k`, 'CPU por imagen de ese tipo', 'ms', '≈ 5 · ≈ 60 (originales)'], [T`\bar{t}_{\text{prep}}`, 'CPU promedio por imagen (con draft mode)', 'ms', '≈ 6'], [T`\rho_{\text{HPA}}`, 'objetivo de CPU del HPA', '—', '0.6'], [T`\text{vCPU por nodo}`, 'tamaño del nodo', 'vCPU', '4 (c6i.xlarge)']]),
  prepChart() + '<figcaption>Arriba, lo que hace el gateway con cada foto. Abajo, por qué el promedio engaña: una minoría de fotos grandes se come la mayor parte de la CPU.</figcaption>',
  steps([T`C_{\text{ocup}} = 500 \times 6\ \text{ms} = 3\ \text{vCPU ocupados}`, T`C_{\text{req}} = \frac{3}{0.6} = 5\ \text{vCPU}`, T`n_{\text{nodos}} = \max\!\left(\lceil 5/4 \rceil,\ 2\right) = 2 \times \text{c6i.xlarge} = 8\ \text{vCPU}`, T`\text{mezcla de originales: } 0.85 \times 5 + 0.15 \times 60 = 13.25\ \text{ms} \;\Rightarrow\; 68\,\%\ \text{lo pone el 15}\,\%`]),
  notes(`<p><b>La CPU se cuenta igual que la GPU:</b> tráfico × tiempo ÷ utilización, y al final redondeas a nodos enteros con uno por zona.</p>`, `<p>Quedarte con el promedio: la cola de fotos gigantes manda (por eso el draft mode no es micro-optimización). Y la VM de la GPU solo tiene 4 vCPU: el preprocesamiento va en su propio tier.</p>`)));

S.push(section('red', 7, 'Red entre tiers', '¿Cuántos Gb/s viajan del gateway al model server, y cuánto cuestan?',
  mb(T`s \;=\; C\cdot H\cdot W\cdot b`) + mb(T`BW \;=\; \lambda\cdot s\cdot 8\ \tfrac{\text{bits}}{\text{byte}} \qquad u_{\text{NIC}} \;=\; \frac{BW / n_{\text{nodos}}}{BW_{\text{baseline}}}`) + mb(T`V_{\text{mes}} \;=\; s\cdot N_{\text{día}}\cdot 30 \qquad \text{Costo}_{\text{AZ}} \;=\; f_{\text{cruce}}\cdot V_{\text{mes}}\cdot p_{\text{GB}}`) +
  vars([[T`s`, 'bytes por request que cruzan la red', 'B', '602,112 (FP32)'], [T`BW`, 'ancho de banda', 'Gb/s', '≈ 2.4'], [T`BW_{\text{baseline}}`, 'red sostenida de la instancia (no el “hasta”)', 'Gb/s', '1.56 (c6i.xlarge)'], [T`f_{\text{cruce}}`, 'fracción que cruza de zona', '—', '0.5 si balanceas al azar'], [T`p_{\text{GB}}`, 'precio entre AZs (ida y vuelta)', 'US$/GB', '0.02']]),
  netChart() + '<figcaption>Lo que viaja a 500 req/s según el formato. El tensor FP32 pesa 3× el JPEG móvil y deja cada nodo del gateway al 77 % de su baseline.</figcaption>',
  steps([T`s = 3 \times 224 \times 224 \times 4\ \text{B} = 602{,}112\ \text{B} \approx 602\ \text{KB}`, T`BW = 500 \times 602\ \text{KB} \times 8 \approx 2.4\ \text{Gb/s}`, T`u_{\text{NIC}} = \frac{2.4 / 2}{1.56} \approx 77\,\% \qquad \text{si cae una zona: } \frac{2.4}{1.56} \approx 154\,\%`, T`V_{\text{mes}} \approx 602\ \text{KB} \times 10\ \text{M} \times 30 \approx 180\ \text{TB} \;\Rightarrow\; 0.5 \times 180{,}000\ \text{GB} \times 0.02 \approx \text{US}\$1{,}800/\text{mes}`]),
  notes(`<p><b>Bytes × requests × 8 = bits por segundo.</b> Y la tabla de bytes por valor: FP32 4, FP16 2, UINT8 1 (÷ 2 y ÷ 4 del tensor).</p>`, `<p>Olvidar el × 8, usar el ancho de banda “hasta” en vez del baseline sostenido, y balancear al azar entre zonas: la transferencia entre AZs costaría más que las dos GPUs. Ruteo por zona desde el día 1.</p>`)));

S.push(section('costo', 8, 'Almacenamiento y costo mensual', '¿Cuánto guardas, cuánto pagas al mes y cuánto cuesta cada predicción?',
  mb(T`S_{\text{día}} \;=\; N_{\text{día}}\cdot s_{\text{registro}} \qquad S_{\text{mes}} \;\approx\; \frac{30\cdot S_{\text{día}}}{r_{\text{compresión}}}`) + mb(T`\text{Costo}_{\text{mes}} \;=\; \sum_j n_j\, p_j\cdot 730\ \text{h} \;+\; \sum_k q_k\, c_k`) + mb(T`c_{1k} \;=\; \frac{\text{Costo}_{\text{mes}}}{N_{\text{día}}\cdot 30.4}\cdot 1{,}000`) +
  vars([[T`s_{\text{registro}}`, 'bytes por log de predicción', 'B', '≈ 300'], [T`r_{\text{compresión}}`, 'Parquet comprimido (5–10×)', '—', '5–10'], [T`n_j,\ p_j`, 'instancias de cada tipo y su precio por hora', 'US$/h', 'T4 0.526 · c6i 0.17'], [T`q_k,\ c_k`, 'lo que se cobra por uso (GB, requests) y su precio', '—', 'ALB 0.008/GB'], [T`c_{1k}`, 'costo por 1,000 predicciones', 'US$', '≈ 0.006']]),
  costChart() + costLegend() + '<figcaption>La infraestructura de C01 por línea, contra el presupuesto de US$3k. El ALB es la segunda línea de costo porque cobra por cada GB de imagen que lo cruza.</figcaption>',
  steps([T`S_{\text{día}} = 10\ \text{M} \times 300\ \text{B} = 3\ \text{GB/día} \approx 90\ \text{GB/mes crudo}\ \ (\div 5\text{–}10\ \text{en Parquet})`, T`\text{GPUs} = 2 \times 0.526 \times 730 \approx 768 \qquad \text{gateway} = 2 \times 0.17 \times 730 \approx 248 \qquad \text{EKS} = 0.10 \times 730 \approx 73`, T`\text{ALB} = 0.0225 \times 730 + 2{,}000\ \tfrac{\text{GB}}{\text{día}} \times 30.4 \times 0.008 \approx \text{US}\$500`, T`\text{infra} \approx \text{US}\$1.75\text{k/mes} \qquad c_{1k} = \frac{1{,}750}{304\ \text{M}} \times 1{,}000 \approx \text{US}\$0.006`]),
  notes(`<p><b>Mes de costos = 730 h.</b> Precio por hora × horas × instancias, y después lo que se cobra por uso (GB procesados, requests a S3, transferencia). Para SLOs el mes es de 30 días = 720 h.</p>`, `<p>Olvidar lo que se cobra por uso: aquí el ALB pesa ≈ 30 % de la infra. El almacenamiento casi nunca es lo caro; lo caro es la privacidad de lo que guardas.</p>`)));

S.push(section('backfill', 9, 'Backfill de 200 M imágenes', '¿Cuánto tarda y cuánto cuesta procesar el catálogo existente?',
  mb(T`T \;=\; \frac{N_{\text{catálogo}}}{n\cdot\mu_{\text{offline}}}`) + mb(T`\text{GPU-h} \;=\; n\cdot T \;=\; \frac{N_{\text{catálogo}}}{\mu_{\text{offline}}} \qquad \text{Costo} \;=\; \text{GPU-h}\cdot p_{\text{GPU-h}}`) + mb(T`C_{\text{decode}} \;=\; \mu_{\text{offline}}\cdot t_{\text{decode}} \qquad \text{GET} \;=\; N_{\text{catálogo}}\cdot p_{\text{GET}}`) +
  vars([[T`N_{\text{catálogo}}`, 'imágenes por procesar', '—', '200 M'], [T`\mu_{\text{offline}}`, 'throughput por GPU en batch (IO + decode)', 'img/s', '≈ 1,000'], [T`n`, 'máquinas en paralelo', '—', '4'], [T`t_{\text{decode}}`, 'CPU por thumbnail', 's', '≈ 0.002'], [T`p_{\text{GPU-h}}`, 'precio de la instancia', 'US$/h', '0.752 (g4dn.2xlarge)'], [T`p_{\text{GET}}`, 'precio por GET de S3', 'US$', '0.0004 / 1,000']]),
  backfillChart() + '<figcaption>El tiempo cae como 1/n, pero las GPU-horas no cambian: paralelizar compra tiempo, no ahorra dinero.</figcaption>',
  steps([T`T = \frac{200\ \text{M}}{4 \times 1{,}000\ \text{img/s}} = 50{,}000\ \text{s} \approx 14\ \text{h}`, T`\text{GPU-h} = 4 \times 13.9 \approx 56 \;\Rightarrow\; 56 \times 0.752 \approx \text{US}\$42\ \text{on-demand (menos en spot)}`, T`C_{\text{decode}} = 1{,}000 \times 2\ \text{ms} = 2\ \text{cores} \;\Rightarrow\; \text{g4dn.2xlarge (8 vCPU)}`, T`\text{GET} = 200\ \text{M} \times \frac{0.0004}{1{,}000} = \text{US}\$80 \qquad \text{originales: } 200\ \text{M} \times 13.25\ \text{ms} \approx 736\ \text{CPU-h}`]),
  notes(`<p><b>Más máquinas = menos horas, mismo costo.</b> ${mi(T`n\cdot T`)} es constante: el número de máquinas lo decide tu fecha límite, no tu presupuesto.</p>`, `<p>Correrlo contra el Triton online. Es un job aparte, reanudable por shards. El cuello de botella es IO + decode, no la GPU, y los thumbnails se recomprimieron: valida en una muestra que las predicciones coinciden con las de los originales.</p>`)));

const CONST = `
<section class="sec" id="constantes">
  <header class="sec__head"><span class="sec__n">0</span><div><h2>Números de bolsillo</h2><p class="sec__q">Lo que conviene saberse de memoria antes de cualquier cuenta.</p></div></header>
  <div class="consts">
    <div class="const"><p class="tag">Tiempo</p><p>${mi(T`1\ \text{día} = 86{,}400\ \text{s} \approx 10^5`)}</p><p>${mi(T`1\ \text{M/día} \approx 11.6\ \text{req/s}`)}</p></div>
    <div class="const"><p class="tag">Mes</p><p>costos: ${mi(T`730\ \text{h}`)}</p><p>SLO: ${mi(T`30\ \text{días} = 720\ \text{h}`)}</p><p>predicciones al mes = diarias × 30.4</p></div>
    <div class="const"><p class="tag">Bits y bytes</p><p>${mi(T`\text{bits/s} = 8 \times \text{bytes/s}`)}</p><p>${mi(T`1\ \text{Gb/s} = 125\ \text{MB/s}`)}</p></div>
    <div class="const"><p class="tag">Bytes por valor</p><p>FP32 <b>4</b> · FP16/BF16 <b>2</b> · INT8 <b>1</b> · INT4 <b>½</b></p><p>imagen 224 × 224 × 3 = 150,528 valores</p></div>
    <div class="const"><p class="tag">Utilización objetivo</p><p>GPU online: ${mi(T`\rho \approx 0.5\text{–}0.7`)}</p><p>HPA de CPU: ${mi(T`\rho \approx 0.6`)}</p><p>batch offline: cerca de 100 %</p></div>
    <div class="const"><p class="tag">Colas (M/M/1) y Little</p><p>${mi(T`W = \dfrac{S}{1-\rho}`)} · ${mi(T`p99 \approx 4.6\,W`)}</p><p>${mi(T`L = \lambda\, W`)} (requests en vuelo)</p></div>
    <div class="const"><p class="tag">Instancias (aprox., us-east-1)</p><p>g4dn.xlarge (T4) <b>US$0.526/h</b> · g4dn.2xlarge <b>0.752</b> · c6i.xlarge (4 vCPU) <b>0.17</b> (≈ 0.0425 por vCPU-h)</p></div>
    <div class="const"><p class="tag">Por uso (aprox.)</p><p>entre AZs <b>US$0.01/GB</b> por sentido · S3 GET <b>US$0.0004</b> por 1,000 · ALB ≈ <b>US$0.008</b> por GB procesado</p></div>
  </div>
</section>`;

const CHAIN = `
<section class="sec" id="cadena">
  <header class="sec__head"><span class="sec__n">↳</span><div><h2>La cadena</h2><p class="sec__q">Cada número sale del anterior. Si aprendes el orden, las fórmulas se acomodan solas.</p></div></header>
  <figure class="fig wide"><div class="scroll">${chainDiagram()}</div><figcaption>Del volumen diario al pico de diseño; de ahí, GPUs, CPU y red; todo termina en el costo. La VRAM solo pregunta si el modelo cabe, y el backfill es un cálculo aparte.</figcaption></figure>
</section>`;

const FIELDS = [
  ['Tráfico', [['n_dia', 'Requests por día (millones)', 10, 0.5], ['f_pico', 'Factor de pico', 3, 0.1], ['margen', 'Margen de diseño', 1.4, 0.05]]],
  ['GPUs', [['mu_max', 'Máximo medido por GPU (img/s)', 1200, 50], ['rho', 'Utilización objetivo', 0.5, 0.05], ['n_az', 'Zonas (mínimo de GPUs y nodos)', 2, 1]]],
  ['CPU y red', [['t_prep', 'CPU por imagen (ms)', 6, 0.5], ['rho_hpa', 'Objetivo del HPA', 0.6, 0.05], ['vcpu_nodo', 'vCPU por nodo del gateway', 4, 1], ['bytes', 'Bytes por request a Triton', 602112, 1000], ['bw_base', 'Baseline por nodo (Gb/s)', 1.56, 0.01]]],
  ['Costo', [['p_gpu', 'Precio por GPU (US$/h)', 0.526, 0.01], ['p_nodo', 'Precio por nodo CPU (US$/h)', 0.17, 0.01], ['kb_subida', 'KB por foto subida (ALB)', 200, 10]]],
  ['Backfill', [['n_cat', 'Imágenes del catálogo (millones)', 200, 10], ['mu_off', 'Throughput offline por GPU (img/s)', 1000, 50], ['n_bf', 'Máquinas en paralelo', 4, 1], ['p_bf', 'Precio por máquina (US$/h)', 0.752, 0.01]]],
];
const CALC = `
<section class="sec" id="calculadora">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Juega con los números</h2><p class="sec__q">Viene cargada con C01. Cambia un supuesto y mira qué se mueve en la cadena.</p></div></header>
  <form class="calc" id="calc" autocomplete="off">
    ${FIELDS.map(([g, fs]) => `<fieldset><legend>${g}</legend>${fs.map(([id, lab, v, st]) => `<label for="${id}"><span>${lab}</span><input id="${id}" name="${id}" type="number" inputmode="decimal" step="${st}" value="${v}"></label>`).join('')}</fieldset>`).join('')}
  </form>
  <div class="out" id="out" aria-live="polite"></div>
  <p class="small">Mismas fórmulas que arriba. El pico de diseño se redondea hacia arriba al múltiplo de 50, como en C01. El costo incluye EKS (≈ US$73) y logs (≈ US$100) fijos.</p>
</section>`;

const NAV = [['constantes', 'Números de bolsillo'], ['cadena', 'La cadena'], ['trafico', '1 · Tráfico'], ['latencia', '2 · Latencia'], ['gpus', '3 · GPUs'], ['sin-gpu', '4 · ¿Sin GPU?'], ['vram', '5 · VRAM'], ['cpu-prep', '6 · CPU'], ['red', '7 · Red'], ['costo', '8 · Costo'], ['backfill', '9 · Backfill'], ['calculadora', 'Calculadora']];

const CSS = `
/* Hoja de cálculo de ingeniería: papel cuadriculado para las fórmulas, tinta azul, resaltador ámbar para los resultados. */
:root {
  --bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --c1: #2f6fbd; --c2: #2a9d8f; --c3: #e0a32b; --c4: #8a6fc7; --c5: #c8566f;
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --c1: #6ea8ff; --c2: #4fcfbf; --c3: #f2c14e; --c4: #b39cf0; --c5: #f08aa0; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --c1: #6ea8ff; --c2: #4fcfbf; --c3: #f2c14e; --c4: #b39cf0; --c5: #f08aa0; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font: 17px/1.6 var(--f-body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px; }
.wrap { max-width: 1120px; margin: 0 auto; }
h1, h2, h3, .tag, legend { font-family: var(--f-display); text-wrap: balance; }
.hero { padding-block: 40px 22px; display: grid; gap: 10px; }
.hero .kicker { font: 600 12.5px/1 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0; }
.hero h1 { font-size: clamp(32px, 6vw, 54px); line-height: 1.04; margin: 0; font-weight: 800; font-stretch: 112%; letter-spacing: -0.01em; }
.hero p.lead { max-width: 68ch; margin: 0; color: var(--muted); font-size: 18px; }
.legendrow { display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13px/1.4 var(--f-display); color: var(--muted); margin: 6px 0 0; }
.legendrow span { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
nav.toc { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); margin-bottom: 8px; }
nav.toc ul { list-style: none; display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 10px 0; scrollbar-width: thin; }
nav.toc a { display: inline-block; white-space: nowrap; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); text-decoration: none; font: 600 13px/1 var(--f-display); }
nav.toc a:hover, nav.toc a:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
.sec { padding-block: 34px 10px; border-top: 1px solid var(--rule); scroll-margin-top: 64px; }
.sec__head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
.sec__n { flex: none; width: 46px; height: 46px; border-radius: 10px; display: grid; place-items: center; background: var(--accent); color: var(--paper); font: 800 22px/1 var(--f-display); }
.sec h2 { margin: 0; font-size: clamp(24px, 3.4vw, 32px); line-height: 1.1; font-weight: 800; font-stretch: 108%; }
.sec__q { margin: 4px 0 0; color: var(--muted); }
.sec__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 18px; align-items: start; }
@media (max-width: 920px) { .sec__grid { grid-template-columns: minmax(0, 1fr); } }
.pad { min-width: 0; background-color: var(--paper); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 18px 18px; border: 1px solid var(--rule); border-radius: 12px; padding: 16px 18px; }
.mb { overflow-x: auto; overflow-y: hidden; padding: 6px 2px; }
.mb math { font-family: var(--f-math); font-size: 1.22em; display: inline math; }
.mi math { font-family: var(--f-math); font-size: 1.08em; }
.vars { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14.5px; background: var(--paper); }
.vars th { text-align: left; font: 700 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 6px 6px; }
.vars td { border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: top; }
.vars td.u { font: 13px/1.5 var(--f-mono); color: var(--muted); white-space: nowrap; }
.vars td.c { font: 600 13px/1.5 var(--f-mono); color: var(--accent2); }
.pad .vars { display: block; overflow-x: auto; }
figure.fig { min-width: 0; margin: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 14.5px; margin-top: 8px; }
figure.wide .scroll { overflow-x: auto; }
figure.wide svg { min-width: 760px; }
.duo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 560px) { .duo { grid-template-columns: minmax(0, 1fr); } }
svg.chart { width: 100%; height: auto; display: block; }
svg .t { fill: var(--muted); font: 12px var(--f-display); } svg .tl { fill: var(--ink); font: 12.5px var(--f-display); } svg .tb { font-weight: 700; }
svg .halo { paint-order: stroke; stroke: var(--paper); stroke-width: 4px; stroke-linejoin: round; }
svg .tw { fill: var(--onbar); font: 700 12.5px var(--f-display); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .l-dash { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 5 4; } svg .l-accent2 { stroke: var(--accent2); stroke-width: 2; } svg .l-hi { stroke: var(--hi); stroke-width: 2.4; }
svg .s-accent { stroke: var(--accent); } svg .s-muted { stroke: var(--muted); } svg .s-rule { stroke: var(--rule); stroke-width: 1.2; } svg .s-ink { stroke: var(--ink); stroke-width: 1.2; } svg .s-hi { stroke: var(--hi); stroke-width: 1.6; } svg .s-paper { stroke: var(--paper); }
svg .f-accent { fill: var(--accent); } svg .f-accent-soft { fill: var(--accent-soft); } svg .f-accent2 { fill: var(--accent2); } svg .f-accent2-soft { fill: var(--accent2-soft); }
svg .f-hi { fill: var(--hi); } svg .f-hi-soft { fill: var(--hi-soft); } svg .f-warn { fill: var(--warn); } svg .f-paper { fill: var(--paper); } svg .f-muted { fill: var(--muted); } svg .f-free { fill: var(--free); }
svg .f-c1 { fill: var(--c1); } svg .f-c2 { fill: var(--c2); } svg .f-c3 { fill: var(--c3); } svg .f-c4 { fill: var(--c4); } svg .f-c5 { fill: var(--c5); }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 0; margin: 8px 0 0; font: 13px/1.4 var(--f-display); color: var(--muted); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend b { color: var(--ink); } .legend .pct { font-family: var(--f-mono); font-size: 12px; }
.sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
.sw.f-c1 { background: var(--c1); } .sw.f-c2 { background: var(--c2); } .sw.f-c3 { background: var(--c3); } .sw.f-c4 { background: var(--c4); } .sw.f-c5 { background: var(--c5); }
.sw.hatch { background: repeating-linear-gradient(45deg, var(--paper) 0 3px, var(--muted) 3px 5px); }
.worked { margin-top: 18px; }
.worked h3 { margin: 0 0 6px; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
ol.steps { margin: 0; padding-left: 26px; display: grid; gap: 2px; }
ol.steps li::marker { font: 700 14px var(--f-display); color: var(--muted); }
ol.steps .mb { padding: 4px 0; }
.notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
@media (max-width: 720px) { .notes { grid-template-columns: minmax(0, 1fr); } }
.memo, .trap { border-radius: 10px; padding: 12px 16px; min-width: 0; }
.memo { background: var(--hi-soft); } .trap { background: var(--warn-soft); }
.memo p, .trap p { margin: 0; }
.tag { font-size: 11.5px !important; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px !important; color: var(--muted); }
.memo .tag { color: var(--hi); } .trap .tag { color: var(--warn); }
.small { font-size: 14.5px; color: var(--muted); }
code { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; }
.consts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.const { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 16px; min-width: 0; }
.const p { margin: 0; font-size: 15px; }
.calc { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.calc fieldset { border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); padding: 10px 14px 14px; margin: 0; min-width: 0; display: grid; gap: 8px; }
.calc legend { font-weight: 800; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); padding: 0 4px; }
.calc label { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 8px; align-items: center; font-size: 14.5px; }
.calc input { width: 100%; font: 600 15px var(--f-mono); color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 6px 8px; text-align: right; }
.calc input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.out { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 14px; }
.tile { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 10px 14px; min-width: 0; }
.tile .k { font: 700 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0; }
.tile .v { font: 700 22px/1.25 var(--f-mono); font-variant-numeric: tabular-nums; margin: 2px 0 0; }
.tile .d { font-size: 13.5px; color: var(--muted); margin: 2px 0 0; }
.tile.hot { border-color: var(--hi); background: var(--hi-soft); } .tile.bad { border-color: var(--warn); background: var(--warn-soft); }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  body { background: #ffffff; font-size: 12.5px; padding-block: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, #calculadora { display: none; }
  .sec { break-before: page; padding-top: 0; border-top: 0; }
  #constantes { break-before: auto; }
  .sec__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .notes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  figure, .pad, .notes, ol.steps li { break-inside: avoid; }
  .hero { padding-top: 0; }
}
`;

const JS = `
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var f = function (x, d) { return Number(x).toLocaleString('en-US', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };
  function calc(v) {
    var lam = v.n_dia * 1e6 / 86400, pico = lam * v.f_pico, d0 = pico * v.margen, dis = Math.ceil(d0 / 50 - 1e-9) * 50;
    var plan = v.rho * v.mu_max, nthr = Math.ceil(dis / plan - 1e-9), ngpu = Math.max(nthr + 1, v.n_az);
    var cpu = dis * v.t_prep / 1000, req = cpu / v.rho_hpa, nodos = Math.max(Math.ceil(req / v.vcpu_nodo - 1e-9), v.n_az);
    var gbps = dis * v.bytes * 8 / 1e9, pnodo = gbps / nodos / v.bw_base, tb = v.bytes * v.n_dia * 1e6 * 30 / 1e12;
    var cg = ngpu * v.p_gpu * 730, cn = nodos * v.p_nodo * 730, alb = 0.0225 * 730 + (v.n_dia * 1e6 * v.kb_subida * 1e3 / 1e9) * 30.4 * 0.008;
    var total = cg + cn + 73 + alb + 100, c1k = total / (v.n_dia * 1e6 * 30.4) * 1000;
    var tbf = v.n_cat * 1e6 / (v.n_bf * v.mu_off) / 3600, gh = v.n_bf * tbf;
    return { lam: lam, pico: pico, d0: d0, dis: dis, plan: plan, nthr: nthr, ngpu: ngpu, ud: dis / (ngpu * v.mu_max), uf: dis / ((ngpu - 1) * v.mu_max), up: lam / (ngpu * v.mu_max),
      cpu: cpu, req: req, nodos: nodos, gbps: gbps, pnodo: pnodo, tb: tb, cg: cg, cn: cn, alb: alb, total: total, c1k: c1k, tbf: tbf, gh: gh, cbf: gh * v.p_bf };
  }
  window.__calc = calc;
  function tile(k, val, d, cls) { return '<div class="tile ' + (cls || '') + '"><p class="k">' + k + '</p><p class="v">' + val + '</p><p class="d">' + d + '</p></div>'; }
  function read() { var v = {}; document.querySelectorAll('#calc input').forEach(function (i) { var x = parseFloat(i.value); v[i.id] = isFinite(x) ? x : 0; }); return v; }
  function render() {
    var v = read(), r = calc(v);
    if (!(v.n_dia > 0 && v.mu_max > 0 && v.rho > 0 && v.rho_hpa > 0 && v.vcpu_nodo > 0 && v.bw_base > 0 && v.n_bf > 0 && v.mu_off > 0)) { $('out').innerHTML = tile('Revisa los datos', '—', 'Los valores deben ser mayores que cero.', 'bad'); return; }
    $('out').innerHTML =
      tile('Tráfico', f(r.lam) + ' → ' + f(r.pico) + ' → ' + f(r.dis), 'req/s: promedio → pico → diseño (sin redondeo: ' + f(r.d0) + ')', 'hot') +
      tile('GPUs', r.ngpu + ' GPUs', 'por throughput ' + r.nthr + ' (' + f(r.dis / r.plan, 2) + ' → techo) + 1, mínimo ' + v.n_az) +
      tile('Carga por GPU', f(r.ud * 100) + ' %', 'promedio ' + f(r.up * 100) + ' % · si cae una ' + (isFinite(r.uf) ? f(r.uf * 100) + ' %' : '—'), r.uf > 0.7 ? 'bad' : '') +
      tile('CPU del gateway', f(r.req, 1) + ' vCPU', f(r.cpu, 1) + ' ocupados → ' + r.nodos + ' nodos de ' + v.vcpu_nodo + ' vCPU') +
      tile('Red a Triton', f(r.gbps, 2) + ' Gb/s', f(r.pnodo * 100) + ' % del baseline por nodo · ' + f(r.tb) + ' TB/mes', r.pnodo > 0.8 ? 'bad' : '') +
      tile('Costo mensual (infra)', 'US$' + f(r.total), 'GPUs ' + f(r.cg) + ' · gateway ' + f(r.cn) + ' · ALB ' + f(r.alb) + ' · fijos 173', 'hot') +
      tile('Costo por 1,000', 'US$' + f(r.c1k, 4), 'infra ÷ predicciones del mes × 1,000') +
      tile('Backfill', f(r.tbf, 1) + ' h', f(r.gh, 1) + ' GPU-h → US$' + f(r.cbf));
  }
  document.getElementById('calc').addEventListener('input', render);
  document.getElementById('calc').addEventListener('submit', function (e) { e.preventDefault(); });
  render();
})();`;

const HEAD = `<title>Formulario de estimaciones</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,400..700&display=swap">
<style>${CSS}</style>`;
const BODY = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Parte 2 · estimaciones de C01</p>
    <h1>Formulario de estimaciones</h1>
    <p class="lead">Las nueve cuentas de la sección de estimaciones, cada una con su fórmula en variables, qué significa cada símbolo, el ejemplo de C01 paso a paso, una figura y un truco para recordarla. En la versión web, al final hay una calculadora para cambiar los supuestos.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><i class="dot" style="background:var(--accent2)"></i>Valores de C01 en verde</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${l}</a></li>`).join('')}</ul></nav>
  ${CONST}
  ${CHAIN}
  ${S.join('\n')}
  ${CALC}
  <footer>Números y precios del curso (C01, M1, M3, M4, M13), aproximados para us-east-1: verifica precios en la calculadora de AWS. Las cotas de hardware se <b>miden</b>; en la entrevista, dilo así.</footer>
</div>
<script>${JS}</script>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';
const dir = process.argv[2];
writeFileSync(dir + '/head.html', HEAD);
writeFileSync(dir + '/body.html', BODY);
writeFileSync(dir + '/src.html', '<!doctype html>\n' + HEAD + BODY.replace('<script>', KATEX + '<script>'));
console.log('ok', (HEAD + BODY).length, 'bytes ·', (BODY.match(/data-tex=/g) || []).length, 'fórmulas');
