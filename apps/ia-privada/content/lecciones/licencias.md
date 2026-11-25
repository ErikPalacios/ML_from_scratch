---
titulo: Open weight, open source y licencias
en: Open weight, open source and licenses
subtitulo: Qué te deja hacer de verdad la licencia de un modelo que descargas, cómo leerla en 10 minutos y qué cambia cuando lo usas dentro de tu red o lo entregas a otros.
pregunta: Ya descargué un modelo abierto. ¿Lo puedo usar en mi empresa, y qué tendría que cumplir si lo instalo para un cliente?
sensei: llms, privacidad
---

:::idea
Descargar un modelo no es lo mismo que poder usarlo para lo que quieras. Los pesos vienen con una **licencia**: un permiso con condiciones, que puede cambiar con el número de usuarios, con el negocio que hagas o con a quién se lo entregas. Por eso la licencia es parte del sizing, igual que la VRAM: un modelo que cabe en la GPU pero que la licencia no te deja usar no sirve.
:::

## La idea: la licencia también se dimensiona {The idea: the license is part of sizing}

En la herramienta de VRAM ya viste qué es un [[open-weight|modelo open weight]]: uno cuyos [[pesos]] puedes descargar y correr en tu hardware. Esta lección se mete con la otra mitad de esa definición, la que casi nadie lee: la licencia que viene con ellos.

Vamos a seguir un caso. **El despacho** es un ejemplo ficticio: un despacho de abogados en la Ciudad de México donde 200 abogados y asistentes quieren preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. El modelo candidato es **Qwen3 32B**, con licencia Apache 2.0, y hay tres alternativas por evaluar: **Mistral Small 24B**, **Qwen3 30B-A3B** y **Llama 3.3 70B**.

Cuando el equipo hace el sizing, pregunta «¿cuántas GPUs L40S hacen falta para atender a todos?». Esta lección agrega otra pregunta con el mismo peso: «¿nos deja la licencia usarlo así?». Las dos se contestan con el texto en la mano y con números.

:::analogia La receta y el permiso
Un modelo open weight es como una receta que alguien publica. Puedes cocinarla en tu casa cuantas veces quieras. Pero el autor puede haber escrito al pie: «si abres un restaurante con más de 700 sucursales, pídeme permiso» o «si la vendes, pon mi nombre en el menú».

Dónde se rompe: una receta casi nunca se puede proteger, y un modelo sí trae un contrato que se puede hacer valer. Además, el «platillo» que sale (el texto que genera) tiene sus propias reglas, que la licencia ni siquiera cubre del todo.
:::

### Por qué le importa a un proyecto de IA privada

Una empresa que corre un modelo en su red ya evitó un riesgo: que sus datos viajen a un tercero. Le quedan otros dos que vienen del modelo mismo:

- **Usarlo fuera del permiso.** Si el despacho usa un modelo cuya licencia no permite uso comercial, su proyecto tiene un problema legal desde el primer día, aunque nadie se entere hasta una auditoría o una venta de la empresa.
- **Entregarlo mal.** Si un integrador instala el modelo en las oficinas de 20 clientes, está **distribuyendo** el modelo, y muchas licencias piden cosas concretas al distribuir.

Las dos se evitan en la etapa de elegir modelo, cuando cambiar de candidato todavía es barato. Después de comprar el hardware, armar los evals y capacitar a la gente, cambiar de modelo por la licencia cuesta semanas.

:::ojo Nada de esto es asesoría legal
Esta lección te enseña a **leer** una licencia y a llegar con las preguntas correctas. La decisión final sobre si una empresa puede usar un modelo la revisa un abogado, con el texto vigente de la licencia el día que se decide. Las licencias cambian de una versión a otra del mismo modelo.
:::

## Qué viene en lo que descargas {What you actually download}

Un modelo open weight casi siempre se baja de **Hugging Face**, un sitio donde cada modelo vive en un *repositorio*: una carpeta con historial de cambios, como las de código. Si abres el de Qwen3 32B, ves algo así:

:::figura licencias-carpeta
Los archivos de un repositorio de modelo, agrupados por lo que son. Los pesos ocupan casi todos los GB, pero lo que dice qué puedes hacer está en dos archivos de texto.
:::

Cada grupo tiene un trabajo:

- **Los pesos** (`*.safetensors`). Los números que el modelo aprendió, partidos en varios archivos de pocos GB para que se descarguen por partes. *safetensors* es un formato de archivo para guardar tensores (tablas de números) que solo guarda datos, sin código que se ejecute al abrirlo. El índice dice qué parte guarda cada tensor.
- **La configuración** (`config.json`). La arquitectura: cuántos bloques, cuántas cabezas de atención, el tamaño del vocabulario. De aquí salen los números de la calculadora de VRAM.
- **El tokenizer.** Cómo el texto se vuelve tokens y la **plantilla de chat**, el formato con que se marcan los turnos de una conversación. Lo ves a fondo en [Transformers y LLMs](https://sensei.trueml.app/llms/).
- **Lo legal**: `LICENSE` y `README.md`.

### LICENSE: el texto que manda

`LICENSE` es el texto completo de la licencia. Es el que cuenta. Hugging Face también muestra una etiqueta en la página del modelo (por ejemplo `license: apache-2.0`), pero la etiqueta la escribe quien sube el modelo y es una pista, no el contrato. Cuando la etiqueta dice `other` o algo como `modified-mit`, es obligatorio leer el texto.

### README.md: la model card

El `README.md` de un repo de modelo se llama **[[model-card|model card]]** (ficha del modelo). Es la hoja técnica: para qué se hizo el modelo, con qué datos se entrenó (a grandes rasgos), qué evaluaciones tiene, qué limitaciones conoce el autor y, casi siempre, la licencia en el encabezado.

La model card no es la licencia, pero ayuda a leerla. Si dice «este modelo es un fine-tune de Llama 3.3 70B», ya sabes que la licencia de Llama viene en el paquete, aunque el repo diga otra cosa en la etiqueta. Si dice «para investigación», es una señal para revisar con cuidado.

:::nota Otros archivos que pueden traer reglas
Algunos repos traen archivos aparte: `USE_POLICY.md` (la política de uso, en Llama), `NOTICE` (avisos que hay que conservar, en Apache 2.0) o `LICENSE-MODEL` separado de la licencia del código (en DeepSeek V3). Antes de concluir, lista todos los archivos de texto del repo.
:::

Y un detalle que confunde: la licencia de los **pesos** puede ser distinta de la del **código**. DeepSeek V3, en su versión original de diciembre de 2024, publicó su código bajo MIT y sus pesos bajo otra licencia, la DeepSeek License, con restricciones de uso. Lo que corres en la GPU son los pesos: esa es la licencia que te importa.

## El espectro: de cerrado a open source {The spectrum: closed, open weight, open source}

«Abierto» se usa para cosas muy distintas. Ayuda ponerlas en una línea, de lo más cerrado a lo más abierto, según lo que te entregan.

:::figura licencias-espectro
Cuatro escalones de apertura. Lo que separa a uno del siguiente no es el tamaño del modelo, sino qué piezas te dan y con qué permiso.
:::

1. **Cerrado, por API.** No recibes nada: mandas texto a los servidores de otra empresa y te devuelve respuestas. Te rige un contrato de servicio. Es lo que el despacho no puede usar, porque los expedientes saldrían de su red.
2. **Open weight con licencia propia.** Recibes los pesos, con una licencia que escribió la empresa para ese modelo, con condiciones a su medida. Llama 3.3 70B está aquí.
3. **Open weight con licencia permisiva.** Recibes los pesos con una licencia estándar y corta, como Apache 2.0 o MIT, que casi no pone condiciones. Qwen3 32B está aquí. Pero no recibes los datos ni el código con que se entrenó.
4. **Open source de verdad.** Recibes los pesos, el código para entrenarlo y la información de los datos, todo bajo términos abiertos. Con eso alguien capacitado podría reconstruir un modelo equivalente.

### La definición de la OSI

La **Open Source Initiative** (OSI) es la organización que, desde hace décadas, decide qué licencias de software cuentan como «open source». En el software, open source quiere decir que te dan el código fuente: lo que hace falta para estudiar el programa y cambiarlo.

¿Qué es el «código fuente» de un modelo? Los pesos solos no alcanzan: son el resultado del entrenamiento, como un programa ya compilado. Por eso la OSI publicó la **Open Source AI Definition**, versión 1.0, anunciada el 28 de octubre de 2024. Pide que se pueda usar, estudiar, modificar y compartir el sistema, y que te entreguen tres cosas:

- **Información de los datos** (*data information*): una descripción suficientemente detallada de los datos de entrenamiento (de dónde vienen, cómo se eligieron, etiquetaron y procesaron) para que una persona capacitada construya un sistema sustancialmente equivalente.
- **El código** completo: para procesar los datos, entrenar, validar e inferir.
- **Los parámetros**: los pesos.

A un modelo que cumple se le llama [[open-source-ai|open source AI]].

:::ojo No exige publicar todos los datos
La definición pide **información** de los datos, no siempre los datos. Según las preguntas frecuentes de la OSI, los datos públicos se comparten; los que se pueden conseguir se describen con dónde obtenerlos; y los que no se pueden compartir (por ejemplo, datos personales) se pueden retener, pero hay que describirlos en detalle.
:::

### Quién cumple

En su validación de 2024, la OSI encontró que cumplían **OLMo** (de AI2, el Allen Institute for AI), **Pythia** (de EleutherAI), **Amber** y **CrystalCoder** (de LLM360) y **T5** (de Google). No cumplían Llama 2 (Meta), Phi-2 (Microsoft), Mixtral (Mistral) ni Grok (X). La OSI aclara que eso fueron resultados de validación, no certificaciones: no certifica modelos uno por uno.

El caso más útil hoy es **OLMo**. Olmo 3 (7B y 32B, noviembre de 2025) y Olmo 3.1 32B (diciembre de 2025) publican pesos, datos de entrenamiento (el conjunto se llama Dolma 3) y código, con los pesos bajo Apache 2.0. Si alguien te pide «open source de verdad», ese es el ejemplo.

:::nota ¿Y Llama 3.3 o Qwen3?
La OSI no ha publicado un veredicto sobre Llama 3 o 4, Qwen3, gpt-oss o Gemma 4. Lo que sí se puede decir: Llama 2 no cumplía en la validación de 2024, y la licencia de Llama no está entre las aprobadas por la OSI. Qwen3 usa Apache 2.0, que sí está aprobada, pero eso no basta: también faltarían el código de entrenamiento y la información de los datos.
:::

### Por qué al despacho le importa poco (y al investigador mucho)

Para correr un modelo en su red, el despacho no necesita los datos de entrenamiento: necesita los pesos y un permiso claro. Un modelo open weight con licencia permisiva le basta. Open source completo le importa a quien quiere **estudiar** o **reconstruir** el modelo: un investigador, una universidad o un gobierno que quiere saber exactamente qué textos vio el modelo.

Lo que no se vale es confundir los nombres. Muchas empresas dicen «nuestro modelo open source» cuando publican solo los pesos. En una propuesta, di **open weight** y nombra la licencia: es más preciso y nadie te lo puede reclamar.

## Qué es una licencia y por qué le importa a una empresa {What a license is and why a company cares}

Sin permiso, no puedes copiar ni usar una obra protegida de otra persona. Una **licencia** es ese permiso, por escrito: el dueño te dice qué puedes hacer y con qué condiciones. Una [[licencia-de-modelo|licencia de modelo]] es la que acompaña a unos pesos.

Toda licencia, de software o de modelo, tiene tres partes que conviene buscar siempre:

1. **El permiso.** Qué te deja hacer: usar, copiar, modificar, distribuir, vender. Puede ser amplio («para cualquier fin») o recortado («solo investigación»).
2. **Las condiciones.** Lo que tienes que cumplir para que el permiso valga: incluir un aviso, no pasar de cierto número de usuarios, seguir una política de uso, poner un nombre.
3. **La terminación.** Cuándo se acaba el permiso: casi siempre, si incumples las condiciones. En Llama, Meta puede terminar la licencia si la incumples, y entonces tienes que borrar los materiales.

:::ejemplo La terminación, en concreto
Si el despacho usara Llama 3.3 incumpliendo una condición y Meta terminara la licencia, el despacho tendría que dejar de usar el modelo y borrarlo. Su sistema se quedaría sin cerebro de un día para otro. Por eso las condiciones no son letra chica: son lo que mantiene vivo el permiso.
:::

### Por qué la licencia del modelo no es como la de un programa cualquiera

Un abogado del despacho podría decir: «usamos Windows y Office con licencias desde hace años; esto es igual». Se parece, con tres diferencias:

- **Lo que se licencia es raro.** Los pesos son números que salieron de entrenar con textos de terceros. Las licencias los tratan como una obra del autor, y casi todas aclaran que te los dan «tal como están», sin garantía de nada.
- **Las condiciones dependen de tu negocio.** Una licencia de Office cobra por persona. La de un modelo puede no cobrar nada y, en cambio, cambiar según tus usuarios activos mensuales o según si le vendes a otros acceso al modelo.
- **Lo que hagas con el modelo puede heredar la licencia.** Si lo afinas o lo cuantizas, el resultado sigue atado al original. Lo vemos en la sección de derivados.

### Las tres preguntas que le importan a una empresa

Para un proyecto, todo se reduce a tres preguntas:

- **¿Lo puedo usar en mi negocio?** Es decir, ¿permite uso comercial y en producción, no solo para pruebas?
- **¿Me alcanza alguna condición?** Umbrales de usuarios o de ingresos, políticas de uso, restricciones por país.
- **¿Qué tengo que hacer si lo entrego?** Avisos, copias de la licencia, nombres.

El resto de la lección contesta esas tres para las licencias que vas a encontrar.

## Las permisivas: Apache 2.0 y MIT {Permissive licenses: Apache 2.0 and MIT}

Una [[licencia-permisiva]] te deja hacer casi todo, incluso usarlo en un producto que vendes, y solo pide que conserves los avisos del autor. No pone umbrales ni políticas de uso. Son las más fáciles de aprobar en una empresa, y son estándar: el mismo texto sirve para miles de proyectos, así que los abogados ya lo conocen.

### Apache 2.0

[[apache-2|Apache 2.0]] es la licencia de Qwen3 (los densos de 0.6B a 32B y los MoE 30B-A3B y 235B-A22B), de Mistral Small 3.1 y 3.2, de gpt-oss de OpenAI, de IBM Granite 4, de Gemma 4 y de OLMo. Es la del candidato del despacho.

Lo que **permite**: usar, copiar, modificar y distribuir, también con fines comerciales.

Lo que **pide** al distribuir (sección 4 del texto):

- Entregar una copia de la licencia.
- Marcar los archivos que modificaste.
- Conservar los avisos de copyright, de patentes y de atribución.
- Si el original trae un archivo **NOTICE**, incluir sus avisos.

Lo que **da de más**: una **concesión de patentes** explícita (sección 3). Cada persona que contribuyó al trabajo te da permiso de usar sus patentes que lo cubran. Y trae un freno: si demandas alegando que la obra infringe una patente, esa licencia de patentes se termina para ti.

Lo que **no da**: permiso de usar las marcas. Puedes decir «basado en Qwen3», pero no presentarte como si fueras Alibaba.

:::analogia La concesión de patentes como seguro
Imagina que te regalan una herramienta y, además, te firman: «no te voy a demandar por usar mis inventos que hay dentro». Ese es el seguro de Apache 2.0. A cambio, si tú demandas diciendo que la herramienta te roba un invento, el regalo de patentes se cancela para ti.

Dónde se rompe: la concesión solo cubre las patentes de quienes contribuyeron al trabajo. Si un tercero, ajeno al proyecto, dice que el modelo infringe una patente suya, Apache 2.0 no te protege de él.
:::

### MIT

La [[licencia-mit|licencia MIT]] es todavía más corta. La usan Phi-4 de Microsoft, DeepSeek R1 y las versiones de DeepSeek desde V3-0324 hasta V4, y GLM-4.6.

Permite usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y vender. Su única condición: incluir el aviso de copyright y el texto del permiso en las copias o en las partes sustanciales. No tiene concesión de patentes explícita ni archivo NOTICE.

### Las dos, lado a lado

| | Apache 2.0 | MIT |
|---|---|---|
| Uso comercial | Sí | Sí |
| Condición al entregar | Copia de la licencia, marcar cambios, conservar avisos y NOTICE | Incluir el aviso de copyright y el permiso |
| Patentes | Concesión explícita, se pierde si demandas | No dice nada explícito |
| Marcas | No las da | No las menciona |
| Garantía | Ninguna, «tal como está» | Ninguna, «tal como está» |

Para el despacho, usando el modelo solo dentro de su red, la diferencia casi no pesa: las condiciones de las dos se activan al **distribuir**, y el despacho no le entrega el modelo a nadie. Lo que sí pesa es que ninguna de las dos le pone umbrales ni políticas de uso aparte.

:::ojo «MIT» ya no siempre es MIT
En 2026 aparecieron licencias que empiezan con el texto de MIT y le agregan condiciones: las llaman «MIT modificada». Si la etiqueta dice `modified-mit` o el LICENSE es más largo que una página, no es MIT: léela entera. Las vemos en la siguiente sección.
:::

## Las licencias propias: Llama, Gemma y las MIT modificadas {Custom licenses: Llama, Gemma and modified MIT}

Una licencia propia la escribe la empresa que publica el modelo, a su medida. Casi todas permiten uso comercial; lo que cambia son las condiciones.

### La licencia de Llama

La [[licencia-llama|licencia de Llama]] (Llama Community License) acompaña a Llama 3.1 (julio de 2024), 3.3 (diciembre de 2024) y 4 (abril de 2025). Llama 3.3 70B es una de las alternativas del despacho. Te da una licencia mundial, no exclusiva y sin regalías: puedes usarlo comercialmente sin pagarle a Meta. Con estas condiciones:

- **El umbral de 700 millones.** Si en la fecha de lanzamiento de esa versión de Llama, tus productos (o los de tus afiliadas) tuvieron más de 700 millones de usuarios activos mensuales en el mes anterior, tienes que pedirle licencia a Meta. Meta puede negarla a su sola discreción, y sin ella no puedes usar los derechos de la licencia.
- **«Built with Llama».** Si distribuyes el modelo, un derivado o un producto que los contenga, tienes que dar una copia del acuerdo y mostrar «Built with Llama» en el sitio, la interfaz, el blog, la página de «acerca de» o la documentación.
- **El nombre de los derivados.** Si usas Llama, o sus **salidas**, para crear, entrenar o afinar un modelo que distribuyes, el nombre de ese modelo tiene que empezar con «Llama».
- **La política de uso aceptable.** La licencia la incorpora por referencia: incumplirla es incumplir la licencia. También pide cumplir las leyes, incluidas las de comercio exterior.
- **Terminación.** Meta puede terminar la licencia si la incumples, y tienes que borrar los materiales. Si demandas a Meta alegando que Llama infringe tu propiedad intelectual, tus licencias se terminan.

Un **usuario activo mensual** (MAU, *monthly active users*) es una persona distinta que usó el producto al menos una vez en un mes. 200 abogados que entran todos los días son 200 MAU, no 200 × 30.

:::formula Qué tan lejos estás de un umbral de usuarios
k = frac{U_{lic}}{U}
- U_{lic}: el umbral de usuarios activos mensuales de la licencia, en usuarios (700,000,000 en Llama)
- U: los usuarios activos mensuales de tu producto, en usuarios
- k: cuántas veces estás por debajo del umbral, sin unidad (si \(k\) < 1, te alcanza)
:::

:::cuenta El despacho y un integrador contra los umbrales
Umbral de Llama, \(U_{lic}\) // de la licencia de Llama 3.3 | 700,000,000 | 700,000,000 usuarios
Usuarios del despacho, \(U\) // la ficha: 200 abogados y asistentes | 200 | 200 usuarios
Veces abajo, \(k\) // \(U_{lic} ÷ U\) | 700,000,000 ÷ 200 | **3,500,000**
Un integrador con 20 despachos de 200, \(U\) // supuesto del ejemplo | 20 × 200 | 4,000 usuarios
Veces abajo del umbral de Llama, \(k\) | 700,000,000 ÷ 4,000 | 175,000
Veces abajo del umbral de la Qwen License (Qwen2.5 72B), \(k\) // \(U_{lic}\) = 100,000,000 | 100,000,000 ÷ 4,000 | 25,000
= El umbral de usuarios está hecho para empresas del tamaño de las redes sociales más grandes del mundo. Para un despacho, un hospital o una fábrica, no es la condición que importa: lo que importa son las otras.
:::

:::figura licencias-escala
Los usuarios del despacho y de un integrador contra los umbrales de dos licencias, en una escala donde cada marca vale diez veces la anterior.
:::

:::ojo El umbral se mide en una fecha fija
El umbral de Llama se cuenta en la fecha de lanzamiento de la versión: los usuarios del mes anterior a ese día. Si tu producto tenía 10 millones cuando salió Llama 3.3 y después crece a 800 millones, esa cláusula, como está escrita, no se reactiva para Llama 3.3. Para la siguiente versión, se cuenta de nuevo.
:::

### La restricción de la Unión Europea

Circula la idea de que «Llama no se puede usar en Europa». Es más angosta, y no está en la licencia. Está en la **política de uso aceptable** de Llama 3.2 y de Llama 4: para los modelos **multimodales** de esas versiones (los que también ven imágenes), los derechos de la licencia no se otorgan a personas domiciliadas en la Unión Europea ni a empresas con sede principal allá. No aplica a los usuarios finales de un producto que incorpore esos modelos. El texto de la licencia de Llama 4 no la menciona, y la política de Llama 3.1 y 3.3 no la tiene.

Para el despacho no aplica dos veces: está en México y Llama 3.3 70B es solo texto. Pero es el mejor ejemplo de por qué hay que leer **todos** los archivos del repo, no solo el LICENSE.

Esa política es una [[politica-de-uso|política de uso]] (*acceptable use policy*, AUP): un documento aparte que lista usos prohibidos y que la licencia hace obligatorio. Se puede actualizar por separado, así que se revisa la versión que enlaza la licencia.

### Gemma 3 contra Gemma 4

Google es el ejemplo de por qué la licencia se revisa **por versión**, no por familia.

**Gemma 1 a 3** (y 3n) usan los **Gemma Terms of Use** con una política de usos prohibidos. Permiten uso comercial, pero:

- Al redistribuir Gemma o un derivado, tienes que poner las restricciones de uso como cláusula exigible en tu propio contrato, dar copia del acuerdo, marcar los archivos modificados e incluir un archivo de avisos.
- Google se reserva el derecho de restringir el uso, de forma remota o de otra forma, si cree que violas los términos.
- Google no reclama derechos sobre las salidas, y tú y tus usuarios son responsables de ellas.
- Google puede terminar el acuerdo si lo incumples, y tienes que borrar las copias.

**Gemma 4** (2026; tamaños de E2B a 31B, con un MoE de 26B) cambió a **Apache 2.0**. Según el blog de Google, es la primera familia Gemma con una licencia aprobada por la OSI. «Gemma tiene licencia restrictiva» era cierto en 2025 y sigue siéndolo para Gemma 3; para Gemma 4 ya no.

### Las MIT modificadas de 2026 y la cláusula de Model as a Service

Los modelos más grandes de 2026 trajeron un tipo nuevo de condición. Su licencia empieza como MIT y agrega una cláusula de **[[model-as-a-service|Model as a Service]]** (MaaS): el negocio de darle a terceros acceso al modelo por una API, cobrando, con control sobre lo que entra y sale. Si haces eso, y a veces solo si pasas de cierto ingreso, necesitas un acuerdo aparte.

| Modelo (2026) | Cláusula de MaaS | ¿Uso interno? |
|---|---|---|
| Mistral Large 4 | Cualquier negocio de MaaS necesita licencia comercial aparte, sin umbral | Exento |
| Qwen3.8-Max | MaaS o asistente de trabajo con IA con más de US$50 millones en 12 meses | Exento |
| Qwen3.8-Flash-Next | Cualquier MaaS o asistente de trabajo con IA comercial | Exento |
| Kimi K3 | MaaS con más de US$20 millones en 12 meses | Exento |
| Muse Spark Open (Meta) | MaaS con más de US$20 millones de ingresos brutos en 12 meses | Exento |

La columna de la derecha es la clave. Estas licencias dicen, en su propio texto, que el **uso interno** de la empresa queda fuera de la cláusula. Tiene lógica: el autor quiere cobrarle a quien le hace competencia vendiendo su modelo como servicio, no al despacho que lo usa para sus propios expedientes.

:::calculadora licencias-umbral
Elige una licencia y mueve tus usuarios y tu tipo de negocio. Mira qué tan lejos queda el umbral de usuarios y cómo la cláusula de MaaS solo despierta cuando vendes acceso al modelo a terceros.
:::

Algunas de estas licencias agregan condiciones de visibilidad: Muse Spark Open pide mostrar «Built with Muse Spark Open», y Qwen3.8-Max y Kimi K3 piden mostrar el nombre del modelo en la interfaz si pasas de 100 millones de usuarios o de US$20 millones al mes.

## Las que no dejan usar comercialmente {Non-commercial and research licenses}

Una [[licencia-no-comercial]] te deja descargar y probar el modelo, pero no usarlo en un negocio ni en producción sin pedir una licencia aparte. Es la trampa más cara, porque el modelo funciona perfecto en las pruebas: el problema aparece cuando alguien lee la licencia.

Ejemplos reales:

- **Qwen2.5 3B** usa la *Qwen Research License*: solo investigación y evaluación; el uso comercial pide licencia aparte. Los demás tamaños de Qwen2.5 son Apache, salvo **Qwen2.5 72B**, que usa la *Qwen License*: comercial permitido hasta 100 millones de usuarios activos mensuales.
- **Mistral Large 2** (noviembre de 2024) usa la *Mistral Research License*: uso comercial solo con licencia aparte.
- **Codestral 22B** (mayo de 2024) usa la *Mistral AI Non-Production License*: nada de producción.
- **Cohere Command A** (marzo de 2025) usa CC BY-NC 4.0, una licencia de Creative Commons cuyo «NC» quiere decir *non-commercial*.

Fíjate en el patrón: la misma empresa publica modelos con licencias muy distintas. Mistral Small 3.2 es Apache 2.0 y Codestral es de no producción. Qwen3 es Apache 2.0 y Qwen2.5 3B es de investigación. No se aprueba una familia: se aprueba un repo, en una versión.

:::ojo «Es interno, nadie se va a enterar»
Una licencia no comercial no se vuelve comercial porque el uso sea interno. El despacho cobra por su trabajo, y usar el modelo para hacer ese trabajo es uso comercial. Que nadie lo vea desde fuera no cambia lo que permite el texto.
:::

### Las condiciones que se heredan: DeepSeek V3 original

Hay licencias que permiten uso comercial, pero te obligan a **pasar** sus restricciones a cualquiera que reciba un derivado tuyo. Son de un estilo llamado OpenRAIL: el autor quiere que sus reglas de uso viajen con el modelo, no solo que se queden contigo.

El caso que más confunde es DeepSeek:

- **DeepSeek V3 original** (diciembre de 2024): el código es MIT, pero los pesos están bajo la DeepSeek License v1.0, con restricciones de uso que cualquier derivado tiene que incluir.
- **DeepSeek R1** (enero de 2025) y **V3-0324**, y desde ahí V3.1, V3.2 y V4: **MIT**.

Así que «DeepSeek es MIT» es cierto para R1 y para V3 desde la versión 0324, y falso para el V3 original. Dos repos con casi el mismo nombre, dos licencias.

## Modelos gated en Hugging Face {Gated models on Hugging Face}

Algunos repos no te dejan descargar hasta que pides acceso. Son [[modelo-gated|modelos gated]] (con puerta). El autor activa la opción; tú inicias sesión, aceptas sus términos (eso le comparte tu usuario y, si lo pidió, tu correo y otros datos) y esperas.

La aprobación puede ser:

- **Automática:** aceptas y descargas en el momento.
- **Manual:** una persona del autor revisa tu solicitud y decide.

El autor puede revocar el acceso en cualquier momento, sin aviso. Para descargar desde un script necesitas un token de tu cuenta.

Estado al 25 de noviembre de 2026: Llama 3.1, 3.3 y 4, Gemma 3 y Muse Spark Open son gated con aprobación manual; Qwen3.8-Flash-Next y Cohere Command A, gated automáticos; y Qwen3, Mistral, DeepSeek, gpt-oss, Phi-4, OLMo y Gemma 4, sin puerta.

:::ojo La puerta no es la licencia
Que un modelo no tenga puerta no quiere decir que su licencia sea libre, y que la tenga no quiere decir que sea restrictiva. Gemma 3 y Llama tienen puerta manual y permiten uso comercial; los modelos recientes de Mistral, Qwen y DeepSeek no tienen puerta, y esas mismas empresas publicaron otros modelos con licencias de investigación o de no producción. La puerta es un control de acceso; la licencia sigue valiendo con o sin ella.
:::

### Lo que la puerta le cambia al proyecto

Para el despacho, la puerta tiene dos consecuencias prácticas:

1. **Tiempo.** Si el plan es probar Llama 3.3 70B el lunes, hay que pedir acceso antes: la aprobación manual puede tardar, y no hay fecha garantizada.
2. **Copia propia.** El acceso se puede revocar. Una vez descargados los pesos con permiso, conviene guardar una copia con su versión exacta en el almacenamiento del despacho. La licencia sigue rigiendo esa copia, pero el proyecto ya no depende de que el repo siga abierto para ti.

:::nota Una opción para bloquear Europa
Hugging Face tiene una opción para que el autor bloquee las solicitudes que vienen de direcciones de la Unión Europea. Es otra forma de aplicar una restricción por país, en la puerta y no en el texto: revisa las dos.
:::

## Derivados: fine-tunes, cuantizados, destilados y merges {Derivatives: what they inherit}

Un [[modelo-derivado]] es uno que sale de otro modelo. Casi todo lo que descargas en Hugging Face es un derivado: la página de un modelo popular tiene cientos de versiones de otras personas. Hay cuatro tipos:

- **Fine-tune** (ajuste fino): alguien siguió entrenando el modelo con sus ejemplos. Los pesos cambian. Lo ves en [Transformers y LLMs](https://sensei.trueml.app/llms/), en la sección de cómo se adapta un modelo.
- **Cuantizado**: los mismos pesos guardados con menos bits ([[cuantizacion]]). Los formatos (GGUF, AWQ, GPTQ, FP8) los ves en la lección «Formatos de cuantización en la práctica».
- **Destilado**: un modelo más chico entrenado para imitar las salidas de uno grande.
- **Merge** (fusión): los pesos de dos o más modelos combinados en uno, sin volver a entrenar.

La regla general: **un derivado hereda la licencia del original, y quien lo hace puede sumar condiciones, pero no quitarlas**. Si la licencia de la base no permite algo, ningún paso posterior lo permite.

:::diagrama licencias-derivados
Una cadena de derivados, de Llama 3.3 70B a lo que un integrador instala en 20 despachos. Toca cada caja o sigue los recorridos.
:::

### Qué hereda cada tipo

- **Un cuantizado hereda todo.** Un GGUF de Llama 3.3 sigue bajo la licencia de Llama, aunque lo haya subido otra persona, con otro nombre y sin el LICENSE en el repo. Cambiar el formato no es una forma de lavar la licencia.
- **Un fine-tune hereda todo y puede sumar.** Con Llama, si lo distribuyes, su nombre empieza con «Llama». Con Apache 2.0 pasa algo que sorprende: quien afina puede publicar **sus cambios** con otros términos, mientras conserve los avisos del original. Un fine-tune de Qwen3 puede salir con una licencia no comercial. Se lee la licencia del derivado, no solo la de la base.
- **Un destilado depende de la licencia del maestro.** Llama pide que un modelo entrenado con salidas de Llama, si se distribuye, lleve un nombre que empiece con «Llama». La licencia de Muse Spark Open cuenta como derivado a un modelo entrenado con sus salidas. Otras no dicen nada: hay que leer cada una.
- **Un merge junta licencias.** Casi siempre se fusionan modelos de la misma arquitectura, por ejemplo dos fine-tunes de la misma base. Si uno es Apache 2.0 y el otro salió con una licencia no comercial, el resultado carga las condiciones de los dos: el merge es no comercial.

:::formula Las condiciones de un derivado de un derivado
C_n = C_0 + sum_{i=1}^{n} a_i
- C_0: las condiciones de la licencia del modelo base, en número de condiciones
- a_i: las condiciones que agrega el paso \(i\) de la cadena (un fine-tune, un cuantizado, un merge); nunca es negativo
- n: el número de pasos desde la base hasta el modelo que usas
- C_n: las condiciones que tienes que cumplir con el modelo del paso \(n\)
:::

:::cuenta Contar las condiciones de un Llama afinado y cuantizado
Condiciones de Llama 3.3, \(C_0\) // copia del acuerdo, «Built with Llama», nombre de los derivados, política de uso, umbral de 700 millones | 5 | 5
Fine-tune de un laboratorio, \(a_1\) // supuesto: pide citar su trabajo | 1 | 1
Cuantizado a GGUF por otra persona, \(a_2\) // no agrega nada | 0 | 0
Condiciones al final, \(C_2\) // \(C_0 + a_1 + a_2\) | 5 + 1 + 0 | **6**
Lo que se puede restar en cualquier paso | — | 0
= Contar sirve para no olvidar ninguna, pero no todas pesan igual. Una sola condición agregada, como «solo uso no comercial», puede valer más que las otras cinco juntas.
:::

:::ejemplo Un fine-tune legal que parece perfecto
El equipo del despacho encuentra en Hugging Face un modelo llamado «abogado-mx-70b» (un nombre inventado para el ejemplo), afinado con sentencias mexicanas. La etiqueta dice `license: other`. La model card dice: «fine-tune de Llama 3.3 70B, solo para investigación».

Con la regla de los derivados: carga las 5 condiciones de Llama, más la de su autor, «solo investigación». La segunda lo descarta para el despacho. Y hay otra señal: su nombre no empieza con «Llama», así que el autor podría ya estar incumpliendo la licencia de la base. No es un modelo sobre el que se construye un producto.
:::

## Lo que la licencia no cubre {What the license does not cover} [extra]

Una licencia de modelo te da permiso de usar los pesos. Hay cuatro cosas que no te da, y que en un despacho de abogados alguien va a preguntar.

### Los datos con que se entrenó

Los pesos salieron de entrenar con textos de terceros. La licencia no te licencia esos textos ni te garantiza que el autor tuviera derecho a usarlos. Todas las licencias leídas para esta lección traen una cláusula de «tal como está», sin garantía; la de Llama 3.3 la extiende a las salidas y resultados. El riesgo de que algo del modelo infrinja derechos de alguien se queda con quien lo despliega. Solo los modelos totalmente abiertos, como OLMo, publican sus datos para que se puedan revisar.

### La responsabilidad por lo que genera

Si el modelo inventa una cita de una sentencia y un abogado la usa en un escrito, el problema es del despacho. Los Gemma Terms of Use lo dicen directo: tú y tus usuarios son los únicos responsables de las salidas. La licencia de Muse Spark Open dice que Meta no tiene responsabilidad por los derivados y que quien recibe la licencia es el único responsable de la seguridad, el despliegue y el uso. Las de Qwen, Mistral, Kimi y GLM traen cláusulas de exención de responsabilidad. Revisar lo que contesta el modelo es trabajo del despacho, no del autor.

### De quién son las salidas

Varias licencias aclaran que el autor no reclama derechos sobre lo que genera el modelo: Gemma 3 y Muse Spark Open lo dicen, y la licencia de Llama 3.3 no reclama propiedad de las salidas (solo condiciona usarlas para entrenar otros modelos). Pero que el autor no las reclame no quiere decir que **tú** tengas derechos de autor sobre ellas.

En México, la Ley Federal del Derecho de Autor dice en su artículo 12: «Autor es la persona física que ha creado una obra literaria y artística». Una persona física es un ser humano. En el **Amparo Directo 6/2025**, la Segunda Sala de la Suprema Corte (SCJN) revisó el caso de alguien a quien el INDAUTOR le negó el registro de un avatar generado con una plataforma de IA, por no ser una creación humana. El documento oficial que está publicado es el **proyecto de sentencia**, que confirma la negativa; según la prensa, la sala lo resolvió así en julio de 2025, pero el texto final firmado no se revisó para esta lección. El criterio se centra en negar el registro por falta de autoría humana. Lo que pasa con obras donde una persona intervino de forma sustancial sigue sin resolverse.

La reforma publicada en el *Diario Oficial* el 14 de mayo de 2026 protege la voz, la imagen y las interpretaciones de artistas frente a la IA, pero no define la autoría de obras generadas por IA.

Para el despacho, la consecuencia práctica es modesta: un resumen de expediente que escribe el modelo sirve como borrador de trabajo. El escrito que firma un abogado, revisado y corregido por él, es su trabajo.

### Los datos personales que le metes

La licencia del modelo no dice nada de los expedientes que el despacho le va a dar a leer. Esos datos siguen bajo la **Ley Federal de Protección de Datos Personales en Posesión de los Particulares** (LFPDPPP), que pide aviso de privacidad, finalidades claras, medidas de seguridad y cuidado con a quién se mandan. Correr el modelo en la red propia resuelve una parte (nadie de fuera recibe los datos), pero no las demás. Lo ves a fondo en [Datos personales y la ley](https://sensei.trueml.app/privacidad/).

:::nota Licencia del modelo y ley de datos, dos carriles
La licencia es un contrato entre el autor del modelo y tú. La LFPDPPP es una ley entre tú y las personas cuyos datos tratas. Cumplir una no te acerca a cumplir la otra.
:::

## Revisar una licencia en 10 minutos {Reviewing a license in 10 minutes}

Con lo anterior se arma una lista. No reemplaza al abogado, pero hace que llegues con el trabajo hecho: el texto, las cláusulas que aplican y los números de tu caso.

:::pasos
1. ¿De dónde viene?
Confirma que es el repo del autor o, si es un derivado, de qué modelo base sale (la model card lo dice). Si es derivado, junta las dos licencias.
2. ¿Qué licencia es, exactamente?
Abre el LICENSE. Anota el nombre y la versión. Si la etiqueta dice `other` o `modified-mit`, lee el texto completo.
3. ¿Permite uso comercial y en producción?
Si dice investigación, no comercial o no producción: descártalo o negocia una licencia aparte.
4. ¿Tiene umbrales?
Usuarios activos mensuales, ingresos o Model as a Service. Ponle número a tu caso y compáralo.
5. ¿Hay política de uso u otros archivos?
Busca USE_POLICY, NOTICE, LICENSE-MODEL. Lee si tu caso o tu país aparece entre lo prohibido.
6. ¿Qué pide si lo entregas?
Avisos, copia del acuerdo, «Built with…», nombre de los derivados. Haz la lista aunque hoy no pienses distribuir.
:::

:::diagrama licencias-revisar
Las seis preguntas, en orden, y a dónde te saca cada una. Los recorridos aplican la lista a los cuatro modelos del despacho y a uno que se cae.
:::

### Aplicada a los cuatro modelos del despacho

| | Qwen3 32B | Mistral Small 24B | Qwen3 30B-A3B | Llama 3.3 70B |
|---|---|---|---|---|
| Licencia | Apache 2.0 | Apache 2.0 (3.1 y 3.2) | Apache 2.0 | Llama 3.3 Community |
| Uso comercial | Sí | Sí | Sí | Sí |
| Umbrales | Ninguno | Ninguno | Ninguno | 700 M de MAU; el despacho tiene 200 |
| Política de uso aparte | No | No | No | Sí, hay que leerla |
| Puerta en Hugging Face | No | No | No | Sí, aprobación manual |
| Si se entrega a otros | Copia, avisos, NOTICE | Copia, avisos, NOTICE | Copia, avisos, NOTICE | Copia del acuerdo, «Built with Llama», nombre de derivados |

Los cuatro pasan. Lo que cambia es cuánto trabajo cuestan: los tres Apache 2.0 son casi automáticos; Llama 3.3 pide pedir acceso con tiempo y leer la política de uso contra el caso. Si los cuatro empatan en calidad y en memoria, la licencia inclina la balanza hacia los Apache. Esa comparación de calidad es tema de la lección «Elegir un modelo para la tarea».

El mismo filtro, en un script que el equipo puede extender con más modelos:

```python
# Las cláusulas que importan de cada licencia (resumen hecho a mano del texto)
modelos = {
    "Qwen3 32B":         {"licencia": "Apache 2.0", "comercial": True, "umbral_mau": None},
    "Mistral Small 24B": {"licencia": "Apache 2.0", "comercial": True, "umbral_mau": None},
    "Qwen3 30B-A3B":     {"licencia": "Apache 2.0", "comercial": True, "umbral_mau": None},
    "Llama 3.3 70B":     {"licencia": "Llama 3.3",  "comercial": True, "umbral_mau": 700_000_000},
    "Codestral 22B":     {"licencia": "MNPL",       "comercial": False, "umbral_mau": None},
}
usuarios = 200  # usuarios activos mensuales del despacho

for nombre, m in modelos.items():
    if not m["comercial"]:
        veredicto = "descartar: no permite producción"
    elif m["umbral_mau"] and usuarios > m["umbral_mau"]:
        veredicto = "pedir licencia al proveedor"
    elif m["umbral_mau"]:
        veces = m["umbral_mau"] // usuarios
        veredicto = f"pasa ({veces:,} veces abajo del umbral)"
    else:
        veredicto = "pasa (sin umbrales)"
    print(f"{nombre:18} {m['licencia']:11} {veredicto}")
```

```salida
Qwen3 32B          Apache 2.0  pasa (sin umbrales)
Mistral Small 24B  Apache 2.0  pasa (sin umbrales)
Qwen3 30B-A3B      Apache 2.0  pasa (sin umbrales)
Llama 3.3 70B      Llama 3.3   pasa (3,500,000 veces abajo del umbral)
Codestral 22B      MNPL        descartar: no permite producción
```

El script no lee licencias: compara un resumen que una persona hizo a mano. Sirve para que el resumen viva en un lugar, con fecha, y para repetir la cuenta cuando cambie el caso. Si el resumen está mal, el script se equivoca con toda seguridad.

### La hoja de hallazgos

Lo que sale de los 10 minutos es una hoja por modelo, para el abogado: el repo exacto y su versión, el nombre de la licencia con su enlace, la fecha en que se leyó, las cláusulas que aplican con su número de sección, los números del caso (usuarios, tipo de uso, si se distribuye) y lo que no quedó claro. Con eso, la revisión legal tarda una reunión, no un mes.

## Distribuir contra usar internamente {Distributing versus using internally} [extra]

Casi todas las condiciones que viste se activan con una palabra: **distribuir**. Entender cuándo distribuyes es entender cuánto te pide la licencia.

### El despacho: uso interno

El despacho descarga Qwen3 32B, lo corre en su servidor y sus 200 personas le preguntan por la red interna. Nadie de fuera recibe los pesos ni usa el modelo. Eso es **uso interno**:

- Con Apache 2.0 o MIT, las condiciones de entrega no se activan: no le entrega copias a nadie.
- Con Llama 3.3, «Built with Llama» y la copia del acuerdo aplican al distribuir; la política de uso y el umbral aplican siempre.
- Con las MIT modificadas de 2026, el uso interno queda fuera de la cláusula de MaaS por texto expreso.

### El integrador que instala en 20 despachos

Ahora un integrador (una empresa que arma e instala sistemas para otros) vende el mismo sistema a 20 despachos y lo instala en el servidor de cada uno. Cada instalación entrega una copia de los pesos a otra empresa: **distribuye** 20 veces.

- Con Apache 2.0: en cada entrega va copia de la licencia, los avisos y el NOTICE si existe, y marca de los archivos que cambió.
- Con Llama 3.3: copia del acuerdo y «Built with Llama» visible en cada sistema. Si afinó el modelo, el nombre empieza con «Llama». Y los 20 despachos, que reciben el modelo dentro de un producto terminado, no tienen que preocuparse por el umbral de 700 millones: la licencia lo aclara para quien recibe un derivado así.

### El integrador que lo hospeda y vende acceso

Tercera variante: el integrador no instala nada en los despachos. Corre el modelo en su propio centro de datos y les vende acceso por una API, a una cuota mensual. Ya no entrega pesos, así que no distribuye en el sentido de arriba. Pero ahora hace **Model as a Service**, y ahí despiertan las cláusulas de 2026.

:::formula Lo que factura un negocio de Model as a Service
R = n × p × 12
- n: los clientes que pagan por el acceso, en clientes
- p: la cuota de cada cliente, en dólares al mes
- R: los ingresos del negocio en 12 meses, en dólares, para compararlos con el umbral de la licencia
:::

:::cuenta El integrador hospedado, contra las cláusulas de MaaS
Clientes, \(n\) // los 20 despachos | 20 | 20
Cuota, \(p\) // supuesto del ejemplo | US$2,000 al mes | US$2,000
Ingresos en 12 meses, \(R\) // \(n × p × 12\) | 20 × 2,000 × 12 | **US$480,000**
Contra Muse Spark Open o Kimi K3 // umbral de US$20 millones | 20,000,000 ÷ 480,000 | ≈ 41.7 veces abajo
Contra Qwen3.8-Max // umbral de US$50 millones | 50,000,000 ÷ 480,000 | ≈ 104 veces abajo
Contra Mistral Large 4 // sin umbral: cualquier negocio de MaaS | — | necesita licencia aparte
= Con Qwen3 32B (Apache 2.0) no hay cláusula de MaaS que revisar. Con Mistral Large 4, el mismo negocio pequeño ya necesita un acuerdo con Mistral.
:::

| Situación | ¿Distribuye? | ¿Es MaaS? | Lo que más pesa |
|---|---|---|---|
| Despacho, en su red | No | No | Uso comercial, política de uso |
| Integrador, instala en 20 despachos | Sí, 20 veces | No | Obligaciones de entrega en cada instalación |
| Integrador, hospeda y vende acceso | No entrega pesos | Sí | Cláusulas de MaaS y sus umbrales |

:::ojo Pregúntale al abogado por tu caso exacto
Dónde termina el «uso interno» y empieza el «servicio a terceros» no siempre es obvio: un despacho que deja a sus clientes hacerle preguntas al modelo desde un portal, ¿usa el modelo internamente o lo ofrece como servicio? Cada licencia lo define con sus palabras. Ese es exactamente el tipo de pregunta que se lleva al abogado con el texto en la mano.
:::

## Errores comunes {Common mistakes}

### Creer que «open weight» quiere decir «haz lo que quieras»

**Qué pasa:** el equipo descarga un modelo porque «es abierto» y lo pone en producción. Meses después, alguien lee que era de investigación.

**Cómo evitarlo:** la licencia entra al sizing desde el día uno, con la lista de 10 minutos y una hoja de hallazgos por candidato.

### Confiar en la etiqueta de Hugging Face

**Qué pasa:** la página dice `apache-2.0` porque quien subió un fine-tune la copió de otro lado, pero el modelo sale de Llama.

**Cómo evitarlo:** el texto manda. Lee el LICENSE y la model card, y si es un derivado, la licencia de la base.

### Aprobar una familia en vez de un repo

**Qué pasa:** «Qwen es Apache, Mistral es Apache». Pero Qwen2.5 3B es de investigación y Codestral es de no producción. «Gemma es restrictiva», pero Gemma 4 es Apache 2.0.

**Cómo evitarlo:** se aprueba un repo, en una versión, con la fecha en que se leyó su licencia.

### Pensar que cuantizar o afinar cambia la licencia

**Qué pasa:** alguien baja un GGUF sin LICENSE en el repo y lo trata como si no tuviera dueño.

**Cómo evitarlo:** un derivado hereda la licencia de la base. Busca en la model card de qué modelo sale.

### Confundir la puerta con la licencia

**Qué pasa:** «no pidió aprobación, así que es libre». O al revés: «tiene puerta, seguro es restrictivo».

**Cómo evitarlo:** la puerta es un control de acceso. La licencia se lee aparte, siempre.

### Leer solo el LICENSE

**Qué pasa:** la restricción de la Unión Europea de Llama 3.2 y 4 no está en el LICENSE, está en la política de uso.

**Cómo evitarlo:** lista todos los archivos de texto del repo y lee los que la licencia menciona.

## En la vida real {In real life}

### El despacho

El despacho, el ejemplo ficticio de esta lección, tiene 200 abogados y asistentes y quiere preguntarle a sus expedientes con un LLM en su propia red. Su candidato, Qwen3 32B, es Apache 2.0: uso comercial, sin umbrales, sin política aparte. Lo corre internamente, así que las condiciones de entrega no se activan. Las alternativas Mistral Small 24B y Qwen3 30B-A3B pasan igual. Llama 3.3 70B también pasa (200 usuarios contra 700 millones), pero cuesta más trabajo: puerta con aprobación manual, una política de uso que revisar y, si algún día el despacho quisiera compartir un fine-tune con otro despacho, el nombre y el «Built with Llama». La hoja de hallazgos de los cuatro va al abogado del propio despacho, que en este caso es fácil de encontrar.

### Una clínica

Una clínica con 40 médicos (números supuestos) quiere resumir notas clínicas en su red. Un proveedor le propone Gemma 3 27B. La revisión encuentra los Gemma Terms of Use: uso comercial permitido, pero Google se reserva restringir el uso si cree que se violan los términos, y si la clínica algún día le entrega un derivado a otra clínica, tiene que pasar las restricciones de uso en su propio contrato. Además, las notas son datos personales sensibles: la LFPDPPP pide consentimiento expreso y por escrito para tratarlos, y eso la licencia ni lo toca. La clínica compara con Gemma 4 31B, que es Apache 2.0, y pide que la evaluación de calidad incluya a los dos.

### Un integrador que revende

Un integrador quiere vender «asistente legal privado» a 20 despachos. Con Llama 3.3 instalado en cada uno, distribuye 20 veces: copia del acuerdo y «Built with Llama» visible en cada sistema, y si afina el modelo con sentencias, el nombre empieza con «Llama». Con Qwen3 32B, copia de Apache 2.0, avisos y NOTICE. Si en vez de instalar decide hospedar el modelo y vender acceso, revisa las cláusulas de MaaS: con Qwen3 no hay; con Mistral Large 4 necesitaría licencia aparte desde el primer cliente. Su decisión de producto (instalar o hospedar) cambia qué licencias le convienen.

## Ejercicios {Exercises}

Resuélvelos con el texto de la lección a la mano. Los cuatro primeros son directos; los últimos piden juntar varias ideas.

:::ejercicios
? [facil] ¿Qué archivo de un repo de Hugging Face manda sobre lo que puedes hacer con el modelo: la etiqueta de la página, el README.md o el LICENSE?
El **LICENSE**: es el texto completo de la licencia. La etiqueta la escribe quien sube el modelo y es una pista. El README.md es la model card: ayuda a leer la licencia (por ejemplo, dice si es un fine-tune de otro modelo), pero no la reemplaza. Si hay archivos como USE_POLICY o NOTICE, también cuentan.
? [facil] Una fábrica tiene 1,500 personas que usarían un asistente con Llama 3.3 70B. ¿Cuántas veces está por debajo del umbral de la licencia?
Con \(k = U_{lic} ÷ U\): 700,000,000 ÷ 1,500 ≈ **466,667 veces**. La cláusula de los 700 millones no le alcanza; le siguen aplicando las demás condiciones (política de uso y, si distribuye, copia del acuerdo y «Built with Llama»).
? [facil] ¿Qué tres cosas pide la Open Source AI Definition 1.0 de la OSI, además de las libertades de usar, estudiar, modificar y compartir?
Información de los datos de entrenamiento (suficiente para que una persona capacitada construya un sistema sustancialmente equivalente), el código completo (procesar datos, entrenar, validar e inferir) y los parámetros (los pesos). No exige publicar todos los datos: los que no se pueden compartir se describen en detalle.
? [facil] Un modelo no tiene puerta en Hugging Face. ¿Quiere decir que su licencia permite uso comercial?
**No.** La puerta es un control de acceso y la licencia es aparte: hay que leerla siempre. Las dos cosas van por separado también al revés: Gemma 3 tiene puerta con aprobación manual y su licencia sí permite uso comercial.
? [medio] El despacho encuentra un GGUF de Llama 3.3 70B subido por otra persona, sin archivo LICENSE. ¿Qué licencia tiene y qué tendría que revisar antes de usarlo?
Un cuantizado hereda la licencia de la base: es la **Llama 3.3 Community License**, aunque el repo no la traiga. Con \(C_n = C_0 + sum a_i\), tiene al menos las 5 condiciones de Llama, más las que agregue quien lo subió (\(a_1\)), si dice alguna en la model card. Antes de usarlo: confirmar en la model card de qué modelo exacto sale, revisar que no sea un fine-tune con condiciones extra, y preferir descargar el original del repo de Meta (con su puerta) o cuantizarlo en casa, para saber exactamente qué pesos se corren.
? [medio] Un fine-tune de Qwen3 32B publicado por un laboratorio dice `license: cc-by-nc-4.0`. Qwen3 es Apache 2.0. ¿Puede el despacho usarlo en producción?
**No sin pedir permiso.** Apache 2.0 deja que quien afina publique sus cambios con otros términos, mientras conserve los avisos del original. El laboratorio eligió CC BY-NC 4.0, que es no comercial. El despacho usaría el modelo para su trabajo, que cobra: uso comercial. Opciones: usar el Qwen3 32B original o pedirle al laboratorio una licencia comercial.
? [medio] Un integrador hospeda Qwen3.8-Max y vende acceso por API a 30 empresas a US$5,000 al mes cada una. ¿Le alcanza la cláusula de MaaS?
Con \(R = n × p × 12\): 30 × 5,000 × 12 = **US$1,800,000** en 12 meses. El umbral de Qwen3.8-Max es de US$50 millones: 50,000,000 ÷ 1,800,000 ≈ 27.8 veces abajo. **No le alcanza** todavía. Con Mistral Large 4, el mismo negocio sí necesitaría licencia aparte, porque cualquier MaaS cuenta.
? [medio] ¿Por qué «DeepSeek V3 es MIT» puede ser falso? ¿Qué cambia para un derivado?
Porque el **V3 original** (diciembre de 2024) tiene el código en MIT y los pesos bajo la DeepSeek License v1.0, con restricciones de uso. Desde **V3-0324** (y R1), los pesos son MIT. Un derivado del V3 original tiene que incluir las mismas restricciones de uso en su propia licencia; uno de V3-0324 solo tiene que conservar el aviso de MIT.
? [reto] Un laboratorio hace un merge de dos fine-tunes de Llama 3.3 70B: uno publicado solo con la licencia de Llama y otro cuyo autor agrega «solo investigación». ¿Qué condiciones tiene el merge y quién puede usarlo en producción?
Con \(C_n = C_0 + sum a_i\): la base es Llama 3.3 (\(C_0\) = 5). El primer fine-tune suma 0 condiciones nuevas; el segundo suma 1, «solo investigación». Un merge junta lo de los dos: \(C\) = 5 + 0 + 1 = **6**, y una de ellas prohíbe el uso comercial. **Nadie** puede usarlo en producción sin un permiso del autor del segundo fine-tune. Además, si se distribuye, su nombre tiene que empezar con «Llama».
? [reto] El despacho quiere abrir un portal para que sus 500 clientes (un supuesto del ejercicio) le hagan preguntas al modelo sobre sus propios expedientes, con Qwen3 32B. Un socio propone cambiar a Mistral Large 4 «porque es más grande». ¿Qué revisas en cada licencia y qué preguntas llevas al abogado?
**Qwen3 32B** (Apache 2.0): no tiene umbrales ni cláusula de MaaS. Que los clientes usen el modelo desde un portal no cambia nada en la licencia; el despacho no entrega pesos. Lo que sí cambia: la LFPDPPP (los clientes ven datos y el portal es una nueva finalidad) y la responsabilidad por las respuestas.

**Mistral Large 4** (MIT modificada): cualquier negocio de Model as a Service necesita licencia aparte, y el uso interno está exento. La pregunta para el abogado: un portal donde los clientes le preguntan al modelo sobre sus asuntos, ¿es uso interno del despacho, o es darle a terceros acceso al modelo con control sobre las entradas? Si fuera lo segundo, necesitaría un acuerdo con Mistral. (Aparte: un modelo de 1 billón de parámetros no cabe en una L40S; ese es otro problema, de sizing.)

La hoja para el abogado: el texto de las dos licencias con la fecha de lectura, la sección de MaaS de Mistral, la descripción exacta del portal (quién entra, qué ve, si se cobra aparte) y los 500 usuarios.
:::

## Lo que sigue {What comes next}

La lección «Elegir un modelo para la tarea» toma los candidatos que pasaron esta revisión y los compara por familia, tamaño y benchmarks: la licencia filtra, la calidad decide. En «Formatos de cuantización en la práctica» verás cómo se hacen los GGUF y AWQ de los que aquí solo importaba que heredan la licencia. Y si quieres repasar cómo se adapta un modelo (fine-tuning, LoRA, RAG), está en [Transformers y LLMs](https://sensei.trueml.app/llms/); la ley de datos que rige lo que le metes, en [Datos personales y la ley](https://sensei.trueml.app/privacidad/).

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta en el glosario.

:::conceptos
open-source-ai licencia-de-modelo licencia-permisiva apache-2 licencia-mit licencia-llama politica-de-uso licencia-no-comercial model-as-a-service modelo-gated model-card modelo-derivado
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Cuál es la diferencia entre open weight y open source según la OSI?
Open weight es que puedes descargar los pesos, con la licencia que sea. Open source, según la Open Source AI Definition 1.0 (octubre de 2024), pide además el código completo para entrenar e inferir y la información detallada de los datos, todo con términos que permitan usar, estudiar, modificar y compartir. OLMo cumple; Llama no.
? ¿Qué da Apache 2.0 que MIT no da de forma explícita?
Una concesión de patentes: los contribuyentes te dan permiso de usar sus patentes que cubren el trabajo, y lo pierdes si demandas alegando que la obra infringe una patente. Apache 2.0 también pide marcar los archivos modificados y conservar el NOTICE.
? ¿A quién le alcanza el umbral de 700 millones de la licencia de Llama, y cuándo se cuenta?
A una empresa cuyos productos (con sus afiliadas) tuvieron más de 700 millones de usuarios activos mensuales en el mes anterior a la fecha de lanzamiento de esa versión de Llama. Tiene que pedirle licencia a Meta, que puede negarla.
? Un GGUF de Llama 3.3, ¿bajo qué licencia está?
Bajo la licencia de Llama 3.3: un cuantizado es un derivado y hereda todo. Quien lo hizo puede sumar condiciones, no quitarlas.
? ¿Qué es una cláusula de Model as a Service y por qué casi nunca le toca a una empresa que usa el modelo internamente?
Es una condición que pide un acuerdo aparte para el negocio de darle a terceros acceso al modelo por API, a veces arriba de un umbral de ingresos. Las licencias de 2026 que la traen (Mistral Large 4, Qwen3.8-Max, Kimi K3, Muse Spark Open) dicen en su texto que el uso interno queda exento.
? ¿Qué cosas no cubre la licencia de un modelo?
Los derechos sobre los datos con que se entrenó, la responsabilidad por lo que genera (es tuya), los derechos de autor de las salidas (en México, la ley pide una persona física como autor) y los datos personales que le das a leer, que siguen bajo la LFPDPPP.
:::
