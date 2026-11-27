"""Mete una falla en cómo se sirve el modelo o cómo se prueba (servidor.env, servir.sh o carga.env) y reinicia el
servidor, como lo haría alguien del despacho. Nunca toca tu código (pipeline/).

    python3 romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python3 romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python3 romper.py --mostrar --falla X   # una falla concreta
    python3 romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python3 romper.py --revelar             # me rindo: explica la falla y restaura
    python3 romper.py --restaurar           # deshace la falla activa y deja todo sano

Se practica en tu Mac, con el vLLM del dojo: romper en la GPU rentada es pagar por esperar. Antes de romper, todo
tiene que pasar verificar.py con el servidor arriba. La falla activa se guarda como un hash en .taller/: ni tú ni
Claude la pueden leer ahí.
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
from mundo.comun import ENV, RESULTADOS, TALLER, editar_env, escribir_json, leer_json, remoto  # noqa: E402

SERVIR = RAIZ / "servir.sh"
CARGA = RAIZ / "carga.env"
ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    for f in (ENV, SERVIR, CARGA):
        shutil.copy(f, RESPALDO / f.name)
    if RESULTADOS.exists():
        shutil.copytree(RESULTADOS, RESPALDO / "resultados")


def devolver() -> None:
    for f in (ENV, SERVIR, CARGA):
        shutil.copy(RESPALDO / f.name, f)
    if (RESPALDO / "resultados").exists():
        shutil.rmtree(RESULTADOS, ignore_errors=True)
        shutil.copytree(RESPALDO / "resultados", RESULTADOS)


def reiniciar() -> None:
    """Lo que hace el despacho después de cambiar algo: reiniciar el servicio."""
    print("  el despacho reinicia el servidor: python3 mundo/servidor.py arrancar")
    r = subprocess.run([sys.executable, "mundo/servidor.py", "arrancar"], cwd=RAIZ, capture_output=True, text=True, timeout=300)
    print("  " + (r.stdout.strip().splitlines() or ["(sin salida)"])[-1] if r.returncode == 0 else f"  salió con código {r.returncode}")


def editar_servir(fn) -> None:
    """Cambia el comando de servir.sh (las líneas con «\\» al final se juntan en una)."""
    s = SERVIR.read_text().replace("\\\n", " ")
    s2 = fn(s)
    if s2 == s:
        raise SystemExit("no pude cambiar servir.sh: ¿tiene `exec vllm serve …` con sus opciones?")
    SERVIR.write_text(re.sub(r"[ \t]{2,}", " ", s2))


def quitar(opcion: str):
    return lambda s: re.sub(rf"\s+{opcion}\s+(\"[^\"]*\"|'[^']*'|\S+)", "", s, count=1)


def cambiar(opcion: str, valor: str):
    return lambda s: re.sub(rf"({opcion}\s+)(\"[^\"]*\"|'[^']*'|\S+)", rf"\g<1>{valor}", s, count=1)


# ---------------------------------------------------------------- las fallas
def tope_dos(_e: dict) -> None:
    editar_servir(cambiar("--max-num-seqs", "2"))
    reiniciar()


def memoria_recortada(_e: dict) -> None:
    editar_servir(lambda s: re.sub(r"(exec\s+vllm\s+serve\s+\S+)", r"\1 --gpu-memory-utilization 0.55", s, count=1))
    reiniciar()


def sin_clave(_e: dict) -> None:
    editar_servir(quitar("--api-key"))
    reiniciar()


def razonamiento(_e: dict) -> None:
    editar_servir(quitar("--default-chat-template-kwargs"))
    reiniciar()


def nombre_servido(_e: dict) -> None:
    editar_servir(cambiar("--served-model-name", "chat-grande"))
    reiniciar()


def tasa_infinita(_e: dict) -> None:
    editar_env("TASA", "inf", CARGA)
    print("  y vuelve a correr la abierta: python3 pipeline/carga.py abierta (≈ 3 min)")
    r = subprocess.run([sys.executable, "pipeline/carga.py", "abierta"], cwd=RAIZ, capture_output=True, text=True, timeout=1800)
    print("  " + (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[0])


ARRANCAR = "<code>python3 mundo/servidor.py arrancar</code>"
FALLAS = {
    "tope-dos": dict(
        tipo="infra", titulo="En la hora pico, los abogados esperan medio minuto antes de ver la primera palabra", aplicar=tope_dos,
        historia="Alguien leyó en la ficha que una L40S sostiene ≥ 20 tokens/s solo con 2 conversaciones, y para que «cada abogado escriba rápido» fijó el tope a mano en servir.sh. Reinició el servidor.",
        explica="servir.sh quedó con --max-num-seqs 2 (a mano, en vez de \"$MAX_NUM_SEQS\"): el motor corre 2 conversaciones a la vez y las demás esperan en fila, aunque el KV cache tenga lugar para 12. Cada una que llega detrás de dos respuestas largas espera hasta ≈ 27 s. Se ve con python3 verificar.py lugares (con 10 a la vez corren 2 y esperan 8) y en /metrics (vllm:num_requests_waiting). Arreglo: --max-num-seqs \"$MAX_NUM_SEQS\" de vuelta en servir.sh y " + ARRANCAR + ". Los 2 de la ficha son cuántas van a ≥ 20 tokens/s, no un tope: con tope, el TTFT se vuelve fila. Si hacen falta más rápidas, son más GPUs (por eso son 3 copias)."),
    "memoria-recortada": dict(
        tipo="infra", titulo="Con 8 abogados a la vez, las respuestas se detienen y vuelven a empezar", aplicar=memoria_recortada,
        historia="Para «dejarle memoria al modelo de embeddings» en la misma GPU, alguien copió de un tutorial viejo --gpu-memory-utilization 0.55 a servir.sh y reinició el servidor. Arrancó bien.",
        explica="servir.sh quedó con --gpu-memory-utilization 0.55: vLLM solo usa el 55 % de la memoria de la GPU. Menos los pesos (≈ 18 GiB) y lo del programa, al KV cache le quedan ≈ 4.7 GiB: ≈ 19 mil tokens, para 8 conversaciones de ≈ 6,500 que piden ≈ 52 mil. El servidor arranca y contesta, pero con 8 a la vez se acaban los bloques: vLLM saca a la última que entró (preemption) y la vuelve a leer después. Se ve con python3 verificar.py memoria (vllm:cache_config_info: num_gpu_blocks × 16) y en el log (GPU KV cache size y Maximum concurrency). Arreglo: quitar --gpu-memory-utilization de servir.sh (la 0.34 dimensiona el KV cache con la memoria libre) y " + ARRANCAR + ". El embeddings va en otra GPU (la ficha lo pone en otra L40S): compartir la tarjeta se cobra en KV cache."),
    "sin-clave": dict(
        tipo="infra", titulo="El servidor contesta sin pedir clave", aplicar=sin_clave,
        historia="Para «simplificar» y que el gateway no tuviera que mandar la llave, alguien quitó una opción de servir.sh y reinició el servidor. Todo sigue funcionando igual.",
        explica="servir.sh quedó sin --api-key: vLLM ya no pide clave, así que cualquier programa que llegue al puerto usa el modelo. En el pod es peor: el proxy de RunPod es una URL pública de internet. Tu cliente sigue mandando su clave y nada truena. Se ve con python3 verificar.py clave (sin clave, /v1/models contesta 200) o con curl sin Authorization. Arreglo: --api-key \"$CLAVE\" de vuelta en servir.sh y " + ARRANCAR + ". Lo que no se prueba del lado de «sin permiso» no se sabe si funciona."),
    "razonamiento-prendido": dict(
        tipo="infra", titulo="Las respuestas tardan el doble y salen con un «pensamiento» en inglés", aplicar=razonamiento,
        historia="Limpiando servir.sh de «un JSON raro que nadie entendía», alguien quitó una opción y reinició el servidor.",
        explica="servir.sh quedó sin --default-chat-template-kwargs '{\"enable_thinking\": false}': Qwen3 vuelve a razonar antes de contestar (es su modo por omisión). Cada respuesta gasta cientos de tokens en el campo reasoning, que nadie lee: el tiempo hasta la respuesta útil se dispara y el tope de 500 tokens se va en pensar. Se ve con python3 verificar.py plantilla (el modelo razonó y el prompt cambió de tamaño: sin enable_thinking false la plantilla ya no agrega el bloque <think> vacío). Arreglo: la opción de vuelta en servir.sh y " + ARRANCAR + ". Lo que importa se escribe explícito, aunque se vea raro."),
    "nombre-servido": dict(
        tipo="config", titulo="El asistente dice «el modelo no existe» y el servidor está sano", aplicar=nombre_servido,
        historia="Para que el gateway lo encuentre como en la ficha («chat-grande»), alguien cambió el nombre en servir.sh, pero no en servidor.env. Reinició el servidor.",
        explica="servir.sh quedó con --served-model-name chat-grande, y servidor.env (lo que usan tus programas) sigue con NOMBRE=qwen3-32b. El servidor anuncia chat-grande y contesta /health; cada pregunta con model=qwen3-32b recibe un 404: The model `qwen3-32b` does not exist. Se ve con python3 verificar.py servidor y con curl de /v1/models. Arreglo: --served-model-name \"$NOMBRE\" de vuelta (una sola fuente de verdad) y " + ARRANCAR + ". En la ficha, «chat-grande» es el nombre en el gateway (LiteLLM), que traduce al nombre de cada copia de vLLM."),
    "tasa-infinita": dict(
        tipo="config", titulo="La prueba nueva dice que el TTFT p95 es de un minuto", aplicar=tasa_infinita,
        historia="Para que la prueba abierta no tardara 10 minutos, alguien puso TASA=inf en carga.env («que mande todo de una vez») y la volvió a correr. Le salió un TTFT espantoso y escribió en el chat que vLLM «no sirve».",
        explica="carga.env quedó con TASA=inf: las 40 preguntas salen en el segundo 0, no a 0.07/s. Eso no es la prueba abierta del despacho: es una ráfaga. 8 entran al motor y 32 esperan en fila detrás de prompts de 6,000 tokens, así que el TTFT mide la fila de la ráfaga y no lo que vive un abogado. El reporte compara contra un criterio que pide la tasa de diseño. Se ve con python3 verificar.py prueba (TASA tiene que ser 0.07) y abierta (las llegadas no son las de Poisson a 0.07 con la semilla). Arreglo: TASA=0.07 en carga.env y otra vez python3 pipeline/carga.py abierta (≈ 10 min). Un benchmark honesto dice a qué tasa se midió; uno a tasa infinita solo dice cuánto aguanta una ráfaga."),
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
    if remoto():
        sys.exit("✗ LLM_URL apunta al pod: las fallas se practican en tu Mac (romper en la GPU rentada es pagar por esperar)")
    if leer_json(ESTADO_ROMPER):
        sys.exit("✗ ya hay una falla activa: python3 romper.py --verificar (o --restaurar)")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    print("  revisando que todo esté sano (≈ 30 s)…")
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
