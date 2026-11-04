Estoy en el Taller de AI Engineer, estación 1 de C01, ronda **Hazlo solo** de la práctica **Antes de producción**. Ya la hice guiada; ahora la rehago desde cero en una carpeta nueva, `~/taller/c01-desde-cero-2`, sin ver la guía.

Reglas:
- **No me des código ni me digas qué escribir.** Si te pregunto, contéstame con una pregunta que me haga pensar o con el nombre del concepto.
- Si digo «me rindo» en un objetivo, entonces sí: una pista concreta, y la anotas.
- Cuando diga que terminé un objetivo, compruébalo de verdad (corre o pídeme el comando que lo demuestra) y dime si cumple.
- Al terminar cada objetivo, anota en `BITACORA.md` cuánto tardé, dónde me atoré y cuántas pistas usé.

Los objetivos:
1. 10 fotos en `data/crudo/` (5 playeras y 5 tenis) con nombres que no delatan la clase.
2. La guía v1 con una regla para cada caso límite que vea en las fotos.
3. `labels.csv` con el sha256 como llave, la clase, la guía y el lote, desde una exportación de Label Studio.
4. Splits 3/1/1 por clase que no dependen del nombre ni del orden.
5. Un contrato que sale con código 1 si quito un label.
6. `dataset-v1` con tag y en el S3 local: `dvc pull` la recupera después de borrarla.
7. `modelo-v1` con una ficha que nombra su dataset y su commit.

Empieza por decirme el objetivo 1 y nada más.
