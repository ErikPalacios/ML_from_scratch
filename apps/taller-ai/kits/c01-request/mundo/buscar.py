"""Busca una request por su request_id en todos los lugares donde dejó rastro (no es parte de lo que escribes).

    python mundo/buscar.py 5a1e07c3-…            # el backend, el ALB, el disco de cada nodo y el log crudo en S3
    python mundo/buscar.py 5a1e07c3-… --sin-s3    # sin bajar los archivos de S3 de la última hora

Es lo que hace la persona de guardia con un id que trae un reporte de soporte: no necesita saber en qué pod cayó ni a
qué hora exacta. En C01 serían el log del backend, los access logs del ALB en S3 y el log del gateway (en S3 o en
CloudWatch Logs), buscados por el mismo id.
"""
from __future__ import annotations

import gzip
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, CRUDO, LOGS, lineas_nodo, objetos, pods, s3  # noqa: E402


def en_archivo(p: Path, rid: str, campo: str) -> list[dict]:
    if not p.exists():
        return []
    out = []
    for linea in p.read_text(errors="replace").splitlines()[-20000:]:
        if rid in linea:
            try:
                d = json.loads(linea)
            except json.JSONDecodeError:
                continue
            if d.get(campo) == rid:
                out.append(d)
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rid = sys.argv[1]
    print(f"request_id {rid}\n")
    b = en_archivo(LOGS / "backend.log", rid, "request_id")
    print(f"backend (logs/backend.log): {json.dumps(b[-1], ensure_ascii=False) if b else 'no está (¿la mandó mundo/carga.py?)'}")
    a = en_archivo(LOGS / "alb.log", rid, "x_request_id")
    print(f"ALB (logs/alb.log, el access log): {json.dumps(a[-1], ensure_ascii=False) if a else 'no está (el ALB solo anota el X-Request-ID que trae la request)'}")
    vistos = 0
    for p in pods():
        for f, linea in lineas_nodo(p["nodo"], rid, kb=4000):
            vistos += 1
            print(f"gateway, disco de nodo-{p['nodo']} ({f}):\n  {linea}")
    if not vistos:
        print("gateway: no está en el disco de ningún nodo")
    if "--sin-s3" in sys.argv:
        return
    ahora, c, en_s3 = datetime.now(timezone.utc), s3(), []
    for d in (ahora - timedelta(hours=1), ahora):
        for o in objetos(f"{CRUDO}{d:%Y/%m/%d/%H}/"):
            for x in gzip.decompress(c.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read()).decode().splitlines():
                if rid in x:
                    en_s3.append((o["Key"], json.loads(x)))
    for k, r in en_s3:
        print(f"S3, s3://{BUCKET}/{k}:\n  hora {r.get('time')} · nodo {r.get('nodo')} · {r.get('log')}")
    if not en_s3:
        print("S3 (logs/crudo/, última hora): todavía no está (Fluent Bit sube cada minuto)")


if __name__ == "__main__":
    main()
