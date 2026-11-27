"""Paso 2: las citas. El modelo cita con [n]; aquí se lee qué citó y se revisa cada número contra lo que de verdad
recibió esa persona, también mientras la respuesta sale en streaming.

Contrato:
- PATRON: una cita es [n] o [n, m, …] con números enteros.
- extraer(texto) → [n]: los números citados, en orden de aparición y sin repetir.
- validar(numeros, contexto, puede_ver, contra="contexto") → {"validas": [{"n", "chunk_id", "titulo"}],
  "invalidas": [{"n", "motivo"}]}. contexto = la lista que armó prompt.armar() ({"n", "chunk_id", "titulo"}).
  puede_ver(chunk_id) → bool, con la ACL de quien pregunta. motivo "fuera": ese número no estaba en el contexto;
  "ajena": estaba, pero la persona no puede ver ese chunk. contra (citas.contra en config.yaml) es "contexto" (lo
  correcto) o "k" (solo revisa que el número vaya de 1 a k = retrieval.k, para comparar: así pasa una cita a un
  documento que no se dio). Otro valor, ValueError. Cada número se revisa una vez.
- Filtro(contexto, puede_ver, contra="contexto", k=8): para el streaming. .alimentar(pedazo) → el texto que ya se
  puede mandar; guarda lo que empieza con «[» hasta saber si es una cita (cierra con «]») o no (cualquier otra
  cosa, o más de 20 caracteres). Una cita se manda solo con sus números válidos ([2, 9] → [2]); si ninguno es
  válido, no se manda. .cerrar() → lo que quedó guardado. .validas y .invalidas se van llenando, sin repetir.
"""

from __future__ import annotations
import re

PATRON = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def extraer(texto: str) -> list[int]:
    raise NotImplementedError("paso 2: extraer")


def validar(numeros: list[int], contexto: list[dict], puede_ver, contra: str = "contexto", k: int = 8) -> dict:
    raise NotImplementedError("paso 2: validar")


class Filtro:

    def __init__(self, contexto: list[dict], puede_ver, contra: str = "contexto", k: int = 8):
        raise NotImplementedError("paso 2: Filtro.__init__")

    def _cita(self, numeros: list[int]) -> str:
        raise NotImplementedError("paso 2: Filtro._cita")

    def alimentar(self, pedazo: str) -> str:
        raise NotImplementedError("paso 2: Filtro.alimentar")

    def cerrar(self) -> str:
        raise NotImplementedError("paso 2: Filtro.cerrar")


if __name__ == "__main__":
    # python pipeline/citas.py  → un ejemplo con el contexto de Carmen (4 documentos) y una cita al 6
    ctx = [{"n": i, "chunk_id": f"wiki:{i}#000", "titulo": f"doc {i}"} for i in range(1, 5)]
    f = Filtro(ctx, lambda c: c != "wiki:4#000")
    pedazos = ["Los reembolsos tardan de 5 a 10 días [", "1", "] y el depósito sale el lunes [2, 6]. ", "Ver [4]."]
    print("".join(f.alimentar(p) for p in pedazos) + f.cerrar())
    print("válidas:", f.validas)
    print("inválidas:", f.invalidas)
