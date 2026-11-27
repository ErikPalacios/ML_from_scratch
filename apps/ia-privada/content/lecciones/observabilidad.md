---
titulo: Observabilidad de GPUs e inferencia
en: Observability for GPUs and inference
subtitulo: Qué medir todo el tiempo en un servidor de LLMs propio (la GPU, el motor, la búsqueda, el gateway y la fila), con los nombres reales de las métricas a noviembre de 2026, y cómo lo vigila un equipo de TI de dos personas que nunca operó una GPU.
pregunta: El servidor ya está en el cuarto y los 200 abogados lo usan. Un martes a las 12:30 alguien escribe «está lentísimo». ¿Qué hay que medir todo el tiempo para saber, antes de que llamen, si el problema es la GPU, el motor, la búsqueda, el gateway o la fila, y cómo lo vigila un TI de 2 personas que nunca operó una GPU?
sensei: e12-monitoreo, e11-request, percentiles, latencia, cpu-gpu
dojo: observabilidad
---

:::idea
La [[observabilidad]] de un servidor de LLMs propio es tener, **antes** de que alguien se queje, los números que dicen dónde se va el tiempo de cada pregunta: la GPU (calor, reloj, errores), el motor (la fila y su memoria), la búsqueda, el gateway y la carga. Casi todos esos números ya los publica cada pieza; el trabajo es juntarlos, saber cuáles engañan («GPU al 100 %», «memoria al 95 %») y convertir los pocos que importan en un tablero y seis alertas con su instrucción de tres líneas.
:::

## «Está lentísimo» {“It's so slow”}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que le pregunta a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Lo usan **200 personas**, ≈ **3,000 preguntas al día** en 10 horas, con una hora pico de 2.5 veces el promedio: **750 preguntas en esa hora**, ≈ 0.21 por segundo. Cada pregunta lleva ≈ **6,000 tokens de entrada** y la respuesta ≈ **500**. La promesa: [[ttft|tiempo al primer token]] ≤ 2 s en el p95 y ≥ 20 tokens/s por persona.

Detrás corre Qwen3 32B en INT4 de [[awq|AWQ]], con el razonamiento apagado, en **3 L40S** dentro de un servidor de rack: tres [[replica|réplicas]], cada una un proceso de [[vllm|vLLM]] 0.34.0 con `--max-num-seqs 8`. Delante, el [[gateway-de-llm|gateway]] LiteLLM 1.111.0 y la interfaz Open WebUI 0.13.5, con el inicio de sesión de Microsoft. La búsqueda en los expedientes ([[rag|RAG]]) usa Qwen3-Embedding-0.6B y la [[vector-db|base de vectores]] Qdrant 1.20.2, en el mismo servidor. El equipo de TI son **2 personas** que saben de redes y de Windows y nunca han operado una GPU.

Un martes, a las 12:30, llega un mensaje: «está lentísimo». Hay cinco sospechosos, y cada uno pide algo distinto:

- **La GPU**: se calentó y bajó su reloj, o el driver reportó un error y una réplica murió.
- **El motor**: vLLM se quedó sin memoria para las conversaciones y está recalculando.
- **La búsqueda**: Qdrant tarda medio segundo en vez de 150 ms.
- **El gateway**: LiteLLM se atoró con sus propios procesos.
- **La fila**: no se rompió nada; simplemente llegaron más preguntas de las que caben.

Sin números, el TI reinicia el servidor: corta todas las conversaciones y, si era la fila, no arregla nada. Con números, sabe desde las 12:24 que la réplica 2 dejó de contestar, o que solo vino pesada la hora pico.

### Lo que ya sabes de Sensei

Esto ya lo explica Sensei; aquí solo se recuerda:

- [Monitoreo](https://sensei.trueml.app/e12-monitoreo/): las capas que se vigilan, las señales de un servicio (latencia, tráfico, errores, saturación), que una alerta buena se mantiene un rato antes de avisar (`for: 10m`) y dice qué hacer, el *burn rate*, los tableros, los *runbooks* y la guardia.
- [La request en vivo](https://sensei.trueml.app/e11-request/): métricas, logs y trazas como tres maneras de mirar; contadores, gauges e histogramas; Prometheus y su lenguaje de consultas; y por qué no todo puede ser etiqueta.
- [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/) (percentiles desde *buckets*), [Latencia y throughput](https://sensei.trueml.app/latencia/) (la fila cerca del 100 %) y [CPU y GPU](https://sensei.trueml.app/cpu-gpu/) (qué mide el «GPU-Util»).

Lo nuevo aquí es lo que cambia con el modelo **en tu hardware**: nadie más vigila la tarjeta; el motor tiene su propia fila y su propia memoria; una pregunta cruza cuatro programas; el texto es secreto profesional y no se guarda para depurar; y vigilan dos personas.

:::analogia El tablero del coche y el escáner del taller
El tablero de un coche trae pocas cosas (velocidad, gasolina, temperatura, una luz de «revisar motor») y bastan para manejar. Cuando la luz prende, el mecánico conecta un escáner que lee cientos de números y dice qué falló. La observabilidad es tener **las dos cosas**: un tablero de 8 paneles que el TI mira cada mañana y, detrás, todos los números guardados 90 días.

**Dónde se rompe:** el coche trae su escáner de fábrica y un estándar para conectarlo. En el servidor, cada pieza publica sus números a su manera, con nombres que cambian entre versiones, y alguien tiene que juntarlos, elegir cuáles prender y decidir cuáles despiertan a quién.
:::

## De dónde salen los números: exporters, Prometheus y Grafana {Where the numbers come from: exporters, Prometheus and Grafana}

### Métrica y serie de tiempo

Una [[metrica|métrica]] (*metric*) es un número con nombre que un programa mantiene mientras trabaja, más unas **etiquetas** (*labels*) que dicen de qué es. Por ejemplo, vLLM mantiene cuántas preguntas tiene esperando turno:

```text
vllm:num_requests_waiting{engine="0",model_name="qwen3-32b"} 0
```

El nombre es `vllm:num_requests_waiting`; las etiquetas, `engine` y `model_name`; el valor, 0. Anotado cada 15 segundos, sale una [[serie-de-tiempo|serie de tiempo]] (*time series*): la lista de parejas (hora, valor) de **una** métrica con **un** juego de etiquetas. Tres réplicas son tres series de la misma métrica.

Sensei ya explicó los tres tipos de métrica, que aquí aparecen todo el tiempo:

- **Contador** (*counter*): solo sube, desde que arrancó el programa. `vllm:prompt_tokens_total` lleva los tokens de entrada procesados. Su valor suelto no dice mucho; lo útil es cuánto subió por segundo (`rate`).
- **Gauge**: sube y baja; es una foto del momento. La fila de arriba es un gauge.
- **[[histograma|Histograma]]**: un juego de contadores, uno por cada borde de tiempo, que cuentan cuántas mediciones cayeron debajo de cada borde. Es como se guarda el TTFT de miles de preguntas sin guardar cada una. Tiene su propia sección, la que sigue.

### Quién los publica: `/metrics` y los exporters

Cada pieza publica sus métricas en una dirección web, casi siempre `/metrics`, como texto con un formato fijo: líneas `# HELP` (descripción), `# TYPE` (tipo) y una por serie con su valor. vLLM, LiteLLM y Qdrant las publican solos. Lo demás necesita un [[exporter]]: un programa chico que lee el estado de algo y lo traduce a un `/metrics`. El despacho usa dos:

- **`dcgm-exporter`**, de NVIDIA, para las GPUs (puerto 9400). Lo ves en la sección de la GPU.
- **`node_exporter`** (1.13.1 a noviembre de 2026), del proyecto Prometheus, para la máquina: CPU, memoria del sistema, discos y red.

### Quién los junta: Prometheus

[[prometheus|Prometheus]] (3.16.0, del 5 de noviembre de 2026, licencia Apache 2.0) es una base de datos de series de tiempo que **va a pedir** los números: cada cierto intervalo, el *scrape interval*, visita el `/metrics` de cada pieza de su lista, lee el texto y guarda cada valor con su hora. Eso se llama *scrape* (raspar). Datos de su documentación:

- El intervalo por omisión es de **1 minuto**, y se espera hasta 10 s cada respuesta. El ejemplo oficial de vLLM usa 5 s. El despacho propone **15 s**: suficiente para ver una fila que dura un minuto, sin llenar el disco. `dcgm-exporter` lee la GPU cada **30 s** por omisión, así que pedirle más seguido no da datos nuevos.
- Guarda en el disco local. Si no se le dice otra cosa, **borra lo de más de 15 días**. El despacho fija 90 días (`--storage.tsdb.retention.time=90d`), como su registro: así un «¿por qué el martes pasado…?» todavía tiene respuesta.
- Cada pieza de su lista que no contesta queda marcada gratis: Prometheus escribe la serie `up` con 1 si el scrape funcionó y 0 si no. **Una réplica caída se ve como `up == 0`**, sin que la réplica tenga que avisar nada.
- Cada minuto (el *evaluation interval*, 1 min por omisión) revisa las reglas de [[alerta|alerta]] y le pasa las que se cumplen a **Alertmanager** (0.35.1), que las agrupa y las manda por correo.

:::analogia El enfermero que pasa cada 15 minutos
En un hospital, el enfermero recorre los cuartos cada cierto tiempo y anota en la hoja de cada paciente su pulso y su temperatura. Prometheus hace lo mismo: no espera a que le avisen, pasa a leer. Si un paciente no contesta, eso también se anota, y es lo más urgente.

**Dónde se rompe:** el enfermero solo ve lo que pasa cuando entra. Con los **gauges** pasa igual: una fila que subió a 5 y bajó a 0 entre dos visitas no queda en ninguna hoja. Los **contadores** sí tienen memoria: si en 15 s pasaron 3 preguntas, el contador subió 3 aunque nadie mirara. Por eso lo que no se puede perder (preguntas, errores, tokens, *preemptions*) se cuenta con contadores e histogramas, y los gauges se leen como fotos.
:::

### Quién los dibuja: Grafana

Grafana (13.3.2, del 24 de noviembre de 2026) dibuja las gráficas: un [[tablero]] (*dashboard*) es una página con paneles, cada uno con una consulta a Prometheus. Dos detalles para un despacho que no deja salir nada:

- Su licencia es **AGPL-3.0**, como la de k6 en [Pruebas de carga](/pruebas-carga/). Usarla dentro del despacho sin modificarla no obliga a publicar nada ([Licencias](/licencias/); no es consejo legal).
- A noviembre de 2026, Grafana 13.3.2 trae **prendida** la [[telemetria|telemetría]] hacia afuera: `reporting_enabled = true` (contadores de uso a `stats.grafana.org` cada 24 horas), `check_for_updates`, `check_for_plugin_updates` y las instantáneas en un servidor externo. En el despacho se apagan las cuatro; cerrar la [[firewall-de-salida|salida a internet]] es tema de [Seguridad](/seguridad/).

:::diagrama observabilidad-camino
El camino de un número en el despacho: cada pieza lo publica en su `/metrics`, Prometheus pasa a leerlo cada 15 s y lo guarda 90 días, Grafana lo dibuja y Alertmanager le escribe al TI cuando una regla se cumple. Toca cada caja o sigue el recorrido.
:::

## El p95 desde un histograma, y lo que sus buckets no ven {The p95 from a histogram, and what its buckets miss}

La promesa del despacho es un percentil: TTFT ≤ 2 s en el p95. Prometheus no guarda el TTFT de cada pregunta; guarda el [[histograma]] que publica vLLM. Hay que saber sacar el p95 de ahí, y saber cuándo miente.

### Lo que hay en el histograma

vLLM publica `vllm:time_to_first_token_seconds` como una serie por cada **borde** (`le`, *less or equal*): cuántas preguntas, desde que arrancó, tuvieron un TTFT menor o igual a ese borde. Los conteos son **acumulados**: el del borde 2.0 incluye todas las del 1.5. Hay además un borde `+Inf` (todas), un `_sum` (la suma de los tiempos) y un `_count` (cuántas). Como son contadores, para hablar de «los últimos 10 minutos» se mira cuánto subió cada uno en esa ventana.

La consulta que da el p95 de los últimos 10 minutos, juntando las tres réplicas, es:

```text
histogram_quantile(0.95, sum by (le) (rate(vllm:time_to_first_token_seconds_bucket[10m])))
```

De adentro hacia afuera: `rate(…[10m])` da «cuánto subió por segundo en los últimos 10 minutos»; `sum by (le)` suma las tres réplicas borde por borde; `histogram_quantile(0.95, …)` busca el bucket donde cae el lugar 95 % y **adivina** la posición dentro de él, suponiendo que sus preguntas se reparten parejo.

:::formula El p95 de un histograma, como lo calcula histogram_quantile
r = q × N
p = b_{ant} + (b − b_{ant}) × frac{r − c_{ant}}{c − c_{ant}}
- q: el percentil buscado, como fracción (0.95 = el p95)
- N: cuántas preguntas hay en la ventana (el conteo del bucket `+Inf`)
- r: el lugar buscado, contando desde la más rápida
- b: el primer borde cuyo conteo acumulado \(c\) es ≥ r, en s
- b_{ant}, c_{ant}: el borde anterior y su conteo acumulado (0 y 0 si es el primero)
- p: el percentil estimado, en s. Si el lugar cae en el bucket `+Inf`, Prometheus devuelve \(b_{ant}\)
:::

Un ejemplo escrito a mano: una ventana de 10 minutos en la hora pico, con unos bordes que el despacho eligió (más abajo se ve por qué no son los de fábrica). En 10 minutos a 0.21 por segundo llegan 125 preguntas, y lo que subió cada bucket fue: ≤ 1.0 s: 3; ≤ 1.5 s: 70; ≤ 2.0 s: 112; ≤ 2.5 s: 121; ≤ 3.0 s: 124; `+Inf`: 125.

:::cuenta El p95 de 125 preguntas en 10 minutos
Preguntas en la ventana, \(N\) // el bucket `+Inf` | 0.2083 /s × 600 s | 125
Lugar buscado, \(r\) // \(q × N\) | 0.95 × 125 | 118.75
Primer bucket con \(c ≥ r\) // ≤ 2.0 tiene 112, ≤ 2.5 tiene 121 | — | (2.0, 2.5]
Borde anterior y su conteo, \(b_{ant}\), \(c_{ant}\) | — | 2.0 s y 112
Borde y su conteo, \(b\), \(c\) | — | 2.5 s y 121
Fracción dentro del bucket // \((r − c_{ant}) ÷ (c − c_{ant})\) | (118.75 − 112) ÷ (121 − 112) | 0.75
p95, \(p\) // \(b_{ant} + (b − b_{ant}) ×\) fracción | 2.0 + 0.5 × 0.75 | 2.375 s
= El p95 de esos 10 minutos es ≈ 2.38 s: pasa de los 2 s. Lo que el histograma **sabe** es menos: que está entre 2.0 y 2.5 s.
:::

En Python, con un texto de `/metrics` escrito a mano con los nombres reales de vLLM (ya son los conteos de la ventana, lo que daría `increase(…[10m])`), solo con la biblioteca estándar:

```python
import math, re

METRICS = """# TYPE vllm:time_to_first_token_seconds histogram
vllm:time_to_first_token_seconds_bucket{engine="0",le="1.0",model_name="qwen3-32b"} 3
vllm:time_to_first_token_seconds_bucket{engine="0",le="1.5",model_name="qwen3-32b"} 70
vllm:time_to_first_token_seconds_bucket{engine="0",le="2.0",model_name="qwen3-32b"} 112
vllm:time_to_first_token_seconds_bucket{engine="0",le="2.5",model_name="qwen3-32b"} 121
vllm:time_to_first_token_seconds_bucket{engine="0",le="3.0",model_name="qwen3-32b"} 124
vllm:time_to_first_token_seconds_bucket{engine="0",le="+Inf",model_name="qwen3-32b"} 125"""

acum = {}                                   # {borde: conteo acumulado}
for linea in METRICS.splitlines():
    m = re.search(r'_bucket\{.*le="([^"]+)".*\}\s+(\S+)$', linea)
    if m:
        acum[math.inf if m[1] == "+Inf" else float(m[1])] = float(m[2])

def histogram_quantile(q, acum):
    rango = q * acum[math.inf]              # el lugar buscado, contando desde abajo
    borde_ant, cuenta_ant = 0.0, 0.0
    for borde in sorted(acum):
        if acum[borde] >= rango:
            if borde == math.inf:           # cae en +Inf: devuelve el último borde
                return borde_ant
            fraccion = (rango - cuenta_ant) / (acum[borde] - cuenta_ant)
            return borde_ant + (borde - borde_ant) * fraccion
        borde_ant, cuenta_ant = borde, acum[borde]

for q in (0.50, 0.95, 0.99):
    print(f"p{q*100:.0f} del TTFT: {histogram_quantile(q, acum):.3f} s")
print("preguntas en la ventana:", int(acum[math.inf]))
```

```salida
p50 del TTFT: 1.444 s
p95 del TTFT: 2.375 s
p99 del TTFT: 2.958 s
preguntas en la ventana: 125
```

Lo que este programa no hace y Prometheus sí: corregir cuando un contador vuelve a cero porque el proceso se reinició, devolver `NaN` (no es un número) cuando la ventana está vacía, y sumar varias réplicas.

### La trampa: el histograma de vLLM no tiene un borde en 2 s

A noviembre de 2026, los bordes de fábrica del TTFT en vLLM 0.34.0 son, en segundos: 0.001, 0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.25, 0.5, 0.75, **1.0, 2.5**, 5.0, 7.5, 10, 20, 40, 80, 160, 640 y 2,560. Entre 1.0 y 2.5 no hay nada, y la promesa del despacho, 2 s, cae justo en medio. La documentación de Prometheus lo advierte con un ejemplo propio: si todas las peticiones tardan cerca de 220 ms y el bucket va de 200 a 300 ms, el p95 estimado sale ≈ 295 ms; lo único garantizado es que el verdadero está entre 200 y 300.

:::cuenta Tres horas pico distintas, un solo p95
Bucket de fábrica que contiene 1.1, 1.9 y 2.4 s // los bordes de vLLM 0.34.0 | — | (1.0, 2.5]
Las 125 en 1.1 s (cumple), \(p\) // \(1.0 + 1.5 × (118.75 − 0) ÷ (125 − 0)\) | 1.0 + 1.5 × 0.95 | 2.425 s
Las 125 en 1.9 s (cumple), \(p\) // mismo bucket, misma cuenta | 1.0 + 1.5 × 0.95 | 2.425 s
Las 125 en 2.4 s (no cumple), \(p\) | 1.0 + 1.5 × 0.95 | 2.425 s
Con un borde en 2.0, las de 1.1 s // bucket (1.0, 1.5] | 1.0 + 0.5 × 0.95 | 1.475 s
Con un borde en 2.0, las de 1.9 s // bucket (1.5, 2.0] | 1.5 + 0.5 × 0.95 | 1.975 s
Con un borde en 2.0, las de 2.4 s // bucket (2.0, 2.5] | 2.0 + 0.5 × 0.95 | 2.475 s
= Con los bordes de fábrica, una alerta «p95 > 2 s» se prende igual con 1.1 s que con 2.4 s: no distingue cumplir de no cumplir. Con un borde en 2.0, sí.
:::

:::figura observabilidad-buckets
La misma hora pico vista con dos juegos de bordes. Arriba, los de fábrica de vLLM 0.34.0: entre 1.0 y 2.5 s no hay borde, y tres horas pico distintas dan el mismo p95 de 2.425 s. Abajo, con bordes cada medio segundo, cada una cae en su lugar.
:::

El remedio es nuevo en vLLM 0.34.0: el flag `--custom-histogram-buckets` cambia los bordes de una familia de histogramas al arrancar. La clave de la familia del TTFT es `time_to_first_token`; los valores tienen que ser positivos y estrictamente crecientes, y una clave desconocida hace que el motor no arranque (mejor eso que un error silencioso). Lo que el despacho agregaría al comando de [El stack de serving](/stack-serving/):

```bash
--custom-histogram-buckets '{"time_to_first_token": [0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.5, 10.0, 20.0, 40.0]}'
```

Cada borde extra suma una serie por juego de etiquetas; aquí pasa lo contrario: de 22 bordes a 13, el TTFT baja de 25 series a 16 por réplica.

Los otros histogramas sí sirven tal como vienen: el de la [[itl|latencia entre tokens]] (y el de [[tpot|TPOT]]) tiene un borde en **0.05 s**, exactamente 20 tokens/s; el de la latencia completa, bordes en 20 y 30 s, alrededor de la respuesta de ≈ 27 s; y el de LiteLLM, uno en 2.0.

:::calculadora observabilidad-p95
Mete los conteos acumulados de una ventana y mira en qué bucket cae el percentil y cuánto da la interpolación. Prueba el preajuste «todas en 1.9 s con los bordes de fábrica»: el p95 sale arriba de 2 s aunque todas cumplan.
:::

### Pocas preguntas, poca confianza

El p95 de una ventana es, de hecho, una pregunta: la del lugar \(⌈0.95 N⌉\) de la lista ordenada. Con 125 preguntas (10 minutos de hora pico) es la 119.ª, con 6 arriba; su [[intervalo-del-percentil|intervalo]] de 95 % va de la 114.ª a la 124.ª. En una hora promedio (300 por hora, 50 en 10 minutos) es la 48.ª: la **tercera más lenta**. Tres preguntas lentas bastan para prenderla. Y con cero preguntas, de noche, `histogram_quantile` devuelve `NaN`: la regla no se cumple ni deja de cumplirse, y no avisa. Por eso la alerta del TTFT del despacho pide además un mínimo de tráfico en la ventana, y por eso la promesa se mide en la hora pico.

## La GPU: DCGM y los números que sí dicen algo {The GPU: DCGM and the numbers that actually mean something}

### DCGM y su exporter

[[dcgm|DCGM]] (*Data Center GPU Manager*) es el programa de NVIDIA que lee el estado de las GPUs de un servidor: uso, memoria, potencia, temperatura, relojes, errores. `dcgm-exporter` lo publica en `/metrics`. A noviembre de 2026 la versión es la **4.9.0** (6 de noviembre, Apache 2.0, con DCGM 4.7.0 adentro); escucha en el puerto 9400 y lee cada 30 s. Las métricas que publica las decide un archivo CSV (`default-counters.csv`): las que tienen `#` al inicio están apagadas, y algunas de las que el despacho necesita vienen así.

:::ojo
**La 4.9.0 cambió los nombres y las unidades.** Sus notas lo dicen: renombraron los 23 campos que DCGM 4.7 deja de usar, y once cambian de unidad. `DCGM_FI_DEV_GPU_UTIL` (un porcentaje de 0 a 100) ahora es `DCGM_FI_DEV_GPU_UTIL_RATIO` (una razón de 0 a 1); `DCGM_FI_DEV_FB_USED` (en MiB) ahora es `DCGM_FI_DEV_FB_USED_BYTES` (en bytes); la temperatura es `DCGM_FI_DEV_GPU_TEMP_CELSIUS`, la potencia `DCGM_FI_DEV_BOARD_POWER_WATTS` y el reloj `DCGM_FI_DEV_SM_CLOCK_HERTZ` (de MHz a hertz). Un tablero, un tutorial o un chatbot con los nombres viejos da **paneles vacíos** o con la escala equivocada (un umbral de «90» contra una razón que nunca pasa de 1). La tabla de la documentación de NVIDIA todavía lista los viejos; el CSV del repositorio, lo que el contenedor emite, trae los nuevos. Créele al CSV y confírmalo con `curl localhost:9400/metrics`.
:::

### Por qué «GPU al 100 %» no dice nada

La [[utilizacion-gpu|utilización de GPU]] que reportan `nvidia-smi` y `DCGM_FI_DEV_GPU_UTIL_RATIO` es, según NVIDIA, la parte del tiempo de la última muestra en que **al menos un kernel** estaba corriendo. Sensei lo explica con un estacionamiento: el vigilante anota si había algún coche, no cuántos lugares se ocuparon ([CPU y GPU](https://sensei.trueml.app/cpu-gpu/)).

Con [[batching-continuo|batching continuo]] es peor: mientras haya **una** conversación escribiendo, vLLM lanza un paso tras otro y la utilización marca ≈ 100 % con una persona o con ocho (lo confirma el piloto). Sirve para una sola cosa: si marca 0 con preguntas llegando, la réplica no trabaja.

Lo que sí dice algo son las **métricas de perfilado** de DCGM, que miden adentro del chip:

- **[[sm-activo|SM activo]]**: `DCGM_FI_PROF_SM_UTIL_RATIO` (se llamaba `SM_ACTIVE`). Un SM es uno de los bloques de cómputo de la GPU; la métrica es la fracción del tiempo en que cada SM tenía al menos un grupo de hilos asignado, promediada sobre todos. NVIDIA dice que 0.8 o más es «necesario, pero no suficiente» para un uso eficaz, y que menos de 0.5 probablemente es un uso ineficaz. «Activo» incluye hilos esperando memoria: no es «calculando».
- **DRAM activa**: `DCGM_FI_PROF_DRAM_UTIL_RATIO`, la fracción de ciclos con la memoria de la tarjeta enviando o recibiendo datos. El [[decode]] está limitado por memoria ([[memory-bound]]): leer los pesos para cada token. Esta es la señal de que la GPU está escribiendo respuestas.
- **Tensor activo**: `DCGM_FI_PROF_TENSOR_UTIL_RATIO`, los ciclos con los tensor cores trabajando. Sube en el [[prefill]], que es cálculo puro, y baja en el decode.

SM activo viene **apagado** en el CSV de la 4.9.0 y hay que prenderlo; las otras dos aparecen entre las de fábrica (se confirma con `curl localhost:9400/metrics`). Piden privilegios de administrador, y algunas no se pueden leer juntas: DCGM las alterna por muestreo, así que traen algo de ruido. Sus valores con Qwen3 32B en una L40S no están publicados: se miden en la [[prueba-de-carga|prueba de carga]] del piloto como **línea base**, y lo que importa después es el cambio contra ella.

### La memoria: «95 % usada» es lo normal

vLLM aparta la memoria **al arrancar**: carga los pesos y reserva lo que queda para el [[kv-cache|KV cache]]. En la 0.34.0, sin el flag `--gpu-memory-utilization` (el despacho no lo usa), usa toda la memoria libre. Así que `DCGM_FI_DEV_FB_USED_BYTES ÷ DCGM_FI_DEV_FB_CAPACITY_BYTES` marca casi lleno desde el primer minuto, con cero preguntas, y una alerta de «memoria > 90 %» estaría prendida siempre. (El porcentaje exacto en una L40S se anota en el piloto.) La memoria que sí cambia con la carga es `vllm:kv_cache_usage_perc`, en la sección del motor.

:::figura observabilidad-memoria
Dos números de memoria para la misma réplica. Arriba, lo que ve DCGM: la tarjeta casi llena desde que arranca vLLM, con una pregunta o con ocho. Abajo, lo que ve vLLM: qué parte de su KV cache ocupan las conversaciones en curso, que sí cambia con la carga.
:::

### Potencia, temperatura, reloj y throttling

[El cuarto](/el-cuarto/) pidió vigilar potencia, temperatura y reloj. Con DCGM 4.9.0:

- **Potencia**: `DCGM_FI_DEV_BOARD_POWER_WATTS`, en watts, contra los 350 W de [[tdp|TDP]] de la L40S ([el catálogo](/herramientas/catalogo/)). Y `DCGM_FI_DEV_GPU_ENERGY_JOULES_TOTAL`, la energía acumulada en joules, para comprobar contra el recibo de luz lo que [El cuarto](/el-cuarto/) estimó.
- **Temperatura**: `DCGM_FI_DEV_GPU_TEMP_CELSIUS` y `…_MEMORY_TEMP_CELSIUS`. El umbral no se inventa: hay una métrica opcional, `DCGM_FI_DEV_GPU_TEMP_MARGIN_CELSIUS`, que dice **cuántos grados faltan** para el umbral en que la GPU empieza a frenarse. Se prende y se vigila que no baje.
- **Reloj**: `DCGM_FI_DEV_SM_CLOCK_HERTZ`.

El [[throttling]] (*clock throttling*; NVIDIA ahora dice «eventos de reloj») es cuando la GPU baja su reloj para protegerse, por calor, por potencia u otra razón: calcula más lento, sin ningún error. DCGM cuenta los segundos que pasó frenada por cada razón, en contadores opcionales como `DCGM_FI_DEV_GPU_THERMAL_THROTTLE_SECONDS_TOTAL` (por calor) y `DCGM_FI_DEV_GPU_POWER_THROTTLE_SECONDS_TOTAL` (por potencia). Si el de calor sube en horas de oficina, el problema está en el cuarto: el minisplit, la temperatura del aire que entra por el frente del rack. Esa temperatura no la mide DCGM, la mide el sensor del rack que pidió [El cuarto](/el-cuarto/).

### Errores XID, ECC y PCIe

Un [[error-xid|error XID]] es un mensaje del driver de NVIDIA, con un número, que dice que algo grave le pasó a la GPU. Aparece en el log del kernel de Linux, así:

```text
NVRM: Xid (PCI:0000:5a:00): 79, GPU has fallen off the bus.
```

DCGM 4.9.0 publica el último código en `DCGM_FI_DEV_XID_ERROR` (prendido de fábrica) y, si se prende en el CSV, un contador de XID en `DCGM_EXP_XID_ERRORS_TOTAL` (vuelve a cero cuando el exporter recarga su configuración o la GPU se recupera). Hay decenas de códigos; nadie los memoriza. NVIDIA publica un catálogo con la acción que corresponde a cada uno (reiniciar la aplicación, reiniciar la GPU, llamar a soporte). La instrucción para el TI son tres líneas: copiar la línea completa del log con la hora, buscar el código en el catálogo oficial y hacer lo que dice, y abrir caso con el proveedor del servidor con ese mensaje y la versión del driver.

:::profundo Una tarjeta que se gasta, y nvidia-smi a mano
Dos familias más, para ver una tarjeta que se está gastando: los errores de memoria corregidos y no corregidos (ECC) y las **filas remapeadas** (`DCGM_FI_DEV_ROW_REMAP_CORRECTABLE_TOTAL`, `…_UNCORRECTABLE_TOTAL` y `DCGM_FI_DEV_ROW_REMAP_FAILED`), con las que la L40S aparta las filas de memoria que dieron error; y los reintentos del bus PCIe (`DCGM_FI_DEV_PCIE_REPLAY_TOTAL`). En el CSV de la 4.9.0, las filas remapeadas y los reintentos vienen prendidos; los contadores de ECC (`DCGM_FI_DEV_ECC_…_TOTAL`), apagados. Un contador que sube poco a poco es para revisar en la semana; uno que no corrige es para el proveedor.

**`nvidia-smi`, para mirar a mano.** Para diagnosticar en el momento, con la terminal del servidor, `nvidia-smi` viene con el driver. Lo que el TI necesita:

```bash
nvidia-smi                                   # resumen: memoria, potencia, temperatura, procesos
nvidia-smi dmon                              # una línea por segundo: potencia, temperatura, uso, relojes
nvidia-smi -q -d PERFORMANCE                 # por qué la GPU está bajando su reloj ahora
nvidia-smi --query-gpu=index,temperature.gpu,power.draw,clocks.sm --format=csv
sudo dmesg -T | grep -i xid                  # los XID del log del kernel, con su hora
```

Para las filas remapeadas y las páginas retiradas están `--query-remapped-rows` y `--query-retired-pages`. Las columnas exactas de `dmon` y los nombres de los campos de `--query-gpu` se revisan con `nvidia-smi --help-query-gpu` en el piloto: cambian entre versiones del driver (NVIDIA renombró sus «throttle reasons» a «clock event reasons»).
:::

## El motor: la fila, la memoria y los relojes de vLLM {The engine: vLLM's queue, memory and clocks}

vLLM publica sus métricas en el `/metrics` del mismo puerto que su API, con las etiquetas `model_name` y `engine`. Un detalle que confunde: en el código los contadores se llaman sin sufijo (`vllm:prompt_tokens`), y en el texto de `/metrics` salen con **`_total`** (`vllm:prompt_tokens_total`). Las que el despacho mira, con sus nombres de la 0.34.0:

| Métrica | Tipo | Qué es | Qué dice en el despacho |
|---|---|---|---|
| `vllm:num_requests_running` | gauge | Preguntas dentro del lote que se está calculando | De 0 a 8 por réplica (el tope de `--max-num-seqs 8`) |
| `vllm:num_requests_waiting` | gauge | Preguntas esperando entrar al lote | **La fila del motor.** Casi siempre 0 |
| `vllm:kv_cache_usage_perc` | gauge | Fracción del KV cache ocupada (1 = 100 %) | Cuánta memoria usan las conversaciones en curso |
| `vllm:num_preemptions_total` | contador | Veces que el motor sacó una pregunta del lote por falta de KV cache | Debe quedarse quieto |
| `vllm:time_to_first_token_seconds` | histograma | TTFT dentro del motor | La promesa, menos la búsqueda y el gateway |
| `vllm:inter_token_latency_seconds` | histograma | Cada intervalo entre dos tokens | Línea en 0.05 s (20 tokens/s) |
| `vllm:request_queue_time_seconds` | histograma | Tiempo de cada pregunta en la fila | Sube junto con la fila |
| `vllm:request_prefill_time_seconds` | histograma | Tiempo de cada pregunta en su prefill | ≈ 2.4 s en una L40S sin competencia |
| `vllm:prompt_tokens_total`, `vllm:generation_tokens_total` | contador | Tokens de entrada y de salida procesados | Con `rate`, tokens por segundo |
| `vllm:prefix_cache_queries_total`, `vllm:prefix_cache_hits_total` | contador | Tokens buscados en el cache de prefijos y tokens encontrados | Su cociente es la tasa de aciertos |
| `vllm:request_success_total{finished_reason}` | contador | Preguntas terminadas, por cómo terminaron | Si sube `length`, se cortan respuestas |

### Dos filas: la de calidad y la del motor

El despacho tiene dos líneas en el mismo panel de «conversaciones por réplica», y conviene no confundirlas:

- **2**: el número que, según el [[sizing]], una L40S atiende a ≥ 20 tokens/s con prefills de 6,000 tokens. Pasando de 2, la réplica sigue contestando, pero alguien escribe más lento que la promesa.
- **8**: el tope del motor. Hasta 8, vLLM mete cada pregunta nueva al lote y `vllm:num_requests_waiting` sigue en 0. Del 9 en adelante, la pregunta espera.

Con la [[ley-de-little|ley de Little]], en la hora pico hay en promedio 0.2083 × 27 ≈ 5.6 conversaciones a la vez en todo el servidor: ≈ 1.9 por réplica. Si se supone que llegan al azar y se reparten parejo (un modelo, no una medición), cada réplica tiene **3 o más** el ≈ 29 % del tiempo de la hora pico, y **9 o más** (fila del motor) el ≈ 0.02 %. Con una réplica caída, cada una de las otras dos tiene 3 o más el ≈ 53 % del tiempo, y 9 o más el ≈ 0.25 %. Dos lecturas:

- **`num_requests_waiting > 0` es raro y es grave**: con el tope en 8 y 1.9 de promedio, solo aparece si faltan réplicas o si la carga se disparó. Por eso es buena alerta.
- **La calidad se pierde mucho antes**: con una réplica caída, la mitad de la hora pico alguien escribe a menos de 20 tokens/s con la fila en 0. Eso se ve en la latencia entre tokens y en `num_requests_running` arriba de 2.

### El KV cache, y por qué la alerta de 90 % casi no se prende

`vllm:kv_cache_usage_perc` es la fracción de los [[bloque-kv|bloques de KV cache]] que retienen las preguntas en curso. Ojo con dos cosas. Es una fracción (0.9 = 90 %), no un porcentaje. Y **no cuenta** los bloques que se quedaron en el cache de prefijos esperando que alguien los reuse: esos están libres para desalojar, y el código de la 0.34.0 los cuenta como libres.

Cuánto ocupa una conversación en Qwen3 32B: 64 capas × 8 cabezas de KV × 128 números por cabeza × 2 (K y V) × 2 bytes = **262,144 bytes (256 KiB) por token**. Si el KV cache de una réplica fuera el de la ficha del despacho, 8 conversaciones de 8,192 tokens (65,536 tokens, 17.18 GB), entonces:

:::cuenta Cuánto marca el KV cache con el tope de 8
Bytes por token del KV // 64 capas × 8 cabezas × 128 × 2 × 2 B | 262,144 B | 256 KiB
Pool de la ficha, en tokens // 8 conversaciones × 8,192 | 8 × 8,192 | 65,536 tokens
Una conversación típica // ≈ 6,000 de entrada + ≈ 500 de salida | — | 6,500 tokens
La réplica promedio de la hora pico // 1.9 conversaciones | 1.875 × 6,500 ÷ 65,536 | ≈ 19 %
Las 8 del tope // 8 × 6,500 ÷ 65,536 | 52,000 ÷ 65,536 | ≈ 79 %
Conversaciones para llegar a 90 % // 0.9 × 65,536 ÷ 6,500 | 58,982 ÷ 6,500 | ≈ 9.1
= Con el tope de 8 y conversaciones de 6,500, el KV cache nunca pasa de ≈ 79 %: el tope llega antes que el 90 %. La alerta útil es la de preemptions, no la del 90 %.
:::

Con el KV cache extensible de la 0.34.0, el pool real es más grande (usa toda la memoria libre; el motor imprime cuántos tokens le cupieron) y el porcentaje, más bajo. El 90 % avisa de algo que el despacho no espera: conversaciones mucho más largas. La señal confiable de que falta memoria es `vllm:num_preemptions_total`. Una [[preemption]] es cuando el motor saca una pregunta del lote para hacerle lugar a otras y después la recalcula desde el principio. Si ese contador sube, alguien está pagando un prefill dos veces.

:::profundo Lo que dicen los otros contadores
- **Aciertos del cache de prefijos.** La tasa es `rate(hits) ÷ rate(queries)` (vLLM publica los dos contadores a propósito, no un porcentaje). En la primera pregunta de cada conversación, lo único repetido son las ≈ 400 instrucciones del inicio: ≈ 400 ÷ 6,000 ≈ 6.7 % ([[prefix-caching|prefix caching]]). Una repregunta reusa toda la conversación anterior (por eso cada conversación va a la misma réplica), así que la tasa real sube con las repreguntas; su valor normal se anota en el piloto. Si un día cae a casi 0, cambiaron las instrucciones o se rompió esa afinidad.
- **Tokens por segundo.** `rate(vllm:generation_tokens_total[5m])` sumado en las tres réplicas, contra la capacidad de salida de la ficha: 7,200 tokens por minuto (120 por segundo). En la hora pico los abogados piden 6,250 por minuto (≈ 104 por segundo), el ≈ 86.8 %.
- **Cómo terminaron.** `vllm:request_success_total{finished_reason="length"}` cuenta las respuestas cortadas por el tope de tokens. Si sube, las respuestas se están quedando a medias.
- **El largo de los prompts.** `vllm:request_prompt_tokens` tiene bordes 1-2-5 (…, 1,000, 2,000, 5,000) hasta el contexto máximo; con 8,192, los prompts de ≈ 6,000 caen todos en el último bucket, y su p95 «sale» 5,000. Si el despacho quiere ver si los prompts están creciendo, le pone sus propios bordes con el mismo flag de antes.

**Nombres que ya no existen.** Los tutoriales viejos usan `vllm:gpu_cache_usage_perc` (hoy es `vllm:kv_cache_usage_perc`), `vllm:num_requests_swapped` y `vllm:cpu_cache_usage_perc` (el modo que las usaba ya no existe en la versión 1 del motor). Y el tablero de ejemplo de vLLM dibuja el p99; el despacho promete en el p95, así que en cada consulta se cambia `0.99` por `0.95`.
:::

Los otros dos procesos de vLLM del despacho, el de embeddings y el del reranker, publican el mismo `/metrics` con su propio `model_name`. Para ellos las métricas de TTFT y de tokens entre tokens no tienen mucho sentido (no escriben respuestas); lo seguro es su latencia completa (`vllm:e2e_request_latency_seconds`), su fila y sus preguntas en curso.

## El gateway, la búsqueda y la interfaz {The gateway, the search and the UI} [extra]

### LiteLLM: métricas gratis, con llave y con demasiadas etiquetas

LiteLLM 1.111.0 publica métricas de Prometheus si se prende su *callback*: `litellm_settings: callbacks: ["prometheus"]`. Tres datos de su código y su documentación, a noviembre de 2026:

- **No es de pago.** El código está fuera de la carpeta `enterprise/`, con licencia MIT. (Lo que sí es de pago, según [Gateway](/gateway/), son los *audit logs* de cambios de administración.)
- **Pide llave desde la 1.85.0.** `/metrics` exige una clave de LiteLLM por omisión. Prometheus la manda en su configuración (`authorization` en la lista de esa pieza), o se abre un puerto de métricas aparte (desde la 1.101.0). Una clave propia de Prometheus, sin cuota de modelos, es lo limpio.
- **Con varios procesos de trabajo** hay que darle una carpeta compartida (`PROMETHEUS_MULTIPROC_DIR`), o cada proceso cuenta lo suyo y el total sale mal.

Las métricas que contestan «¿es el gateway?»:

- `litellm_overhead_latency_metric`: el tiempo que **agrega** LiteLLM, sin contar la llamada al modelo. Si este sube y el TTFT de vLLM no, el gateway es el culpable.
- `litellm_request_queue_time_seconds`, `litellm_in_flight_requests` (preguntas adentro ahora mismo) y `litellm_request_total_latency_metric` (de punta a punta, visto desde el gateway).
- `litellm_proxy_failed_requests_metric` (errores) y `litellm_deployment_successful_fallbacks`: cuántas veces mandó una pregunta de `chat-grande` a su respaldo, `chat-chico`. Si sube, los abogados están recibiendo el modelo chico sin saberlo.

Una cosa que ninguna métrica de LiteLLM incluye: **la búsqueda**. En el despacho, la búsqueda en los expedientes corre antes del gateway, en la orquestación, así que el TTFT que mide LiteLLM empieza cuando la búsqueda ya terminó.

### La cardinalidad, con un ejemplo real

La [[cardinalidad]] de una métrica es cuántas series distintas produce: una por cada combinación de valores de sus etiquetas. Sensei lo dijo con su regla: nunca pongas como etiqueta algo con muchos valores posibles, como el usuario. La guía de Prometheus pide mantener cada métrica debajo de 10 series y revisar si pasa de 100.

A noviembre de 2026, los histogramas de latencia de LiteLLM 1.111.0 traen etiquetas de **quién pide**: `hashed_api_key` y `api_key_alias` (la clave), `user` (el dueño de la clave), `team` y `end_user` (la persona final), además del modelo. En el despacho casi no pesan: todo entra con la clave de Open WebUI, y `end_user` viene vacío a propósito, «para no subir la cardinalidad», dice su código. Pero explotan con dos decisiones razonables: una clave por abogada, o el gasto por persona prendido en Prometheus (`enable_end_user_cost_tracking_prometheus_only: true`). Entonces cada histograma de latencia (17 bordes más `+Inf`, `_sum` y `_count`: 20 series) se multiplica por 200: **4,000 series** por histograma en vez de 20 por modelo. Seis así son 24,000 series que no dicen nada que el registro no diga mejor (su disco, en la sección del disco). Por eso el despacho las quita de antemano con `prometheus_exclude_labels` (y `prometheus_exclude_metrics` para lo que no use), dejando el modelo y la copia. Quién usó cuánto va en la fila del [[registro-de-auditoria|registro]], que ya tiene a la persona, no en Prometheus.

:::profundo Qdrant, el reranker, Open WebUI y el agente
**Qdrant y el reranker.** Qdrant 1.20.2 publica `/metrics` en su puerto 6333, en el mismo formato. Las que importan: `rest_responses_duration_seconds` (cuánto tardan sus respuestas, por ruta y código), `rest_responses_total`, `collection_points` (cuántos [[chunk|chunks]] tiene la colección: si después de la ingesta de la noche bajó, algo se borró) y `collection_update_queue_length` (lo que falta por indexar). Si su duración es un histograma o un promedio, y con qué bordes, no está confirmado; se revisa en el piloto. El presupuesto de la búsqueda es ≈ 150 ms (un supuesto de [De requisitos a hardware](/requisitos-hardware/)); no hay cifra publicada de Qdrant con 1.3 M de vectores y un filtro de permisos, así que la línea base sale del piloto.

**Ojo:** Qdrant 1.20.2 trae `telemetry_disabled: false` en su archivo de configuración: por omisión **manda estadísticas de uso** a sus desarrolladores. En un despacho donde nada sale, se pone en `true` (o la variable de entorno `QDRANT__TELEMETRY_DISABLED=true`, según su documentación).

El [[reranker]] es otro proceso de vLLM, que se llama directo y no pasa por el gateway: sus métricas salen de su `/metrics`, con su `model_name`, y su latencia calculada va de ≈ 97 a 232 ms en una L40S.

**Open WebUI.** Open WebUI 0.13.5 **no publica** `/metrics` de Prometheus. Trae OpenTelemetry, apagado (`ENABLE_OTEL=False`); su imagen oficial ya apaga sus avisos de uso, y `OFFLINE_MODE=true` apaga la búsqueda de versiones. Basta con el gateway: todo lo que pide al modelo pasa por LiteLLM. Sí guarda los pulgares de los abogados (sección de calidad).

**El agente.** [Agentes](/agentes/) dejó dos cosas para medir en producción: cuántos pasos y cuántos tokens gasta cada [[agente]]. Los tokens salen solos: el agente usa su propio nombre de modelo en LiteLLM («agente»), y cada métrica del gateway lleva ese modelo como etiqueta. Los pasos salen del registro de tool calls que ya diseñó esa lección (quién, qué tool, qué expediente, cuánto devolvió, sin el texto): de ahí se cuenta cuántas tareas llegaron al tope de 6 llamadas o de 60 s. Si una semana el 20 % de las tareas toca el tope, el presupuesto es corto o el agente se está perdiendo; las dos cosas se investigan con el examen, no en producción.
:::

## Las trazas: dónde se fue el tiempo de una pregunta {Traces: where a question's time went}

Las métricas dicen **que** el p95 subió. No dicen dónde se fue el tiempo de **una** pregunta concreta. Para eso está la [[traza]] (*trace*): el registro de una pregunta a su paso por todas las piezas, como una lista de **tramos** (*spans*), cada uno con su pieza, su hora de inicio y su duración. Todas las piezas pasan de mano en mano el mismo identificador de traza, así que al final se pueden juntar. Sensei lo explica en [La request en vivo](https://sensei.trueml.app/e11-request/).

### El presupuesto de una pregunta

[De requisitos a hardware](/requisitos-hardware/) repartió los 2,000 ms de la promesa: ≈ 20 ms de red y gateway, ≈ 150 ms de búsqueda, y lo que queda, ≈ 1,830 ms, para la fila y el prefill ([[presupuesto-de-latencia|presupuesto de latencia]]). Una traza pone al lado de cada parte lo que de verdad tardó.

:::formula El TTFT que siente el abogado
T = t_{red} + t_{busq} + t_{fila} + t_{pref}
t_{fila} = t_{rest}
- T: el tiempo al primer token que ve el abogado, en s
- t_{red}: red, Open WebUI y gateway, en s
- t_{busq}: embeber la pregunta, buscar en Qdrant y, si se usa, el reranker, en s
- t_{fila}: lo que espera a que la GPU termine el prefill de otra pregunta, en s
- t_{rest}: lo que le falta al prefill de la pregunta de adelante cuando llega la tuya, si la GPU las atiende en orden de llegada, en s
- t_{pref}: el prefill de tu pregunta, en s (≈ 2.38 s en una L40S sin competencia)
:::

Un ejemplo, con los números de la ficha: a las 12:30, una abogada pregunta medio segundo después de que otra pregunta empezó su prefill en la misma réplica. La GPU termina primero la de adelante.

:::cuenta Una pregunta lenta, tramo por tramo
Red y gateway, \(t_{red}\) // supuesto del presupuesto | — | 0.020 s
Búsqueda, \(t_{busq}\) // supuesto del presupuesto | — | 0.150 s
Lo que le falta a la de adelante, \(t_{rest}\) // empezó 0.5 s antes | 2.38 − 0.5 | 1.88 s
Fila, \(t_{fila}\) // \(= t_{rest}\) | — | 1.88 s
Prefill propio, \(t_{pref}\) // la ficha, L40S sin competencia | — | 2.38 s
TTFT del abogado, \(T\) | 0.020 + 0.150 + 1.88 + 2.38 | 4.43 s
Lo que se pasó del presupuesto // \(T − 2\) | 4.43 − 2 | 2.43 s
= De 4.43 s, la búsqueda y el gateway son 0.17 s. El resto se fue dentro de vLLM, esperando a la GPU y calculando. No se rompió nada: es el problema que la ficha ya conoce de la L40S.
:::

La cuenta supone que la GPU hace un prefill y luego el otro. vLLM mezcla los dos en sus pasos (el *chunked prefill*); si los repartiera mitad y mitad, la tuya terminaría también 4.26 s después de llegar, la misma cuenta por otro camino. Cuánto de ese tiempo vLLM anota como fila (`request_queue_time_seconds`) y cuánto como prefill depende de cómo su scheduler parta el trabajo; para el TI basta con saber que se fue adentro del motor.

:::diagrama observabilidad-traza
La traza de esa pregunta de las 12:30. Cada pieza deja un tramo con su duración; el colector los junta por el identificador de traza. Sigue el recorrido para ver dónde se fueron los 4.43 s.
:::

:::profundo OpenTelemetry, sus convenciones para LLMs y las herramientas de trazas
Las trazas se mandan con **OpenTelemetry** (OTel), el estándar abierto para métricas, logs y trazas, a un programa que las recibe, el **colector** (OpenTelemetry Collector, 0.166.0 a noviembre de 2026), que las guarda o las reenvía. vLLM 0.34.0 manda las suyas con `--otlp-traces-endpoint`, y sus tramos traen atributos como `gen_ai.latency.time_in_queue`, `gen_ai.latency.time_to_first_token`, `gen_ai.usage.prompt_tokens` y `gen_ai.usage.completion_tokens`: tiempos y conteos, **sin el texto** del prompt ni de la respuesta.

Las convenciones de OTel para IA generativa (qué nombre lleva cada atributo de una llamada a un modelo) se mudaron a su propio repositorio y su primera versión, la 0.1.0, salió el 21 de noviembre de 2026, con cambios que rompen nombres anteriores y en estado *Development*: todavía no son estables. Dos cosas que sí importan al despacho: los atributos con el contenido (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`) son ***opt-in***, apagados salvo que alguien los prenda; y los nombres de tokens que usa vLLM 0.34.0 (`gen_ai.usage.prompt_tokens` y `…completion_tokens`) no son los de la versión nueva (`gen_ai.usage.input_tokens` y `…output_tokens`): un tablero de trazas hecho para una no lee la otra. La regla del despacho: nunca prender el contenido, y comprobarlo con la pregunta marcador que propuso [Gateway](/gateway/) («ZORRO-7731») buscándola en el colector.

**¿Langfuse, Phoenix o nada?** Hay herramientas hechas para trazas de LLMs que se instalan en casa. A noviembre de 2026:

| | Langfuse | Arize Phoenix |
|---|---|---|
| Versión | 4.88.0 (saca versiones casi a diario) | 22.1.0 |
| Licencia | MIT, salvo las carpetas `ee/` (de pago, © ClickHouse, Inc.) | Elastic License 2.0: no es una licencia abierta de la OSI; leerla antes ([Licencias](/licencias/)) |
| Qué hay que operar | Postgres, ClickHouse, Redis y un almacenamiento compatible con S3 | Un archivo SQLite por omisión; Postgres opcional |
| Hacia afuera | Manda conteos de uso cada 12 h salvo `TELEMETRY_ENABLED=false` en todos sus contenedores; además consulta sus versiones nuevas (no se puede apagar; falla sin romper) | `PHOENIX_TELEMETRY_ENABLED` prendido por omisión (analítica de la interfaz) |

Para un TI de dos personas, Langfuse son **cuatro bases de datos más** que operar, respaldar y actualizar, además de todo el servidor de IA; Phoenix es ligero pero su licencia pide leerla. La propuesta para el despacho es la mínima: Prometheus para las métricas, el registro del gateway para cada pregunta y las trazas de vLLM a un colector local que guarde una muestra unos días; con qué programa verlas se elige en el piloto.
:::

### Lo que no se guarda

El texto. Ni en las trazas, ni en las métricas, ni en el registro, ni en los comentarios de los pulgares. Las preguntas de los abogados y los fragmentos de expediente son secreto profesional y datos personales ([Privacidad](https://sensei.trueml.app/privacidad/)); [Gateway](/gateway/) ya listó los cinco lugares donde el texto se cuela sin pedirlo. Para depurar bastan los tiempos, los conteos y el identificador.

## Cinco sospechosos, cinco firmas {Five suspects, five signatures}

De vuelta al martes a las 12:30. Cada sospechoso deja una **firma** distinta en los números, y el TI la puede leer en el tablero sin saber nada de GPUs. Esta tabla se imprime y se pega junto al rack.

| Sospechoso | Lo que se ve | Lo que **no** se ve | Dónde se confirma |
|---|---|---|---|
| **La GPU** (calor, error) | Latencia entre tokens alta en **una** réplica, con pocas conversaciones; reloj abajo; segundos de throttling subiendo; o `up == 0` y un XID | Las otras réplicas, normales | DCGM de esa tarjeta, `dmesg` |
| **El motor** (memoria) | `num_requests_running` pegado en 8, fila > 0, preemptions subiendo, KV cache alto | GPU sana, reloj normal | `/metrics` de vLLM, largo de los prompts |
| **La búsqueda** | El TTFT del abogado sube, pero el TTFT de vLLM y el de LiteLLM no | Fila de vLLM en 0 | Duración de Qdrant y del reranker; tramo de búsqueda en la traza |
| **El gateway** | `litellm_overhead_latency_metric` sube; errores o *fallbacks* | vLLM normal | Métricas de LiteLLM, CPU del servidor |
| **La fila** (carga) | Preguntas por minuto arriba de lo normal; conversaciones por réplica arriba de 2 en **todas**; latencia entre tokens alta en todas por igual | Ningún error; las tres réplicas `up` | Preguntas por minuto del gateway; el registro (¿una persona o todas?) |

Tres reglas para leerla:

1. **Una réplica o todas.** Si el problema está en una sola, es su GPU o su proceso. Si está en todas por igual, es la carga o algo compartido (el gateway, la búsqueda, el cuarto).
2. **Antes o dentro del motor.** Si el TTFT de vLLM está normal y el abogado lo siente lento, el tiempo se fue antes: búsqueda o gateway. Para eso sirve comparar el TTFT de vLLM con el de LiteLLM y con el tramo de búsqueda.
3. **Error o espera.** Una GPU que falla deja huella (XID, `up == 0`, throttling). Una fila no deja ningún error: solo más preguntas y más espera. «No hay errores» no es «no pasa nada».

En el martes de la historia, con L40S, lo más probable es la fila (el servidor está en el límite que la ficha ya conocía) o una réplica muerta. Lo segundo se ve en dos minutos con `up`; lo primero, en las preguntas por minuto.

## Calidad en producción, sin guardar el texto {Quality in production, without keeping the text} [extra]

El [[eval|examen]] de 200 preguntas y el [[gate-de-calidad|gate]] corren **antes** de cada cambio ([Demostrar que el modelo abierto sirve](/evals/)). En producción no hay respuestas de referencia y no se puede guardar el texto para leerlo después. Pero hay cosas que sí se cuentan:

- **«No lo encontré».** Cuántas respuestas dicen que la información no está en los expedientes. Ninguna pieza lo cuenta sola: lo cuenta quien arma la respuesta, con un contador propio (por ejemplo `respuestas_sin_evidencia_total`, con el modelo como única etiqueta). Si un lunes salta del 10 % al 30 %, algo pasó con la búsqueda o con la ingesta de la noche.
- **Citas que no verifican.** El revisor de citas de [Demostrar que el modelo abierto sirve](/evals/) (¿existe el documento?, ¿existe la página?) puede correr también en producción y contar `citas_invalidas_total` contra `citas_total`. Una [[cita-inventada|cita inventada]] en producción es el error más caro del despacho.
- **Pulgares abajo.** Open WebUI 0.13.5 trae prendida la calificación de mensajes (`ENABLE_MESSAGE_RATING`), y el administrador las descarga por su API. El **conteo** por día no tiene texto; la razón, el comentario del abogado y la «instantánea» que guarda (su contenido exacto no está confirmado) se tratan como el chat mismo.
- **Respuestas cortadas** (`finished_reason="length"`) y ***fallbacks*** al modelo chico: dos señales de que algo cambió sin que nadie lo decidiera.

Y una muestra que leen personas: cada semana, un abogado revisa un puñado de respuestas con permiso de quien preguntó. ¿Cuántas?

:::formula Lo que detecta una muestra de n respuestas
m = 1.96 × sqrt{frac{p(1 − p)}{n}}
- p: la fracción de respuestas buenas en la muestra (el peor caso para el margen es 0.5)
- n: cuántas respuestas se revisan
- m: el margen del intervalo de 95 %, en fracción (× 100 = puntos)
:::

:::cuenta La muestra semanal de 30
Respuestas revisadas, \(n\) // supuesto del ejemplo | — | 30
Peor caso, \(p\) | — | 0.5
Margen, \(m\) // \(1.96 × \sqrt{p(1 − p) ÷ n}\) | 1.96 × √(0.25 ÷ 30) | 0.179 = ± 17.9 puntos
Con \(p = 0.9\) // si casi todas están bien | 1.96 × √(0.09 ÷ 30) | ± 10.7 puntos
El margen que el gate protege // ficha del despacho | — | ≈ 5.6 puntos
= Una muestra de 30 detecta un derrumbe o una fuga, no una baja de 5 puntos. Las bajas chicas las detecta el examen antes de cada cambio: por eso la muestra no lo sustituye.
:::

## El tablero y las alertas del despacho {The despacho's dashboard and alerts}

### Un tablero, en el orden en que se mira

El tablero que se propone para el despacho tiene 8 paneles, en el orden de la pregunta «¿está bien?»:

:::figura observabilidad-tablero
El tablero del despacho: 8 paneles en el orden en que se leen. Arriba lo que siente el abogado (tráfico, TTFT, velocidad); en medio lo que hace el motor (conversaciones, fila, KV cache); abajo lo que lo explica (GPU, búsqueda, réplicas vivas y disco).
:::

1. **Preguntas por minuto y errores**, del gateway. En la hora pico, ≈ 12.5 por minuto.
2. **TTFT p95**, por réplica y en total, con una línea en 2 s (con los bordes propios).
3. **Latencia entre tokens p95**, con una línea en 50 ms.
4. **Conversaciones en curso por réplica**, con líneas en 2 y en 8, y la **fila** (`num_requests_waiting`).
5. **KV cache y preemptions.**
6. **La GPU**, por tarjeta: potencia, temperatura, reloj, DRAM activa y SM activo.
7. **La búsqueda**: duración de Qdrant y del reranker.
8. **Réplicas vivas** (`up`) **y disco** libre del registro y de Prometheus.

### Seis alertas, con su instrucción de tres líneas

Cada [[alerta]] lleva su condición, cuánto tiene que durar (`for`), su nivel y qué hace el TI. Dos niveles: **ahora** (correo urgente a quien está de turno, en horario de oficina; las de hardware también de noche) y **mañana** (un correo que se lee al llegar). Cómo se arma una guardia lo explica [Monitoreo](https://sensei.trueml.app/e12-monitoreo/); con dos personas, casi nada despierta.

| # | Alerta | Condición (idea) | `for` | Nivel | Las tres líneas del TI |
|---|---|---|---|---|---|
| 1 | TTFT p95 arriba de la promesa en la hora pico | p95 de 10 min > el objetivo firmado **y** ≥ 0.05 preguntas/s en la ventana | 10 min | Mañana | Mira la fila y las conversaciones por réplica. Si hay fila, revisa réplicas y GPU (alertas 4 y 5). Si no, revisa si los prompts crecieron y avísale al responsable técnico |
| 2 | Fila del motor | `sum(vllm:num_requests_waiting) > 0` | 2 min | Ahora | ¿Cuántas réplicas están `up`? ¿Una persona mandando mucho (el registro)? Si están todas y es la hora pico, es capacidad: anótalo y repórtalo |
| 3 | Memoria del motor | `increase(vllm:num_preemptions_total[10m]) > 0` o KV cache > 0.9 | 5 min | Mañana | Mira el largo de los prompts. Anota la hora. Cambiar `--max-num-seqs` o el contexto lo decide el responsable |
| 4 | Una réplica caída: se perdió el N+1 | `sum(up{job="vllm-chat"}) < 3` | 2 min | Ahora | Revisa el estado y el log de esa réplica. Reiníciala una vez; si vuelve a caer, sácala del reparto del gateway. Reporta al proveedor con el error y el XID si hay |
| 5 | GPU: calor, throttling o XID | margen de temperatura bajando, segundos de throttling por calor subiendo, o un XID nuevo | 5 min (XID sin espera) | Ahora, también de noche | Copia la línea del XID del log con su hora. Busca el código en el catálogo de NVIDIA y haz lo que dice. Si es calor, revisa el minisplit y el sensor del frente del rack |
| 6 | Disco del registro o de Prometheus | menos de 20 % libre | 15 min | Mañana | ¿Corrió la limpieza de 90 días del registro? Revisa el tamaño de los datos de Prometheus. Subir el disco o bajar la retención lo aprueba el responsable |

Tres decisiones detrás de la tabla:

- **El umbral de la 1 es el objetivo firmado, no «2 s» de memoria.** Con L40S, el prefill solo ya tarda 2.38 s: la alerta estaría prendida en cada hora pico, y una alerta que se prende todos los días se aprende a ignorar. Si el piloto elige la RTX PRO 6000 Server Edition (≈ 1.7 s de prefill calculados, sin fila), el umbral es 2 s. Si el despacho se queda con L40S y acepta otro objetivo, el umbral es ese. La guarda de ≥ 0.05 preguntas por segundo (30 en la ventana) evita el `NaN` de las noches y los p95 de tres preguntas.
- **La 4 es la más importante.** Con 3 L40S no hay repuesto: con una caída, la mitad de la hora pico alguien escribe a menos de 20 tokens/s. Con la cuarta tarjeta del [[n-mas-1|N+1]], la condición pasa a `< 4` y la urgencia baja.
- **`keep_firing_for`.** Además de `for`, Prometheus tiene `keep_firing_for`: deja la alerta prendida un rato después de que deja de cumplirse. En las 1 a 3, `10m` evita que parpadee en el borde de la hora pico.

:::profundo La regla escrita, y por dónde sale el aviso
La regla 4, escrita como la lee Prometheus. `vllm-chat` es el nombre (*job*) que el despacho le pone, en la configuración de Prometheus, a la lista de sus tres réplicas:

```yaml
groups:
  - name: despacho
    rules:
      - alert: ReplicaCaida
        expr: sum(up{job="vllm-chat"}) < 3
        for: 2m
        labels:
          nivel: ahora
        annotations:
          resumen: "Una réplica de chat-grande no contesta: se perdió el repuesto"
          runbook: "1) estado y log de la réplica 2) reiniciar una vez; si cae, sacarla del gateway 3) reportar con el XID si hay"
```

¿Por qué `sum(up)` y no `count(up == 1)`? `up == 1` es un filtro: si las tres caen, no queda ninguna serie, `count` no devuelve nada (ni 0) y la alerta calla justo en el peor caso. `up` vale 1 o 0: su suma cuenta las vivas y da 0 si mueren todas.

Alertmanager 0.35.1 manda las alertas por correo (`email_configs`) o a una dirección web interna (`webhook_configs`); los receptores que viven en internet no sirven en un servidor sin salida. El correo del despacho vive en Microsoft 365, así que esa alerta sí cruza el [[firewall-de-salida|firewall]]: es la segunda salida que decide [Seguridad](/seguridad/), solo desde Alertmanager, y trae un aviso sobre el método de envío (SMTP AUTH). Los avisos en Teams cruzan igual y se deciden ahí. Y una alerta que nunca se ha visto llegar no se sabe si funciona: en el piloto se fuerza una de prueba y se mide cuánto tarda el correo.
:::

## El disco de Prometheus y el costo de cada etiqueta {Prometheus's disk and the cost of each label} [extra]

¿Cuánto disco pide guardar 90 días de todo esto? La documentación de Prometheus 3.16.0 da la fórmula y la cifra: en promedio guarda **de 1 a 2 bytes por muestra**.

:::formula El disco de Prometheus
D = S × frac{86400}{Δ} × d × b
- D: el disco, en bytes (÷ 10^9 = GB)
- S: cuántas series se guardan, en total
- Δ: el intervalo de scrape, en s (86,400 ÷ Δ = muestras por serie al día)
- d: los días de retención
- b: los bytes por muestra, de 1 a 2 según la documentación
:::

Cuántas series tiene el despacho es una suma con supuestos, y cada uno se dice:

- **Cada proceso de vLLM 0.34.0**: los histogramas de fábrica dan 298 series (contados en su código); los contadores y gauges, ≈ 25 (supuesto); las de su servidor web (peticiones HTTP por ruta y código), ≈ 50 (supuesto). Total ≈ 373. El despacho tiene 5 procesos (3 réplicas, embeddings y reranker): 1,865.
- **Cada GPU**: ≈ 26 series (las filas prendidas del CSV de la 4.9.0; cuántas emite de verdad una L40S se ve en el piloto). Tres GPUs: 78.
- **`node_exporter`**: ≈ 1,000 (supuesto; depende de cuántos discos y tarjetas de red tenga la máquina).

:::cuenta 90 días de métricas del despacho
Series sin LiteLLM, \(S\) // 1,865 + 78 + 1,000 | — | 2,943
Muestras por serie al día // \(86,400 ÷ Δ\), con Δ = 15 s | 86,400 ÷ 15 | 5,760
Muestras por serie en 90 días // × \(d\) | 5,760 × 90 | 518,400
Disco a 1 byte por muestra, \(D\) // \(S ×\) muestras \(× b\) | 2,943 × 518,400 × 1 | 1.53 GB
A 2 bytes por muestra | 2,943 × 518,400 × 2 | 3.05 GB
Si LiteLLM llevara una etiqueta por persona // 6 histogramas × 20 series × 200 personas | 2,943 + 24,000 | 26,943 series
Su disco, de 1 a 2 bytes // 26,943 × 518,400 × \(b\) | — | 14.0 a 27.9 GB
LiteLLM recortado al modelo // 6 × 20 × 3 modelos | 2,943 + 360 | 3,303 series → 1.7 a 3.4 GB
= El disco no es el problema: unos GB. El problema sería la cardinalidad: una etiqueta por persona en LiteLLM multiplica casi por 10 el disco sin agregar nada que el registro no tenga.
:::

:::calculadora observabilidad-disco
Mueve las series, el intervalo, los días y los bytes por muestra. Prueba el preajuste de LiteLLM con sus etiquetas de persona y mira cuánto pesan 200 personas como etiqueta.
:::

Dos detalles. Prometheus escribe primero un diario de cambios (el *WAL*, en pedazos de 128 MB, comprimido por omisión) y junta los bloques poco a poco, así que el disco rebasa un rato la cuenta; lo mismo con su tope de tamaño (`--storage.tsdb.retention.size`). Y el registro del gateway vive en otra base: 3,000 preguntas × 90 días = 270,000 filas, ≈ 276 MB a 1 KB por fila (un supuesto). Un disco de 50 GB para la observabilidad sobra; lo que se vigila aparte son los logs de los contenedores, que crecen sin que nadie los cuente.

## Errores comunes {Common mistakes}

1. **Alertar con «memoria de la GPU > 90 %» o «GPU al 100 %».** vLLM aparta toda la memoria al arrancar, y la utilización marca ≈ 100 % con una sola conversación: las dos alertas estarían prendidas siempre. **Cómo evitarlo:** preemptions y `vllm:kv_cache_usage_perc` para la memoria; SM activo, DRAM activa, potencia y reloj, contra su línea base, para el trabajo.
2. **Usar los nombres viejos de DCGM.** Con `dcgm-exporter` 4.9.0, un tablero con `DCGM_FI_DEV_GPU_UTIL` o `DCGM_FI_DEV_FB_USED` sale vacío, y uno con umbrales en porcentaje contra razones de 0 a 1 nunca avisa. **Cómo evitarlo:** los nombres del CSV de la versión instalada, comprobados con `curl localhost:9400/metrics`, y las notas de la versión antes de actualizar.
3. **Confiar en el p95 de los bordes de fábrica.** Sin un borde en 2 s, `histogram_quantile` da ≈ 2.4 s tanto si las preguntas tardan 1.1 s como 2.4 s. **Cómo evitarlo:** `--custom-histogram-buckets` con bordes cada medio segundo alrededor de la promesa, y el p95 junto a cuántas preguntas tiene detrás.
4. **Poner a la persona como etiqueta.** Una clave por abogada o el gasto por persona prendido en Prometheus multiplican por 200 cada histograma de LiteLLM. **Cómo evitarlo:** `prometheus_exclude_labels` para dejar el modelo y la copia; quién usó cuánto va en el registro del gateway.
5. **Mirar solo la fila del motor.** `num_requests_waiting` sigue en 0 hasta la novena conversación, y la calidad se pierde desde la tercera. **Cómo evitarlo:** el panel de conversaciones por réplica con su línea en 2, y la latencia entre tokens contra 50 ms.
6. **Guardar el texto «solo para depurar».** Un atributo de contenido prendido en las trazas, un comentario de pulgar o un log de error con el prompt completo son una copia del expediente fuera de su lugar. **Cómo evitarlo:** contenido apagado en OTel, pulgares contados (no leídos), y la pregunta marcador buscada en cada almacén.
7. **Dejar la telemetría de fábrica.** Grafana, Qdrant, Langfuse y Phoenix mandan datos de uso hacia afuera por omisión. **Cómo evitarlo:** apagar cada una en su configuración, y que el servidor no tenga [[firewall-de-salida|salida a internet]] de todos modos.

## En la vida real {In real life} [extra]

**El despacho.** Prometheus 3.16.0 (15 s, 90 días) en la zona de gestión, en otra máquina (así lo reparte [Seguridad](/seguridad/)); `dcgm-exporter` 4.9.0 con SM activo, margen de temperatura y throttling prendidos; vLLM con bordes propios en el TTFT; LiteLLM con clave propia en `/metrics` y las etiquetas de persona quitadas de antemano; Qdrant y Grafana sin telemetría; Alertmanager por el correo de Microsoft 365. Un tablero de 8 paneles y 6 alertas, 3 de nivel «ahora»; trazas de vLLM a un colector local, sin contenido. En el piloto se anota la línea base de la GPU bajo la prueba de carga y se fuerza cada alerta una vez. El TI recibe la tabla de los cinco sospechosos impresa.

**Una clínica con turno nocturno.** Supuesto del ejemplo: un asistente que resume expedientes médicos, mucho uso de día y casi nada de noche, con una sola persona de guardia. De noche, el p95 de una ventana sin preguntas es `NaN` y su alerta se queda muda. La clínica decide qué significa el silencio: una alerta de «no contesta» (`up{job="vllm"} == 0`, por si se cayó el servidor), otra de «nadie pregunta en horario de servicio» (cero preguntas en 30 minutos entre 8:00 y 20:00, por si se rompió la entrada) y un correo diario de «sigo vivo» que manda una alerta siempre prendida: el día que no llega, el que se cayó es Prometheus, que no puede avisar de sí mismo. De noche solo despiertan la réplica caída y la GPU; todo lo demás espera a la mañana.

**Una fábrica con el servidor en planta.** Supuesto del ejemplo: un asistente para los técnicos de mantenimiento, con el servidor en un gabinete junto a la línea de producción, donde el aire es más caliente que en una oficina. Ahí las alertas que importan son las de temperatura: `DCGM_FI_DEV_GPU_TEMP_CELSIUS` y la del módulo de memoria, el margen hasta el umbral de freno y los segundos de throttling por calor. La GPU no truena: se frena, y los técnicos ven respuestas más lentas a las 15:00 que a las 7:00 con la misma carga. La línea base se mide en la temporada más caliente, no en enero.

## Ejercicios {Exercises}

:::ejercicios
? [facil] En una ventana de 10 minutos llegaron 200 preguntas. ¿Qué lugar busca `histogram_quantile` para el p95? Si el bucket ≤ 2.0 s tiene 180 y el ≤ 2.5 s tiene 196, ¿cuánto da el p95?
\(r = q × N\) = 0.95 × 200 = **190**. Cae en (2.0, 2.5], porque 180 < 190 ≤ 196. \(p = 2.0 + 0.5 × (190 − 180) ÷ (196 − 180)\) = 2.0 + 0.5 × 0.625 = **2.3125 s**. Lo que el histograma sabe de verdad: entre 2.0 y 2.5 s.
? [facil] Alguien propone la alerta «memoria de la GPU > 90 % durante 5 minutos». ¿Qué pasa en el despacho y qué alerta pondrías en su lugar?
vLLM 0.34.0 aparta toda la memoria libre para el KV cache al arrancar, así que la tarjeta marca casi llena desde el primer minuto: la alerta estaría **prendida siempre**. En su lugar: `increase(vllm:num_preemptions_total[10m]) > 0` (falta memoria de verdad) y, como aviso, `vllm:kv_cache_usage_perc > 0.9`.
? [facil] Un tablero bajado de internet tiene un panel «GPU-Util» con la consulta `DCGM_FI_DEV_GPU_UTIL > 90`. Con `dcgm-exporter` 4.9.0, ¿qué muestra y cómo lo arreglas?
**Nada**: en la 4.9.0 esa métrica se llama `DCGM_FI_DEV_GPU_UTIL_RATIO` y es una razón de 0 a 1. Arreglo: el nombre nuevo y el umbral en razón (`> 0.9`). Y de todos modos, en un servidor de LLMs ese panel marca ≈ 1 con una sola conversación: sirve para ver si vale 0, no para ver carga.
? [medio] Con los bordes de fábrica de vLLM 0.34.0 (…, 1.0, 2.5, …), las 125 preguntas de una ventana tardan todas 1.4 s. ¿Qué p95 reporta Prometheus? ¿Y con los bordes propios del despacho (…, 1.0, 1.5, 2.0, …)?
De fábrica: caen en (1.0, 2.5]; \(r\) = 118.75; \(p = 1.0 + 1.5 × 118.75 ÷ 125\) = 1.0 + 1.425 = **2.425 s**: la alerta de «> 2 s» se prende aunque todas cumplan. Propios: caen en (1.0, 1.5]; \(p = 1.0 + 0.5 × 0.95\) = **1.475 s**.
? [medio] Una réplica tiene 3 conversaciones de 6,500 tokens y su KV cache es de 65,536 tokens. ¿Cuánto marca `vllm:kv_cache_usage_perc`? ¿Con cuántas conversaciones de ese largo pasaría de 0.9, y eso puede pasar con `--max-num-seqs 8`?
3 × 6,500 ÷ 65,536 = 19,500 ÷ 65,536 ≈ **0.298** (29.8 %). Para 0.9: 0.9 × 65,536 ÷ 6,500 ≈ **9.1** conversaciones. Con el tope de 8 **no** pasa: 8 dan ≈ 0.79. Solo pasaría con conversaciones más largas (las 8 cerca de 8,192 tokens darían 1.0).
? [medio] El despacho revisa cada semana 120 respuestas en vez de 30. ¿Cuál es el margen en el peor caso? ¿Ya detecta una baja de 5 puntos?
\(m = 1.96 × \sqrt{0.25 ÷ 120}\) = 1.96 × 0.0456 ≈ **0.089 = ± 8.9 puntos**. No: el margen sigue siendo casi el doble de 5 puntos. Para ± 5 puntos harían falta \(n = 1.96^2 × 0.25 ÷ 0.05^2\) ≈ **385** respuestas a la semana. Las bajas chicas las detecta el examen.
? [reto] Una abogada pregunta 1.0 s después de que otra pregunta empezó su prefill de 2.38 s en la misma réplica. La red y el gateway tardan 20 ms y la búsqueda 150 ms. ¿Cuál es su TTFT, y qué tramo de la traza es el más largo? ¿Qué le dirías al abogado que se queja?
\(t_{rest}\) = 2.38 − 1.0 = 1.38 s; \(T\) = 0.020 + 0.150 + 1.38 + 2.38 = **3.93 s**. El tramo más largo es el de vLLM: su propio prefill (2.38 s), y luego la espera (1.38 s). Al abogado: no se rompió nada; la tarjeta estaba leyendo otra pregunta, y con L40S, aun sin espera, el primer token tarda ≈ 2.55 s (2.38 + 0.17). Es el límite que el piloto tiene que resolver (otra GPU, menos fragmentos o otro objetivo).
? [reto] Con 5.6 conversaciones a la vez en la hora pico, repartidas al azar y parejo, ¿qué media tiene cada réplica con 3, con 2 (una caída) y con 4? Con un modelo de Poisson, ¿qué fracción del tiempo tiene una réplica 3 o más? ¿Qué dice eso de la alerta 4?
Medias: 5.625 ÷ 3 = **1.875**; ÷ 2 = **2.81**; ÷ 4 = **1.41**. \(P(X ≥ 3) = 1 − e^{−μ}(1 + μ + μ^2 ÷ 2)\): con 1.875, 1 − 0.153 × 4.63 ≈ **0.29**; con 2.81, 1 − 0.060 × 7.76 ≈ **0.53**; con 1.41, ≈ **0.17**. Con una réplica caída, más de la mitad de la hora pico alguien escribe a menos de 20 tokens/s, sin fila del motor ni error que lo delate: por eso la alerta de la réplica caída avisa «ahora» y no espera a que suba la latencia. (Es un modelo, no una medición: el piloto lo confirma.)
? [reto] En la clínica con turno nocturno, la regla «TTFT p95 > 2 s durante 10 min» nunca avisa de noche. ¿Por qué? Diseña dos reglas para que el silencio no esconda una falla.
De noche no hay preguntas: la ventana tiene 0 observaciones, `histogram_quantile` da `NaN` y la comparación no se cumple. Reglas: (1) **no contesta**: `up{job="vllm"} == 0` durante 5 min, para saber que el servidor sigue vivo aunque nadie pregunte; (2) **sin tráfico en horario**: cero preguntas en 30 min entre 8:00 y 20:00 (por ejemplo, `sum(increase(vllm:request_success_total[30m])) == 0` limitado a ese horario; ojo, `hour()` de PromQL va en UTC, y las 8:00 a 20:00 de la Ciudad de México son de 14:00 a 2:00 UTC), para saber que la entrada no se rompió. La primera despierta; la segunda, solo en horario. Si se cae Prometheus, ninguna suena: para eso, el correo diario de «sigo vivo».
:::

## Lo que sigue {What comes next} [extra]

- **[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)** cierra la [[firewall-de-salida|salida a internet]] que aquí se apaga pieza por pieza y decide cómo se [[parche|actualizan]] `dcgm-exporter`, vLLM y LiteLLM sin romper los nombres de las métricas.
- **[TCO: API, nube o servidor propio](/costo-total/)** usa lo que este tablero mide en producción: cuántas preguntas se atienden de verdad, a qué potencia, y [[costo-por-pregunta|cuánto vale cada una]].
- **[Cotizar, proponer y dar soporte](/cotizar/)** convierte las alertas y sus tiempos en lo que se le promete al cliente: qué se vigila, en cuánto tiempo se responde y qué pasa si una réplica cae.
- De esta app: [Pruebas de carga y benchmarks honestos](/pruebas-carga/) (los mismos relojes, medidos una vez), [Gateway](/gateway/) (la fila del registro y por dónde se cuela el texto), [El cuarto](/el-cuarto/) (temperatura y potencia) y [Demostrar que el modelo abierto sirve](/evals/) (el examen que la producción no sustituye).
- En Sensei: [Monitoreo](https://sensei.trueml.app/e12-monitoreo/) (alertas, burn rate, guardia y postmortems), [La request en vivo](https://sensei.trueml.app/e11-request/) (métricas, Prometheus, cardinalidad y trazas), [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/) y [Latencia y throughput](https://sensei.trueml.app/latencia/).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
observabilidad metrica serie-de-tiempo prometheus exporter dcgm utilizacion-gpu sm-activo histograma cardinalidad tablero alerta error-xid throttling traza
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué «GPU al 100 %» no sirve para saber qué tan cargado está el servidor del despacho?
Porque mide la parte del tiempo en que corrió algún kernel, y con batching continuo vLLM lanza pasos sin parar mientras haya una sola conversación: marca ≈ 100 % con una persona o con ocho. Lo que sí dice algo: SM activo, DRAM activa, potencia y reloj contra su línea base.
? ¿Qué cambió en `dcgm-exporter` 4.9.0 que puede dejar un tablero vacío?
Renombró las métricas y cambió unidades: por ejemplo `DCGM_FI_DEV_GPU_UTIL` (0–100) pasó a `DCGM_FI_DEV_GPU_UTIL_RATIO` (0–1) y `DCGM_FI_DEV_FB_USED` (MiB) a `DCGM_FI_DEV_FB_USED_BYTES` (bytes).
? ¿Por qué el p95 del TTFT con los bordes de fábrica de vLLM 0.34.0 no sirve para la promesa de 2 s?
Porque no hay borde entre 1.0 y 2.5 s: `histogram_quantile` interpola dentro de ese bucket y da ≈ 2.4 s tanto si todas tardan 1.1 s como 2.4 s. Se arregla con `--custom-histogram-buckets`.
? En el tablero, la latencia entre tokens sube en las tres réplicas por igual, sin errores y con las tres `up`. ¿Qué sospechoso es el más probable?
La fila: llegó más carga de la que atienden bien. Se confirma con las preguntas por minuto del gateway y con las conversaciones por réplica arriba de 2.
? ¿Por qué la alerta de «una réplica caída» avisa «ahora» y no espera a que suba la latencia?
Porque con 3 L40S no hay repuesto: con una caída, la mitad de la hora pico alguien escribe a menos de 20 tokens/s, y eso no deja error ni fila del motor que lo delate. `up == 0` lo dice en dos minutos.
? Nombra tres cosas que el despacho cuenta en producción para vigilar la calidad sin guardar el texto.
Cualesquiera tres de: respuestas «no lo encontré», citas que no verifican, pulgares abajo (el conteo), respuestas cortadas por largo, *fallbacks* al modelo chico.
:::
