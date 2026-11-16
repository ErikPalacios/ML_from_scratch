"""Paso 6 · Entrenar con un snapshot, comprobando todo al leer, y dejar los punteros del linaje.

Entra:  params.yaml                       entrenar.snapshot (un id, nunca «latest») y entrenar.semilla
        s3://ml-datos/datasets/<id>/      la tarjeta y las filas
        s3://fotos/…                      cada foto, por su llave
        entrada/borrados.csv              las fotos que se borraron: se saltan, con cualquier fecha
Sale:   corridas/run-AAAAMMDD-HHMMSS.json  run_id, modelo, fecha, snapshot, rows_sha256, commit, arbol_limpio,
        entorno_sha256, semilla, metricas y filas {train, val, omitidas_borradas}
Reglas: sin tarjeta no hay snapshot; si la huella de las filas o de una foto no coincide, se detiene.
        Solo entrena desde un commit con el árbol limpio (pipeline/, dvc.yaml, dvc.lock, params.yaml).
"""
import io
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
from botocore.exceptions import ClientError
from _comun import CORRIDAS, DATOS, ENTRADA, FOTOS, RAIZ, entrenar, huella_entorno, params, s3, sha256

p = params()["entrenar"]
sid = str(p["snapshot"])
if not re.fullmatch(r"ds-\d{4}-\d{2}-\d{2}(-r\d+)?", sid):
    sys.exit(f"✗ entrenar.snapshot = «{sid}»: tiene que ser un id de snapshot. Una carpeta como «latest» cambia de "
             "contenido y la corrida no podría decir con qué datos entrenó")
git = lambda *a: subprocess.run(["git", *a], cwd=RAIZ, capture_output=True, text=True).stdout.strip()  # noqa: E731
commit = git("rev-parse", "HEAD")
sucio = git("status", "--porcelain", "--", "pipeline", "dvc.yaml", "dvc.lock", "params.yaml")
if not commit or sucio:
    sys.exit(f"✗ hay cambios sin commit ({sucio.splitlines()[0] if sucio else 'no hay commits'}): el commit no diría qué código corrió")

cliente = s3()
try:
    tarjeta = json.loads(cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/snapshot.json")["Body"].read())
except ClientError:
    sys.exit(f"✗ {sid} no tiene tarjeta (snapshot.json): un snapshot sin tarjeta no existe")
crudo = cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()
if sha256(crudo) != tarjeta["rows_sha256"]:
    sys.exit(f"✗ las filas de {sid} no coinciden con su tarjeta: alguien las reescribió")
filas = pd.read_parquet(io.BytesIO(crudo))
borrados = set(pd.read_csv(ENTRADA / "borrados.csv")["image_sha256"])
omitidas = filas["image_sha256"].isin(borrados)
leer = filas[~omitidas]


def foto(fila):
    try:
        b = cliente.get_object(Bucket=FOTOS, Key=fila.image_key)["Body"].read()
    except ClientError:
        return fila.image_key, None, "no existe"
    return fila.image_key, b, None if sha256(b) == fila.image_sha256 else "su huella no coincide"


with ThreadPoolExecutor(16) as ex:
    fotos = list(ex.map(foto, leer.itertuples()))
malas = [(k, err) for k, _, err in fotos if err]
if malas:
    sys.exit(f"✗ {len(malas)} fotos no se pueden usar, por ejemplo {malas[0][0]}: {malas[0][1]}. "
             "Si alguien pidió borrarlas, anótalas en entrada/borrados.csv")
bytes_de = {k: b for k, b, _ in fotos}
tr = [(bytes_de[f.image_key], int(f.label_id)) for f in leer.itertuples() if f.split == "train"]
va = [(bytes_de[f.image_key], int(f.label_id)) for f in leer.itertuples() if f.split == "val"]
metricas = entrenar(tr, va, p["semilla"])

ahora = datetime.now(timezone.utc)
corrida = {"run_id": f"run-{ahora:%Y%m%d-%H%M%S}", "modelo": f"modelo-{ahora:%Y-%m-%d}", "fecha": ahora.isoformat(timespec="seconds"),
           "snapshot": sid, "rows_sha256": tarjeta["rows_sha256"], "commit": commit, "repo": "c01-versionado", "arbol_limpio": True,
           "entorno_sha256": huella_entorno(), "semilla": p["semilla"], "metricas": metricas,
           "filas": {"train": len(tr), "val": len(va), "omitidas_borradas": int(omitidas.sum())}}
CORRIDAS.mkdir(exist_ok=True)
(CORRIDAS / f"{corrida['run_id']}.json").write_text(json.dumps(corrida, ensure_ascii=False, indent=2) + "\n")
print(f"{len(leer)} fotos leídas y comprobadas · {int(omitidas.sum())} omitidas por borrado")
print(f"corridas/{corrida['run_id']}.json: {corrida['modelo']} ← {sid} ({tarjeta['rows_sha256'][:12]}…) · commit {commit[:7]} · "
      f"entorno {corrida['entorno_sha256'][:12]}… · accuracy_val {metricas['accuracy_val']}")
