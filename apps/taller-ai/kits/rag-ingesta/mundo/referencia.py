"""La verdad del mundo, sin pasar por la API: qué documentos ve la cuenta del conector, con qué versión, qué ACL
y qué bytes. La usa verificar.py para comparar contra tu catálogo. No la leas para resolver un paso: es la
respuesta del equipo.
"""
from __future__ import annotations

import json

from mundo.comun import FUENTES, ancestros, blob_sha, drive_visible, jira_fecha, sha256, utc, wiki_visible


def _wiki(e):
    out = {}
    for pid, p in e["wiki"]["paginas"].items():
        if not wiki_visible(e, pid):
            continue
        cl = [sorted(set(e["wiki"]["espacios"][p["espacio"]]["leer"]))]
        for x in ancestros(e, pid) + [pid]:
            r = e["wiki"]["paginas"][x]["restricciones"]
            if r["grupos"] or r["usuarios"]:
                cl.append(sorted(set(r["grupos"] + r["usuarios"])))
        out[f"wiki:{pid}"] = {"version": str(p["version"]), "titulo": p["titulo"], "acl": cl, "crudo": p["cuerpo"].encode()}
    return out


def acl_drive(f, dominio, link_compartido="ignorar"):
    s = set()
    for p in f["permissions"]:
        if p["type"] in ("user", "group"):
            s.add(f"{p['type']}:{p['emailAddress']}")
        elif p.get("allowFileDiscovery") or link_compartido == "dominio":
            s.add(f"domain:{dominio}")
    return [sorted(s)]


def _drive(e):
    out = {}
    for fid, f in e["drive"]["archivos"].items():
        if drive_visible(e, fid) and not f["trashed"]:
            out[f"drive:{fid}"] = {"version": str(f["version"]), "titulo": f["name"], "acl": acl_drive(f, e["dominio"]),
                                   "crudo": (FUENTES / f["bytes"]).read_bytes(), "ocr": f["name"].endswith("(escaneo).pdf")}
    return out


def ticket_json(e, t) -> bytes:
    """Los bytes que deja traer() de jira: el JSON del ticket, como lo devuelve la API, con sort_keys."""
    from mundo.fuentes import campos_jira

    return json.dumps({"key": t["key"], "fields": campos_jira(e, t, True)}, sort_keys=True, ensure_ascii=False).encode()


def _jira(e):
    out = {}
    for k, t in e["jira"]["tickets"].items():
        if t.get("borrado"):
            continue
        ver = {f"user:{t['reportero']}" if p == "reportero" else p for p in e["jira"]["proyectos"][t["proyecto"]]["ver"]}
        cl = [sorted(ver)] + ([sorted(set(e["jira"]["niveles"][t["nivel"]]["miembros"]))] if t["nivel"] else [])
        out[f"jira:{k}"] = {"version": jira_fecha(utc(t["actualizado"])), "titulo": t["titulo"], "acl": cl, "crudo": ticket_json(e, t)}
    return out


def _politicas(e):
    leer = sorted(set(e["politicas"]["leer"]))
    return {f"politicas:{r}": {"version": blob_sha(t.encode()), "titulo": r, "acl": [leer], "crudo": t.encode()}
            for r, t in e["politicas"]["archivos"].items()}


def esperado(e) -> dict:
    """doc_id → {version, titulo, acl, crudo (bytes), hash}: lo que debería estar vivo en tu catálogo hoy."""
    out = _wiki(e) | _drive(e) | _jira(e) | _politicas(e)
    for v in out.values():
        v["hash"] = sha256(v["crudo"])
    return out
