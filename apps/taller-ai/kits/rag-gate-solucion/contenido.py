"""Arma content/estaciones/rag-gate.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /ruta/r9 && bash probar-fallas.sh /ruta/r9     # deja /ruta/r9.log y /ruta/r9-fallas.log
    python3 contenido.py /ruta/r9                                  # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs, y el código de cada
paso sale de los archivos de esta solución. Las cifras del texto también salen de los logs.
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
    texto = re.sub(r"\r?  ?\d+/\d+ G-\d+", "", m.group(1).replace("\r", ""))     # la barra de avance de correr.py
    lineas = [l for l in texto.rstrip("\n").splitlines()]
    while lineas and not lineas[0].strip():
        lineas.pop(0)
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
    m = re.search(r'^paso "' + re.escape(nombre) + r'" (.*?)(?=^paso |^usa |^#|\Z)', PROBAR, re.S | re.M)
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


def num(patron: str, texto: str, grupo: int = 1) -> str:
    m = re.search(patron, texto)
    if not m:
        sys.exit(f"no encontré «{patron}» en:\n{texto[:400]}")
    return m.group(grupo)


# ---------------------------------------------------------------- las cifras, de los logs
_api = L("p3 juez api")
_cal = L("p3 calibrar")
N = {
    "A06": num(r"acuerdo ([\d.]+%)", _api), "K06": num(r"kappa ([\d.]+)", _api), "FR06": num(r"falso rechazo ([\d.]+%)", _api),
    "A4": num(r"acuerdo ([\d.]+%)", _cal), "K4": num(r"kappa ([\d.]+)", _cal), "FP4P": num(r"falso pase ([\d.]+%)", _cal),
    "FR4": num(r"falso rechazo ([\d.]+%)", _cal), "SEG_CAL": num(r"· (\d+) s$", _cal),
}
_met = L("p2 metricas")
REC = num(r"recall@8 ([\d.]+%)", _met)
CIT = num(r"citas a una fuente esperada (\d+/\d+)", _met)
SINCITA = num(r"sin cita (\d+)", _met)
NOSE_OK = num(r"«no sé» correcto (\d+/\d+)", _met)
NOSE_MAL = num(r"«no sé» indebido (\d+/\d+)", _met)
P50 = num(r"primer token p50 (\d+) ms", _met)
P95 = num(r"p95 (\d+) ms", _met)
_jz = L("p3 juzgar")
BIEN = num(r"(\d+)/51 correctas", _jz)
N["FP4"] = f"{round(float(N['FP4P'].rstrip('%')) * 19 / 100)} de las 19"
_um = L("p4 examen umbral")
UM_EX = num(r"exactitud +(\d+/51 → \d+/51) correctas", _um)
UM_PG = num(r"pierde (\d+), gana (\d+)", _um, 0)
UM_REC = num(r"recall +([\d.]+% → [\d.]+%)", _um)
_k2 = L("p4 examen k2")
K2_EX = num(r"exactitud +(\d+/51 → \d+/51) correctas", _k2)
K2_PG = num(r"pierde (\d+), gana (\d+)", _k2, 0)
K2_REC = num(r"recall +([\d.]+% → [\d.]+%)", _k2)
K2_TT = num(r"p50 (\d+ → \d+) ms", _k2)
_seg = num(r"(\d+) s de API", L("pc tiempo"))
_pq = num(r"\(([\d.]+) s por pregunta\)", L("pc tiempo"))


def llenar(t: str) -> str:
    for k, v in N.items():
        t = t.replace(f"§{k}§", v)
    assert "§" not in t, t
    return t


sys.path.insert(0, str(SOL))
from conceptos import C  # noqa: E402

for c in C:
    for k in ("def", "analogia", "importa", "trampa"):
        c[k] = llenar(c[k])

V = "python verificar.py"
e = {
    "id": "gate", "patron": "llm", "rama": "rag", "etapa": "modelo", "num": 9,
    "titulo": "Gate de evals", "nav": "Gate de evals",
    "pregunta": "¿Cómo decides con números si un cambio al asistente puede salir: el golden set contra la API como cada persona, un juez que se parece a las personas y una comparación pregunta por pregunta que bloquea una regresión sin bloquear el ruido?",
    "version": "2026-11-27",
}

e["mapa"] = {
    "resumen": "La estación 4 dejó un <b>golden set</b> (preguntas con su respuesta de referencia y sus fuentes, repartidas en dev y test) y la estación 8 dejó la <b>API con citas</b>. Esta estación los junta en el <b>gate</b>: el examen que corre con cada cambio al asistente (el chunking, los embeddings, el reranker, el prompt, el umbral del «no sé», el modelo) y decide si sale. Primero <b>corre</b> las 51 preguntas de test contra la API como lo haría cada persona, con su llave y sin la cache, y guarda todo en una <b>corrida</b> con su <b>manifiesto</b>. Después mide lo que se puede contar: el <b>recall@8 por documento</b> sobre lo que de verdad llegó al prompt, las <b>fugas de permisos</b> (tolerancia cero), las <b>citas</b> y los <b>«no sé»</b>. Lo que no se puede contar (si la respuesta es correcta) lo califica un <b>juez</b>, un LLM más grande que el de la API, que antes se <b>calibra</b> contra respuestas que ya calificaron personas: <b>kappa de Cohen</b> y <b>falso pase</b>. Al final compara la candidata con la <b>base vigente</b> en las mismas preguntas (<b>prueba pareada</b> y <b>no inferioridad</b>), lista las que cambiaron de veredicto y bloquea si se cuela un chunk ajeno, si el juez no está calibrado, si el examen no es comparable o si el cambio pierde más de lo que el examen deja ver. Solo lo que pasa se <b>promueve</b> a base.",
    "entra": [
        "lo que dejó la estación 8, ya hecho en <code>pipeline/</code>: <code>POST /v1/ask</code> con FastAPI y SSE sobre el retrieval de la estación 6 y Qwen3 0.6B en llama-server, que ahora respeta <code>Cache-Control: no-cache</code>",
        "el golden set golden-v2 de la estación 4: 65 preguntas (51 de test, 14 de dev), cada una con su persona, su tipo (directa, varias, sin respuesta, prohibida), su respuesta de referencia y sus fuentes",
        "68 respuestas reales de esta API calificadas por dos personas del equipo (las dudosas se quitaron): lo que calibra al juez",
        "un juez: Qwen3 4B en Q4_K_M, en otro llama-server (puerto 9933)",
    ],
    "sale": [
        "<code>pipeline/correr.py</code>: el examen contra la API, una corrida por carpeta con <code>respuestas.jsonl</code> y <code>manifiesto.json</code>",
        "<code>pipeline/metricas.py</code>: recall@8 por documento, fugas, citas, «no sé» y primer token, con su intervalo de Wilson",
        "<code>pipeline/juez.py</code>: la rúbrica, la calibración contra personas y el veredicto de cada respuesta, con su cache",
        "<code>pipeline/gate.py</code>: la decisión contra la base vigente (pareada, con no inferioridad), las preguntas que cambiaron y <code>promover</code>; lo que la estación 11 corre antes de cambiar el índice y la 12 cada pocas horas como canario",
    ],
    "escala": [
        {"que": "El golden set", "ref": "≈ 600 preguntas escritas con expertos de cada área", "taller": "51 de test (y 14 de dev, que no entran)"},
        {"que": "El juez", "ref": "un LLM grande de la plataforma, calibrado contra ≈ 200 respuestas de expertos", "taller": f"Qwen3 4B en tu Mac, calibrado contra 68: kappa {N['K4']}, falso pase {N['FP4P']}"},
        {"que": "Cuándo corre", "ref": "en cada cambio de chunking, embeddings, reranker, prompt o modelo, y un canario de ≈ 100 preguntas cada 4 h", "taller": f"a mano: <code>gate.py examen</code>, ≈ {_seg} s de API más el juez"},
        {"que": "Qué ve", "ref": "con 600 preguntas, una caída de ≈ 3 puntos", "taller": "con 51, una de ≈ 10 (más la regla de la caída observada)"},
        {"que": "La base", "ref": "la versión en producción, con su corrida guardada", "taller": "<code>corridas/VIGENTE</code> y su historial"},
    ],
}

e["precalculos"] = {
    "intro": "Antes de escribir código, tres cuentas de servilleta del examen: cuánto se le cree a un porcentaje de 51 preguntas, qué caída puede ver el gate y cuánto tarda correrlo.",
    "cuentas": [
        {"id": "ruido", "pregunta": "¿Cuánto se le cree a un porcentaje de 51 preguntas?",
         "formula": "intervalo de Wilson del 95 % para k de n: (p + z²/2n ± z√(p(1 − p)/n + z²/4n²)) ÷ (1 + z²/n), con z = 1.96",
         "ref": {"cuenta": "510 de ≈ 600 bien (85 %)", "valor": "± ≈ 3 puntos; un área de 60 preguntas, ± ≈ 9"},
         "taller": {"cuenta": "40 de 51 bien (78 %)", "valor": "de ≈ 65 % a ≈ 88 %: ± ≈ 11 puntos"},
         "decide": "Con 51 preguntas, comparar dos porcentajes sueltos no distingue casi nada: 78 % y 82 % caben en el mismo intervalo. Por eso el gate compara pregunta por pregunta (pareado) y no los dos números.",
         "conceptos": ["wilson"],
         "comprueba": cmd(P("pc ruido"), L("pc ruido"))},
        {"id": "margen", "pregunta": "¿Qué caída puede ver el gate?",
         "formula": "margen mínimo ≈ (1.645 + 0.842) × √(d ÷ n): d = fracción de preguntas que cambian de veredicto, n = preguntas; 1.645 es la cola del 95 % y 0.842 da 80 % de las veces que un cambio que no pierde nada pase",
         "ref": {"cuenta": "600 preguntas con 10 % que cambian", "valor": "≈ 3 puntos; un área de 200, ≈ 6"},
         "taller": {"cuenta": "51 preguntas con 10 % que cambian", "valor": "≈ 11 puntos: el dojo usa 10 y además bloquea si lo observado cae más de 3"},
         "decide": "El margen no se elige para que pasen los cambios: es lo que se acepta perder, y el número de preguntas dice cuál se puede proteger. En el dojo el sistema es determinista (temperatura 0): un cambio que no toca nada no mueve ninguna respuesta y su diferencia es exactamente 0. Lo que la estadística no ve, se lee: el gate lista las preguntas que cambiaron.",
         "conceptos": ["no-inferioridad", "pareada"],
         "comprueba": cmd(P("pc margen"), L("pc margen"))},
        {"id": "tiempo", "pregunta": "¿Cuánto tarda el examen y cada cuándo corre?",
         "formula": "tiempo = preguntas × segundos por pregunta ÷ las que corren a la vez + el juez (solo las respuestas nuevas: las iguales ya están en su cache)",
         "ref": {"cuenta": "≈ 600 × ≈ 4 s ÷ 8 a la vez (supuestos)", "valor": "≈ 5 min por cambio; el canario de 100 cada 4 h son 600 preguntas al día, ≈ 2.4 % del tráfico"},
         "taller": {"cuenta": f"51 una tras otra a ≈ {_pq} s", "valor": f"≈ {_seg} s de API, más ≈ 1 s por respuesta nueva del juez"},
         "decide": "El examen es barato comparado con lo que protege: cabe en cada pull request. Lo caro es escribir las preguntas (estación 4) y calibrar al juez; por eso los dos se guardan y se versionan.",
         "conceptos": ["corrida"],
         "comprueba": cmd(P("pc tiempo"), L("pc tiempo"), "Medido en el paso 5, con el examen de punta a punta.")},
    ],
}

e["conceptos"] = C

e["mundo"] = {
    "resumen": "El kit trae el marketplace ficticio del caso el <b>23 de noviembre a las 16:00</b>, con lo que dejaron las estaciones 2 a 8: el corpus de <b>152 chunks de 105 documentos</b>, el directorio de <b>14 personas</b> con su llave, el golden set <b>golden-v2</b> (65 preguntas: 51 de test y 14 de dev), el índice de la estación 5 y, ya hecho en <code>pipeline/</code>, el retrieval de la estación 6 y la <b>API con citas de la estación 8</b>. Nuevo: <b>68 respuestas reales de esa API calificadas por dos personas</b> (Paula Vega, líder de soporte, y Sofía Leal, líder de operaciones; las que no se pusieron de acuerdo se quitaron), un <b>juez</b> (Qwen3 4B) en su propio llama-server y dos <b>propuestas</b> del equipo para que el gate las juzgue. Tú escribes el examen, las métricas, el juez y el gate.",
    "trae": [
        {"que": "mundo/entrada/", "detalle": "El corpus, el directorio, el golden set de la estación 4 y <code>calificaciones.jsonl</code>: pregunta, referencia, respuesta de la API y la etiqueta de las personas (49 correctas, 19 incorrectas)."},
        {"que": "Los modelos", "detalle": "<code>mundo/modelos.json</code> con e5, el reranker, Qwen3 0.6B (la API) y Qwen3 4B Q4_K_M (el juez, ≈ 2.5 GB), cada uno con su revisión y su sha256; <code>mundo/modelos.py</code> los baja una vez (≈ 3.9 GB). Si ya hiciste la estación 8, <code>DOJO_MODELOS=/ruta/a/su/modelo</code> enlaza los tres que ya tienes."},
        {"que": "Los servidores", "detalle": "<code>mundo/servidor.py</code> arranca los dos llama-server (el LLM en 9931 con <code>servidor.env</code>, el juez en 9933 con <code>juez.env</code>); <code>mundo/api.py</code> arranca la API en 9932. Juntos usan ≈ 4 GB de memoria."},
        {"que": "Las propuestas", "detalle": "<code>mundo/propuesta.py</code> pone en <code>config.yaml</code> un cambio que pidió alguien del equipo (bajar el umbral del «no sé», mandar 2 chunks en vez de 8) y lo quita después. Es lo que en C11 sería un pull request."},
        {"que": "verificar.py y romper.py", "detalle": "Los 8 checks de la estación (de <code>mundo</code> a <code>examen</code>; <code>--rapido</code> corre todos menos el examen completo) y las 6 fallas: el examen con la cache, dev dentro del examen, el juez apuntado a la API, el margen aflojado, sin parear y contra la última corrida."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/correr.py", "hace": "Paso 1: preguntas() del split, una() por HTTP con la llave de su persona y sin cache, el manifiesto y correr(), que no pisa una corrida."},
        {"archivo": "pipeline/metricas.py", "hace": "Paso 2: docs(), por_pregunta() (recall por documento, fuga, citas, «no sé», primer token), wilson(), p95() y resumen()."},
        {"archivo": "pipeline/juez.py", "hace": "Paso 3: el Juez con su identidad y su cache, veredicto() con las reglas sin juez, kappa(), calibrar() y juzgar(). La rúbrica viene dada."},
        {"archivo": "pipeline/gate.py", "hace": "Paso 4: base_de(), no_inferior() (pareada o no), decidir() con sus 6 reglas y las preguntas que cambiaron, y promover()."},
        {"archivo": "config.yaml", "hace": "evals (split, sin_cache), juez (url, kappa_min, falso_pase_max) y gate (base, pareado, confianza_z, margen, caida_max, recall_min, fugas_max)."},
    ],
    "requisitos": [
        "Python 3.12 o más nuevo (numpy 2.5.5 lo pide; se probó con 3.14.3), ≈ 150 MB para el entorno virtual y ≈ 4 GB para los modelos",
        "llama.cpp 1.1.0 o más nuevo (<code>brew install llama.cpp</code>) y ≈ 4 GB de memoria libre para los dos modelos",
        "Internet para el <code>pip install</code> y para bajar los modelos una vez; después, nada",
        "Las estaciones 4 y 8 ayudan, pero no hacen falta: el kit trae su golden set y su API",
    ],
    "sustituciones": [
        {"nube": "Un job de CI que corre el golden set en cada pull request, con varias preguntas a la vez", "local": "<code>python pipeline/gate.py examen</code> a mano, una pregunta tras otra", "diferencia": "La misma decisión con el mismo código de salida (1 si bloquea, para que el CI no deje fusionar). En C11 el job usa usuarios de prueba con la identidad de cada persona del golden set."},
        {"nube": "Un juez grande de la plataforma de modelos, calibrado contra ≈ 200 respuestas de expertos, con falso pase ≤ 10 %", "local": f"Qwen3 4B en tu Mac, calibrado contra 68, con falso pase ≤ 20 % (mide {N['FP4P']})", "diferencia": "Ningún juez que quepa en la Mac llega al 10 % con estas 68 (se probaron 0.6B, 1.7B y 4B): el dojo lo dice y usa 20 %. Con un falso pase así, el gate ve menos regresiones de las que hay; por eso lista las preguntas que cambiaron."},
        {"nube": "Un almacén de corridas (un bucket o una base de datos) y el registro de qué versión está en producción", "local": "<code>corridas/</code>, <code>corridas/VIGENTE</code> y <code>historial.jsonl</code>", "diferencia": "La misma regla: una corrida no se pisa, y la base solo cambia con promover, después de pasar el gate."},
        {"nube": "La prueba de latencia con carga (muchas personas a la vez, la GPU de la plataforma)", "local": "el primer token del examen, que se muestra pero no decide", "diferencia": "El examen corre una pregunta a la vez en una Mac que hace otras cosas: su p95 cambia de una corrida a otra sin cambiar nada. La latencia se prueba aparte, con carga."},
    ],
    "arranque": "unzip rag-gate.zip && cd rag-gate\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npython mundo/modelos.py\npython mundo/crear.py\npython mundo/servidor.py arrancar\npython mundo/api.py arrancar",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El almacén del 23 a las 16:00 con las calificaciones, los cuatro modelos con su sha256, los dos llama-server (la API y el juez) y la API de la estación 8 arriba.",
    conceptos=["gate"],
    explica="Son los paquetes de la estación 8 (onnxruntime, numpy, tokenizers, pyyaml, fastapi y uvicorn) y un modelo más: el juez. <code>mundo/modelos.py</code> baja e5, el reranker, Qwen3 0.6B y Qwen3 4B de un commit fijo y compara el sha256 de cada archivo. <code>mundo/crear.py</code> copia el corpus, el directorio, el golden set y las calificaciones, escribe las llaves y construye el índice. <code>mundo/servidor.py arrancar</code> levanta los dos llama-server y <code>mundo/api.py arrancar</code> la API.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("python mundo/modelos.py", L("p0 modelos", sin=r"(copiado|enlazado) de"), "Una sola vez, con internet (≈ 3.9 GB; con <code>DOJO_MODELOS</code>, solo el juez). Si un sha256 no coincide, el archivo no se guarda."),
        cmd("python mundo/modelos.py --listar", L("p0 listar")),
        cmd("python mundo/crear.py", L("p0 crear")),
        cmd("python mundo/servidor.py arrancar", L("p0 servidores"), "Dos procesos de llama-server: el de la API (9931) y el del juez (9933). Juntos, ≈ 4 GB de memoria."),
        cmd("python mundo/api.py arrancar", L("p0 api")),
        cmd(f"{V} mundo", L("p0 verificar")),
        cmd(f"{V} correr", L("p0 esqueleto"), "Es lo esperado: tus cuatro archivos todavía son el esqueleto. Cada check se pone en verde en su paso."),
    ],
    verifica="<code>verificar.py mundo</code> en verde.",
    ojo="<code>modelo/</code>, <code>almacen/</code>, <code>indices/</code> y <code>corridas/</code> no van en el .zip ni en git. La API de la estación 8 no se toca: el gate la examina por HTTP, como lo haría la app de chat."))

G.append(dict(n=1, id="correr", titulo="Correr el examen", objetivo="<code>correr.py</code>: cada pregunta de test contra la API, con la llave de su persona y sin la cache, guardada en una corrida con su manifiesto.",
    conceptos=["corrida", "manifiesto", "examen-cache", "contaminacion"],
    explica="<code>preguntas()</code> toma el golden set vigente y se queda con el split de <code>evals.split</code> (test: dev ya se usó para elegir el umbral del «no sé»). <code>una()</code> hace el <code>POST /v1/ask</code> como la app de chat, con la llave de la persona de esa pregunta (las prohibidas solo prueban algo si se hacen como quien no puede ver) y con <code>Cache-Control: no-cache</code>, y guarda de los eventos SSE lo que llegó al prompt, la respuesta, las citas, el «no sé» y el primer token. Un error no detiene el examen: queda en la fila. <code>correr()</code> escribe en una carpeta temporal y la renombra al final, y no pisa una corrida que ya existe. El <b>manifiesto</b> guarda lo que hace falta para saber si dos corridas se pueden comparar: el golden (versión y sha256), el split, las preguntas, el sha256 de <code>config.yaml</code>, el modelo y el índice.",
    codigo=[py("pipeline/correr.py")],
    comandos=[
        cmd("python pipeline/correr.py base", L("p1 correr"), "La versión de hoy, sin cambios: va a ser la primera base."),
        cmd("python -c \"import json; …\"   # la fila de G-012", L("p1 fila"), "Todo lo que hace falta para medir sin volver a preguntar: el contexto que leyó el modelo, la respuesta, sus citas y los milisegundos."),
        cmd("python -c \"import json; …\"   # el manifiesto", L("p1 manifiesto")),
        cmd(f"{V} correr", L("p1 verificar"), "El check calienta antes la cache de la API con esas 6 preguntas: si tu examen no pide <code>no-cache</code>, se nota."),
    ],
    verifica="<code>verificar.py correr</code> en verde: 6 preguntas con la llave de su persona, ninguna de la cache aunque estaban en ella, el manifiesto completo y una corrida que no se pisa.",
    ojo="El examen corre contra la API de verdad, por HTTP, y no llamando a <code>responder()</code> por dentro: así mide lo mismo que recibe una persona (la llave, los permisos, el streaming, los errores).",
    en_pagina={"conceptos": ["corrida", "manifiesto", "examen-cache", "contaminacion"], "precalculos": []}))

G.append(dict(n=2, id="metricas", titulo="Lo que se puede contar", objetivo="<code>metricas.py</code>: por pregunta y en total, el recall@8 por documento, las fugas, las citas, los «no sé» y el primer token, con su intervalo.",
    conceptos=["recall-doc", "fuga", "cita-esperada", "abstencion", "wilson"],
    explica="<code>por_pregunta()</code> compara una fila con su pregunta del golden set. El <b>recall</b> se cuenta por documento y sobre lo que llegó al prompt (después de las guardas y del «no sé»), no sobre lo que devolvió el buscador. Una <b>fuga</b> es cualquier chunk que la persona no puede ver (con la ACL de la estación 3 y el directorio de hoy) en el contexto o en las citas, o una fuente de una prohibida que llegó al prompt. Las <b>citas</b> se revisan contra las fuentes esperadas (¿cita el documento correcto?) y se cuentan las respuestas sin cita. El <b>«no sé»</b> es correcto en sin respuesta y prohibidas, e indebido en las que sí tienen respuesta. <code>resumen()</code> junta todo y lo escribe en <code>metricas.json</code>.",
    codigo=[py("pipeline/metricas.py")],
    comandos=[
        cmd("python pipeline/metricas.py base", L("p2 metricas"), f"Recall {REC}: las fuentes llegan casi siempre. Fugas 0. Pero solo {CIT} de las respuestas con cita citan una fuente esperada, {SINCITA} contestan sin citar, y {NOSE_MAL.split('/')[0]} preguntas que sí tienen respuesta reciben «no sé»."),
        cmd("python -c \"import json; …\"   # cuatro respuestas y sus citas", L("p2 citas"), "G-007 tiene el dato bien y cita el documento de al lado (un ticket de Jira que también lo dice): la métrica barata lo marca, y eso es lo que no sabe distinguir."),
        cmd(f"{V} metricas", L("p2 verificar")),
    ],
    verifica="<code>verificar.py metricas</code> en verde: recall por documento (0.5 con dos chunks del mismo), fuga por ACL y por prohibida, citas, abstención, Wilson y p95.",
    ojo="Estas métricas dicen si llegó la fuente y si citó algo razonable, no si la respuesta es correcta: G-001 tiene su fuente en el prompt, la cita es válida y aun así dice un horario que no es. Eso lo califica el juez.",
    en_pagina={"conceptos": ["recall-doc", "fuga", "cita-esperada", "abstencion", "wilson"], "precalculos": ["ruido"]}))

G.append(dict(n=3, id="juez", titulo="Un juez que se parece a las personas", objetivo="<code>juez.py</code>: un LLM que califica cada respuesta contra la referencia, calibrado contra 68 respuestas que calificaron personas, y que no se le cree si no pasa.",
    conceptos=["juez", "rubrica", "calibrar", "kappa", "falso-pase"],
    explica="El <b>juez</b> es otro llama-server con un modelo más grande (Qwen3 4B). Recibe la <b>rúbrica</b> (qué cuenta como error), la pregunta, la referencia del golden set y la respuesta, y contesta <code>{\"error\": true|false}</code> con un JSON schema y temperatura 0. Su veredicto se guarda en <code>cache/juez/</code> con una llave que incluye el modelo y la rúbrica: la misma respuesta no se vuelve a calificar, y un juez nuevo no reusa lo viejo. Algunas no necesitan juez: un «no sé» es correcto en sin respuesta y prohibidas e incorrecto en las demás, y un error es incorrecto. <b>Calibrar</b> es pasarle las 68 respuestas que ya calificaron personas y medir el acuerdo, la <b>kappa de Cohen</b> y el <b>falso pase</b>; el gate solo le cree si pasa.",
    codigo=[py("pipeline/juez.py")],
    comandos=[
        cmd("python pipeline/juez.py calibrar --url http://127.0.0.1:9931/v1", L("p3 juez api"), f"Primero, el modelo de la API como juez. No aprueba nada malo (falso pase 0 %), pero reprueba {N['FR06']} de las buenas: acuerda {N['A06']} y su kappa es {N['K06']}. No sirve."),
        cmd("python pipeline/juez.py calibrar", L("p3 calibrar"), f"El de 4B: kappa {N['K4']} y falso pase {N['FP4P']} (aprueba {N['FP4']} que las personas reprobaron). Pasa el tope del dojo (20 %), no el de C11 (10 %)."),
        cmd("python pipeline/juez.py calibrar", L("p3 otra vez"), "Otra vez: 0 s. Las 68 ya están en la cache del juez, con la misma rúbrica y el mismo modelo."),
        cmd("python pipeline/juez.py base", L("p3 juzgar")),
        cmd("python -c \"import json; …\"   # las incorrectas de la base", L("p3 incorrectas"), "Hay que leerlas: unas son de verdad (G-001, G-017, G-043, G-066), otras son el juez de 4B reprobando una respuesta a la que solo le falta un detalle (G-006 y G-023: G-023 dice «8 %» y no «sin IVA»). Las dos cosas pasan: por eso se calibra."),
        cmd(f"{V} juez", L("p3 verificar")),
    ],
    verifica="<code>verificar.py juez</code> en verde: el juez no es el modelo de la API, la kappa y el falso pase pasan sus topes en las 68 calificaciones y las reglas sin juez funcionan.",
    ojo=f"El tope de falso pase del dojo es 20 % y no el 10 % de C11: se probaron tres jueces que caben en la Mac (0.6B, 1.7B y 4B) y tres rúbricas, contra estas mismas 68, y ninguno bajó de ≈ 10 %; el mejor que es rápido queda en {N['FP4P']}. Eso tiene dos consecuencias honestas: el número de la calibración es optimista (la rúbrica se eligió con estas calificaciones; uno de verdad se mide con otras), y con 19 reprobadas el intervalo del falso pase va de ≈ 5 a ≈ 38 %. Lo que no se hace es bajar el tope después de ver que no pasa.",
    en_pagina={"conceptos": ["juez", "rubrica", "calibrar", "kappa", "falso-pase"], "precalculos": []}))

G.append(dict(n=4, id="gate", titulo="El gate: contra la base, pregunta por pregunta", objetivo="<code>gate.py</code>: comparar una corrida con la base vigente en las mismas preguntas, con no inferioridad, listar las que cambiaron, y promover solo lo que pasa.",
    conceptos=["base", "pareada", "no-inferioridad"],
    explica="<code>no_inferior()</code> es la cuenta: con las dos listas de valores por pregunta (1 o 0 para correcta, o el recall de cada una), Δ es la diferencia de las medias y, <b>pareado</b>, su error sale de las diferencias pregunta por pregunta: las que no cambian no suman. La cota de abajo es Δ − 1.645 × error, y pasa si queda arriba de −margen. <code>decidir()</code> aplica las reglas en orden: <b>comparable</b> (mismo golden, split y preguntas), <b>sin_cache</b>, <b>juez</b> (calibrado, y el mismo que calificó las dos), <b>permisos</b> (0 fugas), <b>recall</b> (piso de 90 % y no inferior) y <b>exactitud</b> (no inferior y sin caer más de 3 puntos). <code>promover()</code> mueve <code>corridas/VIGENTE</code>, solo si la corrida pasó contra la base de ese momento.",
    codigo=[py("pipeline/gate.py")],
    comandos=[
        cmd(f"{V} estadistica", L("p4 estadistica"), "Las cuentas de la lección de evals de IA Privada: 200 preguntas, pierde 5 y gana 17."),
        cmd("python pipeline/gate.py base", L("p4 sin base"), "Todavía no hay base: la primera se promueve a mano, después de leerla."),
        cmd("python pipeline/gate.py promover base", L("p4 promover")),
        cmd("python mundo/propuesta.py", L("p4 propuestas")),
        cmd("python mundo/propuesta.py umbral-bajo", L("p4 umbral")),
        cmd("python pipeline/gate.py examen umbral-bajo", L("p4 examen umbral"), f"La queja era real: el recall sube ({UM_REC}). Pero el modelo no contesta bien esas preguntas y empieza a inventar en dos que no tienen respuesta para quien pregunta (un teléfono que no está en los documentos y una tarifa que esa persona no puede ver): {UM_EX}, {UM_PG}. La estadística sola no lo detiene (la cota queda arriba de −10 %); lo detiene la caída observada."),
        cmd("python pipeline/gate.py promover umbral-bajo", L("p4 promover umbral")),
        cmd("python mundo/propuesta.py quitar", L("p4 quitar umbral")),
        cmd("python mundo/propuesta.py k-2", L("p4 k2")),
        cmd("python pipeline/gate.py examen k-2", L("p4 examen k2"), f"Con 2 chunks, el primer token baja (p50 {K2_TT} ms) y la exactitud empata ({K2_EX}, {K2_PG}): con menos distractores, el modelo de 0.6B acierta algunas que fallaba. Pero el recall cae ({K2_REC}) en las preguntas que necesitan dos fuentes: queda bajo el piso de 90 % y su cota pasa de −10 %."),
        cmd("python mundo/propuesta.py quitar", L("p4 quitar k2")),
        cmd(f"{V} gate promover", L("p4 verificar")),
    ],
    verifica="<code>verificar.py gate promover</code> en verde: la misma corrida pasa; bloquea por exactitud, permisos, comparable, sin_cache y juez; una regresión no se promueve y, si se vuelve a correr, se compara con la vigente.",
    ojo="«Pierde 3, gana 3» no es «no cambió nada»: son 6 respuestas distintas, y cada una se lee. El gate dice si un cambio cabe en el margen; las preguntas que cambiaron dicen qué hace el cambio.",
    en_pagina={"conceptos": ["base", "pareada", "no-inferioridad"], "precalculos": ["margen"]}))

G.append(dict(n=5, id="examen", titulo="El examen de cada cambio, de punta a punta", objetivo="Correr, juzgar y decidir en un comando, como lo haría un CI, y comprobar que la versión de hoy contra sí misma pasa.",
    conceptos=["gate"],
    explica="<code>gate.py examen &lt;nombre&gt;</code> hace los tres pasos seguidos y termina con código 1 si bloquea: es lo que corre un CI en cada pull request que toca el chunking, los embeddings, el reranker, el prompt, el umbral o el modelo. Sin ningún cambio, la corrida de hoy tiene que pasar contra la base: con temperatura 0 el modelo repite sus respuestas, y el juez repite sus veredictos (de su cache).",
    codigo=[],
    comandos=[
        cmd("python pipeline/gate.py examen hoy", L("p5 hoy"), "0 que cambian: Δ 0 y cota 0. El primer token sí cambia de una corrida a otra, sin cambiar nada: por eso se muestra y no decide."),
        cmd(f"{V} examen", L("p5 verificar")),
    ],
    verifica="<code>verificar.py examen</code> en verde: el examen completo de hoy, sin cambios, contra la base vigente, pasa.",
    ojo="Con un LLM que no repite (temperatura mayor que 0, o un servidor que junta peticiones en lotes), un cambio que no toca nada sí mueve respuestas: entonces el margen tiene que ser el que dice el precálculo «margen» con ese ruido medido, y se mide corriendo la base dos veces.",
    en_pagina={"conceptos": ["gate"], "precalculos": ["tiempo"]}))
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py</code>: deja el esqueleto en tus cuatro archivos, devuelve <code>config.yaml</code> de fábrica y vuelve a crear el mundo (se borran <code>corridas/</code>; los modelos, los servidores y la API se quedan).",
        "Sin GUION.md: solo los contratos de arriba de cada archivo y estos objetivos.",
        "Claude corre <code>verificar.py</code> y te dice qué falla; no te da código.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "Los cuatro modelos con su sha256, las calificaciones en el almacén, y los dos llama-server y la API arriba.", "check": "mundo"},
        {"n": 2, "objetivo": "Un examen de test contra la API, con la llave de cada persona, sin la cache, con su manifiesto, y que no pisa una corrida.", "check": "correr", "pista": "Si la misma pregunta se hizo hace 2 minutos, ¿qué recibe tu examen?"},
        {"n": 3, "objetivo": "Recall por documento sobre lo que llegó al prompt, fugas, citas, «no sé», Wilson y p95.", "check": "metricas", "pista": "¿Dos chunks del mismo documento son dos aciertos?"},
        {"n": 4, "objetivo": "Un juez que no es el modelo de la API, calibrado contra las 68 calificaciones de personas, y reglas sin juez para los «no sé» y los errores.", "check": "juez"},
        {"n": 5, "objetivo": "La cuenta de no inferioridad, pareada: un cambio que no mueve nada pasa y uno que pierde 4 de 51 no.", "check": "estadistica", "pista": "¿De dónde sale el error de la diferencia: de cada porcentaje o de las preguntas que cambiaron?"},
        {"n": 6, "objetivo": "El gate bloquea por exactitud, permisos, un examen no comparable, la cache y un juez sin calibrar; la misma corrida pasa.", "check": "gate"},
        {"n": 7, "objetivo": "Promover solo lo que pasa contra la base vigente, y comparar siempre con ella.", "check": "promover", "pista": "Si una regresión se vuelve a correr, ¿contra qué se compara?"},
        {"n": 8, "objetivo": "El examen completo de hoy, sin cambios, pasa contra tu base.", "check": "examen"},
    ],
}


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma, arreglo, concepto, check):
    return dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis, confirma=confirma, arreglo=arreglo, concepto=concepto, check=check)


_ck2 = F("cache k2")
e["fallas"] = [
    falla("examen-con-cache", "Un cambio de retrieval sale igual que la base en el examen, y en producción no", "config",
          "Para que el examen corra más rápido, alguien dejó que use la cache de la API: «las preguntas son las mismas de siempre».",
          "Justo después de correr la base, la propuesta de 2 chunks «empata» en recall. <code>verificar.py correr</code> falla y el gate bloquea por sin_cache.",
          ["La propuesta no cambia nada de verdad.", "El examen recibe el top que la API guardó de la base.", "El reranker ya devuelve solo los mejores."],
          cmd("python pipeline/gate.py examen k2-con-cache", _ck2, "Con la cache, las 51 preguntas reciben el top de 8 que la API guardó hace un momento: recall y respuestas como en la base. Lo que la detiene es la regla sin_cache."),
          "<code>evals.sin_cache</code> vuelve a <code>true</code>. Cada pregunta del examen pide <code>Cache-Control: no-cache</code>, cada fila guarda <code>de_cache</code> y el gate bloquea si alguna salió de la cache.",
          "examen-cache", "correr"),
    falla("examen-con-dev", "El examen trae 65 preguntas en vez de 51 y ya no se compara con la base", "config",
          "Para tener «más preguntas y menos ruido», alguien juntó dev y test en el examen del gate.",
          "<code>verificar.py correr</code> dice que hay preguntas de dev; una corrida nueva trae 65 y el gate bloquea por comparable.",
          ["El golden set cambió de versión.", "El examen usa también dev.", "Se agregaron preguntas nuevas."],
          cmd(f"{V} correr", F("dev verificar"), "Las 14 de dev ya se usaron para elegir el umbral del «no sé»."),
          "<code>evals.split</code> vuelve a <code>test</code>. Dev es para decidir, test para medir; si hacen falta más preguntas, se escriben (estación 4).",
          "contaminacion", "correr"),
    falla("juez-es-la-api", "El juez reprueba la mitad de las respuestas buenas y el gate ya no le cree", "infra",
          "Para ahorrar memoria, alguien apagó el juez de 4B y lo apuntó al LLM de la API: «es el mismo tipo de modelo, y ya está cargado».",
          "<code>verificar.py juez</code> falla: el servidor del juez no contesta y, si solo se levanta, el que contesta en <code>juez.url</code> es el modelo de la API. Su calibración da kappa ≈ 0.3.",
          ["El juez se cayó.", "El juez es otro modelo.", "Cambió la rúbrica."],
          cmd("python pipeline/juez.py calibrar", F("juez calibrar"), "El mismo modelo que contesta, calificándose: no se parece a las personas."),
          "<code>juez.url</code> vuelve a <code>http://127.0.0.1:9933/v1</code> y <code>python mundo/servidor.py arrancar juez</code>; si se cambia de juez, se calibra otra vez antes de usarlo.",
          "calibrar", "juez"),
    falla("margen-ancho", "Un cambio que pierde respuestas pasa el gate", "config",
          "El gate bloqueó tres cambios seguidos y el equipo pidió «aflojarlo un poco».",
          "La propuesta de bajar el umbral, que inventa en dos preguntas sin respuesta, ahora pasa. <code>verificar.py estadistica</code> falla.",
          ["El juez ya no reprueba las inventadas.", "El gate ya no bloquea caídas.", "La propuesta cambió."],
          cmd("python pipeline/gate.py examen umbral-flojo", F("mar umbral"), "Las mismas dos respuestas inventadas, y pasa: el margen es de 50 puntos y la caída máxima también."),
          "<code>gate.margen</code> vuelve a 0.10 y <code>gate.caida_max</code> a 0.03. Si el gate bloquea mucho, se agregan preguntas o se leen las que cambiaron; no se afloja.",
          "no-inferioridad", "estadistica"),
    falla("sin-parear", "Un cambio que no cambia ninguna respuesta se bloquea", "config",
          "Alguien leyó que «lo correcto es comparar los dos porcentajes con su intervalo» y apagó la comparación pregunta por pregunta.",
          "El examen de hoy, sin ningún cambio, se bloquea por exactitud. <code>verificar.py estadistica</code> falla.",
          ["El modelo dejó de repetir sus respuestas.", "El gate dejó de comparar pregunta por pregunta.", "El juez cambió de opinión."],
          cmd("python pipeline/gate.py examen hoy-sin-parear", F("par hoy"), "0 respuestas distintas y aun así bloquea: sin parear, el error de la diferencia sale de cada porcentaje (≈ 8 puntos) y no de las que cambiaron."),
          "<code>gate.pareado</code> vuelve a <code>true</code>. Son las mismas preguntas: solo cuentan las que cambiaron.",
          "pareada", "estadistica"),
    falla("contra-la-ultima", "Una regresión que el gate bloqueó pasa a la segunda", "config",
          "Para no tener que promover a mano, alguien hizo que el gate compare contra la última corrida en vez de contra la vigente.",
          "<code>verificar.py promover</code> falla: la misma regresión, corrida dos veces, la segunda vez pasa.",
          ["La regresión se arregló sola.", "El gate compara contra otra corrida.", "Se promovió algo sin querer."],
          cmd(f"{V} promover", F("ult verificar")),
          "<code>gate.base</code> vuelve a <code>vigente</code>. Se compara siempre contra lo que la empresa usa hoy, y la base solo se mueve con promover.",
          "base", "promover"),
]

e["listo"] = [
    "Cada pregunta de test del golden set corre contra la API con la llave de su persona y sin la cache, y queda en una corrida con su manifiesto que no se pisa.",
    "Lo que se puede contar se cuenta: recall@8 por documento sobre lo que llegó al prompt, fugas (tolerancia cero), citas, «no sé» y primer token, con su intervalo.",
    "Lo que no se puede contar lo califica un juez que no es el modelo de la API, calibrado contra personas (kappa y falso pase), y si no pasa no se le cree.",
    "El gate compara contra la base vigente, pregunta por pregunta, con no inferioridad y una caída máxima, y lista las preguntas que cambiaron.",
    "Bloquea un examen no comparable, con la cache o con un juez sin calibrar, y cualquier fuga.",
    "La base solo se mueve con promover, después de pasar; una regresión que se vuelve a correr se compara otra vez con la vigente.",
]

e["repaso"] = {
    "memo": f"<b>El examen corre como cada persona y sin cache; lo que se cuenta se cuenta (recall, fugas, citas, «no sé»); lo que no, lo califica un juez calibrado contra personas; y el cambio se compara con la base vigente, pregunta por pregunta, con un margen y una caída máxima, leyendo las que cambiaron.</b> En el dojo: base con recall {REC} y {BIEN}/51 correctas; bajar el umbral sube el recall e inventa en 2 (bloquea); 2 chunks empatan en exactitud y pierden recall (bloquea); el juez de 4B, kappa {N['K4']} y falso pase {N['FP4P']}.",
    "trampa": "Creerle a un número sin saber qué tan fino es. Un 78 % de 51 preguntas es «entre 65 y 88»; un juez que acuerda 80 % puede no ver nada; un empate de 38 contra 38 puede ser 6 respuestas distintas; un examen con la cache mide la versión de antes; un margen que se afloja deja pasar todo; y comparar contra la última corrida deja que la calidad baje de a poco. Se atrapa con la kappa y el falso pase, con la prueba pareada, con el manifiesto y leyendo las preguntas que cambiaron.",
    "entrevista": [
        {"q": "¿Cómo decides si un cambio al RAG puede salir?", "a": "Con un gate: corro el golden set de test contra el sistema completo, con cada pregunta hecha como su persona y sin caches, y comparo contra la corrida de la versión en producción en las mismas preguntas. Bloquea cualquier fuga de permisos, un juez sin calibrar o un examen no comparable; y para recall y exactitud uso no inferioridad pareada con un margen que sale del tamaño del examen, más una caída máxima observada. Siempre leo las preguntas que cambiaron."},
        {"q": "¿Cómo sabes que tu LLM-juez califica bien?", "a": f"Lo calibro contra respuestas que calificaron personas, con la misma rúbrica: acuerdo, kappa de Cohen (porque un juez que aprueba todo acuerda mucho por azar) y sobre todo falso pase, la fracción de malas que aprueba. En mi dojo, el modelo de 0.6B de la API como juez dio kappa {N['K06']}; uno de 4B, {N['K4']} con falso pase {N['FP4P']}. Si cambio el modelo, la cuantización o la rúbrica, es otro juez y lo vuelvo a calibrar."},
        {"q": "Tu examen tiene 51 preguntas. ¿Qué caída puedes detectar?", "a": "Con 10 % de respuestas que cambian, el error de la diferencia pareada es √(0.10 ÷ 51) ≈ 4.4 puntos, y el margen que se puede proteger es ≈ 2.5 veces eso: ≈ 11 puntos. Por eso uso un margen de 10 y además una caída máxima de 3 puntos observados, y leo las que cambiaron. Con 600 preguntas el margen baja a ≈ 3; si un área importa, le escribo más preguntas a esa área."},
        {"q": "¿Por qué pareado y no comparar dos porcentajes?", "a": "Porque son las mismas preguntas: las que las dos versiones aciertan o fallan no dicen nada; solo cuentan las que cambiaron. Si no cambia ninguna, la diferencia es 0 con error 0. Comparando dos porcentajes de 51 como si fueran muestras independientes, el error es ≈ 8 puntos y bloqueas hasta un cambio que no hace nada."},
        {"q": "Un cambio sube el recall y el gate lo bloquea. ¿Cómo lo explicas?", "a": f"Me pasó con bajar el umbral del «no sé»: el recall subió ({UM_REC}) porque contesta preguntas que antes rechazaba, pero el modelo inventó en dos sin respuesta (un teléfono, una tarifa). Exactitud {UM_EX}. Recall dice si llegó la fuente; no si la respuesta es correcta ni si debió contestar. Por eso mido las dos cosas en el mismo examen."},
        {"q": "¿Qué te puede engañar en un examen de evaluación?", "a": "Una cache que devuelve el retrieval de antes (el cambio sale idéntico a la base), mezclar dev con test, un juez que es el mismo modelo que contesta, comparar contra la última corrida en vez de la base, un golden set que cambió de versión en medio y un margen que se afloja cuando estorba. Lo cubro con el manifiesto, un examen sin cache que el gate revisa, la calibración del juez y una base que solo se mueve al promover."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/rag-gate/CLAUDE.md",
    "guiado": "content/estaciones/rag-gate/prompts/guiado.md",
    "solo": "content/estaciones/rag-gate/prompts/solo.md",
    "romper_ayuda": "content/estaciones/rag-gate/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/rag-gate/prompts/romper-solo.md",
}

(APP / "content/estaciones/rag-gate.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)))
