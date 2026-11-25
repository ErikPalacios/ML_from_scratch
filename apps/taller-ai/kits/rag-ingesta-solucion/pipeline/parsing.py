"""Paso 5 · Del contenido crudo a texto limpio y con estructura, uno por tipo de documento.

Contrato:
- parsear(doc) -> {"texto": str, "necesita_ocr": bool}, según doc["tipo"]. Sube PARSER cuando cambies cómo se
  parsea: el almacén vuelve a parsear todo lo que se parseó con otra versión.
- "html" (la wiki): quita el menú (div.nav), el pie (div.pie) y las macros (ac:structured-macro). Cada título
  h1/h2/h3 sale como «# », «## », «### » + texto; cada párrafo, en su línea; cada ítem de lista, «- » + texto; cada
  fila de una tabla, como «Encabezado: valor; Encabezado: valor» (el encabezado es la primera fila, la de los th).
- "pdf": el texto de cada página con pypdf. Quita las líneas que se repiten en TODAS las páginas (encabezados y pies),
  comparándolas con los números cambiados por «#» (así «Página 1 de 2» y «Página 2 de 2» cuentan como la misma).
  Si al final quedan menos de 20 caracteres, el PDF no tiene capa de texto: texto "" y necesita_ocr True.
- "ticket" (JSON de Jira): «# <clave> · <summary>», la descripción sin la firma (desde la línea «--»), «Resolución: …»
  si tiene, y los comentarios que no son automáticos (los que empiezan con «[automático]») sin las líneas citadas
  (las que empiezan con «>») ni la línea «El … escribió:».
- "markdown": el texto tal cual, en UTF-8.
- Las líneas van unidas con "\n", sin espacios de sobra al final ni líneas vacías repetidas.
"""
from __future__ import annotations

import io
import json
import re

from bs4 import BeautifulSoup
from pypdf import PdfReader

PARSER = "v1"


def _limpio(lineas: list[str]) -> str:
    out = []
    for l in (x.rstrip() for x in lineas):
        if l or (out and out[-1]):
            out.append(l)
    return "\n".join(out).strip()


def html_a_texto(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for x in soup.select("div.nav, div.pie") + soup.find_all("ac:structured-macro"):
        x.decompose()
    lineas = []
    for el in soup.find_all(["h1", "h2", "h3", "p", "li", "table"]):
        if el.name in ("h1", "h2", "h3"):
            lineas += ["", "#" * int(el.name[1]) + " " + el.get_text(" ", strip=True)]
        elif el.name == "p" and not el.find_parent("table"):
            lineas.append(el.get_text(" ", strip=True))
        elif el.name == "li" and not el.find_parent("table"):
            lineas.append("- " + el.get_text(" ", strip=True))
        elif el.name == "table":
            filas = el.find_all("tr")
            enc = [c.get_text(" ", strip=True) for c in filas[0].find_all(["th", "td"])]
            for f in filas[1:]:
                celdas = [c.get_text(" ", strip=True) for c in f.find_all(["th", "td"])]
                lineas.append("; ".join(f"{h}: {v}" for h, v in zip(enc, celdas)))
    return _limpio(lineas)


def pdf_a_texto(crudo: bytes) -> tuple[str, bool]:
    paginas = [(p.extract_text() or "").splitlines() for p in PdfReader(io.BytesIO(crudo)).pages]
    forma = lambda l: re.sub(r"\d+", "#", l.strip())  # noqa: E731
    repetidas = set.intersection(*(set(map(forma, p)) for p in paginas)) if len(paginas) > 1 else set()
    texto = _limpio([l for p in paginas for l in p if forma(l) not in repetidas])
    return ("", True) if len(texto) < 20 else (texto, False)


def ticket_a_texto(crudo: bytes) -> str:
    t = json.loads(crudo)
    f = t["fields"]
    lineas = [f"# {t['key']} · {f['summary']}", ""]
    lineas += (f.get("description") or "").split("\n--\n")[0].splitlines()
    if f.get("resolution"):
        lineas += ["", f"Resolución: {f['resolution']}"]
    comentarios = [c for c in f["comment"]["comments"] if not c["body"].startswith("[automático]")]
    if comentarios:
        lineas += ["", "Comentarios:"]
        for c in comentarios:
            limpio = [l for l in c["body"].splitlines() if not l.startswith(">") and not re.match(r"^El .+ escribió:$", l)]
            lineas.append("- " + " ".join(l.strip() for l in limpio if l.strip()))
    return _limpio(lineas)


def parsear(doc: dict) -> dict:
    if doc["tipo"] == "html":
        return {"texto": html_a_texto(doc["crudo"].decode()), "necesita_ocr": False}
    if doc["tipo"] == "pdf":
        texto, ocr = pdf_a_texto(doc["crudo"])
        return {"texto": texto, "necesita_ocr": ocr}
    if doc["tipo"] == "ticket":
        return {"texto": ticket_a_texto(doc["crudo"]), "necesita_ocr": False}
    if doc["tipo"] == "markdown":
        return {"texto": _limpio(doc["crudo"].decode().splitlines()), "necesita_ocr": False}
    raise ValueError(f"tipo desconocido: {doc['tipo']}")
