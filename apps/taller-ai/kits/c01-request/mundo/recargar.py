"""Lleva tus cambios a lo que corre (no es parte de lo que escribes).

    python mundo/recargar.py prometheus    # prometheus.yml y reglas.yml: los revisa con promtool y recarga Prometheus
    python mundo/recargar.py fluent-bit    # fluent-bit.conf: reinicia los dos Fluent Bit (como un rollout del DaemonSet)
    python mundo/recargar.py gateway       # rastro.py: reinicia los pods, uno tras otro
    python mundo/recargar.py               # los tres

Antes de recargar espera a que el contenedor vea tus archivos igual que tu Mac (la misma sha256): Docker Desktop
guarda unos segundos lo que ya leyó de una carpeta compartida, y Prometheus podría leer un archivo a medias.
En C01 esto lo hace la plataforma: el Prometheus Operator recarga solo al cambiar un objeto, y Argo CD hace el rollout.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import OBS, PROMETHEUS, RAIZ, compose, http, igual_en  # noqa: E402


def prometheus() -> bool:
    for f in ("prometheus.yml", "reglas.yml"):
        if not igual_en("prometheus", OBS / f, f"/etc/prometheus/{f}"):
            print(f"⚠ Prometheus todavía no ve tu {f} como está en tu Mac; recargo de todos modos")
    r = compose("exec", "-T", "prometheus", "promtool", "check", "config", "/etc/prometheus/prometheus.yml", timeout=30)
    print((r.stdout + r.stderr).strip())
    if r.returncode != 0:
        print("✗ promtool encontró errores: Prometheus sigue con la configuración anterior")
        return False
    st, b, _ = http(f"{PROMETHEUS}/-/reload", metodo="POST", timeout=20)
    if st != 200:
        print(f"✗ la recarga falló ({st}): {b.decode()[:300]}")
        return False
    t0 = time.time()
    while True:                              # que cada regla ya se haya evaluado una vez (evaluation_interval: 5 s)
        time.sleep(1)
        g = json.loads(http(f"{PROMETHEUS}/api/v1/rules", timeout=5)[1] or b"{}").get("data", {}).get("groups", [])
        if all(r.get("health") != "unknown" for x in g for r in x["rules"]) or time.time() - t0 > 15:
            break
    jobs = json.loads(http(f"{PROMETHEUS}/api/v1/targets", timeout=5)[1] or b"{}").get("data", {}).get("activeTargets", [])
    print(f"✓ Prometheus recargado · {sum(len(x['rules']) for x in g)} reglas en {len(g)} grupos · objetivos: "
          + ", ".join(sorted({t['labels']['job'] for t in jobs})))
    return True


def fluent_bit() -> bool:
    for s in ("fluent-bit-a", "fluent-bit-b"):
        igual_en("prometheus", OBS / "fluent-bit.conf", "/etc/prometheus/fluent-bit.conf")   # la misma carpeta compartida
        r = compose("restart", s, timeout=120)
        if r.returncode != 0:
            print(f"✗ {s}: {r.stderr.strip()[-300:]}")
            return False
        time.sleep(3)
        r = compose("ps", "--format", "json", s, timeout=30)
        estado = next((json.loads(x).get("State") for x in r.stdout.splitlines() if x.strip()), "?")
        if estado != "running":
            print(f"✗ {s} no quedó corriendo ({estado}). Lo último de su log:\n"
                  + "\n".join(compose("logs", "--tail", "15", s, timeout=30).stdout.splitlines()[-15:]))
            return False
        print(f"✓ {s} reiniciado con tu fluent-bit.conf")
    return True


def gateway() -> bool:
    return subprocess.run([sys.executable, "mundo/nodo.py", "reiniciar", "gateway"], cwd=RAIZ).returncode == 0


def main() -> None:
    que = sys.argv[1:] or ["prometheus", "fluent-bit", "gateway"]
    ok = True
    for q in que:
        f = {"prometheus": prometheus, "fluent-bit": fluent_bit, "gateway": gateway}.get(q)
        if not f:
            sys.exit(__doc__)
        ok = f() and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
