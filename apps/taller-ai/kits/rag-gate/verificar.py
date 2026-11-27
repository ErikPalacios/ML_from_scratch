"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tu código, el almacén ni tus
corridas (lo que tiene que escribir lo escribe en .taller/verificar/ y lo borra).

    python verificar.py                    # todos (≈ 3 min: examen corre el golden set completo)
    python verificar.py correr metricas    # algunos
    python verificar.py --rapido           # todos menos examen (≈ 40 s): lo que usa romper.py

Necesita el entorno virtual activo (source .venv/bin/activate), los dos servidores arriba (python mundo/servidor.py
arrancar) y la API de la estación 8 (python mundo/api.py arrancar). metricas, estadistica, gate y promover usan
corridas armadas a mano (de mentira, con las preguntas de verdad); correr, juez y examen usan la API, el LLM y el juez
de verdad.
"""
from __future__ import annotations

import copy
import importlib
import json
import shutil
import signal
import sys
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
import yaml  # noqa: E402

from mundo.comun import ALMACEN, CONFIG, TALLER, TOKENS, VIGENTE, leer_env, leer_json, leer_jsonl, modelos_faltantes, sha256_archivo, version_llama, vigente  # noqa: E402

D = "@marketplace.test"
TMP = TALLER / "verificar"
IDS_CORRER = ["G-001", "G-014", "G-040", "G-060", "G-070", "G-071"]


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
    if not cond:
        raise Falla(msg() if callable(msg) else msg)


def modulo(nombre: str):
    try:
        m = importlib.import_module(nombre)
        return importlib.reload(m)
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar {nombre}: {e}")


def llamar(fn, *a, segundos: int = 300, **k):
    def alarma(*_):
        raise Falla(f"{getattr(fn, '__module__', '')}.{getattr(fn, '__name__', fn)} no terminó en {segundos} s")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(segundos)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{getattr(fn, '__module__', '')}.{getattr(fn, '__name__', '')} todavía es el esqueleto ({e or 'NotImplementedError'})")
    except SystemExit as e:
        raise Falla(str(e.code))
    finally:
        signal.alarm(0)


def cfg() -> dict:
    return yaml.safe_load(CONFIG.read_text())


def golden() -> list[dict]:
    v = (ALMACEN / "golden" / "VIGENTE").read_text().strip()
    return leer_jsonl(ALMACEN / "golden" / v / "preguntas.jsonl")


def golden_sha() -> tuple[str, str]:
    v = (ALMACEN / "golden" / "VIGENTE").read_text().strip()
    return v, sha256_archivo(ALMACEN / "golden" / v / "preguntas.jsonl")


def salud(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return '"ok"' in r.read().decode()
    except Exception:  # noqa: BLE001
        return False


def servidores() -> None:
    for nombre, env in (("el LLM de la API", "servidor.env"), ("el juez", "juez.env")):
        e = leer_env(RAIZ / env)
        exige(salud(f"http://{e.get('HOST')}:{e.get('PUERTO')}/health"), f"{nombre} no contesta en {e.get('HOST')}:{e.get('PUERTO')}: python mundo/servidor.py arrancar")
    a = cfg()["api"]
    exige(salud(f"http://{a['host']}:{a['puerto']}/health"), f"la API de la estación 8 no contesta en {a['host']}:{a['puerto']}: python mundo/api.py arrancar")


# ---------------------------------------------------------------- corridas de mentira (con las preguntas de verdad)
def test() -> list[dict]:
    return [x for x in golden() if x["split"] == "test"]


def fila_buena(x: dict) -> dict:
    """Una fila como la que escribe correr.una(): contesta bien las contestables (con sus fuentes en el contexto y una
    cita a la primera) y dice «no sé» en las demás."""
    contesta = x["tipo"] in ("directa", "varias")
    fs = [f["chunk_id"] for f in x["fuentes"]]
    return {"id": x["id"], "tipo": x["tipo"], "persona": x["persona"], "contexto": fs if contesta else [], "apartados": [], "descartados": 0,
            "de_cache": False, "respuesta": "dato [1]" if contesta else "No encontré eso en los documentos que puedes ver.",
            "citas": fs[:1] if contesta else [], "invalidas": [], "no_se": not contesta, "fin": "stop" if contesta else "sin_fuentes",
            "error": None, "ms": {"ttft": 800.0, "total": 1500.0}}


def manifiesto(nombre: str, filas: list[dict], **cambios) -> dict:
    v, sha = golden_sha()
    m = {"nombre": nombre, "fecha": f"2026-11-23T16:{len(nombre) % 60:02d}:00-06:00", "split": "test", "n": len(filas), "ids": [f["id"] for f in filas],
         "golden": {"version": v, "sha256": sha}, "config_sha256": "0" * 64, "sistema": {}, "llm": {"modelo": "Qwen3-0.6B-Q8_0.gguf", "sha256": None},
         "indice": VIGENTE, "sin_cache": True}
    m.update(cambios)
    return m


JUEZ_FALSO = {"modelo": "juez-de-mentira.gguf", "parametros": 1}


def escribir_corrida(carpeta: Path, nombre: str, filas: list[dict], correctas: set[str], rubrica: str, **cambios) -> None:
    d = carpeta / nombre
    d.mkdir(parents=True)
    (d / "respuestas.jsonl").write_text("".join(json.dumps(f, ensure_ascii=False) + "\n" for f in filas))
    (d / "manifiesto.json").write_text(json.dumps(manifiesto(nombre, filas, **cambios), ensure_ascii=False))
    (d / "juicio.jsonl").write_text("".join(json.dumps({"id": f["id"], "veredicto": "correcta" if f["id"] in correctas else "incorrecta", "por": "juez"}) + "\n"
                                            for f in filas))
    (d / "juicio.json").write_text(json.dumps({"juez": JUEZ_FALSO, "rubrica": rubrica}))


def mundo_falso(rubrica: str, calibrado: bool = True) -> Path:
    """.taller/verificar/corridas con una calibración de mentira y la base: 40 de 51 correctas."""
    shutil.rmtree(TMP, ignore_errors=True)
    c = TMP / "corridas"
    c.mkdir(parents=True)
    (c / "calibracion.json").write_text(json.dumps({"n": 68, "acuerdo": 0.9, "kappa": 0.75 if calibrado else 0.2, "falso_pase": 0.05 if calibrado else 0.6,
                                                    "reprobadas": 19, "falso_rechazo": 0.05, "juez": JUEZ_FALSO, "rubrica": rubrica, "pasa": calibrado}))
    filas = [fila_buena(x) for x in test()]
    escribir_corrida(c, "base", filas, {f["id"] for f in filas[:40]}, rubrica)
    return c


def apuntar(gate, metricas_, c: Path) -> None:
    gate.CORRIDAS, gate.VIGENTE = c, c / "VIGENTE"


# ---------------------------------------------------------------- los checks
def check_mundo() -> str:
    malos = modelos_faltantes()
    exige(not malos, lambda: f"faltan los modelos o no son los del catálogo: {', '.join(malos)} (python mundo/modelos.py)")
    exige((ALMACEN / "mundo.json").exists() and (ALMACEN / "calificaciones.jsonl").exists(), "no hay almacén: python mundo/crear.py")
    exige(vigente() == VIGENTE, lambda: f"el alias c11 apunta a {vigente()} y tiene que apuntar a {VIGENTE}: python mundo/crear.py")
    exige(len(leer_json(TOKENS, {})) == 14, "almacen/tokens.json no tiene las 14 llaves: python mundo/crear.py")
    v, linea = version_llama()
    exige(v and v >= (1, 1, 0), lambda: f"llama-server {linea or 'no está'}: se probó con 1.1.0 (brew install llama.cpp)")
    servidores()
    cal = leer_jsonl(ALMACEN / "calificaciones.jsonl")
    return (f"{len(golden())} preguntas en el golden set ({len(test())} de test) · {len(cal)} calificaciones de personas · llama-server {linea.split(' (')[0]} · "
            f"el LLM ({leer_env(RAIZ / 'servidor.env').get('MODELO', '').split('/')[-1]}), el juez ({leer_env(RAIZ / 'juez.env').get('MODELO', '').split('/')[-1]}) y la API arriba")


def check_correr() -> str:
    servidores()
    co = modulo("correr")
    c = cfg()
    split = c["evals"]["split"]
    qs = llamar(co.preguntas, split)
    exige(qs and all(x["split"] == "test" for x in qs), lambda: f"con evals.split = {split}, preguntas() da {len(qs)} preguntas, "
          f"{sum(x['split'] == 'dev' for x in qs)} de dev: el gate decide con test (dev ya se usó para elegir el umbral del «no sé»)")
    from mundo.api import url
    from sse import preguntar
    llaves = {p: t for t, p in leer_json(TOKENS, {}).items()}
    for i in IDS_CORRER:                                  # calentar la cache de la API, como si alguien ya hubiera preguntado
        x = next(y for y in qs if y["id"] == i)
        list(preguntar(url() + "/v1/ask", llaves[x["persona"]], x["pregunta"]))
    shutil.rmtree(TMP, ignore_errors=True)
    co.CORRIDAS = TMP / "corridas"
    d = llamar(co.correr, "verificar", None, IDS_CORRER)
    filas = leer_jsonl(Path(d) / "respuestas.jsonl")
    m = leer_json(Path(d) / "manifiesto.json")
    exige([f["id"] for f in filas] == IDS_CORRER, lambda: f"la corrida tiene que traer las 6 preguntas pedidas, en orden; trae {[f['id'] for f in filas]}")
    faltan = {"id", "tipo", "persona", "contexto", "apartados", "descartados", "de_cache", "respuesta", "citas", "invalidas", "no_se", "fin", "error", "ms"} - set(filas[0])
    exige(not faltan, lambda: f"a cada fila le falta {sorted(faltan)}")
    en_cache = [f["id"] for f in filas if f["de_cache"]]
    exige(not en_cache, lambda: f"{len(en_cache)} de 6 respuestas salieron de la cache de la API ({', '.join(en_cache)}): la corrida mide el top de hace un rato, "
          f"no el de la configuración de hoy · evals.sin_cache = {c['evals']['sin_cache']}")
    g = {x["id"]: x for x in qs}
    for f in filas:
        prohibidas = {s["chunk_id"] for s in g[f["id"]]["fuentes"]} & set(f["contexto"]) if g[f["id"]]["tipo"] == "prohibida" else set()
        exige(not prohibidas, lambda: f"{f['id']}: {f['persona']} recibió {sorted(prohibidas)}: ¿la pregunta se hizo con la llave de su persona?")
    exige(any(f["no_se"] for f in filas) and any(f["citas"] for f in filas), "en estas 6 hay «no sé» y hay citas: la fila tiene que traer no_se y citas del evento fin")
    v, sha = golden_sha()
    exige(m["golden"] == {"version": v, "sha256": sha}, lambda: f"manifiesto.golden tiene que ser {{version: {v}, sha256: …{sha[-8:]}}}; es {m.get('golden')}")
    exige(m["config_sha256"] == sha256_archivo(CONFIG) and m["sin_cache"] == bool(c["evals"]["sin_cache"]) and m["indice"] == VIGENTE and m["split"] == split,
          "el manifiesto trae el sha256 de config.yaml, sin_cache, el índice del alias c11 y el split")
    exige(m["llm"]["sha256"] and m["llm"]["modelo"] == "Qwen3-0.6B-Q8_0.gguf" and set(m["sistema"]) >= {"retrieval", "respuesta", "llm", "seguridad"},
          lambda: f"manifiesto.llm y manifiesto.sistema: {m.get('llm')} · {sorted(m.get('sistema', {}))}")
    try:
        co.correr("verificar", None, IDS_CORRER)
        raise Falla("correr() con un nombre que ya existe tiene que dar ValueError: una corrida no se pisa")
    except ValueError:
        pass
    shutil.rmtree(TMP, ignore_errors=True)
    t = [f["ms"]["ttft"] for f in filas if f["ms"]["ttft"]]
    return (f"6 preguntas con la llave de su persona, ninguna de la cache (aunque estaban en ella) · {sum(f['no_se'] for f in filas)} «no sé» · "
            f"primer token de {min(t):.0f} a {max(t):.0f} ms · manifiesto con golden {v}, config, LLM e índice · no pisa una corrida")


def check_metricas() -> str:
    me = modulo("metricas")
    g = {x["id"]: x for x in golden()}
    exige(llamar(me.docs, ["wiki:1008#000", "wiki:1008#001", "jira:SOP-12#000", "wiki:1008#000"]) == ["wiki:1008", "jira:SOP-12"], "docs() da los documentos en orden y sin repetir")
    ver = lambda c: True  # noqa: E731
    f = fila_buena(g["G-040"]) | {"contexto": ["wiki:1008#000", "wiki:1008#001", "drive:d20#000"], "citas": ["drive:d20#000"]}
    p = llamar(me.por_pregunta, f, g["G-040"], ver)
    exige(p["recall"] == 0.5, lambda: f"G-040 espera wiki:1008 y jira:SOP-12; al prompt llegaron dos chunks de wiki:1008 y uno de drive:d20: recall 0.5 (por documento), no {p['recall']}")
    exige(p["cita_esperada"] is False and p["sin_cita"] is False and p["contesto"], lambda: f"citó solo drive:d20, que no es fuente esperada: cita_esperada False; tu por_pregunta: {p}")
    p = me.por_pregunta(fila_buena(g["G-070"]) | {"contexto": ["drive:d21#002"]}, g["G-070"], ver)
    exige(p["fuga"], "G-070 es prohibida y su fuente drive:d21#002 llegó al prompt: es una fuga")
    p = me.por_pregunta(fila_buena(g["G-001"]) | {"contexto": ["wiki:1001#001", "wiki:3004#000"]}, g["G-001"], lambda c: c != "wiki:3004#000")
    exige(p["fuga"], "un chunk que la persona no puede ver (ver() da False) en el contexto es una fuga, aunque la pregunta no sea prohibida")
    p = me.por_pregunta(fila_buena(g["G-001"]) | {"citas": [], "respuesta": "De 9 a 18."}, g["G-001"], ver)
    exige(p["sin_cita"] and p["cita_esperada"] is None, "contestó sin citar: sin_cita True y cita_esperada None")
    p = me.por_pregunta(fila_buena(g["G-014"]) | {"no_se": True, "contexto": [], "citas": []}, g["G-014"], ver)
    q = me.por_pregunta(fila_buena(g["G-060"]), g["G-060"], ver)
    exige(p["abstencion"] == "indebida" and q["abstencion"] == "correcta" and p["recall"] == 0.0 and q["recall"] is None,
          lambda: f"«no sé» en una directa es indebido (y su recall 0), en una sin respuesta es correcto (y su recall None): {p['abstencion']}, {q['abstencion']}")
    lo, hi = llamar(me.wilson, 170, 200)
    exige(abs(lo - 0.7939) < 0.0005 and abs(hi - 0.8929) < 0.0005, lambda: f"Wilson de 170 de 200: de 79.4 % a 89.3 %; el tuyo {lo:.4f}–{hi:.4f}")
    exige(llamar(me.p95, [float(i) for i in range(1, 21)]) == 19.0, "p95 de 1 a 20 por rango más cercano: el de la posición int(0.95 × 19) = 18 → 19")
    rubrica = "r"
    c = mundo_falso(rubrica)
    filas = leer_jsonl(c / "base" / "respuestas.jsonl")
    filas[0] |= {"no_se": True, "contexto": [], "citas": []}
    (c / "base" / "respuestas.jsonl").write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in filas))
    r = llamar(me.resumen, c / "base")
    a = r["abstencion"]
    exige(r["n"] == 51 and r["fugas"] == 0 and r["recall"]["n"] == 37 and abs(r["recall"]["media"] - 36 / 37) < 1e-9,
          lambda: f"la corrida de mentira: 51 preguntas, 37 contestables, la primera dice «no sé»: recall 36/37 = 97.3 % y 0 fugas; tu resumen: n {r['n']}, recall {r['recall']}, fugas {r['fugas']}")
    exige(a["correctas"] == 14 and a["de"] == 14 and a["indebidas"] == 1 and r["ttft_p95"] == 800.0 and r["ttft_p50"] == 800.0 and (c / "base" / "metricas.json").exists(),
          lambda: f"abstención 14/14 correctas y 1 indebida, primer token p95 800 ms, y metricas.json escrito; tu resumen: {a}, {r['ttft_p95']}")
    shutil.rmtree(TMP, ignore_errors=True)
    return "recall por documento (0.5 con dos chunks del mismo) · fuga por ACL y por prohibida · citas esperadas y sin cita · abstención correcta e indebida · Wilson y p95 · resumen de 51"


def check_juez() -> str:
    servidores()
    ju = modulo("juez")
    c = cfg()["juez"]
    j = llamar(ju.Juez)
    ident = llamar(j.identidad)
    api = leer_env(RAIZ / "servidor.env").get("MODELO", "").split("/")[-1]
    exige(ident["modelo"] != api, lambda: f"el juez que contesta en {c['url']} es {ident['modelo']}: el mismo modelo que la API ({api}). Un modelo no se califica a sí mismo")
    exige("error" in json.dumps(ju.SCHEMA) and ju.RUBRICA, "SCHEMA pide {\"error\": true|false} y RUBRICA dice qué cuenta como error")
    exige(abs(llamar(ju.kappa, [(1, 1)] * 80 + [(0, 0)] * 10 + [(1, 0)] * 5 + [(0, 1)] * 5) - 0.6078) < 0.001,
          "kappa de 100 pares (80 sí/sí, 10 no/no, 5 y 5 en desacuerdo): (0.90 − 0.745) ÷ (1 − 0.745) = 0.61")
    exige(ju.kappa([(1, 1)] * 90 + [(0, 1)] * 10) == 0.0, "un juez que dice «correcta» siempre tiene kappa 0, aunque acuerde el 90 %")
    g = {x["id"]: x for x in golden()}

    class Prohibido:
        def calificar(self, *a):
            raise AssertionError("aquí no se llama al juez")
    v1 = llamar(ju.veredicto, fila_buena(g["G-060"]), g["G-060"], Prohibido())
    v2 = ju.veredicto(fila_buena(g["G-014"]) | {"no_se": True}, g["G-014"], Prohibido())
    v3 = ju.veredicto(fila_buena(g["G-001"]) | {"error": "limite"}, g["G-001"], Prohibido())
    exige(v1 == ("correcta", "regla") and v2 == ("incorrecta", "regla") and v3 == ("incorrecta", "regla"),
          lambda: f"sin llamar al juez: «no sé» en sin respuesta → correcta, en una directa → incorrecta, error → incorrecta; tus veredictos: {v1} {v2} {v3}")
    r = llamar(ju.calibrar, j, segundos=600)
    exige(r["pasa"] and r["kappa"] >= c["kappa_min"] and r["falso_pase"] <= c["falso_pase_max"],
          lambda: f"el juez {r['juez']['modelo']} no está calibrado: kappa {r['kappa']:.2f} (mínimo {c['kappa_min']}), falso pase {r['falso_pase']:.0%} de {r['reprobadas']} "
          f"reprobadas por personas (máximo {c['falso_pase_max']:.0%}), acuerdo {r['acuerdo']:.0%}. No se le puede creer: ¿es el juez que tiene que ser? (juez.url)")
    return (f"juez {ident['modelo']} ({ident['parametros'] / 1e9:.1f} B), no el de la API · kappa {r['kappa']:.2f} ≥ {c['kappa_min']} · falso pase {r['falso_pase']:.1%} ≤ {c['falso_pase_max']:.0%} "
            f"en {r['n']} calificaciones · reglas sin juez para «no sé» y errores")


def check_estadistica() -> str:
    ga = modulo("gate")
    c = cfg()["gate"]
    b = [1] * 165 + [1] * 5 + [0] * 17 + [0] * 13
    k = [1] * 165 + [0] * 5 + [1] * 17 + [0] * 13
    r = llamar(ga.no_inferior, b, k, 0.06, 1.645, True)
    exige(abs(r["delta"] - 0.06) < 1e-9 and abs(r["se"] - 0.023065) < 1e-5 and abs(r["cota"] - 0.022058) < 1e-5,
          lambda: f"200 preguntas, pierde 5 y gana 17 (pareado): Δ +6.0 %, se 2.31 %, cota +2.21 %; tu no_inferior: {r}")
    r2 = ga.no_inferior(b, k, 0.06, 1.645, False)
    exige(abs(r2["se"] - 0.032357) < 1e-5, lambda: f"las mismas, sin parear: se = √(var_b ÷ n + var_c ÷ n) = 3.24 %; el tuyo {r2['se']:.4%}")
    base = [1] * 40 + [0] * 11
    igual = ga.no_inferior(base, list(base), c["margen"], c["confianza_z"], c["pareado"])
    exige(igual["pasa"], lambda: f"un cambio que no cambia ninguna respuesta (40 de 51 antes y después) tiene que pasar; con gate.pareado = {c['pareado']} "
          f"la cota da {igual['cota']:+.1%} contra −{c['margen']:.0%}: comparar dos porcentajes sueltos no ve que son las mismas preguntas")
    pierde = [1] * 36 + [0] * 15
    r3 = ga.no_inferior(base, pierde, c["margen"], c["confianza_z"], c["pareado"])
    perder_ok = r3["pasa"] and -r3["delta"] <= c["caida_max"]
    exige(not perder_ok, lambda: f"perder 4 respuestas de 51 (−7.8 puntos) tiene que bloquear: con gate.margen = {c['margen']} y gate.caida_max = {c['caida_max']} pasa "
          f"(cota {r3['cota']:+.1%}). ¿Qué tan grande es la caída que deja pasar tu gate?")
    return (f"pareado: Δ +6.0 %, se 2.31 %, cota +2.21 % · sin parear, se 3.24 % · el mismo resultado pasa (cota {igual['cota']:+.1%}) · "
            f"perder 4 de 51 bloquea (Δ {r3['delta']:+.1%}, cota {r3['cota']:+.1%}, margen {c['margen']:.0%}, caída máxima {c['caida_max']:.0%})")


def _decidir(ga, me, c, nombre, base="base"):
    apuntar(ga, me, c)
    return llamar(ga.decidir, nombre, base)


def check_gate() -> str:
    ga, me, ju = modulo("gate"), modulo("metricas"), modulo("juez")
    rub = hashlib_sha(ju.RUBRICA)
    c = mundo_falso(rub)
    filas = leer_jsonl(c / "base" / "respuestas.jsonl")
    ok = {f["id"] for f in filas[:40]}
    escribir_corrida(c, "igual", filas, ok, rub)
    escribir_corrida(c, "pierde-4", filas, set(list(ok)[4:]), rub)
    fuga = copy.deepcopy(filas)
    x = next(f for f in fuga if f["id"] == "G-070")
    x["contexto"] = ["drive:d21#002"]
    escribir_corrida(c, "fuga", fuga, ok, rub)
    escribir_corrida(c, "otro-golden", filas, ok, rub, golden={"version": golden_sha()[0], "sha256": "1" * 64})
    cache = copy.deepcopy(filas)
    for f in cache[:20]:
        f["de_cache"] = True
    escribir_corrida(c, "con-cache", cache, ok, rub)
    escribir_corrida(c, "otro-juez", filas, ok, "otra-rubrica")
    res = {}
    for n in ("igual", "pierde-4", "fuga", "otro-golden", "con-cache", "otro-juez"):
        d = _decidir(ga, me, c, n)
        res[n] = d
        exige({"candidata", "base", "pasa", "reglas"} <= set(d) and (c / n / "gate.json").exists(), lambda: f"decidir() devuelve candidata, base, pasa y reglas, y escribe gate.json; dio {sorted(d)}")
    no = lambda d: [x["regla"] for x in d["reglas"] if not x["pasa"]]  # noqa: E731
    exige(res["igual"]["pasa"], lambda: f"la misma corrida contra sí misma tiene que pasar; bloqueó por {no(res['igual'])}: "
          + "; ".join(x["detalle"] for x in res["igual"]["reglas"] if not x["pasa"]))
    espera = {"pierde-4": "exactitud", "fuga": "permisos", "otro-golden": "comparable", "con-cache": "sin_cache", "otro-juez": "juez"}
    for n, r in espera.items():
        exige(not res[n]["pasa"] and r in no(res[n]), lambda: f"«{n}» tiene que bloquear por la regla {r}; tu gate: {'pasa' if res[n]['pasa'] else 'bloquea por ' + ', '.join(no(res[n]))}")
    shutil.rmtree(TMP, ignore_errors=True)
    mundo_falso(rub, calibrado=False)
    escribir_corrida(TMP / "corridas", "igual", filas, ok, rub)
    d = _decidir(ga, me, TMP / "corridas", "igual")
    exige(not d["pasa"] and "juez" in no(d), "con una calibración que no pasa, el gate no le cree al juez: bloquea por la regla juez")
    shutil.rmtree(TMP, ignore_errors=True)
    return "la misma corrida pasa · bloquea por exactitud (pierde 4), permisos (1 fuga), comparable (otro golden), sin_cache (20 de la cache) y juez (otra rúbrica o sin calibrar)"


def hashlib_sha(t: str) -> str:
    import hashlib

    return hashlib.sha256(t.encode()).hexdigest()


def check_promover() -> str:
    ga, me, ju = modulo("gate"), modulo("metricas"), modulo("juez")
    rub = hashlib_sha(ju.RUBRICA)
    c = mundo_falso(rub)
    apuntar(ga, me, c)
    filas = leer_jsonl(c / "base" / "respuestas.jsonl")
    ok = {f["id"] for f in filas[:40]}
    llamar(ga.promover, "base")
    exige((c / "VIGENTE").read_text().strip() == "base", "promover(base) sin VIGENTE: la primera base; corridas/VIGENTE dice «base»")
    escribir_corrida(c, "mala-1", filas, set(list(ok)[4:]), rub)
    d1 = llamar(ga.decidir, "mala-1")
    exige(not d1["pasa"] and d1["base"] == "base", lambda: f"mala-1 pierde 4 contra la base vigente: bloquea; tu gate comparó contra {d1['base']} y {'pasó' if d1['pasa'] else 'bloqueó'}")
    try:
        ga.promover("mala-1")
        raise Falla("promover() de una corrida que no pasó el gate tiene que dar ValueError")
    except ValueError:
        pass
    escribir_corrida(c, "mala-2", filas, set(list(ok)[4:]), rub, fecha="2026-11-23T18:00:00-06:00")
    d2 = llamar(ga.decidir, "mala-2")
    exige(d2["base"] == "base" and not d2["pasa"], lambda: f"mala-2 es la misma regresión otra vez: se compara con la base vigente (base), no con la corrida anterior; "
          f"tu gate la comparó con {d2['base']} y {'pasó' if d2['pasa'] else 'bloqueó'} (gate.base = {cfg()['gate']['base']})")
    escribir_corrida(c, "buena", filas, ok, rub)
    d3 = ga.decidir("buena")
    exige(d3["pasa"], lambda: f"buena = la base otra vez: pasa; bloqueó por {[x['regla'] for x in d3['reglas'] if not x['pasa']]}")
    ga.promover("buena")
    h = leer_jsonl(c / "historial.jsonl")
    exige((c / "VIGENTE").read_text().strip() == "buena" and [x["vigente"] for x in h] == ["base", "buena"],
          lambda: f"después de promover buena: VIGENTE = buena e historial base → buena; tu historial: {h}")
    shutil.rmtree(TMP, ignore_errors=True)
    return "primera base · una regresión no se promueve · la misma regresión otra vez se compara con la vigente, no con la anterior · historial base → buena"


def check_examen() -> str:
    servidores()
    ga, me, ju, co = modulo("gate"), modulo("metricas"), modulo("juez"), modulo("correr")
    real = RAIZ / "corridas"
    exige((real / "VIGENTE").exists(), "no hay base vigente en corridas/: corre el examen de hoy y promuévelo (pasos 1 a 4 del guion)")
    base = (real / "VIGENTE").read_text().strip()
    exige((real / base / "juicio.jsonl").exists(), lambda: f"la base vigente ({base}) no está juzgada")
    cal = leer_json(real / "calibracion.json")
    exige(cal and cal["pasa"], "corridas/calibracion.json no existe o no pasa: python pipeline/juez.py calibrar")
    shutil.rmtree(TMP, ignore_errors=True)
    c = TMP / "corridas"
    c.mkdir(parents=True)
    shutil.copytree(real / base, c / base)
    shutil.copy(real / "calibracion.json", c / "calibracion.json")
    (c / "VIGENTE").write_text(base + "\n")
    co.CORRIDAS = c
    apuntar(ga, me, c)
    llamar(co.correr, "examen", segundos=900)
    llamar(ju.juzgar, c / "examen", segundos=600)
    d = llamar(ga.decidir, "examen")
    fallan = [x for x in d["reglas"] if not x["pasa"]]
    a = leer_jsonl(c / base / "respuestas.jsonl")
    b = {f["id"]: f for f in leer_jsonl(c / "examen" / "respuestas.jsonl")}
    distintas = sum(1 for f in a if b.get(f["id"], {}).get("respuesta") != f["respuesta"])
    exige(d["pasa"], lambda: f"el examen de hoy, sin ningún cambio, contra la base vigente ({base}) tiene que pasar; bloqueó por "
          + "; ".join(f"{x['regla']}: {x['detalle']}" for x in fallan) + f" · {distintas} respuestas distintas de la base")
    ex = next(x for x in d["reglas"] if x["regla"] == "exactitud")["detalle"]
    shutil.rmtree(TMP, ignore_errors=True)
    return f"{len(b)} preguntas de test otra vez, sin cambios: {distintas} respuestas distintas de {base} · {ex.split(' · ')[0]} · PASA"


CHECKS = {"mundo": check_mundo, "correr": check_correr, "metricas": check_metricas, "juez": check_juez, "estadistica": check_estadistica,
          "gate": check_gate, "promover": check_promover, "examen": check_examen}
RAPIDOS = [k for k in CHECKS if k != "examen"]


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except SystemExit as e:
            ok, msg = False, str(e.code)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        finally:
            shutil.rmtree(TMP, ignore_errors=True)
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<11} {msg}", flush=True)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    pedidos = RAPIDOS if args == ["--rapido"] else (args or list(CHECKS))
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
