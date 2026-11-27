"""Baja el modelo del catálogo (mundo/modelos.json) a modelo/, de un commit fijo de Hugging Face, y comprueba su sha256.

    python mundo/modelos.py            # baja lo que falte (≈ 805 MB, una vez)
    python mundo/modelos.py --listar   # qué hay y si su sha256 coincide

Si ya lo tienes en otra carpeta (otro kit del dojo, por ejemplo), TRUEML_MODELOS=<carpeta> lo copia de ahí en vez de
bajarlo, siempre que su sha256 coincida. Solo usa la biblioteca estándar de Python.
"""
from __future__ import annotations

import os
import shutil
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CATALOGO, MODELO, sha256_archivo  # noqa: E402


def url(m: dict) -> str:
    return f"https://huggingface.co/{m['repo']}/resolve/{m['revision']}/{m['archivo']}"


def bajar(clave: str) -> None:
    m = CATALOGO[clave]
    destino = MODELO / m["archivo"]
    if destino.exists() and destino.stat().st_size == m["bytes"] and sha256_archivo(destino) == m["sha256"]:
        print(f"✓ {clave}: ya está ({m['bytes'] / 1e6:.0f} MB, sha256 {m['sha256'][:12]}…)")
        return
    MODELO.mkdir(exist_ok=True)
    tmp = destino.with_suffix(".parcial")
    local = Path(os.environ.get("TRUEML_MODELOS", "/nonexistent")) / m["archivo"]
    if local.exists() and local.stat().st_size == m["bytes"]:
        print(f"  {clave}: copiando de {local.parent}")
        shutil.copy(local, tmp)
    else:
        print(f"  {clave}: bajando {url(m)} ({m['bytes'] / 1e6:.0f} MB)…")
        with urllib.request.urlopen(url(m)) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
    got = sha256_archivo(tmp)
    if got != m["sha256"]:
        tmp.unlink()
        sys.exit(f"✗ {clave}: el sha256 no coincide ({got[:12]}… contra {m['sha256'][:12]}…): no se usa")
    os.replace(tmp, destino)
    print(f"✓ {clave}: {m['archivo']} · {m['bytes']:,} bytes · sha256 {m['sha256'][:12]}… · {m['repo']}@{m['revision'][:8]}")


if __name__ == "__main__":
    for k, m in CATALOGO.items():
        if "--listar" in sys.argv:
            p = MODELO / m["archivo"]
            ok = p.exists() and sha256_archivo(p) == m["sha256"]
            print(f"{'✓' if ok else '✗'} {k:<16} {m['archivo']} · {m['bytes'] / 1e6:.0f} MB · {m['repo']}@{m['revision'][:8]}" + ("" if ok else " (falta o no coincide)"))
        else:
            bajar(k)
