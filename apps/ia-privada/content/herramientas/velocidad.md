---
titulo: Qué tan rápido contesta
en: LLM speed calculator
subtitulo: Cuántos tokens por segundo escribe un modelo abierto en una GPU y cuánto tarda en empezar a contestar, con la cuenta completa y contra benchmarks publicados.
pregunta: Ya sé que el modelo cabe en la GPU. ¿Va a contestar rápido, o la gente se va a desesperar?
sensei: flops, llms, latencia, cpu-gpu
---

:::idea
Un LLM contesta en dos tiempos. Primero lee todo tu mensaje de golpe, el [[prefill]]; eso decide cuánto esperas a ver la primera palabra, el [[ttft|TTFT]]. Luego escribe la respuesta token por token, el [[decode]]; eso decide qué tan rápido corre el texto. El prefill lo frena el **cálculo** de la GPU; el decode, casi siempre, la **memoria**: en cada token hay que leer todos los pesos. Esta página saca los dos tiempos de las hojas de datos de la GPU, explica de dónde sale cada número y compara la cuenta contra mediciones publicadas.
:::

## Qué responde esta calculadora {What this calculator answers}

Que un modelo quepa en la GPU no quiere decir que sirva. Si cada respuesta tarda un minuto, nadie la usa. Así que la segunda pregunta de cualquier proyecto de IA privada es la velocidad, y tiene dos partes que el usuario siente distinto:

- **Cuánto espera antes de ver algo.** Es el tiempo al primer token, el [[ttft|TTFT]]. Si pasa de uno o dos segundos, la gente cree que se trabó.
- **Qué tan rápido corre el texto después.** Son los tokens por segundo de cada conversación. Una persona lee del orden de 5 a 10 tokens por segundo; si el modelo escribe más rápido que eso, la respuesta se siente fluida.

Piensa en un traductor en una conferencia. Primero escucha la pregunta completa (el prefill) y luego la va diciendo en otro idioma, palabra por palabra (el decode). Si tarda en arrancar, el público se impacienta. Si arranca rápido pero habla muy despacio, también.

Las fórmulas son las de Sensei (lección «Matrices y FLOPs»): ahí se explica por qué el decode depende de los bytes y el prefill de los FLOPs. Esta calculadora las junta, les agrega lo que tiene un modelo de verdad (el KV cache, la atención, los modelos MoE, varias GPUs) y les pone un ajuste medido: la eficiencia.

## El decode: leer todos los pesos por cada token {Decode}

Para escribir un token, el modelo hace pasar un solo vector por todos sus bloques. En cada bloque multiplica ese vector por sus matrices de [[pesos]]. Para un solo token eso son pocas cuentas, pero exige **traer todos los pesos de la memoria** al lugar donde la GPU calcula. Y el siguiente token necesita traerlos otra vez.

Imagina a un cocinero rapidísimo con la despensa en el sótano. Por cada platillo baja, sube todos los ingredientes, cocina en un segundo y los vuelve a guardar. Lo que tarda no es cocinar: es la escalera. En la GPU, la escalera es el [[ancho-de-banda|ancho de banda de memoria]]: cuántos bytes por segundo pasan de la [[vram|VRAM]] a los núcleos. Una H100 SXM mueve 3,350 GB por segundo; una L4, 300.

Además de los pesos, cada paso lee el [[kv-cache|KV cache]] de cada conversación: lo que el modelo recuerda de los tokens anteriores. Mientras más larga la conversación, más hay que leer.

:::formula Un paso de decode
D_{paso} = W × A ÷ P + b × m_{token} × N_{medio}
t_{paso} = D_{paso} ÷ (n × W_{GPU})
v_{techo} = 1 ÷ t_{paso}
- W: lo que ocupan los pesos, en bytes (la fórmula de «¿Cabe en la GPU?»)
- A ÷ P: la parte de los pesos que usa cada token; 1 en un modelo normal, ≈ 0.11 en Qwen3 30B-A3B
- b: las conversaciones que van en el mismo paso, el [[batch]]
- m_{token}: los bytes de KV cache de un token, \(2 × L × g × d × b_{kv}\)
- N_{medio}: los tokens que lleva cada conversación a media respuesta, \(N_p + N_o ÷ 2\)
- n: las GPUs de la copia; cada una lee su parte
- W_{GPU}: el ancho de banda de cada GPU, en bytes por segundo
- v_{techo}: los tokens por segundo de cada conversación, si la memoria trabajara al 100 %
:::

Con \(A = P\), \(b\) = 1 y sin KV cache, es la cuenta de Sensei: \(t_{paso} = D_{pesos} ÷ W\).

:::cuenta El techo de Llama 3.1 8B en BF16, en una H100 SXM
Pesos, \(W\) // de «¿Cabe en la GPU?» | (8.030 − 1.051) × 2 + 1.051 × 2 | 16.06 GB
KV cache de una conversación a la mitad // 128 KiB por token; prompt de 1,000 y respuesta de 1,000 | 131,072 × (1,000 + 500) | 0.197 GB
Bytes del paso, \(D_{paso}\) | 16.06 + 0.197 | 16.26 GB
Tiempo del paso // H100 SXM: 3,350 GB/s | 16.26 ÷ 3,350 | 4.85 ms
Techo | 1 ÷ 4.85 ms | **≈ 206 tokens por segundo**
= Ninguna H100 va a pasar de ahí con este modelo y una conversación, por más rápido que calcule: la escalera manda.
:::

### Por qué el batch ayuda tanto {Why batching helps}

Si el cocinero ya subió los ingredientes, puede cocinar diez platillos con el mismo viaje. En la GPU pasa igual: si llegan varias conversaciones, sus tokens viajan juntos y cada peso que se lee se usa para todas. Los pesos se leen una vez por paso, no una vez por conversación; lo que sí crece es el KV cache, porque cada conversación trae el suyo.

Por eso un servidor como vLLM junta las conversaciones en un [[batch]] y entrega muchos más tokens por segundo en total, aunque cada persona reciba un poco menos. Mientras el paso siga limitado por la memoria, \(b\) conversaciones cuestan casi lo mismo que una.

:::cuenta Llama 3.1 8B en BF16 en una H100 SXM, con 32 conversaciones
Bytes del paso // pesos una vez + 32 KV caches de 1,500 tokens | 16.06 + 32 × 0.197 | 22.36 GB
Tiempo del paso | 22.36 ÷ 3,350 | 6.67 ms
Cada conversación, techo | 1 ÷ 6.67 ms | ≈ 150 tokens/s
Todas juntas | 32 × 150 | **≈ 4,800 tokens/s**
= 32 veces más gente atendida a cambio de que cada una reciba ≈ 27 % menos velocidad. Es la razón económica de servir con batch.
:::

### Cuándo el cálculo alcanza a la memoria {When compute catches up}

Cada token, en cada paso, cuesta ≈ \(2 × A\) operaciones (una multiplicación y una suma por peso), más la atención. Con pocas conversaciones eso es nada para la GPU. Pero con un batch grande, las operaciones crecen con \(b\) mientras los pesos se siguen leyendo una sola vez, y en algún punto el cálculo pasa a la memoria. La calculadora toma el mayor de los dos tiempos, que es el [[roofline]] de Sensei aplicado a un paso entero. La fila 5 dice cuál manda: menos de 1×, la memoria ([[memory-bound]]).

## El prefill: leer el prompt de golpe {Prefill}

El prompt sí llega completo. Los 1,000 tokens de una pregunta con contexto pasan juntos por el modelo, y cada peso que se trae de la memoria se usa para los 1,000. Ahora la escalera ya no importa: el cocinero sube los ingredientes una vez y cocina mil platillos. Lo que frena es la cocina, el [[pico-de-calculo|pico de cálculo]] de la GPU.

:::formula El prefill
F_{pre} = 2 × A × N_p + 2 × L × h × d × N_p^2
TTFT ≈ F_{pre} ÷ (n × P_{pico} × η_c)
- F_{pre}: las operaciones del prefill, en FLOPs
- 2 × A × N_p: una multiplicación y una suma por cada peso activo y cada token del prompt
- 2 × L × h × d × N_p^2: la atención; cada token se compara con todos los anteriores, así que crece con el cuadrado del prompt
- h: las cabezas de atención; d: los números de cada una
- P_{pico}: el pico de la GPU en el formato con que calcula (FP16, FP8 o INT8), sin sparsity, en FLOPs por segundo
- η_c: la parte del pico que de verdad se logra
:::

La atención casi no pesa con prompts cortos: con 1,000 tokens en Llama 3.1 8B es el 1.6 % del total. Con 32,000 tokens ya es un tercio. Por eso el TTFT de un prompt larguísimo crece más rápido que el prompt.

:::cuenta El TTFT de Llama 3.1 8B en BF16, en una H100 SXM
FLOPs de los pesos // \(A\) = 8.03 mil millones, prompt de 1,000 | 2 × 8.03 × 10⁹ × 1,000 | 1.606 × 10¹³
FLOPs de la atención // \(L\) = 32, \(h\) = 32, \(d\) = 128 | 2 × 32 × 32 × 128 × 1,000² | 0.026 × 10¹³
Total, \(F_{pre}\) | 1.606 + 0.026 | 1.63 × 10¹³ FLOPs
Al pico // H100 SXM: 989.5 TFLOPS en BF16, sin sparsity | 1.63 × 10¹³ ÷ 989.5 × 10¹² | 16.5 ms
Con \(η_c\) = 0.5 | 16.5 ÷ 0.5 | **≈ 33 ms**
= Una fracción de segundo. En una GPU de centro de datos el TTFT casi nunca es el problema con un solo usuario; lo es cuando llegan muchos prompts largos a la vez y hacen fila.
:::

:::ojo
Las hojas de datos de NVIDIA suelen dar el pico **con sparsity**, una función que duplica la cifra y que los servidores de LLMs casi nunca usan. Los picos de gpus.json ya vienen divididos entre 2: son densos. Si copias un pico de una página de NVIDIA, revisa el asterisco.
:::

El TTFT de la calculadora es el de un prompt que llega solo, con la GPU libre. En un servidor ocupado se suma la espera en la fila; eso lo cuenta la herramienta «Cuántas GPUs hacen falta».

## La eficiencia: del techo a lo que mides {Efficiency}

Ninguna GPU lee su memoria al 100 % ni calcula a su pico. Siempre hay tiempo que se pierde: lanzar cada operación, sincronizar, partes del modelo que no son multiplicaciones grandes. La calculadora lo resume en dos números:

- **\(η_m\), la [[eficiencia]] de la memoria.** La parte del ancho de banda que se aprovecha en el decode. En los benchmarks de abajo va de 0.31 a 0.85 según el servidor y la GPU. La calculadora arranca en 0.7.
- **\(η_c\), la eficiencia del cálculo.** La parte del pico que se aprovecha en el prefill. Arranca en 0.5; en los benchmarks de abajo va de ≈ 0.25 (llama.cpp en una RTX 4090) a ≈ 0.6 (NIM en una H100).

Es como el rendimiento de gasolina de un coche: la agencia publica un número de laboratorio y tú, en el tráfico, logras una parte. Si sabes cuál parte, predices bien. Por eso la calculadora muestra el techo (fila 2, la cuenta de Sensei) y la estimación (fila 3) por separado: el techo es física; la estimación es física más experiencia.

:::calculadora velocidad
Cada resultado trae su cuenta con los números del momento. Las GPUs salen del archivo de datos de Sensei; si la tuya no está, elige «Otro» y escribe su ancho de banda y su pico. La tabla de abajo repite la cuenta en cada GPU con tus mismos controles.
:::

## Contra benchmarks publicados {Against published benchmarks}

Tres fuentes públicas, consultadas el 2026-11-25, con la calculadora puesta en las mismas condiciones. En todas va una sola conversación a la vez, que es lo que esas fuentes miden.

**1. NVIDIA NIM, un servidor de producción.** La página de rendimiento de NIM (versión 1.8.0) mide Llama 3.1 8B Instruct con un prompt de 1,000 tokens, una respuesta de 1,000 y una conversación. Su sección de hardware dice que corrió en un DGX H100 con una «H100 80GB HBM3»: es la SXM. Cuadra con lo medido: 153 tokens por segundo, más que el techo de una H100 PCIe, con 2,000 GB/s, ≈ 123.

| NIM 1.8.0, Llama 3.1 8B | Medido | La calculadora | Desviación |
|---|---|---|---|
| H100, BF16, tokens/s | 152.8 | 144.2 | −6 % |
| H100, BF16, TTFT | 27.4 ms | 33.0 ms | +20 % |
| H100, FP8, tokens/s | 220.1 | 252.8 | +15 % |
| H100, FP8, TTFT | 19.0 ms | 16.5 ms | −13 % |
| L40S, BF16, tokens/s | 45.2 | 37.2 | −18 % |
| L40S, BF16, TTFT | 80.8 ms | 90.2 ms | +12 % |

Con las eficiencias de arranque, la calculadora queda dentro de ±20 % de un servidor optimizado. Dividiendo lo medido entre el techo salen las eficiencias reales: 0.74 en la H100 con BF16, 0.61 con FP8 y 0.85 en la L40S. Con FP8 se pierde más porque el paso es tan corto (el techo es de 2.8 ms; NIM mide 4.5) que el tiempo fijo de cada paso pesa más.

**2. llama.cpp en GPUs de NVIDIA.** La discusión «Performance of llama.cpp with CUDA» del repositorio de llama.cpp junta mediciones de la comunidad con el mismo comando: Llama 2 7B en Q4_0 (un archivo de 3.56 GiB), 512 tokens de prompt (pp512) y 128 de respuesta (tg128). En la calculadora: el preajuste de Llama 2 7B, cálculo en INT8 y prompt de 1 para el decode (tg128 empieza sin prompt).

| llama.cpp, Llama 2 7B Q4_0 | Techo | Medido | Medido ÷ techo |
|---|---|---|---|
| RTX 4090, decode | 264 tokens/s | 186.2 | 0.71 |
| H100 (HBM3, o sea SXM), decode | 876 tokens/s | 267.8 | 0.31 |
| A100 80 GB, decode | 533 tokens/s | 190.9 | 0.36 |

En la RTX 4090, la estimación con \(η_m\) = 0.7 da 184.5 tokens por segundo: −1 %. El prefill queda más lejos: con cálculo en INT8 (660.6 TOPS densos) y \(η_c\) = 0.5, la calculadora da ≈ 24,270 tokens por segundo en pp512, y llama.cpp mide 11,993; su \(η_c\) real es ≈ 0.25. En las GPUs de centro de datos, llama.cpp con una conversación aprovecha apenas un tercio de la memoria: el paso es tan corto que domina el tiempo fijo de lanzar cada operación. NIM, en la misma H100 y con un modelo parecido, llega a 0.74. **El mismo hardware rinde el doble o el triple según el programa que lo sirve.** En la A100 no se sabe si es la SXM (2,039 GB/s) o la PCIe (1,935); con la PCIe, la eficiencia sería 0.38.

**3. llama.cpp en Apple.** La discusión «Performance of llama.cpp on Apple Silicon M-series» mide lo mismo en los chips de Apple. Apple no publica sus TFLOPS, así que aquí solo se compara el decode, con el ancho de banda que esa discusión da para cada chip (escríbelo en la calculadora con «Otro»).

| llama.cpp, Llama 2 7B Q4_0 | Ancho de banda | Techo | Medido | Medido ÷ techo |
|---|---|---|---|---|
| M2 Ultra (76 núcleos de GPU) | 800 GB/s | 209 tokens/s | 94.3 | 0.45 |
| M4 Max (40 núcleos de GPU) | 546 GB/s | 143 tokens/s | 83.1 | 0.58 |

En una Mac la regla del ancho de banda también funciona, con una eficiencia más baja: para dimensionar una Mac, usa \(η_m\) ≈ 0.5.

:::nota De dónde salen los datos
NIM: la página «Performance» de la documentación de benchmarking de NVIDIA NIM para LLMs, versión 1.8.0, concurrencia 1. llama.cpp: las discusiones 15013 (CUDA) y 4167 (Apple Silicon) del repositorio ggml-org/llama.cpp, con su comando llama-bench, sin flash attention en la de CUDA; las filas son de distintos commits y personas. Las especificaciones de cada GPU, de gpus.json (hoja de datos del fabricante, con su fecha). Todo consultado el 2026-11-25.
:::

### Cuánto se desvía y por qué {How far off, and why} [extra]

La cuenta se queda corta o se pasa por razones que se pueden nombrar:

- **El programa que sirve el modelo.** Es la diferencia más grande: 0.31 contra 0.74 en la misma GPU. vLLM, SGLang, TensorRT-LLM y NIM están hechos para servir; llama.cpp, para correr en cualquier lado.
- **El tamaño del paso.** Un paso corto (modelo chico o GPU muy rápida) pierde más en tiempo fijo. Por eso la eficiencia baja con FP8 y con modelos pequeños.
- **Lo que la fórmula no cuenta.** La tabla de tokens de entrada no se lee entera en cada paso (solo la fila del token), y la de salida sí. En Llama 3.1 8B la de entrada pesa ≈ 1.05 GB de los 16.06 que la fórmula cuenta: ≈ 6.5 % de sobra en el techo.
- **El pico de cálculo.** En el prefill, la calculadora usa el pico del formato que eliges. llama.cpp con pesos Q4_0 calcula con enteros; NIM con FP8, en FP8. Si eliges el formato equivocado, el TTFT sale al doble o a la mitad.

Para cotizar, lo seguro es medir: arranca el servidor que vas a usar, mide los tokens por segundo con una conversación y divide entre el techo. Ese \(η_m\) es el tuyo.

## Lo que la calculadora no cuenta {What it leaves out} [extra]

- **La fila de espera.** Con muchas personas, el TTFT real es la espera más el prefill. Eso es de la herramienta de sizing.
- **El prefill y el decode mezclados.** Un servidor real intercala prompts nuevos con pasos de decode de otras conversaciones; cada prompt largo frena un poco a todos los demás.
- **La red entre GPUs.** Con \(n\) > 1, las GPUs se pasan resultados en cada bloque. Con NVLink casi no se nota; por PCIe, bastante. La calculadora supone que se reparten el trabajo sin perder nada.
- **Speculative decoding y otros trucos.** Hay técnicas que escriben varios tokens por paso y rompen el techo. Son tema de la lección «Speculative decoding y contexto largo».
- **Los MoE con batch grande.** Con una conversación, Qwen3 30B-A3B lee solo los expertos de cada token. Con muchas, distintos tokens piden distintos expertos y el paso termina leyendo casi todos. Ahí \(A ÷ P\) se acerca a 1.

## Errores comunes {Common mistakes}

1. **Usar el pico con sparsity.** Sale el doble del real y el TTFT, a la mitad. **Cómo evitarlo:** usa los picos densos de gpus.json, o divide entre 2 el de la página de NVIDIA si trae asterisco.
2. **Creer que una GPU con más TFLOPS contesta más rápido.** En el decode manda el ancho de banda. La L4 tiene casi el doble de pico que la T4, pero menos ancho de banda: escribe un poco más lento. **Cómo evitarlo:** para tokens por segundo, mira los GB/s.
3. **Tomar el techo como promesa.** Ninguna GPU llega al 100 %. **Cómo evitarlo:** multiplica por \(η_m\); 0.7 con un servidor de producción, 0.3 a 0.5 con llama.cpp en GPUs grandes.
4. **Olvidar el KV cache en conversaciones largas.** Con 32,768 tokens de contexto, el KV cache de Llama 3.1 8B pesa 4.3 GB: un paso lee 27 % más que solo los pesos. **Cómo evitarlo:** pon el prompt real en la calculadora.
5. **Medir la velocidad de un MoE como si fuera chico.** Con una conversación, Qwen3 30B-A3B corre como uno de 3B; con 64, no. **Cómo evitarlo:** mide con la carga que vas a tener.
6. **Confundir los tokens por segundo de una persona con los del servidor.** «4,800 tokens por segundo» puede ser 32 personas a 150. **Cómo evitarlo:** pregunta siempre por conversación y en total.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Llama 3.1 8B en INT4 de AWQ ocupa ≈ 5.73 GB. ¿Cuál es su techo de decode, con una conversación corta, en una L4 de 300 GB/s?
\(t_{paso}\) = 5.73 GB ÷ 300 GB/s ≈ 19.1 ms, así que el techo es 1 ÷ 19.1 ms ≈ **52 tokens por segundo**. En BF16 (16.06 GB) sería ≈ 19: cuantizar a 4 bits casi triplica la velocidad, porque hay que leer casi tres veces menos bytes.
? [facil] ¿Cuántos FLOPs cuesta el prefill de un prompt de 2,000 tokens en Llama 3.3 70B, sin contar la atención?
\(F_{pre}\) ≈ 2 × 70.554 × 10⁹ × 2,000 ≈ **2.82 × 10¹⁴ FLOPs**. En una H100 SXM en FP8 (1,979 TFLOPS) con \(η_c\) = 0.5: 2.82 × 10¹⁴ ÷ (1,979 × 10¹² × 0.5) ≈ 0.29 s de TTFT.
? [medio] Un proveedor promete 120 tokens por segundo por persona con Qwen3 32B en BF16 (65.5 GB de pesos) en una H200 (4,800 GB/s). ¿Es creíble?
Techo: 65.5 GB ÷ 4,800 GB/s ≈ 13.6 ms por paso, ≈ **73 tokens por segundo**, sin contar el KV cache. Prometer 120 es imposible en BF16 con una sola GPU. Podría lograrlo con pesos en FP8 o INT4, con speculative decoding o repartiendo el modelo en dos GPUs. Pregúntale cuál.
? [medio] Con Llama 3.1 8B en BF16 en una H100 SXM, ¿cuántos tokens por segundo entrega en total con 64 conversaciones de 1,500 tokens a media respuesta, según el techo?
Bytes del paso: 16.06 + 64 × 0.197 ≈ 28.67 GB; el paso: 28.67 ÷ 3,350 ≈ 8.56 ms. Cada conversación: ≈ 117 tokens/s; todas: 64 × 117 ≈ **7,480 tokens por segundo**. Con \(η_m\) = 0.7, ≈ 5,240.
? [reto] En una Mac con M4 Max (546 GB/s), llama.cpp mide 83 tokens por segundo con Llama 2 7B en Q4_0 (3.82 GB). ¿Cuál es su \(η_m\), y cuántos tokens por segundo esperarías con un modelo de 32B en Q4_0?
Techo: 546 ÷ 3.82 ≈ 143 tokens/s; \(η_m\) = 83 ÷ 143 ≈ **0.58**. Un 32B en Q4_0 pesa ≈ 32 × 4.5 ÷ 8 ≈ 18 GB: techo 546 ÷ 18 ≈ 30 tokens/s, y con la misma eficiencia ≈ **18 tokens por segundo**. Se lee bien, pero para una sola persona.
:::

## Palabras que vas a oír {Words you'll hear}

:::conceptos
decode prefill ttft ancho-de-banda batch memory-bound roofline pico-de-calculo eficiencia
:::
