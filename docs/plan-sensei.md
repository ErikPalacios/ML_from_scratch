# Plan: Sensei

El nombre se cambia en un solo lugar: `apps/sensei/content/sitio.json`. Antes se llamaba «Cimientos». Cambió a Sensei el 2026-11-04 para hacer pareja con el Dojo: en el Dojo practicas, con el Sensei entiendes.

## 1. Qué es y para qué

Sensei es la teoría desde cero de cada paso para llevar un modelo de AI o ML a producción. Lo explica como a alguien que apenas entra a la universidad, pero todo enfocado en AI y ML.

**La meta:** que después de Sensei se pueda leer la **Ronda de Diseño ML** completa sin atorarse.

La Ronda da por sabidos unos 300 conceptos. Un inventario de sus 15 módulos y del caso C01 los agrupó en nueve temas: lo básico de ML, matemáticas y estadística, la computadora por dentro, redes y web, datos y almacenamiento, herramientas, nube, seguridad y unidades. Sensei los cubre todos, y cada lección dice para qué módulos de la Ronda prepara.

| Herramienta | Para qué sirve |
|---|---|
| Sensei | Entender cada paso desde cero: qué es, por qué existe y cómo se conecta con lo demás. |
| Dojo | Construir, rehacer y romper un mini-proyecto de cada paso. |
| Ronda de Diseño | Defender el diseño completo en una entrevista. |

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

## 4. Las fases

Cada fase termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión), con commit y publicada. Antes del commit, el contenido pasa por una revisión independiente de hechos y de conocimiento supuesto.

| Fase | Módulo | Lecciones | Prepara para la Ronda |
|---|---|---|---|
| 1 ✓ | El mapa | El camino completo | M01 |
| 2 | Lo básico de ML | Qué es un modelo · Una foto, vista por un modelo · Datos, ejemplos, features y etiquetas · Cómo aprende un modelo · ¿Aprendió de verdad? · Redes neuronales y CNNs · Embeddings · Transformers y LLMs | M01, M04, M07–M12, M14 |
| 3 | Números y estadística para producción | Unidades y estimaciones · Percentiles · Probabilidad para sistemas que fallan · Ruido, muestras y pruebas A/B · Comparar distribuciones · Cómo guarda números una computadora · Matrices y FLOPs | M01, M03, M04, M08, M10–M13, M15 |
| 4 | La computadora por dentro | Programa, proceso e hilo · Memoria, caché y disco · CPU y GPU · El sistema operativo · async, event loop y GIL | M02–M08, M15 |
| 5 | La red y la web | IP, puertos y DNS · HTTP · APIs: REST, JSON, gRPC y streaming · Balanceadores y gateways · Timeouts, reintentos e idempotencia · Latencia y throughput | M02, M03, M06, M07, M11, M13–M15 |
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
