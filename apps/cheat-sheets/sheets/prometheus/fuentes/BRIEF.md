# Brief: "Prometheus y Grafana" (study page + PDF) — content writers

## Goal and learner
- **Learner:** a mechatronics MSc with CV/PyTorch background who has never shipped to production. In their words, about Prometheus: "no tengo idea de qué sea, o cómo se use".
  - **Sheets they already have:** Docker, Kubernetes, Git + Actions, "De PyTorch a Triton", "El gateway: FastAPI en producción", and the end-to-end map "Del dato a producción".
  - **What this sheet teaches, from zero:**
    - what monitoring is and why (metrics vs logs vs traces);
    - what Prometheus does (pull, scrape, time series, labels) and how you use it: instrument code, configure scrapes, write PromQL, write recording and alerting rules;
    - how Alertmanager turns an alert into a page;
    - what Grafana is: dashboards on top of Prometheus;
    - SLOs and burn-rate alerts;
    - how it all runs on Kubernetes (Prometheus Operator, ServiceMonitor, kube-state-metrics, KEDA reading Prometheus);
    - diagnosis.
  - **Target level is the JOB:** instrument a service, write the PromQL for a dashboard and an alert with the docs open, and diagnose "no data", "target down" or "the alert never fired".
- **Format:** the same as the other sheets.
  - Each section has a "fórmula" (syntax templates with `{placeholders}`, plus real KaTeX formulas where they exist: `rate`, `histogram_quantile` interpolation, error-budget burn rate, series count), a pieces table, a real example, a figure, "Cómo recordarla", "Trampa", and an optional mini-lab.
  - Web tools at the end: a symptom **diagnosticador**, a **revisor de reglas de alerta** (Prometheus rule files) and an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English. Gender-neutral. Say "el curso"; course labels like C01 and M12 are fine; never invent shorthand codes.

## Style: plain language, same concepts
The learner asked for "lenguaje simple pero mencionando los mismos conceptos", and here they start from zero.
- **Sentences:** short ones, one idea each, everyday words.
- **New terms:** explain each technical term in plain words the first time it appears in a section, and keep the English term beside it. Example: "una **serie** (time series: la historia de un solo número en el tiempo, como la temperatura de un cuarto medida cada 15 segundos)".
- **No jargon:** no undefined acronyms and no stacked jargon.
- **Analogies:** only correct ones that help memory. Examples:
  - a counter is a car's odometer: it only goes up, and `rate()` turns it into speed;
  - a gauge is the fuel gauge;
  - scraping is a nurse doing rounds every 15 s to write down each patient's vital signs.
- **Depth:** never drop concepts to simplify.
- **Tables:** in `pieces` and `vars`, the "qué hace" column is plain Spanish; the code, field or query stays exact.

## Sources
- **Paths.** App root: `~/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`. Cheat sheets: `…/apps/cheat-sheets`.
- **C01 real files (the running example):**
  - `reference/c01/monitoring/prometheus.yml`
  - `reference/c01/monitoring/alerts.yml`
  - `reference/c01/k8s/monitoring.yaml` (ServiceMonitors)
  - `reference/c01/k8s/keda-triton.yaml` (KEDA reads Prometheus)
  - `reference/c01/gateway/app/main.py` (prometheus_client Counter/Histogram, `/metrics`)
  - `reference/c01/triton/` and `k8s/triton.yaml` (Triton's metrics on port 8002)
  - `reference/c01/docker-compose.yml` (the local Prometheus and its version)

  Quote exact short excerpts, and use the pinned versions.
- **Course:**
  - M12 monitoreo (`js/content/m12-monitoreo.js`);
  - C01 `monitoreo`: golden signals per tier, model and data metrics, alerts, dashboards, logging, retraining;
  - M06 (`hpa`, `keda`);
  - M15, `ref-comandos.js` (`autoscaling-cmds`) and `ref-herramientas.js`.
- **Consistency with the existing sheets.** Read them and don't contradict them:
  - `apps/cheat-sheets/sheets/recorrido/fuentes/content-w2.json`: the `monitoreo` station and the `prometheus`, `grafana` and `opentelemetry` cards.
  - `apps/cheat-sheets/sheets/gateway/fuentes/content-w2.json` (`observabilidad`):
    - histogram buckets around the SLO;
    - series count (b+4)×v with `_created`;
    - the p99 from summed buckets vs the average of per-pod p99s;
    - 422s now counted by an exception handler.
  - `apps/cheat-sheets/sheets/triton/fuentes/content-w2.json` (`medir`): Triton metrics are counters vs gauges; "GPU utilization" means the share of time with at least one kernel running.
  - `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w2.json` (`autoscaling`): the HPA formula; KEDA creates `keda-hpa-<name>`; `pollingInterval` semantics.
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist.
- **Verification.** Check every function, flag, config field, default, port and message against the official docs:
  - prometheus.io (configuration, querying basics/functions/operators, histograms and summaries, recording and alerting rules, naming, storage, Alertmanager config);
  - prometheus-operator.dev (ServiceMonitor, PodMonitor, PrometheusRule);
  - grafana.com/docs (data sources, panels, variables, provisioning);
  - the prometheus_client Python docs;
  - keda.sh (the Prometheus scaler);
  - the Google SRE workbook (alerting on SLOs, burn rates).

  Load WebSearch/WebFetch with ToolSearch `select:WebSearch,WebFetch`. It is October 2026: check current versions (Prometheus 3.x, Grafana, Alertmanager, kube-prometheus-stack). Never invent functions, defaults or messages; if unsure, say so or leave it out.

## Settled facts
Verify them; if one is wrong, report it and use the verified value.
- **Pull model:** Prometheus scrapes `/metrics` over HTTP on an interval. In the Prometheus config the global `scrape_interval` defaults to 1m, while C01 uses 15s (verify both). There is a separate `scrape_timeout` (default 10s).
- **Default ports:** Prometheus 9090, Alertmanager 9093, Grafana 3000, node_exporter 9100, Triton metrics 8002.
- **`up`:** the series `up{job,instance}` is 1 or 0 after every scrape.
- **Metric types:**
  - counter: only goes up; it resets on restart, and `rate()` handles the reset;
  - gauge;
  - histogram: `_bucket{le}`, `_sum`, `_count`; cumulative buckets;
  - summary: client-side quantiles, which can't be aggregated.
- **`rate()` window:** use at least 4× the scrape interval (common guidance; verify the wording).
- **Aggregating histograms:** `histogram_quantile(0.99, sum by (le) (rate(x_bucket[5m])))`. Never average per-pod quantiles. The gateway sheet already says this.
- **Alerting rules:** `for:` holds an alert in pending until it has been true for that long. Alertmanager does grouping, inhibition, silences and routing.
- **TSDB retention:** 15 days by default (verify).

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Números de bolsillo: puertos, intervalos, tipos de métrica, funciones de PromQL que más usas | W1 |
| null | `cadena` | La cadena: de una línea de código a una alerta en tu teléfono (instrumentar → /metrics → scrape → TSDB → PromQL → reglas → Alertmanager → notificación; y Grafana) | W1 |
| 1 | `que-es` | Qué es el monitoreo y qué hacen Prometheus y Grafana (métricas, logs y trazas; pull; quién hace qué) | W1 |
| 2 | `metricas` | El modelo de datos: nombre, labels, series, muestras; counter, gauge, histogram y summary; nombres y cardinalidad | W1 |
| 3 | `instrumentar` | Instrumentar tu código y usar exporters (prometheus_client, el gateway del C01, Triton en 8002, node_exporter, kube-state-metrics, cAdvisor) | W1 |
| 4 | `scrape` | Configurar el scrape: prometheus.yml, jobs, targets, relabeling básico, `up`, la página de Targets | W1 |
| 5 | `promql` | PromQL básico: selectores y matchers, instant contra range vectors, rate/increase/irate, sum by, topk, offset, errores típicos | W2 |
| 6 | `histogramas` | Histogramas y percentiles: buckets y `le`, histogram_quantile, sumar entre pods, por qué no promediar p99, native histograms | W2 |
| 7 | `reglas` | Recording rules y alerting rules: expr, for, labels, annotations, keep_firing_for; las alertas del C01; buenas prácticas | W2 |
| 8 | `alertmanager` | Alertmanager: ruteo, agrupación, inhibición, silencios, receivers; de alerta a página | W2 |
| 9 | `grafana` | Grafana: data sources, dashboards, paneles (time series, stat, heatmap), variables, unidades, umbrales, dashboards como código | W2 |
| 10 | `slos` | Golden signals, RED/USE, SLI/SLO/error budget, alertas por burn rate (multi-ventana) con el SLO del C01 | W3 |
| 11 | `kubernetes` | En Kubernetes: kube-prometheus-stack, el Operator (ServiceMonitor, PodMonitor, PrometheusRule), kube-state-metrics contra cAdvisor contra node_exporter, KEDA leyendo Prometheus | W3 |
| 12 | `diagnostico` | Diagnóstico: el método y la tabla de síntomas (target DOWN, no data, NaN, resets, cardinalidad, alerta que no dispara o que dispara de más, "No data" en Grafana) | W3 |
| 13 | `errores` | Errores que debes reconocer rápido (Prometheus, PromQL, Alertmanager, Grafana, prometheus_client) | W3 |

## Extra keys
### W2 adds `revisor`
14–18 rules for a reviewer of Prometheus rule files (YAML with `groups[].rules[]`, or a PrometheusRule CR). The page parses the YAML with js-yaml. Each rule has this shape:
```
{ "id": "alerta-sin-for", "severity": "error|warn|info",
  "check": "precise rule the builder can implement over the parsed rule object (fields alert/record/expr/for/labels/annotations) and regexes over expr",
  "message": "aviso corto", "why": "por qué importa, simple", "fix": "1 frase",
  "example_bad": "YAML mínimo que la dispara", "example_good": "YAML mínimo que no" }
```
- **Cover:**
  - an alert without `for`;
  - no `severity` label;
  - no `summary`/`description` annotation;
  - `rate`/`increase` over a metric not ending in `_total`/`_count`/`_sum`/`_bucket` (likely a gauge);
  - a range window shorter than 4× the scrape interval (use 15s → at least 1m, and explain);
  - `histogram_quantile` without `le` in its `by`;
  - `irate` in an alert;
  - a division without protecting against 0 (for ratios);
  - a recording rule name not following `level:metric:operations`;
  - an alert on a cause instead of a symptom (info, heuristic);
  - absence alerts (`absent`) suggested for critical series;
  - very high `for` on paging alerts;
  - a hard-coded instance in an alert;
  - and so on.
- **C01:** `reference/c01/monitoring/alerts.yml` must give **0 findings**. Test it yourself with a small JS or Python harness in your scratch folder (js-yaml is not installed; write a minimal parser, or use Python's yaml if available without installing, and say which you used), and report the results.

### W3 adds `diagnosticador` and `errores`
- **`diagnosticador`:** 14 symptoms, each `{ "symptom", "causes": [ { "cause", "check", "fix" } ] }`.
- **`errores`:** 26 real messages, each `{ "msg", "meaning", "first", "topic" }`. Topics map to sections:

  | topic | section |
  |---|---|
  | conceptos | `que-es` |
  | modelo | `metricas` |
  | cliente | `instrumentar` |
  | scrape, config | `scrape` |
  | promql | `promql` |
  | histograma | `histogramas` |
  | reglas | `reglas` |
  | alertmanager | `alertmanager` |
  | grafana | `grafana` |
  | slo | `slos` |
  | kubernetes, operator | `kubernetes` |
  | otro | `diagnostico` |

## Section schema and figures
- **Schema:** the same as the other sheets: `{ id, num, title, question, templates[{code,note}], formulas[], vars[], pieces[], example{title,lang,code,source,notes}, figure{kind,caption,data}, memo, trap, lab{goal,steps[{cmd,expect}],fix,needs,verified}, links[] }`.
  - Read `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w1.json` for shape and depth.
  - Only `memo`, `trap`, `note` and `notes` may contain `<b>`/`<code>`.
- **Figure kinds.** Give clean, short data, to scale where there are numbers.
  - `pull`: Prometheus scraping targets every 15 s (who asks whom), versus push.
  - `series`: one metric name fanning out into series by labels, as a table/tree (cardinality).
  - `types`: a counter (sawtooth with a reset), a gauge, and histogram buckets, as small charts to scale.
  - `rate`: a counter over time and the slope `rate()` computes, with the window.
  - `buckets`: cumulative `le` buckets, and how `histogram_quantile` interpolates p99.
  - `alert-states`: inactive → pending (for) → firing → resolved, as a timeline.
  - `routing`: the Alertmanager routing tree, grouping, inhibition.
  - `dashboard`: a Grafana dashboard layout for C01 (rows, panels, variables).
  - `burn`: an error budget burning at 1× vs 14.4×, with multi-window alerts.
  - `operator`: the Prometheus Operator watching ServiceMonitor → generated scrape config → targets.
  - `chain` and `table`.

## Labs
- **What the learner can run:**
  - Prometheus and Grafana locally with Docker Desktop (`docker run prom/prometheus:<version>`, `grafana/grafana:<version>`), or in a Python venv with `prometheus_client`.
  - Mark labs `"verified": "docs"` unless you really ran them.
- **What you may run (never install anything):**
  - stdlib-only Python: compute `rate` from samples, the `histogram_quantile` linear interpolation, a burn-rate calculation;
  - any existing venv that already has `prometheus_client`. Check `~/Documents/ML_from_scratch/.venv` and other existing venvs; use them read-only.
  - Mark what you ran `"executed"` with a `verified_note`.
- **Folder:** labs use `~/lab-prom` and clean up with `rm -rf ~/lab-prom` plus `docker rm -f …`.

## Quality bar, output, report
- **Quality:** correct first, then short. Use exact excerpts from the real files.
- **Do NOT:**
  - run docker, kubectl or aws;
  - install anything;
  - log in anywhere.
- **Output:** one JSON per writer at `/private/tmp/claude-501/-Users-USER-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/prom/content-<writer>.json`, validated with node.
- **Report** (English, brief):
  - what you wrote;
  - the URLs you checked;
  - versions (pinned vs current);
  - anything uncertain.
