---
titulo: Financiera
en: Sizing case: a consumer bank's call center
subtitulo: Un banco pequeño de consumo en Monterrey quiere que, cada noche, sus 8,000 llamadas del día se transcriban, se resuman y se clasifiquen, y que el supervisor vea las quejas a las 7:00. Lo que piden el secreto bancario, la CNBV, la CONDUSEF y las reglas de las tarjetas; dos modelos en cadena; si cabe en la ventana el día que llega el doble; cómo se examina y cuánto cuesta cada llamada.
pregunta: «Grabamos todas las llamadas y nadie las escucha. Queremos saber cada mañana quién se quejó, de qué y quién prometió pagar, sin que una grabación salga del banco.» ¿Qué se le propone a la financiera y cómo se defiende cada número?
requisitos: recorrido, requisitos-hardware, concurrencia, batching, pruebas-carga, evals, seguridad, costo-total
sensei: privacidad, cifrado, aprendio, colas
---

:::idea
Los tres casos anteriores atendían a una persona que espera. Aquí no espera nadie: hay un **lote** de 800 horas de audio y una **ventana** de 22:00 a 06:00. La medida deja de ser el primer token y pasa a ser el **throughput**: horas de audio por hora de GPU. Y hay dos modelos en cadena, no uno: el famoso (el LLM que resume y clasifica) gasta ≈ 18 % de la GPU de la noche; el que manda es el de **voz a texto**. Lo demás lo deciden tres reglas que ningún caso tenía: el **secreto bancario**, las reglas de la CNBV (la Comisión Nacional Bancaria y de Valores, que supervisa a los bancos) para contratar a un tercero y las de las tarjetas, que no dejan guardar el código de seguridad ni en un audio.
:::

## La financiera y lo que pide {The bank and what it asks for}

Llaman la directora de Experiencia del Cliente y el Oficial de Cumplimiento de una **institución de banca múltiple** (un banco comercial, en el nombre de la ley) **pequeña, de consumo**, con sede en **Monterrey, Nuevo León**: tarjeta de crédito y crédito personal, ≈ 1.2 millones de clientes en todo el país. Es ficticia («la financiera»); sus números viven en `content/financiera.json` y lo del mundo real lleva su fuente y su fecha.

La directora cuenta el problema: «Tenemos 200 agentes y grabamos todo, pero escuchamos unas cuantas llamadas al azar. Nos enteramos de una queja cuando el cliente ya fue a la CONDUSEF.» La CONDUSEF (Comisión Nacional para la Protección y Defensa de los Usuarios de Servicios Financieros) es la autoridad ante la que un cliente reclama contra su banco.

El Oficial de Cumplimiento pone las condiciones: «Ninguna grabación sale del banco. Nada de datos de tarjeta en ningún lado. Y el modelo no decide nada: propone, y una persona confirma.»

| Dato | Valor | De dónde sale |
|---|---|---|
| Llamadas | 8,000 al día: 5,600 entrantes y 2,400 de cobranza propia | Supuesto |
| Duración | 6.0 min en promedio → **800 h de audio al día** | Supuesto (4–7 min en blogs del sector) |
| Mes | 240,000 llamadas (el centro abre 8:00–20:00, los 7 días) | Supuesto |
| Grabación | Estéreo: agente y cliente en canales separados | Supuesto a confirmar con la central |
| Lo que piden | Cada noche: transcribir, resumir y clasificar (motivo, queja y su causa, promesa de pago, banderas) | Decisión del caso |
| Ventana | 22:00–06:00; el tablero, listo a las 7:00 | Supuesto |

Las lecciones [De requisitos a hardware](/requisitos-hardware/), [Pruebas de carga](/pruebas-carga/) y [Evals](/evals/) ya tenían una financiera con un lote nocturno de documentos. **Este caso lleva esa idea a llamadas de voz**, con un modelo antes del LLM.

**Por qué privado.** Una llamada sobre la tarjeta de un cliente está protegida por el [[secreto-bancario|secreto bancario]], que la ley extiende a cualquier proveedor que la toque; contratarlo pide el visto bueno del Consejo, un aviso a la CNBV y, fuera de México, su autorización; y las grabaciones llevan tarjetas dichas en voz alta. **Ninguna regla prohíbe la nube**: la hace cara de tramitar. Y en dinero, el propio cuesta ≈ 36 % de una API de transcripción a US$0.006 por minuto (≈ 71 % de la más barata, la «mini» de US$0.003).

## Secreto, terceros, quejas y tarjetas {Secrecy, third parties, complaints and cards}

Lo propio de un banco: cinco reglas que ninguna lección leyó. La LFPDPPP 2025 ya la explicaron la [clínica](/casos/clinica/) y Sensei en [«Privacidad»](https://sensei.trueml.app/privacidad/); aquí va solo lo que agrega grabar una llamada. Es la lectura del caso, no asesoría.

:::intenta ¿Qué regla pide cada decisión?
Cinco fuentes. **El secreto bancario** (Ley de Instituciones de Crédito, la «LIC», arts. 142 y 46 Bis 1): lo de un cliente no se le da a nadie, y la regla alcanza a los proveedores. **La CNBV** (sus disposiciones, las «CUB»): un tercero pide informe con la ubicación de los servidores y aprobación del Consejo (art. 318), un aviso previo a la CNBV (art. 326) y, si trabaja fuera de México, su autorización (art. 328); las grabaciones se guardan 180 días y el cliente puede pedir su transcripción (316 Bis 15). **La CONDUSEF**: toda reclamación, por cualquier medio, se responde en 30 días hábiles. **PCI DSS**: el código de seguridad no se guarda, ni en un audio. **La LFPDPPP**: el titular puede oponerse a que una máquina, sin intervención humana, evalúe su rendimiento profesional.

¿Qué fuente pide cada decisión? a) El servidor va en el centro de datos del banco, no en una API. b) La grabación se pausa mientras el cliente dicta su tarjeta. c) La transcripción tiene que estar bien escrita, no solo «servir para clasificar». d) El modelo propone la causa de la queja y una persona la confirma. e) Las transcripciones no se usan para calificar agentes sin decírselo. f) Se guarda cuándo se dijo «quiero reclamar».
???
1. **a) El secreto y la CNBV.** Una API es un tercero: el secreto se le extiende (46 Bis 1), su contrato pasa por el art. 318 y, si sus servidores están en EE. UU., por la autorización del 328.
2. **b) PCI DSS** (req. 3.3.1 y su FAQ 1210): el código no se guarda; lo primero es que no se grabe.
3. **c) La CNBV**, 316 Bis 15: si el cliente pide su grabación, se le da su transcripción.
4. **d) La CONDUSEF**: la respuesta y el reporte son de la institución; un error del modelo no la excusa.
5. **e) La LFPDPPP**, art. 26 fr. II, y lo laboral, que revisa el abogado.
6. **f) La CONDUSEF**: el plazo de 30 días hábiles corre desde que se recibe la reclamación, y una llamada es un medio.
:::

Ninguna es de hardware y todas cambian el diseño; la **b** ni siquiera es del sistema de IA: es de la central.

### El secreto bancario y los terceros

El **art. 142** de la Ley de Instituciones de Crédito (última reforma DOF 14-nov-2025, leída el 27-nov-2026) hace confidencial lo de las operaciones de un cliente: solo se le da a él, a sus representantes y a las autoridades que la ley nombra. El **art. 46 Bis 1** extiende esa regla a los terceros que le dan servicios al banco y a sus empleados.

:::analogia El confesionario con proveedores
El secreto bancario se parece al del confesionario: lo que se dice ahí no sale. Lo raro del banco es que tiene proveedores, y la ley los mete al confesionario con él: quien transcriba una llamada queda obligado igual.

Dónde se rompe: al confesionario no lo visita nadie; al proveedor de un banco lo puede visitar la CNBV, y el banco responde por lo que el proveedor haga.
:::

El trámite está en las disposiciones de la CNBV (las «CUB», con modificaciones al 6-nov-2026): el [[servicio-de-terceros|servicio de terceros]] del art. 318 pide un informe con la ubicación de los servidores, políticas aprobadas por el Consejo y un contrato con cláusulas fijas. Antes de contratar, el banco **avisa a la CNBV** (art. 326); si el servicio corre **fuera de México**, necesita su **autorización** (art. 328). Un servidor propio no es un tercero.

:::profundo El art. 318, cláusula por cláusula
- **Informe y flujograma** con los procesos, la información que se intercambia y **«la ubicación física de los servidores»** (fr. II).
- **Políticas** para elegir al tercero, aprobadas por el **Consejo de Administración** a propuesta del Comité de Riesgos o de Auditoría; el Comité de Auditoría verifica que se apliquen.
- **El contrato, por escrito:** visitas de la CNBV y del auditor externo, auditorías del banco, entrega de registros, que el tercero avise con **30 días naturales** si cambia su objeto social o su organización, confidencialidad con el art. 142, límites a la subcontratación, protección de datos personales, que el banco responde por el tercero, y la **transferencia, devolución y eliminación segura** de la información al terminar (fr. III); y que el prestador «no conserve información alguna» (fr. IV).
- **La nube tiene nombre:** «cómputo bajo demanda y de infraestructura tecnológica a través de Internet».
- **Fuera de México:** si algo se procesa total o parcialmente fuera del país, el director general fija políticas de seguridad para eso y las vigilan el Comité de Auditoría y el auditor interno (último párrafo).
- **El aviso y la autorización:** el art. 326 aplica cuando el tercero hace un proceso de la operación o administra bases de datos (transcribir las llamadas encaja ahí, en la lectura del caso): el aviso va 20 días hábiles antes y la CNBV puede pedir que no se contrate. Lo firma el director general, lleva el informe de la fr. II y el proyecto de contrato (art. 327); si la CNBV no responde en 20 días hábiles, se puede contratar. Para un servicio fuera de México (art. 328), la autorización se pide con 20 días hábiles de anticipación y pide, además, que el tercero esté en un país que proteja los datos personales (o con un acuerdo con México), que el banco guarde en México las auditorías y los reportes, y un acuerdo del Consejo o de un comité que diga que la distancia y el idioma no ponen en riesgo la operación.
- La CNBV puede ordenar en todo momento visitas y auditorías al tercero (318 Bis).

Una SOFOM no regulada (una sociedad que da crédito, arrendamiento o factoraje y solo se registra ante la CONDUSEF) no tiene un artículo de secreto en su ley; una SOFIPO (una sociedad financiera popular, autorizada y supervisada por la CNBV) sí (Ley de Ahorro y Crédito Popular, art. 34). Por eso el caso eligió un banco: es la entidad con más reglas escritas que enseñar.
:::

### El centro de contacto y sus grabaciones

El art. **316 Bis 15** de las CUB pide guardar las grabaciones de la banca telefónica **al menos 180 días naturales**, y trae algo que ninguna lección imaginaba: si el cliente pide una de esas grabaciones, no se le da copia del audio; se le deja escucharla y se le da **una transcripción**, en 10 días hábiles. La transcripción deja de ser un paso intermedio: es un documento que se entrega.

:::profundo Los dos artículos de las grabaciones, completos
El **316 Bis 7** pide seguridad física y lógica en la infraestructura de los centros de atención telefónica, «incluyendo los dispositivos de grabación de llamadas» y sus medios de almacenamiento y respaldo; separar las funciones de los operadores, e impedir que registren datos de los usuarios en medios distintos a los del banco. Las transcripciones y los resúmenes nacen de esas grabaciones: heredan sus controles.

El **316 Bis 15**, fr. I, pide que las bitácoras, «incluyendo las grabaciones de llamadas de Banca Telefónica Voz a Voz», se guarden en forma segura por un mínimo de 180 días naturales, contra alteración y con control de acceso. Esas grabaciones son las de contratar, activar, modificar o suspender el servicio; la financiera aplica los 180 días a todas sus llamadas, por decisión propia. Otro proceso, la identificación remota de un cliente, se conserva 10 años (art. 51 Bis 6).
:::

### Las quejas: la UNE y el REUNE

Cada institución tiene una [[une|UNE]] que recibe las reclamaciones **por cualquier medio** y las responde por escrito en **30 días hábiles** como máximo (Ley de Protección y Defensa al Usuario de Servicios Financieros, art. 50 Bis, leída el 27-nov-2026), y las reporta en el [[reune|REUNE]] con su causa. El catálogo de causas **no está en el Diario Oficial**: vive en el REUNE. El caso usa uno de ejemplo de 10 causas más «sin queja», las más frecuentes de 2025.

:::profundo Las causas más frecuentes de 2025 y lo que dicen de la cobranza
De enero a septiembre de 2025 hubo **197,721** reclamaciones ante la CONDUSEF, según una nota de Publimetro del 3-nov-2025 que atribuye los datos a la CONDUSEF (fuente secundaria). Las primeras: consumos no reconocidos (24,018, el 12.1 %), **amenazar, insultar o intimidar al deudor** (14,502, el 7.3 %), **cobranza a personas que no son el cliente** (11,520, el 5.8 %) y transferencias no reconocidas (10,868, el 5.5 %).

La segunda y la tercera son de cobranza: justo lo que pueden producir las 2,400 llamadas de cobranza propia de la financiera. El clasificador no solo busca quejas del cliente: busca **riesgos del propio banco**. Y la hora de la llamada (las reglas de la CONDUSEF para despachos de cobranza fijan de 7:00 a 22:00, DOF 7-oct-2014) sale de los metadatos de la central, con una regla, sin modelo.

Tres de las diez causas tienen fronteras difusas: consumo no reconocido, consumo por internet no reconocido y cargo no reconocido en la cuenta. Ahí se va a confundir el clasificador, y ahí se estratifica el examen.
:::

:::ojo El modelo propone; la UNE decide
El resumen y la causa que escribe el modelo **no sustituyen** la respuesta de 30 días ni el reporte al REUNE. Son una ayuda para que la supervisora vea a las 7:00 lo que antes no veía. Si el modelo no marca una queja y nadie la levanta, el plazo corre igual y el error es del banco.
:::

### Las tarjetas: PCI DSS y el audio

[[pci-dss|PCI DSS]] es el estándar que piden las marcas de tarjetas y publica su consejo, el PCI SSC (4.0.1, junio de 2024, leída en la copia de una universidad). Dos reglas pesan aquí: el [[sad|dato de autenticación]] (el código de seguridad, el CVV) **no se guarda después de autorizar, ni cifrado** (req. 3.3.1), y el [[pan|número de tarjeta]] se muestra con a lo más el BIN (los primeros dígitos, que dicen qué banco la emitió) y los últimos 4, y se guarda ilegible (3.4.1 y 3.5.1). La norma cuenta como almacenamiento los **archivos de audio**.

**El audio mismo es el problema.** El LLM nunca oye el audio, pero Whisper sí transcribe el código si el cliente lo dijo, y transcribir vuelve **buscable** lo que en el audio estaba enterrado. Y hay un choque: la CNBV pide **guardar** las grabaciones 180 días; PCI pide **no tener** el código. Se resuelve antes de grabar: la central **pausa** la grabación mientras el cliente dicta la tarjeta.

:::profundo Lo que dicen el suplemento telefónico y la FAQ 1210
El suplemento del PCI SSC «Protecting Telephone-Based Payment Card Data» (v3.0, 2018) dice que cifrar el código en una grabación no basta: no debe poder buscarse ni escucharse con las funciones de consulta del grabador. Su sección 7.2.5, «Voice Analytics», avisa justo de este proyecto: las herramientas que combinan transcripción y almacenamiento se diseñan para localizar tipos de datos, y su uso donde hay datos de tarjeta se controla y se vigila con cuidado.

La FAQ 1210 del PCI SSC (actualizada en junio de 2025) dice el orden: evitar que se grabe o redactar el audio al capturarlo; si no se puede, borrarlo de inmediato; si tampoco, controles compensatorios (evaluación de riesgo anual, acceso restringido a las grabaciones y a sus búsquedas), que valida la evaluación anual. Y aclara que PCI DSS no reemplaza las leyes locales de retención de audio.
:::

### Grabar la llamada y la ley de datos

El aviso se puede dar **hablado**: el saludo «esta llamada es grabada…» es el aviso simplificado (LFPDPPP art. 16 fr. II), y el integral tiene que nombrar la finalidad nueva, analizar las llamadas con IA. Y el **art. 26 fr. II** deja al titular oponerse a una decisión automatizada que evalúe su **rendimiento profesional** sin intervención humana: el titular, aquí, es el agente.

:::profundo Consentimiento y lo laboral
Los datos financieros piden consentimiento expreso (art. 7), salvo lo que exige la relación jurídica con el cliente (art. 9 fr. IV): atender su llamada cabe ahí; analizarla con IA para otra cosa, quizá no, y por eso el aviso la nombra. La CONDUSEF no exige el aviso de grabación: viene de esta ley. Lo laboral (las reglas de monitoreo de empleados) no se leyó para este caso: lo revisa el abogado laboral, y el caso no cita artículos que no leyó.
:::

## Requisitos y perfil de carga {Requirements and load profile}

:::intenta ¿Qué tan rápida tiene que ser la voz a texto?
De la ficha: 8,000 llamadas de 6 minutos al día. La ventana es de 22:00 a 06:00 (8 horas) y el lote se diseña con 15 % de margen. La velocidad de un modelo de voz a texto se mide en [[rtfx|RTFx]]: horas de audio que transcribe por cada hora de GPU. ¿Cuántas horas de audio hay que transcribir? Con **una sola GPU**, ¿qué RTFx necesita para un día normal? ¿Y para el día pico, que trae el doble?
???
1. Audio: 8,000 × 6 ÷ 60 = **800 h** al día.
2. Horas útiles: 8 × (1 − 0.15) = **6.8 h**.
3. Un día normal con una GPU: 800 ÷ 6.8 ≈ **118×**. Sin margen serían 100×.
4. El día pico: 1,600 ÷ 6.8 ≈ **235×**. Con una GPU, la voz a texto tendría que transcribir casi cuatro horas de audio por minuto.
:::

Ese 235 se queda en la cabeza: es el tamaño del problema antes de elegir nada.

### Lo que hace, lo que no y qué tan bien

Funcionales: por cada llamada, **transcribir** los dos canales, **redactar** los datos de tarjeta, **resumir** en ≈ 120 palabras y **clasificar**: motivo, **queja** y su **causa** del catálogo, **promesa de pago** con monto y fecha, y tres **banderas** (amenaza, menciona a la CONDUSEF, posible fraude). Lo que **no** hace: responder ni reportar la queja, calificar agentes, buscar lavado de dinero (otro proyecto, otra norma) ni escuchar en vivo.

Los [[requisito-no-funcional|no funcionales]] cambian de naturaleza:

| Requisito | Valor | Por qué |
|---|---|---|
| Throughput | 800 h de audio y 8,000 llamadas en ≤ 6.8 h | La ventana con 15 % de margen |
| Día pico | El doble, también en ≤ 6.8 h | Quincena y cierre de mes (supuesto) |
| [[ttft\|TTFT]] | **No aplica** | Nadie espera cada llamada |
| Si falla una GPU | El lote termina antes de las 7:00, aunque sea sin margen | Un lote no se cae: se atrasa |
| Datos de tarjeta | 0 en transcripciones, resúmenes y registros | PCI DSS |
| Quejas | ≤ 2 % perdidas, demostrado en el examen | Cada queja perdida es un plazo que corre |

Como el resumidor por lotes de [Concurrencia](/concurrencia/): lo que importa son los [[throughput-de-tokens|tokens por segundo totales]], aunque cada llamada salga lenta.

### De palabras a tokens en una llamada

:::cuenta Los tokens de una llamada
Palabras por minuto // los dos hablantes, con pausas y esperas (supuesto) | supuesto | 130
Palabras por llamada | 6 × 130 | 780
Tokens por palabra // 1.47–1.57 medidos en una llamada sintética; 2.09 con cifras (la clínica) | valor del ejemplo | 1.8
Tokens de la transcripción | 780 × 1.8 | 1,404
Instrucciones, esquema y catálogo // iguales en las 8,000 (supuesto) | fijo | 600
Entrada por llamada, \(N_e\) | 1,404 + 600 | **2,004**
Salida por llamada, \(N_s\) // el JSON con el resumen (supuesto) | supuesto | **350**
= Al día: 16.0 millones de tokens de entrada y 2.8 de salida. Una pregunta del despacho leía ≈ 6,000; una llamada lee un tercio, pero hay 8,000 cada noche.
:::

El 1.8 es lo más débil: la llamada sintética traía los números en palabras, y la voz a texto los escribe en cifras («$1,250»), que pesan más. Se mide con transcripciones reales, adentro.

:::profundo Lo que falta preguntar
Al proveedor de la central: **¿entrega la grabación en dos canales?** (es la pregunta que más cambia el caso; la sección siguiente dice por qué), ¿a qué hora exporta los archivos del día?, ¿puede pausar la grabación al dictar una tarjeta? A Cumplimiento: ¿cuánto se guardan las transcripciones y los resúmenes? A TI: ¿la ventana de 22:00 a 06:00 es de verdad o la comparten otros procesos nocturnos?
:::

## Dos modelos y una ventana {Two models and one window}

:::intenta ¿Cuántas horas de GPU pide el LLM?
De la sección anterior: 8,000 llamadas con 2,004 tokens de entrada y 350 de salida. La [herramienta de velocidad con Qwen3.8 27B en FP8 en una L40S y 32 llamadas a la vez](/herramientas/velocidad/?p1=l40s&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=2004&No=350&b=32) da un [[prefill]] de **6,550 tokens por segundo** y un [[decode]] de **555 tokens por segundo** entre las 32. ¿Cuántas horas de una L40S pide el LLM cada noche? Compáralo con la voz a texto: si una L40S transcribe a 85×, ¿cuántas horas pide?
???
1. Prefill: 8,000 × 2,004 = 16.03 millones ÷ 6,550 ≈ 2,448 s ≈ **0.68 h**.
2. Decode: 8,000 × 350 = 2.8 millones ÷ 555 ≈ 5,045 s ≈ **1.40 h**.
3. LLM: ≈ **2.08 h** de una L40S.
4. Voz: 800 ÷ 85 ≈ **9.41 h**. La voz pide 4.5 veces más GPU que el LLM.
:::

El modelo del que todos hablan es el barato. Lo que manda la ventana es el que nadie mencionó en la llamada.

:::figura caso-financiera-gpu
Las horas de GPU de una noche normal. Con la cota baja de la voz a texto, el LLM es ≈ 18 % del total.
:::

### La voz a texto: Whisper, faster-whisper y una velocidad que no está medida

El modelo de [[voz-a-texto|voz a texto]] es **Whisper large-v3-turbo** (OpenAI, [[licencia-mit|MIT]], 808,878,080 parámetros: large-v3 con 4 capas de decodificador en vez de 32). Corre en **faster-whisper 1.2.1** (MIT), sobre CTranslate2 4.9.1 (el motor de inferencia que la ejecuta), con transcripción por lotes y un [[vad|VAD]] que salta los silencios (consultados el 27-nov-2026). Sus pesos ocupan ≈ 1.6 GB en 16 bits (≈ 6 GB de VRAM con todo, según OpenAI): el problema no es la memoria, es la velocidad.

El Open ASR Leaderboard (una tabla pública que compara modelos de voz a texto; arXiv 2510.06961 v4, 30-mar-2026) mide turbo a **200×** en una **A100 de 80 GB** con lote de 64, en inglés, y avisa que el RTFx no se transfiere a otro hardware. Para la L40S hay una **banda**:

:::formula La banda del RTFx en otra GPU
R_{baja} = R_{A100} × frac{B}{B_{A100}} ,   R_{alta} = R_{A100} × frac{F}{F_{A100}}
- R_{A100}: el RTFx publicado en la A100 (200)
- B y B_{A100}: el ancho de banda de memoria de cada GPU (864 y 2,039 GB/s, de `gpus.json`)
- F y F_{A100}: el pico de FP16 denso de cada GPU (362.05 y 312 TFLOPS)
- R_{baja}, R_{alta}: la velocidad estimada si la voz a texto la limitara la memoria o el cálculo
:::

Con la L40S salen **≈ 85×** y **≈ 232×**: la baja supone que transcribir lo limita la memoria, como el decode; la alta, el cálculo, como el prefill. Whisper hace las dos cosas (el codificador calcula; el decodificador, chico en turbo, lee) y ninguna medición dice en qué punto de la banda queda. El caso dimensiona con **85×** y el piloto mide.

:::ojo Un RTFx publicado no es tu RTFx
Cambian la GPU, el audio (inglés leído contra español de México por teléfono) y el programa. La velocidad sí se puede medir **antes de comprar** y sin datos de clientes, con audio grabado por el equipo en una GPU rentada por horas. El error (el WER) no: pide llamadas reales, adentro.
:::

### Estéreo, mono y el silencio

En **estéreo con VAD** (el supuesto), cada canal es un hablante y el VAD salta lo que ese canal calla: los dos suman, a lo más, las 800 h. En **mono**, hay que separar las voces con [[diarizacion|diarización]] (pyannote): ≈ 6.9 h más de H100 cada noche.

:::profundo Las tres formas en que puede llegar el audio
- **Estéreo con VAD:** no hace falta saber quién habla: el canal 1 es el agente.
- **Estéreo sin VAD:** se transcribirían dos llamadas completas, cada una con la mitad de silencio: **1,600 h**. faster-whisper activa el VAD por omisión en la transcripción por lotes; hay que verificar que siga así en la configuración.
- **Mono:** una sola mezcla. pyannote (4.1.1, MIT; su modelo `community-1` es CC-BY-4.0: libre, también para uso comercial, con atribución) mide en su README ≈ 31 s por hora de audio en una H100: 800 × 31 ÷ 3,600 ≈ **6.9 h de H100** cada noche, del mismo orden que transcribir, y se equivoca en 17 % a 27 % del tiempo de voz en sus pruebas (su DER, el error de diarización). En una L40S no hay medición.
:::

### El LLM: el mismo modelo de la clínica, otra promesa

El LLM es **Qwen3.8 27B en FP8**, sin razonamiento, el modelo base de la [clínica](/casos/clinica/) (Apache 2.0; 30.32 GB de pesos, 64 KiB de KV por token y ≈ 154 MB de estado fijo por conversación: la memoria de sus 48 bloques lineales, que no crece con el largo). Aquí la velocidad por conversación no importa: una llamada puede tardar 20 segundos si salen 32 a la vez.

¿Cuántas a la vez? La [herramienta de VRAM con 32 llamadas de 2,354 tokens en una L40S](/herramientas/vram/?V=l40s&P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=2354&u=32) pide 37.26 GB de 43.2 útiles y deja **5.94 GB** libres. El estado fijo de los bloques lineales de Qwen3.8, que la herramienta no cuenta, ocupa 32 × 0.154 ≈ 4.93 GB: cabe. Con 36 ya no. Por eso el lote es de **32**, no de los 70 que la herramienta diría sin el estado.

:::profundo La cuenta del LLM, con su fórmula
:::formula Horas de GPU del LLM en una noche
g_{LLM} = frac{n × (N_e ÷ v_{pre} + N_s ÷ v_{dec})}{3,600}
- n: llamadas de la noche (8,000)
- N_e, N_s: tokens de entrada y de salida por llamada (2,004 y 350)
- v_{pre}: velocidad del prefill de una GPU, en tokens por segundo (6,550 en una L40S)
- v_{dec}: tokens por segundo de todas las conversaciones en el decode (555 con 32)
- g_{LLM}: las horas de una GPU que pide el LLM
:::

:::cuenta Las horas del LLM en una L40S
Prefill // \(n\) × \(N_e\) ÷ \(v_{pre}\) | 16.03 × 10⁶ ÷ 6,550 | 2,448 s = 0.68 h
Decode // \(n\) × \(N_s\) ÷ \(v_{dec}\) | 2.80 × 10⁶ ÷ 555 | 5,045 s = 1.40 h
\(g_{LLM}\) | 0.68 + 1.40 | **2.08 h**
Por llamada, \(s_L\) | 2.08 × 3,600 ÷ 8,000 | 0.937 s
= Sumar el prefill y el decode es conservador: el servidor los traslapa. Y no cuenta la lectura del estado fijo en cada paso: con ella, el decode baja a ≈ 490 tokens por segundo y el LLM sube ≈ 0.2 h.
:::
:::

:::profundo Lo que se ahorraría con prefix caching (casi nada)
Las 600 instrucciones son iguales en las 8,000 llamadas: el [[prefix-caching|prefix caching]] ([Batching](/batching/)) se podría ahorrar leerlas. Son ≈ 30 % del prefill: 8,000 × 600 ÷ 6,550 ≈ 0.20 h. El LLM bajaría de 2.08 a ≈ 1.88 h, y la noche de 4 GPUs, de 2.87 a 2.82 h. Con los bloques lineales de Qwen3.8, además, es experimental en vLLM (lo dijo la clínica). Optimizar la parte barata casi no mueve la noche: el esfuerzo va a la voz.
:::

### ¿Cabe en la ventana?

La [herramienta de sizing](/herramientas/sizing/) no sirve aquí: dimensiona por velocidad por conversación y pico de llegadas. Lo que hay es trabajo que cabe o no en unas horas. Si las \(G\) GPUs se reparten todo (primero transcriben, después resumen):

:::formula La noche de un lote con dos modelos
T = frac{H × k ÷ R + g_{diar} + g_{LLM}}{G}
- H: horas de audio del día (800)
- k: 1 si cada hora se transcribe una vez (estéreo con VAD, o mono); 2 si cada canal va completo
- R: el RTFx de una GPU
- g_{diar}: horas de GPU de diarización (0 en estéreo)
- g_{LLM}: horas de GPU del LLM (2.08)
- G: GPUs que se reparten la noche
- T: horas de reloj que tarda la noche; el día pico, f × T
:::

:::calculadora caso-financiera-ventana
Arranca con la financiera y 4 L40S a la cota baja. Prueba «estéreo sin VAD», baja \(G\) a 3 y a 2, y pon \(R\) = 232.
:::

Con 4 L40S a 85×: **2.87 h** un día normal y **5.75 h** el día pico, contra 6.8 útiles. Caben hasta ≈ 18,900 llamadas. Y el RTFx mínimo para que quepa el pico baja a **≈ 70× por tarjeta**: la cota baja ya lo pasa.

## La propuesta de hardware {The hardware proposal}

:::intenta ¿Qué servidor cierra el día pico?
Con la calculadora de arriba y la cota baja de cada GPU (85× la L40S, 157× la RTX PRO 6000 Server Edition, y con los segundos de GPU que pide el LLM por llamada, \(s_L\) = 0.937 y 0.417, que dan \(g_{LLM} = n × s_L ÷ 3,600\); el de la Server Edition sale de la [herramienta de velocidad con 64 llamadas a la vez](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=2004&No=350&b=64)), cuatro opciones: **A)** 2 L40S (US$58,281.30), **B)** 4 L40S (US$76,101.30), **C)** 1 Server Edition (≈ US$57,620), **D)** 2 Server Edition (≈ US$74,779). ¿Cuáles cierran el día pico en 6.8 h? ¿Y cuál aguanta mejor que falle una tarjeta?
???
1. **A)** 5.75 h normal; el pico, **11.49 h**: no.
2. **B)** 2.87 y **5.75 h**: sí.
3. **C)** 6.02 h normal, en el filo; el pico, **12.04 h**: no.
4. **D)** 3.01 y **6.02 h**: sí, con menos margen.
5. Si falla una: B queda con 3 L40S (3.83 h normal, 7.66 h el pico: termina a las 5:40, sin margen pero antes de las 7:00); D queda con una Server Edition, como C (12.04 h el pico: el tablero no llega).
:::

En un lote, **una falla no apaga nada: lo atrasa**. La pregunta del N+1 cambia de «¿sigue arriba?» a «¿todavía cabe?».

:::figura caso-financiera-noche
La noche con la cota baja. Repartir el trabajo entre las 4 tarjetas es lo que hace caber el día pico; partir el servidor fijo en 2 para la voz y 2 para el LLM lo rompe.
:::

### Las opciones, lado a lado

| | A) 2 L40S | B) 4 L40S | C) 1 Server Edition | D) 2 Server Edition |
|---|---|---|---|---|
| Noche normal / pico (cota baja) | 5.75 / 11.49 h | **2.87 / 5.75 h** | 6.02 / 12.04 h | 3.01 / 6.02 h |
| ¿Cierra el pico en 6.8 h? | no | **sí** | no | sí |
| Si falla una tarjeta (pico) | 22.98 h | 7.66 h | — (no queda nada) | 12.04 h |
| Con la cota alta, el pico | 5.53 h | 2.76 h | 6.85 h | 3.42 h |
| Compra (US$) | 58,281.30 | 76,101.30 | ≈ 57,620 | ≈ 74,779 |
| Al mes, herramienta de TCO (US$) | 2,691 | 3,121 | 2,672 | 3,082 |

Precios: Exxact, base de US$40,461.30 + US$8,910 por L40S (2026-11-25, `equipos.json`); la Server Edition, sin precio de lista, a los US$17,159 de CDW (26-nov-2026, «backordered»: sin existencias, con entrega pendiente), como en la clínica.

### La decisión

**B) el Exxact TensorEX 4U con 4 L40S**, las cuatro repartiéndose la noche: primero las cuatro transcriben, después las cuatro resumen. En orden de peso:

1. **Cierra el pico con la cota baja**, sin depender de una medición que nadie ha hecho.
2. **Una falla le quita 25 %, no 50 %:** con 3 L40S el pico termina antes de las 7:00; con una Server Edition, no.
3. **La ventaja de la Server Edition es para el LLM**, la parte barata. En voz, 2 × 157× es casi lo mismo que 4 × 85×.
4. **Se consigue hoy**, y cuesta US$39 al mes más que D.

La opción A es la trampa: con la cota alta, 2 tarjetas cierran el pico (5.53 h), pero es comprar con un número que no existe todavía, y una falla deja el pico en 23 h.

:::profundo Plan B y lo que haría cambiar la decisión
**Si el piloto mide la L40S abajo de 70×** (peor que la cota baja), B ya no cierra el pico: el RTFx mínimo con 4 tarjetas es 69.5. Las salidas, en orden: (1) **empezar antes**: la central exporta cada hora desde el mediodía y el lote corre por tandas durante el día, en la misma máquina (la ventana de 22:00 es el peor caso, no una ley); (2) **dejar para la noche siguiente** lo que no tiene queja ni bandera según una primera pasada rápida; (3) probar **Parakeet-TDT-0.6B-v3** (NVIDIA, CC-BY-4.0, libre con atribución), que publica 1,720× en la misma A100 con un WER en español parecido al de Whisper large-v3 (3.73 % contra 3.65 %, en audio leído), si su WER en teléfono sale aceptable.

**Si el piloto mide arriba de 170×**, 2 L40S cerrarían el pico (el mínimo con 2 es 169.6): el chasis de 4 ranuras se compra con 2 y crece. Pero con 2, una falla vuelve a romper el pico.

**Si la central graba en mono**, la diarización entra: con un supuesto de 62 s por hora en una L40S (el doble de la H100, sin medición), la noche normal tarda 6.32 h y el pico 12.6 h. Habría que pedir a la central la grabación en dos canales antes que comprar más GPU.
:::

:::nota Dónde va el servidor
En el centro de datos de la financiera en Monterrey (con UPS, planta y aire, supuesto), en la red interna sin salida a internet. Pico de ≈ 2,500 W (`equipos.json`); en promedio, ≈ 870 W: las tarjetas trabajan a fondo ≈ 3 h por noche.
:::

## El stack {The stack}

:::intenta ¿Dónde se redacta el número de tarjeta?
Una llamada vive en tres lugares: el **audio** en el grabador (180 días, y el cliente puede escucharlo), la **transcripción** que escribe faster-whisper (que se le puede dar al cliente) y el **JSON** que escribe el LLM (que ven los supervisores). PCI DSS: el código de seguridad no se guarda; el número de tarjeta, solo enmascarado. ¿Qué se hace en cada uno? ¿En qué momento exacto se redacta la transcripción?
???
1. **Audio:** la defensa es que no se grabe: la central pausa la grabación mientras el cliente dicta. Si falla, la FAQ 1210 pide borrarlo o controles compensatorios.
2. **Transcripción:** el número largo se cambia por `[PAN ****1111]` y el código por `[CVV]` **en memoria, antes de escribir el texto a disco**. Lo que se escribió una vez puede quedar en un registro, un respaldo o una caché.
3. **JSON:** el LLM lee la transcripción ya redactada: no puede repetir un número que no vio. El validador revisa que no haya corridas de dígitos.
4. En ninguno de los tres se guarda el código.
:::

**Cada almacén tiene su regla**, escrita por almacén y no «para el sistema».

:::figura caso-financiera-almacenes
Los tres almacenes de una llamada, con lo que pasa en cada uno con la tarjeta y cuánto se guarda.
:::

### La noche, paso a paso

:::diagrama caso-financiera-lote
Toca cada caja para ver qué hace. «Una llamada» sigue a un cliente de Saltillo de la grabación al tablero; «La noche en que llega el doble», al servidor en una quincena.
:::

### El redactor, con reglas y sin modelo

La [[redaccion-de-datos|redacción]] la hace un programa de reglas, predecible y examinable. Atrapa el número **en cifras y en palabras** («cuatro uno uno uno…»). Y tiene una trampa: la prueba de [[luhn|Luhn]] (el último dígito de una tarjeta revisa a los demás) parece la forma elegante de reconocer una tarjeta, pero si Whisper se equivocó en un dígito, el número ya no la pasa y se queda en el texto. **La regla segura: tachar toda corrida de 13 o más dígitos, con o sin Luhn**, y medir lo que tacha de más.

:::profundo El redactor en Python
```python
import re
PAL = {"cero": "0", "uno": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5",
       "seis": "6", "siete": "7", "ocho": "8", "nueve": "9"}
DIG = r"(?:\d|\b(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b)"
CORRIDA = re.compile(rf"{DIG}(?:[\s,.-]*{DIG})+", re.I)
CVV = re.compile(r"(c[oó]digo de (?:seguridad|atr[aá]s)|cvv)(\D{0,12})(\d{3,4})", re.I)

def luhn(d):
    s = sum(int(c) if i % 2 == 0 else sum(divmod(2 * int(c), 10)) for i, c in enumerate(reversed(d)))
    return s % 10 == 0

def redactar(texto, pedir_luhn=False):
    texto = CVV.sub(lambda m: m.group(1) + m.group(2) + "[CVV]", texto)
    def cambio(m):
        d = "".join(PAL.get(t.lower(), t) for t in re.findall(DIG, m.group(0), re.I))
        if len(d) >= 13 and (luhn(d) or not pedir_luhn):
            return f"[PAN ****{d[-4:]}]"
        return m.group(0)
    return CORRIDA.sub(cambio, texto)

for t in ["Es la 4111 1111 1111 1111, y el código de seguridad es 123.",
          "cuatro uno uno uno uno uno uno uno uno uno uno uno uno uno uno uno",
          "Son 4111 1111 1111 1112.", "Mi folio es 2026 1126 0042.", "Alguno dos veces me llamó."]:
    print(redactar(t, pedir_luhn=True), "|", redactar(t))
```

```salida
Es la [PAN ****1111], y el código de seguridad es [CVV]. | Es la [PAN ****1111], y el código de seguridad es [CVV].
[PAN ****1111] | [PAN ****1111]
Son 4111 1111 1111 1112. | Son [PAN ****1112].
Mi folio es 2026 1126 0042. | Mi folio es 2026 1126 0042.
Alguno dos veces me llamó. | Alguno dos veces me llamó.
```

A la izquierda, el filtro que pide Luhn; a la derecha, el que no. La tercera línea es el hallazgo: «4111 1111 1111 1112» es casi la tarjeta de prueba con un dígito mal oído, y el filtro con Luhn la deja pasar. El folio de 12 dígitos no se toca; uno de 13 sí se tacharía, y por eso se mide cuántos folios caen. Los números son **de prueba**, nunca de un cliente. El 13 supone tarjetas de 15 o 16 dígitos; la norma permite de 8 a 19 (algunas Maestro traen 12): si en las llamadas aparecen más cortas, el umbral baja y se tachan más folios.
:::

### El LLM: un lote offline con salida estructurada

vLLM 0.34.0 (release del 16-nov-2026) tiene dos formas de correr un lote: `vllm run-batch` con un archivo de peticiones (que acepta hasta `/v1/audio/transcriptions`, así que Whisper también podría ir por ahí: el piloto compara) y la ruta **offline** en Python, `LLM.generate`. El caso usa la offline, porque es la documentada para la [[salida-estructurada|salida estructurada]]: `StructuredOutputsParams` dentro de los parámetros de muestreo, con xgrammar (la biblioteca que, token por token, solo deja escribir lo que cumple el esquema). Que `structured_outputs` en una línea de `run-batch` se acepte tal cual no se probó.

**El enum es el punto.** Si la causa es una lista cerrada en el esquema, el modelo **no puede inventar** una causa: el error posible pasa de «etiqueta inventada» a «etiqueta equivocada», y eso se mide con la matriz de confusión.

:::profundo El esquema, campo por campo
```json
{
  "type": "object",
  "required": ["resumen", "motivo", "queja", "causa", "promesa_pago", "banderas"],
  "properties": {
    "resumen": { "type": "string", "maxLength": 900 },
    "motivo": { "enum": ["aclaracion", "saldo_pago", "cobranza", "cancelacion", "producto", "fraude_bloqueo", "otro"] },
    "queja": { "type": "boolean" },
    "causa": { "enum": ["sin_queja", "consumo_no_reconocido", "consumo_internet_no_reconocido",
                        "cargo_cuenta_no_reconocido", "transferencia_no_reconocida", "cobranza_amenaza",
                        "cobranza_a_terceros", "historial_no_actualizado", "cancelacion_no_atendida",
                        "bloqueo_sin_aviso", "otra"] },
    "promesa_pago": { "type": "object", "required": ["hay"],
                      "properties": { "hay": { "type": "boolean" }, "monto": { "type": "number" },
                                      "fecha": { "type": "string" } } },
    "banderas": { "type": "array", "items": { "enum": ["amenaza", "menciona_condusef", "posible_fraude"] } }
  }
}
```

En producción, el enum de `causa` se genera del catálogo que la financiera descarga del REUNE: el esquema y el reporte usan la misma lista. Los campos viejos `guided_json` y `guided_choice` se quitaron en vLLM 0.12.0, y el backend `lm-format-enforcer` está deprecado desde 0.33.0 y sale en 0.35.0: lo que se copie de un tutorial viejo no corre.
:::

### Tandas, validador y lo que no pasa por el modelo

El lote va en **tandas** que se reintentan solas, un **validador** sin modelo revisa cada JSON, y lo que dicen los metadatos de la central no se le pregunta al LLM.

:::profundo Las tres reglas, una por una
- **Tandas de 500.** La documentación de `run-batch` avisa que el archivo de salida se trunca al empezar y que una corrida que falla a medias deja solo las primeras líneas. La misma lógica vale para la ruta offline: 16 tandas, cada una con su salida y su código revisado; si falla la 7, se reintenta la 7.
- **Un validador sin modelo**, como el de la clínica: el JSON cumple el esquema; un monto prometido aparece tal cual en la transcripción; no hay corridas de dígitos. Lo que no pasa va a «revisar a mano», no al tablero.
- **Lo que no necesita al LLM:** la hora de una llamada de cobranza (fuera de 7:00–22:00), su duración y cuántas veces se llamó al mismo cliente salen de los metadatos de la central, con una regla. Un modelo que adivina la hora a partir del saludo es un error de diseño.
:::

### Seguridad, registros y observabilidad

La receta de [Seguridad](/seguridad/) casi no cambia: una [[vlan|VLAN]] sin salida a internet, la [[maquina-puente|máquina puente]] y [[cifrado-en-reposo|cifrado en reposo]]. Lo propio del banco: **los registros no guardan texto** y la observabilidad vigila el **avance** del lote, no un p95.

:::profundo Lo que cambia en un banco
- **Los registros no guardan texto.** vLLM sin `--enable-log-requests` (apagado por omisión); el programa del lote no escribe transcripciones a sus logs, y el piloto revisa qué escribe cada pieza; el registro del lote guarda el folio de la llamada, la tanda, los tiempos y las marcas del validador. Una transcripción en un log de errores es un PAN fuera de su almacén.
- **pyannote** (si se usara) tiene telemetría opcional: se apaga. Su modelo `community-1` es [[modelo-gated|gated]]: se acepta su licencia y se baja con un token una vez, por la máquina puente; después corre sin internet.
- **El acceso al tablero** es por rol: los supervisores ven resúmenes y causas; las transcripciones las abre la UNE y Calidad; nadie ve audio desde el tablero.
- **Observabilidad de un lote** ([Observabilidad](/observabilidad/)): no hay p95 que vigilar. Se vigila el **avance**: llamadas que entraron, transcritas, clasificadas y enviadas a revisión. La alerta es «a las 4:30 falta más de la mitad». Y cada semana, una **auditoría del redactor**: se buscan dígitos sueltos en una muestra de transcripciones.
:::

## Evals {Evals}

:::intenta ¿Cuánto coinciden dos supervisoras?
Antes de examinar al modelo hay que saber cuánto coinciden las personas. Dos supervisoras etiquetan las mismas 400 llamadas en «queja sí o no»: las dos dicen sí en 40 y no en 344; la primera dice sí y la segunda no en 9; al revés, en 7. Con el [[kappa-de-cohen|κ de Cohen]] de la lección [Evals](/evals/), \(κ = (p_o − p_e) ÷ (1 − p_e)\), ¿cuánto acuerdo hay más allá del azar?
???
1. Coinciden en 40 + 344 = 384 de 400: \(p_o\) = **0.96**.
2. La primera dice sí en 49 de 400 (0.1225); la segunda, en 47 (0.1175).
3. Por azar: \(p_e\) = 0.1225 × 0.1175 + 0.8775 × 0.8825 ≈ **0.789**.
4. \(κ\) = (0.96 − 0.789) ÷ (1 − 0.789) ≈ **0.81**. Bueno, pero no perfecto: en 16 de 400 llamadas, dos personas con experiencia no se ponen de acuerdo en si hubo queja.
:::

Ese 0.81 es el techo honesto: un modelo no puede coincidir con «la verdad» más de lo que coinciden quienes la escriben. Las 16 en desacuerdo se discuten y se vuelven la **guía de etiquetado**, que vale más que cualquier prompt.

### Tres exámenes, uno por modelo y uno del conjunto

**1. La voz a texto: el WER, medido en casa.** No hay un [[wer|WER]] publicado de ningún modelo en llamadas de banco en español de México a 8 kHz (la calidad de una línea telefónica, la mitad de los 16 kHz con que trabaja Whisper). Se mide en **40 llamadas (≈ 4 h)** transcritas a mano por dos personas, por región, y **aparte en los números**: un «15» por un «50» en una promesa de pago pesa más que diez muletillas.

:::profundo Cómo se mide el WER y por qué hay un piso
:::formula La tasa de error de palabras
WER = frac{S + D + I}{N}
- S: palabras cambiadas por otra
- D: palabras que faltan
- I: palabras de más
- N: palabras de la transcripción de referencia (la de una persona)
:::

Las 40 llamadas se estratifican por región (noreste, centro, sur) y por tipo (servicio, cobranza). El WER entre las dos personas es el **piso**: nadie transcribe una llamada con ruido sin diferencias, y un modelo no se puede exigir mejor que eso. Lo que se reporta: el WER global, el de cada región, y la tasa de error en montos, fechas y folios.
:::

**2. El clasificador.** Las 2,000 llamadas etiquetadas de la lección «Evals», [[estratificar|estratificadas]] con **600 quejas** (diez veces su 3 % real), con la matriz de confusión y el recall por clase de Sensei [«¿Aprendió de verdad?»](https://sensei.trueml.app/aprendio/). Manda el **recall de «queja sí»**: una queja de más le cuesta un minuto a la supervisora; una perdida es un plazo de 30 días hábiles que corre sin que nadie lo vea.

:::profundo El criterio de las quejas, con su cota
Si en las 600 quejas el modelo pierde \(k\), ¿qué tasa real de pérdida se puede descartar con 95 % de confianza? Con la cota exacta de una cola (binomial, la generalización de la fórmula de la clínica para cero fallas): la tasa más alta con la que todavía sería razonable (5 % de probabilidad o más) ver tan pocas pérdidas.

| Quejas perdidas en 600 | Tasa real, a lo más (95 %) |
|---|---|
| 0 | 0.50 % |
| 2 | 1.05 % |
| 5 | 1.74 % |
| 6 | **1.96 %** |
| 7 | 2.18 % |

El criterio «≤ 2 % de quejas perdidas» se demuestra con **a lo más 6** pérdidas en 600. Para empujar el recall hay una palanca de diseño: si el modelo dice «no» pero la transcripción trae «CONDUSEF», «reclamar» o «no reconozco», la llamada se marca **para revisar**. Es una red de palabras, barata y examinable, que cambia falsos negativos por falsos positivos, que son los baratos.
:::

**3. La redacción.** 1,000 llamadas grabadas por el equipo en las que se dictan **tarjetas de prueba** (nunca reales) de todas las formas. Criterio: **0** sin redactar, que demuestra ≤ 0.30 % (1 − 0.05^(1/1,000)).

### El criterio, firmado antes de ver resultados

| Qué | Criterio |
|---|---|
| Quejas perdidas | ≤ 6 en 600 (≤ 2 % demostrado) |
| Causa de la queja | Exactitud por clase reportada; ninguna clase con recall < 80 % sin plan (supuesto a ratificar con la UNE) |
| WER en números | ≤ 2 % de montos, fechas y folios mal (supuesto a ratificar) |
| WER por región | Ninguna región con más del doble del WER de la mejor |
| Tarjetas sin redactar | 0 en 1,000 |
| El lote | El día pico simulado (16,000 llamadas) termina en ≤ 6.8 h con las 4 tarjetas, y antes de las 7:00 con 3 |

La última fila es el N+1 de un lote: se prueba **apagando una tarjeta** y corriendo el doble.

:::profundo El retador y el piloto
El retador, **Qwen3.5 9B** (Apache 2.0), se queda si empata en las quejas con una [[prueba-pareada|prueba pareada]]: es más barato y libera GPU para la voz.

**El piloto, 8 semanas.** Semana 1: la velocidad de la voz en la L40S (sin datos de clientes). Semanas 2–4: WER y clasificador con llamadas reales, adentro. Semanas 5–8: el tablero con 6 supervisores, y empieza una **auditoría de 100 llamadas al mes** escuchadas por Calidad contra su JSON: la única forma de ver en producción las quejas que el modelo no ve.
:::

## Riesgos {Risks}

:::intenta ¿Qué puede salir mal en una noche de quincena?
Llega el doble, 1,600 h de audio. El servidor tiene 4 L40S, nadie de TI despierto y el tablero tiene que estar a las 7:00. Haz tu lista: al menos cuatro cosas que pueden salir mal, y qué reduce cada una.
???
1. **La voz salió más lenta que la cota baja:** medir el RTFx antes de comprar; alerta a las 4:30; lo que no trae queja, a la noche siguiente.
2. **Falla una tarjeta:** con 3, el pico termina a las 5:40.
3. **Una tanda falla a medias:** se reintenta esa tanda, no la noche.
4. **Se coló una tarjeta:** el redactor la tacha antes del disco; la auditoría semanal busca dígitos.
5. **El supervisor le cree todo al tablero:** la auditoría de 100 llamadas al mes mide lo que el modelo no ve.
:::

:::profundo La tabla de riesgos completa
| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| El día pico no cabe | El tablero llega tarde; las quejas se ven a mediodía | Dimensionar con la cota baja y el doble; medir el RTFx en la semana 1; procesar por tandas desde el mediodía; alerta a las 4:30 | TI |
| Un PAN o un CVV se cuela a un registro | Un dato de tarjeta fuera de su almacén; alcance de PCI | Pausa en la central; redactor antes del disco, sin Luhn; logs sin texto; auditoría semanal; examen de 1,000 | Seguridad de la información |
| Una queja no detectada | Un plazo de 30 días corre sin respuesta; la reclamación llega a la CONDUSEF | Recall de «queja» como métrica principal; red de palabras; auditoría de 100 al mes; la UNE sigue recibiendo por sus canales | UNE |
| Sesgo por acento o región | La voz falla más con el sur o con el campo; el clasificador hereda el error | WER por región en el examen; criterio de no más del doble; muestra mensual por región | Cumplimiento |
| Se usa para evaluar agentes sin decírselo | Oposición del empleado (LFPDPPP art. 26 fr. II); conflicto laboral | Fuera del alcance por escrito; si se quiere, es otra finalidad, con aviso al personal, revisión humana y el abogado laboral | Recursos Humanos y jurídico |
| La transcripción que se entrega al cliente está mal | Un documento del banco que no dice lo que se dijo | La UNE la revisa contra el audio antes de entregarla | UNE |
| Whisper alucina en un silencio | Una frase que nadie dijo, a veces una promesa | VAD; el validador pide que el monto aparezca en la transcripción; la auditoría | Datos |
| El modelo se usa para algo que no se examinó | «Ya que clasifica, que detecte lavado» | Cada uso nuevo pasa por Cumplimiento antes que por el examen | Oficial de Cumplimiento |
:::

:::ojo El riesgo que no sale en la tabla
El más probable: que el tablero funcione y se vuelva **el ranking de los agentes**. «¿Quién tiene más quejas?» llegará en el mes dos, y con ella el sistema evalúa a personas que no fueron avisadas. Se escribe hoy, en el alcance, que el tablero no ordena agentes.
:::

## Costo {Cost}

:::intenta ¿Cuánto cuesta cada llamada, aquí y por API?
De la ficha: el servidor B cuesta **US$76,101.30** y se deprecia en 36 meses con 20 % de reventa; al mes se suman la luz (≈ **US$139.7**), la obra (**US$90**) y la operación (**US$1,200**). Son **240,000** llamadas al mes; tipo de cambio **19.7203**. Por API: la transcripción a **US$0.006 por minuto** y un LLM a **US$0.10 / 0.50** por millón de tokens de entrada / salida (Claude Haiku 5.5). ¿Cuánto cuesta cada llamada en los dos lados?
???
1. Depreciación: 76,101.30 × 0.8 ÷ 36 ≈ **US$1,691.1**.
2. Propio: 1,691.1 + 139.7 + 90 + 1,200 ≈ **US$3,121** al mes ≈ MXN 61,544; por llamada, 61,544 ÷ 240,000 ≈ **MXN 0.26**. La [herramienta de TCO con los números de la financiera](/herramientas/tco/?p1=l40s&p0=anthropic-haiku-5-5&U=8000&r=1&Np=2004&No=350&D=30&G=4&K=8910&S=40461.3&gs=4&V=36&res=0.2&Wg=350&Wb=450&u=0.3&pue=2&kwh=0.11&oe=90&op=1200&tc=19.7203&hr=730) da lo mismo.
3. API, transcripción: 240,000 × 6 = 1,440,000 minutos × 0.006 = **US$8,640**.
4. API, LLM: 240,000 × (2,004 × 0.10 + 350 × 0.50) ÷ 10⁶ ≈ **US$90**.
5. API: ≈ US$8,730 al mes; por llamada, ≈ **MXN 0.72**. El propio cuesta ≈ 36 % de eso.
:::

La herramienta de TCO cobra la API **por tokens** y dice que es más barata (≈ US$90 contra ≈ US$3,121): es verdad del LLM, pero **la transcripción es el 99 % de la API**.

:::profundo Las piezas del costo propio, una por una
:::cuenta Las piezas del costo propio
Depreciación // \(K\) = 76,101.30; reventa 20 %; 36 meses | 76,101.30 × 0.8 ÷ 36 | US$1,691.1
Luz // (4 × 350 W × 0.3 + 450 W) × PUE 2.0 × 730 h ≈ 1,270 kWh a ≈ US$0.11 | 870 W promedio | US$139.7
Obra // la de la clínica (supuesto) | repartida | US$90
Operación // 3 de TI y 1 de datos, el tiempo que le dedican (supuesto) | sin guardia en espera | US$1,200
Total, \(P\) | 1,691.1 + 139.7 + 90 + 1,200 | **US$3,121 ≈ MXN 61,544**
= En 36 meses, ≈ US$112,351. Por llamada, ≈ MXN 0.26. Sin guardia en espera, a diferencia de la clínica: un lote atrasado no despierta a nadie.
:::
:::

:::profundo La calculadora de la API por minuto
:::calculadora caso-financiera-api
Arranca con la transcripción de US$0.006 por minuto y Claude Haiku 5.5, uno de los LLM baratos de la lista. Prueba gpt-4o-mini-transcribe con Claude Sonnet 5.5, y baja las llamadas a 2,000.
:::

Con 2,000 llamadas al día, la API sale **más barata** en dinero (MXN 0.72 contra MXN 1.03 por llamada). El empate está en ≈ **85,800 llamadas al mes** (≈ 2,860 al día). Arriba, el propio gana; abajo, gana la API, y la razón para no usarla ya no es el dinero: es el trámite de terceros (con la autorización de la CNBV si el proveedor está fuera de México), el secreto que se le extiende al proveedor y PCI. Eso se dice así, sin disfrazarlo de ahorro.
:::

### Lo que la cuenta no trae

La nube por horas sería **la más barata** (≈ US$2,144 al mes) y es la que la regulación hace más cara de tramitar.

:::profundo La nube por horas, el trámite y lo que falta
**La nube por horas.** Un lote que trabaja ≈ 3 horas por noche es el caso ideal para rentar: 4 L40S en AWS (g6e.12xlarge, US$2.6232 por GPU y hora, `gpus.json`) durante 90 horas al mes, más la operación, son **≈ US$2,144** al mes con la [herramienta de TCO con 90 horas rentadas](/herramientas/tco/?p1=l40s&p0=anthropic-haiku-5-5&U=8000&r=1&Np=2004&No=350&D=30&G=4&K=8910&S=40461.3&gs=4&V=36&res=0.2&Wg=350&Wb=450&u=0.3&pue=2&kwh=0.11&oe=90&op=1200&tc=19.7203&hr=90&c=2.6232): menos que el propio. Y es justo lo que la regulación hace caro: es un tercero que recibe audio con secreto bancario (art. 318 completo), y si la grabación lleva tarjetas, entra al alcance de PCI. Y no se puede rentar en México: la región de AWS en México (mx-central-1) no tiene ninguna instancia con GPU en su lista de precios (consultada el 27-nov-2026). Rentar en EE. UU. es procesar fuera del país: pide la autorización del art. 328.

**El trámite tiene precio.** El informe con la ubicación de los servidores, la aprobación del Consejo, el aviso o la autorización de la CNBV, las cláusulas de visita de la CNBV, la eliminación segura y la evaluación de PCI del proveedor no están en ninguna calculadora. El caso no le pone número; dice que existe y que se paga en meses.

**No incluye** impuestos, flete ni importación (≈ 7 % más si se importa, lección [Cotizar](/cotizar/)), las horas de las supervisoras que etiquetan el examen, las 40 llamadas transcritas a mano ni el piloto.
:::

## La propuesta en una página {The proposal on one page} [extra]

**Lo que hace.** Cada noche, las llamadas del día se transcriben, se les tachan los datos de tarjeta, se resumen y se clasifican: motivo, queja y su causa del catálogo del REUNE, promesa de pago y banderas. A las 7:00, un tablero con las quejas primero. **No** responde quejas, no las reporta, no califica agentes ni escucha en vivo: el modelo propone y una persona confirma.

**Dónde corre.** Un servidor 4U con **4 L40S** en el centro de datos de la financiera, sin salida a internet: **Whisper large-v3-turbo** (MIT) con faster-whisper y **Qwen3.8 27B** (Apache 2.0) en FP8 con vLLM 0.34.0 y salida estructurada. Las cuatro tarjetas transcriben y después resumen.

**Qué promete.** Un día normal en ≈ 2.87 h y el día pico (el doble) en ≈ 5.75 h, contra 6.8 h útiles de una ventana de 22:00 a 06:00, con la cota baja de velocidad. Si falla una tarjeta, el pico termina antes de las 7:00.

**Cómo se cuidan los datos.** Ninguna grabación sale del banco, así que no hay tercero ni trámite del art. 318. La central pausa la grabación al dictar la tarjeta; el redactor tacha lo que se cuele antes de escribir; el CVV no se guarda en ningún almacén. El aviso de privacidad nombra el análisis con IA.

**Cómo se demuestra.** El RTFx medido en la semana 1, antes de comprar. WER en 40 llamadas por región. Clasificador en 2,000 llamadas con 600 quejas: ≤ 6 perdidas. Cero tarjetas en 1,000 llamadas de prueba. El día pico simulado con una tarjeta apagada.

**Cuánto cuesta.** US$76,101.30 de servidor (sin impuestos ni importación) y ≈ **MXN 61,544 al mes**: ≈ **MXN 0.26 por llamada**, contra ≈ MXN 0.72 por API.

**Lo que se confirma antes de comprar.** Con la central: grabación en estéreo, la hora de exportación y la pausa al dictar la tarjeta. Con Cumplimiento: los plazos de conservación de cada almacén y el aviso. El RTFx en una L40S.

## Errores comunes {Common mistakes}

1. **Dimensionar por el LLM**, que gasta ≈ 18 % de la noche. **Cómo evitarlo:** cuenta las horas de GPU de cada pieza de la cadena.
2. **Usar un RTFx publicado como si fuera tuyo.** **Cómo evitarlo:** dimensiona con la cota baja de una banda y mide antes de comprar, con audio que no sea de clientes.
3. **Partir el servidor fijo («2 para la voz, 2 para el LLM»).** La voz no cabe el día pico y las del LLM esperan. **Cómo evitarlo:** que todas hagan una etapa y después la otra.
4. **Redactar solo lo que pasa la prueba de Luhn.** Un dígito mal oído deja la tarjeta en el texto. **Cómo evitarlo:** tacha toda corrida de 13 o más dígitos y mide los falsos positivos.
5. **Creer que redactar el texto limpia el audio.** **Cómo evitarlo:** la primera defensa es la pausa en la central; cada almacén tiene su regla.
6. **Decir «la ley prohíbe la nube».** Pide un trámite (y, fuera de México, una autorización), no la prohíbe. **Cómo evitarlo:** cita el artículo y di qué pide.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un día, la financiera recibe 9,000 llamadas de 5 minutos. ¿Cuántas horas de audio son? Con una sola GPU y 6.8 h útiles, ¿qué RTFx necesitaría?
9,000 × 5 ÷ 60 = **750 h**. RTFx: 750 ÷ 6.8 ≈ **110×**. Cuentan los minutos, no las llamadas.
? [facil] La central graba en estéreo a 64 kbit/s por canal. ¿Cuánto disco ocupan las 800 h de un día? ¿Y los 180 días que pide la CNBV?
128 kbit/s × 3,600 s ÷ 8 = **57.6 MB por hora** × 800 = **46.08 GB al día**; en 180 días, ≈ **8.29 TB**, en el grabador que ya existe.
? [facil] La transcripción de referencia de una llamada tiene 780 palabras. El modelo cambió 40, dejó fuera 12 y agregó 6. ¿Cuál es su WER?
(40 + 12 + 6) ÷ 780 = 58 ÷ 780 ≈ **7.4 %**. Falta lo importante: cuántas de esas 58 eran números.
? [medio] La noche de quincena falla una L40S a las 22:05. ¿A qué hora termina el lote? ¿Qué harías si además la voz salió a 75× en vez de 85×?
Con \(G\) = 3, la calculadora de la ventana da **7.66 h**: termina ≈ 5:40. Con 75×: (1,600 ÷ 75 + 2 × 2.08) ÷ 3 ≈ **8.5 h**: termina ≈ 6:30. Salidas: dejar para la noche siguiente lo que no trae queja, o empezar por tandas desde la tarde.
? [medio] La central resulta mono. Supón que pyannote tarda en una L40S el doble que en la H100: 62 s por hora de audio. ¿Cuánto tarda la noche normal con 4 L40S? ¿Y el pico?
Diarización: 800 × 62 ÷ 3,600 ≈ **13.8 h de GPU**. Noche: (9.41 + 13.8 + 2.08) ÷ 4 ≈ **6.32 h**; el pico, **12.6 h**: no cabe ni con 4. La calculadora con \(dz\) = 62 lo confirma. Antes de comprar más GPU, se le pide a la central la grabación en dos canales.
? [medio] El modelo pierde 5 de las 600 quejas del examen. ¿Pasa el criterio de ≤ 2 %? ¿Y si pierde 8?
Con 5, la cota exacta de una cola al 95 % es ≈ **1.74 %**: pasa. Con 8, ≈ **2.39 %**: no pasa, aunque su recall observado (98.7 %) parezca alto. El criterio es la cota, no el promedio.
? [reto] ¿Qué RTFx tendría que medir el piloto en una L40S para que bastaran 2 tarjetas en el día pico? Si lo midiera, ¿comprarías 2?
Con \(G\) = 2: \(R^{*}\) = 1,600 ÷ (6.8 × 2 − 2 × 2.08) = 1,600 ÷ 9.44 ≈ **170×** (la calculadora da 169.6). Con 180× medidos, 2 tarjetas cierran el pico en ≈ 6.53 h. Pero con 2, si una falla el pico tarda ≈ 13 h y el tablero no llega. Se pueden comprar 2 en el chasis de 4 ranuras si el negocio acepta que una falla en quincena atrasa el tablero un día, y escribirlo así; la propuesta del caso sigue en 4.
:::

## Qué cambiaría si… {What would change if…} [extra]

**…fuera una SOFOM no regulada y no un banco** (presta, pero no la supervisa la CNBV). Su ley no trae un artículo de secreto ni las disposiciones de terceros de la CNBV; sí la CONDUSEF y su registro, la LFPDPPP y PCI. El caso técnico es el mismo; el argumento contra la API se debilita, y el secreto lo ponen los contratos con sus clientes.

**…quisieran el tablero cada hora y no cada mañana.** Ya no hay ventana: es un lote continuo de ≈ 667 llamadas por hora entre 8:00 y 20:00. Con 4 L40S a la cota baja, cada hora de llamadas pide ≈ 0.24 h de reloj: cabe de sobra, y el servidor se usa de día, no de noche. Lo que cambia es la operación: una falla a las 11:00 sí la ve alguien.

**…quisieran escuchar en vivo** (sugerirle al agente qué decir mientras habla). Es otro sistema: voz a texto en *streaming*, latencia de cientos de milisegundos y 200 llamadas a la vez en el pico. Vuelve el TTFT, vuelve la herramienta de sizing y vuelve el N+1 de la clínica.

**…pidieran calificar a los agentes con el tablero.** Es otra finalidad, con otro titular: aviso al personal, revisión humana antes de cualquier consecuencia (LFPDPPP art. 26 fr. II), el abogado laboral y un examen de sesgo por región, porque un agente que atiende al sur hereda el WER del sur.

**…la ventana real fuera de 20:00 a 06:00.** El centro cierra a las 20:00: si la central exporta a las 20:15, la ventana crece a ≈ 9.75 h y el día pico cabe con mucha más holgura. A veces la mejor GPU es una conversación con TI sobre la hora de exportación.

### Lo que sigue {What comes next}

Los cuatro casos hasta aquí cambian, cada uno, qué manda: el **despacho**, la pregunta típica con un objetivo de 2 s; la **clínica**, el expediente largo y la noche; la **fábrica**, la red de planta y la seguridad de quien sigue un procedimiento; la **financiera**, el throughput de dos modelos en una ventana. El siguiente, la **dependencia de gobierno**, quita lo que todos dieron por hecho: que algo pueda entrar por internet, aunque sea una vez. Para repasar lo que este caso aplicó: [Concurrencia](/concurrencia/), [Batching](/batching/), [Pruebas de carga](/pruebas-carga/), [Evals](/evals/) y [TCO](/costo-total/).

:::conceptos
secreto-bancario servicio-de-terceros une reune pci-dss pan sad redaccion-de-datos luhn voz-a-texto diarizacion vad wer rtfx ventana-de-lote
:::

:::chequeo
? ¿Por qué el TTFT no importa en este caso?
Porque nadie espera cada llamada: es un lote que tiene que terminar en una ventana. Lo que se mide es el throughput (horas de audio por hora de GPU y tokens por segundo totales).
? ¿Qué pieza decide el hardware, el LLM o la voz a texto?
La voz a texto: ≈ 9.41 h de una L40S por noche con la cota baja, contra ≈ 2.08 h del LLM.
? ¿Por qué 4 L40S y no 2 Server Edition, si cuestan casi lo mismo?
Las dos cierran el pico con la cota baja, pero con 4 una falla quita 25 % (el pico termina a las 5:40) y con 2 quita 50 % (no termina). Y la ventaja de la Server Edition es para el LLM, la parte barata.
? ¿Por qué el redactor no usa la prueba de Luhn para decidir qué tachar?
Porque un dígito mal transcrito hace que una tarjeta real no pase la prueba y se quede en el texto. Se tacha toda corrida de 13 o más dígitos.
? ¿Redactar la transcripción resuelve el problema de PCI?
No del todo: el código dicho sigue en el audio que la CNBV pide guardar 180 días. La primera defensa es pausar la grabación en la central.
? ¿La regulación prohíbe mandar las llamadas a una API en la nube?
No. Pide un trámite (art. 318 de las disposiciones de la CNBV, con aviso previo a la CNBV y, si el proveedor está fuera de México, su autorización, arts. 326 y 328), le extiende el secreto bancario al proveedor y lo mete al alcance de PCI. Es caro de tramitar, no prohibido.
:::
