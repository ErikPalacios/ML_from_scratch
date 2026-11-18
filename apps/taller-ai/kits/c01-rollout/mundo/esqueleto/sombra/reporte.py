"""El reporte del shadow (en C01, el job diario): une las dos líneas de log de cada request_id y decide, con los umbrales
escritos antes (sombra/umbrales.json), si el challenger sigue al canary.

    python3 mundo/logs.py > sombra/evidencia.jsonl      # las líneas de log de todos los gateways
    python3 sombra/reporte.py sombra/evidencia.jsonl     # imprime el reporte y escribe sombra/reporte.json

Contrato (lo revisa verificar.py sombra):
- Lee las líneas de JSON del archivo. Una línea del champion tiene status 200 y no tiene «shadow»; una de la sombra
  tiene shadow: true. Un par es un request_id con las dos, las dos con status 200.
- Mide: pares; acuerdo top-1 (fracción de pares con la misma primera categoría); el p99 de ms.triton del challenger
  contra el del champion en esos mismos pares; las caídas del Triton del challenger (los reinicios de sus pods, con
  kubectl); las copias que no llegaron (status ≠ 200); y el acuerdo en las N categorías más grandes del champion.
- Escribe sombra/reporte.json con: champion, challenger (sus model_version), pares, acuerdo_top1, p99_champion_ms,
  p99_challenger_ms, p99_razon, caidas, copias_fallidas, por_categoria {label: acuerdo}, desacuerdos (hasta 20
  request_id para que los revise una persona), umbrales, fallan (lista de lo que no pasa) y veredicto «sigue» o «frena».
- Sale con 0 si sigue y con 1 si frena.
"""
import sys

sys.exit("sombra/reporte.py: todavía no lo escribes (paso 4 del Guiado)")
