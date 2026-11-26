#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: rehace el pipeline de la solución (probar.sh termina con
# el esqueleto de la ronda Construir solo), lo deja en verde con la mañana pasada, y luego cada falla se mete con
# romper.py, se ve qué check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena.
# Al final, una con --restaurar. Deja cada salida real en <carpeta>-fallas.log.
# Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"; source .venv/bin/activate
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
cfg() { python - "$@" <<'Y'
import re, sys
clave, viejo, nuevo = sys.argv[1:]
s = open("config.yaml").read()
s2 = re.sub(rf"(?m)^(\s*{clave}:\s*){re.escape(viejo)}", lambda m: m.group(1) + nuevo, s, count=1)
assert s2 != s, (clave, viejo)
open("config.yaml", "w").write(s2)
print(f"config.yaml: {clave}: {viejo} → {nuevo}")
Y
}
cp "$SOL"/pipeline/*.py pipeline/
python pipeline/indexar.py > /dev/null; python mundo/avanzar.py > /dev/null
paso "f0 sano" python verificar.py

# 1 · filtro después del top-k
paso "fil romper" python romper.py --mostrar --falla filtro-despues
paso "fil verificar" python verificar.py filtro fuga
paso "fil ana" python pipeline/buscar.py --como ana.ruiz@marketplace.test "Cuenta de vendedor duplicada"
paso "fil arreglo" sh -c "$(declare -f cfg); cfg filtro despues antes"
paso "fil cerrar" python romper.py --verificar

# 2 · ACL vieja tras una revocación
paso "vie romper" python romper.py --mostrar --falla acl-vieja
paso "vie verificar" python verificar.py revocacion fuga
paso "vie manana" python mundo/avanzar.py
paso "vie arreglo" sh -c "$(declare -f cfg); cfg cada_segundos 3600 60 && python mundo/avanzar.py | tail -2"
paso "vie cerrar" python romper.py --verificar

# 3 · grupo anidado no resuelto
paso "ani romper" python romper.py --mostrar --falla anidado
paso "ani verificar" python verificar.py fuga acceso
paso "ani ana" sh -c "python -c \"import sys; sys.path.insert(0, 'pipeline'); from buscar import mis_principals, visibles; p = 'ana.ruiz@marketplace.test'; print(sorted(x.split('@')[0] for x in mis_principals(p)), '·', len(visibles(p)), 'chunks visibles')\""
paso "ani arreglo" sh -c "$(declare -f cfg); cfg profundidad 1 10"
paso "ani cerrar" python romper.py --verificar

# 4 · chunk sin ACL que se vuelve público
paso "pub romper" python romper.py --mostrar --falla sin-acl-publico
paso "pub verificar" python verificar.py indice fuga
paso "pub diego" python pipeline/buscar.py --como diego.luna@marketplace.test "¿Cuánto gana un líder de soporte?"
paso "pub medio" sh -c "$(declare -f cfg); cfg sin_acl publico rechazar && python pipeline/indexar.py && python verificar.py indice fuga"
paso "pub arreglo" sh -c "python mundo/crear.py --rechunkear && python pipeline/indexar.py"
paso "pub cerrar" python romper.py --verificar

# 5 · bitácora del carril borrada
paso "bit romper" python romper.py --mostrar --falla bitacora-borrada
paso "bit verificar" python verificar.py indice fuga
paso "bit carril" python pipeline/revocar.py
paso "bit arreglo" sh -c "python pipeline/indexar.py --desde-cero && python pipeline/revocar.py"
paso "bit cerrar" python romper.py --verificar

# 6 · suscripción del directorio vencida
paso "sus romper" python romper.py --mostrar --falla suscripcion-vencida
paso "sus verificar" python verificar.py revocacion fuga
paso "sus manana" python mundo/avanzar.py
paso "sus arreglo" sh -c "python mundo/crear.py --suscribir && python mundo/avanzar.py | tail -3"
paso "sus cerrar" python romper.py --verificar

# restaurar
paso "rest romper" python romper.py
paso "rest restaurar" python romper.py --restaurar
paso "rest sano" python verificar.py
