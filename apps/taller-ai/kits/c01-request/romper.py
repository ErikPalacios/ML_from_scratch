"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca lo que escribes (gateway/app/rastro.py,
observabilidad/prometheus.yml, observabilidad/reglas.yml, observabilidad/fluent-bit.conf ni diario/a_parquet.py): lo que
cambia lo cambia otro equipo, con un commit o en la infraestructura.

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
import secrets
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import PLATAFORMA_YAML, RAIZ, TALLER, compose, escribir_json, git, leer_json  # noqa: E402

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
MAIN = RAIZ / "gateway" / "app" / "main.py"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
CLASSIFIER = {"GIT_AUTHOR_NAME": "Beto (equipo de classifier)", "GIT_AUTHOR_EMAIL": "beto@c01.test",
              "GIT_COMMITTER_NAME": "Beto (equipo de classifier)", "GIT_COMMITTER_EMAIL": "beto@c01.test"}


def nodo(*args: str) -> None:
    subprocess.run([sys.executable, "mundo/nodo.py", *args], cwd=RAIZ, capture_output=True, text=True, timeout=300)


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
def etiqueta_sin_techo(e: dict) -> None:
    t = MAIN.read_text()
    t = t.replace("    rastro = Rastro(registro, r, m0)\n",
                  "    rastro = Rastro(registro, r, m0)\n"
                  "    from prometheus_client import Histogram   # BUG-2291: encontrar las requests lentas del p99 (temporal)\n"
                  "    depurar = Histogram(\"classifier_request_debug_seconds\", \"Latencia por request, para depurar\",\n"
                  "                        [\"request_id\"], registry=registro)\n", 1)
    t = t.replace("            rastro.anotar(ev, status, etiqueta, t0)\n\n    return app",
                  "            rastro.anotar(ev, status, etiqueta, t0)\n"
                  "            depurar.labels(rid).observe(time.monotonic() - t0)\n\n    return app", 1)
    commit(e, MAIN, t, "gateway: histograma por request para encontrar las lentas del p99 (BUG-2291)", CLASSIFIER)
    nodo("reiniciar", "gateway")


def etiqueta_deshacer(e: dict) -> None:
    deshacer_commit(e)
    nodo("reiniciar", "gateway")


def monitor_perdido(e: dict) -> None:
    t = PLATAFORMA_YAML.read_text().replace("app.kubernetes.io/name: gateway\n", "app.kubernetes.io/name: classifier-gateway\n")
    commit(e, PLATAFORMA_YAML, t, "plataforma: nombres de app con el prefijo del servicio (PLAT-4610)", PLATAFORMA)
    nodo("publicar")


def monitor_deshacer(e: dict) -> None:
    deshacer_commit(e)
    nodo("publicar")


def s3_caido(_e: dict) -> None:
    compose("stop", "s3", timeout=120)


def s3_de_vuelta(_e: dict) -> None:
    compose("start", "s3", timeout=120)
    time.sleep(20)                         # que los Fluent Bit vacíen su buffer


def lector_caido(_e: dict) -> None:
    compose("stop", "fluent-bit-b", timeout=120)


def lector_de_vuelta(_e: dict) -> None:
    compose("start", "fluent-bit-b", timeout=120)
    time.sleep(75)                         # lo que tarda en subir lo atrasado (upload_timeout 1 min)


def triton_caido(_e: dict) -> None:
    nodo("parar", "triton")


def triton_de_vuelta(_e: dict) -> None:
    nodo("arrancar", "triton")
    time.sleep(70)                         # que la ventana de 1 min de las tasas ya no vea los 503


def llave_rotada(e: dict) -> None:
    import re
    t = re.sub(r"(\n    llave: )[0-9a-f]+", r"\g<1>d282aa9c9bc026cc627414055decf816", PLATAFORMA_YAML.read_text(), count=1)
    commit(e, PLATAFORMA_YAML, t, "plataforma: rota la llave con que el ALB verifica los tokens (SEC-118)", PLATAFORMA)
    nodo("reiniciar", "alb")


def llave_deshacer(e: dict) -> None:
    deshacer_commit(e)
    nodo("reiniciar", "alb")
    time.sleep(70)                         # que la ventana de 1 min de las tasas ya no vea los 401


FALLAS = {
    "etiqueta-sin-techo": dict(
        tipo="config", titulo="Encontrar las lentas",
        historia="Beto, del equipo de classifier, cerró el BUG-2291: «ya podemos ver en Grafana cuáles requests son las "
                 "lentas del p99». Hizo merge en la tarde y los pods se reiniciaron con su cambio. Todo contesta 200.",
        explica="El commit de Beto agregó en gateway/app/main.py un histograma classifier_request_debug_seconds con la "
                "etiqueta request_id: una combinación de etiquetas nueva por request, es decir, 15 series nuevas por request "
                "(11 buckets + +Inf + _sum + _count + _created). A 5 fotos/s son ≈ 75 series nuevas por segundo y por pod; "
                "en C01, 150 millones al día solo en este histograma: Prometheus se queda sin memoria en horas. Lo que buscaba "
                "Beto ya existe: el exemplar de la latencia (trace_id) y la línea de log. Arreglo: python verificar.py "
                "series-acotadas, curl -s localhost:8951/metrics | grep debug | head, git log -p gateway/app/main.py, git revert "
                "del commit y python mundo/nodo.py reiniciar gateway (las series viejas se quedan en Prometheus hasta que "
                "dejen de llegar muestras; las nuevas ya no nacen).",
        aplicar=etiqueta_sin_techo, deshacer=etiqueta_deshacer),
    "monitor-perdido": dict(
        tipo="config", titulo="Nombres con prefijo",
        historia="Plataforma cerró el PLAT-4610: «todas las apps con el prefijo de su servicio, para ordenar el catálogo». "
                 "Producción contesta normal y nadie reportó nada. Es viernes en la tarde.",
        explica="El commit de plataforma en mundo/plataforma.yaml cambió la etiqueta de los pods del gateway de "
                "app.kubernetes.io/name: gateway a classifier-gateway. Tu job de Prometheus elige los pods con keep sobre "
                "esa etiqueta: ya no elige ninguno. Nada truena: el gateway contesta, Prometheus no se queja, y las alertas "
                "que dependen de classifier_* evalúan sobre nada y no suenan. Solo GatewaySinLectura (absent de up) lo ve. "
                "Arreglo: python verificar.py prometheus-lee, la página de targets de Prometheus (localhost:9952/targets), "
                "nodo/descubrimiento/pods.json (las etiquetas que llegan), git log -p mundo/plataforma.yaml, git revert del "
                "commit y python mundo/nodo.py publicar. La otra salida, aceptar el nombre nuevo en tu prometheus.yml, también "
                "vale, pero el arreglo de fondo es acordar el cambio antes: la etiqueta era un contrato.",
        aplicar=monitor_perdido, deshacer=monitor_deshacer),
    "s3-caido": dict(
        tipo="infra", titulo="El S3 en mantenimiento",
        historia="Llegó al canal del equipo: «LogsStale: el nodo a lleva 3 min sin subir logs a S3». Los usuarios no se han "
                 "quejado: el clasificador contesta bien.",
        explica="El S3 del mundo (RustFS) está apagado. El gateway no se entera: escribe en stdout y sigue, el runtime guarda "
                "en el disco del nodo y cada Fluent Bit junta lo que no puede subir en su buffer en disco (store_dir), y lo "
                "reintenta. Se degrada el monitoreo, no el servicio: ninguna request falló. Arreglo: python verificar.py log-en-s3, "
                "docker compose logs fluent-bit-a (PutObject request failed), curl -s localhost:9953/api/v2/metrics/prometheus "
                "| grep retries, docker compose ps s3 y docker compose start s3. En ≈ 10 s los Fluent Bit suben lo atrasado: "
                "no se pierde ninguna línea mientras el buffer aguante y mientras Fluent Bit no se rinda: con el retry_limit por omisión, a los ≈ 6 intentos (≈ 30 s) manda el pedazo a cuarentena y esas líneas no llegan a S3.",
        aplicar=s3_caido, deshacer=s3_de_vuelta),
    "lector-caido": dict(
        tipo="infra", titulo="El nodo sin lector",
        historia="LogsStale avisa, pero solo para un nodo. El otro sube normal. Producción contesta bien.",
        explica="El Fluent Bit del nodo b está apagado (en C01: el pod del DaemonSet de ese nodo no corre: un taint, un "
                "OOMKilled, un nodo nuevo donde no cupo). Las líneas del pod del nodo b se quedan en el disco del nodo; "
                "mientras el kubelet no las rote (5 archivos de 10 MiB), no se pierden: al volver, Fluent Bit sigue donde se "
                "quedó (su DB). Arreglo: python verificar.py log-en-s3, la alerta LogsStale con nodo=\"b\" "
                "(localhost:9952/alerts), docker compose ps y docker compose start fluent-bit-b; en ≈ 1 min sube lo atrasado.",
        aplicar=lector_caido, deshacer=lector_de_vuelta),
    "triton-caido": dict(
        tipo="infra", titulo="Las métricas tranquilas",
        historia="Soporte escribe: «los vendedores dicen que no salen las sugerencias». Abres el tablero del gateway: la "
                 "tasa de 5xx está en cero y el p99 se ve bien. ¿Qué pasa?",
        explica="Triton está apagado. Los dos pods del gateway contestan 503 en /readyz, salen del target group (en C01: salen de "
                "los Endpoints y el AWS Load Balancer Controller los da de baja) y el ALB, sin destinos registrados, "
                "contesta 503 él mismo: las requests nunca llegan a un pod. classifier_requests_total no sube, la fracción de "
                "5xx del gateway no tiene requests (o queda en 0) y ClassifierHigh5xxRate no suena. Solo lo ven las métricas "
                "del ALB (alb_httpcode_elb_total{code=\"503\"}, alb_healthy_host_count = 0) y la alerta ALB5xx. Arreglo: "
                "python verificar.py de-punta-a-punta, curl -s localhost:8957/metrics | grep elb, logs/alb.log (error_reason), "
                "python mundo/nodo.py estado y python mundo/nodo.py arrancar triton; en ≈ 1 min la ventana de las tasas "
                "ya no ve los 503 y ALB5xx se apaga.",
        aplicar=triton_caido, deshacer=triton_de_vuelta),
    "llave-rotada": dict(
        tipo="config", titulo="La rotación de llaves",
        historia="Seguridad cerró el SEC-118: «rotamos la llave con que el ALB verifica los tokens, como cada trimestre». "
                 "Diez minutos después, el backend de publicaciones dice que el clasificador «está caído».",
        explica="El commit de plataforma cambió alb.jwt.llave en mundo/plataforma.yaml, pero el proveedor de identidad sigue "
                "firmando con la anterior (mundo/callers.json): toda firma falla y el ALB contesta 401 él mismo. Los pods están "
                "sanos, el gateway no recibe nada y sus métricas se ven tranquilas; los 401 solo están en el ALB "
                "(alb_httpcode_elb_total{code=\"401\"}, logs/alb.log). Un 4xx no es culpa de Alba… salvo cuando lo pone su "
                "propia puerta. Arreglo: python verificar.py de-punta-a-punta, curl -s localhost:8957/metrics | grep elb, "
                "git log -p mundo/plataforma.yaml, git revert del commit y python mundo/nodo.py reiniciar alb (en ≈ 1 min la "
                "ventana de las tasas ya no ve los 401). En C01 la "
                "rotación se hace publicando la llave nueva junto a la vieja (JWKS) antes de firmar con ella.",
        aplicar=llave_rotada, deshacer=llave_deshacer),
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
    print("  revisando que todo esté sano (≈ 15 s)…")
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
        print("  restaurando…")
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
