"""Mete una falla en la configuración (config.yaml) o en el reporte de la semana (indices/<vigente>/retrieval.json).
Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con el reporte ya medido: paso 6). Después de meter la falla, la
empresa corre el reporte de la semana como siempre. La falla activa se guarda como un hash en .taller/: ni tú ni
Claude la pueden leer ahí.
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
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import CONFIG, INDICES, TALLER, VIGENTE, escribir_json, leer_json  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def editar_config(clave: str, valor: str) -> None:
    """Cambia una línea de config.yaml («clave: valor»), sin perder los comentarios."""
    s = CONFIG.read_text()
    s2 = re.sub(rf'(?m)^(\s*{clave}:\s*)("[^"]*"|\S+)', lambda m: m.group(1) + valor, s, count=1)
    if s2 == s:
        raise SystemExit(f"no encontré {clave} en config.yaml")
    CONFIG.write_text(s2)


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(CONFIG, RESPALDO / "config.yaml")
    shutil.copy(REPORTE, RESPALDO / "retrieval.json")


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    shutil.copy(RESPALDO / "retrieval.json", REPORTE)


REPORTE = INDICES / VIGENTE / "retrieval.json"


def job() -> None:
    """Lo que corre la empresa cada lunes: el reporte de retrieval, con tu medir.py y la configuración de hoy."""
    print("  la empresa corre: python pipeline/medir.py")
    r = subprocess.run([sys.executable, "pipeline/medir.py"], cwd=RAIZ, capture_output=True, text=True, timeout=600)
    print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


# ---------------------------------------------------------------- las fallas
def fusion_suma(_e: dict) -> None:
    editar_config("fusion", "suma")
    job()


def candidatos_ocho(_e: dict) -> None:
    editar_config("candidatos", "8")
    job()


def filtro_despues(_e: dict) -> None:
    editar_config("filtro", "despues")
    job()


def rerank_pocos(_e: dict) -> None:
    editar_config("rerank_n", "8")
    job()


def medicion_mezclada(_e: dict) -> None:
    """El script viejo del reporte: promedia sobre todas las preguntas del split; las que no tienen fuentes que
    encontrar (o cuya fuente está prohibida) cuentan como 0."""
    t = CONFIG.read_text()
    CONFIG.write_text(re.sub(r"(?m)^(\s*tipos:\s*)\[[^\]]*\]", r"\1[directa, varias, sin_respuesta, prohibida]", t, count=1))
    rep = leer_json(REPORTE)
    v, items = ref.golden()
    test = [x for x in items if x["split"] == rep["split"]]
    n = len(test)
    for modo in ("bm25", "vectores", "fusion", "completo"):
        x = rep[modo]
        f = x["n"] / n
        x |= {"recall": x["recall"] * f, "recall@3": x["recall@3"] * f, "mrr": x["mrr"] * f, "n": n}
        x["por_tipo"] |= {t: {"recall": 0.0, "n": sum(y["tipo"] == t for y in test)} for t in ("sin_respuesta", "prohibida")}
    escribir_json(REPORTE, rep)
    print("  la empresa corre el script viejo del reporte (todas las preguntas del split)")


def split_afinado(_e: dict) -> None:
    """Alguien midió el reporte con las preguntas de dev, las mismas con las que se afinó, con un script aparte."""
    editar_config("split", "dev")
    rep = leer_json(REPORTE)
    bien = ref.medir(rep["config"], "dev")
    for modo, x in bien.items():
        rep[modo] |= {"recall": x["recall"], "recall@3": x["recall@3"], "mrr": x["mrr"], "n": x["n"], "margen": 0.0,
                      "por_tipo": x["por_tipo"], "fugas": x["fugas"]}
    rep["split"] = "dev"
    escribir_json(REPORTE, rep)
    print("  alguien corre su script del reporte con split dev")


MEDIR = "Arreglo: el valor de fábrica en config.yaml y <code>python pipeline/medir.py</code> para rehacer el reporte."
FALLAS = {
    "fusion-suma": dict(
        tipo="config", titulo="El reporte de la semana dice que la fusión perdió contra los vectores solos", aplicar=fusion_suma,
        historia="Para «simplificar» la fusión, alguien la cambió a sumar los puntajes de los dos índices: «total, los dos ya son puntajes, de mayor a menor».",
        explica="config.yaml quedó con retrieval.fusion: suma. BM25 da puntajes de ≈ 3 a ≈ 20 y el coseno de ≈ 0.7 a 0.9: al sumarlos, BM25 decide casi solo y la fusión se vuelve «BM25 con desempates». El reporte (indices/<vigente>/retrieval.json) baja la fusión de 100 % a 97.3 % de recall@8, debajo de los vectores solos (98.6 %), y su recall@3 a 85.1 %, el de BM25. Se ve con python verificar.py fusion. " + MEDIR + " RRF no mira los puntajes, solo el lugar: por eso junta listas que no están en la misma escala."),
    "candidatos-ocho": dict(
        tipo="config", titulo="Bajó la latencia, y el top-8 de varias preguntas cambió sin que nadie tocara el índice", aplicar=candidatos_ocho,
        historia="Para bajar la latencia, alguien le pidió 8 candidatos a cada índice en vez de 30: «total, al final solo salen 8».",
        explica="config.yaml quedó con retrieval.candidatos: 8. Cada índice corta en 8 antes de fusionar, así que un chunk que los dos tienen en el lugar 10 (y que por RRF iría arriba: 2/70 le gana a 1/61) nunca llega a la fusión, y al reranker le llegan a lo más 16 en vez de 20. En el dojo el recall@8 no se mueve (las fuentes ya estaban en los dos primeros 8), pero el pool baja y el top-8 cambia: se ve con python verificar.py candidatos. " + MEDIR + " Se corta después de fusionar, no antes; y la latencia de buscar 30 en vez de 8 es de milisegundos: lo caro es el reranker."),
    "filtro-despues": dict(
        tipo="config", titulo="Algunas personas reciben 3 o 4 chunks en vez de 8", aplicar=filtro_despues,
        historia="Al probar el cambio a «la base vectorial nueva», el filtro de permisos se puso como post-filtro, como venía en el ejemplo de la documentación.",
        explica="config.yaml quedó con retrieval.filtro: despues. Cada índice elige sus 30 candidatos entre los 151 chunks y después se quitan los que la persona no ve: a quien ve poco le llegan menos de 8, aunque tenga más de 8 chunks a la mano. Nadie recibe algo prohibido (el filtro sigue ahí), pero el LLM de la estación 7 recibiría menos contexto justo a quien menos ve. Se ve con python verificar.py permisos y en la columna «cortos» del reporte. " + MEDIR + " Primero se filtra y después se elige, como en la estación 3."),
    "rerank-pocos": dict(
        tipo="config", titulo="El reranker «ya no ayuda»: fusión y fusión + reranker dan el mismo recall@8", aplicar=rerank_pocos,
        historia="El reranker era lo más lento del retrieval, así que alguien le pasó solo los 8 primeros de la fusión: «son los que van a salir de todos modos».",
        explica="config.yaml quedó con retrieval.rerank_n: 8. Si el reranker solo lee los 8 que ya iban a salir, puede cambiar su orden pero no puede traer nada de más abajo: el recall@8 de fusión + reranker es, por fuerza, el de la fusión sola. Bajó la latencia (≈ 60 ms en vez de ≈ 370 ms en el p50), pero el reranker ya no rescata nada. Se ve con python verificar.py rerank. " + MEDIR + " El reranker necesita más candidatos que k: ese es su trabajo, subir lo que la fusión dejó abajo."),
    "medicion-mezclada": dict(
        tipo="config", titulo="El recall@8 del reporte cayó a ≈ 73 % en los cuatro modos a la vez", aplicar=medicion_mezclada,
        historia="Para que «la muestra sea más grande», alguien puso todos los tipos de pregunta en la medición y corrió el script viejo del reporte.",
        explica="config.yaml quedó con medicion.tipos: [directa, varias, sin_respuesta, prohibida] y el reporte promedia sobre las 51 preguntas de test: las 8 sin respuesta no tienen fuentes que encontrar y en las 6 prohibidas la fuente es justo lo que no debe llegar, así que todas cuentan como 0 y el recall@8 baja a 37/51 = 72.5 % en fusión. No empeoró nada: se midió mal. Tu medir.py se niega con esa configuración (ValueError). Se ve con python verificar.py medicion reporte. Arreglo: medicion.tipos vuelve a [directa, varias] y python pipeline/medir.py. Las sin respuesta y las prohibidas se miden aparte (fugas, y en la estación 7 si el asistente dice «no sé»)."),
    "split-afinado": dict(
        tipo="config", titulo="El reporte de la semana dice 100 % en todo, con un margen de ± 0", aplicar=split_afinado,
        historia="Para tener el número del reporte antes de la junta, alguien lo midió con las preguntas de dev, «que ya estaban corridas».",
        explica="config.yaml quedó con medicion.split: dev y el reporte es de las 9 preguntas de dev: las mismas con las que se eligieron rrf_k y rerank_n (python pipeline/medir.py --afinar). Medir con lo que se usó para afinar da un número optimista, y con 9 preguntas cualquier número es ruido. Tu medir.py se niega a medir con el split de afinar (ValueError). Se ve con python verificar.py medicion reporte. Arreglo: medicion.split vuelve a test y python pipeline/medir.py. Se afina con dev; el número que se reporta sale de test, que nadie usó para decidir."),
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
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    print("  revisando que todo esté sano (≈ 15 s)…")
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
