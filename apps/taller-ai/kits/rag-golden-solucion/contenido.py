"""Arma content/estaciones/rag-golden.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r4 && bash probar-fallas.sh /ruta/r4     # deja /ruta/r4.log y /ruta/r4-fallas.log
    python3 contenido.py /ruta/r4                                  # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs, y el código de cada
paso sale de los archivos de esta solución.
"""
import json
import re
import sys
from pathlib import Path

CARPETA = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 contenido.py <carpeta de probar.sh>")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
LOG = Path(f"{CARPETA}.log").read_text()
LOGF = Path(f"{CARPETA}-fallas.log").read_text()
PROBAR = (SOL / "probar.sh").read_text()
PROBARF = (SOL / "probar-fallas.sh").read_text()


def L(nombre: str, log: str = None, filtro=None, max_lineas=None, sin=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    lineas = m.group(1).rstrip("\n").splitlines()
    if filtro:
        lineas = [l for l in lineas if re.search(filtro, l)]
    if sin:
        lineas = [l for l in lineas if not re.search(sin, l)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def P(nombre: str, fuente: str = None) -> str:
    """El comando tal como lo corre probar.sh en la sección «nombre» (para no escribirlo dos veces)."""
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^cp |^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python -c \""):
        c = c.replace("\\\"", "\"")
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


V = "python verificar.py"

e = {
    "id": "golden", "patron": "llm", "rama": "rag", "etapa": "datos", "num": 4,
    "titulo": "Golden set", "nav": "Golden set",
    "pregunta": "¿Con qué examen vas a medir el asistente, para que el número que salga signifique lo mismo hoy y dentro de seis meses, aunque cambie el corpus, aunque lleguen preguntas nuevas y aunque alguien lo quiera «arreglar»?",
    "version": "2026-11-26",
}

e["mapa"] = {
    "resumen": "Las estaciones 1 a 3 dejaron el corpus listo: cada documento partido en <b>chunks</b> (pedazos de ≈ 400 tokens), cada chunk con su <b>ACL</b> (quién lo puede leer). Antes de construir el buscador, el reranker y el LLM, hace falta saber cómo se va a medir si funcionan. Eso es el <b>golden set</b>: un examen fijo. Cada pregunta trae su <b>respuesta de referencia</b>, sus <b>fuentes</b> (los chunks donde está la respuesta, con una huella de su texto), <b>quién la hace</b> (para probar permisos) y su <b>tipo</b>: directa, con varias fuentes, sin respuesta o prohibida para esa persona. Las preguntas las escriben los expertos de cada equipo y llegan con errores, así que pasan un <b>esquema</b> y unas reglas; las <b>casi iguales</b> se quitan; cada una cae en <b>dev o test por un hash</b> y nunca se mueve; lo que está en test <b>no se usa para afinar</b>; cada versión se publica <b>una sola vez</b>, con su sha256; y cuando el corpus se re-ingesta, cada fuente se <b>vuelve a anclar</b> al chunk que tiene su texto. La estación 9 (el gate) mide con este examen recall@8, faithfulness, citas y permisos al 100 %.",
    "entra": [
        "lo que dejó la estación 3: el corpus (<code>almacen/corpus/vigente.json</code>), 154 chunks con su texto y su ACL en grupos, y el directorio de la empresa con los cambios de la mañana",
        "las preguntas que escribieron los expertos de seis equipos (<code>almacen/candidatos/expertos.jsonl</code>), unas sacadas de consultas reales, con sus errores",
        "los ejemplos con los que afina el equipo del prompt (<code>almacen/afinado/ejemplos.jsonl</code>)",
        "las re-ingestas de cada noche, que cambian el corpus (<code>mundo/avanzar.py</code>)",
    ],
    "sale": [
        "<code>golden/golden-vN/preguntas.jsonl</code>: cada pregunta con su respuesta de referencia, sus fuentes (chunk, documento y huella), quién la hace, su tipo y su split",
        "un manifiesto por versión (sha256, corpus, foto del directorio, conteos, cambios) y la misma versión en el registro, de solo lectura",
        "<code>golden/VIGENTE</code>: la versión que usa el gate, y <code>golden/anclas.json</code>: cómo se movió cada chunk de una re-ingesta a la siguiente",
        "las rechazadas de cada versión, con su motivo, para que el experto las corrija",
    ],
    "escala": [
        {"que": "Preguntas", "ref": "≈ 600 en el golden set", "taller": "79 candidatas de 6 expertos → 69 en golden-v1 y 65 en golden-v2"},
        {"que": "Corpus", "ref": "≈ 1.5 M de documentos que se re-ingestan cada noche", "taller": "154 chunks de 105 documentos y dos re-ingestas (el 22 y el 23 de noviembre)"},
        {"que": "Quién pregunta", "ref": "miles de personas en el directorio", "taller": "14 personas: 9 distintas en las prohibidas"},
        {"que": "Registro", "ref": "un bucket con Object Lock: cada versión se escribe una vez", "taller": "<code>almacen/registro/</code>, de solo lectura, y <code>subir()</code> que no sobrescribe"},
        {"que": "El gate", "ref": "recall@8, faithfulness, citas y permisos al 100 % (estación 9)", "taller": "un adelanto con el buscador de juguete: <code>mundo/evaluar.py</code>"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir código, las cuentas de servilleta del golden set: cuánto cuesta que lo escriban los expertos, cuántos pares hay que comparar para encontrar repetidas, cuántas preguntas se mueven si repartes al azar cada vez, cuántas preguntas hacen falta para ver una diferencia de unos puntos y qué tan seguro estás de los permisos cuando no viste ninguna fuga.",
    "cuentas": [
        {"id": "pares", "pregunta": "¿Cuántos pares hay que comparar para encontrar preguntas casi iguales?",
         "formula": "pares = n × (n − 1) / 2: cada pregunta contra cada una de las demás, una vez",
         "ref": {"cuenta": "600 preguntas del golden; o un mes de consultas reales (25k al día × 30) si quieres sacar preguntas de ahí", "valor": "179,700 pares (nada) contra ≈ 281 mil millones (otro problema)"},
         "taller": {"cuenta": "79 candidatas", "valor": "3,081 pares: se comparan todas en milisegundos"},
         "decide": "Para el golden set, comparar todos contra todos sobra. Para buscar repetidas en los registros de consultas, hace falta un atajo que no compare todo: MinHash con LSH, que solo compara los pares que caen en la misma «cubeta».",
         "conceptos": ["casi-iguales"],
         "comprueba": cmd(P("pc pares"), L("pc pares"))},
        {"id": "splits", "pregunta": "Si cada versión reparte dev y test otra vez al azar, ¿cuántas preguntas cambian de lado?",
         "formula": "cambian ≈ 2 × p × (1 − p) × n (p = la fracción que va a test)",
         "ref": {"cuenta": "600 preguntas, 75 % a test", "valor": "≈ 225 preguntas cambian de lado en cada versión"},
         "taller": {"cuenta": "600 ids simulados, al azar dos veces contra un hash del id", "valor": "221 al azar · 0 con el hash · 225 si cambias la sal"},
         "decide": "Con un reparto al azar, un tercio del examen cambia en cada versión: un número de la semana pasada ya no se compara con el de hoy, y lo que alguien miró en dev termina en test. El split sale de un hash del id, y la sal no se toca.",
         "conceptos": ["split-hash", "splits"],
         "comprueba": cmd(P("pc splits"), L("pc splits"))},
        {"id": "costo", "pregunta": "¿Cuánto cuesta escribir el golden set, y cuántas preguntas toca cada semana la re-ingesta?",
         "formula": "horas = preguntas × minutos de un experto por pregunta; tocadas ≈ n × (1 − (1 − cambio semanal)^fuentes por pregunta)",
         "ref": {"cuenta": "600 preguntas × 8 min (supuesto); 5 % de documentos cambia por semana y 1.4 fuentes por pregunta (supuestos)", "valor": "80 h de expertos; ≈ 42 preguntas tocadas por semana"},
         "taller": {"cuenta": "79 candidatas × 8 min; la re-ingesta del 22 cambió 11 de 154 chunks", "valor": "10.5 h; 10 de 69 preguntas tocadas (6 se reanclan solas, 3 a revisión, 1 retirada)"},
         "decide": "El tiempo de los expertos es lo caro: un error suyo se atrapa con código antes de gastarles otra hora, y reanclar no puede ser a mano. Lo que no se puede reanclar solo (un texto que cambió) es lo único que regresa con un experto.",
         "conceptos": ["reanclaje", "golden-set"],
         "comprueba": cmd(P("pc costo"), L("pc costo"))},
        {"id": "cuantas", "pregunta": "¿Cuántas preguntas hacen falta para ver una diferencia de X puntos entre dos versiones del sistema?",
         "formula": "margen al 95 % ≈ 1.96 × √(p(1 − p)/n); para ver una diferencia d entre dos sistemas: n ≈ (1.96 + 0.84)² × 2p(1 − p) / d²",
         "ref": {"cuenta": "recall ≈ 85 % (supuesto) con 450 preguntas de test (75 % de 600)", "valor": "± 3.3 puntos; con exámenes independientes, lo más chico que se distingue son ≈ 6.7 puntos (ver 5 pediría ≈ 800 preguntas)"},
         "taller": {"cuenta": "37 preguntas con fuentes en el test de golden-v2", "valor": "± 11.5 puntos: solo se ven diferencias grandes"},
         "decide": "Un golden de 600 ve diferencias de varios puntos, no de 1. Por eso dos versiones del sistema se comparan con las mismas preguntas (comparación pareada, paso 8), que normalmente necesita muchas menos, y por eso no se celebra una «mejora» de 1.4 puntos con 37 preguntas.",
         "conceptos": ["margen", "pareada"],
         "comprueba": cmd(P("pc cuantas"), L("pc cuantas"))},
        {"id": "fugas", "pregunta": "Si ninguna pregunta prohibida tuvo fuga, ¿qué tan seguro estás de los permisos?",
         "formula": "con 0 fallas en n intentos, la tasa real puede llegar hasta ≈ 3 / n (regla de tres, 95 %)",
         "ref": {"cuenta": "≈ 60 a 90 prohibidas (10 % a 15 % de 600)", "valor": "hasta ≈ 5 % a 3.3 %"},
         "taller": {"cuenta": "6 prohibidas en test (10 en todo golden-v2)", "valor": "hasta ≈ 50 % (30 % con las 10); con n chico la cuenta exacta da un poco menos: 39 % y 26 %"},
         "decide": "«Permisos al 100 %» en el golden es necesario, no suficiente: cero fugas en 90 preguntas todavía deja posible una tasa de 3 %. Por eso la estación 3 prueba a cada persona contra cada ACL y la estación 12 vuelve esa prueba un monitoreo que corre solo.",
         "conceptos": ["regla-de-tres", "tipos-pregunta"],
         "comprueba": cmd(P("pc fugas"), L("pc fugas"))},
    ],
}

e["conceptos"] = [
    {"id": "golden-set", "termino": "Golden set (el examen fijo)", "en": "golden set, evaluation set",
     "def": "Un conjunto fijo de preguntas con su respuesta correcta y de dónde sale, con el que se mide el sistema cada vez que cambia algo: chunker, embeddings, reranker, prompt o LLM.",
     "analogia": "Como el examen de manejo: el mismo recorrido para todos y con las mismas reglas, para que «aprobó» signifique lo mismo para cada persona y en cada fecha.",
     "importa": "Sin un examen fijo, cada cambio se juzga «a ojo» con dos o tres preguntas que se le ocurren a alguien, y nadie puede decir si la semana pasada estaba mejor o peor.",
     "trampa": "Escribirlo una vez y olvidarlo. El corpus cambia cada noche: si nadie lo mantiene, en un mes mide contra documentos que ya no existen."},
    {"id": "respuesta-referencia", "termino": "Respuesta de referencia", "en": "reference answer, ground truth",
     "def": "La respuesta que un experto da por correcta para una pregunta, escrita con lo que dicen los documentos y nada más.",
     "analogia": "Como la hoja de respuestas del profesor: no es la única forma de contestar bien, pero es contra lo que se compara.",
     "importa": "La estación 9 compara lo que dice el asistente contra ella (¿dice lo mismo?) y contra los chunks que recibió (¿todo lo que dice está en ellos?, que es la faithfulness).",
     "trampa": "Que la escriba alguien que «se la sabe» sin abrir el documento: una respuesta de referencia que no está en sus fuentes enseña al gate a premiar lo que se inventa."},
    {"id": "fuente-anclada", "termino": "Fuente y su huella", "en": "source, content hash",
     "def": "El chunk donde está la respuesta: su chunk_id, su documento y la huella (los primeros 16 caracteres del sha256) del texto que leyó el experto.",
     "analogia": "Como citar un libro con página y la frase exacta: si en la edición nueva la página cambió, la frase todavía te dice dónde buscar.",
     "importa": "El recall@8 y las citas se miden contra las fuentes. La huella dice si ese chunk sigue diciendo lo mismo, aunque su id siga existiendo.",
     "trampa": "Guardar solo el chunk_id. Después de una re-ingesta, wiki:2010#001 sigue existiendo, pero con otro texto: el id no prueba que sea la misma fuente."},
    {"id": "tipos-pregunta", "termino": "Tipos de pregunta", "en": "single-hop, multi-hop, unanswerable, access-denied",
     "def": "Directa (la respuesta está en un documento), con varias fuentes (hay que juntar dos o más), sin respuesta (no está en ningún documento) y prohibida (existe, pero quien pregunta no la puede ver).",
     "analogia": "Como un examen con preguntas de memoria, de relacionar, con trampa («ninguna de las anteriores») y una que no es para ti: cada una prueba una habilidad distinta.",
     "importa": "Con puras directas, un sistema que siempre contesta algo saca buena calificación. Las sin respuesta prueban que no invente; las prohibidas, que no se salte los permisos.",
     "trampa": "Una prohibida no se valida sola: si la persona sí puede ver una de sus fuentes, ya no es prohibida, y si una directa trae una fuente que la persona no ve, el gate premia una fuga."},
    {"id": "abstencion", "termino": "Abstenerse", "en": "abstention, refusal",
     "def": "Que el asistente conteste «no está en los documentos que puedo consultar» en lugar de inventar. Es la respuesta de referencia de las sin respuesta y de las prohibidas.",
     "analogia": "Como un buen empleado de ventanilla: si no sabe, dice «eso no lo tengo» en vez de inventar un trámite.",
     "importa": "En una prohibida, la respuesta es la misma que en una sin respuesta: decir «no tienes permiso para el caso Transportes del Norte» ya revela que el caso existe.",
     "trampa": "Medir solo cuántas contesta bien. Un sistema que contesta todo saca buena nota si el examen no trae preguntas sin respuesta."},
    {"id": "json-schema", "termino": "JSON Schema", "en": "JSON Schema (Draft 2020-12)",
     "def": "Un archivo JSON que describe cómo tiene que verse otro JSON: qué campos lleva, de qué tipo, qué valores se valen. La librería jsonschema revisa un documento contra él.",
     "analogia": "Como el formulario de un trámite con sus casillas: si una casilla obligatoria está vacía o dice algo que no se vale, el trámite regresa antes de que alguien lo lea.",
     "importa": "Atrapa los errores de forma (falta la respuesta, un tipo que no existe, una sin respuesta con fuentes) en cuanto llega la candidata, con todos sus errores a la vez.",
     "trampa": "Usar validate(), que lanza un solo error (el que juzga más importante): el experto corrige uno, lo vuelve a mandar y le sale el siguiente. iter_errors() da todos."},
    {"id": "casi-iguales", "termino": "Preguntas casi iguales", "en": "near-duplicates, Jaccard similarity",
     "def": "Dos preguntas que dicen lo mismo con casi las mismas palabras. Se miden con la similitud de Jaccard: palabras en común entre palabras en total, de 0 a 1.",
     "analogia": "Como dos alumnos que entregan la misma tarea con sinónimos: el profesor no las cuenta como dos tareas distintas.",
     "importa": "Una pregunta repetida pesa doble en el promedio: si el sistema la falla, el examen dice que falla el doble. Y si una copia cae en dev y otra en test, lo que se miró en dev se filtra al examen.",
     "trampa": "Subir el umbral hasta que «ya no rechaza nada»: con 0.95 solo se atrapan las idénticas. El umbral sale de mirar pares reales del propio corpus."},
    {"id": "splits", "termino": "Dev y test", "en": "dev/test split, held-out set",
     "def": "Dos partes del golden set: dev, donde se vale mirar y probar ideas, y test, que solo se usa para la calificación del gate.",
     "analogia": "Como los ejercicios de práctica y el examen final: practicas con los primeros todo lo que quieras; el segundo solo se ve el día del examen.",
     "importa": "Si afinas mirando test, terminas con un sistema que sabe contestar justo esas preguntas y nada más: el número sube y el sistema no mejoró.",
     "trampa": "Pensar que con dev pequeño basta para todo: dev sirve para iterar rápido, pero la decisión se toma con test."},
    {"id": "split-hash", "termino": "Split por hash", "en": "deterministic hash-based split",
     "def": "Cada pregunta cae en dev o en test según un hash (sha256) de su id: siempre el mismo lado, sin importar el orden ni cuántas haya.",
     "analogia": "Como asignar casilleros por la terminación de tu matrícula: no depende de quién llegó primero, y el año que viene te toca el mismo.",
     "importa": "Las preguntas nuevas se reparten solas y las viejas no se mueven, así que las calificaciones de versiones distintas se pueden comparar.",
     "trampa": "Cambiar la «sal» o el porcentaje: el hash cambia y más de un tercio del examen se mueve de lado (37.5 % con 75/25). Por eso armar.py congela el split que ya tenía cada id."},
    {"id": "contaminacion", "termino": "Contaminación", "en": "test contamination, data leakage",
     "def": "Cuando lo que está en test se usa para construir o afinar el sistema (ejemplos del prompt, datos de entrenamiento): el examen deja de medir si sabe y mide si se acuerda.",
     "analogia": "Como filtrar el examen a un alumno: saca 10, pero no aprendió nada.",
     "importa": "En un RAG no se entrena, pero el equipo del prompt elige ejemplos (few-shot) y prueba a mano. Si toma preguntas de test, el gate deja de servir sin que nadie lo note.",
     "trampa": "«Regresarla» a dev cuando se contamina: el sistema ya la vio y además el split se movería. Se quema: sale del golden y no vuelve."},
    {"id": "version-inmutable", "termino": "Versión inmutable", "en": "immutable versioned dataset, write-once",
     "def": "Cada versión del golden set se publica una vez y nunca se cambia. Si algo cambia, sale una versión nueva (golden-v3), y la vieja se queda igual para siempre.",
     "analogia": "Como las ediciones de un libro: si la segunda edición corrige una errata, la primera sigue impresa igual, y cuando alguien cita «primera edición» todos saben qué texto es.",
     "importa": "«El sistema sacó 90 % con golden-v2» tiene que significar lo mismo hoy y en seis meses. Si alguien edita golden-v2, dos corridas «con la misma versión» midieron exámenes distintos.",
     "trampa": "Confiar en el disco de cada quien: el sha256 del manifiesto local se puede recalcular. La copia que manda es la del registro, que nadie puede sobrescribir."},
    {"id": "manifiesto", "termino": "Manifiesto y sha256", "en": "manifest, checksum",
     "def": "Un archivo junto a cada versión que dice qué es: su sha256 (la huella del archivo de preguntas), con qué corpus y qué directorio se armó, cuántas hay de cada tipo y qué cambió.",
     "analogia": "Como la etiqueta de un lote de medicinas: número de lote, fecha y de dónde salió, para que cualquiera compruebe que la caja es la que dice.",
     "importa": "Con el sha256, cualquiera comprueba en un segundo que tiene exactamente la versión que dice tener. El corpus y el directorio dicen contra qué está anclada.",
     "trampa": "Un sha256 que se recalcula junto con el archivo no prueba nada: hay que compararlo con el que quedó escrito al publicar, en el registro."},
    {"id": "cuotas", "termino": "Cuotas por tipo", "en": "coverage quotas, stratification",
     "def": "Un mínimo de cada tipo de pregunta (en C11: 15 % con varias fuentes, 10 % sin respuesta, 10 % prohibidas) para que una versión se publique.",
     "analogia": "Como un examen que por reglamento trae preguntas de cada unidad: no se vale que salga solo de la unidad fácil.",
     "importa": "Una limpieza o un lote nuevo puede dejar fuera un tipo entero sin que nadie lo note: la cuota detiene la publicación.",
     "trampa": "Bajar la cuota a 0 para que «deje publicar»: el aviso existía justo para eso."},
    {"id": "reanclaje", "termino": "Reanclar", "en": "re-anchoring, source remapping",
     "def": "Después de una re-ingesta, llevar cada fuente al chunk nuevo que tiene su texto: por texto idéntico (sha) o por contenido (el texto viejo está dentro de uno nuevo). Si no lo encuentras, revisa un experto.",
     "analogia": "Como actualizar las direcciones de tu agenda cuando la ciudad cambia la numeración de las calles: la casa es la misma, el número es otro; si la casa ya no existe, la borras.",
     "importa": "Sin reanclar, el gate cuenta como fallo un chunk que sí trae la respuesta y el recall «baja» sin que el buscador cambie.",
     "trampa": "Reanclar por el id «porque sigue existiendo», o dar por buena una pregunta cuyo texto cambió: su respuesta de referencia puede ser la de antes."},
    {"id": "margen", "termino": "Margen de error", "en": "confidence interval, margin of error",
     "def": "Cuánto se puede mover un porcentaje medido con n preguntas solo por cuáles tocaron: al 95 %, ≈ 1.96 × √(p(1 − p)/n).",
     "analogia": "Como una encuesta: con 50 personas, «el 85 % prefiere A» puede ser 75 % o 95 %; con 600, ya es 82 % a 88 %.",
     "importa": "Una diferencia más chica que el margen no es una mejora: es ruido. Decide cuántas preguntas necesita el golden set.",
     "trampa": "Reportar «recall 90.5 %» sin el ± : con 37 preguntas son ± 7 puntos."},
    {"id": "regla-de-tres", "termino": "Regla de tres", "en": "rule of three",
     "def": "Si en n intentos no viste ninguna falla, la tasa real de fallas puede ser hasta ≈ 3/n con 95 % de confianza.",
     "analogia": "Como probar 10 paracaídas y que todos abran: no prueba que nunca fallen; solo que fallan, cuando mucho, ≈ 3 de cada 10.",
     "importa": "Convierte «cero fugas» en un número honesto: con 6 prohibidas, la tasa real puede llegar a ≈ 50 % (la cuenta exacta, 1 − 0.05^(1/n), da 39 %; 3/n es buena con n grande).",
     "trampa": "Leer «0 de 6» como «0 %»."},
    {"id": "pareada", "termino": "Comparación pareada", "en": "paired comparison",
     "def": "Comparar dos versiones del sistema con las mismas preguntas y mirar la diferencia pregunta por pregunta, no los dos promedios por separado.",
     "analogia": "Como comparar dos tenis haciendo que la misma persona corra con uno y con otro: quitas la diferencia entre corredores.",
     "importa": "Las preguntas difíciles son difíciles para los dos sistemas: al restar pregunta por pregunta, ese ruido se cancela y el margen se achica (en el dojo, de ± 7.4 a ± 4.6 puntos).",
     "trampa": "Comparar contra un número de otra versión del golden: ya no son las mismas preguntas."},
]

e["mundo"] = {
    "resumen": "El kit trae el marketplace ficticio del caso el <b>21 de noviembre a las 11:00</b>, cuando ya pasó la mañana de la estación 3: el corpus con <b>154 chunks de 105 documentos</b>, cada uno con su ACL; el directorio de <b>14 personas</b> con los cambios de la mañana; <b>79 preguntas candidatas</b> que mandaron los expertos de soporte, operaciones, legal, recursos humanos, fraude y finanzas (con los errores de verdad que se cuelan: una repetida, un id usado dos veces, un chunk que no existe, una directa para alguien que ya no tiene permiso…); y <b>7 ejemplos</b> con los que afina el equipo del prompt. Tú escribes el golden set: el esquema y sus reglas, las casi iguales, los splits, la contaminación, la publicación y el reanclaje. Después llega la re-ingesta del 22 y lo reanclas.",
    "trae": [
        {"que": "mundo/entrada/corpus/", "detalle": "Tres versiones del corpus: la del 21 es el índice que dejó la estación 3 a las 10:30, corriendo su kit con su solución; la del 22 trae una sección nueva que corre la numeración, una tabla editada (tiempos de reembolso), un documento borrado (una minuta) y dos chunks que se juntan; la del 23, la de una falla, junta los chunks de dos en dos (chunks de 800 tokens)."},
        {"que": "El directorio", "detalle": "El de las 10:30 del 21 (Tomás ya salió de fraude, Diego entró a soporte, Luis ya no es de soporte) y, para una falla, la foto de las 9:00."},
        {"que": "Las candidatas de los expertos", "detalle": "79 preguntas: 37 directas, 13 con varias fuentes, 9 sin respuesta, 10 prohibidas y 10 con errores. Varias vienen de consultas reales del piloto («origen»: «consulta»)."},
        {"que": "Los ejemplos de afinado", "detalle": "Los few-shot del equipo del prompt. Uno se parece a una pregunta de test (la quema) y otro es igual a una de dev (se vale)."},
        {"que": "El registro y el gate", "detalle": "<code>almacen/registro/</code> es el bucket: <code>subir()</code> de <code>_comun.py</code> escribe cada versión una vez, de solo lectura. <code>mundo/evaluar.py</code> mide recall@8 y permisos con el buscador de juguete de la estación 3: un adelanto de la estación 9."},
        {"que": "verificar.py y romper.py", "detalle": "Los 11 checks de la estación (de <code>mundo</code> a <code>reanclaje</code>) y las 6 fallas: fuente que ya no existe tras re-ingestar, preguntas casi iguales, sin preguntas sin respuesta, directorio viejo, versión pisada y golden contaminado."},
    ],
    "tu_pipeline": [
        {"archivo": "esquema/candidata.schema.json", "hace": "Paso 1: el JSON Schema de una candidata."},
        {"archivo": "pipeline/esquema.py", "hace": "Pasos 1 y 2: la forma con jsonschema, y las reglas de cada tipo con el corpus y los permisos."},
        {"archivo": "pipeline/parecidas.py", "hace": "Paso 3: la similitud de Jaccard y las casi iguales del mismo tipo."},
        {"archivo": "pipeline/splits.py", "hace": "Paso 4: dev o test por hash del id, con los de antes congelados."},
        {"archivo": "pipeline/contaminacion.py", "hace": "Paso 5: las de test que se parecen a un ejemplo de afinado."},
        {"archivo": "pipeline/publicar.py y pipeline/armar.py", "hace": "Paso 6: armar una versión con todo lo anterior y publicarla una vez, con su manifiesto, en el registro."},
        {"archivo": "pipeline/reanclar.py", "hace": "Paso 7: el mapa de chunks de una re-ingesta a la siguiente y la versión nueva."},
        {"archivo": "config.yaml", "hace": "El umbral de parecidas, la sal y el porcentaje de test, y las cuotas de cada tipo."},
    ],
    "requisitos": [
        "Python 3.10 o más nuevo (se probó con 3.14.3) y ≈ 20 MB para el entorno virtual",
        "Internet solo para el <code>pip install</code> (pyyaml 6.0.3 y jsonschema 4.26.0, con sus dependencias fijadas)",
        "Las estaciones 1 a 3 ayudan, pero no hacen falta: el kit trae su salida",
    ],
    "sustituciones": [
        {"nube": "El bucket del golden set: Object Lock y PUT con «If-None-Match: *»", "local": "<code>almacen/registro/</code> y <code>subir()</code>, que se niega a sobrescribir", "diferencia": "La misma idea: lo publicado no se puede reescribir. En S3 lo hace cumplir el servicio; aquí, una carpeta de solo lectura y una función."},
        {"nube": "La ingestión que corre cada noche", "local": "<code>python mundo/avanzar.py</code>, que pone la versión del corpus del día", "diferencia": "En C11 la re-ingesta cambia millones de chunks; aquí, unos cuantos, siempre los mismos."},
        {"nube": "El repositorio donde los expertos escriben sus preguntas", "local": "<code>almacen/candidatos/*.jsonl</code>", "diferencia": "En C11 es un repositorio con revisión de cambios o una herramienta de anotación; aquí, un archivo por lote."},
        {"nube": "El gate de la estación 9 (buscador, reranker y LLM)", "local": "<code>mundo/evaluar.py</code> con el buscador de juguete", "diferencia": "Solo mide recall@8 y permisos; la faithfulness y las citas necesitan el LLM."},
    ],
    "arranque": "unzip rag-golden.zip && cd rag-golden\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/crear.py",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El almacén del 21 a las 11:00 en <code>almacen/</code>: el corpus de la estación 3, el directorio, las candidatas de los expertos, los ejemplos de afinado y un registro vacío.",
    conceptos=["golden-set"],
    explica="Hacen falta pyyaml y jsonschema. <code>mundo/crear.py</code> copia de <code>mundo/entrada/</code> a <code>almacen/</code> el corpus del 21 (también al historial, que guarda cada versión del corpus), el directorio, las candidatas y los ejemplos, y pone el reloj del mundo el 21 de noviembre a las 11:00 de Ciudad de México. Tu pipeline lee <code>almacen/</code> y escribe en <code>golden/</code>.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} esquema", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="La hora del mundo no es la de tu Mac: vive en <code>almacen/mundo.json</code> y la lees con <code>ahora()</code> de <code>_comun.py</code>. La re-ingesta del paso 7 la mueve al 22."))
G.append(dict(n=1, id="esquema", titulo="La forma de una candidata", objetivo="<code>esquema/candidata.schema.json</code> y <code>estructura()</code>: lo que tiene que traer una pregunta para entrar, revisado con jsonschema, con todos sus errores a la vez.",
    conceptos=["golden-set", "respuesta-referencia", "json-schema"],
    explica="Cada candidata es un JSON con <code>id</code> (G- y tres dígitos), <code>pregunta</code>, <code>respuesta</code> (la de referencia), <code>tipo</code>, <code>persona</code> (quién la hace), <code>fuentes</code> (chunk_ids), <code>corpus</code> (con qué versión del corpus la escribió el experto), <code>origen</code> y <code>autor</code>. El esquema dice todo eso: <code>required</code>, el <code>type</code> y el <code>pattern</code> de cada campo, <code>enum</code> para el tipo, <code>uniqueItems</code> para que no repita fuentes y <code>additionalProperties: false</code> para que no traiga campos inventados. Lo mejor de JSON Schema para esto es <code>if</code>/<code>then</code> (existe desde Draft 7): si el tipo es sin_respuesta, las fuentes tienen que estar vacías; si es directa o prohibida, al menos una; si es con varias fuentes, al menos dos. <code>estructura()</code> usa <code>Draft202012Validator(...).iter_errors()</code>, que da todos los errores, y <code>check_schema()</code> antes, para que un esquema mal escrito truene en tu cara y no en la del experto.",
    codigo=[{"lang": "json", "path": "esquema/candidata.schema.json", "code": code("esquema/candidata.schema.json"), "nota": ""},
            py("pipeline/esquema.py", "En este paso solo escribes <code>estructura()</code> (y el <code>_validador()</code> que la ayuda). <code>reglas()</code> es el paso 2.")],
    comandos=[
        cmd(P("p1 estructura"), L("p1 estructura"), "Tres de las 79 no pasan la forma: una sin respuesta que trae fuente, un tipo que no existe y una respuesta vacía. Con dos fallas a la vez, salen las dos."),
        cmd(f"{V} esquema", L("p1 verificar")),
    ],
    verifica="<code>verificar.py esquema</code> en verde: una candidata bien hecha pasa, 11 mal hechas no, y una con dos errores los da los dos.",
    ojo="<code>additionalProperties: false</code> va en serio: si mañana alguien agrega un campo (por ejemplo «dificultad»), primero se agrega al esquema. Así el esquema es el contrato entre los expertos y el pipeline, y cambia con una versión nueva, no en silencio."))
G.append(dict(n=2, id="reglas", titulo="Lo que significa cada tipo", objetivo="<code>reglas()</code>: que las fuentes existan, que la persona esté, que cada tipo sea lo que dice, y los permisos de la estación 3: una directa que la persona no puede ver, fuera.",
    conceptos=["tipos-pregunta", "abstencion", "fuente-anclada"],
    explica="La forma no basta: <code>wiki:1040#001</code> cumple el patrón de un chunk_id y no existe. <code>reglas()</code> recibe la candidata, el corpus y el directorio. Revisa que cada fuente esté en <code>corpus[\"chunks\"]</code>, que la persona esté en el directorio, que una <b>directa</b> salga de un solo documento y una <b>con varias fuentes</b> de dos o más (dos chunks del mismo documento no cuentan), y los permisos con <code>principals()</code> y <code>puede_ver()</code> de la estación 3: en una directa o con varias fuentes, la persona tiene que poder ver todas sus fuentes; en una <b>prohibida</b>, ninguna. La respuesta de referencia de las sin respuesta y de las prohibidas es la misma: «No está en los documentos que puedo consultar». Lo que no pasa no se arregla solo: va a rechazadas con su motivo y el experto lo corrige.",
    codigo=[],
    comandos=[
        cmd("python pipeline/esquema.py almacen/candidatos/expertos.jsonl", L("p2 lote", filtro=r"✗|^    |con problemas"),
            "Las de arriba pasan (aquí solo se muestran las que no). G-039 la escribió el experto de fraude cuando Tomás era de su equipo: desde las 9:18 Tomás ya no puede ver los tickets de fraude. G-083 dice «varias» y sus dos fuentes son del mismo documento."),
        cmd(f"{V} reglas", L("p2 verificar")),
    ],
    verifica="<code>verificar.py reglas</code> en verde: los 10 casos (fuente que no existe, persona que no ve su fuente, prohibida que sí ve, «varias» de un solo documento, persona que no está).",
    ojo="Una pregunta prohibida y su versión directa para otra persona son un par valioso: G-024 (Jorge sí ve las tarifas de Sonora) y G-070 (Hugo ya no). Prueban justo el filtro de la estación 3."))
G.append(dict(n=3, id="parecidas", titulo="Preguntas casi iguales", objetivo="<code>parecidas.py</code>: la similitud de Jaccard entre preguntas y quitar las casi iguales del mismo tipo, con las ya publicadas como ganadoras.",
    conceptos=["casi-iguales"],
    explica="<code>similitud()</code> toma las palabras de cada pregunta con <code>palabras()</code> (minúsculas, sin acentos, sin las vacías como «que» o «cuanto») y divide las que tienen en común entre todas las que hay. «¿Cuánto tarda en verse un reembolso a tarjeta de débito?» y «¿Cuántos días tarda en verse el reembolso en una tarjeta de débito?» comparten 5 de 6: 0.83. Solo se comparan preguntas del <b>mismo tipo</b>: la misma pregunta como directa para Jorge y como prohibida para Hugo prueba cosas distintas. <code>quitar()</code> recorre de la más vieja a la más nueva (primero las publicadas, luego por id) y se queda con la primera de cada grupo. El umbral (0.6) salió de mirar los pares reales: las preguntas distintas más parecidas de este lote llegan a 0.57.",
    codigo=[py("pipeline/parecidas.py")],
    comandos=[
        cmd(P("p3 pares"), L("p3 pares"), "G-080 es la misma pregunta que G-001, mandada por operaciones; G-081, la misma que G-002 con otras palabras."),
        cmd(P("p3 umbral"), L("p3 umbral"), "Con 0.5 ya se cuelan pares que no son la misma pregunta (crédito contra pago en tienda; SEG-1 contra SEG-5). Por eso 0.6."),
        cmd(f"{V} parecidas", L("p3 verificar")),
    ],
    verifica="<code>verificar.py parecidas</code> en verde: Jaccard bien calculado, los pares solo del mismo tipo y la ya publicada gana.",
    ojo="Jaccard sobre palabras es una regla simple y se puede engañar: dos preguntas con las mismas palabras en otro orden dan 1.0, y dos con sinónimos («costo» y «precio») dan poco. En C11 se usa además la similitud de los embeddings (estación 5) y una persona revisa los pares dudosos."))
G.append(dict(n=4, id="splits", titulo="Splits que no se mueven", objetivo="<code>splits.py</code>: dev o test por un hash del id, y los que ya tenían split se quedan donde estaban.",
    conceptos=["splits", "split-hash"],
    explica="<code>split_de()</code> calcula el sha256 de <code>\"golden-c11|G-001\"</code>, toma los primeros 8 caracteres hexadecimales, los vuelve un número y saca el residuo entre 100: si es menor que 75, test; si no, dev. Depende solo del id: ni del orden en que llegaron las preguntas, ni de cuántas hay, ni de la hora. <code>asignar()</code> le da a cada id nuevo su <code>split_de()</code>, pero a uno que ya salió en una versión le respeta el split que tenía, aunque alguien haya cambiado la sal o el porcentaje en <code>config.yaml</code>.",
    codigo=[py("pipeline/splits.py")],
    comandos=[
        cmd("python pipeline/splits.py G-001 G-009 G-015 G-034", L("p4 splits")),
        cmd(P("p4 conteo"), L("p4 conteo"), "Con otra sal, el reparto cambia (G-002 y G-005 pasan a dev). Por eso la sal no se toca, y por eso <code>asignar()</code> congela lo de antes."),
        cmd(f"{V} splits", L("p4 verificar")),
    ],
    verifica="<code>verificar.py splits</code> en verde: tu <code>split_de()</code> da lo mismo que el de la referencia en 399 ids (≈ 75 % a test) y <code>asignar()</code> respeta lo de antes.",
    ojo="75 % a test no es una regla universal: con un golden chico, test necesita la mayoría para que su margen sea útil, y dev queda para probar ideas rápido. Con 79 candidatas, dev tiene ≈ 15: sirve para iterar, no para decidir."))
G.append(dict(n=5, id="contaminacion", titulo="La regla de contaminación", objetivo="<code>contaminadas()</code>: las preguntas de test que se parecen a un ejemplo con el que afina el equipo del prompt.",
    conceptos=["contaminacion", "splits"],
    explica="En un RAG nada se entrena, pero sí se afina: el equipo del prompt escoge ejemplos para el prompt (few-shot) y prueba a mano con preguntas. La regla: <b>lo que está en test nunca se usa para afinar</b>; dev sí. <code>contaminadas()</code> compara cada pregunta de test contra cada ejemplo de <code>almacen/afinado/ejemplos.jsonl</code> con la misma <code>similitud()</code> y el mismo umbral, y devuelve las que se parecen. Las de dev no cuentan. Una contaminada no se «regresa» a dev: se <b>quema</b> (sale del golden y no vuelve nunca), porque el sistema ya la vio y porque su split no se mueve.",
    codigo=[py("pipeline/contaminacion.py", "La función es lo del paso. El <code>__main__</code> revisa la versión vigente: lo vas a usar desde el paso 6.")],
    comandos=[
        cmd("cat almacen/afinado/ejemplos.jsonl", L("p5 afinado")),
        cmd(P("p5 contra"), L("p5 contra"), "A-06 se parece 0.8 a G-015, que es de test: G-015 se quema. A-07 es idéntico a G-009, pero G-009 es de dev: se vale."),
        cmd(f"{V} contaminacion", L("p5 verificar")),
    ],
    verifica="<code>verificar.py contaminacion</code> en verde: G-015 contra A-06 sí, G-009 (dev) no.",
    ojo="La regla va en los dos sentidos: también le dices al equipo del prompt de dónde salen sus ejemplos (de dev o de fuera del golden). El check solo atrapa lo que se parece en palabras; si alguien copia la idea con otras palabras, nadie lo ve. Es un acuerdo entre equipos, no solo un script."))
G.append(dict(n=6, id="publicar", titulo="Armar y publicar golden-v1", objetivo="<code>armar.py</code> junta todo y <code>publicar.py</code> escribe la versión una sola vez: preguntas, rechazadas y manifiesto en <code>golden/</code> y en el registro, y <code>VIGENTE</code> al final.",
    conceptos=["version-inmutable", "manifiesto", "cuotas"],
    explica="<code>armar.py</code> sigue el orden del contrato: lee las candidatas, el corpus, el directorio y los ejemplos; a cada candidata le pasa <code>estructura()</code>, revisa id repetido y quemadas, traduce sus fuentes al corpus vigente (en v1 no hay nada que traducir) y le pasa <code>reglas()</code>; reparte splits, quita las casi iguales y quema las contaminadas; revisa las <b>cuotas</b> de <code>config.yaml</code> y, si algo cambió contra la vigente, publica. Cada pregunta publicada guarda sus fuentes como <code>{chunk_id, doc_id, sha}</code>. <code>publicar()</code> escribe en una carpeta temporal, la renombra a <code>golden/golden-v1/</code>, la sube al registro con <code>subir()</code> (que se niega si ya existe), agrega su línea a <code>versiones.jsonl</code> y al final escribe <code>VIGENTE</code>: si algo truena a la mitad, el gate sigue usando la versión anterior.",
    codigo=[py("pipeline/publicar.py", "<code>versiones()</code>, <code>siguiente()</code> y <code>vigente()</code> vienen dadas."),
            py("pipeline/armar.py", "<code>candidatas()</code> viene dada. <code>traducir()</code> se usa de verdad en el paso 7.")],
    comandos=[
        cmd("python pipeline/armar.py", L("p6 armar"), "De 79 candidatas quedan 69: los 10 errores de los expertos salieron cada uno con su motivo, en <code>golden/golden-v1/rechazadas.jsonl</code>."),
        cmd(P("p6 manifiesto"), L("p6 manifiesto")),
        cmd("grep '\"G-041\"' golden/golden-v1/preguntas.jsonl", L("p6 una"), "Una pregunta publicada: con varias fuentes, de test, con el chunk, el documento y la huella de cada fuente."),
        cmd("python pipeline/armar.py", L("p6 otra vez"), "Correrlo otra vez sin cambios no publica nada: una versión nueva sale solo si cambió algo."),
        cmd(P("p6 pisar"), L("p6 pisar"), "Ni siquiera a propósito: el registro no deja escribir una versión que ya tiene."),
        cmd("python pipeline/publicar.py --comprobar", L("p6 comprobar")),
        cmd(f"{V} publicar cobertura permisos fuentes", L("p6 verificar")),
    ],
    verifica="<code>verificar.py publicar cobertura permisos fuentes</code> en verde: golden-v1 igual en <code>golden/</code>, en su manifiesto, en <code>versiones.jsonl</code> y en el registro; con los cuatro tipos sobre su cuota; con los permisos de verdad; y con cada fuente igual a su chunk.",
    ojo="El manifiesto guarda la foto del directorio con la que se validaron los permisos (<code>directorio</code>). Si mañana alguien cambia de equipo, las preguntas de esa persona pueden dejar de tener sentido: la versión siguiente se arma con la foto nueva y el manifiesto lo dice."))
G.append(dict(n=7, id="reanclaje", titulo="La re-ingesta del 22 y el reanclaje", objetivo="<code>reanclar.py</code>: el mapa de cada chunk del corpus del 21 al del 22 (por sha, por contenido, cambio o borrado) y golden-v2 con las fuentes nuevas.",
    conceptos=["reanclaje", "fuente-anclada"],
    explica="La noche del 21 corre la ingestión otra vez (<code>mundo/avanzar.py</code>). El golden sigue apuntando al corpus del 21, y <code>armar.py</code> se niega a mezclar: no hay anclas. <code>mapa()</code> recorre cada chunk viejo y busca en el mismo documento del corpus nuevo, en orden: un chunk con <b>el mismo texto</b> (sha: la numeración se corrió, el texto es el mismo); uno que <b>contiene</b> el texto viejo sin su ruta de títulos (contenido: se juntó con otro); si el documento sigue pero nadie tiene ese texto, <b>cambio</b> (un experto revisa la respuesta); si el documento ya no está, <b>borrado</b> (la pregunta se retira). <code>main()</code> agrega ese paso a <code>golden/anclas.json</code> y llama a <code>armar.main()</code>, que traduce las fuentes de cada candidata con <code>traducir()</code> y publica golden-v2. Las candidatas no se tocan: siguen como las escribió el experto, con el corpus del 21; las anclas las llevan al de hoy.",
    codigo=[py("pipeline/reanclar.py")],
    comandos=[
        cmd("python mundo/avanzar.py", L("p7 avanzar")),
        cmd(f"{V} fuentes", L("p7 fuentes")),
        cmd("python pipeline/armar.py", L("p7 armar")),
        cmd("python pipeline/reanclar.py", L("p7 reanclar"), "10 preguntas tocadas: 6 se reanclan solas, 3 van a revisión (su tabla de tiempos de reembolso cambió: la respuesta de referencia puede ser la de antes) y 1 se retira (la minuta del 6 de noviembre se borró)."),
        cmd(P("p7 cambios"), L("p7 cambios"), "wiki:2010#001 sigue existiendo y ya no es el mismo texto: ahora trae también la sección de paquetes perdidos. Por eso se reancla por contenido, no por id."),
        cmd(f"{V} fuentes reanclaje", L("p7 verificar")),
    ],
    verifica="<code>verificar.py fuentes reanclaje</code> en verde: golden-v2 anclada al corpus del 22, cada fuente con su texto, y cada pregunta de golden-v1 donde la referencia dice (65 siguen, 1 retirada, 3 a revisión).",
    ojo="Buscar «el texto viejo dentro de uno nuevo» también acepta un chunk al que le agregaron algo al final, aunque ese algo cambie el sentido («… ya no aplica desde diciembre»). Es una regla que acierta casi siempre, no una prueba: en C11, lo reanclado por contenido también lo mira alguien de vez en cuando."))
G.append(dict(n=8, id="gate", titulo="Lo que va a medir el gate", objetivo="Medir con golden-v2 el buscador de juguete: recall@8 con su margen, permisos con y sin filtro, y comparar dos versiones del buscador con las mismas preguntas.",
    conceptos=["margen", "regla-de-tres", "pareada"],
    explica="<code>mundo/evaluar.py</code> es un adelanto de la estación 9 con el buscador de la estación 3 (cuántas palabras de la pregunta aparecen en el chunk, con el filtro de permisos antes del top-8). <b>recall@8</b>: de las fuentes de cada pregunta directa o con varias fuentes, qué fracción llega entre los 8 chunks; luego el promedio, con su <b>margen</b> al 95 %. <b>Permisos</b>: ninguna prohibida puede recibir una de sus fuentes, y nadie un chunk que no ve. Con <code>--comparar</code>, una versión del buscador que compara raíces de 5 letras («reembolsa» y «reembolso» cuentan igual): la diferencia se mide pregunta por pregunta (<b>pareada</b>).",
    codigo=[],
    comandos=[
        cmd("python mundo/evaluar.py", L("p8 evaluar"), "90.5 % con 37 preguntas: puede ser cualquier cosa entre 83 % y 98 %."),
        cmd("python mundo/evaluar.py --sin-filtro", L("p8 sin filtro"), "Sin el filtro de permisos, el recall ni se mueve, pero 5 de las 6 prohibidas reciben su fuente y llegan 92 chunks ajenos. Por eso las prohibidas van en el golden: el recall solo no lo ve."),
        cmd("python mundo/evaluar.py --comparar", L("p8 comparar"), "+1.4 puntos ± 4.6: con este examen, no se puede decir que las raíces ayuden. Y el margen pareado (± 4.6) es más chico que el de cada promedio por separado (± 7.4)."),
        cmd("python mundo/evaluar.py --split dev", L("p8 dev"), "En dev, 100 % con 9 preguntas: dev es para probar ideas, no para decidir. Con 100 % la fórmula da ± 0, pero no es certeza: con pocas preguntas, la regla de tres dice cuánto puede faltar (aquí, hasta ≈ 30 %)."),
        cmd(V, L("p8 verificar")),
    ],
    verifica="<code>verificar.py</code> completo: 11/11 en verde.",
    ojo="Este buscador saca 90 % porque las preguntas usan las mismas palabras que los documentos: los expertos las escribieron leyéndolos. Las preguntas reales de la gente usan otras palabras. Por eso el golden mezcla preguntas de consultas reales («origen»: «consulta») y por eso en C11 se van agregando preguntas del tráfico de verdad, en versiones nuevas."))

EN_PAGINA = {1: (["golden-set", "respuesta-referencia", "json-schema"], []), 2: (["tipos-pregunta", "abstencion", "fuente-anclada"], []),
             3: (["casi-iguales"], ["pares"]), 4: (["splits", "split-hash"], ["splits"]), 5: (["contaminacion"], []),
             6: (["version-inmutable", "manifiesto", "cuotas"], []), 7: (["reanclaje"], ["costo"]), 8: (["margen", "regla-de-tres", "pareada"], ["cuantas", "fugas"])}
for g in G:
    if g["n"] in EN_PAGINA:
        g["en_pagina"] = {"conceptos": EN_PAGINA[g["n"]][0], "precalculos": EN_PAGINA[g["n"]][1]}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto, borra <code>golden/</code> y vuelve al 21 a las 11:00.",
        "Sin GUION.md ni <code>mundo/referencia.py</code> ni <code>mundo/entrada/</code>: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El almacén del 21 a las 11:00 en su lugar.", "check": "mundo"},
        {"n": 2, "objetivo": "Un JSON Schema que deja pasar una candidata bien hecha y atrapa las mal hechas, todos sus errores a la vez, incluido que las fuentes cuadren con el tipo.", "check": "esquema", "pista": "¿Qué palabra de Draft 2020-12 dice «si el tipo es tal, entonces las fuentes…»?"},
        {"n": 3, "objetivo": "Las reglas de cada tipo: fuentes que existen, persona que está, un documento o varios, y los permisos de cada persona en las directas, las de varias fuentes y las prohibidas.", "check": "reglas", "pista": "¿Una prohibida en la que la persona sí ve una fuente sigue siendo prohibida?"},
        {"n": 4, "objetivo": "Jaccard sobre palabras, pares solo del mismo tipo, y al quitar gana la ya publicada. Ninguna casi igual en lo publicado.", "check": "parecidas"},
        {"n": 5, "objetivo": "Dev o test por hash del id, y nadie cambia de split entre versiones.", "check": "splits", "pista": "¿Qué pasa con un id viejo si alguien cambia la sal?"},
        {"n": 6, "objetivo": "Ninguna pregunta de test se parece a un ejemplo de afinado, y una quemada no vuelve.", "check": "contaminacion"},
        {"n": 7, "objetivo": "Cada versión publicada es igual en golden/, en su manifiesto, en versiones.jsonl y en el registro; VIGENTE es la última.", "check": "publicar"},
        {"n": 8, "objetivo": "La vigente cumple las cuotas del gate de C11 y trae los cuatro tipos en test.", "check": "cobertura"},
        {"n": 9, "objetivo": "Con el directorio de verdad: cada persona ve las fuentes de sus directas y de varias fuentes, y ninguna de sus prohibidas.", "check": "permisos"},
        {"n": 10, "objetivo": "Cada fuente de la vigente existe en el corpus de hoy con el texto que leyó el experto.", "check": "fuentes"},
        {"n": 11, "objetivo": "Después de la re-ingesta del 22, cada pregunta de golden-v1 está donde debe: reanclada, retirada o en revisión.", "check": "reanclaje", "pista": "Si un chunk_id sigue existiendo, ¿es la misma fuente?"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


e["fallas"] = [
    falla("fuente-perdida", "El lunes el recall del gate bajó 20 puntos y nadie tocó el buscador", "infra",
          "El equipo de ingestión subió el tamaño de los chunks a 800 tokens y re-ingestó todo el corpus anoche. Su pipeline salió en verde.",
          "<code>verificar.py fuentes</code> y <code>reanclaje</code> fallan: la vigente sigue anclada al corpus del 22 y hoy es el del 23. Lo que lo delata en la empresa es el gate: el recall bajó sin que nadie cambiara el buscador.",
          ["Alguien cambió el buscador.", "El corpus cambió y el golden apunta a chunks viejos.", "El golden se editó."],
          cmd("python mundo/evaluar.py", F("fue evaluar"), "Antes, 90.5 %. El buscador es el mismo: cambió lo que el examen cree que es la fuente correcta."),
          "<code>python pipeline/reanclar.py</code>: agrega el paso del 22 al 23 a <code>golden/anclas.json</code> (66 chunks por contenido, porque se juntaron de dos en dos, y 85 por sha) y publica la versión siguiente. Un chunk_id que existe no prueba que sea la misma fuente: por eso cada fuente guarda su sha. En C11, la re-ingesta y el reanclaje van en el mismo pipeline: el gate no corre con un golden anclado a un corpus que ya no existe.",
          "reanclaje", "fuentes"),
    falla("casi-duplicadas", "Soporte mandó cuatro preguntas nuevas y el examen ahora cuenta dos veces las mismas", "config",
          "Soporte mandó un lote nuevo de preguntas. Como armar.py «rechazaba preguntas que no eran iguales», alguien subió parecidas.umbral a 0.95.",
          "<code>verificar.py parecidas</code> falla: la vigente trae pares casi iguales (G-001 y G-090, 0.60) y 3 más.",
          ["El lote nuevo trae preguntas repetidas.", "El umbral de parecidas cambió.", "La similitud está mal calculada."],
          cmd("python pipeline/parecidas.py golden/$(cat golden/VIGENTE)/preguntas.jsonl --umbral 0.6", F("dup pares"), "Las cuatro del lote son preguntas que ya estaban, con otras palabras. <code>grep umbral config.yaml</code> dice 0.95."),
          "En <code>config.yaml</code>, <code>parecidas.umbral</code> vuelve a 0.6 y <code>python pipeline/armar.py</code> publica una versión sin ellas (las ya publicadas ganan). El umbral sale de mirar pares reales: en este lote, las preguntas distintas más parecidas llegan a 0.57. Si el umbral rechaza algo que no es repetido, se mira el par, no se sube el umbral a ciegas.",
          "casi-iguales", "parecidas"),
    falla("sin-sin-respuesta", "El asistente inventa una comisión para «Deportes» y el gate lo dejó pasar", "config",
          "En una limpieza, alguien quitó del lote de los expertos «las preguntas que no tenían fuentes» y bajó cuotas.sin_respuesta a 0 para que armar.py no se quejara. La versión nueva salió sin errores.",
          "<code>verificar.py cobertura</code> falla: 0 de 56 preguntas son sin respuesta y el gate de C11 pide al menos 10 %.",
          ["El corpus nuevo ya contesta esas preguntas.", "Alguien quitó las sin respuesta de las candidatas.", "La cuota cambió."],
          cmd(P("sr manifiesto", PROBARF), F("sr manifiesto"), "La versión nueva no trae ninguna sin_respuesta, la cuota quedó en 0.0 y las 9 que había salen en «quitadas»."),
          "Las candidatas vuelven a ser las de los expertos (<code>python mundo/crear.py --candidatos</code> hace de bajarlas otra vez de su repositorio), <code>cuotas.sin_respuesta</code> vuelve a 0.10 y <code>python pipeline/armar.py</code> publica la versión siguiente. Una pregunta sin fuentes no es un error: es la que prueba que el asistente no invente.",
          "abstencion", "cobertura"),
    falla("directorio-viejo", "El gate dice que Tomás tiene que recibir un ticket de fraude", "infra",
          "La sincronización del directorio falló anoche a media copia y alguien puso a mano «la última que funcionaba», la de las 9:00 del 21. El armado de la noche corrió sin errores.",
          "<code>verificar.py permisos</code> falla: la vigente se armó con el directorio de las 9:00 y el de la empresa es el de las 10:30. <code>reglas</code> también: entró G-039.",
          ["Tomás regresó a fraude.", "El directorio con el que se validó es viejo.", "El ticket cambió de permisos."],
          cmd("grep '\"G-039\"' golden/$(cat golden/VIGENTE)/preguntas.jsonl\npython -c \"import json; print('directorio de', json.load(open('almacen/directorio.json'))['foto'])\"", F("dir g039"),
              "G-039 espera que Tomás reciba SEG-5; con la foto de las 9:00, Tomás todavía era de fraude."),
          "<code>python mundo/crear.py --directorio</code> (hace de sincronizar otra vez con el directorio de la empresa) y <code>python pipeline/armar.py</code>: G-039 vuelve a rechazarse, G-071 y G-072 (prohibidas que con la foto vieja «sí ve») y las de Diego vuelven a entrar. El manifiesto guarda la foto con la que se armó cada versión; una alarma útil: no publicar si la foto tiene más de un día.",
          "tipos-pregunta", "permisos"),
    falla("version-pisada", "Dos corridas del gate con la misma versión del golden dan números distintos", "infra",
          "Alguien encontró una errata en una respuesta de la versión vigente y la corrigió ahí mismo, en golden/, con todo y el sha256 del manifiesto «para que cuadre».",
          "<code>verificar.py publicar</code> falla: <code>golden/golden-v2/preguntas.jsonl</code> ya no es la que se publicó; su sha256 no es el del registro.",
          ["El registro se corrompió.", "Alguien editó la versión publicada en su lugar.", "Se publicó una versión nueva con el mismo nombre."],
          cmd("python pipeline/publicar.py --comprobar", F("pis comprobar"), "La copia local y su manifiesto coinciden entre sí (los recalcularon juntos); <code>versiones.jsonl</code> y el registro dicen otra cosa."),
          "<code>python mundo/registro.py bajar golden-v2</code> vuelve a poner la copia del registro. Si de verdad hay una errata, va en las candidatas y sale en la versión siguiente. Comparar un archivo contra un sha256 que se recalcula junto con él no prueba nada: se compara contra lo que quedó escrito al publicar.",
          "version-inmutable", "publicar"),
    falla("contaminado", "El equipo del prompt presume que su versión nueva contesta perfecto el golden", "infra",
          "El equipo del prompt quería ejemplos «de los buenos» para el few-shot y copió tres preguntas del golden, con su respuesta, a sus ejemplos de afinado.",
          "<code>verificar.py contaminacion</code> falla: G-012, de test, es idéntica al ejemplo A-08 de afinado (y 2 más).",
          ["El golden copió preguntas del equipo del prompt.", "El equipo del prompt copió preguntas de test.", "La similitud está mal calculada."],
          cmd("python pipeline/contaminacion.py", F("con cli")),
          "<code>python pipeline/armar.py</code> quema las tres: salen del golden y no vuelven nunca, ni a dev, y la versión siguiente lo anota en su manifiesto. Al equipo del prompt se le dice que sus ejemplos salen de dev o de fuera del golden. Sacar los ejemplos del archivo de afinado no basta: el prompt ya se probó con ellos.",
          "contaminacion", "contaminacion"),
]

e["listo"] = [
    "Cada candidata pasa un JSON Schema y las reglas de su tipo, con los permisos de cada persona; lo que no, va a rechazadas con su motivo.",
    "No hay dos preguntas casi iguales del mismo tipo, y cada una cae en dev o test por un hash que no se mueve.",
    "Nada de test se usa para afinar; lo que se contamina se quema.",
    "Cada versión se publica una vez, con su manifiesto y su sha256, en un registro que no se puede reescribir.",
    "Los cuatro tipos están sobre su cuota, también en test.",
    "Después de cada re-ingesta, cada fuente se reancla al chunk que tiene su texto; lo que cambió, a revisión, y lo borrado, se retira.",
]

e["repaso"] = {
    "memo": "<b>El golden set es un examen fijo: cada pregunta con su respuesta, sus fuentes con su huella, quién la hace y su tipo; validado, sin repetidas, con splits por hash, sin contaminar, en versiones que nunca se pisan y reanclado después de cada re-ingesta.</b> Los cuatro tipos prueban cosas distintas: que encuentre, que junte, que no invente y que no se salte los permisos. Y cada número que salga lleva su margen: con 37 preguntas, ± 7 puntos.",
    "trampa": "Un golden que «funciona» porque nadie lo mira. Sin reanclar, el recall baja sin que nada cambie. Sin preguntas sin respuesta, un sistema que inventa pasa. Con un directorio viejo, el examen premia una fuga. Con una versión editada en su lugar, dos equipos miden con exámenes distintos y los dos tienen razón. Y una mejora de 1.4 puntos con 37 preguntas no es una mejora.",
    "entrevista": [
        {"q": "¿Cómo armas el golden set de un RAG?", "a": "Con expertos de cada equipo que escriben pregunta, respuesta de referencia y fuentes leyendo los documentos, y con preguntas sacadas del tráfico real. Cada una trae quién la hace y su tipo: directa, con varias fuentes, sin respuesta y prohibida para esa persona, con un mínimo de cada tipo. Pasa un esquema y reglas (fuentes que existen, permisos de verdad), quito las casi iguales, reparto dev y test por hash del id y la publico en versiones inmutables con su manifiesto."},
        {"q": "¿Por qué meterías preguntas sin respuesta y prohibidas?", "a": "Porque con puras preguntas que tienen respuesta, un sistema que siempre contesta algo saca buena calificación. Las sin respuesta prueban que diga «no está en los documentos» en vez de inventar; las prohibidas, que el filtro de permisos funcione: sin el filtro, en mi caso el recall ni se movía y 5 de 6 prohibidas recibían su fuente. Y la respuesta de las dos es la misma, para no revelar que el documento existe."},
        {"q": "Re-ingestaste el corpus y el recall bajó 20 puntos. ¿Qué revisas primero?", "a": "Si el golden sigue anclado al corpus viejo. Una re-ingesta corre la numeración de los chunks, los junta o los parte: el examen cuenta como fallo un chunk que sí trae la respuesta. Por eso cada fuente guarda la huella de su texto y reanclo por sha y por contenido; lo que cambió de texto va a revisión de un experto y lo borrado se retira. Solo después de reanclar comparo."},
        {"q": "¿Cuántas preguntas necesita tu golden set?", "a": "Las que hagan falta para ver la diferencia que me importa. Con recall cerca de 85 %, 450 preguntas de test dan ± 3.3 puntos; ver 5 puntos entre dos sistemas con exámenes independientes pediría ≈ 800. Por eso comparo siempre de forma pareada, con las mismas preguntas, que necesita menos. Y para permisos, cero fugas en 90 prohibidas solo dice que la tasa real es menor a ≈ 3 %: por eso también hay una prueba exhaustiva y un monitoreo."},
        {"q": "¿Cómo evitas que el golden set se contamine?", "a": "Regla escrita: lo que está en test nunca se usa para afinar, ni como ejemplo del prompt ni para probar a mano; dev sí. Lo reviso en cada versión contra los ejemplos del equipo del prompt, y lo que se contamina se quema: sale y no vuelve, ni a dev, porque el sistema ya lo vio y porque los splits no se mueven."},
        {"q": "¿Por qué versiones inmutables y no un archivo que se va corrigiendo?", "a": "Porque «90 % con golden-v2» tiene que significar lo mismo hoy y en seis meses. Si alguien corrige una errata en su lugar, dos corridas con la «misma» versión midieron exámenes distintos. Cada versión se escribe una vez: un PUT condicional («If-None-Match: *») rechaza escribir dos veces la misma clave, y Object Lock impide borrar o cambiar lo que ya se escribió; su sha256 queda en un manifiesto, y una corrección es una versión nueva, con su lista de cambios."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-golden/CLAUDE.md",
    "guiado": "content/estaciones/rag-golden/prompts/guiado.md",
    "solo": "content/estaciones/rag-golden/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-golden/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-golden/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-golden.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
