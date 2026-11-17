"""Crea el mundo de la estación 3: el marketplace de C01 el 1 de octubre de 2026, a las 03:00 UTC, cuando arranca el
pipeline del mes. Tarda ≈ 1 minuto (la mitad es entrenar el champion de septiembre).

    python mundo/crear.py

1. Baja las 10,000 fotos de prueba de Fashion-MNIST (≈ 4.4 MB, una sola vez, a data/fmnist/).
2. Las publica como fotos del marketplace (JPEG de 56×56) en s3://fotos/, de abril a septiembre de 2026.
3. Publica los snapshots ds-2026-08-01 y ds-2026-09-01 en s3://ml-datos/datasets/, con su tarjeta, igual que los deja la
   estación 2 (split por vendedor; el golden set de la estación 4 queda fuera de los dos).
4. Crea el bucket s3://ml-ckpt/ (checkpoints), vacío.
5. Entrena el champion de septiembre con ds-2026-08-01, lo anota en MLflow y lo registra como classifier v1 @champion.
6. Escribe mundo/gateway/paridad.json: la huella del tensor que sale del gateway para 16 fotos.

Si ya existe, lo deja como está (correrlo dos veces no duplica nada).
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import shutil
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CKPT, CLASES, CORRIDA_EQUIPO, DATA, DATOS, ENTRADA, EXPERIMENTO, FOTOS, GATEWAY, MODELO,  # noqa: E402
                         PADRE, SNAPSHOT, escribir_json, mlflow_arriba, mlflow_cliente, s3, sha256, tarjeta)

URL = "https://github.com/zalandoresearch/fashion-mnist/raw/master/data/fashion/{}.gz"
ARCHIVOS = ["t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte"]
SHA_FMNIST = {"t10k-images-idx3-ubyte": "346e55b948d973a97e58d2351dde16a484bd415d4595297633bb08f03db6a073",
              "t10k-labels-idx1-ubyte": "67da17c76eaffca5446c3361aaab5c3cd6d1c2608764d35dfb1850b086bf8dd5"}
SEMILLA = 2026
VENDEDORES = 400
UMBRAL = 80                       # cubeta = sha256(seller_id) mod 100; < 80 → train (20 % de vendedores en val)
INICIO = datetime(2026, 4, 1, tzinfo=timezone.utc)
DIAS = 183                        # abril a septiembre
GOLDEN = 1000                     # el examen fijo de la estación 4: fuera de los snapshots
FUENTES = ["humano", "moderador", "vendedor"]


def fashion_mnist() -> tuple[np.ndarray, np.ndarray]:
    cache = DATA / "fmnist"
    cache.mkdir(parents=True, exist_ok=True)
    for a in ARCHIVOS:
        p = cache / f"{a}.gz"
        if not p.exists():
            print(f"  descargando {a}… (Fashion-MNIST, Zalando Research, licencia MIT)")
            with urllib.request.urlopen(URL.format(a), timeout=60) as r, open(p, "wb") as f:
                shutil.copyfileobj(r, f)
        if hashlib.sha256(p.read_bytes()).hexdigest() != SHA_FMNIST[a]:
            p.unlink()
            sys.exit(f"✗ {a}.gz no es el archivo esperado (su sha256 no coincide). Bórralo y vuelve a correr crear.py")
    X = np.frombuffer(gzip.open(cache / f"{ARCHIVOS[0]}.gz").read(), np.uint8, offset=16).reshape(-1, 28, 28)
    y = np.frombuffer(gzip.open(cache / f"{ARCHIVOS[1]}.gz").read(), np.uint8, offset=8).astype(np.int64)
    return X, y


def jpeg(a: np.ndarray) -> bytes:
    from PIL import Image

    im = Image.fromarray(a).resize((56, 56), Image.Resampling.BICUBIC).convert("RGB")   # así llega del celular de quien vende
    b = io.BytesIO()
    im.save(b, "JPEG", quality=90)
    return b.getvalue()


def cubeta(seller_id: str) -> int:
    return int(hashlib.sha256(seller_id.encode()).hexdigest(), 16) % 100


def publicaciones():
    import pandas as pd

    X, y = fashion_mnist()
    rng = np.random.default_rng(SEMILLA)
    n = len(y)
    segundos = np.sort(rng.integers(0, DIAS * 86400, n))
    creada = [INICIO + timedelta(seconds=int(s)) for s in segundos]
    orden = rng.permutation(n)                      # qué foto de Fashion-MNIST cae en cada publicación
    vendedor = [f"s-{v:04d}" for v in rng.integers(1, VENDEDORES + 1, n)]
    fuente = rng.choice(FUENTES, n, p=[0.35, 0.15, 0.50])
    fotos = [jpeg(X[i]) for i in orden]
    pubs = pd.DataFrame({
        "image_key": [f"pub/{c:%Y/%m}/p-{k:06d}.jpg" for k, c in enumerate(creada, 1)],
        "image_sha256": [sha256(f) for f in fotos], "seller_id": vendedor, "label_id": y[orden],
        "label_source": fuente, "guia_version": np.where(fuente == "humano", "v2", None),
        "label_ts": [c + timedelta(days=int(d)) for c, d in zip(creada, rng.integers(1, 20, n))],
        "created_at": creada, "bytes": [len(f) for f in fotos]})
    golden = set(pubs.sample(GOLDEN, random_state=SEMILLA)["image_key"])
    pubs["golden"] = pubs["image_key"].isin(golden)
    return pubs, fotos


def subir_fotos(s, pubs, fotos) -> None:
    from concurrent.futures import ThreadPoolExecutor

    hay = s.list_objects_v2(Bucket=FOTOS, MaxKeys=1).get("KeyCount", 0)
    if hay:
        print("  s3://fotos/ ya tiene fotos: no las vuelvo a subir")
        return
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda kv: s.put_object(Bucket=FOTOS, Key=kv[0], Body=kv[1], ContentType="image/jpeg"),
                    zip(pubs["image_key"], fotos)))
    print(f"  {len(fotos)} fotos en s3://fotos/ ({sum(map(len, fotos)) / 1e6:.1f} MB)")


def publicar(s, pubs, sid: str, corte: datetime, padre: str | None) -> None:
    import pandas as pd

    if tarjeta(s, sid):
        print(f"  {sid} ya está publicado")
        return
    f = pubs[(pubs["created_at"] < corte) & (pubs["label_ts"] < corte) & ~pubs["golden"]].drop(columns="golden")
    f = f.assign(split=["train" if cubeta(v) < UMBRAL else "val" for v in f["seller_id"]]).sort_values("image_key").reset_index(drop=True)
    f["created_at"] = pd.to_datetime(f["created_at"], utc=True)
    f["label_ts"] = pd.to_datetime(f["label_ts"], utc=True)
    b = io.BytesIO()
    f.to_parquet(b, index=False)
    rows = b.getvalue()
    base = f"datasets/{sid}"
    s.put_object(Bucket=DATOS, Key=f"{base}/rows.parquet", Body=rows, IfNoneMatch="*")
    card = {"snapshot_id": sid, "parent": padre, "corte": corte.isoformat().replace("+00:00", "Z"),
            "created_at": (corte + timedelta(hours=3)).isoformat(timespec="seconds"),
            "rows_path": f"s3://{DATOS}/{base}/rows.parquet", "rows_sha256": sha256(rows),
            "counts": {"train": int((f["split"] == "train").sum()), "val": int((f["split"] == "val").sum()), "total": len(f)},
            "label_sources": {k: round(float(x), 3) for k, x in f["label_source"].value_counts(normalize=True).sort_index().items()},
            "split": {"by": "seller_id", "rule": f"sha256(seller_id) mod 100 < {UMBRAL} -> train"},
            "code": {"repo": "c01-versionado", "commit": "9d41c07"}, "validation": {"status": "passed"}}
    s.put_object(Bucket=DATOS, Key=f"{base}/snapshot.json", Body=json.dumps(card, ensure_ascii=False, indent=2).encode(), IfNoneMatch="*")
    print(f"  {sid}: {card['counts']} · rows_sha256 {card['rows_sha256'][:12]}…")


def buckets(s) -> None:
    hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    for b in (FOTOS, DATOS, CKPT):
        if b not in hay:
            s.create_bucket(Bucket=b)
    s.put_bucket_versioning(Bucket=DATOS, VersioningConfiguration={"Status": "Enabled"})


def champion(s) -> None:
    """El modelo de septiembre: lo entrenó el equipo con ds-2026-08-01 y hoy atiende en producción."""
    import mlflow
    import torch

    from mundo.equipo import entrenar_equipo

    c = mlflow_cliente()
    try:
        c.get_model_version_by_alias(MODELO, "champion")
        print(f"  {MODELO}@champion ya está registrado")
        return
    except Exception:  # noqa: BLE001
        pass
    print(f"  entrenando el champion de septiembre con {PADRE} (≈ 30 s)…")
    t0 = time.time()
    pesos, metricas, huella = entrenar_equipo(s, PADRE)
    exp = c.get_experiment_by_name(EXPERIMENTO) or c.get_experiment(c.create_experiment(EXPERIMENTO))
    mlflow.set_experiment(EXPERIMENTO)
    card = tarjeta(s, PADRE)
    with mlflow.start_run(run_name=CORRIDA_EQUIPO) as run:
        mlflow.log_params({"arranque": "cero", "epocas": 4, "batch": 64, "lr": 0.003, "weight_decay": 0.0001, "semilla": 7,
                           "snapshot": PADRE, "corrida": CORRIDA_EQUIPO})
        for e, m in enumerate(metricas):
            mlflow.log_metrics(m, step=e)
        mlflow.set_tags({"corrida": CORRIDA_EQUIPO, "equipo": "true", "snapshot": PADRE, "rows_sha256": card["rows_sha256"],
                         "commit": "4b8e2a1", "arbol_limpio": "true", "pesos_sha256": huella,
                         "mlflow.note.content": "El modelo de septiembre. Lo entrenó el equipo el 1 de septiembre de 2026 y hoy está en producción."})
        with tempfile.TemporaryDirectory() as d:
            torch.save(pesos, Path(d) / "pesos.pt")
            (Path(d) / "labels.json").write_text(json.dumps(CLASES, ensure_ascii=False) + "\n")
            mlflow.log_artifacts(d, "modelo")
    c.create_registered_model(MODELO, description="El clasificador de categorías del marketplace (C01).")
    mv = c.create_model_version(MODELO, source=f"runs:/{run.info.run_id}/modelo", run_id=run.info.run_id)
    c.set_registered_model_alias(MODELO, "champion", mv.version)
    print(f"  {MODELO} v{mv.version} @champion · val_top1 {metricas[-1]['val_top1']:.4f} · {time.time() - t0:.0f} s")
    del exp


def paridad(s) -> None:
    from mundo.comun import filas
    from mundo.gateway.preprocess import preprocess

    f = filas(s, SNAPSHOT).head(16)
    out = [{"image_key": r.image_key, "image_sha256": r.image_sha256,
            "tensor_sha256": sha256(preprocess(s.get_object(Bucket=FOTOS, Key=r.image_key)["Body"].read()).tobytes())}
           for r in f.itertuples()]
    escribir_json(GATEWAY / "paridad.json", {
        "nota": "La huella (sha256 de los float32) del tensor que saca el gateway para 16 fotos de ds-2026-09-01. "
                "La genera el equipo de serving con la imagen del gateway. Si tu entrenamiento saca otra huella para la "
                "misma foto, no ve las fotos como las ve producción.", "fotos": out})


def main() -> None:
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5400: docker compose up -d --wait")
    s = s3()
    try:
        buckets(s)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"✗ el S3 local no responde en localhost:9400 ({type(e).__name__}): docker compose up -d --wait")
    ENTRADA.mkdir(exist_ok=True)
    escribir_json(ENTRADA / "categorias.json", CLASES)
    pubs, fotos = publicaciones()
    subir_fotos(s, pubs, fotos)
    publicar(s, pubs, PADRE, datetime(2026, 9, 1, tzinfo=timezone.utc), "ds-2026-07-01")      # agosto: corte el 1 de septiembre
    publicar(s, pubs, SNAPSHOT, datetime(2026, 10, 1, tzinfo=timezone.utc), PADRE)            # septiembre: corte el 1 de octubre
    champion(s)
    paridad(s)
    print("✓ mundo listo: python verificar.py mundo")


if __name__ == "__main__":
    main()
