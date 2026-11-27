Estoy en el Dojo de entrenamiento ML engineer's, en la estación 2 de IA Privada, «Medir y cuantizar», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py`. Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en `medicion.json` o en `cuantizados/`, nunca en mi `pipeline/`, vuelve a correr el benchmark de la empresa con mi pipeline (≈ 1 minuto) y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el despacho.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`medicion.json`, `resultados/velocidad.json` y `calidad.json` con sus muestras, `resultados/reporte.md`, `cuantizados/manifiesto.json`, `python3 mundo/ficha.py <gguf> --tipos`) → el arreglo (y volver a medir lo que haga falta). Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en el despacho de verdad (Qwen3 32B en INT4 de AWQ servido por vLLM en una L40S, con sus 8 conversaciones a la vez: ahí la elección de bits decide si el modelo cabe y si escribe a 20 tokens/s).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar`.
