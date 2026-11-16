"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python verificar.py                    # todos
    python verificar.py labels split       # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el S3 local arriba (docker compose up -d).
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CORRIDAS, DATA, DATOS, ENTRADA, FOTOS, ID_RX, PADRE, RAIZ, git, leer_entrada,  # noqa: E402
                         params, ref_filas, ref_labels, s3, sha256, sh, snapshots, utc, versiones)

COL_LABELS = ["image_key", "label_id", "label_source", "guia_version", "label_ts"]
COL_MANIFEST = ["image_key", "image_sha256", "seller_id", "label_id", "label_source", "guia_version", "label_ts", "created_at", "bytes"]
COL_ROWS = COL_MANIFEST + ["split"]
CHECKS_VALIDACION = ["esquema", "categorias", "duplicados", "golden", "split_vendedor", "split_estable", "volumen", "vendedor"]
CAMPOS_TARJETA = ["snapshot_id", "parent", "corte", "created_at", "rows_path", "rows_sha256", "counts", "label_sources", "split", "code", "validation"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def parquet(p: Path, columnas: list[str]):
    import pandas as pd

    exige(p.exists(), f"no existe {p.relative_to(RAIZ)}: corre su paso del pipeline")
    df = pd.read_parquet(p)
    exige(list(df.columns) == columnas, f"{p.relative_to(RAIZ)}: columnas {list(df.columns)}; el contrato pide {columnas}")
    return df


def obj(s, bucket: str, key: str) -> bytes | None:
    try:
        return s.get_object(Bucket=bucket, Key=key)["Body"].read()
    except s.exceptions.NoSuchKey:
        return None


def tarjeta(s, sid: str) -> dict | None:
    b = obj(s, DATOS, f"datasets/{sid}/snapshot.json")
    return json.loads(b) if b else None


def filas_publicadas(s, sid: str):
    import pandas as pd

    t = tarjeta(s, sid)
    exige(t, f"{sid} no tiene tarjeta (datasets/{sid}/snapshot.json): un snapshot sin tarjeta no existe")
    b = obj(s, DATOS, f"datasets/{sid}/rows.parquet")
    exige(b, f"{sid} no tiene rows.parquet")
    exige(sha256(b) == t["rows_sha256"], f"las filas de {sid} no coinciden con su tarjeta (rows_sha256): alguien las reescribió")
    return t, pd.read_parquet(io.BytesIO(b))


def esperado():
    p = params()
    corte = utc(p["snapshot"]["corte"])
    ev, pubs, golden, borr = leer_entrada()
    labels = ref_labels(ev, corte, p["labels"]["dias_maduracion"])
    return p, corte, ev, pubs, golden, borr, labels


def correr_corrida() -> dict:
    exige(CORRIDAS.exists(), "no existe corridas/: corre pipeline/6_entrenar.py")
    cs = sorted((json.loads(c.read_text()) for c in CORRIDAS.glob("*.json")), key=lambda c: c.get("fecha", ""))
    return cs


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    s = s3()
    try:
        buckets = {b["Name"] for b in s.list_buckets()["Buckets"]}
    except Exception as e:  # noqa: BLE001
        raise Falla(f"el S3 local no responde en localhost:9300 ({type(e).__name__}): docker compose up -d")
    exige({FOTOS, DATOS} <= buckets, f"faltan buckets ({sorted({FOTOS, DATOS} - buckets)}): python mundo/crear.py")
    for f in ("publicaciones.parquet", "labels-eventos.parquet", "golden.parquet", "borrados.csv", "categorias.json"):
        exige((ENTRADA / f).exists(), f"falta entrada/{f}: python mundo/crear.py")
    exige(tarjeta(s, PADRE), f"falta el snapshot padre {PADRE} en s3://{DATOS}/datasets/: python mundo/crear.py")
    r = sh("dvc", "--version")
    exige(r.returncode == 0, "no encuentro dvc: activa el entorno (source .venv/bin/activate) e instala requirements.txt")
    exige(git("rev-parse", "--is-inside-work-tree") == "true", "esta carpeta no es un repositorio de git: git init (paso 0)")
    exige(git("rev-parse", "HEAD"), "el repositorio no tiene commits todavía: git add -A && git commit -m kit")
    exige((RAIZ / ".dvc").is_dir(), "falta dvc init (paso 0)")
    n = s.list_objects_v2(Bucket=FOTOS, MaxKeys=1000)
    return f"S3 local con fotos ({n.get('KeyCount', 0)}{'+' if n.get('IsTruncated') else ''}) y ml-datos ({PADRE} publicado) · entrada/ completa · git y DVC {r.stdout.strip()}"


def check_labels() -> str:
    p, corte, ev, *_, labels = esperado()
    df = parquet(DATA / "labels.parquet", COL_LABELS)
    exige(df["image_key"].is_unique, f"data/labels.parquet tiene {df['image_key'].duplicated().sum()} fotos repetidas: una fila por foto, la del evento más reciente")
    exige(not (df["label_ts"] >= corte).any(), f"{(df['label_ts'] >= corte).sum()} labels son de después del corte ({p['snapshot']['corte']}): point-in-time, solo lo que ya existía")
    tuyo = set(map(tuple, df[["image_key", "label_id", "label_source"]].astype(str).values))
    ref = set(map(tuple, labels[["image_key", "label_id", "label_source"]].astype(str).values))
    sobran, faltan = tuyo - ref, ref - tuyo
    if sobran or faltan:
        verdes = df[(df["label_source"] == "vendedor")]
        import pandas as pd
        tiernos = (verdes["label_ts"] > corte - pd.Timedelta(days=p["labels"]["dias_maduracion"])).sum()
        pista = (f"; {tiernos} son elecciones de quien vende con menos de {p['labels']['dias_maduracion']} días" if tiernos
                 else "; revisa que gane el evento más reciente de cada foto")
        raise Falla(f"tus labels no son los vigentes al corte: sobran {len(sobran)}, faltan {len(faltan)}{pista}")
    return f"{len(df)} labels vigentes al {p['snapshot']['corte']} · {df['label_source'].value_counts().to_dict()}"


def check_manifest() -> str:
    _, _, _, pubs, *_, labels = esperado()
    df = parquet(DATA / "manifest.parquet", COL_MANIFEST)
    lb = parquet(DATA / "labels.parquet", COL_LABELS)
    exige(len(df) == len(lb) and set(df["image_key"]) == set(lb["image_key"]), f"el manifest tiene {len(df)} filas y labels.parquet {len(lb)}: una fila por label")
    exige(df.notna().drop(columns=["guia_version"]).all().all(), "el manifest tiene huecos (nulos) fuera de guia_version")
    ref = pubs.set_index("image_key")["image_sha256"]
    malas = (df.set_index("image_key")["image_sha256"] != ref.reindex(df["image_key"]).values).sum()
    exige(malas == 0, f"{malas} filas tienen una huella distinta a la de publicaciones.parquet")
    pesa = (DATA / "manifest.parquet").stat().st_size
    return f"{len(df)} filas, cada una con su llave y su huella · manifest {pesa / 1e3:.0f} kB · cita {df['bytes'].sum() / 1e6:.1f} MB de fotos"


def check_split() -> str:
    p, corte, ev, pubs, golden, borr, labels = esperado()
    df = parquet(DATA / "rows.parquet", COL_ROWS)
    exige(df["image_sha256"].is_unique, f"{df['image_sha256'].duplicated().sum()} huellas repetidas: la misma foto en dos publicaciones cuenta una vez (la más vieja)")
    n_gold = df["image_sha256"].isin(set(golden["image_sha256"])).sum()
    exige(n_gold == 0, f"{n_gold} fotos del golden set en las filas: el golden set nunca entra a entrenar")
    fuera = set(borr.loc[borr["fecha"] < corte, "image_sha256"])
    exige(not df["image_sha256"].isin(fuera).any(), f"{df['image_sha256'].isin(fuera).sum()} fotos borradas antes del corte siguen en las filas")
    exige(df.groupby("seller_id")["split"].nunique().max() == 1, "hay vendedores con fotos en train y en val: el split es por seller_id")
    ref = ref_filas(labels, pubs, golden, borr, corte, p["split"]["umbral"])
    exige(set(df["image_key"]) == set(ref["image_key"]),
          f"tus filas no son las esperadas ({len(df)} contra {len(ref)}); de los duplicados se queda la publicación más vieja")
    lado = dict(zip(ref["image_key"], ref["split"]))
    mal = sum(lado[k] != s for k, s in zip(df["image_key"], df["split"]))
    exige(mal == 0, f"{mal} filas en el split equivocado: train si sha256(seller_id) mod 100 < {p['split']['umbral']}")
    exige(list(df["image_key"]) == sorted(df["image_key"]), "data/rows.parquet no está ordenado por image_key: el mismo contenido tiene que dar la misma huella")
    return f"{len(df)} filas: sin duplicados, sin golden, sin borrados · {df['split'].value_counts().to_dict()} por vendedor"


def check_split_estable() -> str:
    p = params()
    df = parquet(DATA / "rows.parquet", COL_ROWS)
    _, padre = filas_publicadas(s3(), p["snapshot"]["padre"])
    a = padre.drop_duplicates("seller_id").set_index("seller_id")["split"]
    b = df.drop_duplicates("seller_id").set_index("seller_id")["split"]
    comunes = a.index.intersection(b.index)
    movidos = [x for x in comunes if a[x] != b[x]]
    if movidos:
        raise Falla(f"{len(movidos)} vendedores cambiaron de lado contra {p['snapshot']['padre']} (por ejemplo {movidos[0]}: "
                       f"{a[movidos[0]]} → {b[movidos[0]]}). El split no se vuelve a sortear: revisa split.umbral")
    va = set(padre.loc[padre["split"] == "val", "image_sha256"])
    exige(not df.loc[df["split"] == "train", "image_sha256"].isin(va).any(), "fotos que eran de validación en el padre ahora están en train")
    return f"{len(comunes)} vendedores en los dos snapshots, 0 cambiaron de lado · ninguna foto de val del padre en train"


def check_validacion() -> str:
    p = params()
    f = DATA / "validation.json"
    exige(f.exists(), "no existe data/validation.json: corre pipeline/4_validar.py")
    v = json.loads(f.read_text())
    faltan = [c for c in CHECKS_VALIDACION if c not in v.get("checks", {})]
    exige(not faltan, f"a la validación le faltan checks: {faltan}")
    exige(v.get("snapshot_id") == p["snapshot"]["id"], f"validation.json es de {v.get('snapshot_id')}, no de {p['snapshot']['id']}")
    malos = {k: x for k, x in v["checks"].items() if x != "ok"}
    exige(v.get("status") == "passed" and not malos, f"la validación no pasó: {malos or v.get('status')}")
    return f"passed: {', '.join(CHECKS_VALIDACION)}"


def check_snapshot() -> str:
    p = params()
    sid = p["snapshot"]["id"]
    exige(ID_RX.match(sid), f"snapshot.id = «{sid}» no es un id (ds-AAAA-MM-DD o ds-AAAA-MM-DD-rN)")
    s = s3()
    t = tarjeta(s, sid)
    exige(t, f"{sid} no tiene tarjeta en s3://{DATOS}/datasets/{sid}/snapshot.json: publícalo (pipeline/5_publicar.py) o "
             "revisa si alguien la borró (python mundo/s3.py versiones ml-datos datasets/" + sid + "/)")
    falta = [c for c in CAMPOS_TARJETA if c not in t]
    exige(not falta, f"a la tarjeta le faltan campos: {falta}")
    exige(obj(s, DATOS, f"datasets/{sid}/validation.json"), f"datasets/{sid}/validation.json no está")
    t, filas = filas_publicadas(s, sid)
    local = DATA / "rows.parquet"
    exige(local.exists() and sha256(local.read_bytes()) == t["rows_sha256"],
          "data/rows.parquet no es lo que está publicado: tu pipeline cambió algo que el snapshot no tiene (dvc status)")
    exige(t["parent"] == p["snapshot"]["padre"], f"la tarjeta dice parent = {t['parent']}; params.yaml, {p['snapshot']['padre']}")
    exige(t["corte"] == p["snapshot"]["corte"], f"la tarjeta dice corte = {t['corte']}; params.yaml, {p['snapshot']['corte']}")
    c = t["counts"]
    exige(c.get("total") == len(filas) and c.get("train", 0) + c.get("val", 0) == len(filas), f"los conteos de la tarjeta ({c}) no cuadran con las {len(filas)} filas")
    commit = (t.get("code") or {}).get("commit", "")
    exige(commit and sh("git", "cat-file", "-e", f"{commit}^{{commit}}").returncode == 0, f"code.commit = «{commit}» no es un commit de este repositorio")
    return f"{sid}: {c['total']} filas ({c['train']} train · {c['val']} val) · rows_sha256 {t['rows_sha256'][:12]}… · parent {t['parent']} · commit {commit[:7]}"


def check_inmutable() -> str:
    s = s3()
    st = s.get_bucket_versioning(Bucket=DATOS).get("Status")
    exige(st == "Enabled", f"el versionado de {DATOS} está «{st or 'apagado'}»: sin versiones, un PUT o un borrado no deja rastro ni se puede deshacer")
    pub = RAIZ / "pipeline" / "5_publicar.py"
    exige(pub.exists() and "IfNoneMatch" in pub.read_text(), "pipeline/5_publicar.py no usa escritura condicional (IfNoneMatch=\"*\")")
    ids = snapshots(s)
    for sid in ids:
        filas_publicadas(s, sid)
        vs, ms = versiones(s, DATOS, f"datasets/{sid}/")
        if ms:
            raise Falla(f"{ms[0]['Key']} tiene una marca de borrado (delete marker): alguien lo borró")
        cuenta = {}
        for v in vs:
            cuenta[v["Key"]] = cuenta.get(v["Key"], 0) + 1
        dobles = [k for k, n in cuenta.items() if n > 1]
        if dobles:
            raise Falla(f"{dobles[0]} tiene {cuenta[dobles[0]]} versiones: alguien lo reescribió")
    return f"versionado Enabled · {len(ids)} snapshots ({', '.join(ids)}): cada llave escrita una sola vez y cada uno igual a su tarjeta"


def check_dag() -> str:
    import yaml

    f = RAIZ / "dvc.yaml"
    exige(f.exists(), "falta dvc.yaml: el pipeline como DAG (paso 6)")
    st = (yaml.safe_load(f.read_text()) or {}).get("stages", {})
    faltan = [x for x in ("labels", "manifest", "split", "validar", "publicar") if x not in st]
    exige(not faltan, f"a dvc.yaml le faltan stages: {faltan}")

    def declara(stage: str, *ps: str) -> None:
        tiene = set()
        for x in st[stage].get("params", []) or []:
            tiene |= set(x) if isinstance(x, dict) else {x}
        for q in ps:
            exige(q in tiene or q.split(".")[0] in tiene,
                  f"el stage «{stage}» lee {q} pero no lo declara en params: si cambia, DVC no lo vuelve a correr y reusa la salida vieja")

    declara("labels", "snapshot.corte", "labels.dias_maduracion")
    declara("split", "snapshot.corte", "split.umbral")
    declara("publicar", "snapshot.id")
    deps = set(st["split"].get("deps", []))
    exige({"entrada/borrados.csv", "entrada/golden.parquet"} <= deps, "el stage «split» tiene que depender de entrada/borrados.csv y entrada/golden.parquet")
    r = sh("dvc", "status", "--json")
    exige(r.returncode == 0, f"dvc status falló: {r.stderr.strip()[:200]}")
    cambios = json.loads(r.stdout or "{}")
    exige(not cambios, f"dvc status: el pipeline no está al día ({', '.join(cambios)} cambiaron). Corre dvc repro y mira qué pasa")
    return f"{len(st)} stages, con sus params declarados · dvc status: al día"


def check_corrida() -> str:
    p = params()
    sid = str(p["entrenar"]["snapshot"])
    exige(ID_RX.match(sid), f"entrenar.snapshot = «{sid}»: tiene que ser un id de snapshot. Una carpeta como «latest» cambia de "
                           "contenido sin cambiar de nombre, y la corrida no podría decir con qué entrenó")
    t = tarjeta(s3(), sid)
    exige(t, f"entrenar.snapshot = {sid}, pero {sid} no tiene tarjeta")
    cs = [c for c in correr_corrida() if c.get("repo") != "ml-catalogo"]   # la de agosto es del equipo
    exige(cs, "no hay corridas tuyas en corridas/: python pipeline/6_entrenar.py")
    c = cs[-1]
    falta = [k for k in ("run_id", "modelo", "fecha", "snapshot", "rows_sha256", "commit", "arbol_limpio", "entorno_sha256", "semilla", "metricas", "filas") if k not in c]
    exige(not falta, f"a la corrida {c.get('run_id')} le faltan campos: {falta}")
    exige(c["snapshot"] == sid, f"tu última corrida ({c['run_id']}) entrenó con {c['snapshot']}; params.yaml pide {sid}: vuelve a entrenar")
    exige(c["rows_sha256"] == t["rows_sha256"], f"la corrida guarda rows_sha256 {c['rows_sha256'][:12]}…; la tarjeta de {sid}, {t['rows_sha256'][:12]}…")
    exige(sh("git", "cat-file", "-e", f"{c['commit']}^{{commit}}").returncode == 0, f"commit {c['commit'][:7]} de la corrida no existe en este repositorio")
    exige(c["arbol_limpio"] is True, "la corrida se hizo con cambios sin commit: el commit no dice qué código corrió")
    exige(re.fullmatch(r"[0-9a-f]{64}", str(c["entorno_sha256"])), "entorno_sha256 tiene que ser una huella sha256 (64 caracteres hexadecimales)")
    exige(c["semilla"] == p["entrenar"]["semilla"], f"la corrida usó la semilla {c['semilla']}; params.yaml dice {p['entrenar']['semilla']}")
    return f"{c['run_id']} · {c['modelo']} ← {sid} ({c['rows_sha256'][:12]}…) · commit {c['commit'][:7]} · entorno {c['entorno_sha256'][:12]}… · accuracy_val {c['metricas'].get('accuracy_val')}"


def check_lectura() -> str:
    import pandas as pd

    p = params()
    sid = str(p["entrenar"]["snapshot"])
    exige(ID_RX.match(sid), f"entrenar.snapshot = «{sid}» no es un id")
    s = s3()
    _, filas = filas_publicadas(s, sid)
    borr = set(pd.read_csv(ENTRADA / "borrados.csv")["image_sha256"])
    leer = filas[~filas["image_sha256"].isin(borr)]

    def una(f):
        b = obj(s, FOTOS, f.image_key)
        return f.image_key, f.seller_id, "no existe" if b is None else (None if sha256(b) == f.image_sha256 else "otra huella")

    with ThreadPoolExecutor(16) as ex:
        malas = [x for x in ex.map(una, leer.itertuples()) if x[2]]
    if malas:
        vend = sorted({v for _, v, _ in malas})
        raise Falla(f"{len(malas)} fotos de {sid} no se pueden leer ({malas[0][0]}: {malas[0][2]}; vendedores {', '.join(vend)}) "
                    "y no están en entrada/borrados.csv")
    return f"{sid}: {len(leer)} fotos existen y su huella coincide · {len(filas) - len(leer)} filas en el registro de borrados (se saltan)"


def check_linaje() -> str:
    import pandas as pd

    s = s3()
    script = RAIZ / "pipeline" / "7_linaje.py"
    exige(script.exists(), "falta pipeline/7_linaje.py")
    ids = snapshots(s)
    filas = {sid: filas_publicadas(s, sid)[1] for sid in ids if tarjeta(s, sid)}
    cs = correr_corrida()
    sid = str(params()["entrenar"]["snapshot"])
    exige(sid in filas, f"no encuentro el snapshot de entrenamiento {sid}")
    borr = pd.read_csv(ENTRADA / "borrados.csv")
    h_borr = borr["image_sha256"].iloc[0]                                      # una foto borrada: solo en el padre
    comunes = set(filas[PADRE]["image_sha256"]) & set(filas[sid]["image_sha256"])
    h_ambos = sorted(comunes)[0]                                               # una foto que está en los dos
    out = []
    for h in (h_borr, h_ambos):
        r = subprocess.run([sys.executable, str(script), h, "--json"], cwd=RAIZ, capture_output=True, text=True, timeout=120)
        exige(r.returncode == 0, f"7_linaje.py {h[:12]}… falló: {(r.stderr or r.stdout).strip()[-200:]}")
        try:
            j = json.loads(r.stdout)
        except json.JSONDecodeError:
            raise Falla("7_linaje.py --json no imprimió JSON")
        dentro = sorted(x for x, f in filas.items() if (f["image_sha256"] == h).any())
        usan = sorted(c["run_id"] for c in cs if c["snapshot"] in dentro)
        exige(sorted(x["id"] for x in j.get("snapshots", [])) == dentro, f"para {h[:12]}… esperaba los snapshots {dentro}; salió {[x.get('id') for x in j.get('snapshots', [])]}")
        exige(sorted(x["run_id"] for x in j.get("corridas", [])) == usan, f"para {h[:12]}… esperaba las corridas {usan}; salió {[x.get('run_id') for x in j.get('corridas', [])]}")
        en_borr = bool((borr["image_sha256"] == h).any())
        exige(bool(j.get("borrado")) == en_borr, f"para {h[:12]}… el registro de borrados {'sí' if en_borr else 'no'} la tiene")
        out.append(f"{h[:8]}… → {len(dentro)} snapshots, {len(usan)} corridas{', borrada' if en_borr else ''}")
    return " · ".join(out)


CHECKS = {
    "mundo": check_mundo, "labels": check_labels, "manifest": check_manifest, "split": check_split,
    "split-estable": check_split_estable, "validacion": check_validacion, "snapshot": check_snapshot,
    "inmutable": check_inmutable, "dag": check_dag, "corrida": check_corrida, "lectura": check_lectura, "linaje": check_linaje,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<14} {msg}")
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
