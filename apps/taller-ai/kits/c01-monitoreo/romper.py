"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca lo que escribes
(observabilidad/reglas.yml, pruebas.yml, alertmanager.yml ni diario/*.py): lo que cambia lo cambia otro equipo, con un
commit o en la infraestructura.

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (el final del Guiado). La falla activa se guarda como un hash en
.taller/: ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import secrets
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (BUCKET, ETIQUETADO, MUNDO, PLATAFORMA_YAML, RAIZ, TALLER, ayer, compose, escribir_json,  # noqa: E402
                         examen, git, leer_json, s3)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
CLASSIFIER = {"GIT_AUTHOR_NAME": "Beto (equipo de classifier)", "GIT_AUTHOR_EMAIL": "beto@c01.test",
              "GIT_COMMITTER_NAME": "Beto (equipo de classifier)", "GIT_COMMITTER_EMAIL": "beto@c01.test"}
APP = {"GIT_AUTHOR_NAME": "Equipo de la app mobile", "GIT_AUTHOR_EMAIL": "app-mobile@c01.test",
       "GIT_COMMITTER_NAME": "Equipo de la app mobile", "GIT_COMMITTER_EMAIL": "app-mobile@c01.test"}
DATOS = {"GIT_AUTHOR_NAME": "Equipo de datos", "GIT_AUTHOR_EMAIL": "datos@c01.test",
         "GIT_COMMITTER_NAME": "Equipo de datos", "GIT_COMMITTER_EMAIL": "datos@c01.test"}
PROM_YML = MUNDO / "prometheus" / "prometheus.yml"
COMPOSE = RAIZ / "compose.yaml"
PREPROCESS = RAIZ / "gateway" / "app" / "preprocess.py"
CALLERS = MUNDO / "callers.json"
VENTANA_EN_VIVO_S = 220          # lo que tarda la ventana de 3 min de las señales en vivo en dejar de ver la falla


def py(*args: str, timeout: float = 900) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=RAIZ, capture_output=True, text=True, timeout=timeout)


# ---------------------------------------------------------------- commits de otros equipos
def commit(e: dict, p: Path, nuevo: str, msg: str, quien: dict) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    shutil.copy(p, RESPALDO / p.name)
    p.write_text(nuevo)
    rel = str(p.relative_to(RAIZ))
    git("commit", "-q", "-m", msg, "--", rel, extra=quien)
    e["commit"], e["archivo"] = git("rev-parse", "HEAD"), rel


def deshacer_commit(e: dict) -> None:
    """Si el commit de la falla sigue vivo (nadie lo revirtió), lo revierte; si no, deja el archivo como estaba."""
    c, rel = e.get("commit"), e.get("archivo")
    if not c:
        return
    p = RAIZ / rel
    if (RESPALDO / p.name).exists() and p.read_text() != (RESPALDO / p.name).read_text():
        r = subprocess.run(["git", "revert", "--no-edit", c], cwd=RAIZ, capture_output=True, text=True)
        if r.returncode != 0:
            subprocess.run(["git", "revert", "--abort"], cwd=RAIZ, capture_output=True)
            shutil.copy(RESPALDO / p.name, p)
            git("commit", "-q", "-m", f"romper.py: restaura {rel}", "--", rel)


# ---------------------------------------------------------------- las fallas
def latido_perdido(e: dict) -> None:
    t = PROM_YML.read_text().replace('targets: ["alertmanager:9093"]', 'targets: ["alertmanager-ha:9093"]', 1)
    commit(e, PROM_YML, t, "plataforma: Prometheus avisa al Alertmanager en HA, con su nombre nuevo (PLAT-4702)", PLATAFORMA)
    py("mundo/recargar.py", "prometheus")


def latido_deshacer(e: dict) -> None:
    deshacer_commit(e)
    py("mundo/recargar.py", "prometheus")
    time.sleep(90)                          # que el Watchdog vuelva a llegar y la ventana de errores se limpie


def retencion_corta(e: dict) -> None:
    t = COMPOSE.read_text().replace("--storage.tsdb.retention.time=15d", "--storage.tsdb.retention.time=2d", 1)
    commit(e, COMPOSE, t, "finops: Prometheus guarda 2 días, no 15 (el disco de monitoring cuesta; FIN-207)", PLATAFORMA)
    compose("up", "-d", "--wait", "prometheus", timeout=300)
    time.sleep(75)                          # la siguiente recarga de bloques borra lo que ya no cabe


def retencion_deshacer(e: dict) -> None:
    deshacer_commit(e)
    compose("up", "-d", "--wait", "prometheus", timeout=300)
    py("mundo/historia.py", "metricas", "--de-nuevo")
    time.sleep(75)
    py("mundo/promtool.py", "rellenar")
    time.sleep(75)


def job_roto(e: dict) -> None:
    t = PLATAFORMA_YAML.read_text()
    t = t.replace("      llave: taller\n      secreto: taller-secreto\n",
                  "      llave: monitoreo-ro\n      secreto: 9f2c41d07a8e5b36\n", 1)
    commit(e, PLATAFORMA_YAML, t, "seguridad: el job de monitoreo corre con su propia cuenta de solo lectura (SEC-131)", PLATAFORMA)
    py("mundo/cron.py", "correr")           # la corrida de la 01:00


def job_deshacer(e: dict) -> None:
    deshacer_commit(e)
    py("mundo/cron.py", "correr")


def decode_nuevo(e: dict) -> None:
    t = PREPROCESS.read_text().replace(
        "    a = np.asarray(im, dtype=np.float32) / 255.0\n",
        "    a = np.asarray(im, dtype=np.float32)   # PERF-3310: el decoder rápido ya entrega [0, 1]; sin dividir dos veces\n", 1)
    commit(e, PREPROCESS, t, "gateway: decoder rápido; ya entrega la foto en [0, 1], sin la división repetida (PERF-3310)", CLASSIFIER)
    py("mundo/servicios.py", "reiniciar", "gateway")


def decode_deshacer(e: dict) -> None:
    deshacer_commit(e)
    py("mundo/servicios.py", "reiniciar", "gateway")
    time.sleep(VENTANA_EN_VIVO_S)


def app_nueva(e: dict) -> None:
    d = json.loads(CALLERS.read_text())
    d["apps"]["mobile"] = {"version": "5.3.0", "proceso": {"contraste": 0.5, "calidad": 40}}
    commit(e, CALLERS, json.dumps(d, ensure_ascii=False, indent=2) + "\n",
           "app mobile 5.3.0: fotos más ligeras para conexiones lentas (APP-5121)", APP)


def app_deshacer(e: dict) -> None:
    deshacer_commit(e)
    time.sleep(VENTANA_EN_VIVO_S)


def examen_nuevo(e: dict) -> None:
    c = s3()
    mes = (ayer().replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    tareas = json.loads(c.get_object(Bucket=BUCKET, Key=f"{ETIQUETADO}cola-{mes}/tareas.json")["Body"].read())
    viejo = c.get_object(Bucket=BUCKET, Key=examen())["Body"].read().decode().split()
    elegidas = [t["data"]["sha256"] for t in tareas[::12]][:40]        # fotos de noviembre que también están en tu cola
    nuevas = [s + hashlib.sha256(s.encode()).hexdigest()[:52] for s in elegidas]
    c.put_object(Bucket=BUCKET, Key="datasets/golden-v2/sha256.txt", Body=("\n".join(viejo + nuevas) + "\n").encode())
    t = re.sub(r"examen: datasets/golden-v1/sha256.txt", "examen: datasets/golden-v2/sha256.txt", PLATAFORMA_YAML.read_text(), count=1)
    commit(e, PLATAFORMA_YAML, t, "datos: el examen fijo pasa a golden-v2: +40 fotos de noviembre, revisadas a mano (DATA-880)", DATOS)


def examen_deshacer(e: dict) -> None:
    deshacer_commit(e)
    py("diario/muestras.py")


FALLAS = {
    "latido-perdido": dict(
        tipo="config", titulo="Todo verde, nadie avisa",
        historia="Plataforma cerró el PLAT-4702: «Alertmanager ya corre en alta disponibilidad». El tablero de Prometheus "
                 "se ve normal, con sus alertas evaluando. Es viernes. Nadie ha recibido un page en toda la tarde.",
        explica="El commit de plataforma cambió en mundo/prometheus/prometheus.yml el destino de las alertas a "
                "alertmanager-ha:9093, un nombre que no existe. Prometheus sigue evaluando todo (en /alerts verías las "
                "alertas en firing), pero no le puede entregar nada a Alertmanager: ningún page, ningún ticket. Lo único "
                "que lo delata es lo que debería llegar siempre: el Watchdog. Alertmanager todavía lo repite ≈ 4 min (cada "
                "alerta llega con un endsAt de 4 × el reenvío de 1 min), y sin latido por más de 150 s el buscapersonas avisa: "
                "≈ 6.5 min en total (en C01: un dead man's switch como Dead Man's Snitch, que se integra con PagerDuty, o Healthchecks.io: está FUERA del clúster, "
                "por eso puede avisar). Al instante lo ves en prometheus_notifications_errors_total. Arreglo: python verificar.py "
                "alertmanager, curl -s localhost:8966/estado, http://localhost:9962/status (Alertmanagers), git log -p "
                "mundo/prometheus/prometheus.yml, git revert del commit y python mundo/recargar.py prometheus.",
        aplicar=latido_perdido, deshacer=latido_deshacer),
    "retencion-corta": dict(
        tipo="config", titulo="El disco más barato",
        historia="FinOps cerró el FIN-207: «Prometheus guardaba 15 días y nadie mira más allá de dos». Prometheus se "
                 "reinició con el cambio. Todo contesta y las alertas siguen evaluando.",
        explica="El commit puso --storage.tsdb.retention.time=2d en compose.yaml. Al recargar sus bloques, Prometheus borró "
                "todo lo de hace más de 2 días: la historia del gateway y la de tu regla grabada. ClassifierLowConfidenceSpike "
                "compara con el promedio de 7 días de esa regla; ahora es el promedio de 2, y si el cambio dura más, la "
                "alerta deja de ver un cambio que ya es «lo normal». La regla dice en su comentario lo que necesita: "
                "retención ≥ 7 días. Arreglo: python verificar.py baja-confianza, "
                "count_over_time(classifier:low_confidence_share:rate30m[7d]), git log -p compose.yaml, git revert del commit, "
                "docker compose up -d prometheus, y volver a llenar lo borrado: python mundo/historia.py metricas --de-nuevo "
                "(la historia del gateway), esperar ≈ 1 min y python mundo/promtool.py rellenar (la de tu regla). En C01 lo "
                "borrado no vuelve: se pierden 13 días de referencia hasta que se junten otra vez.",
        aplicar=retencion_corta, deshacer=retencion_deshacer),
    "job-roto": dict(
        tipo="config", titulo="La cuenta de solo lectura",
        historia="Seguridad cerró el SEC-131: «cada job con su propia cuenta y lo mínimo de permisos». En la mañana, el "
                 "tablero de negocio muestra el PSI y la aceptación de ayer, como siempre. ¿O no?",
        explica="El commit de plataforma cambió la cuenta de S3 del job monitoreo-diario (mundo/plataforma.yaml, jobs) a "
                "monitoreo-ro, una cuenta que nadie creó en el S3. La corrida de la 01:00 (mundo/cron.py) tronó en tu "
                "monitoreo.py con InvalidAccessKeyId y no publicó. La Pushgateway nunca olvida: sigue mostrando los números "
                "de la corrida anterior, y el tablero se ve perfecto. MonitoringJobStale lo diría a las 26 h. Arreglo: "
                "python verificar.py frescura, python mundo/cron.py estado, git log -p mundo/plataforma.yaml, git revert del "
                "commit y python mundo/cron.py correr. En C01 el arreglo de fondo es crear la cuenta (el rol de IAM) antes de "
                "apuntar el job a ella.",
        aplicar=job_roto, deshacer=job_deshacer),
    "decode-nuevo": dict(
        tipo="config", titulo="El decoder rápido",
        historia="Beto cerró el PERF-3310: «con el decoder nuevo, el preprocess usa 3× menos CPU». Hizo merge y los pods "
                 "se reiniciaron. Todo contesta 200, igual de rápido, y el modelo se ve más seguro que nunca.",
        explica="El commit de Beto en gateway/app/preprocess.py quitó la división entre 255 («el decoder nuevo ya entrega "
                "[0, 1]»), pero en el dojo el decoder sigue entregando 0–255: el modelo recibe una foto 255 veces más "
                "brillante de lo que aprendió. Contesta con muchísima seguridad (la fracción de fotos dudosas cae casi a 0) "
                "y casi siempre la misma categoría (el PSI de los últimos minutos contra 7 días se dispara). Una alerta que "
                "solo mira «más dudosas» no lo ve: un modelo seguro de todo también es una alarma. Es training-serving skew "
                "por un deploy propio: no se reentrena, se hace rollback. Arreglo: python verificar.py en-vivo, python "
                "mundo/capas.py (bytes iguales, PSI alto, dudosas en 0), git log -p gateway/app/preprocess.py, git revert del "
                "commit y python mundo/servicios.py reiniciar gateway; en ≈ 4 min la ventana de 3 min ya no lo ve. (Ojo: un "
                "bug más fino, como invertir los canales RGB → BGR, cambia el top-1 de ≈ 3 de cada 4 fotos con la misma "
                "confianza y casi el mismo PSI: solo los labels, días después, lo verían.)",
        aplicar=decode_nuevo, deshacer=decode_deshacer),
    "app-nueva": dict(
        tipo="mundo", titulo="Fotos más ligeras",
        historia="El equipo de la app mobile sacó la 5.3.0: «fotos más ligeras para quien tiene mala señal». Nadie del "
                 "equipo de classifier tocó nada. El servicio contesta 200 y rápido.",
        explica="La app 5.3.0 manda las fotos con mucho menos contraste y más comprimidas (mundo/callers.json). Para el "
                "servicio no pasó nada; en la capa de datos, las fotos de mobile pesan ≈ 24 % menos, y en la de modelo, la "
                "fracción de fotos dudosas se duplica. Solo cambió un source: no es el modelo ni un deploy tuyo. No se "
                "reentrena (le enseñarías a convivir con el bug de otro): se le avisa al dueño con la evidencia, y el dueño "
                "regresa o corrige su versión. Arreglo: python verificar.py en-vivo, python mundo/capas.py (bytes de mobile "
                "abajo, las otras fuentes igual), git log -p mundo/callers.json y, en el dojo, git revert del commit (lo que "
                "haría el equipo de la app al recibir tu aviso); en ≈ 4 min la ventana ya no lo ve.",
        aplicar=app_nueva, deshacer=app_deshacer),
    "examen-nuevo": dict(
        tipo="mundo", titulo="El examen crece",
        historia="El equipo de datos cerró el DATA-880: «golden-v2: el examen fijo suma 40 fotos de noviembre». La cola de "
                 "etiquetado del mes ya estaba armada y lista para mandarse al proveedor.",
        explica="El commit cambió la ruta del examen en mundo/plataforma.yaml a datasets/golden-v2/sha256.txt, que trae 40 "
                "fotos que ya estaban en tu cola. Si se etiquetan y entran al entrenamiento, el modelo nuevo las habrá visto "
                "cuando el gate lo examine: el examen deja de medir (fuga del test). La cola se armó antes del cambio: "
                "hay que volver a armarla. Arreglo: python verificar.py muestras, git log -p mundo/plataforma.yaml y python "
                "diario/muestras.py (que lee la ruta del examen cada vez: por eso no va escrita en tu código).",
        aplicar=examen_nuevo, deshacer=examen_deshacer),
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
    print("  revisando que todo esté sano (≈ 1 min)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    escribir_json(ESTADO, e)
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
    if como != "✓ arreglado":
        print("  restaurando (puede tardar unos minutos)…")
        f["deshacer"](e)
    ESTADO.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else f"⚠ falla: {', '.join(malos)} (corre python verificar.py)")


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
