---
titulo: Batching continuo y PagedAttention
en: Continuous batching and PagedAttention
subtitulo: Por qué una GPU que atiende a una sola persona está casi ociosa, cómo un servidor de LLMs junta conversaciones en cada paso sin hacerlas esperar, y cómo reparte la memoria del KV cache en bloques para que quepan muchas más.
pregunta: Si la GPU tarda lo mismo con una conversación que con ocho, ¿por qué no atiende a ochenta? ¿Qué la detiene, y qué hacen vLLM y compañía para estirarla?
sensei: llms, flops, latencia
---

:::idea
En el decode, la GPU pasa casi todo el tiempo **leyendo los pesos** de su memoria, no calculando. Si en cada lectura atiende a varias conversaciones a la vez (un **batch**), produce muchos más tokens casi por el mismo tiempo. Dos ideas hacen que eso funcione en un servidor de verdad: el **batching continuo**, que mete y saca conversaciones del batch en cada paso, y **PagedAttention**, que guarda el KV cache en bloques chicos para no desperdiciar memoria. Con las dos, el límite deja de ser el tiempo y pasa a ser la memoria.
:::

## Una GPU sirviendo a una persona está casi ociosa {A GPU serving one person is almost idle}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Su candidato es **Qwen3 32B en INT4 de AWQ** (pesos de ≈ 19.32 GB) en **una NVIDIA L40S de 48 GB**. Cada pregunta trae ≈ 6,000 tokens de entrada (≈ 400 de instrucciones, la pregunta y cinco fragmentos de expediente) y la respuesta, ≈ 500. Se diseña para **8 conversaciones a la vez** y se quiere que cada persona vea al menos **20 tokens por segundo**.

Antes de seguir, tres cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Un LLM contesta en dos fases. En el **prefill** lee todo el prompt de golpe; en el **decode** escribe un token a la vez, y cada token es una pasada completa por la red. Lo ves en [Transformers y LLMs](https://sensei.trueml.app/llms/).
- Cada pasada lee de la [[vram|VRAM]] **todos** los [[pesos]] del modelo, y además el [[kv-cache|KV cache]] de la conversación: lo que el modelo recuerda de cada token anterior.
- Una GPU tiene dos velocidades: cuántas operaciones hace por segundo (TFLOPS) y cuántos bytes lee por segundo de su memoria (GB/s). Cuál de las dos manda se decide con el *roofline*; lo ves en [Matrices y FLOPs](https://sensei.trueml.app/flops/).

Con eso basta para ver el problema. Para escribir **un** token de una conversación del despacho, la L40S tiene que leer ≈ 19.32 GB de pesos más ≈ 1.6 GB de KV cache. A 864 GB/s, eso toma ≈ 24 ms. Las cuentas de ese token, en cambio, son ≈ 65.5 mil millones de operaciones: a 362 TFLOPS, ≈ 0.2 ms. **La GPU calcula durante menos del 1 % del paso.** El resto del tiempo espera a que lleguen los bytes.

:::analogia La cocina que espera al refrigerador
Imagina una cocina con un chef rapidísimo y un refrigerador al fondo de un pasillo larguísimo. Para cada platillo, el chef tiene que ir por **todos** los ingredientes de la cocina (los pesos), aunque solo use una pizca de cada uno. Cocinar le toma segundos; ir y volver, minutos. Si ya que va al refrigerador cocina ocho platillos con cada ingrediente en vez de uno, el viaje es el mismo y sale con ocho veces más comida.

Dónde se rompe: cada comensal trae además **su propia** bolsa de ingredientes (su KV cache), que el chef tiene que ir a buscar por separado. Con ocho comensales, son ocho bolsas. Ese detalle, que la analogía casi esconde, es el que pone el límite de verdad, y es el tema de media lección.
:::

### Cuánto trabajo hay por cada byte

La [[intensidad-aritmetica|intensidad aritmética]] de un cálculo es cuántas operaciones hace por cada byte que lee: FLOPs ÷ bytes. La GPU tiene su propio número: su **punto de quiebre** (*ridge point*), pico de FLOPs por segundo ÷ bytes por segundo. Si la intensidad del cálculo está por debajo del quiebre, la memoria no alcanza a alimentar a los núcleos y el cálculo está [[limitado-por-memoria|limitado por memoria]] (*memory-bound*). Si está arriba, manda el cálculo. Es la gráfica del [[roofline]].

:::formula Intensidad del decode y punto de quiebre
I = frac{2 × P × b}{W + b × K}
I_{q} = frac{F}{B_W}
- P: los parámetros del modelo (32,762 millones en Qwen3 32B)
- b: las conversaciones que van juntas en el paso (el batch)
- 2 × P × b: los FLOPs del paso: 2 por parámetro (una multiplicación y una suma) por cada conversación
- W: los bytes de los pesos, que se leen una vez por paso
- K: los bytes del KV cache que lee cada conversación en el paso
- I: la intensidad del paso, en FLOPs por byte
- F: el pico de la GPU, en FLOPs por segundo (densos, sin *sparsity*)
- B_W: el ancho de banda de memoria de la GPU, en bytes por segundo
- I_{q}: el punto de quiebre, en FLOPs por byte
:::

La cuenta de FLOPs solo mira las capas lineales, que son casi todo el trabajo; la atención suma algo más y lo ves en el bloque de abajo.

:::cuenta El despacho: ¿cuánta intensidad tiene un paso con una conversación?
KV de una conversación, \(K\) // a media respuesta: ≈ 6,000 de entrada + 250 escritos; 256 KiB por token en BF16 | 6,250 × 262,144 bytes | ≈ 1.64 GB
Bytes del paso // \(W\) = 19.32 GB de pesos, \(b\) = 1 | 19.32 + 1 × 1.64 | ≈ 20.96 GB
FLOPs del paso // \(P\) = 32.762 mil millones | 2 × 32.762 × 10⁹ × 1 | ≈ 65.5 × 10⁹
Intensidad, \(I\) | 65.5 × 10⁹ ÷ 20.96 × 10⁹ | ≈ 3.1 FLOPs por byte
Quiebre de la L40S, \(I_{q}\) // \(F\) = 362.05 TFLOPS en FP16, \(B_W\) = 864 GB/s | 362.05 × 10¹² ÷ 864 × 10⁹ | ≈ 419 FLOPs por byte (DERIVADO)
= La intensidad está ≈ 135 veces por debajo del quiebre. El paso espera a la memoria casi todo el tiempo.
:::

Ojo con un detalle: con pesos en INT4 cada parámetro ocupa ≈ medio byte, así que la intensidad con una conversación es ≈ 3 y no ≈ 1 como en BF16. Cuantizar sube la intensidad, pero ni de cerca hasta 419.

:::figura batching-roofline
El roofline de la L40S con cuatro puntos del despacho. Con 1 y con 8 conversaciones el decode está en la rampa, donde manda la memoria. Ni con muchísimas conversaciones llega al quiebre: el KV cache de cada una lo frena en ≈ 40. El prefill, en cambio, toca el techo.
:::

### Y si junto muchas, ¿cruzo el quiebre?

Mira la fórmula de \(I\). Si solo existieran los pesos (\(K\) = 0), la intensidad crecería sin parar con \(b\), y con unas 120 conversaciones cruzarías el quiebre. Pero cada conversación suma su propio \(K\) a los bytes. Cuando \(b\) es muy grande, los pesos ya casi no pesan y la intensidad se acerca a \(2 × P ÷ K\): en el despacho, 65.5 × 10⁹ ÷ 1.64 × 10⁹ ≈ **40**. Nunca llega a 419.

Esa es la primera lección de este tema: **con contextos largos, el decode de un LLM grande está limitado por memoria casi siempre**, juntes a quien juntes. Lo que el batch sí consigue es que la misma lectura de los pesos sirva para más personas. Y eso, como vas a ver, es muchísimo.

:::profundo La atención tiene su propia intensidad, y no mejora con el batch
Las capas lineales usan los mismos pesos para todas las conversaciones: por eso el batch las ayuda. La atención es distinta. Cada conversación compara su token nuevo con **su propio** KV cache, que nadie más usa. En Qwen3 32B, por cada token del contexto y en cada uno de sus 64 bloques, las 64 cabezas de consulta hacen ≈ 4 × 128 operaciones contra un juego de K y V que comparten de a 8 ([[gqa|GQA]]). Eso da ≈ 2.1 millones de FLOPs por cada 256 KiB leídos: **≈ 8 FLOPs por byte**, con 1 conversación o con 100.

Si cuentas también esos FLOPs, el tope del despacho sube de ≈ 40 a ≈ 48. Sigue lejísimos de 419. Por eso las mejoras de la atención en los servidores modernos son, sobre todo, mejoras de **cómo se leen** esos bytes, no de cuántas cuentas se hacen.
:::

## Un batch: el mismo paso, varias conversaciones {One batch: the same step, many conversations}

Si el paso está limitado por memoria, su duración es casi exactamente los bytes que lee ÷ el ancho de banda. Un [[batch]] cambia cuántos tokens salen de cada paso, no cuántos pesos se leen. Es la misma cuenta de Sensei para una L4, ahora con los números del despacho y con el reloj del cálculo a la vista, para comprobar que de verdad no manda.

:::formula Un paso de decode con \(b\) conversaciones
t_{mem} = frac{W + b × K}{B_W}
t_{cálc} = frac{2 × P × b}{F}
t_{paso} = max(t_{mem}, t_{cálc})
v_{persona} = frac{1}{t_{paso}}
v_{GPU} = frac{b}{t_{paso}}
- t_{mem}: el reloj de la memoria, en segundos: lo que tarda en leer los bytes del paso
- t_{cálc}: el reloj del cálculo, en segundos: lo que tarda en hacer los FLOPs del paso a su pico
- t_{paso}: lo que dura el paso: el mayor de los dos relojes (lo mínimo posible; en la práctica, un poco más)
- v_{persona}: los tokens por segundo que ve cada persona: uno por paso
- v_{GPU}: los tokens por segundo de toda la GPU
- W, K, b, P, F, B_W: como en la fórmula de la intensidad
:::

:::cuenta El despacho, con 1 y con 8 conversaciones
Una conversación: bytes // \(W + b × K\) con \(b\) = 1 | 19.32 + 1.64 | 20.96 GB
Una: reloj de la memoria, \(t_{mem}\) | 20.96 GB ÷ 864 GB/s | ≈ 24.3 ms
Una: reloj del cálculo, \(t_{cálc}\) | 2 × 32.762 × 10⁹ ÷ 362.05 × 10¹² | ≈ 0.18 ms
Una: tokens por segundo, \(v_{persona} = v_{GPU}\) | 1 ÷ 24.3 ms | ≈ 41
Ocho: bytes // \(b\) = 8, el diseño del despacho | 19.32 + 8 × 1.64 | 32.44 GB
Ocho: reloj de la memoria, \(t_{mem}\) | 32.44 GB ÷ 864 GB/s | ≈ 37.5 ms
Ocho: reloj del cálculo, \(t_{cálc}\) | 2 × 32.762 × 10⁹ × 8 ÷ 362.05 × 10¹² | ≈ 1.45 ms
Ocho: cada persona, \(v_{persona}\) | 1 ÷ 37.5 ms | ≈ 26.6 tokens/s
Ocho: toda la GPU, \(v_{GPU}\) | 8 ÷ 37.5 ms | ≈ 213 tokens/s
= Con 8 a la vez, cada abogado ve ≈ 27 tokens por segundo (arriba de los 20 que pide el despacho) y la GPU da ≈ 5.2 veces más que con una sola. El paso solo se alargó ≈ 1.5 veces.
:::

Detente en esa última línea. Con una conversación, la GPU produce ≈ 41 tokens por segundo y nada más. Con ocho, produce ≈ 213, porque los 19.32 GB de pesos se leen **una** vez por paso para las ocho. El costo de cada conversación extra es solo su KV cache: 1.64 GB más que leer, ≈ 1.9 ms más de paso.

Son números de techo. El paso real dura algo más: ningún programa lee la memoria al 100 % de su ancho de banda, y hay más cosas que leer y escribir (las activaciones, por ejemplo). Las mediciones de Databricks y NVIDIA dicen lo mismo con otras palabras: con batches chicos, la velocidad de generación la predice el ancho de banda, no el pico de cálculo. Aquí la cuenta te da la **forma** de la relación; las cifras de verdad las da medir.

:::calculadora batching-paso
Empieza con las 8 conversaciones del despacho. Baja a 1 y sube a 13: con 13 cada persona todavía ve ≈ 21 tokens por segundo, y es lo último que cabe en la VRAM con ese KV cache. Pasa de 13 y el veredicto de abajo dice que ya no caben.
:::

La calculadora también responde una pregunta que el despacho se hace: **¿cuántas personas a la vez aguanta con al menos 20 tokens por segundo cada una?** Por velocidad, el paso puede durar hasta 50 ms, y eso deja 14 conversaciones. Por memoria, solo caben 13 de ≈ 6,250 tokens. **La memoria se acaba antes que la velocidad.** Es lo que pasa casi siempre, y por eso la segunda mitad de esta lección es sobre memoria.

### La misma cuenta, en Python

```python
W, P = 19.32e9, 32.762e9          # Qwen3 32B en INT4 de AWQ: bytes de pesos y parámetros
K = 6250 * 262144                  # KV cache de una conversación a media respuesta, en bytes
BW, F = 864e9, 362.05e12           # L40S: bytes/s de memoria y FLOPs/s densos en FP16

print(f"{'b':>4}{'paso ms':>9}{'tok/s c/u':>11}{'tok/s GPU':>11}{'FLOPs/B':>9}  manda")
for b in (1, 2, 4, 8, 13, 16, 64):
    t_mem = (W + b * K) / BW       # leer pesos una vez y el KV de cada una
    t_calc = 2 * P * b / F         # 2 FLOPs por parámetro por conversación
    t = max(t_mem, t_calc)
    manda = "memoria" if t_mem >= t_calc else "cálculo"
    print(f"{b:>4}{t*1e3:>9.2f}{1/t:>11.1f}{b/t:>11.0f}{2*P*b/(W+b*K):>9.1f}  {manda}")
```

```salida
   b  paso ms  tok/s c/u  tok/s GPU  FLOPs/B  manda
   1    24.26       41.2         41      3.1  memoria
   2    26.15       38.2         76      5.8  memoria
   4    29.95       33.4        134     10.1  memoria
   8    37.53       26.6        213     16.2  memoria
  13    47.01       21.3        277     21.0  memoria
  16    52.70       19.0        304     23.0  memoria
  64   143.72        7.0        445     33.8  memoria
```

Lee la tabla de arriba abajo. La columna de la GPU crece rápido al principio y luego se aplana: de 1 a 8 conversaciones se multiplica por 5; de 16 a 64, apenas por 1.5. La columna de cada persona baja todo el tiempo. Es el intercambio de siempre entre lo que produce el servidor y lo que ve cada usuario: con muchas conversaciones, la GPU rinde mucho y cada persona espera más. Cómo se ve esa curva cuando llegan usuarios de verdad, con sus tiempos al primer token (TTFT) y entre tokens (TPOT), lo ves a fondo en la lección de concurrencia. Aquí solo importa el mecanismo: **juntar conversaciones casi no cuesta porque los pesos se leen una vez**. (Las filas de 16 y 64 son de mentira: no caben en la VRAM. La tabla solo mira el tiempo.)

## Batching estático: esperar al más largo {Static batching: waiting for the longest}

Saber que juntar conversaciones es casi gratis es la mitad. La otra mitad es **cómo** juntarlas cuando llegan en momentos distintos y piden respuestas de largos distintos.

La primera forma que se le ocurre a cualquiera es la de los modelos clásicos, la que Sensei cuenta en [Latencia y throughput](https://sensei.trueml.app/latencia/) con el *dynamic batching*: juntar las peticiones que llegan casi juntas, calcularlas en un solo batch y devolver los resultados. Para clasificar fotos funciona, porque todas tardan lo mismo: una pasada por la red.

Con un LLM, no. Cada respuesta es una **serie** de pasadas, una por token, y unas respuestas tienen 50 tokens y otras 1,000. Si armas un batch y no lo tocas hasta que todas terminan, tienes [[batching-estatico|batching estático]]:

- **El batch dura lo que la respuesta más larga.** Las que acaban antes dejan su lugar vacío: la GPU sigue leyendo los pesos para menos conversaciones de las que podría atender.
- **Las peticiones nuevas esperan afuera.** Aunque haya lugares libres, nadie entra hasta que acabe la tanda.
- **Hay relleno** (*padding*). Las implementaciones ingenuas guardan todas las secuencias del batch con el mismo largo, el del prompt más largo y la respuesta más larga, y rellenan las cortas con tokens que no significan nada. Es memoria y trabajo tirados.

:::figura batching-estatico-continuo
Cuatro lugares de un batch durante 500 pasos. Arriba, estático: el batch dura lo que la respuesta de 500 tokens y casi la mitad de los lugares-paso quedan vacíos. Abajo, continuo: cada lugar que se libera lo toma otra conversación en el siguiente paso.
:::

:::formula Lugares aprovechados con batching estático
u = frac{sum_{i=1}^{b} n_i}{b × max(n_i)}
- n_i: los tokens que escribe la respuesta \(i\) del batch
- b: las conversaciones del batch
- max(n_i): la respuesta más larga, que decide cuántos pasos dura el batch
- u: la fracción de lugares-paso que hacen trabajo útil (1 = todos)
:::

:::cuenta Cuatro respuestas de largos distintos
Tokens útiles, \(sum n_i\) // respuestas de 500, 200, 350 y 100 tokens | 500 + 200 + 350 + 100 | 1,150
Lugares-paso, \(b × max(n_i)\) // \(b\) = 4, la más larga escribe 500 | 4 × 500 | 2,000
Aprovechado, \(u\) | 1,150 ÷ 2,000 | **57.5 %**
= Más de 4 de cada 10 lugares-paso leen los pesos para nadie. Y las peticiones que llegaron mientras tanto esperaron hasta 500 pasos sin necesidad.
:::

En el despacho las respuestas rondan los 500 tokens, pero no todas: un «sí, la cláusula 14 lo prohíbe» son 30 tokens; un resumen de expediente pueden ser 1,500. Con batching estático, la respuesta corta espera a la larga **para soltar su lugar**, y la abogada que llegó un segundo después espera a las dos.

Hay un segundo problema, menos visible: ¿cuánto esperas para armar el batch? Si esperas a juntar 8, la primera petición espera a la octava. Si no esperas, el batch sale con 1 o 2 y desperdicias la GPU. En los modelos clásicos se resuelve con un tope de espera de milisegundos. En un LLM, donde cada petición vive decenas de segundos, cualquier tope es malo.

## Batching continuo: decidir en cada paso {Continuous batching: deciding at every step}

La salida fue cambiar **cuándo** se decide quién va en el batch. En vez de decidir una vez por tanda, se decide **antes de cada paso**. Eso es el [[batching-continuo|batching continuo]] (*continuous batching*), que el paper de Orca (Yu y otros, OSDI 2022) llamó *iteration-level scheduling*: planificar a la escala de una iteración, un paso del modelo, no de una petición completa.

La regla es simple:

1. Antes de cada paso, se miran las conversaciones que terminaron en el paso anterior (escribieron su token de fin o llegaron a su tope) y se sacan.
2. Se miran los lugares libres y la memoria libre, y se meten conversaciones nuevas de la fila.
3. Se corre el paso con las que quedaron: cada una recibe su token.

Quien toma esas decisiones es el [[scheduler]] (planificador) del servidor de inferencia. No es un programa aparte: es un pedazo del servidor que corre entre paso y paso, en la CPU, y que tiene que ser rapidísimo, porque un paso dura decenas de milisegundos.

:::diagrama batching-scheduler
Toca cada caja para ver por qué está ahí. El recorrido sigue a una petición del despacho: llega, entra en el siguiente paso sin esperar a nadie, y otra que termina libera su lugar.
:::

### Un paso con conversaciones en momentos distintos

Hay un detalle que hace que esto no sea trivial. En un mismo paso conviven conversaciones en momentos muy distintos: una recién llegada necesita su **prefill** (leer sus 6,000 tokens de golpe), y las demás solo necesitan **un** token de decode. Unas tienen 6,100 tokens de contexto y otras 6,450. Esas diferencias complican juntar todo en una sola multiplicación.

Orca lo resolvió con lo que llamó *selective batching* (batching selectivo): las capas lineales, donde todas las conversaciones usan los mismos pesos, se calculan juntas, aplanando todos sus tokens en una sola matriz; la atención, donde cada conversación tiene su propio largo y su propio KV cache, se calcula por separado para cada una. Las capas lineales son las que leen los pesos, así que ahí está el ahorro.

### Lo que cambia

Con batching continuo:

- **Nadie espera a la más larga.** Una respuesta corta suelta su lugar en cuanto termina.
- **Las peticiones nuevas entran en el siguiente paso**, no en la siguiente tanda: decenas de milisegundos de espera en vez de decenas de segundos.
- **No hace falta un tope de espera para armar el batch.** El batch se arma solo, con lo que haya en cada paso.

Las cifras publicadas son grandes. Orca reportó **36.9 veces** más throughput que FasterTransformer de NVIDIA a la misma latencia, con GPT-3 175B. Un artículo de Anyscale de 2023 midió hasta **23 veces** más throughput que el batching estático ingenuo de Hugging Face, con OPT-13B en una A100 de 40 GB; de eso, ≈ 8 veces salían solo del batching continuo y el resto de cuidar la memoria con vLLM. Son comparaciones contra líneas base débiles, en condiciones de cada paper: no esperes 36 veces en tu servidor. Pero la dirección es inequívoca, y hoy todos los servidores de LLMs serios lo hacen.

### La misma idea, simulada

Este programa simula 200 respuestas de largos al azar (de 50 a 1,000 tokens) en un batch de 8 lugares, de las dos formas, y cuenta pasos.

```python
import random
random.seed(7)
largos = [random.randint(50, 1000) for _ in range(200)]   # tokens que escribe cada respuesta
B = 8                                                     # lugares en el batch

# estático: tandas de 8; cada tanda dura lo que su respuesta más larga
pasos_est = sum(max(largos[i:i + B]) for i in range(0, len(largos), B))

# continuo: en cuanto un lugar se libera, entra la siguiente de la fila
fila, lugares, pasos_cont = list(largos), [], 0
while fila or lugares:
    while fila and len(lugares) < B:
        lugares.append(fila.pop(0))
    pasos_cont += 1
    lugares = [r - 1 for r in lugares if r > 1]           # un token a cada una

util = sum(largos)
print("tokens útiles:", util)
print(f"estático: {pasos_est} pasos, lugares usados {util / (pasos_est * B):.1%}")
print(f"continuo: {pasos_cont} pasos, lugares usados {util / (pasos_cont * B):.1%}")
print(f"el continuo termina en {pasos_cont / pasos_est:.0%} de los pasos")
```

```salida
tokens útiles: 97957
estático: 21790 pasos, lugares usados 56.2%
continuo: 12590 pasos, lugares usados 97.3%
el continuo termina en 58% de los pasos
```

Con los mismos 8 lugares y las mismas 200 respuestas, el batching continuo usa el 97 % de los lugares y termina en poco más de la mitad de los pasos. La simulación no mete la llegada de peticiones a lo largo del tiempo ni el prefill; con ellos, la diferencia en lo que espera cada persona es todavía mayor.

## El otro límite: la memoria del KV cache {The other limit: KV cache memory}

El batching continuo deja meter conversaciones en cuanto hay lugar. Pero «lugar» no es solo un número de asientos: cada conversación necesita memoria para su KV cache, y **crece un token por paso**. Una respuesta de 500 tokens del despacho empieza ocupando 6,000 tokens de KV y termina con 6,500. El servidor no sabe de antemano cuánto va a escribir.

La herramienta [¿Cabe en la GPU?](/herramientas/vram/) hizo la cuenta del despacho: de los 43.2 GB útiles de la L40S, 19.32 se van en pesos y 2 en el programa. Quedan **21.88 GB** para el KV cache. Con 256 KiB por token, eso son ≈ 83,000 tokens en total, a repartir entre todas las conversaciones.

### Reservar el máximo

Antes de PagedAttention, los servidores guardaban el KV cache de cada conversación en un pedazo **continuo** de memoria, como un arreglo. Y como no sabían cuánto iba a crecer la respuesta, le **reservaban el máximo** desde el principio: en el despacho, 8,192 tokens, el tope de contexto, aunque la conversación vaya a usar 6,500. Es como apartar una mesa para 12 en un restaurante porque no sabes cuántos amigos van a llegar.

Esa reserva desperdicia memoria de tres formas, que el paper de PagedAttention llama [[fragmentacion|fragmentación]]:

- **Reservada** (*reserved*): lugares apartados para los tokens que la respuesta todavía no escribe. Se van a usar, pero mientras tanto nadie más puede usarlos.
- **Interna** (*internal fragmentation*): lugares apartados que nunca se van a usar, porque la conversación terminó antes del máximo.
- **Externa** (*external fragmentation*): los huecos que quedan **entre** reservas cuando unas terminan y otras empiezan, y que son demasiado chicos para que quepa una conversación nueva entera, aunque sumados sí alcanzarían.

¿Cuánto es eso? El paper midió que en los sistemas de entonces **solo entre el 20.4 % y el 38.2 % de la memoria del KV cache guardaba tokens de verdad**. El resto, más del 60 %, estaba reservado, sobrado o hecho huecos.

:::formula Cuántas conversaciones caben, con reserva fija y con bloques
c_{fija} = ⌊ frac{M_{KV}}{N_{máx} × m} ⌋
c_{bloques} = ⌊ frac{M_{KV}}{⌈N_{real} ÷ s⌉ × s × m} ⌋
- M_{KV}: la VRAM libre para el KV cache, en bytes
- m: lo que ocupa un token de KV cache, en bytes
- N_{máx}: el contexto máximo que se reserva por conversación, en tokens
- N_{real}: los tokens que la conversación tiene de verdad en ese momento
- s: el tamaño de bloque, en tokens (sección siguiente)
- ⌈ ⌉: redondear hacia arriba; ⌊ ⌋: hacia abajo
- c_{fija}, c_{bloques}: cuántas conversaciones caben de cada forma
:::

:::cuenta El despacho: reservar 8,192 o usar lo que se usa
Con reserva fija, \(c_{fija}\) // \(M_{KV}\) = 21.88 GB, \(N_{máx}\) = 8,192, \(m\) = 262,144 bytes | ⌊21.88 × 10⁹ ÷ (8,192 × 262,144)⌋ = ⌊10.19⌋ | 10
Bloques por conversación // \(N_{real}\) = 6,250 a media respuesta, \(s\) = 16 | ⌈6,250 ÷ 16⌉ | 391 bloques = 6,256 tokens
Con bloques, \(c_{bloques}\) | ⌊21.88 × 10⁹ ÷ (6,256 × 262,144)⌋ = ⌊13.34⌋ | 13
Aprovechado con reserva fija | 6,250 ÷ 8,192 | 76 %
Aprovechado con bloques | 6,250 ÷ 6,256 | 99.9 %
= En el despacho, repartir en bloques deja pasar de 10 a 13 conversaciones: 30 % más, con la misma GPU.
:::

Treinta por ciento es mucho, pero menos que lo del paper. La razón es el despacho mismo: sus preguntas traen 6,000 tokens de entrada, así que cada conversación ya llena el 73 % del tope desde el primer paso. En un chat corriente, con prompts de cien tokens y respuestas de unos cientos, la reserva del máximo es casi toda aire. Pruébalo abajo.

:::calculadora batching-desperdicio
Arranca con el despacho: 10 contra 13. Pon el largo real en 1,000 tokens, como un chat corto: con reserva fija siguen cabiendo 10; con bloques, 82. Después cambia el tamaño de bloque y mira que casi no cambia nada.
:::

Fíjate en qué cambió el límite. En la sección anterior la pregunta era «¿cuántas conversaciones aguanta la GPU en tiempo?». Ahora es «¿cuántas le caben en memoria?». Con batching continuo, el scheduler mete conversaciones mientras haya memoria. Así que **cada byte de KV cache que no se desperdicia es una conversación más en el batch**, y cada conversación más es, como viste, casi gratis en tiempo.

## PagedAttention: la memoria en bloques {PagedAttention: memory in blocks}

[[pagedattention|PagedAttention]] (Kwon y otros, SOSP 2023) es la idea detrás de vLLM. Cambia una sola cosa: **el KV cache de una conversación ya no tiene que estar junto**.

### Bloques y una tabla

La memoria del KV cache se parte en [[bloque-kv|bloques]] (*blocks*) de tamaño fijo, cada uno con el K y el V de unos cuantos tokens: 16 en el paper. Una conversación empieza con los bloques que necesita su prompt y, cuando llena el último, pide **uno** más. Los bloques que le tocan pueden estar en cualquier parte de la VRAM: el 7, luego el 1, luego el 12.

Para saber dónde está cada pedazo, cada conversación tiene su [[tabla-de-bloques|tabla de bloques]] (*block table*): «mi bloque lógico 0 está en el bloque físico 7, el 1 en el 1, el 2 en el 12». El kernel de atención, el programa de la GPU que calcula la atención, lee esa tabla en cada paso y va a buscar el K y el V de cada token a donde estén. De ahí el nombre: es atención que sabe leer memoria en páginas.

:::figura batching-bloques
Dos conversaciones vistas como las ve el modelo (bloques lógicos seguidos) y como están en la VRAM (bloques físicos salteados). Solo el último bloque de cada una tiene lugares vacíos.
:::

Con eso, las tres fragmentaciones casi desaparecen:

- **Reservada:** no se aparta nada para el futuro. Se pide un bloque cuando hace falta.
- **Interna:** lo único que sobra es el final del último bloque de cada conversación: a lo mucho 15 tokens.
- **Externa:** no existe, porque todos los bloques son del mismo tamaño. Cualquier bloque libre le sirve a cualquier conversación.

El paper lo resume como desperdicio «casi cero» (*near-zero waste*). La mecánica sí la puedes calcular: el desperdicio es, en promedio, medio bloque por conversación.

:::cuenta Los bloques del despacho
Un bloque // \(s\) = 16 tokens, 256 KiB por token de Qwen3 32B en BF16 | 16 × 262,144 bytes | 4,194,304 bytes = 4 MiB
Una conversación al tope // 8,192 tokens | 8,192 ÷ 16 | 512 bloques = 2 GiB ≈ 2.15 GB
Bloques en la VRAM libre // \(M_{KV}\) = 21.88 GB | ⌊21.88 × 10⁹ ÷ 4,194,304⌋ | 5,216 bloques
Tokens que caben en total | 5,216 × 16 | 83,456 tokens
Desperdicio promedio por conversación // medio bloque: 8 tokens | 8 × 262,144 bytes | ≈ 2 MiB, el 0.1 % de 1.64 GB
= Los 21.88 GB libres son 5,216 bloques de 4 MiB. Cada conversación toma los que necesita y tira, en promedio, 2 MiB.
:::

### La analogía del sistema operativo, y dónde se rompe

PagedAttention se inspira, a propósito, en la **memoria virtual** de los sistemas operativos. Un programa en tu computadora cree que su memoria es un arreglo continuo; en realidad el sistema operativo la parte en páginas de unos KiB y las pone donde haya lugar en la RAM, con una tabla de páginas que traduce cada dirección. Aquí, cada conversación es el programa, los bloques son las páginas y la tabla de bloques es la tabla de páginas.

:::analogia El estacionamiento sin lugares apartados
Un estacionamiento que aparta 12 cajones seguidos a cada empresa, por si acaso, se llena con coches imaginarios. Uno donde cada coche toma el cajón libre que haya y una libreta anota dónde quedó cada uno se llena con coches de verdad. La libreta es la tabla de bloques.

Dónde se rompe: en el sistema operativo, la traducción la hace el hardware (la MMU del procesador) sin que el programa se entere, y las páginas que no caben se mandan al disco solas. En la GPU no hay nada de eso: la traducción la hace a mano el kernel de atención, en cada paso, y tuvo que escribirse de nuevo para saltar de bloque en bloque. Saltar cuesta un poco: los bloques demasiado chicos (de 1 o 2 tokens) hacen que la GPU lea pedacitos dispersos y vaya más lento. Por eso el bloque no es de un token: el paper eligió 16 por ser «lo bastante grande para aprovechar la GPU y lo bastante chico para no desperdiciar mucho».
:::

Los resultados del paper, con OPT-13B en una A100 de 40 GB: vLLM sostuvo entre **1.7 y 2.7 veces** más peticiones por segundo que la mejor variante de Orca (una que conoce de antemano el largo de cada respuesta, cosa imposible en la vida real) y entre **2.7 y 8 veces** más que la variante que reserva el máximo, con latencias parecidas. En un momento dado, procesaba ≈ **2.2 veces** más peticiones a la vez que la mejor Orca. La mejora es mayor con secuencias más largas y modelos más grandes: justo el caso del despacho.

## Compartir bloques: prefix caching y copy-on-write {Sharing blocks: prefix caching and copy-on-write} [extra]

Una vez que el KV cache está en bloques con una tabla, aparece un regalo: **dos conversaciones pueden apuntar al mismo bloque físico**. Si el principio de sus prompts es idéntico, su K y su V también lo son, token por token. No hace falta calcularlos ni guardarlos dos veces.

### Prefix caching

Cada pregunta del despacho empieza con las mismas ≈ 400 tokens de instrucciones: quién es el asistente, que cite el expediente y la página, que no invente. Sin compartir, cada una de las 8 conversaciones calcula esas 400 en su prefill y las guarda en su KV cache.

Con [[prefix-caching|prefix caching]] (en vLLM, *automatic prefix caching*), el servidor guarda los bloques ya calculados con una **llave**: un hash de los tokens del bloque y de **todos** los anteriores. Encadenar el hash con lo anterior importa: el mismo pedazo de texto en otra posición, o después de otro principio, tiene K y V distintos y no debe confundirse. Cuando llega una pregunta nueva, el servidor calcula las llaves de sus bloques y busca: si están, su tabla apunta a ellos y su prefill se salta esos tokens.

Dos detalles de vLLM, de su documentación: solo guarda **bloques llenos**, y cuando falta memoria tira primero los bloques guardados que llevan más tiempo sin usarse (LRU). En la versión 0.34.0 viene prendido por omisión.

```python
import hashlib

S = 16                                         # tokens por bloque
def hashes(tokens):
    """Un hash por bloque LLENO: el del bloque anterior más los tokens de este."""
    previo, salida = "", []
    for i in range(0, len(tokens) - len(tokens) % S, S):
        previo = hashlib.sha256((previo + str(tokens[i:i + S])).encode()).hexdigest()
        salida.append(previo)
    return salida

instrucciones = list(range(400))               # las ≈ 400 tokens iguales en cada pregunta
pregunta_1 = instrucciones + [7] * 5600        # + pregunta y fragmentos de un expediente
pregunta_2 = instrucciones + [9] * 5600        # + otros fragmentos

cache = set(hashes(pregunta_1))
h2 = hashes(pregunta_2)
aciertos = sum(1 for h in h2 if h in cache)
print("bloques llenos de la pregunta 2:", len(h2))
print("bloques que ya estaban:", aciertos, "=", aciertos * S, "tokens sin prefill")
print(f"KV que no se duplica: {aciertos * S * 262144 / 1e6:.1f} MB")
```

```salida
bloques llenos de la pregunta 2: 375
bloques que ya estaban: 25 = 400 tokens sin prefill
KV que no se duplica: 104.9 MB
```

Para el despacho, el ahorro de las instrucciones es real pero chico: 400 de 6,000 tokens de prefill (≈ 7 %), y ≈ 105 MB por conversación, ≈ 0.73 GB entre las 8. Donde el prefix caching brilla es en la **repregunta**. La ficha del despacho deja lugar para una pregunta corta después de la primera respuesta, y esa segunda petición empieza con las ≈ 6,500 tokens de la primera conversación completa. Con prefix caching, su prefill solo calcula la repregunta: unas decenas de tokens en vez de 6,600. Es la diferencia entre esperar más de un segundo y casi nada.

Un detalle que muerde: como solo se guardan bloques llenos, el tamaño de bloque importa. 400 tokens son exactamente 25 bloques de 16. Con bloques de 64, son 6 bloques llenos (384 tokens) y los últimos 16 se recalculan cada vez.

SGLang, otro servidor, lleva la idea más lejos con *RadixAttention*: guarda los KV de prompts **y** respuestas en un árbol (un *radix tree*) con páginas de un solo token, para reutilizar cualquier prefijo común, y ordena las peticiones para aprovecharlo. Lo ves con los servidores en su propia lección.

:::profundo Copy-on-write: varias respuestas al mismo prompt
A veces una sola petición pide **varias** respuestas al mismo prompt (*parallel sampling*), o el servidor explora varias continuaciones a la vez (*beam search*). Todas comparten el prompt, y PagedAttention lo aprovecha con [[copy-on-write]]: cada bloque físico lleva un **contador** de cuántas secuencias lo usan. Mientras solo se lee, nadie copia nada. Cuando una de las secuencias necesita escribir un token distinto en un bloque compartido (el último, a medio llenar), recibe una copia propia **de ese bloque** y su contador baja.

Es exactamente lo que hace un sistema operativo cuando un proceso se duplica (*fork*): las páginas se comparten hasta que alguno escribe. El paper midió ahorros de memoria de 6.1–9.8 % (parallel sampling, prompts del dataset Alpaca) a 37.6–66.3 % (beam search), según la tarea; su introducción habla de «hasta 55 %». En el despacho no se piden varias respuestas por pregunta, así que aquí casi no aplica; en un asistente que propone tres redacciones de una cláusula, sí.
:::

:::diagrama batching-memoria
El gestor de bloques reparte la memoria. Dos recorridos: una pregunta que reutiliza los bloques de las instrucciones, y un momento en que ya no queda ningún bloque libre.
:::

## Cuando no cabe: preemption {When it doesn't fit: preemption}

PagedAttention no reserva el futuro, y eso tiene un precio: el servidor puede quedarse sin bloques **a media respuesta**. Imagina 13 conversaciones del despacho en el batch, todas escribiendo. Cada 16 tokens, cada una pide un bloque. Si en ese paso no queda ninguno, alguien tiene que salir.

Eso es la [[preemption]] (desalojo): el scheduler saca del batch una conversación que va a medias, libera sus bloques para que las demás sigan, y la retoma cuando vuelva a haber memoria. vLLM tiene dos formas de hacerlo:

- **Swap.** Copiar los bloques de esa conversación a la RAM de la CPU y, al retomarla, traerlos de vuelta. No se pierde trabajo, pero mover gigabytes entre la CPU y la GPU cuesta tiempo y ocupa RAM.
- **Recompute.** Tirar sus bloques y, al retomarla, recalcular su KV cache desde el texto que ya tiene, con un prefill. Se repite trabajo, pero el prefill es justo la parte en que la GPU calcula rápido. **Es lo que vLLM hace por omisión**: su documentación dice que en el motor actual tiene menos costo extra que el swap.

Para el despacho, recomputar una conversación que iba en 6,250 tokens es hacer otra vez un prefill de 6,250: a pico de cálculo, más de un segundo de GPU (lo calculas en la sección de chunked prefill).

### Qué ve el usuario

Para la persona cuya conversación salió, la respuesta **se congela**: los tokens dejan de llegar uno, dos o varios segundos, y luego siguen como si nada. No se pierde la respuesta ni sale distinta. Para las demás, nada cambia. En el registro del servidor aparece un aviso como este (de la documentación de vLLM):

```
Sequence group 0 is preempted by PreemptionMode.RECOMPUTE mode because there is not enough KV cache space.
```

Un aviso de vez en cuando en la hora pico es normal: es el servidor estirando la memoria al máximo. Muchos seguidos quieren decir que el servidor está metiendo más conversaciones de las que le caben, y cada preemption es trabajo repetido. Los remedios que da la documentación de vLLM: darle más memoria al KV cache (el parámetro `gpu_memory_utilization`), bajar el máximo de conversaciones a la vez (`max_num_seqs`) o de tokens por paso (`max_num_batched_tokens`), o repartir el modelo entre más GPUs (eso es la lección «Varias GPUs: tensor y pipeline parallel»).

:::ojo
La preemption no es un error ni un mensaje que haya que apagar. Es la consecuencia directa de no reservar el máximo: a cambio de meter 13 conversaciones donde con reserva cabían 10, a veces una tiene que esperar. Si en el despacho aparece seguido, la respuesta no es «subir el límite», es medir: ¿cuántas conversaciones a la vez hay de verdad en la hora pico, y cuánto contexto traen?
:::

## Chunked prefill: que una pregunta larga no frene a las demás {Chunked prefill: so one long prompt doesn't stall the rest} [extra]

Hasta aquí casi todo ha sido decode. Pero en el despacho cada pregunta trae **6,000 tokens** de prefill, y ese prefill tiene que hacerse en algún paso, junto con el decode de las demás.

El prefill es lo opuesto al decode: procesa miles de tokens con una sola lectura de los pesos, así que su intensidad es altísima (≈ 20,000 FLOPs por byte en el despacho) y **manda el cálculo**. Un paso con un prefill entero dura lo que tardan sus cuentas.

:::formula Lo que tarda un prefill
t_{prefill} ≥ frac{2 × P × n}{F}
- n: los tokens del prompt que se procesan en el paso
- P, F: los parámetros del modelo y el pico de la GPU, en FLOPs por segundo
- t_{prefill}: el tiempo mínimo del paso, en segundos (sin contar la atención ni la eficiencia real de la GPU, que lo alargan)
:::

:::cuenta Un prefill de 6,000 tokens en la L40S
FLOPs // \(P\) = 32.762 mil millones, \(n\) = 6,000 tokens | 2 × 32.762 × 10⁹ × 6,000 | ≈ 393 × 10¹²
Tiempo mínimo, \(t_{prefill}\) // \(F\) = 362.05 TFLOPS | 393 × 10¹² ÷ 362.05 × 10¹² | **≥ 1.09 s** (DERIVADO)
Un paso de decode normal, con 8 // de la sección del batch | (19.32 + 8 × 1.64) GB ÷ 864 GB/s | ≈ 37.5 ms
= Si el prefill entra entero en un paso, las otras 7 conversaciones dejan de recibir tokens durante más de un segundo: unos 29 pasos de decode de golpe.
:::

Para la abogada que preguntó, ese segundo es su tiempo al primer token. Para las otras siete, es un tirón: su texto venía saliendo fluido y se detiene un segundo cada vez que alguien hace una pregunta nueva. En la hora pico del despacho llega una pregunta cada ≈ 5 segundos: tirones seguidos.

### Partirlo en trozos

La solución es el [[chunked-prefill|chunked prefill]] (prefill en trozos): no hacer el prefill entero en un paso, sino un **trozo** por paso, y en cada paso meter primero el decode de todas las demás. El tope de tokens por paso lo da el parámetro `max_num_batched_tokens`: en vLLM 0.34.0, en una GPU de menos de 70 GiB como la L40S, **2,048** por omisión en el servidor compatible con OpenAI. Si en el batch hay 7 conversaciones en decode, cada paso lleva sus 7 tokens y 2,041 del prefill nuevo.

:::cuenta El mismo prefill, en trozos de ≈ 2,041 tokens
Trozos // 6,000 tokens; cada paso: 2,048 − 7 decodes | 2,041 + 2,041 + 1,918 | 3 pasos
Cada paso con un trozo // a pico de cálculo, con \(n\) = 2,048 | 2 × 32.762 × 10⁹ × 2,048 ÷ 362.05 × 10¹² | ≈ 0.37 s
= En vez de un tirón de más de 1 s, las demás reciben un token cada ≈ 0.37 s durante 3 pasos. Con trozos más chicos (512 tokens), cada tirón baja a ≈ 0.09 s, a cambio de que el prefill tarde más pasos.
:::

La documentación de vLLM lo dice como regla de afinación: valores chicos de `max_num_batched_tokens` (como 2,048) dan **mejor latencia entre tokens**, porque hay menos prefill frenando a los decodes; valores grandes dan **mejor tiempo al primer token**, porque cada prefill termina en menos pasos. No hay un valor correcto: es un intercambio, y lo decides con los objetivos del despacho (≤ 2 s al primer token, ≥ 20 tokens por segundo por persona) y midiendo.

Las cifras publicadas vienen de SARATHI (2023), que propuso armar lotes con un trozo de prefill y el resto decodes, y de Sarathi-Serve (OSDI 2024), que agregó planificar sin pausar nunca los decodes en curso (*stall-free scheduling*): con un objetivo de latencia de cola, Sarathi-Serve atendió **2.6 veces** más con Mistral-7B en una A100 que vLLM de entonces, y hasta **3.7 veces** con Yi-34B en dos A100. Hoy vLLM trae el chunked prefill **prendido por omisión** «cuando es posible».

## Lo que imprime el servidor y sus perillas {What the server prints and its knobs} [extra]

El servidor vLLM tiene su propia lección («Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM»). Aquí solo lo que toca a esta: cómo leer lo que dice al arrancar y qué perillas mueven lo que viste.

### La línea que hay que buscar

Al arrancar, vLLM mide la memoria, carga los pesos y reparte lo que sobra en bloques. Luego imprime una línea con este formato (del código de la versión 0.34.0):

```
GPU KV cache size: <tokens> tokens, Maximum concurrency for <max_model_len> tokens per request: <x>x
```

El primer número son los tokens de KV cache que caben (bloques × tokens por bloque). El segundo es ese número dividido entre el contexto máximo por petición (`max_model_len`): cuántas conversaciones **al tope** caben a la vez. Para el despacho, con los 21.88 GB libres de la cuenta de la herramienta de VRAM, la línea diría algo como «83,456 tokens» y «10.19x» para 8,192 tokens por petición. Ojo con leer mal ese 10.19: no es el máximo de conversaciones. Es cuántas caben **si todas llegaran al tope**. Con PagedAttention, si las conversaciones reales usan menos, caben más, como viste (13 a media respuesta).

### Las perillas

| Perilla de vLLM | Qué controla | Valor por omisión en la v0.34.0 |
|---|---|---|
| `max_num_seqs` | Cuántas conversaciones a lo mucho van en el batch | 256 en GPUs de menos de 70 GiB como la L40S (1,024 en H100 y H200) |
| `max_num_batched_tokens` | Cuántos tokens a lo mucho procesa un paso, sumando decodes y trozos de prefill | 2,048 en el servidor en GPUs de menos de 70 GiB (8,192 en H100 y H200) |
| `gpu_memory_utilization` | Qué parte de la VRAM puede usar vLLM; lo que sobre de pesos y programa va al KV cache | 1.0 con el KV cache extensible (lo usual en CUDA), 0.92 si no; antes era 0.9 |
| `block_size` | Tokens por bloque de KV cache | 64 en la configuración; el backend de atención puede cambiarlo (el paper usaba 16) |
| `enable_chunked_prefill` | Prefill en trozos | prendido |
| `enable_prefix_caching` | Reutilizar bloques de prefijos | prendido |

Tres lecturas para el despacho:

- **`max_num_seqs` = 256 no es su límite.** Con su memoria caben ≈ 13 conversaciones; el límite real es el KV cache, y lo pone el gestor de bloques, no esta perilla. Bajarla sirve para proteger la velocidad por persona: con 13, cada una ve ≈ 21 tokens por segundo; sin tope, el servidor metería todas las que le quepan.
- **`gpu_memory_utilization` cambió entre versiones.** La herramienta de VRAM usa un margen del 10 % (el 0.9 de antes); la versión 0.34.0 usa otra regla. Lo que importa es fijar el valor a mano, anotarlo y confirmar con la línea de arranque cuánto KV cache quedó.
- **El tamaño de bloque efectivo hay que verlo, no suponerlo.** Cambia entre versiones y según el backend de atención. Para lo que cuenta esta lección (el desperdicio por conversación) da casi igual: con 64 tokens, el último bloque desperdicia en promedio 32 tokens, 8 MiB, todavía menos del 1 %.

:::ojo
Estos valores son de vLLM 0.34.0 (publicada el 16 de noviembre de 2026) y **cambian entre versiones**: `gpu_memory_utilization`, `block_size` y los topes por omisión ya cambiaron antes. Antes de fijar algo, lee la documentación de la versión que vas a instalar y lo que imprime al arrancar.
:::

## Errores comunes {Common mistakes}

1. **Medir con una sola persona y multiplicar.** «Con una conversación da 41 tokens por segundo; para 8 personas necesito 8 GPUs». Falso: con 8 en batch, la misma GPU da ≈ 213 y cada persona ≈ 27. **Cómo evitarlo:** mide o calcula con el batch que vas a tener, \(t_{paso} = (W + b × K) ÷ B_W\).
2. **Comprar TFLOPS para el decode.** Si el decode espera a la memoria, una GPU con el doble de cálculo y el mismo ancho de banda escribe casi igual de rápido. **Cómo evitarlo:** compara GB/s para el decode y TFLOPS para el prefill; mira de qué lado del quiebre estás.
3. **Olvidar el KV cache en el tiempo del paso.** Con contextos de 6,000 tokens, ocho KV caches pesan ≈ 13 GB por paso, dos tercios de los pesos. **Cómo evitarlo:** suma \(b × K\) a los bytes, no solo los pesos.
4. **Leer «Maximum concurrency» como el máximo de usuarios.** Es cuántas conversaciones **al tope de contexto** caben; con conversaciones más cortas caben más, y con usuarios que piensan entre pregunta y pregunta, muchos más usuarios registrados. **Cómo evitarlo:** divide los tokens de KV cache entre el largo **real** de tus conversaciones, y deja lo de usuarios para la lección de concurrencia.
5. **Apagar el prefix caching «para que sea más simple».** En un sistema con instrucciones fijas y repreguntas, como el despacho, es tiempo de prefill y memoria regalados. **Cómo evitarlo:** déjalo prendido, pon las partes fijas del prompt **al principio**, siempre iguales y en el mismo orden (un espacio distinto cambia el hash).
6. **Tratar la preemption como un error que se esconde.** Si aparece seguido, el servidor está repitiendo prefills y algunas personas ven respuestas congeladas. **Cómo evitarlo:** cuéntala en el monitoreo y, si es frecuente, baja `max_num_seqs` o consigue más memoria para el KV cache.
7. **Copiar perillas de un blog de otra versión.** Los valores por omisión de vLLM han cambiado varias veces. **Cómo evitarlo:** fíjalos a mano, con la documentación de tu versión, y anota la versión junto a la configuración.

## En la vida real {In real life}

**El despacho.** Qwen3 32B en INT4 de AWQ en una L40S. Con batching continuo y PagedAttention, la cuenta de techo dice que caben ≈ 13 conversaciones a media respuesta y que, con 8, cada abogado ve ≈ 27 tokens por segundo: el diseño de 8 a la vez cumple, con algo de holgura. Tres decisiones salen de esta lección: dejar prendido el prefix caching y poner las ≈ 400 tokens de instrucciones siempre iguales al principio; poner un tope de conversaciones a la vez (`max_num_seqs`) alrededor de 12 o 13, para que nadie baje de 20 tokens por segundo; y dejar el chunked prefill con trozos chicos, porque sus preguntas de 6,000 tokens frenarían a los demás. Ninguna de esas cifras se da por buena sin medir: la cuenta da el orden de magnitud y las pruebas de carga dan el número.

**Una clínica con un asistente de notas médicas.** Supuesto del ejemplo: los médicos dictan notas cortas, el modelo las ordena en un formato fijo, con prompts de ≈ 800 tokens (500 de instrucciones y formato) y respuestas de ≈ 300. Aquí la reserva fija sería desastrosa: con un tope de 8,192 tokens, cada conversación usaría ≈ 13 % de lo reservado. Con bloques, caben ≈ 7 veces más conversaciones en la misma memoria, y como el 60 % de cada prompt es igual en todas, el prefix caching se ahorra más de la mitad de cada prefill. En esta clínica, PagedAttention es la diferencia entre comprar una GPU o varias.

**Un asistente de código para un equipo de desarrollo.** Supuesto del ejemplo: cada petición manda el mismo archivo grande del repositorio (20,000 tokens) más una pregunta corta, y varios programadores trabajan en el mismo archivo. El prefill de 20,000 tokens es largo y frena el decode de los demás: el chunked prefill importa aquí más que en el despacho. Y como muchas peticiones comparten los mismos 20,000 tokens de inicio, el prefix caching convierte la mayoría de esos prefills en una búsqueda en la tabla. Es el caso que optimizan servidores como SGLang con su árbol de prefijos.

**Fuera de las computadoras: el camión de pasajeros.** Un camión urbano no espera a que todos los pasajeros lleguen a la terminal para subir a los nuevos: en cada parada bajan unos y suben otros. Eso es el batching continuo. Y no aparta asientos por familia «por si llegan los primos»: cada quien se sienta donde haya lugar. Eso es PagedAttention. Lo que el camión no tiene es preemption: nadie te baja a media ruta porque se llenó. Un servidor de LLMs sí lo hace, y te vuelve a subir unos segundos después.

## Ejercicios {Exercises}

:::ejercicios
? [facil] ¿Cuál es el punto de quiebre de una H100 SXM en FP16? Su pico denso es ≈ 989.5 TFLOPS y su ancho de banda, 3.35 TB/s. ¿El decode de un LLM grande ahí espera a la memoria o al cálculo?
\(I_{q} = F ÷ B_W\) = 989.5 × 10¹² ÷ 3.35 × 10¹² ≈ **295 FLOPs por byte**. Más bajo que el de la L40S (≈ 419), porque la H100 tiene mucho más ancho de banda en proporción. Aun así, el decode con contexto largo tiene intensidades de decenas: **espera a la memoria** en las dos.
? [facil] Una respuesta del despacho termina con 6,500 tokens en su KV cache. Con bloques de 16, ¿cuántos bloques usa y cuántos lugares quedan vacíos en el último?
⌈6,500 ÷ 16⌉ = ⌈406.25⌉ = **407 bloques** = 6,512 lugares. Vacíos: 6,512 − 6,500 = **12 tokens** en el último bloque, 12 × 256 KiB = 3 MiB.
? [facil] Un batch estático lleva tres respuestas de 300, 100 y 200 tokens. ¿Qué fracción de los lugares-paso hace trabajo útil?
\(u = sum n_i ÷ (b × max n_i)\) = (300 + 100 + 200) ÷ (3 × 300) = 600 ÷ 900 ≈ **66.7 %**. Un tercio de los lugares-paso lee los pesos para nadie.
? [facil] Las instrucciones del despacho son 400 tokens. Si el servidor usa bloques de 64 y solo guarda bloques llenos, ¿cuántos tokens de instrucciones se reutilizan con prefix caching?
400 ÷ 64 = 6.25: **6 bloques llenos = 384 tokens** se reutilizan. Los últimos 16 tokens de instrucciones caen en un bloque que se completa con la pregunta, que cambia cada vez, así que se recalculan siempre. Con bloques de 16, los 400 se reutilizan.
? [medio] Con la fórmula del paso, ¿cuántos tokens por segundo ve cada persona y cuántos da la GPU con 4 conversaciones del despacho (pesos de 19.32 GB, 1.64 GB de KV cada una, L40S)?
Bytes: 19.32 + 4 × 1.64 = 25.88 GB. \(t_{mem}\) = 25.88 ÷ 864 ≈ **29.95 ms**; el cálculo, 2 × 32.762 × 10⁹ × 4 ÷ 362.05 × 10¹² ≈ 0.72 ms, no manda. Cada persona: 1 ÷ 29.95 ms ≈ **33.4 tokens/s**. La GPU: 4 ÷ 29.95 ms ≈ **134 tokens/s**.
? [medio] Supón que las conversaciones del despacho fueran más cortas: 2,000 tokens reales en promedio. Con 21.88 GB libres, 256 KiB por token y un tope de 8,192, ¿cuántas caben con reserva fija y cuántas con bloques de 16?
Reserva fija: ⌊21.88 × 10⁹ ÷ (8,192 × 262,144)⌋ = **10**, igual que antes: la reserva no mira el largo real. Bloques: ⌈2,000 ÷ 16⌉ = 125 bloques = 2,000 tokens; ⌊21.88 × 10⁹ ÷ (2,000 × 262,144)⌋ = ⌊41.7⌋ = **41**. Cuatro veces más: cuanto más cortas las conversaciones frente al tope, más gana PagedAttention.
? [medio] El despacho guarda su KV cache en FP8 (128 KiB por token en vez de 256). Con 8 conversaciones a media respuesta (6,250 tokens), ¿cuánto dura el paso y cuántos tokens por segundo ve cada persona?
\(K\) = 6,250 × 131,072 ≈ 0.82 GB. Bytes: 19.32 + 8 × 0.82 ≈ 25.87 GB. \(t_{paso}\) ≈ 25.87 ÷ 864 ≈ **29.9 ms**, y cada persona ve ≈ **33.4 tokens/s** (antes, 26.6). Curioso: es lo mismo que 4 conversaciones en BF16, porque los bytes de KV por paso son los mismos. Además caben el doble en memoria. El precio es algo de precisión, que se mide.
? [medio] El despacho quiere que nadie baje de 20 tokens por segundo. ¿Cuántas conversaciones a media respuesta aguanta la L40S por velocidad, y cuántas por memoria? ¿Cuál manda?
Por velocidad: \(t_{paso}\) ≤ 1 ÷ 20 = 50 ms, así que \(W + b × K\) ≤ 0.05 s × 864 GB/s = 43.2 GB. Con \(K\) = 1.6384 GB: \(b\) ≤ (43.2 − 19.32) ÷ 1.6384 ≈ 14.6 → **14**. Por memoria: ⌊21.88 ÷ 1.6384⌋ = ⌊13.35⌋ = **13**. **Manda la memoria**, por poco. (Que 50 ms × 864 GB/s dé justo los 43.2 GB útiles de la L40S es una coincidencia de estos números.)
? [reto] Un prefill de 6,000 tokens del despacho llega mientras 7 conversaciones están en decode. Compara, a pico de cálculo, (a) hacerlo entero en un paso y (b) con chunked prefill y un tope de 2,048 tokens por paso. ¿Cuánto esperan las 7 en cada caso, y cuándo recibe su primer token la nueva?
(a) Un paso: 2 × 32.762 × 10⁹ × 6,000 ÷ 362.05 × 10¹² ≈ **1.09 s** sin tokens para las 7; la nueva tiene su primer token al terminar ese paso, ≈ 1.09 s. (b) Cada paso lleva 7 tokens de decode y 2,041 de prefill: trozos de 2,041, 2,041 y 1,918, **3 pasos** de ≈ 2 × 32.762 × 10⁹ × 2,048 ÷ 362.05 × 10¹² ≈ **0.37 s** cada uno (el último un poco menos). Las 7 reciben un token cada ≈ 0.37 s en vez de esperar 1.09 s seguidos. La nueva tiene su primer token al final del tercer paso: ≈ 1.1 s, casi lo mismo. El chunked prefill no hace más rápido el prefill: reparte la espera para que nadie sienta el tirón entero.
? [reto] El paper de PagedAttention usa OPT-13B en una A100 de 40 GB con 12 GB para el KV cache y 800 KB por token (2 × 5,120 × 40 × 2 bytes = 819,200 bytes). Reporta ≈ 15.7 mil lugares de tokens. (a) Comprueba ese número. (b) ¿Cuántas secuencias de 2,048 tokens caben reservando el máximo? (c) Si las conversaciones usaran 500 tokens en promedio (supuesto) y se guardaran en bloques de 16, ¿cuántas cabrían?
(a) Con 12 GiB = 12 × 2³⁰ bytes: 12,884,901,888 ÷ 819,200 ≈ **15,729** lugares: el 15.7K del paper (sale con GiB, no con GB). (b) ⌊15,729 ÷ 2,048⌋ = ⌊7.68⌋ = **7 secuencias**: cada una reserva ≈ 1.6 GB. (c) ⌈500 ÷ 16⌉ = 32 bloques = 512 tokens; ⌊15,729 ÷ 512⌋ = ⌊30.7⌋ = **30 conversaciones**, más de 4 veces más. Es el tamaño de mejora que explica las cifras del paper.
? [reto] La línea de arranque de vLLM dice «GPU KV cache size: 83,456 tokens, Maximum concurrency for 8,192 tokens per request: 10.19x». El despacho la lee y concluye «solo podemos atender a 10 personas». Explica qué tiene de bueno y de malo esa conclusión, con números.
De bueno: si **todas** las conversaciones llegaran al tope de 8,192 tokens a la vez, caben 83,456 ÷ 8,192 ≈ 10.19, o sea 10. De malo, tres cosas. (1) Las conversaciones reales del despacho van de 6,000 a 6,500 tokens: a media respuesta, ⌊83,456 ÷ 6,256⌋ = **13** a la vez. (2) «Conversaciones a la vez» no son «personas»: 200 abogados que preguntan 15 veces al día generan, en la hora pico, ≈ 5.6 conversaciones simultáneas en promedio (la cuenta con la ley de Little está en la lección de concurrencia). (3) Si de verdad pasaran de 13, el servidor no las rechaza: algunas esperan en la fila o se desalojan (preemption) un momento.
:::

## Lo que sigue {What comes next}

- **[Concurrencia: la curva de usuarios contra latencia](/concurrencia/)**, la siguiente lección de este módulo, toma lo que viste aquí (el paso que se alarga con cada conversación, la memoria que pone el tope) y lo convierte en la curva que se dibuja en una prueba de carga: cuántas personas a la vez, cuánto tardan en ver el primer token y cada token, y dónde está el codo.
- **«Formatos de cuantización en la práctica»** mide lo que cuesta en calidad bajar los pesos o el KV cache a menos bits, la palanca más directa para leer menos bytes por paso.
- **«Speculative decoding y contexto largo»** ataca el mismo límite desde otro lado: hacer que cada lectura de los pesos produzca más de un token por conversación.
- **«Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM»** pone estas ideas en programas concretos: cuáles hacen batching continuo, cuáles PagedAttention y cuáles no.
- En Sensei: [Matrices y FLOPs](https://sensei.trueml.app/flops/) tiene el roofline completo, y [Latencia y throughput](https://sensei.trueml.app/latencia/) las colas que explican por qué la espera crece cuando la GPU se llena.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
batch limitado-por-memoria intensidad-aritmetica roofline batching-estatico batching-continuo scheduler pagedattention bloque-kv tabla-de-bloques fragmentacion prefix-caching copy-on-write preemption chunked-prefill
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué con 8 conversaciones el paso de decode no tarda 8 veces más que con una?
Porque el paso está limitado por memoria y lo que más se lee son los pesos, que se leen **una vez** para todas. Cada conversación extra solo suma su propio KV cache.
? ¿Qué es el punto de quiebre de una GPU y cuánto vale en la L40S?
Pico de FLOPs por segundo ÷ bytes por segundo de memoria: la intensidad que necesita un cálculo para que mande el cálculo y no la memoria. En la L40S, 362.05 TFLOPS ÷ 864 GB/s ≈ 419 FLOPs por byte.
? ¿Qué hace el batching continuo que no hace el estático?
Decide quién va en el batch **antes de cada paso**: saca a las que terminaron y mete a las de la fila en el siguiente paso, sin esperar a que acabe la respuesta más larga.
? ¿Cuáles son las tres formas de fragmentación del KV cache, y cuál deja PagedAttention?
Reservada (lugares para tokens futuros), interna (lo que sobra del máximo reservado) y externa (huecos entre reservas). PagedAttention solo deja el final del último bloque de cada conversación.
? ¿Por qué el prefix caching ahorra más en la repregunta del despacho que en sus instrucciones?
Porque las instrucciones son ≈ 400 tokens y la repregunta empieza con toda la conversación anterior, ≈ 6,500 tokens: esos bloques ya están calculados y su prefill se salta.
? ¿Qué ve un usuario cuando su conversación sufre preemption con recompute?
Su respuesta se congela unos segundos mientras otras usan la memoria; luego el servidor recalcula su KV cache con un prefill y la respuesta sigue igual.
? ¿Para qué sirve el chunked prefill, si no hace más rápido el prefill?
Para repartir el prefill largo de una petición nueva en varios pasos, con el decode de las demás en cada uno, y que ninguna deje de recibir tokens durante más de un segundo.
:::
