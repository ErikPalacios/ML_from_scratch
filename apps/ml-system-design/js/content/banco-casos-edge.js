/* Banco de problemas · Casos de diseño · Edge y on-device: el modelo junto al dato: ancho de banda, FPS por dispositivo, flota y OTA, on-device vs servidor.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'edge')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  B.formulas.push(
    { topic: 'edge', title: 'Video contra enlace', expr: 'subida = cámaras × bitrate (Mb/s) · GB/día = Mb/s × 86,400 ÷ 8 ÷ 1,000 · solo eventos: GB/día = eventos × MB ÷ 1,000', ex: '12 × 4 Mb/s = 48 Mb/s ≈ 518 GB/día · 300 eventos × 5 MB = 1.5 GB/día' },
    { topic: 'edge', title: 'Ocupación de un equipo', expr: 'ocupación = frames/s × ms por frame ÷ 1,000 · se planea ≤ 70 %, porque el throttling en caliente alarga cada frame', ex: '4 cámaras × 10 fps × 11 ms = 44 % · con +20 % en verano ≈ 53 %' },
    { topic: 'edge', title: 'Rollout por etapas', expr: 'etapas arrancadas al detectar = ⌊detección ÷ espera⌋ + 1 · afectados = flota × % de esa etapa · días hasta el 100 % = (etapas − 1) × espera ÷ 24', ex: 'detección en 18 h, 1 % → 10 % → 100 % cada 12 h: ⌊1.5⌋ + 1 = 2 → 10 % · cada 24 h: 1 %, y llega al 100 % en 2 días' },
    { topic: 'edge', title: 'Teléfono o servidor', expr: 'servidor = inferencias al mes ÷ 1,000 × US$ por 1,000 · con el modelo en el teléfono, el servidor solo atiende la fracción de teléfonos viejos · tamaño = parámetros × bytes (FP16 2 · INT8 1)', ex: '20 M/día × 30.4 × US$0.004 ÷ 1,000 ≈ US$2,430/mes · con 20 % de viejos ≈ US$490 · 12 M de parámetros: 24 MB en FP16, 12 en INT8' },
  );

  B.templates.push(
    {
      id: 'edg-01', topic: 'edge', level: 1, title: '¿Cabe el video en el enlace?', ref: 'm02.edge',
      gen(r) {
        // [quién y para qué, enlace, cámaras, Mb/s por cámara, Mb/s de subida, Mb/s que ya usa la operación, eventos al día, MB por evento]
        const sc = r.pick([
          ['Una minera quiere detectar polvo en los caminos de un rajo (mina a cielo abierto) para mandar camiones de riego', 'un radioenlace', [8, 10, 12, 16, 20], [2, 4], [40, 60, 80, 100], [10, 15, 20], [200, 400, 600], [3, 5]],
          ['Una terminal portuaria quiere leer los códigos de los contenedores con cámaras en sus grúas', 'fibra', [16, 24, 32, 40, 48], [4, 6], [100, 200, 300], [20, 40, 60], [3000, 5000, 8000], [0.5, 1]],
          ['Un feedlot (engorde de ganado) quiere detectar animales caídos o que cojean con cámaras sobre los corrales', 'LTE', [6, 8, 10, 12, 16], [1.5, 2], [15, 20, 30], [3, 5], [50, 100, 200], [2, 5]],
          ['Un aeropuerto quiere detectar objetos sueltos en la plataforma (FOD) con cámaras en los postes de iluminación', 'fibra', [12, 16, 20, 24, 30], [4, 8], [100, 150, 200], [30, 50], [100, 300, 500], [5, 6]],
        ]);
        const edge = r.pick([true, false]);   // se elige primero: cada decisión sale la mitad de las veces
        // [cámaras, Mb/s por cámara, subida, ya usado]: el video pasa en ≥ 15 % lo que el enlace deja libre, o usa como mucho el 60 %
        // (margen para los picos del bitrate): nunca queda pegado al límite.
        const combos = [];
        sc[2].forEach((C) => sc[3].forEach((br) => sc[4].forEach((L) => sc[5].forEach((U) => {
          const need = C * br;
          const free = L - U;
          if (edge ? need >= 1.15 * free : need <= 0.6 * free) combos.push([C, br, L, U]);
        }))));
        const cb = r.pick(combos);
        const C = cb[0];
        const br = cb[1];
        const L = cb[2];
        const U = cb[3];
        const ev = r.pick(sc[6]);
        const mb = r.pick(sc[7]);
        const need = C * br;
        const free = L - U;
        const gbE = (ev * mb) / 1000;
        const gbV = (need * DAY) / 8 / 1000;
        const okE = 'En el sitio: detectar ahí y subir solo los eventos';
        const okC = 'En la nube: subir el video y detectar en GPUs de la nube';
        const choices = r.shuffle([okE, okC, 'Grabar en el sitio y subir todo el video de noche, para procesarlo en batch']);
        const say1 = edge
          ? `Streaming all ${C} cameras needs ${f(need)} megabits per second and the link only has ${free} to spare, so detection runs on site and only events go up, about ${s2(gbE)} gigabytes a day.`
          : `All ${C} cameras need ${f(need)} megabits per second and the link has ${free} to spare, so I stream to the cloud and detect there: no hardware to run on site, and faster iteration.`;
        return {
          q: `${sc[0]}: <b>${C} cámaras</b> de ≈ <b>${f(br)} Mb/s</b> cada una. El sitio tiene ${sc[1]} con <b>${L} Mb/s</b> de subida, y la operación ya usa ≈ <b>${U} Mb/s</b> sostenidos. El resultado sirve si llega en ≤ 1 min. No hay restricciones de privacidad, y sin enlace la operación sigue sin el sistema. Detectando en el sitio subirían ≈ <b>${f(ev)} eventos al día</b> de ≈ <b>${f(mb)} MB</b> (fotos y un clip; supuesto).`,
          parts: [
            {
              ask: 'Subida que pide mandar el video de todas las cámaras', unit: 'Mb/s', answer: need, tol: 0.05,
              steps: [
                'Planteamiento: subida = cámaras × bitrate de cada una, sostenida las 24 horas.',
                `${C} × ${f(br)} = <b>${f(need)} Mb/s</b>`,
              ],
            },
            {
              ask: '¿Dónde detectas?', choices, answer: choices.indexOf(edge ? okE : okC),
              steps: [
                `Planteamiento: el video solo puede usar lo que la operación deja libre: ${L} − ${U} = <b>${free} Mb/s</b>, contra los ${f(need)} Mb/s que pide.`,
                edge
                  ? `No cabe (${f(need / free, 1)}× lo libre): se detecta en el sitio y suben solo los eventos. El edge además sigue funcionando si se corta el enlace, a cambio de operar equipos en el sitio (OTA, versiones, heartbeat).`
                  : `Cabe (${f((need / free) * 100, 0)} % de lo libre), con margen para los picos del bitrate, que no es parejo. Con enlace, y sin otra razón para el edge (privacidad, latencia, operar sin red), el default es la nube: iteras más rápido y no operas hardware en el sitio.`,
                'Subir de noche no sirve: el resultado tiene que llegar en ≤ 1 min, y mandar 24 h de video en unas pocas horas pediría todavía más enlace.',
              ],
            },
            {
              ask: 'GB al día que subiría el sitio mandando solo eventos', unit: 'GB/día', answer: gbE, tol: 0.15,
              steps: [
                'Planteamiento: GB al día = eventos al día × MB por evento ÷ 1,000.',
                `${f(ev)} × ${f(mb)} MB ÷ 1,000 = <b>${f(gbE)} GB/día</b>, ≈ ${g((gbE * 8000) / DAY)} Mb/s en promedio`,
                `El video completo serían ${f(need)} × 86,400 ÷ 8 ÷ 1,000 ≈ ${f(gbV)} GB/día: ≈ ${say(gbV / gbE)}× más que los eventos.`,
              ],
            },
          ],
          hint: 'Suma lo que piden las cámaras (cámaras × bitrate) y compáralo con lo que el enlace deja libre (subida − lo que ya usa la operación). Si no cabe, se detecta en el sitio y suben eventos: eventos al día × MB ÷ 1,000.',
          takeaway: `<b>Requisito:</b> ${f(need)} Mb/s de video contra ${free} Mb/s libres en el enlace. <b>Decisión:</b> ${edge ? 'detectar en el sitio y subir solo los eventos' : 'subir el video y detectar en la nube'}. <b>Por qué:</b> ${edge ? 'el video no cabe en el enlace; los eventos (≈ ' + f(gbE) + ' GB/día) sí' : 'el video cabe con margen, y sin otra razón para el edge el default es la nube'}. <b>Trade-off:</b> ${edge ? 'el edge ahorra enlace y sigue funcionando sin red, pero obliga a operar una flota de equipos' : 'la nube itera más rápido; si el sitio suma cámaras o el enlace se satura, el edge vuelve a la mesa (y ahí también se compara el costo)'}. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'edg-02', topic: 'edge', level: 2, title: 'FPS por dispositivo', ref: 'm04.edge-jetson',
      gen(r) {
        // [quién y para qué, equipo, cámaras, fps, ms por frame medidos (mediano FP16, mediano INT8, chico FP16, chico INT8),
        //  recall del mediano y del chico]
        const sc = r.pick([
          ['Un supermercado pone un equipo en cada caja de autocobro para detectar productos que pasan sin escanear', 'Jetson Orin Nano 8GB', [2, 3, 4], [8, 10, 12, 15, 20], [[30, 17, 12, 7.5], [26, 15, 10, 6.5], [34, 19, 14, 8.5]], 95, 90],
          ['Una ciudad pone un equipo en el gabinete de cada cruce para contar vehículos y peatones y ajustar los semáforos', 'Jetson Orin NX 16GB', [4, 6, 8], [5, 6, 8, 10, 12], [[19, 11, 7.5, 4.5], [16, 9.5, 6.5, 4], [22, 12.5, 8.5, 5]], 93, 88],
          ['Una liga amateur pone un equipo junto a cada cancha para seguir la pelota y filmar los partidos sin camarógrafo', 'Jetson Orin NX 16GB', [2, 3, 4], [12, 15, 20, 25, 30], [[18, 10.5, 7, 4.5], [15, 9, 6, 4], [21, 12, 8, 5]], 92, 86],
        ]);
        const NAMES = ['Mediano en FP16', 'Mediano en INT8', 'Chico en FP16', 'Chico en INT8'];
        const NAMES_LC = ['el mediano en FP16', 'el mediano en INT8', 'el chico en FP16', 'el chico en INT8'];
        const NAMES_EN = ['the medium model in FP16', 'the medium model in INT8', 'the small model in FP16', 'the small model in INT8'];
        const k = r.pick([0, 1, 2]);   // la configuración correcta: se elige primero, así cada una sale un tercio de las veces
        // [cámaras, fps, tiempos]: la elegida queda a ≥ 10 % debajo del 70 % y las más precisas, a ≥ 10 % encima.
        const combos = [];
        sc[2].forEach((S) => sc[3].forEach((F) => sc[4].forEach((ts) => {
          const u = ts.map((t) => (S * F * t) / 10);
          if (u[k] <= 70 / 1.1 && (k === 0 || u[k - 1] >= 70 * 1.1)) combos.push([S, F, ts]);
        })));
        const cb = r.pick(combos);
        const S = cb[0];
        const F = cb[1];
        const ts = cb[2];
        const h = r.pick([1.15, 1.2, 1.25]);   // cuánto alarga cada frame el throttling en verano
        const load = S * F;
        const u = ts.map((t) => (load * t) / 10);
        const hot = u[k] * h;
        const acc = [sc[5], sc[5] - 0.5, sc[6], sc[6] - 0.5];
        const choices = r.shuffle(NAMES.slice());
        const say1 = `${S} cameras at ${F} fps is ${f(load)} frames a second; ${NAMES_EN[k]} keeps the GPU at about ${f(u[k], 0)} percent, ${f(hot, 0)} in summer heat, and it's the most accurate option that fits${k === 1 ? ': I quantize before I shrink the model' : k === 2 ? ', since the medium model doesn\'t fit even in INT8' : ''}.`;
        return {
          q: `${sc[0]}: un <b>${sc[1]}</b> analiza <b>${S} cámaras a ${F} fps</b> cada una. En el golden set, el detector mediano da ≈ ${acc[0]} % de recall y el chico ≈ ${acc[2]} %; INT8, calibrado y validado, le resta ≈ 0.5 puntos a cada uno. Producto quiere el recall más alto que el equipo sostenga con la GPU al <b>70 %</b> como máximo, porque en verano, dentro del gabinete cerrado, el throttling alarga cada frame ≈ <b>${f((h - 1) * 100, 0)} %</b> (supuesto, medido con una hora en caliente). Medido con trtexec en el equipo (un frame a la vez, batch 1), en su modo de energía de producción y a 25 °C (supuesto), un frame tarda:<ul><li>Detector mediano: ≈ <b>${ts[0]} ms</b> en FP16 · ≈ <b>${ts[1]} ms</b> en INT8.</li><li>Detector chico: ≈ <b>${ts[2]} ms</b> en FP16 · ≈ <b>${ts[3]} ms</b> en INT8.</li></ul>`,
          parts: [
            {
              ask: 'Frames por segundo que analiza el equipo', unit: 'frames/s', answer: load, tol: 0.05,
              steps: [
                'Planteamiento: carga = cámaras × fps de cada una, todo el tiempo que el equipo está encendido.',
                `${S} × ${F} = <b>${f(load)} frames/s</b>`,
              ],
            },
            {
              ask: 'Ocupación de la GPU con el detector mediano en FP16 (más de 100 % significa que no alcanza)', unit: '%', answer: u[0], tolAbs: 2,
              steps: [
                'Planteamiento: ocupación = frames/s × tiempo por frame: la fracción de cada segundo que la GPU está trabajando.',
                `Con el resultado anterior: ${f(load)} × ${ts[0]} ms ÷ 1,000 = <b>${f(u[0], 1)} %</b>`,
              ],
            },
            {
              ask: '¿Qué detector y qué precisión usas?', choices, answer: choices.indexOf(NAMES[k]),
              steps: [
                'Planteamiento: ocupación de cada opción = frames/s × ms por frame ÷ 1,000; gana la de más recall que quede en ≤ 70 %.',
                `Mediano FP16 ≈ ${f(u[0], 1)} % · mediano INT8 ≈ ${f(u[1], 1)} % · chico FP16 ≈ ${f(u[2], 1)} % · chico INT8 ≈ ${f(u[3], 1)} %.`,
                `Gana <b>${NAMES_LC[k]}</b> (≈ ${acc[k]} % de recall): ${k === 0 ? 'cabe tal cual, y cuantizar solo agregaría una calibración que validar' : 'es la opción más precisa que cabe en el 70 %'}.`,
                'El orden importa: INT8 calibrado le quita ≈ 0.5 puntos al mediano, y pasar al chico le quita varios. Primero se cuantiza, después se achica el modelo. El chico en INT8 cabe siempre, pero regala recall que el equipo podía sostener.',
              ],
            },
            {
              ask: 'Ocupación de tu elección en verano, con el throttling', unit: '%', answer: hot, tolAbs: 2,
              steps: [
                'Planteamiento: el throttling alarga cada frame: ocupación en caliente = ocupación × (1 + lo que se alarga).',
                `${f(u[k], 1)} % × ${f(h, 2)} ≈ <b>${f(hot, 1)} %</b>: bajo 100 %, el equipo sigue el ritmo de las cámaras con margen.`,
                k > 0 && u[k - 1] < 100
                  ? `Por eso el 70 %: ${NAMES_LC[k - 1]}, al ${f(u[k - 1], 0)} %, pasaría a ≈ ${f(u[k - 1] * h, 0)} % en verano: ${u[k - 1] * h > 100 ? 'se atrasaría y empezaría a descartar frames' : 'sin margen para un pico de objetos ni para el resto del pipeline'}.`
                  : 'Por eso el 70 %: sin ese margen, un verano caluroso o un pico de objetos en la escena te dejan sin GPU justo cuando más importa.',
              ],
            },
          ],
          hint: 'Carga = cámaras × fps; ocupación de cada opción = carga × ms por frame ÷ 1,000. Busca la opción con más recall que quede en el 70 % (INT8 del modelo grande va antes que el modelo chico) y verifica cuánto sube en caliente.',
          takeaway: `<b>Requisito:</b> ${S} cámaras × ${F} fps en un ${sc[1]}, con la GPU ≤ 70 % por el calor. <b>Decisión:</b> ${NAMES_LC[k]} (≈ ${f(u[k], 0)} %, ≈ ${f(hot, 0)} % en verano). <b>Por qué:</b> es la opción con más recall que cabe; ${k === 0 ? 'no hace falta cuantizar' : k === 1 ? 'INT8 antes que un modelo más chico' : 'el mediano no cabe ni en INT8'}. <b>Trade-off:</b> cada cámara y cada fps de más es ocupación: en el edge no hay autoscaling, y el modelo es una decisión de capacidad, no solo de accuracy. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'edg-03', topic: 'edge', level: 2, title: 'Actualizar la flota sin romperla', ref: 'm02.edge',
      gen(r) {
        // [quién, equipos, qué modelo, tamaños de flota, en inglés]
        const sc = r.pick([
          ['Una empresa de cámaras de seguridad para el hogar', 'cámaras', 'el modelo que distingue personas de mascotas', [20000, 40000, 80000, 150000], 'cameras'],
          ['Una cadena de hoteles', 'termostatos inteligentes', 'el modelo que detecta si la habitación está ocupada (para ahorrar climatización)', [3000, 5000, 8000, 12000], 'thermostats'],
          ['Una empresa de máquinas expendedoras', 'máquinas con cámara', 'el modelo que reconoce qué producto sacó la persona, para cobrarlo,', [4000, 6000, 10000, 15000], 'vending machines'],
          ['Una empresa de reparto', 'cámaras de tablero (una por camioneta)', 'el modelo que detecta distracciones al volante', [3000, 5000, 8000, 12000], 'dashcams'],
        ]);
        const PL = [[1, 10, 100], [5, 50, 100], [1, 5, 25, 100]];   // etapas de los planes A, B y C (% de la flota)
        const dd = (x) => (x < 1 ? f(x * 24) + ' h' : f(x, 1) + (x === 1 ? ' día' : ' días'));
        const ddEn = (x) => (x < 1 ? f(x * 24) + ' hours' : x === 1 ? 'one day' : f(x, 1) + ' days');
        const LET = ['A', 'B', 'C'];
        const win = r.pick([0, 1, 2]);   // el plan correcto: se elige primero, así cada uno sale un tercio de las veces
        const N = r.pick(sc[3]);
        // [horas entre resúmenes, resúmenes necesarios, esperas de A, B y C, % máximo afectado, días máximos]: solo el plan
        // elegido cumple los dos requisitos (los demás fallan alguno por ≥ 10 %) y ningún cociente detección ÷ espera es entero.
        const combos = [];
        [1, 2, 4, 6].forEach((H) => [3, 4, 6].forEach((M) => [6, 12, 24].forEach((wa) => [12, 24, 48].forEach((wb) => [6, 12, 24].forEach((wc) => {
          const td = H * M;
          const w = [wa, wb, wc];
          if (w.some((x) => !far(td / x))) return;
          const aff = PL.map((pl, j) => pl[Math.min(floorx(td / w[j]), pl.length - 1)]);
          const days = PL.map((pl, j) => ((pl.length - 1) * w[j]) / 24);
          [0.5, 1, 2, 5, 10, 20].forEach((a) => [2, 3, 4, 5, 7, 10].forEach((dm) => {
            const pass = (j) => aff[j] <= a / 1.1 && days[j] <= dm / 1.1;
            const fail = (j) => aff[j] >= a * 1.1 || days[j] >= dm * 1.1;
            if (pass(win) && [0, 1, 2].every((j) => j === win || fail(j))) combos.push([H, M, w, a, dm]);
          }));
        })))));
        const cb = r.pick(combos);
        const H = cb[0];
        const M = cb[1];
        const w = cb[2];
        const a = cb[3];
        const dm = cb[4];
        const td = H * M;
        const idx = PL.map((pl, j) => Math.min(floorx(td / w[j]), pl.length - 1));
        const aff = PL.map((pl, j) => pl[idx[j]]);
        const days = PL.map((pl, j) => ((pl.length - 1) * w[j]) / 24);
        const affA = (N * aff[0]) / 100;
        const planTxt = PL.map((pl, j) => 'Plan ' + LET[j] + ': ' + pl.map((x) => x + ' %').join(' → '));
        const choices = r.shuffle(planTxt.concat(['Toda la flota a la vez']));
        const okMon = 'Por versión: el heartbeat de los equipos actualizados (su silencio es una alerta) y sus métricas contra las de la versión anterior, en la misma ventana';
        const monBad = r.shuffle([
          'El % de equipos que terminó de descargar la versión nueva',
          'El promedio de las métricas de toda la flota',
          'Los tickets de soporte de los clientes',
          'Los errores del servidor de descargas',
        ]).slice(0, 3);
        const monChoices = r.shuffle([okMon].concat(monBad));
        const soak = idx[win] === 0;   // ¿la primera etapa del plan elegido espera más que la detección?
        const say1 = `A quality regression takes about ${td} hours to show up, ${soak ? 'and plan ' + LET[win] + '\'s first stage soaks longer than that' : 'and by then plan ' + LET[win] + ' has reached its ' + aff[win] + ' percent stage, which is still within the limit'}: at most ${aff[win]} percent of the ${sc[4]} get a bad version, all of them are updated in ${ddEn(days[win])}, and the rollout stops on heartbeats and per-version metrics.`;
        return {
          q: `${sc[0]} va a actualizar por OTA ${sc[2]} en sus <b>${f(N)} ${sc[1]}</b>. Cada equipo sube un resumen de métricas cada <b>${H} h</b> (o al volver la conexión), y para distinguir una regresión del ruido hacen falta ≈ <b>${M} rondas de resúmenes</b> de los equipos actualizados (supuesto); un equipo que se cuelga se nota antes, porque deja de mandar heartbeats. Requisitos: si la versión nueva sale mala, como máximo el <b>${f(a)} %</b> de la flota puede tenerla cuando la detectes, y el rollout tiene que llegar al 100 % en <b>≤ ${dm} días</b>. Cada etapa arranca cuando termina la espera de la anterior:<ul><li>Plan A: 1 % → 10 % → 100 %, una etapa cada ${w[0]} h.</li><li>Plan B: 5 % → 50 % → 100 %, una etapa cada ${w[1]} h.</li><li>Plan C: 1 % → 5 % → 25 % → 100 %, una etapa cada ${w[2]} h.</li><li>Toda la flota a la vez.</li></ul>`,
          parts: [
            {
              ask: 'Horas hasta detectar una regresión de calidad en los equipos actualizados', unit: 'h', answer: td, tol: 0.05,
              steps: [
                'Planteamiento: detección = rondas de resúmenes necesarias × horas entre resúmenes, contadas desde que arranca la primera etapa.',
                `${M} × ${H} h = <b>${td} h</b>`,
                'Un crash se ve mucho antes (heartbeats que faltan). Lo que manda la espera entre etapas es la falla silenciosa: un modelo que funciona pero acierta peor.',
              ],
            },
            {
              ask: 'Con el plan A, ¿cuántos equipos tienen la versión mala cuando la detectas?', unit: 'equipos', answer: affA, tol: 0.15,
              steps: [
                'Planteamiento: etapas que ya arrancaron = ⌊detección ÷ espera⌋ + 1, sin pasar de la última; afectados = flota × % de la última etapa que arrancó.',
                `Con el resultado anterior: ⌊${td} ÷ ${w[0]}⌋ + 1 = ${idx[0] + 1} → ${aff[0]} % de ${f(N)} = <b>${f(affA)} equipos</b>`,
              ],
            },
            {
              ask: '¿Qué plan eliges?', choices, answer: choices.indexOf(planTxt[win]),
              steps: [
                'Planteamiento: para cada plan, el % de la flota con la versión mala al detectar (la etapa que alcanzó a arrancar) y los días hasta el 100 % ((etapas − 1) × espera ÷ 24).',
                PL.map((pl, j) => `Plan ${LET[j]}: ${aff[j]} % al detectar y ${dd(days[j])} hasta el 100 %`).join('; ') + '.',
                `Gana el <b>plan ${LET[win]}</b>: es el único que deja como mucho el ${f(a)} % con la versión mala y llega al 100 % en ≤ ${dm} días.`,
                'Si la espera entre etapas es más corta que la detección, el rollout crece antes de que veas la falla: el plan solo sirve si la etapa que alcanza todavía cabe en el % permitido. Toda la flota a la vez deja el 100 % con la versión mala.',
              ],
            },
            {
              ask: '¿Con qué señales se frena solo el rollout?', choices: monChoices, answer: monChoices.indexOf(okMon),
              steps: [
                'Planteamiento: el rollout se frena solo si una señal separa la versión nueva de la anterior y ve también a los equipos que dejaron de reportar.',
                'Comparar los equipos de la etapa contra los que siguen con la versión anterior, en la misma ventana, cancela lo que les pasa a todos (la hora, el clima, la red).',
                'El heartbeat cubre la falla más grave: un equipo que se cuelga no manda métricas malas, deja de mandar. Se evalúa en la nube, contra la lista de equipos que deberían reportar y con la versión de cada uno.',
                'El promedio de la flota diluye la etapa (el 1 % no mueve un promedio); las descargas dicen que el archivo llegó, no que funciona; los tickets llegan tarde y sin versión.',
                'Y en cada equipo, dos slots: si el health check local falla después de actualizar, vuelve solo a la versión anterior.',
              ],
            },
          ],
          hint: 'Detección = rondas de resúmenes necesarias × horas entre resúmenes. Para cada plan: cuántas etapas arrancaron antes de detectar (⌊detección ÷ espera⌋ + 1) y qué % de la flota cubre esa etapa; y cuántos días tarda en llegar al 100 % ((etapas − 1) × espera). Elige el que cumple los dos requisitos.',
          takeaway: `<b>Requisito:</b> como máximo el ${f(a)} % de la flota con una versión mala y el 100 % en ≤ ${dm} días, con una regresión que tarda ${td} h en verse. <b>Decisión:</b> plan ${LET[win]} (${aff[win]} % al detectar, ${dd(days[win])}). <b>Por qué:</b> ${soak ? 'su primera etapa espera más que la detección, así que la falla se ve antes de crecer' : 'cuando se ve la falla, el plan llegó a su etapa del ' + aff[win] + ' %, que todavía cabe en el ' + f(a) + ' % permitido'}, y aun así llega al 100 % a tiempo. <b>Trade-off:</b> etapas más chicas y esperas más largas bajan el riesgo, pero atrasan el modelo nuevo para toda la flota. <b>Monitoreo:</b> heartbeat y métricas por versión contra la versión anterior; rollback local con dos slots. <i>"${say1}"</i>`,
        };
      },
    },
    {
      id: 'edg-04', topic: 'edge', level: 3, title: 'On-device o en el servidor (app móvil)', ref: 'm02.edge',
      gen(r) {
        const out = r.pick(['S', 'S', 'Dc', 'Do']);   // servidor la mitad de las veces; en el teléfono, por costo o por requisito
        // [quién y qué hace, por qué tiene que funcionar sin conexión (o null), por qué la conexión no es problema, M de inferencias
        //  al día que son plausibles para esa app]
        const all = [
          ['Una app educativa reconoce la escritura de ecuaciones en la foto del cuaderno', 'Muchas escuelas rurales la usan en el aula sin internet, y el ejercicio se corrige en el momento', 'Se usa sobre todo en casa, con wifi', [5, 10, 20, 40, 80]],
          ['Una app de plantas identifica la especie desde la foto de una hoja o una flor', 'Mucha gente la usa de excursión, sin señal, y quiere la respuesta ahí mismo', 'Se usa sobre todo en jardines y viveros, con wifi', [1, 2, 5, 10]],
          ['Una app de viajes traduce carteles y menús con la cámara', 'Casi todos la usan en el extranjero, sin datos móviles', 'Casi todos la usan con el wifi del hotel o de un café', [1, 2, 5, 10, 20]],
          ['Una app de nutrición estima las calorías desde la foto del plato', null, 'Se usa en casa o en restaurantes, con conexión', [1, 2, 5, 10]],
        ];
        const sc = r.pick(out === 'Do' ? all.filter((x) => x[1]) : all);
        // [M de parámetros, MB que la app acepta sumar]: INT8 siempre entra; FP16 queda a ≥ 10 % del límite, de un lado o del otro.
        const ps = [];
        [4, 6, 8, 12, 16, 20, 24].forEach((pm) => [15, 20, 25, 30, 40, 50].forEach((sm) => {
          if (pm <= sm / 1.1 && Math.abs(2 * pm - sm) / sm >= 0.1) ps.push([pm, sm]);
        }));
        const pz = r.pick(ps);
        const Pm = pz[0];
        const Smax = pz[1];
        // [M de inferencias al día, US$ por 1,000, presupuesto, % de teléfonos viejos]: si gana el servidor, usa entre un octavo y el
        // 80 % del presupuesto (la comparación no es trivial y queda lugar para crecer); si no, lo pasa en ≥ 10 % y el fallback entra
        // con ≥ 10 % de margen. Sin conexión, el servidor para todos también queda a ≥ 10 % del presupuesto (es un comentario del paso).
        const combos = [];
        sc[3].forEach((R) => [0.002, 0.004, 0.008].forEach((c) => [1000, 2000, 5000, 10000].forEach((bud) => [10, 15, 20, 25, 30].forEach((o) => {
          const cs = R * 30.4 * 1000 * c;
          const fb = (cs * o) / 100;
          const ok = out === 'S' ? cs <= bud / 1.25 && cs >= bud / 8
            : out === 'Dc' ? cs >= bud * 1.1 && fb <= bud / 1.1
              : fb <= bud / 1.1 && (cs <= bud / 1.1 || cs >= bud * 1.1);
          if (ok) combos.push([R, c, bud, o]);
        }))));
        const cb = r.pick(combos);
        const R = cb[0];
        const c = cb[1];
        const bud = cb[2];
        const o = cb[3];
        const cs = R * 30.4 * 1000 * c;
        const fb = (cs * o) / 100;
        const fp16 = 2 * Pm;
        const prec = fp16 <= Smax ? 'FP16' : 'INT8';
        const okS = 'En el servidor, para todos los teléfonos';
        const okD = 'En el teléfono (Core ML o LiteRT), con el servidor como fallback para los teléfonos viejos';
        const choices = r.shuffle([okS, okD, 'En el teléfono para todos, sin fallback: los teléfonos viejos se quedan sin la función', 'En el teléfono, bajando el modelo en cada uso para tener siempre la última versión']);
        // El monitoreo depende de dónde quedó el modelo: en el servidor falla como un servicio online; en el teléfono, por slices.
        const okMon = out === 'S'
          ? 'El p99 y los errores del endpoint, el costo diario contra el presupuesto y la distribución de scores por app_version y modelo de teléfono'
          : 'Métricas por app_version, model_version y modelo de teléfono (latencia en el teléfono, crashes, tasa de fallback, distribución de scores), subidas como agregados';
        const monBad = r.shuffle(out === 'S'
          ? [
            'Solo la utilización de las GPUs: si están sanas, el modelo está bien',
            'La accuracy del modelo en el golden set antes de cada release, y nada en producción',
            'Las reseñas de la app en la tienda',
            'Guardar todas las fotos y que una persona revise cada predicción',
          ]
          : [
            'Solo las métricas del servidor: lo que corre en el teléfono no se puede medir',
            'La accuracy del modelo en el golden set antes de cada release, y nada en producción',
            'Las reseñas de la app en la tienda',
            'Subir todas las fotos de los usuarios para revisar cada predicción',
          ]).slice(0, 3);
        const monChoices = r.shuffle([okMon].concat(monBad));
        const say1 = out === 'S'
          ? `It runs while the app is online, and serving everyone costs about $${say(cs)} a month, inside the $${say(bud)} budget, so the model stays on the server: one version to update and no app-size cost.`
          : out === 'Dc'
            ? `Serving everyone would cost about $${say(cs)} a month against a $${say(bud)} budget, so the model ships on the phone in ${prec}, and only the ${o} percent of older phones fall back to the server, about $${say(fb)} a month.`
            : `It has to work offline, so the model runs on the phone in ${prec}; older phones use the server when they're online, and every metric is sliced by app version, model version and device.`;
        return {
          q: `${sc[0]}: ≈ <b>${f(R)} M de inferencias al día</b>. ${out === 'Do' ? sc[1] : sc[2]}. El modelo tiene ≈ <b>${Pm} M de parámetros</b>, y el equipo de la app acepta sumar como máximo <b>${Smax} MB</b> a la descarga. El presupuesto de servidor para esta función es de <b>US$${f(bud)}/mes</b> (mes de 30.4 días). Opciones:<ul><li><b>Servidor:</b> ≈ <b>US$${c} por 1,000 inferencias</b> con su flota de GPUs, a la carga real (supuesto).</li><li><b>En el teléfono</b> (Core ML o LiteRT): sin costo de servidor por inferencia, pero el ≈ <b>${o} %</b> de los teléfonos activos (sin NPU, según la telemetría de la app) tarda demasiado y necesita el servidor como fallback.</li></ul>`,
          parts: [
            {
              ask: 'Tamaño del modelo en FP16', unit: 'MB', answer: fp16, tol: 0.05,
              steps: [
                'Planteamiento: tamaño = parámetros × bytes por parámetro (FP16: 2 B).',
                `${Pm} M × 2 B = <b>${fp16} MB</b>`,
                fp16 > Smax
                  ? `No entra en los ${Smax} MB: en INT8 (1 B por parámetro) son ${Pm} MB y sí entra, después de validar la accuracy en el golden set.`
                  : `Entra en los ${Smax} MB; INT8 lo dejaría en ${Pm} MB si el límite bajara.`,
              ],
            },
            {
              ask: 'Costo mensual de correrlo en el servidor para todos', unit: 'US$/mes', answer: cs, tol: 0.15,
              steps: [
                'Planteamiento: inferencias al mes = al día × 30.4; costo = inferencias ÷ 1,000 × US$ por 1,000.',
                `${f(R)} M × 30.4 = ${f(R * 30.4)} M → ÷ 1,000 × US$${c} ≈ <b>US$${f(cs)}/mes</b>`,
              ],
            },
            {
              ask: '¿Dónde corre el modelo?', choices, answer: choices.indexOf(out === 'S' ? okS : okD),
              steps: [
                'Planteamiento: primero el requisito (¿tiene que funcionar sin conexión?); si no lo pide, el costo del servidor para todos contra el presupuesto.',
                out === 'Do'
                  ? `Manda el requisito: tiene que funcionar sin conexión, así que el modelo va en el teléfono (${prec}), ${cs <= bud ? 'aunque el servidor para todos (≈ US$' + f(cs) + ') entraría en el presupuesto' : 'y además el servidor para todos (≈ US$' + f(cs) + ') se pasaría del presupuesto'}. Los teléfonos viejos usan el servidor cuando hay conexión; sin conexión, la foto espera y se procesa al volver la red.`
                  : out === 'S'
                    ? `Con conexión y un servidor de ≈ US$${f(cs)} contra US$${f(bud)} de presupuesto, el default es el servidor: un solo modelo que actualizas cuando quieres, sin tamaño de app ni versiones repartidas en millones de teléfonos.`
                    : `El servidor para todos (≈ US$${f(cs)}) se pasa del presupuesto de US$${f(bud)}: el modelo va al teléfono (${prec}), y el servidor queda solo para el ${o} % de teléfonos viejos.`,
                `Sin fallback, el ${o} % de los teléfonos se queda sin la función, y no hace falta: el servidor puede atenderlos.`,
                `Bajar el modelo en cada uso gasta ${prec === 'FP16' ? fp16 : Pm} MB de datos por inferencia y no funciona sin conexión: el modelo se descarga una vez, versionado, y se actualiza por OTA.`,
              ],
            },
            {
              ask: `Costo mensual del servidor con el modelo en el teléfono (solo el ${o} % de teléfonos viejos lo usa)`, unit: 'US$/mes', answer: fb, tol: 0.15,
              steps: [
                'Planteamiento: con el modelo en el teléfono, el servidor solo atiende a los teléfonos viejos: costo = costo para todos × su fracción.',
                `Con el resultado de la segunda parte: US$${f(cs)} × ${o} % ≈ <b>US$${f(fb)}/mes</b>`,
                out === 'S'
                  ? `Ahorrarías ≈ US$${f(cs - fb)}/mes, pero el servidor ya entra en el presupuesto, y el teléfono suma trabajo fijo: convertir y validar el modelo en cada runtime, una matriz de teléfonos, tamaño de app y versiones repartidas. Si el uso crece y la factura se acerca al presupuesto, esta cuenta cambia.`
                  : `Entra en los US$${f(bud)} del presupuesto.`,
              ],
            },
            {
              ask: '¿Qué monitoreas para ver cómo falla, con el modelo donde lo pusiste?', choices: monChoices, answer: monChoices.indexOf(okMon),
              steps: out === 'S'
                ? [
                  'Planteamiento: en el servidor, el modelo falla como cualquier servicio online (latencia, errores, costo) y, en silencio, por slices: la foto cambia con la cámara del teléfono y con la versión de la app.',
                  'El p99 y los errores son la cara del servicio; el costo diario contra el presupuesto avisa antes de que la factura se pase si el uso crece.',
                  'La distribución de scores por app_version y modelo de teléfono ve lo que el promedio esconde: una versión de la app que comprime distinto la foto, o una cámara nueva.',
                  'Una GPU sana no dice que las respuestas sean buenas; el golden set no ve producción; las reseñas llegan tarde y sin versión; y revisar cada predicción a mano no escala y guarda fotos de más: se revisa una muestra, con permiso.',
                ]
                : [
                  'Planteamiento: con el modelo en el teléfono, la falla típica no es global sino de un slice (una versión, un teléfono), así que las métricas se cortan por esas dimensiones.',
                  'En cualquier momento conviven varias versiones de la app y del modelo en miles de modelos de teléfono: sin cortar por versión y por teléfono, una regresión en un slice (un chip cuyo runtime cae a CPU, una versión de la app que cambia la foto) queda escondida en el promedio.',
                  'La tasa de fallback dice cuántos teléfonos no pueden correr el modelo: si sube, sube la factura del servidor.',
                  'Las métricas del servidor no ven lo que pasa en el teléfono; el golden set no ve producción; las reseñas llegan tarde y sin versión; y subir todas las fotos rompe la privacidad: se suben agregados y una muestra con permiso.',
                ],
            },
          ],
          hint: 'Tres preguntas en orden: ¿tiene que funcionar sin conexión? (entonces va en el teléfono); si no, ¿el servidor para todos entra en el presupuesto? (inferencias al mes ÷ 1,000 × precio). Si va al teléfono, revisa que el modelo quepa en la app (parámetros × bytes) y cuánto cuesta el fallback de los teléfonos viejos (su fracción del costo del servidor).',
          takeaway: `<b>Requisitos:</b> ${out === 'Do' ? 'funcionar sin conexión' : 'con conexión'}; ${f(R)} M de inferencias al día; ≤ ${Smax} MB en la app; servidor ≤ US$${f(bud)}/mes. <b>Decisión:</b> ${out === 'S' ? 'el servidor para todos' : 'el modelo en el teléfono (' + prec + '), con el servidor como fallback para el ' + o + ' % de teléfonos viejos'}. <b>Por qué:</b> ${out === 'Do' ? 'el requisito de operar sin red manda antes que el costo' : out === 'S' ? 'con conexión y dentro del presupuesto (≈ US$' + say(cs) + '), el servidor es más simple de operar' : 'el servidor para todos (≈ US$' + say(cs) + ') se pasa del presupuesto, y el fallback cuesta ≈ US$' + say(fb)}. <b>Trade-off:</b> el teléfono ahorra servidor y funciona sin red, pero reparte el modelo en una flota que no controlas (tamaño de app, versiones, chips); el servidor itera más rápido. <b>Cómo falla:</b> ${out === 'S' ? 'como servicio online (p99, errores) y en la factura si el uso crece; y en silencio, en un slice de versiones de la app o de cámaras: se miran los scores por app_version y modelo de teléfono' : 'en un slice de teléfonos o de versiones; se monitorea por app_version, model_version y modelo de teléfono, con la tasa de fallback'}. <i>"${say1}"</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
