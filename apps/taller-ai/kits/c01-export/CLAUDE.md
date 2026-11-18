# Dojo de entrenamiento ML engineer's · C01 · Estación 5: Export, engine y paridad

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Export, engine y paridad» del caso C01: convertir el modelo que aprobó el gate en el archivo que se va a servir, demostrar que responde lo mismo (paridad) y que no es más lento que el de producción (latencia), y dejarlo en el registro con sus huellas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (el examen congelado, el set de calibración, el registro v1–v4, los checkpoints y el engine del champion), `arquitectura.py` (la red), `gateway/` (el preprocess), `servidor/` (el contrato `classifier.yaml` y el runtime `requirements.txt` del servidor), `modelos.py` (mirar y reparar el registro), `s3.py` (mirar el S3), `revisiones.json` (las versiones aprobadas de `engine.yaml`), `equipo.py`, `reiniciar.py` y el esqueleto. | **No.** Es el mundo. `modelos.py` y `s3.py` sí se usan. |
| `pipeline/exportar.py`, `construir.py`, `paridad.py`, `latencia.py`, `registrar.py` | Lo que escribe la persona. Cada archivo trae su contrato arriba. | **Sí.** |
| `pipeline/_comun.py` | Lo que comparten los pasos: `corrida()`, `receta()`, `revisiones()`, `contrato()`, `runtime_servidor()`, `carpeta()`, `s3()`, `mlflow_cliente()`, `bajar()`, `manifest()`, `tensores()`, `sesion()`, `git()`, `sha256()`, `huella_pesos()` y las constantes. | No. |
| `engine.yaml` | La receta del export y del engine y los umbrales de paridad y latencia (del equipo, revisados en un PR). | Solo con una revisión aprobada. Nunca para que un engine pase. |
| `corrida.yaml` | Los parámetros de esta noche, ya resueltos por el orquestador: challenger y champion, por número. | No a mano. |
| `entrada/categorias.json` | Las 10 categorías; su orden es el `label_id`. | No. |
| `artefactos/` | Lo que fabrican y miden los pasos: `v4/` (model.onnx, engine.onnx, export, engine, paridad y latencia) y `v4-int8/` (la prueba int8). Git la ignora. | No a mano. |
| `data/` | Caché local: Fashion-MNIST. Git la ignora. | No. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/equipo.py` para resolver un paso. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json` sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: ONNX Runtime en la CPU de la Mac en lugar de TensorRT en una T4 (aquí el engine guarda los pesos en FP16 pero hace las cuentas en FP32), `engine.onnx` en lugar de `model.plan`, el contrato `mundo/servidor/classifier.yaml` en lugar del `config.pbtxt` de Triton, la latencia medida dentro del proceso en lugar de `perf_analyzer` contra Triton, una holgura de 15 % en lugar de 10 %, 1,000 fotos de examen en lugar de ≈ 10,000, `mundo/revisiones.json` en lugar del historial de PR.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o la máquina (`pipeline/registrar.py`, `mundo/modelos.py alias|pesos|reconstruir-engine`, `pip install`, `docker compose …`, `romper.py`, `mundo/*.py`, `git commit`, `git revert`), dilo. Lo que solo lee o escribe en `artefactos/` (`verificar.py`, `pipeline/exportar.py`, `construir.py`, `paridad.py`, `latencia.py`, `mundo/modelos.py versiones|engine`, `mundo/s3.py`, `git status`, `git log`, `git diff`) se puede correr directo.
- `exportar.py` tarda ≈ 5 s, `construir.py` ≈ 2 s, `paridad.py` ≈ 5 s y `latencia.py` ≈ 1 min (no corras nada pesado mientras mide). `mundo/crear.py`, ≈ 3 min.
- Los umbrales no se mueven para que un engine pase. Si la persona propone aflojar la paridad porque int8 es más rápido, explícale por qué no, y cómo se haría bien (un PR propio, con su calibración y su paridad).
- La interfaz de MLflow está en http://localhost:5600. Úsala para enseñar: las versiones, sus alias, sus tags y los archivos de `engine/`.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-18 10:42 · Construir con ayuda · paso 4 (paridad)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-export",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-18T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-18T10:42:30-06:00", "ronda": "guiado", "paso": "paridad", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-18T10:41:02-06:00", "pasan": ["mundo", "receta"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-18T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
