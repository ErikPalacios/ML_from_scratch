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
- **De Sensei, cuando estén:** fase 8 (*La nube*: Máquinas, GPUs y precios) y fase 9 (*Seguridad*: Datos personales y la ley). Son la base del TCO y del discurso de privacidad.
- **Del Atlas:** la calculadora de arquitecturas, como punto de partida de la calculadora de VRAM.
- **Del Taller:** el molde de 7 piezas por estación, `verificar.py`, `romper.py`, los prompts y el tablero.
- **De TrueML:** el Dojo design (`tokens.css`, `trueml-mark.js`), el encabezado común y `sync.mjs`.

## 3. Lecciones (≈ 24, en 11 módulos)

Cada módulo dice qué lecciones de Sensei da por leídas. Los nombres exactos de modelos, GPUs, licencias y precios se verifican en la fase que los escribe, nunca de memoria.

| # | Módulo | Lecciones | Da por leído (Sensei) |
|---|---|---|---|
| 1 | El mapa | El recorrido de un proyecto de IA privada: descubrimiento → sizing → compra → despliegue → evals → operación | El camino completo |
| 2 | Los modelos abiertos | Open weight, open source y licencias · Familias, tamaños, dense y MoE · Elegir un modelo para la tarea | Transformers y LLMs |
| 3 | La inferencia por dentro | Prefill y decode · KV cache · Batching continuo y concurrencia | Matrices y FLOPs · Memoria · Latencia y throughput |
| 4 | Que quepa y que vuele | Cuantización y su costo en calidad · Speculative decoding y contexto largo | Cómo guarda números una computadora |
| 5 | El hardware | La GPU vista para inferencia (VRAM, ancho de banda, interconexión) · El catálogo: de la workstation al rack, NVIDIA, AMD y Apple · El cuarto: energía, enfriamiento y red | CPU y GPU · fase 8 |
| 6 | Dimensionar | De requisitos a hardware (usuarios, tokens, latencia) · Varias GPUs: tensor y pipeline parallel | Percentiles · Unidades y estimaciones |
| 7 | El stack de serving | Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM · Gateway, API compatible con OpenAI, autenticación y varios modelos | APIs · Balanceadores y gateways |
| 8 | Lo que el cliente pide encima | RAG privado: embeddings y vector DB locales · Agentes, tools y guardrails | Embeddings |
| 9 | Evals | Demostrar que el modelo abierto sirve: golden sets, LLM-as-judge y regresiones · Pruebas de carga y benchmarks honestos | ¿Aprendió de verdad? · Ruido, muestras y pruebas A/B |
| 10 | Operar | Observabilidad de GPUs e inferencia · Seguridad: aislamiento, sin internet (air-gapped), datos personales y actualizaciones | fase 9 |
| 11 | El negocio | TCO: API vs. nube vs. servidor propio y punto de equilibrio · Cotizar, proponer y dar soporte (SLAs, contrato, importación de hardware en México) | fase 8 |

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
| 5 | RAG privado: ingestión, chunking, embeddings e índice local | Mac |
| 6 | Evals del RAG (retrieval y respuestas) y guardrails | Mac |
| 7 | Observabilidad y fallas en producción | GPU rentada |
| 8 | Entrega a un cliente: paquete instalable sin internet | Mac y GPU rentada |

**Esta rama absorbe la rama LLM/RAG del Taller** (2026-11-12). Las 5 estaciones que el Taller tenía pensadas para LLM/RAG (ingestión y chunking, índice y embeddings, evaluación de retrieval, serving del LLM y guardrails) quedan cubiertas por las estaciones 3, 5 y 6. Así el patrón LLM/RAG (C11) se practica una sola vez, y además con serving en hardware propio. Se ahorran ≈ 3 fases.

**Lo que corre solo en la Mac:** las estaciones 1, 2, 4, 5 y 6 corren completas en la Mac, sin GPU rentada. De ellas, **1, 5 y 6 forman un proyecto de RAG completo**: el modelo local con su API (1), el RAG con tus documentos (5) y sus evals con guardrails (6). Así se puede hacer un RAG de punta a punta sin rentar GPU; la 2 (cuantización) y la 4 (gateway) se suman cuando quieras, y la GPU rentada solo hace falta para las estaciones 3, 7 y 8. El Dojo lo muestra en la portada («Sin rentar GPU: 1 → 5 → 6») y lo lee de `apps/taller-ai/content/ramas.json` (campo `sin_gpu`).

**En el Dojo (2026-11-16):** la rama ya está declarada en `apps/taller-ai/content/ramas.json` con sus 8 estaciones, todas «próximamente». Cada estación trae su id, su título, lo que sale, su etapa de la T y dónde corre:

| Estación | id | Etapa de la T | Dónde corre |
|---|---|---|---|
| 1 · Un modelo local por API | `modelo-local` | API | Mac |
| 2 · Medir y cuantizar | `cuantizacion` | Modelo | Mac |
| 3 · Servir con vLLM bajo carga | `vllm` | API | GPU rentada |
| 4 · Gateway de modelos | `gateway` | Orquestación | Mac |
| 5 · RAG privado | `rag` | Datos | Mac |
| 6 · Evals del RAG y guardrails | `evals` | Modelo | Mac |
| 7 · Observabilidad y fallas | `observabilidad` | Monitoreo | GPU rentada |
| 8 · Entrega sin internet | `entrega` | Contenedor | Mac y GPU rentada |

El caso de referencia de la rama es el despacho de abogados (caso 1 de la sección 5): los precálculos de cada estación van en dos escalas, «En el despacho» y «En el dojo». Cada página vive en `/ia-privada/<id>/` (por ejemplo `/ia-privada/rag/`). Para hacer una estación: su kit en `apps/taller-ai/kits/ia-privada-<id>/` y su contenido en `content/estaciones/ia-privada-<id>.json` con `"rama": "ia-privada"` y su `etapa`; el resto (portada, tablero, `sync.mjs`) la toma sola.

**Hardware de práctica:** lo diario en la Mac con modelos chicos. Las estaciones 3, 7 y 8 usan una GPU NVIDIA rentada por horas, en sesiones cortas y planeadas. Cada una dice antes cuánto tiempo y costo estimado lleva, y trae un script que apaga la máquina al terminar. El proveedor y el precio se eligen en la fase de la estación 3. Comprar hardware propio se decide después de validar el negocio.

## 7. Fases

Cada fase cabe en una ventana de 5 horas y termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión), con commit y publicada. Las lecciones usan el proceso ahorrador de Sensei ([plan-sensei.md](plan-sensei.md), sección 4) con los ajustes de la fase 7: escritores con esfuerzo medio, lanzados al inicio de una ventana y guardando sus pendientes en disco.

| Fase | Contenido | Depende de |
|---|---|---|
| 0 ✓ | Este plan | — |
| 1 | Esqueleto de la app (copia del armazón de Sensei, Dojo design, portada con las 4 secciones) y calculadora de VRAM | — |
| 2 | Calculadoras de velocidad, sizing y TCO, más el catálogo de hardware, verificadas contra fuentes | 1 |
| 3 | Módulos 1–2 (4 lecciones) | 1 |
| 4 | Módulos 3–4 (5 lecciones) | 3 |
| 5 | Módulo 5 (3 lecciones) | Sensei fase 8 |
| 6 | Módulos 6–7 (4 lecciones) | 5 |
| 7 | Módulos 8–9 (4 lecciones) | 6 |
| 8 | Módulos 10–11 (4 lecciones) | Sensei fase 9 |
| 9 | Casos 1–3 | 2, 6 |
| 10 | Casos 4–6 | 9 |
| 11 | Dojo: molde de la rama y estaciones 1–2 (Mac) | 4 |
| 12 | Dojo: estación 3 (primera sesión con GPU rentada) | 11 |
| 13 | Dojo: estaciones 4–5 | 12 |
| 14 | Dojo: estaciones 6–7 | 13 |
| 15 | Dojo: estación 8 (entrega a un cliente) | 14 |
| 16 | Integración: enlaces con Sensei, Ronda, Atlas y Dojo; glosario compartido; revisión final de hechos | Todo |

**Orden con lo demás de TrueML:**

1. Sensei fase 8 (*La nube*), que ya era lo siguiente, escrita dejando listos los números de GPUs y precios que usa esta app.
2. Fases 1–2 de esta app (las herramientas).
3. Después se alterna, según el presupuesto de cada semana: una fase de Sensei, una de IA Privada y una del Dojo.

**Costo estimado:** ≈ 24 lecciones a 1.4–3.5 % del límite semanal cada una (lo medido en Sensei) son ≈ 35–85 % de una semana, repartido entre varias. Las herramientas, los casos y las estaciones se miden al terminar cada fase, igual que en Sensei.

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

- El nombre final de la app.
- El proveedor de GPU rentada (en la fase 12).
- Si los casos se vuelven también material de venta (propuestas de ejemplo para clientes reales).
