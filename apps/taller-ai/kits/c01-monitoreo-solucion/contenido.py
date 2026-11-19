"""Arma content/estaciones/c01-monitoreo.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e12 <venv> && bash probar-fallas.sh /tmp/e12 <venv>   # deja /tmp/e12.log y /tmp/e12.fallas.log
    python3 contenido.py /tmp/e12                                            # escribe el JSON con esas salidas
    python3 contenido.py /tmp/e12 --borrador                                 # lo escribe aunque falten secciones
    python3 contenido.py /tmp/e12 --fallas /tmp/e11                          # una falla que no se metió en e12, de otra corrida

Ninguna salida se copia a mano: cada `salida` sale de un comando de una sección «### nombre» de los logs.
- <carpeta>.log: los pasos 0 a 9 del Guiado («### paso N: …», cada comando como «$ comando» y su salida). Los comandos
  que empiezan con «sleep N; » se muestran sin la espera (la dice la nota) y partidos en una línea por comando; el
  «time » de adelante se quita y la línea «real …» de su salida también. `mundo/promtool.py rellenar` imprime sus
  propios «$ docker compose exec …»: son salida, no comandos.
- <carpeta>.fallas.log: «### <falla> <etapa>», cada sección directamente con su salida. Una falla cuenta solo si su
  sección «romper» dice que se metió («falla: <id> ·»); si no (otra seguía activa), sus secciones salen de la corrida
  de --fallas, si se dio y ahí sí se metió, o faltan.
El código de los pasos sale de los archivos de la solución (observabilidad/*, diario/*), de pasos.py (las versiones
de reglas.yml y pruebas.yml en los pasos 1 a 3) y de probar.sh / probar-fallas.sh (las funciones q y alertas, la prueba
sin la ventana corta y los comandos de cómo confirmar cada falla), nunca escrito aquí. Solo usa la biblioteca estándar.
"""
import ast
import importlib.util
import json
import math
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

argv = sys.argv[1:]
OTRA = Path(argv.pop(argv.index("--fallas") + 1)) if "--fallas" in argv and argv.index("--fallas") + 1 < len(argv) else None
args = [a for a in argv if not a.startswith("--")]
BORRADOR = "--borrador" in sys.argv
CARPETA = Path(args[0]) if args else sys.exit("uso: python3 contenido.py <carpeta de probar.sh> [--borrador] [--fallas <otra>]")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
KIT = APP / "kits" / "c01-monitoreo"
RUTA = str(CARPETA)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
FALTAN = []


def leer(p: Path) -> str:
    return p.read_text() if p.exists() else ""


def limpiar(t: str) -> str:
    t = ANSI.sub("", t)
    base = str(Path(RUTA).parent).removeprefix("/private")   # cualquier corrida de la misma carpeta (p12, f12…)
    t = re.sub(r"(/private)?" + re.escape(base) + r"/venv\b", "~/c01-monitoreo/.venv", t)   # el venv de probar.sh
    t = re.sub(r"(/private)?" + re.escape(base) + r"/[A-Za-z0-9_-]+", "~/c01-monitoreo", t)
    lineas = [ln.rstrip() for ln in t.split("\n")
              if not re.match(r"^(user|sys)\s+[\dms.]+$", ln.strip()) and not re.match(r"^\[código \d+\]$", ln.strip())]
    return "\n".join(lineas)


def secciones(texto: str) -> dict:
    out = {}
    for m in re.finditer(r"^### ([^\n]+)\n(.*?)(?=^### |\Z)", limpiar(texto), re.S | re.M):
        out[m.group(1).strip()] = m.group(2)
    return out


def comillas(t: str) -> int:
    return len(re.findall(r'(?<!\\)"', t))


def sin_espera(c: str) -> str:
    return re.sub(r"^sleep \d+; ", "", c)


def comandos(cuerpo: str) -> list:
    out, cur = [], None
    for ln in cuerpo.split("\n"):
        if cur is not None and not cur[1] and comillas(cur[0]) % 2:   # un comando de varias líneas (python -c "…")
            cur[0] += "\n" + ln
        elif ln.startswith("$ ") and not ln.startswith("$ docker compose exec"):   # rellenar imprime sus «$ docker …»
            cur = [ln[2:], []]
            out.append(cur)
        elif cur is not None:
            cur[1].append(ln)
    return [(c, "\n".join(o).strip("\n")) for c, o in out]


def partir(c: str) -> list:
    """Un comando de shell partido en sus «; » de primer nivel (fuera de comillas y de $(…))."""
    partes, cur, q, prof, i = [], "", None, 0, 0
    while i < len(c):
        ch = c[i]
        if q:
            if ch == "\\" and q == '"':
                cur += c[i:i + 2]
                i += 2
                continue
            if ch == q:
                q = None
        elif ch in "'\"":
            q = ch
        elif c.startswith("$(", i):
            prof += 1
        elif ch == ")" and prof:
            prof -= 1
        elif c.startswith("; ", i) and not prof:
            partes.append(cur)
            cur, i = "", i + 2
            continue
        cur += ch
        i += 1
    return partes + [cur]


def mostrar(c: str) -> str:
    """Cómo se muestra un comando del log: sin la espera, sin «time», una línea por comando, sin los «echo» sueltos."""
    c = sin_espera(c)
    if c.startswith("for "):
        return c
    return "\n".join(re.sub(r"^time ", "", p) for p in partir(c) if p.strip() != "echo")


LOG = secciones(leer(Path(f"{CARPETA}.log")))
LOGF = secciones(leer(Path(f"{CARPETA}.fallas.log")))
LOGF2 = secciones(leer(Path(f"{OTRA}.fallas.log"))) if OTRA else {}


def falta(que: str) -> str:
    FALTAN.append(que)
    if not BORRADOR:
        sys.exit(f"✗ falta {que}")
    return "(pendiente: " + que + ")"


def seccion(nombre: str):
    """La sección del log del Guiado cuyo nombre empieza con `nombre` («paso 3» encuentra «paso 3: la baja confianza»)."""
    k = next((k for k in LOG if k == nombre or k.startswith(nombre + ":")), None)
    return LOG[k] if k else None


def S(sec: str, empieza: str, n: int = 0, exacto: bool = False):
    """(comando, salida) del n-ésimo comando de la sección que empieza con `empieza` (sin contar el «sleep N; » de
    adelante), o que es `empieza`, con exacto."""
    cuerpo = seccion(sec)
    if cuerpo is None:
        return empieza, falta(f"la sección «{sec}» en {CARPETA.name}.log")
    xs = [(c, o) for c, o in comandos(cuerpo) if (sin_espera(c) == empieza if exacto else sin_espera(c).startswith(empieza))]
    if len(xs) <= n:
        return empieza, falta(f"el comando «{empieza}…» (#{n + 1}) en «{sec}»")
    return xs[n]


def O(sec: str, empieza: str, n: int = 0, filtro=None, quitar=None, max_lineas=None, exacto=False, crudo=False) -> str:
    out = S(sec, empieza, n, exacto)[1]
    lineas = out.split("\n")
    if not crudo:
        lineas = [ln for ln in lineas if not re.match(r"^real\s+\d+m[\d.]+s$", ln)]
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
    if nombre not in secs or not secs[nombre].strip():
        return falta(f"la sección «{nombre}» en {CARPETA.name}.fallas.log")
    USADAS[fid] = CARPETA.name if secs is LOGF else OTRA.name
    lineas = secs[nombre].strip("\n").split("\n")
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    return "\n".join(lineas).strip("\n")


def pendiente(texto) -> bool:
    return (texto or "").startswith("(pendiente")


def num(texto: str, rx: str, todas=False, n=None):
    """El primer (el último, con todas=True; o el n-ésimo) número que atrapa `rx`, como float; None si no está (en borrador)."""
    ms = re.findall(rx, texto or "", re.M)
    if not ms or (n is not None and len(ms) <= n):
        if BORRADOR or pendiente(texto):
            if not pendiente(texto):
                FALTAN.append(f"un número que no salió: {rx!r} en «{(texto or '').splitlines()[0][:60] if texto else ''}…»")
            return None
        sys.exit(f"✗ no encontré {rx!r} en:\n{(texto or '')[:400]}")
    v = ms[n] if n is not None else ms[-1] if todas else ms[0]
    if isinstance(v, tuple):
        v = v[0]
    return float(str(v).replace(",", ""))


def txt(texto: str, rx: str, todas=False) -> str:
    ms = re.findall(rx, texto or "", re.M)
    if not ms:
        if not (BORRADOR or pendiente(texto)):
            sys.exit(f"✗ no encontré {rx!r} en:\n{(texto or '')[:400]}")
        if not pendiente(texto):
            FALTAN.append(f"un texto que no salió: {rx!r} en «{(texto or '').splitlines()[0][:60] if texto else ''}…»")
        return "?"
    v = ms[-1] if todas else ms[0]
    return v[0] if isinstance(v, tuple) else v


def f_(x, fmt="{:,.0f}") -> str:
    """Un número formateado, o «?» si todavía no salió en los logs."""
    return "?" if x is None else fmt.format(x)


def mul(*xs):
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
    """Un comando del log tal como se corrió (sin espera ni «time»; o con `code_` si se muestra distinto) y su salida real."""
    c, _ = S(sec, empieza, n, exacto)
    return cmd(code_ or mostrar(c), O(sec, empieza, n, exacto=exacto, **kw), nota)


def segundos(salida: str):
    m = re.search(r"real\s+(\d+)m([\d.]+)s", salida or "")
    return int(m.group(1)) * 60 + float(m.group(2)) if m else None


def hora(t: str):
    """«07:19:12» o «2026-11-19T07:19:12…» → datetime (solo la hora importa), o None."""
    m = re.search(r"(\d\d):(\d\d):(\d\d)", t or "")
    return datetime(2000, 1, 1, *map(int, m.groups())) if m else None


def minutos(a, b):
    return (b - a).total_seconds() / 60 if a and b else None


def ok_check(salida: str, check: str) -> bool:
    return bool(re.search(rf"^✓ {re.escape(check)}\s", salida or "", re.M))


V = "python verificar.py"
ROMPER_IDS = set(re.findall(r'^    "([a-z0-9-]+)": dict\(', (KIT / "romper.py").read_text(), re.M))
QV = r"\}\s+(-?[\d.]+(?:e[-+]?\d+)?)$"          # el valor de una línea de q: «{…} 4.56»

# ---------------------------------------------------------------- el código, de los archivos
PROBAR = code("probar.sh")
PROBARF = code("probar-fallas.sh")
Q_FUNC = re.search(r"^q\(\) \{.*?; \}$", PROBAR, re.S | re.M).group(0)
ALERTAS_FUNC = re.search(r"^alertas\(\) \{.*?; \}$", PROBAR, re.S | re.M).group(0)
SIN_CORTA = "\n".join(ln for ln in PROBAR.split("\n")
                      if ln.startswith(("cp observabilidad/reglas.yml", "sed -i", "cp /tmp/reglas-dojo-12.yml")))
SIN_CORTA = SIN_CORTA.replace("\ncp /tmp/reglas-dojo-12.yml", "\npython mundo/promtool.py prueba\ncp /tmp/reglas-dojo-12.yml")
REGLAS = code("observabilidad/reglas.yml")
PRUEBAS = code("observabilidad/pruebas.yml")
AM = code("observabilidad/alertmanager.yml")


def _pasos():
    spec = importlib.util.spec_from_file_location("pasos_solucion", SOL / "pasos.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


PASOS = _pasos()
REGLAS1, PRUEBAS2 = PASOS.reglas(1).rstrip("\n"), PASOS.pruebas(2).rstrip("\n")


def grupo(nombre: str) -> str:
    """Un grupo de reglas.yml, desde su «- name:» hasta el siguiente."""
    i = REGLAS.index(f"  - name: {nombre}")
    j = REGLAS.find("\n  - name: ", i + 1)
    return REGLAS[i:j if j > 0 else None].rstrip("\n")


PRUEBAS4 = PRUEBAS[PRUEBAS.index("  # 3. La baja confianza"):].rstrip("\n")

# las fallas: cómo se confirma cada una sale de probar-fallas.sh («paso "$f <etapa>" sh -c "…"»), una línea por comando
ALERTAS_F = re.search(r"^alertas\(\) \{ (.*?); \}$", PROBARF, re.S | re.M).group(1)


def confirmar_de(falla_id: str, *etapas: str) -> str:
    bloque = PROBARF[PROBARF.index(f"f={falla_id}\n"):]
    fin = re.search(r"\n\nf=|\n\npaso \"restaurar", bloque)
    bloque = bloque[:fin.start()] if fin else bloque
    out = []
    for et in etapas:
        m = re.search(r'^paso "\$f ' + re.escape(et) + r'" (.*)$', bloque, re.M)
        if not m:
            sys.exit(f"✗ no encontré la etapa «{et}» de {falla_id} en probar-fallas.sh")
        c = m.group(1)
        m2 = re.match(r'sh -c "(.*)"$', c) or re.match(r"sh -c '(.*)'$", c)
        c = m2.group(1).replace('\\"', '"') if m2 else c
        out += [("\n".join([ALERTAS_F]) if p.strip() == "alertas" else p.strip()) for p in partir(c) if p.strip() != "echo"]
    return "\n".join(out)


def campos_romper() -> dict:
    """Los títulos, tipos e historias de romper.py (el diccionario FALLAS), leídos con ast: lo que verá la persona."""
    arbol = ast.parse(code("romper.py", KIT))
    for n in arbol.body:
        if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "FALLAS":
            out = {}
            for k, v in zip(n.value.keys, n.value.values):
                out[k.value] = {kw.arg: kw.value.value for kw in v.keywords if isinstance(kw.value, ast.Constant)}
            return out
    sys.exit("✗ no encontré FALLAS en romper.py")


ROMPER = campos_romper()

# ---------------------------------------------------------------- los números que salen de los logs
CREAR = O("paso 0", "time python mundo/crear.py")
CREAR_S = num(CREAR, r"el mundo está arriba en (\d+) s")
HIST_D0 = txt(CREAR, r"60 días \((\d{4}-\d\d-\d\d) a")
HIST_D1 = txt(CREAR, r"60 días \(\d{4}-\d\d-\d\d a (\d{4}-\d\d-\d\d)\)")
HIST_REQ = num(CREAR, r"([\d,]+) requests en logs/predicciones")
HIST_EV = num(CREAR, r"([\d,]+) eventos en eventos/publicaciones")
GOLDEN_N = num(CREAR, r"golden set \(([\d,]+) fotos\)")
OM_SERIES = num(CREAR, r"historia\.om: (\d+) series")
BAJA_ESP = num(CREAR, r"baja confianza esperada ([\d.]+)")
REQ_S = num(O("paso 0", "q 'sum(rate(classifier_requests_total[1h]))'"), QV)
MUESTRAS8 = num(O("paso 0", "q 'count_over_time(classifier_top1_score_count[8d])'"), QV)
V0 = O("paso 0", V, exacto=True)
VERDE0 = num(V0, r"^(\d+)/12 en verde")
VERDES0 = re.findall(r"^✓ (\S+)", V0, re.M)

BETA1 = num(O("paso 1", "q 'classifier:error_ratio:rate1h / 0.001'"), QV)
T_PRUEBA2 = segundos(O("paso 2", "time python mundo/promtool.py prueba", crudo=True))
SIN_CORTA_OUT = O("paso 2", "python mundo/promtool.py prueba", exacto=True)
SIN_CORTA_T = txt(SIN_CORTA_OUT, r"alertname: ClassifierErrorBudgetFastBurn, time: (\S+?),")
SIN_CORTA_T = re.sub(r"^(\d+)h(\d+)m$", r"\1 h \2 min", SIN_CORTA_T)

_q3a = O("paso 3", "q 'classifier:low_confidence_share:rate30m'")
N_ANTES3 = num(_q3a, QV, n=1)
_q3b = O("paso 3", "q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'")
N_REL, AVG7, MIN7, MAX7 = (num(_q3b, QV, n=i) for i in range(4))
REL_OUT = O("paso 3", "time python mundo/promtool.py rellenar")

T_PRUEBA4 = segundos(O("paso 4", "time python mundo/promtool.py prueba", crudo=True))
_est4 = O("paso 4", "curl -s localhost:8966/estado")
LATIDO4 = num(_est4, r'"latido_hace_s": ([\d.]+)')
V4 = O("paso 4", "python verificar.py pruebas-propias alertmanager")
PRUEBA_AM_S = num(V4, r"prueba en (\d+) s")

_p5 = [O("paso 5", x) for x in ("date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton --falla 30",
                                 "python mundo/capas.py | head -2",
                                 "date -u +%H:%M:%S; q 'classifier:error_ratio:rate1h",
                                 "date -u +%H:%M:%S; q 'classifier:error_ratio:rate30m")]
_p5b = [O("paso 5", "date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton", exacto=True),
        O("paso 5", "date -u +%H:%M:%S; q 'classifier:error_ratio:rate5m"),
        O("paso 5", "python mundo/tickets.py avisos 4; python mundo/tickets.py")]
T5_0 = hora(_p5[0])
R5_60, R1H_60 = num(_p5[1], QV, n=0), num(_p5[1], QV, n=1)
P5_60 = num(_p5[1], r"5xx ([\d.]+)%")
T5_2, T5_3, T5_5 = hora(_p5[2]), hora(_p5[3]), hora(_p5b[1])
FAST_AT = hora(txt(_p5[2], r"^ClassifierErrorBudgetFastBurn page firing (\S+)"))
PAGE_AT = hora(txt(_p5[2], r"^(\S+) guardia\s+firing\s+ClassifierErrorBudgetFastBurn"))
R30_5 = num(_p5[3], QV, n=0)
SLOW_AT = hora(txt(_p5[3], r"^ClassifierErrorBudgetSlowBurn ticket firing (\S+)"))
CALLADO = bool(re.search(r"^ClassifierErrorBudgetSlowBurn suppressed", _p5[3], re.M))
T5_FIX = hora(_p5b[0])
TICKET_AT = hora(txt(_p5b[2], r"^(\S+) tickets\s+firing\s+ClassifierErrorBudgetSlowBurn"))
RESUELTO_AT = hora(txt(_p5b[1] + "\n" + _p5b[2], r"^(\S+) guardia\s+resolved\s+ClassifierErrorBudgetFastBurn"))
M_FAST, M_SLOW, M_PAGE = minutos(T5_0, FAST_AT), minutos(T5_0, SLOW_AT), minutos(T5_0, PAGE_AT)
M_FIX, M_RES, M_TICKET = minutos(T5_0, T5_FIX), minutos(T5_FIX, RESUELTO_AT), minutos(RESUELTO_AT, TICKET_AT)
M_2, M_3, M_5 = minutos(T5_0, T5_2), minutos(T5_0, T5_3), minutos(T5_FIX, T5_5)
BETA_FALLA = (R30_5 * 30 - (30 - M_FIX)) / M_FIX if R30_5 and M_FIX else None   # el β de los minutos con falla

J6 = O("paso 6", "time python diario/monitoreo.py", exacto=True)
FILAS_AYER = num(J6, r"filas\s+([\d,]+)")
PSI_AYER = num(J6, r"PSI ([\d.]+)")
BAJA_AYER = num(J6, r"baja confianza ([\d.]+)%")
ACEPT_AYER = num(J6, r"aceptación ([\d.]+)%")
N_AYER = num(J6, r"\(n ([\d,]+)\)")
RES6 = O("paso 6", "python -c")
HOLD_N = num(RES6, r'"n": (\d+),\s*\n\s*"aciertos"')
DIA_MAL = O("paso 6", "python diario/monitoreo.py --dia")
DESDE6 = O("paso 6", "time python diario/monitoreo.py --desde")
DIAS6 = re.findall(r"^(\d{4}-\d\d-\d\d)\s+filas\s+[\d,]+\s+PSI ([\d.]+)", DESDE6, re.M)
T_DESDE = segundos(O("paso 6", "time python diario/monitoreo.py --desde", crudo=True))
PSI_ALTOS = [d for d, p in DIAS6 if float(p) > 0.2]

SECO7 = O("paso 7", "python diario/disparador.py --desde")
BOT = re.findall(r"^(\S+)\s+al reporte: categoria=botines cambió (-?[\d.]+) pts \(n chico: ([\d,]+) / ([\d,]+)", SECO7, re.M)
BOT_N1, BOT_N0 = (float(BOT[-1][2].replace(",", "")), float(BOT[-1][3].replace(",", ""))) if BOT else (None, None)
BOT_PTS = float(BOT[-1][1]) if BOT else None
BOT_M = 196 * math.sqrt(0.21 / BOT_N1 + 0.21 / BOT_N0) if BOT_N1 else None

MOB8 = O("paso 8", "python mundo/tickets.py ver aceptacion-source=mobile")
MOB_N = num(MOB8, r'"n": (\d+)')
MOB_N0 = num(MOB8, r'"n_antes": (\d+)')
MOB_PTS = num(MOB8, r'"cambio_pts": (-?[\d.]+)')
MOB_M = num(MOB8, r'"margen_pts": ([\d.]+)')
DRF8 = O("paso 8", "python mundo/tickets.py ver drift-psi")
ABR_N = num(DRF8, r'"n": (\d+)')
ABR_PTS = num(DRF8, r'"cambio_pts": (-?[\d.]+)')
ABR_M = num(DRF8, r'"margen_pts": ([\d.]+)')

M9 = O("paso 9", "time python diario/muestras.py")
COLA_N = num(M9, r"tareas\.json: (\d+) fotos")
CAND_N = num(M9, r"\(([\d,]+) candidatas")
INC_N = num(M9, r"incertidumbre (\d+)")
AZAR_N = num(M9, r"azar (\d+)")
EXTRA = re.findall(r"extra:(\S+) (\d+)", M9)
COLA_MES = txt(M9, r"cola-(\d{4}-\d\d)/")
CRON_S = num(O("paso 9", "time python mundo/cron.py correr"), r"terminó bien en ([\d.]+) s")
V9 = O("paso 9", "time python verificar.py")
VERDE9 = num(V9, r"^(\d+)/12 en verde")
T_V9 = segundos(O("paso 9", "time python verificar.py", crudo=True))

# las fallas: lo que dejó probar-fallas.sh
LAT_BUSCA = F("latido-perdido buscapersonas")
LAT_S = num(LAT_BUSCA, r'"latido_hace_s": ([\d.]+)')
LAT_DESDE = hora(txt(LAT_BUSCA, r'"latido_perdido_desde": "(\S+)"'))
LAT_AVISO = hora(txt(LAT_BUSCA, r'^(\S+) latido\s+\{"estado": "perdido"'))
LAT_ROMPER = F("latido-perdido romper")
LAT_YA = F("latido-perdido verificar ya")
RET_HIST = F("retencion-corta historia")
RET_N = num(RET_HIST, r"\}\s+(\d+)$", n=2)       # 2 pods del gateway y luego la regla grabada
RET_FLAG = txt(RET_HIST, r"^retention (\S+)")
RET_DESP = F("retencion-corta después")
RET_N2 = num(RET_DESP, r"\}\s+(\d+)$", n=2)
DEC_CAPAS = F("decode-nuevo capas")
DEC_PSI = num(DEC_CAPAS, r"PSI de categorías 3 min vs 7 días ([\d.]+)")
DEC_BAJA = num(DEC_CAPAS, r"baja confianza [\d.]+% / [\d.]+% \(([\d.]+)×\)")
APP_CAPAS = F("app-nueva capas")
APP_BYTES = re.search(r"mobile (\d+) / (\d+)", APP_CAPAS or "")
APP_BAJA = num(APP_CAPAS, r"baja confianza [\d.]+% / [\d.]+% \(([\d.]+)×\)")
EXA_N = num(F("examen-nuevo verificar"), r"(\d+) fotos de la cola están en el examen")

# ---------------------------------------------------------------- la estación
e = {
    "id": "monitoreo", "patron": "sincrono", "caso": "c01", "num": 12,
    "titulo": "Monitoreo y reentrenamiento", "nav": "Monitoreo",
    "pregunta": "La release 15 atiende todo el tráfico y cada request deja su rastro, pero nadie lo vigila con método. ¿Qué tiene que despertar a alguien a las 3 de la mañana y qué puede esperar a la semana, cómo pruebas una alerta de 6 horas o de 7 días sin esperar, cómo notas que el modelo empeora aunque todo conteste 200 y rápido, y cómo conviertes esa señal en una decisión, con diagnóstico, que vuelve a la estación 1 como fotos para etiquetar?",
    "version": "2026-11-19",
}

e["mapa"] = {
    "resumen": "La estación 11 dejó a cada request con su rastro: una línea de log, sumas en Prometheus y el día de ayer en Parquet. Aquí ese rastro se vuelve <b>vigilancia y decisiones</b>: alertas que miden qué tan rápido se gasta el <b>presupuesto de errores</b> (burn rate, en dos ventanas); la <b>baja confianza</b> del modelo contra su propio promedio de 7 días; <b>pruebas</b> de esas reglas que simulan días en segundos; <b>Alertmanager</b>, que despierta a la guardia solo cuando toca y un <b>latido</b> que avisa si el camino de las alertas se rompe; un <b>job diario</b> que calcula el PSI y la aceptación; un <b>disparador</b> que abre un ticket por causa, con su diagnóstico, y la <b>cola de etiquetado</b> que devuelve el ciclo a la estación 1.",
    "entra": [
        "la release 15 (<code>resnet50-2026-11-01</code>) atendiendo todo el tráfico, con el rastro de la estación 11: el contador de requests, los histogramas de latencia y de score, y una línea de log por request",
        "60 días de historia en S3: el log de predicciones en Parquet (lo que deja el job de la estación 11), los eventos del backend de publicaciones, el examen fijo y el historial de despliegues",
        "Prometheus con 8 días de métricas ya guardadas, Alertmanager y la Pushgateway corriendo, sin ninguna regla tuya",
        "lo que decide plataforma: el SLO (99.9 % en 30 días), el job programado y su cuenta, el dueño de cada source y las integraciones del buscapersonas",
    ],
    "sale": [
        "4 recording rules de la fracción de errores y 2 alertas de burn rate (page: 1 h y 5 min; ticket: 6 h y 30 min), la de baja confianza con su historia rellenada, MonitoringJobStale y el Watchdog, todas con pruebas de promtool",
        "un Alertmanager que manda cada severidad a su receptor, calla el ticket que repite un page del mismo SLO y deja pasar el latido",
        "32 resúmenes diarios en S3 (PSI, baja confianza, bytes, aceptación por slice y holdout) y sus números en la Pushgateway, vigilados por su frescura",
        "3 tickets, uno por causa y con diagnóstico, decididos por una persona: avisar al equipo de la app mobile, sin reentrenar, y una corrida adelantada por el drift de abrigos",
        "la cola de etiquetado del mes siguiente, con su tanda extra de abrigos: el ciclo vuelve a la estación 1",
    ],
    "escala": [
        {"que": "El tráfico", "c01": "≈ 10 M requests al día: ≈ 116 por segundo en promedio", "taller": f"≈ 5 fotos por segundo en vivo ({f_(REQ_S, '{:.2f}')} en la última hora al empezar); un día de la historia, ≈ 20,000 requests"},
        {"que": "El SLO y su presupuesto", "c01": "99.9 % sin error del servidor en 30 días: 300,000 requests o 43.2 min al mes", "taller": "el mismo SLO, en <code>mundo/plataforma.yaml</code>, y las mismas ventanas y umbrales en tus reglas; <code>promtool test rules</code> simula los días"},
        {"que": "Prometheus", "c01": "kube-prometheus-stack en EKS: lee cada 15 s, evalúa cada 1 min, guarda 15 días; las reglas son un PrometheusRule", "taller": f"Prometheus v3.15.1 en <code>localhost:9962</code>: lee cada 5 s, evalúa cada 15 s, guarda 15 días y nace con 8 días de métricas ({f_(MUESTRAS8)} lecturas por pod)"},
        {"que": "De la alerta a la persona", "c01": "Alertmanager (dos réplicas) → PagerDuty (page), Slack (warning), Jira (ticket) y un dead man's switch fuera del clúster", "taller": "Alertmanager v0.34.2 en <code>localhost:9963</code> → el buscapersonas del dojo (<code>localhost:8966</code>), que hace de los cuatro"},
        {"que": "El job diario", "c01": "el CronWorkflow <code>monitoreo-diario</code> de Argo, a las 01:00 UTC, ≈ 20 min; publica en la Pushgateway", "taller": f"<code>mundo/cron.py</code> corre tus dos pasos en ≈ {f_(CRON_S, '{:g}')} s; Pushgateway v1.11.5 en <code>localhost:9964</code>"},
        {"que": "Lo que mide el modelo", "c01": "500 categorías; el PSI sobre ≈ 30 categorías padre; la baja confianza normal, ≈ 4 %", "taller": f"10 categorías; la baja confianza normal, {f_(mul(AVG7, 100), '{:.1f}')} %"},
        {"que": "Los labels", "c01": "≈ 2.5 M publicaciones al día (≈ 17 M a la semana) y un holdout de ≈ 1 % de vendedores (≈ 25 mil al día)", "taller": f"≈ {f_(N_AYER)} publicaciones con la sugerencia mostrada al día; holdout, {f_(HOLD_N)} ayer"},
        {"que": "La cola de etiquetado", "c01": "≈ 5,000 fotos al mes, y ≈ 500 por cada tanda extra que pide un ticket", "taller": "500 al mes (300 por incertidumbre y 200 al azar) y 100 por cada tanda extra"},
    ],
    "hoja": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo",
}

# ---------------------------------------------------------------- precálculos
DIA_REQ = mul(REQ_S, 86_400)
MES_PRESUP = mul(DIA_REQ, 30, 0.001)
HORA_REQ = mul(REQ_S, 3_600)
PAGE_ERR = mul(HORA_REQ, 0.0144)
TICKET_ERR = mul(HORA_REQ, 6, 0.006)
T_SONAR_C01 = 60 * 13.4 / 29                     # 3 % sobre un fondo de 1×: (30t + (60 − t)) ÷ 60 = 14.4
T_SONAR_DOJO = 60 * 13.4 / (BETA_FALLA - 1) if BETA_FALLA else None
T_TICKET_DOJO = 360 * 5 / (BETA_FALLA - 1) if BETA_FALLA else None
UMBRAL_DOJO = mul(AVG7, 2, 100)
_d0 = date.fromisoformat(HIST_D0) if HIST_D0 != "?" else None
PRIMER_JOB = _d0 + timedelta(days=28) if _d0 else None
PRIMER_DISP = PRIMER_JOB + timedelta(days=13) if PRIMER_JOB else None
EXTRA_N = sum(int(n) for _, n in EXTRA)

e["precalculos"] = {
    "intro": "Antes de escribir, las cuentas de servilleta: cuánto presupuesto de errores tiene el mes, qué fracción de errores hace sonar el page y el ticket, cuántas muestras tiene una regla en 7 días (y por qué las pruebas evalúan cada 2 min), dónde queda el umbral de la baja confianza, cuánto tarda en sonar un incidente, cuántos días de historia necesita el job, cuánto ruido tiene la aceptación de un slice y cuántas fotos salen a etiquetar. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "presupuesto-mes", "pregunta": "¿Cuántas requests pueden fallar en un mes sin romper el SLO?",
            "formula": "presupuesto en requests = (1 − SLO) × requests al día × 30 · en tiempo = (1 − SLO) × minutos del mes",
            "c01": {"cuenta": "0.001 × 10,000,000 × 30 = 300,000 requests; en tiempo, 0.001 × 43,200 min = 43.2 min de caída total", "valor": "300,000 requests · 43.2 min al mes"},
            "taller": {"cuenta": f"{f_(REQ_S, '{:.2f}')} req/s × 86,400 ≈ {f_(DIA_REQ)} al día; 0.001 × {f_(DIA_REQ)} × 30 ≈ {f_(MES_PRESUP)} requests al mes. En tiempo, lo mismo que C01: 43.2 min", "valor": f"≈ {f_(MES_PRESUP)} requests · 43.2 min al mes"},
            "decide": "Que una alerta no pregunta «¿hay errores?» (siempre hay) sino «¿a este ritmo rompemos la promesa del mes?». Cada request con 5xx gasta una de esas 300,000; los 4xx no gastan nada, porque son culpa de quien llama. Y que 43.2 minutos al mes no alcanzan para que un incidente espere a que alguien mire el tablero.",
            "conceptos": ["slo-presupuesto"],
            "comprueba": C("paso 0", "q 'sum(rate(classifier_requests_total[1h]))'", nota="Las requests por segundo de la última hora, al levantar el mundo. q es la función de terminal del paso 1."),
            "confirma": "el paso 1: las 4 recording rules dividen los 5xx entre las requests sin 4xx.",
        },
        {
            "id": "page-14x", "pregunta": "¿Qué fracción de errores hace sonar el page, cuántas requests son y en cuánto se acabaría el mes?",
            "formula": "β = fracción del presupuesto que toleras perder × 720 h ÷ horas de la ventana · fracción con error = β × (1 − SLO) · se agota en 720 ÷ β horas",
            "c01": {"cuenta": "perder 2 % del mes en 1 h: β = 0.02 × 720 ÷ 1 = 14.4; fracción = 14.4 × 0.001 = 1.44 %; 416,667 requests en la hora × 0.0144 ≈ 6,000 con error; el mes se acabaría en 720 ÷ 14.4 = 50 h", "valor": "14.4× · 1.44 % · ≈ 6,000 en 1 h · 50 h"},
            "taller": {"cuenta": f"el mismo umbral, <code>14.4 * 0.001</code> en tu regla; con {f_(REQ_S, '{:.2f}')} req/s, una hora son ≈ {f_(HORA_REQ)} requests y el 1.44 % ≈ {f_(PAGE_ERR)} con error. Hoy la ventana de 1 h va a {f_(BETA1, '{:.2f}')}×", "valor": f"1.44 % · ≈ {f_(PAGE_ERR)} errores en 1 h"},
            "decide": "El umbral del page sale al revés: no de «cuántos errores me parecen muchos», sino de cuánto presupuesto aceptas perder antes de despertar a alguien. Con 2 % del mes en una hora, a ese ritmo el mes entero se acaba en dos días: vale la pena despertar a la guardia.",
            "conceptos": ["burn-rate"],
            "comprueba": C("paso 1", "q 'classifier:error_ratio:rate1h / 0.001'", nota="El burn rate de la última hora: la fracción de errores entre el presupuesto (0.001)."),
        },
        {
            "id": "ticket-6x", "pregunta": "¿Y el ticket: qué fracción, cuántas requests y cuánto duraría el mes?",
            "formula": "β = 0.05 × 720 ÷ 6 · fracción con error = β × (1 − SLO) · requests con error = requests por hora × 6 × fracción",
            "c01": {"cuenta": "perder 5 % del mes en 6 h: β = 0.05 × 720 ÷ 6 = 6; fracción = 0.6 %; 416,667 × 6 × 0.006 ≈ 15,000 con error; el mes se acabaría en 720 ÷ 6 = 120 h = 5 días", "valor": "6× · 0.6 % · ≈ 15,000 en 6 h · 5 días"},
            "taller": {"cuenta": f"el mismo umbral, <code>6 * 0.001</code>; con ≈ {f_(HORA_REQ)} requests por hora, 6 h al 0.6 % son ≈ {f_(TICKET_ERR)} con error", "valor": f"0.6 % · ≈ {f_(TICKET_ERR)} errores en 6 h"},
            "decide": "Que el gasto lento es trabajo de la semana, no de la madrugada: C01 tiene un respaldo (si no hay sugerencia, quien vende elige la categoría a mano), así que 0.6 % durante 6 h abre un ticket. Un servicio sin respaldo, como un pago, lo dejaría en page. Y lo que se escapa: un 0.5 % sostenido (5×) no llega a 6× y ninguna de las dos alertas lo ve, aunque en una semana se coma más del mes.",
            "conceptos": ["burn-rate", "severidades"],
            "confirma": f"el paso 5: con Triton fallando, el ticket lento sonó a los {f_(M_SLOW, '{:.1f}')} min, y Alertmanager lo calló mientras el page seguía sonando.",
        },
        {
            "id": "muestras-7-dias", "pregunta": "¿Cuántas muestras tiene una regla grabada en 7 días, y por qué tus pruebas evalúan cada 2 min?",
            "formula": "muestras en 7 días = 7 × 1,440 ÷ minutos entre evaluaciones",
            "c01": {"cuenta": "Prometheus evalúa cada 1 min: 7 × 1,440 = 10,080 muestras que promedia <code>avg_over_time(…[7d])</code>. promtool test carga a lo más 10,000 muestras por consulta: 10,080 no caben; evaluando cada 2 min, 5,040 sí", "valor": "10,080 (no caben en promtool test) · 5,040 cada 2 min"},
            "taller": {"cuenta": f"el relleno del paso 3 evalúa minuto a minuto, como C01: después de rellenar, la regla tiene {f_(N_REL)} muestras en 7 días. Las pruebas de <code>pruebas.yml</code> evalúan cada 2 min: 5,040", "valor": f"{f_(N_REL)} muestras en 7 días"},
            "decide": "El <code>evaluation_interval: 2m</code> de <code>pruebas.yml</code>: con 1 min, la prueba de la baja confianza (7 días de historia) truena por pasarse del tope, no por tu regla. Y que el promedio de 7 días de una regla recién cargada no es de 7 días: antes de rellenar, el paso 3 encontró apenas " + f"{f_(N_ANTES3)} muestras.",
            "conceptos": ["promtool-test", "relleno-retencion"],
            "comprueba": C("paso 3", "q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'", nota="Después de rellenar y de que Prometheus tomara los bloques: las muestras de la regla en 7 días, su promedio, su mínimo y su máximo."),
            "confirma": "el paso 2: <code>python mundo/promtool.py prueba</code> corre con <code>evaluation_interval: 2m</code>.",
        },
        {
            "id": "umbral-baja-confianza", "pregunta": "¿Dónde queda el umbral de la baja confianza, y cuántas fotos dudosas hacen falta para que suene?",
            "formula": "umbral = 2 × el promedio de 7 días de la regla · fotos en 30 min = fotos por segundo × 1,800 · dudosas para sonar > umbral × fotos en 30 min · volumen mínimo: más de 1 foto/s",
            "c01": {"cuenta": "base ≈ 4 % → umbral ≈ 8 %; 116 × 1,800 = 208,800 fotos en 30 min; más de 0.08 × 208,800 ≈ 16,704 dudosas, sostenido 30 min. El volumen mínimo, 1,800 fotos en la media hora, siempre se cumple de día", "valor": "≈ 8 % · > 16,704 dudosas en 30 min"},
            "taller": {"cuenta": f"base {f_(mul(AVG7, 100), '{:.1f}')} % → umbral {f_(UMBRAL_DOJO, '{:.1f}')} %; ≈ 5 × 1,800 = 9,000 fotos en 30 min → más de ≈ {f_(mul(AVG7, 2, 9000))} dudosas. En los 7 días grabados, la regla fue de {f_(mul(MIN7, 100), '{:.1f}')} % a {f_(mul(MAX7, 100), '{:.1f}')} %: nunca cerca del umbral", "valor": f"{f_(UMBRAL_DOJO, '{:.1f}')} % · > ≈ {f_(mul(AVG7, 2, 9000))} dudosas en 30 min"},
            "decide": f"Que la alerta ve saltos de golpe hacia arriba (una app que manda fotos peores), no el cambio lento ni la caída (un modelo de pronto seguro de todo lo ve el chequeo en vivo, no esta regla): ayer la baja confianza del día fue {f_(BAJA_AYER, '{:.1f}')} %, por el frío y la app nueva, y no la cruza. Lo lento lo ve el job diario. Y que contra un promedio propio, no un número fijo, la alerta se acomoda sola a la temporada.",
            "conceptos": ["baja-confianza"],
            "comprueba": C("paso 3", "q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'", nota="El promedio de 7 días (la segunda línea) es la base del umbral."),
        },
        {
            "id": "cuando-suena", "pregunta": "Si empieza un incidente, ¿cuántos minutos tarda en sonar el page?",
            "formula": "con un fondo de ≈ 1× y un incidente de β, la ventana de 1 h cruza 14.4× cuando (β × t + (60 − t)) ÷ 60 = 14.4: t = 60 × 13.4 ÷ (β − 1) min · el ticket, con 6 h y 6×: t = 360 × 5 ÷ (β − 1) min",
            "c01": {"cuenta": f"3 % de errores (β = 30): t = 804 ÷ 29 ≈ {T_SONAR_C01:.1f} min, entre el 27 y el 28; con 100 % de errores (β = 1,000), ≈ 0.8 min, y suena en la siguiente evaluación", "valor": "≈ 27 min con 3 % · ≈ 1 min con 100 %"},
            "taller": {"cuenta": f"Triton con 30 % de inferencias que truenan: la ventana de 30 min del paso 5 da β ≈ {f_(BETA_FALLA)} en los minutos con falla; t = 804 ÷ {f_(mul(BETA_FALLA, 1) - 1 if BETA_FALLA else None)} ≈ {f_(T_SONAR_DOJO, '{:.1f}')} min. En vivo sonó a los {f_(M_FAST, '{:.1f}')} min (Prometheus evalúa cada 15 s) y el page llegó a la guardia a los {f_(M_PAGE, '{:.1f}')}. El ticket: 1,800 ÷ {f_(mul(BETA_FALLA, 1) - 1 if BETA_FALLA else None)} ≈ {f_(T_TICKET_DOJO, '{:.1f}')} min; sonó a los {f_(M_SLOW, '{:.1f}')}", "valor": f"≈ {f_(T_SONAR_DOJO, '{:.1f}')} min calculado · {f_(M_FAST, '{:.1f}')} en vivo"},
            "decide": "Que el burn rate se adapta solo: cuanto peor el incidente, más rápido suena, sin escribir una regla para cada caso. Y que la ventana corta no retrasa el aviso (con un incidente fuerte, la de 5 min cruza en segundos); lo que hace es apagarlo pronto después del arreglo.",
            "conceptos": ["burn-rate", "multiventana"],
            "comprueba": C("paso 5", "date -u +%H:%M:%S; q 'classifier:error_ratio:rate1h", nota=f"{f_(M_2, '{:.1f}')} min después de que Triton empezó a fallar: la ventana de 1 h, las alertas y lo que le llegó a la guardia."),
            "confirma": "el paso 2: la prueba del 3 % espera el page en el minuto 28 del incidente y nada en el 26.",
        },
        {
            "id": "dias-de-historia", "pregunta": "¿Desde qué día puede correr el job diario, y desde cuál puede opinar el disparador?",
            "formula": "primer día del job = primer día de la historia + 28 (los días de referencia del PSI) · primer día del disparador = primer día con resumen + 13 (dos semanas de resúmenes)",
            "c01": {"cuenta": "el Parquet se guarda 90 días: cualquier día tiene sus 28 de referencia. Pero un job nuevo no tiene resúmenes: el disparador compara dos semanas, así que se corre hacia atrás al menos 14 días, o espera dos semanas antes de su primer ticket", "valor": "28 días de referencia · 14 de resúmenes"},
            "taller": {"cuenta": f"la historia va de {HIST_D0} a {HIST_D1}: el primer día con sus 28 anteriores es {PRIMER_JOB}, y de ahí a ayer son {len(DIAS6) or '?'} resúmenes; el disparador, con dos semanas, desde {PRIMER_DISP}", "valor": f"{len(DIAS6) or '?'} resúmenes · disparador desde {PRIMER_DISP}"},
            "decide": "Que un job que publica un PSI calculado sobre menos días de los que dice es peor que uno que truena: por eso el tuyo termina con error si falta un día de la referencia. Y desde qué día correr cada cosa en el Guiado.",
            "conceptos": ["psi"],
            "comprueba": C("paso 6", "python diario/monitoreo.py --dia", nota="Un día antes del primero posible: falta un día de la referencia y el job no escribe ni publica nada."),
        },
        {
            "id": "ruido-aceptacion", "pregunta": "¿Cuánto se mueve por azar la aceptación de un slice, y cuántas publicaciones necesita para abrir un ticket?",
            "formula": "margen al 95 % = 1.96 × √(a × (1 − a) ÷ n) · al comparar dos semanas: 1.96 × √(a(1 − a) ÷ n₁ + a(1 − a) ÷ n₀)",
            "c01": {"cuenta": "a = 0.70: con n = 5,000, 1.96 × √(0.21 ÷ 5,000) ≈ ± 1.3 puntos; dos semanas de 5,000, ≈ ± 1.8; con 500, ± 4.0; el total de la semana (≈ 17.3 M), ± 0.02", "valor": "± 1.3 con 5,000 · ± 1.8 al comparar semanas"},
            "taller": {"cuenta": f"el ticket de mobile: {f_(MOB_N)} contra {f_(MOB_N0)} publicaciones, cayó {f_(mul(MOB_PTS, -1), '{:.2f}')} puntos con un margen de ± {f_(MOB_M, '{:.2f}')}; abrigos: n {f_(ABR_N)}, {f_(mul(ABR_PTS, -1), '{:.2f}')} puntos, ± {f_(ABR_M, '{:.2f}')}. Botines cayó {f_(mul(BOT_PTS, -1), '{:.1f}')} puntos con {f_(BOT_N1)} y {f_(BOT_N0)} (± {f_(BOT_M, '{:.1f}')} con a ≈ 0.70): menos de 5,000, al reporte", "valor": f"± {f_(MOB_M, '{:.2f}')} (mobile) · ± {f_(ABR_M, '{:.2f}')} (abrigos)"},
            "decide": "El n mínimo de 5,000 en las dos semanas: con eso, 3 puntos quedan fuera del ruido. Con docenas de slices chicos, alguno «cae» 3 puntos cada semana por puro azar; sin n mínimo, la cola se llenaría de tickets que nadie puede explicar. Botines puede ser real: por eso va al reporte, donde alguien lo mira con calma.",
            "conceptos": ["ruido-tasa"],
            "comprueba": C("paso 8", "python mundo/tickets.py ver aceptacion-source=mobile", nota="La evidencia del ticket de mobile: n, la aceptación de las dos semanas, el cambio y su margen."),
        },
        {
            "id": "tamano-cola", "pregunta": "¿Cuántas fotos salen a etiquetar este mes, y cuánto cuestan?",
            "formula": "cola = por incertidumbre + al azar + 100 por cada slice decidido con «reentrenar» o «etiquetar» (un slice repetido da una sola tanda) · costo = fotos × precio por foto",
            "c01": {"cuenta": "≈ 5,000 fotos al mes; a 5–10 ¢ de dólar, ≈ US$250–500. Cada tanda extra de un slice, ≈ 500 fotos: ≈ US$25–50 y ≈ 5 días hábiles", "valor": "≈ 5,000 + 500 por tanda · ≈ US$275–550"},
            "taller": {"cuenta": f"300 por incertidumbre + 200 al azar + 100 × {len(EXTRA) or '?'} slice decidido ({', '.join(s for s, _ in EXTRA) or '?'}: el ticket del drift y el de abrigos piden el mismo) = {f_(COLA_N)} fotos, de {f_(CAND_N)} candidatas sin examen ni repetidas", "valor": f"{f_(COLA_N)} fotos en cola-{COLA_MES}"},
            "decide": "La mezcla: solo incertidumbre enseñaría las dudas del modelo pero nunca sus errores seguros; el azar los encuentra. Y la tanda extra va al slice que falla: sin labels nuevos de abrigos acolchados, el modelo nuevo no tiene de dónde aprender lo que cambió.",
            "conceptos": ["cola-etiquetado"],
            "comprueba": C("paso 9", "time python diario/muestras.py", nota="Lo que escribió muestras.py: cuántas por motivo."),
        },
    ],
}

# ---------------------------------------------------------------- conceptos
K = []


def concepto(id_, termino, en, def_, analogia, importa, trampa):
    if len(def_) > 220:
        sys.exit(f"✗ la definición de {id_} tiene {len(def_)} caracteres (máximo 220)")
    K.append({"id": id_, "termino": termino, "en": en, "def": def_, "analogia": analogia, "importa": importa, "trampa": trampa})


concepto("slo-presupuesto", "SLO y presupuesto de errores", "SLO / error budget",
         "La meta medible del servicio (99.9 % de las requests sin error del servidor en 30 días) y lo que sobra: el 0.1 % que sí puede fallar. Ese sobrante es un presupuesto, y se gasta.",
         "El plan de datos del celular: 30 GB al mes. No te preocupa gastar 2 GB un día; te preocupa a qué ritmo vas, porque si sigues así se acaba el día 15 y no hay recarga.",
         "En C01, el 0.1 % de ≈ 300 millones de requests al mes son 300,000 requests que pueden fallar, o 43.2 minutos de caída total. Con el presupuesto, una alerta deja de preguntar «¿hay errores?» (siempre hay) y pregunta «¿a este ritmo rompemos la promesa del mes?». Solo cuentan los 5xx, sobre las requests que no son 4xx: un 4xx es culpa de quien llama. El SLO vive en <code>mundo/plataforma.yaml</code>: lo decide plataforma, no tú.",
         "Alertar con un umbral fijo («más de 1 % de 5xx en 5 min»): despierta a alguien por 5 minutos que gastan ≈ 0.1 % del mes y deja pasar un 0.5 % sostenido toda una semana, que se come más que el mes entero (5 × 168 ÷ 720 ≈ 117 %).")
concepto("burn-rate", "Burn rate", "burn rate",
         "Qué tan rápido se gasta el presupuesto, comparado con el ritmo que lo acabaría justo al final de los 30 días: β = fracción con error ÷ (1 − SLO). A 1× dura el mes; a 14.4×, 50 horas.",
         "La aguja de la gasolina en carretera: no importa cuánta llevas gastada hoy, sino a qué velocidad baja, porque eso dice en qué kilómetro te quedas tirado.",
         "Los umbrales salen al revés: decides cuánto presupuesto toleras perder antes de avisar y despejas β = fracción del mes × 720 ÷ horas. Perder 2 % del mes en 1 h da 14.4× (page); 5 % en 6 h da 6× (ticket). Son los del libro de SRE de Google (<i>The Site Reliability Workbook</i>). Y se adapta solo: con 3 % de errores, la ventana de 1 h cruza 14.4× en ≈ 27 min; con 30 %, en ≈ 3.",
         "Olvidar el goteo: con solo 14.4× y 6×, un 0.5 % sostenido (5×) nunca suena, aunque en una semana gaste más que el mes. El libro de SRE agrega un tercer nivel, 1× en 3 días (ticket), justo para eso.")
concepto("multiventana", "Alerta multiventana", "multiwindow, multi-burn-rate alert",
         "Cada alerta de burn rate mira dos ventanas a la vez y suena solo si las dos pasan el umbral: 1 h y 5 min para el page; 6 h y 30 min para el ticket. La corta mide 1/12 de la larga.",
         "Dos termómetros para decidir si alguien tiene fiebre: uno que promedia todo el día (no se asusta por un rato de calor) y otro que mide ahora (baja en cuanto pasó). Llamas al médico solo si los dos marcan fiebre.",
         "La ventana larga confirma: un pico de 2 minutos no mueve el promedio de una hora. La corta apaga: después del arreglo, la de 1 h sigue cargando los errores de antes casi media hora, y la de 5 min vuelve a la normalidad en minutos. En el paso 2, sin la ventana corta, la prueba del 3 % sigue sonando a la 1 h 45 min, con el incidente ya arreglado.",
         "Usar solo la ventana larga (el page suena media hora con todo sano, y la guardia aprende a no creerle) o solo la corta (un minuto malo despierta a alguien).")
concepto("recording-rule", "Recording rule", "recording rule / level:metric:operation",
         "Una consulta que Prometheus hace en cada evaluación y guarda como una serie nueva con nombre (nivel:métrica:operación). Las alertas y los tableros leen ese nombre en lugar de recalcular.",
         "El corte de caja de cada hora: en lugar de que cada gerente sume todos los tickets del día cuando quiere saber cuánto se vendió, alguien anota el total cada hora en una hoja con nombre.",
         "La fracción de errores de 6 h suma muchísimas muestras y la alerta la necesita en cada evaluación: grabada en <code>classifier:error_ratio:rate6h</code>, se calcula una vez. Y ClassifierLowConfidenceSpike compara la fracción de ahora contra el promedio de 7 días de su propia regla grabada: promediar una muestra por evaluación es barato; promediar 7 días de buckets crudos en cada evaluación, no.",
         "Creer que una regla recién cargada tiene historia: solo tiene muestras desde que se cargó, y su «promedio de 7 días» es el de unos minutos. Por eso existe el relleno (paso 3).")
concepto("vacio-nan", "Vacío, 0 y NaN", "empty result / or vector(0) / NaN",
         "En PromQL una suma sin series no da 0: da vacío, y una división con un lado vacío da vacío. Y 0 ÷ 0 da NaN («no es un número»), que contagia cualquier promedio en el que entra.",
         "Una casilla del formulario que nadie llenó no es una casilla con un cero: al sumar la columna, la vacía no aporta. Y si alguien escribió «error» en una, la suma entera sale «error».",
         "Sin ningún 5xx en la ventana, la serie de los 5xx no existe y la fracción de errores desaparece: el tablero muestra un hueco, no un 0, y verificar.py lo reprueba. Por eso el <code>or vector(0)</code> del numerador. En la baja confianza pasa lo contrario: si un rato no hay tráfico, 0 ÷ 0 grabaría NaN y el promedio de 7 días saldría NaN toda una semana. El <code>&gt; 0</code> del denominador hace que ese rato no guarde muestra.",
         "Poner el <code>or vector(0)</code> también en el denominador (sin tráfico, 0 ÷ 0) o creer que una alerta sobre una serie vacía «no suena porque todo está bien»: no suena porque no evalúa nada.")
concepto("severidades", "Page, warning, ticket y runbook", "alert severity / on-call / runbook",
         "Cada alerta dice a quién le llega: page (a la guardia, ahora, de día o de noche), warning (al canal del equipo, en horario) o ticket (a la cola, trabajo de la semana). Y trae su runbook: qué revisar.",
         "En un hospital: un paro cardiaco activa el código azul ya; la fiebre alta se le avisa a la enfermera de turno; un análisis de rutina fuera de rango va al expediente, para la próxima cita.",
         "La prueba de un page: el usuario está afectado ahora y alguien puede arreglarlo ahora. La calidad del modelo nunca es page: nadie arregla un PSI a las 3 de la mañana y, a la tercera vez, la guardia deja de creerle a su teléfono. En el dojo cada alerta lleva su <code>severity</code> y, salvo el Watchdog, su <code>runbook_url</code>; las dos del presupuesto llevan además <code>slo: disponibilidad</code>, que usa la inhibición.",
         "Mandar todo a page «por si acaso» (la fatiga de alertas) o una alerta sin runbook: quien la recibe medio dormido no sabe qué hacer con ella.")
concepto("promtool-test", "promtool test rules", "rule unit tests / input_series / alert_rule_test",
         "Pruebas de tus reglas con series inventadas: describes cómo crecen los contadores paso a paso y cuándo debe sonar (o no) cada alerta. promtool simula horas y días en segundos.",
         "El simulador de vuelo: no esperas una tormenta de verdad para saber si el piloto reacciona bien; la fabricas, la corres en minutos y la repites cuantas veces quieras.",
         "Una alerta de 6 h o de 7 días no se prueba esperando. <code>input_series</code> describe la serie (<code>0+999x60</code>: empieza en 0 y sube 999 por paso, 60 pasos) y <code>alert_rule_test</code> dice qué alertas esperas en cada <code>eval_time</code>, con sus etiquetas y anotaciones. Así pruebas el incidente del 3 %, el goteo que no debe sonar, el poco tráfico y la hora sin tráfico. verificar.py corre además sus propias pruebas, que no ves.",
         "Probar solo que suena: las pruebas que valen son las de «no suena» (un pico de 4xx, el goteo de 0.5 %, el poco tráfico). Y olvidar que promtool compara también las anotaciones: cambiar el texto del summary rompe la prueba.")
concepto("relleno-retencion", "Relleno de reglas y retención", "backfilling recording rules / retention",
         "promtool tsdb create-blocks-from rules calcula una recording rule hacia atrás, sobre la historia que ya tiene Prometheus. La retención dice cuántos días guarda Prometheus antes de borrar.",
         "Llegas a un trabajo nuevo y te piden el promedio de ventas de la semana: no esperas 7 días; sacas los tickets de la semana pasada del archivo y haces la cuenta. Pero si el archivo solo guarda 2 días, la cuenta sale con lo que hay.",
         "Sin relleno, ClassifierLowConfidenceSpike compararía contra el promedio de unos minutos. El relleno evalúa la regla minuto a minuto sobre los días que Prometheus ya tenía y deja bloques que Prometheus toma en ≈ 1 min. No se rellena lo que Prometheus está escribiendo ahora (la documentación pide no tocar las últimas ≈ 3 h), ni dos veces la misma ventana. Y la retención tiene que cubrir la ventana más larga de cualquier alerta: 7 días la de baja confianza; C01 guarda 15.",
         "Bajar la retención para ahorrar disco: la alerta sigue «funcionando», pero compara contra 2 días y deja de ver un cambio que ya es lo normal. Nada truena (la falla «El disco más barato»).")
concepto("baja-confianza", "Baja confianza: un proxy sin labels", "low-confidence rate / proxy metric",
         "La fracción de fotos cuyo top-1 queda debajo de 0.3, en 30 minutos. No dice si el modelo acertó; dice que duda más que de costumbre. Llega en minutos, sin esperar ningún label.",
         "El termómetro antes del análisis de laboratorio: no te dice qué tienes, pero si marca 39° ya sabes que algo pasa, y no esperas tres días al resultado para ir a revisar.",
         "Sale del histograma <code>classifier_top1_score</code>: lo que creció el bucket <code>le=\"0.3\"</code> entre lo que creció el <code>_count</code>. Se compara contra su propio promedio de 7 días, no contra un número fijo, porque la base se mueve con la temporada (C01, ≈ 4 %; el dojo, 8.7 %). Ticket si pasa del doble durante 30 min y hay más de 1 foto/s: con un puñado de fotos, una fracción no significa nada.",
         "Confianza no es exactitud: un modelo seguro y equivocado casi no mueve la baja confianza (con el modelo del dojo, invertir los canales RGB → BGR cambia el top-1 en 74 % de las fotos y deja las dudosas en 1.18×). Por eso no va sola: el PSI y la aceptación ven lo que esta no ve. Y que la fracción caiga de golpe también es mala señal: un modelo seguro de todo (la falla «El decoder rápido»).")
concepto("alertmanager", "Alertmanager: rutas, grupos e inhibición", "routing tree / group_by / group_wait / repeat_interval / inhibit_rules",
         "El programa que recibe las alertas de Prometheus y decide quién se entera y cómo: las rutea por etiquetas, junta las de un incidente, calla las que repiten otra y vuelve a avisar de lo que sigue sonando.",
         "El conmutador de un hospital: no le pasa cada llamada a todos. La urgencia va al médico de guardia y lo administrativo a la oficina; junta las 20 llamadas del mismo accidente en un aviso y no te vuelve a llamar por lo mismo cada minuto.",
         "El árbol de rutas se recorre en orden: el Watchdog primero (a su receptor), luego page → guardia, warning → canal, ticket → tickets, y lo que no cae en ninguna ruta va a la cola, nunca al teléfono. <code>group_wait</code> espera a juntar (10 s un page, 1 min un ticket); <code>repeat_interval</code> repite lo que sigue sonando (1 h el page, 24 h el ticket). La inhibición: si suena el page de un SLO, el ticket lento del mismo SLO (<code>equal: [slo]</code>) es el mismo incidente y se calla. Las URL de cada integración son secretos de plataforma: se leen con <code>url_file</code>.",
         "Una ruta por omisión que manda a la guardia (cualquier alerta nueva de cualquier equipo te despierta) o una inhibición sin <code>equal</code>: un page de cualquier cosa callaría todos los tickets.")
concepto("watchdog", "Watchdog: el latido", "Watchdog / dead man's switch / heartbeat",
         "Una alerta que siempre suena (vector(1)). Fuera del sistema, un servicio espera su aviso cada pocos minutos; si deja de llegar, avisa él: el camino de las alertas se rompió.",
         "El vigilante nocturno que tiene que marcar en el reloj de cada piso cada hora: si una hora no marca, la central no espera a que él llame; manda a alguien a ver qué pasó.",
         "Todas las demás alertas fallan en silencio si Prometheus no le puede entregar a Alertmanager, o Alertmanager a nadie: el tablero se ve normal y no llega nada. El latido es lo único que debería llegar siempre. En el dojo, el buscapersonas espera uno cada ≤ 150 s; en C01, un dead man's switch fuera del clúster (en PagerDuty o un servicio como Healthchecks.io): si viviera adentro, se caería con lo que vigila.",
         "Silenciar el Watchdog porque «siempre está sonando», mandarlo a la guardia o poner al que espera el latido dentro del mismo clúster que vigila.")
concepto("pushgateway-frescura", "Pushgateway y la frescura del job", "Pushgateway / push_time_seconds / staleness alert",
         "Un job que corre y termina no se puede leer cada 5 s: al terminar empuja sus números a la Pushgateway, que se queda prendida, y Prometheus la lee de ahí. Nunca olvida el último valor.",
         "El buzón de una oficina: el cartero (el job) pasa una vez al día y deja la carta; quien revisa (Prometheus) la lee cuando quiere. Si un día el cartero no viene, en el buzón sigue la carta de ayer, y parece nueva.",
         "Por eso se vigila la frescura: la Pushgateway agrega sola <code>push_time_seconds</code>, la hora del último envío, y MonitoringJobStale abre un ticket si pasa de 26 h (un día, más un margen para que una corrida lenta no avise). Sin esa alerta, un job roto deja el PSI y la aceptación congelados en el tablero, perfectos. Con <code>honor_labels: true</code>, Prometheus respeta el <code>job=\"monitoreo-diario\"</code> de quien empujó.",
         "Usar la Pushgateway para algo que vive (sus métricas se quedarían aunque muera) o confiar en un número publicado sin mirar cuándo se publicó (la falla «La cuenta de solo lectura»).")
concepto("psi", "PSI y su referencia", "Population Stability Index / drift reference",
         "Cuánto se movió una distribución: por cada bin, (p − q) × ln(p ÷ q), y se suman. Aquí, la mezcla de categorías predichas del día contra la de los 28 días anteriores juntos.",
         "Comparar la lista del súper de esta semana con la de las últimas cuatro: si de pronto la mitad son abrigos, algo cambió en tu casa (llegó el frío), aunque todavía no sepas si compraste bien.",
         "La lectura de costumbre: menos de 0.1, estable; de 0.1 a 0.25, un cambio moderado; más de 0.25, uno grande. C01 pone el umbral en 0.2 y pide 3 días seguidos: un festivo o una campaña no bastan. <code>psi_por_categoria</code> dice qué bin lo movió. La referencia decide qué ves: contra las 4 semanas previas ves los cambios de golpe, pero uno lento se esconde (cada semana se parece a la anterior); por eso C01 también compara cada mes contra los datos con que se entrenó el modelo.",
         "Leer drift como «el modelo empeoró»: un PSI alto dice que el modelo ve otra mezcla, no que se equivoque más. Lo deciden los labels. Y un bin con 0 fotos: ln(0) no existe; se cuenta como 0.0001.")
concepto("aceptacion-holdout", "Aceptación, feedback loop y holdout", "acceptance rate / feedback loop / holdout",
         "Aceptación: de las publicaciones que mostraron las sugerencias, cuántas eligieron una. Holdout: ≈ 1 % de vendedores que nunca ve sugerencias; ahí se mide la exactitud sin la huella del modelo.",
         "Preguntarle al mesero si el platillo del día está bueno: casi todos lo piden porque él lo recomienda. Para saber si de verdad gusta, miras las mesas que no oyeron la recomendación.",
         "La aceptación es el label más rápido (minutos), pero está sesgada: quien vende tiende a aceptar lo que le pusieron enfrente (el feedback loop). Se mide con los eventos del backend unidos al log por <code>request_id</code>, porque el gateway no sabe si la pantalla pintó la sugerencia. C01 abre un ticket si cae más de 3 puntos semana contra semana. El holdout es la medida limpia, pero chica y lenta.",
         "Reentrenar con lo que eligió quien vende esa semana: entrenas con elecciones que el modelo mismo empujó. Los labels que corrigen un drift salen de la cola humana, de moderación o del holdout.")
concepto("ruido-tasa", "El ruido de una tasa y el n mínimo", "margin of error / minimum sample size",
         "Una tasa medida con n casos se mueve por azar ± 1.96 × √(a(1 − a) ÷ n), al 95 %. Con n chico, ese ruido es más grande que el cambio que buscas: por eso cada slice pide un n mínimo.",
         "Lanzar una moneda 10 veces y sacar 7 águilas no prueba que esté cargada; 7,000 de 10,000, sí. La moneda no cambió: cambió cuántas veces la lanzaste.",
         "Con a ≈ 70 % y n = 5,000, el margen es ± 1.3 puntos; al comparar dos semanas, √2 veces más: ± 1.8. Una caída de 3 puntos queda fuera del ruido. Con 500 serían ± 4: más que lo que buscas. Por eso C01 y el dojo piden n ≥ 5,000 en las dos semanas; abajo de eso, el slice va al reporte, no a un ticket.",
         "Mirar docenas de slices chicos cada semana sin n mínimo: por puro azar alguno «cae» 3 puntos, y la cola se llena de tickets que nadie puede explicar.")
concepto("ticket-por-causa", "Un ticket por causa", "one ticket per cause / episode / deduplication",
         "Un problema abre un ticket, no uno por cada síntoma: si cae la aceptación de mobile, las categorías que caen con ella van al reporte como «arrastradas», y el episodio tiene un solo id.",
         "Cuando se va la luz en un edificio, el administrador recibe un reporte de «no hay luz», no 40 de «no enfría el refrigerador», «no sirve el elevador» y «no hay internet».",
         "mobile es más de la mitad de cada categoría: si mobile cae 4 puntos, cada categoría cae ≈ 2.4 y, con el ruido, alguna pasa de 3. Un ticket por cada una mandaría a cinco personas a investigar lo mismo. El id es la regla, el slice y el día en que empezó el episodio: correr el disparador todos los días no duplica (el buscapersonas contesta 409). Es la misma idea que la inhibición de Alertmanager.",
         "Un id con la fecha de hoy: cada día de la racha abre un ticket nuevo del mismo episodio. O callar las arrastradas del todo: van al reporte, por si resultan ser otra causa.")
concepto("diagnosticar", "Diagnosticar antes de reentrenar", "root cause before retraining / training-serving skew",
         "Antes de tocar el modelo se descarta, en orden: un deploy propio, un cambio de quien llama (un solo source, una app nueva) y el training-serving skew. Solo si cambió el mundo, y los labels lo confirman, se reentrena.",
         "El mecánico no cambia el motor porque el auto jala raro: primero pregunta si le pusieron otra gasolina, revisa las llantas y mira qué se tocó en el último servicio.",
         "Reentrenar sobre un bug le enseña el bug al modelo. Cada causa tiene su acción: un deploy cerca → rollback; un solo source movido → avisar a su dueño; PSI alto con la aceptación del mismo slice cayendo → tanda extra y reentrenar; PSI alto sin labels peores → etiquetar. Y un disparador abre un ticket, no un despliegue: una persona decide, y el modelo nuevo sube la misma escalera (gate, paridad, shadow, canary y bake).",
         "Que el disparador reentrene solo, o que la corrida adelantada se salte el gate «porque es urgente». En el dojo, el orquestador se niega sin un ticket decidido con «reentrenar».")
concepto("cola-etiquetado", "La cola de etiquetado", "labeling queue / uncertainty sampling / random sample",
         "Las fotos que se mandan a etiquetar cada mes: unas por incertidumbre (las de score más bajo), otras al azar, y una tanda extra por cada slice que una persona decidió reentrenar o etiquetar.",
         "Repasar para un examen: estudias más los temas en que dudas, pero también haces preguntas al azar, porque si solo repasas lo que sabes que no sabes, nunca descubres lo que crees saber y no.",
         "Es lo que esta estación le entrega a la estación 1: así se cierra el ciclo. Las fotos dudosas que cuenta la baja confianza son las mismas que la cola elige por incertidumbre. Se quitan las del examen fijo (si se etiquetan y entran al entrenamiento, el examen deja de medir) y las repetidas, y sale en el formato de importación de Label Studio. En C01, ≈ 5,000 fotos al mes y ≈ 500 por tanda extra.",
         "Solo incertidumbre (el modelo nunca ve sus errores seguros) o escribir la ruta del examen en tu código: si el equipo de datos la cambia, tu cola no se entera (la falla «El examen crece»).")
e["conceptos"] = K

# ---------------------------------------------------------------- el mundo
e["mundo"] = {
    "resumen": "El kit trae la release 15 de C01 atendiendo en chico y con su historia: el S3 local (RustFS) con 60 días de logs en Parquet y de eventos del backend, Prometheus v3.15.1 que nace con 8 días de métricas, Alertmanager, la Pushgateway, Triton, los dos pods del gateway con el rastro de la estación 11, un buscapersonas que hace de PagerDuty, Slack, la cola de tickets y el dead man's switch, el job programado, el orquestador y el tráfico de siempre. Lo tuyo: las reglas y sus pruebas, Alertmanager, el job diario, el disparador y la cola de etiquetado.",
    "trae": [
        {"que": "mundo/crear.py y compose.yaml", "detalle": f"Levanta todo en ≈ {f_(CREAR_S)} s (la primera vez ≈ 2 min, porque baja las imágenes): RustFS 1.0.4 (<code>localhost:9960</code>, consola en 9961), Prometheus (<code>localhost:9962</code>), Alertmanager v0.34.2 (<code>localhost:9963</code>) y la Pushgateway v1.11.5 (<code>localhost:9964</code>). Deja en S3 la historia ({f_(HIST_REQ)} requests en <code>logs/predicciones/</code>, {f_(HIST_EV)} eventos del backend, el examen fijo de {f_(GOLDEN_N)} fotos y el historial de despliegues) y le da a Prometheus 8 días de métricas como si llevara una semana leyendo. Vuelve la carpeta un repositorio de git: los cambios de otros equipos llegan como commits."},
        {"que": "mundo/historia.py", "detalle": "Lo que pasó antes de hoy, con fechas contadas desde hoy (D-1 es ayer): la release 15 entró el D-25; la app mobile 5.2.0 salió el D-16 y llegó al 95 % de quien vende; desde el D-6 llegan botines de lluvia y desde el D-5 el frío, con chamarras acolchadas que el modelo casi no vio; una campaña de sandalias el D-20, dos días de vestidos el D-9 y el D-8, y un corte de red de 45 min el D-3. Todo sale de semillas fijas."},
        {"que": "mundo/servicios.py y mundo/carga.py", "detalle": "Arranca, para y reinicia Triton (<code>localhost:8965</code>), los dos pods del gateway (<code>localhost:8961</code> y <code>8962</code>), el buscapersonas y el tráfico de siempre (5 fotos/s de los tres callers). <code>reiniciar triton --falla 30</code> deja un Triton que truena en el 30 % de las inferencias. Cómo procesa la foto cada app sale de <code>mundo/callers.json</code>, que se relee cada 5 s."},
        {"que": "mundo/capas.py", "detalle": "Las cinco capas en vivo (lo que en C01 son los tableros de Grafana): infraestructura, servicio (5xx y su burn rate, p99), datos (bytes por source), modelo (fotos dudosas y PSI de las categorías) y negocio (la aceptación de ayer, de tu job). Compara los últimos 3 minutos con los últimos 7 días."},
        {"que": "mundo/promtool.py y mundo/recargar.py", "detalle": "promtool, que viene en la imagen de Prometheus: <code>revisar</code> (check rules), <code>prueba</code> (test rules) y <code>rellenar</code> (la historia de tus recording rules, con los comandos de la documentación). <code>recargar.py prometheus|alertmanager</code> revisa tu archivo, espera a que el contenedor lo vea completo y recarga."},
        {"que": "mundo/buscapersonas.py y mundo/tickets.py", "detalle": "El buscapersonas (<code>localhost:8966</code>) recibe los webhooks de Alertmanager en guardia, canal, tickets y latido, abre los tickets de tu disparador (409 si el id ya existe) y avisa si el latido no llega en 150 s. <code>tickets.py</code> lista, muestra y decide tickets, y enseña los avisos."},
        {"que": "mundo/cron.py y mundo/orquestador.py", "detalle": "El job programado <code>monitoreo-diario</code> (en C01, un CronWorkflow de Argo a las 01:00 UTC): corre tus dos pasos sobre ayer con la cuenta del job. El orquestador anota una corrida adelantada de <code>reentreno-mensual</code> (no entrena), y solo por un ticket decidido con «reentrenar»."},
        {"que": "mundo/plataforma.yaml, mundo/prometheus/ y mundo/alertmanager/", "detalle": "Lo de plataforma: el SLO, el job y su cuenta de S3, la ruta del examen, el dueño de cada source, qué lee Prometheus y a qué Alertmanager avisa, y las URL de cada integración (<code>url_file</code>). Cambia solo con un commit."},
        {"que": "gateway/, gateway.yaml, servir/ y model_repository/", "detalle": "La release 15 con el rastro de la estación 11: el contador, la latencia, el histograma del score top-1 y la línea de log."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks contra lo que corre (con pruebas de promtool que no ves) y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "observabilidad/reglas.yml", "hace": "5 recording rules (la fracción de errores en 4 ventanas y la de fotos dudosas) y 5 alertas: el burn rate rápido y el lento, la baja confianza, MonitoringJobStale y el Watchdog."},
        {"archivo": "observabilidad/pruebas.yml", "hace": "Las pruebas de promtool de tus reglas: lo que debe sonar y, sobre todo, lo que no."},
        {"archivo": "observabilidad/alertmanager.yml", "hace": "Las rutas por severidad, los tiempos de cada una, la inhibición page → ticket por SLO y los 4 receptores."},
        {"archivo": "diario/monitoreo.py", "hace": "El job diario: del Parquet de un día a su resumen (PSI, baja confianza, bytes, aceptación por slice, holdout) en S3 y a la Pushgateway."},
        {"archivo": "diario/disparador.py", "hace": "De los resúmenes a tickets con diagnóstico: drift (PSI > 0.2 tres días) y aceptación (−3 puntos semana contra semana, n ≥ 5,000), uno por causa."},
        {"archivo": "diario/muestras.py", "hace": "La cola de etiquetado del mes siguiente: incertidumbre, azar y las tandas extra que pidió una persona, sin examen ni repetidas."},
    ],
    "requisitos": [
        "Docker Desktop con al menos 4 GiB libres",
        "Python 3.11 o más nuevo, con el venv del kit: <code>python3 -m venv .venv && .venv/bin/pip install -r requirements.txt</code> y <code>source .venv/bin/activate</code>",
        "git e Internet la primera vez (las imágenes de RustFS, Prometheus, Alertmanager y la Pushgateway)",
        "Los puertos 8961–8966 y 9960–9964 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "kube-prometheus-stack en EKS, con tus reglas como PrometheusRule y el Alertmanager con dos réplicas", "local": "Prometheus, Alertmanager y la Pushgateway como contenedores de compose; tus reglas en <code>observabilidad/reglas.yml</code>", "diferencia": "Los mismos programas y el mismo formato de reglas; el operador que las carga es <code>mundo/recargar.py</code>, y Alertmanager es una sola réplica."},
        {"nube": "Los pods del gateway y Triton en Kubernetes", "local": "procesos de tu Mac (<code>mundo/servicios.py</code>)", "diferencia": "Prometheus los lee con <code>static_configs</code> y las mismas etiquetas que dejó la estación 11."},
        {"nube": "PagerDuty, Slack, la cola de Jira y un dead man's switch fuera del clúster", "local": "<code>mundo/buscapersonas.py</code>", "diferencia": "Recibe el mismo webhook de Alertmanager (versión 4) y anota todo en <code>logs/avisos.jsonl</code>."},
        {"nube": "El CronWorkflow <code>monitoreo-diario</code> de Argo a las 01:00 UTC, y <code>argo submit --from cronwf/reentreno-mensual</code>", "local": "<code>mundo/cron.py</code> y <code>mundo/orquestador.py</code>", "diferencia": "El job corre cuando tú lo pides; el orquestador anota la corrida y dice lo que pasaría, sin entrenar."},
        {"nube": "Prometheus lee cada 15 s y evalúa cada 1 min", "local": "lee cada 5 s y evalúa cada 15 s", "diferencia": "Las ventanas y los umbrales de tus reglas son los de C01: el reloj es el de verdad, y <code>promtool test rules</code> simula los días."},
        {"nube": "Meses de historia real", "local": "60 días en S3 y 8 días en Prometheus que nacen hechos, con fechas contadas desde hoy", "diferencia": "«Ayer» es el del mundo: si pasa la medianoche UTC mientras trabajas, el mundo no se mueve."},
        {"nube": "≈ 116 requests por segundo y ≈ 10 millones al día", "local": "5 fotos por segundo en vivo; un día de la historia ≈ 20,000", "diferencia": "Con días de ≈ 13,000 publicaciones, un slice semanal llega al n mínimo de 5,000 igual que en C01."},
        {"nube": "500 categorías, con el PSI sobre ≈ 30 categorías padre", "local": "10 categorías", "diferencia": "La cuenta del PSI es la misma, con 10 bins."},
        {"nube": "Amazon S3, con un rol de IAM de solo lectura para el job", "local": "RustFS 1.0.4 en <code>localhost:9960</code>", "diferencia": "La misma API y las mismas rutas; la cuenta del job es una llave del S3 local, en <code>mundo/plataforma.yaml</code>."},
        {"nube": "12 alertas en C01: el p99, TritonNotReady, ALB5xx, la fila de Triton, la GPU, LogsStale y las de esta estación", "local": "las 5 de esta estación", "diferencia": "Las del servicio y del camino del log se escribieron en la estación 11; aquí van las del presupuesto, el modelo y quien vigila."},
        {"nube": "La fracción normal de fotos dudosas, ≈ 4 %", "local": f"{f_(mul(AVG7, 100), '{:.1f}')} % en el dojo", "diferencia": "Las 10 categorías del dojo y sus fotos dudan más; la regla compara contra su propio promedio, así que funciona igual."},
    ],
    "arranque": "unzip c01-monitoreo.zip && cd c01-monitoreo\npython3 -m venv .venv && .venv/bin/pip install -r requirements.txt\nsource .venv/bin/activate\npython mundo/crear.py\npython verificar.py mundo",
    "python": "python",
}

# ---------------------------------------------------------------- el Guiado
G = []
_vm0 = O("paso 0", "python verificar.py mundo")
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 con 60 días de historia, Prometheus con 8 días de métricas, Alertmanager, la Pushgateway, Triton, los dos pods del gateway, el buscapersonas y el tráfico de siempre, arriba.",
    conceptos=["slo-presupuesto"],
    explica="<code>mundo/crear.py</code> levanta <code>compose.yaml</code> (el S3 local, Prometheus, Alertmanager y la Pushgateway), deja en S3 los 60 días de historia y le da a Prometheus 8 días de métricas del gateway, como si llevara una semana leyendo. Después arranca con <code>mundo/servicios.py</code> lo que corre en tu Mac: Triton, los dos pods del gateway, el buscapersonas y el tráfico de siempre. También vuelve la carpeta un repositorio de git: los cambios de otros equipos llegan como commits.",
    codigo=[],
    comandos=[
        C("paso 0", "time python mundo/crear.py", nota="Se puede correr otra vez: deja el mundo como al principio, salvo tus archivos (la historia, los tickets y los resúmenes nacen otra vez)."),
        C("paso 0", "python verificar.py mundo", nota=("Prometheus acababa de arrancar y todavía no tenía todos sus objetivos: espera unos segundos y vuelve a correrlo." if not ok_check(_vm0, "mundo") else "Los 4 contenedores, los 5 procesos, los 7 objetivos de Prometheus, sus 8 días de métricas y los 60 días de logs.")),
        C("paso 0", "python mundo/servicios.py estado", nota="Los procesos de tu Mac y los contenedores."),
        C("paso 0", "python mundo/capas.py", nota="Las cinco capas, de la más rápida a la más lenta, 3 min después de levantar: los últimos 3 minutos contra los últimos 7 días. Negocio sale del resumen de tu job diario: todavía no hay."),
        C("paso 0", "q 'sum(rate(classifier_requests_total[1h]))'", nota="Las requests por segundo de la última hora, con la función q del paso 1."),
        C("paso 0", "q 'count_over_time(classifier_top1_score_count[8d])'", nota="Las lecturas de cada pod en 8 días: la historia con que nace Prometheus, una cada minuto."),
        C("paso 0", V, exacto=True, nota=f"Al empezar, {f_(VERDE0)} de 12 en verde ({', '.join(VERDES0) or 'ninguno'}): lo que es del mundo. Lo demás es tu trabajo."),
    ],
    verifica="<code>python verificar.py mundo</code> en verde: los 4 contenedores y los 5 procesos arriba, los 7 objetivos en Prometheus, 8 días de métricas y 60 días de logs en S3.",
    ojo="La primera vez, <code>crear.py</code> baja las imágenes (≈ 2 min). Para <code>docker compose</code> en esta carpeta, primero <code>export DOCKER_CONFIG=$PWD/.docker</code> (lo crea crear.py, sin el llavero de macOS). Si un puerto del 8961 al 8966 o del 9960 al 9964 está ocupado, apaga lo que lo usa. <code>python mundo/servicios.py parar</code> y <code>docker compose stop</code> liberan tu Mac; <code>crear.py</code> lo regresa todo. «Ayer» es el del mundo: las fechas de esta página salen de la corrida que las midió, y en tu mundo son otras."))

_q1 = O("paso 1", "q 'classifier:error_ratio:rate5m'")
_v1 = O("paso 1", "python verificar.py reglas burn-rate")
G.append(dict(n=1, id="presupuesto", titulo="El presupuesto y el burn rate", objetivo="Las 4 recording rules de la fracción de errores (5 min, 30 min, 1 h y 6 h) y las dos alertas de burn rate: un page si el presupuesto se gasta a más de 14.4× en 1 h y en 5 min, y un ticket si va a más de 6× en 6 h y en 30 min.",
    conceptos=["slo-presupuesto", "burn-rate", "recording-rule", "vacio-nan", "severidades"],
    explica="Primero, dos funciones de terminal para preguntarle cosas a Prometheus: <code>q '…'</code> hace una consulta y <code>alertas</code> dice qué alertas están sonando. Después escribe el grupo <code>classifier-slo</code> de <code>observabilidad/reglas.yml</code>. Cuatro recording rules guardan la fracción de errores del servidor (5xx entre las requests que no son 4xx) en 5 min, 30 min, 1 h y 6 h: el nombre dice nivel, métrica y ventana. Dos alertas las usan: <code>ClassifierErrorBudgetFastBurn</code> (page) si la de 1 h <b>y</b> la de 5 min pasan de <code>14.4 * 0.001</code>, y <code>ClassifierErrorBudgetSlowBurn</code> (ticket) si la de 6 h y la de 30 min pasan de <code>6 * 0.001</code>. El 0.001 es el presupuesto: 1 − 0.999. No llevan <code>for</code>: la ventana larga ya es la espera. Las dos llevan <code>severity</code>, <code>slo: disponibilidad</code> (la inhibición del paso 4 las junta por esa etiqueta), un <code>summary</code> y un <code>runbook_url</code>. Revisa con promtool, recarga Prometheus y mira el burn rate de hoy.",
    codigo=[{"lang": "bash", "path": "terminal (las funciones q y alertas: pégalas una vez en cada terminal, con el venv activo)", "code": Q_FUNC + "\n" + ALERTAS_FUNC, "nota": "q imprime una línea por serie (sus etiquetas, sin instance, y su valor), o «(vacío)» si la consulta no da nada. alertas imprime nombre, severidad, estado y desde cuándo."},
            {"lang": "yaml", "path": "observabilidad/reglas.yml", "code": REGLAS1, "nota": "<code>or vector(0)</code> en el numerador: sin ningún 5xx, la suma no tendría series y la división daría vacío, no 0. Los 4xx no cuentan ni arriba ni abajo: <code>code!~\"4..\"</code> en el denominador."}],
    comandos=[
        C("paso 1", "python mundo/promtool.py revisar", nota="promtool check rules, dentro del contenedor de Prometheus: que el archivo sea válido antes de cargarlo."),
        C("paso 1", "python mundo/recargar.py prometheus", nota="Revisa, espera a que el contenedor vea tu archivo completo y le pide a Prometheus que lo vuelva a leer."),
        C("paso 1", "q 'classifier:error_ratio:rate5m'", nota="≈ 20 s después. Sin ningún 5xx en 5 min, la suma de los 5xx no tiene series y la división daría vacío; con el <code>or vector(0)</code> del numerador, da 0." + (" Aquí salió vacía: una regla tiene valor desde su primera evaluación (cada 15 s); vuelve a preguntar en unos segundos." if "(vacío)" in _q1 else "")),
        C("paso 1", "q 'classifier:error_ratio:rate1h / 0.001'", exacto=True, nota=f"El burn rate de la última hora: {f_(BETA1, '{:.2f}')}×. Debajo de 1×, el presupuesto alcanza para el mes."),
        C("paso 1", "alertas", exacto=True, nota="Ninguna suena." if "(ninguna)" in O("paso 1", "alertas", exacto=True) else ""),
        C("paso 1", "python verificar.py reglas burn-rate", nota=("reglas todavía no pasa: le falta la regla de la baja confianza (paso 3). " if not ok_check(_v1, "reglas") else "") + "burn-rate corre pruebas de promtool que no ves: el incidente del 3 %, 0.7 % durante 7 h, el goteo de 0.5 %, un pico de 4xx y la fracción sin 5xx."),
    ],
    verifica=f"<code>python verificar.py burn-rate</code> en verde: el 3 % suena entre el minuto 27 y el 28 y se apaga ≈ 2 min después del arreglo, 0.7 % abre ticket, 0.5 % no hace nada y sin 5xx la fracción vale 0. En vivo, {f_(BETA1, '{:.2f}')}× en 1 h.",
    ojo="Los 4xx fuera de las dos partes de la división: si cuentan abajo, un caller que manda basura baja tu tasa de errores; si cuentan arriba, te despierta por su culpa. Las dos ventanas van con <code>and</code>, no con <code>or</code>: con <code>or</code>, un minuto malo en la de 5 min despertaría a alguien. Y no le pongas <code>for</code> al page: la ventana de 1 h ya tarda en llenarse, y un <code>for</code> encima solo retrasa el aviso."))

_p2 = O("paso 2", "python mundo/promtool.py prueba", exacto=True)
G.append(dict(n=2, id="pruebas", titulo="Probar sin esperar", objetivo="Pruebas de promtool para las dos alertas del presupuesto: el incidente del 3 % suena entre el minuto 27 y el 28 y se apaga ≈ 2 min después del arreglo, el 0.7 % de 7 h abre ticket y el goteo de 0.5 % no despierta a nadie.",
    conceptos=["promtool-test", "multiventana", "burn-rate"],
    explica="Una alerta de 6 h no se prueba esperando 6 h. <code>observabilidad/pruebas.yml</code> describe series inventadas y lo que esperas en cada momento. <code>interval: 1m</code> dice cada cuánto avanza cada serie; <code>'0+999x60 59940+970x40 98740+999x100'</code> es un contador que sube 999 por minuto durante 60 minutos, luego 970 durante 40 (el incidente) y otra vez 999: con el de 503, 0.1 % de errores de fondo y 3 % del minuto 60 al 99. Cada <code>alert_rule_test</code> dice qué alertas esperas en un <code>eval_time</code>, con sus etiquetas y anotaciones; una lista vacía, <code>exp_alerts: []</code>, es «aquí no debe sonar». Prueba también lo que no debe sonar: el goteo de 0.5 % y los 415 que no cuentan. Después, la prueba de la prueba: quitas la ventana corta del page y miras qué pasa.",
    codigo=[{"lang": "yaml", "path": "observabilidad/pruebas.yml", "code": PRUEBAS2, "nota": "<code>evaluation_interval: 2m</code>: las pruebas de la baja confianza (paso 4) cargan 7 días de su regla grabada; evaluando cada minuto serían 10,080 muestras, más que las 10,000 que promtool test deja cargar en una consulta."},
            {"lang": "bash", "path": "terminal (la prueba sin la ventana corta del page, y de regreso)", "code": SIN_CORTA, "nota": "sed borra la línea de la ventana de 5 min; al final regresa tu archivo."}],
    comandos=[
        C("paso 2", "time python mundo/promtool.py prueba", nota=f"promtool test rules: simuló las ≈ 7 h de las pruebas en {f_(T_PRUEBA2, '{:.1f}')} s."),
        C("paso 2", "python mundo/promtool.py prueba", exacto=True, nota=f"Sin la ventana corta: a la {SIN_CORTA_T} el incidente ya terminó, pero la ventana de 1 h sigue cargando sus errores y el page sigue sonando." if SIN_CORTA_T != "?" else "Sin la ventana corta, la prueba falla."),
        C("paso 2", "python verificar.py burn-rate", nota="De regreso con la ventana corta."),
    ],
    verifica="<code>python mundo/promtool.py prueba</code> dice SUCCESS, y sin la ventana corta falla porque el page sigue sonando después del arreglo.",
    ojo="promtool compara las etiquetas <b>y</b> las anotaciones de cada alerta esperada: si cambias el texto de un <code>summary</code>, cambia también la prueba. Una prueba que solo dice «suena» no prueba casi nada: las que te salvan son las de «no suena». Y <code>eval_time</code> cuenta desde el inicio de las series, no desde el inicio del incidente: el minuto 88 de la prueba es el minuto 28 del incidente."))

G.append(dict(n=3, id="baja-confianza", titulo="La baja confianza", objetivo="La recording rule de la fracción de fotos dudosas en 30 min y ClassifierLowConfidenceSpike, que abre ticket si pasa del doble de su promedio de 7 días; y la historia de esa regla, rellenada para los días que Prometheus ya tenía.",
    conceptos=["baja-confianza", "relleno-retencion", "recording-rule", "vacio-nan"],
    explica="Una foto es dudosa si su top-1 queda debajo de 0.3. El histograma <code>classifier_top1_score</code> ya lo cuenta: el bucket <code>le=\"0.3\"</code> suma las fotos con score ≤ 0.3, y el <code>_count</code>, todas. La regla <code>classifier:low_confidence_share:rate30m</code> divide sus tasas de 30 min; el <code>&gt; 0</code> del denominador hace que un rato sin tráfico no guarde un 0 ÷ 0. La alerta compara contra <code>2 * avg_over_time(…[7d])</code> de la misma regla, pide más de 1 foto/s y un <code>for: 30m</code>. Pero una regla recién cargada no tiene historia: su promedio de 7 días es el de unos segundos. <code>mundo/promtool.py rellenar</code> corre los comandos de la documentación («Backfilling for Recording Rules»): <code>promtool tsdb create-blocks-from rules</code> evalúa tus reglas minuto a minuto sobre la historia que Prometheus ya tenía, y los bloques nuevos se mueven a su carpeta de datos. La ventana termina donde Prometheus empezó a leer en vivo.",
    codigo=[{"lang": "yaml", "path": "observabilidad/reglas.yml (el grupo que se agrega)", "code": grupo("classifier-modelo"), "nota": "<code>and on()</code>: el volumen mínimo se cumple o no para todo, sin importar las etiquetas de cada lado."}],
    comandos=[
        C("paso 3", "python mundo/recargar.py prometheus"),
        C("paso 3", "q 'classifier:low_confidence_share:rate30m'", nota="≈ 20 s después: la fracción de ahora, y cuántas muestras tiene la regla en 7 días."),
        C("paso 3", "python verificar.py baja-confianza", nota="El promedio de 7 días todavía es el de un rato."),
        C("paso 3", "python mundo/historia.py ventana", nota="Las banderas del relleno: de donde empieza la historia a donde Prometheus empezó a leer en vivo (en segundos desde 1970)."),
        C("paso 3", "time python mundo/promtool.py rellenar", nota="Los dos comandos que corre, y lo que imprime promtool. Una sola vez por regla: con la misma ventana, crearía bloques repetidos."),
        C("paso 3", "q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'", nota="≈ 75 s después, cuando Prometheus tomó los bloques: muestras, promedio, mínimo y máximo de 7 días."),
        C("paso 3", "python verificar.py baja-confianza", n=1, nota="verificar.py corre además sus pruebas: la fracción que se dobla suena a los 30 min, con poco tráfico no, y una hora sin tráfico no rompe la regla."),
    ],
    verifica=f"<code>python verificar.py baja-confianza</code> en verde: las pruebas ocultas pasan y la regla tiene 7 días grabados, con promedio {f_(mul(AVG7, 100), '{:.1f}')} %.",
    ojo="Sin el <code>&gt; 0</code>, el corte de red del D-3 (45 min sin tráfico) habría grabado NaN, y el promedio de 7 días saldría NaN durante una semana: la alerta no sonaría por nada. No rellenes dos veces la misma ventana. Y la retención de Prometheus tiene que cubrir los 7 días que promedia la alerta: está en <code>compose.yaml</code> (15 días), y su comentario lo dice."))

_est4n = "Al minuto: el latido ya llega al buscapersonas." if LATIDO4 is not None and LATIDO4 < 150 else "El estado del buscapersonas."
G.append(dict(n=4, id="alertmanager", titulo="De la alerta a la persona", objetivo="MonitoringJobStale y el Watchdog en tus reglas, sus pruebas, y un Alertmanager que manda cada severidad a su receptor, calla el ticket que repite un page del mismo SLO y deja pasar el latido.",
    conceptos=["alertmanager", "watchdog", "severidades", "pushgateway-frescura"],
    explica="Prometheus decide que una alerta suena; Alertmanager decide quién se entera. Primero, el grupo <code>classifier-vigilar-al-que-vigila</code>: <code>MonitoringJobStale</code> abre ticket si el job diario lleva más de 26 h sin publicar en la Pushgateway (<code>time() - push_time_seconds</code>; el job llega en el paso 6), y el <code>Watchdog</code>, <code>vector(1)</code>, que siempre suena: es el latido. Agrega sus pruebas a <code>pruebas.yml</code>. Después, <code>observabilidad/alertmanager.yml</code>: el árbol de rutas se recorre en orden y la primera que coincide gana. El Watchdog va primero, a su receptor <code>latido</code>, con <code>repeat_interval: 1m</code> (el buscapersonas espera uno cada ≤ 150 s); luego page → <code>guardia</code>, warning → <code>canal</code>, ticket → <code>tickets</code>, y lo que no cae en ninguna va a la raíz, <code>tickets</code>: nunca al teléfono. <code>group_wait</code> espera a juntar las alertas de un incidente antes del primer aviso; <code>repeat_interval</code>, cada cuánto se repite lo que sigue sonando. La inhibición: si suena un page, calla los tickets con el mismo <code>slo</code>. Las URL de cada integración son de plataforma: se leen con <code>url_file</code>. <code>amtool config routes test</code> dice a qué receptor llegaría una alerta con ciertas etiquetas.",
    codigo=[{"lang": "yaml", "path": "observabilidad/reglas.yml (el grupo que se agrega)", "code": grupo("classifier-vigilar-al-que-vigila"), "nota": "El Watchdog no lleva runbook: no es para nadie, salvo para quien espera el latido."},
            {"lang": "yaml", "path": "observabilidad/pruebas.yml (lo que se agrega al final)", "code": PRUEBAS4, "nota": "La prueba 5 es la hora sin tráfico: con <code>240000x12</code> el contador se queda quieto 12 pasos de 5 min."},
            {"lang": "yaml", "path": "observabilidad/alertmanager.yml", "code": AM, "nota": "<code>send_resolved: false</code> en tickets: un ticket se cierra a mano, después de entender qué pasó."}],
    comandos=[
        C("paso 4", "time python mundo/promtool.py prueba", nota=f"Las 8 pruebas, con 7 días de baja confianza simulados, en {f_(T_PRUEBA4, '{:.1f}')} s."),
        C("paso 4", "python mundo/recargar.py prometheus"),
        C("paso 4", "python mundo/recargar.py alertmanager", nota="amtool check-config y la recarga."),
        C("paso 4", "for l in", nota="A qué receptor llega cada combinación de etiquetas, según tu archivo."),
        C("paso 4", "curl -s localhost:8966/estado", nota=_est4n + " <code>python mundo/tickets.py avisos 3</code> no imprimió nada: el latido no cuenta como aviso."),
        C("paso 4", "alertas", exacto=True, nota="El Watchdog, siempre sonando."),
        C("paso 4", "python verificar.py pruebas-propias alertmanager", nota=f"alertmanager manda además una alerta page de prueba directo a Alertmanager: llegó a la guardia en {f_(PRUEBA_AM_S)} s."),
    ],
    verifica="<code>python verificar.py pruebas-propias alertmanager</code> en verde: tus pruebas prueban las 4 alertas que no son el Watchdog, con casos de «no suena»; cada severidad llega a su receptor, la inhibición está, una alerta page de prueba llega a la guardia y el latido también.",
    ojo="El orden de las rutas importa: si el Watchdog no va primero y lleva <code>severity: none</code>, caería en la raíz y abriría un ticket cada minuto. La raíz nunca debe ser la guardia. Una inhibición sin <code>equal: [slo]</code> callaría todos los tickets de cualquier cosa mientras suene cualquier page. Y recarga con <code>python mundo/recargar.py alertmanager</code>: un archivo que no se recargó no cuenta."))

G.append(dict(n=5, id="incidente", titulo="Un incidente de verdad", objetivo="Triton truena en el 30 % de las inferencias durante 8 minutos: ver cuándo suena el page, cómo la inhibición calla el ticket del mismo SLO, cuándo se apaga después del arreglo y el ticket lento que llega después.",
    conceptos=["burn-rate", "multiventana", "alertmanager"],
    explica="Ahora con el reloj de verdad. <code>mundo/servicios.py reiniciar triton --falla 30</code> deja un Triton que truena en el 30 % de las inferencias: el gateway contesta 5xx a esas requests. Anota la hora y mira, cada pocos minutos, las ventanas, las alertas y lo que le llega a la guardia. Con ≈ 30 % de errores (β ≈ 300), la ventana de 1 h pasa 14.4× en ≈ 3 min y la de 6 h pasa 6× en ≈ 6. El page llega a la guardia después de su <code>group_wait</code>. El ticket lento también suena, pero Alertmanager lo calla mientras el page del mismo SLO siga sonando: es el mismo incidente. A los 8 min regresas Triton. La ventana de 5 min apaga el page en ≈ 5 min, aunque la de 1 h siga arriba; cuando el page se apaga, se levanta la inhibición, pero el ticket lento no llega en ese instante: su grupo ya existía (se formó callado) y Alertmanager solo vuelve a mirarlo en la siguiente vuelta de su <code>group_interval</code>, 5 min heredados de la raíz. Llega a la cola en esa vuelta (su ventana de 30 min sigue viendo los errores).",
    codigo=[],
    comandos=[
        C("paso 5", "date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton --falla 30", nota="La hora de inicio, en UTC."),
        C("paso 5", "python mundo/capas.py | head -2", nota=f"Un minuto después. La capa de servicio mira 3 min: con un minuto de falla adentro, {f_(P5_60, '{:.1f}')} %. La ventana de 5 min va a {f_(R5_60, '{:.1f}')}× y la de 1 h a {f_(R1H_60, '{:.1f}')}×" + (": el page espera a la de 1 h." if R1H_60 is not None and R1H_60 < 14.4 else ".")),
        C("paso 5", "date -u +%H:%M:%S; q 'classifier:error_ratio:rate1h", nota=f"{f_(M_2, '{:.1f}')} min después del inicio. ClassifierErrorBudgetFastBurn sonó a los {f_(M_FAST, '{:.1f}')} min y el page le llegó a la guardia a los {f_(M_PAGE, '{:.1f}')} (su group_wait de 10 s). DojoPrueba… es la alerta de prueba de <code>verificar.py alertmanager</code> del paso 4."),
        C("paso 5", "date -u +%H:%M:%S; q 'classifier:error_ratio:rate30m", nota=f"{f_(M_3, '{:.1f}')} min después: el ticket lento suena (a los {f_(M_SLOW, '{:.1f}')} min), pero Alertmanager lo tiene {'callado (suppressed): lo inhibe el page del mismo SLO' if CALLADO else 'activo'}."),
        C("paso 5", "date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton", exacto=True, nota="El arreglo: Triton sano otra vez."),
        C("paso 5", "date -u +%H:%M:%S; q 'classifier:error_ratio:rate5m", nota=f"{f_(M_5, '{:.1f}')} min después del arreglo: la ventana de 5 min ya está limpia y ClassifierErrorBudgetFastBurn ya no está entre las alertas de Prometheus; el ticket lento sigue sonando (su ventana de 30 min todavía ve los errores). El aviso de «resolved» a la guardia y el ticket llegan en la siguiente vuelta de su grupo, no al instante."),
        C("paso 5", "python mundo/tickets.py avisos 4; python mundo/tickets.py", nota=f"El page se resolvió en la guardia {f_(M_RES, '{:.1f}')} min después del arreglo y el ticket lento llegó {f_(M_TICKET, '{:.1f}')} min después de eso (la siguiente vuelta de su group_interval de 5 min, ya sin inhibición): abrió un ticket en la cola, sin decidir. Es trabajo de la semana (¿por qué falló Triton?)."),
    ],
    verifica=f"El page sonó a los {f_(M_FAST, '{:.1f}')} min del inicio, el ticket lento se quedó callado mientras sonaba el page, el page se apagó {f_(M_RES, '{:.1f}')} min después del arreglo y el ticket llegó {f_(M_TICKET, '{:.1f}')} min después de eso, en la siguiente vuelta de su grupo.",
    ojo="Después del incidente, la ventana de 1 h y la de 6 h siguen altas un buen rato: eso es lo que la ventana corta evita que te despierte. Si corres <code>python verificar.py burn-rate</code> justo después, reporta el burn rate de la última hora alto, pero sin page. Y el ticket lento queda abierto: el incidente se cerró, la pregunta de por qué pasó no."))

_res6 = cmd(mostrar(S("paso 6", "python -c")[0]), O("paso 6", "python -c"), "El resumen de ayer: el PSI y qué categoría lo movió, la baja confianza y los bytes por source, el holdout, las versiones de la app y la aceptación de algunos slices.")
G.append(dict(n=6, id="job-diario", titulo="El job diario", objetivo="<code>diario/monitoreo.py</code>: del Parquet de un día a su resumen en S3 (PSI contra 28 días, baja confianza, bytes, aceptación por slice y holdout) y a la Pushgateway; corrido para cada día desde el primero con 28 días de referencia.",
    conceptos=["psi", "aceptacion-holdout", "pushgateway-frescura"],
    explica="Las señales que no salen de ningún pod se calculan una vez al día, sobre el Parquet que dejó la estación 11. Escribe <code>diario/monitoreo.py</code>. Para el día D lee las predicciones del día y las de los 28 anteriores (la referencia del PSI), solo con status 200, y los eventos del backend del día. Calcula el PSI de la categoría predicha con las 10 categorías como bins, cada término por separado (para saber qué lo movió), la baja confianza y la mediana de bytes por source. La aceptación por slice (total, cada source y cada categoría elegida) une los eventos al log por <code>request_id</code>: n son las publicaciones con la sugerencia mostrada y fuera del holdout; aceptadas, las que eligieron por la vía «sugerencia». El holdout, aparte: en cuántas el top-1 es lo que eligió la persona. Escribe <code>resumen.json</code> en S3 (lo reemplaza: correrlo dos veces da lo mismo) y empuja los números a la Pushgateway con PUT, que reemplaza el grupo. Si falta un día de la referencia, termina con error y no publica nada.",
    codigo=[{"lang": "python", "path": "diario/monitoreo.py", "code": code("diario/monitoreo.py"), "nota": "<code>mundo.comun.descargar</code> reusa lo ya bajado: correr 32 días no baja 32 veces la referencia."}],
    comandos=[
        C("paso 6", "time python diario/monitoreo.py", exacto=True, nota="Ayer, como el job de la 01:00."),
        _res6,
        C("paso 6", "python diario/monitoreo.py --dia", nota="Un día sin sus 28 anteriores: no escribe ni publica."),
        C("paso 6", "time python diario/monitoreo.py --desde", nota=f"Del primer día posible a ayer, del más viejo al más nuevo, en {f_(T_DESDE, '{:.1f}')} s: los resúmenes que va a leer el disparador."),
        C("paso 6", "curl -s localhost:9964/metrics", nota="Lo que quedó en la Pushgateway: lo del último push (ayer) y <code>push_time_seconds</code>, que agrega ella sola."),
        C("paso 6", "q 'time() - push_time_seconds", nota="Cuántos segundos hace que el job publicó: lo que mira MonitoringJobStale."),
        C("paso 6", "python verificar.py job-diario", nota="Compara 3 días de tus resúmenes contra una cuenta independiente."),
    ],
    verifica=f"<code>python verificar.py job-diario</code> en verde: {len(DIAS6) or '?'} resúmenes, y 3 días cuadran con la cuenta de verificar.py. Ayer: PSI {f_(PSI_AYER, '{:.4f}')}, {f_(BAJA_AYER, '{:.1f}')} % de fotos dudosas y {f_(ACEPT_AYER, '{:.1f}')} % de aceptación.",
    ojo=f"Mira la columna del PSI: {', '.join(PSI_ALTOS) or '?'} pasan de 0.2. Los días sueltos son la campaña de sandalias y los vestidos; solo los últimos son una racha. Un día raro no es drift: por eso la regla pide tres seguidos. La aceptación se cuenta sobre las publicaciones que <b>mostraron</b> la sugerencia y fuera del holdout: con las demás en el denominador, cualquier falla de la pantalla parecería culpa del modelo. Y un job que no puede calcular algo termina con error: publicar un PSI sobre menos días de los que dice es peor que no publicar."))

G.append(dict(n=7, id="disparador", titulo="El disparador", objetivo="<code>diario/disparador.py</code>: de los resúmenes a tickets con diagnóstico, uno por causa, con su acción sugerida; los slices con n chico o arrastrados por un source van al reporte.",
    conceptos=["ticket-por-causa", "ruido-tasa", "psi", "diagnosticar"],
    explica="Escribe <code>diario/disparador.py</code>. Dos reglas para el día D. <b>Drift</b>: el PSI pasa de 0.2 tres días seguidos; el episodio empieza el primer día de la racha. <b>Aceptación</b>: para cada slice, la semana D-6..D contra la D-13..D-7, sumando n y aceptadas; si las dos semanas tienen n ≥ 5,000 y la aceptación cayó más de 3 puntos, abre ticket (con n chico, al reporte). Un ticket por causa: mientras caiga algún source, las categorías que caen con él van al reporte como «arrastradas». El id es la regla, el slice y el día en que empezó, así que correrlo todos los días no duplica. Cada ticket lleva el diagnóstico: los despliegues cerca del inicio y, por source, el cambio de la aceptación, de la baja confianza y de los bytes, y la mezcla de versiones de la app. Y la acción sugerida, en orden: un deploy cerca → rollback; un solo source movido → avisar a su dueño; PSI alto y labels peores en el slice → reentrenar; si no, etiquetar. El disparador no reentrena ni decide: sugiere. Pruébalo primero en seco, sobre cada día desde el primero con dos semanas de resúmenes, y después ábrelos de verdad.",
    codigo=[{"lang": "python", "path": "diario/disparador.py", "code": code("diario/disparador.py"), "nota": "<code>margen_pts</code> es el ruido de la diferencia entre las dos semanas, al 95 %: va en la evidencia del ticket para quien lo lea."}],
    comandos=[
        C("paso 7", "python diario/disparador.py --seco", exacto=True, nota="Solo ayer, en seco."),
        C("paso 7", "python diario/disparador.py --desde", nota="Cada día desde el primero con dos semanas de resúmenes, en seco, como si hubiera corrido a diario."),
        C("paso 7", "python diario/disparador.py --desde", n=1, nota="Ahora de verdad: cada episodio se abre el día en que empezó; los días siguientes, «ya estaba abierto»."),
        C("paso 7", "python diario/disparador.py | grep", nota="Otra vez sobre ayer: no duplica."),
        C("paso 7", "python mundo/tickets.py", exacto=True, nota="La cola: el ticket de Alertmanager del paso 5 y los 3 de tu disparador."),
        C("paso 7", "python verificar.py disparador"),
    ],
    verifica="<code>python verificar.py disparador</code> en verde: exactamente 3 tickets (mobile, abrigos y el drift), cada uno con su diagnóstico y la acción que le toca; correrlo otra vez no abre nada nuevo.",
    ojo="La acción sugerida es la del día en que se abrió: el ticket de abrigos se abrió cuando el PSI todavía no pasaba de 0.2 y sugiere «etiquetar»; hoy sugeriría «reentrenar». Por eso decide una persona, con el diagnóstico de hoy. Botines cae cada día más, pero con menos de 5,000 publicaciones por semana va al reporte: puede ser real, y alguien lo mira con calma. Y si el id llevara la fecha de hoy, cada día de la racha abriría un ticket nuevo del mismo episodio."))

_sub8 = O("paso 8", "python mundo/orquestador.py submit", n=2)
G.append(dict(n=8, id="decidir", titulo="Diagnosticar y decidir", objetivo="Leer la evidencia y el diagnóstico de cada ticket, decidir qué se hace con cada uno y adelantar el reentrenamiento solo por el que lo amerita.",
    conceptos=["diagnosticar", "aceptacion-holdout"],
    explica="En este paso no escribes código: decides. Lee cada ticket completo con <code>python mundo/tickets.py ver &lt;id&gt;</code>. El de mobile: solo se movió <code>source=mobile</code> (web e internal siguen igual), sus fotos pesan menos y la app 5.2.0 pasó de 0 % a casi todo el tráfico de mobile. Ningún deploy propio. Es un cambio de quien llama: se le avisa al dueño (<code>equipo-app-mobile</code>) con la evidencia, y no se reentrena, porque el modelo aprendería a convivir con fotos peores. El de drift: el PSI pasa de 0.2 tres días, lo mueve <code>categoria=abrigos</code> y la aceptación de abrigos cae 7 puntos con un margen de ± 1.3. Cambió el mundo (el frío, chamarras acolchadas que el modelo casi no vio) y los labels lo confirman: tanda extra de abrigos y corrida adelantada. El de abrigos es la misma causa: va en la misma corrida. El orquestador se niega a adelantar nada por un ticket que no está decidido con «reentrenar».",
    codigo=[],
    comandos=[
        C("paso 8", "python mundo/tickets.py ver aceptacion-source=mobile", nota="El ticket de mobile: el título, la evidencia, el diagnóstico (bytes y baja confianza de cada source, antes y ahora; la mezcla de apps) y la acción sugerida."),
        C("paso 8", "python mundo/tickets.py ver drift-psi", nota="El de drift: el PSI de los tres días, la aceptación del slice que lo mueve y los despliegues cercanos (ninguno)."),
        C("paso 8", "python mundo/orquestador.py submit", nota="Antes de decidir: el orquestador se niega."),
        C("paso 8", "python mundo/tickets.py decidir aceptacion-source=mobile", nota="Decide la persona, con su nota."),
        C("paso 8", "python mundo/tickets.py decidir drift-psi"),
        C("paso 8", "python mundo/tickets.py decidir aceptacion-categoria=abrigos"),
        C("paso 8", "python mundo/orquestador.py submit", n=1, nota="Por el ticket de mobile, tampoco: reentrenar no arregla una app."),
        C("paso 8", "python mundo/orquestador.py submit", n=2, nota="Por el drift, sí: la corrida adelantada sube la misma escalera que la del mes."),
        C("paso 8", "python mundo/orquestador.py lista"),
        C("paso 8", "python verificar.py ciclo-cerrado"),
    ],
    verifica="<code>python verificar.py ciclo-cerrado</code> en verde: mobile decidido como «avisar-dueno» y sin corrida; el drift, como «reentrenar» y con su corrida adelantada; abrigos, con reentrenar o etiquetar.",
    ojo="La tentación es reentrenar con todo: «el modelo empeoró, que aprenda lo nuevo». En mobile no empeoró el modelo: empeoraron las fotos. Y los labels de la corrida adelantada no salen de lo que eligió quien vende esta semana (lo empujó el modelo): salen de la cola humana, con la tanda extra de abrigos del paso 9."))

M9_OK = "✓" in M9
G.append(dict(n=9, id="muestras", titulo="Las muestras y el job programado", objetivo="<code>diario/muestras.py</code>: la cola de etiquetado del mes siguiente (300 por incertidumbre, 200 al azar y 100 por cada slice decidido), sin examen ni repetidas; y el job programado corriendo tus pasos. El ciclo vuelve a la estación 1.",
    conceptos=["cola-etiquetado", "pushgateway-frescura"],
    explica="Escribe <code>diario/muestras.py</code>. Lee las predicciones de los últimos 30 días, solo con status 200 y solo de la versión que atiende hoy, y les une los eventos para saber la categoría que eligió quien vende. Quita las fotos del examen fijo (la ruta la dice <code>mundo.comun.examen()</code>, de <code>plataforma.yaml</code>: no la escribas en tu código) y las repetidas por sha256. Elige 300 por incertidumbre (las de score más bajo, las mismas que cuenta la baja confianza) y 200 al azar entre las que quedan, con el mes como semilla, para ver también los errores seguros del modelo. Agrega 100 al azar de los últimos 7 días por cada slice de un ticket decidido con «reentrenar» o «etiquetar» (un slice repetido, una sola tanda). Escribe <code>etiquetado/cola-AAAA-MM/tareas.json</code> en el formato de importación de Label Studio, el de la estación 1. Al final, el job programado: <code>mundo/cron.py correr</code> corre tus dos pasos sobre ayer, con la cuenta del job, como el CronWorkflow de la 01:00.",
    codigo=[{"lang": "python", "path": "diario/muestras.py", "code": code("diario/muestras.py"), "nota": "La consulta deja una fila por sha256 (la primera vez que se vio): la misma foto subida dos veces no se etiqueta dos veces."}],
    comandos=[
        C("paso 9", "time python diario/muestras.py", nota="La cola del mes que viene." if M9_OK else ""),
        C("paso 9", "python -c", nota="Tres tareas: la primera (incertidumbre), una al azar y la última (de la tanda extra)."),
        C("paso 9", "time python mundo/cron.py correr", nota="El job programado: tus dos pasos sobre ayer. El disparador no abre nada nuevo."),
        C("paso 9", "python mundo/cron.py estado"),
        C("paso 9", "q 'time() - push_time_seconds", nota="Recién publicado: MonitoringJobStale tiene 26 h antes de sonar."),
        C("paso 9", "time python verificar.py", nota=f"Al final de la estación: los 12 checks, en {f_(T_V9)} s."),
        C("paso 9", "cat taller/progreso.json", nota="verificar.py anota cada corrida en <code>taller/progreso.json</code>, para tu tablero."),
    ],
    verifica=f"<code>python verificar.py</code>: {f_(VERDE9)} de 12 en verde. La cola trae {f_(COLA_N)} fotos para la estación 1.",
    ojo="Si la cola solo tuviera incertidumbre, el modelo nunca vería sus errores seguros: el azar los encuentra. Una foto del examen fijo en la cola es una fuga: si se etiqueta y entra al entrenamiento, el gate examinaría al modelo con fotos que ya vio. Y la cola se arma después de decidir los tickets: la tanda extra sale de esas decisiones."))

REPARTO = {
    1: (["slo-presupuesto", "burn-rate", "recording-rule", "vacio-nan"], ["presupuesto-mes", "page-14x", "ticket-6x"]),
    2: (["promtool-test", "multiventana"], ["muestras-7-dias"]),
    3: (["baja-confianza", "relleno-retencion"], ["umbral-baja-confianza"]),
    4: (["severidades", "alertmanager", "watchdog"], []),
    5: ([], ["cuando-suena"]),
    6: (["psi", "aceptacion-holdout", "pushgateway-frescura"], ["dias-de-historia"]),
    7: (["ticket-por-causa", "ruido-tasa"], ["ruido-aceptacion"]),
    8: (["diagnosticar"], []),
    9: (["cola-etiquetado"], ["tamano-cola"]),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
G[1]["en_pagina"]["del_paso0"] = [3, 6]      # las cinco capas y el verificar.py del principio
e["guiado"] = G

# ---------------------------------------------------------------- Construir solo
e["solo"] = {
    "reglas": [
        "Empieza con el kit recién descomprimido en una carpeta nueva y <code>python mundo/crear.py</code>. El mundo es uno solo (los mismos puertos y el mismo proyecto de compose): si el de Construir con ayuda sigue prendido en otra carpeta, apágalo allá antes (<code>python mundo/servicios.py parar</code> y <code>docker compose down -v</code>).",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo tuyo (<code>observabilidad/reglas.yml</code>, <code>pruebas.yml</code> y <code>alertmanager.yml</code>, <code>diario/monitoreo.py</code>, <code>disparador.py</code> y <code>muestras.py</code>).",
        "Cada objetivo tiene su check; corre <code>python verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Un archivo que no se recargó no cuenta: <code>python mundo/recargar.py prometheus|alertmanager</code>, y <code>python mundo/promtool.py prueba</code> para tus pruebas. Una recording rule nueva nace sin historia: <code>python mundo/promtool.py rellenar</code>, una sola vez por regla.",
        "Decidir los tickets es tuyo: <code>python mundo/tickets.py ver &lt;id&gt;</code> y <code>decidir</code>; el reentrenamiento adelantado, con <code>python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket &lt;id&gt;</code>.",
        "Las reglas de otros equipos no se tocan: <code>mundo/</code> (el SLO, el job y su cuenta, la ruta del examen, las integraciones), <code>gateway/</code> y los nombres de las métricas.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 con 60 días de historia, Prometheus con 8 días de métricas, Alertmanager, la Pushgateway y los 5 procesos arriba.", "check": "mundo"},
        {"n": 2, "objetivo": "Las 5 recording rules y las 5 alertas cargadas en Prometheus, cada alerta con su severity y, salvo el Watchdog, su runbook_url.", "check": "reglas", "pista": "¿Prometheus ve el mismo reglas.yml que tú?"},
        {"n": 3, "objetivo": "Un page si el presupuesto se gasta a más de 14.4× en 1 h y en 5 min; un ticket si va a más de 6× en 6 h y en 30 min; los 4xx no cuentan y sin 5xx la fracción vale 0.", "check": "burn-rate", "pista": "¿Qué hace la ventana corta después del arreglo?"},
        {"n": 4, "objetivo": "Un ticket si la fracción de fotos dudosas pasa del doble de su promedio de 7 días durante 30 min, con más de 1 foto/s; la regla grabada tiene 7 días de historia y ningún NaN.", "check": "baja-confianza", "pista": "¿Cuánta historia tiene una regla que acabas de cargar?"},
        {"n": 5, "objetivo": "Tus pruebas de promtool pasan, prueban las 4 alertas que no son el Watchdog y al menos 3 casos esperan que no suene.", "check": "pruebas-propias", "pista": "¿Qué no debe despertar a nadie?"},
        {"n": 6, "objetivo": "Cada severidad llega a su receptor (page → guardia, warning → canal, ticket → tickets, el Watchdog → latido, lo demás → tickets), un page calla el ticket del mismo SLO y el latido llega al buscapersonas.", "check": "alertmanager", "pista": "¿A quién le llega una alerta que no cae en ninguna ruta?"},
        {"n": 7, "objetivo": "Las señales en vivo, sanas: los 5xx, la fracción de fotos dudosas, el PSI de las categorías y los bytes de cada source contra sus 7 días. Aquí no escribes nada: es el mundo, y se rompe en Romper.", "check": "en-vivo"},
        {"n": 8, "objetivo": "Los resúmenes diarios en S3, desde el primer día con 28 días de referencia hasta ayer, que cuadran con una cuenta independiente: filas, PSI, baja confianza, aceptación por slice y holdout.", "check": "job-diario", "pista": "¿Contra qué días se compara el PSI de un día?"},
        {"n": 9, "objetivo": "El job programado corre tus dos pasos sobre ayer y publica en la Pushgateway; MonitoringJobStale abre ticket a las 26 h sin publicar.", "check": "frescura", "pista": "¿Qué ve el tablero si el job deja de correr?"},
        {"n": 10, "objetivo": "Exactamente 3 tickets, uno por causa (mobile, abrigos y el drift), con su diagnóstico y su acción sugerida; correrlo otra vez no duplica.", "check": "disparador", "pista": "¿Qué haces con una categoría que cae porque cayó mobile?"},
        {"n": 11, "objetivo": "La cola del mes siguiente en S3: 300 por incertidumbre, 200 al azar y 100 por cada slice decidido, sin fotos del examen ni repetidas, en el formato de Label Studio.", "check": "muestras", "pista": "¿Qué pasa si una foto del examen se etiqueta y entra al entrenamiento?"},
        {"n": 12, "objetivo": "Los tickets decididos por ti: mobile → avisar al dueño, sin reentrenar; el drift → una corrida adelantada; abrigos → reentrenar o etiquetar.", "check": "ciclo-cerrado", "pista": "¿Reentrenar arregla una app que manda fotos peores?"},
    ],
}

# ---------------------------------------------------------------- fallas
FAL = []


def falla(id_, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto_, check, nota=""):
    r = ROMPER[id_]
    FAL.append({"id": id_, "titulo": r["titulo"], "tipo": r["tipo"], "historia": r["historia"], "sintoma": sintoma,
                "hipotesis": hipotesis, "confirma": cmd(confirma_code, confirma_salida, nota), "arreglo": arreglo,
                "concepto": concepto_, "check": check})


def sint(f, etapa="verificar"):
    todo = F(f"{f} {etapa}")
    s = F(f"{f} {etapa}", filtro=r"^✗")
    if not s and not pendiente(todo):     # la falla se metió, pero ningún check la vio: el síntoma no sirve
        return falta(f"que verificar.py detecte «{f}» (en «{f} {etapa}» no hay ningún ✗)")
    return "<code>verificar.py</code>: " + (s or todo)


NOTA_Q = "<code>q '…'</code> y <code>alertas</code> le preguntan a la API de Prometheus, como las funciones del paso 1 (aquí q imprime las etiquetas a la manera de Python)."
_ya = F("latido-perdido verificar ya", filtro=r"^✗")
_lat_s = (LAT_AVISO - LAT_DESDE).total_seconds() if LAT_AVISO and LAT_DESDE else None   # del último latido al aviso

falla("latido-perdido", sint("latido-perdido"),
      ["Alertmanager se cayó o cargó una configuración rota.", "Prometheus no le puede entregar las alertas a Alertmanager.", "El buscapersonas, la integración, dejó de recibir."],
      confirmar_de("latido-perdido", "buscapersonas", "prometheus", "log"),
      F("latido-perdido buscapersonas") + "\n\n" + F("latido-perdido prometheus") + "\n\n" + F("latido-perdido log"),
      "El commit de plataforma (PLAT-4702) cambió en <code>mundo/prometheus/prometheus.yml</code> el destino de las alertas a <code>alertmanager-ha:9093</code>, un nombre que no existe. Prometheus sigue evaluando todo (en /alerts ves las alertas sonar), pero no le puede entregar nada a Alertmanager: ni pages ni tickets. "
      + (f"A los 30 s, <code>verificar.py alertmanager</code> ya lo veía en <code>prometheus_notifications_errors_total</code>. " if _ya else "")
      + "Alertmanager todavía repite el último Watchdog unos minutos (cada alerta llega con una hora de fin: 4 veces el reenvío de 1 min) y, sin latido por más de 150 s, el buscapersonas avisa"
      + (f": aquí, {f_(_lat_s)} s después del último latido que llegó" if _lat_s else "") + ". Arreglo: <code>git revert</code> del commit y <code>python mundo/recargar.py prometheus</code>; en ≈ 1 min vuelve el latido. En C01, quien espera el latido vive fuera del clúster (el dead man's switch de PagerDuty o un servicio como Healthchecks.io): por eso puede avisar cuando lo de adentro calla. Y un cambio en el destino de las alertas se prueba con una alerta de prueba antes de cerrar el ticket.",
      "watchdog", "alertmanager", NOTA_Q)
falla("retencion-corta", sint("retencion-corta"),
      ["Alguien cambió o borró la regla grabada.", "Prometheus perdió historia: guarda menos días.", "La baja confianza de verdad cambió."],
      confirmar_de("retencion-corta", "historia", "log"),
      F("retencion-corta historia") + "\n\n" + F("retencion-corta log"),
      f"El commit de FinOps (FIN-207) puso <code>--storage.tsdb.retention.time={RET_FLAG}</code> en <code>compose.yaml</code>. Al reiniciar, Prometheus borró todo lo de más de 2 días: la historia del gateway y la de tu regla grabada, que quedó con {f_(RET_N)} muestras en 7 días (tenía ≈ 10,000). ClassifierLowConfidenceSpike compara contra el promedio de 7 días de esa regla; ahora es el de 2, y si un cambio dura más de 2 días deja de verlo: ya es «lo normal». Nada truena: la alerta sigue evaluando. Su comentario lo decía: retención ≥ 7 días. Arreglo: <code>git revert</code> del commit, <code>docker compose up -d prometheus</code> y volver a llenar lo borrado: <code>python mundo/historia.py metricas --de-nuevo</code> (la historia del gateway), ≈ 1 min y <code>python mundo/promtool.py rellenar</code> (la de tu regla); quedó con {f_(RET_N2)}. En C01 lo borrado no vuelve: se pierden días de referencia hasta que se junten otra vez. Un cambio de retención se revisa contra la ventana más larga que usa cualquier regla.",
      "relleno-retencion", "baja-confianza", NOTA_Q)
falla("job-roto", sint("job-roto"),
      ["El job programado no corrió.", "El job corrió, pero tronó y no publicó.", "La Pushgateway perdió lo que tenía."],
      confirmar_de("job-roto", "cron", "pushgateway", "log"),
      F("job-roto cron") + "\n\n" + F("job-roto pushgateway") + "\n\n" + F("job-roto log"),
      "El commit de plataforma (SEC-131) cambió en <code>mundo/plataforma.yaml</code> la cuenta de S3 del job <code>monitoreo-diario</code> a <code>monitoreo-ro</code>, una cuenta que nadie creó en el S3. La corrida de la 01:00 tronó en tu <code>monitoreo.py</code> (InvalidAccessKeyId) y no publicó. La Pushgateway nunca olvida: sigue mostrando el PSI y la aceptación de la corrida anterior, y el tablero se ve perfecto. MonitoringJobStale lo diría a las 26 h; <code>verificar.py frescura</code> lo ve ya: la última corrida falló y lo publicado es de antes. Arreglo: <code>git revert</code> del commit y <code>python mundo/cron.py correr</code>. En C01, el arreglo de fondo es crear la cuenta (el rol de IAM) antes de apuntar el job a ella.",
      "pushgateway-frescura", "frescura", NOTA_Q)
falla("decode-nuevo", sint("decode-nuevo"),
      ["El mundo cambió de golpe: llegó una tanda de fotos de una sola categoría.", "Un deploy propio cambió cómo se prepara la foto.", "Una app de quien llama cambió sus fotos."],
      confirmar_de("decode-nuevo", "capas", "log"),
      F("decode-nuevo capas") + "\n\n" + F("decode-nuevo log"),
      f"El commit de Beto (PERF-3310) en <code>gateway/app/preprocess.py</code> quitó la división entre 255 («el decoder rápido ya entrega [0, 1]»), pero el decoder del dojo sigue entregando de 0 a 255: el modelo recibe cada foto 255 veces más brillante de lo que aprendió. Todo contesta 200, igual de rápido, y el modelo se ve más seguro que nunca: la fracción de fotos dudosas cae a {f_(DEC_BAJA, '{:.2f}')}× su promedio de 7 días, y contesta casi siempre lo mismo, así que el PSI de las categorías de los últimos 3 min contra 7 días sube a {f_(DEC_PSI, '{:.1f}')}. Los bytes de las tres fuentes siguen igual: nadie cambió lo que manda. Una alerta que solo mira «más dudosas que de costumbre» no lo ve; <code>verificar.py en-vivo</code> reprueba también si caen debajo de la mitad: un modelo seguro de todo, de repente, también es una alarma. Es training-serving skew por un deploy propio: no se reentrena, se hace rollback. Arreglo: <code>git revert</code> del commit y <code>python mundo/servicios.py reiniciar gateway</code>; en ≈ 4 min la ventana de 3 min ya no lo ve. En C01, la prueba de paridad de punta a punta (las mismas fotos por el camino del entrenamiento y por el del gateway) lo atrapa antes de que llegue al tráfico. Y un bug más fino no se ve así: con el modelo del dojo, invertir los canales (RGB → BGR) sobre 300 fotos con la mezcla del tráfico cambia el top-1 en 74 % de las fotos y deja el PSI en 0.019 y las dudosas en 1.18×. Seguro y equivocado: ninguna señal sin labels lo ve, solo la aceptación, días después.",
      "diagnosticar", "en-vivo")
falla("app-nueva", sint("app-nueva"),
      ["El modelo empeoró y hay que reentrenarlo.", "Una versión nueva de la app cambió las fotos que manda.", "Un deploy del gateway cambió el preproceso."],
      confirmar_de("app-nueva", "capas", "log"),
      F("app-nueva capas") + "\n\n" + F("app-nueva log"),
      "La app mobile 5.3.0 (APP-5121) manda las fotos con mucho menos contraste y más comprimidas (<code>mundo/callers.json</code>). Para el servicio no pasó nada; en la capa de datos, las fotos de mobile pesan menos"
      + (f" ({APP_BYTES.group(1)} B contra {APP_BYTES.group(2)} en 7 días)" if APP_BYTES else "") + f", y en la del modelo la fracción de fotos dudosas sube a {f_(APP_BAJA, '{:.2f}')}× su promedio. Solo cambió un source: no es el modelo ni un deploy tuyo. No se reentrena (le enseñarías a convivir con el bug de otro): se le avisa al dueño (<code>equipo-app-mobile</code>, en <code>plataforma.yaml</code>) con la evidencia, y el dueño regresa o corrige su versión. En el dojo, el <code>git revert</code> del commit hace lo que haría el equipo de la app al recibir tu aviso; en ≈ 4 min la ventana ya no lo ve.",
      "baja-confianza", "en-vivo")
falla("examen-nuevo", sint("examen-nuevo"),
      ["La cola trae fotos repetidas.", "Cambió el examen fijo y la cola ya armada choca con él.", "La cola se armó con otra versión del modelo."],
      confirmar_de("examen-nuevo", "log"),
      F("examen-nuevo log"),
      f"El commit del equipo de datos (DATA-880) cambió en <code>mundo/plataforma.yaml</code> la ruta del examen a <code>datasets/golden-v2/sha256.txt</code>, que suma 40 fotos de noviembre; {f_(EXA_N)} ya estaban en tu cola. Si se etiquetan y entran al entrenamiento, el modelo nuevo las habrá visto cuando el gate lo examine: el examen deja de medir (una fuga del test). La cola se armó antes del cambio: hay que volver a armarla. Arreglo: <code>python diario/muestras.py</code>, que lee la ruta del examen cada vez (por eso no va escrita en tu código). Aquí no se revierte nada: el cambio del equipo de datos es bueno.",
      "cola-etiquetado", "muestras")
e["fallas"] = FAL

e["listo"] = [
    "El presupuesto de errores del mes tiene sus dos alertas de burn rate, cada una en dos ventanas: un page que suena en minutos y se apaga poco después del arreglo, y un ticket para el gasto lento.",
    "La baja confianza se compara contra su propio promedio de 7 días, con la historia de su regla rellenada y sin NaN.",
    "Cada alerta tiene pruebas de promtool, también de lo que no debe sonar.",
    "Alertmanager manda cada severidad a su receptor, calla el ticket que repite un page del mismo SLO y deja pasar el latido; si el latido se pierde, alguien se entera.",
    "El job diario publica el PSI, la baja confianza y la aceptación por slice, y si deja de publicar, MonitoringJobStale lo dice.",
    "El disparador abrió un ticket por causa, con diagnóstico; una persona los decidió y solo el drift adelantó un reentrenamiento.",
    "La cola de etiquetado del mes siguiente está en S3, sin examen ni repetidas: el ciclo vuelve a la estación 1.",
]

e["repaso"] = {
    "memo": "<b>Presupuesto, pruebas, persona, señal, causa y cola.</b> Las alertas miden qué tan rápido se gasta el <b>presupuesto</b> del mes: 14.4× en 1 h y 5 min es page; 6× en 6 h y 30 min, ticket; la ventana larga confirma y la corta apaga. Cada regla tiene sus <b>pruebas</b> de promtool, sobre todo de lo que no debe sonar. Alertmanager decide qué <b>persona</b> se entera, y un latido vigila que el camino funcione. Las <b>señales</b> del modelo llegan en capas: la baja confianza en minutos, el PSI y la aceptación al día siguiente, el holdout al final. Un disparador abre un ticket por <b>causa</b>, con diagnóstico, y una persona decide: un deploy propio se revierte, un cambio de quien llama se le avisa a su dueño, y solo un mundo que cambió, con labels que lo confirman, se reentrena. Lo que queda es la <b>cola</b> del mes, que vuelve a la estación 1.",
    "trampa": "Un umbral fijo o una sola ventana; un page por la calidad del modelo; una alerta que nadie probó; un job que deja de publicar con el tablero en verde; y reentrenar sobre el bug de otro.",
    "entrevista": [
        {"q": "¿Cómo alertas sobre los errores de un servicio con un SLO de 99.9 %?", "a": "Con burn rate, no con un umbral fijo: la fracción de errores dividida entre el presupuesto (0.001) dice a qué ritmo se gasta el mes. Un page si va a más de 14.4× en 1 h y en 5 min (2 % del presupuesto en una hora) y un ticket si va a más de 6× en 6 h y en 30 min (5 % en 6 h). Las dos ventanas: la larga confirma que no es un pico y la corta apaga la alerta minutos después del arreglo. Los 4xx fuera, y las fracciones como recording rules."},
        {"q": "¿Qué despierta a la guardia y qué no?", "a": "Un page solo si el usuario está afectado ahora y alguien puede arreglarlo ahora: el presupuesto quemándose rápido, la latencia fuera del SLO, el servicio caído. Lo que anticipa un page es warning (al canal, en horario). La calidad del modelo (PSI, baja confianza, aceptación) es ticket: nadie la arregla a las 3 de la mañana, y si despiertas a alguien por ella, la guardia deja de creerle a sus alertas. Cada alerta con su runbook."},
        {"q": "El servicio contesta 200 y rápido, pero sospechas que el modelo empeora. ¿Cómo te enteras?", "a": "En capas, de la más rápida a la más lenta. En minutos, sin labels: la fracción de predicciones con baja confianza contra su promedio de 7 días, los bytes de la foto por source y el PSI de las categorías predichas. Al día siguiente, un job batch: el PSI del día contra 4 semanas y la aceptación por slice, uniendo los eventos del backend al log por request_id. Y el holdout, que nunca ve sugerencias: la exactitud sin la huella del modelo, que tarda semanas."},
        {"q": "El PSI pasa de 0.2 tres días seguidos. ¿Reentrenas?", "a": "Todavía no: abro un ticket y diagnostico. Primero, ¿hubo un deploy propio cerca del inicio? Rollback. ¿Se movió un solo source o salió una versión de una app? Aviso al dueño. ¿Puede ser training-serving skew? La prueba de paridad. Si cambió el mundo, miro los labels: si la aceptación del slice que mueve el PSI también cae, tanda extra de etiquetado de ese slice y corrida adelantada, que sube el mismo gate y el mismo canary. Si los labels no empeoran, etiquetar una muestra y esperar."},
        {"q": "¿Cómo sabes que tu monitoreo funciona?", "a": "Vigilando al que vigila. Un Watchdog que siempre suena y un dead man's switch fuera del clúster que avisa si deja de llegar: si el camino Prometheus → Alertmanager → integración se rompe, lo único que lo delata es el latido que falta. Para los jobs batch, una alerta de frescura sobre push_time_seconds de la Pushgateway, que nunca olvida el último valor. Para las series que pueden desaparecer, up y absent(). Y pruebas de promtool de cada regla, también de lo que no debe sonar."},
        {"q": "La aceptación de un slice cayó 4 puntos esta semana. ¿Es real?", "a": "Depende de n. El margen al 95 % es 1.96 × √(a(1 − a) ÷ n), y al comparar dos semanas, √2 veces más: con 5,000 por semana y a = 0.70, ± 1.8 puntos, así que 4 puntos es real; con 500, ± 4 y no se distingue del azar. Por eso pido un n mínimo antes de abrir ticket. Y reviso si el slice no está arrastrado por otro: si cayó un source grande, sus categorías caen con él, y es una sola causa."},
        {"q": "¿Qué fotos mandas a etiquetar cada mes?", "a": "Una mezcla: las de score más bajo (incertidumbre, donde el modelo más duda), una parte al azar (para encontrar sus errores seguros y no sesgar el dataset) y, si una persona decidió un ticket, una tanda extra del slice que falla. Siempre sin las fotos del examen fijo, para que el gate siga midiendo, y sin repetidas. Y nunca uso como label lo que eligió el usuario con la sugerencia enfrente: lo empujó el propio modelo."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-monitoreo/CLAUDE.md",
    "guiado": "content/estaciones/c01-monitoreo/prompts/guiado.md",
    "solo": "content/estaciones/c01-monitoreo/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-monitoreo/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-monitoreo/prompts/romper-solo.md",
}

# lo que la página da por hecho: que el Guiado terminó en verde y que cada paso dejó lo suyo
for paso_, salida_, check_ in (("paso 1", O("paso 1", "python verificar.py reglas burn-rate"), "burn-rate"),
                               ("paso 3", O("paso 3", "python verificar.py baja-confianza", n=1), "baja-confianza"),
                               ("paso 4", V4, "alertmanager"), ("paso 6", O("paso 6", "python verificar.py job-diario"), "job-diario"),
                               ("paso 7", O("paso 7", "python verificar.py disparador"), "disparador"),
                               ("paso 8", O("paso 8", "python verificar.py ciclo-cerrado"), "ciclo-cerrado")):
    if not pendiente(salida_) and not ok_check(salida_, check_):
        falta(f"«{check_}» en verde en el {paso_} de {CARPETA.name}.log")
if VERDE9 != 12:
    falta(f"12/12 en verde al final del paso 9 de {CARPETA.name}.log (salió {f_(VERDE9)})")
if any(v != CARPETA.name for v in USADAS.values()):
    print("ℹ fallas de otra corrida: " + ", ".join(f"{k} ({v})" for k, v in USADAS.items() if v != CARPETA.name))
if FALTAN:
    print("⚠ borrador: faltan " + str(len(dict.fromkeys(FALTAN))) + ":\n  " + "\n  ".join(dict.fromkeys(FALTAN)))
(APP / "content/estaciones/c01-monitoreo.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· conceptos:", len(e["conceptos"]), "· precálculos:", len(e["precalculos"]["cuentas"]),
      "· pasos:", len(G), "· objetivos:", len(e["solo"]["objetivos"]), "· fallas:", len(FAL), "· preguntas:", len(e["repaso"]["entrevista"]))
