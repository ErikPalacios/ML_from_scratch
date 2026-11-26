"""Paso 6 · Armar una versión del golden set con las candidatas de los expertos, y publicarla si cambió algo.

    python pipeline/armar.py

Contrato:
- traducir(fuentes, desde, anclas, hasta) -> (fuentes_nuevas, problema). Lleva los chunk_id de una pregunta escrita
  con el corpus `desde` al corpus `hasta`, siguiendo los pasos de anclas (golden/anclas.json, {"pasos": [{"de", "a",
  "chunks": {chunk_id_viejo: {"a": chunk_id_nuevo o None, "por": "sha" | "contenido" | "cambio" | "borrado"}}}]}),
  uno tras otro. Un chunk que no está en el mapa se queda como está (si no existía, reglas() lo dirá). Si un paso dice
  "borrado": problema "retirada: el documento de <chunk> ya no existe en <corpus>"; si dice "cambio": problema
  "revisar: el texto de <chunk> cambió en <corpus>: un experto revisa la respuesta". Sin repetidos, en orden.
  Si no hay pasos para llegar de `desde` a `hasta`, problema "no hay anclas de <desde> a <hasta>".
- main() -> la versión publicada, o None si no cambió nada. En orden:
  1. lee las candidatas (cada almacen/candidatos/*.jsonl, por nombre de archivo y en su orden), el corpus vigente,
     el directorio, los ejemplos de afinado, config.yaml y lo publicado (splits de todas las versiones, la vigente y
     sus quemadas);
  2. si alguna candidata viene de un corpus del que no hay anclas hasta el vigente, se detiene (SystemExit):
     «el corpus cambió de X a Y: python pipeline/reanclar.py»;
  3. por cada candidata: estructura(); id repetido (gana la primera); quemada (nunca vuelve); traducir(); reglas().
     La que falla va a rechazadas con {"id", "motivo", "detalle"};
  4. asigna splits (asignar(), con los de antes congelados); quita las casi iguales (quitar(), las ya publicadas
     ganan); y quema las de test que se parecen a un ejemplo de afinado (contaminadas()): salen y no vuelven;
  5. revisa las cuotas de config.yaml (fracción de cada tipo sobre el total): si falta, no publica (SystemExit);
  6. arma cada item como {"id", "pregunta", "respuesta", "tipo", "persona", "split", "origen", "autor",
     "fuentes": [{"chunk_id", "doc_id", "sha"}]} (sha = sha_texto() del texto del chunk) y, si es distinto de la
     vigente, publica con publicar() y meta {"corpus", "directorio", "quemadas", "config", "motivo"}.
"""
from __future__ import annotations

from _comun import AFINADO, ANCLAS, CANDIDATOS, GOLDEN, config, corpus, directorio, leer_json, leer_jsonl, sha_texto
from contaminacion import contaminadas
from esquema import estructura, reglas
from parecidas import quitar
from publicar import publicar, versiones, vigente
from splits import asignar

TIPOS = ("directa", "varias", "sin_respuesta", "prohibida")


def traducir(fuentes: list[str], desde: str, anclas: dict, hasta: str) -> tuple[list[str], str | None]:
    fs = list(fuentes)
    v = desde
    while v != hasta:
        paso = next((p for p in anclas.get("pasos", []) if p["de"] == v), None)
        if paso is None:
            return fs, f"no hay anclas de {v} a {hasta}"
        nuevas = []
        for f in fs:
            m = paso["chunks"].get(f)
            if m is None:
                nuevas.append(f)
            elif m["por"] == "borrado":
                return fs, f"retirada: el documento de {f} ya no existe en {paso['a']}"
            elif m["por"] == "cambio":
                return fs, f"revisar: el texto de {f} cambió en {paso['a']}: un experto revisa la respuesta"
            else:
                nuevas.append(m["a"])
        fs = list(dict.fromkeys(nuevas))
        v = paso["a"]
    return fs, None


def candidatas() -> list[dict]:
    return [x for p in sorted(CANDIDATOS.glob("*.jsonl")) for x in leer_jsonl(p)]


def main(motivo: str = "candidatas") -> str | None:
    cfg, c, d = config(), corpus(), directorio()
    anclas = leer_json(ANCLAS, {"pasos": []})
    ejemplos = leer_jsonl(AFINADO)
    xs = candidatas()
    for v in sorted({x.get("corpus") for x in xs if isinstance(x.get("corpus"), str)}):
        if traducir([], v, anclas, c["version"])[1]:
            raise SystemExit(f"✗ el corpus cambió de {v} a {c['version']} y no hay anclas: python pipeline/reanclar.py")
    vig = vigente()
    vig_items = leer_jsonl(GOLDEN / vig / "preguntas.jsonl") if vig else []
    man = leer_json(GOLDEN / vig / "manifiesto.json", {}) if vig else {}
    quemadas = set(man.get("quemadas", []))
    antes = {x["id"]: x["split"] for v in versiones() for x in leer_jsonl(GOLDEN / v["version"] / "preguntas.jsonl")}

    rechazadas, ok, vistos = [], [], set()

    def rechazar(x, motivo_, detalle):
        rechazadas.append({"id": x.get("id") if isinstance(x, dict) else None, "motivo": motivo_, "detalle": detalle})

    for x in xs:
        e = estructura(x)
        if e:
            rechazar(x, "esquema", e)
            continue
        if x["id"] in vistos:
            rechazar(x, "id repetido", [f"{x['id']} ya lo usa otra candidata: gana la primera"])
            continue
        vistos.add(x["id"])
        if x["id"] in quemadas:
            rechazar(x, "quemada", [f"{x['id']} se usó para afinar: no vuelve a test ni a dev"])
            continue
        fs, problema = traducir(x["fuentes"], x["corpus"], anclas, c["version"])
        if problema:
            rechazar(x, problema.split(":")[0], [problema])
            continue
        y = dict(x, fuentes=fs)
        e = reglas(y, c, d)
        if e:
            rechazar(x, "reglas", e)
            continue
        ok.append(y)

    s = cfg["splits"]
    sp = asignar([y["id"] for y in ok], antes, s["sal"], s["test"])
    for y in ok:
        y["split"] = sp[y["id"]]
    u = cfg["parecidas"]["umbral"]
    ok, quitadas = quitar(ok, u, publicados={x["id"] for x in vig_items})
    for i, j, sim in quitadas:
        rechazar({"id": i}, "casi igual", [f"se parece {sim:.2f} a {j}, que se queda"])
    sucias = contaminadas(ok, ejemplos, u)
    for i, e, sim in sucias:
        rechazar({"id": i}, "contaminada", [f"es de test y se parece {sim:.2f} al ejemplo {e} de afinado: se quema"])
    quemadas |= {i for i, _, _ in sucias}
    ok = [y for y in ok if y["id"] not in quemadas]

    n = len(ok)
    faltan = [f"{t}: {sum(y['tipo'] == t for y in ok)} de {n} ({sum(y['tipo'] == t for y in ok) / max(n, 1):.0%}) y la cuota es {q:.0%}"
              for t, q in cfg["cuotas"].items() if sum(y["tipo"] == t for y in ok) < q * n]
    if faltan:
        raise SystemExit("✗ no se publica: faltan preguntas de un tipo\n  " + "\n  ".join(faltan))

    items = [{"id": y["id"], "pregunta": y["pregunta"], "respuesta": y["respuesta"], "tipo": y["tipo"], "persona": y["persona"],
              "split": y["split"], "origen": y["origen"], "autor": y["autor"],
              "fuentes": [{"chunk_id": f, "doc_id": c["chunks"][f]["doc_id"], "sha": sha_texto(c["chunks"][f]["texto"])} for f in y["fuentes"]]}
             for y in sorted(ok, key=lambda y: y["id"])]
    resumen = f"{len(xs)} candidatas → {n} preguntas · " + " · ".join(f"{t} {sum(y['tipo'] == t for y in items)}" for t in TIPOS) + \
              f" · test {sum(y['split'] == 'test' for y in items)}, dev {sum(y['split'] == 'dev' for y in items)} · {len(rechazadas)} rechazadas"
    if items == sorted(vig_items, key=lambda y: y["id"]):
        print(f"= {resumen}\n  igual que {vig}: no se publica nada")
        return None
    v = publicar(items, rechazadas, {"corpus": c["version"], "directorio": d["foto"], "quemadas": sorted(quemadas),
                                     "config": {"parecidas": cfg["parecidas"], "splits": s, "cuotas": cfg["cuotas"]}, "motivo": motivo})
    print(f"✓ {v} publicada: {resumen}")
    por = {}
    for r in rechazadas:
        por.setdefault(r["motivo"], []).append(r["id"])
    for m_, ids in por.items():
        print(f"  {m_}: {', '.join(str(i) for i in ids)}")
    return v


if __name__ == "__main__":
    main()
