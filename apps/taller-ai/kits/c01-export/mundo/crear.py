"""Crea el mundo de la estación 5: el marketplace de C01 el 1 de octubre de 2026, a las 07:00 UTC. El gate aprobó al
candidato de octubre y lo dejó en el registro como classifier v4 @challenger. Falta fabricar lo que se va a servir.
Tarda ≈ 4 minutos (casi todo es entrenar los modelos del equipo).

    python mundo/crear.py

1. Baja las 10,000 fotos de prueba de Fashion-MNIST (≈ 4.4 MB, una sola vez, a data/fmnist/).
2. Congela el examen del gate: s3://ml-datos/golden/golden-v1/ (1,000 fotos con su slice) y su manifest.json, el mismo
   de la estación 4 (su huella está en engine.yaml).
3. Publica el set de calibración s3://ml-datos/calibracion/cal-2026-09/: 256 fotos de train de septiembre (solo lo usa
   un engine int8; nunca es el examen).
4. Entrena el historial del registro, con la receta de la estación 3: classifier v1 (julio), v2 (agosto), v3
   (septiembre, @champion) y el candidato de octubre, que el gate aprobó: v4 (@challenger). Los pesos de cada uno
   quedan también en s3://ml-ckpt/ (el bucket de checkpoints, con versionado).
5. Construye el engine del champion (v3), el que hoy sirve producción, y lo deja en MLflow con sus huellas.
6. Escribe corrida.yaml: los parámetros de la corrida de esta noche, ya resueltos por el orquestador.

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
from mundo.comun import (CALIBRACION, CANDIDATO, CKPT, CLASES, CORRIDA_YAML, DATA, DATOS, ENTRADA, GOLDEN,  # noqa: E402
                         MODELO, escribir_json, mlflow_arriba, mlflow_cliente, pesos_de, s3, sha256)

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
N_CALIBRACION = 256
FUENTES = ["humano", "moderador", "vendedor"]

# Los cortes de los snapshots y el historial del registro: (mes, snapshot, arranca de, épocas, semilla)
CORTES = {"ds-2026-06-01": datetime(2026, 7, 1, tzinfo=timezone.utc), "ds-2026-07-01": datetime(2026, 8, 1, tzinfo=timezone.utc),
          "ds-2026-08-01": datetime(2026, 9, 1, tzinfo=timezone.utc), "ds-2026-09-01": datetime(2026, 10, 1, tzinfo=timezone.utc)}
HISTORIA = [("2026-07", "ds-2026-06-01", None, 4, 7), ("2026-08", "ds-2026-07-01", 1, 3, 8),
            ("2026-09", "ds-2026-08-01", 2, 3, 9), ("2026-10", "ds-2026-09-01", 3, 3, 17)]


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
    """Las mismas publicaciones de las estaciones 2 a 4 (misma semilla): fotos, vendedor, etiqueta y fechas."""
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
        "label_ts": [c + timedelta(days=int(d)) for c, d in zip(creada, rng.integers(1, 20, n))],
        "created_at": creada})
    golden = set(pubs.sample(N_GOLDEN, random_state=SEMILLA)["image_key"])
    pubs["golden"] = pubs["image_key"].isin(golden)
    return pubs, fotos, X[orden]


def filas_snapshot(pubs, corte):
    f = pubs[(pubs["created_at"] < corte) & (pubs["label_ts"] < corte) & ~pubs["golden"]].drop(columns="golden")
    return f.assign(split=["train" if cubeta(v) < UMBRAL else "val" for v in f["seller_id"]]).sort_values("image_key").reset_index(drop=True)


def buckets(s) -> None:
    hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    for b in (DATOS, CKPT):
        if b not in hay:
            s.create_bucket(Bucket=b)
        s.put_bucket_versioning(Bucket=b, VersioningConfiguration={"Status": "Enabled"})


def existe(s, llave: str, bucket: str = DATOS) -> bool:
    try:
        s.head_object(Bucket=bucket, Key=llave)
        return True
    except Exception:  # noqa: BLE001
        return False


def congelar_golden(s, pubs, crudas) -> None:
    """El examen: las 1,000 fotos que ningún snapshot tiene, cada una con su slice. Es el mismo de la estación 4."""
    base = f"golden/{GOLDEN}"
    if existe(s, f"{base}/manifest.json"):
        print(f"  {GOLDEN} ya está congelado")
        return
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
    print(f"  {GOLDEN}: {len(fotos)} fotos · manifest sha256 {sha256(man)[:12]}…")


def calibracion(s, pubs, fotos) -> None:
    """256 fotos de train de septiembre para calibrar un engine int8. Del examen, ninguna."""
    base = f"calibracion/{CALIBRACION}"
    if existe(s, f"{base}/manifest.json"):
        print(f"  {CALIBRACION} ya está publicado")
        return
    f = filas_snapshot(pubs, CORTES["ds-2026-09-01"])
    f = f[f["split"] == "train"].sample(N_CALIBRACION, random_state=SEMILLA + 5).sort_values("image_key")
    por_key = dict(zip(pubs["image_key"], fotos))
    items = []
    for i, r in enumerate(f.itertuples(), 1):
        llave = f"{base}/fotos/c-{i:04d}.jpg"
        s.put_object(Bucket=DATOS, Key=llave, Body=por_key[r.image_key], ContentType="image/jpeg", IfNoneMatch="*")
        items.append({"id": f"c-{i:04d}", "image_key": llave, "image_sha256": r.image_sha256, "origen": r.image_key})
    man = json.dumps({"set": CALIBRACION, "snapshot": "ds-2026-09-01", "split": "train", "n": len(items),
                      "nota": "Fotos de train para calibrar los rangos de un engine int8. Nunca del golden set: calibrar con el "
                              "examen es otra forma de verle las respuestas.", "fotos": items}, ensure_ascii=False, indent=1).encode()
    s.put_object(Bucket=DATOS, Key=f"{base}/manifest.json", Body=man, IfNoneMatch="*")
    print(f"  {CALIBRACION}: {len(items)} fotos de train de ds-2026-09-01")


def modelos(s, pubs, fotos) -> None:
    import torch

    from mundo.equipo import anotar, construir_engine, entrenar, tensores
    from mundo.gateway.preprocess import preprocess

    c = mlflow_cliente()
    por_key = dict(zip(pubs["image_key"], fotos))
    hechos = {mv.version: mv for mv in c.search_model_versions(f"name = '{MODELO}'")} if c.search_registered_models(f"name = '{MODELO}'") else {}
    if not hechos:
        c.create_registered_model(MODELO, description="El clasificador de categorías del marketplace (C01).")
    labels_sha = sha256((json.dumps(CLASES, ensure_ascii=False) + "\n").encode())
    pesos = {}
    for v, (mes, sid, desde, epocas, semilla) in enumerate(HISTORIA, 1):
        nombre = CANDIDATO if v == 4 else f"equipo-{mes}-01"
        if str(v) in hechos:
            pesos[v] = pesos_de(hechos[str(v)].run_id)
            continue
        t0 = time.time()
        print(f"  entrenando {MODELO} v{v} ({mes}) con {sid}…")
        filas = filas_snapshot(pubs, CORTES[sid])
        pesos[v], met, huella = entrenar(*tensores(por_key, filas, preprocess), epocas, semilla, inicio=pesos.get(desde))
        nota = ("El candidato de octubre: lo entrenó la estación 3 y lo aprobó el gate de la estación 4." if v == 4 else
                f"El modelo de {mes}. Pasó el gate de su mes y estuvo (o está) en producción.")
        rid = anotar(c, nombre, {"arranque": f"v{desde}" if desde else "cero", "epocas": epocas, "semilla": semilla, "snapshot": sid},
                     met, pesos[v], huella, {"snapshot": sid, **({"champion_version": "3", "commit": "7c2e91f"} if v == 4 else {})}, nota)
        with tempfile.TemporaryDirectory() as d:          # el checkpoint final, también en el bucket de checkpoints
            torch.save(pesos[v], Path(d) / "pesos.pt")
            s.put_object(Bucket=CKPT, Key=f"c01/{nombre}/final.pt", Body=(Path(d) / "pesos.pt").read_bytes(),
                         Metadata={"pesos-sha256": huella})
        tags = {"mes": mes, "gate": "passed", "snapshot": sid, "pesos_sha256": huella, "labels_sha256": labels_sha,
                "corrida": nombre, "checkpoint": f"s3://{CKPT}/c01/{nombre}/final.pt"}
        if v == 4:
            tags.update({"gate_run_id": "wf-2026-10-01-gate", "examen": GOLDEN, "champion_version": "3", "engine": "pendiente"})
        else:
            tags["engine"] = "listo" if v == 3 else "retirado"
        mv = c.create_model_version(MODELO, source=f"runs:/{rid}/modelo", run_id=rid, tags=tags)
        print(f"  {MODELO} v{mv.version} ({mes}) · val_top1 {met[-1]['val_top1']:.4f} · {time.time() - t0:.0f} s")
    c.set_registered_model_alias(MODELO, "champion", "3")
    c.set_registered_model_alias(MODELO, "challenger", "4")
    # El engine del champion: lo construyó el equipo en septiembre con la misma receta. Es la referencia de la latencia.
    v3 = c.get_model_version(MODELO, "3")
    if "engine_sha256" not in v3.tags:
        with tempfile.TemporaryDirectory() as d:
            info = construir_engine(pesos[3], Path(d))
            c.log_artifacts(v3.run_id, d, "engine")
        for k in ("engine_sha256", "onnx_sha256", "onnxruntime", "maquina", "precision", "opset"):
            c.set_model_version_tag(MODELO, "3", k, str(info[k]))
        print(f"  engine del champion (v3): engine.onnx {info['engine_sha256'][:12]}… · onnxruntime {info['onnxruntime']}")


def corrida() -> None:
    if CORRIDA_YAML.exists():
        return
    CORRIDA_YAML.write_text(
        "# Los parámetros de la corrida de esta noche, wf-2026-10-01. Los resolvió el orquestador UNA vez al arrancar:\n"
        "# los alias ya son números. Tus pasos los leen de aquí; no preguntan «¿quién es challenger?».\n"
        "challenger: 4                   # classifier@challenger al arrancar: el candidato que aprobó el gate\n"
        "champion: 3                     # classifier@champion: el que sirve hoy (su engine es la referencia de latencia)\n"
        f"examen: {GOLDEN}               # el golden set congelado\n")


def main() -> None:
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5600: docker compose up -d --wait")
    s = s3()
    try:
        buckets(s)
    except Exception as e:  # noqa: BLE001
        sys.exit(f"✗ el S3 local no responde en localhost:9600 ({type(e).__name__}): docker compose up -d --wait")
    ENTRADA.mkdir(exist_ok=True)
    escribir_json(ENTRADA / "categorias.json", CLASES)
    pubs, fotos, crudas = publicaciones()
    congelar_golden(s, pubs, crudas)
    calibracion(s, pubs, fotos)
    modelos(s, pubs, fotos)
    corrida()
    print("✓ mundo listo: python verificar.py mundo")


if __name__ == "__main__":
    main()
