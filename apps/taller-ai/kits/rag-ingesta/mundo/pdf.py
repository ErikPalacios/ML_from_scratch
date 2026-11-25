"""Un escritor de PDF mínimo, sin dependencias, para los documentos de ejemplo del mundo.

Escribe PDFs de verdad (PDF 1.4) con texto en Helvetica y codificación WinAnsi, así que los acentos y la ñ
salen bien al extraer el texto. Cada página trae su encabezado y su pie, como un PDF exportado de verdad.
Con escaneado=True no escribe texto: dibuja rectángulos grises donde irían las líneas, como una hoja escaneada
sin capa de texto (sin OCR no hay nada que extraer).
"""
from __future__ import annotations


def _esc(s: str) -> bytes:
    b = s.encode("cp1252")
    return b.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _envolver(linea: str, ancho: int = 88) -> list[str]:
    if len(linea) <= ancho:
        return [linea]
    out, actual = [], ""
    for p in linea.split(" "):
        if len(actual) + len(p) + 1 > ancho:
            out.append(actual)
            actual = p
        else:
            actual = f"{actual} {p}".strip()
    return out + [actual]


def escribir(paginas: list[list[str]], encabezado: str, pie: str, titulo: str, escaneado: bool = False,
             fecha: str = "D:20260901000000Z") -> bytes:
    """paginas: cada una, una lista de líneas. Una línea que empieza con «# » sale como título (más grande).
    pie puede llevar {n} y {total}. fecha fija: el mismo contenido da los mismos bytes (y el mismo hash)."""
    objs: list[bytes] = []
    total = len(paginas)
    kids = []
    for i, lineas in enumerate(paginas, 1):
        ops = []
        if escaneado:
            y = 760
            for l in lineas:
                for parte in _envolver(l.lstrip("# ")):
                    ops.append(f"0.75 g 56 {y - 2} {min(500, 5.6 * len(parte)):.0f} 9 re f".encode())
                    y -= 16
        else:
            ops.append(b"BT /F1 8 Tf 56 806 Td (" + _esc(encabezado) + b") Tj ET")
            y = 770
            for l in lineas:
                grande = l.startswith("# ")
                for parte in _envolver(l[2:] if grande else l):
                    ops.append(b"BT /F1 " + (b"14" if grande else b"10") + f" Tf 56 {y} Td (".encode() + _esc(parte) + b") Tj ET")
                    y -= 22 if grande else 15
            ops.append(b"BT /F1 8 Tf 56 30 Td (" + _esc(pie.format(n=i, total=total)) + b") Tj ET")
        contenido = b"\n".join(ops)
        c_id = 4 + 2 * (i - 1)        # 1 catálogo, 2 páginas, 3 fuente; luego contenido y página de cada hoja
        objs.append(b"<< /Length %d >>\nstream\n" % len(contenido) + contenido + b"\nendstream")
        objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % c_id)
        kids.append(c_id + 1)
    base = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % total,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    todos = base + objs
    info = len(todos) + 1
    todos.append(b"<< /Title (" + _esc(titulo) + b") /Producer (Dojo TrueML) /CreationDate (" + fecha.encode() + b") >>")
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offs = []
    for n, o in enumerate(todos, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % n + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(todos) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(todos) + 1, info, xref)
    return bytes(out)
