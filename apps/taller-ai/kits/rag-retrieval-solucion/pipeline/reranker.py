"""Paso 3: el reranker. Un cross-encoder lee la pregunta y un pasaje juntos, en una sola pasada por el modelo, y da un
número: qué tan bien contesta ese pasaje esa pregunta. Es más fino que comparar dos vectores hechos por separado, y
más caro: una pasada por cada par. Por eso solo lee los candidatos que ya juntó la fusión, no todo el índice.

Contrato:
- Reranker(clave="reranker") carga modelo/<clave>/ (model.onnx con onnxruntime y tokenizer.json con tokenizers).
  Antes de usarlo comprueba el sha256 de los dos archivos contra el catálogo (mundo/modelos.json); si no coinciden,
  ValueError. El tokenizer corta cada par en max_tokens del catálogo (512).
  - .firma() → {"clave", "repo", "revision", "sha256" (el de model.onnx)}.
  - .puntuar(pregunta, textos) → numpy.ndarray float32 de forma (len(textos),): un puntaje por pasaje, el logit del
    modelo para el par (pregunta, pasaje). Más alto = más relevante. Pasa los pares en lotes de config reranker.lote.
    Con textos vacío, un arreglo vacío.
- reordenar(reranker, pregunta, candidatos, textos) → [(chunk_id, puntaje)]: candidatos es una lista de chunk_ids y
  textos un {chunk_id: texto}; el reranker puntúa cada uno y regresan de mayor a menor (empates: el orden de entrada).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import MODELO, config, modelos, sha256_archivo  # noqa: E402


class Reranker:
    def __init__(self, clave: str = "reranker"):
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
        self.tok.enable_truncation(self.info["max_tokens"])     # el par completo: pregunta + pasaje
        self.tok.enable_padding()
        self.sesion = ort.InferenceSession(str(carpeta / "model.onnx"), providers=["CPUExecutionProvider"])
        self.entradas = {i.name for i in self.sesion.get_inputs()}

    def firma(self) -> dict:
        i = self.info
        return {"clave": self.clave, "repo": i["repo"], "revision": i["revision"], "sha256": i["archivos"]["model.onnx"]["sha256"]}

    def puntuar(self, pregunta: str, textos: list[str]) -> np.ndarray:
        lote = config()["reranker"]["lote"]
        out = []
        for i in range(0, len(textos), lote):
            enc = self.tok.encode_batch([(pregunta, t) for t in textos[i:i + lote]])   # un par: <s> pregunta </s></s> pasaje </s>
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            feed = {"input_ids": ids, "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64)}
            if "token_type_ids" in self.entradas:
                feed["token_type_ids"] = np.zeros_like(ids)
            out.append(self.sesion.run(None, feed)[0][:, 0])             # (lote, 1): un logit por par
        return np.concatenate(out).astype(np.float32) if out else np.zeros(0, np.float32)


def reordenar(reranker: Reranker, pregunta: str, candidatos: list[str], textos: dict) -> list[tuple[str, float]]:
    s = reranker.puntuar(pregunta, [textos[c] for c in candidatos])
    orden = np.argsort(-s, kind="stable")
    return [(candidatos[i], float(s[i])) for i in orden]


if __name__ == "__main__":
    # python pipeline/reranker.py "pregunta" "pasaje uno" "pasaje dos" ...  → el puntaje de cada par, de mayor a menor
    import time

    if len(sys.argv) < 3:
        sys.exit('uso: python pipeline/reranker.py "pregunta" "pasaje" ["otro pasaje" ...]')
    t = time.perf_counter()
    r = Reranker()
    print(f"{r.clave}: {r.info['repo']} @ {r.info['revision'][:12]} · cargado en {time.perf_counter() - t:.1f} s")
    t = time.perf_counter()
    s = r.puntuar(sys.argv[1], sys.argv[2:])
    print(f"  {len(s)} pares en {(time.perf_counter() - t) * 1000:.0f} ms")
    for i in np.argsort(-s, kind="stable"):
        print(f"  {s[i]:7.2f}  «{sys.argv[2 + i][:90]}»")
