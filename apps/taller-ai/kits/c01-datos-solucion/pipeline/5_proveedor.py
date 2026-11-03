"""Paso 5 · Mandar la cola al proveedor de etiquetado.

Entra:  data/pipeline/copiadas.parquet, config.yaml (etiquetado.guia_version, etiquetado.frac_doble)
Sale:   data/etiquetado/tareas-proveedor.parquet   request_id, key, img_sha256_prefijo, guia_version, doble
          doble = true en el `frac_doble` de las tareas, elegidas al azar: esas las etiquetan dos personas.
Después: python mundo/anotar.py   (el proveedor devuelve data/etiquetado/anotaciones.parquet)
"""
import numpy as np

import pandas as pd
from _comun import ETQ, RAIZ, SAL, cfg

c = cfg()["etiquetado"]
guia = RAIZ / "guia" / f"{c['guia_version']}.md"
assert guia.exists(), f"no existe {guia}: escribe la guía antes de mandar tareas"

t = pd.read_parquet(SAL / "copiadas.parquet").sort_values("request_id", ignore_index=True)
rng = np.random.default_rng(5)
t["guia_version"] = c["guia_version"]      # cada label recuerda con qué versión de la guía se hizo
t["doble"] = False
t.loc[rng.choice(t.index, round(len(t) * c["frac_doble"]), replace=False), "doble"] = True
t.to_parquet(ETQ / "tareas-proveedor.parquet", index=False)
print(f"tareas: {len(t)} · dobles: {t.doble.sum()} · guía: {c['guia_version']}")
