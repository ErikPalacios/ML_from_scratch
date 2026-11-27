"""Mete una falla en cómo se mide (medicion.json) o en lo que se mide (cuantizados/) y corre el benchmark de la
empresa con tu pipeline. Nunca toca tu código (pipeline/).

    python3 romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python3 romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python3 romper.py --mostrar --falla X   # una falla concreta
    python3 romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python3 romper.py --revelar             # me rindo: explica la falla y restaura
    python3 romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py. Romper tarda hasta ≈ 1 minuto: vuelve a medir con tu pipeline.
La falla activa se guarda como un hash en .taller/: ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import CUANTIZADOS, MEDICION, RESULTADOS, TALLER, escribir_json, herramienta, leer_json, ruta_modelo, sha256_archivo  # noqa: E402
from mundo.ficha import resumen  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
Q4 = CUANTIZADOS / "Qwen3-0.6B-Q4_K_M.gguf"
NUEVOS = RAIZ / "mundo" / "entrada" / "prompts-rapidos.json"


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(MEDICION, RESPALDO / "medicion.json")
    shutil.copy(CUANTIZADOS / "manifiesto.json", RESPALDO / "manifiesto.json")
    shutil.copytree(RESULTADOS, RESPALDO / "resultados")


def devolver() -> None:
    shutil.copy(RESPALDO / "medicion.json", MEDICION)
    shutil.copy(RESPALDO / "manifiesto.json", CUANTIZADOS / "manifiesto.json")
    if (RESPALDO / Q4.name).exists():
        shutil.copy(RESPALDO / Q4.name, Q4)
    shutil.rmtree(RESULTADOS, ignore_errors=True)
    shutil.copytree(RESPALDO / "resultados", RESULTADOS)
    NUEVOS.unlink(missing_ok=True)


def editar(seccion: str, clave: str, valor) -> None:
    m = leer_json(MEDICION)
    m[seccion][clave] = valor
    MEDICION.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n")


def job(*pasos: list[str]) -> None:
    """Lo que corre la empresa por su cuenta: el benchmark de la noche, con tu pipeline."""
    for a in pasos:
        print(f"  la empresa corre: python3 {' '.join(a)}")
        r = subprocess.run([sys.executable, *a], cwd=RAIZ, capture_output=True, text=True, timeout=900)
        print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


MEDIR = (["pipeline/medir.py"], ["pipeline/reporte.py"])


# ---------------------------------------------------------------- las fallas
def prompts_a_medias(_e: dict) -> None:
    p = leer_json(RAIZ / "mundo" / "entrada" / "prompts.json")
    largo = next(x for x in p["prompts"] if x["id"] == "largo")
    docs = largo["texto"].split("\n\n")
    largo["texto"] = "\n\n".join(docs[:len(docs) // 2] + docs[-1:])          # la mitad de los documentos, y la pregunta
    escribir_json(NUEVOS, p)
    editar("velocidad", "prompts", str(NUEVOS.relative_to(RAIZ)))
    job(["pipeline/medir.py", "Q2_K"], ["pipeline/reporte.py"])


def cache_prompt(_e: dict) -> None:
    editar("velocidad", "cache_prompt", True)
    job(*MEDIR)


def metrica_total(_e: dict) -> None:
    editar("velocidad", "metrica", "total")
    job(*MEDIR)


def largo_libre(_e: dict) -> None:
    editar("velocidad", "largo_fijo", False)
    job(*MEDIR)


def examen_azar(_e: dict) -> None:
    editar("calidad", "temperatura", 0.8)
    editar("calidad", "semilla", -1)
    job(["pipeline/calidad.py"], ["pipeline/reporte.py"])


def archivo_equivocado(_e: dict) -> None:
    shutil.copy(Q4, RESPALDO / Q4.name)
    print("  alguien corre: llama-quantize modelo/Qwen3-0.6B-f16.gguf cuantizados/Qwen3-0.6B-Q4_K_M.gguf Q4_0")
    subprocess.run([herramienta("llama-quantize"), str(ruta_modelo()), str(Q4), "Q4_0"], capture_output=True, check=True)
    m = leer_json(CUANTIZADOS / "manifiesto.json")
    m["Q4_K_M"] |= {"bytes": Q4.stat().st_size, "sha256": sha256_archivo(Q4), "bits_por_peso": resumen(Q4)["bits_por_peso"]}   # «para que cuadre»
    escribir_json(CUANTIZADOS / "manifiesto.json", m)
    job(["pipeline/medir.py", "Q4_K_M"], ["pipeline/calidad.py", "Q4_K_M"], ["pipeline/reporte.py"])


FALLAS = {
    "prompts-a-medias": dict(
        tipo="config", titulo="Q2_K ahora lee el prompt largo más rápido que las demás", aplicar=prompts_a_medias,
        historia="El prompt largo «tardaba mucho», así que alguien hizo una versión más corta, la puso en medicion.json y volvió a medir solo la Q2_K, «que era la que faltaba revisar».",
        explica="medicion.json quedó con velocidad.prompts: mundo/entrada/prompts-rapidos.json, con la mitad de los documentos en el prompt largo, y solo Q2_K se volvió a medir con él. En la tabla, Q2_K tiene un TTFT largo de la mitad: no porque lea más rápido, sino porque lee menos. Q8_0 y Q4_K_M siguen con el prompt de antes. Se ve con python3 verificar.py comparable (el prompt largo entró con distintos tokens según la cuantización) y en resultados/velocidad.json (prompt_n). Arreglo: velocidad.prompts vuelve a mundo/entrada/prompts.json y python3 pipeline/medir.py (todas) y reporte.py. Una tabla lado a lado solo vale si cada columna se midió con lo mismo: si cambia el prompt, se mide todo otra vez."),
    "cache-prompt": dict(
        tipo="config", titulo="El TTFT bajó de 1.8 s a 10 ms de un día para otro", aplicar=cache_prompt,
        historia="Alguien leyó que llama-server «reusa el prompt» y lo prendió en medicion.json para «medir como en producción». El benchmark de la noche dio números increíbles.",
        explica="medicion.json quedó con velocidad.cache_prompt: true. Cada prompt se repite 3 veces, y desde la segunda el servidor reusa el KV cache del prompt anterior: lee 1 token en vez de miles, y el TTFT baja a ≈ 10 ms. No es la velocidad del modelo: es la de no hacer el trabajo. Se ve con python3 verificar.py comparable (prompt_n de 1 en las muestras) y en resultados/velocidad.json. Arreglo: cache_prompt: false y python3 pipeline/medir.py y reporte.py. El cache sí ayuda en producción (conversaciones que repiten su inicio), pero se mide aparte."),
    "metrica-total": dict(
        tipo="config", titulo="Con el prompt largo, el modelo «escribe» a la mitad", aplicar=metrica_total,
        historia="Para que el reporte «se parezca a lo que siente el usuario», alguien cambió en medicion.json cómo se calculan los tokens por segundo.",
        explica="medicion.json quedó con velocidad.metrica: total: los tokens por segundo se calculan como tokens ÷ el tiempo total de la petición, que incluye leer el prompt. Con el prompt corto casi no se nota; con el largo (≈ 2,900 tokens que tardan ≈ 1.8 s en leerse) la «escritura» baja a ≈ 40 tokens/s cuando el modelo escribe a ≈ 100. Mezcla dos números que se deciden distinto. Se ve con python3 verificar.py velocidad (el largo contra el corto) y en las muestras. Arreglo: metrica: decode (predicted_per_second de llama-server) y python3 pipeline/medir.py y reporte.py. TTFT y tokens por segundo al escribir se reportan por separado."),
    "largo-libre": dict(
        tipo="config", titulo="Q8_0 «escribe» igual de rápido con respuestas de 20 tokens que con las de 128", aplicar=largo_libre,
        historia="Alguien vio respuestas que seguían escribiendo después de terminar la idea y quitó el largo fijo de medicion.json «para que el modelo pare cuando quiera».",
        explica="medicion.json quedó con velocidad.largo_fijo: false. Cada cuantización contesta lo que quiere: una para en 24 tokens, otra escribe los 128. Los tokens por segundo y el tiempo total de una respuesta de 24 tokens no se comparan con los de una de 128 (el arranque pesa distinto, y en una el contexto crece más). Se ve con python3 verificar.py comparable (tokens distintos en las muestras). Arreglo: largo_fijo: true (ignore_eos: todas escriben max_tokens) y python3 pipeline/medir.py y reporte.py. Para medir velocidad se fija el trabajo; para medir calidad, se deja contestar."),
    "examen-al-azar": dict(
        tipo="config", titulo="El examen sale distinto cada noche", aplicar=examen_azar,
        historia="Alguien copió a medicion.json la temperatura y la semilla «de la interfaz de chat», porque «así lo usan los abogados».",
        explica="medicion.json quedó con calidad.temperatura: 0.8 y semilla: -1 (una distinta cada vez). Con azar, la misma pregunta da otra respuesta en cada vuelta, y un acierto de más o de menos en 12 preguntas es puro ruido: no se puede comparar una cuantización con otra ni con la de ayer. Se ve con python3 verificar.py calidad (las dos vueltas no coinciden). Arreglo: temperatura: 0 y semilla: 7, y python3 pipeline/calidad.py y reporte.py. Para comparar, todo lo que no se compara se fija."),
    "archivo-equivocado": dict(
        tipo="infra", titulo="El Q4_K_M de esta noche perdió calidad y nadie cambió nada", aplicar=archivo_equivocado,
        historia="Para «ahorrar tiempo», alguien volvió a hacer el Q4_K_M con «la opción rápida» de llama-quantize, lo dejó con el mismo nombre y actualizó el manifiesto para que cuadrara.",
        explica="cuantizados/Qwen3-0.6B-Q4_K_M.gguf ahora es un Q4_0: todos sus pesos grandes en Q4_0 (4.5 bits, una escala por bloque de 32), no en Q4_K y Q6_K. El nombre del archivo y el manifiesto dicen Q4_K_M; el encabezado del GGUF no miente. Pierde más calidad que el Q4_K_M de verdad (su perplejidad sube más). Se ve con python3 verificar.py cuantizar y python3 mundo/ficha.py cuantizados/Qwen3-0.6B-Q4_K_M.gguf --tipos. Arreglo: python3 pipeline/cuantizar.py --todas (o borrar ese archivo y python3 pipeline/cuantizar.py, que no encuentra el sha256 del manifiesto… salvo que alguien lo recalculó: por eso --todas), y después medir.py Q4_K_M, calidad.py Q4_K_M y reporte.py. Lo que es un archivo lo dice su encabezado, no su nombre."),
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
    print("  revisando que todo esté sano (≈ 15 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    print("  rompiendo (≈ 1 minuto: el benchmark vuelve a medir)…")
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
