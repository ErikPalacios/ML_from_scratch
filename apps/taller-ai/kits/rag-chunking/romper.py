"""Mete una falla en la configuración o en el almacén. Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con el día 2 ya chunkeado). Después de meter la falla, el job
programado corre tu chunking como lo correría el cron de la empresa (python pipeline/chunkear.py).
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
from mundo.comun import ALMACEN, CHUNKS, CONFIG, TALLER, escribir_json, leer_json  # noqa: E402

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
    for d in (ALMACEN, CHUNKS):
        shutil.copytree(d, RESPALDO / d.name)


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    for d in (ALMACEN, CHUNKS):
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(RESPALDO / d.name, d)


def job(veces: int = 1) -> None:
    """La corrida programada: tu chunking, como lo lanzaría el cron de la empresa después de cada ingestión."""
    for _ in range(veces):
        print("  el job programado corre: python pipeline/chunkear.py")
        r = subprocess.run([sys.executable, "pipeline/chunkear.py"], cwd=RAIZ, capture_output=True, text=True, timeout=300)
        print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


# ---------------------------------------------------------------- las fallas
def gigantes(_e: dict) -> None:
    editar_config("objetivo", "1500")
    job()


def tabla_cortada(_e: dict) -> None:
    editar_config("estrategia", "fija")
    job()


def acl_perdida(_e: dict) -> None:
    c = leer_json(ALMACEN / "catalogo.json")
    for d in ("drive:d14", "drive:d20", "drive:d21"):      # los markdown del Drive
        c[d]["acl"] = []
    escribir_json(ALMACEN / "catalogo.json", c)
    job()


def prefijo_perdido(_e: dict) -> None:
    editar_config("prefijo", '""')
    job()


def texto_truncado(_e: dict) -> None:
    from mundo.comun import sha256

    c = leer_json(ALMACEN / "catalogo.json")
    p = ALMACEN / "texto" / f"{c['drive:d20']['hash']}.json"
    t = leer_json(p)
    corte = t["texto"].index("## Devoluciones")          # el parser nuevo se quedó a la mitad del manual
    t |= {"texto": t["texto"][:corte].rstrip(), "parser": "v2"}
    t["sha256_texto"] = sha256(t["texto"].encode())
    escribir_json(p, t)
    job()


def hash_ignorado(_e: dict) -> None:
    editar_config("incremental", "false")
    job(2)


FALLAS = {
    "chunks-gigantes": dict(
        tipo="config", titulo="El asistente ya no encuentra las preguntas frecuentes del manual", aplicar=gigantes,
        historia="Alguien leyó que «más contexto por chunk da mejores respuestas» y subió el tamaño en un PR chiquito. Los chunks se ven bien en el log; las preguntas sobre el final del manual dejaron de encontrar nada.",
        explica="config.yaml quedó con chunking.objetivo: 1500. Ahora un chunk del manual tiene más de 512 tokens y multilingual-e5-small lee solo los primeros 512: lo que viene después (las preguntas frecuentes, las sanciones) se queda fuera del embedding y ninguna búsqueda lo encuentra. Además, un chunk grande mezcla temas y su vector es un promedio de todos. Se ve con python verificar.py tamano (chunks de más de 512) y traslape (las preguntas frecuentes ya caben enteras y no hay corte). Arreglo: chunking.objetivo vuelve a 400 y python pipeline/chunkear.py: la huella cambia y se vuelve a partir todo, que es justo lo correcto. El tamaño del chunk lo pone el modelo de embeddings y el golden set, no la intuición."),
    "tabla-cortada": dict(
        tipo="config", titulo="«¿Cuánto cuesta mandar 3 kg a Sonora?» contesta con la tarifa de otro estado", aplicar=tabla_cortada,
        historia="Para simplificar, alguien cambió el chunking a «ventanas fijas de 1,200 caracteres, como en el tutorial». Todos los chunks miden casi lo mismo y el cambio parecía inofensivo.",
        explica="config.yaml quedó con chunking.estrategia: fija. Las ventanas de caracteres no miran la estructura: cortan la tabla de tarifas a media fila, los pedazos de tabla pierden su encabezado (ya no se sabe qué columna es «De 1 a 5 kg») y ningún chunk lleva su ruta de títulos. Se ve con python verificar.py ruta y tablas (y tamano: una tabla de números y barras gasta más tokens por carácter que la prosa, y una ventana de 1,200 caracteres de tabla pasa de 500 tokens). Arreglo: chunking.estrategia vuelve a estructura y python pipeline/chunkear.py. Una tabla partida sin encabezado es un montón de números sueltos: el LLM los va a leer igual, y mal."),
    "acl-perdida": dict(
        tipo="infra", titulo="Tres documentos del Drive desaparecieron del asistente", aplicar=acl_perdida,
        historia="La ingestión estrenó un cambio en el conector del Drive para los archivos markdown. Desde entonces, operaciones dice que el asistente ya no conoce el manual del vendedor ni las tarifas.",
        explica="El catálogo de la estación 1 trae la ACL vacía (acl: []) para drive:d14, drive:d20 y drive:d21: el conector nuevo dejó de leer sus permisos. Tu chunking hace lo correcto: sin ACL no se sabe quién puede leer, así que no los chunkea y borra sus chunks (fail-closed); la corrida los lista en sin_acl. Si los hubiera chunkeado con acl: [], en el índice serían de todos. Se ve con python verificar.py acl y en la última corrida de chunks/corridas/. No se arregla en chunks/ ni editando el catálogo: se arregla la ingestión. Arreglo: volver a correr la ingestión de la estación 1 ya corregida (python mundo/crear.py --reingestar hace de ella) y python pipeline/chunkear.py."),
    "hash-ignorado": dict(
        tipo="config", titulo="El job de chunking tarda lo mismo aunque nada cambie", aplicar=hash_ignorado,
        historia="Alguien apagó el incremental para depurar un documento y el cambio se fue a producción. Nada se ve roto: los chunks salen iguales que antes.",
        explica="config.yaml quedó con incremental: false. Cada corrida vuelve a partir todos los documentos aunque su sha256_texto y la huella sean los mismos: los chunks salen idénticos, pero en C11 cada chunk partido de nuevo es un embedding que se vuelve a pagar (≈ 1.5 M de documentos cada hora en vez de los pocos que cambiaron). Se ve con python verificar.py incremental (la última corrida partió todo y nada había cambiado) y en chunks/corridas/ (rechunkeados lleno, sin_cambios en 0). Arreglo: incremental vuelve a true y python pipeline/chunkear.py. Para depurar un documento está --doc, que no apaga nada."),
    "prefijo-perdido": dict(
        tipo="config", titulo="Las búsquedas empeoraron sin que nadie tocara el chunker", aplicar=prefijo_perdido,
        historia="En una limpieza de config.yaml alguien quitó el «passage: » porque «ensucia el texto de los chunks». El job volvió a partir todo y terminó bien.",
        explica="config.yaml quedó con modelo.prefijo: \"\". e5 se entrenó con «passage: » delante de cada pasaje y «query: » delante de cada pregunta; sin el prefijo, sus vectores ya no quedan donde el modelo espera y la búsqueda empeora (su ficha en Hugging Face lo advierte). Además, cada chunk cuenta 3 tokens menos de los que verá el modelo cuando se le ponga el prefijo. Como el modelo entra en la huella, el job volvió a partir todo. Se ve con python verificar.py tokens (contar() ya no da lo que ve el modelo) y tamano («tokens» no es lo que cuenta el modelo). Arreglo: modelo.prefijo vuelve a \"passage: \" y python pipeline/chunkear.py. El prefijo no es parte del texto del chunk: es cómo se le presenta al modelo."),
    "texto-truncado": dict(
        tipo="infra", titulo="El asistente dice que el manual no habla de pagos", aplicar=texto_truncado,
        historia="La ingestión estrenó un parser nuevo (v2) y volvió a parsear el «Manual del vendedor». Desde ayer, «¿cuándo me pagan?» no encuentra nada en el manual.",
        explica="El parser v2 de la estación 1 se quedó a la mitad del manual: el texto nuevo termina en «Envíos» y su sha256_texto es otro, así que tu chunking hizo lo correcto (vio texto nuevo y volvió a partir). El problema viene de antes: perdimos devoluciones, pagos, preguntas frecuentes y sanciones. Se ve con python verificar.py docs (se perdió texto al partir, comparado con la verdad del mundo) y en la última corrida (rechunkeados: drive:d20). No se arregla en chunks/: se arregla la ingestión. Arreglo: la ingestión vuelve a parsear con el parser bueno (python mundo/crear.py --reingestar hace de ella) y python pipeline/chunkear.py. Una alarma útil en C11: un documento cuyo texto se encoge a la mitad de un día para otro."),
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
