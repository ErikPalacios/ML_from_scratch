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


def html_a_texto(html: str) -> str:
    raise NotImplementedError("paso 5: html_a_texto")


def pdf_a_texto(crudo: bytes) -> tuple[str, bool]:
    raise NotImplementedError("paso 5: pdf_a_texto")


def ticket_a_texto(crudo: bytes) -> str:
    raise NotImplementedError("paso 5: ticket_a_texto")


def parsear(doc: dict) -> dict:
    raise NotImplementedError("paso 5: parsear")
