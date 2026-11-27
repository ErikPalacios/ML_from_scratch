"""Arma kits/rag-indice/mundo/entrada/ a partir de una corrida real de la estación 4 (su probar.sh hasta el paso 8, sin
el reinicio final de la ronda Construir solo, que borra golden/):

    n=$(wc -l < ../rag-golden-solucion/probar.sh); head -n $((n-3)) ../rag-golden-solucion/probar.sh > /tmp/p4.sh
    bash /tmp/p4.sh /ruta/r4 && python3 hacer_entrada.py /ruta/r4

Escribe:
- corpus/corpus-2026-11-22.json: el corpus después de la re-ingesta del 22 (151 chunks de 104 documentos, cada uno con
  su texto, que empieza con la ruta de títulos, y su ACL en grupos).
- directorio.json: el directorio de la empresa de las 10:30 del 21 (el que usó la estación 4).
- registro-golden/VIGENTE y registro-golden/golden-v2/{preguntas.jsonl, manifiesto.json}: el golden set vigente, reanclado al corpus del 22.
"""
import json
import shutil
import sys
from pathlib import Path

R4 = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 hacer_entrada.py <carpeta de la estación 4>")
SAL = Path(__file__).resolve().parent.parent / "rag-indice" / "mundo" / "entrada"
c = json.loads((R4 / "almacen" / "corpus" / "vigente.json").read_text())
assert c["version"] == "corpus-2026-11-22" and len(c["chunks"]) == 151, (c["version"], len(c["chunks"]))
v = (R4 / "golden" / "VIGENTE").read_text().strip()
assert v == "golden-v2", v
man = json.loads((R4 / "golden" / v / "manifiesto.json").read_text())
assert man["corpus"] == c["version"]
shutil.rmtree(SAL, ignore_errors=True)
(SAL / "corpus").mkdir(parents=True)
(SAL / "corpus" / "corpus-2026-11-22.json").write_text(json.dumps(c, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
shutil.copy(R4 / "almacen" / "directorio.json", SAL / "directorio.json")
(SAL / "registro-golden" / v).mkdir(parents=True)
for f in ("preguntas.jsonl", "manifiesto.json"):
    shutil.copy(R4 / "golden" / v / f, SAL / "registro-golden" / v / f)
(SAL / "registro-golden" / "VIGENTE").write_text(v + "\n")
n = sum(1 for _ in open(SAL / "registro-golden" / v / "preguntas.jsonl"))
print(f"✓ {SAL}: {c['version']} ({len(c['chunks'])} chunks), directorio, {v} ({n} preguntas, sha256 {man['sha256'][:12]})")
