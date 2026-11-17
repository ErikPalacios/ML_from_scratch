"""El orquestador del mundo: corre tu pipeline.yaml como un DAG, paso por paso, con reintentos. En C01: Argo Workflows
(o Kubeflow Pipelines, o Airflow). Tú escribes la definición; él la ejecuta.

    python mundo/orquestador.py pipeline.yaml                  # una corrida del pipeline
    python mundo/orquestador.py pipeline.yaml --apagon 15      # y se pierde el nodo del paso con gpu a los 15 s
    python mundo/orquestador.py pipeline.yaml --param semilla=18

Qué hace, igual que uno de verdad:
- Valida el DAG (ids únicos, dependencias que existen, sin ciclos) y lo corre en orden.
- Le pone a la corrida un id (wf-AAAAMMDD-HHMMSS, en UTC) y se lo pasa a cada paso como {corrida}.
- Resuelve UNA vez, al arrancar, cada parámetro que empieza con @ (un alias de classifier en MLflow, como @champion)
  y pasa a todos los pasos y reintentos el número de versión. Si el alias se mueve a media corrida, esta no se entera.
- Si un paso falla, espera espera_s y lo vuelve a lanzar, hasta reintentos veces. Si se acaban, la corrida queda en rojo.
- Un paso con gpu: 1 pide una GPU (aquí, la CPU de tu Mac). --apagon S simula que se pierde ese nodo a los S segundos
  del primer intento: el proceso muere de golpe (SIGKILL), sin tiempo de guardar nada.
- Anota todo en historial/<corrida>.json: parámetros resueltos, cada intento con su hora, su código y su motivo.

Formato de pipeline.yaml:
    nombre: c01-mensual
    parametros: {snapshot: ds-2026-09-01, champion: "@champion"}
    pasos:
      - id: humo
        comando: python pipeline/humo.py --snapshot {snapshot}
      - id: entrenar
        depende: [humo]
        gpu: 1
        reintentos: 2
        espera_s: 2
        comando: python pipeline/entrenar.py --snapshot {snapshot} --champion {champion} --corrida {corrida}
"""
from __future__ import annotations

import argparse
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import HISTORIAL, MODELO, RAIZ, escribir_json, mlflow_cliente, sha256  # noqa: E402


def ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fallar(msg: str) -> None:
    sys.exit(f"✗ pipeline.yaml: {msg}")


def validar(p: dict) -> list[dict]:
    if not isinstance(p, dict) or not isinstance(p.get("pasos"), list) or not p["pasos"]:
        fallar("necesita una lista «pasos»")
    ids = [x.get("id") for x in p["pasos"]]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i for i in ids):
        fallar(f"cada paso necesita un id único (hay {ids})")
    for x in p["pasos"]:
        desconocidas = set(x) - {"id", "comando", "depende", "reintentos", "espera_s", "gpu"}
        if desconocidas:
            fallar(f"el paso {x['id']} tiene llaves que no conozco: {sorted(desconocidas)}")
        if not isinstance(x.get("comando"), str):
            fallar(f"el paso {x['id']} no tiene comando")
        for d in x.get("depende", []):
            if d not in ids:
                fallar(f"el paso {x['id']} depende de «{d}», que no existe")
    orden, hechos = [], set()
    while len(orden) < len(ids):                    # orden topológico: primero lo que no depende de nada pendiente
        listos = [x for x in p["pasos"] if x["id"] not in hechos and set(x.get("depende", [])) <= hechos]
        if not listos:
            fallar("las dependencias forman un ciclo")
        orden += listos
        hechos |= {x["id"] for x in listos}
    return orden


def resolver(parametros: dict) -> dict:
    out = {}
    for k, v in parametros.items():
        if isinstance(v, str) and v.startswith("@"):
            alias = v[1:]
            try:
                mv = mlflow_cliente().get_model_version_by_alias(MODELO, alias)
            except Exception as e:  # noqa: BLE001
                sys.exit(f"✗ no pude resolver {MODELO}@{alias} en MLflow: {str(e).splitlines()[0][:160]}")
            print(f"[orquestador] {k}: {MODELO}@{alias} → versión {mv.version} (queda fija para toda la corrida)")
            out[k] = str(mv.version)
        else:
            out[k] = str(v)
    return out


def correr(paso: dict, comando: str, apagon: float | None) -> tuple[int, str]:
    """Lanza el comando, pasa su salida con un prefijo y devuelve (código, motivo)."""
    proc = subprocess.Popen(shlex.split(comando), cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            env={**os.environ, "PYTHONUNBUFFERED": "1"}, start_new_session=True)
    muerto = threading.Event()
    if apagon:
        def matar():
            if proc.poll() is None:
                muerto.set()
                os.killpg(proc.pid, signal.SIGKILL)   # sin aviso: como un nodo que desaparece
        threading.Timer(apagon, matar).start()
    for linea in proc.stdout:
        print(f"  {paso['id']} │ {linea}", end="")
    codigo = proc.wait()
    if muerto.is_set():
        return codigo, f"se perdió el nodo a los {apagon:g} s (simulado con --apagon)"
    return codigo, "ok" if codigo == 0 else f"terminó con código {codigo}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pipeline")
    ap.add_argument("--apagon", type=float, help="segundos: se pierde el nodo del paso con gpu en su primer intento")
    ap.add_argument("--param", action="append", default=[], help="llave=valor: cambia un parámetro para esta corrida")
    a = ap.parse_args()
    ruta = (RAIZ / a.pipeline) if not Path(a.pipeline).is_absolute() else Path(a.pipeline)
    texto = ruta.read_text()
    p = yaml.safe_load(texto)
    orden = validar(p)
    parametros = dict(p.get("parametros") or {})
    for kv in a.param:
        k, _, v = kv.partition("=")
        parametros[k] = v
    corrida = f"wf-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    print(f"[orquestador] {p.get('nombre', 'pipeline')} · corrida {corrida} · {' → '.join(x['id'] for x in orden)}")
    resueltos = resolver(parametros)
    valores = {**resueltos, "corrida": corrida}
    reg = {"corrida": corrida, "pipeline": p.get("nombre"), "pipeline_sha256": sha256(texto.encode()), "inicio": ahora(),
           "parametros": parametros, "resueltos": resueltos, "apagon": a.apagon, "pasos": [], "estado": "corriendo"}
    archivo = HISTORIAL / f"{corrida}.json"
    escribir_json(archivo, reg)
    for paso in orden:
        try:
            comando = paso["comando"].format(**valores)
        except KeyError as e:
            fallar(f"el paso {paso['id']} usa {{{e.args[0]}}}, que no es un parámetro")
        intentos, max_int = [], 1 + int(paso.get("reintentos", 0))
        r = {"id": paso["id"], "comando": comando, "gpu": int(paso.get("gpu", 0)), "intentos": intentos}
        reg["pasos"].append(r)
        if r["gpu"]:
            print(f"[orquestador] {paso['id']}: pido {r['gpu']} GPU (en tu Mac, la CPU) y lanzo el contenedor")
        for n in range(1, max_int + 1):
            print(f"[orquestador] {paso['id']}: intento {n} de {max_int}")
            ini = ahora()
            t0 = time.time()
            codigo, motivo = correr(paso, comando, a.apagon if r["gpu"] and n == 1 else None)
            intentos.append({"n": n, "inicio": ini, "fin": ahora(), "segundos": round(time.time() - t0, 1), "codigo": codigo, "motivo": motivo})
            escribir_json(archivo, reg)
            if codigo == 0:
                break
            print(f"[orquestador] {paso['id']}: {motivo}" + (f"; reintento en {paso.get('espera_s', 0)} s" if n < max_int else ""))
            if n < max_int:
                time.sleep(float(paso.get("espera_s", 0)))
        r["estado"] = "ok" if intentos[-1]["codigo"] == 0 else "falló"
        if r["estado"] != "ok":
            reg.update(estado="falló", fin=ahora())
            escribir_json(archivo, reg)
            sys.exit(f"[orquestador] ✗ {corrida}: el paso {paso['id']} falló {len(intentos)} vez/veces; la corrida queda en rojo "
                     f"(historial/{corrida}.json). El modelo en producción no cambia.")
    reg.update(estado="ok", fin=ahora())
    escribir_json(archivo, reg)
    print(f"[orquestador] ✓ {corrida}: {len(orden)} pasos en verde · historial/{corrida}.json")


if __name__ == "__main__":
    main()
