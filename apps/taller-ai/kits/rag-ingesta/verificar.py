"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tu catálogo ni el mundo.

    python verificar.py                    # todos
    python verificar.py wiki parsing       # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y las fuentes arriba (python mundo/fuentes.py arrancar).
Los checks de los conectores llaman a tu código contra las fuentes; los del almacén y el catálogo comparan lo que
dejó tu ingestión con la verdad del mundo (mundo/referencia.py).
"""
from __future__ import annotations

import io
import sys
from collections import Counter
from contextlib import redirect_stdout
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo.comun import BASE, estado, leer_json, sha256, utc, ZONA_JIRA  # noqa: E402
from mundo.referencia import esperado  # noqa: E402

ALM = RAIZ / "almacen"
CAMPOS = ["fuente", "version", "actualizado", "titulo", "url", "tipo", "hash", "acl", "necesita_ocr", "borrado", "ingerido"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def modulo(nombre: str):
    """Importa tu módulo de pipeline/ (conectores.wiki, parsing…). Si todavía es el esqueleto, lo dice."""
    import importlib

    try:
        return importlib.import_module(nombre)
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar {nombre}: {e}")


def llamar(fn, *a, **k):
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{fn.__module__}.{fn.__name__} todavía es el esqueleto ({e or 'NotImplementedError'})")


def lista_ids(xs) -> str:
    xs = sorted(xs)
    return ", ".join(xs[:4]) + (f" y {len(xs) - 4} más" if len(xs) > 4 else "")


def de_fuente(esp: dict, fuente: str) -> dict:
    return {k: v for k, v in esp.items() if k.startswith(fuente + ":")}


def revisar_refs(refs, esp, fuente):
    exige(isinstance(refs, list), f"{fuente}.listar() tiene que devolver una lista (devolvió {type(refs).__name__})")
    for r in refs[:1]:
        falta = [k for k in ("doc_id", "fuente", "version", "actualizado", "titulo", "url", "meta") if k not in r]
        exige(not falta, f"un ref de {fuente} no trae {falta}: la forma está en pipeline/conectores/__init__.py")
    ids = Counter(r["doc_id"] for r in refs)
    rep = [d for d, n in ids.items() if n > 1]
    exige(not rep, f"{fuente}.listar() repite documentos: {lista_ids(rep)}")
    faltan, sobran = set(esp) - set(ids), set(ids) - set(esp)
    exige(not faltan, f"{fuente}.listar() no trae {len(faltan)} de {len(esp)}: {lista_ids(faltan)}" + (" (¿sigues «siguiente» / nextPageToken hasta el final?)" if len(faltan) > 3 else ""))
    exige(not sobran, f"{fuente}.listar() trae {len(sobran)} que no son de la fuente: {lista_ids(sobran)}")
    mal = [r["doc_id"] for r in refs if r["version"] != esp[r["doc_id"]]["version"]]
    if mal:
        raise Falla(f"versión distinta en {lista_ids(mal)}: la versión va como texto, tal como la da la fuente (ej. {esp[mal[0]]['version']!r})")


def revisar_acl(con, refs, esp, fuente, muestra=None):
    mal = []
    for r in refs:
        if muestra and r["doc_id"] not in muestra:
            continue
        a = llamar(con.acl, r)
        if a != esp[r["doc_id"]]["acl"]:
            mal.append((r["doc_id"], a))
    if mal:
        d, a = mal[0]
        raise Falla(f"{len(mal)} ACL distintas; por ejemplo {d}: salió {a}, esperaba {esp[d]['acl']}")


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    from urllib.request import Request, urlopen
    import json

    try:
        s = json.loads(urlopen(f"{BASE}/salud", timeout=2).read())
    except Exception:  # noqa: BLE001
        raise Falla(f"las fuentes no responden en {BASE}: python mundo/fuentes.py arrancar")
    for paq in ("bs4", "pypdf", "yaml"):
        try:
            __import__(paq)
        except ImportError:
            raise Falla(f"falta {paq}: activa el entorno (source .venv/bin/activate) y pip install -r requirements.txt")
    import yaml

    cfg = yaml.safe_load((RAIZ / "config.yaml").read_text())
    e = estado()
    malos = []
    for f, ruta in (("wiki", "/espacios/SOP/permisos"), ("drive", "/changes/startPageToken"), ("jira", "/nivel/10001"), ("politicas", "/arbol")):
        try:
            urlopen(Request(cfg["fuentes"][f]["url"] + ruta, headers={"Authorization": f"Bearer {cfg['fuentes'][f]['token']}"}), timeout=3)
        except Exception as ex:  # noqa: BLE001
            malos.append(f"{f} ({getattr(ex, 'code', type(ex).__name__)})")
    exige(not malos, f"las fuentes responden, pero config.yaml no entra a: {', '.join(malos)}")
    n = len(esperado(e))
    return f"fuentes arriba en {BASE} · día {s['dia']} del mundo ({s['reloj']}) · {n} documentos visibles · los 4 tokens de config.yaml entran"


def check_http() -> str:
    h = modulo("conectores.http")
    _comun = modulo("_comun")
    r = llamar(h.pedir, "politicas", "/arbol")
    exige(isinstance(r, dict) and "archivos" in r, f"pedir('politicas', '/arbol') tenía que devolver el JSON como dict; devolvió {type(r).__name__}")
    b = llamar(h.pedir, "politicas", "/crudo/envios.md")
    exige(isinstance(b, bytes) and b.startswith(b"# "), "pedir('politicas', '/crudo/envios.md') tenía que devolver los bytes del Markdown")
    exige(llamar(h.pedir, "drive", "/files/no-existe") is None, "un 404 tiene que devolver None")
    original = h.config
    malo = original()
    malo["fuentes"]["jira"]["token"] = "token-vencido"
    h.config = lambda: malo
    try:
        try:
            llamar(h.pedir, "jira", "/nivel/10001")
            raise Falla("con un token malo, pedir() no lanzó nada: un 401 tiene que ser FuenteSinAcceso, nunca «vacío»")
        except _comun.FuenteSinAcceso:
            pass
        except Falla:
            raise
        except Exception as ex:  # noqa: BLE001
            raise Falla(f"con un token malo, pedir() lanzó {type(ex).__name__}; tiene que ser FuenteSinAcceso (de _comun)")
    finally:
        h.config = original
    antes = h.ESPERAS["wiki"]
    for _ in range(25):
        exige(llamar(h.pedir, "wiki", "/espacios/SOP/permisos") is not None, "una llamada a la wiki se perdió")
    esperas = h.ESPERAS["wiki"] - antes
    exige(esperas > 0, "25 llamadas seguidas a la wiki y ningún 429 contado en ESPERAS['wiki']: ¿cuentas las esperas?")
    return f"JSON → dict, Markdown → bytes, 404 → None, 401 → FuenteSinAcceso · 25 llamadas a la wiki: {esperas} respuestas 429, todas reintentadas"


def check_wiki() -> str:
    w = modulo("conectores.wiki")
    esp = de_fuente(esperado(estado()), "wiki")
    refs = llamar(w.listar)
    revisar_refs(refs, esp, "wiki")
    revisar_acl(w, refs, esp, "wiki")
    d = llamar(w.traer, next(r for r in refs if r["doc_id"] == "wiki:2002"))
    exige(d and d.get("tipo") == "html" and isinstance(d.get("crudo"), bytes), "wiki.traer() tiene que devolver el doc con tipo 'html' y crudo en bytes")
    exige(sha256(d["crudo"]) == esp["wiki:2002"]["hash"], "wiki.traer(): el crudo no es el «cuerpo» de la página tal cual, en UTF-8")
    varias = sum(len(a["acl"]) > 1 for a in esp.values())
    return f"{len(refs)} páginas de {len(set(r['meta'].get('espacio') for r in refs))} espacios (paginadas de 10 en 10) · {varias} con restricción propia o heredada, todas con su ACL bien"


def check_drive() -> str:
    dr = modulo("conectores.drive")
    e = estado()
    esp = de_fuente(esperado(e), "drive")
    refs = llamar(dr.listar)
    revisar_refs(refs, esp, "drive")
    revisar_acl(dr, refs, esp, "drive")
    r = llamar(dr.cambios, None)
    exige(isinstance(r, tuple) and len(r) == 3, "drive.cambios() devuelve (refs, borrados, cursor)")
    exige(r[2] == {"pageToken": str(len(e["drive"]["cambios"]))}, f"con None, el cursor tiene que ser el startPageToken: {{'pageToken': '{len(e['drive']['cambios'])}'}}; salió {r[2]}")
    refs0, borr0, cur0 = llamar(dr.cambios, {"pageToken": "0"})
    vivos = {c["fileId"] for c in e["drive"]["cambios"]}
    esp_b = {f"drive:{f}" for f in vivos} - set(esp)
    exige(sorted(x["doc_id"] for x in refs0) == sorted(esp), f"desde el token 0, los refs tenían que ser los {len(esp)} archivos vivos, una vez cada uno; salieron {len(refs0)}")
    exige(sorted(borr0) == sorted(esp_b), f"desde el token 0, los borrados tenían que ser {sorted(esp_b) or 'ninguno'}; salió {sorted(borr0)}")
    exige(cur0 == r[2], f"el cursor nuevo es el newStartPageToken ({r[2]}); salió {cur0}")
    link = [d for d in esp if any(p["type"] in ("domain", "anyone") and not p.get("allowFileDiscovery") for p in e["drive"]["archivos"][d[6:]]["permissions"])]
    d = llamar(dr.traer, next(x for x in refs if x["doc_id"] == "drive:d02"))
    exige(d and d["tipo"] == "pdf" and sha256(d["crudo"]) == esp["drive:d02"]["hash"], "drive.traer() tiene que devolver los bytes del PDF tal cual, con tipo 'pdf'")
    return f"{len(refs)} archivos · feed de cambios del 0 al {r[2]['pageToken']} con {len(borr0)} borrado(s) · {len(link)} con link compartido que no dan acceso: {lista_ids(link)}"


def check_jira() -> str:
    j = modulo("conectores.jira")
    e = estado()
    esp = de_fuente(esperado(e), "jira")
    refs = llamar(j.listar)
    revisar_refs(refs, esp, "jira")
    revisar_acl(j, refs, esp, "jira")
    mal = [r["doc_id"] for r in refs if r["actualizado"] != utc(r["version"]).strftime("%Y-%m-%dT%H:%M:%SZ")]
    exige(not mal, f"«actualizado» va en UTC con Z (de fields.updated); mal en {lista_ids(mal)}")
    desde = "2026-11-20T14:59:40Z"   # el último ticket del día 1, a la mitad de su minuto
    refs2, borr, cur = llamar(j.cambios, {"desde": desde})
    corte = utc(desde).replace(second=0)
    esp2 = {f"jira:{k}" for k, t in e["jira"]["tickets"].items() if utc(t["actualizado"]).replace(second=0) >= corte}
    got = {r["doc_id"] for r in refs2}
    exige(got == esp2, f"cambios desde {desde} tenía que traer {lista_ids(esp2)}; trajo {lista_ids(got) or 'nada'}"
          + (" (el JQL va en la zona de fuentes.jira.zona y en minutos: 08:59 en Ciudad de México)" if not got else ""))
    exige(cur["desde"] == max([desde] + [r["actualizado"] for r in refs2]), f"el cursor nuevo es el «actualizado» más nuevo; salió {cur}")
    local = utc(desde).astimezone(ZONA_JIRA).strftime("%H:%M")
    nivel = sum(len(v["acl"]) > 1 for v in esp.values())
    return f"{len(refs)} tickets (de 20 en 20) · {nivel} con nivel de seguridad · desde {desde} = updated >= {local} en la zona de la cuenta: {len(got)} ticket(s)"


def check_politicas() -> str:
    p = modulo("conectores.politicas")
    esp = de_fuente(esperado(estado()), "politicas")
    refs = llamar(p.listar)
    revisar_refs(refs, esp, "politicas")
    revisar_acl(p, refs, esp, "politicas")
    _, _, cur = llamar(p.cambios, None)
    shas = dict(cur["shas"])
    rutas = sorted(shas)
    shas[rutas[0]] = "0" * 40          # uno con otro sha: cambió
    del shas[rutas[-1]]                # uno que el cursor no tenía: es nuevo
    shas["vieja.md"] = "1" * 40        # uno que ya no está en el árbol: se borró
    refs2, borr, _ = llamar(p.cambios, {"commit": "x", "shas": shas})
    quiero = sorted({f"politicas:{rutas[0]}", f"politicas:{rutas[-1]}"})
    exige(sorted(r["doc_id"] for r in refs2) == quiero, f"con un sha distinto y un archivo que faltaba, cambios() tenía que traer {quiero}; trajo {[r['doc_id'] for r in refs2]}")
    exige(borr == ["politicas:vieja.md"], f"un archivo que ya no está en el árbol es un borrado; salió {borr}")
    return f"{len(refs)} archivos por su sha de git · el árbol contra el cursor da los nuevos, los cambiados y los borrados"


def check_parsing() -> str:
    ps = modulo("parsing")
    e = estado()
    esp = esperado(e)
    doc = lambda d, tipo: {"doc_id": d, "tipo": tipo, "crudo": esp[d]["crudo"]}  # noqa: E731
    exige(isinstance(getattr(ps, "PARSER", None), str), "parsing.PARSER tiene que ser un texto (la versión de tu parser)")
    t = llamar(ps.parsear, doc("wiki:2002", "html"))
    exige(set(t) >= {"texto", "necesita_ocr"}, "parsear() devuelve {'texto', 'necesita_ocr'}")
    x = t["texto"]
    exige("Inicio › Espacios" not in x and "Ver historial" not in x, "wiki:2002: el texto todavía trae el menú o el pie de la página")
    exige(x.startswith("# Comisiones por categoría"), "wiki:2002: el texto empieza con su título como «# Comisiones por categoría»")
    exige("## Tabla vigente" in x, "wiki:2002: los h2 salen como «## …»")
    fila = "Categoría: Electrónica; Comisión: 8 %; Días para pagar a quien vende: 15"
    exige(fila in x.splitlines(), f"wiki:2002: cada fila de la tabla sale con su encabezado; no encuentro la línea «{fila}»")
    t = llamar(ps.parsear, doc("wiki:1001", "html"))["texto"]
    exige("- Chat y correo: de 8:00 a 22:00, todos los días." in t.splitlines(), "wiki:1001: cada ítem de lista sale como «- …»")
    t = llamar(ps.parsear, doc("drive:d01", "pdf"))
    exige("Viáticos por día: 1,200 pesos en ciudades grandes y 900 pesos en el resto." in t["texto"], "drive:d01: no encuentro el texto del PDF (con sus acentos)")
    exige("Página" not in t["texto"] and "Marketplace ·" not in t["texto"], "drive:d01: el texto todavía trae el encabezado o el pie que se repite en cada página")
    exige(not t["necesita_ocr"], "drive:d01 tiene capa de texto: necesita_ocr False")
    esc = next(d for d, v in esp.items() if v.get("ocr"))
    t = llamar(ps.parsear, doc(esc, "pdf"))
    exige(t["necesita_ocr"] is True and t["texto"] == "", f"{esc} es un escaneo sin capa de texto: texto '' y necesita_ocr True")
    t = llamar(ps.parsear, doc("jira:SOP-1", "ticket"))["texto"]
    exige(t.startswith("# SOP-1 · "), "jira:SOP-1: empieza con «# SOP-1 · <summary>»")
    exige("Saludos," not in t and "Ext. 44" not in t, "jira:SOP-1: el texto todavía trae la firma")
    exige("[automático]" not in t, "jira:SOP-1: el texto trae el comentario automático")
    exige("> " not in t and "escribió:" not in t, "jira:SOP-1: el texto trae el correo citado")
    exige("Resolución: " in t, "jira:SOP-1: falta «Resolución: …»")
    t = llamar(ps.parsear, doc("politicas:envios.md", "markdown"))["texto"]
    exige(t == esp["politicas:envios.md"]["crudo"].decode().strip(), "politicas:envios.md: el Markdown va tal cual")
    return f"HTML con títulos, listas y tablas fila por fila · PDF sin encabezado ni pie · {esc} marcado para OCR · ticket sin firma, cita ni automáticos · parser {ps.PARSER}"


def catalogo() -> dict:
    c = leer_json(ALM / "catalogo.json")
    exige(c, "no existe almacen/catalogo.json: corre python pipeline/ingestar.py")
    return c


def check_almacen() -> str:
    ps = modulo("parsing")
    c = catalogo()
    vivos = {d: x for d, x in c.items() if not x.get("borrado")}
    falta_campo = [d for d, x in c.items() if any(k not in x for k in CAMPOS)]
    exige(not falta_campo, f"registros del catálogo sin todos sus campos ({', '.join(CAMPOS)}): {lista_ids(falta_campo)}")
    malos, alterados, viejos = [], [], []
    for d, x in vivos.items():
        t = leer_json(ALM / "texto" / f"{x['hash']}.json")
        if not t:
            malos.append(d)
            continue
        if t.get("hash_crudo") != x["hash"]:
            malos.append(d)
        elif sha256(t["texto"].encode()) != t.get("sha256_texto"):
            alterados.append(d)
        elif t.get("parser") != ps.PARSER:
            viejos.append(d)
    exige(not malos, f"{len(malos)} documentos vivos sin su texto en almacen/texto/<hash>.json: {lista_ids(malos)}")
    exige(not alterados, f"el texto de {lista_ids(alterados)} ya no coincide con su sha256_texto: alguien lo editó a mano")
    exige(not viejos, f"{len(viejos)} textos son de otra versión del parser: {lista_ids(viejos)}")
    esp = esperado(estado())
    otro = [d for d, x in vivos.items() if d in esp and esp[d]["version"] == x["version"] and esp[d]["hash"] != x["hash"]]
    exige(not otro, f"el hash de {lista_ids(otro)} no es el sha256 de su contenido crudo")
    archivos = list((ALM / "texto").glob("*.json"))
    pesa = sum(p.stat().st_size for p in archivos)
    return f"{len(vivos)} documentos vivos → {len(set(x['hash'] for x in vivos.values()))} textos por hash, todos íntegros · {len(archivos)} archivos en almacen/texto ({pesa / 1024:.0f} KiB)"


def check_catalogo() -> str:
    c = catalogo()
    esp = esperado(estado())
    vivos = {d: x for d, x in c.items() if not x.get("borrado")}
    faltan = set(esp) - set(vivos)
    exige(not faltan, f"faltan {len(faltan)} documento(s) en el catálogo: {lista_ids(faltan)} (¿corriste la ingestión después del último cambio del mundo?)")
    sobran = set(vivos) - set(esp)
    exige(not sobran, f"{len(sobran)} documento(s) siguen vivos en el catálogo y la fuente ya no los deja leer: {lista_ids(sobran)}")
    viejos = [d for d in esp if vivos[d]["version"] != esp[d]["version"]]
    exige(not viejos, f"{len(viejos)} documento(s) con una versión vieja: {lista_ids(viejos)}")
    acl = [d for d in esp if vivos[d]["acl"] != esp[d]["acl"]]
    exige(not acl, f"{len(acl)} documento(s) con una ACL distinta a la de la fuente: {lista_ids(acl)}; por ejemplo {acl[0] if acl else ''}: {vivos[acl[0]]['acl'] if acl else ''}")
    ocr = sorted(d for d, x in vivos.items() if x["necesita_ocr"])
    exige(ocr == sorted(d for d, v in esp.items() if v.get("ocr")), f"necesita_ocr va solo en el escaneo; está en {ocr}")
    lapidas = sum(1 for x in c.values() if x.get("borrado"))
    por = Counter(x["fuente"] for x in vivos.values())
    return f"{len(vivos)} vivos, al día con las fuentes ({', '.join(f'{k} {v}' for k, v in por.items())}) · {lapidas} lápida(s) · ACL igual a la de cada fuente · {len(ocr)} para OCR"


def corridas() -> list[dict]:
    cs = sorted((ALM / "corridas").glob("*.json"))
    exige(cs, "no hay corridas en almacen/corridas/: corre python pipeline/ingestar.py")
    return [leer_json(p) for p in cs]


def check_incremental() -> str:
    e = estado()
    cs = corridas()
    exige(set(leer_json(ALM / "cursores.json", {})) >= {"wiki", "drive", "jira", "politicas"}, "almacen/cursores.json no tiene el cursor de las 4 fuentes")
    primera = cs[0]
    exige(primera["modo"] == "incremental" and all(f["parseados"] == f["descargados"] > 0 for f in primera["fuentes"].values()),
          "la primera corrida tenía que traer y parsear todo (modo incremental, sin cursores)")
    exige(e["dia"] == 2, "falta el día 2: python mundo/avanzar.py y otra vez python pipeline/ingestar.py (paso 8)")
    dia2 = [x for x in cs if x["modo"] == "incremental" and x["inicio"] >= e["avanzado_en"]]
    exige(dia2, "no hay una corrida incremental después de python mundo/avanzar.py")
    x = dia2[0]
    f = x["fuentes"]
    exige(set(f) == {"wiki", "drive", "jira", "politicas"}, "la primera corrida del día 2 tenía que ser de las 4 fuentes")
    tot = Counter()
    for v in f.values():
        tot.update({k: v[k] for k in ("vistos", "descargados", "parseados", "saltados")})
    exige(tot["descargados"] < 30, f"la corrida del día 2 descargó {tot['descargados']} documentos: tenía que traer solo lo que cambió (¿lees el cursor?)")
    exige(f["drive"]["saltados"] >= 2 and f["wiki"]["saltados"] >= 1, "el día 2 hay 3 contenidos que no cambiaron (permiso, nombre, republicación): esos se descargan pero no se parsean (saltados)")
    exige(f["jira"]["sin_cambios"] >= 1, "jira: el ticket del minuto del corte vuelve a salir y tiene que contar como sin_cambios")
    return f"día 2: vio {tot['vistos']}, descargó {tot['descargados']}, parseó {tot['parseados']} y saltó {tot['saltados']} por hash (el día 1 parseó {sum(v['parseados'] for v in primera['fuentes'].values())})"


def check_barrido() -> str:
    ing = modulo("ingestar")
    c = catalogo()
    cs = [x for x in corridas() if x["modo"] == "barrido"]
    exige(cs, "no hay ningún barrido en almacen/corridas/: python pipeline/ingestar.py --barrido (paso 8)")
    frenado = [n for n, f in cs[-1]["fuentes"].items() if "frenado" in f]
    exige(not frenado, f"el último barrido se frenó en {', '.join(frenado)}: {cs[-1]['fuentes'][frenado[0]]['frenado'] if frenado else ''}")
    lap = {d: x for d, x in c.items() if x.get("borrado")}
    exige(all(x.get("motivo") and x.get("borrado_en") for x in lap.values()), "cada lápida lleva su motivo y su borrado_en")
    exige(estado()["dia"] < 2 or "wiki:1012" in lap, "wiki:1012 se borró en la wiki el día 2 y no tiene lápida: la wiki no avisa, lo encuentra el barrido")

    class Falso:   # un conector de mentiras: de 10 documentos, hoy «ve» 3
        def listar(self):
            return [{"doc_id": f"prueba:{i}", "fuente": "prueba", "version": "1", "actualizado": None, "titulo": "", "url": "", "meta": {}} for i in range(3)]

        def acl(self, ref):
            return [["group:x"]]

        def traer(self, ref):
            raise AssertionError("no debía traer nada")

    falso = {f"prueba:{i}": {"fuente": "prueba", "version": "1", "acl": [["group:x"]], "borrado": False} for i in range(10)}
    cuenta = Counter()
    with redirect_stdout(io.StringIO()):
        llamar(ing.barrido, falso, "prueba", Falso(), cuenta)
    exige("frenado" in cuenta, "con 7 de 10 documentos desaparecidos, barrido() tenía que frenarse (cuenta['frenado'])")
    exige(not any(x.get("borrado") for x in falso.values()), "barrido() frenado no borra nada")
    return f"{len(cs)} barrido(s), el último sin freno · {len(lap)} lápida(s) con su motivo · con 70 % desaparecido, el freno no borra nada"


CHECKS = {
    "mundo": check_mundo, "http": check_http, "wiki": check_wiki, "drive": check_drive, "jira": check_jira,
    "politicas": check_politicas, "parsing": check_parsing, "almacen": check_almacen, "catalogo": check_catalogo,
    "incremental": check_incremental, "barrido": check_barrido,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<12} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
