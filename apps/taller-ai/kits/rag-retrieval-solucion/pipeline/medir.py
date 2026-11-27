"""Paso 5 y 6: medir el retrieval con el golden set de la estación 4. Cuatro modos lado a lado (BM25 solo, vectores
solos, fusión, fusión + reranker), cada uno con su recall@k por tipo de pregunta, y lo que tarda el reranker.

Contrato:
- medir(recuperador, preguntas, modos=MODOS) → {modo: r, "por_pregunta": [...]}, con k = retrieval.k y
  r = {"recall", "margen", "n", "por_tipo": {tipo: {"recall", "n"}}, "recall@3", "mrr", "fugas", "prohibidas",
  "cortos", "ms": {"p50", "p95"}}.
  - recall@k: solo con las preguntas de los tipos de medicion.tipos, que tienen que ser de los que traen fuentes que
    buscar: "directa" y "varias". Si piden otro tipo ("sin_respuesta" no tiene fuentes; en "prohibida" la fuente es
    justo lo que no debe llegar), ValueError: esas se miden aparte. Por pregunta, la fracción de sus fuentes que llega
    al top-k; luego el promedio, y margen = 1.96 × desviación estándar / √n (estación 4). recall@3 igual, con los 3
    primeros. mrr: el promedio de 1 / (lugar de la primera fuente), 0 si no llega.
  - fugas: de las "prohibida", cuántas recibieron alguna de sus fuentes (tiene que ser 0). prohibidas: cuántas hubo.
  - cortos: preguntas que recibieron menos de k chunks aunque la persona ve k o más.
  - ms: p50 y p95 del tiempo de cada pregunta (buscar + reranker).
  - por_pregunta: {"id", "tipo", modo: recall@k o None}.
- revisar_split(split): si split es el de medicion.afinado_con, ValueError: con esas preguntas se eligieron rrf_k y
  rerank_n, y el número saldría optimista. El reporte se mide con otras.
- Al correrlo sin --afinar, mide el split de medicion.split y guarda indices/<nombre>/retrieval.json: {"indice",
  "golden", "split", "k", "config" (la sección retrieval), "reranker" (su firma), los cuatro modos, "por_pregunta"}.
- Con --afinar: prueba rrf_k en (10, 30, 60, 100) y rerank_n en (8, 20, 30) con el split de medicion.afinado_con y
  guarda indices/<nombre>/afinado.json con la tabla. No cambia config.yaml: eso lo decides tú.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import INDICES, config, escribir_json, golden  # noqa: E402
from recuperar import MODOS  # noqa: E402

CON_FUENTES = ("directa", "varias")


def _media(xs: list[float]) -> tuple[float, float]:
    n = len(xs)
    m = sum(xs) / n if n else 0.0
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1)) if n > 1 else 0.0
    return m, 1.96 * sd / math.sqrt(n) if n else 0.0


def revisar_split(split: str) -> None:
    afinado = config()["medicion"]["afinado_con"]
    if split == afinado:
        raise ValueError(f"el split {split} es con el que se afinaron rrf_k y rerank_n (medicion.afinado_con): medir con "
                         f"él da un número optimista. El reporte se mide con otro split")


def medir(recuperador, preguntas: list[dict], modos=MODOS) -> dict:
    tipos = config()["medicion"]["tipos"]
    malos = [t for t in tipos if t not in CON_FUENTES]
    if malos:
        raise ValueError(f"medicion.tipos trae {', '.join(malos)}: el recall solo se mide con preguntas que tienen fuentes "
                         f"que buscar ({' y '.join(CON_FUENTES)}); sin_respuesta y prohibida se miden aparte")
    k = config()["retrieval"]["k"]
    out, por = {}, {x["id"]: {"id": x["id"], "tipo": x["tipo"]} for x in preguntas}
    for modo in modos:
        rec, r3, rr, ms, por_tipo = [], [], [], [], {t: [] for t in tipos}
        fugas = cortos = 0
        for x in preguntas:
            r = recuperador.recuperar(x["pregunta"], x["persona"], modo)
            top = [c for c, _ in r["top"]]
            ms.append(r["ms"]["buscar"] + r["ms"]["reranker"])
            fs = {f["chunk_id"] for f in x["fuentes"]}
            if len(top) < k and int(recuperador.buscador.visibles(x["persona"]).sum()) >= k:
                cortos += 1
            if x["tipo"] == "prohibida" and fs & set(top):
                fugas += 1
            por[x["id"]][modo] = None
            if x["tipo"] in tipos:
                v = len(fs & set(top)) / len(fs)
                rec.append(v)
                por_tipo[x["tipo"]].append(v)
                r3.append(len(fs & set(top[:3])) / len(fs))
                rr.append(next((1 / (i + 1) for i, c in enumerate(top) if c in fs), 0.0))
                por[x["id"]][modo] = v
        m, margen = _media(rec)
        out[modo] = {"recall": m, "margen": margen, "n": len(rec), "recall@3": _media(r3)[0], "mrr": _media(rr)[0],
                     "por_tipo": {t: {"recall": _media(v)[0], "n": len(v)} for t, v in por_tipo.items()},
                     "fugas": fugas, "prohibidas": sum(x["tipo"] == "prohibida" for x in preguntas), "cortos": cortos,
                     "ms": {"p50": float(np.percentile(ms, 50)), "p95": float(np.percentile(ms, 95))}}
    return out | {"por_pregunta": list(por.values())}


class _Memo:
    """El reranker con memoria, solo para --afinar: cada par (pregunta, pasaje) se puntúa una vez aunque lo pidan
    varias combinaciones."""

    def __init__(self, r):
        self.r, self.m = r, {}

    def puntuar(self, pregunta, textos):
        faltan = [t for t in dict.fromkeys(textos) if (pregunta, t) not in self.m]
        for t, s in zip(faltan, self.r.puntuar(pregunta, faltan) if faltan else []):
            self.m[(pregunta, t)] = float(s)
        return np.array([self.m[(pregunta, t)] for t in textos], dtype=np.float32)


def _tabla(nombre: str, r: dict, k: int) -> None:
    print(f"  {'modo':<10} {'recall@' + str(k):>15} {'directa':>8} {'varias':>7} {'recall@3':>9} {'MRR':>6} {'fugas':>6} {'cortos':>7} {'p50 ms':>7} {'p95 ms':>7}")
    for m in MODOS:
        x = r[m]
        pt = x["por_tipo"]
        print(f"  {m:<10} {x['recall']:>7.1%} ± {x['margen']:>5.1%} {pt.get('directa', {}).get('recall', 0):>8.1%} "
              f"{pt.get('varias', {}).get('recall', 0):>7.1%} {x['recall@3']:>9.1%} {x['mrr']:>6.3f} {x['fugas']:>3}/{x['prohibidas']:<2} "
              f"{x['cortos']:>7} {x['ms']['p50']:>7.0f} {x['ms']['p95']:>7.0f}")


if __name__ == "__main__":
    # python pipeline/medir.py            → el reporte con medicion.split, guardado junto al índice
    # python pipeline/medir.py --afinar   → la tabla de rrf_k × rerank_n con medicion.afinado_con
    import argparse
    import itertools

    from recuperar import abrir

    ap = argparse.ArgumentParser()
    ap.add_argument("--afinar", action="store_true")
    a = ap.parse_args()
    cfg = config()
    v, items = golden()
    try:
        rec = abrir()
        if a.afinar:
            split = cfg["medicion"]["afinado_con"]
        else:
            split = cfg["medicion"]["split"]
            revisar_split(split)
        preguntas = [x for x in items if x["split"] == split]
        if not a.afinar:
            r = medir(rec, preguntas)
    except ValueError as e:
        sys.exit(f"✗ {e}")
    nombre, k = rec.buscador.nombre, cfg["retrieval"]["k"]
    print(f"{nombre} · {v} · {split}: {len(preguntas)} preguntas, "
          f"{sum(x['tipo'] in cfg['medicion']['tipos'] for x in preguntas)} con fuentes que buscar ({', '.join(cfg['medicion']['tipos'])})")
    if not a.afinar:
        _tabla(nombre, r, k)
        c = cfg["retrieval"]
        print(f"  config: candidatos {c['candidatos']} por índice · filtro {c['filtro']} · {c['fusion']} k={c['rrf_k']} · "
              f"el reranker lee {c['rerank_n']} · salen {k}")
        escribir_json(INDICES / nombre / "retrieval.json", {"indice": nombre, "golden": v, "split": split, "k": k, "config": c,
                                                            "reranker": rec.reranker.firma(), **r})
        print(f"  guardado en indices/{nombre}/retrieval.json")
        sys.exit(0)
    # --afinar: cada combinación con el mismo reranker con memoria (cada par se puntúa una vez)
    rec.reranker = _Memo(rec.reranker)
    import recuperar as R

    tabla = []
    for rk, rn in itertools.product((10, 30, 60, 100), (8, 20, 30)):
        c = config()
        c["retrieval"] |= {"rrf_k": rk, "rerank_n": rn}
        R.config = lambda c=c: c            # el Recuperador ve esta combinación; config.yaml no se toca
        x = medir(rec, preguntas, ("fusion", "completo"))
        tabla.append({"rrf_k": rk, "rerank_n": rn, **{m: {q: x[m][q] for q in ("recall", "recall@3", "mrr")} for m in ("fusion", "completo")}})
    print(f"  {'rrf_k':>5} {'rerank_n':>8}   {'fusión: recall@' + str(k):>18} {'MRR':>6}   {'+ reranker: recall@' + str(k):>21} {'recall@3':>9} {'MRR':>6}")
    for t in tabla:
        f, c = t["fusion"], t["completo"]
        print(f"  {t['rrf_k']:>5} {t['rerank_n']:>8}   {f['recall']:>18.1%} {f['mrr']:>6.3f}   {c['recall']:>21.1%} {c['recall@3']:>9.1%} {c['mrr']:>6.3f}")
    escribir_json(INDICES / nombre / "afinado.json", {"indice": nombre, "golden": v, "split": split, "tabla": tabla})
    print(f"  guardado en indices/{nombre}/afinado.json · config.yaml no cambió: la decisión es tuya")
