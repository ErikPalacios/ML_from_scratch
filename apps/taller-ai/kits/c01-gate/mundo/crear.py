"""Crea el mundo de la estación 4: el marketplace de C01 el 1 de octubre de 2026, a las 05:00 UTC. El entrenamiento del
mes ya terminó (estación 3) y el pipeline llega al gate. Tarda ≈ 2 minutos (casi todo es entrenar los modelos del equipo).

    python mundo/crear.py

1. Baja las 10,000 fotos de prueba de Fashion-MNIST (≈ 4.4 MB, una sola vez, a data/fmnist/).
2. Las publica como fotos del marketplace (JPEG de 56×56) en s3://fotos/, de abril a septiembre de 2026.
3. Publica los snapshots de junio a septiembre en s3://ml-datos/datasets/, como los deja la estación 2.
4. Congela el examen: s3://ml-datos/golden/golden-v1/ (1,000 fotos que no están en ningún snapshot, con su slice:
   normal, poca luz o chica) y su manifest.json, cuya huella está en gate.yaml.
5. Entrena el historial del registro: classifier v1 (julio), v2 (agosto) y v3 (septiembre, @champion).
6. Entrena los dos candidatos de octubre (corridas del experimento c01-entrenamiento, sin registrar):
   cand-2026-10-01 y cand-2026-10-01-proveedor.
7. Escribe corrida.yaml: los parámetros de la corrida de esta noche, ya resueltos por el orquestador.

Si ya existe, lo deja como está (correrlo dos veces no duplica nada).
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CANDIDATO, CLASES, CORRIDA_YAML, DATA, DATOS, ENTRADA, FOTOS, GOLDEN, MODELO,  # noqa: E402
                         PROVEEDOR, SNAPSHOT, corrida_por_nombre, escribir_json, mlflow_arriba, mlflow_cliente, s3,
                         sha256, tarjeta)

URL = "https://github.com/zalandoresearch/fashion-mnist/raw/master/data/fashion/{}.gz"
ARCHIVOS = ["t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte"]
SHA_FMNIST = {"t10k-images-idx3-ubyte": "346e55b948d973a97e58d2351dde16a484bd415d4595297633bb08f03db6a073",
              "t10k-labels-idx1-ubyte": "67da17c76eaffca5446c3361aaab5c3cd6d1c2608764d35dfb1850b086bf8dd5"}
SEMILLA = 2026
VENDEDORES = 400
UMBRAL = 80                       # cubeta = sha256(seller_id) mod 100; < 80 → train (20 % de vendedores en val)
INICIO = datetime(2026, 4, 1, tzinfo=timezone.utc)
DIAS = 183                        # abril a septiembre
N_GOLDEN = 1000                   # el examen fijo: fuera de todos los snapshots
FUENTES = ["humano", "moderador", "vendedor"]
CAMISAS, PLAYERAS = CLASES.index("camisas"), CLASES.index("playeras")

# Los snapshots (id, corte, padre) y el historial del registro: (versión, mes, snapshot, arranca de, épocas, semilla)
SNAPSHOTS = [("ds-2026-06-01", datetime(2026, 7, 1, tzinfo=timezone.utc), "ds-2026-05-01"),
             ("ds-2026-07-01", datetime(2026, 8, 1, tzinfo=timezone.utc), "ds-2026-06-01"),
             ("ds-2026-08-01", datetime(2026, 9, 1, tzinfo=timezone.utc), "ds-2026-07-01"),
             ("ds-2026-09-01", datetime(2026, 10, 1, tzinfo=timezone.utc), "ds-2026-08-01")]
HISTORIA = [("2026-07", "ds-2026-06-01", None, 4, 7), ("2026-08", "ds-2026-07-01", 1, 3, 8),
            ("2026-09", "ds-2026-08-01", 2, 3, 9)]


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


def jpeg(a: np.ndarray, slice_: str = "normal") -> bytes:
    from PIL import Image

    im = Image.fromarray(a).resize((56, 56), Image.Resampling.BICUBIC).convert("RGB")   # así llega del celular de quien vende
    if slice_ == "poca_luz":
        im = Image.eval(im, lambda v: int(v * 0.45))                                     # foto tomada de noche
    elif slice_ == "chica":
        im = im.resize((20, 20), Image.Resampling.BILINEAR).resize((56, 56), Image.Resampling.BILINEAR)  # se subió miniatura
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
    orden = rng.permutation(n)
    vendedor = [f"s-{v:04d}" for v in rng.integers(1, VENDEDORES + 1, n)]
    fuente = rng.choice(FUENTES, n, p=[0.35, 0.15, 0.50])
    fotos = [jpeg(X[i]) for i in orden]
    pubs = pd.DataFrame({
        "image_key": [f"pub/{c:%Y/%m}/p-{k:06d}.jpg" for k, c in enumerate(creada, 1)],
        "image_sha256": [sha256(f) for f in fotos], "seller_id": vendedor, "label_id": y[orden],
        "label_source": fuente, "guia_version": np.where(fuente == "humano", "v2", None),
        "label_ts": [c + timedelta(days=int(d)) for c, d in zip(creada, rng.integers(1, 20, n))],
        "created_at": creada, "bytes": [len(f) for f in fotos]})
    golden = set(pubs.sample(N_GOLDEN, random_state=SEMILLA)["image_key"])   # las mismas 1,000 que la estación 3 dejó fuera
    pubs["golden"] = pubs["image_key"].isin(golden)
    return pubs, fotos, X[orden]


def buckets(s) -> None:
    hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    for b in (FOTOS, DATOS):
        if b not in hay:
            s.create_bucket(Bucket=b)
    s.put_bucket_versioning(Bucket=DATOS, VersioningConfiguration={"Status": "Enabled"})


def subir_fotos(s, pubs, fotos) -> None:
    from concurrent.futures import ThreadPoolExecutor

    if s.list_objects_v2(Bucket=FOTOS, MaxKeys=1).get("KeyCount", 0):
        print("  s3://fotos/ ya tiene fotos: no las vuelvo a subir")
        return
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda kv: s.put_object(Bucket=FOTOS, Key=kv[0], Body=kv[1], ContentType="image/jpeg"),
                    zip(pubs["image_key"], fotos)))
    print(f"  {len(fotos)} fotos en s3://fotos/ ({sum(map(len, fotos)) / 1e6:.1f} MB)")


def filas_snapshot(pubs, corte):
    f = pubs[(pubs["created_at"] < corte) & (pubs["label_ts"] < corte) & ~pubs["golden"]].drop(columns="golden")
    return f.assign(split=["train" if cubeta(v) < UMBRAL else "val" for v in f["seller_id"]]).sort_values("image_key").reset_index(drop=True)


def publicar(s, pubs, sid: str, corte: datetime, padre: str) -> None:
    import pandas as pd

    if tarjeta(s, sid):
        print(f"  {sid} ya está publicado")
        return
    f = filas_snapshot(pubs, corte)
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
            "split": {"by": "seller_id", "rule": f"sha256(seller_id) mod 100 < {UMBRAL} -> train"},
            "code": {"repo": "c01-versionado", "commit": "9d41c07"}, "validation": {"status": "passed"}}
    s.put_object(Bucket=DATOS, Key=f"{base}/snapshot.json", Body=json.dumps(card, ensure_ascii=False, indent=2).encode(), IfNoneMatch="*")
    print(f"  {sid}: {card['counts']}")


def congelar_golden(s, pubs, crudas) -> None:
    """El examen: las 1,000 fotos que ningún snapshot tiene, cada una con su slice. Una vez escrito, no cambia."""
    base = f"golden/{GOLDEN}"
    try:
        s.head_object(Bucket=DATOS, Key=f"{base}/manifest.json")
        print(f"  {GOLDEN} ya está congelado")
        return
    except Exception:  # noqa: BLE001
        pass
    rng = np.random.default_rng(SEMILLA + 4)
    g = pubs[pubs["golden"]].sort_values("image_key")
    slices = rng.choice(["normal", "poca_luz", "chica"], len(g), p=[0.6, 0.2, 0.2])
    fotos = []
    for i, (r, sl) in enumerate(zip(g.itertuples(), slices), 1):
        b = jpeg(crudas[r.Index], sl)
        llave = f"{base}/fotos/g-{i:04d}.jpg"
        s.put_object(Bucket=DATOS, Key=llave, Body=b, ContentType="image/jpeg", IfNoneMatch="*")
        fotos.append({"id": f"g-{i:04d}", "image_key": llave, "image_sha256": sha256(b), "label_id": int(r.label_id),
                      "slice": str(sl), "origen": r.image_key, "origen_sha256": r.image_sha256})
    man = json.dumps({"examen": GOLDEN, "congelado": "2026-07-01T00:00:00Z", "n": len(fotos),
                      "nota": "El golden set del gate. Se congeló el 1 de julio de 2026 y no cambia: si hay que corregir algo, "
                              "se publica golden-v2 en un PR propio y el gate cambia de examen en otro.",
                      "fotos": fotos}, ensure_ascii=False, indent=1).encode()
    s.put_object(Bucket=DATOS, Key=f"{base}/manifest.json", Body=man, IfNoneMatch="*")
    cuantos = {str(k): int(v) for k, v in zip(*np.unique(slices, return_counts=True))}
    print(f"  {GOLDEN}: {len(fotos)} fotos {cuantos} · manifest sha256 {sha256(man)[:12]}…")


def modelos(s, pubs, fotos) -> None:
    import mlflow
    import torch

    from mundo.equipo import anotar, entrenar, tensores
    from mundo.gateway.preprocess import preprocess

    c = mlflow_cliente()
    por_key = dict(zip(pubs["image_key"], fotos))
    cortes = {sid: corte for sid, corte, _ in SNAPSHOTS}
    hechos = {mv.version: mv for mv in c.search_model_versions(f"name = '{MODELO}'")} if c.search_registered_models(f"name = '{MODELO}'") else {}
    if not hechos:
        c.create_registered_model(MODELO, description="El clasificador de categorías del marketplace (C01).")
    pesos = {}
    for v, (mes, sid, desde, epocas, semilla) in enumerate(HISTORIA, 1):
        if str(v) in hechos:
            run = c.get_run(hechos[str(v)].run_id)
            p = mlflow.artifacts.download_artifacts(run_id=run.info.run_id, artifact_path="modelo/pesos.pt")
            pesos[v] = torch.load(p, map_location="cpu", weights_only=True)
            continue
        t0 = time.time()
        print(f"  entrenando {MODELO} v{v} ({mes}) con {sid}…")
        pesos[v], met, huella = entrenar(*tensores(por_key, filas_snapshot(pubs, cortes[sid]), preprocess), epocas, semilla,
                                         inicio=pesos.get(desde))
        nombre = f"equipo-{mes}-01"
        rid = anotar(c, nombre, {"arranque": f"v{desde}" if desde else "cero", "epocas": epocas, "semilla": semilla, "snapshot": sid},
                     met, pesos[v], huella, {"snapshot": sid, "rows_sha256": tarjeta(s, sid)["rows_sha256"]},
                     f"El modelo de {mes}. Pasó el gate de su mes y estuvo (o está) en producción.")
        mv = c.create_model_version(MODELO, source=f"runs:/{rid}/modelo", run_id=rid,
                                    tags={"mes": mes, "gate": "passed", "snapshot": sid, "pesos_sha256": huella,
                                          "labels_sha256": sha256((json.dumps(CLASES, ensure_ascii=False) + "\n").encode())})
        print(f"  {MODELO} v{mv.version} ({mes}) · val_top1 {met[-1]['val_top1']:.4f} · {time.time() - t0:.0f} s")
    c.set_registered_model_alias(MODELO, "champion", "3")
    # Los candidatos de octubre: arrancan de v3 con el snapshot de septiembre (la receta de la estación 3)
    for nombre, nota in ((CANDIDATO, "El candidato del mes: lo dejó el entrenamiento de esta noche (estación 3)."),
                         (PROVEEDOR, "El mismo mes y la misma receta, con las etiquetas del lote 2026-09-B del proveedor.")):
        if corrida_por_nombre(c, nombre):
            continue
        t0 = time.time()
        f = filas_snapshot(pubs, cortes[SNAPSHOT])
        if nombre == PROVEEDOR:   # el lote B del proveedor: 45 % de las camisas de train etiquetadas como playeras
            rng = np.random.default_rng(SEMILLA + 9)
            idx = f.index[(f["label_id"] == CAMISAS) & (f["split"] == "train")]
            f.loc[rng.choice(idx, int(len(idx) * 0.45), replace=False), "label_id"] = PLAYERAS
        print(f"  entrenando el candidato {nombre}…")
        p, met, huella = entrenar(*tensores(por_key, f, preprocess), 3, 17, inicio=pesos[3])
        anotar(c, nombre, {"arranque": "champion", "champion_version": 3, "epocas": 3, "semilla": 17, "snapshot": SNAPSHOT},
               met, p, huella, {"snapshot": SNAPSHOT, "rows_sha256": tarjeta(s, SNAPSHOT)["rows_sha256"], "champion_version": "3",
                                "commit": "7c2e91f", "arbol_limpio": "true"}, nota)
        print(f"  {nombre} · val_top1 {met[-1]['val_top1']:.4f} · {time.time() - t0:.0f} s")


def corrida() -> None:
    if CORRIDA_YAML.exists():
        return
    CORRIDA_YAML.write_text(
        "# Los parámetros de la corrida de esta noche, wf-2026-10-01. Los resolvió el orquestador UNA vez al arrancar:\n"
        "# los alias ya son números. Tu evaluar.py y tu gate.py los leen de aquí; no preguntan «¿quién es champion?».\n"
        f"candidato: {CANDIDATO}        # la corrida de MLflow que dejó la estación 3\n"
        "champion: 3                     # classifier@champion al arrancar la corrida\n"
        "hace_3_meses: 1                 # el champion de julio: la defensa contra la erosión\n"
        f"examen: {GOLDEN}               # el golden set congelado\n")


def main() -> None:
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5500: docker compose up -d --wait")
    s = s3()
    try:
        buckets(s)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"✗ el S3 local no responde en localhost:9500 ({type(e).__name__}): docker compose up -d --wait")
    ENTRADA.mkdir(exist_ok=True)
    escribir_json(ENTRADA / "categorias.json", CLASES)
    pubs, fotos, crudas = publicaciones()
    subir_fotos(s, pubs, fotos)
    for sid, corte, padre in SNAPSHOTS:
        publicar(s, pubs, sid, corte, padre)
    congelar_golden(s, pubs, crudas)
    modelos(s, pubs, fotos)
    corrida()
    print("✓ mundo listo: python verificar.py mundo")


if __name__ == "__main__":
    main()
