#!/usr/bin/env bash
# Corre el Guiado de la estación 8 en una carpeta limpia, como lo haría una persona, con los archivos de esta solución,
# y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3; ≈ 6 min)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-cicd"
D="$1"; LOG="$D.log"
docker rm -f taller-c01-cicd-gw-staging taller-c01-cicd-gw-produccion >/dev/null 2>&1
[ -f "$D/compose.yaml" ] && (cd "$D" && docker compose down -v >/dev/null 2>&1)
rm -rf "$D" || exit 1; mkdir -p "$D"; : > "$LOG"
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "^#[0-9]+ |^ *▶ " | tee -a "$LOG"; echo >> "$LOG"; }
usa() { mkdir -p "$(dirname "$1")"; cp "$SOL/$1" "$1"; }

docker rm -f taller-c01-cicd-gw-staging taller-c01-cicd-gw-produccion >/dev/null 2>&1
(cd "$KIT" && docker compose down -v >/dev/null 2>&1)
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude .venv --exclude .forja --exclude .nube --exclude .pytest_cache --exclude .ruff_cache -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)     # el esqueleto en su lugar, como en el .zip
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait --build 2>&1 | tail -3'
paso "p0 crear" sh -c '/usr/bin/time -p python mundo/crear.py 2>&1'
paso "p0 verificar" python verificar.py mundo reglas

# paso 1 · mirar el mundo
paso "p1 remote" git remote -v
paso "p1 describir" python mundo/nube.py ecr describir classifier-gateway
paso "p1 imagenes" sh -c 'python mundo/nube.py ecr imagenes classifier-gateway | head -6'
paso "p1 gitops" python mundo/gitops.py estado
paso "p1 despliegue" sh -c 'git --git-dir=.forja/despliegue.git show main:produccion/gateway.yaml'
paso "p1 healthz" curl -s localhost:8802/healthz

# paso 2 · tags inmutables
paso "p2 configurar" python mundo/nube.py ecr configurar classifier-gateway --inmutable

# paso 3 · el workflow del PR (solo lint y pruebas)
git switch -q -c ci-gateway
mkdir -p .github/workflows
python - "$SOL/.github/workflows/gateway.yml" > .github/workflows/gateway.yml <<'PY'
import sys, re
t = open(sys.argv[1]).read()
print(t.split("\n  imagen:\n")[0].rstrip())
PY
paso "p3 commit" sh -c 'git add .github && git commit -qm "ci: lint y pruebas en cada PR" && git push -q origin ci-gateway 2>&1; git log --oneline -1'
paso "p3 pr" python mundo/forja.py pr abrir ci-gateway --titulo 'CI del gateway: lint y pruebas'
paso "p3 trampa" python -c "
import sys; sys.path.insert(0, '.')
from mundo import acciones
wf = {'on': {'pull_request': {'paths': ['gateway/**']}}}
for archivos in (['gateway/app/main.py'], ['gateway.yaml'], ['README.md']):
    print(f'con paths gateway/**, un PR que cambia {archivos[0]:<20} dispara el workflow: {acciones.se_dispara(wf, \"pull_request\", \"main\", archivos)}')"

# paso 4 · construir, humo y escaneo (en tu terminal, antes de ponerlo en el workflow)
usa ci/humo.sh; usa ci/escaneo.sh; usa .trivyignore.yaml
export IMG=localhost:5800/classifier-gateway:prueba
paso "p4 build" sh -c 'time -p docker build -q -f gateway/Dockerfile -t $IMG . 2>&1'
paso "p4 humo" bash ci/humo.sh $IMG
paso "p4 sbom" python mundo/escaner.py image $IMG --format cyclonedx --output /tmp/sbom-dojo.json
paso "p4 escaneo-todo" python mundo/escaner.py image $IMG
paso "p4 escaneo" bash ci/escaneo.sh $IMG
paso "p4 capas" sh -c "docker history --format '{{.Size}}\t{{.CreatedBy}}' $IMG | grep -v '^0B' | cut -c1-100"

# paso 5 · subir: sin token no hay credenciales
usa ci/push.sh
paso "p5 sin-token" sh -c 'ROL=arn:aws:iam::000000000000:role/gha-classifier-gateway GITHUB_OUTPUT=/dev/null bash ci/push.sh $IMG'

# paso 6 · el workflow completo: merge, staging, aprobación y producción
usa ci/desplegar.sh; usa .github/workflows/gateway.yml
paso "p6 commit" sh -c 'chmod +x ci/*.sh && git add -A && git commit -qm "ci: imagen, staging y produccion por digest" && git push -q origin ci-gateway 2>&1; git log --oneline -1'
paso "p6 pr" python mundo/forja.py pr abrir ci-gateway
paso "p6 merge" sh -c 'time -p python mundo/forja.py pr merge 1 2>&1'
N=$(python -c "import json; print(list(json.load(open('.forja/estado.json'))['corridas'])[-1])")
paso "p6 aprobar-tu" python mundo/forja.py aprobar $N --como tu
paso "p6 aprobar" python mundo/forja.py aprobar $N --como revisora
paso "p6 corrida" python mundo/forja.py corrida $N
paso "p6 log-push" sh -c "python mundo/forja.py corrida $N --job imagen | grep -v -E '^#|^\$' | sed -n '/▶ push/,\$p'"
paso "p6 gitops" python mundo/gitops.py estado
paso "p6 imagenes" sh -c 'python mundo/nube.py ecr imagenes classifier-gateway | head -4'
paso "p6 classify" sh -c 'python ci/foto.py | curl -s -X POST --data-binary @- -H "Content-Type: image/jpeg" "localhost:8802/v1/classify?top_k=3"'
paso "p6 pull" sh -c 'git add taller BITACORA.md && git commit -qm bitácora; git switch -q main && git pull -q origin main && git log --oneline -1'
paso "p6 rerun" sh -c "python mundo/forja.py rerun $N 2>&1; python mundo/forja.py corrida \$(python -c \"import json; print(list(json.load(open('.forja/estado.json'))['corridas'])[-1])\") --job imagen | grep -E 'error from registry|immutable'"

# paso 7 · la retención
usa infra/ecr-retencion.json
paso "p7 politica" python mundo/nube.py ecr politica-retencion classifier-gateway infra/ecr-retencion.json
paso "p7 vista" python mundo/nube.py ecr retencion classifier-gateway --vista-previa
paso "p7 commit" sh -c 'git add infra && git commit -qm "infra: la regla de retención de classifier-gateway" && git log --oneline -1'

# paso 8 · rollback en segundos (y de vuelta)
git clone -q .forja/despliegue.git ../despliegue-dojo-8 2>/dev/null || (rm -rf ../despliegue-dojo-8 && git clone -q .forja/despliegue.git ../despliegue-dojo-8)
paso "p8 log" git -C ../despliegue-dojo-8 log --oneline
paso "p8 revert" sh -c 'cd ../despliegue-dojo-8 && git revert --no-edit HEAD >/dev/null && time -p git push -q origin main 2>&1'
paso "p8 gitops" python mundo/gitops.py estado
paso "p8 adelante" sh -c 'cd ../despliegue-dojo-8 && git revert --no-edit HEAD >/dev/null && git push -q origin main 2>&1 && git log --oneline -3'
paso "p8 retencion" python verificar.py retencion
rm -rf ../despliegue-dojo-8

# precálculos
paso "pc camino" python -c "
import json
c = list(json.load(open('.forja/estado.json'))['corridas'].values())
m = [x for x in c if x['evento'] == 'push' and x['jobs']['produccion']['result'] == 'success'][0]
s = {j: r.get('seg', 0) for j, r in m['jobs'].items()}
ci = max(s['lint'], s['pruebas']) + s['imagen']
print(f\"max(lint {s['lint']}, pruebas {s['pruebas']}) + imagen {s['imagen']} = {ci:.1f} s al ECR · + staging {s['staging']} + produccion {s['produccion']} = {ci + s['staging'] + s['produccion']:.1f} s sin la aprobación\")"
paso "pc retencion" python -c "
for nombre, N, m in [('C01, gateway (3 a 5 merges al día)', 200, 4), ('dojo (35 imágenes en 45 días)', 30, 35 / 45)]:
    print(f'{nombre}: d = N / m = {N} / {m:.2f} = {N / m:.0f} días')"
paso "pc capas" python -c "
A, d, N = 87, 0.048, 200
print(f'C01: S = A + N × δ = {A} + {N} × {d} = {A + N * d:.0f} MB · entera: N × (A + δ) = {N * (A + d) / 1000:.1f} GB')"
paso "pc credenciales" python -c "
for nombre, dura_min in [('token OIDC del dojo', 5), ('contraseña de ECR', 12 * 60), ('timeout del job imagen', 20)]:
    print(f'{nombre}: {dura_min} min')"

paso "p9 verificar" python verificar.py
echo "listo: $LOG"
