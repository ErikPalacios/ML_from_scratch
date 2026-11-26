"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tus chunks ni el almacén.

    python verificar.py                    # todos
    python verificar.py tokens bloques     # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el tokenizer bajado (python mundo/tokenizador.py).
Los checks de tokens y bloques llaman a tu código; los demás comparan lo que dejó tu chunking en chunks/ con la
verdad del mundo (mundo/referencia.py): los documentos vivos de hoy, su texto, su ACL, sus tablas y sus títulos.
"""
from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALMACEN, CHUNKS, MUNDO, entrada, leer_json, mundo, tokenizer_sano  # noqa: E402

OBJ, TRAS, LIM = ref.OBJETIVO, ref.TRASLAPE, ref.LIMITE
LARGO = "drive:d20"          # el «Manual del vendedor»: 1 724 tokens el día 1
CAMPOS_DOC = ["doc_id", "hash", "sha256_texto", "huella", "acl", "titulo", "url", "version", "chunks"]
CAMPOS_CHUNK = ["chunk_id", "doc_id", "orden", "ruta", "texto", "tokens", "traslape", "acl", "titulo", "url", "version"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def modulo(nombre: str):
    """Importa tu módulo de pipeline/ (tokens, bloques…). Si todavía es el esqueleto, lo dice."""
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


def num(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def lista_ids(xs) -> str:
    xs = sorted(xs)
    return ", ".join(xs[:4]) + (f" y {len(xs) - 4} más" if len(xs) > 4 else "")


def docs() -> dict[str, dict]:
    """Lo que dejó tu chunking: doc_id → el JSON de chunks/docs/."""
    d = CHUNKS / "docs"
    exige(d.exists() and any(d.glob("*.json")), "no hay nada en chunks/docs/: python pipeline/chunkear.py (paso 6)")
    out = {}
    for p in sorted(d.glob("*.json")):
        x = leer_json(p)
        falta = [k for k in CAMPOS_DOC if k not in x]
        exige(not falta, f"{p.name} no trae {falta}: la forma está en el contrato de pipeline/chunkear.py")
        out[x["doc_id"]] = x
    return out


def todos() -> list[dict]:
    return [c for x in docs().values() for c in x["chunks"]]


def cuerpo(c: dict) -> list[str]:
    """Las líneas del chunk sin su primera línea (la ruta) ni la línea en blanco que la sigue."""
    ls = c["texto"].split("\n")
    return ls[2:] if len(ls) > 1 and ls[1] == "" else ls[1:]


def corridas() -> list[dict]:
    return [leer_json(p) for p in sorted((CHUNKS / "corridas").glob("*.json"))] if (CHUNKS / "corridas").exists() else []


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    exige(tokenizer_sano(), "falta modelo/tokenizer.json o su sha256 no es el anotado: python mundo/tokenizador.py")
    exige(MUNDO.exists() and (ALMACEN / "catalogo.json").exists(), "falta el almacén de la estación 1: python mundo/crear.py")
    exige((RAIZ / "config.yaml").exists(), "falta config.yaml")
    m = mundo()
    v = ref.vivos()
    tot = sum(ref.contar(x["texto"]) for x in v.values() if x["texto"])
    largos = sorted(((ref.contar(x["texto"]), d) for d, x in v.items()), reverse=True)[:3]
    return (f"día {m['dia']} · {len(v)} documentos vivos · {num(tot)} tokens en total · los más largos: "
            + ", ".join(f"{d} {num(n)}" for n, d in largos))


def check_tokens() -> str:
    t = modulo("tokens")
    exige(getattr(t, "LIMITE", None) == LIM, f"tokens.LIMITE tiene que ser {LIM} (config modelo.limite), es {getattr(t, 'LIMITE', None)}")
    v = ref.vivos()
    muestras = ["", "Hola", "¿Cuántos días tengo para devolver una licuadora?", v["wiki:1002"]["texto"], v[LARGO]["texto"]]
    for s in muestras:
        tuyo, bien = llamar(t.contar, s), ref.contar(s)
        exige(tuyo == bien, f"contar({s[:30]!r}…) da {tuyo} y el modelo ve {bien}" +
              (" (¿le pusiste el prefijo «passage: » y los tokens especiales <s> y </s>?)" if abs(tuyo - bien) <= 5 else ""))
    exige(llamar(t.tokens_texto, "Hola") == ref.tokens_texto("Hola"), "tokens_texto(x) es contar(x) - contar(\"\")")
    dev, man = v["wiki:1002"]["texto"], v[LARGO]["texto"]
    n = ref.contar(man)
    return (f"contar(\"\") = {ref.contar('')} (prefijo + <s> y </s>) · «Devoluciones» {ref.contar(dev)} tokens, "
            f"{len(dev) / ref.tokens_texto(dev):.1f} caracteres por token · el manual {num(n)}: e5 leería solo el {LIM / n:.0%}")


def check_bloques() -> str:
    b = modulo("bloques")
    v = ref.vivos()
    for d in ("wiki:1002", "drive:d21", "wiki:2010", LARGO):
        texto = v[d]["texto"]
        bs = llamar(b.bloques, texto)
        exige(isinstance(bs, list) and all("tipo" in x and "lineas" in x for x in bs), "bloques() devuelve una lista de {tipo, lineas, …}")
        lineas = [l for x in bs for l in x["lineas"]]
        exige(lineas == [l for l in texto.splitlines() if l.strip()], f"{d}: los bloques tienen que traer todas las líneas del texto, en orden y sin cambios")
        tabs = [x for x in bs if x["tipo"] == "tabla"]
        esperadas = ref.tablas(texto)
        exige(len(tabs) == len(esperadas), f"{d}: hay {len(esperadas)} tabla(s) y bloques() encontró {len(tabs)}" +
              (" (las filas de la wiki son «Encabezado: valor; Encabezado: valor»)" if d.startswith("wiki") else ""))
        for x, e in zip(tabs, esperadas):
            exige(x["lineas"] == e["lineas"], f"{d}: una tabla tiene {len(e['lineas'])} líneas y tu bloque {len(x['lineas'])}")
            exige(x.get("encabezado") == e["encabezado"], f"{d}: el encabezado de la tabla tiene que ser {e['encabezado'][:1] or '[] (de filas)'}…")
        tit = [(x.get("nivel"), x.get("texto")) for x in bs if x["tipo"] == "titulo"]
        exige(all(n in (1, 2, 3) and t for n, t in tit), f"{d}: cada título lleva nivel 1–3 y su texto sin los #")
    bs = b.bloques(v[LARGO]["texto"])
    cuenta = {k: sum(x["tipo"] == k for x in bs) for k in ("titulo", "parrafo", "lista", "tabla")}
    return f"el manual: {cuenta['titulo']} títulos, {cuenta['parrafo']} párrafos, {cuenta['lista']} listas y {cuenta['tabla']} tabla · las tablas de barras y de filas, enteras"


def check_ruta() -> str:
    v, n = ref.vivos(), 0
    for d, x in docs().items():
        if d not in v:
            continue
        doc, rs, ls = ref.rutas(v[d]["texto"], v[d]["titulo"])
        for c in x["chunks"]:
            exige(c.get("ruta") and c["ruta"][0] == doc, f"{c['chunk_id']}: la ruta empieza con el título del documento, «{doc}» (tiene {c.get('ruta')})")
            exige(c["texto"].split("\n")[0] == " › ".join(c["ruta"]), f"{c['chunk_id']}: la primera línea del texto tiene que ser la ruta, « › ».join(ruta)")
            primera = next((l for l in cuerpo(c) if l and not ref.TITULO.match(l)), None)
            if primera is None:
                continue
            i = next((i for i, l in enumerate(ls) if i in rs and primera in l), None)
            exige(i is not None, f"{c['chunk_id']}: no encuentro su primera línea en el documento")
            exige(c["ruta"] == rs[i], f"{c['chunk_id']}: empieza en «{' › '.join(rs[i])}» y su ruta dice «{' › '.join(c['ruta'])}»")
            n += 1
    return f"{n} chunks con su ruta de títulos, y la ruta es la de donde empieza su contenido"


def check_tamano() -> str:
    cs = todos()
    exige(cs, "no hay chunks")
    for c in cs[:1]:
        falta = [k for k in CAMPOS_CHUNK if k not in c]
        exige(not falta, f"un chunk no trae {falta}: la forma está en el contrato de pipeline/chunkear.py")
    reales = {c["chunk_id"]: ref.contar(c["texto"]) for c in cs}
    mal = [k for k, n in reales.items() if n != next(c["tokens"] for c in cs if c["chunk_id"] == k)]
    exige(not mal, f"«tokens» no es lo que cuenta el modelo en {lista_ids(mal)}")
    cortados = [k for k, n in reales.items() if n > LIM]
    exige(not cortados, f"{len(cortados)} chunks pasan de {LIM} tokens ({lista_ids(cortados)}, el mayor de {max(reales.values())}): "
          f"e5 los corta en {LIM} sin avisar y lo de después no se encuentra nunca")
    grandes = [k for k, n in reales.items() if n > OBJ]
    exige(not grandes, f"{len(grandes)} chunks pasan del objetivo de {OBJ} tokens: {lista_ids(grandes)} (el mayor de {max(reales.values())})")
    vacios = [c["chunk_id"] for c in cs if not any(l.strip() for l in cuerpo(c))]
    exige(not vacios, f"chunks sin contenido: {lista_ids(vacios)}")
    for x in docs().values():       # no partir de más: dos chunks seguidos de la misma sección que juntos caben
        for a, b in zip(x["chunks"], x["chunks"][1:]):
            if a["ruta"][:2] == b["ruta"][:2] and len(a["ruta"]) > 1 and not any(ref.TITULO.match(l) for l in cuerpo(b)[:1]):
                junto = ref.contar(a["texto"] + "\n" + "\n".join(cuerpo(b)[1 if b["traslape"] else 0:]))
                exige(junto > OBJ, f"{a['chunk_id']} y {b['chunk_id']} son de la misma sección y juntos caben ({junto} tokens): partiste de más")
    m = sorted(reales.values())
    return f"{len(cs)} chunks · ninguno pasa de {OBJ} · mediana {m[len(m) // 2]} tokens, el mayor {m[-1]} · ninguna sección partida sin necesidad"


def check_tablas() -> str:
    v, partidas, enteras = ref.vivos(), 0, 0
    ds = docs()
    for d, x in v.items():
        for t in ref.tablas(x["texto"]):
            filas = t["lineas"][len(t["encabezado"]):]
            con = [c for c in ds.get(d, {}).get("chunks", []) if any(f in cuerpo(c) for f in filas)]
            exige(con, f"{d}: las filas de la tabla que empieza «{t['lineas'][0][:40]}» no están enteras en ningún chunk (¿se cortaron a media fila?)")
            cortadas = [f for f in filas if not any(f in cuerpo(c) for c in con)]
            exige(not cortadas, f"{d}: la fila «{(cortadas or [""])[0][:50]}» quedó cortada a la mitad")
            ruta = con[0]["ruta"]
            if ref.contar(" › ".join(ruta) + "\n\n" + "\n".join(t["lineas"])) <= OBJ:
                exige(len(con) == 1, f"{d}: la tabla «{t['lineas'][0][:40]}» cabe en un chunk y quedó partida en {len(con)}")
                enteras += 1
            else:
                for c in con:
                    b = cuerpo(c)
                    exige(all(e in b for e in t["encabezado"]), f"{c['chunk_id']}: trae filas de una tabla de barras sin su encabezado: esas filas ya no dicen qué es cada columna")
                partidas += 1
    return f"{enteras} tablas enteras en un chunk · {partidas} tabla(s) más grande(s) que un chunk, partidas por filas y con su encabezado en cada pedazo"


def check_traslape() -> str:
    v, n, rep, tot = ref.vivos(), 0, 0, 0
    for d, x in docs().items():
        for a, b in zip(x["chunks"], x["chunks"][1:]):
            cb = cuerpo(b)
            tot += b["tokens"]
            if not b["traslape"]:
                continue
            t = cb[0]
            exige(not ref.TITULO.match(t) and not any(t == f for tt in ref.tablas(v[d]["texto"]) for f in tt["lineas"]),
                  f"{b['chunk_id']}: el traslape va solo dentro de una sección, nunca en un título ni en una tabla")
            exige("\n".join(cuerpo(a)).endswith(t), f"{b['chunk_id']}: su primera línea (el traslape) tiene que ser el final de {a['chunk_id']}")
            exige(a["ruta"] == b["ruta"], f"{b['chunk_id']}: el traslape va entre chunks de la misma sección")
            real = ref.tokens_texto(t)
            exige(real == b["traslape"], f"{b['chunk_id']}: «traslape» dice {b['traslape']} y la línea repetida tiene {real} tokens")
            exige(real <= TRAS, f"{b['chunk_id']}: repite {real} tokens; el máximo es {TRAS}")
            n, rep = n + 1, rep + real
        for b in x["chunks"]:
            if cuerpo(b) and ref.TITULO.match(cuerpo(b)[0]):
                exige(not b["traslape"], f"{b['chunk_id']} empieza en un título y lleva traslape: en un título la ruta ya da el contexto")
    faq = [c for c in docs().get(LARGO, {}).get("chunks", []) if c["traslape"]]
    exige(faq, f"{LARGO}: las «Preguntas frecuentes» no caben en un chunk y el corte cae entre dos preguntas: ahí va traslape (paso 5)")
    return f"{n} corte(s) dentro de una sección con traslape, {rep} tokens repetidos en total ({rep / max(tot, 1):.1%} de los tokens) · ninguno en títulos ni tablas"


def check_docs() -> str:
    v, ds = ref.vivos(), docs()
    cat = leer_json(ALMACEN / "catalogo.json")
    deben = {d for d, x in v.items() if x["texto"] and (cat.get(d) or {}).get("acl")}
    sobran = set(ds) - set(v)
    exige(not sobran, f"chunks de documentos que ya no están vivos: {lista_ids(sobran)} (¿borras el archivo de una lápida?)")
    faltan = deben - set(ds)
    exige(not faltan, f"faltan los chunks de {len(faltan)} documento(s): {lista_ids(faltan)}")
    for d, x in ds.items():
        texto = v[d]["texto"]
        exige(all(c["doc_id"] == d for c in x["chunks"]), f"{d}: un chunk dice ser de otro documento")
        exige([c["chunk_id"] for c in x["chunks"]] == [f"{d}#{i:03d}" for i in range(len(x["chunks"]))], f"{d}: los chunk_id van <doc_id>#000, #001…")
        exige([c["orden"] for c in x["chunks"]] == list(range(len(x["chunks"]))), f"{d}: «orden» va de 0 en adelante")
        ajenas = [l for c in x["chunks"] for l in cuerpo(c) if l and l not in texto]
        exige(not ajenas, f"{d}: un chunk trae texto que no es de su documento: «{(ajenas or [""])[0][:60]}» (un chunk nunca cruza documentos)")
        juntos = "\n".join(l for c in x["chunks"] for l in cuerpo(c))
        perdidas = [o for l in texto.splitlines() if l.strip() for o in ref.oraciones(l) if o not in juntos]
        exige(not perdidas, f"{d}: se perdió texto al partir: «{(perdidas or [""])[0][:60]}»")
    return f"{len(ds)} documentos, cada chunk de uno solo, sin perder ni una oración · {sum(len(x['chunks']) for x in ds.values())} chunks"


def check_acl() -> str:
    v, ds = ref.vivos(), docs()
    cat = leer_json(ALMACEN / "catalogo.json")
    vacios = [c["chunk_id"] for x in ds.values() for c in x["chunks"] if not c.get("acl")]
    exige(not vacios, f"{len(vacios)} chunks sin ACL ({lista_ids(vacios)}): en el índice, un chunk sin ACL lo vería cualquiera")
    sin = sorted(d for d, x in v.items() if x["texto"] and not (cat.get(d) or {}).get("acl"))
    exige(not sin, f"{len(sin)} documento(s) vivos llegan con la ACL vacía en almacen/catalogo.json: {lista_ids(sin)}. "
          "Tu chunking hizo bien en no chunkearlos (fail-closed), pero se quedaron fuera del asistente: el problema es de la ingestión")
    mal = [c["chunk_id"] for d, x in ds.items() for c in x["chunks"] if d in v and c["acl"] != v[d]["acl"]]
    exige(not mal, f"{len(mal)} chunks con una ACL distinta a la de su documento hoy: {lista_ids(mal)} (¿un cambio de permisos sin cambio de texto?)")
    exige(all(x["acl"] == v[d]["acl"] for d, x in ds.items() if d in v), "la ACL del archivo y la de sus chunks van iguales a la del catálogo")
    m = mundo()
    extra = ""
    if m["dia"] == 2:
        extra = " · el día 2, «Alta de vendedores» y «Política de viajes» ya con su ACL nueva"
        for d in ("wiki:2003", "drive:d01"):
            exige(ds[d]["acl"] == v[d]["acl"], f"{d} cambió de ACL el día 2 sin cambiar de texto, y sus chunks siguen con la vieja")
    return f"{sum(len(x['chunks']) for x in ds.values())} chunks, cada uno con la ACL de su documento" + extra


def check_incremental() -> str:
    m = mundo()
    cs = [x for x in corridas() if not x.get("forzada")]     # las de --doc y --forzar parten a propósito
    exige(len(cs) >= 2, "hacen falta al menos dos corridas normales (sin --doc ni --forzar) en chunks/corridas/ (paso 7)")
    for x in cs[-1:]:
        falta = [k for k in ("inicio", "huella", "rechunkeados", "solo_meta", "borrados", "sin_cambios", "estado") if k not in x]
        exige(not falta, f"la última corrida no trae {falta}: la forma está en el contrato de pipeline/chunkear.py")
    a, b = cs[-2], cs[-1]
    if a["huella"] != b["huella"]:
        esperado = set(b["estado"])
    else:
        esperado = {d for d, h in b["estado"].items() if a["estado"].get(d) != h}
    hechos = set(b["rechunkeados"])
    sobran = hechos - esperado
    exige(not sobran, f"la última corrida volvió a partir {len(hechos)} documentos y {len(sobran)} no habían cambiado ni de texto ni de huella "
          f"({lista_ids(sobran)}): eso se paga en embeddings (¿config incremental?)")
    exige(not (esperado - hechos), f"la última corrida dejó sin partir documentos con texto nuevo: {lista_ids(esperado - hechos)}")
    exige(m["dia"] == 2, "falta el día 2: python mundo/avanzar.py y otra vez python pipeline/chunkear.py (paso 7)")
    dia2 = [x for x in cs if x["inicio"][:19] >= m["avanzado_en"][:19]]
    exige(dia2, "no hay una corrida después de python mundo/avanzar.py")
    e = ref.cambios_dia2()
    buena = next((x for x in dia2 if set(x["rechunkeados"]) == e["rechunkeados"] and set(x["borrados"]) == e["borrados"]
                  and e["solo_meta"] <= set(x["solo_meta"])), None)
    x = dia2[0]
    exige(buena, f"la primera corrida del día 2 tenía que partir {len(e['rechunkeados'])}, actualizar sin partir los metadatos de {len(e['solo_meta'])} y "
          f"borrar {len(e['borrados'])}; partió {len(x['rechunkeados'])}, solo metadatos {len(x['solo_meta'])} y borró {len(x['borrados'])}")
    ds = docs()
    v = ref.vivos()
    viejos = [d for d, y in ds.items() if d in v and y["sha256_texto"] != v[d]["sha256_texto"]]
    exige(not viejos, f"chunks de un texto viejo: {lista_ids(viejos)}")
    return (f"día 2: partió {len(buena['rechunkeados'])} de {len(buena['estado'])}, solo metadatos {len(buena['solo_meta'])}, "
            f"borró {len(buena['borrados'])} y dejó {buena['sin_cambios']} sin tocar · la última corrida partió {len(hechos)}")


CHECKS = {
    "mundo": check_mundo, "tokens": check_tokens, "bloques": check_bloques, "ruta": check_ruta, "tamano": check_tamano,
    "tablas": check_tablas, "traslape": check_traslape, "docs": check_docs, "acl": check_acl, "incremental": check_incremental,
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
