"""Mete una falla en la configuración, en el almacén o en los archivos de estado de indice/. Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con la mañana ya pasada: python mundo/avanzar.py). Después de
meter la falla, corre lo que correría la empresa: el reindexado de cada hora o, si la falla es del carril rápido,
otra mañana entera (python mundo/avanzar.py). La falla activa se guarda como un hash en .taller/: ni tú ni Claude la
pueden leer ahí.
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
from mundo.comun import ALMACEN, CONFIG, INDICE, TALLER, escribir_json, leer_json  # noqa: E402

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
    for d in (ALMACEN, INDICE):
        shutil.copytree(d, RESPALDO / d.name)


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    for d in (ALMACEN, INDICE):
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(RESPALDO / d.name, d)


def job(*a: str) -> None:
    """Lo que corre la empresa por su cuenta: el reindexado de cada hora, o una mañana entera con el carril rápido."""
    print(f"  la empresa corre: python {' '.join(a)}")
    r = subprocess.run([sys.executable, *a], cwd=RAIZ, capture_output=True, text=True, timeout=300)
    print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


# ---------------------------------------------------------------- las fallas
def filtro_despues(_e: dict) -> None:
    editar_config("filtro", "despues")


def acl_vieja(_e: dict) -> None:
    editar_config("cada_segundos", "3600")
    job("mundo/avanzar.py")


def anidado(_e: dict) -> None:
    editar_config("profundidad", "1")
    job("pipeline/indexar.py")


def sin_acl_publico(_e: dict) -> None:
    editar_config("sin_acl", "publico")
    for nombre in ("drive__d04.json", "wiki__1006.json"):      # «Sueldos 2026» y «Clientes VIP y compensaciones»
        p = ALMACEN / "docs" / nombre
        x = leer_json(p)
        x.pop("acl", None)
        for c in x["chunks"]:
            c.pop("acl", None)
        escribir_json(p, x)
    job("pipeline/indexar.py")


def bitacora_borrada(_e: dict) -> None:
    (INDICE / "acl_vigente.json").unlink(missing_ok=True)
    job("pipeline/indexar.py")


def suscripcion_vencida(_e: dict) -> None:
    s = leer_json(ALMACEN / "suscripciones.json")
    s["directorio"] = {"activa": False, "vence": "2026-11-21T14:00:00Z"}
    escribir_json(ALMACEN / "suscripciones.json", s)
    job("mundo/avanzar.py")


FALLAS = {
    "filtro-despues": dict(
        tipo="config", titulo="Ana pregunta por cuentas duplicadas y el asistente dice que no hay nada", aplicar=filtro_despues,
        historia="Para que la búsqueda «no revise permisos de chunks que nunca van a salir», alguien movió el filtro de permisos a después de elegir los 8 mejores. Nadie ve nada raro: nadie recibe un chunk ajeno.",
        explica="config.yaml quedó con busqueda.filtro: despues (post-filter). El top-8 se elige entre los 154 chunks y después se tira lo que la persona no puede ver. Si los 8 mejores son de otros (para «cuenta de vendedor duplicada», los 10 tickets de fraude), a la persona le llegan 0 aunque haya chunks suyos que contestan: el asistente dice «no encontré información». No es una fuga, es un retrieval vacío, y pega más a quien ve menos. Se ve con python verificar.py filtro (buscar() devuelve menos de los que había). Arreglo: busqueda.filtro vuelve a antes. En un índice vectorial de verdad, el filtro va dentro de la búsqueda (pre-filter), no después del top-k."),
    "acl-vieja": dict(
        tipo="config", titulo="A Hugo le quitaron las tarifas a las 9:07 y a las 9:50 todavía las consultaba", aplicar=acl_vieja,
        historia="Para ahorrar llamadas, alguien puso el carril rápido a correr cada hora: «total, el reindexado ya corre cada hora». La mañana pasó sin errores.",
        explica="config.yaml quedó con revocacion.cada_segundos: 3600. El carril rápido solo corre a las 10:00, junto con el reindexado: la revocación de las 9:07 tardó 52 min 40 s en aplicarse y la de las 9:52, 8 min. Mientras tanto, quien ya no debía seguía recibiendo esos chunks. Se ve con python verificar.py revocacion y en la salida de mundo/avanzar.py. Arreglo: revocacion.cada_segundos vuelve a 60 y python mundo/avanzar.py otra vez. El periodo del carril sale del SLO: entrega del aviso (20 s) + periodo ≤ 5 min."),
    "anidado": dict(
        tipo="config", titulo="Soporte dice que el asistente ya no sabe nada de devoluciones", aplicar=anidado,
        historia="Un ciclo en el directorio (el comité dentro del boletín y el boletín dentro del comité) colgó otro sistema de la empresa. Para que no pasara aquí, alguien bajó la profundidad de los grupos a 1.",
        explica="config.yaml quedó con directorio.profundidad: 1: solo se resuelven los grupos directos de cada persona. Ana está en soporte-nivel1, y soporte-nivel1 está dentro de soporte; con profundidad 1, Ana ya no es «soporte» y pierde casi todo lo que comparte ese grupo. No es una fuga (nadie ve de más), pero el asistente deja de servir. Se ve con python verificar.py acceso (a cada agente le faltan decenas de chunks). Arreglo: directorio.profundidad vuelve a 10. Un ciclo se resuelve llevando la cuenta de los grupos ya vistos, no cortando la profundidad."),
    "sin-acl-publico": dict(
        tipo="infra", titulo="Cualquiera puede preguntarle al asistente cuánto gana un líder de soporte", aplicar=sin_acl_publico,
        historia="Un script de migración del chunking reescribió dos archivos sin el campo acl. Ese mismo día, alguien cambió permisos.sin_acl a publico «para que los documentos nuevos no se queden fuera mientras llega su ACL».",
        explica="almacen/docs/drive__d04.json («Sueldos 2026») y wiki__1006.json («Clientes VIP y compensaciones») llegaron sin ACL y config.yaml quedó con permisos.sin_acl: publico. El índice los metió con [[\"domain:marketplace.test\"]]: todo el dominio ve los sueldos. Se ve con python verificar.py fuga (diego.luna ve drive:d04) e indice (dos documentos sin ACL entraron con una ACL inventada). Son dos arreglos: permisos.sin_acl vuelve a rechazar (fail-closed: vacío no es público) y la ACL se repara de donde viene, el chunking (python mundo/crear.py --rechunkear hace de él), y python pipeline/indexar.py."),
    "bitacora-borrada": dict(
        tipo="infra", titulo="A las 10:30, Ana vuelve a ver un ticket que a las 9:31 pasó a «Solo líderes»", aplicar=bitacora_borrada,
        historia="En una limpieza de disco, alguien borró indice/acl_vigente.json: «son logs viejos del carril rápido». Una hora después corrió el reindexado de siempre, sin errores.",
        explica="Sin indice/acl_vigente.json, el reindexado no sabe lo que aplicó el carril rápido y reconstruye con las ACL que trae almacen/docs/, las que leyó la ingestión a las 9:05: las tarifas vuelven a ser de todo operaciones, el ticket SOP-14 de todo soporte y las comisiones también. El carril no las vuelve a aplicar solo, porque su cursor dice que ya las aplicó. Se ve con python verificar.py fuga (el índice coincide con almacen/docs/, por eso indice pasa). Arreglo: reconstruir desde cero y volver a aplicar la cola desde el principio: python pipeline/indexar.py --desde-cero (borra también el cursor) y python pipeline/revocar.py. acl_vigente.json no es un log: es lo que impide que el reindexado deshaga una revocación."),
    "suscripcion-vencida": dict(
        tipo="infra", titulo="Luis terminó su contrato a las 9:52 y a las 9:59 seguía consultando los manuales de soporte", aplicar=suscripcion_vencida,
        historia="La suscripción del carril rápido a los avisos del directorio venció anoche y nadie la renovó. La mañana pasó sin errores: el carril corrió cada minuto, como siempre.",
        explica="En almacen/suscripciones.json, la del directorio quedó vencida: los avisos de cambios de grupo (Tomás sale de fraude, Diego entra a soporte, Luis sale de soporte) nunca llegaron a la cola. Solo el reindexado de las 10:00, que lee el directorio entero, los puso al día: Tomás pudo ver los tickets de fraude 41 minutos de más y Luis los manuales 8. Se ve con python verificar.py revocacion y al final de mundo/avanzar.py (avisos que llegaron: directorio 0). Arreglo: renovar la suscripción (python mundo/crear.py --suscribir hace de renovarla en la consola del directorio) y pasar la mañana otra vez. Una alarma útil: «ninguna fuente puede pasar una hora sin mandar avisos»."),
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
