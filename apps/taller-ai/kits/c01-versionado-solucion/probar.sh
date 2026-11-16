#!/usr/bin/env bash
# Corre el Guiado de la estación 2 en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-versionado"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude data --exclude entrada --exclude corridas --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait 2>&1 | tail -2'
paso "p0 crear" python mundo/crear.py
paso "p0 git" sh -c 'git init -q && git add -A && git commit -qm "kit recién descomprimido" && dvc init -q && git commit -qm "dvc init" && git log --oneline'
paso "p0 verificar" python verificar.py mundo

# precálculos sobre el mundo recién creado
paso "pc fotos" python -c "
import pandas as pd
p = pd.read_parquet('entrada/publicaciones.parquet')
print(f'{len(p)} publicaciones · {p.bytes.sum() / 1e6:.1f} MB de fotos · {p.bytes.mean() / 1e3:.1f} kB por foto en promedio')"
paso "pc padre" python -c "
import json, sys; sys.path.insert(0, '.')
from mundo.comun import s3
t = json.loads(s3().get_object(Bucket='ml-datos', Key='datasets/ds-2026-08-01/snapshot.json')['Body'].read())
print('ds-2026-08-01:', t['counts'], '· split:', t['split']['rule'])"
paso "pc hash" python -c "
import hashlib, time
b = bytes(512 * 2**20)
t = time.perf_counter(); hashlib.sha256(b).hexdigest(); s = time.perf_counter() - t
print(f'sha256 de 512 MiB en {s:.2f} s: {512 / 1024 / s:.1f} GiB/s en un núcleo')"
paso "pc eventos" python -c "
import pandas as pd
e = pd.read_parquet('entrada/labels-eventos.parquet')
print(len(e), 'eventos ·', e.image_key.nunique(), 'fotos ·', e.label_source.value_counts().to_dict())
print('después del corte:', (e.ts >= '2026-10-01').sum())"

# pasos 1 a 4
cp "$SOL/pipeline/1_labels.py" pipeline/
paso "p1 labels" python pipeline/1_labels.py
paso "p1 ver" python -c "
import pandas as pd
print(pd.read_parquet('data/labels.parquet').head(3).to_string(index=False))"
paso "p1 verificar" python verificar.py labels
cp "$SOL/pipeline/2_manifest.py" pipeline/
paso "p2 manifest" python pipeline/2_manifest.py
paso "p2 verificar" python verificar.py manifest
cp "$SOL/pipeline/3_split.py" pipeline/
paso "p3 split" python pipeline/3_split.py
paso "p3 cubetas" python -c "
import hashlib
for s in ['s-001', 's-002', 's-007', 's-001']:
    c = int(hashlib.sha256(s.encode()).hexdigest(), 16) % 100
    print(s, c, 'train' if c < 90 else 'val')"
paso "p3 verificar" python verificar.py split split-estable
cp "$SOL/pipeline/4_validar.py" pipeline/
paso "p4 validar" python pipeline/4_validar.py
paso "p4 verificar" python verificar.py validacion

# paso 5 · publicar
cp "$SOL/pipeline/5_publicar.py" pipeline/
paso "p5 sucio" python pipeline/5_publicar.py
git add -A && git commit -qm "pipeline: pasos 1 a 5"
paso "p5 publicar" python pipeline/5_publicar.py
paso "p5 otra vez" python pipeline/5_publicar.py
paso "p5 412" python -c "
import sys; sys.path.insert(0, 'pipeline')
from _comun import s3
try:
    s3().put_object(Bucket='ml-datos', Key='datasets/ds-2026-09-01/rows.parquet', Body=b'otra cosa', IfNoneMatch='*')
except Exception as e:
    print(type(e).__name__, '·', e)"
paso "p5 versiones" python mundo/s3.py versiones ml-datos datasets/ds-2026-09-01/
paso "p5 tarjeta" sh -c "python -c \"import sys; sys.path.insert(0, 'pipeline'); from _comun import s3; print(s3().get_object(Bucket='ml-datos', Key='datasets/ds-2026-09-01/snapshot.json')['Body'].read().decode())\""
paso "p5 verificar" python verificar.py snapshot inmutable

# paso 6 · el DAG con DVC
cp "$SOL/dvc.yaml" .
git add -A && git commit -qm "el pipeline como DAG"
paso "p6 repro" dvc repro
paso "p6 status" dvc status
paso "p6 repro2" dvc repro
paso "p6 dag" dvc dag
paso "p6 lock" sh -c 'sed -n "1,22p" dvc.lock'
git add dvc.lock && git commit -qm "ds-2026-09-01"
paso "p6 verificar" python verificar.py dag

# paso 7 · entrenar con linaje
cp "$SOL/pipeline/6_entrenar.py" pipeline/
paso "p7 sucio" python pipeline/6_entrenar.py
git add -A && git commit -qm "entrenar con linaje"
paso "p7 entrenar" python pipeline/6_entrenar.py
paso "p7 corrida" sh -c 'cat $(ls -t corridas/*.json | head -1)'
paso "p7 verificar" python verificar.py corrida lectura

# paso 8 · el linaje al revés
cp "$SOL/pipeline/7_linaje.py" pipeline/
git add -A && git commit -qm "linaje"
H=$(sed -n 2p entrada/borrados.csv | cut -d, -f1)
paso "p8 borrada" python pipeline/7_linaje.py "$H"
H2=$(python -c "
import pandas as pd, io, sys; sys.path.insert(0, 'pipeline')
from _comun import s3
a = pd.read_parquet(io.BytesIO(s3().get_object(Bucket='ml-datos', Key='datasets/ds-2026-08-01/rows.parquet')['Body'].read()))
b = pd.read_parquet('data/rows.parquet')
print(sorted(set(a.image_sha256) & set(b.image_sha256))[0])")
paso "p8 ambas" python pipeline/7_linaje.py "${H2:0:16}"
paso "p8 verificar" python verificar.py linaje

paso "final" python verificar.py
echo "listo: $LOG"
