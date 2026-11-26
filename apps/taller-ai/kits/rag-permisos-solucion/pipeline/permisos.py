"""Paso 2 · ¿Puede verlo?: la ACL en cláusulas contra los principals de una persona, fail-closed.

Contrato:
- Una ACL es una lista de cláusulas y cada cláusula una lista de principals ("user:…", "group:…", "domain:…"), como
  la dejó la estación 1: para ver, la persona tiene que cumplir TODAS las cláusulas (AND), y para cumplir una cláusula
  le basta tener UNO de sus principals (OR).
- acl_valida(acl): True solo si es una lista con al menos una cláusula, cada cláusula una lista con al menos un
  principal, y cada principal un texto que empieza con user:, group: o domain:.
- puede_ver(acl, principals): False si la ACL no es válida (vacía, None, una cláusula vacía…): fail-closed.
"""
from __future__ import annotations

PREFIJOS = ("user:", "group:", "domain:")


def acl_valida(acl) -> bool:
    return (isinstance(acl, list) and len(acl) > 0 and
            all(isinstance(c, list) and len(c) > 0 and all(isinstance(p, str) and p.startswith(PREFIJOS) for p in c) for c in acl))


def puede_ver(acl, principals: set[str]) -> bool:
    if not acl_valida(acl):
        return False                            # una ACL rota no es «sin restricciones»: es un dato que falta
    return all(any(p in principals for p in clausula) for clausula in acl)
