"""Paso 7 · El linaje al revés: ¿en qué snapshots y en qué modelos está esta foto?

    python pipeline/7_linaje.py <sha256>            # la huella completa o sus primeros 12+ caracteres
    python pipeline/7_linaje.py <sha256> --json     # lo mismo, en JSON (lo usa verificar.py)

Entra:  s3://ml-datos/datasets/*/        cada snapshot con tarjeta (sus filas, comprobadas con su huella)
        corridas/*.json                  cada corrida y el snapshot con que entrenó
        entrada/borrados.csv             si alguien pidió borrarla
Sale:   {"sha256", "snapshots": [{"id", "split", "image_keys"}], "corridas": [{"run_id", "modelo", "snapshot"}],
         "borrado": {"fecha", "motivo"} o null}
"""
import io
import json
import sys

import pandas as pd
from _comun import CORRIDAS, DATOS, ENTRADA, s3, sha256

args = [a for a in sys.argv[1:] if not a.startswith("--")]
if not args or len(args[0]) < 12:
    sys.exit("uso: python pipeline/7_linaje.py <sha256 (12+ caracteres)> [--json]")
buscada = args[0].lower()
cliente = s3()
r = cliente.list_objects_v2(Bucket=DATOS, Prefix="datasets/", Delimiter="/")
snaps = []
for sid in sorted(x["Prefix"].split("/")[1] for x in r.get("CommonPrefixes", [])):
    try:
        tarjeta = json.loads(cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/snapshot.json")["Body"].read())
    except cliente.exceptions.NoSuchKey:
        continue                                                   # sin tarjeta no es un snapshot
    crudo = cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()
    if sha256(crudo) != tarjeta["rows_sha256"]:
        sys.exit(f"✗ las filas de {sid} no coinciden con su tarjeta: el linaje no es confiable")
    f = pd.read_parquet(io.BytesIO(crudo), columns=["image_key", "image_sha256", "split"])
    hay = f[f["image_sha256"].str.startswith(buscada)]
    if len(hay):
        snaps.append({"id": sid, "split": hay["split"].iloc[0], "image_keys": sorted(hay["image_key"])})
ids = {s["id"] for s in snaps}
corridas = sorted((json.loads(c.read_text()) for c in CORRIDAS.glob("*.json")), key=lambda c: c["fecha"])
usan = [{"run_id": c["run_id"], "modelo": c["modelo"], "snapshot": c["snapshot"]} for c in corridas if c["snapshot"] in ids]
b = pd.read_csv(ENTRADA / "borrados.csv")
b = b[b["image_sha256"].str.startswith(buscada)]
borrado = {"fecha": b["fecha"].iloc[0], "motivo": b["motivo"].iloc[0]} if len(b) else None
out = {"sha256": buscada, "snapshots": snaps, "corridas": usan, "borrado": borrado}
if "--json" in sys.argv:
    print(json.dumps(out, ensure_ascii=False, indent=2))
else:
    print(f"foto {buscada[:12]}…")
    for s in snaps:
        print(f"  snapshot {s['id']} · {s['split']} · {', '.join(s['image_keys'])}")
    for c in usan:
        print(f"  corrida {c['run_id']} · {c['modelo']} ← {c['snapshot']}")
    print(f"  borrada el {borrado['fecha']}: {borrado['motivo']}" if borrado else "  no está en el registro de borrados")
    if not snaps:
        print("  no aparece en ningún snapshot")
