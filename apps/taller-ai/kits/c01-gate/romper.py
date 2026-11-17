"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca tu código (pipeline/).

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
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CANDIDATO, CLASES, CORRIDA_YAML, DATOS, FOTOS, GATE_YAML, GOLDEN, MODELO, PROVEEDOR, RAIZ,  # noqa: E402
                         SNAPSHOT, TALLER, corrida_por_nombre, editar_yaml, escribir_json, filas, leer_json,
                         mlflow_arriba, mlflow_cliente, s3, sh, sha256, tarjeta)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
MANIFEST = f"golden/{GOLDEN}/manifest.json"
EQUIPO = {"GIT_AUTHOR_NAME": "Equipo de búsqueda", "GIT_AUTHOR_EMAIL": "busqueda@c01.test"}


def respaldar(e: dict, *rutas: Path) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    e["respaldo"] = []
    for p in rutas:
        rel = str(p.relative_to(RAIZ))
        shutil.copy(p, RESPALDO / rel.replace("/", "__"))
        e["respaldo"].append(rel)


def devolver(e: dict) -> None:
    for rel in e.get("respaldo", []):
        shutil.copy(RESPALDO / rel.replace("/", "__"), RAIZ / rel)


def commit(archivo: str, msg: str) -> None:
    """Si el archivo quedó distinto del último commit, lo sube con ese mensaje (como alguien del equipo)."""
    if sh("git", "status", "--porcelain", "--", archivo).stdout.strip():
        sh("git", "commit", "-m", msg, "--", archivo, env=EQUIPO)


# ---------------------------------------------------------------- las fallas
def umbral_movido(e: dict) -> None:
    respaldar(e, GATE_YAML)
    editar_yaml(GATE_YAML, "margen_puntos", 4.0)
    editar_yaml(GATE_YAML, "caida_max_puntos", 25)
    commit("gate.yaml", "gate: margen 4.0 y caída por categoría 25 (el modelo del proveedor tiene que salir esta semana)")


def gate_bueno(e: dict) -> None:
    devolver(e)
    commit("gate.yaml", "gate: vuelven las reglas revisadas (PR #41)")


def golden_tocado(e: dict) -> None:
    s = s3()
    e["version"] = next(v["VersionId"] for v in s.list_object_versions(Bucket=DATOS, Prefix=MANIFEST)["Versions"]
                        if v["Key"] == MANIFEST and v["IsLatest"])
    man = json.loads(s.get_object(Bucket=DATOS, Key=MANIFEST)["Body"].read())
    import random

    rng = random.Random(41)
    for f in rng.sample(man["fotos"], 30):          # «corrigió» 30 etiquetas: ahora dicen lo que predice el modelo nuevo
        f["label_id"] = (f["label_id"] + rng.choice([1, 2, 3])) % len(CLASES)
    man["nota"] += " Corregidas 30 etiquetas que estaban mal (revisión del equipo de búsqueda)."
    s.put_object(Bucket=DATOS, Key=MANIFEST, Body=json.dumps(man, ensure_ascii=False, indent=1).encode())


def golden_bueno(e: dict) -> None:
    s = s3()
    if sha256(s.get_object(Bucket=DATOS, Key=MANIFEST)["Body"].read()) != sha256(
            s.get_object(Bucket=DATOS, Key=MANIFEST, VersionId=e["version"])["Body"].read()):
        s.copy_object(Bucket=DATOS, Key=MANIFEST, CopySource={"Bucket": DATOS, "Key": MANIFEST, "VersionId": e["version"]})


def golden_fuga(e: dict) -> None:
    """El equipo reentrenó con «más datos»: un snapshot que trae las fotos del examen."""
    from concurrent.futures import ThreadPoolExecutor

    import pandas as pd
    import torch

    from mundo.equipo import anotar, entrenar, tensores
    from mundo.gateway.preprocess import preprocess

    s, c = s3(), mlflow_cliente()
    sid, nombre = "ds-2026-09-15", f"{CANDIDATO}-r2"
    f = filas(s, SNAPSHOT)
    man = json.loads(s.get_object(Bucket=DATOS, Key=MANIFEST)["Body"].read())["fotos"]
    if not tarjeta(s, sid):
        extra = pd.DataFrame({"image_key": [g["origen"] for g in man], "image_sha256": [g["origen_sha256"] for g in man],
                              "label_id": [g["label_id"] for g in man], "split": "train"})
        f2 = pd.concat([f, extra], ignore_index=True)
        b = io.BytesIO()
        f2.to_parquet(b, index=False)
        s.put_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet", Body=b.getvalue())
        card = {**tarjeta(s, SNAPSHOT), "snapshot_id": sid, "parent": SNAPSHOT, "rows_sha256": sha256(b.getvalue()),
                "counts": {"train": int((f2["split"] == "train").sum()), "val": int((f2["split"] == "val").sum()), "total": len(f2)},
                "nota": "Reconstruido a mano por el equipo de búsqueda «con todas las fotos etiquetadas que había»."}
        s.put_object(Bucket=DATOS, Key=f"datasets/{sid}/snapshot.json", Body=json.dumps(card, ensure_ascii=False, indent=2).encode())
    f2 = filas(s, sid)
    if not corrida_por_nombre(c, nombre):
        print("  (el equipo reentrena el candidato: ≈ 1 min)")
        with ThreadPoolExecutor(16) as ex:
            por_key = dict(zip(f2["image_key"], ex.map(lambda k: s.get_object(Bucket=FOTOS, Key=k)["Body"].read(), f2["image_key"])))
        import mlflow

        v3 = c.get_model_version(MODELO, "3")
        pesos3 = torch.load(mlflow.artifacts.download_artifacts(run_id=v3.run_id, artifact_path="modelo/pesos.pt"), map_location="cpu", weights_only=True)
        p, met, huella = entrenar(*tensores(por_key, f2, preprocess), 3, 17, inicio=pesos3)
        anotar(c, nombre, {"arranque": "champion", "champion_version": 3, "epocas": 3, "semilla": 17, "snapshot": sid},
               met, p, huella, {"snapshot": sid, "rows_sha256": tarjeta(s, sid)["rows_sha256"], "champion_version": "3"},
               "Reentrenado con «más datos» (ds-2026-09-15).")
    respaldar(e, CORRIDA_YAML)
    editar_yaml(CORRIDA_YAML, "candidato", nombre)
    commit("corrida.yaml", f"corrida: el candidato es {nombre} (reentrenado con más datos, sube 3 puntos)")


def corrida_buena(e: dict) -> None:
    devolver(e)
    commit("corrida.yaml", "corrida: vuelve el candidato del pipeline")


def alias_a_mano(e: dict) -> None:
    c = mlflow_cliente()
    run = corrida_por_nombre(c, PROVEEDOR)
    mv = c.create_model_version(MODELO, source=f"runs:/{run.info.run_id}/modelo", run_id=run.info.run_id,
                                tags={"mes": "2026-10", "nota": "subido a mano: ya lo probamos en el notebook y va bien"})
    c.set_registered_model_alias(MODELO, "champion", mv.version)
    e["version"] = str(mv.version)


def alias_bueno(e: dict) -> None:
    c = mlflow_cliente()
    c.set_registered_model_alias(MODELO, "champion", "3")
    try:
        c.delete_model_version(MODELO, e["version"])
    except Exception:  # noqa: BLE001
        pass


def labels_desordenados(e: dict) -> None:
    c = mlflow_cliente()
    run = corrida_por_nombre(c, CANDIDATO)
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "labels.json").write_text(json.dumps(sorted(CLASES), ensure_ascii=False) + "\n")
        c.log_artifact(run.info.run_id, str(Path(d) / "labels.json"), "modelo")   # sobrescribe el de la corrida


def labels_buenos(e: dict) -> None:
    c = mlflow_cliente()
    run = corrida_por_nombre(c, CANDIDATO)
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "labels.json").write_text(json.dumps(CLASES, ensure_ascii=False) + "\n")
        c.log_artifact(run.info.run_id, str(Path(d) / "labels.json"), "modelo")


def mlflow_caido(e: dict) -> None:
    sh("docker", "compose", "stop", "mlflow", timeout=120)


def mlflow_arriba_de_nuevo(e: dict) -> None:
    if not mlflow_arriba():
        sh("docker", "compose", "up", "-d", "--wait", "mlflow", timeout=300)


FALLAS = {
    "umbral-movido": dict(
        tipo="config", titulo="Reglas más flexibles, «solo por esta vez»",
        historia="El equipo de búsqueda necesita que el modelo del proveedor salga esta semana. Alguien de ese equipo subió un commit a gate.yaml directo a main y avisó en el canal: «ya lo destrabé».",
        explica="gate.yaml quedó con margen_puntos: 4.0 y caida_max_puntos: 25, en un commit sin revisión: su sha256 no está en mundo/revisiones.json. Con esas reglas, el candidato del proveedor (camisas −21 puntos) pasaría. Es la trampa de la estación: mover los umbrales después de ver el resultado. El gate deja de medir y empieza a justificar. Tu gate.py se niega a juzgar con reglas que nadie aprobó. Arreglo: git log -p gate.yaml para ver quién y cuándo, git revert del commit, y si de verdad hay que cambiar una regla, va en un PR propio, con su porqué, antes de la corrida siguiente.",
        aplicar=umbral_movido, deshacer=gate_bueno),
    "golden-tocado": dict(
        tipo="mundo", titulo="Alguien «corrigió» el examen",
        historia="El equipo de búsqueda revisó a mano el golden set y escribió en el canal: «había 30 etiquetas mal, ya las arreglé». El modelo nuevo ahora sale mejor.",
        explica="El manifest de golden-v1 en S3 tiene 30 label_id cambiados: su sha256 ya no es el que congeló gate.yaml. Un examen que cambia deja de comparar: las fotos «corregidas» son justo las que el modelo nuevo predice, así que lo favorecen. Tu evaluar.py lo detecta por la huella y se detiene. Arreglo: python mundo/s3.py versiones golden/golden-v1/manifest.json muestra las versiones (el bucket tiene versionado) y python mundo/s3.py restaurar golden/golden-v1/manifest.json <version-id de la primera> devuelve el examen congelado. Si de verdad había etiquetas malas, se publica golden-v2 en un PR propio, y el gate cambia de examen en otro: los dos modelos se vuelven a medir con el nuevo.",
        aplicar=golden_tocado, deshacer=golden_bueno),
    "golden-fuga": dict(
        tipo="mundo", titulo="El candidato que sube 3 puntos",
        historia="El equipo de búsqueda reentrenó el candidato «con más datos» y cambió corrida.yaml para usarlo: «sube 3 puntos en el golden, ¡va!».",
        explica="El candidato nuevo (cand-2026-10-01-r2) se entrenó con ds-2026-09-15, un snapshot armado a mano que trae las 1,000 fotos del examen. Es una fuga (data leakage): el modelo ya vio las respuestas, así que sale mejor en el examen sin ser mejor. Tu evaluar.py cruza las huellas del snapshot del candidato con las del examen y se detiene. Arreglo: git log -p corrida.yaml para ver el cambio y git revert del commit: vuelve el candidato del pipeline. Al equipo se le pide reconstruir el snapshot con el pipeline de la estación 2, que deja fuera el golden set por diseño.",
        aplicar=golden_fuga, deshacer=corrida_buena),
    "alias-a-mano": dict(
        tipo="mundo", titulo="Ya está en producción",
        historia="Esta mañana el equipo de búsqueda escribió: «subimos el modelo del proveedor a producción, ya lo probamos en el notebook». La aceptación de sugerencias de camisas se cayó.",
        explica="Alguien registró a mano el candidato del proveedor (una versión sin gate=passed) y le movió el alias champion. El gateway carga champion, así que eso es producción: un modelo que el gate rechazó por camisas. El registro no impide mover un alias; la regla de que solo CD lo mueve, después del gate y del canary, es del equipo. Arreglo: python mundo/modelos.py versiones para ver qué apunta a qué, y python mundo/modelos.py alias champion 3 para volver al modelo bueno (el rollback es mover el alias, no reentrenar). La versión mal subida se queda sin alias y sin gate=passed: no va a ningún lado.",
        aplicar=alias_a_mano, deshacer=alias_bueno),
    "labels-desordenados": dict(
        tipo="mundo", titulo="La herramienta nueva de export",
        historia="El equipo de plataforma estrenó un script que «limpia» los artefactos de las corridas. Lo corrieron sobre el candidato de octubre anoche.",
        explica="El modelo/labels.json de la corrida cand-2026-10-01 se sobrescribió con las categorías en orden alfabético: los artefactos de una corrida de MLflow se pueden reemplazar. Los pesos son los mismos y la evaluación por índice saldría igual, pero si se registrara así, el gateway mostraría «abrigos» donde el modelo dijo «playeras». Tu evaluar.py compara el labels.json de cada modelo con entrada/categorias.json y se detiene, y la versión del registro guarda labels_sha256 para notar el cambio. Arreglo: python mundo/modelos.py versiones y python verificar.py labels para ver cuál cambió, python mundo/modelos.py labels cand-2026-10-01 para volver a subir el bueno, y otra vez evaluar.py.",
        aplicar=labels_desordenados, deshacer=labels_buenos),
    "mlflow-caido": dict(
        tipo="infra", titulo="El gate no corrió",
        historia="El pipeline de anoche quedó en rojo en el paso del gate y nadie sabe si el candidato es bueno o malo.",
        explica="El servidor de MLflow está apagado (docker compose stop mlflow). Sin el registro no hay champion por número ni corrida del candidato, y el gate no puede anotar su veredicto: falla en segundos, y está bien que falle. Un gate que «pasa» porque no pudo medir es peor que uno en rojo. Arreglo: docker compose ps para ver qué servicio no está, docker compose up -d --wait mlflow y python verificar.py. En C01, MLflow lo opera plataforma; si se cae, el orquestador reintenta el paso.",
        aplicar=mlflow_caido, deshacer=mlflow_arriba_de_nuevo),
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
    print("  revisando que todo esté sano (≈ 10 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    if como != "Restaurada":
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
