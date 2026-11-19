"""Arma content/estaciones/c01-kubernetes.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e9 && bash probar-fallas.sh /tmp/e9     # deja /tmp/e9.log y /tmp/e9.fallas.log
    python3 contenido.py /tmp/e9                                 # escribe el JSON con esas salidas
    python3 contenido.py /tmp/e9 --borrador                      # lo escribe aunque falten secciones (para revisar)

Ninguna salida se copia a mano: cada `salida` sale de un comando de una sección «### nombre» de los logs.
- <carpeta>.log: los pasos 0 a 7 del Guiado («### paso N: …», cada comando como «$ comando» y su salida).
- <carpeta>.paso8.log, si existe: el paso 8 y el «final» (se volvieron a correr con la foto de 12 MP); si no, los de
  <carpeta>.log.
- <carpeta>.fallas.log: «### <falla> <etapa>», cada sección directamente con su salida.
El código de los pasos sale de los archivos de la solución (k8s/*.yaml) y del kit, nunca escrito aquí.
"""
import json
import math
import re
import sys
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
BORRADOR = "--borrador" in sys.argv
CARPETA = Path(args[0]) if args else sys.exit("uso: python3 contenido.py <carpeta de probar.sh> [--borrador]")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
KIT = APP / "kits" / "c01-kubernetes"
RUTA = str(CARPETA)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
FALTAN = []


def leer(p: Path) -> str:
    return p.read_text() if p.exists() else ""


def limpiar(t: str) -> str:
    t = ANSI.sub("", t)
    for r in (RUTA, RUTA.removeprefix("/private")):
        t = t.replace(r, "~/c01-kubernetes")
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
            cur[1].append(ln)
    return [(c, "\n".join(o).strip("\n")) for c, o in out]


LOG = secciones(leer(Path(f"{CARPETA}.log")))
P8 = secciones(leer(Path(f"{CARPETA}.paso8.log")))
if P8:                                   # el paso 8 y el final de .log son de una corrida vieja: no se usan
    LOG = {k: v for k, v in LOG.items() if not (k.startswith("paso 8") or k == "final")}
    LOG.update(P8)
LOGF = secciones(leer(Path(f"{CARPETA}.fallas.log")))


def falta(que: str) -> str:
    FALTAN.append(que)
    if not BORRADOR:
        sys.exit(f"✗ falta {que}")
    return "(pendiente: " + que + ")"


def seccion(nombre: str) -> str:
    """La sección del log del Guiado cuyo nombre empieza con `nombre` («paso 3» encuentra «paso 3: las probes…»)."""
    k = next((k for k in LOG if k == nombre or k.startswith(nombre + ":")), None)
    return LOG[k] if k else None


def S(sec: str, empieza: str, n: int = 0):
    """(comando, salida) del n-ésimo comando de la sección que empieza con `empieza`."""
    cuerpo = seccion(sec)
    if cuerpo is None:
        return empieza, falta(f"la sección «{sec}» en {CARPETA}.log" + (" (o .paso8.log)" if sec.startswith(("paso 8", "final")) else ""))
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
        return falta(f"la sección «{nombre}» en {CARPETA}.fallas.log")
    lineas = LOGF[nombre].strip("\n").split("\n")
    if filtro:
        lineas = [ln for ln in lineas if re.search(filtro, ln)]
    if quitar:
        lineas = [ln for ln in lineas if not re.search(quitar, ln)]
    return "\n".join(lineas).strip("\n")


def num(texto: str, rx: str, defecto=None):
    m = re.search(rx, texto or "", re.M)
    if not m:
        if defecto is not None or BORRADOR:
            return defecto if defecto is not None else "?"
        sys.exit(f"✗ no encontré {rx!r} en:\n{texto[:400]}")
    return m.group(1)


def code(rel: str, base: Path = SOL) -> str:
    return (base / rel).read_text().rstrip("\n")


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def C(sec, empieza, n=0, nota="", code_=None, **kw):
    """Un comando del log tal como se corrió (o con `code_` si se muestra distinto) y su salida real."""
    c, _ = S(sec, empieza, n)
    return cmd(code_ or c, O(sec, empieza, n, **kw), nota)


def segundos(real: str) -> float:
    m = re.search(r"real\s+(\d+)m([\d.]+)s", real or "")
    return int(m.group(1)) * 60 + float(m.group(2)) if m else float("nan")


def entre(texto: str, desde: str, hasta: str) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)].rstrip()


V = "python3 verificar.py"

# ---------------------------------------------------------------- los números que salen de los logs
CREAR_S = num(O("paso 0", "time python3 mundo/crear.py"), r"listo en (\d+) s", "?")
APODO = {}                       # dojo-k8s-worker3 → (t4-a1, us-east-1a)
for ln in O("paso 1", "kubectl get nodes -L").split("\n")[1:]:
    p = ln.split()
    if len(p) >= 8:
        APODO[p[0]] = (p[5], p[6])
SIS_M = int(num(O("paso 1", "kubectl describe node dojo-k8s-worker |"), r"^\s+cpu\s+(\d+)m", "200"))
GW1_M = int(num(O("paso 4", "kubectl describe node dojo-k8s-worker |"), r"^\s+cpu\s+(\d+)m", "1200"))
LOG_T = O("paso 3", "kubectl -n classifier logs")
_t = re.findall(r"^I\d+ (\d\d):(\d\d):([\d.]+) .*(deserializando|warmup)", LOG_T, re.M)
ENGINE_S = round((lambda a, b: (int(b[0]) * 3600 + int(b[1]) * 60 + float(b[2])) - (int(a[0]) * 3600 + int(a[1]) * 60 + float(a[2])))(*_t[:2])) if len(_t) >= 2 else 20
STARTUP_X = num(O("paso 3", "kubectl -n classifier describe pod"), r"Unhealthy\s+\S+\s+\(x(\d+) over", "?")
TRITON_S = round(segundos(O("paso 2", "time kubectl -n classifier rollout status")))
CARGA5 = O("paso 5", "cat ")
N5 = num(CARGA5, r"^(\d+) fotos en", "?")
OK5 = num(CARGA5, r"· 200: (\d+)", "?")
P99_5 = num(CARGA5, r"p99 (\d+) ms", "?")
ROLL5_S = round(segundos(O("paso 5", "time kubectl -n classifier rollout status")), 1)
DEADLINE_S = round(segundos(O("paso 6", "time kubectl -n classifier rollout status")))
REVERT_S = segundos(O("paso 6", "time kubectl -n classifier rollout status", 1))
DRAIN_B_CMD = S("paso 7", "time kubectl drain")[0]
NODO_B = num(DRAIN_B_CMD, r"drain (\S+)", "dojo-k8s-worker5")
DRAIN_A = O("paso 7", "grep -v '^Warning'")
NODO_A = num(DRAIN_A, r"node/(\S+) cordoned", "dojo-k8s-worker4")
DRAIN_B = O("paso 7", "time kubectl drain")
REINTENTOS = DRAIN_B.count("will retry after")
DRAIN_B_S = round(segundos(DRAIN_B))
TR_DESPUES = O("paso 7", "kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=triton")
NODOS_DESPUES = re.findall(r"^triton-\S+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+(\S+)", TR_DESPUES, re.M)


def apodo(n):
    return APODO.get(n, (n, "?"))[0]


def zona(n):
    return APODO.get(n, (n, "?"))[1]


# El paso 8: cada lectura es «hpa» + «top» a los ≈ 30, 60… s del pico.
LECTURAS = []
for i in range(6):
    c, o = S("paso 8", "kubectl -n classifier get hpa gateway --no-headers", i)
    m = re.search(r"cpu: (\d+)%/60%\s+3\s+12\s+(\d+)", o)
    ms = [int(x) for x in re.findall(r"^gateway-\S+\s+(\d+)m\s+\d+Mi", o, re.M)]
    if m:
        LECTURAS.append(dict(util=int(m.group(1)), reps=int(m.group(2)), m=ms))
CARGA8 = O("paso 8", "cat ")
POR_S8 = int(float(num(CARGA8, r"carga: ([\d.]+) fotos/s", "60")))
N8 = num(CARGA8, r"^(\d+) fotos en", "?")
P99_8 = num(CARGA8, r"p99 (\d+) ms", "?")
REPS_MAX = max([x["reps"] for x in LECTURAS], default=0)
# La regla de tres: la primera lectura que pide más pods (fuera de la tolerancia) y la que le sigue.
R3 = next(((x, LECTURAS[i + 1]) for i, x in enumerate(LECTURAS[:-1]) if x["util"] > 66), None)
if R3:
    _x, _sig = R3
    R3_DES = min(12, math.ceil(_x["reps"] * _x["util"] / 60))
    R3_TXT = f"{_x['reps']} pods al {_x['util']} % → ⌈{_x['reps']} × {_x['util']} ÷ 60⌉ = ⌈{_x['reps'] * _x['util'] / 60:.2f}⌉"
    R3_VAL = f"{R3_DES} pods" + (f"; en la lectura siguiente ya eran {_sig['reps']}" if _sig else "")
else:
    R3_DES, R3_TXT, R3_VAL = None, falta("una lectura del HPA arriba del 66 % en el paso 8"), "?"
# La CPU por foto: la lectura con más CPU entre todos los gateways (el pico ya repartido).
_pico = max(LECTURAS, key=lambda x: sum(x["m"]), default=None)
CPU8_M = sum(_pico["m"]) if _pico else 0
MS_FOTO = round(CPU8_M / POR_S8) if POR_S8 else 0
NUCLEOS_500 = 500 * MS_FOTO / 1000
GW_500 = math.ceil(NUCLEOS_500 / 0.6) if MS_FOTO else 0
PODS8 = O("paso 8", "kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=gateway")
PENDING8 = len(re.findall(r"\sPending\s", PODS8))
N_ERR8 = sum(int(x) for x in re.findall(r"· 50\d: (\d+)", CARGA8))
N_ERR8_TARDE = sum(int(x) for t, resto in re.findall(r"t =\s+(\d+) s (.*)", CARGA8) if int(t) > 60
                   for x in re.findall(r"50\d:(\d+)", resto))

e = {
    "id": "kubernetes", "patron": "sincrono", "caso": "c01", "num": 9,
    "titulo": "Kubernetes", "nav": "Kubernetes",
    "pregunta": "Las dos imágenes ya están en el registro, por digest. ¿Qué le dices al clúster para que Triton tenga siempre una T4 en cada zona, para que los gateways crezcan solos en un pico y para que cambiar de versión o vaciar un nodo no corte ni una foto?",
    "version": "2026-11-18",
}

e["mapa"] = {
    "resumen": "La estación 8 dejó las dos imágenes en el registro, por digest, y un repositorio de despliegue que dice cuál corre. Falta lo que las convierte en un servicio que aguanta: los <b>manifiestos</b> de Kubernetes. En ellos describes lo que quieres (2 Tritons, cada uno con una T4 y en una zona distinta; de 3 a 12 gateways en nodos de CPU, detrás del balanceador) y el clúster lo hace cumplir sin parar: pone cada pod donde cabe, lo reinicia si muere, lo saca del reparto si no está listo, cambia de versión sin bajar de capacidad, protege a Triton del mantenimiento con un <b>PDB</b> y agrega gateways con el <b>HPA</b> cuando sube la CPU.",
    "entra": [
        "las dos imágenes por digest en el registro (<code>classifier-gateway</code> y <code>classifier-triton</code>), publicadas por el CI de la estación 8",
        "el repositorio de despliegue (<code>k8s/</code>), con la <code>kustomization.yaml</code> donde el CI escribe los digests",
        "un clúster con nodos de CPU y nodos con una T4, en dos zonas, que prepara el equipo de plataforma",
        "los números de la empresa: lo que pide cada pod, cuánto tarda en arrancar y cuánto en apagarse",
    ],
    "sale": [
        "2 Tritons listos, cada uno con su T4, uno por zona, con sus tres probes y su apagado ordenado",
        "de 3 a 12 gateways en nodos de CPU detrás del balanceador, con un HPA que apunta al 60 % de su CPU",
        "un PDB que deja vaciar un nodo de T4 a la vez, nunca los dos",
        "cambios de versión sin perder capacidad, y una vuelta atrás que es un <code>git revert</code>",
    ],
    "escala": [
        {"que": "El clúster", "c01": "EKS (el Kubernetes que opera AWS) 1.35 en <code>us-east-1</code>: US$0.10 la hora por el plano de control (≈ US$73 al mes); el soporte estándar de la 1.35 acaba el 27 de marzo de 2027 y después cuesta US$0.60 la hora", "taller": "kind (Kubernetes dentro de Docker) con Kubernetes 1.35.5 en tu Mac: un plano de control y 6 nodos, cada uno un contenedor"},
        {"que": "Los nodos de CPU", "c01": "<code>c6i.xlarge</code> de 4 vCPU: 2 en un día normal y hasta 4 con Karpenter", "taller": "cpu-a y cpu-b, con 4 CPU asignables cada uno (de los núcleos de tu Mac se reservan los demás); sin Karpenter"},
        {"que": "Las GPU", "c01": "<code>g4dn.xlarge</code> con una T4 (US$0.526 la hora), de 2 a 4 según KEDA; tope de 6 GPU", "taller": "t4-a1, t4-a2, t4-b1 y t4-b2: cada uno anuncia <code>nvidia.com/gpu: 1</code>, puesto a mano; Triton corre en la CPU"},
        {"que": "La entrada del tráfico", "c01": "un Ingress que el AWS Load Balancer Controller convierte en un ALB interno", "taller": "un Service NodePort (30901) que kind publica en tu Mac como <code>localhost:8901</code>"},
        {"que": "Quién aplica los manifiestos", "c01": "Argo CD, que compara el repositorio de despliegue con el clúster y aplica la diferencia", "taller": "tú, con <code>kubectl apply -k k8s/</code> después de cada commit"},
        {"que": "Cuántos pods", "c01": "gateway: HPA de 3 a 12 al 60 % de CPU · Triton: KEDA de 2 a 4, por la espera en su fila", "taller": "gateway: el mismo HPA (aunque solo caben 6) · Triton: 2 fijos, sin KEDA"},
        {"que": "El arranque de Triton", "c01": "engine de ≈ 10 a 60 s; startup de 5 s × 60 = 300 s; <code>progressDeadlineSeconds</code> de 900", "taller": f"engine de ≈ {ENGINE_S} s; startup de 5 s × 12 = 60 s; <code>progressDeadlineSeconds</code> de 300"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-kubernetes",
}

e["precalculos"] = {
    "intro": "Antes de escribir un solo manifiesto, las cuentas de servilleta: cuántos gateways caben en un nodo, cuánto tiempo le das a Triton para arrancar y para apagarse, cuántas T4 pide un cambio de versión, cuántos gateways va a pedir el HPA en un pico y cuánta CPU cuesta una foto. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "gateways-por-nodo", "pregunta": "¿Cuántos gateways caben en un nodo de CPU, y cuántos nodos hacen falta en el máximo?",
            "formula": "por nodo = ⌊(CPU asignable del nodo − requests que ya tiene) ÷ request de CPU de un gateway⌋ · nodos = ⌈gateways ÷ por nodo⌉",
            "c01": {"cuenta": "<code>c6i.xlarge</code>: 4 vCPU, menos lo que se quedan el sistema y los pods que van en cada nodo (la red, kube-proxy): un poco menos de 4 → ⌊3.x ÷ 1⌋ = 3; con 12 gateways, ⌈12 ÷ 3⌉", "valor": "3 por nodo · 4 nodos en el máximo"},
            "taller": {"cuenta": f"4 CPU asignables (paso 1) − {SIS_M}m que ya reservan los pods del sistema en cpu-a → ⌊{(4000 - SIS_M) / 1000:g} ÷ 1⌋; hay 2 nodos de CPU", "valor": "3 por nodo · 6 gateways como mucho en todo el dojo"},
            "decide": "Que lo que decide dónde cabe un pod es su <b>request</b>, no lo que usa: un gateway en reposo usa una décima de núcleo y aun así ocupa un núcleo entero en la cuenta del scheduler. Y que en el dojo el HPA puede pedir hasta 12, pero solo caben 6: sin Karpenter, el séptimo se queda Pending. En C01, ese Pending es justo la señal con la que Karpenter pide otra <code>c6i.xlarge</code>.",
            "conceptos": ["requests-limits-qos", "cluster-namespace"],
            "comprueba": C("paso 1", "kubectl describe node dojo-k8s-worker |", nota="Requests: lo apartado en el nodo. Limits: los techos (pueden pasar de 100 %)."),
            "confirma": f"el paso 4: con un gateway en cpu-a, sus requests de CPU pasan de {SIS_M}m a {GW1_M}m. Y el paso 8: en el pico, {REPS_MAX} gateways, 3 en cada nodo de CPU, y ni uno más.",
        },
        {
            "id": "presupuesto-startup", "pregunta": "¿Cuánto tiempo le das a Triton para arrancar antes de que el kubelet lo mate?",
            "formula": "presupuesto = periodSeconds × failureThreshold de la startup probe; al menos 1.5 veces lo que tarda en cargar el engine (aquí, 3 veces)",
            "c01": {"cuenta": "engine de ≈ 10 a 60 s (según el equipo); startup de 5 s × 60", "valor": "300 s: 5 veces el arranque más lento"},
            "taller": {"cuenta": f"el engine tarda ≈ {ENGINE_S} s (el log del paso 3); × 3 = 60 s → 5 s × 12", "valor": "60 s"},
            "decide": "Cuánto aguanta un engine más lento antes de que lo maten. Sin startup, la liveness preguntaría desde el segundo 0 y reiniciaría a Triton a la mitad de la carga, una y otra vez. Con una startup justa, el primer engine un poco más grande nunca termina de arrancar: es una de las fallas de Romper.",
            "conceptos": ["probes", "crashloopbackoff"],
            "comprueba": C("paso 3", "kubectl -n classifier logs", nota="De «deserializando» a «warmup»: lo que de verdad tarda en cargar el engine."),
            "confirma": f"el paso 3: «Startup probe failed … connection refused» (×{STARTUP_X}) mientras carga, y el despliegue de los dos Tritons terminó en ≈ {TRITON_S} s.",
        },
        {
            "id": "plazo-de-gracia", "pregunta": "¿Cuánto plazo de gracia necesita cada pod para apagarse sin cortar fotos?",
            "formula": "gracia ≥ preStop + drenado + margen: el plazo cuenta desde que el pod se marca «terminando», con el preStop adentro",
            "c01": {"cuenta": "Triton: 10 (preStop) + 30 (<code>--exit-timeout-secs</code>) + 20 · gateway: 15 (preStop) + 20 (el drenado de uvicorn) + 10", "valor": "60 s y 45 s"},
            "taller": {"cuenta": "los mismos números: Triton 10 + 30 + 20 · gateway 15 + 20 + 10", "valor": "60 s y 45 s"},
            "decide": "Que el preStop dé tiempo a que el balanceador deje de mandar fotos ANTES de que llegue SIGTERM, y que la gracia alcance para todo. Si alguien sube el drenado a 40 s sin subir la gracia, el pod recibe SIGKILL a la mitad, con fotos en vuelo. El gateway espera más que Triton porque el ALB tarda más en sacarlo que el Service en sacar a Triton.",
            "conceptos": ["apagado-ordenado"],
            "comprueba": cmd(f"{V}   # la línea de apagado", O("final", V, filtro=r"apagado"), "verificar.py lee el preStop y la gracia de lo que corre en el clúster."),
            "confirma": f"el paso 5: {N5} fotos durante un cambio de versión de los tres gateways, {OK5} en 200: los viejos salieron del reparto antes de apagarse.",
        },
        {
            "id": "t4-de-sobra", "pregunta": "¿Cuántas T4 hacen falta para cambiar de versión, o vaciar un nodo, sin quedarte nunca con un solo Triton?",
            "formula": "T4 a la vez = réplicas + maxSurge; y como hay un Triton por zona, el de más tiene que caber en la zona del que se va",
            "c01": {"cuenta": "2 + 1 = 3 T4 durante el despliegue; con KEDA en 4, 4 + 1 = 5, más la de staging: tope de 6 en Karpenter. La T4 de más vive ≈ 15 min: 0.526 × 0.25", "valor": "3 a 6 T4 · ≈ US$0.13 por despliegue"},
            "taller": {"cuenta": "2 Tritons, uno por zona, y 2 nodos de T4 por zona: en cada zona queda una T4 libre", "valor": "4 nodos de T4: el reemplazo siempre tiene dónde caer en su zona"},
            "decide": "Por qué <code>maxUnavailable: 0</code> y <code>maxSurge: 1</code> en Triton: nunca bajas de 2 listos, a cambio de una T4 de más unos minutos. Si esa T4 no aparece (en C01, AWS sin <code>g4dn.xlarge</code> libres en la zona), el pod nuevo se queda Pending y nadie toca a los viejos: el despliegue se queda a medias, sin perder nada.",
            "conceptos": ["rolling-update", "topology-spread"],
            "comprueba": C("paso 7", "kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=triton", nota="Después de vaciar dos nodos de T4, uno de cada zona."),
            "confirma": (f"el paso 7: se vaciaron {apodo(NODO_A)} ({zona(NODO_A)}) y {apodo(NODO_B)} ({zona(NODO_B)}), y los Tritons "
                         f"volvieron en {' y '.join(apodo(n) + ' (' + zona(n) + ')' for n in NODOS_DESPUES)}: la T4 libre de cada zona."),
        },
        {
            "id": "regla-de-tres-hpa", "pregunta": "¿Cuántos gateways va a pedir el HPA en un pico?",
            "formula": "deseados = ⌈pods ahora × CPU actual ÷ CPU objetivo⌉, con la CPU como % del request; recortado entre 3 y 12; no se mueve si la razón está a 10 % o menos de 1",
            "c01": {"cuenta": "5 pods al 90 % → ⌈5 × 90 ÷ 60⌉ = ⌈7.5⌉; ya con 8, la misma carga da 56 % (56 ÷ 60 ≈ 0.94, dentro de la tolerancia)", "valor": "8 pods, y ahí se queda"},
            "taller": {"cuenta": f"paso 8, con {POR_S8} fotos de 12 MP por segundo: {R3_TXT}", "valor": R3_VAL + (" (en el dojo caben 6)" if (R3_DES or 0) > 6 else "")},
            "decide": "Que el HPA es una regla de tres con redondeo hacia arriba, sobre el <b>request</b>: con un request de 1 núcleo y objetivo de 60 %, quiere ≈ 0.6 núcleos por pod. Sin request no puede dividir y no hace nada. Y que sube rápido (por omisión, el doble o 4 pods más cada 15 s) y baja despacio (5 min de calma y 1 pod por minuto).",
            "conceptos": ["hpa-metrics-server"],
            "confirma": f"el paso 8: el HPA pasó de 3 a {REPS_MAX} gateways en el pico (justo los que caben en los dos nodos de CPU)" + (f", y {PENDING8} se quedaron Pending porque ya no cabían" if PENDING8 else "") + ".",
        },
        {
            "id": "cpu-por-foto", "pregunta": "¿Cuánta CPU del gateway cuesta una foto, y por qué importa que la app la reduzca antes de subirla?",
            "formula": "ms de CPU por foto = milinúcleos de todos los gateways ÷ fotos por segundo (1 núcleo = 1,000 m = 1,000 ms de CPU cada segundo)",
            "c01": {"cuenta": "lo que presupuesta el diseño: 5 gateways al 60 % de 1 núcleo = 3 núcleos = 3,000 ms de CPU por segundo, para el pico de 500 fotos por segundo ya reducidas por la app (≈ 200 KB): 3,000 ÷ 500", "valor": "≈ 6 ms de CPU por foto"},
            "taller": {"cuenta": f"paso 8: {CPU8_M} m entre los gateways con {POR_S8} fotos de 12 MP (4,000 × 3,000 px, sin reducir) por segundo: {CPU8_M} ÷ {POR_S8}", "valor": f"≈ {MS_FOTO} ms de CPU por foto de 12 MP"},
            "decide": f"Si la app dejara de reducir las fotos, el pico de 500 por segundo pediría 500 × {MS_FOTO} ms = {NUCLEOS_500:,.1f} núcleos: ⌈{NUCLEOS_500:,.1f} ÷ 0.6⌉ = {GW_500} gateways al 60 %, contra un tope de 12. El tope del HPA no es un número al azar: sale de la foto que llega. (Los milinúcleos de <code>kubectl top</code> miden el decode en tu Mac, no en una <code>c6i</code>: la cuenta vale para comparar, no al milisegundo.)",
            "conceptos": ["hpa-metrics-server", "requests-limits-qos"],
            "confirma": "el paso 8: cada lectura de <code>kubectl top</code> da los milinúcleos de cada gateway; súmalos y divídelos entre las fotos por segundo.",
        },
    ],
}

K = []


def concepto(id_, termino, en, def_, analogia, importa, trampa):
    K.append(dict(id=id_, termino=termino, en=en, def_=def_, analogia=analogia, importa=importa, trampa=trampa))


concepto("cluster-namespace", "Clúster, nodo y namespace", "cluster / node / control plane / kubelet / namespace",
         "Un clúster es un grupo de máquinas (nodos) que manda un plano de control. En cada nodo, el kubelet arranca lo que le toca. Un namespace es un apartado con nombre dentro del clúster: aquí, <code>classifier</code>.",
         "Un hotel: la recepción (el plano de control) decide qué huésped va a qué cuarto; en cada piso, una camarista (el kubelet) prepara los cuartos; y cada empresa que se hospeda tiene su ala con su nombre (el namespace).",
         "No le dices al clúster «arranca esto en el nodo 3»: le describes lo que quieres y sus controladores comparan sin parar lo que hay con lo que pediste y corrigen la diferencia (reconciliar). Por eso todo comando lleva <code>-n classifier</code>.",
         "Olvidar el <code>-n classifier</code>: <code>kubectl get pods</code> mira el namespace <code>default</code>, que está vacío, y parece que no corre nada.")
concepto("pod", "Pod", "pod",
         "La unidad mínima que Kubernetes arranca: uno o más contenedores que comparten red (una IP) y volúmenes, y que siempre viven juntos en el mismo nodo. Aquí, un pod = un contenedor de Triton o del gateway.",
         "Un departamento amueblado: lo que va adentro (los contenedores) comparte la dirección y la cocina, y si se cambian, se cambian todos juntos.",
         "Es lo que se agenda, se reinicia, recibe tráfico y se apaga. Un pod no se «arregla»: si se rompe, se reemplaza por otro con otro nombre y otra IP. Por eso nadie le habla a un pod por su IP, sino a un Service.",
         "Crear pods sueltos a mano: si el nodo se cae, nadie los vuelve a crear. Los pods siempre los crea un controlador (un Deployment).")
concepto("deployment-replicaset", "Deployment y ReplicaSet", "Deployment / ReplicaSet",
         "Un Deployment dice «quiero N pods con esta plantilla». Crea un ReplicaSet por cada versión de la plantilla, y el ReplicaSet mantiene vivos sus N pods: si uno muere, crea otro.",
         "Un gerente (Deployment) con un supervisor por turno (ReplicaSet): el supervisor cuida que estén sus N empleados; al cambiar de uniforme, el gerente abre un turno nuevo y va pasando gente de uno al otro.",
         "Cambiar la imagen, una probe o los recursos crea un ReplicaSet nuevo; el viejo se queda en 0 réplicas (<code>revisionHistoryLimit: 5</code> guarda 5). Cambiar solo el número de réplicas no crea nada nuevo.",
         "Escribir <code>replicas</code> en un Deployment que escala el HPA: cada <code>apply</code> regresa el número y pelea con el autoscaler. En el gateway no va.")
concepto("kustomize-digest", "kustomize y la imagen por digest", "kustomize / images / configMapGenerator",
         "kustomize arma <code>k8s/</code> antes de aplicarlo (<code>kubectl apply -k</code>): pone el namespace, cambia «classifier-triton» por el registro y el digest que escribió el CI y genera el ConfigMap del modelo.",
         "Una plantilla de carta con campos: tú escribes la carta; la secretaria (kustomize) llena el destinatario y la fecha justo antes de mandarla.",
         "Tú nunca escribes un digest a mano: lo escribe el CI en <code>kustomization.yaml</code> y lo que aplicas es exactamente lo que se probó. El ConfigMap lleva una huella en el nombre: si cambia <code>modelo.json</code>, cambia el nombre y los pods se reemplazan.",
         "<code>kubectl apply -f triton.yaml</code> sin <code>-k</code>: la imagen queda como «classifier-triton» a secas (no existe: ErrImagePull) y los objetos caen en el namespace <code>default</code>.")
concepto("requests-limits-qos", "Requests, limits y clase de QoS", "resource requests / limits / QoS class",
         "El request es una reserva: el scheduler pone el pod solo donde cabe la suma de requests. El limit es un techo que hace cumplir el kernel. Con ambos, el pod recibe una clase: Guaranteed, Burstable o BestEffort.",
         "Reservar mesa en un restaurante: la reservación (request) te asegura el lugar aunque llegues tarde; el límite de consumo (limit) es lo más que te dejan pedir.",
         "Request de CPU sí (con él se agenda y escala), límite de CPU no (solo frena); memoria con techo igual al request. Así ambos pods son Burstable. Un pod que solo pide <code>nvidia.com/gpu</code> es BestEffort: la clase solo mira CPU y memoria, y sale primero si falta memoria.",
         "Dimensionar con <code>kubectl top</code> en reposo: mide la mediana, y el pod muere en su peor momento.")
concepto("throttling", "Throttling de CPU", "CPU throttling / CFS quota",
         "Con un límite de CPU, el kernel da al contenedor una cuota por periodo de 100 ms (límite de 1 núcleo = 100 ms de CPU por periodo, sumando todos sus hilos). Si la gasta antes, lo congela hasta el siguiente periodo.",
         "Un plan de datos que se corta a media película: el celular sirve, la red está libre, pero tu cuota del mes ya se acabó y esperas al corte.",
         "Con 4 decodes de 40 ms y límite de 1 núcleo, la cuota se acaba a los 25 ms y cada foto tarda 115 ms en vez de 40, con el nodo medio vacío. Por eso el gateway y Triton no llevan límite de CPU: la CPU que no usan queda para otros.",
         "Poner límite de CPU «por orden»: el freno aparece justo en los picos, cuando más importa la latencia, y no se ve en el uso promedio.")
concepto("oomkilled", "OOMKilled", "out of memory / OOMKilled / exit code 137",
         "Si un contenedor pasa su techo de memoria, el kernel lo mata en el acto con SIGKILL. Kubernetes lo reporta como <code>OOMKilled</code>, código de salida 137 (128 + 9, la señal 9), y lo vuelve a arrancar.",
         "Un vaso que se llena de más: la CPU de más es esperar tu turno; la memoria de más es derramarse, y no hay forma de «devolverla después».",
         "El techo de memoria del gateway (1 GiB) sale de su peor momento: 2 decodes de fotos grandes × ≈ 320 MB + ≈ 80 MB de Python + 16 requests en vuelo × ≈ 10 MB ≈ 880 MB. Mejor que muera este pod con un error claro a que el nodo se quede sin memoria y el kernel elija a quién matar.",
         "Buscar el error en los logs del programa: un OOMKilled no deja mensaje; está en <code>kubectl describe pod</code>, en Last State.")
concepto("probes", "Las tres probes: startup, readiness y liveness", "startup / readiness / liveness probes",
         "Preguntas que el kubelet le hace al contenedor cada cierto tiempo, casi siempre un GET HTTP (200 a 399 = pasó). Startup: ¿ya arrancaste? Readiness: ¿te mando tráfico? Liveness: ¿sigues vivo, o te reinicio?",
         "Un empleado nuevo: la startup es su periodo de capacitación (nadie le pide resultados todavía); la readiness, si hoy puede atender clientes; la liveness, si sigue respirando.",
         "Mientras la startup no pasa, las otras dos no corren. Si falla la readiness, el pod sale del reparto sin reiniciarse; si falla la liveness, se reinicia. Por eso la liveness pregunta solo por el propio proceso (<code>/healthz</code>, <code>/v2/health/live</code>), nunca por Triton.",
         "Una dependencia en la liveness: si Triton cae, se reinician todos los gateways a la vez y nada se arregla.")
concepto("crashloopbackoff", "CrashLoopBackOff e ImagePullBackOff", "back-off restart / image pull back-off",
         "Cuando un contenedor muere una y otra vez, el kubelet espera cada vez más antes de volver a arrancarlo: 10 s, 20 s, 40 s… hasta 5 min. Si lo que falla es bajar la imagen, la espera crece igual (ImagePullBackOff).",
         "Volver a marcar a alguien que no contesta: al principio a los pocos segundos, luego cada vez más espaciado, para no saturar la línea.",
         "Es un estado, no una causa: el porqué está en <code>kubectl logs &lt;pod&gt; --previous</code> (lo que escribió antes de morir) y en Last State de <code>kubectl describe pod</code> (OOMKilled, código 1, una probe). La columna RESTARTS cuenta los intentos.",
         "Esperar a que «se arregle solo»: el backoff solo espacia los intentos; si la causa sigue, el pod muere igual cada vez.")
concepto("service-endpointslice", "Service y EndpointSlice", "Service / EndpointSlice / label selector",
         "Un Service es un nombre y una IP fijos que reparten el tráfico entre los pods que encuentra su selector (por etiquetas). La lista de pods detrás, con su IP y si están listos, vive en sus EndpointSlices.",
         "El conmutador de una empresa: marcas un solo número (el Service) y te pasa con quien esté disponible; la lista de extensiones activas (el EndpointSlice) se actualiza sola.",
         "El gateway habla con <code>triton:8000</code>, no con la IP de un pod. Un pod que no pasa su readiness, o que se está apagando, sigue en el EndpointSlice pero con <code>ready=false</code>, y no recibe tráfico nuevo.",
         "Cambiar las etiquetas de los pods o el selector del Service sin cambiar el otro: el Service no encuentra a nadie, su EndpointSlice queda vacío y los pods sanos no reciben nada.")
concepto("nodeport-ingress", "NodePort, Ingress y el ALB", "Service type NodePort / Ingress / AWS Load Balancer Controller",
         "Para que el tráfico entre desde fuera del clúster: un Service NodePort abre el mismo puerto (30000 a 32767) en todos los nodos; un Ingress describe la entrada y un controlador crea el balanceador real (en AWS, un ALB).",
         "La entrada de un edificio: NodePort es abrir la misma puerta lateral en cada piso; un Ingress es contratar una recepción en la entrada principal que reparte a los visitantes.",
         "En el dojo, el NodePort 30901 se publica en tu Mac como <code>localhost:8901</code>: hace de «ALB interno». En C01, el Ingress del gateway lo lee el AWS Load Balancer Controller y arma el ALB, que manda directo a la IP de cada pod listo.",
         "Creer que el NodePort es lo que se usa en producción en AWS: ahí la entrada es el ALB, y el preStop del gateway espera más (15 s) porque el ALB tarda más en sacarlo que un Service.")
concepto("apagado-ordenado", "Apagado ordenado", "graceful shutdown / preStop / SIGTERM / terminationGracePeriodSeconds",
         "Al apagar un pod: se marca «terminando» y sale del reparto, corre el <code>preStop</code>, llega SIGTERM y el programa acaba lo que tiene. Al vencer el plazo de gracia, contado desde el inicio, llega SIGKILL.",
         "Cerrar una tienda: primero se voltea el letrero (nadie nuevo entra), luego se espera a que el aviso llegue a todos, y al final se atiende a los que ya están adentro antes de apagar la luz.",
         "El balanceador tarda unos segundos en enterarse de que el pod se va: el <code>preStop</code> (un <code>sleep</code>) espera eso antes de SIGTERM. Así un cambio de versión no corta fotos. Si el preStop sigue corriendo al vencer la gracia, Kubernetes da 2 s más, una sola vez.",
         "Sumar mal: la gracia incluye el preStop. Con preStop de 15 s, 20 s de drenado y una gracia de 30 s, el programa recibe SIGKILL a la mitad del drenado.")
concepto("rolling-update", "Rolling update", "RollingUpdate / maxSurge / maxUnavailable / progressDeadlineSeconds / rollout undo",
         "Cómo cambia de versión un Deployment: sube pods del ReplicaSet nuevo y baja del viejo, poco a poco. <code>maxSurge</code>: cuántos de más puede haber; <code>maxUnavailable</code>: cuántos de menos (no listos) acepta.",
         "Cambiar las llantas de un camión de 18 ruedas sin detenerlo: pones una de refacción, quitas una vieja, y nunca rueda con menos de las que necesita.",
         "Con <code>maxSurge: 1</code> y <code>maxUnavailable: 0</code> nunca bajas de capacidad. <code>progressDeadlineSeconds</code> (600 por omisión) es cuánto esperar sin avance: al vencer, el Deployment marca <code>ProgressDeadlineExceeded</code> y NO regresa solo. Volver atrás es un <code>git revert</code>; <code>kubectl rollout undo</code> solo en una emergencia.",
         "<code>kubectl rollout undo</code> como rollback normal: el clúster corre la versión vieja pero git sigue diciendo la nueva, y el siguiente <code>apply</code> (o Argo CD) la vuelve a poner.")
concepto("nodeselector-taints", "nodeSelector, taints y tolerations", "nodeSelector / taint / toleration",
         "Un <code>nodeSelector</code> atrae: el pod solo va a nodos con cierta etiqueta (<code>workload: gpu-t4</code>). Un taint en el nodo repele a todos los pods; una toleration en el pod le deja entrar a pesar del taint.",
         "Un estudio de grabación: la etiqueta es la dirección (el músico la busca), el taint es el guardia de la puerta y la toleration es el pase. Tener el pase no te lleva al estudio: necesitas las dos cosas.",
         "Triton lleva las dos: va solo a las T4 y aguanta su taint. El gateway no lleva toleration, así que nunca cae en una T4 (una máquina de US$0.526 la hora ocupada por un pod de CPU). Con una etiqueta mal escrita, el pod se queda Pending para siempre: ningún nodo la tiene.",
         "Poner solo la toleration: el pod puede caer en cualquier nodo, con o sin taint.")
concepto("gpu-device-plugin", "La GPU como recurso", "extended resource nvidia.com/gpu / NVIDIA device plugin",
         "Kubernetes solo sabe contar CPU, memoria y disco. El device plugin de NVIDIA (un DaemonSet: un pod en cada nodo con GPU) le avisa al kubelet cuántas GPU hay, y el nodo ofrece <code>nvidia.com/gpu: 1</code>.",
         "Un estacionamiento que solo cuenta cajones de auto: alguien tiene que poner el letrero «aquí hay 1 cajón para camión» para que el acomodador sepa que existe.",
         "Se pide en enteros (1, nunca 0.5), sin compartir y sin sobreventa: dos pods no reciben la misma T4. Si el plugin falta, el nodo «no tiene GPU» y Triton se queda Pending aunque la T4 esté ahí. En el dojo el recurso se anuncia a mano y Triton corre en la CPU.",
         "Pedir solo la GPU y olvidar CPU y memoria: el pod queda BestEffort, sin reserva de CPU, y es el primero que sale si falta memoria.")
concepto("topology-spread", "Reparto por zona", "topologySpreadConstraints / maxSkew / matchLabelKeys",
         "Una regla para el scheduler: entre zonas, como mucho <code>maxSkew</code> pods de diferencia. Con <code>DoNotSchedule</code> prefiere dejar el pod Pending; con <code>ScheduleAnyway</code>, reparte si puede.",
         "Repartir huevos en dos canastas: si se cae una, no pierdes todos. Y prefieres esperar otra canasta a meter dos huevos en la misma.",
         "Dos Tritons en la misma zona dejarían a la empresa sin GPU si esa zona cae; por eso <code>DoNotSchedule</code>. <code>matchLabelKeys: [pod-template-hash]</code> (beta, prendido por omisión desde 1.27) cuenta solo los pods de la misma versión; sin él, después de un cambio de versión pueden quedar dos en una zona.",
         "<code>DoNotSchedule</code> en el gateway: un gateway de más en la zona equivocada cuesta poco, y quedarse Pending en un pico cuesta mucho. Ahí va <code>ScheduleAnyway</code>.")
concepto("pdb-drain", "PDB, cordon y drain", "PodDisruptionBudget / kubectl cordon / kubectl drain",
         "<code>cordon</code> cierra un nodo a pods nuevos; <code>drain</code> además desaloja los suyos. Un PDB es el mínimo de pods que nadie saca a propósito: si un desalojo lo rompería, se rechaza y drain reintenta.",
         "El turno mínimo de un hospital: puedes mandar a capacitación a quien quieras, pero nunca dejar la guardia con menos de un médico.",
         "Con 2 Tritons y <code>minAvailable: 1</code>, se vacía un nodo de T4 a la vez: el segundo drain espera a que el reemplazo del primero esté listo. El PDB solo cubre lo voluntario: un nodo que muere no pide permiso.",
         "<code>minAvailable: 2</code> con 2 réplicas: ningún drain avanza nunca y la actualización de nodos se traba.")
concepto("hpa-metrics-server", "HPA y metrics-server", "HorizontalPodAutoscaler / metrics-server",
         "El HPA mira cada 15 s una métrica (aquí, la CPU como % del request, que da metrics-server) y calcula cuántos pods deberían ser: ⌈pods × actual ÷ objetivo⌉, entre su mínimo y su máximo.",
         "El termostato de un salón: mide la temperatura promedio y prende o apaga ventiladores para dejarla en el objetivo; prende rápido y apaga despacio.",
         "Por omisión sube sin esperar (el doble o 4 pods más, lo que sea mayor, cada 15 s) y baja tras 5 min de calma; el gateway baja además 1 pod por minuto. Solo agrega pods si caben: si los nodos están llenos, quedan Pending.",
         "Quitar el request de CPU: el HPA ya no tiene contra qué dividir, se queda en <code>&lt;unknown&gt;</code> («missing request for cpu») y no sube en el pico.")
for k in K:
    k["def"] = k.pop("def_")
e["conceptos"] = [{k: c[k] for k in ("id", "termino", "en", "def", "analogia", "importa", "trampa")} for c in K]

e["mundo"] = {
    "resumen": "El kit trae el clúster de C01 en chico, de verdad: Kubernetes 1.35 en kind, con dos nodos de CPU y cuatro nodos que anuncian una T4, en dos zonas, con su taint; metrics-server; un registro con las imágenes que publicó el CI de la estación 8 (el gateway de hoy, el de la semana que entra y uno que no arranca; Triton con su modelo de juguete y uno con un engine más lento); y esta carpeta como el repositorio de despliegue, con lo que dejó el equipo de plataforma. Faltan tus cuatro manifiestos.",
    "trae": [
        {"que": "mundo/crear.py y mundo/kind.yaml", "detalle": f"Crea todo en ≈ {CREAR_S} s (≈ 3 min la primera vez, que baja ≈ 1.3 GB): el registro en <code>localhost:5900</code>, el clúster <code>dojo-k8s</code> (un plano de control y 6 nodos), sus etiquetas de zona y de tipo, las T4 con su taint, metrics-server, las imágenes y el repositorio de despliegue. La llave queda en <code>.kube/config</code>: tu <code>~/.kube/config</code> no se toca."},
        {"que": "k8s/kustomization.yaml, namespace.yaml y modelo.json", "detalle": "Del equipo de plataforma (y del CI, que escribe los digests): qué se aplica, el namespace <code>classifier</code> y los labels del modelo como ConfigMap. Se cambian solo con <code>mundo/publicar.py</code> o con un <code>git revert</code>."},
        {"que": "mundo/publicar.py", "detalle": "El último paso del CI de la estación 8: escribe el digest de una imagen publicada en <code>kustomization.yaml</code> y hace commit. No aplica nada: eso lo haces tú."},
        {"que": "mundo/carga.py", "detalle": "Manda fotos por el «ALB» (<code>localhost:8901</code>) a un ritmo fijo, aunque las anteriores no hayan vuelto, y cuenta lo que regresa por código HTTP, con p50 y p99. Con <code>--12mp</code>, la foto tal como sale del celular."},
        {"que": "mundo/cluster.py", "detalle": "<code>estado</code>: cada nodo con su apodo, zona, T4 y pods; y el registro. También apaga y prende el clúster para liberar la memoria de tu Mac."},
        {"que": "gateway/, mundo/triton_dojo/ y mundo/triton/", "detalle": "El gateway de la estación 6 y el Triton del dojo con su modelo de juguete, ya construidos y publicados. Aquí no se toca el código: se despliega."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks con los criterios de «listo», contra lo que corre en el clúster, y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "k8s/triton.yaml", "hace": "El Deployment y el Service de Triton: 2 pods con una T4 cada uno, uno por zona, sus recursos, sus tres probes, su apagado ordenado y su cambio de versión sin bajar de 2 listos."},
        {"archivo": "k8s/gateway.yaml", "hace": "El Deployment y el Service NodePort del gateway: en nodos de CPU, sin réplicas fijas, con su readiness y su liveness, su apagado y su plazo para cambiar de versión."},
        {"archivo": "k8s/pdb.yaml", "hace": "El PodDisruptionBudget de Triton: siempre queda al menos uno."},
        {"archivo": "k8s/hpa.yaml", "hace": "El HPA del gateway: de 3 a 12, al 60 % de su CPU, y bajando despacio."},
    ],
    "requisitos": [
        "Docker Desktop con al menos 6 CPU y 8 GiB de memoria (Settings → Resources)",
        "kind y kubectl: <code>brew install kind kubectl</code> (kubectl 1.34, 1.35 o 1.36: kubectl acepta un clúster una versión menor arriba o abajo de la suya, y el clúster es 1.35)",
        "Python 3.11 o más nuevo. No hace falta entorno virtual: todo usa la biblioteca estándar",
        "git e Internet la primera vez (la imagen de los nodos, ≈ 1.3 GB)",
        "Los puertos 5900 y 8901 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "EKS 1.35 en dos zonas de <code>us-east-1</code>", "local": "kind (Kubernetes 1.35.5 en contenedores de Docker), con zonas puestas como etiquetas", "diferencia": "El mismo Kubernetes: el scheduler, los controladores, el kubelet y kubectl son los de verdad. Las zonas son etiquetas en nodos que viven en la misma Mac: «perder una zona» no apaga nada por sí solo."},
        {"nube": "<code>g4dn.xlarge</code> con una T4 y el device plugin de NVIDIA", "local": "nodos que anuncian <code>nvidia.com/gpu: 1</code>, puesto a mano por <code>crear.py</code>, con la misma taint", "diferencia": "El scheduler reparte la «T4» igual (entera, sin compartir), pero no hay GPU: el Triton del dojo corre su modelo de juguete en la CPU y simula los ≈ 20 s de cargar el engine."},
        {"nube": "Un Ingress y el AWS Load Balancer Controller, que arma el ALB interno", "local": "un Service NodePort (30901), publicado como <code>localhost:8901</code>", "diferencia": "Reparte entre los pods listos igual que el ALB. Lo que no está: los tiempos del ALB para dar de baja un destino (por eso el preStop del gateway, de 15 s, es de C01)."},
        {"nube": "Argo CD, que aplica el repositorio de despliegue", "local": "tú, con <code>kubectl apply -k k8s/</code>", "diferencia": "La regla es la misma: lo que corre sale de git. Si cambias algo a mano en el clúster, nadie lo regresa hasta tu siguiente apply (Argo CD lo regresaría solo)."},
        {"nube": "KEDA (Triton de 2 a 4) y Karpenter (los nodos)", "local": "Triton fijo en 2 y nodos fijos", "diferencia": "Sin Karpenter, un pod que no cabe se queda Pending para siempre: en C01, ese Pending trae un nodo nuevo en minutos."},
        {"nube": "El gateway como Rollout de Argo (la estación 10)", "local": "un Deployment", "diferencia": "Aquí el cambio de versión es un rolling update que solo mira la salud de los pods; mandar el 5 % del tráfico a la versión nueva y compararla es de la estación 10."},
        {"nube": "Amazon ECR", "local": "<code>registry:2</code> en <code>localhost:5900</code>", "diferencia": "Los nodos bajan por digest igual; sin permisos de IAM ni endpoints de VPC."},
    ],
    "arranque": "unzip c01-kubernetes.zip && cd c01-kubernetes\npython3 mundo/crear.py\nexport KUBECONFIG=$PWD/.kube/config\npython3 verificar.py mundo",
    "python": "python3",
}

G = []
c0, _ = S("paso 0", "time python3 mundo/crear.py")
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El registro, el clúster de 6 nodos con sus T4 y metrics-server arriba, las imágenes publicadas y esta carpeta como repositorio de despliegue.",
    conceptos=["cluster-namespace"],
    explica="<code>mundo/crear.py</code> crea el registro y el clúster con kind, etiqueta los nodos con su zona y su tipo, anuncia las T4 con su taint, instala metrics-server, construye y sube las imágenes, y hace de esta carpeta un repositorio git. La llave del clúster queda en <code>.kube/config</code>: el <code>export</code> le dice a kubectl que use esa, en cada terminal nueva.",
    codigo=[],
    comandos=[
        cmd(c0.removeprefix("time ") + "\nexport KUBECONFIG=$PWD/.kube/config", O("paso 0", "time python3 mundo/crear.py", quitar=r"^real"), "En una carpeta recién descomprimida basta <code>python3 mundo/crear.py</code>; <code>--de-cero</code> borra antes el clúster y el registro."),
        C("paso 0", "python3 verificar.py mundo"),
        C("paso 0", "git log --oneline", nota="Esta carpeta es el repositorio de despliegue: lo que corre en el clúster sale de aquí."),
    ],
    verifica="<code>mundo</code> en verde: 6 nodos listos (4 con T4), el registro y metrics-server.",
    ojo="Si <code>kubectl</code> dice <code>connection refused</code> en <code>localhost:8080</code>, falta el <code>export KUBECONFIG</code> en esa terminal. Si los nodos no arrancan, revisa que Docker Desktop tenga al menos 6 CPU y 8 GiB. Para empezar de nuevo: <code>python3 mundo/crear.py --de-cero</code> (tus <code>k8s/*.yaml</code> se quedan)."))

G.append(dict(n=1, id="cluster", titulo="Leer el clúster", objetivo="Saber qué nodos hay, en qué zona, cuánto ofrece cada uno, cuáles tienen una T4 y qué los protege de pods que no son de GPU.",
    conceptos=["cluster-namespace", "nodeselector-taints", "gpu-device-plugin", "requests-limits-qos"],
    explica="Antes de pedir nada, mira lo que hay. Cada nodo trae etiquetas (zona, tipo, <code>workload</code>) que el scheduler usa para decidir. Lo que un nodo ofrece a los pods es su <b>Allocatable</b>, no su capacidad: de tus núcleos, cada nodo del dojo ofrece 4, como una <code>c6i.xlarge</code>. Los nodos de T4 anuncian <code>nvidia.com/gpu: 1</code> y llevan una taint. Y hay pods en cada nodo antes de los tuyos (la red, kindnet) que ya apartaron CPU.",
    codigo=[],
    comandos=[
        C("paso 1", "kubectl get nodes -L", nota="<code>-L</code> agrega columnas con esas etiquetas. El plano de control no lleva etiquetas de zona: ahí no van tus pods."),
        C("paso 1", "kubectl get nodes -l workload -o custom-columns", nota="Lo asignable de cada nodo de trabajo: 4 CPU y ≈ 8.2 GiB; solo los de T4 ofrecen <code>nvidia.com/gpu</code>."),
        C("paso 1", "kubectl describe node dojo-k8s-worker3 |", nota="Arriba, Capacity (los 10 núcleos de tu Mac); abajo, Allocatable (los 4 que se ofrecen); al final, lo ya reservado. Y la taint que aleja a todo pod que no la tolere."),
        C("paso 1", "kubectl -n kube-system get pods -o wide --no-headers -l k8s-app=kindnet", nota="Un pod de red en cada nodo (un DaemonSet), con su request de 100m."),
        C("paso 1", "kubectl describe node dojo-k8s-worker |"),
        C("paso 1", "python3 mundo/cluster.py estado"),
    ],
    verifica="Sabes cuántos gateways caben en un nodo de CPU y qué nodos pueden recibir a Triton.",
    ojo="El scheduler no mira cuánta CPU se <b>usa</b> en el nodo: mira la suma de requests contra Allocatable. Un nodo casi sin uso puede estar «lleno»."))

G.append(dict(n=2, id="triton", titulo="Triton: dos pods, dos T4, dos zonas", objetivo="El Deployment y el Service de Triton: 2 pods con una T4 cada uno, uno por zona, con sus recursos, y el commit que lo deja en git.",
    conceptos=["pod", "deployment-replicaset", "kustomize-digest", "requests-limits-qos", "nodeselector-taints", "gpu-device-plugin", "topology-spread"],
    explica="Escribe <code>k8s/triton.yaml</code> siguiendo su contrato, por bloques: qué pide cada pod (2 núcleos, 6 GiB con techo igual, una T4, sin techo de CPU), dónde cae (las T4 con su taint, uno por zona), cómo cambia de versión (nunca menos de 2 listos) y su Service. La imagen se llama solo <code>classifier-triton</code>: kustomize pone el registro y el digest que escribió el CI. Aplica, espera a que los dos estén listos y haz commit.",
    codigo=[{"lang": "yaml", "path": "k8s/triton.yaml", "code": code("k8s/triton.yaml"), "nota": "Las probes y el apagado (startup, readiness, liveness, preStop) se explican en el paso 3 y el 5; van aquí porque son del mismo pod."},
            {"lang": "yaml", "path": "k8s/kustomization.yaml (del equipo de plataforma; los digests los escribe el CI)", "code": re.search(r'KUSTOMIZATION = """(.*?)"""', code("mundo/crear.py", KIT), re.S).group(1).replace("{{", "{").replace("}}", "}").replace("{gw_repo}", "localhost:5900/classifier-gateway").replace("{tr_repo}", "localhost:5900/classifier-triton").replace("{gw_dig}", "sha256:…").replace("{tr_dig}", "sha256:…").strip(), "nota": "<code>kubectl apply -k k8s/</code> arma todo esto antes de mandarlo al clúster: el namespace, las imágenes por digest y el ConfigMap con su huella."}],
    comandos=[
        C("paso 2", "kubectl apply -k k8s/", nota="El namespace ya existía (lo creó <code>crear.py</code>); el ConfigMap lleva una huella en el nombre."),
        C("paso 2", "time kubectl -n classifier rollout status deploy/triton"),
        C("paso 2", "kubectl -n classifier get pods -o wide", nota="Cada Triton en un nodo de T4 distinto, y en zonas distintas: mira la columna NODE contra la tabla del paso 1."),
        C("paso 2", "git add k8s && git commit"),
    ],
    verifica=f"<code>{V} triton recursos imagenes</code>: 2 Tritons listos, cada uno en una T4 y en su zona, con sus requests, por digest.",
    ojo="Aplica siempre con <code>-k</code> (kustomize): con <code>kubectl apply -f k8s/triton.yaml</code>, la imagen se queda como «classifier-triton» a secas (ErrImagePull) y los objetos caen en el namespace <code>default</code>. Y Triton primero: los gateways le preguntan a Triton al arrancar."))

_probes = code("k8s/triton.yaml")
G.append(dict(n=3, id="probes", titulo="Las probes de Triton", objetivo="Ver a la startup proteger la carga del engine, y saber cuánto tarda Triton en salir del reparto o en reiniciarse.",
    conceptos=["probes", "crashloopbackoff", "requests-limits-qos"],
    explica="Las tres probes de Triton preguntan a sus rutas de salud: la startup y la readiness a <code>/v2/health/ready</code> («ya cargué el modelo»), la liveness a <code>/v2/health/live</code> («mi proceso contesta»). Mientras carga el engine, la startup falla (el puerto ni siquiera está abierto) y eso está bien: tiene 60 s. Cuando pasa, empiezan las otras dos. En los Events del pod se ve justo eso.",
    codigo=[{"lang": "yaml", "path": "k8s/triton.yaml (las probes)", "code": entre(_probes, "          startupProbe:", "          lifecycle:"), "nota": "Startup: 5 × 12 = 60 s para arrancar. Readiness: ≈ 10 s sin estar listo y sale del reparto. Liveness: ≈ 30 s sin contestar y se reinicia."}],
    comandos=[
        C("paso 3", "kubectl -n classifier logs", nota=f"De «deserializando» a «warmup»: ≈ {ENGINE_S} s cargando el engine. Hasta entonces el puerto 8000 no está abierto."),
        C("paso 3", "kubectl -n classifier describe pod", nota="La startup falló mientras cargaba, sin pasarse de sus 12 intentos: el pod nunca se reinició."),
        C("paso 3", "kubectl -n classifier get pod", nota="Burstable: tiene requests y techo de memoria, pero no techo de CPU."),
    ],
    verifica=f"<code>{V} probes</code>: la startup da ≥ 1.5 veces lo que tarda el engine; el gateway (paso 4) pregunta a <code>/readyz</code> y <code>/healthz</code>.",
    ojo="Los «Startup probe failed» de los primeros segundos no son un error: es la startup haciendo su trabajo. El error sería quitar la startup y subir la liveness «para que aguante»: entonces un Triton colgado tardaría minutos en reiniciarse."))

G.append(dict(n=4, id="gateway", titulo="El gateway, su Service y su HPA", objetivo="De 3 a 12 gateways en nodos de CPU, con readiness que le pregunta a Triton y liveness que no, detrás del «ALB» en localhost:8901.",
    conceptos=["service-endpointslice", "nodeport-ingress", "requests-limits-qos", "throttling", "oomkilled", "hpa-metrics-server"],
    explica="Escribe <code>k8s/gateway.yaml</code> y <code>k8s/hpa.yaml</code>. El gateway no lleva <code>replicas</code>: las decide el HPA. Pide 1 núcleo (sin techo de CPU, para no frenarlo en un pico) y 1 GiB con techo igual (su peor momento son ≈ 880 MB). Habla con Triton por su Service, <code>triton:8000</code>. Su propio Service es NodePort: es la puerta por la que entra el tráfico al clúster del dojo.",
    codigo=[{"lang": "yaml", "path": "k8s/gateway.yaml", "code": code("k8s/gateway.yaml"), "nota": "Sin <code>nvidia.com/gpu</code> ni toleration: nunca cae en una T4. El preStop de 15 s es el de C01, donde lo saca un ALB."},
            {"lang": "yaml", "path": "k8s/hpa.yaml", "code": code("k8s/hpa.yaml"), "nota": "Solo se escribe cómo baja; para subir se queda lo que trae Kubernetes por omisión."}],
    comandos=[
        C("paso 4", "kubectl apply -k k8s/"),
        C("paso 4", "time kubectl -n classifier rollout status deploy/gateway", nota="«0 of 1»: sin <code>replicas</code>, el Deployment nace con 1; en su primera vuelta, el HPA lo sube a 3."),
        C("paso 4", "kubectl -n classifier get pods -o wide", nota="Uno con más edad (el primero) y dos que trajo el HPA; todos en nodos de CPU."),
        C("paso 4", "kubectl -n classifier get endpointslices", nota="Las IP de los tres gateways listos: a ellos reparte el Service."),
        C("paso 4", "curl", nota="Por el NodePort 30901, publicado como <code>localhost:8901</code>."),
        C("paso 4", "git add k8s && git commit"),
        C("paso 4", "kubectl describe node dojo-k8s-worker |", nota=f"cpu-a tenía {SIS_M}m apartados; con un gateway, {GW1_M}m. Caben 2 más."),
    ],
    verifica=f"<code>{V} gateway hpa servicio</code>: al menos 3 gateways listos en nodos de CPU, el HPA activo y 20 fotos en 200 por <code>localhost:8901</code>.",
    ojo="Aplica Triton antes que los gateways: al arrancar, cada gateway le pide a Triton la metadata del modelo, y si Triton todavía no está listo, el gateway muere y se reinicia hasta que lo esté. Pasa solo, pero ensucia los RESTARTS."))

c_pub5, _ = S("paso 5", "python3 mundo/publicar.py")
G.append(dict(n=5, id="version-nueva", titulo="Una versión nueva, bajo carga", objetivo="Cambiar la imagen de los tres gateways mientras entran 40 fotos por segundo, sin que se pierda ni una.",
    conceptos=["rolling-update", "apagado-ordenado", "deployment-replicaset"],
    explica="El CI publica la versión de la semana que entra: escribe su digest en <code>kustomization.yaml</code> y hace commit. En otra terminal, empieza la carga. Al aplicar, el Deployment crea un ReplicaSet nuevo y va pasando pods: con <code>maxSurge: 1</code> y <code>maxUnavailable: 0</code>, primero sube uno nuevo, espera a que esté listo, y solo entonces apaga uno viejo. El viejo sale del reparto, espera 15 s su preStop y termina lo que tenía.",
    codigo=[],
    comandos=[
        cmd(c_pub5, O("paso 5", "python3 mundo/publicar.py"), "En C01, esto lo hace el último job del workflow de la estación 8."),
        cmd("python3 mundo/carga.py --por-segundo 40 --segundos 75 --cada 15   # en otra terminal, antes del apply", CARGA5, "Cero errores: ni una foto cortada mientras se cambiaban los tres pods."),
        C("paso 5", "kubectl apply -k k8s/"),
        C("paso 5", "time kubectl -n classifier rollout status deploy/gateway", nota="De uno en uno; «old replicas are pending termination» son los viejos esperando su preStop."),
        C("paso 5", "kubectl -n classifier get rs", nota="El ReplicaSet viejo queda en 0, guardado: con él, volver atrás es instantáneo."),
        C("paso 5", "kubectl -n classifier rollout history", nota="CHANGE-CAUSE vacío: la historia que importa es <code>git log</code>."),
    ],
    verifica=f"La carga terminó con {OK5} de {N5} en 200 (p99 {P99_5} ms) y el despliegue tardó ≈ {ROLL5_S} s.",
    ojo="Un rollout necesita espacio para el pod de más: si el HPA ya llenó los nodos de CPU (6 gateways en el dojo), el pod nuevo se queda Pending («Insufficient cpu») y el despliegue no avanza hasta que el HPA baje. En C01, Karpenter traería un nodo."))

c_pub6, _ = S("paso 6", "python3 mundo/publicar.py")
G.append(dict(n=6, id="version-mala", titulo="La versión que no arranca, y volver con git", objetivo="Ver un despliegue atorado sin perder servicio, entender por qué, y volver a la versión buena con un git revert.",
    conceptos=["crashloopbackoff", "rolling-update"],
    explica="El CI publica una versión que pide un modelo que Triton no tiene. El pod nuevo muere al arrancar, el kubelet lo reintenta con esperas cada vez más largas (CrashLoopBackOff) y, como <code>maxUnavailable</code> es 0, nadie toca a los tres viejos: el servicio sigue en 200. A los 120 s sin avance (<code>progressDeadlineSeconds</code>), el Deployment se marca fallido, pero no regresa solo. Volver atrás es deshacer el commit en git y aplicar.",
    codigo=[],
    comandos=[
        cmd(c_pub6, O("paso 6", "python3 mundo/publicar.py")),
        C("paso 6", "kubectl apply -k k8s/"),
        C("paso 6", "time kubectl -n classifier rollout status deploy/gateway", nota=f"Se rinde a los ≈ {DEADLINE_S} s: los 120 de <code>progressDeadlineSeconds</code>."),
        C("paso 6", "kubectl -n classifier get pods -l app.kubernetes.io/name=gateway", nota="Uno nuevo en CrashLoopBackOff y los tres viejos atendiendo."),
        C("paso 6", "kubectl -n classifier logs", nota="<code>--previous</code>: lo que escribió antes de morir. El porqué está aquí, no en el estado."),
        C("paso 6", "kubectl -n classifier get deploy gateway -o jsonpath", nota="Available sigue en True (hay 3 listos); Progressing en False."),
        C("paso 6", "curl"),
        C("paso 6", "git revert --no-edit HEAD"),
        C("paso 6", "kubectl apply -k k8s/"),
        C("paso 6", "time kubectl -n classifier rollout status deploy/gateway", n=1, nota="Instantáneo: la plantilla vuelve a ser la del ReplicaSet que ya corría."),
        C("paso 6", "kubectl -n classifier get rs"),
    ],
    verifica=f"<code>{V} gateway sincronia</code>: el despliegue completo otra vez, y lo que corre es lo que dice git.",
    ojo="<code>kubectl rollout undo deploy/gateway</code> también regresa en segundos, pero solo en el clúster: git sigue diciendo la versión mala y el siguiente <code>apply</code> (o Argo CD, en C01) la vuelve a poner. Úsalo solo en una emergencia, y haz el <code>git revert</code> enseguida. El check <code>estable</code> se pone en verde 2 min después del último reinicio."))

G.append(dict(n=7, id="pdb", titulo="El PDB y un mantenimiento de nodos", objetivo="Un PDB que deja sacar un Triton a la vez, y vaciar dos nodos de T4 al mismo tiempo sin quedarte sin GPU.",
    conceptos=["pdb-drain", "topology-spread"],
    explica="Plataforma tiene que actualizar el driver de las T4: vacía los nodos con <code>kubectl drain</code>. Sin PDB, dos drains al mismo tiempo sacarían a los dos Tritons. Con <code>minAvailable: 1</code>, el primer desalojo pasa; el segundo se rechaza y <code>drain</code> reintenta cada 5 s hasta que el reemplazo del primero está listo. Cada reemplazo cae en la otra T4 de su zona.",
    codigo=[{"lang": "yaml", "path": "k8s/pdb.yaml", "code": code("k8s/pdb.yaml"), "nota": "Con 2 réplicas, 1 es el único valor que sirve: 0 no protege y 2 traba todo drain."}],
    comandos=[
        C("paso 7", "kubectl apply -k k8s/"),
        C("paso 7", "kubectl -n classifier get pdb triton", nota="ALLOWED DISRUPTIONS 1: con los dos sanos, se puede sacar uno."),
        C("paso 7", "git add k8s && git commit"),
        cmd(f"kubectl drain {NODO_A} --ignore-daemonsets --delete-emptydir-data --timeout=150s   # una terminal", DRAIN_A, f"El primero ({apodo(NODO_A)}): el PDB lo deja pasar."),
        cmd(DRAIN_B_CMD + "   # otra terminal, 3 s después", DRAIN_B, f"El segundo ({apodo(NODO_B)}): {REINTENTOS} rechazos, cada 5 s, hasta que el reemplazo del primero estuvo listo."),
        C("paso 7", "kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=triton", nota="Uno listo y el otro cargando su engine: nunca hubo cero."),
        C("paso 7", "kubectl uncordon", nota="Cuando termina el mantenimiento, los nodos vuelven a recibir pods."),
    ],
    verifica=f"<code>{V} pdb triton</code>: el PDB cubre 2 Tritons y deja sacar 1; los dos listos otra vez, uno por zona.",
    ojo="<code>kubectl apply</code> dice <code>poddisruptionbudget.policy/triton configured</code> cada vez, aunque no cambies nada: es una rareza de kubectl con el selector del PDB. Para saber si algo cambió de verdad: <code>kubectl diff -k k8s/</code>. Y <code>drain</code> necesita <code>--delete-emptydir-data</code> porque Triton usa un emptyDir (su <code>/dev/shm</code>): sin la bandera, se niega a sacarlo."))

_p8 = [C("paso 8", "kubectl -n classifier get hpa gateway --no-headers", n=i, nota=f"≈ {28 * (i + 1)} s después de empezar el pico.")
       for i in range(6)]
G.append(dict(n=8, id="pico", titulo="El HPA en un pico", objetivo="Ver al HPA hacer su regla de tres con fotos de 12 MP, hasta donde caben los nodos, y medir cuánta CPU cuesta una foto.",
    conceptos=["hpa-metrics-server", "requests-limits-qos", "throttling"],
    explica=f"Una app que dejara de reducir las fotos mandaría las del celular tal cual: 12 MP, ≈ 10 veces más CPU para decodificar. Con {POR_S8} por segundo, mira cada ≈ 30 s el HPA (la CPU promedio como % del request, contra el objetivo de 60 %) y <code>kubectl top</code> (los milinúcleos de cada gateway, de metrics-server). El HPA sube de golpe, hasta donde caben los dos nodos de CPU (6); uno más se quedaría Pending.",
    codigo=[],
    comandos=[cmd(f"python3 mundo/carga.py --por-segundo {POR_S8} --segundos 180 --cada 30 --12mp   # en otra terminal", CARGA8, "Lo que vio el cliente: los 503 y 504 son del primer minuto, mientras llegaban los gateways nuevos.")] + _p8 + [
        C("paso 8", "kubectl -n classifier describe hpa gateway", nota="«New size: 6 … above target»: la regla de tres, con su porqué. Después, «All metrics below target»: baja de uno en uno, un minuto entre cada uno (los primeros eventos son de cuando se creó el HPA)."),
        C("paso 8", "kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=gateway"),
        C("paso 8", "kubectl -n classifier get events --field-selector reason=FailedScheduling", nota="Ninguno Pending: el HPA pidió justo los 6 que caben. Con un séptimo, aquí saldría «Insufficient cpu»."),
        C("paso 8", "python3 mundo/cluster.py estado"),
        C("final", V, nota="Al final, con el pico ya pasado."),
    ],
    verifica=f"El HPA subió de 3 a {REPS_MAX} en cuanto la CPU pasó del 60 % (más la tolerancia de 10 %). Antes de que los gateways nuevos estuvieran listos, la carga recibió {N_ERR8} respuestas 503 o 504 de {N8} (503: el gateway rechaza lo que ya no alcanza a atender; 504: a una foto se le acabó el plazo); después del primer minuto, {N_ERR8_TARDE}. Los 12 checks en verde al final.",
    ojo="Bajar es lento a propósito: el HPA espera 5 min de calma y quita 1 gateway por minuto. Mientras siga arriba, los nodos de CPU están llenos y un rolling update del gateway no tiene dónde poner su pod de más: espera a que baje (o, en C01, a que Karpenter traiga un nodo)."))

REPARTO = {
    1: (["cluster-namespace", "nodeselector-taints", "gpu-device-plugin"], ["gateways-por-nodo"]),
    2: (["pod", "deployment-replicaset", "kustomize-digest", "requests-limits-qos", "topology-spread"], []),
    3: (["probes"], ["presupuesto-startup"]),
    4: (["service-endpointslice", "nodeport-ingress", "throttling", "oomkilled"], []),
    5: (["rolling-update", "apagado-ordenado"], ["plazo-de-gracia"]),
    6: (["crashloopbackoff"], []),
    7: (["pdb-drain"], ["t4-de-sobra"]),
    8: (["hpa-metrics-server"], ["regla-de-tres-hpa", "cpu-por-foto"]),
}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con el kit recién descomprimido en una carpeta nueva. El clúster es uno solo (<code>dojo-k8s</code>): <code>python3 mundo/crear.py --de-cero</code> lo vuelve a crear vacío.",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo de <code>k8s/</code>.",
        "Cada objetivo tiene su check; corre <code>python3 verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Lo que corre sale de git: <code>git commit</code> y <code>kubectl apply -k k8s/</code>. Nada de <code>kubectl edit</code>, <code>scale</code> ni <code>rollout undo</code> para que un check pase.",
        "Las reglas de otros equipos no se tocan: <code>kustomization.yaml</code>, la taint de las T4, el tamaño de los nodos, <code>mundo/</code>.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El clúster con sus 6 nodos listos (4 con T4), el registro y metrics-server.", "check": "mundo"},
        {"n": 2, "objetivo": "Dos Tritons listos, cada uno en un nodo con T4 y en una zona distinta; al cambiar de versión, nunca menos de 2 listos, y nunca dos en la misma zona.", "check": "triton", "pista": "¿Qué pasa con el reparto por zona justo después de un cambio de versión, cuando conviven pods viejos y nuevos?"},
        {"n": 3, "objetivo": "Cada pod pide su CPU y su memoria, con techo de memoria igual al request y sin techo de CPU; Triton con una T4 entera; el gateway sin GPU.", "check": "recursos"},
        {"n": 4, "objetivo": "Las imágenes por digest, las que publicó el CI, y el registro las sirve.", "check": "imagenes"},
        {"n": 5, "objetivo": "Triton con tres probes, y una startup que le da al engine al menos 1.5 veces lo que tarda en cargar; el gateway con readiness a /readyz y liveness a /healthz.", "check": "probes", "pista": "¿Cuánto tarda el engine? Está en el log del pod."},
        {"n": 6, "objetivo": "Al menos 3 gateways listos, solo en nodos de CPU, que cambian de versión sin bajar de capacidad y se rinden en minutos si no avanzan.", "check": "gateway"},
        {"n": 7, "objetivo": "Apagado ordenado: un preStop que espera al balanceador y un plazo de gracia que alcanza para preStop, drenado y margen.", "check": "apagado", "pista": "¿Desde cuándo cuenta el plazo de gracia?"},
        {"n": 8, "objetivo": "Un PDB que deja sacar un Triton a la vez: ni cero (traba todo drain) ni los dos.", "check": "pdb"},
        {"n": 9, "objetivo": "Un HPA del gateway de 3 a 12 al 60 % de CPU, que baja con 5 min de calma, y que puede calcular.", "check": "hpa", "pista": "¿Contra qué divide el HPA la CPU que mide?"},
        {"n": 10, "objetivo": "20 fotos por localhost:8901, todas en 200 y con su top-5.", "check": "servicio"},
        {"n": 11, "objetivo": "Lo que corre en el clúster es exactamente lo que dice k8s/ en git.", "check": "sincronia"},
        {"n": 12, "objetivo": "Ningún pod Pending ni reiniciado en los últimos 2 minutos.", "check": "estable"},
    ],
}


def campo(falla_id: str, nombre: str) -> str:
    """Un campo del diccionario FALLAS de romper.py (la misma historia y título que verá la persona)."""
    txt = code("romper.py", KIT)
    bloque = re.search(r'"' + re.escape(falla_id) + r'": dict\((.*?)aplicar=', txt, re.S)
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


falla("memoria-corta", "config", sint("memoria-corta"),
      ["Cambió la memoria del gateway en lo que se aplica.", "La versión nueva del gateway usa más memoria.", "El nodo se quedó sin memoria."],
      "kubectl -n classifier get pods -l app.kubernetes.io/name=gateway\nkubectl -n classifier describe pod <el que no está listo> | grep -E -A4 'Last State|Limits' | head -12\ngit log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^\\+'",
      F("memoria-corta pods") + "\n\n" + F("memoria-corta describe") + "\n\n" + F("memoria-corta log"),
      "Un patch del equipo de plataforma en <code>k8s/kustomization.yaml</code> bajó la memoria del gateway a 48Mi, request y techo. <code>kubectl top</code> mide un gateway en reposo; en su peor momento usa ≈ 880 MB. El pod nuevo pasa el techo al arrancar, el kernel lo mata (OOMKilled, código 137) y queda en CrashLoopBackOff. Como <code>maxUnavailable</code> es 0, los tres viejos siguen atendiendo y el despliegue se queda a medias: nadie lo nota desde fuera. Arreglo: <code>git revert</code> de ese commit y <code>kubectl apply -k k8s/</code>. El tamaño se decide con el peor momento, no con la mediana.",
      "oomkilled", "recursos")
falla("sin-requests", "config", sint("sin-requests"),
      ["Quitaron el request de CPU del gateway.", "metrics-server no está dando números.", "El HPA no apunta al Deployment correcto."],
      "kubectl -n classifier get hpa gateway\nkubectl -n classifier describe hpa gateway | sed -n '/^Conditions:/,/^Events:/p'",
      F("sin-requests hpa"),
      "Un patch en <code>k8s/kustomization.yaml</code> quitó <code>requests.cpu</code> del gateway. El HPA mide la CPU como porcentaje del request: sin request no tiene contra qué dividir, se queda en <code>&lt;unknown&gt;</code> con ScalingActive=False y en el siguiente pico no sube. Además el scheduler deja de apartar CPU: en un pico se amontonan gateways en un nodo que no los aguanta. Todo contesta hoy; el problema llega con el primer pico. Arreglo: <code>git revert</code> del commit y <code>kubectl apply -k k8s/</code>. «Caben más por nodo» se resuelve con un request medido, no sin request.",
      "hpa-metrics-server", "hpa")
falla("sin-endpoints", "config", sint("sin-endpoints"),
      ["El Service ya no encuentra a los pods.", "Los gateways no están listos.", "Se cayó el NodePort."],
      "kubectl -n classifier get endpointslices -l kubernetes.io/service-name=gateway\nkubectl -n classifier get svc gateway -o jsonpath='{.spec.selector}'\nkubectl -n classifier get pods -l app.kubernetes.io/name=gateway --show-labels --no-headers | head -1",
      F("sin-endpoints endpoints"),
      "Un patch en <code>k8s/kustomization.yaml</code> cambió el selector del Service <code>gateway</code> a <code>app.kubernetes.io/name: classifier-gateway</code>, pero los pods siguen con la etiqueta <code>gateway</code>. El Service no encuentra a nadie, su EndpointSlice queda vacío y el NodePort no tiene a quién mandar. Los pods están sanos: el problema está en el cable, no en el programa. Arreglo: <code>git revert</code> y <code>kubectl apply -k k8s/</code>. Un cambio de etiquetas se hace en los pods y en el selector a la vez, o no se hace.",
      "service-endpointslice", "servicio")
falla("arranque-lento", "mundo", sint("arranque-lento"),
      ["La imagen nueva de Triton tarda más en arrancar de lo que le da la startup.", "No hay T4 libre para el pod nuevo.", "La imagen nueva está rota."],
      "kubectl -n classifier get pods -l app.kubernetes.io/name=triton\nkubectl -n classifier describe pod <el que no está listo> | sed -n '/^Events:/,$p' | tail -8\nkubectl -n classifier logs <el que no está listo> | head -4",
      F("arranque-lento pods") + "\n\n" + F("arranque-lento describe") + "\n\n" + F("arranque-lento logs"),
      "El engine nuevo tarda ≈ 75 s en cargar y tu startup le da 60 s (5 × 12). A los 60 s el kubelet lo mata, lo vuelve a arrancar y otra vez: CrashLoopBackOff. Los dos Tritons viejos siguen sirviendo (<code>maxUnavailable: 0</code>) y el despliegue se queda a medias. Arreglo: recalcula la startup con margen (≥ 1.5 × 75 s; por ejemplo 5 × 30 = 150 s) en <code>k8s/triton.yaml</code>, commit y <code>kubectl apply -k k8s/</code>. Lo que no se hace: quitar la startup ni subir la liveness.",
      "probes", "probes")
falla("zona-acordonada", "infra", sint("zona-acordonada"),
      ["Los nodos de T4 de una zona no aceptan pods.", "El reparto por zona no deja poner el reemplazo en otra zona.", "Triton no arranca."],
      "python3 mundo/cluster.py estado\nkubectl -n classifier describe pod <el Pending> | sed -n '/^Events:/,$p'",
      F("zona-acordonada estado") + "\n\n" + F("zona-acordonada describe"),
      "Los dos nodos de T4 de <code>us-east-1b</code> están acordonados (SchedulingDisabled) y el de su Triton se vació; el PDB dejó sacar uno. El reemplazo no cabe en la zona b, y en la zona a no puede ir: ya hay uno allá y <code>DoNotSchedule</code> con <code>maxSkew: 1</code> prefiere Pending a dos Tritons en la misma zona. Una sola T4 carga todo el tráfico. Arreglo: confirmar con plataforma que el mantenimiento acabó y <code>kubectl uncordon</code> de los dos nodos. No se arregla quitando el reparto por zona.",
      "pdb-drain", "triton")
falla("registro-caido", "infra", sint("registro-caido", filtro=r"^✗ imagenes"),
      ["El nodo no puede bajar la imagen del gateway.", "La imagen ya no está en el registro.", "El pod no tiene dónde caber."],
      "kubectl -n classifier get pods -l app.kubernetes.io/name=gateway\nkubectl -n classifier describe pod <el que no arranca> | sed -n '/^Events:/,$p' | tail -6\npython3 mundo/cluster.py estado | head -1",
      F("registro-caido describe") + "\n\n" + F("registro-caido estado", filtro=r"^registro"),
      "El registro (el «ECR» del dojo) está apagado, y el nodo reciclado ya no tiene la imagen del gateway: el pod nuevo no la puede bajar (ErrImagePull, luego ImagePullBackOff, con esperas que crecen hasta 5 min). Los pods que ya corrían siguen bien: su imagen ya está en su nodo. Arreglo: <code>python3 mundo/cluster.py registro arrancar</code> y, para no esperar el backoff, <code>kubectl -n classifier delete pod &lt;el que no arranca&gt;</code> (su ReplicaSet crea otro al instante). En C01 sería un permiso de ECR o un endpoint de la VPC que se cayó.",
      "crashloopbackoff", "imagenes")
e["fallas"] = FAL

e["listo"] = [
    "Dos Tritons listos, cada uno con su T4 y en su zona, que nunca bajan de 2 al cambiar de versión.",
    "Cada pod pide su CPU y su memoria, con techo de memoria y sin techo de CPU; el gateway nunca cae en una T4.",
    "Las probes protegen el arranque de Triton, sacan del reparto lo que no está listo y solo reinician un proceso muerto.",
    "Un cambio de versión bajo carga no pierde ni una foto, y uno que no arranca no tumba nada y se deshace con un git revert.",
    "El PDB deja vaciar un nodo de T4 a la vez, y el HPA agrega gateways en un pico y los quita despacio.",
    "Lo que corre en el clúster es exactamente lo que dice git.",
]

e["repaso"] = {
    "memo": "<b>Describir, reservar, preguntar, repartir, proteger y escalar.</b> Describes lo que quieres y Kubernetes lo reconcilia sin parar. Cada pod <b>reserva</b> lo que necesita (request de CPU, memoria con techo, la T4 entera) y no lleva techo de CPU. Tres <b>probes</b>: la startup protege el arranque, la readiness decide el tráfico y la liveness solo mira el propio proceso. Triton se <b>reparte</b> uno por zona, en las T4 por etiqueta y toleration. Los cambios de versión nunca bajan de capacidad (<code>maxUnavailable: 0</code>), el apagado espera al balanceador (preStop) y el PDB <b>protege</b> del mantenimiento. El HPA <b>escala</b> el gateway por CPU sobre su request. Y todo sale de git: volver atrás es un <code>git revert</code>.",
    "trampa": "Arreglar el clúster a mano (<code>kubectl edit</code>, <code>scale</code>, <code>rollout undo</code>) y no en git; poner límite de CPU «por orden»; o preguntar por una dependencia en la liveness. En los tres casos, el clúster hace algo distinto de lo que crees.",
    "entrevista": [
        {"q": "Despliega un servicio de inferencia con GPU en Kubernetes. ¿Qué escribes?", "a": "Un Deployment con requests de CPU y memoria (techo de memoria igual al request, sin techo de CPU) y nvidia.com/gpu: 1; nodeSelector a los nodos de GPU y toleration a su taint; reparto por zona con DoNotSchedule; startup probe que cubra la carga del modelo con margen, readiness a la salud del modelo y liveness solo al proceso; preStop y plazo de gracia que alcancen para drenar; maxSurge 1 y maxUnavailable 0; un PDB con minAvailable menor que las réplicas; y un Service. La imagen, por digest."},
        {"q": "¿Requests o limits? ¿Por qué no le pones límite de CPU?", "a": "El request es la reserva: con él se agenda el pod y se calcula el HPA, así que siempre va. El límite de CPU solo frena: el kernel da una cuota cada 100 ms y, si un pod con varios hilos la gasta antes, lo congela aunque el nodo tenga CPU libre (throttling), justo en los picos. La memoria sí lleva techo, igual al request: pasarse de memoria no se puede «esperar», el kernel mata el proceso (OOMKilled), y mejor ese pod que todo el nodo."},
        {"q": "¿Qué diferencia hay entre readiness, liveness y startup probe?", "a": "La startup pregunta si ya arrancó, y mientras no pasa las otras no corren: protege un arranque lento, como cargar un engine. La readiness decide si le mandas tráfico: si falla, el pod sale del Service sin reiniciarse. La liveness decide si se reinicia: por eso solo mira el propio proceso, nunca una dependencia; si mirara a Triton, una caída de Triton reiniciaría todos los gateways sin arreglar nada."},
        {"q": "¿Cómo haces un cambio de versión sin cortar requests?", "a": "maxUnavailable 0 y maxSurge 1: siempre hay un pod nuevo listo antes de apagar uno viejo, y la readiness decide cuándo está listo. Al apagar, el pod sale del reparto, un preStop espera a que el balanceador se entere y luego SIGTERM; el plazo de gracia cuenta desde el principio y tiene que alcanzar para preStop, drenado y margen. Y progressDeadlineSeconds con una alerta, porque al vencer no hay rollback automático."},
        {"q": "Un pod de tu servicio está en CrashLoopBackOff. ¿Qué miras?", "a": "kubectl get pods para ver RESTARTS; kubectl describe pod para Last State (OOMKilled y código 137, un código de salida, o una probe que falla) y los Events; kubectl logs --previous para lo que escribió antes de morir; y git log del repositorio de despliegue para ver qué cambió. Si es un despliegue nuevo y maxUnavailable es 0, los pods viejos siguen atendiendo mientras tanto."},
        {"q": "¿Cómo escala tu gateway, y qué puede impedir que escale?", "a": "Con un HPA por CPU al 60 % del request, de 3 a 12: cada 15 s calcula ⌈pods × actual ÷ objetivo⌉. Sube rápido y baja tras 5 min de calma, 1 pod por minuto. Lo frenan: un pod sin request de CPU (el HPA queda en unknown), metrics-server caído, o nodos llenos (los pods nuevos quedan Pending hasta que el autoscaler de nodos, Karpenter en EKS, trae una máquina). Para un servicio de GPU no escalaría por CPU sino por la fila de espera."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-kubernetes/CLAUDE.md",
    "guiado": "content/estaciones/c01-kubernetes/prompts/guiado.md",
    "solo": "content/estaciones/c01-kubernetes/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-kubernetes/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-kubernetes/prompts/romper-solo.md",
}

if FALTAN:
    print("⚠ borrador: faltan " + str(len(FALTAN)) + ":\n  " + "\n  ".join(dict.fromkeys(FALTAN)))
(APP / "content/estaciones/c01-kubernetes.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· conceptos:", len(e["conceptos"]), "· precálculos:", len(e["precalculos"]["cuentas"]),
      "· pasos:", len(G), "· objetivos:", len(e["solo"]["objetivos"]), "· fallas:", len(FAL), "· preguntas:", len(e["repaso"]["entrevista"]))
