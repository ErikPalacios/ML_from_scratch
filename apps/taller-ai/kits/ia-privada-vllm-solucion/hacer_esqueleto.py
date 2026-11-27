"""Escribe el esqueleto de la estación (kits/ia-privada-vllm/mundo/esqueleto/) a partir de esta solución: en
pipeline/carga.py y pipeline/reporte.py el contrato, los imports y lo de plomería vienen enteros; cada función que
escribe la persona queda con su firma y `raise NotImplementedError`. Los .env quedan con sus comentarios y sin valores.

    python3 hacer_esqueleto.py
"""
import ast
import re
from pathlib import Path

SOL = Path(__file__).resolve().parent
ESQ = SOL.parent / "ia-privada-vllm" / "mundo" / "esqueleto"
TUYAS = {"pipeline/carga.py": {"una": 4, "llegadas": 5, "cerrada": 4, "abierta": 5},
         "pipeline/reporte.py": {"percentil": 5, "intervalo": 5, "goodput": 5, "contra": 5}}

for rel, pasos in TUYAS.items():
    src = (SOL / rel).read_text()
    lin = src.splitlines()
    cortes = []
    for n in ast.parse(src).body:
        if isinstance(n, ast.FunctionDef) and n.name in pasos:
            cuerpo = n.body[0]
            ini = (n.body[1] if isinstance(cuerpo, ast.Expr) and isinstance(cuerpo.value, ast.Constant) and len(n.body) > 1 else cuerpo).lineno
            cortes.append((ini - 1, n.end_lineno, f'    raise NotImplementedError("paso {pasos[n.name]}: {n.name}")'))
    for ini, fin, nuevo in reversed(cortes):
        lin[ini:fin] = [nuevo]
    texto = "\n".join(lin).rstrip() + "\n"
    compile(texto, rel, "exec")
    (ESQ / rel).parent.mkdir(parents=True, exist_ok=True)
    (ESQ / rel).write_text(texto)
    print(f"esqueleto/{rel}: {len(texto.splitlines())} líneas, {len(cortes)} funciones por escribir")

for rel in ("servidor.env", "carga.env", "gpu.env"):
    texto = re.sub(r"^([A-Z_]+)=.*$", r"\1=", (SOL / rel).read_text(), flags=re.M)
    (ESQ / rel).write_text(texto)
    print(f"esqueleto/{rel}: sin valores")

(ESQ / "servir.sh").write_text("""#!/usr/bin/env bash
# Paso 2: arrancar vLLM con lo que dice servidor.env. Lo lanza python3 mundo/servidor.py arrancar (en tu Mac, con el
# vLLM del dojo); mundo/gpu.py receta lo lee para armar el pod. Contrato: lee servidor.env y termina en
# `exec vllm serve "$MODELO" …` con host y puerto, el nombre servido, el contexto, cuántas a la vez, la clave, el
# parser de razonamiento de Qwen3 y la plantilla sin razonar. Nada más: lo demás, como viene por omisión.
set -euo pipefail
cd "$(dirname "$0")"
echo "servir.sh todavía es el esqueleto (paso 2)" >&2
exit 1
""")
(ESQ / "servir.sh").chmod(0o755)
print("esqueleto/servir.sh: el contrato")
