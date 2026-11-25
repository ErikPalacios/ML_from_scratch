"""Crea el mundo: las cuatro fuentes de documentos del marketplace, como estaban el 20 de noviembre a las 9:00
de Ciudad de México (15:00 UTC). Siempre crea lo mismo: no descarga nada y no usa azar.

    python mundo/crear.py

Escribe fuentes/estado.json (la wiki, el Drive, el Jira y el repositorio de políticas, con sus permisos y sus
tokens) y fuentes/drive/ (los bytes de cada archivo). Si ya existía, lo reemplaza: tu almacen/ no lo toca.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo import documentos as doc  # noqa: E402
from mundo import pdf  # noqa: E402
from mundo.comun import CONECTOR, DOMINIO, FUENTES, blob_sha, guardar  # noqa: E402

RELOJ = "2026-11-20T15:00:00Z"
TOKENS = {"wiki": "wiki-dojo-7f3a", "drive": "drive-dojo-2c91", "jira": "jira-dojo-b604", "politicas": "repo-dojo-55de"}
MIME = {"pdf": "application/pdf", "escaneado": "application/pdf", "markdown": "text/markdown"}


def bytes_archivo(tipo: str, nombre: str, contenido) -> bytes:
    if tipo == "markdown":
        return contenido.encode()
    titulo = nombre.removesuffix(".pdf")
    return pdf.escribir(contenido, encabezado=f"Marketplace · {titulo}", pie="Uso interno · Página {n} de {total}",
                        titulo=titulo, escaneado=tipo == "escaneado")


def guardar_bytes(fid: str, version: int, b: bytes) -> str:
    rel = f"drive/{fid}-v{version}.bin"
    (FUENTES / rel).write_bytes(b)
    return rel


def commit_politicas(archivos: dict, padre: str | None) -> str:
    """El id del commit: un sha1 del árbol y del padre (como git, en chico)."""
    arbol = "\n".join(f"{r} {blob_sha(t.encode())}" for r, t in sorted(archivos.items()))
    return blob_sha(f"tree\n{arbol}\nparent {padre}".encode())


def crear() -> dict:
    shutil.rmtree(FUENTES, ignore_errors=True)
    (FUENTES / "drive").mkdir(parents=True)
    e = {"reloj": RELOJ, "dia": 1, "tokens": dict(TOKENS), "acceso": {"drive_compartida": True}, "limite_wiki": 10,
         "conector": CONECTOR, "dominio": DOMINIO}
    paginas = {}
    for pid, esp, padre, titulo, autor, fecha, bloques, restr in doc.PAGINAS:
        paginas[pid] = {"id": pid, "espacio": esp, "padre": padre, "titulo": titulo, "autor": f"{autor}@{DOMINIO}",
                        "version": 1 + int(pid) % 3, "actualizado": fecha, "cuerpo": doc.html_pagina(esp, titulo, autor, bloques),
                        "restricciones": restr or {"grupos": [], "usuarios": []}}
    e["wiki"] = {"espacios": doc.ESPACIOS, "paginas": paginas}

    archivos, cambios = {}, []
    for fid, nombre, tipo, unidad, duenio, fecha, permisos, contenido in doc.ARCHIVOS:
        b = bytes_archivo(tipo, nombre, contenido)
        archivos[fid] = {"id": fid, "name": nombre, "mimeType": MIME[tipo], "unidad": unidad, "modifiedTime": fecha,
                         "version": 1, "trashed": False, "bytes": guardar_bytes(fid, 1, b),
                         "permissions": [{"type": "user", "emailAddress": f"{duenio}@{DOMINIO}", "role": "owner"}] + permisos}
        cambios.append({"fileId": fid, "time": fecha})
    cambios.sort(key=lambda c: c["time"])
    e["drive"] = {"archivos": archivos, "cambios": cambios}

    e["jira"] = {"proyectos": doc.PROYECTOS, "niveles": doc.NIVELES, "tickets": {t["key"]: t for t in doc.TICKETS}}
    e["politicas"] = {"archivos": dict(doc.POLITICAS), "commit": commit_politicas(doc.POLITICAS, None),
                      "leer": [f"group:soporte@{DOMINIO}", f"group:operaciones@{DOMINIO}"]}
    guardar(e)
    return e


def resumen(e: dict) -> str:
    w = len(e["wiki"]["paginas"])
    d = len(e["drive"]["archivos"])
    j = len(e["jira"]["tickets"])
    p = len(e["politicas"]["archivos"])
    return f"wiki {w} páginas en {len(e['wiki']['espacios'])} espacios · drive {d} archivos · jira {j} tickets · políticas {p} archivos · {w + d + j + p} documentos"


if __name__ == "__main__":
    e = crear()
    print(f"✓ mundo creado al {e['reloj']}: {resumen(e)}")
    print("  siguiente: python mundo/fuentes.py arrancar")
