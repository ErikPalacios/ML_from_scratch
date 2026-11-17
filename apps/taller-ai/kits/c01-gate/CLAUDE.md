# Dojo de entrenamiento ML engineer's · C01 · Estación 4: Gate de evaluación y registry

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Gate de evaluación y registry» del caso C01: decidir, con reglas escritas antes y números foto por foto, si el modelo nuevo puede reemplazar al de producción, y dejarlo registrado como challenger con todo lo que dice qué es. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (fotos, snapshots, el examen congelado, el historial del registro y los dos candidatos de octubre), `arquitectura.py` (la red), `gateway/` (el preprocess del gateway), `modelos.py` (mirar y reparar el registro de MLflow), `s3.py` (mirar el S3 y sus versiones), `revisiones.json` (las versiones aprobadas de `gate.yaml`), `equipo.py`, `reiniciar.py` y el esqueleto. | **No.** Es el mundo. `modelos.py` y `s3.py` sí se usan. |
| `pipeline/evaluar.py`, `gate.py`, `registrar.py` | Lo que escribe la persona. Cada archivo trae su contrato arriba. | **Sí.** |
| `pipeline/_comun.py` | Lo que comparten los pasos: `corrida()`, `gate()`, `revisiones()`, `s3()`, `mlflow_cliente()`, `git()`, `sha256()`, `huella_pesos()` y las constantes. | No. |
| `gate.yaml` | Las reglas del gate (del equipo, revisadas en un PR). | Solo con una revisión aprobada. Nunca para que un modelo pase. |
| `corrida.yaml` | Los parámetros de esta noche, ya resueltos por el orquestador: candidato, champion y el de hace 3 meses, por número. | No a mano. |
| `entrada/categorias.json` | Las 10 categorías; su orden es el `label_id` y es el `labels.json` correcto. | No. |
| `reportes/` | Lo que dejan `evaluar.py` y `gate.py` de cada candidato: pares, evaluación y reporte. Git la ignora. | No a mano. |
| `data/` | Caché local: Fashion-MNIST. Git la ignora. | No. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/equipo.py` para resolver un paso. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json` sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real (1,000 fotos de examen en lugar de 50,000, 10 categorías en lugar de 500, un margen de 2.4 puntos en lugar de 0.3, `mundo/revisiones.json` en lugar del historial de PR, `corrida.yaml` en lugar de los parámetros de Argo, registrar aquí en lugar de después de la estación 5), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o la máquina (`pipeline/gate.py`, `pipeline/registrar.py`, `mundo/modelos.py alias|quitar|labels`, `mundo/s3.py restaurar`, `pip install`, `docker compose …`, `romper.py`, `mundo/*.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `pipeline/evaluar.py`, `mundo/modelos.py versiones|candidatos|gates`, `mundo/s3.py ls|golden|tarjeta|versiones`, `git status`, `git log`, `git diff`) se puede correr directo.
- `evaluar.py` tarda ≈ 10 s y el gate ≈ 3 s. `mundo/crear.py`, ≈ 4 min.
- Las reglas no se mueven para que algo pase. Si la persona propone cambiar un umbral después de ver un resultado, explícale por qué no, y cómo se haría bien (un PR propio, antes de la corrida siguiente).
- La interfaz de MLflow está en http://localhost:5500. Úsala para enseñar: las corridas de gate (las rojas también), sus tags, el reporte, las versiones y sus alias.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-18 10:42 · Construir con ayuda · paso 3 (no inferioridad)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-gate",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-18T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-18T10:42:30-06:00", "ronda": "guiado", "paso": "no-inferioridad", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-18T10:41:02-06:00", "pasan": ["mundo", "examen"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-18T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
