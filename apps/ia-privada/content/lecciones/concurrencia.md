---
titulo: Concurrencia: la curva de usuarios contra latencia
en: Concurrency: the users-versus-latency curve
subtitulo: Por qué una GPU produce más tokens en total cuando atiende a más gente a la vez y, al mismo tiempo, cada persona recibe menos; cómo leer la curva que lo muestra, cómo estimarla para tu GPU con una cuenta de servilleta y dónde se rompe la promesa que le hiciste al cliente.
pregunta: Si la memoria dice que en mi GPU caben 8 conversaciones a la vez, ¿quiere decir que puedo atender bien a 8 personas al mismo tiempo?
sensei: latencia, percentiles, llms
---

:::idea
Cuando una GPU atiende a más personas a la vez, produce más tokens en total, pero cada persona recibe menos y espera más su primer token. La memoria dice cuántas conversaciones **caben**; el [[ancho-de-banda|ancho de banda]], el cómputo y la fila dicen cuántas se **atienden bien**. El trabajo es encontrar el punto donde se rompe tu promesa, antes de comprar.
:::

En esta lección seguimos a **el despacho**, un ejemplo ficticio: un despacho de abogados de la Ciudad de México con 200 personas que hacen 15 preguntas al día cada una sobre sus expedientes, sin que un documento salga de su red. Cada pregunta lleva ≈ 6,000 tokens de entrada (instrucciones, la pregunta y 5 fragmentos de expediente) y su respuesta ≈ 500 de salida. El despacho promete dos cosas: el primer token en ≤ 2 s en el p95 (95 de cada 100 preguntas lo reciben en 2 s o menos) y al menos 20 tokens por segundo para cada persona. El candidato es Qwen3 32B en [[cuantizacion|INT4 de AWQ]] (pesos guardados en 4 bits) en una NVIDIA L40S de 48 GB, donde, por memoria, caben 8 [[concurrencia|conversaciones a la vez]].

Esa última frase es la trampa de esta lección. Al final vas a ver por qué una sola L40S no alcanza, aunque las 8 conversaciones quepan de sobra.

Das por leídas tres lecciones de Sensei. De [Qué tan rápido y cuánto: latencia y throughput](https://sensei.trueml.app/latencia/) necesitas cuatro ideas: la latencia es viajar, esperar y trabajar; la espera explota cuando un servidor se acerca al 100 % de ocupación; la [[ley-de-little|ley de Little]] dice cuántas peticiones hay adentro a la vez, y una prueba de carga sube el tráfico hasta encontrar el codo, donde el throughput se aplana y la latencia se dispara. De [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/), que una promesa se escribe en un percentil alto. Y de [Transformers y LLMs](https://sensei.trueml.app/llms/), que una respuesta tiene dos fases: el **[[prefill|prefill]]**, que lee todo el prompt de una pasada, y el **[[decode|decode]]**, que escribe un token por paso; y que cada fase tiene su reloj, el [[ttft|TTFT]] y el TPOT. Aquí vamos a lo que es propio de servir LLMs a mucha gente, con números de una GPU real.

## Más gente, más tokens, menos para cada quien {More people, more tokens, less for each}

Imagina un camión de pasajeros que hace la misma ruta sin parar. Si va con una persona, el viaje cuesta lo mismo que si va con veinte: el diésel, el chofer y el recorrido son los mismos. Subir gente casi no cuesta. Pero cada parada para subir a alguien alarga el viaje de todos, y cuando el camión se llena, el que sigue se queda en la banqueta.

Una GPU que escribe tokens se parece mucho. En cada paso de [[decode|decode]] tiene que leer de su memoria **todos** los [[pesos]] del modelo para escribir un token. Si en ese paso van 8 conversaciones, lee los pesos una sola vez y escribe 8 tokens, uno para cada una. Ese grupo de conversaciones que avanzan juntas en cada paso se llama **[[batch|lote]]** (*batch*). Juntar conversaciones en un lote casi no cuesta. Por eso un servidor de LLMs siempre atiende varias a la vez, y por eso, al subir la gente:

- **Sube el total.** La GPU escribe más tokens por segundo, sumando a todos.
- **Baja lo de cada quien.** Cada paso tarda un poco más, porque además de los pesos tiene que leer lo que recuerda cada conversación, su [[kv-cache|KV cache]]. Cada persona ve su texto salir un poco más lento.
- **Crece la espera.** Las preguntas nuevas tienen que leer su prompt antes de empezar, y esa lectura compite con las demás.

La pregunta de diseño no es «¿cuántas caben?», sino «¿hasta cuántas puedo subir antes de romper lo que prometí?». Para contestarla necesitas tres cosas: saber qué siente cada persona (sus dos relojes), qué mide el servidor (su throughput) y cómo se ve la curva que los une.

:::analogia El camión de la ruta
El camión es la GPU; cada pasajero, una conversación. El recorrido fijo es leer los pesos: cuesta lo mismo con uno o con veinte. El equipaje de cada pasajero es su KV cache: ocupa lugar en el pasillo y hace que cada vuelta pese un poco más. Subir a alguien es su [[prefill|prefill]]: el camión se detiene mientras sube.

**Dónde se rompe:** un camión lleno sigue andando a la misma velocidad; una GPU con más conversaciones va más lento en cada paso, porque el equipaje se lee en cada vuelta. Y en el camión el que sube no detiene a nadie más de unos segundos; en una GPU, subir a una pregunta de 6,000 tokens puede detener a todos los demás más de dos segundos.
:::

## Lo que siente la persona y lo que mide el servidor {What the person feels and what the server measures}

La persona y el dueño del servidor miran números distintos. La persona siente dos relojes: cuánto tarda en empezar la respuesta y qué tan rápido sale el texto. El dueño mira un contador: cuánto trabajo sale en total. Esta sección define los dos lados con las definiciones exactas que usan las herramientas de medición, porque dos herramientas pueden llamar igual a cosas distintas.

### Los relojes de la persona: TTFT, TPOT, ITL y E2E

**[[ttft|TTFT]]** (*time to first token*, tiempo al primer token): desde que la persona manda la pregunta hasta que recibe el primer token. La respuesta llega en *streaming*: el texto va apareciendo token por token, sin esperar a que esté completo. Según la documentación de NVIDIA, el TTFT en general incluye la espera en la fila, el [[prefill|prefill]] y la red. Es lo que la persona siente como «¿me hizo caso?».

El [[tpot|TPOT]] (*time per output token*, tiempo por token de salida) es el tiempo promedio entre tokens de **una** respuesta, sin contar el primero. La herramienta de benchmark de vLLM, uno de los servidores de LLMs más usados (`vllm bench serve`), lo calcula una vez por petición, así:

:::formula El TPOT de una respuesta
TPOT = frac{E2E − TTFT}{n − 1}
- E2E: la latencia de punta a punta, de mandar la pregunta a recibir el último token, en s
- TTFT: el tiempo al primer token, en s
- n: los tokens de salida de la respuesta; el − 1 es porque el primer token ya está en el TTFT
- TPOT: el tiempo promedio por token después del primero, en s; su inverso, 1 ÷ TPOT, son los tokens por segundo que recibe esa persona
:::

El [[itl|ITL]] (*inter-token latency*, latencia entre tokens) parece lo mismo y no siempre lo es. En vLLM, el ITL es cada intervalo suelto entre dos tokens; sus estadísticas juntan todos los intervalos de todas las respuestas. Así se ven los tirones: si en medio de tu respuesta entra el prefill de otra pregunta, un intervalo puede durar 400 ms en vez de 50, y en una respuesta de 500 tokens el promedio casi no lo nota: sube de 50 a ≈ 50.7 ms. En la documentación de NVIDIA NIM (el servidor empaquetado de NVIDIA), en cambio, ITL «también se llama TPOT»: es el promedio sin el primer token. Lee siempre cómo define cada número la herramienta que lo imprime.

:::ejemplo Cuatro intervalos, dos números
Una respuesta corta llega con intervalos de 50, 50, 400 y 50 ms. Su TPOT es (50 + 50 + 400 + 50) ÷ 4 = 137.5 ms. Su ITL mediano es 50 ms y su peor ITL, 400. Si solo miras el TPOT, crees que todo va parejo y lento; si miras los ITL, ves que va rápido con un tirón. Son problemas distintos con arreglos distintos.
:::

Despeja la E2E de la fórmula del TPOT y tienes cuánto dura una respuesta entera:

:::formula La duración de una respuesta
E2E = TTFT + TPOT × (n − 1)
- E2E: la latencia de punta a punta, en s
- TTFT: el tiempo al primer token, en s
- TPOT: el tiempo por token después del primero, en s
- n: los tokens de salida
:::

:::cuenta Una respuesta del despacho, con la GPU libre
Prefill // leer los 6,000 tokens; la cuenta está en la sección del TTFT bajo carga | supuesto: nadie más en la fila | ≈ 2.17 s
TTFT // sin espera: solo el prefill (la red de la oficina es despreciable) | 0 + 2.17 | ≈ 2.2 s
TPOT // la promesa: 20 tokens por segundo | 1 ÷ 20 | 0.05 s = 50 ms
Tokens después del primero, \(n − 1\) // respuesta de ≈ 500 tokens | 500 − 1 | 499
E2E | \(TTFT + TPOT × (n − 1)\) = 2.17 + 0.05 × 499 | **≈ 27.1 s**
= La ficha del despacho dice ≈ 27 s por respuesta (2 s de TTFT más 25 s escribiendo). Fíjate en el TTFT: con la GPU libre, **solo el prefill ya pasa los 2 s prometidos**. Es el hilo de toda la lección.
:::

:::figura concurrencia-linea
Una respuesta del despacho en una L40S sin nadie más. Arriba, completa: 2.2 s de prefill y 499 tokens a 50 ms. Abajo, los primeros 3 segundos: el prefill cruza la promesa de 2 s antes de que salga el primer token.
:::

¿Cuál de los dos relojes importa más? Depende de la tarea. En un chat, la persona empieza a leer en cuanto sale el primer token, así que el TTFT y el TPOT importan por separado y la E2E casi no. En una tarea que alguien espera completa (resumir un expediente para pegarlo en un escrito), importa la E2E. El despacho escribió sus promesas sobre TTFT y velocidad porque su uso principal es preguntar y leer.

:::diagrama concurrencia-relojes
Toca cada caja para ver qué tiempo se va ahí, o usa «Recorrer» para seguir una pregunta del despacho con el reloj en mano: dónde arranca, dónde se mide el TTFT, cada ITL y la E2E.
:::

### El contador del servidor: throughput y peticiones por segundo

La persona siente sus relojes. El dueño del servidor mira cuánto trabajo sale en total. Ese es el [[throughput-de-tokens|throughput de tokens]], y conviene decir siempre cuál de sus versiones:

- **De salida.** Los tokens escritos por segundo, sumando a todos. Es el que NVIDIA pone en sus tablas: tokens de salida ÷ el tiempo entre la primera petición y la última respuesta.
- **Total.** Entrada más salida. Con prompts largos, como los del despacho, infla el número: 6,000 tokens de entrada contra 500 de salida hacen que el total sea 13 veces el de salida, aunque el lector solo vea los 500.
- **Por persona.** Los tokens de salida de una respuesta ÷ su E2E. NVIDIA lo llama *TPS per user*.

Y hay otra medida, las **peticiones por segundo** (*requests per second*, RPS): cuántas respuestas completas termina el servidor por segundo.

:::formula Throughput y peticiones por segundo
X_{sal} = frac{tokens de salida de todas}{T}
RPS = frac{peticiones completadas}{T}
X_{per} = frac{n}{E2E}
- T: la duración de la prueba, de la primera petición a la última respuesta, en s
- X_{sal}: el throughput de salida, en tokens/s, sumando a todos
- RPS: las peticiones completadas por segundo
- n: los tokens de salida de una respuesta
- X_{per}: los tokens por segundo que recibió esa persona, contando su espera
:::

Estas medidas están amarradas entre sí por la **[[ley-de-little|ley de Little]]** (J. D. C. Little, 1961), que viste en Sensei: si en promedio hay \(L\) peticiones adentro del servidor, cada una dura \(W\) segundos y llegan \(λ\) por segundo, entonces \(L = λ × W\). Más adelante la usamos con el despacho. En una prueba con concurrencia fija se usa al revés: si mantienes 100 conversaciones adentro y cada una dura 34.8 s, el servidor termina \(λ = L ÷ W\) peticiones por segundo.

:::cuenta Comprobar una tabla de NVIDIA con la ley de Little
La prueba // L40S, Llama 3.1 8B en FP8, 1,000 tokens de entrada y 1,000 de salida, 100 conversaciones a la vez, \(L\) = 100 | tabla de NIM 1.8.0 | TTFT 0.778 s · ITL 34.1 ms
Duración de cada respuesta, \(W\) // \(E2E = TTFT + ITL × (n − 1)\) | 0.778 + 0.0341 × 999 | ≈ 34.84 s
Peticiones por segundo, \(λ\) // Little al revés, \(λ = L ÷ W\) | 100 ÷ 34.84 | ≈ 2.87 por segundo
Throughput de salida, \(X_{sal}\) // cada una escribe \(n\) = 1,000 tokens | 2.87 × 1,000 | **≈ 2,870 tokens/s**
= NVIDIA reporta 2,869.49. Cuadra: sus tres números (TTFT, ITL y throughput) son consistentes entre sí. Esta comprobación de 30 segundos te salva de tablas mal copiadas.
:::

El throughput por persona de esa misma prueba sale de \(X_{per} = n ÷ E2E\) = 1,000 ÷ 34.84 ≈ 28.7 tokens por segundo, y si no cuentas la espera, 1 ÷ 0.0341 ≈ 29.3. El total, 2,870, es 100 veces más. Ese es el trato: el servidor gana en total lo que cada quien pierde en velocidad. La pregunta es hasta dónde conviene.

## La curva publicada: lo que NVIDIA midió en una L40S {The published curve: what NVIDIA measured on an L40S}

NVIDIA publica las curvas de NIM, su servidor empaquetado, medidas con su herramienta AIPerf. Hay una con justo la GPU del despacho: **una L40S de 48 GB**, NIM 1.8.0, modelo Llama 3.1 8B Instruct, 1,000 tokens de entrada y 1,000 de salida por petición, en dos formatos de pesos: FP8 (1 byte por peso, ≈ 8 a 9 GB) y BF16 (2 bytes, ≈ 16 GB). La concurrencia es fija: la herramienta mantiene siempre ese número de peticiones adentro. La página no dice cuándo se publicó; la consultamos en noviembre de 2026.

| A la vez | FP8: [[ttft\|TTFT]] | FP8: ITL | FP8: total | FP8: por persona | BF16: TTFT | BF16: total |
|---|---|---|---|---|---|---|
| 1 | 45 ms | 13.97 ms | 71 tok/s | 71.6 tok/s | 81 ms | 45 tok/s |
| 5 | 173 ms | 14.91 ms | 332 | 67.1 | 153 ms | 211 |
| 25 | 618 ms | 18.59 ms | 1,302 | 53.8 | 270 ms | 799 |
| 50 | 705 ms | 23.59 ms | 2,060 | 42.4 | 313 ms | 1,226 |
| 100 | 778 ms | 34.10 ms | 2,869 | 29.3 | 2,752 ms | 1,613 |
| 150 | 770 ms | 44.38 ms | 3,325 | 22.5 | 33,138 ms | 1,617 |
| 200 | 894 ms | 55.33 ms | 3,560 | 18.1 | 63,646 ms | 1,619 |
| 250 | 5,047 ms | 62.70 ms | 3,676 | 15.9 | — | — |

«Por persona» es 1,000 ÷ ITL, sin contar la espera. Fuente: documentación de benchmarking de NVIDIA NIM, sección de Llama 3.1 8B Instruct.

:::figura concurrencia-curva
Los mismos puntos de NVIDIA, dibujados. Arriba, el total sube y se dobla; en BF16 se aplana desde 100 a la vez. Abajo, lo de cada persona baja; en FP8 cruza los 20 tokens por segundo entre 150 y 200 a la vez.
:::

Lee la tabla en tres tramos:

- **De 1 a 50: casi gratis.** El total se multiplica por 29 (71 → 2,060) y cada persona pierde 41 % (71.6 → 42.4). Cada conversación nueva suma muchos tokens y quita poco.
- **De 50 a 200: el trato empeora.** El total ya solo crece 1.7 veces y cada persona baja a menos de la mitad. Cada paso lee más KV cache, que ya pesa más que los pesos.
- **El codo.** En BF16, de 100 a 200 el total pasa de 1,613 a 1,619, casi nada, y el TTFT, de 2.8 s a 64 s. Ese punto donde subir la gente ya no da throughput y sí mucha espera es el [[codo]] de la curva, el mismo que viste en Sensei con las pruebas de carga. Lo más probable es que se acabó la memoria para el KV cache, y una cuenta lo apoya: con pesos de ≈ 16 GB en BF16 quedan ≈ 25 GB para KV, que alcanzan para ≈ 95 conversaciones de 2,000 tokens (suponiendo el KV en BF16, 128 KiB por token). Las que no caben esperan en la fila. En FP8, con pesos más chicos, el codo llega después: a 250 el TTFT salta a 5 s.

Ojo con lo que **no** dice la tabla. Es Llama 3.1 8B, no Qwen3 32B: un modelo 4 veces más chico, con KV cache de 128 KiB por token en vez de 256. Sus prompts son de 1,000 tokens, no de 6,000. Y la concurrencia está fija, no llega al azar. Sirve para ver la **forma** de la curva en esta GPU; para los números del despacho, hay que estimar.

:::nota Prompts largos
La misma página trae la L40S en FP8 con 5,000 tokens de entrada y 500 de salida, más parecido al despacho: el total llega a 889 tokens/s con 100 a la vez y el TTFT ya es de 9 s. Con 20,000 de entrada, a 25 a la vez el TTFT es de 27.5 s. Cuando el prompt crece, manda el [[prefill|prefill]].
:::

## Un modelo de juguete para tu GPU {A toy model for your GPU}

No siempre hay una curva publicada para tu modelo en tu GPU. Pero el resultado clave del [[decode|decode]] se puede convertir en una cuenta de servilleta.

El resultado (el porqué a fondo está en la lección «[Batching continuo y PagedAttention](/batching/)»): en un paso de decode la GPU gasta casi todo su tiempo **[[memory-bound|esperando a que lleguen bytes de su memoria]]**, no calculando. Para escribir un token de cada conversación tiene que leer los pesos una vez y el KV cache de cada conversación. Mientras lo que tarda leer sea mucho más que lo que tarda calcular, juntar conversaciones casi no cuesta; deja de ser gratis cuando el KV cache de todas pesa tanto como los pesos, cuando la GPU ya no espera a la memoria sino al cálculo, o cuando el KV cache ya no cabe. Con números del despacho: leer 19.32 GB de pesos a 864 GB/s tarda ≈ 22 ms, mientras que calcular un token para 8 conversaciones (2 operaciones por parámetro por conversación) tarda ≈ 1.4 ms a toda la potencia de la GPU. La memoria manda por mucho.

De ahí sale el juguete:

:::formula Un paso de decode, de juguete
t_{paso} = max(frac{W + N × T × m}{η_m × A}, frac{2 × P × N}{η_c × F})
v = frac{1}{t_{paso}}
X = N × v
- W: lo que pesan los pesos, en bytes
- N: las conversaciones a la vez
- T: los tokens que lleva en su KV cache cada conversación (prompt más lo ya escrito)
- m: el KV cache por token, en bytes
- A: el [[ancho-de-banda|ancho de banda]] de la memoria de la GPU, en bytes/s (cuántos bytes puede leer por segundo)
- η_m: la [[eficiencia|eficiencia]] de memoria, qué fracción de \(A\) se logra de verdad (0.7 = 70 %)
- P: los parámetros del modelo
- F: el [[pico-de-calculo|cómputo pico]] de la GPU, en operaciones por segundo (FLOPS)
- η_c: la eficiencia de cómputo, qué fracción de \(F\) se logra (0.5 = 50 %)
- t_{paso}: lo que tarda un paso, en s; es el TPOT de cada persona
- v: los tokens por segundo de cada persona
- X: los tokens por segundo totales
:::

Las dos eficiencias son supuestos, los mismos que usa la [herramienta de sizing](/herramientas/sizing/) de esta app: ninguna GPU lee a su ancho de banda de hoja de datos ni calcula a su pico. Una prueba de carga en tu hardware te da los reales.

:::cuenta El despacho en una L40S, sin contar los prefills
KV por token, \(m\) // Qwen3 32B: 64 bloques, 8 juegos de K y V de 128 números, 2 bytes | 2 × 64 × 8 × 128 × 2 | 262,144 bytes = 256 KiB
KV de las 8, \(N × T × m\) // 6,500 tokens al final de la respuesta, el momento más lento | 8 × 6,500 × 262,144 | ≈ 13.63 GB
Bytes por paso // más los pesos, \(W\) = 19.32 GB | 19.32 + 13.63 | ≈ 32.95 GB
Tiempo de leerlos // \(A\) = 864 GB/s, \(η_m\) = 0.7 | 32.95 ÷ (0.7 × 864) | ≈ 54.5 ms
Piso de cómputo // \(P\) = 32.76 mil millones, \(F\) = 362.05 TFLOPS en FP16, \(η_c\) = 0.5 | 2 × 32.76e9 × 8 ÷ (0.5 × 362.05e12) | ≈ 2.9 ms
Tokens por persona, \(v\) // manda la memoria | 1 ÷ 0.0545 | **≈ 18.4 tokens/s**
Total, \(X\) | 8 × 18.4 | ≈ 147 tokens/s
= Con las 8 que caben, cada persona ya recibe menos de los 20 prometidos, y eso **antes** de que la GPU gaste un solo segundo en leer prompts nuevos. Con una sola conversación serían ≈ 28.8.
:::

:::profundo ¿Qué tan bueno es el juguete?
Ponlo contra los puntos reales de NVIDIA. Para Llama 3.1 8B en FP8 usa pesos de 9.08 GB (las tablas de tokens en 16 bits, como en la herramienta de VRAM), KV cache de 128 KiB por token (suponiendo que NIM lo guarda en BF16: la página no lo dice) y 1,500 tokens promedio en el KV (1,000 de prompt más la mitad de los 1,000 de salida, en promedio a lo largo de la respuesta). Con \(η_m\) = 1, el juguete puro:

```python
# El modelo de juguete contra lo que midió NVIDIA (L40S, Llama 3.1 8B en FP8, 1000/1000)
A = 864e9                       # ancho de banda de la L40S, bytes/s
W = 9.08e9                      # pesos, bytes (las tablas de tokens en 16 bits)
m = 131072                      # KV por token, bytes (128 KiB, en BF16: supuesto)
tokens = 1500                   # tokens promedio en el KV de cada conversación
medido = {1: 13.97, 25: 18.59, 50: 23.59, 100: 34.1, 200: 55.33}   # ITL, ms

print(" N  juguete  medido  desvío  por persona  total")
for N, itl in medido.items():
    t = (W + N * tokens * m) / A * 1000          # ms por paso de decode
    print(f"{N:3d} {t:6.1f} ms {itl:6.2f} ms {(t - itl) / itl:+5.0%}"
          f" {1000 / t:8.1f} tok/s {N * 1000 / t:6.0f} tok/s")
```

```salida
 N  juguete  medido  desvío  por persona  total
  1   10.7 ms  13.97 ms  -23%     93.1 tok/s     93 tok/s
 25   16.2 ms  18.59 ms  -13%     61.7 tok/s   1543 tok/s
 50   21.9 ms  23.59 ms   -7%     45.7 tok/s   2284 tok/s
100   33.3 ms  34.10 ms   -2%     30.1 tok/s   3006 tok/s
200   56.0 ms  55.33 ms   +1%     17.9 tok/s   3570 tok/s
```

Con poca gente, el juguete es 23 % optimista; con mucha, casi le atina. ¿Por qué?

- **La parte fija.** Si ajustas una recta a las mediciones, el ITL ≈ 13.6 ms + 0.21 ms por conversación. El juguete dice 10.5 + 0.23. La pendiente casi cuadra: leer el KV cache de cada conversación cuesta lo que el juguete dice. Lo que falla es la parte fija: la GPU lee los pesos a ≈ 77 % de su ancho de banda y cada paso tiene su propio costo (lanzar el trabajo a la GPU, elegir el token, organizar el [[batch|lote]]). Eso es justo lo que \(η_m\) ≈ 0.7 quiere capturar; con 0.7, el juguete da 65 tokens/s con una conversación contra 71.6 medidos.
- **Lo que ignora.** El juguete no cuenta los prefills de las preguntas que entran (en esta prueba son cortos, de 1,000 tokens), ni el cálculo de la atención (que crece con la longitud de cada conversación), ni los tirones del servidor. Con prompts largos como los del despacho, el primero deja de ser pequeño: la siguiente sección lo mide.
- **Dónde sí se cae.** A 250 a la vez el juguete daría 67 ms contra 62.7 medidos: ahí ya no caben todas en el KV cache, así que no están todas en el lote. Algunas esperan en la fila (el [[ttft|TTFT]] de 5 s lo delata) y el lote real es más chico.
:::

:::calculadora concurrencia-curva
Arranca con el despacho en una sola L40S, ya con los prefills que explica la siguiente sección. Cada resultado trae su cuenta. Para jugar solo con el decode, pon \(λ\) = 0.
:::

## El TTFT bajo carga: los prefills compiten {TTFT under load: the prefills compete}

El [[decode|decode]] está limitado por la memoria. El [[prefill|prefill]], no. Cuando la GPU lee un prompt de 6,000 tokens, cada peso que trae de la memoria se usa para los 6,000 tokens a la vez, así que la memoria deja de ser el problema y manda el **cálculo**: cuántas operaciones por segundo puede hacer la GPU. Su pico es su cómputo en FLOPS (operaciones de punto flotante por segundo).

¿Cuántas operaciones son? Cada parámetro participa en una multiplicación y una suma por cada token: 2 operaciones por parámetro por token.

:::formula Lo que cuesta un prefill
C_{pre} = 2 × P × T_{ent}
t_{pre} = frac{C_{pre}}{η_c × F}
- P: los parámetros del modelo
- T_{ent}: los tokens de entrada de la pregunta
- C_{pre}: las operaciones del prefill (FLOPs)
- F: el [[pico-de-calculo|cómputo pico]] de la GPU, en FLOPS
- η_c: la [[eficiencia|eficiencia]] de cómputo, la fracción de \(F\) que se logra (0.5)
- t_{pre}: lo que tarda el prefill, en s; con la GPU libre, es el [[ttft|TTFT]]
:::

:::cuenta El prefill de una pregunta del despacho, en una L40S
Operaciones, \(C_{pre}\) // \(P\) = 32.76 mil millones, \(T_{ent}\) = 6,000 | 2 × 32.76e9 × 6,000 | ≈ 3.93 × 10¹⁴ FLOPs
Cómputo pico de la L40S, \(F\) // FP16 denso, de su hoja de datos | dato de NVIDIA | 362.05 TFLOPS
Al 100 %, como cota | 3.93e14 ÷ 362.05e12 | ≈ 1.09 s
Con \(η_c\) = 0.5 // el supuesto de esta app | 3.93e14 ÷ (0.5 × 362.05e12) | **≈ 2.17 s**
= Una pregunta sola, con la GPU libre, tarda ≈ 2.2 s en dar su primer token. La promesa era ≤ 2 s en el p95. **No se cumple ni sin fila.** La [herramienta de sizing](/herramientas/sizing/), que cuenta más cosas, da 2.38 s.
:::

¿Por qué 2 FLOPs por parámetro? Los pesos en INT4 de AWQ se guardan en 4 bits, pero para multiplicar se convierten de vuelta a 16 bits: las cuentas se hacen en FP16, así que cuenta el cómputo de FP16 de la GPU. La atención agrega algo más que crece con el cuadrado de la longitud; con 6,000 tokens es del orden de 10 % extra, y la cuenta de arriba no la incluye.

¿El 0.5 es pesimista? Las tablas de NVIDIA dejan ver algo: con 1 conversación y 1,000 tokens de entrada, Llama 3.1 8B en BF16 da su primer token en 80.75 ms. Son 2 × 8.03 mil millones × 1,000 ≈ 1.6 × 10¹³ operaciones en 0.081 s: ≈ 199 TFLOPS, el 55 % de los 362 de la L40S, y eso incluyendo la red. El 0.5 está en el rango de lo que se mide.

### Cuando llegan varias a la vez

Ahora la hora pico. Llegan ≈ 0.21 preguntas por segundo, al azar, y cada una ocupa la GPU 2.17 s leyendo su prompt. Eso es 0.21 × 2.17 ≈ 45 % del tiempo de la GPU solo en prefills. Si una pregunta llega mientras otra está en su prefill, espera. Y, como viste en Sensei, con llegadas al azar la espera crece rápido mucho antes del 100 %.

Este código simula 200,000 preguntas que llegan al azar, cada GPU con su propia fila de prefills, y mide el p95 del TTFT:

```python
# El TTFT en la hora pico: las prefills hacen fila en cada GPU
import random
random.seed(7)
lam = 750 / 3600                                 # preguntas por segundo en la hora pico
P, F, eta_c = 32.76e9, 362.05e12, 0.5            # parámetros, FLOPS FP16 de la L40S, eficiencia

def ttft(tokens, gpus, n=200_000):
    s = 2 * P * tokens / (eta_c * F)             # segundos de prefill de una pregunta
    t = libre = 0.0
    ttfts = []
    for _ in range(n):
        t += random.expovariate(lam / gpus)      # cada GPU recibe su parte de las preguntas
        empieza = max(t, libre)                  # espera si otra prefill ocupa esa GPU
        libre = empieza + s
        ttfts.append(libre - t)
    ttfts.sort()
    return s, ttfts[int(n * 0.95)]

for tokens, gpus in ((6000, 1), (6000, 3), (4000, 3), (3000, 3)):
    s, p95 = ttft(tokens, gpus)
    print(f"{tokens:,} tokens, {gpus} L40S: prefill {s:.2f} s · TTFT p95 {p95:.2f} s")
```

```salida
6,000 tokens, 1 L40S: prefill 2.17 s · TTFT p95 6.03 s
6,000 tokens, 3 L40S: prefill 2.17 s · TTFT p95 3.78 s
4,000 tokens, 3 L40S: prefill 1.45 s · TTFT p95 2.22 s
3,000 tokens, 3 L40S: prefill 1.09 s · TTFT p95 1.47 s
```

Es una simulación simple: una fila por GPU en orden de llegada, sin contar que el decode de las demás también ocupa tiempo, ni que el servidor puede [[chunked-prefill|partir un prefill en trozos]] para que los demás no se detengan (lo ves en «[Batching continuo y PagedAttention](/batching/)»). Partirlo reparte el tirón, pero no reduce el trabajo: las ≈ 3.93 × 10¹⁴ operaciones se hacen igual.

Lo que dice: con una L40S, el p95 del TTFT es de ≈ 6 s, tres veces la promesa. Repartiendo en 3 L40S baja a ≈ 3.8 s, todavía fuera. Lo que más mueve el TTFT no es la cantidad de GPUs, es el tamaño del prompt: con 3,000 tokens (≈ 2 fragmentos de expediente en vez de 5) entra en 1.5 s.

### El prefill también le roba tiempo al decode

Hay un segundo efecto, y es el que decide cuántas GPUs. Mientras la GPU lee un prompt, no escribe tokens para nadie (o escribe menos, si parte el prefill en trozos). Si una fracción \(ρ_{pre}\) de su tiempo se va en prefills, al decode le queda \(1 − ρ_{pre}\):

:::formula La velocidad de cada persona, con prefills
ρ_{pre} = λ × t_{pre}
v = frac{1 − ρ_{pre}}{t_{paso}}
- λ: las preguntas por segundo que llegan a esa GPU
- t_{pre}: lo que tarda el prefill de una, en s
- ρ_{pre}: la fracción del tiempo de la GPU que se va en prefills
- t_{paso}: un paso de decode, del juguete
- v: los tokens por segundo de cada persona
:::

:::cuenta El despacho en la hora pico, con 1 y con 3 L40S
Una L40S: tiempo en prefills, \(ρ_{pre}\) // \(λ\) = 0.208, \(t_{pre}\) = 2.17 s | 0.208 × 2.17 | ≈ 45 %
Con 1 sola conversación // \(t_{paso}\) = (19.32 + 1.70) GB ÷ (0.7 × 864 GB/s) ≈ 34.8 ms | (1 − 0.452) ÷ 0.0348 | ≈ 15.8 tokens/s
Tres L40S: cada una recibe un tercio, \(ρ_{pre}\) | (0.208 ÷ 3) × 2.17 | ≈ 15 %
Con 2 conversaciones en cada una // \(t_{paso}\) ≈ 37.6 ms | (1 − 0.151) ÷ 0.0376 | ≈ 22.6 tokens/s
Con 3 en cada una // \(t_{paso}\) ≈ 40.4 ms | (1 − 0.151) ÷ 0.0404 | ≈ 21.0 tokens/s
= Con una sola L40S, en la hora pico **ni una persona sola** recibe sus 20 tokens por segundo. Con tres, cada una sostiene 2 o 3 conversaciones a buena velocidad. La [herramienta de sizing](/herramientas/sizing/), que cuenta más cosas, da 2 por L40S y concluye **3 L40S**, con un TTFT de ≈ 2.4 s que sigue sin llegar a la promesa.
:::

Ese es el clímax de la lección. Por memoria, en una L40S caben 8 conversaciones del despacho (≈ 12 si cada una usa sus 6,500 tokens típicos en vez del tope de 8,192). Por velocidad, ninguna se atiende bien en la hora pico. **La memoria dice cuántas caben; el cómputo y el [[ancho-de-banda|ancho de banda]] dicen cuántas se atienden bien.**

¿Qué puede hacer el despacho? Tres caminos, y la decisión va en el caso del despacho, no aquí:

- **Una GPU con más cómputo.** Una H100 SXM tiene ≈ 989.5 TFLOPS densos en FP16 (la mitad de los 1,979 «con sparsity» de su hoja de datos): el mismo prefill, con \(η_c\) = 0.5, tardaría ≈ 0.8 s. Cuesta más.
- **Menos tokens de entrada.** Mandar 3 fragmentos en vez de 5, o fragmentos más cortos. Baja el TTFT casi en proporción, pero hay que medir si las respuestas siguen igual de buenas.
- **Aflojar la promesa.** Un TTFT de 4 s en el p95 quizá sea aceptable para una pregunta sobre expedientes que antes tardaba horas. Es una conversación con el cliente, no una cuenta.

## La ley de Little: de personas a conversaciones a la vez {Little's law: from people to concurrent conversations}

Hasta aquí usaste \(N\), las conversaciones a la vez, como si fuera un dato. ¿De dónde sale? Del número de personas, de cuánto preguntan y de cuánto dura cada respuesta. La ley que lo conecta es la de Little, que en Sensei viste con las colas: en cualquier sistema estable, lo que hay adentro en promedio es lo que llega por segundo por lo que dura cada uno.

:::formula Ley de Little para el servidor
λ = frac{p × q}{h × 3,600} × k
L = λ × W
- p: las personas que usan el sistema
- q: las preguntas por persona al día
- h: las horas de uso al día
- k: el [[factor-de-pico|factor de la hora pico]] (cuántas veces el promedio llega en la hora más cargada)
- λ: las preguntas por segundo en la hora pico
- W: lo que dura una respuesta, de punta a punta, en s
- L: las conversaciones a la vez, en promedio
:::

Lo poderoso de Little es lo que **no** pide: nada sobre cómo llegan las preguntas ni sobre cómo varía la duración. Solo que el sistema sea estable, que no se esté llenando sin fin. Pero da un **promedio**. Los picos se ven aparte.

:::cuenta El despacho en la hora pico
Preguntas al día // \(p\) = 200 personas, \(q\) = 15 | 200 × 15 | 3,000
Promedio por hora // \(h\) = 10 horas (9:00 a 19:00) | 3,000 ÷ 10 | 300
Hora pico // \(k\) = 2.5 | 300 × 2.5 | 750 preguntas
Por segundo, \(λ\) | 750 ÷ 3,600 | ≈ 0.208
Duración de una respuesta, \(W\) // 2 s al primer token + 500 tokens a 20 por segundo | 2 + 500 ÷ 20 | 27 s
A la vez, \(L = λ × W\) | 0.208 × 27 | **≈ 5.6 conversaciones**
= En promedio, en la hora pico hay ≈ 5.6 conversaciones adentro. El despacho diseña para 8 porque dentro de la hora pico las preguntas no llegan parejas.
:::

Fíjate en algo incómodo: \(W\) depende de la velocidad. Si la GPU escribe más lento, cada respuesta dura más y hay más gente adentro, lo que la hace todavía más lenta. A 11 tokens por segundo, \(W\) = 2 + 500 ÷ 11 ≈ 47.5 s y \(L\) = 0.208 × 47.5 ≈ 9.9. La lentitud se alimenta sola.

:::calculadora concurrencia-little
La misma cuenta, para que cambies los números. Arranca con el despacho. Prueba 400 personas, o una respuesta que dure 47 s (la GPU escribiendo a 11 tokens por segundo).
:::

### ¿Y los picos dentro de la hora pico?

Little da el promedio, 5.6. ¿Cuántas hay en el peor momento? Con llegadas al azar se puede simular: mil horas pico, cada pregunta dura 27 s, y se anota el máximo de cada hora y cuánto tiempo hay más de 8 a la vez.

```python
# Llegadas al azar en la hora pico: ¿cuántas conversaciones a la vez en el peor momento?
import random
random.seed(7)
lam, W, horas = 750 / 3600, 27, 1000             # 1,000 horas pico simuladas
peores, encima = [], 0.0
for _ in range(horas):
    t, eventos = 0.0, []
    while True:
        t += random.expovariate(lam)             # tiempo hasta la siguiente pregunta
        if t > 3600: break
        eventos += [(t, +1), (t + W, -1)]        # empieza una conversación y termina 27 s después
    eventos.sort()
    vivas = peor = 0
    for k, (t, d) in enumerate(eventos):
        vivas += d
        peor = max(peor, vivas)
        if vivas > 8 and k + 1 < len(eventos):
            encima += eventos[k + 1][0] - t      # segundos con más de 8 a la vez
    peores.append(peor)
peores.sort()
print(f"Peor momento de una hora pico típica (mediana): {peores[horas // 2]} a la vez")
print(f"Peor momento en 95 de cada 100 horas pico: {peores[int(horas * 0.95)]} o menos")
print(f"Tiempo con más de 8 a la vez: {encima / (horas * 3600):.1%}")
```

```salida
Peor momento de una hora pico típica (mediana): 14 a la vez
Peor momento en 95 de cada 100 horas pico: 17 o menos
Tiempo con más de 8 a la vez: 11.6%
```

Ocho no es el peor momento: es un número que cubre ≈ 88 % del tiempo de la hora pico. En los picos llegan a juntarse 14. Lo que pasa entonces depende de los techos de la siguiente sección: mientras quepa su KV cache, entran más, todas un poco más lentas; cuando ya no cabe, las que sobran esperan su turno y su [[ttft|TTFT]] crece.

:::figura concurrencia-llegadas
Tres minutos simulados de la hora pico. Arriba, cada pregunta es una barra de 27 s. Abajo, cuántas hay a la vez: sube y baja alrededor del promedio de Little, y a veces pasa de 8.
:::

:::profundo ¿A cuántas personas le alcanza?
Ahora al revés: si el servidor aguanta \(c\) conversaciones a la vez cumpliendo, ¿cuántas personas registradas puede atender? Despeja Little:

:::formula Personas que caben
p_{máx} = frac{c}{W} × frac{h × 3,600}{k × q}
- c: las conversaciones a la vez que se atienden **cumpliendo** la promesa
- W: la duración de una respuesta, en s
- h, k, q: horas de uso, factor de la hora pico y preguntas por persona al día
- p_{máx}: las personas con las que el **promedio** de la hora pico llega a \(c\)
:::

:::cuenta El despacho, según qué techo mires
Por memoria // 8 conversaciones caben en una L40S | 8 ÷ 27 × 36,000 ÷ (2.5 × 15) | ≈ 284 personas
Por velocidad, 3 L40S // ≈ 2 por GPU según la [herramienta de sizing](/herramientas/sizing/): \(c\) = 6 | 6 ÷ 27 × 36,000 ÷ 37.5 | ≈ 213 personas
Por velocidad, 3 L40S, el juguete // ≈ 3 por GPU: \(c\) = 9 | 9 ÷ 27 × 36,000 ÷ 37.5 | ≈ 320 personas
= Si miras solo la memoria, una L40S «alcanza» para 284 personas. Si miras la velocidad, hacen falta 3 L40S para las 200 de hoy, con poco margen. Y ojo: \(p_{máx}\) es un techo, no un objetivo; ahí los picos ya hacen fila.
:::

**¿Y si el despacho duplica su gente?** Con 400 personas, \(λ\) ≈ 0.417 por segundo y el promedio sube a ≈ 11.25 conversaciones a la vez. En 3 L40S, cada una recibe ≈ 0.139 preguntas por segundo: 30 % de su tiempo en prefills, y ya con 1 conversación cada persona recibe ≈ 20.1 tokens por segundo, con 3.75 en promedio en cada GPU. No alcanza. En 6 L40S, cada una vuelve al 15 % de prefills y a ≈ 1.9 conversaciones en promedio, como hoy con 3. Duplicar la gente duplica las GPUs: no hay economía de escala cuando el cuello es el cómputo de los prefills.

¿Y la memoria? Con 400 personas, las ≈ 11 conversaciones del promedio todavía cabrían en una sola L40S si cada una usa su largo típico de 6,500 tokens (caben 12). Por eso dimensionar solo por memoria engaña dos veces: dice que una GPU basta hoy y que seguirá bastando con el doble de gente.
:::

## Los tres techos y la promesa {The three ceilings and the promise}

Junta todo lo anterior y salen tres techos. Cada uno rompe algo distinto, y conviene saber cuál te toca primero.

**Techo 1: la memoria del KV cache.** Cada conversación necesita su propio KV cache en la [[vram|VRAM]]. Cuando ya no hay lugar, la siguiente no entra: espera en la fila, aunque la GPU tenga cálculo de sobra. Es el techo que mide la herramienta [¿Cabe en la GPU?](/herramientas/vram/).

:::formula Cuántas caben
c = ⌊ frac{(1 − f) × M_{GPU} − W − M_{prog}}{T × m} ⌋
- M_{GPU}: la VRAM de la GPU, en GB
- f: el margen que el servidor deja libre (0.1)
- W: los pesos, en GB
- M_{prog}: el programa que sirve el modelo, en GB
- T × m: el KV cache de una conversación, en GB
- c: cuántas conversaciones caben; ⌊ ⌋ redondea hacia abajo
:::

:::cuenta Cuántas conversaciones del despacho caben en una L40S
Lo útil // 48 GB, \(f\) = 0.1 | 0.9 × 48 | 43.2 GB
Lo que queda para KV // pesos 19.32, programa 2 | 43.2 − 19.32 − 2 | 21.88 GB
Una conversación con el tope de contexto // 8,192 tokens × 256 KiB | 8,192 × 262,144 | ≈ 2.15 GB
Caben, \(c\), con el tope | ⌊21.88 ÷ 2.147⌋ = ⌊10.19⌋ | 10
Una conversación típica // 6,500 tokens | 6,500 × 262,144 | ≈ 1.70 GB
Caben con el largo típico | ⌊21.88 ÷ 1.704⌋ = ⌊12.84⌋ | **12**
= La ficha diseña para 8 conversaciones de 8,192 tokens: 38.5 GB de 43.2, con margen. Un servidor que [[pagedattention|reparte el KV cache en bloques]] según lo que cada una usa de verdad (lo ves en «[Batching continuo y PagedAttention](/batching/)») admite ≈ 12 con el largo al final de la respuesta; la lección de batching cuenta 13 a media respuesta, con 6,250 tokens.
:::

**Techo 2: el [[ancho-de-banda|ancho de banda]].** Cada conversación más agrega su KV cache a lo que se lee en cada paso, y cada persona recibe menos tokens por segundo. No hay un corte brusco: la velocidad baja poco a poco hasta cruzar la promesa. En el despacho, con \(η_m\) = 0.7 y sin prefills, cruza los 20 tokens por segundo entre 6 y 7 conversaciones (≈ 20.5 con 6, ≈ 19.4 con 7). Este techo es el que mide el juguete.

**Techo 3: la fila.** Si \(λ × W\) pasa de lo que cabe y se atiende bien, llegan más preguntas de las que salen, y la fila crece sin parar. Aquí entran los prefills: cada pregunta nueva necesita su rato de cómputo para leer su prompt, y mientras tanto los demás esperan. Este techo se siente en el [[ttft|TTFT]]: las respuestas empiezan cada vez más tarde, aunque una vez que empiezan salgan igual.

:::diagrama concurrencia-techos
Toca cada techo para ver su cuenta, o usa «Recorrer» para subir la gente hasta que algo se rompa.
:::

¿Cuál te toca primero? Depende del modelo y del prompt:

- **Modelo grande con prompts cortos**, como un asistente de soporte: casi siempre el **techo 2**. La velocidad por persona cae antes de que se acabe la memoria.
- **Pesos grandes en una GPU justa**, como Llama 3.1 8B en BF16 en la curva de NVIDIA o un 32B en FP8 en una L40S: el **techo 1**. El KV cache se acaba pronto y el codo llega de golpe.
- **Prompts largos**, como un RAG con 5 fragmentos: el **techo 3**, por los prefills. Es el caso del despacho, que llega a él antes de llenar la memoria.

### La promesa: SLO y goodput

Una promesa de servicio escrita en números es un [[slo|SLO]] (*service level objective*). En [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/) viste que se escribe en un percentil alto, porque el promedio esconde a quien le fue mal. En un LLM que conversa hay **dos** promesas por respuesta, y una petición solo cumple si cumple las dos:

| Promesa | El despacho | Qué la rompe |
|---|---|---|
| TTFT | ≤ 2 s en el p95 | La fila y los prefills (techo 3), la memoria llena (techo 1) |
| TPOT | ≤ 50 ms en el p95 (≥ 20 tokens por segundo) | Muchas conversaciones a la vez (techo 2), los prefills que interrumpen |

¿Por qué no basta el promedio? Con una L40S en la hora pico, la mediana del TTFT del despacho sería ≈ 2.2 s (más de la mitad de las preguntas no espera nada: solo pagan su [[prefill|prefill]]), pero el p95 es de 6 s. Un promedio de 3 s suena casi bien; una de cada veinte personas esperando 6 s o más, no.

:::profundo ¿De dónde sale la promesa de 20 tokens por segundo?
De cuánto lee una persona. Un metaanálisis de Marc Brysbaert (2019, *Journal of Memory and Language*), con 190 estudios y 18,573 participantes, encontró que un adulto lee en silencio ≈ 238 palabras por minuto en textos de no ficción y ≈ 260 en ficción. Son datos de lectura en **inglés**; no hay en nuestras fuentes una cifra propia para español.

Para pasar de palabras a tokens hace falta saber cuántos tokens tiene una palabra, lo que se llama la *fertilidad* del tokenizador (el programa que parte el texto en tokens). Un artículo de octubre de 2025 (Nayeem y otros, «Beyond Fertility», en arXiv) la midió en noticias: con el tokenizador de Llama 3.1, ≈ 1.23 tokens por palabra en inglés y ≈ 1.61 en español; en textos informales en español, ≈ 1.53. Para el tokenizador de Qwen3 no tenemos la cifra, y la de lectura es de inglés: toma el resultado como aproximado.

:::formula Velocidad de lectura en tokens
v_{leer} = frac{w}{60} × r
- w: las palabras por minuto que lee una persona
- r: los tokens por palabra del tokenizador en ese idioma
- v_{leer}: los tokens por segundo que esa persona alcanza a leer
:::

:::cuenta Cuántos tokens por segundo lee un abogado
Palabras por segundo // \(w\) = 238, no ficción, en inglés | 238 ÷ 60 | ≈ 3.97
En español, aproximado // \(r\) ≈ 1.61, tokenizador de Llama | 3.97 × 1.61 | **≈ 6.4 tokens/s**
En inglés // \(r\) ≈ 1.23 | 3.97 × 1.23 | ≈ 4.9 tokens/s
Una respuesta de 500 tokens, leída | 500 ÷ 6.4 | ≈ 78 s
La misma, escrita a 20 tokens/s | 500 ÷ 20 | 25 s
= A 20 tokens por segundo, el modelo escribe ≈ 3 veces más rápido de lo que se lee. Por eso 20 basta y sobra para leer de corrido: el margen sirve para hojear, para releer y para los tirones.
:::

Esto también dice qué tan mal es quedarse corto. A 15 tokens por segundo, el texto sigue saliendo más rápido de lo que se lee; la gente casi no lo nota. A 5 o menos, el lector alcanza al modelo y lo siente lento. Esa última frontera es un criterio de diseño, no una medición. Para el despacho, lo que de verdad se siente es el TTFT: 6 s mirando una pantalla vacía molestan mucho más que 18 tokens por segundo en vez de 20.
:::

El número que junta las dos promesas es el [[goodput]], que en Sensei viste como el throughput que sí cuenta. En los LLMs vas a encontrar dos versiones, y conviene no confundirlas:

- **La de una prueba.** `vllm bench serve --goodput ttft:2000 tpot:50` cuenta una petición como buena solo si cumple cada objetivo que le das (en milisegundos) y reporta las peticiones buenas por segundo de esa prueba.
- **La de capacidad.** El artículo de DistServe (OSDI 2024), que llevó la idea al servicio de LLMs, la define como la tasa de llegada más alta, **por GPU**, a la que una fracción pedida de las peticiones (por ejemplo, 90 %) cumple sus objetivos de TTFT y de TPOT. Con ella midió su propuesta, que separa el prefill y el [[decode|decode]] en GPUs distintas: según su resumen, atiende 7.4 veces más peticiones, o promesas 12.6 veces más estrictas, con más del 90 % de las peticiones dentro de su latencia. El despacho no va a separar fases, pero esta es la definición que usan los artículos.

:::cuenta Throughput contra goodput en la curva de NVIDIA
La promesa // la del despacho: TTFT ≤ 2 s y ≥ 20 tokens por segundo | dos SLO | 2 s y 50 ms
FP8 a 150 a la vez // TTFT 0.77 s, ITL 44.38 ms: cumple las dos, en promedio | 1,000 ÷ 44.38 = 22.5 tok/s | 3,325 tokens/s
FP8 a 200 a la vez // ITL 55.33 ms: rompe la velocidad | 1,000 ÷ 55.33 = 18.1 tok/s | 3,560 tokens/s, que no cuentan
BF16 a 200 a la vez // TTFT 63.6 s: rompe el TTFT | 63.6 s > 2 s | 1,619 tokens/s, que no cuentan
= El «máximo throughput» de la tabla es 3,676 tokens/s, pero con la promesa del despacho lo útil se queda en ≈ 3,325, y solo en promedio. Para el p95 habría que ver la distribución, que la tabla no trae.
:::

Lo importante del goodput es que cambia la pregunta de compra. No es «¿cuántos tokens por segundo hace esta GPU?», sino «¿cuántas preguntas por segundo atiende **cumpliendo**?». Para el despacho con una L40S y \(η_c\) = 0.5, la respuesta es cero: ni una pregunta sola, con la GPU libre, tiene su primer token en 2 s.

## Leer un benchmark sin engañarte {Reading a benchmark without fooling yourself} [extra]

Todos los fabricantes y blogs publican tablas de tokens por segundo. Casi todas son verdad y casi ninguna es tu caso. Antes de creerle a una, revisa cinco cosas.

**1. Las longitudes de entrada y salida.** Es lo que más cambia el resultado. En la misma L40S y el mismo modelo, NVIDIA mide 4,251 tokens/s con 100 a la vez y peticiones de 200/200, y 2,869 con 1,000/1,000. Con 5,000 de entrada y 500 de salida, 889. Una tabla con prompts de 200 tokens no dice nada de un RAG con 6,000.

**2. La cuantización y el modelo exacto.** FP8 contra BF16 en la misma GPU: 2,869 contra 1,613 tokens/s a 100 a la vez. Un 8B no es un 32B. Y el KV cache puede ir en otro formato que los pesos, y casi nunca se dice.

**3. Concurrencia fija contra tasa de llegada.** Es la carga cerrada contra la carga abierta que viste en [Qué tan rápido y cuánto](https://sensei.trueml.app/latencia/). Las tablas de NVIDIA mantienen un número fijo de peticiones adentro: cuando una termina, entra otra. Tus usuarios llegan al azar, a veces juntos. Una prueba con concurrencia fija se frena cuando el servidor se frena, así que mide menos espera de la que tendrás. Para la latencia que sentirán tus usuarios, prueba con una tasa de llegada (en vLLM, `--request-rate`, que reparte las llegadas al azar); para encontrar el máximo, sirve la concurrencia fija.

**4. El «máximo throughput» con latencias inaceptables.** El número grande de una tabla casi siempre está pasado el codo. La fila BF16 a 200 a la vez hace 1,619 tokens/s con un [[ttft|TTFT]] de 64 s: nadie en su sano juicio espera un minuto el primer token. Busca el throughput **a tu SLO**, no el máximo.

**5. Quién midió y cómo.** Las tablas de NVIDIA se pueden comprobar (como hiciste con Little). Los blogs son útiles para contrastar, pero son fuentes secundarias. Uno que midió Qwen3 32B en FP8 en una L40S con vLLM (prompts de 1,024 tokens, salidas de 256) reporta, con 8 a la vez, 119 tokens/s totales, un ITL de ≈ 50 ms y un TTFT medio de 4.2 s; con 32 a la vez, 230 tokens/s y TTFT de 9.2 s, porque con pesos de ≈ 32 GB casi no le queda memoria para KV cache. Es una fuente de segunda mano, pero va en la misma dirección que tus cuentas: un 32B en una L40S está justo.

:::ojo
Un benchmark responde «¿qué tan rápido va este servidor con esta carga?». Tú necesitas «¿cumple mi promesa con mi carga?». La única forma de saberlo es una prueba de carga con tus prompts, tu modelo y tu hardware; la verás a fondo en la lección «Pruebas de carga y benchmarks honestos».
:::

## Errores comunes {Common mistakes}

**1. Dimensionar solo por memoria.** «Caben 8 conversaciones, entonces atiendo a 8.» La memoria dice cuántas caben; el [[ancho-de-banda|ancho de banda]] y el cómputo, cuántas se atienden bien. En el despacho caben 8 y en la hora pico no se atiende bien ni una. Haz siempre las tres cuentas: memoria, velocidad de [[decode|decode]] y [[prefill|prefill]].

**2. Olvidar el prefill.** Con prompts cortos casi no pesa; con un RAG de 6,000 tokens, es lo que decide. Calcula \(2 × P × T_{ent}\) antes de prometer un [[ttft|TTFT]], y multiplica por las preguntas por segundo para ver cuánto tiempo de GPU se lleva.

**3. Confundir usuarios registrados con conversaciones a la vez.** Doscientas personas no son doscientas conversaciones: con Little son ≈ 5.6 en la hora pico. Y al revés: el promedio de Little no es el peor momento; en el despacho los picos llegan a 14.

**4. Leer el throughput total como velocidad de cada persona.** 3,676 tokens/s en una L40S suena a que todos vuelan, pero son 250 personas a 16 tokens/s cada una, esperando 5 s su primer token. Pregunta siempre: ¿total o por persona? ¿de salida o con la entrada?

**5. Prometer en promedio.** Un TTFT medio de 3 s puede esconder un p95 de 6. Las promesas van en p95 o p99, y un benchmark que solo reporta medias no te dice si las cumples.

**6. Copiar un benchmark de otras longitudes.** Una tabla con prompts de 200 tokens no predice un RAG con 6,000. Antes de usar una tabla, iguala modelo, cuantización, longitudes y tipo de carga, o mide tú.

**7. Tomar las eficiencias como 100 %.** Ninguna GPU lee a su ancho de banda de hoja ni calcula a su pico. El juguete con \(η\) = 1 era 23 % optimista contra NVIDIA con una sola conversación. Usa 0.7 y 0.5 como punto de partida y reemplázalos por lo que midas.

## En la vida real {In real life} [extra]

**El despacho.** Por memoria, una L40S con Qwen3 32B en INT4 de AWQ parecía suficiente: 8 conversaciones de 8,192 tokens en 38.5 GB de 43.2. Las cuentas de esta lección dicen otra cosa. El [[prefill|prefill]] de una pregunta de 6,000 tokens tarda ≈ 2.2 s, más que la promesa de [[ttft|TTFT]], sin nadie en la fila. En la hora pico, los prefills se llevan ≈ 45 % del tiempo de la GPU y nadie recibe sus 20 tokens por segundo. La [herramienta de sizing](/herramientas/sizing/) concluye 3 L40S, y aun así el TTFT queda en ≈ 2.4 s. Las salidas (más cómputo, menos fragmentos o una promesa más floja) se deciden en el caso del despacho, con el cliente.

**Un asistente de soporte con prompts cortos.** Supón una tienda en línea que contesta preguntas de clientes con un modelo de 8B en una L40S: prompts de ≈ 200 tokens, respuestas de ≈ 200. Ahí el prefill casi no pesa: la curva de NVIDIA para 200/200 en FP8 da TTFT de 0.5 s con 100 a la vez. El techo es el 2, la velocidad: con 100 a la vez cada persona recibe ≈ 47 tokens por segundo (1,000 ÷ 21.19 ms). Esta tienda sí puede meter mucha gente en una sola GPU; el despacho no. Mismo hardware, otro problema.

**Un resumidor de documentos por lotes.** Supón una aseguradora que resume 10,000 pólizas cada noche, sin nadie esperando en una pantalla. Ahí no hay TTFT que prometer: lo que importa es el throughput total y terminar antes de las 7 de la mañana. Conviene subir la concurrencia hasta justo antes del codo, donde los tokens por segundo totales dejan de crecer, aunque cada respuesta salga lenta. Es el mismo servidor con la promesa contraria.

**Fuera de los LLMs: la fonda a la hora de la comida.** Una fonda de 12 mesas puede servir a 12 grupos a la vez (la memoria). Pero tiene una sola estufa (el [[ancho-de-banda|ancho de banda]]) y un solo cocinero que toma las comandas (el prefill). A la 1:30 de la tarde, con todas las mesas llenas, la sopa llega tibia y los recién llegados esperan 20 minutos para que les tomen la orden. Tener mesas no es tener servicio.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una respuesta de 300 tokens tarda 16.45 s de punta a punta y su [[ttft|TTFT]] es 1.5 s. ¿Cuál es su TPOT y cuántos tokens por segundo recibió esa persona mientras escribía?
\(TPOT = (E2E − TTFT) ÷ (n − 1)\) = (16.45 − 1.5) ÷ 299 = 14.95 ÷ 299 = **0.05 s = 50 ms**. Mientras escribía, 1 ÷ 0.05 = **20 tokens por segundo**. Contando la espera, \(X_{per}\) = 300 ÷ 16.45 ≈ 18.2.

? [facil] A un servidor llegan 0.5 preguntas por segundo y cada respuesta dura 20 s. ¿Cuántas conversaciones hay adentro en promedio?
[[ley-de-little|Ley de Little]]: \(L = λ × W\) = 0.5 × 20 = **10 conversaciones**. Es el promedio; en los picos habrá más.

? [facil] En la tabla de NVIDIA (L40S, FP8, 1,000/1,000), a 50 a la vez el ITL es 23.59 ms y el total 2,060 tokens/s. ¿Cuántos tokens por segundo recibe cada persona? ¿Cuadra con el total?
Por persona, 1,000 ÷ 23.59 ≈ **42.4 tokens/s**. Si los 50 escribieran a esa velocidad todo el tiempo, el total sería 50 × 42.4 = 2,120. La tabla dice 2,060: un poco menos, porque cada respuesta también pasa ≈ 0.7 s esperando su primer token sin escribir. Cuadra.

? [facil] Una persona lee ≈ 6.4 tokens por segundo en español. ¿Cuánto tarda en leer una respuesta de 300 tokens, y cuánto en escribirla un modelo a 20 tokens por segundo?
Leer: 300 ÷ 6.4 ≈ **47 s**. Escribir: 300 ÷ 20 = **15 s**. El modelo termina mucho antes de que la persona acabe de leer; por eso 20 basta.

? [medio] Con el juguete y \(η_m\) = 0.7, ¿cuántos tokens por segundo recibe cada persona del despacho con 4 conversaciones a la vez en una L40S, sin contar los prefills? ¿Y el total?
KV de las 4: 4 × 6,500 × 262,144 ≈ 6.82 GB. Bytes por paso: 19.32 + 6.82 = 26.14 GB. \(t_{paso}\) = 26.14 ÷ (0.7 × 864) ≈ 43.2 ms. Por persona, 1 ÷ 0.0432 ≈ **23.1 tokens/s**; total, 4 × 23.1 ≈ **93 tokens/s**. Con 4 sí se cumpliría la velocidad, si no hubiera prefills.

? [medio] Si el despacho manda 3 fragmentos de expediente en vez de 5, cada pregunta baja a ≈ 4,000 tokens de entrada. ¿Cuánto tarda su [[prefill|prefill]] en una L40S con \(η_c\) = 0.5? ¿Ya cumple la promesa de TTFT sin fila?
\(C_{pre}\) = 2 × 32.76e9 × 4,000 ≈ 2.62 × 10¹⁴ FLOPs. \(t_{pre}\) = 2.62e14 ÷ (0.5 × 362.05e12) ≈ **1.45 s**. Sin fila sí cumple los 2 s. Pero en la hora pico, con 3 L40S, la simulación da un p95 de ≈ 2.2 s: todavía un poco fuera. Y falta medir si las respuestas con 3 fragmentos son igual de buenas.

? [medio] En la misma tabla de NVIDIA, a 25 a la vez el TTFT es 617.75 ms y el ITL 18.59 ms. Con la ley de Little, estima el throughput de salida y compáralo con el de la tabla (1,302.3).
\(W = TTFT + ITL × 999\) = 0.618 + 0.01859 × 999 ≈ 19.19 s. \(λ = L ÷ W\) = 25 ÷ 19.19 ≈ 1.303 peticiones por segundo. Throughput = 1.303 × 1,000 ≈ **1,303 tokens/s**. La tabla dice 1,302.3: cuadra.

? [medio] ¿Cuántas conversaciones del despacho caben en una L40S si el KV cache se guarda en FP8 (1 byte por número), con el tope de 8,192 tokens?
KV por token en FP8: 2 × 64 × 8 × 128 × 1 = 131,072 bytes. Una conversación de 8,192 tokens: 8,192 × 131,072 ≈ 1.07 GB. Quedan 21.88 GB: ⌊21.88 ÷ 1.074⌋ = ⌊20.4⌋ = **20 conversaciones**, el doble. Pero eso solo mueve el techo 1: el prefill de cada pregunta sigue costando 2.2 s.

? [reto] El despacho piensa crecer a 400 personas con 3 L40S. Usa la ley de Little y el reparto de tiempo de la GPU para decir si alcanza. ¿Cuántas L40S necesitaría para quedar como hoy?
\(λ\) = 400 × 15 ÷ 36,000 × 2.5 ≈ 0.417 por segundo; \(L\) = 0.417 × 27 ≈ 11.25 a la vez, ≈ 3.75 por GPU. Cada GPU recibe 0.139 preguntas por segundo: \(ρ_{pre}\) = 0.139 × 2.17 ≈ 30 %. Con 1 conversación, \(t_{paso}\) ≈ 34.8 ms y \(v\) = (1 − 0.30) ÷ 0.0348 ≈ 20.1; con 4, \(t_{paso}\) ≈ 43.2 ms y \(v\) ≈ 0.70 ÷ 0.0432 ≈ 16.2. **No alcanza.** Con 6 L40S, cada una recibe 0.069 por segundo (15 % de prefills) y ≈ 1.9 conversaciones en promedio, como hoy con 3. Hacen falta **≈ 6 L40S**: el doble de gente, el doble de GPUs.

? [reto] Un proveedor te dice: «en una L40S, Llama 3.1 8B en FP8 hace 3,676 tokens por segundo». Con la tabla de NVIDIA y las promesas del despacho (TTFT ≤ 2 s y ≥ 20 tokens por segundo), ¿cuál es el throughput útil y cuántas peticiones por segundo atiende cumpliendo, en promedio?
Los 3,676 son a 250 a la vez, con TTFT de 5 s: no cumple. A 200, el ITL es 55.33 ms (18.1 tokens/s): no cumple la velocidad. A 150, TTFT 0.77 s e ITL 44.38 ms (22.5 tokens/s): cumple. Throughput útil ≈ **3,325 tokens/s**. Por Little: \(W\) = 0.770 + 0.04438 × 999 ≈ 45.1 s y \(λ\) = 150 ÷ 45.1 ≈ **3.3 peticiones por segundo**. Ojo: son promedios; para el p95 habría que ver la distribución, y con prompts de 6,000 tokens todo cambia.
:::

## Lo que sigue {What comes next} [extra]

- **[[batching-continuo|Batching continuo]] y [[pagedattention|PagedAttention]]** (de esta app) explica el mecanismo que esta lección usó como resultado: por qué el [[decode|decode]] espera a la memoria, cómo el servidor mete y saca conversaciones del [[batch|lote]] en cada paso, cómo reparte el KV cache en bloques para que quepan ≈ 12 en vez de 8 y cómo parte los prefills en trozos.
- **De requisitos a hardware** convierte todo esto en una compra: de personas, tokens y promesas a cuántas GPUs y de cuál tipo, con la [herramienta de sizing](/herramientas/sizing/).
- **Elegir un modelo para la tarea** retoma una de las salidas del despacho: un modelo con menos [[parametros-activos|parámetros activos]] hace el [[prefill|prefill]] más barato.
- **Pruebas de carga y benchmarks honestos** (de esta app): cómo medir con tus prompts y tu tasa de llegada, la única forma de cambiar las eficiencias supuestas por las tuyas.
- En Sensei, [Qué tan rápido y cuánto: latencia y throughput](https://sensei.trueml.app/latencia/) tiene la teoría de colas detrás de la fila de los prefills, y [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/), por qué las promesas van en p95.

## Palabras que vas a oír {Words you will hear}

:::conceptos
tpot itl throughput-de-tokens codo slo goodput
:::

## Chequeo {Check}

:::chequeo
? Si en una GPU caben 8 conversaciones, ¿puedes atender bien a 8 personas a la vez?
No necesariamente. La memoria dice cuántas caben; el [[ancho-de-banda|ancho de banda]] y el cómputo, cuántas se atienden bien. En el despacho caben 8 en una L40S y en la hora pico no se atiende bien ni una.

? ¿Por qué el throughput total sube cuando hay más gente a la vez?
Porque en cada paso de [[decode|decode]] los pesos se leen una sola vez para todas las conversaciones del [[batch|lote]]. Cada conversación más solo agrega la lectura de su KV cache.

? ¿Qué diferencia hay entre TPOT e ITL en vLLM?
El TPOT es un promedio por respuesta, sin el primer token. El ITL es cada intervalo suelto entre dos tokens, y sus estadísticas juntan todos los de todas las respuestas: deja ver los tirones.

? ¿Cuánto cuesta el [[prefill|prefill]] de un prompt y por qué importa tanto en un RAG?
≈ 2 × parámetros × tokens de entrada operaciones, y lo limita el cómputo de la GPU. Con 6,000 tokens y un 32B son ≈ 3.9 × 10¹⁴ FLOPs, ≈ 2.2 s en una L40S: más que la promesa de [[ttft|TTFT]] del despacho.

? ¿Qué dice la [[ley-de-little|ley de Little]] del despacho en la hora pico?
\(L = λ × W\) ≈ 0.208 × 27 ≈ 5.6 conversaciones a la vez en promedio. Es un promedio: con llegadas al azar, en el peor momento de una hora pico típica hay 14.

? ¿Qué es el goodput y por qué es mejor número de compra que el throughput?
Las peticiones por segundo que terminan cumpliendo todas sus promesas (TTFT y TPOT). Un servidor puede tener mucho throughput y casi cero goodput, si está pasado el codo.

? ¿Qué cinco cosas revisas antes de creerle a un benchmark?
Las longitudes de entrada y salida, el modelo y su cuantización, si la carga es de concurrencia fija o de tasa de llegada, si el número está a tu SLO o pasado el codo, y quién lo midió y cómo.
:::
