"""El job «promover» del pipeline: espera a que el Rollout del gateway esté sano al 100 % y mueve el alias champion del
registro de modelos a la versión que quedó de estable. Es el último paso de la escalera: el alias se mueve al final,
cuando ya es verdad.

    python3 ci/promover.py                 # espera hasta 15 min a que el Rollout termine; después, mueve champion
    python3 ci/promover.py --esperar 0     # no espera: si el Rollout no está sano al 100 %, sale con error

Contrato (lo revisa verificar.py alias):
- Lee el Rollout gateway (kubectl -n classifier get rollout gateway -o json). Sano al 100 % = status.phase «Healthy»,
  sin abortar, y el ReplicaSet estable (status.stableRS) es el del template actual (status.currentPodHash).
- Si el Rollout está «Degraded» o abortado, sale con 1 sin tocar nada: champion se queda donde estaba.
- La versión es la etiqueta classifier/modelo del template. Mueve champion a esa versión con python3 mundo/modelos.py
  y le pone dos etiquetas: run (el de esa versión en el registro) y digest (el digest de la imagen de su Triton, el
  Deployment triton-v<versión>).
- Si champion ya está ahí con esas etiquetas, no hace nada y sale con 0 (se puede correr dos veces).
"""
import sys

sys.exit("ci/promover.py: todavía no lo escribes (paso 9 del Guiado)")
