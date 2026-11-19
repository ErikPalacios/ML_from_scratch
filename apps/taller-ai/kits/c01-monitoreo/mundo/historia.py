"""La historia del mundo (no es parte de lo que escribes): lo que pasó antes de hoy. mundo/crear.py la genera.

    python mundo/historia.py s3          # 60 días de logs en Parquet y de eventos del backend en S3, el golden set y
                                         # el historial de despliegues (≈ 20 s)
    python mundo/historia.py metricas    # 8 días de métricas del gateway en Prometheus (promtool, ≈ 30 s)
    python mundo/historia.py metricas --de-nuevo   # la misma ventana otra vez (si Prometheus perdió su historia)
    python mundo/historia.py ventana     # las banderas --start y --end para rellenar TUS recording rules

Lo que pasó (los días se cuentan hacia atrás desde hoy, en UTC; D-1 es ayer):
- La release 15 (resnet50-2026-11-01) entró el D-25 a las 16:00; antes atendía la 14.
- El equipo de la app mobile sacó la 5.2.0 el D-16 (llegó al 20 %, 50 %, 80 % y luego 95 % de quien vende): manda las
  fotos más comprimidas y con menos contraste.
- Desde el D-5 llega la temporada de frío: suben los abrigos, y 4 de cada 10 son chamarras acolchadas de un estilo
  que el modelo casi no vio.
- Desde el D-6 llegan botines de lluvia, otro estilo nuevo; pero se publican pocos botines.
- Hubo días raros sueltos: una campaña de sandalias el D-20 y dos días de vestidos (temporada de bodas) el D-9 y D-8.
- El D-3, de las 03:00 a las 03:45, un corte de red dejó al gateway sin tráfico (los pods siguieron vivos).

Todo sale de semillas fijas: dos corridas dan los mismos datos (con fechas relativas a hoy).
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, EVENTOS, FOTOS, NODO, PREDICCIONES, RAIZ, compose, etiquetas, escribir_json,  # noqa: E402
                         examen, leer_json, objetos, s3)

DIAS = 60
V14, V15 = "resnet50-2026-10-01", "resnet50-2026-11-01"
RELEASE15 = 25                       # D-25 a las 16:00 UTC
ADOPCION_52 = {16: 0.20, 15: 0.50, 14: 0.80}         # D-16, D-15, D-14; del D-13 en adelante, 95 %
ABRIGOS = {5: 0.20, 4: 0.27, 3: 0.34, 2: 0.38, 1: 0.42}   # la parte de los abrigos en lo que se publica
RAROS = {20: ("sandalias", 0.32), 9: ("vestidos", 0.30), 8: ("vestidos", 0.31)}
MEZCLA = {"playeras": .14, "pantalones": .12, "sueteres": .10, "vestidos": .09, "abrigos": .08, "sandalias": .10,
          "camisas": .11, "tenis": .12, "bolsas": .09, "botines": .05}
POR_DIA = 20_000                     # requests al día (C01: ≈ 10 millones)
PROCESO_52 = {"contraste": 0.85, "calidad": 70}      # lo que hace la app 5.2 con la foto (mundo/callers.json)
HISTORIA = NODO / "historia"
NACIMIENTO = HISTORIA / "nacimiento.json"
MUNDO_JSON = HISTORIA / "mundo.json"
DESPLIEGUES = "plataforma/despliegues.json"


def hoy() -> datetime:
    """El día en que nació el mundo (UTC, a las 00:00): lo fija `historia.py s3` en nodo/historia/mundo.json."""
    m = leer_json(MUNDO_JSON)
    if m:
        return datetime.fromisoformat(m["hoy"]).replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def mezcla(k: int) -> np.ndarray:
    labs = etiquetas()
    p = np.array([MEZCLA[x] for x in labs])
    fijar = {}
    if k in ABRIGOS:
        fijar["abrigos"] = ABRIGOS[k]
    if k in RAROS:
        fijar[RAROS[k][0]] = RAROS[k][1]
    for cat, v in fijar.items():
        i = labs.index(cat)
        resto = np.delete(np.arange(10), i)
        p[resto] *= (1 - v) / p[resto].sum()
        p[i] = v
    return p / p.sum()


def adopcion(k: int) -> float:
    return 0.0 if k > 16 else ADOPCION_52.get(k, 0.95)


# ---------------------------------------------------------------- los logs y los eventos de un día
def golden() -> list[str]:
    rng = np.random.default_rng(4004)
    return [hashlib.sha256(rng.bytes(32)).hexdigest() for _ in range(1000)]


def dia(k: int, gold: list[str]) -> tuple[dict, dict]:
    """(predicciones, eventos) del día D-k, como columnas de numpy."""
    rng = np.random.default_rng(1200 + k)
    d0 = hoy() - timedelta(days=k)
    fin_de_semana = d0.weekday() >= 5
    n = int(POR_DIA * (1.08 if fin_de_semana else 1.0) * rng.normal(1, 0.02))
    seg = np.sort(rng.uniform(0, 86400, n))
    if k == 3:                                        # el corte de red: 03:00–03:45 sin tráfico
        seg = seg[(seg < 3 * 3600) | (seg >= 3 * 3600 + 45 * 60)]
        n = len(seg)
    hora = np.datetime64(d0.replace(tzinfo=None)) + (seg * 1e6).astype("timedelta64[us]")
    caller = rng.choice(["backend-publicaciones", "moderacion", "busqueda"], n, p=[0.7, 0.2, 0.1])
    source = np.where(caller == "moderacion", "internal",
                      np.where(caller == "busqueda", "web", np.where(rng.random(n) < 0.6, "mobile", "web")))
    version = np.where((k > RELEASE15) | ((k == RELEASE15) & (seg < 16 * 3600)), V14, V15)
    status = rng.choice([200, 415, 405, 503, 504], n, p=[0.9742, 0.02, 0.005, 0.0005, 0.0003])
    ok = status == 200
    app52 = (source == "mobile") & (caller == "backend-publicaciones") & (rng.random(n) < adopcion(k))
    labs = etiquetas()
    verdad = rng.choice(10, n, p=mezcla(k))
    chamarra = (verdad == labs.index("abrigos")) & (k in ABRIGOS) & (rng.random(n) < 0.4)
    acierto_p = np.where(version == V14, 0.84, 0.85)
    acierto_p = np.where(app52, 0.80, acierto_p)
    acierto_p = np.where(chamarra, 0.60, acierto_p)
    lluvia = (verdad == labs.index("botines")) & (k <= 6)          # botines de lluvia: otro estilo nuevo, pero pocos
    acierto_p = np.where(lluvia, 0.70, acierto_p)
    acierto = rng.random(n) < acierto_p
    pred = np.where(acierto, verdad, (verdad + 1 + rng.integers(0, 9, n)) % 10)
    score = np.where(acierto, 0.15 + 0.85 * rng.beta(3.0, 1.4, n), rng.beta(1.3, 2.6, n))
    score = np.where(app52, score * 0.90, score)
    score = np.round(np.clip(score, 0.1, 0.9999), 4)
    base = np.exp(rng.normal(np.log(1515), 0.08, n))
    byts = np.where(app52, base * 0.60, base).astype(np.int64)
    sha = np.array([f"{x:012x}" for x in rng.integers(0, 2**48, n, dtype=np.int64)])
    repe = rng.random(n) < 0.01                       # resubidas: la misma foto otra vez
    sha[repe] = sha[rng.integers(0, n, repe.sum())]
    dorada = rng.random(n) < 0.003                    # fotos del examen fijo que alguien subió (pasa)
    sha[dorada] = np.array([g[:12] for g in gold])[rng.integers(0, len(gold), dorada.sum())]
    rid = np.array([str(x) for x in rng.integers(0, 2**63 - 1, n, dtype=np.int64)])
    rid = np.char.add("r", rid)
    ms_pre = np.round(rng.lognormal(1.1, 0.35, n), 1)
    ms_tri = np.round(np.where(status == 504, 150.0, rng.lognormal(1.6, 0.4, n)), 1)
    ms_post = np.full(n, 0.2)
    ms_total = np.round(ms_pre + ms_tri + 0.2 + rng.uniform(0.5, 2, n), 1)
    no_llego = (status == 415) | (status == 405)
    error = np.select([status == 415, status == 405, status == 503, status == 504],
                      ["tipo no soportado", "Method Not Allowed", "sin conexión con Triton (ClientConnectorError)",
                       "Triton no contestó en 150 ms"], "")
    pred_f = np.where(ok, pred, -1)
    pr = {"hora": hora, "nodo": rng.choice(["a", "b"], n), "request_id": rid, "caller": caller, "source": source,
          "model_version": version, "status": status.astype(np.int32),
          "top1": pred_f.astype(np.int32), "score": np.where(ok, score, np.nan),
          "ms_pre": np.where(no_llego, np.nan, ms_pre), "ms_triton": np.where(no_llego, np.nan, ms_tri),
          "ms_post": np.where(ok, ms_post, np.nan), "ms_total": np.where(no_llego, rng.uniform(0.3, 1.2, n).round(1), ms_total),
          "bytes": np.where(no_llego, -1, byts), "sha256": np.where(no_llego, "", sha), "error": error}
    # los eventos del backend de publicaciones: una publicación por request suya
    pub = caller == "backend-publicaciones"
    m = int(pub.sum())
    vendedor = rng.integers(0, 400_000, m)
    holdout = np.array([int(hashlib.sha256(f"s{v}".encode()).hexdigest()[:8], 16) % 100 == 0 for v in vendedor])
    mostrada = ok[pub] & ~holdout & (rng.random(m) < 0.95)
    p_ok = np.where(app52[pub], 0.775, 0.80)
    p_ok = np.where(chamarra[pub], 0.72, p_ok)
    p_ok = np.where(lluvia[pub], 0.74, p_ok)
    acepta = mostrada & np.where(acierto[pub], rng.random(m) < p_ok, rng.random(m) < 0.25)
    se_equivoca = rng.random(m) < 0.03
    elegida = np.where(acepta, pred[pub], np.where(se_equivoca, rng.integers(0, 10, m), verdad[pub]))
    via = np.where(acepta, "sugerencia", rng.choice(["busqueda", "arbol"], m, p=[0.4, 0.6]))
    app = np.where(source[pub] == "web", "web-2026.11.2", np.where(app52[pub], "mobile-5.2.0", "mobile-5.1.4"))
    ev = {"hora": hora[pub] + rng.integers(5_000_000, 90_000_000, m).astype("timedelta64[us]"),
          "request_id": rid[pub], "seller_id": np.char.add("s", vendedor.astype(str)), "holdout": holdout,
          "mostrada": mostrada, "elegida": elegida.astype(np.int32), "via": via, "app": app}
    return pr, ev


def subir_parquet(cols: dict, llave: str, c) -> None:
    import duckdb

    con = duckdb.connect()
    con.register("t", cols)
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "x.parquet"
        con.execute(f"COPY (SELECT * FROM t ORDER BY hora) TO '{p}' (FORMAT parquet)")
        c.upload_file(str(p), BUCKET, llave)


def s3_historia() -> None:
    t0 = time.time()
    HISTORIA.mkdir(parents=True, exist_ok=True)
    escribir_json(MUNDO_JSON, {"hoy": datetime.now(timezone.utc).date().isoformat()})
    c = s3()
    try:
        c.create_bucket(Bucket=BUCKET)
    except Exception as e:  # noqa: BLE001
        if "AlreadyOwned" not in str(e) and "AlreadyExists" not in str(e):
            raise
    for pre in (PREDICCIONES, EVENTOS, "monitoreo/", "etiquetado/", "datasets/", "plataforma/"):
        for o in objetos(pre, c):
            c.delete_object(Bucket=BUCKET, Key=o["Key"])
    gold = golden()
    c.put_object(Bucket=BUCKET, Key=examen(), Body=("\n".join(gold) + "\n").encode())
    filas = eventos = 0
    for k in range(DIAS, 0, -1):
        pr, ev = dia(k, gold)
        d = (hoy() - timedelta(days=k)).strftime("%Y-%m-%d")
        for v in (V14, V15):
            sel = pr["model_version"] == v
            if sel.any():
                subir_parquet({x: y[sel] for x, y in pr.items()}, f"{PREDICCIONES}dt={d}/model_version={v}/parte-0.parquet", c)
        subir_parquet(ev, f"{EVENTOS}dt={d}/parte-0.parquet", c)
        filas += len(pr["hora"])
        eventos += len(ev["hora"])
    h = hoy()
    desp = [
        {"cuando": (h - timedelta(days=32) + timedelta(hours=11, minutes=5)).isoformat(), "equipo": "plataforma",
         "que": "Triton: instance_group y dynamic batching revisados (estación 6)"},
        {"cuando": (h - timedelta(days=RELEASE15) + timedelta(hours=16)).isoformat(), "equipo": "equipo-classifier",
         "que": "release 15: modelo resnet50-2026-11-01 + gateway 15.0.0 (canary 5 % → 25 % → 100 %)"},
        {"cuando": (h - timedelta(days=21) + timedelta(hours=10, minutes=20)).isoformat(), "equipo": "equipo-classifier",
         "que": "gateway 15.0.1: request_id, línea de log y métricas (estación 11)"},
    ]
    c.put_object(Bucket=BUCKET, Key=DESPLIEGUES, Body=json.dumps(desp, ensure_ascii=False, indent=1).encode())
    print(f"✓ historia en s3://{BUCKET}/: {DIAS} días ({(h - timedelta(days=DIAS)):%Y-%m-%d} a "
          f"{(h - timedelta(days=1)):%Y-%m-%d}), {filas:,} requests en {PREDICCIONES} y {eventos:,} eventos en "
          f"{EVENTOS}; golden set (1,000 fotos) en {examen()}; despliegues en {DESPLIEGUES} ({time.time() - t0:.0f} s)")


# ---------------------------------------------------------------- las métricas de los últimos 8 días
def fotos_en_vivo() -> dict:
    """Lo que el tráfico de hoy produce, medido con el modelo de verdad: la fracción de cada borde del score, de cada
    categoría y los bytes medios, para la app de siempre (web, internal) y para la 5.2 (mobile)."""
    import onnxruntime as ort

    sys.path.insert(0, str(RAIZ / "gateway"))
    from app.preprocess import preprocess

    from mundo.carga import procesar
    ses = ort.InferenceSession(str(RAIZ / "model_repository/classifier/1/model.onnx"))
    out = {}
    for nombre, proceso in (("siempre", None), ("app52", PROCESO_52)):
        datos = [procesar(p.read_bytes(), proceso) for p in sorted(FOTOS.glob("*.jpg"))]
        z = ses.run(None, {ses.get_inputs()[0].name: np.stack([preprocess(d) for d in datos])})[0]
        e = np.exp(z - z.max(1, keepdims=True))
        p = e / e.sum(1, keepdims=True)
        out[nombre] = {"score": p.max(1), "pred": p.argmax(1), "bytes": np.array([len(d) for d in datos])}
    return out


def metricas() -> None:
    """Escribe 8 días de métricas en formato OpenMetrics y las vuelve bloques de Prometheus con promtool, antes de que
    Prometheus arranque (así no se cruzan con lo que escribe en vivo)."""
    t0 = time.time()
    HISTORIA.mkdir(parents=True, exist_ok=True)
    vivo = fotos_en_vivo()
    labs = etiquetas()
    previa = leer_json(NACIMIENTO)
    if previa and "--de-nuevo" in sys.argv:          # otra vez la misma ventana: nunca sobre lo que Prometheus escribe hoy
        ini, fin = previa["inicio"], previa["fin"]
    else:
        fin = int(time.time()) // 60 * 60 - 60
        ini = fin - 8 * 86400
    rng = np.random.default_rng(88)
    tasa = 5.0                                       # requests/s, como el tráfico de siempre
    fuentes = {"mobile": 0.7 * 0.6, "web": 0.7 * 0.4 + 0.1, "internal": 0.2}
    codigos = {"200": 0.9992, "503": 0.0005, "504": 0.0003}
    bordes = (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99)

    def frac_score(nombre):
        s = vivo[nombre]["score"]
        return np.array([(s <= b).mean() for b in bordes]), s.mean()

    fs, ms = frac_score("siempre")
    fa, ma = frac_score("app52")
    w = fuentes["mobile"]
    frac_bordes = (1 - w) * fs + w * fa
    media_score = (1 - w) * ms + w * ma
    frac_lab = (1 - w) * np.bincount(vivo["siempre"]["pred"], minlength=10) / 300 + \
        w * np.bincount(vivo["app52"]["pred"], minlength=10) / 300
    bytes_medios = {"mobile": vivo["app52"]["bytes"].mean(), "web": vivo["siempre"]["bytes"].mean(),
                    "internal": vivo["siempre"]["bytes"].mean()}
    pods = [("a", "gateway-6f7b9c4d58-xa7k2", "host.docker.internal:8961"),
            ("b", "gateway-6f7b9c4d58-qm4t8", "host.docker.internal:8962")]
    tiempos = np.arange(ini, fin + 1, 60)
    corte = hoy().timestamp() - 3 * 86400
    sin_trafico = (tiempos > corte + 3 * 3600) & (tiempos <= corte + 3 * 3600 + 45 * 60)
    # cuántas requests por minuto y por pod (Poisson), sin tráfico en el corte de red
    por_min = {p[0]: np.where(sin_trafico, 0, rng.poisson(tasa * 60 / 2, len(tiempos))) for p in pods}
    series: dict[str, list[tuple[str, np.ndarray]]] = {"classifier_requests": [], "classifier_top1_score": [],
                                                       "classifier_top1_label": [], "classifier_image_bytes": []}
    for nodo, pod, inst in pods:
        base = f'job="gateway",instance="{inst}",namespace="classifier",nodo="{nodo}",pod="{pod}"'
        n = por_min[nodo]
        nf = {f: rng.binomial(n, p) for f, p in fuentes.items()}
        for f, nn in nf.items():
            ok = nn.copy()
            for cod, p in codigos.items():
                if cod == "200":
                    continue
                k_ = rng.binomial(nn, p)
                ok -= k_
                series["classifier_requests"].append(
                    (f'classifier_requests_total{{{base},code="{cod}",model_version="{V15}",source="{f}"}}', np.cumsum(k_)))
            series["classifier_requests"].append(
                (f'classifier_requests_total{{{base},code="200",model_version="{V15}",source="{f}"}}', np.cumsum(ok)))
            series["classifier_image_bytes"] += [
                (f'classifier_image_bytes_bucket{{{base},le="+Inf",source="{f}"}}', np.cumsum(nn)),
                (f'classifier_image_bytes_count{{{base},source="{f}"}}', np.cumsum(nn)),
                (f'classifier_image_bytes_sum{{{base},source="{f}"}}', np.cumsum(nn * bytes_medios[f]))]
        tot = sum(nf.values())
        acum = np.cumsum(tot)
        for b, fr in zip(bordes, frac_bordes):
            series["classifier_top1_score"].append(
                (f'classifier_top1_score_bucket{{{base},le="{b}",model_version="{V15}"}}', np.cumsum(rng.binomial(tot, fr))))
        series["classifier_top1_score"] += [
            (f'classifier_top1_score_bucket{{{base},le="+Inf",model_version="{V15}"}}', acum),
            (f'classifier_top1_score_count{{{base},model_version="{V15}"}}', acum),
            (f'classifier_top1_score_sum{{{base},model_version="{V15}"}}', np.cumsum(tot * media_score))]
        lab_n = np.array([rng.multinomial(t, frac_lab) for t in tot])
        for i, lb in enumerate(labs):
            series["classifier_top1_label"].append(
                (f'classifier_top1_label_total{{{base},label="{lb}"}}', np.cumsum(lab_n[:, i])))
    # los buckets de un histograma no pueden bajar de un borde al siguiente: se ordenan por minuto
    om = HISTORIA / "historia.om"
    tipos = {"classifier_requests": "counter", "classifier_top1_score": "histogram", "classifier_top1_label": "counter",
             "classifier_image_bytes": "histogram"}
    with om.open("w") as f:
        for fam, ss in series.items():
            if fam == "classifier_top1_score":
                ss = arreglar_buckets(ss)
            f.write(f"# TYPE {fam} {tipos[fam]}\n")
            for nombre, valores in ss:
                f.write("".join(f"{nombre} {v:.6g} {t}\n" for t, v in zip(tiempos, valores)))
        f.write("# EOF\n")
    escribir_json(NACIMIENTO, {"inicio": int(ini), "fin": int(fin), "baja_confianza": round(float(frac_bordes[1]), 4)})
    print(f"✓ historia.om: {sum(len(v) for v in series.values())} series × {len(tiempos):,} minutos "
          f"({om.stat().st_size / 1e6:.0f} MB); baja confianza esperada {frac_bordes[1]:.3f}")
    # promtool escribe cada bloque en una carpeta temporal y la renombra al terminar: Prometheus nunca ve uno a medias
    r = compose("run", "--rm", "--no-deps", "--entrypoint", "promtool", "prometheus", "tsdb", "create-blocks-from",
                "openmetrics", "--max-block-duration=24h", "/historia/historia.om", "/prometheus", timeout=900)
    if r.returncode != 0:
        sys.exit(f"✗ promtool no pudo crear los bloques:\n{(r.stdout + r.stderr)[-2000:]}")
    om.unlink()
    print(f"✓ 8 días de métricas como bloques de Prometheus ({time.time() - t0:.0f} s): "
          f"{datetime.fromtimestamp(ini, timezone.utc):%Y-%m-%d %H:%M} → {datetime.fromtimestamp(fin, timezone.utc):%Y-%m-%d %H:%M} UTC")


def arreglar_buckets(ss: list) -> list:
    """Cada bucket cuenta «menor o igual que su borde»: por pod, el de 0.3 no puede tener más que el de 0.4."""
    por_pod: dict[str, list] = {}
    for nombre, v in ss:
        clave = nombre.split(",le=")[0] if "_bucket" in nombre else None
        por_pod.setdefault(clave, []).append([nombre, v])
    out = []
    for clave, lista in por_pod.items():
        if clave is not None:
            for i in range(len(lista) - 2, -1, -1):
                lista[i][1] = np.minimum(lista[i][1], lista[i + 1][1])
        out += [tuple(x) for x in lista]
    return out


def ventana() -> None:
    n = leer_json(NACIMIENTO)
    if not n:
        sys.exit("✗ no hay historia de métricas: corre python mundo/crear.py")
    print(f"--start {n['inicio']} --end {n['fin']}")


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else ""
    {"s3": s3_historia, "metricas": metricas, "ventana": ventana}.get(que, lambda: sys.exit(__doc__))()
