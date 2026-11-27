"""Arma content/estaciones/ia-privada-cuantizacion.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/e2 && bash probar-fallas.sh /ruta/e2     # deja /ruta/e2.log y /ruta/e2-fallas.log
    python3 contenido.py /ruta/e2                                  # escribe el JSON con esas salidas

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
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^cp |^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python3 -c \""):
        c = c.replace("\\\"", "\"")
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def py(rel: str, nota: str = "") -> dict:
    return {"lang": "python", "path": rel, "code": code(rel), "nota": nota}


V = "python3 verificar.py"
# los números de la medición, de los logs
MED = {m[0]: m[1:] for m in re.findall(r"✓ (\S+)\s+decode\s+(\d+) tokens/s · prefill\s+([\d,]+) tokens/s · TTFT corto\s+(\d+) ms · largo\s+(\d+) ms", L("p3 medir"))}
PPL = {m[0]: m[1] for m in re.findall(r"✓ (\S+)\s+perplejidad\s+([\d.]+)", L("p5 calidad"))}
SUBE = {m[0]: m[1] for m in re.findall(r"✓ (\S+)\s+perplejidad\s+[\d.]+ ± [\d.]+ \(([+\-\d.%]+) contra f16\)", L("p5 calidad"))}
EX = {m[0]: m[1] for m in re.findall(r"✓ (\S+)\s+perplejidad.*?examen (\d+/\d+)", L("p5 calidad"))}
Q4_0 = re.search(r"Q4_K_M ([\d.]+) \(([+\d.%]+)\)", F("arc verificar"))
DEC = {t: MED[t][0] for t in MED}

e = {
    "id": "cuantizacion", "patron": "llm", "rama": "ia-privada", "etapa": "modelo", "num": 2,
    "titulo": "Medir y cuantizar", "nav": "Cuantizar",
    "pregunta": "¿Cuántos bits por peso puede perder el modelo del despacho, y qué gana a cambio? ¿Cómo lo mides para que la comparación entre cuantizaciones valga?",
    "version": "2026-11-27",
}

e["mapa"] = {
    "resumen": "En la estación 1 el modelo ya contesta por API. Ahora toca decidir <b>con cuántos bits por peso</b> se sirve. <b>Cuantizar</b> es guardar cada peso con menos bits (de 16 a 8, 5 o 3): el archivo pesa menos, cabe en menos memoria y escribe más rápido, a cambio de perder algo de calidad. Cuánto se pierde no se adivina: se mide. Se cuantiza el mismo f16 a <b>Q8_0, Q4_K_M y Q2_K</b> con <code>llama-quantize</code>, y de cada una se mide la <b>velocidad</b> (tiempo al primer token, tokens por segundo al leer el prompt y al escribir) y la <b>calidad</b> (la <b>perplejidad</b> en un texto fijo y un <b>examen</b> con respuestas exactas). La mitad del trabajo es que la comparación valga: los mismos prompts, el mismo largo de respuesta, sin cache, sin azar y cada archivo comprobado por su encabezado, no por su nombre. Al final, una tabla lado a lado y una regla para decidir.",
    "entra": [
        "Qwen3-0.6B en f16 (16 bits por peso), del mismo commit de ggml-org/Qwen3-0.6B-GGUF que el Q8_0 de la estación 1, con su sha256",
        "llama.cpp 1.1.0: llama-quantize, llama-server y llama-perplexity",
        "el modelo y la GPU del despacho (su ficha): Qwen3 32B, una L40S de 48 GB, 8 conversaciones de 8,192 tokens, ≥ 20 tokens/s por persona",
    ],
    "sale": [
        "<code>cuantizados/</code>: Q8_0, Q4_K_M y Q2_K, todas del f16, con un manifiesto (bytes, sha256, fuente y bits por peso)",
        "<code>resultados/velocidad.json</code>: TTFT, tokens por segundo al leer y al escribir de cada una, con sus muestras",
        "<code>resultados/calidad.json</code>: la perplejidad de cada una contra la del f16 y el examen, dos vueltas",
        "<code>resultados/reporte.md</code>: las tres lado a lado y la decisión con una regla escrita",
    ],
    "escala": [
        {"que": "El modelo", "ref": "Qwen3 32B: 65.5 GB en FP16, ≈ 34.8 en INT8, 19.32 en INT4 de AWQ", "taller": "Qwen3-0.6B: 1.51 GB en f16, 0.80 en Q8_0, 0.48 en Q4_K_M, 0.35 en Q2_K"},
        {"que": "Cómo se cuantiza", "ref": "AWQ (INT4 con calibración) para vLLM en GPU NVIDIA", "taller": "llama-quantize (GGUF) sin calibración, en la Mac"},
        {"que": "Qué decide", "ref": "si cabe en los 43.2 GB útiles de la L40S con el KV cache, y si escribe a ≥ 20 tokens/s", "taller": "la regla del reporte: la más chica que no pierda más de 5 % de perplejidad ni más de 1 pregunta del examen"},
        {"que": "La medición", "ref": "un benchmark con carga real (la estación 3)", "taller": "1 petición a la vez, 2 prompts × 3 repeticiones, 128 tokens fijos"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de cuantizar nada, las cuentas de servilleta de la decisión: cuánto pesa cada cuantización, si cabe en la GPU del despacho con su KV cache y cuál es el techo de velocidad al escribir. Las tres se hacen sin correr el modelo.",
    "cuentas": [
        {"id": "tamanos", "pregunta": "¿Cuánto pesa cada cuantización?",
         "formula": "bytes = pesos × bits por peso ÷ 8 (los bits por peso incluyen las escalas de cada bloque)",
         "ref": {"cuenta": "Qwen3 32B: 32.76 mil millones de pesos en FP16 (16), INT8 (≈ 8.5) e INT4 de AWQ (la ficha: 19.32 GB)", "valor": "≈ 65.5 GB · ≈ 34.8 GB · 19.32 GB"},
         "taller": {"cuenta": "Qwen3-0.6B: 751.6 M de pesos en f16, Q8_0 (8.5), Q4_K_M (≈ 4.9) y Q2_K (≈ 3.6)", "valor": "1,503 · 799 · 460 · 338 MB, y los archivos reales salen de 805, 484 y 347 MB (paso 1)"},
         "decide": "Bajar de 16 a 4 bits divide el tamaño casi entre 4. La diferencia entre la cuenta y el archivo son las capas que llama-quantize deja con más bits.",
         "conceptos": ["cuantizacion", "bits-por-peso"],
         "comprueba": cmd(P("pc tamanos"), L("pc tamanos")),
         "confirma": "Paso 1: <code>python3 mundo/ficha.py … --tipos</code> dice cuántos pesos quedaron en cada tipo."},
        {"id": "memoria", "pregunta": "¿Cuál cabe en la GPU del despacho, con sus 8 conversaciones?",
         "formula": "memoria = pesos + KV cache de las conversaciones a la vez + el programa; tiene que caber en la memoria útil de la GPU",
         "ref": {"cuenta": "pesos + 17.18 GB de KV (8 × 8,192 tokens) + 2 GB, contra 43.2 GB útiles de la L40S", "valor": "FP16 84.7 GB: no cabe · INT8 54.0 GB: no cabe · INT4 38.5 GB: cabe"},
         "taller": {"cuenta": "el KV cache de Qwen3-0.6B no depende de cómo se guardan los pesos", "valor": "112 KiB por token en las tres; 896 MiB con 8,192 tokens"},
         "decide": "En el despacho, cuantizar no es por gusto: con una L40S, solo INT4 deja lugar para el KV cache de 8 conversaciones. Lo que se mide aquí es cuánto cuesta eso en calidad.",
         "conceptos": ["cuantizacion", "kv-igual"],
         "comprueba": cmd(P("pc memoria"), L("pc memoria"))},
        {"id": "techo", "pregunta": "¿Cuánto más rápido escribe con menos bits?",
         "formula": "techo de escritura (una conversación) = ancho de banda de memoria ÷ bytes de pesos",
         "ref": {"cuenta": "0.7 × 864 GB/s de la L40S ÷ los pesos de cada opción", "valor": "FP16 ≈ 9.2 · INT8 ≈ 17.4 · INT4 ≈ 31.3 tokens/s: solo INT4 llega a los 20"},
         "taller": {"cuenta": "120 GB/s del M4 ÷ los pesos de cada una", "valor": f"techo 150 · 251 · 352 tokens/s; medido {DEC['Q8_0']} · {DEC['Q4_K_M']} · {DEC['Q2_K']} (paso 3)"},
         "decide": "En un modelo grande, escribir es leer los pesos: menos bits, más tokens por segundo, casi en proporción. En uno de 0.6B ya no: Q2_K no escribe más rápido que Q4_K_M, porque desempacar sus bloques también cuesta y el modelo es tan chico que lo demás pesa.",
         "conceptos": ["techo-memoria", "decode-prefill"],
         "comprueba": cmd(P("pc techo"), L("pc techo")),
         "confirma": "Paso 3: <code>python3 pipeline/medir.py</code>."},
        {"id": "ruido", "pregunta": "¿Qué diferencia de perplejidad se distingue del ruido?",
         "formula": "una diferencia se distingue si es más grande que el margen (±) que reporta llama-perplexity",
         "ref": {"cuenta": "en el despacho se mide igual, con un texto de sus expedientes y su golden set (estación 6)", "valor": "el mismo método, con miles de tokens y cientos de preguntas"},
         "taller": {"cuenta": "12,288 tokens de texto: el f16 da 6.05 ± 0.22", "valor": f"Q8_0 {PPL['Q8_0']} (igual que f16, dentro del margen) · Q4_K_M {PPL['Q4_K_M']} ({SUBE['Q4_K_M']}, ≈ 1 margen) · Q2_K {PPL['Q2_K']} (no hay duda)"},
         "decide": "Con un texto de 12 mil tokens y 12 preguntas, el dojo distingue lo grande (Q2_K) y lo mediano (Q4_K_M), no lo fino. Para decidir entre dos parecidas hace falta más texto y más preguntas.",
         "conceptos": ["perplejidad", "examen-exacto"],
         "confirma": "Paso 5: <code>python3 pipeline/calidad.py</code>."},
    ],
}

C = []


def con(id_, termino, en, def_, analogia, importa, trampa):
    assert len(def_) <= 220, (id_, len(def_))
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


con("cuantizacion", "Cuantización", "quantization",
    "Guardar cada peso del modelo con menos bits (de 16 a 8, 5 o 3) redondeando su valor. El modelo pesa menos y escribe más rápido, y contesta un poco peor.",
    "Como pasar una foto de millones de colores a 256: casi no se nota; a 8 colores, sí.",
    "Decide si el modelo cabe en la GPU con su KV cache y a cuántos tokens por segundo escribe. En el despacho, solo INT4 cabe con 8 conversaciones.",
    "Elegir los bits por el tamaño del archivo sin medir la calidad: el Q2_K de un modelo chico pesa 347 MB y no sirve para nada.")
con("bits-por-peso", "Bits por peso", "bits per weight (bpw)",
    "Cuántos bits ocupa cada peso en promedio, contando las escalas de cada bloque. Q8_0 es 8.5; Q4_K_M, ≈ 5; Q2_K, ≈ 3.6 en este modelo.",
    "Como el costo por persona de un viaje en grupo: el boleto más su parte del hotel.",
    "Con los bits por peso y el número de pesos sale el tamaño (pesos × bits ÷ 8) y el techo de velocidad.",
    "Leer «Q4» como 4 bits exactos: Q4_K_M guarda un 28 % de los pesos en Q6_K y promedia 5.09 aquí.")
con("bloques", "Bloques con escala", "block-wise quantization",
    "Los pesos se cuantizan por bloques (de 32 en Q8_0 y Q4_0) y cada bloque guarda su escala: el número que los regresa a su tamaño real. Q8_0: 32 bytes + 2 de escala.",
    "Como una receta escalada: anotas las cantidades «en tazas» y, aparte, cuántos gramos es una taza en esa receta.",
    "Por la escala, un bloque con números chicos y otro con grandes se guardan bien los dos. Es lo que hace que 8 bits casi no pierdan nada.",
    "Olvidar que la escala también pesa: por eso Q8_0 son 8.5 bits por peso, no 8.")
con("k-quants", "Cuantizaciones K y su mezcla", "k-quants (Q4_K_M, Q2_K)",
    "Las K agrupan bloques en superbloques de 256 con escalas en dos niveles. La _M es una mezcla: llama-quantize deja con más bits (Q6_K) las capas que más pierden.",
    "Como empacar una mudanza: lo frágil va con más papel, lo demás apretado.",
    "Por eso Q4_K_M pierde 4 % de perplejidad y un Q4_0 parejo del mismo tamaño pierde más del triple.",
    "Comparar «4 bits» contra «4 bits»: Q4_K_M y Q4_0 dicen 4 y no son lo mismo.")
con("fuente", "Cuantizar desde la fuente", "quantize from full precision",
    "Cada cuantización se hace desde los pesos de más precisión (aquí, f16), nunca desde otra cuantización: cada redondeo encima de otro suma su error.",
    "Como sacar copias del original y no copias de copias.",
    "llama-quantize lo cuida: no recuantiza desde Q8_0 sin --allow-requantize. Y es determinista: el mismo f16 da el mismo archivo, con el mismo sha256.",
    "Aceptar un archivo «ya cuantizado» de cualquier lado: no sabes desde qué se hizo ni con qué.")
con("encabezado", "El encabezado del GGUF", "GGUF metadata, tensor types",
    "Cada GGUF dice adentro qué es: arquitectura, capas, y el tipo de cada tensor. mundo/ficha.py lo lee sin cargar los pesos.",
    "Como la etiqueta de ingredientes de un frasco: el nombre del frasco lo pone cualquiera; la etiqueta dice qué tiene.",
    "El nombre del archivo es una promesa; el encabezado es lo que hay. Un manifiesto con su sha256 dice si alguien lo cambió.",
    "Recalcular el sha256 del manifiesto «para que cuadre»: el sha256 cuadra y el archivo sigue siendo otro.")
con("awq", "AWQ", "activation-aware weight quantization",
    "Una cuantización a 4 bits para GPU que usa unos textos de muestra (calibración) para cuidar los pesos que más importan. Es la del despacho, servida por vLLM.",
    "Como un sastre que toma medidas antes de recortar: recorta donde menos se nota.",
    "En el despacho, el modelo viene en INT4 de AWQ, ya hecho y publicado. El método para decidir es el mismo de aquí: medir velocidad y calidad lado a lado.",
    "Creer que lo que pierde un GGUF de 4 bits en un modelo de 0.6B es lo que pierde AWQ en uno de 32B: los modelos grandes aguantan mucho mejor los pocos bits.")
con("perplejidad", "Perplejidad", "perplexity (PPL)",
    "Qué tan sorprendido está el modelo con un texto: de cuántas opciones, en promedio, duda en cada token. Menos es mejor. Se compara contra el f16 con el mismo texto.",
    "Como un examen de completar la frase: el que conoce el tema duda entre 6 palabras; el que no, entre 40.",
    "Es la medida más barata y sensible de lo que pierde una cuantización: 12 mil tokens en segundos, sin calificar a mano.",
    "Comparar perplejidades de textos o contextos distintos: solo se comparan con el mismo texto y el mismo -c.")
con("examen-exacto", "Examen con respuesta exacta", "exact-match eval",
    "Preguntas con un dato que se puede revisar sin juicio (un número, una fecha, un nombre), sobre un fragmento que se le da al modelo. Acierta si el dato aparece en la respuesta.",
    "Como un examen de opción múltiple: se califica solo, y nadie discute.",
    "La perplejidad dice cuánto se mueve el modelo; el examen dice si todavía hace la tarea. Q2_K sube su perplejidad 6.6 veces y saca 0 de 12.",
    "Creerle a 12 preguntas para diferencias finas: una pregunta es 8 puntos. Sirven para ver lo que se rompe, no para afinar.")
con("decode-prefill", "Leer y escribir", "prefill vs decode",
    "Leer el prompt (prefill) procesa sus tokens juntos y manda el cálculo; escribir (decode) va token por token y manda leer los pesos de memoria. Se reportan por separado.",
    "Como leer un expediente de corrido y luego dictar la respuesta palabra por palabra.",
    "Menos bits ayudan a escribir (menos bytes que leer), pero casi nada a leer el prompt: aquí las tres leen a ≈ 1,650 tokens/s.",
    "Dividir los tokens de la respuesta entre el tiempo total: con un prompt de 2,900 tokens, la «escritura» sale a la mitad.")
con("techo-memoria", "El techo de la memoria", "memory-bandwidth bound",
    "Al escribir, cada token lee todos los pesos: el máximo es el ancho de banda de memoria entre los bytes de pesos. Con menos bits, el techo sube.",
    "Como vaciar una alberca con una manguera: el tiempo lo pone el grosor de la manguera, no la fuerza de quien la sostiene.",
    "Explica por qué INT4 escribe casi 4 veces más rápido que FP16 en la L40S del despacho, y por qué en la Mac Q4_K_M le gana a Q8_0.",
    "Esperar que siga subiendo para siempre: en un modelo de 0.6B, Q2_K no escribe más rápido que Q4_K_M; desempacar bloques también cuesta.")
con("kv-igual", "El KV cache no se cuantiza aquí", "KV cache size vs weight quantization",
    "Cuantizar los pesos no cambia el KV cache: su tamaño depende de capas, cabezas K/V, tokens y su propio tipo (f16 por omisión), no de los pesos.",
    "Como cambiar a muebles más chicos: la casa se desahoga, pero la gente que viene a la fiesta ocupa lo mismo.",
    "En el despacho, los 17.18 GB de KV de 8 conversaciones quedan igual con FP16 o con INT4. Por eso la cuenta de memoria va con las dos partes.",
    "Calcular «cabe» solo con los pesos: INT8 pesa 34.8 GB y en una GPU de 48 parece que cabe, hasta que llega la quinta conversación.")
con("comparable", "Una comparación que vale", "apples-to-apples benchmark",
    "Todo lo que no se compara se fija: los mismos prompts, el mismo largo de respuesta, sin cache, el mismo texto, sin azar. Si algo cambia, se mide todo otra vez.",
    "Como comparar dos coches: la misma ruta, el mismo peso y la misma gasolina, o el resultado dice más de la ruta que del coche.",
    "Una tabla lado a lado se lee de corrido: cada número tiene que valer contra los de su fila.",
    "Volver a medir solo «la que cambió» con un prompt nuevo: la tabla queda mezclada y nadie lo nota.")
con("cache-prompt", "Cache del prompt", "prompt caching (KV reuse)",
    "llama-server puede reusar el KV cache del prompt anterior si el nuevo empieza igual: no vuelve a leer esos tokens. Viene prendido por omisión.",
    "Como un lector que ya leyó la primera mitad del expediente: si le das el mismo, empieza donde se quedó.",
    "En producción ayuda (las conversaciones repiten su inicio). Al medir, esconde el prefill: el TTFT del prompt largo baja de 1.8 s a ≈ 10 ms.",
    "Medir con el cache prendido y repetir el mismo prompt: el número sale increíble y no es del modelo.")
con("largo-fijo", "Largo fijo de respuesta", "fixed output length (ignore_eos)",
    "Para medir velocidad, cada respuesta escribe exactamente max_tokens: ignore_eos hace que el modelo no pare aunque «termine». Así todas hacen el mismo trabajo.",
    "Como cronometrar a varios corredores: todos corren los mismos 100 metros, aunque uno quisiera parar en 40.",
    "Sin largo fijo, una cuantización escribe 24 tokens y otra 128, y sus tiempos ya no se comparan.",
    "Usar ignore_eos al medir calidad: ahí se deja contestar, y se califica lo que contestó.")
con("muestras", "Muestras y mediana", "repetitions, median",
    "Cada medición se repite (aquí 3 veces) y se reporta la mediana: el valor de en medio, que una muestra rara no mueve.",
    "Como pesar algo tres veces en una báscula que a veces brinca: te quedas con la de en medio.",
    "Con las muestras guardadas se ve si una salió rara (una con cache, una más corta) en vez de esconderla en un promedio.",
    "Medir una vez y creerle: una sola muestra no dice si es el modelo o un tropiezo de la máquina.")
con("determinismo", "Sin azar", "temperature 0, fixed seed",
    "Temperatura 0 elige siempre el token más probable; con la semilla fija, la misma pregunta da la misma respuesta. Al examen además se le quita el cache del prompt.",
    "Como repetir un experimento con las mismas condiciones: si cambia el resultado, cambió algo que no controlaste.",
    "Con dos vueltas iguales, una diferencia entre cuantizaciones es de la cuantización. Reusar el prompt anterior cambia un poco las cuentas: Q2_K contestó distinto una vez por eso.",
    "Medir con la temperatura de la interfaz de chat: cada noche un resultado distinto, y ninguno se compara.")
con("decision", "Una regla para decidir", "decision rule",
    "Antes de ver los números, se escribe qué cuenta: aquí, la cuantización más chica que no pierda más de 5 % de perplejidad ni más de 1 pregunta del examen.",
    "Como fijar el presupuesto antes de entrar a la tienda: después de ver los precios, todo parece razonable.",
    "La decisión sale sola de la tabla y es la misma para quien la lea. En el despacho, la regla incluye cabe en memoria y ≥ 20 tokens/s.",
    "Elegir primero y justificar después: con una tabla grande, siempre hay un número que apoya lo que ya querías.")
e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae el modelo de la estación 1 en su forma original: <b>Qwen3-0.6B en f16</b> (16 bits por peso, 1.51 GB), del mismo commit de <b>ggml-org/Qwen3-0.6B-GGUF</b>, con su sha256. Trae lo que sirve un GGUF mientras lo mides y lo apaga (<code>mundo/servidor.py</code>, en el puerto 9932), lo que lee el encabezado de un GGUF (<code>mundo/ficha.py</code>), y lo que se mide: dos prompts de velocidad (uno corto y uno de ≈ 2,900 tokens de documentos, como un prompt de RAG), un texto fijo en español de 12 mil tokens para la perplejidad y un examen de <b>12 preguntas con respuesta exacta</b> sobre fragmentos ficticios de expedientes. Tú escribes cuantizar, medir y calificar; <code>pipeline/reporte.py</code> pone todo lado a lado y aplica la regla.",
    "trae": [
        {"que": "mundo/modelos.json y modelos.py", "detalle": "El f16 (repositorio, commit, bytes, sha256, licencia) y lo que lo baja a <code>modelo/</code>: ≈ 1.5 GB, una vez. Con <code>TRUEML_MODELOS=&lt;carpeta&gt;</code> lo copia de otra carpeta."},
        {"que": "mundo/servidor.py", "detalle": "<code>servido(gguf)</code>: arranca llama-server con ese archivo (127.0.0.1:9932, una petición a la vez, sin razonamiento), espera a <code>/health</code> y lo apaga al salir. Cada cuantización en su propio proceso."},
        {"que": "mundo/ficha.py", "detalle": "El encabezado de un GGUF: capas, cabezas, y con <code>--tipos</code> cuántos pesos hay de cada tipo (Q8_0, Q4_K, Q6_K, …) y sus bits por peso. <code>resumen()</code> da lo mismo para tu código."},
        {"que": "mundo/entrada/", "detalle": "<code>prompts.json</code> (corto y largo), <code>texto.txt</code> (las políticas ficticias del marketplace del entrenamiento RAG, ≈ 12 mil tokens) y <code>examen.json</code> (12 preguntas, cada una con su fragmento y lo que se espera)."},
        {"que": "medicion.json", "detalle": "Cómo se mide: la fuente, las cuantizaciones, los prompts, el calentamiento, las repeticiones, el largo fijo, el cache, la métrica, el texto, el contexto de la perplejidad, la temperatura y la semilla del examen."},
        {"que": "verificar.py y romper.py", "detalle": "Los 6 checks de la estación, mirando los datos que deja tu pipeline (no la configuración), y las 6 fallas: el prompt largo cambiado a medias, el cache del prompt, la lectura del prompt contada como escritura, respuestas de largo libre, el examen con azar y un Q4_0 con el nombre de Q4_K_M."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/cuantizar.py", "hace": "Paso 1: las tres cuantizaciones del f16 con llama-quantize, y su manifiesto."},
        {"archivo": "pipeline/medir.py", "hace": "Pasos 2 y 3: una muestra (TTFT, lo que leyó y lo que escribió, por segundo) y la velocidad de las tres con sus muestras."},
        {"archivo": "pipeline/calidad.py", "hace": "Pasos 4 y 5: la perplejidad con llama-perplexity y el examen, dos vueltas."},
        {"archivo": "pipeline/reporte.py", "hace": "Paso 6 (viene dado): la tabla lado a lado y la decisión con la regla."},
    ],
    "requisitos": [
        "Una Mac con chip Apple (M1 o más nuevo) y ≈ 3 GB de RAM libre; se probó en un MacBook Air M4 de 16 GB",
        "llama.cpp 1.1.0 o más nuevo (<code>brew install llama.cpp</code>) y Python 3 (se probó con 3.14.3)",
        "≈ 3.2 GB de disco: el f16 (1.5 GB) y las tres cuantizaciones (1.6 GB); internet para bajar el f16 una vez",
        "La estación 1 ayuda, pero no hace falta: este kit sirve su propio modelo",
    ],
    "sustituciones": [
        {"nube": "Qwen3 32B en INT4 de AWQ, servido por vLLM en una L40S", "local": "Qwen3-0.6B en GGUF (Q8_0, Q4_K_M y Q2_K), servido por llama-server en tu Mac", "diferencia": "Otro formato y otro método de cuantizar (AWQ calibra con textos; llama-quantize, no). El método para decidir es el mismo: medir velocidad y calidad lado a lado, con las mismas condiciones."},
        {"nube": "Un modelo de 32B", "local": "uno de 0.6B", "diferencia": "Los modelos chicos sufren mucho más con pocos bits: aquí Q2_K destruye al modelo. En uno de 32B, los 4 bits pierden poco y los 3, bastante menos que aquí. Se aprende el método, no el número."},
        {"nube": "Un benchmark con carga real y el golden set del despacho", "local": "1 petición a la vez, 2 prompts y 12 preguntas", "diferencia": "La carga de verdad es la estación 3 (vLLM) y la calidad de verdad, la 6 (el gate). Aquí se mide lo que cambia la cuantización, sin mezclarlo con la carga."},
    ],
    "arranque": "unzip ia-privada-cuantizacion.zip && cd ia-privada-cuantizacion\nbrew install llama.cpp\npython3 mundo/modelos.py\npython3 verificar.py mundo",
    "python": "python3",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="llama.cpp con sus tres herramientas y el f16 en <code>modelo/</code>, con su sha256.",
    conceptos=["encabezado"],
    explica="<code>brew install llama.cpp</code> trae <code>llama-quantize</code> (cuantiza), <code>llama-server</code> (sirve) y <code>llama-perplexity</code> (mide la perplejidad). <code>mundo/modelos.py</code> baja el f16 de un commit fijo y comprueba su sha256. <code>mundo/ficha.py</code> lee su encabezado: aquí, todos los pesos grandes en F16.",
    codigo=[],
    comandos=[
        cmd("brew install llama.cpp\nllama-server --version\ncommand -v llama-quantize llama-perplexity", L("p0 version")),
        cmd("python3 mundo/modelos.py", L("p0 modelos"), "Con internet, lo que tarden 1.5 GB. Aquí se copió de otra carpeta (<code>TRUEML_MODELOS</code>), con el mismo sha256."),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd("python3 mundo/ficha.py modelo/Qwen3-0.6B-f16.gguf --tipos", L("p0 ficha"), "16 bits por peso: es la fuente de las tres. Las normas de cada capa van en F32; son nada (65 mil pesos)."),
        cmd(f"{V} cuantizar", L("p0 esqueleto"), "Es lo esperado: <code>pipeline/</code> todavía es el esqueleto."),
    ],
    verifica="<code>verificar.py mundo</code> en verde: las tres herramientas de llama.cpp 1.1.0 o más nuevo y el f16 con el sha256 del catálogo.",
    ojo="<code>modelo/</code>, <code>cuantizados/</code> y <code>resultados/</code> no van en el .zip ni en git. Necesitas ≈ 3.2 GB libres."))

G.append(dict(n=1, id="cuantizar", titulo="Tres cuantizaciones del mismo f16", objetivo="<code>cuantizar.py</code>: Q8_0, Q4_K_M y Q2_K con <code>llama-quantize</code>, desde el f16, y un manifiesto con bytes, sha256, fuente y bits por peso.",
    conceptos=["cuantizacion", "bits-por-peso", "bloques", "k-quants", "fuente"],
    explica="<code>llama-quantize &lt;entrada&gt; &lt;salida&gt; &lt;tipo&gt;</code> lee el f16 y escribe el GGUF cuantizado. <b>Q8_0</b>: bloques de 32 pesos de 8 bits con una escala. <b>Q4_K_M</b>: superbloques de 256 en 4 bits con escalas en dos niveles (K), y una mezcla (M) que deja en Q6_K las capas que más pierden. <b>Q2_K</b>: 2 bits en la mayoría, con partes en Q3_K y Q6_K. Siempre desde el f16. El manifiesto guarda cada archivo con su sha256 y el sha256 de su fuente, y los bits por peso que dice su encabezado (<code>resumen()</code> de <code>mundo/ficha.py</code>).",
    codigo=[py("pipeline/cuantizar.py")],
    comandos=[
        cmd("python3 pipeline/cuantizar.py", L("p1 cuantizar"), "Segundos: cuantizar es redondear 751 millones de números, en todos los núcleos del CPU."),
        cmd("python3 pipeline/cuantizar.py", L("p1 otra vez"), "La segunda vez no hace nada: cada archivo coincide con el sha256 del manifiesto."),
        cmd(P("p1 manifiesto"), L("p1 manifiesto")),
        cmd("for t in Q8_0 Q4_K_M Q2_K; do python3 mundo/ficha.py cuantizados/Qwen3-0.6B-$t.gguf --tipos; done", L("p1 ficha"), "Recortado. Q4_K_M no es «4 bits»: un 28.5 % de sus pesos va en Q6_K (entre ellos la tabla de embeddings, que Qwen3-0.6B comparte con la salida). En Q2_K, la tabla queda en Q6_K y pesa más que todo lo demás."),
        cmd(f"{V} cuantizar", L("p1 verificar"), "El check vuelve a cuantizar el f16 en una carpeta temporal y compara: llama-quantize es determinista, así que el mismo f16 da el mismo sha256."),
    ],
    verifica="<code>verificar.py cuantizar</code> en verde: las tres en el manifiesto, cada archivo con su sha256, de la fuente f16, con los tipos de tensor que le tocan, y cuantizar otra vez da el mismo archivo.",
    ojo="llama-quantize no recuantiza desde Q8_0 sin <code>--allow-requantize</code>: lo protege de copias de copias. Y no recalcules el manifiesto a mano: es lo que dice qué archivo es cuál.",
    en_pagina={"conceptos": ["cuantizacion", "bits-por-peso", "bloques", "k-quants", "fuente", "encabezado"], "precalculos": ["tamanos", "memoria"]}))

G.append(dict(n=2, id="muestra", titulo="Una muestra que se pueda comparar", objetivo="<code>una_peticion()</code> en <code>medir.py</code>: una petición en stream con su TTFT, lo que leyó, lo que escribió y a qué velocidad, con largo fijo y sin cache.",
    conceptos=["decode-prefill", "largo-fijo", "cache-prompt"],
    explica="Una petición a <code>/v1/chat/completions</code> con <code>stream</code> e <code>include_usage</code>, como en la estación 1. Se mide el <b>TTFT</b> hasta el primer pedazo con texto. De los <code>timings</code> de llama-server salen <code>prompt_n</code> (cuántos tokens leyó), <code>prompt_per_second</code> (leer) y <code>predicted_per_second</code> (escribir, sin la lectura). Para que las muestras se comparen: <code>ignore_eos</code> (todas escriben <code>max_tokens</code>), <code>cache_prompt: false</code> (lee el prompt completo cada vez) y temperatura 0. <code>mundo/servidor.py</code> da <code>servido()</code>: el servidor arriba mientras dura el <code>with</code>.",
    codigo=[py("pipeline/medir.py", "En este paso escribes <code>una_peticion</code>; <code>medir</code> es el paso 3.")],
    comandos=[cmd(P("p2 muestra"), L("p2 muestra"), "Leer el prompt largo tarda ≈ 1.7 s; escribir sus 128 tokens, igual que con el corto pero algo más lento (la atención con 2,900 tokens de contexto cuesta). Sin largo fijo, la respuesta corta paró antes. Con cache, la segunda vez el servidor leyó 1 token: el TTFT no es real.")],
    verifica="La muestra trae <code>prompt_n</code> igual al prompt, 128 tokens escritos y las dos velocidades por separado. El check llega en el paso 3.",
    ojo="llama-server ya calienta al cargar el modelo (<code>--warmup</code> viene prendido): aquí la primera petición casi no es más lenta. Con otros servidores, o la primera vez que llega un prompt de otro tamaño, sí; por eso se calienta igual antes de medir.",
    en_pagina={"conceptos": ["decode-prefill", "largo-fijo", "cache-prompt"], "precalculos": []}))

G.append(dict(n=3, id="medir", titulo="La velocidad de las tres", objetivo="<code>medir()</code>: cada cuantización en su servidor, calentar, 3 repeticiones de cada prompt, y la mediana; todo en <code>resultados/velocidad.json</code>.",
    conceptos=["muestras", "techo-memoria", "comparable"],
    explica="<code>medir(tipo)</code> sirve el GGUF con <code>servido()</code>, hace las peticiones de calentamiento (no cuentan), y 3 de cada prompt. Guarda todas las muestras (para ver si una salió rara) y la <b>mediana</b> de cada número. <code>velocidad.json</code> guarda también la configuración con que se midió y el sha256 de los prompts: así se sabe con qué se comparó.",
    codigo=[],
    comandos=[
        cmd("python3 pipeline/medir.py", L("p3 medir"), f"Q4_K_M escribe a {DEC['Q4_K_M']} tokens/s y Q8_0 a {DEC['Q8_0']}: casi lo que dice el techo de memoria. Q2_K no escribe más rápido que Q4_K_M. Y leer el prompt cuesta lo mismo en las tres: menos bits no ayudan a leer."),
        cmd(P("p3 muestras"), L("p3 muestras"), "Las tres muestras de cada uno casi iguales: la mediana es de fiar. Con el prompt largo, escribir baja a ≈ 0.65 de lo del corto en las tres."),
        cmd(f"{V} comparable velocidad", L("p3 verificar")),
    ],
    verifica="<code>verificar.py comparable</code> y <code>velocidad</code> en verde: los mismos prompts para las tres, con los mismos tokens leídos, 128 escritos en cada muestra, sin cache, al menos 3 muestras, y la escritura medida sin la lectura del prompt.",
    ojo="Mientras se mide, la Mac no hace otra cosa pesada: un navegador con video o una compilación cambian los números.",
    en_pagina={"conceptos": ["muestras", "techo-memoria", "comparable"], "precalculos": ["techo"]}))

G.append(dict(n=4, id="perplejidad", titulo="Cuánto se mueve el modelo: la perplejidad", objetivo="<code>perplejidad()</code> en <code>calidad.py</code>: <code>llama-perplexity</code> con el mismo texto y el mismo contexto para el f16 y las tres.",
    conceptos=["perplejidad"],
    explica="<code>llama-perplexity -m &lt;gguf&gt; -f &lt;texto&gt; -c 512</code> parte el texto en pedazos de 512 tokens, le pide al modelo que prediga cada token y promedia qué tan sorprendido estuvo: la <b>perplejidad</b>. Su última línea dice «Final estimate: PPL = x +/- y»: el valor y su margen. Se mide primero el f16: es la referencia contra la que se compara cada cuantización.",
    codigo=[py("pipeline/calidad.py", "En este paso escribes <code>perplejidad</code>; <code>examen</code> es el paso 5.")],
    comandos=[cmd(P("p4 perplejidad"), L("p4 perplejidad"), "El f16 duda, en promedio, entre ≈ 6 tokens; Q2_K, entre ≈ 40. Unos segundos cada uno.")],
    verifica="La perplejidad del f16 y la de una cuantización, con su margen y los tokens que se usaron. El check llega en el paso 5.",
    ojo="Una perplejidad sola no dice nada: solo se compara con otra del mismo texto y el mismo <code>-c</code>. Con <code>-c 2048</code> todas bajan.",
    en_pagina={"conceptos": ["perplejidad"], "precalculos": []}))

G.append(dict(n=5, id="examen", titulo="Si todavía hace la tarea: el examen", objetivo="<code>examen()</code>: 12 preguntas con respuesta exacta, temperatura 0, semilla fija, sin cache del prompt; dos vueltas por cuantización. Y <code>calidad.json</code> con todo.",
    conceptos=["examen-exacto", "determinismo"],
    explica="Cada pregunta va con su fragmento (un contrato, un expediente) y el sistema pide «solo el dato». Acierta si alguno de los textos esperados aparece en la respuesta, los dos sin acentos ni mayúsculas (<code>normalizar()</code>). Con temperatura 0, semilla fija y <code>cache_prompt: false</code>, dos vueltas dan lo mismo: si no, algo en la medición tiene azar. <code>calidad.py</code> corre el f16 (solo perplejidad) y cada cuantización (perplejidad y examen) y lo guarda con el sha256 del texto.",
    codigo=[],
    comandos=[
        cmd(P("p5 q2"), L("p5 q2"), "Q8_0 contesta el dato. Q2_K repite la pregunta, escribe basura o pasa al inglés: un modelo de 0.6B con 2 bits ya no hace la tarea."),
        cmd("python3 pipeline/calidad.py", L("p5 calidad")),
        cmd(f"{V} calidad", L("p5 verificar")),
    ],
    verifica="<code>verificar.py calidad</code> en verde: el mismo texto con que se midió, ninguna perplejidad menor que la del f16, Q8_0 a menos de 1 % del f16 y con el examen casi completo, y las dos vueltas del examen iguales.",
    ojo="Sin <code>cache_prompt: false</code>, el servidor reusa parte del prompt anterior y las cuentas cambian un poco: con temperatura 0, Q2_K contestó distinto una pregunta en la segunda vuelta. Para que el examen sea repetible, nada de lo anterior entra.",
    en_pagina={"conceptos": ["examen-exacto", "determinismo"], "precalculos": ["ruido"]}))

G.append(dict(n=6, id="reporte", titulo="Lado a lado, y la decisión", objetivo="<code>pipeline/reporte.py</code> (viene dado): las tres en una tabla, contra el f16, y la decisión con una regla escrita antes.",
    conceptos=["decision", "kv-igual"],
    explica="<code>reporte.py</code> lee el manifiesto, <code>velocidad.json</code> y <code>calidad.json</code>, y escribe <code>resultados/reporte.md</code>: tamaño, bits por peso, escribir y leer por segundo, TTFT con los dos prompts, perplejidad contra el f16 y el peor examen. La <b>regla</b>: la más chica que no pierda más de 5 % de perplejidad ni más de 1 pregunta. En el despacho la regla también pide que quepa con su KV cache y que escriba a ≥ 20 tokens/s.",
    codigo=[py("pipeline/reporte.py", "Viene dado.")],
    comandos=[
        cmd("python3 pipeline/reporte.py", L("p6 reporte"), f"Q4_K_M: 40 % menos que Q8_0, escribe más rápido y pierde {SUBE['Q4_K_M']} de perplejidad sin fallar el examen. Q2_K es la más chica y no sirve. Q8_0 casi no pierde nada; si el despacho tuviera la memoria, sería la segura."),
        cmd(f"{V} reporte", L("p6 verificar")),
        cmd(V, L("fin verificar"), "Todo en verde."),
    ],
    verifica="<code>verificar.py reporte</code> en verde: el reporte es más nuevo que los resultados, trae las tres, y su decisión es la que da la regla con tus datos.",
    ojo="La regla se escribe antes de ver la tabla. Si después de verla quieres cambiarla, escribe por qué: es otra decisión.",
    en_pagina={"conceptos": ["decision", "awq", "kv-igual"], "precalculos": []}))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python3 mundo/reiniciar.py</code>: respalda tu <code>pipeline/</code>, deja el esqueleto, devuelve <code>medicion.json</code> de fábrica y borra <code>cuantizados/</code> y <code>resultados/</code> (el f16 se queda).",
        "Sin GUION.md: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "Las tres herramientas de llama.cpp y el f16 con su sha256.", "check": "mundo"},
        {"n": 2, "objetivo": "Q8_0, Q4_K_M y Q2_K, todas del f16, con un manifiesto que diga qué es cada archivo, y que se puedan rehacer iguales.", "check": "cuantizar", "pista": "¿Qué dice el encabezado de cada archivo, y de dónde salió?"},
        {"n": 3, "objetivo": "Las tres medidas con los mismos prompts, la misma cantidad de tokens leídos y escritos, y al menos 3 muestras.", "check": "comparable", "pista": "¿Qué hace llama-server con un prompt que ya vio?"},
        {"n": 4, "objetivo": "La velocidad de escribir, medida sin la lectura del prompt.", "check": "velocidad"},
        {"n": 5, "objetivo": "La perplejidad de las tres contra la del f16 con el mismo texto, y un examen que da lo mismo dos veces.", "check": "calidad", "pista": "¿Qué cambia entre una vuelta y otra si nada debería cambiar?"},
        {"n": 6, "objetivo": "El reporte lado a lado con la decisión que da la regla.", "check": "reporte"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


e["fallas"] = [
    falla("prompts-a-medias", "Q2_K ahora lee el prompt largo más rápido que las demás", "config",
          "El prompt largo «tardaba mucho», así que alguien hizo una versión más corta, la puso en medicion.json y volvió a medir solo la Q2_K, «que era la que faltaba revisar».",
          "<code>verificar.py comparable</code> falla: el prompt largo entró con tokens distintos según la cuantización. En el reporte, Q2_K tiene el TTFT largo a la mitad.",
          ["Q2_K lee más rápido.", "No todas se midieron con el mismo prompt.", "El servidor usó el cache."],
          cmd("python3 verificar.py comparable\ncat resultados/reporte.md", F("pro verificar") + "\n\n" + F("pro reporte"), "La tabla se ve normal; la columna de Q2_K se midió con otro prompt."),
          "<code>velocidad.prompts</code> vuelve a <code>mundo/entrada/prompts.json</code> y <code>python3 pipeline/medir.py</code> (las tres) y <code>reporte.py</code>. Si cambia lo que se mide, se mide todo otra vez: una tabla lado a lado solo vale con las mismas condiciones en cada columna.",
          "comparable", "comparable"),
    falla("cache-prompt", "El TTFT bajó de 1.8 s a 10 ms de un día para otro", "config",
          "Alguien leyó que llama-server «reusa el prompt» y lo prendió en medicion.json para «medir como en producción». El benchmark de la noche dio números increíbles.",
          "<code>verificar.py comparable</code> falla: en algunas muestras el servidor leyó 1 token del prompt.",
          ["El modelo se volvió más rápido.", "El servidor reusó el prompt anterior.", "El prompt se acortó."],
          cmd(P("cac muestras", PROBARF), F("cac muestras"), "La primera muestra leyó todo el prompt; las otras dos, 1 token: el resto venía del KV cache de la anterior."),
          "<code>velocidad.cache_prompt: false</code> y <code>python3 pipeline/medir.py</code> y <code>reporte.py</code>. El cache sí sirve en producción (conversaciones que repiten su inicio), pero se mide aparte: aquí esconde justo lo que se quiere medir, leer el prompt.",
          "cache-prompt", "comparable"),
    falla("metrica-total", "Con el prompt largo, el modelo «escribe» a la mitad", "config",
          "Para que el reporte «se parezca a lo que siente el usuario», alguien cambió en medicion.json cómo se calculan los tokens por segundo.",
          "<code>verificar.py velocidad</code> falla: cada cuantización «escribe» con el prompt largo a ≈ 0.3 de lo que escribe con el corto.",
          ["El contexto largo frena la escritura.", "La velocidad de escribir incluye el tiempo de leer el prompt.", "El servidor se calentó."],
          cmd("python3 verificar.py velocidad", F("tot verificar"), "Con 2,900 tokens de contexto escribir sí es más lento (≈ 0.65 del corto), pero no tanto: lo demás es el tiempo de leer el prompt, contado como si fuera escribir."),
          "<code>velocidad.metrica: \"decode\"</code> (<code>predicted_per_second</code> de llama-server) y <code>python3 pipeline/medir.py</code> y <code>reporte.py</code>. Lo que siente el usuario son dos números: cuánto espera el primer token (TTFT) y qué tan rápido sale el resto. Juntos en uno no sirven para decidir ninguno.",
          "decode-prefill", "velocidad"),
    falla("largo-libre", "Q8_0 «escribe» igual de rápido con respuestas de 20 tokens que con las de 128", "config",
          "Alguien vio respuestas que seguían escribiendo después de terminar la idea y quitó el largo fijo de medicion.json «para que el modelo pare cuando quiera».",
          "<code>verificar.py comparable</code> falla: las respuestas tienen distinto número de tokens.",
          ["Cada cuantización contesta un largo distinto.", "max_tokens cambió.", "El examen cambió."],
          cmd(P("lar tokens", PROBARF), F("lar tokens"), "Cada cuantización paró donde quiso: sus tiempos ya no miden el mismo trabajo."),
          "<code>velocidad.largo_fijo: true</code> (<code>ignore_eos</code>: todas escriben <code>max_tokens</code>) y <code>python3 pipeline/medir.py</code> y <code>reporte.py</code>. Para medir velocidad se fija el trabajo; para medir calidad (el examen), se deja contestar.",
          "largo-fijo", "comparable"),
    falla("examen-al-azar", "El examen sale distinto cada noche", "config",
          "Alguien copió a medicion.json la temperatura y la semilla «de la interfaz de chat», porque «así lo usan los abogados».",
          "<code>verificar.py calidad</code> falla: las dos vueltas del examen contestaron distinto.",
          ["El modelo cambió.", "El examen tiene azar.", "El fragmento cambió."],
          cmd("python3 verificar.py calidad", F("aza verificar"), "Con azar, un acierto de más o de menos es ruido: no se compara ni con la de al lado ni con la de ayer."),
          "<code>calidad.temperatura: 0</code> y <code>semilla: 7</code>, y <code>python3 pipeline/calidad.py</code> y <code>reporte.py</code>. Para comparar, todo lo que no es lo comparado se fija; el azar se prueba aparte, si hace falta.",
          "determinismo", "calidad"),
    falla("archivo-equivocado", "El Q4_K_M de esta noche perdió calidad y nadie cambió nada", "infra",
          "Para «ahorrar tiempo», alguien volvió a hacer el Q4_K_M con «la opción rápida» de llama-quantize, lo dejó con el mismo nombre y actualizó el manifiesto para que cuadrara.",
          f"<code>verificar.py cuantizar</code> falla: el archivo se llama Q4_K_M y sus pesos son Q4_0. Su perplejidad subió a {Q4_0.group(1)} ({Q4_0.group(2)}) y la decisión cambió a Q8_0.",
          ["La cuantización K tiene un problema.", "El archivo no es lo que dice su nombre.", "El texto de la perplejidad cambió."],
          cmd("python3 mundo/ficha.py cuantizados/Qwen3-0.6B-Q4_K_M.gguf --tipos", F("arc ficha"), "El encabezado no miente: un Q4_0 parejo, con una escala por bloque de 32. Y <code>python3 pipeline/cuantizar.py</code> sin --todas no lo rehace: el sha256 del manifiesto cuadra, porque alguien lo recalculó."),
          "<code>python3 pipeline/cuantizar.py --todas</code> y después <code>medir.py Q4_K_M</code>, <code>calidad.py Q4_K_M</code> y <code>reporte.py</code>. Lo que es un archivo lo dice su encabezado, no su nombre; y un manifiesto que se recalcula a mano ya no protege nada.",
          "encabezado", "cuantizar"),
]

e["listo"] = [
    "Las tres cuantizaciones salen del mismo f16 con llama-quantize, con un manifiesto que dice qué es cada archivo, y se pueden rehacer iguales.",
    "La velocidad se mide con los mismos prompts, el mismo largo de respuesta, sin cache, con al menos 3 muestras guardadas y su mediana.",
    "El tiempo al primer token, leer y escribir se reportan por separado.",
    "La perplejidad de cada una se compara contra la del f16 con el mismo texto y el mismo contexto.",
    "El examen con respuestas exactas da lo mismo dos veces.",
    "Una tabla lado a lado y una decisión que sale de una regla escrita antes de ver los números.",
]

e["repaso"] = {
    "memo": "<b>Cuantizar es guardar cada peso con menos bits: el modelo pesa menos y escribe más rápido, y pierde algo de calidad. Se decide midiendo, desde la misma fuente, con las mismas condiciones: TTFT, leer y escribir por separado, la perplejidad contra el f16 y un examen repetible, y una regla escrita antes.</b> En el dojo: Q8_0 casi no pierde nada; Q4_K_M pierde " + SUBE["Q4_K_M"] + " de perplejidad, escribe más rápido y saca el examen completo; Q2_K escribe igual que Q4_K_M y no sirve (0/12).",
    "trampa": "Números que se ven bien y no se comparan. El cache del prompt hace un TTFT de 10 ms; contar la lectura del prompt como escritura reparte la culpa; respuestas de distinto largo, un prompt cambiado a medias o un examen con azar mezclan las columnas; y un archivo con el nombre equivocado pasa si el manifiesto se recalcula a mano. Lo que los atrapa es guardar las muestras, fijar todo lo que no se compara y leer el encabezado del archivo.",
    "entrevista": [
        {"q": "¿Cómo eliges con cuántos bits sirves un modelo?", "a": "Primero la memoria: los pesos más el KV cache de las conversaciones a la vez tienen que caber. En el despacho, con una L40S de 48 GB, Qwen3 32B solo cabe en INT4: 19.3 GB de pesos más 17.2 de KV. Después mido lado a lado, desde la misma fuente: velocidad (TTFT, y tokens por segundo al escribir) y calidad (perplejidad contra el original y un examen de la tarea real). Y decido con una regla escrita antes: la más chica que no pierda más de lo que acordamos."},
        {"q": "¿Por qué menos bits escriben más rápido?", "a": "Porque escribir cada token es leer todos los pesos de memoria: el techo es el ancho de banda entre los bytes. Con la mitad de bytes, casi el doble de tokens por segundo. Pero leer el prompt no mejora igual, porque ahí manda el cálculo. Y en un modelo muy chico deja de cumplirse: en mi prueba, Q2_K no escribió más rápido que Q4_K_M, porque desempacar sus bloques también cuesta."},
        {"q": "¿Qué mides para la calidad de una cuantización?", "a": "La perplejidad en un texto fijo contra la del modelo original, con el mismo contexto: es barata y sensible. Y un examen de la tarea real con respuestas que se califican solas, con temperatura 0 y semilla fija, dos veces. La perplejidad me dijo que Q4_K_M perdía 4 % y Q2_K se multiplicaba por 6.6; el examen, que Q4_K_M seguía haciendo la tarea y Q2_K no."},
        {"q": "Te pasan un benchmark donde el TTFT bajó de 1.8 s a 10 ms. ¿Qué revisas?", "a": "Cuántos tokens leyó el servidor en cada muestra. Si es 1, reusó el prompt anterior del cache: no midió leer el prompt. También que todas las columnas se hayan medido con los mismos prompts y el mismo largo de respuesta, y que la velocidad de escribir no incluya la lectura del prompt."},
        {"q": "¿Qué es Q4_K_M y en qué se distingue de Q4_0?", "a": "Las dos son de 4 bits en llama.cpp. Q4_0 guarda bloques de 32 pesos con una escala. Q4_K_M usa superbloques de 256 con escalas en dos niveles y deja en Q6_K las capas que más pierden: en mi modelo promedió 5.09 bits por peso. Con un tamaño parecido, Q4_0 perdió más del triple de perplejidad. Por eso no comparo por el número de bits ni por el nombre: leo el encabezado del archivo."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/ia-privada-cuantizacion/CLAUDE.md",
    "guiado": "content/estaciones/ia-privada-cuantizacion/prompts/guiado.md",
    "solo": "content/estaciones/ia-privada-cuantizacion/prompts/solo.md",
    "romper_ayuda": "content/estaciones/ia-privada-cuantizacion/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/ia-privada-cuantizacion/prompts/romper-solo.md",
}

(APP / "content/estaciones/ia-privada-cuantizacion.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
