#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): por cada una, la mete, corre verificar.py
# (qué checks la delatan), aplica el arreglo documentado y la cierra con romper.py --verificar. Al final prueba
# --restaurar con dos. Las salidas reales quedan en <carpeta>.fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 4 min)
set -uo pipefail
D="$1"; LOG="$D.fallas.log"
: > "$LOG"
cd "$D"; source .venv/bin/activate
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "^#[0-9]+ |^ *▶ " | tee -a "$LOG"; echo >> "$LOG"; }
ultima() { python -c "import json; print(list(json.load(open('.forja/estado.json'))['corridas'])[-1])"; }

f=check-fantasma
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py reglas
paso "$f confirma" git log -1 -p --format='%h %an: %s' -- mundo/forja.yaml
paso "$f arreglo" sh -c 'git revert --no-edit $(git log -1 --format=%h -- mundo/forja.yaml) | head -1'
paso "$f cerrar" python romper.py --verificar

f=confianza-abierta
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py reglas
paso "$f confirma" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/nube/confianza.json | grep -E '^[0-9a-f]{7}|^[-+] '"
paso "$f arreglo" sh -c 'git revert --no-edit $(git log -1 --format=%h -- mundo/nube/confianza.json) | head -1'
paso "$f cerrar" python romper.py --verificar

f=tag-movible
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py inmutable
paso "$f confirma" python mundo/nube.py ecr describir classifier-gateway
paso "$f arreglo" python mundo/nube.py ecr configurar classifier-gateway --inmutable
paso "$f cerrar" python romper.py --verificar

f=aviso-critico
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py imagen escaneo digest
N=$(ultima)
paso "$f confirma" sh -c "python mundo/forja.py corrida $N; python mundo/forja.py corrida $N --job imagen | sed -n '/▶ escaneo/,\$p' | grep -v '^\$'"
git add taller BITACORA.md && git commit -qm "bitácora" >/dev/null 2>&1
paso "$f arreglo" sh -c 'git switch -q main && git pull -q --no-rebase --no-edit origin main && git switch -q -c pyyaml-603 && sed -i "" "s/pyyaml==6.0.2/pyyaml==6.0.3/" gateway/requirements.txt && git commit -qam "gateway: vuelve pyyaml 6.0.3 (DOJO-2026-0107)" && git push -q origin pyyaml-603 && python mundo/forja.py pr abrir pyyaml-603 --titulo "gateway: pyyaml 6.0.3" | tail -2 && python mundo/forja.py pr merge $(python -c "import json; print(max(int(k) for k in json.load(open(\".forja/estado.json\"))[\"prs\"]))") | tail -6'
N=$(ultima)
paso "$f aprobar" python mundo/forja.py aprobar $N --como revisora
git switch -q main; git pull -q --no-rebase --no-edit origin main
paso "$f cerrar" python romper.py --verificar

f=despliegue-por-tag
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py digest
paso "$f confirma" python mundo/gitops.py estado
rm -rf ../despliegue-fallas; git clone -q .forja/despliegue.git ../despliegue-fallas
paso "$f log" sh -c 'cd ../despliegue-fallas && git log -1 -p --format="%h %an: %s" | grep -E "^[0-9a-f]{7}|^[-+]imagen"'
paso "$f arreglo" sh -c 'cd ../despliegue-fallas && git revert --no-edit HEAD >/dev/null && git push -q origin main 2>&1'
rm -rf ../despliegue-fallas
paso "$f cerrar" python romper.py --verificar

f=retencion-agresiva
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py retencion
paso "$f confirma" sh -c 'python mundo/nube.py ecr retencion classifier-gateway --vista-previa | tail -4'
paso "$f arreglo" python mundo/nube.py ecr politica-retencion classifier-gateway infra/ecr-retencion.json
paso "$f cerrar" python romper.py --verificar

# --restaurar deja todo sano
for f in confianza-abierta despliegue-por-tag; do
  paso "$f restaurar-romper" python romper.py --falla $f
  paso "$f restaurar" python romper.py --restaurar
done
paso "final" python verificar.py
echo "listo: $LOG"
