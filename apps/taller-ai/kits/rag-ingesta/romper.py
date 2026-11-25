"""Mete una falla en el mundo, la configuración o el almacén. Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con el día 2 ya ingerido y barrido). Después de meter la falla,
corre tu ingestión como la correría el job programado (python pipeline/ingestar.py, o --barrido la de la noche).
La falla activa se guarda como un hash en .taller/: ni tú ni Claude la pueden leer ahí.
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
from mundo.comun import CONFIG, ESTADO, TALLER, escribir_json, estado, guardar, leer_json  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
ALMACEN = RAIZ / "almacen"


def editar_config(clave: str, valor: str, seccion: str | None = None) -> None:
    """Cambia una línea de config.yaml (la primera «clave:» después de «seccion:»), sin perder los comentarios."""
    lineas = CONFIG.read_text().splitlines(keepends=True)
    dentro = seccion is None
    for i, l in enumerate(lineas):
        if seccion and re.match(rf"^\s*{seccion}:\s*$", l):
            dentro = True
        elif dentro and re.match(rf"^\s*{clave}:", l):
            lineas[i] = re.sub(rf"^(\s*{clave}:\s*)(\S+)", lambda m: m.group(1) + valor, l)
            CONFIG.write_text("".join(lineas))
            return
    raise SystemExit(f"no encontré {clave} en config.yaml")


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(ESTADO, RESPALDO / "estado.json")
    shutil.copy(CONFIG, RESPALDO / "config.yaml")
    if ALMACEN.exists():
        shutil.copytree(ALMACEN, RESPALDO / "almacen")


def devolver(_e: dict | None = None) -> None:
    shutil.copy(RESPALDO / "estado.json", ESTADO)
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    shutil.rmtree(ALMACEN, ignore_errors=True)
    if (RESPALDO / "almacen").exists():
        shutil.copytree(RESPALDO / "almacen", ALMACEN)


def job(*args: str) -> None:
    """La corrida programada: tu ingestión, como la lanzaría el cron de la empresa."""
    print(f"  el job programado corre: python pipeline/ingestar.py {' '.join(args)}".rstrip())
    r = subprocess.run([sys.executable, "pipeline/ingestar.py", *args], cwd=RAIZ, capture_output=True, text=True, timeout=300)
    print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


def editar_pagina(e: dict, pid: str, viejo: str, nuevo: str, hora: str) -> None:
    p = e["wiki"]["paginas"][pid]
    assert viejo in p["cuerpo"], (pid, viejo)
    p |= {"cuerpo": p["cuerpo"].replace(viejo, nuevo, 1), "version": p["version"] + 1, "actualizado": f"2026-11-21T{hora}Z"}


# ---------------------------------------------------------------- las fallas
def token_vencido(e_r: dict) -> None:
    e = estado()
    e["tokens"]["wiki"] = "wiki-dojo-9e1d"        # TI rotó el token de la cuenta del conector
    editar_pagina(e, "1004", "<td>3 a 7</td>", "<td>2 a 5</td>", "15:20:00")
    guardar(e)
    job()


def sin_reintentos(e_r: dict) -> None:
    e = estado()
    e["limite_wiki"] = 3
    editar_pagina(e, "1003", "<p>Pasados", "<p>Desde diciembre, el caso se revisa en 2 días hábiles.</p>\n<p>Pasados", "15:21:00")
    editar_pagina(e, "1006", "<p>Un líder", "<p>Las compensaciones se registran en el ticket.</p>\n<p>Un líder", "15:22:00")
    editar_pagina(e, "2004", "<p>El último", "<p>En diciembre el conteo se adelanta al día 20.</p>\n<p>El último", "15:23:00")
    guardar(e)
    editar_config("reintentos", "0", "http")
    job()


def restriccion_silenciosa(e_r: dict) -> None:
    e = estado()
    e["wiki"]["paginas"]["3005"]["sin_conector"] = True   # «solo yo»: la cuenta del conector también la pierde
    guardar(e)
    job()


def link_como_dominio(e_r: dict) -> None:
    editar_config("link_compartido", "dominio", "drive")
    e = estado()
    f = e["drive"]["archivos"]["d04"]
    f |= {"version": f["version"] + 1, "modifiedTime": "2026-11-21T15:25:00Z"}   # la volvieron a subir, idéntica
    e["drive"]["cambios"].append({"fileId": "d04", "time": "2026-11-21T15:25:00Z"})
    guardar(e)
    job()


def texto_alterado(e_r: dict) -> None:
    c = leer_json(ALMACEN / "catalogo.json")
    p = ALMACEN / "texto" / f"{c['wiki:2002']['hash']}.json"
    t = leer_json(p)
    t["texto"] = t["texto"].replace("Comisión: 8 %", "Comisión: 6 %")
    escribir_json(p, t)


def unidad_perdida(e_r: dict) -> None:
    e = estado()
    e["acceso"]["drive_compartida"] = False
    guardar(e)
    job("--barrido")


FALLAS = {
    "token-vencido": dict(
        tipo="infra", titulo="La wiki dejó de cambiar", aplicar=token_vencido,
        historia="Una agente actualizó ayer los tiempos de reembolso con débito y el asistente sigue diciendo los de antes. El job de ingestión «corrió» a su hora; nadie vio nada raro.",
        explica="TI rotó el token de la cuenta del conector de la wiki (una rotación programada) y config.yaml sigue con el viejo: cada llamada da 401. Tu conector lanza FuenteSinAcceso, la corrida anota el error y sale con código 1, pero las otras fuentes siguen y el catálogo de la wiki se queda congelado. Se ve en la última corrida de almacen/corridas/ (error en wiki), en python verificar.py mundo (config.yaml no entra a wiki) y en catalogo (wiki:1004 con versión vieja). Arreglo: pedir el token nuevo (python mundo/fuentes.py token wiki hace de administrador), ponerlo en fuentes.wiki.token de config.yaml y correr python pipeline/ingestar.py. En C11 el token vive en un gestor de secretos y la alerta es de atraso por fuente: un conector sin acceso se ve igual que uno sin cambios."),
    "sin-reintentos": dict(
        tipo="config", titulo="La ingestión truena con «HTTP Error 429»", aplicar=sin_reintentos,
        historia="La wiki bajó su límite de llamadas para todas las apps. El mismo día, alguien dejó los reintentos en 0 «para que la ingestión no se quede esperando».",
        explica="config.yaml quedó con http.reintentos: 0 y la wiki ahora deja 3 llamadas por segundo. El primer 429 ya no se reintenta: pedir() deja salir el HTTPError, ingestar.py se cae a la mitad de la wiki y ni siquiera llega a las otras fuentes, así que tres páginas editadas no entran. Se ve con python verificar.py http (las 25 llamadas pierden una) y catalogo (versiones viejas), y con python mundo/fuentes.py log (las → 429). Arreglo: http.reintentos vuelve a 5 y python pipeline/ingestar.py: con Retry-After la corrida tarda más, pero termina. El límite es de la fuente: no se negocia bajando reintentos, se respeta."),
    "restriccion-silenciosa": dict(
        tipo="mundo", titulo="Legal dice que ya nadie debería ver «Retención de datos»", aplicar=restriccion_silenciosa,
        historia="Legal restringió la página «Retención de datos» a solo su autora mientras la reescriben. Pregunta por qué el asistente todavía la cita.",
        explica="La autora restringió la página a «solo yo», y con eso la cuenta del conector también perdió el acceso: la página ya no sale en la lista ni en la búsqueda por fecha y GET /paginas/3005 da 404. Ningún evento lo avisa, así que la corrida incremental no ve nada y wiki:3005 sigue viva en tu catálogo, con su ACL vieja. Se ve con python verificar.py catalogo (vivo en el catálogo, la fuente ya no lo deja leer). Arreglo: python pipeline/ingestar.py --barrido: lista todo lo visible, ve que wiki:3005 ya no está y la deja como lápida. Regla del caso (fail-closed): lo que el conector ya no puede leer se borra del índice."),
    "link-como-dominio": dict(
        tipo="config", titulo="«Sueldos 2026» aparece para cualquiera", aplicar=link_como_dominio,
        historia="Producto pidió que los documentos «compartidos con link» aparezcan en el asistente, porque mucha gente comparte así. Alguien cambió una línea de config.yaml sin pasar por Seguridad.",
        explica="config.yaml quedó con drive.link_compartido: dominio. El tabulador de sueldos (compartido con link, allowFileDiscovery: false) se volvió a subir y, al reingerirlo, su ACL ganó domain:marketplace.test: cualquier empleado lo encontraría preguntando «¿cuánto gana un líder?». Se ve con python verificar.py catalogo (drive:d04 con ACL distinta a la de la fuente). Arreglo: drive.link_compartido vuelve a ignorar y python pipeline/ingestar.py --barrido, que vuelve a pedir la ACL de todo lo que no cambió de versión (d04 y d09). Link compartido = no compartido: es una decisión de producto y de Seguridad, no un switch de config."),
    "texto-alterado": dict(
        tipo="infra", titulo="El asistente dice que la comisión de Electrónica es 6 %", aplicar=texto_alterado,
        historia="Alguien de datos vio «un error» en el texto guardado de las comisiones y lo corrigió directo en el almacén, para no esperar a la wiki.",
        explica="Editaron a mano almacen/texto/<hash>.json de wiki:2002 (8 % → 6 %) sin tocar la wiki. El nombre del archivo sigue siendo el hash del crudo, pero su sha256_texto ya no coincide con su texto. Se ve con python verificar.py almacen. Arreglo: python pipeline/ingestar.py --doc wiki:2002: tiene_texto() ve que el archivo ya no es íntegro, vuelve a parsear y lo reemplaza con el texto de la fuente. La corrección, si es real, se hace en la fuente: el almacén es un derivado."),
    "unidad-perdida": dict(
        tipo="infra", titulo="El barrido de la noche salió en rojo", aplicar=unidad_perdida,
        historia="TI reorganizó la unidad compartida de operaciones y movió a sus miembros. El barrido de la noche terminó con código 1.",
        explica="La cuenta del conector quedó fuera de la unidad compartida: de golpe, 11 de los 15 archivos del Drive «desaparecen». El barrido quería dejar 11 lápidas (73 %) y el freno (freno.max_borrado = 20 %) lo detuvo sin borrar nada. Se ve en la última corrida (frenado en drive) y con python verificar.py barrido y catalogo. No se arregla en el catálogo: se arregla el acceso. Arreglo: pedir a TI que regrese la cuenta (python mundo/fuentes.py unidad on) y volver a correr python pipeline/ingestar.py --barrido, que ya no se frena. Sin freno, el asistente habría perdido medio Drive por un permiso."),
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
    print("  rompiendo… (puede tardar unos segundos)")
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
