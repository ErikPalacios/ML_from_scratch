"""Mirar y reparar el registro de modelos de MLflow, con permisos de administrador. En C01: la UI de MLflow o MlflowClient.

    python mundo/modelos.py versiones               # cada versión de classifier: alias, gate, engine y sus huellas
    python mundo/modelos.py engine <versión>        # los tags del engine de una versión y los archivos en engine/
    python mundo/modelos.py alias <alias> <versión> # mueve un alias (por ejemplo: alias challenger 4)
    python mundo/modelos.py pesos <versión>         # vuelve a subir los pesos de la versión desde su checkpoint en s3://ml-ckpt
    python mundo/modelos.py reconstruir-engine <v>  # reconstruye el engine de una versión con la receta del equipo y lo
                                                    # sube solo si su huella es la de su tag engine_sha256

En C01, mover alias lo hace el pipeline de CD (estación 10), no una persona. Aquí se usa solo para diagnosticar y reparar.
"""
from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CKPT, MODELO, artefacto, huella_pesos, mlflow_arriba, mlflow_cliente, s3,  # noqa: E402
                         sha256)


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5600")
    c = mlflow_cliente()
    if a[0] == "versiones":
        aliases = c.get_registered_model(MODELO).aliases
        for mv in sorted(c.search_model_versions(f"name = '{MODELO}'"), key=lambda v: int(v.version)):
            t = mv.tags
            suyos = [k for k, v in aliases.items() if str(v) == str(mv.version)]
            eng = t.get("engine", "—")
            if t.get("engine_sha256"):
                eng += f" ({t['engine_sha256'][:12]}… · {t.get('precision', '?')} · onnxruntime {t.get('onnxruntime', '?')})"
            print(f"v{mv.version}  {' '.join('@' + s for s in suyos) or '—':<12} mes {t.get('mes', '?')} · {t.get('corrida', '?'):<17} · "
                  f"gate {t.get('gate', '—')} · pesos {t.get('pesos_sha256', '—')[:12]}… · engine {eng}")
    elif a[0] == "engine" and len(a) == 2:
        mv = c.get_model_version(MODELO, a[1])
        for k in sorted(mv.tags):
            if k not in ("mes", "snapshot", "labels_sha256", "corrida", "checkpoint"):
                print(f"  {k:<22} {mv.tags[k]}")
        try:
            arch = c.list_artifacts(mv.run_id, "engine")
        except Exception:  # noqa: BLE001
            arch = []
        for f in arch:
            b = artefacto(mv.run_id, f.path) or b""
            print(f"  {f.path:<22} {f.file_size or 0:>7} B · sha256 {sha256(b)[:12]}…")
        if not arch:
            print("  (sin archivos en engine/)")
    elif a[0] == "alias" and len(a) == 3:
        c.set_registered_model_alias(MODELO, a[1], a[2])
        print(f"{MODELO}@{a[1]} → v{a[2]}")
    elif a[0] == "pesos" and len(a) == 2:
        import torch

        mv = c.get_model_version(MODELO, a[1])
        llave = mv.tags["checkpoint"].removeprefix(f"s3://{CKPT}/")
        b = s3().get_object(Bucket=CKPT, Key=llave)["Body"].read()
        huella = huella_pesos(torch.load(io.BytesIO(b), map_location="cpu", weights_only=True))
        if huella != mv.tags["pesos_sha256"]:
            sys.exit(f"✗ el checkpoint {mv.tags['checkpoint']} tiene huella {huella[:12]}…, no la de v{a[1]}: no lo subo")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "pesos.pt").write_bytes(b)
            c.log_artifact(mv.run_id, str(Path(d) / "pesos.pt"), "modelo")
        print(f"v{a[1]}: modelo/pesos.pt = {mv.tags['checkpoint']} (huella {huella[:12]}… = su tag pesos_sha256)")
    elif a[0] == "reconstruir-engine" and len(a) == 2:
        import torch

        from mundo.equipo import construir_engine

        mv = c.get_model_version(MODELO, a[1])
        esperada = mv.tags.get("engine_sha256")
        if not esperada:
            sys.exit(f"✗ v{a[1]} no tiene engine_sha256: nunca tuvo un engine registrado")
        pesos = torch.load(io.BytesIO(artefacto(mv.run_id, "modelo/pesos.pt")), map_location="cpu", weights_only=True)
        with tempfile.TemporaryDirectory() as d:
            info = construir_engine(pesos, Path(d))
            if info["engine_sha256"] != esperada:
                sys.exit(f"✗ el engine reconstruido tiene huella {info['engine_sha256'][:12]}… y v{a[1]} dice {esperada[:12]}…: "
                         "otra máquina u otras versiones. No lo subo")
            for f in ("model.onnx", "engine.onnx"):
                c.log_artifact(mv.run_id, str(Path(d) / f), "engine")
        print(f"v{a[1]}: engine reconstruido con la receta del equipo · huella {esperada[:12]}… = su tag engine_sha256 · subido a engine/")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
