"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python verificar.py                    # todos (≈ 20 s)
    python verificar.py export engine      # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el mundo arriba (docker compose up -d --wait).
"""
from __future__ import annotations

import io
import json
import platform
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (ARTEFACTOS, CALIBRACION, CKPT, CLASES, DATOS, ENGINE_YAML, GOLDEN, MODELO, REVISIONES,  # noqa: E402
                         artefacto, contrato, corrida_yaml, engine_yaml, git, golden_manifest, golden_tensores,
                         huella_pesos, leer_json, mlflow_arriba, mlflow_cliente, runtime_servidor, s3, sha256, sha_archivo)

TUS_ARCHIVOS = ["pipeline", "engine.yaml", "corrida.yaml", "mundo/servidor"]
TOL = 1e-6


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


_cache: dict = {}


def cliente():
    exige(mlflow_arriba(), "MLflow no responde en localhost:5600: docker compose ps (¿está arriba el servicio mlflow?)")
    if "ml" not in _cache:
        _cache["ml"] = mlflow_cliente()
    return _cache["ml"]


def cfg() -> dict:
    return corrida_yaml()


def dir_(prueba: str | None = None) -> Path:
    return ARTEFACTOS / (f"v{cfg()['challenger']}" + (f"-{prueba}" if prueba else ""))


def reporte(nombre: str, prueba: str | None = None, paso: str = "") -> dict:
    p = dir_(prueba) / f"{nombre}.json"
    exige(p.exists(), f"falta artefactos/{p.parent.name}/{nombre}.json: corre {paso}")
    return json.loads(p.read_text())


def modelo_ref():
    """PyTorch FP32 en eval() con los pesos del challenger, y las fotos del examen (las dos cosas, una sola vez)."""
    if "ref" not in _cache:
        import torch

        from mundo.arquitectura import construir_modelo

        mv = cliente().get_model_version(MODELO, str(cfg()["challenger"]))
        pesos = torch.load(io.BytesIO(artefacto(mv.run_id, "modelo/pesos.pt")), map_location="cpu", weights_only=True)
        m = construir_modelo(len(CLASES))
        m.load_state_dict(pesos)
        m.eval()
        _, fotos = golden_manifest(s3())
        x = golden_tensores(s3(), fotos)
        with torch.no_grad():
            _cache["ref"] = (m, x, m(torch.from_numpy(x)).numpy())
    return _cache["ref"]


def sesion(p: Path):
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.log_severity_level = 3
    return ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])


def correr_engine(p: Path, x, lote: int = 32):
    import numpy as np

    s = sesion(p)
    nombre = s.get_inputs()[0].name
    return np.concatenate([s.run(None, {nombre: x[i:i + lote]})[0] for i in range(0, len(x), lote)])


def tres_numeros(ref, out) -> tuple[float, float, float]:
    import numpy as np

    a1 = float((ref.argmax(1) == out.argmax(1)).mean())
    t5r, t5o = np.argsort(-ref, 1)[:, :5], np.argsort(-out, 1)[:, :5]
    o5 = float(np.mean([len(set(p) & set(q)) / 5 for p, q in zip(t5r, t5o)]))
    return a1, o5, float(np.abs(ref - out).max())


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    s = s3()
    try:
        hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    except Exception as e:  # noqa: BLE001
        raise Falla(f"el S3 local no responde en localhost:9600 ({type(e).__name__}): docker compose up -d --wait")
    exige({DATOS, CKPT} <= hay, f"faltan buckets ({sorted({DATOS, CKPT} - hay)}): python mundo/crear.py")
    try:
        golden_manifest(s)
        s.head_object(Bucket=DATOS, Key=f"calibracion/{CALIBRACION}/manifest.json")
    except Exception:  # noqa: BLE001
        raise Falla(f"falta el examen {GOLDEN} o el set {CALIBRACION} en s3://{DATOS}/: python mundo/crear.py")
    c = cliente()
    vs = c.search_model_versions(f"name = '{MODELO}'")
    exige(len(vs) >= 4, f"el registro tiene {len(vs)} versiones de {MODELO}; se esperan 4: python mundo/crear.py")
    al = c.get_registered_model(MODELO).aliases
    exige(str(al.get("champion")) == str(cfg()["champion"]) and str(al.get("challenger")) == str(cfg()["challenger"]),
          f"@champion = v{al.get('champion')} y @challenger = v{al.get('challenger')}; corrida.yaml dice v{cfg()['champion']} y "
          f"v{cfg()['challenger']}: python mundo/modelos.py versiones")
    exige(c.get_model_version(MODELO, str(cfg()["champion"])).tags.get("engine_sha256"), "el champion no tiene su engine: python mundo/crear.py")
    exige(git("rev-parse", "--is-inside-work-tree") == "true", "esta carpeta no es un repositorio de git: git init (paso 0)")
    exige(git("rev-parse", "HEAD"), "el repositorio no tiene commits todavía: git add -A && git commit -m kit")
    return (f"S3 local ({GOLDEN}, {CALIBRACION}, checkpoints) · MLflow: {MODELO} v1–v{len(vs)}, @champion = v{al['champion']} "
            f"con su engine, @challenger = v{al['challenger']} · git")


def check_receta() -> str:
    sha = sha256(ENGINE_YAML.read_bytes())
    ok = {r["engine_yaml_sha256"]: r for r in json.loads(REVISIONES.read_text())["aprobadas"]}
    exige(sha in ok, f"engine.yaml ({sha[:12]}…) no es ninguna versión revisada (mundo/revisiones.json): git log -p engine.yaml")
    sucio = git("status", "--porcelain", "--", *TUS_ARCHIVOS)
    exige(not sucio, f"hay cambios sin commit ({(sucio.splitlines() or [''])[0].strip()}): git diff")
    pr = ok[sha]
    r = engine_yaml()
    return (f"engine.yaml = la revisión del PR #{pr['pr']} ({pr['fecha']}): opset {r['export']['opset']}, {r['engine']['precision']}, "
            f"a1 ≥ {r['paridad']['a1_min']:.1%}, holgura {r['latencia']['holgura']:.0%} · sin cambios pendientes")


def check_pesos() -> str:
    import torch

    c = cliente()
    v = str(cfg()["challenger"])
    mv = c.get_model_version(MODELO, v)
    exige(mv.tags.get("gate") == "passed", f"v{v} no tiene gate=passed")
    b = artefacto(mv.run_id, "modelo/pesos.pt")
    exige(b, f"v{v} no tiene modelo/pesos.pt en MLflow")
    huella = huella_pesos(torch.load(io.BytesIO(b), map_location="cpu", weights_only=True))
    exige(huella == mv.tags.get("pesos_sha256"),
          f"los pesos de v{v} en MLflow tienen huella {huella[:12]}… y la versión dice {mv.tags.get('pesos_sha256', '?')[:12]}…: "
          "alguien reemplazó el archivo. python mundo/modelos.py versiones")
    lab = json.loads(artefacto(mv.run_id, "modelo/labels.json") or b"null")
    exige(lab == CLASES, f"el labels.json de v{v} no es entrada/categorias.json")
    exp = reporte("export", paso="pipeline/exportar.py (paso 2)")
    exige(exp.get("pesos_sha256") == huella, f"export.json dice pesos {exp.get('pesos_sha256', '?')[:12]}…; los de v{v} son {huella[:12]}…")
    return f"v{v}: gate=passed · pesos {huella[:12]}… = su tag = los que exportaste · labels.json en orden"


def check_export() -> str:
    import numpy as np
    import onnx

    r, firma = engine_yaml(), contrato()
    exp = reporte("export", paso="pipeline/exportar.py (paso 2)")
    p = dir_() / "model.onnx"
    exige(p.exists() and sha_archivo(p) == exp.get("onnx_sha256"), "model.onnx no existe o no es el de export.json (otra huella)")
    m = onnx.load(str(p))
    onnx.checker.check_model(m, full_check=True)
    opset = next(o.version for o in m.opset_import if o.domain in ("", "ai.onnx"))
    exige(opset == r["export"]["opset"], f"model.onnx dice opset {opset}; engine.yaml pide {r['export']['opset']}")
    exige(exp.get("exportador") == r["export"]["exportador"], f"export.json dice exportador {exp.get('exportador')}")
    dims = [d.dim_param or d.dim_value for d in m.graph.input[0].type.tensor_type.shape.dim]
    exige(isinstance(dims[0], str) and dims[0], f"el eje 0 de la entrada es {dims[0]!r}: tiene que ser dinámico (un nombre, no un número)")
    _, x, ref = modelo_ref()
    s, x = sesion(p), x[:64]
    peor = 0.0
    for lote in (1, 7, r["export"]["batch_max"]):
        out = np.concatenate([s.run(None, {m.graph.input[0].name: x[i:i + lote]})[0] for i in range(0, len(x), lote)])
        exige((out.argmax(1) == ref[:64].argmax(1)).all(), f"con batch {lote}, model.onnx cambia el top-1 de alguna foto: ¿eval()?")
        peor = max(peor, float(np.abs(out - ref[:64]).max()))
    exige(peor <= r["export"]["d_max"], f"FP32 contra FP32 difieren {peor:.2e} (> {r['export']['d_max']}): el export no es el checkpoint")
    for k in ("batch_1", f"batch_{r['export']['batch_max']}"):
        x_ = (exp.get("paridad_fp32") or {}).get(k)
        exige(x_ and x_.get("fotos") == r["export"]["fotos_paridad"] and x_.get("top1_iguales") == x_.get("fotos"),
              f"export.json no trae la paridad FP32 de {k} con {r['export']['fotos_paridad']} fotos iguales")
    return (f"model.onnx {exp['onnx_sha256'][:12]}… · opset {opset} · {firma['entrada']['nombre']}[{dims[0]}, …] · batch 1, 7 y "
            f"{r['export']['batch_max']} con el mismo top-1 que PyTorch · diferencia {peor:.1e}")


def check_engine() -> str:
    r = engine_yaml()
    info = reporte("engine", paso="pipeline/construir.py (paso 3)")
    exp = reporte("export", paso="pipeline/exportar.py (paso 2)")
    p = dir_() / "engine.onnx"
    exige(p.exists() and sha_archivo(p) == info.get("engine_sha256"), "engine.onnx no existe o no es el de engine.json (otra huella)")
    exige(info.get("onnx_sha256") == exp.get("onnx_sha256"), "engine.json no sale del model.onnx que pasó los tres chequeos")
    exige(info.get("precision") == r["engine"]["precision"], f"el engine es {info.get('precision')}; engine.yaml pide {r['engine']['precision']}")
    exige(info.get("onnxruntime") == runtime_servidor(),
          f"el engine se construyó con onnxruntime {info.get('onnxruntime')} y el servidor corre {runtime_servidor()} "
          "(mundo/servidor/requirements.txt): git log -p mundo/servidor/requirements.txt")
    import onnxruntime as ort

    exige(ort.__version__ == runtime_servidor(), f"tu entorno tiene onnxruntime {ort.__version__}; el servidor, {runtime_servidor()}: pip install -r requirements.txt")
    aqui = f"{platform.system()} {platform.machine()}"
    exige(info.get("maquina") == aqui, f"el engine se construyó en {info.get('maquina')} y estás en {aqui}: reconstrúyelo aquí")
    return (f"engine.onnx {info['engine_sha256'][:12]}… · {info['precision']} · desde model.onnx {info['onnx_sha256'][:12]}… · "
            f"onnxruntime {info['onnxruntime']} = el del servidor · {info['maquina']} ({info.get('cpu', '?')})")


def check_firma() -> str:
    firma = contrato()
    info = reporte("engine", paso="pipeline/construir.py (paso 3)")
    s = sesion(dir_() / "engine.onnx")
    e, o = s.get_inputs()[0], s.get_outputs()[0]
    exige(e.name == firma["entrada"]["nombre"] and o.name == firma["salida"]["nombre"],
          f"el engine tiene entrada «{e.name}» y salida «{o.name}»; el servidor espera «{firma['entrada']['nombre']}» y "
          f"«{firma['salida']['nombre']}» (mundo/servidor/classifier.yaml): git log -p mundo/servidor/classifier.yaml")
    exige(e.type == o.type == "tensor(float)", f"entrada {e.type} y salida {o.type}: el servidor espera float32 en las dos")
    exige(e.shape[1:] == firma["entrada"]["forma"] and o.shape[1:] == firma["salida"]["forma"], f"formas {e.shape} → {o.shape}")
    exige(info.get("batch_max", 0) >= firma["max_batch_size"],
          f"el engine se construyó para batches de hasta {info.get('batch_max')} y el servidor junta hasta {firma['max_batch_size']}: "
          "git log -p mundo/servidor/classifier.yaml")
    import numpy as np

    out = s.run(None, {e.name: np.zeros((firma["max_batch_size"], *firma["entrada"]["forma"]), np.float32)})[0]
    exige(out.shape == (firma["max_batch_size"], *firma["salida"]["forma"]), f"con {firma['max_batch_size']} fotos sale {out.shape}")
    return f"{e.name} float32 {e.shape} → {o.name} float32 {o.shape} · {firma['max_batch_size']} fotos juntas = mundo/servidor/classifier.yaml"


def check_paridad() -> str:
    r = engine_yaml()
    par = reporte("paridad", paso="pipeline/paridad.py (paso 4)")
    info = reporte("engine", paso="pipeline/construir.py (paso 3)")
    exige(par.get("engine_sha256") == info["engine_sha256"], "paridad.json es de otro engine: vuelve a correr pipeline/paridad.py")
    exige(par.get("manifest_sha256") == r["paridad"]["manifest_sha256"] and par.get("n") == 1000, "paridad.json no usó el golden set completo")
    _, x, ref = modelo_ref()
    a1, o5, d = tres_numeros(ref, correr_engine(dir_() / "engine.onnx", x))
    for k, v in (("a1", a1), ("o5", o5), ("d", d)):
        exige(par.get(k) is not None and abs(par[k] - v) <= 1e-4, f"paridad.json dice {k} = {par.get(k)}; recalculado sale {v:.4f}")
    pasa = a1 >= r["paridad"]["a1_min"] and o5 >= r["paridad"]["o5_min"] and d <= r["paridad"]["d_max"]
    exige(par.get("pasa") == pasa, f"con a1 {a1:.4f}, o5 {o5:.4f} y d {d:.4f}, «pasa» es {pasa}")
    exige(pasa, f"la paridad no pasa: {par.get('motivo')}")
    return f"golden-v1 completo: a1 {a1:.1%} · o5 {o5:.2%} · d {d:.4f} (recalculados) · umbrales {r['paridad']['a1_min']:.1%} / {r['paridad']['o5_min']:.0%} / {r['paridad']['d_max']}"


def check_frena() -> str:
    par = reporte("paridad", "int8", "pipeline/construir.py --precision int8 y pipeline/paridad.py --prueba int8 (paso 4)")
    info = reporte("engine", "int8", "pipeline/construir.py --precision int8 (paso 4)")
    exige(info.get("precision") == "int8" and par.get("engine_sha256") == info.get("engine_sha256"), "la prueba int8 no es un engine int8 con su paridad")
    _, x, ref = modelo_ref()
    a1, o5, d = tres_numeros(ref, correr_engine(dir_("int8") / "engine.onnx", x))
    exige(abs(par.get("a1", -1) - a1) <= 1e-4, f"la paridad int8 dice a1 = {par.get('a1')}; recalculado sale {a1:.4f}")
    exige(par.get("pasa") is False and par.get("motivo"), "la paridad del engine int8 tiene que quedar como NO pasa, con su motivo")
    mv = cliente().get_model_version(MODELO, str(cfg()["challenger"]))
    exige(mv.tags.get("engine_sha256") != info["engine_sha256"], "el engine int8 quedó registrado en la versión aunque no pasó")
    return f"int8: a1 {a1:.1%} · o5 {o5:.2%} · d {d:.3f} → NO pasa ({par['motivo'][:90]}) · no se registró"


def check_latencia() -> str:
    r = engine_yaml()
    lat = reporte("latencia", paso="pipeline/latencia.py (paso 5)")
    info = reporte("engine", paso="pipeline/construir.py (paso 3)")
    exige(lat.get("engine_sha256") == info["engine_sha256"], "latencia.json es de otro engine: vuelve a medir")
    c = cliente()
    v3 = c.get_model_version(MODELO, str(cfg()["champion"]))
    esperada = v3.tags.get("engine_sha256")
    real = sha256(artefacto(v3.run_id, "engine/engine.onnx") or b"")
    exige(real == esperada, f"el engine del champion (v{cfg()['champion']}) en MLflow tiene huella {real[:12]}… y su tag dice "
                            f"{(esperada or '?')[:12]}…: la referencia de la latencia no es la de producción. python mundo/modelos.py engine {cfg()['champion']}")
    exige(lat.get("champion_engine_sha256") == esperada, "latencia.json no midió contra el engine del champion (otra huella)")
    L = r["latencia"]
    exige(sorted(lat.get("tasas", {})) == sorted(map(str, L["tasas"])) and lat.get("rondas") == L["rondas"] and lat.get("holgura") == L["holgura"],
          "latencia.json no usó las tasas, las rondas o la holgura de engine.yaml")
    import statistics

    salida = []
    for t, x in lat["tasas"].items():
        exige(len(x["rondas_champion"]) == len(x["rondas_challenger"]) == L["rondas"], f"a {t}/s no hay {L['rondas']} rondas de cada uno")
        tc, tn = statistics.median(x["rondas_champion"]), statistics.median(x["rondas_challenger"])
        exige(abs(x["p99_champion"] - tc) < TOL and abs(x["p99_challenger"] - tn) < TOL, f"a {t}/s, el p99 no es la mediana de las rondas")
        exige(abs(x["limite"] - (1 + L["holgura"]) * tc) < TOL and x["pasa"] == (tn <= (1 + L["holgura"]) * tc), f"a {t}/s, el límite o «pasa» no cuadran")
        salida.append(f"{t}/s: {tn:.2f} ms vs {tc:.2f} ms (límite {x['limite']:.2f})")
    exige(lat.get("pasa"), f"la latencia no pasa: {lat.get('motivo')}")
    return " · ".join(salida) + f" · contra el engine del champion {esperada[:12]}…"


def check_registro() -> str:
    c = cliente()
    v = str(cfg()["challenger"])
    al = c.get_registered_model(MODELO).aliases
    exige(str(al.get("champion")) == str(cfg()["champion"]) and str(al.get("challenger")) == v,
          f"@champion = v{al.get('champion')} y @challenger = v{al.get('challenger')}: ¿quién los movió?")
    mv = c.get_model_version(MODELO, v)
    t = mv.tags
    exige(t.get("engine") == "listo", f"v{v} dice engine = {t.get('engine')}: corre pipeline/registrar.py (paso 6)")
    info = reporte("engine", paso="pipeline/construir.py (paso 3)")
    exige(t.get("engine_sha256") == info["engine_sha256"] and t.get("onnx_sha256") == info["onnx_sha256"],
          f"los tags de v{v} no son las huellas de tu engine y tu ONNX")
    real = sha256(artefacto(mv.run_id, "engine/engine.onnx") or b"")
    exige(real == t["engine_sha256"], f"el engine.onnx de v{v} en MLflow no es el de su tag")
    faltan = [k for k in ("onnxruntime", "maquina", "precision", "opset", "paridad_a1", "paridad_o5", "paridad_d", "engine_yaml_sha256")
              if k not in t] + [f"latencia_p99_{x}" for x in engine_yaml()["latencia"]["tasas"] if f"latencia_p99_{x}" not in t]
    exige(not faltan, f"a v{v} le faltan los tags {faltan}")
    exige(t["onnxruntime"] == runtime_servidor(), f"v{v} dice onnxruntime {t['onnxruntime']}; el servidor corre {runtime_servidor()}")
    for f in ("paridad.json", "latencia.json", "engine.json", "export.json", "model.onnx"):
        exige(artefacto(mv.run_id, f"engine/{f}"), f"a v{v} le falta engine/{f} en MLflow")
    return (f"v{v} @challenger · engine=listo · engine {t['engine_sha256'][:12]}… (el archivo en MLflow = el tag) · {t['precision']} · "
            f"onnxruntime {t['onnxruntime']} · paridad a1 {float(t['paridad_a1']):.1%} · @champion sigue en v{al['champion']}")


CHECKS = {
    "mundo": check_mundo, "receta": check_receta, "pesos": check_pesos, "export": check_export, "engine": check_engine,
    "firma": check_firma, "paridad": check_paridad, "frena": check_frena, "latencia": check_latencia, "registro": check_registro,
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
            print(f"{'✓' if ok else '✗'} {i:<9} {msg}", flush=True)
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
