#!/usr/bin/env bash
# Corre las dos prácticas de punta a punta en una carpeta limpia, como las haría una persona,
# con el etiquetado por la API en lugar de clics. Deja cada salida en <carpeta>/salidas.log.
# Uso: bash probar.sh <carpeta-vacía> <venv-con-requirements>
set -euo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; VENV="$2"
rm -rf "$D"; mkdir -p "$D"; cd "$D"
LOG="$D.log"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1 || echo "[código $?]"; } | tee -a "$LOG"; echo >> "$LOG"; }
g() { git -c user.name="Prueba" -c user.email="prueba@ejemplo.com" "$@"; }

# --- Práctica 1 · Antes de producción ---
git init -q -b main
cp "$SOL/compose.yaml" "$SOL/requirements.txt" .
printf '.venv\n__pycache__/\nprod/\nmodelos/*.joblib\n' > .gitignore
ln -s "$VENV" .venv
source .venv/bin/activate
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d >/dev/null 2>&1
for i in $(seq 60); do curl -sf localhost:8091/health >/dev/null && break; sleep 2; done
paso "a1 compose ps" docker compose ps --format '{{.Service}}  {{.Status}}  {{.Ports}}'
mkdir -p scripts guia mundo data/etiquetado
cp "$SOL"/scripts/recolectar.py scripts/
paso "a2 recolectar" python scripts/recolectar.py
paso "a2 sha" sh -c 'shasum -a 256 data/crudo/foto_01.png data/crudo/foto_02.png'
cp "$SOL"/guia/guia-v1.md "$SOL"/guia/interfaz-v1.xml guia/
python "$SOL/_etiquetar_api.py" c01-v1 guia/interfaz-v1.xml data/crudo/*.png > /dev/null
paso "a4 export" sh -c 'curl -s "http://localhost:8091/api/projects/1/export?exportType=JSON_MIN" -H "Authorization: Token practica-token-local-0001" -o data/etiquetado/export-v1.json && python -m json.tool data/etiquetado/export-v1.json | head -11'
cp "$SOL"/scripts/etiquetas.py scripts/
paso "a5 etiquetas" python scripts/etiquetas.py data/etiquetado/export-v1.json v1 inicial
paso "a5 labels" sh -c 'cut -d, -f2- data/labels.csv | head -4'
echo '{"clases": ["playera", "tenis"], "cupo": {"train": 3, "val": 1, "test": 1}}' > config.json
cp "$SOL"/scripts/dividir.py scripts/
paso "a6 dividir" python scripts/dividir.py
cp "$SOL"/scripts/validar.py scripts/
paso "a7 validar" python scripts/validar.py
cp "$SOL"/DATASET-v1.md DATASET.md
paso "a9 bucket" python -c "
import boto3
s3 = boto3.client('s3', endpoint_url='http://localhost:9200', aws_access_key_id='practica', aws_secret_access_key='practica-secreto', region_name='us-east-1')
s3.create_bucket(Bucket='datasets')
print([b['Name'] for b in s3.list_buckets()['Buckets']])"
paso "a9 dvc init" sh -c 'dvc init -q && dvc remote add -d s3 s3://datasets/c01 && dvc remote modify s3 endpointurl http://localhost:9200 && dvc remote modify --local s3 access_key_id practica && dvc remote modify --local s3 secret_access_key practica-secreto && cat .dvc/config'
paso "a9 dvc add" sh -c 'dvc add data/crudo && cat data/crudo.dvc'
paso "a9 commit" sh -c 'git add -A && git status --short'
g commit -qm "dataset v1: 10 fotos, playera/tenis, guía v1"
g tag -a dataset-v1 -m "10 fotos · 2 clases · 6/2/2"
paso "a9 push" dvc push
paso "a9 log" git log --oneline --decorate
paso "a10 borrar" sh -c 'rm -rf data/crudo .dvc/cache && ls data'
paso "a10 pull" dvc pull
paso "a10 validar" sh -c 'dvc status && python scripts/validar.py | tail -1'
cp "$SOL"/scripts/comun.py "$SOL"/scripts/entrenar.py scripts/
paso "a11 entrenar" python scripts/entrenar.py modelo-v1 dataset-v1
g add -A && g commit -qm "modelo-v1 entrenado con dataset-v1"

# --- Práctica 2 · En producción ---
cp "$SOL"/mundo/llegan.py "$SOL"/mundo/cuantas_bolsas.py mundo/
paso "b0 cuantas" python mundo/cuantas_bolsas.py
paso "b1 llegan" sh -c 'python mundo/llegan.py && head -3 prod/publicaciones.jsonl'
cp "$SOL"/scripts/predecir.py scripts/
paso "b2 predecir" python scripts/predecir.py modelo-v1
python - <<'PY'
import json; c = json.load(open("config.json")); c["seleccion"] = {"presupuesto": 8, "umbral": 0.8, "azar": 1}
open("config.json", "w").write(json.dumps(c, ensure_ascii=False) + "\n")
PY
cp "$SOL"/scripts/seleccionar.py scripts/
paso "b3 seleccionar" python scripts/seleccionar.py
paso "b3 validar" python scripts/validar.py
cp "$SOL"/guia/guia-v2.md "$SOL"/guia/interfaz-v2.xml guia/
paso "b4 diff" sh -c 'diff guia/interfaz-v1.xml guia/interfaz-v2.xml'
python "$SOL/_etiquetar_api.py" c01-v2 guia/interfaz-v2.xml $(tail -n +2 prod/cola.csv | cut -d, -f2 | sed 's#^#data/crudo/#') > /dev/null
paso "b5 export" sh -c 'curl -s "http://localhost:8091/api/projects/2/export?exportType=JSON_MIN" -H "Authorization: Token practica-token-local-0001" -o data/etiquetado/export-v2.json && python -c "import json; [print(t[\"image\"], t[\"clase\"]) for t in json.load(open(\"data/etiquetado/export-v2.json\"))]"'
python - <<'PY'
import json; c = json.load(open("config.json")); c["clases"].append("bolsa")
open("config.json", "w").write(json.dumps(c, ensure_ascii=False) + "\n")
PY
paso "b6 etiquetas" python scripts/etiquetas.py data/etiquetado/export-v2.json v2 2026-11
paso "b6 dividir" python scripts/dividir.py
paso "b6 validar" python scripts/validar.py
cp "$SOL"/DATASET-v2.md DATASET.md
paso "b7 dvc add" sh -c 'dvc add data/crudo -q && git add -A && git status --short'
g commit -qm "dataset v2: +8 fotos de noviembre, clase bolsa, guía v2"
g tag -a dataset-v2 -m "18 fotos · 3 clases"
paso "b7 push" dvc push
paso "b7 dvc diff" dvc diff dataset-v1 dataset-v2
paso "b7 git diff" sh -c 'git diff --stat dataset-v1 dataset-v2 -- data guia config.json DATASET.md'
paso "b7 test quieto" sh -c 'git diff dataset-v1 dataset-v2 -- data/splits.csv | grep -c "^-[0-9a-f]" || true'
cp "$SOL"/scripts/evaluar.py scripts/
g add -A && g commit -qm "scripts para evaluar"
paso "b8 entrenar" python scripts/entrenar.py modelo-v2 dataset-v2
paso "b8 evaluar" python scripts/evaluar.py dataset-v2 modelo-v1 modelo-v2
g add -A && g commit -qm "modelo-v2 entrenado con dataset-v2"
paso "b9 repro" sh -c 'python scripts/entrenar.py modelo-v1-repro dataset-v1 | tail -9'
paso "b9 evaluar v1" python scripts/evaluar.py dataset-v1 modelo-v1 modelo-v1-repro modelo-v2
paso "b9 checkout v1" sh -c 'git checkout -q dataset-v1 && dvc checkout && ls data/crudo | wc -l'
paso "b9 volver" sh -c 'git checkout -q main && dvc checkout && ls data/crudo | wc -l'
echo "listo: $LOG"
