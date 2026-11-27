---
titulo: Demostrar que el modelo abierto sirve
en: Proving the open model works
subtitulo: Cómo se arma el examen de un LLM con RAG, quién lo califica sin sacar nada de la red, cuánto se le cree con 200 preguntas y cómo se vuelve un candado que ningún cambio puede saltarse.
pregunta: El socio pregunta «¿cómo sé que este modelo que corre en nuestro cuarto es tan bueno como el chatbot que los abogados usaban a escondidas, y cómo sé que no se echó a perder cuando lo actualicen?». ¿Cómo se construye el examen, quién lo califica, cuánto se le cree con 200 preguntas, y cómo se vuelve un candado?
sensei: aprendio, ruido
dojo: evals
---

:::idea
Una [[eval]] de un LLM con [[rag|RAG]] no es un número: es un examen **por capas** (¿llegó la página?, ¿la respuesta es fiel?, ¿es correcta?, ¿la cita existe?), calificado con **código** donde se puede y con un [[llm-as-judge|LLM juez]] local, medido contra abogados, donde no. Con 200 preguntas el examen es ruidoso: sirve para descartar lo que falla y para detener cambios que pierden mucho, si se compara **pareado** contra lo que ya funciona y se leen las respuestas que cambiaron.
:::

## La pregunta del socio {The partner's question}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México con 200 personas y 30,000 expedientes, que quiere preguntarle a sus documentos con un LLM sin que un solo documento salga de su red. Corre **Qwen3 32B en INT4 de [[awq|AWQ]]**, con el razonamiento apagado, en **3 GPUs L40S** con [[vllm|vLLM]] 0.34.0, detrás de un [[gateway-de-llm|gateway]] (LiteLLM). Cada pregunta lleva ≈ 6,000 tokens de entrada (instrucciones, la pregunta y cinco [[chunk|fragmentos]] de expediente) y la respuesta ≈ 500. En la hora pico, los abogados ya usan ≈ 86.8 % de la capacidad de salida del servidor (6,250 de 7,200 tokens por minuto).

El criterio de calidad que el despacho firmó antes del piloto dice: con un examen de **200 preguntas reales** escritas por sus abogados, cada una con su respuesta y su cita, **≥ 85 % bien y con la cita correcta (170 o más)** y **a lo más 2 % con una cita inventada (4 o menos)**. La [[prueba-piloto|prueba piloto]] dura 8 semanas con 20 abogados, con una GPU rentada de la semana 2 a la 7; en la semana 3 los abogados escriben las preguntas.

El socio tiene dos dudas, y cada una es una mitad de esta lección:

- **¿Es tan bueno como el chatbot público?** ¿Cómo se arma un examen que mida lo que importa, y quién lo califica?
- **¿Cómo sé que no se echó a perder?** ¿Cuánto se le cree a 200 preguntas, y cómo se vuelve un candado?

Lo que ya sabes y aquí solo se recuerda:

- Un *golden set* es el examen fijo que se guarda y se aplica a cada versión; un gate compara contra el modelo actual con las mismas preguntas y con reglas escritas antes. Lo viste en [¿Aprendió de verdad?](https://sensei.trueml.app/aprendio/).
- Un porcentaje medido en una muestra tiene [[error-estandar|error estándar]] \(sqrt{p(1 − p) ÷ n}\); dos modelos con las mismas preguntas se comparan contando solo las que cambian. Lo viste en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/).
- Por qué 200 preguntas propias valen más que miles de un [[benchmark]] público, y que con 200 un 85 % trae ±4.9 puntos de ruido: [Elegir un modelo para la tarea](/elegir-modelo/). Cómo se compara el modelo cuantizado contra el original con los [[flips]]: [Formatos de cuantización en la práctica](/formatos-cuantizacion/).

Lo nuevo aquí: la respuesta es texto libre, no una etiqueta que se compara con `==`; el calificador también es un LLM que tiene que correr dentro de la red; y cada cambio de software puede mover las respuestas sin que nadie lo note.

:::diagrama evals-capas
Lo que se califica en cada paso de una pregunta del examen. Toca cada caja para ver por qué está ahí, o sigue los tres recorridos: una pregunta que sale bien, una donde la búsqueda no trajo la página y una de permisos.
:::

## Construir el golden set {Building the golden set}

El [[golden-set|golden set]] del despacho son 200 preguntas. La primera decisión es **de dónde salen**, y la respuesta es corta: de los abogados, no del modelo.

Pedirle a un LLM que escriba 1,000 preguntas sobre los expedientes sale barato, pero mide otra cosa: las preguntas que un modelo imagina, con respuestas que un modelo encuentra fácil. Los abogados preguntan con su jerga («¿hay litisconsorcio?»), con errores de dedo, por algo repartido en tres páginas. Un examen escrito por el modelo es un examen que el alumno se escribe a sí mismo.

:::profundo ¿Y minar los registros del gateway?
¿Y minar las preguntas reales que ya hacen? Es lo que recomienda la guía de evaluación de OpenAI (registrar todo y sacar casos de los registros). En el despacho choca con una decisión que ya se tomó: el registro del gateway guarda **una fila por pregunta sin el texto**, durante 90 días. No hay textos que minar. Crecer el examen con preguntas reales exigiría una decisión de privacidad aparte: una muestra voluntaria, con el consentimiento del abogado y sin datos que el cliente no autorice.
:::

### Estratificar: que no falte lo raro

Si se toman 200 preguntas al azar de lo que piden los abogados, casi todas serán del tipo más común («¿qué dice la cláusula X?»). Las que más importan para la confianza, como las que **no** tienen respuesta en los expedientes, casi no aparecerían. [[estratificar|Estratificar]] es decidir de antemano cuántas preguntas van de cada grupo. Esta es una propuesta para el despacho (supuesto del ejemplo, alineado con sus tres tareas):

| Estrato | Preguntas | Qué se mide | Por qué |
|---|---|---|---|
| Preguntar, con la respuesta en el expediente | 110 | correcta y con cita (documento y página) | la tarea 1, la primera que llega; se reparte por tipo de documento (contrato, demanda, sentencia, correo), por dificultad (una página, varias páginas, varios documentos) y por idioma (≈ 15 en inglés) |
| **Sin respuesta** | 30 | que diga «no lo encontré»; si contesta con una cita, cuenta como inventada (regla del examen: respalda algo que el expediente no dice) | mide si inventa cuando no sabe |
| **Permisos** | 20 | cero fugas | prueba que la búsqueda respete lo que cada persona puede ver |
| Resumir un expediente | 20 | rúbrica, con juez y una muestra a mano | la tarea 2 |
| Cláusulas parecidas | 20 | que traiga las páginas correctas | la tarea 3 |

:::figura evals-estratos
Las 200 preguntas de la propuesta, una por cuadrito. Más de la mitad es la tarea principal; las otras cuatro son chicas a propósito: cada una prueba una cosa distinta, y ninguna sostiene un porcentaje propio.
:::

Tres estratos piden explicación:

- **Las preguntas sin respuesta.** Un abogado pregunta por una cláusula que el contrato no tiene. La respuesta correcta es «no encontré eso en los expedientes que puedes ver». Sin ellas, el examen premiaría al que siempre contesta algo, con seguridad.
- **Las preguntas de permisos.** Cada pregunta del examen se hace **con la cuenta de alguien**. En estas 20, el documento que contesta existe, pero quien pregunta no lo puede ver (un pasante que pregunta por un expediente de otro equipo). Lo único que se revisa es que ningún [[chunk|fragmento]] de ese documento llegue al modelo. No es un porcentaje: es una regla que vale con una sola falla. La lección [RAG privado: embeddings y vector DB locales](/rag-privado/) explica cómo se pone esa [[muralla-etica|muralla]]; aquí se prueba.
- **Resumir y buscar cláusulas.** No tienen una sola respuesta correcta. Resumir se califica con una [[rubrica|rúbrica]] («¿menciona a las partes, el monto y el estado?»); buscar cláusulas, con la lista de páginas que un abogado marcó como correctas.

### Lo que lleva cada pregunta

Cada renglón del examen trae: la pregunta tal como la escribiría un abogado; **quién** la hace (su cuenta, para los permisos); la [[respuesta-de-referencia|respuesta de referencia]] que un abogado firmaría; la **cita esperada** (expediente y página, la «página de oro»); el estrato; y, si es de permisos, el documento que no debe aparecer. Escribir la referencia **sin** ayuda del modelo, salvo una corrección ligera, es la regla que siguen los benchmarks jurídicos serios: si el modelo ayuda a escribirla, el examen se vuelve un espejo.

:::profundo La página del índice, no la del papel
La cita esperada se escribe con el número de página **del documento indexado**, no del papel. Si el sistema parte un contrato escaneado y numera sus páginas distinto que el original, una cita correcta parecerá inventada. Se decide una vez, antes de escribir la primera pregunta.
:::

### Dos conjuntos: desarrollo y candado

Mientras se ajusta el sistema (el prompt, [[top-k|cuántos fragmentos se pasan]], cómo se parte cada documento), alguien va a mirar respuestas y corregir. Si mira las del examen, el examen deja de medir: el prompt termina diseñado para esas 200. Por eso se separan dos conjuntos:

- **Desarrollo:** unas 50 preguntas aparte (supuesto), escritas igual, que el equipo puede leer, usar como ejemplos y repetir cuantas veces quiera.
- **Candado:** las 200. Nunca van en el prompt, nunca como ejemplo (*few-shot*) y nunca en un ajuste fino. Se guardan con versión («examen v1, semana 3») y solo se miran sus resultados, no se ajusta contra ellos.

Es el mismo problema de [[contaminacion|contaminación]] que viste con los benchmarks públicos en [Elegir un modelo para la tarea](/elegir-modelo/), en chico: allá el examen se cuela al entrenamiento de un modelo; aquí se cuela al prompt de tu propio sistema.

## Lo que cuesta en horas de abogado {What it costs in lawyer hours} [extra]

El examen no es gratis: lo escriben personas cuyo tiempo se cobra caro. ¿Cuánto? No hay una cifra publicada para «escribir una pregunta sobre un expediente con su respuesta y su cita». Hay una del extremo alto: en un benchmark de investigación jurídica de 2026 (Legal Research Bench, 413 preguntas abiertas de derecho de Estados Unidos; un preprint, sin revisión de pares confirmada), cada pregunta con su respuesta de oro, sus fuentes y su rúbrica, revisada por otro abogado, costó **≈ 4 horas** de abogado. La tarea del despacho es más simple (encontrar y citar algo en sus propios expedientes), así que la cuenta usa supuestos más bajos.

:::formula Horas de abogado del examen
H = frac{N × (w + r)}{60}
- H: horas de abogado para escribir el examen, en horas
- N: preguntas del examen (200)
- w: minutos para escribir una pregunta con su referencia y su cita (supuesto)
- r: minutos para que otro abogado la revise (supuesto)
:::

:::cuenta El examen del despacho (supuestos centrales)
Preguntas, \(N\) // la ficha del despacho | — | 200
Escribir, \(w\) // supuesto: buscar la página, redactar, citar | — | 30 min
Revisar, \(r\) // supuesto: otro abogado la lee y confirma la cita | — | 10 min
Horas para escribir, \(H\) | 200 × (30 + 10) ÷ 60 | ≈ 133 h
Calibrar al juez // supuesto: 100 respuestas × 2 abogados × 5 min | 100 × 2 × 5 ÷ 60 | ≈ 17 h
Calificar a mano un sistema // supuesto: 200 respuestas × 5 min | 200 × 5 ÷ 60 | ≈ 17 h
Total | 133 + 17 + 17 | ≈ 167 h
Por abogado, si son 5 | 167 ÷ 5 | ≈ 33 h
= ≈ 167 horas de abogado, ≈ 33 por cabeza entre 5. Con el ritmo del benchmark jurídico (≈ 4 h por pregunta) serían 800 h solo para escribir.
:::

El rango con otros supuestos: de ≈ 67 h (15 + 5 minutos por pregunta) a ≈ 267 h (60 + 20, preguntas que cruzan varios documentos). La tarifa por hora la pone el despacho, no esta lección: a US$100 por hora (supuesto), 167 horas son ≈ US$16,700. Es casi nueve veces las seis semanas de GPU rentada del piloto (≈ US$1,876 prendida todo el tiempo, según [El recorrido](/recorrido/)). Vale la pena decirlo en la propuesta, porque es el costo que nadie presupuesta.

:::nota La tensión con «muchas preguntas baratas»
La guía de evaluación de Anthropic recomienda lo contrario: **más preguntas** con calificación automática de algo menos de calidad, antes que pocas calificadas a mano. Para muchos productos es lo correcto. El despacho elige 200 caras porque lo que mide (si una cita jurídica es correcta en sus expedientes) no se genera barato, y compensa con **código** donde se puede: las citas y el retrieval se califican solos.
:::

## Medir por capas {Measuring layer by layer}

«El sistema contestó mal» no dice qué arreglar. El examen califica cada pregunta en cuatro capas, en el orden en que pasan, porque cada una se arregla en otro lugar:

| Capa | Pregunta | Quién califica | Si falla, se arregla en |
|---|---|---|---|
| **Retrieval** | ¿la página de oro llegó entre los 5 [[chunk\|fragmentos]]? | código | la búsqueda: cómo se parte, qué [[modelo-de-embeddings\|modelo de embeddings]], [[top-k\|cuántos fragmentos]] |
| **Fidelidad** | ¿la respuesta dice solo lo que dicen los fragmentos? | juez | el prompt o el modelo |
| **Corrección** | ¿llega a lo mismo que la referencia? | juez (y una muestra a mano) | el modelo, el prompt |
| **Cita** | ¿el expediente y la página existen y contienen lo citado? | código | el formato de la cita, el prompt |

### Retrieval: antes de que el modelo escriba

Una [[metrica-de-retrieval|métrica de retrieval]] dice si la búsqueda hizo su trabajo. La más útil para el despacho es **recall@5**: de las preguntas con página de oro, ¿en qué fracción esa página quedó entre los 5 fragmentos que recibe el modelo? Se calcula con código: el examen sabe la página de oro y el sistema registra qué fragmentos mandó. Si el recall@5 saliera 92 % (supuesto), en el 8 % restante el modelo **no puede** contestar bien con cita, por bueno que sea: el techo del examen ya está en 92 %.

Esta capa separa los dos diagnósticos que pedía [El recorrido de un proyecto de IA privada](/recorrido/): «no encontró el fragmento» contra «lo encontró y contestó mal». En las preguntas de permisos, la misma capa revisa lo contrario: que **ningún** fragmento del documento prohibido haya llegado.

### Fidelidad: no agregar nada

La [[fidelidad]] (*faithfulness*) pregunta si la respuesta se sostiene **en los fragmentos**, no si es cierta. Son cosas distintas. Un modelo de 32B leyó mucho derecho mexicano en su entrenamiento: puede contestar algo cierto que no está en ningún fragmento, y eso en un despacho es un problema, porque la respuesta no se puede verificar en el expediente. RAGAS, una de las herramientas de la sección de herramientas, la define así a noviembre de 2026: afirmaciones de la respuesta que se pueden inferir del contexto recuperado, entre el total de afirmaciones. Un juez extrae las afirmaciones y revisa cada una.

### Corrección: contra la referencia

¿Llega a la misma conclusión que el abogado que escribió la referencia? Aquí no hay código que ayude: «No sin consentimiento previo y por escrito» y «La cláusula 14 exige que la otra parte autorice por escrito antes de ceder» dicen lo mismo con otras palabras. Lo califica un juez con rúbrica, y una muestra la califican abogados para saber si al juez se le puede creer (dos secciones más abajo).

:::profundo Una métrica que suena bien y engaña
Hay una métrica que suena bien y engaña: la **relevancia de la respuesta** (si la respuesta «atiende» la pregunta). En un benchmark jurídico de 2026 sobre derecho colombiano (un preprint), la relevancia correlacionó **−0.46** con la corrección (correlación de rangos): las respuestas sonaban pertinentes y a menudo estaban mal. Sirve para diagnosticar, no para aprobar.
:::

### La cita: con código, no con juez

La [[cita]] es lo único que el abogado va a revisar antes de confiar en la respuesta, y es lo que más daño hace si está mal. Por suerte, es lo más fácil de calificar sin juez: un programa busca el expediente, busca la página y confirma que el texto citado esté ahí. Si falla cualquiera de las tres, es una [[cita-inventada|cita inventada]]. Este es un revisor de juguete, con un índice diminuto en lugar de los 30,000 expedientes:

```python
import re

# Lo indexado: expediente -> página -> texto (un ejemplo diminuto)
indice = {
    "4127": {12: "Cláusula 14. Ninguna de las partes podrá ceder sus derechos sin consentimiento previo y por escrito.",
             13: "Cláusula 15. La pena convencional será del 10 % del valor del contrato."},
    "3310": {2: "El arrendatario pagará la renta los primeros cinco días de cada mes."},
}

def revisar(cita):
    m = re.fullmatch(r"exp\. (\d+), p\. (\d+): «(.+)»", cita)
    if not m:
        return "formato inválido"
    exp, pag, texto = m.group(1), int(m.group(2)), m.group(3)
    if exp not in indice:
        return "inventada: el expediente no existe"
    if pag not in indice[exp]:
        return "inventada: la página no existe"
    if texto.lower() not in indice[exp][pag].lower():
        return "inventada: la página no dice eso"
    return "correcta"

respuestas = [
    "exp. 4127, p. 12: «sin consentimiento previo y por escrito»",
    "exp. 4127, p. 13: «pena convencional será del 10 %»",
    "exp. 4127, p. 13: «pena convencional será del 20 %»",
    "exp. 4127, p. 40: «podrá rescindir»",
    "exp. 9999, p. 1: «cualquier cosa»",
    "ver el contrato de arrendamiento",
]
for r in respuestas:
    print(f"{revisar(r):38} <- {r}")
```

```salida
correcta                               <- exp. 4127, p. 12: «sin consentimiento previo y por escrito»
correcta                               <- exp. 4127, p. 13: «pena convencional será del 10 %»
inventada: la página no dice eso       <- exp. 4127, p. 13: «pena convencional será del 20 %»
inventada: la página no existe         <- exp. 4127, p. 40: «podrá rescindir»
inventada: el expediente no existe     <- exp. 9999, p. 1: «cualquier cosa»
formato inválido                       <- ver el contrato de arrendamiento
```

Para que esto funcione, el sistema cita **con un formato fijo** (el prompt lo pide; la [salida estructurada](/stack-serving/) lo puede forzar) y con texto literal. Si parafrasea, la última revisión ya no es un `in` y pasa al juez. Un detalle que decide el número: ¿«correcta» es que **la página** sea la de oro, o que la página citada **diga** lo que se afirma aunque sea otra? Una respuesta que cita la página 13 con un texto real y pertinente, cuando la de oro era la 12, no está inventada; puede estar bien. Se decide antes y se escribe.

:::ojo
Una respuesta puede traer varias citas. «2 % con cita inventada» del criterio cuenta **respuestas** (4 de 200), no citas. Si se contara por cita, con ≈ 3 citas por respuesta (supuesto) serían 4 de 600 (0.67 %) y sonaría mejor sin ser mejor, y las citas de una misma respuesta no son independientes (si confundió el expediente, fallan todas). Se escribe cuál es el denominador.
:::

## LLM como juez, con su rúbrica {LLM-as-a-judge, with its rubric}

Calificar 200 respuestas a mano son ≈ 17 horas de abogado por sistema (5 minutos por respuesta, supuesto), con cuatro candidatos en el piloto y una corrida por cada cambio. No alcanza. El [[llm-as-judge|LLM como juez]] (*LLM-as-a-judge*) es usar un LLM para calificar las respuestas de otro sistema, siguiendo instrucciones escritas.

El juez del despacho recibe, por cada pregunta: la pregunta, la respuesta de referencia, los 5 [[chunk|fragmentos]] que vio el sistema, la respuesta del sistema y la rúbrica. Devuelve un razonamiento corto y un veredicto. Un ejemplo de rúbrica (ilustrativo):

```text
Eres revisor del despacho. Califica la RESPUESTA contra la REFERENCIA y los FRAGMENTOS.
Contesta cada criterio con SÍ o NO y una línea de por qué, y al final VEREDICTO: BIEN o MAL.
1. ¿La RESPUESTA llega a la misma conclusión jurídica que la REFERENCIA?
2. ¿Todo lo que afirma la RESPUESTA está en los FRAGMENTOS? (si afirma algo que no está, NO)
3. Si la REFERENCIA dice que la respuesta no está en los expedientes, ¿la RESPUESTA lo dice también?
VEREDICTO: BIEN solo si 1, 2 y 3 son SÍ (o 3 no aplica).
```

Tres decisiones hay detrás de ese texto, y cada una sale de algo medido:

- **Con referencia.** Zheng y otros (2023), el estudio que hizo popular el método, probaron a GPT-4 calificando problemas de matemáticas: daba por buena una respuesta incorrecta en 14 de 20 casos con el prompt simple, 6 de 20 pidiéndole razonar antes, y **3 de 20** cuando recibía la respuesta correcta como referencia. El despacho tiene la referencia: se la da.
- **Criterios de sí o no, no «del 1 al 10».** Una revisión de 2026 sobre calificar respuestas jurídicas abiertas (un preprint) encontró que una [[rubrica|rúbrica]] escrita para la tarea es lo que más sube el acuerdo entre juez y humanos. Las guías de OpenAI y Anthropic piden lo mismo: criterios detallados, razonar antes del veredicto, pasa o no pasa.
- **Una respuesta a la vez, contra la referencia**, en vez de poner dos respuestas lado a lado y preguntar cuál es mejor. La razón es el primer sesgo de la lista.

### Los sesgos medidos

Un [[sesgo-del-juez|sesgo del juez]] es una preferencia que no tiene que ver con la calidad. Los tres más estudiados, con las cifras de Zheng y otros (2023). Ojo: los jueces de ese estudio son de **2023** (GPT-4, GPT-3.5 y Claude-v1); ninguna cifra aplica tal cual a Qwen3 32B, pero el método para medirlas sí.

**Posición.** Se le dieron a cada juez dos respuestas casi iguales, y luego las mismas en el orden contrario, en 80 casos. Un juez sin sesgo daría el mismo veredicto en los dos órdenes.

:::figura evals-posicion
El mismo par de respuestas, en los dos órdenes. Verde: el juez dio el mismo veredicto. Naranja: ganó la que iba primero, sin importar cuál era. GPT-4 fue el más consistente y aun así se dejó llevar por el orden en un tercio de los casos.
:::

:::profundo Qué más se midió del sesgo de posición
Un estudio de 2024 con 15 jueces y más de 150,000 evaluaciones confirmó que el sesgo de posición no es azar, cambia mucho de un juez y una tarea a otra, y crece cuando las dos respuestas se parecen en calidad. El remedio que proponen los autores de 2023: calificar en los dos órdenes y declarar ganador solo al que gana en los dos (si no, empate). Con un prompt de 3 ejemplos, GPT-4 subió de 65 % a 77.5 % de consistencia, pero el prompt más largo hizo cada llamada 4 veces más cara.
:::

**Verbosidad.** Se tomaron 23 respuestas con una lista numerada y se les antepuso la misma lista reformulada: más larga, sin información nueva. Claude-v1 y GPT-3.5 prefirieron la larga en **91.3 %** de los casos; GPT-4, en 8.7 %. Corregir el sesgo de largo en otro benchmark (AlpacaEval, 2024) subió la correlación de su ranking con el de Chatbot Arena, que sale de votos de personas, de 0.94 a 0.98.

**Auto-preferencia.** GPT-4 se dio un *win rate* (fracción de comparaciones ganadas) **10 %** mayor a sí mismo que el que le daban los humanos; Claude-v1, 25 % mayor. Los autores advierten que, con pocos datos y diferencias chicas, no pueden concluir que el sesgo exista. Un estudio de 2024 encontró que los jueces sí reconocen sus propios textos mejor que el azar, y que cuanto mejor se reconocen, más se favorecen. Para el despacho importa mucho: el candidato principal es Qwen3 32B, y el juez más cómodo también es Qwen3 32B.

:::analogia El revisor con la hoja de respuestas
Un juez con referencia y rúbrica se parece a un asistente que revisa exámenes con la hoja de respuestas del profesor: no tiene que saber la materia tan bien como el profesor, solo comparar. **Dónde se rompe:** un asistente humano no califica mejor la hoja que le das primero, no premia a quien escribió más, y si le das la misma hoja dos veces le pone lo mismo. Un LLM puede fallar en las tres cosas, y por eso se mide.
:::

:::profundo Ni siquiera es determinista
Un preprint de octubre de 2026 (sin revisión de pares todavía) corrió seis jueces de frontera diez veces sobre lo mismo con temperatura 0: los veredictos **cambiaron entre corridas idénticas**, e intercambiar el orden cambió la mayoría de los veredictos en las tareas difíciles. Y del lado del sistema que contesta, la documentación de vLLM dice que **no garantiza** resultados reproducibles por omisión: en modo servidor solo los logra con un modo especial (*batch invariance*) y con el mismo hardware y la misma versión. Consecuencia práctica: correr el mismo examen dos veces con la misma configuración puede dar 1 o 2 puntos distintos. Ese «piso de ruido» del despacho no se sabe de antemano; se mide en el piloto corriendo el examen dos veces sin cambiar nada.
:::

## Calibrar al juez: la kappa de Cohen {Calibrating the judge: Cohen's kappa}

Un juez sin calibrar es una opinión. Para saber si se le puede creer, dos abogados califican a mano una muestra de las mismas respuestas que calificó el juez, y se mide qué tanto concuerdan: el [[acuerdo-entre-jueces|acuerdo entre jueces]].

¿Por qué no basta el porcentaje de coincidencia? Porque dos calificadores que aprueban casi todo coinciden mucho por pura casualidad. Si la abogada aprueba 75 % y el juez aprueba 77 % lanzando monedas cargadas, coincidirían en ≈ 63 % de los casos sin mirar ninguna respuesta. La [[kappa-de-cohen|kappa de Cohen]] (Cohen, 1960) descuenta ese acuerdo de azar.

:::formula Kappa de Cohen
κ = frac{p_o − p_e}{1 − p_e}
p_e = a × j + (1 − a) × (1 − j)
- κ: acuerdo descontando el azar, sin unidad; 0 = lo que daría el azar, 1 = acuerdo perfecto
- p_o: fracción de respuestas donde la abogada y el juez dicen lo mismo
- p_e: fracción en que coincidirían por azar, cada uno calificando con sus propias proporciones
- a: fracción que la abogada califica «bien»
- j: fracción que el juez califica «bien»
:::

Un ejemplo con números del despacho (supuesto): una abogada y el juez califican las mismas 200 respuestas.

| | Juez: bien | Juez: mal |
|---|---|---|
| **Abogada: bien** | 140 | 10 |
| **Abogada: mal** | 14 | 36 |

:::cuenta La abogada contra el juez (supuesto del ejemplo)
Coinciden // la diagonal: 140 + 36 de 200 | (140 + 36) ÷ 200 | \(p_o\) = 0.880
La abogada aprueba, \(a\) // fila «bien»: 140 + 10 | 150 ÷ 200 | 0.750
El juez aprueba, \(j\) // columna «bien»: 140 + 14 | 154 ÷ 200 | 0.770
Acuerdo por azar, \(p_e\) | 0.750 × 0.770 + 0.250 × 0.230 | 0.635
Kappa, \(κ\) | (0.880 − 0.635) ÷ (1 − 0.635) | 0.671
Error estándar aproximado // \(sqrt{p_o(1 − p_o) ÷ n} ÷ (1 − p_e)\) | √(0.880 × 0.120 ÷ 200) ÷ 0.365 | 0.063
Intervalo del 95 % | 0.671 ± 1.96 × 0.063 | 0.55 a 0.79
= κ ≈ 0.67: «sustancial» en la escala de Landis y Koch. Pero el juez aprueba de más: de las 50 que la abogada reprueba, el juez solo reprueba 36 (72 %).
:::

:::profundo La kappa en Python
Lo mismo en Python, para que lo corras con tus propios números:

```python
# Una abogada y el juez califican las mismas 200 respuestas (datos simulados)
#                juez: bien  juez: mal
bb, bm = 140, 10   # abogada: bien
mb, mm = 14, 36    # abogada: mal
n = bb + bm + mb + mm

po = (bb + mm) / n                          # acuerdo observado
abogada_bien = (bb + bm) / n
juez_bien = (bb + mb) / n
pe = abogada_bien * juez_bien + (1 - abogada_bien) * (1 - juez_bien)   # acuerdo por azar
kappa = (po - pe) / (1 - pe)
se = (po * (1 - po) / (n * (1 - pe) ** 2)) ** 0.5

print(f"acuerdo observado p_o = {po:.3f}")
print(f"acuerdo por azar  p_e = {pe:.4f}")
print(f"kappa = {kappa:.3f}  (IC 95 %: {kappa - 1.96*se:.2f} a {kappa + 1.96*se:.2f})")
print(f"el juez aprueba {juez_bien:.0%}, la abogada {abogada_bien:.0%}")
print(f"de las que la abogada reprueba, el juez reprueba {mm/(mb+mm):.0%}")
```

```salida
acuerdo observado p_o = 0.880
acuerdo por azar  p_e = 0.6350
kappa = 0.671  (IC 95 %: 0.55 a 0.79)
el juez aprueba 77%, la abogada 75%
de las que la abogada reprueba, el juez reprueba 72%
```
:::

### Cómo leer la kappa sin engañarse

**La escala es una convención.** Landis y Koch (1977) llamaron 0.0–0.20 «leve», 0.21–0.40 «regular», 0.41–0.60 «moderado», 0.61–0.80 «sustancial» y 0.81–1.0 «casi perfecto». Otros piden más: Krippendorff (1980) propuso descartar conclusiones con menos de 0.67 (lo recuerda Hallgren, 2012), y McHugh (2012) advierte que un κ «sustancial» puede dejar mucho desacuerdo.

**El techo no es 1: es el acuerdo entre abogados.** Dos abogados tampoco coinciden siempre. En Legal Research Bench (2026), tres abogados calificaron 341 criterios de rúbrica y concordaron con la mayoría con **κ = 0.644**; tres jueces de frontera (modelos de nube de 2026) sacaron de 0.708 a 0.726: igualaron o pasaron a los humanos. Esos jueces no son abiertos: que un Qwen3 32B local llegue ahí no está medido. Por eso el despacho mide **también** el acuerdo entre sus dos abogados: si ellos sacan 0.65 entre sí, pedirle 0.85 al juez no tiene sentido.

:::profundo Acuerdo alto, kappa baja, y cuántas calibrar
**La paradoja de la prevalencia.** Cuando casi todas las respuestas están bien, κ baja aunque el acuerdo crudo sea altísimo. Con la tabla 186, 6, 6, 2 (supuesto: un sistema que acierta 96 %), el acuerdo es 94 % y κ = 0.22. Lo que dice ese κ bajo es real: el juez casi nunca atrapa las pocas respuestas malas (2 de 8). Por eso se reportan tres números juntos: κ, el acuerdo y qué fracción de las malas atrapa el juez.

**Cuántas respuestas calibrar.** El intervalo de κ depende de la muestra (con la misma proporción de la tabla de arriba): con 30 respuestas va de 0.29 a 0.97, es decir, no dice nada; con 50, de 0.43 a 0.92; con 100, de 0.50 a 0.85; con 200, de 0.55 a 0.79. Cien respuestas por dos abogados (≈ 17 horas) ya acotan «al menos moderado».

:::calculadora evals-kappa
Arranca con la tabla del texto. Prueba «Casi todo bien»: 94 % de acuerdo y κ de 0.22. Luego «Un juez que aprueba todo»: 75 % de acuerdo y κ exactamente 0, porque no aporta nada que no dé el azar.
:::
:::

:::profundo Usar al juez sin heredar su sesgo
Si el juez aprueba de más, el porcentaje que reporta está inflado. Con la muestra calibrada se puede corregir. La versión más simple es la corrección de Rogan-Gladen, que viene de la epidemiología (pruebas médicas imperfectas): si el juez aprueba la fracción \(S\) de las respuestas buenas y reprueba la fracción \(E\) de las malas, la tasa verdadera es \(p = (p_{juez} + E − 1) ÷ (S + E − 1)\). Con la tabla de arriba, \(S\) = 140 ÷ 150 = 0.933 y \(E\) = 36 ÷ 50 = 0.72; con \(p_{juez}\) = 0.77: (0.77 + 0.72 − 1) ÷ (0.933 + 0.72 − 1) = 0.75, la tasa de la abogada. En la práctica \(S\) y \(E\) salen de la muestra calibrada y \(p_{juez}\) de las demás preguntas, y su error se suma. La versión rigurosa es la *prediction-powered inference* (Angelopoulos y otros, 2023): combina muchas calificaciones del juez con pocas de personas y da intervalos válidos sin suponer nada del juez.
:::

## El dilema del juez privado {The private judge's dilemma}

El juez lee la pregunta, los [[chunk|fragmentos]] de expediente y la respuesta: **todo lo que el proyecto existe para no sacar de la red.** Mandar el examen a un juez de nube sería exactamente lo que hacían los abogados con el chatbot público, el [[shadow-ai|*shadow AI*]] que disparó el proyecto. El juez tiene que correr dentro. Las opciones:

| Juez | A favor | En contra |
|---|---|---|
| **El mismo Qwen3 32B**, en las mismas L40S | ya está cargado y servido; licencia Apache 2.0; cero piezas nuevas | se juzga a sí mismo: riesgo de auto-preferencia, no medido en Qwen |
| **Otro modelo abierto de otra familia** (Mistral Small 3.2 24B, Apache 2.0; o Llama 3.3 70B, con la licencia Llama 3.3) | evita la auto-preferencia | otro modelo en memoria: en una L40S ya van 38.5 de 43.2 GB útiles con Qwen3 32B y 8 conversaciones; correría de noche con el servidor cambiado de modelo, o en la cuarta ranura libre (ninguna probada) |
| **Uno más grande rentado** en el piloto | más capacidad de juicio | la GPU rentada del piloto está en `us-east-1` (Virginia): los fragmentos salen de México. Solo con documentos que el despacho autorice; y al terminar el piloto ya no existe |

Ojo con un camino por el que el juez sale de la red **sin que nadie lo decida**: varias herramientas de evals lo mandan a la nube por omisión. A noviembre de 2026, DeepEval usa un modelo de OpenAI si no se le configura otro, promptfoo elige al juez por las credenciales que encuentre en el entorno, y RAGAS, DeepEval y promptfoo traen telemetría prendida. En el despacho eso se configura antes de la primera corrida: el juez apunta al gateway local, la telemetría se apaga y la máquina del examen no tiene salida a internet. Los detalles, con los comandos, en la sección de herramientas.

Los jueces abiertos especializados (Prometheus) están estancados desde 2024 (sección extra del final): lo práctico es un modelo instruct generalista con rúbrica y referencia.

### Lo que cuesta en el servidor

El juez también gasta GPU. Cada llamada lleva ≈ 6,300 tokens de entrada (supuesto: la pregunta 100 + la referencia 300 + la respuesta 500 + los 5 fragmentos 5,000 + la rúbrica 400) y escribe ≈ 200 (razona corto y da veredicto). El servidor del despacho escribe 7,200 tokens por minuto (3 L40S × 2 conversaciones × 20 tokens/s × 60) y lee ≈ 453,800 por minuto (6,000 tokens de [[prefill]] tardan 2.38 s en una L40S: ≈ 2,520 por segundo por GPU, por 3 GPUs).

:::formula Minutos del servidor para el juez
t_{s} = frac{N × s}{C_{s}}
t_{e} = frac{N × e}{C_{e}}
t = de max(t_{s}, t_{e}) a t_{s} + t_{e}
- N: respuestas a calificar (200)
- e: tokens de entrada por llamada al juez
- s: tokens de salida por llamada al juez
- C_{s}: tokens de salida por minuto del servidor (7,200)
- C_{e}: tokens de entrada por minuto del servidor (≈ 453,800)
- t: minutos del servidor completo; el rango va de «escribir y leer se traslapan» (el máximo) a «uno espera al otro» (la suma)
:::

:::cuenta El juez del despacho, 200 respuestas
Entrada total // \(N × e\) = 200 × 6,300 (supuesto) | 200 × 6,300 | 1,260,000 tokens
Salida total // \(N × s\) = 200 × 200 (supuesto) | 200 × 200 | 40,000 tokens
Minutos escribiendo, \(t_{s}\) // \(C_{s}\) de la ficha | 40,000 ÷ 7,200 | 5.6 min
Minutos leyendo, \(t_{e}\) // \(C_{e}\) = 3 × 60 × 6,000 ÷ 2.38 | 1,260,000 ÷ 453,782 | 2.8 min
Minutos del servidor, \(t\) | de máx(5.6, 2.8) a 5.6 + 2.8 | 5.6 a 8.3 min
Contestar el examen // 200 × (6,000 de entrada, 500 de salida) | 100,000 ÷ 7,200 + 1,200,000 ÷ 453,782 | ≈ 16.5 min
= Examen completo + juez: ≈ 25 minutos del servidor entero. Poco, si no compite con nadie.
:::

Ese «si no compite con nadie» es la trampa. En la hora pico sobran 7,200 − 6,250 = **950 tokens de salida por minuto**: las 40,000 del juez tardarían ≈ 42 minutos peleándose con los abogados y subiéndoles el tiempo al primer token. Y si el examen corriera con la [[cuota-de-tokens|cuota]] de una persona (72 tokens de salida por minuto), el juez solo tardaría ≈ 9.3 horas. Por eso el examen corre **fuera de horario**, con una [[clave-de-api|clave de servicio]] con cuota propia en el gateway.

:::profundo Lo que cambia el costo del juez
Dos decisiones del juez cambian mucho el costo. Con el razonamiento de Qwen3 **encendido** (supuesto: ≈ 1,500 tokens de salida por llamada), el juez pasa a 42–44 minutos. Con tres votos independientes por respuesta (para medir qué tanto cambia el juez consigo mismo), a 17–25. Y el estilo de RAGAS (primero extraer afirmaciones, luego verificar cada una) cuesta ≈ 21–24 minutos. De noche, cualquiera cabe.
:::

:::nota La propuesta para el despacho
Juez del día a día: **el mismo Qwen3 32B**, con el razonamiento apagado, con referencia y rúbrica por criterios, corriendo de noche con su propia clave. Antes de creerle: la muestra de 100 respuestas calificada por dos abogados en el piloto, con κ entre los abogados y κ del juez contra ellos. En la misma GPU rentada del piloto, y con los mismos documentos que el despacho ya autorizó para el piloto, se califica esa muestra también con **un juez de otra familia** (Mistral Small 3.2 24B): si Qwen como juez se aleja de los abogados más que Mistral, o si su κ queda debajo del de los abogados entre sí por más de ≈ 0.1 (un umbral nuestro, no publicado), se cambia de juez. Y cuando se compare Qwen contra otro candidato, el juez **no** es ninguno de los dos.
:::

## Las herramientas, y la nube que traen escondida {The tools, and the cloud they hide} [extra]

No hace falta escribir todo desde cero. Hay herramientas abiertas que corren un examen, llaman al juez y calculan métricas. Todas pueden hablarle a un modelo local por la [[api-compatible-openai|API compatible con OpenAI]] del gateway. El problema es lo que hacen **si no se les dice nada**. A noviembre de 2026:

| Herramienta | Versión y fecha | Licencia | Para qué sirve | Lo que hace por omisión |
|---|---|---|---|---|
| RAGAS | 0.4.4, 14-nov-2026 | Apache 2.0 | métricas de [[rag\|RAG]]: fidelidad, precisión y recall del contexto, relevancia | sus ejemplos crean el juez con un cliente de OpenAI; **telemetría prendida** |
| DeepEval | 4.3.6, 25-nov-2026 | Apache 2.0 | métricas de RAG y G-Eval, con modelo local documentado (su página de integración se llama «vLLM») | si no se configura juez, usa **un modelo GPT de OpenAI**; telemetría prendida (incluye la IP pública) |
| promptfoo | 0.126.0, 18-nov-2026 | MIT | aserciones (`llm-rubric`, `context-faithfulness`…) y pruebas en integración continua (CI: correr las pruebas solas en cada cambio) | el juez **se elige por las credenciales que haya en el entorno**; telemetría prendida; desde 2026 su README dice que forma parte de OpenAI (sigue siendo MIT) |
| lm-evaluation-harness | 0.4.13, 31-ago-2026 | MIT | benchmarks públicos (MMLU y otros), no RAG con citas | corre contra un servidor local con `local-completions` |
| Inspect AI | 0.3.292, 23-nov-2026 | MIT | evals con calificadores por modelo (`model_graded_qa`), varios jueces que votan, `stderr()` | proveedores propios para vLLM, Ollama y SGLang |

Tres de las cinco **asumen nube** si no se configuran, y las tres traen [[telemetria|telemetría]] activa: datos de uso que el programa manda solo a sus autores. En el despacho eso es un riesgo doble. Primero, el juez: una sola corrida con una variable `OPENAI_API_KEY` olvidada en la máquina de alguien de TI manda 200 respuestas con [[chunk|fragmentos]] de expediente a un servidor en Estados Unidos, sin que nadie lo decida. Segundo, la telemetría: aunque no mande textos, es un canal de salida que nadie autorizó.

El remedio tiene dos partes, y las dos van en la configuración, no en la buena voluntad:

```bash
# Ilustrativo: el entorno de la máquina que corre el examen
export RAGAS_DO_NOT_TRACK=true
export DEEPEVAL_TELEMETRY_OPT_OUT=1
export PROMPTFOO_DISABLE_TELEMETRY=1
export PROMPTFOO_DISABLE_UPDATE=1
unset OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY   # que no haya a dónde caer (no son todas: ver abajo)

# DeepEval: el juez es el gateway del despacho
deepeval set-local-model --model=chat-grande --base-url="http://gateway.despacho.local/v1/"
```

:::profundo La trampa de promptfoo
En promptfoo, que el sistema bajo prueba apunte al gateway **no** configura al juez: el juez de `llm-rubric` se fija aparte, en `defaultTest.options.provider` (o con `--grader`). Si no se fija, lo elige por las credenciales que encuentre (su documentación nombra OpenAI, Anthropic, Gemini, Mistral, Azure OpenAI y un inicio de sesión de Codex): borrar tres variables no basta; lo que protege es fijar al juez. Es la trampa más fina de la tabla:

```yaml
# Ilustrativo (promptfoo 0.126.0): sistema bajo prueba y juez, los dos dentro de la red
providers:
  - id: openai:chat:chat-grande
    config:
      apiBaseUrl: http://gateway.despacho.local/v1
      apiKeyEnvar: CLAVE_EXAMEN
defaultTest:
  options:
    provider:
      id: openai:chat:chat-grande
      config:
        apiBaseUrl: http://gateway.despacho.local/v1
        apiKeyEnvar: CLAVE_EXAMEN
```
:::

Y la segunda parte, la que no depende de leer bien cada documentación: el servidor que corre el examen **no tiene salida a internet**. Si una variable se olvida, la llamada falla en vez de salir. Cómo se cierran esas puertas es tema de la lección «[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)».

:::ojo No está probado de punta a punta
Que DeepEval y promptfoo hablen con un modelo local está documentado; que RAGAS lo haga contra el gateway con un cliente de OpenAI apuntando a otra dirección lo permite su documentación, pero no lo vimos correr. Las tres usan prompts de juez en inglés: cómo califican español jurídico no está medido. Por eso la calibración contra abogados no es opcional, y una herramienta se adopta después de correrla en el piloto.
:::

Una que no sirve para el despacho: **OpenAI Evals** no tiene versiones publicadas, pide `OPENAI_API_KEY` y manda a correr las evaluaciones en el tablero de OpenAI. Es nube con código abierto.

## Cuánto se le cree a 200 preguntas {How much 200 questions are worth}

El sistema saca 170 de 200. Pasa el criterio. ¿Demuestra que es de 85 %? No, y la razón está en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/): 200 preguntas son una muestra de todas las que harán los abogados, y otra muestra de 200 daría otro número. El [[error-estandar|error estándar]] de 85 % con 200 preguntas es \(sqrt{0.85 × 0.15 ÷ 200}\) = 2.52 puntos.

### Wilson en vez de «± 1.96 SE»

El intervalo de la escuela, \(p ± 1.96 × SE\) (el de Wald), se porta mal cuando el porcentaje está cerca de 0 o de 100 %, o hay pocas fallas: una revisión clásica (Brown, Cai y DasGupta, 2001) lo llama «no confiable» y recomienda el de Wilson (o el de Jeffreys) para muestras chicas. Para 85 % casi no cambia; para las citas inventadas, cambia todo.

:::formula Intervalo de Wilson del 95 %
c = frac{p + z^2 ÷ (2n)}{1 + z^2 ÷ n}
m = frac{z × sqrt{p(1 − p) ÷ n + z^2 ÷ (4n^2)}}{1 + z^2 ÷ n}
intervalo = c − m a c + m
- p: la proporción observada (aciertos ÷ preguntas)
- n: preguntas del examen
- z: 1.96 para el 95 %
- c: el centro del intervalo, corrido un poco hacia 50 %
- m: el medio ancho del intervalo
:::

:::cuenta 170 de 200, con Wilson
Proporción, \(p\) // el criterio del despacho | 170 ÷ 200 | 0.850
\(z^2\) | 1.96² | 3.8416
Centro, \(c\) | (0.850 + 3.8416 ÷ 400) ÷ (1 + 3.8416 ÷ 200) | 0.8434
Medio ancho, \(m\) | 1.96 × √(0.85 × 0.15 ÷ 200 + 3.8416 ÷ 160,000) ÷ 1.0192 | 0.0495
Intervalo | 0.8434 ± 0.0495 | 79.4 % a 89.3 %
= Con 170 de 200, el valor verdadero puede estar en cualquier lugar entre ≈ 79 % y ≈ 89 %: 170 no demuestra 85 %.
:::

### El primer hallazgo: el criterio, tal como está escrito, no demuestra nada

El criterio firmado dice «≥ 85 % de las 200». Un sistema cuyo nivel verdadero es 80 % puede sacar 170 por suerte; uno de 88 % puede sacar 168 por mala suerte. ¿Qué número observado sí convence? El que deja aun el **límite de abajo** del intervalo por encima de 85 %:

- con la cota exacta de una cola del 95 % (Clopper-Pearson), hay que observar **179 de 200 (89.5 %)**;
- con Wilson de dos colas, **180 de 200 (90 %)**.

Esto no cambia el criterio del despacho: lo firmado es lo firmado. Pero obliga a escribir **qué significa**. Hay dos lecturas, y las dos son defendibles:

- **«El observado llega a 170»**: la regla es fácil de explicar y protege contra sistemas claramente malos. Acepta que un sistema de 82 % verdadero pase de vez en cuando.
- **«Estamos seguros al 95 % de que el verdadero es ≥ 85 %»**: exige observar 179–180. Protege mejor, y rechazará sistemas buenos de 86–88 % que no alcanzan a demostrarlo con 200.

Una salida honesta: firmar la primera como **criterio de aceptación** y la segunda como **meta**, y decir en voz alta que un 170–178 es «pasa, sin margen».

Falta una pregunta que el criterio tampoco contesta: **¿el 85 % es sobre las 200, o sobre las preguntas que tienen respuesta?** Con la propuesta de estratos, 30 son sin respuesta y 20 de permisos. Si el denominador es 200, «bien» en una sin respuesta es decir «no lo encontré», y «bien» en una de permisos es no filtrar nada y decir que no hay. Si fueran solo las 150 que se contestan (las 110, más resumir y cláusulas), el error estándar sube a \(sqrt{0.85 × 0.15 ÷ 150}\) = 2.9 puntos. La propuesta de esta lección: el denominador son **las 200**, con las de permisos como regla aparte de cero fugas (si filtró, el examen no pasa aunque el porcentaje sí).

:::profundo Los estratos, uno por uno
Con estratos de 20 o 30 preguntas, su porcentaje no se sostiene: 26 de 30 bien (86.7 %) tiene un intervalo de Wilson de 70.3 % a 94.7 %, de más de 24 puntos; 17 de 20 (85 %), de 64.0 % a 94.8 %. Un estrato chico sirve para dos cosas: leer sus errores (si 8 de las 15 en inglés fallan, eso se ve sin estadística) y reglas de cero fallas. No para decir «en resúmenes sacamos 85 %».
:::

### El segundo hallazgo: 4 de 200 citas inventadas es puro ruido

El criterio dice «a lo más 2 %, 4 o menos». Con tan pocos eventos, el ruido es enorme:

- 4 de 200 es 2.0 % observado, con un intervalo de Wilson de **0.78 % a 5.03 %** (el exacto de Clopper-Pearson, de 0.55 % a 5.04 %). El de Wald da 0.06 % a 3.94 %, que es justo el caso donde falla.
- Un sistema que en verdad inventa **3 %** de las citas, por encima del tope, sacaría 4 o menos **28 %** de las veces. Uno de 4 %, 9.5 % de las veces. Y uno bueno, de 1 %, reprobaría por mala suerte 5 % de las veces.

:::figura evals-citas
Qué tan seguido pasa el criterio «4 o menos de 200» un sistema, según cuántas citas inventa de verdad. A la izquierda del tope (verde) debería pasar siempre; a la derecha (naranja), nunca. Pasa de más a la derecha y reprueba de más a la izquierda: con 200 preguntas, el criterio no separa bien.
:::

¿Cuántas preguntas harían falta para **demostrar** «≤ 2 %» con 95 % de confianza? Depende de cuántas citas inventadas aparezcan: con 0, bastan **149** preguntas; con 1, 236; con 2, 313; con 4, **456**. Con 200 preguntas solo se demuestra si sale **0**: la cota exacta con 0 de 200 es 1.49 % (la «regla de tres», 3 ÷ 200 = 1.5 %, da casi lo mismo).

La forma de leerlo, como propuesta para el despacho: el «≤ 4» se queda como criterio, y se agrega que **cada cita inventada se lee** y se clasifica (¿página mal numerada?, ¿expediente equivocado?, ¿texto que no existe?). El número que de verdad da confianza es 0 o 1; si salen 3 o 4, el sistema pasa pero no se sabe si está bajo el tope. Y la mejor defensa no es estadística: es que la cita se verifica con código **también en producción**, antes de mostrarla al abogado. Una cita que no pasa la revisión se marca o no se muestra.

:::calculadora evals-examen
Empieza con el criterio del despacho: 170 bien y 4 inventadas pasan como está escrito y no demuestran ninguna de las dos cosas. Prueba «El número que sí convence» (180 y 0) y luego «Con más preguntas»: con 400 y los mismos porcentajes, todavía no basta.
:::

## La prueba pareada: McNemar y bootstrap {The paired test: McNemar and bootstrap}

La segunda duda del socio es comparar: Qwen3 32B contra Llama 3.3 70B en el piloto, la versión de hoy contra la de mañana. Si se comparan dos porcentajes de 200 como si fueran exámenes independientes, la diferencia tiene que ser de **≈ 7 puntos** para distinguirse del azar (10 si además se quiere 80 % de probabilidad de detectarla). Casi nada se distingue.

Pero no son independientes: son **las mismas** 200 preguntas. La [[prueba-pareada|prueba pareada]] usa eso. Por cada pregunta hay cuatro casos: aciertan los dos (\(a\)), solo A (\(b\)), solo B (\(c\)), ninguno (\(d\)). Las \(a\) y las \(d\) no dicen nada de cuál es mejor. Solo cuentan las **discrepancias**, \(b\) y \(c\). Esto ya lo viste en Sensei y en [Formatos de cuantización en la práctica](/formatos-cuantizacion/), con su aproximación normal; aquí van las versiones que se usan de verdad cuando hay pocas discrepancias.

:::formula Prueba de McNemar
χ^2 = frac{(|b − c| − 1)^2}{b + c}
Δ = frac{c − b}{N}
SE_{Δ} = frac{sqrt{b + c − (b − c)^2 ÷ N}}{N}
- b: preguntas que solo el sistema A contesta bien
- c: preguntas que solo el sistema B contesta bien
- N: preguntas del examen (200)
- χ^2: el estadístico de McNemar (1947) con corrección de continuidad; si pasa de 3.84, la diferencia no parece azar al 5 %. Sin corrección se quita el «− 1»
- Δ: la diferencia de exactitud de B menos A
- SE_{Δ}: el error estándar de la diferencia pareada
:::

La versión **exacta** no usa la fórmula: si los dos sistemas fueran igual de buenos, cada discrepancia sería un volado, y \(min(b, c)\) seguiría una distribución binomial con \(b + c\) volados de probabilidad 0.5. Es la que trae por omisión `statsmodels`, la biblioteca de estadística de Python, y la que conviene cuando \(b + c\) es menor que ≈ 25.

:::cuenta Llama 3.3 70B contra Qwen3 32B en el piloto (supuesto: el segundo caso de la tabla)
Discrepancias // \(b\) = 5 solo Qwen (A), \(c\) = 17 solo Llama (B) | 5 + 17 | 22
Diferencia, \(Δ\) | (17 − 5) ÷ 200 | +6 puntos
\(χ^2\) con corrección // la distancia entre \(b\) y \(c\) es 12 | (12 − 1)² ÷ 22 | 5.50
p-value con corrección // \(χ^2\) con 1 grado de libertad | — | 0.019
p-value exacto // binomial de 22 volados, a lo más 5 | 2 × P(X ≤ 5) | 0.017
\(SE_{Δ}\) | √(22 − 144 ÷ 200) ÷ 200 | 2.31 puntos
Intervalo pareado del 95 % | 6 ± 1.96 × 2.31 | +1.5 a +10.5 puntos
Sin parear // 85 % contra 91 % como exámenes sueltos | z = 6 ÷ 3.24 | p = 0.064
= Pareada: la diferencia es real (p ≈ 0.02). Sin parear, la misma diferencia «no se distingue» (p = 0.064). Es la misma información, mejor usada.
:::

Los tres casos de la calculadora, con números plausibles del despacho (supuestos):

| Caso | \(a, b, c, d\) | A → B | p con corrección / exacta | Intervalo pareado de \(Δ\) | Sin parear |
|---|---|---|---|---|---|
| 1. B gana 3 puntos | 162, 8, 14, 16 | 85 → 88 % | 0.29 / 0.29 | −1.6 a +7.6 | p = 0.38 |
| 2. B gana 6 puntos | 165, 5, 17, 13 | 85 → 91 % | **0.019 / 0.017** | **+1.5 a +10.5** | p = 0.064 |
| 3. Una actualización que mueve 1 punto | 172, 10, 12, 6 | 91 → 92 % | 0.83 / 0.83 | −3.6 a +5.6 | p = 0.72 |

Los casos 1 y 2 tienen las mismas 22 discrepancias. Lo que cambia es **cómo se reparten**: 8 contra 14 puede ser azar; 5 contra 17 casi no.

:::profundo Bootstrap pareado, y todo en un programa
El *bootstrap* (remuestrear con reemplazo, que viste en Sensei) también se puede hacer pareado: se sortean 200 preguntas de las 200 con reemplazo, **cada una con sus dos resultados juntos**, se calcula \(Δ\) y se repite 10,000 veces. El intervalo son los percentiles 2.5 y 97.5. No supone ninguna forma de la distribución y sirve igual para métricas que no son porcentajes (un promedio de fidelidad, un recall@5). Este programa hace todo: Wilson, las tres versiones de McNemar y el bootstrap, con datos simulados del segundo caso.

```python
import math, random

def wilson(k, n, z=1.96):
    p = k / n
    centro = (p + z*z/(2*n)) / (1 + z*z/n)
    medio = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
    return centro - medio, centro + medio

# Las mismas 200 preguntas a dos sistemas: 1 = bien, 0 = mal (datos simulados)
a, b, c, d = 165, 5, 17, 13            # ambos bien, solo A, solo B, ninguno
A = [1]*a + [1]*b + [0]*c + [0]*d
B = [1]*a + [0]*b + [1]*c + [0]*d
N = len(A)

lo, hi = wilson(sum(A), N)
print(f"A: {sum(A)}/{N} = {sum(A)/N:.1%}  Wilson 95 %: {lo:.1%} a {hi:.1%}")
print(f"B: {sum(B)}/{N} = {sum(B)/N:.1%}")

chi2 = (b - c)**2 / (b + c)
chi2c = (abs(b - c) - 1)**2 / (b + c)
p_sin = math.erfc(math.sqrt(chi2 / 2))
p_con = math.erfc(math.sqrt(chi2c / 2))
m = b + c                                    # exacta: min(b, c) ~ Binomial(b + c, 0.5)
p_exacta = min(1, 2 * sum(math.comb(m, k) for k in range(min(b, c) + 1)) / 2**m)
print(f"McNemar sin corrección: chi2 = {chi2:.3f}, p = {p_sin:.4f}")
print(f"McNemar con corrección: chi2 = {chi2c:.3f}, p = {p_con:.4f}")
print(f"McNemar exacta: p = {p_exacta:.4f}")

random.seed(2026)                            # bootstrap pareado: remuestrea PREGUNTAS
pares = list(zip(A, B))
deltas = []
for _ in range(10_000):
    muestra = random.choices(pares, k=N)
    deltas.append(sum(y - x for x, y in muestra) / N)
deltas.sort()
print(f"Bootstrap pareado, IC 95 % de B − A: {deltas[249]:+.1%} a {deltas[9749]:+.1%}")
```

```salida
A: 170/200 = 85.0%  Wilson 95 %: 79.4% a 89.3%
B: 182/200 = 91.0%
McNemar sin corrección: chi2 = 6.545, p = 0.0105
McNemar con corrección: chi2 = 5.500, p = 0.0190
McNemar exacta: p = 0.0169
Bootstrap pareado, IC 95 % de B − A: +1.5% a +10.5%
```
:::

:::profundo Cuánto se puede detectar, pareado
Con la prueba pareada, la diferencia mínima detectable ya no depende del 85 %, sino de **qué fracción de preguntas discrepan**, \(d = (b + c) ÷ N\): aproximadamente \(1.96 × sqrt{d ÷ N}\).

| Discrepan | Detectable al 5 % | Con 80 % de probabilidad de detectarla |
|---|---|---|
| 4 % | 2.8 puntos | 4.0 puntos |
| 6 % | 3.4 | 4.9 |
| 10 % | 4.4 | 6.3 |
| 15 % | 5.4 | 7.7 |
| 20 % | 6.2 | 8.9 |
| 30 % | 7.6 | 10.9 |

La lectura cambia según qué se compare. El mismo modelo con otro prompt o con una versión nueva de vLLM discrepa poco (4–10 %): la pareada mide fino. Dos modelos distintos discrepan mucho (20–30 %): la pareada casi no gana sobre comparar porcentajes sueltos, y decidir entre dos que empatan sigue sin ser posible con 200.
:::

:::calculadora evals-pareada
Arranca con el segundo caso: B gana 6 puntos y se distingue. Cambia al primero (8 y 14): las mismas 22 discrepancias, y ya no. Luego prueba los dos últimos, que son los que vas a ver en el gate: un cambio de 1 punto que pasa y uno que pierde 5 y se detiene.
:::

## Regresiones y el gate {Regressions and the gate}

Una [[regresion|regresión]] es que algo que funcionaba deje de funcionar después de un cambio. En un LLM con [[rag|RAG]], casi todo puede causarla: el modelo, su cuantización, la versión de [[vllm|vLLM]] (hoy 0.34.0), el prompt, cómo se parten los documentos, el [[modelo-de-embeddings|modelo de embeddings]], [[top-k|cuántos fragmentos se pasan]]. Y, como viste, a veces nada: el motor no repite exacto por omisión. El examen completo corre **con cada uno de esos cambios**. Es la flecha de regreso a evals que pintó [El recorrido de un proyecto de IA privada](/recorrido/).

El [[gate-de-calidad|gate de calidad]] es el candado: un proceso que corre el examen, aplica reglas escritas antes y, si alguna falla, el cambio no llega a los abogados. Nadie tiene que discutirlo en la junta del lunes.

### Lo que 200 preguntas pueden proteger

Para un cambio que se hace por otra razón (ahorrar memoria, actualizar el motor, acortar el prompt), no se le pide ganar: se le pide **no perder más de un margen**. Eso es [[no-inferioridad|no inferioridad]]. La regla: la cota de abajo de una cola (95 %) de \(Δ\), es decir \(Δ − 1.645 × SE_{Δ}\), tiene que quedar arriba de \(−m\).

¿Qué margen \(m\) se puede proteger con 200 preguntas? Si se quiere que un cambio que no pierde nada pase al menos 80 % de las veces, el margen tiene que ser al menos \((1.645 + 0.842) × SE_{Δ}\). Con 10 % de discrepancias, \(SE_{Δ}\) ≈ 2.24 puntos, y el margen mínimo es **≈ 5.6 puntos** (4.3 con 6 % de discrepancia; 6.8 con 15 %). Para proteger −3 puntos harían falta ≈ 690 preguntas; para −2, ≈ 1,550. Dicho en una frase para el socio: **con 200 preguntas, el gate detiene una caída de 6 o 7 puntos, no una de 2.** Lo que no ve la estadística se cubre leyendo.

### El gate del despacho, en dos capas

Propuesta para el despacho (supuesto del ejemplo):

:::pasos
1. Invariantes, sin estadística
Cero fugas en las 20 preguntas de permisos. Ninguna cita inventada **nueva** respecto de la versión en producción. El formato de la cita sigue siendo válido en las 200. Una sola falla detiene el cambio.
2. Calidad pareada contra producción
Se compara con la versión que hoy usan los abogados, en las mismas 200. Se detiene si la cota de abajo de \(Δ\) pierde más de **6 puntos**, o si el valor observado cae **3 puntos o más**. Es 6 y no 5 porque 200 preguntas solo protegen ≈ 5.6: con 5, un cambio que no pierde nada se detendría ≈ 28 % de las veces (10 % de discrepancia); con 6, ≈ 15 %. La segunda regla importa cuando cambian pocas respuestas: con 8 flips (4 %), una caída observada de hasta ≈ 3.7 puntos pasaría la primera.
3. Leer los flips, siempre
Un abogado y alguien de TI leen todas las preguntas que cambiaron, en los dos sentidos. Con 10 % de discrepancia son ≈ 20: una hora. Si 9 de los flips a mal son contratos en inglés, el cambio se detiene aunque pase todo lo demás.
4. El resultado nuevo es la nueva producción
Si pasa, se despliega y su resultado se guarda como la referencia del siguiente cambio. El candado se mueve con el sistema.
:::

:::diagrama evals-gate
El recorrido de un cambio por el gate. Sigue los tres casos: una actualización de vLLM que pasa, un prompt más corto que pierde 5 puntos y un chunker nuevo (el programa que parte los documentos en fragmentos) que gana 4 puntos pero deja pasar una fuga.
:::

:::profundo Dos detalles de operación
- **Corre de noche, con su propia clave.** El examen y el juez son ≈ 25 minutos del servidor completo (la cuenta de arriba), que en la hora pico no caben. Una clave de servicio en el gateway, con cuota propia, solo para el gate.
- **Primero se mide el piso de ruido.** En el piloto, el examen se corre dos veces con la misma configuración. Si las dos corridas discrepan en 3 % de las preguntas, eso es lo que «no cambió nada» parece, y cualquier cambio real se mide contra ese piso.
:::

La calidad de la cuantización (el AWQ contra el modelo original) es un caso de este mismo gate, y ya tiene su sección con los flips en [Formatos de cuantización en la práctica](/formatos-cuantizacion/).

### ¿Y contra el chatbot público?

El socio preguntó si es «tan bueno como el chatbot que usaban a escondidas». Se puede medir, con una condición dura: **con preguntas sin datos de clientes**. Mandar el examen a un chatbot de nube para compararlo saca los expedientes, exactamente lo que el proyecto evita. La forma honesta:

- Un conjunto aparte de preguntas públicas o sintéticas (sobre leyes publicadas, o sobre contratos de ejemplo escritos para esto), no las 200.
- Pareado y **a ciegas**: el abogado califica sin saber qué respuesta es de quién; o un juez local por pares, calificando en los dos órdenes (con respuestas sin fragmentos, ≈ 11–13 minutos de servidor para 200).
- Y sabiendo que no es la misma comparación: el chatbot público no tiene los expedientes, así que en las preguntas del despacho nunca podría citar la página. Lo que se compara es la calidad del modelo; lo que gana el despacho es el sistema.

## Jueces especializados y otros atajos {Specialized judges and other shortcuts} [extra]

**Jueces abiertos entrenados para calificar.** Prometheus (2023) es un modelo abierto de 13B entrenado con 100,000 respuestas calificadas con rúbrica; en 45 rúbricas personalizadas, su correlación (de Pearson) con humanos fue 0.897, contra 0.882 de GPT-4. Prometheus 2 (2024) salió en 7B y 8x7B, con licencia Apache 2.0. Suena ideal para un despacho privado. Pero a noviembre de 2026 su repositorio no recibe cambios desde abril de 2025, su última versión publicada es de septiembre de 2024 y sus jueces son en inglés; la versión multilingüe (M-Prometheus, 2025) publica sus pesos con una licencia marcada «other» que hay que leer antes de recomendarla. Un estudio de 2026 en inglés, español y vasco (un preprint) encontró que un juez chico afinado con datos del dominio iguala a los propietarios, pero **fuera** del dominio rinde más un modelo grande sin afinar. Para el despacho, sin datos de calificación propios, apunta a un generalista con rúbrica.

**G-Eval** (2023) es una técnica, no un modelo: pedirle al juez que razone paso a paso con un formulario de calificación. Con GPT-4 su correlación con humanos en resúmenes fue 0.514 (de rangos, Spearman), y sus autores advierten un sesgo a favor de textos generados por LLM. DeepEval y promptfoo la traen como métrica.

**Benchmarks públicos, para lo que sirven.** lm-evaluation-harness corre benchmarks como MMLU contra el servidor local. No mide «contestar con cita desde mis expedientes», pero sirve como alarma barata: si una actualización de vLLM o una cuantización nueva mueve un benchmark conocido, algo cambió. Para el derecho, LegalBench (2023, 162 tareas) es de derecho de Estados Unidos; un benchmark de 2026 de derecho colombiano, con 1,042 preguntas (el preprint de la capa de corrección), encontró que en opción múltiple los modelos sacaban de 0.577 a 0.905, pero en respuesta libre la corrección **nunca pasó de 0.45**: el examen barato predice el orden de los modelos, pero sobreestima cuánto se les puede creer. No encontramos un benchmark público de derecho mexicano, lo que no quiere decir que no exista; es un argumento más para el examen propio.

## Errores comunes {Common mistakes}

1. **Que el modelo escriba el examen.** Sale rápido y mide las preguntas que un modelo imagina, con las respuestas que un modelo encuentra fácil. **Cómo evitarlo:** preguntas de los abogados, con referencia escrita sin ayuda del modelo salvo corrección ligera.
2. **Un examen sin preguntas sin respuesta ni de permisos.** Premia al sistema que siempre contesta algo y no prueba la muralla. **Cómo evitarlo:** estratificar con ≈ 15 % de preguntas sin respuesta y un estrato de permisos con regla de cero fugas.
3. **Creerle a un juez sin calibrar.** El número del juez puede estar inflado (aprueba de más) o tener sesgos de posición, largo y auto-preferencia. **Cómo evitarlo:** una muestra de ≈ 100 respuestas calificada por dos abogados; reportar κ, el acuerdo y qué fracción de las malas atrapa el juez; y medir también κ entre los abogados.
4. **Dejar que la herramienta elija al juez.** DeepEval usa un modelo de OpenAI si no se configura; promptfoo elige por las credenciales del entorno; la telemetría viene prendida. **Cómo evitarlo:** fijar el juez al gateway, apagar la telemetría con sus variables, quitar las claves de nube del entorno y correr el examen en una máquina sin salida a internet.
5. **Leer «170 de 200» como «es de 85 %».** El intervalo va de ≈ 79 % a ≈ 89 %; para demostrar 85 % hay que observar 179–180. **Cómo evitarlo:** escribir qué significa el criterio, y reportar siempre el intervalo de Wilson junto al porcentaje.
6. **Comparar dos sistemas como si fueran exámenes sueltos.** Con 200 preguntas casi nada se distingue así, y se tiran discrepancias que sí informan. **Cómo evitarlo:** prueba pareada (McNemar exacta o con corrección, o bootstrap pareado) y leer las preguntas que cambiaron.
7. **Un gate que se decide después de ver el resultado.** Siempre aparece una razón para aprobar el cambio que uno quiere. **Cómo evitarlo:** las reglas, los márgenes y el denominador se escriben antes, y el gate corre solo.

## En la vida real {In real life} [extra]

**El despacho.** 200 preguntas de sus abogados en 5 estratos (110 con respuesta, 30 sin respuesta, 20 de permisos, 20 de resumir y 20 de cláusulas), con ≈ 167 horas de abogado entre escribir, calibrar y calificar. Retrieval y citas se califican con código; corrección y fidelidad con Qwen3 32B como juez, de noche, con su propia clave del gateway y sin salida a internet; una muestra de 100 respuestas por dos abogados para la kappa, comparada en el piloto con un juez de otra familia. El criterio firmado se queda («≥ 170» y «≤ 4»), con su lectura escrita: el 85 % sobre las 200, permisos como regla aparte, 179–180 como meta, cada cita inventada leída. Y un gate en dos capas para cada cambio.

**Una clínica con resúmenes de notas médicas.** Supuesto del ejemplo: un hospital quiere que un LLM local resuma las notas de cada consulta para el siguiente médico. Aquí el problema del juez es más duro que en el despacho: las notas son datos personales sensibles, y ni siquiera el equipo que construye el examen puede leer notas reales sin una autorización. La salida habitual: el examen se arma con notas **sintéticas** escritas por médicos (o reales anonimizadas con un proceso aprobado), el juez es local, y la rúbrica la escriben médicos con criterios de sí o no («¿menciona el alergeno?», «¿cambia alguna dosis?»). Un criterio de cero fallas en lo peligroso (inventar una dosis) pesa más que el porcentaje global. Cómo pesa la ley sobre esos datos lo ves en [Datos personales y la ley](https://sensei.trueml.app/privacidad/).

**Una financiera que clasifica llamadas.** Supuesto del ejemplo: un modelo local clasifica cada llamada de un centro de atención en una de 12 categorías («aclaración de cargo», «queja», «cancelación»…). Aquí no hace falta juez: la respuesta es una etiqueta y se compara con la que puso una persona, con la matriz de confusión y el recall por clase de [¿Aprendió de verdad?](https://sensei.trueml.app/aprendio/). Lo que sí aplica de esta lección: estratificar (las cancelaciones son pocas y caras), la prueba pareada para cada cambio y el gate. Con 2,000 llamadas etiquetadas, la diferencia detectable sin parear baja a ≈ 2.2 puntos (con 85 % de aciertos). [La financiera](/casos/financiera/) lo lleva a un caso completo: allí son 11 categorías (las causas de queja de la CONDUSEF y «sin queja») y el acuerdo entre dos personas que etiquetan se mide con kappa.

**Fuera de las computadoras: el sommelier con la etiqueta tapada.** Las catas a ciegas existen porque los catadores, como los jueces LLM, prefieren lo que ya conocen y lo que va primero: se sirve en orden distinto a cada uno y con la botella cubierta. Dónde se rompe: un catador no cambia de opinión si le sirves el mismo vino dos veces en la misma tarde; un juez LLM puede hacerlo.

## Ejercicios {Exercises}

:::ejercicios
? [facil] El sistema del despacho contesta bien 176 de las 200 preguntas. ¿Pasa el criterio? ¿Demuestra que su nivel verdadero es ≥ 85 %?
Pasa: 176 ≥ 170. No demuestra: con la cota exacta de una cola hay que observar 179, y con Wilson de dos colas 180. Con Wilson, 176 de 200 (88 %) va de \(c − m\) a \(c + m\): \(c\) = (0.88 + 3.8416 ÷ 400) ÷ 1.0192 = 0.8728; \(m\) = 1.96 × √(0.88 × 0.12 ÷ 200 + 3.8416 ÷ 160,000) ÷ 1.0192 = 0.0452; intervalo **82.8 % a 91.8 %**. El límite de abajo queda bajo 85 %. Lectura honesta: «pasa, sin margen».
? [facil] Una respuesta cita «exp. 3310, p. 2: «los primeros diez días de cada mes»», y la página 2 dice «los primeros cinco días de cada mes». ¿Qué devuelve el revisor de citas de la lección, y por qué no hace falta un juez?
Devuelve **«inventada: la página no dice eso»**: el expediente 3310 existe, la página 2 existe, pero el texto citado no está en ella. No hace falta juez porque la revisión es una búsqueda exacta: un programa la hace siempre igual, en milisegundos, sin sesgos ni costo de GPU.
? [facil] Una abogada y el juez coinciden en 180 de 200 respuestas. La abogada aprueba 160 y el juez 170. Calcula \(p_o\), \(p_e\) y κ.
\(p_o\) = 180 ÷ 200 = **0.90**. \(a\) = 160 ÷ 200 = 0.80; \(j\) = 170 ÷ 200 = 0.85. \(p_e\) = 0.80 × 0.85 + 0.20 × 0.15 = 0.68 + 0.03 = **0.71**. κ = (0.90 − 0.71) ÷ (1 − 0.71) = 0.19 ÷ 0.29 = **0.655**: «sustancial», apenas. 90 % de acuerdo suena mejor que eso: de esos 90 puntos, 71 los daría el azar (casi cuatro de cada cinco).
? [facil] ¿Por qué el examen no corre en la hora pico? Usa los números de la ficha.
En la hora pico los abogados piden 6,250 de los 7,200 tokens de salida por minuto (86.8 %): sobran 950. Solo el juez escribe 40,000 tokens: 40,000 ÷ 950 ≈ **42 minutos**, compitiendo con los abogados y subiéndoles el tiempo al primer token. De noche, el examen y el juez juntos tardan ≈ 25 minutos sin molestar a nadie.
? [medio] Qwen3 32B y Mistral Small 3.2 24B contestan las mismas 200 preguntas. Aciertan los dos 150; solo Qwen 14; solo Mistral 8; ninguno 28. ¿Cuál es mejor? Usa McNemar con corrección.
\(b\) = 14, \(c\) = 8, \(b + c\) = 22. \(Δ\) = (8 − 14) ÷ 200 = **−3 puntos** (Mistral peor). \(χ^2\) = (|14 − 8| − 1)² ÷ 22 = 25 ÷ 22 = **1.14**, menor que 3.84: **no se distingue del azar**. \(SE_{Δ}\) = √(22 − 36 ÷ 200) ÷ 200 = √21.82 ÷ 200 = 2.34 puntos; intervalo −3 ± 4.6 = **−7.6 a +1.6**. Con 200 preguntas empatan; decide otra cosa (velocidad, memoria) o se leen las 22 que discrepan.
? [medio] En el piloto salen 2 citas inventadas en 200 respuestas. ¿Pasa el criterio? ¿Demuestra que la tasa es ≤ 2 %? ¿Cuántas preguntas harían falta para demostrarlo con esas mismas 2?
Pasa: 2 ≤ 4. No demuestra: la cota exacta de una cola con 2 de 200 es **3.11 %**, arriba del 2 %. Con 2 citas inventadas harían falta **313** preguntas para que la cota quedara en 2 %. Con 200 preguntas, solo 0 de 200 lo demuestra (cota de 1.49 %).
? [medio] El despacho quiere proteger un margen de no inferioridad de 3 puntos con su gate. Con 200 preguntas y 10 % de discrepancias, ¿lo logra? ¿Qué margen sí, y qué haría falta para 3?
Margen mínimo = (1.645 + 0.842) × \(SE_{Δ}\). Con \(d\) = 0.10 y \(N\) = 200, \(SE_{Δ}\) ≈ √(0.10 ÷ 200) = 0.0224 = 2.24 puntos; margen = 2.487 × 2.24 ≈ **5.6 puntos**. No logra 3. Para 3 puntos: \(N\) = (2.487 ÷ 3)² × 0.10 × 10,000 ≈ **687 preguntas**; o bajar la discrepancia (con 6 %, ≈ 412). Mientras tanto, la regla extra de «cae 3 puntos o más en el observado» y leer los flips cubren el hueco.
? [reto] Con la propuesta de estratos, el sistema saca: 100 de 110 en «preguntar», 24 de 30 «sin respuesta», 0 fugas en «permisos» (las 20 bien), 15 de 20 en «resumir» y 16 de 20 en «cláusulas». ¿Pasa el criterio si el denominador son las 200? ¿Y si fueran solo las 150 que se contestan (preguntar, resumir, cláusulas)? ¿Qué te dice el estrato «sin respuesta»?
Con las 200: 100 + 24 + 20 + 15 + 16 = **175 de 200 (87.5 %)**: pasa. Con las 150 que se contestan: 100 + 15 + 16 = **131 de 150 (87.3 %)**: pasa con 85 % (127.5). «Sin respuesta»: 24 de 30 (80 %); en las otras 6 contestó algo cuando no había respuesta. Por la regla del estrato, cada una que traiga cita cuenta como cita inventada. Si las 6 citaron, son 6 solo ahí: **no pasa** el «≤ 4» aunque pase el 85 %. El porcentaje y el criterio de citas se revisan por separado, y aquí decide el segundo. El estrato chico no sostiene un porcentaje (Wilson de 24 de 30: ≈ 62.7 % a 90.5 %), pero cada error suyo se lee y cuenta en el criterio de citas.
? [reto] Un proveedor ofrece al despacho «un juez de frontera con κ = 0.72 contra abogados» por API, a cambio de mandarle las 200 respuestas con sus [[chunk|fragmentos]]. ¿Qué le contestas, con números de la lección?
Que el κ de 0.72 es parecido al de Legal Research Bench (0.708–0.726), medido en derecho de Estados Unidos y en inglés, no en sus expedientes; y que en ese mismo estudio los abogados concordaron con κ = 0.644, así que el techo realista de cualquier juez está cerca del acuerdo entre abogados, no muy arriba. Pero el punto decisivo no es estadístico: mandar las respuestas con fragmentos saca los expedientes de la red, que es lo que el proyecto existe para evitar (el mismo riesgo del chatbot público). La contrapropuesta: juez local (Qwen3 32B), calibrado con 100 respuestas por dos abogados; si el κ local queda más de ≈ 0.1 abajo del de los abogados entre sí, probar un juez abierto de otra familia, también local. Si el despacho aun así quisiera el juez externo, solo con preguntas públicas o sintéticas y con la autorización escrita de su abogado.
:::

## Lo que sigue {What comes next} [extra]

- **[Pruebas de carga y benchmarks honestos](/pruebas-carga/)** es la otra mitad de las evals: esta lección pregunta «¿contesta bien?»; aquella, «¿aguanta 8 conversaciones a la vez en la hora pico?». Las dos se firman en el mismo criterio de aceptación.
- **[RAG privado: embeddings y vector DB locales](/rag-privado/)** construye la búsqueda que aquí se califica en la capa de retrieval, y la muralla de permisos que prueban las 20 preguntas de permisos.
- **[Agentes, tools y guardrails](/agentes/)** usa este mismo examen para aceptar un [[agente|agente]]: con más pasos, más formas de fallar y la misma regla de cero fugas.
- **[Formatos de cuantización en la práctica](/formatos-cuantizacion/)** tiene el caso del gate que más se repite: el modelo cuantizado contra el original, con sus flips.
- **«[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)»** cierra la salida a internet de la máquina del examen y es la que dispara el gate en cada actualización; **«[Observabilidad de GPUs e inferencia](/observabilidad/)»** mide en producción lo que el examen mide antes.
- En Sensei: [¿Aprendió de verdad?](https://sensei.trueml.app/aprendio/) tiene el golden set, la matriz de confusión y el gate en general; [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/), el error estándar, los intervalos, el A/B y la intuición de McNemar.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
eval golden-set estratificar respuesta-de-referencia metrica-de-retrieval fidelidad llm-as-judge rubrica sesgo-del-juez acuerdo-entre-jueces kappa-de-cohen prueba-pareada no-inferioridad regresion gate-de-calidad cita-inventada telemetria
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué el examen del despacho tiene 30 preguntas sin respuesta?
Porque sin ellas el examen premia al sistema que siempre contesta algo. En esas, lo correcto es decir «no lo encontré», y cualquier cita que dé es inventada.
? ¿Qué capas del examen se califican con código y cuáles con juez?
Con código: el retrieval (¿llegó la página de oro?, ¿se filtró algo prohibido?) y la cita (¿existe el expediente, la página y el texto?). Con juez: la corrección contra la referencia y la fidelidad a los [[chunk|fragmentos]].
? Nombra los tres sesgos del juez más estudiados y una forma de mitigar cada uno.
Posición (calificar en los dos órdenes, o una respuesta a la vez contra la referencia), verbosidad (rúbrica de sí o no, controlar el largo) y auto-preferencia (que el juez no sea el modelo que se está comparando).
? ¿Por qué no basta el porcentaje de acuerdo entre la abogada y el juez?
Porque dos calificadores que aprueban casi todo coinciden mucho por azar. La kappa de Cohen descuenta ese acuerdo esperado: con 94 % de acuerdo puede salir κ = 0.22 si el juez casi nunca atrapa las malas.
? Con 170 de 200, ¿entre qué valores está el nivel verdadero, y cuántas hay que observar para demostrar 85 %?
Wilson: ≈ 79.4 % a 89.3 %. Para demostrar ≥ 85 % al 95 %: 179 de 200 con la cota exacta de una cola, o 180 con Wilson de dos colas.
? ¿Qué dos cosas hay que configurar en RAGAS, DeepEval o promptfoo antes de correrlos en el despacho?
El juez, apuntando al gateway local (si no, usan o eligen un modelo de nube), y apagar la telemetría con su variable de entorno. Y, además, que la máquina no tenga salida a internet.
? ¿Qué caída puede detener un gate con 200 preguntas pareadas y 10 % de discrepancias, y qué cubre lo demás?
Una de ≈ 5.6 puntos o más (la de 6–7 la ve; la de 2, no). Lo demás lo cubren la regla de «cae 3 puntos o más en el observado» y leer todas las preguntas que cambiaron.
:::
