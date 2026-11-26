---
titulo: Pruebas de carga y benchmarks honestos
en: Load tests and honest benchmarks
subtitulo: Cómo se diseña una prueba que diga la verdad sobre un servidor de LLMs (qué se mide, con qué tráfico, cuántas peticiones, con qué herramienta) y cómo se lee una gráfica de «3,000 tokens/s» sin dejarse engañar.
pregunta: El criterio del piloto dice «8 conversaciones a la vez a ≥ 20 tokens/s y TTFT ≤ 2 s en el p95». El proveedor manda una gráfica con «3,000 tokens/s» y un blog dice que la RTX PRO 6000 es 2× la L40S. ¿Cómo se diseña una prueba de carga que diga la verdad sobre el servidor, y cómo se lee un benchmark publicado sin dejarse engañar?
sensei: latencia, percentiles, ruido
---

:::idea
Una [[prueba-de-carga|prueba de carga]] es un experimento: se le manda al servidor **tu** tráfico (tus largos de pregunta y de respuesta, tu tasa de llegada, tu prompt compartido), **desde fuera**, durante el tiempo suficiente para que el p95 signifique algo, y se mide lo que siente la persona. Casi todos los números publicados son verdad para **otro** experimento. Un [[benchmark-honesto|benchmark honesto]] dice sus condiciones; uno que no las dice se convierte en una pregunta para tu piloto.
:::

## «3,000 tokens/s» y una promesa {“3,000 tokens/s” and a promise}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**; en la hora pico llegan ≈ **0.21 preguntas por segundo** (750 en una hora). Cada pregunta lleva ≈ **6,000 tokens de entrada** (≈ 400 de instrucciones, iguales para todas, ≈ 100 de la pregunta y cinco fragmentos de expediente de ≈ 1,000) y la respuesta ≈ **500**. El modelo es Qwen3 32B en INT4 de [[awq|AWQ]], con el razonamiento apagado, servido con [[vllm|vLLM]] 0.34.0 en **3 L40S**, una copia en cada una, detrás de un [[gateway-de-llm|gateway]] (LiteLLM). La alternativa a cotizar son 2 RTX PRO 6000 Blackwell Server Edition. La prueba piloto dura 8 semanas, con 20 abogados y una GPU rentada de la semana 2 a la 7.

El contrato del piloto tiene un [[criterio-de-aceptacion|criterio de aceptación]] de velocidad: **8 conversaciones a la vez, cada una a ≥ 20 tokens/s, y [[ttft|TTFT]] ≤ 2 s en el p95**. En la misma semana llegan dos papeles:

- El proveedor de hardware manda una gráfica: «hasta **3,000 tokens/s** con Qwen3 32B».
- Un abogado reenvía un blog: «la RTX PRO 6000 es **2×** la L40S».

Las dos cifras pueden ser verdad y ninguna responde la pregunta del contrato. Las cuentas tampoco la cierran: el prefill de 6,000 tokens en una L40S tarda ≈ 2.38 s **sin fila**, y la simulación de [De requisitos a hardware](/requisitos-hardware/) dio un p95 de ≈ 4.2 s en la hora pico. Son cuentas con supuestos; el número que se firma sale de **medir**.

Tres cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Un percentil se calcula ordenando y contando desde abajo: el p95 de 200 tiempos es el del lugar 190. Lo ves en [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/).
- Una prueba de carga sube la carga por escalones y busca el codo; la carga **cerrada** (N usuarios que esperan su respuesta) y la **abierta** (una tasa que no espera a nadie) no miden lo mismo, y la cerrada esconde los peores momentos. Lo ves en [Qué tan rápido y cuánto: latencia y throughput](https://sensei.trueml.app/latencia/).
- Una medición tiene ruido: dos corridas iguales no dan el mismo número, y hace falta un tamaño de muestra para distinguir. Lo ves en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/).

Y de esta app, [Concurrencia](/concurrencia/) definió los relojes de una respuesta ([[ttft|TTFT]], [[tpot|TPOT]], [[itl|ITL]]), el [[codo]], el [[slo|SLO]] y el [[goodput]]. Aquí se construye encima: **cómo se mide de verdad**, con qué herramienta, con cuántas peticiones, y qué condiciones exigirle a un número publicado.

## Qué se mide, y dónde {What gets measured, and where}

Una [[prueba-de-carga|prueba de carga]] (*load test*) es un programa, el **generador de carga**, que le manda peticiones **sintéticas** (parecidas a las de los abogados, no las suyas) a un ritmo controlado y anota de cada una cuándo salió, cuándo llegó el primer token, cuándo cada token y cuándo terminó. De esas horas salen todas las métricas.

### Los relojes, por petición

De cada petición salen cuatro números. Ya los conoces de [Concurrencia](/concurrencia/); aquí va qué hace cada uno en la prueba:

| Reloj | Qué es | Promesa del despacho | Lo decide sobre todo |
|---|---|---|---|
| [[ttft\|TTFT]] | Del envío al primer token | ≤ 2 s en el p95 | El [[prefill]] y la fila delante |
| [[tpot\|TPOT]] | (latencia total − TTFT) ÷ (tokens − 1): el ritmo promedio de una respuesta | ≤ 50 ms en el p95 (= ≥ 20 tokens/s) | El [[decode]] y cuántas conversaciones comparten la GPU |
| [[itl\|ITL]] | Cada intervalo suelto entre dos tokens | Sin promesa propia; delata tirones | Prefills ajenos que se meten en medio |
| Latencia total (E2E) | Del envío al último token | ≈ 27 s es el peor caso aceptable | Todo lo anterior |

### Los números del servidor completo

Además, de la corrida entera salen:

- **Peticiones por segundo** que de verdad se mandaron y terminaron. Si pediste 0.21 y salieron 0.18, la prueba no probó lo que creías.
- **Tokens por segundo del servidor**: de salida y totales (entrada + salida), dos números distintos.
- **Tokens por segundo por persona**: lo que ve cada abogada; el anterior entre los que están adentro al mismo tiempo.
- **Errores**: 429, 5xx, streams cortados, respuestas vacías. Las que fallan rápido bajan el p95: con errores, los percentiles mienten.
- **[[goodput|Goodput]]**: las peticiones por segundo que cumplieron **todas** las promesas.

### En qué percentil

Cada reloj se reporta en **p50, p95 y p99**, nunca solo en promedio: el p50 es la persona típica, el p95 la promesa, el p99 la alarma de que la cola se alarga. Y siempre con **cuántas peticiones hay detrás**: un p99 de 50 peticiones es, literalmente, la más lenta.

:::ojo
Lee **cómo define cada herramienta** cada número. A noviembre de 2026, lo que vLLM llama TPOT (el promedio por petición sin el primer token), GuideLLM 0.8.1 y NVIDIA AIPerf 0.14.0 lo llaman ITL; el «Time Per Output Token» de GuideLLM **incluye** el primer token; y según una guía de NVIDIA, LLMPerf mete el TTFT dentro de su ITL. La propia documentación de vLLM lo dice: la terminología de métricas «no está estandarizada» entre herramientas. Dos reportes con la misma palabra pueden medir cosas distintas.
:::

### Dónde se pone el cronómetro

El cronómetro va donde está la persona. El abogado habla con Open WebUI, que habla con el gateway, que reparte entre las tres copias. Directo a una copia de vLLM, la prueba se salta la autenticación, la cuota y el reparto, y mide **una** GPU. Por eso va **contra el gateway**, con su propia clave de pruebas.

:::diagrama pruebas-carga-banco
La prueba de carga del despacho. El generador, en otra máquina, le manda al gateway las preguntas del dataset de carga; el gateway las reparte entre las tres copias. Toca cada caja para ver qué se mide ahí, o sigue el recorrido de una petición.
:::

Dos detalles de esa clave. **Su cuota**: la de una abogada es de ≈ 936 tokens por minuto; con ella, a la cuarta pregunta seguida la prueba recibe un 429 y mide la cuota, no el servidor. La clave de pruebas lleva una cuota a la medida de la prueba. **El registro**: el gateway anota una fila por pregunta; si el generador dice 1,000 y el registro 940, algo se perdió en medio.

## El dataset de carga: tu tráfico, no el de otro {The load dataset: your traffic, not someone else's}

El [[dataset-de-carga|dataset de carga]] es la lista de peticiones que el generador manda: cada una con su texto de entrada y su tope de salida. Es la decisión que más cambia el resultado. En una misma L40S con el mismo modelo, NVIDIA mide ≈ 4,251 tokens/s con peticiones de 200 tokens de entrada y 200 de salida, y 889 con 5,000 de entrada y 500 de salida (las cifras de [Concurrencia](/concurrencia/)): casi 5 veces menos, por el largo de la pregunta. Un benchmark con preguntas cortas no dice nada de un despacho que manda 6,000 tokens.

### Qué tiene que parecerse

El dataset del despacho copia su [[perfil-de-carga|perfil de carga]]:

- **Largo de entrada**: ≈ 6,000 tokens, **con variación**. ± 30 % (de ≈ 4,200 a ≈ 7,800) es un supuesto razonable hasta medir las reales; con todas iguales, la fila se ve más pareja de lo que será.
- **Largo de salida**: tope de 500. Con un tope, el modelo puede terminar antes; vLLM fuerza el largo (`--ignore-eos`) solo con su dataset sintético `random`. Con uno propio, se declara cuánto salió de verdad.
- **Lo que se comparte y lo que no**: el punto fino, abajo.
- **Sin datos de clientes**: fragmentos **sintéticos** con el estilo de un expediente. Para medir segundos no hacen falta secretos.

### El prefix caching: lo que infla los números

[[prefix-caching|Prefix caching]] es reutilizar el trabajo del [[prefill]] cuando el inicio de un prompt ya se calculó antes: el servidor guarda los bloques de KV cache de ese inicio y, si llega otro prompt que empieza igual, se salta esa parte. En vLLM 0.34.0 viene **prendido por omisión** (lo dice el código de esa versión, aunque una página de su documentación todavía diga que hay que prenderlo). Cómo funciona por dentro lo ves en [Batching continuo y PagedAttention](/batching/).

Para la prueba importa una sola cosa: **un prompt repetido es un prompt casi gratis**. Si el dataset manda 1,000 veces la misma pregunta de 6,000 tokens, desde la segunda el servidor casi no hace prefill: el TTFT se desploma y los tokens/s suben. La documentación de vLLM 0.34.0 lo advierte con todas sus letras: repetir `vllm bench serve` contra el mismo servidor puede reutilizar prompts que quedaron en el cache e **inflar el throughput**, y el dataset sintético se repite igual si no cambias la semilla.

:::figura pruebas-carga-prompt
Tres datasets para el mismo despacho y cuánto prefill le dejan al servidor. Arriba, el realista: las instrucciones de 400 tokens se repiten (eso sí pasa en producción), la pregunta y los fragmentos no. En medio, el tramposo: el mismo prompt mil veces. Abajo, el ingenuo: todo al azar, sin el prefijo que de verdad se comparte.
:::

El despacho tiene un caso intermedio, y la prueba tiene que respetarlo:

- Los ≈ **400 tokens de instrucciones** son idénticos en todas las preguntas. En producción **sí** se reutilizan: es un acierto real, ≈ 400 ÷ 6,000 ≈ 6.7 % del prefill. Quitarlo sería ser pesimista de más.
- La pregunta y los **cinco fragmentos** cambian en cada pregunta. En producción **no** se reutilizan. Repetirlos sería ser optimista de más.

La receta: cada prompt del dataset empieza con **el mismo texto de instrucciones**, idéntico token por token, y sigue con una pregunta y cinco fragmentos distintos. Para comprobar que el servidor vio lo que creías, vLLM expone dos contadores en su `/metrics`: `vllm:prefix_cache_queries` y `vllm:prefix_cache_hits`. Si los aciertos son muchos más que el ≈ 6.7 % esperado, el dataset se repite.

:::ojo
Entre corrida y corrida, **reinicia el servidor o vacía su cache**. Si no, la segunda corrida encuentra en el cache los prompts de la primera y sale mejor sin que nada haya cambiado. La documentación de vLLM recomienda cambiar la semilla, reiniciar, o usar `vllm bench sweep serve`, que vacía los caches del servidor entre corridas.
:::

El dataset manda preguntas sueltas, sin repreguntas: una simplificación honesta, porque casi todo el tráfico es la primera pregunta. Una repregunta lleva la conversación entera y, con la afinidad por conversación del gateway, cae en la copia que ya tiene ese inicio en su cache: otro acierto real. Si el piloto muestra muchas, se agregan conversaciones de dos turnos al dataset.

## Abierta contra cerrada, con tokens {Open versus closed load, with tokens}

Hay dos formas de decidir **cuándo** sale cada petición del generador, y miden cosas distintas.

**[[carga-cerrada|Carga cerrada]]** (*closed-loop*): hay N usuarios virtuales; cada uno manda su petición, espera la respuesta completa y, en cuanto llega (o tras una pausa fija), manda la siguiente. El número que fijas es **cuántas hay adentro**. Las curvas de [Concurrencia](/concurrencia/) («100 a la vez», «200 a la vez») son cerradas.

**[[carga-abierta|Carga abierta]]** (*open-loop*): hay un **calendario**. Cada petición tiene su hora de salida, decidida antes de empezar, y sale a esa hora pase lo que pase con las anteriores. El número que fijas es **cuántas llegan por segundo**. Así llegan los abogados: nadie espera a que termine la pregunta de su colega para hacer la suya.

### El calendario: llegadas de Poisson

Para la hora pico del despacho, el calendario es un **proceso de Poisson** a 0.21 por segundo: en promedio una pregunta cada 1 ÷ 0.21 ≈ 4.8 s, pero al azar, de modo que a veces llegan dos casi juntas y a veces pasan 15 s sin nada (las llegadas de Poisson se explican en [Concurrencia](/concurrencia/)). Se genera sorteando el hueco entre una y otra con una distribución exponencial de media 4.8 s. `vllm bench serve` hace exactamente eso con `--request-rate 0.21` (y `--burstiness 1`, que es Poisson; un valor menor que 1 hace llegadas más a ráfagas, mayor que 1 más parejas). Las ráfagas importan: son las que forman la fila del prefill y empujan el p95.

:::diagrama pruebas-carga-abierta-cerrada
La misma tasa pedida, dos maneras de generarla. Arriba, la abierta: un calendario fijo, el servidor no lo puede frenar. Abajo, la cerrada: cada usuario virtual manda la siguiente cuando le llega la anterior. Sigue el recorrido del día en que el servidor se pone lento.
:::

### Lo que genera una prueba cerrada

Una prueba cerrada **no fija la tasa**: la tasa sale sola, de cuántos hay adentro y cuánto tarda cada uno. Es la [[ley-de-little|ley de Little]] al revés.

:::formula La tasa que genera una prueba cerrada (Little)
λ = frac{N}{W}
- λ: peticiones por segundo que el generador manda, en 1/s
- N: usuarios virtuales, cada uno con una petición adentro, sin pausa entre una y otra
- W: lo que tarda cada petición de punta a punta, en s
:::

:::cuenta Una prueba cerrada de 8 conversaciones del despacho
Usuarios virtuales, \(N\) // las 8 conversaciones de diseño del criterio | — | 8
Duración de cada respuesta, \(W\) // 2 s al primer token + 500 ÷ 20 = 25 s escribiendo (el peor caso aceptable) | 2 + 25 | 27 s
Tasa que genera, \(λ\) // \(N ÷ W\) | 8 ÷ 27 | 0.296 /s
Contra la hora pico // 750 ÷ 3,600 = 0.208 /s | 0.296 ÷ 0.208 | 1.42×
Si el servidor se pone el doble de lento, \(W\) // cada respuesta tarda 54 s | 8 ÷ 54 | 0.148 /s
= Una prueba de 8 a la vez manda ≈ 1.4 veces el tráfico de la hora pico mientras todo va bien (el «margen de diseño» de 1.4 de la ficha). Pero si el servidor se frena, la prueba **le manda la mitad**: el servidor «mejora» porque le llega menos. Los abogados no hacen eso.
:::

Esa es la trampa de la cerrada, y la razón de la regla de Sensei: **para medir la latencia que sentirá la gente a su tasa real, abierta; para encontrar el techo, cerrada**. Las dos tienen su lugar en el plan del despacho.

:::profundo Por qué hay quien prefiere la cerrada
La guía de benchmarking de NVIDIA recomienda medir con **concurrencia** (cerrada), y GuideLLM busca el goodput variando concurrencia. No es un error: es otra pregunta. Si la tasa abierta pasa de lo que el servidor aguanta, las pendientes **crecen sin tope** y la prueba mide la fila. Simulando una sola GPU con prefill fijo de 2.38 s al 105 % de su capacidad, el p50 llega a **1,886 s** tras 20,000 peticiones, y sigue creciendo. Con N = 8 adentro, la cerrada nunca pasa de 7 en fila. Por arriba de la capacidad, «¿cuál es el p95?» ya no tiene respuesta: ya encontraste el techo.
:::

## La omisión coordinada: cuando la prueba deja de mirar {Coordinated omission: when the test stops looking}

La [[omision-coordinada|omisión coordinada]] (*coordinated omission*) es el error de medir la latencia solo de las peticiones que el generador **alcanzó a mandar**, cuando el propio generador se frenó porque el servidor iba lento. El generador «se coordina» con el servidor: deja de mandar justo en los peores momentos y, por lo tanto, deja de medirlos. El nombre se lo puso Gil Tene, autor de la herramienta wrk2; en su descripción, el generador termina **coordinándose con el servidor para evitar medir durante los periodos de latencia alta**. Sensei la explica con un servidor que se congela 1 s ([Qué tan rápido y cuánto: latencia y throughput](https://sensei.trueml.app/latencia/)); aquí va la versión que le pasa a quien prueba un LLM.

:::analogia El repartidor que solo anota sus entregas
Una pizzería mide «cuánto tarda una entrega»: el repartidor anota la hora en que sale con la pizza y la hora en que la entrega. Un viernes la moto se descompone una hora. Los pedidos se juntan en el mostrador. Cuando la moto vuelve, el repartidor sale con cada pizza y anota, como siempre, 20 minutos por entrega. Su promedio del viernes es perfecto. Los clientes que esperaron una hora y veinte no aparecen en ningún lado, porque el cronómetro arrancaba al **salir**, no cuando el cliente **pidió**.

Dónde se rompe: en la pizzería los clientes llaman para quejarse; en una prueba de carga, las peticiones que no salieron no se quejan: simplemente no existen en el reporte, y nadie lo nota si no compara cuántas se pidieron con cuántas salieron.
:::

### Cómo le pasa a una prueba de LLM

Casi nadie hace una prueba cerrada por error. Le pasa a quien cree que hizo una abierta. El caso típico: se pide una tasa (`--request-rate 0.42`, el doble del pico) y, para «no tumbar el servidor», se pone un **tope de peticiones en vuelo en el cliente** (`--max-concurrency 8`). La documentación de vLLM lo avisa: con una tasa finita y un tope, si el servidor no alcanza, la tasa real baja. Con el tope lleno, las peticiones esperan **en el cliente**, antes de salir, y su espera no entra al TTFT ni a la latencia total: esas se miden desde el envío.

El remedio es medir **desde la hora del calendario**, no desde el envío: la [[latencia-programada|latencia desde la hora programada]]. Esa espera en el cliente sí la siente quien pidió. Este programa simula las tres copias del despacho (una fila de prefill de 2.38 s por GPU, reparto al azar, 25 s escribiendo sin frenar a nadie) y tres pruebas: abierta a la hora pico, abierta al doble, y la «abierta» con tope de 8.

```python
import heapq, math, random

def p95(xs):                                   # contar desde abajo: la del lugar ⌈0.95 n⌉
    xs = sorted(xs)
    return xs[math.ceil(0.95 * len(xs)) - 1]

def prueba(tasa, tope=None, n=3000, gpus=3, prefill=2.38, escribir=25.0):
    rnd = random.Random(17)
    libre = [0.0] * gpus                       # cuándo termina cada GPU de leer su último prompt
    huecos = [0.0] * (tope or 1)               # el tope del cliente: cuándo se libera cada lugar
    t, envios, ttft, e2e, e2e_cal = 0.0, [], [], [], []
    for _ in range(n):
        t += rnd.expovariate(tasa)             # la hora programada (llegadas de Poisson)
        envio = max(t, heapq.heappop(huecos)) if tope else t
        g = rnd.randrange(gpus)                # reparto al azar entre las 3 copias
        primer = max(envio, libre[g]) + prefill
        libre[g] = primer
        if tope: heapq.heappush(huecos, primer + escribir)
        envios.append(envio); ttft.append(primer - envio)
        e2e.append(primer + escribir - envio); e2e_cal.append(primer + escribir - t)
    real = (n - 1) / (envios[-1] - envios[0])
    print(f"pidió {tasa}/s, tope {tope}: salieron {real:.3f}/s | TTFT p95 {p95(ttft):.1f} s"
          f" | E2E p95: desde el envío {p95(e2e):.0f} s, desde la hora programada {p95(e2e_cal):.0f} s")

prueba(0.21)           # abierta: la hora pico del despacho
prueba(0.42)           # abierta: el doble del pico
prueba(0.42, tope=8)   # la misma tasa pedida, con un tope de 8 en vuelo en el cliente
```

```salida
pidió 0.21/s, tope None: salieron 0.212/s | TTFT p95 4.3 s | E2E p95: desde el envío 29 s, desde la hora programada 29 s
pidió 0.42/s, tope None: salieron 0.424/s | TTFT p95 5.3 s | E2E p95: desde el envío 30 s, desde la hora programada 30 s
pidió 0.42/s, tope 8: salieron 0.292/s | TTFT p95 2.4 s | E2E p95: desde el envío 27 s, desde la hora programada 3075 s
```

Léelo renglón por renglón:

- **Abierta a 0.21/s**: TTFT p95 ≈ 4.3 s, como los ≈ 4.2 s de [De requisitos a hardware](/requisitos-hardware/) (es el mismo modelo de la fila). Sin tope, medir desde el envío o desde el calendario da lo mismo.
- **Abierta a 0.42/s**: el doble de tráfico sube el TTFT p95 a 5.3 s.
- **Con tope de 8**: el reporte se ve **mejor que la hora pico** (TTFT p95 de 2.4 s, casi el prefill solo), pero salieron 0.292/s, no 0.42: con 8 lugares y ≈ 27.4 s por respuesta, Little da 8 ÷ 27.4 ≈ 0.29. El resto esperó en el cliente; desde su hora programada, el p95 pasa de **3,000 s** y crece mientras más dure la prueba. El reporte de TTFT no lo dice.

Es un modelo de juguete (el decode no se frena con más gente, sin red ni búsqueda): sirve para ver el efecto, no para firmar números.

:::profundo Las herramientas ya lo miden, si se lo pides
A noviembre de 2026, dos de las herramientas de LLM traen la latencia desde la hora programada:

- **vLLM 0.34.0**, con `--max-concurrency` y una tasa finita, anota `client_queue_time` (cuánto esperó cada petición en el cliente) y `e2el_including_client_queue` (la latencia total más esa espera). **No se imprimen por omisión**: hay que pedirlas en `--percentile-metrics`. El TTFT sigue contando desde el envío real.
- **GuideLLM 0.8.1** reporta `request_dispatch_delay` (cuánto se atrasó el envío respecto del calendario) y `request_scheduled_latency` (del calendario al final), en las estrategias donde aplica.

:::

La regla del despacho: la prueba de la promesa va **sin tope en el cliente**, y en toda corrida se compara la tasa pedida con la que salió.

## Calentamiento, duración y cuántas peticiones {Warm-up, duration and how many requests}

### Calentar antes de medir

El [[calentamiento]] (*warm-up*) son las primeras peticiones de una prueba, que se mandan pero **no se cuentan**. Un servidor recién arrancado es más lento al principio por razones ajenas a la carga: conexiones que se abren por primera vez, caches vacíos, trabajo de preparación del motor. Si entran al reporte, el p99 refleja el arranque. En `vllm bench serve`, `--num-warmups 20`; en GuideLLM, `warmup=` en el perfil (y `cooldown=` descarta el final, cuando el servidor se vacía).

### Cuántas peticiones para un p95 que signifique algo

El p95 de una prueba es **una** petición: la del lugar \(⌈0.95 n⌉\), con las \(0.05 n\) más lentas arriba. Con 100 peticiones es la 95.ª, y la deciden las 5 más raras de la corrida. Con 20, el «p95» es la segunda más lenta, y el p99 es la más lenta de todas. Si la prueba se repite, esas pocas cambian, y el p95 con ellas.

Lo que importa es saber **entre qué valores está el p95 verdadero** (el que darías con infinitas peticiones) dada tu muestra. Hay un método que no supone ninguna forma de la distribución: el [[intervalo-del-percentil|intervalo de confianza de un percentil]] por estadísticos de orden. La idea, en palabras: cada petición, por separado, tiene 95 % de probabilidad de quedar debajo del p95 verdadero. Entonces **cuántas** quedan debajo, de \(n\), es como contar caras en \(n\) volados cargados al 95 %: una binomial. Con esa binomial se buscan dos lugares de la lista ordenada, \(l\) y \(u\), tales que el p95 verdadero cae entre la petición \(l\) y la \(u\) con al menos 95 % de probabilidad.

:::formula El p95 de una muestra y su intervalo
r = ⌈q × n⌉
k = n × (1 − q)
P(l ≤ B ≤ u − 1) ≥ 0.95, con B ∼ text{Binomial}(n, q)
q ± 1.96 × sqrt{frac{q(1 − q)}{n}}
D = frac{n}{λ}
- q: el percentil, como fracción (0.95 = el p95)
- n: peticiones medidas, sin el calentamiento
- r: el lugar del percentil en la lista ordenada de menor a mayor
- k: cuántas quedan arriba de él, en promedio
- l, u: los lugares de la lista entre los que cae el percentil verdadero (la tercera línea, exacta)
- B: cuántas de las n quedan debajo del percentil verdadero
- la cuarta línea: la misma banda aproximada con la campana, en fracción de percentil; sirve con n grande
- D: cuánto dura la prueba a la tasa λ, en s
:::

:::cuenta El p95 de 200 y de 1,000 peticiones, a la tasa del despacho
Lugar del p95 con 200, \(r\) // \(⌈q × n⌉\) | ⌈0.95 × 200⌉ | 190.ª
Arriba de ella, \(k\) // \(n × (1 − q)\) | 200 × 0.05 | 10
Intervalo exacto, \(l\) a \(u\) // binomial, el programa de abajo | — | 184.ª a 197.ª
En percentiles // \(l ÷ n\) y \(u ÷ n\) | 184 ÷ 200 y 197 ÷ 200 | p92.0 a p98.5
Duración a 0.21/s, \(D\) // \(n ÷ λ\) | 200 ÷ 0.21 | 952 s ≈ 16 min
Lugar del p95 con 1,000, \(r\) | ⌈0.95 × 1,000⌉ | 950.ª
Intervalo exacto con 1,000 | — | 936.ª a 964.ª = p93.6 a p96.4
Aproximado con la campana // \(q ± 1.96 × \sqrt{q(1 − q) ÷ n}\) | 0.95 ± 1.96 × √(0.0475 ÷ 1,000) | p93.6 a p96.4
Duración con 1,000, \(D\) | 1,000 ÷ 0.21 | 4,762 s ≈ 79 min
= Con 200 peticiones, lo que reportas como «p95» puede ser, en verdad, cualquier cosa entre el p92 y el p98.5: una banda de seis puntos y medio. Con 1,000, de menos de tres puntos, pero la prueba dura 1 h 19 min a la tasa del despacho.
:::

:::profundo El intervalo exacto, en Python
El cálculo exacto cabe en unas líneas. Sumar la binomial es contar las formas de que \(i\) de las \(n\) queden debajo:

```python
import math

def acumulada(n, q, k):                 # P(B ≤ k), con B ~ Binomial(n, q)
    return sum(math.comb(n, i) * q**i * (1 - q)**(n - i) for i in range(k + 1))

def ic_percentil(n, q=0.95, conf=0.95):
    a = (1 - conf) / 2
    l = max(j for j in range(1, n + 1) if acumulada(n, q, j - 1) <= a)
    u = min(j for j in range(1, n + 1) if acumulada(n, q, j - 1) >= 1 - a)
    return l, u

for n in (100, 200, 1000):
    l, u = ic_percentil(n)
    print(f"n={n:>5}: el p95 es la del lugar {math.ceil(0.95 * n)};"
          f" el p95 verdadero está entre la {l} y la {u} (p{100*l/n:.1f} a p{100*u/n:.1f})")
print("mínimo para tener intervalo:", math.ceil(math.log(0.025) / math.log(0.95)), "peticiones")
```

```salida
n=  100: el p95 es la del lugar 95; el p95 verdadero está entre la 90 y la 100 (p90.0 a p100.0)
n=  200: el p95 es la del lugar 190; el p95 verdadero está entre la 184 y la 197 (p92.0 a p98.5)
n= 1000: el p95 es la del lugar 950; el p95 verdadero está entre la 936 y la 964 (p93.6 a p96.4)
mínimo para tener intervalo: 72 peticiones
```

La última línea es el mínimo para que exista el intervalo: con menos de 72 peticiones, ni siquiera la más lenta asegura con 95 % que el p95 verdadero quedó debajo.
:::

GuideLLM 0.8.1 reporta este mismo intervalo de fábrica (`confidence=0.95`), con los mismos mínimos: 72 peticiones para el p95, 368 para el p99 y 3,688 para el p99.9; por debajo, deja el intervalo vacío.

:::figura pruebas-carga-percentil
Dónde puede estar el p95 verdadero según cuántas peticiones mediste. Cada barra es el intervalo de 95 % por estadísticos de orden; la raya, el p95 que reportarías. Con 100 la banda va del p90 al máximo; con 5,000 cabe en un punto.
:::

:::calculadora pruebas-carga-p95
Mueve las peticiones y mira cómo se angosta la banda y cuánto dura la prueba. Cambia el percentil a 99 para ver por qué un p99 pide cinco veces más.
:::

:::profundo En segundos, no en percentiles
Cuántos **segundos** son esos percentiles depende de la cola. Una simulación de una L40S del despacho (su parte de la hora pico, reparto al azar, prefill fijo de 2.38 s; p95 «verdadero» de 4.23 s con 400,000 peticiones), repitiendo la prueba 300 veces con cada tamaño:

| Peticiones por prueba | p95 medido (mediana) | 95 % de las pruebas dan entre |
|---|---|---|
| 100 | 4.09 s | 2.96 y 4.68 s |
| 200 | 4.17 s | 3.50 y 4.63 s |
| 1,000 | 4.22 s | 3.94 y 4.45 s |
| 5,000 | 4.24 s | 4.12 y 4.34 s |

Con 100 peticiones, una corrida dice «3.0 s» y otra «4.7 s» en la **misma** máquina: con un criterio de 4 s, la GPU pasaría o reprobaría según la suerte. Con 1,000, la banda es de ≈ ± 0.25 s.
:::

:::ojo
El intervalo binomial supone que las peticiones son independientes. En una fila **no lo son**: la que llega justo detrás de otra espera por ella, y las ráfagas mueven varias a la vez. GuideLLM lo aclara: su intervalo describe la precisión de **esa** corrida tratando las peticiones como independientes, no cuánto se movería al repetirla. Por eso la regla práctica del despacho tiene dos partes: **≥ 1,000 peticiones por punto medido** y **≥ 3 repeticiones del punto que decide** (la tasa de la hora pico), con el servidor reiniciado entre ellas. Si las tres no coinciden dentro de la banda, hace falta más.
:::

## Rampa, resistencia y un generador que no estorbe {Ramp, soak and a generator that stays out of the way} [extra]

### La rampa: dónde se dobla la curva

Una [[rampa]] sube la tasa poco a poco y mira cuándo empeora todo. En el despacho, de 0.1/s (media hora pico) a **0.42/s** (el doble del pico). Sirve para ver dónde está el [[codo]] y **cuánto margen** hay antes de él: si el TTFT p95 ya rompe a 0.25/s, cualquier mañana algo más cargada que la hora pico de diseño lo rompe.

Se sube **por escalones** (corridas abiertas a 0.10, 0.21, 0.31 y 0.42, cada una con su calentamiento y su p95: lo más limpio, pero son horas) o **en línea recta** (de 0.1 a 0.42/s en 30 minutos son ≈ 468 peticiones: la tasa promedio, 0.26/s, por 1,800 s). La recta encuentra el codo rápido, pero cada tramo tiene muy pocas peticiones para firmar un p95.

A noviembre de 2026, la rampa de `vllm bench serve` (`--ramp-up-strategy`, `--ramp-up-start-rps`, `--ramp-up-end-rps`) solo acepta tasas **enteras** de peticiones por segundo: no sirve para 0.1 a 0.42. GuideLLM (`rampup_duration` en el perfil) y AIPerf (`--request-rate-ramp-duration`, o una lista de tasas: `--request-rate 0.1,0.21,0.42`) sí.

### La prueba de resistencia: lo que solo sale con horas

Una [[prueba-de-resistencia|prueba de resistencia]] (*soak test*) sostiene la carga de diseño durante **horas** (para el despacho, la tasa pico durante una jornada de 8 a 10 h). No busca el codo; busca lo que una prueba de una hora no ve:

- **Memoria que crece**: un proceso que no suelta memoria se reinicia tarde o temprano, a media mañana.
- **Calor**: una GPU caliente baja su reloj para protegerse (*thermal throttling*). Una tarjeta pasiva como la L40S depende de que el servidor y el cuarto la enfríen; en la nube eso lo cuida el proveedor, en el cuarto del despacho no. Por eso se repite con el servidor comprado, en su cuarto.
- **Registros que se llenan**: el del gateway, los chats de Open WebUI.

Basta con anotar el p95 por hora: si la hora 7 sale peor que la 1 con la misma tasa, algo se está gastando. Cómo vigilar temperatura y memoria es tema de «Observabilidad de GPUs e inferencia».

### Que el generador no sea el cuello de botella

El generador también es un programa, con su CPU, su red y su manera de contar tokens. Si se satura, manda tarde y mide tarde, y su atraso parece del servidor. Tres cuidados:

- **En otra máquina**, no en el servidor que se prueba: si comparten CPU, el generador le roba al gateway y al motor.
- **Con el tokenizador local**: contar tokens de 6,000 en cada respuesta cuesta CPU. Las herramientas de LLM lo cargan una vez al inicio (`--tokenizer`).
- **Vigilando su propio atraso**: el retraso de envío (`request_dispatch_delay` en GuideLLM, `client_queue_time` en vLLM) debe quedarse en ≈ 0. InferenceX, un benchmark público, admite que su cliente se vuelve el cuello con modelos chicos, tasas altísimas y secuencias cortas. A 0.21/s el despacho está lejísimos de eso, pero la línea se revisa igual.

## Las herramientas, con versión y licencia {The tools, with version and license}

A noviembre de 2026 estas son las que vas a encontrar. Las versiones y licencias son de sus repositorios, consultados el 26 de noviembre de 2026.

| Herramienta | Versión (fecha) | Licencia | Carga | Para qué sirve |
|---|---|---|---|---|
| `vllm bench serve` | parte de vLLM 0.34.0 (16 nov 2026) | Apache-2.0 | Abierta (Poisson o gamma con `--request-rate`), con tope opcional | La que ya viene con el motor del despacho; habla con cualquier API compatible con OpenAI |
| GuideLLM | 0.8.1 (8 oct 2026) | Apache-2.0 | Una a la vez, cerrada, constante, Poisson, barrido, codo, goodput, trazas | Barridos automáticos, intervalos de los percentiles, latencia desde la hora programada |
| NVIDIA AIPerf | 0.14.0 (20 nov 2026) | Apache-2.0 | Cerrada (`--concurrency`) o abierta (`--request-rate`, Poisson por omisión) | Sucesor de GenAI-Perf; prompt de sistema compartido, rampas, gráficas |
| LLMPerf (Ray) | v2.0 (dic 2023), repositorio **archivado** | Apache-2.0 | Cerrada | Aparece en blogs viejos; ya no se mantiene |
| k6 (Grafana) | 2.4.0 (12 nov 2026) | **AGPL-3.0** | Cerrada (`constant-vus`) o abierta de espaciado fijo (`constant-arrival-rate`) | HTTP en general: el gateway, el SSO, Open WebUI |
| Locust | 2.47.0 (21 oct 2026) | MIT | Usuarios que esperan (cerrada), con pausas que pueden ser de Poisson | HTTP en general, con escenarios escritos en Python |

Lo que hay que saber de cada una:

- **`vllm bench serve`** ya está donde está vLLM, entiende datasets propios en JSONL y calcula goodput. Sus valores por omisión engañan: el percentil por omisión es **solo el p99**, la latencia total no se imprime si no se pide, y la salida de un dataset propio se corta en **256** tokens si no le dices otro.
- **GuideLLM** está dentro del proyecto vLLM, cuya documentación la recomienda para probar a fondo una configuración. Su línea de comandos **cambió** en la 0.7/0.8 (ahora `guidellm run --profile kind=...`): un tutorial de 2025 ya no sirve.
- **AIPerf** se presenta como sucesora y reemplazo directo de GenAI-Perf, que no tiene versiones nuevas desde agosto de 2025.
- **k6 y Locust** no cuentan tokens ni miden TTFT por sí solos: sirven para lo que está **alrededor** (que el SSO aguante a 200 personas entrando a las 9:00). El modo abierto de k6 espacia las llegadas **parejo**, no al azar; Locust, aunque tiene pausas de Poisson, sigue siendo cerrado. La AGPL-3.0 de k6 es distinta de MIT o Apache; para probar un servidor propio basta con saberlo (las licencias se ven en [Open weight, open source y licencias](/licencias/)).

### El comando del despacho, flag por flag

Con `vllm bench serve` de vLLM 0.34.0, la prueba de la hora pico contra el gateway del despacho se vería así (los flags son los de la documentación y el código de esa versión; el comando no se corrió aquí, porque esta máquina no tiene GPU, y la dirección y la clave son del ejemplo):

```bash
export OPENAI_API_KEY="$CLAVE_DE_PRUEBAS"      # la clave de pruebas del gateway, con su propia cuota
vllm bench serve \
  --backend openai-chat --endpoint /v1/chat/completions \
  --base-url https://gateway.despacho.local \
  --model chat-grande --tokenizer Qwen/Qwen3-32B \
  --dataset-name custom --dataset-path carga_despacho.jsonl --skip-chat-template \
  --custom-output-len 500 --num-prompts 1000 --num-warmups 20 \
  --request-rate 0.21 --burstiness 1 --seed 17 \
  --extra-body '{"chat_template_kwargs": {"enable_thinking": false}}' \
  --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,95,99 \
  --goodput ttft:2000 tpot:50 \
  --save-result --save-detailed --result-dir resultados/ \
  --metadata gpu=3xL40S motor=vllm-0.34.0 tasa=0.21
```

:::profundo Lo que hace cada flag
- `--backend openai-chat --endpoint /v1/chat/completions --base-url …`: le habla al **gateway** con la [[api-compatible-openai|API compatible con OpenAI]], igual que Open WebUI. La clave se lee de la variable `OPENAI_API_KEY` y viaja como `Authorization: Bearer`.
- `--model chat-grande`: el nombre que publica el gateway, no el de vLLM. `--tokenizer` hace falta para contar tokens del lado del cliente.
- `--dataset-name custom --dataset-path …`: el dataset de carga en JSONL, una línea por petición con su campo `prompt`. `--skip-chat-template` evita que el cliente le aplique la plantilla de chat al texto y luego el servidor otra vez. `--custom-output-len 500` sube el tope de 256.
- `--request-rate 0.21 --burstiness 1`: abierta, Poisson, a la tasa pico. **Sin** `--max-concurrency`: así la tasa no se frena sola.
- `--num-warmups 20 --num-prompts 1000`: calentamiento y las 1,000 que se miden (≈ 79 min).
- `--extra-body`: el razonamiento apagado por si acaso; el vLLM del despacho ya arranca con él apagado por omisión (lo ves en [Del laptop al servidor](/stack-serving/)).
- `--percentile-metrics … --metric-percentiles 50,95,99`: pide la latencia total y el **p95**, que por omisión no salen.
- `--goodput ttft:2000 tpot:50`: las dos promesas en milisegundos; imprime las peticiones por segundo que las cumplen.
- `--save-detailed` y `--metadata`: guarda cada petición (sus tiempos, sus errores) en un JSON con las condiciones escritas adentro, para poder recalcular y comparar después. `--seed` fija el orden del dataset: la corrida se puede repetir igual.
:::

### Lo que vas a leer al final

`vllm bench serve` imprime un resumen con, entre otras, estas líneas (los nombres son los de vLLM 0.34.0): peticiones exitosas y fallidas, la tasa configurada, la duración, tokens de entrada y generados, `Request throughput (req/s)`, `Request goodput (req/s)`, `Output token throughput (tok/s)`, `Total token throughput (tok/s)` y, por cada reloj pedido, media, mediana y los percentiles. Lo que **esperarías** ver con 3 L40S, según la simulación de esta lección (ilustrativo: no es una corrida real, y el acomodo es simplificado):

```text
Successful requests:                1000
Failed requests:                    0
Request rate configured (RPS):      0.21
Request goodput (req/s):            0.00
Median TTFT (ms):                   ≈ 2,380
P95 TTFT (ms):                      ≈ 4,300
```

La línea que importa es la del **goodput: cero**. Con la L40S, el prefill de 6,000 tokens tarda ≈ 2.38 s sin fila, más que los 2 s de la promesa: **ninguna** petición puede cumplir el TTFT, aunque el servidor no esté saturado. Es lo que la ficha del despacho ya avisaba con cuentas; la prueba lo vuelve un hecho con fecha.

## Las otras herramientas por dentro {The other tools, up close} [extra]

Si el despacho prefiere GuideLLM o AIPerf, la misma prueba se escribe distinto. A noviembre de 2026:

**GuideLLM 0.8.1.** Sus perfiles (`--profile kind=`): `synchronous` (una a la vez), `concurrent` (cerrada), `throughput` (saturar), `constant` y `poisson` (abiertas), `sweep` (de una a la vez a saturado, con tasas intermedias), `knee` (el codo), `goodput` (la mayor concurrencia que cumple el SLO) y `replay` (trazas grabadas). Reporta del p0.1 al p99.9 con el intervalo de cada percentil. La prueba del despacho usa `--profile kind=poisson,rate=0.21` y el SLO `{"ttft_ms": 2000, "tpot_ms": 50}` en `--metrics`; cómo mapear el JSONL propio está en su guía de datasets. Ojo: su `tpot_ms` se compara contra **su** ITL, que la documentación llama «el más cercano al TPOT de vLLM, aunque no idéntico».

**AIPerf 0.14.0.** `aiperf profile` con `--concurrency N` (cerrada) o `--request-rate R` (abierta, acepta 0.21), `--arrival-pattern` (`poisson` por omisión), `--shared-system-prompt-length 400` (el mismo prompt de sistema en todas, como el del despacho), `--cache-bust` (impide aciertos de cache que no pasarían en producción) y `--goodput`. Su ITL también es el promedio sin el primer token. La salida de ejemplo de su README es de una corrida en CPU con un modelo de 350 millones de parámetros, y lo dice: no es una cifra para citar.

**Por qué no LLMPerf.** Archivado desde 2024, solo cerrado y, según la guía de NVIDIA, mete el TTFT en su ITL. Los números de LLMPerf de un blog son de otra definición.

## Tokens/s del servidor contra tokens/s por persona {Server tokens/s versus tokens/s per person}

El «3,000 tokens/s» del proveedor es un [[throughput-de-tokens|throughput de tokens]]: la suma de lo que reciben todos a la vez. A cada persona le toca su parte, según **cuántas hay adentro**.

:::formula Tokens por segundo por persona
v_p = frac{T}{C}
C_{max} = frac{T}{v_{min}}
- T: tokens por segundo del servidor, de salida, en la prueba publicada
- C: conversaciones generando a la vez en esa prueba
- v_p: tokens por segundo que recibe cada persona
- v_{min}: lo que promete el criterio (20 tokens/s en el despacho)
- C_{max}: cuántas personas a la vez caben en esa cifra sin bajar de v_{min}
:::

:::cuenta El «3,000 tokens/s» del proveedor, repartido
Por persona con 64 a la vez, \(v_p\) // \(T ÷ C\) | 3,000 ÷ 64 | 46.9 tokens/s
Por persona con 200 a la vez | 3,000 ÷ 200 | 15.0 tokens/s
Personas que caben a ≥ 20, \(C_{max}\) // \(T ÷ v_{min}\) | 3,000 ÷ 20 | 150
Lo que necesitan las 8 de diseño // 8 × \(v_{min}\) | 8 × 20 | 160 tokens/s
Lo que dan 3 L40S a ≥ 20 por persona // 3 GPUs × 2 conversaciones × 20 (la ficha: 7,200 tokens/min) | 3 × 2 × 20 | 120 tokens/s
= «3,000» no dice ni a cuántos atendía ni cuándo recibieron su primer token. Con 64 a la vez cada quien recibe 46.9 tokens/s, pero el TTFT de esa prueba puede ser de decenas de segundos. Y lo que el despacho necesita es mucho más modesto y mucho más exigente a la vez: 160 tokens/s, **con** TTFT ≤ 2 s y preguntas de 6,000.
:::

La última fila es la honesta: en la hora pico los abogados piden 6,250 tokens por minuto (104 por segundo), el ≈ 86.8 % de esos 120. Un servidor que «hace 3,000» no está sobrado 25 veces: ese número es de otra carga.

### Tokens de salida o tokens totales

La trampa más grande es de definición. vLLM imprime `Output token throughput` (lo que el modelo escribe) y `Total token throughput` (entrada más salida). Con preguntas cortas casi coinciden; con las del despacho, **la salida es solo el 7.7 %** de cada petición.

:::cuenta El mismo «3,000» leído de dos formas, con preguntas del despacho
Tokens por petición, \(t_{in} + t_{out}\) // 6,000 de entrada + 500 de salida | 6,000 + 500 | 6,500
Si son tokens **totales** // peticiones/s = \(T ÷ (t_{in} + t_{out})\) | 3,000 ÷ 6,500 | 0.46 /s
Si son tokens **de salida** // peticiones/s = \(T ÷ t_{out}\) | 3,000 ÷ 500 | 6.0 /s
Diferencia // una lectura contra la otra | 6.0 ÷ 0.46 | 13×
Lo que pide la hora pico, en totales // 0.21 × 6,500 | 0.21 × 6,500 | 1,365 tokens/s
= Si el «3,000» es de tokens totales y se midió con preguntas como las del despacho, el servidor atendería 0.46 preguntas por segundo, poco más del doble de la hora pico. Si es de salida, 6 por segundo. La misma cifra, trece veces de diferencia.
:::

:::figura pruebas-carga-rebanadas
El mismo «3,000 tokens/s» repartido entre más y más personas a la vez. La raya marca los 20 tokens/s del despacho: arriba de 150 a la vez ya no se cumplen. Abajo, la misma cifra leída como tokens totales o de salida.
:::

:::calculadora pruebas-carga-por-persona
Pon la cifra publicada, a cuántos atendía y si era de salida o total, y mira cuánto le toca a cada persona y cuántas preguntas del despacho por segundo representa.
:::

:::profundo El «2×» del blog
«La RTX PRO 6000 es 2× la L40S» puede ser verdad en una cosa y falso en otra. Con las cifras del [catálogo](/herramientas/catalogo/) (`gpus.json`, revisadas en noviembre de 2026), la Server Edition contra la L40S:

| Qué se compara | Server Edition | L40S | Veces |
|---|---|---|---|
| Memoria | 96 GB | 48 GB | 2.0× |
| Ancho de banda | 1,597 GB/s | 864 GB/s | 1.85× |
| Cómputo FP16 denso | 500 TFLOPS | 362.05 TFLOPS | 1.38× |
| Cómputo FP8 denso | 1,000 TFLOPS | 733 TFLOPS | 1.36× |
| Potencia | 600 W | 350 W | 1.71× |

El «2×» es exacto en memoria. En velocidad depende de qué parte del trabajo domina: el decode sigue al [[ancho-de-banda|ancho de banda]] (1.85×), pero el prefill sigue al cómputo (≈ 1.38×). Y en el despacho el TTFT lo decide el prefill de 6,000 tokens: por eso la herramienta de sizing le da a la Server Edition un prefill de ≈ 1.7 s, no la mitad de los 2.38 s. Además, el blog pudo comparar otro modelo, otra cuantización (FP8 en una, FP16 en la otra) u otra potencia. Un «2×» sin condiciones es una pregunta para el piloto: ¿2× en qué reloj, con qué carga?
:::

## Un benchmark honesto: las condiciones que debe declarar {An honest benchmark: the conditions it must declare}

Un [[benchmark]] publicado es la medición de alguien más. Un [[benchmark-honesto|benchmark honesto]] es uno que dice **todo lo que necesitas para repetirlo** y, por lo tanto, para saber si se parece a tu caso. Las [[condiciones-del-benchmark|condiciones del benchmark]] son esa lista. [Concurrencia](/concurrencia/) ya dio cinco preguntas para leer una tabla; esta es la lista completa, en el orden en que cambian el resultado.

:::pasos
1. El hardware
Qué GPU, cuántas, conectadas cómo (PCIe o NVLink) y a qué potencia. Una RTX PRO 6000 puede venir en variantes de menos potencia, y comparar 350 W contra 600 W ya es comparar 1.71× de energía.
2. El modelo exacto
Nombre, tamaño y revisión. Un 8B no es un 32B; un MoE con 3 mil millones activos no es un denso de 32.
3. La cuantización
De los pesos (FP16, FP8, INT4 de AWQ…) y del KV cache ([[cuantizar-kv-cache|cuantizarlo]] cambia cuántas conversaciones caben). FP8 contra FP16 en la misma GPU es casi otra máquina.
4. El motor, su versión y sus flags
vLLM 0.34.0 no es vLLM de hace un año; `--max-num-seqs`, el tamaño de los trozos de prefill y el tope de contexto cambian la curva.
5. Los largos de entrada y de salida
Media y variación. «1,024/1,024» no es «6,000/500».
6. La carga
Tasa de llegada (abierta) o concurrencia (cerrada), cuánta y de dónde sale. Si es cerrada, cuántas a la vez.
7. Las métricas, con su percentil y su definición
TTFT, TPOT o ITL según **qué** herramienta, en qué percentil y con cuántas peticiones detrás.
8. El prefix caching
¿Prendido? ¿Con prompts repetidos? ¿Con qué tasa de aciertos?
9. Qué tokens cuenta
De salida o totales.
10. Quién midió, quién pagó y cómo repetirlo
El fabricante, un integrador, un blog, un benchmark auditado. Con repositorio, semilla y comando, o sin nada.
:::

### Las trampas que se ven seguido

- **Throughput con un TTFT imposible**: el número grande está pasado el codo (en la curva de NVIDIA de [Concurrencia](/concurrencia/), 1,619 tokens/s con TTFT de 64 s). Pide el throughput **a tu SLO**: el goodput.
- **Entradas cortas o prompts repetidos**: los dos vuelven el prefill casi gratis.
- **Salidas que no se forzaron**: la guía de NVIDIA recomienda forzar el largo de salida para comparar.
- **Comparar sin igualar**: FP8 contra FP16, 8B contra 32B, TTFT promedio contra p95, potencias distintas.
- **Pocas peticiones**: GuideLLM lo dice: con menos de 100, el p99 reportado es la petición más lenta de la corrida.

### De gráfica a pregunta

Lo útil de la lista es que convierte cada hueco en una pregunta concreta para el piloto. Con la gráfica del proveedor:

| Lo que dice la gráfica | Lo que no dice | Lo que mide el piloto |
|---|---|---|
| «3,000 tokens/s» | ¿De salida o totales? | Los dos, con el dataset del despacho |
| «Qwen3 32B» | ¿Qué cuantización, qué versión? | El AWQ que se va a servir, en vLLM 0.34.0 |
| (nada sobre el largo) | ¿Entradas de cuánto? | ≈ 6,000 de entrada y ≈ 500 de salida, con variación |
| (nada sobre la carga) | ¿Cuántas a la vez? ¿Con qué TTFT? | Tasa abierta de 0.21/s y 8 a la vez; TTFT y TPOT en p50, p95 y p99 |
| (nada sobre el cache) | ¿Prompts repetidos? | Prefijo de 400 compartido, lo demás distinto; aciertos medidos en `/metrics` |
| «Hasta» | ¿Medido por quién? | Por el despacho, con el comando guardado y la semilla |

Seis renglones, seis números que la gráfica no puede dar y la prueba sí. Y una regla de cortesía con el proveedor: pedirle el comando y el dataset de su gráfica. Si los manda, se puede repetir en la GPU rentada; si no, la gráfica se queda como publicidad.

## MLPerf e InferenceX: los benchmarks públicos {MLPerf and InferenceX: the public benchmarks} [extra]

### MLPerf Inference

[[mlperf|MLPerf Inference]] es el benchmark de la industria para inferencia, organizado por MLCommons (un consorcio de empresas y universidades). A noviembre de 2026 la versión vigente es la **v6.1**, publicada el 16 de septiembre de 2026, con 30 organizaciones participantes según el anuncio y dos pruebas nuevas: un RAG de punta a punta en centro de datos e inferencia de agentes en dispositivos (*edge*). Lo que lo hace distinto de una gráfica de proveedor son sus **reglas**: todos corren la misma carga, con la misma calidad mínima, con sus resultados revisados por los demás participantes.

Sus escenarios dicen **cómo** llegan las consultas:

| Escenario | Cómo llegan | Lo que reporta |
|---|---|---|
| Single stream | Una, y la siguiente al terminar | Latencia p90 |
| Multistream | Un grupo, y el siguiente al terminar | Latencia p99 |
| **Server** | Llegadas de **Poisson** | La mayor tasa de Poisson a la que se cumple la restricción de latencia en el **p99** |
| **Offline** | Todas juntas al inicio (≥ 24,576 muestras) | Throughput, sin restricción de latencia |

«Interactive» es Server con límites más estrictos. Server es una carga **abierta** y su métrica es, de hecho, un goodput: el máximo **cumpliendo**. Y exige calidad (por ejemplo, el 99 % de la exactitud de referencia): no se vale ganar velocidad cuantizando hasta que conteste mal.

Las cargas de LLM vigentes y su restricción en Server, de las reglas consultadas en noviembre de 2026:

| Modelo | Tarea | Server: TTFT / TPOT | Interactive: TTFT / TPOT |
|---|---|---|---|
| Llama 3.1 8B | Resumir noticias | 2,000 ms / 100 ms | 500 ms / 30 ms |
| Llama 2 70B | Preguntas (entradas ≤ 1,024) | 2,000 ms / 200 ms | 450 ms / 40 ms |
| Llama 3.1 405B | Generación larga | 6,000 ms / 175 ms | 4,500 ms / 80 ms |
| Mixtral 8x7B | Varias | 2,000 ms / 200 ms | — |
| DeepSeek-R1 | Razonamiento | 2,000 ms / 80 ms | 1,500 ms / 15 ms |
| GPT-OSS-120B | Matemáticas, ciencia, código | 3,000 ms / 80 ms | 2,000 ms / 20 ms |

Compáralo con el despacho: **ninguna** carga es un 32B, ninguna manda 6,000 tokens de entrada con 500 de salida, y la de Llama 2 70B en Server tolera 200 ms entre tokens, que son **5 tokens/s** por persona, contra los 20 del despacho. «Cumple MLPerf Server» no quiere decir «cumple la promesa del despacho». MLPerf responde «¿qué tan bien corre esta carga estándar en este hardware, de forma comparable y auditada?». Sirve para comparar fabricantes con reglas parejas, no para firmar un piloto.

:::nota Cuántas consultas pide MLPerf
Sus reglas traen una tabla orientativa del mínimo de consultas para que un percentil sea estable: 23,886 para un p90 al 99 % de confianza con ± 0.5 puntos, y 50,425 para un p95 con ± 0.25 puntos. Salen de la misma fórmula de campana de la sección de cuántas peticiones, con \(z\) = 2.576 en vez de 1.96 y márgenes mucho más finos. Además permite detenerse antes con una regla estadística (*early stopping*), a cambio de reportar un percentil algo más alto.
:::

### InferenceX (antes InferenceMAX)

InferenceX, de la firma de análisis SemiAnalysis, es una plataforma abierta (Apache-2.0) que corre benchmarks **continuos**: los repite con cada versión nueva de los motores (SGLang, vLLM, TensorRT-LLM) en aceleradores de varios fabricantes, y los publica en un panel. Antes se llamaba InferenceMAX (la v1 salió en octubre de 2025). A noviembre de 2026 su hardware oficial incluye la RTX PRO 6000 Server Edition (desde septiembre de 2026), pero **no** la L40S, y sus modelos son de cientos de miles de millones de parámetros o más.

Mide con barridos de **concurrencia** (cerrada) y entradas y salidas de 1,024/1,024 y 8,192/1,024 tokens; su meta declarada es comparar **aceleradores**, no motores. Para el despacho es contexto, no respuesta.

## El plan del despacho {The despacho's plan}

Todo junto, el plan de la prueba de carga del piloto. Es una propuesta: los números salen de la ficha del despacho y de esta lección.

**Dónde.** En la GPU rentada del piloto (semanas 2 a 7), con la misma versión del motor que se va a instalar (vLLM 0.34.0), el mismo modelo (Qwen3 32B AWQ) y los mismos flags (`--max-num-seqs 8`, contexto de 8,192, razonamiento apagado). **Contra el gateway** (LiteLLM), con una clave de pruebas de cuota propia. El generador en **otra máquina** de la misma nube, con el tokenizador local.

**Con qué.** Un dataset de **≥ 1,000 prompts sintéticos** de ≈ 6,000 tokens (± 30 %): las mismas instrucciones de ≈ 400 tokens al inicio de todos, una pregunta de ≈ 100 y cinco fragmentos distintos de ≈ 1,000 escritos para la prueba, nunca de expedientes reales; tope de salida de 500. Se revisa en `/metrics` que los aciertos del prefix cache se parezcan al ≈ 6.7 % esperado.

:::pasos
1. Calentamiento
20 peticiones que no se cuentan, después de cada reinicio.
2. La promesa: abierta a 0.21/s
1,000 peticiones de Poisson a la tasa de la hora pico (≈ 79 min), sin tope en el cliente. Tres repeticiones con el servidor reiniciado. Es la prueba que decide.
3. La rampa: hasta 2× el pico
Escalones abiertos de 0.10, 0.21, 0.31 y 0.42/s (o una rampa continua de 30 min en GuideLLM o AIPerf para ubicar el codo rápido). Dice cuánto margen hay.
4. El techo: cerrada de 8
8 conversaciones a la vez sin pausa: la carga del criterio. Little dice que genera ≈ 0.30/s si todo va bien; si genera menos, el servidor se frenó. Reporta TPOT y tokens/s por persona a 8 a la vez.
5. Resistencia
La tasa pico durante una jornada (8 a 10 h); el p95 por hora no debe empeorar. Se repite con el servidor comprado, en el cuarto del despacho.
6. Reparto del gateway, si se prueba
La misma abierta a 0.21/s con el reparto al azar y con el de menos peticiones abiertas, para medir lo que la simulación predijo.
:::

**El criterio, con sus números.** Pasa si: en la prueba 2, **TTFT p95 ≤ 2 s**; en la prueba 4, con 8 a la vez, **TPOT p95 ≤ 50 ms** (≥ 20 tokens/s por persona); en las dos, **errores ≈ 0** (ningún 5xx ni 429) y la tasa que salió es la pedida. Ojo con la 4: la ficha calcula ≈ 2 conversaciones por L40S a ≥ 20 tokens/s, así que 3 L40S dan 6 lugares y las 8 de diseño piden 4; la prueba dirá si la cuenta era pesimista u optimista. Cada percentil se reporta con su intervalo y sus peticiones detrás. La calidad (el examen de 200 preguntas) es aparte: una prueba de carga mide segundos, no si la cita es correcta.

**Qué número cambia en la ficha.** Hoy la ficha tiene un TTFT p95 con cola **simulado**: ≈ 4.2 s en 3 L40S repartiendo al azar (≈ 3.3 s con menos peticiones abiertas; 2.38 s el prefill solo) y ≈ 3.1 / 2.7 / 1.77 s en 2 Server Edition. La prueba 2 lo reemplaza por el p95 **medido**, con su banda y su fecha. Si pasa de 2 s, como predicen las cuentas para la L40S, las palancas ya están escritas en la ficha: una cuarta L40S, tensor parallel en pares, o la Server Edition.

### L40S contra Server Edition, en las mismas condiciones

La comparación que decide la compra se hace con **las mismas condiciones** en las dos: el mismo dataset con la misma semilla, la misma tasa, la misma versión de vLLM, el mismo modelo y el mismo gateway. Lo que **no** se iguala a ciegas son los flags del motor: cada GPU se ajusta a lo que le cabe (`--max-num-seqs`, el tamaño de los trozos de prefill), porque igualar un flag pensado para 48 GB castiga a la de 96. Se reporta por GPU:

- TTFT p95 y TPOT p95 a 0.21/s, con su intervalo.
- **Goodput**: las peticiones por segundo que cumplen las dos promesas (`--goodput ttft:2000 tpot:50`), no los tokens/s máximos.
- Potencia promedio (W) durante la prueba.
- Y, con la cotización, cuánto cuesta cada petición que cumple. Ese número, y no el «2×», es el que va a la propuesta (la lección «Cotizar, proponer y dar soporte» de la siguiente fase).

## Errores comunes {Common mistakes}

1. **Probar directo contra una copia de vLLM.** Mide una GPU sin el gateway, sin la cuota y sin el reparto entre copias. **Cómo evitarlo:** el generador le pega al gateway, con una clave de pruebas de cuota propia, como le pegaría Open WebUI.
2. **Un dataset con el mismo prompt repetido, o con prompts cortos.** El [[prefix-caching|prefix caching]] vuelve casi gratis el prefill y el TTFT sale de fantasía; con 200 tokens de entrada, el prefill ni existe. **Cómo evitarlo:** prompts del largo real, con variación; solo el prefijo que de verdad se comparte (las instrucciones), y los aciertos revisados en `/metrics`. Reinicia o vacía el cache entre corridas.
3. **Creer que una prueba con tope de concurrencia es abierta.** Con `--max-concurrency` y una tasa que el servidor no alcanza, la tasa real baja y la espera queda en el cliente, fuera del reporte: [[omision-coordinada|omisión coordinada]]. **Cómo evitarlo:** la prueba de la promesa va sin tope; en cualquier corrida, compara la tasa pedida con la que salió y pide `client_queue_time` o el retraso de envío.
4. **Firmar un p95 de 100 peticiones.** Su banda va del p90 al máximo, y otra corrida puede dar 1.5 s distinto. **Cómo evitarlo:** ≥ 1,000 peticiones por punto, tres repeticiones del punto que decide y el [[intervalo-del-percentil|intervalo]] junto a cada percentil.
5. **Quedarse con lo que la herramienta imprime por omisión.** `vllm bench serve` solo da el p99, no imprime la latencia total y corta un dataset propio a 256 tokens de salida. **Cómo evitarlo:** `--metric-percentiles 50,95,99`, `--percentile-metrics ttft,tpot,itl,e2el` y `--custom-output-len` con el largo real; y lee cómo llama cada herramienta a TPOT e ITL.
6. **Leer tokens/s del servidor como velocidad de cada persona, o totales como de salida.** «3,000» con 200 a la vez son 15 por persona; como tokens totales con preguntas del despacho, 0.46 preguntas/s. **Cómo evitarlo:** divide entre los que están adentro, pregunta qué tokens cuenta y pide el goodput a tu SLO.
7. **El generador en el mismo servidor, o una prueba de una hora para todo.** El generador le roba CPU al gateway; una hora no muestra memoria que crece ni GPUs que se calientan. **Cómo evitarlo:** generador en otra máquina, retraso de envío ≈ 0 y una [[prueba-de-resistencia|prueba de resistencia]] de una jornada.

## En la vida real {In real life} [extra]

**El despacho.** En la GPU rentada del piloto, contra el gateway, con un dataset sintético de ≥ 1,000 prompts de ≈ 6,000 tokens que comparten solo las instrucciones de ≈ 400: calentamiento de 20, abierta de Poisson a 0.21/s (1,000 peticiones, ≈ 79 min, tres veces), rampa hasta 0.42/s, una cerrada de 8 conversaciones para el techo y una jornada de resistencia. Pasa con TTFT p95 ≤ 2 s, TPOT p95 ≤ 50 ms y errores ≈ 0. Las cuentas dicen que la L40S no pasa el TTFT (prefill de 2.38 s sin fila); la prueba lo confirma o lo desmiente con fecha, y compara la Server Edition en las mismas condiciones, por goodput y costo por petición que cumple.

**Una startup que elige motor.** Supuesto del ejemplo: una empresa con un asistente propio duda entre vLLM y SGLang en su mismo servidor. Un blog dice que uno es 30 % más rápido, con otro modelo y entradas de 1,024. Lo honesto es medir con **su** tráfico: graba un día de peticiones reales (sin el texto de sus clientes, solo los largos y las horas de llegada) y lo reproduce en los dos motores (vLLM trae un dataset de trazas con horario y GuideLLM un perfil `replay`), con la misma tasa abierta, el mismo hardware, versiones fijas y el motor reiniciado entre corridas. Compara goodput y p95, no el máximo. InferenceX no le sirve para esto: su meta, por diseño, es comparar aceleradores, no motores.

**Una financiera con un lote nocturno.** Supuesto del ejemplo: cada noche clasifica 40,000 documentos de ≈ 3,000 tokens de entrada y ≈ 300 de salida. Nadie espera el primer token: lo que importa es que el lote termine antes de las 7:00. Es el escenario **Offline** de MLPerf: todo junto al inicio, sin restricción de latencia, y la métrica es el throughput. En `vllm bench serve` se parece a la tasa infinita (el valor por omisión) con un tope de concurrencia; aquí el tope no engaña a nadie, porque no hay calendario que respetar. Si la prueba mide 1,800 tokens/s de salida, el lote tarda 40,000 × 300 ÷ 1,800 ≈ 6,667 s ≈ 1.9 h.

**Fuera de las computadoras: la prueba de manejo.** Un coche que «da 20 km por litro» lo midió el fabricante en un ciclo de laboratorio, con su velocidad, su temperatura y sin aire acondicionado. En el Periférico a las 8:00 da otra cosa. Nadie dice que el fabricante mintió; dice que el ciclo no es tu ruta. Dónde se rompe: tu ruta cambia todos los días y no la puedes repetir; una prueba de carga sí se repite igual, con la misma semilla, tantas veces como quieras.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una prueba del despacho mide 400 peticiones (sin el calentamiento). ¿Qué lugar de la lista ordenada es el p95, cuántas quedan arriba y cuánto dura la prueba a 0.21/s?
\(r = ⌈q × n⌉\) = ⌈0.95 × 400⌉ = **380.ª**. Arriba, \(k = n × (1 − q)\) = 400 × 0.05 = **20**. Duración \(D = n ÷ λ\) = 400 ÷ 0.21 ≈ 1,905 s ≈ **32 min**. Con el método exacto, el p95 verdadero cae entre la 371.ª y la 389.ª (p92.75 a p97.25).
? [facil] Una prueba cerrada usa 6 usuarios virtuales y cada respuesta tarda 27 s. ¿Qué tasa genera y cómo se compara con la hora pico del despacho?
\(λ = N ÷ W\) = 6 ÷ 27 ≈ **0.222 /s**. Contra 0.208 /s de la hora pico, ≈ **1.07×**: apenas arriba. Si el servidor se frena a 40 s por respuesta, baja sola a 6 ÷ 40 = 0.15 /s.
? [facil] Un proveedor publica «2,400 tokens/s de salida con 96 conversaciones a la vez». ¿Cuánto recibe cada persona? ¿Pasa los 20 tokens/s? ¿Qué le falta a la cifra para saber si sirve al despacho?
\(v_p = T ÷ C\) = 2,400 ÷ 96 = **25 tokens/s**: pasa los 20. Le falta: el TTFT (y en qué percentil), los largos de entrada y salida, la cuantización y el motor con su versión, si hubo prompts repetidos y cuántas peticiones hay detrás. Con entradas cortas, los 25 por persona no dicen nada de 6,000 tokens.
? [medio] Alguien corre la rampa con `--request-rate 0.42 --max-concurrency 8` y cada respuesta tarda ≈ 27 s. ¿Qué tasa sale de verdad? ¿Por qué el TTFT del reporte se ve mejor que el de la hora pico, y cómo lo detectas?
Little: 8 ÷ 27 ≈ **0.296 /s**, no 0.42; el resto espera en el cliente. El TTFT se mide desde el envío, y con solo 8 adentro casi no hay fila de prefill: sale ≈ el prefill solo (2.4 s en la simulación, contra 4.3 s abierta a 0.21). Se detecta comparando la tasa pedida con la que salió y pidiendo `client_queue_time` y `e2el_including_client_queue`.
? [medio] Un blog publica «3,000 tokens/s totales» con 64 a la vez y preguntas de 2,000 tokens de entrada y 250 de salida. ¿Cuántas peticiones por segundo son, cuántos tokens de salida por segundo, y cuánto recibe cada persona?
Peticiones/s = 3,000 ÷ (2,000 + 250) = 3,000 ÷ 2,250 ≈ **1.33 /s**. Salida = 1.33 × 250 ≈ **333 tokens/s**. Por persona = 333 ÷ 64 ≈ **5.2 tokens/s**: muy lejos de los 20. Si alguien lo leyera como de salida, creería que cada persona recibe 3,000 ÷ 64 ≈ 46.9. La misma cifra, nueve veces de diferencia.
? [medio] Un dataset repite el mismo prompt de 6,000 tokens. Con [[prefix-caching|prefix caching]], ¿cuánto prefill calcula el servidor desde la segunda petición? ¿Y con el dataset realista? Si el prefill fuera proporcional a los tokens, ¿cuánto quedaría de los 2.38 s en el realista?
Repetido: **casi nada**, todo el inicio está en el cache. Realista: solo las ≈ 400 de instrucciones son acierto, calcula 5,600 de 6,000, el **93.3 %**: 2.38 × 5,600 ÷ 6,000 ≈ **2.22 s**. Sigue arriba de 2 s: el cache de las instrucciones no salva a la L40S.
? [medio] Con 500 peticiones, ¿entre qué percentiles cae el p95 verdadero? Si la prueba reporta un TTFT p95 de 1.9 s contra un criterio de 2 s, ¿lo firmarías?
Exacto: de la 465.ª a la 485.ª, **p93.0 a p97.0** (con la campana, ± 1.9 puntos); dura 500 ÷ 0.21 ≈ 40 min. Con 0.1 s de margen y una banda que en segundos es de varias décimas (± 0.25 s aun con 1,000), **no**: subiría a ≥ 1,000 peticiones con tres repeticiones.
? [reto] El despacho quiere reportar también el p99 del TTFT. ¿Cuántas peticiones mínimas hacen falta para tener intervalo? ¿Qué banda da con 1,000? ¿Cuántas harían falta para ± 0.25 puntos al 95 % y cuánto duraría a 0.21/s?
Mínimo: ⌈log(0.025) ÷ log(0.99)⌉ = **368** (la misma cifra de GuideLLM). Con 1,000, el método exacto da de la 983.ª a la 997.ª: **p98.3 a p99.7**. Para ± 0.25 puntos con la campana: \(n = 1.96^2 × 0.99 × 0.01 ÷ 0.0025^2\) ≈ **6,085** peticiones, que a 0.21/s son 6,085 ÷ 0.21 ≈ 28,976 s ≈ **8 h**: una jornada entera. Por eso el despacho promete en el p95 y vigila el p99 como alarma.
? [reto] Diseña la comparación L40S contra Server Edition: qué igualas, qué no y qué reportas. Con los p95 simulados de la ficha (L40S: 4.2 s al azar y 2.38 s viendo la fila; Server Edition: 3.1 s y 1.77 s), ¿qué más tendría que probar el piloto?
**Iguales**: dataset y semilla, tasa, modelo y cuantización, vLLM 0.34.0, gateway, generador aparte, servidor reiniciado entre corridas. **No a ciegas**: los flags que dependen de la memoria (`--max-num-seqs`, los trozos de prefill). **Reportar**: TTFT y TPOT p95 con intervalo, goodput, potencia y costo por petición que cumple. Con las simulaciones, ninguna pasa repartiendo al azar; solo la Server Edition viendo la fila baja de 2 s. Así que el piloto también prueba **el reparto del gateway**: una buena GPU con mal reparto puede reprobar.
:::

## Lo que sigue {What comes next} [extra]

- **[Demostrar que el modelo abierto sirve](/evals/)** es la otra mitad del piloto: una prueba de carga dice si el servidor contesta **a tiempo**; el examen de 200 preguntas, si contesta **bien**. Las dos usan la misma idea de muestra, ruido e intervalo.
- **[RAG privado: embeddings y vector DB locales](/rag-privado/)** y **[Agentes, tools y guardrails](/agentes/)** cambian el perfil de carga: la búsqueda agrega su tiempo antes del prefill, y un agente hace varias llamadas al modelo por pregunta. Cada cambio del perfil pide rehacer el dataset de carga.
- **«Observabilidad de GPUs e inferencia»**, en la siguiente fase, convierte las métricas de esta prueba en tableros que corren todo el día: los mismos relojes, medidos en producción, y la temperatura y la memoria que la prueba de resistencia vigila.
- **«TCO: API, nube o servidor propio»** y **«Cotizar, proponer y dar soporte»** usan el goodput medido y el costo por petición que cumple para decidir y escribir la propuesta.
- De esta app: [Concurrencia](/concurrencia/) tiene la curva y el codo; [De requisitos a hardware](/requisitos-hardware/), la simulación del TTFT con cola que esta prueba reemplaza; [Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/), la cuota y el reparto que la prueba atraviesa.
- En Sensei: [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/), [Qué tan rápido y cuánto: latencia y throughput](https://sensei.trueml.app/latencia/) y [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
prueba-de-carga carga-abierta carga-cerrada omision-coordinada latencia-programada calentamiento dataset-de-carga intervalo-del-percentil rampa prueba-de-resistencia benchmark-honesto condiciones-del-benchmark mlperf
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué la prueba del despacho va contra el gateway y no directo contra vLLM?
Porque el cronómetro va donde está la persona: el abogado pasa por el gateway (autenticación, cuota, reparto entre las tres copias). Directo a vLLM se mide una GPU, no el servidor.
? ¿Qué parte de los prompts del dataset de carga se repite y cuál no, y por qué importa?
Se repiten solo las ≈ 400 de instrucciones, como en producción; la pregunta y los fragmentos cambian. Con todo repetido, el prefix caching vuelve el prefill casi gratis y los números se inflan.
? ¿Qué es la omisión coordinada, en una frase?
Medir solo las peticiones que el generador alcanzó a mandar cuando él mismo se frenó porque el servidor iba lento: deja de medir justo los peores momentos.
? ¿Cuál es la diferencia entre una carga abierta y una cerrada, y cuál usas para la promesa?
La abierta sigue un calendario (una tasa) pase lo que pase; la cerrada mantiene N adentro y manda la siguiente al terminar. Para la promesa, abierta; para el techo, cerrada.
? ¿Entre qué percentiles cae el p95 verdadero con 200 peticiones, y con 1,000?
Con 200, del p92.0 al p98.5; con 1,000, del p93.6 al p96.4 (intervalo de 95 % por estadísticos de orden).
? «3,000 tokens/s»: nombra tres cosas que la cifra no dice.
A cuántos atendía a la vez, con qué TTFT, si son tokens de salida o totales, con qué largos de entrada y salida, con qué cuantización y motor, y si hubo prompts repetidos (cualesquiera tres).
? ¿Qué mide el escenario Server de MLPerf, y por qué no basta para el despacho?
La mayor tasa de llegadas de Poisson a la que se cumplen el TTFT y el TPOT en el p99. No basta porque sus cargas son otros modelos y otros largos, y sus límites (por ejemplo 200 ms entre tokens en Llama 2 70B) son mucho más laxos que los 20 tokens/s del despacho.
:::
