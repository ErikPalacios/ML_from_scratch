"""Paso «latencia»: ¿el engine nuevo no se volvió más lento que el que hoy sirve producción?

    python pipeline/latencia.py

Contrato:
- engine.yaml revisado y en un commit. El engine del challenger es el de artefactos/v<N>/ (huella = engine.json) y ya
  pasó la paridad (paridad.json con pasa y la misma huella). Si no, se detiene: medir un engine que no es el modelo no
  sirve de nada.
- La referencia es el engine del champion, el de corrida.yaml, por número: el que guarda su versión en MLflow
  (engine/engine.onnx), con la huella de su tag engine_sha256. Si no está o no cuadra, se detiene: sin referencia no
  hay gate (nunca «pasa» por default).
- Los dos se abren igual (como el servidor) y se miden en la misma máquina, a cada tasa de engine.yaml, con carga
  abierta: las peticiones llegan a su hora (Poisson con semilla fija, la misma para los dos) aunque la anterior no haya
  terminado. La latencia de cada una es desde que llegó hasta que tuvo respuesta (incluye la espera en la fila).
- Por tasa: rondas alternadas (champion, challenger, champion…); el p99 de cada ronda y la mediana de las rondas.
- La regla, a cada tasa: p99 del challenger ≤ (1 + holgura) × p99 del champion. Si no, código 1 y el motivo.
- Deja latencia.json: por tasa, los p99 de cada ronda, las medianas, el límite y pasa; y el máximo de fotos por
  segundo de cada engine.
"""
from __future__ import annotations

import math
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from _comun import (MODELO, RAIZ, bajar, carpeta, corrida, escribir_json, git, leer_json, mlflow_cliente, receta,
                    revisiones, sesion, sha256, sha_archivo)

# 1 · La receta, el challenger (con su paridad) y el champion (por número, con su huella)
r, cfg = receta(), corrida()
receta_sha = sha256((RAIZ / "engine.yaml").read_bytes())
if git("status", "--porcelain", "--", "engine.yaml") or receta_sha not in {x["engine_yaml_sha256"] for x in revisiones()}:
    sys.exit("✗ engine.yaml no es una versión revisada y en un commit: git status, git log -p engine.yaml")
d_ = carpeta(cfg["challenger"])
info, par = leer_json(d_ / "engine.json"), leer_json(d_ / "paridad.json")
if not info or sha_archivo(d_ / "engine.onnx") != info["engine_sha256"]:
    sys.exit("✗ falta el engine del challenger con su engine.json: corre pipeline/construir.py")
if not par or not par["pasa"] or par["engine_sha256"] != info["engine_sha256"]:
    sys.exit("✗ ese engine no tiene una paridad que pasó: corre pipeline/paridad.py (y si no pasa, no se mide)")
c = mlflow_cliente()
v_ch = c.get_model_version(MODELO, str(cfg["champion"]))
esperada = v_ch.tags.get("engine_sha256")
try:
    champ = bajar(v_ch.run_id, "engine/engine.onnx")
except Exception:  # noqa: BLE001
    champ = b""
if not esperada or sha256(champ) != esperada:
    sys.exit(f"✗ el engine del champion (v{cfg['champion']}) no está en MLflow o no es el de su tag engine_sha256 "
             f"({sha256(champ)[:12] if champ else 'no hay archivo'}… vs {(esperada or '?')[:12]}…): sin la referencia de "
             "producción no hay gate de latencia")
tmp = Path(tempfile.mkdtemp()) / "champion.onnx"
tmp.write_bytes(champ)
engines = {"champion": sesion(tmp), "challenger": sesion(d_ / "engine.onnx")}

# 2 · Cómo se mide: carga abierta a una tasa fija, una petición = una foto
x = np.random.default_rng(0).standard_normal((256, 3, 32, 32)).astype(np.float32)   # la latencia no depende de la foto
for s in engines.values():   # calentar: las primeras corridas pagan cargas y cachés
    for i in range(300):
        s.run(None, {"input": x[i % 256:i % 256 + 1]})


def p99(s, tasa: float, n: int, semilla: int) -> float:
    llegadas = np.cumsum(np.random.default_rng(semilla).exponential(1 / tasa, n))   # Poisson: a veces llegan juntas
    t0, lat = time.perf_counter() + 0.005, []
    for i in range(n):
        llega = t0 + llegadas[i]
        while time.perf_counter() < llega:          # espera activa: la petición llega a su hora, no antes
            pass
        s.run(None, {"input": x[i % 256:i % 256 + 1]})
        lat.append((time.perf_counter() - llega) * 1000)   # desde que llegó: incluye la fila
    lat.sort()
    return lat[math.ceil(0.99 * n) - 1]                  # rango más cercano: la latencia número ⌈0.99·n⌉


def maximo(s, n: int = 3000) -> float:
    t = time.perf_counter()
    for i in range(n):
        s.run(None, {"input": x[i % 256:i % 256 + 1]})
    return n / (time.perf_counter() - t)


L = r["latencia"]
X = {k: maximo(s) for k, s in engines.items()}
print(f"  máximo, una foto a la vez: champion {X['champion']:,.0f} fotos/s · challenger {X['challenger']:,.0f} fotos/s")
tasas, motivos = {}, []
for tasa in L["tasas"]:
    rondas = {"champion": [], "challenger": []}
    for k in range(L["rondas"]):
        for quien in ("champion", "challenger"):
            rondas[quien].append(p99(engines[quien], tasa, L["peticiones"], semilla=1000 * tasa + k))
    t_c, t_n = statistics.median(rondas["champion"]), statistics.median(rondas["challenger"])
    limite = (1 + L["holgura"]) * t_c
    pasa = bool(t_n <= limite)
    tasas[str(tasa)] = {"rondas_champion": rondas["champion"], "rondas_challenger": rondas["challenger"], "p99_champion": t_c,
                        "p99_challenger": t_n, "limite": limite, "uso": tasa / X["challenger"], "pasa": pasa}
    print(f"  {tasa:>5} peticiones/s (uso ≈ {tasa / X['challenger']:.0%}) · p99 champion {t_c:.3f} ms · challenger {t_n:.3f} ms · "
          f"límite {limite:.3f} ms · {'pasa' if pasa else 'NO pasa'}")
    if not pasa:
        motivos.append(f"a {tasa}/s el p99 del challenger ({t_n:.3f} ms) pasa del límite ({limite:.3f} ms)")

escribir_json(d_ / "latencia.json", {
    "version": str(cfg["challenger"]), "engine_sha256": info["engine_sha256"], "champion_version": str(cfg["champion"]),
    "champion_engine_sha256": esperada, "engine_yaml_sha256": receta_sha, "holgura": L["holgura"], "peticiones": L["peticiones"],
    "rondas": L["rondas"], "maximo_fotos_s": X, "tasas": tasas, "pasa": not motivos, "motivo": "; ".join(motivos)})
if motivos:
    sys.exit(f"✗ latencia: NO pasa · {'; '.join(motivos)}")
print(f"✓ latencia: pasa a las {len(L['tasas'])} tasas (holgura {L['holgura']:.0%} sobre el champion v{cfg['champion']})")
