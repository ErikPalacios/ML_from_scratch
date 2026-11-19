"""Arma content/estaciones/c01-request.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e11 <venv> && bash probar-fallas.sh /tmp/e11 <venv>   # deja /tmp/e11.log y /tmp/e11.fallas.log
    python3 contenido.py /tmp/e11                                            # escribe el JSON con esas salidas
    python3 contenido.py /tmp/e11 --borrador                                 # lo escribe aunque falten secciones
    python3 contenido.py /tmp/e11 --fallas /tmp/e10                          # una falla que no se metió en e11, de otra corrida

Ninguna salida se copia a mano: cada `salida` sale de un comando de una sección «### nombre» de los logs.
- <carpeta>.log: los pasos 0 a 9 del Guiado («### paso N: …», cada comando como «$ comando» y su salida). La función
  recargar() de probar.sh no escribe su «$»: su salida empieza con «Checking /etc/prometheus/prometheus.yml» y aquí se
  vuelve el comando `python mundo/recargar.py prometheus`, que es lo que corre.
- <carpeta>.fallas.log: «### <falla> <etapa>», cada sección directamente con su salida. Una falla cuenta solo si su
  sección «romper» dice que se metió («falla: <id> ·»); si no (otra seguía activa), sus secciones salen de la corrida
  de --fallas, si se dio y ahí sí se metió, o faltan.
El código de los pasos sale de los archivos de la solución (gateway/app/rastro.py, observabilidad/*, diario/a_parquet.py),
de pasos.py (rastro 1 y 3: las versiones de los pasos) y del kit (romper.py, probar.sh), nunca escrito aquí.
Solo usa la biblioteca estándar: pasos.py importa yaml, pero su rastro() no lo usa.
"""
import ast
import importlib.util
import json
import re
import sys
import types
from pathlib import Path

argv = sys.argv[1:]
OTRA = Path(argv.pop(argv.index("--fallas") + 1)) if "--fallas" in argv and argv.index("--fallas") + 1 < len(argv) else None
args = [a for a in argv if not a.startswith("--")]
BORRADOR = "--borrador" in sys.argv
CARPETA = Path(args[0]) if args else sys.exit("uso: python3 contenido.py <carpeta de probar.sh> [--borrador]")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
KIT = APP / "kits" / "c01-request"
RUTA = str(CARPETA)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
FALTAN = []


def leer(p: Path) -> str:
    return p.read_text() if p.exists() else ""


def limpiar(t: str) -> str:
    t = ANSI.sub("", t)
    base = str(Path(RUTA).parent).removeprefix("/private")   # cualquier corrida de la misma carpeta (p11, p12…)
    t = re.sub(r"(/private)?" + re.escape(base) + r"/[A-Za-z0-9_-]+", "~/c01-request", t)
    lineas = [ln.rstrip() for ln in t.split("\n")
              if not re.match(r"^(user|sys)\s+[\dms.]+$", ln.strip()) and not re.match(r"^\[código \d+\]$", ln.strip())]
    return "\n".join(lineas)


def secciones(texto: str) -> dict:
    out = {}
    for m in re.finditer(r"^### ([^\n]+)\n(.*?)(?=^### |\Z)", limpiar(texto), re.S | re.M):
        out[m.group(1).strip()] = m.group(2)
    return out


RECARGAR_P = "python mundo/recargar.py prometheus"


def comillas(t: str) -> int:
    return len(re.findall(r'(?<!\\)"', t))


def comandos(cuerpo: str) -> list:
    out, cur = [], None
    for ln in cuerpo.split("\n"):
        if cur is not None and not cur[1] and comillas(cur[0]) % 2:   # un comando de varias líneas (python -c "…")
            cur[0] += "\n" + ln
        elif ln.startswith("$ "):
            cur = [ln[2:], []]
            out.append(cur)
        elif ln.startswith("Checking /etc/prometheus/prometheus.yml"):   # la salida de recargar() en probar.sh
            cur = [RECARGAR_P, [ln]]
            out.append(cur)
        elif cur is not None:
            cur[1].append(ln)
    return [(c, "\n".join(o).strip("\n")) for c, o in out]


LOG = secciones(leer(Path(f"{CARPETA}.log")))
LOGF = secciones(leer(Path(f"{CARPETA}.fallas.log")))
LOGF2 = secciones(leer(Path(f"{OTRA}.fallas.log"))) if OTRA else {}


def falta(que: str) -> str:
    FALTAN.append(que)
    if not BORRADOR:
        sys.exit(f"✗ falta {que}")
    return "(pendiente: " + que + ")"


def seccion(nombre: str):
    """La sección del log del Guiado cuyo nombre empieza con `nombre` («paso 3» encuentra «paso 3: lo que suma…»)."""
    k = next((k for k in LOG if k == nombre or k.startswith(nombre + ":")), None)
    return LOG[k] if k else None


def S(sec: str, empieza: str, n: int = 0, exacto: bool = False):
    """(comando, salida) del n-ésimo comando de la sección que empieza con `empieza` (o que es `empieza`, con exacto)."""
    cuerpo = seccion(sec)
    if cuerpo is None:
        return empieza, falta(f"la sección «{sec}» en {CARPETA.name}.log")
    xs = [(c, o) for c, o in comandos(cuerpo) if (c == empieza if exacto else c.startswith(empieza))]
    if len(xs) <= n:
        return empieza, falta(f"el comando «{empieza}…» (#{n + 1}) en «{sec}»")
    return xs[n]


def O(sec: str, empieza: str, n: int = 0, filtro=None, quitar=None, max_lineas=None, exacto=False) -> str:
    out = S(sec, empieza, n, exacto)[1]
    lineas = out.split("\n")
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).strip("\n")


def metida(secs: dict, falla_id: str) -> bool:
    """¿romper.py metió de verdad esta falla en esa corrida? (si otra seguía activa, la rechaza y lo demás no sirve)"""
    return f"falla: {falla_id} ·" in secs.get(f"{falla_id} romper", "")


USADAS = {}


def F(nombre: str, filtro=None, quitar=None) -> str:
    fid = nombre.split()[0]
    secs = LOGF if metida(LOGF, fid) or not LOGF2 else LOGF2 if metida(LOGF2, fid) else LOGF
    if not metida(secs, fid) and fid in ROMPER_IDS:
        return falta(f"la falla «{fid}» bien metida en {CARPETA.name}.fallas.log" + (f" o en {OTRA.name}.fallas.log" if OTRA else " (o --fallas <otra corrida>)"))
    if nombre not in secs:
        return falta(f"la sección «{nombre}» en {CARPETA.name}.fallas.log")
    USADAS[fid] = CARPETA.name if secs is LOGF else OTRA.name
    lineas = secs[nombre].strip("\n").split("\n")
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    return "\n".join(lineas).strip("\n")


def num(texto: str, rx: str, todas=False):
    """El primer (o el último, con todas=True) número que atrapa `rx`, como float; None si no está (en borrador)."""
    ms = re.findall(rx, texto or "", re.M)
    if not ms:
        if BORRADOR or (texto or "").startswith("(pendiente"):
            return None
        sys.exit(f"✗ no encontré {rx!r} en:\n{(texto or '')[:400]}")
    v = ms[-1] if todas else ms[0]
    if isinstance(v, tuple):
        v = v[0]
    return float(str(v).replace(",", ""))


def dos(texto: str, rx: str):
    """Los dos números de una línea (p50 y p99, por ejemplo); (None, None) si no está (en borrador)."""
    m = re.search(rx, texto or "", re.M)
    if not m:
        if BORRADOR or (texto or "").startswith("(pendiente"):
            return None, None
        sys.exit(f"✗ no encontré {rx!r} en:\n{(texto or '')[:400]}")
    return float(m.group(1)), float(m.group(2))


def txt(texto: str, rx: str, todas=False) -> str:
    ms = re.findall(rx, texto or "", re.M)
    return (ms[-1] if todas else ms[0]) if ms else "?"


def f_(x, fmt="{:,.0f}") -> str:
    """Un número formateado, o «?» si todavía no salió en los logs."""
    return "?" if x is None else fmt.format(x)


def mul(*xs):
    """El producto, o None si falta alguno (en borrador)."""
    out = 1.0
    for x in xs:
        if x is None:
            return None
        out *= x
    return out


def code(rel: str, base: Path = SOL) -> str:
    return (base / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def C(sec, empieza, n=0, nota="", code_=None, exacto=False, **kw):
    """Un comando del log tal como se corrió (o con `code_` si se muestra distinto) y su salida real."""
    c, _ = S(sec, empieza, n, exacto)
    return cmd(code_ or c, O(sec, empieza, n, exacto=exacto, **kw), nota)


def segundos(real: str):
    m = re.search(r"real\s+(\d+)m([\d.]+)s", real or "")
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


V = "python verificar.py"
ROMPER_IDS = set(re.findall(r'^    "([a-z0-9-]+)": dict\(', (KIT / "romper.py").read_text(), re.M))
QV = r"\}\s+(-?[\d.]+(?:e[-+]?\d+)?)$"          # el valor de una línea de q: «{…} 4.56»

# ---------------------------------------------------------------- el código, de los archivos
PROBAR = code("probar.sh")
PROBARF = code("probar-fallas.sh")
Q_FUNC = re.search(r"^q\(\) \{.*?; \}$", PROBAR, re.S | re.M).group(0)
FINAL = code("gateway/app/rastro.py")
REGLAS = code("observabilidad/reglas.yml")
PROM = code("observabilidad/prometheus.yml")


def _pasos():
    """pasos.py de la solución, cargado sin PyYAML (su rastro() no lo usa; reglas() sí, y aquí no se llama)."""
    puesto = "yaml" not in sys.modules
    if puesto:
        sys.modules["yaml"] = types.ModuleType("yaml")
    spec = importlib.util.spec_from_file_location("pasos_solucion", SOL / "pasos.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    if puesto:
        del sys.modules["yaml"]
    return m


PASOS = _pasos()
RASTRO1, RASTRO3 = PASOS.rastro(1), PASOS.rastro(3)


def bloque_regla(nombre: str) -> str:
    i = REGLAS.index(f"      - alert: {nombre}")
    j = REGLAS.find("      - alert:", i + 1)
    return REGLAS[i:j if j > 0 else None].rstrip("\n")


def funcion_py(t: str, firma: str) -> str:
    """Una función (o método) de un archivo de Python, desde su firma hasta la línea en blanco que la cierra."""
    i = t.index(firma)
    m = re.search(r"\n\n|\Z", t[i:])
    return t[i:i + m.start()].rstrip("\n")


REGLAS5 = REGLAS[:REGLAS.index("      - alert: GatewaySinLectura")].rstrip("\n")
TRAMPA = "\n".join(ln for ln in (PROM.replace("descubrimiento/pods.json", "descubrimiento/servicios.json") +
                                 "\n      - {source_labels: [__meta_kubernetes_service_name], target_label: service}").split("\n")
                   if "servicios.json" in ln or "service_name" in ln)

# los bordes de los histogramas del contrato (de la solución) y las categorías del modelo (del kit)
_cons = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(FINAL).body
         if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ("MS", "SCORE", "BYTES")}
B_MS, B_SC, B_BY = len(_cons["MS"]), len(_cons["SCORE"]), len(_cons["BYTES"])
N_LABELS = len(json.loads((KIT / "servir" / "modelo.json").read_text())["labels"])
SER_CONTADOR = 2 * 11 * 4
SER_LAT, SER_PRE, SER_SC, SER_BY = (B_MS + 4) * 4, B_MS + 4, B_SC + 4, (B_BY + 4) * 4
SER_TOTAL = SER_CONTADOR + SER_LAT + 2 * SER_PRE + SER_SC + SER_BY + 2 * N_LABELS + 1

# ---------------------------------------------------------------- los números que salen de los logs
CREAR = O("paso 0", "time python mundo/crear.py")
CREAR_S = num(CREAR, r"el mundo está arriba en (\d+) s")
AYER_N = num(CREAR, r"([\d,]+) requests en [\d,]+ archivos")
AYER_F = num(CREAR, r"requests en ([\d,]+) archivos")
AYER_DUP = num(CREAR, r"\((\d+) subidos dos veces\)")
VERDE0 = num(O("paso 0", "python verificar.py", exacto=True), r"^(\d+)/12 en verde")

LINEA_B = num(O("paso 1", "python verificar.py request-id"), r"stdout \((\d+) B\)")

CARGA2 = O("paso 2", "python mundo/carga.py")
REL = O("paso 2", "python mundo/relojes.py")
REL_N = num(REL, r"^(\d+) requests con los tres relojes")
B50, B99 = dos(REL, r"^backend\s+([\d.]+)\s+([\d.]+)")
A50, A99 = dos(REL, r"^ALB \(TargetResponseTime\)\s+([\d.]+)\s+([\d.]+)")
G50, G99 = dos(REL, r"^gateway \(ms\.total\)\s+([\d.]+)\s+([\d.]+)")
DBA50, DBA99 = dos(REL, r"^backend − ALB.*?\s([\d.]+)\s+([\d.]+)\s+ms$")
DAG50, DAG99 = dos(REL, r"^ALB − gateway.*?\)\s+([\d.]+)\s+([\d.]+)\s+ms$")

SER3A = num(O("paso 3", "curl -s localhost:8951/metrics | grep -c", 0), r"^(\d+)$")
SER3B = num(O("paso 3", "curl -s localhost:8951/metrics | grep -c", 1), r"^(\d+)$")
SER_HOY = num(O("paso 9", V, exacto=True), r"≤ (\d+) series classifier_")

DOBLE = O("paso 4", "q 'count by (pod)")
DOBLE_N = num(DOBLE, QV)
R_DOBLE = num(O("paso 4", "q 'sum(rate(classifier_requests_total[30s]))'", 0), QV)
A_DOBLE = num(O("paso 4", "q 'sum(rate(alb_request_count_total[30s]))'", 0), QV)
R_OK = num(O("paso 4", "q 'sum(rate(classifier_requests_total[30s]))'", 1), QV)
A_OK = num(O("paso 4", "q 'sum(rate(alb_request_count_total[30s]))'", 1), QV)
_porn = O("paso 4", "q 'count by (__name__)")
SERIES_P = sum(int(x) for x in re.findall(r"\}\s+(\d+)$", _porn, re.M)) if not _porn.startswith("(pendiente") else None

POD_A = txt(O("paso 5", "python mundo/nodo.py matar a"), r"contenedor de (\S+)")
_antes, _despues = O("paso 5", "q 'sum by (pod)", 0), O("paso 5", "q 'sum by (pod)", 1)
A_ANTES = num(_antes, r'pod="' + re.escape(POD_A) + r'"\}\s+(\d+)')
A_DESPUES = num(_despues, r'pod="' + re.escape(POD_A) + r'"\}\s+(\d+)')
SUMRATE = num(O("paso 5", "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m]))'"), QV)
RATESUM = num(O("paso 5", "q 'rate(sum("), QV)
P99_5 = num(O("paso 5", "q 'classifier:latencia:p99_1m'"), QV)
FRAC200 = num(O("paso 5", "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m])) / "), QV)

CARGA6 = O("paso 6", "python mundo/carga.py")
N6 = num(CARGA6, r"^(\d+) requests en")
EXS = O("paso 6", "python -c")
EXN = num(EXS, r"^(\d+) exemplars")
EX_MAX = num(EXS, r"^\s*([\d.]+) ms")
EX_LES = sorted(set(re.findall(r"le=(\S+)", EXS)), key=lambda s: float(s) if s[0].isdigit() else 9e9)
EX_ESP = (N6 + 5 * 120) * 0.01 if N6 is not None else None

OBJ7 = O("paso 7", "python -c")
KB7 = num(OBJ7, r" (\d+) B$")
CARGA7 = O("paso 7", "python mundo/carga.py")
N7 = num(CARGA7, r"^(\d+) requests en")
SEG7 = num(CARGA7, r"requests en (\d+) s")
COD7 = txt(CARGA7, r"códigos: (.*)$")
VIG7 = num(O("paso 7", "q 'time() - dojo", 1), QV, todas=True)
SUBIDOS7 = len(re.findall("Successfully uploaded", O("paso 7", "docker compose logs fluent-bit-a --since 30s")))
ERR7 = num(O("paso 7", "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc", 1),
           r'^fluentbit_output_errors_total\{name="s3.0"\} (\d+)')
STALE7 = "LogsStale" in O("paso 7", "curl -s localhost:9952/api/v1/alerts")

P8 = O("paso 8", "time python diario/a_parquet.py")
OBJ8 = num(P8, r"(\d[\d,]*) objetos")
REG8 = num(P8, r"([\d,]+) registros")
REP8 = num(P8, r"([\d,]+) repetidos")
IGN8 = num(P8, r"([\d,]+) ignorados")
TOT8 = num(P8, r"^total: ([\d,]+) filas")
POR_V8 = re.findall(r"model_version=(\S+)/parte-0\.parquet\s+([\d,]+) filas", P8)
T8 = segundos(P8)

CARGA9 = O("paso 9", "python mundo/carga.py")
N9 = num(CARGA9, r"^(\d+) requests en")
SEG9 = num(CARGA9, r"requests en (\d+) s")
COD9 = txt(CARGA9, r"códigos: (.*)$")
ELB9 = num(O("paso 9", "q 'sum(rate(alb_httpcode_elb_total"), QV)
GW9 = num(O("paso 9", "q 'sum(rate(classifier_requests_total[1m]))'"), QV)
_err9 = O("paso 9", "q 'classifier:errores_servidor:ratio_rate1m'")
ERR9 = num(_err9, QV) if re.search(QV, _err9, re.M) else None
AL9 = O("paso 9", "curl -s localhost:9952/api/v1/alerts", 0)
PEND9 = bool(re.search(r"^ClassifierHigh5xxRate pending", AL9, re.M))
VERDE9 = num(O("paso 9", V, exacto=True), r"^(\d+)/12 en verde")

# las fallas: lo que dejó probar-fallas.sh
DEBUG_N = num(F("etiqueta-sin-techo metrics"), r"^(\d+)$")
DEBUG_P = num(F("etiqueta-sin-techo prometheus"), r"^\{\}\s+(\d+)$")


def campos_romper() -> dict:
    """Los títulos, historias y explicaciones de romper.py (el diccionario FALLAS), leídos con ast: lo que verá la persona."""
    arbol = ast.parse(code("romper.py", KIT))
    for n in arbol.body:
        if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "FALLAS":
            out = {}
            for k, v in zip(n.value.keys, n.value.values):
                out[k.value] = {kw.arg: kw.value.value for kw in v.keywords if isinstance(kw.value, ast.Constant)}
            return out
    sys.exit("✗ no encontré FALLAS en romper.py")


ROMPER = campos_romper()

# ---------------------------------------------------------------- la estación
e = {
    "id": "request", "patron": "sincrono", "caso": "c01", "num": 11,
    "titulo": "La request en vivo", "nav": "La request en vivo",
    "pregunta": "La release 15 ya atiende el 100 % del tráfico y contesta bien, pero no deja rastro: mañana nadie podría decir qué contestó, con qué versión ni qué tan rápido. ¿Qué tiene que quedar escrito de cada request (su nombre, una línea de log, sus sumas en las métricas y, a veces, un exemplar), cómo llega cada rastro a donde alguien lo puede leer sin frenar nunca la respuesta, y quién ve lo que pasa antes de que la request llegue al gateway?",
    "version": "2026-11-18",
}

e["mapa"] = {
    "resumen": "La estación 10 dejó la release 15 al 100 %, pero así como viene el gateway contesta y olvida. Aquí cada request recibe un <b>nombre</b> (su <code>request_id</code>, de punta a punta), deja una <b>línea de log</b> de ≈ 300 B en stdout y <b>suma</b> en las métricas: contadores, un gauge e histogramas con nombres que no cambian. <b>Prometheus</b> lee cada pod una sola vez, guarda las consultas de todos los días y evalúa las alertas; <b>Fluent Bit</b> lleva el log del disco de cada nodo a <b>S3</b> cada minuto, y un job diario lo pasa a <b>Parquet</b>. Al final miras lo que el gateway no ve: el ALB contestando él mismo.",
    "entra": [
        "la release 15 (<code>resnet50-2026-11-01</code>) al 100 %: dos pods del gateway, uno en cada nodo, y su Triton, detrás del ALB",
        "un gateway que contesta bien pero no deja rastro: <code>gateway/app/rastro.py</code> no guarda el id, no escribe ninguna línea y no suma nada",
        "Prometheus, Fluent Bit y el S3 corriendo, todavía sin configurar para el gateway, y el log de ayer ya subido",
        "las reglas de otros equipos: los nombres de las métricas (estaciones 6 y 10), las etiquetas de los pods y el ALB",
    ],
    "sale": [
        "cada request con su <code>request_id</code> en la respuesta, en su línea de log y, en ≈ 1 %, como exemplar en la latencia",
        "una línea de JSON compacto por request en el disco del nodo, en S3 cada minuto y en Parquet al día siguiente, partido por versión",
        "las 8 métricas del contrato, leídas por Prometheus una vez por pod, con 3 recording rules y 5 alertas",
        "la prueba de que el monitoreo tiene puntos ciegos: con Triton caído, el gateway no ve nada y solo el ALB lo cuenta",
    ],
    "escala": [
        {"que": "El tráfico", "c01": "≈ 10 M requests al día: ≈ 116 por segundo en promedio, ≈ 350 en el pico", "taller": "5 fotos por segundo de siempre (los tres callers) y la carga que mandes con <code>mundo/carga.py</code>"},
        {"que": "Pods y nodos", "c01": "de 3 a 12 pods del gateway en nodos de EKS, en dos zonas", "taller": "2 pods, uno en cada nodo: dos contenedores de Docker (<code>nodo-a</code>, <code>nodo-b</code>) con su runtime"},
        {"que": "El log", "c01": "≈ 300 B por request: ≈ 3 GB al día, 90 días en S3 (≈ 270 GB, ≈ US$6 al mes)", "taller": f"{f_(LINEA_B)} B por request; el log de ayer: {f_(AYER_N)} requests en {f_(AYER_F)} archivos"},
        {"que": "Quién lo sube", "c01": "Fluent Bit como DaemonSet: sube cada 5 min, con 1 GB de buffer por nodo", "taller": "un Fluent Bit 5.1.5 por nodo: sube cada minuto, con 256 MB de buffer y <code>retry_limit 60</code>"},
        {"que": "Prometheus", "c01": "kube-prometheus-stack: lee cada 15 s con un PodMonitor; ventanas de 5 min", "taller": "Prometheus v3.15.1 en <code>localhost:9952</code>: lee cada 5 s con <code>file_sd_configs</code> sobre <code>pods.json</code>; ventanas de 1 min"},
        {"que": "Las alertas", "c01": "5xx, p99, LogsStale a los 30 min y ALB5xx en CloudWatch", "taller": "las mismas 5 en tu <code>reglas.yml</code>: LogsStale a los 3 min, ALB5xx con las métricas del ALB del dojo"},
        {"que": "Trazas", "c01": "≈ 1 % con OpenTelemetry y Grafana Tempo; los exemplars llevan a la traza", "taller": "≈ 1 % como exemplar (el <code>request_id</code> como trace_id), sin trazas completas: del exemplar a la línea con <code>mundo/buscar.py</code>"},
        {"que": "El almacén", "c01": "Amazon S3, bucket <code>ml-datos</code>, con KMS y un rol que solo escribe en <code>logs/</code>", "taller": "RustFS 1.0.4 en <code>localhost:9950</code>: el mismo bucket y las mismas rutas"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-request",
}

# ---------------------------------------------------------------- precálculos
DIA_MB = mul(432_000, LINEA_B, 1e-6)
NODO_MB_H = mul(2.5, LINEA_B, 3600, 1e-6)
AGUANTE_H = (256 / NODO_MB_H) if NODO_MB_H else None
MUESTRAS_D = mul(SERIES_P, 17_280)

e["precalculos"] = {
    "intro": "Antes de escribir, las cuentas de servilleta: cuánto pesa el log y cuánto cuesta, cuánto mide la misma request en cada reloj, cuántas series deja el gateway (y cuántas con un id por request), cuántas muestras guarda Prometheus, qué tasa sale con un reinicio, cuántas lentas tienen exemplar, cuánto aguanta el buffer si S3 se cae, cuántas filas sobran sin quitar repetidos y qué pasa cuando contesta el ALB. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "volumen-log", "pregunta": "¿Cuánto pesa el log de un día, cuánto cuesta guardarlo y en cuántos archivos llega?",
            "formula": "bytes al día = requests al día × bytes por línea · guardado = bytes al día × días · costo = guardado × precio por GB al mes · archivos al día por nodo = segundos del día ÷ segundos entre subidas",
            "c01": {"cuenta": "10,000,000 × 300 B = 3 GB al día; 90 días: 3 × 90 = 270 GB; a US$0.023 por GB al mes, 270 × 0.023 ≈ US$6 (sin contar la compresión de gzip, que lo baja). Con una subida cada 5 min: 86,400 ÷ 300 = 288 archivos al día por nodo", "valor": "≈ 3 GB al día · ≈ US$6 al mes · 288 archivos por nodo"},
            "taller": {"cuenta": f"5 fotos/s × 86,400 s = 432,000 requests al día × {f_(LINEA_B)} B ≈ {f_(DIA_MB)} MB al día; con una subida por minuto, 86,400 ÷ 60 = 1,440 archivos al día por nodo. El log de ayer que dejó el mundo: {f_(AYER_N)} requests en {f_(AYER_F)} archivos", "valor": f"≈ {f_(DIA_MB)} MB al día · 1,440 archivos por nodo"},
            "decide": "Que guardar el 100 % del log es barato (≈ US$6 al mes contra ≈ US$1.8k de toda la infraestructura del clasificador) y por eso no se muestrea: la falla callada de un modelo, un 200 con una sugerencia mala, solo se ve uniendo cada línea con lo que eligió la persona. Lo que no se guarda es la foto: a ≈ 200 KB serían 2 TB al día. Y como cada byte de la línea se paga 10 millones de veces al día, va en JSON compacto, sin hora y sin espacios.",
            "conceptos": ["linea-log"],
            "comprueba": C("paso 1", "python verificar.py request-id linea-log", nota="verificar.py mide una línea real del disco del nodo: sus bytes, con el salto de línea."),
            "confirma": f"el paso 8: el job leyó el día de ayer, {f_(REG8)} registros en {f_(OBJ8)} objetos.",
        },
        {
            "id": "tres-relojes", "pregunta": "¿Cuánto mide la misma request en cada reloj, y dónde se va la diferencia?",
            "formula": "reloj del ALB = reloj del gateway + red entre el ALB y el pod · reloj del backend = reloj del ALB + lo que tarda el ALB en sus cuentas + la red entre el backend y el ALB",
            "c01": {"cuenta": "la foto de Ana: 20 ms en el gateway; con ≈ 1 ms de red al pod, 20 + 1 ≈ 21 en el ALB; con ≈ 2 ms de entrada (TLS, revisar el token y la red del backend), 21 + 2 ≈ 23 en el backend", "valor": "20 · ≈ 21 · ≈ 23 ms"},
            "taller": {"cuenta": f"{f_(REL_N)} requests con los tres relojes, en p50: gateway {f_(G50, '{:g}')} ms, ALB {f_(A50, '{:g}')} ms, backend {f_(B50, '{:g}')} ms. ALB − gateway ≈ {f_(DAG50, '{:g}')} ms (la red al pod y lo que el gateway no ve) y backend − ALB ≈ {f_(DBA50, '{:g}')} ms", "valor": f"{f_(G50, '{:g}')} · {f_(A50, '{:g}')} · {f_(B50, '{:g}')} ms (p50)"},
            "decide": "A qué reloj se le promete qué: el SLO de C01 (p99 ≤ 200 ms) es del lado del servidor, con el reloj del gateway; el backend vive con su timeout de 300 ms; el ALB ve lo que pasa antes del gateway. En el dojo cada salto pesa ≈ 4 ms (la red de Docker Desktop y un ALB escrito en Python); en C01, 1 o 2. Ningún reloj miente: si el backend se queja y el gateway dice que va rápido, el tiempo se fue fuera del gateway.",
            "conceptos": ["tres-relojes"],
            "comprueba": C("paso 2", "python mundo/relojes.py", nota="Los tres relojes de las mismas requests, unidos por request_id."),
            "confirma": "el paso 1: <code>mundo/carga.py --una</code> muestra los tres relojes de una sola request.",
        },
        {
            "id": "series-por-pod", "pregunta": "¿Cuántas series deja el gateway en Prometheus, y cuántas si el request_id fuera etiqueta?",
            "formula": "series de un histograma = (bordes + 4) × combinaciones de etiquetas · de un contador = 2 × combinaciones · con un id por request: series nuevas = (bordes + 4) × requests",
            "c01": {"cuenta": "239 por pod si aparecen todas las combinaciones (88 del contador con 11 códigos × 4 fuentes, 60 de la latencia, 52 de los bytes…); con 3 pods ≈ 720, con 12 ≈ 2,900. Con el request_id en la latencia: 15 × 10,000,000 = 150 millones de series nuevas al día", "valor": "239 por pod · 150 M nuevas al día con el request_id"},
            "taller": {"cuenta": f"el contrato del dojo por pod: contador 2 × 11 códigos × 4 fuentes = {SER_CONTADOR}; latencia ({B_MS} + 4) × 4 = {SER_LAT}; preproceso e inferencia {SER_PRE} cada uno; score ({B_SC} + 4) = {SER_SC}; bytes ({B_BY} + 4) × 4 = {SER_BY}; categorías 2 × {N_LABELS} = {2 * N_LABELS}; en vuelo, 1: {SER_TOTAL} si aparecieran los 11 códigos. Al final del Guiado, el pod con más tenía {f_(SER_HOY)}. Con el request_id: 15 × 5 fotos/s = 75 series nuevas por segundo, ≈ 6.5 millones al día", "valor": f"≈ {SER_TOTAL} por pod (tope de verificar.py: 400) · 75 nuevas por segundo con el request_id"},
            "decide": "Qué puede ser etiqueta: solo lo que tiene una lista corta y conocida de valores. <code>source</code> se reduce a 4 aunque el header traiga cualquier texto; el <code>request_id</code> va al log y al exemplar, nunca a una etiqueta. verificar.py pone el tope en 400 por pod: si algo crece sin techo, lo ve.",
            "conceptos": ["cardinalidad", "histograma"],
            "comprueba": C("paso 3", "curl -s localhost:8951/metrics | grep -c", n=1, nota=f"Después de 10 s de un caller con un X-Client-Source distinto en cada request: de {f_(SER3A)} a {f_(SER3B)} series, por la fuente <code>other</code> que apareció, y ya no crece."),
            "confirma": f"la falla «{ROMPER['etiqueta-sin-techo']['titulo']}» de Romper: un histograma con la etiqueta request_id dejó {f_(DEBUG_N)} buckets en un pod con 20 s de carga.",
        },
        {
            "id": "muestras-prometheus", "pregunta": "¿Cuántas muestras guarda Prometheus al día por el gateway?",
            "formula": "muestras por serie al día = 86,400 ÷ segundos entre lecturas · muestras al día = series × muestras por serie",
            "c01": {"cuenta": "86,400 ÷ 15 = 5,760 por serie; 717 series (3 pods) × 5,760 ≈ 4.1 millones al día; en 15 días de retención, ≈ 62 millones", "valor": "5,760 por serie · ≈ 4.1 M al día"},
            "taller": {"cuenta": f"86,400 ÷ 5 = 17,280 por serie; las {f_(SERIES_P)} series classifier_* que Prometheus guardaba de los 2 pods en el paso 4 × 17,280 ≈ {f_(mul(MUESTRAS_D, 1e-6), '{:.1f}')} millones al día", "valor": f"17,280 por serie · ≈ {f_(mul(MUESTRAS_D, 1e-6), '{:.1f}')} M al día"},
            "decide": "Cada cuánto leer: más seguido da más resolución y cuesta más memoria y disco. C01 lee cada 15 s; el dojo cada 5 s para no esperar (una ventana de 1 min junta 12 lecturas). Y por qué se vigilan las series: el costo es series × lecturas, y las series son lo que puede crecer sin techo.",
            "conceptos": ["scrape"],
            "comprueba": C("paso 4", "q 'count by (__name__)", nota="Las series del gateway en Prometheus, por nombre: cada histograma con sus _bucket, _count, _sum y _created."),
        },
        {
            "id": "tasa-reinicio", "pregunta": "Si un pod se reinicia, ¿qué tasa da sacar la tasa primero y qué tasa da sumar primero?",
            "formula": "tasa = suma de los aumentos de cada serie ÷ ventana; un contador que baja se lee como reinicio y cuenta su valor nuevo",
            "c01": {"cuenta": "un pod leído cada 15 s: 1,000,000 · 1,000,540 · 1,001,080 · 120 · 660; aumentos 540 + 540 + 120 + 540 = 1,740 en 60 s = 29 por segundo. La resta ingenua, (660 − 1,000,000) ÷ 60, da ≈ −16,656", "valor": "29 por segundo, no −16,656"},
            "taller": {"cuenta": f"el paso 5 mata el contenedor del pod del nodo a: su contador de 200 pasa de {f_(A_ANTES)} a {f_(A_DESPUES)}. <code>sum(rate(…[1m]))</code> = {f_(SUMRATE, '{:.1f}')} req/s; <code>rate(sum(…)[1m:5s])</code> = {f_(RATESUM, '{:.1f}')}: la suma bajó, rate() lo leyó como un reinicio de todo y volvió a contar la suma entera", "valor": f"{f_(SUMRATE, '{:.1f}')} contra {f_(RATESUM, '{:.1f}')} req/s"},
            "decide": "El orden dentro de cada recording rule: siempre <code>sum(rate(…))</code>, primero la tasa de cada serie y luego la suma. verificar.py consultas lo revisa en el texto de tu regla.",
            "conceptos": ["promql-rate"],
            "comprueba": C("paso 5", "q 'rate(sum(", nota="Primero la suma y luego la tasa, después del reinicio: un pico falso."),
            "confirma": "el paso 5: <code>resets()</code> ve el reinicio en las series del pod a y no en las del b.",
        },
        {
            "id": "exemplars-uno-por-ciento", "pregunta": "¿Cuántas requests dejan exemplar con el 1 %, y cuántas de las lentas?",
            "formula": "requests con exemplar = requests × fracción · lentas con exemplar = requests × fracción de lentas × fracción con exemplar",
            "c01": {"cuenta": "hora pico: 350 × 3,600 = 1,260,000 requests; 0.5 % lentas (más de 200 ms) = 6,300; al 1 %, 6,300 × 0.01 = 63 con traza", "valor": "≈ 63 lentas con traza por hora pico"},
            "taller": {"cuenta": f"el paso 6: {f_(N6)} requests de la carga más ≈ 600 del tráfico de siempre en la ventana de 2 min; al 1 %, ≈ {f_(EX_ESP)} con exemplar. Prometheus devolvió {f_(EXN)}: el texto de /metrics lleva a lo más un exemplar por bucket (el último), y entre dos lecturas los demás se pisan", "valor": f"≈ {f_(EX_ESP)} esperados · {f_(EXN)} en Prometheus"},
            "decide": "Que el exemplar sirve para pasar de la curva a una request de ejemplo, no para encontrar todas las lentas: con un muestreo que decide al principio (head sampling), casi ninguna lenta queda elegida. Para guardarlas todas hay que decidir al final (tail sampling), que pide juntar la request completa antes de decidir; C01 empieza con el simple.",
            "conceptos": ["exemplar"],
            "comprueba": C("paso 6", "python -c", nota="Los exemplars de los últimos 2 min, del más lento al más rápido."),
            "confirma": f"el paso 6: el exemplar más lento ({f_(EX_MAX, '{:g}')} ms) lleva a su línea con <code>mundo/buscar.py</code>.",
        },
        {
            "id": "aguante-buffer", "pregunta": "Si S3 se cae, ¿cuánto aguanta un nodo antes de perder líneas?",
            "formula": "aguante en horas = buffer del nodo ÷ lo que escribe un nodo en una hora; y nunca más que lo que Fluent Bit reintenta antes de rendirse",
            "c01": {"cuenta": "1 GB × 2 nodos × 24 h ÷ 3 GB al día = 16 h con el tráfico parejo; si todo fuera hora pico (1/8 del día), 1 ÷ (3 ÷ 8 ÷ 2) ≈ 5.3 h. LogsStale avisa a los 30 min", "valor": "≈ 16 h (≈ 5 h en pico)"},
            "taller": {"cuenta": f"un nodo recibe la mitad de las 5 fotos/s: 2.5 × {f_(LINEA_B)} B × 3,600 ≈ {f_(NODO_MB_H, '{:.1f}')} MB por hora; 256 MB ÷ {f_(NODO_MB_H, '{:.1f}')} ≈ {f_(AGUANTE_H)} h de disco. Pero con el <code>retry_limit</code> por omisión, el plugin s3 reintenta cada ≈ 5 s y a los 6 intentos se rinde: ≈ 30 s de S3 caído y el pedazo se va a cuarentena", "valor": f"≈ {f_(AGUANTE_H)} h de disco · ≈ 30 s con el retry_limit por omisión"},
            "decide": "Que el tope real no siempre es el disco: es cuántas veces reintenta Fluent Bit. Con el valor por omisión, en una prueba de la construcción del dojo, 3 min de S3 caído mandaron dos pedazos (≈ 2 min de líneas) a cuarentena y nunca llegaron a S3, con <code>fluentbit_output_retries_failed_total</code> en 0; <code>retry_limit no_limits</code> lo recorta a 5. Por eso la solución usa <code>retry_limit 60</code> (reintenta cada ≈ 18 s) y <code>verificar.py log-en-s3</code> reprueba si hubo cuarentena. LogsStale avisa mucho antes de que el disco se llene.",
            "conceptos": ["buffer-en-disco"],
            "comprueba": C("paso 7", "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc", n=1, nota="Después de volver S3: los intentos que fallaron (errors) y lo que ya entregó."),
            "confirma": f"el paso 7: con S3 apagado, las {f_(N7)} requests de la carga contestaron y, al volver, el Fluent Bit del nodo a subió {SUBIDOS7} pedazos atrasados de un jalón.",
        },
        {
            "id": "repetidos", "pregunta": "¿Cuántas filas sobrarían sin quitar los repetidos?",
            "formula": "filas repetidas = archivos subidos dos veces × líneas por archivo · líneas por archivo = requests al día ÷ (archivos al día por nodo × nodos)",
            "c01": {"cuenta": "10,000,000 ÷ (288 × 2) ≈ 17,400 líneas por archivo: cada archivo que se sube dos veces mete ≈ 17,400 filas de más", "valor": "≈ 17,400 filas de más por archivo repetido"},
            "taller": {"cuenta": f"el día de ayer: {f_(REG8)} registros leídos de {f_(OBJ8)} objetos; {f_(REP8)} repetidos (los {f_(AYER_DUP)} archivos subidos dos veces) y {f_(IGN8)} ignorados (stderr o texto suelto): {f_(REG8)} − {f_(REP8)} − {f_(IGN8)} = {f_(TOT8)} filas", "valor": f"{f_(REP8)} filas de más sin quitar repetidos"},
            "decide": "Que el job diario quita repetidos siempre, con la llave (request_id, time): Fluent Bit entrega al menos una vez. Sin eso, el join del mes contaría esas fotos dos veces y las etiquetas de entrenamiento saldrían chuecas.",
            "conceptos": ["al-menos-una-vez"],
            "comprueba": C("paso 8", "time python diario/a_parquet.py", code_="python diario/a_parquet.py", quitar=r"^real", nota="Lo que leyó, lo que quitó y lo que quedó por versión."),
        },
        {
            "id": "lo-que-contesta-el-alb", "pregunta": "Si Triton se cae 4 minutos, ¿cuántas requests contesta el ALB con 503, y qué ve el gateway?",
            "formula": "requests con 503 del ALB = tasa × segundos caído · fracción del presupuesto = esas requests ÷ las que el mes deja fallar",
            "c01": {"cuenta": "116 × 240 = 27,840 con 503 del ALB; el presupuesto de errores del mes (99.9 % de ≈ 300 M) deja fallar 300,000: 27,840 ÷ 300,000 ≈ 9.3 % en 4 minutos. El gateway cuenta 0", "valor": "27,840 · ≈ 9.3 % del presupuesto del mes"},
            "taller": {"cuenta": f"el paso 9: {f_(N9)} requests en {f_(SEG9)} s, códigos {COD9}. Prometheus: el ALB contestaba ≈ {f_(ELB9, '{:.1f}')} req/s con 503 él mismo mientras el gateway contaba {f_(GW9, '{:.2f}')} req/s", "valor": f"≈ {f_(ELB9, '{:.1f}')} req/s del ALB contra {f_(GW9, '{:.2f}')} del gateway"},
            "decide": "Que una alerta sobre las métricas del gateway no basta: hace falta la que mira lo que contesta el propio ALB (ALB5xx; en C01, en CloudWatch). Y que el presupuesto de errores se va rápido: 4 minutos de Triton caído son casi la décima parte del mes.",
            "conceptos": ["punto-ciego-alb"],
            "comprueba": C("paso 9", "curl -s localhost:8957/metrics", nota="Las métricas del ALB: sus 503 propios y cuántos destinos sanos le quedan."),
        },
    ],
}

# ---------------------------------------------------------------- conceptos
K = []


def concepto(id_, termino, en, def_, analogia, importa, trampa):
    K.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


concepto("observabilidad", "Observabilidad: los tres rastros", "observability / metrics, logs, traces",
         "Poder entender qué pasa adentro de un servicio mirando lo que deja escrito: métricas (sumas: ¿cuánto?), logs (una línea por request: ¿qué pasó con esta?) y trazas o exemplars (¿dónde se fue el tiempo?).",
         "El tablero, la bitácora y la cámara de un auto. El tablero (métricas) avisa que el motor se calienta; la bitácora (log) dice en qué viajes pasó; el video de un viaje (traza) muestra en qué subida. Video solo se graba de unos cuantos viajes: son caros.",
         "Cada rastro contesta una pregunta distinta y se usan en orden: la métrica avisa («el p99 subió a las 14:05»), el exemplar lleva a una request de ejemplo y el log dice cuántas se parecen y qué tienen en común. Los une el <code>request_id</code>. Para un modelo hay algo más: un 200 con una sugerencia mala no se ve en ninguna métrica de servicio, solo en el log, uniendo cada predicción con lo que eligió la persona. Por eso C01 guarda el log del 100 % de las requests.",
         "Creer que con métricas basta. Las métricas no recuerdan ninguna request: con ellas sabes que algo va mal, no a quién le pasó ni qué contestó el modelo.")
concepto("request-id", "request_id de punta a punta", "request ID / correlation ID / X-Request-ID / UUID v4",
         "El nombre único de cada request: el X-Request-ID del caller si es sano, o un UUID versión 4 nuevo. Vuelve en la respuesta y va en el log y en el exemplar: es la llave para unir lo que dejó en cada lugar.",
         "El número de guía de un paquete: el remitente, la bodega y el repartidor anotan cosas distintas en sus propias libretas, pero con el mismo número cualquiera junta la historia completa sin saber en qué camión viajó.",
         "Sin él, unir el log del backend, el access log del ALB y la línea del gateway sería adivinar por la hora, y con 116 fotos por segundo eso falla. Respetar el id del caller hace que backend y gateway llamen igual a la misma request. Un UUID v4 son 122 bits al azar: dos pods inventan ids al mismo tiempo sin chocar y sin preguntarle a nadie.",
         "Copiar cualquier X-Request-ID que llegue: uno de 80 caracteres o con un salto de línea ensucia el log (o lo parte en dos). Y ponerlo como etiqueta de una métrica: una serie nueva por request.")
concepto("linea-log", "La línea de log: JSON Lines en stdout", "structured logging / JSON Lines / stdout / CRI log format",
         "Una línea de JSON compacto por request, escrita en la salida estándar (stdout) y sin hora. El runtime del nodo la guarda en un archivo con su hora, en formato CRI, y rota el archivo cuando crece.",
         "Dictarle a una secretaria: dices una frase por caso y sigues con lo tuyo; ella la anota en el cuaderno con la hora del reloj de la pared y, cuando el cuaderno se llena, empieza otro y tira el más viejo.",
         "El gateway no abre archivos, no conoce S3 y no espera a nadie: escribir en stdout termina en microsegundos, así que el log nunca frena la request. Una línea por request, con request_id, caller, source, model_version, top5, ms, bytes, sha256 y status: ≈ 300 B, lo que lee el job del día siguiente. La hora la pone uno solo, el runtime, en UTC con nanosegundos: en el disco del nodo queda «&lt;hora&gt; stdout F &lt;tu línea&gt;», en 5 archivos de 10 MiB por contenedor.",
         "Poner la hora en la línea (dos relojes en el mismo registro), escribir con espacios (≈ 10 % más bytes, pagados 10 millones de veces al día) o escribir directo a S3 desde la request: una lentitud de S3 se vuelve lentitud para el usuario.")
concepto("tres-relojes", "Tres relojes", "server-side latency / TargetResponseTime / client-side latency",
         "La misma request mide distinto según quién mida: el gateway (desde que su código la recibe hasta que contesta), el ALB (TargetResponseTime) y el backend (todo lo que esperó). Cada reloj contiene al anterior.",
         "Una pizza a domicilio: la cocina cuenta desde que entra la orden hasta que sale la caja; el repartidor, desde que la recoge hasta que toca el timbre; tú, desde que colgaste el teléfono. Los tres tienen razón y ninguno es «el tiempo de la pizza».",
         "El SLO de C01 (p99 ≤ 200 ms) se mide del lado del servidor, con el reloj del gateway; el backend vive con su timeout de 300 ms. TargetResponseTime va desde que la request sale del ALB hasta que el pod empieza a mandar los headers de la respuesta. Si el backend se queja de 280 ms y el gateway dice 20, el tiempo se fue fuera del gateway: en el ALB, en la red o en el backend.",
         "Comparar un número de un reloj con el de otro como si fueran lo mismo, o unir los relojes por la hora en lugar de por request_id.")
concepto("contador-gauge", "Contador y gauge", "counter / gauge",
         "Un contador empieza en 0 y solo sube (las requests con 200): lo útil es cuánto subió en un rato. Un gauge sube y baja, y su valor sí dice algo en cada momento (las requests en vuelo ahora).",
         "El odómetro y el velocímetro de un auto: el odómetro solo sube y lo útil es cuántos km hiciste hoy (una resta); el velocímetro sube y baja y lo que importa es lo que marca ahora.",
         "<code>classifier_requests_total{code, source, model_version}</code> es el contador del que salen las requests por segundo y la fracción de errores; <code>classifier_requests_in_flight</code> es el gauge (de 0 a 16, el tope del gateway). Si el proceso se reinicia, el contador vuelve a 0: no es un error, es la regla, y quien lo lee entiende que un contador que baja se reinició. Las métricas viven en la memoria del pod; el gateway las expone en <code>GET /metrics</code> y alguien las lee.",
         "Leer el valor de un contador como si dijera algo («lleva 957,980»): solo dice cuánto contó desde que arrancó. O usar un gauge para «las requests del último minuto»: no se suma bien entre pods y no sobrevive a un reinicio.")
concepto("histograma", "Histograma y buckets", "histogram / buckets / le / histogram_quantile",
         "Un grupo de contadores, uno por bucket: cada observación suma 1 a los buckets cuyo borde (le, «menor o igual») es mayor o igual a su valor, más _count y _sum. De ahí sale el p99 sin guardar cada número.",
         "Una fila de cubetas con letreros «hasta 5 ms», «hasta 10 ms», «hasta 20 ms»…: cada request echa una canica en cada cubeta cuyo letrero le queda grande. Contando canicas sabes debajo de qué tiempo cayó el 99 %.",
         "Los bordes se eligen alrededor de lo que importa: los de la latencia alrededor del SLO (0.15, 0.2 y 0.25 s), los del score con uno en 0.3, el umbral de baja confianza. Como son contadores, los de varios pods se suman antes de estimar el percentil con <code>histogram_quantile</code>. Cada combinación de etiquetas cuesta bordes + 4 series: +Inf, _count, _sum y _created.",
         "Un promedio o un percentil calculado en cada pod: el p99 de todo el gateway no es el promedio de los p99 de cada pod (y el Summary de prometheus_client ni siquiera calcula cuantiles). Y meter los 4xx a la latencia: un 415 tarda microsegundos y baja el p99 sin que nadie conteste más rápido.")
concepto("cardinalidad", "Cardinalidad", "cardinality / label values / high-cardinality labels",
         "Cuántas series deja una métrica: una por cada combinación distinta de valores de sus etiquetas. Cada serie le cuesta a Prometheus memoria, un lugar en su índice y una muestra en cada lectura.",
         "Los cajones de un archivero, uno por combinación de etiquetas: con «tipo de documento» y «año» son unos cuantos; si agregas «número de folio», necesitas un cajón por hoja y el archivero ya no cabe en el cuarto.",
         "Solo pueden ser etiquetas los datos con una lista corta y conocida de valores: <code>code</code>, <code>source</code> reducida a 4, <code>model_version</code>. Lo que identifica a una request (su id, el sha256 de la foto) va al log. En C01, el request_id en la latencia serían 15 series nuevas por request: 150 millones al día, y Prometheus se queda sin memoria en horas.",
         "Copiar un header a una etiqueta tal como llega (un caller con un bug manda un texto distinto en cada request), o creer que no pasa nada porque todo contesta 200: el costo aparece en Prometheus, horas después.")
concepto("scrape", "Scrape: Prometheus jala", "scrape / pull model / up",
         "Prometheus le pide /metrics a cada objetivo cada cierto tiempo (5 s en el dojo, 15 s en C01) y guarda cada número con la hora. Por cada objetivo guarda también up: 1 si la lectura salió bien, 0 si no.",
         "El que lee los medidores de luz: pasa por cada casa y anota lo que marca; si una casa no le abre, lo anota. Si las casas mandaran su lectura por correo, una casa sin luz simplemente no mandaría nada, y su silencio se parecería a «todo bien».",
         "Jalar en vez de recibir hace que un pod muerto se note: su <code>up</code> baja a 0. Cada serie junta una muestra por lectura: 86,400 ÷ 15 = 5,760 al día en C01. Lo primero que se revisa después de un cambio de monitoreo es que <code>up</code> exista y valga 1 para cada pod.",
         "Pensar que si Prometheus no se queja, está leyendo todo: si un pod no está en su lista, no hay ningún up de ese pod que baje. Nada truena; simplemente no lo lee.")
concepto("descubrimiento", "Descubrimiento y relabel: pods, no Services", "service discovery / relabel_configs / PodMonitor vs. ServiceMonitor",
         "Prometheus no lleva una lista fija de pods: los descubre (en C01, de la API de Kubernetes; en el dojo, de pods.json) y con relabel_configs se queda con los que quiere y les pone etiquetas.",
         "Un cartero con el padrón del edificio: no se aprende los nombres, lee el padrón cada día y reparte según lo que dice. Si repartiera por el buzón de cada empresa y dos empresas comparten oficina, esa oficina recibiría todo dos veces.",
         "En C01 lo arma kube-prometheus-stack con un PodMonitor, que elige pods por sus etiquetas. Fuera de un canary, <code>gateway-stable</code> y <code>gateway-canary</code> eligen los mismos pods: un ServiceMonitor los leería por los dos Services, con la etiqueta <code>service</code>, y cada suma saldría al doble. Las etiquetas que empiezan con <code>__</code> se tiran después del relabel: lo que quieras guardar (pod, nodo, hash) lo copias antes.",
         "Leer por los Services, o creer que no pasa porque al probar sin la etiqueta service salía bien: Prometheus descarta objetivos repetidos con las mismas etiquetas, y la cuenta doble aparece con service. Y un keep sobre una etiqueta que otro equipo puede renombrar sin avisar.")
concepto("promql-rate", "PromQL: rate, y luego sum", "PromQL / rate() / sum by / counter resets",
         "rate(contador[1m]) da cuánto subió por segundo en el último minuto, leyendo cualquier bajada como un reinicio; sum by (…) suma series y deja separadas las etiquetas que nombras. Siempre sum(rate(…)).",
         "Medir el ritmo de un grupo de corredores con podómetros que a veces se reinician: sacas los pasos por minuto de cada uno (si su podómetro marca menos, se reinició) y luego sumas. Si primero sumas los podómetros y uno se reinicia, el total baja y parece que todos se reiniciaron a la vez.",
         "Es la base de todas las tasas: requests por segundo, la fracción de errores del servidor (5xx sobre lo que no es 4xx) y el p99 (<code>histogram_quantile</code> sobre <code>sum by (le)</code> de las tasas de los buckets). Con lecturas cada 5 s, una ventana de 1 min junta 12 muestras; con 15 s, C01 usa 5 min.",
         "<code>rate(sum(…))</code>: cuando un pod se reinicia, la suma baja, rate() la lee como un reinicio de todo y cuenta la suma entera otra vez: un pico falso. Y dividir los 5xx entre todas las requests: un caller que manda basura (4xx) baja tu tasa de errores.")
concepto("recording-rule", "Recording rule", "recording rule / level:metric:operations",
         "Una consulta que Prometheus hace solo cada pocos segundos y guarda como una serie nueva con nombre (nivel:métrica:operación). El tablero y las alertas leen ese nombre en lugar de repetir la cuenta.",
         "El corte de caja de una tienda cada hora: en lugar de que cada gerente sume los tickets cuando quiere saber cuánto se vendió, alguien hace la suma a la hora y la anota en una hoja con nombre.",
         "Las preguntas de todos los días (requests por segundo por código, fracción de errores del servidor, p99 por versión) quedan calculadas igual para todos, y las alertas se escriben sobre ellas. En el dojo se evalúan cada 5 s, con ventanas de 1 min.",
         "Una división sin numerador da vacío, no 0: sin ningún 5xx, la serie de 5xx no existe y la fracción desaparece del tablero. Por eso el <code>or vector(0)</code>. Y un <code>rate(sum(…))</code> dentro de una regla esconde el error detrás de un nombre bonito.")
concepto("alerta", "Alertas: for, pending y absent", "alerting rule / for / pending / firing / absent()",
         "Una regla que avisa si su condición se cumple durante un tiempo (for): mientras no lo cumple está pending; después, firing. absent() da una serie cuando no hay ninguna: así también suena lo que se calla.",
         "Una alarma de humo con espera: un cerillo no la dispara; el humo que sigue 30 segundos, sí. Y otra alarma que suena si la de humo se quedó sin pila: la más peligrosa es la que no suena porque no tiene nada que medir.",
         "Las 5 de la estación: ClassifierHigh5xxRate (más de 1 % por 1 min), ClassifierP99Alto (más de 200 ms por 2 min), GatewaySinLectura (Prometheus no lee los 2 pods, con absent), LogsStale (un nodo lleva 3 min sin subir a S3; C01: 30 min) y ALB5xx (los 5xx que pone el ALB). El <code>for</code> evita despertar a alguien por un pico de un instante.",
         "Alertas que dependen de series que pueden desaparecer: si tu job pierde los pods, la de 5xx evalúa sobre nada y no suena, justo cuando no ves nada. Por eso GatewaySinLectura mira <code>up</code> con absent.")
concepto("exemplar", "Exemplar", "exemplar / trace_id / OpenMetrics / head sampling",
         "Un id pegado a una observación de un histograma: «una de las que cayeron en este bucket es la request tal». En el dojo, el request_id de ≈ 1 % de las requests, elegidas por el hash del id.",
         "Un post-it en una caja de la bodega: la etiqueta dice «150 paquetes de 10 a 20 kg»; el post-it dice «uno de ellos es el folio 5a1e07c3», para que puedas abrir uno y ver cómo viene.",
         "Une la métrica con una request concreta: ves el p99 subir, tocas un punto y llegas al id (en C01, a su traza; en el dojo, con <code>mundo/buscar.py</code>, a su línea). Dos condiciones: prometheus_client solo los escribe en el formato OpenMetrics, que Prometheus 3 pide al leer, y Prometheus solo los guarda con <code>--enable-feature=exemplar-storage</code>, que viene apagado.",
         "Esperar que el exemplar sea una de las lentas: el muestreo decide al principio (head sampling), sin saber cuánto va a tardar, y cada bucket lleva a lo más uno (el último) entre dos lecturas. Para guardar todas las lentas hay que decidir al final (tail sampling).")
concepto("fluent-bit", "Fluent Bit en cada nodo", "Fluent Bit / tail input / DaemonSet",
         "Un programa chico que corre en cada nodo, sigue los archivos de log mientras crecen (tail, con el parser cri), anota hasta dónde leyó (su DB) y sube lo que junta a S3. En C01, un DaemonSet: un pod por nodo.",
         "El mensajero de cada piso de un edificio: pasa por las bandejas de su piso, se lleva lo nuevo, anota en su libreta hasta qué hoja recogió y lo manda al archivo central. Con un mensajero por piso, ningún piso se queda sin recoger, ni siquiera uno nuevo.",
         "El gateway no conoce S3: Fluent Bit hace el camino. Con un Deployment de 3 réplicas, dos nodos podrían quedarse sin quien lea sus logs; el DaemonSet pone uno en cada nodo, también en los que lleguen. Si se cae, las líneas esperan en el disco del nodo y, al volver, sigue donde se quedó gracias a su DB, mientras el kubelet no haya rotado esos archivos.",
         "Pensar que si Fluent Bit se cae no pasa nada porque el gateway sigue contestando: el log de ese nodo se atrasa y, si tarda más que la rotación (5 archivos de 10 MiB), esas líneas se pierden. Lo avisa LogsStale, por nodo.")
concepto("buffer-en-disco", "Buffer en disco y reintentos", "store_dir / retry_limit / quarantine / never block the request",
         "Lo que Fluent Bit no pudo subir lo guarda en el disco del nodo (store_dir, con su tope) y lo reintenta. Nunca frena la request: si S3 se cae, se atrasa el monitoreo, no el servicio.",
         "La bandeja de salida de una oficina cuando el correo no pasa: las cartas se juntan ahí y se mandan cuando vuelve el cartero. Si la bandeja se llena, o si alguien se cansa de esperar y tira las cartas viejas, esas se pierden.",
         "En C01, 1 GB por nodo aguanta ≈ 16 h de S3 caído. El otro tope son los reintentos: con el <code>retry_limit</code> por omisión, el plugin s3 de Fluent Bit 5.1.5 se rinde a los 6 intentos (≈ 30 s) y manda el pedazo a cuarentena: esas líneas no llegan nunca. Por eso la solución usa <code>retry_limit 60</code> y verificar.py reprueba si hubo cuarentena.",
         "Fiarse de las métricas de reintentos del motor: en la construcción del dojo, <code>fluentbit_output_retries_failed_total</code> siguió en 0 mientras se perdían pedazos. Y un log que espera a que S3 confirme: cualquier lentitud de S3 se vuelve lentitud para todos.")
concepto("al-menos-una-vez", "Entrega al menos una vez", "at-least-once delivery / deduplication",
         "Fluent Bit garantiza que cada línea llegue, no que llegue una sola vez: si una subida falla después de que S3 sí la guardó, la reintenta y el mismo archivo llega dos veces. Quien lee quita los repetidos.",
         "Mandar una carta importante y, como no llegó el acuse, mandarla otra vez: la otra persona puede recibir dos, y por eso numeras tus cartas, para que tire la repetida.",
         "El log de ayer del dojo trae dos archivos subidos dos veces. Sin quitarlos, el join del mes contaría esas fotos dos veces. La llave es (request_id, time): el mismo id con otra hora es otra request de verdad (un caller que reintenta con el mismo X-Request-ID), y esa se queda.",
         "Quitar repetidos solo por request_id: borra los reintentos legítimos del caller. O creer que «exactamente una vez» viene gratis: casi ningún camino de logs lo promete.")
concepto("parquet-particiones", "Parquet por fecha y versión", "Parquet / partitioning / dt= / idempotent job",
         "Parquet guarda una tabla por columnas, comprimida y con el tipo de cada columna. Partida en carpetas (dt=AAAA-MM-DD/model_version=…/), una consulta de un día y una versión solo lee esa carpeta.",
         "Un archivero con un cajón por día y una carpeta por versión adentro: para ver cómo le fue a la versión 15 el martes, abres un cajón y una carpeta, no el archivero entero.",
         "El crudo de C01 son ≈ 3 GB de JSON al día; en Parquet, ≈ 0.5 GB en 4 archivos. De ahí leen el PSI diario, la aceptación y las fotos para etiquetar de la estación 12. El job es idempotente: borra lo de ese día y lo vuelve a escribir, así que correrlo dos veces (un reintento del orquestador) da lo mismo.",
         "Un job que agrega en lugar de reemplazar: el reintento duplica el día. Y filtrar el día con la hora local: el crudo y la carpeta están en UTC, y en las fronteras del día se pierden o se duplican filas.")
concepto("punto-ciego-alb", "Lo que el gateway no ve", "blind spot / HTTPCode_ELB_5XX_Count / RequestCount / fail open",
         "Las requests que el ALB contesta él mismo (401 por el token, 503 sin destinos registrados) nunca llegan al gateway: sus métricas no las cuentan. Solo las ven las métricas del ALB (en C01, CloudWatch).",
         "El portero de un restaurante que cierra la puerta cuando la cocina se incendia: el libro de órdenes de la cocina dice «tarde tranquila, cero quejas»; a los que se fueron sin comer solo los contó el portero.",
         "Con Triton caído, los pods fallan su readiness y salen del target group (en C01: salen de los Endpoints y el AWS Load Balancer Controller los da de baja); sin destinos registrados, el ALB contesta 503 y la fracción de 5xx del gateway se queda sin requests. ALB5xx lo ve; como <code>RequestCount</code> solo cuenta las requests para las que el ALB eligió destino, el total suma las dos. Si los destinos siguen registrados pero todos fallan el health check, el ALB de AWS abre el paso (fail open) y les manda tráfico igual.",
         "Confiar en una tasa de errores calculada en el gateway como si viera todo: ve todo menos el caso en que no llega nada. Antes de confiar en una alerta, pregunta qué requests no cuenta.")
e["conceptos"] = K

# ---------------------------------------------------------------- el mundo
e["mundo"] = {
    "resumen": "El kit trae la release 15 de C01 corriendo en chico, de verdad: dos nodos del gateway (contenedores de Docker con un pod cada uno y su runtime, que escribe el stdout del pod en el disco del nodo), un Fluent Bit 5.1.5 por nodo, RustFS como S3, Prometheus v3.15.1 con exemplars, el Triton del dojo, el ALB del dojo (token, target group y sus métricas «de CloudWatch»), el vigía de S3, el tráfico de siempre y el log de ayer ya subido. Lo tuyo: el rastro de cada request, lo que lee Prometheus, sus reglas y alertas, el camino del log a S3 y el job diario a Parquet.",
    "trae": [
        {"que": "mundo/crear.py y compose.yaml", "detalle": f"Levanta todo en ≈ {f_(CREAR_S)} s (la primera vez ≈ 2 min, porque baja las imágenes y construye la del nodo): RustFS 1.0.4 como S3 (<code>localhost:9950</code>, consola en 9951), Prometheus v3.15.1 con <code>exemplar-storage</code> (<code>localhost:9952</code>), los nodos <code>nodo-a</code> y <code>nodo-b</code> y un Fluent Bit por nodo. Deja en S3 el log de ayer ({f_(AYER_N)} requests, con el rollout de la 14 a la 15 a las 16:00 UTC y {f_(AYER_DUP)} archivos subidos dos veces) y vuelve la carpeta un repositorio de git."},
        {"que": "mundo/runtime.py y mundo/nodo.py", "detalle": "El runtime de cada nodo (en C01, containerd): corre el pod y escribe su stdout en <code>/var/log</code> en formato CRI, con la rotación del kubelet (5 archivos de 10 MiB). Y el kubelet del dojo: <code>estado</code>, <code>logs</code>, <code>reiniciar</code>, <code>matar</code>, <code>parar</code>, <code>arrancar</code>, <code>publicar</code>. Al publicar escribe <code>nodo/descubrimiento/pods.json</code> y <code>servicios.json</code>: lo que la API de Kubernetes le contestaría a Prometheus."},
        {"que": "mundo/alb.py", "detalle": "El ALB del dojo en <code>localhost:8950</code>: verifica el JWT de cada caller, reparte entre los pods registrados en su target group (health check a <code>/readyz</code> cada 2 s), contesta él mismo 401, 404 y 503, mide TargetResponseTime, escribe su access log en <code>logs/alb.log</code> y publica sus números con nombres de CloudWatch en <code>localhost:8957</code>."},
        {"que": "mundo/carga.py, mundo/buscar.py y mundo/relojes.py", "detalle": "Los callers, por el ALB y con token (<code>--una</code> cuenta una request con detalle; <code>--basura</code> manda 415 y 405; <code>--fuente-loca</code>, un X-Client-Source distinto en cada request); buscar una request por su id en el backend, el ALB, el disco de cada nodo y S3; y los tres relojes unidos por request_id. El tráfico de siempre, 5 fotos/s, corre solo."},
        {"que": "mundo/recargar.py", "detalle": "Lleva tus cambios a lo que corre: <code>prometheus</code> (promtool y recarga), <code>fluent-bit</code> (reinicia los dos) y <code>gateway</code> (reinicia los pods uno tras otro, drenándolos en el ALB). Antes espera a que el contenedor vea tu archivo completo."},
        {"que": "mundo/vigia_s3.py y mundo/triton_dojo/", "detalle": "El vigía publica en <code>localhost:8956</code> cuándo llegó el último archivo de log de cada nodo (<code>dojo_s3_ultimo_objeto_timestamp_seconds</code>); Triton del dojo sirve la release 15 en <code>localhost:8955</code>."},
        {"que": "mundo/plataforma.yaml y mundo/prometheus/plataforma.yml", "detalle": "Lo del equipo de plataforma: los pods con sus etiquetas, el kubelet, el ALB y su llave, y lo que Prometheus ya lee (Triton, el ALB, Fluent Bit y el vigía). Cambia solo con un commit."},
        {"que": "gateway/ (menos rastro.py), gateway.yaml y servir/", "detalle": "La release 15 de las estaciones 6 a 10. <code>main.py</code> llama a <code>rastro.py</code> para todo lo que la request deja escrito; <code>gateway.yaml</code> trae las fuentes permitidas (mobile, web, internal) y la fracción de exemplars (0.01)."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks contra lo que corre (los pods, Prometheus, Fluent Bit y S3) y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "gateway/app/rastro.py", "hace": "El rastro de cada request: su request_id, la fuente reducida a 4 valores, si deja exemplar (por el hash del id), las 8 métricas del contrato y la línea de JSON compacto en stdout."},
        {"archivo": "observabilidad/prometheus.yml", "hace": "El job <code>gateway</code>: descubre los pods en <code>pods.json</code> y se queda con cada uno una sola vez, con las etiquetas pod, nodo y hash."},
        {"archivo": "observabilidad/reglas.yml", "hace": "3 recording rules (requests por segundo, fracción de errores del servidor, p99 por versión) y 5 alertas, también para lo que se calla."},
        {"archivo": "observabilidad/fluent-bit.conf", "hace": "Lee los logs del gateway en formato CRI, agrega el nodo y los sube a S3 cada minuto, con gzip, buffer en disco y reintentos suficientes."},
        {"archivo": "diario/a_parquet.py", "hace": "El job diario: el crudo de ayer, sin repetidos y solo las líneas del gateway, a Parquet por fecha y versión, idempotente."},
    ],
    "requisitos": [
        "Docker Desktop con al menos 4 GiB libres",
        "Python 3.11 o más nuevo, con el venv del kit: <code>python3 -m venv .venv && .venv/bin/pip install -r requirements.txt</code> y <code>source .venv/bin/activate</code>",
        "git e Internet la primera vez (las imágenes de RustFS, Prometheus y Fluent Bit, y la del nodo)",
        "Los puertos 8950–8957 y 9950–9954 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "Nodos de EKS con 3 a 12 pods del gateway", "local": "dos contenedores de Docker (<code>nodo-a</code>, <code>nodo-b</code>) con un pod cada uno", "diferencia": "Cada nodo tiene su propio disco de logs (un volumen): solo lo ven su runtime y su Fluent Bit, como en un nodo de verdad."},
        {"nube": "containerd y el kubelet", "local": "<code>mundo/runtime.py</code> y <code>mundo/nodo.py</code>", "diferencia": "El mismo formato CRI, la misma rotación (5 archivos de 10 MiB) y el reinicio con espera creciente."},
        {"nube": "Un PodMonitor de kube-prometheus-stack (<code>kubernetes_sd_configs</code>)", "local": "<code>file_sd_configs</code> sobre <code>nodo/descubrimiento/pods.json</code>", "diferencia": "Las mismas etiquetas <code>__meta_kubernetes_*</code>: tu <code>relabel_configs</code> es el que escribirías en C01. Lo que haría un ServiceMonitor sale de <code>servicios.json</code>."},
        {"nube": "Fluent Bit como DaemonSet", "local": "un contenedor de Fluent Bit 5.1.5 por nodo", "diferencia": "La misma configuración en los dos; <code>${NODO}</code> lo pone cada contenedor."},
        {"nube": "Amazon S3, con KMS y un rol que solo escribe en <code>logs/</code>", "local": "RustFS 1.0.4 en <code>localhost:9950</code>", "diferencia": "La misma API, el mismo bucket y las mismas rutas; sin cifrado ni roles."},
        {"nube": "CloudWatch con las métricas del ALB (AWS/ApplicationELB) y la alarma ALB5xx", "local": "el ALB del dojo publica en <code>localhost:8957</code> con nombres de CloudWatch y Prometheus los lee", "diferencia": "ALB5xx vive en tu <code>reglas.yml</code>, junto a las demás."},
        {"nube": "Lecturas cada 15 s, ventanas de 5 min, subidas cada 5 min y LogsStale a los 30 min", "local": "cada 5 s, ventanas de 1 min, cada minuto y a los 3 min", "diferencia": "Todo más corto para no esperar; las reglas y las consultas son las mismas."},
        {"nube": "Trazas completas con OpenTelemetry y Grafana Tempo; los exemplars llevan a la traza", "local": "el exemplar lleva el request_id como trace_id; de ahí, <code>mundo/buscar.py</code> encuentra la línea", "diferencia": "No hay spans: no ves por dentro de Triton, solo los tramos de la línea (pre, triton, post)."},
        {"nube": "≈ 116 requests por segundo en promedio", "local": "5 fotos/s de siempre y la carga que mandes", "diferencia": "Los volúmenes son chicos; las cuentas por request (bytes, series) son las mismas."},
        {"nube": "La lección de Sensei nombra la etiqueta <code>status</code> y el histograma <code>classifier_request_latency_seconds</code>", "local": "<code>code</code> y <code>classifier_request_seconds</code>", "diferencia": "El dojo sigue los nombres de sus estaciones 6 y 10, los que ya busca el análisis del canary. Lo demás es igual."},
        {"nube": "La lección de Sensei sigue a la release 14 (<code>resnet50-2026-10-01</code>)", "local": "la release 15 (<code>resnet50-2026-11-01</code>)", "diferencia": "El dojo sigue su propio tronco: la estación 10 subió la 15."},
        {"nube": "El 405 lo contesta FastAPI antes de que corra el código: sin línea ni cuenta en el gateway", "local": "el gateway del dojo también anota el 405 (su línea y su cuenta)", "diferencia": "<code>main.py</code> lo atrapa en su manejador de errores; el ALB lo cuenta igual."},
    ],
    "arranque": "unzip c01-request.zip && cd c01-request\npython3 -m venv .venv && .venv/bin/pip install -r requirements.txt\nsource .venv/bin/activate\npython mundo/crear.py\npython verificar.py mundo",
    "python": "python",
}

# ---------------------------------------------------------------- el Guiado
G = []
c0, _ = S("paso 0", "time python mundo/crear.py")
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="S3, Prometheus, los dos nodos con su pod del gateway y su Fluent Bit, Triton, el ALB, el vigía y el tráfico de siempre arriba, y el log de ayer ya en S3.",
    conceptos=["observabilidad"],
    explica="<code>mundo/crear.py</code> levanta <code>compose.yaml</code> (RustFS como S3, Prometheus y los contenedores <code>nodo-a</code> y <code>nodo-b</code>, cada uno con su Fluent Bit), deja en S3 el log de ayer para tu job diario y arranca con <code>mundo/nodo.py</code> lo que corre en tu Mac: Triton, los dos pods del gateway (uno dentro de cada nodo), el ALB del dojo, el vigía de S3 y el tráfico de siempre, 5 fotos por segundo de tres callers. También vuelve la carpeta un repositorio de git: los cambios de otros equipos llegan como commits.",
    codigo=[],
    comandos=[
        cmd(c0.removeprefix("time "), O("paso 0", "time python mundo/crear.py", quitar=r"^real"), "Se puede correr otra vez: deja el mundo como al principio, salvo tus archivos."),
        C("paso 0", "python verificar.py mundo"),
        C("paso 0", "python mundo/nodo.py estado", nota="Cada pod escribe su stdout en el disco de su nodo: esa ruta de <code>/var/log/pods/…</code> es la que va a leer Fluent Bit."),
        C("paso 0", "python mundo/carga.py --una", nota="Una foto contada con detalle. El gateway todavía no escribe su línea: falta el tercer reloj."),
        C("paso 0", "python mundo/nodo.py logs a", nota="Lo único que hay en el disco del nodo: lo que el proceso escribió en stderr al arrancar."),
        C("paso 0", V, exacto=True, nota=f"Al empezar, {f_(VERDE0)} de 12 en verde: el mundo y las series acotadas (todavía no hay series). Lo demás es tu trabajo."),
    ],
    verifica="<code>python verificar.py mundo</code> en verde: todo arriba, y una foto por el ALB contesta 200 con <code>resnet50-2026-11-01</code>.",
    ojo="La primera vez, <code>crear.py</code> baja las imágenes y construye la del nodo (≈ 2 min). Para <code>docker compose</code> en esta carpeta, primero <code>export DOCKER_CONFIG=$PWD/.docker</code> (lo crea crear.py, sin el llavero de macOS). Si un puerto del 8950 al 8957 o del 9950 al 9954 está ocupado, apaga la otra estación que lo usa. <code>python mundo/nodo.py parar</code> y <code>docker compose stop</code> liberan tu Mac; <code>crear.py</code> lo regresa todo."))

G.append(dict(n=1, id="linea", titulo="El request_id y la línea de log", objetivo="Cada request con un nombre (su request_id) que vuelve en la respuesta, y una sola línea de JSON compacto en stdout, sin hora, que el runtime guarda en el disco del nodo.",
    conceptos=["request-id", "linea-log", "observabilidad"],
    explica="Escribe en <code>gateway/app/rastro.py</code> la función del principio y la línea del final. <code>request_id()</code> respeta el <code>X-Request-ID</code> del caller si es sano (de 8 a 64 caracteres de letras, números, «-», «_», «.» o «:») y, si no, inventa un UUID versión 4: así el backend y el gateway llaman igual a la misma request, y un id con espacios o de 80 caracteres no se cuela al log. <code>anotar()</code> pone el status y <code>ms.total</code> en el evento y lo escribe como una línea de JSON compacto (<code>separators=(',', ':')</code>) en stdout. No lleva hora: la pone el runtime del nodo al recibirla. <code>main.py</code> llama a <code>anotar()</code> en un <code>finally</code>, así que también los 4xx dejan su línea. Las métricas todavía no: llegan en el paso 3. Recarga los pods con <code>mundo/recargar.py gateway</code> y sigue una request por los tres lugares donde dejó rastro.",
    codigo=[{"lang": "python", "path": "gateway/app/rastro.py", "code": RASTRO1.rstrip("\n"), "nota": "Así queda en este paso: <code>fuente()</code> devuelve «other» y <code>se_traza()</code> False hasta los pasos 3 y 6, y la clase todavía no crea las métricas. El <code>flush()</code> de cada línea: si el proceso muere, lo escrito ya está en manos del runtime."}],
    comandos=[
        C("paso 1", "python mundo/recargar.py gateway", nota="Un pod tras otro, como un rollout: el ALB drena cada uno antes de reiniciarlo."),
        C("paso 1", "python mundo/carga.py --una", nota="Ahora sí: el tercer reloj sale de la línea, y el mismo X-Request-ID volvió en la respuesta."),
        C("paso 1", "python mundo/nodo.py logs b", nota="Así queda en el disco del nodo, en formato CRI: la hora del runtime, el flujo, F (línea completa) y tu texto. El 405 también deja su línea."),
        C("paso 1", "python mundo/buscar.py", nota="El mismo id en el log del backend, en el access log del ALB y en el disco del nodo: así se unen."),
        C("paso 1", "curl -s -i -X POST localhost:8951/v1/classify", nota="Directo al pod: un id con espacios no es sano y el gateway lo reemplaza, también en un 415."),
        C("paso 1", "python verificar.py request-id linea-log"),
    ],
    verifica=f"<code>python verificar.py request-id linea-log</code>: el id del caller se respeta (también en el 415), uno malo se reemplaza y cada request deja una sola línea de {f_(LINEA_B)} B, sin hora ni foto.",
    ojo="Con <code>print(json.dumps(ev))</code> salen espacios después de cada «,» y «:»: ≈ 10 % más bytes, pagados 10 millones de veces al día en C01; verificar.py pide JSON compacto. No pongas la hora en la línea: el runtime ya la pone, y dos horas en el mismo registro (la del proceso y la del nodo) confunden a quien lo lea. Y si una request dejara dos líneas (una en el handler y otra en el <code>finally</code>), el join del mes contaría la foto dos veces."))

G.append(dict(n=2, id="relojes", titulo="Tres relojes", objetivo="Medir las mismas requests con tres relojes (backend, ALB y gateway) y ver dónde se va la diferencia.",
    conceptos=["tres-relojes", "request-id"],
    explica="Cada reloj empieza y termina en un lugar distinto. El gateway mide desde que su código recibe la request hasta que contesta: <code>ms.total</code> de su línea. El ALB mide <code>TargetResponseTime</code>: desde que la request sale del ALB hacia el pod hasta que el pod empieza a mandar los headers de su respuesta (en su access log, <code>target_processing_time</code>). El backend mide todo lo que esperó, contra su timeout de 300 ms. <code>mundo/relojes.py</code> une los tres por <code>request_id</code>: sin un nombre común serían tres montones de números imposibles de casar. En este paso no escribes nada: miras con lo que dejó el paso 1.",
    codigo=[],
    comandos=[
        C("paso 2", "python mundo/carga.py", nota="40 fotos por segundo durante 30 s, sin basura."),
        C("paso 2", "python mundo/relojes.py", nota="De las últimas 1000 que mandó el backend con 200, las que tienen su línea en algún nodo: el p50 y el p99 de cada reloj y de cada salto."),
    ],
    verifica=f"Ves que, en p50, el gateway mide {f_(G50, '{:g}')} ms, el ALB {f_(A50, '{:g}')} y el backend {f_(B50, '{:g}')}: cada reloj contiene al anterior.",
    ojo="En el dojo cada salto pesa varios milisegundos (la red de Docker Desktop entre tu Mac y los contenedores, y un ALB escrito en Python); en C01, 1 o 2. Lo que no cambia es la regla: no compares un número de un reloj con el de otro. El SLO de C01 (p99 ≤ 200 ms) es del reloj del gateway, y ninguno de los tres incluye la subida desde el celular de quien vende hasta AWS."))

G.append(dict(n=3, id="metricas", titulo="Lo que suma cada request", objetivo="Las 8 métricas del contrato, con sus nombres, etiquetas y bordes fijos: cada request suma al contador y, si no es 4xx, a la latencia.",
    conceptos=["contador-gauge", "histograma", "cardinalidad"],
    explica="Completa la clase <code>Rastro</code>. En su <code>__init__</code> crea, en el registro que te pasan, el contador <code>classifier_requests_total{code, source, model_version}</code>, el gauge de requests en vuelo y seis histogramas con bordes fijos: los de la latencia alrededor del SLO de 200 ms, los del score con uno en 0.3 (el umbral de baja confianza). Los nombres y las etiquetas son los de las estaciones 6 y 10: las alertas y el análisis del canary los buscan así. <code>fuente()</code> reduce el header <code>X-Client-Source</code> a 4 valores (mobile, web, internal y, para todo lo demás, other), para que la etiqueta no crezca con cada texto nuevo; el log guarda el header tal como llegó. En <code>anotar()</code>, el contador suma siempre y la latencia solo si el status no es 4xx: un 415 tarda microsegundos y bajaría el p99 sin que nadie contestara más rápido. Las 10 categorías de <code>classifier_top1_label_total</code> se crean al arrancar, aunque valgan 0, para que el PSI del canary no vea huecos.",
    codigo=[{"lang": "python", "path": "gateway/app/rastro.py (lo que cambia: fuente() y la clase)", "code": RASTRO3[RASTRO3.index("def fuente("):].rstrip("\n"), "nota": "Cada histograma de prometheus_client deja, por combinación de etiquetas, un bucket por borde, el +Inf, <code>_count</code>, <code>_sum</code> y <code>_created</code>: bordes + 4 series. <code>se_traza()</code> sigue en False hasta el paso 6."}],
    comandos=[
        C("paso 3", "python mundo/recargar.py gateway"),
        C("paso 3", "python mundo/carga.py --tasa 20 --segundos 10", exacto=True, nota="Con un poco de basura: algunos 415 y algún 405."),
        C("paso 3", "curl -s localhost:8951/metrics | grep -E", nota="Las cuentas del contador de un pod, por código, fuente y versión. Los 415 cuentan aquí; en la latencia, no."),
        C("paso 3", "curl -s localhost:8951/metrics | grep -c", nota="Las líneas classifier_* de un pod: sus series."),
        C("paso 3", "python mundo/carga.py --tasa 20 --segundos 10 --fuente-loca", nota="Un caller con un bug: un X-Client-Source distinto en cada request."),
        C("paso 3", "curl -s localhost:8951/metrics | grep -c", n=1, nota="Crecen una vez, por la fuente other, y ya no."),
        C("paso 3", "curl -s localhost:8951/metrics | grep '^classifier_requests_total'", nota="La etiqueta source tiene 4 valores posibles, venga lo que venga en el header."),
        C("paso 3", "python verificar.py metricas series-acotadas"),
    ],
    verifica="<code>python verificar.py metricas series-acotadas</code>: las 8 métricas con sus tipos, etiquetas y bordes, y ninguna etiqueta con un valor por request.",
    ojo="Crea las métricas en el registro que te pasan, no en el global de prometheus_client: las pruebas de verificar.py crean varias apps en el mismo proceso y, en el global, el segundo registro del mismo nombre truena («Duplicated timeseries»). Y no renombres una métrica, aunque sea para «mejorarla»: las alertas y el análisis del canary la buscan por nombre, y se apagan sin que nadie se entere."))

G.append(dict(n=4, id="prometheus", titulo="Prometheus lee los pods", objetivo="Prometheus lee cada pod del gateway una sola vez, descubriéndolos como lo haría con la API de Kubernetes, con las etiquetas pod, nodo y hash.",
    conceptos=["scrape", "descubrimiento"],
    explica="Prometheus trabaja jalando: cada 5 s le pide <code>/metrics</code> a cada objetivo que conoce (en C01, cada 15 s) y por cada uno guarda también <code>up</code>, 1 si la lectura salió bien. Ya lee lo de la plataforma (Triton, el ALB, Fluent Bit y el vigía); te falta el job <code>gateway</code>. Los pods no se escriben a mano: <code>mundo/nodo.py</code> publica en <code>nodo/descubrimiento/pods.json</code> lo que la API de Kubernetes le contestaría a <code>kubernetes_sd_configs</code> con <code>role: pod</code>, con las mismas etiquetas <code>__meta_kubernetes_*</code>, y Prometheus lo lee con <code>file_sd_configs</code>. Tus <code>relabel_configs</code> se quedan con los pods del namespace classifier, de la app gateway y del puerto http, y copian el nombre del pod, el nodo y el hash de la release a etiquetas que sí se guardan. Primero, la trampa: leer por los Services. Fuera de un canary, <code>gateway-stable</code> y <code>gateway-canary</code> eligen los mismos pods; leerlos por los dos, como haría un ServiceMonitor, pone cada pod dos veces y cada suma sale al doble. Por eso C01 usa un PodMonitor. En esta página, <code>q '…'</code> es una función de tu terminal que le pregunta a la API de Prometheus.",
    codigo=[{"lang": "bash", "path": "terminal (la función q: pégala una vez en cada terminal, con el venv activo)", "code": Q_FUNC, "nota": "Una línea por serie: sus etiquetas (sin instance) y su valor. «(vacío)» si la consulta no da nada."},
            {"lang": "yaml", "path": "observabilidad/prometheus.yml (la trampa: lo que cambia para leer por los Services)", "code": TRAMPA, "nota": "<code>servicios.json</code> trae los endpoints de los dos Services; la etiqueta <code>service</code> es la que pone un ServiceMonitor."},
            {"lang": "yaml", "path": "observabilidad/prometheus.yml", "code": PROM, "nota": "Los tres <code>keep</code> eligen; los otros tres copian. Lo que empieza con <code>__</code> se tira después del relabel."}],
    comandos=[
        C("paso 4", "curl -s localhost:9952/api/v1/targets", nota="Hoy Prometheus lee lo de la plataforma; del gateway, nada."),
        C("paso 4", "python -m json.tool nodo/descubrimiento/pods.json", nota="Lo que publica el kubelet del dojo: las mismas etiquetas que da kubernetes_sd_configs con role: pod."),
        C("paso 4", "tail -3 observabilidad/prometheus.yml", nota="La trampa puesta: el job sobre <code>servicios.json</code>, con la etiqueta service."),
        C("paso 4", RECARGAR_P, exacto=True, nota="promtool revisa los dos archivos y Prometheus los vuelve a leer."),
        C("paso 4", "q 'count by (pod)", nota="Cada pod, dos veces: una por Service."),
        C("paso 4", "q 'sum(rate(classifier_requests_total[30s]))'", nota="Con 40 s de carga a 20 fotos/s más las 5 de siempre: la suma del gateway…"),
        C("paso 4", "q 'sum(rate(alb_request_count_total[30s]))'", nota="…y la del ALB, que no cuenta doble: la mitad."),
        C("paso 4", RECARGAR_P, n=1, exacto=True, nota="Ahora con tu <code>prometheus.yml</code>: los pods, una vez cada uno."),
        C("paso 4", "curl -s localhost:9952/api/v1/targets", n=1),
        C("paso 4", "q 'up{job=\"gateway\"}'"),
        C("paso 4", "q 'sum(rate(classifier_requests_total[30s]))'", n=1, nota="Con el tráfico de siempre…"),
        C("paso 4", "q 'sum(rate(alb_request_count_total[30s]))'", n=1, nota="…el gateway y el ALB cuentan lo mismo."),
        C("paso 4", "q 'count by (__name__)", nota="Lo que Prometheus guarda del gateway, por nombre."),
        C("paso 4", "python verificar.py prometheus-lee"),
    ],
    verifica=f"<code>python verificar.py prometheus-lee</code>: los 2 pods, una vez cada uno, con pod, nodo y hash, y up = 1. La suma del gateway ({f_(R_OK, '{:.2f}')} req/s) es la del ALB ({f_(A_OK, '{:.2f}')}); con la trampa, {f_(R_DOBLE, '{:.1f}')} contra {f_(A_DOBLE, '{:.1f}')}.",
    ojo="Si lees <code>servicios.json</code> sin la etiqueta <code>service</code>, no ves el doble: Prometheus descarta los objetivos repetidos que quedan con el mismo conjunto de etiquetas (lo hace su código; la documentación no lo dice). El ServiceMonitor sí pone <code>service</code>, y ahí aparece la cuenta doble. Y recarga con <code>python mundo/recargar.py prometheus</code>, no con un <code>curl -X POST localhost:9952/-/reload</code> a secas justo después de guardar: en la construcción del dojo, Docker Desktop le dio a Prometheus un <code>prometheus.yml</code> cortado (guarda unos segundos lo que el contenedor ya leyó de una carpeta compartida); recargar.py espera a que el contenedor vea el archivo completo."))

G.append(dict(n=5, id="promql", titulo="PromQL y las recording rules", objetivo="Las preguntas de todos los días como recording rules (requests por segundo, fracción de errores del servidor y p99 por versión) y las dos alertas del servicio; y ver qué pasa con la tasa cuando un pod se reinicia.",
    conceptos=["promql-rate", "recording-rule", "alerta"],
    explica="PromQL tiene dos piezas para casi todo: <code>rate(contador[1m])</code>, cuánto subió por segundo en el último minuto, contando bien los reinicios, y <code>sum by (…)</code>, que suma series y deja separadas las etiquetas que nombras. Una recording rule hace una consulta cada 5 s y guarda el resultado como una serie nueva con nombre: así el tablero y las alertas no recalculan lo mismo. Escribe en <code>observabilidad/reglas.yml</code> tres: requests por segundo por código; la fracción de 5xx sobre las requests que no son 4xx (los 4xx son culpa de quien llama: con ellos en el denominador, un caller que manda basura bajaría tu tasa), y el p99 por versión, sumando los buckets de los dos pods antes del <code>histogram_quantile</code>. Y las dos alertas del servicio: más de 1 % de 5xx durante 1 min, y el p99 arriba de 200 ms durante 2 min. Una alerta cuya condición se cumple queda <i>pending</i> y, si dura su <code>for</code>, <i>firing</i>. Después, la prueba del reinicio: matas el contenedor del pod a y comparas <code>sum(rate(…))</code> con <code>rate(sum(…))</code>.",
    codigo=[{"lang": "yaml", "path": "observabilidad/reglas.yml (las consultas y las dos alertas del servicio)", "code": REGLAS5, "nota": "<code>or vector(0)</code>: sin ningún 5xx, la serie de 5xx no existe y la división daría vacío, no 0. GatewaySinLectura y ALB5xx llegan en el paso 9; LogsStale, en el 7."}],
    comandos=[
        C("paso 5", RECARGAR_P, exacto=True),
        C("paso 5", "q 'classifier:requests:rate1m'", nota="Después de 65 s de carga con 5 % de basura: requests por segundo por código."),
        C("paso 5", "q 'classifier:errores_servidor:ratio_rate1m'", nota="Sin 5xx: 0, gracias al or vector(0)."),
        C("paso 5", "q 'sum(rate(classifier_requests_total{code=~", nota="La misma división sin el or vector(0): vacía."),
        C("paso 5", "q 'classifier:latencia:p99_1m'", nota="En segundos, por versión. histogram_quantile interpola dentro del bucket: es una estimación."),
        C("paso 5", "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m])) / ", nota=f"La fracción de 200 sobre todas: {f_(mul(FRAC200, 100), '{:.1f}')} %, por la basura. No es la tasa de errores del servidor: esa es 0."),
        C("paso 5", "q 'sum by (pod)", nota="El contador de 200 de cada pod, desde que arrancó."),
        C("paso 5", "python mundo/nodo.py matar a", nota="Su runtime lo vuelve a arrancar: el mismo pod, con el contador en 0."),
        C("paso 5", "q 'sum by (pod)", n=1, nota="El del pod a volvió a empezar."),
        C("paso 5", "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m]))'", nota="Primero la tasa de cada serie, luego la suma: lo real."),
        C("paso 5", "q 'rate(sum(", nota="Primero la suma y luego la tasa: la suma bajó, rate() lo leyó como un reinicio de todo y contó la suma entera otra vez."),
        C("paso 5", "q 'resets(", nota="resets() cuenta los reinicios de cada serie en la ventana."),
        C("paso 5", "python verificar.py consultas"),
    ],
    verifica=f"<code>python verificar.py consultas</code>: las 3 recording rules sanas, la fracción de errores en 0 (no vacía) y el p99 por versión. Con el reinicio, <code>sum(rate(…))</code> dio {f_(SUMRATE, '{:.1f}')} req/s y <code>rate(sum(…))</code>, {f_(RATESUM, '{:.1f}')}.",
    ojo="<code>rate(sum(…))</code> es el error clásico: en un tablero se ve como un pico que nadie explica cada vez que un pod se reinicia. La ventana de <code>rate()</code> necesita al menos dos lecturas: con lecturas cada 5 s, una de 1 min junta 12 (C01 lee cada 15 s y usa 5 min). Y después de cargar reglas nuevas, Prometheus necesita ≈ 1 min de datos para que una tasa de 1 min tenga sentido: antes, una regla puede dar vacío sin estar mal escrita."))

G.append(dict(n=6, id="exemplars", titulo="Del p99 a una request: exemplars", objetivo="Que ≈ 1 % de las requests deje su request_id como exemplar en el histograma de latencia, para pasar de la curva a una request concreta y a su línea.",
    conceptos=["exemplar", "histograma", "request-id"],
    explica="Un exemplar es un id pegado a una observación del histograma: «una de las que cayeron en este bucket es la request tal». <code>se_traza()</code> decide con el hash del <code>request_id</code> (los primeros 8 caracteres hex del sha256, como número, menor que 0.01 × 2³²): la misma request siempre cae del mismo lado, en cualquier pod. En <code>anotar()</code>, si se traza, la latencia se observa con <code>exemplar={'trace_id': request_id}</code>. Para verlos hay dos condiciones: prometheus_client solo los escribe cuando quien lee pide el formato OpenMetrics (Prometheus 3 lo pide), y Prometheus solo los guarda con <code>--enable-feature=exemplar-storage</code>, que viene apagado (el compose del dojo lo prende). En C01 el exemplar lleva a una traza completa (OpenTelemetry y Tempo); en el dojo no hay trazas: lleva al <code>request_id</code>, y de ahí <code>mundo/buscar.py</code> encuentra la línea.",
    codigo=[{"lang": "python", "path": "gateway/app/rastro.py (lo que cambia: se_traza y el exemplar en anotar)", "code": funcion_py(FINAL, "def se_traza(") + "\n\n# …\n\n" + funcion_py(FINAL, "    def anotar("), "nota": "<code>ej</code> es None para el 99 %: la observación es la misma, sin exemplar."}],
    comandos=[
        C("paso 6", "python mundo/recargar.py gateway"),
        C("paso 6", "python mundo/carga.py", nota="30 fotos por segundo durante 30 s."),
        C("paso 6", "curl -s -H 'Accept: application/openmetrics-text", nota="Pidiendo OpenMetrics, el bucket lleva su exemplar: el trace_id, la latencia y la hora."),
        C("paso 6", "curl -s localhost:9952/api/v1/query_exemplars", nota="La API de exemplars de Prometheus (experimental): los de los últimos 2 min, a un archivo."),
        C("paso 6", "python -c", nota="Ordenados del más lento al más rápido."),
        C("paso 6", "python mundo/buscar.py", nota="El exemplar más lento, en los tres lugares donde dejó rastro."),
        C("paso 6", "python verificar.py reglas-de-conteo"),
    ],
    verifica=f"<code>python verificar.py reglas-de-conteo</code>: los 4xx cuentan pero no entran a la latencia, source tiene 4 valores y se_traza elige ≈ 1 %, siempre igual. El exemplar más lento ({f_(EX_MAX, '{:g}')} ms) te llevó a su línea.",
    ojo=f"Con un muestreo que decide al principio, el exemplar casi nunca es de las lentas: aquí los {f_(EXN)} cayeron en los buckets {', '.join('le=' + x for x in EX_LES) or '?'}, los de las requests normales. Y el texto de /metrics lleva a lo más un exemplar por bucket (el último): entre dos lecturas, los demás se pisan. Si no ves ninguno, revisa en orden: que <code>se_traza</code> elija algo, que pidas OpenMetrics y que Prometheus tenga <code>exemplar-storage</code>. Con <code>random()</code> en lugar del hash la muestra sale bien de tamaño, pero nadie puede repetir la decisión después, y dos pods podrían decidir distinto para la misma request reintentada."))

_busca7 = O("paso 7", "python mundo/buscar.py")
_nota_busca7 = ("Una request de hace unos segundos: ya está en el disco del nodo, todavía no en S3 (Fluent Bit sube cada minuto)."
                if "todavía no está" in _busca7 else "Una request de hace ≈ 1 min: en el backend, en el ALB, en el disco del nodo y, ahora, en S3.")
G.append(dict(n=7, id="log-a-s3", titulo="El camino del log a S3", objetivo="Las líneas del disco de cada nodo llegan a S3 cada minuto, comprimidas y con el nombre del nodo; si S3 se cae, la request no se entera, nada se pierde y LogsStale avisa.",
    conceptos=["fluent-bit", "buffer-en-disco", "linea-log", "alerta"],
    explica="En cada nodo corre un Fluent Bit (en C01, un pod de un DaemonSet: uno por nodo, y uno más en cada nodo nuevo). Escribe <code>observabilidad/fluent-bit.conf</code>. La entrada <code>tail</code> sigue los archivos <code>/var/log/containers/gateway-*</code> con el parser <code>cri</code> (separa la hora del runtime, el flujo y tu texto) y anota en su <code>DB</code> hasta dónde leyó cada archivo. El filtro <code>record_modifier</code> le agrega el nodo a cada registro. La salida <code>s3</code> junta lo de cada minuto (<code>upload_timeout 1m</code>; en C01, 5 min) y lo sube con gzip a <code>/logs/crudo/AAAA/MM/DD/HH/&lt;nodo&gt;-&lt;uuid&gt;.gz</code>; la carpeta de la hora sale de la hora del primer registro del archivo, y <code>$UUID</code> es una cadena al azar (de 8 caracteres en el dojo) para que dos archivos no choquen. Lo que no pudo subir lo guarda en disco (<code>store_dir</code>) y lo reintenta. Y una alerta más en <code>reglas.yml</code>: <code>LogsStale</code>, si un nodo lleva 3 min sin subir nada (C01: 30 min), con la hora que publica el vigía de S3. Después, el simulacro: apagas S3 con tráfico.",
    codigo=[{"lang": "text", "path": "observabilidad/fluent-bit.conf", "code": code("observabilidad/fluent-bit.conf"), "nota": "<code>use_put_object On</code>: cada archivo en una sola subida (en C01, así el rol de Fluent Bit escribe sin poder descifrar). Por omisión, <code>upload_timeout</code> es 10m y <code>total_file_size</code> 100M (hasta 1G con <code>use_put_object</code>): aquí sube cada minuto mucho antes de llenarse. <code>store_dir_limit_size</code> por omisión es 0, sin tope; con tope, al llenarse descarta."},
            {"lang": "yaml", "path": "observabilidad/reglas.yml (la alerta que se agrega)", "code": bloque_regla("LogsStale"), "nota": "Sin <code>for</code>: el umbral de 180 s ya es la espera."}],
    comandos=[
        C("paso 7", RECARGAR_P, exacto=True),
        C("paso 7", "python mundo/recargar.py fluent-bit", nota="Como un rollout del DaemonSet: los dos con tu configuración."),
        C("paso 7", "docker compose logs fluent-bit-a 2>&1 | grep -E 'inotify_fs_add|uploaded'", nota="Empezó a seguir los archivos del pod de su nodo; un minuto después, la primera subida."),
        C("paso 7", "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_(input", nota="Lo que leyó la entrada y lo que entregó la salida s3."),
        C("paso 7", "python -c", nota="Los objetos de esta hora en S3: uno por nodo y por minuto."),
        cmd(S("paso 7", "python mundo/buscar.py")[0], _busca7, _nota_busca7),
        C("paso 7", "q 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'", nota="Cuántos segundos hace que llegó el último archivo de cada nodo."),
        C("paso 7", "docker compose stop s3", nota="El simulacro: S3 en mantenimiento."),
        C("paso 7", "python mundo/carga.py", nota="La request no se entera: todas contestan."),
        C("paso 7", "docker compose logs fluent-bit-a --since 90s", nota="Fluent Bit no puede subir (PutObject request failed) y guarda en su buffer."),
        C("paso 7", "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc", nota="Las métricas de reintentos del motor se quedan en 0: el plugin s3 reintenta por su cuenta."),
        C("paso 7", "q 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'", n=1),
        C("paso 7", "python verificar.py log-en-s3", nota="verificar.py sí lo ve."),
        C("paso 7", "curl -s localhost:9952/api/v1/alerts", nota="Más de 3 min sin archivos nuevos: LogsStale, nodo por nodo."),
        C("paso 7", "docker compose start s3"),
        C("paso 7", "docker compose logs fluent-bit-a --since 30s", nota="Al volver S3, sube los pedazos atrasados de un jalón."),
        C("paso 7", "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc", n=1, nota="<code>output_errors_total</code>: los intentos que fallaron mientras S3 no estaba."),
        C("paso 7", "python verificar.py log-en-s3", n=1),
    ],
    verifica=f"<code>python verificar.py log-en-s3</code>: los dos nodos suben a S3, con el nombre de archivo y los campos <code>time</code>, <code>stream</code>, <code>log</code> y <code>nodo</code>, sin pedazos en cuarentena. Con S3 apagado, las {f_(N7)} requests de la carga contestaron ({COD7}){' y LogsStale sonó' if STALE7 else ''}.",
    ojo="Con el <code>retry_limit</code> por omisión, el plugin s3 de Fluent Bit 5.1.5 reintenta un pedazo cada ≈ 5 s y a los 6 intentos se rinde («Chunk file failed to send 6 times, will not retry» y el pedazo va a cuarentena): aguanta ≈ 30 s de S3 caído. En una prueba de la construcción, 3 min de caída mandaron dos pedazos (≈ 2 min de líneas) a cuarentena y no llegaron nunca a S3, con <code>fluentbit_output_retries_failed_total</code> en 0. <code>retry_limit no_limits</code> lo recorta a 5. Con <code>retry_limit 60</code> reintenta cada ≈ 18 s y, al volver S3, subió todo: nunca bloquear la request, pero tampoco perder en silencio. Y por qué los nodos son contenedores con su propio volumen: en esta Mac, con los logs en una carpeta compartida, Fluent Bit no se enteraba de lo que un proceso del Mac agregaba al archivo (Docker Desktop no le avisaba al contenedor por inotify). Es lo que pasó al construir el dojo, no algo documentado. Al arrancar, Fluent Bit lee su DB y sube lo atrasado."))

G.append(dict(n=8, id="parquet", titulo="El job diario: del crudo a Parquet", objetivo="El job diario lee el crudo de ayer, quita los repetidos, se queda con las líneas del gateway y escribe un Parquet por versión del modelo; correrlo dos veces da lo mismo.",
    conceptos=["al-menos-una-vez", "parquet-particiones"],
    explica="Escribe <code>diario/a_parquet.py</code>, la primera parte del job <code>monitoreo-diario</code> que en C01 corre a la 01:00 UTC. Lee los archivos de <code>logs/crudo/</code> del día, en UTC, y los de la hora 00 del siguiente (un archivo subido a las 00:00:40 trae líneas de las 23:59). Se queda con los registros de stdout cuyo texto es un JSON con <code>request_id</code> y quita los repetidos: Fluent Bit entrega al menos una vez, y si una subida se reintenta después de que S3 sí la guardó, el mismo archivo llega dos veces. La llave es (<code>request_id</code>, <code>time</code>): el mismo id con otra hora es otra request de verdad. Escribe Parquet, una tabla por columnas, en <code>logs/predicciones/dt=AAAA-MM-DD/model_version=…/</code>: una consulta de un día y una versión solo lee esa carpeta. Antes de escribir borra lo que hubiera de ese día: correrlo dos veces da lo mismo (idempotente). El log de ayer trae el rollout de la 14 a la 15 a las 16:00 UTC: salen dos carpetas.",
    codigo=[{"lang": "python", "path": "diario/a_parquet.py", "code": code("diario/a_parquet.py"), "nota": "DuckDB escribe el Parquet con los tipos de <code>COLUMNAS</code>: la hora como TIMESTAMP, no como texto."}],
    comandos=[
        C("paso 8", "time python diario/a_parquet.py", code_="python diario/a_parquet.py", quitar=r"^real", nota=f"El día de ayer en {f_(T8, '{:.1f}')} s."),
        C("paso 8", "python diario/a_parquet.py", exacto=True, nota="Otra vez: lo mismo, no el doble."),
        C("paso 8", "python -c", nota="DuckDB lee los Parquet: filas, p99 y 5xx por versión, y el cambio de versión a las 16:00 UTC."),
        C("paso 8", "python verificar.py parquet"),
    ],
    verifica="<code>python verificar.py parquet</code>: " + " y ".join(f"{v}, {n} filas" for v, n in POR_V8) + ", sin repetidos, y cuadra con una cuenta independiente del crudo.",
    ojo=f"El día se cuenta en UTC, igual que la carpeta de S3 y la hora del runtime: si filtras con la hora local de tu Mac, pierdes o duplicas las filas de la frontera. Sin quitar repetidos, los {f_(AYER_DUP)} archivos subidos dos veces meten {f_(REP8)} filas de más, y el join del mes contaría esas fotos dos veces. Y si el job agrega en lugar de reemplazar, un reintento duplica el día entero."))

_nota_err9 = (f"La regla del gateway: {f_(mul(ERR9, 100), '{:.1f}')} %. Son las pocas requests que llegaron al gateway en los segundos antes de que el ALB lo diera de baja (2 revisiones fallidas, cada 2 s)."
              if ERR9 else "La regla del gateway no ve los 503: no le llegan requests.")
_nota_al9 = ("ALB5xx sonando; ClassifierHigh5xxRate, en pending por esas pocas. Cuando su ventana de 1 min las deja atrás, la fracción del gateway se queda sin requests y se apaga, aunque la caída siga."
             if PEND9 else "Solo suena ALB5xx: la del gateway no tiene requests que mirar.")
G.append(dict(n=9, id="punto-ciego", titulo="Lo que el gateway no ve", objetivo="Las dos alertas que faltan, GatewaySinLectura y ALB5xx, y la prueba de lo que el gateway no ve: con Triton caído, el ALB contesta 503 él mismo y solo sus métricas lo cuentan.",
    conceptos=["punto-ciego-alb", "alerta", "scrape"],
    explica="Dos alertas para los puntos ciegos. <code>GatewaySinLectura</code> suena si Prometheus no lee los 2 pods; con <code>absent(up{job=\"gateway\"} == 1)</code> suena también cuando no hay ninguna serie: si un cambio de etiquetas deja a tu job sin pods, las alertas que miran <code>classifier_*</code> evalúan sobre nada y no suenan, y esta sí. <code>ALB5xx</code> mira la fracción de 5xx que pone el propio ALB. ¿Por qué hace falta? Cuando Triton se cae, los pods del gateway contestan 503 en <code>/readyz</code> y el ALB los da de baja de su target group (en C01: salen de los Endpoints y el AWS Load Balancer Controller los da de baja); sin destinos registrados, el ALB contesta 503 él mismo y las requests nunca llegan a un pod. <code>classifier_requests_total</code> no sube y la fracción de 5xx del gateway se queda sin requests: el peor momento del servicio se ve tranquilo. Lo cuentan las métricas del ALB (en C01, CloudWatch: <code>HTTPCode_ELB_5XX_Count</code>). Como <code>RequestCount</code> solo cuenta las requests para las que el ALB pudo elegir un destino, el denominador suma las dos.",
    codigo=[{"lang": "yaml", "path": "observabilidad/reglas.yml (las dos alertas que se agregan)", "code": bloque_regla("GatewaySinLectura") + "\n" + bloque_regla("ALB5xx"), "nota": "En el ALB de AWS, el 503 propio sale cuando no queda ningún destino registrado. Si los destinos siguen registrados pero todos fallan el health check, el ALB «abre el paso» (fail open) y les manda tráfico igual; el ALB del dojo solo imita el primer caso."}],
    comandos=[
        C("paso 9", RECARGAR_P, exacto=True),
        C("paso 9", "python verificar.py alertas"),
        C("paso 9", "python mundo/nodo.py parar triton", nota="Triton se cae. En ≈ 4 s, el ALB da de baja a los dos pods."),
        C("paso 9", "python mundo/carga.py", nota="Todas 503."),
        C("paso 9", "tail -1 logs/alb.log", nota="El access log del ALB: elb_status_code 503, sin target, con su error_reason."),
        C("paso 9", "curl -s localhost:8957/metrics", nota="Las métricas «de CloudWatch» del ALB: sus 503 propios y 0 destinos sanos."),
        C("paso 9", "q 'classifier:errores_servidor:ratio_rate1m'", nota=_nota_err9),
        C("paso 9", "q 'sum(rate(classifier_requests_total[1m]))'", nota="Lo que cuenta el gateway: casi nada."),
        C("paso 9", "q 'sum(rate(alb_httpcode_elb_total", nota="Lo que contesta el ALB él mismo, por segundo."),
        C("paso 9", "curl -s localhost:9952/api/v1/alerts", nota=_nota_al9),
        C("paso 9", "python verificar.py de-punta-a-punta", nota="El check sí lo ve: manda una foto por el ALB, como un caller."),
        C("paso 9", "python mundo/nodo.py arrancar triton"),
        C("paso 9", "curl -s localhost:9952/api/v1/alerts", n=1, nota="Un minuto después: sin alertas. La ventana de 1 min ya no ve los 503."),
        C("paso 9", V, exacto=True, nota="Al final de la estación: los 12 checks."),
    ],
    verifica=f"Con Triton caído, las {f_(N9)} requests de la carga recibieron 503 del ALB mientras el gateway contaba {f_(GW9, '{:.2f}')} req/s, y ALB5xx sonó. Con Triton de vuelta, <code>python verificar.py</code>: {f_(VERDE9)} de 12 en verde.",
    ojo="Un 4xx también puede ser del ALB: si la llave con que verifica los tokens cambia, contesta 401 a todos sin tocar un pod, y el gateway se ve tranquilo otra vez (la falla «La rotación de llaves»). Antes de confiar en una alerta, pregunta qué requests no cuenta. Y espera ≈ 1 min después de arreglar algo antes de correr <code>verificar.py alertas</code>: las ventanas de 1 min todavía ven el problema."))

REPARTO = {
    1: (["request-id", "linea-log", "observabilidad"], ["volumen-log"]),
    2: (["tres-relojes"], ["tres-relojes"]),
    3: (["contador-gauge", "histograma", "cardinalidad"], ["series-por-pod"]),
    4: (["scrape", "descubrimiento"], ["muestras-prometheus"]),
    5: (["promql-rate", "recording-rule", "alerta"], ["tasa-reinicio"]),
    6: (["exemplar"], ["exemplars-uno-por-ciento"]),
    7: (["fluent-bit", "buffer-en-disco"], ["aguante-buffer"]),
    8: (["al-menos-una-vez", "parquet-particiones"], ["repetidos"]),
    9: (["punto-ciego-alb"], ["lo-que-contesta-el-alb"]),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
G[1]["en_pagina"]["del_paso0"] = [3, 4, 5]      # carga --una, los logs del nodo y el verificar.py del principio
e["guiado"] = G

# ---------------------------------------------------------------- Construir solo
e["solo"] = {
    "reglas": [
        "Empieza con el kit recién descomprimido en una carpeta nueva y <code>python mundo/crear.py</code>. El mundo es uno solo (los mismos puertos y el mismo proyecto de compose): si el de Construir con ayuda sigue prendido en otra carpeta, apágalo allá antes (<code>python mundo/nodo.py parar</code> y <code>docker compose down -v</code>).",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo tuyo (<code>gateway/app/rastro.py</code>, <code>observabilidad/prometheus.yml</code>, <code>observabilidad/reglas.yml</code>, <code>observabilidad/fluent-bit.conf</code> y <code>diario/a_parquet.py</code>).",
        "Cada objetivo tiene su check; corre <code>python verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Un archivo bien escrito que no se recargó no cuenta: <code>python mundo/recargar.py gateway|prometheus|fluent-bit</code>. Para ver algo con tráfico, <code>python mundo/carga.py --tasa 30 --segundos 60</code> en otra terminal; Prometheus necesita ≈ 1 min de datos para una tasa de 1 min.",
        "Las reglas de otros equipos no se tocan: <code>mundo/</code>, <code>gateway.yaml</code>, <code>gateway/app/main.py</code> y los nombres de las métricas.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3, Prometheus, los dos nodos con su pod y su Fluent Bit, Triton, el ALB y el vigía arriba, y una foto por el ALB contestada.", "check": "mundo"},
        {"n": 2, "objetivo": "Cada request con un nombre: el X-Request-ID del caller si es sano (también en un 415), uno nuevo si falta o no es sano, en la respuesta y en el log.", "check": "request-id", "pista": "¿Qué pasa en el log si un caller manda un id con un salto de línea?"},
        {"n": 3, "objetivo": "Una sola línea por request en stdout, en JSON compacto, con request_id, ms y status, sin hora ni foto, y con el X-Client-Source tal como llegó.", "check": "linea-log", "pista": "¿Quién pone la hora de cada línea en el disco del nodo?"},
        {"n": 4, "objetivo": "Las 8 métricas del contrato en /metrics, con sus nombres, tipos, etiquetas y bordes, y cada categoría desde el arranque.", "check": "metricas"},
        {"n": 5, "objetivo": "Los 4xx cuentan pero no entran a la latencia, la fuente tiene 4 valores venga lo que venga, y ≈ 1 % de las requests deja exemplar, siempre las mismas.", "check": "reglas-de-conteo", "pista": "¿Qué le hace al p99 un 415 que tarda microsegundos?"},
        {"n": 6, "objetivo": "Prometheus lee los 2 pods del gateway, una vez cada uno, con las etiquetas pod, nodo y hash.", "check": "prometheus-lee", "pista": "¿Qué pasa si lees a cada pod por los dos Services que lo eligen?"},
        {"n": 7, "objetivo": "Las 3 recording rules (requests por segundo, fracción de errores del servidor que da 0 y no vacío, p99 por versión), con la tasa antes de la suma.", "check": "consultas", "pista": "¿Qué da una división cuando la serie de arriba no existe?"},
        {"n": 8, "objetivo": "Las 5 alertas cargadas y sanas, sin sonar con el mundo sano; una de ellas suena también cuando no hay nada que leer.", "check": "alertas", "pista": "¿Cómo suena una alerta sobre una serie que desapareció?"},
        {"n": 9, "objetivo": "Las series de cada pod acotadas: ninguna etiqueta con un valor por request.", "check": "series-acotadas"},
        {"n": 10, "objetivo": "Los dos nodos suben su log a S3 cada minuto, con el nombre del nodo en el archivo y en cada registro, sin perder pedazos si S3 se cae un rato.", "check": "log-en-s3", "pista": "¿Cuántas veces reintenta Fluent Bit antes de rendirse, si no le dices nada?"},
        {"n": 11, "objetivo": "El día de ayer en Parquet, una carpeta por versión, sin repetidos ni líneas que no son del gateway, y correrlo dos veces da lo mismo.", "check": "parquet", "pista": "¿Qué dos registros son de verdad la misma línea?"},
        {"n": 12, "objetivo": "Una foto por el ALB contesta 200 con model_version y su X-Request-ID, y lo que el ALB manda a los pods es lo que el gateway cuenta.", "check": "de-punta-a-punta"},
    ],
}

# ---------------------------------------------------------------- fallas
FAL = []


def falla(id_, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto_, check, nota=""):
    r = ROMPER[id_]
    FAL.append({"id": id_, "titulo": r["titulo"], "tipo": r["tipo"], "historia": r["historia"], "sintoma": sintoma,
                "hipotesis": hipotesis, "confirma": cmd(confirma_code, confirma_salida, nota), "arreglo": arreglo,
                "concepto": concepto_, "check": check})


def sint(f):
    s = F(f"{f} verificar", filtro=r"^✗")
    return "<code>verificar.py</code>: " + (s or F(f"{f} verificar"))


NOTA_Q = "<code>q '…'</code> le pregunta a la API de Prometheus, como la función del paso 4 (aquí imprime las etiquetas a la manera de Python)."
ALERTAS_F = re.search(r"^alertas\(\) \{ (.*?); \}$", PROBARF, re.S | re.M).group(1)
LOG_PLAT = "git log -1 -p --format='%h %an: %s' -- mundo/plataforma.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"

falla("etiqueta-sin-techo", sint("etiqueta-sin-techo"),
      ["Una métrica nueva tiene una etiqueta con un valor por request.", "Volvió el caller de la fuente loca y la etiqueta source creció.", "Las series vienen de otro lado (Triton, el ALB) y el gateway no tiene nada que ver."],
      "curl -s localhost:8951/metrics | grep -c '^classifier_request_debug_seconds_bucket'\ncurl -s localhost:8951/metrics | grep '^classifier_request_debug_seconds_count' | head -2\nq 'count({__name__=~\"classifier_request_debug_seconds.*\"})'\nq 'prometheus_tsdb_head_series'\ngit log -1 -p --format='%h %an: %s' -- gateway/app/main.py | grep -E '^[0-9a-f]{7}|^\\+[^+]'",
      F("etiqueta-sin-techo metrics") + "\n\n" + F("etiqueta-sin-techo prometheus") + "\n\n" + F("etiqueta-sin-techo log"),
      f"El commit de Beto en <code>gateway/app/main.py</code> agregó un histograma <code>classifier_request_debug_seconds</code> con la etiqueta <code>request_id</code>: cada request crea su propia combinación, 15 series nuevas (11 buckets, +Inf, <code>_sum</code>, <code>_count</code> y <code>_created</code>). Con 20 s de carga, un pod ya exponía {f_(DEBUG_N)} buckets y Prometheus guardaba {f_(DEBUG_P)} series de ese histograma. A 5 fotos/s son ≈ 75 series nuevas por segundo; en C01, 150 millones al día: Prometheus se queda sin memoria en horas. Todo contesta 200 y la métrica «funciona»: esa es la trampa. Lo que Beto buscaba ya existe: el exemplar de la latencia (paso 6) y la línea de log. Arreglo: <code>git revert</code> del commit y <code>python mundo/nodo.py reiniciar gateway</code>. Las series viejas se quedan en Prometheus hasta que dejan de recibir muestras; las nuevas ya no nacen.",
      "cardinalidad", "series-acotadas", NOTA_Q)
falla("monitor-perdido", sint("monitor-perdido"),
      ["Prometheus no puede conectarse a los pods (la red, el puerto).", "Cambiaron las etiquetas de los pods y el keep de tu job ya no elige ninguno.", "El gateway dejó de exponer /metrics."],
      "python -c \"import json;[print(t['targets'], t['labels'].get('__meta_kubernetes_pod_label_app_kubernetes_io_name')) for t in json.load(open('nodo/descubrimiento/pods.json'))]\"\nq 'up{job=\"gateway\"}'\nq 'classifier:errores_servidor:ratio_rate1m'\nalertas\n" + LOG_PLAT,
      F("monitor-perdido descubrimiento") + "\n\n" + F("monitor-perdido up") + "\n\n" + F("monitor-perdido log"),
      "El commit de plataforma en <code>mundo/plataforma.yaml</code> cambió la etiqueta de los pods del gateway de <code>app.kubernetes.io/name: gateway</code> a <code>classifier-gateway</code>. Tu job elige los pods con un <code>keep</code> sobre esa etiqueta: ya no elige ninguno. Nada truena: el gateway contesta, Prometheus no se queja (no hay objetivo que falle), y las alertas que dependen de <code>classifier_*</code> evalúan sobre nada y no suenan. Solo GatewaySinLectura lo ve, porque mira <code>up</code> con absent. Arreglo: <code>git revert</code> del commit y <code>python mundo/nodo.py publicar</code>. Aceptar el nombre nuevo en tu <code>prometheus.yml</code> también arregla, pero el arreglo de fondo es acordar el cambio antes: esa etiqueta era un contrato entre dos equipos.",
      "descubrimiento", "prometheus-lee", NOTA_Q)
falla("s3-caido", sint("s3-caido"),
      ["S3 no contesta.", "El Fluent Bit del nodo a dejó de leer los archivos del pod.", "Fluent Bit se rindió y mandó pedazos a cuarentena."],
      "docker compose logs fluent-bit-a --since 40s 2>&1 | grep -iE 'error|fail' | tail -3\ncurl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(retries|errors)_total'\ndocker compose ps s3 --all --format '{{.Service}} {{.State}} {{.Status}}'",
      F("s3-caido fluent") + "\n\n" + F("s3-caido ps"),
      "El S3 del mundo (RustFS) está apagado. El gateway no se entera: escribe en stdout y sigue; el runtime guarda en el disco del nodo, y cada Fluent Bit junta lo que no puede subir en su buffer en disco (<code>store_dir</code>) y lo reintenta. Se degrada el monitoreo, no el servicio: ninguna request falló, y <code>de-punta-a-punta</code> sigue en verde. Arreglo: <code>docker compose start s3</code>; en segundos los Fluent Bit suben lo atrasado. No se pierde ninguna línea mientras el buffer aguante y mientras Fluent Bit no se rinda: con el <code>retry_limit</code> por omisión, a los 6 intentos (≈ 30 s) el pedazo se va a cuarentena y esas líneas no llegan a S3. Por eso tu <code>fluent-bit.conf</code> lleva <code>retry_limit 60</code>.",
      "buffer-en-disco", "log-en-s3")
falla("lector-caido", sint("lector-caido"),
      ["S3 se cayó.", "El Fluent Bit del nodo b no corre.", "El pod del nodo b dejó de escribir su log."],
      "docker compose ps --all --format '{{.Service}} {{.State}}'\nalertas\nq 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'",
      F("lector-caido ps") + "\n\n" + F("lector-caido alerta"),
      "El Fluent Bit del nodo b está apagado (en C01: el pod del DaemonSet de ese nodo no corre por un taint, un OOMKilled o un nodo nuevo donde no cupo). El otro nodo sube normal: por eso LogsStale va por nodo. Las líneas del pod del nodo b se quedan en el disco del nodo y, mientras el kubelet no las rote (5 archivos de 10 MiB), no se pierden. Arreglo: <code>docker compose start fluent-bit-b</code>; al volver, Fluent Bit sigue donde se quedó (su DB) y en ≈ 1 min sube lo atrasado.",
      "fluent-bit", "log-en-s3", NOTA_Q)
falla("triton-caido", sint("triton-caido"),
      ["El gateway está bien y el problema es del backend.", "Los pods no están listos y el ALB contesta él mismo.", "El token de los callers dejó de servir."],
      "q 'sum(rate(classifier_requests_total[1m]))'\nq 'classifier:errores_servidor:ratio_rate1m'\ncurl -s localhost:8957/metrics | grep -E '^alb_(httpcode_elb_total\\{code=\"503\"\\}|healthy_host_count)'\ntail -1 logs/alb.log\nalertas\npython mundo/nodo.py estado",
      F("triton-caido metricas") + "\n\n" + F("triton-caido estado"),
      "Triton está apagado. Los dos pods del gateway contestan 503 en <code>/readyz</code>, salen del target group (en C01: salen de los Endpoints y el AWS Load Balancer Controller los da de baja) y el ALB, sin destinos registrados, contesta 503 él mismo: las requests nunca llegan a un pod. <code>classifier_requests_total</code> casi no sube, la fracción de 5xx del gateway no tiene requests (o queda en 0) y ClassifierHigh5xxRate no suena. Solo lo ven las métricas del ALB (<code>alb_httpcode_elb_total{code=\"503\"}</code> y <code>alb_healthy_host_count</code> en 0) y la alerta ALB5xx. Arreglo: <code>python mundo/nodo.py arrancar triton</code>; en ≈ 1 min la ventana de las tasas ya no ve los 503 y ALB5xx se apaga.",
      "punto-ciego-alb", "de-punta-a-punta", NOTA_Q)
falla("llave-rotada", sint("llave-rotada"),
      ["El gateway truena con las requests del backend.", "El ALB rechaza los tokens y contesta 401 él mismo.", "Los pods salieron del target group."],
      "curl -s localhost:8957/metrics | grep -E '^alb_httpcode_elb_total\\{code=\"401\"\\}'\ntail -1 logs/alb.log\n" + LOG_PLAT,
      F("llave-rotada alb") + "\n\n" + F("llave-rotada log"),
      "El commit de plataforma cambió <code>alb.jwt.llave</code> en <code>mundo/plataforma.yaml</code>, pero el proveedor de identidad sigue firmando con la anterior (<code>mundo/callers.json</code>): toda firma falla y el ALB contesta 401 él mismo. Los pods están sanos, el gateway no recibe nada y sus métricas se ven tranquilas; los 401 solo están en el ALB. Un 4xx no es culpa de Alba… salvo cuando lo pone su propia puerta. Arreglo: <code>git revert</code> del commit y <code>python mundo/nodo.py reiniciar alb</code>; en ≈ 1 min la ventana de las tasas ya no ve los 401. En C01, la rotación se hace publicando la llave nueva junto a la vieja (JWKS) antes de firmar con ella.",
      "punto-ciego-alb", "de-punta-a-punta")
for f in FAL:   # «alertas» en el código de cómo confirmar: la función de probar-fallas.sh, tal cual
    f["confirma"]["code"] = f["confirma"]["code"].replace("\nalertas\n", "\n" + ALERTAS_F + "\n")
e["fallas"] = FAL

e["listo"] = [
    "Cada request lleva su request_id de punta a punta: el del caller si es sano, uno nuevo si no; en la respuesta, en la línea y, en ≈ 1 %, como exemplar.",
    "Cada request deja una sola línea de JSON compacto en stdout, sin hora, que el runtime guarda en el disco de su nodo.",
    "Las 8 métricas del contrato suman lo que deben: los 4xx cuentan pero no entran a la latencia, y ninguna etiqueta tiene un valor por request.",
    "Prometheus lee cada pod una sola vez, con pod, nodo y hash, y tiene 3 recording rules y 5 alertas sanas.",
    "Fluent Bit sube el log de cada nodo a S3 cada minuto; con S3 caído, la request no se enteró y nada se fue a cuarentena.",
    "El crudo de ayer está en Parquet por versión, sin repetidos, y correr el job dos veces da lo mismo.",
    "Viste lo que el gateway no ve: con Triton caído, solo el ALB y ALB5xx contaron los 503.",
]

e["repaso"] = {
    "memo": "<b>Nombrar, escribir, sumar, leer, llevar y mirar lo que no se ve.</b> Cada request recibe un <b>nombre</b> (el request_id del caller si es sano, o un UUID v4) que viaja en la respuesta, en la línea y en el exemplar. <b>Escribe</b> una línea de JSON compacto en stdout, sin hora: el runtime la guarda con la suya. <b>Suma</b> en contadores e histogramas con nombres fijos y etiquetas de pocos valores. Prometheus <b>lee</b> cada pod una sola vez, guarda las preguntas de todos los días como recording rules con <code>sum(rate(…))</code> y evalúa alertas con su <code>for</code>. Fluent Bit <b>lleva</b> el log a S3 cada minuto, con un buffer que aguanta si S3 se cae, y al día siguiente queda en Parquet, sin repetidos y por versión. Y alguien <b>mira</b> lo que el gateway no ve: el ALB contestando él mismo.",
    "trampa": "Un id como etiqueta de una métrica (una serie por request); <code>rate(sum(…))</code> en lugar de <code>sum(rate(…))</code>; un log que espera a la red; o creer que una tasa de errores calculada en el gateway ve las requests que nunca le llegaron.",
    "entrevista": [
        {"q": "¿Qué dejas escrito de cada request de un modelo en producción, y dónde?", "a": "Tres rastros unidos por el mismo request_id. Una línea de log estructurada por request (id, caller, versión del modelo, top-k con scores, tiempos por tramo, status), en stdout, que un agente por nodo sube a un almacén de objetos y un job diario pasa a Parquet: de ahí salen el drift, la aceptación y las etiquetas del mes. Métricas: contadores e histogramas con etiquetas de pocos valores, leídas por Prometheus, para las alertas. Y trazas o exemplars en ≈ 1 %, para pasar de una curva a una request concreta. Ninguno puede frenar la respuesta."},
        {"q": "¿Por qué no pones el request_id o el user_id como etiqueta de una métrica?", "a": "Porque cada combinación de etiquetas es una serie, y un valor por request es una serie por request: en un histograma de 11 bordes son 15 series nuevas por request, 150 millones al día con 10 M requests, y Prometheus se queda sin memoria. Las etiquetas solo llevan listas cortas y cerradas (código, versión, una fuente reducida a 4 valores); lo que identifica a una request va al log, y del agregado se llega a una request con exemplars."},
        {"q": "Se cae tu almacén de logs (S3, Elasticsearch). ¿Qué le pasa al usuario?", "a": "Nada: el servicio escribe en stdout y sigue, el runtime guarda en el disco del nodo y el agente (Fluent Bit) junta en un buffer en disco y reintenta. Se degrada el monitoreo, no el servicio. Lo que cuidas es no perder en silencio: un buffer con tamaño calculado (en C01, ≈ 16 h), reintentos suficientes (con los de por omisión, el plugin s3 de Fluent Bit se rinde en ≈ 30 s) y una alerta de frescura por nodo (LogsStale)."},
        {"q": "¿Cómo calculas la tasa de errores y el p99 de un servicio con varios pods en Prometheus?", "a": "Errores: sum(rate(requests{code=~\"5..\"}[5m])) dividido entre sum(rate(requests{code!~\"4..\"}[5m])), con or vector(0) arriba para que sin errores dé 0 y no vacío; los 4xx fuera porque son culpa del caller. p99: histogram_quantile(0.99, sum by (le) (rate(latency_bucket[5m]))), sumando los buckets de todos los pods. Siempre la tasa antes de la suma: rate(sum(…)) convierte el reinicio de un pod en un pico falso. Y las dos como recording rules."},
        {"q": "La tasa de 5xx del servicio está en cero y soporte dice que no funciona. ¿Qué revisas?", "a": "Qué requests no cuenta esa tasa. Primero, si Prometheus está leyendo los pods (up, una alerta con absent): una etiqueta cambiada deja al job sin objetivos y todo se ve en cero. Después, el balanceador: si los pods salieron del target group (por ejemplo, porque su dependencia cayó y fallan la readiness), el ALB contesta 503 él mismo y el servicio no ve nada; o un 401 por una llave rotada. Eso solo está en las métricas del ALB (HTTPCode_ELB_5XX_Count en CloudWatch) y en su access log."},
        {"q": "El p99 subió a las 14:05. ¿Cómo llegas de esa curva a una request concreta?", "a": "Con exemplars: el histograma de latencia guarda, junto a algunos buckets, el id de una request trazada que cayó ahí; Grafana los dibuja sobre la curva y abres su traza o, con el request_id, su línea de log. Ojo: el muestreo decide al principio (≈ 1 % por el hash del id), así que pocas lentas tienen exemplar; para estudiar todas las lentas, el log del día (filtrar por ms.total y buscar qué tienen en común) o tail sampling."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-request/CLAUDE.md",
    "guiado": "content/estaciones/c01-request/prompts/guiado.md",
    "solo": "content/estaciones/c01-request/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-request/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-request/prompts/romper-solo.md",
}

if any(v != CARPETA.name for v in USADAS.values()):
    print("ℹ fallas de otra corrida: " + ", ".join(f"{k} ({v})" for k, v in USADAS.items() if v != CARPETA.name))
if FALTAN:
    print("⚠ borrador: faltan " + str(len(dict.fromkeys(FALTAN))) + ":\n  " + "\n  ".join(dict.fromkeys(FALTAN)))
(APP / "content/estaciones/c01-request.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· conceptos:", len(e["conceptos"]), "· precálculos:", len(e["precalculos"]["cuentas"]),
      "· pasos:", len(G), "· objetivos:", len(e["solo"]["objetivos"]), "· fallas:", len(FAL), "· preguntas:", len(e["repaso"]["entrevista"]))
