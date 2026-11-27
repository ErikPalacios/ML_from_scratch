"""El monitor de calidad de cada mañana: mide el índice detrás del alias tal como está en disco, sin revisar nada, con
las preguntas de test del golden set. Es lo que vería el asistente si nadie revisara el índice antes de usarlo. Solo lee.

    python mundo/evaluar.py                # el índice del alias c11, con el modelo de consulta de config.yaml
    python mundo/evaluar.py --indice X     # otro índice

recall@8 de BM25 y de los vectores por separado (como pipeline/prueba.py), y lo que dijo la última prueba guardada
de ese índice (indices/<nombre>/prueba.json), para comparar.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import CONFIG, INDICES, leer_json, vigente  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--indice")
    a = ap.parse_args()
    nombre = a.indice or vigente()
    man = leer_json(INDICES / nombre / "manifiesto.json", {})
    if not (INDICES / nombre / "vectores.npy").exists():
        sys.exit(f"✗ {nombre} no tiene vectores.npy («{man.get('estado')}»): no hay nada que medir")
    mc = yaml.safe_load(CONFIG.read_text())["servicio"]["modelo_consulta"]
    consulta = None if mc == "del-indice" else mc
    r = ref.recall(nombre, consulta=consulta)
    antes = leer_json(INDICES / nombre / "prueba.json")
    print(f"monitor · {nombre} ({man.get('modelo', {}).get('clave')}) · preguntas embebidas con {consulta or man.get('modelo', {}).get('clave')} · golden test")
    for lado in ("bm25", "vectores"):
        print(f"  {lado:<9} recall@8 hoy {r[lado]:.1%}" + (f" · cuando se construyó {antes[lado]['recall']:.1%}" if antes else ""))
