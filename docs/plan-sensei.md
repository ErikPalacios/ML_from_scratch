# Plan: Sensei

El nombre se cambia en un solo lugar: `apps/sensei/content/sitio.json`. Antes se llamaba «Cimientos». Cambió a Sensei el 2026-11-04 para hacer pareja con el Dojo: en el Dojo practicas, con el Sensei entiendes.

## 1. Qué es y para qué

Sensei es **el curso de teoría de TrueML** y, junto con el Dojo, su app principal. Enseña ML engineering desde cero: cada paso para llevar un modelo de AI o ML a producción, explicado como a alguien que apenas entra a la universidad, pero con la profundidad de un curso universitario introductorio bien hecho.

**La meta principal es aprender de verdad:** entender cada concepto lo suficiente para razonar con él, calcularlo y explicarlo. Lo demás es consecuencia de aprenderlo bien:

- Leer la **Ronda de Diseño ML** completa sin atorarse. Un inventario de sus 15 módulos encontró unos 300 conceptos que da por sabidos, y el temario los cubre todos. Para qué módulos prepara cada lección es una nota interna de este plan (sección 5) y de `content/ronda.json`; la app no la muestra en las lecciones.
- Practicar en el **Dojo** sabiendo qué se hace y por qué.
- Llegar a una entrevista con bases sólidas.

**Sensei es independiente (desde el 2026-11-13).** Se lee solo, sin haber abierto otra app. Las lecciones no citan la Ronda, el Dojo, «C01» ni códigos de módulo (M01–M15) o de caso (C02–C15): si algo se explicaba «en otro lado», se cuenta ahí mismo o se quita. La Ronda y el Dojo aparecen solo al final, en la página «¿Qué sigue después de Sensei?» (`/que-sigue/`). La única excepción es el cierre de cada lección, que enlaza su estación del Dojo con su nombre («Estación 1 del Dojo: Datos y etiquetas»).

| Herramienta | Para qué sirve |
|---|---|
| Sensei | Entender cada paso desde cero: qué es, por qué existe, cómo se calcula y cómo se conecta con lo demás. |
| Dojo | Construir, rehacer y romper un mini-proyecto de cada paso. |
| Ronda de Diseño | Defender el diseño completo en una entrevista. |

**Por qué se subió el estándar (2026-11-04).** La primera versión de la fase 2 dejaba cada lección en introducción: ≈ 4,300 palabras, 1 diagrama, sin calculadoras ni ejercicios. Un módulo de la Ronda trae ≈ 14,000 palabras, ≈ 7 calculadoras, ≈ 18 tablas y ≈ 31 recuadros. El estándar nuevo de una lección es de 8,000 a 11,000 palabras (al principio se fijó en 7,000 a 10,000), en dos pasadas (lo esencial y lo extra). Trae al menos 2 diagramas, 3 figuras, 2 calculadoras interactivas, 3 cuentas paso a paso, código con su salida real, errores comunes, el concepto en otros casos además de Alba, y de 8 a 12 ejercicios con solución. Está en [apps/sensei/GUIA-CONTENIDO.md](../apps/sensei/GUIA-CONTENIDO.md), sección 3.

## 2. Las reglas del contenido

Las reglas completas, los formatos y la lista de revisión están en [apps/sensei/GUIA-CONTENIDO.md](../apps/sensei/GUIA-CONTENIDO.md). En corto:

- No asumir nada.
- Analogías donde ayuden, nunca forzadas, y diciendo dónde se rompen.
- Números con la cuenta a la vista **y con su ecuación**: cada método lleva un bloque `:::formula` con cada letra definida y su unidad, cada fila de una cuenta dice qué letra es y de dónde sale su número, y las calculadoras usan las mismas letras con etiquetas sin ambigüedad. Una letra significa una sola cosa en toda la lección. El modelo es «Buckets: percentiles sin guardar cada número» en `percentiles.md` (pedido del usuario, 2026-11-13).
- **Alba como hilo:** la empresa del curso es **Alba**, un marketplace ficticio fijo (antes «el caso C01»). Todos sus números viven en una sola ficha, `apps/sensei/content/empresa.json`, con sus conflictos resueltos; `camino-completo` la presenta con la tabla «Alba en números». Cada lección presenta a Alba la primera vez que la nombra y repite los números que usa, sin suponer que se leyó otra lección. Un dato nuevo de Alba se agrega primero a la ficha. Los otros sistemas (búsqueda, recomendaciones, asistente con RAG, LLM propio, agente, moderación) también son de Alba; los demás casos se nombran por lo que son, sin empresas reales.
- **Sin citas a otras apps:** `grep -rnE 'Ronda|\bC0[1-9]\b|\bC1[0-5]\b|\bc01\b|\bM(0[1-9]|1[0-5])\b|Dojo'` sobre `content/lecciones`, `glosario`, `diagramas`, `figuras`, `calculadoras` y `empresa.json` sale vacío en cada fase.
- Al menos un diagrama con recorrido y una figura por lección.
- El término en inglés al lado del español.
- Hechos verificados.
- Salir de la app lo menos posible.

## 3. Las piezas de la app

- **Formato de lectura como la Ronda:**
  - Barra lateral con buscador, avance e índice por módulos.
  - La lección como una hoja alineada a la izquierda, con secciones numeradas y su subtítulo en inglés.
  - «En esta página» a la derecha en pantallas anchas, y un cajón con menú en el celular.
- **Diagramas con el motor de la Ronda:** `vendor/ronda/diagram.js`, copiado por `node apps/trueml/sync.mjs`. Trae carriles, cajas con forma según su tipo, recorridos paso a paso, «Ampliar» y «por qué está aquí» al tocar cada caja.
- **Glosario con globos:** cada concepto vive en un solo lugar (`content/glosario/<lección>.json`) y se abre ahí mismo, también dentro de los diagramas.
- **¿Qué sigue después de Sensei?** (`/que-sigue/`, antes `/ronda/`, que redirige ahí): la única página que habla del Dojo y de la Ronda. Lista las estaciones del Dojo y los 15 módulos de la Ronda, cada uno con las lecciones que conviene repasar (`content/ronda.json`, campo `lecciones`). La barra lateral y el pie la enlazan al final.
- **El cierre de cada lección:** marcar como leída, la siguiente lección (o `/que-sigue/` en la última) y la estación del Dojo por su nombre, sin C01.
- **Ecuaciones sin dependencias:** `tools/mate.mjs` dibuja fracciones, raíces, subíndices, sumas y letras griegas; en línea se escriben `\( … \)` y en bloque con `:::formula` (ver la guía).
- **La regla de las dudas:** cuando a alguien le surge una duda, la respuesta se agrega o se mejora en el glosario.

## 4. Cómo se trabaja cada fase (proceso ahorrador, desde la fase 4)

En la fase 3 cada lección costó ≈ 1.75 % del límite semanal del plan Max, y una ventana de 5 horas alcanzó para ≈ 5 lecciones. Este proceso baja el gasto sin tocar lo que da la calidad.

1. **Una sesión nueva por fase**, que parte del plan, la guía y los commits, no de una conversación larga.
2. **Tandas del tamaño de una ventana:** unas 5 lecciones. Cada escritor lleva un **presupuesto de palabras por sección** desde el principio (8,000 a 11,000 en total), para no escribir de más y recortar después.
3. **Paquetes de datos de la Ronda:** al empezar la fase, un paso barato extrae por lección los números, definiciones y frases de la Ronda que necesita. Escritores y revisores leen el paquete en lugar de módulos enteros, y pueden buscar en la Ronda lo que falte. La Ronda es fuente, nunca cita: lo que se toma de ella se cuenta en la lección, y sus números del caso se pasan por `content/empresa.json`.
4. **Cada modelo en su trabajo:**
   - El modelo grande escribe y hace la **revisión de fondo**: hechos, claridad y conocimiento supuesto. Esa es la prioridad y no se recorta.
   - Un modelo chico, con esfuerzo bajo, hace lo mecánico: correr los scripts que recalculan cada número, comparar cada bloque de código con su salida y revisar las capturas. Reporta lo que encuentra.
   - La revisión de fondo va al final, con el reporte mecánico a la mano, y corrige todo.
5. **Las figuras se siguen haciendo a mano**, una por una, en SVG con las clases del tema. Nada de plantillas: son parte de lo que hace geniales las lecciones.

Al terminar cada fase se compara el porcentaje semanal por lección contra el 1.75 % de la fase 3.

**Fase 4 (2026-11-05): ≈ 4 % por lección, más del doble.** El límite semanal pasó de 32 % a 52 %: 1 punto para los paquetes y 19 para escribir y revisar las 5 lecciones. La ventana de 5 horas tampoco alcanzó: la tanda empezó con 67 % libre en una ventana y se terminó en la siguiente, al 94 %. Lo que más pesó:

- Escritores y revisores heredaron el esfuerzo de la sesión, que era el máximo. Los escritores solos gastaron ≈ 2 puntos por lección, con verificaciones que tocaban a la revisión de hechos (uno probó señales en contenedores de Docker).
- Las dos pasadas de fondo son agentes aparte, y cada uno vuelve a leer la lección, el glosario, las piezas y decenas de capturas.

Para la fase 5, sin tocar las dos pasadas de fondo ni las figuras a mano:

- Fijar el esfuerzo de escritores y revisores en «alto», en vez de heredarlo.
- Que el escritor verifique solo lo que corre (el Python y las cuentas) y le deje los hechos a su revisión.
- Que la pasada de claridad mire solo las capturas de 780 px en claro y en oscuro.

**Fase 5 (2026-11-06): ≈ 1.5 % por lección.** Con esos tres ajustes, el límite semanal pasó de 53 % a 62 %: 1 punto para los paquetes, 5 para escribir las 6 lecciones con su revisión mecánica y 3 para las dos pasadas de fondo. Es menos que el 1.75 % de la fase 3 y casi tres veces menos que la fase 4. Las 6 lecciones cupieron en una sola ventana de 5 horas, que pasó de 4 % a 69 %. Las dos pasadas de fondo no se recortaron: la de hechos hizo 129 correcciones y la de claridad, 104 cambios.

Lo que funcionó, para repetirlo en la fase 6:

- **Dos flujos en vez de uno.** El primero escribe y hace la revisión mecánica de todas las lecciones. Entre los dos se mide el uso y se decide cuántas lecciones caben en las pasadas de fondo. El segundo corre hechos y después claridad, lección por lección.
- **Escritores sin búsqueda web.** Cada escritor anota sus dudas de hechos con línea, entre 17 y 27 por lección, y la revisión de hechos empieza por ellas.
- **Reparto de conceptos antes de escribir.** Los paquetes de la Ronda traen un inventario de los conceptos de red que usa cada fuente. Con él se repartieron 86 ids entre las 6 lecciones y se reservaron 10 para fases posteriores (tls, mtls, vpc, nat, egress, jwt, api-key, cola-mensajes, at-least-once y canary), para que se enlacen con una frase y no se presenten antes de tiempo.

**Fase 6 (2026-11-06): ≈ 1.4 % por lección.** Se repitió el proceso de la fase 5 sin cambios. El límite semanal pasó de 63 % a 70 %: menos de 1 punto para los paquetes, 4 para escribir las 5 lecciones con su revisión mecánica y 3 para las dos pasadas de fondo, más la integración. La tanda cupo en una ventana de 5 horas, que pasó de 4 % a 62 %. Las pasadas de fondo no se recortaron: la de hechos hizo 111 correcciones y la de claridad, 80 cambios. El inventario de los paquetes repartió 80 ids y reservó 5 para las estaciones y la fase de seguridad (onnx y engine-tensorrt para exportar, versionado-datos y linaje para versionar, hmac para cifrado).

Lo nuevo de la fase 6, para repetirlo:

- **Una pasada de consistencia barata al integrar** (sonnet, esfuerzo bajo, solo reporta). Encontró lo que ninguna revisión por lección podía ver: la línea de log de C01 escrita de tres formas, un `request_id` distinto al de la lección de HTTP y una variante de M13 (mandar la llave de la foto en vez de sus bytes) contada como si fuera el diseño de C01.

**Fase 7 (2026-11-06): ≈ 3.5 % por lección, como en la fase 4.** El límite semanal pasó de 71 % a 92 %. El costo se fue casi todo en los escritores:

- **Paquetes:** 1 punto.
- **Escritores:** 16 puntos. Cada uno generó ≈ 290–380 mil tokens de salida en 3 horas, el triple que en la fase 6. Agotaron la ventana de 5 horas y se cortaron sin entregar su reporte (ni sus dudas de hechos). El texto sí quedó completo, hasta el chequeo final.
- **Piezas faltantes y revisión mecánica:** 1 punto. Las hizo un agente por lección con esfuerzo medio, sin reescribir la prosa: 14 figuras a mano, 4 diagramas, 4 calculadoras y 2 glosarios.
- **Pasadas de fondo:** 3.5 puntos, en dos tandas de 3 lecciones para medir entre una y otra. Ninguna se recortó: la de hechos hizo 144 correcciones y la de claridad, 94 cambios.
- **Consistencia e integración:** menos de 1 punto.

Lo que encareció a los escritores:
- Lecciones sobre herramientas, con 13 a 15 bloques de código cada una.
- Un ayudante nuevo que corre los bloques `bash` en un contenedor Linux sin red y el Python con PyTorch 2.15. Valió la pena: las salidas de bash, Git, pytest y PyTorch son reales y deterministas. Pero cada escritor iteró muchas veces sobre ellas.

Para la fase 8:
- Escritores con esfuerzo «medio», o con un tope de bloques de código.
- Lanzar los escritores solo al inicio de una ventana nueva, nunca con la ventana a medias.
- Que cada escritor guarde sus pendientes en disco conforme avanza, no solo en el reporte final.
- **Presupuesto con Fable y reinicios (2026-11-12):** las reglas están en [plan-ia-privada.md](plan-ia-privada.md), sección 8. En corto: Fable también gasta del límite semanal total, así que cada trabajo va al modelo que dé más calidad por punto del total. La fase 8 es la primera con lecciones desde entonces y hace la calibración: una lección la escribe Fable y otra Opus, con el mismo esfuerzo, y se compara lo gastado y las correcciones de la revisión de fondo. Antes de lanzar se lee el uso de cada límite.
- **Dejar listos los números para IA Privada:** la lección «Máquinas, GPUs y precios» es la base de las calculadoras de IA Privada (fases 1–2). Sus datos de GPUs (VRAM, ancho de banda, consumo y precio por hora en la nube, con fecha y fuente) se guardan también en un archivo de datos aparte que esa app pueda leer, por ejemplo `apps/sensei/content/datos/gpus.json`.

**Fase 8 (2026-11-13): ≈ 1.8 % por lección, con la calibración Fable contra Opus.** El límite semanal pasó de 3 % a 12 %, y todo cupo en una ventana de 5 horas, que pasó de 4 % a 72 %. Por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Paquetes de la Ronda y datos verificados de GPUs (`content/datos/gpus.json`, con web) | Sonnet, bajo y medio | < 1 punto | 6 → 10 % |
| Escritor de `regiones` | **Fable**, medio | ≈ 1 punto | 10 → 22 % (12 puntos) |
| Escritores de las otras 4 lecciones, en paralelo | **Opus**, medio | 2 puntos (≈ 0.5 por lección) | 22 → 36 % (≈ 3.5 puntos por lección) |
| Revisión mecánica, las 5 | Sonnet, bajo | 1 punto | 36 → 40 % |
| Pasadas de fondo: hechos y claridad, las 5 | Opus, alto | 3 puntos | 40 → 68 % |
| Consistencia, integración y navegador | Sonnet bajo y Opus medio | 1 punto | 68 → 72 % |

Los escritores con esfuerzo medio tardaron 15–18 min y generaron 235–267 mil tokens cada uno, contra 3 horas y 290–380 mil en la fase 7. Las pasadas de fondo no se recortaron: la de hechos hizo 102 correcciones en las lecciones y 5 en `gpus.json`, y la de claridad, 382 cambios. La consistencia encontró 13 diferencias entre lecciones. La más grande: la infraestructura de C01 sumaba ≈ US$1.75k en una lección y ≈ US$1.83k contando la red fila por fila, así que ahora se usa ≈ US$1.8k.

**La calibración: Fable no gana para escribir lecciones.** La misma tarea, el mismo encargo y el mismo esfuerzo (medio), escrita por Fable y por Opus, con los mismos revisores (Opus, esfuerzo alto):

| | Fable (`regiones`) | Opus (promedio de 4) |
|---|---|---|
| Límite total gastado (ventana de 5 h, la lectura más fina) | 12 puntos | ≈ 3.5 puntos |
| Límite semanal total | ≈ 1 punto | ≈ 0.5 puntos |
| Barra semanal de Fable | 0 → 4 % | — |
| Tokens del escritor y tiempo | 244k, 18 min | 235–267k, 15–18 min |
| Hallazgos de la revisión mecánica | 9 | 9.25 (8–11) |
| Correcciones de hechos (graves / medias / menores) | **27** (3 / 10 / 14) | **18.75** (1 / 6.25 / 11.5) |
| Cambios de claridad (de ellos, conocimiento supuesto) | 76 (23) | 76.5 (36) |
| Dudas del escritor que resultaron correctas | 88 % (38 de 43) | 81 % (147 de 182) |

Con tokens parecidos, Fable gastó ≈ 3.4 veces más del límite total por lección, y su borrador no salió mejor. Tuvo más correcciones de hechos, tres de ellas graves (un porcentaje de uso de las T4 tomado del pico como si fuera un día normal, fotos confundidas con tensores y tiempos de failover de más). En claridad quedó igual, con menos conceptos sin explicar. Por punto gastado, Opus da más de 3 veces más lección revisada. **Decisión: los escritores van en Opus con esfuerzo medio.** Es una sola lección contra cuatro y de temas distintos, así que la diferencia de calidad es una señal y no una prueba. La diferencia de costo sí es clara. La barra de Fable no frena: una lección la subió 4 %.

Para la fase 9:
- Repetir el flujo de esta fase tal cual, con todos los escritores en Opus, esfuerzo medio.
- Dejar en el encargo del escritor los «datos comunes de la fase» y el alcance de cada lección (`reparto.md`). Aun con ellos, los totales del caso se contaron distinto entre lecciones: ahora los datos comunes salen de la ficha `content/empresa.json`, con cada total ya sumado partida por partida.
- Seguir las reglas nuevas desde el borrador: Alba (ficha), una ecuación por método con sus letras definidas, nada de Ronda, Dojo ni códigos. La revisión mecánica corre el grep de la sección 2 y la de claridad revisa que cada letra signifique una sola cosa.
- Las 30 correcciones que las revisiones de hechos encontraron para la Ronda (NAT regional, cobro de Cloud Run, CUD con reserva, egress al salir del proveedor, la infraestructura de C01, etc.) están juntas en las notas de la sesión. Conviene aplicarlas en una sesión aparte.

**Limpieza: Alba, sin Ronda y con ecuaciones (2026-11-13/14).** Las 43 lecciones dejaron de citar la Ronda, el Dojo, «C01» y los códigos M01–M15 y C02–C15. El caso C01 ahora es Alba, con sus números en `content/empresa.json`. Cada método tiene su ecuación en un bloque `:::formula`, con cada letra definida. Cada lección pasó por un editor (Opus, medio) y una revisión de claridad (Opus, alto). Al final, una pasada de consistencia revisó las 43 juntas. Gasto por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Ficha `content/empresa.json` (18 conflictos resueltos) | Sonnet | < 1 punto | < 1 punto |
| Tandas 1 y 2: 22 lecciones (fases 1–4 y `red`), editor y claridad | Opus, medio y alto | 13 → 22 % (≈ 0.4 por lección) | 6 → 73 % en una ventana (≈ 3 puntos por lección: ≈ 2.3 del editor y ≈ 1 de la revisión) |
| Tanda 3: 21 lecciones (fases 5–8), editor y claridad, hasta 20 agentes a la vez | Opus, medio y alto | 23 → 30 % (≈ 0.33 por lección) | 0 → 57 % en ≈ 25 min (≈ 2.7 puntos por lección) |
| Consistencia de las 43 (+27 datos en la ficha, conflictos 19–30) | Sonnet, bajo | < 1 punto | ≈ 1 punto |
| Cierre: revisión mecánica, navegador, plan, commit y deploy | Opus (la sesión) | < 1 punto | ≈ 1–2 puntos |

Lo que encontraron las revisiones:
- Lo más común fue una letra con dos significados: una \(s\) que choca con la unidad «s», una \(D\) para bytes junto a «el día D», o una letra distinta en el texto y en la calculadora. Por eso el encargo de claridad lo pone primero.
- Hubo pocos errores de cuenta, ≈ 1 de cada 3 lecciones, y todos chicos (US$45 → 44, 1.9× → 1.8×).
- El check del navegador encontró ecuaciones en línea demasiado largas que se salían del ancho. Ahora `tools/mate.mjs` pone un punto de corte (`<wbr>`) después de cada operador, y `.m` ya no es `nowrap`. Los subíndices, las fracciones y las raíces siguen sin partirse.
- Los editores en paralelo compartían la carpeta temporal y uno corrió por error el script de otro, que no cambió nada. En los encargos en paralelo, cada agente guarda sus scripts en una subcarpeta con el nombre de su lección.

**Fase 9 (2026-11-14): ≈ 1.5 % por lección, 4 lecciones de seguridad.** Es la primera fase escrita con las reglas nuevas desde el borrador: Alba de la ficha, una ecuación por método y nada de Ronda. El límite semanal pasó de 31 % a 37 %. La ventana de 5 horas se usó en dos partes: los escritores arrancaron con la ventana vieja en 65 % (el usuario pidió no esperar el reinicio, porque lo que sobra de una ventana se pierde), la vieja llegó a 83 % y la nueva a 26 %. Por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Paquetes de la Ronda, reparto, encargos y grupo `seguridad` de la ficha | Sonnet bajo y la sesión | < 1 punto | 61 → 65 % |
| Escritores de las 4 lecciones, en paralelo (≈ 25 min) | Opus, medio | 2 puntos (0.5 por lección) | 65 → 80 % (≈ 3.75 por lección) |
| Revisión mecánica, las 4 | Sonnet, bajo | < 1 punto | 80 → 83 % |
| Hechos, las 4 (con web; cruzó el reinicio de las 06:50) | Opus, alto | 2 puntos | 83 % → reinicio → 7 % |
| Claridad, las 4 | Opus, alto | 1 punto | 7 → 19 % |
| Consistencia (19 hallazgos) | Sonnet, bajo | < 1 punto | 19 → 20 % |
| Aplicar la consistencia, ficha (+18 datos), navegador, plan, commit y deploy | Opus medio y la sesión | < 1 punto | 20 → 26 % |

Lo que encontraron las revisiones:
- **Hechos: 117 correcciones (4 graves).** Las graves: 10¹⁸ llaves/s no es «más que todas las computadoras del mundo» (la red de bitcoin calcula ≈ 10²¹ hashes/s); Argon2 y bcrypt no vienen en la biblioteca estándar de Python (sí PBKDF2 y scrypt); el ALB no agrega un header con el `client_id`, pasa el token tal cual; y mandar datos a la nube o al proveedor de etiquetado no es una «transferencia» en la ley mexicana sino una «remisión» a un encargado. De las 132 dudas de los escritores, 88 (67 %) estaban bien tal cual. Lo legal se verificó contra el DOF.
- **Claridad: 419 cambios**, la mayoría conocimiento supuesto (siglas y piezas de Alba sin presentar: ALB, pod, EKS, IRSA, CVSS…). Las 4 lecciones quedaron en 60 min de lo esencial moviendo detalle a `:::profundo`, sin quitar ideas.
- **Mecánica: 49 hallazgos**, casi todos de coherencia y redondeo (una figura que dibujaba HS256 cuando Alba firma con RS256, «390» contra «391» veces la edad del universo).
- **Consistencia: 19 hallazgos.** Los más útiles: explicaciones repetidas de otras lecciones (pickle de `formatos`, token bucket de `balanceo`, fijar con hash de `python-ecosistema`) que se cortaron a un enlace; la misma GPU con tres velocidades (ahora 2.2 × 10¹⁰ medida, 2 × 10¹⁰ redondeada); y la ficha atrasada respecto a lo corregido. `http.md` dejó de leerse como si Alba usara mTLS.
- Las fotos del producto: la ficha usa 2 TB/día (10 M × 200 KB) como cifra redonda; las fotos nuevas de publicaciones son ≈ 1.5 TB. Quedó anotado en la ficha y las lecciones siguen en 2 TB.

Para la fase 10: mismo flujo. Lo que la Ronda tiene mal de seguridad (remisión contra transferencia, ShellTorch como grupo de fallos, el ALB y `aud`, la vida típica de los tokens) está en `revision/*-hechos.md` de la carpeta de la fase, sección «Para la Ronda».

**Fase 10 (2026-11-14): ≈ 2.5 % por lección, 2 lecciones de estación.** Son las primeras lecciones por estación: «Datos y etiquetas» y «Versionado y linaje». Cada una cuenta un paso del sistema de Alba como trabajo completo (qué entra, qué sale, cada decisión con su número y qué se rompe) y recuerda con enlace lo que ya enseñaron `ejemplos`, `almacenamiento`, `tiempo-hash` y `pruebas-ci`. El límite semanal pasó de 37 % a 42 %. Todo cupo en la ventana de 5 horas que empezó a las 06:50, que pasó de 27 % a 59 % (el usuario ya había pedido no esperar el reinicio, porque lo que sobra de una ventana se pierde). Por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Paquetes, reparto, encargos y grupo `estaciones_datos` de la ficha (41 datos) | Sonnet bajo y la sesión | ≈ 1 punto | 27 → 31 % |
| Escritores de las 2 lecciones, en paralelo (≈ 22 min, ≈ 311k tokens cada uno), más decidir la línea de tiempo del snapshot | Opus, medio | ≈ 1 punto (≈ 0.5 por lección) | 31 → 40 % (≈ 4 por lección) |
| Revisión mecánica, las 2 | Sonnet, bajo | < 1 punto | 40 → 41 % |
| Hechos y claridad, las 2, en tubería (cada lección pasa a la siguiente revisión al terminar la anterior) | Opus, alto | 2 puntos | 41 → 54 % |
| Consistencia (15 hallazgos) | Sonnet, bajo | < 1 punto | 54 → 55 % |
| Aplicar la consistencia y bajar los minutos, `npm run check`, navegador, plan, commit y deploy | Opus medio y la sesión | ≈ 1 punto | 55 → 59 % |

Sale más caro por lección que la fase 9 (≈ 1.5 %) porque los costos fijos de la fase (paquetes, ficha, reparto, consistencia y cierre) se reparten entre 2 lecciones y no entre 4 o 5. Las piezas por lección costaron lo mismo que en las fases 8 y 9.

Lo que encontraron las revisiones:
- **La línea de tiempo del snapshot.** Las fuentes no decían cuándo se arma un snapshot. Los dos borradores lo armaban el día que dice su nombre, y así la cadena del borrado de Ana de «Datos personales y la ley» no cuadraba. Se fijó en la ficha (conflicto 36): `ds-2026-09-01` es el snapshot de septiembre y lo arma la corrida del 1 de octubre, que ese mismo día entrena `resnet50-2026-10-01`. Las revisiones de hechos corrigieron cada fecha que dependía de eso.
- **Hechos: 101 correcciones (7 graves).** Las graves: publicar un snapshot copiando (`CopyObject`) hacia un prefijo que exige `If-None-Match` falla siempre según AWS, así que se publica con `PUT`; Delta Lake no tiene etiquetas e Iceberg sí tiene ramas; una URL prefirmada de 15 minutos se firma cuando la persona abre la foto, no al mandar la cola. De las 38 dudas de los escritores, 28 estaban bien tal cual.
- **Claridad: 209 cambios**, 115 de conocimiento supuesto. También 24 de letras: la \(a\) y la \(b\) de kappa chocaban con las personas A y B, y «margen» tenía dos sentidos.
- **Mecánica: 29 hallazgos**, casi todos de la línea de tiempo y de redondeo (105 contra 106 días, σ escrita de tres formas).
- **Consistencia: 15 hallazgos.** Los más útiles: cómo salen 1.93 M de filas de ≈ 75 M de publicaciones al mes (ahora `snapshot_composicion`); dónde corre cada chequeo, que estaba contado de tres maneras; `privacidad` decía que los snapshots caducan (conflicto 39); y repeticiones de `formatos`, `pruebas-ci` y `almacenamiento`, que ahora son recordatorios con enlace.
- Se corrigieron de paso `git.md` (Alba no usa DVC, conflicto 38), `almacenamiento.md` («Lo que sigue» y Object Lock) y `privacidad.md` (los snapshots no caducan).

Para la fase 11: mismo flujo. Con 3 lecciones, los costos fijos pesan menos. Las «Decisiones de la integración» (§5 del reparto) funcionaron: cuando los escritores destapan un hueco de la ficha, la sesión lo decide una vez y las revisiones de hechos lo aplican en cada lección. Lo que la Ronda tiene mal de esta fase está en `.solo/fase10/revision/*-hechos.md`, sección «Para la Ronda».

**Fase 11 (2026-11-14): ≈ 1.7 % por lección, 3 lecciones de estación.** «Entrenamiento y experimentos», «Gate de evaluación y registry» y «Export, engine y paridad». La sesión empezó con una ventana nueva (2 %) y todo cupo en ella, hasta 40 %. El límite semanal pasó de 42 % a 47 %. Por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Paquetes (≈ 16 min), ficha `estaciones_modelo` (60 datos, conflictos 40–43), reparto y encargos | Sonnet bajo y la sesión | < 1 punto | 2 → 6 % |
| Escritores de las 3 lecciones, en paralelo (19–22 min, 285–320k tokens cada uno), más decisiones de integración | Opus, medio | ≈ 2 puntos (≈ 0.7 por lección) | 6 → 20 % (≈ 4.7 por lección) |
| Mecánica (3) y hechos (3), en tubería | Sonnet bajo y Opus alto | ≈ 1 punto | 20 → 29 % |
| Claridad (3), consistencia (17 hallazgos) y aplicarla | Opus alto, Sonnet bajo y Opus medio | ≈ 2 puntos | 29 → 39 % |
| `npm run check`, navegador, arreglo del build, plan, commit y deploy | La sesión | < 1 punto | 39 → 40 % |

Lo que encontraron las revisiones:
- **Huecos de la ficha que decidió la integración.** Ninguna fuente decía en qué GPU entrena Alba, y «≈ 3–4 h, ≈ US$10–50» no cuadraba con una T4 (≈ US$2). Ahora (conflicto 40) entrena en una A10G (g5.xlarge) on-demand: una corrida cuesta ≈ US$3–4 de GPU y los ≈ US$10–50 son el gasto del mes con las corridas de prueba. Además: arranca de ImageNet y no del champion (`aprender.md` decía lo contrario y se corrigió), son 4 pasos con GPU en dos tipos de tarjeta (conflicto 41), el recall de una categoría falla solo si la caída es significativa (conflicto 42), y el gate aprueba pero la versión se registra como `challenger` al final del export (conflicto 43). Las versiones del registry quedaron numeradas: 14 = `resnet50-2026-10-01`.
- **Hechos: 82 correcciones (3 graves).** Las graves: un genérico se aprueba por bioequivalencia, no por no inferioridad (la analogía de e04 estaba mal); con `dynamo=False` el exportador ya pone el modelo en eval por su cuenta, el riesgo es del exportador nuevo; y la velocidad de la A10G no tiene benchmark público (ahora es estimación a medir). De las 75 dudas de los escritores, 61 (81 %) estaban bien tal cual.
- **Claridad: 230 cambios**, 102 de conocimiento supuesto y 24 de letras.
- **Mecánica: 38 hallazgos**, casi todos de redondeo y coherencia (30 de 36 discrepancias escritas como 24; «US$2 al mes» que era por corrida).
- **Consistencia: 17 hallazgos.** Los más útiles: las lecciones anteriores que los conflictos 40–43 mandaban cambiar (`e02-versionado`, `pruebas-ci`, `camino-completo`, `flops`), el no determinismo de CUDA y la tabla de paridad explicados otra vez a fondo (ahora son recordatorios con enlace), y quién hornea el engine en la imagen (es de «Empaquetado con Docker»).
- **Un bug del build que ya estaba publicado:** un enlace del glosario con código en su texto (por ejemplo `[[labels-json|…]]` con `labels.json` entre comillas de código) salía como «undefined» en 5 lecciones publicadas (`pytorch`, `balanceo`, `privacidad`, `python-ecosistema`, `identidad`) y en el glosario. La llamada anidada de `inline` en `tools/md.mjs` usaba otro arreglo de marcas; ahora lo comparte.

Para la fase 12: mismo flujo. Con una sola lección (e06), los costos fijos pesan más: conviene juntarla con la 13 si caben en una ventana. Lo que la Ronda tiene mal de esta fase está en `.solo/fase11/revision/*-hechos.md`, sección «Para la Ronda» (MLflow 3 y `log_model`, el ECE leído como error fijo, el descuento spot de la g5, la portabilidad de un engine).

**Fases 12 y 13 (2026-11-14): ≈ 2 % por lección, 3 lecciones de estación en una sola tanda.** «Código de serving» (estación 6), «Empaquetado con Docker» (estación 7) y «CI/CD y registro de imágenes» (estación 8). La fase 12 tenía una sola lección y se juntó con la 13 para repartir los costos fijos. La sesión empezó con una ventana nueva (2 %) y todo cupo en ella, hasta ≈ 50 %. El límite semanal pasó de 47 % a 53 %. Por pieza:

| Pieza | Modelo y esfuerzo | Semanal | Ventana de 5 h |
|---|---|---|---|
| Paquetes (≈ 19 min, 516k tokens), ficha `estaciones_api` y `estaciones_contenedor` (46 datos, conflictos 44–45), reparto y encargos | Sonnet bajo y la sesión | ≈ 1 punto | 2 → 8 % |
| Escritores de las 3 lecciones, en paralelo (21–25 min, 314–365k tokens cada uno), más decisiones de integración | Opus, medio | ≈ 2 puntos (≈ 0.7 por lección) | 8 → 24 % (≈ 5.3 por lección) |
| Mecánica (3) y hechos (3), en tubería, más el ALB en modo `ip` y la ficha con los CORRIGE | Sonnet bajo y Opus alto | ≈ 2 puntos | 24 → 36 % |
| Claridad (3), consistencia (13 hallazgos) y aplicarla | Opus alto, Sonnet bajo y Opus medio | ≈ 1 punto | 36 → 48 % |
| `npm run check`, navegador, plan, commit y deploy | La sesión | < 1 punto | 48 → ≈ 50 % |

Lo que encontraron las revisiones:
- **Huecos de la ficha que decidió la integración.** Ninguna fuente traía los workflows de Alba, la retención del registro, quién aprueba ni dónde vive `labels.json` al servir. Ahora: el workflow es el de «Pruebas y CI/CD», completado con el push a ECR, el digest y la aprobación; ECR guarda 200 imágenes del gateway y 12 de Triton; aprueba una persona del equipo en el environment `produccion` (Alba tiene GitHub Enterprise, conflicto 50); `labels.json` viaja con el modelo en un ConfigMap por versión (conflicto 45); la tercera paridad corre en el runner con T4 antes de staging (conflicto 46). El camino del merge a producción es ≈ 17.5 min, no 12.5, porque la paridad ocupa ≈ 5 min con la T4 efímera (conflicto 49).
- **Hechos: 85 correcciones (4 graves).** Las graves: con el controlador del balanceador de AWS en modo `ip`, un pod que falla su readiness sale del target group, así que si caen todos el ALB contesta 503 él mismo (no «falla abierto», conflicto 47, corregido también en «Balanceadores»); la forma shell de `CMD` no siempre pierde la señal, porque el `sh` de Debian (dash) se reemplaza por el último comando (conflicto 48, corregido en «Programa, proceso e hilo» y «La terminal»); `concurrency` de GitHub Actions no pone las corridas en fila: la nueva cancela a la que esperaba; y la paridad en la T4 efímera tarda ≈ 5 min, no 1. De las 97 dudas de los escritores, 80 (82 %) estaban bien tal cual.
- **Claridad: 367 cambios**, 184 de conocimiento supuesto (clúster, nodo, pod, PID 1, SIGTERM, release de NGC, `${{ }}`…) y 35 de letras.
- **Mecánica: 44 hallazgos**, casi todos de cuentas y orígenes (un PNG de 48 MP que «pesa menos que 2 fotos», un `.dockerignore` «de 25 líneas» con 19 patrones).
- **Consistencia: 13 hallazgos**, todos en lecciones anteriores o en la ficha: `programa-proceso`, `terminal`, `pruebas-ci`, `git` y `ataques`. También la línea de log: la revisión de e06 midió ≈ 450 B con sus campos, y se decidió usar la misma línea compacta de «Formatos» (≈ 300 B), que usan 8 lecciones.
- **Un arreglo del build:** `tools/mate.mjs` dibujaba `t_{prod}` como ∏; ahora un subíndice que es solo «sum» o «prod» sale como palabra.
- `programa-proceso` (63 min) y `terminal` (62 min) ya pasaban de 60 min de lo esencial antes de esta fase; siguen así.

Para la fase 14: mismo flujo, con las estaciones 9 y 10 (Kubernetes y rollout). Lo que la Ronda y el Dojo tienen mal de estas fases está en `.solo/fase12-13/revision/*-hechos.md`, sección «Para la Ronda» (el 503 del ALB en modo `ip` sí lo dice bien la Ronda; la forma shell, `concurrency` en la hoja de Git, `python:3.13-slim` en Debian 13, los «10 s» del Dojo sin medir).

**Lección aprendida: las esperas entre ventanas van en una sesión nueva y corta.** Una sesión larga gasta ≈ 2 % de la ventana por turno solo en releer su contexto. Una sesión que espera el reinicio y despierta con cada agente que termina se come la ventana sin hacer trabajo. Lo barato es cerrar la sesión larga y que una sesión nueva, con un encargo corto, haga la espera y lance la tanda siguiente.

## 5. Las fases

Las fases 2 (profundizada al estándar nuevo), 3 y 4 están publicadas desde el 2026-11-05, la 5, la 6 y la 7 desde el 2026-11-06 la 8 desde el 2026-11-13 y la 9, la 10, la 11, la 12 y la 13 desde el 2026-11-14: 55 lecciones de ≈ 8.4–11.8k palabras, cada una con revisión independiente. Las 5 de la fase 4 (10.0–10.9k palabras, ≈ 59–60 min lo esencial y 74–79 min todo), las 6 de la fase 5 (9.3–10.3k palabras, 58–60 min lo esencial y 72–76 min todo) las 5 de la fase 6 (9.8–10.7k palabras, 58–59 min lo esencial y 72–76 min todo) las 6 de la fase 7 (9.4–10.3k palabras, 55–60 min lo esencial y 70–75 min todo) las 5 de la fase 8 (9.4–10.3k palabras, 60–61 min lo esencial y 70–75 min todo) las 4 de la fase 9 (10.1–10.6k palabras, 60 min lo esencial y 72–76 min todo) las 2 de la fase 10 (10.8–11.0k palabras, 59–60 min lo esencial y 78 min todo) las 3 de la fase 11 (9.1–10.3k palabras, 59–60 min lo esencial y 67–73 min todo) y las 3 de las fases 12 y 13 (9.8–10.0k palabras, 59–60 min lo esencial y 71–76 min todo) pasaron cada una por revisión mecánica, de hechos y de claridad. Cada fase termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión), con commit y publicada. Antes del commit, el contenido pasa por una revisión independiente de hechos y de conocimiento supuesto.

| Fase | Módulo | Lecciones | Prepara para la Ronda (nota interna, no va en la app) |
|---|---|---|---|
| 1 ✓ | El mapa | El camino completo | M01 |
| 2 ✓ (profundizada) | Lo básico de ML | Qué es un modelo · Una foto, vista por un modelo · Datos, ejemplos, features y etiquetas · Cómo aprende un modelo · ¿Aprendió de verdad? · Redes neuronales y CNNs · Embeddings · Transformers y LLMs | M01, M04, M07–M12, M14 |
| 3 ✓ | Números y estadística para producción | Unidades y estimaciones · Percentiles · Probabilidad para sistemas que fallan · Ruido, muestras y pruebas A/B · Comparar distribuciones · Cómo guarda números una computadora · Matrices y FLOPs | M01, M03, M04, M08, M10–M13, M15 |
| 4 ✓ | La computadora por dentro | Programa, proceso e hilo · Memoria, caché y disco · CPU y GPU · El sistema operativo · async, event loop y GIL | M02–M08, M15 |
| 5 ✓ | La red y la web | IP, puertos y DNS · HTTP · APIs: REST, JSON, gRPC y streaming · Balanceadores y gateways · Timeouts, reintentos e idempotencia · Latencia y throughput | M02, M03, M06, M07, M11, M13–M15 |
| 6 ✓ | Datos y almacenamiento | Formatos · Bases de datos · Object storage, data lakes y warehouses · Colas y streams · Tiempo, hashes e identificadores | M01, M02, M06, M09, M12, M13, M15 |
| 7 ✓ | Herramientas del oficio | La terminal · Python y sus paquetes · PyTorch para producción · Git · Pruebas y CI/CD · Configuración y secretos | M05–M11, M15 |
| 8 ✓ | La nube | Qué es la nube · Regiones y zonas · Máquinas, GPUs y precios · Redes en la nube · Servicios gestionados y permisos | M04, M06, M13, M15 · base de IA Privada (`content/datos/gpus.json`) |
| 9 ✓ | Seguridad | Cifrado, llaves y certificados · Autenticación y permisos · Datos personales y la ley · Ataques y cadena de suministro | M05, M07, M09, M15 |
| 10 ✓ | Estaciones · Datos | Estaciones 1 y 2 de Alba | M09, M10 |
| 11 ✓ | Estaciones · Modelo | Estaciones 3, 4 y 5 de Alba | M08, M10, M11 |
| 12 ✓ | Estaciones · API | Estación 6 | M03, M07 |
| 13 ✓ | Estaciones · Contenedor | Estación 7 y 8 | M05, M10 |
| 14 | Estaciones · Orquestación | Estación 9 y 10 | M06, M11 |
| 15 | Estaciones · Monitoreo | Estación 11 y 12 | M03, M12 |
| 16 | Integración | El Dojo y la Ronda enlazan desde sus propias apps a las lecciones de Sensei (Sensei solo los enlaza desde `/que-sigue/`), hay repaso con tarjetas del glosario y una revisión final de hechos | Todo |

Los módulos 1 a 9 van antes que las estaciones porque son los cimientos de verdad. Sin ellos, la lección de la estación 1 tendría que suponer qué es un modelo, una API o un bucket.
