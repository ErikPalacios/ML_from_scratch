/* Banco de problemas · Estimaciones: casos tipo proyecto ("¿qué haces?") y diagnóstico ("¿cómo lo arreglas?").
   Se carga DESPUÉS de banco-estimaciones.js y agrega dos temas al mismo banco (MSD.problemBank.estimaciones):
   - proyecto (pr-*): requisitos → patrón, hardware o arquitectura → tamaño → trade-off con números.
   - diagnostico (dg-*): síntomas y números del dashboard → causa raíz → arreglo → impacto esperado.
   Mismo contrato que banco-estimaciones.js: gen(r) → {q, parts, hint, takeaway}. Las decisiones que dependen de
   los números se calculan en gen(), y las listas de entradas evitan empates y cocientes pegados a un entero
   (así un redondeo intermedio nunca cambia un conteo ni una decisión).
   Precios y specs: los de js/content/ref-numeros.js, M13 y los casos (c02, c04, c06, c10, c11, c13), marcados
   "aprox." o como supuesto. Convenciones: mes de costos = 730 h · mes de un SLO = 30 días (43,200 min). */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.estimaciones;
  if (!B) return;
  if (B.topics.some((t) => t.id === 'proyecto')) return;   // ya cargado

  // Formato de números como en el curso (el mismo f de banco-estimaciones.js): miles con coma, decimales con punto.
  const f = (x, d) => {
    const n = Number(x);
    const dec = d === undefined ? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2) : d;
    return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };
  // Tres cifras significativas para números chicos (US$0.000244).
  const g = (x) => {
    const n = Number(x);
    const a = Math.abs(n);
    if (a === 0) return '0';
    if (a >= 1) return f(n);
    const dec = Math.min(9, 2 - Math.floor(Math.log10(a)));
    return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };
  // Redondeos de conteo a prueba de ruido de punto flotante.
  const ceilx = (x) => Math.ceil(x - 1e-9);
  const floorx = (x) => Math.floor(x + 1e-9);
  // Lo que se dice en voz alta: enteros desde 10 y dos cifras significativas desde 1,000 (337,500 → 340,000).
  const say = (x) => {
    const n = Number(x);
    if (Math.abs(n) < 10) return f(n);
    if (Math.abs(n) < 1000) return f(n, 0);
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 1);
    return f(Math.round(n / p) * p);
  };
  // Lejos de un entero: ⌈x⌉ o ⌊x⌋ no cambian si la persona redondeó un paso anterior.
  const far = (x, d) => {
    const t = d === undefined ? 0.03 : d;
    const fr = x - Math.floor(x);
    return fr > t && fr < 1 - t;
  };
  const MES_H = 730;        // h por mes, para costos
  const MES_MIN = 43200;    // min en la ventana de 30 días de un SLO
  const SEG_MES = MES_H * 3600;   // 2,628,000 s

  B.topics.push({ id: 'proyecto', title: 'Diseña un proyecto' }, { id: 'diagnostico', title: 'Arregla o mejora' });
  B.summary += ' También casos completos: «queremos lograr esto, ¿qué haces?» y «tenemos este problema, ¿cómo lo arreglas o lo mejoras?».';

  B.formulas.push(
    { topic: 'proyecto', title: 'Punto de equilibrio', expr: 'lo fijo conviene cuando el volumen pasa de costo fijo ÷ (precio por unidad − costo propio por unidad)', ex: 'L4 por segundo vs dedicada: 24 h × 0.805 ÷ 1.05 ≈ 18 h facturadas al día · edge de c02: US$310 ÷ US$10.5 por cámara ≈ 30 cámaras' },
    { topic: 'diagnostico', title: 'Métrica por slice', expr: 'global = Σ fracción × métrica del slice → slice = (global − (1 − s) × resto) ÷ s', ex: '25 % del tráfico a 66 % y el resto a 90 %: 0.75 × 90 + 0.25 × 66 = 84 %' },
    { topic: 'diagnostico', title: 'Cuello de botella', expr: 'ritmo = mín(etapas) · CPU: vCPU ÷ segundos de CPU por ítem · GPU: ítems/s planificados', ex: 'c04: 4 vCPU ÷ 0.02 s = 200 tiles/s, justo lo que planifica la L4; con 30 ms por tile, 133: la GPU espera' },
  );

  B.templates.push(
    // ======================================================== DISEÑA UN PROYECTO
    {
      id: 'pr-01', topic: 'proyecto', level: 2, title: 'Herramienta interna: GPU por segundo o dedicada', ref: 'm06.serverless',
      gen(r) {
        const tool = r.pick([
          ['El equipo de reclamos de una aseguradora', 'estime el daño en las fotos de cada siniestro'],
          ['El equipo de calidad de una planta', 'revise en lotes las fotos de las piezas rechazadas'],
          ['El back-office de un marketplace', 'revise las fotos que la moderación automática dejó en duda'],
        ]);
        const H = r.pick([1, 2, 3, 4, 6, 8, 12, 20, 21]);   // horas con requests al día
        const N = r.pick([2, 3, 4]);                        // tandas al día
        const E = r.pick([15, 20, 30]);                     // min extra facturados por tanda
        const wait = r.pick(['tolera', 'tolera', 'no']);
        const billed = H + (N * E) / 60;
        const sl = billed * (MES_H / 24) * 1.05;
        const ded = 0.805 * MES_H;
        const be = (24 * 0.805) / 1.05;
        const useA = wait === 'tolera' && sl < ded;
        const okA = 'Cloud Run con L4 por segundo, escalando a cero';
        const okB = 'La g6.xlarge dedicada, encendida 24/7';
        const bad = 'Cloud Run con una instancia mínima siempre caliente, para no pagar el arranque';
        const choices = r.shuffle([okA, okB, bad]);
        const say1 = useA
          ? `It bills about ${f(billed, 1)} hours a day, far below the 18-hour break-even, and people can wait a minute for the first request, so per-second serverless GPUs win.`
          : wait === 'no'
            ? 'The first request of each burst can\'t wait for a cold start, and a warm minimum instance costs more than a dedicated L4, so I run a dedicated g6.xlarge.'
            : 'The GPU is busy almost all day, so per-second billing just means paying every hour at a premium; a dedicated L4 is cheaper.';
        return {
          q: `${tool[0]} quiere una herramienta interna que ${tool[1]}: un detector servido en una L4. El tráfico llega en <b>${N} tandas al día</b> que suman ≈ <b>${H} h</b> con requests; en cada tanda se facturan además ≈ <b>${E} min</b> de arranque y de rato ocioso antes de apagarse. ${wait === 'tolera'
            ? 'Quien la usa tolera esperar ≈ 1 min en el primer request de cada tanda.'
            : 'La llama otro servicio con un timeout de 2 s, que también corre para el primer request de cada tanda, y las tandas llegan sin aviso.'} Opciones (aprox.):<ul><li>Cloud Run con L4, facturado por segundo, que escala a cero: ≈ US$1.05/h por instancia encendida.</li><li>Una g6.xlarge (1 L4) dedicada, encendida 24/7: ≈ US$0.805/h, ≈ US$588/mes.</li></ul>`,
          parts: [
            {
              ask: 'Si Cloud Run escala a cero entre tandas, ¿cuántas horas de L4 factura al día?', unit: 'h/día', answer: billed, tol: 0.05,
              steps: [
                'Planteamiento: la nube cobra la instancia encendida, no la hora útil: horas facturadas = horas con requests + tandas × minutos extra por tanda ÷ 60.',
                `${H} + ${N} × ${E} ÷ 60 = ${H} + ${f((N * E) / 60)} = <b>${f(billed)} h/día</b>`,
              ],
            },
            {
              ask: 'Costo mensual de Cloud Run escalando a cero (mes de 730 h ≈ 30.4 días)', unit: 'US$/mes', answer: sl, tol: 0.15,
              steps: [
                'Planteamiento: costo = horas facturadas al día × días del mes × US$/h.',
                `Con el resultado anterior: ${f(billed)} × 30.4 × 1.05 ≈ <b>US$${f(sl)}/mes</b>`,
                'La dedicada cuesta 0.805 × 730 ≈ US$588/mes, la uses o no.',
              ],
            },
            {
              ask: '¿Qué eliges?', choices, answer: choices.indexOf(useA ? okA : okB),
              steps: [
                `Punto de equilibrio: la dedicada cuesta 24 h × 0.805 ≈ US$19.3 al día; Cloud Run, 1.05 por hora facturada. Conviene Cloud Run mientras factures menos de 19.3 ÷ 1.05 ≈ ${f(be, 1)} h al día; aquí facturas ${f(billed)} h.`,
                wait === 'no'
                  ? 'Pero el primer request de cada tanda pagaría un arranque en frío (instancia, imagen y modelo: decenas de segundos o más) contra un timeout de 2 s, y las tandas llegan sin aviso. Para evitarlo necesitarías una instancia mínima caliente, que cuesta más que la dedicada. Gana la dedicada.'
                  : useA
                    ? `Quien la usa tolera el arranque: Cloud Run sale ≈ US$${f(ded - sl)} más barato al mes (≈ ${f((1 - sl / ded) * 100, 0)} % menos) y no hay nodos que operar.`
                    : `La GPU trabaja casi todo el día: pagar por segundo es pagar casi todas las horas con ≈ 30 % de sobreprecio por hora de L4. Gana la dedicada, ≈ US$${f(sl - ded)} menos al mes.`,
                'La instancia mínima siempre caliente es la peor de las tres: paga las 730 h a la tarifa por segundo, 1.05 × 730 ≈ US$767/mes.',
              ],
            },
          ],
          hint: 'Separa dos variables: (1) cuántas horas factura cada opción (escalar a cero cobra las horas con requests más el arranque y el rato ocioso de cada tanda; la dedicada, las 730 h) y cuánto cuesta al mes; (2) si el primer request de cada tanda puede pagar un arranque en frío.',
          takeaway: `<b>Requisito:</b> ≈ ${f(billed)} h facturadas al día y ${wait === 'no' ? 'un primer request que no tolera un arranque en frío' : 'un primer request que tolera el arranque'}. <b>Decisión:</b> ${useA ? 'Cloud Run por segundo, con escala a cero' : 'la L4 dedicada'}. <b>Por qué:</b> el perfil de carga decide el costo (el equilibrio está en ≈ 18 h facturadas al día) y el SLO del primer request decide si puedes bajar a cero. <b>Lo revisas</b> ${wait === 'no'
            ? 'si el caller acepta un patrón asíncrono (cola y aviso al terminar): ahí sí podrías bajar a cero'
            : useA ? 'si el uso crece hacia ≈ 18 h facturadas al día o aparece un caller con timeout corto' : 'si el uso baja de ≈ 18 h facturadas al día'}. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'pr-02', topic: 'proyecto', level: 2, title: '¿T4 o L4? Depende de la carga', ref: 'm04.costo-por-prediccion',
      gen(r) {
        const k = r.pick([2, 2.5, 3]);
        const L = 600 * k;
        const costs = (p) => [(ceilx(p / 600) + 1) * 0.526 * MES_H, (ceilx(p / L) + 1) * 0.805 * MES_H];
        // Solo picos donde las dos flotas difieren ≥ 10 % y ningún cociente queda pegado a un entero.
        const P = r.pick([100, 150, 200, 300, 400, 500, 1400, 1700, 2500, 2800, 3500, 4000, 4500, 5000, 5500, 6500, 7000, 8000, 10000].filter((p) => {
          const c = costs(p);
          return far(p / 600) && far(p / L) && Math.abs(c[0] - c[1]) / Math.min(c[0], c[1]) >= 0.1;
        }));
        const nT = ceilx(P / 600) + 1;
        const nL = ceilx(P / L) + 1;
        const cT = nT * 0.526 * MES_H;
        const cL = nL * 0.805 * MES_H;
        const t4 = cT < cL;
        const diff = Math.abs(cT - cL);
        const okT = 'T4: la hora más barata';
        const okL = 'L4: la predicción más barata';
        const bad = 'A10G (g5.xlarge): más ancho de banda de memoria';
        const choices = r.shuffle([okT, okL, bad]);
        const why = t4
          ? (nT === nL
            ? `Pero con esta carga las dos opciones son ${nT} GPUs por N+1, casi ociosas: manda el precio por hora.`
            : `Pero aquí la L4 ahorra solo ${nT - nL} GPU${nT - nL === 1 ? '' : 's'}, y eso no paga su ≈ 53 % de sobreprecio por hora.`)
          : `Con varias GPUs trabajando, el throughput por dólar manda: ${nT - nL} GPU${nT - nL === 1 ? '' : 's'} menos pagan el sobreprecio por hora.`;
        const say1 = t4
          ? (nT === nL
            ? `At this load both options are ${nT} GPUs for N+1, mostly idle, so the cheaper hour wins: T4s.`
            : `The L4 saves only ${nT - nL === 1 ? 'one GPU' : nT - nL + ' GPUs'} here, which doesn't pay for its higher hourly price, so I stay on T4s.`)
          : `With ${nT} T4s against ${nL} L4s, throughput per dollar wins, as long as the load test confirms about ${k}x the T4.`;
        return {
          q: `Un servicio de clasificación de imágenes (ResNet-50 con TensorRT FP16 y dynamic batching) tiene un pico de diseño de <b>${f(P)} req/s</b>. Va siempre encendido, sin autoscaling y con <b>N+1</b>. Comparas dos GPUs (on-demand, aprox.):<ul><li>T4 (g4dn.xlarge, ≈ US$0.526/h): <b>600 img/s</b> planificadas por GPU (1,200 medidas, al 50 %).</li><li>L4 (g6.xlarge, ≈ US$0.805/h): el load test dio ≈ <b>${k}×</b> la T4, así que <b>${f(L)} img/s</b> planificadas.</li></ul>`,
          parts: [
            {
              ask: 'T4 en total (throughput + N+1)', unit: 'T4', answer: nT, tol: 0,
              steps: [
                'Planteamiento: GPUs = ⌈pico de diseño ÷ capacidad planificada⌉ + 1.',
                `⌈${f(P)} ÷ 600⌉ = ⌈${f(P / 600, 2)}⌉ = ${nT - 1}; + 1 = <b>${nT} T4</b>`,
              ],
            },
            {
              ask: 'L4 en total (throughput + N+1)', unit: 'L4', answer: nL, tol: 0,
              steps: [
                'Planteamiento: la misma fórmula con la capacidad planificada de la L4.',
                `⌈${f(P)} ÷ ${f(L)}⌉ = ⌈${f(P / L, 2)}⌉ = ${nL - 1}; + 1 = <b>${nL} L4</b>`,
              ],
            },
            {
              ask: '¿Cuál eliges?', choices, answer: choices.indexOf(t4 ? okT : okL),
              steps: [
                `Pagas lo que está encendido: ${nT} × 0.526 × 730 ≈ US$${f(cT)}/mes en T4 contra ${nL} × 0.805 × 730 ≈ US$${f(cL)}/mes en L4. Gana la ${t4 ? 'T4' : 'L4'}.`,
                `A capacidad llena, la L4 siempre es más barata por predicción: 0.805 ÷ (${f(L)} × 3.6) ≈ US$${g(0.805 / (L * 3.6))} por 1,000 contra 0.526 ÷ (600 × 3.6) ≈ US$${g(0.526 / 2160)} de la T4. ${why}`,
                'La A10G cuesta ≈ 2× la T4 por hora, y su ventaja (600 GB/s de ancho de banda) no le sirve a una CNN compute-bound: es una GPU para el decode de LLMs.',
              ],
            },
            {
              ask: '¿Cuánto ahorras al mes con la elegida frente a la otra (T4 o L4)?', unit: 'US$/mes', answer: diff, tol: 0.15,
              steps: [
                'Planteamiento: ahorro = costo mensual de la descartada − costo de la elegida.',
                `Con los resultados anteriores: ${t4 ? f(cL) + ' − ' + f(cT) : f(cT) + ' − ' + f(cL)} ≈ <b>US$${f(diff)}/mes</b> (≈ ${f((diff / Math.max(cT, cL)) * 100, 0)} %)`,
              ],
            },
          ],
          hint: 'GPUs de cada opción con la fórmula de M3 (pico ÷ capacidad planificada, hacia arriba, + N+1); costo mensual = GPUs × US$/h × 730. Compara lo que pagas encendido, no el precio por predicción a capacidad llena.',
          takeaway: `<b>Requisito:</b> un pico de ${f(P)} req/s con N+1. <b>Tamaño:</b> ${nT} T4 o ${nL} L4. <b>Decisión:</b> ${t4 ? 'T4' : 'L4'}, ≈ US$${say(diff)} menos al mes. <b>Trade-off:</b> ${t4 ? 'con N+1 y carga baja gana la hora más barata, no la predicción más barata; a más carga se invierte' : 'con varias GPUs llenas vuelve a mandar el throughput por dólar; con poca carga ganaría la T4'}. El supuesto de ${k}× se confirma con perf_analyzer antes de comprar. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'pr-03', topic: 'proyecto', level: 2, title: 'Video: cuántos fps analizar y cuántas L4 por sitio', ref: 'c02.estimaciones',
      gen(r) {
        const D = r.pick([1, 1.5, 2, 2.5, 4, 5]);   // ningún dwell da justo 6 frames con alguna opción
        const opts = [[2, 'Sub-stream a 2 fps'], [5, 'Sub-stream a 5 fps'], [15, 'Stream principal a 15 fps']];
        const best = opts.find((o) => o[0] * D >= 6);
        const fps = best[0];
        const fits = (c) => floorx((ceilx((c * fps) / 280) * 280) / fps);
        const C = r.pick([12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60].filter((c) => far((c * fps) / 280) && fits(c) - c >= 2));
        const load = C * fps;
        const n = ceilx(load / 280);
        const cap = floorx((n * 280) / fps);
        const room = cap - C;
        const choices = r.shuffle(opts.map((o) => o[1]));
        const fr = (x) => f(x * D);
        return {
          q: `Un integrador de seguridad detecta personas en zonas restringidas de sitios industriales, con <b>${C} cámaras por sitio</b>. La alerta se dispara si alguien permanece <b>${f(D)} s</b> en la zona (dwell), y el equipo de visión pide <b>al menos 6 frames analizados dentro del dwell</b> (el tracker necesita 2 de probation y hay que tolerar una oclusión). Cada cámara ofrece un sub-stream configurable a 2 o 5 fps y el stream principal a 15 fps. En el sitio, una L4 con el detector sostiene ≈ <b>400 frames/s</b> medidos (supuesto de c02: se confirma con trtexec y con DeepStream), y planeas al <b>70 %</b> porque la carga es plana.`,
          parts: [
            {
              ask: '¿Qué analizas?', choices, answer: choices.indexOf(best[1]),
              steps: [
                `Frames dentro del dwell = fps × ${f(D)} s: a 2 fps, ${fr(2)}; a 5 fps, ${fr(5)}; a 15 fps, ${fr(15)}. El más barato que llega a 6 es el <b>${best[1].toLowerCase()}</b>.`,
                fps === 15
                  ? 'Con un dwell tan corto, el sub-stream de 5 fps deja 5 frames: una oclusión rompe el evento. Pagas 3× de cómputo, o le propones al negocio un dwell más largo.'
                  : fps === 5
                    ? 'A 2 fps quedan muy pocos frames: un frame perdido por oclusión rompe el evento. A 15 fps pagarías 3× de GPU sin una alerta mejor: el tracker da identidad a cada objeto entre detecciones.'
                    : 'Con un dwell largo, 2 fps ya dan los frames que pide el tracker; 5 o 15 fps multiplican la GPU sin una alerta mejor. A 2 fps alguien que camina se mueve ≈ 0.7 m entre frames: confirma con clips grabados que el tracker no pierde la identidad.',
              ],
            },
            {
              ask: 'Frames por segundo que analiza cada sitio', unit: 'frames/s', answer: load, tol: 0.05,
              steps: [
                'Planteamiento: carga = cámaras × fps analizados, las 24 horas (las cámaras no duermen).',
                `${C} × ${fps} = <b>${f(load)} frames/s</b>`,
              ],
            },
            {
              ask: 'L4 por sitio, al 70 % de lo medido', unit: 'L4', answer: n, tol: 0,
              steps: [
                'Planteamiento: L4 = ⌈carga ÷ (400 × 0.7)⌉ = ⌈carga ÷ 280⌉. En el sitio no va N+1: si la caja cae, el sitio vuelve a rondas de guardia y el NVR sigue grabando (las fallas de c02).',
                `Con el resultado anterior: ⌈${f(load)} ÷ 280⌉ = ⌈${f(load / 280, 2)}⌉ = <b>${n} L4</b>`,
                `Utilización: ${f(load)} ÷ (${n} × 400) ≈ ${f((load / (n * 400)) * 100, 0)} % del máximo medido.${load / (n * 400) < 0.3 ? ' Con tan poco uso, una L4 sobra: en un sitio así, un equipo embebido (un Jetson) suele alcanzar, y es la comparación que hace c02 para los sitios chicos.' : ''}`,
              ],
            },
            {
              ask: '¿Cuántas cámaras más aguanta el sitio con esas L4, al 70 %?', unit: 'cámaras', answer: room, tol: 0,
              steps: [
                'Planteamiento: cámaras que caben = ⌊L4 × 280 ÷ fps⌋; margen = esas − las que ya hay.',
                `⌊${n} × 280 ÷ ${fps}⌋ = ⌊${f((n * 280) / fps, 2)}⌋ = ${cap} → ${cap} − ${C} = <b>${room} cámaras</b>`,
                'Un detector más pesado mueve la misma cuenta: con el de M3 (≈ 250 frames/s medidos) caben menos cámaras por caja. El modelo es una decisión de capacidad, no solo de accuracy.',
              ],
            },
          ],
          hint: 'Primero los fps: el mínimo que deja suficientes frames dentro del dwell. Después la carga (cámaras × fps), las L4 con la fórmula de M3 (sin N+1 en el sitio) y cuántas cámaras caben en las L4 que compraste.',
          takeaway: `<b>Requisito:</b> un dwell de ${f(D)} s con al menos 6 frames. <b>Decisión:</b> ${best[1].toLowerCase()}. <b>Tamaño:</b> ${f(load)} frames/s → ${n} L4 por sitio, con margen para ${room} cámaras más. <b>Trade-off:</b> cada fps de más es GPU; detectar a menos fps y trackear entre detecciones es lo que hace viable una caja por sitio. <i>"I analyze the ${fps}-fps ${fps === 15 ? 'main stream' : 'sub-stream'}: a ${f(D)}-second dwell still gets ${f(fps * D)} frames, and each site needs ${n === 1 ? 'one L4' : n + ' L4s'} at 70%."</i>`,
        };
      },
    },
    {
      id: 'pr-04', topic: 'proyecto', level: 3, title: 'LLM: API del proveedor o modelo propio', ref: 'm14.api-vs-propio',
      gen(r) {
        const node = 55 * MES_H;
        // [tokens de entrada, de salida, goodput con esa mezcla (req/s por réplica)]: c10 es 2,000 / 250 / 6; las otras
        // escalan con el largo de la salida (supuesto, rotulado en el enunciado).
        const mixes = [[1500, 200, 8], [2000, 250, 6], [2500, 300, 5], [3000, 400, 4]];
        // US$ por request: de lista, y con prompt caching (la mitad del prompt es un prefijo fijo cobrado a 0.1×, como en c10).
        const unit = (mx) => (mx[0] * 2.5 + mx[1] * 10) / 1e6;
        const unitC = (mx) => (mx[0] * 0.5 * 2.5 + mx[0] * 0.5 * 0.25 + mx[1] * 10) / 1e6;
        const combos = [];
        // Picos en req/s; el volumen es pico × 0.75 M requests al mes (c10: 60 req/s ↔ 45 M al mes).
        [8, 10, 12, 15, 16, 18, 20, 24, 25, 30, 32, 36, 40, 45, 48, 50, 54, 60, 64, 70, 72, 75, 80, 90, 96, 100, 105, 120].forEach((pk) => mixes.forEach((mx) => {
          const q = pk * 0.75;
          const ow = Math.max(2, ceilx(ceilx(pk / (0.7 * mx[2])) / 4)) * node + 60000;
          // Decisiones robustas: si gana lo propio, gana por ≥ 10 % incluso contra el precio con prompt caching (y por eso
          // también con los ≈ US$10k de infra que c10 suma aparte); si gana la API, por ≥ 15 %.
          if (far(pk / (0.7 * mx[2]), 0.05) && (q * 1e6 * unitC(mx) >= 1.1 * ow || ow >= 1.15 * q * 1e6 * unit(mx))) combos.push([pk, mx]);
        }));
        const cb = r.pick(combos);
        const peak = cb[0];                                    // req/s de pico (c10: 60)
        const Q = peak * 0.75;                                 // M requests al mes (c10: 45)
        const tin = cb[1][0];
        const tout = cb[1][1];
        const G = cb[1][2];
        const Gp = 0.7 * G;
        const perReq = unit(cb[1]);                            // US$ por request
        const api = Q * 1e6 * perReq;
        const apiC = Q * 1e6 * unitC(cb[1]);
        const rep = ceilx(peak / Gp);
        const nodes = Math.max(2, ceilx(rep / 4));
        const own = nodes * node + 60000;
        const ownWins = own < api;
        const be = (2 * node + 60000) / perReq / 1e6;          // M requests/mes con la flota mínima
        const okA = 'Seguir con la API y revisar la cuenta cada trimestre';
        const okO = 'Servir el modelo propio en las H100, con la API como fallback gobernado';
        const bad = 'Modelo propio en un solo nodo, para bajar el costo fijo';
        const choices = r.shuffle([okA, okO, bad]);
        return {
          q: `Un marketplace usa la API de un proveedor de LLMs para el chat de soporte: <b>${f(Q, 2)} M requests al mes</b>, cada uno con ≈ <b>${f(tin)} tokens de entrada</b> y ≈ <b>${tout} de salida</b>, con un pico de <b>${f(peak)} req/s</b>. Lista del proveedor (ilustrativa, la de c10): <b>US$2.50 por millón de tokens de entrada y US$10 por millón de salida</b>. La alternativa:<ul><li>Llama 3.3 70B en FP8 con vLLM, en réplicas de 2 × H100. Con esa mezcla de largos, el barrido de carga da ≈ ${G} req/s de goodput por réplica (${G === 6 ? 'supuesto de c10' : 'supuesto; c10 parte de ≈ 6 con 2,000 / 250'}); planeas al 70 % (${f(Gp, 1)} req/s).</li><li>Las H100 vienen en p5.48xlarge de 8 GPUs (4 réplicas por nodo), ≈ US$55/h por nodo (aprox.); el 99.9 % pide al menos 2 nodos, en 2 zonas.</li><li>Operarlo pide ≈ 3 personas (supuesto: ≈ US$20k/mes cada una, con cargas).</li></ul>`,
          parts: [
            {
              ask: 'Factura mensual del proveedor', unit: 'US$/mes', answer: api, tol: 0.15,
              steps: [
                'Planteamiento: tokens de entrada × su precio + tokens de salida × el suyo (por millón).',
                `Entrada: ${f(Q, 2)} M × ${f(tin)} = ${f((Q * tin) / 1000, 2)} B tokens × US$2.50/M = US$${f(Q * tin * 2.5)}`,
                `Salida: ${f(Q, 2)} M × ${tout} = ${f((Q * tout) / 1000, 2)} B tokens × US$10/M = US$${f(Q * tout * 10)}`,
                `Total: <b>US$${f(api)}/mes</b> (≈ US$${g(perReq)} por request: el output es ${f(((tout * 10) / (tin * 2.5 + tout * 10)) * 100, 0)} % de la factura con ${f((tout / (tin + tout)) * 100, 0)} % de los tokens)`,
              ],
            },
            {
              ask: 'Réplicas de 2 × H100 para el pico', unit: 'réplicas', answer: rep, tol: 0,
              steps: [
                'Planteamiento: réplicas = ⌈pico ÷ goodput planificado⌉. Se dimensiona con goodput (lo que cumple TTFT y TPOT), no con los tokens/s máximos.',
                `⌈${f(peak)} ÷ ${f(Gp, 1)}⌉ = ⌈${f(peak / Gp, 2)}⌉ = <b>${rep} réplicas</b>`,
              ],
            },
            {
              ask: 'Nodos p5.48xlarge (4 réplicas por nodo, mínimo 2)', unit: 'nodos', answer: nodes, tol: 0,
              steps: [
                'Planteamiento: nodos = máx(2, ⌈réplicas ÷ 4⌉).',
                `Con el resultado anterior: ⌈${rep} ÷ 4⌉ = ${ceilx(rep / 4)} → <b>${nodes} nodos</b>${ceilx(rep / 4) < 2 ? ': manda el mínimo de 2 por disponibilidad, no el throughput' : ''}`,
              ],
            },
            {
              ask: 'Costo mensual propio (nodos + equipo)', unit: 'US$/mes', answer: own, tol: 0.15,
              steps: [
                'Planteamiento: nodos × US$/h × 730 + equipo. Las GPUs se pagan las 730 h, aunque de noche estén ociosas.',
                `Con el resultado anterior: ${nodes} × 55 × 730 + 60,000 = ${f(nodes * node)} + 60,000 ≈ <b>US$${f(own)}/mes</b>`,
                'Es un piso: c10 suma ≈ US$10k/mes de gateway, observabilidad y evaluación. Aquí no cambia la decisión.',
              ],
            },
            {
              ask: '¿Qué recomiendas?', choices, answer: choices.indexOf(ownWins ? okO : okA),
              steps: [
                `Propio ≈ US$${f(own)} contra API ≈ US$${f(api)} al mes: ${ownWins ? 'lo propio sale ≈ ' + f(api / own, 1) + '× más barato' : 'la API sale ≈ ' + f(own / api, 1) + '× más barata'}.`,
                `Punto de equilibrio con la flota mínima (2 nodos + equipo ≈ US$${f(2 * node + 60000)}): ÷ US$${g(perReq)} por request ≈ ${f(be, 1)} M requests al mes. ${Q > be ? 'Estás por encima.' : 'Estás por debajo: la flota mínima y el equipo son costos fijos que la API no tiene.'}`,
                'Un solo nodo baja el fijo, pero sin N+1 un nodo caído es todo el servicio caído: no cumple el 99.9 %.',
                ownWins
                  ? `Compáralo también contra la API con prompt caching (supuesto de c10: la mitad del prompt es un prefijo fijo que se cobra a 0.1×): ≈ US$${say(apiC)} al mes, ≈ ${f((1 - apiC / api) * 100, 0)} % menos. Lo propio sigue ganando, ≈ ${f(apiC / own, 1)}×. Y el ahorro crece si la flota llena el valle de la noche con trabajo batch (la extracción nocturna de c10), porque las GPUs se pagan las 24 h igual.`
                  : `Antes de pensar en migrar, baja los tokens: con prompt caching (supuesto de c10: la mitad del prompt a 0.1×), la factura queda en ≈ US$${say(apiC)}; después, historial más corto y max_tokens.`,
              ],
            },
          ],
          hint: 'Dos costos con estructuras distintas: la API es lineal en tokens (entrada y salida a precios distintos); lo propio es escalonado (réplicas por goodput → nodos, con un mínimo por disponibilidad) más un equipo fijo. Compáralos y busca el volumen donde se cruzan.',
          takeaway: `<b>Requisito:</b> ${f(Q, 2)} M requests al mes, pico de ${f(peak)} req/s. <b>Tamaño propio:</b> ${rep} réplicas → ${nodes} nodos, ≈ US$${say(own)}/mes con el equipo, contra ≈ US$${say(api)} de la API. <b>Decisión:</b> ${ownWins ? 'modelo propio, con la API como fallback gobernado para los tenants que pueden mandar datos afuera' : 'seguir con la API: a este volumen, el costo fijo de lo propio no se paga'}. <b>Cuándo cambia:</b> el equilibrio con la flota mínima está en ≈ ${f(be, 0)} M requests al mes; se revisa cada trimestre con el metering. <i>"${ownWins
            ? `At about ${f(Q, 2)} million requests a month the API bill is about $${say(api)}, and our own fleet with a small team is about $${say(own)}, so self-hosting wins, with the vendor as a governed fallback.`
            : `Below about ${say(be)} million requests a month, the minimum two-node fleet and the team cost more than the API, so I stay on the API and revisit every quarter.`}"</i>`,
        };
      },
    },
    {
      id: 'pr-05', topic: 'proyecto', level: 3, title: 'Subtítulos en vivo: API o modelo propio', ref: 'c13.estimaciones',
      gen(r) {
        // [miles de reuniones al día, minutos por reunión, [streams medidos por L4, planificados al 70 %], US$/min]
        const ownCost = (m, dur, cap) => Math.max(2, 0.6 * ceilx((((m * 1000 * dur) / 1440) * 3 * 1.2) / cap[1])) * 0.805 * MES_H + 60000;
        const combos = [];
        [2, 3, 6, 10, 50, 200, 600].forEach((m) => [30, 40, 60].forEach((dur) => [[400, 280], [500, 350]].forEach((cap) => [0.01, 0.004].forEach((pr) => {
          const x = (((m * 1000 * dur) / 1440) * 3 * 1.2) / cap[1];
          const ap = m * 1000 * dur * 1.2 * 30 * pr;
          const ow = ownCost(m, dur, cap);
          if (far(x, 0.05) && far((x / 1.2) * 4, 0.05) && Math.abs(ow - ap) / Math.min(ow, ap) >= 0.12) combos.push([m, dur, cap, pr]);
        }))));
        const cb = r.pick(combos);
        const meet = cb[0] * 1000;
        const dur = cb[1];
        const capM = cb[2][0];
        const capP = cb[2][1];
        const price = cb[3];
        const avg = (meet * dur) / 1440;
        const peakMeet = avg * 3;
        const streams = peakMeet * 1.2;
        const nPeak = ceilx(streams / capP);
        const billedL4 = Math.max(2, 0.6 * nPeak);
        const gpu = billedL4 * 0.805 * MES_H;
        const own = gpu + 60000;
        const minutes = meet * dur * 1.2 * 30;
        const api = minutes * price;
        const ownWins = own < api;
        const beMin = own / price;   // minutos de voz al mes en los que la API cuesta lo que lo propio
        const okA = 'Arrancar con la API y migrar cuando la factura lo justifique';
        const okO = 'Modelo propio en L4, con VAD';
        const bad = 'Modelo propio, mandando todas las pistas a la GPU sin VAD para no perder voz';
        const choices = r.shuffle([okA, okO, bad]);
        return {
          q: `Una plataforma de videollamadas quiere subtítulos en vivo: <b>${f(meet)} reuniones con subtítulos al día</b>, de ≈ <b>${dur} min</b> y ≈ 4 participantes cada una, con un pico ≈ <b>3×</b> el promedio. Con detección de voz (VAD), solo ≈ <b>1.2 personas por reunión</b> hablan a la vez: cada una es un stream activo para la GPU. Opciones:<ul><li>API de transcripción en streaming: ≈ <b>US$${price} por minuto de voz</b> (${price === 0.01 ? 'precio de lista, aprox.' : 'precio de volumen negociado, supuesto'}).</li><li>Modelo propio en L4 (g6.xlarge, ≈ US$0.805/h, aprox.): ≈ ${capM} streams por L4 medidos (${capM === 500 ? 'supuesto de c13' : 'supuesto; c13 parte de ≈ 500'}), planeados al 70 % (${capP}). La flota facturada promedia ≈ 60 % de las L4 del pico (supuesto: en c13, ≈ 100 de 172, por el escalado anticipado, el drenado y el piso nocturno), nunca menos de 2, y el equipo que lo opera cuesta ≈ <b>US$60k/mes</b> (supuesto).</li></ul>`,
          parts: [
            {
              ask: 'Reuniones simultáneas en el pico', unit: 'reuniones', answer: peakMeet, tol: 0.15,
              steps: [
                `Planteamiento (Little): concurrencia promedio = llegadas × duración = reuniones al día × ${dur} min ÷ 1,440 min; pico = 3 × promedio.`,
                `${f(meet)} × ${dur} ÷ 1,440 ≈ ${f(avg)} → × 3 ≈ <b>${f(peakMeet)} reuniones</b>`,
              ],
            },
            {
              ask: 'L4 en el pico', unit: 'L4', answer: nPeak, tol: 0,
              steps: [
                `Planteamiento: streams activos = reuniones × 1.2; L4 = ⌈streams ÷ ${capP}⌉.`,
                `Con el resultado anterior: ${f(peakMeet)} × 1.2 ≈ ${f(streams)} streams → ⌈${f(streams)} ÷ ${capP}⌉ = ⌈${f(streams / capP, 2)}⌉ = <b>${nPeak} L4</b>`,
                `Sin VAD irían a la GPU las ≈ 4 pistas de cada reunión: ⌈${f(peakMeet * 4)} ÷ ${capP}⌉ = ${ceilx((peakMeet * 4) / capP)} L4.`,
              ],
            },
            {
              ask: 'Costo mensual de la API (30 días)', unit: 'US$/mes', answer: api, tol: 0.15,
              steps: [
                `Planteamiento: minutos de voz al mes = reuniones al día × ${dur} min × 1.2 personas hablando × 30 días; costo = minutos × US$${price}.`,
                `${f(meet)} × ${dur} × 1.2 × 30 = ${f(minutes)} min × ${price} ≈ <b>US$${f(api)}/mes</b>`,
              ],
            },
            {
              ask: 'Costo mensual propio (L4 facturadas + equipo)', unit: 'US$/mes', answer: own, tol: 0.15,
              steps: [
                'Planteamiento: L4 facturadas en promedio = máx(2, 0.6 × L4 del pico); costo = esas × 0.805 × 730 + equipo. Se costea con lo facturado, no con lo ocupado.',
                `Con el resultado de la segunda parte: máx(2, 0.6 × ${nPeak}) = ${f(billedL4, 1)} L4 × 0.805 × 730 ≈ US$${f(gpu)} + 60,000 ≈ <b>US$${f(own)}/mes</b>`,
              ],
            },
            {
              ask: '¿Qué recomiendas?', choices, answer: choices.indexOf(ownWins ? okO : okA),
              steps: [
                `Propio ≈ US$${f(own)} contra API ≈ US$${f(api)} al mes.`,
                ownWins
                  ? `A este volumen lo propio es ≈ ${f(api / own, 1)}× más barato: la GPU por minuto de voz cuesta fracciones de centavo y el costo fijo se reparte entre muchos minutos.`
                  : `Por debajo del equilibrio, el costo casi fijo de lo propio (equipo + piso de L4, ≈ US$${f(own)}) pesa más que la factura de la API: a US$${price}/min, la API cuesta eso recién con ≈ ${f(beMin / 1e6, 1)} M min de voz al mes, ≈ ${say(beMin / (dur * 1.2 * 30))} reuniones al día.`,
                'Sin VAD mandas a la GPU las 4 pistas y no las ≈ 1.2 que hablan: ≈ 3.3× las L4. Es la decisión de costo más grande del caso, y el VAD lleva su propia alerta.',
              ],
            },
          ],
          hint: 'Little para la concurrencia (llegadas × duración, en el pico); streams activos con VAD y L4 con la capacidad planificada; la API cobra minutos de voz; lo propio cobra L4 facturadas (no las ocupadas) más un equipo fijo. Compara los dos costos.',
          takeaway: `<b>Requisito:</b> ${f(meet)} reuniones al día, ≈ ${f(peakMeet)} simultáneas en el pico. <b>Tamaño propio:</b> ${nPeak} L4 en el pico con VAD, ≈ US$${say(own)}/mes con el equipo, contra ≈ US$${say(api)} de la API. <b>Decisión:</b> ${ownWins ? 'modelo propio con VAD' : 'empezar con la API'}. <b>Trade-off:</b> lo propio es casi todo costo fijo (equipo y piso) y la API es lineal en minutos; el VAD es lo que mantiene chica la flota. <i>"${ownWins
            ? `At this volume our own L4 fleet with VAD costs about $${say(own)} a month against $${say(api)} for the API, so we self-host.`
            : 'At this volume the fixed cost of a team and a GPU floor is bigger than the API bill, so I start with the API and migrate when the bill justifies it.'}"</i>`,
        };
      },
    },
    {
      id: 'pr-06', topic: 'proyecto', level: 3, title: 'Edge o nube para muchas cámaras', ref: 'm02.edge',
      gen(r) {
        const L4M = 0.805 * MES_H;   // una g6.xlarge al mes, ≈ US$588
        const vpn = 0.05 * MES_H;    // una VPN site-to-site por sitio, ≈ US$0.05/h (c02)
        // [detector, frames/s medidos por L4, planificados al 70 %]
        const dets = [['ligero', 400, 280], ['pesado', 250, 175]];
        // Nube por sitio = la fracción de L4 de cada cámara + la L4 de N+1 de la flota, repartida entre los sitios + la VPN.
        const cloudOf = (det, c, s) => ((c * 5) / det[2]) * L4M + L4M / s + vpn;
        // Solo combinaciones con márgenes claros (enlace ≥ 15 %, costo ≥ 12 %) y cocientes lejos de un entero, separadas
        // por resultado: se elige primero edge o nube, así cada uno sale la mitad de las veces.
        const byOut = { edge: [], nube: [] };
        dets.forEach((det) => [8, 10, 12, 16, 20, 24, 30, 40, 48].forEach((c) => [20, 50, 100, 200].forEach((l) => [10, 25, 40].forEach((s) => {
          const up = c * 1.5;
          const x = (c * 5) / det[2];
          if (Math.abs(up - l / 2) / (l / 2) < 0.15 || !far(x)) return;
          const cloud = cloudOf(det, c, s);
          const edge = ceilx(x) * 310;
          const ok = up <= l / 2;
          if (ok && Math.abs(cloud - edge) / Math.min(cloud, edge) < 0.12) return;
          byOut[!ok || edge < cloud ? 'edge' : 'nube'].push([det, c, l, s]);
        }))));
        const cb = r.pick(byOut[r.pick(['edge', 'nube'])]);
        const det = cb[0];
        const plan = det[2];
        const C = cb[1];
        const Lk = cb[2];
        const S = cb[3];
        const perCam = (5 / plan) * L4M;
        const spare = L4M / S;
        const up = C * 1.5;
        const linkOk = up <= Lk / 2;
        const x = (C * 5) / plan;
        const boxes = ceilx(x);
        const cloud = cloudOf(det, C, S);
        const edge = boxes * 310;
        const useEdge = !linkOk || edge < cloud;
        const site = useEdge ? edge : cloud;
        const okE = 'En el edge: detectar en el sitio y subir solo los eventos';
        const okC = 'En la nube: subir los sub-streams y detectar en L4 de la nube';
        const bad = 'En la nube, subiendo el stream principal de 15 fps para no perder detalle';
        const choices = r.shuffle([okE, okC, bad]);
        const say1 = !linkOk
          ? `Streaming the sub-streams needs ${f(up)} megabits of sustained uplink and video can only use ${f(Lk / 2)}, so detection runs at the edge and only events go up.`
          : useEdge
            ? `The link could carry the sub-streams, but at ${C} cameras a site ${boxes === 1 ? 'one edge box is' : boxes + ' edge boxes are'} cheaper than cloud GPUs, and the site keeps working offline.`
            : `The link carries the sub-streams and the site is small, so a shared cloud fleet at about $${say(cloud)} a site, N+1 included, beats a $310 edge box.`;
        return {
          q: `Una cadena de almacenes quiere detectar personas en zonas restringidas en <b>${S} sitios</b> con <b>${C} cámaras</b> cada uno, analizando el sub-stream de 5 fps de cada cámara (≈ 1.5 Mb/s). Cada sitio tiene un enlace de subida de <b>${Lk} Mb/s</b>, y el video puede usar como máximo la mitad (el resto es de la operación). El detector es el ${det[0]}: ≈ ${det[1]} frames/s medidos por L4, planeados al 70 % (${plan}). Opciones:<ul><li><b>Edge:</b> una caja con L4 en el sitio (el único equipo de edge que el equipo de IT acepta operar), ≈ US$310/mes por caja (US$10k amortizados en 36 meses más energía; supuesto de c02), que detecta y sube solo los eventos.</li><li><b>Nube:</b> mandar los sub-streams por una VPN site-to-site (≈ US$0.05/h por sitio, aprox.) a una flota de L4 compartida por los ${S} sitios (g6.xlarge ≈ US$588/mes, aprox.): cada cámara ocupa su fracción de una L4, y la flota lleva una L4 más de N+1, que se reparte entre los sitios.</li></ul>`,
          parts: [
            {
              ask: 'Subida que pide un sitio para mandar sus sub-streams', unit: 'Mb/s', answer: up, tol: 0.05,
              steps: [
                'Planteamiento: subida = cámaras × bitrate del sub-stream, sostenida las 24 horas.',
                `${C} × 1.5 = <b>${f(up)} Mb/s</b>`,
                `El video puede usar ${f(Lk / 2)} Mb/s: ${linkOk ? 'cabe (' + f((up / (Lk / 2)) * 100, 0) + ' % de lo permitido)' : 'no cabe, son ' + f(up / (Lk / 2), 1) + '× lo permitido'}.`,
              ],
            },
            {
              ask: 'Costo de la nube por sitio, al mes (GPU de sus cámaras + su parte del N+1 + VPN)', unit: 'US$/mes', answer: cloud, tol: 0.15,
              steps: [
                `Planteamiento: cada cámara ocupa 5 de los ${plan} frames/s planificados de una L4 (5 ÷ ${plan} × US$588); la L4 de N+1 se reparte entre los ${S} sitios (588 ÷ ${S}); y la VPN cuesta 0.05 × 730 ≈ US$36.5.`,
                `5 ÷ ${plan} × 587.65 ≈ US$${f(perCam)} por cámara → × ${C} ≈ US$${f(C * perCam)} + ${f(spare)} de N+1 + 36.5 ≈ <b>US$${f(cloud)}/mes</b>`,
                'No incluye operar la ingesta (RTSP por VPN hasta tus instancias). Con Kinesis Video Streams pagarías ≈ US$8 más por cámara (c02).',
              ],
            },
            {
              ask: 'Costo del edge por sitio, al mes', unit: 'US$/mes', answer: edge, tol: 0.15,
              steps: [
                `Planteamiento: cajas = ⌈cámaras × 5 fps ÷ ${plan}⌉; costo = cajas × US$310.`,
                `⌈${C} × 5 ÷ ${plan}⌉ = ⌈${f(x, 2)}⌉ = ${boxes} ${boxes === 1 ? 'caja' : 'cajas'} → <b>US$${f(edge)}/mes</b>`,
              ],
            },
            {
              ask: '¿Dónde detectas?', choices, answer: choices.indexOf(useEdge ? okE : okC),
              steps: [
                !linkOk
                  ? `El enlace decide antes que el costo: ${f(up)} Mb/s no caben en ${f(Lk / 2)}. Detectas en el sitio y subes eventos: en c02, ≈ 1 GB al día por sitio, ≈ 760× menos que los sub-streams. (Por costo serían nube ≈ US$${f(cloud)} contra edge ≈ US$${f(edge)} por sitio, pero sin enlace la nube no es opción.)`
                  : `El enlace alcanza, así que decide el costo: nube ≈ US$${f(cloud)} contra edge ≈ US$${f(edge)} por sitio. Gana ${useEdge ? 'el edge' : 'la nube'}.`,
                'Subir el principal a 15 fps triplica los frames a analizar y pide ≈ 4 Mb/s por cámara: empeora las dos cuentas sin mejorar la alerta.',
                useEdge
                  ? `El edge además sigue funcionando si se cae internet (store-and-forward), a cambio de operar una flota de cajas: OTA por olas y rollback local.${x < 0.5 ? ' Con ' + C + ' cámaras la caja queda al ≈ ' + f(x * 100, 0) + ' % de lo planificado: para los sitios chicos vale la pena proponerle a IT un equipo embebido (un Jetson, ≈ US$60–90/mes amortizado en c02).' : ''}`
                  : 'La nube evita operar hardware en cada sitio. Si IT aceptara un equipo embebido (un Jetson, ≈ US$60–90/mes amortizado en c02), en un sitio chico el edge volvería a ganar: la respuesta depende del hardware que puedes operar.',
              ],
            },
            {
              ask: `Costo mensual de los ${S} sitios con tu elección`, unit: 'US$/mes', answer: S * site, tol: 0.15,
              steps: [
                'Planteamiento: sitios × costo por sitio de la opción elegida.',
                `${S} × US$${f(site)} ≈ <b>US$${f(S * site)}/mes</b>`,
              ],
            },
          ],
          hint: 'Primero la red: subida por sitio (cámaras × bitrate) contra lo que el enlace permite. Si cabe, compara por sitio: nube = la fracción de L4 de cada cámara, más la parte del N+1 de la flota que le toca al sitio, más la VPN; edge = cajas × su costo fijo. El enlace manda antes que el costo.',
          takeaway: `<b>Requisito:</b> ${C} cámaras por sitio y ${f(Lk / 2)} Mb/s de subida disponibles para video. <b>Decisión:</b> ${useEdge ? 'detectar en el edge y subir eventos' : 'detectar en la nube'}${!linkOk ? ', porque el enlace no alcanza' : ', por costo'}. <b>Tamaño:</b> ≈ US$${say(site)} por sitio, ≈ US$${say(S * site)}/mes en total. <b>Trade-off:</b> el edge ahorra enlace y aguanta sin internet pero obliga a operar una flota de cajas; la nube itera más rápido si el sitio tiene enlace. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'pr-07', topic: 'proyecto', level: 3, title: 'RAG: ¿cabe el índice y cuánto cuesta embeber?', ref: 'c11.estimaciones',
      gen(r) {
        const cap = 36;   // GB por copia: 3 nodos × 24 GB ÷ 2 copias
        // Bytes por copia: vectores × (dimensiones × bytes por valor + 256 B de grafo), en FP32, FP16 e int8.
        const sizes = (n, d) => [(n * (4 * d + 256)) / 1e9, (n * (2 * d + 256)) / 1e9, (n * (d + 256)) / 1e9];
        // [M de documentos, chunks por documento, dimensiones], sin tamaños a menos de 10 % de lo que cabe y separadas por
        // la precisión que entra: se elige primero FP32, FP16 o int8, así cada una sale un tercio de las veces.
        const byK = [[], [], []];
        [0.5, 0.75, 1, 1.5, 2, 2.5, 3].forEach((dm) => [6, 8, 10, 12].forEach((cpd) => [384, 512, 768, 1024, 1536].forEach((d) => {
          const s = sizes(dm * cpd * 1e6, d);
          if (s.some((x) => Math.abs(x - cap) / cap < 0.1) || s[2] > cap) return;
          byK[s.findIndex((x) => x <= cap)].push([dm, cpd, d]);
        })));
        const cb = r.pick(byK[r.pick([0, 1, 2])]);
        const Dm = cb[0];
        const cpd = cb[1];
        const d = cb[2];
        const N = Dm * cpd * 1e6;
        const docs = Dm < 1 ? f(Dm * 1000) + 'k' : f(Dm) + ' M';
        const v32 = (N * d * 4) / 1e9;
        const s = sizes(N, d);
        const names = ['FP32, tal cual', 'FP16 (cuantización escalar): la mitad de bytes por vector', 'int8: un cuarto de los bytes por vector'];
        const k = s.findIndex((x) => x <= cap);
        const perNode = (s[k] * 2) / 3;
        const lh = (N * 400) / 30000 / 3600;
        const prec = ['FP32', 'FP16', 'int8'][k];
        const bad = 'Una sola copia en FP32, sin réplica, para no cuantizar';
        const nodes32 = ceilx((2 * s[0]) / 24);
        const choices = r.shuffle(names.concat([bad]));
        return {
          q: `Un asistente interno (RAG) responde con los documentos de la empresa: <b>${docs} documentos</b>, cada uno con ≈ <b>${cpd} chunks</b> de ≈ 400 tokens. Los embeddings tienen <b>${f(d)} dimensiones</b>. El índice (HNSW con M = 32: ≈ 256 B de grafo por vector) va en <b>3 nodos de 64 GiB</b> con <b>2 copias</b> (el requisito de disponibilidad), y el presupuesto alcanza para esos 3 nodos. Cada nodo puede dedicar ≈ <b>24 GB</b> a vectores y grafo (supuesto: el resto es heap, texto y BM25 en page cache). Para embeber, una L4 procesa ≈ 30k tokens/s (supuesto de c11; g6.xlarge ≈ US$0.805/h, aprox.).`,
          parts: [
            {
              ask: 'Tamaño de los vectores en FP32 (sin el grafo)', unit: 'GB', answer: v32, tol: 0.15,
              steps: [
                `Planteamiento: vectores = documentos × ${cpd} chunks; tamaño = vectores × dimensiones × 4 B.`,
                `${docs} × ${cpd} = ${f(N / 1e6)} M vectores × ${f(d)} × 4 B ≈ <b>${f(v32)} GB</b>`,
              ],
            },
            {
              ask: 'Memoria de una copia del índice en FP32, con el grafo', unit: 'GB', answer: s[0], tol: 0.15,
              steps: [
                'Planteamiento: copia = vectores + grafo (vectores × 256 B).',
                `Con el resultado anterior: ${f(v32)} + ${f(N / 1e6)} M × 256 B (${f((N * 256) / 1e9)} GB) ≈ <b>${f(s[0])} GB</b>`,
              ],
            },
            {
              ask: '¿Cómo guardas los vectores en esos 3 nodos?', choices, answer: choices.indexOf(names[k]),
              steps: [
                `Lo que cabe por copia: 3 nodos × 24 GB ÷ 2 copias = 36 GB. Por copia: FP32 ≈ ${f(s[0])} GB · FP16 ≈ ${f(s[1])} GB · int8 ≈ ${f(s[2])} GB. La menos agresiva que entra es <b>${prec}</b>.`,
                k === 0
                  ? 'Si FP32 cabe, no hay nada que ganar cuantizando: guardas la precisión completa y la palanca queda para cuando el corpus crezca.'
                  : `Antes de cambiar, se valida el recall@k en el golden set: la cuantización ${k === 1 ? 'escalar a FP16 casi no lo mueve' : 'a int8 puede moverlo más; se mide'}. Quedarte en FP32 pediría ⌈2 × ${f(s[0])} ÷ 24⌉ = ${nodes32} nodos, fuera del presupuesto: la cuantización ahorra máquinas; no define la arquitectura.`,
                'Una sola copia no es opción: si cae un nodo, una parte del índice queda inaccesible y las respuestas salen con huecos. Las 2 copias son el requisito de disponibilidad, no un lujo.',
              ],
            },
            {
              ask: 'Memoria por nodo con la precisión elegida (2 copias en 3 nodos)', unit: 'GB', answer: perNode, tol: 0.15,
              steps: [
                'Planteamiento: por nodo = copia × 2 copias ÷ 3 nodos.',
                `${f(s[k])} × 2 ÷ 3 ≈ <b>${f(perNode)} GB</b> de los 24 disponibles (${f((perNode / 24) * 100, 0)} %)`,
              ],
            },
            {
              ask: 'L4-horas para embeber todo el corpus', unit: 'L4-h', answer: lh, tol: 0.15,
              steps: [
                'Planteamiento: tokens = vectores × 400; L4-horas = tokens ÷ 30,000 tokens/s ÷ 3,600.',
                `${f(N / 1e6)} M × 400 = ${f((N * 400) / 1e9, 2)} B tokens ÷ 30,000 ÷ 3,600 ≈ <b>${f(lh)} L4-h</b>`,
                `≈ US$${f(lh * 0.805)} on-demand, ≈ ${f(lh / 8, 1)} h de reloj con 8 L4 en paralelo: re-embeber todo es barato. Lo caro de re-indexar es volver a parsear (y a hacer OCR) si no guardaste el texto.`,
              ],
            },
          ],
          hint: 'Bytes del índice por copia: vectores × (dimensiones × bytes por valor + 256 B de grafo). Compara con lo que cabe para 2 copias en 3 nodos y elige la precisión menos agresiva que entra. Para embeber: tokens del corpus ÷ throughput de la L4.',
          takeaway: `<b>Requisito:</b> ${f(N / 1e6)} M chunks de ${f(d)} dimensiones, 2 copias en 3 nodos. <b>Decisión:</b> ${prec}, ≈ ${f(perNode)} GB por nodo. <b>Trade-off:</b> la cuantización ahorra un tamaño de máquina y se valida con recall@k; no define la arquitectura. Embeber todo cuesta ≈ US$${say(lh * 0.805)} (≈ ${f(lh / 8, 1)} h con 8 L4): un índice nuevo en paralelo (blue/green con alias) no es un proyecto. <i>"${f(N / 1e6)} million chunks at ${f(d)} dimensions take about ${say(s[0])} GB per copy in FP32 with the graph, so ${k === 0 ? 'two copies fit in three nodes and I keep FP32' : 'two copies don\'t fit in three nodes and I store ' + prec + ' after checking recall on the golden set'}."</i>`,
        };
      },
    },
    {
      id: 'pr-08', topic: 'proyecto', level: 3, title: 'Recomendaciones: precomputar de noche o calcular en cada visita', ref: 'm02.batch',
      gen(r) {
        const fresh = r.pick(['ayer', 'ayer', 'ayer', 'sesion']);
        // [M de personas activas en el último mes, M activas al día]: DAU/MAU entre 10 % y 50 %, costos a ≥ 15 % de
        // distancia y el pico lejos de un múltiplo de 600. Con frescura de un día se elige primero quién gana, así batch y
        // online salen la mitad de las veces cada uno.
        const byOut = { batch: [], online: [] };
        [10, 20, 30, 50, 80, 100, 120, 150, 200, 250, 300].forEach((m) => [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60].forEach((d) => {
          if (d / m < 0.1 || d / m > 0.5) return;
          const b = ((m * 1e6) / 5000 / 3600) * 0.526 * 30 + m * 30 * 0.625;
          const pk = ((d * 1e6 * 3) / 86400) * 3;
          const o = (ceilx(pk / 600) + 1) * 0.526 * MES_H + 300;
          if (!far(pk / 600, 0.05) || Math.abs(b - o) / Math.min(b, o) < 0.15) return;
          byOut[o < b ? 'online' : 'batch'].push([m, d]);
        }));
        const pr = fresh === 'ayer' ? r.pick(byOut[r.pick(['batch', 'online'])]) : r.pick(byOut.batch.concat(byOut.online));
        const R = pr[0];
        const Dm = pr[1];
        const gpuH = (R * 1e6) / 5000 / 3600;
        const gpuB = gpuH * 0.526 * 30;
        const wB = R * 30 * 0.625;
        const batch = gpuB + wB;
        const unread = (1 - Dm / R) * 100;
        const peak = ((Dm * 1e6 * 3) / 86400) * 3;
        const nT = ceilx(peak / 600) + 1;
        const online = nT * 0.526 * MES_H + 300;
        const useOnline = fresh === 'sesion' || online < batch;
        const okB = 'Precomputar de noche para las activas del mes y servir un lookup';
        const okO = 'Calcular en cada visita (retrieval + ranker online)';
        const bad = 'Precomputar cada hora para las activas del mes, para tener datos más frescos';
        const choices = r.shuffle([okB, okO, bad]);
        const say1 = fresh === 'sesion'
          ? 'Product wants the home to react to this session, so ranking runs online on precomputed candidates.'
          : useOnline
            ? 'Only a small share of last month\'s users come back each day, so most nightly writes are wasted; ranking on each visit is cheaper.'
            : 'Yesterday\'s data is fresh enough, and precomputing for last month\'s active users costs less than an always-on online fleet, so I run a nightly batch and serve a lookup.';
        return {
          q: `La home de una app muestra recomendaciones personalizadas. Hay <b>${R} M personas activas en el último mes</b> y <b>${Dm} M activas al día</b>, con ≈ 3 visitas a la home por persona activa (pico 3× el promedio). ${fresh === 'ayer'
            ? 'Producto acepta recomendaciones calculadas con los datos de ayer.'
            : 'Producto quiere que la home reaccione a lo que la persona hizo en esta misma sesión.'} Opciones:<ul><li><b>Batch nocturno:</b> puntuar cada noche a las personas activas del último mes (≈ 5,000 personas/s por T4 con batches grandes, supuesto de M2; g4dn.xlarge ≈ US$0.526/h, aprox.) y escribir una fila por persona en DynamoDB on-demand (≈ US$0.625 por millón de escrituras, aprox.); la home hace un lookup, y quien no tiene fila ve los populares de su región.</li><li><b>Online:</b> retrieval y ranker en cada visita, ≈ 600 req/s planificados por T4 (supuesto), con N+1, más ≈ US$300/mes de índice y features online (supuesto).</li></ul>`,
          parts: [
            {
              ask: 'Costo mensual del batch (GPU + escrituras, 30 noches)', unit: 'US$/mes', answer: batch, tol: 0.15,
              steps: [
                'Planteamiento: GPU-horas por noche = personas ÷ 5,000 ÷ 3,600; escrituras al mes = personas × 30 noches.',
                `GPU: ${R} M ÷ 5,000 ÷ 3,600 ≈ ${f(gpuH)} h × 0.526 × 30 ≈ US$${f(gpuB)}`,
                `Escrituras: ${R} M × 30 = ${f(R * 30)} M × US$0.625 ≈ US$${f(wB)}`,
                `Total ≈ <b>US$${f(batch)}/mes</b>: las escrituras son el ${f((wB / batch) * 100, 0)} %, no la GPU.`,
              ],
            },
            {
              ask: '¿Qué porcentaje de las filas que escribe el batch nadie las lee al día siguiente?', unit: '%', answer: unread, tolAbs: 2,
              steps: [
                'Planteamiento: solo las activas del día abren la home: fracción sin leer = 1 − activas del día ÷ activas del mes.',
                `1 − ${Dm} ÷ ${R} = <b>${f(unread, 0)} %</b>`,
              ],
            },
            {
              ask: 'Pico de requests si calculas en cada visita', unit: 'req/s', answer: peak, tol: 0.15,
              steps: [
                'Planteamiento: visitas al día ÷ 86,400 × 3 de pico.',
                `${Dm} M × 3 ÷ 86,400 × 3 ≈ <b>${f(peak)} req/s</b>`,
              ],
            },
            {
              ask: 'Costo mensual online (T4 con N+1, más índice y features)', unit: 'US$/mes', answer: online, tol: 0.15,
              steps: [
                'Planteamiento: T4 = ⌈pico ÷ 600⌉ + 1; costo = T4 × 0.526 × 730 + 300.',
                `Con el resultado anterior: ⌈${f(peak)} ÷ 600⌉ + 1 = ${nT} T4 → ${nT} × 0.526 × 730 + 300 ≈ <b>US$${f(online)}/mes</b>`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(useOnline ? okO : okB),
              steps: [
                fresh === 'sesion'
                  ? 'Producto pide reaccionar a la sesión: un lookup de anoche no sabe lo que la persona hizo hace 5 minutos. El costo pasa a segundo plano: va online (en la práctica, candidatos precomputados + re-rank con la sesión, el híbrido de c08).'
                  : `Con frescura de 24 h decide el costo: batch ≈ US$${f(batch)} contra online ≈ US$${f(online)} al mes. Gana ${useOnline ? 'online' : 'el batch'}.`,
                `Precomputar cada hora multiplica por 24 las escrituras (≈ US$${f(wB * 24)} al mes) para filas que en su mayoría nadie va a leer.`,
                !useOnline
                  ? `Palancas del batch: escribir solo las filas que cambiaron, o importar la tabla completa desde S3 a una tabla nueva (que además da el swap atómico); las escrituras son el ${f((wB / batch) * 100, 0)} % del costo. Y una alerta de frescura (edad de la versión activa) por si el job falla.`
                  : `Online paga GPUs encendidas las 24 h con N+1; a cambio, cada visita usa las features del momento y nadie escribe filas que no se leen.${fresh === 'ayer' ? ' Con solo ' + f(100 - unread, 0) + ' % de las activas del mes entrando cada día, el batch escribe sobre todo para quien no vuelve.' : ''}`,
              ],
            },
          ],
          hint: 'El batch paga por persona activa del mes (GPU y, sobre todo, escrituras al KV store); online paga por el pico de visitas (GPUs con N+1, siempre encendidas). Primero mira qué frescura pide producto; si alcanza la de ayer, compara costos.',
          takeaway: `<b>Requisito:</b> ${R} M activas al mes, ${Dm} M al día, frescura ${fresh === 'ayer' ? 'de un día' : 'de sesión'}. <b>Decisión:</b> ${useOnline ? 'calcular online en cada visita' : 'batch nocturno + lookup'}. <b>Números:</b> batch ≈ US$${say(batch)}/mes (el ${f(unread, 0)} % de las filas no se lee) contra online ≈ US$${say(online)}/mes. <b>Trade-off:</b> la pregunta no es "batch u online" sino qué parte de la señal necesita frescura; lo lento va al batch y lo de la sesión, al request. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'pr-09', topic: 'proyecto', level: 3, title: 'Moderación en cascada: dimensionar cada etapa', ref: 'c06.estimaciones',
      gen(r) {
        // [M ítems al día, % que pasa a la etapa 2]: la etapa 2 pide ≥ 2 L4, dimensionarla para el promedio se queda corto
        // en el pico y ningún cociente queda pegado a un entero.
        const pairs = [];
        [60, 75, 90, 100, 120, 135, 150, 180, 200, 240, 250, 300].forEach((v) => [2, 2.5, 3, 4, 5].forEach((pct) => {
          const pk = ((v * 1e6) / 86400) * 3;
          const p = (pk * pct) / 100;
          if (far(pk / 2100, 0.05) && far(p / 70, 0.05) && ceilx(p / 70) >= 2 && ceilx(p / 3 / 70) * 70 < p) pairs.push([v, pct]);
        }));
        const pr = r.pick(pairs);
        const V = pr[0];
        const e = pr[1];
        const H = r.pick([100, 150, 200, 300]);   // miles de revisiones al día
        const peak1 = ((V * 1e6) / 86400) * 3;
        const n1 = ceilx(peak1 / 2100) + 1;
        const avg2 = (V * 1e6 * (e / 100)) / 86400;
        const p2 = avg2 * 3;
        const n2 = ceilx(p2 / 70);
        const capAvg = ceilx(avg2 / 70) * 70;
        const flagged = V * e * 10;   // miles de ítems dudosos al día
        const frac = (H * 1000) / (V * 1e6) * 100;
        const ok = 'Para el pico sostenido del día, sin N+1: una cola absorbe minutos, no horas';
        const choices = r.shuffle([ok,
          'Para el promedio del día: la cola absorbe el pico',
          'Como la etapa 1: para el pico y con N+1, por si cae una GPU',
          'Una sola L4, y que el HPA escale por CPU si hace falta']);
        return {
          q: `Una red social modera <b>${V} M ítems de texto al día</b> (posts y comentarios), con un pico ≈ 3× el promedio. El diseño es una cascada (L4 en g6.xlarge, ≈ US$0.805/h, aprox.):<ul><li><b>Etapa 1</b>, síncrona antes de publicar: un clasificador rápido, ≈ 3,000 ítems/s medidos por L4 (supuesto de c06), planeado al 70 % (2,100), con N+1.</li><li><b>Etapa 2</b>, asíncrona: un deep scorer sobre el <b>${e} %</b> que la etapa 1 marca como dudoso, ≈ 100 ítems/s medidos por L4 (supuesto de c06; 70 planificados). SLO: resultado en ≤ 5 min.</li><li><b>Revisión humana:</b> capacidad de ≈ <b>${H}k revisiones al día</b>.</li></ul>`,
          parts: [
            {
              ask: 'L4 de la etapa 1 (throughput + N+1)', unit: 'L4', answer: n1, tol: 0,
              steps: [
                'Planteamiento: pico = ítems al día ÷ 86,400 × 3; L4 = ⌈pico ÷ 2,100⌉ + 1.',
                `${V} M ÷ 86,400 × 3 ≈ ${f(peak1)} ítems/s → ⌈${f(peak1)} ÷ 2,100⌉ = ⌈${f(peak1 / 2100, 2)}⌉ = ${n1 - 1}; + 1 = <b>${n1} L4</b>`,
              ],
            },
            {
              ask: 'Ítems por segundo que llegan a la etapa 2 en el pico', unit: 'ítems/s', answer: p2, tol: 0.15,
              steps: [
                'Planteamiento: solo la fracción dudosa pasa a la etapa 2: pico de la etapa 2 = pico × fracción.',
                `${f(peak1)} × ${e} % ≈ <b>${f(p2)} ítems/s</b> (promedio ≈ ${f(avg2)})`,
              ],
            },
            {
              ask: '¿Para qué carga dimensionas la etapa 2?', choices, answer: choices.indexOf(ok),
              steps: [
                `El pico diurno dura horas. Con L4 para el promedio (${capAvg / 70} × 70 = ${capAvg} ítems/s) entran ${f(p2)} y salen ${capAvg}: la cola crece ≈ ${f(p2 - capAvg)} ítems/s, ≈ ${f((p2 - capAvg) * 3600)} por hora, y el SLO de 5 min se rompe todo el pico.`,
                'El N+1 es para el camino síncrono, donde alguien espera la respuesta; en la etapa asíncrona, una L4 caída solo atrasa la cola unos minutos.',
                'La CPU del pod no ve la saturación de la GPU; si escalas la etapa 2, por el lag de la cola (KEDA).',
              ],
            },
            {
              ask: 'L4 de la etapa 2', unit: 'L4', answer: n2, tol: 0,
              steps: [
                'Planteamiento: L4 = ⌈pico de la etapa 2 ÷ 70⌉, sin N+1.',
                `Con el resultado de la segunda parte: ⌈${f(p2)} ÷ 70⌉ = ⌈${f(p2 / 70, 2)}⌉ = <b>${n2} L4</b>`,
              ],
            },
            {
              ask: '¿Qué fracción del volumen diario pueden revisar las personas?', unit: '%', answer: frac, tol: 0.15,
              steps: [
                'Planteamiento: fracción = revisiones al día ÷ ítems al día.',
                `${H}k ÷ ${V} M = <b>${f(frac, 3)} %</b>`,
                `La etapa 1 marca como dudosos ≈ ${flagged >= 1000 ? f(flagged / 1000, 1) + ' M' : f(flagged) + 'k'} ítems al día: las personas alcanzan a ver como mucho el ${f((H / flagged) * 100, 0)} %. Por eso el umbral de "mandar a revisión" no se elige por F1: se elige para que las llegadas queden debajo de la capacidad, empezando por la severidad más alta.`,
              ],
            },
          ],
          hint: 'Etapa 1: pico ÷ capacidad planificada, hacia arriba, + N+1. Etapa 2: solo la fracción dudosa, dimensionada para el pico sostenido (no el promedio) y sin N+1. Personas: capacidad diaria ÷ volumen diario.',
          takeaway: `<b>Requisito:</b> ${V} M ítems al día, ${e} % dudosos, SLO de 5 min en la etapa 2. <b>Tamaño:</b> ${n1} L4 en la etapa 1 (con N+1) y ${n2} en la etapa 2 (pico sostenido, sin N+1); las personas revisan ≈ ${f(frac, 2)} % del volumen. <b>Trade-off:</b> cada etapa se dimensiona según quién espera: el camino síncrono con N+1 y margen, el asíncrono para el pico sostenido, y la revisión humana fija los umbrales. <i>"The async stage is sized for the sustained peak, not the average: a queue absorbs minutes, not hours, and it doesn't need N+1."</i>`,
        };
      },
    },

    // ======================================================== ARREGLA O MEJORA
    {
      id: 'dg-01', topic: 'diagnostico', level: 2, title: 'La factura de GPU con la flota casi ociosa', ref: 'm06.keda',
      gen(r) {
        // [pico, horas de pico, valle como fracción del pico]: utilización < 45 % y cocientes lejos de un entero.
        const tri = [];
        [1500, 2500, 3500, 4500, 5500, 6500].forEach((p) => [4, 5, 6, 8].forEach((hh) => [0.1, 0.15, 0.2, 0.25].forEach((x) => {
          const v = p * x;
          const n = ceilx(p / 600) + 1;
          const u = ((p * hh + v * (24 - hh)) / 24 / (n * 600)) * 100;
          if (far(p / 600) && far(v / 600) && u < 45) tri.push([p, hh, x]);
        })));
        const t = r.pick(tri);
        const P = t[0];
        const h = t[1];
        const fv = t[2];
        const V = P * fv;
        const N = ceilx(P / 600) + 1;
        const Noff = ceilx(V / 600) + 1;
        const bill = N * 0.526 * MES_H;
        const avg = (P * h + V * (24 - h)) / 24;
        const U = (avg / (N * 600)) * 100;
        const save = (N - Noff) * 0.526 * MES_H * ((24 - h) / 24);
        const spOnly = 0.37 * bill;   // Savings Plan a 1 año sobre las N T4 (≈ 37 % en g4dn, M13)
        const both = bill - (Noff * 0.526 * MES_H * 0.63 + (N - Noff) * 0.526 * MES_H * (h / 24));
        const ok = 'La capacidad no sigue a la carga: autoscaling por tiempo en cola con mínimo N+1 en el valle, y escalado programado antes del pico';
        const choices = r.shuffle([ok,
          `Comprar un Savings Plan sobre las ${N} T4`,
          'Pasar a L4: más throughput por dólar',
          'Cuantizar a INT8 para necesitar menos GPUs']);
        return {
          q: `La factura de GPU de un servicio de visión es de ≈ <b>US$${f(bill)}/mes</b>: <b>${N} × T4</b> (g4dn.xlarge ≈ US$0.526/h, aprox.) encendidas 24/7, dimensionadas para el pico con N+1 (600 img/s planificadas por GPU). El dashboard de la semana muestra ≈ <b>${f(P)} req/s</b> durante ≈ <b>${h} h</b> al día y ≈ <b>${f(V)} req/s</b> el resto del día. Finanzas pregunta por qué la utilización es tan baja.`,
          parts: [
            {
              ask: 'Utilización promedio de la flota (carga promedio ÷ capacidad planificada)', unit: '%', answer: U, tolAbs: 2,
              steps: [
                'Planteamiento: carga promedio = (pico × horas de pico + valle × horas de valle) ÷ 24; utilización = promedio ÷ (GPUs × 600).',
                `(${f(P)} × ${h} + ${f(V)} × ${24 - h}) ÷ 24 ≈ ${f(avg)} req/s → ÷ (${N} × 600) ≈ <b>${f(U, 0)} %</b>`,
              ],
            },
            {
              ask: '¿Cuál es la causa y qué cambias primero?', choices, answer: choices.indexOf(ok),
              steps: [
                `Causa raíz: la flota está dimensionada para un pico de ${h} h y se paga las 24 h. Las GPUs están bien elegidas; lo que sobra son horas encendidas.`,
                `Un Savings Plan a 1 año baja ≈ 37 % la hora (lo observado en g4dn, M13): ≈ US$${f(spOnly)}/mes sobre las ${N} T4. Pero compromete todo el año horas que no usas: congela el desperdicio. Primero el autoscaling; el plan, después y solo sobre la base que nunca se apaga.`,
                'L4 e INT8 bajan las GPUs del pico, pero en el valle seguirías pagando N+1 sobre GPUs casi vacías; INT8 además pide validar la accuracy.',
                'Un nodo GPU tarda minutos en servir: el autoscaler sigue la curva del día y un trigger cron sube la flota ≈ 30–60 min antes del pico.',
              ],
            },
            {
              ask: 'T4 en el valle (throughput + N+1)', unit: 'T4', answer: Noff, tol: 0,
              steps: [
                'Planteamiento: la misma fórmula de M3 con la carga del valle.',
                `⌈${f(V)} ÷ 600⌉ + 1 = ⌈${f(V / 600, 2)}⌉ + 1 = <b>${Noff} T4</b>`,
              ],
            },
            {
              ask: 'Ahorro mensual de bajar a esas T4 fuera del pico', unit: 'US$/mes', answer: save, tol: 0.15,
              steps: [
                'Planteamiento: ahorro = GPUs que apagas × US$/h × horas de valle del mes (730 × horas de valle ÷ 24).',
                `Con el resultado anterior: (${N} − ${Noff}) × 0.526 × 730 × ${24 - h} ÷ 24 ≈ <b>US$${f(save)}/mes</b> (≈ ${f((save / bill) * 100, 0)} % de la factura)`,
                `El ahorro real es algo menor: el scale-in espera su ventana de estabilización y el scale-out se adelanta al pico. Con la base ya medida, el Savings Plan sobre esas ${Noff} T4 suma el resto: ≈ US$${f(both)}/mes en total, contra ≈ US$${f(spOnly)} del plan sobre las ${N} T4 sin autoscaling.`,
              ],
            },
          ],
          hint: 'Compara lo que la flota puede hacer con lo que hace en promedio. Después pregunta qué parte de la flota hace falta en el valle (con N+1) y cuántas horas al mes dura el valle.',
          takeaway: `<b>Diagnóstico:</b> utilización promedio ≈ ${f(U, 0)} %. <b>Causa raíz:</b> capacidad fija para un pico de ${h} h. <b>Arreglo:</b> autoscaling por tiempo en cola con mínimo ${Noff} T4 (N+1) en el valle y escalado programado antes del pico; después, Savings Plan solo sobre esa base. <b>Impacto:</b> ≈ US$${say(save)}/mes menos con el autoscaling, ≈ US$${say(both)} sumando el plan sobre la base. <i>"The fleet averages about ${f(U, 0)}% because it's sized for ${h === 8 ? 'an' : 'a'} ${h}-hour peak, so I scale with the daily curve down to ${Noff} GPUs off-peak, which saves about $${say(save)} a month, and only then commit the baseline."</i>`,
        };
      },
    },
    {
      id: 'dg-02', topic: 'diagnostico', level: 2, title: 'Disponibilidad bajo el SLO por una dependencia', ref: 'm15.disponibilidad',
      gen(r) {
        const I = r.pick([99.94, 99.95, 99.96, 99.97, 99.98]);
        const Ae = r.pick([99.3, 99.5, 99.6, 99.7, 99.8]);
        // [con "a" para el enunciado, como sujeto, la feature que trae]
        const dep = r.pick([
          ['a una API externa de tipo de cambio', 'una API externa de tipo de cambio', 'el precio en la moneda local'],
          ['al servicio de perfiles de otro equipo', 'el servicio de perfiles de otro equipo', 'el segmento de la persona'],
          ['a una API externa de clima', 'una API externa de clima', 'el pronóstico del día'],
        ]);
        const prod = (I / 100) * (Ae / 100);
        const down = (1 - prod) * MES_MIN;
        const downNew = (1 - I / 100) * MES_MIN;
        const ok = 'Sacar la dependencia del camino crítico: caché con TTL del último valor y un valor por defecto si no responde a tiempo, detrás de un circuit breaker';
        const choices = r.shuffle([ok,
          'Subir el timeout hacia la dependencia para que alcance a responder',
          'Reintentar 3 veces cada llamada fallida a la dependencia',
          'Agregar una tercera zona al model server']);
        return {
          q: `Un servicio de precios sugeridos tiene un SLO de <b>99.9 %</b> en 30 días y el mes pasado no lo cumplió. Cada request pasa, en serie, por el resto de la cadena (balanceador, gateway y model server en 2 zonas, con sus causas comunes), que mide ≈ <b>${I} %</b>, y además llama ${dep[0]} para obtener una feature del modelo (${dep[2]}), que el mes pasado estuvo disponible el <b>${Ae} %</b>. Si esa llamada falla o vence, hoy el request falla: no hay fallback. (Valores ilustrativos.)`,
          parts: [
            {
              ask: 'Disponibilidad de la cadena', unit: '%', answer: prod * 100, tolAbs: 0.01,
              steps: [
                'Planteamiento: en serie se multiplican: A = A<sub>resto</sub> × A<sub>dependencia</sub> (≈ 1 − la suma de las indisponibilidades).',
                `${f(I / 100, 4)} × ${f(Ae / 100, 4)} = <b>${f(prod * 100, 3)} %</b>`,
                `Atajo: ${f(100 - I, 2)} + ${f(100 - Ae, 2)} = ${f(200 - I - Ae, 2)} % de indisponibilidad.`,
              ],
            },
            {
              ask: 'Minutos de caída al mes (30 días)', unit: 'min/mes', answer: down, tol: 0.15,
              steps: [
                'Planteamiento: caída = (1 − A) × 43,200 min.',
                `Con el resultado anterior: ${f(1 - prod, 5)} × 43,200 ≈ <b>${f(down)} min/mes</b>`,
                `Contra un presupuesto de 43.2 min (99.9 %): ≈ ${f(down / 43.2, 1)}× el presupuesto.`,
              ],
            },
            {
              ask: '¿Qué cambias?', choices, answer: choices.indexOf(ok),
              steps: [
                `Causa raíz: una pieza al ${Ae} % en serie resta ≈ ${f(100 - Ae, 1)} puntos, más que todo lo demás junto: ninguna mejora en tus propias piezas lo compensa.`,
                'Con fallback, cuando la dependencia falla el request responde con el último valor conocido (o un default): degradado pero útil, y deja de contar como error si el SLI lo define así con producto.',
                'Un timeout más largo no arregla las caídas y suma latencia y requests colgados (Little); reintentar 3 veces multiplica la carga sobre una dependencia que ya está mal, y solo ayuda con fallas breves e independientes.',
                `Una tercera zona mejora una parte que ya mide ${I} %: no toca la pieza que resta.`,
              ],
            },
            {
              ask: 'Minutos de caída al mes con la dependencia fuera del camino crítico (supón que el fallback no falla y que, como acordaste con producto, una respuesta degradada cuenta como buena en el SLI)', unit: 'min/mes', answer: downNew, tol: 0.15,
              steps: [
                'Planteamiento: si el fallback no falla, queda el resto de la cadena: caída = (1 − A<sub>resto</sub>) × 43,200.',
                `(1 − ${f(I / 100, 4)}) × 43,200 ≈ <b>${f(downNew)} min/mes</b>, dentro de los 43.2 min del SLO`,
                'El fallback se prueba a propósito (un flag que lo fuerza en staging y en un % chico de producción) y su tasa es una métrica con alerta: un fail-open que nadie mide esconde la caída.',
              ],
            },
          ],
          hint: 'En serie se multiplican las disponibilidades (o se suman las indisponibilidades); pásalo a minutos con 43,200. Después pregunta qué pieza resta más y si el producto puede responder sin ella por un rato.',
          takeaway: `<b>Diagnóstico:</b> la cadena da ≈ ${f(prod * 100, 2)} % (≈ ${f(down, 0)} min/mes) contra 99.9 %. <b>Causa raíz:</b> ${dep[1]}, al ${Ae} %, en serie. <b>Arreglo:</b> sacar esa llamada del camino crítico con caché y valor por defecto, detrás de un circuit breaker. <b>Impacto:</b> ≈ ${f(downNew, 0)} min/mes, dentro del presupuesto. <i>"A dependency at ${Ae}% in series caps us below the SLO, so it leaves the critical path: a cached value or a default on timeout, behind a circuit breaker."</i>`,
        };
      },
    },
    {
      id: 'dg-03', topic: 'diagnostico', level: 2, title: 'La factura que nadie dibujó', ref: 'm13.costos-ocultos',
      gen(r) {
        const v = r.pick(['logs', 'region', 'nat']);
        let q;
        let gb;
        let price;
        let p1;
        let p1steps;
        let ok;
        let wrong;
        let csteps;
        let take;
        let say1;
        if (v === 'logs') {
          const R = r.pick([50, 100, 200, 500]);
          const K = r.pick([3, 5, 10, 20]);
          gb = (R * K * 1e3 * SEG_MES) / 1e9;
          price = 0.5;
          const gbAfter = (R * (300 + 0.01 * K * 1e3) * SEG_MES) / 1e9;
          const after = gbAfter * 0.023;
          q = `Desde el último deploy, la factura de CloudWatch Logs se disparó. Alguien dejó activo un log de debug que escribe el request completo (headers, features y el payload en base64: ≈ <b>${K} KB</b>) en cada uno de los ≈ <b>${R} req/s</b> promedio del servicio. CloudWatch Logs cobra ≈ US$0.50 por GB ingerido (aprox.).`;
          p1 = 'GB al mes que entran a CloudWatch (mes de 730 h)';
          p1steps = ['Planteamiento: bytes al mes = req/s × bytes por request × segundos del mes (730 h × 3,600 = 2,628,000 s).', `${R} × ${K} KB × 2,628,000 s ≈ <b>${f(gb)} GB/mes</b>`];
          ok = 'Loguear solo la fila de predicción (≈ 300 B) a S3 en Parquet, y el payload completo solo en una muestra del 1 %, con lifecycle';
          wrong = ['Bajar la retención de CloudWatch de 30 a 7 días', 'Apagar todos los logs del servicio hasta fin de mes'];
          csteps = [
            'Causa raíz: el cobro es al ingerir (≈ US$0.50/GB); la retención cuesta ≈ US$0.03 por GB-mes. Bajar la retención casi no mueve la factura.',
            `Después: filas de 300 B y el 1 % del payload a S3 ≈ ${f(gbAfter)} GB/mes × US$0.023 ≈ US$${f(after)}/mes.`,
            'Apagar los logs ahorra lo mismo y te deja sin filas de predicción: sin ellas no hay monitoreo de modelo ni datos para etiquetar.',
          ];
          take = '<b>Causa raíz:</b> un log de debug que manda el payload completo a un servicio que cobra por GB ingerido. <b>Arreglo:</b> filas de predicción a S3, payload muestreado al 1 %, niveles de log por entorno.';
          say1 = 'A forgotten debug log was sending full payloads to CloudWatch at fifty cents a gigabyte; prediction rows go to S3 and payloads are sampled at one percent.';
        } else if (v === 'region') {
          const R = r.pick([100, 200, 500, 1000]);
          const K = r.pick([150, 200, 602]);
          gb = (R * K * 1e3 * SEG_MES) / 1e9;
          price = 0.02;
          q = `Por falta de capacidad de GPU en us-east-1, el equipo movió el model server a us-west-2; el gateway, S3 y quienes llaman siguen en us-east-1. Desde entonces subió la línea de transferencia entre regiones (≈ US$0.02/GB desde us-east-1, aprox.) y el p99 creció ≈ 70 ms. Cada request manda ≈ <b>${K} KB</b> (${K === 602 ? 'el tensor FP32' : K === 150 ? 'el tensor en UINT8' : 'el JPEG'}) al model server, a ≈ <b>${R} req/s</b> promedio.`;
          p1 = 'GB al mes que cruzan de región (mes de 730 h)';
          p1steps = ['Planteamiento: bytes al mes = req/s × bytes por request × segundos del mes (2,628,000 s). La respuesta es chica: cuenta la ida.', `${R} × ${K} KB × 2,628,000 s ≈ <b>${f(gb)} GB/mes</b>`];
          ok = 'Volver a servir en la región del gateway: cuota o reserva de capacidad, y permitir más zonas y tamaños de la misma GPU';
          wrong = ['Comprimir el payload con gzip', 'Agregar réplicas en us-west-2 para bajar el p99'];
          csteps = [
            'Causa raíz: el salto entre regiones quedó en el camino de cada request: cobra por GB y suma un RTT de costa a costa (≈ 60–80 ms) que ninguna réplica quita.',
            'Comprimir baja poco los bytes (casi nada en un JPEG, que ya viene comprimido) y no quita el salto ni el RTT. Más réplicas en us-west-2 tampoco: el tiempo está en la red, no en la cola.',
            'La falta de capacidad se resuelve donde nació: cuota y una reserva de capacidad en la región, más zonas, otros tamaños de instancia con la misma GPU (el engine de TensorRT está atado a la GPU, no al tamaño de la instancia).',
          ];
          take = '<b>Causa raíz:</b> un salto entre regiones en el camino de cada request, para esquivar una falta de capacidad. <b>Arreglo:</b> capacidad de GPU en la región del gateway (cuota, reserva, más zonas y tamaños).';
          say1 = 'Every request crossed regions, which costs per gigabyte and adds a coast-to-coast round trip, so the fix is GPU capacity in our own region, not more replicas.';
        } else {
          const W = r.pick([16, 70.6, 141]);
          const n = r.pick([10, 20, 40]);
          gb = W * n * 30;
          price = 0.045;
          q = `Un servicio de LLM escala con KEDA, y cada réplica nueva baja ≈ <b>${f(W)} GB</b> de pesos (${W === 16 ? 'Llama 3 8B en BF16' : W === 70.6 ? 'Llama 3 70B en FP8' : 'Llama 3 70B en BF16'}) desde S3, por el NAT gateway (≈ US$0.045 por GB procesado, aprox.). Con el autoscaling hay ≈ <b>${n} arranques al día</b>. La factura muestra una línea enorme de "NAT gateway data processing" que nadie asocia con el modelo.`;
          p1 = 'GB al mes que pasan por el NAT (30 días)';
          p1steps = ['Planteamiento: GB al mes = GB de pesos × arranques al día × 30.', `${f(W)} × ${n} × 30 = <b>${f(gb)} GB/mes</b>`];
          ok = 'Un gateway endpoint de S3 en la VPC (gratis): los pesos dejan de pasar por el NAT';
          wrong = ['Un NAT gateway por zona para repartir el tráfico', 'Subir el mínimo de réplicas para que arranquen menos'];
          csteps = [
            'Causa raíz: el NAT cobra cada GB que lo cruza, y desde una subred privada S3 sale por ahí si nadie configuró otro camino.',
            'Un NAT por zona es buena práctica (disponibilidad, sin cruce de AZ), pero sigue cobrando por GB.',
            'Subir el mínimo de réplicas cambia NAT por horas de GPU: sale más caro. Con el gateway endpoint, el arranque cuesta lo mismo y la línea desaparece.',
          ];
          take = '<b>Causa raíz:</b> los pesos del modelo bajan de S3 por el NAT, que cobra por GB. <b>Arreglo:</b> un gateway endpoint de S3 (gratis); las capas de ECR también bajan por ahí.';
          say1 = 'Model weights were going through the NAT gateway at four and a half cents a gigabyte; an S3 gateway endpoint makes that free.';
        }
        const cost = gb * price;
        const priceTxt = price === 0.5 ? '0.50' : String(price);
        const t4 = cost / (0.526 * MES_H);
        const choices = r.shuffle([ok].concat(wrong));
        return {
          q,
          parts: [
            { ask: p1, unit: 'GB/mes', answer: gb, tol: 0.15, steps: p1steps },
            {
              ask: 'Costo mensual de esos GB', unit: 'US$/mes', answer: cost, tol: 0.15,
              steps: [
                'Planteamiento: costo = GB × US$/GB.',
                `Con el resultado anterior: ${f(gb)} × ${priceTxt} ≈ <b>US$${f(cost)}/mes</b>`,
              ],
            },
            { ask: '¿Qué arreglas?', choices, answer: choices.indexOf(ok), steps: csteps },
            {
              ask: '¿Cuántas T4 encendidas todo el mes (≈ US$384 cada una) pagarías con ese costo?', unit: 'T4', answer: t4, tol: 0.15,
              steps: [
                'Planteamiento: T4 equivalentes = costo mensual ÷ (0.526 × 730).',
                `Con el resultado de la segunda parte: US$${f(cost)} ÷ 384 ≈ <b>${f(t4)} T4</b>`,
                'Es la forma de decirlo en una revisión de costos: los centavos por GB se vuelven grandes cuando multiplican algo que pasa millones de veces al día o terabytes al mes.',
              ],
            },
          ],
          hint: 'Recorre los bytes: cuántos por evento, cuántos eventos al mes, por dónde pasan y cuánto cobra ese paso por GB. Después busca qué hace que esos bytes pasen por ahí.',
          takeaway: `<b>Diagnóstico:</b> ≈ ${f(gb)} GB/mes por un camino que cobra US$${priceTxt}/GB: ≈ US$${say(cost)}/mes, como ${f(t4, 1)} T4. ${take} <b>Impacto:</b> la línea baja casi a cero. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'dg-04', topic: 'diagnostico', level: 3, title: 'El p99 explota en la hora pico', ref: 'm03.colas-utilizacion',
      gen(r) {
        const tri = [];
        // [ms de servicio, réplicas, utilización en el pico]: el p99 del modelo pasa 220 ms en el pico y queda bajo 180 ms
        // con el arreglo, y sin margen la caída de una réplica deja a las demás por encima de 100 %.
        [4, 5, 8, 10].forEach((s) => [3, 4, 5, 6, 8].forEach((n) => [0.9, 0.92, 0.94, 0.95].forEach((rh) => {
          const mu = 1000 / s;
          const lam = Math.round(rh * n * mu);
          const k = ceilx(lam / (0.7 * mu)) + 1;
          const before = (4.6 * s) / (1 - lam / (n * mu));
          const after = (4.6 * s) / (1 - lam / (k * mu));
          if (far(lam / (0.7 * mu), 0.05) && before > 220 && after < 180 && (lam / (n * mu)) * (n / (n - 1)) > 1.02) tri.push([s, n, rh]);
        })));
        const t = r.pick(tri);
        const S = t[0];
        const n = t[1];
        const mu = 1000 / S;
        const lam = Math.round(t[2] * n * mu);
        const rho = lam / (n * mu);
        const W = S / (1 - rho);
        const p99 = 4.6 * W;
        const k = ceilx(lam / (0.7 * mu)) + 1;
        const rho2 = lam / (k * mu);
        const W2 = S / (1 - rho2);
        const p99b = 4.6 * W2;
        const ok = 'Agregar réplicas hasta dejar cada una en 70 % o menos en el pico (con N+1) y escalar por tiempo en cola';
        const choices = r.shuffle([ok,
          'Subir el timeout del cliente para que los requests lentos no fallen',
          'Agregar reintentos en el cliente',
          'Reentrenar un modelo más chico']);
        return {
          q: `Un servicio síncrono de visión tiene un SLO de <b>p99 ≤ 200 ms</b>. Corre en <b>${n} réplicas</b> detrás de un Service de Kubernetes que reparte al azar (cada réplica tiene su propia cola); cada una procesa un request en ≈ <b>${S} ms</b> (tiempo de servicio, sin cola), ≈ ${f(mu)} req/s como máximo. Todos los días, en la hora pico, llegan ≈ <b>${f(lam)} req/s</b>: el p99 se dispara, aparecen timeouts, la GPU está casi siempre ocupada y la cola de Triton crece. Fuera del pico, el p99 queda holgado dentro del SLO. No hubo deploys. Modela cada réplica como M/M/1.`,
          parts: [
            {
              ask: 'Utilización ρ de cada réplica en el pico', unit: '%', answer: rho * 100, tolAbs: 2,
              steps: [
                'Planteamiento: ρ = llegadas por réplica ÷ capacidad de una réplica.',
                `${f(lam)} ÷ ${n} = ${f(lam / n)} req/s por réplica → ÷ ${f(mu)} = <b>${f(rho * 100, 0)} %</b>`,
              ],
            },
            {
              ask: 'p99 estimado en el pico (M/M/1: p99 ≈ 4.6 × W)', unit: 'ms', answer: p99, tol: 0.15,
              steps: [
                'Planteamiento: W = S ÷ (1 − ρ); en M/M/1, p99 ≈ 4.6 × W.',
                `Con el resultado anterior: W = ${S} ÷ (1 − ${f(rho, 3)}) ≈ ${f(W)} ms → p99 ≈ 4.6 × ${f(W)} ≈ <b>${f(p99)} ms</b>`,
                'Fuera del pico la misma réplica está lejos del codo: el modelo de colas dice que el problema es la utilización, no el cómputo. Es un modelo para argumentar (una GPU es más regular que una exponencial); el codo real se mide con un load test (M3).',
              ],
            },
            {
              ask: '¿Qué haces primero?', choices, answer: choices.indexOf(ok),
              steps: [
                'Causa raíz: llegadas casi iguales a la capacidad. La espera crece como ρ ÷ (1 − ρ) y explota cerca de 1; el cómputo de cada request no cambió.',
                'Subir el timeout deja más requests en vuelo (Little) esperando en la misma cola; reintentar suma carga justo en el tier saturado.',
                'Un modelo más chico baja S y ayuda, pero son semanas de trabajo con riesgo de accuracy; las réplicas lo arreglan hoy. Si el costo aprieta, después optimizas el modelo.',
                `Repartir por requests en vuelo (least outstanding requests: una cola compartida) también baja la espera y conviene hacerlo, pero no da margen: con ρ ≈ ${f(rho * 100, 0)} %, si cae una réplica las otras ${n - 1} pasan de 100 % y la cola crece sin límite.`,
                'Y la señal de escalado es el tiempo en cola: la CPU del pod se congela cuando la GPU se satura (M6).',
              ],
            },
            {
              ask: 'Réplicas para quedar en 70 % o menos en el pico, más N+1', unit: 'réplicas', answer: k, tol: 0,
              steps: [
                'Planteamiento: réplicas = ⌈llegadas ÷ (0.7 × capacidad por réplica)⌉ + 1.',
                `⌈${f(lam)} ÷ (0.7 × ${f(mu)})⌉ + 1 = ⌈${f(lam / (0.7 * mu), 2)}⌉ + 1 = <b>${k} réplicas</b>`,
              ],
            },
            {
              ask: 'p99 estimado con esas réplicas, todas vivas', unit: 'ms', answer: p99b, tol: 0.15,
              steps: [
                'Planteamiento: recalcula ρ con más réplicas y vuelve a aplicar W = S ÷ (1 − ρ) y p99 ≈ 4.6 × W.',
                `Con el resultado anterior: ρ = ${f(lam)} ÷ (${k} × ${f(mu)}) ≈ ${f(rho2, 3)} → W = ${S} ÷ (1 − ${f(rho2, 3)}) ≈ ${f(W2)} ms → p99 ≈ <b>${f(p99b)} ms</b>`,
                `De ≈ ${f(p99)} a ≈ ${f(p99b)} ms con ${k - n} réplicas más. Si cae una, las ${k - 1} restantes quedan en ρ ≈ ${f((lam / ((k - 1) * mu)) * 100, 0)} %.`,
              ],
            },
          ],
          hint: 'ρ = llegadas por réplica ÷ capacidad; en M/M/1, W = S ÷ (1 − ρ) y p99 ≈ 4.6 × W. Para arreglarlo, cuántas réplicas dejan ρ en 70 % o menos (más N+1), y recalcula el p99.',
          takeaway: `<b>Diagnóstico:</b> ρ ≈ ${f(rho * 100, 0)} % en el pico; el modelo de colas da un p99 de ≈ ${say(p99)} ms. <b>Causa raíz:</b> utilización cerca de 1, no el modelo. <b>Arreglo:</b> ${k} réplicas (70 % + N+1) y autoscaling por tiempo en cola. <b>Impacto:</b> p99 ≈ ${say(p99b)} ms con todas vivas. <i>"At the peak each replica runs at about ${f(rho * 100, 0)}% utilization, so the queue, not the model, blows up the p99; I add replicas until each sits under 70%, with N+1, and scale on queue time."</i>`,
        };
      },
    },
    {
      id: 'dg-05', topic: 'diagnostico', level: 3, title: 'No se recupera: tormenta de reintentos', ref: 'm03.timeouts-reintentos',
      gen(r) {
        const L = r.pick([2, 3]);
        const R = r.pick([2, 3]);
        const a = Math.pow(1 + R, L);
        const tri = [];
        [200, 300, 500, 800].forEach((u) => [2, 3, 4].forEach((n) => [100, 150, 200, 300].forEach((c) => {
          const rh = u / (n * c);
          if (rh >= 0.45 && rh <= 0.72 && far((u * a) / (0.7 * c), 0.05)) tri.push([u, n, c]);
        })));
        const t = r.pick(tri);
        const U = t[0];
        const n = t[1];
        const c = t[2];
        const load = U * a;
        const ratio = load / (n * c);
        const need = ceilx(load / (0.7 * c));
        const util = ((1.1 * U) / (n * c)) * 100;
        const chain = L === 2 ? 'app → gateway → model server' : 'app → gateway → servicio → model server';
        const ok = 'Reintentar en una sola capa, con presupuesto de ≈ 10 % y backoff exponencial con jitter; las demás capas no reintentan';
        const choices = r.shuffle([ok,
          'Escalar el model server hasta absorber los reintentos',
          'Subir los timeouts de todas las capas',
          'Quitar el backoff para que los reintentos terminen antes']);
        return {
          q: `Un deploy malo frenó el model server durante 5 minutos. Se revirtió, pero el servicio no se recuperó: una hora después sigue con timeouts. Cadena: <b>${chain}</b>, y cada una de las ${L} capas de llamadas reintenta hasta <b>${R} veces</b> cada llamada que vence. Las personas mandan ≈ <b>${f(U)} req/s</b>, y el model server son <b>${n} réplicas de ≈ ${f(c)} req/s</b> de capacidad máxima cada una. En el dashboard, casi todas las llamadas al model server vencen.`,
          parts: [
            {
              ask: 'Carga que recibe el model server mientras todo vence (peor caso)', unit: 'req/s', answer: load, tol: 0.15,
              steps: [
                'Planteamiento: cada capa hace hasta 1 + R intentos por cada intento que recibe: (1 + R)<sup>capas</sup> por request; × la tasa de las personas.',
                `(1 + ${R})<sup>${L}</sup> = ${a} intentos → ${f(U)} × ${a} = <b>${f(load)} req/s</b>`,
                `Contra una capacidad de ${n} × ${f(c)} = ${f(n * c)} req/s: ${f(ratio, 1)}× lo que puede atender. Mientras pase de 1×, la cola no baja aunque la causa original ya no exista.`,
              ],
            },
            {
              ask: 'Réplicas para absorber ese peor caso al 70 %', unit: 'réplicas', answer: need, tol: 0,
              steps: [
                'Planteamiento: réplicas = ⌈carga ÷ (0.7 × capacidad por réplica)⌉.',
                `Con el resultado anterior: ⌈${f(load)} ÷ ${f(0.7 * c)}⌉ = ⌈${f(load / (0.7 * c), 2)}⌉ = <b>${need} réplicas</b>, contra ${n} hoy`,
                `Escalar para pagar los reintentos es comprar ≈ ${f(need / n, 0)}× la flota para el mismo tráfico de personas.`,
              ],
            },
            {
              ask: '¿Qué cambias?', choices, answer: choices.indexOf(ok),
              steps: [
                'Causa raíz: la amplificación de reintentos mantiene la carga arriba de la capacidad. Es un estado que se sostiene solo: la falla original ya pasó y el sistema no sale.',
                `Escalar pide ${need} réplicas para el mismo tráfico y llega tarde: los nodos GPU tardan minutos.`,
                'Timeouts más largos dejan más requests colgados (Little) sin bajar los intentos; sin backoff, los reintentos llegan juntos y empeoran el pico.',
                'Con una sola capa y presupuesto, el model server recibe como mucho ≈ 1.1 × la tasa de las personas; mientras se vacía la cola, load shedding (503 rápido) y fallback.',
              ],
            },
            {
              ask: 'Utilización del model server con el arreglo (≈ 1.1 × la tasa de las personas)', unit: '%', answer: util, tolAbs: 2,
              steps: [
                'Planteamiento: ρ = 1.1 × tasa de las personas ÷ capacidad total.',
                `1.1 × ${f(U)} ÷ ${f(n * c)} ≈ <b>${f(util, 0)} %</b>: debajo de 100 %, la cola se vacía y el sistema vuelve solo`,
              ],
            },
          ],
          hint: 'Multiplica los intentos capa por capa ((1 + reintentos) por capa) y compara la carga con la capacidad: si queda arriba de 1×, no se recupera solo. Después mira qué carga queda con una sola capa que reintenta con presupuesto.',
          takeaway: `<b>Diagnóstico:</b> el model server recibe ≈ ${f(ratio, 1)}× su capacidad aunque el deploy malo ya se revirtió. <b>Causa raíz:</b> ${L} capas que reintentan ${R} veces: hasta ${a} intentos por request. <b>Arreglo:</b> una sola capa reintenta, con presupuesto de ≈ 10 %, backoff con jitter y load shedding mientras se vacía la cola. <b>Impacto:</b> la carga baja a ≈ ${f(util, 0)} % de la capacidad y el sistema se recupera sin comprar ${need - n} réplicas. <i>"Retries kept the model server at ${f(ratio, 1)}x its capacity after the bad deploy was gone; now one layer retries within a ten-percent budget and the others fail fast, so the load drops to 1.1x and the queue drains."</i>`,
        };
      },
    },
    {
      id: 'dg-06', topic: 'diagnostico', level: 3, title: 'La accuracy cayó después de un release de la app', ref: 'm09.skew',
      gen(r) {
        // [qué cambió en la app, el arreglo, top-1 plausible en ese slice]: cambios que rompen el input lo suficiente como
        // para bajar el top-1 del slice 12–32 puntos (una rotación de 90° más que una foto borrosa).
        const chg = r.pick([
          ['sube la foto original con la orientación solo en la etiqueta EXIF (la versión anterior giraba los píxeles al subirla), y el gateway no aplica esa etiqueta: las fotos verticales llegan acostadas, giradas 90°',
            'aplicar la orientación EXIF en el gateway, con el mismo preprocess.py que usa training', [60, 64, 70, 74]],
          ['para sugerir la categoría manda una miniatura de 160 px (para ahorrar datos) en vez de la foto de ≈ 1024 px, y el gateway la agranda a 224',
            'volver a mandar la foto de ≈ 1024 px y dejar el resize solo en el gateway, con el mismo preprocess.py que usa training', [64, 70, 74, 76]],
        ]);
        const A0 = r.pick([88, 90, 92]);
        const An = r.pick(chg[2]);
        const s = r.pick([0.2, 0.25, 0.3, 0.4]);
        const A1 = (1 - s) * A0 + s * An;
        const V = r.pick([2, 5, 10]);
        const s2 = r.pick([0.6, 0.8]);   // adónde llega el rollout de la app (siempre más que hoy)
        const extra = V * 1e6 * s * ((A0 - An) / 100);
        const proj = (1 - s2) * A0 + s2 * An;
        const ok = 'Corregir el preprocesamiento en un solo lugar (el gateway, con el mismo código que training) y agregar a CI un test de paridad con fotos de la app nueva';
        const choices = r.shuffle([ok,
          'Reentrenar con las fotos de la app nueva para que el modelo aprenda el formato',
          'Hacer rollback del modelo a la versión anterior',
          'Bajar el umbral de confianza para mostrar más sugerencias']);
        return {
          q: `El clasificador de fotos de un marketplace daba ≈ <b>${A0} %</b> de top-1 en producción (medido con una muestra etiquetada diaria) y hoy da ≈ <b>${f(A1, 1)} %</b>. No hubo deploy del modelo ni del gateway. Ayer salió una versión nueva de la app de iOS, que ya manda el <b>${f(s * 100, 0)} %</b> del tráfico: ahora ${chg[0]}. En los slices de Android y de la versión anterior de iOS, el top-1 sigue en ${A0} %. El servicio hace ≈ <b>${V} M predicciones al día</b>.`,
          parts: [
            {
              ask: 'Top-1 en las fotos de la versión nueva', unit: '%', answer: An, tolAbs: 1,
              steps: [
                'Planteamiento: el global es un promedio ponderado por slice: global = (1 − s) × resto + s × nuevo → nuevo = (global − (1 − s) × resto) ÷ s.',
                `(${f(A1, 1)} − ${f(1 - s, 2)} × ${A0}) ÷ ${f(s, 2)} = (${f(A1, 1)} − ${f((1 - s) * A0, 1)}) ÷ ${f(s, 2)} = <b>${An} %</b>`,
              ],
            },
            {
              ask: 'Predicciones equivocadas de más por día, por ese slice', unit: 'predicciones/día', answer: extra, tol: 0.15,
              steps: [
                'Planteamiento: extra = predicciones × fracción del slice × (top-1 de antes − top-1 de ahora).',
                `Con el resultado anterior: ${V} M × ${f(s, 2)} × (${A0} − ${An}) % ≈ <b>${f(extra)}</b> al día`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(ok),
              steps: [
                'Diagnóstico: cae solo el slice de la versión nueva, desde el día del release y sin deploy del modelo: es training-serving skew por un cambio en la entrada, no drift.',
                `Arreglo: ${chg[1]}. Y en el dashboard, el top-1 y las estadísticas del input (brillo, tamaño, orientación) por app_version, para verlo el mismo día la próxima vez.`,
                'Reentrenar con esas fotos tapa un bug de pipeline: el modelo aprende el formato roto, y el problema vuelve cuando alguien arregla la app (M9).',
                'El modelo no cambió: el rollback no toca la causa. Bajar el umbral solo muestra más sugerencias equivocadas.',
                'Mientras sale el arreglo, pide pausar el rollout por fases de la app (o apagar el cambio con un flag remoto): cada día que pasa, más tráfico llega con la entrada rota.',
              ],
            },
            {
              ask: `Si el release llega al ${f(s2 * 100, 0)} % del tráfico sin arreglo, ¿qué top-1 global tendrías?`, unit: '%', answer: proj, tolAbs: 1,
              steps: [
                'Planteamiento: el mismo promedio ponderado con la nueva fracción.',
                `${f(1 - s2, 2)} × ${A0} + ${f(s2, 2)} × ${An} = <b>${f(proj, 1)} %</b>`,
                'Es la urgencia del arreglo: el rollout de la app avanza solo, sin pasar por tu canary.',
              ],
            },
          ],
          hint: 'El global es un promedio ponderado por slice: despeja el top-1 del slice nuevo. Después pregunta qué cambió ese día (¿el modelo, el gateway o la entrada?) y proyecta el promedio cuando ese slice crezca.',
          takeaway: `<b>Diagnóstico:</b> el slice de la app nueva cayó a ≈ ${An} % (≈ ${say(extra)} errores de más al día); el resto sigue en ${A0} %. <b>Causa raíz:</b> skew en la entrada: la app nueva cambió cómo llega la foto y el preprocesamiento no lo normaliza como en training. <b>Arreglo:</b> preprocesamiento en un solo lugar, test de paridad con fotos de la app nueva y métricas por app_version. <b>Impacto:</b> sin arreglo, ≈ ${f(proj, 0)} % global con el rollout al ${f(s2 * 100, 0)} %; con arreglo, de vuelta a ${A0} %. <i>"Only the new iOS version dropped, from the day it shipped, with no model deploy, so it's skew in the input path: I fix the preprocessing in one place, add a parity test with photos from the new app, and slice the dashboard by app version."</i>`,
        };
      },
    },
    {
      id: 'dg-07', topic: 'diagnostico', level: 3, title: 'Preemptions: el KV cache no alcanza', ref: 'm14.kv-cache',
      gen(r) {
        const fit = (t, bytes) => floorx(68.4e9 / (t * bytes));
        // Prefill sin prefix caching, como fracción del pico FP8 denso de dos H100 (≈ 3,958 TFLOPS): 2 × 70.6 B FLOPs por token.
        const pref = (rps, t) => (rps * t * 2 * 70.6e9) / 3958e12;
        // [tokens por request, req/s en el pico, segundos por request, réplicas]: el KV en BF16 queda corto por ≥ 10 %, el
        // cómputo tiene margen (prefill ≤ 35 % del pico aun sin prefix caching), FP8 alcanza o no con ≥ 10 % de margen y
        // ningún cociente queda pegado a un entero. Se elige primero el resultado: cada palanca sale la mitad de las veces.
        // Que FP8 no alcance pide secuencias largas (respuestas de ≈ 1 min): es la física del caso, no un sesgo.
        const byOut = { fp8: [], rep: [] };
        [4000, 5000, 6000, 8000, 10000].forEach((t) => [25, 30, 40, 50, 60].forEach((e) => [8, 12, 16, 20, 24, 32].forEach((n) => [6, 8, 10, 12, 15, 16, 18, 20, 24, 25, 30, 32, 36, 40, 45, 48, 50, 60, 64, 72, 80].forEach((p) => {
          const inf = (p * e) / n;
          const fb = fit(t, 327680);
          const ff = fit(t, 163840);
          if (p / n < 0.5 || pref(p / n, t) > 0.35 || inf <= fb * 1.1) return;
          if (!(inf <= ff * 0.9 || inf >= ff * 1.1)) return;
          if (!far((p * e) / fb, 0.05) || !far((p * e) / ff, 0.05)) return;
          byOut[inf <= ff ? 'fp8' : 'rep'].push([t, p, e, n]);
        }))));
        const qd = r.pick(byOut[r.pick(['fp8', 'rep'])]);
        const T = qd[0];
        const P = qd[1];
        const E = qd[2];
        const n = qd[3];
        const inf = (P * E) / n;
        const kvB = (T * 327680) / 1e9;
        const fitB = fit(T, 327680);
        const fitF = fit(T, 163840);
        const needB = ceilx((P * E) / fitB);
        const needF = ceilx((P * E) / fitF);
        const useA = inf <= fitF;
        const load = pref(P / n, T);
        const okA = 'Pasar el KV cache a FP8 (validado en el golden set)';
        const okB = 'Agregar réplicas hasta que quepan las secuencias en vuelo';
        const choices = r.shuffle([okA, okB, 'Subir --max-num-seqs para admitir más conversaciones a la vez', 'Cambiar a GPUs con más TFLOPS']);
        return {
          q: `Un copiloto para agentes de soporte redacta respuestas largas (procedimientos paso a paso) con <b>Llama 3.3 70B en FP8</b> (misma arquitectura que Llama 3 70B) y vLLM, en <b>${n} réplicas de 2 × H100</b>: a cada una le quedan ≈ <b>68.4 GB</b> para KV cache, en BF16 (<b>320 KiB por token</b>). Producto alargó a propósito el contexto (mejoró la resolución de casos): cada request manda ahora todo el hilo del ticket y ocupa ≈ <b>${f(T)} tokens</b> entre prompt y respuesta (antes, ≈ 2,250). En el pico llegan ≈ <b>${P} req/s</b> y cada request tarda ≈ <b>${E} s</b> de punta a punta. Dashboard: <code>vllm:kv_cache_usage_perc</code> al 100 %, <code>vllm:num_preemptions_total</code> subiendo, TTFT p95 de 3 s (SLO: 1 s) y el TPOT sano.`,
          parts: [
            {
              ask: 'Secuencias en vuelo por réplica en el pico (Little)', unit: 'secuencias', answer: inf, tol: 0.15,
              steps: [
                'Planteamiento: Little con secuencias: en vuelo = req/s × latencia de punta a punta; por réplica, ÷ réplicas.',
                `${P} × ${E} s ÷ ${n} = <b>${f(inf)} secuencias</b> por réplica`,
              ],
            },
            {
              ask: 'Secuencias de ese largo que caben en el KV de una réplica (BF16)', unit: 'secuencias', answer: fitB, tol: 0,
              steps: [
                'Planteamiento: KV por secuencia = tokens × 320 × 1,024 B; caben ⌊68.4 GB ÷ KV por secuencia⌋.',
                `${f(T)} × 327,680 B ≈ ${f(kvB, 3)} GB → ⌊68.4 ÷ ${f(kvB, 3)}⌋ = ⌊${f(68.4e9 / (T * 327680), 2)}⌋ = <b>${fitB}</b>`,
                `Little pide ${f(inf)}: el scheduler admite más de lo que cabe y, cuando faltan bloques, saca secuencias del batch y después recalcula su prefill. Son las preemptions, y el TTFT que se dispara.`,
              ],
            },
            {
              ask: 'Las mismas, con el KV cache en FP8 (160 KiB por token)', unit: 'secuencias', answer: fitF, tol: 0,
              steps: [
                'Planteamiento: el KV en FP8 ocupa la mitad por token.',
                `⌊68.4 GB ÷ (${f(T)} × 163,840 B)⌋ = ⌊${f(68.4e9 / (T * 163840), 2)}⌋ = <b>${fitF}</b>`,
              ],
            },
            {
              ask: 'Réplicas que necesitarías para el pico dejando el KV en BF16', unit: 'réplicas', answer: needB, tol: 0,
              steps: [
                'Planteamiento: réplicas = ⌈secuencias en vuelo de todo el servicio ÷ secuencias que caben por réplica⌉.',
                `⌈${P} × ${E} ÷ ${fitB}⌉ = ⌈${f((P * E) / fitB, 2)}⌉ = <b>${needB} réplicas</b>, contra ${n} hoy (${needB - n} más, de 2 H100 cada una)`,
                'Es el mínimo, con el KV lleno: en la práctica dejas ≈ 10–20 % de holgura.',
              ],
            },
            {
              ask: '¿Cuál es la palanca más barata que, sola, devuelve el sistema al SLO?', choices, answer: choices.indexOf(useA ? okA : okB),
              steps: [
                useA
                  ? `Con FP8 caben ${fitF} por réplica y Little pide ${f(inf)}: alcanza sin comprar GPUs, con ≈ ${f((1 - inf / fitF) * 100, 0)} % de holgura. Antes de activarlo, el golden set con contextos largos (el riesgo de calidad es bajo a medio).`
                  : `Con FP8 caben ${fitF} por réplica y Little pide ${f(inf)}: no alcanza sola. Hay que agregar réplicas: ${needF} con el KV en FP8, ${needB} sin él. Con respuestas que tardan ${E} s, cada secuencia ocupa memoria mucho rato.`,
                'Subir --max-num-seqs admite todavía más de lo que cabe: más preemptions. Bajarlo (o limitar la concurrencia en el gateway) las corta, pero deja requests esperando en la cola: contiene el daño mientras llega la capacidad, no devuelve el TTFT al SLO. Y los TFLOPS no agregan memoria.',
                `Chequeo de cómputo, aun sin prefix caching: el prefill pide ≈ ${f(P / n, 2)} req/s × ${f(T)} tokens × 2 × 70.6 B ≈ ${f(load * 3958)} TFLOP/s por réplica, ≈ ${f(load * 100, 0)} % del pico FP8 denso de dos H100 (≈ 3,958 TFLOPS): el cuello es la memoria, no el cómputo.`,
                'Y como producto quiere el contexto largo, la capacidad tiene que seguirlo: alerta sobre preemptions sostenidas y sobre el uso del KV, no sobre la utilización de la GPU.',
              ],
            },
          ],
          hint: 'Little con secuencias (req/s × latencia de punta a punta) por réplica, contra cuántas caben en el KV libre (tokens × KV por token). Compara con el KV en FP8 y con más réplicas, y elige la palanca más barata que cierra la brecha.',
          takeaway: `<b>Diagnóstico:</b> Little pide ≈ ${f(inf)} secuencias por réplica y caben ${fitB}: por eso las preemptions y el TTFT. <b>Causa raíz:</b> el contexto más largo multiplicó el KV por secuencia; la concurrencia la limita la memoria, no el cómputo. <b>Arreglo:</b> ${useA ? 'KV cache en FP8 (' + fitF + ' por réplica), validado en el golden set' : 'más réplicas (' + needF + ' con KV en FP8, ' + needB + ' sin él)'}. <b>Impacto:</b> sin preemptions, el TTFT vuelve al SLO. <i>"Little's law asks for about ${say(inf)} sequences per replica and only ${fitB} fit at this context length, so vLLM keeps preempting and TTFT explodes; ${useA ? 'an FP8 KV cache fits ' + fitF + ' with no new GPUs' : 'FP8 alone isn\'t enough, so I add replicas'}."</i>`,
        };
      },
    },
    {
      id: 'dg-08', topic: 'diagnostico', level: 3, title: 'La rampa de la mañana le gana al autoscaler', ref: 'm06.cold-starts',
      gen(r) {
        const quad = [];
        // [req/s a las 8:00, factor de la rampa, req/s planificados por réplica, min de cold start]: lo que sube la carga
        // mientras llega una réplica supera en ≥ 20 % tanto a una réplica como al margen que hay a las 8:00 (si no, el
        // N+1 lo absorbería y no habría 503), y ningún cociente queda pegado a un entero.
        [100, 150, 200, 250, 300, 400].forEach((a) => [3, 4, 5, 6].forEach((k) => [100, 120, 150, 200, 250].forEach((c) => [6, 8, 10, 12].forEach((tt) => {
          if (!far(a / c, 0.05) || !far((a * k) / c, 0.05) || ceilx((a * k) / c) <= ceilx(a / c)) return;
          const gap = ((a * k - a) / 30) * tt;
          if (gap >= 1.2 * Math.max(c, (ceilx(a / c) + 1) * c - a)) quad.push([a, k, c, tt]);
        }))));
        const t = r.pick(quad);
        const A = t[0];
        const Bk = A * t[1];
        const c = t[2];
        const T = t[3];
        const rate = (Bk - A) / 30;
        const def = rate * T;
        const nA = ceilx(A / c) + 1;
        const nB = ceilx(Bk / c) + 1;
        const extra = (nB - nA) * 1 * 22 * 0.805;
        const ok = 'Escalado programado: subir el mínimo de réplicas antes de la rampa (trigger cron) y dejar el autoscaler para el resto del día';
        const choices = r.shuffle([ok,
          'Bajar el umbral del autoscaler para que reaccione antes',
          'Subir el timeout del cliente durante la mañana',
          'Reintentar los 503 en el cliente']);
        return {
          q: `Un servicio de visión escala con KEDA por tiempo en cola. Todos los días hábiles, entre las 8:00 y las 8:30, el tráfico sube en rampa de ≈ <b>${f(A)}</b> a ≈ <b>${f(Bk)} req/s</b>, y en esa media hora el p99 rompe el SLO y el load shedding devuelve 503. Cada réplica (1 L4, g6.xlarge ≈ US$0.805/h, aprox.) sostiene ≈ <b>${c} req/s</b> planificados, y una réplica nueva tarda ≈ <b>${T} min</b> en servir (nodo GPU, imagen y modelo). El autoscaler reacciona bien… pero los nodos llegan tarde.`,
          parts: [
            {
              ask: 'Velocidad de la rampa', unit: 'req/s por min', answer: rate, tol: 0.05,
              steps: [
                'Planteamiento: (llegada final − llegada inicial) ÷ minutos de la rampa.',
                `(${f(Bk)} − ${f(A)}) ÷ 30 = <b>${f(rate)} req/s por minuto</b>`,
              ],
            },
            {
              ask: 'Carga que sube mientras llega una réplica nueva', unit: 'req/s', answer: def, tol: 0.15,
              steps: [
                'Planteamiento: el autoscaler pide capacidad al ver la carga y la réplica sirve T min después; mientras tanto la carga sube rampa × T. Es una cota baja: detectar la carga y la ventana del autoscaler suman más minutos.',
                `Con el resultado anterior: ${f(rate)} × ${T} = <b>${f(def)} req/s</b>, ≈ ${f(def / c, 1)} réplicas de ${c} req/s que siempre llegan tarde`,
                `A las 8:00 hay ${nA} réplicas: ≈ ${f(nA * c - A)} req/s de margen planificado, menos que el hueco. Durante toda la rampa el autoscaler va ≈ ${T} min atrás y, cuando el margen no alcanza, salta el load shedding.`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(ok),
              steps: [
                'Causa raíz: la rampa es más rápida que el cold start de un nodo GPU (≈ 5–13 min: nodo, imagen y modelo). Ningún umbral hace que un nodo arranque antes.',
                `Bajar el umbral adelanta la reacción unos minutos, no los ${T} min del nodo. Para tapar el hueco así tendrías que llevar ≈ ${f(def)} req/s de margen todo el día: pagas 24 h de GPU para cubrir media hora.`,
                'Timeouts más largos y reintentos agregan espera o carga justo durante el déficit.',
                'La rampa es conocida (todos los días a la misma hora): escalado programado. Para acortar el cold start, la imagen precargada en la AMI y los pesos en disco local.',
              ],
            },
            {
              ask: 'Réplicas que deben estar listas antes de la rampa (pico de la mañana + N+1)', unit: 'réplicas', answer: nB, tol: 0,
              steps: [
                'Planteamiento: réplicas = ⌈llegada final ÷ capacidad planificada⌉ + 1.',
                `⌈${f(Bk)} ÷ ${c}⌉ + 1 = ⌈${f(Bk / c, 2)}⌉ + 1 = <b>${nB} réplicas</b>, contra ${nA} con la carga de las 8:00`,
              ],
            },
            {
              ask: 'Costo mensual de encender las réplicas extra 1 h antes (22 días hábiles)', unit: 'US$/mes', answer: extra, tol: 0.15,
              steps: [
                'Planteamiento: réplicas extra × 1 h × días × US$/h.',
                `Con el resultado anterior: (${nB} − ${nA}) × 1 × 22 × 0.805 ≈ <b>US$${f(extra)}/mes</b>`,
                'Es el precio de no tirar requests cada mañana: horas de GPU, no un rediseño.',
              ],
            },
          ],
          hint: 'Mide la velocidad de la rampa y multiplícala por lo que tarda en servir una réplica nueva: ese es el hueco que el autoscaler nunca alcanza. Después: cuántas réplicas tienen que estar listas antes de la rampa y cuánto cuesta prenderlas un rato antes.',
          takeaway: `<b>Diagnóstico:</b> la carga sube ≈ ${f(rate)} req/s por minuto y una réplica tarda ${T} min: el autoscaler siempre va ≈ ${f(def)} req/s atrás. <b>Causa raíz:</b> una rampa conocida, más rápida que el cold start de un nodo GPU. <b>Arreglo:</b> escalado programado a ${nB} réplicas antes de las 8:00; el autoscaler sigue el resto del día. <b>Impacto:</b> ≈ US$${say(extra)}/mes, sin 503 en la mañana. <i>"The morning ramp is faster than a GPU node's cold start, so I scale ahead on a schedule and keep the autoscaler for the rest of the day."</i>`,
        };
      },
    },
    {
      id: 'dg-09', topic: 'diagnostico', level: 3, title: 'El reproceso nocturno no termina a tiempo', ref: 'c04.estimaciones',
      gen(r) {
        // [ms de CPU por tile, workers, láminas, tiles por lámina]: hoy no cabe en la ventana y con el arreglo sí, ambas con
        // ≥ 10 % de margen.
        const quad = [];
        [30, 35, 40, 45, 50, 60].forEach((m) => [2, 3, 4, 5, 6].forEach((w) => [2500, 3000, 3500].forEach((tp) => {
          for (let n = 1500; n <= 9000; n += 500) {
            const hOld = (n * tp) / (w * (4000 / m)) / 3600;
            const hNew = (n * tp) / (w * Math.min(8000 / m, 200)) / 3600;
            if (hOld > 8 * 1.1 && hNew < 8 * 0.9) quad.push([m, w, n, tp]);
          }
        })));
        const t = r.pick(quad);
        const m = t[0];
        const W = t[1];
        const N = t[2];
        const TP = t[3];
        const feed = 4000 / m;
        const tiles = N * TP;
        const hOld = tiles / (W * feed) / 3600;
        const feed8 = 8000 / m;
        const rateNew = Math.min(feed8, 200);
        const hNew = tiles / (W * rateNew) / 3600;
        const cOld = W * hOld * 0.805;
        const cNew = W * hNew * 0.98;
        const ok = 'Más CPU por GPU: workers g6.2xlarge (1 L4, 8 vCPU) para que la GPU deje de esperar';
        const choices = r.shuffle([ok,
          'Una GPU más rápida: L40S (g6e.xlarge, también con 4 vCPU)',
          'Cuantizar el modelo a INT8 para que la GPU vaya más rápido',
          'Agregar más workers g6.xlarge iguales']);
        return {
          q: `Cada noche, de 22:00 a 6:00 (<b>8 h</b>), un job reprocesa el archivo de patología del día anterior con el modelo nuevo: ≈ <b>${f(N)} láminas</b> de ≈ ${f(TP)} tiles cada una, en <b>${W} workers g6.xlarge</b> (1 L4, 4 vCPU, ≈ US$0.805/h, aprox.). La L4 procesa ≈ 300 tiles/s medidos (supuesto de c04; planeas con 200 para dejar margen en la ventana). Los laboratorios nuevos escanean con JPEG de más calidad, y cada tile cuesta ahora ≈ <b>${m} ms de CPU</b> (leer la región a 40×, decodificar y reducir 2×; c04 suponía ≈ 20 ms). Desde entonces el job termina después de las 6:00. Dashboard: la GPU muy por debajo de su máximo y la CPU de los workers al 100 %.`,
          parts: [
            {
              ask: 'Tiles/s que la CPU de un worker alcanza a preparar', unit: 'tiles/s', answer: feed, tol: 0.05,
              steps: [
                'Planteamiento (Little aplicado a la CPU): tiles/s = vCPU ÷ segundos de CPU por tile.',
                `4 ÷ ${f(m / 1000, 3)} s = <b>${f(feed)} tiles/s</b>, contra 200 que la L4 procesa planificadas: la GPU espera al decode`,
                `Por eso la GPU trabaja a ≈ ${f((feed / 300) * 100, 0)} % de su máximo medido mientras la CPU está al 100 %.`,
              ],
            },
            {
              ask: 'Horas que tarda el reproceso hoy', unit: 'h', answer: hOld, tol: 0.15,
              steps: [
                'Planteamiento: tiles totales ÷ (workers × tiles/s del cuello de botella) ÷ 3,600.',
                `Con el resultado anterior: ${f(N)} × ${f(TP)} = ${f(tiles / 1e6, 2)} M tiles ÷ (${W} × ${f(feed)}) ÷ 3,600 ≈ <b>${f(hOld)} h</b>, contra una ventana de 8 h`,
              ],
            },
            {
              ask: '¿Qué cambio ataca la causa raíz?', choices, answer: choices.indexOf(ok),
              steps: [
                'Causa raíz: el cuello de botella es el decode en CPU (4 vCPU por L4), no la GPU, que pasa buena parte del tiempo ociosa.',
                'Una GPU más rápida o INT8 aceleran justo la etapa que ya espera: el job tardaría lo mismo (la g6e.xlarge también trae 4 vCPU).',
                'Con el doble de vCPU por L4, la CPU prepara el doble de tiles por segundo, hasta que el cuello pasa a la GPU; la hora cuesta ≈ 22 % más (g6.2xlarge ≈ US$0.98 contra 0.805, aprox.).',
                'Más workers g6.xlarge iguales también terminan antes, pero no bajan el costo por tile: cada L4 sigue esperando al CPU. Con más CPU por GPU, cada tile sale más barato.',
              ],
            },
            {
              ask: 'Horas con el arreglo (los mismos workers, en g6.2xlarge)', unit: 'h', answer: hNew, tol: 0.15,
              steps: [
                'Planteamiento: el ritmo por worker es el mínimo entre lo que prepara la CPU (8 vCPU ÷ segundos por tile) y lo que procesa la GPU (200 tiles/s planificadas).',
                `mín(${f(feed8)}, 200) = ${f(rateNew)} tiles/s${feed8 > 200 ? ': el cuello pasa a la L4' : feed8 === 200 ? ': CPU y GPU quedan parejas' : ': la CPU sigue siendo el cuello, al doble de ritmo'} → ${f(tiles / 1e6, 2)} M ÷ (${W} × ${f(rateNew)}) ÷ 3,600 ≈ <b>${f(hNew)} h</b>: cabe en la ventana de 8 h`,
                `≈ ${f(rateNew / feed, 1)}× más rápido por worker.`,
              ],
            },
            {
              ask: 'Costo de los workers por noche con el arreglo (g6.2xlarge ≈ US$0.98/h, aprox.)', unit: 'US$/noche', answer: cNew, tol: 0.15,
              steps: [
                'Planteamiento: workers × horas × US$/h.',
                `Con el resultado anterior: ${W} × ${f(hNew)} × 0.98 ≈ <b>US$${f(cNew)}</b> por noche, contra ${W} × ${f(hOld)} × 0.805 ≈ US$${f(cOld)} hoy: más barato y dentro de la ventana`,
              ],
            },
          ],
          hint: 'Encuentra el cuello de botella: lo que alcanza a preparar la CPU (vCPU ÷ segundos de CPU por tile) contra lo que procesa la GPU. El ritmo del job es el mínimo de los dos. Después recalcula horas y costo con más CPU por GPU.',
          takeaway: `<b>Diagnóstico:</b> la CPU prepara ${f(feed)} tiles/s por worker y la L4 podría con 200: el job tarda ≈ ${f(hOld, 1)} h en una ventana de 8. <b>Causa raíz:</b> el decode en CPU se encareció con los JPEG de más calidad y 4 vCPU ya no alimentan a la GPU. <b>Arreglo:</b> g6.2xlarge (8 vCPU por L4). <b>Impacto:</b> ≈ ${f(hNew, 1)} h y ≈ US$${f(cNew)} por noche, contra ≈ US$${f(cOld)} hoy. <i>"The GPU is waiting on JPEG decoding, so a faster GPU won't help; with eight vCPUs per L4 the run is ${f(rateNew / feed, 1)} times faster per worker and fits the window for less money."</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
