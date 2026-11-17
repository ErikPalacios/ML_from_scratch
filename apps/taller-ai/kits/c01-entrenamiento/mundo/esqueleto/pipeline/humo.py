"""Paso 2 · Prueba de humo: sobreajustar un solo batch antes de gastar una hora de GPU.

Uso:    python pipeline/humo.py --snapshot ds-2026-09-01 [--lr X]
Entra:  receta.yaml                    lr, weight_decay y semilla (los de la corrida de verdad: se prueba ESA receta)
        el snapshot, con cargar() de pipeline/datos.py: las primeras 32 fotos de train, en su orden
Sale:   imprime la pérdida del primer paso junto a ln(K), y la pérdida y los aciertos al final.
        Código de salida 0 si pasa, 1 si no (así el orquestador no sigue al entrenamiento).
Reglas: la red desde cero (pesos al azar, sin champion), sin augmentation, AdamW con el lr de la receta
        (o el de --lr, para probar), hasta 150 pasos sobre el mismo batch.
        Pasa si la pérdida final es menor que 0.05 y acierta las 32.
"""
from _comun import CLASES, receta  # noqa: F401

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente eso.
raise NotImplementedError("Paso 2: todavía no está escrito")
