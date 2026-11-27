"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tus índices ni el almacén.

    python verificar.py                      # todos
    python verificar.py fusion candidatos    # algunos

Necesita el entorno virtual activo (source .venv/bin/activate). Los checks fusion, candidatos y rerank llaman a tu
código con casos armados a mano (un buscador y un reranker de mentira, con la configuración de config.yaml); reranker,
permisos, medicion y reporte lo corren con el índice vigente, el reranker de verdad y el golden set, y comparan con la
verdad del mundo (mundo/referencia.py). La primera corrida tarda ≈ 20 s (el equipo puntúa sus pares y los guarda en
.taller/ref/); las siguientes, menos.
"""
from __future__ import annotations

import shutil
import signal
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
import numpy as np  # noqa: E402
import yaml  # noqa: E402

from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALMACEN, CONFIG, INDICES, VIGENTE, catalogo, hora, leer_json, modelos_faltantes, vigente  # noqa: E402

D = "@marketplace.test"


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
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
        raise Falla(f"{getattr(fn, '__module__', '')}.{getattr(fn, '__name__', fn)} no terminó en 60 s")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(60)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{getattr(fn, '__module__', '')}.{getattr(fn, '__name__', '')} todavía es el esqueleto ({e or 'NotImplementedError'})")
    except SystemExit as e:
        raise Falla(str(e.code))
    finally:
        signal.alarm(0)


def el_vigente() -> str:
    v = vigente()
    exige(v, "el alias c11 no apunta a nada (indices/alias.json): python mundo/crear.py")
    return v


def cfg() -> dict:
    return yaml.safe_load(CONFIG.read_text())


class BuscadorFalso:
    """Un buscador de mentira con listas armadas a mano: lo que verían tus funciones si los índices dieran esto."""

    def __init__(self, bm: list[str], ve: list[str], prohibidos: set[str] = frozenset()):
        self.lbm, self.lve, self.prohibidos = bm, ve, set(prohibidos)
        self.ids = sorted(set(bm) | set(ve))
        self.pedidos: list[int] = []
        self.nombre = "falso"

    def visibles(self, persona):
        return np.array([persona is None or k not in self.prohibidos for k in self.ids], dtype=bool)

    def _lista(self, l, puntaje, persona, k):
        self.pedidos.append(k)
        ok = dict(zip(self.ids, self.visibles(persona)))
        return [(c, puntaje(i)) for i, c in enumerate(l) if ok[c]][:k]

    def bm25(self, pregunta, persona, k=8):
        return self._lista(self.lbm, lambda i: 20.0 - 0.5 * i, persona, k)        # BM25: de 20 hacia abajo

    def vectores(self, pregunta, persona, k=8):
        return self._lista(self.lve, lambda i: 0.90 - 0.004 * i, persona, k)      # coseno: de 0.90 hacia abajo


class RerankerFalso:
    """Le da el puntaje más alto al chunk «elegido» y anota cuántos textos le pasaron."""

    def __init__(self, elegido_texto: str):
        self.elegido, self.recibio = elegido_texto, []

    def puntuar(self, pregunta, textos):
        self.recibio.append(len(textos))
        return np.array([10.0 if t == self.elegido else -float(i) / 100 for i, t in enumerate(textos)], dtype=np.float32)


def recuperador(buscador, reranker=None, textos: dict | None = None):
    r_ = modulo("recuperar")
    r = llamar(r_.Recuperador, buscador, reranker)
    if textos is not None:
        r.textos = textos
    return r


def ids_(r) -> list[str]:
    return [c for c, _ in r["top"]]


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    malos = modelos_faltantes()
    exige(not malos, lambda: f"faltan modelos o no son los del catálogo ({', '.join(malos)}): python mundo/modelos.py")
    c = leer_json(ALMACEN / "corpus" / "vigente.json")
    exige(c and len(c["chunks"]) == 151, "falta el almacén: python mundo/crear.py")
    d = leer_json(ALMACEN / "directorio.json")
    v, items = ref.golden()
    exige(len(items) == 65, f"almacen/golden/{v} no es el de la estación 4: python mundo/crear.py --golden")
    exige((INDICES / VIGENTE / "manifiesto.json").exists(), f"falta el índice de la estación 5 ({VIGENTE}): python mundo/crear.py")
    exige(vigente() == VIGENTE, f"el alias c11 no apunta a {VIGENTE}: python mundo/crear.py")
    exige("retrieval" in cfg(), "config.yaml no tiene la sección retrieval: cópialo de mundo/esqueleto/config.yaml")
    m = leer_json(ALMACEN / "mundo.json")
    return (f"{hora(m['reloj'])} · {c['version']}: {len(c['chunks'])} chunks de {len({x['doc_id'] for x in c['chunks'].values()})} documentos · "
            f"{len(d['personas'])} personas · {v} con {len(items)} preguntas · e5 y reranker con su sha256 · c11 → {vigente()}")


def check_fusion() -> str:
    f = modulo("fusion")
    bm = [("a", 14.2), ("b", 9.8), ("c", 7.1)]
    ve = [("c", 0.88), ("d", 0.86), ("a", 0.84)]
    r = llamar(f.rrf, [bm, ve], 60)
    bien = [("a", 1 / 61 + 1 / 63), ("c", 1 / 63 + 1 / 61), ("b", 1 / 62), ("d", 1 / 62)]
    exige([c for c, _ in r] == [c for c, _ in bien] and all(abs(p - q) < 1e-12 for (_, p), (_, q) in zip(r, bien)),
          lambda: f"rrf() con BM25 [a, b, c] y vectores [c, d, a] tiene que dar {[(c, round(p, 5)) for c, p in bien]} (empates por chunk_id); dio {[(c, round(p, 5)) for c, p in r]}")
    r = llamar(f.rrf, [bm, ve], 1)
    exige(abs(dict(r)["a"] - (1 / 2 + 1 / 4)) < 1e-12, "rrf(k=1): a está 1.º en BM25 y 3.º en vectores: 1/(1+1) + 1/(1+3) = 0.75")
    s = llamar(f.suma, [bm, ve])
    exige([c for c, _ in s] == ["a", "b", "c", "d"], lambda: f"suma() tiene que dar a, b, c, d (BM25 manda: sus números son más grandes); dio {[c for c, _ in s]}")
    try:
        f.fusionar([bm, ve], "promedio")
        raise Falla("fusionar(..., 'promedio') tiene que dar ValueError: solo hay rrf y suma")
    except ValueError:
        pass
    # tu Recuperador, con la configuración de config.yaml: BM25 y vectores encuentran cosas distintas
    lbm = [f"b{i:02d}" for i in range(8)]
    lve = ["b07"] + [f"v{i:02d}" for i in range(7)]
    r = llamar(recuperador(BuscadorFalso(lbm, lve)).recuperar, "q", "ana", "fusion")
    c = cfg()["retrieval"]
    bien = ref.rrf([lbm, lve], c["rrf_k"])[:c["k"]]
    exige(ids_(r) == bien, lambda: f"con BM25 [b00…b07] y vectores [b07, v00…v06], recuperar(modo fusion) con retrieval.fusion: "
          f"{c['fusion']} dio {', '.join(ids_(r))}; por RRF son {', '.join(bien)}: b07 (en las dos) primero, y luego "
          f"alternados. Sumar los puntajes crudos deja arriba a todo BM25 (≈ 20 contra ≈ 0.9 del coseno)")
    return (f"RRF suma 1/(k + lugar): a = 1/61 + 1/63 = {1 / 61 + 1 / 63:.5f} · con k=1 el lugar 1 vale 0.5 y el 3 0.25 · la suma "
            f"cruda la gana BM25 · tu Recuperador fusiona por {c['fusion']} con k={c['rrf_k']}")


def check_candidatos() -> str:
    # z está 10.º en las dos listas; los demás aparecen en una sola. Por RRF, z va primero: 2/(60+10) > 1/(60+1)
    lbm = [f"b{i:02d}" for i in range(9)] + ["z"] + [f"b{i:02d}" for i in range(9, 29)]
    lve = [f"v{i:02d}" for i in range(9)] + ["z"] + [f"v{i:02d}" for i in range(9, 29)]
    bf = BuscadorFalso(lbm, lve)
    r = llamar(recuperador(bf).recuperar, "q", "ana", "fusion")
    c = cfg()["retrieval"]
    exige(set(bf.pedidos) == {c["candidatos"]}, lambda: f"recuperar() le pidió {sorted(set(bf.pedidos))} a cada índice y config dice retrieval.candidatos: {c['candidatos']}")
    exige("z" in ids_(r)[:1], lambda: f"z está en el lugar 10 de BM25 y de vectores: por RRF le toca el 1.º (2/70 = 0.0286 contra "
          f"1/61 = 0.0164 de quien es 1.º en una sola), y tu top-8 fue {', '.join(ids_(r))}. Con retrieval.candidatos: "
          f"{c['candidatos']}, cada índice corta antes de que z llegue a la fusión: corta después de fusionar, no antes")
    exige(c["candidatos"] >= c["rerank_n"], lambda: f"retrieval.candidatos ({c['candidatos']}) es menor que rerank_n ({c['rerank_n']}): el reranker no tendría a quién leer")
    return f"pide {c['candidatos']} a cada índice antes de fusionar · z (10.º en las dos listas) sale 1.º: 2/70 > 1/61"


def check_reranker() -> str:
    m = modulo("reranker")
    r = llamar(m.Reranker)
    f = llamar(r.firma)
    cat = catalogo()["reranker"]
    exige(f == {"clave": "reranker", "repo": cat["repo"], "revision": cat["revision"], "sha256": cat["archivos"]["model.onnx"]["sha256"]},
          lambda: f"Reranker().firma() no es la del catálogo: {f}")
    q = "¿Cuánto tarda un reembolso a tarjeta?"
    ch = ref.corpus()["chunks"]
    textos = ["Los reembolsos a tarjeta de débito tardan de 5 a 10 días hábiles.", "El calendario de pagos a vendedores sale los lunes."] + \
             [ch[k]["texto"] for k in sorted(ch)[::40][:3]]
    s = llamar(r.puntuar, q, textos)
    exige(isinstance(s, np.ndarray) and s.dtype == np.float32 and s.shape == (len(textos),),
          lambda: f"puntuar() tiene que dar un ndarray float32 de forma ({len(textos)},); dio {type(s).__name__} {getattr(s, 'dtype', '')} {getattr(s, 'shape', '')}")
    bien = ref.reranker(q, textos)
    exige(np.allclose(s, bien, atol=1e-3), lambda: f"los puntajes no son los del modelo: {s.round(2).tolist()} en vez de {bien.round(2).tolist()} "
          "(¿el par va junto, (pregunta, pasaje), en una sola codificación? ¿el logit de la columna 0?)")
    exige(llamar(r.puntuar, q, []).shape == (0,), "puntuar() con textos vacío tiene que dar un arreglo vacío")
    o = llamar(m.reordenar, r, q, ["x", "y"], {"x": textos[1], "y": textos[0]})
    exige([c for c, _ in o] == ["y", "x"], "reordenar() tiene que regresar de mayor a menor puntaje")
    return f"{cat['repo']} @ {cat['revision'][:12]} · «reembolsos a tarjeta» {s[0]:.2f} contra «pagos a vendedores» {s[1]:.2f}"


def check_rerank() -> str:
    lbm = [f"b{i:02d}" for i in range(30)]
    lve = [f"v{i:02d}" for i in range(30)]
    c = cfg()["retrieval"]
    fus = ref.rrf([lbm, lve], c["rrf_k"])
    elegido = fus[15]                    # el reranker sabe que el 16.º de la fusión es el bueno
    textos = {k: f"texto de {k}" for k in lbm + lve}
    rf = RerankerFalso(textos[elegido])
    r = llamar(recuperador(BuscadorFalso(lbm, lve), rf, textos).recuperar, "q", "ana", "completo")
    exige(rf.recibio, "recuperar(modo completo) no llamó al reranker")
    exige(rf.recibio == [c["rerank_n"]], lambda: f"el reranker recibió {rf.recibio} textos y config dice retrieval.rerank_n: {c['rerank_n']}")
    exige(len(r["top"]) == c["k"], lambda: f"el modo completo dio {len(r['top'])} chunks y retrieval.k es {c['k']}")
    exige(ids_(r)[:1] == [elegido], lambda: f"el reranker le da el puntaje más alto a {elegido}, el 16.º de la fusión, y tu top-8 fue "
          f"{', '.join(ids_(r))}. Con retrieval.rerank_n: {c['rerank_n']} nunca lo lee: si el reranker solo ve los primeros "
          f"{c['rerank_n']}, no puede subir nada que la fusión dejó más abajo (con rerank_n = k, el recall@k es el de la fusión)")
    exige(c["rerank_n"] > c["k"], lambda: f"rerank_n ({c['rerank_n']}) tiene que ser mayor que k ({c['k']})")
    return f"el reranker lee {c['rerank_n']} de la fusión y salen {c['k']} · sube al 1.º al que la fusión dejó 16.º"


def check_permisos() -> str:
    b_ = modulo("buscar")
    rr_ = modulo("reranker")
    rec = recuperador(llamar(b_.abrir), llamar(rr_.Reranker))
    _, items = ref.golden()
    d = ref.directorio()
    c = cfg()["retrieval"]
    preguntas = [x["pregunta"] for x in items if x["split"] == "test"][::9][:3]
    vistos, cortos = {}, []
    for p in sorted(d["personas"]):
        ve = ref.visibles(p)
        vistos[p] = len(ve)
        for q in preguntas:
            r = llamar(rec.recuperar, q, p, "fusion")
            malos = [x for x in ids_(r) if x not in ve]
            exige(not malos, lambda: f"{p} recibió {', '.join(malos[:3])}, que no puede ver")
            if len(ve) >= c["k"] and len(r["top"]) < c["k"]:
                cortos.append((p, len(ve), len(r["top"]), q))
    exige(not cortos, lambda: f"{cortos[0][0]} ve {cortos[0][1]} chunks y recibió {cortos[0][2]} con «{cortos[0][3]}» "
          f"({len(cortos)} búsquedas cortas): con retrieval.filtro: {c['filtro']}, cada índice elige sus candidatos entre todos "
          "y luego se quitan los prohibidos, así que llegan menos. Primero se filtra y después se elige (estación 3)")
    pro = [x for x in items if x["tipo"] == "prohibida"]
    for x in pro:
        for modo in ("fusion", "completo"):
            fs = {f["chunk_id"] for f in x["fuentes"]}
            got = set(ids_(llamar(rec.recuperar, x["pregunta"], x["persona"], modo))) & fs
            exige(not got, lambda: f"{x['id']} ({x['persona']}) recibió su fuente prohibida {', '.join(got)} en modo {modo}")
    con = {p: n for p, n in vistos.items() if n}
    poco = min(con, key=con.get)
    return (f"{len(d['personas'])} personas × {len(preguntas)} preguntas: nadie recibe lo que no ve y todos reciben {c['k']} si ven {c['k']} o más "
            f"(quien menos ve: {poco.split('@')[0]}, {con[poco]}) · {len(pro)} prohibidas sin fuga, en fusión y con reranker")


def check_medicion() -> str:
    me = modulo("medir")
    b_ = modulo("buscar")
    rr_ = modulo("reranker")
    m = cfg()["medicion"]
    exige(set(m["tipos"]) <= {"directa", "varias"} and m["tipos"],
          lambda: f"config medicion.tipos es {m['tipos']}: el recall solo se mide con las que tienen fuentes que buscar (directa y varias); "
          "sin_respuesta no tiene fuentes y en prohibida la fuente es lo que no debe llegar: se miden aparte")
    exige(m["split"] != m["afinado_con"], lambda: f"config medicion.split y afinado_con son los dos «{m['split']}»: con esas preguntas se eligen rrf_k y rerank_n, "
          "y medir con ellas da un número optimista")
    for t in (["directa", "varias", "sin_respuesta"], ["directa", "prohibida"]):
        try:
            import recuperar as _r
            cf = cfg() | {"medicion": m | {"tipos": t}}
            com = sys.modules["_comun"]
            viejos = me.config, com.config
            me.config = com.config = (lambda cf=cf: cf)
            try:
                me.medir(_r.Recuperador(b_.abrir()), [], ("fusion",))
            finally:
                me.config, com.config = viejos
            raise Falla(f"medir() con medicion.tipos {t} tiene que dar ValueError")
        except ValueError:
            pass
    try:
        llamar(me.revisar_split, m["afinado_con"])
        raise Falla(f"revisar_split('{m['afinado_con']}') tiene que dar ValueError: es el split con el que se afina")
    except ValueError:
        pass
    llamar(me.revisar_split, m["split"])
    _, items = ref.golden()
    sub = [x for x in items if x["split"] == m["split"]][::6]
    rec = recuperador(llamar(b_.abrir), llamar(rr_.Reranker))
    r = llamar(me.medir, rec, sub, ("bm25", "fusion", "completo"))
    c = cfg()["retrieval"]
    for modo in ("bm25", "fusion", "completo"):
        bien = []
        for x in sub:
            if x["tipo"] in m["tipos"]:
                fs = {f["chunk_id"] for f in x["fuentes"]}
                bien.append(len(fs & set(ref.recuperar(x["pregunta"], x["persona"], modo, c))) / len(fs))
        exige(r[modo]["n"] == len(bien), lambda: f"medir() contó {r[modo]['n']} preguntas en {modo} y con fuentes que buscar hay {len(bien)}")
        exige(abs(r[modo]["recall"] - sum(bien) / len(bien)) < 1e-9, lambda: f"medir() da recall@8 = {r[modo]['recall']:.1%} en {modo} y es {sum(bien) / len(bien):.1%}")
        exige(set(r[modo]["por_tipo"]) == set(m["tipos"]), lambda: f"por_tipo de {modo} tiene {sorted(r[modo]['por_tipo'])}: van los de medicion.tipos")
        exige(r[modo]["ms"]["p50"] >= 0 and "p95" in r[modo]["ms"], "cada modo trae ms: {p50, p95}")
    exige(r["completo"]["ms"]["p50"] > r["fusion"]["ms"]["p50"], "el modo completo tiene que tardar más que la fusión: el reranker cuesta")
    return (f"{len(sub)} preguntas de muestra ({m['split']}): tu recall@8 coincide con el del equipo en bm25, fusión y completo · "
            f"solo {' y '.join(m['tipos'])} entran al recall · {m['afinado_con']} queda para afinar")


def check_reporte() -> str:
    v = el_vigente()
    p = INDICES / v / "retrieval.json"
    rep = leer_json(p)
    exige(rep, f"falta indices/{v}/retrieval.json: python pipeline/medir.py (paso 6)")
    m, c = cfg()["medicion"], cfg()["retrieval"]
    exige(rep["split"] != m["afinado_con"], lambda: f"el reporte se midió con {rep['split']}, el split con el que se afinan rrf_k y rerank_n: es optimista")
    exige(rep["split"] == m["split"], lambda: f"el reporte es de {rep['split']} y medicion.split dice {m['split']}")
    exige(rep["config"] == c, lambda: f"el reporte se midió con otra configuración ({ {k: rep['config'].get(k) for k in c if rep['config'].get(k) != c[k]} }) y "
          f"config.yaml dice { {k: c[k] for k in c if rep['config'].get(k) != c[k]} }: vuelve a medir (python pipeline/medir.py)")
    bien = ref.medir(c, rep["split"])
    n = bien["bm25"]["n"]
    for modo in ("bm25", "vectores", "fusion", "completo"):
        x = rep.get(modo)
        exige(x, f"al reporte le falta el modo {modo}")
        exige(x["n"] == n, lambda: f"el reporte cuenta {x['n']} preguntas en {modo} y con fuentes que buscar hay {n}: ¿entraron sin_respuesta o prohibidas?")
        exige(abs(x["recall"] - bien[modo]["recall"]) < 1e-9, lambda: f"el reporte dice recall@8 = {x['recall']:.1%} en {modo} y con esta configuración es {bien[modo]['recall']:.1%}")
        exige(x["fugas"] == 0, f"en {modo}, {x['fugas']} prohibida(s) recibieron su fuente")
    exige(rep["completo"]["recall"] >= max(rep["bm25"]["recall"], rep["vectores"]["recall"]), "fusión + reranker no le gana a cada índice solo")
    b = bien
    return (f"{rep['split']}, {n} preguntas, recall@8 · BM25 {b['bm25']['recall']:.1%} · vectores {b['vectores']['recall']:.1%} · fusión "
            f"{b['fusion']['recall']:.1%} · + reranker {b['completo']['recall']:.1%} (recall@3 {b['fusion']['recall@3']:.1%} → "
            f"{b['completo']['recall@3']:.1%}) · p50 del reranker {rep['completo']['ms']['p50'] - rep['fusion']['ms']['p50']:.0f} ms más")


CHECKS = {
    "mundo": check_mundo, "fusion": check_fusion, "candidatos": check_candidatos, "reranker": check_reranker, "rerank": check_rerank,
    "permisos": check_permisos, "medicion": check_medicion, "reporte": check_reporte,
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
            print(f"{'✓' if ok else '✗'} {i:<10} {msg}", flush=True)
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
