"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tu golden set ni el almacén.

    python verificar.py                    # todos
    python verificar.py esquema parecidas  # algunos

Necesita el entorno virtual activo (source .venv/bin/activate). Los checks esquema, parecidas, splits, contaminacion y
reanclaje llaman a tu código con casos de prueba; todos revisan además lo que publicaste (golden/) contra la verdad del
mundo (mundo/referencia.py): el corpus de hoy, el directorio de verdad y lo que pide el gate de C11.
"""
from __future__ import annotations

import copy
import signal
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALMACEN, CONFIG, DIAS, GOLDEN, hora, leer_json, leer_jsonl, mundo, vigente  # noqa: E402

D = "@marketplace.test"
MALAS = ["G-039", "G-080", "G-082", "G-083", "G-084", "G-085", "G-086"]   # lo que mandaron los expertos y no debe entrar


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
    """msg es un texto o una función que lo arma (para no armarlo cuando no hace falta)."""
    if not cond:
        raise Falla(msg() if callable(msg) else msg)


def modulo(nombre: str):
    import importlib

    try:
        return importlib.import_module(nombre)
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar {nombre}: {e}")


def llamar(fn, *a, **k):
    def alarma(*_):
        raise Falla(f"{fn.__module__}.{fn.__name__} no terminó en 10 s")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(10)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{fn.__module__}.{fn.__name__} todavía es el esqueleto ({e or 'NotImplementedError'})")
    except SystemExit as e:
        raise Falla(str(e.code))
    finally:
        signal.alarm(0)


def lista(xs, n: int = 4) -> str:
    xs = sorted(xs)
    return ", ".join(xs[:n]) + (f" y {len(xs) - n} más" if len(xs) > n else "")


def publicado(paso: str = "6") -> tuple[str, list[dict], dict]:
    v = vigente()
    exige(v, f"no hay golden publicado (golden/VIGENTE): python pipeline/armar.py (paso {paso})")
    items = leer_jsonl(GOLDEN / v / "preguntas.jsonl")
    man = leer_json(GOLDEN / v / "manifiesto.json")
    exige(items and man, f"golden/{v}/ no trae preguntas.jsonl y manifiesto.json: el contrato está en pipeline/publicar.py")
    return v, items, man


def todas_las_versiones() -> list[tuple[str, list[dict], dict]]:
    out = []
    for linea in leer_jsonl(GOLDEN / "versiones.jsonl"):
        v = linea["version"]
        out.append((v, leer_jsonl(GOLDEN / v / "preguntas.jsonl"), leer_json(GOLDEN / v / "manifiesto.json", {})))
    return out


def base(id_: str) -> dict:
    return copy.deepcopy(next(x for x in ref.candidatas() if x["id"] == id_))


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    m = mundo()
    exige((ALMACEN / "corpus" / "vigente.json").exists() and (ALMACEN / "directorio.json").exists(), "falta el almacén: python mundo/crear.py")
    exige(CONFIG.exists(), "falta config.yaml")
    c = ref.hoy()
    docs = {x["doc_id"] for x in c["chunks"].values()}
    cs = leer_jsonl(ALMACEN / "candidatos" / "expertos.jsonl")
    return (f"{hora(m['reloj'])} · {c['version']}: {len(c['chunks'])} chunks de {len(docs)} documentos, cada uno con su ACL · "
            f"{len(ref.directorio()['personas'])} personas · {len(cs)} candidatas de {len({x['autor'] for x in cs})} expertos · "
            f"{len(leer_jsonl(ALMACEN / 'afinado' / 'ejemplos.jsonl'))} ejemplos de afinado")


def check_esquema() -> str:
    m = modulo("esquema")
    ok = base("G-001")
    exige(llamar(m.estructura, ok) == [], f"estructura() de una candidata bien hecha (G-001) tiene que dar [], dio {llamar(m.estructura, ok)}")
    malos = [
        ({k: v for k, v in ok.items() if k != "respuesta"}, "sin respuesta de referencia"),
        (ok | {"tipo": "dificil"}, "un tipo que no existe"),
        (ok | {"id": "1"}, "un id que no es G-<3 dígitos>"),
        (ok | {"fuentes": []}, "una directa sin fuentes"),
        (ok | {"tipo": "sin_respuesta"}, "una sin_respuesta con fuentes"),
        (ok | {"tipo": "varias"}, "una con varias fuentes que trae una sola"),
        (ok | {"fuentes": ["wiki:1001#001", "wiki:1001#001"]}, "fuentes repetidas"),
        (ok | {"fuentes": ["wiki 1001"]}, "una fuente que no es un chunk_id"),
        (ok | {"nota": "x"}, "un campo que no está en el esquema"),
        (ok | {"respuesta": ""}, "una respuesta vacía"),
        ("G-001", "algo que ni siquiera es un objeto"),
    ]
    for x, por in malos:
        e = llamar(m.estructura, x)
        exige(isinstance(e, list) and e, f"estructura() deja pasar {por}: tu esquema/candidata.schema.json no lo atrapa")
    dos = llamar(m.estructura, ok | {"tipo": "dificil", "respuesta": ""})
    exige(len(dos) >= 2, "estructura() da todos los errores, no solo el primero (iter_errors, no validate)")
    return f"una candidata bien hecha pasa y {len(malos)} mal hechas no: falta un campo, tipo que no existe, fuentes que no cuadran con su tipo, campos de más · todos los errores a la vez"


def check_reglas() -> str:
    m = modulo("esquema")
    c, d = ref.corpus("corpus-2026-11-21"), ref.directorio()
    reglas = [
        (base("G-001"), True, "una directa que la persona puede ver"),
        (base("G-072") | {"persona": "luis.campos@paqueteria-aliada.test"}, True, "una prohibida que de verdad no ve"),
        (base("G-060"), True, "una sin respuesta"),
        (base("G-048"), True, "una con dos documentos que la persona ve"),
        (base("G-082"), False, "una fuente que no existe"),
        (base("G-039"), False, "una directa cuya persona no ve su fuente (Tomás ya no está en fraude)"),
        (base("G-072") | {"persona": f"ana.ruiz{D}"}, False, "una prohibida que la persona sí ve"),
        (base("G-083"), False, "una con «varias fuentes» que son del mismo documento"),
        (base("G-040") | {"tipo": "directa"}, False, "una directa con fuentes de dos documentos"),
        (base("G-001") | {"persona": f"nadie{D}"}, False, "una persona que no está en el directorio"),
    ]
    for x, bien, por in reglas:
        e = llamar(m.reglas, x, c, d)
        exige(isinstance(e, list), "reglas() devuelve una lista de errores")
        exige(bool(e) != bien, f"reglas() con {por} tiene que dar " + ("[]" if bien else "un error") + f", dio {e}")
    v = vigente()
    if v:
        dentro = {x["id"] for x in leer_jsonl(GOLDEN / v / "preguntas.jsonl")} & set(MALAS)
        exige(not dentro, f"{v} trae {lista(dentro)}, que los expertos mandaron mal (mira golden/{v}/rechazadas.jsonl)")
    return (f"{len(reglas)} casos: fuente que no existe, persona que no ve su fuente, prohibida que sí ve, «varias» de un solo documento, "
            "persona que no está" + (f" · {v} no trae ninguna de las {len(MALAS)} que los expertos mandaron mal" if v else ""))


def check_parecidas() -> str:
    m = modulo("parecidas")
    exige(abs(llamar(m.similitud, "¿Cuánto tarda en verse un reembolso a tarjeta de débito?",
                     "¿Cuántos días tarda en verse el reembolso en una tarjeta de débito?") - 5 / 6) < 1e-9,
          "similitud() es Jaccard sobre palabras(): esas dos dan 5/6 = 0.83")
    exige(llamar(m.similitud, "¿qué?", "¿y?") == 0, "dos textos sin palabras dan 0")
    xs = [base("G-001"), base("G-080"), base("G-072"), base("G-002"), base("G-081")]
    ps = [(a, b) for a, b, _ in llamar(m.pares, xs, 0.6)]
    exige(ps == [("G-001", "G-080"), ("G-002", "G-081")], f"pares(…, 0.6) tiene que dar G-001/G-080 y G-002/G-081 (G-072 es prohibida: otro tipo), dio {ps}")
    quedan, fuera = llamar(m.quitar, xs, 0.6, publicados={"G-080"})
    exige({x["id"] for x in quedan} == {"G-080", "G-072", "G-002"} and {i for i, _, _ in fuera} == {"G-001", "G-081"},
          f"quitar(…, publicados={{G-080}}): se queda la ya publicada (G-080) y sale G-001; quedaron {sorted(x['id'] for x in quedan)}")
    if not vigente():
        return "Jaccard sobre palabras, solo entre preguntas del mismo tipo · lo publicado se revisa cuando haya golden (paso 6)"
    v, items, _ = publicado()
    malos = [(a["id"], b["id"], ref.similitud(a["pregunta"], b["pregunta"])) for i, a in enumerate(items) for b in items[i + 1:]
             if a["tipo"] == b["tipo"] and ref.similitud(a["pregunta"], b["pregunta"]) >= ref.UMBRAL]
    exige(not malos, lambda: f"{v} trae preguntas casi iguales: {malos[0][0]} y {malos[0][1]} ({malos[0][2]:.2f}) y {len(malos) - 1} par(es) más "
          f"(en C11 la regla es Jaccard ≥ {ref.UMBRAL}: ¿config.yaml parecidas.umbral?)")
    n = len(items)
    return f"Jaccard sobre palabras, solo entre preguntas del mismo tipo · {v}: {n * (n - 1) // 2} pares revisados, ninguno ≥ {ref.UMBRAL}"


def check_splits() -> str:
    m = modulo("splits")
    ids = [f"G-{i:03d}" for i in range(1, 400)]
    mal = [i for i in ids if llamar(m.split_de, i, ref.SAL, ref.TEST) != ref.split_de(i)]
    exige(not mal, lambda: f"split_de({mal[0]!r}, 'golden-c11', 75) da {llamar(m.split_de, mal[0], ref.SAL, ref.TEST)} y es {ref.split_de(mal[0])}: "
          "los primeros 8 hex del sha256 de «sal|id», módulo 100")
    t = sum(ref.split_de(i) == "test" for i in ids)
    a = llamar(m.asignar, ["G-001", "G-009", "G-500"], {"G-001": "dev"}, "otra-sal", 10)
    exige(a == {"G-001": "dev", "G-009": m.split_de("G-009", "otra-sal", 10), "G-500": m.split_de("G-500", "otra-sal", 10)},
          f"asignar() respeta el split que ya tenía un id (G-001 era dev) y usa split_de() para los nuevos; dio {a}")
    vs = todas_las_versiones()
    if not vs:
        return f"por hash del id: de 399 ids, {t} a test ({t / 399:.0%}) · lo publicado se revisa cuando haya golden (paso 6)"
    primero = {}
    for v, items, _ in vs:
        for x in items:
            if x["id"] in primero:
                exige(x["split"] == primero[x["id"]][0], f"{x['id']} era {primero[x['id']][0]} en {primero[x['id']][1]} y en {v} es {x['split']}: un split no se mueve")
            else:
                exige(x["split"] == ref.split_de(x["id"]), f"{x['id']} entró a {v} como {x['split']} y su hash dice {ref.split_de(x['id'])} "
                      "(¿cambió splits.sal o splits.test en config.yaml?)")
                primero[x["id"]] = (x["split"], v)
    v, items, _ = vs[-1]
    nt = sum(x["split"] == "test" for x in items)
    return (f"por hash del id: de 399 ids, {t} a test ({t / 399:.0%}) · {len(primero)} preguntas en {len(vs)} versión(es), ninguna cambió de split · "
            f"{v}: test {nt}, dev {len(items) - nt}")


def check_contaminacion() -> str:
    m = modulo("contaminacion")
    a = base("G-015") | {"split": "test"}
    b = base("G-009") | {"split": "dev"}
    ej = leer_jsonl(ref.ENTRADA / "afinado" / "ejemplos.jsonl")
    r = [(i, e) for i, e, _ in llamar(m.contaminadas, [a, b], ej, 0.6)]
    exige(r == [("G-015", "A-06")], f"contaminadas() con G-015 en test y G-009 en dev tiene que dar solo G-015/A-06 (dev sí se usa para afinar), dio {r}")
    if not vigente():
        return "dev se vale para afinar, test no · lo publicado se revisa cuando haya golden (paso 6)"
    v, items, man = publicado()
    ej = leer_jsonl(ALMACEN / "afinado" / "ejemplos.jsonl")
    sucias = [(x["id"], e["id"], ref.similitud(x["pregunta"], e["pregunta"])) for x in items if x["split"] == "test" for e in ej
              if ref.similitud(x["pregunta"], e["pregunta"]) >= ref.UMBRAL]
    exige(not sucias, lambda: f"{v}: {sucias[0][0]} es de test y se parece {sucias[0][2]:.2f} al ejemplo {sucias[0][1]} de almacen/afinado/: "
          f"el examen ya no mide, el sistema se lo sabe" + (f" (y {len(sucias) - 1} más)" if len(sucias) > 1 else ""))
    quemadas = set()
    for vv, its, mm in todas_las_versiones():
        volvio = quemadas & {x["id"] for x in its}
        exige(not volvio, f"{lista(volvio)} se quemó en una versión anterior y volvió en {vv}: una quemada no vuelve")
        quemadas |= set(mm.get("quemadas", []))
    nt = sum(x["split"] == "test" for x in items)
    return f"{v}: {nt} preguntas de test contra {len(ej)} ejemplos de afinado, ninguna se parece · quemadas: {lista(quemadas) or 'ninguna'}"


def check_publicar() -> str:
    import hashlib

    lineas = leer_jsonl(GOLDEN / "versiones.jsonl")
    exige(lineas, "no hay golden/versiones.jsonl: python pipeline/armar.py (paso 6)")
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
    for n, linea in enumerate(lineas, 1):
        v = linea["version"]
        exige(v == f"golden-v{n}", f"la versión {n} de versiones.jsonl se llama {v}: van golden-v1, golden-v2… sin huecos")
        local, man, reg = GOLDEN / v / "preguntas.jsonl", leer_json(GOLDEN / v / "manifiesto.json"), ALMACEN / "registro" / "golden" / v
        exige(local.exists() and man, f"falta golden/{v}/ (su copia buena está en el registro)")
        exige(reg.exists(), f"{v} no está en el registro (almacen/registro/golden/): publicar() la sube con subir()")
        falta = [k for k in ("version", "anterior", "creado", "sha256", "n", "por_tipo", "por_split", "cambios", "corpus", "directorio") if k not in man]
        exige(not falta, f"el manifiesto de {v} no trae {falta}")
        s_local, s_reg = sha(local), sha(reg / "preguntas.jsonl")
        exige(s_reg == linea["sha256"], f"{v}: el registro y versiones.jsonl no coinciden")
        exige(s_local == s_reg, f"golden/{v}/preguntas.jsonl ya no es la que se publicó: sha256 {s_local[:12]} y el registro tiene {s_reg[:12]} "
              "(alguien la editó en su lugar; la copia buena es la del registro)")
        exige(man["sha256"] == s_reg, f"el manifiesto local de {v} dice sha256 {man['sha256'][:12]} y el registro tiene {s_reg[:12]}")
        exige(man["n"] == len(leer_jsonl(local)), f"el manifiesto de {v} dice {man['n']} preguntas y trae {len(leer_jsonl(local))}")
    exige(vigente() == lineas[-1]["version"], f"golden/VIGENTE dice {vigente()} y la última publicada es {lineas[-1]['version']}")
    return (f"{len(lineas)} versión(es), cada una igual en golden/, en su manifiesto, en versiones.jsonl y en el registro "
            f"(sha256 de la vigente {lineas[-1]['sha256'][:12]}) · VIGENTE = {lineas[-1]['version']}")


def check_cobertura() -> str:
    v, items, _ = publicado()
    n = len(items)
    for t, q in ref.CUOTAS.items():
        k = sum(x["tipo"] == t for x in items)
        exige(k >= q * n, f"{v}: {k} de {n} preguntas son {t} ({k / n:.0%}) y el gate de C11 pide al menos {q:.0%}"
              + (": sin ellas, un sistema que inventa respuestas pasa el examen" if t == "sin_respuesta" else ""))
    test = [x for x in items if x["split"] == "test"]
    exige(len(test) >= 0.6 * n, f"{v}: solo {len(test)} de {n} preguntas en test")
    falta = [t for t in ("directa", "varias", "sin_respuesta", "prohibida") if not any(x["tipo"] == t for x in test)]
    exige(not falta, lambda: f"{v}: test no trae ninguna {falta[0]}")
    gente = {x["persona"] for x in items}
    return (f"{v}: {n} preguntas · " + " · ".join(f"{t} {sum(x['tipo'] == t for x in items)}" for t in ("directa", "varias", "sin_respuesta", "prohibida")) +
            f" · {len(test)} en test, con los cuatro tipos · {len(gente)} personas distintas preguntan")


def check_permisos() -> str:
    v, items, man = publicado()
    c, d = ref.hoy(), ref.directorio()
    exige(man.get("directorio") == d["foto"], f"{v} se armó con el directorio de las {hora(man.get('directorio') or '2000-01-01T00:00:00Z')} "
          f"y el de la empresa es el de las {hora(d['foto'])}: con la foto vieja, los permisos de las preguntas son los de antes")
    for x in items:
        cs = [c["chunks"].get(f["chunk_id"]) for f in x["fuentes"]]
        if any(ch is None for ch in cs):
            continue  # eso lo dice el check fuentes
        ves = [ref.ve(x["persona"], ch) for ch in cs]
        if x["tipo"] in ("directa", "varias"):
            exige(all(ves), lambda: f"{v}: {x['id']} ({x['tipo']}) espera que {x['persona'].split('@')[0]} reciba {x['fuentes'][ves.index(False)]['chunk_id']}, "
                  "que no puede ver: el gate premiaría una fuga")
        if x["tipo"] == "prohibida":
            exige(not any(ves), lambda: f"{v}: {x['id']} es prohibida y {x['persona'].split('@')[0]} sí puede ver {x['fuentes'][ves.index(True)]['chunk_id']}")
    pro = [x for x in items if x["tipo"] == "prohibida"]
    return (f"{v}, con el directorio de las {hora(d['foto'])}: cada persona ve todas las fuentes de sus directas y con varias fuentes, "
            f"y ninguna de sus {len(pro)} prohibidas ({len({x['persona'] for x in pro})} personas)")


def check_fuentes() -> str:
    v, items, man = publicado()
    c = ref.hoy()
    exige(man.get("corpus") == c["version"], f"{v} está anclada a {man.get('corpus')} y el corpus de hoy es {c['version']}: python pipeline/reanclar.py")
    malas = []
    for x in items:
        for f in x["fuentes"]:
            ch = c["chunks"].get(f["chunk_id"])
            if ch is None:
                malas.append(f"{x['id']}: {f['chunk_id']} ya no existe")
            elif ref.sha(ch["texto"]) != f["sha"] or ch["doc_id"] != f["doc_id"]:
                malas.append(f"{x['id']}: {f['chunk_id']} existe pero su texto es otro")
    exige(not malas, lambda: f"{v}: {malas[0]}" + (f" (y {len(malas) - 1} fuente(s) más)" if len(malas) > 1 else ""))
    n = sum(len(x["fuentes"]) for x in items)
    return f"{v}: sus {n} fuentes existen en {c['version']} con el mismo texto que leyó el experto (sha de cada chunk)"


def check_reanclaje() -> str:
    m = modulo("reanclar")
    ch = lambda d, t: {"doc_id": d, "titulo": d, "texto": t, "acl": [["domain:x.test"]], "url": ""}  # noqa: E731
    viejo = {"chunks": {"a#000": ch("a", "A\n\n# A\nuno"), "a#001": ch("a", "A › Dos\n\n## Dos\ndos"), "a#002": ch("a", "A › Tres\n\n## Tres\ntres"),
                        "b#000": ch("b", "B\n\n# B\nbe"), "c#000": ch("c", "C\n\n# C\nce")}}
    nuevo = {"chunks": {"a#000": ch("a", "A\n\n# A\nuno"), "a#001": ch("a", "A › Nueva\n\n## Nueva\nnueva"),
                        "a#002": ch("a", "A › Dos\n\n## Dos\ndos\n\n## Tres\ntres"), "b#000": ch("b", "B\n\n# B\nve")}}
    r = llamar(m.mapa, viejo, nuevo)
    bien = {"a#000": {"a": "a#000", "por": "sha"}, "a#001": {"a": "a#002", "por": "contenido"}, "a#002": {"a": "a#002", "por": "contenido"},
            "b#000": {"a": None, "por": "cambio"}, "c#000": {"a": None, "por": "borrado"}}
    for k, x in bien.items():
        exige(r.get(k) == x, f"mapa(): {k} tiene que dar {x}, dio {r.get(k)}")
    exige(mundo()["dia"] >= "22", "falta la re-ingesta del 22: python mundo/avanzar.py y python pipeline/reanclar.py (paso 7)")
    v, items, man = publicado("7")
    hoy = ref.version_hoy()
    exige(man.get("corpus") == hoy, f"{v} sigue anclada a {man.get('corpus')} y el corpus de hoy es {hoy}: python pipeline/reanclar.py")
    v1 = leer_jsonl(GOLDEN / "golden-v1" / "preguntas.jsonl")
    tiene = {x["id"]: x for x in items}
    cuenta = {"sigue": 0, "retirada": 0, "revisar": 0, "movida": 0}
    for x in v1:
        destino, fs = ref.destino([f["chunk_id"] for f in x["fuentes"]], "corpus-2026-11-21", hoy)
        cuenta[destino] += 1
        if destino != "sigue":
            exige(x["id"] not in tiene, f"{v} todavía trae {x['id']}: su fuente " + ("es de un documento que se borró" if destino == "retirada" else
                  "cambió de texto y un experto tiene que revisar la respuesta"))
        elif x["id"] in tiene:
            tuyas = [f["chunk_id"] for f in tiene[x["id"]]["fuentes"]]
            exige(tuyas == fs, f"{v}: {x['id']} apunta a {tuyas} y su texto está en {fs}")
            cuenta["movida"] += tuyas != [f["chunk_id"] for f in x["fuentes"]]
    return (f"del corpus del 21 al de hoy ({hoy}): de las {len(v1)} preguntas de golden-v1, {cuenta['sigue']} siguen ({cuenta['movida']} con "
            f"fuentes que cambiaron de id), {cuenta['retirada']} retirada(s) porque su documento se borró y {cuenta['revisar']} a revisión porque su texto cambió")


CHECKS = {
    "mundo": check_mundo, "esquema": check_esquema, "reglas": check_reglas, "parecidas": check_parecidas, "splits": check_splits, "contaminacion": check_contaminacion,
    "publicar": check_publicar, "cobertura": check_cobertura, "permisos": check_permisos, "fuentes": check_fuentes, "reanclaje": check_reanclaje,
}


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
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<13} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
