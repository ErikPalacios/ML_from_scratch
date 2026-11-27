# Plan: IA Privada

Nombre de trabajo: «IA Privada». Se cambia en un solo lugar cuando exista la app (`apps/ia-privada/content/sitio.json`, igual que Sensei).

## 1. Qué es y para qué

IA Privada es la app de TrueML para **AI systems engineering**, contada desde un caso concreto: **llevar modelos open weight a una empresa y operarlos en su propio hardware**.

**Por qué ese centro y no AI systems en general:**

- **Es lo que se puede vender.** El negocio no es revender servidores (margen bajo, capital inmovilizado, GPUs que pierden valor rápido). Es dimensionar qué necesita cada cliente, montar el stack, demostrar con evals que el modelo abierto sirve y mantenerlo funcionando.
- **Es lo que no está en ningún otro lado de TrueML.** Sensei da los cimientos (GPU, memoria, latencia, la nube) y el Dojo la práctica general. Nadie cubre «esta empresa necesita IA privada: ¿qué compro, cómo lo monto y cuánto cuesta?».
- **No deja fuera lo general.** Serving, RAG, agentes, evals, gateways y observabilidad están en el temario, porque un cliente con IA privada también los necesita. Solo se cuentan desde ese caso.
- **Sirve igual para conseguir trabajo.** Inference, cuantización, sizing, serving y evals son las habilidades que piden los puestos de AI/ML infra.

**Para quién:** primero para Erik (aprender y armar el negocio), después para cualquiera dentro de TrueML.

| Pieza | Para qué sirve | Dónde vive |
|---|---|---|
| **Lecciones** (el Sensei de la app) | Entender cada concepto desde cero, con el estándar de Sensei | `apps/ia-privada` |
| **Herramientas** | Calcular VRAM, velocidad, cuántas GPUs y costo total | `apps/ia-privada` |
| **Casos** | Dimensionar empresas ficticias de principio a fin, como en la Ronda | `apps/ia-privada` |
| **Dojo · rama IA Privada** | Construir, romper y arreglar el stack con las 4 rondas del Taller | `apps/taller-ai` (kits y estaciones), enlazada desde la app |

La práctica vive en el Dojo para no duplicar su método, sus kits ni su tablero. En la app se ve como una sección más: el menú lleva al Dojo y cada estación regresa a sus lecciones.

## 2. Qué se reutiliza

- **De Sensei:** el formato de lectura (barra lateral, hoja con secciones numeradas, «En esta página»), el motor de diagramas, el glosario con globos, las calculadoras, `tools/build.mjs` y `tools/check.mjs`, y las reglas de [apps/sensei/GUIA-CONTENIDO.md](../apps/sensei/GUIA-CONTENIDO.md) (8–11k palabras, figuras a mano, ejercicios con solución, hechos verificados).
- **Lecciones de Sensei que ya existen y se enlazan, no se repiten:** CPU y GPU · Cómo guarda números una computadora · Matrices y FLOPs · Memoria, caché y disco · Latencia y throughput · Transformers y LLMs · Embeddings · Balanceadores y gateways · APIs y streaming.
- **De Sensei, ya terminadas (2026-11-15):** *Qué es la nube* (comprar o rentar, CapEx y OpEx, on-premises, neoclouds), *Máquinas, GPUs y cómo se cobran* y *Datos personales y la ley*. Son la base del TCO y del discurso de privacidad.
- **Lo que Sensei ya cubre a fondo y aquí no se repite (revisión 2026-11-25):** prefill y decode, KV cache, pesos en la GPU y MoE (*Transformers y LLMs*); INT4, FP8, punto cero y el examen de calidad (*Cómo guarda números una computadora*); HBM, PCIe y NVLink (*CPU y GPU*); las GPUs que se rentan y sus precios (*Máquinas*); comprar o rentar (*Qué es la nube*). Las lecciones de esta app parten de ahí y van más a fondo.
- **Datos y calculadoras de Sensei:** `apps/sensei/content/datos/gpus.json` es la única fuente de especificaciones y precios de renta de GPUs (ya dice que también es para esta app). Las calculadoras de esta app extienden las de Sensei en vez de duplicarlas: `llms-kv`, `pytorch-vram`, `numeros-maquina-cuantizar`, `flops-tokens` y `nube-comprar-rentar`. Lo que falta y se agrega aquí: precios de **compra** de hardware, con fecha y fuente.
- **Del Atlas:** la calculadora de arquitecturas, como punto de partida de la calculadora de VRAM.
- **Del Taller:** el molde de 7 piezas por estación, `verificar.py`, `romper.py`, los prompts y el tablero.
- **De TrueML:** el Dojo design (`tokens.css`, `trueml-mark.js`), el encabezado común y `sync.mjs`.

## 3. Lecciones (≈ 21, en 11 módulos)

Cada módulo dice qué lecciones de Sensei da por leídas. Los nombres exactos de modelos, GPUs, licencias y precios se verifican en la fase que los escribe, nunca de memoria. Cada concepto se define desde cero antes de usarlo, con una analogía, como en Sensei.

**Revisión 2026-11-25:** de ≈ 24 a ≈ 21 lecciones. Lo que Sensei ya explica a fondo (sección 2) se da por leído, y las lecciones de aquí van a lo que Sensei no cubre: batching continuo, formatos de cuantización en la práctica, comprar hardware, sizing, serving y el negocio.

| # | Módulo | Lecciones | Da por leído (Sensei) |
|---|---|---|---|
| 1 | El mapa | El recorrido de un proyecto de IA privada: descubrimiento → sizing → compra → despliegue → evals → operación | El camino completo |
| 2 | Los modelos abiertos | Open weight, open source y licencias · Elegir un modelo para la tarea: familias, tamaños y benchmarks | Transformers y LLMs (incluye dense y MoE) |
| 3 | La inferencia por dentro | Batching continuo y PagedAttention · Concurrencia: la curva de usuarios contra latencia | Transformers y LLMs (prefill, decode y KV cache) · Matrices y FLOPs · Latencia y throughput |
| 4 | Que quepa y que vuele | Formatos de cuantización en la práctica (GGUF, AWQ, GPTQ, FP8) y su calidad medida · Speculative decoding y contexto largo | Cómo guarda números una computadora (INT4, FP8, el examen) |
| 5 | El hardware | Comprar hardware: de la workstation al rack, NVIDIA, AMD y Apple · El cuarto: energía, enfriamiento y red | CPU y GPU (HBM, NVLink) · Máquinas, GPUs y cómo se cobran |
| 6 | Dimensionar | De requisitos a hardware (usuarios, tokens, latencia) · Varias GPUs: tensor y pipeline parallel | Percentiles · Unidades y estimaciones |
| 7 | El stack de serving | Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM · Gateway, API compatible con OpenAI, autenticación y varios modelos | APIs · Balanceadores y gateways |
| 8 | Lo que el cliente pide encima | RAG privado: embeddings y vector DB locales · Agentes, tools y guardrails | Embeddings |
| 9 | Evals | Demostrar que el modelo abierto sirve: golden sets, LLM-as-judge y regresiones · Pruebas de carga y benchmarks honestos | ¿Aprendió de verdad? · Ruido, muestras y pruebas A/B |
| 10 | Operar | Observabilidad de GPUs e inferencia · Seguridad: aislamiento, sin internet (air-gapped) y actualizaciones | Datos personales y la ley |
| 11 | El negocio | TCO: API vs. nube vs. servidor propio, con depreciación, y punto de equilibrio · Cotizar, proponer y dar soporte (SLAs, contrato, importación de hardware en México) | Qué es la nube (comprar o rentar) |

## 4. Herramientas

Todas corren en el navegador, sin conexión, y muestran la cuenta paso a paso (como las calculadoras de Sensei).

1. **VRAM:** pesos según parámetros y cuantización, más KV cache según contexto y usuarios simultáneos, más overhead. Dice si cabe en una GPU dada.
2. **Velocidad:** estimación de tokens/s en decode a partir del ancho de banda de memoria, y del tiempo al primer token (TTFT) a partir de los FLOPs. Se compara contra benchmarks publicados y se dice cuánto se desvía.
3. **Sizing:** de «N usuarios, X tokens por día, latencia objetivo» a cuántas GPUs y de cuál tipo.
4. **TCO y punto de equilibrio:** API por token vs. GPU rentada vs. servidor propio, con depreciación, energía y operación.
5. **Catálogo de hardware:** tabla filtrable de GPUs y equipos con VRAM, ancho de banda, consumo y precio de referencia con fecha y fuente.

Las herramientas van primero en el roadmap: son rápidas de hacer, sirven desde el día uno para el negocio y dan material para los reels.

## 5. Casos de dimensionamiento

Empresas ficticias resueltas de principio a fin: requisitos → cálculos con las herramientas → propuesta de hardware y stack → evals → riesgos → costo. El formato sigue la Ronda.

1. Despacho de abogados: RAG sobre sus expedientes.
2. Clínica: datos de salud que no pueden salir de su red.
3. Fábrica: asistente sobre manuales técnicos, en planta.
4. Financiera: resumen y clasificación de llamadas a escala.
5. Dependencia de gobierno: todo sin internet (air-gapped).
6. Startup SaaS: varios clientes sobre el mismo servidor (multi-tenant).

## 6. Dojo · rama IA Privada

Sigue el molde del Taller ([plan-taller-ai.md](plan-taller-ai.md), secciones 3–5): conceptos exprés, guiado, solo, romper con ayuda, romper solo y prompts. El kit marca en cada estación dónde corre.

| Estación | Qué construyes | Dónde corre |
|---|---|---|
| 1 | Levantar un modelo local y llamarlo por API | Mac |
| 2 | Medir: TTFT, tokens/s y calidad con 3 cuantizaciones | Mac |
| 3 | Servir con vLLM y aguantar carga concurrente | GPU rentada |
| 4 | Gateway: varios modelos, autenticación y límites | Mac |
| 5 | Tu RAG, al despacho: el RAG del entrenamiento RAG en el servidor, sin internet y con el modelo propio | Mac |
| 6 | El gate con el modelo propio: el mismo golden set y guardrails para que nada salga de la red | Mac |
| 7 | Observabilidad y fallas en producción | GPU rentada |
| 8 | Entrega a un cliente: paquete instalable sin internet | Mac y GPU rentada |

**Esta rama absorbe la rama LLM/RAG del Taller** (2026-11-12). Las 5 estaciones que el Taller tenía pensadas para LLM/RAG (ingestión y chunking, índice y embeddings, evaluación de retrieval, serving del LLM y guardrails) quedan cubiertas por las estaciones 3, 5 y 6. Así el patrón LLM/RAG (C11) se practica una sola vez, y además con serving en hardware propio. Se ahorran ≈ 3 fases.

**Cambio (2026-11-17): RAG es un entrenamiento propio y las estaciones 5 y 6 se recortan.** El Dojo ahora tiene el entrenamiento RAG (caso C11, 12 estaciones en la Mac: [plan-taller-ai.md](plan-taller-ai.md), sección 12), que construye el RAG completo: ingestión, chunking, permisos, golden set, índice, retrieval, la API con citas y el gate de evals. Para no construirlo dos veces, IA Privada da por hecho ese entrenamiento: su estación 5 lleva tu RAG al servidor del despacho (sin internet, con el modelo propio) y la 6 corre el mismo gate del golden set contra ese modelo, con guardrails para que nada salga de la red. Lo de abajo sobre «absorber la rama LLM/RAG» queda como historia.

**Lo que corre solo en la Mac:** las estaciones 1, 2, 4, 5 y 6 corren completas en la Mac, sin GPU rentada. De ellas, **1, 5 y 6 forman un proyecto de RAG completo**: el modelo local con su API (1), el RAG con tus documentos (5) y sus evals con guardrails (6). Así se puede hacer un RAG de punta a punta sin rentar GPU; la 2 (cuantización) y la 4 (gateway) se suman cuando quieras, y la GPU rentada solo hace falta para las estaciones 3, 7 y 8. El Dojo lo muestra en la portada («Sin rentar GPU: 1 → 5 → 6») y lo lee de `apps/taller-ai/content/ramas.json` (campo `sin_gpu`).

**En el Dojo (2026-11-16):** la rama ya está declarada en `apps/taller-ai/content/ramas.json` con sus 8 estaciones, todas «próximamente». Cada estación trae su id, su título, lo que sale, su etapa de la T y dónde corre:

| Estación | id | Etapa de la T | Dónde corre |
|---|---|---|---|
| 1 · Un modelo local por API | `modelo-local` | API | Mac |
| 2 · Medir y cuantizar | `cuantizacion` | Modelo | Mac |
| 3 · Servir con vLLM bajo carga | `vllm` | API | GPU rentada |
| 4 · Gateway de modelos | `gateway` | Orquestación | Mac |
| 5 · Tu RAG, al despacho | `rag` | Datos | Mac |
| 6 · El gate, con el modelo propio | `evals` | Modelo | Mac |
| 7 · Observabilidad y fallas | `observabilidad` | Monitoreo | GPU rentada |
| 8 · Entrega sin internet | `entrega` | Contenedor | Mac y GPU rentada |

El caso de referencia de la rama es el despacho de abogados (caso 1 de la sección 5): los precálculos de cada estación van en dos escalas, «En el despacho» y «En el dojo». Cada página vive en `/ia-privada/<id>/` (por ejemplo `/ia-privada/rag/`). Para hacer una estación: su kit en `apps/taller-ai/kits/ia-privada-<id>/` y su contenido en `content/estaciones/ia-privada-<id>.json` con `"rama": "ia-privada"` y su `etapa`; el resto (portada, tablero, `sync.mjs`) la toma sola.

**Dependencia con el entrenamiento RAG (revisión 2026-11-25):** las estaciones 5 y 6 dan por hecho el RAG del Dojo, que tiene sus 12 estaciones declaradas en `ramas.json` pero ninguna construida. Hacen falta por lo menos sus estaciones 1–9. Su estación 7 («Un LLM local por API») es la misma que la estación 1 de esta rama: se construye una vez, aquí, y el RAG la reutiliza. Por eso la estación 4 va sola en su fase y las estaciones del RAG van antes de las 5–6 (sección 7).

**Hardware de práctica:** lo diario en la Mac con modelos chicos. Las estaciones 3, 7 y 8 usan una GPU NVIDIA rentada por horas, en sesiones cortas y planeadas. Cada una dice antes cuánto tiempo y costo estimado lleva, y trae un script que apaga la máquina al terminar. El proveedor y el precio se eligen en la fase de la estación 3. Comprar hardware propio se decide después de validar el negocio.

## 7. Fases

Cada fase cabe en una ventana de 5 horas y termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión), con commit y publicada. Las lecciones usan el proceso ahorrador de Sensei ([plan-sensei.md](plan-sensei.md), sección 4) con los ajustes de la fase 7: escritores con esfuerzo medio, lanzados al inicio de una ventana y guardando sus pendientes en disco.

**Revisión 2026-11-25: 24 fases.** Un módulo por fase no conviene: los módulos son chicos (1–3 lecciones) y cada fase tiene un costo fijo (paquetes, revisión de fondo, build, chequeos y deploy). Se agrupan 4–5 lecciones por fase, como en Sensei. Las dependencias con Sensei ya se cumplieron (Sensei terminó el 2026-11-15) y las fases del entrenamiento RAG entran antes de las estaciones 5–6.

| Fase | Contenido | Depende de |
|---|---|---|
| 0 ✓ | Este plan | — |
| **App y herramientas** | | |
| 1 ✓ | Esqueleto de la app (armazón de Sensei, Dojo design, portada con las 4 secciones, su subdominio en trueml.app) y calculadora de VRAM. Hecha el 2026-11-25: en vivo en ia.trueml.app | — |
| 2 ✓ | Calculadoras de velocidad, sizing y TCO, más el catálogo de hardware con precios de compra, verificadas contra fuentes. Hecha el 2026-11-25: en vivo en ia.trueml.app | 1 |
| **Lecciones** | | |
| 3 ✓ | Módulos 1–3 (5 lecciones): el mapa · licencias y open weight · elegir modelo · batching continuo y PagedAttention · concurrencia. Hecha el 2026-11-25: en vivo en ia.trueml.app, con la ficha del despacho (`content/despacho.json`) | 1 |
| 4 ✓ | Módulos 4–5 (4 lecciones): formatos de cuantización · speculative decoding y contexto largo · comprar hardware · el cuarto. Hecha el 2026-11-26: en vivo en ia.trueml.app | 3 |
| 5 ✓ | Módulos 6–7 (4 lecciones): de requisitos a hardware · varias GPUs · el stack de serving · gateway. Hecha el 2026-11-26: en vivo en ia.trueml.app | 4 |
| 6 ✓ | Módulos 8–9 (4 lecciones): RAG privado · agentes y guardrails · evals · pruebas de carga. Hecha el 2026-11-26: en vivo en ia.trueml.app | 5 |
| 7 ✓ | Módulos 10–11 (4 lecciones): observabilidad · seguridad y air-gapped · TCO y punto de equilibrio · cotizar y soporte. Hecha el 2026-11-26: en vivo en ia.trueml.app; cierra las 21 lecciones | 6 |
| **Casos** | | |
| 8 ✓ | Casos 1–3: despacho, clínica, fábrica. Hecha el 2026-11-27: en vivo en ia.trueml.app/casos/ | 2, 5 |
| 9 ✓ | Casos 4–6: financiera, gobierno, startup multi-tenant. Hecha el 2026-11-27: en vivo en ia.trueml.app/casos/, con el índice de los 6 | 8 |
| **Dojo IA Privada, primera parte** | | |
| 10 ✓ | Molde de la rama y estaciones 1–2: un modelo local por API · medir y cuantizar (Mac). Hecha el 2026-11-27: en vivo en dojo.trueml.app/ia-privada/modelo-local/ y /ia-privada/cuantizacion/ | 4 |
| 11 | Estación 3: vLLM bajo carga (primera sesión con GPU rentada; se elige el proveedor) | 10 |
| 12 | Estación 4: gateway de modelos | 11 |
| **Entrenamiento RAG** (lo que piden las estaciones 5–6) | | |
| 13 ✓ | RAG · estación 1: conectores y parsing. Hecha el 2026-11-25: en vivo en dojo.trueml.app/rag/ingesta/ | — |
| 14 ✓ | RAG · estación 2: chunking con contexto. Hecha el 2026-11-26: en vivo en dojo.trueml.app/rag/chunking/. Costo medido: ventana de 5 horas 65 → 86 % (25 nov) y 8 → 18 % (26 nov), ≈ 31 puntos en dos ventanas; semanal total 90 → 93 % y 2 → 3 %, ≈ 4 puntos | 13 |
| 15 ✓ | RAG · estación 3: permisos en cada chunk. Hecha el 2026-11-26: en vivo en dojo.trueml.app/rag/permisos/. Costo medido: ventana de 5 horas 22 → ≈ 45 % (hasta el reinicio de las 15:30) y 0 → 10 % en la siguiente, ≈ 33 puntos en dos ventanas; semanal total 4 → 9 %, ≈ 5 puntos (con la fase 5 de IA Privada corriendo en paralelo) | 14 |
| 16 ✓ | RAG · estación 4: golden set. Hecha el 2026-11-26: en vivo en dojo.trueml.app/rag/golden/. Costo medido: ventana de 5 horas 31 → 78 %, ≈ 47 puntos en una ventana; semanal total 12 → 18 %, ≈ 6 puntos (con la fase 6 de IA Privada corriendo en paralelo). Código y contenido en Opus en una sola sesión; la revisión de hechos, un subagente (3 errores y 4 matices, aplicados) | 15 |
| 17 ✓ | RAG · estación 5: embeddings e índice híbrido. Hecha el 2026-11-26: en vivo en dojo.trueml.app/rag/indice/. Costo medido: ventana de 5 horas 2 → 49 %, ≈ 47 puntos en una ventana; semanal total 20 → 26 %, ≈ 6 puntos (con la fase 7 de IA Privada corriendo en paralelo). Código y contenido en Opus en una sola sesión; la revisión de hechos, un subagente Sonnet con web (1 error y 5 matices, aplicados) | 16 |
| 18 ✓ | RAG · estación 6: retrieval y reranker. Hecha el 2026-11-27: en vivo en dojo.trueml.app/rag/retrieval/ (RRF k=60, permisos antes del top-k, reranker `mmarco-mMiniLMv2-L12-H384-v1` int8 local; recall@8 en test: BM25 93.2 %, vectores 98.6 %, fusión y fusión + reranker 100 %, recall@3 87.8 → 94.6 %; 6 fallas). Costo medido: ventana de 5 horas 56 → 87 % (26 nov, pausa por la regla del 90 %) y 0 → 7 % (27 nov), ≈ 38 puntos en dos ventanas; semanal total 27 → 31 % y 33 → 34 %, ≈ 5 puntos (con otras sesiones en paralelo). Código, contenido y revisión de hechos en Opus en una sola sesión | 17 |
| 19 ✓ | RAG · estación 8: la API con citas (su estación 7 reutiliza la estación 1 de IA Privada, fase 10). Hecha el 2026-11-27: en vivo en dojo.trueml.app/rag/rag-api/ (POST /v1/ask con FastAPI 0.165.0 y SSE, Qwen3 0.6B en llama-server; citas validadas contra el contexto y la ACL también en streaming; guardas contra inyección indirecta con un documento envenenado real; «no sé» con umbral −1.0 elegido con dev; primer token p95 ≈ 0.45–0.9 s de 2.5 s; 11 checks y 6 fallas). La 7 del RAG abre /ia-privada/modelo-local/ («misma» en ramas.json). Costo medido: ventana de 5 horas 49 → 61 %, ≈ 12 puntos; semanal total 39 → 41 %, ≈ 2 puntos (con las fases 9 y 10 de IA Privada y la estación 6 del RAG en paralelo). Código, contenido y revisión en Opus en una sola sesión; la revisión de hechos, un subagente Sonnet con web (0 errores, 3 matices aplicados) | 10, 18 |
| 20 | RAG · estación 9: gate de evals | 19 |
| **Dojo IA Privada, cierre** | | |
| 21 | Estaciones 5–6: tu RAG en el despacho · el gate con el modelo propio | 12, 20 |
| 22 | Estación 7: observabilidad y fallas (GPU rentada) | 21 |
| 23 | Estación 8: entrega sin internet | 22 |
| 24 | Integración: enlaces con Sensei, Ronda, Atlas y Dojo; glosario compartido; revisión final de hechos | Todo |

Opcional, después: las estaciones 10–12 del RAG (Docker, índice nuevo sin cortes y monitoreo), 3 fases más.

**Orden con lo demás de TrueML:** Sensei ya terminó, así que las fases van seguidas. Las fases 1–9 no dependen de nada externo. Las del RAG (13–20) también pueden ir antes o en paralelo si urge practicar, salvo la 19, que necesita la fase 10.

**Lo que toda fase de app cumple (desde la fase 1):** el Dojo design (`dojo.css`, `trueml-mark.js`, la T de vidrio donde quepa), el botón de Ko-fi como las otras apps, la regla de explicar cada concepto desde cero, y el deploy como en las demás apps (merge a main + push, Vercel conectado a Git, verificar en vivo). El subdominio sale del nombre final (sección 10); mientras tanto, el de trabajo.

**Medido (fase 1, 2026-11-25):** esqueleto, calculadora de VRAM, revisión de hechos y deploy subieron la ventana de 5 horas de 1 % a 7 % y el límite semanal total de 82 % a 83 %; Fable no se usó. Código en Opus esfuerzo medio; la verificación de modelos y la revisión de hechos, en Sonnet.

**Medido (fase 2, 2026-11-25):** calculadoras de velocidad, sizing y TCO, catálogo, investigación de precios, especificaciones y benchmarks (3 subagentes Sonnet), revisión de hechos (Sonnet, 3 graves y 11 menores, todas corregidas) y deploy: la ventana de 5 horas pasó de 9 % a 55 % y el límite semanal total de 83 % a 89 %; Fable no se usó. Esas cifras incluyen a la sesión de la fase 3, que corrió en paralelo, así que la fase 2 sola costó menos. El motor de calculadoras ganó varias listas de preajustes llenadas desde datos (`"datos": "gpus" | "apis"`), la tabla `comparar` y `sin_valor`; el catálogo es el bloque `:::catalogo`. Los precios por token viven en content/datos/apis.json; los servidores con precio, en apps/sensei/content/datos/equipos.json (sync.mjs lo copia).

**Medido (fase 3, 2026-11-25):** 5 lecciones (≈ 48.6k palabras), la ficha del despacho y la integración corrieron en paralelo con la fase 2: las dos juntas subieron el límite semanal total de 83 % a 90 % y la ventana de 5 horas de ≈ 9 % a 64 % (la fase 2 sola llegó a 89 % antes de que esta terminara). Para la fase 3 quedan ≈ 6–7 puntos semanales, ≈ 1.3 % por lección, como las fases 5–6 de Sensei; el reparto por pieza es aproximado. Por pieza: paquetes con web (3 Sonnet, medio) ≈ 2 puntos; escritores (5 Opus, medio, en paralelo, 15–23 min, 220–300k tokens cada uno) ≈ 3; revisión mecánica (5 Sonnet, bajo) < 1; revisión de fondo (5 Opus, alto, hechos y claridad en un solo agente por lección) ≈ 2, con 64 correcciones de hechos (13 graves) y 76 cambios de claridad; integración (Sonnet, medio) y navegador < 1. Lo nuevo: la ficha del despacho como única fuente de sus números (como `empresa.json` en Sensei), y la coordinación con la fase 2 por mensajes: su herramienta de sizing mostró que 1 L40S no atiende bien al despacho (el prefill de 6,000 tokens ya pasa el TTFT de 2 s), y eso se volvió el hilo de las lecciones en vez de un error.

**Medido (fase 13, 2026-11-25):** kit (cuatro fuentes ficticias por HTTP, sin Docker), solución, 11 checks, 6 fallas probadas, contenido con salidas reales, revisión de hechos (un subagente Sonnet: ningún error, 6 precisiones aplicadas), chequeos de la app y deploy: la ventana de 5 horas pasó de 12 % a 64 % y el límite semanal total de 83 % a 90 %; Fable no se usó. Esas cifras incluyen a las sesiones de las fases 2 y 3, que corrieron en paralelo, así que la fase 13 sola costó menos. Código y contenido en Opus (una sola sesión, sin escritores); la revisión de hechos, en Sonnet.

**Medido (fase 4, 2026-11-25 y 2026-11-26):** 4 lecciones (≈ 43.3k palabras), ficha del despacho ampliada (tokens del expediente, compra, el cuarto, la luz), la RTX PRO 6000 Server Edition en `gpus.json` y la potencia estimada del servidor de 4 L40S en `equipos.json`. Se hizo en dos ventanas, con una pausa por la regla del 90 %. **Primera parte** (paquetes, escritores y revisión mecánica): la ventana de 5 horas pasó de 65 % a 92 % y el límite semanal total de 90 % a 94 %. **Segunda parte**, después del reinicio semanal (revisión de fondo, integración, navegador y deploy): la ventana pasó de 8 % a 49 % y el semanal de 2 % a 7 %. En total ≈ 9 puntos semanales, ≈ 2.3 por lección, más que la fase 3 (≈ 1.3); la diferencia está en la revisión de fondo con esfuerzo alto y web (≈ 3 puntos). Fable no se usó. La fase 14 corrió en paralelo durante la segunda parte, así que la fase 4 sola costó algo menos. Por pieza, aproximado: paquetes (4 Sonnet, medio, 135–225k tokens cada uno) ≈ 2; escritores (4 Opus, medio, en paralelo, 18–23 min, 277–314k tokens cada uno) ≈ 2–3; revisión mecánica (4 Sonnet, bajo) < 1; revisión de fondo (4 Opus, alto, 7–14 min, 227–290k tokens) ≈ 3, con 48 correcciones de hechos (10 graves) y ≈ 70 cambios de claridad; integración (Sonnet, medio) y navegador < 1. Lo nuevo: la integración agrega los datos que faltan a su fuente en Sensei (`gpus.json`, `equipos.json`) y `sync.mjs` los copia. Un hallazgo de la lección de hardware: con la herramienta de sizing, una RTX PRO 6000 Server Edition cumple el TTFT ≤ 2 s (≈ 1.7 s) que la L40S no cumple; la ficha conserva 3 × L40S y la lección pide cotizar las dos opciones (hecho `compra`): lo decide el caso del despacho (fase 8). Ojo al revisar en el navegador: el service worker sirve el CSS anterior hasta que se quita.

**Medido (fase 5, 2026-11-26):** 4 lecciones (≈ 43.5k palabras: `requisitos-hardware`, `varias-gpus`, `stack-serving`, `gateway`), 15 hechos nuevos en la ficha del despacho y la integración con las fases 3–4. Todo cupo en una tarde: la ventana de 5 horas vieja pasó de 20 % a ≈ 34 % (se reinició a mitad de los escritores) y la nueva de 0 % a ≈ 31 %; el límite semanal total, de 3 % a ≈ 13 %, ≈ 10 puntos, ≈ 2.5 por lección, como la fase 4. Fable no se usó. La fase 15 (RAG · estación 3) corrió en paralelo, así que la fase 5 sola costó algo menos. Por pieza, aproximado: paquetes con web (4 Sonnet, medio, 150–300k tokens, 5–11 min) ≈ 2; escritores (4 Opus, medio, lanzados conforme llegaba su paquete, 17–22 min, 300–380k tokens) ≈ 4; mecánica (4 Sonnet, bajo) < 1; fondo (4 Opus, alto, con web, 10–21 min, 240–410k tokens) ≈ 3, con **62 correcciones de hechos (7 graves) y 67 cambios de claridad**; integración (Sonnet, medio), check y navegador < 1. Lo que salió:
- **El p95 con cola.** La herramienta de sizing da el TTFT sin cola (2.38 s con L40S, 1.72 s con la RTX PRO 6000 Server Edition). Con la cola de la hora pico, la simulación de `requisitos-hardware` da p95 ≈ 3.3 s en 3 L40S si se reparte por peticiones abiertas, y solo un reparto por turno o viendo la fila se acerca a 2.38 s; la Server Edition queda en el filo. Ahora es el hecho `ttft_p95_con_cola` de la ficha, y `gateway` avisa que el `simple-shuffle` de LiteLLM (al azar) es el peor caso.
- **Versiones de 2026 que contradicen la memoria del modelo,** confirmadas en la fuente: vLLM 0.34.0 (`--gpu-memory-utilization` ya no es 0.9 por omisión; prefix caching activo), llama.cpp v1.x con `llama-server` en el puerto 9931, Ollama de vuelta sobre `llama-server` y una petición a la vez por modelo, TensorRT-LLM 1.3 sin engines compilados, SGLang 0.5.23 con CUDA 13, LiteLLM 1.111.0 y Open WebUI 0.13.5. Por eso los paquetes con web y el fondo con web no se recortan en las lecciones de software.
- **El despacho:** 3 réplicas (data parallel), no tensor parallel (TP=3 no divide las 64 cabezas; TP=2 en pares queda como prueba del piloto); vLLM con `--max-num-seqs 8`; LiteLLM + Open WebUI con SSO de Entra ID; cuota de 936 tokens/min por persona.
- Las graves: el reparto de peticiones abiertas no es el ideal; el «1 L40S basta» con el MoE se leía como si sirviera para el despacho; `user_header_mappings` de LiteLLM no pone cuotas; apagar `ENABLE_ADMIN_CHAT_ACCESS` no protege la base de datos; la salida estructurada de SGLang; el paso de `--gpu-memory-utilization` por 0.92; la diferencia 0.1 × (W + O) del ejercicio de TRT-LLM.
- Proceso: los escritores se lanzaron en cuanto llegaba su paquete, sin esperar a los demás, y cada lección pasó a mecánica y a fondo en tubería. La integración corrigió de paso `batching.md` (fijar la versión de vLLM, no el valor de memoria) y el título de `gateway` en `recorrido.md`.

**Medido (fase 6, 2026-11-26):** 4 lecciones (≈ 42k palabras: `rag-privado`, `agentes`, `evals`, `pruebas-carga`), 19 hechos nuevos en la ficha del despacho y la integración con las fases 3–5. Todo en una tarde y una sola ventana: la ventana de 5 horas pasó de 31 % a 87 % y el límite semanal total de 12 % a 19 %, ≈ 7 puntos, ≈ 1.8 por lección (menos que las fases 4–5). Fable no se usó; otra sesión corrió en paralelo en `apps/taller-ai`, así que la fase 6 sola costó algo menos. Por pieza, aproximado: paquetes con web (4 Sonnet, medio, 270–420k tokens, 10–17 min) ≈ 3 (ventana 31 → 53 %); escritores (4 Opus, medio, lanzados conforme llegaba su paquete, 15–19 min, 300–335k tokens) ≈ 2–3; mecánica (4 Sonnet, bajo) < 1; fondo (4 Opus, alto, con web, 7–12 min, 230–290k tokens) ≈ 2, con **51 correcciones de hechos (8 graves) y ≈ 51 cambios de claridad**; integración (Sonnet, medio), check y navegador < 1. Lo que salió:
- **Cuánto se le cree al examen de 200.** Con 170 de 200 el intervalo de Wilson va de ≈ 79 a ≈ 89 %; para demostrar el 85 % hacen falta ≈ 179–180, y el «≤ 2 % de citas inventadas» con 4 de 200 deja pasar 28 % de las veces a un sistema que inventa 3 %. El criterio de la ficha no cambia; `evals` enseña cómo leerlo y el gate de regresiones usa un margen de no inferioridad de 6 puntos (con −5 se detenía ≈ 28 % de los cambios que no pierden nada).
- **Las herramientas de evals apuntan a la nube por omisión** (juez de OpenAI, telemetría encendida en RAGAS, DeepEval y promptfoo; promptfoo elige juez por las credenciales que encuentre): en el despacho se fija el juez local y se apaga la telemetría.
- **El agente no cabe en la cuota del chat:** un agente de 6 pasos pide ≈ 3.5× los tokens de una pregunta de RAG y ≈ 8 requests/min contra 4; lleva su propia clave, cuota y presupuesto de contexto. vLLM 0.34.0 rechaza con HTTP 400 cualquier `tool_choice` (también `"auto"`) sin `--enable-auto-tool-choice`; el parser de Qwen3 es `hermes`. MCP vigente: 2026-07-28, sin estado. OWASP LLM Top 10 ya tiene versión 2026.
- **RAG del despacho:** Qwen3-Embedding-0.6B, Qwen3-Reranker-0.6B (proceso aparte) y Qdrant 1.20.2; ≈ 1.34 M chunks, índice ≈ 5.7 GB en float32; el parsing y OCR, no los embeddings, es lo que tarda noches. El reranker (≈ 100–230 ms) no cabe en los 150 ms de búsqueda salvo que el prompt baje a 3 fragmentos; con 3 fragmentos y reparto por turno el p95 simulado queda en ≈ 1.85–1.99 s. La k del RRF de Qdrant vale 2, no 60.
- **Pruebas de carga:** la promesa de las 3 copias se prueba en 4 L40S rentadas solo para la prueba (≈ US$500), no en la L40S del piloto; con el dataset del despacho el goodput es ≈ 0.06/s. MLPerf vigente (v6.1) no tiene ninguna carga parecida a la del despacho.
- Proceso: igual que la fase 5 (paquetes → escritor en cuanto llega su paquete → mecánica → fondo en tubería). La regla 9 obligó a no nombrar el banco de pruebas AgentDojo. Las lecciones `rag-privado` y `evals` llevan `dojo:` en el encabezado y la tarjeta final enlaza sus estaciones (5 y 6).

**Medido (fase 7, 2026-11-26):** 4 lecciones (≈ 43.5k palabras: `observabilidad` 10,999, `seguridad` 10,996, `costo-total` 10,773, `cotizar` 10,696), 23 hechos nuevos en la ficha del despacho (71 → 94), la herramienta de TCO actualizada y 36 menciones por título de las fases 3–6 convertidas en enlaces. Con esto quedan las 21 lecciones. Una sola ventana: la de 5 horas pasó de 2 % a 55 % y el límite semanal total de 20 % a 27 %, ≈ 7 puntos, ≈ 1.8 por lección (igual que la fase 6); la estación 5 de RAG corrió en paralelo en `apps/taller-ai`, así que la fase 7 sola costó algo menos. Fable no se usó. Un solo workflow en tubería: 17 agentes, ≈ 4.6 M tokens, ≈ 80 min (paquetes Sonnet medio → escritores Opus medio → mecánica Sonnet bajo → fondo Opus alto con web → integración Sonnet medio). El fondo hizo **61 correcciones de hechos (13 graves) y ≈ 51 cambios de claridad**. Lo que salió:
- **Observabilidad:** la alerta de réplica caída callaba si caían las tres (ahora `sum(up{job="vllm-chat"}) < 3`); `absent(up)` no detecta el servidor ni Prometheus caídos; LiteLLM no etiqueta por persona por omisión. Prometheus va en la máquina de gestión, no en el servidor del modelo; su disco: ≈ 3,300 series, 1.7–3.4 GB, y ≈ 27,000 series (14–28 GB) si se etiqueta por persona.
- **Seguridad:** dos salidas a internet, las dos a Microsoft (login de Entra y el correo de alertas por Microsoft 365, que apaga SMTP AUTH básico a fines de diciembre de 2026). El staging no puede ser la GPU del piloto (se devuelve en la semana 7): es la cuarta L40S o una réplica fuera de la hora pico. La imagen de Open WebUI corre como root salvo que se arme con UID/GID ≠ 0.
- **TCO:** el servidor de la herramienta pasó de US$15,000 a la base del Exxact (US$40,461); el despacho sale ≈ US$2,869 al mes, ≈ 70 veces la API de Qwen3 32B; la herramienta ganó tipo de cambio (FIX 19.7203 del 26-nov), salidas en pesos y costo por pregunta. Contra el mismo modelo por API no hay cruce; el servidor propio se justifica por la privacidad, no por el precio.
- **Cotizar:** SLA de 99 % en horario (132 min al mes), severidad 1 en 2 h; importación con agente aduanal y DAP contra comprar en México, cotizada a 19.3668 (tipo de cambio de pagos del 26-nov; deliberadamente distinto del FIX de costo-total, y explicado en las dos lecciones).
- Queda anotado, sin resolver: la pregunta de prueba del SLA no está en el tablero de observabilidad; no hay comparación de colocation contra cuarto propio; varias cifras siguen «por confirmar» en las lecciones (garantía de Exxact para las tarjetas, rama de driver, clasificación aduanal). Detalle en las notas de la sesión (`fase7/integracion.md`).

**Medido (fase 8, 2026-11-27):** 3 casos (`/casos/despacho/` 59 min lo esencial, `/casos/clinica/` 67, `/casos/fabrica/` 56; ≈ 27.7k palabras), dos fichas nuevas como la del despacho (`clinica.json` 72 hechos, `fabrica.json` 70) y la del despacho de 94 a 98 hechos. El motor ganó la página de caso (`content/casos/<id>.md`, en la barra lateral y la portada), el bloque `:::intenta` (pregunta, `???`, solución cerrada: ≈ 7 por caso) y los enlaces que abren una herramienta con los valores del caso (`/herramientas/sizing/?p1=l40s&r=15…`: el build revisa cada nombre y rango, `app.js` los aplica y `check.mjs` lo prueba). Costo: la ventana de 5 horas pasó de 56 % a 100 % (el workflow la llenó; se pausó con todo en commits hasta el reinicio) y la siguiente de 0 % a 7 % (integración, chequeos, deploy); el límite semanal total, de 27 % a 34 %, ≈ 7 puntos, ≈ 2.3 por caso. Fable no se usó; sesiones de `apps/taller-ai` corrieron en paralelo. Un workflow en tubería: 12 agentes, ≈ 3.4 M tokens, 62 min (paquetes Sonnet medio con web → escritores Opus medio → mecánica Sonnet bajo → fondo Opus alto con web), más la integración (Sonnet medio). El fondo hizo **35 correcciones de hechos (8 graves) y ≈ 36 de claridad**. Lo que salió:
- **El despacho decide D: 2 × RTX PRO 6000 Server Edition**, condicionado a que el piloto mida un prefill de 6,000 tokens ≤ ≈ 1.75 s en la tarjeta rentada (Google Cloud G4, ≈ US$4.50/h); si no, 3 L40S con 3 fragmentos (si el examen los acepta) o 4 L40S. 1 sola Server Edition no cumple (una sola fila: p95 ≈ 4.1 s; con 3 fragmentos ≈ 2.2 s con reranker, red y búsqueda). Hecho `decision_hardware`.
- Se cerraron los huecos de la fase 7: la pregunta de prueba del SLA (blackbox_exporter cada minuto, panel y alerta; hecho `sonda`, y la lección `observabilidad` ya la trae) y colocation contra el cuarto propio (hecho `colocation`, con su calculadora del caso).
- Graves de los fondos: las sondas privadas de Grafana escriben en la nube (sería una tercera salida a internet); el README del Pushgateway dice lo contrario de lo que se citaba; la licencia HAI-DEF de MedGemma no cuenta las salidas como derivados; el umbral de ingreso de la licencia de MinerU cuenta a las filiales.
- `gpus.json` (Sensei) ganó la renta de G4 y `compra_usd` 17,158.99 (CDW) de la Server Edition; `equipos.json`, el servidor de 2 Server Edition (estimado). ≈ 25 enlaces de las lecciones a los casos.
- Queda anotado: la clínica dura 67 min de lo esencial (meta ≤ 55) sin quitar intentos ni ejercicios; «3 fragmentos = 3,500 o 4,000 tokens» difiere entre `rag-privado` y `requisitos-hardware`/`recorrido` (se dejó con el matiz); el diagrama de la fábrica se desliza a 375 px como todos los diagramas anchos. Detalle en las notas de la sesión (`fase8/integracion.md`).

**Medido (fase 9, 2026-11-27):** 3 casos (`/casos/financiera/` 55 min lo esencial, `/casos/gobierno/` 55, `/casos/saas/` 54; ≈ 29.4k palabras) con sus fichas (`financiera.json` 75 hechos, `gobierno.json` 64, `saas.json` 70) y 5 calculadoras propias (la ventana nocturna y la API de la financiera, la compra pública, el lote y el margen de la SaaS). Nueva la página `/casos/` (índice de los 6 con lo que enseña cada uno: campo `aprende` de `casos.json`). Costo: la ventana de 5 horas pasó de 10 % a 60 % (el workflow solo, 10 → 54 %) y el límite semanal total de 34 % a 41 %, ≈ 7 puntos, ≈ 2.3 por caso, como la fase 8; esta vez cupo en una sola ventana porque se empezó temprano y el encargo de escritores pidió ≤ 55 min desde el principio. Fable no se usó; la fase 10 corrió en paralelo en `apps/taller-ai`. Un workflow en tubería (12 agentes, ≈ 3.6 M tokens, 69 min) más la integración (Sonnet medio, 2 min). El fondo hizo **38 correcciones de hechos (6 graves) y ≈ 46 de claridad**. Lo que salió:
- **Financiera** (banco de consumo en Monterrey, ≈ 8,000 llamadas cada noche): Whisper large-v3-turbo con faster-whisper + Qwen3.8 27B en FP8 con salida estructurada, en un servidor de 4 × L40S que cabe en la ventana nocturna con margen para el doble. Grave: faltaban los arts. 326–328 de la CUB (aviso a la CNBV con 20 días hábiles; autorización si el servicio corre fuera de México); la región de AWS en México no tiene GPU.
- **Gobierno** (air-gapped): 2 × L40S (`exxact-2xl40s-4u`, nuevo en `equipos.json`), Qwen3.8-27B FP8, la entrada de artefactos con manifiesto firmado y la compra pública. Graves: cosign 3 escribe en el log público de Sigstore y no verifica sin red (se cambió por OpenSSL); `skopeo` necesita `--all --preserve-digests`; fracciones del art. 112 de la ley de transparencia.
- **SaaS** (≈ 50 despachos contables en un servidor): 2 × RTX PRO 6000 Server Edition, una copia por tarjeta; a los 65 clientes hace falta una 3.ª tarjeta en el mismo chasis, no un 2.º servidor; la llave del lote en un equipo de LiteLLM aparte (los límites del equipo suman sus llaves).
- Integración: ≈ 12 enlaces de las lecciones a los casos nuevos; `cotizar` lista los 6; cosign/Rekor en `seguridad`; la llave del lote en `gateway`; Llama 3.3 en `licencias`. Quedan anotados (`fase9/integracion.md`): el hecho `open_webui_marca` de `despacho.json` y notas de sizing; gobierno queda en 55.45 min (todo texto esencial nuevo lo pasa de 55).

**Costo estimado:** ≈ 24 lecciones a 1.4–3.5 % del límite semanal cada una (lo medido en Sensei) son ≈ 35–85 % de una semana, repartido entre varias. Las herramientas, los casos y las estaciones se miden al terminar cada fase, igual que en Sensei.

**Medido (fase 10, 2026-11-27):** el molde de la rama (el hero de cada estación de rama dice «Corre en» y cómo entra en la ruta sin GPU; la tarjeta de IA Privada en la portada del Dojo dice cuántas estaciones están listas y la ruta 1 → 5 → 6) y sus estaciones 1 y 2, cada una con kit, solución, `verificar.py` (10 y 6 checks), `romper.py` (6 fallas cada una, todas probadas contra el servidor real) y su página con salidas reales. Se hizo en dos ventanas, con una pausa por la regla del 90 %: la primera pasó de 80 % a 87 % (semanal 30 → 31 %) y la segunda de 0 % a 30 % (semanal 33 → 37 %), ≈ 5 puntos semanales en total; la estación 6 del RAG y la fase 8 corrieron en paralelo, así que la fase 10 sola costó algo menos. Fable no se usó. Todo en Opus en una sola sesión, sin escritores; la revisión de hechos, un subagente Sonnet con web (2 precisiones: el reparto del contexto con `-np` solo pasa sin KV unificado, y el contexto de Qwen3-0.6B es 32,768 en su tarjeta y 40,960 en su config). Lo que salió:

- **Estación 1** (`modelo-local`): llama.cpp 1.1.0 de Homebrew (puerto 9931 por omisión, `--reasoning` en auto, `--jinja` y `--warmup` prendidos) con Qwen3-0.6B Q8_0 de ggml-org (commit afe8ad35, sha256). El cliente `pipeline/llm.py` (solo biblioteca estándar: chat, stream con TTFT, tokens, errores con nombre, `chat_json` con citas como enum de ids) es el contrato que reutiliza la estación 8 del RAG. Fallas reales: `-np 4` con `-c 8192` deja 2,048 por petición y el prompt de 6,013 tokens truena; sin `--reasoning` razona en inglés y se corta; sin `--api-key` el log avisa y contesta 200; `--chat-template llama3` mete la pregunta como 3 tokens. En la Mac (M4, 120 GB/s): ≈ 120 tokens/s al escribir (80 % del techo) y 4.7 s de prefill de 6,013 tokens.
- **Estación 2** (`cuantizacion`): del f16 con `llama-quantize` (determinista: el mismo sha256 cada vez). Q8_0 805 MB, 120 tokens/s, perplejidad +0.1 %, examen 12/12; Q4_K_M 484 MB (5.09 bits por peso: 28.5 % en Q6_K), 164 tokens/s, +4.0 %, 12/12; Q2_K 347 MB, 161 tokens/s, ×6.6, 0/12. La regla elige Q4_K_M. Lo que no resultó falla real y se cambió: «sin calentar» (llama-server calienta solo) y «recuantizar desde Q8_0» (casi igual: 6.28 contra 6.30). `mundo/ficha.py` lee el encabezado de un GGUF (lo usan las dos).
- `apps/trueml/sync.mjs` regeneró `apps/ia-privada/content/dojo.json` (IA Privada 2/8); es el único archivo de la app que tocó la fase.

## 8. Presupuesto: límites, reinicios y cómo aprovecharlos

### Lo que hay (2026-11-12)

| Límite | Qué mide | Se reinicia solo |
|---|---|---|
| Ventana de 5 horas | Lo que se gasta en un bloque de trabajo | 5 horas después de empezar el bloque |
| Semanal · todos los modelos | El total de la semana, **Fable incluido** | Miércoles 21:00 (hora de México) |
| Semanal · Fable | Solo lo que corre en Fable 5.2 | Miércoles 21:00 (hora de México) |

Además hay **3 reinicios manuales**:

- **1 del límite semanal total.** Vale una semana extra completa.
- **2 del límite de Fable.** Solo regresan el consumo de Fable; el límite total no baja.

**La consecuencia importante:** como Fable también gasta del total, el límite que de verdad frena es el **semanal total**. Mandar trabajo a Fable no ahorra nada del total; solo cambia qué barra se llena. El límite de Fable solo estorba si se llena antes que el total, y para eso están sus 2 reinicios.

### Las reglas

1. **Cada modelo en su trabajo, eligiendo por calidad por punto del límite total:**

   | Trabajo | Modelo | Por qué |
   |---|---|---|
   | Escribir lecciones (lo que más gasta: 16 de 21 puntos en la fase 7 de Sensei; 3 de 9 en la fase 8, ya con esfuerzo medio) | **Opus, esfuerzo medio** (calibrado en la fase 8 de Sensei, regla 2) | Es el gasto más grande; aquí se decide la semana |
   | Revisión de fondo: hechos, claridad y conocimiento supuesto | Opus, esfuerzo alto | Es lo que da la calidad y no se recorta. Fable cuesta ≈ 3.4 veces más del total por la misma tarea; no se ha probado aquí |
   | Figuras a mano y diagramas | Opus | No se recortan (en Sensei las hace el escritor) |
   | Lo mecánico: recalcular números, comparar código con su salida, revisar capturas, consistencia | Sonnet o Haiku, esfuerzo bajo | Es donde sí se ahorra: cuesta mucho menos del total |
   | Código de la app y de las herramientas | Opus, esfuerzo medio | Se verifica corriéndolo |

2. **Calibrar Fable en la primera fase con lecciones.** Una lección la escribe Fable y otra Opus, con el mismo esfuerzo. Se mide para cada una cuánto subió el límite total (leyendo el uso antes y después) y cuántas correcciones hizo la revisión de fondo. Gana el que da menos correcciones por punto gastado, y la tabla se ajusta.

   **Resultado (fase 8 de Sensei, 2026-11-13):** gana Opus. Con esfuerzo medio y tokens parecidos (≈ 245k), el escritor en Fable subió la ventana de 5 horas 12 puntos y el límite semanal total ≈ 1. Cada escritor en Opus la subió ≈ 3.5 y ≈ 0.5: Fable cuesta **≈ 3.4 veces más del total** por lección. Su borrador tampoco salió mejor: 27 correcciones de hechos (3 graves) contra 18.75 de Opus en promedio (1 grave), y los mismos cambios de claridad (76 contra 76.5). Fable queda solo para pruebas puntuales donde una mejora de calidad clara pague ese costo; con lo medido, ningún trabajo del flujo de lecciones. La barra de Fable no frena (una lección la subió 4 %), así que sus 2 reinicios no hacen falta mientras esto siga así. El detalle está en [plan-sensei.md](plan-sensei.md), sección 4.

3. **Ahorrar donde no se toca la calidad:**
   - Lo mecánico siempre en modelos chicos.
   - Una sesión nueva por fase, que arranca del plan, la guía y los commits. Releer 100k+ tokens de una conversación larga en cada turno es gasto puro.
   - Paquetes de datos por lección (como en Sensei) para que escritores y revisores no lean fuentes enteras.
   - Escritores con presupuesto de palabras y tope de bloques de código, guardando sus pendientes en disco.

4. **Los escritores arrancan al inicio de una ventana de 5 horas**, nunca a media ventana.

5. **Medir al cerrar cada fase:** cuánto subió cada límite, por pieza (paquetes, escritores, mecánico, fondo). Se anota aquí, como en Sensei.

### Cuándo usar cada reinicio

**El reinicio del total (1):** vale lo que quede de semana después de usarlo. Usarlo el martes, a un día del reinicio solo, es tirarlo.

- Úsalo solo cuando el total esté arriba del 90 % **y** falten 3 días o más para el miércoles 21:00.
- Ten la cola de trabajo lista antes (planes y paquetes hechos), para que la semana extra se vaya en producir y no en planear.
- El mejor momento es una **semana sprint**: total al máximo de jueves a sábado, reinicio el sábado o domingo, y de nuevo al máximo hasta el miércoles. Son ≈ 2 semanas de trabajo en 1.

**Los reinicios de Fable (2):** solo sirven si Fable llega a su tope mientras al total todavía le queda.

- Úsalos cuando Fable pase del 90 % y al total le quede al menos un 20–30 %.
- Si Fable nunca se llena antes que el total, no hace falta usarlos.

**Por confirmar en la app:** si los reinicios caducan (si caducan pronto, se usan antes) y si el reinicio del total también regresa la barra de Fable.

### Cuánto cabe

Con lo medido en Sensei, una fase de 5–6 lecciones costó entre 8 y 21 puntos del total: 9 en la fase 5, 8 en la 6 y 21 en la 7. Una semana normal da para ≈ 5 fases de lecciones si cuestan como la 7, o ≈ 10 si cuestan como la 5 y la 6. La ventana de 5 horas y tu tiempo frenan antes: cada fase usa 1 o 2 ventanas.

| Cuándo | Qué |
|---|---|
| Jueves a lunes | Fases con lecciones: escritores al inicio de una ventana, revisión de fondo en la siguiente |
| Entre fases de lecciones | Fases de código (herramientas, esqueleto, kits del Dojo) |
| Sábado o domingo | Decidir si es semana sprint: con el total arriba del 90 %, se usa el reinicio |
| Martes | Revisar cuánto queda y elegir la última fase para que quepa |
| Miércoles antes de las 21:00 | Gastar lo que sobre en trabajo que no estorbe: paquetes de la siguiente fase, guiones de reels, borradores de casos |

## 9. Decisiones tomadas (2026-11-12)

- El centro es IA privada on-prem; lo general de AI systems entra contado desde ese caso.
- La app trae lecciones, herramientas y casos. La práctica es una rama del Dojo, enlazada desde la app.
- Hay un solo Dojo. Su tronco (C01) es la práctica de Sensei y la rama IA Privada es la práctica de esta app. La rama LLM/RAG del Taller se fusionó con esta.
- Práctica en la Mac más GPU rentada por horas en sesiones puntuales. Comprar hardware se decide después.
- Va intercalada con Sensei y el Dojo. No espera a que terminen ni los reemplaza.

## 10. Pendientes por decidir

- El nombre final de la app (define también su subdominio en trueml.app).
- El proveedor de GPU rentada (en la fase 12).
- Si los casos se vuelven también material de venta (propuestas de ejemplo para clientes reales).
