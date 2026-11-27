"""Arma content/estaciones/ia-privada-vllm.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/e3 && bash probar-fallas.sh /ruta/e3     # deja /ruta/e3.log y /ruta/e3-fallas.log
    python3 contenido.py /ruta/e3                                  # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs, y el código de cada paso
sale de los archivos de esta solución. Las salidas de la Mac son del vLLM del dojo (simulado) y la página lo dice; las
del paso 6 corren contra la GPU rentada y van en null hasta la primera sesión (la página dice que faltan).
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


def P(nombre: str) -> str:
    """El comando tal como lo corre probar.sh en la sección «nombre» (para no escribirlo dos veces)."""
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^cp |^#|\Z)', PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"no está el paso «{nombre}» en probar.sh")
    c = m.group(1).strip()
    if c.startswith('python3 -c "'):
        c = c.replace('\\"', '"')
    if c.startswith("sh -c '") and c.endswith("'"):
        c = c[7:-1]
    return c


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def gpu(code_, nota=""):
    """Un comando que corre contra la GPU rentada: su salida falta hasta la primera sesión (no se inventa)."""
    return {"code": code_, "nota": nota, "donde": "gpu", "salida": None}


def archivo(rel: str, lang: str, nota: str = "") -> dict:
    return {"lang": lang, "path": rel, "code": code(rel), "nota": nota}


def num(patron: str, texto: str, grupo: int = 1) -> str:
    m = re.search(patron, texto)
    if not m:
        sys.exit(f"no encuentro «{patron}» en:\n{texto[:400]}")
    return m.group(grupo)


V = "python3 verificar.py"
SIM = "Salida del vLLM del dojo (simulado): los tiempos son la cuenta de servilleta de una L40S, no una medición."
# los números del dojo (todos del simulador) que se citan en el texto
KV_TOK = num(r"GPU KV cache size: ([\d,]+) tokens", L("p2 log"))
KV_X = num(r"per request: ([\d.]+)x", L("p2 log"))
HUMO_TTFT = num(r"TTFT ([\d,]+) ms", L("p4 humo"))
HUMO_TOK = num(r"la primera: ([\d,]+) tokens", L("p4 humo"))
CER_TPOT = num(r"TPOT p50 (\d+) ms", L("p4 verificar"))
REP = L("p5 reporte")
AB_TTFT95 = num(r"abierta:.*?\n.*?\n  TTFT\s+[\d,.]+\s+([\d,.]+)", REP)
CE_TPOT95 = num(r"cerrada:.*?\n.*?\n  TTFT.*?\n  TPOT\s+[\d,.]+\s+([\d,.]+)", REP)
AB_DUR = num(r"abierta: \d+ peticiones, \d+ errores, (\d+) s", REP)
GOOD = num(r"abierta:(?:.*\n){5}\s+goodput ([\d.]+)/s", REP)
PLAN = L("p6 plan")
PLAN_MIN = num(r"([\d.]+) min  estimado", PLAN)
PLAN_USD = num(r"estimado · US\$([\d.]+)", PLAN)
PLAN_MXN = num(r"estimado · US\$[\d.]+ ≈ MXN (\d+)", PLAN)
TOPE_USD = num(r"lo más que cuesta: US\$([\d.]+)", PLAN)
TOPE_MXN = num(r"lo más que cuesta: US\$[\d.]+ ≈ MXN (\d+)", PLAN)

e = {
    "id": "vllm", "patron": "llm", "rama": "ia-privada", "etapa": "api", "num": 3,
    "titulo": "Servir con vLLM bajo carga", "nav": "vLLM bajo carga",
    "pregunta": "¿Cómo sirves un modelo de 32B en una GPU para varias personas a la vez, y cómo sabes, con una prueba de carga honesta, si cumple la promesa de velocidad antes de firmarla?",
    "version": "2026-11-27",
}

e["mapa"] = {
    "resumen": "En la estación 1 el modelo atendía a una persona. El despacho necesita atender a <b>8 conversaciones a la vez</b> con Qwen3 32B, y antes de firmar una promesa (que la primera palabra salga en ≤ 2 s y que cada palabra siguiente tarde ≤ 50 ms) tiene que <b>medirla</b>. Para eso se usa <b>vLLM</b>, el servidor de inferencia hecho para GPUs NVIDIA y muchas conversaciones a la vez: reparte la memoria de la GPU en bloques (<b>PagedAttention</b>), mete conversaciones nuevas en cada paso sin esperar a que terminen las otras (<b>batching continuo</b>) y lee los prompts largos por pedazos. Aquí lo sirves con su clave y sus límites, escribes un <b>generador de carga</b> (cerrada, con 8 a la vez; y abierta, con llegadas al azar a la tasa que de verdad le toca a una copia) y un <b>reporte</b> que dice el p95 con su intervalo, el <b>goodput</b> y si pasa o no el criterio. <b>Dónde corre:</b> los pasos 0 a 5 y las fallas, en tu Mac con el <b>vLLM del dojo</b>, un simulador que habla la misma API y hace en tiempo real la cuenta de servilleta de una L40S (gratis, sin GPU, pero sin medir nada). El paso 6 es la sesión en una L40S rentada en RunPod (≈ " + f"{float(PLAN_MIN):.0f}" + " min, ≈ US$" + PLAN_USD + "), donde los mismos archivos corren contra el vLLM de verdad.",
    "entra": [
        "el modelo del despacho: Qwen/Qwen3-32B-AWQ (INT4 de AWQ, 19.3 GB, Apache 2.0); en la Mac solo sus números (capas, cabezas, bytes), en el pod se baja de Hugging Face",
        "vLLM 0.34.0: en la Mac, el vLLM del dojo (simulado); en el pod, la imagen <code>vllm/vllm-openai:v0.34.0</code>",
        "la ficha del despacho: 8 conversaciones de diseño, prompts de ≈ 6,000 tokens con las mismas instrucciones al inicio, 0.21 preguntas por segundo en la hora pico entre 3 copias, TTFT p95 ≤ 2 s y TPOT p95 ≤ 50 ms",
        "una cuenta de RunPod con saldo prepagado, solo para el paso 6 (la abres tú; el kit nunca pide datos de pago)",
    ],
    "sale": [
        "<code>servidor.env</code> y <code>servir.sh</code>: <code>vllm serve</code> con clave, 8,192 tokens, 8 a la vez, el parser de razonamiento de Qwen3 y la plantilla sin razonar; el mismo archivo arma el pod",
        "<code>pipeline/carga.py</code>: el generador de carga (cerrada y abierta con Poisson, sin tope en el cliente), con TTFT, TPOT y huecos entre tokens por petición, y lo que dijo <code>/metrics</code> durante la prueba",
        "<code>pipeline/reporte.py</code>: percentiles con su intervalo de 95 %, goodput y el veredicto contra el criterio del despacho",
        "<code>mundo/gpu.py</code>: el plan (minutos y costo antes de rentar), la receta del pod, un vigía que lo termina al tope y el apagado",
    ],
    "escala": [
        {"que": "El motor", "ref": "3 copias de vLLM 0.34.0, una por L40S, detrás de LiteLLM", "taller": "1 copia: el vLLM del dojo en tu Mac (simulado) y, en el paso 6, una L40S rentada"},
        {"que": "Las llegadas", "ref": "0.21 preguntas por segundo en la hora pico", "taller": "0.07 por segundo: lo que le toca a una de las 3 copias"},
        {"que": "La prueba", "ref": "≥ 1,000 peticiones por prueba abierta (≈ 79 min), 3 repeticiones, y una jornada de resistencia", "taller": "40 en la abierta (≈ 10 min) y 24 en la cerrada"},
        {"que": "La GPU", "ref": "3 L40S propias (o 4 L40S rentadas en AWS para la prueba: US$10.49/h)", "taller": "1 L40S de RunPod a US$1.09/h, con un tope de 90 min"},
        {"que": "Qué tanto se sabe del p95", "ref": "con 1,000: entre el p93.6 y el p96.4", "taller": "con 40: entre la 35.ª y la más lenta, sin techo"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir nada, las cuentas de servilleta de un modelo grande bajo carga: cuántas conversaciones caben en la memoria, a qué velocidad escribe cada una cuando son 8, cuántas llegan a la vez, cuántas peticiones hacen falta para saber el p95 y cuánto cuesta medirlo. Cada una en el despacho (con su ficha) y en el dojo. Son las mismas cuentas que hace el vLLM del dojo por dentro, así que en la Mac lo que sale es la cuenta misma; la GPU rentada dice si la cuenta se parece a la realidad.",
    "cuentas": [
        {"id": "memoria", "pregunta": "¿Cuántas conversaciones caben en el KV cache de una L40S?",
         "formula": "KV cache = memoria que ve el programa − pesos − lo del programa (≈ 2 GiB); tokens = KV cache ÷ (2 × capas × cabezas K/V × dimensión × 2 bytes), en bloques de 16",
         "ref": {"cuenta": "Qwen3 32B: 256 KiB por token; la ficha: 8 conversaciones de 8,192 piden 17.18 GB de KV cache, y con --gpu-memory-utilization 0.90 caben 10", "valor": "≈ 25 GiB libres sin ese flag: ≈ 102 mil tokens, ≈ 12.5 conversaciones al tope o ≈ 15.7 de 6,500"},
         "taller": {"cuenta": "la misma L40S, con lo que dice su log al arrancar", "valor": f"{KV_TOK} tokens: {KV_X}× al tope de 8,192 (simulado; en el pod, el número real)"},
         "decide": "La memoria dice cuántas caben, no cuántas se atienden bien: caben ≈ 12 y la ficha diseña para 8. Con menos memoria (otro modelo en la misma tarjeta, un --gpu-memory-utilization bajo), el motor saca conversaciones a la mitad (preemption).",
         "conceptos": ["paged-attention", "kv-extensible"],
         "comprueba": cmd(P("pc memoria"), L("pc memoria"), "Los números salen de <code>mundo/modelos.json</code> y <code>mundo/gpus.json</code>. La memoria que ve el programa (44.99 GiB) es menos que los 48 GB de la caja: GB contra GiB y lo que reserva el driver.")},
        {"id": "decode", "pregunta": "¿A cuántos tokens por segundo escribe cada conversación cuando son 8?",
         "formula": "cada paso escribe un token para cada conversación y lee los pesos más el KV cache de todas: tiempo por paso ≈ (pesos + n × tokens × KV por token) ÷ (0.7 × ancho de banda)",
         "ref": {"cuenta": "(19.32 GB + 8 × 6,500 × 256 KiB) ÷ (0.7 × 864 GB/s)", "valor": "≈ 54 ms por token: ≈ 18 tokens/s cada una, ya debajo de los 20 de la ficha sin contar los prompts"},
         "taller": {"cuenta": "la cerrada de 8 a la vez, con prompts de ≈ 6,000 tokens entrando todo el tiempo", "valor": f"TPOT p50 ≈ {CER_TPOT} ms (simulado): cada paso que lee un pedazo de prompt frena a las 8"},
         "decide": "Con 8 a la vez, el ancho de banda ya no alcanza para 20 tokens/s, y cada prompt que entra mete un paso de ≈ 0.74 s. Por eso la ficha dice «2 por L40S a ≥ 20 tokens/s» y diseña 3 copias: el tope de 8 es de memoria, no de velocidad.",
         "conceptos": ["continuous-batching", "chunked-prefill", "tpot"],
         "comprueba": cmd(P("pc decode"), L("pc decode"))},
        {"id": "prefill", "pregunta": "¿Cuánto tarda la primera palabra de una pregunta sola?",
         "formula": "prefill ≈ 2 × parámetros × tokens del prompt ÷ (0.5 × FLOPs pico); los tokens que ya están en el prefix cache no se calculan",
         "ref": {"cuenta": "2 × 32.76 mil millones × 6,000 ÷ (0.5 × 362 TFLOPS)", "valor": "≈ 2.17 s: con la L40S, el TTFT ya pasa los 2 s con una sola pregunta (la ficha lo dice)"},
         "taller": {"cuenta": f"la pregunta de humo, de {HUMO_TOK} tokens", "valor": f"TTFT {HUMO_TTFT} ms (simulado)"},
         "decide": "El TTFT de una pregunta del despacho lo pone la GPU y el largo del prompt, no la fila. Si sola ya roza 2 s, con fila no cumple: o menos tokens (menos fragmentos), o una GPU con más FLOPs (la ficha compara la RTX PRO 6000).",
         "conceptos": ["ttft", "prefix-caching"],
         "confirma": "Paso 4 (<code>python3 pipeline/carga.py humo</code>) y, con la GPU de verdad, el paso 6."},
        {"id": "little", "pregunta": "¿Cuántas conversaciones llegan a la vez a una copia?",
         "formula": "ley de Little: a la vez en promedio = llegadas por segundo × segundos que dura cada una; con llegadas al azar (Poisson) se puede calcular qué tan seguido hay 8 o más",
         "ref": {"cuenta": "0.21 por segundo × 27 s que dura una respuesta (la ficha)", "valor": "≈ 5.7 a la vez entre las 3 copias; 8 o más el ≈ 18 % del tiempo de la hora pico"},
         "taller": {"cuenta": "0.07 por segundo (una de las 3 copias) × 27 s", "valor": "≈ 1.9 a la vez; 8 o más casi nunca"},
         "decide": "Una copia recibe pocas a la vez: su TTFT lo marca el prefill, no la fila. La cerrada de 8 mide otra cosa (cómo escriben 8 juntas). Las dos pruebas se hacen porque contestan preguntas distintas.",
         "conceptos": ["carga"],
         "comprueba": cmd(P("pc little"), L("pc little"))},
        {"id": "intervalo", "pregunta": "¿Cuántas peticiones hacen falta para saber el p95?",
         "formula": "el p95 verdadero cae, con 95 % de confianza, entre las posiciones n·0.95 ∓ 1.96·√(n·0.95·0.05) de las n medidas ordenadas",
         "ref": {"cuenta": "1,000 peticiones por prueba (el plan de la prueba de carga)", "valor": "entre el p93.6 y el p96.4: se puede firmar"},
         "taller": {"cuenta": "40 peticiones en la abierta", "valor": "entre la 35.ª y la más lenta: sin techo. Sirve para ver la forma, no para firmar"},
         "decide": "Un p95 sin su intervalo no dice nada. Con 40 se sabe si algo anda muy mal (si hasta la 35.ª pasa el objetivo, no cumple); para prometer que cumple hacen falta cientos.",
         "conceptos": ["percentil"],
         "comprueba": cmd(P("pc intervalo"), L("pc intervalo"))},
        {"id": "costo", "pregunta": "¿Cuánto cuesta medirlo en una GPU de verdad?",
         "formula": "costo = minutos ÷ 60 × (precio por hora de la GPU + disco); el tope es lo que tarde el vigía en apagarla",
         "ref": {"cuenta": "la prueba de la promesa en 4 L40S rentadas (g6e.12xlarge de AWS, US$10.49/h) por 48 h", "valor": "≈ US$500"},
         "taller": {"cuenta": f"1 L40S en RunPod a US$1.09/h, ≈ {float(PLAN_MIN):.0f} min de sesión y un tope de 90", "valor": f"≈ US${PLAN_USD} (≈ MXN {PLAN_MXN}); con el tope, a lo más US${TOPE_USD} (≈ MXN {TOPE_MXN})"},
         "decide": "Todo lo que se puede escribir y probar sin GPU se hace en la Mac. A la GPU se llega con el código listo, a medir: cada minuto esperando es dinero. Y siempre con un tope que la apague.",
         "conceptos": ["gpu-rentada"],
         "confirma": "Paso 6 (<code>python3 mundo/gpu.py plan</code>, con tu <code>gpu.env</code>)."},
    ],
}

C = []


def con(id_, termino, en, def_, analogia, importa, trampa):
    assert len(def_) <= 220, (id_, len(def_))
    C.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


con("simulador", "El vLLM del dojo (un simulador)", "simulator, digital twin",
    "Un programa que contesta como vLLM (las mismas rutas, errores y métricas) y tarda lo que diría la cuenta de servilleta de una L40S. No usa GPU y no mide nada.",
    "Como un simulador de vuelo: practicas el despegue y las fallas sin gastar combustible, pero el viento real no está ahí.",
    "Deja escribir y probar todo el código (el generador, el reporte, las fallas) gratis en la Mac, y llegar a la GPU rentada solo a medir.",
    "Tomar sus números como medidos. Hacen la cuenta perfecta: la GPU real tiene cuellos que la cuenta no ve (kernels, la red del proxy, el calentamiento). Cada número del simulador se dice como «simulado».")
con("vllm", "vLLM", "vLLM inference engine",
    "Un servidor de inferencia para GPUs, hecho para atender muchas conversaciones a la vez. Habla la API compatible con OpenAI; cada copia anuncia el modelo con el nombre de --served-model-name.",
    "Como la cocina de un restaurante grande: no cocina un platillo a la vez, va metiendo órdenes nuevas a la estufa mientras salen las otras.",
    "Es lo que el despacho corre en cada L40S. Lo que cambia contra llama-server no es la API, es cuántas atiende a la vez y cómo reparte la memoria.",
    "Cambiar el nombre servido en un lado y no en el otro: el servidor está sano y cada pregunta recibe «The model … does not exist».")
con("paged-attention", "PagedAttention y bloques del KV cache", "PagedAttention, KV cache blocks",
    "vLLM guarda el KV cache en bloques chicos (16 tokens) que da conforme crece cada conversación, en vez de apartar el contexto máximo para cada una.",
    "Como un estacionamiento por lugares: a cada coche le das un cajón al llegar, no le apartas un piso entero por si trae remolque.",
    "Por eso en vLLM el contexto no se reparte como en llama-server: caben más conversaciones cortas y una larga no le quita lugar a las demás hasta que de verdad lo usa.",
    "Creer que el KV cache se aparta al arrancar por conversación. Se aparta la memoria total; los bloques se reparten en marcha, y se pueden acabar a la mitad.")
con("kv-extensible", "La memoria del KV cache", "--gpu-memory-utilization, extensible KV cache",
    "Cuánta memoria le toca al KV cache. vLLM 0.34 la mide al arrancar con lo que queda libre; --gpu-memory-utilization fija un tope (fracción de la GPU) y achica el KV cache.",
    "Como repartir una bodega: lo que no usan los pesos queda para las conversaciones, a menos que alguien pinte una raya «hasta aquí» en la mitad.",
    "El log de arranque dice cuántos tokens caben (GPU KV cache size) y cuántas conversaciones al tope (Maximum concurrency). Es el primer número que se revisa.",
    "Copiar un --gpu-memory-utilization de un tutorial viejo: arranca bien y el KV cache queda chico. Nada truena hasta que llegan 8 a la vez.")
con("max-num-seqs", "Lugares a la vez", "--max-num-seqs",
    "Cuántas conversaciones corre el motor juntas en cada paso. Las que llegan de más esperan en fila (vllm:num_requests_waiting). El despacho usa 8, su número de diseño.",
    "Como las sillas de un consultorio: si hay 8, el noveno espera en la sala aunque el doctor tenga tiempo.",
    "Pone la orilla entre memoria y fila: con pocos lugares la GPU queda ociosa y el TTFT se vuelve espera; con muchos, cada una escribe más lento.",
    "Bajarlo «para que cada una escriba más rápido»: escriben más rápido las que entran, y las demás esperan medio minuto.")
con("continuous-batching", "Batching continuo", "continuous batching",
    "En cada paso, el motor escribe un token para cada conversación que ya está escribiendo y mete conversaciones nuevas en cuanto hay lugar, sin esperar a que termine la tanda.",
    "Como un elevador que deja y recoge gente en cada piso, en vez de esperar a que se vacíe para subir a los siguientes.",
    "Es por qué 8 conversaciones no tardan 8 veces más: leer los pesos una vez sirve para las 8.",
    "Pensar que cada conversación va «a su velocidad». Todas comparten el paso: si el paso se alarga (un prompt grande entrando), se frenan todas.")
con("chunked-prefill", "Prefill por pedazos", "chunked prefill, --max-num-batched-tokens",
    "vLLM lee los prompts largos en pedazos de hasta --max-num-batched-tokens (2,048 en una L40S) por paso, junto con los tokens de las que ya escriben.",
    "Como un cajero que entre cliente y cliente de la fila rápida atiende un pedazo del trámite largo, en vez de cerrar la ventanilla una hora.",
    "Un prompt de 6,000 tokens tarda ≈ 3 pasos de ≈ 0.74 s. En esos pasos, cada conversación que escribe espera: es el salto en el hueco entre tokens.",
    "Ver un TPOT promedio alto y culpar al ancho de banda. Muchas veces es el prefill de las que van entrando: se ve en los huecos grandes de itl_s.")
con("preemption", "Preemption", "preemption (recompute)",
    "Cuando se acaban los bloques del KV cache, vLLM saca a la última conversación que entró, libera su memoria y la vuelve a leer completa después.",
    "Como un restaurante lleno que levanta a la última mesa para sentar a otra, y luego la vuelve a sentar desde la entrada.",
    "Nada da error: la respuesta solo tarda más y gasta GPU dos veces. Se ve en vllm:num_preemptions_total y en un KV cache cerca del 100 %.",
    "No revisar /metrics: el cliente ve una respuesta lenta y nadie sabe que el motor tiró trabajo.")
con("prefix-caching", "Prefix caching", "automatic prefix caching",
    "vLLM guarda los bloques de prompt que ya leyó. Si otra pregunta empieza igual (las mismas instrucciones), esos bloques no se vuelven a calcular. Viene prendido.",
    "Como el mesero que ya trae el pan a la mesa porque todos lo piden: solo prepara lo que cambia.",
    "Las ≈ 400 tokens de instrucciones del despacho se leen una vez: el TTFT baja lo que pesan en el prompt (≈ 7 %).",
    "Medir con la misma pregunta una y otra vez: el prefix cache la tiene completa y el TTFT sale bajísimo. El dataset de la prueba cambia los fragmentos en cada pregunta.")
con("ttft", "Tiempo al primer token", "time to first token, TTFT",
    "Lo que tarda en llegar el primer pedazo de texto desde que se mandó la pregunta: la fila, más leer el prompt (prefill), más la red.",
    "Como el tiempo entre pedir en la ventanilla y que te den el primer taco: espera en la fila más lo que tarda en prepararse.",
    "Es lo que siente el abogado: si la primera palabra tarda, «el sistema está lento», aunque luego escriba rápido. El despacho promete ≤ 2 s en el p95.",
    "Medirlo en el servidor y prometerlo al cliente: el cliente suma la red y el gateway. Se mide del lado del cliente (y se compara con vllm:time_to_first_token_seconds).")
con("tpot", "TPOT y huecos entre tokens", "time per output token, inter-token latency",
    "TPOT: (tiempo total − TTFT) ÷ (tokens − 1), el promedio de una respuesta. ITL: cada hueco entre dos pedazos. El despacho pide TPOT p95 ≤ 50 ms (≥ 20 tokens/s).",
    "Como la velocidad de alguien que dicta: el TPOT es su ritmo promedio; los huecos son las pausas, y una pausa larga se nota aunque el ritmo sea bueno.",
    "Dice si el texto sale más rápido de lo que se lee. Se mide con 8 a la vez, que es cuando se comparte la GPU.",
    "Reportar solo el promedio: un TPOT de 50 ms puede esconder pausas de 0.7 s cada vez que entra un prompt.")
con("carga", "Carga cerrada y carga abierta", "closed-loop vs open-loop load, Poisson arrivals",
    "Cerrada: N usuarios, cada uno pregunta de nuevo al recibir respuesta. Abierta: las preguntas llegan a su hora (al azar, Poisson), conteste o no el servidor.",
    "Cerrada es una mesa de 8 que pide otro platillo al terminar el anterior; abierta es la calle: la gente entra al restaurante cuando quiere, haya mesa o no.",
    "La cerrada nunca satura (si el servidor se frena, llegan menos). La abierta sí, y es la del mundo real: la hora pico no espera a que el servidor acabe.",
    "Usar una cerrada (o una ráfaga a tasa infinita) para prometer un TTFT de la hora pico. La promesa se mide a la tasa de diseño, y se dice cuál fue.")
con("percentil", "Percentiles y su intervalo", "p50, p95, p99, confidence interval",
    "El p95 es el tiempo que no pasa el 95 % de las peticiones. Medido con n peticiones, el verdadero cae en un rango de posiciones: n·0.95 ∓ 1.96·√(n·0.95·0.05).",
    "Como una encuesta: con 40 personas sabes la tendencia; para afirmar el 95 % necesitas cientos, y el margen de error se dice junto al número.",
    "El SLA se firma en p95, no en promedio: el promedio esconde a los que esperan. Y un p95 sin intervalo no se puede comparar con otro.",
    "Firmar un p95 medido con 40 peticiones: con 40, el p95 es prácticamente la más lenta y no tiene techo.")
con("goodput", "Goodput", "goodput",
    "Las peticiones por segundo que cumplen todo el criterio a la vez (TTFT y TPOT), no las que solo contestaron. vllm bench serve lo da con --goodput ttft:2000 tpot:50.",
    "Como contar las pizzas que llegaron calientes y a tiempo, no las que salieron de la cocina.",
    "Un servidor puede contestar todo (throughput alto) y que casi nada cumpla la promesa. La ficha estima ≈ 0.06/s de goodput con 3 L40S: ≈ 29 % de lo pedido.",
    "Reportar throughput como si fuera capacidad útil.")
con("metrics", "/metrics de vLLM", "Prometheus metrics",
    "vLLM publica en /metrics, en el formato de Prometheus, lo que pasa adentro: corriendo, en fila, uso del KV cache, preemptions e histogramas de TTFT y huecos.",
    "Como el tablero de un coche: el pasajero siente que va lento; el tablero dice si es el motor, la gasolina o el freno de mano.",
    "El cliente mide lo que vive el usuario; /metrics explica por qué. Una prueba honesta guarda los dos.",
    "Dejar /metrics abierto a internet: no pide clave. En el pod el proxy es público, y en el despacho va solo a la red de gestión.")
con("gpu-rentada", "GPU rentada por segundo", "on-demand GPU pod, billing per second",
    "Una máquina con GPU que se renta por segundo (RunPod: L40S a US$1.09/h) de saldo prepagado. Se lanza con una imagen (vllm/vllm-openai) y se termina para dejar de pagar.",
    "Como rentar un auto por minuto: pagas mientras está prendido, y el tope real es lo que cargaste a la tarjeta de prepago.",
    "Deja medir en la GPU del despacho sin comprarla: una sesión de práctica cuesta menos que un café. Con un vigía que la termina al tope, el olvido no sale caro.",
    "Dejarla prendida «un ratito» o solo detenerla: detenida, el disco sigue cobrando. Se termina, y se comprueba que ya no existe.")
con("api-key", "Clave de la API", "API key, bearer token",
    "Un texto que vLLM pide en cada petición a /v1 («Authorization: Bearer …»); sin la clave correcta contesta 401. Se pasa con --api-key o la variable VLLM_API_KEY.",
    "Como el gafete de la oficina: el guardia no pregunta quién eres, solo si traes uno válido.",
    "En el pod el puerto queda en una URL pública de internet: sin clave, cualquiera que la encuentre usa tu GPU y tu saldo.",
    "Probar solo que «con la clave funciona»: si nadie prueba sin clave, nadie se entera el día que se quita. /health y /metrics quedan abiertos.")
con("razonamiento", "Razonamiento de Qwen3", "thinking mode, --reasoning-parser",
    "Qwen3 razona antes de contestar si la plantilla no lo apaga. --default-chat-template-kwargs '{\"enable_thinking\": false}' lo apaga; --reasoning-parser qwen3 lo separa en otro campo.",
    "Como alguien que piensa en voz alta antes de cada respuesta: útil a veces, pero el abogado quería la respuesta, no el borrador.",
    "Cada token de razonamiento es GPU y tiempo: el tope de 500 tokens se va en pensar y la respuesta útil llega tarde.",
    "Quitar «el JSON raro» del comando: es lo que lo apaga. Lo que importa se escribe explícito, aunque se vea raro.")
e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae todo para escribir y probar la estación en tu Mac, gratis, y para llegar a la GPU rentada con el código listo. El centro es el <b>vLLM del dojo</b> (<code>mundo/vllm_dojo.py</code>): cuando no hay vLLM instalado, <code>vllm serve</code> corre este simulador, que habla la API de vLLM 0.34.0 (rutas, errores, streaming y las métricas <code>vllm:…</code>) y hace en tiempo real la cuenta de servilleta de una L40S con Qwen3 32B en AWQ: memoria y bloques del KV cache, prefill por FLOPs, escritura por ancho de banda, batching continuo con prefill por pedazos, fila, prefix caching y preemption. <b>Sus números son la cuenta, no una medición</b>: toda salida de la Mac en esta página es del simulador. Además: las preguntas del despacho (≈ 6,000 tokens, ficticias, con las mismas instrucciones al inicio), lo que arranca y para tu servidor, y <code>mundo/gpu.py</code> para la sesión rentada. Todo usa solo la biblioteca estándar de Python.",
    "trae": [
        {"que": "mundo/vllm_dojo.py y mundo/bin/vllm", "detalle": "El vLLM del dojo. <code>mundo/servidor.py</code> pone <code>mundo/bin</code> en el PATH cuando no hay vLLM, así que tu <code>servir.sh</code> dice <code>vllm serve</code> igual que en el pod. Su primera línea de log dice SIMULADO."},
        {"que": "mundo/servidor.py", "detalle": "<code>arrancar</code> corre tu <code>servir.sh</code> en segundo plano y espera a que <code>/health</code> conteste (en el pod de verdad, la primera vez tarda minutos); <code>parar</code>, <code>estado</code> y <code>log</code>, con el log en <code>.taller/servidor.log</code>."},
        {"que": "mundo/dataset.py", "detalle": "<code>preguntas(n, semilla)</code>: las preguntas del despacho, deterministas. 5 fragmentos de contratos ficticios distintos en cada una y las mismas ≈ 400 tokens de instrucciones al inicio; de ≈ 4,200 a ≈ 7,800 tokens."},
        {"que": "mundo/gpu.py y mundo/proveedores.json", "detalle": "<code>plan</code> (minutos y costo antes de rentar), <code>receta</code> (los campos del pod, sacados de tu <code>servir.sh</code>), <code>vigilar</code> (un proceso en tu Mac que termina el pod al tope, por la API v2 de RunPod), <code>estado</code> y <code>apagar</code>. La comparación de proveedores, con sus precios del 2026-11-27."},
        {"que": "mundo/modelos.json y mundo/gpus.json", "detalle": "Los números del modelo (capas, cabezas K/V, bytes de pesos) y de la L40S y la L4 (memoria, ancho de banda, FLOPs) con los que el simulador hace sus cuentas."},
        {"que": "verificar.py y romper.py", "detalle": "Los 13 checks (de <code>mundo</code> a <code>gpu</code>) contra el servidor de <code>LLM_URL</code>, y las 6 fallas: el tope de 2, la memoria recortada, sin clave, el razonamiento prendido, el nombre servido cambiado y la prueba a tasa infinita."},
    ],
    "tu_pipeline": [
        {"archivo": "servidor.env y servir.sh", "hace": "Pasos 1 y 2: qué sirve vLLM y cómo; el mismo <code>servir.sh</code> corre en la Mac y arma el pod."},
        {"archivo": "carga.env", "hace": "Paso 3: la prueba (tasa, peticiones, a la vez, tope de salida, semilla) y el criterio."},
        {"archivo": "pipeline/carga.py", "hace": "Pasos 4 y 5: una petición medida, la cerrada y la abierta con Poisson."},
        {"archivo": "pipeline/reporte.py", "hace": "Paso 5: percentiles con su intervalo, goodput y el veredicto."},
        {"archivo": "gpu.env", "hace": "Paso 6: proveedor, GPU, precio, disco, tope de minutos y el id del pod."},
    ],
    "requisitos": [
        "Una Mac (o cualquier máquina) con Python 3.10 o más nuevo; se probó con 3.14.3 en un MacBook Air M4. Sin GPU, sin Docker, sin entorno virtual",
        "Para el paso 6: una cuenta de RunPod con ≈ US$10 de saldo prepagado y una llave de API con permiso de escribir pods (la abres tú)",
        "Internet solo para el paso 6: la carga sale de tu Mac hacia el proxy del pod",
    ],
    "sustituciones": [
        {"nube": "vLLM 0.34.0 en una L40S", "local": "el vLLM del dojo en tu Mac (simulado)", "diferencia": "La misma API, los mismos errores y los mismos nombres de métricas, así que tu código no cambia. El simulador hace la cuenta de servilleta perfecta; la GPU real tiene lo que la cuenta no ve (kernels, CUDA graphs, el calentamiento). Por eso el paso 6 mide."},
        {"nube": "3 copias de vLLM detrás de LiteLLM, a 0.21 preguntas por segundo", "local": "1 copia a 0.07 por segundo", "diferencia": "Es lo que le toca a una de las 3 si el gateway reparte parejo. El reparto y la afinidad por conversación son de la estación 4."},
        {"nube": "La prueba de la promesa: ≥ 1,000 peticiones, 3 repeticiones y una jornada", "local": "40 en la abierta y 24 en la cerrada", "diferencia": "Alcanza para ver la forma y para saber si algo no cumple; no para firmar un p95 (no tiene techo)."},
        {"nube": "El generador en otra máquina de la red del despacho", "local": "tu Mac, hacia el proxy del pod por internet", "diferencia": "El TTFT del cliente suma la ida y vuelta a RunPod (≈ decenas de ms desde México). Se compara con vllm:time_to_first_token_seconds, que es del lado del servidor."},
    ],
    "arranque": "unzip ia-privada-vllm.zip && cd ia-privada-vllm\npython3 verificar.py mundo",
    "python": "python3",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El kit descomprimido, Python 3.10+, y el vLLM del dojo listo para contestar como vLLM.",
    conceptos=["simulador", "vllm"],
    explica="No hay nada que instalar en la Mac: el kit usa solo la biblioteca estándar. <code>verificar.py mundo</code> revisa Python, que estén las piezas del mundo y que el dataset salga igual con la misma semilla, y dice qué motor va a usar: sin vLLM instalado, el del dojo. <code>mundo/dataset.py</code> enseña las preguntas de la prueba.",
    codigo=[],
    comandos=[
        cmd("python3 --version", L("p0 version")),
        cmd(f"{V} mundo", L("p0 verificar"), "«SIMULADO» es la palabra clave: lo vas a ver en cada salida de la Mac."),
        cmd(f"{V} config", L("p0 esqueleto"), "Es lo esperado: <code>servidor.env</code> viene vacío. Cada check se pone en verde en su paso."),
        cmd("python3 mundo/dataset.py 40", L("p0 dataset"), "Sin servidor, cuenta con el tokenizer aproximado del kit; con el servidor arriba, con el suyo (<code>/tokenize</code>)."),
    ],
    verifica="<code>verificar.py mundo</code> en verde: Python 3.10+, el mundo completo y el dataset determinista.",
    ojo="El simulador no se baja el modelo ni usa la GPU: no esperes ver 19 GB ni el ventilador. Lo que importa en la Mac es que tu código hable bien con algo que se comporta como vLLM."))

G.append(dict(n=1, id="config", titulo="Decidir cómo se sirve", objetivo="<code>servidor.env</code>: el modelo, el nombre con el que se anuncia, dónde escucha, el contexto, cuántas a la vez, la clave y la URL de tus programas.",
    conceptos=["max-num-seqs", "api-key", "simulador"],
    explica="Cada línea es una decisión de la ficha. <b>MODELO=Qwen/Qwen3-32B-AWQ</b>: el nombre en Hugging Face. <b>NOMBRE=qwen3-32b</b>: el «model» de cada petición. <b>HOST=127.0.0.1</b> y <b>PUERTO=8000</b> (el de vLLM por omisión): en la Mac, nadie más llega. <b>MAX_MODEL_LEN=8192</b>: ≈ 6,000 de prompt + 500 de respuesta. <b>MAX_NUM_SEQS=8</b>: las conversaciones a la vez de diseño. <b>CLAVE</b>: de 12 caracteres o más, porque en el pod el puerto queda en internet. <b>LLM_URL</b>: lo que usan tus programas; en el paso 6 cambia a la URL del pod, y es lo único que cambia.",
    codigo=[archivo("servidor.env", "bash")],
    comandos=[cmd(f"{V} config", L("p1 verificar"), "Pasa la parte de <code>servidor.env</code>; falta <code>servir.sh</code>, que es el paso 2.")],
    verifica="<code>verificar.py config</code> dice lo que falta de <code>servir.sh</code> y nada de <code>servidor.env</code>: el modelo del despacho, 127.0.0.1, 8,192 tokens, 8 a la vez, una clave larga y la URL armada con el mismo puerto.",
    ojo="El 8 de MAX_NUM_SEQS es de memoria (cuántas caben), no de velocidad (a ≥ 20 tokens/s van ≈ 2 por L40S). No lo bajes para «que escriban más rápido»: es la primera falla.",
    en_pagina={"conceptos": ["simulador", "max-num-seqs", "api-key"], "precalculos": []}))

G.append(dict(n=2, id="servir", titulo="Arrancar vLLM", objetivo="<code>servir.sh</code>: <code>vllm serve</code> con todo lo de <code>servidor.env</code>; arrancarlo y leer su log, su API y su <code>/metrics</code>.",
    conceptos=["vllm", "paged-attention", "kv-extensible", "razonamiento", "metrics"],
    explica="<code>servir.sh</code> lee <code>servidor.env</code> y termina en <code>exec vllm serve \"$MODELO\"</code> con: <code>--host</code> y <code>--port</code>; <code>--served-model-name</code>; <code>--max-model-len</code>; <code>--max-num-seqs</code>; <code>--api-key</code>; <code>--reasoning-parser qwen3</code> (separa el razonamiento en su campo, si lo hubiera) y <code>--default-chat-template-kwargs '{\"enable_thinking\": false}'</code> (lo apaga en la plantilla). <b>Sin</b> <code>--gpu-memory-utilization</code>: la 0.34 mide la memoria libre y la da al KV cache. Al arrancar, el log dice lo importante: cuánto pesan los pesos, cuánta memoria quedó para el KV cache, cuántos tokens caben y cuántas conversaciones al tope.",
    codigo=[archivo("servir.sh", "bash", "El mismo archivo corre en la Mac (con el vLLM del dojo) y lo lee <code>mundo/gpu.py receta</code> para armar el pod.")],
    comandos=[
        cmd(f"{V} config", L("p2 verificar config")),
        cmd("python3 mundo/servidor.py arrancar", L("p2 arrancar"), "En la Mac tarda un segundo. En el pod de verdad, la primera vez baja 19 GB y compila: minutos."),
        cmd(P("p2 log"), L("p2 log"), SIM + " Las líneas imitan las de vLLM 0.34.0; la primera y la última del motor son del simulador."),
        cmd("curl -s http://127.0.0.1:8000/health\ncurl -s http://127.0.0.1:8000/v1/models", L("p2 health") + "\n" + L("p2 sin clave"), "<code>/health</code> contesta 200 vacío y abierto; <code>/v1</code> pide clave: el cuerpo del 401 de vLLM es así de corto."),
        cmd('curl -s -H "Authorization: Bearer dojo-vllm-5c1e9a" http://127.0.0.1:8000/v1/models', L("p2 modelos"), "<code>id</code> es el nombre servido; <code>root</code>, el modelo; <code>max_model_len</code>, el contexto que cargó."),
        cmd(P("p2 stream"), L("p2 stream"), "Así habla en streaming: un evento por pedazo, el último con <code>usage</code> (porque se pidió <code>include_usage</code>) y <code>[DONE]</code>. El texto del vLLM del dojo es relleno: aquí importa el tiempo, no lo que dice."),
        cmd(P("p2 metrics"), L("p2 metrics"), "<code>cache_config_info</code> trae cuántos bloques de 16 tokens reservó el motor; los demás son lo que pasa en este momento."),
        cmd(f"{V} servidor clave memoria plantilla", L("p2 verificar")),
    ],
    verifica="<code>verificar.py servidor clave memoria plantilla</code> en verde: el nombre y el contexto de <code>servidor.env</code>, 401 sin clave, lugar en el KV cache para las 8 típicas (≥ 52,000 tokens) y sin razonamiento.",
    ojo="Si el log dice «To serve at least one request with the model's max seq len…», el KV cache no alcanza ni para una conversación al tope: el MAX_MODEL_LEN es demasiado o la memoria quedó corta.",
    en_pagina={"conceptos": ["vllm", "paged-attention", "kv-extensible", "razonamiento", "metrics"], "precalculos": ["memoria"]}))

G.append(dict(n=3, id="prueba", titulo="Diseñar la prueba", objetivo="<code>carga.env</code>: qué se mide, a qué tasa, con cuántas peticiones, con qué tope de salida y contra qué criterio; y comprobar que el motor tiene exactamente 8 lugares.",
    conceptos=["carga", "continuous-batching"],
    explica="Dos pruebas, porque contestan dos preguntas. La <b>abierta</b> (¿qué vive un abogado en la hora pico?): las preguntas llegan al azar a <b>TASA=0.07</b> por segundo, la de una copia (0.21 ÷ 3), <b>PETICIONES=40</b>. La <b>cerrada</b> (¿cómo escriben 8 juntas?): <b>CERRADA_A_LA_VEZ=8</b> y <b>CERRADA_PETICIONES=24</b> (3 vueltas). <b>MAX_TOKENS=500</b>, el tope de salida del plan. <b>SEMILLA=11</b>: las mismas preguntas y las mismas llegadas en la Mac y en la GPU. <b>TTFT_MS=2000</b> y <b>TPOT_MS=50</b>: el criterio. El check <code>lugares</code> manda 10 preguntas cortas a la vez y lee <code>/metrics</code>: tienen que correr 8 y esperar las demás.",
    codigo=[archivo("carga.env", "bash")],
    comandos=[cmd(f"{V} prueba lugares", L("p3 verificar"), SIM)],
    verifica="<code>verificar.py prueba lugares</code> en verde: la tasa de una copia, ≥ 30 peticiones, 8 a la vez, salida ≤ 500 y el criterio del despacho; y en el motor, 8 corriendo y el resto en fila.",
    ojo="«Que mande todo de una vez para que acabe rápido» (TASA=inf) no es una prueba más corta: es otra prueba, una ráfaga. Su TTFT mide la fila de la ráfaga.",
    en_pagina={"conceptos": ["carga", "continuous-batching"], "precalculos": ["little"]}))

G.append(dict(n=4, id="cerrada", titulo="Medir una petición y la cerrada", objetivo="<code>una()</code> mide una petición en streaming desde el cliente; <code>cerrada()</code> corre 8 trabajadores que preguntan de nuevo en cuanto les contestan.",
    conceptos=["ttft", "tpot", "chunked-prefill", "prefix-caching", "preemption"],
    explica="<code>una()</code> manda la pregunta con <code>stream: true</code> y <code>stream_options: {include_usage: true}</code> y lee línea por línea los eventos <code>data:</code>. Toma la hora antes de mandar; el <b>TTFT</b> es la hora del primer pedazo con texto; cada pedazo siguiente deja su hueco en <code>itl_s</code>; los tokens salen del <code>usage</code> del último evento (los del servidor, no los del cliente); y <b>TPOT</b> = (total − TTFT) ÷ (tokens − 1). Un error no truena: queda en la medida, con su código. <code>cerrada()</code> arranca 8 hilos que toman la siguiente pregunta de una fila compartida. Mientras dura, un hilo lee <code>/metrics</code> cada segundo: el pico de corriendo y en fila, el KV cache y las preemptions (lo que el cliente no ve).",
    codigo=[archivo("pipeline/carga.py", "python", "Escribes <code>una()</code> y <code>cerrada()</code> en este paso, y <code>llegadas()</code> y <code>abierta()</code> en el siguiente. <code>Medida</code>, <code>Muestreo</code> y <code>correr()</code> vienen en el esqueleto.")],
    comandos=[
        cmd("python3 pipeline/carga.py humo", L("p4 humo"), SIM),
        cmd(f"{V} humo", L("p4 verificar humo")),
        cmd("python3 pipeline/carga.py cerrada", L("p4 cerrada"), SIM + " La primera pregunta es la misma del humo: su prompt ya estaba en el prefix cache y su TTFT sale bajo."),
        cmd(f"{V} cerrada", L("p4 verificar")),
    ],
    verifica="<code>verificar.py humo cerrada</code> en verde: TTFT entre 0 y el total, TPOT con su fórmula, tokens del <code>usage</code>, y en la cerrada 24 bien con 8 a la vez en el motor.",
    ojo="Medir el TTFT con el primer evento (el que solo trae <code>role</code>) y no con el primero con texto: sale bajísimo y miente. Y no repetir la misma pregunta para «calentar»: el prefix cache la guarda.",
    en_pagina={"conceptos": ["ttft", "tpot", "chunked-prefill", "prefix-caching", "preemption"], "precalculos": ["decode", "prefill"]}))

G.append(dict(n=5, id="abierta", titulo="La abierta y el reporte", objetivo="<code>abierta()</code> manda cada pregunta a su hora (Poisson), sin tope en el cliente; <code>reporte.py</code> dice el p95 con su intervalo, el goodput y el veredicto.",
    conceptos=["carga", "percentil", "goodput"],
    explica="<code>llegadas()</code>: los segundos entre llegadas de un proceso de Poisson son exponenciales con media 1 ÷ tasa; se suman con <code>random.Random(semilla).expovariate(tasa)</code>. <code>abierta()</code> duerme hasta cada hora y lanza un hilo por pregunta, sin esperar a que contesten las anteriores: si el cliente esperara, la tasa la pondría el servidor. Cada medida guarda cuándo tocaba (<code>programada</code>) y cuándo salió (<code>inicio</code>): el reporte revisa que coincidan. <code>reporte.py</code>: el percentil de rango más cercano, su intervalo con las posiciones n·0.95 ∓ 1.96·√(n·0.95·0.05), el goodput (las que cumplen TTFT y TPOT ÷ segundos) y un veredicto con tres respuestas: pasa, no pasa, o «no se sabe con estas peticiones».",
    codigo=[archivo("pipeline/reporte.py", "python", "Escribes <code>percentil()</code>, <code>intervalo()</code>, <code>goodput()</code> y <code>contra()</code>; el resumen, el veredicto y la tabla vienen en el esqueleto.")],
    comandos=[
        cmd("python3 pipeline/carga.py abierta", L("p5 abierta"), SIM + f" Tarda {int(AB_DUR) / 60:.0f} min: 40 llegadas a 0.07 por segundo."),
        cmd(f"{V} abierta", L("p5 verificar abierta")),
        cmd("python3 pipeline/reporte.py", REP, SIM + " Es la cuenta de la ficha hecha en tiempo real: la L40S no cumple el TTFT (el prefill solo ya ronda los 2 s) ni el TPOT con 8 a la vez. Lo que dirá la GPU de verdad está en el paso 6."),
        cmd(f"{V} reporte", L("p5 verificar")),
    ],
    verifica="<code>verificar.py abierta reporte</code> en verde: 40 llegadas exactamente en las horas de Poisson con la semilla, ninguna tarde, y el reporte igual a la cuenta de <code>verificar.py</code> (percentiles, intervalos, goodput y veredicto).",
    ojo="«No pasa» y «no se sabe» son distintos: si el p95 medido cumple pero el intervalo no tiene techo, no se puede firmar. Un veredicto de dos valores esconde eso.",
    en_pagina={"conceptos": ["percentil", "goodput"], "precalculos": ["intervalo"]}))

RECETA = L("p6 receta")
G.append(dict(n=6, id="gpu", titulo="La sesión en la GPU rentada", objetivo="Con el plan y el costo dichos antes, rentar una L40S en RunPod, correr las mismas pruebas contra el vLLM de verdad desde tu Mac, y terminarla con un vigía que no dependa de acordarte.",
    conceptos=["gpu-rentada", "api-key", "metrics"],
    explica="Por qué RunPod: comparado el 2026-11-27 (<code>mundo/proveedores.json</code>), es la L40S más barata con cobro por segundo (US$1.09/h en Secure Cloud; AWS cobra US$1.861 en us-east-1 y pide cuota de GPU, Modal US$1.95 sin máquina con puertos, Lightning US$3.54, y Lambda no factura a México ni renta L40S). Todo corre <b>desde tu Mac</b>: el pod solo corre vLLM, y la carga va por su proxy (<code>https://&lt;POD_ID&gt;-8000.proxy.runpod.net</code>), así los resultados nunca se quedan en una máquina que se borra. <code>gpu.env</code> dice proveedor, GPU, precio, disco, el tope en minutos y el tipo de cambio. <code>gpu.py plan</code> da el tiempo y el costo; <code>receta</code> arma el pod desde tu <code>servir.sh</code> (con <code>--host 0.0.0.0</code>, que el proxy necesita, y la clave en <code>VLLM_API_KEY</code>, fuera del comando). Al lanzar, <code>vigilar</code> deja un proceso en tu Mac que lo termina al tope por la API de RunPod; si la Mac se duerme, el tope es tu saldo prepagado.",
    codigo=[archivo("gpu.env", "bash", "La llave de RunPod no va aquí: va en la terminal, <code>export RUNPOD_API_KEY=…</code> (RunPod → Settings → API Keys, con permiso de escribir pods).")],
    comandos=[
        cmd("python3 mundo/gpu.py plan", PLAN, "El estimado sale de <code>carga.env</code> (la abierta tarda peticiones ÷ tasa) y de lo que tarda bajar 19.3 GB. El tope es el que pone el vigía."),
        cmd("python3 mundo/gpu.py receta", RECETA, "Si en el log del pod <code>non-default args</code> no trae <code>default_chat_template_kwargs</code> con <code>enable_thinking: False</code>, la consola no pasó bien el JSON: <code>verificar.py plantilla</code> lo atrapa."),
        cmd(f"{V} gpu", L("p6 verificar")),
        gpu("export RUNPOD_API_KEY=…            # tu llave, solo en esta terminal\n# gpu.env: POD_ID=<el id del pod>\n# servidor.env: LLM_URL=https://<POD_ID>-8000.proxy.runpod.net/v1\npython3 mundo/gpu.py vigilar", "Lo primero al ver el pod en Running. El vigía avisa 10 min antes del tope con una notificación de la Mac."),
        gpu("python3 verificar.py servidor clave memoria plantilla lugares", "Contra el vLLM de verdad. <code>memoria</code> dice cuántos bloques reservó la L40S real."),
        gpu("python3 pipeline/carga.py humo\npython3 pipeline/carga.py cerrada\npython3 pipeline/carga.py abierta\npython3 pipeline/reporte.py", "Las mismas pruebas, la misma semilla, la misma tasa. El TTFT del cliente suma la ida y vuelta a RunPod: compáralo con <code>vllm:time_to_first_token_seconds</code>."),
        gpu("python3 mundo/gpu.py apagar\npython3 mundo/gpu.py estado", "Termina el pod (deja de cobrar GPU y disco) y confirma que ya no existe. Después, <code>LLM_URL</code> de vuelta a <code>http://127.0.0.1:8000/v1</code>."),
    ],
    verifica="<code>verificar.py gpu</code> en verde antes de rentar (el precio del proveedor, una GPU de 48 GB y un tope con ≥ 20 % de margen y ≤ 3 h); en el pod, los mismos checks de los pasos 2 a 5 contra el vLLM de verdad; y al final <code>gpu.py estado</code> dice que el pod ya no existe.",
    ojo="Detener no es terminar: un pod detenido sigue cobrando el disco. Y el proxy es público: sin <code>VLLM_API_KEY</code>, cualquiera que adivine la URL usa tu saldo.",
    en_pagina={"conceptos": ["gpu-rentada"], "precalculos": ["costo"]}))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python3 mundo/reiniciar.py</code>: para el servidor, respalda tus archivos y tus resultados en <code>.respaldo/</code> y deja el esqueleto.",
        "En tu Mac, con el vLLM del dojo: la GPU rentada no hace falta para esta ronda.",
        "Sin GUION.md: solo los contratos de arriba de cada archivo y estos objetivos. Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El mundo completo y el dataset determinista.", "check": "mundo"},
        {"n": 2, "objetivo": "Un servidor.env con el modelo del despacho, solo en esta Mac, con su contexto, sus 8 lugares, una clave larga y la URL de tus programas; y un servir.sh que corra vllm serve con él.", "check": "config"},
        {"n": 3, "objetivo": "Una prueba con la tasa de una copia, peticiones suficientes, 8 a la vez, el tope de salida del plan y el criterio del despacho.", "check": "prueba", "pista": "¿Qué le toca a una de 3 copias de 0.21 por segundo?"},
        {"n": 4, "objetivo": "El servidor arriba con el nombre y el contexto de servidor.env, que conteste una pregunta.", "check": "servidor"},
        {"n": 5, "objetivo": "Sin clave o con otra, nadie usa el modelo.", "check": "clave"},
        {"n": 6, "objetivo": "Lugar en el KV cache para las 8 conversaciones típicas.", "check": "memoria", "pista": "¿Qué dice el log al arrancar, y qué opción achica esa memoria?"},
        {"n": 7, "objetivo": "El modelo contesta sin razonar, y el servidor cuenta el prompt igual en /tokenize y en la respuesta.", "check": "plantilla"},
        {"n": 8, "objetivo": "Con 10 a la vez, el motor corre exactamente 8 y las demás esperan.", "check": "lugares"},
        {"n": 9, "objetivo": "Una petición medida desde el cliente: TTFT, TPOT con su fórmula, huecos y los tokens del servidor; y las llegadas de Poisson con la semilla.", "check": "humo", "pista": "¿Qué evento del stream trae el primer texto, y cuál trae el usage?"},
        {"n": 10, "objetivo": "La cerrada: 24 peticiones bien, con 8 a la vez en el motor.", "check": "cerrada"},
        {"n": 11, "objetivo": "La abierta: 40 llegadas exactamente a su hora de Poisson, ninguna tarde.", "check": "abierta", "pista": "Si el cliente espera a que conteste la anterior, ¿quién pone la tasa?"},
        {"n": 12, "objetivo": "Un reporte con el percentil de rango más cercano, su intervalo, el goodput y un veredicto de tres valores, igual a la cuenta de verificar.py.", "check": "reporte"},
        {"n": 13, "objetivo": "La sesión de GPU planeada: el precio del proveedor, una GPU de 48 GB y un tope con margen.", "check": "gpu"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


def malos(nombre: str) -> str:
    """Las líneas que fallan de verificar.py con la falla puesta (y el total)."""
    return F(f"{nombre} verificar", filtro=r"^✗|en verde")


ARR = "y <code>python3 mundo/servidor.py arrancar</code>."
CONF = {
    "tope-dos": 'grep -n "max-num-seqs" servir.sh\ngrep "non-default" .taller/servidor.log',
    "memoria-recortada": 'grep "KV cache" .taller/servidor.log',
    "sin-clave": "curl -s http://127.0.0.1:8000/v1/models",
    "razonamiento-prendido": 'curl -s http://127.0.0.1:8000/v1/chat/completions -H "Authorization: Bearer dojo-vllm-5c1e9a" \\\n  -H "Content-Type: application/json" -d \'{"model": "qwen3-32b", "messages": [{"role": "user", "content": "¿Qué es una pena convencional?"}], "max_tokens": 40}\'',
    "nombre-servido": 'curl -s -H "Authorization: Bearer dojo-vllm-5c1e9a" http://127.0.0.1:8000/v1/models\ngrep NOMBRE servidor.env',
    "tasa-infinita": "grep TASA carga.env\npython3 pipeline/reporte.py",
}
e["fallas"] = [
    falla("tope-dos", "En la hora pico, los abogados esperan medio minuto antes de ver la primera palabra", "infra",
          "Alguien leyó en la ficha que una L40S sostiene ≥ 20 tokens/s solo con 2 conversaciones, y para que «cada abogado escriba rápido» fijó el tope a mano en servir.sh. Reinició el servidor.",
          "<code>verificar.py lugares</code> falla: con 10 a la vez, el motor corre 2. Todo lo demás pasa: contesta, pide clave y tiene memoria de sobra.",
          ["El KV cache no alcanza para más de 2.", "El motor tiene menos lugares de los que dice servidor.env.", "El cliente manda de 2 en 2."],
          cmd(CONF["tope-dos"] + "\n" + V + " lugares", F("tope-dos confirma") + "\n\n" + malos("tope-dos"), "El log dice el tope que de verdad usa el motor: <code>non-default args</code>."),
          "<code>--max-num-seqs \"$MAX_NUM_SEQS\"</code> de vuelta en <code>servir.sh</code> " + ARR + " Los 2 de la ficha son cuántas van a ≥ 20 tokens/s, no un tope: con tope, el TTFT se vuelve fila (hasta ≈ 27 s detrás de dos respuestas largas). Si hacen falta más rápidas, son más GPUs: por eso son 3 copias.",
          "max-num-seqs", "lugares"),
    falla("memoria-recortada", "Con 8 abogados a la vez, las respuestas se detienen y vuelven a empezar", "infra",
          "Para «dejarle memoria al modelo de embeddings» en la misma GPU, alguien copió de un tutorial viejo una opción de memoria a servir.sh y reinició el servidor. Arrancó bien.",
          "<code>verificar.py memoria</code> falla: el KV cache tiene lugar para ≈ 19 mil tokens y las 8 típicas piden 52 mil. Las preguntas sueltas contestan bien.",
          ["El modelo cambió y pesa más.", "Alguien le puso un tope a la memoria del motor.", "MAX_MODEL_LEN creció."],
          cmd(CONF["memoria-recortada"], F("memoria-recortada confirma") + "\n\n" + malos("memoria-recortada"), "2.38× al tope: antes eran " + KV_X + "×."),
          "Quitar <code>--gpu-memory-utilization 0.55</code> de <code>servir.sh</code> " + ARR + " La 0.34 dimensiona el KV cache con la memoria libre; un tope de 0.55 deja ≈ 4.7 GiB después de los pesos. Con 8 a la vez se acaban los bloques y el motor saca conversaciones (preemption): nada da error, todo tarda más. El modelo de embeddings va en otra GPU (la ficha lo pone en otra L40S).",
          "kv-extensible", "memoria"),
    falla("sin-clave", "El servidor contesta sin pedir clave", "infra",
          "Para «simplificar» y que el gateway no tuviera que mandar la llave, alguien quitó una opción de servir.sh y reinició el servidor. Todo sigue funcionando igual.",
          "<code>verificar.py clave</code> falla: sin clave, <code>/v1/models</code> contesta 200. Lo demás pasa: tus programas mandan su clave y nadie la revisa.",
          ["Tus programas perdieron la clave.", "El servidor ya no pide clave.", "Alguien cambió la clave."],
          cmd(CONF["sin-clave"], F("sin-clave confirma"), "Sin <code>Authorization</code> y contesta. En el pod, esa URL es pública."),
          "<code>--api-key \"$CLAVE\"</code> de vuelta en <code>servir.sh</code> " + ARR + " En el pod va en <code>VLLM_API_KEY</code>, y es lo único entre internet y tu saldo. Nada truena cuando se quita una barrera: por eso se prueba el lado de «sin permiso».",
          "api-key", "clave"),
    falla("razonamiento-prendido", "Las respuestas tardan el doble y salen con un «pensamiento» en inglés", "infra",
          "Limpiando servir.sh de «un JSON raro que nadie entendía», alguien quitó una opción y reinició el servidor.",
          "<code>verificar.py plantilla</code> falla: el modelo razonó antes de contestar. Las pruebas de carga todavía pasan, pero cada respuesta gasta su tope en pensar.",
          ["Cambió el modelo.", "La plantilla ya no apaga el razonamiento.", "max_tokens es muy chico."],
          cmd(CONF["razonamiento-prendido"], F("razonamiento-prendido confirma"), "Con 40 tokens de tope, no alcanzó a contestar: todos se fueron en <code>reasoning</code>."),
          "<code>--default-chat-template-kwargs '{\"enable_thinking\": false}'</code> de vuelta en <code>servir.sh</code> " + ARR + " Lo que importa se escribe explícito, aunque se vea raro. <code>--reasoning-parser qwen3</code> solo separa el razonamiento en su campo: no lo apaga.",
          "razonamiento", "plantilla"),
    falla("nombre-servido", "El asistente dice «el modelo no existe» y el servidor está sano", "config",
          "Para que el gateway lo encuentre como en la ficha («chat-grande»), alguien cambió el nombre en servir.sh, pero no en servidor.env. Reinició el servidor.",
          "<code>verificar.py servidor</code> falla: el servidor anuncia chat-grande y servidor.env dice qwen3-32b. <code>humo</code> y <code>plantilla</code> también fallan, con un 404.",
          ["El servidor se cayó.", "El nombre que anuncia el servidor no es el que piden tus programas.", "El modelo no se bajó."],
          cmd(CONF["nombre-servido"], F("nombre-servido confirma") + "\n\n" + malos("nombre-servido"), "Cada pregunta con <code>model=qwen3-32b</code> recibe: The model `qwen3-32b` does not exist."),
          "<code>--served-model-name \"$NOMBRE\"</code> de vuelta en <code>servir.sh</code> (una sola fuente de verdad) " + ARR + " En la ficha, «chat-grande» es el nombre en el gateway (LiteLLM), que traduce al nombre de cada copia de vLLM: es la estación 4.",
          "vllm", "servidor"),
    falla("tasa-infinita", "La prueba nueva dice que el TTFT p95 es de más de un minuto", "config",
          "Para que la prueba abierta no tardara 10 minutos, alguien puso TASA=inf en carga.env («que mande todo de una vez») y la volvió a correr. Le salió un TTFT espantoso y escribió en el chat que vLLM «no sirve».",
          "<code>verificar.py prueba</code> falla (TASA tiene que ser 0.07) y <code>abierta</code> también: las llegadas no son las de Poisson a 0.07 con la semilla.",
          ["vLLM está roto.", "La prueba no se hizo a la tasa de diseño.", "El KV cache se llenó."],
          cmd(CONF["tasa-infinita"].splitlines()[0] + "\n" + V + " prueba abierta", F("tasa-infinita confirma") + "\n\n" + malos("tasa-infinita"), "Las 40 salieron en el segundo 0: 8 al motor y 32 a la fila."),
          "<code>TASA=0.07</code> en <code>carga.env</code> y otra vez <code>python3 pipeline/carga.py abierta</code> (≈ 10 min). Una ráfaga mide cuánto aguanta la fila, no la hora pico. Un benchmark honesto dice a qué tasa se midió y la cumple.",
          "carga", "abierta"),
]

e["listo"] = [
    "vLLM sirve Qwen3 32B en AWQ con su clave (401 sin ella), 8,192 tokens, 8 lugares exactos, sin razonamiento y sin topes de memoria copiados.",
    "El log de arranque leído: cuántos tokens caben en el KV cache y cuántas conversaciones al tope.",
    "Un generador de carga que mide del lado del cliente (TTFT, TPOT, huecos y los tokens del servidor) y guarda lo que dijo /metrics.",
    "Una cerrada con 8 a la vez y una abierta con llegadas de Poisson a la tasa de una copia, cada pregunta a su hora.",
    "Un reporte con el p95 y su intervalo, el goodput y un veredicto que distingue «no pasa» de «no se sabe».",
    "La sesión de GPU planeada antes de rentar: costo estimado, tope y un vigía que la termina; y la confirmación de que ya no existe.",
]

e["repaso"] = {
    "memo": "<b>vLLM con sus límites a la vista (clave, contexto, 8 lugares, la memoria del KV cache sin topes copiados y el razonamiento apagado), y una prueba de carga honesta: cerrada con 8 a la vez y abierta con llegadas de Poisson a la tasa de diseño, medida desde el cliente, con /metrics al lado y un reporte que da el p95 con su intervalo, el goodput y un veredicto de tres valores.</b> En el dojo (simulado): el KV cache de una L40S tiene " + KV_TOK + " tokens (" + KV_X + "× al tope), una pregunta sola tarda " + HUMO_TTFT + " ms al primer token, el TTFT p95 de la abierta sale " + AB_TTFT95 + " ms y el TPOT p95 de la cerrada " + CE_TPOT95 + " ms: la cuenta de la ficha dice que una L40S no cumple. La sesión en la GPU rentada (≈ US$" + PLAN_USD + ") dice si la cuenta se parece a la realidad.",
    "trampa": "Lo que falla sin dar error: un tope de lugares que convierte el TTFT en fila, un --gpu-memory-utilization copiado que provoca preemptions, el JSON «raro» que apagaba el razonamiento, y sobre todo una prueba que no mide lo que se va a prometer (una ráfaga en vez de la tasa de diseño, 40 peticiones para firmar un p95, el TTFT del primer evento vacío). Lo que los atrapa: leer el log de arranque, mirar /metrics junto a lo que ve el cliente y escribir a qué tasa y con cuántas peticiones se midió cada número.",
    "entrevista": [
        {"q": "¿Por qué vLLM y no llama-server para el despacho?", "a": "Porque son 8 conversaciones a la vez en una GPU NVIDIA. vLLM reparte el KV cache en bloques que da conforme crece cada conversación (PagedAttention) y mete conversaciones nuevas en cada paso (batching continuo), así que leer los pesos una vez sirve para todas. llama-server reparte el contexto en lugares fijos. Los dos hablan la misma API: el cliente no cambia."},
        {"q": "Tu vLLM tiene lugar para 12 conversaciones. ¿Por qué el despacho pone --max-num-seqs 8 y no 2 ni 12?", "a": "Porque 8 es su número de diseño: con llegadas de Poisson a 0.21/s y 27 s por respuesta, 8 cubren casi toda la hora pico. 12 caben en memoria pero escribirían más lento. Y 2 (las que van a ≥ 20 tokens/s en una L40S) haría que las demás esperen en fila hasta ≈ 27 s: el TTFT se volvería espera. Si hace falta velocidad, son más GPUs, no menos lugares."},
        {"q": "¿Cómo diseñas una prueba de carga para un LLM?", "a": "Dos pruebas. Una abierta, con llegadas al azar (Poisson) a la tasa de diseño, sin tope en el cliente, para el TTFT de la hora pico. Una cerrada con N a la vez, para el TPOT cuando comparten la GPU. Con un dataset parecido al real (largos con variación y el mismo inicio, para que el prefix cache haga lo que hará en producción), tope de salida fijo, semilla, y cientos de peticiones si voy a firmar un p95. Guardo /metrics al lado: fila, KV cache y preemptions."},
        {"q": "Te dan un p95 de TTFT de 1.8 s. ¿Qué preguntas antes de creerlo?", "a": "Con cuántas peticiones (con 40 no tiene techo), a qué tasa y si fue abierta o una ráfaga, de qué largo eran los prompts y si se repetían (el prefix cache los guarda), desde dónde se midió (el cliente suma la red), y si cuenta desde el primer pedazo con texto. Y su intervalo: sin él no lo comparo con nada."},
        {"q": "¿Qué es el goodput y por qué importa más que el throughput?", "a": "Son las peticiones por segundo que cumplen todo el criterio a la vez, TTFT y TPOT. Un servidor puede contestar todo, con throughput alto, y que casi nada cumpla la promesa. Con 3 L40S, la ficha estima ≈ 0.06/s de goodput contra 0.21 pedidas: la capacidad útil es ≈ 29 %."},
        {"q": "¿Cómo practicas con una GPU rentada sin que te salga caro?", "a": "Escribo y pruebo todo sin GPU, contra un simulador con la misma API, y llego al pod a medir. Antes de rentar calculo minutos y costo (una L40S a US$1.09/h por ≈ 40 min es menos de un dólar). Al lanzar, un vigía que la termina por API al tope, saldo prepagado como tope real, y al final compruebo que el pod ya no existe: detenido, el disco sigue cobrando."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/ia-privada-vllm/CLAUDE.md",
    "guiado": "content/estaciones/ia-privada-vllm/prompts/guiado.md",
    "solo": "content/estaciones/ia-privada-vllm/prompts/solo.md",
    "romper_ayuda": "content/estaciones/ia-privada-vllm/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/ia-privada-vllm/prompts/romper-solo.md",
}

(APP / "content/estaciones/ia-privada-vllm.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
