"""Mete una falla en la configuración o en lo que está detrás del alias (indices/). Nunca toca tu código (pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (con c11 ya en tu índice: paso 7). Si la API (mundo/servicio.py)
está corriendo, la falla también se ve ahí. La falla activa se guarda como un hash en .taller/: ni tú ni Claude la
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
import numpy as np  # noqa: E402

from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALIAS, CONFIG, INDICES, PILOTO, TALLER, alias, escribir_json, leer_json, sha256_archivo, vigente  # noqa: E402

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
    shutil.copytree(INDICES, RESPALDO / "indices")


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    shutil.rmtree(INDICES, ignore_errors=True)
    shutil.copytree(RESPALDO / "indices", INDICES)


def job(*a: str) -> None:
    """Lo que corre la empresa por su cuenta: el job de la noche."""
    print(f"  la empresa corre: python {' '.join(a)}")
    r = subprocess.run([sys.executable, *a], cwd=RAIZ, capture_output=True, text=True, timeout=300)
    print("  " + ("terminó bien" if r.returncode == 0 else f"salió con código {r.returncode}"))


def resellar(nombre: str) -> None:
    """Lo que hace quien «arregla» un índice a mano: recalcula el sha256 de cada archivo en el manifiesto."""
    m = leer_json(INDICES / nombre / "manifiesto.json")
    m["archivos"] = {a: sha256_archivo(INDICES / nombre / a) for a in m["archivos"]}
    escribir_json(INDICES / nombre / "manifiesto.json", m)


def cuarenta(ids: list[str]) -> list[int]:
    """Las filas de los documentos de la wiki (las que «no cambiaron» desde el piloto): 40, siempre las mismas."""
    return [i for i, k in enumerate(ids) if k.startswith("wiki:")][:40]


# ---------------------------------------------------------------- las fallas
def modelos_mezclados(_e: dict) -> None:
    v = vigente()
    d = INDICES / v
    m = np.load(d / "vectores.npy")
    vj = leer_json(d / "vectores.json")
    piloto = np.load(INDICES / PILOTO / "vectores.npy")
    for i in cuarenta(vj["ids"]):
        m[i] = piloto[i]
        vj["filas"][i]["modelo"] = ref.etiqueta("minilm")
    np.save(d / "vectores.npy", m)
    escribir_json(d / "vectores.json", vj)
    resellar(v)


def sin_normalizar(_e: dict) -> None:
    v = vigente()
    d = INDICES / v
    vj = leer_json(d / "vectores.json")
    c = ref.corpus()["chunks"]
    np.save(d / "vectores.npy", ref.embeber("e5", [c[k]["texto"] for k in vj["ids"]], "pasaje", normalizar=False))
    resellar(v)


def chunks_faltantes(_e: dict) -> None:
    v = vigente()
    d = INDICES / v
    m = np.load(d / "vectores.npy")
    vj = leer_json(d / "vectores.json")
    fuera = [i for i, k in enumerate(vj["ids"]) if k.startswith("drive:d20#") or k.startswith("wiki:1002#")]
    queda = [i for i in range(len(vj["ids"])) if i not in fuera]
    np.save(d / "vectores.npy", m[queda])
    escribir_json(d / "vectores.json", {"ids": [vj["ids"][i] for i in queda], "filas": [vj["filas"][i] for i in queda]})
    resellar(v)


def dimension_equivocada(_e: dict) -> None:
    editar_config("dimension", "768")
    job("mundo/noche.py")


def consulta_otro_modelo(_e: dict) -> None:
    editar_config("modelo_consulta", "minilm")


def alias_a_medio(_e: dict) -> None:
    v = vigente()
    nuevo = (v if not re.search(r"-\d{4}-\d{2}-\d{2}-\d+$", v) else v.rsplit("-", 1)[0]) + "-2"
    while (INDICES / nuevo).exists():
        nuevo = nuevo.rsplit("-", 1)[0] + f"-{int(nuevo.rsplit('-', 1)[1]) + 1}"
    shutil.copytree(INDICES / v, INDICES / nuevo)
    (INDICES / nuevo / "vectores.npy").unlink()
    (INDICES / nuevo / "prueba.json").unlink(missing_ok=True)
    m = leer_json(INDICES / nuevo / "manifiesto.json")
    m = {k: m[k] for k in ("nombre", "creado", "corpus", "modelo", "dimension", "similitud")} | {"nombre": nuevo, "estado": "construyendo"}
    escribir_json(INDICES / nuevo / "manifiesto.json", m)
    a = alias()
    a["c11"] = {"actual": nuevo, "anterior": v, "historial": a["c11"]["historial"] + [
        {"fecha": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "de": v, "a": nuevo}]}
    escribir_json(ALIAS, a)


VOLVER = ("Primero se mitiga: <code>python pipeline/alias.py volver c11</code> regresa el servicio al índice anterior en segundos "
          "(el del piloto: peor recall, pero correcto). Después se arregla hacia adelante: <code>python mundo/noche.py</code> construye uno "
          "nuevo al lado, desde el cache (los embeddings buenos siguen ahí), lo revisa y mueve el alias.")
FALLAS = {
    "modelos-mezclados": dict(
        tipo="infra", titulo="El monitor dice que los vectores bajaron 40 puntos y la API no levanta", aplicar=modelos_mezclados,
        historia="Para no esperar a que se re-embebiera todo, alguien copió al índice vigente los vectores de 40 chunks de la wiki «que no cambiaron» desde el índice del piloto, y recalculó el manifiesto para que cuadrara.",
        explica="Las filas de 40 chunks de la wiki en el índice vigente ahora son vectores de all-MiniLM-L6-v2 (y vectores.json lo dice: modelo minilm@1110a243fdf4) en un índice de e5. Los dos modelos tienen 384 dimensiones, así que nada truena; pero sus espacios no se comparan: la pregunta embebida con e5 contra un vector de MiniLM da un número sin sentido, y esos chunks casi nunca llegan al top-8: el monitor (python mundo/evaluar.py) da 58.1 % en vez de 98.6 %. Tu revisar() lo ve y la API se niega a abrirlo (503). Se ve con python verificar.py construir y python pipeline/construir.py --revisar <vigente>. Arreglo: python pipeline/alias.py volver c11 y python mundo/noche.py. Un índice tiene un solo modelo: cambiar de modelo es re-embeber todo, en un índice nuevo."),
    "sin-normalizar": dict(
        tipo="infra", titulo="Después de migrar a la base vectorial nueva, la API no levanta", aplicar=sin_normalizar,
        historia="El equipo de plataforma migró el índice vigente a «la base vectorial nueva» con su script de exportación, y lo volvió a poner en su lugar con el manifiesto recalculado.",
        explica="El script exportó los vectores antes de normalizarlos: ahora tienen largo de ≈ 4.5 a 5.0 en vez de 1. La búsqueda calcula el coseno como producto punto (que solo es el coseno con vectores de largo 1), así que un vector más largo gana puntos por su largo, no por parecerse: el monitor (python mundo/evaluar.py) da 91.9 % en vez de 98.6 %, y tu revisar() lo ve (la API contesta 503). Se ve con python verificar.py vectores y python pipeline/construir.py --revisar <vigente>. Arreglo: python pipeline/alias.py volver c11 y python mundo/noche.py (desde el cache, normalizados). Si la similitud es coseno, se normaliza al escribir y al consultar, y se revisa."),
    "chunks-faltantes": dict(
        tipo="infra", titulo="Los vectores ya no encuentran la política de devoluciones; BM25 sí", aplicar=chunks_faltantes,
        historia="El job de embeddings de anoche se cortó por tiempo a la mitad de un lote y el paso siguiente publicó el índice igual, con el manifiesto al día.",
        explica="Al índice de vectores vigente le faltan 15 chunks (los de wiki:1002, la política de devoluciones, y los de drive:d20) que sí están en BM25 y en chunks.jsonl. BM25 los sigue encontrando; los vectores, nunca: para el buscador de vectores esos documentos no existen. El monitor (python mundo/evaluar.py) da 83.8 % en vez de 98.6 % en los vectores y BM25 igual. Se ve con python verificar.py completo y python pipeline/construir.py --revisar <vigente>. Arreglo: python pipeline/alias.py volver c11 y python mundo/noche.py. Los dos índices tienen que traer exactamente los mismos chunks, y se revisa antes de mover el alias."),
    "dimension-equivocada": dict(
        tipo="config", titulo="El índice de anoche no se construyó", aplicar=dimension_equivocada,
        historia="Para ir preparando el cambio a un modelo más grande, alguien copió a config.yaml la dimensión del ejemplo de multilingual-e5-base. El job de la noche corrió después.",
        explica="config.yaml quedó con indice.dimension: 768 y e5-small da vectores de 384. construir.py se detuvo antes de escribir nada y mundo/noche.py dejó el alias donde estaba: el servicio sigue bien, pero esta noche no hubo índice nuevo, y mañana tampoco. Se ve con python verificar.py construir y con la salida de python mundo/noche.py. Arreglo: indice.dimension vuelve a 384 (la del modelo de embeddings.modelo) y python mundo/noche.py. La dimensión la dicta el modelo; si se cambia de modelo, se cambian los dos y se re-embebe todo en un índice nuevo."),
    "consulta-otro-modelo": dict(
        tipo="config", titulo="La API de búsqueda contesta 503 a todo", aplicar=consulta_otro_modelo,
        historia="Después de una prueba con el índice del piloto, alguien dejó fijo en la configuración de la API el modelo con el que se embeben las preguntas.",
        explica="config.yaml quedó con servicio.modelo_consulta: minilm y el índice detrás de c11 es de e5. Si la API embebiera así, cada pregunta caería en otro espacio (en el dojo, el recall@8 de los vectores baja de 98.6 % a 21.6 %: python pipeline/prueba.py --consulta minilm). Tu Buscador se niega (ModeloDistinto) y la API contesta 503: un error visible, mejor que basura. Se ve con python verificar.py consulta y curl http://localhost:8150/salud. Arreglo: servicio.modelo_consulta vuelve a del-indice: el modelo de la consulta sale del manifiesto del índice, no de una configuración aparte."),
    "alias-a-medio": dict(
        tipo="infra", titulo="La API dejó de contestar justo cuando empezó el job de la noche", aplicar=alias_a_medio,
        historia="Para «ganar tiempo», el job nuevo de la noche mueve el alias al índice nuevo en cuanto empieza a construirlo, no al final.",
        explica="c11 apunta a <vigente>-2, que está «construyendo»: tiene chunks.jsonl y bm25.json, pero todavía no tiene vectores.npy. La API no lo puede abrir y contesta 503. Se ve con python verificar.py alias, python pipeline/alias.py listar y curl http://localhost:8150/salud. Arreglo: python pipeline/alias.py volver c11 (el anterior está sano), se borra el índice a medias (rm -rf indices/<vigente>-2) y python mundo/noche.py lo construye completo y mueve el alias al final. El alias se mueve después de construir y revisar, nunca antes."),
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
    print("  revisando que todo esté sano (≈ 20 s)…")
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
