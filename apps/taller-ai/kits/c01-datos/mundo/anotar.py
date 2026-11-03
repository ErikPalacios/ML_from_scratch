"""El proveedor de etiquetado: dos equipos de personas (A y B) que etiquetan según la guía que les mandas.

    python mundo/anotar.py

Entra:  data/etiquetado/tareas-proveedor.parquet  (lo escribe tu paso 5: request_id, key, guia_version, doble)
        guia/<guia_version>.md                    la guía que leen
Sale:   data/etiquetado/anotaciones.parquet       request_id, anotador (A o B), clase, guia_version
          A etiqueta todo; B solo las tareas con doble = true.

Cómo se equivocan (igual que personas reales): poco en lo obvio, mucho donde la guía no decide. Si la guía no
define una categoría o no trae la regla de un par que se confunde, ahí el error se dispara.
"""
from __future__ import annotations

import hashlib
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, DATA, OCULTO, PARES_AMBIGUOS, RAIZ  # noqa: E402

BASE, SIN_REGLA, CON_REGLA, SIN_CATEGORIA = 0.02, 0.30, 0.03, 0.45


def leer_guia(version: str) -> tuple[set[int], set[str]]:
    p = RAIZ / "guia" / f"{version}.md"
    if not p.exists():
        sys.exit(f"✗ no existe {p.relative_to(RAIZ)}: el proveedor no puede trabajar sin la guía")
    texto = p.read_text().lower()
    definidas = {i for i, c in enumerate(CLASES) if re.search(rf"^##\s+{c}\s*$", texto, re.M)}
    reglas = {par for par in PARES_AMBIGUOS if re.search(rf"regla:\s*{par}\b", texto)}
    return definidas, reglas


def etiquetar(verdad: int, quien: str, rid: str, version: str, definidas: set[int], reglas: set[str]) -> int:
    r = np.random.default_rng(int(hashlib.sha256(f"{rid}|{quien}|{version}".encode()).hexdigest()[:12], 16))
    if verdad not in definidas and r.random() < SIN_CATEGORIA:
        return int(r.choice([c for c in definidas]))                   # no sabe dónde va: elige algo parecido
    for par, (x, y) in PARES_AMBIGUOS.items():
        if verdad in (x, y):
            if r.random() < (CON_REGLA if par in reglas else SIN_REGLA):
                return y if verdad == x else x
    if r.random() < BASE:
        return int(r.integers(len(CLASES)))
    return verdad


def main() -> None:
    t = pd.read_parquet(DATA / "etiquetado" / "tareas-proveedor.parquet")
    faltan = {"request_id", "guia_version", "doble"} - set(t.columns)
    if faltan:
        sys.exit(f"✗ a tareas-proveedor.parquet le faltan columnas: {sorted(faltan)}")
    v = pd.read_parquet(OCULTO / "verdad.parquet").set_index("request_id").clase_real
    filas, ahora = [], datetime.now(timezone.utc)
    for version, grupo in t.groupby("guia_version"):
        definidas, reglas = leer_guia(version)
        for f in grupo.itertuples():
            for quien in (["A", "B"] if f.doble else ["A"]):
                filas.append({"request_id": f.request_id, "anotador": quien, "guia_version": version, "ts": ahora,
                              "clase": etiquetar(int(v[f.request_id]), quien, f.request_id, version, definidas, reglas)})
    a = pd.DataFrame(filas)
    a.to_parquet(DATA / "etiquetado" / "anotaciones.parquet", index=False)
    print(f"✓ el proveedor devolvió {len(a):,} anotaciones ({(a.anotador == 'B').sum()} dobles) con {', '.join(sorted(t.guia_version.unique()))}")


if __name__ == "__main__":
    main()
