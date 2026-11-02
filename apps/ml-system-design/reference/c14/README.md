# Caso c14 — archivos de referencia (pronóstico nocturno de demanda para un supermercado)

Archivos **reales** del caso c14 de *Ronda de Diseño ML*: el calendario de México (feriados de la Ley
Federal del Trabajo, quincenas, Buen Fin y compañía), las features point-in-time del pronóstico directo a
14 días con los días agotados fuera, el entrenamiento por cuantiles (P50 y P90), el backtest por origen
móvil con el gate de promoción, el job nocturno (completitud, imputación, gate, publicación atómica y
fallback), el DAG de Airflow 3 con su Deadline Alert y su guardia, y las 8 alertas con sus tests. Cada
archivo está comentado explicando **por qué**.

Los números del caso (≈ 400 tiendas, ≈ 4.8 M series, horizonte de 14 días, publicación a las 03:30, ERP a
las 04:00, ≤ 5 % de tiendas imputadas, banda de ±30 %, gate de 2 puntos de WAPE) son **estimaciones**.
Umbrales, recursos y costos que no vienen del caso son **ilustrativos** y están marcados así en cada
archivo. Los datos de los tests son **sintéticos**: sirven para probar el código, no dicen nada de la
calidad de un modelo real.

## Estructura

```
c14/
├── features/
│   ├── calendar_mx.py       # feriados del art. 74 de la LFT (lunes, 1 de octubre sexenal), quincenas con
│   │                        #   corrimiento al día hábil anterior (SUPUESTO), eventos fijos y anunciados
│   ├── retail_events.yaml   # fechas del Buen Fin y del Hot Sale por año (dato, no código); falta un año →
│   │                        #   el job falla en voz alta si el horizonte, con los 30 días que mira
│   │                        #   days_to_<evento>, toca su ventana
│   ├── build_features.py    # panel series × días, corte en run_date, agotados como NaN, faltante ≠ 0,
│   │                        #   lags del mismo día de la semana, plan de promos as-of, filas directas h = 1…14
│   └── tests/               # test_calendar_mx.py (10), test_build_features.py (11: sin leakage, máscara,
│                            #   imputación, días antes del alta)
├── train/
│   ├── synthetic.py         # datos SINTÉTICOS: semana, quincenas, promos, eventos, agotados ligados a la demanda
│   ├── train_quantile.py    # HistGradientBoosting quantile 0.5/0.9 con jittering de conteos, vocabulario
│   │                        #   fijo, rearrangement, seasonal naive, guardar/cargar con chequeo de versión
│   ├── backtest.py          # WAPE, sesgo, pinball, cobertura por segmento; origen móvil sin leakage; gate
│   ├── requirements.txt     # lock de la imagen del job (14 paquetes): entrena Y corre la noche
│   └── tests/               # test_train_quantile.py (7), test_backtest.py (7)
├── batch/
│   ├── run_forecast.py      # el job: completitud → features → predict → partición inmutable → gate →
│   │                        #   compare-and-swap del puntero | fallback corrido (sin features); métricas al
│   │                        #   Pushgateway; CLI
│   ├── validate_output.py   # las 7 reglas del gate, con el detalle de cada una
│   └── tests/               # test_validate_output.py (14), test_run_forecast.py (19)
├── orchestration/
│   ├── forecast_nightly_dag.py  # forecast_nightly (sensores, KubernetesPodOperator, spot → on-demand,
│   │                            #   fallback, Deadline Alert 03:30) + forecast_fallback_guard (03:45)
│   ├── nightly_rules.py     # reglas puras del DAG + el callback del deadline (biblioteca estándar)
│   ├── requirements.txt     # Airflow 3.3.2 + provider de Kubernetes, SOLO para validar el DAG
│   └── tests/               # test_nightly_rules.py (5), test_dag.py (5; se salta sin Airflow)
├── monitoring/
│   ├── alerts.yml           # 8 alertas + 4 recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 4 carpetas
└── requirements-dev.txt     # train/requirements.txt + pytest
```

## Orden de lectura sugerido

1. `features/build_features.py` — el docstring (las 4 reglas) y `features_for_origin`: el lag "7" de un
   target a 10 días todavía no pasó; por eso los lags son del mismo día de la semana, el más reciente que
   ya pasó.
2. `train/train_quantile.py` — las 4 trampas del docstring. La 0 se encontró aquí: con 62 % de días en
   cero, el modelo del P50 de scikit-learn se queda en 0 para TODAS las filas, también las que venden 4.
3. `batch/run_forecast.py` — el docstring (la noche en 7 pasos, las reglas del puntero) y `_nightly`.
4. `batch/validate_output.py` — la tabla de reglas y por qué la banda compara medianas con medianas, y solo
   con las series rápidas.
5. `orchestration/forecast_nightly_dag.py` y `nightly_rules.py` — la línea de tiempo de la noche.
6. `train/backtest.py` — métricas con un ejemplo a mano y el corte `target_date ≤ O`.
7. `features/calendar_mx.py` — qué dice la ley y qué es supuesto.
8. `monitoring/alerts.yml` — qué ve cada alerta, y por qué ForecastRunLate no depende de Airflow.

## Una noche de punta a punta

`run_date` = el último día de ventas cerrado. La noche del 15 al 16 de octubre corre con `run_date = 15`
y pronostica `target_date = 16 … 29` (horizontes 1–14).

```
22:00        cierran las tiendas
00:30        forecast_nightly arranca (cron "30 0 * * *" en America/Mexico_City; con CronTriggerTimetable,
             logical_date = 00:30 del 16 → run_date_for() = 15, no la macro `ds`, que va en UTC)
00:30–01:30  wait_sales y wait_stock (sensores en reschedule, poke cada 5 min): terminan cuando reportaron
             las 400 tiendas o a la 01:30, lo que pase antes. Nunca fallan por datos incompletos
≈ 01:30      run_forecast: KubernetesPodOperator con la imagen del job (por digest), spot; ≤ 60 min por
             intento (de la 01:30 a las 03:30 hay 120 = 2 × 60); el tope de 90 min solo corta un intento colgado
               1. completitud: las tiendas sin ventas del 15 se imputan con el mismo día de la semana
                  pasada (el jueves 8), flag imputed_input
               2. retail_events.yaml cubre el horizonte y los 30 días que mira days_to_<evento> (si eso toca
                  noviembre, el Buen Fin del año) o falla
               3. features point-in-time (70 días de historia) + calendario y plan de promos del target
               4. P50/P90 (piezas enteras), rearrangement; si el modelo falla → fallback
               5. partición forecast_daily/run_date=2026-10-15/part-<hash>/ (inmutable; mismo contenido =
                  mismo hash = no se escribe dos veces)
               6. gate sobre lo ESCRITO (7 reglas); si bloquea → fallback
               7. compare-and-swap de forecast_current → el ERP ve la noche nueva de golpe
             si falla: un reintento en on-demand; si también falla → publish_fallback (all_failed)
03:30        Deadline Alert: si el run sigue corriendo o terminó en falla, el triggerer manda la alerta a
             Alertmanager (un run exitoso antes de las 03:30 borra el deadline aunque haya servido el
             fallback; Prometheus tiene su propia ForecastRunLate con la edad del run_date publicado)
03:45        forecast_fallback_guard: si nada del 15 está publicado, publica el fallback
03:55        corte: después, el job ya no mueve el puntero de esta noche (el ERP está por leer)
04:00        el ERP lee forecast_current
mañana       el job de evaluación (no incluido) cruza forecast_daily con las ventas que llegaron:
             WAPE y sesgo de 7 días por segmento → WAPEDegraded, ForecastBiasDrift
```

### Modos y degradación

| Qué falla | Qué se publica | `fallback` / `reason` | Se ve en |
|---|---|---|---|
| Nada | el modelo | `false` / `none` | `forecast_published_fallback{reason="none"} 0` |
| 1–20 de 400 tiendas sin datos (≤ 5 %) | el modelo, con esas tiendas imputadas | `false` / `none` + `imputed_input` | `InputDataIncomplete` (> 2 %) |
| > 5 % de tiendas sin datos | fallback | `true` / `validation_blocked` | `ForecastValidationBlocked`, `FallbackForecastServed` |
| El modelo no carga o el predict lanza | fallback | `true` / `prediction_error` | `FallbackForecastServed` |
| El gate bloquea (escala, nulos, filas, P90 < P50…) | fallback | `true` / `validation_blocked` | `ForecastValidationBlocked` (page) |
| El job truena dos veces (OOM, spot, warehouse, fechas de eventos) | fallback (tarea del DAG) | `true` / `job_failed` | `ForecastRunFailed` → se resuelve con el fallback |
| El DAG se atora (sensor colgado, pod Pending) | fallback del guardia de las 03:45 | `true` / `guard` | Deadline Alert + `ForecastRunLate` |
| El modelo termina después de las 03:55 | nada nuevo: se queda lo que el ERP leyó | — | `forecast_late_not_published 1` |
| Ni Airflow ni el guardia corren | nada | — | `ForecastRunLate` (solo Prometheus + Pushgateway) |

El fallback es el último pronóstico publicado, corrido: si era de ayer, sus horizontes 2…14 pasan a ser
1…13 (mismo día pronosticado, visto desde más cerca) y el día 14 sale del seasonal naive; con dos noches
malas se corre dos días; sin nada publicado, todo es seasonal naive. El ERP **siempre** recibe un
pronóstico, y el fallback también pasa por las reglas de estructura (nunca se publica basura). El del DAG
y el del guardia no arman features, porque el job pudo haber fallado justo ahí (memoria, `price_promo`,
el calendario): su naive solo lee 28 días de ventas e inventario, y si el warehouse no responde, se
publica lo corrido (horizontes 1…13).

### `forecast_daily` (la salida)

`run_date`, `store_id`, `sku_id`, `target_date`, `horizon` (1–14), `p50`, `p90` (piezas enteras: un
cuantil de un conteo es un entero), `model_version` (`gbdt-q-<hash>` o `seasonal_naive`),
`imputed_input`, `fallback`, `new_item` (serie listada hace < 28 días). Entradas (esquemas en
`build_features.py`): `sales_daily`, `stock_daily` (`oos_flag`), `price_promo` (con `published_at` para
leerlo as-of), `series` (surtido con `listed_date`), `store_attrs`, `sku_attrs`, y el calendario.

### Métricas del job (Pushgateway, `job="forecast_nightly"`)

| Métrica | Labels | La usa |
|---|---|---|
| `forecast_published_run_date_seconds` | — | ForecastRunLate (medianoche local del run_date publicado) |
| `forecast_published_fallback` | reason | FallbackForecastServed |
| `forecast_published_timestamp_seconds`, `forecast_rows_published` | — | dashboards |
| `forecast_last_success_timestamp_seconds`, `forecast_last_failure_timestamp_seconds` | — | ForecastRunFailed |
| `forecast_input_stores_expected`, `forecast_input_stores_imputed` | — | InputDataIncomplete |
| `forecast_validation_blocked` | — | ForecastValidationBlocked |
| `forecast_validation_failed_checks` | check | el runbook de ForecastValidationBlocked |
| `forecast_quantile_crossing_ratio`, `forecast_run_duration_seconds`, `forecast_late_not_published` | — | dashboards |

Cada intento empuja con **pushadd** (solo reemplaza las métricas del mismo nombre) un registro nuevo que
trae SOLO lo que pasó en ese intento: un Gauge de `prometheus_client` sin labels se exporta con 0 aunque
nadie lo toque, y ese 0 pisaría en el Pushgateway el último éxito real. Un test exige que cada
`forecast_*` de `alerts.yml` (salvo las del job de evaluación) exista en lo que empuja el job.

Métricas de otros componentes (no están aquí; solo en los tests de promtool):
`forecast_eval_wape_7d{segment}`, `forecast_eval_bias_7d{segment}`, `forecast_eval_wape_backtest{segment}`,
`forecast_eval_bias_backtest{segment}` (job diario de evaluación: horizontes 1–2, días sin agotado) y
`retail_oos_rate_7d{segment}` (job diario de inventario).

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Pipeline | `ForecastRunLate` | el run_date publicado tiene > 51.5 h desde su medianoche (la noche siguiente no llegó a las 03:30), o no hay métrica; 1 min | page |
| Pipeline | `ForecastRunFailed` | la última falla es más nueva que el último éxito (o nunca hubo éxito); 5 min | page |
| Pipeline | `InputDataIncomplete` | > 2 % de tiendas imputadas (el gate bloquea en 5 %); 5 min | ticket |
| Pipeline | `ForecastValidationBlocked` | el gate bloqueó la noche; 1 min | page |
| Pipeline | `FallbackForecastServed` | lo publicado es un fallback (label `reason`); 1 min | ticket |
| Modelo | `WAPEDegraded` | WAPE de 7 días > WAPE del backtest + 5 puntos, por segmento; 1 h | ticket |
| Modelo | `ForecastBiasDrift` | el sesgo de 7 días se mueve > 10 puntos contra el del backtest; 1 h | ticket |
| Negocio | `StockoutRateUp` | agotados de 7 días > 1.25× la semana anterior y > 6 %; 6 h | ticket |

Dos trampas de estas reglas: el sesgo del P50 **no es 0 por diseño** (con demanda asimétrica la mediana
queda abajo de la media: ≈ −21 % en el backtest sintético, ≈ −70 % en las series lentas), así que
`ForecastBiasDrift` compara contra el sesgo del backtest y no contra cero; y las métricas de un batch se
sirven en cada scrape (el Pushgateway lo hace solo): con una muestra por hora, el lookback de 5 min deja la
serie "ausente" y el `absent()` de ForecastRunLate dispararía por error (los tests usan series por minuto
por eso).

## Correr los tests (sin warehouse, sin Spark, sin Airflow)

```bash
cd reference/c14
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 73 tests + 1 archivo que se salta (test_dag.py)

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 5 s
```

El DAG, con Airflow de verdad (otro venv: Airflow trae ≈ 700 dependencias fijadas por sus constraints):

```bash
python3 -m venv .venv-airflow && . .venv-airflow/bin/activate
pip install -r orchestration/requirements.txt \
  -c https://raw.githubusercontent.com/apache/airflow/constraints-3.3.2/constraints-3.13.txt
pytest orchestration/tests                          # 10 tests: los 5 del DAG ya no se saltan
```

## Demo local del job (todo falso salvo el modelo)

```bash
cd reference/c14/batch
export PYTHONPATH=../features:../train
python run_forecast.py nightly --run-date 2026-10-14 --demo-dir /tmp/c14-demo   # entrena (≈ 10–30 s) y publica
python run_forecast.py nightly --run-date 2026-10-14 --demo-dir /tmp/c14-demo   # already_published (mismo hash)
python run_forecast.py fallback --run-date 2026-10-15 --demo-dir /tmp/c14-demo  # el pronóstico del 14, corrido
python run_forecast.py nightly --run-date 2026-10-15 --demo-dir /tmp/c14-demo   # el modelo reemplaza al fallback
python run_forecast.py nightly --run-date 2026-10-14 --demo-dir /tmp/c14-demo   # stale: nunca hacia atrás
cat /tmp/c14-demo/forecast_current.json
```

La demo usa un warehouse en memoria con datos sintéticos (6 tiendas × 20 SKUs, del 1 de septiembre de 2025
en adelante), particiones Parquet y un puntero JSON en `--demo-dir`, e imprime en stdout las métricas que
empujaría al Pushgateway. La demo simula las 02:00 de la noche de cada `--run-date`; el corte de las 03:55
lo prueban los tests.

## Desplegar (resumen)

Faltan los adaptadores reales, que no se publican porque no se pudieron probar aquí: `Warehouse` (las
lecturas del día, con el plan de promociones as-of y `reported_stores` desde la carga del POS),
`PartitionStore` (una tabla en formato abierto —Iceberg/Delta— donde sobrescribir una partición es un
commit atómico), `Publisher` (una fila de control con `UPDATE … WHERE partition = :esperado` como
compare-and-swap; en motores con DDL transaccional —Postgres, Redshift— `CREATE OR REPLACE VIEW
forecast_current` en la misma transacción; en Snowflake o BigQuery, en un segundo paso idempotente que el
job repite si muere entre los dos y que regenera la vista desde la fila de control) y `MetricsSink`
(`pushadd_to_gateway`). Imagen: `train/requirements.txt` + el código de `features/`, `train/` y `batch/`,
`OMP_NUM_THREADS` igual a los cores pedidos, entrypoint `python run_forecast.py`. El modelo sale del
registry con `train_quantile.load(ruta)`, que se niega a cargar con otra versión de scikit-learn. En
Airflow: la conexión `warehouse`, `nightly_rules.py` en el bundle de DAGs **y** donde lo importe el
triggerer (el callback del deadline), y Karpenter con los dos tipos de capacidad.

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin warehouse, sin Spark, sin Kubernetes, sin Pushgateway y sin daemon
de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 4 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.16 y 3.12.15 | 73 passed + test_dag.py saltado (sin Airflow); ≈ 45 s con la máquina libre, ≈ 3 min con otros procesos pesados |
| Sin leakage | features con TODO lo posterior a run_date envenenado (ventas ×100 + 7, agotados al revés) y con los datos cortados en run_date | idénticas, valor por valor |
| Censura | dos modelos, con y sin la máscara de agotados, contra la demanda VERDADERA del generador | sin máscara: sesgo del P50 ≈ −34 % (≈ −49 % en promos) contra ≈ −15 % (≈ −17 %); P90 ≈ 6 % menor y cobertura en promos 0.88 contra 0.91 |
| El P50 congelado | HistGradientBoosting quantile 0.5 con 62 % de ceros (scikit-learn 1.9.1) | predice 0 para todas las filas; con jittering, ≈ 4 en las rápidas y 0 en las lentas |
| Backtest | 2 orígenes semanales, datos sintéticos | WAPE ≈ 0.60 contra ≈ 0.86 del seasonal naive; cobertura del P90 ≈ 0.95 (≈ 0.97 en las lentas: entero, ≥ 90 % por construcción) y la estricta, A < P90, ≈ 0.82 (≤ 90 %: calibrado); sesgo del P50 ≈ −21 % (≈ −70 % en las lentas) |
| El job | fakes del warehouse y del Pushgateway, partición Parquet y puntero JSON de verdad, reloj inyectable | noche normal, re-run idempotente, 1 y 2 tiendas sin datos, modelo roto, dos noches malas, escala ×10, ×2 y ×0.45 en una noche sin eventos, guardia sin features (su día 14 es idéntico al naive del job), corte de las 03:55, run viejo, fechas de eventos faltantes, warehouse caído (el fallback del DAG publica 1…13), bloqueo de ayer con falla temprana, swap concurrente, Pushgateway caído: cada uno sale por el camino esperado |
| La CLI | `run_forecast.py nightly/fallback/ensure-published --demo-dir` | las 5 llamadas de la demo de arriba dan published, already_published, published (fallback), published y stale, también con el reloj de la máquina después de las 03:55 (la demo simula las 02:00) |
| La banda por categoría | el modelo real cada 2 noches: 129 del conjunto de los tests y 222 de cuatro conjuntos de la demo (semillas 0–3); la regla anterior (todas las series, calendario de 35 días, promo ≥ 10 %) contra la nueva | noches buenas bloqueadas: 0, 0, 178, 20 y 15 → 0, 0, 50, 1 y 11 (las 50 de la semilla 1 son un modelo que pronostica bajo una categoría); un error ×2 atrapado en 41–104 → 105–161 noches por conjunto |
| El fallback sin features | 10,000 series sintéticas, `tracemalloc` | ≈ 220 B por fila contra ≈ 725 B del job con features (no cuenta los buffers de Arrow) |
| El DAG | Airflow **3.3.2** + apache-airflow-providers-cncf-kubernetes **10.22.0** (constraints oficiales) en un venv aparte: import, forma, timetable del scheduler, plantillas, serialización; además DagBag sin errores de import (con una base SQLite local) | 10 passed; logical_date = 00:30 locales → deadline 03:30 locales; `run_date_for` = 15 |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 12 reglas OK; los tests de las 8 alertas pasan; 14 mutaciones (umbrales al otro lado, ramas `absent`/`unless` quitadas, `for` más largo, `abs` quitado) hacen fallar algún test |
| Sintaxis | `python -m py_compile` de todos los `.py`; YAML con PyYAML | OK |
| Lock | `uv pip compile` para Linux x86_64 y Python 3.13 | 14 paquetes; idéntico para macOS arm64 |

**No verificado** (requiere warehouse, Spark, Kubernetes, Airflow corriendo o datos reales):

- El DAG nunca corrió: no hay scheduler, triggerer, Kubernetes ni warehouse. El SQL de los sensores es
  ilustrativo (tablas del caso, estilo de parámetros según el driver). El callback del deadline se probó
  como función, no dentro de un triggerer. Los Deadline Alerts están marcados como experimentales.
- No hay adaptadores reales (warehouse, lake, vista con CAS, Pushgateway); el lock de archivo del puntero
  local es POSIX.
- Escala: el panel denso de pandas corre con cientos de series. Con 4.8 M series × 70 días son ≈ 336 M
  celdas (≈ 1.3 GB en float32, estimación): en producción es Polars/DuckDB en un nodo grande o Spark (el
  trade-off del caso), y los tiempos del caso (features 20–40 min, predict 2–3 min) no se midieron aquí.
- LightGBM no carga en esta máquina (falta libomp): el modelo es HistGradientBoosting de scikit-learn. Que
  el quantile de LightGBM no se congela con mayoría de ceros sale de leer su código, no de una corrida
  (src/objective/regression_objective.hpp: con predicción = venta el gradiente es 1 − α, distinto del −α
  de una fila con venta, así que los splits ganan): la prueba es barata si tus series tienen más de la
  mitad de días en 0.
- Las fechas del Buen Fin 2026 vienen de notas de prensa que citan a los organizadores (confírmalas); la
  regla de las quincenas en fin de semana es un supuesto; `election_days` y `school_vacations` están vacías
  a propósito.
- Umbrales del gate y de las alertas, recursos del pod y multiplicadores del generador son ilustrativos.

No incluidos a propósito (se describen en el caso): el job diario de evaluación (WAPE/sesgo vivos), el
entrenamiento semanal orquestado y el registry, los productos nuevos por SKUs análogos y las tiendas nuevas
por clúster, la tienda piloto contra control (diferencias en diferencias), el ERP y los overrides de los
gerentes.
