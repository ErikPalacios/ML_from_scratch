"""Paso 5 · Publicar el snapshot: inmutable, con la tarjeta al final.

Entra:  data/rows.parquet, data/validation.json   de los pasos 3 y 4
        params.yaml                                snapshot.id, snapshot.padre, snapshot.corte, split.umbral
Sale:   s3://ml-datos/datasets/<id>/rows.parquet, validation.json y, al final, snapshot.json (la tarjeta)
        data/publicado.json                        el recibo: id, rows_sha256 y la version_id de cada llave
Reglas: solo publica si la validación pasó y tu código está en un commit (la tarjeta guarda ese commit).
        Toda escritura lleva If-None-Match: * (no pisa nada). Si la llave ya existe con el mismo contenido, sigue
        (correrlo dos veces deja lo mismo); si existe con otro contenido, se detiene: un contenido nuevo lleva un id nuevo.
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone

import pandas as pd
from botocore.exceptions import ClientError
from _comun import DATA, DATOS, RAIZ, params, s3, sha256

p = params()
sid = p["snapshot"]["id"]
if not re.fullmatch(r"ds-\d{4}-\d{2}-\d{2}(-r\d+)?", sid):
    sys.exit(f"✗ «{sid}» no es un id de snapshot (ds-AAAA-MM-DD, o ds-AAAA-MM-DD-rN si se reemite)")
val = json.loads((DATA / "validation.json").read_text())
if val["status"] != "passed" or val["snapshot_id"] != sid:
    sys.exit("✗ la validación no pasó (o es de otro id): no se publica nada")
git = lambda *a: subprocess.run(["git", *a], cwd=RAIZ, capture_output=True, text=True).stdout.strip()  # noqa: E731
commit = git("rev-parse", "HEAD")
if not commit or git("status", "--porcelain", "--", "pipeline", "dvc.yaml"):
    sys.exit("✗ tu código tiene cambios sin commit: la tarjeta no podría decir con qué código se armó. git commit primero")

rows_b = (DATA / "rows.parquet").read_bytes()
huella = sha256(rows_b)
rows = pd.read_parquet(DATA / "rows.parquet")
cliente, base = s3(), f"datasets/{sid}"


def poner(nombre: str, cuerpo: bytes) -> str:
    """PUT condicional: escribe solo si la llave no existe. Devuelve la version_id de lo que quedó."""
    key = f"{base}/{nombre}"
    try:
        return cliente.put_object(Bucket=DATOS, Key=key, Body=cuerpo, IfNoneMatch="*")["VersionId"]
    except ClientError as e:
        if e.response["Error"]["Code"] != "PreconditionFailed":
            raise
    ya = cliente.get_object(Bucket=DATOS, Key=key)
    if sha256(ya["Body"].read()) != sha256(cuerpo):
        sys.exit(f"✗ {key} ya existe con otro contenido (412 Precondition Failed). Un snapshot publicado no se reescribe: "
                 "si el contenido cambió, usa un id nuevo en params.yaml")
    print(f"  {nombre}: ya estaba, mismo contenido")
    return ya["VersionId"]


versiones = {"rows.parquet": poner("rows.parquet", rows_b),
             "validation.json": poner("validation.json", (DATA / "validation.json").read_bytes())}
tarjeta = {
    "snapshot_id": sid, "parent": p["snapshot"]["padre"], "corte": p["snapshot"]["corte"],
    "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "rows_path": f"s3://{DATOS}/{base}/rows.parquet", "rows_sha256": huella,
    "counts": {"train": int((rows["split"] == "train").sum()), "val": int((rows["split"] == "val").sum()), "total": len(rows)},
    "label_sources": {k: round(float(x), 3) for k, x in rows["label_source"].value_counts(normalize=True).sort_index().items()},
    "split": {"by": "seller_id", "rule": f"sha256(seller_id) mod 100 < {p['split']['umbral']} -> train"},
    "code": {"repo": "c01-versionado", "commit": commit},
    "validation": {"status": val["status"], "report": f"s3://{DATOS}/{base}/validation.json"},
}
try:   # la tarjeta va al final: un snapshot sin tarjeta no existe
    versiones["snapshot.json"] = cliente.put_object(Bucket=DATOS, Key=f"{base}/snapshot.json", IfNoneMatch="*",
                                                    Body=json.dumps(tarjeta, ensure_ascii=False, indent=2).encode())["VersionId"]
except ClientError as e:
    if e.response["Error"]["Code"] != "PreconditionFailed":
        raise
    ya = json.loads(cliente.get_object(Bucket=DATOS, Key=f"{base}/snapshot.json")["Body"].read())
    if ya["rows_sha256"] != huella:
        sys.exit(f"✗ {base}/snapshot.json ya existe y describe otras filas: usa un id nuevo")
    tarjeta = ya
    versiones["snapshot.json"] = cliente.head_object(Bucket=DATOS, Key=f"{base}/snapshot.json")["VersionId"]
    print("  snapshot.json: ya estaba, describe las mismas filas")
(DATA / "publicado.json").write_text(json.dumps({"snapshot_id": sid, "rows_sha256": huella, "versiones": versiones}, indent=2) + "\n")
print(f"publicado s3://{DATOS}/{base}/ · rows_sha256 {huella[:12]}… · {tarjeta['counts']} · commit {tarjeta['code']['commit'][:7]}")
