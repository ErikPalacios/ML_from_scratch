"""Mete una falla en la configuración del examen, del juez o del gate (config.yaml), o en sus servidores. Nunca toca tu
código (pipeline/) ni tus corridas (corridas/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py --rapido (≈ 1 min: todo menos el examen completo; los dos
servidores y la API arriba). Si la falla para un servidor, al restaurar se vuelve a arrancar. La falla activa se guarda como un hash en .taller/: ni tú
ni Claude la pueden leer ahí.
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
from mundo.comun import CONFIG, ENV, TALLER, editar_env, escribir_json, leer_json  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def editar_config(clave: str, valor: str) -> None:
    """Cambia una línea de config.yaml («clave: valor»), sin perder los comentarios."""
    s = CONFIG.read_text()
    s2 = re.sub(rf'(?m)^(\s*{clave}:\s*)(\[[^\]]*\]|"[^"]*"|\S+)', lambda m: m.group(1) + valor, s, count=1)
    if s2 == s:
        raise SystemExit(f"no encontré {clave} en config.yaml")
    CONFIG.write_text(s2)


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(CONFIG, RESPALDO / "config.yaml")
    shutil.copy(ENV, RESPALDO / "servidor.env")


def llm_de_nuevo() -> None:
    print("  arrancando el LLM otra vez: python mundo/servidor.py arrancar")
    r = subprocess.run([sys.executable, "mundo/servidor.py", "arrancar"], cwd=RAIZ, capture_output=True, text=True, timeout=180)
    print("  " + (r.stdout.strip().splitlines() or ["(sin salida)"])[-1])


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    otro = (RESPALDO / "servidor.env").read_text() != ENV.read_text()
    shutil.copy(RESPALDO / "servidor.env", ENV)
    if otro:
        llm_de_nuevo()
    from mundo.servidor import salud
    if not salud("juez"):
        print("  arrancando el juez otra vez: python mundo/servidor.py arrancar juez")
        subprocess.run([sys.executable, "mundo/servidor.py", "arrancar", "juez"], cwd=RAIZ, capture_output=True, text=True, timeout=180)


# ---------------------------------------------------------------- las fallas
def examen_con_cache(_e: dict) -> None:
    editar_config("sin_cache", "false")


def examen_con_dev(_e: dict) -> None:
    editar_config("split", "todas")


def juez_es_la_api(_e: dict) -> None:
    editar_config("url", "http://127.0.0.1:9931/v1")
    print("  parando el juez: python mundo/servidor.py parar juez")
    subprocess.run([sys.executable, "mundo/servidor.py", "parar", "juez"], cwd=RAIZ, capture_output=True, text=True, timeout=60)


def margen_ancho(_e: dict) -> None:
    editar_config("margen", "0.5")
    editar_config("caida_max", "0.5")


def sin_parear(_e: dict) -> None:
    editar_config("pareado", "false")


def contra_la_ultima(_e: dict) -> None:
    editar_config("base", "ultima")


ARREGLO = "Arreglo: el valor de fábrica"
FALLAS = {
    "examen-con-cache": dict(
        tipo="config", titulo="Un cambio de retrieval sale igual que la base en el examen, y en producción no", aplicar=examen_con_cache,
        historia="Para que el examen corra más rápido, alguien dejó que use la cache de la API: «las preguntas son las mismas de siempre».",
        explica="config.yaml quedó con evals.sin_cache: false. La API guarda el top-8 de cada pregunta y persona 5 minutos; si el examen pregunta sin «Cache-Control: no-cache» (que la API toma, por convención, como «sáltate tu cache»), las preguntas que ya se hicieron hace poco (la corrida de la base, por ejemplo) reciben el top de antes, el de la configuración vieja. Un cambio de retrieval (k, candidatos, el reranker) se mide con el retrieval de la base y sale idéntico. Se ve con python verificar.py correr (filas con de_cache) y el gate lo bloquea con su regla sin_cache. " + ARREGLO + " (evals.sin_cache: true): un examen mide el sistema de hoy, sin caches de por medio."),
    "examen-con-dev": dict(
        tipo="config", titulo="El examen trae 65 preguntas en vez de 51 y ya no se compara con la base", aplicar=examen_con_dev,
        historia="Para tener «más preguntas y menos ruido», alguien juntó dev y test en el examen del gate.",
        explica="config.yaml quedó con evals.split: todas. Las 14 de dev ya se usaron para elegir el umbral del «no sé» (estación 8): medir con ellas premia lo que se ajustó con ellas, como un examen con las preguntas que se repasaron. Además el examen ya no tiene las mismas preguntas que la base: el gate bloquea por comparable. Se ve con python verificar.py correr. " + ARREGLO + " (evals.split: test): dev es para decidir, test para medir, y no se mezclan."),
    "juez-es-la-api": dict(
        tipo="infra", titulo="El juez reprueba la mitad de las respuestas buenas y el gate ya no le cree", aplicar=juez_es_la_api,
        historia="Para ahorrar memoria, alguien apagó el juez de 4B y lo apuntó al LLM de la API: «es el mismo tipo de modelo, y ya está cargado».",
        explica="config.yaml quedó con juez.url en el puerto 9931 (el LLM de la API, Qwen3 0.6B) y el servidor del juez quedó parado. Un juez que es el mismo modelo que contesta tiende a preferir sus respuestas; y el de 0.6B ni siquiera se parece a las personas (en la calibración, kappa ≈ 0.3: reprueba ≈ 55 % de las respuestas buenas). El gate lo nota porque exige una calibración que pase y que sea del juez que calificó. Se ve con python verificar.py juez. Arreglo: juez.url de vuelta a http://127.0.0.1:9933/v1 y python mundo/servidor.py arrancar juez; si se cambia de juez, se vuelve a calibrar."),
    "margen-ancho": dict(
        tipo="config", titulo="Un cambio que pierde 4 respuestas de 51 pasa el gate", aplicar=margen_ancho,
        historia="El gate bloqueó tres cambios seguidos y el equipo pidió «aflojarlo un poco».",
        explica="config.yaml quedó con gate.margen: 0.5 y gate.caida_max: 0.5: el gate deja pasar caídas de hasta 50 puntos. El margen no se elige para que pasen los cambios: es lo que el negocio acepta perder, y con 51 preguntas el examen solo distingue caídas de ≈ 10 puntos (el precálculo «margen»). Se ve con python verificar.py estadistica. " + ARREGLO + " (margen 0.10, caida_max 0.03): si el gate bloquea mucho, se agregan preguntas o se leen las que cambiaron, no se afloja."),
    "sin-parear": dict(
        tipo="config", titulo="Un cambio que no cambia ninguna respuesta se bloquea", aplicar=sin_parear,
        historia="Alguien leyó que «lo correcto es comparar los dos porcentajes con su intervalo» y apagó la comparación pregunta por pregunta.",
        explica="config.yaml quedó con gate.pareado: false. Sin parear, el gate trata la base y la candidata como dos muestras independientes: el error estándar de la diferencia sale de la varianza de cada una (≈ 8 puntos con 51 preguntas) y no del puñado de preguntas que cambiaron. La cota de abajo cae a ≈ −14 puntos aunque no cambie nada, y todo se bloquea. Se ve con python verificar.py estadistica. " + ARREGLO + " (gate.pareado: true): son las mismas preguntas, y solo cuentan las que cambiaron."),
    "contra-la-ultima": dict(
        tipo="config", titulo="Una regresión que el gate bloqueó pasa a la segunda", aplicar=contra_la_ultima,
        historia="Para no tener que promover a mano, alguien hizo que el gate compare contra la última corrida en vez de contra la vigente.",
        explica="config.yaml quedó con gate.base: ultima. Si un cambio malo se bloquea y alguien lo vuelve a correr, la segunda corrida se compara con la primera (que es igual de mala) y pasa: la calidad baja de a poco sin que nadie lo decida, como subir la vara de medir junto con lo que se mide. Se ve con python verificar.py promover. " + ARREGLO + " (gate.base: vigente): se compara siempre con lo que la empresa usa hoy, y solo se mueve con promover."),
}


# ---------------------------------------------------------------- comandos
def h(sal: str, falla: str) -> str:
    return hashlib.sha256(f"{sal}|{falla}".encode()).hexdigest()


def activa(e: dict) -> str | None:
    return next((f for f in FALLAS if h(e["sal"], f) == e["hash"]), None) if e else None


def verificar(silencio: bool = True) -> list[str]:
    import verificar as v

    r = v.correr(v.RAPIDOS, silencio=silencio)
    return [k for k, (ok, _) in r.items() if not ok]


def romper(mostrar: bool, cual: str | None) -> None:
    if leer_json(ESTADO_ROMPER):
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    print("  revisando que todo esté sano (≈ 1 min, sin el examen completo)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
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
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


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
