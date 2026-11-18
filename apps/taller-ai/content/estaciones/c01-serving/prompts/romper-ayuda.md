Estoy en el Dojo de entrenamiento ML engineer's, en la estación 6 de C01, «Código de serving», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py`. Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mi gateway, mi `armar.py` ni mi `config.pbtxt`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`python mundo/servicios.py estado`, `tail logs/gateway.log`, `tail logs/triton.log`, `curl -i` al gateway y a Triton, `git log -p gateway.yaml`, `python mundo/modelos.py versiones|engine 4|labels 4`, `shasum -a 256 model_repository/classifier/1/model.onnx`, `docker compose ps`, y mi propio `servir/armar.py`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (Triton con TensorRT en una T4, el model repository dentro de la imagen, Kubernetes con sus probes, el ALB, MLflow con Postgres y S3).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
