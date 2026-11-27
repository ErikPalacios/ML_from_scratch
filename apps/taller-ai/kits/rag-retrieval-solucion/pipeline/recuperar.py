"""Paso 2 y 4: el retrieval completo. Pide candidatos a los dos índices (con los permisos como filtro), los junta con
RRF, deja que el reranker reordene los mejores y entrega el top-k: los chunks que la estación 7 le pone al LLM.

Contrato (todo sale de config.yaml, sección retrieval, que se lee en cada llamada):
- Recuperador(buscador, reranker=None): buscador es un Buscador de la estación 5 (o cualquier cosa con .ids,
  .visibles(persona), .bm25(pregunta, persona, k) y .vectores(pregunta, persona, k); persona=None = sin filtro).
  reranker es un Reranker (o cualquier cosa con .puntuar(pregunta, textos)); sin él, el modo "completo" da ValueError.
  .textos = {chunk_id: texto} del corpus vigente (lo que lee el reranker).
- .candidatos(pregunta, persona) → (lista_bm25, lista_vectores), cada una de hasta retrieval.candidatos elementos.
  filtro "antes": cada búsqueda ya filtra por permisos (lo de la estación 3: primero se filtra, después se elige).
  filtro "despues": cada búsqueda elige sus candidatos entre todos los chunks y después se quitan los que la persona
  no ve (para comparar: así llegan menos). Otro valor, ValueError.
- .recuperar(pregunta, persona, modo="completo") → {"top": [(chunk_id, puntaje)], "pool": n, "ms": {"buscar", "reranker"}}.
  modo "bm25" o "vectores": los primeros k de esa lista sola. "fusion": fusionar(listas, retrieval.fusion,
  retrieval.rrf_k) y los primeros k. "completo": de la fusión, los primeros retrieval.rerank_n pasan por el reranker
  (reordenar) y salen sus primeros k. pool = cuántos candidatos distintos juntó la fusión (0 en bm25 y vectores).
  ms = milisegundos de buscar (las dos búsquedas, con embeber la pregunta) y del reranker (0 si no hubo).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import config, corpus  # noqa: E402
from fusion import fusionar  # noqa: E402
from reranker import reordenar  # noqa: E402

MODOS = ("bm25", "vectores", "fusion", "completo")


class Recuperador:
    def __init__(self, buscador, reranker=None):
        self.buscador = buscador
        self.reranker = reranker
        self.textos = {k: x["texto"] for k, x in corpus()["chunks"].items()}

    def candidatos(self, pregunta: str, persona: str) -> tuple[list, list]:
        cfg = config()["retrieval"]
        n, b = cfg["candidatos"], self.buscador
        if cfg["filtro"] == "antes":
            return b.bm25(pregunta, persona, n), b.vectores(pregunta, persona, n)
        if cfg["filtro"] == "despues":
            ve = dict(zip(b.ids, b.visibles(persona)))
            return ([x for x in b.bm25(pregunta, None, n) if ve.get(x[0])],
                    [x for x in b.vectores(pregunta, None, n) if ve.get(x[0])])
        raise ValueError(f"retrieval.filtro tiene que ser antes o despues, no {cfg['filtro']}")

    def recuperar(self, pregunta: str, persona: str, modo: str = "completo") -> dict:
        if modo not in MODOS:
            raise ValueError(f"modo desconocido: {modo} (hay {', '.join(MODOS)})")
        cfg = config()["retrieval"]
        k = cfg["k"]
        t = time.perf_counter()
        bm, ve = self.candidatos(pregunta, persona)
        ms = {"buscar": (time.perf_counter() - t) * 1000, "reranker": 0.0}
        if modo in ("bm25", "vectores"):
            return {"top": (bm if modo == "bm25" else ve)[:k], "pool": 0, "ms": ms}
        fus = fusionar([bm, ve], cfg["fusion"], cfg["rrf_k"])
        if modo == "fusion":
            return {"top": fus[:k], "pool": len(fus), "ms": ms}
        if self.reranker is None:
            raise ValueError("el modo completo necesita un reranker: Recuperador(buscador, Reranker())")
        t = time.perf_counter()
        top = reordenar(self.reranker, pregunta, [c for c, _ in fus[:cfg["rerank_n"]]], self.textos)
        ms["reranker"] = (time.perf_counter() - t) * 1000
        return {"top": top[:k], "pool": len(fus), "ms": ms}


def abrir(con_reranker: bool = True) -> Recuperador:
    """El Recuperador del índice al que apunta el alias (config servicio.alias), con el reranker del catálogo."""
    from buscar import abrir as abrir_buscador
    from reranker import Reranker

    return Recuperador(abrir_buscador(), Reranker() if con_reranker else None)


if __name__ == "__main__":
    # python pipeline/recuperar.py --persona elena.cruz@marketplace.test "una pregunta"  → el top-k de cada modo
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", required=True)
    ap.add_argument("--modo", choices=MODOS, help="solo un modo (si no, los cuatro lado a lado)")
    ap.add_argument("pregunta", nargs="+")
    a = ap.parse_args()
    q = " ".join(a.pregunta)
    try:
        r = abrir()
    except ValueError as e:
        sys.exit(f"✗ {e}")
    cfg = config()["retrieval"]
    print(f"{r.buscador.nombre} · {a.persona} ve {int(r.buscador.visibles(a.persona).sum())} de {len(r.buscador.ids)} chunks · "
          f"candidatos {cfg['candidatos']} por índice · {cfg['fusion']} k={cfg['rrf_k']} · reranker lee {cfg['rerank_n']} · salen {cfg['k']}")
    modos = [a.modo] if a.modo else list(MODOS)
    res = {m: r.recuperar(q, a.persona, m) for m in modos}
    print("  " + "".join(f"{m:<26}" for m in modos))
    for i in range(cfg["k"]):
        print("  " + "".join(f"{(f'{x[i][1]:7.3f} ' + x[i][0]) if i < len(x) else '':<26}" for x in (res[m]["top"] for m in modos)))
    if "completo" in res:
        x = res["completo"]
        print(f"  completo: la fusión juntó {x['pool']} candidatos · buscar {x['ms']['buscar']:.0f} ms · reranker {x['ms']['reranker']:.0f} ms")
