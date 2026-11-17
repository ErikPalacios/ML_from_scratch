"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python verificar.py                    # todos (≈ 30 s: corre tu prueba de humo dos veces)
    python verificar.py datos humo         # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el mundo arriba (docker compose up -d --wait).
"""
from __future__ import annotations

import importlib
import io
import json
import math
import re
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CKPT, CLASES, DATOS, ENTRADA, EXPERIMENTO, FOTOS, GATEWAY, HISTORIAL, MODELO, PADRE,  # noqa: E402
                         PIPELINE, RAIZ, SNAPSHOT, corridas, filas, gateway_pillow, git, huella_pesos, leer_json,
                         mlflow_arriba, mlflow_cliente, receta, s3, sha256, tarjeta)

TUS_ARCHIVOS = ["pipeline", "receta.yaml", "pipeline.yaml"]
PARAMS_RECETA = ["arranque", "epocas", "batch", "lr", "weight_decay", "semilla", "voltear", "ckpt_cada_pasos", "amp"]
PARAMS = PARAMS_RECETA + ["snapshot", "champion_version", "corrida"]
TAGS = ["corrida", "snapshot", "rows_sha256", "commit", "arbol_limpio", "entorno_sha256", "preprocess_sha256", "pillow",
        "champion_version", "receta_sha256", "reanudado_desde_paso", "pesos_sha256"]
MISMA_RECETA = ["rows_sha256", "receta_sha256", "champion_version", "entorno_sha256"]
CLAVES_CKPT = ["modelo", "optimizador", "programador", "generador", "rng", "epoca", "paso", "ingredientes"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


_cache: dict = {}


def tus_datos():
    """Tu cargar() de pipeline/datos.py sobre ds-2026-09-01 (una sola vez por corrida de verificar.py)."""
    if "datos" not in _cache:
        exige((RAIZ / "pipeline" / "datos.py").exists(), "falta pipeline/datos.py")
        sys.path.insert(0, str(RAIZ / "pipeline"))
        try:
            mod = importlib.import_module("datos")
            _cache["mod"] = mod
            _cache["datos"] = mod.cargar(SNAPSHOT)
        except NotImplementedError:
            raise Falla("pipeline/datos.py todavía no está escrito (paso 1)")
        except SystemExit as e:
            raise Falla(f"cargar('{SNAPSHOT}') se detuvo: {e}")
    return _cache["datos"]


def cliente():
    exige(mlflow_arriba(), "MLflow no responde en localhost:5400: docker compose ps (¿está arriba el servicio mlflow?)")
    if "ml" not in _cache:
        _cache["ml"] = mlflow_cliente()
    return _cache["ml"]


def tuyas():
    rs = corridas(cliente())
    exige(rs, "no hay corridas tuyas terminadas en MLflow (experimento c01-entrenamiento): corre pipeline/entrenar.py (paso 3)")
    return rs


def total_pasos(r: dict) -> int:
    n = tarjeta(s3(), SNAPSHOT)["counts"]["train"]
    return math.ceil(n / r["batch"]) * r["epocas"]


def py(*args: str, timeout: float = 300) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=RAIZ, capture_output=True, text=True, timeout=timeout)


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    s = s3()
    try:
        hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    except Exception as e:  # noqa: BLE001
        raise Falla(f"el S3 local no responde en localhost:9400 ({type(e).__name__}): docker compose up -d --wait")
    exige({FOTOS, DATOS, CKPT} <= hay, f"faltan buckets ({sorted({FOTOS, DATOS, CKPT} - hay)}): python mundo/crear.py")
    for sid in (PADRE, SNAPSHOT):
        exige(tarjeta(s, sid), f"falta el snapshot {sid} en s3://{DATOS}/datasets/: python mundo/crear.py")
    c = cliente()
    try:
        mv = c.get_model_version_by_alias(MODELO, "champion")
    except Exception:  # noqa: BLE001
        raise Falla(f"no hay {MODELO}@champion en MLflow: python mundo/crear.py")
    exige((ENTRADA / "categorias.json").exists() and (GATEWAY / "paridad.json").exists(), "falta entrada/ o mundo/gateway/paridad.json: python mundo/crear.py")
    exige(git("rev-parse", "--is-inside-work-tree") == "true", "esta carpeta no es un repositorio de git: git init (paso 0)")
    exige(git("rev-parse", "HEAD"), "el repositorio no tiene commits todavía: git add -A && git commit -m kit")
    r = py("-c", "import torch; print(torch.__version__)", timeout=120)
    exige(r.returncode == 0, "no puedo importar torch: activa el entorno (source .venv/bin/activate) e instala requirements.txt")
    return (f"S3 local (fotos, ml-datos con {PADRE} y {SNAPSHOT}, ml-ckpt) · MLflow con {MODELO}@champion = v{mv.version} · "
            f"git · torch {r.stdout.strip()}")


def check_datos() -> str:
    train, val, t = tus_datos()
    f = filas(s3(), SNAPSHOT)
    for nombre, d in (("train", train), ("val", val)):
        ref = f[f["split"] == nombre]
        exige(len(d) == len(ref), f"{nombre}: {len(d)} fotos; el snapshot tiene {len(ref)}")
        exige(d.shas == ref["image_sha256"].tolist(), f"{nombre}: las huellas no están en el orden de rows.parquet")
        exige(d.y.tolist() == ref["label_id"].tolist(), f"{nombre}: los labels no corresponden a sus fotos")
        exige(tuple(d.x.shape) == (len(ref), 3, 32, 32) and str(d.x.dtype) == "torch.float32",
              f"{nombre}: x es {tuple(d.x.shape)} {d.x.dtype}; el contrato pide [N, 3, 32, 32] float32")
    exige(t.get("rows_sha256") == tarjeta(s3(), SNAPSHOT)["rows_sha256"], "cargar() no devolvió la tarjeta del snapshot")
    try:
        _cache["mod"].cargar("latest")
        raise Falla("cargar('latest') no se detuvo: se entrena con un id fijo")
    except (SystemExit, Exception) as e:  # noqa: BLE001
        if isinstance(e, Falla):
            raise
    return f"{SNAPSHOT}: train {len(train)} · val {len(val)} · en el orden de rows.parquet · cargar('latest') se detiene"


def check_paridad() -> str:
    from importlib.metadata import version

    instalada = version("pillow")      # la instalada en disco (romper.py puede reinstalarla a media corrida)
    train, val, _ = tus_datos()
    todas = {h: x for d in (train, val) for h, x in zip(d.shas, d.x)}
    ref = json.loads((GATEWAY / "paridad.json").read_text())["fotos"]
    distintas = [r["image_key"] for r in ref if sha256(todas[r["image_sha256"]].numpy().tobytes()) != r["tensor_sha256"]]
    exige(not distintas, f"{len(distintas)} de {len(ref)} fotos salen distintas que en el gateway (por ejemplo {(distintas or ['?'])[0]}): "
                         "¿tu datos.py usa el preprocess de mundo/gateway/preprocess.py?")
    pin = gateway_pillow()
    exige(instalada == pin, f"Pillow {instalada} en tu entorno de entrenamiento y {pin} en el gateway "
                                  "(mundo/gateway/requirements.txt): la misma foto se podría decodificar distinto")
    return f"{len(ref)}/{len(ref)} tensores idénticos a los del gateway · Pillow {instalada} en los dos"


def check_humo() -> str:
    exige((RAIZ / "pipeline" / "humo.py").exists(), "falta pipeline/humo.py")
    ok = py("pipeline/humo.py", "--snapshot", SNAPSHOT)
    ultima = (ok.stdout.strip().splitlines() or [""])[-1]
    exige(ok.returncode == 0, f"la prueba de humo no pasa con la receta: {(ok.stdout + ok.stderr).strip()[-300:]}")
    cero = py("pipeline/humo.py", "--snapshot", SNAPSHOT, "--lr", "0")
    exige(cero.returncode != 0, "con --lr 0 la prueba de humo también pasa: así no atrapa un optimizador que no mueve los pesos")
    return f"{ultima} · con --lr 0 falla, como debe"


def check_mlflow() -> str:
    c = cliente()
    r = tuyas()[0]
    faltan = [p for p in PARAMS if p not in r.data.params]
    exige(not faltan, f"la corrida {r.info.run_name} no anotó los parámetros {faltan}")
    epocas = int(r.data.params["epocas"])
    pasos = sorted(m.step for m in c.get_metric_history(r.info.run_id, "val_top1"))
    exige(pasos == list(range(epocas)), f"val_top1 tiene los pasos {pasos}; con {epocas} épocas se espera uno por época, de 0 a {epocas - 1}")
    for m in ("train_loss", "val_loss"):
        exige(len(c.get_metric_history(r.info.run_id, m)) == epocas, f"falta la métrica {m} por época")
    arts = {a.path for a in c.list_artifacts(r.info.run_id, "modelo")}
    exige({"modelo/pesos.pt", "modelo/labels.json"} <= arts, f"faltan artefactos: modelo/pesos.pt y modelo/labels.json (hay {sorted(arts)})")
    curva = [round(m.value, 4) for m in sorted(c.get_metric_history(r.info.run_id, "val_top1"), key=lambda m: m.step)]
    return f"{len(tuyas())} corrida(s) terminada(s) · la última, {r.data.tags.get('corrida')}: val_top1 por época {curva} · pesos y labels guardados"


def check_punteros() -> str:
    import mlflow

    r = tuyas()[0]
    t = r.data.tags
    faltan = [k for k in TAGS if k not in t]
    exige(not faltan, f"la corrida {t.get('corrida')} no tiene los tags {faltan}")
    card = tarjeta(s3(), t["snapshot"])
    exige(card and card["rows_sha256"] == t["rows_sha256"], f"rows_sha256 de la corrida no es el de la tarjeta de {t['snapshot']}")
    exige(git("cat-file", "-t", t["commit"]) == "commit", f"el commit {t['commit'][:7]} no está en este repositorio")
    exige(re.fullmatch(r"[0-9a-f]{64}", t["entorno_sha256"]), "entorno_sha256 no es una huella sha256")
    exige(t["preprocess_sha256"] == sha256((GATEWAY / "preprocess.py").read_bytes()), "preprocess_sha256 no es la huella de mundo/gateway/preprocess.py")
    with tempfile.TemporaryDirectory() as d:
        import torch

        p = mlflow.artifacts.download_artifacts(run_id=r.info.run_id, artifact_path="modelo/pesos.pt", dst_path=d)
        h = huella_pesos(torch.load(p, map_location="cpu", weights_only=True))
    exige(h == t["pesos_sha256"], "pesos_sha256 no es la huella de modelo/pesos.pt")
    return (f"{t['corrida']}: {t['snapshot']} ({t['rows_sha256'][:8]}…) · commit {t['commit'][:7]} · entorno {t['entorno_sha256'][:8]}… · "
            f"preprocess {t['preprocess_sha256'][:8]}… · Pillow {t['pillow']} · champion v{t['champion_version']} · pesos {h[:8]}…")


def check_limpio() -> str:
    sucio = git("status", "--porcelain", "--", *TUS_ARCHIVOS)
    exige(not sucio, f"hay cambios sin commit en tu código o tu receta ({(sucio.splitlines() or [''])[0].strip()}): una corrida desde aquí "
                     "no podría decir con qué se entrenó. git diff para verlos")
    malas = [r.data.tags.get("corrida") for r in tuyas() if r.data.tags.get("arbol_limpio") != "true"
             or git("cat-file", "-t", r.data.tags.get("commit", "x")) != "commit"]
    exige(not malas, f"corridas sin árbol limpio o con un commit que no está en el repositorio: {malas[:3]}")
    return f"pipeline/, receta.yaml y pipeline.yaml sin cambios pendientes · {len(tuyas())} corrida(s), todas desde un commit limpio"


def check_champion() -> str:
    import mlflow

    c = cliente()
    mv = c.get_model_version_by_alias(MODELO, "champion")
    with tempfile.TemporaryDirectory() as d:
        labels = json.loads((Path(mlflow.artifacts.download_artifacts(artifact_uri=mv.source, dst_path=d)) / "labels.json").read_text())
    exige(labels == CLASES, f"{MODELO}@champion = v{mv.version}, y su labels.json trae las categorías en otro orden "
                            f"({labels[:3]}…): arrancar de ahí le enseñaría a la red otras clases")
    rs = [r for r in tuyas() if r.data.params.get("arranque") == "champion"]
    exige(rs, "ninguna corrida arrancó del champion (arranque: champion en la receta)")
    r = rs[0]
    exige(re.fullmatch(r"\d+", r.data.params.get("champion_version", "")), "champion_version tiene que ser un número de versión, no un alias")
    v = c.get_model_version(MODELO, r.data.params["champion_version"])
    run_ch = c.get_run(v.run_id)
    return (f"{MODELO}@champion = v{mv.version} con las {len(CLASES)} categorías en orden · {r.data.tags.get('corrida')} arrancó de "
            f"v{v.version} ({run_ch.data.metrics.get('val_top1', 0):.4f}) y llegó a {r.data.metrics.get('val_top1', 0):.4f}")


def check_checkpoints() -> str:
    import torch

    s = s3()
    vigente = sha256(git("show", "HEAD:receta.yaml").encode() + b"\n")   # la receta del último commit
    rs = tuyas()
    total = total_pasos(receta())
    sanas = [x for x in rs if int(x.data.params.get("ckpt_cada_pasos", 0) or 0) <= total * 0.2]   # las que sí guardan
    r = next((x for x in rs if x.data.tags.get("receta_sha256") == vigente), (sanas or rs)[0])   # la más nueva con la receta de hoy
    llave = f"c01/{r.data.tags['snapshot']}/{r.data.tags['corrida']}/ultimo.pt"
    try:
        b = s.get_object(Bucket=CKPT, Key=llave)["Body"].read()
    except s.exceptions.NoSuchKey:
        raise Falla(f"no hay checkpoint de {r.data.tags['corrida']} en s3://{CKPT}/{llave}")
    ck = torch.load(io.BytesIO(b), map_location="cpu", weights_only=True)
    faltan = [k for k in CLAVES_CKPT if k not in ck]
    exige(not faltan, f"al checkpoint le falta {faltan}: sin eso, reanudar no es seguir la misma corrida")
    estados = list(ck["optimizador"]["state"].values())
    exige(estados and {"exp_avg", "exp_avg_sq"} <= set(estados[0]), "el checkpoint no trae los dos promedios de Adam (exp_avg, exp_avg_sq)")
    pesos = sum(t.numel() * t.element_size() for t in ck["modelo"].values())
    return f"s3://{CKPT}/{llave}: {len(b) / 1e3:.0f} kB (pesos {pesos / 1e3:.0f} kB + Adam + azar) · paso {ck['paso']} · época {ck['epoca']}"


def check_reanudar() -> str:
    r = receta()
    total = total_pasos(r)
    exige(r["ckpt_cada_pasos"] <= total * 0.2, f"receta.yaml: ckpt_cada_pasos = {r['ckpt_cada_pasos']} con {total} pasos por corrida: "
                                               "una caída a media corrida perdería más del 20 % (o todo)")
    rs = tuyas()
    re_ = [x for x in rs if int(x.data.tags.get("reanudado_desde_paso", 0) or 0) > 0]
    exige(re_, "ninguna corrida terminada se reanudó de un checkpoint (paso 5: mátala a media corrida y vuelve a lanzarla con el mismo --corrida)")
    for x in re_:
        llave = [x.data.tags.get(k) for k in MISMA_RECETA] + [x.data.params.get("semilla")]
        gemela = [y for y in rs if int(y.data.tags.get("reanudado_desde_paso", 0) or 0) == 0
                  and [y.data.tags.get(k) for k in MISMA_RECETA] + [y.data.params.get("semilla")] == llave]
        if not gemela:
            continue
        exige(gemela[0].data.tags.get("pesos_sha256") == x.data.tags.get("pesos_sha256"),
              f"{x.data.tags['corrida']} (reanudada) y {gemela[0].data.tags['corrida']} (sin caída) tienen los mismos ingredientes y "
              "pesos distintos: al reanudar falta algo del estado")
        return (f"{x.data.tags['corrida']} se reanudó en el paso {x.data.tags['reanudado_desde_paso']} y terminó con los mismos pesos que "
                f"{gemela[0].data.tags['corrida']}, sin caída ({x.data.tags['pesos_sha256'][:12]}…) · checkpoint cada {r['ckpt_cada_pasos']} de {total} pasos")
    raise Falla("hay corridas reanudadas, pero ninguna tiene una gemela sin caída (mismos ingredientes y semilla) para comparar los pesos")


def check_pipeline() -> str:
    import yaml

    exige(PIPELINE.exists(), "falta pipeline.yaml (paso 6)")
    p = yaml.safe_load(PIPELINE.read_text()) or {}
    pasos = {x.get("id"): x for x in p.get("pasos", []) if isinstance(x, dict)}
    exige({"humo", "entrenar"} <= set(pasos), f"pipeline.yaml necesita los pasos humo y entrenar (tiene {sorted(pasos)})")
    e = pasos["entrenar"]
    exige("humo" in (e.get("depende") or []), "entrenar tiene que depender de humo: si el código está roto, no se pide la GPU")
    exige(int(e.get("gpu", 0)) >= 1, "entrenar pide gpu: 1")
    exige(int(e.get("reintentos", 0)) >= 1, "entrenar necesita reintentos: un nodo perdido no puede tirar la corrida")
    exige("{corrida}" in e.get("comando", "") and "{champion}" in e.get("comando", ""), "el comando de entrenar pasa {champion} y {corrida}")
    exige(str((p.get("parametros") or {}).get("champion", "")).startswith("@"), "el parámetro champion es el alias (\"@champion\"): lo resuelve el orquestador")
    regs = sorted((leer_json(f) for f in HISTORIAL.glob("wf-*.json")), key=lambda x: x["inicio"], reverse=True)
    exige(regs, "no hay corridas del orquestador en historial/: python mundo/orquestador.py pipeline.yaml --apagon 15")
    motivo = "ninguna corrida del orquestador sobrevivió a un apagón: python mundo/orquestador.py pipeline.yaml --apagon 15"
    for reg in regs:                                   # basta una corrida buena; de la más nueva sale el mensaje si no hay
        ent = next((x for x in reg["pasos"] if x["id"] == "entrenar"), None)
        if reg["estado"] != "ok" or not ent or len(ent["intentos"]) < 2 or "nodo" not in ent["intentos"][0]["motivo"]:
            continue
        r = [x for x in tuyas() if x.data.tags.get("corrida") == reg["corrida"]]
        desde = int(r[0].data.tags.get("reanudado_desde_paso") or 0) if r else 0
        if not re.fullmatch(r"\d+", reg["resueltos"].get("champion", "")) or not r or desde == 0:
            if motivo.startswith("ninguna"):
                motivo = (f"{reg['corrida']}: el orquestador no resolvió el champion a un número" if not re.fullmatch(r"\d+", reg["resueltos"].get("champion", ""))
                          else f"{reg['corrida']}: no terminó en MLflow" if not r
                          else f"{reg['corrida']}: el reintento empezó de cero (reanudado_desde_paso = 0): ¿hay checkpoints? ¿el reintento usa el mismo --corrida?")
            continue
        return (f"{reg['corrida']}: humo → entrenar · @champion → v{reg['resueltos']['champion']} · se perdió el nodo, "
                f"{len(ent['intentos'])} intentos, reanudó en el paso {desde} · val_top1 {r[0].data.metrics.get('val_top1', 0):.4f}")
    raise Falla(motivo)


def check_ruido() -> str:
    exige((RAIZ / "pipeline" / "comparar.py").exists(), "falta pipeline/comparar.py (paso 7)")
    grupos: dict = {}
    for x in tuyas():
        grupos.setdefault(tuple(x.data.tags.get(k) for k in MISMA_RECETA), []).append(x)
    mejor = max(grupos.values(), key=lambda g: len({x.data.params["semilla"] for x in g}))
    semillas: dict = {}
    for x in sorted(mejor, key=lambda x: x.info.start_time):
        semillas.setdefault(x.data.params["semilla"], x)
    exige(len(semillas) >= 5, f"con la misma receta hay {len(semillas)} semilla(s) distinta(s): mide el ruido con al menos 5")
    a, b = list(semillas.values())[:2]
    out = py("pipeline/comparar.py", a.data.tags["corrida"], b.data.tags["corrida"], "--json", timeout=120)
    exige(out.returncode == 0, f"comparar.py falló: {(out.stderr or out.stdout).strip()[-200:]}")
    try:
        j = json.loads(out.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        raise Falla("comparar.py --json no imprimió un JSON en su última línea")
    vals = [x.data.metrics["val_top1"] * 100 for x in semillas.values()]
    sigma = statistics.stdev(vals)
    delta = (b.data.metrics["val_top1"] - a.data.metrics["val_top1"]) * 100
    exige(abs(j.get("sigma", -1) - sigma) < 1e-3, f"σ = {j.get('sigma')}; con {len(vals)} semillas sale {sigma:.4f} (desviación estándar con n − 1, en puntos)")
    exige(abs(j.get("delta", 99) - delta) < 1e-3, f"Δ = {j.get('delta')}; sale {delta:.4f} puntos (B − A)")
    exige(abs(j.get("tau", -1) - 3 * sigma) < 1e-3, "τ tiene que ser 3σ")
    esperado = "ruido" if abs(delta) <= 3 * sigma else "revisar"
    exige(j.get("veredicto") == esperado, f"el veredicto es «{j.get('veredicto')}»; con |Δ| = {abs(delta):.2f} y τ = {3 * sigma:.2f} es «{esperado}»")
    return f"{len(vals)} semillas: {', '.join(f'{v:.2f}' for v in vals)} % · σ = {sigma:.2f} · τ = {3 * sigma:.2f} · {a.data.tags['corrida']} vs {b.data.tags['corrida']}: Δ = {delta:+.2f} → {esperado}"


CHECKS = {
    "mundo": check_mundo, "datos": check_datos, "paridad": check_paridad, "humo": check_humo, "mlflow": check_mlflow,
    "punteros": check_punteros, "limpio": check_limpio, "champion": check_champion, "checkpoints": check_checkpoints,
    "reanudar": check_reanudar, "pipeline": check_pipeline, "ruido": check_ruido,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<12} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
