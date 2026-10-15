/* Banco de problemas · Casos de diseño · Asíncrono con colas: nadie espera en línea (segundos a horas): 202 + job_id, workers por Little, backlog y vaciado, escalar a cero, prioridades, reintentos y DLQ.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js. Las decisiones que dependen de los números se eligen primero (cada resultado
   sale con frecuencia pareja) y después se toma una combinación de entradas que lo produce con ≥ 10 % de margen y con
   los cocientes que se redondean lejos de un entero. Las listas de combinaciones se arman una sola vez (caché). */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'asincrono')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  const L4_H = 0.805;            // g6.xlarge (L4), US$/h (aprox., ref-numeros)
  const L4_MES = L4_H * MES_H;   // ≈ US$588 al mes, encendida las 730 h
  const DIAS_MES = MES_H / 24;   // ≈ 30.4 días: horas facturadas al día → mes de costos

  // ------------------------------------------------------------ asi-01: ¿síncrono o 202 con job_id?
  // Una sola función por producto, con el mismo texto en los dos casos: lo que cambia es lo medido (los inputs de
  // cada cliente son chicos o grandes). Corto: p99 de 1–2.5 s, alguien lo espera en pantalla. Largo: p99 de 2–3 min,
  // pasa el timeout por defecto del API Gateway (29 s). Así decide el número, no la descripción de la tarea.
  // GPUs = ⌈llegadas × duración promedio ÷ 0.7⌉, lejos de un entero.
  const DOM_A1 = {
    legal: {
      where: 'Una plataforma legal quiere agregar a su app',
      task: 'leer con OCR los documentos que sube cada cliente y extraer cláusulas y fechas',
      corto: { m: [0.4, 0.6, 0.8], c: [1.2, 1.5, 2], lam: [10, 15, 20, 30, 40] },
      largo: { m: [40, 60, 90], c: [120, 150, 180], lam: [0.1, 0.15, 0.2, 0.3, 0.4] },
    },
    video: {
      where: 'Una plataforma de video quiere agregar a su app',
      task: 'analizar cada video subido (escenas, texto y audio) y sugerir título y etiquetas',
      corto: { m: [0.5, 0.8, 1.2], c: [1.5, 2, 2.5], lam: [8, 12, 16, 24, 30] },
      largo: { m: [50, 70, 90], c: [140, 160, 180], lam: [0.1, 0.15, 0.2, 0.3, 0.4] },
    },
    inmo: {
      where: 'Un portal inmobiliario quiere agregar a su app',
      task: 'generar el plano y las medidas de un inmueble a partir de sus fotos 360',
      corto: { m: [0.6, 0.9, 1.2], c: [1.5, 2, 2.5], lam: [5, 8, 12, 16, 20] },
      largo: { m: [60, 80, 100], c: [150, 170, 180], lam: [0.05, 0.1, 0.15, 0.2, 0.3] },
    },
  };
  let POOL_A1 = null;
  function poolA1() {
    if (POOL_A1) return POOL_A1;
    POOL_A1 = {};
    Object.keys(DOM_A1).forEach((dom) => ['corto', 'largo'].forEach((kind) => {
      const v = DOM_A1[dom][kind];
      const out = [];
      v.m.forEach((m) => v.c.forEach((c) => v.lam.forEach((lam) => {
        if (c <= m * 1.2 || !far((lam * m) / 0.7, 0.05)) return;
        out.push([m, c, lam]);
      })));
      POOL_A1[dom + '-' + kind] = out;
    }));
    return POOL_A1;
  }

  // ------------------------------------------------------------ asi-02: vaciar la cola tras el pico de un cierre
  // [llegada/s, trabajos/s por worker, workers, backlog, SLO en min]: la capacidad está entre 1.25× y 4× la llegada; o la
  // cola se vacía antes del 90 % del SLO, o el percentil 95 del backlog espera ≥ 110 % del SLO; ⌈workers necesarios⌉ lejos
  // de un entero y como mucho 3× los de hoy.
  const DOM_A2 = {
    edu: { lam: [1, 2, 3, 4], c: [0.5, 1, 2], n: [4, 6, 8, 10, 12, 16], B: [6000, 9000, 12000, 18000, 24000, 30000], T: [20, 30, 45, 60] },
    logi: { lam: [2, 4, 6, 8], c: [2, 4, 5], n: [3, 4, 5, 6, 8], B: [10000, 20000, 30000, 40000, 60000], T: [15, 20, 30, 45] },
    becas: { lam: [0.5, 1, 2], c: [0.5, 1], n: [4, 5, 6, 8, 10], B: [4000, 6000, 8000, 12000, 16000], T: [30, 45, 60, 90] },
  };
  let POOL_A2 = null;
  function poolA2() {
    if (POOL_A2) return POOL_A2;
    POOL_A2 = { no: {}, si: {} };
    Object.keys(DOM_A2).forEach((dom) => {
      const v = DOM_A2[dom];
      POOL_A2.no[dom] = [];
      POOL_A2.si[dom] = [];
      v.lam.forEach((lam) => v.c.forEach((c) => v.n.forEach((n) => v.B.forEach((Bk) => v.T.forEach((T) => {
        const mu = n * c;
        if (mu < 1.25 * lam || mu > 4 * lam) return;
        const X = Bk / (mu - lam) / 60;                        // min para vaciar
        const p95 = (0.95 * Bk) / mu / 60 + 1 / c / 60;        // espera + proceso del percentil 95 del backlog, en min
        const need = (lam + Bk / (60 * T)) / c;
        if (!far(need, 0.05) || ceilx(need) > 3 * n) return;
        if (X <= 0.9 * T) POOL_A2.no[dom].push([lam, c, n, Bk, T]);
        else if (p95 >= 1.1 * T) POOL_A2.si[dom].push([lam, c, n, Bk, T]);
      })))));
    });
    return POOL_A2;
  }

  // ------------------------------------------------------------ asi-03: escalar a cero, precalentar o dejar un worker
  // [nodo, imagen, modelo, min de trabajo por tanda, SLO]: con mínimo 0 la tanda entra en el SLO (≤ 90 %) o no entra
  // (≥ 110 %); el precalentado vale si el aviso llega ≥ 10 % antes de que termine el arranque. Grupos por SLO con los
  // dos casos (entra y no entra), y el aviso se sortea aparte: ni el SLO ni que haya aviso deciden solos. Cuando hay
  // aviso, siempre llega antes de que termine el arranque (L ≥ 1.1 × arranque): así precalentar factura L + trabajo +
  // cooldown por tanda, y lo que decide es si el arranque en frío entra en el SLO.
  // Arranque de 5–14 min (nodo 2–5, imagen 2–6, modelo 1–3), dentro de los ≈ 5–13 min de M6.
  const DOM_A3 = {
    agro: { M: [3, 4, 6, 8, 10, 12, 15], T: [8, 10, 12, 15, 20, 25], L: [15, 20, 30, 40], k: [4, 6, 8, 10] },
    salud: { M: [2, 3, 5, 8, 10], T: [8, 10, 12, 15, 20], L: [10, 15, 20], k: [6, 8, 12, 16] },
    fabrica: { M: [4, 5, 8, 10, 12, 15], T: [10, 12, 15, 20, 25], L: [15, 20, 30], k: [3, 4, 6] },
  };
  let POOL_A3 = null;
  function poolA3() {
    if (POOL_A3) return POOL_A3;
    POOL_A3 = {};
    Object.keys(DOM_A3).forEach((dom) => {
      const v = DOM_A3[dom];
      const cells = {};
      [2, 3, 4, 5].forEach((a) => [2, 3, 4, 5, 6].forEach((b) => [1, 2, 3].forEach((mm) => v.M.forEach((M) => v.T.forEach((T) => {
        const C = a + b + mm;
        if (M > 0.6 * T) return;
        const t0 = C + M;
        const cl = (cells[T] = cells[T] || { T, cero: [], ceroA: [], uno: [], aviso: [] });
        if (t0 <= 0.9 * T) {
          cl.cero.push([a, b, mm, M, T]);
          if (v.L.some((L) => L >= 1.1 * C)) cl.ceroA.push([a, b, mm, M, T]);
        } else if (t0 >= 1.1 * T) {
          cl.uno.push([a, b, mm, M, T]);
          if (v.L.some((L) => L >= 1.1 * C)) cl.aviso.push([a, b, mm, M, T]);
        }
      })))));
      POOL_A3[dom] = Object.values(cells).filter((cl) => cl.cero.length >= 3 && cl.ceroA.length >= 3 && cl.uno.length >= 3 && cl.aviso.length >= 3);
    });
    return POOL_A3;
  }

  // ------------------------------------------------------------ asi-04: interactivo y masivo en la misma cola
  // [workers, llegadas/s interactivas, s por trabajo interactivo, SLO en s, trabajos del lote, s por trabajo masivo]:
  // la FIFO rompe el SLO ≥ 5× (y la espera queda entre 1 y 48 h); arreglarla con workers pediría ≥ 5× la flota;
  // ⌈ocupados ÷ 0.7⌉ lejos de un entero; y un trabajo masivo en curso (más el interactivo) queda ≤ 90 % o ≥ 110 % del SLO.
  // El trabajo masivo se describe igual en los dos casos, y (masivo + interactivo) ÷ SLO cae en 0.45–0.9 o en 1.1–2.2:
  // cerca del umbral por los dos lados. Grupos por SLO con los dos resultados, y dentro de cada uno se sortea la
  // duración del trabajo masivo: decide la comparación, no un valor solo.
  const DOM_A4 = {
    soporte: { n: [8, 10, 12, 16, 20], li: [0.5, 1, 1.5, 2], Si: [3, 4, 6, 8], Ti: [20, 30, 45, 60, 90], Sb: [20, 30, 45, 60], B: [2000, 3000, 5000, 8000, 12000, 20000, 40000, 60000] },
    rrhh: { n: [6, 8, 10, 12, 16], li: [0.2, 0.4, 0.6, 0.8], Si: [5, 6, 8, 10], Ti: [30, 45, 60, 90, 120], Sb: [20, 30, 45, 60], B: [1500, 2500, 4000, 6000, 10000, 20000, 40000] },
    market: { n: [10, 12, 16, 20, 24], li: [1, 2, 3, 4], Si: [2, 3, 4], Ti: [15, 20, 30, 45, 60], Sb: [15, 20, 30, 45], B: [3000, 5000, 8000, 12000, 20000, 50000, 80000, 120000] },
  };
  let POOL_A4 = null;
  function poolA4() {
    if (POOL_A4) return POOL_A4;
    POOL_A4 = {};
    Object.keys(DOM_A4).forEach((dom) => {
      const v = DOM_A4[dom];
      const cells = {};
      v.n.forEach((n) => v.li.forEach((li) => v.Si.forEach((Si) => v.Ti.forEach((Ti) => v.Sb.forEach((Sb) => v.B.forEach((Bk) => {
        const busy = li * Si;
        const k = ceilx(busy / 0.7);
        if (busy > 0.4 * n || !far(busy / 0.7, 0.05) || k < 1 || k > n / 2) return;
        const fifo = (Bk * Sb) / n;
        if (fifo < 5 * Ti || (Bk * Sb) / Ti < 5 * n || fifo > 48 * 3600 || fifo < 3600) return;
        const x = (Sb + Si) / Ti;
        const o = x >= 0.45 && x <= 0.9 ? 'prio' : x >= 1.1 && x <= 2.2 ? 'pool' : null;
        if (!o) return;
        const cl = (cells[Ti] = cells[Ti] || { prio: [], pool: [] });
        cl[o].push([n, li, Si, Ti, Bk, Sb]);
      }))))));
      POOL_A4[dom] = Object.values(cells).filter((cl) => cl.prio.length >= 10 && cl.pool.length >= 10);
    });
    return POOL_A4;
  }

  // ------------------------------------------------------------ asi-05: visibility timeout, reintentos y DLQ
  // [s promedio, p99 en s, min para terminar el trabajo de un worker caído, contados desde la interrupción]: copias con
  // VT de 30 s = ⌈promedio ÷ 30⌉ lejos de un entero; con VT = 2 × p99 el peor caso (cae apenas toma el trabajo: VT + p99
  // = 3 × p99) queda ≤ 90 % o ≥ 110 % del requisito; el VT de 2 min con heartbeat lo cumple (2 min + p99 ≤ 90 %).
  // 3 × p99 ÷ requisito cae en 0.5–0.9 o en 1.1–1.6: cerca del umbral por los dos lados. Grupos por requisito con los
  // dos resultados, y dentro de cada uno se sortea el p99: ni el requisito ni el p99 deciden solos, hay que compararlos.
  const DOM_A5 = {
    tel: { m: [40, 50, 70, 80, 100], c: [240, 300, 360, 420, 480, 600, 720], T: [10, 12, 15, 20, 25, 30, 40], lam: [0.2, 0.3, 0.5, 0.8, 1] },
    movil: { m: [40, 50, 70, 80], c: [240, 300, 360, 420, 480, 600], T: [10, 12, 15, 20, 25, 30], lam: [0.1, 0.2, 0.3, 0.5] },
    seguros: { m: [50, 70, 80, 100, 110], c: [300, 360, 420, 480, 600, 720, 900], T: [12, 15, 20, 25, 30, 40, 45], lam: [0.1, 0.2, 0.3, 0.4] },
  };
  let POOL_A5 = null;
  function poolA5() {
    if (POOL_A5) return POOL_A5;
    POOL_A5 = {};
    Object.keys(DOM_A5).forEach((dom) => {
      const v = DOM_A5[dom];
      const cells = {};
      v.m.forEach((m) => v.c.forEach((c) => v.T.forEach((T) => {
        if (!far(m / 30, 0.1) || c < 2 * m) return;
        const lim = 60 * T;
        const x = (3 * c) / lim;
        const o = x >= 0.5 && x <= 0.9 ? 'fijo' : x >= 1.1 && x <= 1.6 && 120 + c <= 0.9 * lim ? 'latido' : null;
        if (!o) return;
        const cl = (cells[T] = cells[T] || { fijo: [], latido: [] });
        cl[o].push([m, c, T]);
      })));
      POOL_A5[dom] = Object.values(cells).filter((cl) => cl.fijo.length >= 2 && cl.latido.length >= 2);
    });
    return POOL_A5;
  }

  B.formulas.push(
    { topic: 'asincrono', title: 'Workers de una cola (Little)', expr: 'en vuelo = llegadas × duración promedio (nunca el p99) · workers = ⌈en vuelo ÷ utilización objetivo⌉', ex: '0.2 trabajos/s × 90 s = 18 en vuelo → ⌈18 ÷ 0.7⌉ = 26 GPUs' },
    { topic: 'asincrono', title: 'Vaciar la cola tras un pico', expr: 'vaciado = backlog ÷ (capacidad − llegada) · espera del último del backlog ≈ backlog ÷ capacidad · capacidad para vaciar en T = llegada + backlog ÷ T', ex: '20,000 ÷ (12 − 4) = 2,500 s ≈ 42 min · para 20 min: 4 + 20,000 ÷ 1,200 ≈ 20.7 por segundo' },
    { topic: 'asincrono', title: 'Escalar a cero', expr: 'tanda con mínimo 0 = nodo + imagen + modelo + trabajo · facturado por tanda = arranque (o aviso) + trabajo + cooldown · mínimo 1 = 730 h', ex: '3 + 4 + 2 + 8 = 17 min · 6 tandas × 27 min = 2.7 h/día ≈ US$66/mes contra US$588' },
    { topic: 'asincrono', title: 'Visibility timeout y DLQ', expr: 'VT ≥ 2 × p99, o corto con heartbeat · con un VT corto, copias ≈ ⌈duración ÷ VT⌉ · worker caído (peor caso: cae apenas lo toma): termina ≈ VT + p99 después de la caída; con heartbeat, ≈ VT corto + p99 · hasta la DLQ ≈ recepciones × VT', ex: '70 s con VT de 30 s → 3 copias · p99 de 5 min: VT 10 min, peor caso ≈ 15 min; con heartbeat y VT de 2 min, ≈ 7 min · 5 × 10 = 50 min hasta la DLQ' },
  );

  B.templates.push(
    // ======================================================== asi-01
    {
      id: 'asi-01', topic: 'asincrono', level: 1, title: '¿Síncrono o 202 con job_id?', ref: 'm02.tabla-decision',
      gen(r) {
        const kind = r.pick(['corto', 'largo']);
        const dom = r.pick(['legal', 'video', 'inmo']);
        const v = DOM_A1[dom];
        const cb = r.pick(poolA1()[dom + '-' + kind]);
        const m = cb[0];
        const c = cb[1];
        const lam = cb[2];
        const busy = lam * m;
        const n = ceilx(busy / 0.7);
        const cost = n * L4_MES;
        const sync = kind === 'corto';
        const q = `${v.where} una función: <b>${v.task}</b>. Con inputs reales, cada trabajo ocupa una GPU ≈ <b>${f(m)} s</b> en promedio (p99 ≈ <b>${f(c)} s</b>; medidos), y en el pico llegan ≈ <b>${f(lam)} por segundo</b>. La persona espera el resultado en la app, detrás de un API Gateway que corta cada request a los <b>29 s</b> (su límite por defecto). Cada GPU (L4 en g6.xlarge, ≈ US$0.805/h, aprox.) atiende un trabajo a la vez.`;
        const okS = 'Online síncrono: responder dentro del request, con timeout y fallback';
        const okA = 'Asíncrono: 202 con job_id, cola y workers, y avisar al terminar';
        const choices = r.shuffle([okS, okA, 'Batch nocturno con lookup', 'Streaming sobre un log de eventos (Kafka)']);
        const say1 = sync
          ? `The p99 is about ${f(c)} seconds and the person is waiting, so I answer synchronously with a short timeout; if it grew toward the gateway timeout, I'd switch to a job.`
          : `The p99 is about ${f(c)} seconds, past the 29-second gateway timeout, so the API returns a 202 with a job ID and workers process it from a queue; by Little's law that's about ${n} GPUs at the peak.`;
        return {
          q,
          parts: [
            {
              ask: '¿Qué patrón eliges?', choices, answer: choices.indexOf(sync ? okS : okA),
              steps: [
                'Planteamiento: ¿quién espera y cuánto? Compara el p99 del trabajo con el timeout más corto del camino (los 29 s por defecto del gateway) y con lo que una persona tolera mirando la pantalla.',
                sync
                  ? `El p99 (${f(c)} s) entra de sobra en los 29 s y la persona espera ≈ ${f(m)} s en promedio: <b>online síncrono</b>, con un timeout corto y un fallback. Convertirlo en job sumaría estado, aviso y polling para algo que responde en segundos.`
                  : `El p99 (${f(c)} s) pasa los 29 s del gateway: el request se cortaría antes de terminar, y reintentarlo repetiría el trabajo. Es un job: <b>202 con job_id</b>, cola, workers que escalan por backlog y un aviso al terminar (push a la app o polling).`,
                'Batch nocturno no sirve: el input nace con el pedido y la persona quiere el resultado en segundos o minutos, no mañana.',
                'Streaming es para flujos continuos de eventos con frescura de segundos (consumer lag); aquí cada pedido es un trabajo independiente.',
              ],
            },
            {
              ask: 'GPUs para el pico, al 70 % de utilización', unit: 'GPUs', answer: n, tol: 0,
              steps: [
                'Planteamiento (Little): trabajos en vuelo = llegadas × duración promedio (el p99 no: Little usa el promedio); GPUs = ⌈en vuelo ÷ 0.7⌉.',
                `${f(lam)} × ${f(m)} s = ${f(busy)} en vuelo → ⌈${f(busy)} ÷ 0.7⌉ = ⌈${f(busy / 0.7, 2)}⌉ = <b>${n} GPUs</b>`,
                sync ? 'En síncrono, súmale una de N+1: si cae una GPU, las demás tienen que aguantar el pico.' : 'En asíncrono no hace falta N+1: una GPU caída solo atrasa la cola unos minutos.',
              ],
            },
            {
              ask: 'Costo mensual si esas GPUs quedaran encendidas todo el mes', unit: 'US$/mes', answer: cost, tol: 0.15,
              steps: [
                'Planteamiento: GPUs × US$/h × 730 h.',
                `Con el resultado anterior: ${n} × 0.805 × 730 ≈ <b>US$${f(cost)}/mes</b>`,
                sync
                  ? 'Es un techo: con autoscaling (por concurrencia o tiempo en cola), la flota baja fuera del pico, sin bajar del mínimo con N+1.'
                  : 'Es un techo: con KEDA, los workers siguen al backlog y bajan fuera del pico (hasta cero, si el SLO tolera el arranque en frío).',
              ],
            },
          ],
          hint: 'Primero, quién espera y cuánto: compara el p99 del trabajo con el timeout más corto del camino. Después Little con la duración promedio (llegadas × duración = trabajos en vuelo), divide por la utilización objetivo y redondea hacia arriba. Costo = GPUs × US$/h × 730.',
          takeaway: `<b>Requisito:</b> ${v.task}, con un p99 de ≈ ${f(c)} s y un gateway que corta a los 29 s (por defecto). <b>Decisión:</b> ${sync ? 'online síncrono' : 'asíncrono: 202 con job_id'}. <b>Por qué:</b> ${sync ? 'termina en segundos y la persona lo espera en pantalla' : 'ningún request puede quedar abierto minutos: el contrato pasa a ser un job con estado'}. <b>Tamaño:</b> ${n} GPUs en el pico (≈ US$${say(cost)}/mes como techo). <b>Trade-off:</b> ${sync ? 'si el trabajo creciera y su p99 se acercara al timeout, se convierte en job' : 'el job agrega estado, aviso e idempotencia por job_id; a cambio, ningún timeout lo corta y los workers escalan por backlog'}. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== asi-02
    {
      id: 'asi-02', topic: 'asincrono', level: 1, title: '¿Cuánto tarda en vaciarse la cola?', ref: 'm02.asincrona-colas',
      gen(r) {
        const res = r.pick(['no', 'si']);
        const dom = r.pick(['edu', 'logi', 'becas']);
        const cb = r.pick(poolA2()[res][dom]);
        const lam = cb[0];
        const c = cb[1];
        const n = cb[2];
        const Bk = cb[3];
        const T = cb[4];
        const mu = n * c;
        const X = Bk / (mu - lam) / 60;
        const last = Bk / mu / 60;
        const p95 = (0.95 * Bk) / mu / 60;
        const need = lam + Bk / (60 * T);
        const n2 = ceilx(need / c);
        const add = res === 'si';
        let q;
        let item;
        if (dom === 'edu') {
          item = 'los ensayos';
          q = `Una plataforma educativa corrige ensayos con un modelo en GPU, detrás de una cola. Hay <b>${n} workers</b> que corrigen ≈ <b>${f(c)} ensayos/s</b> cada uno (medido), y llegan ≈ <b>${f(lam)} ensayos/s</b> de otros cursos. A las 23:59 cerró la entrega de un curso masivo y en la cola quedaron ≈ <b>${f(Bk)} ensayos</b>. SLO: el 95 % de las entregas corregidas en ≤ <b>${T} min</b>.`;
        } else if (dom === 'logi') {
          item = 'las fotos';
          q = `Una empresa de logística revisa con un modelo las fotos de prueba de entrega (paquete en la puerta, firma). Al cierre del día el equipo de reparto sincroniza sus teléfonos y en la cola quedan ≈ <b>${f(Bk)} fotos</b>; después siguen llegando ≈ <b>${f(lam)} fotos/s</b>. Hay <b>${n} workers</b> de ≈ <b>${f(c)} fotos/s</b> cada uno (medido). SLO: el 95 % de las fotos revisadas en ≤ <b>${T} min</b>, porque con ellas se liquida el pago del reparto.`;
        } else {
          item = 'los documentos';
          q = `Un programa público de becas valida con un modelo los documentos que suben las familias (identificación, constancia de estudios). El último día de la convocatoria quedaron ≈ <b>${f(Bk)} documentos</b> en la cola, y siguen llegando ≈ <b>${f(lam)} por segundo</b>. Hay <b>${n} workers</b> de ≈ <b>${f(c)} documentos/s</b> cada uno (medido). SLO: el 95 % validado en ≤ <b>${T} min</b>, para que cada familia alcance a corregir antes del cierre.`;
        }
        const okNo = 'Nada: con la capacidad de hoy la cola se vacía antes del SLO';
        const okSi = 'Sumar workers, escalando por backlog: con la capacidad de hoy, el pico espera más que el SLO';
        const choices = r.shuffle([okNo, okSi,
          'Subir el visibility timeout para que los trabajos esperen sin vencer',
          'Devolver 429 a lo que llegue durante el pico, para proteger la cola']);
        const say1 = add
          ? `At ${f(mu)} jobs per second the backlog takes about ${say(X)} minutes to drain, past the ${T}-minute SLO, so I scale to ${n2} workers on backlog per worker, and next time I scale ahead of the deadline.`
          : `The backlog drains in about ${say(X)} minutes, inside the ${T}-minute SLO, so the current workers are enough; I alert on the age of the oldest message.`;
        return {
          q,
          parts: [
            {
              ask: 'Minutos para vaciar la cola con los workers de hoy', unit: 'min', answer: X, tol: 0.15,
              steps: [
                'Planteamiento: mientras se vacía siguen llegando trabajos, así que la cola baja a la diferencia: tiempo = backlog ÷ (capacidad − llegada), con capacidad = workers × trabajos/s por worker.',
                `Capacidad: ${n} × ${f(c)} = ${f(mu)} por segundo → ${f(Bk)} ÷ (${f(mu)} − ${f(lam)}) ≈ ${f(X * 60)} s ≈ <b>${f(X)} min</b>`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(add ? okSi : okNo),
              steps: [
                add
                  ? `El último del backlog espera ≈ ${f(Bk)} ÷ ${f(mu)} ≈ ${f(last)} min y el 95 % de ${item} del pico, ≈ ${f(p95)} min: más que los ${T} min del SLO. Hay que <b>sumar workers</b> (con KEDA, por backlog por worker).`
                  : `La cola se vacía en ≈ ${f(X)} min, antes de los ${T} min del SLO: ninguno del backlog espera más que eso. <b>No hace falta escalar</b>.`,
                'El visibility timeout cuida a un trabajo que ya está en proceso (si el worker muere, vuelve a la cola); no cambia cuánto espera un trabajo en la cola.',
                'Un 429 es para la sobrecarga sostenida o un cliente que abusa; aquí son envíos legítimos de un pico conocido. Rechazarlos le pasa el problema a quien envía.',
              ],
            },
            {
              ask: `Workers necesarios para vaciarla en ≤ ${T} min`, unit: 'workers', answer: n2, tol: 0,
              steps: [
                'Planteamiento: la capacidad tiene que cubrir la llegada más el backlog repartido en el SLO: capacidad = llegada + backlog ÷ (min × 60); workers = ⌈capacidad ÷ trabajos/s por worker⌉.',
                `${f(lam)} + ${f(Bk)} ÷ ${f(T * 60)} ≈ ${f(need)} por segundo → ⌈${f(need)} ÷ ${f(c)}⌉ = ⌈${f(need / c, 2)}⌉ = <b>${n2} workers</b>, contra ${n} hoy${n2 <= n ? ' (ya alcanza)' : ''}`,
              ],
            },
          ],
          hint: 'La cola baja a la diferencia entre capacidad y llegada: tiempo de vaciado = backlog ÷ (capacidad − llegada). Compáralo con el SLO. Para cumplirlo: capacidad = llegada + backlog ÷ tiempo del SLO, y workers = esa capacidad ÷ lo que procesa cada uno, hacia arriba.',
          takeaway: `<b>Requisito:</b> un backlog de ≈ ${say(Bk)} ${item.split(' ')[1]} y un SLO de ${T} min. <b>Números:</b> con ${n} workers se vacía en ≈ ${f(X)} min. <b>Decisión:</b> ${add ? `escalar a ${n2} workers` : 'no escalar'}. <b>Por qué:</b> la recuperación depende de la capacidad que sobra sobre la llegada, no de la capacidad total. <b>Trade-off:</b> ${add ? 'más workers cuestan solo durante el pico, porque KEDA los baja después' : 'el margen de hoy alcanza para este pico; uno más grande ya no'}; como el pico es conocido, conviene escalar antes de la hora (programado) y dejar KEDA para lo imprevisto, con alerta por la edad del mensaje más viejo, no por la profundidad. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== asi-03
    {
      id: 'asi-03', topic: 'asincrono', level: 2, title: 'Escalar a cero o dejar un worker', ref: 'm06.keda',
      gen(r) {
        const dom = r.pick(['agro', 'salud', 'fabrica']);
        const v3 = DOM_A3[dom];
        const cell = r.pick(poolA3()[dom]);          // primero el SLO
        const aviso = r.pick([true, false]);         // después, si hay aviso
        const res = r.pick(['cero', 'falta', 'falta']) === 'cero' ? 'cero' : aviso ? 'aviso' : 'uno';
        const cb = r.pick(res === 'cero' && aviso ? cell.ceroA : cell[res]);
        const a = cb[0];
        const b = cb[1];
        const mm = cb[2];
        const M = cb[3];
        const T = cb[4];
        const L = aviso ? r.pick(v3.L.filter((x) => x >= 1.1 * (a + b + mm))) : 0;
        const k = r.pick(v3.k);
        const cd = r.pick([5, 10, 15]);
        const C = a + b + mm;
        const t0 = C + M;
        const hd = (k * (C + M + cd)) / 60;      // h facturadas al día con mínimo 0
        const c0 = hd * DIAS_MES * L4_H;
        const hB = (k * (L + M + cd)) / 60;      // con precalentado: desde el aviso hasta el cooldown
        const cB = hB * DIAS_MES * L4_H;
        const cost = res === 'cero' ? c0 : res === 'aviso' ? cB : L4_MES;
        let q;
        let sigEn;
        if (dom === 'agro') {
          sigEn = 'takeoff signal';
          q = `Una empresa de agro analiza con un modelo en GPU las fotos de sus drones: cada vuelo sube una tanda al aterrizar, ≈ <b>${k} tandas al día</b>, separadas por horas y a horas que dependen del clima. Cada tanda ocupa un worker ≈ <b>${M} min</b>, y el reporte tiene que estar en ≤ <b>${T} min</b> desde que llega la tanda. ${aviso ? `La app de vuelo avisa al despegar, y cada vuelo dura ≈ <b>${L} min</b>.` : 'Las tandas llegan sin aviso: las fotos se suben cuando hay señal.'}`;
        } else if (dom === 'salud') {
          sigEn = 'study-start signal';
          q = `Un servicio de telerradiología analiza con un modelo en GPU los estudios que mandan clínicas pequeñas: llegan en tandas, ≈ <b>${k} al día</b> y separadas por horas. Cada tanda ocupa un worker ≈ <b>${M} min</b>, y el informe preliminar tiene que estar en ≤ <b>${T} min</b> desde que llega. ${aviso ? `El sistema de la clínica avisa al empezar cada estudio, ≈ <b>${L} min</b> antes de enviarlo.` : 'Las tandas llegan sin aviso.'}`;
        } else {
          sigEn = 'last-station signal';
          q = `Una planta revisa con un modelo en GPU las fotos de calidad que se toman al cerrar cada lote de producción: ≈ <b>${k} lotes al día</b>, separados por horas y sin horario fijo. Cada tanda ocupa un worker ≈ <b>${M} min</b>, y el resultado tiene que estar en ≤ <b>${T} min</b> para liberar el lote. ${aviso ? `El sistema de la planta avisa cuando un lote entra a la última estación, ≈ <b>${L} min</b> antes de que lleguen sus fotos.` : 'Los lotes cierran sin aviso.'}`;
        }
        q += ` Los workers escalan con KEDA por la cola. Un worker nuevo tarda ≈ <b>${a} min</b> en conseguir el nodo GPU, ≈ <b>${b} min</b> en bajar la imagen y ≈ <b>${mm} min</b> en cargar el modelo (medido), y se apaga tras <b>${cd} min</b> sin trabajo. Una g6.xlarge (L4) cuesta ≈ US$0.805/h (aprox.): siempre encendida, ≈ US$588/mes.`;
        const okA = 'Mínimo 0: el arranque en frío entra en el SLO';
        const okB = 'Mínimo 0, arrancando un worker con el aviso: el arranque no entra en el SLO, pero el aviso llega antes';
        const okC = 'Mínimo 1 siempre encendido: el arranque no entra en el SLO y no hay aviso que alcance';
        const choices = r.shuffle([okA, okB, okC, 'Mínimo 0, escalando por la CPU del pod: reacciona antes que la cola']);
        const say1 = res === 'cero'
          ? `A ${C}-minute cold start plus ${M} minutes of work fits in the ${T}-minute SLO, so the workers scale to zero and we pay about $${say(c0)} a month instead of $588 for an always-on GPU.`
          : res === 'aviso'
            ? `A cold start doesn't fit in the ${T}-minute SLO, but the ${sigEn} arrives ${L} minutes ahead, so I start a worker on that signal and still scale to zero between batches.`
            : `A ${C}-minute cold start doesn't fit in a ${T}-minute SLO and batches arrive without warning, so I keep one warm worker; that's the price of the SLO.`;
        return {
          q,
          parts: [
            {
              ask: 'Minutos hasta tener una tanda procesada con mínimo 0', unit: 'min', answer: t0, tol: 0.15,
              steps: [
                'Planteamiento: con mínimo 0, la tanda espera el arranque completo (nodo + imagen + modelo) y después se procesa.',
                `${a} + ${b} + ${mm} = ${C} min de arranque + ${M} min de trabajo = <b>${t0} min</b>`,
              ],
            },
            {
              ask: 'Horas facturadas al día con mínimo 0', unit: 'h/día', answer: hd, tol: 0.15,
              steps: [
                'Planteamiento: cada tanda factura arranque + trabajo + cooldown (el worker se apaga después); al día, × tandas.',
                `${k} × (${C} + ${M} + ${cd}) = ${k * (C + M + cd)} min ≈ <b>${f(hd)} h/día</b>`,
              ],
            },
            {
              ask: 'Costo mensual con mínimo 0', unit: 'US$/mes', answer: c0, tol: 0.15,
              steps: [
                'Planteamiento: horas facturadas al día × 30.4 días (730 h ÷ 24) × US$/h.',
                `Con el resultado anterior: ${f(hd)} × 30.4 × 0.805 ≈ <b>US$${f(c0)}/mes</b>, ≈ ${f((1 - c0 / L4_MES) * 100, 0)} % menos que un worker siempre encendido (≈ US$588)`,
              ],
            },
            {
              ask: '¿Cómo configuras el mínimo de workers?', choices, answer: choices.indexOf(res === 'cero' ? okA : res === 'aviso' ? okB : okC),
              steps: [
                `Con mínimo 0, la tanda está lista a los ${t0} min, contra un SLO de ${T} min: ${t0 <= T ? 'entra' : 'no entra'}.`,
                res === 'cero'
                  ? '<b>Mínimo 0</b>: el arranque en frío entra en el SLO, y pagas solo las horas facturadas.'
                  : res === 'aviso'
                    ? `<b>Mínimo 0 con precalentado</b>: el aviso llega ≈ ${L} min antes y el arranque tarda ${C} min; si el worker arranca con el aviso, ya está listo cuando llega la tanda, que termina a los ${M} min. Cada tanda factura aviso + trabajo + cooldown: ${k} × (${L} + ${M} + ${cd}) ÷ 60 ≈ ${f(hB)} h/día, ≈ US$${f(cB)}/mes.`
                    : `<b>Mínimo 1</b>: no entra y las tandas llegan sin aviso; la única forma de cumplir es un worker siempre encendido, ≈ US$${f(L4_MES - c0)} más al mes que con mínimo 0: el precio del SLO.`,
                res === 'aviso'
                  ? 'Si el aviso llega siempre con la misma anticipación, el arranque se puede demorar para que termine justo cuando llega la tanda: costaría casi lo mismo que el mínimo 0.'
                  : res === 'cero' && aviso
                    ? `Precalentar con el aviso también cumpliría, pero pagando ≈ US$${f(cB)}/mes por algo que no hace falta.`
                    : 'El mínimo 1 cumple cualquier SLO más largo que el trabajo, pero paga las 730 h aunque las tandas ocupen pocas.',
                'Con cero pods no hay CPU que medir: desde cero, KEDA escala por la cola. Y la CPU del pod no ve la GPU ni el backlog (M6).',
              ],
            },
          ],
          hint: 'Tiempo con mínimo 0 = arranque (nodo + imagen + modelo) + trabajo; compáralo con el SLO. Si no entra, mira si hay un aviso que llegue antes de que termine el arranque. Costo: horas facturadas por tanda (arranque o aviso + trabajo + cooldown) × tandas × 30.4 días × US$/h, contra las 730 h del mínimo 1.',
          takeaway: `<b>Requisito:</b> tandas de ≈ ${M} min de trabajo con un SLO de ${T} min, y un arranque en frío de ${C} min. <b>Decisión:</b> ${res === 'cero' ? 'mínimo 0' : res === 'aviso' ? 'mínimo 0, precalentando con el aviso' : 'mínimo 1'}, ≈ US$${say(cost)}/mes. <b>Por qué:</b> ${res === 'cero' ? 'el arranque entra en el SLO' : res === 'aviso' ? 'el arranque no entra, pero el aviso llega antes de que haga falta' : 'el arranque no entra y no hay aviso'}. <b>Trade-off:</b> escalar a cero ahorra la mayor parte de la factura, pero cada tanda paga el arranque; un aviso o un horario conocido permite precalentar, y la imagen en la AMI y los pesos en disco local achican el arranque. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== asi-04
    {
      id: 'asi-04', topic: 'asincrono', level: 2, title: 'Dos clases de trabajo en la misma cola', ref: 'm02.asincrona-colas',
      gen(r) {
        const res = r.pick(['prio', 'pool']);
        const dom = r.pick(['soporte', 'rrhh', 'market']);
        const list = r.pick(poolA4()[dom])[res];                     // primero el SLO
        const sb = r.pick([...new Set(list.map((e) => e[5]))]);      // después la duración del trabajo masivo
        const cb = r.pick(list.filter((e) => e[5] === sb));
        const n = cb[0];
        const li = cb[1];
        const Si = cb[2];
        const Ti = cb[3];
        const Bk = cb[4];
        const Sb = cb[5];
        const fifo = (Bk * Sb) / n / 3600;        // h de espera detrás del lote
        const busy = li * Si;                     // workers ocupados por lo interactivo
        const k = ceilx(busy / 0.7);
        const prio = res === 'prio';
        const hrs = prio ? (Bk * Sb) / ((n - busy) * 3600) : (Bk * Sb) / ((n - k) * 3600);
        const nF = (Bk * Sb) / Ti;
        let q;
        if (dom === 'soporte') {
          q = `Un software de atención al cliente extrae datos de los adjuntos de los tickets con un modelo en GPU, detrás de una cola FIFO con <b>${n} workers</b> (un trabajo a la vez cada uno). <b>Interactivo:</b> quien atiende abre un ticket y espera los datos del adjunto: llegan ≈ <b>${f(li)} por segundo</b>, tardan ≈ <b>${Si} s</b> (medido) y el SLO es ≤ <b>${Ti} s</b>. <b>Masivo:</b> un cliente nuevo migra su histórico y encola <b>${f(Bk)} trabajos</b> de golpe (un ticket con sus adjuntos cada uno), de ≈ <b>${Sb} s</b> cada uno (medido).`;
        } else if (dom === 'rrhh') {
          q = `Una plataforma de empleo lee CVs con un modelo en GPU, detrás de una cola FIFO con <b>${n} workers</b> (un trabajo a la vez cada uno). <b>Interactivo:</b> quien postula sube su CV y espera ver su perfil autocompletado: llegan ≈ <b>${f(li)} por segundo</b>, tardan ≈ <b>${Si} s</b> (medido) y el SLO es ≤ <b>${Ti} s</b>. <b>Masivo:</b> una empresa importa su base de postulaciones: <b>${f(Bk)} trabajos</b> de golpe (una postulación con sus archivos cada uno), de ≈ <b>${Sb} s</b> cada uno (medido).`;
        } else {
          q = `Un marketplace sugiere la categoría y modera las fotos de cada producto con un modelo en GPU, detrás de una cola FIFO con <b>${n} workers</b> (un trabajo a la vez cada uno). <b>Interactivo:</b> quien vende publica un producto y espera la categoría sugerida: llegan ≈ <b>${f(li)} por segundo</b>, tardan ≈ <b>${Si} s</b> (medido) y el SLO es ≤ <b>${Ti} s</b>. <b>Masivo:</b> una tienda grande importa su catálogo: <b>${f(Bk)} trabajos</b> de golpe (un producto con sus fotos cada uno), de ≈ <b>${Sb} s</b> cada uno (medido).`;
        }
        const okP = 'Cola de prioridad en el mismo pool: un trabajo masivo en curso termina antes del SLO de lo interactivo';
        const okD = 'Pool separado con workers reservados para lo interactivo: un trabajo masivo en curso dura más que ese SLO';
        const choices = r.shuffle([okP, okD,
          'Agregar workers al pool FIFO hasta que la espera entre en el SLO',
          'Devolver 429 al lote masivo hasta que baje lo interactivo']);
        const say1 = prio
          ? `A bulk job takes about ${Sb} seconds, well under the ${Ti}-second interactive SLO, so a priority queue on the same pool is enough; the bulk import still finishes in about ${say(hrs)} hours.`
          : `A bulk job takes ${Sb} seconds and a priority queue can't preempt it, so interactive jobs get their own pool of ${k} workers and the bulk import uses the rest.`;
        return {
          q,
          parts: [
            {
              ask: 'Horas que espera un trabajo interactivo que llega justo después del lote, en la cola FIFO', unit: 'h', answer: fifo, tol: 0.15,
              steps: [
                'Planteamiento: en una FIFO, un trabajo espera a que los workers terminen todo lo que llegó antes: trabajos del lote × duración ÷ workers.',
                `${f(Bk)} × ${Sb} s ÷ ${n} = ${f((Bk * Sb) / n)} s ≈ <b>${f(fifo)} h</b>, contra un SLO de ${Ti} s`,
              ],
            },
            {
              ask: 'Workers que ocupa lo interactivo en promedio (Little)', unit: 'workers', answer: busy, tol: 0.15,
              steps: [
                'Planteamiento (Little): ocupados = llegadas × duración.',
                `${f(li)} × ${Si} s = <b>${f(busy)} workers</b> en promedio`,
              ],
            },
            {
              ask: '¿Qué cambias?', choices, answer: choices.indexOf(prio ? okP : okD),
              steps: [
                'Planteamiento: una cola de prioridad no interrumpe lo que ya está corriendo. Justo después de llegar el lote, todos los workers toman trabajos masivos a la vez, y un trabajo interactivo espera a que termine el primero: ≈ la duración de un trabajo masivo, más la suya.',
                prio
                  ? `${Sb} + ${Si} = ${Sb + Si} s ≤ ${Ti} s: con prioridad alcanza, sin reservar workers. <b>Cola de prioridad</b> (en SQS, una cola por clase y workers que leen primero la interactiva).`
                  : `${Sb} + ${Si} = ${Sb + Si} s > ${Ti} s: con prioridad igual se rompe el SLO. Lo interactivo necesita workers reservados: <b>pool separado</b>.`,
                `Para que la FIFO cumpla el SLO harían falta ≈ ${f(Bk)} × ${Sb} ÷ ${Ti} ≈ ${say(nF)} workers, contra ${n}: pagar ${f(nF / n, 0)}× la flota por un problema de orden.`,
                'El lote es trabajo legítimo con su propio plazo: se aísla (otra cola, baja prioridad o su propio pool), no se rechaza. Un 429 es para la sobrecarga sostenida o un cliente que abusa.',
              ],
            },
            {
              ask: 'Horas que tarda el lote con tu elección', unit: 'h', answer: hrs, tol: 0.15,
              steps: prio
                ? [
                  'Planteamiento: con prioridad, el lote usa la capacidad que deja lo interactivo: workers − ocupados por lo interactivo.',
                  `Con el resultado de la segunda parte: ${f(Bk)} × ${Sb} ÷ ((${n} − ${f(busy)}) × 3,600) ≈ <b>${f(hrs)} h</b>`,
                ]
                : [
                  'Planteamiento: con un pool separado, lo interactivo se queda con ⌈ocupados ÷ 0.7⌉ workers y el lote usa el resto.',
                  `Con el resultado de la segunda parte: ⌈${f(busy)} ÷ 0.7⌉ = ⌈${f(busy / 0.7, 2)}⌉ = ${k} reservados → ${f(Bk)} × ${Sb} ÷ ((${n} − ${k}) × 3,600) ≈ <b>${f(hrs)} h</b>`,
                ],
            },
          ],
          hint: 'Tres cuentas: espera en la FIFO = trabajos del lote × duración ÷ workers; Little para lo interactivo (llegadas × duración); y con prioridad, un trabajo interactivo espera a que termine un trabajo masivo en curso: compara esa duración, más la suya, con el SLO. El lote usa los workers que quedan.',
          takeaway: `<b>Requisito:</b> lo interactivo en ≤ ${Ti} s mientras entra un lote de ${say(Bk)} trabajos. <b>Diagnóstico:</b> en la FIFO, lo interactivo esperaría ≈ ${f(fifo)} h. <b>Decisión:</b> ${prio ? 'cola de prioridad en el mismo pool' : `pool separado con ${k} workers reservados`}; el lote tarda ≈ ${f(hrs)} h. <b>Por qué:</b> ${prio ? 'un trabajo masivo dura menos que el SLO de lo interactivo, así que basta con leer primero la cola interactiva' : 'un trabajo masivo dura más que el SLO, y una prioridad no interrumpe lo que ya corre'}. <b>Trade-off:</b> ${prio ? 'si los trabajos masivos se alargan, la prioridad deja de alcanzar: la espera de lo interactivo se mide por separado' : 'los workers reservados quedan ociosos buena parte del tiempo: es el precio del SLO'}; y siempre una cuota por cliente, para que un lote no tape a los demás. <i>"${say1}"</i>`,
        };
      },
    },
    // ======================================================== asi-05
    {
      id: 'asi-05', topic: 'asincrono', level: 3, title: 'Reintentos, visibility timeout y DLQ', ref: 'm02.entrega-reintentos',
      gen(r) {
        const res = r.pick(['fijo', 'latido']);
        const dom = r.pick(['tel', 'movil', 'seguros']);
        const list = r.pick(poolA5()[dom])[res];                     // primero el requisito
        const c99 = r.pick([...new Set(list.map((e) => e[1]))]);    // después el p99
        const cb = r.pick(list.filter((e) => e[1] === c99));
        const m = cb[0];
        const c = cb[1];
        const T = cb[2];
        const lam = r.pick(DOM_A5[dom].lam);
        const fail = r.pick([2, 3, 5, 8]);
        const cp = ceilx(m / 30);                  // copias con el VT de 30 s
        // Más recepciones que copias: si no, con el VT de 30 s un trabajo sano llegaría a la DLQ antes de terminar.
        const R = r.pick([3, 5].filter((x) => x > cp));
        const busy0 = lam * m * cp;
        const busy1 = lam * m * (1 + fail / 100);
        const fijo = res === 'fijo';
        const vt = fijo ? 2 * c : 120;             // s
        const dlq = (R * vt) / 60;                 // min
        let q;
        if (dom === 'tel') {
          q = `Un operador telefónico transcribe y puntúa (QA) las llamadas grabadas de su call center: cada llamada es un mensaje en una cola SQS que consumen workers con GPU. En el pico llegan ≈ <b>${f(lam)} llamadas/s</b>; procesar una tarda ≈ <b>${m} s</b> en promedio (p99 ≈ <b>${f(c)} s</b>, por las llamadas largas; medidos).`;
        } else if (dom === 'movil') {
          q = `Una app de transporte analiza los clips de dashcam de los incidentes que reportan quienes conducen: cada clip es un mensaje en una cola SQS que consumen workers con GPU. En el pico llegan ≈ <b>${f(lam)} clips/s</b>; analizar uno tarda ≈ <b>${m} s</b> en promedio (p99 ≈ <b>${f(c)} s</b>; medidos).`;
        } else {
          q = `Una aseguradora extrae los datos de cada expediente de siniestro (fotos y PDFs) con modelos en GPU: cada expediente es un mensaje en una cola SQS que consumen workers con GPU. En el pico llegan ≈ <b>${f(lam)} expedientes/s</b>; procesar uno tarda ≈ <b>${m} s</b> en promedio (p99 ≈ <b>${f(c)} s</b>, por los expedientes grandes; medidos).`;
        }
        q += ` Hoy el visibility timeout (VT) es el de SQS por defecto, <b>30 s</b>, y tras <b>${R} recepciones</b> el mensaje pasa a una DLQ. ≈ <b>${fail} %</b> de los intentos falla por un error transitorio (un servicio externo que vence) y se reintenta. Los workers corren en spot: si reclaman uno, su trabajo tiene que retomarse y terminar en ≤ <b>${T} min</b> desde la interrupción. Algunos archivos corruptos tumban al worker (OOM) apenas los abre.`;
        const okF = 'VT fijo de ≈ 2 × p99: aun con un worker caído, el trabajo termina a tiempo';
        const okH = 'VT corto (2 min) renovado con un heartbeat: con 2 × p99, un worker caído retrasaría demasiado su trabajo';
        const vts = r.shuffle([okF, okH,
          'Dejar los 30 s y hacer idempotente la escritura del resultado',
          'VT de 12 h, el máximo de SQS: así no se duplica nunca']);
        const okM = 'Alertar por la edad del mensaje más viejo contra el SLO y por mensajes en la DLQ; resultado con upsert por job_id, y los archivos inválidos marcados como failed sin reintento';
        const mon = r.shuffle([okM,
          'Alertar cuando la cola pase de 10,000 mensajes y reintentar sin límite',
          'Alertar por CPU de los workers arriba de 80 %, sin alerta en la DLQ',
          'Sin DLQ: los archivos corruptos se reintentan hasta que pasen']);
        const say1 = fijo
          ? `With a 30-second visibility timeout every job ran about ${cp} times; I set it to about twice the p99, since even a crashed worker's job still finishes within ${T} minutes of the interruption, and I alert on the age of the oldest message and on the DLQ.`
          : 'Twice the p99 would hide a crashed worker\'s job for too long, so I use a 2-minute visibility timeout renewed by a heartbeat, validate inputs before they reach the GPU, and alert on the oldest message\'s age and the DLQ.';
        return {
          q,
          parts: [
            {
              ask: 'Workers ocupados hoy en el pico por las copias que genera el VT de 30 s (sin contar los reintentos)', unit: 'workers', answer: busy0, tol: 0.15,
              steps: [
                'Planteamiento: con un VT de 30 s, un trabajo que tarda más reaparece en la cola cada 30 s y otro worker empieza una copia: copias ≈ ⌈duración ÷ 30 s⌉, con la duración promedio. Ocupados (Little) = llegadas × duración × copias.',
                `⌈${m} ÷ 30⌉ = ${cp} copias → ${f(lam)} × ${m} × ${cp} = <b>${f(busy0)} workers</b>, contra ${f(lam * m)} sin copias`,
              ],
            },
            {
              ask: '¿Qué visibility timeout configuras?', choices: vts, answer: vts.indexOf(fijo ? okF : okH),
              steps: [
                'Planteamiento: si un worker cae, su mensaje reaparece recién cuando vence el VT y otro worker empieza de nuevo. Con un VT fijo, el peor caso es caer apenas tomó el trabajo: reaparece a los VT y termina ≈ VT + p99 después de la caída. Con VT = 2 × p99, ≈ 3 × p99.',
                fijo
                  ? `3 × ${f(c)} s = ${f(3 * c)} s ≈ ${f((3 * c) / 60)} min ≤ ${T} min: el VT fijo alcanza y es lo más simple. <b>VT ≈ 2 × p99</b>.`
                  : `3 × ${f(c)} s = ${f(3 * c)} s ≈ ${f((3 * c) / 60)} min > ${T} min: con un VT fijo tan largo, un worker caído rompe el requisito. Con un VT de 2 min renovado cada minuto (ChangeMessageVisibility), uno vivo conserva su mensaje y uno caído deja de renovarlo: reaparece en ≤ 2 min y termina en ≈ 2 + ${f(c / 60)} = ${f(2 + c / 60)} min. <b>VT corto con heartbeat</b>.`,
                'La idempotencia evita efectos duplicados (el resultado se escribe una vez por job_id), pero no evita las copias: la GPU haría el mismo trabajo varias veces.',
                `Con 12 h, un worker caído deja su trabajo escondido 12 h, y un archivo corrupto tarda ${R} × 12 h en llegar a la DLQ.`,
              ],
            },
            {
              ask: 'Workers ocupados en el pico con el VT arreglado, contando los reintentos por fallas transitorias', unit: 'workers', answer: busy1, tol: 0.15,
              steps: [
                'Planteamiento: sin copias, la carga extra es la de los reintentos: cada falla transitoria repite el intento una vez.',
                `${f(lam)} × ${m} × ${f(1 + fail / 100, 2)} ≈ <b>${f(busy1)} workers</b>, ≈ ${f(busy0 - busy1)} menos que hoy`,
              ],
            },
            {
              ask: 'Minutos hasta que un archivo corrupto llega a la DLQ, con tu configuración', unit: 'min', answer: dlq, tol: 0.15,
              steps: [
                'Planteamiento: el worker muere apenas abre el archivo y el mensaje reaparece al vencer el VT; tras las recepciones permitidas pasa a la DLQ: tiempo ≈ recepciones × VT.',
                fijo
                  ? `VT = 2 × ${f(c)} = ${f(2 * c)} s → ${R} × ${f((2 * c) / 60)} min ≈ <b>${f(dlq)} min</b>`
                  : `VT de 2 min (el worker muere antes del primer heartbeat) → ${R} × 2 = <b>${f(dlq)} min</b>`,
                'Y cada intento reinicia un worker y recarga el modelo. Validar el archivo antes de cargarlo en la GPU (formato, duración, tamaño) lo descarta en el primer intento como error permanente: failed con motivo, sin reintento.',
              ],
            },
            {
              ask: '¿Qué alertas y qué garantías dejas?', choices: mon, answer: mon.indexOf(okM),
              steps: [
                'La edad del mensaje más viejo es lo que promete el SLO: 10,000 mensajes pueden ser 1 minuto o un día de trabajo, según la capacidad.',
                'Una DLQ sin alerta es un basurero; y sin DLQ, un archivo corrupto recicla workers para siempre. La CPU de los workers no dice si se cumple el SLO.',
                'Con at-least-once siempre habrá alguna entrega repetida: el upsert por job_id la hace inocua.',
              ],
            },
          ],
          hint: 'Con un VT más corto que el trabajo, copias ≈ ⌈duración ÷ VT⌉ y ocupados = llegadas × duración × copias. Para elegir el VT, un worker caído termina ≈ VT + duración: compáralo con el requisito. Hasta la DLQ: recepciones × VT. Alerta: lo que promete el SLO.',
          takeaway: `<b>Requisito:</b> el trabajo de un worker caído termina en ≤ ${T} min desde la interrupción. <b>Diagnóstico:</b> con el VT de 30 s, cada trabajo corre ≈ ${cp} veces: ≈ ${f(busy0)} workers ocupados en vez de ≈ ${f(busy1)}. <b>Decisión:</b> ${fijo ? `VT ≈ 2 × p99 (${f((2 * c) / 60)} min)` : 'VT de 2 min con heartbeat'}. <b>Por qué:</b> ${fijo ? `con 3 × p99 ≈ ${f((3 * c) / 60)} min, un worker caído se retoma igual a tiempo` : `con 2 × p99, un worker que cae apenas toma un trabajo lo dejaría terminar a los ≈ ${f((3 * c) / 60)} min`}. <b>Trade-off:</b> un VT largo es simple pero esconde el trabajo de un worker caído y demora la DLQ; uno corto con heartbeat lo libera rápido a cambio de un heartbeat que hay que operar. Con tu configuración, un archivo corrupto llega a la DLQ en ≈ ${f(dlq)} min: mejor validarlo antes de la GPU y marcarlo failed. <b>Monitoreo:</b> edad del mensaje más viejo contra el SLO y DLQ &gt; 0; el resultado, con upsert por job_id. <i>"${say1}"</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
