"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tus índices ni el almacén.

    python verificar.py                      # todos
    python verificar.py embeddings bm25      # algunos

Necesita el entorno virtual activo (source .venv/bin/activate). Los checks embeddings, cache, bm25, vectores, permisos,
construir, consulta y alias llaman a tu código con casos de prueba; los de índice revisan además lo que está detrás
del alias c11 contra la verdad del mundo (mundo/referencia.py): el corpus, el directorio, el catálogo de modelos y el
golden set. Los checks que re-embeben todo el corpus tardan unos segundos.
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

from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALMACEN, INDICES, PILOTO, alias, catalogo, hora, leer_json, leer_jsonl, modelos_faltantes, vigente  # noqa: E402

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


def chunks_muestra(n: int = 6) -> dict:
    c = ref.corpus()["chunks"]
    ids = sorted(c)
    return {k: c[k] for k in ids[:: max(1, len(ids) // n)][:n]}


def cos(a, b) -> np.ndarray:
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    return (a * b).sum(-1) / (np.linalg.norm(a, axis=-1) * np.linalg.norm(b, axis=-1))


def el_vigente(paso: str) -> str:
    v = vigente()
    exige(v, f"el alias c11 no apunta a nada (indices/alias.json): paso {paso}")
    return v


def el_nuevo(paso: str = "5") -> str:
    """El índice detrás del alias, o el último que construiste si el alias sigue en el piloto."""
    v = vigente()
    if v and v != PILOTO:
        return v
    hechos = sorted(p.name for p in INDICES.glob("c11-*") if p.name != PILOTO and (p / "manifiesto.json").exists())
    exige(hechos, f"todavía no construyes un índice tuyo: python pipeline/construir.py (paso {paso})")
    return hechos[-1]


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    malos = modelos_faltantes()
    exige(not malos, lambda: f"faltan modelos o no son los del catálogo ({', '.join(malos)}): python mundo/modelos.py")
    c = leer_json(ALMACEN / "corpus" / "vigente.json")
    exige(c and len(c["chunks"]) == 151, "falta el almacén: python mundo/crear.py")
    d = leer_json(ALMACEN / "directorio.json")
    v, items = ref.golden()
    exige(len(items) == 65, f"almacen/golden/{v} no es el de la estación 4: python mundo/crear.py --golden")
    exige((INDICES / PILOTO / "manifiesto.json").exists(), f"falta el índice del piloto ({PILOTO}): python mundo/crear.py")
    exige(vigente(), "el alias c11 no apunta a nada: python mundo/crear.py")
    docs = {x["doc_id"] for x in c["chunks"].values()}
    m = leer_json(ALMACEN / "mundo.json")
    return (f"{hora(m['reloj'])} · {c['version']}: {len(c['chunks'])} chunks de {len(docs)} documentos, cada uno con su ACL · "
            f"{len(d['personas'])} personas · {v} con {len(items)} preguntas · 2 modelos con su sha256 · c11 → {vigente()}")


def check_embeddings() -> str:
    m = modulo("embeber")
    textos = ["¿Cuánto tarda un reembolso a tarjeta?", next(iter(chunks_muestra(1).values()))["texto"]]
    for clave in ("e5", "minilm"):
        mo = llamar(m.Modelo, clave)
        f = llamar(mo.firma)
        cat = catalogo()[clave]
        exige(f == ref.firma(clave), lambda: f"Modelo('{clave}').firma() tiene que dar {ref.firma(clave)}, dio {f}")
        for tipo in ("pasaje", "consulta"):
            v = llamar(mo.embeber, textos, tipo)
            exige(isinstance(v, np.ndarray) and v.dtype == np.float32 and v.shape == (2, cat["dim"]),
                  lambda: f"embeber() tiene que dar un ndarray float32 de forma (2, {cat['dim']}); dio {type(v).__name__} {getattr(v, 'dtype', '')} {getattr(v, 'shape', '')}")
            normas = np.linalg.norm(v, axis=1)
            exige(np.allclose(normas, 1, atol=1e-4), lambda: f"{clave}: los vectores tienen que tener largo 1 y tienen {normas.round(3).tolist()}")
            r = ref.embeber(clave, textos, tipo)
            c = cos(v, r)
            exige((c > 0.9999).all(), lambda: f"{clave} como «{tipo}»: tus vectores no son los del modelo (coseno contra la verdad {c.round(3).tolist()}): "
                  "¿el prefijo, el mean pooling sin el relleno o el corte de tokens?")
        vacio = llamar(mo.embeber, [], "pasaje")
        exige(getattr(vacio, "shape", None) == (0, cat["dim"]), f"embeber([]) tiene que dar forma (0, {cat['dim']})")
    real = m.modelos

    def falso():
        x = real()
        x["minilm"]["archivos"]["model.onnx"]["sha256"] = "0" * 64
        return x

    m.modelos = falso
    try:
        try:
            m.Modelo("minilm")
            raise Falla("Modelo() cargó un model.onnx cuyo sha256 no es el del catálogo: tiene que levantar ValueError")
        except ValueError:
            pass
    finally:
        m.modelos = real
    q = ref.embeber("e5", textos[:1], "consulta")[0]
    p = ref.embeber("e5", textos[:1], "pasaje")[0]
    return (f"e5 y minilm con su firma (repo, revisión, sha256), vectores de 384 y largo 1, iguales a los del modelo con "
            f"«query: » y «passage: » (la misma frase como consulta y como pasaje: coseno {float(q @ p):.3f}) · un sha256 distinto no se carga")


def check_cache() -> str:
    m = modulo("embeber")
    tmp = RAIZ / ".taller" / "check-cache"
    shutil.rmtree(tmp, ignore_errors=True)
    real = m.CACHE
    m.CACHE = tmp
    try:
        mo = llamar(m.Modelo, "e5")
        ch = chunks_muestra(5)
        ids, mat, n1 = llamar(m.embeber_chunks, ch, mo)
        exige(ids == sorted(ch), "embeber_chunks: ids tiene que ser sorted(chunk_ids)")
        exige(n1 == 5, f"la primera vez, con el cache vacío, embeber_chunks tiene que embeber los 5 (dijo {n1})")
        exige((cos(mat, ref.embeber("e5", [ch[k]["texto"] for k in ids], "pasaje")) > 0.9999).all(), "los vectores de embeber_chunks no son los de pasaje")
        _, mat2, n2 = llamar(m.embeber_chunks, ch, mo)
        exige(n2 == 0, f"la segunda vez, sin cambios, no tiene que embeber nada (embebió {n2})")
        exige(np.array_equal(mat, mat2), "lo que sale del cache no es lo que se guardó")
        k0 = ids[0]
        ch2 = dict(ch) | {k0: dict(ch[k0], texto=ch[k0]["texto"] + " Actualizado.")}
        _, _, n3 = llamar(m.embeber_chunks, ch2, mo)
        exige(n3 == 1, f"si cambia el texto de un chunk, solo ese se vuelve a embeber (embebió {n3})")
        _, _, n4 = llamar(m.embeber_chunks, ch, llamar(m.Modelo, "minilm"))
        exige(n4 == 5, f"con otro modelo, nada del cache de e5 sirve: tiene que embeber los 5 (embebió {n4})")
        carpetas = sorted(p.name for p in tmp.iterdir())
        exige(carpetas == sorted(ref.etiqueta(x) for x in ("e5", "minilm")), f"el cache va en una carpeta por modelo y revisión ({ref.etiqueta('e5')}…); hay {carpetas}")
    finally:
        m.CACHE = real
        shutil.rmtree(tmp, ignore_errors=True)
    return "la llave es el modelo, su revisión y el sha del texto: sin cambios no se embebe nada; cambia un texto y solo se embebe ese; otro modelo empieza de cero"


def check_bm25() -> str:
    m = modulo("bm25")
    mini = {"a": {"texto": "reembolso tarjeta reembolso"}, "b": {"texto": "tarjeta pagos vendedores lunes"}, "c": {"texto": "horario soporte telefono"}}
    ix = llamar(m.construir, mini, 1.2, 0.75)
    for k in ("k1", "b", "N", "avgdl", "df", "docs"):
        exige(k in ix, f"construir() tiene que traer «{k}»")
    exige(ix["df"].get("tarjeta") == 2 and ix["docs"]["a"]["tf"].get("reembolso") == 2 and ix["docs"]["a"]["len"] == 3,
          "construir(): df = en cuántos chunks está cada palabra; tf = cuántas veces en cada chunk; len = cuántas palabras")
    i1 = llamar(m.idf, ix, "tarjeta")
    exige(abs(i1 - np.log(1 + (3 - 2 + 0.5) / (2 + 0.5))) < 1e-9, f"idf('tarjeta') con df 2 de 3 tiene que dar ln(1 + 1.5/2.5) = 0.470; dio {i1}")
    exige(llamar(m.idf, ix, "nada") == 0, "idf de una palabra que no está tiene que dar 0")
    c = ref.corpus()["chunks"]
    tuyo, bien = llamar(m.construir, c, 1.2, 0.75), ref.bm25(c)
    exige(tuyo["N"] == bien["N"] and abs(tuyo["avgdl"] - bien["avgdl"]) < 1e-9 and tuyo["df"] == bien["df"],
          "construir() sobre el corpus no da los mismos N, avgdl o df que la verdad: ¿las palabras salen de palabras() del texto completo?")
    _, items = ref.golden()
    for x in items[:12]:
        a, b = llamar(m.puntajes, tuyo, x["pregunta"]), ref.puntajes(bien, x["pregunta"])
        exige(set(a) == set(b) and all(abs(a[k] - b[k]) < 1e-9 for k in b),
              lambda: f"puntajes() para {x['id']} no da lo de la fórmula (con las palabras distintas de la consulta, k1 y b)")
    largo = max(c, key=lambda k: tuyo["docs"][k]["len"])
    return (f"{bien['N']} chunks, {len(bien['df'])} palabras distintas, {bien['avgdl']:.1f} por chunk en promedio (el más largo, {largo}, "
            f"{tuyo['docs'][largo]['len']}) · idf y los puntajes de 12 preguntas iguales a la fórmula")


def check_vectores() -> str:
    m = modulo("vectores")
    em = modulo("embeber")
    ch = chunks_muestra(6)
    ids, mat, filas = llamar(m.construir, ch, llamar(em.Modelo, "e5"))
    exige(ids == sorted(ch) and mat.shape == (6, 384) and mat.dtype == np.float32, "construir() tiene que dar ids ordenados y una matriz float32 (6, 384)")
    exige((cos(mat, ref.embeber("e5", [ch[k]["texto"] for k in ids], "pasaje")) > 0.9999).all(), "los vectores de construir() no son los de pasaje de cada chunk")
    exige(filas == [{"chunk_id": k, "modelo": ref.etiqueta("e5")} for k in ids], f"filas: [{{'chunk_id', 'modelo': '{ref.etiqueta('e5')}'}}] en el orden de ids")
    rng = np.random.default_rng(5)
    M = rng.normal(size=(20, 8)).astype(np.float32)
    M /= np.linalg.norm(M, axis=1, keepdims=True)
    q = M[3] + 0.1 * M[7]
    q /= np.linalg.norm(q)
    ids20 = [f"c{i:02d}" for i in range(20)]
    ok = np.zeros(20, bool)
    ok[[1, 5, 7, 9, 11, 13, 15, 17, 19, 2]] = True
    r = llamar(m.top, M, ids20, q, ok, 8)
    s = M @ q
    bien = [ids20[i] for i in sorted(np.flatnonzero(ok), key=lambda i: -s[i])[:8]]
    exige([x for x, _ in r] == bien, lambda: f"top(): entre los permitidos, los 8 más parecidos de mayor a menor; esperaba {bien}, dio {[x for x, _ in r]}")
    exige(abs(r[0][1] - float(s[ids20.index(bien[0])])) < 1e-5, "top() tiene que regresar la similitud (el producto punto) de cada uno")
    exige(len(llamar(m.top, M, ids20, q, ok, 50)) == 10, "top() con k mayor que los permitidos regresa solo los permitidos")
    base = "la matriz y qué modelo hizo cada fila; top() filtra antes de elegir (10 permitidos de 20 → 8)"
    try:
        v = el_nuevo("5")
    except Falla:
        return base + " · los vectores de tu índice se revisan cuando lo construyas (paso 5)"
    malas = [p for p in ref.problemas(v) if "largo 1" in p]
    exige(not malas, lambda: malas[0])
    return base + f" · {v}: cada vector de largo 1"


def check_permisos() -> str:
    b_ = modulo("buscar")
    v = el_vigente("6")
    b = llamar(b_.abrir)
    exige(b.nombre == v, f"abrir() tiene que abrir el índice del alias ({v}); abrió {b.nombre}")
    d = ref.directorio()
    c = ref.corpus()["chunks"]
    _, items = ref.golden()
    personas = sorted(d["personas"])
    vistos = {}
    for p in personas:
        ps = ref.principals(p, d)
        ve = {k for k, x in c.items() if ref.puede_ver(x["acl"], ps)}
        vistos[p] = len(ve)
        tv = llamar(b.visibles, p)
        exige(int(np.sum(tv)) == len(ve), f"visibles({p}) dice {int(np.sum(tv))} chunks y {p} ve {len(ve)}")
        for x in items[:: 9]:
            for lado in ("bm25", "vectores"):
                r = [k for k, _ in llamar(getattr(b, lado), x["pregunta"], p, 8)]
                exige(set(r) <= ve, lambda: f"{lado}() le dio a {p} un chunk que no puede leer ({sorted(set(r) - ve)[0]})")
                if lado == "vectores":
                    exige(len(r) == min(8, len(ve)), f"vectores() le dio {len(r)} chunks a {p}, que ve {len(ve)}: el filtro va antes de elegir el top-8")
                bien = ref.top(v, x["pregunta"], p, lado)
                exige(r == bien, lambda: f"{lado}() para {x['id']} como {p} no da el top-8 de la verdad ({r[:3]}… contra {bien[:3]}…)")
    pro = [x for x in items if x["tipo"] == "prohibida"]
    for x in pro:
        for lado in ("bm25", "vectores"):
            r = {k for k, _ in b.__getattribute__(lado)(x["pregunta"], x["persona"], 8)}
            exige(not r & {f["chunk_id"] for f in x["fuentes"]}, f"{x['id']} es prohibida para {x['persona']} y {lado}() le dio su fuente")
    con = {p: n for p, n in vistos.items() if n}
    poco = min(con, key=con.get)
    cero = sorted(p.split("@")[0] for p, n in vistos.items() if not n)
    return (f"{len(personas)} personas: cada una recibe solo lo que puede leer, y siempre 8 si ve 8 o más ({poco.split('@')[0]} ve {vistos[poco]} "
            f"de {len(c)}" + (f"; {', '.join(cero)}, ninguno" if cero else "") + f") · las {len(pro)} prohibidas sin fuga · el mismo top-8 que la verdad")


def check_completo() -> str:
    v = el_nuevo("5")
    p = [x for x in ref.problemas(v) if "no trae los chunks" in x or "ACL distinta" in x]
    exige(not p, lambda: p[0])
    c = ref.corpus()
    return f"{v}: los {len(c['chunks'])} chunks de {c['version']} están en chunks.jsonl, en BM25 y en vectores, cada uno con la ACL del corpus"


def check_construir() -> str:
    import json

    import yaml

    co = modulo("construir")
    conf = yaml.safe_load((RAIZ / "config.yaml").read_text())
    clave = conf["embeddings"]["modelo"]
    exige(clave in catalogo(), f"config embeddings.modelo = {clave} no está en el catálogo")
    dim = catalogo()[clave]["dim"]
    exige(conf["indice"]["dimension"] == dim, f"config.yaml dice indice.dimension: {conf['indice']['dimension']} y {clave} da {dim}: "
          "el índice se declara con la dimensión del modelo")
    v = el_nuevo("5")
    man = leer_json(INDICES / v / "manifiesto.json")
    exige(man and man.get("estado") == "listo", f"{v} está «{(man or {}).get('estado')}»: python pipeline/construir.py lo termina con «listo» al final")
    for k in ("nombre", "creado", "corpus", "modelo", "dimension", "similitud", "n", "bm25", "archivos"):
        exige(k in man, f"al manifiesto de {v} le falta «{k}» (el contrato está en pipeline/construir.py)")
    exige(man["modelo"] == ref.firma(clave), f"{v}: el manifiesto tiene que traer la firma de {clave} ({ref.firma(clave)['repo']} @ revisión y sha256)")
    exige(man["corpus"] == ref.corpus()["version"], f"{v} se hizo con {man['corpus']} y el corpus de hoy es {ref.corpus()['version']}")
    p = [x for x in ref.problemas(v) if "modelos" in x or "no son los de su chunk" in x or "la matriz" in x]
    exige(not p, lambda: p[0])
    tuyo = llamar(co.revisar, v)
    exige(tuyo == [], lambda: f"tu revisar({v}) encuentra problemas en un índice sano: {tuyo[0]}")
    # un índice a medio construir y uno con un archivo cambiado: tu revisar() los tiene que ver
    medio = INDICES / "_check-medio"
    shutil.rmtree(medio, ignore_errors=True)
    shutil.copytree(INDICES / v, medio)
    try:
        m2 = leer_json(medio / "manifiesto.json") | {"estado": "construyendo"}
        (medio / "manifiesto.json").write_text(json.dumps(m2))
        exige(llamar(co.revisar, "_check-medio"), "tu revisar() da por sano un índice con «estado»: «construyendo»")
        (medio / "manifiesto.json").write_text(json.dumps(m2 | {"estado": "listo"}))
        vj = leer_json(medio / "vectores.json")
        vj["filas"][0]["modelo"] = ref.etiqueta("minilm")
        (medio / "vectores.json").write_text(json.dumps(vj))
        exige(llamar(co.revisar, "_check-medio"), "tu revisar() da por sano un índice cuyo vectores.json cambió (sha256 distinto al del manifiesto)")
    finally:
        shutil.rmtree(medio, ignore_errors=True)
    return (f"{v}: «listo», con la firma de {clave} ({man['modelo']['revision'][:12]}), {man['dimension']} dimensiones como el modelo y la "
            f"config, un solo modelo en todas sus filas (re-embebidas: iguales) · tu revisar() ve uno a medio construir y uno cambiado")


def check_consulta() -> str:
    b_ = modulo("buscar")
    v = el_vigente("7")
    man = leer_json(INDICES / v / "manifiesto.json")
    clave = man["modelo"]["clave"]
    otro = "minilm" if clave == "e5" else "e5"
    try:
        llamar(b_.Buscador, v, otro)
        raise Falla(f"Buscador({v}, '{otro}') abrió: la pregunta se embebería con {otro} y el índice es de {clave}; tiene que levantar ModeloDistinto")
    except b_.ModeloDistinto:
        pass
    usa = llamar(b_.modelo_de_consulta, v)
    exige(usa == clave, lambda: f"la API embebe las preguntas con {usa} y {v} se hizo con {clave} (config servicio.modelo_consulta: "
          f"{__import__('yaml').safe_load((RAIZ / 'config.yaml').read_text())['servicio']['modelo_consulta']})")
    b = llamar(b_.abrir)
    exige(b.modelo.clave == clave, f"abrir() embebe con {b.modelo.clave} y el índice es de {clave}")
    return f"{v} es de {clave} y la API embebe cada pregunta con {clave} (del manifiesto) · con {otro}, Buscador se niega"


def check_alias() -> str:
    al = modulo("alias")
    a = alias().get("c11")
    exige(a, "indices/alias.json no tiene el alias c11: python mundo/crear.py")
    exige(a["actual"] != PILOTO, f"c11 todavía apunta al piloto ({PILOTO}): python pipeline/alias.py cambiar c11 <tu índice> (paso 7)")
    p = ref.problemas(a["actual"])
    exige(not p, lambda: f"c11 apunta a {a['actual']}, que no está sano: {p[0]}")
    exige(a.get("anterior"), "el alias no guarda a dónde volver («anterior»)")
    pa = ref.problemas(a["anterior"])
    exige(not pa, lambda: f"el anterior de c11 ({a['anterior']}) no está sano: no hay a dónde volver ({pa[0]})")
    hist = a.get("historial", [])
    exige(hist and hist[-1].get("a") == a["actual"] and all(k in hist[-1] for k in ("fecha", "de", "a")),
          "el historial tiene que anotar cada cambio: {fecha, de, a}")
    medio = INDICES / "_check-medio"
    shutil.rmtree(medio, ignore_errors=True)
    medio.mkdir()
    (medio / "manifiesto.json").write_text('{"nombre": "_check-medio", "estado": "construyendo"}')
    antes = (INDICES / "alias.json").read_bytes()
    try:
        try:
            llamar(al.apuntar, "c11", "_check-medio")
            raise Falla("apuntar() movió c11 a un índice «construyendo»: tiene que levantar ValueError y dejarlo donde estaba")
        except ValueError:
            pass
        exige((INDICES / "alias.json").read_bytes() == antes, "apuntar() falló pero cambió indices/alias.json")
    finally:
        shutil.rmtree(medio, ignore_errors=True)
        (INDICES / "alias.json").write_bytes(antes)
    return (f"c11 → {a['actual']} (sano) · anterior: {a['anterior']} (sano: se puede volver) · {len(hist)} cambio(s) anotados · "
            f"a un índice a medio construir no se mueve")


def check_prueba() -> str:
    v = el_nuevo("6")
    out = []
    for nombre in (PILOTO, v):
        pr = leer_json(INDICES / nombre / "prueba.json")
        exige(pr, f"falta indices/{nombre}/prueba.json: python pipeline/prueba.py --indice {nombre}")
        bien = ref.recall(nombre)
        for lado in ("bm25", "vectores"):
            exige(abs(pr[lado]["recall"] - bien[lado]) < 1e-9, lambda: f"{nombre}: prueba.json dice recall@8 de {lado} = {pr[lado]['recall']:.1%} y es {bien[lado]:.1%}")
            exige(pr[lado]["fugas"] == 0, f"{nombre}: {lado} le dio su fuente a {pr[lado]['fugas']} prohibida(s)")
        out.append(bien)
    exige(out[1]["vectores"] > out[0]["vectores"], f"los vectores de {v} no le ganan a los del piloto en el golden set")
    return (f"golden-v2 · test, recall@8 · piloto: BM25 {out[0]['bm25']:.1%}, vectores {out[0]['vectores']:.1%} · {v}: BM25 "
            f"{out[1]['bm25']:.1%}, vectores {out[1]['vectores']:.1%} · 0 fugas")


CHECKS = {
    "mundo": check_mundo, "embeddings": check_embeddings, "cache": check_cache, "bm25": check_bm25, "vectores": check_vectores,
    "construir": check_construir, "completo": check_completo, "permisos": check_permisos, "prueba": check_prueba,
    "consulta": check_consulta, "alias": check_alias,
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
