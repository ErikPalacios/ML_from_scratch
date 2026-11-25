"""Escribe el esqueleto del kit (kits/rag-ingesta/mundo/esqueleto/pipeline/) a partir de esta solución:
el docstring de cada archivo (su contrato), sus imports, sus constantes públicas y la firma de cada función pública,
con el cuerpo cambiado por `raise NotImplementedError`. Así el contrato del esqueleto y la solución no se desfasan.

    python3 hacer_esqueleto.py
"""
import ast
from pathlib import Path

SOL = Path(__file__).resolve().parent / "pipeline"
ESQ = Path(__file__).resolve().parent.parent / "rag-ingesta" / "mundo" / "esqueleto" / "pipeline"
PASO = {"conectores/http.py": 1, "conectores/wiki.py": 2, "conectores/drive.py": 3, "conectores/jira.py": 4, "conectores/politicas.py": 4,
        "parsing.py": 5, "almacen.py": 6, "ingestar.py": 7}
PASO_FN = {"barrido": 8}
ENTERAS = {"ingestar.py": ("main",)}   # la línea de comandos y el resumen vienen dados: tú escribes procesar, incremental y barrido

for rel, paso in PASO.items():
    src = (SOL / rel).read_text()
    arbol = ast.parse(src)
    out = []
    for n in arbol.body:
        seg = ast.get_source_segment(src, n)
        if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant):          # el contrato
            out.append(seg + "\n")
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            out.append(seg)
        elif isinstance(n, (ast.Assign, ast.AnnAssign)):
            nombre = (n.targets[0] if isinstance(n, ast.Assign) else n.target).id
            if not nombre.startswith("_"):
                out.append("\n" + seg if not out[-1].startswith(("FUENTE", "TIPOS", "PARSER", "LLAMADAS", "ESPERAS", "CONECTORES", "CUENTAS")) else seg)
        elif isinstance(n, ast.FunctionDef) and n.name in ENTERAS.get(rel, ()):         # viene dada: entera
            out.append("\n\n" + seg)
        elif isinstance(n, ast.FunctionDef) and not n.name.startswith("_"):
            firma = src.splitlines()[n.lineno - 1:n.body[0].lineno - 1]
            doc = ast.get_docstring(n)
            cuerpo = (f'    """{doc}"""\n' if doc else "") + f'    raise NotImplementedError("paso {PASO_FN.get(n.name, paso)}: {n.name}")'
            out.append("\n\n" + "\n".join(l for l in firma if not l.strip().startswith('"""')) + "\n" + cuerpo)
        elif isinstance(n, ast.If):                                                  # if __name__ == "__main__"
            out.append("\n\n" + seg)
    texto = "\n".join(out).replace("\n\n\n\n", "\n\n\n").rstrip() + "\n"
    (ESQ / rel).parent.mkdir(parents=True, exist_ok=True)
    (ESQ / rel).write_text(texto)
    compile(texto, rel, "exec")
    print(f"esqueleto/{rel}: {len(texto.splitlines())} líneas")
(ESQ / "conectores" / "__init__.py").write_text((SOL / "conectores" / "__init__.py").read_text())
