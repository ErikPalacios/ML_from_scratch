"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca tu código (pipeline/, dvc.yaml).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py. La falla activa se guarda como un hash en .taller/:
ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import secrets
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CORRIDAS, DATOS, ENTRADA, FOTOS, PADRE, PARAMS, RAIZ, TALLER, borrar_todo,  # noqa: E402
                         editar_params, escribir_json, leer_json, params, s3, sh, snapshots, utc, versiones)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
EVENTOS = ENTRADA / "labels-eventos.parquet"
BORRADOS = ENTRADA / "borrados.csv"


def repro() -> None:
    sh("dvc", "repro", timeout=600)


def respaldar(e: dict, *rutas: Path) -> None:
    """Guarda una copia de los archivos que la falla (o tu arreglo) puede cambiar, para dejarlos como estaban."""
    RESPALDO.mkdir(parents=True, exist_ok=True)
    e["respaldo"] = []
    for p in rutas:
        if p.exists():
            shutil.copy(p, RESPALDO / p.name)
            e["respaldo"].append(str(p.relative_to(RAIZ)))
    e["snapshots"] = snapshots(s3())
    e["corridas"] = sorted(c.name for c in CORRIDAS.glob("*.json"))


def devolver(e: dict) -> None:
    """Deja params.yaml, dvc.lock y la entrada como estaban, y quita los snapshots y corridas nuevos."""
    for rel in e.get("respaldo", []):
        shutil.copy(RESPALDO / Path(rel).name, RAIZ / rel)
    s = s3()
    for sid in snapshots(s):
        if sid not in e.get("snapshots", []):
            borrar_todo(s, DATOS, f"datasets/{sid}/")
    for c in CORRIDAS.glob("*.json"):
        if c.name not in e.get("corridas", []):
            c.unlink()
    sh("dvc", "checkout", "--force", timeout=300)   # data/ vuelve a lo que dice dvc.lock (sale de la caché de DVC)
    repro()


# ---------------------------------------------------------------- las fallas
def snapshot_pisado(e: dict) -> None:
    import pandas as pd

    s = s3()
    key = f"datasets/{PADRE}/rows.parquet"
    f = pd.read_parquet(io.BytesIO(s.get_object(Bucket=DATOS, Key=key)["Body"].read()))
    f.loc[f.index[7], "label_id"] = (int(f.loc[f.index[7], "label_id"]) + 3) % 10
    b = io.BytesIO()
    f.to_parquet(b, index=False)
    e["version"] = s.put_object(Bucket=DATOS, Key=key, Body=b.getvalue())["VersionId"]   # un PUT sin If-None-Match


def snapshot_bueno(e: dict) -> None:
    s = s3()
    vs, _ = versiones(s, DATOS, f"datasets/{PADRE}/rows.parquet")
    if any(v["VersionId"] == e["version"] for v in vs) and len(vs) > 1:
        s.delete_object(Bucket=DATOS, Key=f"datasets/{PADRE}/rows.parquet", VersionId=e["version"])


def tarjeta_borrada(e: dict) -> None:
    s = s3()
    sid = params()["snapshot"]["id"]
    e["marcas"] = {}
    for n in ("snapshot.json", "validation.json"):
        r = s.delete_object(Bucket=DATOS, Key=f"datasets/{sid}/{n}")
        e["marcas"][f"datasets/{sid}/{n}"] = r.get("VersionId")


def tarjeta_buena(e: dict) -> None:
    s = s3()
    for key, vid in e["marcas"].items():
        _, ms = versiones(s, DATOS, key)
        if any(m["VersionId"] == vid for m in ms):
            s.delete_object(Bucket=DATOS, Key=key, VersionId=vid)


def latest(e: dict) -> None:
    e["antes"] = params()["entrenar"]["snapshot"]
    editar_params("entrenar.snapshot", "latest")


def umbral(e: dict) -> None:
    respaldar(e, PARAMS, RAIZ / "dvc.lock")
    editar_params("split.umbral", 80)


def reentrega(e: dict) -> None:
    import pandas as pd

    respaldar(e, PARAMS, RAIZ / "dvc.lock", EVENTOS)
    ev = pd.read_parquet(EVENTOS)
    corte = utc(params()["snapshot"]["corte"])
    vig = ev[(ev["ts"] < corte - timedelta(days=30))].groupby("image_key").tail(1)
    vig = vig[vig["label_source"] == "vendedor"].sort_values("image_key").iloc[::40].head(40)
    nuevos = pd.DataFrame({
        "event_id": [f"e-9{i:05d}" for i in range(1, len(vig) + 1)], "image_key": vig["image_key"].values,
        "label_id": ((vig["label_id"] + 1) % 10).astype("int64").values, "label_source": "moderador", "guia_version": None,
        "ts": [datetime(2026, 9, 20, 15, tzinfo=timezone.utc) + timedelta(minutes=7 * i) for i in range(len(vig))]})
    nuevos["ts"] = pd.to_datetime(nuevos["ts"], utc=True)
    pd.concat([ev, nuevos]).sort_values(["ts", "image_key"]).reset_index(drop=True).to_parquet(EVENTOS, index=False)


def foto_borrada(e: dict) -> None:
    import pandas as pd

    s = s3()
    sid = params()["entrenar"]["snapshot"]
    f = pd.read_parquet(io.BytesIO(s.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()))
    borr = set(pd.read_csv(BORRADOS)["image_sha256"])
    cuantas = f[~f["image_sha256"].isin(borr)].groupby("seller_id").size()
    vendedor = cuantas[(cuantas >= 4) & (cuantas <= 7)].index[3]
    respaldar(e, PARAMS, RAIZ / "dvc.lock", BORRADOS)
    (RESPALDO / "fotos").mkdir(parents=True, exist_ok=True)
    e["vendedor"], e["fotos"] = vendedor, []
    pubs = pd.read_parquet(ENTRADA / "publicaciones.parquet")
    for k in pubs.loc[pubs["seller_id"] == vendedor, "image_key"]:
        try:
            b = s.get_object(Bucket=FOTOS, Key=k)["Body"].read()
        except s.exceptions.NoSuchKey:
            continue
        (RESPALDO / "fotos" / k.replace("/", "_")).write_bytes(b)
        e["fotos"].append(k)
        s.delete_object(Bucket=FOTOS, Key=k)


def foto_buena(e: dict) -> None:
    s = s3()
    for k in e["fotos"]:
        s.put_object(Bucket=FOTOS, Key=k, Body=(RESPALDO / "fotos" / k.replace("/", "_")).read_bytes(), ContentType="image/jpeg")
    devolver(e)


FALLAS = {
    "snapshot-pisado": dict(
        tipo="mundo", titulo="El snapshot de agosto ya no es el de agosto",
        historia="Una analista encontró una etiqueta mal en el snapshot de agosto y la «arregló» directo en el bucket, para no esperar al de septiembre. Dice que fue una sola fila.",
        explica="Alguien subió otro rows.parquet a datasets/ds-2026-08-01/ con un PUT normal (sin If-None-Match). S3 no da error: guarda una versión nueva y esa es la que se lee. La huella ya no coincide con rows_sha256 de la tarjeta, así que el modelo de septiembre ya no se puede reproducir y la validación del split estable lee un padre falso. Se ve con python mundo/s3.py versiones ml-datos datasets/ds-2026-08-01/ (rows.parquet tiene 2 versiones; la anterior tiene la huella de la tarjeta). Arreglo: borrar la versión mala, la vigente: python mundo/s3.py borrar-version ml-datos datasets/ds-2026-08-01/rows.parquet <version_id>. La buena vuelve a ser la vigente. La corrección de la etiqueta, si es real, va como evento nuevo y entra en el snapshot siguiente.",
        aplicar=snapshot_pisado, deshacer=snapshot_bueno),
    "tarjeta-borrada": dict(
        tipo="mundo", titulo="El entrenamiento dice que el snapshot de septiembre no existe",
        historia="El job de limpieza de staging/ tenía mal el prefijo y anoche corrió sobre datasets/: borra los .json «viejos». Nadie vio el error porque el job salió en verde.",
        explica="Se borraron snapshot.json y validation.json de datasets/ds-2026-09-01/. Con el versionado prendido, un DELETE sin version_id no borra nada: pone una marca de borrado (delete marker) encima, y la llave parece no existir. Un snapshot sin tarjeta no existe, así que entrenar y verificar se niegan. Se ve con python mundo/s3.py versiones ml-datos datasets/ds-2026-09-01/ (MARCA DE BORRADO vigente sobre cada .json). Arreglo: borrar cada marca: python mundo/s3.py borrar-version ml-datos <llave> <version_id de la marca>. La versión de abajo vuelve a ser la vigente. En AWS, una política del bucket que niegue s3:DeleteObject en datasets/ lo habría impedido.",
        aplicar=tarjeta_borrada, deshacer=tarjeta_buena),
    "versiones-apagadas": dict(
        tipo="infra", titulo="La factura bajó y nadie sabe por qué",
        historia="Plataforma revisó la factura de almacenamiento del mes y «optimizó» los buckets de ML. Mandó un correo, pero se fue a spam.",
        explica="El versionado de ml-datos quedó suspendido (Suspended). Sin versiones, un PUT sin If-None-Match reemplaza el objeto para siempre y un DELETE lo borra de verdad: ya no hay forma de deshacer ni rastro de quién reescribió qué. La escritura condicional sigue funcionando, pero la red de seguridad desapareció. Se ve con python mundo/s3.py versionado ml-datos. Arreglo: python mundo/s3.py versionado ml-datos on. En S3 real, un bucket con versionado nunca vuelve a «sin versionado»: solo se suspende.",
        aplicar=lambda e: s3().put_bucket_versioning(Bucket=DATOS, VersioningConfiguration={"Status": "Suspended"}),
        deshacer=lambda e: s3().put_bucket_versioning(Bucket=DATOS, VersioningConfiguration={"Status": "Enabled"})),
    "latest": dict(
        tipo="config", titulo="Ya no hay que editar params.yaml cada mes",
        historia="Un compañero se cansó de cambiar el id del snapshot cada mes y dejó el entrenamiento «para que siempre agarre el más nuevo».",
        explica="params.yaml quedó con entrenar.snapshot: latest. «latest» es un nombre que cambia de contenido: la corrida guardaría un puntero que no dice con qué datos entrenó, y la caché de un orquestador vería la misma llave dos meses seguidos y reusaría el modelo viejo. Arreglo: entrenar.snapshot vuelve a ser el id, ds-2026-09-01 (el que está en snapshot.id). El id se pasa como parámetro; el trabajo de cambiarlo cada mes es del orquestador, no de una carpeta mágica.",
        aplicar=latest, deshacer=lambda e: editar_params("entrenar.snapshot", e["antes"])),
    "umbral-movido": dict(
        tipo="config", titulo="Más validación para medir mejor",
        historia="Producto pidió medir con más ejemplos. Alguien subió la validación del 10 % al 20 % en params.yaml y dejó una nota: «solo es un número».",
        explica="split.umbral pasó de 90 a 80: los vendedores con cubeta 80–89 pasan de train a val. Muchos ya estaban en train en ds-2026-08-01, así que el modelo de septiembre ya los vio: la validación nueva no es justa para comparar. dvc status lo marca (cambió un parámetro del stage split); si corres dvc repro, la validación falla en split_estable y no se publica nada (escribir, auditar, publicar). Arreglo: split.umbral vuelve a 90 y dvc repro (DVC recupera de su caché la salida que ya tenía para esos parámetros). Si de verdad se quiere más validación, se hace con vendedores nuevos, nunca moviendo a los viejos.",
        aplicar=umbral, deshacer=devolver),
    "labels-reentregados": dict(
        tipo="mundo", titulo="La estación 1 reentregó los labels de septiembre",
        historia="La estación 1 avisó que el primer export de eventos de septiembre salió incompleto: faltaban 40 correcciones de moderación. Ya dejaron el archivo nuevo en entrada/.",
        explica="entrada/labels-eventos.parquet cambió: trae 40 eventos de moderación del 20 de septiembre, antes del corte. dvc status marca el stage labels. Si corres dvc repro, todo pasa hasta publicar, y ahí S3 responde 412: ds-2026-09-01 ya existe con otro contenido. Es correcto que falle. El snapshot publicado no se toca (la corrida que lo usó sigue siendo reproducible); el contenido nuevo lleva un id nuevo. Arreglo: snapshot.id y entrenar.snapshot pasan a ds-2026-09-01-r2 en params.yaml, git commit, dvc repro (publica r2 con parent ds-2026-08-01), git commit de dvc.lock y python pipeline/6_entrenar.py.",
        aplicar=reentrega, deshacer=devolver),
    "foto-borrada": dict(
        tipo="mundo", titulo="Faltan fotos de una vendedora",
        historia="Soporte atendió una solicitud de borrado de una vendedora y borró sus fotos del bucket del producto, como dice el proceso. A ML nadie le avisó.",
        explica="Se borraron las fotos de un vendedor del bucket fotos, pero sus huellas no están en entrada/borrados.csv. El snapshot de entrenamiento las cita, y al leer no existen: entrenar se detiene. No se reescribe el snapshot (es inmutable): se anota el borrado. Arreglo: encontrar sus huellas (en data/rows.parquet o con pipeline/7_linaje.py), agregarlas a entrada/borrados.csv con la fecha de hoy en UTC y el motivo, dvc repro (el stage split vuelve a correr, y como el registro se lee al corte, no cambia nada) y git commit. El snapshot siguiente ya no las incluirá; el modelo actual se decide aparte.",
        aplicar=foto_borrada, deshacer=foto_buena),
}


# ---------------------------------------------------------------- comandos
def h(sal: str, falla: str) -> str:
    return hashlib.sha256(f"{sal}|{falla}".encode()).hexdigest()


def activa(e: dict) -> str | None:
    return next((f for f in FALLAS if h(e["sal"], f) == e["hash"]), None) if e else None


def verificar(silencio: bool = True) -> list[str]:
    import verificar as v

    r = v.correr(list(v.CHECKS), silencio=silencio)
    return [k for k, (ok, _) in r.items() if not ok]


def romper(mostrar: bool, cual: str | None) -> None:
    if leer_json(ESTADO):
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    print("  rompiendo… (puede tardar unos segundos)")
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    if como != "Restaurada":  # arreglada o revelada: queda en taller/progreso.json con su tiempo, para tu tablero
        from taller.registro import anotar_falla

        anotar_falla(falla, e["inicio"], e.get("mostrada", False), rendido=como == "Revelada")
    minutos = (datetime.now(timezone.utc) - datetime.fromisoformat(e["inicio"])).total_seconds() / 60
    print(f"{como}: era «{falla}» · {f['titulo']} · {minutos:.0f} min\n  {f['explica']}")
    print("  restaurando…")
    f["deshacer"](e)
    ESTADO.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else f"⚠ después de restaurar falla: {', '.join(malos)} (corre verificar.py)")
    if sh("git", "status", "--porcelain", "--", "params.yaml", "dvc.lock", "entrada").stdout.strip():
        print("  params.yaml, dvc.lock o entrada/ volvieron a como estaban antes de la falla: git commit -am «vuelve al mundo sano»")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mostrar", action="store_true")
    ap.add_argument("--falla")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--verificar", action="store_true")
    g.add_argument("--revelar", action="store_true")
    g.add_argument("--restaurar", action="store_true")
    a = ap.parse_args()
    e = leer_json(ESTADO)
    if not (a.verificar or a.revelar or a.restaurar):
        return romper(a.mostrar, a.falla)
    falla = activa(e)
    if not falla:
        sys.exit("No hay ninguna falla activa.")
    if a.verificar:
        malos = verificar(silencio=False)
        if malos:
            sys.exit(f"\n✗ todavía no: {len(malos)} check(s) sin pasar")
        print()
        return cerrar(e, falla, "✓ arreglado")
    cerrar(e, falla, "Revelada" if a.revelar else "Restaurada")


if __name__ == "__main__":
    main()
