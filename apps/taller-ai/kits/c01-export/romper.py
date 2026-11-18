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
import secrets
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (ENGINE_YAML, MODELO, RAIZ, SERVIDOR, TALLER, artefacto, editar_yaml, escribir_json,  # noqa: E402
                         leer_json, mlflow_arriba, mlflow_cliente, sh)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test"}
SERVING = {"GIT_AUTHOR_NAME": "Equipo de serving", "GIT_AUTHOR_EMAIL": "serving@c01.test"}


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


def commit(archivo: str, msg: str, quien: dict) -> None:
    """Si el archivo quedó distinto del último commit, lo sube con ese mensaje (como alguien de otro equipo)."""
    if sh("git", "status", "--porcelain", "--", archivo).stdout.strip():
        sh("git", "commit", "-m", msg, "--", archivo, env=quien)


# ---------------------------------------------------------------- las fallas
def guardar_bytes(e: dict, nombre: str, b: bytes) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    (RESPALDO / nombre).write_bytes(b)


def subir(run_id: str, carpeta: str, nombre: str, b: bytes) -> None:
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / nombre).write_bytes(b)
        mlflow_cliente().log_artifact(run_id, str(Path(d) / nombre), carpeta)


def receta_floja(e: dict) -> None:
    respaldar(e, ENGINE_YAML)
    editar_yaml(ENGINE_YAML, "precision", "int8")
    editar_yaml(ENGINE_YAML, "a1_min", 0.98)
    editar_yaml(ENGINE_YAML, "d_max", 1.0)
    commit("engine.yaml", "engine: int8 (2× más rápido) y umbrales de paridad realistas para int8", PLATAFORMA)


def receta_buena(e: dict) -> None:
    devolver(e)
    commit("engine.yaml", "engine: vuelve la receta revisada (PR #44)", PLATAFORMA)


def pesos_cambiados(e: dict) -> None:
    c = mlflow_cliente()
    v4, v3 = c.get_model_version(MODELO, "4"), c.get_model_version(MODELO, "3")
    guardar_bytes(e, "pesos-v4.pt", artefacto(v4.run_id, "modelo/pesos.pt"))
    subir(v4.run_id, "modelo", "pesos.pt", artefacto(v3.run_id, "modelo/pesos.pt"))   # «el último checkpoint que funcionaba»


def pesos_buenos(e: dict) -> None:
    subir(mlflow_cliente().get_model_version(MODELO, "4").run_id, "modelo", "pesos.pt", (RESPALDO / "pesos-v4.pt").read_bytes())


def runtime_distinto(e: dict) -> None:
    p = SERVIDOR / "requirements.txt"
    respaldar(e, p)
    p.write_text(p.read_text().replace("onnxruntime==1.32.0", "onnxruntime==1.31.1"))
    commit("mundo/servidor/requirements.txt", "servidor: imagen base nueva (onnxruntime 1.31.1, la que trae la release de este mes)", SERVING)


def runtime_bueno(e: dict) -> None:
    devolver(e)
    commit("mundo/servidor/requirements.txt", "servidor: vuelve onnxruntime 1.32.0 (el engine de octubre es de esa versión)", SERVING)


def engine_champion(e: dict) -> None:
    """Alguien reconstruyó el engine del champion en int8 «para comparar» y lo subió encima del de producción."""
    import numpy as np
    from onnxruntime.quantization import CalibrationDataReader, quantize_static

    v3 = mlflow_cliente().get_model_version(MODELO, "3")
    guardar_bytes(e, "engine-v3.onnx", artefacto(v3.run_id, "engine/engine.onnx"))
    rng = np.random.default_rng(3)

    class Lector(CalibrationDataReader):
        def __init__(self):
            self.it = iter([{"input": rng.standard_normal((1, 3, 32, 32)).astype(np.float32)} for _ in range(32)])

        def get_next(self):
            return next(self.it, None)

    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "model.onnx").write_bytes(artefacto(v3.run_id, "engine/model.onnx"))
        quantize_static(str(Path(d) / "model.onnx"), str(Path(d) / "engine.onnx"), Lector())
        subir(v3.run_id, "engine", "engine.onnx", (Path(d) / "engine.onnx").read_bytes())


def engine_champion_bueno(e: dict) -> None:
    subir(mlflow_cliente().get_model_version(MODELO, "3").run_id, "engine", "engine.onnx", (RESPALDO / "engine-v3.onnx").read_bytes())


def firma_cambiada(e: dict) -> None:
    p = SERVIDOR / "classifier.yaml"
    respaldar(e, p)
    p.write_text(p.read_text().replace("max_batch_size: 32", "max_batch_size: 64").replace("{nombre: input,", "{nombre: images,"))
    commit("mundo/servidor/classifier.yaml", "servidor: lotes de hasta 64 y la entrada se llama images, como en los demás modelos", SERVING)


def firma_buena(e: dict) -> None:
    devolver(e)
    commit("mundo/servidor/classifier.yaml", "servidor: vuelve el contrato de classifier (input, lotes de 32)", SERVING)


def mlflow_caido(e: dict) -> None:
    sh("docker", "compose", "stop", "mlflow", timeout=120)


def mlflow_arriba_de_nuevo(e: dict) -> None:
    if not mlflow_arriba():
        sh("docker", "compose", "up", "-d", "--wait", "mlflow", timeout=300)


FALLAS = {
    "receta-sin-revisar": dict(
        tipo="config", titulo="El engine 2× más rápido",
        historia="El equipo de plataforma midió que un engine int8 sirve el doble de fotos por segundo. Subieron un commit a engine.yaml directo a main: «ya quedó, la paridad pasa con los umbrales nuevos».",
        explica="engine.yaml quedó con precision: int8, a1_min: 0.98 y d_max: 1.0, en un commit sin revisión: su sha256 no está en mundo/revisiones.json. Con esos umbrales, el engine int8 (que cambia 11 de 1,000 respuestas y mueve los logits 0.88) pasaría la paridad. Es la trampa de siempre, ahora en el engine: aflojar el examen hasta que el artefacto pase. Tus pasos se niegan a trabajar con una receta que nadie aprobó. Arreglo: git log -p engine.yaml para ver quién y cuándo, y git revert del commit. Si de verdad conviene int8, va en un PR propio: con su calibración, su paridad con los umbrales de siempre y quizás un modelo entrenado para int8.",
        aplicar=receta_floja, deshacer=receta_buena),
    "pesos-cambiados": dict(
        tipo="mundo", titulo="El checkpoint «que sí funcionaba»",
        historia="Alguien del equipo de plataforma escribió en el canal: «los pesos de v4 se veían raros en mi notebook, les puse el último checkpoint que funcionaba».",
        explica="El modelo/pesos.pt de la corrida de v4 en MLflow ahora son los pesos de v3: los artefactos de una corrida se pueden reemplazar. La versión guarda pesos_sha256 desde el gate, así que la huella ya no cuadra: si exportaras así, servirías un modelo que el gate nunca aprobó con el nombre de otro. Tu exportar.py compara la huella y se detiene. Arreglo: python mundo/modelos.py versiones y python verificar.py pesos para verlo, y python mundo/modelos.py pesos 4, que vuelve a subir el checkpoint original desde s3://ml-ckpt (el bucket de checkpoints, con su huella). Después, el engine que ya registraste sigue siendo el bueno: se construyó con los pesos correctos.",
        aplicar=pesos_cambiados, deshacer=pesos_buenos),
    "runtime-distinto": dict(
        tipo="config", titulo="La imagen base nueva",
        historia="El equipo de serving actualizó la imagen del servidor a la release de este mes y avisó: «sin cambios para ustedes, es la misma API».",
        explica="mundo/servidor/requirements.txt ahora fija onnxruntime==1.31.1, y el engine de v4 se construyó (y se midió) con 1.32.0. Un engine va atado al runtime que lo construyó: con TensorRT, un .plan de otra versión ni siquiera carga; aquí probablemente cargaría, y ese es el problema: nadie midió su paridad ni su latencia con ese runtime. Tus pasos y verificar.py comparan la versión del engine con la del servidor. Arreglo: git log -p mundo/servidor/requirements.txt y git revert del commit, y pedir que una actualización del runtime vaya en el mismo PR que reconstruye y vuelve a medir el engine (o reconstruirlo tú con ese runtime y repetir paridad y latencia).",
        aplicar=runtime_distinto, deshacer=runtime_bueno),
    "engine-champion-cambiado": dict(
        tipo="mundo", titulo="El champion más rápido del mundo",
        historia="Alguien de plataforma «comparó velocidades» con el engine del champion esta mañana. Desde entonces el gate de latencia dice que el modelo nuevo es más del doble de lento.",
        explica="El engine/engine.onnx de v3 en MLflow es ahora un engine int8 que alguien subió encima del de producción. El gate de latencia compara contra el champion, así que con esa referencia cualquier engine FP16 sale «lento»: el gate fallaría por la razón equivocada (o, al revés, pasaría a un engine malo contra una referencia mala). Tu latencia.py compara la huella del engine del champion con su tag engine_sha256 y se detiene. Arreglo: python mundo/modelos.py engine 3 para ver la huella que no cuadra, y python mundo/modelos.py reconstruir-engine 3: la misma receta, con los mismos pesos y las mismas versiones en la misma máquina, da el mismo archivo byte por byte, y solo se sube si su huella es la del tag. Un build reproducible es lo que permite reparar así.",
        aplicar=engine_champion, deshacer=engine_champion_bueno),
    "firma-cambiada": dict(
        tipo="config", titulo="Como en los demás modelos",
        historia="El equipo de serving estandarizó la configuración de todos los modelos del servidor: «lotes de hasta 64 y la entrada se llama images, como en los demás».",
        explica="mundo/servidor/classifier.yaml (el config.pbtxt de Triton en C01) ahora espera una entrada llamada images y lotes de hasta 64. El engine de v4 tiene la entrada input y se construyó para lotes de hasta 32. En producción, el servidor no cargaría el modelo o rechazaría cada petición: el contrato entre el engine y el servidor es parte de lo que esta estación entrega. verificar.py firma y tu paridad.py lo comparan antes de registrar. Arreglo: git log -p mundo/servidor/classifier.yaml y git revert del commit; si serving de verdad necesita otro nombre o lotes más grandes, va en el mismo PR que exporta y reconstruye el engine con ese contrato (y lo vuelve a medir).",
        aplicar=firma_cambiada, deshacer=firma_buena),
    "mlflow-caido": dict(
        tipo="infra", titulo="El paso del engine no corrió",
        historia="El pipeline de anoche quedó en rojo en la estación del engine y el challenger sigue con engine=pendiente.",
        explica="El servidor de MLflow está apagado (docker compose stop mlflow). Sin el registro no hay pesos de la versión, ni engine del champion para comparar, ni dónde registrar: tus pasos fallan en segundos, y está bien que fallen. Un paso que «pasa» porque no pudo medir es peor que uno en rojo. Arreglo: docker compose ps para ver qué servicio no está, docker compose up -d --wait mlflow y python verificar.py. En C01, MLflow lo opera plataforma; si se cae, el orquestador reintenta el paso.",
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
