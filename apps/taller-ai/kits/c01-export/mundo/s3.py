"""Mirar el S3 local con permisos de administrador. En C01: el AWS CLI.

    python mundo/s3.py ls <bucket> [prefijo]          # las llaves, su tamaño y su fecha
    python mundo/s3.py golden                         # el manifest del examen: huella, cuántas fotos, slices y categorías
    python mundo/s3.py calibracion                    # el set de calibración de un engine int8: de dónde salen sus fotos
    python mundo/s3.py versiones <bucket> <llave>     # las versiones guardadas de un objeto (los dos buckets tienen versionado)

Equivalentes en AWS: aws s3 ls, aws s3api list-object-versions.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CALIBRACION, CLASES, DATOS, GOLDEN, engine_yaml, golden_manifest, s3, sha256  # noqa: E402


def llaves(s, bucket: str, prefijo: str = "") -> list[dict]:
    out = []
    for pag in s.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefijo):
        out += pag.get("Contents", [])
    return out


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
    elif a[0] == "golden":
        b, fotos = golden_manifest(s)
        congelada = engine_yaml()["paridad"]["manifest_sha256"]
        print(f"{GOLDEN}: manifest sha256 {sha256(b)[:16]}… · engine.yaml dice {congelada[:16]}… → {'igual' if sha256(b) == congelada else 'DISTINTO'}")
        print(f"{len(fotos)} fotos · slices {dict(Counter(f['slice'] for f in fotos))}")
        print("por categoría: " + ", ".join(f"{CLASES[k]} {v}" for k, v in sorted(Counter(f['label_id'] for f in fotos).items())))
    elif a[0] == "calibracion":
        m = json.loads(s.get_object(Bucket=DATOS, Key=f"calibracion/{CALIBRACION}/manifest.json")["Body"].read())
        _, g = golden_manifest(s)
        cruce = {f["image_sha256"] for f in m["fotos"]} & {f["origen_sha256"] for f in g}
        print(f"{m['set']}: {m['n']} fotos de {m['snapshot']} ({m['split']}) · del examen: {len(cruce)}")
    elif a[0] == "versiones" and len(a) == 3:
        r = s.list_object_versions(Bucket=a[1], Prefix=a[2])
        for v in sorted(r.get("Versions", []), key=lambda v: v["LastModified"]):
            if v["Key"] == a[2]:
                print(f"{v['LastModified']:%Y-%m-%d %H:%M:%S}  {v['Size']:>8} B  {'ACTUAL ' if v['IsLatest'] else '       '} version-id {v['VersionId']}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
