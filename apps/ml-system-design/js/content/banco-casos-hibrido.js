/* Banco de problemas · Casos de diseño · Híbridos: dos patrones juntos: precomputar candidatos + ranking online, caché frente al modelo, camino rápido y camino lento.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js.
   Plantillas: hib-01 candidatos en batch + re-rank online (N1) · hib-02 caché delante del modelo (N2) ·
   hib-03 camino rápido y camino lento (N2) · hib-04 features batch + streaming + modelo online (N3).
   Las decisiones se calculan en gen(): primero se elige el resultado y después una combinación de entradas que lo
   produce con margen (≥ 10 % en cada comparación), así cada desenlace sale parecido número de veces y ningún
   redondeo intermedio cambia un conteo ni una decisión. Precios: los de ref-numeros.js (aprox.); el resto, supuestos
   rotulados en el enunciado. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'hibrido')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  const T4H = 0.526;   // g4dn.xlarge (1 T4), US$/h aprox. (ref-numeros)
  const L4H = 0.805;   // g6.xlarge (1 L4), US$/h aprox.
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ------------------------------------------------------------------ historias de cada plantilla
  // hib-01: [contexto, ítems, tamaño del catálogo, µs por ítem en CPU (medido), candidatos por persona, M de personas
  // activas al mes, ms del SLO que le tocan al ranking]. Re-rankear K siempre entra (≤ 60 % de esos ms); puntuar el
  // catálogo entero nunca.
  const HIB01 = [
    { org: 'Una app de música arma la home de cada persona', items: 'canciones', item: 'canción', C: 60e6, Ctxt: '60 M de canciones', ss: [10, 20], Ks: [300, 500, 1000], Us: [5, 10, 20, 40], Rs: [40, 60], en: 'songs' },
    { org: 'Una plataforma de cursos online recomienda cursos en la home', items: 'cursos', item: 'curso', C: 0.4e6, Ctxt: '400k cursos', ss: [20, 40], Ks: [100, 200, 400], Us: [1, 2, 4, 8], Rs: [40, 60], en: 'courses' },
    { org: 'La app de una cadena de supermercados arma las ofertas personalizadas de la home', items: 'productos', item: 'producto', C: 80e3, Ctxt: '80k productos', ss: [30, 50], Ks: [200, 400], Us: [2, 4, 6, 10], Rs: [50, 80], en: 'products' },
    { org: 'Un portal inmobiliario recomienda propiedades en la home', items: 'propiedades', item: 'propiedad', C: 3e6, Ctxt: '3 M de propiedades', ss: [15, 25], Ks: [200, 500], Us: [1, 3, 5], Rs: [40, 60], en: 'listings' },
  ];

  // hib-02: [contexto, modelo, GPU, req/s planificados por GPU, juegos de hit rates con TTL de 5 min, 1 h y 24 h
  // (medidos en los logs), antigüedad máxima (h) y por qué (la salida depende de datos que cambian fuera de la key),
  // bytes por entrada, M de requests al día]
  const HIB02 = [
    { org: 'Un proveedor de internet clasifica cada dominio que visitan sus clientes para su control parental', model: 'un clasificador de texto y HTML', gpu: 'T4', gpuTxt: 'T4 (g4dn.xlarge, ≈ US$0.526/h, aprox.)', price: T4H, T: 1000, hs: [[0.4, 0.65, 0.85], [0.45, 0.7, 0.88], [0.35, 0.6, 0.82]], Fh: 6, Ftxt: '6 h', why: 'un dominio que cambia de contenido puede tardar hasta 6 h en reclasificarse', bytes: 200, Vs: [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000] },
    { org: 'Un metabuscador de vuelos predice si el precio de cada ruta y fecha va a subir', model: 'un modelo de series de precios', gpu: 'T4', gpuTxt: 'T4 (g4dn.xlarge, ≈ US$0.526/h, aprox.)', price: T4H, T: 600, hs: [[0.35, 0.6, 0.8], [0.4, 0.62, 0.82], [0.3, 0.55, 0.78]], Fh: 2, Ftxt: '2 h', why: 'los precios se mueven durante el día', bytes: 400, Vs: [40, 60, 80, 100, 120, 150, 200, 250, 300, 400] },
    { org: 'Un marketplace predice la categoría de cada búsqueda de texto para filtrar los resultados', model: 'un clasificador de texto', gpu: 'L4', gpuTxt: 'L4 (g6.xlarge, ≈ US$0.805/h, aprox.)', price: L4H, T: 1500, hs: [[0.45, 0.65, 0.82], [0.4, 0.62, 0.8], [0.5, 0.7, 0.85]], Fh: 48, Ftxt: '48 h', why: 'el modelo también mira el catálogo del día, y una búsqueda puede cambiar de categoría cuando cambia lo que se vende', bytes: 150, Vs: [80, 100, 150, 200, 250, 300, 400, 500, 600] },
    { org: 'Un servicio de validación de direcciones que usan muchas tiendas online normaliza y geocodifica cada dirección que se escribe en el checkout', model: 'un modelo seq2seq de direcciones', gpu: 'T4', gpuTxt: 'T4 (g4dn.xlarge, ≈ US$0.526/h, aprox.)', price: T4H, T: 400, hs: [[0.4, 0.6, 0.85], [0.45, 0.65, 0.88], [0.35, 0.58, 0.82]], Fh: 168, Ftxt: '7 días', why: 'una corrección en la base de calles puede tardar hasta 7 días en verse', bytes: 300, Vs: [15, 20, 25, 30, 40, 50, 60, 80, 100, 120] },
  ];

  // hib-03: [contexto, casos, quién revisa, casos al día por persona, umbrales (% que decide el modelo y % de error en lo
  // que decide), costo de un error automático, volúmenes al día, personas en el equipo]
  const HIB03 = [
    { org: 'Una aseguradora paga automáticamente los siniestros de auto chicos que su modelo da por buenos', what: 'siniestros', who: 'personas ajustadoras', r: 40, a: [50, 70, 85], e: [0.4, 1, 2.5], L: 350, Ltxt: 'sobrepago promedio', Vs: [3000, 5000, 8000, 12000], ppl: [30, 45, 60, 90, 120], en: 'claims' },
    { org: 'Una fintech aprueba automáticamente los préstamos personales que su modelo ve seguros', what: 'solicitudes', who: 'analistas de crédito', r: 60, a: [55, 72, 88], e: [0.5, 1.2, 3], L: 600, Ltxt: 'pérdida esperada de un préstamo malo aprobado', Vs: [4000, 6000, 10000, 15000], ppl: [30, 45, 60, 90, 120], en: 'loan applications' },
    { org: 'Un marketplace reembolsa automáticamente las devoluciones que su modelo ve legítimas', what: 'devoluciones', who: 'agentes de soporte', r: 150, a: [60, 80, 92], e: [0.3, 0.9, 2.2], L: 45, Ltxt: 'reembolso indebido promedio', Vs: [40000, 60000, 100000, 150000], ppl: [40, 60, 90, 120, 180], en: 'returns' },
    { org: 'Un programa público de subsidios aprueba automáticamente las solicitudes que su modelo ve completas y elegibles', what: 'solicitudes', who: 'personas funcionarias', r: 50, a: [45, 65, 85], e: [0.3, 0.8, 2], L: 200, Ltxt: 'pago indebido promedio', Vs: [5000, 10000, 20000, 30000], ppl: [40, 60, 90, 120, 180], en: 'applications' },
  ];

  // hib-04: [contexto, dos features candidatas a streaming (ventanas de 24 h o 7 días: keys con estado y bytes por key),
  // las históricas, volúmenes al día y eventos por unidad]
  const HIB04 = [
    {
      org: 'Una app de delivery de comida estima el tiempo de entrega antes de confirmar cada pedido, con un modelo online (un GBDT en CPU) dentro del request', target: 'el error del tiempo estimado',
      A: { name: 'pedidos que canceló el restaurante en las últimas 24 h', short: 'las cancelaciones del restaurante', keys: [100e3, 200e3, 400e3], kTxt: (n) => `${f(n / 1000)}k restaurantes`, bytes: 120 },
      B: { name: 'entregas tardías de la zona en las últimas 24 h', short: 'las entregas tardías de la zona', keys: [4000, 8000, 12000], kTxt: (n) => `${f(n)} zonas`, bytes: 200 },
      slow: 'tiempo medio de preparación del restaurante en 30 días y velocidad típica de la zona por hora en 90 días',
      vols: [5, 10, 20, 40], per: 6,
      evTxt: (v) => `cada pedido genera 6 eventos (creado, aceptado, listo, recogido, entregado y calificado), con <b>${f(v)} M de pedidos al día</b> y un pico 3× el promedio`,
      en: 'restaurant-cancellation', enB: 'late-delivery',
    },
    {
      org: 'Una billetera digital revisa cada recarga con un chequeo de fraude liviano: un modelo online la aprueba o la frena dentro del request', target: 'el fraude que se escapa',
      A: { name: 'recargas de la cuenta en las últimas 24 h', short: 'las recargas de la cuenta', keys: [4e6, 8e6, 15e6], kTxt: (n) => `${f(n / 1e6)} M de cuentas`, bytes: 100 },
      B: { name: 'cuentas distintas que usaron el mismo dispositivo en los últimos 7 días', short: 'las cuentas por dispositivo', keys: [6e6, 12e6, 20e6], kTxt: (n) => `${f(n / 1e6)} M de dispositivos`, bytes: 150 },
      slow: 'antigüedad de la cuenta y contracargos del comercio en 90 días',
      vols: [20, 40, 80, 150], per: 2,
      evTxt: (v) => `cada transacción genera 2 eventos (solicitud y resultado), con <b>${f(v)} M de transacciones al día</b> y un pico 3× el promedio`,
      en: 'top-up', enB: 'accounts-per-device',
    },
    {
      org: 'Una app de viajes predice si cada conductor va a aceptar el viaje que se le ofrece, con un modelo online dentro del request de asignación', target: 'el error de la predicción',
      A: { name: 'viajes que rechazó el conductor en las últimas 24 h', short: 'los rechazos del conductor', keys: [0.5e6, 1e6, 2e6], kTxt: (n) => `${f(n / 1e6)} M de conductores`, bytes: 100 },
      B: { name: 'solicitudes de viaje de la zona en las últimas 24 h', short: 'la demanda de la zona', keys: [5000, 10000, 20000], kTxt: (n) => `${f(n)} zonas`, bytes: 150 },
      slow: 'tasa de aceptación histórica del conductor en 90 días y tiempo típico entre zonas por hora en 8 semanas',
      vols: [20, 40, 80, 120], per: 2,
      evTxt: (v) => `cada oferta de viaje a un conductor genera 2 eventos (ofrecida y respondida), con <b>${f(v)} M de ofertas al día</b> y un pico 3× el promedio`,
      en: 'driver-rejection', enB: 'zone-demand',
    },
  ];

  B.formulas.push(
    { topic: 'hibrido', title: 'Candidatos en batch + re-rank online', expr: 'tabla = personas × K × bytes por ítem · re-rank online = K × costo por ítem (puntuar todo el catálogo no cabe en el request)', ex: '10 M × 500 × 12 B = 60 GB · 500 × 20 µs = 10 ms, contra 60 M × 20 µs = 1,200 s para el catálogo entero' },
    { topic: 'hibrido', title: 'Caché delante del modelo', expr: 'al modelo = pico × (1 − hit rate) · la caché vale por las GPUs que deja quitar · keys vivas = misses/s del pico × TTL (con TTL de un día: los misses del día)', ex: '7,000 req/s con 65 % de hits → 2,450 al modelo · 1,000 misses/s en el pico × 3,600 s = 3.6 M keys × 200 B = 0.72 GB' },
    { topic: 'hibrido', title: 'Camino rápido y camino lento', expr: 'al lento = volumen × (1 − fracción automática), que tiene que caber en la capacidad · pérdida = 30 × volumen × automática × error × costo por error', ex: '8,000 al día con 70 % automático → 2,400 a revisión · 30 × 8,000 × 0.7 × 1 % × US$350 ≈ US$588k/mes' },
    { topic: 'hibrido', title: 'Features por streaming', expr: 'streaming si la frescura pedida es menor que el atraso del batch · estado = keys × bytes · consumidores = ⌈eventos/s ÷ (1,500 × 0.7)⌉', ex: 'batch cada hora que tarda 20 min: hasta 80 min de atraso · 8 M cuentas × 100 B = 800 MB · ⌈5,556 ÷ 1,050⌉ = 6' },
  );

  B.templates.push(
    // ======================================================== CANDIDATOS + RE-RANK
    {
      id: 'hib-01', topic: 'hibrido', level: 1, title: 'Precomputar candidatos y rankear online', ref: 'c08.arquitectura',
      gen(r) {
        const st = r.pick(HIB01);
        const s = r.pick(st.ss);
        const K = r.pick(st.Ks);
        const U = r.pick(st.Us);
        const R = r.pick(st.Rs);
        // Frescura que acepta producto: más estricta que el batch (≈ 28 h) o más laxa, con margen.
        const fresh = r.pick([['1 min', 'a minute'], ['5 min', 'five minutes'], ['15 min', 'fifteen minutes'], ['36 h', '36 hours'], ['2 días', 'two days'], ['3 días', 'three days']]);
        const hyb = /min$/.test(fresh[0]);
        const cat = (st.C * s) / 1e6;        // s para puntuar todo el catálogo
        const rr = (K * s) / 1000;           // ms del re-rank de K
        const gb = (U * 1e6 * K * 12) / 1e9;
        const HY = 'Batch de candidatos + re-rank online con lo que hizo la persona';
        const BA = 'Batch con lookup: la lista de anoche, sin cómputo en el request';
        const ON = 'Online: puntuar todo el catálogo en cada visita';
        const ST = 'Streaming: re-puntuar todo el catálogo con cada evento';
        const choices = r.shuffle([HY, BA, ON, ST]);
        const say1 = hyb
          ? `Scoring all ${st.en} per request would take about ${say(cat)} seconds and last night's list can't see this session, so a nightly batch picks ${K} candidates per user and an online ranker re-ranks them in about ${f(rr)} milliseconds.`
          : `Product is fine with ${fresh[1]} of staleness, so a nightly batch writes each user's list and the home does a key-value lookup; no model runs in the request.`;
        return {
          q: `${st.org}: <b>${f(U)} M de personas activas al mes</b> y un catálogo de <b>${st.Ctxt}</b>. El ranker cuesta ≈ <b>${s} µs por ${st.item}</b> en CPU (medido) y tiene ≈ <b>${R} ms</b> del SLO de la home. Un batch nocturno puede guardar <b>${f(K)} ${st.items} por persona</b> (id + score: ≈ 12 B cada uno); lo que sirve puede tener hasta ≈ <b>28 h</b>. <b>Requisito:</b> la home puede ir hasta <b>${fresh[0]}</b> atrás de lo que hizo la persona.`,
          parts: [
            {
              ask: 'Tiempo de puntuar todo el catálogo en un solo request', unit: 's', answer: cat, tol: 0.15,
              steps: [
                'Planteamiento: tiempo = ítems del catálogo × costo por ítem.',
                `${st.Ctxt} × ${s} µs ≈ <b>${f(cat)} s</b>`,
                `Contra ≈ ${R} ms de presupuesto: ≈ ${say((cat * 1000) / R)}× más.`,
              ],
            },
            {
              ask: '¿Qué diseño usas?', choices, answer: choices.indexOf(hyb ? HY : BA),
              steps: [
                'Planteamiento: compara la frescura que pide producto con la que da el batch, y lo que cuesta el cómputo con lo que cabe en el request.',
                hyb
                  ? `El batch da hasta ≈ 28 h de atraso y producto acepta ${fresh[0]}: hace falta algo en el request. Puntuar todo no cabe (la parte anterior), pero re-rankear los ${f(K)} candidatos sí: ${f(K)} × ${s} µs = ${f(rr)} ms de los ${R}. <b>Híbrido</b>: lo caro (elegir candidatos) va al batch; lo que depende del momento, al request.`
                  : `Producto acepta ${fresh[0]} de atraso y el batch da hasta ≈ 28 h: la lista de anoche alcanza. <b>Batch con lookup</b>: el request solo lee la lista, en ms. Un re-rank online costaría ${f(rr)} ms de CPU en cada visita sin que producto lo pida.`,
                'Puntuar todo el catálogo en cada visita no cabe en el presupuesto (la parte anterior), y re-puntuarlo con cada evento es el mismo problema multiplicado por los eventos.',
              ],
            },
            {
              ask: 'Tamaño de la tabla que escribe el batch cada noche', unit: 'GB', answer: gb, tol: 0.15,
              steps: [
                'Planteamiento: personas × ítems por persona × bytes por ítem.',
                `${f(U)} M × ${f(K)} × 12 B ≈ <b>${f(gb)} GB</b>`,
                gb > 25
                  ? 'Pide un cluster de Redis de varios nodos, o DynamoDB. Se publica cada noche como una tabla nueva y se cambia de golpe (swap atómico), así nunca se lee una mezcla de dos corridas.'
                  : 'Cabe en un nodo de Redis o en una tabla de DynamoDB. Igual se publica como una tabla nueva y se cambia de golpe (swap atómico), así nunca se lee una mezcla de dos corridas.',
              ],
            },
          ],
          hint: 'Primero: ¿cuánto tarda puntuar todo el catálogo (ítems × costo por ítem) contra el presupuesto? Después compara la frescura que pide producto con la del batch: si el batch alcanza, lookup; si no, candidatos en batch y re-rank en el request. La tabla pesa personas × ítems por persona × bytes.',
          takeaway: hyb
            ? `<b>Requisito:</b> la home puede ir hasta ${fresh[0]} atrás, y el batch da ≈ 28 h. <b>Decisión:</b> batch de ${f(K)} candidatos por persona + re-rank online (${f(rr)} ms de los ${R}). <b>Por qué:</b> puntuar el catálogo entero (≈ ${say(cat)} s) no cabe en el request, y la lista de anoche no ve la sesión. <b>Tamaño:</b> ≈ ${say(gb)} GB de candidatos. <b>Trade-off:</b> dos sistemas que mantener consistentes (features y versiones) a cambio de frescura de sesión. <i>"${say1}"</i>`
            : `<b>Requisito:</b> la home puede ir hasta ${fresh[0]} atrás, y el batch da ≈ 28 h. <b>Decisión:</b> batch nocturno + lookup. <b>Por qué:</b> la lista de anoche cumple la frescura y el request no paga cómputo. <b>Tamaño:</b> ≈ ${say(gb)} GB por noche. <b>Cuándo cambia:</b> si producto pidiera reaccionar a la sesión, el mismo batch pasa a dar candidatos y se agrega un re-rank online de ≈ ${f(rr)} ms. <i>"${say1}"</i>`,
        };
      },
    },

    // ======================================================== CACHÉ DELANTE DEL MODELO
    {
      id: 'hib-02', topic: 'hibrido', level: 2, title: 'Caché delante del modelo', ref: 'm02.hibridos',
      gen(r) {
        // Redis con réplica: 2 × cache.r7g.large, ≈ US$0.18/h cada uno (aprox., como en Streaming) ≈ US$263/mes; útiles
        // ≈ 10.5 GB por nodo (13.07 GiB × 75 %, la reserva de c09). La réplica duplica los datos: no suma memoria.
        const REDIS = 2 * 0.18 * MES_H;
        const USEFUL = 10.5;
        const TTL = [300, 3600, 86400];
        const TTLtxt = ['5 min', '1 h', '24 h'];
        const TTLen = ['five-minute', 'one-hour', '24-hour'];
        const BUD = [];   // US$1,000–30,000 en pasos redondos
        for (let b = 1000; b <= 30000; b += b < 5000 ? 250 : b < 10000 ? 500 : 1000) BUD.push(b);
        const costs = (st, hs, P) => {
          const n0 = ceilx(P / st.T) + 1;
          const n = hs.map((h) => ceilx((P * (1 - h)) / st.T) + 1);
          return { n0, n, c0: n0 * st.price * MES_H, c: n.map((x) => x * st.price * MES_H + REDIS) };
        };
        // Keys vivas = misses de la última ventana de TTL: con 5 min o 1 h, los del pico (el pico dura más que el TTL);
        // con 24 h, los del día entero (el promedio).
        const memGB = (st, h, V, j) => (((V * 1e6) / DAY) * (j < 2 ? 3 : 1) * (1 - h) * TTL[j] * st.bytes) / 1e9;
        // Gana el TTL más corto (lo más fresco) que entra en el presupuesto con ≥ 10 % de margen, sin pasar la antigüedad
        // máxima; todo lo más fresco (incluido no cachear) se pasa del presupuesto por ≥ 10 %.
        const k = r.pick([0, 1, 2]);
        const combos = [];
        HIB02.forEach((st) => {
          if (TTL[k] / 3600 > st.Fh) return;
          const mineSt = [];
          combos.push(mineSt);
          st.hs.forEach((hs) => st.Vs.forEach((V) => {
            const P = ((V * 1e6) / DAY) * 3;
            if (!far(P / st.T, 0.05) || hs.some((h) => !far((P * (1 - h)) / st.T, 0.05))) return;
            // Los conteos no cambian si la persona redondea el pico a 3 cifras.
            const P3 = Number(P.toPrecision(3));
            if ([0].concat(hs).some((h) => ceilx((P3 * (1 - h)) / st.T) !== ceilx((P * (1 - h)) / st.T))) return;
            const x = costs(st, hs, P);
            // La caché con el TTL que gana tiene que entrar en el cluster (≤ 90 % de los GB útiles).
            if (memGB(st, hs[k], V, k) > 0.9 * USEFUL) return;
            BUD.forEach((Bu) => {
              if (x.c[k] > 0.9 * Bu || x.c0 < 1.1 * Bu) return;
              for (let j = 0; j < k; j++) if (x.c[j] < 1.1 * Bu) return;
              mineSt.push([st, hs, V, Bu]);
            });
          }));
        });
        // Resultado, después historia (las que lo pueden dar) y después los números: las historias salen parejas.
        const [st, hs, V, Bu] = r.pick(r.pick(combos.filter((x) => x.length)));
        const avg = (V * 1e6) / DAY;
        const P = avg * 3;
        const x = costs(st, hs, P);
        const h = hs[k];
        const mem = memGB(st, h, V, k);
        const keys = (mem * 1e9) / st.bytes;
        const names = ['Sin caché: el modelo en cada request'].concat(TTLtxt.map((t) => `Caché con TTL de ${t}`));
        const choices = r.shuffle(names.slice());
        const priceTxt = st.price === T4H ? '0.526' : '0.805';
        return {
          q: `${st.org}. El modelo, ${st.model}, corre en ${st.gpuTxt}: ≈ <b>${f(V)} M de requests al día</b>, con un pico de 3× el promedio. Cada GPU sostiene ≈ <b>${f(st.T)} req/s</b> planificados (medido) y la flota lleva <b>N+1</b>. Presupuesto: <b>US$${f(Bu)}/mes</b> para GPUs y caché. Muchos requests se repiten: con una caché por hash del input y versión del modelo, los logs dan un hit rate de <b>${f(hs[0] * 100, 0)} %</b> con TTL de 5 min, <b>${f(hs[1] * 100, 0)} %</b> con 1 h y <b>${f(hs[2] * 100, 0)} %</b> con 24 h (medido). Una respuesta puede tener como máximo <b>${st.Ftxt}</b> (${st.why}), y producto prefiere lo más fresco que entre en el presupuesto. Redis con réplica (2 × cache.r7g.large, aprox.): ≈ US$${f(REDIS)}/mes y ≈ ${f(USEFUL)} GB útiles; ≈ ${st.bytes} B por entrada (supuesto).`,
          parts: [
            {
              ask: 'GPUs sin caché (pico, N+1)', unit: 'GPUs', answer: x.n0, tol: 0,
              steps: [
                'Planteamiento: pico = volumen diario ÷ 86,400 × 3; GPUs = ⌈pico ÷ req/s planificados⌉ + 1.',
                `${f(V)} M ÷ 86,400 × 3 ≈ ${f(P)} req/s → ⌈${f(P)} ÷ ${f(st.T)}⌉ = ⌈${f(P / st.T, 2)}⌉ = ${x.n0 - 1}; + 1 = <b>${x.n0} ${st.gpu}</b>`,
              ],
            },
            {
              ask: 'GPUs con caché y TTL de 5 min (N+1)', unit: 'GPUs', answer: x.n[0], tol: 0,
              steps: [
                'Planteamiento: con caché, al modelo solo llegan los misses: pico × (1 − hit rate).',
                `${f(P)} × (1 − ${hs[0]}) ≈ ${f(P * (1 - hs[0]))} req/s → ⌈${f((P * (1 - hs[0])) / st.T, 2)}⌉ = ${x.n[0] - 1}; + 1 = <b>${x.n[0]} ${st.gpu}</b>`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(names[k + 1]),
              steps: [
                'Planteamiento: la opción más fresca que entra en el presupuesto, sin pasar la antigüedad máxima. Costo = GPUs × US$/h × 730 + Redis.',
                `Sin caché: ${x.n0} GPUs ≈ US$${f(x.c0)}. TTL de 5 min: ${x.n[0]} GPUs + Redis ≈ US$${f(x.c[0])}. TTL de 1 h: ${x.n[1]} GPUs (${f(P)} × ${f(1 - hs[1], 2)} ÷ ${f(st.T)}, + 1) ≈ US$${f(x.c[1])}. TTL de 24 h: ${x.n[2]} GPUs ≈ US$${f(x.c[2])}${st.Fh < 24 ? ', pero pasa la antigüedad máxima de ' + st.Ftxt : ''}.`,
                `Con US$${f(Bu)}/mes, lo más fresco que entra es la <b>caché con TTL de ${TTLtxt[k]}</b>${k > 0 ? ': todo lo más fresco se pasa del presupuesto' : ''}.`,
                'La key lleva el hash del input y la versión del modelo: un deploy invalida todo sin esperar el TTL (M2). Y nunca se cachea el fallback ni un error.',
              ],
            },
            {
              ask: k < 2 ? 'Memoria de la caché con tu elección, en el pico (el pico dura más que el TTL)' : 'Memoria de la caché con tu elección (con TTL de 24 h, una key vive el día entero)', unit: 'GB', answer: mem, tol: 0.15,
              steps: [
                'Planteamiento: cada miss escribe una key que vive un TTL, así que las keys vivas son los misses de la última ventana de TTL; memoria = keys × bytes por entrada.',
                k < 2
                  ? `Con TTL de ${TTLtxt[k]}, los misses del pico: ${f(P)} req/s × (1 − ${h}) × ${f(TTL[k])} s ≈ ${say(keys)} keys × ${st.bytes} B ≈ <b>${f(mem)} GB</b>. Con el promedio saldría 3× menos, y la caché se quedaría corta justo en el pico.`
                  : `Con TTL de 24 h, los misses del día entero: ${f(V)} M × (1 − ${h}) ≈ ${say(keys)} keys × ${st.bytes} B ≈ <b>${f(mem)} GB</b>. Aquí cuenta el promedio: la ventana cubre el día, con su pico y su valle.`,
                `${f((mem / USEFUL) * 100, 0)} % de los ≈ ${f(USEFUL)} GB útiles: el cluster alcanza. La memoria crece con el TTL; el ahorro de GPUs, con el hit rate.`,
              ],
            },
          ],
          hint: 'La caché vale por las GPUs que deja quitar: GPUs = ⌈pico × (1 − hit rate) ÷ capacidad⌉ + 1, más el costo de Redis. Ordena las opciones de la más fresca a la más vieja y quédate con la primera que entra en el presupuesto sin pasar la antigüedad máxima. La memoria: keys vivas (los misses de una ventana de TTL: del pico si el TTL es corto, del día entero con 24 h) × bytes.',
          takeaway: `<b>Requisito:</b> ≈ ${f(P)} req/s de pico, US$${f(Bu)}/mes y respuestas de hasta ${st.Ftxt}. <b>Decisión:</b> caché con TTL de ${TTLtxt[k]}: ${x.n[k]} GPUs + Redis ≈ US$${say(x.c[k])}/mes, contra ${x.n0} GPUs sin caché (≈ US$${say(x.c0)}). <b>Por qué:</b> la caché se mide por las GPUs que quita, no por el hit rate; y entre lo que entra, lo más fresco. <b>Trade-off:</b> un TTL más largo ahorra más GPUs y sirve respuestas más viejas; la versión del modelo en la key evita servir predicciones de un modelo anterior. <i>"A ${TTLen[k]} TTL is the freshest option that fits the budget: it cuts the fleet from ${x.n0} to ${x.n[k]} GPUs, and the model version is part of the cache key."</i>`,
        };
      },
    },

    // ======================================================== CAMINO RÁPIDO Y LENTO
    {
      id: 'hib-03', topic: 'hibrido', level: 2, title: 'Camino rápido y camino lento', ref: 'c06.arquitectura',
      gen(r) {
        const RB = [50e3, 75e3, 100e3, 150e3, 200e3, 250e3, 300e3, 400e3, 500e3, 600e3, 750e3, 1e6, 1.25e6, 1.5e6, 2e6, 2.5e6, 3e6, 4e6];
        // Umbral que gana: el más conservador cuyo camino lento cabe en la capacidad (≥ 10 % de margen) y cuya pérdida
        // entra en el presupuesto de riesgo (≥ 10 %); si la pérdida no entra, o ningún umbral cabe, hay que ampliar el
        // equipo. Resultado primero: cada uno sale un cuarto de las veces.
        const out = r.pick([0, 1, 2, 3]);
        const combos = HIB03.map(() => []);
        HIB03.forEach((st, si) => st.Vs.forEach((V) => st.ppl.forEach((pp) => RB.forEach((rb) => {
          const cap = pp * st.r;
          const slow = st.a.map((a) => V * (1 - a / 100));
          if (slow.some((x) => x > 0.9 * cap && x < 1.1 * cap)) return;
          const t = slow.findIndex((x) => x <= 0.9 * cap);
          // El presupuesto de riesgo, en el orden de magnitud de la pérdida que decide (entre ¼× y 4×).
          const ref = 30 * V * (st.a[t < 0 ? 2 : t] / 100) * (st.e[t < 0 ? 2 : t] / 100) * st.L;
          if (rb < ref / 4 || rb > ref * 4) return;
          let o;
          if (t < 0) o = 3;
          else if (ref <= 0.9 * rb) o = t;
          else if (ref >= 1.1 * rb) o = 3;
          else return;
          if (o === out) combos[si].push([st, V, pp, rb]);
        }))));
        const [st, V, pp, rb] = r.pick(r.pick(combos.filter((x) => x.length)));
        const cap = pp * st.r;
        const slow = st.a.map((a) => V * (1 - a / 100));
        const loss = st.a.map((a, i) => 30 * V * (a / 100) * (st.e[i] / 100) * st.L);
        const t = slow.findIndex((x) => x <= cap);
        const okj = loss.findIndex((x) => x <= rb);   // el umbral más conservador que entra en el riesgo
        const nm = ['conservador', 'medio', 'agresivo'];
        const names = [`Conservador: el modelo decide el ${st.a[0]} %`, `Medio: decide el ${st.a[1]} %`, `Agresivo: decide el ${st.a[2]} %`, 'Ninguno alcanza: ampliar el equipo de revisión o renegociar el presupuesto de riesgo'];
        const choices = r.shuffle(names.slice());
        const decide = out < 3
          ? `Gana el umbral <b>${nm[out]}</b>: es el más conservador que el equipo alcanza a revisar${out > 0 ? ' (los más conservadores llenan la cola)' : ''}, y su pérdida (≈ US$${f(loss[out])}) entra en el presupuesto de riesgo.`
          : t < 0
            ? '<b>Ninguno alcanza</b>: ni con el umbral agresivo cabe el camino lento en la capacidad del equipo. Hay que ampliar el equipo antes de lanzar, o el backlog crece todos los días.'
            : `<b>Ninguno alcanza</b>: el más conservador que el equipo alcanza a revisar es el ${nm[t]}, pero pierde ≈ US$${f(loss[t])}/mes contra US$${f(rb)}. ${okj >= 0 ? 'El ' + nm[okj] + ' sí entraría en el presupuesto, pero manda ' + f(slow[okj]) + ' casos al día a revisión: hay que ampliar el equipo antes de bajarlo.' : 'Ni el conservador entra en el presupuesto de riesgo: hay que renegociarlo con estos números, o mejorar el modelo.'}`;
        const say1 = out < 3
          ? `Our ${f(pp)} reviewers can handle ${f(cap)} ${st.en} a day, so the most conservative threshold that fits is the ${['conservative', 'medium', 'aggressive'][out]} one, and its expected loss stays inside the risk budget.`
          : `With ${f(pp)} reviewers no threshold meets both capacity and the risk budget, so we either grow the review team or renegotiate the risk budget before launch.`;
        return {
          q: `${st.org}: un modelo rápido decide dentro del request, en ≈ 100 ms, y lo que no decide va a una cola de revisión (respuesta en ≤ 48 h). Llegan ≈ <b>${f(V)} ${st.what} al día</b>. El equipo de revisión tiene <b>${pp} ${st.who}</b>, y cada persona revisa ≈ <b>${st.r} casos al día</b> (medido). Umbrales posibles (medidos en un backtest): <ul><li>Conservador: el modelo decide el <b>${st.a[0]} %</b>, con <b>${f(st.e[0])} %</b> de error en lo que decide.</li><li>Medio: decide el <b>${st.a[1]} %</b>, con <b>${f(st.e[1])} %</b> de error.</li><li>Agresivo: decide el <b>${st.a[2]} %</b>, con <b>${f(st.e[2])} %</b> de error.</li></ul>Cada error automático cuesta ≈ <b>US$${st.L}</b> (${st.Ltxt}, supuesto). Presupuesto de riesgo: <b>US$${f(rb)}/mes</b> de pérdida por errores automáticos. Producto quiere el umbral más conservador posible: menos errores automáticos.`,
          parts: [
            {
              ask: 'Capacidad del equipo: casos al día que alcanza a revisar', unit: 'casos/día', answer: cap, tol: 0.05,
              steps: [
                'Planteamiento: capacidad = personas × casos por persona al día.',
                `${pp} × ${st.r} = <b>${f(cap)} casos/día</b>`,
              ],
            },
            {
              ask: 'Casos al día que van al camino lento con el umbral medio', unit: 'casos/día', answer: slow[1], tol: 0.05,
              steps: [
                'Planteamiento: al camino lento va lo que el modelo no decide: volumen × (1 − fracción automática).',
                `${f(V)} × (1 − ${f(st.a[1] / 100, 2)}) = <b>${f(slow[1])} casos/día</b>`,
              ],
            },
            {
              ask: 'Pérdida mensual por errores automáticos con el umbral medio (30 días)', unit: 'US$/mes', answer: loss[1], tol: 0.15,
              steps: [
                'Planteamiento: pérdida = 30 días × volumen × fracción automática × error × costo por error.',
                `30 × ${f(V)} × ${f(st.a[1] / 100, 2)} × ${f(st.e[1] / 100, 3)} × US$${st.L} ≈ <b>US$${f(loss[1])}/mes</b>`,
              ],
            },
            {
              ask: '¿Qué umbral pones?', choices, answer: choices.indexOf(names[out]),
              steps: [
                'Planteamiento: el umbral más conservador cuyo camino lento cabe en la capacidad del equipo; después, que su pérdida entre en el presupuesto de riesgo.',
                `Camino lento: conservador ${f(slow[0])}, medio ${f(slow[1])} y agresivo ${f(slow[2])} casos/día, contra ${f(cap)} de capacidad. Pérdida al mes: conservador ≈ US$${f(loss[0])}, medio ≈ US$${f(loss[1])} y agresivo ≈ US$${f(loss[2])}, contra US$${f(rb)} de presupuesto.`,
                decide,
                'Un umbral más agresivo de lo necesario regala errores automáticos; uno más conservador de lo que el equipo alcanza llena la cola: el backlog crece cada día y el SLA de 48 h se rompe.',
              ],
            },
          ],
          hint: 'Dos caminos, dos límites: lo que va al camino lento (volumen × fracción que el modelo no decide) tiene que caber en la capacidad del equipo (personas × casos por persona), y la pérdida del camino rápido (30 × volumen × fracción automática × error × costo por error) tiene que entrar en el presupuesto de riesgo. Entre los umbrales que cumplen, el más conservador.',
          takeaway: `<b>Requisito:</b> ${f(V)} ${st.what} al día, ${f(cap)} revisiones al día de capacidad y US$${f(rb)}/mes de riesgo. <b>Decisión:</b> ${out < 3 ? 'umbral ' + nm[out] + ': ' + f(slow[out]) + ' casos al día a revisión y ≈ US$' + say(loss[out]) + '/mes de pérdida' : 'ninguno alcanza: ampliar el equipo de revisión o renegociar el riesgo'}. <b>Por qué:</b> el umbral no se elige por F1: lo fijan la capacidad del camino lento y el costo de los errores del rápido. <b>Trade-off:</b> cada punto de automatización ahorra revisiones y suma errores automáticos; con más personas se puede bajar el umbral. <i>"${say1}"</i>`,
        };
      },
    },

    // ======================================================== FEATURES BATCH + STREAMING + MODELO ONLINE
    {
      id: 'hib-04', topic: 'hibrido', level: 3, title: 'Features batch + streaming + modelo online', ref: 'm02.streaming',
      gen(r) {
        const st = r.pick(HIB04);
        const out = r.pick(['A', 'B', 'AB']);
        const FAST = [[30, '30 s', '15 s'], [120, '2 min', '1 min'], [300, '5 min', '2.5 min'], [600, '10 min', '5 min']];
        const SLOW = [[7200, '2 h'], [14400, '4 h'], [21600, '6 h']];
        const fA = out === 'B' ? r.pick(SLOW) : r.pick(FAST);
        const fB = out === 'A' ? r.pick(SLOW) : r.pick(FAST);
        // Volúmenes cuyo cociente de consumidores no queda pegado a un entero.
        const rate = (v) => (v * 1e6 * st.per * 3) / DAY;
        const vol = r.pick(st.vols.filter((v) => far(rate(v) / 1050)));
        const ev = rate(vol);
        const kA = r.pick(st.A.keys);
        const kB = r.pick(st.B.keys);
        const mbA = (kA * st.A.bytes) / 1e6;
        const mbB = (kB * st.B.bytes) / 1e6;
        const mb = (out !== 'B' ? mbA : 0) + (out !== 'A' ? mbB : 0);
        const cons = ceilx(ev / 1050);
        const strm = [out !== 'B' ? fA : null, out !== 'A' ? fB : null].filter(Boolean);
        const tight = strm.reduce((m, x) => (x[0] < m[0] ? x : m));
        const names = [`Solo ${st.A.short}`, `Solo ${st.B.short}`, `${cap1(st.A.short)} y ${st.B.short}`, 'Las cuatro, también las históricas'];
        const ans = names[{ A: 0, B: 1, AB: 2 }[out]];
        const choices = r.shuffle(names.slice());
        const fbOk = `Alertar por el lag medido en tiempo (≈ ${tight[2]}, la mitad de la frescura más exigente) y, si una feature llega más vieja que su frescura, usar su valor batch o el default de training y marcar la predicción`;
        const fChoices = r.shuffle([fbOk,
          'Alertar por la CPU del procesador y, si se atrasa, esperar a que se ponga al día antes de responder',
          'Alertar por el número de mensajes pendientes y, si se atrasa, servir el último valor sin mirar su edad',
          'Sin alerta propia, porque Kafka no pierde eventos; si se atrasa, apagar el modelo hasta que se ponga al día']);
        const which = (x) => (x[0] < 4800 ? 'streaming' : 'batch');
        const nmOut = { A: st.A.short, B: st.B.short, AB: st.A.short + ' y ' + st.B.short }[out];
        const enOut = { A: st.en + ' feature', B: st.enB + ' feature', AB: st.en + ' and ' + st.enB + ' features' }[out];
        return {
          q: `${st.org}. Atraso máximo de cada feature sin que ${st.target} suba más de 2 % (medido):<ul><li>${cap1(st.A.name)}: <b>${fA[1]}</b>.</li><li>${cap1(st.B.name)}: <b>${fB[1]}</b>.</li><li>Las históricas, ${st.slow}: 1 día.</li></ul>El batch corre cada hora y tarda ≈ 20 min: hasta ≈ <b>80 min</b> de atraso. Eventos: ${st.evTxt(vol)}. Un consumidor del procesador (Flink) sostiene ≈ <b>1,500 eventos/s</b> (supuesto de M2) y se planea al 70 %. Estado si la feature va por streaming (supuesto): ${st.A.short}, <b>${st.A.kTxt(kA)} × ${st.A.bytes} B</b>; ${st.B.short}, <b>${st.B.kTxt(kB)} × ${st.B.bytes} B</b>.`,
          parts: [
            {
              ask: '¿Qué features van por streaming?', choices, answer: choices.indexOf(ans),
              steps: [
                'Planteamiento: va por streaming toda feature que necesite más frescura de la que da el batch (≈ 80 min de atraso); el resto, batch.',
                `${cap1(st.A.short)}: ${fA[1]} → ${which(fA)}. ${cap1(st.B.short)}: ${fB[1]} → ${which(fB)}. Las históricas (1 día) → batch.`,
                `Van por streaming: <b>${nmOut}</b>. Streaming para todo pagaría estado, checkpoints y operación por features que cambian una vez al día; y una feature de minutos en el batch horario llegaría hasta 80 min tarde, sin ningún error.`,
              ],
            },
            {
              ask: 'Eventos por segundo que entran al procesador en el pico', unit: 'eventos/s', answer: ev, tol: 0.15,
              steps: [
                'Planteamiento: eventos/s en el pico = volumen diario × eventos por unidad × factor de pico ÷ 86,400.',
                `${f(vol)} M × ${st.per} × 3 ÷ 86,400 ≈ <b>${f(ev)} eventos/s</b>`,
              ],
            },
            {
              ask: 'Estado de las features que van por streaming', unit: 'MB', answer: mb, tol: 0.15,
              steps: [
                'Planteamiento: estado = keys × bytes por key, sumado sobre las features que van por streaming.',
                out === 'AB'
                  ? `${st.A.kTxt(kA)} × ${st.A.bytes} B + ${st.B.kTxt(kB)} × ${st.B.bytes} B = ${f(mbA)} + ${f(mbB)} ≈ <b>${f(mb)} MB</b>`
                  : out === 'A'
                    ? `${st.A.kTxt(kA)} × ${st.A.bytes} B ≈ <b>${f(mb)} MB</b>`
                    : `${st.B.kTxt(kB)} × ${st.B.bytes} B ≈ <b>${f(mb)} MB</b>`,
                mb >= 1000
                  ? 'Con GB de estado, Flink lo guarda en RocksDB y hace checkpoints incrementales: el estado es parte del costo y del tiempo de recuperación.'
                  : 'Es poco estado: cabe en memoria del procesador, y un reproceso desde el log lo reconstruye en minutos.',
              ],
            },
            {
              ask: 'Consumidores para el pico (y particiones, como mínimo esas)', unit: 'consumidores', answer: cons, tol: 0,
              steps: [
                'Planteamiento: consumidores = ⌈eventos/s ÷ (1,500 × 0.7)⌉; el topic necesita al menos esas particiones, porque un grupo no usa más consumidores que particiones.',
                `Con el resultado de la segunda parte: ⌈${f(ev)} ÷ 1,050⌉ = ⌈${f(ev / 1050, 2)}⌉ = <b>${cons} consumidores</b>`,
                'Las particiones se planean con margen desde el inicio: agregarlas después cambia a qué partición va cada key y rompe el orden por key durante la transición (M2).',
              ],
            },
            {
              ask: '¿Qué alertas y qué hace el modelo si el stream se atrasa?', choices: fChoices, answer: fChoices.indexOf(fbOk),
              steps: [
                'Planteamiento: un stream atrasado no da errores: el modelo ve features viejas en silencio. La métrica de salud es el consumer lag en tiempo, y el modelo necesita una defensa por feature.',
                `La feature más exigente pide ${tight[1]}: alertar a ≈ ${tight[2]} de lag deja tiempo para escalar consumidores (hasta las particiones) antes de romper la frescura. Si igual se pasa, la feature se trata como faltante: valor batch o el default que usó training, con la predicción marcada.`,
                'Esperar al stream rompe el SLO del request; servir el último valor sin mirar su edad esconde el atraso; la CPU y el número de mensajes no dicen cuántos segundos de atraso tiene la feature; y Kafka no pierde eventos, pero eso no los vuelve frescos.',
              ],
            },
          ],
          hint: 'Compara la frescura que pide cada feature con el atraso máximo del batch: lo que necesita más frescura va por streaming. Eventos/s: volumen diario × eventos por unidad × factor de pico ÷ 86,400. Estado: keys × bytes de las features que van por streaming. Consumidores: eventos/s ÷ (capacidad por consumidor × la utilización planeada), hacia arriba. Y un stream atrasado no da errores: se mide el lag en tiempo.',
          takeaway: `<b>Requisito:</b> ${st.A.short} con ${fA[1]} y ${st.B.short} con ${fB[1]} de atraso máximo; el batch llega a 80 min. <b>Decisión:</b> streaming para ${nmOut}; batch para el resto; el modelo sigue síncrono. <b>Tamaño:</b> ≈ ${say(ev)} eventos/s, ${cons} consumidores y ≈ ${say(mb)} MB de estado. <b>Cómo falla:</b> en silencio: features viejas sin errores; por eso, alerta por lag en tiempo y fallback por feature al valor batch. <i>"Only the ${enOut} ${out === 'AB' ? 'need' : 'needs'} fresher data than the hourly batch can give, so ${out === 'AB' ? 'they come' : 'it comes'} from a streaming job with ${cons} consumers; I alert on consumer lag in seconds and fall back to the batch value when a feature is too old."</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
