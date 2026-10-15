/* Banco de problemas · Mini-casos por patrón · Streaming: inferencia y features sobre eventos: particiones, consumer lag, ventanas, frescura, eventos tardíos.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'streaming')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  // Duraciones en texto (10 s · 2 min · 1.5 h) y en inglés, para la frase de la entrevista.
  const dur = (min) => (min < 1 ? f(min * 60, 0) + ' s' : min < 60 ? f(min) + ' min' : f(min / 60) + ' h');
  const durEn = (min) => {
    if (min < 1) return f(min * 60, 0) + ' seconds';
    if (min < 60) return min === 1 ? 'one minute' : f(min) + ' minutes';
    return min === 60 ? 'one hour' : f(min / 60) + ' hours';
  };
  // Conteos grandes dichos en inglés: 10,800,000 → "11 million".
  const mil = (x) => (x >= 1e6 ? s2(x / 1e6) + ' million' : say(x));

  B.formulas.push(
    { topic: 'streaming', title: 'Consumidores y particiones', expr: 'consumidores = ⌈pico ÷ eventos/s por consumidor⌉ · particiones ≥ consumidores del pico futuro (un consumidor de más queda ocioso)', ex: '18,000 ÷ 2,500 = 7.2 → 8 consumidores · para 54,000 en un año: ⌈21.6⌉ = 22 particiones' },
    { topic: 'streaming', title: 'Frescura de cada patrón', expr: 'batch o micro-batch: atraso máximo = intervalo + duración de la corrida · ventana por event time: edad máxima = largo de la ventana + watermark + proceso', ex: 'cada 30 min y tarda 10 → hasta 40 min · ventana de 5 min y watermark de 1 min → ≈ 6 min' },
    { topic: 'streaming', title: 'Estado de una ventana', expr: 'estado = keys activas × (ventana ÷ largo del bucket) × bytes por bucket · nodos = ⌈estado ÷ GB útiles por nodo⌉ × copias', ex: '10 M cuentas × 60 buckets × 64 B ≈ 38.4 GB → ⌈38.4 ÷ 10.5⌉ × 2 = 8 nodos' },
    { topic: 'streaming', title: 'Lag y recuperación', expr: 'lag = llegada × duración de la caída · ponerse al día = lag ÷ (consumidores × eventos/s por consumidor − llegada) · consumidores ≤ particiones', ex: '6,000 ev/s × 600 s = 3.6 M · ÷ (5 × 1,500 − 6,000) = 2,400 s = 40 min; con 12 consumidores, 5 min' },
  );

  B.templates.push(
    {
      id: 'str-01', topic: 'streaming', level: 1, title: 'Particiones y consumidores', ref: 'm02.tabla-decision',
      gen(r) {
        // [quién, qué eventos, qué calcula, quién lo necesita en segundos, quién lo usa con horas; en inglés: qué, y los dos usuarios]
        const sc = r.pick([
          ['Una app de ride-hailing', 'los pings de ubicación de los conductores', 'la demanda de viajes por zona', 'el servicio de precio dinámico', 'el equipo de incentivos', 'zone demand', 'Dynamic pricing', 'The incentives team'],
          ['Una distribuidora eléctrica', 'las lecturas de sus medidores inteligentes', 'la carga de cada transformador', 'el sistema que detecta sobrecargas', 'el equipo de mantenimiento', 'transformer load', 'The overload detector', 'Maintenance planning'],
          ['Una tienda online', 'los clicks y las vistas de producto', 'la popularidad de cada producto', 'el ranking de la home', 'el equipo de compras', 'product popularity', 'The home ranking', 'The buying team'],
          ['Una operadora móvil', 'los eventos de red de sus antenas', 'la congestión de cada celda', 'el sistema que reasigna capacidad', 'el equipo de planificación de red', 'cell congestion', 'The capacity rebalancer', 'Network planning'],
        ]);
        const fast = r.pick([true, false]);   // el requisito que decide el patrón: se elige primero, así cada uno sale la mitad de las veces
        // [pico, eventos/s por consumidor, crecimiento en un año]: entre 3 y 30 consumidores y cocientes lejos de un entero.
        const trios = [];
        [6000, 7500, 9000, 11000, 14000, 16000, 18000, 21000, 24000, 27000, 32000, 36000, 40000, 45000].forEach((p) => [1200, 1500, 2000, 2500, 3000].forEach((c) => [2, 3].forEach((gr) => {
          const x = p / c;
          if (x > 2 && x < 30 && far(x) && far(gr * x)) trios.push([p, c, gr]);
        })));
        const t = r.pick(trios);
        const P = t[0];
        const c = t[1];
        const P2 = P * t[2];
        const n = ceilx(P / c);
        const m = ceilx(P2 / c);
        // El job batch: corre cada C min y tarda D (como mucho la mitad del intervalo).
        const cd = r.pick([[15, 5], [20, 5], [20, 8], [30, 5], [30, 10], [30, 15], [60, 10], [60, 15], [60, 20]]);
        const C = cd[0];
        const D = cd[1];
        const S = C + D;
        // Lo que se tolera: segundos (menos que una sola corrida del batch) u horas (≥ 10 % por encima del peor atraso del batch).
        const F = fast ? r.pick([1 / 6, 0.25, 0.5, 1, 2]) : r.pick([30, 45, 60, 90, 120, 180, 240].filter((x) => x >= 1.1 * S));
        const user = fast ? sc[3] : sc[4];
        const okS = 'Streaming: un grupo de consumidores sobre Kafka, siempre encendido';
        const okB = 'Batch: un job cada ' + C + ' min sobre el data lake';
        const choices = r.shuffle([okS, okB, 'Batch nocturno: una corrida al día, que es lo más barato', 'Online síncrono: que cada productor llame al modelo y espere la respuesta']);
        const say1 = fast
          ? `${sc[6]} needs ${sc[5]} within ${durEn(F)}, and the batch can be ${S} minutes behind, so this is streaming: ${n} consumers today, on a topic with ${m} partitions for next year's peak.`
          : `${sc[7]} can wait ${durEn(F)}, and a batch every ${C} minutes is at most ${S} minutes behind, so I use the batch; streaming would mean ${n} always-on consumers for freshness nobody uses.`;
        return {
          q: `${sc[0]} va a publicar en un topic nuevo de Kafka ${sc[1]}: ≈ <b>${f(P)} eventos/s</b> en el pico, que un conector copia al data lake. Con ellos calcula ${sc[2]}, y ${user} la necesita con <b>${dur(F)}</b> de atraso como máximo. Un consumidor procesa ≈ <b>${f(c)} eventos/s</b> (load test). La alternativa es un job batch sobre el data lake, como los que ya opera el equipo, que correría cada <b>${C} min</b> y tardaría ≈ <b>${D} min</b>.`,
          parts: [
            {
              ask: 'Para comparar, dimensiona la opción de streaming: consumidores para el pico de hoy', unit: 'consumidores', answer: n, tol: 0,
              steps: [
                'Planteamiento: consumidores = ⌈pico ÷ eventos/s que procesa uno⌉. Cada partición la lee un solo consumidor del grupo: el topic necesita al menos esas particiones.',
                `⌈${f(P)} ÷ ${f(c)}⌉ = ⌈${f(P / c, 2)}⌉ = <b>${n} consumidores</b>`,
                'Es el mínimo para seguir el ritmo del pico: en producción se deja margen para vaciar el lag después de una caída.',
              ],
            },
            {
              ask: `El topic se crea ahora, y agregarle particiones después cambia a qué partición va cada key. Si el grupo de consumidores tuviera que seguir el pico que esperan en un año (≈ ${f(P2)} eventos/s), ¿cuántas particiones necesita el topic como mínimo?`, unit: 'particiones', answer: m, tol: 0,
              steps: [
                'Planteamiento: particiones ≥ consumidores que va a necesitar el grupo en el pico futuro = ⌈pico futuro ÷ eventos/s por consumidor⌉. Un consumidor de más que particiones queda ocioso.',
                `⌈${f(P2)} ÷ ${f(c)}⌉ = ⌈${f(P2 / c, 2)}⌉ = <b>${m} particiones</b>`,
                'En la práctica redondeas hacia arriba a un número cómodo, con margen: las particiones son el techo de consumidores cuando hay que recuperar lag.',
              ],
            },
            {
              ask: `¿Qué patrón usas para ${sc[2]}?`, choices, answer: choices.indexOf(fast ? okS : okB),
              steps: [
                `Planteamiento: el batch entrega datos con hasta (cada cuánto corre + lo que tarda) de atraso: ${C} + ${D} = <b>${S} min</b>. Compáralo con lo que tolera ${user}: ${dur(F)}.`,
                fast
                  ? `${dur(F)} es mucho menos que ${S} min, y ni corriendo el job sin pausa alcanzarías: una sola corrida ya tarda ${D} min. Va <b>streaming</b>: ${n} consumidores siempre encendidos que actualizan el agregado en segundos.`
                  : `${S} min caben en ${dur(F)}: el <b>batch</b> cumple, con un tipo de job que el equipo ya opera. Streaming sería pagar ${n} consumidores encendidos 24/7, más estado y consumer lag que vigilar, por una frescura que nadie usa.`,
                `El batch nocturno deja datos de hasta ≈ 24 h de atraso: mucho más que ${dur(F)}.`,
                'Online síncrono no aplica: nadie hace un request ni espera la respuesta. Los eventos llegan solos y lo que se calcula es un agregado en el tiempo; atar cada productor a la latencia del modelo solo agrega una dependencia.',
              ],
            },
          ],
          hint: 'Consumidores = pico ÷ lo que procesa uno, hacia arriba; las particiones son el techo de consumidores, así que se planean para el pico futuro. Para el patrón, compara el atraso que tolera quien usa el dato con el peor atraso del batch: cada cuánto corre más lo que tarda.',
          takeaway: `<b>Requisito:</b> ${user} tolera ${dur(F)} de atraso; el batch llega con hasta ${S} min. <b>Decisión:</b> ${fast ? 'streaming' : 'el batch cada ' + C + ' min'}. <b>Por qué:</b> ${fast ? 'ningún batch llega a ese atraso: una sola corrida ya tarda ' + D + ' min' : 'la frescura que piden ya la da el batch, sin consumidores encendidos 24/7'}. <b>Tamaño:</b> ${fast ? n + ' consumidores para el pico de hoy y un topic con al menos ' + m + ' particiones para el de un año' : 'con streaming serían ' + n + ' consumidores encendidos 24/7; el topic igual se crea con al menos ' + m + ' particiones, por si un día piden segundos'}. <b>Trade-off:</b> ${fast ? 'segundos de frescura a cambio de consumidores siempre encendidos, estado y consumer lag que vigilar' : 'el batch es más barato y simple, a cambio de minutos de atraso que aquí nadie usa'}. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'str-02', topic: 'streaming', level: 2, title: 'Ventanas y frescura', ref: 'c09.estimaciones',
      gen(r) {
        // [quién, entidad, plural, la feature, quién la lee, M de entidades con actividad en la ventana; en inglés: la feature y quién la
        // lee; concordancia de «activas»]
        const sc = r.pick([
          ['Una billetera digital', 'cuenta', 'cuentas', 'transferencias de la cuenta', 'el modelo de riesgo, que puntúa cada transferencia antes de aprobarla', [2, 3, 5, 8, 12], 'transfers per account', 'The risk model', 'activas'],
          ['Una red de publicidad', 'dispositivo', 'dispositivos', 'clicks del dispositivo', 'el filtro de clicks inválidos, que decide qué clicks se le cobran al anunciante', [20, 30, 40, 50, 60], 'clicks per device', 'The invalid-click filter', 'activos'],
          ['Un juego online', 'jugador', 'jugadores', 'partidas que abandonó el jugador', 'el matchmaking, que arma cada partida nueva', [4, 6, 10, 15, 25], 'abandoned matches per player', 'Matchmaking', 'activos'],
          ['Un marketplace', 'cuenta', 'cuentas', 'búsquedas que hizo la cuenta', 'el filtro de scraping, que puntúa cada búsqueda antes de responderla', [1, 2, 3, 5, 8], 'searches per account', 'The scraping filter', 'activas'],
        ]);
        const W = r.pick([10, 15, 30, 60]);   // ventana, en min
        // Micro-batch: [intervalo más corto que el cluster sostiene, duración de cada corrida], en min; la ventana es múltiplo del intervalo.
        const mb = r.pick([[1, 0.5], [2, 0.5], [2, 1], [5, 1], [5, 2], [5, 3]].filter((x) => W % x[0] === 0));
        const N = mb[0];
        const T = mb[1];
        const S = N + T;
        const useFl = r.pick([true, false]);   // se elige primero: cada patrón sale la mitad de las veces
        // Atraso que se tolera, con ≥ 10 % de distancia del peor atraso del micro-batch.
        const F = useFl ? r.pick([1 / 6, 0.5, 1, 2, 4].filter((x) => x <= S / 1.1)) : r.pick([2, 3, 5, 10, 15].filter((x) => x >= 1.1 * S));
        const b = useFl ? 1 : N;   // largo del bucket con el patrón correcto, en min
        // [M de entidades, bytes por bucket]: hasta 150 GB por copia y shards lejos de un entero.
        const kb = [];
        sc[5].forEach((k) => [64, 96, 128, 160].forEach((by) => {
          const st = (k * 1e6 * (W / b) * by) / 1e9;
          if (st <= 150 && far(st / 10.5)) kb.push([k, by]);
        }));
        const pk = r.pick(kb);
        const K = pk[0];
        const by = pk[1];
        const nb = W / b;
        const state = (K * 1e6 * nb * by) / 1e9;
        const sh = ceilx(state / 10.5);
        const nodes = 2 * sh;
        const stAlt = (K * 1e6 * (useFl ? W / N : W) * by) / 1e9;
        const okM = `Micro-batch cada ${N} min con el Spark que ya existe`;
        const okF = `Flink por evento, con estado por ${sc[1]}`;
        const choices = r.shuffle([okM, okF, 'Batch nocturno: la feature calculada con los datos de ayer', 'Agrupar por hora de llegada (processing time) para no esperar a los eventos tardíos']);
        const say1 = useFl
          ? `${sc[7]} tolerates ${durEn(F)} of staleness and the micro-batch can be ${f(S)} minutes behind, so I compute ${sc[6]} in Flink with one-minute buckets: about ${say(state)} gigabytes of state, ${nodes} nodes with two copies.`
          : `${sc[7]} tolerates ${durEn(F)} of staleness and a ${N}-minute micro-batch is at most ${f(S)} minutes behind, so I reuse Spark with ${N === 1 ? 'one-minute' : N + '-minute'} buckets: about ${say(state)} gigabytes of state, ${nodes} nodes with two copies.`;
        return {
          q: `${sc[0]} quiere la feature «${sc[3]} en los últimos ${W} min» para ${sc[4]}. Producto pide que la feature tenga como máximo <b>${dur(F)}</b> de atraso, y hay ≈ <b>${f(K)} M de ${sc[2]}</b> con actividad dentro de la ventana. El estado guarda buckets por ${sc[1]} de ≈ <b>${by} B</b> cada uno (con el overhead de la estructura; supuesto) en el online store, cuyos nodos tienen ≈ <b>10.5 GB útiles</b> (cache.r7g.large: ≈ 14 GB, menos el 25 % que se reserva, como en c09; ≈ US$0.18/h con Valkey, aprox.), con 2 copias, una por zona. Opciones:<ul><li><b>Micro-batch en Spark</b>, que el equipo de datos ya opera: lo más seguido que su cluster sostiene es una corrida cada <b>${N} min</b>, y cada una tarda ≈ <b>${dur(T)}</b>. Sus buckets son del largo del intervalo.</li><li><b>Flink por evento</b>: actualiza en segundos, pero es un sistema nuevo que operar. Sus buckets son de 1 min, para que la ventana también suelte los eventos viejos casi al ritmo en que se actualiza.</li></ul>`,
          parts: [
            {
              ask: 'Atraso máximo de la feature con el micro-batch (peor caso)', unit: 'min', answer: S, tol: 0.05,
              steps: [
                'Planteamiento: un evento que llega justo después de que arranca una corrida espera a la siguiente (el intervalo) y después a que esa corrida termine: atraso = intervalo + duración de la corrida.',
                `${N} + ${f(T)} = <b>${f(S)} min</b>`,
              ],
            },
            {
              ask: '¿Qué propones?', choices, answer: choices.indexOf(useFl ? okF : okM),
              steps: [
                `Planteamiento: compara el peor atraso del micro-batch con lo que tolera producto: ${f(S)} min contra ${dur(F)}.`,
                useFl
                  ? 'No alcanza, y el micro-batch no puede correr más seguido con ese cluster: va <b>Flink por evento</b>, que actualiza la feature en segundos. Lo que pagas: un sistema más con estado (checkpoints, lag, reprocesos).'
                  : 'Alcanza con margen: el <b>micro-batch</b> cumple con el equipo y el código que ya existen. Flink también cumpliría, pero suma un sistema con estado que operar por una frescura que nadie pide (M2: micro-batch si "fresco" significa minutos y ya tienes Spark).',
                `El batch nocturno deja la feature con hasta ≈ 24 h de atraso: no sirve para "los últimos ${W} min".`,
                'Agrupar por hora de llegada cuenta cada evento atrasado en la ventana equivocada: una ventana de "los últimos minutos" se arma por event time, y el watermark decide cuánto esperar a los atrasados.',
              ],
            },
            {
              ask: 'Estado de la ventana con el patrón que elegiste (una copia)', unit: 'GB', answer: state, tol: 0.15,
              steps: [
                `Planteamiento: estado = ${sc[2]} ${sc[8]} × buckets por ${sc[1]} × bytes por bucket, con buckets = ventana ÷ largo del bucket (${useFl ? '1 min con Flink' : N + ' min con el micro-batch'}).`,
                `${f(K)} M × ${nb} buckets (${W} ÷ ${b}) × ${by} B ≈ <b>${f(state)} GB</b>`,
                N === 1
                  ? 'Con un micro-batch de 1 min, los dos patrones guardan lo mismo.'
                  : `Con ${useFl ? 'el micro-batch (buckets de ' + N + ' min)' : 'Flink (buckets de 1 min)'} serían ≈ ${f(stAlt)} GB: la frescura por evento cuesta ${N}× la memoria, porque la ventana avanza con cada evento y pide buckets finos.`,
              ],
            },
            {
              ask: 'Nodos del online store para ese estado (shards × 2 copias)', unit: 'nodos', answer: nodes, tol: 0,
              steps: [
                'Planteamiento: shards = ⌈estado ÷ 10.5 GB útiles por nodo⌉; nodos = shards × 2 (una copia por zona).',
                `Con el resultado anterior: ⌈${f(state)} ÷ 10.5⌉ = ⌈${f(state / 10.5, 2)}⌉ = ${sh} × 2 = <b>${nodes} nodos</b>, ≈ US$${f(nodes * 0.18 * MES_H)}/mes`,
                'Si el estado crece, las palancas son menos bytes por bucket (contadores compactos en vez de una estructura por bucket), un TTL para las keys que dejan de tener actividad, o dejar los buckets en el estado del procesador (RocksDB, como el Flink de c09) y publicar en el online store solo el valor de la feature por key.',
              ],
            },
          ],
          hint: 'Primero la frescura: el peor atraso del micro-batch es su intervalo más lo que tarda una corrida; compáralo con lo que tolera producto. Después el estado: keys × (ventana ÷ largo del bucket) × bytes, con el bucket que pide el patrón elegido; y los nodos: shards por memoria útil, por 2 copias.',
          takeaway: `<b>Requisito:</b> como máximo ${dur(F)} de atraso para «${sc[3]} en los últimos ${W} min». <b>Decisión:</b> ${useFl ? 'Flink por evento' : 'micro-batch cada ' + N + ' min en Spark'}. <b>Por qué:</b> el micro-batch llega con hasta ${f(S)} min de atraso, ${useFl ? 'más de lo que se tolera' : 'dentro de lo que se tolera, con el equipo que ya existe'}. <b>Tamaño:</b> ≈ ${f(state)} GB de estado por copia → ${nodes} nodos. <b>Trade-off:</b> la frescura por evento pide buckets finos: ${N === 1 ? 'aquí los dos patrones guardan lo mismo, porque el micro-batch también es de 1 min' : 'con Flink, el estado es ' + N + '× el del micro-batch'}. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'str-03', topic: 'streaming', level: 2, title: 'Lag después de una caída', ref: 'm02.streaming',
      gen(r) {
        // [quién, qué eventos, quién los consume; en inglés: qué se atrasa]
        const sc = r.pick([
          ['Una empresa de paquetería', 'los escaneos de paquetes de sus centros de distribución', 'el modelo que recalcula la hora estimada de entrega', 'delivery ETAs'],
          ['Una cadena de supermercados', 'las ventas de las cajas de sus tiendas', 'el modelo de reposición, que estima el stock de cada góndola', 'shelf stock estimates'],
          ['El sistema de transporte de una ciudad', 'las validaciones de tarjeta en buses y estaciones', 'el modelo que predice la ocupación de cada línea', 'occupancy forecasts'],
          ['Una aseguradora de autos con telemetría', 'los eventos de manejo (frenadas, aceleraciones) de los autos asegurados', 'el score de riesgo de cada viaje', 'trip risk scores'],
        ]);
        const scale = r.pick([true, false]);   // ¿hay que escalar? Se elige primero: cada decisión sale la mitad de las veces
        // [llegada, eventos/s por consumidor, particiones, consumidores, caída (min), SLO de recuperación (min)]: los consumidores
        // van al 55–85 % antes de la caída, el tiempo con los actuales queda a ≥ 10 % del SLO y, si hay que escalar, alcanza
        // con las particiones; los consumidores mínimos quedan lejos de un entero.
        const combos = [];
        [2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000].forEach((lam) => [800, 1000, 1200, 1500, 2000].forEach((c) => [12, 16, 24, 32, 48].forEach((P) => {
          for (let n = Math.ceil(lam / (0.85 * c)); n <= Math.floor(lam / (0.55 * c)); n++) {
            if (n < 2 || n > P - 3) continue;
            [5, 10, 15, 20, 30].forEach((D) => [10, 15, 20, 30, 45, 60].forEach((R) => {
              const tn = (lam * D) / (n * c - lam);
              const tP = (lam * D) / (P * c - lam);
              if (!far((lam * (1 + D / R)) / c)) return;
              if (scale ? tn >= 1.1 * R && tP <= R / 1.1 : tn <= R / 1.1) combos.push([lam, c, P, n, D, R]);
            }));
          }
        })));
        const cb = r.pick(combos);
        const lam = cb[0];
        const c = cb[1];
        const P = cb[2];
        const n = cb[3];
        const D = cb[4];
        const R = cb[5];
        const lag = lam * D * 60;
        const spare = n * c - lam;
        const tn = lag / spare / 60;
        const tP = lag / (P * c - lam) / 60;
        const need = (lam + lag / (R * 60)) / c;
        const k = ceilx(need);
        const okA = `Dejar que los ${n} consumidores actuales se pongan al día solos`;
        const okS = `Escalar el grupo de consumidores, hasta ${P} como máximo (uno por partición)`;
        const choices = r.shuffle([okA, okS, `Escalar a ${2 * P} consumidores para ponerse al día el doble de rápido`, 'Agregar particiones al topic para repartir el atraso']);
        const say1 = scale
          ? `A ${D}-minute outage leaves ${mil(lag)} events behind, and ${sc[3]} run on stale data until the group catches up. ${n} consumers only have ${say(spare)} events per second of spare capacity, about ${f(tn, 0)} minutes against a ${R}-minute SLO, so I scale to ${k} consumers, which the ${P} partitions allow.`
          : `A ${D}-minute outage leaves ${mil(lag)} events behind, and ${sc[3]} run on stale data until the group catches up. With ${say(spare)} events per second of spare capacity that takes about ${f(tn, 0)} minutes, inside the ${R}-minute SLO, so I let it drain and alert on lag in seconds.`;
        return {
          q: `${sc[0]} manda a Kafka ${sc[1]}: ≈ <b>${f(lam)} eventos/s</b>, parejos durante el día. Los consume ${sc[2]}, con <b>${n} consumidores</b> que procesan ≈ <b>${f(c)} eventos/s</b> cada uno (medido); el topic tiene <b>${P} particiones</b>. Un deploy malo dejó caídos a los consumidores durante <b>${D} min</b>, mientras los eventos seguían llegando. El SLO de frescura dice que, después de un incidente, el lag tiene que volver a ≈ 0 en <b>≤ ${R} min</b> desde que vuelven los consumidores.`,
          parts: [
            {
              ask: 'Eventos acumulados (lag) cuando vuelven los consumidores', unit: 'eventos', answer: lag, tol: 0.15,
              steps: [
                'Planteamiento: mientras nadie consume, el lag crece a la tasa de llegada: lag = eventos/s × duración de la caída.',
                `${f(lam)} × ${D} × 60 s = <b>${f(lag)} eventos</b>, ≈ ${D} min de atraso en tiempo`,
              ],
            },
            {
              ask: `Minutos para ponerse al día con los ${n} consumidores actuales`, unit: 'min', answer: tn, tol: 0.15,
              steps: [
                'Planteamiento: mientras recuperan siguen llegando eventos, así que el lag baja al ritmo del margen: tiempo = lag ÷ (consumidores × eventos/s por consumidor − llegada).',
                `Con el resultado anterior: ${f(lag)} ÷ (${n} × ${f(c)} − ${f(lam)}) = ${f(lag)} ÷ ${f(spare)} ≈ ${f(tn * 60)} s ≈ <b>${f(tn)} min</b>`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(scale ? okS : okA),
              steps: [
                `Planteamiento: compara lo que tardan los consumidores actuales en ponerse al día con lo que da el SLO: ≈ ${f(tn)} min contra ${R} min.`,
                scale
                  ? `No cabe: hay que agregar consumidores. El grupo puede crecer hasta ${P}, uno por partición: con ${P}, ≈ ${f(tP)} min.`
                  : 'Cabe: los consumidores actuales vacían el lag dentro del SLO, y escalar ahora solo gasta.',
                `Más consumidores que particiones no suman nada: los que sobran quedan ociosos (${2 * P} leen igual que ${P}).`,
                'Agregar particiones no mueve el atraso: los eventos ya escritos siguen en sus particiones, y el cambio mezcla a qué partición va cada key (y su orden) justo durante el incidente.',
                'En los dos casos: alerta sobre el lag en tiempo. Y si estas caídas se repiten, autoscaling por lag (KEDA tiene un scaler de Kafka), con las particiones como techo.',
              ],
            },
            {
              ask: `Consumidores mínimos para ponerse al día en los ${R} min del SLO`, unit: 'consumidores', answer: k, tol: 0,
              steps: [
                'Planteamiento: la capacidad tiene que cubrir la llegada más el lag repartido en el tiempo del SLO: consumidores = ⌈(llegada + lag ÷ segundos del SLO) ÷ eventos/s por consumidor⌉.',
                `⌈(${f(lam)} + ${f(lag)} ÷ ${f(R * 60)}) ÷ ${f(c)}⌉ = ⌈${f(need, 2)}⌉ = <b>${k} consumidores</b>${k <= n ? ': los ' + n + ' actuales alcanzan' : ': ' + (k - n) + ' más que hoy, dentro de las ' + P + ' particiones'}`,
                'El sink también tiene que aguantar ese ritmo mientras recuperan: el online store recibe la llegada más el lag que se vacía.',
              ],
            },
          ],
          hint: 'El lag es la llegada por la duración de la caída. Se vacía al ritmo del margen (capacidad − llegada), no al de la capacidad. Para cumplir el SLO, la capacidad tiene que cubrir la llegada más el lag dividido por el tiempo disponible, y el número de consumidores no puede pasar del número de particiones.',
          takeaway: `<b>Requisito:</b> ponerse al día en ≤ ${R} min después de una caída de ${D} min, con ${f(lam)} eventos/s. <b>Decisión:</b> ${scale ? 'escalar a ' + k + ' consumidores o más, hasta ' + P : 'dejar que los ' + n + ' consumidores se pongan al día'}. <b>Por qué:</b> el tiempo de recuperación depende del margen (capacidad − llegada), no de la capacidad, y el techo de consumidores lo ponen las ${P} particiones. <b>Trade-off:</b> escalar cuesta consumidores durante la recuperación; no escalar cuesta minutos de features viejas. <b>Lo que monitoreas:</b> el lag en tiempo, con alerta si no baja. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'str-04', topic: 'streaming', level: 3, title: 'Eventos tardíos y watermark', ref: 'c09.serving',
      gen(r) {
        const WS = [1 / 6, 1, 5, 30];   // watermarks candidatos, en min
        const WT = ['10 s', '1 min', '5 min', '30 min'];
        const WE = ['ten-second', 'one-minute', 'five-minute', 'thirty-minute'];
        const WL = ['10 seconds', 'a minute', '5 minutes', '30 minutes'];
        // [quién, por qué llegan tarde, qué agrega cada ventana, quién lo usa, M de eventos al día, % de eventos que llega con
        // más de 10 s · 1 min · 5 min · 30 min de atraso (base, se escala), en inglés]
        const sc = r.pick([
          ['Una empresa agrícola mide la humedad del suelo con sensores LoRa en sus campos', 'el gateway de cada campo guarda las lecturas cuando pierde la señal celular y las reenvía al volver', 'la humedad promedio por parcela', 'el riego automático', [20, 30, 50, 80], [14, 6, 2.2, 0.6], 'soil-moisture readings'],
          ['Una app de salud recibe las mediciones de las pulseras de actividad de sus usuarios', 'la pulsera sincroniza por Bluetooth con el teléfono, y si el teléfono no está cerca las mediciones llegan después', 'los minutos activos por persona', 'las notificaciones de metas del día', [100, 200, 300, 500], [22, 9, 3.5, 1.2], 'wristband readings'],
          ['Un fabricante monitorea la vibración de las máquinas de sus plantas', 'el gateway de cada planta manda en lotes y, si se corta el enlace, guarda y reenvía', 'la vibración RMS por máquina', 'el modelo de mantenimiento predictivo, que abre órdenes de trabajo', [50, 80, 120, 200], [9, 3, 0.9, 0.2], 'vibration readings'],
          ['Una app educativa registra las respuestas de los estudiantes', 'la app funciona sin conexión en muchas escuelas y sube las respuestas cuando vuelve la red', 'el desempeño por estudiante y tema', 'el recomendador del siguiente ejercicio', [10, 20, 40, 60], [18, 8, 3, 1], 'student answers'],
        ]);
        const k = r.pick([1, 2, 3]);   // el watermark correcto: se elige primero, así cada uno sale un tercio de las veces
        // [escala de los %, largo de la ventana (min), proceso (s), máximo fuera del primer resultado (%), edad máxima (min)]:
        // un solo candidato cumple los dos requisitos, con ≥ 10 % de margen contra sus vecinos.
        const combos = [];
        [0.6, 0.8, 1, 1.2, 1.5].forEach((s) => [1, 5].forEach((L) => [5, 10, 20].forEach((p) => [0.5, 1, 2, 3, 5, 8, 10].forEach((X) => [3, 5, 8, 10, 15, 20, 30, 45, 60, 90].forEach((Y) => {
          const d = sc[5].map((x) => x * s);
          const lat = WS.map((w) => L + w + p / 60);
          const okD = d[k] <= X / 1.1 && d[k - 1] >= 1.1 * X;
          const okL = lat[k] <= Y / 1.1 && (k === 3 || lat[k + 1] >= 1.1 * Y);
          if (okD && okL) combos.push([s, L, p, X, Y]);
        })))));
        const cb = r.pick(combos);
        const vol = r.pick(sc[4]);
        const d = sc[5].map((x) => x * cb[0]);
        const L = cb[1];
        const p = cb[2];
        const X = cb[3];
        const Y = cb[4];
        const lat = WS.map((w) => L + w + p / 60);
        const drop0 = vol * 1e6 * d[0] / 100;
        const age5 = lat[2];
        const late = vol * 1e6 * d[k] / 100;
        const pc = (x) => f(x, 2);
        const wChoices = r.shuffle(WT.map((x) => 'Watermark de ' + x));
        const okSink = 'Mandarlos a una salida lateral y corregir su ventana con un upsert por (clave, ventana) que solo sobrescribe si la versión es más nueva';
        const sinkBad = r.shuffle([
          'Sumar cada evento tardío al valor guardado en la base (un incremento)',
          'Contarlos en la ventana en la que llegan (processing time)',
          'Descartarlos: su ventana ya se publicó',
          'Esperar 24 h antes de publicar cada ventana, para que no quede ninguno afuera',
        ]).slice(0, 3);
        const sinkChoices = r.shuffle([okSink].concat(sinkBad));
        const okMon = 'El atraso del watermark contra el reloj (lag en tiempo) y el % de eventos tardíos por fuente, cada uno contra su rango normal';
        const monBad = r.shuffle([
          'La CPU y la memoria de los workers del job',
          'Los errores al escribir en la base: si no hay errores, los resultados están bien',
          'Solo el total de eventos del día contra la semana anterior: si cuadra, el pipeline está bien',
          'Ninguna: los tardíos ya se corrigen solos por la salida lateral',
        ]).slice(0, 3);
        const monChoices = r.shuffle([okMon].concat(monBad));
        const say1 = `About ${pc(d[k])} percent of the ${sc[6]} arrive more than ${WL[k]} late, so a ${WE[k]} watermark meets the completeness target and still publishes within ${Y} minutes; later events go to a side output and correct their window with an idempotent upsert, and I alert on lag in seconds and on the late-event rate.`;
        return {
          q: `${sc[0]}: ≈ <b>${f(vol)} M de eventos al día</b>. Muchos llegan tarde porque ${sc[1]}. Un job de streaming calcula ${sc[2]} en ventanas fijas de <b>${L} min</b> por event time, y publicar cada ventana toma ≈ ${p} s (medido); el resultado lo usa ${sc[3]}. Medido durante una semana: el ${pc(d[0])} % de los eventos llega con más de 10 s de atraso; el ${pc(d[1])} %, con más de 1 min; el ${pc(d[2])} %, con más de 5 min; y el ${pc(d[3])} %, con más de 30 min. Para planear, todo evento que llega con más atraso que el watermark cuenta como fuera del primer resultado de su ventana. Requisitos:<ul><li><b>Completitud:</b> como máximo el <b>${f(X)} %</b> de los eventos puede quedar fuera del primer resultado de su ventana.</li><li><b>Frescura:</b> desde el primer evento de una ventana hasta que su resultado se publica, como máximo <b>${Y} min</b>.</li><li><b>Nada se pierde:</b> lo que llegue después del watermark corrige su ventana más tarde, sin contar nada dos veces.</li></ul>`,
          parts: [
            {
              ask: 'El equipo propone un watermark de 10 s, para publicar rápido. ¿Cuántos eventos al día quedarían fuera del primer resultado de su ventana?', unit: 'eventos/día', answer: drop0, tol: 0.15,
              steps: [
                'Planteamiento: con un watermark de W, la ventana se da por cerrada W después de su final; lo que llega con más atraso queda fuera del primer resultado. Eventos fuera = eventos al día × % que llega con más de W de atraso.',
                `${f(vol)} M × ${pc(d[0])} % ≈ <b>${f(drop0)} eventos al día</b>`,
                'Es una cota conservadora, la que pide el enunciado: un evento del comienzo de la ventana tiene algo más de margen, porque la ventana sigue abierta hasta su final.',
              ],
            },
            {
              ask: 'Si el watermark fuera de 5 min, ¿cuántos minutos pasarían, como máximo, desde el primer evento de una ventana hasta que se publica su resultado?', unit: 'min', answer: age5, tol: 0.15,
              steps: [
                'Planteamiento: el primer evento de una ventana espera a que la ventana termine (su largo), después al watermark (la espera a los tardíos) y después al proceso: edad máxima = largo + watermark + proceso.',
                `${L} + 5 + ${p} s ≈ <b>${f(age5)} min</b>`,
              ],
            },
            {
              ask: '¿Qué watermark (retraso tolerado) eliges?', choices: wChoices, answer: wChoices.indexOf('Watermark de ' + WT[k]),
              steps: [
                'Planteamiento: un watermark de W deja fuera del primer resultado el % que llega con más de W de atraso, y suma W a la edad del resultado. Necesitas el más corto que cumpla la completitud, y que su espera quepa en la frescura.',
                `Completitud (≤ ${f(X)} % fuera): 10 s → ${pc(d[0])} % · 1 min → ${pc(d[1])} % · 5 min → ${pc(d[2])} % · 30 min → ${pc(d[3])} %.`,
                `Frescura (≤ ${Y} min): 10 s → ${f(lat[0])} · 1 min → ${f(lat[1])} · 5 min → ${f(lat[2])} · 30 min → ${f(lat[3])} min.`,
                `Gana el de <b>${WT[k]}</b>: ${k === 1 ? 'el de 10 s deja' : 'los más cortos dejan'} afuera más del ${f(X)} %${k < 3 ? ', y el siguiente (' + WT[k + 1] + ') ya pasa de ' + Y + ' min' : ', y su edad cabe en ' + Y + ' min'}. Esperar de más no es gratis: cada minuto de watermark es un minuto más de edad y más ventanas abiertas en el estado.`,
              ],
            },
            {
              ask: 'Con tu watermark, ¿cuántos eventos al día llegan después y van a la salida lateral para corregir su ventana?', unit: 'eventos/día', answer: late, tol: 0.15,
              steps: [
                'Planteamiento: eventos tardíos = eventos al día × % que llega con más atraso que el watermark.',
                `${f(vol)} M × ${pc(d[k])} % ≈ <b>${f(late)} eventos al día</b>, ≈ ${f(late / DAY, 1)} por segundo en promedio`,
                'Cada uno vuelve a publicar el resultado de su ventana: el sink tiene que aguantar esas reescrituras sin contar nada dos veces.',
              ],
            },
            {
              ask: '¿Qué haces con los eventos que llegan después del watermark?', choices: sinkChoices, answer: sinkChoices.indexOf(okSink),
              steps: [
                'Planteamiento: el requisito pide no perder nada y no contar dos veces. Con at-least-once, un reinicio reprocesa eventos: la escritura tiene que dar el mismo resultado si se repite.',
                'Con un upsert por (clave, ventana) y versión, el tardío recalcula su ventana y la reescribe, un reproceso escribe el mismo valor y una versión vieja no pisa una nueva (como en c09).',
                'Un incremento cuenta dos veces lo que se reprocesa; contarlo por hora de llegada lo pone en la ventana equivocada; descartarlo rompe el "nada se pierde"; y esperar 24 h rompe la frescura.',
              ],
            },
            {
              ask: '¿Qué alertas pones para ver cómo falla este pipeline?', choices: monChoices, answer: monChoices.indexOf(okMon),
              steps: [
                'Planteamiento: este pipeline falla en silencio, así que la alerta tiene que mirar el tiempo y la completitud, no solo si el job está vivo.',
                'El lag en tiempo dice cuán viejo es lo que se publica: si sube, los resultados se atrasan sin ningún error. Y una fuente que deja de mandar puede frenar el watermark de todo el job: se marca como inactiva (idleness) y su silencio es una alerta.',
                'El % de tardíos por fuente es la señal temprana de un problema de conectividad, y de que el watermark elegido dejó de cumplir la completitud.',
                'CPU, errores del sink o el total del día no ven ni el atraso ni los tardíos: el job puede estar sano y publicando resultados incompletos. Y los tardíos no se corrigen solos si nadie mira que el sink los reciba.',
              ],
            },
          ],
          hint: 'Cada watermark deja fuera del primer resultado el % de eventos que llega con más atraso que él, y suma su espera a la edad del resultado (largo de la ventana + watermark + proceso). Elige el más corto que cumpla la completitud y verifica la frescura. Después: qué pasa con los que llegan aún más tarde, cómo se escriben sin contar dos veces y qué alerta te avisa de que algo se atrasó.',
          takeaway: `<b>Requisitos:</b> ≤ ${f(X)} % fuera del primer resultado, ≤ ${Y} min de edad y nada contado dos veces. <b>Decisión:</b> watermark de ${WT[k]}: deja afuera el ${pc(d[k])} % (≈ ${say(late)} eventos al día, que corrigen su ventana con un upsert idempotente) y publica en ≈ ${f(lat[k])} min. <b>Por qué:</b> ${k < 3 ? 'es el más corto que cumple la completitud, y uno más largo ya no cabe en la frescura' : 'ninguno más corto cumple la completitud, y su espera cabe en la frescura'}. <b>Trade-off:</b> el watermark cambia completitud por frescura (y por estado: más ventanas abiertas). <b>Cómo falla:</b> en silencio: un watermark frenado o más tardíos de lo normal no dan errores; se alerta por el lag en tiempo y el % de tardíos por fuente. <i>"${say1}"</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
