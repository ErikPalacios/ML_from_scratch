"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca tus Dockerfiles ni tu compose.yaml.

    python3 romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python3 romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python3 romper.py --mostrar --falla X   # una falla concreta
    python3 romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python3 romper.py --revelar             # me rindo: explica la falla y restaura
    python3 romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py. La falla activa se guarda como un hash en .taller/:
ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import secrets
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import IMG_GW, IMG_MS, MODELO, RAIZ, REGISTRY, TALLER, escribir_json, leer_json, sh  # noqa: E402

ESTADO = TALLER / "romper.json"
CONFIG = RAIZ / "config.env"
BUENO = RAIZ / "mundo" / "modelos" / "iris-1.onnx"     # el registro de modelos del mundo
BASURA = RAIZ / "gateway" / "volcado-debug.bin"


def up() -> None:
    sh("docker", "compose", "up", "-d", timeout=300)


# ---------------------------------------------------------------- las fallas
def puerto_ocupado(e: dict) -> None:
    sh("docker", "compose", "down", timeout=120)
    sh("docker", "run", "-d", "--name", "demo-pagos", "-p", "8080:5000", "registry:2", check=True)


def url_localhost(e: dict) -> None:
    e["config_original"] = CONFIG.read_text()
    CONFIG.write_text(e["config_original"].replace("MODEL_SERVER_URL=http://model-server:8000", "MODEL_SERVER_URL=http://localhost:8000"))
    up()


def basura(e: dict) -> None:
    with BASURA.open("wb") as f:
        for _ in range(200):
            f.write(os.urandom(1_000_000))


def modelo_roto(e: dict) -> None:
    MODELO.write_bytes(BUENO.read_bytes()[:400])
    sh("docker", "compose", "build", "model-server", timeout=300)
    up()


def modelo_bueno(e: dict) -> None:
    shutil.copy(BUENO, MODELO)
    sh("docker", "compose", "build", "model-server", timeout=300)
    up()


def tag_pisado(e: dict) -> None:
    ajeno = f"{REGISTRY}/{IMG_GW}"
    sh("docker", "tag", IMG_MS, ajeno, check=True)
    sh("docker", "push", ajeno, check=True, timeout=300)
    sh("docker", "tag", IMG_GW, ajeno, check=True)      # tu etiqueta local vuelve a ser tu gateway


def repush(e: dict) -> None:
    sh("docker", "tag", IMG_GW, f"{REGISTRY}/{IMG_GW}", check=True)
    sh("docker", "push", f"{REGISTRY}/{IMG_GW}", check=True, timeout=300)


FALLAS = {
    "puerto-ocupado": dict(
        tipo="infra", titulo="La pila no levanta después del reinicio",
        historia="Anoche reiniciaron la máquina compartida del equipo. Hoy en la mañana alguien dejó corriendo «un momento» la demo de pagos, y desde entonces Iris no responde.",
        explica="Un contenedor ajeno (demo-pagos) publica el puerto 8080 del host. docker compose up -d falla con «port is already allocated» y el gateway no arranca. Se diagnostica con docker ps (la columna PORTS) o lsof -nP -iTCP:8080 -sTCP:LISTEN. Ojo: el contenedor del gateway ya quedó creado sin su puerto, y un docker compose up -d solo lo arranca (docker compose ps muestra 8080/tcp, sin 0.0.0.0:8080->). Arreglo: quitar ese contenedor (o publicar el gateway en otro puerto del host) y recrear el gateway: docker compose up -d --force-recreate gateway.",
        aplicar=puerto_ocupado, deshacer=lambda e: (sh("docker", "rm", "-f", "demo-pagos"), sh("docker", "compose", "up", "-d", "--force-recreate", timeout=300))),
    "url-localhost": dict(
        tipo="config", titulo="El gateway dice que el modelo no está listo",
        historia="Operaciones «limpió» la configuración del gateway para que fuera igual a la de las laptops del equipo. El despliegue salió sin errores.",
        explica="config.env quedó con MODEL_SERVER_URL=http://localhost:8000. Dentro del contenedor del gateway, localhost es el propio gateway: ahí no hay nadie en el 8000 y /readyz da 503. Entre contenedores se llega por el nombre del servicio en la red de compose. Arreglo: MODEL_SERVER_URL=http://model-server:8000 y docker compose up -d (recrea el gateway con la variable nueva).",
        aplicar=url_localhost, deshacer=lambda e: (CONFIG.write_text(e["config_original"]), up())),
    "basura-contexto": dict(
        tipo="mundo", titulo="El build del gateway se volvió lento",
        historia="Un compañero depuró una fuga de memoria del gateway la semana pasada. Desde entonces el build tarda y el CI se queja del tamaño del contexto.",
        explica="Dejó un volcado de 200 MB (gateway/volcado-debug.bin) en la carpeta del gateway. Todo lo que no está en .dockerignore viaja al builder en cada build, aunque el Dockerfile no lo copie. Arreglo: agregar el patrón (*.bin, o el archivo) al .dockerignore del gateway, o sacar el archivo de ahí. Ojo: si el .dockerignore no termina en salto de línea, echo '*.bin' >> lo pega a la última línea (*.pyc*.bin) y no ignora nada.",
        aplicar=basura, deshacer=lambda e: BASURA.unlink(missing_ok=True)),
    "modelo-roto": dict(
        tipo="mundo", titulo="El model server no arranca después del CI",
        historia="El pipeline de entrenamiento publicó anoche «la versión nueva» del modelo en model_repository/ y el CI reconstruyó la imagen del model server. Hoy la pila no está sana.",
        explica="El model.onnx que llegó está truncado: onnxruntime no lo puede abrir, el proceso muere al arrancar (fail fast), el healthcheck nunca pasa y el gateway, que espera service_healthy, no arranca. Como el modelo va DENTRO de la imagen, arreglar el archivo no basta: hay que reconstruir. Arreglo: recuperar el modelo bueno (mundo/modelos/iris-1.onnx, el registro de modelos del mundo), docker compose build model-server y docker compose up -d.",
        aplicar=modelo_roto, deshacer=modelo_bueno),
    "registry-caido": dict(
        tipo="infra", titulo="El push dice «connection refused»",
        historia="Docker Desktop se actualizó y se reinició solo durante la noche. Todo lo demás volvió a levantar.",
        explica="El contenedor registry está detenido: se creó sin política de reinicio, así que después del reinicio no volvió. Arreglo: docker start registry, y para que no vuelva a pasar, docker update --restart unless-stopped registry.",
        aplicar=lambda e: sh("docker", "stop", "registry", check=True), deshacer=lambda e: sh("docker", "start", "registry", check=True)),
    "tag-pisado": dict(
        tipo="infra", titulo="El tag 0.1 ya no es tu gateway",
        historia="Alguien del equipo subió un «hotfix» urgente anoche. En staging el gateway responde cosas raras, aunque nadie cambió la versión: sigue siendo 0.1.",
        explica="Alguien subió otra imagen (el model server) con el tag localhost:5050/iris-gateway:0.1. Los tags se pueden mover; el digest no. Quien hace pull de :0.1 recibe otra cosa. Se detecta comparando el digest del registry con el de tu imagen. Arreglo: volver a subir tu imagen y, de aquí en adelante, una versión nueva para cada cambio (tags inmutables) y desplegar por digest.",
        aplicar=tag_pisado, deshacer=repush),
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
        sys.exit("✗ ya hay una falla activa: python3 romper.py --verificar (o --restaurar)")
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
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python3 verificar.py, y a diagnosticar.")


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
