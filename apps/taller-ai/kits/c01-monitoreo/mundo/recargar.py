"""Lleva un cambio de tus archivos a lo que corre, sin reiniciar nada.

    python mundo/recargar.py prometheus      # después de cambiar observabilidad/reglas.yml (o el prometheus.yml de plataforma)
    python mundo/recargar.py alertmanager    # después de cambiar observabilidad/alertmanager.yml

1. Revisa el archivo con la herramienta oficial (promtool check rules · amtool check-config): uno roto no se carga.
2. Espera a que el contenedor vea el archivo igual que tu Mac (la misma sha256): Docker Desktop guarda unos segundos lo
   que ya leyó, y un POST /-/reload justo después de guardar puede cargar el archivo a medias (estación 11).
3. POST /-/reload y revisa que la configuración nueva sea la que quedó (en C01, el operador de Prometheus hace esto
   cuando cambias el PrometheusRule o el secreto de Alertmanager).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALERTMANAGER, MUNDO, OBS, PROMETHEUS, amtool, http, igual_en, promtool  # noqa: E402


def prometheus() -> bool:
    r = promtool("check", "rules", "/o/reglas.yml")
    print(r.stdout.strip() or r.stderr.strip())
    if r.returncode != 0:
        print("✗ promtool rechaza observabilidad/reglas.yml: no lo cargo")
        return False
    if not igual_en("prometheus", OBS / "reglas.yml", "/etc/prometheus/reglas.yml"):
        print("✗ Prometheus no ve todavía tu reglas.yml (¿corre? python mundo/servicios.py estado)")
        return False
    if not igual_en("prometheus", MUNDO / "prometheus" / "prometheus.yml", "/etc/prometheus-plataforma/prometheus.yml"):
        print("✗ Prometheus no ve todavía el prometheus.yml de plataforma")
        return False
    st, b, _ = http(f"{PROMETHEUS}/-/reload", metodo="POST", timeout=30)
    if st != 200:
        print(f"✗ Prometheus no recargó ({st}): {b.decode(errors='replace')[:300]}")
        return False
    time.sleep(1)
    st, b, _ = http(f"{PROMETHEUS}/api/v1/rules")
    grupos = json.loads(b)["data"]["groups"] if st == 200 else []
    n_rec = sum(1 for g in grupos for x in g["rules"] if x["type"] == "recording")
    n_al = sum(1 for g in grupos for x in g["rules"] if x["type"] == "alerting")
    print(f"✓ Prometheus recargó: {len(grupos)} grupos, {n_rec} recording rules y {n_al} alertas. "
          "Míralas en http://localhost:9962/rules y http://localhost:9962/alerts")
    return True


def alertmanager() -> bool:
    r = amtool("check-config", "/etc/alertmanager/dojo/alertmanager.yml")
    print((r.stdout + r.stderr).strip())
    if r.returncode != 0:
        print("✗ amtool rechaza observabilidad/alertmanager.yml: no lo cargo")
        return False
    if not igual_en("alertmanager", OBS / "alertmanager.yml", "/etc/alertmanager/dojo/alertmanager.yml"):
        print("✗ Alertmanager no ve todavía tu alertmanager.yml (¿corre? python mundo/servicios.py estado)")
        return False
    st, b, _ = http(f"{ALERTMANAGER}/-/reload", metodo="POST", timeout=30)
    if st != 200:
        print(f"✗ Alertmanager no recargó ({st}): {b.decode(errors='replace')[:300]}")
        return False
    st, b, _ = http(f"{ALERTMANAGER}/api/v2/status")
    original = json.loads(b)["config"]["original"] if st == 200 else ""
    print(f"✓ Alertmanager recargó ({original.count('- name:')} receptores). Míralo en http://localhost:9963")
    return True


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else ""
    if que not in ("prometheus", "alertmanager"):
        sys.exit(__doc__)
    sys.exit(0 if {"prometheus": prometheus, "alertmanager": alertmanager}[que]() else 1)
