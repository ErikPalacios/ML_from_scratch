# Plan: Sensei

El nombre se cambia en un solo lugar: `apps/sensei/content/sitio.json`. Antes se llamaba «Cimientos». Cambió a Sensei el 2026-11-04 para hacer pareja con el Dojo: en el Dojo practicas, con el Sensei entiendes.

## 1. Qué es y para qué

Sensei es **el curso de teoría de TrueML** y, junto con el Dojo, su app principal. Enseña ML engineering desde cero: cada paso para llevar un modelo de AI o ML a producción, explicado como a alguien que apenas entra a la universidad, pero con la profundidad de un curso universitario introductorio bien hecho.

**La meta principal es aprender de verdad:** entender cada concepto lo suficiente para razonar con él, calcularlo y explicarlo. Lo demás es consecuencia de aprenderlo bien:

- Leer la **Ronda de Diseño ML** completa sin atorarse. Un inventario de sus 15 módulos encontró unos 300 conceptos que da por sabidos, y el temario los cubre todos. Cada lección dice para qué módulos de la Ronda prepara.
- Practicar en el **Dojo** sabiendo qué se hace y por qué.
- Llegar a una entrevista con bases sólidas.

| Herramienta | Para qué sirve |
|---|---|
| Sensei | Entender cada paso desde cero: qué es, por qué existe, cómo se calcula y cómo se conecta con lo demás. |
| Dojo | Construir, rehacer y romper un mini-proyecto de cada paso. |
| Ronda de Diseño | Defender el diseño completo en una entrevista. |

**Por qué se subió el estándar (2026-11-04).** La primera versión de la fase 2 dejaba cada lección en introducción: ≈ 4,300 palabras, 1 diagrama, sin calculadoras ni ejercicios. Un módulo de la Ronda trae ≈ 14,000 palabras, ≈ 7 calculadoras, ≈ 18 tablas y ≈ 31 recuadros. El estándar nuevo de una lección es de 8,000 a 11,000 palabras (al principio se fijó en 7,000 a 10,000), en dos pasadas (lo esencial y lo extra). Trae al menos 2 diagramas, 3 figuras, 2 calculadoras interactivas, 3 cuentas paso a paso, código con su salida real, errores comunes, el concepto en otros casos además de C01, y de 8 a 12 ejercicios con solución. Está en [apps/sensei/GUIA-CONTENIDO.md](../apps/sensei/GUIA-CONTENIDO.md), sección 3.

## 2. Las reglas del contenido

Las reglas completas, los formatos y la lista de revisión están en [apps/sensei/GUIA-CONTENIDO.md](../apps/sensei/GUIA-CONTENIDO.md). En corto:

- No asumir nada.
- Analogías donde ayuden, nunca forzadas, y diciendo dónde se rompen.
- Números con la cuenta a la vista.
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
- **Para leer la Ronda** (`/ronda/`): los 15 módulos de la Ronda, cada uno con las lecciones que preparan para él.
- **El cierre de cada lección:** marcar como leída, la siguiente lección, la estación del Dojo y el módulo de la Ronda.
- **La regla de las dudas:** cuando surja una duda en el Dojo o en la Ronda, la respuesta se agrega o se mejora en el glosario.

## 4. Cómo se trabaja cada fase (proceso ahorrador, desde la fase 4)

En la fase 3 cada lección costó ≈ 1.75 % del límite semanal del plan Max, y una ventana de 5 horas alcanzó para ≈ 5 lecciones. Este proceso baja el gasto sin tocar lo que da la calidad.

1. **Una sesión nueva por fase**, que parte del plan, la guía y los commits, no de una conversación larga.
2. **Tandas del tamaño de una ventana:** unas 5 lecciones. Cada escritor lleva un **presupuesto de palabras por sección** desde el principio (8,000 a 11,000 en total), para no escribir de más y recortar después.
3. **Paquetes de datos de la Ronda:** al empezar la fase, un paso barato extrae por lección los números, definiciones y frases de la Ronda que necesita. Escritores y revisores leen el paquete en lugar de módulos enteros, y pueden buscar en la Ronda lo que falte.
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

## 5. Las fases

Las fases 2 (profundizada al estándar nuevo), 3 y 4 están publicadas desde el 2026-11-05, y la 5 desde el 2026-11-06: 27 lecciones de ≈ 8.4–11.8k palabras, cada una con revisión independiente. Las 5 de la fase 4 (10.0–10.9k palabras, ≈ 59–60 min lo esencial y 74–79 min todo) y las 6 de la fase 5 (9.3–10.3k palabras, 58–60 min lo esencial y 72–76 min todo) pasaron cada una por revisión mecánica, de hechos y de claridad. Cada fase termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión), con commit y publicada. Antes del commit, el contenido pasa por una revisión independiente de hechos y de conocimiento supuesto.

| Fase | Módulo | Lecciones | Prepara para la Ronda |
|---|---|---|---|
| 1 ✓ | El mapa | El camino completo | M01 |
| 2 ✓ (profundizada) | Lo básico de ML | Qué es un modelo · Una foto, vista por un modelo · Datos, ejemplos, features y etiquetas · Cómo aprende un modelo · ¿Aprendió de verdad? · Redes neuronales y CNNs · Embeddings · Transformers y LLMs | M01, M04, M07–M12, M14 |
| 3 ✓ | Números y estadística para producción | Unidades y estimaciones · Percentiles · Probabilidad para sistemas que fallan · Ruido, muestras y pruebas A/B · Comparar distribuciones · Cómo guarda números una computadora · Matrices y FLOPs | M01, M03, M04, M08, M10–M13, M15 |
| 4 ✓ | La computadora por dentro | Programa, proceso e hilo · Memoria, caché y disco · CPU y GPU · El sistema operativo · async, event loop y GIL | M02–M08, M15 |
| 5 ✓ | La red y la web | IP, puertos y DNS · HTTP · APIs: REST, JSON, gRPC y streaming · Balanceadores y gateways · Timeouts, reintentos e idempotencia · Latencia y throughput | M02, M03, M06, M07, M11, M13–M15 |
| 6 | Datos y almacenamiento | Formatos · Bases de datos · Object storage, data lakes y warehouses · Colas y streams · Tiempo, hashes e identificadores | M01, M02, M06, M09, M12, M13, M15 |
| 7 | Herramientas del oficio | La terminal · Python y sus paquetes · PyTorch para producción · Git · Pruebas y CI/CD · Configuración y secretos | M05–M11, M15 |
| 8 | La nube | Qué es la nube · Regiones y zonas · Máquinas, GPUs y precios · Redes en la nube · Servicios gestionados y permisos | M04, M06, M13, M15 |
| 9 | Seguridad | Cifrado, llaves y certificados · Autenticación y permisos · Datos personales y la ley · Ataques y cadena de suministro | M05, M07, M09, M15 |
| 10 | Estaciones · Datos | Estación 1 y 2 de C01 | M09, M10 |
| 11 | Estaciones · Modelo | Estación 3, 4 y 5 | M08, M10, M11 |
| 12 | Estaciones · API | Estación 6 | M03, M07 |
| 13 | Estaciones · Contenedor | Estación 7 y 8 | M05, M10 |
| 14 | Estaciones · Orquestación | Estación 9 y 10 | M06, M11 |
| 15 | Estaciones · Monitoreo | Estación 11 y 12 | M03, M12 |
| 16 | Integración | Cada estación del Dojo y cada módulo de la Ronda enlaza a sus lecciones de Sensei, hay repaso con tarjetas del glosario y una revisión final de hechos | Todo |

Los módulos 1 a 9 van antes que las estaciones porque son los cimientos de verdad. Sin ellos, la lección de la estación 1 tendría que suponer qué es un modelo, una API o un bucket.
