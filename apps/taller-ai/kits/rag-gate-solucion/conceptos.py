"""Las tarjetas de conceptos de la estación 9 (las usa contenido.py). Cada una: definición de una línea, analogía,
por qué importa y la trampa. Los §…§ son cifras que contenido.py llena con las salidas reales."""

C = []


def con(id_, termino, en, def_, analogia, importa, trampa):
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


con("gate", "Gate de calidad", "quality gate, release gate",
    "Un paso automático que decide si un cambio puede salir: corre el mismo examen con el cambio y sin él, y bloquea si el cambio empeora algo que importa.",
    "Como la revisión técnica de un coche antes de circular: no te dice si el coche es bueno, te dice si pasa la lista de cosas que no pueden fallar, y la lista no cambia según quién lo lleve.",
    "En un RAG casi todo puede empeorar las respuestas sin que nadie lo note: el chunking, los embeddings, el reranker, el prompt, el umbral del «no sé», el modelo o su cuantización. El gate hace que cada uno de esos cambios pase por el mismo examen antes de llegar a las personas.",
    "Creer que un gate prueba que el sistema es bueno. Solo dice que el cambio no empeora lo que el examen mide, dentro de lo que el examen alcanza a ver.")
con("corrida", "Corrida de evaluación", "eval run",
    "Una pasada del golden set contra el sistema completo, guardada con todo lo que contestó: lo que llegó al prompt, la respuesta, las citas, si dijo «no sé» y cuánto tardó.",
    "Como guardar el examen contestado de un alumno, no solo su calificación: así se puede volver a revisar, recalificar con otra rúbrica o comparar pregunta por pregunta con el del año pasado.",
    "Guardar las respuestas (no solo los porcentajes) permite comparar dos versiones en las mismas preguntas, leer las que cambiaron y volver a calificar con otro juez sin volver a correr el sistema.",
    "Pisar una corrida o editarla a mano: ya no se sabe qué sistema contestó qué. Una corrida se escribe una vez y no se toca.")
con("manifiesto", "Manifiesto de la corrida", "run manifest",
    "La ficha de una corrida: qué golden set (versión y sha256), qué split y qué preguntas, qué configuración (su sha256), qué modelo e índice, y si corrió sin cache.",
    "Como la etiqueta de una muestra de laboratorio: sin fecha, lote y método, el resultado no se puede comparar con otro.",
    "El gate solo compara corridas comparables: mismo golden, mismo split y mismas preguntas. Si cambia cualquiera de esos, la diferencia puede venir del examen y no del sistema.",
    "Comparar un 82 % de hoy contra un 79 % de hace un mes sin saber que el golden set cambió de versión en medio.")
con("base", "Base vigente", "baseline",
    "La corrida de la versión que hoy usa la empresa. Cada cambio se compara contra ella, y solo se mueve cuando un cambio pasa el gate y alguien lo promueve.",
    "Como la marca de la vara en el salto de altura: cada intento se mide contra la misma marca, no contra el intento anterior.",
    "Si cada cambio se comparara con la corrida anterior, una serie de pérdidas chicas, cada una «dentro del ruido», bajaría la calidad sin que nadie lo decidiera.",
    "Comparar contra «la última corrida»: una regresión que se bloqueó y se vuelve a correr se compara consigo misma y pasa.")
con("recall-doc", "Recall@8 por documento", "document-level recall@k",
    "De los documentos que contestan una pregunta, qué fracción llegó al prompt (entre los 8 chunks). Se cuenta por documento: dos chunks del mismo documento son un solo acierto.",
    "Como revisar si en la mochila del alumno están los libros que necesita para el examen: no importa si trae dos copias del mismo.",
    "Si la fuente no llegó al prompt, ningún prompt ni modelo arregla la respuesta. Por eso se mide primero, y aparte de la respuesta. Aquí se mide sobre lo que de verdad leyó el modelo (después de las guardas y del «no sé»), no sobre lo que devolvió el buscador.",
    "Contar chunks en vez de documentos: un documento partido en tres «acierta tres veces» y el recall sube sin que llegue nada nuevo.")
con("fuga", "Fuga de permisos", "permission leak",
    "Que a una persona le llegue al prompt (o en una cita) un chunk que no puede ver. Se revisa en cada pregunta, con la ACL de la estación 3 y el directorio de hoy, y con las prohibidas del golden set.",
    "Como un archivo confidencial que aparece en la carpeta de alguien que no debería tenerlo: no importa si lo leyó, ya está ahí.",
    "Es la regla que no se negocia: una sola fuga bloquea, sin estadística. Y se revisa de forma determinista, sobre lo que llegó al prompt, no preguntándole al juez si la respuesta «suena confidencial».",
    "Medir los permisos con un examen que pregunta con una llave de servicio que lo ve todo: entonces no se prueba nada, o se «encuentran» fugas que no existen.")
con("cita-esperada", "Cita a una fuente esperada", "citation precision (proxy)",
    "De las respuestas que citan algo, en cuántas al menos una cita es de un documento que el golden set marcó como fuente. Es una aproximación barata a la precisión de citas.",
    "Como revisar la bibliografía de un ensayo contra la lista de lecturas del curso: si no cita ninguna, probablemente sacó el dato de otro lado.",
    "La estación 8 ya garantiza que cada cita exista y que la persona la pueda ver. Lo que falta saber es si cita el documento correcto: el modelo de 0.6B muchas veces acierta el dato y cita el número de al lado.",
    "Leerla como «la cita sostiene la frase». Un documento distinto también puede decir lo mismo (un ticket de Jira que repite la política). Para saberlo de verdad, se califica cita por cita con un juez, como en C11.")
con("abstencion", "Abstención correcta e indebida", "abstention",
    "Decir «no sé» cuando el golden set dice que no hay respuesta (sin respuesta, o prohibida para esa persona) es correcto; decirlo cuando sí la hay es indebido.",
    "Como un médico que dice «esto no lo sé, vaya con el especialista»: bien si de verdad no le toca; mal si era una gripa.",
    "Los dos errores tiran en sentidos contrarios: bajar el umbral del «no sé» contesta más preguntas que sí están y también inventa en las que no. El gate tiene que ver los dos, y el juez los califica junto con las demás respuestas.",
    "Medir solo cuántas veces contesta: un asistente que nunca dice «no sé» se ve más útil y es el que inventa.")
con("juez", "LLM como juez", "LLM-as-a-judge",
    "Un LLM que lee la pregunta, la respuesta de referencia del golden set y la respuesta del sistema, y dice si la respuesta es correcta, siguiendo una rúbrica y en JSON.",
    "Como un ayudante que califica exámenes con la clave de respuestas del profesor: rápido y barato, pero hay que revisar primero que califique como el profesor.",
    "No hay forma exacta de decir si «De 1 a 3 días hábiles» y «el cobro se reembolsa en 1 a 3 días» dicen lo mismo, y las personas no alcanzan a calificar 51 respuestas en cada cambio (en C11, ≈ 600). El juez sí.",
    "Usar como juez al mismo modelo que contesta: se califica a sí mismo, y si es chico no entiende la rúbrica. Aquí, el de 0.6B de la API reprueba §FR06§ de las respuestas buenas y su kappa es §K06§.")
con("rubrica", "Rúbrica", "rubric",
    "Las instrucciones del juez: qué cuenta como error (otro número, plazo o persona; contestar cuando no hay respuesta; decir que no sabe cuando sí la hay) y qué no (que falten detalles o lo diga con otras palabras).",
    "Como los criterios de calificación de un concurso: dos jueces con los mismos criterios califican parecido; con criterios vagos, cada quien califica a su manera.",
    "La rúbrica es parte del juez: si cambia, el juez es otro y hay que volver a calibrarlo. Por eso su sha256 va en la calibración y en cada juicio, y la cache del juez la lleva en su llave.",
    "Ajustar la rúbrica con las mismas respuestas con las que se calibra: el juez queda afinado para ese examen y la calibración sale optimista. Aquí se probaron 3 rúbricas contra estas calificaciones: su número es optimista.")
con("calibrar", "Calibrar al juez", "judge calibration",
    "Comparar los veredictos del juez con los de personas en respuestas que ellas ya calificaron, y solo creerle si se parece lo suficiente.",
    "Como afinar una báscula con pesas conocidas antes de pesar: si marca 1.2 kg con la pesa de 1 kg, todo lo que pese después está mal.",
    "El gate le cree al juez solo si su calibración pasa y si es el mismo juez (modelo y rúbrica) que calificó las dos corridas. Un juez sin calibrar puede decir que todo está bien, o que todo está mal.",
    "Calibrar una vez y olvidarse: un juez nuevo, una cuantización distinta o una rúbrica editada son otro juez.")
con("kappa", "Kappa de Cohen", "Cohen's kappa",
    "Cuánto coinciden dos calificadores descontando lo que coincidirían por azar: κ = (p_o − p_e) ÷ (1 − p_e). 1 es acuerdo perfecto, 0 es lo mismo que el azar.",
    "Si dos maestros aprueban al 90 % de los alumnos sin leer los exámenes, coinciden muchísimo por pura casualidad. La kappa pregunta cuánto coinciden más allá de eso.",
    "El acuerdo simple engaña: si el 80 % de las respuestas está bien, un juez que dice «correcta» a todo coincide con las personas el 80 % de las veces sin leer nada, y su kappa es 0. En el dojo, el de 0.6B de la API acuerda §A06§ con las personas y su kappa es §K06§; el de 4B, §A4§ y §K4§.",
    "Mirar solo el «% de acuerdo». Y leer una kappa de 68 respuestas como exacta: su intervalo es ancho.")
con("falso-pase", "Falso pase", "false pass rate",
    "De las respuestas que las personas reprobaron, qué fracción aprobó el juez. Es el error caro: una respuesta mala que el examen deja pasar.",
    "Como un detector de metales que no suena con un cuchillo: que suene de más es una molestia; que no suene es el problema.",
    "Un juez con falso pase alto subestima las regresiones: si el cambio vuelve malas 6 respuestas y el juez aprueba 1 de cada 6 malas, el gate solo ve 5. En el dojo, el juez de 4B aprueba §FP4§ que reprobaron las personas.",
    "Confundirlo con el falso rechazo (el juez reprueba una buena): ese también cuenta, pero hace que el gate bloquee de más, no que deje pasar lo malo.")
con("wilson", "Intervalo de Wilson", "Wilson score interval",
    "El rango donde probablemente está el porcentaje de verdad, dado lo que se midió en n preguntas. Para muestras chicas y porcentajes cerca de 0 o 100 % se porta mejor que el clásico p ± 1.96 × √(p(1 − p) ÷ n).",
    "Como una encuesta de 51 personas: si 40 dicen que sí, no sabes que es 78 %; sabes que es «algo entre 65 y 88 %».",
    "Con 51 preguntas, un porcentaje trae ± ≈ 11 puntos: dos versiones que sacan 78 % y 82 % no se distinguen comparando los dos números. Por eso el gate no compara porcentajes sueltos.",
    "Reportar «78.4 %» como si el decimal significara algo.")
con("pareada", "Prueba pareada", "paired comparison",
    "Comparar dos versiones en las mismas preguntas, una por una: solo cuentan las que cambiaron (las que una acierta y la otra no). Las que las dos aciertan o fallan no dicen nada de cuál es mejor.",
    "Como probar dos zapatos poniendo uno en cada pie del mismo corredor, en la misma carrera: así no comparas corredores, comparas zapatos.",
    "Es mucho más fino que comparar dos porcentajes: si no cambia ninguna respuesta, la diferencia es exactamente 0 y su error también; si cambian 4, el error sale de esas 4. Sin parear, el error de la diferencia es ≈ 8 puntos aunque no cambie nada.",
    "Usar la prueba de dos muestras independientes en un examen con las mismas preguntas: bloquea todo, o no ve nada.")
con("no-inferioridad", "No inferioridad", "non-inferiority test",
    "A un cambio que se hace por otra razón (latencia, costo) no se le pide ganar, sino no perder más de un margen: la cota de abajo de la diferencia, Δ − 1.645 × su error (una cola, 95 %), queda arriba de −margen.",
    "Como cambiar de proveedor de harina por precio: no le pides que el pan salga mejor; le pides que no salga peor de lo que el cliente nota.",
    "El margen es una decisión del negocio (cuánto se acepta perder), y el número de preguntas decide qué margen se puede proteger: con 51 preguntas y 10 % de respuestas que cambian, ≈ 11 puntos; con 600, ≈ 3. Lo que no ve la estadística se cubre con la regla de la caída observada y leyendo las preguntas que cambiaron.",
    "Aflojar el margen cuando el gate bloquea: entonces el gate ya no protege nada.")
con("examen-cache", "Un examen sin cache", "cache-busting in evals",
    "Que cada pregunta del examen recorra el sistema completo, sin respuestas ni retrieval guardados de antes. Aquí, con la cabecera «Cache-Control: no-cache», que la API de la estación 8 respeta.",
    "Como un examen de manejo en el que el examinador no puede usar las respuestas del alumno de ayer: tiene que manejar hoy.",
    "La API guarda el top-8 de cada pregunta y persona 5 minutos. Si el examen corre justo después de la base, un cambio de retrieval (k, candidatos, reranker) recibe el top viejo y sale idéntico a la base: el gate aprobaría algo que no midió.",
    "Notarlo por los tiempos («qué rápido corrió hoy»). Se revisa en los datos: cada fila guarda de_cache, y el gate bloquea si alguna salió de la cache.")
con("contaminacion", "Dev y test separados", "data leakage, test contamination",
    "Las preguntas que se usaron para decidir algo (el umbral del «no sé» se eligió con dev en la estación 8) no se usan para medirlo. El gate decide solo con test.",
    "Como repasar con las preguntas del examen: sacas 100, y no sabes nada de lo que no repasaste.",
    "Mezclar dev en el examen premia justo lo que se ajustó con dev, y además cambia el examen: ya no se compara con la base. Con 14 preguntas de dev y 51 de test, el gate mide con las 51.",
    "Juntar dev y test «para tener más preguntas». Si hacen falta más, se escriben más (estación 4) y se reparten otra vez.")
