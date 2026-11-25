"""Un conector por fuente. Todos tienen la misma forma (la «interfaz» del conector):

    listar()          -> list[ref]                      todo lo que la cuenta del conector puede ver hoy
    cambios(cursor)   -> (list[ref], list[doc_id], cursor)   lo que cambió desde el cursor (None = la primera vez: todo)
    traer(ref)        -> doc | None                      el documento: su contenido crudo y su ACL (None: ya no existe o no lo ves)
    acl(ref)          -> list[list[str]]                 la ACL como cláusulas: ves el documento si tienes un principal de CADA una

Un ref es un dict: {"doc_id": "wiki:1002", "fuente": "wiki", "version": "3", "actualizado": "2026-…Z" o None,
"titulo": "…", "url": "…", "meta": {lo que el conector necesita después}}. Un doc es el ref más "tipo"
("html", "pdf", "markdown" o "ticket"), "crudo" (bytes) y "acl".
"""
