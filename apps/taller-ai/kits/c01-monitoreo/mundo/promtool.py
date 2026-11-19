"""promtool y la historia de tus reglas (no es parte de lo que escribes). promtool viene en la imagen de Prometheus.

    python mundo/promtool.py revisar     # promtool check rules observabilidad/reglas.yml
    python mundo/promtool.py prueba      # promtool test rules observabilidad/pruebas.yml (simula horas y días)
    python mundo/promtool.py rellenar    # la historia de TUS recording rules: los 8 días que Prometheus ya tenía

`rellenar` corre, dentro del contenedor de Prometheus, los comandos de la documentación («Backfilling for Recording
Rules»), y los imprime para que los veas:
  1. promtool tsdb create-blocks-from rules --start … --end … --url http://localhost:9090 \\
       --output-dir /prometheus/relleno-<hora> /etc/prometheus/reglas.yml
     (evalúa cada recording rule, minuto a minuto, sobre la historia que ya está en Prometheus; las alertas las ignora)
  2. mueve los bloques nuevos a la carpeta de datos de Prometheus (/prometheus): los toma en la siguiente compactación
     (≈ 1 min).
La ventana termina donde empezó a leer en vivo (mundo/historia.py ventana): no se rellena lo que Prometheus está
escribiendo ahora (la documentación pide no tocar las últimas 3 h, el head block). Correrlo dos veces con la misma
ventana crea bloques repetidos: no lo hagas.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import OBS, compose, igual_en, leer_json, promtool  # noqa: E402
from mundo.historia import NACIMIENTO  # noqa: E402


def revisar() -> bool:
    r = promtool("check", "rules", "/o/reglas.yml")
    print((r.stdout + r.stderr).strip())
    return r.returncode == 0


def prueba() -> bool:
    r = promtool("test", "rules", "/o/pruebas.yml")
    print((r.stdout + r.stderr).strip())
    return r.returncode == 0


def rellenar() -> bool:
    n = leer_json(NACIMIENTO)
    if not n:
        print("✗ no hay historia (python mundo/crear.py)")
        return False
    if not igual_en("prometheus", OBS / "reglas.yml", "/etc/prometheus/reglas.yml"):
        print("✗ Prometheus no ve tu reglas.yml (¿corre?)")
        return False
    salida = f"/prometheus/relleno-{int(time.time())}"
    cmd = ["promtool", "tsdb", "create-blocks-from", "rules", "--start", str(n["inicio"]), "--end", str(n["fin"]),
           "--url", "http://localhost:9090", "--output-dir", salida, "/etc/prometheus/reglas.yml"]
    print("$ docker compose exec prometheus " + " ".join(cmd))
    t0 = time.time()
    r = compose("exec", "-T", "prometheus", *cmd, timeout=1800)
    print("\n".join((r.stdout + r.stderr).strip().splitlines()[-8:]))
    if r.returncode != 0:
        print("✗ promtool no pudo crear los bloques")
        return False
    mover = f"mv {salida}/* /prometheus/ && rmdir {salida}"
    print(f"$ docker compose exec prometheus sh -c '{mover}'")
    r = compose("exec", "-T", "prometheus", "sh", "-c", mover, timeout=120)
    if r.returncode != 0:
        print(f"✗ no pude mover los bloques: {r.stderr.strip()}")
        return False
    print(f"✓ bloques creados y movidos en {time.time() - t0:.0f} s. Prometheus los toma en ≈ 1 min; míralo con "
          "count_over_time(classifier:low_confidence_share:rate30m[8d])")
    return True


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else ""
    f = {"revisar": revisar, "prueba": prueba, "rellenar": rellenar}.get(que)
    if not f:
        sys.exit(__doc__)
    sys.exit(0 if f() else 1)
