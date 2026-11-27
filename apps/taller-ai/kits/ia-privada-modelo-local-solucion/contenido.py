"""Arma content/estaciones/ia-privada-modelo-local.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/e1 && bash probar-fallas.sh /ruta/e1     # deja /ruta/e1.log y /ruta/e1-fallas.log
    python3 contenido.py /ruta/e1                                  # escribe el JSON con esas salidas

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
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^cp |^CUERPO|^#|\Z)', fuente or PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith("python3 -c \""):
        c = c.replace("\\\"", "\"")
    return c


def crudo(texto: str) -> str:
    """La respuesta JSON de /v1/chat/completions, con lo que importa y legible."""
    d = json.loads(texto)
    c = d["choices"][0]
    t = {k: round(v, 1) for k, v in d.get("timings", {}).items() if k in ("prompt_n", "prompt_ms", "predicted_n", "predicted_ms", "predicted_per_second")}
    m = {"content": c["message"].get("content"), "reasoning_content": c["message"].get("reasoning_content")}
    if m["reasoning_content"] and len(m["reasoning_content"]) > 160:
        m["reasoning_content"] = m["reasoning_content"][:160] + " …"
    return json.dumps({"choices": [{"message": m, "finish_reason": c["finish_reason"]}],
                       "usage": {k: d["usage"][k] for k in ("prompt_tokens", "completion_tokens", "total_tokens")}, "timings": t},
                      ensure_ascii=False, indent=1)


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def archivo(rel: str, lang: str, nota: str = "") -> dict:
    return {"lang": lang, "path": rel, "code": code(rel), "nota": nota}


V = "python3 verificar.py"
CURL_CRUDO = ("curl -s http://127.0.0.1:9931/v1/chat/completions \\\n  -H \"Authorization: Bearer dojo-local-7f3a\" -H \"Content-Type: application/json\" \\\n"
              "  -d '{\"model\": \"qwen3-0.6b\", \"messages\": [{\"role\": \"system\", \"content\": \"Contesta en una frase.\"}, "
              "{\"role\": \"user\", \"content\": \"¿Qué es un contrato de arrendamiento?\"}], \"temperature\": 0, \"seed\": 7, \"max_tokens\": 120}'")
_d = L("pc decode")
TOKS = re.search(r"medido (\d+) tokens/s", _d).group(1)
PCT = re.search(r"= (\d+%) del techo", _d).group(1)
_p = L("pc prefill")
PREF_S = re.search(r"prefill en ([\d.]+) s", _p).group(1)
PREF_TPS = re.search(r"\(([\d,]+) tokens/s\)", _p).group(1)
TTFT = re.search(r"TTFT (\d+) ms", L("p4 preguntar")).group(1)

e = {
    "id": "modelo-local", "patron": "llm", "rama": "ia-privada", "etapa": "api", "num": 1,
    "titulo": "Un modelo local por API", "nav": "Modelo local",
    "pregunta": "¿Cómo levantas un modelo open weight en tu propia máquina, detrás de una API que cualquier programa sepa usar, sin que nadie más llegue a él y sin que la plantilla, el contexto o el razonamiento te den respuestas malas en silencio?",
    "version": "2026-11-27",
}

e["mapa"] = {
    "resumen": "El despacho quiere preguntarle a sus expedientes con un LLM, sin que un solo documento salga de su red. El primer paso es tener el modelo en una máquina propia y hablarle como se le habla a cualquier API de LLM. Se usa un modelo <b>open weight</b> (sus pesos se bajan y corren donde quieras) y un <b>servidor de inferencia</b>: el programa que carga los pesos en memoria, recibe mensajes por HTTP y devuelve texto. Aquí es <b>llama-server</b> de llama.cpp con <b>Qwen3-0.6B</b>, la versión chica de la familia del Qwen3 32B que el despacho piensa usar. Habla la <b>API compatible con OpenAI</b>: las mismas rutas (<code>/v1/chat/completions</code>, <code>/v1/models</code>) y el mismo JSON, así que el cliente de esta estación sirve igual contra vLLM en el servidor del despacho. Lo que se aprende es lo que nadie ve hasta que falla: escuchar solo en <code>127.0.0.1</code>, pedir <b>clave</b>, darle el <b>contexto</b> que pide el prompt del despacho, usar la <b>plantilla de chat</b> del modelo, apagar el <b>razonamiento</b>, y un cliente con <b>streaming</b>, <b>TTFT</b>, conteo de tokens, errores claros y <b>JSON con citas</b> que se pueden validar.",
    "entra": [
        "el modelo: Qwen3-0.6B en GGUF, cuantizado a Q8_0, de un commit fijo de Hugging Face (ggml-org/Qwen3-0.6B-GGUF) y con su sha256",
        "llama.cpp 1.1.0 o más nuevo, de Homebrew: trae llama-server",
        "las necesidades del despacho (su ficha): prompts de ≈ 6,000 tokens, 8,192 de contexto, nada fuera de su red, el razonamiento apagado",
    ],
    "sale": [
        "<code>servidor.env</code> y <code>servir.sh</code>: el modelo servido en <code>http://127.0.0.1:9931/v1</code>, con clave, 8,192 tokens de contexto, la plantilla de Qwen3 y sin razonamiento",
        "<code>pipeline/llm.py</code>: un cliente con chat, streaming (con su TTFT), conteo de tokens, errores con nombre y JSON con un schema; es el que usa la estación 8 del entrenamiento RAG",
        "las cuentas de tu Mac, medidas: tokens por segundo al generar, segundos de prefill de un prompt del despacho y memoria del KV cache",
        "la estación 7 del entrenamiento RAG: es esta misma, así que si haces las dos, la haces una vez (la estación 8 del RAG, «La API con citas», trae este servidor y este cliente ya hechos)",
    ],
    "escala": [
        {"que": "El modelo", "ref": "Qwen3 32B en INT4 de AWQ: 19.32 GB de pesos", "taller": "Qwen3-0.6B en Q8_0: 0.80 GB"},
        {"que": "El servidor", "ref": "vLLM en una GPU NVIDIA del servidor del despacho", "taller": "llama-server de llama.cpp en tu Mac (Metal)"},
        {"que": "A la vez", "ref": "8 conversaciones de 8,192 tokens", "taller": "1 de 8,192"},
        {"que": "Quién llega", "ref": "la red interna, detrás de un gateway con TLS y llaves por persona (estación 4)", "taller": "solo tu Mac: 127.0.0.1 y una clave"},
        {"que": "Velocidad", "ref": "≈ 31 tokens/s por conversación de techo; ≈ 2.2 s de prefill de 6,000 tokens", "taller": f"≈ {TOKS} tokens/s medidos; {PREF_S} s de prefill de 6,013 tokens"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir nada, las cuentas de servilleta de un modelo servido: cuánto pesa, cuánta memoria pide el contexto, cuánto contexto le toca a cada petición, qué tan rápido puede escribir y cuánto tarda en leer el prompt. Cada una en el despacho (con su ficha) y en el dojo (medida en tu Mac).",
    "cuentas": [
        {"id": "pesos", "pregunta": "¿Cuánto pesa el modelo en memoria?",
         "formula": "bytes de pesos = parámetros × bits por parámetro ÷ 8",
         "ref": {"cuenta": "Qwen3 32B: 32.76 mil millones de parámetros en INT4 de AWQ (4 bits por peso, más escalas y algunas capas en 16 bits)", "valor": "19.32 GB: 4.72 bits por parámetro en promedio"},
         "taller": {"cuenta": "Qwen3-0.6B: 751.6 millones de parámetros en Q8_0 (bloques de 32 pesos: 32 bytes + 2 de escala)", "valor": "0.80 GB: 8.50 bits por parámetro"},
         "decide": "Los pesos se leen completos para escribir cada token, así que su tamaño decide la memoria mínima y la velocidad máxima. Cuantizar es elegir cuántos bits por peso (la estación 2 mide qué se pierde).",
         "conceptos": ["open-weight", "gguf"],
         "comprueba": cmd(P("pc pesos"), L("pc pesos"))},
        {"id": "kv", "pregunta": "¿Cuánta memoria pide el contexto?",
         "formula": "KV cache por token = 2 (K y V) × capas × cabezas K/V × dimensión de cada cabeza × 2 bytes; por conversación, × los tokens de contexto",
         "ref": {"cuenta": "Qwen3 32B: 64 capas, 8 cabezas K/V de 128; 8 conversaciones de 8,192 tokens", "valor": "256 KiB por token · 2.15 GB por conversación · 17.18 GB las 8"},
         "taller": {"cuenta": "Qwen3-0.6B: 28 capas, 8 cabezas K/V de 128 (lo dice el encabezado del GGUF); 8,192 tokens", "valor": "112 KiB por token · 896 MiB"},
         "decide": "En el despacho, el contexto de las 8 conversaciones pesa casi lo mismo que el modelo. Prometer más contexto o más gente a la vez es pedir memoria: se calcula antes de prometerlo.",
         "conceptos": ["kv-cache", "contexto"],
         "comprueba": cmd(P("pc ficha") + "\n" + P("pc kv"), L("pc ficha") + "\n\n" + L("pc kv"), "La ficha lee el encabezado del archivo GGUF sin cargar los pesos: capas y cabezas salen de ahí, no de la memoria.")},
        {"id": "reparto", "pregunta": "¿Cuánto contexto le toca a cada petición?",
         "formula": "contexto por petición = contexto del servidor ÷ peticiones a la vez (llama-server con -np fijo, sin KV unificado); tiene que caber el prompt más la respuesta",
         "ref": {"cuenta": "≈ 6,000 tokens de entrada + ≈ 500 de salida, 8 conversaciones a la vez", "valor": "8,192 por conversación: en llama-server serían -c 65536 -np 8; vLLM reparte su memoria en bloques (estación 3)"},
         "taller": {"cuenta": "-c 8192 con -np 1; y lo que pasa con -np 4", "valor": "8,192 con una; 2,048 cada una con 4, y el prompt del despacho ya no cabe"},
         "decide": "PARALELO no es gratis: con el mismo -c, cada petición recibe menos. Si hacen falta 4 a la vez de 8,192, el servidor necesita -c 32768 y 4 veces el KV cache.",
         "conceptos": ["contexto", "slots"],
         "confirma": "Paso 2 (<code>/v1/models</code> dice <code>n_ctx</code> y el log dice <code>n_ctx_slot</code>) y la falla «paralelo-reparte»."},
        {"id": "decode", "pregunta": "¿Qué tan rápido puede escribir el modelo?",
         "formula": "tokens por segundo (una conversación) ≤ ancho de banda de memoria ÷ bytes de pesos; en la práctica, una fracción (≈ 0.7)",
         "ref": {"cuenta": "0.7 × 864 GB/s de la L40S ÷ 19.32 GB", "valor": "≈ 31.3 tokens/s por conversación (el objetivo es ≥ 20)"},
         "taller": {"cuenta": "120 GB/s de memoria del M4 de esta Mac ÷ 0.80 GB", "valor": f"techo ≈ 150 tokens/s; medido ≈ {TOKS} ({PCT})"},
         "decide": "Escribir es leer los pesos completos una vez por token: manda la memoria, no los FLOPs. Un modelo más chico o menos bits por peso escribe más rápido; una GPU con más ancho de banda, también.",
         "conceptos": ["decode-prefill", "tokens"],
         "comprueba": cmd(P("pc decode"), L("pc decode"))},
        {"id": "prefill", "pregunta": "¿Cuánto tarda en leer el prompt del despacho (el tiempo al primer token)?",
         "formula": "prefill ≈ 2 × parámetros × tokens del prompt ÷ FLOPs que la máquina hace de verdad",
         "ref": {"cuenta": "2 × 32.76 mil millones × 6,000 tokens ÷ (0.5 × 362 TFLOPS de la L40S)", "valor": "≈ 2.17 s: ya pasa el objetivo de TTFT ≤ 2 s con una sola pregunta"},
         "taller": {"cuenta": "un prompt de 6,013 tokens en tu Mac, medido por llama-server", "valor": f"{PREF_S} s ({PREF_TPS} tokens/s)"},
         "decide": "Leer el prompt sí es cuestión de FLOPs: los tokens del prompt se procesan juntos. Un prompt de 6,000 tokens marca el TTFT, no la pregunta del usuario: menos fragmentos o una GPU con más FLOPs.",
         "conceptos": ["decode-prefill", "ttft"],
         "comprueba": cmd(P("pc prefill"), L("pc prefill"), "Se corre dos veces y se reporta la segunda (la primera calienta). <code>cache_prompt: false</code> obliga a leerlo completo.")},
    ],
}

C = []


def con(id_, termino, en, def_, analogia, importa, trampa):
    assert len(def_) <= 220, (id_, len(def_))
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


con("open-weight", "Modelo de pesos abiertos", "open-weight model",
    "Un modelo cuyos pesos (los números que aprendió) se publican para bajarlos y correrlos en tu máquina, bajo una licencia. Qwen3 es Apache 2.0.",
    "Como una receta publicada en vez de un restaurante: cocinas en tu casa, con tus ingredientes, y nadie ve lo que comes.",
    "Es lo que deja al despacho tener el modelo en su red: los documentos nunca viajan a un tercero.",
    "Confundir «se puede bajar» con «se puede usar para todo»: cada modelo tiene su licencia, y algunas limitan el uso comercial.")
con("gguf", "GGUF y Q8_0", "GGUF file, Q8_0 quantization",
    "GGUF es el formato de llama.cpp: un solo archivo con los pesos, el tokenizer y la plantilla de chat. Q8_0 guarda cada peso en 8 bits, por bloques de 32 con su escala.",
    "Como un libro que trae su propio diccionario y sus instrucciones de lectura, en un solo tomo.",
    "Un archivo, con su sha256, es todo lo que hay que llevar al servidor. Q8_0 pierde casi nada contra los pesos originales y pesa la mitad.",
    "Bajar un GGUF de cualquier repositorio sin fijar el commit ni comprobar el sha256: el mismo nombre de archivo puede cambiar mañana.")
con("servidor-inferencia", "Servidor de inferencia", "inference server",
    "El programa que carga los pesos en memoria una vez y contesta peticiones por HTTP: arma el prompt, lo lee, genera los tokens y los devuelve.",
    "Como la cocina de un restaurante: la estufa se prende una vez en la mañana y de ahí salen todos los platillos.",
    "Separa el modelo de quien lo usa: el asistente, el RAG o un script hablan HTTP, sin cargar nada.",
    "Cargar el modelo dentro de cada script: cada uno tarda en arrancar y se come su propia copia de memoria.")
con("api-openai", "API compatible con OpenAI", "OpenAI-compatible API",
    "Las rutas y el JSON que popularizó OpenAI: POST /v1/chat/completions con «messages», GET /v1/models. llama-server, vLLM y Ollama la hablan.",
    "Como el contacto eléctrico estándar: cualquier aparato se conecta, sin importar quién hizo la planta de luz.",
    "El mismo cliente sirve contra tu Mac, contra vLLM en el despacho o contra una API pública: solo cambia la URL base.",
    "Olvidar el /v1 de la URL base o poner el puerto equivocado: el cliente no encuentra a nadie y el servidor está sano.")
con("host-puerto", "Host y puerto", "bind address, port",
    "El host es en qué interfaz de red escucha el servidor: 127.0.0.1 es solo esta máquina; 0.0.0.0, todas (cualquiera en la red). El puerto es la puerta: llama-server usa 9931.",
    "Como el timbre de un departamento: 127.0.0.1 es el interfón que solo suena adentro; 0.0.0.0, un timbre en la calle.",
    "En el despacho, el modelo vive detrás de un gateway con TLS y llaves por persona. En la Mac, nadie más tiene por qué llegar.",
    "Abrir a 0.0.0.0 «para probar»: funciona, nadie se queja, y el modelo queda en la red Wi-Fi con la clave viajando en texto plano.")
con("api-key", "Clave de la API", "API key, bearer token",
    "Un texto que el servidor pide en cada petición, en el encabezado «Authorization: Bearer …». Sin la clave correcta contesta 401.",
    "Como el gafete de la oficina: el guardia no pregunta quién eres, solo si traes uno válido.",
    "Es la primera barrera: un programa que llega al puerto no usa el modelo sin ella. /health queda abierto porque solo dice si está vivo.",
    "Probar solo que «con la clave funciona»: si nadie prueba sin clave, nadie se entera el día que se quita.")
con("tokens", "Tokens y tokenizer", "tokens, tokenizer",
    "Los pedazos en que el modelo parte el texto (palabras, partes de palabra, signos). Todo se cuenta en tokens: el contexto, la velocidad y el costo.",
    "Como las piezas de un rompecabezas: «arrendamiento» son 3 piezas; «Clause four.» en inglés, 3 en total.",
    "El contexto, el tiempo de prefill y los tokens por segundo se miden en tokens, no en palabras ni caracteres. El español gasta más tokens que el inglés.",
    "Calcular el contexto en palabras: «Cláusula cuarta.» son 2 palabras y 7 tokens.")
con("contexto", "Contexto", "context window, n_ctx",
    "Cuántos tokens caben en una petición: el prompt completo (instrucciones, fragmentos, pregunta) más la respuesta. llama-server lo fija al arrancar con -c.",
    "Como la mesa de trabajo: lo que no cabe en la mesa, el modelo no lo ve.",
    "El prompt del despacho (≈ 6,000 tokens) más la respuesta pide 8,192. Si no cabe, el servidor contesta 400 en vez de cortar en silencio.",
    "Creer que el máximo del modelo (40,960 según su GGUF y su config; su tarjeta dice 32,768) es el que usa el servidor: usa el que le das con -c.")
con("slots", "Peticiones a la vez", "parallel slots (-np)",
    "Cuántas peticiones atiende llama-server a la vez, cada una en su lugar (slot). Con -np fijo, el KV no se comparte (kv_unified false) y cada lugar recibe -c ÷ -np.",
    "Como partir una mesa grande en cuatro lugares: caben cuatro personas, pero cada una con un cuarto de mesa.",
    "Con -c 8192 y -np 4, cada petición tiene 2,048 tokens: las preguntas cortas siguen bien y el prompt del despacho truena.",
    "Subir PARALELO sin subir el contexto: nada da error al arrancar; truena después, con los prompts largos. (Con -np en automático, llama-server comparte un solo KV entre todos: --kv-unified.)")
con("kv-cache", "KV cache", "key-value cache",
    "Lo que el modelo guarda de cada token ya leído (sus claves y valores de atención) para no recalcularlo al escribir el siguiente. Crece con cada token del contexto.",
    "Como los apuntes de una junta: para seguir la conversación no relees todo, consultas tus notas; pero las notas ocupan espacio.",
    "Es la otra mitad de la memoria: en el despacho, 8 conversaciones de 8,192 tokens piden 17.18 GB, casi lo que pesa el modelo.",
    "Calcular la memoria solo con los pesos: el modelo arranca, y la memoria se acaba con la quinta conversación larga.")
con("plantilla", "Plantilla de chat", "chat template (ChatML)",
    "Cómo se convierten los mensajes (system, user, assistant) en el texto que el modelo leyó al entrenarse. Qwen3 usa ChatML: <|im_start|>user … <|im_end|>.",
    "Como el formato de un formulario oficial: la misma información, en otro orden o sin los recuadros, ya no la procesan.",
    "Viene dentro del GGUF y llama-server la usa por omisión (--jinja). Con la de otro modelo, la pregunta entra rota y la respuesta no tiene que ver.",
    "Copiar --chat-template de un tutorial de otro modelo: nada da error; la pregunta de prueba entra como 3 tokens en vez de 33.")
con("razonamiento", "Razonamiento", "reasoning / thinking mode",
    "Qwen3 puede «pensar» antes de contestar: escribe un razonamiento (reasoning_content) y luego la respuesta. llama-server lo controla con --reasoning on, off o auto.",
    "Como un abogado que dicta en voz alta todo lo que piensa antes de darte la respuesta: a veces ayuda; casi siempre, tarda.",
    "Esos tokens cuestan tiempo y contexto. El despacho lo quiere apagado: sus respuestas salen de los fragmentos, no de un razonamiento largo.",
    "Dejarlo «por omisión»: es auto, el modelo razona, y con max_tokens chico la respuesta se corta antes de empezar.")
con("decode-prefill", "Prefill y decode", "prefill vs decode",
    "Prefill: leer el prompt completo de un jalón (manda la capacidad de cálculo). Decode: escribir la respuesta token por token (manda leer los pesos de memoria cada vez).",
    "Como leer un expediente y después dictar la respuesta: leer es rápido y en bloque; dictar va palabra por palabra.",
    "Son dos números distintos: el prefill marca el tiempo al primer token; el decode, qué tan rápido sale el resto.",
    "Medir «tokens por segundo» mezclando los dos: un prompt largo hace ver lento a un modelo que escribe rápido (la estación 2).")
con("streaming", "Streaming (SSE)", "server-sent events",
    "Con stream: true, el servidor manda la respuesta en pedazos conforme la escribe, cada uno en una línea «data: {…}», y termina con «data: [DONE]».",
    "Como un intérprete simultáneo: oyes la traducción mientras habla, no al final del discurso.",
    "Una respuesta de 500 tokens tarda ≈ 25 s en escribirse en el despacho: con streaming se empieza a leer en 2.",
    "Olvidar stream_options include_usage: sin él, el último evento no trae los tokens y no sabes cuánto gastaste.")
con("ttft", "Tiempo al primer token", "TTFT, time to first token",
    "Los segundos entre mandar la pregunta y recibir el primer pedazo de texto. Lo marca el prefill más la espera en fila.",
    "Como el tiempo que tarda el mesero en traer el primer platillo: aunque todo llegue después, ese es el que se siente.",
    "Es el número que siente la persona: el objetivo del despacho es ≤ 2 s en el p95.",
    "Medirlo sin stream: sin pedazos, solo se ve el total.")
con("errores", "Errores con nombre", "typed errors",
    "Distinguir por qué falló una llamada: no hay nadie en esa URL (SinConexion), la clave no sirve (NoAutorizado, 401), el prompt no cabe (ContextoExcedido, 400) u otra cosa.",
    "Como los focos del tablero del coche: no es lo mismo «sin gasolina» que «motor caliente», aunque en los dos casos no avanzas.",
    "Quien usa el cliente (el RAG, la API con citas) decide distinto en cada caso: reintentar, avisar a TI o recortar fragmentos.",
    "Atrapar todo con un except genérico: el asistente dice «error» y nadie sabe si fue el puerto, la clave o el contexto.")
con("json-schema", "Salida con schema", "structured output, JSON schema",
    "Pedirle al servidor que la respuesta cumpla un JSON schema. llama-server lo convierte en una gramática y solo deja escribir tokens que la respeten.",
    "Como un formulario con casillas de opción: no puedes escribir cualquier cosa, solo marcar una de las que hay.",
    "Con citas = enum de los ids de los fragmentos, el modelo no puede citar uno que no existe. La estación 8 del RAG lo usa para validar citas.",
    "Creer que el schema hace correcta la respuesta: garantiza la forma, no el fondo. Aquí citó C-07 bien, y además C-11 y C-15, que no venían al caso.")
con("determinismo", "Temperatura y semilla", "temperature, seed",
    "La temperatura decide cuánto azar hay al elegir cada token (0 = el más probable). La semilla fija ese azar para que se pueda repetir.",
    "Como tirar un dado cargado: con temperatura 0 siempre sale el mismo número; con la misma semilla, la misma secuencia de tiros.",
    "Con temperatura 0 y la misma semilla, la misma pregunta da el mismo texto: así se puede probar y comparar.",
    "Esperar lo mismo entre máquinas o versiones: otra cuantización, otro build o varias peticiones a la vez pueden cambiar el resultado.")
e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae lo justo para servir un modelo en tu Mac como lo haría el despacho en su servidor: el catálogo con el modelo fijado (<b>Qwen3-0.6B en Q8_0</b>, de <b>ggml-org/Qwen3-0.6B-GGUF</b>, commit <code>afe8ad35</code>, 805 MB, con su sha256), lo que lo baja y lo comprueba, lo que arranca y para tu servidor con su log, y cuatro <b>cláusulas ficticias de un contrato de arrendamiento</b> del despacho para las preguntas con cita. Tú escribes cómo se sirve (<code>servidor.env</code> y <code>servir.sh</code>) y el cliente (<code>pipeline/llm.py</code>). Todo usa solo la biblioteca estándar de Python: sin entorno virtual, sin Docker y sin internet después de bajar el modelo.",
    "trae": [
        {"que": "mundo/modelos.json y modelos.py", "detalle": "El catálogo (repositorio, commit, archivo, bytes, sha256 y licencia) y lo que baja el modelo a <code>modelo/</code>, una vez. Si el sha256 no coincide, no se guarda. Con <code>TRUEML_MODELOS=&lt;carpeta&gt;</code> lo copia de otra carpeta en vez de bajarlo."},
        {"que": "mundo/servidor.py", "detalle": "<code>arrancar</code> corre tu <code>servir.sh</code> en segundo plano y espera a que <code>/health</code> diga ok; <code>parar</code>, <code>estado</code> y <code>log</code> (el log queda en <code>.taller/servidor.log</code>). Es lo que en el despacho haría systemd o el contenedor."},
        {"que": "mundo/ficha.py", "detalle": "Lee el encabezado de un GGUF sin cargar los pesos: arquitectura, capas, cabezas, contexto de entrenamiento, plantilla de chat y, con <code>--tipos</code>, cuántos pesos hay de cada tipo de cuantización."},
        {"que": "mundo/entrada/clausulas.json", "detalle": "Cuatro fragmentos ficticios de un contrato (C-04, C-07, C-11 y C-15) y tres preguntas con el fragmento que las contesta."},
        {"que": "pipeline/preguntar.py y citar.py", "detalle": "Usan tu cliente desde la terminal: una pregunta en streaming con sus tiempos, y las tres preguntas con citas."},
        {"que": "verificar.py y romper.py", "detalle": "Los 10 checks de la estación (de <code>mundo</code> a <code>citas</code>) contra tu servidor de verdad, y las 6 fallas: el puerto movido, el servidor abierto a la red, 4 peticiones a la vez que reparten el contexto, sin clave, el razonamiento de vuelta y la plantilla de otro modelo."},
    ],
    "tu_pipeline": [
        {"archivo": "servidor.env", "hace": "Paso 1: el modelo, el alias, host y puerto, el contexto, cuántas a la vez, el razonamiento, la clave y la URL del cliente."},
        {"archivo": "servir.sh", "hace": "Paso 2: el comando de llama-server con todo eso."},
        {"archivo": "pipeline/llm.py", "hace": "Pasos 3 a 6: modelos, tokens y chat; el streaming con su TTFT; los errores con nombre; y el JSON con schema."},
    ],
    "requisitos": [
        "Una Mac con chip Apple (M1 o más nuevo) y ≈ 2 GB de RAM libre; se probó en un MacBook Air M4 de 16 GB",
        "llama.cpp 1.1.0 o más nuevo (<code>brew install llama.cpp</code>; se probó con 1.1.0, build 12774) y Python 3 (se probó con 3.14.3)",
        "≈ 805 MB de disco para el modelo e internet para bajarlo una vez; después, nada",
    ],
    "sustituciones": [
        {"nube": "vLLM en una GPU NVIDIA del servidor del despacho", "local": "llama-server de llama.cpp en tu Mac, con Metal", "diferencia": "Los dos hablan la API compatible con OpenAI y tu cliente no cambia. vLLM está hecho para muchas conversaciones a la vez en una GPU (la estación 3); llama-server, para correr bien en una máquina chica."},
        {"nube": "Qwen3 32B en INT4 de AWQ (19.32 GB)", "local": "Qwen3-0.6B en Q8_0 (0.80 GB)", "diferencia": "La misma familia: el mismo tokenizer y la misma plantilla de chat, en chico. Contesta mucho peor (se equivoca en derecho), y escribe mucho más rápido."},
        {"nube": "La red interna, detrás de un gateway con TLS y llaves por persona", "local": "127.0.0.1 y una sola clave en <code>servidor.env</code>", "diferencia": "La idea es la misma: el modelo no queda a la vista. El gateway (la estación 4) agrega llaves por persona, límites y bitácora."},
        {"nube": "systemd o un contenedor que mantienen vivo el servidor", "local": "<code>mundo/servidor.py arrancar|parar</code>", "diferencia": "Lo mismo en chico: un proceso en segundo plano con su log en un lugar fijo."},
    ],
    "arranque": "unzip ia-privada-modelo-local.zip && cd ia-privada-modelo-local\nbrew install llama.cpp\npython3 mundo/modelos.py\npython3 verificar.py mundo",
    "python": "python3",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="llama.cpp instalado y el modelo en <code>modelo/</code>, con su sha256.",
    conceptos=["open-weight", "gguf"],
    explica="<code>brew install llama.cpp</code> instala <code>llama-server</code> (y otras herramientas: <code>llama-quantize</code> y <code>llama-bench</code> salen en la estación 2). <code>mundo/modelos.py</code> baja el GGUF de un commit fijo de Hugging Face y comprueba su sha256 contra <code>mundo/modelos.json</code>: si no coincide, no lo guarda. No hace falta entorno virtual: el kit solo usa la biblioteca estándar.",
    codigo=[],
    comandos=[
        cmd("brew install llama.cpp\nllama-server --version\npython3 --version", L("p0 version"), "Si ya lo tenías, <code>brew upgrade llama.cpp</code>. El kit se probó con 1.1.0."),
        cmd("python3 mundo/modelos.py", L("p0 modelos"), "Con internet tarda lo que tarden 805 MB. Aquí se copió de otra carpeta (<code>TRUEML_MODELOS</code>), con el mismo sha256."),
        cmd("python3 mundo/modelos.py --listar", L("p0 listar")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} config", L("p0 esqueleto"), "Es lo esperado: <code>servidor.env</code> viene vacío. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde: llama-server 1.1.0 o más nuevo y el modelo con el sha256 del catálogo.",
    ojo="<code>modelo/</code> no va en el .zip ni en git: se baja. El mismo nombre de archivo en otro repositorio (Qwen/Qwen3-0.6B-GGUF trae su propio Q8_0, de 639 MB) es otro archivo, con otro sha256."))

G.append(dict(n=1, id="config", titulo="Decidir cómo se sirve", objetivo="<code>servidor.env</code>: qué modelo, con qué nombre, dónde escucha, cuánto contexto, cuántas peticiones a la vez, sin razonamiento, con clave, y la URL que usa el cliente.",
    conceptos=["host-puerto", "api-key", "contexto", "slots", "razonamiento", "api-openai"],
    explica="Cada línea es una decisión. <b>MODELO</b>: el archivo, relativo al kit. <b>ALIAS</b>: el nombre con el que la API anuncia el modelo y que va en el campo «model» de cada petición. <b>HOST=127.0.0.1</b>: solo esta Mac. <b>PUERTO=9931</b>: el que usa llama-server por omisión. <b>CONTEXTO=8192</b>: el prompt del despacho (≈ 6,000) más la respuesta. <b>PARALELO=1</b>: una petición a la vez, con todo el contexto para ella. <b>RAZONAMIENTO=off</b>. <b>CLAVE</b>: una de práctica, de 8 caracteres o más. <b>LLM_URL</b>: lo que usa el cliente, armado con el mismo host y puerto, y con /v1 al final. El mismo archivo lo leen <code>servir.sh</code> (con <code>source</code>), tu cliente y <code>verificar.py</code>: una sola fuente de verdad.",
    codigo=[archivo("servidor.env", "bash")],
    comandos=[cmd(f"{V} config", L("p1 verificar"))],
    verifica="<code>verificar.py config</code> en verde: el modelo del catálogo, 127.0.0.1, la URL armada con el mismo host y puerto y /v1, contexto ≥ 8,192, razonamiento off y una clave.",
    ojo="LLM_URL repite HOST y PUERTO. Si un día se cambia el puerto, se cambian los dos: es justo lo que rompe la primera falla.",
    en_pagina={"conceptos": ["host-puerto", "api-key", "contexto", "slots", "razonamiento", "api-openai"], "precalculos": ["reparto"]}))

G.append(dict(n=2, id="servir", titulo="Arrancar el servidor", objetivo="<code>servir.sh</code>: llama-server con todo lo de <code>servidor.env</code>; arrancarlo, y ver con <code>curl</code> que contesta, que pide clave y que arma bien los mensajes.",
    conceptos=["servidor-inferencia", "plantilla", "api-key", "tokens", "kv-cache"],
    explica="<code>servir.sh</code> lee <code>servidor.env</code> y termina en <code>exec llama-server</code> (exec: el proceso de bash se vuelve el servidor, así <code>parar</code> le llega directo). Las opciones: <code>-m</code> el modelo, <code>--alias</code>, <code>--host</code> y <code>--port</code>, <code>-c</code> el contexto, <code>-np</code> cuántas a la vez, <code>--reasoning</code> y <code>--api-key</code>. La <b>plantilla de chat</b> no se pone: viene dentro del GGUF y llama-server la usa por omisión. <code>python3 mundo/servidor.py arrancar</code> lo corre en segundo plano y espera a <code>/health</code>. Después se revisa con <code>curl</code>: <code>/health</code> abierto, <code>/v1/models</code> con y sin clave, <code>/props</code> (qué cargó y su plantilla) y una pregunta cruda.",
    codigo=[archivo("servir.sh", "bash")],
    comandos=[
        cmd("python3 mundo/servidor.py arrancar", L("p2 arrancar"), "Tarda menos de un segundo: 0.8 GB se leen rápido del SSD."),
        cmd("curl -s http://127.0.0.1:9931/health", L("p2 health")),
        cmd("curl -s http://127.0.0.1:9931/v1/models", L("p2 sin clave"), "Sin clave: 401. Es lo que ve cualquier programa que llegue al puerto."),
        cmd("curl -s -H \"Authorization: Bearer dojo-local-7f3a\" http://127.0.0.1:9931/v1/models", L("p2 modelos"), "Recortado a lo que importa: el alias, el contexto que cargó (n_ctx), los parámetros y el tamaño de los pesos."),
        cmd("curl -s -H \"Authorization: Bearer dojo-local-7f3a\" http://127.0.0.1:9931/props", L("p2 props"), "Recortado: la plantilla de chat es la del GGUF (ChatML, con <code>&lt;|im_start|&gt;</code>)."),
        cmd("grep -E \"n_ctx_slot|listening\" .taller/servidor.log", L("p2 log"), "Una petición a la vez, con los 8,192 tokens para ella."),
        cmd(CURL_CRUDO, crudo(L("p2 crudo")), "Recortado a lo que importa. Los dos mensajes entraron como 33 tokens (la plantilla agrega sus marcas), no hubo razonamiento y terminó solo (stop). <code>timings</code> trae lo que midió el servidor: 33 tokens leídos y los de la respuesta, en milisegundos."),
        cmd(f"{V} servidor clave plantilla", L("p2 verificar")),
    ],
    verifica="<code>verificar.py servidor</code>, <code>clave</code> y <code>plantilla</code> en verde: el servidor sirve el alias y el archivo del catálogo con el contexto de <code>servidor.env</code>; sin clave o con otra, 401; la pregunta de prueba entra como 33 tokens, sin razonamiento, y la respuesta termina sola.",
    ojo="Al terminar la sesión, <code>python3 mundo/servidor.py parar</code>: el servidor sigue vivo en segundo plano aunque cierres la terminal. Y la clave de práctica no se reusa en ningún lado.",
    en_pagina={"conceptos": ["open-weight", "gguf", "servidor-inferencia", "plantilla", "tokens", "kv-cache"], "precalculos": ["pesos", "kv"]}))

G.append(dict(n=3, id="cliente", titulo="El cliente", objetivo="<code>Cliente</code> en <code>pipeline/llm.py</code>: listar los modelos, contar tokens y mandar un chat sin stream, todo con la biblioteca estándar.",
    conceptos=["api-openai", "tokens", "determinismo"],
    explica="<code>Cliente()</code> toma <code>LLM_URL</code>, <code>CLAVE</code> y <code>ALIAS</code> de <code>servidor.env</code> (viene dado). Cada llamada es una petición HTTP con <code>urllib</code>: el encabezado <code>Authorization: Bearer</code> y el cuerpo en JSON. <code>modelos()</code> es <code>GET /v1/models</code>. <code>contar_tokens()</code> es <code>POST /tokenize</code>, que vive en la raíz del servidor, sin /v1 (no es parte de la API de OpenAI: es de llama-server). <code>chat()</code> es <code>POST /v1/chat/completions</code> con model, messages, max_tokens, temperature y seed, y devuelve una <code>Respuesta</code> con el texto, los tokens de entrada y de salida, por qué terminó y cuánto tardó. Se usa urllib y no el SDK de openai para que se vea lo que viaja; el SDK hace lo mismo con <code>base_url</code>.",
    codigo=[archivo("pipeline/llm.py", "python", "En este paso escribes <code>_pedir</code>, <code>_json</code>, <code>_cuerpo</code>, <code>modelos</code>, <code>contar_tokens</code> y <code>chat</code>. El streaming es el paso 4, los errores con nombre el 5 y <code>chat_json</code> el 6: aquí va el archivo completo, como queda al final.")],
    comandos=[
        cmd(P("p3 cliente"), L("p3 cliente"), "Funciona, y la respuesta está mal: una pena convencional es lo que se paga por incumplir un contrato, no un castigo por un delito. Un modelo de 0.6B no sabe derecho; por eso el despacho usa uno de 32B y el RAG le da los fragmentos."),
        cmd(P("p3 tokens"), L("p3 tokens"), "El mismo sentido en inglés cuesta menos de la mitad. Las cuentas de contexto y velocidad del despacho se hacen en tokens de su español."),
        cmd(f"{V} cliente", L("p3 verificar")),
    ],
    verifica="<code>verificar.py cliente</code> en verde: <code>modelos()</code> trae el alias, «Cláusula cuarta.» son 7 tokens, y la misma pregunta con temperatura 0 y la misma semilla da el mismo texto dos veces.",
    ojo="<code>/tokenize</code> está en la raíz y lo demás bajo /v1: si armas la URL de <code>/tokenize</code> con LLM_URL, da 404.",
    en_pagina={"conceptos": ["determinismo"], "precalculos": []}))

G.append(dict(n=4, id="stream", titulo="Streaming y tiempo al primer token", objetivo="<code>chat_stream()</code>: ir soltando el texto conforme llega y medir el tiempo al primer token.",
    conceptos=["streaming", "ttft", "decode-prefill"],
    explica="Con <code>\"stream\": true</code> la respuesta llega como <b>server-sent events</b>: líneas <code>data: {…}</code>, cada una con un pedazo en <code>choices[0].delta.content</code>, y al final <code>data: [DONE]</code>. Con <code>stream_options: {\"include_usage\": true}</code>, el último evento trae los tokens y los <code>timings</code>. <code>chat_stream()</code> es un generador: lee línea por línea, suelta cada pedazo con <code>yield</code>, anota cuánto tardó el primero (<b>TTFT</b>) y, al terminar, deja la <code>Respuesta</code> completa en <code>Cliente.ultima</code>. <code>pipeline/preguntar.py</code> (viene dado) lo usa desde la terminal.",
    codigo=[],
    comandos=[
        cmd(P("p4 preguntar"), L("p4 preguntar"), f"El texto aparece conforme se escribe. TTFT de {TTFT} ms: el prompt es corto (55 tokens). Con uno del despacho serían segundos (el precálculo del prefill)."),
        cmd(f"{V} stream", L("p4 verificar")),
    ],
    verifica="<code>verificar.py stream</code> en verde: varios pedazos, un TTFT mayor que 0 y menor que el total, y la Respuesta del final con el texto completo y sus tokens.",
    ojo="El primer evento del stream puede venir sin texto (solo el rol): el TTFT se mide con el primer pedazo que trae texto.",
    en_pagina={"conceptos": ["streaming", "ttft", "decode-prefill"], "precalculos": ["decode", "prefill"]}))

G.append(dict(n=5, id="errores", titulo="Cuando algo sale mal", objetivo="Errores con nombre: <code>SinConexion</code>, <code>NoAutorizado</code> y <code>ContextoExcedido</code> (con cuántos tokens traía el prompt y cuántos caben).",
    conceptos=["errores", "contexto"],
    explica="<code>_pedir()</code> convierte lo que pasa en HTTP en un error de tu dominio. Sin servidor (<code>URLError</code>, conexión rechazada, timeout): <code>SinConexion</code>. Un 401: <code>NoAutorizado</code>. Un 400 cuyo cuerpo trae <code>\"type\": \"exceed_context_size_error\"</code>: <code>ContextoExcedido</code>, con <code>n_prompt_tokens</code> y <code>n_ctx</code> del cuerpo. Lo demás: <code>ErrorLLM</code> con el código y el mensaje. Así quien usa el cliente decide: si es <code>ContextoExcedido</code>, mandar menos fragmentos; si es <code>SinConexion</code>, avisar que el servidor no está.",
    codigo=[],
    comandos=[
        cmd(P("p5 contexto"), L("p5 contexto"), "El servidor no corta el prompt en silencio: contesta 400 y dice cuánto traía. Eso es mejor que una respuesta hecha con medio prompt."),
        cmd("python3 mundo/servidor.py parar\npython3 pipeline/preguntar.py \"¿Sigues ahí?\"", L("p5 parar") + "\n" + L("p5 caido")),
        cmd("python3 mundo/servidor.py arrancar", L("p5 arrancar")),
        cmd(P("p5 clave"), L("p5 clave")),
        cmd(f"{V} contexto caido", L("p5 verificar")),
    ],
    verifica="<code>verificar.py contexto</code> y <code>caido</code> en verde: un prompt más largo que el contexto da <code>ContextoExcedido</code> con sus dos números; un puerto sin servidor da <code>SinConexion</code>; una clave equivocada, <code>NoAutorizado</code>.",
    ojo="Un timeout también es <code>SinConexion</code>, pero no siempre quiere decir que el servidor no está: puede estar ocupado. En el despacho, con 8 a la vez, se distingue con la cola del servidor (la estación 3).",
    en_pagina={"conceptos": ["errores"], "precalculos": []}))

G.append(dict(n=6, id="citas", titulo="Citas que se pueden validar", objetivo="<code>chat_json()</code>: pedir la respuesta como JSON con un schema, con las citas restringidas a los ids de los fragmentos.",
    conceptos=["json-schema"],
    explica="<code>chat_json(mensajes, schema)</code> manda <code>response_format: {\"type\": \"json_schema\", \"json_schema\": {\"name\": …, \"schema\": …}}</code> y lee la respuesta como JSON. llama-server convierte el schema en una <b>gramática</b>: al escribir cada token, solo deja los que mantienen el JSON válido. Si en el schema las citas son <code>{\"enum\": [\"C-04\", \"C-07\", \"C-11\", \"C-15\"]}</code>, el modelo no puede citar un fragmento que no le diste. <code>pipeline/citar.py</code> (viene dado) le pasa los fragmentos de <code>mundo/entrada/clausulas.json</code> y hace las tres preguntas: con citas de texto libre (<code>--libre</code>) y con el enum. Es lo que usa la estación 8 del RAG para su API con citas.",
    codigo=[archivo("pipeline/citar.py", "python", "Viene dado: lo importante es el schema.")],
    comandos=[
        cmd("python3 pipeline/citar.py --libre", L("p6 libre"), "Aquí el modelo escribió ids aunque podía escribir cualquier texto, porque los fragmentos van marcados con <code>[C-04]</code>. Nada lo obligaba."),
        cmd("python3 pipeline/citar.py", L("p6 enum"), "Con el enum, citar algo que no es un id es imposible. Y aun así, en la segunda pregunta citó C-11 y C-15, que no tienen que ver: el schema garantiza la forma, no que la cita sea la justa. Validar eso es trabajo de la estación 8 y de las evals."),
        cmd(f"{V} citas", L("p6 verificar")),
        cmd(V, L("fin verificar"), "Todo en verde. Al terminar: <code>python3 mundo/servidor.py parar</code>."),
    ],
    verifica="<code>verificar.py citas</code> en verde: las tres respuestas son JSON válido con el schema, cada cita es un id que existe y cada una incluye el fragmento correcto.",
    ojo="El schema no es un permiso: si el modelo no tiene en el prompt lo que necesita, contesta igual, con JSON perfecto. Por eso el RAG valida que cada cita exista y que diga lo que la respuesta dice.",
    en_pagina={"conceptos": ["json-schema"], "precalculos": []}))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python3 mundo/reiniciar.py</code>: para el servidor, respalda tus archivos en <code>.respaldo/</code> y deja el esqueleto (el modelo se queda).",
        "Sin GUION.md: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "llama-server 1.1.0 o más nuevo y el modelo del catálogo con su sha256.", "check": "mundo"},
        {"n": 2, "objetivo": "Un servidor.env con el modelo, solo en esta Mac, con el contexto del despacho, sin razonamiento, con clave y con la URL del cliente que apunte a él.", "check": "config", "pista": "¿Qué tienen que repetir LLM_URL y las otras líneas?"},
        {"n": 3, "objetivo": "El servidor arriba con el alias, el archivo y el contexto de servidor.env.", "check": "servidor"},
        {"n": 4, "objetivo": "Sin clave o con otra, nadie usa el modelo.", "check": "clave"},
        {"n": 5, "objetivo": "La pregunta de prueba entra como la arma la plantilla de Qwen3 y el modelo contesta sin razonar.", "check": "plantilla", "pista": "¿Qué viene por omisión en llama-server, y qué quieres tú?"},
        {"n": 6, "objetivo": "Un cliente que lista los modelos, cuenta tokens y contesta igual dos veces la misma pregunta.", "check": "cliente", "pista": "¿/tokenize vive bajo /v1?"},
        {"n": 7, "objetivo": "La respuesta en streaming, con su tiempo al primer token y sus tokens al final.", "check": "stream"},
        {"n": 8, "objetivo": "Un prompt que no cabe da un error que dice cuánto traía y cuánto cabe.", "check": "contexto"},
        {"n": 9, "objetivo": "Sin servidor y con la clave equivocada, errores distintos.", "check": "caido"},
        {"n": 10, "objetivo": "Respuestas en JSON con un schema, con citas que solo pueden ser ids de los fragmentos.", "check": "citas"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


ARR = "y <code>python3 mundo/servidor.py arrancar</code>."
e["fallas"] = [
    falla("puerto-movido", "El asistente dice «sin respuesta» y el servidor está arriba", "config",
          "Sistemas pidió mover el servidor del modelo al puerto 8080, «el que usan todos los servicios internos», y lo reinició.",
          "<code>verificar.py config</code> falla (LLM_URL no apunta a HOST:PUERTO) y <code>cliente</code> da <code>SinConexion</code>. El servidor está sano.",
          ["El servidor se cayó.", "El cliente pregunta en otro lado que donde escucha el servidor.", "La clave cambió."],
          cmd("python3 verificar.py config cliente\npython3 pipeline/preguntar.py \"¿Sigues ahí?\"", F("pue verificar") + "\n\n" + F("pue preguntar"), "El servidor escucha en 8080; el cliente sigue preguntando en 9931."),
          "Que los dos digan lo mismo: <code>PUERTO=9931</code> otra vez (o <code>LLM_URL=http://127.0.0.1:8080/v1</code>) " + ARR + " La URL del cliente sale de dónde escucha el servidor: si se cambia uno, se cambia el otro, en el mismo archivo.",
          "host-puerto", "config"),
    falla("expuesto", "Una persona de otra área usó el modelo desde su laptop", "config",
          "Para que un compañero lo probara desde su laptop, alguien cambió HOST en servidor.env y reinició el servidor. Funcionó.",
          "<code>verificar.py config</code> falla: <code>HOST=0.0.0.0</code>. Todo lo demás pasa.",
          ["Alguien tiene la clave.", "El servidor escucha en toda la red, no solo en la Mac.", "El firewall está apagado."],
          cmd("lsof -nP -iTCP:9931 -sTCP:LISTEN", F("exp lsof") + "\n\n— después del arreglo:\n" + F("exp lsof bien"), "<code>*:9931</code> es cualquier interfaz: la Wi-Fi también."),
          "<code>HOST=127.0.0.1</code> (y la LLM_URL con él) " + ARR + " La clave seguía pidiéndose, pero viaja en texto plano (HTTP, sin TLS) por la red y <code>/health</code> contesta a todos. En el despacho, abrirlo a la red es una decisión: detrás de un gateway con TLS, llaves por persona y firewall (la estación 4).",
          "host-puerto", "config"),
    falla("paralelo-reparte", "Desde que «aguanta 4 a la vez», las preguntas largas truenan", "infra",
          "Para que cuatro abogados pudieran preguntar al mismo tiempo, alguien subió PARALELO a 4 en servidor.env y reinició el servidor.",
          "<code>verificar.py servidor</code> falla (el servidor cargó 2,048 tokens de contexto y servidor.env dice 8,192) y <code>contexto</code> también. Las preguntas cortas siguen bien.",
          ["El modelo cambió.", "El contexto se repartió entre las 4 peticiones.", "El prompt del despacho creció."],
          cmd("grep -E \"n_ctx_slot\" .taller/servidor.log", F("par log") + "\n\n" + F("par despacho"), "Con -c 8192 y -np 4, cada lugar tiene 2,048."),
          "<code>PARALELO=1</code> " + ARR + " Si de verdad hacen falta 4 a la vez de 8,192 cada una, <code>CONTEXTO=32768</code>: 4 veces el KV cache (≈ 3.5 GiB en el dojo; en el despacho, la cuenta de su servidor). Cada lugar a la vez cuesta contexto y memoria.",
          "slots", "servidor"),
    falla("sin-clave", "El servidor contesta sin pedir clave", "infra",
          "Para «simplificar», alguien limpió servir.sh de las opciones que «no hacían nada» y reinició el servidor. El asistente sigue contestando igual.",
          "<code>verificar.py clave</code> falla: sin clave, <code>/v1/models</code> contesta 200. <code>cliente</code> pasa: tu cliente manda su clave y nadie la revisa.",
          ["El cliente perdió la clave.", "El servidor ya no pide clave.", "Alguien cambió la clave."],
          cmd("curl -s http://127.0.0.1:9931/v1/models\ncat servir.sh\ngrep security .taller/servidor.log", F("cla curl")[:220] + " …\n" + F("cla curl").splitlines()[-1] + "\n\n" + F("cla servir") + "\n\n" + F("cla log"), "El mismo llama-server avisa en su log que no tiene clave."),
          "<code>--api-key \"$CLAVE\"</code> de vuelta en <code>servir.sh</code> " + ARR + " Nada truena cuando se quita una barrera: por eso se prueba el lado de «sin permiso» (el check <code>clave</code>), no solo que con la clave funciona.",
          "api-key", "clave"),
    falla("razonamiento-auto", "Las respuestas tardan más y salen cortadas a la mitad", "infra",
          "Para «simplificar», alguien limpió servir.sh de las opciones que «venían por omisión» y reinició el servidor.",
          "<code>verificar.py plantilla</code> falla: el modelo razonó antes de contestar.",
          ["Cambió el modelo.", "El servidor ya no apaga el razonamiento.", "max_tokens es muy chico."],
          cmd(CURL_CRUDO, crudo(F("raz crudo")), "Razonó en inglés, gastó los 120 tokens y la respuesta se cortó (finish_reason length). Sin razonar, la misma pregunta usa 31."),
          "<code>--reasoning \"$RAZONAMIENTO\"</code> de vuelta en <code>servir.sh</code> " + ARR + " Por omisión es auto, y lo que viene por omisión cambia entre versiones: lo que importa se escribe explícito. Ojo: aun apagado en el servidor, una petición lo puede volver a pedir con <code>chat_template_kwargs</code>; el gateway (estación 4) es donde se impide.",
          "razonamiento", "plantilla"),
    falla("plantilla-ajena", "El modelo contesta cosas sin relación con la pregunta", "infra",
          "Siguiendo un tutorial de Llama, alguien agregó una opción a servir.sh «para que el chat salga mejor» y reinició el servidor.",
          "<code>verificar.py plantilla</code> falla: la pregunta de prueba entró como 3 tokens y con la plantilla de Qwen3 son 33.",
          ["El modelo se dañó.", "El servidor arma los mensajes con la plantilla de otro modelo.", "El tokenizer cambió."],
          cmd("python3 pipeline/preguntar.py --max 60 \"¿Qué es una pena convencional en un contrato?\"", F("pla preguntar"), "3 tokens de entrada: el modelo no leyó la pregunta. Escribe sobre cualquier cosa hasta cortarse."),
          "Quitar <code>--chat-template llama3</code> de <code>servir.sh</code> " + ARR + " La plantilla de chat es parte del modelo y viene en su GGUF: llama-server la usa por omisión. <code>curl /props</code> dice cuál cargó (con la falla decía solo «llama3»).",
          "plantilla", "plantilla"),
]

e["listo"] = [
    "El modelo viene de un commit fijo, con su sha256, y el servidor dice qué archivo y qué alias cargó.",
    "El servidor escucha solo en 127.0.0.1, pide clave (y se prueba que sin ella contesta 401), con el contexto que pide el prompt del despacho y el razonamiento apagado.",
    "La pregunta de prueba entra con la plantilla de chat del modelo: 33 tokens, ni uno más.",
    "Un cliente con la biblioteca estándar: modelos, tokens, chat, streaming con su TTFT, y errores con nombre (sin servidor, sin permiso, contexto excedido).",
    "Respuestas en JSON con un schema, con citas que solo pueden ser ids de los fragmentos.",
    "Las cuentas de tu Mac medidas: tokens por segundo al escribir, segundos de prefill de un prompt del despacho y el KV cache.",
]

e["repaso"] = {
    "memo": "<b>Un modelo open weight en un servidor de inferencia (llama-server) que habla la API compatible con OpenAI: solo en 127.0.0.1, con clave, con el contexto que pide el prompt, la plantilla de chat del modelo y el razonamiento apagado; y un cliente con streaming, TTFT, tokens, errores con nombre y JSON con schema.</b> En el dojo: Qwen3-0.6B en Q8_0 (0.80 GB), ≈ " + TOKS + " tokens/s al escribir, " + PREF_S + " s de prefill de 6,013 tokens y 112 KiB de KV cache por token.",
    "trampa": "Lo que falla sin dar error. Sin clave, todo sigue funcionando; con la plantilla de otro modelo, la pregunta entra como 3 tokens y el modelo contesta cualquier cosa; con 4 a la vez, el contexto se reparte y solo truenan los prompts largos; sin --reasoning, vuelve a razonar. Lo que los atrapa es probar el lado de «sin permiso», contar los tokens de una pregunta conocida y comparar lo que cargó el servidor con lo que dice la configuración.",
    "entrevista": [
        {"q": "¿Por qué un servidor de inferencia y no cargar el modelo en tu aplicación?", "a": "Porque el modelo se carga una vez y todos le hablan por HTTP: el asistente, el RAG o un script. La aplicación no carga gigas de pesos ni compite por la GPU, y el servidor se puede cambiar (llama-server en una Mac, vLLM en una GPU) sin tocar el cliente, porque los dos hablan la API compatible con OpenAI."},
        {"q": "Levantaste un modelo local. ¿Qué revisas antes de dárselo a alguien?", "a": "Dónde escucha (127.0.0.1 o detrás de un gateway, nunca 0.0.0.0 a pelo), que pida clave y que sin ella conteste 401, que el contexto alcance para el prompt real más la respuesta, que la plantilla de chat sea la del modelo (cuento los tokens de una pregunta conocida: en mi caso, 33), y el razonamiento como lo quiero. Y comparo lo que dice /props con mi configuración."},
        {"q": "¿Qué pasa si subes las peticiones a la vez en llama-server?", "a": "El contexto se reparte: con -c 8192 y -np 4, cada una tiene 2,048. Las preguntas cortas siguen bien y las de 6,000 tokens truenan con un 400. Para 4 de 8,192 necesito -c 32768, y eso es 4 veces el KV cache: con el 32B del despacho, ≈ 8.6 GB en vez de 2.15. vLLM lo maneja distinto, con bloques de memoria que se asignan conforme se usan."},
        {"q": "¿Qué decide qué tan rápido escribe un modelo en una máquina?", "a": "Al escribir, cada token lee todos los pesos de memoria, así que el techo es el ancho de banda entre los bytes de pesos: en mi Mac, 120 GB/s entre 0.8 GB, unos 150 tokens/s, y medí " + TOKS + ". Leer el prompt es otra cosa: se procesan muchos tokens juntos y manda la capacidad de cálculo. Por eso reporto los dos por separado: el TTFT y los tokens por segundo."},
        {"q": "¿Cómo garantizas que el modelo cite solo documentos que existen?", "a": "Le pido la respuesta con un JSON schema donde las citas son un enum de los ids de los fragmentos que le di. El servidor lo convierte en una gramática y el modelo no puede escribir otro id. Eso garantiza la forma, no el fondo: en mi prueba citó el fragmento correcto y dos de más. Validar que cada cita diga lo que la respuesta dice es otra capa (evals)."},
        {"q": "Tu cliente recibe un error. ¿Qué hace?", "a": "Depende de cuál. Sin conexión: el servidor no está o está saturado, reintento con espera o aviso. 401: la clave está mal, no reintento. Contexto excedido: el error trae cuántos tokens traía el prompt y cuántos caben, así que mando menos fragmentos. Por eso cada uno es una excepción con nombre, no un error genérico."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/ia-privada-modelo-local/CLAUDE.md",
    "guiado": "content/estaciones/ia-privada-modelo-local/prompts/guiado.md",
    "solo": "content/estaciones/ia-privada-modelo-local/prompts/solo.md",
    "romper_ayuda": "content/estaciones/ia-privada-modelo-local/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/ia-privada-modelo-local/prompts/romper-solo.md",
}

(APP / "content/estaciones/ia-privada-modelo-local.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
