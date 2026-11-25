"""Pasa un día: la ingestión de la estación 1 corrió el 21 de noviembre y dejó el almacén nuevo.

    python mundo/avanzar.py

Lo que cambió ese día (en la guía, paso 7, está la lista para comparar con lo que ve tu chunking):
- Texto nuevo (otro sha256 de texto): el «Manual del vendedor» (los pagos pasan a lunes y jueves), «Devoluciones»
  de la wiki, el «Calendario de pagos», devoluciones.md y 3 tickets con comentarios nuevos.
- El mismo texto con otro nombre: «Lineamientos de fotos de producto» pasa a «… (vigente)».
- Documentos nuevos: la página «Caso Envíos Express», regalos.md y 2 tickets.
- El mismo texto y el mismo nombre, otros metadatos: la ACL de «Alta de vendedores» (solo líderes de operaciones), de
  «Política de viajes» (ya no es de todo el dominio) y del ticket SOP-20 (pasa a «Solo líderes»), y la versión de
  «Proveedores logísticos» (se volvió a publicar igual). Esos no se vuelven a partir.
- Lápidas: la macro «cupón no aplicó» y una minuta que fue a la papelera.
Solo se puede avanzar una vez (para volver al día 1: python mundo/crear.py).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import MUNDO, escribir_json, mundo  # noqa: E402
from mundo.crear import RELOJ, poner, resumen  # noqa: E402

if __name__ == "__main__":
    m = mundo()
    if m["dia"] != 1:
        sys.exit("✗ el mundo ya está en el día 2 (para volver al día 1: python mundo/crear.py y vuelve a chunkear)")
    c = poner(2)
    # la hora real de tu Mac: verificar.py la usa para saber qué corridas de tu chunking son del día 2
    escribir_json(MUNDO, {"dia": 2, "reloj": RELOJ[2], "avanzado_en": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    print(f"✓ pasó un día: el almacén está al {RELOJ[2]}: {resumen(c)}")
    print("  siguiente: python pipeline/chunkear.py")
