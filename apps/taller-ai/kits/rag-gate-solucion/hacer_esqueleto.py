"""Escribe el esqueleto del kit (kits/rag-gate/mundo/esqueleto/pipeline/) a partir de esta solución:
el docstring de cada archivo (su contrato), sus imports, sus constantes públicas y la firma de cada función pública,
con el cuerpo cambiado por `raise NotImplementedError`. Así el contrato del esqueleto y la solución no se desfasan.

    python3 hacer_esqueleto.py
"""
import ast
from pathlib import Path

SOL = Path(__file__).resolve().parent / "pipeline"
ESQ = Path(__file__).resolve().parent.parent / "rag-gate" / "mundo" / "esqueleto" / "pipeline"
PASO = {"correr.py": 1, "metricas.py": 2, "juez.py": 3, "gate.py": 4}
PASO_FN = {}
ENTERAS = {"metricas.py": ("texto",), "gate.py": ("texto",)}   # vienen dadas: cómo se imprime un resumen y una decisión
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
                out.append("\n" + seg)
        elif isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in ENTERAS.get(rel, ()):
            desde = n.decorator_list[0].lineno if n.decorator_list else n.lineno
            out.append("\n\n" + "\n".join(src.splitlines()[desde - 1:n.end_lineno]))
        elif isinstance(n, ast.FunctionDef) and not n.name.startswith("_"):
            firma = src.splitlines()[n.lineno - 1:n.body[0].lineno - 1]
            doc = ast.get_docstring(n)
            cuerpo = (f'    """{doc}"""\n' if doc else "") + f'    raise NotImplementedError("paso {PASO_FN.get(n.name, paso)}: {n.name}")'
            out.append("\n\n" + "\n".join(l for l in firma if not l.strip().startswith('"""')) + "\n" + cuerpo)
        elif isinstance(n, ast.ClassDef) and n.name.startswith("_"):                              # viene dada
            out.append("\n\n" + seg)
        elif isinstance(n, ast.ClassDef) and not n.body[1:] and isinstance(n.body[0], ast.Pass):   # una excepción
            out.append("\n\n" + seg)
        elif isinstance(n, ast.ClassDef):
            lineas = [src.splitlines()[n.lineno - 1]]
            doc = ast.get_docstring(n)
            if doc:
                lineas.append(f'    """{doc}"""')
            for f in n.body:
                if isinstance(f, ast.FunctionDef):
                    firma = src.splitlines()[f.lineno - 1:f.body[0].lineno - 1]
                    lineas.append("")
                    lineas += [l for l in firma if not l.strip().startswith('"""')]
                    lineas.append(f'        raise NotImplementedError("paso {PASO_FN.get(f.name, paso)}: {n.name}.{f.name}")')
            out.append("\n\n" + "\n".join(lineas))
        elif isinstance(n, ast.If):                                                  # if __name__ == "__main__"
            out.append("\n\n" + seg)
    texto = "\n".join(out).replace("\n\n\n\n", "\n\n\n").rstrip() + "\n"
    (ESQ / rel).parent.mkdir(parents=True, exist_ok=True)
    (ESQ / rel).write_text(texto)
    compile(texto, rel, "exec")
    print(f"esqueleto/{rel}: {len(texto.splitlines())} líneas")

