"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tu índice ni el almacén.

    python verificar.py                      # todos
    python verificar.py principals permisos  # algunos

Necesita el entorno virtual activo (source .venv/bin/activate). Los checks principals, permisos y prompt llaman a tu
código; los demás comparan lo que deja tu pipeline (indice/ y lo que devuelve pipeline/buscar.py) con la verdad del
mundo (mundo/referencia.py): quién está en qué grupo y qué ACL tiene cada documento a la hora del reloj del mundo.
"""
from __future__ import annotations

import signal
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import ALMACEN, CONFIG, FIN, INDICE, INICIO, SLO, dur, hora, leer_json, mundo  # noqa: E402

PREGUNTAS = [
    "¿Cómo se calcula la comisión por categoría?", "¿Cuánto cuesta un envío a Sonora?", "Cuenta de vendedor duplicada",
    "Calendario de pagos a vendedores", "¿Cuánto gana un líder de soporte?", "Caso Transportes del Norte",
    "Retención de datos personales", "Política de viajes", "Plan de temporada alta", "Devolución de electrónica",
    "El cupón de bienvenida no se aplicó", "Código de conducta",
]
D = "@marketplace.test"


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def modulo(nombre: str):
    import importlib

    try:
        return importlib.import_module(nombre)
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar {nombre}: {e}")


def llamar(fn, *a, **k):
    def alarma(*_):
        raise Falla(f"{fn.__module__}.{fn.__name__} no terminó en 5 s (¿un ciclo de grupos sin control?)")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(5)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{fn.__module__}.{fn.__name__} todavía es el esqueleto ({e or 'NotImplementedError'})")
    except SystemExit as e:
        raise Falla(str(e.code))
    finally:
        signal.alarm(0)


def corto(p: str) -> str:
    return p.split(":", 1)[-1].replace(D, "")


def lista(xs, n: int = 4) -> str:
    xs = sorted(xs)
    return ", ".join(corto(x) if ":" in x and "#" not in x and x.split(":")[0] in ("user", "group", "domain") else x for x in xs[:n]) + (f" y {len(xs) - n} más" if len(xs) > n else "")


def config() -> dict:
    import yaml

    return yaml.safe_load(CONFIG.read_text())


def indice() -> dict:
    idx = leer_json(INDICE / "indice.json")
    exige(idx is not None, "no hay indice/indice.json: python pipeline/indexar.py (paso 3)")
    falta = [k for k in ("construido", "chunks", "docs", "sin_acl") if k not in idx]
    exige(not falta, f"indice/indice.json no trae {falta}: la forma está en el contrato de pipeline/indexar.py")
    return idx


def esperado_acl(doc_id: str, x: dict, vigente: dict) -> list:
    v = vigente.get(doc_id)
    return v["acl"] if v and v["desde"] > (x.get("acl_leida") or "") else x.get("acl")


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    exige(mundo() and (ALMACEN / "docs").exists() and (ALMACEN / "directorio.json").exists(), "falta el almacén: python mundo/crear.py")
    exige(CONFIG.exists(), "falta config.yaml")
    docs = ref.docs()
    d = ref.directorio(INICIO)
    hondo = max(next(n for n in range(1, 20) if ref.principals(p, d, n) == ref.principals(p, d)) for p in ref.personas())
    cola = len([l for l in (ALMACEN / "eventos.jsonl").read_text().splitlines() if l.strip()]) if (ALMACEN / "eventos.jsonl").exists() else 0
    return (f"{hora(mundo()['reloj'])} del 21 de noviembre · {len(docs)} documentos, {sum(len(x['chunks']) for x in docs.values())} chunks · "
            f"{len(d['personas'])} personas y {len(d['grupos'])} grupos (unos dentro de otros, hasta {hondo} niveles, y un ciclo) · "
            f"{cola} evento(s) en la cola")


def check_principals() -> str:
    m = modulo("directorio")
    d = ref.directorio(INICIO)
    for p in ref.personas():
        tuyo, bien = llamar(m.principals, p, d, 10), ref.principals(p, d)
        exige(isinstance(tuyo, set), f"principals() devuelve un set, devolvió {type(tuyo).__name__}")
        exige(not (tuyo - bien), f"{corto('user:' + p)}: le das {lista(tuyo - bien)} y no los tiene")
        exige(not (bien - tuyo), f"{corto('user:' + p)}: le faltan {lista(bien - tuyo)}" +
              (" (¿los grupos que están dentro de otros grupos?)" if any(x.startswith("group:") for x in bien - tuyo) else
               " (¿el user: y el domain: de su correo?)"))
    paula = f"paula.vega{D}"
    uno = llamar(m.principals, paula, d, 1)
    exige(uno == {f"user:{paula}", "domain:marketplace.test", f"group:soporte-lideres{D}"},
          f"con profundidad 1 van solo los grupos directos: paula.vega tiene {lista(uno)}")
    exige(llamar(m.principals, f"nadie{D}", d, 10) == set(), "alguien que no está en el directorio no tiene principals (set())")
    luis = llamar(m.principals, f"luis.campos@paqueteria-aliada.test", d, 10)
    return (f"{len(ref.personas())} personas · paula.vega: {len(ref.principals(paula, d))} principals (líderes de soporte → soporte, y el "
            f"comité y el boletín, que están uno dentro del otro, sin colgarse) · luis.campos, externo: «{lista(x for x in luis if x.startswith('domain:'))}», no el dominio de la empresa")


def check_permisos() -> str:
    m = modulo("permisos")
    a, b, c = "group:a@x.test", "group:b@x.test", "user:c@x.test"
    casos = [
        ([[a, b]], {b}, True, "una cláusula es un OR: basta un principal"),
        ([[a], [b]], {a}, False, "dos cláusulas son un AND: hay que cumplir las dos"),
        ([[a], [b]], {a, b}, True, "dos cláusulas y las dos cumplidas"),
        ([[a, c], [b]], {c, b}, True, "un user: también cuenta"),
        ([], {a}, False, "una ACL vacía no es pública: es un dato que falta (fail-closed)"),
        ([[]], {a}, False, "una cláusula vacía no se puede cumplir"),
        ([[a], []], {a}, False, "una cláusula vacía dentro de la ACL la vuelve inválida"),
        (None, {a}, False, "sin ACL, nadie"),
        ("group:a@x.test", {a}, False, "un texto no es una ACL: es una lista de cláusulas"),
        ([["a@x.test"]], {"a@x.test"}, False, "un principal empieza con user:, group: o domain:"),
    ]
    for acl, ps, bien, por in casos:
        exige(llamar(m.puede_ver, acl, ps) is bien, f"puede_ver({acl!r}, {sorted(ps)}) tiene que dar {bien}: {por}")
    exige(llamar(m.acl_valida, [[a]]) is True and llamar(m.acl_valida, []) is False, "acl_valida([[x]]) es True y acl_valida([]) es False")
    return f"{len(casos)} casos: AND entre cláusulas, OR dentro de cada una, y vacía, rota o ausente = nadie"


def check_indice() -> str:
    idx = indice()
    import permisos as pm  # el de tu pipeline: acl_valida ya pasó en el check permisos

    alm = {x["doc_id"]: x for x in (leer_json(p) for p in sorted((ALMACEN / "docs").glob("*.json")))}
    vigente = leer_json(INDICE / "acl_vigente.json", {})
    rotos = sorted(d for d, x in alm.items() if not (pm.acl_valida(x.get("acl")) and all(pm.acl_valida(c.get("acl")) for c in x["chunks"])))
    colados = [d for d in rotos if d in idx["docs"]]
    exige(not colados, f"{len(colados)} documento(s) sin ACL válida entraron al índice ({lista(colados)}) con una ACL que nadie les puso: "
          f"{idx['docs'][colados[0]]['acl'] if colados else ''} (¿config permisos.sin_acl?)")
    exige(set(idx["sin_acl"]) == set(rotos), f"sin_acl tiene que listar los documentos sin ACL válida: {lista(rotos) or 'ninguno'}")
    exige(not rotos, f"{len(rotos)} documento(s) llegan de la estación 2 sin ACL válida ({lista(rotos)}): tu índice hizo bien en dejarlos fuera "
          "(fail-closed), pero el asistente ya no los conoce. El problema viene del chunking, no del índice")
    faltan = [d for d in alm if d not in idx["docs"]]
    exige(not faltan, f"faltan en el índice {len(faltan)} documento(s): {lista(faltan)}")
    sobran = [d for d in idx["docs"] if d not in alm]
    exige(not sobran, f"el índice trae documentos que no están en almacen/docs/: {lista(sobran)}")
    n = 0
    for d, x in alm.items():
        bien = esperado_acl(d, x, vigente)
        exige(idx["docs"][d]["acl"] == bien, f"{d}: el índice tiene la ACL {idx['docs'][d]['acl']} y le toca {bien}")
        for c in x["chunks"]:
            ic = idx["chunks"].get(c["chunk_id"])
            exige(ic is not None, f"falta el chunk {c['chunk_id']} en el índice")
            exige(ic["acl"] == bien, f"{c['chunk_id']}: su ACL en el índice no es la de su documento" +
                  (" (¿la expandiste a personas? va tal cual, en grupos)" if any(p.startswith("user:") for cl in ic["acl"] for p in cl) and ic["acl"] != bien else ""))
            exige(ic["texto"] == c["texto"], f"{c['chunk_id']}: el texto en el índice no es el del chunk")
            n += 1
    exige(len(idx["chunks"]) == n, f"el índice tiene {len(idx['chunks'])} chunks y almacen/docs/ {n}")
    principals = {p for x in idx["docs"].values() for cl in x["acl"] for p in cl}
    personas = sum(len([q for q in ref.personas() if ref.puede_ver(c["acl"], ref.principals(q, ref.directorio()))]) for c in idx["chunks"].values())
    carril = sum(x["origen"] == "carril" for x in idx["docs"].values())
    return (f"{n} chunks de {len(alm)} documentos, cada uno con la ACL de su documento, en grupos: {len(principals)} principals distintos "
            f"(expandida a personas serían {personas} entradas, una por persona y chunk)" + (f" · {carril} con la ACL del carril rápido" if carril else ""))


def check_filtro() -> str:
    b = modulo("buscar")
    from _comun import puntaje

    k = config()["busqueda"]["k"]
    idx = indice()
    peor = (None, 0, 0, "")
    for p in ref.personas():
        ok = ref.permitidos(p)
        for q in PREGUNTAS:
            todo = sorted(((puntaje(q, c["texto"]), i) for i, c in idx["chunks"].items()), key=lambda x: (-x[0], x[1]))
            bien = [i for s, i in todo if s > 0 and i in ok][:k]
            despues = [i for s, i in todo[:k] if s > 0 and i in ok]
            tuyo = [r["chunk_id"] for r in llamar(b.buscar, q, p)]
            ajenos = [i for i in tuyo if i not in ok]
            exige(not ajenos, f"{corto('user:' + p)} pregunta «{q}» y buscar() le da {lista(ajenos)}, que no puede ver")
            exige(len(tuyo) == len(bien), f"{corto('user:' + p)} pregunta «{q}»: buscar() le da {len(tuyo)} chunk(s) y había {len(bien)} que puede ver y contestan"
                  + (" (¿filtras después de elegir el top-k?)" if len(tuyo) < len(bien) else ""))
            exige(tuyo == bien, f"{corto('user:' + p)} pregunta «{q}»: el orden es mayor puntaje primero y, en empate, por chunk_id")
            if len(bien) - len(despues) > peor[1] - peor[2]:
                peor = (p, len(bien), len(despues), q)
    return (f"{len(ref.personas())} personas × {len(PREGUNTAS)} preguntas: el top-{k} sale solo de lo que cada una puede ver · "
            f"{corto('user:' + peor[0])} pregunta «{peor[3]}» y recibe {peor[1]}; filtrando después del top-{k} recibiría {peor[2]}")


def check_prompt() -> str:
    b = modulo("buscar")
    idx = indice()
    diego, ajeno, propio = f"diego.luna{D}", "drive:d04#000", "drive:d10#000"
    exige(ajeno in idx["chunks"] and propio in idx["chunks"], "faltan drive:d04 y drive:d10 en el índice")
    falso = {"chunk_id": ajeno, "doc_id": "drive:d04", "titulo": "Sueldos 2026.pdf", "texto": idx["chunks"][ajeno]["texto"],
             "acl": [["domain:marketplace.test"]], "puntaje": 9}
    bueno = {"chunk_id": propio, "doc_id": "drive:d10", "titulo": "Código de conducta.pdf", "texto": idx["chunks"][propio]["texto"],
             "acl": idx["chunks"][propio]["acl"], "puntaje": 1}
    r = llamar(b.contexto, [falso, bueno, {"chunk_id": "wiki:9999#000", "texto": "inventado", "acl": [["domain:marketplace.test"]]}], diego)
    exige(isinstance(r, dict) and {"texto", "fuentes", "descartados"} <= set(r), "contexto() devuelve {texto, fuentes, descartados}")
    exige(ajeno in r["descartados"] and "26,000" not in r["texto"],
          "a contexto() le llegó «Sueldos 2026» para diego.luna con una ACL falsa de todo el dominio y lo dejó pasar: la ACL que manda es la del índice")
    exige("wiki:9999#000" in r["descartados"], "un chunk que no está en el índice no entra al prompt")
    exige(r["fuentes"] == [propio] and r["texto"].startswith(f"[1] {propio}\n"), f"el texto va «[1] {propio}» y en la línea siguiente el texto del chunk")
    return "el último filtro antes del prompt revisa cada chunk contra la ACL del índice: «Sueldos 2026» con una ACL falsa no pasa"


def check_fuga() -> str:
    b = modulo("buscar")
    idx = indice()
    por_acl = {}
    for d, x in idx["docs"].items():
        por_acl.setdefault(repr(x["acl"]), x)
    preguntas = PREGUNTAS + [idx["chunks"][x["chunks"][0]]["texto"].split("\n")[0] for x in por_acl.values()]
    n = 0
    for p in ref.personas():
        ok = ref.permitidos(p)
        vis = llamar(b.visibles, p)
        ajenos = vis - ok
        exige(not ajenos, f"{corto('user:' + p)} puede ver {len(ajenos)} chunk(s) que no debe a las {hora(ref.ahora())}: {lista(ajenos)}")
        for q in preguntas:
            rs = llamar(b.buscar, q, p)
            c = llamar(b.contexto, rs, p)
            fuera = [i for i in c["fuentes"] if i not in ok]
            exige(not fuera, f"{corto('user:' + p)} pregunta «{q}» y al prompt llega {lista(fuera)}, que no puede ver")
            n += 1
    diego = f"diego.luna{D}"
    return (f"{len(ref.personas())} personas × {len(preguntas)} preguntas (una por cada ACL distinta del índice, más las de filtro) = {n} búsquedas · "
            f"0 chunks ajenos en el top-k ni en el prompt · diego.luna ve {len(llamar(b.visibles, diego))} de {len(idx['chunks'])}")


def check_acceso() -> str:
    b = modulo("buscar")
    idx = indice()
    for p in ref.personas():
        ok = ref.permitidos(p) & set(idx["chunks"])
        vis = llamar(b.visibles, p)
        faltan = ok - vis
        exige(not faltan, f"{corto('user:' + p)} debería poder ver {len(ok)} chunks y tu índice le deja ver {len(vis & ok)}: le faltan {lista(faltan)}"
              + (" (¿se resuelven los grupos que están dentro de otros grupos?)" if len(faltan) > 5 else ""))
    tam = sorted((len(ref.permitidos(p)), corto("user:" + p)) for p in ref.personas())
    return f"cada persona ve justo lo que le toca, ni más ni menos: de {tam[0][0]} chunks ({tam[0][1]}) a {tam[-1][0]} ({tam[-1][1]})"


def check_revocacion() -> str:
    r = leer_json(ALMACEN / "manana.json")
    exige(r is not None and mundo()["reloj"] == FIN, "falta pasar la mañana: python mundo/avanzar.py (paso 8)")
    cada = config()["revocacion"]["cada_segundos"]
    exige(r["cada_segundos"] == max(1, int(cada)), f"config.yaml cambió desde la última mañana (cada_segundos {r['cada_segundos']} → {cada}): python mundo/avanzar.py")
    revs = [e for e in r["eventos"] if e["perdieron"]]
    for e in revs:
        exige(e["exposicion"] <= SLO, f"la revocación de las {hora(e['ocurrio'])} ({e['que']}) se aplicó en {dur(e['exposicion'])}: en C11 son ≤ 5 min")
        if e["reaparece"]:
            raise Falla(f"la revocación de las {hora(e['ocurrio'])} se aplicó y después se deshizo: {corto('user:' + e['reaparece'][0][0])} "
              f"volvió a ver {e['reaparece'][0][1]} (¿el reindexado de las 10:00 respeta lo del carril rápido?)")
    for e in r["eventos"]:
        if e["ganaron"]:
            if not e["aplicado"]:
                raise Falla(f"el alta de las {hora(e['ocurrio'])} nunca se aplicó: {corto('user:' + e['ganaron'][0][0])} sigue sin ver {e['ganaron'][0][1]}")
    if r["otras_fugas"]:
        raise Falla(f"durante la mañana hubo fugas que no vienen de ninguna revocación: {corto('user:' + r['otras_fugas'][0]['persona'])} "
          f"vio {r['otras_fugas'][0]['doc_id']} {dur(r['otras_fugas'][0]['segundos'])}")
    bit = {x["n"]: x for x in (__import__("json").loads(l) for l in (INDICE / "revocaciones.jsonl").read_text().splitlines() if l.strip())} \
        if (INDICE / "revocaciones.jsonl").exists() else {}
    for e in ref.eventos():
        x = bit.get(e["n"])
        exige(x, f"indice/revocaciones.jsonl no anota el evento {e['n']} ({e['tipo']}): cada evento aplicado deja su línea")
        bien = len(ref.docs()[e["doc_id"]]["chunks"]) if e["tipo"] == "acl" else 0
        exige(x.get("chunks") == bien, f"el evento {e['n']} ({e['tipo']}) tenía que reescribir {bien} chunk(s) y anotó {x.get('chunks')}"
              + (": un cambio de grupo no toca ningún chunk, solo la copia del directorio" if e["tipo"] == "membresia" else ""))
    peor = max(revs, key=lambda e: e["exposicion"])
    tocados = sum(x["chunks"] for x in bit.values())
    return (f"{len(r['eventos'])} cambios de permisos: {len(revs)} revocaciones, la peor aplicada en {dur(peor['exposicion'])} (las {hora(peor['ocurrio'])}), "
            f"y {len(r['eventos']) - len(revs)} alta · el reindexado de las 10:00 no deshizo ninguna · el carril reescribió {tocados} chunks, sin volver a indexar")


CHECKS = {
    "mundo": check_mundo, "principals": check_principals, "permisos": check_permisos, "indice": check_indice, "filtro": check_filtro,
    "prompt": check_prompt, "fuga": check_fuga, "acceso": check_acceso, "revocacion": check_revocacion,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except SystemExit as e:
            ok, msg = False, str(e.code)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<11} {msg}", flush=True)
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
