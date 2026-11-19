# Dojo de entrenamiento ML engineer's · C01 · Estación 11: La request en vivo

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin nube, la estación «La request en vivo» del caso C01: que cada request deje tres rastros (una línea de log, sus sumas en las métricas y, a veces, un exemplar que lleva a ella), unidos por el mismo `request_id`, y que cada rastro llegue a donde alguien lo puede leer (Prometheus, S3 y Parquet) sin frenar nunca la respuesta. Prometheus, Fluent Bit y el S3 (RustFS) son los de verdad; lo que cambia contra C01 es dónde corre y cuánto duran las cosas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/crear.py`, `compose.yaml`, `mundo/comun.py`, `mundo/nodo/Dockerfile` | Cómo nace el mundo: el S3, Prometheus, los dos nodos del gateway y un Fluent Bit por nodo, y el log de ayer ya subido. | **No.** |
| `mundo/runtime.py`, `mundo/nodo.py` | El runtime de cada nodo (escribe el stdout del pod en `/var/log` en formato CRI) y el kubelet del dojo (arranca, reinicia, publica los pods a Prometheus). | Se usa `nodo.py` (`estado`, `logs`, `reiniciar`, `matar`, `arrancar`, `parar`, `publicar`). |
| `mundo/plataforma.yaml`, `mundo/prometheus/plataforma.yml`, `mundo/callers.json` | Lo del equipo de plataforma: los pods y sus etiquetas, el ALB, lo que Prometheus ya lee (Triton, ALB, Fluent Bit, vigía) y el proveedor de identidad. | Solo con un `git revert` cuando una falla lo pide. |
| `mundo/alb.py`, `mundo/vigia_s3.py`, `mundo/triton_dojo/` | El ALB del dojo (token, target group, 503/401 propios, sus métricas «de CloudWatch» en :8957 y su access log), el vigía de S3 y el Triton del dojo. | **No.** |
| `mundo/carga.py`, `mundo/buscar.py`, `mundo/relojes.py`, `mundo/fotos/` | Los callers (el tráfico por el ALB), buscar una request por su id en todos lados y comparar los tres relojes. | Se usan. |
| `gateway/` (menos `rastro.py`), `gateway.yaml`, `servir/`, `model_repository/` | La release 15 de las estaciones 6 a 10. `main.py` llama a `rastro.py` para todo lo que la request deja escrito. | **No.** |
| `gateway/app/rastro.py`, `observabilidad/prometheus.yml`, `observabilidad/reglas.yml`, `observabilidad/fluent-bit.conf`, `diario/a_parquet.py` | Los escribe la persona. El contrato está arriba de cada archivo. | **Sí.** |
| `verificar.py` | Los 12 checks, contra lo que corre (pods, Prometheus, Fluent Bit, S3). | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: los nodos son dos contenedores de Docker con un pod cada uno, en lugar de nodos de EKS; el runtime y el kubelet son `mundo/runtime.py` y `mundo/nodo.py`; Prometheus descubre los pods con `file_sd_configs` sobre `nodo/descubrimiento/pods.json` (mismas etiquetas `__meta_kubernetes_*` que `kubernetes_sd_configs`), en lugar de un PodMonitor de kube-prometheus-stack; Fluent Bit es un contenedor por nodo en lugar de un DaemonSet; el S3 es RustFS; el ALB es un proceso que imita lo que el gateway no ve (sus métricas irían a CloudWatch); se lee cada 5 s (C01: 15 s), Fluent Bit sube cada minuto (C01: 5 min), LogsStale a los 3 min (C01: 30 min) y las ventanas de PromQL son de 1 min (C01: 5 min); no hay trazas completas con OpenTelemetry y Tempo: el exemplar lleva al `request_id` y de ahí a la línea de log; el tráfico de siempre son 5 fotos/s (C01: ≈ 116).
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Usa el Python del venv (`source .venv/bin/activate`). Docker en esta Mac: `export DOCKER_CONFIG=$PWD/.docker` antes de `docker compose …` (lo crea `mundo/crear.py`, sin el llavero de macOS).
- Cómo llega cada cambio a lo que corre: `python mundo/recargar.py gateway` (después de `rastro.py`: reinicia los pods uno tras otro), `python mundo/recargar.py prometheus` (`prometheus.yml` o `reglas.yml`: promtool + recarga; luego revisar http://localhost:9952/targets o /rules) y `python mundo/recargar.py fluent-bit` (`fluent-bit.conf`). No uses el `curl -X POST …/-/reload` a secas justo después de guardar: Docker Desktop puede darle a Prometheus el archivo a medias; `recargar.py` espera a que lo vea completo. Un archivo bien escrito que no se recargó no cuenta.
- Para ver algo con tráfico, `python mundo/carga.py --tasa 30 --segundos 60` en otra terminal (el tráfico de siempre son 5 fotos/s). Prometheus necesita ≈ 1 min de datos para que un `rate(…[1m])` tenga sentido.
- Antes de correr algo que cambia el mundo (`mundo/nodo.py reiniciar|matar|parar|arrancar`, `mundo/recargar.py`, `docker compose stop|start|restart`, `mundo/carga.py`, `diario/a_parquet.py`, `romper.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `mundo/nodo.py estado|logs`, `mundo/buscar.py`, `mundo/relojes.py`, `curl` a `/metrics` o a la API de Prometheus, `docker compose logs|ps`, `git log`) se puede correr directo.
- Tiempos de referencia: `mundo/crear.py` ≈ 30 s (≈ 2 min la primera vez); un reinicio del gateway ≈ 2 s por pod; un objeto nuevo en S3 cada ≈ 1 min por nodo; `diario/a_parquet.py` ≈ 2 s para el día de ayer (≈ 12,000 requests); `verificar.py` ≈ 15 s.
- Enséñale a mirar, en este orden: `python verificar.py <check>`, http://localhost:9952/targets y /alerts, `curl -s localhost:8951/metrics | grep classifier_`, `python mundo/nodo.py logs a`, `python mundo/buscar.py <request_id>`, `docker compose logs fluent-bit-a`, `curl -s localhost:9953/api/v2/metrics/prometheus`, `curl -s localhost:8957/metrics` y `logs/alb.log`, y `git log --oneline`.
- Las reglas de otros equipos (`mundo/plataforma.yaml`, `gateway.yaml`, los nombres de las métricas) no se cambian para que algo pase.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-20 10:42 · Construir con ayuda · paso 4 (Prometheus lee los pods)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-request",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-20T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-20T10:42:30-06:00", "ronda": "guiado", "paso": "prometheus", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-20T10:41:02-06:00", "pasan": ["mundo", "request-id"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
