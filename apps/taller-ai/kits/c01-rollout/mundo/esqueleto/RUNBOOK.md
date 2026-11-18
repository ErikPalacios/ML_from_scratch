# Runbook de rollback · classifier

TUYO (paso 9). La receta, paso a paso, de qué hace la persona de guardia cuando algo sale mal en un despliegue: se
escribe en calma para usarse con prisa, a las 3 de la mañana, por alguien que no hizo el cambio.

Contrato (lo revisa verificar.py runbook): seis secciones con título «## 1. Detectar», «## 2. Revertir»,
«## 3. Confirmar», «## 4. Congelar», «## 5. Comunicar» y «## 6. Investigar». En «Revertir», qué se hace según la fase
(canary, bake, pasado el bake), con los comandos exactos de este repositorio: el git revert, el kubectl apply -k y cómo
regresa el alias champion (con su run y su digest).
