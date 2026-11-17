"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python verificar.py                    # todos (≈ 20 s)
    python verificar.py examen pares       # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el mundo arriba (docker compose up -d --wait).
"""
from __future__ import annotations

import io
import json
import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CLASES, DATOS, ENTRADA, EXP_ENTRENAMIENTO, EXP_GATE, FOTOS, GATE_YAML, GOLDEN, MODELO,  # noqa: E402
                         PROVEEDOR, RAIZ, REPORTES, REVISIONES, corrida_por_nombre, corrida_yaml, gate_yaml, git,
                         golden_manifest, huella_pesos, leer_json, mlflow_arriba, mlflow_cliente, s3, sha256, tarjeta)

TUS_ARCHIVOS = ["pipeline", "gate.yaml", "corrida.yaml"]
LABELS_SHA = sha256((json.dumps(CLASES, ensure_ascii=False) + "\n").encode())
TOL = 0.011    # cuánto pueden diferir tus números de los recalculados (redondeo a 2 decimales)


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


_cache: dict = {}


def cliente():
    exige(mlflow_arriba(), "MLflow no responde en localhost:5500: docker compose ps (¿está arriba el servicio mlflow?)")
    if "ml" not in _cache:
        _cache["ml"] = mlflow_cliente()
    return _cache["ml"]


def cfg() -> dict:
    return corrida_yaml()


def carpeta(candidato: str | None = None) -> Path:
    return REPORTES / (candidato or cfg()["candidato"])


def reporte(candidato: str | None = None) -> dict:
    p = carpeta(candidato) / "reporte.json"
    exige(p.exists(), f"falta reportes/{p.parent.name}/reporte.json: corre pipeline/gate.py (paso 3)")
    return json.loads(p.read_text())


def pares(candidato: str | None = None):
    import pandas as pd

    p = carpeta(candidato) / "pares.parquet"
    exige(p.exists(), f"falta reportes/{p.parent.name}/pares.parquet: corre pipeline/evaluar.py (paso 2)")
    return pd.read_parquet(p)


def acierta(p, quien: str, k: int):
    import numpy as np

    return np.array([t in list(top)[:k] for t, top in zip(p["label_id"], p[f"{quien}_top5"])])


def pareada(nuevo, viejo) -> tuple[int, int, float, float, float]:
    b, c, n = int((nuevo & ~viejo).sum()), int((~nuevo & viejo).sum()), len(nuevo)
    d, se = (b - c) / n * 100, math.sqrt(b + c) / n * 100
    return b, c, d, se, d - 1.96 * se


def cerca(a, b) -> bool:
    return a is not None and abs(float(a) - float(b)) <= TOL


def labels_de(run_id: str) -> list:
    import mlflow

    with tempfile.TemporaryDirectory() as d:
        return json.loads(Path(mlflow.artifacts.download_artifacts(run_id=run_id, artifact_path="modelo/labels.json", dst_path=d)).read_text())


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    s = s3()
    try:
        hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    except Exception as e:  # noqa: BLE001
        raise Falla(f"el S3 local no responde en localhost:9500 ({type(e).__name__}): docker compose up -d --wait")
    exige({FOTOS, DATOS} <= hay, f"faltan buckets ({sorted({FOTOS, DATOS} - hay)}): python mundo/crear.py")
    exige(tarjeta(s, "ds-2026-09-01"), "falta el snapshot ds-2026-09-01: python mundo/crear.py")
    try:
        golden_manifest(s)
    except Exception:  # noqa: BLE001
        raise Falla(f"falta el examen {GOLDEN} en s3://{DATOS}/golden/: python mundo/crear.py")
    c = cliente()
    vs = c.search_model_versions(f"name = '{MODELO}'")
    exige(len(vs) >= 3, f"el registro tiene {len(vs)} versiones de {MODELO}; se esperan al menos 3: python mundo/crear.py")
    exige(corrida_por_nombre(c, cfg()["candidato"]) and corrida_por_nombre(c, PROVEEDOR), "faltan los candidatos de octubre: python mundo/crear.py")
    exige((ENTRADA / "categorias.json").exists() and GATE_YAML.exists(), "falta entrada/categorias.json o gate.yaml")
    exige(git("rev-parse", "--is-inside-work-tree") == "true", "esta carpeta no es un repositorio de git: git init (paso 0)")
    exige(git("rev-parse", "HEAD"), "el repositorio no tiene commits todavía: git add -A && git commit -m kit")
    ch = c.get_model_version_by_alias(MODELO, "champion").version
    return f"S3 local (fotos, ml-datos con 4 snapshots y {GOLDEN}) · MLflow: {MODELO} v1–v{len(vs)}, @champion = v{ch}, 2 candidatos · git"


def check_examen() -> str:
    s = s3()
    b, fotos = golden_manifest(s)
    congelada = gate_yaml()["examen"]["manifest_sha256"]
    exige(sha256(b) == congelada, f"el manifest de {GOLDEN} en S3 tiene sha256 {sha256(b)[:12]}… y gate.yaml congeló {congelada[:12]}…: "
                                  "alguien cambió el examen. python mundo/s3.py versiones golden/golden-v1/manifest.json")
    ev = leer_json(carpeta() / "evaluacion.json")
    exige(ev, "falta reportes/<candidato>/evaluacion.json: corre pipeline/evaluar.py (paso 2)")
    exige(ev.get("manifest_sha256") == congelada, "tu evaluación no anotó la huella del examen congelado (manifest_sha256)")
    import pandas as pd

    c = cliente()
    run = corrida_por_nombre(c, cfg()["candidato"])
    sid = run.data.tags["snapshot"]
    filas = pd.read_parquet(io.BytesIO(s.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()))
    vistas = set(filas["image_sha256"])
    fuga = sum(f["origen_sha256"] in vistas or f["image_sha256"] in vistas for f in fotos)
    exige(fuga == 0, f"{fuga} fotos del examen están en {sid}, el snapshot con que se entrenó {cfg()['candidato']}: el examen está "
                     "contaminado (fuga). Tu evaluar.py tiene que detenerse con ese candidato")
    exige(ev.get("fuga") == 0 and ev.get("candidato") == cfg()["candidato"], "tu evaluación no es del candidato de corrida.yaml, o no anotó fuga = 0")
    return f"{GOLDEN}: {len(fotos)} fotos · manifest {congelada[:12]}… = gate.yaml · 0 fotos del examen en {sid}"


def check_pares() -> str:
    import mlflow
    import numpy as np
    import torch

    from mundo.arquitectura import construir_modelo
    from mundo.gateway.preprocess import preprocess

    p, ev = pares(), leer_json(carpeta() / "evaluacion.json") or {}
    s = s3()
    _, fotos = golden_manifest(s)
    exige(len(p) == len(fotos), f"pares.parquet tiene {len(p)} filas; el examen, {len(fotos)} fotos")
    exige(p["id"].tolist() == [f["id"] for f in fotos] and p["label_id"].tolist() == [f["label_id"] for f in fotos],
          "las filas de pares.parquet no están en el orden del manifest, o sus label_id no son los del examen")
    for q in ("candidato", "champion", "hace_3_meses"):
        exige(f"{q}_top5" in p and f"{q}_conf" in p, f"a pares.parquet le falta {q}_top5 o {q}_conf")
    exige(str(ev.get("champion_version")) == str(cfg()["champion"]) and str(ev.get("hace_3_meses_version")) == str(cfg()["hace_3_meses"]),
          f"evaluacion.json dice champion v{ev.get('champion_version')} y hace 3 meses v{ev.get('hace_3_meses_version')}; corrida.yaml, "
          f"v{cfg()['champion']} y v{cfg()['hace_3_meses']}")
    c = cliente()
    mv = c.get_model_version(MODELO, str(cfg()["champion"]))
    with tempfile.TemporaryDirectory() as d:
        pesos = torch.load(mlflow.artifacts.download_artifacts(run_id=mv.run_id, artifact_path="modelo/pesos.pt", dst_path=d),
                           map_location="cpu", weights_only=True)
    exige(ev.get("pesos_sha256", {}).get("champion") == huella_pesos(pesos) == mv.tags.get("pesos_sha256"),
          "la huella de los pesos del champion en evaluacion.json no es la de la versión del registro")
    m = construir_modelo(len(CLASES))
    m.load_state_dict(pesos)
    m.eval()
    muestra = list(range(0, len(fotos), 50))   # 20 fotos: ¿tus predicciones del champion son las de verdad?
    x = torch.from_numpy(np.stack([preprocess(s.get_object(Bucket=DATOS, Key=fotos[i]["image_key"])["Body"].read()) for i in muestra]))
    with torch.no_grad():
        top5 = np.argsort(-torch.softmax(m(x), 1).numpy(), 1, kind="stable")[:, :5]
    malas = [fotos[i]["id"] for i, t in zip(muestra, top5) if list(p["champion_top5"][i]) != t.tolist()]
    exige(not malas, f"{len(malas)} de 20 fotos tienen otro top-5 del champion que el recalculado (por ejemplo {malas[0] if malas else ''}): "
                     "¿el preprocess del gateway? ¿model.eval()?")
    t1 = {q: acierta(p, q, 1).mean() * 100 for q in ("candidato", "champion", "hace_3_meses")}
    return (f"{len(p)} pares · top-1 en {GOLDEN}: candidato {t1['candidato']:.1f} %, champion v{cfg()['champion']} {t1['champion']:.1f} %, "
            f"hace 3 meses v{cfg()['hace_3_meses']} {t1['hace_3_meses']:.1f} % · 20/20 predicciones del champion recalculadas iguales")


def check_labels() -> str:
    c = cliente()
    malas = []
    for mv in c.search_model_versions(f"name = '{MODELO}'"):
        if labels_de(mv.run_id) != CLASES:
            malas.append(f"v{mv.version}")
    run = corrida_por_nombre(c, cfg()["candidato"])
    if labels_de(run.info.run_id) != CLASES:
        malas.append(cfg()["candidato"])
    exige(not malas, f"el labels.json de {', '.join(malas)} no es entrada/categorias.json: la salida 0 dejaría de ser «{CLASES[0]}». "
                     "python mundo/modelos.py versiones")
    return f"el labels.json de las {len(c.search_model_versions(f'name = {chr(39)}{MODELO}{chr(39)}'))} versiones y del candidato = entrada/categorias.json (sha {LABELS_SHA[:12]}…)"


def check_no_inferioridad() -> str:
    p, r, g = pares(), reporte(), gate_yaml()
    m = g["top1_top5"]["margen_puntos"]
    salida = []
    for ref in g["comparar_contra"]:
        for k in (1, 5):
            b, c, d, se, dmin = pareada(acierta(p, "candidato", k), acierta(p, ref, k))
            x = (r.get("no_inferioridad") or {}).get(f"{ref}_top{k}")
            exige(x, f"reporte.json no tiene no_inferioridad.{ref}_top{k}")
            exige(x.get("b") == b and x.get("c") == c, f"{ref} top-{k}: b = {x.get('b')}, c = {x.get('c')}; de los pares salen b = {b}, c = {c}")
            exige(cerca(x.get("delta_min"), dmin), f"{ref} top-{k}: Δmin = {x.get('delta_min')}; sale {dmin:.2f} (Δ − 1.96 × SE, en puntos)")
            exige(x.get("pasa") == (dmin >= -m), f"{ref} top-{k}: con Δmin {dmin:.2f} y margen {m}, «pasa» es {dmin >= -m}")
            if k == 1:
                salida.append(f"vs {ref}: b {b} · c {c} · Δmin {dmin:+.2f}")
    return " · ".join(salida) + f" (margen −{m}, top-5 también)"


def check_categorias() -> str:
    p, r, g = pares(), reporte(), gate_yaml()
    nuevo, viejo = acierta(p, "candidato", 1), acierta(p, "champion", 1)
    cats = {x.get("categoria"): x for x in r.get("categorias") or []}
    exige(set(cats) == set(CLASES), f"reporte.json tiene {len(cats)} categorías; se esperan las {len(CLASES)}")
    ps = []
    for i, nombre in enumerate(CLASES):
        s = p["label_id"].to_numpy() == i
        b, c = int((nuevo & ~viejo & s).sum()), int((~nuevo & viejo & s).sum())
        n = b + c
        pv = 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, j) for j in range(min(b, c) + 1)) / 2 ** n)
        caida = (viejo[s].mean() - nuevo[s].mean()) * 100
        x = cats[nombre]
        exige(x.get("b") == b and x.get("c") == c, f"{nombre}: b = {x.get('b')}, c = {x.get('c')}; salen b = {b}, c = {c} (solo esa categoría)")
        exige(cerca(x.get("caida"), caida), f"{nombre}: caída = {x.get('caida')}; sale {caida:.2f} puntos (recall del champion − del candidato)")
        exige(x.get("p") is not None and abs(x["p"] - pv) < 1e-6, f"{nombre}: p = {x.get('p')}; McNemar exacto da {pv:.6g}")
        ps.append((pv, nombre, caida))
    holm, maximo = {}, 0.0
    for rango, (pv, nombre, _) in enumerate(sorted(ps)):
        maximo = max(maximo, min(1.0, pv * (len(ps) - rango)))
        holm[nombre] = maximo
    rotas = []
    for pv, nombre, caida in ps:
        exige(abs(cats[nombre].get("p_holm", -1) - holm[nombre]) < 1e-6, f"{nombre}: p_holm = {cats[nombre].get('p_holm')}; Holm da {holm[nombre]:.6g}")
        rota = caida > g["categorias"]["caida_max_puntos"] and holm[nombre] < g["categorias"]["alfa"]
        exige(cats[nombre].get("rota") == rota, f"{nombre}: «rota» es {rota} (caída {caida:.1f} > {g['categorias']['caida_max_puntos']} y p de Holm < {g['categorias']['alfa']})")
        rotas += [nombre] if rota else []
    peor = max(ps, key=lambda x: x[2])
    return f"10 categorías con McNemar + Holm · la que más cae: {peor[1]} ({peor[2]:+.1f} puntos, p de Holm {holm[peor[1]]:.2g}) · rotas: {rotas or 'ninguna'}"


def check_slices() -> str:
    import numpy as np

    p, r, g = pares(), reporte(), gate_yaml()
    nuevo, viejo = acierta(p, "candidato", 1), acierta(p, "champion", 1)
    out = []
    for nombre in g["slices"]["nombres"]:
        s = (p["slice"] == nombre).to_numpy()
        b, c, d, se, dmin = pareada(nuevo[s], viejo[s])
        x = (r.get("slices") or {}).get(nombre)
        exige(x and cerca(x.get("delta_min"), dmin), f"slice {nombre}: Δmin = {(x or {}).get('delta_min')}; sale {dmin:.2f}")
        out.append(f"{nombre} {dmin:+.2f}")
    conf = p["candidato_conf"].to_numpy()
    cub = np.minimum((conf * 15).astype(int), 14)
    ece = sum((cub == k).sum() / len(p) * abs(nuevo[cub == k].mean() - conf[cub == k].mean()) for k in range(15) if (cub == k).any())
    exige(cerca(r.get("ece"), ece), f"ECE = {r.get('ece')}; con 15 cubetas de confianza sale {ece:.4f}")
    return f"Δmin por slice: {', '.join(out)} (margen −{g['slices']['margen_puntos']}) · ECE {ece:.4f} ≤ {g['ece_max']}"


def check_frena() -> str:
    c = cliente()
    exp = c.get_experiment_by_name(EXP_GATE)
    exige(exp, "todavía no hay corridas de gate en MLflow (experimento c01-gate)")
    rs = c.search_runs([exp.experiment_id], filter_string=f"tags.candidato = '{PROVEEDOR}'", max_results=1, order_by=["attributes.start_time DESC"])
    exige(rs, f"no hay un gate de {PROVEEDOR} (paso 4: evalúalo y pásalo por el gate)")
    x = rs[0]
    exige(x.data.tags.get("veredicto") == "no_pasa", f"el gate de {PROVEEDOR} dio «{x.data.tags.get('veredicto')}»: tiene una categoría rota")
    exige(x.info.status == "FAILED", f"el gate de {PROVEEDOR} no pasó, pero su corrida quedó {x.info.status}: el gate tiene que fallar "
                                     "(código de salida 1, corrida FAILED), no «devolver false» y dejar seguir")
    exige("camisas" in x.data.tags.get("motivo", ""), "el motivo del gate no nombra la categoría rota")
    vs = [mv for mv in c.search_model_versions(f"name = '{MODELO}'")
          if mv.run_id == corrida_por_nombre(c, PROVEEDOR).info.run_id and mv.tags.get("gate") == "passed"]
    exige(not vs, f"{PROVEEDOR} quedó registrado con gate=passed (v{vs[0].version if vs else ''}) aunque no pasó el gate")
    return f"{PROVEEDOR}: FAILED · {x.data.tags.get('motivo', '')[:160]} · ninguna versión suya dice gate=passed"


def check_umbrales() -> str:
    g_sha = sha256(GATE_YAML.read_bytes())
    ok = {r["gate_yaml_sha256"]: r for r in json.loads(REVISIONES.read_text())["aprobadas"]}
    exige(g_sha in ok, f"gate.yaml ({g_sha[:12]}…) no es ninguna versión revisada (mundo/revisiones.json): git log -p gate.yaml")
    sucio = git("status", "--porcelain", "--", *TUS_ARCHIVOS)
    exige(not sucio, f"hay cambios sin commit ({(sucio.splitlines() or [''])[0].strip()}): git diff")
    c = cliente()
    exp = c.get_experiment_by_name(EXP_GATE)
    exige(exp, "todavía no hay corridas de gate en MLflow (experimento c01-gate)")
    vistos, malos = set(), []
    for r in c.search_runs([exp.experiment_id], max_results=200, order_by=["attributes.start_time DESC"]):
        cand = r.data.tags.get("candidato")
        if cand in vistos:
            continue
        vistos.add(cand)
        if r.data.tags.get("gate_yaml_sha256") not in ok:
            malos.append(cand)
    exige(not malos, f"el último gate de {malos} se tomó con un gate.yaml que nadie revisó")
    pr = ok[g_sha]
    return f"gate.yaml = la revisión del PR #{pr['pr']} ({pr['fecha']}) · sin cambios pendientes · {len(vistos)} gate(s), todos con reglas revisadas"


def check_registro() -> str:
    c = cliente()
    aliases = c.get_registered_model(MODELO).aliases
    exige("challenger" in aliases, f"no hay {MODELO}@challenger: corre pipeline/registrar.py (paso 6)")
    exige(str(aliases.get("champion")) == str(cfg()["champion"]),
          f"{MODELO}@champion = v{aliases.get('champion')}, y la corrida de esta noche es contra v{cfg()['champion']}: ¿quién lo movió? "
          "python mundo/modelos.py versiones")
    for alias, v in aliases.items():
        mv = c.get_model_version(MODELO, str(v))
        exige(mv.tags.get("gate") == "passed", f"{MODELO}@{alias} = v{v}, y esa versión no tiene gate=passed: nadie la aprobó")
    mv = c.get_model_version(MODELO, str(aliases["challenger"]))
    run = corrida_por_nombre(c, cfg()["candidato"])
    exige(mv.run_id == run.info.run_id, f"@challenger = v{mv.version}, que no es {cfg()['candidato']}")
    faltan = [k for k in ("gate_run_id", "snapshot", "pesos_sha256", "labels_sha256", "examen", "champion_version") if k not in mv.tags]
    exige(not faltan, f"a v{mv.version} le faltan los tags {faltan}")
    gr = c.get_run(mv.tags["gate_run_id"])
    exige(gr.info.status == "FINISHED" and gr.data.tags.get("veredicto") == "pasa", f"el gate {mv.tags['gate_run_id'][:8]} de v{mv.version} no pasó")
    exige(mv.tags["labels_sha256"] == LABELS_SHA and labels_de(mv.run_id) == CLASES,
          f"v{mv.version}: su labels_sha256 o su labels.json no es el de entrada/categorias.json")
    exige(mv.tags["pesos_sha256"] == run.data.tags.get("pesos_sha256"), f"v{mv.version}: pesos_sha256 no es el de su corrida")
    return (f"@champion = v{aliases['champion']} · @challenger = v{mv.version} ({cfg()['candidato']}, gate {mv.tags['gate_run_id'][:8]} "
            f"contra v{mv.tags['champion_version']}) · labels {mv.tags['labels_sha256'][:8]}… · todo alias apunta a una versión con gate=passed")


CHECKS = {
    "mundo": check_mundo, "examen": check_examen, "pares": check_pares, "labels": check_labels,
    "no-inferioridad": check_no_inferioridad, "categorias": check_categorias, "slices": check_slices,
    "frena": check_frena, "umbrales": check_umbrales, "registro": check_registro,
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
            print(f"{'✓' if ok else '✗'} {i:<16} {msg}", flush=True)
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
