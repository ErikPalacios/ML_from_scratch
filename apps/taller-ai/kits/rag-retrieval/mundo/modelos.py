"""Baja los dos modelos del dojo a modelo/<clave>/, cada archivo de un commit fijo de Hugging Face.

    python mundo/modelos.py            # una vez, con internet (≈ 623 MB); después todo corre sin red
    python mundo/modelos.py --listar   # qué hay en el catálogo y si ya está en tu Mac

- e5 = intfloat/multilingual-e5-small (MIT), el modelo de embeddings de la estación 5: el del índice vigente.
- reranker = cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 (Apache-2.0), un cross-encoder multilingüe que lee la pregunta
  y el pasaje juntos y da un puntaje. Se baja su versión cuantizada a int8 (onnx/model_qint8_arm64.onnx, 119 MB).

Los baja de la revisión anotada en mundo/modelos.json (no de «main», que puede cambiar mañana) y compara el sha256 de
cada archivo con el del catálogo: si no coincide, lo borra y se detiene. Es lo que haces en producción con un modelo:
fijar la revisión y comprobar la huella antes de usarlo. Si un archivo ya está y su huella coincide, no lo vuelve a bajar.
Si tienes otra copia del dojo con los modelos, DOJO_MODELOS=/ruta/a/su/modelo los copia de ahí en vez de bajarlos.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import sys
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import MODELO, catalogo, modelos_faltantes  # noqa: E402


def bajar(url: str, destino: Path, sha: str, tam: int) -> None:
    tmp = destino.with_name(destino.name + ".bajando")
    h = hashlib.sha256()
    with urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        n = 0
        while b := r.read(1 << 20):
            f.write(b)
            h.update(b)
            n += len(b)
            if sys.stdout.isatty():
                print(f"\r    {n / 1e6:6.0f} de {tam / 1e6:.0f} MB", end="", flush=True)
    print(("\n" if sys.stdout.isatty() else "") + f"    {n / 1e6:.0f} MB, sha256 {h.hexdigest()[:12]}… (el del catálogo)")
    if h.hexdigest() != sha:
        tmp.unlink()
        sys.exit(f"✗ {destino.name}: el sha256 no coincide ({h.hexdigest()[:12]}… en vez de {sha[:12]}…): no lo guardo")
    os.replace(tmp, destino)


if __name__ == "__main__":
    cat = catalogo()
    if "--listar" in sys.argv:
        malos = set(modelos_faltantes())
        for clave, m in cat.items():
            mb = sum(a["bytes"] for a in m["archivos"].values()) / 1e6
            ok = not any(f"modelo/{clave}/" in x for x in malos)
            que = f"{m['dim']} dimensiones" if "dim" in m else m["tipo"]
            print(f"{'✓' if ok else '·'} {clave:<9} {m['repo']} @ {m['revision'][:12]} · {que} · "
                  f"hasta {m['max_tokens']} tokens · {mb:.0f} MB · {m['licencia']}")
        sys.exit(0)
    otra = os.environ.get("DOJO_MODELOS")
    for clave, m in cat.items():
        (MODELO / clave).mkdir(parents=True, exist_ok=True)
        for nombre, a in m["archivos"].items():
            p = MODELO / clave / nombre
            if f"modelo/{clave}/{nombre}" not in modelos_faltantes():
                print(f"✓ modelo/{clave}/{nombre} ya está ({a['sha256'][:12]}…)")
                continue
            if otra and (Path(otra) / clave / nombre).exists():
                shutil.copy(Path(otra) / clave / nombre, p)
                print(f"  modelo/{clave}/{nombre}: copiado de {otra}")
            else:
                print(f"  bajando {m['repo']}/{a['ruta']} @ {m['revision'][:12]}…")
                bajar(f"https://huggingface.co/{m['repo']}/resolve/{m['revision']}/{a['ruta']}", p, a["sha256"], a["bytes"])
    malos = modelos_faltantes()
    if malos:
        sys.exit(f"✗ no coinciden con el catálogo: {', '.join(malos)}")
    total = sum(a["bytes"] for m in cat.values() for a in m["archivos"].values())
    print(f"✓ {len(cat)} modelos en modelo/ ({total / 1e6:.0f} MB), cada archivo con el sha256 del catálogo")
