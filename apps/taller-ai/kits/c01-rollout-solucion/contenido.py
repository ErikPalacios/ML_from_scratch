"""Arma content/estaciones/c01-rollout.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e10 && bash probar-fallas.sh /tmp/e10     # deja /tmp/e10.log y /tmp/e10.fallas.log
    python3 contenido.py /tmp/e10                                  # escribe el JSON con esas salidas
    python3 contenido.py /tmp/e10 --borrador                       # lo escribe aunque falten secciones (para revisar)

Ninguna salida se copia a mano: cada `salida` sale de un comando de una sección «### nombre» de los logs.
- <carpeta>.log: los pasos 0 a 9 del Guiado y el «final» («### paso N: …», cada comando como «$ comando» y su salida).
- <carpeta>.fallas.log: «### <falla> <etapa>», cada sección directamente con su salida.
El código de los pasos sale de los archivos de la solución (k8s/*.yaml, gateway/app/sombra.py, sombra/reporte.py,
ci/promover.py, RUNBOOK.md, pasos.py) y del kit, nunca escrito aquí. Los números de los modelos de juguete (acuerdo,
baja confianza, PSI) salen de kits/c01-rollout/mundo/modelos/referencia.json, la huella que dejó fabricar.py.
"""
import json
import math
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
BORRADOR = "--borrador" in sys.argv
CARPETA = Path(args[0]) if args else sys.exit("uso: python3 contenido.py <carpeta de probar.sh> [--borrador]")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
KIT = APP / "kits" / "c01-rollout"
RUTA = str(CARPETA)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
FALTAN = []


def leer(p: Path) -> str:
    return p.read_text() if p.exists() else ""


def limpiar(t: str) -> str:
    t = ANSI.sub("", t)
    # el mensaje de verificar.py alias de hoy corta los digests de las etiquetas (antes los imprimía completos)
    t = re.sub(r"'digest': 'sha256:([0-9a-f]{12})[0-9a-f]{52}'", r"'digest': 'sha256:\1…'", t)
    base = str(Path(RUTA).parent).removeprefix("/private")   # cualquier corrida de la misma carpeta (p10, r4…)
    t = re.sub(r"(/private)?" + re.escape(base) + r"/[A-Za-z0-9_-]+", "~/c01-rollout", t)
    lineas = [ln.rstrip() for ln in t.split("\n")
              if "Failed to persist telemetry" not in ln and not re.match(r"^(user|sys)\s+[\dms.]+$", ln.strip())]
    return "\n".join(lineas)


def secciones(texto: str) -> dict:
    out = {}
    for m in re.finditer(r"^### ([^\n]+)\n(.*?)(?=^### |\Z)", limpiar(texto), re.S | re.M):
        out[m.group(1).strip()] = m.group(2)
    return out


def comandos(cuerpo: str) -> list:
    out, cur = [], None
    for ln in cuerpo.split("\n"):
        if ln.startswith("$ "):
            cur = [ln[2:], []]
            out.append(cur)
        elif cur is not None:
            if ln.startswith("--- a los ") and cur[0] in ("ro", "pesos", "corridas"):   # un mirar sin su «$ (cada 5 s…)»
                cur = ["(cada 5 s: fase y peso del canary)", []]
                out.append(cur)
            cur[1].append(ln)
    return [(c, "\n".join(o).strip("\n")) for c, o in out]


LOG = secciones(leer(Path(f"{CARPETA}.log")))
LOGF = secciones(leer(Path(f"{CARPETA}.fallas.log")))


def falta(que: str) -> str:
    FALTAN.append(que)
    if not BORRADOR:
        sys.exit(f"✗ falta {que}")
    return "(pendiente: " + que + ")"


def seccion(nombre: str):
    """La sección del log del Guiado cuyo nombre empieza con `nombre` («paso 3» encuentra «paso 3: la sombra…»)."""
    k = next((k for k in LOG if k == nombre or k.startswith(nombre + ":")), None)
    return LOG[k] if k else None


def S(sec: str, empieza: str, n: int = 0):
    """(comando, salida) del n-ésimo comando de la sección que empieza con `empieza`."""
    cuerpo = seccion(sec)
    if cuerpo is None:
        return empieza, falta(f"la sección «{sec}» en {CARPETA.name}.log")
    xs = [(c, o) for c, o in comandos(cuerpo) if c.startswith(empieza)]
    if len(xs) <= n:
        return empieza, falta(f"el comando «{empieza}…» (#{n + 1}) en «{sec}»")
    return xs[n]


def O(sec: str, empieza: str, n: int = 0, filtro=None, quitar=None, max_lineas=None) -> str:
    out = S(sec, empieza, n)[1]
    lineas = out.split("\n")
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).strip("\n")


def F(nombre: str, filtro=None, quitar=None) -> str:
    if nombre not in LOGF:
        return falta(f"la sección «{nombre}» en {CARPETA.name}.fallas.log")
    lineas = LOGF[nombre].strip("\n").split("\n")
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
    return float(str(v).replace(",", ""))


def txt(texto: str, rx: str, todas=False) -> str:
    ms = re.findall(rx, texto or "", re.M)
    return (ms[-1] if todas else ms[0]) if ms else "?"


def carga(texto: str) -> dict:
    """Lo que contó mundo/carga.py: del resumen final o, si la mataron antes (kill), de la suma de sus renglones."""
    out = {"total": None, "ok": None, "c5xx": None, "por_version": {}}
    if not texto or texto.startswith("(pendiente"):
        return out
    m = re.search(r"^(\d+) fotos en", texto, re.M)
    if m:
        out["total"] = int(m.group(1))
        cod = dict((k, int(v)) for k, v in re.findall(r"(\d+): (\d+)", txt(texto, r"^\s+por código: (.*)$")))
        out["ok"], out["c5xx"] = cod.get("200", 0), sum(v for k, v in cod.items() if k.startswith("5"))
        out["por_version"] = {v: int(n) for v, n in re.findall(r"^\s+(\S+): (\d+) \(", texto, re.M)}
        return out
    ok = c5 = otros = 0
    pv = Counter()
    for ln in re.findall(r"^\s+\d+ s  (.*)$", texto, re.M):
        for k, n in re.findall(r"código (\d+) (\d+)", ln):
            (c5 := c5 + int(n)) if k.startswith("5") else None
            if not k.startswith("5"):
                otros += int(n)
        for v, n in re.findall(r"(\S+-\S+) (\d+) \(", ln):
            pv[v] += int(n)
            ok += int(n)
    out.update(total=ok + c5 + otros, ok=ok, c5xx=c5, por_version=dict(pv))
    return out


def ultima(v: str) -> str:
    """«[8.562036095579627]» → «8.56»."""
    try:
        return f"{float(v.strip('[]').strip(chr(39))):.3g}"
    except ValueError:
        return v


def f_(x, fmt="{:,.0f}") -> str:
    """Un número formateado, o «?» si todavía no salió en los logs."""
    return "?" if x is None else fmt.format(x)


def code(rel: str, base: Path = SOL) -> str:
    return (base / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


# Las funciones de probar.sh, para mostrar el comando de verdad en lugar de su nombre corto («ro», «pesos»…).
PROBAR = code("probar.sh")


def funcion(nombre: str) -> str:
    m = re.search(rf"^{nombre}\(\) \{{ (.*?); \}}$", PROBAR, re.S | re.M)
    if not m:
        sys.exit(f"✗ no encontré la función {nombre} en probar.sh")
    return m.group(1).strip()


CORTOS = {"ro": funcion("ro"), "pesos": funcion("pesos"), "corridas": funcion("corridas")}
MIRAR = ("while sleep 5; do kubectl -n classifier get rollout gateway "
         "-o jsonpath='{.status.phase} {.status.canary.weights.canary.weight}{\"\\n\"}'; done")


def C(sec, empieza, n=0, nota="", code_=None, **kw):
    """Un comando del log tal como se corrió (o con `code_` si se muestra distinto) y su salida real."""
    c, _ = S(sec, empieza, n)
    if code_ is None:
        code_ = CORTOS.get(c, c)
    return cmd(code_, O(sec, empieza, n, **kw), nota)


def segundos(real: str):
    m = re.search(r"real\s+(\d+)m([\d.]+)s", real or "")
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


V = "python3 verificar.py"

# ---------------------------------------------------------------- los modelos de juguete (de referencia.json)
REF = json.loads((KIT / "mundo" / "modelos" / "referencia.json").read_text())
MOD = REF["modelos"]
NFOTOS = len(MOD["v14"]["top1"])


def acuerdo(a, b):
    return sum(x == y for x, y in zip(MOD[a]["top1"], MOD[b]["top1"])) / NFOTOS


def baja(a):
    return sum(s < 0.3 for s in MOD[a]["score"]) / NFOTOS


def psi_mod(a, b):
    """El mismo PSI que el AnalysisTemplate (proporciones con piso 0.001), sobre las fotos del mundo."""
    ca, cb = Counter(MOD[a]["top1"]), Counter(MOD[b]["top1"])
    s = 0.0
    for i in range(len(REF["labels"])):
        pa, pb = max(ca[i] / NFOTOS, 0.001), max(cb[i] / NFOTOS, 0.001)
        s += (pa - pb) * math.log(pa / pb)
    return s


AC15 = acuerdo("v14", "v15")
PSI15 = psi_mod("v15", "v14")
BAJA14, BAJA15, BAJA_ENS = baja("v14"), baja("v15"), baja("dudoso")
PSI16, BAJA16 = psi_mod("sesgado", "v15"), baja("sesgado")
K_DOJO = len(REF["labels"])

UMB = json.loads((KIT / "sombra" / "umbrales.json").read_text())


# ---------------------------------------------------------------- cuentas (Poisson, PSI)
def p_al_menos(k, lam):
    return 1 - sum(math.exp(-lam) * lam ** i / math.factorial(i) for i in range(k))


def falsa(n, p0, J):
    lam = n * p0
    k = max(1, math.ceil(2 * lam))
    f = p_al_menos(k, lam)
    return lam, k, f, 1 - (1 - f) ** J


# ---------------------------------------------------------------- los números que salen de los logs
CREAR_S = num(O("paso 0", "time python3 mundo/crear.py"), r"listo en (\d+) s")
T15_S = segundos(O("paso 2", "time kubectl -n classifier rollout status deploy/triton-v15"))
CARGA1 = O("paso 1", "python3 mundo/carga.py")
P99_14 = num(CARGA1, r"p99 (\d+) ms")
CARGA3 = O("paso 3", "python3 mundo/carga.py")
SEG3 = num(CARGA3, r"fotos en (\d+) s")
RES3 = O("paso 3", "python3 mundo/logs.py --resumen")
PARES3 = num(RES3, r"pares \(request_id con dos líneas 200\): ([\d,]+)")
REP4 = O("paso 4", "python3 -c")
PARES4 = num(REP4, r"'pares': (\d+)")
AC4 = num(REP4, r"'acuerdo_top1': ([\d.]+)")
P99R4 = num(REP4, r"'p99_razon': ([\d.]+)")
CAIDAS4 = num(REP4, r"'caidas': (\d+)")
BAJA_EST6 = num(O("paso 6", "curl"), r"^([\d.]+)$")

# paso 7: el ensayo
MIRAR7 = O("paso 7", "(cada 5 s")
ABORTO7_S = num(MIRAR7, r"^--- fin a los (\d+) s: Degraded")
CORR7 = O("paso 7", "corridas")
MALA7 = re.search(r"^\s+(\S+)\s+Failed\s+mediciones (\d+) · última (\S+)", CORR7 or "", re.M)
MALA7_M, MALA7_V = (MALA7.group(1), ultima(MALA7.group(3))) if MALA7 else ("?", "?")
CARGA7 = O("paso 7", "cat ")
_c7 = carga(CARGA7)
ENS_N, ENS_TOT = _c7["por_version"].get("ensayo-roto"), _c7["total"]

# paso 8: el canary de la 15
MIRAR8A = O("paso 8", "(cada 5 s", 0)
MIRAR8B = O("paso 8", "(cada 5 s", 1)
A25_S = num(MIRAR8A, r"^--- fin a los (\d+) s")
SANO8_S = num(MIRAR8B, r"^--- fin a los (\d+) s: Healthy")
CORR8A = O("paso 8", "corridas", 0)
CORR8B = O("paso 8", "corridas", 1)
P99_8A = txt(CORR8A, r"^(\s+p99-relativo\s+.*)$")
CARGA8 = O("paso 8", "cat ")
_c8 = carga(CARGA8)
N8, N5XX8 = _c8["total"], _c8["c5xx"] if CARGA8 and not CARGA8.startswith("(pendiente") else None

# paso 9: promover, el bake y volver
# (el orden nuevo: promover → volver a la 14 y regresar a la 15 con carga → el commit del bake)
VUELTA14_S = num(O("paso 9", "kubectl apply -k k8s/", 0), r"volver a la release 14 tardó (\d+) s")
VUELTA15_S = num(O("paso 9", "(cada 5 s"), r"^--- fin a los (\d+) s: Healthy")   # regresar = el canary otra vez
_c9 = carga(O("paso 9", "cat ", 0))
N9, OK9 = _c9["total"], _c9["ok"]
_c9b = carga(O("paso 9", "cat ", 1))
N9B, C5_9B = _c9b["total"], _c9b["c5xx"]

# ---------------------------------------------------------------- la estación
e = {
    "id": "rollout", "patron": "sincrono", "caso": "c01", "num": 10,
    "titulo": "Rollout seguro", "nav": "Rollout seguro",
    "pregunta": "La versión 15 ya pasó el gate y la paridad, y su Triton está en el registro. ¿Cómo la pones frente al tráfico real sin que un error llegue a todos, cómo decide el sistema solo, con reglas escritas antes, si se queda o se va, y cómo vuelves en segundos si algo sale mal después?",
    "version": "2026-11-18",
}

e["mapa"] = {
    "resumen": "La estación 9 dejó la release 14 corriendo en Kubernetes: un Deployment del gateway y su Triton. Un rolling update no sirve para cambiar de modelo: mide salud, no calidad, no controla el porcentaje y no compara contra nada. Aquí la versión 15 sube una <b>escalera</b>: primero la <b>sombra</b> (recibe copias y nadie ve lo que contesta), después un <b>canary</b> con Argo Rollouts (5 % y 25 % del tráfico, comparado contra el estable con reglas escritas antes, que lo revierten solo si empeora) y al final el 100 %, con @champion movido cuando ya es verdad y la versión anterior viva (el <b>bake</b>) para volver en segundos.",
    "entra": [
        "la versión 15 (<code>resnet50-2026-11-01</code>, @challenger) que pasó el gate y la paridad, con su imagen de Triton por digest",
        "la release 14 en producción: <code>triton-v14</code> (2 pods, uno por zona) y el gateway (un Deployment de 3 pods), detrás del ALB",
        "el repositorio de despliegue (<code>k8s/</code>) y el registro de modelos con v14 @champion",
        "los umbrales del shadow escritos antes de mirar (<code>sombra/umbrales.json</code>)",
    ],
    "sale": [
        "la release 15 al 100 % del tráfico, llevada por un Rollout de Argo que subió 5 % → 25 % → 100 % sin que nadie apretara un botón",
        "un reporte del shadow y un AnalysisTemplate con 6 reglas contra el estable, ensayadas con un modelo roto que el canary abortó solo",
        "@champion en v15 con su run y su digest, movido por <code>ci/promover.py</code> al final",
        "la release 14 viva durante el bake, y un runbook de 6 pasos para volver con un <code>git revert</code>",
    ],
    "escala": [
        {"que": "El tráfico", "c01": "≈ 10 M requests al día: ≈ 116 por segundo en promedio y ≈ 350 en el pico del mediodía", "taller": "40 fotos por segundo, las que manda <code>mundo/carga.py</code> por el «ALB» (<code>localhost:8910</code>)"},
        {"que": "La sombra", "c01": "10 % por hash del <code>request_id</code>, 1 a 2 días; un job diario une los pares (≈ 1 M por día)", "taller": f"el mismo 10 % por hash, ≈ {f_(SEG3)} s con carga: ≈ 4 pares por segundo; <code>sombra/reporte.py</code> pide ≥ {UMB['pares_min']:,} pares"},
        {"que": "Los pasos del canary", "c01": "5 % por 4 h → 25 % por 4 h → 100 %: cada paso cubre el pico del mediodía", "taller": "5 % por 4 min (2 fotos/s) → 25 % por 3 min (10 fotos/s) → 100 %"},
        {"que": "El n mínimo", "c01": "10,000 requests del canary para los 5xx; 5,000 predicciones para el PSI", "taller": "200 requests (5xx), 300 (baja confianza y PSI) y 500 (p99: decide en el 25 %)"},
        {"que": "El PSI", "c01": "un job cada hora sobre los logs, con ≈ 30 categorías padre", "taller": f"calculado en el análisis con PromQL, sobre las {K_DOJO} categorías del modelo de juguete"},
        {"que": "El bake", "c01": "24 a 48 h: <code>scaleDownDelaySeconds: 172800</code> y <code>rollbackWindow: {revisions: 3}</code>", "taller": "10 min: <code>scaleDownDelaySeconds: 600</code>, el mismo <code>rollbackWindow</code>"},
        {"que": "Quién reparte", "c01": "el ALB de AWS, configurado por el AWS Load Balancer Controller desde la anotación del Ingress", "taller": "un pod (<code>dojo-alb/alb</code>) que lee la misma anotación cada segundo y reparte con esos pesos"},
        {"que": "Quién aplica", "c01": "Argo CD, desde el repositorio de despliegue; las métricas en Amazon Managed Prometheus", "taller": "tú, con <code>kubectl apply -k k8s/</code>; Prometheus dentro del clúster (<code>localhost:9910</code>); 3 gateways fijos, sin HPA"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-rollout",
}

# ---------------------------------------------------------------- precálculos
_lam_c, _k_c, _f_c, _F_c = falsa(116 * 5 / 100 * 60 * 10, 0.001, 24)
_lam_cn, _k_cn, _f_cn, _F_cn = falsa(10_000, 0.001, 8)
N_DOJO_V = 40 * 5 / 100 * 60 * 2                          # 5 % de 40 fotos/s en la ventana de 2 min de los 5xx
_lam_d, _k_d, _f_d, _F_d = falsa(N_DOJO_V, 0.001, 6)
P0_REAL = (N5XX8 / N8) if (N5XX8 is not None and N8) else None
if P0_REAL is not None:
    _lam_r, _k_r, _f_r, _F_r = falsa(N_DOJO_V, P0_REAL, 6)
    REAL_TXT = (f"Con la tasa real del dojo (paso 8: {N5XX8:,} respuestas 5xx de {N8:,.0f}, {P0_REAL:.2%}): λ = {_lam_r:.3f}, "
                f"f = {_f_r:.1%} por medición y F = {_F_r:.0%} en el canary.")
else:
    REAL_TXT = falta("la carga del paso 8 (cat …carga-15.txt) para la tasa real de 5xx")
PISO_C_500 = 499 * (1 / 3600 + 1 / 68_400)
PISO_C_30 = 29 * (1 / 5000 + 1 / 95_000)
PISO_D = (K_DOJO - 1) * (1 / 300 + 1 / (19 * 300))
PARES_ESP = 40 * 0.10 * (SEG3 or 330)
NM_CAN = (40 * 5 / 100 * ABORTO7_S) if ABORTO7_S is not None else None
NM_BAKE = (40 * (3 * 60 + VUELTA14_S)) if VUELTA14_S is not None else None
T_ESC_MIN = (SEG3 or 330) / 60 + 7 + 10

e["precalculos"] = {
    "intro": "Antes de escribir el Rollout, las cuentas de servilleta: cuántos pares junta la sombra, cuánto tarda el canary en juntar el n mínimo de cada regla, cuántas falsas alarmas da una regla sin n mínimo, cuánto ruido tiene el PSI, a cuántas fotos les toca una versión mala en cada fase y cuánto cuesta la escalera. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "pares-sombra", "pregunta": "¿Cuántos pares junta la sombra, y cuántos desacuerdos hay que mirar?",
            "formula": "pares = requests × fracción copiada · desacuerdos = pares × (1 − acuerdo top-1)",
            "c01": {"cuenta": "un día: 10,000,000 × 0.10 = 1,000,000 pares; con un acuerdo de 0.94, 1,000,000 × 0.06; una persona revisa una muestra de 300 a 500", "valor": "1 M pares · 60,000 desacuerdos al día"},
            "taller": {"cuenta": f"40 fotos/s × 0.10 = 4 pares por segundo; en {f_(SEG3)} s de carga, ≈ {PARES_ESP:,.0f} pares; con el acuerdo de los modelos de juguete ({AC15:.1%}), ≈ {PARES_ESP * (1 - AC15):,.0f} desacuerdos. El umbral pide ≥ {UMB['pares_min']:,}: {UMB['pares_min']:,} ÷ 4 = {UMB['pares_min'] / 4:.0f} s como mínimo", "valor": f"≈ {PARES_ESP:,.0f} pares en {f_(SEG3)} s"},
            "decide": "Cuánto dura la sombra. En C01 un millón de pares sobra para medir el acuerdo (su error estándar es de 0.0002); se dejan 1 o 2 días para ver el día completo, con su madrugada y su pico, y para que las categorías chicas junten casos. En el dojo, 5 minutos de carga pasan el mínimo de pares con margen.",
            "conceptos": ["shadow", "asignacion-hash", "acuerdo-top1"],
            "comprueba": C("paso 3", "python3 mundo/logs.py --resumen", nota="Cuántas líneas de cada versión hay en los logs de los gateways vivos, y cuántos pares."),
            "confirma": f"el paso 4: el reporte encontró {f_(PARES4)} pares y un acuerdo top-1 de {f_(AC4, '{:.1%}') if AC4 is None else f'{AC4:.1%}'}.",
        },
        {
            "id": "minutos-n-minimo", "pregunta": "¿Cuánto tarda el canary en juntar el n mínimo de cada regla, y en qué paso decide cada una?",
            "formula": "minutos = n mínimo ÷ (tráfico total × peso del canary ÷ 100 × 60)",
            "c01": {"cuenta": "10,000 requests: al 5 % en el pico, 10,000 ÷ (350 × 0.05 × 60) ≈ 9.5 min; en promedio (116/s), ≈ 29 min; de madrugada (≈ 20/s), ≈ 2.8 h; al 25 % en el pico, ≈ 1.9 min", "valor": "de ≈ 2 min a ≈ 3 h, según la hora: pasos de 4 h"},
            "taller": {"cuenta": "al 5 %, 40 × 0.05 = 2 fotos/s: 200 ÷ 2 = 100 s (los 5xx: <code>initialDelay: 2m</code>); 300 ÷ 2 = 150 s (baja confianza y PSI: <code>3m</code>); 500 ÷ 2 = 250 s, más que la ventana de 4 min (480 requests). Al 25 %, 10 fotos/s: 500 ÷ 10 = 50 s", "valor": "los 5xx y el PSI deciden al 5 %; el p99, al 25 %"},
            "decide": "El <code>initialDelay</code> de cada métrica (no medir antes de que pueda haber n mínimo) y la duración de cada pausa. El p99 necesita más muestras porque mira la cola (el 1 % más lento): con pocas, una sola foto lenta mueve el número. En el dojo, una versión anterior del análisis con n mínimo de 200 para el p99 abortó un canary bueno solo por ruido (1.62 × el estable, con ≈ 240 muestras); con 500, el p99 espera al 25 %.",
            "conceptos": ["n-minimo", "inconclusa", "canary"],
            "comprueba": C("paso 8", "corridas", 0, nota="Al pasar al 25 %: qué métricas ya decidieron y cuáles siguen sin su n mínimo."),
            "confirma": f"el paso 8: el canary llegó al 25 % a los ≈ {f_(A25_S)} s; en ese momento, el p99 relativo iba así: «{P99_8A.strip()}».",
        },
        {
            "id": "falsa-alarma", "pregunta": "¿Cuántas veces revertiría una regla sin n mínimo a una versión idéntica al estable?",
            "formula": "n = tráfico × peso × 60 × ventana · λ = n × tasa de 5xx · k = ⌈2 × λ⌉ · f = P(X ≥ k) con X ~ Poisson(λ) · F = 1 − (1 − f)^decisiones",
            "c01": {"cuenta": f"al 5 % en promedio, ventana de 10 min: n = 116 × 0.05 × 60 × 10 = 3,480; con 0.1 % de 5xx, λ = {_lam_c:.2f}, k = {_k_c}, f = {_f_c:.1%}; 24 decisiones en 4 h: F = {_F_c:.0%}. Con n mínimo de 10,000: λ = 10, k = {_k_cn}, f = {_f_cn:.2%}, ≈ 8 decisiones, F = {_F_cn:.1%}", "valor": f"{_F_c:.0%} sin n mínimo · {_F_cn:.1%} con 10,000"},
            "taller": {"cuenta": f"al 5 %, ventana de 2 min: n = 40 × 0.05 × 60 × 2 = {N_DOJO_V:.0f}; con 0.1 % de 5xx, λ = {_lam_d:.2f} y k = {_k_d}: un solo 5xx dispara; f = {_f_d:.0%}; ≈ 6 mediciones en el canary: F = {_F_d:.0%}. {REAL_TXT}", "valor": f"{_F_d:.0%} con 0.1 % de 5xx"},
            "decide": "Que una regla relativa con pocas requests revierte versiones buenas: el ruido de Poisson con λ chico es enorme. En C01, el n mínimo de 10,000 baja la falsa alarma de 4 de cada 5 pasos a menos de 3 %. En el dojo, 240 requests no alcanzan para una regla de 5xx de verdad: funciona porque el estable del dojo casi no da 5xx, y por eso el p99 (la regla más ruidosa) pide 500. Y aun con 500 hubo otra falsa alarma: la release 15, buena, abortó al 25 % con el p99 a 1.64 × (≈ 16 ms contra ≈ 10 ms). El histograma del gateway tiene buckets de 5–10 y de 10–20 ms: debajo de ≈ 50 ms, una razón de 1.2 × es ruido de bucket, y nadie distingue 10 de 16 ms. Por eso el p99 del estable lleva un piso de 50 ms, como el 0.1 % de los 5xx.",
            "conceptos": ["n-minimo", "contra-estable"],
            "confirma": "el paso 8: la release 15, buena, pasa las 6 reglas sin una falsa alarma; y el paso 6: el estable comparado contra sí mismo no dispara ninguna.",
        },
        {
            "id": "psi-piso", "pregunta": "¿Cuánto PSI sale por puro azar entre dos versiones idénticas?",
            "formula": "PSI de ruido ≈ (categorías − 1) × (1 ÷ n del canary + 1 ÷ n del estable)",
            "c01": {"cuenta": f"500 categorías, 1 h de madrugada al 5 % (3,600 contra 68,400): 499 × (1/3,600 + 1/68,400) ≈ {PISO_C_500:.3f}, más que el umbral de 0.1. Con ≈ 30 categorías padre y ≥ 5,000 predicciones: 29 × (1/5,000 + 1/95,000) ≈ {PISO_C_30:.3f}", "valor": f"{PISO_C_500:.2f} con 500 · {PISO_C_30:.3f} con 30 padres"},
            "taller": {"cuenta": f"{K_DOJO} categorías, n mínimo de 300 al 5 % (el estable ve 19 veces más: 5,700): {K_DOJO - 1} × (1/300 + 1/5,700) ≈ {PISO_D:.3f}. Los modelos de juguete, sobre las {NFOTOS} fotos del mundo: la 15 contra la 14, {PSI15:.3f}; la 16 «sesgada» contra la 15, {PSI16:.2f}", "valor": f"ruido ≈ {PISO_D:.2f} · umbral 0.1 · v16 {PSI16:.2f}"},
            "decide": "Que el PSI nunca vale 0 con muestras finitas: con muchas categorías y pocas predicciones, el ruido solo pasa el umbral. Por eso C01 agrupa en ≈ 30 categorías padre y exige 5,000 predicciones. En el dojo, con 10 categorías y 300 predicciones, el ruido queda 3 veces abajo del umbral, y un modelo que se lleva fotos a «bolsas» (PSI ≈ 0.19) lo pasa con holgura.",
            "conceptos": ["psi", "n-minimo"],
            "confirma": "el paso 6: el estable contra sí mismo no dispara el PSI; y la falla «La campaña de bolsas» de Romper: el PSI aborta la release 16 aunque confía igual y no truena.",
        },
        {
            "id": "dano-por-fase", "pregunta": "¿A cuántas fotos les contesta una versión mala antes de volver, según la fase?",
            "formula": "fotos de la versión mala = tráfico × peso ÷ 100 × 60 × (minutos hasta detectar + minutos hasta revertir)",
            "c01": {"cuenta": "pico (350/s), 30 min para detectar (la ventana de la baja confianza): canary al 5 %, 350 × 0.05 × 60 × 30.1 ≈ 31,600; bake al 100 % con revert de 5 min, 350 × 60 × 35 = 735,000; pasado el bake (20 min), 1,050,000", "valor": "≈ 31,600 · 735,000 · 1,050,000"},
            "taller": {"cuenta": f"el ensayo del paso 7: 2 fotos/s al canary durante los ≈ {f_(ABORTO7_S)} s hasta el aborto: 2 × {f_(ABORTO7_S)} ≈ {f_(NM_CAN)}. El mismo modelo en el bake, al 100 %, con 3 min para detectar y los {f_(VUELTA14_S)} s que tardó volver (paso 9): 40 × (180 + {f_(VUELTA14_S)}) ≈ {f_(NM_BAKE)}", "valor": f"≈ {f_(NM_CAN)} en el canary · ≈ {f_(NM_BAKE)} en el bake"},
            "decide": "Por qué existe el peldaño chico: el mismo error, al 5 %, toca a ≈ 20 veces menos fotos que al 100 %. Y no son 5xx: son sugerencias peores que contestan 200, que solo ven la baja confianza o el PSI, con su ventana. Por eso el canary se queda en 5 % hasta que esas reglas pudieron decidir.",
            "conceptos": ["criterio-rollback", "bake"],
            "comprueba": C("paso 7", "cat ", code_="python3 mundo/carga.py --por-segundo 40 --segundos 480 --cada 30   # en otra terminal, antes del apply",
                           nota="La carga que corrió durante el ensayo: cuántas fotos contestó el modelo roto antes del aborto."),
            "confirma": f"el paso 7: la carga recibió {f_(ENS_N)} respuestas del modelo roto (ensayo-roto) de {f_(ENS_TOT)}.",
        },
        {
            "id": "costo-escalera", "pregunta": "¿Cuánto cuesta la T4 de más que pide la escalera, y por qué no conviene ahorrarla?",
            "formula": "costo = precio por hora de una T4 × (horas de sombra + horas de canary + horas de bake)",
            "c01": {"cuenta": "US$0.526 por hora × (24 + 8 + 24) = 0.526 × 56; × (48 + 8 + 48) = 0.526 × 104; contra ≈ US$3,000 al mes de infraestructura", "valor": "≈ US$29 a 55 por release: 1 a 1.8 % del mes"},
            "taller": {"cuenta": f"≈ {(SEG3 or 330) / 60:.1f} min de sombra + 7 de canary + 10 de bake = {T_ESC_MIN:.1f} min; si fuera una T4 de verdad, 0.526 × {T_ESC_MIN:.1f} ÷ 60", "valor": f"≈ US${0.526 * T_ESC_MIN / 60:.2f} (en el dojo la T4 es un recurso anunciado y no cuesta)"},
            "decide": "Que el seguro sale barato y lo caro es el tiempo: de 2.3 a 4.3 días desde que empieza la sombra hasta que se apaga la anterior. Durante la sombra y el canary, el Triton nuevo tiene un solo pod; en el bake, el viejo se queda con uno. Con un solo pod, su PDB va en <code>minAvailable: 0</code>. Quitar el bake para ahorrar convierte el rollback en levantar pods otra vez.",
            "conceptos": ["bake", "release-par"],
            "comprueba": C("paso 9", "kubectl -n classifier get pods -L classifier/modelo", nota="En el bake: triton-v15 con 2 pods y triton-v14 con 1, todavía listo."),
            "confirma": f"el paso 9: con la 14 viva, volver tardó ≈ {f_(VUELTA14_S)} s; regresar a la 15 volvió a correr el canary completo (≈ {f_(VUELTA15_S)} s).",
        },
    ],
}

# ---------------------------------------------------------------- conceptos
K = []


def concepto(id_, termino, en, def_, analogia, importa, trampa):
    K.append(dict(id=id_, termino=termino, en=en, def_=def_, analogia=analogia, importa=importa, trampa=trampa))


concepto("shadow", "Sombra", "shadow deployment / traffic mirroring / dark launch",
         "Correr la versión nueva con copias de requests reales, guardar lo que contesta y tirarlo: el usuario solo ve la respuesta de la versión actual. Lo que hace las copias es la copia de tráfico.",
         "Un auto de autoescuela con el volante del alumno desconectado: el alumno gira como si manejara, el instructor maneja de verdad y una cámara graba los dos volantes para compararlos al final.",
         "Mide al modelo nuevo con las fotos de hoy sin arriesgar a nadie: que no truene, que no tarde de más y cuánto contesta distinto. Lo que no mide es a la gente: nadie vio esas sugerencias. Por eso la copia va aparte, con su plazo y una fila acotada: si la sombra se atrasa, la copia se tira.",
         "Que la copia escriba algo fuera de su log (la base de datos, un caché compartido, un correo): entonces la sombra cambia el mundo sin que nadie lo decida.")
concepto("asignacion-hash", "Asignación por hash", "hash-based assignment / deterministic sampling",
         "Decidir si una request entra en la muestra con el hash de su request_id: un número que parece al azar pero sale siempre igual para el mismo id. Entra si cae en el 10 % de los valores.",
         "Repartir alumnos en dos salones por el último dígito de su matrícula: nadie tira un dado, y el mismo alumno siempre cae en el mismo salón.",
         "Cualquiera puede repetir la decisión después (el reporte sabe qué requests se copiaron) y la muestra no depende de la hora ni del pod. En el dojo: los primeros 8 hex del sha256, módulo 10,000, menor que 0.10 × 10,000.",
         "Usar <code>random()</code>: la muestra sale bien de tamaño, pero nadie puede reconstruirla, y dos pods podrían decidir distinto para la misma request reintentada.")
concepto("acuerdo-top1", "Acuerdo top-1 y umbrales escritos antes", "top-1 agreement / pre-registered thresholds",
         "La fracción de pares en que los dos modelos ponen la misma categoría en primer lugar. Sus umbrales (≥ 90 %, p99 ≤ 1.1 × en C01, 0 caídas, ≥ 85 % por categoría) se escriben antes de mirar.",
         "Comparar dos traducciones de un libro renglón por renglón: no dice cuál está bien, dice cuánto cambió; y los renglones distintos son los que lee un editor.",
         "El acuerdo no es exactitud: mide cuánto cambió el comportamiento. Un 99.9 % en un reentrenamiento diría que no aprendió nada; un 70 %, que algo se rompió (labels desordenados, un preproceso distinto). Los desacuerdos van a revisión de una persona.",
         "Mover el umbral después de ver el número («89 % está bien, ¿no?»): ya no es un criterio, es una justificación. Por eso <code>sombra/umbrales.json</code> no se toca.")
concepto("release-par", "La release es un par", "release / model-gateway pairing",
         "Una release es el gateway de una versión más el Triton de esa versión: cada modelo en su propio Deployment y Service (triton-v15), y el gateway con su TRITON_URL, su ConfigMap y su etiqueta.",
         "Un control remoto con su televisión: cada control habla solo con la suya; si dos controles pudieran prender cualquier tele, nadie sabría quién cambió de canal.",
         "Nunca dos modelos detrás del mismo nombre: cada request tiene una sola versión, escrita en su log y en sus métricas, y el análisis puede culpar a la correcta. Por eso el Triton de la 15 se despliega antes, sin tráfico, con un solo pod.",
         "Un solo Service «triton» para las dos versiones, o el labels.json dentro de la imagen del gateway: la respuesta dependería de a qué pod le tocó, y ninguna métrica sabría a quién culpar.")
concepto("canary", "Canary", "canary release / progressive delivery",
         "Mandar una parte chica del tráfico real a la versión nueva, por etapas (5 %, 25 %, 100 %), y avanzar solo si en cada etapa se ve tan bien como la estable. El nombre viene de los canarios de las minas.",
         "Probar un platillo nuevo con unas cuantas mesas antes de ponerlo en el menú: si a esas mesas les cae mal, solo a ellas.",
         "A diferencia de un rolling update, controla el porcentaje y compara contra la versión estable. Es el tamaño de la apuesta: si la 15 está mal, toca a 1 de cada 20 requests mientras se detecta. Y no lleva pausa manual: cada paso dura su tiempo y lo automático decide.",
         "Medir salud con la readiness y llamarlo canary: un modelo que confunde tenis con botas contesta 200 en 30 ms. El canary de un modelo mira lo que contesta, no solo si contesta.")
concepto("argo-rollouts", "Argo Rollouts y el Rollout", "Argo Rollouts / Rollout / setWeight / pause / stableService / canaryService",
         "Un Rollout es un objeto con el mismo template de pod que un Deployment más los pasos del canary (setWeight, pause). Su controlador, en el namespace argo-rollouts, los ejecuta.",
         "Un director de orquesta con la partitura: los músicos (los pods) son los mismos de siempre; la partitura dice cuándo entra cada sección y cuánto dura cada pausa.",
         "Cambiar el template (TRITON_URL, ConfigMap, etiqueta) en un commit dispara el canary. Argo pone el hash de los pods estables en el selector de <code>gateway-stable</code> y el de los nuevos en <code>gateway-canary</code>. El Deployment viejo se borra a mano una vez que el Rollout tiene sus pods.",
         "Usar <code>kubectl argo rollouts promote</code> o <code>undo</code> para avanzar o volver: el clúster deja de ser lo que dice git. Los pasos avanzan solos y volver es un <code>git revert</code>.")
concepto("alb-pesos", "Pesos en el ALB y use-annotation", "ALB weighted target groups / actions annotation / use-annotation",
         "El ALB reparte con pesos entre dos destinos. Argo escribe los pesos en la anotación actions.gateway-stable del Ingress; el ALB solo la lee si el backend usa el puerto «use-annotation».",
         "Un despachador de taxis con una pizarra: alguien escribe «95 al sitio A, 5 al sitio B». Si el despachador tiene órdenes de mandar todo al sitio A, la pizarra no sirve de nada.",
         "Quien reparte es el balanceador, no los pods: por eso el 5 % es 5 % aunque haya 3 pods estables y 1 canary. En el dojo, un pod que lee el mismo Ingress cada segundo hace de ALB, con las mismas reglas que el AWS Load Balancer Controller.",
         "Un backend con <code>port: {number: 8080}</code>: el ALB manda todo al estable e ignora la anotación. El canary «al 5 %» recibe 0 %, nada falla y al terminar los pasos la versión nueva pasa al 100 % sin evidencia.")
concepto("analisis", "AnalysisTemplate y AnalysisRun", "AnalysisTemplate / AnalysisRun / measurement / Prometheus provider",
         "Un AnalysisTemplate escribe las reglas: métricas con su consulta a Prometheus, cada cuánto se miden y sus condiciones. Cada canary crea un AnalysisRun que las mide de fondo mientras dura.",
         "El reglamento de un partido (el template) y el árbitro de cada partido (el run): el reglamento se escribe una vez; cada partido tiene su árbitro con su libreta de faltas.",
         "Cada medición da un valor y un veredicto: Successful, Failed o Inconclusive. Si una métrica falla, Argo aborta el Rollout. Las consultas usan los hashes del canary y del estable (<code>{{args.canary-hash}}</code>), que el Rollout llena con <code>podTemplateHashValue</code>.",
         "Escribir el análisis como pasos sueltos (<code>analysis</code> dentro de <code>steps</code>) que solo miden al final de una pausa: el canary pasaría minutos con un modelo malo sin que nadie mirara.")
concepto("criterio-rollback", "Criterio de promoción y rollback automático", "promotion criteria / automated rollback / abort",
         "Un criterio de promoción es la regla, escrita antes, que el canary tiene que cumplir para subir; su espejo es el rollback automático: si se rompe, el peso vuelve al estable sin esperar a nadie.",
         "El freno de emergencia de un elevador: no espera a que alguien lo apriete; si la velocidad pasa del límite, frena solo.",
         "Lo automático revierte, una persona autoriza: revertir tiene que ser instantáneo, a las 3 a. m. también; avanzar puede esperar, y por eso la persona aprobó una vez, antes del canary. Al abortar, el Rollout queda Degraded hasta que git deje de pedir la versión mala.",
         "Ensayar el rollback por primera vez el día que hace falta. Un aborto que nunca se ensayó no es un plan: por eso el paso 7 lo ensaya con un modelo roto a propósito.")
concepto("contra-estable", "Comparar contra el estable, en la misma ventana", "canary vs. baseline / relative threshold / absolute cap",
         "Cada regla relativa compara al canary contra el estable en los mismos minutos: los pesos reparten al azar por request, así que los dos ven la misma mezcla de fotos. Los topes absolutos quedan como red.",
         "Medir si un fertilizante funciona con dos parcelas vecinas el mismo verano, no contra la cosecha del año pasado: la lluvia les toca a las dos.",
         "Una campaña de bicis sube la baja confianza de las dos versiones; un umbral fijo dispararía por la campaña, la razón entre las dos no. Y si todo el sistema está mal (las dos con 1 % de 5xx), la comparación diría «iguales» y el tope frena igual.",
         "Comparar contra ayer o contra un número fijo, o dividir entre un estable casi en cero: por eso la consulta pone un piso al estable con <code>clamp_min</code> (0.1 % en los 5xx, 1 % en la baja confianza y, en el dojo, 50 ms en el p99).")
concepto("n-minimo", "n mínimo y falsa alarma", "minimum sample size / false positive / Poisson noise",
         "Cuántas requests tiene que juntar el canary antes de que una regla pueda decidir. Con pocas, el ruido manda: los errores siguen una Poisson y con λ chico el doble de lo esperado sale por azar.",
         "Juzgar a un bateador por sus primeros 3 turnos: si conectó 2, batea .667; nadie lo contrataría por eso, ni lo correría por fallar 3.",
         "Una regla relativa sin n mínimo revierte versiones buenas: en C01, 79 % de los pasos de 4 h. La ventana real es «10 minutos o lo que tarde en juntar el n». Se diseña con la tasa real y se revisa cuando la tasa cambia.",
         "Creer que el n mínimo es el único ruido. En el dojo, dos canaries buenos abortaron por el p99: con n de 200, 1.62 × con ≈ 240 muestras; y con n de 500, 1.64 × con ≈ 16 ms contra ≈ 10 ms, ruido de los buckets del histograma (5–10 y 10–20 ms). De ahí el n de 500 y el piso de 50 ms.")
concepto("inconclusa", "Medición inconclusa", "inconclusive measurement / inconclusiveLimit",
         "Una medición que no cumple ni la condición de éxito ni la de falla: aquí, la consulta da −1 mientras el canary no junta su n mínimo. No decide; si se repite más de inconclusiveLimit veces, el Rollout se pausa.",
         "Un examen que el alumno no alcanzó a terminar: no se aprueba ni se reprueba; se espera, y si sigue sin terminar, se llama a alguien.",
         "Es la forma de escribir «todavía no sé» en la regla: <code>or on() vector(-1)</code> en la consulta y <code>result[0] >= 0</code> en las dos condiciones. Si el análisis se queda inconcluso, el Rollout espera a una persona en lugar de avanzar a ciegas.",
         "Una consulta que devuelve 0 cuando no hay datos: con 0 errores en 0 requests, la regla «pasa» y el canary sube sin evidencia.")
concepto("baja-confianza", "Baja confianza", "low-confidence rate / top-1 score histogram",
         "La fracción de fotos en que el modelo duda: la probabilidad de su primera categoría es menor que 0.3. Sale del histograma del score top-1 que publica el gateway, por versión.",
         "Un mesero que contesta «creo que sí hay» en lugar de «sí hay»: no se equivocó todavía, pero algo no sabe.",
         f"Es una de las dos señales que miran qué contesta el modelo, no solo si contesta, y ningún probe la ve. El modelo del ensayo contesta la misma categoría que la 15, pero duda en {BAJA_ENS:.0%} de las fotos contra {BAJA15:.0%}: la atrapa esta regla, no los 5xx.",
         "Mirar solo los errores 5xx: un modelo malo contesta 200 OK. Y al revés: un modelo que se equivoca con confianza no sube la baja confianza; para eso está el PSI.")
concepto("psi", "PSI de las categorías", "population stability index / prediction drift",
         "Un número que mide cuánto cambió una mezcla: aquí, qué fracción de las fotos cae en cada categoría, canary contra estable. Vale 0 si son iguales y crece mientras más se separan; umbral 0.1.",
         "Comparar la canasta de dos supermercados por pasillo: si uno de pronto vende el triple de bolsas y la mitad de abrigos, algo cambió aunque cada venta se cobró bien.",
         f"Atrapa al modelo que se equivoca con confianza: la release 16 de Romper confía como la 15 (baja confianza {BAJA16:.0%}) y no truena, pero se lleva fotos a «bolsas» (PSI ≈ {PSI16:.2f}). En C01 lo calcula un job cada hora; en el dojo, el análisis en PromQL.",
         "Calcularlo con muchas categorías y pocas predicciones: el PSI de puro ruido pasa el umbral y el canary se revierte de noche, por azar.")
concepto("promover-alias", "Promover: mover @champion al final", "model promotion / registry alias / champion-challenger",
         "El job promover espera a que el Rollout esté sano al 100 % y mueve el alias champion del registro de modelos a esa versión, con dos etiquetas: su run y el digest de su Triton.",
         "Cambiar el nombre en la puerta de la oficina del gerente después de que el nuevo ya tomó el puesto, no el día que lo entrevistaron.",
         "El alias se mueve cuando ya es verdad: si el canary se revierte, champion nunca se movió. Ningún servidor lo lee, pero el gate del mes que entra compara contra champion y el runbook regresa a él. Es idempotente: correrlo dos veces no cambia nada.",
         "Mover champion al empezar el canary «porque ya pasó el gate»: si el canary aborta, el registro dice que atiende una versión que nadie atiende.")
concepto("bake", "Bake, scaleDownDelaySeconds y rollbackWindow", "bake time / scaleDownDelaySeconds / rollbackWindow / blue-green",
         "El tiempo en que la release anterior sigue prendida después del 100 %: su gateway (scaleDownDelaySeconds) y su Triton. rollbackWindow hace que volver a una release anterior reciente se salte los pasos.",
         "Dejar el puente viejo en pie unas semanas después de abrir el nuevo: si al nuevo le sale una grieta, el tráfico vuelve por el viejo esa misma tarde.",
         "Convierte el rollback en un cambio de ruteo a algo caliente. Es un blue/green a medias: se sube por canary y el blue queda vivo como red. Argo apaga lo anterior a los 30 s por omisión; C01 pide 172,800 s (48 h), el dojo 600. El atajo es solo hacia atrás: regresar a la nueva corre otra vez el canary.",
         "Dejar <code>scaleDownDelaySeconds</code> por omisión, o apagar <code>triton-v14</code> en el mismo commit: un problema que aparece en la hora 3 pide levantar pods otra vez, con su engine, en lugar de segundos.")
concepto("runbook", "Runbook y kill switch", "rollback runbook / on-call / kill switch / feature flag",
         "Un runbook es la receta escrita de qué hace la persona de guardia cuando algo sale mal: detectar, revertir sin diagnosticar, confirmar, congelar, comunicar, investigar. Un kill switch apaga la función entera.",
         "La tarjeta de emergencia del avión: se escribe en tierra, con calma, para leerse en el aire con prisa, por alguien que no diseñó el avión.",
         "Primero revertir, después investigar: la meta es volver en ≤ 5 min. El cómo cambia con la fase (canary: ya volvió solo; bake: un revert y el alias; pasado el bake, también levantar el Triton viejo). Si al volver las métricas no mejoran, el problema no era la versión: kill switch.",
         "Diagnosticar antes de revertir, a las 3 a. m., con el tráfico en la versión mala. O un runbook que nunca se ensayó.")
concepto("gitops-revert", "Volver con git revert, no con undo", "GitOps / git revert / kubectl argo rollouts undo / Degraded",
         "Con GitOps lo que corre sale de git: volver es un commit que deshace el cambio, aplicado como cualquier otro. Un aborto regresa el tráfico, pero el Rollout queda Degraded mientras git siga pidiendo la versión mala.",
         "El libro de contabilidad: un error no se borra con corrector; se anota un asiento que lo cancela, y el libro sigue diciendo la verdad.",
         "Con <code>rollbackWindow</code>, el revert de una release reciente va directo al 100 % de la anterior, en segundos. En C01, el revert es un PR que aprueba una persona y Argo CD aplica; en el dojo, <code>git revert</code> y <code>kubectl apply -k k8s/</code>.",
         "<code>kubectl argo rollouts undo</code>: el clúster vuelve, git no, y el siguiente sync de Argo CD (o tu siguiente apply) pone otra vez la versión mala.")
for k in K:
    k["def"] = k.pop("def_")
e["conceptos"] = [{k: c[k] for k in ("id", "termino", "en", "def", "analogia", "importa", "trampa")} for c in K]

# ---------------------------------------------------------------- el mundo
e["mundo"] = {
    "resumen": "El kit trae la release 14 de C01 corriendo en chico, de verdad: el clúster de la estación 9 (Kubernetes 1.35 en kind, con cuatro nodos que anuncian una T4, en dos zonas), Argo Rollouts, un «ALB» que lee la misma anotación que el de AWS, Prometheus, un registro de modelos con v14 @champion y v15 @challenger, y una imagen de Triton por versión del modelo. Lo tuyo: el Triton de la 15, la sombra en el gateway y su reporte, el Rollout, el Ingress que reparte con pesos, el análisis, el job que promueve y el runbook.",
    "trae": [
        {"que": "mundo/crear.py y mundo/kind.yaml", "detalle": f"Crea todo en ≈ {f_(CREAR_S)} s: el registro en <code>localhost:5910</code>, el clúster <code>dojo-rollout</code> (un plano de control y 6 nodos), Argo Rollouts v1.10.2, el «ALB» en <code>localhost:8910</code>, Prometheus en <code>localhost:9910</code>, las imágenes por digest y esta carpeta como repositorio de despliegue, con la release 14 corriendo. La llave queda en <code>.kube/config</code>."},
        {"que": "mundo/alb/", "detalle": "El «ALB» del dojo: cada segundo lee el Ingress <code>gateway</code>; si su backend usa el puerto <code>use-annotation</code>, reparte con los pesos de la anotación que escribe Argo Rollouts; si no, manda todo a un Service. Como el AWS Load Balancer Controller."},
        {"que": "mundo/modelos.py", "detalle": "El registro de modelos (en C01, MLflow): versiones, alias y etiquetas. <code>ver</code> para mirar; <code>alias</code> solo en el runbook."},
        {"que": "mundo/publicar.py", "detalle": "El CI de la estación 8 en corto: construye el gateway del commit actual, lo sube y escribe su digest en <code>kustomization.yaml</code>, en un commit. No aplica nada."},
        {"que": "mundo/carga.py y mundo/logs.py", "detalle": "La carga manda fotos por el «ALB» a un ritmo fijo y dice qué versión contestó cada una: así ves el reparto del canary. <code>logs.py</code> junta los logs de todos los gateways, lo que leería el job del shadow."},
        {"que": "mundo/ensayo.py", "detalle": f"Prende y apaga <code>triton-ensayo</code>: un modelo roto a propósito, que contesta la misma categoría que la 15 pero duda en {BAJA_ENS:.0%} de las fotos (la 15, en {BAJA15:.0%}). En C01 el ensayo se hace en staging."},
        {"que": "mundo/triton_dojo/ y mundo/modelos/", "detalle": f"El Triton del dojo y los modelos de juguete, una imagen por versión: la 14, la 15 ({AC15:.1%} de acuerdo con la 14, PSI {PSI15:.3f}), el del ensayo y la 16 (PSI {PSI16:.2f} contra la 15). Triton corre en la CPU."},
        {"que": "sombra/umbrales.json", "detalle": f"Los umbrales del shadow, escritos antes de mirar: acuerdo ≥ {UMB['acuerdo_top1_min']:.0%}, p99 ≤ {UMB['p99_max_vs_champion']} × el del champion, {UMB['caidas_max']} caídas, ≥ {UMB['acuerdo_por_categoria_min']:.0%} en las {UMB['categorias_grandes']} categorías grandes y ≥ {UMB['pares_min']:,} pares."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks contra lo que corre en el clúster, y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "k8s/triton-v15.yaml", "hace": "El Triton de la versión 15, desplegado antes de que nadie le mande tráfico: un solo pod, su Service y su PDB en 0."},
        {"archivo": "gateway/app/sombra.py", "hace": "La copia al challenger: el 10 % por hash del request_id, una fila acotada, su propio plazo y una línea de log; nunca bloquea al usuario."},
        {"archivo": "sombra/reporte.py", "hace": "Une los pares por request_id, mide acuerdo, p99, caídas y categorías grandes contra los umbrales y dice «sigue» o «frena»."},
        {"archivo": "k8s/gateway.yaml", "hace": "El gateway como Rollout de Argo: el mismo template de pod, más los pasos 5 % → 25 % → 100 %, el análisis de fondo, el bake y el rollbackWindow; y los Services gateway-stable y gateway-canary."},
        {"archivo": "k8s/ingress.yaml", "hace": "La entrada del ALB, con el backend en gateway-stable y el puerto use-annotation: así el ALB aplica los pesos de Argo."},
        {"archivo": "k8s/analisis.yaml", "hace": "El AnalysisTemplate canary-vs-estable: 6 reglas contra el estable o contra un tope, cada una con su n mínimo."},
        {"archivo": "ci/promover.py", "hace": "El job que mueve @champion cuando el Rollout está sano al 100 %, con su run y su digest."},
        {"archivo": "RUNBOOK.md", "hace": "La receta de la persona de guardia: los 6 pasos, y cómo se revierte en cada fase."},
    ],
    "requisitos": [
        "Docker Desktop con al menos 6 CPU y 8 GiB de memoria (Settings → Resources). Si tienes el clúster de la estación 9 (<code>dojo-k8s</code>), apágalo antes: dos no caben",
        "kind, kubectl y el plugin de Argo Rollouts: <code>brew install kind kubectl argoproj/tap/kubectl-argo-rollouts</code>",
        "Python 3.11 o más nuevo. No hace falta entorno virtual: todo usa la biblioteca estándar",
        "git e Internet la primera vez (≈ 1.5 GB de imágenes)",
        "Los puertos 5910, 8910 y 9910 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "EKS en dos zonas de <code>us-east-1</code>, con T4 de verdad", "local": "kind en tu Mac (el clúster de la estación 9), con las T4 como un recurso anunciado a mano", "diferencia": "El mismo Kubernetes y el mismo Argo Rollouts. Triton corre en la CPU, con modelos de juguete de 10 categorías."},
        {"nube": "El ALB de AWS y el AWS Load Balancer Controller", "local": "un pod en <code>dojo-alb</code> que lee el Ingress y su anotación cada segundo", "diferencia": "Las mismas reglas (pesos solo con <code>use-annotation</code>); sin TLS ni health checks propios."},
        {"nube": "Argo CD aplicando el repositorio de despliegue", "local": "tú, con <code>kubectl apply -k k8s/</code>", "diferencia": "Lo que corre sale de git igual; nadie regresa un cambio a mano hasta tu siguiente apply."},
        {"nube": "Amazon Managed Prometheus", "local": "Prometheus v3.15.1 dentro del clúster (<code>localhost:9910</code>)", "diferencia": "Las mismas consultas en PromQL que corre el análisis."},
        {"nube": "Pasos del canary de 4 h, sombra de 1–2 días, bake de 24–48 h", "local": "pasos de 4 y 3 min, sombra de ≈ 5 min, bake de 10 min", "diferencia": "Con 40 fotos por segundo, minutos bastan para juntar el n mínimo del dojo; lo que no se ve es el ciclo del día (madrugada, pico)."},
        {"nube": "n mínimo de 10,000 requests y 5,000 predicciones", "local": "200, 300 y 500", "diferencia": "Más ruido: por eso el p99 pide 500 y decide al 25 %."},
        {"nube": "El PSI de un job cada hora sobre los logs, con ≈ 30 categorías padre", "local": "el PSI en PromQL dentro del análisis, con 10 categorías", "diferencia": "Se mide en la misma ventana que las otras reglas, en minutos."},
        {"nube": "El p99 relativo del canary: > 1.2 × el del estable revierte", "local": "lo mismo, con un piso de 50 ms para el p99 del estable", "diferencia": "En tu Mac el p99 es de ≈ 10 a 20 ms y el histograma del gateway tiene buckets de 5–10 y 10–20 ms: una razón de 1.2 × ahí es ruido de bucket (un canary bueno abortó con 1.64 ×, ≈ 16 contra ≈ 10 ms). Con el piso, la regla solo dispara cuando la diferencia ya se nota."},
        {"nube": "El p99 de la sombra: ≤ 1.1 × el del champion", "local": "≤ 1.5 × (<code>sombra/umbrales.json</code>)", "diferencia": "En tu Mac, los dos Tritons comparten el procesador y difieren más de 10 % por puro ruido: en corridas de prueba, el de la 15 salió de 1.11 a 1.34 × el de la 14 (18.8 ms contra 14.0 ms) siendo el mismo tipo de modelo. En C01 cada Triton tiene su T4 y el 1.1 sí distingue."},
        {"nube": "El gateway con HPA de 3 a 12", "local": "3 gateways fijos", "diferencia": "Así caben la release estable, el canary y la anterior en el bake en los dos nodos de CPU."},
        {"nube": "El ensayo del aborto en staging (<code>classifier-staging</code>)", "local": "<code>triton-ensayo</code> en el mismo namespace, prendido solo para el ensayo", "diferencia": "Se ensaya contra el tráfico de la carga, no contra usuarios."},
    ],
    "arranque": "unzip c01-rollout.zip && cd c01-rollout\npython3 mundo/crear.py\nexport KUBECONFIG=$PWD/.kube/config\npython3 verificar.py mundo",
    "python": "python3",
}


# ---------------------------------------------------------------- el Guiado
def variante(cual: str) -> str:
    """k8s/gateway.yaml tal como lo aplicó probar.sh en ese paso (pasos.py, de los archivos de la solución)."""
    return subprocess.run([sys.executable, str(SOL / "pasos.py"), cual], capture_output=True, text=True, check=True).stdout.rstrip("\n")


def lineas_con(t: str, *pats: str) -> str:
    return "\n".join(ln for ln in t.split("\n") if any(p in ln for p in pats))


KZ = re.search(r'KUSTOMIZATION = """(.*?)"""', code("mundo/crear.py", KIT), re.S).group(1).replace("{{", "{").replace("}}", "}")
for _k in ("gw", "t14", "t15"):
    KZ = KZ.replace("{" + _k + "_repo}", "localhost:5910/classifier-" + {"gw": "gateway", "t14": "triton", "t15": "triton"}[_k]).replace("{" + _k + "_dig}", "sha256:…")

_gw = code("k8s/gateway.yaml")
BLOQUE_ANALISIS = _gw[_gw.index("      analysis:"):_gw.index("      steps:")].rstrip("\n")

G = []
c0, _ = S("paso 0", "time python3 mundo/crear.py")
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El registro, el clúster con Argo Rollouts, el «ALB» y Prometheus, la release 14 corriendo y el registro de modelos con v14 @champion y v15 @challenger.",
    conceptos=["release-par"],
    explica="<code>mundo/crear.py</code> crea el registro y el clúster con kind, instala Argo Rollouts, el «ALB» del dojo y Prometheus, construye y sube las imágenes (el gateway y un Triton por versión del modelo), hace de esta carpeta un repositorio git y deja corriendo la release 14. La llave del clúster queda en <code>.kube/config</code>: el <code>export</code> le dice a kubectl que use esa, en cada terminal nueva.",
    codigo=[],
    comandos=[
        cmd(c0.removeprefix("time ").replace(" --de-cero", "") + "\nexport KUBECONFIG=$PWD/.kube/config", O("paso 0", "time python3 mundo/crear.py", quitar=r"^real"), "<code>--de-cero</code> borra antes el clúster, el registro y el registro de modelos (tus archivos se quedan)."),
        C("paso 0", "python3 verificar.py mundo"),
        C("paso 0", "git log --oneline", nota="Esta carpeta es el repositorio de despliegue: lo que corre en el clúster sale de aquí."),
        C("paso 0", "python3 mundo/modelos.py ver", nota="El registro de modelos: la 14 atiende (@champion); la 15 es la candidata (@challenger)."),
    ],
    verifica="<code>mundo</code> en verde: 6 nodos, el registro, Argo Rollouts, el ALB, Prometheus y el registro de modelos.",
    ojo="Si <code>kubectl</code> dice <code>connection refused</code> en <code>localhost:8080</code>, falta el <code>export KUBECONFIG</code> en esa terminal. Si tienes prendido el clúster de la estación 9, apágalo antes (<code>python3 mundo/cluster.py apagar</code> en su carpeta): dos clústeres no caben en 8 GiB. Si <code>kubectl argo rollouts</code> no existe, falta el plugin: <code>brew install argoproj/tap/kubectl-argo-rollouts</code>."))

G.append(dict(n=1, id="leer", titulo="Leer el mundo", objetivo="Saber qué corre hoy, quién reparte el tráfico y con qué regla, y qué métricas por versión ya publica el gateway en Prometheus.",
    conceptos=["alb-pesos", "release-par", "canary"],
    explica="Antes de cambiar nada, mira la release 14: un Deployment del gateway con 3 pods, su Triton con 2, y un Ingress que lee el «ALB» del dojo. Hoy su backend es un puerto normal (<code>number: 8080</code>): el ALB manda todo a un solo Service y no hay pesos que mover. El gateway ya publica sus métricas con la versión del modelo y el hash de su pod: con ellas el análisis va a comparar al canary contra el estable.",
    codigo=[],
    comandos=[
        C("paso 1", "kubectl -n classifier get deploy,svc,ingress", nota="El gateway es un Deployment (en el paso 5 se vuelve un Rollout); cada versión del modelo tiene su Deployment y su Service."),
        C("paso 1", "kubectl -n argo-rollouts get pods", nota="El controlador de Argo Rollouts: el que va a ejecutar los pasos del canary."),
        C("paso 1", "kubectl argo rollouts version", nota="El plugin de kubectl para leer Rollouts."),
        C("paso 1", "pesos", nota="Lo que aplica el ALB ahora: todo a un Service, «sin anotación»."),
        C("paso 1", "kubectl -n classifier get ingress gateway -o jsonpath"),
        C("paso 1", "python3 mundo/carga.py", nota="Cada respuesta dice qué versión contestó: hoy, todas la 14."),
        C("paso 1", "curl", nota="Prometheus ya tiene las requests de cada gateway, con la etiqueta de su versión."),
    ],
    verifica=f"Sabes quién reparte el tráfico (el ALB, con el Ingress) y que hoy todo va a la 14, con un p99 de {f_(P99_14)} ms en la carga.",
    ojo="El ALB del dojo solo se lee desde dentro del clúster (<code>kubectl -n dojo-alb exec deploy/alb …</code>): el puerto 8081 no está publicado en tu Mac."))

G.append(dict(n=2, id="triton-v15", titulo="triton-v15, sin tráfico", objetivo="El Triton de la versión 15 corriendo antes de que nadie le mande una foto: un pod, su Service que ve solo a la 15 y su PDB en 0.",
    conceptos=["release-par"],
    explica="Una release es un par: el gateway de una versión habla solo con el Triton de esa versión. Por eso la 15 tiene su propio Deployment <code>triton-v15</code>, con las mismas reglas que <code>triton-v14</code> (la T4, la toleration, las zonas, las probes, el apagado), su propio Service y su etiqueta <code>classifier/modelo: \"15\"</code>. Empieza con un solo pod: la T4 de más que pagan la sombra y el canary. Con 1 de 1, el PDB va en <code>minAvailable: 0</code>; con 1, ningún drain podría sacarlo.",
    codigo=[{"lang": "yaml", "path": "k8s/triton-v15.yaml", "code": code("k8s/triton-v15.yaml"), "nota": "La imagen se llama solo <code>classifier-triton-v15</code>: kustomize pone el registro y el digest que escribió el CI."},
            {"lang": "yaml", "path": "k8s/kustomization.yaml (del equipo de plataforma; los digests los escribe el CI)", "code": KZ.strip(), "nota": "Un ConfigMap por versión, con nombre fijo: el gateway de cada release monta el de SU versión."}],
    comandos=[
        C("paso 2", "kubectl apply -k k8s/", nota="«PDB configured» en el de la 14 aunque no cambió: una rareza de kubectl con el selector del PDB."),
        C("paso 2", "time kubectl -n classifier rollout status deploy/triton-v15"),
        C("paso 2", "kubectl -n classifier get pods -l app.kubernetes.io/name=triton", nota="La columna MOD es la etiqueta classifier/modelo: dos de la 14 y uno de la 15, cada uno en una T4."),
        C("paso 2", "kubectl -n classifier get pdb", nota="El de la 15 en 0: con un solo pod, un drain lo puede sacar."),
        C("paso 2", "kubectl -n classifier get endpointslices", nota="El Service triton-v15 ve un solo pod: el suyo."),
        C("paso 2", "python3 verificar.py par", nota="verificar.py lee la huella del engine dentro de cada Triton y la compara con la de su versión."),
        C("paso 2", "git add k8s && git commit"),
    ],
    verifica=f"<code>{V} par</code>: cada Triton sirve el engine de su versión, con su Service y su PDB. triton-v15 estuvo listo en ≈ {f_(T15_S)} s.",
    ojo="Un pod nuevo de Triton tarda en cargar su engine (≈ 30 s en el dojo; en C01, de 5 a 13 min con la imagen de 9 GB). Por eso se despliega antes: cuando empiece el canary, ya está caliente."))

G.append(dict(n=3, id="sombra", titulo="La sombra en el gateway", objetivo="Los gateways de la 14 copian el 10 % de las fotos a triton-v15 y anotan lo que contesta, sin que el usuario espere ni vea nada.",
    conceptos=["shadow", "asignacion-hash"],
    explica="Escribe <code>gateway/app/sombra.py</code> siguiendo su contrato. Por cada request, el gateway contesta como siempre y, aparte, llama a <code>copiar()</code>: si el hash del <code>request_id</code> cae en el 10 %, mete la foto ya preparada en una fila acotada, sin esperar. Unas tareas vacían la fila, le preguntan a triton-v15 con su propio plazo y escriben una línea de log con <code>shadow: true</code>. Después el CI publica el gateway nuevo y tres variables (<code>SOMBRA_URL</code>, <code>SOMBRA_VERSION</code>, <code>SOMBRA_FRACCION</code>) la prenden. Con carga, la sombra junta pares.",
    codigo=[{"lang": "python", "path": "gateway/app/sombra.py", "code": code("gateway/app/sombra.py"), "nota": "<code>copiar()</code> es síncrona y usa <code>put_nowait</code>: si la fila está llena, la copia se tira y se cuenta «llena». El usuario nunca espera a la sombra."},
            {"lang": "yaml", "path": "k8s/gateway.yaml (las variables que prenden la sombra)", "code": lineas_con(variante("sombra"), "TRITON_URL", "SOMBRA_"), "nota": "La release sigue siendo la 14 (TRITON_URL a triton-v14); la sombra apunta a triton-v15."}],
    comandos=[
        C("paso 3", "python3 verificar.py sombra-codigo", nota="Prueba el contrato con un Triton falso: la muestra, la fila acotada y el plazo."),
        C("paso 3", "git add gateway && git commit"),
        C("paso 3", "python3 mundo/publicar.py gateway", nota="El CI construye la imagen del gateway con tu sombra y escribe su digest."),
        C("paso 3", "git diff --stat && git commit", code_="git diff --stat && git commit -qam 'gateway: prende la sombra hacia triton-v15 (10 %)'", nota="Las tres líneas de la sombra en k8s/gateway.yaml."),
        C("paso 3", "kubectl apply -k k8s/"),
        C("paso 3", "kubectl -n classifier rollout status deploy/gateway"),
        C("paso 3", "kubectl -n classifier logs deploy/gateway | grep -E", nota="<code>deploy/gateway</code> elige un pod cualquiera: si el rollout acaba de terminar, puede ser uno viejo, que todavía no tiene la sombra."),
        C("paso 3", "python3 mundo/carga.py", nota="Con 40 fotos por segundo, ≈ 4 van también a la sombra."),
        C("paso 3", "python3 mundo/logs.py --resumen", nota="Líneas que atendieron y líneas de la sombra, y cuántos request_id tienen las dos: los pares."),
        C("paso 3", "kubectl -n classifier logs deploy/gateway | grep '\"shadow\": true'", nota="La línea de la sombra: la misma request_id, la versión del challenger y lo que contestó. No va a ningún otro lado."),
    ],
    verifica=f"<code>{V} sombra-codigo</code> en verde y ≈ {f_(PARES3)} pares en los logs después de {f_(SEG3)} s de carga.",
    ojo="La carga es la que trae los pares: sin carga, la sombra no junta nada. Y los logs viven en los pods: si un gateway se reinicia o se reemplaza, se lleva sus líneas (en C01, los logs van a un almacén y el job los lee de ahí)."))

G.append(dict(n=4, id="reporte", titulo="El reporte de la sombra", objetivo="Un reporte que une los pares, los mide contra los umbrales escritos antes y dice si la 15 sigue al canary.",
    conceptos=["acuerdo-top1", "shadow"],
    explica="Escribe <code>sombra/reporte.py</code>: lee las líneas de log, une las dos de cada <code>request_id</code> (la del champion y la de la sombra, las dos en 200) y mide el acuerdo top-1, el p99 de Triton de cada uno en esos mismos pares, las caídas del Triton de la 15 (sus reinicios), las copias que no llegaron y el acuerdo en las 5 categorías más grandes. Lo compara con <code>sombra/umbrales.json</code>, que estaba escrito antes de mirar, y dice «sigue» o «frena», con hasta 20 desacuerdos para que los revise una persona.",
    codigo=[{"lang": "python", "path": "sombra/reporte.py", "code": code("sombra/reporte.py"), "nota": "El p99 se compara en los mismos pares: las dos versiones vieron las mismas fotos."},
            {"lang": "json", "path": "sombra/umbrales.json (de antes; no se toca)", "code": code("sombra/umbrales.json", KIT), "nota": "En C01, los mismos números, con las 20 categorías más grandes."}],
    comandos=[
        C("paso 4", "python3 mundo/logs.py > sombra/evidencia.jsonl"),
        C("paso 4", "python3 sombra/reporte.py", nota="Cada medida contra su umbral. Los desacuerdos van a revisión: ahí se ve si el cambio es bueno."),
        C("paso 4", "python3 -c"),
        C("paso 4", "python3 verificar.py sombra", nota="verificar.py vuelve a contar los pares en la evidencia: el reporte no puede decir otra cosa."),
        C("paso 4", "git add sombra && git commit"),
    ],
    verifica=f"<code>{V} sombra</code>: {f_(PARES4)} pares, acuerdo {('?' if AC4 is None else f'{AC4:.1%}')}, p99 × {f_(P99R4, '{:g}')}, {f_(CAIDAS4)} caídas: la 15 sigue al canary.",
    ojo=f"El umbral del p99 en el dojo es {UMB['p99_max_vs_champion']} × (en C01, 1.1 ×): dos Tritons en el mismo procesador de tu Mac difieren más de 10 % por puro ruido; con 1.1, la sombra frenaría a un modelo sano. Y un acuerdo alto no dice que la 15 es mejor: dice que cambió poco. Lo que dice si mejoró es el gate (estación 4) y, para cambios grandes, un A/B. La sombra responde «¿funciona con tráfico real?», nunca «¿ayuda?»."))

G.append(dict(n=5, id="rollout", titulo="El Rollout", objetivo="El gateway como Rollout de Argo, todavía con la release 14, y el Ingress repartiendo con los pesos que escribe Argo.",
    conceptos=["argo-rollouts", "canary", "alb-pesos"],
    explica="Cambia <code>k8s/gateway.yaml</code> de Deployment a <code>Rollout</code>: el mismo template de pod, más la estrategia canary (5 % por 4 min, 25 % por 3 min, 100 %), los Services <code>gateway-stable</code> y <code>gateway-canary</code>, el bake (<code>scaleDownDelaySeconds: 600</code>) y <code>rollbackWindow</code>. Cambia el Ingress para que su backend sea <code>gateway-stable</code> con el puerto <code>use-annotation</code>: así el ALB lee los pesos de la anotación. La release sigue siendo la 14: este cambio no dispara ningún canary, porque es el primer template del Rollout. Cuando el Rollout tiene sus pods listos, borras el Deployment viejo. El bloque <code>analysis:</code> todavía no va: su AnalysisTemplate llega en el paso 6.",
    codigo=[{"lang": "yaml", "path": "k8s/gateway.yaml", "code": variante("rollout"), "nota": "Así queda en este paso: la release 14, con la sombra todavía prendida y sin el bloque <code>analysis:</code> (llega en el paso 6). En el paso 8, la release 15 cambia solo las líneas de la release y quita la sombra."},
            {"lang": "yaml", "path": "k8s/ingress.yaml", "code": code("k8s/ingress.yaml"), "nota": "Con <code>port: {number: 8080}</code>, el ALB ignoraría los pesos de Argo: es una falla de Romper."}],
    comandos=[
        C("paso 5", "git commit -qam 'gateway: de Deployment a Rollout"),
        C("paso 5", "kubectl apply -k k8s/"),
        C("paso 5", "kubectl argo rollouts -n classifier status gateway"),
        C("paso 5", "kubectl -n classifier get deploy,rs,pods", nota="Por un momento hay dos juegos de gateways: los del Deployment viejo y los del Rollout."),
        C("paso 5", "kubectl -n classifier delete deploy/gateway svc/gateway", nota="El Deployment y el Service de la estación 9 ya no están en git: se borran a mano, una vez."),
        C("paso 5", "ro", nota="El Rollout: sus pasos, el peso actual y sus ReplicaSets."),
        C("paso 5", "kubectl -n classifier get ingress gateway -o jsonpath='{.metadata.annotations", nota="La anotación que escribe Argo: los dos destinos con su peso."),
        C("paso 5", "pesos", nota="Ahora el ALB reparte «por anotación»: 100 % al estable."),
        C("paso 5", "kubectl -n classifier get svc gateway-stable gateway-canary", nota="Argo agregó el hash de los pods estables al selector de los dos (todavía no hay canary)."),
        C("paso 5", "python3 verificar.py reparto sincronia"),
    ],
    verifica=f"<code>{V} reparto sincronia</code>: el ALB aplicando los pesos del Rollout y lo que corre igual a git. El check <code>rollout</code> espera al paso 6: pide el análisis de fondo.",
    ojo="No pongas el bloque <code>analysis:</code> antes de que exista su AnalysisTemplate: un Rollout que nombra un template que no existe queda <code>InvalidSpec</code> («AnalysisTemplate 'canary-vs-estable' not found») y no hace nada hasta que lo arreglas. Por eso el análisis entra en el paso 6, con su template, en un mismo commit. Y mientras exista el Deployment viejo, sus pods también tienen la etiqueta <code>app.kubernetes.io/name: gateway</code>: los Services del Rollout podrían verlos hasta que Argo pone el hash en su selector. Bórralo cuando el Rollout esté sano, no antes."))

G.append(dict(n=6, id="analisis", titulo="El análisis", objetivo="Las 6 reglas del canary, escritas antes: cada una contra el estable o contra un tope, con su n mínimo, y que el estable contra sí mismo no dispare ninguna.",
    conceptos=["analisis", "contra-estable", "n-minimo", "inconclusa", "baja-confianza", "psi"],
    explica="Escribe <code>k8s/analisis.yaml</code>: un AnalysisTemplate con dos argumentos (el hash de los pods canary y el de los estables) y seis métricas, cada una una consulta a Prometheus. Las relativas dividen canary entre estable en la misma ventana; los topes son la promesa de servicio (0.5 % de 5xx, p99 ≤ 200 ms). Cada consulta devuelve −1 mientras el canary no junta su n mínimo: con −1 no se cumple ni la condición de éxito ni la de falla, y la medición sale inconclusa. En el mismo commit, el Rollout gana su bloque <code>analysis:</code>: corre el template de fondo desde el paso 1 del canary, con los hashes del canary (<code>Latest</code>) y del estable (<code>Stable</code>). Antes de confiarle un canary, compruébalo con el estable contra sí mismo: una regla que dispara ahí daría falsas alarmas.",
    codigo=[{"lang": "yaml", "path": "k8s/analisis.yaml", "code": code("k8s/analisis.yaml"), "nota": "<code>initialDelay</code> ≈ el tiempo de juntar el n mínimo al 5 %; <code>inconclusiveLimit: 2</code>: a la tercera inconclusa seguida, el Rollout espera a una persona."},
            {"lang": "yaml", "path": "k8s/gateway.yaml (el bloque que se agrega al Rollout)", "code": BLOQUE_ANALISIS, "nota": "Va en el mismo commit que el template: si el Rollout lo nombra antes de que exista, queda InvalidSpec."}],
    comandos=[
        C("paso 6", "git add k8s && git commit", nota="Dos archivos: el template nuevo y el bloque <code>analysis:</code> del Rollout."),
        C("paso 6", "kubectl apply -k k8s/"),
        C("paso 6", "kubectl -n classifier get analysistemplate"),
        C("paso 6", "python3 mundo/carga.py", nota="Carga para que Prometheus tenga datos del estable."),
        C("paso 6", "curl", nota="La baja confianza del estable en los últimos 3 min: la misma consulta que usa el análisis, con el hash del estable."),
        C("paso 6", "python3 verificar.py rollout analisis", nota="El Rollout ya trae su análisis de fondo. En <code>analisis</code>: las 6 métricas y el estable contra sí mismo ya pasan; lo que falta es un canary abortado (paso 7) y uno que pase (paso 8)."),
    ],
    verifica=f"<code>{V} rollout analisis</code>: el Rollout completo (pasos, análisis de fondo, bake); las 6 métricas existen, comparan contra el estable y no disparan con el estable contra sí mismo (la baja confianza del estable: {f_(BAJA_EST6, '{:.1%}') if BAJA_EST6 is None else f'{BAJA_EST6:.1%}'}). El check se pone en verde al terminar el paso 8.",
    ojo="Dos falsas alarmas reales del dojo, las dos del p99 relativo y las dos con canaries buenos. Con un n mínimo de 200, abortó al 5 % con 1.62 × y ≈ 240 muestras: por eso pide 500 y decide al 25 %. Con 500, la release 15 abortó al 25 % con 1.64 ×: ≈ 16 ms contra ≈ 10 ms, en buckets de 5–10 y 10–20 ms. Una razón entre números tan chicos mide los buckets, no a la versión: por eso el estable lleva un piso de 50 ms (<code>clamp_min(…, 0.05)</code>). Y si una consulta devuelve 0 en lugar de −1 cuando no hay datos, la regla «pasa» con cero evidencia. Prueba cada consulta en Prometheus (<code>localhost:9910</code>) con el hash del estable antes de confiarle un canary."))

c_ens, _ = S("paso 7", "git commit -qam 'ensayo")
G.append(dict(n=7, id="ensayo", titulo="El ensayo con un modelo roto", objetivo="Ver al análisis atrapar un modelo malo al 5 % y a Argo abortar solo; después, volver git a la verdad con un revert.",
    conceptos=["criterio-rollback", "gitops-revert", "analisis", "baja-confianza"],
    explica="Plataforma prende <code>triton-ensayo</code>: un modelo que contesta la misma categoría que la 15, pero con poca confianza. Un commit hace la release del ensayo (el template del gateway apunta a <code>triton-ensayo</code> y monta su ConfigMap). Con carga, aplicas: el canary sube a 5 %, el análisis empieza a medir y, en cuanto la baja confianza junta su n mínimo, la regla falla y Argo aborta: el peso vuelve al estable en segundos y nadie tuvo que despertar. El Rollout queda <code>Degraded</code> porque git sigue pidiendo el ensayo: un <code>git revert</code> lo regresa.",
    codigo=[{"lang": "yaml", "path": "k8s/gateway.yaml (lo que cambia en la release del ensayo)", "code": lineas_con(variante("ensayo"), "classifier/modelo", "TRITON_URL", "configMap:"), "nota": "Tres cosas definen una release: la etiqueta, el Triton al que habla y su ConfigMap. Cambiarlas en un commit dispara el canary."}],
    comandos=[
        C("paso 7", "python3 mundo/ensayo.py prender"),
        cmd(c_ens, O("paso 7", "git commit -qam 'ensayo"), "En C01, Alba ensaya en staging; aquí, con la carga del dojo."),
        C("paso 7", "kubectl apply -k k8s/", nota="Con la carga ya corriendo en otra terminal (abajo)."),
        C("paso 7", "ro", nota="≈ 20 s después: el canary al 5 %, con su AnalysisRun corriendo."),
        C("paso 7", "pesos"),
        C("paso 7", "(cada 5 s", code_=MIRAR, nota="Fase y peso del canary; probar.sh solo anotó los cambios, con los segundos desde el apply."),
        C("paso 7", "ro", n=1, nota="Abortado: el peso volvió a 0 y los pods del ensayo se apagaron."),
        C("paso 7", "corridas", nota="Qué métrica falló, con cuántas mediciones y qué valor."),
        C("paso 7", "pesos", n=1, nota="El ALB ya manda todo al estable."),
        C("paso 7", "kubectl -n classifier get events --field-selector involvedObject.kind=Rollout"),
        cmd("python3 mundo/carga.py --por-segundo 40 --segundos 480 --cada 30   # en otra terminal, antes del apply", CARGA7, "Lo que vio el cliente: cuántas fotos contestó el modelo roto antes del aborto."),
        C("paso 7", "python3 verificar.py sincronia rollout", nota="El tráfico ya volvió, pero git sigue pidiendo el ensayo: el Rollout está abortado y el check lo dice."),
        C("paso 7", "git revert --no-edit"),
        C("paso 7", "kubectl apply -k k8s/", n=1),
        C("paso 7", "kubectl argo rollouts -n classifier status gateway", nota="Sano otra vez: el template vuelve a ser el de la release estable."),
        C("paso 7", "python3 mundo/ensayo.py apagar"),
        C("paso 7", "python3 verificar.py rollout sincronia"),
    ],
    verifica=f"El canary del ensayo abortó solo a los ≈ {f_(ABORTO7_S)} s por <code>{MALA7_M}</code> (última medición: {MALA7_V}), y {f_(ENS_N)} de {f_(ENS_TOT)} fotos las contestó el modelo roto. Después del revert, <code>{V} rollout sincronia</code> en verde.",
    ojo="Después del aborto, la tentación es <code>kubectl argo rollouts retry</code> o <code>undo</code>. No: git todavía pide el ensayo. El arreglo es el revert; mientras tanto no hay prisa, el tráfico ya volvió."))

G.append(dict(n=8, id="canary-15", titulo="El canary de la release 15", objetivo="La release 15 sube 5 % → 25 % → 100 % sola, con las 6 reglas en verde y sin que nadie apriete un botón.",
    conceptos=["canary", "inconclusa", "n-minimo", "contra-estable", "analisis"],
    explica="Un commit cambia las tres líneas de la release (la etiqueta, <code>TRITON_URL</code> a <code>triton-v15</code> y su ConfigMap) y quita la sombra: la 15 ya no necesita copias. Con carga, aplicas y miras: al 5 %, las reglas de 5xx y de baja confianza y el PSI juntan su n mínimo y deciden; el p99 sale inconcluso porque al 5 % no junta 500 en su ventana. Al 25 %, con 10 fotos por segundo, el p99 también decide. Al terminar la pausa, el peso pasa a 100 % y el Rollout queda Healthy, con la release 14 todavía prendida (el bake).",
    codigo=[],
    comandos=[
        C("paso 8", "git diff | head -60", nota="Lo que cambia de la release 14 a la 15: la etiqueta, el Triton, el ConfigMap; y se va la sombra."),
        C("paso 8", "git commit -qam 'release 15"),
        cmd("python3 mundo/carga.py --por-segundo 40 --segundos 900 --cada 30   # en otra terminal, antes del apply", CARGA8, "El reparto por versión cada 30 s: 5 %, 25 % y 100 % de la 15."),
        C("paso 8", "kubectl apply -k k8s/"),
        C("paso 8", "ro", nota="≈ 30 s después: 5 %, con el análisis corriendo de fondo."),
        C("paso 8", "pesos"),
        C("paso 8", "(cada 5 s", code_=MIRAR, nota="Hasta llegar al 25 %."),
        C("paso 8", "ro", n=1),
        C("paso 8", "pesos", n=1),
        C("paso 8", "corridas", nota="Al 25 %: lo que ya decidió y lo que sigue inconcluso."),
        C("paso 8", "(cada 5 s", n=1, code_=MIRAR, nota="Hasta el 100 %."),
        C("paso 8", "ro", n=2, nota="Healthy: la 15 es el estable. La ReplicaSet de la 14 sigue con sus pods (el bake: <code>scaleDownDelaySeconds</code>)."),
        C("paso 8", "corridas", n=1, nota="El AnalysisRun terminó en Successful."),
        C("paso 8", "pesos", n=2),
    ],
    verifica=f"El canary llegó al 25 % a los ≈ {f_(A25_S)} s y al 100 % ≈ {f_(SANO8_S)} s después, con su AnalysisRun en Successful. La carga: {f_(N8)} fotos, {f_(N5XX8)} respuestas 5xx.",
    ojo="Si el análisis sale Inconclusive, el Rollout se pausa y espera a una persona: casi siempre es que no había carga y ninguna regla juntó su n mínimo. Arranca la carga y reanuda (<code>kubectl argo rollouts -n classifier promote gateway</code> solo para una pausa inconclusa), o empieza otra vez con un nuevo apply."))

G.append(dict(n=9, id="promover-bake", titulo="Promover, ensayar la vuelta y el bake", objetivo="@champion en la 15 cuando ya es verdad; ensayar el runbook (volver a la 14 en segundos y regresar a la 15); y solo entonces el commit del bake, con la 14 viva y reducida.",
    conceptos=["promover-alias", "bake", "runbook", "gitops-revert"],
    explica="Escribe <code>ci/promover.py</code>: espera a que el Rollout esté sano al 100 % y mueve @champion a la versión del template, con su run y el digest de su Triton; si ya está ahí, no hace nada. Después ensayas el runbook con carga: un <code>git revert</code> de la release 15 regresa a la 14 en segundos, porque su ReplicaSet sigue prendido (el bake) y <code>rollbackWindow</code> se salta los pasos; el alias también vuelve a la 14. Regresar a la 15 es otro revert, pero ahí <code>rollbackWindow</code> no ayuda: solo acelera volver a un ReplicaSet <b>anterior</b>; ir hacia adelante corre otra vez los pasos y el análisis, como Argo de verdad. Cuando la 15 está otra vez al 100 % y promovida, va el commit del bake: triton-v15 a 2 pods (uno por zona, PDB 1) y triton-v14 a 1 (PDB 0) hasta que termine. Al final, <code>RUNBOOK.md</code> deja escrito todo esto para la persona de guardia.",
    codigo=[{"lang": "python", "path": "ci/promover.py", "code": code("ci/promover.py"), "nota": "Sano al 100 % = Healthy, sin abortar, y el ReplicaSet estable es el del template actual."},
            {"lang": "markdown", "path": "RUNBOOK.md", "code": code("RUNBOOK.md"), "nota": "Se escribe en calma para usarse con prisa, por alguien que no hizo el cambio."}],
    comandos=[
        C("paso 9", "time python3 ci/promover.py"),
        C("paso 9", "python3 mundo/modelos.py ver"),
        C("paso 9", "python3 ci/promover.py", nota="Otra vez: no hace nada."),
        C("paso 9", "git revert --no-edit", nota="El runbook en el bake: revertir sin diagnosticar. (Con 60 s de carga corriendo en otra terminal.)"),
        C("paso 9", "kubectl apply -k k8s/", nota="Las líneas «---» son la fase y el peso cada vez que cambian, hasta Healthy."),
        C("paso 9", "ro"),
        C("paso 9", "python3 mundo/modelos.py alias champion 14", nota="En el bake, el alias también regresa: promover ya lo había movido."),
        cmd("python3 mundo/carga.py --por-segundo 40 --segundos 60 --cada 5   # en otra terminal, antes del revert", O("paso 9", "cat ", 0), "El cliente vio el cambio de la 15 a la 14 en un renglón de 5 s, sin errores de por medio."),
        C("paso 9", "git revert --no-edit HEAD", nota="«Reapply»: de vuelta a la 15 (con carga otra vez, 10 min)."),
        C("paso 9", "kubectl apply -k k8s/", n=1),
        C("paso 9", "ro", n=1, nota="Hacia adelante no hay atajo: el canary empieza otra vez en 5 %."),
        C("paso 9", "(cada 5 s", code_=MIRAR, nota="El canary completo, con su análisis, hasta Healthy."),
        C("paso 9", "time python3 ci/promover.py", n=1, nota="Espera a que el Rollout esté sano y mueve @champion de nuevo a la 15."),
        cmd("python3 mundo/carga.py --por-segundo 40 --segundos 600 --cada 60   # en otra terminal, antes del segundo revert", O("paso 9", "cat ", 1), "La carga del regreso: el reparto por versión mientras la 15 volvía a subir."),
        C("paso 9", "ro", n=2),
        C("paso 9", "python3 mundo/modelos.py ver", n=1),
        C("paso 9", "git diff --stat && git commit", code_="git diff --stat && git commit -qam 'bake: triton-v15 con 2 pods, triton-v14 con 1 (PDB 0) hasta que termine'", nota="El commit del bake, cuando ya estás seguro de que la vuelta funciona."),
        C("paso 9", "kubectl apply -k k8s/", n=2),
        C("paso 9", "kubectl -n classifier rollout status deploy/triton-v15"),
        C("paso 9", "kubectl -n classifier get pods -L classifier/modelo", nota="La 15 con sus 2 Tritons y sus 3 gateways; la 14 con 1 Triton y sus gateways todavía prendidos."),
        C("paso 9", "ro", n=3),
        C("paso 9", "python3 verificar.py bake alias"),
        C("paso 9", "git add RUNBOOK.md ci && git commit"),
        C("final", V, nota="Al final de la estación: los 12 checks."),
    ],
    verifica=f"Volver a la 14 tardó ≈ {f_(VUELTA14_S)} s, con {f_(OK9)} de {f_(N9)} fotos en 200 durante ese minuto; regresar a la 15 corrió el canary completo en ≈ {f_(VUELTA15_S)} s. Después del bake, <code>{V} bake alias</code> y los 12 checks en verde.",
    ojo="El commit del bake (bajar triton-v14 a 1 pod) va después de ensayar la vuelta, no antes. En una corrida anterior se hizo al revés: con la 14 en un solo Triton, la vuelta le mandó todo el tráfico, salieron 504 de la 14 y el segundo canary de la 15 abortó por el p99 (2.9 × el del estable, que ya estaba sobrecargado). Y el alias no se mueve solo con el revert: en el bake, el runbook lo regresa a mano (<code>mundo/modelos.py alias champion 14</code>); si se te olvida, el gate del mes que entra compara contra la versión equivocada."))

REPARTO = {
    1: (["alb-pesos"], []),
    2: (["release-par"], []),
    3: (["shadow", "asignacion-hash"], ["pares-sombra"]),
    4: (["acuerdo-top1"], []),
    5: (["canary", "argo-rollouts"], []),
    6: (["analisis", "contra-estable", "n-minimo", "baja-confianza", "psi"], ["falsa-alarma", "psi-piso"]),
    7: (["criterio-rollback", "gitops-revert"], ["dano-por-fase"]),
    8: (["inconclusa"], ["minutos-n-minimo"]),
    9: (["promover-alias", "bake", "runbook"], ["costo-escalera"]),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
e["guiado"] = G

# ---------------------------------------------------------------- Solo
e["solo"] = {
    "reglas": [
        "Empieza con el kit recién descomprimido en una carpeta nueva y el clúster nuevo: <code>python3 mundo/crear.py --de-cero</code>. El clúster es uno solo (<code>dojo-rollout</code>).",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo tuyo.",
        "Cada objetivo tiene su check; corre <code>python3 verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Lo que corre sale de git: commit y <code>kubectl apply -k k8s/</code>. Nada de <code>kubectl edit</code> ni <code>kubectl argo rollouts promote|undo|retry</code> para que un check pase.",
        "Las reglas de otros equipos no se tocan: <code>k8s/kustomization.yaml</code>, <code>sombra/umbrales.json</code>, la taint de las T4, <code>mundo/</code>. Un canary necesita carga: <code>python3 mundo/carga.py --por-segundo 40 --segundos 900 --cada 30</code> en otra terminal.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El clúster con sus 6 nodos, el registro, Argo Rollouts, el ALB del dojo, Prometheus y el registro de modelos.", "check": "mundo"},
        {"n": 2, "objetivo": "Cada versión del modelo en su propio Triton, con su Service que ve solo a su versión y su PDB que deja vaciar un nodo; y cada release del gateway hablando solo con el Triton de su versión.", "check": "par", "pista": "¿Qué minAvailable necesita un PDB cuando su Deployment tiene un solo pod?"},
        {"n": 3, "objetivo": "Una sombra que copia el 10 % de las requests por hash del request_id, sin bloquear nunca al usuario, con su propio plazo y tirando copias cuando la fila se llena.", "check": "sombra-codigo", "pista": "¿Qué pasa con la request del usuario si la copia espera a que haya lugar en la fila?"},
        {"n": 4, "objetivo": "Un reporte de la sombra, con al menos el mínimo de pares, que mide la 15 contra la 14 con los umbrales escritos antes y dice que sigue.", "check": "sombra"},
        {"n": 5, "objetivo": "El gateway como un Rollout canary: 5 % y después 25 %, cada pausa con su duración, el análisis de fondo, un bake que deja viva la release anterior y volver a una release reciente sin pasos.", "check": "rollout", "pista": "¿Cuánto tiempo deja Argo Rollouts prendida la release anterior si no le dices nada?"},
        {"n": 6, "objetivo": "El ALB repartiendo con los pesos que pide el Rollout, no con un puerto fijo.", "check": "reparto", "pista": "¿Cómo sabe el ALB que tiene que leer la anotación y no mandar todo a un Service?"},
        {"n": 7, "objetivo": "Seis reglas contra el estable o contra un tope, cada una con su n mínimo, que no disparan con el estable contra sí mismo; un canary que abortaron y uno que pasaron.", "check": "analisis", "pista": "¿Qué devuelve tu consulta cuando el canary todavía no tiene requests?"},
        {"n": 8, "objetivo": "@champion en la versión que atiende el 100 %, con su run y el digest de su Triton, movido solo cuando el Rollout está sano.", "check": "alias"},
        {"n": 9, "objetivo": "Durante el bake, el Triton de la versión anterior vivo con un pod y el de la nueva con dos, uno por zona.", "check": "bake"},
        {"n": 10, "objetivo": "Un runbook con los 6 pasos y, en «Revertir», cómo se vuelve en cada fase: el revert, cómo se aplica y cómo regresa @champion.", "check": "runbook"},
        {"n": 11, "objetivo": "200 fotos por el ALB, todas contestadas.", "check": "servicio"},
        {"n": 12, "objetivo": "Lo que corre en el clúster es exactamente lo que dice k8s/ en git, y ya no queda el Deployment de la estación 9.", "check": "sincronia"},
    ],
}


# ---------------------------------------------------------------- fallas
def campo(falla_id: str, nombre: str) -> str:
    """Un campo del diccionario FALLAS de romper.py (la misma historia y título que verá la persona)."""
    t = code("romper.py", KIT)
    bloque = re.search(r'"' + re.escape(falla_id) + r'": dict\((.*?)aplicar=', t, re.S)
    m = re.search(nombre + r'="(.*?)"', bloque.group(1), re.S) if bloque else None
    if not m:
        sys.exit(f"✗ no encontré {nombre} de {falla_id} en romper.py")
    return m.group(1)


FAL = []


def falla(id_, tipo, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto_, check, nota=""):
    FAL.append(dict(id=id_, titulo=campo(id_, "titulo"), tipo=tipo, historia=campo(id_, "historia"), sintoma=sintoma,
                    hipotesis=hipotesis, confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto_, check=check))


def sint(f, filtro=r"^✗"):
    return "<code>verificar.py</code>: " + F(f"{f} verificar", filtro=filtro)


PESOS_F = 'kubectl -n dojo-alb exec deploy/alb -- python -c "import urllib.request as u;print(u.urlopen(\\"http://localhost:8081\\").read().decode())"'
LOG_KZ = "git log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^\\+'"
FUGA_ARR = F("fuga-en-el-bake arreglo")
FUGA_S = num(FUGA_ARR, r"la 14 atiende el 100 % a los (\d+) s")
DUD = F("canary-dudoso analisis")
DUD_PSI = txt(DUD, r"^psi Failed \['?([\d.]+)")

falla("peso-fantasma", "config", sint("peso-fantasma"),
      ["Cambió el backend del Ingress y el ALB dejó de leer los pesos.", "Argo Rollouts dejó de escribir la anotación.", "El ALB del dojo se cayó."],
      "kubectl -n classifier get ingress gateway -o jsonpath='{.spec.rules[0].http.paths[0].backend.service}{\"\\n\"}'\n" + PESOS_F + "\n" + LOG_KZ,
      F("peso-fantasma ingress") + "\n\n" + F("peso-fantasma log"),
      "Un patch del equipo de plataforma en <code>k8s/kustomization.yaml</code> cambió el backend del Ingress de <code>port: {name: use-annotation}</code> a <code>port: {number: 8080}</code>. Con un puerto normal, el ALB (en C01, el AWS Load Balancer Controller) manda todo a <code>gateway-stable</code> e ignora la anotación que escribe Argo. Hoy no se ve nada: todo contesta 200. Pero el próximo canary «al 5 %» recibiría 0 %, ninguna regla juntaría su n mínimo y, al terminar los pasos, la release nueva pasaría al 100 % de golpe, sin evidencia. Arreglo: <code>git revert</code> del commit y <code>kubectl apply -k k8s/</code>; el ALB vuelve a repartir «por anotación».",
      "alb-pesos", "reparto")
falla("bake-corto", "config", sint("bake-corto"),
      ["Alguien bajó scaleDownDelaySeconds del Rollout.", "El Triton de la versión anterior ya no existe.", "Cambió el rollbackWindow."],
      "kubectl -n classifier get rollout gateway -o jsonpath='{.spec.strategy.canary.scaleDownDelaySeconds}{\"\\n\"}'\n" + LOG_KZ,
      F("bake-corto spec") + "\n\n" + F("bake-corto log"),
      "Un patch de FinOps en <code>k8s/kustomization.yaml</code> puso <code>scaleDownDelaySeconds: 30</code>: el valor por omisión de Argo Rollouts. 30 s después de llegar al 100 %, el gateway de la release anterior se apaga. Si la nueva falla en el bake, volver ya no es un cambio de ruteo a algo prendido: hay que levantar pods otra vez. Lo que ahorra son centavos de pods de CPU contra el seguro de volver en segundos (la cuenta de la escalera). Arreglo: <code>git revert</code> del commit, <code>kubectl apply -k k8s/</code> y explicarle a FinOps la cuenta.",
      "bake", "rollout")
falla("alias-atrasado", "mundo", sint("alias-atrasado"),
      ["El registro de modelos volvió a un estado viejo.", "El Rollout regresó a la release anterior.", "promover.py nunca corrió."],
      "python3 mundo/modelos.py ver\nkubectl argo rollouts -n classifier get rollout gateway --no-color | sed -n 1,12p",
      F("alias-atrasado registro") + "\n\n" + F("alias-atrasado estable"),
      "El respaldo del registro de modelos era de antes de la promoción: @champion volvió a la 14 aunque la que atiende el 100 % es la 15. En producción no se ve nada (ningún servidor lee el alias), pero el gate del mes que entra compararía al candidato contra el modelo equivocado, y el runbook regresaría a la versión equivocada. Arreglo: <code>python3 ci/promover.py</code>, que es idempotente: mueve champion a la release estable, con su run y su digest.",
      "promover-alias", "alias")
falla("par-cruzado", "config", sint("par-cruzado"),
      ["triton-v15 está sirviendo otro modelo.", "El gateway de la 15 habla con triton-v14.", "El ConfigMap de la 15 trae la versión equivocada."],
      "kubectl -n classifier get deploy triton-v14 triton-v15 -o custom-columns='NOMBRE:.metadata.name,IMAGEN:.spec.template.spec.containers[0].image'\ngit log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^[-+]  '",
      F("par-cruzado imagenes") + "\n\n" + F("par-cruzado log"),
      "Un commit de plataforma puso en <code>k8s/kustomization.yaml</code> el digest de la imagen de la 14 en la entrada <code>classifier-triton-v15</code>. La imagen de Triton trae el engine adentro: <code>triton-v15</code> ahora sirve el modelo de octubre detrás del nombre de la 15, mientras el gateway escribe <code>resnet50-2026-11-01</code> en cada log porque eso dice su ConfigMap. Dos modelos detrás del mismo nombre, y ninguna métrica sabe a cuál culpar. Lo delata la huella del engine que lee <code>verificar.py par</code>. Arreglo: <code>git revert</code> y <code>kubectl apply -k k8s/</code>.",
      "release-par", "par")
falla("canary-dudoso", "config", sint("canary-dudoso"),
      ["El análisis abortó el canary de la 16.", "La 16 da errores 5xx.", "El ALB no está repartiendo."],
      "kubectl argo rollouts -n classifier get rollout gateway --no-color | sed -n 1,12p\nkubectl -n classifier get analysisrun --sort-by=.metadata.creationTimestamp | tail -2\n# y, del último AnalysisRun, cada métrica con su fase y su última medición\npython3 mundo/modelos.py ver",
      F("canary-dudoso rollout") + "\n\n" + DUD + "\n\n" + F("canary-dudoso registro"),
      f"La versión 16 se lleva a «bolsas» fotos que eran de otras categorías: confía igual que la 15 y no truena (cero 5xx), pero el PSI de las categorías que predice pasó de 0.1 (la última medición: {DUD_PSI}). El análisis la atrapó al 5 % y Argo abortó solo: el tráfico ya volvió a la 15 y @champion nunca se movió. Lo que falta es git: el repositorio sigue pidiendo la 16, así que el Rollout se queda Degraded. Arreglo: <code>git revert</code> del commit del CI y <code>kubectl apply -k k8s/</code>. Sin el PSI, ninguna otra regla la habría frenado; y «sin sombra, no hay tiempo» es justo cuando más falta el canary.",
      "psi", "rollout")
falla("fuga-en-el-bake", "infra", sint("fuga-en-el-bake"),
      ["El Triton de la 15 cambió y truena en algunas requests.", "El gateway de la 15 tiene un problema.", "El problema es de afuera y la 14 también fallaría."],
      "tail -3 .taller/carga-falla.log\ncurl -s localhost:9910/api/v1/query --data-urlencode 'query=sum by (modelo) (rate(classifier_requests_total{code=~\"5..\"}[1m])) / sum by (modelo) (rate(classifier_requests_total[1m]))' | python3 -m json.tool | grep -E 'modelo|\"0\\.'",
      F("fuga-en-el-bake carga") + "\n\n" + F("fuga-en-el-bake errores"),
      f"El CI reconstruyó la imagen de <code>triton-v15</code> con un parche de la imagen base y el cambio se aplicó como un rolling update del Deployment, sin canary: el Triton nuevo truena en ≈ 4 % de las requests. Es lo que cubre el runbook: revertir sin diagnosticar. La 14 sigue viva (el bake): <code>git revert</code> del commit de la release 15, <code>kubectl apply -k k8s/</code> (con <code>rollbackWindow</code>, la 14 atiende el 100 % a los {f_(FUGA_S)} s) y <code>python3 mundo/modelos.py alias champion 14</code>. Confirmas con carga y <code>verificar.py servicio alias</code>. Después, con calma, la causa: <code>git log -p k8s/kustomization.yaml</code> muestra que cambió el digest de triton-v15. Revertir solo el commit del CI también arregla, pero exige diagnosticar primero y tarda un rolling update de Triton.",
      "runbook", "servicio")
e["fallas"] = FAL

e["listo"] = [
    "La versión 15 tiene su propio Triton, desplegado antes que nadie le mandara tráfico, y cada release del gateway habla solo con el suyo.",
    "La sombra copió el 10 % de las fotos sin que el usuario esperara, y su reporte, con umbrales escritos antes, dijo que sigue.",
    "El gateway es un Rollout que sube 5 % → 25 % → 100 % solo, con el ALB aplicando sus pesos.",
    "Seis reglas comparan al canary contra el estable, con n mínimo: abortaron un modelo roto y dejaron pasar a la 15.",
    "@champion se movió al final, la release anterior quedó viva en el bake y volver a ella fue un git revert de segundos.",
    "Un runbook de 6 pasos dice qué hace la persona de guardia en cada fase.",
]

e["repaso"] = {
    "memo": "<b>Copiar, repartir, comparar, abortar, promover y dejar viva la anterior.</b> La versión nueva primero <b>copia</b> (la sombra: 10 % por hash, nadie ve su respuesta) y se mide con umbrales escritos antes. Después el ALB <b>reparte</b> por pesos que escribe Argo Rollouts (5 %, 25 %, 100 %), y un análisis de fondo <b>compara</b> canary contra estable en la misma ventana, con un n mínimo por regla y topes absolutos como red. Si una regla falla, Argo <b>aborta</b> solo; git se corrige después con un revert. Al 100 %, un job <b>promueve</b> @champion. Y la release anterior sigue prendida en el bake, para que volver sea un cambio de ruteo.",
    "trampa": "Creer que un rolling update con readiness es un despliegue seguro para un modelo (mide salud, no calidad); una regla relativa sin n mínimo, que revierte versiones buenas; o volver con <code>kubectl argo rollouts undo</code> en lugar de un <code>git revert</code>.",
    "entrevista": [
        {"q": "Tienes un modelo nuevo que pasó la evaluación offline. ¿Cómo lo pones en producción?", "a": "Por peldaños, cada uno con una pregunta: shadow (copias del tráfico real, nadie ve la respuesta) para ver que funciona, con acuerdo, latencia y caídas contra umbrales escritos antes; canary con pesos en el balanceador (5 %, 25 %, 100 %) comparado contra el estable con rollback automático; un A/B solo si el cambio es grande y hay que medir a la gente; y un bake con la versión anterior viva para volver en segundos. El alias del registro se mueve al final."},
        {"q": "¿Por qué no basta un rolling update con readiness probes?", "a": "Porque la readiness mide salud, no calidad: un modelo que confunde categorías contesta 200 en 30 ms. Además no controla el porcentaje (con pocos pods, el primero nuevo ya recibe un tercio) y no compara contra nada. Para un modelo hacen falta señales sobre lo que contesta (baja confianza, PSI de las predicciones) y compararlas contra la versión estable."},
        {"q": "¿Cómo decides si el canary sigue o se revierte?", "a": "Con reglas escritas antes, en un análisis que corre de fondo: relativas contra el estable en la misma ventana (5xx ≥ 2×, p99 > 1.2×, baja confianza > 1.5×, PSI > 0.1) y topes absolutos de la promesa (0.5 % de 5xx, p99 de 200 ms). Contra el estable, porque los dos ven la misma mezcla de tráfico y se cancela el ruido del día. Cada regla con su n mínimo: sin él, una regla relativa con pocas requests revierte versiones idénticas por azar (Poisson con λ chico)."},
        {"q": "¿Por qué hace falta un n mínimo y cómo lo eliges?", "a": "Porque con pocas requests los errores salen por azar: con λ = 3.5 errores esperados, ver 7 pasa 6 % de las veces, y en 24 decisiones casi seguro revierte una versión buena. El n mínimo sale de una cuenta de potencia: cuántas requests del canary hacen falta para ver que la tasa de errores se duplica con una significancia y una potencia dadas, usando la tasa real del estable; y se revisa cuando esa tasa cambia. El p99 pide más, porque mira la cola."},
        {"q": "¿Qué es el bake y qué pasa si no lo configuras en Argo Rollouts?", "a": "Es el tiempo en que la release anterior sigue prendida después del 100 %, para que volver sea un cambio de ruteo y no levantar pods. Argo apaga el ReplicaSet anterior a los 30 s por omisión y volver a él correría otra vez todos los pasos; por eso se pide scaleDownDelaySeconds largo (horas) y rollbackWindow. El Triton anterior es un Deployment aparte y se quita con un PR al terminar."},
        {"q": "Son las 3 a. m. y suena la alerta de 5xx después de una release. ¿Qué haces?", "a": "El runbook: primero revertir, sin diagnosticar. Si fue en el canary, ya se revirtió solo y falta el revert en git. En el bake, git revert del commit de la release y aplicar (con rollbackWindow va directo a la anterior, en segundos) y regresar el alias champion. Confirmar que las métricas vuelven; si no vuelven, el problema no era la versión: kill switch. Después congelar despliegues, comunicar e investigar con calma."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-rollout/CLAUDE.md",
    "guiado": "content/estaciones/c01-rollout/prompts/guiado.md",
    "solo": "content/estaciones/c01-rollout/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-rollout/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-rollout/prompts/romper-solo.md",
}

if FALTAN:
    print("⚠ borrador: faltan " + str(len(dict.fromkeys(FALTAN))) + ":\n  " + "\n  ".join(dict.fromkeys(FALTAN)))
(APP / "content/estaciones/c01-rollout.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· conceptos:", len(e["conceptos"]), "· precálculos:", len(e["precalculos"]["cuentas"]),
      "· pasos:", len(G), "· objetivos:", len(e["solo"]["objetivos"]), "· fallas:", len(FAL), "· preguntas:", len(e["repaso"]["entrevista"]))
