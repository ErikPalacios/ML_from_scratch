/* Práctica de M01: formulario y plantillas de cálculo con datos nuevos en cada ronda (lo usa js/ui/drill.js).
   Cada plantilla recibe `r` (generador de números de js/ui/drill.js) y devuelve
   {q, unit, answer, tol, steps}: tol = tolerancia relativa (0.15 = ±15 %); 0 = respuesta exacta.
   Las convenciones son las de M01: 1 día = 86,400 s, mes de 30 días, utilización objetivo y N+1. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.drillBank = MSD.drillBank || {};
  const B = (MSD.drillBank.m01 = MSD.drillBank.m01 || {});

  // Formato de números como en el curso: miles con coma, decimales con punto.
  const f = (x, d) => {
    const n = Number(x);
    const dec = d === undefined ? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2) : d;
    return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };
  const DAY = 86400;

  B.formulas = [
    { title: 'Promedio de tráfico', expr: 'req/s promedio = volumen diario ÷ 86,400', ex: '10 M/día ÷ 86,400 ≈ 116 req/s · atajo: 1 M/día ≈ 11.6 req/s', section: 'estimaciones-express' },
    { title: 'Pico y pico de diseño', expr: 'pico = promedio × factor de pico (≈ 2–5×; 3× en el caso 1) · diseño = pico + margen para spikes', ex: '116 × 3 ≈ 350 req/s → diseñas para 500 req/s', section: 'estimaciones-express' },
    { title: 'Desde usuarios', expr: 'volumen diario = usuarios activos/día × acciones por usuario', ex: '5 M usuarios × 4 fotos = 20 M/día ≈ 231 req/s promedio', section: 'estimaciones-express' },
    { title: 'GPUs', expr: 'GPUs = ⌈ pico de diseño ÷ (capacidad medida por GPU × utilización objetivo) ⌉ + 1 (N+1)', ex: '⌈500 ÷ (1,200 × 0.5)⌉ + 1 = 1 + 1 = 2 GPUs', section: 'estimaciones-express' },
    { title: 'Requests en vuelo (Little)', expr: 'L = λ × W · concurrencia = throughput × latencia media', ex: '500 req/s × 0.05 s = 25 en vuelo; con 200 ms → 100', section: 'estimaciones-express' },
    { title: 'Almacenamiento', expr: 'bytes/día = eventos/día × tamaño de cada uno · ×365 por año', ex: '10 M × 300 B = 3 GB/día ≈ 1.1 TB/año', section: 'estimaciones-express' },
    { title: 'Memoria de pesos', expr: 'pesos = parámetros × bytes por valor (FP32 4 · FP16/BF16 2 · INT8 1)', ex: 'ResNet-50: 25.6 M × 4 B ≈ 102 MB · LLM 7 B en FP16 ≈ 14 GB', section: 'estimaciones-express' },
    { title: 'Tensor de imágenes', expr: 'bytes = alto × ancho × canales × bytes por valor × batch', ex: '224×224×3 = 150,528 valores · float32 ≈ 602 KB · batch 32 ≈ 19 MB', section: 'estimaciones-express' },
    { title: 'Disponibilidad → caída permitida', expr: 'minutos de caída al mes = (1 − disponibilidad) × 43,200 (mes de 30 días)', ex: '99.9 % → ≈ 43 min/mes · 99.99 % → ≈ 4.3 min/mes (≈ 4.4 si usas el mes de 730 h) · 99 % → ≈ 7.2 h', section: 'estimaciones-express' },
    { title: 'Unidades rápidas', expr: '1 día = 86,400 s ≈ 10⁵ s · 1 mes ≈ 2.6 M s · 1 KB = 10³ B · 1 GB = 10⁹ B · 1 TB = 10¹² B', ex: 'Redondea primero, calcula después: el entrevistador quiere el orden de magnitud y el porqué', section: 'estimaciones-express' },
  ];

  B.calc = [
    {
      id: 'c-qps-prom', section: 'estimaciones-express', title: 'Tráfico promedio',
      gen(r) {
        const m = r.pick([2, 4, 5, 8, 12, 20, 30, 50, 80, 150]);
        const thing = r.pick([['fotos', 'suben'], ['predicciones', 'se piden'], ['documentos', 'se procesan'], ['búsquedas', 'se hacen']]);
        const avg = (m * 1e6) / DAY;
        return {
          q: 'Al día ' + thing[1] + ' <b>' + f(m) + ' M de ' + thing[0] + '</b>. ¿Cuántos requests por segundo llegan <b>en promedio</b>?',
          unit: 'req/s', answer: avg, tol: 0.15,
          steps: [f(m) + ' M ÷ 86,400 s = ' + f(m * 1e6) + ' ÷ 86,400 ≈ <b>' + f(avg) + ' req/s</b>',
            'Atajo: 1 M/día ≈ 11.6 req/s → ' + f(m) + ' × 11.6 ≈ ' + f(m * 11.574)],
        };
      },
    },
    {
      id: 'c-qps-pico', section: 'estimaciones-express', title: 'Pico de tráfico',
      gen(r) {
        const m = r.pick([5, 10, 15, 20, 40, 60, 100]);
        const k = r.pick([2, 3, 4, 5]);
        const avg = (m * 1e6) / DAY;
        return {
          q: 'Un servicio recibe <b>' + f(m) + ' M requests al día</b> y en la hora pico llega <b>' + k + '×</b> el promedio. ¿Cuántos req/s tiene el <b>pico</b>?',
          unit: 'req/s', answer: avg * k, tol: 0.15,
          steps: ['Promedio: ' + f(m) + ' M ÷ 86,400 ≈ ' + f(avg) + ' req/s',
            'Pico: ' + f(avg) + ' × ' + k + ' ≈ <b>' + f(avg * k) + ' req/s</b>',
            'En la entrevista diseñas para el pico con margen, no para el promedio.'],
        };
      },
    },
    {
      id: 'c-usuarios', section: 'estimaciones-express', title: 'De usuarios a pico',
      gen(r) {
        const u = r.pick([1, 2, 3, 5, 8, 10, 20]);
        const a = r.pick([2, 3, 4, 5, 10]);
        const k = r.pick([2, 3, 4]);
        const vol = u * 1e6 * a;
        const avg = vol / DAY;
        return {
          q: 'Una app tiene <b>' + f(u) + ' M de usuarios activos al día</b>; cada uno hace en promedio <b>' + a + ' requests</b> que pasan por el modelo. El pico es <b>' + k + '×</b> el promedio. ¿Cuántos req/s en el <b>pico</b>?',
          unit: 'req/s', answer: avg * k, tol: 0.15,
          steps: ['Volumen: ' + f(u) + ' M × ' + a + ' = ' + f(vol / 1e6) + ' M requests/día',
            'Promedio: ' + f(vol) + ' ÷ 86,400 ≈ ' + f(avg) + ' req/s',
            'Pico: ' + f(avg) + ' × ' + k + ' ≈ <b>' + f(avg * k) + ' req/s</b>'],
        };
      },
    },
    {
      id: 'c-gpus', section: 'estimaciones-express', title: 'Cuántas GPUs',
      gen(r) {
        const p = r.pick([300, 500, 800, 1200, 2000, 3500, 5000, 8000]);
        const c = r.pick([400, 600, 800, 1000, 1200, 1500, 2000]);
        const u = r.pick([0.5, 0.6, 0.7]);
        const thr = Math.ceil(p / (c * u));
        return {
          q: 'Pico de diseño: <b>' + f(p) + ' req/s</b>. Una GPU sostiene <b>' + f(c) + ' req/s</b> cumpliendo el SLO de latencia (medido con perf_analyzer) y planeas con utilización objetivo de <b>' + Math.round(u * 100) + ' %</b>. Con redundancia <b>N+1</b>, ¿cuántas GPUs pides en total?',
          unit: 'GPUs', answer: thr + 1, tol: 0,
          steps: ['Capacidad planificada por GPU: ' + f(c) + ' × ' + u + ' = ' + f(c * u) + ' req/s',
            'Por throughput: ⌈' + f(p) + ' ÷ ' + f(c * u) + '⌉ = ⌈' + f(p / (c * u), 2) + '⌉ = ' + thr,
            'N+1 (otra zona de disponibilidad): ' + thr + ' + 1 = <b>' + (thr + 1) + ' GPUs</b>'],
        };
      },
    },
    {
      id: 'c-little', section: 'estimaciones-express', title: 'Requests en vuelo',
      gen(r) {
        const l = r.pick([100, 200, 350, 500, 800, 1500, 3000]);
        const w = r.pick([20, 40, 50, 80, 120, 200, 300]);
        const L = l * (w / 1000);
        return {
          q: 'Tu servicio atiende <b>' + f(l) + ' req/s</b> con latencia media de <b>' + w + ' ms</b>. ¿Cuántos requests hay <b>en vuelo</b> al mismo tiempo, en promedio?',
          unit: 'requests', answer: L, tol: 0.15,
          steps: ['Little: L = λ × W = ' + f(l) + ' req/s × ' + f(w / 1000, 3) + ' s = <b>' + f(L) + ' requests en vuelo</b>',
            'Si la latencia se duplica, la concurrencia también: por eso latencia y capacidad se planean juntas.'],
        };
      },
    },
    {
      id: 'c-little-inv', section: 'estimaciones-express', title: 'Throughput máximo con concurrencia fija',
      gen(r) {
        const L = r.pick([16, 32, 50, 64, 100, 128, 200]);
        const w = r.pick([25, 40, 50, 80, 100, 160, 250]);
        const lam = L / (w / 1000);
        return {
          q: 'Tu servidor admite como máximo <b>' + L + ' requests en vuelo</b> y cada uno tarda en promedio <b>' + w + ' ms</b>. ¿Cuál es el <b>throughput máximo</b> antes de que se forme cola?',
          unit: 'req/s', answer: lam, tol: 0.15,
          steps: ['Little despejada: λ = L ÷ W = ' + L + ' ÷ ' + f(w / 1000, 3) + ' s ≈ <b>' + f(lam) + ' req/s</b>',
            'Por encima de eso los requests esperan en cola y la latencia sube.'],
        };
      },
    },
    {
      id: 'c-logs', section: 'estimaciones-express', title: 'Logs de predicción por año',
      gen(r) {
        const m = r.pick([5, 10, 20, 50, 100]);
        const b = r.pick([200, 300, 500, 800, 1000]);
        const day = m * 1e6 * b;
        const yearTB = (day * 365) / 1e12;
        return {
          q: 'Guardas un log de <b>' + f(b) + ' B</b> por cada predicción y haces <b>' + f(m) + ' M predicciones al día</b>. ¿Cuántos <b>TB al año</b> ocupan los logs (sin comprimir)?',
          unit: 'TB/año', answer: yearTB, tol: 0.15,
          steps: ['Por día: ' + f(m) + ' M × ' + f(b) + ' B = ' + f(day / 1e9) + ' GB/día',
            'Por año: ' + f(day / 1e9) + ' GB × 365 ≈ ' + f((day * 365) / 1e9) + ' GB ≈ <b>' + f(yearTB) + ' TB/año</b>',
            'Barato: guardas el 100 % de los logs y solo una referencia a la imagen.'],
        };
      },
    },
    {
      id: 'c-imgs', section: 'estimaciones-express', title: 'Guardar las imágenes',
      gen(r) {
        const m = r.pick([1, 2, 5, 10, 20]);
        const kb = r.pick([100, 150, 200, 300, 500]);
        const tb = (m * 1e6 * kb * 1e3) / 1e12;
        return {
          q: 'Si guardaras <b>todas</b> las imágenes: <b>' + f(m) + ' M imágenes al día</b> de <b>' + kb + ' KB</b> cada una. ¿Cuántos <b>TB por día</b>?',
          unit: 'TB/día', answer: tb, tol: 0.15,
          steps: [f(m) + ' M × ' + kb + ' KB = ' + f(m * kb) + ' GB ≈ <b>' + f(tb) + ' TB/día</b> (1 M × 1 KB = 1 GB)',
            'Por eso se muestrea (≈ 1 %) en vez de copiar todo: la foto ya vive en el almacenamiento del producto.'],
        };
      },
    },
    {
      id: 'c-muestreo', section: 'estimaciones-express', title: 'Muestreo para etiquetar',
      gen(r) {
        const m = r.pick([2, 5, 10, 20, 40]);
        const pct = r.pick([0.1, 0.5, 1, 2]);
        const day = m * 1e6 * (pct / 100);
        return {
          q: 'Llegan <b>' + f(m) + ' M requests al día</b> y muestreas el <b>' + pct + ' %</b> para revisión y posible etiquetado. ¿Cuántos ejemplos muestreas <b>al mes</b> (30 días)?',
          unit: 'ejemplos/mes', answer: day * 30, tol: 0.15,
          steps: ['Por día: ' + f(m) + ' M × ' + pct + ' % = ' + f(day) + ' ejemplos/día',
            'Por mes: ' + f(day) + ' × 30 = <b>' + f(day * 30) + ' ejemplos/mes</b>',
            'Etiquetar todo eso cuesta: de ahí sale cuántos eliges con active learning.'],
        };
      },
    },
    {
      id: 'c-dispo', section: 'estimaciones-express', title: 'Disponibilidad',
      gen(r) {
        const a = r.pick([99, 99.5, 99.9, 99.95, 99.99]);
        const min = (1 - a / 100) * 43200;
        return {
          q: 'Tu SLO de disponibilidad es <b>' + a + ' %</b>. ¿Cuántos <b>minutos de caída al mes</b> (30 días) te permite?',
          unit: 'min/mes', answer: min, tol: 0.15,
          steps: ['Mes: 30 × 24 × 60 = 43,200 min',
            'Caída: (1 − ' + f(a / 100, 4) + ') × 43,200 = ' + f(1 - a / 100, 4) + ' × 43,200 ≈ <b>' + f(min) + ' min/mes</b>' + (min >= 60 ? ' (≈ ' + f(min / 60, 1) + ' h)' : '')],
        };
      },
    },
    {
      id: 'c-pesos', section: 'estimaciones-express', title: 'Memoria de los pesos',
      gen(r) {
        const m = r.pick([[25.6, 'M', 'un ResNet-50'], [86, 'M', 'un ViT-Base'], [300, 'M', 'un modelo de visión grande'], [1.3, 'B', 'un modelo de lenguaje pequeño'], [7, 'B', 'un LLM'], [13, 'B', 'un LLM']]);
        const dt = r.pick([['FP32', 4], ['FP16', 2], ['INT8', 1]]);
        const params = m[0] * (m[1] === 'B' ? 1e9 : 1e6);
        const gb = (params * dt[1]) / 1e9;
        const useMB = gb < 1;
        return {
          q: '¿Cuánta memoria ocupan solo los <b>pesos</b> de ' + m[2] + ' de <b>' + f(m[0]) + ' ' + m[1] + ' parámetros</b> en <b>' + dt[0] + '</b>? Responde en <b>' + (useMB ? 'MB' : 'GB') + '</b>.',
          unit: useMB ? 'MB' : 'GB', answer: useMB ? gb * 1000 : gb, tol: 0.15,
          steps: [dt[0] + ' = ' + dt[1] + ' B por valor',
            f(m[0]) + ' ' + m[1] + ' × ' + dt[1] + ' B = <b>' + (useMB ? f(gb * 1000) + ' MB' : f(gb) + ' GB') + '</b>',
            'Es solo la memoria de los pesos: en serving se suman activaciones y overhead del runtime (<a href="#m04.vram">M4</a>).'],
        };
      },
    },
    {
      id: 'c-tensor', section: 'estimaciones-express', title: 'Batch de imágenes en memoria',
      gen(r) {
        const s = r.pick([224, 256, 384, 512]);
        const bsz = r.pick([8, 16, 32, 64]);
        const dt = r.pick([['float32', 4], ['float16', 2], ['uint8', 1]]);
        const vals = s * s * 3;
        const mb = (vals * dt[1] * bsz) / 1e6;
        return {
          q: 'Un batch de <b>' + bsz + '</b> imágenes de <b>' + s + '×' + s + '×3</b> en <b>' + dt[0] + '</b>. ¿Cuántos <b>MB</b> ocupa el tensor de entrada?',
          unit: 'MB', answer: mb, tol: 0.15,
          steps: ['Valores por imagen: ' + s + ' × ' + s + ' × 3 = ' + f(vals),
            'Bytes por imagen: ' + f(vals) + ' × ' + dt[1] + ' B = ' + f((vals * dt[1]) / 1e3) + ' KB',
            'Batch: × ' + bsz + ' ≈ <b>' + f(mb) + ' MB</b>'],
        };
      },
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
