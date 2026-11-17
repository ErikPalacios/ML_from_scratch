"""Mirar el S3 local con permisos de administrador. En C01: el AWS CLI.

    python mundo/s3.py ls <bucket> [prefijo]          # las llaves, su tamaño y su fecha
    python mundo/s3.py tarjeta <id>                   # la tarjeta de un snapshot (snapshot.json)
    python mundo/s3.py golden                         # el manifest del examen: huella, cuántas fotos, slices y categorías
    python mundo/s3.py versiones <llave>              # las versiones guardadas de un objeto de s3://ml-datos (el bucket tiene versionado)
    python mundo/s3.py restaurar <llave> <version-id> # vuelve a poner una versión anterior como la actual

Equivalentes en AWS: aws s3 ls, aws s3api list-object-versions, aws s3api copy-object --copy-source …?versionId=….
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, DATOS, gate_yaml, golden_manifest, llaves, s3, sha256, tarjeta  # noqa: E402


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    s = s3()
    if a[0] == "ls" and len(a) >= 2:
        objs = llaves(s, a[1], a[2] if len(a) > 2 else "")
        for o in objs[:200]:
            print(f"{o['Size']:>9}  {o['LastModified']:%Y-%m-%d %H:%M:%S}  {o['Key']}")
        if len(objs) > 200:
            print(f"… y {len(objs) - 200} más ({len(objs)} en total)")
    elif a[0] == "tarjeta" and len(a) == 2:
        print(json.dumps(tarjeta(s, a[1]), ensure_ascii=False, indent=2))
    elif a[0] == "golden":
        b, fotos = golden_manifest(s)
        congelada = gate_yaml()["examen"]["manifest_sha256"]
        print(f"manifest sha256 {sha256(b)[:16]}… · gate.yaml dice {congelada[:16]}… → {'igual' if sha256(b) == congelada else 'DISTINTO'}")
        print(f"{len(fotos)} fotos · slices {dict(Counter(f['slice'] for f in fotos))}")
        print("por categoría: " + ", ".join(f"{CLASES[k]} {v}" for k, v in sorted(Counter(f['label_id'] for f in fotos).items())))
    elif a[0] == "versiones" and len(a) == 2:
        r = s.list_object_versions(Bucket=DATOS, Prefix=a[1])
        for v in sorted(r.get("Versions", []), key=lambda v: v["LastModified"]):
            if v["Key"] == a[1]:
                print(f"{v['LastModified']:%Y-%m-%d %H:%M:%S}  {v['Size']:>8} B  {'ACTUAL ' if v['IsLatest'] else '       '} version-id {v['VersionId']}")
    elif a[0] == "restaurar" and len(a) == 3:
        s.copy_object(Bucket=DATOS, Key=a[1], CopySource={"Bucket": DATOS, "Key": a[1], "VersionId": a[2]})
        print(f"s3://{DATOS}/{a[1]}: la versión {a[2]} vuelve a ser la actual (como una versión nueva, con el mismo contenido)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
