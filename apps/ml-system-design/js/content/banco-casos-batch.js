/* Banco de problemas · Mini-casos por patrón · Batch: precomputar y servir un lookup: ventana de la corrida, workers, spot, incremental vs completo, backfills.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js. Las decisiones que dependen de los números se eligen primero (cada resultado
   sale con frecuencia pareja) y después se toma una combinación de entradas que lo produce con ≥ 10 % de margen y con
   los cocientes que se redondean lejos de un entero. Las listas de combinaciones se arman una sola vez (caché). */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'batch')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  const W_DYN = 0.625;   // US$ por millón de escrituras en DynamoDB on-demand (aprox., ref-numeros)
  const cnt = (n) => (n >= 1e6 ? f(n / 1e6) + ' M' : f(n / 1e3) + 'k');
  const small = (x) => (x < 1 ? g(x) : f(x));
  const dias = (n) => n + (n === 1 ? ' día' : ' días');

  // ------------------------------------------------------------ bat-02: ventana, workers y crecimiento
  // [N en M ítems, ítems/s por worker, horas de ventana, % de crecimiento]: ⌈⌉ lejos de un entero, 2–4 workers y el
  // crecimiento cae claro dentro (≤ 90 % de la ventana) o fuera (≥ 110 %) con los mismos workers. Las combinaciones se
  // agrupan por (workers, crecimiento) y solo quedan los grupos donde salen los dos resultados: ni el % de crecimiento
  // ni el número de workers delatan la respuesta (con 5–6 workers, el redondeo deja tan poco margen que nunca alcanza).
  const DOM02 = {
    agro: { price: 0.526, inst: 'g4dn.xlarge (T4, ≈ US$0.526/h, aprox.)', item: 'tiles', unit: 'tiles/s', thr: [300, 400, 500], W: [4, 5, 6], N: [] },
    muni: { price: 0.805, inst: 'g6.xlarge (L4, ≈ US$0.805/h, aprox.)', item: 'fotos', unit: 'fotos/s', thr: [200, 250, 300], W: [3, 4], N: [] },
    red: { price: 0.17, inst: 'c6i.xlarge (4 vCPU, ≈ US$0.17/h, aprox.)', item: 'series', unit: 'series/s', thr: [150, 200, 250], W: [3, 4, 5], N: [] },
  };
  for (let n = 4; n <= 60; n += 1) DOM02.agro.N.push(n);
  for (let n = 2; n <= 16; n += 1) DOM02.muni.N.push(n);
  for (let n = 2; n <= 30; n += 1) DOM02.red.N.push(n);
  let POOL02 = null;
  function pool02() {
    if (POOL02) return POOL02;
    POOL02 = {};
    Object.keys(DOM02).forEach((k) => {
      const d = DOM02[k];
      const cells = {};
      d.N.forEach((N) => d.thr.forEach((thr) => d.W.forEach((W) => [15, 20, 25, 30, 40, 50].forEach((gr) => {
        const x = (N * 1e6) / (thr * 3600 * W);
        const n = ceilx(x);
        if (!far(x, 0.05) || n < 2 || n > 4 || !far(x * (1 + gr / 100), 0.05)) return;
        const h2 = (x * (1 + gr / 100) * W) / n;   // horas con los mismos workers después de crecer
        const o = h2 <= 0.9 * W ? 'alcanza' : h2 >= 1.1 * W ? 'falta' : null;
        if (!o) return;
        const key = n + '|' + gr;
        cells[key] = cells[key] || { n, alcanza: [], falta: [] };
        cells[key][o].push([N, thr, W, gr]);
      }))));
      POOL02[k] = Object.values(cells).filter((c) => c.alcanza.length >= 3 && c.falta.length >= 3);
    });
    return POOL02;
  }

  // ------------------------------------------------------------ bat-03: spot con checkpoints
  // Unidades largas que se procesan enteras (el resultado se guarda al terminar cada una: es el checkpoint).
  // [variante, US$/h spot, unidades, min por unidad, instancias, % de interrupción por hora, min de reemplazo, h de deadline]:
  // on-demand llega con ≥ 5 % de holgura; spot llega con ≥ 10 % (también con la cuenta menos optimista, con ≥ 5 %) o se
  // pasa por ≥ 10 %; el costo separa por ≥ 10 %; la mitad de las instancias no llega; y relanzar todo en cada
  // interrupción es inviable (≥ 3 interrupciones esperadas). Interrupciones de 8–10 % por hora, como el ejemplo de M13
  // (4 en 40 h). El precio spot es el promedio de la zona (supuesto): cada instancia puede tocar un descuento real
  // (≈ 50 %), uno medio (≈ 30 %) o uno casi nulo (≈ 1–5 %, como la g6e de M13), así que el tipo de instancia no decide.
  // Grupos por (variante, min por unidad, %/h) con spot y "no llega" a la vez: ninguno de esos números decide solo.
  const DOM03 = {
    deporte: { od: 1.006, sps: [0.46, 0.7, 0.96], inst: 'g5.xlarge (A10G)', one: 'partido', many: 'partidos', en: 'match', U: [300, 400, 500, 600, 700, 800, 1000, 1200], ci: [150, 180, 240], K: [8, 10, 12, 16, 20] },
    energia: { od: 1.861, sps: [1.84, 1.3, 0.93], inst: 'g6e.xlarge (L40S, 48 GB)', one: 'vuelo', many: 'vuelos', en: 'flight', U: [200, 250, 300, 400, 500, 600, 800], ci: [150, 180, 210], K: [6, 8, 10, 12] },
    tv: { od: 0.526, sps: [0.27, 0.37, 0.5], inst: 'g4dn.xlarge (T4)', one: 'programa', many: 'programas', en: 'show', U: [500, 600, 800, 1000, 1200, 1500, 2000], ci: [150, 180, 210], K: [10, 12, 16, 20, 24] },
  };
  let POOL03 = null;
  function pool03() {
    if (POOL03) return POOL03;
    const cells = {};
    const DS = [];
    for (let D = 24; D <= 168; D += 2) DS.push(D);
    Object.keys(DOM03).forEach((k) => {
      const v = DOM03[k];
      v.sps.forEach((sp) => v.U.forEach((U) => v.ci.forEach((ci) => v.K.forEach((K) => [8, 10].forEach((p) => [15, 20, 30].forEach((rr) => DS.forEach((D) => {
        const W0 = (U * ci) / 60 / K;
        const lL = ((p / 100) * (ci / 2 + rr)) / 60;   // λ × L: horas perdidas por hora de trabajo
        const Ws = W0 * (1 + lL);
        if (W0 > 0.95 * D || 2 * W0 < 1.1 * D || K * (p / 100) * W0 < 3) return;
        if (!(Ws <= 0.9 * D || Ws >= 1.1 * D)) return;
        const cOd = K * W0 * v.od;
        const cSp = K * Ws * sp;
        // Si gana spot, también con la cuenta menos optimista (interrupciones durante lo que se repite): W0 ÷ (1 − λL).
        const Wg = W0 / (1 - lL);
        let o = null;
        if (cSp <= 0.9 * cOd) { if (Ws >= 1.1 * D) o = 'plazo'; else if (Wg <= 0.95 * D) o = 'spot'; }
        else if (cOd <= 0.9 * cSp) o = 'costo';
        if (!o) return;
        const key = [k, ci, p].join('|');
        cells[key] = cells[key] || { k, spot: [], plazo: [], costo: [] };
        cells[key][o].push([k, U, ci, K, p, rr, D, sp]);
      })))))));
    });
    POOL03 = Object.values(cells).filter((c) => c.spot.length >= 10 && c.plazo.length >= 3);
    return POOL03;
  }

  // ------------------------------------------------------------ bat-04: incremental o completo
  // [N en M filas, US$ de cómputo por millón, % que cambia por noche, días de tolerancia, US$ de detección por millón];
  // costos a ≥ 10 % de distancia. Tolerancias de 2–5 días: con 1 día el completo diario es obligatorio y el incremental
  // siempre pierde, así que "1 día" delataría la respuesta. Grupos por (variante, días de tolerancia) con los dos
  // resultados: la tolerancia sola no decide; deciden la fracción que cambia, la detección y el costo por fila.
  const DOM04 = {
    casas: { N: [4, 6, 8, 12, 16, 20, 30, 40], c: [0.1, 0.15, 0.3, 0.5, 0.8], x: [5, 8, 12, 20, 30], S: [2, 3, 4, 5], d: [0.05, 0.1, 0.2, 0.3, 0.4] },
    edu: { N: [5, 10, 15, 20, 30, 40], c: [0.1, 0.2, 0.3], x: [8, 12, 20, 30, 40, 50], S: [2, 3, 4, 5], d: [0.05, 0.1, 0.2, 0.3, 0.4] },
    juegos: { N: [10, 20, 30, 40, 60, 80], c: [0.05, 0.1, 0.2], x: [10, 15, 25, 35, 50, 60], S: [2, 3, 4, 5], d: [0.05, 0.1, 0.2, 0.3, 0.4] },
  };
  let POOL04 = null;
  function pool04() {
    if (POOL04) return POOL04;
    POOL04 = {};
    Object.keys(DOM04).forEach((k) => {
      const v = DOM04[k];
      const cells = {};
      v.N.forEach((N) => v.c.forEach((c) => v.x.forEach((x) => v.S.forEach((S) => v.d.forEach((d) => {
        const C = N * (c + W_DYN);
        const full = 30 * C;
        const inc = 30 * N * ((x / 100) * (c + W_DYN) + d) + (30 / S) * C;
        // La respuesta de la última parte (incremental con el doble de tolerancia) no puede coincidir con un número que
        // ya se mostró (completo, incremental, lo de cada noche o los completos del mes).
        const inc2 = 30 * N * ((x / 100) * (c + W_DYN) + d) + (30 / (2 * S)) * C;
        if ([full, inc, 30 * N * ((x / 100) * (c + W_DYN) + d), (30 / S) * C].some((y) => Math.abs(inc2 - y) <= 0.03 * inc2)) return;
        const o = inc <= 0.9 * full ? 'inc' : inc >= 1.1 * full ? 'full' : null;
        if (!o) return;
        cells[S] = cells[S] || { inc: [], full: [] };
        cells[S][o].push([N, c, x, S, d]);
      })))));
      POOL04[k] = Object.values(cells).filter((cl) => cl.inc.length >= 5 && cl.full.length >= 5);
    });
    return POOL04;
  }

  // ------------------------------------------------------------ bat-05: backfill con plazo, presupuesto y cuota
  // Por opción: costo por millón, horas de pared con todas sus máquinas y costo total (cómputo + lectura). Cada opción
  // queda clara frente al plazo y al presupuesto (≥ 10 %); gana la más barata de las que cumplen las dos, por ≥ 10 %.
  // Si gana una GPU, alguna opción llega al plazo pero se pasa del presupuesto (el presupuesto también decide).
  // Grupos por (variante, plazo) con las tres ganadoras posibles: ni la variante ni el plazo delatan la respuesta.
  const OPT05 = {
    T4: { price: 0.526, name: 'T4 (g4dn.xlarge)' },
    L4: { price: 0.805, name: 'L4 (g6.xlarge)' },
    CPU: { price: 0.17, name: 'CPU (c6i.xlarge, INT8)' },
  };
  const DOM05 = {
    soporte: { item: 'mensajes', read: 0, N: [100, 150, 200, 300, 400, 500], thr: [[500, 1300, 50], [600, 1500, 60]] },
    logistica: { item: 'fotos', read: 0.4, N: [100, 150, 200, 250, 300, 400, 500], thr: [[350, 900, 40], [450, 1100, 50]] },
    catalogo: { item: 'fotos', read: 0.4, N: [100, 200, 300, 400, 500], thr: [[400, 1100, 30], [500, 1300, 40]] },
  };
  function eval05(dom, N, thr, qs) {
    const out = {};
    ['T4', 'L4', 'CPU'].forEach((o, i) => {
      const cpm = (OPT05[o].price / (thr[i] * 3600)) * 1e6;
      out[o] = { t: thr[i], q: qs[i], cpm, wall: (N * 1e6) / (thr[i] * qs[i] * 3600), cost: N * (cpm + DOM05[dom].read) };
    });
    return out;
  }
  let POOL05 = null;
  function pool05() {
    if (POOL05) return POOL05;
    POOL05 = {};
    Object.keys(DOM05).forEach((dom) => {
      const d = DOM05[dom];
      const cells = {};
      d.N.forEach((N) => d.thr.forEach((thr, ti) => [4, 6, 8, 12].forEach((qT) => [2, 3, 4].forEach((qL) => [40, 80, 120, 200].forEach((qC) => [24, 36, 48, 72, 96].forEach((D) => [100, 150, 200, 300, 400, 600, 800, 1000].forEach((Bu) => {
        const ev = eval05(dom, N, thr, [qT, qL, qC]);
        const keys = ['T4', 'L4', 'CPU'];
        if (keys.some((o) => !(ev[o].wall <= 0.9 * D || ev[o].wall >= 1.1 * D) || !(ev[o].cost <= 0.9 * Bu || ev[o].cost >= 1.1 * Bu))) return;
        const feas = keys.filter((o) => ev[o].wall <= D && ev[o].cost <= Bu).sort((a, b) => ev[a].cost - ev[b].cost);
        if (!feas.length || (feas.length > 1 && ev[feas[1]].cost < 1.1 * ev[feas[0]].cost)) return;
        const w = feas[0];
        if (w !== 'CPU' && !keys.some((o) => ev[o].wall <= D && ev[o].cost > Bu)) return;
        const cl = (cells[D] = cells[D] || { T4: [], L4: [], CPU: [] });
        cl[w].push([N, ti, qT, qL, qC, D, Bu]);
      })))))));
      POOL05[dom] = Object.values(cells).filter((cl) => cl.T4.length >= 2 && cl.L4.length >= 2 && cl.CPU.length >= 2);
    });
    return POOL05;
  }

  B.formulas.push(
    { topic: 'batch', title: 'Tabla de lookup', expr: 'filas = entidades × predicciones por entidad · tamaño = filas × bytes por fila (1 M filas de 1 KB = 1 GB)', ex: '500k alojamientos × 90 noches = 45 M filas × 32 B ≈ 1.4 GB' },
    { topic: 'batch', title: 'Ventana, cuota y costo por millón', expr: 'horas de worker = ítems ÷ ítems/s ÷ 3,600 · workers = ⌈horas de worker ÷ horas de ventana⌉ · horas de pared = ítems ÷ (ítems/s × máquinas × 3,600) · costo por millón = US$/h ÷ (ítems/s × 3,600) × 10⁶', ex: '40 M ÷ 400 ÷ 3,600 ≈ 27.8 h → 5 h de ventana: 6 workers · T4 a 500/s: 0.526 ÷ 1.8 M ≈ US$0.29 por millón' },
    { topic: 'batch', title: 'Spot con checkpoints', expr: 'horas perdidas por interrupción = intervalo entre checkpoints ÷ 2 + reemplazo (en horas) · horas en spot ≈ horas on-demand × (1 + interrupciones por hora × horas perdidas) · menos optimista: horas on-demand ÷ (1 − interrupciones por hora × horas perdidas) · costo = instancias × horas × US$/h', ex: '10 % por hora, unidades de 2 h y 15 min de reemplazo: 1 + 0.25 = 1.25 h perdidas → × (1 + 0.1 × 1.25) = × 1.125; menos optimista: ÷ (1 − 0.125) ≈ × 1.14' },
    { topic: 'batch', title: 'Incremental o completo', expr: 'completo/mes = 30 × corrida · incremental/mes = 30 × (fracción que cambia × corrida + detección) + (30 ÷ días de tolerancia) × corrida', ex: '5 % de cambio, detección ≈ 10 % de una corrida y tolerancia de 7 días: 0.05 + 0.1 + 0.14 ≈ 0.29 del completo diario' },
  );

  B.templates.push(
    // ======================================================== bat-01
    {
      id: 'bat-01', topic: 'batch', level: 1, title: '¿Precomputar o servir en vivo?', ref: 'm02.decision',
      gen(r) {
        const espera = r.pick([true, false]);   // ¿lo nuevo necesita su valor mientras alguien espera en el formulario?
        const dom = r.pick(['autos', 'super', 'aloja']);
        let q;
        let rows;
        let rowsDesc;
        let b;
        let reads;
        let existe;
        let altasDia;
        let altasTxt;
        let eng;
        if (dom === 'autos') {
          const N = r.pick([400e3, 600e3, 800e3, 1.2e6, 1.5e6, 2e6, 2.5e6, 3e6]);
          const k = r.pick([2, 3, 4]);
          const plazos = { 2: '30 y 60 días', 3: '7, 30 y 60 días', 4: '7, 15, 30 y 60 días' }[k];
          b = r.pick([60, 80, 100]);
          reads = r.pick([5, 8, 12, 20]);
          const altas = r.pick([8, 12, 20, 30]);
          rows = N * k;
          rowsDesc = `${cnt(N)} publicaciones × ${k} plazos`;
          existe = 'las publicaciones activas y los precios de cierre de ayer';
          altasDia = altas * 1000;
          altasTxt = `${altas}k publicaciones nuevas`;
          eng = 'listings';
          q = `Un marketplace de autos usados muestra un <b>precio sugerido</b> en sus <b>${cnt(N)} publicaciones activas</b>, para vender en <b>${k} plazos</b> (${plazos}). El modelo usa los cierres hasta ayer. Las páginas lo consultan ≈ <b>${reads} M veces al día</b>, en ≤ 50 ms, y llegan ≈ ${altas}k publicaciones nuevas al día. ${espera
            ? 'Quien publica quiere ver el precio sugerido en el mismo formulario de alta (espera ≈ 1 s).'
            : 'Una publicación nueva puede esperar a la próxima corrida; hasta entonces, la página muestra el rango de precios del modelo y año.'} Cada fila (publicación, plazo, precio) ocupa ≈ <b>${b} B</b> (supuesto).`;
        } else if (dom === 'super') {
          const S = r.pick([8, 12, 15, 20, 25, 30, 40]);
          const T = r.pick([60, 120, 200, 350, 500, 800]);
          b = r.pick([48, 64, 80]);
          reads = r.pick([2, 3, 5, 8]);
          const altas = r.pick([100, 200, 300, 500]);
          rows = S * 1000 * T;
          rowsDesc = `${S}k productos × ${T} tiendas`;
          existe = 'los productos, las tiendas y las ventas de ayer';
          altasDia = altas;
          altasTxt = `${altas} productos nuevos`;
          eng = 'products';
          q = `Una cadena de supermercados precalcula la <b>demanda de los próximos 7 días</b> de cada producto en cada tienda: <b>${S}k productos</b> en <b>${T} tiendas</b>. El modelo usa las ventas hasta ayer. La reposición y las tiendas la consultan ≈ <b>${reads} M veces al día</b>, en ≤ 50 ms, y se dan de alta ≈ ${altas} productos nuevos al día. ${espera
            ? 'Quien da de alta un producto quiere su pronóstico en el formulario, para decidir el primer pedido (espera ≈ 1 s).'
            : 'Un producto nuevo usa el pronóstico de su categoría hasta la próxima corrida.'} Cada fila (producto, tienda, 7 pronósticos) ocupa ≈ <b>${b} B</b> (supuesto).`;
        } else {
          const N = r.pick([100e3, 200e3, 300e3, 500e3, 800e3, 1e6, 1.5e6]);
          const k = r.pick([60, 90, 120, 180]);
          b = r.pick([24, 32, 40]);
          reads = r.pick([2, 4, 6, 10]);
          const altas = r.pick([2, 3, 5, 8]);
          rows = N * k;
          rowsDesc = `${cnt(N)} alojamientos × ${k} noches`;
          existe = 'los alojamientos activos y la demanda de ayer';
          altasDia = altas * 1000;
          altasTxt = `${altas}k alojamientos nuevos`;
          eng = 'listings';
          q = `Una plataforma de alojamientos sugiere un <b>precio por noche</b> para cada una de las <b>próximas ${k} noches</b> de sus <b>${cnt(N)} alojamientos activos</b>. El modelo usa la demanda hasta ayer. Quienes alojan lo consultan ≈ <b>${reads} M veces al día</b>, en ≤ 50 ms, y se publican ≈ ${altas}k alojamientos nuevos al día. ${espera
            ? 'Quien publica un alojamiento quiere ver el precio sugerido en el mismo formulario de alta (espera ≈ 1 s).'
            : 'Un alojamiento nuevo ve su primera sugerencia al día siguiente; mientras tanto, el panel muestra el precio que eligió quien lo publicó.'} Cada fila (alojamiento, noche, precio) ocupa ≈ <b>${b} B</b> (supuesto).`;
        }
        const gb = (rows * b) / 1e9;
        // Debajo de 1 GB, en MB: "230 MB" se lee mejor que "0.23 GB".
        const inMB = gb < 1;
        const size = inMB ? gb * 1000 : gb;
        const sizeUnit = inMB ? 'MB' : 'GB';
        const sizeTxt = f(size) + ' ' + sizeUnit;
        const rowsTxt = rows >= 1e6 ? f(rows / 1e6) + ' M' : f(rows);
        const rowsEn = rows >= 1e6 ? say(rows / 1e6) + ' million' : say(rows / 1e3) + ' thousand';
        const okA = 'Batch con lookup: precomputar cada noche y servir la tabla en ms';
        const okB = 'Híbrido: batch nocturno para lo que existe y online síncrono para las altas';
        const choices = r.shuffle([okA, okB, 'Online síncrono para todo: calcular en cada consulta', 'Asíncrono con cola: un job por consulta y avisar al terminar']);
        const say1 = espera
          ? `Existing ${eng} get a nightly precomputed lookup; only new ones, where someone is waiting on the form, go through a small synchronous path.`
          : `The inputs exist ahead of time and a day of staleness is fine, so I precompute about ${rowsEn} rows every night and serve a key-value lookup; new ${eng} show a default until the next run.`;
        return {
          q,
          parts: [
            {
              ask: '¿Qué patrón eliges?', choices, answer: choices.indexOf(espera ? okB : okA),
              steps: [
                `Planteamiento: las tres preguntas de M2. ¿El input existe antes? Sí: ${existe}. ¿Qué frescura pide? Un día. ¿Quién espera y cuánto? Quien consulta, un lookup de ms.`,
                espera
                  ? `Pero lo nuevo nace durante el día y alguien espera en el formulario: las altas (≈ ${altasTxt} al día, ≈ ${g(altasDia / DAY)} por segundo en promedio) van por un camino online síncrono chico. Todo lo demás, batch con lookup: <b>híbrido</b>. Con batch solo, el formulario quedaría sin valor: la fila nueva no existe hasta la noche.`
                  : 'Lo nuevo puede esperar a la corrida de la noche, con un valor por defecto mientras tanto: <b>batch con lookup</b>. Un camino online para las altas sería un servicio más que nadie pidió.',
                `Online para todo recalcula ≈ ${reads} M veces al día un valor que cambia una vez al día (usa los datos de ayer): pagas capacidad para el pico de lecturas las 24 horas por el mismo resultado.`,
                `Una cola es para trabajos de segundos a horas en los que nadie espera en línea; aquí quien consulta espera un lookup de ms${espera ? ' y quien da de alta, ≈ 1 s en el formulario' : ''}.`,
              ],
            },
            {
              ask: 'Filas que escribe cada corrida', unit: 'filas', answer: rows, tol: 0.15,
              steps: [
                'Planteamiento: filas = entidades × predicciones por entidad.',
                `${rowsDesc} = <b>${rowsTxt} filas</b>`,
              ],
            },
            {
              ask: `Tamaño de la tabla de lookup, en ${sizeUnit}`, unit: sizeUnit, answer: size, tol: 0.15,
              steps: [
                'Planteamiento: tamaño = filas × bytes por fila (1 M filas de 1 KB = 1 GB = 1,000 MB).',
                `Con el resultado anterior: ${rowsTxt} × ${b} B ≈ <b>${sizeTxt}</b>`,
                'Cabe sin problema en un KV store gestionado (DynamoDB) o en memoria (Redis). Cada corrida escribe una versión nueva y recién al validarla cambia el puntero de una vez: si el job falla, sigue sirviendo la de ayer.',
              ],
            },
          ],
          hint: 'Antes de calcular, responde las tres preguntas de M2: ¿el input existe antes de que lo pidan?, ¿qué frescura alcanza?, ¿quién espera y cuánto, incluido lo que se crea durante el día? Después: filas = entidades × predicciones por entidad, y tamaño = filas × bytes por fila.',
          takeaway: `<b>Requisito:</b> ${rowsTxt} valores que dependen de los datos de ayer${espera ? ', y lo nuevo, en el formulario de alta' : '; lo nuevo puede esperar a la noche'}. <b>Decisión:</b> ${espera ? 'híbrido: batch con lookup para lo que existe y online síncrono para las altas' : 'batch nocturno con lookup'}. <b>Por qué:</b> el input existe antes y cambia una vez al día: se calcula una vez por noche (≈ ${sizeTxt}) en vez de en cada una de las ≈ ${reads} M consultas. <b>Trade-off:</b> ${espera ? 'dos caminos que tienen que dar lo mismo (mismo modelo, mismas features)' : 'lo nuevo muestra un valor por defecto hasta la próxima corrida'}; y como un batch que falla no da ningún error, se alerta por la edad de la versión activa. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== bat-02
    {
      id: 'bat-02', topic: 'batch', level: 1, title: '¿Cabe en la ventana?', ref: 'm02.tabla-decision',
      gen(r) {
        const res = r.pick(['alcanza', 'falta']);
        const dom = r.pick(['agro', 'muni', 'red']);
        const d = DOM02[dom];
        const cells = pool02()[dom];
        const nw = r.pick([...new Set(cells.map((c) => c.n))]);   // primero los workers, después el crecimiento
        const cb = r.pick(r.pick(cells.filter((c) => c.n === nw))[res]);
        const N = cb[0];
        const thr = cb[1];
        const W = cb[2];
        const gr = cb[3];
        const H = (N * 1e6) / thr / 3600;   // horas de worker de una corrida
        const x = H / W;
        const n = ceilx(x);
        const cost = H * d.price;
        const H2 = H * (1 + gr / 100);
        const h2 = H2 / n;
        const x2 = H2 / W;
        const n2 = ceilx(x2);
        const fits = res === 'alcanza';
        let q;
        if (dom === 'agro') {
          q = `Una empresa de agrotecnología clasifica cada noche las imágenes satelitales del día, partidas en <b>${N} M tiles</b>, para el mapa de estrés hídrico que el equipo agronómico abre a las 6:00. Las imágenes llegan ${{ 4: 'a las 2:00', 5: 'a la 1:00', 6: 'a la medianoche' }[W]}: la ventana es de <b>${W} h</b>. Un worker ${d.inst} clasifica ≈ <b>${thr} tiles/s</b> (medido con batches grandes), y el trabajo se reparte en shards entre los workers.`;
        } else if (dom === 'muni') {
          q = `Una municipalidad publica cada mañana en su visor las fotos de la vía pública que toman sus vehículos de inspección, con caras y patentes difuminadas. El lote del día, <b>${N} M fotos</b>, llega a las 2:00 desde el proveedor que opera los vehículos, y el visor se actualiza a las ${2 + W}:00: ventana de <b>${W} h</b>. Un worker ${d.inst} procesa ≈ <b>${thr} fotos/s</b> con el detector (medido), y el trabajo se reparte en shards entre los workers.`;
        } else {
          q = `Un operador móvil busca anomalías en las métricas de su red: cada noche puntúa <b>${N} M series</b> (una por celda, métrica y hora) con un modelo en CPU. Los contadores del día se exportan a las 3:00 y el equipo de red lee el reporte a las ${3 + W}:00: ventana de <b>${W} h</b>. Un worker ${d.inst} puntúa ≈ <b>${thr} series/s</b> (medido), y el trabajo se reparte en shards entre los workers.`;
        }
        const okFit = 'Siguen alcanzando: el redondeo hacia arriba deja margen para ese crecimiento';
        const okMore = 'Ya no alcanzan: la corrida terminaría después de la ventana y hay que sumar workers';
        const choices = r.shuffle([okFit, okMore,
          'No cambia nada: el throughput de cada worker crece con el volumen',
          'Hay que pasar a corridas cada hora, para que cada una procese menos']);
        const say1 = fits
          ? `The run needs about ${say(H)} worker-hours, so ${n} workers finish inside the ${W}-hour window, with enough slack for ${gr} percent more volume.`
          : `With ${gr} percent more volume, ${n} workers would finish late, so I scale to ${n2}; the cost per run grows with the volume, not with the number of workers.`;
        return {
          q,
          parts: [
            {
              ask: 'Workers para terminar dentro de la ventana', unit: 'workers', answer: n, tol: 0,
              steps: [
                'Planteamiento: horas de worker = ítems ÷ ítems/s ÷ 3,600; workers = ⌈horas de worker ÷ horas de ventana⌉.',
                `${N} M ÷ ${thr} ÷ 3,600 ≈ ${f(H)} h de worker → ⌈${f(H)} ÷ ${W}⌉ = ⌈${f(x, 2)}⌉ = <b>${n} workers</b>`,
              ],
            },
            {
              ask: 'Costo de cada corrida (on-demand)', unit: 'US$', answer: cost, tol: 0.15,
              steps: [
                'Planteamiento: costo = horas de worker × US$/h. No depende de cuántos workers uses: más workers terminan antes, no cuestan más (salvo los minutos de arranque de cada uno).',
                `Con las horas de worker de la parte anterior: ${f(H)} × ${d.price} ≈ <b>US$${f(cost)}</b> por corrida, ≈ US$${say(cost * 30)} al mes`,
              ],
            },
            {
              ask: `Se espera ≈ <b>${gr} %</b> más ${d.item} el próximo trimestre. Con los ${n} workers de la primera parte, ¿qué pasa?`, choices, answer: choices.indexOf(fits ? okFit : okMore),
              steps: [
                `Planteamiento: las horas de worker crecen con el volumen: ${f(H)} × ${f(1 + gr / 100, 2)} ≈ ${f(H2)} h. Repartidas en ${n} workers: ${f(H2)} ÷ ${n} ≈ ${f(h2)} h, contra una ventana de ${W} h.`,
                fits
                  ? `Alcanza, con ≈ ${f((1 - h2 / W) * 100, 0)} % de margen: el redondeo hacia arriba de la primera parte dejaba ${n} × ${W} = ${n * W} h de worker por noche, y ahora hacen falta ${f(H2)}.`
                  : `No alcanza: terminaría ≈ ${f((h2 - W) * 60, 0)} min tarde. Harían falta ⌈${f(H2)} ÷ ${W}⌉ = ⌈${f(x2, 2)}⌉ = ${n2} workers; el costo por corrida sube ${gr} % igual, con más o con menos workers.`,
                'El throughput por worker ya está medido con batches grandes: no sube con el volumen. Lo que crece son las horas de worker.',
                'Correr cada hora no adelanta nada: todos los datos llegan juntos al abrir la ventana, y cada corrida suma su arranque. Las palancas son más workers en paralelo o un modelo más rápido.',
              ],
            },
          ],
          hint: 'Horas de worker = ítems ÷ ítems/s ÷ 3,600. Workers = esas horas ÷ horas de ventana, hacia arriba. Costo = horas de worker × US$/h (no cambia con el número de workers). Con crecimiento, recalcula las horas y divídelas entre los workers que ya tienes.',
          takeaway: `<b>Requisito:</b> ${N} M ${d.item} en una ventana de ${W} h. <b>Tamaño:</b> ≈ ${f(H)} h de worker → ${n} workers, ≈ US$${say(cost)} por corrida. <b>Decisión:</b> ${fits ? `con ${gr} % más, los mismos ${n} workers alcanzan` : `con ${gr} % más, subir a ${n2} workers`}. <b>Por qué:</b> el costo sale de las horas de worker, que crecen con el volumen; los workers solo las reparten en la ventana. <b>Trade-off:</b> más workers terminan antes sin costar más, hasta el tope de la cuota; por eso se mide la duración de cada corrida con tendencia y se alerta antes de que pise la ventana. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== bat-03
    {
      id: 'bat-03', topic: 'batch', level: 2, title: 'Spot con checkpoints', ref: 'm13.spot',
      gen(r) {
        const res = r.pick(['spot', 'od']);
        const why = res === 'spot' ? 'spot' : r.pick(['plazo', 'plazo', 'plazo', 'costo', 'costo']);
        const dom = r.pick(Object.keys(DOM03));
        const cb = r.pick(r.pick(pool03().filter((c) => c.k === dom && c[why].length))[why]);
        const v = DOM03[cb[0]];
        const U = cb[1];
        const ci = cb[2];
        const K = cb[3];
        const p = cb[4];
        const rr = cb[5];
        const D = cb[6];
        const sp = cb[7];                        // US$/h spot de esa zona
        const H = (U * ci) / 60;                 // horas de instancia
        const W0 = H / K;                        // horas de pared on-demand
        const nI = (p / 100) * W0;               // interrupciones esperadas por instancia
        const L = ci / 2 + rr;                   // min perdidos por interrupción
        const Ws = W0 * (1 + ((p / 100) * L) / 60);
        const Wg = W0 / (1 - ((p / 100) * L) / 60);   // cuenta menos optimista
        const cOd = K * W0 * v.od;
        const cSp = K * Ws * sp;
        const disc = (1 - sp / v.od) * 100;
        const spot = res === 'spot';
        const ok0 = Math.pow(1 - p / 100, H);    // ninguna interrupción en todas las horas de instancia
        let q;
        if (cb[0] === 'deporte') {
          q = `Un proveedor de analítica deportiva reprocesa con su tracker nuevo el archivo de la temporada: <b>${f(U)} partidos</b>. Cada partido se procesa entero en una instancia (el tracking necesita el video seguido) y tarda ≈ <b>${ci} min</b> (medido) en una ${v.inst}; el resultado se guarda al terminar cada uno. Los clubes reciben los datos en <b>${D} h</b>.`;
        } else if (cb[0] === 'energia') {
          q = `Una distribuidora eléctrica re-analiza con un modelo de segmentación nuevo los videos de inspección de sus líneas: <b>${f(U)} vuelos de dron</b>. Cada vuelo se procesa entero en una instancia y tarda ≈ <b>${ci} min</b> (medido) en una ${v.inst}, porque el modelo no entra en 24 GB; el resultado se guarda al terminar cada uno. El informe para el regulador vence en <b>${D} h</b>.`;
        } else {
          q = `Un canal de TV indexa su archivo con un modelo de escenas y caras: <b>${f(U)} programas</b>. Cada programa se procesa entero en una instancia y tarda ≈ <b>${ci} min</b> (medido) en una ${v.inst}; el índice se guarda al terminar cada uno. El buscador nuevo se lanza en <b>${D} h</b>.`;
        }
        q += ` La cuota alcanza para <b>${K} instancias</b> a la vez, on-demand o spot. On-demand: ≈ US$${v.od}/h (aprox.). Spot en esa zona, según su historial de 90 días (supuesto): ≈ <b>US$${sp}/h</b> y ≈ <b>${p} %</b> de probabilidad de interrupción por hora en cada instancia. Si interrumpen una, el ${v.one} en curso se repite entero, y el reemplazo (conseguir la instancia y cargar el modelo) tarda ≈ <b>${rr} min</b> (medido).`;
        const okS = 'Spot: llega al deadline y cuesta menos';
        const okO = 'On-demand: spot no llega al deadline o no ahorra lo suficiente';
        const choices = r.shuffle([okS, okO,
          'Spot sin guardar nada: si interrumpen una instancia, se relanza todo el job',
          'On-demand con la mitad de las instancias, para gastar menos']);
        const pct = Math.abs(1 - cSp / cOd) * 100;
        const say1 = spot
          ? `Spot finishes in about ${say(Ws)} hours including the rework, inside the ${D}-hour deadline, and saves about ${f(pct, 0)} percent, so I run it on spot with a checkpoint per ${v.en}.`
          : why === 'plazo'
            ? `Spot would save money, but the expected rework pushes it to about ${say(Ws)} hours against a ${D}-hour deadline, so this run goes on-demand.`
            : `In that zone the spot discount is only about ${f(disc, 0)} percent, so with the rework spot costs more; this run goes on-demand.`;
        return {
          q,
          parts: [
            {
              ask: `Horas de pared on-demand, con las ${K} instancias`, unit: 'h', answer: W0, tol: 0.15,
              steps: [
                'Planteamiento: horas de instancia = unidades × minutos por unidad ÷ 60; horas de pared = horas de instancia ÷ instancias en paralelo.',
                `${f(U)} × ${ci} ÷ 60 = ${f(H)} h de instancia ÷ ${K} = <b>${f(W0)} h</b>`,
              ],
            },
            {
              ask: 'Horas de pared esperadas en spot, contando el trabajo que se repite', unit: 'h', answer: Ws, tol: 0.15,
              steps: [
                `Planteamiento: interrupciones por instancia ≈ probabilidad por hora × horas de pared; cada una pierde en promedio medio ${v.one} (la mitad de ${ci} min) más el reemplazo.`,
                `Con el resultado anterior: ${f(p / 100, 2)} × ${f(W0)} ≈ ${f(nI)} interrupciones por instancia × (${ci} ÷ 2 + ${rr}) = ${L} min cada una ≈ ${f((nI * L) / 60)} h más → <b>${f(Ws)} h</b>`,
                'Es la cuenta de primer orden de M13. Se queda corta: también interrumpen lo que se repite, y es un promedio (a alguna instancia le va peor).',
              ],
            },
            {
              ask: 'Costo esperado de la corrida en spot', unit: 'US$', answer: cSp, tol: 0.15,
              steps: [
                'Planteamiento: instancias × horas de pared en spot × US$/h de spot. Las horas que se repiten también se pagan.',
                `Con el resultado anterior: ${K} × ${f(Ws)} × ${sp} ≈ <b>US$${f(cSp)}</b>`,
              ],
            },
            {
              ask: '¿Qué usas?', choices, answer: choices.indexOf(spot ? okS : okO),
              steps: [
                `Costos: on-demand ${K} × ${f(W0)} h × ${v.od} ≈ US$${f(cOd)}, contra ≈ US$${f(cSp)} en spot: ${cSp < cOd ? `spot ahorra ≈ US$${f(cOd - cSp)} (${f(pct, 0)} %)` : `spot cuesta ≈ US$${f(cSp - cOd)} más (${f(pct, 0)} %)`}.`,
                `Plazo: on-demand termina en ${f(W0)} h y spot en ≈ ${f(Ws)} h, contra ${D} h.`,
                spot
                  ? `<b>Spot</b>: llega con margen y ahorra. Aun con la cuenta menos optimista, horas ÷ (1 − interrupciones por hora × horas perdidas) = ${f(W0)} ÷ (1 − ${f(p / 100, 2)} × ${f(L / 60, 2)}) ≈ ${f(Wg)} h, llega.`
                  : why === 'plazo'
                    ? `Spot ahorra, pero en promedio llega ≈ ${f(Ws - D)} h tarde, y la cuenta de primer orden es la optimista: <b>on-demand</b>.`
                    : `En esa zona el descuento de spot es de solo ≈ ${f(disc, 0)} % (US$${sp} contra US$${v.od} por hora): con el trabajo repetido, spot sale más caro. <b>On-demand</b>.`,
                `Sin guardar por ${v.one}, cualquier interrupción tira todo: la probabilidad de que ninguna instancia sea interrumpida en las ${f(H, 0)} h de instancia es (1 − ${f(p / 100, 2)})<sup>${f(H, 0)}</sup>, ${ok0 < 0.001 ? 'menos de 0.1 %' : '≈ ' + f(ok0 * 100, 1) + ' %'}. El job no terminaría.`,
                `Con la mitad de las instancias las horas de instancia (y el costo) son las mismas, ${f(H)} h; solo tarda el doble, ≈ ${f(2 * W0)} h, contra ${D} h.`,
              ],
            },
          ],
          hint: 'Dos relojes y dos precios. On-demand: horas de instancia ÷ instancias. Spot: súmale lo que se repite (interrupciones por instancia × (media unidad + reemplazo)). Compara cada reloj con el deadline y cada costo (instancias × horas × US$/h) con el otro.',
          takeaway: `<b>Requisito:</b> ${f(U)} ${v.many} en ${D} h, con ${K} instancias. <b>Números:</b> on-demand ${f(W0)} h y ≈ US$${say(cOd)}; spot ≈ ${f(Ws)} h y ≈ US$${say(cSp)}. <b>Decisión:</b> ${spot ? 'spot, guardando el resultado de cada ' + v.one : 'on-demand'}. <b>Por qué:</b> ${spot ? 'ahorra ≈ ' + f(pct, 0) + ' % y llega con margen' : why === 'plazo' ? 'el trabajo repetido lo deja después del deadline' : 'con ≈ ' + f(disc, 0) + ' % de descuento, spot no paga el trabajo repetido'}. <b>Trade-off:</b> spot cambia dinero por tiempo e incertidumbre; lo que se repite crece con el tiempo entre checkpoints, así que checkpoints dentro de cada ${v.one} bajan la parte que se pierde${spot ? '' : why === 'plazo' ? ', y podrían devolver a spot dentro del plazo' : ''}. El descuento no es el ahorro: antes de prometer uno, el historial de precios y de interrupciones de esa instancia en esa zona. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== bat-04
    {
      id: 'bat-04', topic: 'batch', level: 2, title: 'Incremental o completo', ref: 'm02.batch',
      gen(r) {
        const res = r.pick(['inc', 'full']);
        const dom = r.pick(Object.keys(DOM04));
        const cb = r.pick(r.pick(pool04()[dom])[res]);   // primero la tolerancia, después el resultado
        const N = cb[0];
        const c = cb[1];
        const x = cb[2];
        const S = cb[3];
        const d = cb[4];
        const C = N * (c + W_DYN);                     // US$ por corrida completa
        const full = 30 * C;
        const night = N * ((x / 100) * (c + W_DYN) + d);
        const fullsInc = (30 / S) * C;
        const inc = 30 * night + fullsInc;
        const incWins = res === 'inc';
        const diff = Math.abs(full - inc);
        const inc2 = 30 * night + (30 / (2 * S)) * C;   // incremental si producto aceptara el doble de atraso
        // El incremental por cada completo diario: lo que cambia + la detección + los completos periódicos.
        const fx = x / 100;
        const fd = d / (c + W_DYN);
        const fs = 1 / S;
        const ratio = fx + fd + fs;
        const top = fx >= fd && fx >= fs ? 'x' : fd >= fs ? 'd' : 's';
        const driver = { x: `cambia tanto por noche (≈ ${x} %) que el incremental casi no escribe menos`, d: 'la detección lee todas las filas y cuesta casi tanto como puntuar y escribir cada una', s: `con un completo cada ${dias(S)} ya se paga ${f(fs * 100, 0)} % de la factura del completo diario` }[top];
        const driverEn = { x: `about ${x} percent of rows change every night`, d: 'change detection reads every row and costs almost as much as scoring and writing it', s: `a full refresh every ${S} days already costs ${f(fs * 100, 0)} percent of the nightly bill` }[top];
        let q;
        let sinFin;
        let eng;
        if (dom === 'casas') {
          q = `Un portal inmobiliario publica una <b>valuación automática</b> de cada una de sus <b>${N} M propiedades</b>, servida desde una tabla en DynamoDB. Cada noche cambia ≈ <b>${x} %</b> de las propiedades (una publicación nueva, un cambio de precio, una venta cercana); el resto cambia solo por el índice de precios de su zona, que se mueve de a poco. Producto acepta que una valuación sin cambios tenga hasta <b>${dias(S)}</b> de atraso.`;
          sinFin = 'Sin completos, una propiedad sin eventos no se recalcula nunca: ni el índice de su zona ni un modelo nuevo le llegan. El atraso no tiene techo.';
          eng = 'properties';
        } else if (dom === 'edu') {
          q = `Una plataforma de cursos en línea calcula cada noche el <b>riesgo de abandono</b> de sus <b>${N} M inscripciones activas</b>, y el equipo de tutorías lo lee desde una tabla en DynamoDB. Cada noche ≈ <b>${x} %</b> tiene actividad nueva; para el resto solo cambian los días sin actividad, que hacen subir el riesgo. Tutorías acepta hasta <b>${dias(S)}</b> de atraso en esas filas.`;
          sinFin = 'Sin completos, el riesgo de quien dejó de entrar no se actualiza nunca: justo la señal más importante (los días sin actividad) no genera eventos.';
          eng = 'enrollments';
        } else {
          q = `Un estudio de videojuegos calcula cada noche el <b>riesgo de abandono</b> de cada cuenta: <b>${N} M cuentas activas</b>, en una tabla en DynamoDB que lee el equipo de retención. Cada noche juega ≈ <b>${x} %</b> de las cuentas; para el resto solo cambian los días sin jugar. Retención acepta hasta <b>${dias(S)}</b> de atraso en esas filas.`;
          sinFin = 'Sin completos, una cuenta que dejó de jugar no se recalcula nunca: los días sin jugar son la señal principal y no generan eventos.';
          eng = 'accounts';
        }
        q += ` Costos (aprox. y supuestos): puntuar ≈ <b>US$${c}</b> por millón de filas${dom === 'casas' ? ' (el modelo mira las fotos)' : ''}, escribir ≈ <b>US$0.625</b> por millón (DynamoDB on-demand) y detectar qué cambió, comparando con el snapshot de ayer, ≈ <b>US$${d}</b> por millón de filas leídas.`;
        const okInc = 'Incremental: cada noche solo lo que cambió, más un completo periódico para acotar el atraso';
        const okFull = 'Recalcular todo cada noche';
        const choices = r.shuffle([okInc, okFull,
          'Solo incremental, sin completos: lo que no cambia no hace falta recalcularlo',
          'Recalcular todo cada hora, para que nada quede viejo']);
        const pct = incWins ? (1 - inc / full) * 100 : (inc / full - 1) * 100;
        const say1 = incWins
          ? `Only about ${x} percent of the ${eng} change each night, so I update those incrementally and run a full refresh every ${S} days to bound staleness: about $${say(inc)} a month instead of $${say(full)}.`
          : `Incremental would cost about ${f(ratio, 1)} times the nightly full run, because ${driverEn}, so I keep the full nightly run.`;
        return {
          q,
          parts: [
            {
              ask: 'Costo mensual de recalcular todo cada noche (30 noches)', unit: 'US$/mes', answer: full, tol: 0.15,
              steps: [
                'Planteamiento: una corrida completa puntúa y escribe todas las filas: millones de filas × (cómputo + escritura por millón); al mes, × 30.',
                `${N} M × (${c} + 0.625) = US$${f(C)} por corrida → × 30 ≈ <b>US$${f(full)}/mes</b>`,
                `Las escrituras son ≈ ${f((W_DYN / (c + W_DYN)) * 100, 0)} % de cada corrida: en batch, escribir suele costar más que puntuar (M2).`,
              ],
            },
            {
              ask: `Costo mensual del incremental: cada noche lo que cambió más la detección, y un completo cada ${dias(S)} para acotar el atraso`, unit: 'US$/mes', answer: inc, tol: 0.15,
              steps: [
                'Planteamiento: cada noche se puntúa y escribe solo la fracción que cambió, pero la detección lee todas las filas; además, un completo cada tantos días como la tolerancia de atraso.',
                `Cada noche: ${N} M × (${f(x / 100, 2)} × ${f(c + W_DYN, 3)} + ${d}) ≈ US$${f(night)} → × 30 ≈ US$${f(30 * night)}`,
                `Completos: 30 ÷ ${S} = ${f(30 / S, 1)} al mes × US$${f(C)} (la corrida de la parte anterior) ≈ US$${f(fullsInc)}`,
                `Total ≈ <b>US$${f(inc)}/mes</b>`,
              ],
            },
            {
              ask: '¿Qué propones?', choices, answer: choices.indexOf(incWins ? okInc : okFull),
              steps: [
                `Incremental ≈ US$${f(inc)} contra completo ≈ US$${f(full)} al mes: ${incWins ? 'el incremental ahorra ≈ ' + f(pct, 0) + ' %' : 'el incremental cuesta ≈ ' + f(pct, 0) + ' % más'}.`,
                `Por qué, en fracciones del completo diario: lo que cambia (${f(fx, 2)}) + la detección (${d} ÷ ${f(c + W_DYN, 3)} ≈ ${f(fd, 2)}) + un completo cada ${dias(S)} (${f(fs, 2)}) ≈ ${f(ratio, 2)}.`,
                incWins
                  ? `Queda bastante debajo de 1: aun pagando la detección, el incremental ahorra. <b>Incremental con completo periódico</b>.`
                  : `Pasa de 1: ${driver}. El incremental no paga su complejidad: <b>recalcular todo cada noche</b>.`,
                sinFin,
                'Cada hora serían 24 corridas completas al día, ≈ 24 × la factura del completo diario, para datos que cambian una vez al día.',
              ],
            },
            {
              ask: `Producto podría aceptar el doble de atraso (${dias(2 * S)}). ¿Cuánto costaría entonces el incremental al mes?`, unit: 'US$/mes', answer: inc2, tol: 0.15,
              steps: [
                'Planteamiento: lo de cada noche no cambia; con el doble de tolerancia, los completos bajan a la mitad: 30 ÷ (2 × días de tolerancia) al mes.',
                `Con los resultados anteriores: US$${f(30 * night)} + 30 ÷ ${2 * S} × US$${f(C)} ≈ <b>US$${f(inc2)}/mes</b>, contra US$${f(full)} del completo diario`,
                inc2 <= 0.9 * full
                  ? `${incWins ? 'El incremental ahorraría todavía más' : 'Con esa tolerancia el incremental pasaría a ahorrar'}: ≈ ${f((1 - inc2 / full) * 100, 0)} % menos que el completo. Es la cuenta para negociar con producto: cada día de atraso que acepta baja la factura.`
                  : inc2 < 1.1 * full
                    ? `Quedaría casi igual que el completo (≈ ${f(Math.abs(1 - inc2 / full) * 100, 0)} % de diferencia): no alcanza para pagar la complejidad del incremental. Lo que pesa son ${top === 'd' ? 'la detección' : 'lo que cambia cada noche y la detección'}, no la frescura.`
                    : `Ni así ahorraría: con ≈ ${x} % de cambio por noche más la detección, el incremental cuesta más que el completo. La frescura no es lo que lo encarece.`,
              ],
            },
          ],
          hint: 'Arma dos facturas mensuales. Completo: 30 corridas de todas las filas (cómputo + escritura). Incremental: cada noche, la fracción que cambia (cómputo + escritura) más la detección sobre todas las filas, y además un completo cada tantos días como la tolerancia de atraso. Compara.',
          takeaway: `<b>Requisito:</b> ${N} M filas, ≈ ${x} % de cambio por noche y hasta ${dias(S)} de atraso para lo que no cambia. <b>Decisión:</b> ${incWins ? `incremental con un completo cada ${dias(S)}` : 'recalcular todo cada noche'}, ≈ US$${say(diff)}/mes menos que la otra opción. <b>Por qué:</b> ${incWins ? `se escribe solo lo que cambia y el completo corre ${f(30 / S, 1)} veces al mes en vez de 30` : driver}. <b>Trade-off:</b> el incremental depende de detectar bien qué cambió: un evento que no se registra deja la fila vieja hasta el próximo completo, y las features que dependen del tiempo cambian sin evento. Por eso el completo periódico es parte del diseño, y se monitorea la edad de la última corrida completa. La tolerancia de atraso es una palanca de costo: con ${dias(2 * S)}, el incremental costaría ≈ US$${say(inc2)}/mes; con 1 día, el completo diario sería obligatorio y el incremental solo sumaría costo. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== bat-05
    {
      id: 'bat-05', topic: 'batch', level: 3, title: 'Backfill con fecha límite y presupuesto', ref: 'm13.cuotas-regiones',
      gen(r) {
        const w = r.pick(['L4', 'T4', 'CPU']);
        const dom = r.pick(Object.keys(DOM05).filter((k) => pool05()[k].length));
        const cb = r.pick(r.pick(pool05()[dom])[w]);   // primero el plazo, después la ganadora
        const dd = DOM05[dom];
        const N = cb[0];
        const thr = dd.thr[cb[1]];
        const qs = [cb[2], cb[3], cb[4]];
        const D = cb[5];
        const Bu = cb[6];
        const ev = eval05(dom, N, thr, qs);
        const pair = r.pick([['L4', 'T4'], ['L4', 'CPU'], ['T4', 'L4'], ['T4', 'CPU'], ['CPU', 'L4'], ['CPU', 'T4']]);
        const o1 = ev[pair[0]];
        const o2 = ev[pair[1]];
        const W = ev[w];
        const it = dd.item;
        let q;
        if (dom === 'soporte') {
          q = `Un equipo de atención al cliente quiere re-clasificar con un modelo nuevo de intención y urgencia (tipo BERT base) <b>${N} M mensajes</b> históricos (chats y correos de 3 años), para el panel de calidad que se lanza en <b>${D} h</b>. Finanzas aprobó hasta <b>US$${f(Bu)}</b>. Los mensajes se leen en Parquet: la lectura es despreciable.`;
        } else if (dom === 'logistica') {
          q = `Una empresa de logística quiere re-procesar con un detector de daños nuevo <b>${N} M fotos</b> de prueba de entrega de los últimos 2 años, para un reclamo a la aseguradora que vence en <b>${D} h</b>. Finanzas aprobó hasta <b>US$${f(Bu)}</b>. Leer cada foto de S3 cuesta ≈ US$0.0004 por 1,000 GETs (aprox.): US$0.40 por millón, con cualquier opción.`;
        } else {
          q = `Un e-commerce quiere regenerar con su modelo nuevo de búsqueda visual (un ViT) los embeddings de <b>${N} M fotos</b> del catálogo, para el buscador que se lanza en <b>${D} h</b>. Finanzas aprobó hasta <b>US$${f(Bu)}</b>. Leer cada foto de S3 cuesta ≈ US$0.0004 por 1,000 GETs (aprox.): US$0.40 por millón, con cualquier opción.`;
        }
        q += ` Opciones, con el throughput medido por máquina y el tope de máquinas a la vez (cuota y capacidad confirmada en la región):<ul><li>T4: g4dn.xlarge, ≈ US$0.526/h (aprox.), ≈ <b>${f(thr[0])} ${it}/s</b>; hasta <b>${qs[0]}</b> máquinas.</li><li>L4: g6.xlarge, ≈ US$0.805/h, ≈ <b>${f(thr[1])} ${it}/s</b>; hasta <b>${qs[1]}</b>.</li><li>CPU: c6i.xlarge (4 vCPU) con el modelo en INT8, ≈ US$0.17/h, ≈ <b>${f(thr[2])} ${it}/s</b>; hasta <b>${qs[2]}</b>.</li></ul>`;
        const line = (o) => `${OPT05[o].name}: ${f(ev[o].wall)} h (${ev[o].wall <= D ? 'llega' : 'no llega'}) y US$${f(ev[o].cost)} (${ev[o].cost <= Bu ? 'dentro del' : 'fuera del'} presupuesto).`;
        const reason = w === 'L4'
          ? 'es la más barata por millón y hay máquinas suficientes para el plazo'
          : w === 'T4'
            ? 'con las L4 que hay no se llega al plazo, y la T4 cumple plazo y presupuesto'
            : 'ninguna GPU llega al plazo con las máquinas que hay; las CPU sí, porque se consiguen muchas más, y entran en el presupuesto';
        const pick = r.shuffle([OPT05.T4.name, OPT05.L4.name, OPT05.CPU.name, 'El endpoint online de producción, que de noche está ocioso']);
        const okP = 'Escribir una versión nueva, validarla y cambiar el puntero de una vez; la anterior queda para rollback, el lookup tiene fallback y se alerta por la edad de la versión activa';
        const pub = r.shuffle([okP,
          'Escribir encima de la tabla actual a medida que avanza, para que lo nuevo se vea antes',
          'Borrar la tabla actual al empezar, para no mezclar versiones',
          'Publicar al terminar sin validar, y alertar si la CPU de los workers pasa de 90 %']);
        const say1 = w === 'L4'
          ? `L4s have the lowest cost per million and enough capacity to finish in about ${say(W.wall)} hours, within the deadline and the budget; the new table goes live with an atomic pointer swap.`
          : w === 'T4'
            ? `We can't get enough L4s to meet the deadline, so I run it on T4s: about ${say(W.wall)} hours and $${say(W.cost)}, inside both limits, and publish with an atomic swap.`
            : `Neither GPU type has enough capacity for the deadline, but ${qs[2]} INT8 CPU instances finish in about ${say(W.wall)} hours for about $${say(W.cost)}, within budget.`;
        return {
          q,
          parts: [
            {
              ask: `Costo por millón de ${it} en ${OPT05[pair[0]].name}, solo cómputo`, unit: 'US$/M', answer: o1.cpm, tol: 0.15,
              steps: [
                'Planteamiento: costo por millón = US$/h ÷ (ítems/s × 3,600) × 10⁶.',
                `${OPT05[pair[0]].price} ÷ (${f(o1.t)} × 3,600) × 10⁶ ≈ <b>US$${small(o1.cpm)}</b> por millón`,
              ],
            },
            {
              ask: `Horas de pared en ${OPT05[pair[1]].name}, con sus ${o2.q} máquinas`, unit: 'h', answer: o2.wall, tol: 0.15,
              steps: [
                'Planteamiento: horas de pared = ítems ÷ (ítems/s por máquina × máquinas × 3,600).',
                `${N} M ÷ (${f(o2.t)} × ${o2.q} × 3,600) ≈ <b>${f(o2.wall)} h</b>`,
              ],
            },
            {
              ask: `Costo total del backfill en ${OPT05[pair[0]].name}, con la lectura`, unit: 'US$', answer: o1.cost, tol: 0.15,
              steps: [
                'Planteamiento: millones de ítems × (costo por millón de cómputo + lectura por millón).',
                `Con el resultado de la primera parte: ${N} M × ${dd.read ? '(' + small(o1.cpm) + ' + ' + dd.read + ')' : small(o1.cpm)} ≈ <b>US$${f(o1.cost)}</b>, contra un presupuesto de US$${f(Bu)}`,
                dd.read
                  ? `La lectura de S3 es ≈ ${f(((N * dd.read) / o1.cost) * 100, 0)} % del total: en un backfill de fotos, leer puede costar tanto como inferir.`
                  : 'Sin costo de lectura, todo es cómputo: el costo por millón decide.',
              ],
            },
            {
              ask: '¿Con qué corres el backfill?', choices: pick, answer: pick.indexOf(OPT05[w].name),
              steps: [
                `Planteamiento: para cada opción, horas de pared con todas sus máquinas contra las ${D} h, y costo total (cómputo + lectura) contra los US$${f(Bu)}; de las que cumplen las dos, la más barata.`,
                line('T4'),
                line('L4'),
                line('CPU'),
                `Gana <b>${OPT05[w].name}</b>: ${reason}. Usa ≈ ${f((W.cost / Bu) * 100, 0)} % del presupuesto.`,
                'El endpoint online no: un backfill contra producción le roba capacidad a quien espera y rompe el p99 (M2). El batch lleva su propio cómputo.',
              ],
            },
            {
              ask: 'El modelo nuevo reemplaza al que hoy sirve el lookup. ¿Cómo publicas el resultado?', choices: pub, answer: pub.indexOf(okP),
              steps: [
                'Escribir encima a medida que avanza deja, si el job muere al 60 %, una mitad nueva y otra vieja que nada distingue: una corrida parcial publicada.',
                'Borrar la tabla vieja deja el lookup sin respuesta hasta que termine el job, y sin rollback si el modelo nuevo sale mal.',
                'Antes del cambio de puntero se valida: filas esperadas, nulos y la distribución de scores contra la versión anterior. Después, la alerta que importa es la edad de la versión activa, más el % de lookups que cae al fallback; la CPU de los workers no dice si lo publicado está viejo.',
              ],
            },
          ],
          hint: 'Para cada opción: costo por millón = US$/h ÷ (ítems/s × 3,600) × 10⁶; horas de pared = ítems ÷ (ítems/s × máquinas × 3,600); costo total = millones × (costo por millón + lectura). Descarta las que no llegan al plazo o se pasan del presupuesto, y elige la más barata de las que quedan.',
          takeaway: `<b>Requisito:</b> ${N} M ${it} en ≤ ${D} h y ≤ US$${f(Bu)}, con un tope de máquinas por tipo. <b>Decisión:</b> ${OPT05[w].name}: ≈ ${f(W.wall)} h y ≈ US$${say(W.cost)}. <b>Por qué:</b> ${reason}. <b>Trade-off:</b> la opción más barata por millón no sirve si no hay máquinas para el plazo: la cuota y la capacidad también son requisitos. Y el resultado se publica de forma atómica, con fallback y alerta por la edad de la versión activa. <i>"${say1}"</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
