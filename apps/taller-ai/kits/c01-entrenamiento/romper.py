"""Mete una falla en el mundo, la configuración, el entorno o la infraestructura. Nunca toca tu código (pipeline/,
pipeline.yaml).

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
import json
import secrets
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CLASES, EXPERIMENTO, GATEWAY, MODELO, RAIZ, RECETA, TALLER, editar_receta,  # noqa: E402
                         escribir_json, leer_json, mlflow_arriba, mlflow_cliente, sh)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
GW_REQ = GATEWAY / "requirements.txt"
REQ = RAIZ / "requirements.txt"


def respaldar(e: dict, *rutas: Path) -> None:
    """Guarda una copia de los archivos que la falla (o tu arreglo) puede cambiar, para dejarlos como estaban."""
    RESPALDO.mkdir(parents=True, exist_ok=True)
    e["respaldo"] = []
    for p in rutas:
        rel = str(p.relative_to(RAIZ))
        shutil.copy(p, RESPALDO / rel.replace("/", "__"))     # con su ruta: hay dos requirements.txt
        e["respaldo"].append(rel)


def devolver(e: dict) -> None:
    for rel in e.get("respaldo", []):
        shutil.copy(RESPALDO / rel.replace("/", "__"), RAIZ / rel)


def commit_receta(msg: str) -> None:
    """Si receta.yaml quedó distinta de la del último commit, la sube con ese mensaje (como alguien del equipo)."""
    if sh("git", "status", "--porcelain", "--", "receta.yaml").stdout.strip():
        sh("git", "commit", "-m", msg, "--", "receta.yaml", env={"GIT_AUTHOR_NAME": "Equipo C01", "GIT_AUTHOR_EMAIL": "equipo@c01.test"})


# ---------------------------------------------------------------- las fallas
def lr_roto(e: dict) -> None:
    respaldar(e, RECETA)
    editar_receta("lr", 0.0)
    commit_receta("receta: lr 0.0 para probar el backbone congelado (vuelvo a ponerlo el lunes)")


def ckpt_espaciado(e: dict) -> None:
    respaldar(e, RECETA)
    editar_receta("ckpt_cada_pasos", 1000)
    commit_receta("receta: menos checkpoints, que S3 cobra por escritura")


def receta_buena(e: dict) -> None:
    devolver(e)
    commit_receta("receta: vuelve la del equipo")


def champion_otro_orden(e: dict) -> None:
    import mlflow
    import torch

    c = mlflow_cliente()
    v1 = c.get_model_version_by_alias(MODELO, "champion")
    e["antes"] = str(v1.version)
    otro = sorted(CLASES)                                   # las mismas categorías, en orden alfabético
    with tempfile.TemporaryDirectory() as d:
        carpeta = Path(mlflow.artifacts.download_artifacts(artifact_uri=v1.source, dst_path=d))
        pesos = torch.load(carpeta / "pesos.pt", map_location="cpu", weights_only=True)
        torch.save(pesos, carpeta / "pesos.pt")
        (carpeta / "labels.json").write_text(json.dumps(otro, ensure_ascii=False) + "\n")
        mlflow.set_experiment(EXPERIMENTO)
        with mlflow.start_run(run_name="notebook-busqueda") as run:
            mlflow.set_tags({"corrida": "notebook-busqueda", "equipo": "true", "snapshot": "ds-2026-09-01",
                             "mlflow.note.content": "Reentrenado en el notebook del equipo de búsqueda."})
            mlflow.log_metric("val_top1", 0.8611)
            mlflow.log_artifacts(str(carpeta), "modelo")
    mv = c.create_model_version(MODELO, source=f"runs:/{run.info.run_id}/modelo", run_id=run.info.run_id)
    c.set_registered_model_alias(MODELO, "champion", mv.version)
    e["version"], e["run"] = str(mv.version), run.info.run_id


def champion_bueno(e: dict) -> None:
    c = mlflow_cliente()
    c.set_registered_model_alias(MODELO, "champion", e["antes"])
    try:
        c.delete_model_version(MODELO, e["version"])
        c.delete_run(e["run"])
    except Exception:  # noqa: BLE001
        pass


def pillow_distinto(e: dict) -> None:
    respaldar(e, GW_REQ, REQ)
    GW_REQ.write_text(GW_REQ.read_text().replace("pillow==13.0.0", "pillow==12.3.0"))


def pillow_bueno(e: dict) -> None:
    devolver(e)
    import PIL

    if PIL.__version__ != "13.0.0":
        print("  vuelvo a instalar pillow==13.0.0…")
        sh(sys.executable, "-m", "pip", "install", "-q", "pillow==13.0.0", timeout=600)


def mlflow_caido(e: dict) -> None:
    sh("docker", "compose", "stop", "mlflow", timeout=120)


def mlflow_arriba_de_nuevo(e: dict) -> None:
    if not mlflow_arriba():
        sh("docker", "compose", "up", "-d", "--wait", "mlflow", timeout=300)


def receta_sin_commit(e: dict) -> None:
    respaldar(e, RECETA)
    editar_receta("epocas", 5)


FALLAS = {
    "lr-roto": dict(
        tipo="config", titulo="Una corrida de 4 horas que no aprendió nada",
        historia="El pipeline de anoche ni siquiera pidió la GPU: se detuvo en el primer paso. En el canal del equipo alguien escribió «¿quién movió algo?».",
        explica="Alguien subió a receta.yaml lr: 0.0 (en un commit, «para probar el backbone congelado»). Con lr 0, AdamW no mueve ningún peso: el código corre, imprime números y no aprende. La prueba de humo lo atrapa en segundos: la pérdida se queda en ≈ ln(10) = 2.30 y acierta ≈ 3 de 32 por azar, así que el orquestador no lanza el entrenamiento. Sin esa prueba, la corrida habría gastado la GPU completa. Arreglo: git log -p receta.yaml para ver quién y cuándo, lr: 0.003 de vuelta en un commit, y la prueba de humo vuelve a pasar. Congelar capas se hace con otra receta, no con lr 0.",
        aplicar=lr_roto, deshacer=receta_buena),
    "ckpt-espaciado": dict(
        tipo="config", titulo="Menos escrituras a S3",
        historia="Finanzas preguntó por qué el bucket de checkpoints tiene tantas escrituras. Alguien subió un cambio a la receta para «ahorrar» y avisó en el canal.",
        explica="receta.yaml quedó con ckpt_cada_pasos: 1000, y una corrida tiene 330 pasos: nunca se guarda un checkpoint. Si se pierde el nodo, el reintento empieza de cero y la corrida tarda el doble (en C01, de 4 a 8 horas de GPU). El ahorro es ridículo: en C01, 16 checkpoints de ≈ 300 MB son 16 PUT, centavos al mes, y escribirlos se lleva ≈ 0.3 % del tiempo. Arreglo: ckpt_cada_pasos: 25 de vuelta en un commit (el precálculo de «cada cuánto guardar»). Para comprobarlo: python mundo/orquestador.py pipeline.yaml --apagon 15 reanuda en vez de empezar de cero.",
        aplicar=ckpt_espaciado, deshacer=receta_buena),
    "champion-otro-orden": dict(
        tipo="mundo", titulo="El champion cambió de un día para otro",
        historia="El equipo de búsqueda presumió que su modelo «ya está en producción, con 86 %». El pipeline de esta noche se detuvo antes de entrenar.",
        explica="Alguien registró a mano una versión nueva de classifier (salió de un notebook) y le movió el alias champion. Sus pesos son los de v1, pero su labels.json trae las 10 categorías en orden alfabético: la salida 0 ya no es «playeras». Arrancar de ahí le enseña a la red que cada neurona de salida es otra clase. Tu entrenar.py compara el labels.json del champion con entrada/categorias.json y se detiene antes de gastar cómputo. Arreglo: python mundo/modelos.py versiones para ver qué apunta a qué, y python mundo/modelos.py alias champion 1 para devolver el alias a la versión buena. En C01 el alias lo mueve solo el pipeline de CD después del gate y del canary (estaciones 4 y 10), y nadie registra modelos desde un notebook.",
        aplicar=champion_otro_orden, deshacer=champion_bueno),
    "pillow-distinto": dict(
        tipo="entorno", titulo="Serving cambió de versión de Pillow",
        historia="El equipo de serving publicó en su canal: «Fijamos Pillow 12.3.0 en el gateway por un problema con algunos JPEG». Nadie de entrenamiento lo leyó.",
        explica="mundo/gateway/requirements.txt ahora dice pillow==12.3.0, y tu entorno de entrenamiento sigue con 13.0.0. Pillow decodifica el JPEG y hace el resize: con otra versión, la misma foto puede dar otros números, y el modelo se entrena viendo fotos un poco distintas de las que verá en producción (training-serving skew de entorno). Esta vez los 16 tensores de paridad salen iguales con las dos versiones; la garantía no es que coincidan hoy, es usar la misma. Arreglo: pip install pillow==12.3.0, el mismo pin en requirements.txt (para que el entorno se pueda reconstruir) y python verificar.py paridad. En C01, la imagen de entrenamiento toma la versión de Pillow de la del gateway.",
        aplicar=pillow_distinto, deshacer=pillow_bueno),
    "mlflow-caido": dict(
        tipo="infra", titulo="El job murió a los dos segundos",
        historia="El pipeline de anoche quedó en rojo y el entrenamiento ni siquiera empezó. La persona de guardia vio la alarma en la mañana.",
        explica="El servidor de MLflow está apagado (docker compose stop mlflow). Tu entrenar.py lo comprueba antes de bajar datos o entrenar y se detiene en segundos: sin registro no se entrena, porque un modelo sin su corrida no tiene linaje. Arreglo: docker compose ps para ver qué servicio no está, docker compose up -d --wait mlflow y python verificar.py. En C01, MLflow lo opera plataforma con Postgres y S3 detrás; si se cae, el reintento del orquestador espera y vuelve a intentar.",
        aplicar=mlflow_caido, deshacer=mlflow_arriba_de_nuevo),
    "receta-sin-commit": dict(
        tipo="config", titulo="Una prueba rápida en la máquina del pipeline",
        historia="Alguien entró a la máquina donde corre el pipeline «para una prueba rápida» y se fue de vacaciones. El pipeline de esta noche no arrancó.",
        explica="receta.yaml tiene un cambio sin commit: epocas pasó de 3 a 5. Una corrida desde aquí diría «commit tal», y ese commit tiene 3 épocas: el linaje mentiría. Por eso entrenar.py se niega a correr con el árbol sucio. Arreglo: git status y git diff receta.yaml para ver el cambio; como nadie lo aprobó, git restore receta.yaml. Si de verdad se quiere probar 5 épocas, va en un commit con su porqué, y es una receta nueva (otro receta_sha256): sus semillas se vuelven a medir.",
        aplicar=receta_sin_commit, deshacer=receta_buena),
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
    print("  revisando que todo esté sano (≈ 30 s)…")
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
    if sh("git", "status", "--porcelain", "--", "requirements.txt").stdout.strip():
        print("  requirements.txt volvió a como estaba antes de la falla: git commit -am «vuelve el entorno sano»")


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
