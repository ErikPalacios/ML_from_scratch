---
titulo: El recorrido de un proyecto de IA privada
en: The path of a private AI project
subtitulo: Las seis etapas de llevar un LLM al hardware de una empresa, de la primera plática con el cliente al día 2, con las cuentas de servilleta que deciden qué se compra y las puertas donde conviene detenerse.
pregunta: Una empresa quiere «su propia IA, sin que sus datos salgan». ¿Por dónde se empieza, qué se calcula, qué se compra y cuándo se sabe si sirvió?
sensei: camino-completo, llms, nube, privacidad, maquinas
---

:::idea
Un proyecto de IA privada no es «instalar un modelo». Es un recorrido de seis etapas (descubrimiento, sizing, compra, despliegue, evals y operación), y cada una responde una pregunta cuyo resultado alimenta a la siguiente. Lo barato va primero: hablar, calcular y probar en una GPU rentada. Lo caro, comprar, va solo cuando los números dicen que sí.
:::

Imagina que te llama el socio de un despacho de abogados. Te dice: «Queremos usar IA con nuestros expedientes, pero nada puede salir de la oficina. ¿Cuánto cuesta un servidor?». Es la pregunta equivocada en el orden equivocado, y es la que casi todos hacen primero. Para contestar «cuánto cuesta un servidor» necesitas saber qué tarea va a hacer, para cuántas personas, cuántas a la vez, con qué modelo, qué tan rápido debe contestar y quién lo va a mantener vivo. Cada una de esas respuestas sale de una etapa distinta.

Esta lección es el mapa de la app. Vas a ver las seis etapas con un mismo caso de principio a fin, las cuentas mínimas para que el mapa tenga números y dónde se puede detener o regresar el proyecto. Cada etapa tiene después su lección a fondo; aquí aprendes dónde queda cada pieza y por qué va en ese orden.

Cuatro palabras antes de empezar, que se usan en toda la app:

- Un **LLM** (*large language model*, modelo grande de lenguaje) es un programa que lee texto y escribe texto. Es lo que hay detrás de cualquier chatbot. Lo viste a fondo en [Transformers y LLMs](https://sensei.trueml.app/llms/).
- Un **token** es el pedacito de texto con que trabaja un LLM: una palabra corta, un trozo de palabra o un signo. El modelo lee la pregunta en tokens y escribe la respuesta un token a la vez.
- Una **GPU** es el chip que hace las cuentas del modelo, millones de operaciones en paralelo. Es la pieza cara del hardware.
- Un modelo **[[open-weight|open weight]]** es uno cuyo archivo de [[pesos]] (los números que aprendió) se puede descargar y correr en tu propia máquina. Eso es lo que hace posible la IA privada: el modelo vive en la red de la empresa y nadie de fuera ve lo que se le pregunta.

En Sensei viste [El camino completo](https://sensei.trueml.app/camino-completo/): las seis etapas de un *sistema* de ML en producción, de los datos al monitoreo. Aquí las seis etapas son de un *proyecto*: de la primera plática con un cliente a operar su sistema. Se tocan: el despliegue de aquí junta la API, el contenedor y la orquestación de allá; las evals son el examen del modelo, y la operación incluye el monitoreo. Pero el orden de un proyecto lo decide algo que el sistema no tiene: el dinero se gasta una sola vez y el hardware tarda en llegar.

## Por qué una empresa quiere IA privada {Why a company wants private AI}

### El despacho

El hilo de toda la app es un caso ficticio: **el despacho**, un despacho de abogados en la Ciudad de México con **200 abogados y asistentes** y **30,000 expedientes** (≈ 1.5 millones de páginas de contratos, demandas, sentencias y correos), en español con algunos contratos en inglés. Quiere preguntarle a sus expedientes con un LLM **sin que un solo documento salga de su red**. Su equipo de TI son **2 personas** que saben de redes y Windows y nunca han operado una GPU. Todos sus números viven en una sola ficha y se usan igual en todas las páginas; esta lección los presenta todos.

¿Por qué no contrata una API pública, como la de cualquier chatbot comercial, y ya? (Una API es la ventanilla por la que un programa le pide algo a otro por la red; con una API pública, el texto viaja a los servidores del proveedor.) Tiene tres razones, y una cuarta que la mayoría de las empresas comparte.

### 1. El secreto profesional

Un abogado está obligado a guardar los secretos de sus clientes. En México, la Ley Reglamentaria del Artículo 5º Constitucional, relativo al ejercicio de las profesiones en la Ciudad de México, lo dice en su artículo 36: todo profesionista debe guardar estrictamente el secreto de los asuntos que le confían sus clientes, salvo los informes que las leyes obliguen a dar. El Código Penal Federal, en su artículo 211, castiga con 1 a 5 años de prisión, multa y suspensión de la profesión de 2 meses a 1 año a quien, prestando servicios profesionales, revela un secreto sin justa causa, con perjuicio y sin consentimiento.

¿Pegar un contrato en un chatbot público es «revelarlo»? Esas leyes no hablan de IA, y no hay una respuesta escrita que diga sí o no. Es una pregunta para un abogado, no para un ingeniero. Pero el escenario que describen, mandarle el asunto de un cliente a un tercero, se parece lo bastante como para que un despacho prudente no quiera averiguarlo con un caso real.

### 2. Los datos personales

Los expedientes están llenos de datos personales: nombres, domicilios, sueldos, a veces datos de salud. En [Datos personales y la ley](https://sensei.trueml.app/privacidad/) viste la LFPDPPP (Ley Federal de Protección de Datos Personales en Posesión de los Particulares): la nueva se publicó en el Diario Oficial el 20 de marzo de 2025, entró en vigor al día siguiente y desde entonces la vigila la Secretaría Anticorrupción y Buen Gobierno. Para un proyecto de IA importan tres detalles más:

- **La ley no menciona la nube ni la inteligencia artificial.** No hay una regla que diga «los LLM se corren en casa». El argumento a favor de la infraestructura propia es de **control** del flujo de datos, no un mandato legal.
- **Mandar datos a otro, dentro o fuera del país, tiene reglas.** La ley llama «transferencia» a toda comunicación de datos dentro o fuera del territorio, con su capítulo propio. Cada vez que un expediente viaja a los servidores de un proveedor, hay que poder explicar bajo qué figura lo hace.
- **Hay un derecho a oponerse a decisiones automatizadas.** El artículo 26, fracción II, deja que una persona se oponga a un tratamiento automatizado que evalúe, sin intervención humana, aspectos como su rendimiento profesional, su situación económica o su salud, y que le produzca efectos jurídicos no deseados o la afecte significativamente. Un asistente que *ayuda* a un abogado no decide solo; uno que calificara a personas sin que nadie revise, sí podría tocar ese artículo.

Y las multas no son simbólicas: según el tipo de infracción, de 100 a 160,000 veces la UMA (la Unidad de Medida y Actualización, el valor en pesos que usan las leyes para fijar multas) o de 200 a 320,000, y con datos sensibles pueden llegar al doble. Todo esto es contexto para entender al cliente; qué aplica a su caso lo revisa un abogado.

### 3. Los contratos de sus clientes

Algunos clientes del despacho le prohíben **por contrato** mandar sus documentos a terceros. Aquí no hay interpretación: si el contrato dice que nada sale, nada sale. Esto es lo que hace del despacho un caso de [[soberania-de-datos|soberanía de datos]]: necesita saber en qué máquina está cada documento, quién lo puede ver y poder demostrarlo.

### 4. La gente ya usa IA, por su cuenta

El riesgo que disparó el proyecto no está en el futuro: hoy algunos abogados del despacho pegan contratos en chatbots públicos. A eso se le dice [[shadow-ai|shadow AI]] (IA en la sombra): herramientas de IA que la empresa no aprobó ni controla, usadas muchas veces con cuentas personales. Las cifras, con su letra chica:

- **El estudio de MIT NANDA de 2025** (*The GenAI Divide*, entrevistas y encuestas a líderes de empresas): solo el **40 %** de las empresas dijo haber comprado una suscripción oficial a un LLM, pero en **más del 90 %** los trabajadores reportan usar herramientas de IA personales para el trabajo. Es una muestra chica y el propio informe dice que es direccional, no exacta.
- **El *Cost of a Data Breach Report 2025* de IBM:** **1 de cada 5** organizaciones reportó una brecha (un incidente en que se filtran o roban datos) ligada a shadow AI, y las que tenían mucho shadow AI pagaron en promedio **US$670,000 más** por brecha que las que tenían poco o nada. El costo promedio mundial de una brecha fue de US$4.44 millones.
- **Un informe de LayerX de 2025** (una empresa de seguridad, que vende justo esto): el 45 % de los empleados usa IA generativa; de *esos*, el 77 % pega datos en sus consultas; el 22 % de lo pegado trae datos personales o de tarjetas, y el 82 % viene de cuentas personales, no de las de la empresa. Ve solo lo que pasa en el navegador.

:::ojo
Lee las bases de cada porcentaje. «77 %» no es el 77 % de todos los empleados: es el 77 % de los que ya usan IA. «97 % sin controles de acceso», otra cifra de IBM, es de las organizaciones que tuvieron una brecha en sus modelos de IA (el 13 %), no de todas. Una cifra sin su base engaña, aunque sea cierta.
:::

La lección práctica: prohibir sin dar una alternativa casi nunca funciona. Una herramienta interna que sí sirva es, muchas veces, el mejor control.

### 5. El costo predecible

Una API cobra por token: si el uso se duplica, la factura se duplica. Un servidor propio cuesta casi lo mismo si se usa poco o mucho. Para una empresa con uso alto y parejo, eso puede salir más barato y, sobre todo, más fácil de presupuestar. En [Qué es la nube](https://sensei.trueml.app/nube/) viste esta decisión como comprar o rentar (CapEx contra OpEx); [[tco|la cuenta completa]], con [[depreciacion|depreciación]] y [[punto-de-equilibrio|punto de equilibrio]], es tema de la lección «[TCO: API, nube o servidor propio](/costo-total/)».

### Cuándo NO conviene

Un buen ingeniero también sabe decir «esto no es para ti». La IA privada no conviene cuando:

- **El volumen es bajo.** Una GPU cuesta lo mismo prendida sin trabajo. Una oficina de 15 personas con el mismo uso que el despacho (15 preguntas al día cada una, 10 horas, pico de 2.5 y 27 s por respuesta) tendría en promedio ≈ 0.42 conversaciones a la vez en su hora pico: la GPU pasaría casi todo el día esperando.
- **No hay quién lo opere.** Un servidor de IA necesita actualizaciones, respaldos y alguien que conteste cuando se cae. Si nadie puede, el sistema se degrada en silencio.
- **Los datos no son sensibles.** Si no hay secreto, datos personales ni contratos que lo impidan, un servicio administrado suele ser más rápido de arrancar y más barato de mantener.

Entre «todo en la nube pública» y «todo en mi cuarto» hay opciones intermedias, como un contrato empresarial con un proveedor que se compromete a no usar tus datos y a procesarlos en cierta región. Si eso basta para el cliente lo decide su abogado leyendo ese contrato.

## Las seis etapas de un vistazo {The six stages at a glance}

Cada etapa responde una pregunta. Lo que sale de una es lo que necesita la siguiente.

| Etapa | La pregunta | Lo que sale |
|---|---|---|
| 1 · Descubrimiento | ¿Qué tarea, para quién y cómo sabré que sirve? | Un caso de uso y un criterio de aceptación con números |
| 2 · Sizing | ¿Cuánto hardware hace falta? | Modelo y GPU candidatos, con la cuenta |
| 3 · Compra | ¿Rento o compro, y cuándo llega? | Una GPU rentada para el piloto; luego, la orden de compra |
| 4 · Despliegue | ¿Cómo se arma el sistema? | El stack funcionando en la red del cliente |
| 5 · Evals | ¿Sirve y aguanta? | Un sí o un no con números |
| 6 · Operación | ¿Cómo sigue vivo mañana? | Monitoreo, actualizaciones, respaldos y responsables |

:::diagrama recorrido-etapas
Toca cada etapa para ver qué sale de ella, o usa «Recorrer» para seguir al despacho de principio a fin. La flecha punteada es la que más se olvida: cada actualización vuelve a evals.
:::

Fíjate en el orden. Las tres primeras etapas son casi solo papel, cuentas y una GPU rentada: equivocarse ahí cuesta días y, a lo más, un par de miles de dólares de GPU rentada. Las tres últimas pasan sobre equipo comprado: equivocarse ahí cuesta el equipo. Por eso cada decisión cara se toma lo más tarde posible, cuando ya hay números que la respalden.

:::analogia Construir una casa
El descubrimiento es la plática con el arquitecto: cuántos viven, qué necesitan, cuánto pueden gastar. El sizing son los planos y el cálculo de la estructura. La compra son los materiales (y aquí rentas una casa parecida un mes para probar si de verdad te gusta el barrio). El despliegue es la obra. Las evals son la inspección antes de mudarte. La operación es vivir ahí: goteras, pintura, el plomero.

**Dónde se rompe:** una casa no cambia sola, y el software sí. Cada pocas semanas sale un modelo o una versión del servidor nueva, y decidir si la instalas es volver a inspeccionar. Además, una casa se ve; un modelo que empieza a contestar peor no hace ruido: si no lo mides, nadie se entera.
:::

## Descubrimiento: las preguntas antes del hardware {Discovery: questions before hardware}

El [[descubrimiento]] (*discovery*) es la primera etapa: entender qué quiere resolver el cliente antes de hablar de GPUs. Se hace con una lista fija de preguntas, para no olvidar ninguna. Cada una alimenta una cuenta o una decisión posterior.

:::pasos
1. Tareas
¿Qué quieren que haga? Pide ejemplos reales: «tres preguntas que hiciste la semana pasada». Una tarea vaga («usar IA») no se puede dimensionar ni evaluar. **Alimenta:** la elección del modelo y la arquitectura (por ejemplo, si hace falta buscar en documentos).

2. Usuarios
¿Cuántas personas lo van a usar, quiénes son y qué pueden ver? No es lo mismo 200 usuarios registrados que 200 a la vez. **Alimenta:** el sizing y los permisos.

3. Volumen
¿Cuántas preguntas al día por persona, en qué horario y cómo se reparten? ¿Hay una hora pico? **Alimenta:** el sizing.

4. Datos
¿Qué documentos, cuántos, en qué formato y dónde viven? ¿Escaneados o con texto? **Alimenta:** el tamaño de cada pregunta (cuánto texto se le pasa al modelo) y la aplicación de búsqueda.

5. Idioma
¿En qué idioma preguntan y en cuál están los documentos? **Alimenta:** la elección del modelo: no todos rinden igual en español.

6. Latencia
¿Cuánto puede esperar una persona la primera palabra, y qué tan rápido debe escribir? **Alimenta:** la GPU y cuántas conversaciones aguanta a la vez.

7. Restricciones
Legales, de contrato, de red (¿el servidor puede tener internet?), de presupuesto, de espacio y de personal (¿quién lo opera?). **Alimenta:** todo: una restricción puede cerrar el proyecto antes de empezar.
:::

:::figura recorrido-preguntas
La hoja de descubrimiento del despacho, llena en la primera visita. Abajo, lo único que se firma: el caso de uso y el criterio de aceptación.
:::

### Elegir un solo caso de uso

Un [[caso-de-uso|caso de uso]] es una tarea concreta para alguien concreto: quién pregunta, qué pregunta, con qué datos y qué recibe. El despacho pidió tres:

1. Preguntar sobre los expedientes, con respuestas que citan el documento y la página.
2. Resumir un expediente.
3. Encontrar cláusulas parecidas en otros contratos.

Se empieza por **uno**, el 1, porque cumple las tres condiciones de un buen primer caso: es **frecuente** (es lo que más piden), se puede **medir** (una respuesta con cita se revisa: la cita existe y dice eso, o no) y **no es el más riesgoso** (un abogado revisa la respuesta antes de usarla; nadie firma un contrato que escribió la máquina). Técnicamente es un [[rag|RAG]] (*retrieval-augmented generation*): el sistema primero busca los fragmentos de expediente que hablan del tema y después le pide al modelo que conteste solo con ellos y diga de dónde los sacó. Lo ves a fondo en la lección «[RAG privado: embeddings y vector DB locales](/rag-privado/)».

Hacer los tres a la vez es la forma más común de no terminar ninguno.

### El criterio de aceptación: «que funcione bien» no es un criterio

El [[criterio-de-aceptacion|criterio de aceptación]] es la regla con números, firmada antes de empezar, que dice cuándo el sistema sirve. Sin él, el piloto termina en opiniones («a mí me gustó», «a mí no»); con él, termina en un sí o un no. Tiene dos mitades.

**La calidad.** Se mide con un examen de preguntas reales del despacho con su respuesta correcta, escritas por sus abogados. El del despacho:

- **≥ 85 %** de **200 preguntas** reales contestadas bien y con la cita correcta (documento y página): 170 o más.
- **A lo más 2 %** con una cita inventada (un documento o una página que no existe o no dice eso): 4 o menos. En un despacho, citar algo que no existe es peor que no contestar, y por eso tiene su propio límite.

**El servicio.** Con la carga de diseño (8 conversaciones a la vez, como verás en la siguiente sección):

- **[[ttft|Tiempo al primer token]] ≤ 2 s** en el p95: 95 de cada 100 preguntas ven la primera palabra en 2 segundos o menos. El p95 lo viste en [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/).
- **≥ 20 tokens/s** por persona: más rápido de lo que se lee. Una respuesta de 500 tokens se escribe en 25 s o menos.

:::ojo
El 85 % y el 2 % son decisiones del despacho, no números de la técnica. Los pone el cliente, con tu ayuda, según cuánto le cuesta un error. Una clínica pediría otros; un buscador de recetas, otros. Lo que no se negocia es que sean números y que se firmen **antes** de ver los resultados: si los fijas después, los ajustas sin querer a lo que salió.
:::

## Sizing en una servilleta {Napkin sizing}

El [[sizing]] (dimensionar) es calcular cuánto hardware hace falta. Aquí va la versión de servilleta: la que se hace en la primera reunión para saber si hablamos de una GPU o de veinte. La versión a fondo es la lección «[De requisitos a hardware](/requisitos-hardware/)».

### De personas a preguntas por segundo

Lo primero es no confundir usuarios registrados con usuarios a la vez. El despacho tiene 200 personas, pero no escriben todas en el mismo segundo. Lo que importa al servidor es cuántas preguntas le llegan por segundo en el peor momento normal, la **hora pico**.

:::formula Las llegadas en la hora pico
Q = N × q
λ = frac{Q}{h} × k ÷ 3,600
- N: las personas que lo usan
- q: las preguntas de cada persona al día
- Q: las preguntas al día
- h: las horas de uso al día
- k: el [[factor-de-pico|factor de la hora pico]]: cuántas veces el promedio por hora llega en la hora más cargada
- 3,600: los segundos de una hora
- λ: las llegadas (preguntas nuevas) por segundo en la hora pico; se lee «lambda»
:::

:::cuenta Las llegadas del despacho
Preguntas al día, \(Q\) // \(N\) = 200 personas, \(q\) = 15 preguntas cada una | 200 × 15 | 3,000
Por hora, en promedio // \(h\) = 10 horas, de 9:00 a 19:00 | 3,000 ÷ 10 | 300
En la hora pico // \(k\) = 2.5 | 300 × 2.5 | 750
Por segundo, \(λ\) // 3,600 s en una hora | 750 ÷ 3,600 | **≈ 0.21**
= En la hora pico llega una pregunta nueva cada ≈ 4.8 segundos. No parece mucho, hasta que ves cuánto dura cada una.
:::

### De preguntas por segundo a conversaciones a la vez

Una respuesta de LLM no es instantánea. Tiene dos partes: la espera hasta la primera palabra y la escritura, token por token. Al tiempo hasta la primera palabra se le dice [[ttft|TTFT]] (*time to first token*); a la escritura la mide su velocidad, en tokens por segundo. Las dos se ven a fondo en la lección «[Concurrencia: la curva de usuarios contra latencia](/concurrencia/)». Para la servilleta basta sumarlas en el peor caso aceptable del criterio.

Y con eso entra la regla más útil de este oficio, la **[[ley-de-little|Ley de Little]]**: lo que hay adentro de un sistema a la vez es lo que llega por segundo por lo que tarda cada uno en salir. Si a una cafetería entran 2 clientes por minuto y cada uno se queda 10 minutos, adentro hay ≈ 20. Su lección a fondo también es «[Concurrencia](/concurrencia/)».

:::formula Conversaciones a la vez
D = t_{1} + frac{s}{v}
u = λ × D
u_{diseño} = ⌈ u × m ⌉
- t_{1}: el tiempo al primer token, en s
- s: los tokens de una respuesta
- v: la velocidad de escritura, en tokens por segundo
- D: lo que dura una respuesta, en s
- u: las [[concurrencia|conversaciones a la vez]], en promedio, en la hora pico
- m: el margen para los picos dentro de la hora pico (más de 1)
- u_{diseño}: las conversaciones para las que se diseña; ⌈ ⌉ es redondear hacia arriba
:::

:::cuenta Las conversaciones a la vez del despacho
Duración, \(D\) // \(t_{1}\) = 2 s, \(s\) = 500 tokens, \(v\) = 20 tokens/s: el peor caso que acepta el criterio | 2 + 500 ÷ 20 = 2 + 25 | 27 s
En promedio, \(u\) // \(λ\) = 750 ÷ 3,600 de la cuenta anterior | 0.2083 × 27 | **≈ 5.6**
De diseño, \(u_{diseño}\) // \(m\) ≈ 1.4: dentro de la hora pico hay minutos peores que otros | ⌈5.625 × 1.4⌉ = ⌈7.9⌉ | **8**
= El despacho tiene 200 personas, pero su servidor debe atender 8 conversaciones a la vez. Ese 8 es el número que va a la cuenta de memoria.
:::

El margen \(m\) es un juicio, no una ley. Las llegadas vienen al azar: en un minuto llegan 3 preguntas, en el siguiente ninguna. Por eso, aunque el promedio sea 5.6, a ratos habrá más.

:::profundo ¿Qué tanto se pasa de 8?
Si las preguntas llegan al azar y sin ponerse de acuerdo (lo que en probabilidad se llama llegadas de Poisson), y cada una ocupa un lugar mientras dura, el número de conversaciones a la vez sigue una distribución de Poisson con promedio \(u\) = 5.6. Con ese modelo, en la hora pico hay 8 o menos ≈ 88 % del tiempo, y más de 8 el ≈ 12 % restante. En esos ratos el servidor no se cae: atiende a más a la vez y cada uno va un poco más lento, o algunos esperan su turno. Es un modelo simplificado; la lección «Concurrencia» mide la curva real.
:::

:::calculadora recorrido-servilleta
Cada resultado trae debajo su cuenta con los números del momento. El último va a la herramienta de VRAM.
:::

Y en Python, con la biblioteca estándar, para tres tamaños de despacho:

```python
import math

def servilleta(N, q, h, k, D, m=1.4):
    Q = N * q              # preguntas al día
    pico = Q / h * k       # preguntas en la hora pico
    lam = pico / 3600      # llegadas por segundo en el pico
    u = lam * D            # Ley de Little: conversaciones a la vez
    return Q, pico, lam, u, math.ceil(u * m)

D = 2 + 500 / 20           # primer token + 500 tokens a 20 por segundo
print(f"Duración de una respuesta: {D:.0f} s")
for N in (200, 300, 1000):
    Q, pico, lam, u, dis = servilleta(N, 15, 10, 2.5, D)
    print(f"{N:>5} personas: {Q:>6,} al día · {pico:>5,.0f} en el pico"
          f" · λ = {lam:.3f}/s · u = {u:4.1f} · diseño = {dis}")
```

```salida
Duración de una respuesta: 27 s
  200 personas:  3,000 al día ·   750 en el pico · λ = 0.208/s · u =  5.6 · diseño = 8
  300 personas:  4,500 al día · 1,125 en el pico · λ = 0.312/s · u =  8.4 · diseño = 12
 1000 personas: 15,000 al día · 3,750 en el pico · λ = 1.042/s · u = 28.1 · diseño = 40
```

Todo crece en proporción: 5 veces más personas, 5 veces más conversaciones a la vez. Lo que *no* crece en proporción es el hardware: va por escalones, de una GPU a dos o a tres.

### De conversaciones a la vez a VRAM

Con el 8 ya se puede hacer la cuenta de memoria. Una GPU solo trabaja con lo que tiene en su [[vram|VRAM]], su memoria propia, separada de la RAM de la computadora, y ahí deben caber los [[pesos]] del modelo, el [[kv-cache|KV cache]] de cada conversación (lo que el modelo recuerda de ella mientras contesta) y el [[overhead]] del programa. La herramienta [¿Cabe en la GPU?](/herramientas/vram/) explica cada pieza desde cero; aquí va el resultado para el despacho.

El modelo candidato es Qwen3 32B: 32 mil millones de parámetros (los números que aprendió). Se guarda en INT4 de AWQ, es decir, con cada número comprimido a ≈ 4 bits en vez de 16: una forma de [[cuantizacion|cuantización]] que la herramienta de VRAM explica paso a paso.

Antes, un dato de la ficha: cada pregunta lleva ≈ 6,000 tokens de entrada (≈ 400 de instrucciones, ≈ 100 de la pregunta y 5 fragmentos de expediente de ≈ 1,000 tokens cada uno, redondeado) y ≈ 500 de salida. Por eso cada conversación se diseña con un tope de [[contexto]] (todo el texto que el modelo tiene a la vista en una conversación) de 8,192 tokens: cabe la primera pregunta (≈ 6,500) y una repregunta corta.

:::cuenta La memoria del despacho, en una L40S
Pesos, \(W\) // Qwen3 32B en INT4 de AWQ (la cuenta de la herramienta de VRAM) | 19.32 GB | 19.32 GB
KV cache // 8 conversaciones de 8,192 tokens, ≈ 2.15 GB cada una | 2.147 × 8 | 17.18 GB
Lo que necesitas // pesos + KV cache + 2 GB de programa | 19.32 + 17.18 + 2 | 38.50 GB
Lo que tienes, \(M_{útil}\) // 1 × NVIDIA L40S de 48 GB, con 10 % libre de margen | 0.9 × 48 | 43.2 GB
= Por memoria, caben, con 4.70 GB de sobra: en esa sobra caben 2 conversaciones más de 8,192 tokens, hasta 10. La servilleta dice «caben 8 en 1 L40S». Todavía no dice si se atienden bien.
:::

:::figura recorrido-embudo
El sizing del despacho de un vistazo: de 200 personas a 8 conversaciones a la vez, y de ahí a 38.50 de los 43.2 GB útiles de una L40S. Es solo la memoria.
:::

### Lo que la servilleta no ve: el cómputo y el ancho de banda

La servilleta solo mira memoria: dice cuántas conversaciones **caben**. Que se atiendan **bien** depende de otras dos cosas. Antes de escribir la primera palabra, el modelo tiene que leer completa la pregunta, con sus ≈ 6,000 tokens de fragmentos: a esa primera pasada se le dice *[[prefill|prefill]]*, y la limita el cómputo de la GPU (cuántas operaciones hace por segundo). Después escribe token por token, y cada token obliga a leer de la VRAM los pesos y el KV cache: eso lo limita el [[ancho-de-banda|ancho de banda]] de la memoria (cuántos GB por segundo puede leer). Las operaciones de un modelo las contaste en [Matrices y FLOPs](https://sensei.trueml.app/flops/).

La cuenta del prefill se hace a mano. Un modelo hace ≈ 2 operaciones por parámetro por cada token que lee (una multiplicación y una suma). A esas operaciones con decimales se les dice FLOPs, y la velocidad de una GPU se mide en TFLOPS: billones (10¹²) de operaciones por segundo. Una GPU real no alcanza su pico: la app supone que [[eficiencia|aprovecha la mitad de sus FLOPs]] (\(η_c\) = 0.5; \(η\) se lee «eta») y el 70 % de su ancho de banda (\(η_m\) = 0.7).

:::formula El tiempo del prefill
F = 2 × P × n_{in}
t_{prefill} = frac{F}{η_c × C}
- P: los parámetros del modelo
- n_{in}: los tokens de entrada de una pregunta
- F: las operaciones del prefill, en FLOPs
- C: el [[pico-de-calculo|cómputo pico]] de la GPU, en FLOPs por segundo
- η_c: la parte de ese pico que se aprovecha de verdad (0.5)
- t_{prefill}: lo que tarda en leer la pregunta, en s: la parte más grande del tiempo al primer token
:::

:::cuenta El prefill de una pregunta del despacho, en una L40S
Operaciones, \(F\) // \(P\) = 32.76 mil millones (Qwen3 32B), \(n_{in}\) = 6,000 tokens | 2 × 32.76 × 10⁹ × 6,000 | ≈ 3.9 × 10¹⁴ FLOPs
Cómputo útil // \(C\) = 362 TFLOPS en FP16 denso (con números de 16 bits y [[sparsity\|sin el truco que duplica la cifra de catálogo]]; archivo de GPUs), \(η_c\) = 0.5 | 0.5 × 362 × 10¹² | ≈ 1.81 × 10¹⁴ por s
Tiempo, \(t_{prefill}\) | 3.9 × 10¹⁴ ÷ 1.81 × 10¹⁴ | **≈ 2.17 s**
= Con una sola pregunta y la GPU libre, la primera palabra ya tarda más que los 2 s del objetivo. La [herramienta de sizing](/herramientas/sizing/), que cuenta todo lo demás, da ≈ 2.38 s.
:::

Y hay más: mientras la GPU hace el prefill de una pregunta nueva, las conversaciones que [[decode|ya escriben]] se frenan. La cuenta completa de la [herramienta de sizing](/herramientas/sizing/) (con cómputo y ancho de banda) dice que, con prefills de 6,000 tokens llegando, una L40S solo mantiene **2** conversaciones a ≥ 20 tokens/s. Para las ≈ 5.6 del despacho en promedio hacen falta **3 L40S** (5.6 ÷ 2, hacia arriba), y aun así el tiempo al primer token queda en ≈ 2.4 s: el objetivo de ≤ 2 s **no se cumple** con L40S. Y si se quiere que las 8 de diseño vayan todas a ≥ 20 tokens/s, como pide el criterio en la [[prueba-de-carga|prueba de carga]], la misma cuenta da 4 (8 ÷ 2). El detalle, con la curva de usuarios contra latencia, está en la lección «Concurrencia: la curva de usuarios contra latencia».

:::ojo
La memoria dice cuántas **caben**; el cómputo y el ancho de banda, cuántas se atienden **bien**. «Caben 8 en 1 L40S» es cierto y no basta: con lo que pide el despacho, 1 L40S no alcanza.
:::

Esto no es un error del proyecto: es el recorrido funcionando. El sizing encontró que lo que se pidió en descubrimiento no cabe en el hardware candidato, y toca **regresar** a descubrimiento a decidir con el cliente: una GPU con más cómputo, menos tokens de entrada (menos fragmentos por pregunta, o más cortos) o aflojar el objetivo de tiempo al primer token. Esa decisión, con su costo, se toma en el caso del despacho; aquí lo que importa es ver la vuelta.

Qwen3 32B es el candidato, no la decisión: también se evaluarán Mistral Small 24B, Qwen3 30B-A3B (un modelo [[moe|MoE]], que usa solo una parte de sus parámetros en cada token) y Llama 3.3 70B. Cómo se eligen y qué licencia trae cada uno son las lecciones «[Elegir un modelo para la tarea](/elegir-modelo/)» y «[Open weight, open source y licencias](/licencias/)». Qwen3 32B, por ejemplo, viene con licencia [[apache-2|Apache 2.0]].

## Compra: rentar primero, comprar después {Buying: rent first, buy later}

Con el sizing en la mano, la tentación es comprar. La regla es otra: **rentar primero para el piloto, comprar después.** Hay tres razones.

1. **El sizing es una estimación.** Los 15 preguntas por persona, el factor pico de 2.5 y los 6,000 tokens por pregunta son supuestos de la primera reunión. El piloto los mide de verdad. Si la gente pregunta el doble, o pega documentos más largos, mejor saberlo antes de comprar.
2. **Puedes probar varios candidatos.** En horas rentadas puedes medir cuántas conversaciones atiende de verdad una L40S con Qwen3 32B (la cuenta dice 2 a buena velocidad, no 8) y, si no alcanza la calidad, Llama 3.3 70B en una GPU más grande, sin comprar ninguna. Las GPUs que se rentan, sus precios por hora y la diferencia entre la hora facturada y la hora trabajando los viste en [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/).
3. **Equivocarse rentando cuesta poco.** Unas semanas de GPU rentada cuestan una fracción de un servidor equivocado. La cuenta del piloto del despacho viene en la sección «La prueba piloto».

:::ojo
Rentar una GPU en la nube significa que los documentos del piloto **salen** de la red del despacho, justo lo que el proyecto quiere evitar. Se resuelve antes de empezar, con el cliente y su abogado: usar solo expedientes que el despacho pueda usar así (cerrados, públicos como sentencias publicadas, o con los datos personales quitados), rentar con un contrato de proveedor que el abogado apruebe, o rentar un equipo físico que se instala dentro de la oficina. Lo que no se vale es «es solo el piloto».
:::

### El tiempo de entrega

El [[tiempo-de-entrega|tiempo de entrega]] (*lead time*) es lo que pasa entre pedir el equipo y tenerlo funcionando: fabricarlo, armarlo, enviarlo, importarlo e instalarlo. En 2026 se alargó, sobre todo por la escasez de memoria (los chips de RAM que lleva cada servidor). A finales de mayo de 2026, Dell dijo que la demanda superaba la oferta, que la memoria era su principal restricción y que recotizaba casi a diario; HPE reconoció que coordinaba los tiempos de entrega con sus clientes (Supply Chain Dive, 11 de junio de 2026). En febrero, la guía de compra de ServeTheHome ya decía que los tiempos de entrega estaban estirados y que hasta conseguir una cotización válida por 30 días era difícil.

No hay una cifra oficial única. Circulan números de muchas semanas para las GPUs más nuevas que ningún fabricante ha confirmado. Lo honesto con un cliente es esto: **pueden ser semanas o meses; pregunta al proveedor y pide la fecha por escrito.** Y planear para eso: si el piloto termina y el equipo no ha llegado, la GPU rentada sigue mientras tanto.

:::nota Lo que viene después
La compra de verdad tiene más decisiones: workstation o servidor de rack, NVIDIA, AMD o Apple, dónde se pone, cuánta luz y aire acondicionado pide, cómo se importa a México. Son las lecciones «[Comprar hardware: de la workstation al rack](/comprar-hardware/)», «[El cuarto: energía, enfriamiento y red](/el-cuarto/)», «[TCO: API, nube o servidor propio](/costo-total/)» y «[Cotizar, proponer y dar soporte](/cotizar/)».
:::

## Despliegue: el stack en capas {Deployment: the layered stack}

El despliegue es armar todo lo que hace falta para que un abogado escriba una pregunta y reciba una respuesta. Ese todo es una pila de capas, el [[stack-de-ia|stack]], donde cada una se apoya en la de abajo.

:::figura recorrido-stack
Las seis capas del despacho, con la lección donde se ve cada una a fondo.
:::

**1 · Hardware.** El servidor con sus GPUs (el candidato de hoy: L40S de 48 GB, 3 según el sizing completo), su CPU, su RAM, su disco y su red. Si el cuarto se calienta o falla la luz, todo lo de arriba se cae. Lecciones: «[Comprar hardware: de la workstation al rack](/comprar-hardware/)» y «[El cuarto: energía, enfriamiento y red](/el-cuarto/)».

**2 · Sistema y drivers.** Linux, el driver de NVIDIA (el programa que deja al sistema operativo hablar con la GPU) y CUDA (la plataforma con que los programas usan la GPU), y casi siempre contenedores: paquetes que llevan un programa con todo lo que necesita, para que corra igual en cualquier máquina. Es la capa más frágil en actualizaciones: basta un driver que no corresponda con la versión de CUDA que espera el servidor de inferencia para que no arranque nada. Para el TI del despacho, que sabe de Windows, es la capa más nueva. Lección: «[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)».

**3 · Servidor de inferencia.** *Inferencia* es usar un modelo ya entrenado para contestar. El servidor de inferencia es el programa que carga el modelo en la GPU y atiende a muchas conversaciones a la vez, [[batch|juntándolas]] para aprovechar la GPU. Es el corazón técnico: decide cuántas caben y qué tan rápido va cada una. Lecciones: «[Batching continuo y PagedAttention](/batching/)» y «[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)».

**4 · La API.** La ventanilla por donde los programas le preguntan al modelo. Se usa casi siempre una API compatible con la de OpenAI, para que cualquier herramienta que ya sepa hablar con OpenAI hable con el servidor propio. Delante va un *gateway* que pide usuario y llave, registra quién preguntó qué y reparte entre modelos. Lección: «[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)».

**5 · La aplicación con [[rag|RAG]].** Lo que el abogado usa: busca en los 30,000 expedientes los fragmentos que hablan de su pregunta, se los pasa al modelo y muestra la respuesta con su cita. Aquí se gana o se pierde la calidad: si la búsqueda no encuentra la página correcta, el mejor modelo del mundo no la puede citar. Lección: «[RAG privado: embeddings y vector DB locales](/rag-privado/)».

**6 · Usuarios.** 200 abogados y asistentes, con su cuenta del despacho y sus permisos. Ojo con esto: no todos pueden ver todos los expedientes. Si la búsqueda no respeta los permisos, el sistema le enseña a un asistente un expediente que no le toca. Lección: «Seguridad: aislamiento, sin internet y actualizaciones» para la red y los accesos, y «[RAG privado](/rag-privado/)» para los permisos dentro de la búsqueda.

:::analogia Un edificio de oficinas
Cimientos (hardware), estructura e instalaciones (sistema y drivers), el elevador que mueve a todos (servidor de inferencia), la recepción que pide gafete (API y gateway), las oficinas donde se trabaja (la aplicación) y la gente con su gafete (usuarios).

**Dónde se rompe:** en un edificio casi nunca cambias el elevador. Aquí cambias el modelo o el servidor de inferencia cada pocos meses, y a veces el cambio en una capa obliga a cambiar la de abajo (un servidor nuevo que pide un driver nuevo).
:::

## Evals: demostrar que sirve {Evals: proving it works}

Las *evals* (evaluaciones) son las pruebas que dicen, con números, si el sistema sirve. Responden dos preguntas distintas, y las dos se contestan contra el criterio de aceptación que se firmó en descubrimiento.

### ¿Contesta bien?

Se le dan al sistema las **200 preguntas reales** del despacho, escritas por sus abogados con su respuesta correcta y su cita, y se cuenta cuántas contesta bien. Tres reglas:

- **Preguntas del cliente, no de internet.** Un modelo puede brillar en un examen público y fallar con contratos mexicanos. Esos exámenes públicos, iguales para todos los modelos, se llaman *[[benchmark|benchmarks]]*: sirven para elegir candidatos; el examen del despacho decide. Lo ves en «[Elegir un modelo para la tarea](/elegir-modelo/)».
- **Se evalúa el sistema completo**, búsqueda y modelo juntos. Si falla, hay que saber dónde: ¿no encontró el fragmento o lo encontró y contestó mal?
- **El examen se guarda** y se repite con cada cambio. Es lo que en la lección «[Demostrar que el modelo abierto sirve](/evals/)» se llama un *[[golden-set|golden set]]*, junto con cómo se califica a escala.

Con 200 preguntas, un 85 % no es exacto: otra muestra de 200 podría dar unos puntos más o menos. Cuánto ruido hay en un examen y cómo comparar dos modelos sin engañarse lo viste en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/).

### ¿Aguanta?

Un modelo que contesta perfecto a una persona puede ser lento con ocho. La **[[prueba-de-carga|prueba de carga]]** simula la hora pico: 8 conversaciones a la vez, cada una con ≈ 6,000 tokens de entrada y ≈ 500 de salida, y mide:

- el **[[ttft|tiempo al primer token]]** de cada pregunta, contra **≤ 2 s en el p95**;
- la **velocidad de escritura** de cada persona, contra **≥ 20 tokens/s**.

Esto ya da una pista de cuánto trabaja la GPU: 8 personas a 20 tokens/s son 160 tokens por segundo de salida que debe sostener a la vez, mientras además lee los 6,000 tokens de cada pregunta nueva. Cómo se diseña una prueba de carga honesta (con prompts reales, sin trampas de calentamiento) es la lección «[Pruebas de carga y benchmarks honestos](/pruebas-carga/)».

:::ojo
Las dos pruebas se hacen **en el hardware de verdad**, o en uno igual. Una prueba de carga en una GPU distinta a la que vas a comprar no dice nada de la que vas a comprar. Por eso el piloto renta el mismo modelo de GPU que se piensa comprar (una sola basta para medir cuántas atiende cada una), y la prueba se repite cuando llega el equipo propio.
:::

## Operación: el día 2 {Operations: day 2}

El día 1 se instala. El [[operacion|día 2]] son todos los demás, y suele costar más horas que la instalación. La operación responde: ¿cómo sigue funcionando mañana, el mes que entra y dentro de un año?

**Monitoreo.** Medir todo el tiempo lo que el criterio promete: [[ttft|tiempo al primer token]], velocidad, errores, cuántas conversaciones hay a la vez, memoria y temperatura de la GPU. Y algo que la máquina no mide sola: si las respuestas siguen siendo buenas (por ejemplo, un botón de «esta cita está mal» que los abogados aprieten). Lección: «[Observabilidad de GPUs e inferencia](/observabilidad/)».

**Actualizaciones.** Del modelo (sale Qwen nuevo), del servidor de inferencia (versión nueva, a veces con valores por omisión distintos), de los drivers y del sistema. Cada una se prueba primero contra el examen de 200 preguntas y la [[prueba-de-carga|prueba de carga]]: esa es la flecha de regreso a evals del diagrama. Lección: «[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)».

**Respaldos.** De lo que costaría rehacer: el índice de búsqueda de los expedientes, la configuración del servidor, el archivo exacto del modelo que pasó el examen (con su huella, un código corto que cambia si cambia un solo byte del archivo, para saber que es el mismo), el examen y los registros de quién preguntó qué, que en un despacho pueden importar.

**Quién atiende cuando falla.** El TI del despacho son 2 personas que saben de redes y Windows y nunca han operado una GPU. No es un defecto: es un dato del diseño. Pide tres cosas:

- **Un manual** con los casos comunes: el servidor no arranca, la GPU se llenó, todo va lento. Paso por paso, para alguien que no es experto.
- **Capacitación** antes de entregar, no después del primer incidente.
- **Alguien a quién llamar**: un contrato de soporte con quien instaló, con tiempos de respuesta por escrito. Cómo se cotiza y se promete eso es la lección «[Cotizar, proponer y dar soporte](/cotizar/)».

¿Y qué pasa mientras está caído? Que los abogados trabajen como antes de tener el sistema. Lo que no puede pasar es que, por la prisa, regresen a pegar contratos en un chatbot público: el plan de operación debe decirlo.

## La prueba piloto {The pilot} [extra]

La [[prueba-piloto|prueba piloto]] es una prueba corta, con fecha de fin, usuarios reales y datos reales, para decidir con números si el proyecto sigue y qué se compra. El del despacho dura **8 semanas** con un grupo de **20 abogados**. El calendario es un ejemplo, un supuesto razonable para un caso así; cada proyecto arma el suyo.

| Semana | Qué pasa | Entregable |
|---|---|---|
| 1 | Cerrar descubrimiento, elegir a los 20 abogados, acordar con el abogado del despacho qué documentos entran al piloto | Hoja de descubrimiento y criterio de aceptación firmados |
| 2 | Rentar la L40S, levantar el servidor y el primer [[rag\|RAG]] con una parte de los expedientes | El sistema contestando, todavía sin evaluar |
| 3 | Los abogados escriben las 200 preguntas con su respuesta y su cita; se evalúan los candidatos | Tabla de calidad por modelo |
| 4 | [[prueba-de-carga\|Prueba de carga]] con 8 a la vez; ajustar el servidor | [[ttft\|TTFT]] p95 y tokens/s medidos |
| 5–6 | Los 20 abogados lo usan en su trabajo diario; se registran quejas y preguntas reales | Preguntas por persona y tokens reales, medidos |
| 7 | Rehacer el sizing con lo medido; cotizar el equipo | Informe: ¿pasa el criterio?, sizing final, cotización con fecha de entrega |
| 8 | Decisión del despacho | Seguir y comprar, regresar o detener |

La GPU se renta de la semana 2 a la 7: **6 semanas**. El piloto se corre en una sola L40S rentada, aunque la operación completa pida 3: 20 abogados con el mismo uso son 20 × 15 ÷ 10 × 2.5 ÷ 3,600 × 27 ≈ 0.56 conversaciones a la vez, y lo que se mide es cuántas atiende bien cada GPU. En la misma GPU rentada se prueban las salidas que dejó abierta la vuelta del sizing, como pasar menos fragmentos por pregunta, y se ve si la calidad aguanta. ¿Cuánto cuesta? Depende de si se deja prendida todo el tiempo o solo en horario de oficina.

:::formula El costo de rentar la GPU del piloto
C = H × p
- H: las horas que la GPU está rentada (prendida)
- p: el precio por hora de la GPU, en US$
- C: el costo, en US$, sin el disco ni la red, que se cobran aparte
:::

:::cuenta Una L40S rentada 6 semanas
Precio por hora, \(p\) // AWS g6e.xlarge, 1 L40S, us-east-1, on-demand (por hora, sin compromiso de plazo): US$1.861 (archivo de GPUs de la app, consultado el 2026-11-13, precio oficial de AWS) | 1.861 | US$1.861
Prendida todo el tiempo, \(H\) // 6 semanas × 168 horas | 6 × 168 | 1,008 h
Costo, \(C\) | 1,008 × 1.861 | **≈ US$1,876**
Solo en horario de oficina // 10 h × 5 días × 6 semanas = 300 h | 300 × 1.861 | **≈ US$558**
En una neocloud, todo el tiempo // RunPod Secure Cloud, US$1.09 por hora (misma fecha y archivo, página oficial de RunPod) | 1,008 × 1.09 | ≈ US$1,099
En la neocloud, solo en horario // las mismas 300 h | 300 × 1.09 | ≈ US$327
= Entre ≈ US$330 y ≈ US$1,900 de GPU para decidir con datos una compra mucho mayor. Los precios cambian: a noviembre de 2026 son estos; revísalos el día que cotices.
:::

Una *neocloud* es un proveedor que renta casi solo GPUs, más baratas por hora que en las nubes grandes y con menos servicios alrededor; lo viste en [Qué es la nube](https://sensei.trueml.app/nube/).

Dos letras chicas. Primero, `us-east-1` es Virginia, en Estados Unidos: el piloto ahí manda documentos fuera de México, y eso entra en la plática con el abogado de la sección «Compra». Segundo, apagar la GPU fuera de horario ahorra, pero alguien tiene que prenderla cada mañana (o un programa que lo haga), y una instancia apagada puede seguir cobrando su disco. La diferencia entre la hora facturada y la hora trabajando la viste en «Máquinas, GPUs y cómo se cobran».

:::profundo Lo que el piloto mide y la servilleta adivinó
El valor más grande del piloto no es la calificación: es reemplazar supuestos por mediciones. En la servilleta, 15 preguntas por persona, un pico de 2.5, 6,000 tokens de entrada y 500 de salida eran estimaciones de una reunión. En las semanas 5 y 6 se miden con 20 abogados reales. Si salen 25 preguntas por persona, el sizing pasa de 8 a 14 conversaciones de diseño (⌈200 × 25 ÷ 10 × 2.5 ÷ 3,600 × 27 × 1.4⌉ = ⌈13.1⌉ = 14), y ni siquiera por memoria caben en una L40S con 8,192 tokens cada una: caben 10. Mejor saberlo en la semana 7 que con el servidor ya instalado.
:::

## Por qué fracasan los proyectos {Why projects fail} [extra]

Se repite mucho que «el 95 % de los proyectos de IA fracasa». Vale la pena leer de dónde sale, porque lo que dice de verdad es más útil que el titular.

### Lo que mide el 95 % del MIT

Sale del informe *The GenAI Divide: State of AI in Business 2025*, de MIT NANDA (agosto de 2025). Su resumen dice que el 95 % de las organizaciones obtiene cero retorno de su inversión en IA generativa. La letra chica:

- **Qué mide.** El 5 % de éxito es de herramientas de IA generativa **a la medida**, específicas de una tarea, que llegan a una «implementación exitosa»: un efecto marcado y sostenido en productividad o en las finanzas, según los propios ejecutivos. Los LLM de propósito general, como un chatbot genérico, pasaron de piloto a implementación mucho más (≈ 83 % en el informe).
- **Con qué muestra.** Revisó más de 300 iniciativas públicas, entrevistó a 52 organizaciones y encuestó a 153 líderes en cuatro conferencias. (La prensa repitió otras cifras de muestra que no coinciden con el PDF.) El propio informe dice que sus resultados son direccionales, basados en entrevistas y no en reportes oficiales, y que la definición de éxito varía.
- **A qué lo atribuye.** No a la calidad de los modelos ni a la regulación, sino a lo que llama *learning gap*: sistemas que no retienen retroalimentación, no se adaptan y no se meten en cómo trabaja la gente.
- **Lo incómodo para este oficio.** En su muestra, las herramientas hechas con un proveedor externo llegaron a despliegue ≈ 67 % de las veces, contra ≈ 33 % de las construidas internamente. El informe advierte que es una correlación en una muestra chica, no una causa. Pero el mensaje para quien vende IA privada es claro: «hazlo tú solo» no es la ruta fácil.

### Lo que dice Gartner

Gartner **predijo** en julio de 2024 que al menos el 30 % de los proyectos de IA generativa se abandonarían después de la prueba de concepto para fines de 2025, por mala calidad de datos, controles de riesgo inadecuados, costos crecientes o valor de negocio poco claro. En junio de 2025 predijo que más del 40 % de los proyectos de IA agéntica (sistemas que toman acciones solos) se cancelarían para fines de 2027. Son predicciones, no mediciones: dicen qué espera una firma de análisis, no qué pasó.

### Los riesgos del despacho y cómo se mitigan

Juntando las causas de arriba con lo que sabes del despacho:

| Riesgo | Cómo se ve | Cómo se mitiga |
|---|---|---|
| Valor poco claro | «Queremos IA» sin tarea | Un caso de uso y un criterio de aceptación firmados en descubrimiento |
| Calidad en español legal | El modelo contesta bien en inglés y mal en contratos mexicanos | Examen de 200 preguntas del despacho; varios candidatos en el piloto |
| Citas inventadas | Una página que no dice eso | Límite propio en el criterio (≤ 2 %) y la cita siempre visible para revisar |
| Hardware equivocado | Se compra antes de medir | Rentar para el piloto; comprar con el sizing medido |
| Entrega tardía | El equipo llega meses después | Fecha por escrito; la GPU rentada sigue mientras |
| Nadie lo opera | TI no sabe de GPUs | Manual, capacitación y contrato de soporte desde el diseño |
| Nadie lo usa | Siguen con el chatbot público | Los 20 abogados del piloto lo usan en su trabajo y piden cambios; la herramienta interna tiene que ser más cómoda |
| Fuga por permisos | Un asistente ve un expediente que no le toca | La búsqueda respeta los permisos del despacho; se prueba en las evals |

:::diagrama recorrido-decisiones
Las puertas donde el proyecto se puede detener o regresar. Arriba, lo barato de cambiar; abajo, lo caro. Usa «Recorrer» para pasar por las puertas del despacho.
:::

Fíjate en dónde están las puertas: casi todas antes de la compra. Un proyecto que se detiene en la puerta 1 no fracasó; se ahorró el servidor.

## Errores comunes {Common mistakes}

1. **Empezar por el hardware.** «¿Qué GPU compro?» antes de saber la tarea, los usuarios y la latencia. **Cómo evitarlo:** no hables de GPUs hasta llenar la hoja de descubrimiento.
2. **Dimensionar con usuarios registrados.** Diseñar para 200 a la vez cuando son 8. Compras 25 veces de más, o te asustas y cancelas. **Cómo evitarlo:** de personas a llegadas por segundo en la hora pico, y de ahí, con la [[ley-de-little|Ley de Little]], a conversaciones a la vez.
3. **Un criterio de aceptación sin números, o escrito después.** «Que funcione bien» termina en opiniones; un 85 % fijado después de ver un 86 % no es un criterio. **Cómo evitarlo:** números firmados antes del piloto.
4. **Creer que «cabe» es «sirve».** La VRAM dice si arranca, no si contesta rápido ni si contesta bien. **Cómo evitarlo:** la [[prueba-de-carga|prueba de carga]] y el examen en el hardware de verdad.
5. **Comprar antes de probar.** Con tiempos de entrega de semanas o meses, un equipo equivocado cuesta dinero y tiempo. **Cómo evitarlo:** rentar para el piloto y comprar con lo medido.
6. **Olvidar que el piloto en la nube también mueve datos.** «Es solo una prueba» con expedientes reales en un servidor en otro país. **Cómo evitarlo:** decidir con el cliente y su abogado qué documentos entran al piloto y dónde.
7. **Entregar sin plan de día 2.** El sistema funciona el día de la entrega y nadie sabe qué hacer cuando sale un driver nuevo. **Cómo evitarlo:** manual, capacitación, respaldos y un contrato de soporte, desde el diseño.

## En la vida real {In real life}

### El despacho

Ya lo recorriste completo: 200 personas, 3,000 preguntas al día, ≈ 0.21 por segundo en la hora pico, 8 conversaciones de diseño, Qwen3 32B en INT4 de AWQ que por memoria cabe en una L40S (38.50 de 43.2 GB útiles) pero que, por cómputo y [[ancho-de-banda|ancho de banda]], pide 3 L40S y aun así no llega a 2 s al primer token, un piloto de 8 semanas con 20 abogados y un examen de 200 preguntas. Lo que lo hace un buen primer proyecto: una tarea frecuente y medible, un volumen de unas cuantas GPUs (no un centro de datos) y una restricción clara (nada sale de la red). Lo que lo hace difícil: un equipo de TI que nunca ha operado una GPU. Su caso completo, con el costo, viene en la sección de casos.

### Una clínica

[La clínica](/casos/clinica/) es un caso completo, con cuentas y decisiones. Aquí, la servilleta: una clínica con, digamos, 60 médicos (números supuestos para el ejemplo) que quieren resumir el expediente de un paciente antes de la consulta: 20 resúmenes al día cada uno, en 8 horas, con un pico de 3 veces el promedio en la mañana, y 20 s por resumen. Servilleta: 1,200 al día, 150 por hora, 450 en el pico, 0.125 por segundo, × 20 s = **2.5 conversaciones a la vez**. El hardware es más chico que el del despacho, pero las restricciones son más duras: los datos de salud son datos sensibles, con reglas más estrictas, y un error en un resumen puede pesar en una decisión médica. Su criterio de aceptación tendría un límite de errores mucho más bajo, y siempre con el médico revisando. Lo que es legal en su caso lo revisa su abogado.

### Una fábrica

[La fábrica](/casos/fabrica/) es un caso completo. Aquí, el descubrimiento: una fábrica con un asistente sobre sus manuales técnicos, usado en la planta. Aquí el descubrimiento encuentra otras restricciones: el servidor quizá no puede tener internet (la red de la planta está aislada), los manuales vienen escaneados (hay que sacarles el texto antes de buscar en ellos) y los usuarios trabajan por turnos, así que no hay una sola hora pico sino tres. El volumen puede ser bajo, y entonces la pregunta honesta de la sección «Cuándo NO conviene» aparece: ¿vale la pena una GPU para un uso de unas pocas preguntas por hora? A veces sí, si la red aislada no deja otra opción; a veces conviene una máquina mucho más chica.

### Fuera de la IA

El recorrido no es nuevo. Así se compra un sistema de nómina, se instala un conmutador o se construye una bodega: primero se pregunta qué se necesita, luego se calcula cuánto, se prueba en pequeño, se compra, se instala, se recibe contra lo prometido y se mantiene. Lo nuevo con la IA es que la pieza central (el modelo) cambia cada pocos meses y su calidad no se ve a simple vista: hay que medirla.

## Ejercicios {Exercises}

:::ejercicios
? [facil] El despacho crece a 300 personas, con todo lo demás igual (15 preguntas, 10 horas, pico de 2.5, 27 s por respuesta). ¿Cuántas llegadas por segundo hay en la hora pico y cuántas conversaciones a la vez en promedio?
- Preguntas al día: 300 × 15 = 4,500.
- Por hora: 4,500 ÷ 10 = 450; en el pico: 450 × 2.5 = 1,125.
- \(λ\) = 1,125 ÷ 3,600 ≈ **0.31 por segundo**.
- \(u\) = 0.3125 × 27 ≈ **8.4 a la vez**; con margen de 1.4, ⌈11.8⌉ = 12 de diseño. Ya ni por memoria caben en una L40S con 8,192 tokens cada una (caben 10). Y por velocidad, si cada L40S atiende bien ≈ 2, para las 8.4 del promedio harían falta ≈ 5 (8.4 ÷ 2 = 4.2, hacia arriba), en vez de las 3 de hoy.

? [facil] Ordena estas tareas en las seis etapas: a) medir el [[ttft|tiempo al primer token]] con 8 conversaciones; b) preguntar cuántas preguntas hace cada abogado al día; c) instalar el driver de NVIDIA; d) pedir la fecha de entrega por escrito; e) calcular las conversaciones a la vez; f) decidir quién contesta el teléfono cuando el servidor se cae.
b) descubrimiento · e) sizing · d) compra · c) despliegue · a) evals · f) operación.

? [facil] Una respuesta de 800 tokens, a 20 tokens por segundo, con 2 s al primer token. ¿Cuánto dura?
\(D = t_1 + s ÷ v\) = 2 + 800 ÷ 20 = 2 + 40 = **42 s**. Respuestas más largas ocupan su lugar en el servidor más tiempo: con todo lo demás igual, el despacho tendría 0.2083 × 42 ≈ 8.75 conversaciones a la vez en promedio.

? [facil] Un cliente propone este criterio de aceptación: «que el asistente responda bien y rápido». Reescríbelo para el despacho.
Necesita números, la muestra con que se mide y la carga: «Con un examen de 200 preguntas reales escritas por los abogados del despacho: ≥ 85 % bien contestadas y con la cita correcta (170 o más) y a lo más 2 % con una cita inventada (4 o menos). Con 8 conversaciones a la vez: primer token en ≤ 2 s en el p95 y ≥ 20 tokens/s por persona». Y se firma antes del piloto.

? [medio] El servidor resulta más rápido de lo planeado: escribe a 25 tokens/s, con el mismo 2 s al primer token. ¿Cuántas conversaciones a la vez tiene el despacho en promedio en su hora pico? ¿Por qué baja?
- \(D\) = 2 + 500 ÷ 25 = 2 + 20 = 22 s.
- \(u\) = 0.2083 × 22 ≈ **4.6**.
- Baja porque cada conversación termina antes y deja su lugar libre más pronto. La [[ley-de-little|Ley de Little]] lo dice: con las mismas llegadas, menos duración es menos gente adentro.

? [medio] Para ahorrar, alguien propone rentar la GPU del piloto en el Community Cloud de RunPod, a US$0.79 por hora (máquinas de terceros), solo en horario de oficina las 6 semanas. ¿Cuánto cuesta y qué objeción le harías?
- \(H\) = 10 h × 5 días × 6 semanas = 300 h; \(C\) = 300 × 0.79 = **US$237**, contra US$327 en Secure Cloud y US$558 en AWS por las mismas horas.
- La objeción: «máquinas de terceros» quiere decir que los documentos del piloto se procesan en computadoras de personas o empresas que no conoces. Para expedientes con secreto profesional y datos personales eso casi seguro no se vale; solo serviría con documentos públicos o sin datos personales, y lo decide el abogado del despacho. Ahorrar US$90 no compensa el riesgo.

? [medio] El despacho quiere conversaciones de 16,384 tokens en vez de 8,192, con las mismas 8 a la vez, en la misma L40S y con Qwen3 32B en INT4 de AWQ (256 KiB de KV cache por token). ¿Cabe?
- Por conversación: 262,144 bytes × 16,384 ≈ 4.29 GB.
- 8 conversaciones: ≈ 34.36 GB.
- Total: 19.32 + 34.36 + 2 ≈ **55.68 GB**, contra 43.2 útiles: **no cabe**, faltan ≈ 12.5 GB.
- Caben ⌊(43.2 − 19.32 − 2) ÷ 4.295⌋ = ⌊5.09⌋ = 5 conversaciones de ese tamaño. Opciones: acotar el contexto, una GPU más grande o dos. Es la puerta «no cabe: acotar».

? [medio] Una de las salidas de la vuelta a descubrimiento: pasar 3 fragmentos de expediente por pregunta en vez de 5. ¿Cuántos tokens de entrada quedan, cuánto tarda el [[prefill|prefill]] en la L40S con la fórmula de la sección «Sizing» y qué hay que medir antes de aceptarlo?
- Tokens de entrada: ≈ 400 de instrucciones + ≈ 100 de la pregunta + 3 × 1,000 = **3,500** (≈ 4,000 si se redondea hacia arriba, como los 6,000 de la ficha; entonces el prefill sube a ≈ 1.45 s).
- \(F\) = 2 × 32.76 × 10⁹ × 3,500 ≈ 2.29 × 10¹⁴ FLOPs.
- \(t_{prefill}\) = 2.29 × 10¹⁴ ÷ (0.5 × 362 × 10¹²) ≈ **1.27 s**: queda debajo de los 2 s del objetivo, con la GPU libre.
- Lo que hay que medir: si la calidad aguanta. Con menos fragmentos es más probable que la página correcta no llegue al modelo, y entonces no la puede citar. Se corre el examen de 200 preguntas con 3 fragmentos y se compara contra el criterio (≥ 85 %) antes de aceptar el cambio.

? [medio] La clínica de «En la vida real»: 60 médicos, 20 resúmenes al día cada uno, 8 horas, pico de 3 y 20 s por resumen. Haz la servilleta.
- \(Q\) = 60 × 20 = 1,200 al día; por hora, 1,200 ÷ 8 = 150; en el pico, 150 × 3 = 450.
- \(λ\) = 450 ÷ 3,600 = 0.125 por segundo.
- \(u\) = 0.125 × 20 = **2.5 a la vez**; con margen de 1.4, ⌈3.5⌉ = 4 de diseño.

? [reto] El despacho descubre en el piloto que su hora pico es más concentrada: el 30 % de las preguntas del día llega en una sola hora. ¿Cuál es el nuevo factor pico \(k\), cuántas conversaciones a la vez hay en promedio y cuántas de diseño con \(m\) = 1.4? ¿Siguen cabiendo por memoria en una L40S, y qué pasa con la velocidad?
- En la hora pico: 0.30 × 3,000 = 900 preguntas. El promedio por hora es 300, así que \(k\) = 900 ÷ 300 = **3**.
- \(λ\) = 900 ÷ 3,600 = 0.25 por segundo; \(u\) = 0.25 × 27 = **6.75**.
- De diseño: ⌈6.75 × 1.4⌉ = ⌈9.45⌉ = **10**.
- Por memoria, una L40S guarda hasta 10 conversaciones de 8,192 tokens: caben justo, sin margen. Pero por velocidad cada L40S atiende bien ≈ 2: con 6.75 a la vez en promedio harían falta ≈ 4 (6.75 ÷ 2, hacia arriba) en vez de 3. Lo confirma la [herramienta de sizing](/herramientas/sizing/) y, al final, la [[prueba-de-carga|prueba de carga]].

? [reto] El piloto termina: el modelo contesta bien el 78 % de las 200 preguntas, con 3 citas inventadas, y la prueba de carga pasa. ¿Pasa el criterio? ¿Qué harías, y qué no harías?
- No pasa: la calidad pide ≥ 85 % (170), y 78 % son 156. Las citas inventadas (3, ≤ 4) y la carga sí pasan.
- Lo que harías: averiguar dónde falla. Si en muchas de las 44 malas la búsqueda no trajo el fragmento correcto, el problema es la aplicación, no el modelo. Si lo trajo y el modelo contestó mal, toca probar otro candidato (por ejemplo Llama 3.3 70B), que pide más memoria y obliga a rehacer el sizing: la puerta «no pasa» del diagrama. Todo eso, todavía en la GPU rentada.
- Lo que no harías: bajar el criterio a 75 % para que pase, ni comprar el equipo «y luego lo mejoramos». El criterio se firmó antes justo para este momento.

? [reto] Con 3,000 respuestas de 27 s al día y 8 lugares a la vez durante las 10 horas de uso, ¿qué parte de la capacidad del servidor se usa en el día? ¿Qué te dice eso sobre el despacho y sobre una oficina de 15 personas?
- Trabajo del día: 3,000 × 27 s = 81,000 segundos de conversación.
- Capacidad en horario: 10 h × 3,600 s × 8 lugares = 288,000 segundos-lugar.
- Uso: 81,000 ÷ 288,000 ≈ **28 %**. El resto se paga sin trabajo (en 24 horas, ≈ 12 %).
- Es normal: se diseña para la hora pico, no para el promedio. Para el despacho puede tener sentido usar la noche para otra tarea, como resumir expedientes en lote. Para una oficina de 15 personas, con ≈ 0.42 conversaciones a la vez en su pico, el servidor pasaría casi todo el día ocioso: es la señal de «volumen bajo, quizá no conviene».
:::

## Lo que sigue {What comes next}

Las lecciones de esta app, en orden, y qué toma cada una de esta:

- **«[Open weight, open source y licencias](/licencias/)»**: qué se puede usar y bajo qué condiciones; la licencia [[apache-2|Apache 2.0]] de Qwen3 32B, y por qué la licencia es parte del descubrimiento (restricciones).
- **«[Elegir un modelo para la tarea](/elegir-modelo/)»**: cómo se escogen los cuatro candidatos del despacho y por qué los [[benchmark|benchmarks]] públicos no reemplazan el examen de 200 preguntas.
- **«[Batching continuo y PagedAttention](/batching/)»**: cómo el servidor de inferencia (capa 3) atiende 8 conversaciones a la vez en una GPU.
- **«[Concurrencia: la curva de usuarios contra latencia](/concurrencia/)»**: el [[ttft|TTFT]], la velocidad, la [[ley-de-little|Ley de Little]] y el margen \(m\) de la servilleta, hechos con cuidado.
- **«[Formatos de cuantización en la práctica](/formatos-cuantizacion/)»** y **«[Speculative decoding y contexto largo](/speculative/)»**: de dónde salen los 19.32 GB del INT4 de AWQ y cómo se estira el contexto.
- **«[Comprar hardware: de la workstation al rack](/comprar-hardware/)»** y **«[El cuarto: energía, enfriamiento y red](/el-cuarto/)»**: la etapa de compra y la capa 1.
- **«[De requisitos a hardware](/requisitos-hardware/)»** y **«[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)»**: el sizing a fondo, más allá de la servilleta.
- **«[Del laptop al servidor](/stack-serving/)»** y **«[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)»**: las capas 3 y 4 del despliegue.
- **«[RAG privado: embeddings y vector DB locales](/rag-privado/)»** y **«[Agentes, tools y guardrails](/agentes/)»**: la capa 5, donde se gana la calidad.
- **«[Demostrar que el modelo abierto sirve](/evals/)»** y **«[Pruebas de carga y benchmarks honestos](/pruebas-carga/)»**: las dos mitades de las evals.
- **«[Observabilidad de GPUs e inferencia](/observabilidad/)»** y **«[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)»**: el día 2.
- **«[TCO: API, nube o servidor propio](/costo-total/)»** y **«[Cotizar, proponer y dar soporte](/cotizar/)»**: el costo de verdad y cómo se vende.

Las herramientas que acompañan el recorrido: [¿Cabe en la GPU?](/herramientas/vram/), [Qué tan rápido contesta](/herramientas/velocidad/), [Cuántas GPUs hacen falta](/herramientas/sizing/), [API, nube o servidor propio](/herramientas/tco/) y el [Catálogo de hardware](/herramientas/catalogo/) ya están listas.

De Sensei, si quieres repasar las bases: [El camino completo](https://sensei.trueml.app/camino-completo/), [Qué es la nube](https://sensei.trueml.app/nube/), [Datos personales y la ley](https://sensei.trueml.app/privacidad/) y [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/).

## Palabras que vas a oír {Words you will hear}

:::conceptos
descubrimiento caso-de-uso criterio-de-aceptacion sizing prueba-piloto soberania-de-datos shadow-ai stack-de-ia tiempo-de-entrega operacion
:::

## Chequeo {Check}

:::chequeo
? ¿Cuáles son las seis etapas, en orden?
Descubrimiento, sizing, compra, despliegue, evals y operación, con la vuelta de operación a evals en cada actualización.

? Por memoria caben 8 conversaciones en una L40S. ¿Por qué eso no basta?
Porque la memoria dice cuántas caben, no cuántas se atienden bien. El [[prefill|prefill]] de 6,000 tokens tarda ≈ 2.2–2.4 s (ya pasa los 2 s del objetivo) y con los prefills cada L40S mantiene solo 2 a ≥ 20 tokens/s: el sizing completo pide 3 L40S y aun así no cumple el [[ttft|tiempo al primer token]]. Toca regresar a descubrimiento.

? ¿Por qué el despacho diseña para 8 conversaciones y no para 200?
Porque 200 son las personas registradas, no las que escriben a la vez. En la hora pico llegan ≈ 0.21 preguntas por segundo y cada una dura ≈ 27 s: ≈ 5.6 a la vez en promedio, y 8 con margen.

? ¿Qué dos mitades tiene un criterio de aceptación?
La calidad (por ejemplo, ≥ 85 % de 200 preguntas reales bien y con cita) y el servicio (primer token ≤ 2 s en el p95 y ≥ 20 tokens/s con la carga de diseño). Las dos con números, firmadas antes del piloto.

? ¿Por qué se renta antes de comprar?
Porque el sizing es una estimación, en horas rentadas se prueban varios candidatos y equivocarse rentando cuesta una fracción de un servidor equivocado, que además puede tardar semanas o meses en llegar.

? ¿Qué problema tiene un piloto en una GPU de la nube para el despacho?
Los documentos del piloto salen de su red. Se decide antes, con su abogado, qué documentos entran y dónde se procesan.

? ¿Qué mide de verdad el «5 %» del informe de MIT NANDA?
Las herramientas de IA generativa a la medida que llegan a una implementación con efecto sostenido, en una muestra de 52 organizaciones entrevistadas, con resultados que el propio informe llama direccionales. No es «el 95 % de toda la IA fracasa».
:::
