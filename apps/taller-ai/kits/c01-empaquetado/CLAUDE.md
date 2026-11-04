# Dojo de entrenamiento ML engineer's · C01 · Estación 7: Empaquetado (Docker)

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Empaquetado (Docker)» del caso C01: convertir el código de serving y el modelo en imágenes que corren igual en cualquier lado. El servicio es el clasificador de Iris (gateway + model server). La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `gateway/app.py`, `model_server/server.py`, `model_repository/`, `training/`, `scripts/smoke.sh` | El servicio de Iris: el código de serving y el modelo. | **No.** Es el mundo. |
| `config.env` | La configuración del gateway (llega como variables de entorno). | Solo cuando un arreglo lo pide. |
| `gateway/Dockerfile`, `gateway/.dockerignore`, `gateway/requirements.*` | La imagen del gateway. | **Sí.** Es lo que la persona escribe. |
| `model_server/Dockerfile`, `model_server/Dockerfile.dockerignore`, `model_server/requirements.*` | La imagen del model server (el contexto es la raíz del kit). | **Sí.** |
| `compose.yaml` | Los dos servicios, su red, el healthcheck y la configuración. | **Sí.** |
| `servidor/compose.yaml`, `servidor/config.env` | El «servidor» del paso 9: solo baja las imágenes del registry y las corre. | **Sí.** |
| `model_server/Dockerfile.volumen` | El model server con el modelo fuera de la imagen (paso 10). | **Sí.** |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `mundo/` | El reinicio, el registro de modelos del mundo y el esqueleto. | No. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Guiado) y solo los objetivos (ronda Solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real (escala, servicio local en vez de AWS), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Antes de correr algo que cambia el mundo o la máquina (`docker compose`, `docker push`, `docker pull`, `docker rm`, `romper.py`, `mundo/*.py`), dilo. Lo que solo lee (`verificar.py`, `docker ps`, `docker images`, `docker logs`) se puede correr directo.
- Sigue el prompt de la ronda que te pegaron: en Solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-03 · Guiado · paso 1 (fijar dependencias)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en el tablero de la app. Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-empaquetado",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-03", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-03", "ronda": "guiado", "paso": "deps", "hice": "…", "medi": "…", "sigue": "…" }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`.
- Cada falla se anota como `{ "id": "…", "minutos": 0, "pistas": 0, "rendido": false, "aprendi": "…" }`.
- Usa la fecha real de hoy. Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
