"""Estación 8 (ya hecho): las citas. El modelo cita con [n]; aquí se lee qué citó y se revisa cada número contra lo que de verdad
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
_PARCIAL = re.compile(r"\[[\d\s,]*")


def extraer(texto: str) -> list[int]:
    out = []
    for m in PATRON.finditer(texto):
        for x in m.group(1).split(","):
            n = int(x)
            if n not in out:
                out.append(n)
    return out


def _revisar(n: int, por_n: dict, puede_ver, contra: str, k: int):
    if contra == "contexto":
        if n not in por_n:
            return None, "fuera"
        c = por_n[n]
        return (c, None) if puede_ver(c["chunk_id"]) else (None, "ajena")
    if contra == "k":
        if not 1 <= n <= k:
            return None, "fuera"
        c = por_n.get(n, {"n": n, "chunk_id": None, "titulo": None})
        return (c, None) if c["chunk_id"] is None or puede_ver(c["chunk_id"]) else (None, "ajena")
    raise ValueError(f"citas.contra tiene que ser contexto o k, no {contra}")


def validar(numeros: list[int], contexto: list[dict], puede_ver, contra: str = "contexto", k: int = 8) -> dict:
    por_n = {c["n"]: c for c in contexto}
    validas, invalidas, vistos = [], [], set()
    for n in numeros:
        if n in vistos:
            continue
        vistos.add(n)
        c, motivo = _revisar(n, por_n, puede_ver, contra, k)
        if c is not None:
            validas.append({"n": n, "chunk_id": c["chunk_id"], "titulo": c["titulo"]})
        else:
            invalidas.append({"n": n, "motivo": motivo})
    return {"validas": validas, "invalidas": invalidas}


class Filtro:
    def __init__(self, contexto: list[dict], puede_ver, contra: str = "contexto", k: int = 8):
        self.contexto, self.puede_ver, self.contra, self.k = contexto, puede_ver, contra, k
        self.validas: list[dict] = []
        self.invalidas: list[dict] = []
        self._vistos: set[int] = set()
        self._guardado = ""

    def _cita(self, numeros: list[int]) -> str:
        r = validar(numeros, self.contexto, self.puede_ver, self.contra, self.k)
        for v in r["validas"]:
            if v["n"] not in self._vistos:
                self.validas.append(v)
        for v in r["invalidas"]:
            if v["n"] not in self._vistos:
                self.invalidas.append(v)
        self._vistos |= set(numeros)
        buenos = [v["n"] for v in r["validas"]]
        return f"[{', '.join(map(str, buenos))}]" if buenos else ""

    def alimentar(self, pedazo: str) -> str:
        s, out = self._guardado + pedazo, []
        self._guardado = ""
        while s:
            i = s.find("[")
            if i < 0:
                out.append(s)
                break
            out.append(s[:i])
            s = s[i:]
            m = PATRON.match(s)
            if m:
                out.append(self._cita([int(x) for x in m.group(1).split(",")]))
                s = s[m.end():]
                continue
            p = _PARCIAL.match(s)
            if p.end() == len(s) and len(s) <= 20:      # puede ser el principio de una cita: esperar
                self._guardado = s
                break
            out.append(s[0])                            # no es una cita: el «[» sale como texto
            s = s[1:]
        return "".join(out)

    def cerrar(self) -> str:
        s, self._guardado = self._guardado, ""
        return s


if __name__ == "__main__":
    # python pipeline/citas.py  → un ejemplo con el contexto de Carmen (4 documentos) y una cita al 6
    ctx = [{"n": i, "chunk_id": f"wiki:{i}#000", "titulo": f"doc {i}"} for i in range(1, 5)]
    f = Filtro(ctx, lambda c: c != "wiki:4#000")
    pedazos = ["Los reembolsos tardan de 5 a 10 días [", "1", "] y el depósito sale el lunes [2, 6]. ", "Ver [4]."]
    print("".join(f.alimentar(p) for p in pedazos) + f.cerrar())
    print("válidas:", f.validas)
    print("inválidas:", f.invalidas)
