"""Mete una falla en cómo se sirve el modelo (servidor.env o servir.sh) y reinicia el servidor, como lo haría
alguien de la empresa. Nunca toca tu cliente (pipeline/).

    python3 romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python3 romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python3 romper.py --mostrar --falla X   # una falla concreta
    python3 romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python3 romper.py --revelar             # me rindo: explica la falla y restaura
    python3 romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py con el servidor arriba (python3 mundo/servidor.py arrancar).
La falla activa se guarda como un hash en .taller/: ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import ENV, TALLER, editar_env, escribir_json, leer_json  # noqa: E402

SERVIR = RAIZ / "servir.sh"
ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(ENV, RESPALDO / "servidor.env")
    shutil.copy(SERVIR, RESPALDO / "servir.sh")


def devolver() -> None:
    shutil.copy(RESPALDO / "servidor.env", ENV)
    shutil.copy(RESPALDO / "servir.sh", SERVIR)


def reiniciar() -> None:
    """Lo que hace la empresa después de cambiar algo: reiniciar el servicio."""
    print("  la empresa reinicia el servidor: python3 mundo/servidor.py arrancar")
    r = subprocess.run([sys.executable, "mundo/servidor.py", "arrancar"], cwd=RAIZ, capture_output=True, text=True, timeout=150)
    print("  " + (r.stdout.strip().splitlines() or ["(sin salida)"])[-1] if r.returncode == 0 else f"  salió con código {r.returncode}")


def editar_servir(fn) -> None:
    """Cambia el comando de servir.sh (las líneas con «\\» al final se juntan en una)."""
    s = SERVIR.read_text().replace("\\\n", " ")
    s2 = fn(s)
    if s2 == s:
        raise SystemExit("no pude cambiar servir.sh: ¿tiene `exec llama-server …` con --api-key y --reasoning?")
    SERVIR.write_text(re.sub(r"[ \t]{2,}", " ", s2))


def quitar(opcion: str):
    return lambda s: re.sub(rf"\s+{opcion}\s+(\"[^\"]*\"|'[^']*'|\S+)", "", s, count=1)


# ---------------------------------------------------------------- las fallas
def puerto_movido(_e: dict) -> None:
    editar_env("PUERTO", "8080")
    reiniciar()


def expuesto(_e: dict) -> None:
    editar_env("HOST", "0.0.0.0")
    reiniciar()


def paralelo(_e: dict) -> None:
    editar_env("PARALELO", "4")
    reiniciar()


def sin_clave(_e: dict) -> None:
    editar_servir(quitar("--api-key"))
    reiniciar()


def razonamiento(_e: dict) -> None:
    editar_servir(quitar("--reasoning"))
    reiniciar()


def plantilla(_e: dict) -> None:
    editar_servir(lambda s: re.sub(r"(exec\s+llama-server)", r"\1 --chat-template llama3", s, count=1))
    reiniciar()


ARRANCAR = "<code>python3 mundo/servidor.py arrancar</code>"
FALLAS = {
    "puerto-movido": dict(
        tipo="config", titulo="El asistente dice «sin respuesta» y el servidor está arriba", aplicar=puerto_movido,
        historia="Sistemas pidió mover el servidor del modelo al puerto 8080, «el que usan todos los servicios internos», y lo reinició.",
        explica="servidor.env quedó con PUERTO=8080 y LLM_URL sigue en http://127.0.0.1:9931/v1. El servidor escucha en 8080 y está sano (/health ok), pero tu cliente pregunta en 9931, donde ya no hay nadie: SinConexion. Se ve con python3 verificar.py config (LLM_URL no apunta a HOST:PUERTO) y python3 verificar.py cliente. Arreglo: que los dos digan lo mismo (PUERTO=9931 otra vez, o LLM_URL=http://127.0.0.1:8080/v1) y " + ARRANCAR + ". La URL del cliente sale de dónde escucha el servidor: una sola fuente de verdad."),
    "expuesto": dict(
        tipo="config", titulo="Una persona de otra área usó el modelo desde su laptop", aplicar=expuesto,
        historia="Para que un compañero lo probara desde su laptop, alguien cambió HOST en servidor.env y reinició el servidor. Funcionó.",
        explica="servidor.env quedó con HOST=0.0.0.0: el servidor escucha en todas las interfaces de la Mac, no solo en 127.0.0.1, y cualquiera en la misma red Wi-Fi llega al puerto 9931. La clave sigue pidiéndose, pero /health contesta a todos y la clave viaja en texto plano (HTTP, sin TLS). Se ve con python3 verificar.py config y lsof -nP -iTCP:9931 -sTCP:LISTEN (dice *:9931 en vez de 127.0.0.1:9931). Arreglo: HOST=127.0.0.1 y " + ARRANCAR + ". En el despacho, abrirlo a la red es una decisión: detrás de un gateway con TLS, llaves por persona y firewall (la estación 4)."),
    "paralelo-reparte": dict(
        tipo="infra", titulo="Desde que «aguanta 4 a la vez», las preguntas largas truenan", aplicar=paralelo,
        historia="Para que cuatro abogados pudieran preguntar al mismo tiempo, alguien subió PARALELO a 4 en servidor.env y reinició el servidor.",
        explica="llama-server reparte el contexto entre las peticiones a la vez: con -c 8192 y -np 4, cada una tiene 2,048 tokens (el log dice n_ctx_slot = 2048 y /v1/models dice n_ctx 2048). Las preguntas cortas siguen bien; el prompt del despacho (≈ 6,000 tokens) ya no cabe: HTTP 400, exceed_context_size_error. Se ve con python3 verificar.py servidor contexto, curl de /v1/models (meta.n_ctx) y python3 mundo/servidor.py log. Arreglo: PARALELO=1 y " + ARRANCAR + "; o, si de verdad hacen falta 4 a la vez, CONTEXTO=32768 (4 × 8,192), que pide 4 veces la memoria del KV cache. Cada lugar a la vez cuesta contexto y memoria: se calcula antes de prometerlo."),
    "sin-clave": dict(
        tipo="infra", titulo="El servidor contesta sin pedir clave", aplicar=sin_clave,
        historia="Para «simplificar», alguien limpió servir.sh de las opciones que «no hacían nada» y reinició el servidor. El asistente sigue contestando igual.",
        explica="servir.sh quedó sin --api-key: llama-server ya no pide clave, así que cualquier programa que llegue al puerto usa el modelo. Tu cliente sigue mandando la suya y todo parece bien: nada truena. Se ve con python3 verificar.py clave (sin clave, /v1/models contesta 200) o curl -s http://127.0.0.1:9931/v1/models sin Authorization. Arreglo: --api-key \"$CLAVE\" de vuelta en servir.sh y " + ARRANCAR + ". Lo que no se prueba por el lado de «sin permiso» no se sabe si funciona."),
    "razonamiento-auto": dict(
        tipo="infra", titulo="Las respuestas tardan más y salen cortadas a la mitad", aplicar=razonamiento,
        historia="Para «simplificar», alguien limpió servir.sh de las opciones que «venían por omisión» y reinició el servidor.",
        explica="servir.sh quedó sin --reasoning off, y por omisión es auto: Qwen3 vuelve a razonar antes de contestar. Cada respuesta gasta tokens en reasoning_content (en inglés) que nadie lee: la pregunta de prueba usó los 120 tokens de max_tokens y la respuesta se cortó a la mitad (finish_reason length), cuando sin razonar usa 31. Se ve con python3 verificar.py plantilla (el modelo razonó; además la pregunta entra como 29 tokens en vez de 33, porque con el razonamiento apagado la plantilla agrega un bloque <think> vacío) y con la respuesta cruda de curl. Arreglo: --reasoning \"$RAZONAMIENTO\" de vuelta en servir.sh y " + ARRANCAR + ". «Por omisión» cambia entre versiones: lo que importa se escribe explícito."),
    "plantilla-ajena": dict(
        tipo="infra", titulo="El modelo contesta cosas sin relación con la pregunta", aplicar=plantilla,
        historia="Siguiendo un tutorial de Llama, alguien agregó una opción a servir.sh «para que el chat salga mejor» y reinició el servidor.",
        explica="servir.sh quedó con --chat-template llama3: el servidor arma los mensajes con la plantilla de Llama 3, no con la de Qwen3 (ChatML, con <|im_start|>). Qwen3 no reconoce esas marcas especiales: la pregunta de prueba entra como 3 tokens en vez de 33 y la respuesta no tiene que ver con lo preguntado, hasta cortarse en max_tokens. Nada da error. Se ve con python3 verificar.py plantilla y curl /props (chat_template ya no trae <|im_start|>). Arreglo: quitar --chat-template de servir.sh (con --jinja, que viene por omisión, se usa la plantilla que trae el GGUF) y " + ARRANCAR + ". La plantilla de chat es parte del modelo: se usa la suya."),
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
    if leer_json(ESTADO_ROMPER):
        sys.exit("✗ ya hay una falla activa: python3 romper.py --verificar (o --restaurar)")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    print("  revisando que todo esté sano (≈ 10 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py con el servidor arriba (falla: {', '.join(malos)})")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    print("  rompiendo…")
    respaldar()
    escribir_json(ESTADO_ROMPER, e)
    f["aplicar"](e)
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
    devolver()
    ESTADO_ROMPER.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    reiniciar()
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
    e = leer_json(ESTADO_ROMPER)
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
