"""Mete una falla en la configuración, en el almacén o en lo publicado en golden/. Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con la re-ingesta del 22 ya reanclada: paso 7). Después de meter la
falla, corre lo que correría la empresa: el armado del golden de cada noche, o la re-ingesta. La falla activa se guarda
como un hash en .taller/: ni tú ni Claude la pueden leer ahí.
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
from mundo.comun import ALMACEN, CONFIG, ENTRADA, GOLDEN, TALLER, escribir_json, leer_json, leer_jsonl, vigente  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def editar_config(clave: str, valor: str) -> None:
    """Cambia una línea de config.yaml («clave: valor»), sin perder los comentarios."""
    s = CONFIG.read_text()
    s2 = re.sub(rf'(?m)^(\s*{clave}:\s*)("[^"]*"|\S+)', lambda m: m.group(1) + valor, s, count=1)
    if s2 == s:
        raise SystemExit(f"no encontré {clave} en config.yaml")
    CONFIG.write_text(s2)


def copiar_arbol(a: Path, b: Path) -> None:
    shutil.rmtree(b, ignore_errors=True)
    shutil.copytree(a, b)
    for f in b.rglob("*"):          # el registro guarda sus archivos de solo lectura: la copia se puede volver a borrar
        if f.is_file():
            f.chmod(0o644)


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(CONFIG, RESPALDO / "config.yaml")
    for d in (ALMACEN, GOLDEN):
        copiar_arbol(d, RESPALDO / d.name)


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    for d in (ALMACEN, GOLDEN):
        for f in d.rglob("*"):
            if f.is_file():
                f.chmod(0o644)
        copiar_arbol(RESPALDO / d.name, d)
    for f in (ALMACEN / "registro").rglob("*"):
        if f.is_file():
            f.chmod(0o444)


def job(*a: str) -> None:
    """Lo que corre la empresa por su cuenta: el armado del golden de cada noche o la re-ingesta."""
    print(f"  la empresa corre: python {' '.join(a)}")
    r = subprocess.run([sys.executable, *a], cwd=RAIZ, capture_output=True, text=True, timeout=300)
    print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


def anexar(p: Path, filas: list[dict]) -> None:
    with p.open("a") as f:
        for x in filas:
            f.write(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n")


# ---------------------------------------------------------------- las fallas
def fuente_perdida(_e: dict) -> None:
    job("mundo/avanzar.py", "--dia", "23")


def casi_duplicadas(_e: dict) -> None:
    shutil.copy(ENTRADA / "lote-2026-11-24.jsonl", ALMACEN / "candidatos" / "lote-2026-11-24.jsonl")
    editar_config("umbral", "0.95")
    job("pipeline/armar.py")


def sin_sin_respuesta(_e: dict) -> None:
    p = ALMACEN / "candidatos" / "expertos.jsonl"
    xs = [x for x in leer_jsonl(p) if x.get("tipo") != "sin_respuesta"]
    p.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in xs))
    editar_config("sin_respuesta", "0.0")
    job("pipeline/armar.py")


def directorio_viejo(_e: dict) -> None:
    shutil.copy(ENTRADA / "directorio-0900.json", ALMACEN / "directorio.json")
    job("pipeline/armar.py")


def version_pisada(_e: dict) -> None:
    v = vigente()
    p = GOLDEN / v / "preguntas.jsonl"
    xs = leer_jsonl(p)
    for x in xs:
        if x["id"] == "G-001":
            x["respuesta"] = "De 9:00 a 19:00, de lunes a viernes."
    p.chmod(0o644)
    p.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in xs))
    m = leer_json(GOLDEN / v / "manifiesto.json")
    m["sha256"] = hashlib.sha256(p.read_bytes()).hexdigest()
    escribir_json(GOLDEN / v / "manifiesto.json", m)


def contaminado(_e: dict) -> None:
    v = vigente()
    test = {x["id"]: x for x in leer_jsonl(GOLDEN / v / "preguntas.jsonl") if x["split"] == "test"}
    anexar(ALMACEN / "afinado" / "ejemplos.jsonl", [
        {"id": f"A-{8 + n:02d}", "pregunta": test[i]["pregunta"], "respuesta": test[i]["respuesta"], "autor": "equipo-prompt"}
        for n, i in enumerate(i for i in ("G-012", "G-026", "G-047") if i in test)])


FALLAS = {
    "fuente-perdida": dict(
        tipo="infra", titulo="El lunes el recall del gate bajó 20 puntos y nadie tocó el buscador", aplicar=fuente_perdida,
        historia="El equipo de ingestión subió el tamaño de los chunks a 800 tokens y re-ingestó todo el corpus anoche. Su pipeline salió en verde.",
        explica="mundo/avanzar.py --dia 23 dejó corpus-2026-11-23: los chunks se juntaron de dos en dos y casi todos los documentos largos cambiaron de numeración. El golden vigente sigue anclado a corpus-2026-11-22: muchas fuentes apuntan a un chunk_id que ya no existe, y otras a un id que existe pero con otro texto (el gate contaría como fallo un chunk que sí trae la respuesta). Se ve con python verificar.py fuentes y reanclaje, y al final de mundo/avanzar.py. Arreglo: python pipeline/reanclar.py: agrega el paso 22 → 23 a golden/anclas.json (por sha y por contenido) y publica la versión siguiente. Un id que existe no prueba que sea la misma fuente: por eso cada fuente guarda su sha."),
    "casi-duplicadas": dict(
        tipo="config", titulo="Soporte mandó cuatro preguntas nuevas y el examen ahora cuenta dos veces las mismas", aplicar=casi_duplicadas,
        historia="Soporte mandó un lote nuevo de preguntas. Como armar.py «rechazaba preguntas que no eran iguales», alguien subió parecidas.umbral a 0.95.",
        explica="config.yaml quedó con parecidas.umbral: 0.95 y el lote de almacen/candidatos/lote-2026-11-24.jsonl trae cuatro preguntas que ya estaban dichas con otras palabras («¿Qué horario tiene soporte por teléfono?» contra G-001, con Jaccard 0.6 a 0.8). Con 0.95 solo se atrapan las idénticas: entraron las cuatro, y cada tema repetido pesa doble en el recall. Se ve con python verificar.py parecidas. Arreglo: parecidas.umbral vuelve a 0.6 y python pipeline/armar.py publica una versión sin ellas (las ya publicadas ganan). El umbral sale de mirar pares reales: en este corpus, las preguntas distintas más parecidas llegan a 0.57."),
    "sin-sin-respuesta": dict(
        tipo="config", titulo="El asistente inventa una comisión para «Deportes» y el gate lo dejó pasar", aplicar=sin_sin_respuesta,
        historia="En una limpieza, alguien quitó del lote de los expertos «las preguntas que no tenían fuentes» y bajó cuotas.sin_respuesta a 0 para que armar.py no se quejara. La versión nueva salió sin errores.",
        explica="almacen/candidatos/expertos.jsonl quedó sin las 9 preguntas sin_respuesta y config.yaml con cuotas.sin_respuesta: 0.0. La versión nueva no tiene ninguna: un sistema que contesta todo, aunque invente, saca lo mismo que uno que dice «no está en los documentos». Se ve con python verificar.py cobertura (el gate de C11 pide al menos 10 %). Arreglo: las candidatas vuelven a ser las de los expertos (python mundo/crear.py --candidatos hace de bajarlas otra vez de su repositorio), cuotas.sin_respuesta vuelve a 0.10 y python pipeline/armar.py publica la versión siguiente."),
    "directorio-viejo": dict(
        tipo="infra", titulo="El gate dice que Tomás tiene que recibir un ticket de fraude", aplicar=directorio_viejo,
        historia="La sincronización del directorio falló anoche a media copia y alguien puso a mano «la última que funcionaba», la de las 9:00 del 21. El armado de la noche corrió sin errores.",
        explica="almacen/directorio.json quedó con la foto de las 9:00, antes de la mañana de la estación 3: Tomás todavía está en fraude, Luis en soporte y Diego sin equipo. armar.py validó los permisos con esa foto: entró G-039 (una directa que espera que Tomás reciba el ticket SEG-5, que ya no puede ver: el gate premiaría una fuga), salieron G-071 y G-072 (prohibidas que con la foto vieja «sí ve») y salieron las de Diego. Se ve con python verificar.py permisos. Arreglo: python mundo/crear.py --directorio (hace de sincronizar otra vez con el directorio de la empresa) y python pipeline/armar.py. El manifiesto guarda la foto del directorio con la que se armó cada versión."),
    "version-pisada": dict(
        tipo="infra", titulo="Dos corridas del gate con la misma versión del golden dan números distintos", aplicar=version_pisada,
        historia="Alguien encontró una errata en una respuesta de la versión vigente y la corrigió ahí mismo, en golden/, con todo y el sha256 del manifiesto «para que cuadre».",
        explica="golden/<vigente>/preguntas.jsonl ya no es la que se publicó: G-001 dice «de 9:00 a 19:00» y el manifiesto local se recalculó a mano. Cualquiera que comparara la copia local con su propio manifiesto la daría por buena; la del registro (almacen/registro/, escrita una sola vez) dice otra cosa. Dos personas que «usaron la misma versión» midieron con exámenes distintos. Se ve con python verificar.py publicar o python pipeline/publicar.py --comprobar. Arreglo: python mundo/registro.py bajar <vigente> vuelve a poner la copia del registro. Si de verdad hay una errata, va en las candidatas y sale en la versión siguiente."),
    "contaminado": dict(
        tipo="infra", titulo="El equipo del prompt presume que su versión nueva contesta perfecto el golden", aplicar=contaminado,
        historia="El equipo del prompt quería ejemplos «de los buenos» para el few-shot y copió tres preguntas del golden, con su respuesta, a sus ejemplos de afinado.",
        explica="almacen/afinado/ejemplos.jsonl trae tres preguntas de test de la versión vigente (G-012, G-026 y G-047) con su respuesta. El prompt ya «se sabe» esas respuestas: el examen dejó de medir si el sistema encuentra y contesta, y mide si se acuerda. Se ve con python verificar.py contaminacion. Arreglo: python pipeline/armar.py quema esas tres (salen del golden y no vuelven nunca, ni a dev) y publica la versión siguiente; y al equipo del prompt se le dice que sus ejemplos salen de dev o de fuera del golden."),
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
