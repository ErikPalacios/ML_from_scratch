"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca tu código (gateway/, servir/armar.py
ni tu config.pbtxt).

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
import os
import signal
import secrets
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CLASES, GATEWAY_YAML, LOGS, MODELO, RAIZ, REPO, TALLER, TRITON, arriba, artefacto,  # noqa: E402
                         editar_yaml, escribir_json, leer_json, mlflow_arriba, mlflow_cliente, sh)

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
def servicios(*a: str) -> str:
    r = sh(sys.executable, "mundo/servicios.py", *a, timeout=120)
    return r.stdout + r.stderr


def subir(run_id: str, carpeta: str, nombre: str, b: bytes) -> None:
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / nombre).write_bytes(b)
        mlflow_cliente().log_artifact(run_id, str(Path(d) / nombre), carpeta)


def plazos_largos(e: dict) -> None:
    respaldar(e, GATEWAY_YAML)
    editar_yaml(GATEWAY_YAML, "triton", 400)
    commit("gateway.yaml", "gateway: más plazo para Triton (400 ms): en la hora pico vimos 504 de más", PLATAFORMA)
    servicios("reiniciar", "gateway")                      # «el despliegue de la tarde»


def plazos_buenos(e: dict) -> None:
    devolver(e)
    commit("gateway.yaml", "gateway: vuelven los plazos revisados (PR #51)", PLATAFORMA)
    servicios("reiniciar", "gateway")


def limites_flojos(e: dict) -> None:
    respaldar(e, GATEWAY_YAML)
    editar_yaml(GATEWAY_YAML, "en_vuelo", 64)
    editar_yaml(GATEWAY_YAML, "decodes", 8)
    commit("gateway.yaml", "gateway: más throughput (64 en vuelo y 8 decodes a la vez); la CPU estaba al 40 %", PLATAFORMA)
    servicios("reiniciar", "gateway")


def limites_buenos(e: dict) -> None:
    devolver(e)
    commit("gateway.yaml", "gateway: vuelven los límites revisados (PR #51)", PLATAFORMA)
    servicios("reiniciar", "gateway")


def modelo_equivocado(e: dict) -> None:
    """Alguien «regresó al modelo de septiembre» copiando su engine encima del de v4, y reinició Triton."""
    v3 = mlflow_cliente().get_model_version(MODELO, "3")
    (REPO / "classifier" / "1" / "model.onnx").write_bytes(artefacto(v3.run_id, "engine/engine.onnx"))
    servicios("reiniciar", "triton")


def modelo_bueno(e: dict) -> None:
    sh(sys.executable, "servir/armar.py", timeout=120)
    servicios("reiniciar", "triton")


def labels_desordenados(e: dict) -> None:
    v4 = mlflow_cliente().get_model_version(MODELO, "4")
    subir(v4.run_id, "modelo", "labels.json", (json.dumps(sorted(CLASES), ensure_ascii=False) + "\n").encode())


def labels_buenos(e: dict) -> None:
    v4 = mlflow_cliente().get_model_version(MODELO, "4")
    subir(v4.run_id, "modelo", "labels.json", (json.dumps(CLASES, ensure_ascii=False) + "\n").encode())


def pid_triton() -> int | None:
    p = LOGS / "triton.pid"
    return int(p.read_text()) if p.exists() else None


def triton_trabado(e: dict) -> None:
    os.kill(pid_triton(), signal.SIGSTOP)


def triton_despierto(e: dict) -> None:
    pid = pid_triton()
    if pid:
        try:
            os.kill(pid, signal.SIGCONT)
        except ProcessLookupError:
            pass
    for _ in range(20):
        if arriba(f"{TRITON}/v2/health/ready", 1) == 200:
            return
        time.sleep(0.2)
    servicios("reiniciar", "triton")


def mlflow_caido(e: dict) -> None:
    sh("docker", "compose", "stop", "mlflow", timeout=120)


def mlflow_arriba_de_nuevo(e: dict) -> None:
    if not mlflow_arriba():
        sh("docker", "compose", "up", "-d", "--wait", "mlflow", timeout=300)


FALLAS = {
    "plazos-invertidos": dict(
        tipo="config", titulo="Más plazo para Triton",
        historia="En la hora pico hubo una ráfaga de 504. El equipo de plataforma subió un commit a gateway.yaml directo a main y redesplegó el gateway: «le dimos más plazo a Triton, ya no debería cortar».",
        explica="gateway.yaml quedó con plazos_ms.triton: 400, en un commit sin revisión (su huella no está en mundo/revisiones.json). Con eso la cadena de plazos ya no baja: la llamada a Triton podría esperar más que la request entera (250 ms) y que la app (300 ms). La app se rendiría primero y vería su selector manual, mientras el gateway sigue esperando a Triton y gastando un lugar en vuelo: más 504, no menos. Tu gateway se niega a arrancar con una cadena al revés, y está bien: mejor no arrancar que arrancar mal. Arreglo: git log -p gateway.yaml, git revert del commit y python mundo/servicios.py arrancar gateway. Los 504 de la hora pico se investigan con el log (ms.triton) y las métricas de Triton, no estirando el plazo.",
        aplicar=plazos_largos, deshacer=plazos_buenos),
    "limites-flojos": dict(
        tipo="config", titulo="Más throughput",
        historia="El equipo de plataforma vio la CPU del gateway al 40 % y subió un commit: «64 en vuelo y 8 decodes a la vez; así aprovechamos la máquina». Redesplegaron el gateway y todo responde.",
        explica="gateway.yaml quedó con en_vuelo: 64 y decodes: 8 en un commit sin revisión. Todo responde porque hoy llegan fotos normales; el problema es el peor momento: 64 bodies de 10 MiB más 8 decodes de una foto de 40 MP (≈ 320 MB cada uno) son ≈ 3 GiB en una copia de 1 GiB. La primera ráfaga de fotos grandes mata al proceso por memoria (OOM) y con él a las 63 requests que tenía adentro. Los topes no son para la CPU de hoy: son para la memoria del peor caso. Arreglo: git log -p gateway.yaml, git revert del commit y python mundo/servicios.py reiniciar gateway. Si de verdad falta throughput, se agregan copias (estación 9), no lugares en una.",
        aplicar=limites_flojos, deshacer=limites_buenos),
    "modelo-equivocado": dict(
        tipo="mundo", titulo="El hotfix de septiembre",
        historia="Alguien de plataforma escribió en el canal: «el modelo de octubre daba resultados raros en mi prueba, puse el de septiembre en el repositorio mientras y reinicié Triton». Todo responde 200.",
        explica="model_repository/classifier/1/model.onnx ahora es el engine de v3, copiado a mano, y Triton lo cargó al reiniciar. El gateway sigue diciendo model_version miniresnet-2026-10-01: cada respuesta afirma ser un modelo que no es. Es la falla más peligrosa de serving porque no da errores: solo respuestas de otro modelo, con 200. Lo delatan las huellas: la del archivo no es el tag engine_sha256 de v4, y Triton anota en su log la huella de lo que cargó. Arreglo: python verificar.py repositorio triton para verlo, python servir/armar.py (vuelve a bajar el engine aprobado y compara su huella) y python mundo/servicios.py reiniciar triton (Triton carga solo al arrancar: --model-control-mode=none). En C01 el model repository va dentro de la imagen de Triton, así que nadie puede cambiarlo «mientras».",
        aplicar=modelo_equivocado, deshacer=modelo_bueno),
    "labels-desordenados": dict(
        tipo="mundo", titulo="Las categorías en orden",
        historia="Un script de limpieza de plataforma «normalizó» los artefactos del registro: «dejamos los labels.json en orden alfabético, como en los demás modelos». El gateway sigue respondiendo bien.",
        explica="El modelo/labels.json de la corrida de v4 en MLflow quedó en orden alfabético: los artefactos de una corrida se pueden reemplazar. El gateway responde bien porque su ficha (servir/modelo.json) se armó antes; el daño llegaría con el próximo armado: abrigos sería la posición 0, y cada respuesta diría una categoría equivocada con buena confianza y código 200. Tu armar.py compara la huella con el tag labels_sha256 y se niega. Arreglo: python mundo/modelos.py labels 4 para ver que no coincide, python mundo/modelos.py reparar-labels 4 (sube la lista del equipo solo si su huella es la del tag) y python servir/armar.py para confirmar que ya arma.",
        aplicar=labels_desordenados, deshacer=labels_buenos),
    "triton-trabado": dict(
        tipo="infra", titulo="El servidor que no contesta",
        historia="Desde hace unos minutos, todas las fotos salen con 504. El gateway está vivo: su /healthz contesta 200.",
        explica="El proceso del servidor de modelos está congelado (le llegó SIGSTOP; en C01 sería una GPU trabada o un driver colgado): acepta conexiones pero no contesta nada. Tu gateway hace lo correcto: corta cada llamada a los 150 ms con 504, /readyz dice 503 (en C01, Kubernetes sacaría esa copia del reparto) y /healthz sigue en 200 (reiniciar el gateway no arreglaría a Triton). Arreglo: python mundo/servicios.py estado (ps dice T: congelado) y python mundo/servicios.py reiniciar triton. En C01: el liveness probe de Triton lo reinicia solo.",
        aplicar=triton_trabado, deshacer=triton_despierto),
    "mlflow-caido": dict(
        tipo="infra", titulo="El registro no contesta",
        historia="El canal de plataforma avisa que MLflow está en mantenimiento. Alguien pregunta: «¿se cayó también el clasificador?».",
        explica="El servidor de MLflow está apagado (docker compose stop mlflow). El clasificador NO se cayó: Triton y el gateway ya tienen todo lo que necesitan (el engine en el model repository y la ficha con sus labels), y siguen respondiendo 200. Lo que no se puede es armar un repositorio nuevo: armar.py falla en segundos, y está bien que falle. Servir no depende del registro en cada request; desplegar, sí. Arreglo: docker compose ps para ver qué servicio no está, docker compose up -d --wait mlflow y python verificar.py.",
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
