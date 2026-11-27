"""Escribe el esqueleto de pipeline/ (kits/ia-privada-cuantizacion/mundo/esqueleto/pipeline/) a partir de esta
solución: el contrato, los imports, las constantes y la firma de cada función pública con `raise NotImplementedError`.
El bloque `if __name__ == "__main__"` viene entero (es lo que corre cada paso). reporte.py viene dado, completo.

    python3 hacer_esqueleto.py
"""
import ast
import shutil
from pathlib import Path

SOL = Path(__file__).resolve().parent / "pipeline"
ESQ = Path(__file__).resolve().parent.parent / "ia-privada-cuantizacion" / "mundo" / "esqueleto" / "pipeline"
PASO = {"cuantizar.py": 1, "medir.py": 2, "calidad.py": 4}
PASO_FN = {"medir": 3, "examen": 5}
ESQ.mkdir(parents=True, exist_ok=True)
for rel, paso in PASO.items():
    src = (SOL / rel).read_text()
    lin = src.splitlines()
    out = []
    for n in ast.parse(src).body:
        seg = ast.get_source_segment(src, n)
        if isinstance(n, ast.Expr):
            out.append(seg + "\n")
        elif isinstance(n, (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign)):
            out.append(seg)
        elif isinstance(n, ast.FunctionDef) and n.name.startswith("_") is False and n.name != "destino":
            firma = lin[n.lineno - 1:n.body[0].lineno - 1]
            out.append("\n\n" + "\n".join(firma) + f'\n    raise NotImplementedError("paso {PASO_FN.get(n.name, paso)}: {n.name}")')
        elif isinstance(n, ast.FunctionDef):
            out.append("\n\n" + seg)
        elif isinstance(n, ast.If):
            out.append("\n\n" + seg)
    texto = "\n".join(out).replace("\n\n\n\n", "\n\n\n").rstrip() + "\n"
    compile(texto, rel, "exec")
    (ESQ / rel).write_text(texto)
    print(f"esqueleto/pipeline/{rel}: {len(texto.splitlines())} líneas")
shutil.copy(SOL / "reporte.py", ESQ / "reporte.py")
