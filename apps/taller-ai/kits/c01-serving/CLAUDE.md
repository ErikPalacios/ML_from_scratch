# Dojo de entrenamiento ML engineer's · C01 · Estación 6: Código de serving

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Código de serving» del caso C01: el model repository de Triton (con su `config.pbtxt`) y el gateway en FastAPI que recibe cada foto, la revisa, la prepara, le pide los logits a Triton con un plazo y contesta con el código correcto, con su log, sus métricas y sus pruebas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (el registro v1–v4 con los engines de v3 y v4, el examen, `fotos-raras/` y `servir.yaml`), `triton_dojo/servidor.py` (el servidor de modelos del dojo, el sustituto de Triton), `servicios.py` (arrancar, parar, reiniciar y ver el estado de Triton y del gateway), `modelos.py` (mirar y reparar el registro), `revisiones.json` (las versiones aprobadas de `gateway.yaml`), `equipo.py`, `arquitectura.py`, `reiniciar.py` y el esqueleto. | **No.** Es el mundo. `servicios.py` y `modelos.py` sí se usan. |
| `servir/armar.py` | Lo escribe la persona: arma el model repository y `servir/modelo.json` desde el registro. | **Sí.** |
| `model_repository/classifier/config.pbtxt` | Lo escribe la persona: la configuración del modelo en Triton. | **Sí.** El engine (`1/model.onnx`) lo deja `armar.py`; no se copia a mano. |
| `gateway/app/main.py`, `gateway/app/revision.py` | Lo escribe la persona: el gateway y la revisión de cada foto. Cada archivo trae su contrato arriba. | **Sí.** |
| `gateway/app/preprocess.py` | El preprocess compartido con el entrenamiento. | **No.** Cambiarlo es training-serving skew. |
| `gateway/tests/` | Lo escribe la persona: las pruebas con un Triton falso. | **Sí.** |
| `gateway.yaml` | Las reglas del gateway (contrato, límites, plazos y Triton), del equipo de serving, revisadas en un PR. | Solo con una revisión aprobada. Nunca para que algo pase. |
| `servir.yaml` | Qué versión se sirve, ya resuelta por el orquestador (v4) y su `model_version`. | No a mano. |
| `fotos-raras/`, `logs/`, `data/` | Fotos de prueba, lo que escriben Triton y el gateway (`logs/triton.log`, `logs/gateway.log`) y la caché de Fashion-MNIST. Git las ignora. | No. Los logs se leen mucho. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/triton_dojo/` ni `mundo/equipo.py` para resolver un paso. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json` sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: un servidor de modelos del dojo con ONNX Runtime en la CPU en lugar de Triton con TensorRT en una T4 (lee el mismo `config.pbtxt` y habla el mismo protocolo HTTP, así que el gateway usa el cliente oficial `tritonclient`), `platform: "onnxruntime_onnx"` y `KIND_CPU` en lugar de `"tensorrt_plan"` y `KIND_GPU`, procesos en tu Mac (`mundo/servicios.py`) en lugar de pods de Kubernetes, `servir/modelo.json` en lugar del ConfigMap con `labels.json`, el header `X-Caller-Id` en lugar del `client_id` del token que verificó el ALB, 10 categorías y fotos de 32×32 en lugar de 500 y 224×224, `mundo/revisiones.json` en lugar del historial de PR.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o la máquina (`mundo/servicios.py arrancar|parar|reiniciar`, `mundo/modelos.py alias|reparar-labels`, `pip install`, `docker compose …`, `romper.py`, `mundo/*.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `python -m pytest`, `servir/armar.py`, `mundo/servicios.py estado`, `mundo/modelos.py versiones|engine|labels`, `curl` al gateway o a Triton, `tail logs/…`, `git status`, `git log`, `git diff`) se puede correr directo.
- Cuando cambies código del gateway, reinícialo (`python mundo/servicios.py reiniciar gateway`); cuando cambie el `config.pbtxt` o el engine, reinicia Triton: carga solo al arrancar (`--model-control-mode=none`).
- `mundo/crear.py` tarda ≈ 2 min; `verificar.py` completo ≈ 10 s; las pruebas, ≈ 2 s.
- Los límites y los plazos de `gateway.yaml` no se mueven para que algo pase. Si la persona propone estirar un plazo o subir los topes, explícale la cadena de plazos y la cuenta de memoria del peor momento.
- Enséñale a mirar: `curl -i` contra el gateway, `tail -f logs/gateway.log`, `curl localhost:8701/metrics`, `curl localhost:8700/metrics` (las métricas de Triton: cuántas fotos y cuántos batches) y la interfaz de MLflow en http://localhost:5700.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-18 10:42 · Construir con ayuda · paso 5 (classify)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-serving",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-18T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-18T10:42:30-06:00", "ronda": "guiado", "paso": "classify", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-18T10:41:02-06:00", "pasan": ["mundo", "reglas"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-18T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
