"""Paso 4 · El contrato de datos: auditar antes de publicar (write-audit-publish).

Entra:  data/rows.parquet                 del paso 3
        entrada/categorias.json, entrada/golden.parquet
        s3://ml-datos/datasets/<padre>/   el snapshot anterior (su tarjeta y sus filas)
        params.yaml                       snapshot.id, snapshot.padre y validar.*
Sale:   data/validation.json              {"snapshot_id", "padre", "status": "passed" | "failed", "checks": {nombre: "ok" | motivo}}
        con los checks esquema, categorias, duplicados, golden, split_vendedor, split_estable, volumen y vendedor.
        Si alguno falla, sale con código 1: el pipeline se detiene y no se publica nada.
"""
import io
import json
import sys

import pandas as pd
from _comun import DATA, DATOS, ENTRADA, params, s3, sha256

p = params()
v = p["validar"]
rows = pd.read_parquet(DATA / "rows.parquet")
COLUMNAS = ["image_key", "image_sha256", "seller_id", "label_id", "label_source", "guia_version",
            "label_ts", "created_at", "bytes", "split"]

# el padre, comprobado con su huella antes de usarlo
cliente = s3()
tarjeta = json.loads(cliente.get_object(Bucket=DATOS, Key=f"datasets/{p['snapshot']['padre']}/snapshot.json")["Body"].read())
crudo = cliente.get_object(Bucket=DATOS, Key=f"datasets/{p['snapshot']['padre']}/rows.parquet")["Body"].read()
if sha256(crudo) != tarjeta["rows_sha256"]:
    sys.exit(f"✗ el padre {p['snapshot']['padre']} no coincide con su tarjeta: alguien lo reescribió")
padre = pd.read_parquet(io.BytesIO(crudo))

lado_padre = padre.drop_duplicates("seller_id").set_index("seller_id")["split"]
lado = rows.drop_duplicates("seller_id").set_index("seller_id")["split"]
comunes = lado.index.intersection(lado_padre.index)
movidos = (lado[comunes] != lado_padre[comunes]).sum()
validas = {int(k) for k in json.loads((ENTRADA / "categorias.json").read_text())}
golden = set(pd.read_parquet(ENTRADA / "golden.parquet")["image_sha256"])
razon = len(rows) / len(padre)
f_vend = (rows["label_source"] == "vendedor").mean()

checks = {
    "esquema": "ok" if list(rows.columns) == COLUMNAS else f"columnas {list(rows.columns)}",
    "categorias": "ok" if rows["label_id"].isin(validas).all() else f"{(~rows['label_id'].isin(validas)).sum()} labels fuera de las categorías",
    "duplicados": "ok" if rows["image_sha256"].is_unique else f"{rows['image_sha256'].duplicated().sum()} huellas repetidas",
    "golden": "ok" if not rows["image_sha256"].isin(golden).any() else f"{rows['image_sha256'].isin(golden).sum()} fotos del golden set",
    "split_vendedor": "ok" if rows.groupby("seller_id")["split"].nunique().max() == 1 else "hay vendedores en train y en val",
    "split_estable": "ok" if movidos == 0 else f"{movidos} de {len(comunes)} vendedores cambiaron de lado contra {p['snapshot']['padre']}",
    "volumen": "ok" if v["volumen_min"] <= razon <= v["volumen_max"] else f"{razon:.2f} veces el padre (rango {v['volumen_min']}–{v['volumen_max']})",
    "vendedor": "ok" if f_vend <= v["max_vendedor"] else f"{f_vend:.0%} de labels de quien vende (máximo {v['max_vendedor']:.0%})",
}
status = "passed" if all(x == "ok" for x in checks.values()) else "failed"
(DATA / "validation.json").write_text(json.dumps({"snapshot_id": p["snapshot"]["id"], "padre": p["snapshot"]["padre"],
                                                  "status": status, "checks": checks}, ensure_ascii=False, indent=2) + "\n")
for k, x in checks.items():
    print(f"  {'✓' if x == 'ok' else '✗'} {k:<15} {x}")
print(f"{status}: {len(rows)} filas = {razon:.2f} × las {len(padre)} del padre · quien vende {f_vend:.1%} · {len(comunes)} vendedores en los dos, {movidos} movidos")
sys.exit(0 if status == "passed" else 1)
