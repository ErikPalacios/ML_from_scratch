"""El mundo: el marketplace de C01 en pequeño, seis meses después de la estación 1, a principios de octubre de 2026.

    python mundo/crear.py        # ≈ 20 s; lo borra y lo vuelve a crear igual (semilla fija)

Qué deja (lo que en C01 real existe antes de esta estación):
  s3://fotos/AAAA/MM/DD/p-NNNNNN.jpg      la foto de cada publicación (abril a septiembre), bucket del producto
  entrada/publicaciones.parquet            una fila por publicación: quién vende, cuándo, la llave y el sha256 de su foto
  entrada/labels-eventos.parquet           los labels como eventos: quien vende, moderación y etiquetado humano
  entrada/golden.parquet                   las huellas del golden set congelado en la estación 1
  entrada/borrados.csv                     el registro de borrados: huellas de fotos que alguien pidió borrar
  entrada/categorias.json                  las 10 categorías válidas
  s3://ml-datos/datasets/ds-2026-08-01/    el snapshot de agosto, publicado por el equipo (el padre del tuyo)
  corridas/run-20260901-061500.json        la corrida del modelo de septiembre, que entrenó con ds-2026-08-01

El bucket ml-datos guarda versiones. romper.py usa este script para dejar el mundo como recién creado.
"""
from __future__ import annotations

import io
import json
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CLASES, CORRIDAS, DATOS, ENTRADA, FOTOS, PADRE, borrar_todo, cubeta, ref_filas,  # noqa: E402
                         ref_labels, s3, sha256)
from mundo.modelo import entrenar  # noqa: E402

SEMILLA = 2026
INICIO = datetime(2026, 4, 1, tzinfo=timezone.utc)
MESES = 6                     # abril a septiembre
POR_MES = 520
VENDEDORES = 300
CORTE_PADRE = datetime(2026, 9, 1, tzinfo=timezone.utc)
BORRA = "s-217"               # pidió borrar sus datos el 14 de septiembre
FECHA_BORRADO = "2026-09-15T10:00:00Z"
COLORES = [(214, 64, 64), (52, 101, 164), (115, 210, 22), (237, 212, 0), (117, 80, 123),
           (245, 121, 0), (78, 154, 6), (193, 125, 17), (32, 74, 135), (85, 87, 83)]


def foto(rng: np.random.Generator, clase: int) -> bytes:
    """Una foto de 64×64 de juguete: el color y la forma dependen de la categoría; el resto es ruido."""
    base = np.array(COLORES[clase]) + rng.integers(-40, 41, 3)
    fondo = np.clip(rng.normal(200, 25, (64, 64, 3)), 0, 255)
    im = Image.fromarray(fondo.astype(np.uint8))
    d = ImageDraw.Draw(im)
    x, y = rng.integers(4, 20, 2)
    w, h = rng.integers(28, 44, 2)
    caja = [int(x), int(y), int(x + w), int(y + h)]
    color = tuple(int(c) for c in np.clip(base, 0, 255))
    (d.ellipse if clase % 2 else d.rectangle)(caja, fill=color)
    if clase >= 5:
        d.line([caja[0], caja[3], caja[2], caja[1]], fill=(30, 30, 30), width=3)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def generar():
    rng = np.random.default_rng(SEMILLA)
    vendedores = [f"s-{i:03d}" for i in range(1, VENDEDORES + 1)]
    gusto = {s: rng.choice(10, 3, replace=False) for s in vendedores}       # cada quien vende de 3 categorías
    golden_bytes = [foto(rng, int(c)) for c in rng.integers(0, 10, 280)]   # el golden set de la estación 1
    golden_clase = [None] * 280
    pubs, blobs, verdad, por_vendedor = [], {}, {}, {s: [] for s in vendedores}
    n = 0
    for mes in range(MESES):
        ini = INICIO.replace(month=4 + mes)
        fin = ini.replace(month=ini.month + 1) if ini.month < 12 else ini.replace(year=ini.year + 1, month=1)
        segundos = int((fin - ini).total_seconds())
        for t in sorted(rng.integers(0, segundos, POR_MES)):
            n += 1
            s = vendedores[int(rng.integers(0, VENDEDORES))]
            creado = ini + timedelta(seconds=int(t))
            u = rng.random()
            if u < 0.04 and por_vendedor[s]:                        # la misma foto en otra publicación
                b, clase = por_vendedor[s][int(rng.integers(0, len(por_vendedor[s])))]
            elif u < 0.045 and n > 50:                               # una foto de catálogo que usan dos vendedores
                otra = pubs[int(rng.integers(0, len(pubs)))]
                b, clase = blobs[otra["image_key"]], verdad[otra["image_key"]]
            elif 1 <= mes <= 3 and u < 0.058:                        # alguien vuelve a subir una foto del golden set
                i = int(rng.integers(0, 280))
                b = golden_bytes[i]
                clase = golden_clase[i] if golden_clase[i] is not None else int(rng.choice(gusto[s]))
                golden_clase[i] = clase
            else:
                clase = int(rng.choice(gusto[s]))
                b = foto(rng, clase)
            key = f"{creado:%Y/%m/%d}/p-{n:06d}.jpg"
            blobs[key], verdad[key] = b, clase
            por_vendedor[s].append((b, clase))
            pubs.append({"listing_id": f"p-{n:06d}", "seller_id": s, "created_at": creado, "image_key": key,
                         "image_sha256": sha256(b), "bytes": len(b), "width": 64, "height": 64})
    pubs = pd.DataFrame(pubs)
    pubs["created_at"] = pd.to_datetime(pubs["created_at"], utc=True)

    ev = []
    for p in pubs.itertuples():
        real = verdad[p.image_key]
        elige = real if rng.random() < 0.86 else int(rng.integers(0, 10))
        ev.append((p.image_key, elige, "vendedor", None, p.created_at + timedelta(minutes=2)))
        if rng.random() < 0.07:                                          # moderación corrige días después
            ev.append((p.image_key, real, "moderador", None, p.created_at + timedelta(days=float(rng.uniform(1, 45)))))
        if rng.random() < 0.17:                                          # la cola de etiquetado del mes siguiente
            d = (p.created_at.replace(day=1) + timedelta(days=32)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            ts = d + timedelta(days=float(rng.uniform(2, 9)))
            ev.append((p.image_key, real if rng.random() < 0.97 else int(rng.integers(0, 10)), "humano",
                       "guia-v2" if ts >= CORTE_PADRE else "guia-v1", ts))
    ev = pd.DataFrame(ev, columns=["image_key", "label_id", "label_source", "guia_version", "ts"])
    ev["ts"] = pd.to_datetime(ev["ts"], utc=True)
    ev = ev.sort_values(["ts", "image_key"]).reset_index(drop=True)
    ev.insert(0, "event_id", [f"e-{i:06d}" for i in range(1, len(ev) + 1)])
    ev["label_id"] = ev["label_id"].astype("int64")
    golden = pd.DataFrame({"image_sha256": sorted({sha256(b) for b in golden_bytes}), "golden_version": "golden-v1"})
    borr = pubs[pubs["seller_id"] == BORRA].drop_duplicates("image_sha256")
    borrados = pd.DataFrame({"image_sha256": borr["image_sha256"], "fecha": FECHA_BORRADO,
                             "motivo": "derecho al borrado (solicitud del 2026-09-14)"})
    return pubs, blobs, ev, golden, borrados


def publicar_padre(s, filas: pd.DataFrame, labels_fuente: dict) -> dict:
    rows = io.BytesIO()
    filas.to_parquet(rows, index=False)
    rows = rows.getvalue()
    val = {"snapshot_id": PADRE, "status": "passed", "checks": {"categorias": "ok", "duplicados": "ok", "golden": "ok",
           "split_vendedor": "ok", "volumen": "primer snapshot en este bucket", "vendedor": "ok"}}
    tarjeta = {
        "snapshot_id": PADRE, "parent": None, "corte": "2026-09-01T00:00:00Z", "created_at": "2026-09-01T03:12:44Z",
        "rows_path": f"s3://{DATOS}/datasets/{PADRE}/rows.parquet", "rows_sha256": sha256(rows),
        "counts": {"train": int((filas["split"] == "train").sum()), "val": int((filas["split"] == "val").sum()), "total": len(filas)},
        "label_sources": labels_fuente,
        "split": {"by": "seller_id", "rule": "sha256(seller_id) mod 100 < 90 -> train"},
        "code": {"repo": "ml-catalogo", "commit": "4be1d0a"},
        "validation": {"status": "passed", "report": f"s3://{DATOS}/datasets/{PADRE}/validation.json"},
    }
    for nombre, cuerpo in (("rows.parquet", rows), ("validation.json", json.dumps(val, indent=2).encode()),
                           ("snapshot.json", json.dumps(tarjeta, indent=2, ensure_ascii=False).encode())):
        s.put_object(Bucket=DATOS, Key=f"datasets/{PADRE}/{nombre}", Body=cuerpo, IfNoneMatch="*")
    return tarjeta


def main() -> None:
    s = s3()
    for b in (FOTOS, DATOS):
        try:
            s.head_bucket(Bucket=b)
            borrar_todo(s, b, "")
        except Exception:  # noqa: BLE001 — no existía
            s.create_bucket(Bucket=b)
    s.put_bucket_versioning(Bucket=DATOS, VersioningConfiguration={"Status": "Enabled"})
    print("  buckets: fotos (el producto) y ml-datos (con versiones)")

    pubs, blobs, ev, golden, borrados = generar()
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda kv: s.put_object(Bucket=FOTOS, Key=kv[0], Body=kv[1], ContentType="image/jpeg"), blobs.items()))
    print(f"  s3://fotos: {len(blobs)} fotos, {sum(map(len, blobs.values())) / 1e6:.1f} MB")

    shutil.rmtree(ENTRADA, ignore_errors=True)
    ENTRADA.mkdir()
    pubs.to_parquet(ENTRADA / "publicaciones.parquet", index=False)
    ev.to_parquet(ENTRADA / "labels-eventos.parquet", index=False)
    golden.to_parquet(ENTRADA / "golden.parquet", index=False)
    (ENTRADA / "categorias.json").write_text(json.dumps({str(i): c for i, c in enumerate(CLASES)}, ensure_ascii=False, indent=2) + "\n")
    print(f"  entrada/: {len(pubs)} publicaciones, {len(ev)} eventos de labels, golden de {len(golden)} huellas")

    # el snapshot de agosto, como lo armó el equipo el 1 de septiembre (antes del borrado)
    bd = borrados.assign(fecha=pd.to_datetime(borrados["fecha"], utc=True))
    labels = ref_labels(ev, CORTE_PADRE, 30)
    filas = ref_filas(labels, pubs, golden, bd, CORTE_PADRE, 90)
    fuentes = {k: round(float(v), 3) for k, v in filas["label_source"].value_counts(normalize=True).sort_index().items()}
    tarjeta = publicar_padre(s, filas, fuentes)
    print(f"  s3://ml-datos/datasets/{PADRE}/: {len(filas)} filas ({tarjeta['counts']['train']} train · {tarjeta['counts']['val']} val)")

    # el 15 de septiembre el producto borró las fotos de quien pidió borrar, y lo anotó en el registro
    for k in pubs.loc[pubs["seller_id"] == BORRA, "image_key"]:
        s.delete_object(Bucket=FOTOS, Key=k)
    borrados.to_csv(ENTRADA / "borrados.csv", index=False)
    print(f"  entrada/borrados.csv: {len(borrados)} huellas de {BORRA} (fotos borradas del bucket el 15 de septiembre)")

    # la corrida del modelo de septiembre, que entrenó con el snapshot de agosto
    tr = [(blobs[k], int(l)) for k, l, sp in filas[["image_key", "label_id", "split"]].itertuples(index=False) if sp == "train"]
    va = [(blobs[k], int(l)) for k, l, sp in filas[["image_key", "label_id", "split"]].itertuples(index=False) if sp == "val"]
    shutil.rmtree(CORRIDAS, ignore_errors=True)
    corrida = {"run_id": "run-20260901-061500", "modelo": "modelo-2026-09-01", "fecha": "2026-09-01T06:15:00+00:00",
               "snapshot": PADRE, "rows_sha256": tarjeta["rows_sha256"],
               "commit": "c3f2fc2", "repo": "ml-catalogo", "arbol_limpio": True,
               "entorno_sha256": sha256(b"imagen de entrenamiento del equipo, agosto 2026"), "semilla": 17,
               "metricas": entrenar(tr, va, 17), "filas": {"train": len(tr), "val": len(va), "omitidas_borradas": 0}}
    CORRIDAS.mkdir()
    (CORRIDAS / f"{corrida['run_id']}.json").write_text(json.dumps(corrida, ensure_ascii=False, indent=2) + "\n")
    print(f"  corridas/{corrida['run_id']}.json: modelo-2026-09-01 ← {PADRE} (accuracy_val {corrida['metricas']['accuracy_val']})")
    print("✓ mundo listo")


if __name__ == "__main__":
    main()
