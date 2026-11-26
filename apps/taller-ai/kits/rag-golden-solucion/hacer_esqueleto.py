"""Escribe el esqueleto del kit (kits/rag-golden/mundo/esqueleto/pipeline/) a partir de esta solución:
el docstring de cada archivo (su contrato), sus imports, sus constantes públicas y la firma de cada función pública,
con el cuerpo cambiado por `raise NotImplementedError`. Así el contrato del esqueleto y la solución no se desfasan.

    python3 hacer_esqueleto.py
"""
import ast
from pathlib import Path

SOL = Path(__file__).resolve().parent / "pipeline"
ESQ = Path(__file__).resolve().parent.parent / "rag-golden" / "mundo" / "esqueleto" / "pipeline"
PASO = {"esquema.py": 1, "parecidas.py": 3, "splits.py": 4, "contaminacion.py": 5, "publicar.py": 6, "armar.py": 6, "reanclar.py": 7}
PASO_FN = {"reglas": 2}
ENTERAS = {"publicar.py": ("versiones", "siguiente", "vigente"), "armar.py": ("candidatas",)}   # vienen dadas
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
        elif isinstance(n, ast.FunctionDef) and n.name in ENTERAS.get(rel, ()):
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

# el esquema: solo el principio; lo escribes tú en el paso 1
(ESQ.parent / "esquema").mkdir(parents=True, exist_ok=True)
(ESQ.parent / "esquema" / "candidata.schema.json").write_text(
    '{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "title": "Pregunta candidata para el golden set",\n'
    '  "description": "Paso 1: lo que tiene que traer una candidata. Mira el contrato de pipeline/esquema.py y GUION.md.",\n'
    '  "type": "object"\n}\n')
print("esqueleto/esquema/candidata.schema.json: el principio")
