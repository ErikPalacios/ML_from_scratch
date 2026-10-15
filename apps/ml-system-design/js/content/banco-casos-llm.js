/* Banco de problemas · Casos de diseño · LLMs y RAG: costo por tokens, TTFT y streaming de tokens, contexto de RAG, jobs offline con LLM, agentes y cascadas.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js. Precios por millón de tokens: la lista ilustrativa de c10 (US$2.50 / US$10)
   y supuestos realistas para 2026, rotulados en cada enunciado; prefijo en caché ≈ 10 % del precio de entrada y
   batch API ≈ −50 % (M14); el modelo chico de una familia ≈ 1/10 del precio (supuesto). Cada plantilla agrupa sus
   combinaciones por resultado (se calculan una sola vez, al primer uso) y elige primero el resultado: así cada
   decisión sale pareja, gana con ≥ 10 % de margen y ningún cociente redondeado cambia una cuenta. Donde un dato solo
   delataría la respuesta (el dominio en llm-03, la espera W en llm-02 y llm-05, el piso y las fracciones en llm-06),
   ese dato se elige antes, entre los valores que admiten todos los resultados. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'llm')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  // ------------------------------------------------------------------ utilidades del tema
  // Precio por millón con sus centavos: 2.50 · 0.125 · 15.
  const pz = (x) => (Number.isInteger(x) ? f(x, 0) : Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }));
  // Listas de precio por millón de tokens [entrada, salida, rótulo].
  const LISTAS = [
    [2.5, 10, 'lista ilustrativa de c10, aprox.'],
    [3, 15, 'supuesto, aprox.'],
    [1.25, 10, 'supuesto, aprox.'],
  ];
  const usd = (tin, tout, pr) => (tin * pr[0] + tout * pr[1]) / 1e6;   // US$ por request
  // v queda a ≥ 10 % de cada x (relativo a v).
  const lejos = (v, xs) => {
    for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i] / v - 1) < 0.1) return false;
    return true;
  };
  // Número redondo (dos cifras significativas; se usa con montos ≥ 100) en [lo, hi], a ≥ 10 % de cada x: el primero que
  // sirve buscando desde la media geométrica hacia afuera, un paso de la grilla (…, 98, 99, 100, 110, …) por lado.
  const escala = (v) => { let p = 1; while (v >= 100 * p) p *= 10; while (v < 10 * p) p /= 10; return p; };
  const paso = (v, dir) => {
    const p = escala(v);
    const m = Math.round(v / p);
    return dir > 0 ? (m + 1) * p : m === 10 ? 99 * (p / 10) : (m - 1) * p;
  };
  function redondo(lo, hi, xs) {
    const mid = Math.sqrt(lo * hi);
    const ok = (v) => v >= lo && v <= hi && lejos(v, xs);
    let a = Math.round(mid / escala(mid)) * escala(mid);
    let b = a;
    if (ok(a)) return a;
    for (let i = 0; i < 300 && (a >= lo || b <= hi); i++) {
      a = paso(a, -1);
      b = paso(b, 1);
      if (ok(a) && (!ok(b) || Math.abs(Math.log(a / mid)) <= Math.abs(Math.log(b / mid)))) return a;
      if (ok(b)) return b;
    }
    return null;
  }
  // El valor de la lista en [lo, hi] (hi puede ser Infinity) a ≥ 10 % de cada x, el más cercano a la media geométrica.
  function enLista(list, lo, hi, xs) {
    const mid = Number.isFinite(hi) ? Math.sqrt(lo * hi) : lo * 1.3;
    let best = null;
    for (const v of list) if (v >= lo && v <= hi && lejos(v, xs) && (best === null || Math.abs(Math.log(v / mid)) < Math.abs(Math.log(best / mid)))) best = v;
    return best;
  }

  // ------------------------------------------------------------------ llm-01: la palanca de menos riesgo que alcanza
  // [k requests al día, tokens de entrada, fracción que es prefijo fijo, tokens de salida, salida corta, lista, presupuesto],
  // por resultado: caché, respuestas cortas o modelo chico. Todos los costos quedan a ≥ 10 % del presupuesto, que va
  // de 1/8 a 1/1.1 de la factura de hoy (el del medio de los que sirven, uno por combinación y resultado).
  const PRES01 = [500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000];
  let g01 = null;
  function grupos01() {
    if (g01) return g01;
    g01 = { cache: [], breve: [], chico: [] };
    const cerca = (x, bud) => x > 0.9 * bud && x < 1.1 * bud;
    for (const nk of [10, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200]) for (const tin of [1500, 2000, 2500, 3000, 4000]) for (const pf of [0.4, 0.5, 0.6, 0.75]) for (const tout of [300, 400, 500, 600, 800]) for (const cap of [100, 150, 200, 250]) {
      if (cap > 0.6 * tout) continue;
      for (let pi = 0; pi < LISTAS.length; pi++) {
        const n = nk * 1000 * 30;
        const hoy = n * usd(tin, tout, LISTAS[pi]);
        const cache = n * usd(tin - 0.9 * tin * pf, tout, LISTAS[pi]);
        const breve = n * usd(tin, cap, LISTAS[pi]);
        const juntas = n * usd(tin - 0.9 * tin * pf, cap, LISTAS[pi]);
        const ok = { cache: [], breve: [], chico: [] };
        for (const bud of PRES01) {   // de menor a mayor
          if (hoy < 1.1 * bud) break;
          if (hoy > 8 * bud || cerca(cache, bud) || cerca(breve, bud) || cerca(juntas, bud) || cerca(hoy / 10, bud)) continue;
          const o = cache < bud ? 'cache' : breve < bud ? 'breve' : juntas > bud && hoy / 10 < bud ? 'chico' : null;
          if (o) ok[o].push(bud);
        }
        for (const o of ['cache', 'breve', 'chico']) if (ok[o].length) g01[o].push([nk, tin, pf, tout, cap, pi, ok[o][ok[o].length >> 1]]);
      }
    }
    return g01;
  }

  // ------------------------------------------------------------------ llm-02: acortar o streaming
  // [TTFT s, TPOT ms, tokens de salida, s que pide UX, mínimo de producto], por W y por resultado: acortar gana si
  // caben ≥ 15 % más tokens que el mínimo; streaming, si caben ≥ 13 % menos. W se elige entre los que admiten los dos
  // resultados (con W = 10 s siempre alcanzaba acortar).
  let g02 = null;
  function grupos02() {
    if (g02) return g02;
    const por = {};
    [0.3, 0.4, 0.5, 0.6, 0.8].forEach((a) => [20, 25, 30, 40, 50].forEach((t) => [250, 300, 400, 500, 600, 800].forEach((n) => [3, 4, 5, 6, 8, 10].forEach((W) => [60, 80, 100, 120, 150, 200].forEach((nmin) => {
      const e2e = a + ((n - 1) * t) / 1000;
      const cabe = floorx((W - a) / (t / 1000)) + 1;
      if (e2e < 1.15 * W || nmin > 0.6 * n || a > W / 3) return;
      const o = cabe >= 1.15 * nmin ? 'cortas' : cabe <= 0.87 * nmin ? 'stream' : null;
      if (o) (por[W] = por[W] || { cortas: [], stream: [] })[o].push([a, t, n, W, nmin]);
    })))));
    g02 = { por, ws: Object.keys(por).map(Number).filter((W) => por[W].cortas.length && por[W].stream.length) };
    return g02;
  }

  // ------------------------------------------------------------------ llm-03: k chunks o reranker
  // Cuatro sub-casos: gana bajar k por costo (Kc) o por latencia (Kl: el p95 del reranker rompe el SLO), o gana el
  // reranker por costo (Rc) o por latencia (Rl). En cada uno la otra restricción la cumplen las dos opciones, y hoy no
  // se cumple alguna. Presupuesto redondo; el SLO sale de la lista (cada combinación guarda los que sirven). Se elige
  // dominio → sub-caso → combinación, así el dominio no delata la respuesta (antes, manufactura nunca daba Rl y "hoy
  // solo falla la latencia" daba siempre el reranker). Lo que queda correlacionado es física: un SLO ajustado o un
  // reranker lento favorecen bajar k; un prefill lento o mucho volumen, el reranker (ningún dato decide solo).
  const D03 = [
    { org: 'Un estudio de abogados', docs: 'sus contratos, escritos y jurisprudencia interna', S: 1000, H: 300, o: 400, cs: [600, 800] },
    { org: 'Una red de hospitales', docs: 'sus protocolos clínicos y guías internas', S: 800, H: 200, o: 300, cs: [400, 500] },
    { org: 'Una planta de manufactura', docs: 'los manuales de mantenimiento de sus máquinas', S: 600, H: 100, o: 300, cs: [400, 500] },
    { org: 'Una distribuidora eléctrica', docs: 'sus normas técnicas y procedimientos de seguridad', S: 800, H: 200, o: 250, cs: [500, 600] },
  ];
  const K03 = [[12, 8, 4], [16, 10, 5], [20, 12, 6], [16, 8, 4]];   // [k de hoy, mínimo sin reranker, con reranker]
  // [fijo del TTFT (s), s por cada 1,000 tokens de prompt, p95 del reranker (s)]. c11: ≈ 0.24–0.37 s por pregunta en una
  // L4 con pares de ≈ 450 tokens (bge-reranker o Qwen3-Reranker-0.6B); 0.6 s de p95 cabe con pares más largos.
  const LAT03 = [];
  [0.3, 0.5].forEach((a0) => [0.1, 0.15, 0.2, 0.3].forEach((b) => [0.25, 0.4, 0.6].forEach((rr) => LAT03.push([a0, b, rr]))));
  const RR_MES = 2 * 0.805 * MES_H;   // 2 × L4 (g6.xlarge, una por zona) del reranker, ≈ US$1,175/mes
  const XS03 = [1, 1.2, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 3, 3.5, 4, 4.5, 5];   // SLOs de TTFT posibles (s)
  const SUB03 = ['Kc', 'Kl', 'Rc', 'Rl'];
  let g03 = null;
  function grupos03() {
    if (g03) return g03;
    g03 = D03.map(() => ({ Kc: [], Kl: [], Rc: [], Rl: [] }));
    D03.forEach((dm, di) => dm.cs.forEach((c) => K03.forEach((ks, ki) => {
      const tok = ks.map((k) => dm.S + dm.H + k * c);                    // hoy, k mínimo, con reranker
      // El SLO solo depende de las latencias: los de la lista a ≥ 10 % de las tres, por sub-caso.
      const slo = LAT03.map((lt) => {
        const lat = tok.map((p) => 0.2 + lt[0] + (lt[1] * p) / 1000);
        lat[2] += lt[2];
        const sirven = (lo, hi) => XS03.filter((v) => v >= lo && v <= hi && lejos(v, lat));
        const lo = Math.max(lat[1], lat[2]) / 0.9;
        const ambos = sirven(lo, 2 * lo);                                  // cumplen las dos opciones
        return {
          Kc: ambos,
          Rc: ambos,
          Rl: sirven(lat[2] / 0.9, lat[1] / 1.1),                          // solo el reranker cumple
          Kl: sirven(lat[1] / 0.9, Math.min(lat[0], lat[2]) / 1.1),        // solo bajar k cumple
        };
      });
      LISTAS.forEach((pr, pi) => [100, 200, 300, 500, 800, 1000, 1500, 2000].forEach((qk) => {
        const cost = tok.map((p) => qk * 1000 * usd(p, dm.o, pr));
        cost[2] += RR_MES;
        const bBoth = Math.max(cost[1], cost[2]) / 0.9;
        // El presupuesto solo depende de los costos: uno por sub-caso (null si la ventana no deja margen).
        const pres = {};
        [['Kc', cost[1] / 0.9, Math.min(cost[0], cost[2]) / 1.1], ['Rc', cost[2] / 0.9, cost[1] / 1.1], ['Kl', bBoth, bBoth * 1.6], ['Rl', bBoth, bBoth * 1.6]]
          .forEach(([sub, lo, hi]) => { pres[sub] = hi < 1.1 * lo ? null : redondo(lo, hi, cost); });
        slo.forEach((xs, li) => SUB03.forEach((sub) => {
          if (xs[sub].length && pres[sub]) g03[di][sub].push([c, ki, pi, qk, li, xs[sub], pres[sub]]);
        }));
      }));
    })));
    // Rc con SLO ajustado (≤ 1.8 s): se usa 3 de cada 10 veces, para que un SLO ajustado no signifique "bajar k".
    g03.forEach((d) => { d.Rt = d.Rc.map((x) => x.slice(0, 5).concat([x[5].filter((v) => v <= 1.8), x[6]])).filter((x) => x[5].length); });
    return g03;
  }

  // ------------------------------------------------------------------ llm-04: batch API, API online o GPUs propias
  const D04 = [
    { org: 'Un organismo de servicios públicos', tarea: 'clasificar por tipo de trámite su archivo de solicitudes ciudadanas', que: 'solicitudes', cada: 'cada una', tins: [800, 1200], tout: 40 },
    { org: 'Una cadena de supermercados', tarea: 'etiquetar por tema y sentimiento las reseñas de sus productos', que: 'reseñas', cada: 'cada una', tins: [600, 1000], tout: 40 },
    { org: 'Un diario', tarea: 'resumir y etiquetar las notas de su archivo histórico', que: 'notas', cada: 'cada una', tins: [1500, 2500], tout: 200 },
    { org: 'Una empresa de software', tarea: 'resumir sus tickets de soporte históricos para un buscador interno', que: 'tickets', cada: 'cada uno', tins: [1500, 2000], tout: 150 },
  ];
  const LISTAS04 = LISTAS.concat([[0.4, 1.6, 'supuesto para un modelo mediano, aprox.']]);
  // Documentos/s por L4 con un 8B abierto en FP8 en vLLM (supuesto: ≈ 6,000 tokens de entrada y ≈ 800 de salida por
  // segundo por L4, repartidos entre prefill y decode), con dos cifras: el valor que se muestra es el que se usa.
  // En FP8 es plausible: 6,000 tokens/s de prefill son ≈ 96 TFLOPS (≈ 40 % de los ≈ 242 de la L4) y los 8 GB de pesos
  // dejan KV para decenas de secuencias cortas. En BF16 no: el prefill pediría ≈ 80 % del pico y el decode no llega.
  const docsL4 = (tin, tout) => Number((1 / (tin / 6000 + tout / 800)).toPrecision(2));
  function calc04(D, tin, tout, pr, tpm, G, F) {
    const rr = docsL4(tin, tout);
    const list = D * 1e6 * usd(tin, tout, pr);
    const gpuH = (D * 1e6) / (rr * 3600);
    return { rr, list, batch: list / 2, onH: (D * 1e6 * (tin + tout)) / (tpm * 1e6 * 60), gpuH, selfH: gpuH / G, self: gpuH * 0.805 + F };
  }
  // [dominio, tokens de entrada, M documentos, lista, M tokens/min de cuota, L4 máximas, costo de montarlo, plazo (h)],
  // por la opción más barata que termina a tiempo, con ≥ 10 % de margen en costo y en cada plazo.
  let g04 = null;
  function grupos04() {
    if (g04) return g04;
    g04 = { batch: [], online: [], self: [] };
    const cerca = (x, H) => x > 0.9 * H && x < 1.1 * H;
    D04.forEach((dm, di) => dm.tins.forEach((tin) => [0.5, 1, 2, 3, 5, 8, 10, 20].forEach((D) => LISTAS04.forEach((pr, pi) => {
      const rr = docsL4(tin, dm.tout);
      const list = D * 1e6 * usd(tin, dm.tout, pr);
      const gpuH = (D * 1e6) / (rr * 3600);
      for (const tpm of [1, 2, 4]) for (const G of [8, 16, 32]) for (const F of [5000, 8000]) for (const H of [6, 8, 12, 18, 48, 72, 120, 168]) {
        const onH = (D * 1e6 * (tin + dm.tout)) / (tpm * 1e6 * 60);
        if (cerca(onH, H) || cerca(gpuH / G, H)) continue;
        // [opción, costo] de las que llegan a tiempo; gana la más barata, por ≥ 10 %
        let w = null;
        let w2 = null;
        const ver = (o, c) => { if (!w || c < w[1]) { w2 = w; w = [o, c]; } else if (!w2 || c < w2[1]) w2 = [o, c]; };
        if (H >= 48) ver('batch', list / 2);
        if (onH < H) ver('online', list);
        if (gpuH / G < H) ver('self', gpuH * 0.805 + F);
        if (!w || (w2 && w[1] > 0.9 * w2[1])) continue;
        g04[w[0]].push([di, tin, D, pi, tpm, G, F, H]);
      }
    }))));
    return g04;
  }

  // ------------------------------------------------------------------ llm-05: agente síncrono o asíncrono
  const D05 = [
    { org: 'Una aerolínea', tarea: 'cambie vuelos: consulta la reserva y las alternativas, y emite el cambio cobrando la diferencia', tool: 'emitir_cambio', efecto: 'emite el cambio y cobra la diferencia', dup: 'cobrar la diferencia', estado: 'buscando vuelos…' },
    { org: 'Una empresa de paquetería', tarea: 'reprograme entregas: consulta el envío, la ruta y los horarios libres, y reprograma', tool: 'reprogramar_entrega', efecto: 'reprograma la entrega y avisa al repartidor', dup: 'reprogramar la entrega', estado: 'consultando tu envío…' },
    { org: 'Una fintech de pagos', tarea: 'gestione disputas de cargos: consulta la transacción y el comercio, y abre la disputa con un crédito provisional', tool: 'abrir_disputa', efecto: 'abre la disputa y acredita el monto', dup: 'acreditar el monto', estado: 'revisando el cargo…' },
    { org: 'Una plataforma de videojuegos', tarea: 'resuelva reclamos de compras dentro del juego: consulta la compra y el inventario, y reembolsa o repone el ítem', tool: 'reembolsar_compra', efecto: 'reembolsa la compra', dup: 'reembolsar la compra', estado: 'revisando tu compra…' },
  ];
  // [pasos típicos, pasos extra en el p95, s por llamada que pide una tool, s por tool, s de la respuesta final, s que
  // tolera la persona], por W y por patrón: la cota p95 queda ≥ 10 % debajo (síncrono) o encima (asíncrono). W se elige
  // entre los que admiten los dos patrones (con W = 60 s siempre salía síncrono, con 20 s casi siempre asíncrono).
  let g05 = null;
  function grupos05() {
    if (g05) return g05;
    const por = {};
    [3, 4, 5].forEach((na) => [2, 3].forEach((ex) => [1.5, 2, 2.5, 3].forEach((L) => [0.5, 1, 2, 3].forEach((x) => [5, 6, 8].forEach((Ff) => [20, 25, 30, 40, 45, 60].forEach((W) => {
      const lat = (na + ex) * (L + x) + Ff;
      const o = lat <= 0.9 * W ? 'sync' : lat >= 1.1 * W ? 'async' : null;
      if (o) (por[W] = por[W] || { sync: [], async: [] })[o].push([na, ex, L, x, Ff, W]);
    }))))));
    g05 = { por, ws: Object.keys(por).map(Number).filter((W) => por[W].sync.length && por[W].async.length) };
    return g05;
  }

  // ------------------------------------------------------------------ llm-06: cascada de modelos
  const D06 = [
    { org: 'Un marketplace', tarea: 'responde las preguntas de quienes compran sobre cada producto', nuevo: 'una categoría nueva de productos' },
    { org: 'Una cooperativa agrícola', tarea: 'responde por WhatsApp consultas de productores sobre plagas, riego y fertilización', nuevo: 'una plaga nueva de temporada' },
    { org: 'El área de personas de una empresa grande', tarea: 'responde preguntas de empleados sobre políticas internas', nuevo: 'una política nueva de licencias' },
    { org: 'Una app de movilidad', tarea: 'responde dudas de conductores sobre pagos, tarifas y su cuenta', nuevo: 'un esquema nuevo de tarifas' },
  ];
  // Fracción que resuelve el chico con 0.9 · 0.8 · 0.7. Escalones de costo de ≥ 1.34× entre umbrales vecinos (y contra
  // todo al grande), para que el presupuesto quepa con ≥ 10 % de margen en cualquiera de los tres: con [0.3, 0.5, 0.7]
  // solo podía ganar 0.7, y 0.9 solo ganaba con [0.4, 0.6, 0.8], así que las fracciones delataban la respuesta.
  const FS06 = [[0.4, 0.6, 0.8], [0.45, 0.65, 0.85], [0.5, 0.7, 0.85]];
  // Perfiles [fracciones, acierto del chico con 0.9 · 0.8 · 0.7, acierto del grande en lo escalado, piso de calidad],
  // por el único umbral que cumple las dos cosas: la calidad baja al bajar el umbral (≥ 1 punto del piso) y el
  // presupuesto cabe entre el costo de ese umbral (≥ 10 % debajo) y el del umbral más alto (≥ 10 % encima). Se agrupan
  // por celda (fracciones, piso) y solo quedan las celdas donde puede ganar cualquiera de los tres umbrales: así ni el
  // piso ni las fracciones delatan la respuesta (antes, un piso de 85 % daba siempre 0.7 y uno de 93 %, casi siempre 0.9).
  let g06 = null;
  function grupos06() {
    if (g06) return g06;
    const por = {};
    FS06.forEach((fs, fi) => [0.94, 0.96, 0.98].forEach((a9) => [0.86, 0.88, 0.9, 0.92, 0.94].forEach((a8) => [0.78, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9].forEach((a7) => [0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94].forEach((qe) => {
      if (a9 - a8 < 0.02 - 1e-9 || a8 - a7 < 0.02 - 1e-9) return;      // el chico acierta menos al bajar el umbral
      [0.8, 0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.9, 0.91, 0.92, 0.93].forEach((qmin) => {
        const a = [a9, a8, a7];
        const q = fs.map((fv, k) => fv * a[k] + (1 - fv) * qe);
        // la calidad baja al bajar el umbral, ≥ 0.2 puntos por escalón (sin empates que el redondeo de punto flotante esconda)
        if (!(q[0] - q[1] > 0.002 - 1e-9 && q[1] - q[2] > 0.002 - 1e-9) || q[0] < qmin || q.some((x) => Math.abs(x - qmin) < 0.01 - 1e-9)) return;
        const hoy = Math.ceil(Math.max(...q) * 200 - 1e-9) / 200;          // el grande solo: al menos la mejor cascada
        if (hoy > 0.995 * fs[0] + (1 - fs[0]) * qe) return;                // y nunca más de 99.5 % en lo fácil
        if (fs[2] * a7 + (1 - fs[2]) * 0.6 > qmin - 0.02) return;          // todo al chico (≈ 60 % en lo más difícil)
        const k = q[2] >= qmin ? 2 : q[1] >= qmin ? 1 : 0;
        const rel = [1].concat(fs.map((fv) => 1.1 - fv));                 // hoy y cada umbral, × costo de todo al grande
        if (rel[k] / 1.1 < 1.1 * (rel[k + 1] / 0.9)) return;
        const celda = fi + '|' + qmin;
        (por[celda] = por[celda] || [[], [], []])[k].push([fi, a9, a8, a7, qe, qmin]);
      });
    })))));
    g06 = Object.keys(por).filter((c) => por[c].every((l) => l.length >= 3)).map((c) => por[c]);
    return g06;
  }

  B.formulas.push(
    { topic: 'llm', title: 'Costo de un request de LLM', expr: 'US$ = (tokens de entrada × precio de entrada + tokens de salida × precio de salida) ÷ 1 M · prefijo en caché ≈ 10 % del precio de entrada · batch API ≈ −50 % · modelo chico de la familia ≈ 1/10', ex: '(2,000 × 2.50 + 250 × 10) ÷ 1 M = US$0.0075 · 40k requests al día × 30 ≈ US$9,000/mes' },
    { topic: 'llm', title: 'Cuánto tarda una respuesta', expr: 'completa = TTFT + (tokens − 1) × TPOT · con streaming, la espera percibida es el TTFT · tokens que caben en W s = ⌊(W − TTFT) ÷ TPOT⌋ + 1', ex: '0.5 + 399 × 0.04 ≈ 16.5 s · en 6 s caben ⌊5.5 ÷ 0.04⌋ + 1 = 138 tokens · 40 ms por token = 25 tokens/s (una persona lee 4–7)' },
    { topic: 'llm', title: 'Prompt de RAG y su TTFT', expr: 'tokens = instrucciones + pregunta e historial + k × tokens por chunk · TTFT ≈ retrieval (+ reranker) + fijo + segundos por cada 1,000 tokens × tokens ÷ 1,000', ex: '800 + 200 + 12 × 500 = 7,000 tokens · 0.2 + 0.3 + 0.15 × 7 ≈ 1.55 s · el reranker suma su p95 y un costo fijo (2 × L4 ≈ US$1,175/mes)' },
    { topic: 'llm', title: 'Agentes y cascadas', expr: 'agente: p95 ≈ pasos × (llamada al LLM + tool) + respuesta final · entrada = (N + 1) × base + delta × N × (N + 1) ÷ 2 · cascada: costo = chico + fracción escalada × grande · calidad = f × acierto del chico + (1 − f) × acierto del grande', ex: '6 × (2 + 1) + 6 = 24 s · 4 pasos, base 3,000 y delta 500 → 20,000 tokens · 0.0008 + 0.45 × 0.008 = US$0.0044 por request' },
  );

  B.templates.push(
    // ======================================================== NIVEL 1
    {
      id: 'llm-01', topic: 'llm', level: 1, title: '¿Cuánto cuesta la API al mes?', ref: 'm14.costo-tokens',
      gen(r) {
        const d = r.pick([
          ['Una plataforma de cursos en línea', 'como tutor que explica la solución de cada ejercicio', 'instrucciones y ejemplos resueltos'],
          ['Una operadora de telefonía', 'para explicarle a cada cliente su factura del mes', 'instrucciones y el catálogo de planes'],
          ['Un portal inmobiliario', 'para responder preguntas sobre cada aviso', 'instrucciones y reglas de publicación'],
          ['Una app de delivery de comida', 'para responder dudas sobre pedidos y menús', 'instrucciones y políticas de la app'],
        ]);
        const o = r.pick(['cache', 'breve', 'chico']);
        const [nk, tin, pf, tout, cap, pi, bud] = r.pick(grupos01()[o]);
        const pr = LISTAS[pi];
        const P = tin * pf;
        const n = nk * 1000 * 30;
        const u = usd(tin, tout, pr);
        const uC = usd(tin - 0.9 * P, tout, pr);
        const hoy = n * u;
        const cache = n * uC;
        const breve = n * usd(tin, cap, pr);
        const juntas = n * usd(tin - 0.9 * P, cap, pr);
        const chico = hoy / 10;
        const xo = pr[1] / pr[0];   // cuántas entradas vale un token de salida
        const okC = 'Prompt caching del prefijo fijo';
        const okB = `Respuestas más cortas (≈ ${cap} tokens), con instrucciones de brevedad y max_tokens`;
        const okS = 'El modelo chico de la familia, a ≈ 1/10 del precio';
        const choices = r.shuffle([okC, okB, okS]);
        const entra = (x) => (x < bud ? 'entra' : 'no entra');
        return {
          q: `${d[0]} usa la API de un LLM ${d[1]}: ≈ <b>${nk}k requests al día</b>, cada uno con ≈ <b>${f(tin)} tokens de entrada</b> (${f(P)} son un prefijo fijo: ${d[2]}) y ≈ <b>${tout} de salida</b>. Precio (${pr[2]}): US$${pz(pr[0])} por millón de tokens de entrada y US$${pz(pr[1])} por millón de salida. Finanzas pide no pasar de <b>US$${f(bud)} al mes</b>.`,
          parts: [
            {
              ask: 'Costo mensual hoy (30 días)', unit: 'US$/mes', answer: hoy, tol: 0.15,
              steps: [
                'Planteamiento: por request = (tokens de entrada × su precio + tokens de salida × el suyo) ÷ 1 M; al mes, × requests al día × 30.',
                `(${f(tin)} × ${pz(pr[0])} + ${tout} × ${pz(pr[1])}) ÷ 1 M = US$${g(u)} por request → × ${nk}k × 30 = ${f(n / 1e6, 2)} M requests ≈ <b>US$${f(hoy)}/mes</b>, ${f(hoy / bud, 1)}× el presupuesto`,
                `La salida es el ${f(((tout * pr[1]) / (tin * pr[0] + tout * pr[1])) * 100, 0)} % de la factura con el ${f((tout / (tin + tout)) * 100, 0)} % de los tokens: cada token de salida cuesta ${f(xo, 0)}× uno de entrada.`,
              ],
            },
            {
              ask: 'Costo mensual con prompt caching (supón que todos los requests aciertan: el prefijo se cobra al 10 % del precio de entrada, aprox.; ignora lo que se cobra por escribir el caché)', unit: 'US$/mes', answer: cache, tol: 0.15,
              steps: [
                'Planteamiento: el prefijo fijo se cobra al 10 % del precio de entrada; el resto del prompt y la salida, a precio normal.',
                `(${f(tin - P)} × ${pz(pr[0])} + ${f(P)} × ${pz(pr[0] / 10)} + ${tout} × ${pz(pr[1])}) ÷ 1 M = US$${g(uC)} por request → × ${f(n / 1e6, 2)} M ≈ <b>US$${f(cache)}/mes</b> (${f((1 - cache / hoy) * 100, 0)} % menos)`,
                'Para acertar, el prefijo va primero y es idéntico en todos (nada variable, como la fecha o el nombre, antes de él). En la realidad algunos requests fallan y algunos proveedores cobran la escritura del caché (≈ 1.25× el precio de entrada): el ahorro real es algo menor.',
              ],
            },
            {
              ask: `Palancas, de menos a más riesgo para la calidad: prompt caching del prefijo, respuestas de ≈ ${cap} tokens (producto las acepta) y el modelo chico de la familia, a ≈ 1/10 del precio (supuesto). ¿Cuál, sola, te deja dentro del presupuesto con el menor riesgo?`, choices, answer: choices.indexOf(o === 'cache' ? okC : o === 'breve' ? okB : okS),
              steps: [
                `Presupuesto: US$${f(bud)}. De menos a más riesgo: con caché, ≈ US$${f(cache)} (parte anterior): ${entra(cache)}.`,
                `Respuestas de ≈ ${cap} tokens: (${f(tin)} × ${pz(pr[0])} + ${cap} × ${pz(pr[1])}) ÷ 1 M × ${f(n / 1e6, 2)} M ≈ US$${f(breve)}: ${entra(breve)}.`,
                `Modelo chico: ≈ US$${f(hoy)} ÷ 10 ≈ US$${f(chico)}: entra, pero es la palanca de más riesgo: se equivoca más en los casos difíciles, y antes hay que validarlo en el golden set.`,
                o === 'cache'
                  ? `Gana el caché: no cambia ni el modelo ni las respuestas, y ya te deja dentro. ${breve < bud ? 'Acortar también entraría, pero arriesga respuestas cortadas: no hace falta.' : 'Acortar, además, no alcanzaría solo.'}`
                  : o === 'breve'
                    ? `Gana acortar: el caché solo no alcanza porque el prefijo pesa poco al lado de la salida, que es el token caro. Mide la tasa de respuestas cortadas por el tope. Con el caché encima: ≈ US$${f(juntas)}.`
                    : `Gana el modelo chico: ni el caché ni las respuestas cortas alcanzan, y ni siquiera juntas (≈ US$${f(juntas)}). Antes de cambiar, el golden set; lo ideal es un router que mande al grande solo lo difícil.`,
              ],
            },
          ],
          hint: 'Costo = requests al mes × (tokens de entrada × su precio + tokens de salida × el suyo) ÷ 1 M. Para cada palanca cambia solo lo que toca (el prefijo a un décimo del precio de entrada, una salida más corta, o todo a un décimo) y compáralo con el presupuesto, de la de menos riesgo a la de más.',
          takeaway: `<b>Requisito:</b> US$${f(bud)} al mes contra ≈ US$${say(hoy)} hoy. <b>Decisión:</b> ${o === 'cache' ? 'prompt caching del prefijo' : o === 'breve' ? 'respuestas más cortas (≈ ' + cap + ' tokens)' : 'el modelo chico, validado en el golden set'}. <b>Por qué:</b> ${o === 'cache'
            ? 'el prefijo es el ' + f(pf * 100, 0) + ' % del prompt y en caché cuesta un décimo: ≈ US$' + say(cache) + ' sin tocar la calidad'
            : o === 'breve'
              ? 'la salida es el token caro (' + f(xo, 0) + '× la entrada): con ≈ ' + cap + ' tokens quedas en ≈ US$' + say(breve) + ', y el caché solo dejaba ≈ US$' + say(cache)
              : 'ni el caché ni la brevedad, juntos, bajan de ≈ US$' + say(juntas) + '; el chico cuesta ≈ US$' + say(chico)}. <b>Trade-off:</b> ${o === 'chico'
            ? 'el chico se equivoca más en lo difícil: golden set antes, y después un router o una cascada que escale lo difícil al grande'
            : 'las palancas se apilan; el modelo chico queda para cuando no alcance, porque es la única que cambia la calidad'}. <i>"${o === 'cache'
            ? `Caching the ${f(P)}-token fixed prefix takes the bill from about $${say(hoy)} to $${say(cache)} a month, inside the $${say(bud)} budget, without touching quality.`
            : o === 'breve'
              ? `Output tokens are the expensive ones, so capping answers at about ${cap} tokens takes the bill to about $${say(breve)} a month; caching alone would leave us at $${say(cache)}.`
              : `Even caching plus shorter answers leaves us at about $${say(juntas)} a month against a $${say(bud)} budget, so I'd move to the small model once it passes the golden set.`}"</i>`,
        };
      },
    },
    {
      id: 'llm-02', topic: 'llm', level: 1, title: '¿Se siente rápido?', ref: 'm14.prefill-decode',
      gen(r) {
        const d = r.pick([
          ['El portal de una aseguradora', 'explica en palabras simples la cobertura de cada póliza'],
          ['Un sitio de reservas de hoteles', 'resume las reseñas de cada hotel'],
          ['La app de una marca de autos', 'explica qué significa cada luz del tablero y qué hacer'],
          ['Un portal de empleo', 'explica qué tan bien encaja cada vacante con el perfil de quien busca'],
        ]);
        const o = r.pick(['cortas', 'stream']);
        const G2 = grupos02();
        const [a, t, n, W, nmin] = r.pick(G2.por[r.pick(G2.ws)][o]);
        const tpot = t / 1000;
        const e2e = a + (n - 1) * tpot;
        const cabe = floorx((W - a) / tpot) + 1;
        const okS = 'Respuestas más cortas (brevedad y max_tokens), sin tocar la app';
        const okT = 'Streaming de tokens: la app muestra el texto a medida que llega';
        const choices = r.shuffle([okS, okT, 'Un modelo más grande, que explique lo mismo en menos palabras', 'Subir el timeout del cliente para que el request no se corte']);
        return {
          q: `${d[0]} agrega un asistente que ${d[1]}. Hoy la app muestra la respuesta solo cuando está completa. Medido: TTFT ≈ <b>${f(a)} s</b>, TPOT ≈ <b>${t} ms</b> y respuestas de ≈ <b>${n} tokens</b>. UX pide que la persona empiece a ver la respuesta en <b>≤ ${W} s</b>. Producto prefiere acortar antes que esperar un release de la app (≈ 1 mes) que muestre texto parcial, pero no acepta respuestas de menos de ≈ <b>${nmin} tokens</b>.`,
          parts: [
            {
              ask: 'Tiempo hasta la respuesta completa, hoy', unit: 's', answer: e2e, tol: 0.15,
              steps: [
                'Planteamiento: completa = TTFT + (tokens − 1) × TPOT: el primer token llega con el TTFT y cada uno de los demás cuesta un TPOT. Pasa los ms a segundos.',
                `${f(a)} + ${n - 1} × ${f(tpot, 3)} = ${f(a)} + ${f((n - 1) * tpot)} ≈ <b>${f(e2e)} s</b>, ${f(e2e / W, 1)}× lo que pide UX`,
              ],
            },
            {
              ask: `¿Cuántos tokens de salida caben, como máximo, en ${W} s sin streaming?`, unit: 'tokens', answer: cabe, tol: 0.15,
              steps: [
                'Planteamiento: despeja los tokens de la misma fórmula: tokens = ⌊(tiempo − TTFT) ÷ TPOT⌋ + 1.',
                `⌊(${W} − ${f(a)}) ÷ ${f(tpot, 3)}⌋ + 1 = ⌊${f((W - a) / tpot, 1)}⌋ + 1 = <b>${cabe} tokens</b>`,
              ],
            },
            {
              ask: `¿Qué cambias para cumplir los ${W} s?`, choices, answer: choices.indexOf(o === 'cortas' ? okS : okT),
              steps: [
                o === 'cortas'
                  ? `Caben ${cabe} tokens y producto acepta desde ≈ ${nmin}: acortar alcanza sin esperar el release. Con max_tokens ≈ ${cabe} e instrucciones de brevedad, la respuesta completa llega en ≤ ${W} s; mide la tasa de respuestas cortadas por el tope.`
                  : `Caben ${cabe} tokens y producto no acepta menos de ≈ ${nmin}: acortar no alcanza sin romper el contenido (con ${nmin} tokens, la respuesta tardaría ≈ ${f(a + (nmin - 1) * tpot, 1)} s). Con streaming, la persona ve el primer texto a los ${f(a)} s (el TTFT) y lee mientras llega: ${f(1000 / t, 0)} tokens/s, más rápido de lo que lee (≈ 4–7 tokens/s).`,
                o === 'cortas'
                  ? 'El streaming también bajaría la espera (al TTFT), pero cuesta un mes de release y producto prefiere acortar: queda para cuando quiera respuestas más largas.'
                  : `Mientras sale el release, acortar hasta ≈ ${nmin} tokens baja la espera, aunque no cumpla.`,
                'Un modelo más grande es más lento por token (más bytes que leer en cada paso) y su TTFT crece: la espera sube. Subir el timeout solo evita que el request falle: la persona espera lo mismo.',
              ],
            },
          ],
          hint: 'Sin streaming, la persona espera toda la respuesta: TTFT + (tokens − 1) × TPOT. Despeja cuántos tokens caben en el tiempo que pide UX y compáralo con el mínimo que acepta producto: si caben, acortar alcanza; si no, solo el streaming cambia lo que la persona espera.',
          takeaway: `<b>Requisito:</b> empezar a ver la respuesta en ≤ ${W} s; hoy tarda ≈ ${f(e2e, 1)} s porque la app espera la respuesta completa. <b>Decisión:</b> ${o === 'cortas' ? 'respuestas más cortas (≈ ' + cabe + ' tokens), sin tocar la app' : 'streaming de tokens'}. <b>Por qué:</b> en ${W} s caben ≈ ${cabe} tokens y producto ${o === 'cortas' ? 'acepta desde ' + nmin : 'necesita al menos ' + nmin}. <b>Trade-off:</b> ${o === 'cortas'
            ? 'acortar arregla esta semana, pero limita el contenido; el streaming cambia la métrica que la persona siente (el TTFT) y vale el release cuando haga falta más texto'
            : 'el release cuesta un mes, a cambio de que la espera deje de depender del largo: con streaming los SLOs son TTFT y TPOT, no la respuesta completa'}. <i>"${o === 'cortas'
            ? `Without streaming people wait for the whole answer, about ${f(e2e, 0)} seconds; ${W} seconds fit about ${cabe} tokens and product accepts that, so I cap the answers now and add streaming later.`
            : `Only about ${cabe} tokens fit in ${W} seconds and product needs at least ${nmin}, so shortening can't get there; with streaming the wait becomes the time to first token, ${f(a)} seconds.`}"</i>`,
        };
      },
    },

    // ======================================================== NIVEL 2
    {
      id: 'llm-03', topic: 'llm', level: 2, title: 'Cuánto contexto mete tu RAG', ref: 'm14.rag',
      gen(r) {
        const di = r.pick([0, 1, 2, 3]);
        const sub = r.pick(SUB03);   // la mitad gana bajar k; la otra, el reranker; la mitad por costo, la otra por latencia
        const G3 = grupos03()[di];
        const [c, ki, pi, qk, li, Xs, bud] = r.pick(sub === 'Rc' && G3.Rt.length && r.chance(0.3) ? G3.Rt : G3[sub]);
        const X = r.pick(Xs);
        const dm = D03[di];
        const [kn, km, kr] = K03[ki];
        const pr = LISTAS[pi];
        const [a0, b, rr] = LAT03[li];
        const Q = qk * 1000;
        const fijo = dm.S + dm.H;
        const pN = fijo + kn * c;
        const pK = fijo + km * c;
        const pR = fijo + kr * c;
        const uN = usd(pN, dm.o, pr);
        const cN = Q * uN;
        const cK = Q * usd(pK, dm.o, pr);
        const cRl = Q * usd(pR, dm.o, pr);   // solo el LLM
        const cR = cRl + RR_MES;
        const ttft = (p) => 0.2 + a0 + (b * p) / 1000;
        const lN = ttft(pN);
        const lK = ttft(pK);
        const lR = ttft(pR) + rr;
        const winR = sub[0] === 'R';
        const ahorro = (Q * (km - kr) * c * pr[0]) / 1e6;   // entrada que ahorra el reranker, al mes
        const sv = (b * (pK - pR)) / 1000;                  // prefill que ahorra el reranker (s)
        const si = (x, lim) => (x < lim ? 'sí' : 'no');
        const okK = `Bajar a ${km} chunks, sin reranker`;
        const okR = `Agregar el reranker y mandar ${kr} chunks`;
        const choices = r.shuffle([okK, okR, 'Mandar los documentos enteros a un modelo de 128k de contexto, sin retrieval']);
        return {
          q: `${dm.org} tiene un asistente (RAG) sobre ${dm.docs}: ≈ <b>${f(Q)} consultas al mes</b>. Hoy recupera los <b>${kn} chunks</b> más parecidos (búsqueda híbrida, sin reranker), de ≈ <b>${c} tokens</b> cada uno; el prompt suma además ≈ ${f(dm.S)} tokens de instrucciones y ≈ ${dm.H} de pregunta e historial, y la respuesta tiene ≈ ${dm.o} tokens. Requisitos: primer token en <b>≤ ${f(X)} s (p95)</b> y <b>≤ US$${f(bud)} al mes</b>. Datos:<ul><li>LLM por API (${pr[2]}): US$${pz(pr[0])} por millón de tokens de entrada y US$${pz(pr[1])} por millón de salida.</li><li>p95 medidos (supuesto): retrieval ≈ 0.2 s; TTFT del LLM ≈ ${f(a0)} s + ${f(b)} s por cada 1,000 tokens de prompt.</li><li>Un reranker (cross-encoder sobre los 50 mejores candidatos) correría en 2 × L4 (≈ US$1,175/mes, aprox.) y sumaría ≈ ${f(rr)} s al p95 (medido).</li><li>Golden set (medido): sin reranker, el recall objetivo se alcanza desde k = ${km}; con el reranker, con k = ${kr}.</li></ul>`,
          parts: [
            {
              ask: 'Tokens del prompt hoy', unit: 'tokens', answer: pN, tol: 0.05,
              steps: [
                'Planteamiento: prompt = instrucciones + pregunta e historial + k × tokens por chunk.',
                `${f(dm.S)} + ${dm.H} + ${kn} × ${c} = <b>${f(pN)} tokens</b>: los chunks son el ${f(((kn * c) / pN) * 100, 0)} %`,
              ],
            },
            {
              ask: 'Costo mensual hoy', unit: 'US$/mes', answer: cN, tol: 0.15,
              steps: [
                'Planteamiento: por consulta = (tokens de entrada × su precio + tokens de salida × el suyo) ÷ 1 M; al mes, × consultas.',
                `Con el resultado anterior: (${f(pN)} × ${pz(pr[0])} + ${dm.o} × ${pz(pr[1])}) ÷ 1 M = US$${g(uN)} → × ${f(Q)} ≈ <b>US$${f(cN)}/mes</b>`,
                cN > bud ? `≈ ${f(cN / bud, 1)}× el presupuesto de US$${f(bud)}.` : `Dentro del presupuesto de US$${f(bud)} (${f((cN / bud) * 100, 0)} %).`,
              ],
            },
            {
              ask: 'TTFT p95 hoy, desde que llega la pregunta (retrieval + LLM)', unit: 's', answer: lN, tol: 0.15,
              steps: [
                'Planteamiento: los tramos van en serie y se suman (sumar p95 es pesimista: sirve para planear): retrieval + TTFT del LLM, que crece con los tokens del prompt.',
                `Con el resultado de la primera parte: 0.2 + ${f(a0)} + ${f(b)} × ${f(pN / 1000, 2)} ≈ <b>${f(lN)} s</b>, contra ${f(X)} s del SLO: ${lN < X ? 'cumple' : 'no cumple'}`,
              ],
            },
            {
              ask: '¿Qué cambias para cumplir presupuesto y latencia?', choices, answer: choices.indexOf(winR ? okR : okK),
              steps: [
                `Con ${km} chunks: ${f(pK)} tokens → ≈ US$${f(cK)}/mes y TTFT ≈ 0.2 + ${f(a0)} + ${f(b)} × ${f(pK / 1000, 2)} ≈ ${f(lK)} s. Presupuesto: ${si(cK, bud)} · SLO: ${si(lK, X)}.`,
                `Con reranker y ${kr} chunks: ${f(pR)} tokens → ≈ US$${f(cRl)} de LLM + 1,175 del reranker ≈ US$${f(cR)}/mes; TTFT ≈ 0.2 + ${f(rr)} + ${f(a0)} + ${f(b)} × ${f(pR / 1000, 2)} ≈ ${f(lR)} s. Presupuesto: ${si(cR, bud)} · SLO: ${si(lR, X)}.`,
                sub === 'Kc'
                  ? `Gana bajar k: con ${f(Q)} consultas al mes, los ${km - kr} chunks que ahorraría el reranker valen ≈ US$${f(ahorro)} al mes de entrada, menos que sus dos GPUs. El reranker se paga con volumen, y aquí no lo hay.`
                  : sub === 'Kl'
                    ? `Gana bajar k: el reranker ahorra ${km - kr} chunks (${f(pK - pR)} tokens, ${f(sv, 2)} s de prefill) pero suma ${f(rr)} s, así que con él el TTFT sube a ≈ ${f(lR)} s y rompe el SLO. Con chunks cortos o un prefill rápido, el reranker no se paga en latencia.`
                    : sub === 'Rc'
                      ? `Gana el reranker: con ${f(Q)} consultas al mes, los ${km - kr} chunks que ahorra en cada una valen ≈ US$${f(ahorro)} al mes, más que sus dos GPUs (≈ US$1,175).`
                      : `Gana el reranker: con ${km} chunks, el prefill rompe el SLO; con ${kr}, el prompt tiene ${f(pK - pR)} tokens menos (${f(sv, 2)} s menos de prefill), más de lo que suma el reranker (${f(rr)} s).`,
                'Los documentos enteros: decenas de miles de tokens por consulta multiplican el costo y el TTFT, y el modelo usa peor lo que queda en el medio de un contexto largo (lost in the middle). El contexto largo sirve para un documento que la persona subió, no para buscar en un corpus.',
              ],
            },
          ],
          hint: 'Prompt = instrucciones + pregunta + k × tokens por chunk. Con eso salen el costo al mes (tokens × precio × consultas) y el TTFT (retrieval + fijo + segundos por cada 1,000 tokens). Para decidir, calcula las dos opciones con su k y, al reranker, súmale su costo fijo y su latencia: gana la que cumple las dos cosas.',
          takeaway: `<b>Requisito:</b> ≤ ${f(X)} s al primer token y ≤ US$${f(bud)} al mes, con ${f(Q)} consultas. <b>Decisión:</b> ${winR ? 'reranker y ' + kr + ' chunks' : 'bajar a ' + km + ' chunks, sin reranker'}. <b>Por qué:</b> ${sub === 'Kc'
            ? 'a este volumen, el reranker cuesta más de lo que ahorra en tokens'
            : sub === 'Kl'
              ? 'el reranker suma ' + f(rr) + ' s y ahorra solo ' + f(sv, 2) + ' s de prefill: con él, el TTFT rompe el SLO'
              : sub === 'Rc'
                ? 'a este volumen, el ahorro de tokens paga las dos GPUs del reranker'
                : 'con ' + km + ' chunks de ' + c + ' tokens el prefill rompe el SLO, y el reranker lo arregla con menos contexto'}. <b>Trade-off:</b> el reranker cambia costo por consulta (tokens) por costo fijo (GPUs) y algo de latencia: conviene con volumen o con chunks largos. Y k sale de la curva de recall@k del golden set, no del espacio libre en el contexto. <i>"${sub === 'Kc'
            ? `At ${say(Q)} queries a month the reranker's two GPUs cost more than the tokens it would save, so I cut to ${km} chunks, which still meets the recall target and the latency budget.`
            : sub === 'Kl'
              ? `The reranker would add ${f(rr)} seconds and save only ${f(sv, 2)} seconds of prefill, so time to first token would miss the ${f(X)}-second target; cutting to ${km} chunks meets both the latency target and the budget.`
              : sub === 'Rc'
                ? `At ${say(Q)} queries a month, reranking fifty candidates and sending ${kr} chunks instead of ${km} saves more in tokens than the two GPUs cost, and both options meet the latency budget.`
                : `${km} chunks of ${c} tokens push time to first token to about ${f(lK, 1)} seconds, past the ${f(X)}-second target; reranking and sending ${kr} chunks cuts the prefill by more than the reranker adds.`}"</i>`,
        };
      },
    },
    {
      id: 'llm-04', topic: 'llm', level: 2, title: 'Trabajo offline con LLM', ref: 'm14.api-vs-propio',
      gen(r) {
        const o = r.pick(['batch', 'online', 'self']);
        const [di, tin, D, pi, tpm, G, F, H] = r.pick(grupos04()[o]);
        const dm = D04[di];
        const tout = dm.tout;
        const pr = LISTAS04[pi];
        const v = calc04(D, tin, tout, pr, tpm, G, F);
        const totB = (D * (tin + tout)) / 1000;   // B tokens
        const okB = H >= 48;
        const okO = v.onH < H;
        const okS = v.selfH < H;
        const plazo = H >= 48 ? f(H / 24, 0) + ' días (' + H + ' h)' : H + ' h';
        const opts = [['batch', 'la batch API', v.batch, okB, 'the batch API'], ['online', 'la API online', v.list, okO, 'the online API'], ['self', 'las GPUs propias', v.self, okS, 'our own GPUs']];
        const feas = opts.filter((x) => x[3]).sort((x, y) => x[2] - y[2]);
        const second = feas[1];
        const vs = second ? ` (≈ ${f(second[2] / feas[0][2], 1)}× más barata${o === 'self' ? 's' : ''} que ${second[1]})` : `, ${o === 'self' ? 'las únicas que llegan' : 'la única que llega'} a tiempo`;
        const nB = 'Batch API: la mitad del precio, con entrega en hasta 24 h';
        const nO = 'API online, al ritmo de la cuota';
        const nS = `GPUs propias: el 8B abierto en hasta ${G} L4`;
        const choices = r.shuffle([nB, nO, nS]);
        return {
          q: `${dm.org} quiere ${dm.tarea}: ≈ <b>${f(D)} M ${dm.que}</b>, con ≈ ${f(tin)} tokens de entrada (instrucciones incluidas) y ≈ ${tout} de salida ${dm.cada}. Nadie espera cada resultado, pero todo tiene que estar listo en <b>${plazo}</b>. Un modelo abierto de ≈ 8B, en FP8, pasa el golden set de la tarea, igual que el de la API. Opciones:<ul><li><b>Batch API</b> del proveedor: la mitad del precio de lista, con entrega en hasta 24 h (aprox.); tu cuenta puede encolar todo el lote de una vez (supuesto).</li><li><b>API online</b>, a precio de lista (${pr[2]}): US$${pz(pr[0])} por millón de tokens de entrada y US$${pz(pr[1])} por millón de salida. La cuota de tu cuenta es ≈ <b>${tpm} M tokens por minuto</b> (entrada + salida; supuesto).</li><li><b>GPUs propias</b>: el 8B en FP8 en L4 (g6.xlarge ≈ US$0.805/h, aprox.) con vLLM, ≈ <b>${f(v.rr)} ${dm.que}/s por L4</b> (medido, supuesto). La cuota deja prender hasta <b>${G} L4</b> a la vez, y montarlo y validarlo cuesta ≈ <b>US$${f(F)}</b> de trabajo (supuesto).</li></ul>`,
          parts: [
            {
              ask: 'Tokens del lote (entrada + salida)', unit: 'B tokens', answer: totB, tol: 0.15,
              steps: [
                'Planteamiento: tokens = documentos × (tokens de entrada + de salida).',
                `${f(D)} M × (${f(tin)} + ${tout}) = <b>${f(totB, 2)} B tokens</b>`,
              ],
            },
            {
              ask: 'Costo con la batch API', unit: 'US$', answer: v.batch, tol: 0.15,
              steps: [
                'Planteamiento: lista = tokens de entrada × su precio + tokens de salida × el suyo (por millón); la batch API cobra la mitad.',
                `Entrada: ${f(D)} M × ${f(tin)} = ${f((D * tin) / 1000, 2)} B tokens × US$${pz(pr[0])}/M = US$${f(D * tin * pr[0])} · salida: ${f(D)} M × ${tout} = ${f((D * tout) / 1000, 2)} B × US$${pz(pr[1])}/M = US$${f(D * tout * pr[1])}`,
                `Lista ≈ US$${f(v.list)} → batch ≈ <b>US$${f(v.batch)}</b>`,
              ],
            },
            {
              ask: 'Horas con la API online, al ritmo de la cuota', unit: 'h', answer: v.onH, tol: 0.15,
              steps: [
                'Planteamiento: horas = tokens ÷ (tokens por minuto × 60).',
                `Con el resultado de la primera parte: ${f(totB, 2)} B ÷ (${tpm} M × 60) ≈ <b>${f(v.onH)} h</b>`,
              ],
            },
            {
              ask: '¿Qué usas? (la opción más barata que termina a tiempo)', choices, answer: choices.indexOf(o === 'batch' ? nB : o === 'online' ? nO : nS),
              steps: [
                `Batch API: ≈ US$${f(v.batch)}; ${okB ? 'con ' + plazo + ' de plazo, la ventana de 24 h no es problema' : 'pero su ventana de hasta 24 h no garantiza las ' + H + ' h'}.`,
                `API online: ≈ US$${f(v.list)} (lista) en ≈ ${f(v.onH)} h: ${okO ? 'llega' : 'no llega'} a tiempo.`,
                `GPUs propias: ${f(D)} M ÷ ${f(v.rr)} por segundo ÷ 3,600 ≈ ${f(v.gpuH)} L4-h × 0.805 ≈ US$${f(v.gpuH * 0.805)}, + US$${f(F)} de montarlo ≈ US$${f(v.self)}; con ${G} L4, ≈ ${f(v.selfH)} h: ${okS ? 'llega' : 'no llega'} a tiempo.`,
                o === 'batch'
                  ? `Gana la batch API${vs}. Nadie espera cada documento, así que la ventana de un día no cuesta nada. Pide salida estructurada (JSON con schema) y procesa los ítems con error en una segunda vuelta.`
                  : o === 'online'
                    ? `Gana la API online${vs}. Con ${H} h no puedes depender de la ventana de 24 h de la batch API${okS ? '' : ', y las GPUs propias no terminan antes'}. Reintentos con backoff ante los 429 de la cuota y checkpoints para no reprocesar.`
                    : `Ganan las GPUs propias${vs}. ${second ? 'A este volumen, el costo fijo de montarlas se paga solo: la GPU por documento cuesta una fracción del token de la API.' : 'Con ' + G + ' L4 en paralelo terminan antes del plazo, y ninguna API llega.'}`,
              ],
            },
          ],
          hint: 'Tokens = documentos × (entrada + salida). Batch API: la mitad del precio de lista, pero entrega en hasta 24 h. API online: precio de lista; el tiempo lo pone la cuota (tokens ÷ tokens por minuto). GPUs propias: L4-horas = documentos ÷ documentos por segundo ÷ 3,600, más el costo de montarlo; el tiempo, ÷ las L4 que puedes prender. Elige la más barata que termina a tiempo.',
          takeaway: `<b>Requisito:</b> ${f(D)} M ${dm.que} en ≤ ${plazo}. <b>Decisión:</b> ${o === 'batch' ? 'la batch API' : o === 'online' ? 'la API online, dentro de la cuota' : 'GPUs propias con el 8B abierto'}. <b>Por qué:</b> ${o === 'batch'
            ? 'con ' + plazo + ' de plazo, la mitad del precio no cuesta nada: ≈ US$' + say(v.batch) + (second ? ' contra ≈ US$' + say(second[2]) + ' de ' + second[1] : '')
            : o === 'online'
              ? 'con ' + H + ' h no puedes esperar la ventana de la batch API; la API online llega en ≈ ' + f(v.onH, 0) + ' h por ≈ US$' + say(v.list) + (second ? ', menos que ' + second[1] + ' (≈ US$' + say(second[2]) + ')' : '')
              : 'a este volumen, ≈ US$' + say(v.self) + ' con el costo de montarlo' + (second ? ', contra ≈ US$' + say(second[2]) + ' de ' + second[1] : ', y es la única opción que llega a tiempo')}. <b>Trade-off:</b> nadie espera cada documento: es un job batch, y lo que decide es el plazo. La batch API cuesta la mitad si puedes esperar un día; las GPUs propias ganan con volumen, a cambio de montar, validar y operar el job. <i>"${o === 'batch'
            ? `Nobody waits on each document and we have ${H} hours, so the batch API at half price wins: about $${say(v.batch)}.`
            : o === 'online'
              ? `With ${H === 8 || H === 18 ? 'an' : 'a'} ${H}-hour deadline I can't rely on the batch API's 24-hour window, so I run the online API within our rate limit: about ${f(v.onH, 0)} hours and $${say(v.list)}.`
              : `At ${f(D)} million documents our own L4s cost about $${say(v.self)} including the setup${second ? `, against $${say(second[2])} for ${second[4]}` : ", and they're the only option that finishes in time"}.`}"</i>`,
        };
      },
    },

    // ======================================================== NIVEL 3
    {
      id: 'llm-05', topic: 'llm', level: 3, title: 'Agente con herramientas: ¿síncrono o asíncrono?', ref: 'c12.estimaciones',
      gen(r) {
        const dm = r.pick(D05);
        const o = r.pick(['sync', 'async']);
        const G5 = grupos05();
        const [na, ex, L, x, Ff, W] = r.pick(G5.por[r.pick(G5.ws)][o]);
        const n95 = na + ex;
        const lat = n95 * (L + x) + Ff;
        const B0 = r.pick([2000, 2500, 3000, 4000]);
        const dl = r.pick([300, 400, 500, 600]);
        const pr = LISTAS[r.pick([0, 1, 2])];
        const T = r.pick([2, 5, 10, 20, 40]);   // miles de tareas al día
        const entra = r.pick([true, false]);
        const tin = (na + 1) * B0 + (dl * na * (na + 1)) / 2;
        const tout = na * 80 + 250;
        const u = usd(tin, tout, pr);
        const mes = T * 1000 * 30 * u;
        const bud = (entra ? redondo(mes / 0.85, mes / 0.7, [mes]) : redondo(mes / 1.4, mes / 1.15, [mes])) || Number((mes / (entra ? 0.8 : 1.25)).toPrecision(2));
        const okS = 'Online síncrono: la persona espera en el chat, con streaming del estado';
        const okA = 'Asíncrono: workflow durable (202 + id de tarea) y aviso al terminar';
        const ch2 = r.shuffle([okS, okA, 'Batch: procesar las tareas del día cada noche', 'Streaming de eventos: un consumidor sobre un log tipo Kafka']);
        const okI = 'Consulta el estado con la idempotency key de la operación; si no se aplicó, reenvía una vez con la misma key';
        const ch5 = r.shuffle([okI, 'Reintenta con una idempotency key nueva, para que el backend no confunda el reintento con el intento anterior', 'Le devuelve el timeout al modelo como observación, para que vuelva a proponer la acción y sus argumentos', 'Reintenta hasta tres veces con backoff exponencial y jitter: los timeouts de red casi siempre son transitorios']);
        const mS = 'p95 de la tarea de punta a punta y tasa de tareas que tocan el límite de tiempo';
        const mA = 'Edad de la tarea más vieja sin terminar y tareas atascadas en un paso';
        const ch6 = r.shuffle([mS, mA, 'Utilización de GPU del modelo y memoria ocupada por el KV cache', 'Tareas creadas por día, por tipo de pedido y por canal de entrada']);
        return {
          q: `${dm.org} quiere un agente que ${dm.tarea}. Requisitos y datos:<ul><li>≈ <b>${T}k tareas al día</b>; presupuesto de tokens: <b>US$${f(bud)} al mes</b>.</li><li>Pasos por tarea (cada uno, una llamada al LLM que pide una tool, y la tool), medidos en el piloto: ≈ <b>${na}</b> típicos y <b>${n95}</b> en el p95; al final, una respuesta.</li><li>p95 medidos (supuesto): cada llamada que pide una tool ≈ <b>${f(L)} s</b>; cada tool ≈ <b>${f(x)} s</b>${x >= 2 ? ' (el sistema central es lento)' : ''}; la respuesta final, hasta el último token, ≈ <b>${Ff} s</b>.</li><li>UX: la persona espera en el chat, mirando el estado, hasta ≈ <b>${W} s</b> (p95); si tarda más, abandona o vuelve a escribir.</li><li>Tokens (medidos en el piloto): la primera llamada lleva ≈ ${f(B0)} de entrada (instrucciones, schemas de las tools y el caso) y cada paso agrega ≈ ${dl} (la tool call y su resultado recortado); cada llamada que pide una tool genera ≈ 80 tokens y la respuesta final, ≈ 250. API (${pr[2]}): US$${pz(pr[0])} por millón de entrada y US$${pz(pr[1])} por millón de salida.</li><li>La tool <code>${dm.tool}</code> tiene efectos: ${dm.efecto}.</li></ul>`,
          parts: [
            {
              ask: 'Cota p95 de una tarea, de punta a punta (pasos del p95, cada pieza en su p95)', unit: 's', answer: lat, tol: 0.15,
              steps: [
                'Planteamiento: los pasos van en serie: pasos × (llamada al LLM + tool) + respuesta final. Con cada pieza en su p95 es una cota pesimista (en la realidad los p95 no se suman), y alcanza para elegir el patrón.',
                `${n95} × (${f(L)} + ${f(x)}) + ${Ff} = ${n95} × ${f(L + x)} + ${Ff} = <b>${f(lat)} s</b>`,
              ],
            },
            {
              ask: '¿Qué patrón usas?', choices: ch2, answer: ch2.indexOf(o === 'sync' ? okS : okA),
              steps: [
                o === 'sync'
                  ? `${f(lat)} s ≤ ${W} s: la persona puede esperar. Síncrono, con el estado en streaming ("${dm.estado}") emitido por el orquestador, para que la espera no sea silencio. El estado de la tarea igual se guarda paso a paso: si el pod muere después de una escritura, la tarea se retoma, no se repite.`
                  : `${f(lat)} s > ${W} s: la persona abandonaría. Asíncrono: el pedido crea una tarea (202 + id), un workflow durable corre los pasos con reintentos y timers, y al terminar avisa (push, correo o el mismo chat). Nadie queda bloqueado, y una tool lenta solo atrasa esa tarea.`,
                'Batch no sirve: el input nace con el pedido de la persona, no hay nada que precomputar de noche, y nadie acepta esperar hasta mañana.',
                'Streaming de eventos es para un flujo continuo con frescura de segundos (features, alertas), no para tareas sueltas de varios pasos que pide una persona.',
              ],
            },
            {
              ask: `Tokens de entrada de una tarea típica (${na} pasos: ${na + 1} llamadas al LLM)`, unit: 'tokens', answer: tin, tol: 0.15,
              steps: [
                'Planteamiento: cada llamada reenvía todo lo anterior: la llamada n lleva base + delta × (n − 1). Sumadas las N + 1 llamadas: (N + 1) × base + delta × N × (N + 1) ÷ 2.',
                `${na + 1} × ${f(B0)} + ${dl} × ${na} × ${na + 1} ÷ 2 = ${f((na + 1) * B0)} + ${f((dl * na * (na + 1)) / 2)} = <b>${f(tin)} tokens</b>`,
                `≈ ${f(tin / (na + 1))} por llamada en promedio, contra ${f(B0)} en la primera: el contexto crece en cada paso.`,
              ],
            },
            {
              ask: 'Costo mensual de tokens (30 días)', unit: 'US$/mes', answer: mes, tol: 0.15,
              steps: [
                'Planteamiento: salida por tarea = pasos × 80 + 250; costo por tarea = (entrada × su precio + salida × el suyo) ÷ 1 M; al mes, × tareas al día × 30.',
                `Con el resultado anterior: salida = ${na} × 80 + 250 = ${tout} → (${f(tin)} × ${pz(pr[0])} + ${tout} × ${pz(pr[1])}) ÷ 1 M = US$${g(u)} por tarea → × ${T}k × 30 ≈ <b>US$${f(mes)}/mes</b>`,
                entra
                  ? `Contra US$${f(bud)}: entra (${f((mes / bud) * 100, 0)} % del presupuesto). Son centavos por tarea, contra los dólares que cuesta que la resuelva una persona.`
                  : `Contra US$${f(bud)}: no entra (${f(mes / bud, 2)}×). Primero prompt caching: las instrucciones y los schemas se reenvían en cada llamada y, cacheados, cuestan ≈ 10 %; después, resultados de tools más recortados y menos pasos.`,
              ],
            },
            {
              ask: `La tool <code>${dm.tool}</code> vence su timeout. ¿Qué hace el orquestador?`, choices: ch5, answer: ch5.indexOf(okI),
              steps: [
                `Un timeout no dice si la escritura ocurrió: solo que no llegó la respuesta. Reintentar a ciegas puede ${dm.dup} dos veces.`,
                'La key es por operación lógica: un hash de (tarea, acción, argumentos normalizados), que se guarda en el step log antes de llamar y se reusa en cualquier reintento o reanudación. Si ya se aplicó, el backend devuelve el resultado original.',
                'Una key nueva por intento parece idempotencia y no lo es: el backend ve una operación nueva. Volver al modelo puede cambiar los argumentos y repetir la acción. Reintentar con backoff sigue siendo a ciegas: cada intento puede volver a aplicarla.',
                o === 'sync'
                  ? 'Si no se puede saber qué pasó, la tarea pasa a una persona con la operación marcada para conciliar, y el chat recibe un mensaje honesto, no un error.'
                  : 'En el workflow, el paso queda registrado y el motor lo reintenta con la misma key; si no se puede saber qué pasó, pasa a una persona con la operación marcada para conciliar.',
              ],
            },
            {
              ask: 'Con el patrón correcto de la segunda parte, ¿cuál es la alerta principal?', choices: ch6, answer: ch6.indexOf(o === 'sync' ? mS : mA),
              steps: [
                o === 'sync'
                  ? 'La persona espera en línea: el síntoma es la latencia de punta a punta y las tareas que se cortan por el límite de tiempo (y terminan en hand-off). La edad de la tarea más vieja es la alerta de una cola, y aquí no hay cola.'
                  : 'Nadie espera en línea: el síntoma de que algo se trabó es que las tareas envejecen (una tool caída, un paso que reintenta sin fin). La duración de cada tarea varía con esperas legítimas, como los reintentos con backoff: no es la alerta principal.',
                'La utilización de GPU y el KV cache no ven una tool caída ni una tarea trabada; las tareas creadas por día son tráfico, no salud.',
                'En los dos patrones, además: errores por tool, tasa de hand-off, acciones bloqueadas por la política y costo por tarea.',
              ],
            },
          ],
          hint: 'Latencia: pasos del p95 × (llamada al LLM + tool) + respuesta final, contra lo que tolera la persona. Tokens: cada llamada reenvía el contexto, así que la entrada crece paso a paso (suma de una progresión). Una escritura con efectos necesita una key por operación, y cada patrón tiene su alerta.',
          takeaway: `<b>Requisito:</b> ${W} s de espera tolerable, ${T}k tareas al día, US$${f(bud)} al mes y una tool con efectos. <b>Decisión:</b> ${o === 'sync' ? 'online síncrono, con el estado en streaming' : 'workflow asíncrono durable, con aviso al terminar'}. <b>Por qué:</b> la cota p95 es ≈ ${f(lat, 0)} s, ${o === 'sync' ? 'dentro de' : 'más que'} los ${W} s. <b>Números:</b> ≈ ${f(tin)} tokens de entrada por tarea y ≈ US$${say(mes)}/mes, ${entra ? 'dentro del presupuesto' : 'por encima del presupuesto: prompt caching del prefijo primero'}. <b>Trade-off:</b> ${o === 'sync'
            ? 'síncrono es más simple y da el resultado en el momento, pero una tool lenta o un loop largo rompen la espera: límites de pasos y de tiempo, y hand-off'
            : 'asíncrono no bloquea a nadie y aguanta tools lentas, a cambio de estado durable, timers y una notificación'}; en los dos, idempotency key en cada escritura. <i>"${o === 'sync'
            ? `Even the pessimistic p95 is about ${say(lat)} seconds, inside the ${W} seconds people will wait, so it's synchronous with streamed status; writes carry idempotency keys, and I alert on end-to-end p95 and time-limit hits.`
            : `The pessimistic p95 is about ${say(lat)} seconds, past the ${W} seconds people will wait, so I return a task ID, run a durable workflow and notify when it's done, with idempotency keys on every write and an alert on the oldest unfinished task.`}"</i>`,
        };
      },
    },
    {
      id: 'llm-06', topic: 'llm', level: 3, title: 'Cascada de modelos para cumplir el presupuesto', ref: 'm14.evaluacion',
      gen(r) {
        const dm = r.pick(D06);
        const k = r.pick([0, 1, 2]);   // el umbral que cumple: 0.9, 0.8 o 0.7
        const [fi, a9, a8, a7, qe, qmin] = r.pick(r.pick(grupos06())[k]);   // celda (fracciones, piso) → combinación
        const fs = FS06[fi];
        const a = [a9, a8, a7];
        const [tin, tout] = r.pick([[1500, 200], [2000, 300], [3000, 400]]);
        const pr = LISTAS[r.pick([0, 1])];
        const Qm = r.pick([1, 2, 3, 5, 8]);   // M requests al mes
        const dlt = r.pick([0.08, 0.12, 0.18]);   // nunca cae en la tasa de escalamiento de otro umbral (múltiplos de 5 %)
        const cg = usd(tin, tout, pr);   // grande, por request
        const cc = cg / 10;              // chico
        const hoy = Qm * 1e6 * cg;
        const cost = fs.map((fv) => Qm * 1e6 * (cc + (1 - fv) * cg));
        const q = fs.map((fv, i) => fv * a[i] + (1 - fv) * qe);
        const qhoy = Math.ceil(Math.max(...q) * 200 - 1e-9) / 200;
        const todo = fs[2] * a7 + (1 - fs[2]) * 0.6;
        const bud = redondo(cost[k] / 0.9, (k === 0 ? hoy : cost[k - 1]) / 1.1, [hoy].concat(cost)) || Number(Math.sqrt((cost[k] / 0.9) * ((k === 0 ? hoy : cost[k - 1]) / 1.1)).toPrecision(2));
        const esc = 1 - fs[k] + dlt;   // fracción escalada después del cambio
        const drift = Qm * 1e6 * (cc + esc * cg);
        const th = ['0.9', '0.8', '0.7'];
        const optT = fs.map((fv, i) => `Umbral ${th[i]}: el chico resuelve el ${f(fv * 100, 0)} %`);
        const ch4 = r.shuffle(optT.concat(['Todo al modelo chico, sin escalar']));
        const okM = 'La tasa de escalamiento y el acierto del chico en lo que resuelve solo (muestras etiquetadas)';
        const ch5 = r.shuffle([okM, 'La confianza promedio del modelo chico, con una alerta si cae por debajo del umbral elegido', 'La latencia p95 y la tasa de errores 5xx del modelo grande, con una alerta por cada proveedor', 'La factura del proveedor al cierre de cada mes, comparada contra el presupuesto aprobado']);
        return {
          q: `${dm.org} usa un LLM que ${dm.tarea}: ≈ <b>${Qm} M requests al mes</b>, de ≈ ${f(tin)} tokens de entrada y ${tout} de salida. Con el modelo grande (US$${pz(pr[0])} por millón de entrada y US$${pz(pr[1])} por millón de salida; ${pr[2]}) el golden set da <b>${f(qhoy * 100, 1)} %</b>, pero el presupuesto es <b>US$${f(bud)} al mes</b> y producto exige <b>≥ ${f(qmin * 100, 0)} %</b> en el golden set. Propuesta: una cascada. Cada request pasa primero por el modelo chico de la familia (≈ 1/10 del precio, supuesto); si su confianza queda bajo un umbral, se escala al grande, que también se paga. En lo que se escala (los casos difíciles), el grande acierta ≈ <b>${f(qe * 100, 0)} %</b>, con cualquiera de los tres umbrales (medido, supuesto). Golden set del chico (medido, supuesto):<ul><li>Umbral 0.9: el chico resuelve el ${f(fs[0] * 100, 0)} %, con ${f(a9 * 100, 0)} % de acierto.</li><li>Umbral 0.8: el ${f(fs[1] * 100, 0)} %, con ${f(a8 * 100, 0)} %.</li><li>Umbral 0.7: el ${f(fs[2] * 100, 0)} %, con ${f(a7 * 100, 0)} %.</li><li>Sin escalar nunca: ${f(todo * 100, 1)} %.</li></ul>`,
          parts: [
            {
              ask: 'Costo mensual hoy, todo al modelo grande', unit: 'US$/mes', answer: hoy, tol: 0.15,
              steps: [
                'Planteamiento: por request = (tokens de entrada × su precio + tokens de salida × el suyo) ÷ 1 M; al mes, × requests.',
                `(${f(tin)} × ${pz(pr[0])} + ${tout} × ${pz(pr[1])}) ÷ 1 M = US$${g(cg)} → × ${Qm} M ≈ <b>US$${f(hoy)}/mes</b>, ${f(hoy / bud, 2)}× el presupuesto`,
              ],
            },
            {
              ask: 'Costo mensual de la cascada con umbral 0.8', unit: 'US$/mes', answer: cost[1], tol: 0.15,
              steps: [
                'Planteamiento: en una cascada todos los requests pagan el chico y solo lo escalado paga además el grande: por request = chico + (1 − f) × grande.',
                `Chico ≈ US$${g(cg)} ÷ 10 = US$${g(cc)}; con 0.8 escala el ${f((1 - fs[1]) * 100, 0)} %: ${g(cc)} + ${f(1 - fs[1], 2)} × ${g(cg)} = US$${g(cc + (1 - fs[1]) * cg)} → × ${Qm} M ≈ <b>US$${f(cost[1])}/mes</b>`,
                'El error común es f × chico + (1 − f) × grande: olvida que lo escalado ya pasó por el chico.',
              ],
            },
            {
              ask: 'Calidad en el golden set con umbral 0.8', unit: '%', answer: q[1] * 100, tolAbs: 0.5,
              steps: [
                'Planteamiento: promedio ponderado: f × acierto del chico en lo que resuelve + (1 − f) × acierto del grande en lo escalado.',
                `${f(fs[1], 2)} × ${f(a8 * 100, 0)} + ${f(1 - fs[1], 2)} × ${f(qe * 100, 0)} = <b>${f(q[1] * 100, 1)} %</b>`,
              ],
            },
            {
              ask: '¿Qué umbral eliges?', choices: ch4, answer: ch4.indexOf(optT[k]),
              steps: [
                `Con cada umbral: costo = ${Qm} M × (${g(cc)} + fracción escalada × ${g(cg)}); calidad = f × acierto del chico + (1 − f) × ${f(qe * 100, 0)}.`,
              ].concat(fs.map((fv, i) => `Umbral ${th[i]}: ≈ US$${f(cost[i])}/mes (${cost[i] < bud ? 'entra' : 'no entra'}) · ${f(q[i] * 100, 1)} % (${q[i] >= qmin ? 'cumple' : 'no cumple'} el piso de ${f(qmin * 100, 0)} %).`), [
                `${k === 0 ? 'Solo el umbral 0.9 cumple las dos cosas: con 0.8 y 0.7 la calidad cae bajo el piso.' : k === 1 ? 'Solo el umbral 0.8 cumple las dos cosas: 0.9 no entra en el presupuesto y 0.7 rompe el piso de calidad.' : 'Solo el umbral 0.7 cumple las dos cosas: 0.9 y 0.8 no entran en el presupuesto.'} El presupuesto empuja el umbral hacia abajo y la calidad, hacia arriba.`,
                `Todo al chico: ≈ US$${f(Qm * 1e6 * cc)}/mes, pero ${f(todo * 100, 1)} % queda lejos del piso: el chico solo es bueno en lo que sabe que sabe.`,
              ]),
            },
            {
              ask: 'En producción, ¿qué vigilas para saber que la cascada sigue sana?', choices: ch5, answer: ch5.indexOf(okM),
              steps: [
                'La tasa de escalamiento mueve el costo y anticipa un cambio en el tráfico. El acierto de lo que el chico resuelve solo no lo ve nadie más: si se equivoca con confianza alta, no escala. Por eso, muestras etiquetadas de ese tráfico y el golden set por slice.',
                'La confianza promedio puede seguir alta mientras el chico se equivoca más: con tráfico nuevo se descalibra.',
                'La latencia y los errores del grande miden la salud del proveedor, no la calidad de la cascada; la factura llega a fin de mes, sin decir por qué subió.',
              ],
            },
            {
              ask: `Un mes después llega ${dm.nuevo} y, con el umbral elegido, la tasa de escalamiento pasa del ${f((1 - fs[k]) * 100, 0)} % al ${f(esc * 100, 0)} %. ¿Cuánto cuesta ahora la cascada al mes?`, unit: 'US$/mes', answer: drift, tol: 0.15,
              steps: [
                'Planteamiento: la misma fórmula con la fracción escalada nueva: requests × (chico + escalado × grande).',
                `${Qm} M × (${g(cc)} + ${f(esc, 2)} × ${g(cg)}) ≈ <b>US$${f(drift)}/mes</b>: ${f((drift / bud) * 100, 0)} % del presupuesto`,
                'El chico no conoce lo nuevo y escala más: sube el costo y, si nadie mira la calidad de lo que se queda en el chico, también los errores. Se refresca el golden set con tráfico reciente y se vuelve a elegir el umbral (o se ajusta el chico).',
              ],
            },
          ],
          hint: 'En una cascada, todos los requests pagan el chico y solo lo escalado paga también el grande: costo = chico + fracción escalada × grande. La calidad es un promedio ponderado: f × acierto del chico + (1 − f) × acierto del grande en lo escalado. El umbral bueno cumple presupuesto y piso de calidad a la vez.',
          takeaway: `<b>Requisito:</b> ≤ US$${f(bud)} al mes y ≥ ${f(qmin * 100, 0)} % en el golden set, con ${Qm} M requests. <b>Decisión:</b> cascada con umbral ${th[k]}: el chico resuelve el ${f(fs[k] * 100, 0)} %. <b>Por qué:</b> ≈ US$${say(cost[k])}/mes con ${f(q[k] * 100, 1)} %; ${k === 0 ? 'bajar el umbral rompe el piso de calidad' : k === 1 ? 'con 0.9 no entra y con 0.7 rompe el piso' : 'con 0.9 y 0.8 no entra en el presupuesto'}. <b>Trade-off:</b> la cascada paga el chico en todo y suma su latencia a lo escalado; si el tráfico cambia, sube el escalamiento (costo) o el chico se equivoca con confianza (calidad), así que se vigilan los dos. <i>"In a cascade every request pays the small model and only escalations also pay the big one, so threshold ${th[k]} costs about $${say(cost[k])} a month at ${f(q[k] * 100, 1)}% on the golden set, the only setting that meets both the budget and the quality floor; I'd watch the escalation rate and label samples of what the small model keeps."</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
