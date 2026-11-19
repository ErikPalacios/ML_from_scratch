# Dojo de entrenamiento ML engineer's · C01 · Estación 12: Monitoreo y reentrenamiento

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin nube, la estación «Monitoreo y reentrenamiento» del caso C01: vigilar el servicio y el modelo en cinco capas, alertar solo cuando alguien puede y debe actuar (page, warning o ticket), notar cuándo cambió el mundo con el PSI y la aceptación, y convertir esa señal en una decisión, con diagnóstico, que vuelve a la estación 1 como fotos para etiquetar. Prometheus, Alertmanager, la Pushgateway, promtool, amtool y el S3 (RustFS) son los de verdad; lo que cambia contra C01 es dónde corre y que la historia de 60 días ya viene hecha. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/crear.py`, `compose.yaml`, `mundo/comun.py`, `mundo/historia.py` | Cómo nace el mundo: S3, Prometheus, Alertmanager, la Pushgateway, 60 días de historia en S3 y 8 días de métricas en Prometheus. | **No.** |
| `mundo/servicios.py` | Arranca, para y reinicia Triton, los dos pods del gateway, el buscapersonas y el tráfico. | Se usa (`estado`, `arrancar`, `parar`, `reiniciar`). |
| `mundo/plataforma.yaml`, `mundo/prometheus/prometheus.yml`, `mundo/alertmanager/*.url`, `mundo/callers.json` | Lo de otros equipos: el SLO, el job programado y su cuenta, los dueños, la ruta del examen, qué lee Prometheus, las integraciones del buscapersonas y cómo procesa la foto cada app. | Solo con un `git revert` cuando una falla lo pide. |
| `mundo/buscapersonas.py`, `mundo/triton_dojo/`, `mundo/carga.py` | El buscapersonas (PagerDuty, Slack, la cola de tickets y el dead man's switch), Triton y los callers. | **No.** |
| `mundo/capas.py`, `mundo/promtool.py`, `mundo/recargar.py`, `mundo/tickets.py`, `mundo/orquestador.py`, `mundo/cron.py` | Herramientas: las cinco capas en vivo, promtool (revisar, probar, rellenar), llevar un cambio a lo que corre, la cola de tickets, el orquestador del pipeline y el job programado. | Se usan. |
| `gateway/`, `gateway.yaml`, `servir/`, `model_repository/` | La release 15 con el rastro de la estación 11. | **No.** |
| `observabilidad/reglas.yml`, `observabilidad/pruebas.yml`, `observabilidad/alertmanager.yml`, `diario/monitoreo.py`, `diario/disparador.py`, `diario/muestras.py` | Los escribe la persona. El contrato está arriba de cada archivo. | **Sí.** |
| `verificar.py` | Los 12 checks, contra lo que corre (Prometheus, Alertmanager, la Pushgateway, S3, el buscapersonas) y con pruebas de promtool que la persona no ve. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: Prometheus, Alertmanager y la Pushgateway son contenedores de compose (C01: kube-prometheus-stack en EKS, con las reglas como PrometheusRule); el gateway y Triton son procesos de tu Mac; el buscapersonas (`mundo/buscapersonas.py`) hace de PagerDuty, Slack, la cola de Jira y el dead man's switch (como Dead Man's Snitch o Healthchecks.io); el job diario lo corre `mundo/cron.py` (C01: un CronWorkflow de Argo a las 01:00 UTC) y el reentrenamiento lo anota `mundo/orquestador.py` sin entrenar; Prometheus lee cada 5 s y evalúa cada 15 s (C01: 15 s y 1 min); el tráfico de siempre son 5 fotos/s (C01: ≈ 116) y un día de historia ≈ 20,000 requests (C01: ≈ 10 millones); 10 categorías (C01: ≈ 30 padres de 500); la historia de 60 días y la de 8 días de Prometheus nacen hechas, con fechas contadas desde hoy. Las ventanas y umbrales de las reglas son los de C01: el reloj es el de verdad, y `promtool test rules` simula los días.
- «Ayer» es el del mundo (`mundo.comun.ayer()`): si pasa la medianoche UTC mientras trabajan, el mundo no se mueve.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Usa el Python del venv (`source .venv/bin/activate`). Docker en esta Mac: `export DOCKER_CONFIG=$PWD/.docker` antes de `docker compose …` (lo crea `mundo/crear.py`, sin el llavero de macOS).
- Cómo llega cada cambio a lo que corre: `python mundo/promtool.py revisar` y `python mundo/recargar.py prometheus` (después de `reglas.yml`), `python mundo/promtool.py prueba` (después de `pruebas.yml`), `python mundo/recargar.py alertmanager` (después de `alertmanager.yml`). No uses el `curl -X POST …/-/reload` a secas justo después de guardar: Docker Desktop puede darle al contenedor el archivo a medias; `recargar.py` espera a que lo vea completo. Una regla nueva no tiene historia: `python mundo/promtool.py rellenar` la calcula para los 8 días que Prometheus ya tenía (una sola vez por regla).
- Antes de correr algo que cambia el mundo (`mundo/servicios.py arrancar|parar|reiniciar`, `mundo/recargar.py`, `mundo/promtool.py rellenar`, `docker compose stop|start|up`, `mundo/carga.py`, `diario/*.py` sin `--seco`, `mundo/tickets.py decidir`, `mundo/orquestador.py submit`, `mundo/cron.py correr`, `romper.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `mundo/capas.py`, `mundo/servicios.py estado`, `mundo/tickets.py` sin `decidir`, `mundo/cron.py estado`, `mundo/promtool.py revisar|prueba`, `diario/disparador.py --seco`, `curl` a las APIs, `docker compose logs|ps`, `git log`) se puede correr directo.
- Decidir un ticket es de la persona, no tuyo: muéstrale la evidencia y el diagnóstico, pregúntale qué haría y por qué, y que ella corra `mundo/tickets.py decidir`.
- Tiempos de referencia: `mundo/crear.py` ≈ 40 s (≈ 2 min la primera vez); `promtool test rules` ≈ 7 s; `mundo/promtool.py rellenar` ≈ 10 s; el job diario ≈ 0.2 s por día (≈ 5 s los 32 días); el disparador ≈ 2 s; `verificar.py` ≈ 1 min; una alerta page llega al buscapersonas ≈ 10 s después de disparar.
- Enséñale a mirar, en este orden: `python verificar.py <check>`, `python mundo/capas.py`, http://localhost:9962/alerts y /rules, http://localhost:9963, `python mundo/tickets.py avisos`, `curl -s localhost:8966/estado`, `python mundo/cron.py estado`, `curl -s localhost:9964/metrics | grep classifier_monitoreo`, y `git log --oneline`.
- Las reglas de otros equipos (`mundo/plataforma.yaml`, los nombres de las métricas, las integraciones) no se cambian para que algo pase.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-20 10:42 · Construir con ayuda · paso 3 (la baja confianza)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-monitoreo",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-20T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-20T10:42:30-06:00", "ronda": "guiado", "paso": "baja-confianza", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-20T10:41:02-06:00", "pasan": ["mundo", "reglas"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
