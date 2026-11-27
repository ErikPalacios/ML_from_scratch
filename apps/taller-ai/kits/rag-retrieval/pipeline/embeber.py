"""Viene de la estación 5 : no lo tienes que escribir. Paso 1 y 2: convertir texto en embeddings con un modelo local, y no volver a embeber lo que ya embebiste.

Contrato:
- Modelo(clave) carga el modelo del catálogo (mundo/modelos.json) desde modelo/<clave>/: model.onnx con onnxruntime y
  tokenizer.json con tokenizers. Antes de usarlo comprueba el sha256 de los dos archivos contra el catálogo; si no
  coinciden, levanta ValueError (un modelo que no es el anotado no se usa).
- Modelo.firma(): {"clave", "repo", "revision", "sha256" (el de model.onnx), "dim"}: qué modelo y qué versión hizo un
  vector. Va en el manifiesto de cada índice y en cada fila.
- Modelo.embeber(textos, tipo): tipo es "consulta" o "pasaje"; a cada texto le pone el prefijo de ese tipo que pide el
  catálogo («query: » o «passage: » en e5; nada en MiniLM), lo parte en tokens (cortando en max_tokens), lo pasa por
  el modelo en lotes de config embeddings.lote, promedia los vectores de sus tokens (mean pooling, sin contar el
  relleno) y normaliza cada vector a largo 1. Devuelve un numpy.ndarray float32 de forma (len(textos), dim).
- embeber_chunks(chunks, modelo) → (ids, matriz, nuevos): los vectores de pasaje de cada chunk {chunk_id: {"texto", ...}},
  en el orden de sorted(chunk_ids). Usa el cache de cache/embeddings/<clave>@<revision[:12]>/<sha_texto(texto)>.npy:
  solo embebe los textos que no están y los guarda. nuevos = cuántos tuvo que embeber.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import CACHE, MODELO, config, modelos, sha256_archivo, sha_texto  # noqa: E402


class Modelo:
    def __init__(self, clave: str):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        cat = modelos()
        if clave not in cat:
            raise ValueError(f"el modelo «{clave}» no está en mundo/modelos.json (hay: {', '.join(cat)})")
        self.clave, self.info = clave, cat[clave]
        carpeta = MODELO / clave
        for nombre, a in self.info["archivos"].items():
            p = carpeta / nombre
            if not p.exists():
                raise ValueError(f"falta modelo/{clave}/{nombre}: python mundo/modelos.py")
            if sha256_archivo(p) != a["sha256"]:
                raise ValueError(f"modelo/{clave}/{nombre} no es el anotado en el catálogo (sha256 distinto)")
        self.tok = Tokenizer.from_file(str(carpeta / "tokenizer.json"))
        self.tok.enable_truncation(self.info["max_tokens"])
        self.tok.enable_padding()
        self.sesion = ort.InferenceSession(str(carpeta / "model.onnx"), providers=["CPUExecutionProvider"])
        self.entradas = {i.name for i in self.sesion.get_inputs()}
        self.dim = self.info["dim"]

    def firma(self) -> dict:
        i = self.info
        return {"clave": self.clave, "repo": i["repo"], "revision": i["revision"], "sha256": i["archivos"]["model.onnx"]["sha256"], "dim": i["dim"]}

    def embeber(self, textos: list[str], tipo: str) -> np.ndarray:
        prefijo = {"consulta": self.info["prefijo_consulta"], "pasaje": self.info["prefijo_pasaje"]}[tipo]
        lote = config()["embeddings"]["lote"]
        out = []
        for i in range(0, len(textos), lote):
            enc = self.tok.encode_batch([prefijo + t for t in textos[i:i + lote]])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mascara = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feed = {"input_ids": ids, "attention_mask": mascara}
            if "token_type_ids" in self.entradas:
                feed["token_type_ids"] = np.zeros_like(ids)
            h = self.sesion.run(None, feed)[0]                       # (lote, tokens, dim): un vector por token
            m = mascara[..., None].astype(np.float32)
            v = (h * m).sum(axis=1) / m.sum(axis=1)                  # mean pooling: el promedio de los tokens de verdad
            out.append(v / np.linalg.norm(v, axis=1, keepdims=True))  # largo 1
        return np.vstack(out).astype(np.float32) if out else np.zeros((0, self.dim), np.float32)


def carpeta_cache(modelo: Modelo) -> Path:
    return CACHE / f"{modelo.clave}@{modelo.info['revision'][:12]}"


def embeber_chunks(chunks: dict, modelo: Modelo) -> tuple[list[str], np.ndarray, int]:
    ids = sorted(chunks)
    carpeta = carpeta_cache(modelo)
    carpeta.mkdir(parents=True, exist_ok=True)
    rutas = {k: carpeta / f"{sha_texto(chunks[k]['texto'])}.npy" for k in ids}
    faltan = [k for k in ids if not rutas[k].exists()]
    if faltan:
        vs = modelo.embeber([chunks[k]["texto"] for k in faltan], "pasaje")
        for k, v in zip(faltan, vs):
            np.save(rutas[k], v)
    return ids, np.vstack([np.load(rutas[k]) for k in ids]).astype(np.float32), len(faltan)


if __name__ == "__main__":
    # python pipeline/embeber.py [--modelo minilm] "texto uno" "texto dos" ...  → la similitud coseno de cada par
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default=None)
    ap.add_argument("textos", nargs="+")
    a = ap.parse_args()
    t = time.perf_counter()
    m = Modelo(a.modelo or config()["embeddings"]["modelo"])
    print(f"{m.clave}: {m.info['repo']} @ {m.info['revision'][:12]} · {m.dim} dimensiones · cargado en {time.perf_counter() - t:.1f} s")
    v = m.embeber(a.textos, "pasaje")
    for i in range(len(a.textos)):
        for j in range(i + 1, len(a.textos)):
            print(f"  {float(v[i] @ v[j]):.3f}  «{a.textos[i]}» · «{a.textos[j]}»")
