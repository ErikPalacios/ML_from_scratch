"""Una herramienta chica para mirar y reparar el S3 local, con permisos de administrador. En C01: el AWS CLI.

    python mundo/s3.py ls <bucket> [prefijo]                       # las llaves y su tamaño
    python mundo/s3.py versiones <bucket> [prefijo]                # cada versión y cada marca de borrado, con su huella
    python mundo/s3.py borrar-version <bucket> <llave> <version>   # borra UNA versión (o una marca de borrado)
    python mundo/s3.py versionado <bucket> [on|off]                # mira o cambia el versionado del bucket

Equivalentes en AWS: aws s3 ls, aws s3api list-object-versions, aws s3api delete-object --version-id,
aws s3api get-bucket-versioning / put-bucket-versioning.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import llaves, s3, sha256, versiones  # noqa: E402


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    s, cmd = s3(), a[0]
    if cmd == "ls" and len(a) >= 2:
        for k in llaves(s, a[1], a[2] if len(a) > 2 else ""):
            print(f"{s.head_object(Bucket=a[1], Key=k)['ContentLength']:>9}  {k}")
    elif cmd == "versiones" and len(a) >= 2:
        vs, ms = versiones(s, a[1], a[2] if len(a) > 2 else "")
        filas = [(v["Key"], v["LastModified"], v["VersionId"], v["IsLatest"], v["Size"]) for v in vs]
        filas += [(m["Key"], m["LastModified"], m["VersionId"], m["IsLatest"], None) for m in ms]
        for key, fecha, vid, ultima, size in sorted(filas, key=lambda f: (f[0], f[1])):
            if size is None:
                que = "MARCA DE BORRADO"
            else:
                cuerpo = s.get_object(Bucket=a[1], Key=key, VersionId=vid)["Body"].read() if size <= 5_000_000 else b""
                que = f"{size:>8} B  sha256 {sha256(cuerpo)[:12]}…" if cuerpo else f"{size:>8} B"
            print(f"{key}\n    {fecha:%Y-%m-%d %H:%M:%S} UTC  {'vigente ' if ultima else 'anterior'}  {que}  version {vid}")
    elif cmd == "borrar-version" and len(a) == 4:
        s.delete_object(Bucket=a[1], Key=a[2], VersionId=a[3])
        print(f"borrada la versión {a[3]} de {a[2]}")
    elif cmd == "versionado" and len(a) >= 2:
        if len(a) == 3:
            s.put_bucket_versioning(Bucket=a[1], VersioningConfiguration={"Status": "Enabled" if a[2] == "on" else "Suspended"})
        print(f"{a[1]}: versionado {s.get_bucket_versioning(Bucket=a[1]).get('Status') or 'nunca prendido'}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
