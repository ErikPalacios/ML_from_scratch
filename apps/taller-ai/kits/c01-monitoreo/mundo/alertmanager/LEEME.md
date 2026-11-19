# Las integraciones del buscapersonas (de plataforma)

Cada archivo es la URL de una integración, como la que te da PagerDuty u Opsgenie al crear un servicio: es un secreto,
así que no va en `alertmanager.yml` (que vive en git y lo lee medio equipo). Tu `alertmanager.yml` la lee con
`url_file: /etc/alertmanager/plataforma/<nombre>.url`.

| Archivo | Para qué |
|---|---|
| `guardia.url` | los page: le suena el teléfono a quien está de guardia |
| `canal.url` | los warning: un mensaje en el canal del equipo |
| `tickets.url` | los ticket: la cola del equipo de ML |
| `latido.url` | el Watchdog: el latido que dice «Prometheus y Alertmanager siguen vivos» |
