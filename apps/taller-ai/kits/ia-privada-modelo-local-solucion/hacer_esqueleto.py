"""Escribe el esqueleto de pipeline/llm.py (kits/ia-privada-modelo-local/mundo/esqueleto/pipeline/llm.py) a partir de
esta solución: el contrato, los imports, los errores, Respuesta y Cliente.__init__ vienen enteros; cada método público
queda con su firma y `raise NotImplementedError`. Así el contrato del esqueleto y la solución no se desfasan.

    python3 hacer_esqueleto.py
"""
import ast
from pathlib import Path

SOL = Path(__file__).resolve().parent / "pipeline" / "llm.py"
ESQ = Path(__file__).resolve().parent.parent / "ia-privada-modelo-local" / "mundo" / "esqueleto" / "pipeline" / "llm.py"
PASO = {"modelos": 3, "contar_tokens": 3, "chat": 3, "chat_stream": 4, "chat_json": 6}
src = SOL.read_text()
lin = src.splitlines()
out = []
for n in ast.parse(src).body:
    seg = ast.get_source_segment(src, n)
    if isinstance(n, ast.ClassDef) and n.name == "Cliente":
        partes = [lin[n.lineno - 1]]
        for f in n.body:
            if not isinstance(f, ast.FunctionDef):
                continue
            if f.name == "__init__":
                partes.append(ast.get_source_segment(src, f, padded=True))
            elif not f.name.startswith("_"):
                firma = lin[f.lineno - 1:f.body[0].lineno - 1]
                partes.append("\n" + "\n".join(firma) + f'\n        raise NotImplementedError("paso {PASO[f.name]}: Cliente.{f.name}")')
        out.append("\n\n" + "\n".join(partes))
    elif isinstance(n, ast.Expr):
        out.append(seg + "\n")
    else:
        deco = "".join(f"@{ast.get_source_segment(src, d)}\n" for d in getattr(n, "decorator_list", []))
        out.append(("\n\n" if isinstance(n, (ast.ClassDef, ast.FunctionDef)) else "") + deco + seg)
texto = "\n".join(out).replace("\n\n\n\n", "\n\n\n").rstrip() + "\n"
compile(texto, "llm.py", "exec")
ESQ.write_text(texto)
print(f"esqueleto/pipeline/llm.py: {len(texto.splitlines())} líneas")
