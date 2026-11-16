#!/usr/bin/env bash
# Prueba las 7 fallas sobre la carpeta que dejó probar.sh (todo en verde): para cada una, la mete con
# romper.py --mostrar, muestra qué check la detecta, corre el comando que la confirma, aplica el arreglo
# documentado y la cierra con romper.py --verificar. Al final mete una al azar y prueba --restaurar.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D" && source .venv/bin/activate
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
ver() { python verificar.py 2>&1 | grep -E "^✗|en verde"; }
version_de() {  # version_de <llave> <vigente|marca>: el version_id de la versión vigente (o de la marca de borrado)
  python -c "
import sys; sys.path.insert(0, '.')
from mundo.comun import s3, versiones
vs, ms = versiones(s3(), 'ml-datos', '$1')
xs = ms if '$2' == 'marca' else vs
print(next(x['VersionId'] for x in xs if x['IsLatest']))"
}
ahora() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 1 · snapshot-pisado
paso "f1 romper" python romper.py --mostrar --falla snapshot-pisado
paso "f1 detecta" ver
paso "f1 confirma" python mundo/s3.py versiones ml-datos datasets/ds-2026-08-01/rows.parquet
paso "f1 arreglo" python mundo/s3.py borrar-version ml-datos datasets/ds-2026-08-01/rows.parquet "$(version_de datasets/ds-2026-08-01/rows.parquet vigente)"
paso "f1 verificar" python romper.py --verificar

# 2 · tarjeta-borrada
paso "f2 romper" python romper.py --mostrar --falla tarjeta-borrada
paso "f2 detecta" ver
paso "f2 confirma" python mundo/s3.py versiones ml-datos datasets/ds-2026-09-01/
for k in snapshot.json validation.json; do
  paso "f2 arreglo $k" python mundo/s3.py borrar-version ml-datos "datasets/ds-2026-09-01/$k" "$(version_de datasets/ds-2026-09-01/$k marca)"
done
paso "f2 verificar" python romper.py --verificar

# 3 · versiones-apagadas
paso "f3 romper" python romper.py --mostrar --falla versiones-apagadas
paso "f3 detecta" ver
paso "f3 confirma" python mundo/s3.py versionado ml-datos
paso "f3 arreglo" python mundo/s3.py versionado ml-datos on
paso "f3 verificar" python romper.py --verificar

# 4 · latest
paso "f4 romper" python romper.py --mostrar --falla latest
paso "f4 detecta" ver
paso "f4 confirma" grep -n -A2 "^entrenar:" params.yaml
paso "f4 6_entrenar" python pipeline/6_entrenar.py
sed -i '' 's/^  snapshot: latest /  snapshot: ds-2026-09-01 /' params.yaml
paso "f4 verificar" python romper.py --verificar

# 5 · umbral-movido
paso "f5 romper" python romper.py --mostrar --falla umbral-movido
paso "f5 detecta" ver
paso "f5 confirma" dvc status
paso "f5 repro" sh -c 'dvc repro 2>&1 | grep -E "Running stage|✗|failed|ERROR"'
paso "f5 detecta2" ver
sed -i '' 's/^  umbral: 80 /  umbral: 90 /' params.yaml
paso "f5 arreglo" sh -c 'dvc repro 2>&1 | grep -E "Running stage|skipping|cached|up to date"'
paso "f5 verificar" python romper.py --verificar

# 6 · labels-reentregados
paso "f6 romper" python romper.py --mostrar --falla labels-reentregados
paso "f6 detecta" ver
paso "f6 confirma" dvc status
paso "f6 repro" sh -c 'dvc repro 2>&1 | grep -E "Running stage|✗|412|ERROR" | head -8'
sed -i '' 's/^  id: ds-2026-09-01 /  id: ds-2026-09-01-r2 /; s/^  snapshot: ds-2026-09-01 /  snapshot: ds-2026-09-01-r2 /' params.yaml
git add -A && git commit -qm "ds-2026-09-01-r2: la estación 1 reentregó los eventos"
paso "f6 arreglo" sh -c 'dvc repro 2>&1 | grep -E "Running stage|publicado|ERROR"'
git add -A && git commit -qm "dvc.lock de r2"
paso "f6 entrenar" python pipeline/6_entrenar.py
paso "f6 verificar" python romper.py --verificar
git add -A && git commit -qm "de vuelta al mundo sano" >/dev/null

# 7 · foto-borrada
paso "f7 romper" python romper.py --mostrar --falla foto-borrada
paso "f7 detecta" ver
paso "f7 confirma" python pipeline/6_entrenar.py
FALTAN=$(python -c "
import pandas as pd, sys; sys.path.insert(0, 'pipeline')
from _comun import s3
c = s3(); r = pd.read_parquet('data/rows.parquet'); b = set(pd.read_csv('entrada/borrados.csv').image_sha256)
for f in r[~r.image_sha256.isin(b)].itertuples():
    try: c.head_object(Bucket='fotos', Key=f.image_key)
    except Exception: print(f.image_sha256)")
paso "f7 faltan" sh -c "echo '$FALTAN' | cut -c1-16"
for h in $FALTAN; do echo "$h,$(ahora),derecho al borrado (solicitud atendida por soporte)" >> entrada/borrados.csv; done
paso "f7 linaje" python pipeline/7_linaje.py "$(echo "$FALTAN" | head -1)"
paso "f7 arreglo" sh -c 'dvc repro 2>&1 | grep -E "Running stage|skipping|filas"'
git add -A && git commit -qm "registro de borrados: solicitud atendida por soporte"
paso "f7 verificar" python romper.py --verificar
git add -A && git commit -qm "de vuelta al mundo sano" >/dev/null

# --restaurar deja todo en verde
for f in snapshot-pisado tarjeta-borrada versiones-apagadas latest umbral-movido labels-reentregados foto-borrada; do
  python romper.py --mostrar --falla "$f" >/dev/null
  paso "r $f" sh -c 'python romper.py --restaurar | tail -2'
  git add -A && git commit -qm "restaurar $f" >/dev/null 2>&1
done
paso "final" python verificar.py
echo "listo: $LOG"
