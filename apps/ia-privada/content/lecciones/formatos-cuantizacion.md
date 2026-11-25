---
titulo: Formatos de cuantización en la práctica
en: Quantization formats in practice
subtitulo: Qué trae de verdad un archivo «AWQ», «GPTQ», «GGUF» o «FP8», cómo lo fabrica cada algoritmo, en qué GPU corre rápido cada uno y cómo se mide, con tu propio examen, cuánto de calidad se perdió.
pregunta: El despacho eligió «INT4 de AWQ». ¿Qué es exactamente ese archivo, qué otras opciones había, en qué hardware corre cada una y cuánto de calidad se pierde, medido de verdad?
sensei: numeros-maquina, llms, ruido
---

:::idea
«Cuantizar a 4 bits» no es una sola cosa. Son tres decisiones apiladas: un **formato de archivo** (cómo se guardan los números y sus escalas), un **algoritmo** (cómo se eligen esos números para que el modelo se equivoque lo menos posible) y un **kernel** (el programa de la GPU que los lee y multiplica rápido). AWQ, GPTQ, los k-quants de GGUF y FP8 son respuestas distintas a esas tres preguntas. Ninguna es gratis: cada una cambia un poco las respuestas del modelo, y la única forma honesta de saber cuánto es medirlo con tu propio examen, mirando qué preguntas cambiaron y si el cambio es más grande que el ruido.
:::

## Lo que hay dentro de «Qwen3-32B-AWQ» {What is inside «Qwen3-32B-AWQ»}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México con 200 abogados y asistentes que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Su modelo candidato es **Qwen3 32B en INT4 de AWQ**, con pesos de ≈ **19.32 GB**. Cada pregunta trae ≈ 6,000 tokens de entrada y la respuesta ≈ 500; quiere el primer token en ≤ 2 s y al menos 20 tokens por segundo para cada persona. El sizing completo pide **3 GPUs NVIDIA L40S** de 48 GB. Y para aceptar el modelo tiene un examen propio: **200 preguntas reales** escritas por sus abogados, con un criterio de ≥ 85 % bien contestadas (170 o más).

Antes de seguir, lo que Sensei ya explica y aquí solo se recuerda. En [Cómo guarda números una computadora](https://sensei.trueml.app/numeros-maquina/) ves que [[cuantizacion|cuantizar]] es guardar cada número con menos bits, como un entero más una **escala** que dice cuánto vale cada escalón; que INT4 solo tiene 16 enteros y por eso necesita una [[escala-por-grupo|escala por grupo]] de pesos; que el **punto cero** deja usar todos los enteros cuando el rango no está centrado, y que FP8 es un punto flotante de 1 byte. También ves que ningún modelo convertido sale sin un examen. Aquí vamos más hondo: qué hay en los archivos de verdad, cómo los fabrica cada algoritmo y cómo se mide lo que cuestan.

### El archivo, abierto

Si entras a la página de `Qwen/Qwen3-32B-AWQ` en Hugging Face, ves cuatro archivos grandes `.safetensors` y un `config.json`. Los `.safetensors` son los [[pesos|pesos]], partidos en cuatro pedazos (*shards*). El `config.json` dice cómo leerlos. Su parte de cuantización trae cinco datos:

| Campo | Valor | Qué quiere decir |
|---|---|---|
| `quant_method` | `awq` | el algoritmo que eligió los números |
| `bits` | `4` | cada peso es un entero de 4 bits |
| `group_size` | `128` | cada 128 pesos seguidos comparten una escala |
| `zero_point` | `true` | cada grupo trae además su punto cero |
| `version` | `gemm` | cómo están acomodados los enteros en memoria, para el kernel que los va a leer |

Con eso ya puedes sacar la cuenta de los bytes. Cada grupo de 128 pesos guarda 128 enteros de 4 bits, una escala en FP16 (16 bits) y un punto cero de 4 bits. Las dos [[tablas-de-tokens|tablas de tokens]] (la de entrada y la de salida, cada una de 151,936 tokens × 5,120 números) no se cuantizan: se quedan en 16 bits, como casi siempre en AWQ, GPTQ y FP8.

:::formula Bits efectivos por peso y tamaño del archivo
b_{ef} = b + frac{b_s + b_z}{G}
W = frac{(P − E) × b_{ef}}{8} + E × 2
- b: los bits de cada peso cuantizado (4 en INT4)
- b_s: los bits de la escala de cada grupo (16 si es FP16)
- b_z: los bits del punto cero de cada grupo (4 en AWQ; 0 si es simétrico)
- G: los pesos que comparten una escala, el tamaño del grupo (128)
- b_{ef}: los bits que de verdad cuesta cada peso, contando su parte de la escala
- P: los parámetros del modelo; E: los de las tablas de tokens, que se quedan en 2 bytes
- W: lo que pesa el archivo, en bytes
:::

:::cuenta Los 19.32 GB del despacho
Bits por peso, \(b_{ef}\) // \(b\) = 4, \(b_s\) = 16, \(b_z\) = 4, \(G\) = 128 | 4 + (16 + 4) ÷ 128 | 4.156 bits
Tablas de tokens, \(E\) // dos tablas: entrada y salida | 151,936 × 5,120 × 2 | 1.556 mil millones
Pesos cuantizados, \(P − E\) // \(P\) = 32,762 millones, del `config.json` | 32.762 − 1.556 | 31.206 mil millones
Su tamaño // \((P − E) × b_{ef} ÷ 8\) | 31.206 × 10⁹ × 4.156 ÷ 8 | 16.21 GB
Tablas en 16 bits // \(E × 2\) | 1.556 × 10⁹ × 2 | 3.11 GB
Archivo, \(W\) | 16.21 + 3.11 | **19.32 GB**
Bits por parámetro de todo el archivo // \(W × 8 ÷ P\) | 19.32 × 8 ÷ 32.762 | ≈ 4.72
= El «INT4» del despacho pesa ≈ 4.72 bits por parámetro, no 4: ≈ 18 % más que un INT4 ideal de 16.38 GB.
:::

Los cuatro *shards* del repositorio suman 19,325,481,744 bytes: 19.33 GB, cinco milésimas de GB más que la cuenta. Esa diferencia es del orden de los encabezados de cada archivo y de piezas chicas que la cuenta no separa. La cuenta cuadra, y eso es lo importante: ahora sabes de dónde sale cada byte.

:::figura formatos-cuantizacion-grupo
Un grupo de 128 pesos de AWQ: 512 bits de enteros, 16 de escala y 4 de punto cero. En total 532 bits, ≈ 4.156 por peso. Con grupos más chicos la escala se reparte entre menos pesos y cuesta más.
:::

Ojo con un detalle que confunde a mucha gente: los 4 bits son **solo de los pesos**. Las activaciones (los números que viajan entre capas mientras el modelo calcula) siguen en 16 bits, y el [[kv-cache|KV cache]] también, salvo que se cuantice aparte. Por eso estos formatos se nombran con dos letras: **W4A16** quiere decir *weights* de 4 bits y *activations* de 16. Es cuantización [[solo-pesos|solo de pesos]] (*weight-only*). En el decode, donde la GPU pasa casi todo el tiempo leyendo pesos, eso ya es casi toda la ganancia.

## Tres capas: el archivo, el algoritmo y el kernel {Three layers: file, algorithm and kernel}

Cuando alguien dice «lo bajé en AWQ» o «uso un Q4_K_M», mezcla tres cosas distintas. Separarlas es la mitad de entender este tema.

1. **El formato de archivo.** Cómo se guardan los enteros, las escalas y los puntos cero, en qué orden y con qué metadatos. *Safetensors* con un `config.json` es el formato del ecosistema de Hugging Face, que leen vLLM y SGLang. **[[gguf|GGUF]]** es el formato de llama.cpp: un solo archivo con todo adentro.
2. **El algoritmo.** Cómo se eligen los enteros y las escalas a partir de los pesos originales en BF16. El más simple redondea cada peso al escalón más cercano. Los buenos, como **[[gptq|GPTQ]]** y **[[awq|AWQ]]**, miran cómo se usa cada peso con datos reales y deciden mejor.
3. **El [[kernel-de-cuantizacion|kernel]].** El programa que corre en la GPU, lee esos enteros y hace la multiplicación. Un formato sin un kernel rápido para tu GPU ocupa poca memoria, pero puede correr más lento que el original.

Las tres capas se combinan, pero no de cualquier forma. Un archivo AWQ lo puede leer el kernel de AWQ o un kernel más rápido llamado Marlin; un GPTQ también. Un GGUF solo lo lee bien el código de llama.cpp (y los programas que lo usan por dentro, como Ollama). Un FP8 necesita una GPU que calcule en FP8 para ir rápido.

:::analogia Una mudanza en cajas
Piensa en una mudanza. El **formato** es el tipo de caja: de cartón, de plástico, con etiquetas de un color o de otro. El **algoritmo** es cómo acomodas las cosas adentro: aventarlas o envolver las frágiles y poner lo pesado abajo. El **kernel** es la cuadrilla que descarga en la casa nueva: unos traen carrito y abren las cajas en segundos; otros las abren a mano, una por una.

Dónde se rompe: en una mudanza, acomodar bien no cambia lo que llega. En la cuantización sí: cada algoritmo entrega un modelo un poco distinto, y algunos «rompen» más cosas que otros. Por eso lo que importa no es solo cuánto cabe, sino cuánto cambió lo que llegó.
:::

:::diagrama formatos-cuantizacion-ruta
Toca cada caja para ver qué hace. El primer recorrido es el del despacho: de los pesos originales al archivo AWQ, al servidor y a la GPU, con el examen al final. El segundo es la ruta de GGUF.
:::

### Los formatos de un vistazo

| Formato | Algoritmo típico | Bits efectivos | Dónde corre bien | Servidor típico |
|---|---|---|---|---|
| AWQ (safetensors) | AWQ | ≈ 4.16 | GPUs NVIDIA desde Turing | vLLM, SGLang |
| GPTQ (safetensors) | GPTQ | ≈ 4.13 a 4.16 | GPUs NVIDIA desde Volta | vLLM, SGLang |
| GGUF | k-quants, i-quants, con o sin imatrix | de ≈ 2 a 8.5 | CPU, Mac, GPUs NVIDIA y AMD | llama.cpp, Ollama |
| FP8 (safetensors) | redondeo simple, con escalas | ≈ 8 | GPUs con FP8: Ada, Hopper, Blackwell | vLLM, SGLang |
| NVFP4 y MXFP4 | redondeo con escalas por bloque | ≈ 4.5 y ≈ 4.25 | nativo en Blackwell | vLLM y otros |
| EXL3 | una variante de QTIP | el que pidas | GPUs NVIDIA | ExLlamaV3 |
| MLX | entero afín por grupos | ≈ 4.5 con grupos de 64 | Mac con Apple Silicon | MLX |

Las columnas de «dónde corre» salen de la tabla de compatibilidad de vLLM a noviembre de 2026 y de la documentación de cada proyecto; las ves a fondo en la sección de kernels. Los bits efectivos son de la cuenta de arriba con cada esquema; el de MLX supone una escala y un sesgo de 16 bits por grupo de 64.

## Redondear al más cercano, y el problema de los atípicos {Round-to-nearest and the outlier problem}

El algoritmo más simple de todos tiene nombre: **RTN** (*round-to-nearest*, redondear al más cercano). Toma un grupo de pesos, calcula su escala con el mínimo y el máximo, y redondea cada peso al escalón más cercano. No mira ningún dato: solo los pesos. Es lo que hace Sensei en sus ejemplos, y para 8 bits suele bastar.

Con 4 bits empieza a doler, y con 3 se cae. El paper de GPTQ (Frantar y otros, ICLR 2023) lo mide con la [[perplejidad|perplejidad]] en WikiText2, un texto de Wikipedia que se usa de prueba. La perplejidad mide qué tan sorprendido está el modelo con el texto real: menos es mejor, y la defines a fondo más abajo. Por ahora basta comparar:

| Modelo | FP16 | RTN 4 bits | GPTQ 4 bits | RTN 3 bits | GPTQ 3 bits |
|---|---|---|---|---|---|
| OPT-175B | 8.34 | 10.54 | 8.37 | 7,300 | 8.68 |
| BLOOM-176B | 8.11 | 8.37 | 8.21 | 571 | 8.64 |

En OPT-175B, RTN a 4 bits sube la perplejidad 2.2 puntos; GPTQ, 0.03. A 3 bits RTN **colapsa**: una perplejidad de 7,300 quiere decir que el modelo escribe basura. GPTQ, con los mismos 3 bits, queda a 0.34 del original. Mismo formato, mismos bits, distinto algoritmo.

### Por qué falla el redondeo simple

La razón principal tiene nombre: los **[[outlier|valores atípicos]]** (*outliers*). En un LLM, unos pocos pesos y, sobre todo, unos pocos canales de activación son muchísimo más grandes que el resto. Sensei lo muestra con un solo peso de 25 en una capa de pesos chicos: la escala se estira para alcanzarlo y todos los demás pierden resolución. Con 16 escalones en vez de 256, ese daño es 16 veces peor.

Hay dos defensas, y las vas a ver en todos los formatos:

- **Grupos chicos.** Si cada 128 pesos tienen su escala, un atípico solo arruina a sus 127 vecinos, no a la capa entera.
- **Algoritmos que miran los datos.** GPTQ y AWQ usan unas cuantas frases de texto real para saber qué pesos importan más y cómo se combinan. A ese texto se le llama de [[calibracion|calibración]].

Mira la primera defensa con números. El código toma una fila de 1,024 pesos chicos con dos atípicos, la cuantiza a INT4 asimétrico con grupos de distintos tamaños y mide el error:

```python
import random, math
random.seed(7)
w = [random.gauss(0, 0.02) for _ in range(1024)]   # una fila de pesos
w[100], w[700] = 0.35, -0.28                       # dos valores atípicos (outliers)

def int4_por_grupos(xs, G):
    out = []
    for i in range(0, len(xs), G):
        g = xs[i:i + G]
        lo, hi = min(g), max(g)
        s = (hi - lo) / 15                  # 16 enteros: del 0 al 15
        z = round(-lo / s)                  # punto cero
        out += [s * (min(15, max(0, round(x / s) + z)) - z) for x in g]
    return out

rms = lambda v: math.sqrt(sum(x * x for x in v) / len(v))
for G in (1024, 128, 32):
    q = int4_por_grupos(w, G)
    err = rms([a - b for a, b in zip(q, w)]) / rms(w)
    print(f"grupo {G:>4}: error relativo {err:6.1%} · bits por peso {4 + 20 / G:.3f}")
```

```salida
grupo 1024: error relativo  48.0% · bits por peso 4.020
grupo  128: error relativo  16.3% · bits por peso 4.156
grupo   32: error relativo   9.3% · bits por peso 4.625
```

Con una sola escala para los 1,024 pesos, el error es casi la mitad del tamaño de los pesos: inservible. Con grupos de 128, baja a 16 %, y cuesta 0.156 bits por peso. Con grupos de 32 baja a 9 %, pero ya cuesta 0.625 bits por peso. Ese es el intercambio de todos los formatos: **escalas más finas, menos error, más bits**. Grupos de 128 son el punto que eligieron AWQ y GPTQ; los k-quants de GGUF eligieron bloques de 32 con escalas comprimidas, como vas a ver.

:::ojo
Un error relativo de 16 % por peso no quiere decir que el modelo conteste 16 % peor. Los errores de miles de pesos se compensan en parte al sumar, y lo que importa es cuánto cambian las **salidas**. Eso se mide con texto y con exámenes, no con el error de los pesos. Es justo la idea que aprovechan GPTQ y AWQ.
:::

## GPTQ: corregir el error con los pesos que quedan {GPTQ: fixing the error with the weights that remain}

RTN redondea cada peso por su cuenta. GPTQ hace algo más listo: cuando redondea un peso y se equivoca, **mueve los pesos que todavía no ha redondeado** para compensar ese error. Lo hace capa por capa, mirando cómo llegan los datos a esa capa.

### La idea con dos pesos

Imagina una neurona con dos pesos, \(w_1\) = 0.36 y \(w_2\) = 0.36, y una rejilla muy gruesa de escalones de 0.25 (0, 0.25, 0.5…). Su salida es \(y = w_1 x_1 + w_2 x_2\). Supón que en los datos reales las dos entradas casi siempre llegan iguales: \(x_1 ≈ x_2\).

RTN redondea cada uno: 0.36 ÷ 0.25 = 1.44 → 1 escalón → 0.25. Los dos quedan en 0.25, la suma de pesos pasa de 0.72 a 0.50, y la salida pierde casi un tercio.

GPTQ redondea \(w_1\) a 0.25 y anota su error: −0.11. Como \(x_2\) llega igual que \(x_1\), subir \(w_2\) en 0.11 compensa exactamente lo que \(w_1\) perdió. Ahora \(w_2\) vale 0.47, y al redondearlo, 0.47 ÷ 0.25 = 1.88 → 2 escalones → 0.50. La suma queda en 0.75: a 0.03 de la original.

¿Cuánto se mueve el peso siguiente? Depende de qué tanto se parecen las dos entradas en los datos. Si son independientes, no sirve moverlo; si llegan iguales, se mueve todo el error.

:::formula La compensación de GPTQ, con dos pesos
δ_2 = − e_1 × frac{E[x_1 x_2]}{E[x_2^2]}
- e_1: el error que dejó el redondeo del primer peso: \(q_1 − w_1\)
- E[x_1 x_2]: el promedio, sobre los datos de calibración, del producto de las dos entradas: qué tanto se mueven juntas
- E[x_2^2]: el promedio del cuadrado de la segunda entrada
- δ_2: lo que se le suma al segundo peso antes de redondearlo
:::

:::cuenta Dos pesos de 0.36, con y sin compensación
Redondeo del primero, \(q_1\) // escalones de 0.25; 0.36 ÷ 0.25 = 1.44 → 1 | 1 × 0.25 | 0.25
Su error, \(e_1\) | 0.25 − 0.36 | −0.11
Compensación, \(δ_2\) // las entradas llegan iguales: \(E[x_1 x_2] ÷ E[x_2^2]\) = 1 | −(−0.11) × 1 | +0.11
Segundo peso corregido // \(w_2 + δ_2\) | 0.36 + 0.11 | 0.47
Su redondeo, \(q_2\) // 0.47 ÷ 0.25 = 1.88 → 2 | 2 × 0.25 | 0.50
Suma de pesos con GPTQ // \(q_1 + q_2\) contra 0.72 | 0.25 + 0.50 | 0.75 (error +0.03)
Suma de pesos con RTN // los dos a 0.25 | 0.25 + 0.25 | 0.50 (error −0.22)
= Con la misma rejilla, compensar baja el error de la salida de 0.22 a 0.03: siete veces menos.
:::

Esa tabla de promedios \(E[x_i x_j]\) entre todas las entradas de una capa tiene nombre: es (salvo un factor de 2) el **Hessiano** del error de esa capa, la matriz que dice qué tan rápido crece el error si mueves dos pesos a la vez. Por eso se dice que GPTQ usa «información de segundo orden». La idea viene de unos métodos de los años noventa para podar redes, *Optimal Brain Surgeon*, y de su versión para cuantizar, OBQ: quitar o redondear un peso y corregir los demás con el Hessiano.

:::profundo El truco que lo hizo rápido
OBQ cuantizaba los pesos uno por uno, siempre eligiendo el que menos dañaba. Funcionaba, pero en un modelo grande tardaba demasiado. GPTQ cambió dos cosas:

- **Mismo orden para todas las filas.** En vez de elegir el mejor peso de cada fila, recorre las columnas de la matriz en orden fijo, y todas las filas a la vez. Así el inverso del Hessiano se actualiza una vez por columna y no una vez por peso. El costo baja de \(d_{fila} × d_{col}^3\) a \(max(d_{fila} × d_{col}^2, d_{col}^3)\): para una matriz de 5,120 × 5,120, como las de Qwen3 32B, es ≈ 5,000 veces menos trabajo.
- **Bloques y estabilidad.** Procesa las columnas en bloques de 128 (*lazy batch updates*) para usar bien la GPU, y usa una factorización de Cholesky para que los números no se descompongan.
:::

El resultado de GPTQ: OPT-175B, un modelo de 175 mil millones de parámetros, se cuantizó en **4.2 horas** en una sola A100 de 80 GB. Los datos de calibración fueron 128 pedazos al azar de 2,048 tokens de C4, un texto genérico de internet: GPTQ no ve ninguna tarea, solo cómo llegan las palabras a cada capa.

:::nota Qué ve GPTQ y qué no
GPTQ mira las **entradas** de cada capa con los datos de calibración, y con eso decide cómo mover los pesos. No mira las respuestas del modelo ni ninguna etiqueta. Por eso si tus datos de calibración se parecen poco a lo que el modelo va a leer, GPTQ puede quedar afinado para otra cosa: el paper de AWQ reporta que, cuando calibración y evaluación no coinciden, la perplejidad de GPTQ sube de 2.3 a 4.9 puntos, y la de AWQ solo de 0.5 a 0.6.
:::

Hoy el GPTQ que más se usa para servir con vLLM sale de **llm-compressor**, la biblioteca de cuantización del equipo de vLLM: su receta INT4 es GPTQ con esquema W4A16, grupos de 128 y 512 muestras de calibración recomendadas. **GPTQModel** es otra herramienta activa que hace GPTQ y AWQ.

## AWQ: proteger los canales que más pesan {AWQ: protecting the channels that matter}

AWQ (Lin y otros, premio al mejor paper de MLSys 2024) parte de una observación distinta. No todos los pesos importan igual: según sus autores, solo una fracción chica, de 0.1 % a 1 %, es **saliente** (*salient*), o sea, pesa mucho en la salida. Y la forma de encontrarlos no es mirar los pesos, sino las **activaciones**: un peso importa mucho si lo que le llega a multiplicar es grande.

Su experimento clave, en OPT-6.7B cuantizado a 3 bits con grupos de 128 (la perplejidad en FP16 es 10.86 y con RTN, 23.54):

| Qué 1 % de canales se deja en FP16 | Perplejidad |
|---|---|
| Ninguno (RTN puro) | 23.54 |
| Elegidos al azar | 24.23 |
| Los de pesos más grandes | 22.37 |
| Los de **activaciones** más grandes | **11.39** |

Dejar intacto el 1 % correcto casi devuelve el modelo original. El problema es que mezclar pesos en FP16 con pesos en INT3 dentro de la misma matriz es incómodo para el hardware: los kernels quieren todo en el mismo formato.

### El truco: escalar antes de redondear

AWQ consigue casi lo mismo sin dejar nada en FP16. Para cada canal de entrada multiplica el peso por un número \(s\) y divide la activación entre el mismo \(s\). La cuenta no cambia: \((w × s) × (x ÷ s) = w × x\). Pero ahora el peso que se redondea es \(w × s\), más grande, y el error del redondeo, que es de a lo más medio escalón, queda dividido entre \(s\) al multiplicarse por \(x ÷ s\).

:::formula El error de un canal, con y sin escalar
Err(s) ≈ frac{Δ' × r × |x|}{s}
- Δ': el escalón de la escala del grupo después de escalar; casi igual a Δ si ese peso no es el más grande del grupo
- r: el error del redondeo en escalones, de 0 a 0.5
- |x|: el tamaño de la activación de ese canal
- s: el factor por el que se multiplica el peso (y se divide la activación)
- Err(s): el error que ese canal le mete a la salida
:::

Mientras \(Δ'\) no crezca, el error de ese canal baja \(s\) veces. Pero si escalas demasiado, ese peso se vuelve el más grande de su grupo, estira la escala de los otros 127, y el error de **ellos** sube. En la tabla 2 del paper, escalar el 1 % saliente por \(s\) = 2 baja la perplejidad de 23.54 a 11.92; con \(s\) = 4 se pierde la ventaja.

:::figura formatos-cuantizacion-awq
El truco de AWQ en un canal con activaciones grandes. Arriba, sin escalar: el error del redondeo se multiplica por una activación grande. Abajo, con el peso × 2 y la activación ÷ 2: la cuenta es la misma, pero el error llega a la salida a la mitad.
:::

Lo puedes ver en tu computadora. El código arma una capa de 64 neuronas con 128 entradas, hace que el canal 5 traiga activaciones 20 veces más grandes, cuantiza a 3 bits con una escala por fila y mide el error de las **salidas** con distintos \(s\) para ese canal:

```python
import random
random.seed(11)
filas, n = 64, 128                     # 64 neuronas de salida, grupos de 128 entradas
W = [[random.gauss(0, 1) for _ in range(n)] for _ in range(filas)]
X = [[random.gauss(0, 1) for _ in range(n)] for _ in range(64)]
for x in X:
    x[5] *= 20                         # el canal 5 trae activaciones 20 veces más grandes

def int3(ws):                          # 3 bits simétrico: una escala por fila (grupo)
    s = max(abs(v) for v in ws) / 3
    return [s * max(-4, min(3, round(v / s))) for v in ws]

def error(s5):
    esc = [s5 if k == 5 else 1 for k in range(n)]
    Q = [int3([v * e for v, e in zip(fila, esc)]) for fila in W]   # w × s, y luego cuantizar
    tot = 0
    for x in X:
        xs = [v / e for v, e in zip(x, esc)]                       # x ÷ s: la salida no cambia
        for fila, q in zip(W, Q):
            y = sum(a * b for a, b in zip(fila, x))
            yq = sum(a * b for a, b in zip(q, xs))
            tot += (y - yq) ** 2
    return (tot / (len(X) * filas)) ** 0.5

for s in (1, 2, 4, 8):
    print(f"s = {s}: error de la salida {error(s):.2f}")
```

```salida
s = 1: error de la salida 5.88
s = 2: error de la salida 4.21
s = 4: error de la salida 5.22
s = 8: error de la salida 7.36
```

Con \(s\) = 2 el error baja ≈ 28 %; con 4 vuelve a subir y con 8 es peor que no hacer nada. Es la misma forma de la tabla del paper: hay un punto dulce, y hay que buscarlo.

:::profundo Cómo elige AWQ el factor
AWQ no prueba a mano. Para cada canal calcula \(s_X\), el tamaño promedio de su activación en los datos de calibración, y usa \(s = s_X^α\): con \(α\) = 0 no escala nada, y con \(α\) = 1 escala cada canal en proporción a su activación. Busca el mejor \(α\) entre 0 y 1 probando 20 valores, se queda con el que da menos error en la salida de la capa, y al final recorta un poco los pesos extremos. No usa retropropagación ni reconstruye nada: solo promedios de activaciones. Por eso necesita pocos datos: **16 secuencias** de calibración contra las 192 que usa GPTQ en la comparación del paper, y es menos sensible a que esos datos se parezcan al uso real.
:::

En la familia Llama 2, con INT4 y grupos de 128, la perplejidad queda así (Tabla 4 del paper de AWQ):

| Llama 2 | FP16 | RTN | GPTQ | AWQ |
|---|---|---|---|---|
| 7B | 5.47 | 5.73 | 5.69 | 5.60 |
| 13B | 4.88 | 4.98 | 4.98 | 4.97 |
| 70B | 3.32 | 3.46 | 3.42 | 3.41 |

Fíjate en dos cosas. A 4 bits, los tres métodos están cerca del original, y más cerca cuanto más grande es el modelo. Y AWQ gana a GPTQ en estos modelos por poco, pero eso no es una ley: más adelante vas a ver una medición en Qwen3 donde pasa al revés.

:::ojo AutoAWQ está archivado
La herramienta con la que se hicieron muchísimos checkpoints AWQ, **AutoAWQ**, se archivó el 11 de mayo de 2025 y su repositorio dice que ya no se mantiene. La documentación de vLLM también la marca como deprecada. Su trabajo lo adoptó el proyecto de vLLM en **llm-compressor**, y **GPTQModel** también hace AWQ. Los archivos AWQ ya hechos, como `Qwen/Qwen3-32B-AWQ`, se siguen sirviendo con vLLM y SGLang; lo que cambia es con qué herramienta cuantizas tú un modelo nuevo.
:::

## GGUF y los k-quants: un archivo para todo {GGUF and k-quants: one file for everything}

El mundo de llama.cpp, el programa que corre LLMs en laptops, Macs y CPUs, tiene su propio formato: **[[gguf|GGUF]]**. Sucedió a tres formatos anteriores (GGML, GGMF y GGJT) y se diseñó con metas claras: un solo archivo por modelo, que se pueda abrir con *mmap* y que traiga **toda** la información para cargarlo: la arquitectura, el tokenizador, la licencia y el tipo de cuantización, en metadatos clave-valor.

*mmap* (*memory map*) es pedirle al sistema operativo que trate el archivo como si ya estuviera en memoria: lo va leyendo del disco conforme se usa, sin copiarlo entero primero. Por eso GGUF alinea cada tensor a un múltiplo de bytes fijo (32 por omisión): para que se pueda leer directo desde su posición en el archivo.

### Los bloques de Q4_0 y Q8_0

Los tipos más simples de GGUF son de bloques de 32 pesos con una escala en FP16:

- **Q4_0**: 32 pesos de 4 bits (16 bytes) + una escala de 2 bytes = 18 bytes por 32 pesos = **4.5 bits por peso** (*bpw*, *bits per weight*).
- **Q8_0**: 32 pesos de 8 bits (32 bytes) + 2 bytes de escala = 34 bytes = **8.5 bpw**.

Con la fórmula de bits efectivos: \(b_{ef}\) = 4 + 16 ÷ 32 = 4.5. Los bloques de 32 son más chicos que los grupos de 128 de AWQ, y por eso la escala cuesta cuatro veces más: 0.5 bits por peso en vez de 0.125.

### Los k-quants: escalas de las escalas

Los **[[k-quant|k-quants]]** (llegaron a llama.cpp con el PR #1684) bajan ese costo con un truco jerárquico. Juntan 8 bloques de 32 en un **superbloque** de 256 pesos. Cada bloque sigue teniendo su escala y su mínimo, pero guardados con solo **6 bits**, y el superbloque guarda en FP16 dos números que dicen cuánto vale un escalón de **esas** escalas. Es cuantizar las escalas.

:::cuenta Los 144 bytes de un superbloque Q4_K
Pesos // 256 pesos × 4 bits | 256 × 4 ÷ 8 | 128 bytes
Escalas y mínimos de los 8 bloques // 6 bits cada uno: 8 × 2 × 6 = 96 bits | 96 ÷ 8 | 12 bytes
Escala y mínimo del superbloque, en FP16 // d y dmin | 2 × 2 | 4 bytes
Total del superbloque | 128 + 12 + 4 | 144 bytes
Bits por peso | 144 × 8 ÷ 256 | **4.5 bpw**
= El mismo 4.5 de Q4_0, pero con escala **y** mínimo por bloque (es asimétrico), y bloques de 32 en vez de una escala sola.
:::

:::figura formatos-cuantizacion-superbloque
Un superbloque Q4_K de 256 pesos: 128 bytes de enteros de 4 bits, 12 bytes con las escalas y mínimos de sus 8 bloques en 6 bits, y 4 bytes con la escala de las escalas en FP16. Total: 144 bytes, 4.5 bits por peso.
:::

La familia completa, con los bytes del código de llama.cpp:

| Tipo | Pesos por bloque | Bytes | bpw |
|---|---|---|---|
| Q4_0 | 32 | 18 | 4.5 |
| Q8_0 | 32 | 34 | 8.5 |
| Q4_K | 256 | 144 | 4.5 |
| Q5_K | 256 | 176 | 5.5 |
| Q6_K | 256 (16 bloques de 16) | 210 | 6.5625 |
| IQ4_XS | 256 | 136 | 4.25 |
| IQ2_XXS | 256 | 66 | 2.0625 |

### Las mezclas: qué quiere decir «_M»

Lo que descargas casi nunca es «Q4_K» puro. Es **Q4_K_M** o **Q4_K_S**: mezclas. La mayoría de los tensores van en Q4_K, y unos pocos que son más sensibles van en un tipo con más bits, como Q6_K. La «M» es de *medium* y la «S» de *small*: la M protege más tensores y pesa más. El detalle de qué tensor recibe qué tipo vive en el código de `llama-quantize` y cambia entre versiones; lo que importa es el promedio. El README de llama.cpp lo mide en Llama 3.1 8B: Q4_K_S da 4.67 bpw y **Q4_K_M, 4.89**. Y en GGUF, a diferencia de AWQ, las tablas de tokens también se cuantizan, así que ese promedio es de todo el archivo.

En el repositorio oficial `Qwen/Qwen3-32B-GGUF`, el Q4_K_M mide 19,762,149,024 bytes: **19.76 GB**, ≈ 4.83 bits por parámetro. Casi lo mismo que el AWQ del despacho (19.32 GB, 4.72 bits). El Q8_0 mide 34.82 GB: 8.50 bits por parámetro, exactamente lo que dice su bloque.

### imatrix: mirar los datos en GGUF

GGUF también tiene su versión de «mirar los datos»: la **[[imatrix|imatrix]]** (*importance matrix*, matriz de importancia). Se corre el modelo sobre un texto de calibración, se anota qué tan grandes llegan las activaciones a cada peso, y `llama-quantize --imatrix` usa esa estadística para elegir mejor las escalas. Es la misma intuición de AWQ: un peso que multiplica activaciones grandes merece más cuidado. Una discusión de los contribuidores de llama.cpp encontró que la imatrix funciona mejor con texto casi al azar que con un texto de un solo tema; no es documentación oficial, pero es un buen aviso de que calibrar con «tus» datos no siempre es mejor.

:::profundo Los i-quants, para bajar de 4 bits
Los **i-quants** (IQ1_S, IQ2_XXS, IQ3_S, IQ4_XS, IQ4_NL…) son tipos más recientes, pensados para bajar de 4 bits con menos daño. Usan rejillas de valores que no están parejas, y casi siempre se fabrican con imatrix. Valen la pena cuando la memoria aprieta de verdad; a 4 bits o más, los k-quants son lo normal.
:::

:::calculadora formatos-cuantizacion-bits
Empieza con el AWQ del despacho: 4 bits, escala de 16, punto cero de 4 y grupos de 128 dan ≈ 4.16 bits y 19.32 GB. Cambia a Q4_K puro: 4.5 bits, pero como en GGUF las tablas también se cuantizan, el archivo teórico pesa menos (18.43 GB); el Q4_K_M real pesa 19.76 porque mezcla tipos. Prueba Q6_K y Q8_0: la cuenta da casi exacto el tamaño de los archivos oficiales.
:::

## FP8 dinámico, FP8 estático y los nuevos FP4 {Dynamic FP8, static FP8 and the new FP4}

En Sensei viste que FP8 es un punto flotante de 1 byte, con dos versiones: E4M3 (más precisión, hasta 448) y E5M2 (más rango). Para servir modelos se usa **E4M3** en pesos y activaciones: es lo que dice el `config.json` de `Qwen/Qwen3-32B-FP8` (`'fmt': 'e4m3'`). La diferencia de fondo con INT4 no es el número de bits: es que FP8 casi siempre cuantiza **también las activaciones**. Es W8A8, no W8A16. Y cuando las dos entradas de una multiplicación están en FP8, la GPU puede usar sus núcleos de FP8, que hacen el doble de operaciones por segundo que los de FP16.

Las activaciones cambian con cada texto, así que su escala se puede fijar de dos maneras:

- **[[fp8-dinamico|FP8 dinámico]]**: la escala de las activaciones se calcula **en cada pasada**, por token, mirando el máximo de ese momento. No hace falta calibrar. La receta `FP8_DYNAMIC` de llm-compressor hace eso, con los pesos en escala **estática por canal** (una escala por cada neurona de salida, calculada una vez).
- **FP8 estático**: la escala de las activaciones se mide **antes**, con datos de calibración, y queda fija. Ahorra calcular el máximo en cada paso, pero si llega un texto con activaciones más grandes que las de la calibración, se recortan.

Los pesos, en cambio, se quedan quietos: su escala se calcula una vez. Y con FP8 no hace falta un algoritmo como GPTQ: la documentación de vLLM dice que con FP8 la exactitud se recupera con redondeo simple (RTN). El rango de FP8, con su exponente, aguanta los atípicos mucho mejor que 16 enteros.

:::nota El FP8 oficial de Qwen3 no es «por canal»
El `Qwen/Qwen3-32B-FP8` usa otro esquema: escalas por **bloques de 128 × 128** pesos (`weight_block_size: [128, 128]`) y activaciones dinámicas. Una escala cada 16,384 pesos casi no cuesta: ≈ 8.002 bits por peso. Su archivo mide **34.33 GB**: 31.206 mil millones de pesos en 1 byte más las tablas de tokens en 16 bits (3.11 GB). Es decir, FP8 pesa ≈ 1.8 veces el AWQ del despacho.
:::

Lo que dicen las mediciones: el estudio más grande que hay, «Give Me BF16 or Give Me Death?» (Kurtic y otros, ACL 2025), corrió más de 500,000 evaluaciones con la familia Llama 3.1 de 8B, 70B y 405B. Su conclusión: FP8 en W8A8 es «prácticamente sin pérdida» en todos los tamaños, y el INT4 solo de pesos (W4A16, hecho con GPTQ) queda más cerca de lo que se esperaba: recupera en promedio 98.7 % de la exactitud del original en 8B y ≈ 99.5 % o más en 70B y 405B, en el Open LLM Leaderboard v1.

### FP4: NVFP4 y MXFP4

Para el despacho, FP4 no aplica todavía de forma nativa: el cálculo en [[fp4|FP4]] lo hacen los Tensor Cores de quinta generación de **Blackwell**, y la L40S es Ada. vLLM puede cargar un checkpoint NVFP4 en otra GPU, pero lo corre como solo pesos (W4A16): ahorra memoria, no cómputo. Lo que son y en qué se distinguen va en el bloque de abajo.

:::profundo NVFP4 contra MXFP4
La generación siguiente baja a 4 bits **de punto flotante**: cada número es E2M1 (1 bit de signo, 2 de exponente y 1 de mantisa), con valores de ≈ −6 a 6. Con tan poquito, todo depende de las escalas, y hay dos estándares que las ponen distinto:

| | NVFP4 (NVIDIA) | MXFP4 (OCP, estándar abierto) |
|---|---|---|
| Valores por bloque | 16 | 32 |
| Escala del bloque | E4M3, 8 bits | E8M0, 8 bits: solo potencias de 2 |
| Escala extra | una FP32 por tensor | ninguna |
| Bits por valor | 4 + 8 ÷ 16 = 4.5 | 4 + 8 ÷ 32 = 4.25 |

NVFP4 paga un cuarto de bit más por bloques más chicos y una escala que puede valer cualquier cosa, no solo potencias de 2: es más fino. NVIDIA reporta que pasar DeepSeek-R1-0528 de FP8 a NVFP4 pierde 1 % o menos de exactitud. MXFP4 es el formato con el que OpenAI publicó gpt-oss: sus pesos de expertos (es un [[moe|MoE]]) vienen en MXFP4, y por eso el de 120B (117 mil millones de parámetros) cabe en una sola GPU de 80 GB.
:::

:::profundo El «4 bits» de una Mac
MLX, la biblioteca de Apple para sus chips, cuantiza por omisión con el modo `affine`: enteros de 4 bits en grupos de 64, cada grupo con su escala y su sesgo. Es un INT4 asimétrico como el de AWQ, con grupos más chicos. También soporta `mxfp4` (grupos de 32 con escala E8M0), `mxfp8` y `nvfp4` (grupos de 16 con escala E4M3). Cuando alguien dice «lo corro en 4 bits en mi Mac», casi siempre es el entero afín, y sus bits efectivos son ≈ 4.5 si la escala y el sesgo son de 16 bits cada uno.
:::

## Kernels: por qué un formato vuela en una GPU y se arrastra en otra {Kernels: why a format flies on one GPU and crawls on another}

Un **[[kernel-de-cuantizacion|kernel]]** es un programa que corre en la GPU y hace una operación: aquí, multiplicar una matriz de pesos cuantizados por las activaciones. Que un formato ocupe poco no lo hace rápido: lo hace rápido un kernel bien escrito para **tu** GPU.

### Qué hace un kernel de W4A16

En un INT4 solo de pesos, la GPU no sabe multiplicar enteros de 4 bits por números de 16 bits. El kernel hace tres cosas, muy pegadas:

1. Lee de la memoria los enteros de 4 bits, las escalas y los puntos cero.
2. Los convierte a FP16 **dentro** del chip (*dequantize*): escala × (entero − punto cero).
3. Multiplica en FP16, con los mismos núcleos que usaría el modelo original.

La ganancia viene del paso 1: leer 4 bits en vez de 16. En el [[decode|decode]], que está [[memory-bound|limitado por memoria]], eso es casi directo velocidad. Pero el paso 3 es igual de lento que en FP16: si muchas conversaciones van juntas en un [[batch|batch]] grande, o en el [[prefill|prefill]], donde manda el cálculo, un INT4 no ayuda nada, y la conversión del paso 2 hasta estorba un poco.

**Marlin** es el kernel que hizo famoso a este esquema. Lo escribió el mismo grupo de GPTQ (IST Austria): multiplica FP16 por INT4 con aceleraciones «cercanas a las ideales (4×)» frente a FP16 con batches de hasta 16 a 32 tokens, con un techo de 3.87× por el costo de las escalas. Con batches de 64 a 128 la ventaja baja poco a poco; dentro de vLLM, de punta a punta, llega a 2.8×. Necesita una GPU con *compute capability* 8.0 o más (Ampere en adelante). Para la H100, que es de otra arquitectura (Hopper), Red Hat escribió **Machete**, porque Marlin «batalla en Hopper»: en Llama 3.1 70B en una H100, Machete mejora ≈ 30 % el rendimiento.

### La tabla de compatibilidad de vLLM

La *compute capability* es el número de generación de una GPU NVIDIA: Volta es 7.0, Turing 7.5, Ampere 8.0 y 8.6, Ada 8.9 y Hopper 9.0. Cada kernel pide un mínimo. La documentación de vLLM (a noviembre de 2026) lo resume así:

| Método | Volta | Turing | Ampere | Ada | Hopper | AMD |
|---|---|---|---|---|---|---|
| AWQ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| GPTQ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Marlin (GPTQ, AWQ, FP8, FP4) | ❌ | ✅* | ✅ | ✅ | ✅ | ❌ |
| FP8 W8A8 de llm-compressor | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| GGUF | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

(*Turing no soporta Marlin en MXFP4. La tabla no tiene columna para Blackwell.)

La fila que más decide es la de FP8: de las columnas de la tabla, **solo Ada, Hopper y AMD calculan en FP8** (Blackwell también, según la misma documentación, aunque la tabla no tenga su columna). En una A100 (Ampere), vLLM corre un checkpoint FP8 como «solo pesos» con Marlin: lee 1 byte por peso, pero multiplica en FP16. Ahorra memoria y ancho de banda, pero no gana los núcleos de FP8. El catálogo de GPUs de esta app (`/herramientas/catalogo/`) marca cuáles tienen FP8 y FP4; a noviembre de 2026, la L40S tiene FP8 y no FP4, y la A100 no tiene ninguno de los dos.

:::diagrama formatos-cuantizacion-hardware
Toca cada caja. El recorrido parte de la GPU que tienes y llega al formato que tiene sentido probar, con el examen al final de todos los caminos.
:::

### El despacho: ¿INT4 o FP8 en la L40S?

La L40S es Ada: corre AWQ, GPTQ (los dos con Marlin) y FP8 de verdad, con 733 TFLOPS densos en FP8 contra 362.05 en FP16 (del archivo de GPUs, a noviembre de 2026). Cuál kernel elige vLLM al cargar el AWQ lo imprime el servidor al arrancar: es lo primero que conviene leer. Con eso, la pregunta es qué formato. Las dos fases de una respuesta tiran para lados distintos. Con las eficiencias supuestas del despacho, \(η_m\) = 0.7 del [[ancho-de-banda|ancho de banda]] y \(η_c\) = 0.5 del [[pico-de-calculo|pico de cálculo]]:

:::formula Las dos fases, con el formato de los pesos
t_{token} = frac{W + K}{η_m × B_W}
t_{prefill} = frac{2 × P × T}{η_c × F_{fmt}}
- W: los bytes de los pesos en ese formato; K: los del KV cache que lee la conversación
- B_W: el ancho de banda de la GPU (864 GB/s en la L40S)
- t_{token}: lo que tarda un paso de decode con una conversación
- P: los parámetros; T: los tokens de la pregunta (6,000)
- F_{fmt}: el pico de cálculo en el formato en que se multiplica: FP16 para W4A16, FP8 para W8A8
- t_{prefill}: lo que tarda en leer la pregunta, sin cola
:::

:::cuenta El despacho en una L40S: AWQ contra FP8
Memoria efectiva, \(η_m × B_W\) | 0.7 × 864 GB/s | 604.8 GB/s
KV de una conversación a media respuesta, \(K\) // 6,250 tokens × 256 KiB | 6,250 × 262,144 B | 1.64 GB
AWQ: un token, \(t_{token}\) // \(W\) = 19.32 GB | (19.32 + 1.64) ÷ 604.8 | 34.7 ms → 28.9 tokens/s
FP8: un token, \(t_{token}\) // \(W\) = 34.33 GB | (34.33 + 1.64) ÷ 604.8 | 59.5 ms → 16.8 tokens/s
FLOPs del prefill // 2 × 32.762 × 10⁹ × 6,000 | — | 3.93 × 10¹⁴
AWQ: prefill // multiplica en FP16: \(F\) = 362.05 TFLOPS | 3.93 × 10¹⁴ ÷ (0.5 × 362.05 × 10¹²) | 2.17 s
FP8: prefill // multiplica en FP8: \(F\) = 733 TFLOPS; supuesto: la misma \(η_c\) | 3.93 × 10¹⁴ ÷ (0.5 × 733 × 10¹²) | 1.07 s
Lugar para KV con FP8 // 0.9 × 48 − 2 GB de programa − 34.33 | 43.2 − 2 − 34.33 | 6.87 GB: 3 conversaciones de 8,192 tokens
= FP8 lee la pregunta el doble de rápido, pero escribe más lento que los 20 tokens por segundo **aun con una sola persona**, y casi no deja memoria. En la L40S, para un modelo de 32B, el INT4 gana.
:::

Esta cuenta enseña lo más importante de la sección: **el formato se elige con las dos fases y con tu GPU, no con el tamaño del archivo**. En una H100, con casi cuatro veces el ancho de banda de la L40S, el FP8 del mismo modelo escribe rápido de sobra y su prefill vuela: ahí FP8 es la opción natural. En la L40S, la memoria lenta castiga los 34 GB de FP8 en cada token. (El prefill de 1.07 s supone que el cálculo en FP8 rinde con la misma eficiencia que en FP16; es una cuenta para comparar, no una medición. Y no cambia el sizing: sigue haciendo falta repartir el trabajo entre 3 L40S.)

## Cuantizar el KV cache {Quantizing the KV cache} [extra]

Hasta aquí todo era sobre los pesos. Pero el [[kv-cache|KV cache]] (lo que el modelo guarda de cada token anterior para no recalcularlo, que ves a fondo en [Transformers y LLMs](https://sensei.trueml.app/llms/)) también se puede guardar con menos bits, y en conversaciones largas pesa tanto como el modelo. [[cuantizar-kv-cache|Cuantizar el KV cache]] es guardar las K y las V de cada token en 8 bits (o menos) en vez de 16.

En el despacho, cada token de Qwen3 32B guarda 2 (K y V) × 64 capas × 8 cabezas de K y V ([[gqa|GQA]]) × 128 números × 2 bytes = 262,144 bytes: **256 KiB por token**. Una conversación de 8,192 tokens son ≈ 2.15 GB, y las 8 de diseño, **17.18 GB**: casi lo mismo que los pesos. En FP8, la mitad: 8.59 GB.

Eso compra dos cosas. Caben el doble de conversaciones en la misma memoria. Y cada paso de decode lee la mitad de bytes de KV, así que con muchas conversaciones el paso se acorta: con \(η_m\) = 0.7, una L40S aguanta ≈ 6 conversaciones a media respuesta a 20 tokens por segundo con el KV en 16 bits, y ≈ 13 con el KV en FP8 (sin contar prefills).

### Cómo se pide

- **vLLM**: `--kv-cache-dtype` acepta `fp8` (o `fp8_e4m3` y `fp8_e5m2`) y `auto` (el tipo del modelo). Ojo: con `fp8` a secas, **todas las escalas valen 1.0**, sin calibrar. La documentación recomienda calibrar las escalas con llm-compressor, advierte que algunas capas son más sensibles y ofrece `--kv-cache-dtype-skip-layers` para dejarlas en 16 bits. Las escalas por cabeza de atención solo funcionan con el *backend* de Flash Attention.
- **llama.cpp**: `-ctk` y `-ctv` (`--cache-type-k` y `--cache-type-v`) eligen el tipo de las K y de las V por separado: f16 (por omisión), bf16, f8_e4m3, q8_0, q4_0, q5_0, iq4_nl y otros. q8_0 cuesta 8.5 bits por número, 0.53 de lo que cuesta f16.

:::ojo Nadie publica cuánto pierde
Ni vLLM ni llama.cpp publican tablas oficiales de cuánta calidad se pierde con el KV cache cuantizado. Hay pruebas de usuarios, con resultados que no coinciden. Si lo prendes, lo pruebas con tu examen igual que el formato de los pesos, y con **conversaciones tan largas como las tuyas**: el error del KV se acumula con el largo del contexto.
:::

## Medir la pérdida: perplejidad, divergencia KL y flips {Measuring the loss: perplexity, KL divergence and flips}

Cada formato cambia un poco las respuestas. ¿Cuánto? Hay tres reglas para medirlo, de la más barata a la más útil, y cada una ve algo que las otras no ven.

### Perplejidad

Un LLM, en cada posición de un texto, da una probabilidad a cada token posible. La **[[perplejidad|perplejidad]]** (*perplexity*, PPL) toma un texto real y mira qué probabilidad le dio el modelo al token que de verdad seguía:

:::formula Perplejidad
PPL = exp(− frac{1}{T} sum_{t=1}^{T} ln q(c_t))
- T: los tokens del texto de prueba
- c_t: el token que de verdad sigue en la posición \(t\)
- q(c_t): la probabilidad que el modelo le dio a ese token
- PPL: la perplejidad; 1 si siempre acierta con probabilidad 1, más alta cuanto más se sorprende
:::

Se lee como «entre cuántos tokens duda el modelo, en promedio». Una perplejidad de 6 es como si en cada paso dudara entre 6 opciones igual de probables. Es barata (basta un texto, sin respuestas ni jueces) y por eso todos los papers la reportan. Su punto ciego: solo mira el token correcto. Si el modelo cuantizado cambia las probabilidades de todos los demás, la perplejidad casi no se entera.

### Divergencia KL

La **[[divergencia-kl|divergencia KL]]** (*Kullback-Leibler*) compara la distribución completa del modelo cuantizado contra la del original, token por token:

:::formula Divergencia KL en una posición
KL(p ‖ q) = sum_{k} p_k × ln frac{p_k}{q_k}
- p_k: la probabilidad que el modelo **original** le da al token \(k\)
- q_k: la que le da el cuantizado
- KL: 0 si las dos distribuciones son idénticas; crece cuanto más se separan
:::

Se promedia sobre todas las posiciones de un texto. No necesita saber cuál era el token correcto: solo necesita los dos modelos. Su costo es guardar las probabilidades del original: para LLaMA 3 con WikiText-2, el archivo de referencia mide 37 GiB. Junto con la KL, llama.cpp reporta **«same top p»**: el porcentaje de posiciones en que los dos modelos eligen el mismo token favorito.

La tabla oficial del README de `llama-perplexity` para LLaMA 3 8B, sin imatrix, medida en una RTX 4090:

| Tipo | Tamaño | PPL | KL media | Mismo favorito |
|---|---|---|---|---|
| f16 | 14.97 GiB | 6.2332 | 0.00055 | — |
| q8_0 | 7.96 GiB | 6.2343 | 0.00136 | 97.7 % |
| q4_K_M | 4.58 GiB | 6.4071 | 0.0313 | 91.9 % |
| q2_K | 2.96 GiB | 9.7516 | 0.4451 | 71.1 % |

Lee la fila de q4_K_M con cuidado. La perplejidad sube solo 2.8 %. Pero en ≈ 8 de cada 100 tokens el modelo cambia de favorito. En un texto de 500 tokens eso son ≈ 40 bifurcaciones: el texto que escribe ya no es el mismo. Que sea **peor** es otra pregunta, y la contesta un examen. (La fila f16 no da KL cero porque las probabilidades de referencia se guardan comprimidas a 16 bits.)

Míralo en un modelo de juguete. El código inventa 2,000 posiciones con un vocabulario de 50 tokens, simula la cuantización como un ruido sobre los logits y mide las tres cosas:

```python
import random, math
random.seed(3)

def softmax(z):
    m = max(z); e = [math.exp(x - m) for x in z]; s = sum(e)
    return [x / s for x in e]

V, T = 50, 2000                                  # vocabulario chico, 2,000 posiciones
base = [[random.gauss(0, 2) for _ in range(V)] for _ in range(T)]
correcto = [max(range(V), key=lambda k: z[k] + random.gauss(0, 2)) for z in base]

for ruido in (0.0, 0.1, 0.3, 1.0):               # cuánto mueve los logits la cuantización
    nll = kl = iguales = 0.0
    for z, c in zip(base, correcto):
        p = softmax(z)                                         # el modelo original
        q = softmax([x + random.gauss(0, ruido) for x in z])   # el cuantizado
        nll -= math.log(q[c])
        kl += sum(pi * math.log(pi / qi) for pi, qi in zip(p, q))
        iguales += p.index(max(p)) == q.index(max(q))
    print(f"ruido {ruido:.1f}: perplejidad {math.exp(nll / T):5.2f} · "
          f"KL media {kl / T:.4f} · mismo favorito {iguales / T:6.1%}")
```

```salida
ruido 0.0: perplejidad 12.93 · KL media 0.0000 · mismo favorito 100.0%
ruido 0.1: perplejidad 12.97 · KL media 0.0041 · mismo favorito  93.7%
ruido 0.3: perplejidad 13.31 · KL media 0.0372 · mismo favorito  81.7%
ruido 1.0: perplejidad 18.31 · KL media 0.3999 · mismo favorito  48.7%
```

Con un ruido de 0.1, la perplejidad sube 0.3 % (de 12.93 a 12.97): parece nada. Pero en 6 de cada 100 posiciones el favorito ya es otro, y la KL lo nota. Por eso la KL y el «mismo favorito» son mejores alarmas que la perplejidad para comparar dos versiones del **mismo** modelo.

### Flips: las respuestas que cambian

La regla que más se parece a lo que le importa al despacho mira respuestas completas. «Accuracy is Not All You Need» (Dutta y otros, 2024) definió los **[[flips|flips]]**: el porcentaje de preguntas de un examen cuya respuesta pasó de bien a mal **o** de mal a bien al cuantizar. La exactitud solo ve la resta de las dos; los flips ven la suma.

En MMLU (un examen de opción múltiple muy usado), Llama 2 7B cuantizado a 8 bits con bitsandbytes pierde solo **0.30 puntos** de exactitud, pero cambia **4.15 %** de sus respuestas. A 4 bits pierde 1.51 puntos y cambia 10.65 %. Las dos medidas, flips y KL, se mueven juntas (correlación de Spearman de 0.981 en MMLU), y en generación libre los modelos comprimidos salieron claramente peores aunque la exactitud de opción múltiple se viera igual. La lección: **una exactitud casi igual puede esconder muchas respuestas distintas**.

## El examen del despacho: cuánto pierdo y si es ruido {The firm's exam: how much do I lose, and is it noise?}

Ahora junta todo. ¿Cuánto pierde Qwen3 32B en INT4 de AWQ? Hay dos fuentes, y **no coinciden**.

La ficha oficial de `Qwen/Qwen3-32B-AWQ` compara bf16 contra AWQ-int4 en varios benchmarks. En el modo sin razonamiento, el que usa el despacho (lo apaga para no gastar tokens antes de cada respuesta):

| Benchmark | bf16 | AWQ-int4 | Diferencia |
|---|---|---|---|
| LiveBench 2024-11-25 | 59.8 | 59.8 | 0.0 |
| GPQA | 54.6 | 53.1 | −1.5 |
| MMLU-Redux | 85.7 | 85.6 | −0.1 |

Casi nada. Pero un estudio independiente, «An Empirical Study of Qwen3 Quantization» (2025), cuantizó Qwen3-32B con su propia implementación, solo pesos con grupos de 128, y midió otra cosa:

| Qwen3-32B | Wiki2 PPL | MMLU |
|---|---|---|
| FP16 | 7.61 | 81.2 |
| GPTQ 4 bits | 7.86 | 80.6 |
| AWQ 4 bits | 8.55 | 78.0 |

Ahí AWQ pierde **3.2 puntos** de MMLU y GPTQ solo 0.6: al revés de lo que viste en Llama 2. ¿Quién tiene razón? Probablemente los dos, midiendo cosas distintas: otro benchmark (MMLU contra MMLU-Redux), otro archivo (el de los autores, no el oficial de Qwen), quizá otros datos de calibración. La ficha de Qwen no publica intervalos de confianza ni cuántas preguntas usó. **No hay forma de saber, desde afuera, cuánto pierde el archivo que vas a servir en las preguntas que te importan.** Por eso el despacho tiene su propio examen.

### El examen, pareado

El despacho corre sus 200 preguntas dos veces: con el modelo en BF16 (en una GPU rentada durante la prueba piloto) y con el AWQ. El [[error-estandar|error estándar]] de una exactitud de 85 % con 200 preguntas es \(sqrt{0.85 × 0.15 ÷ 200}\) ≈ 2.5 puntos: si comparara los dos puntajes como si fueran exámenes independientes, una diferencia de 1 o 2 puntos sería puro ruido. Pero no son independientes: son **las mismas** preguntas. Eso permite una comparación pareada mucho más fina, que Sensei presenta en [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/): solo cuentan las preguntas que cambiaron.

:::formula Pérdida y ruido, con las mismas preguntas
Δ = frac{c − b}{N}
ruido = 1.96 × frac{sqrt{b + c}}{N}
- N: las preguntas del examen (200)
- b: los flips de bien a mal: preguntas que el original contestaba bien y el cuantizado no
- c: los flips de mal a bien
- Δ: el cambio de exactitud del cuantizado (negativo si pierde)
- ruido: el margen del 95 %; si \(|Δ|\) es menor, la diferencia no se distingue del azar
:::

:::cuenta El AWQ del despacho contra BF16 (supuesto del ejemplo)
Aciertos del original // supuesto: 176 de \(N\) = 200 | 176 ÷ 200 | 88 %
Flips de bien a mal, \(b\) // supuesto | — | 9
Flips de mal a bien, \(c\) // supuesto | — | 7
Aciertos del AWQ // 176 − \(b\) + \(c\) | 176 − 9 + 7 | 174 (87 %)
Cambio, \(Δ\) | (7 − 9) ÷ 200 | −1 punto
Ruido pareado // \(b + c\) = 16 flips | 1.96 × √16 ÷ 200 | ±3.9 puntos
Ruido si se trataran como independientes // 88 % contra 87 % | 1.96 × √(0.88 × 0.12 ÷ 200 + 0.87 × 0.13 ÷ 200) | ±6.5 puntos
Criterio de aceptación // ≥ 170 bien | 174 ≥ 170 | pasa
= Perder 1 punto no se distingue del ruido, y el AWQ pasa el criterio. Pero 16 de 200 preguntas (8 %) cambiaron de respuesta: hay que leerlas.
:::

Fíjate en la última línea. Que la exactitud empate no quiere decir que nada cambió: 16 respuestas son distintas. El despacho las lee, porque en su caso no todas las preguntas pesan igual: si los 9 flips a mal son todos de contratos en inglés, o de citas de página, eso es un hallazgo aunque el total pase.

:::calculadora formatos-cuantizacion-examen
Empieza con el supuesto del texto: 176 aciertos, 9 flips a mal y 7 a bien. Sube los flips a mal a 15 y baja los otros a 3: ahora pierde 6 puntos, más que el ruido, y no pasa el criterio. Prueba también 30 y 28: casi la misma exactitud, pero 29 % de las respuestas cambiaron.
:::

:::ojo Lo que el examen no ve
Un examen de 200 preguntas con respuesta corta mide si la respuesta es correcta y si la cita existe. No mide si el texto largo se volvió más repetitivo o más torpe. La ficha de los GGUF de Qwen3 recomienda subir el `presence_penalty` a 1.5 en modelos cuantizados «para suprimir salidas repetitivas»: es una pista de que eso pasa. Si el despacho usa resúmenes largos, su examen necesita algunas preguntas de ese tipo, revisadas por una persona.
:::

## Cuantizar tú mismo: receta, datos de calibración y herramientas {Quantizing it yourself: recipe, calibration data and tools} [extra]

El despacho tiene suerte: Qwen publica su propio AWQ, su FP8 y sus GGUF. Con muchos modelos, o con un modelo propio ajustado, no hay archivo hecho y te toca cuantizar. La receta general es la misma con cualquier herramienta:

:::pasos
1. Parte del modelo original en BF16
Nunca cuantices un archivo ya cuantizado: los errores se suman. Descarga el original y guárdalo; es la referencia del examen.
2. Elige formato por tu GPU y tu servidor
Con la tabla de kernels: W4A16 (GPTQ o AWQ) en casi cualquier NVIDIA desde Turing; FP8 si tu GPU lo calcula y te sobra memoria; GGUF si sirves con llama.cpp o en CPU y Mac.
3. Junta los datos de calibración
Unas decenas o cientos de textos parecidos a lo que el modelo va a leer: GPTQ en llm-compressor recomienda 512 muestras; AWQ funciona con mucho menos. El texto genérico funciona sorprendentemente bien; uno demasiado estrecho puede afinar el modelo para lo que no es.
4. Cuantiza y guarda la receta
llm-compressor (GPTQ, AWQ, FP8, INT8) para vLLM; GPTQModel para GPTQ y AWQ; `llama-quantize` (con `--imatrix` si bajas de 4 bits) para GGUF. Guarda la versión de la herramienta, la receta y los datos: es la única forma de repetirlo.
5. Corre el examen pareado
Las mismas preguntas con el original y con el cuantizado: exactitud, flips, y si puedes, la KL en unos textos tuyos. Lee los flips a mal.
:::

### Los datos de calibración son datos

Un detalle que en un despacho importa: los datos de **[[calibracion|calibración]]** pasan por el modelo, y GPTQ y AWQ guardan estadísticas de ellos (no los textos) para elegir los números. Si el despacho calibra con sus propios expedientes, eso pasa dentro de su red, como todo lo demás: no hay ningún riesgo extra si la cuantización se corre en sus máquinas, pero sí si se manda a un servicio externo. Y no hace falta: el texto genérico funciona, y AWQ es poco sensible a que la calibración se parezca al uso real.

### Cuánto tarda

Cuantizar es mucho más barato que entrenar. GPTQ cuantizó un modelo de 175 mil millones de parámetros en ≈ 4 horas de una A100. AWQ necesita aún menos cálculo, porque no reconstruye nada. Un modelo de 32B se cuantiza en una GPU con memoria suficiente para cargarlo por partes; la memoria, no el tiempo, suele ser lo que decide en qué máquina se hace.

## Errores comunes {Common mistakes}

1. **Calcular el tamaño con 4 bits exactos.** 32.762 mil millones × 0.5 bytes = 16.38 GB, pero el archivo AWQ pesa 19.32: las escalas, los puntos cero y las tablas de tokens en 16 bits suman ≈ 18 %. **Cómo evitarlo:** usa \(b_{ef} = b + (b_s + b_z) ÷ G\) y deja las tablas aparte, o lee el tamaño de los archivos del repositorio.
2. **Creer que «4 bits» es un formato.** Un AWQ, un GPTQ, un Q4_K_M y un NVFP4 tienen «4 bits» y son cuatro cosas distintas, con distinto error, distinto tamaño y distintos kernels. **Cómo evitarlo:** nombra siempre las tres capas: formato, algoritmo y kernel.
3. **Elegir FP8 «porque es casi sin pérdida» sin mirar la GPU.** En una A100 corre como solo pesos; en una L40S con un modelo de 32B escribe a menos de 20 tokens por segundo con una persona. **Cómo evitarlo:** haz la cuenta de las dos fases con tu GPU: \(t_{token}\) con los bytes del formato y \(t_{prefill}\) con los TFLOPS del formato en que multiplica.
4. **Medir solo la perplejidad.** Sube 2.8 % con q4_K_M y parece nada, pero 8 de cada 100 tokens cambian de favorito. **Cómo evitarlo:** mira la KL y el «mismo favorito» para comparar versiones del mismo modelo, y tu examen para decidir.
5. **Comparar dos puntajes del examen como si fueran independientes.** Con 200 preguntas, el ruido así es de ±6.5 puntos y nada se distingue. **Cómo evitarlo:** corre las mismas preguntas con los dos modelos, cuenta los flips y usa el ruido pareado, \(1.96 × sqrt{b + c} ÷ N\).
6. **Confiar en el benchmark de otro.** La ficha de Qwen dice −0.1 en MMLU-Redux para el AWQ; un estudio independiente dice −3.2 en MMLU. **Cómo evitarlo:** esos números son pistas para la shortlist; el criterio de aceptación se mide con tu examen, en tu configuración.
7. **Prender el KV cache en FP8 sin probar.** Con `fp8` a secas en vLLM todas las escalas valen 1.0, y nadie publica cuánto pierde. **Cómo evitarlo:** calibra las escalas, prueba con conversaciones tan largas como las tuyas y mídelo en el examen como cualquier otro cambio.

## En la vida real {In real life}

**El despacho.** Qwen3 32B en INT4 de AWQ, el archivo oficial de Qwen: 19.32 GB, ≈ 4.72 bits por parámetro. En la L40S (Ada) lo sirve vLLM con un kernel de W4A16; en el decode escribe a ≈ 28.9 tokens por segundo con una conversación, contra 16.8 del FP8, que además se come la memoria del KV cache. FP8 leería la pregunta de 6,000 tokens en ≈ 1.07 s en vez de 2.17, pero no compensa. Lo que el despacho hace con esta lección: (1) se queda con el AWQ oficial y anota que AutoAWQ está archivado, por si algún día cuantiza un modelo propio con llm-compressor; (2) en la prueba piloto corre sus 200 preguntas con BF16 y con el AWQ, cuenta los flips, y lee cada flip a mal; (3) agrega a su examen unas preguntas de resumen largo, revisadas por una abogada, porque el examen de respuesta corta no ve la repetición; (4) prueba el KV cache en FP8 solo si la memoria aprieta, y con el mismo examen.

**Una clínica con un asistente en una laptop.** Supuesto del ejemplo: una clínica chica quiere un asistente para ordenar notas médicas en la computadora de cada consultorio, sin GPU de servidor: Macs con 32 GB de [[memoria-unificada|memoria unificada]]. Ahí no hay vLLM ni Marlin: hay llama.cpp (o Ollama) con GGUF, o MLX. Un modelo de 8B en Q4_K_M ocupa ≈ 4.9 GB y deja memoria de sobra; en Q8_0, ≈ 8.5 GB, y pierde mucho menos (son las cifras de Llama 3.1 8B del README de llama.cpp). Como cada consultorio atiende a una persona a la vez, el batch es 1 y la velocidad la pone el [[ancho-de-banda|ancho de banda]]: el Q4_K_M lee ≈ 1.7 veces menos bytes por token y escribe ≈ 1.7 veces más rápido que el Q8_0. La clínica elige con su propio examen de notas, no con la perplejidad.

**Un servicio de chat grande en GPUs Blackwell.** Supuesto del ejemplo: una empresa que sirve un MoE grande a miles de usuarios en B200. Con batches enormes el cálculo pesa tanto como la memoria, y un W4A16 no ayuda en el cálculo: multiplica en 16 bits. NVFP4 sí, porque los Tensor Cores de Blackwell multiplican en FP4. Aquí cuantizar no es para que quepa: es para que cada GPU atienda a más gente. La lección es la misma: el formato se elige por la GPU y por cómo se usa.

**Fuera de las computadoras: la foto en el celular.** Una foto de 12 megapíxeles en JPEG pesa ≈ 10 veces menos que sin comprimir y a simple vista se ve igual. Pero si la imprimes en grande, o le subes el contraste, aparecen los bloques de 8 × 8 píxeles de la compresión. Un modelo cuantizado es igual: en las preguntas fáciles no se nota, y la diferencia aparece justo en lo exigente. Por eso el examen se hace con las preguntas difíciles de verdad.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un checkpoint GPTQ simétrico (sin punto cero) usa grupos de 128 y escalas en FP16. ¿Cuántos bits efectivos cuesta cada peso, y cuánto pesaría Qwen3 32B con las tablas de tokens en 16 bits?
\(b_{ef}\) = 4 + (16 + 0) ÷ 128 = **4.125 bits**. Pesos cuantizados: 31.206 × 10⁹ × 4.125 ÷ 8 ≈ 16.09 GB; tablas: 3.11 GB. Total ≈ **19.20 GB**, 0.12 GB menos que el AWQ con punto cero.
? [facil] Un superbloque Q6_K tiene 256 pesos de 6 bits, 16 escalas de 8 bits (una por cada bloque de 16) y una escala en FP16. ¿Cuántos bytes ocupa y cuántos bits por peso?
Pesos: 256 × 6 ÷ 8 = 192 bytes. Escalas de bloque: 16 × 1 = 16 bytes. Escala del superbloque: 2 bytes. Total **210 bytes**; 210 × 8 ÷ 256 = **6.5625 bpw**.
? [facil] ¿Cuántos bits por valor cuestan NVFP4 y MXFP4, sin contar la escala por tensor de NVFP4? ¿Por qué NVFP4 paga más?
NVFP4: 4 + 8 ÷ 16 = **4.5**. MXFP4: 4 + 8 ÷ 32 = **4.25**. NVFP4 tiene bloques de 16 en vez de 32 (la escala se reparte entre menos valores) y su escala es E4M3, que puede valer cualquier número, no solo potencias de 2: compra precisión con un cuarto de bit.
? [facil] En la tabla de llama.cpp para LLaMA 3 8B, ¿en cuántos tokens de cada 100 cambia el favorito con q8_0 y con q4_K_M? Una respuesta del despacho tiene 500 tokens: ¿cuántas bifurcaciones esperarías con q4_K_M?
q8_0: 100 − 97.7 ≈ **2.3** de cada 100. q4_K_M: 100 − 91.9 ≈ **8.1**. En 500 tokens, ≈ 500 × 0.081 ≈ **40** posiciones donde el cuantizado elige otro token. Cada bifurcación cambia todo lo que sigue, así que el texto será distinto aunque diga lo mismo. (Es un modelo distinto del del despacho: sirve como orden de magnitud.)
? [medio] Con la cuenta de las dos fases, ¿cuántos tokens por segundo daría Qwen3 32B en BF16 (65.52 GB de pesos) en una L40S con una conversación de 6,250 tokens (\(η_m\) = 0.7)? ¿Cabría siquiera?
\(t_{token}\) = (65.52 + 1.64) ÷ 604.8 ≈ 111 ms → ≈ **9 tokens/s**. Y no cabe: 65.52 GB de pesos contra 48 GB de la tarjeta. Por eso nadie sirve un 32B en BF16 en una L40S: la cuantización es la que lo hace posible, no un adorno.
? [medio] En la cuenta de GPTQ con dos pesos, cambia el supuesto: las entradas se parecen a medias, \(E[x_1 x_2] ÷ E[x_2^2]\) = 0.5. ¿Cuánto se le suma a \(w_2\), en qué escalón cae y cuál es la suma de pesos?
\(δ_2\) = −(−0.11) × 0.5 = +0.055. \(w_2\) corregido = 0.36 + 0.055 = 0.415; 0.415 ÷ 0.25 = 1.66 → **2 escalones** → 0.50. Suma: 0.25 + 0.50 = **0.75**. Aquí el redondeo salió igual que con la compensación completa; lo que cambia es que, con entradas que no son iguales, la salida ya no depende solo de la suma, y GPTQ minimiza el error esperado con los datos, no el de una sola cuenta.
? [medio] El despacho corre sus 200 preguntas con BF16 (176 bien) y con un GPTQ: 12 flips de bien a mal y 4 de mal a bien. ¿Cuánto pierde, es ruido, y pasa el criterio?
Aciertos: 176 − 12 + 4 = **168** (84 %). \(Δ\) = (4 − 12) ÷ 200 = **−4 puntos**. Ruido pareado: 1.96 × √16 ÷ 200 ≈ ±3.9 puntos. |−4| > 3.9: **se distingue del ruido**, por poco. Y 168 < 170: **no pasa** el criterio. Los mismos 16 flips del AWQ del texto, pero repartidos 12 a 4 en vez de 9 a 7.
? [medio] ¿Cuánto KV cache ocupan 8 conversaciones de 8,192 tokens de Qwen3 32B en BF16, en FP8 y en q8_0 de llama.cpp?
Por token, en BF16: 2 × 64 × 8 × 128 × 2 = 262,144 bytes. 8 × 8,192 × 262,144 ≈ **17.18 GB**. En FP8 (1 byte por número), la mitad: **8.59 GB**. En q8_0 (8.5 bits por número = 0.53 de f16): 17.18 × 8.5 ÷ 16 ≈ **9.13 GB**.
? [reto] El despacho quiere detectar una pérdida de 1 punto con su examen pareado. Si al cuantizar cambia el 8 % de las respuestas (flips a mal y a bien juntos), ¿cuántas preguntas necesita como mínimo?
Con \(N\) preguntas hay ≈ 0.08 \(N\) flips, y la pérdida es 0.01 \(N\) preguntas. Se distingue si \(c − b\) supera el ruido: 0.01 \(N\) > 1.96 × √(0.08 \(N\)). Elevando al cuadrado: 0.0001 \(N^2\) > 3.8416 × 0.08 \(N\) → \(N\) > 3.8416 × 0.08 ÷ 0.0001 ≈ **3,073 preguntas**. Con 200 no se puede ver una pérdida de 1 punto; sí una de ≈ 4. Para pérdidas chicas, lo que el despacho puede hacer con 200 es leer los flips, no medirlos.
? [reto] Una empresa tiene una A100 de 80 GB y duda entre el FP8 oficial de Qwen3 32B (34.33 GB) y el AWQ (19.32 GB). Usa lo que sabes de los kernels: ¿qué gana y qué no con cada uno? Con \(η_m\) = 0.7 y el ancho de banda de la A100 de 80 GB (2,039 GB/s), ¿cuántos tokens por segundo daría cada uno con una conversación de 6,250 tokens?
La A100 es Ampere: **no calcula en FP8**. vLLM corre el FP8 como solo pesos (W8A16) con Marlin: ahorra memoria respecto a BF16, pero multiplica en FP16, así que el prefill no se acelera. El AWQ también multiplica en FP16. Decode: memoria efectiva 0.7 × 2,039 ≈ 1,427 GB/s. FP8: (34.33 + 1.64) ÷ 1,427 ≈ 25.2 ms → ≈ **40 tokens/s**. AWQ: (19.32 + 1.64) ÷ 1,427 ≈ 14.7 ms → ≈ **68 tokens/s**. En la A100 el AWQ gana en velocidad y en memoria; el FP8 solo tendría a favor una calidad algo más cercana al original, que se mide con el examen.
? [reto] Explica con números por qué el estudio de Qwen3 y la ficha de Qwen pueden no contradecirse, y qué haría falta para saber si los −3.2 puntos de MMLU del estudio son ruido.
Miden cosas distintas: MMLU contra MMLU-Redux (otro conjunto de preguntas, corregido), un AWQ hecho por los autores contra el archivo oficial, quizá otra calibración. Para saber si −3.2 es ruido haría falta el tamaño del examen y, mejor, los flips. Con un examen grande, de miles de preguntas, el error estándar de una exactitud de ≈ 80 % es de décimas de punto (con 10,000 preguntas, √(0.8 × 0.2 ÷ 10,000) = 0.4 puntos): 3.2 puntos serían muy difíciles de explicar con azar. Pero eso dice que **ese** archivo pierde en **ese** examen; no dice cuánto pierde el archivo del despacho en sus 200 preguntas legales. Por eso la decisión sale del examen propio.
:::

## Lo que sigue {What comes next}

- **«Speculative decoding y contexto largo»**, la siguiente lección de este módulo, ataca el mismo límite del decode desde otro lado: en vez de leer menos bytes por token, sacar más de un token por cada lectura de los pesos. Y el contexto largo hace crecer justo el KV cache que aquí aprendiste a cuantizar.
- **«Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM»** pone los formatos en programas concretos: cuál lee GGUF, cuál AWQ y FP8, y qué kernel usa cada uno.
- **«Comprar hardware: de la workstation al rack»** retoma qué GPU calcula en FP8 y en FP4, porque esa columna de la hoja de datos decide qué formatos te sirven.
- La [herramienta de VRAM](/herramientas/vram/) hace la cuenta completa de memoria con cada formato, y el [catálogo de GPUs](/herramientas/catalogo/) dice cuáles calculan en FP8 y en FP4.
- En Sensei: [Cómo guarda números una computadora](https://sensei.trueml.app/numeros-maquina/) tiene los cimientos (escala, punto cero, INT4 y FP8), y [Ruido, muestras y pruebas A/B](https://sensei.trueml.app/ruido/), la estadística de la comparación pareada.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
gguf k-quant imatrix gptq awq fp8-dinamico fp4 calibracion solo-pesos kernel-de-cuantizacion outlier perplejidad divergencia-kl flips cuantizar-kv-cache
:::

## Chequeo {Check}

:::chequeo
? ¿Cuáles son las tres capas que se mezclan cuando alguien dice «lo bajé en 4 bits»?
El formato de archivo (cómo se guardan enteros y escalas), el algoritmo (cómo se eligen, como GPTQ o AWQ) y el [[kernel-de-cuantizacion|kernel]] (el programa de la GPU que los lee y multiplica).
? ¿Por qué el AWQ del despacho pesa 19.32 GB y no 16.38?
Porque cada grupo de 128 pesos guarda una escala de 16 bits y un punto cero de 4 (≈ 4.156 bits por peso) y las [[tablas-de-tokens|tablas de tokens]] se quedan en 16 bits (3.11 GB).
? ¿Qué hace GPTQ que no hace el redondeo simple?
Cuando redondea un peso, mueve los pesos que faltan para compensar el error, usando cómo se mueven juntas las entradas de la capa en los datos de calibración (el Hessiano).
? ¿Cómo encuentra AWQ los pesos importantes y cómo los protege?
Por el tamaño de sus **activaciones**, no de los pesos. Los protege multiplicando el peso por \(s\) y dividiendo la activación entre \(s\): la cuenta no cambia y el error del redondeo llega dividido entre \(s\).
? En la L40S, ¿por qué el FP8 de Qwen3 32B lee la pregunta más rápido que el AWQ pero escribe más lento?
Porque en el prefill manda el cálculo y FP8 multiplica en núcleos de FP8 (733 contra 362 TFLOPS); en el decode manda la memoria, y FP8 lee 34.33 GB por token contra 19.32.
? ¿Qué ve la divergencia KL que no ve la perplejidad?
La perplejidad solo mira la probabilidad del token correcto; la KL compara la distribución completa del cuantizado contra la del original, y nota cuando cambian los demás tokens o el favorito.
? Con 200 preguntas, 9 flips a mal y 7 a bien, ¿se distingue la pérdida del ruido?
No: pierde (9 − 7) ÷ 200 = 1 punto, y el ruido pareado es 1.96 × √16 ÷ 200 ≈ ±3.9 puntos. Pero 16 respuestas cambiaron, y hay que leerlas.
:::
