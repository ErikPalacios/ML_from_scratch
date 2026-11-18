"""Mirar y reparar el registro de modelos de MLflow, con permisos de administrador. En C01: la UI de MLflow o MlflowClient.

    python mundo/modelos.py versiones               # cada versión de classifier: alias, gate, engine y sus huellas
    python mundo/modelos.py engine <versión>        # los tags del engine de una versión y los archivos en engine/
    python mundo/modelos.py alias <alias> <versión> # mueve un alias (por ejemplo: alias challenger 4)
    python mundo/modelos.py labels <versión>        # el labels.json de la versión: su huella contra su tag labels_sha256
    python mundo/modelos.py reparar-labels <v>      # vuelve a subir el labels.json de la versión desde la lista del equipo
                                                    # (solo si su huella es la de su tag labels_sha256)

En C01, mover alias lo hace el pipeline de CD (estación 10), no una persona. Aquí se usa solo para diagnosticar y reparar.
"""
from __future__ import annotations

import io
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, MODELO, artefacto, labels_sha, mlflow_arriba, mlflow_cliente, sha256  # noqa: E402


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5700")
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
    elif a[0] == "labels" and len(a) == 2:
        mv = c.get_model_version(MODELO, a[1])
        b = artefacto(mv.run_id, "modelo/labels.json")
        if b is None:
            sys.exit(f"✗ v{a[1]} no tiene modelo/labels.json en su corrida")
        print(f"  modelo/labels.json  {b.decode().strip()}")
        print(f"  sha256 {sha256(b)[:12]}… · tag labels_sha256 {mv.tags.get('labels_sha256', '—')[:12]}… · "
              f"{'coinciden' if sha256(b) == mv.tags.get('labels_sha256') else 'NO COINCIDEN'}")
    elif a[0] == "reparar-labels" and len(a) == 2:
        import json
        import tempfile

        mv = c.get_model_version(MODELO, a[1])
        if labels_sha(CLASES) != mv.tags.get("labels_sha256"):
            sys.exit(f"✗ la lista del equipo no tiene la huella del tag de v{a[1]}: no la subo")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "labels.json").write_text(json.dumps(CLASES, ensure_ascii=False) + "\n")
            c.log_artifact(mv.run_id, str(Path(d) / "labels.json"), "modelo")
        print(f"v{a[1]}: modelo/labels.json = la lista del equipo (huella {labels_sha(CLASES)[:12]}… = su tag labels_sha256)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
