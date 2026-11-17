"""Mirar el S3 local con permisos de administrador. En C01: el AWS CLI.

    python mundo/s3.py ls <bucket> [prefijo]          # las llaves, su tamaño y su fecha
    python mundo/s3.py tarjeta <id>                   # la tarjeta de un snapshot (snapshot.json)
    python mundo/s3.py checkpoint <snapshot> <corrida>   # qué trae el checkpoint de una corrida

Equivalentes en AWS: aws s3 ls, aws s3 cp s3://…/snapshot.json -.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CKPT, llaves, s3, tarjeta  # noqa: E402


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
    elif a[0] == "checkpoint" and len(a) == 3:
        import torch

        b = s.get_object(Bucket=CKPT, Key=f"c01/{a[1]}/{a[2]}/ultimo.pt")["Body"].read()
        ck = torch.load(io.BytesIO(b), map_location="cpu", weights_only=True)
        print(f"{len(b) / 1e3:.0f} kB · época {ck.get('epoca')} · paso {ck.get('paso')} · piezas: {', '.join(ck)}")
        print(f"ingredientes: {json.dumps(ck.get('ingredientes'), ensure_ascii=False)}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
