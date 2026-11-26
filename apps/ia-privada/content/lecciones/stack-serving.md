---
titulo: Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM
en: From laptop to server: llama.cpp, Ollama, vLLM, SGLang and TensorRT-LLM
subtitulo: Qué hace por dentro el programa que sirve un LLM, en qué se parecen y en qué no los cinco que más vas a oír, y cómo se elige el del servidor de una empresa sin confundirlo con el de la laptop.
pregunta: El de TI probó Qwen3 en su laptop con Ollama y «ya funciona». ¿Por qué eso no sirve a 200 abogados, qué programa se pone en el servidor, y cómo se elige entre los cinco?
sensei: apis, balanceo, e07-empaquetado
---

:::idea
Un LLM no se sirve solo: lo sirve un **[[motor-de-inferencia|motor de inferencia]]**, el programa que carga los pesos en la GPU, arma los batches, guarda el KV cache y contesta por HTTP. Los cinco que más vas a oír hacen lo mismo con prioridades distintas: **llama.cpp** y **Ollama**, que el modelo corra en cualquier máquina, casi siempre para una persona; **vLLM**, **SGLang** y **TensorRT-LLM**, exprimir una GPU de servidor con muchas personas a la vez. Que algo «funcione en la laptop» prueba que el modelo contesta, no que el servidor aguante. Y en 2026 cambiaron tanto sus valores por omisión que un tutorial de hace un año ya te engaña.
:::

## «Ya funciona en mi laptop» {"It already works on my laptop"}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**, ≈ 15 preguntas cada una al día, de 9:00 a 19:00, con una hora pico de 2.5 veces el promedio: **750 preguntas en esa hora**, ≈ 0.21 por segundo. Cada pregunta trae ≈ **6,000 tokens** de entrada (instrucciones, la pregunta y cinco fragmentos de expediente) y la respuesta, ≈ **500**; el tope por conversación es de **8,192 tokens**. Se pide el primer token en **≤ 2 s** (en el p95) y al menos **20 tokens por segundo** por persona. El modelo es **Qwen3 32B en INT4 de [[awq|AWQ]]** (≈ 19.32 GB de pesos), con el razonamiento apagado, y el sizing dio **3 NVIDIA L40S** de 48 GB. Su equipo de TI son **2 personas** que saben de redes y de Windows y nunca han operado una GPU.

Uno de ellos hizo lo que haría cualquiera: instaló Ollama en su laptop, escribió `ollama run qwen3:32b`, esperó a que bajaran ≈ 20 GB y le pegó un contrato. La respuesta salió bien. «Ya funciona; nada más hay que ponerlo en el servidor».

La prueba demostró algo valioso: que el modelo entiende español jurídico y que el TI sabe correr un modelo. **No** demostró casi todo lo demás:

- **Una persona no son 750 en una hora.** Ollama, por omisión, atiende **una petición a la vez por modelo** en GPUs de NVIDIA y AMD; las demás esperan en fila. Lo cuentas en la sección de Ollama.
- **No es el mismo archivo.** `qwen3:32b` de Ollama es un [[gguf|GGUF]] con su propia cuantización (su página no dice cuál); el del servidor es el AWQ de Qwen. Son dos versiones de 4 bits del mismo modelo, y la calidad de una no prueba la de la otra: el examen se repite con el archivo que se va a servir (lo ves en [Formatos de cuantización en la práctica](/formatos-cuantizacion/)).
- **El contexto puede ser otro.** Ollama elige el contexto según la memoria de la GPU; en una laptop con poca VRAM son 4,096 tokens, y un prompt de 6,000 no cabe.
- **Nadie pidió contraseña.** El servidor de Ollama no tiene autenticación: quien llegue a su puerto usa el modelo.
- **Se descarga solo.** Tras 5 minutos sin preguntas, Ollama saca el modelo de la memoria, y la siguiente pregunta paga la carga.

Ninguna es un defecto de Ollama: es para lo que está hecho. Antes de seguir, dos cosas que Sensei explica a fondo:

- Un **servidor** es un programa que escucha en un **puerto** (el número que dice a qué programa de la máquina va cada conexión) y contesta peticiones. Las de un LLM viajan como **JSON** por **HTTP**, y la respuesta llega en pedazos (*streaming*) conforme se escribe. Lo ves en [APIs: REST, JSON, gRPC y streaming](https://sensei.trueml.app/apis/).
- Si hay varias copias de un servidor, un **balanceador** reparte las peticiones entre ellas y deja de mandarle a la que no contesta su *health check*. Lo ves en [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/).

:::analogia La cafetera de tu casa y la de la cafetería
La cafetera de tu casa hace un café excelente, una taza a la vez. La de una cafetería usa el mismo café, pero está hecha para sacar cien tazas en la hora pico, y alguien la sabe operar. Probar el café en tu casa te dice si el grano es bueno, no si tu cafetera aguanta la mañana de una oficina.

Dónde se rompe: con los LLMs ni siquiera es el mismo café. La laptop corre un GGUF y el servidor un AWQ: dos formas distintas de comprimir el mismo modelo. El sabor se parece, pero hay que volver a probarlo.
:::

## Qué es un motor de inferencia, y los cinco {What an inference engine is, and the five}

*Inferencia* es usar un modelo ya entrenado para contestar. Un **[[motor-de-inferencia|motor de inferencia]]** (*inference engine*) es el programa que lo hace en serio: carga los [[pesos]] en la memoria de la GPU, recibe peticiones, decide cuáles calcular juntas, guarda lo que cada conversación ya leyó y devuelve los tokens. Mucha gente le dice «servidor de inferencia»; estrictamente, el servidor es la parte que habla HTTP y el motor lo de adentro, pero los cinco de esta lección traen las dos cosas juntas.

Para ver qué hace, sigue a una pregunta del despacho por dentro. Es la misma en cualquiera de los cinco; cambia qué tan bien hace cada paso.

:::pasos
1. Llega la petición por HTTP
El cliente (la interfaz de chat del despacho, por ejemplo) manda un JSON a una dirección como `/v1/chat/completions`, con la lista de mensajes («sistema: eres un asistente jurídico…», «usuario: ¿qué dice la cláusula 14?»). Esa dirección y ese formato son los de la API de OpenAI: los cinco motores la imitan, así que cualquier programa que sepa hablarle a OpenAI le habla a tu motor cambiando solo la dirección base (`base_url`). A eso se le llama un **[[api-compatible-openai|servidor compatible con OpenAI]]**; sus campos y lo que se pone delante para cuidarlo son tema de [Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/).

2. La plantilla de chat convierte los mensajes en un solo texto
El modelo no sabe de «mensajes»: lee una sola fila de tokens. La **[[plantilla-de-chat|plantilla de chat]]** (*chat template*) es un pequeño programa, que viene con el modelo, que pega los mensajes en un texto con marcas especiales («aquí empieza el sistema», «aquí habla el usuario», «ahora te toca»). En Qwen3, esa plantilla también decide si el modelo **piensa** antes de contestar: es donde se apaga el razonamiento.

3. El tokenizador lo parte en tokens
Ese texto se convierte en números, los ids de los tokens. Las ≈ 6,000 de la pregunta del despacho salen de aquí.

4. El scheduler la mete en un batch
El [[scheduler]] decide, antes de cada paso del modelo, qué conversaciones van juntas ([[batching-continuo|batching continuo]]) y si hay memoria para la nueva. El gestor del [[kv-cache|KV cache]] le aparta bloques de memoria ([[pagedattention|PagedAttention]]) y, si su principio ya se calculó antes, lo reutiliza ([[prefix-caching|prefix caching]]). Todo eso lo viste a fondo en [Batching continuo y PagedAttention](/batching/).

5. La GPU corre el paso con sus kernels
Un **kernel** es una función que corre en la GPU, repartida en miles de hilos: una multiplicación de matrices, la atención, una suma. En Qwen3 32B, con 64 capas y varios kernels por capa, cada paso lanza cientos, uno tras otro. Qué tan rápidos son depende del formato de los pesos: el [[awq|AWQ]] del despacho, en vLLM, corre en un kernel llamado Marlin (lo ves en [Formatos de cuantización en la práctica](/formatos-cuantizacion/)).

6. El sampler elige el token y sale por streaming
De la última capa sale una puntuación por cada token posible. El *sampler* (muestreo) elige uno según la temperatura y los demás parámetros de la petición, el detokenizador lo vuelve texto y el servidor lo manda al cliente en cuanto existe. Se repite hasta el token de fin o el tope.
:::

Falta el paso cero, que pasa una sola vez: **el arranque**. El motor lee los pesos del disco (o los baja de Hugging Face), los acomoda en la [[vram|VRAM]], corre peticiones de prueba para medir cuánta memoria necesita en el peor caso y reparte lo que sobra en bloques de KV cache. Por eso tarda en arrancar, y por eso lo que imprime al arrancar es lo más importante que vas a leer de él.

:::diagrama stack-serving-motor
Una pregunta del despacho por dentro del motor: entra como JSON, sale como tokens. Toca cada caja para ver qué hace y recorre el flujo paso a paso.
:::

:::profundo CUDA graphs: dejar de dictarle a la GPU paso por paso
Una pieza que no se ve en los diagramas explica por qué los motores de servidor gastan memoria «de más». La CPU le dice a la GPU qué kernel correr, uno por uno, y cada orden cuesta un poquito de tiempo. En el [[prefill|prefill]], con miles de tokens, cada kernel trabaja tanto que no se nota. En el [[decode|decode]], con un token por conversación, los kernels son cortos y la GPU puede quedarse esperando la siguiente orden.

Un **[[cuda-graph|CUDA graph]]** es una grabación: el motor corre el paso una vez, [[cuda|CUDA]] (la plataforma de NVIDIA para programar sus GPUs) anota toda la secuencia de kernels con sus memorias, y desde entonces la CPU manda **una** orden («repite la grabación») en vez de cientos. vLLM los usa por omisión; su documentación avisa que ocupan memoria extra y que con `--enforce-eager` se apagan: arranca más rápido y el decode va más lento.

**Una analogía: dictar una receta o dar la tarjeta.** Puedes dictarle la receta a un cocinero paso por paso, o darle la tarjeta con todo escrito; con la tarjeta, no espera a que termines cada frase.

Dónde se rompe: la tarjeta es fija. Si cambia cuántos platillos van en la tanda (el tamaño del batch), la grabación ya no sirve tal cual; por eso los motores graban varias (vLLM, por omisión, para los tamaños hasta `--max-num-seqs`), y por eso ocupan memoria.
:::

### Cinco programas, dos familias

Los cinco hacen los pasos de arriba. Lo que cambia es para qué los optimizaron. Esta es la foto a fines de noviembre de 2026 (versiones, licencias y valores leídos en sus repositorios el 26 de noviembre):

| | llama.cpp | Ollama | vLLM | SGLang | TensorRT-LLM |
|---|---|---|---|---|---|
| Quién lo hace | ggml-org (Georgi Gerganov y colaboradores) | Ollama, la empresa | vllm-project (nació en Berkeley) | sgl-project (nació en LMSYS) | NVIDIA |
| Licencia | MIT | MIT | Apache 2.0 | Apache 2.0 | Apache 2.0 |
| Versión estable | v1.1.0 (26 nov.) | v0.40.18 (24 nov.) | v0.34.0 (16 nov.) | v0.5.23 (2 nov.) | v1.3.0 (20 nov.) |
| Escrito en | C++ | Go (y llama.cpp adentro) | Python, kernels en C++/CUDA | Python, kernels en C++/CUDA | Python, núcleo en C++/CUDA |
| Dónde corre | CPU, NVIDIA, AMD, Apple, Vulkan y más | Windows, macOS, Linux; NVIDIA, AMD, Apple | Linux; NVIDIA, AMD, Intel, CPU, TPU | Linux; NVIDIA, AMD, TPU, Intel, Apple | Linux, solo NVIDIA |
| Formato de pesos (safetensors: el de Hugging Face) | [[gguf\|GGUF]] | GGUF (y safetensors con [[mlx\|MLX]] en Mac) | safetensors: AWQ, [[gptq\|GPTQ]], FP8, [[fp4\|FP4]]… | safetensors: AWQ, GPTQ, FP8, FP4… | safetensors: FP8, NVFP4, AWQ, GPTQ… |
| Servidor y puerto por omisión | `llama-server`, 9931 | `ollama serve`, 11434 | `vllm serve`, 8000 | `sglang serve`, 30000 | `trtllm-serve` (8000 en su guía) |
| ¿Sirve el Qwen3-32B-AWQ del despacho en una L40S? | No: usa GGUF | No: usa GGUF | Sí (leído en su código) | Probablemente | Su documentación dice que sí |

Se ven dos familias:

- **Los locales: llama.cpp y Ollama.** Su meta es que el modelo corra en la máquina que tengas: una laptop, una Mac, una PC de juegos, incluso solo la CPU. Cuantizan agresivo, reparten el modelo entre GPU y RAM si no cabe, se instalan con un clic en Windows. Atienden bien a una persona o a unas pocas.
- **Los de servidor: vLLM, SGLang y TensorRT-LLM.** Su meta es que una GPU de centro de datos atienda a la mayor cantidad de personas a la vez con buena latencia. Suponen Linux, una GPU con su driver y alguien que sepa leer un log; a cambio, juntan conversaciones con más cuidado y traen kernels para batches grandes.

:::figura stack-serving-familias
Los cinco en dos ejes: cuántas personas a la vez atienden bien y qué tan exigentes son con el hardware. Los locales corren en casi todo; los de servidor piden Linux y una GPU de centro de datos.
:::

La frontera no es una pared: llama.cpp hace [[batching-continuo|batching continuo]] por omisión, y vLLM corre en CPU. Pero cada uno arregla primero lo que su gente usa. Y un dato que pesa para el despacho: **vLLM no corre en Windows de forma nativa** (lo dice su documentación; se usa con WSL, el Linux dentro de Windows, o en un servidor con Linux), y SGLang y TensorRT-LLM tampoco. llama.cpp y Ollama sí.

:::nota Licencia del motor, licencia del modelo
Los cinco motores tienen licencias permisivas ([[licencia-mit|MIT]] o [[apache-2|Apache 2.0]]): el despacho puede usarlos dentro de su red sin pagar ni pedir permiso. Esa licencia es la del **programa**, no la del modelo: Qwen3 tiene la suya (también Apache 2.0), y las dos se revisan por separado, como viste en [Open weight, open source y licencias](/licencias/). (El `LICENSE` de TensorRT-LLM declara Apache 2.0 y lista aparte las del código ajeno que trae.)
:::

## Los locales: llama.cpp y Ollama {The local ones: llama.cpp and Ollama}

Los que corren en la laptop del TI: primero el motor, después la envoltura que casi todos usan encima.

### llama.cpp: un archivo, cualquier máquina

**[[llama-cpp|llama.cpp]]** es «inferencia de LLMs en C/C++»: un programa sin dependencias pesadas, sobre una biblioteca propia de cálculo, `ggml`. Lo empezó Georgi Gerganov en 2023 y hoy lo mantiene ggml-org. Licencia MIT.

Corre en casi todo. Su guía de compilación lista CPU (con varias bibliotecas de álgebra), **Metal** (las GPUs de Apple), **[[cuda|CUDA]]** (NVIDIA), **HIP** (AMD), **Vulkan** (una interfaz gráfica que tienen casi todas las GPUs) y una docena más. Para una L40S se compila con CUDA para la arquitectura 8.9, la de las GPUs Ada.

Su formato es **[[gguf|GGUF]]**: un solo archivo con los pesos cuantizados y todo lo necesario para cargarlos (arquitectura, tokenizador, plantilla de chat). Las variantes como Q4_K_M y Q8_0, qué son y cuánto pesan, están en [Formatos de cuantización en la práctica](/formatos-cuantizacion/). [[awq|AWQ]] y [[gptq|GPTQ]] **no** son formatos de llama.cpp.

:::ojo Dos números de versión
Hasta noviembre de 2026, llama.cpp solo tenía *builds* numeradas (`b1234`), varias al día. El 13 de noviembre de 2026 salió la **v1.0.0**, con versiones semánticas (el primer número cambia cuando se rompe la interfaz pública). Hoy conviven las dos: la estable **v1.1.0** (26 de noviembre) y las builds que GitHub marca como *prerelease* casi cada hora (b12785 la noche del 26). Cuando anotes «qué versión usamos», di cuál de las dos.
:::

### El servidor: `llama-server`

El programa de llama.cpp que sirve por HTTP es `llama-server`, con [[api-compatible-openai|API compatible con OpenAI]] (`/v1/chat/completions`, `/v1/models` y otras). Para una prueba del despacho con el GGUF de Qwen3 32B (el nombre del archivo es de ejemplo):

```bash
llama-server -m ./Qwen3-32B-Q4_K_M.gguf -c 8192 --reasoning off --api-key "$CLAVE"
```

Los flags que importan, con sus valores por omisión en la documentación del 26 de noviembre de 2026:

| Flag | Qué hace | Por omisión |
|---|---|---|
| `-m` | El archivo GGUF | — |
| `-c`, `--ctx-size` | El contexto | 0 = el del modelo |
| `-ngl`, `--n-gpu-layers` | Cuántas capas van a la VRAM: un número, `auto` o `all` | `auto` |
| `-np`, `--parallel` | Cuántas conversaciones a la vez («slots») | −1 = automático |
| `-cb` | [[batching-continuo\|Batching continuo]] | prendido |
| `--fit` | Ajusta lo que no especificaste para que quepa en la memoria | prendido |
| `--host`, `--port` | Dónde escucha | `127.0.0.1`, **9931** |
| `--api-key` | Una clave que debe traer cada petición | ninguna |
| `--reasoning` | Pensar o no (`on`, `off`, `auto`) | `auto`, según la plantilla |
| `-ctk`, `-ctv` | Formato del KV cache | `f16` |

:::ojo El puerto cambió
Casi todos los tutoriales dicen que `llama-server` escucha en el **8080**. Desde octubre de 2026 es el **9931**, y en `127.0.0.1`: solo acepta conexiones de la misma máquina hasta que le digas `--host 0.0.0.0` (el ejemplo de Docker de la misma documentación sigue poniendo `--port 8080` a mano). Tampoco es igual el reparto del contexto: con el KV cache unificado (un solo espacio para todas las conversaciones, prendido cuando los slots son automáticos), `-c` ya no se parte en pedazos fijos entre los `-np`. Antes de copiar un comando de un blog, corre `llama-server --help` con tu versión.
:::

Un hilo de GitHub del proyecto junta mediciones que manda la comunidad (actualizado el 13 de noviembre de 2026), con Llama 2 7B en Q4_0. La columna *tg128* son los tokens por segundo al escribir 128 tokens: una H100 da ≈ 268, una RTX 4090 ≈ 186 y una L40 (la hermana de la L40S, con la misma memoria) ≈ 152. Pero es **una sola** conversación, y con un modelo cinco veces más chico: no dice nada de 750 preguntas en una hora.

**En qué es bueno:** corre en todo, incluidos Windows y Mac; un solo archivo; offload para lo que no cabe; casi nada que instalar. **En qué no:** no lee el AWQ del despacho; sus mediciones y su documentación piensan en una máquina y pocas conversaciones; cambia varias veces al día.

### Ollama: la envoltura cómoda

**[[ollama|Ollama]]** es un programa de escritorio y servidor para correr modelos locales: escribes `ollama run qwen3:32b` y él baja el modelo de su biblioteca (`ollama.com/library`), lo carga y te deja platicar en la terminal. Lo hace una empresa del mismo nombre, en Go, con licencia MIT. La estable al 26 de noviembre de 2026 es la **v0.40.18** (24 de noviembre).

¿Y por dentro? **Hoy usa llama.cpp.** El código de la v0.40.18 sirve cada modelo GGUF con un subproceso de `llama-server`: una build de llama.cpp fijada en un archivo del repositorio (`b12651` en esa versión), con parches propios. En las Mac con chips de Apple usa además **[[mlx|MLX]]**, el marco de Apple, por omisión desde la v0.40.0 (septiembre de 2026). En 2025 Ollama corría varios modelos, Qwen3 entre ellos, en un «motor nuevo» propio; la v0.30.0 (mayo de 2026) anunció mejor compatibilidad y velocidad «usando llama.cpp», y ese motor ya no aparece en su código. Si lees un artículo de 2025 sobre «el motor de Ollama», está viejo.

Así que Ollama es **llama.cpp con una envoltura cómoda**: descarga, nombres de modelos, carga y descarga automáticas, una API. Sus límites de velocidad son los de llama.cpp; sus trampas, las de la envoltura.

**Los comandos y el Modelfile.**

- `ollama serve`: el servidor, en `127.0.0.1:11434` (la variable `OLLAMA_HOST` lo cambia). Tiene su API propia y una compatible con OpenAI en `/v1/`.
- `ollama run MODELO`: chat en la terminal; baja el modelo si falta.
- `ollama ps`: qué modelos están cargados, con qué contexto y dónde (`100% GPU`, o algo como `48%/52% CPU/GPU` si se desbordó a la RAM).
- `ollama stop MODELO`: lo descarga.

Un **[[modelfile|Modelfile]]** es una receta de texto para crear tu variante de un modelo: de cuál parte, qué parámetros fija, qué instrucciones de sistema trae. Se crea con `ollama create`:

```bash
# Modelfile
FROM qwen3:32b
PARAMETER num_ctx 8192
```

```bash
ollama create despacho-qwen -f Modelfile
ollama run despacho-qwen
```

### Las cinco trampas de Ollama

**1. El contexto depende de la VRAM.** `num_ctx` es el contexto de cada conversación. Tres documentos del propio repositorio dicen 2,048, 4,096 y, el más nuevo, que depende de la memoria de la GPU: **4k con menos de 24 GiB, 32k de 24 a 48 GiB y 256k con 48 GiB o más**. El código de la v0.40.18 hace lo último (con cortes de 23 y 47 GiB, por redondeos) y **suma la VRAM de todas las GPUs que ve**. Una L40S sola tiene 48 × 10⁹ ÷ 2³⁰ ≈ 44.7 GiB: 32k (32,768 tokens). El servidor del despacho, con las 3, suma ≈ 134 GiB: 256k, que Ollama recorta al máximo del modelo (≈ 40 mil en `qwen3:32b`). En una laptop con una GPU de 8 GB son 4k, y el prompt de 6,000 tokens del despacho no cabe. La solución es no depender del valor por omisión: `OLLAMA_CONTEXT_LENGTH=8192` en el servidor (o `num_ctx` en el Modelfile o en la petición) y comprobarlo con `ollama ps`.

**2. Una petición a la vez.** `OLLAMA_NUM_PARALLEL` es cuántas peticiones atiende a la vez cada modelo. Sin definir, vale **1** en NVIDIA, AMD y CPU (solo con MLX en Mac lo elige solo). Las demás esperan en una fila de hasta **512** (`OLLAMA_MAX_QUEUE`); después, responde con error 503. Y subirlo cuesta memoria: según la documentación, con 4 en paralelo un contexto de 2K se vuelve de 8K, porque cada lugar tiene el suyo.

**3. Se descarga a los 5 minutos.** `OLLAMA_KEEP_ALIVE` es cuánto se queda un modelo en memoria después de la última petición: **5 minutos** por omisión. Ese es el **[[keep-alive|keep-alive]]**. La primera pregunta de la mañana, o la de después de la comida, paga la carga de ≈ 20 GB del disco a la VRAM. Con `-1` se queda siempre.

**4. No hay autenticación.** Su documentación de compatibilidad con OpenAI pone `api_key='ollama'` con el comentario «requerida pero ignorada». Quien llegue al puerto usa el modelo. Nunca se expone a la red sin algo delante.

**5. Piensa a menos que le digas.** Qwen3 piensa por omisión. En la API de Ollama se apaga con el campo `think: false`; si no, el razonamiento sale en `message.thinking` antes de cada respuesta.

### La cuenta: una a la vez en la hora pico

¿Qué tan grave es la trampa 2? Supón que alguien pone Ollama tal cual en una L40S del despacho. Si cada petición ocupa al servidor \(S\) segundos y llegan \(λ\) por segundo, la fracción del tiempo que tendría que estar ocupado es la **utilización**:

:::formula Utilización de un servidor que atiende una a la vez
S = t_{prefill} + n × t_{token}
ρ = λ × S
- t_{prefill}: lo que tarda en leer el prompt, en s
- n: los tokens de la respuesta
- t_{token}: lo que tarda cada token con una sola conversación, en s
- S: el tiempo de servicio de una petición, en s
- λ: las peticiones que llegan por segundo
- ρ: la utilización; si pasa de 1, llegan más de las que puede atender y la fila crece sin parar
:::

:::cuenta Ollama con una petición a la vez, en la hora pico del despacho
\(t_{token}\) // pesos de `qwen3:32b` ≈ 20 GB + KV de media respuesta ≈ 1.64 GB (6,250 tokens × 256 KiB), leídos a 0.7 × 864 GB/s | 21.64 ÷ 604.8 | ≈ 35.8 ms
\(n × t_{token}\) // \(n\) = 500 tokens | 500 × 35.8 ms | ≈ 17.9 s
\(t_{prefill}\) // 2 × 32.762 mil millones × 6,000 tokens ÷ (0.5 × 362.05 TFLOPS) | 3.93 × 10¹⁴ ÷ 1.81 × 10¹⁴ | ≈ 2.17 s
\(S\) | 2.17 + 17.9 | ≈ 20.1 s
Atiende por hora // 3,600 s ÷ \(S\) | 3,600 ÷ 20.1 | ≈ 179 preguntas
\(λ\) // 750 preguntas en la hora pico | 750 ÷ 3,600 | ≈ 0.208 por s
\(ρ\) | 0.208 × 20.1 | ≈ 4.2
= Llegan 4.2 veces más preguntas de las que atiende. La fila crece ≈ 0.16 por segundo; a los ≈ 54 minutos pasa de 512 y Ollama empieza a contestar 503. Con 3 L40S así serían ≈ 537 por hora: tampoco.
:::

Es un modelo de juguete (eficiencias del despacho, hora pico pareja), pero el orden de magnitud no deja dudas.

:::profundo El precio de subir las peticiones en paralelo
La salida obvia a la trampa 2 es subir `OLLAMA_NUM_PARALLEL`, pero cada lugar trae su propio contexto y el KV cache se multiplica.

:::cuenta Cuatro en paralelo en una L40S
KV por token // 2 × 64 capas × 8 cabezas KV × 128 × 2 bytes | 262,144 bytes | 256 KiB
Con el contexto por omisión en la L40S y 4 en paralelo // 32,768 × 4 tokens | 131,072 × 262,144 bytes | ≈ 34.4 GB
Pesos más KV | 20 + 34.4 | ≈ 54.4 GB
Contra la VRAM // 48 GB | 54.4 − 48 | faltan ≈ 6.4 GB
Con `OLLAMA_CONTEXT_LENGTH=8192` y 4 en paralelo // 8,192 × 4 tokens | 32,768 × 262,144 bytes | ≈ 8.6 GB
= Con el contexto por omisión y 4 en paralelo ya no cabe todo en la VRAM. Con el contexto del despacho, sobra memoria.
:::

Qué hace Ollama entonces depende de la versión: mandar capas a la RAM o (el código de la v0.40.18, si la carga falla con el contexto automático) bajar al escalón de 4k, donde el prompt de 6,000 tokens ya no cabe. Las dos cosas se ven en `ollama ps`. Por eso el contexto se fija a mano.
:::

**En qué es bueno:** instalar y probar en minutos en Windows, Mac o Linux; la laptop del desarrollador; una demo; cambiar de modelo con un comando. **En qué no:** atender a muchos con los valores por omisión, autenticación, el AWQ del despacho.

## Offload: cuando el modelo no cabe en la GPU {Offload: when the model does not fit} [extra]

Lo que hizo famoso a [[llama-cpp|llama.cpp]] es que corre modelos que **no caben** en la GPU. Con `-ngl` decides cuántas capas van a la VRAM; las demás se quedan en la RAM y las calcula la CPU. Eso es el **[[offload-a-cpu|offload a CPU]]** (*CPU offload*). Hay una variante para los [[moe|MoE]]: `--n-cpu-moe` deja en la CPU solo los expertos de las primeras capas, que son la mayor parte del peso y se usan poco por token.

Funciona, y es lento, por la razón de siempre del [[decode|decode]]: cada token lee **todos** los pesos, y ahora una parte vive en una memoria mucho más lenta. El tiempo por token es la suma de los dos pedazos, y el lento manda.

:::formula Tiempo por token con offload
t_{token} = frac{W_{GPU}}{η_m × B_{GPU}} + frac{W_{CPU}}{η_m × B_{RAM}}
v = frac{1}{t_{token}}
- W_{GPU}: los bytes de pesos de las capas que están en la VRAM
- W_{CPU}: los bytes de pesos de las capas que se quedaron en la RAM
- B_{GPU}: el [[ancho-de-banda|ancho de banda]] de la VRAM, en bytes/s
- B_{RAM}: el ancho de banda de la RAM de la computadora, en bytes/s
- η_m: la [[eficiencia|eficiencia]] de la memoria (0.7, el supuesto del despacho, aquí para las dos)
- t_{token}: lo que tarda un token de una sola conversación, en s; ignora el KV cache y el cálculo
- v: los tokens por segundo que ve esa persona
:::

:::cuenta Llama 3.3 70B en una RTX 4090 con la mitad de las capas en la RAM
Pesos en Q4_K_M // 70.554 mil millones de parámetros × 4.89 bits ÷ 8, la mezcla Q4_K_M de la lección de formatos | 70.554 × 10⁹ × 4.89 ÷ 8 | ≈ 43.1 GB
Peso por capa // 80 capas | 43.1 ÷ 80 | ≈ 0.54 GB
\(W_{GPU}\) // 40 capas en los 24 GB de la RTX 4090 | 40 × 0.54 | ≈ 21.6 GB
\(W_{CPU}\) // las otras 40 | 40 × 0.54 | ≈ 21.6 GB
\(B_{GPU}\) // RTX 4090, del catálogo de GPUs | 1,008 GB/s | 1,008 GB/s
\(B_{RAM}\) // supuesto: DDR5-5600 en dos canales, 2 × 8 bytes × 5,600 millones por segundo | 2 × 8 × 5.6 × 10⁹ | 89.6 GB/s
Pedazo de la GPU // \(W_{GPU} ÷ (η_m × B_{GPU})\) | 21.6 ÷ (0.7 × 1,008) | ≈ 31 ms
Pedazo de la CPU // \(W_{CPU} ÷ (η_m × B_{RAM})\) | 21.6 ÷ (0.7 × 89.6) | ≈ 344 ms
\(t_{token}\) | 31 + 344 | ≈ 374 ms
\(v\) | 1 ÷ 0.374 s | ≈ 2.7 tokens/s
= La mitad de las capas está en la RAM y se come el 92 % del tiempo. Si todo cupiera en una GPU con ese ancho de banda, serían ≈ 16 tokens/s.
:::

:::figura stack-serving-offload
Las 80 capas de Llama 3.3 70B repartidas entre la VRAM de una RTX 4090 y la RAM. Las barras de abajo son el tiempo de cada pedazo por token: la mitad de los pesos en la RAM se lleva casi todo el tiempo.
:::

:::calculadora stack-serving-offload
Arranca con el caso de la cuenta. Sube las capas en la GPU: la velocidad casi no se mueve hasta que quedan muy pocas en la RAM. Cambia a una Mac de memoria unificada: ahí no hay offload.
:::

Para una persona en su laptop, 3 tokens por segundo pueden ser aceptables para probar. Para un servidor, no. Por eso la regla en un servidor es la opuesta: **todo el modelo en la VRAM**, y si no cabe, otra GPU o un modelo más chico.

## vLLM y el comando del despacho {vLLM and the firm's command}

**[[vllm|vLLM]]** es el motor de servidor abierto más popular: de los tres de servidor, el de más estrellas en GitHub (≈ 98 mil a fines de noviembre de 2026). Nació en Berkeley con el paper de **PagedAttention** (Kwon y otros, presentado en SOSP 2023, un congreso de sistemas), que reportó de 2 a 4 veces más throughput que los sistemas de entonces a igual latencia. Hoy es un proyecto comunitario con licencia Apache 2.0, escrito en Python con kernels en C++ y [[cuda|CUDA]]. La versión al 26 de noviembre de 2026 es la **v0.34.0** (16 de noviembre), con 1,061 cambios de 412 personas. Sale una versión cada 2 a 4 semanas: la 0.31 fue el 5 de octubre y la 0.32 el 18.

Dónde corre, según su documentación de la 0.34.0: GPUs de NVIDIA con *compute capability* 7.5 o más (el número de generación de la arquitectura: la L40S es 8.9), AMD con [[rocm|ROCm]] (la plataforma de AMD que hace el papel de CUDA), Intel, CPU, TPU, y Mac con un complemento. Pide **Linux** y Python 3.11 a 3.14. Se instala con `uv`, y la guía de la 0.34.0 agrega un paso que baja kernels ya compilados (sin él, vLLM los compila al arrancar y tarda minutos más):

```bash
uv venv --python 3.12 --seed
uv pip install vllm --torch-backend=auto
vllm download-kernels
```

Lo de adentro ya lo conoces de [Batching continuo y PagedAttention](/batching/), que se contó con vLLM: [[batching-continuo|batching continuo]], el KV cache en [[bloque-kv|bloques]], [[prefix-caching|prefix caching]] y [[chunked-prefill|chunked prefill]] **prendidos por omisión**, y [[preemption]] cuando falta memoria. Encima de eso:

- **Kernels para cada formato.** Un checkpoint [[awq|AWQ]] como el del despacho se reconoce solo (por su `config.json`) y, con capability 7.5 o más, va al kernel Marlin. Eso dice su código de la 0.34.0; que arranque en la L40S y a qué velocidad, se confirma al probar.
- **CUDA graphs** por omisión, como viste arriba.
- **[[salida-estructurada|Salida estructurada]]**: obligar a que la respuesta siga un esquema JSON, con los motores `xgrammar` o `guidance`. Lo ves con SGLang.
- **[[speculative-decoding|Speculative decoding]]** (lo ves en [Speculative decoding y contexto largo](/speculative/)), varias GPUs (lo ves en [Varias GPUs: tensor y pipeline parallel](/varias-gpus/)) y métricas para el monitoreo.

**En qué es bueno:** muchas personas a la vez en una GPU de servidor; casi cualquier modelo abierto el día que sale; el formato del despacho; una comunidad enorme que ya se topó con tu error. **En qué no:** Windows; arrancar rápido; flags estables entre versiones.

### El comando del despacho, flag por flag

En cada L40S del despacho corre una copia de vLLM. El comando, con vLLM 0.34.0 (noviembre de 2026):

```bash
vllm serve Qwen/Qwen3-32B-AWQ \
  --max-model-len 8192 \
  --max-num-seqs 8 \
  --served-model-name qwen3-32b \
  --api-key "$VLLM_CLAVE" \
  --reasoning-parser qwen3 \
  --default-chat-template-kwargs '{"enable_thinking": false}'
```

Cada línea, y lo que **no** está:

| Flag | Qué hace | Por omisión en la v0.34.0 | En el despacho |
|---|---|---|---|
| `Qwen/Qwen3-32B-AWQ` | El modelo, por su nombre en Hugging Face (o una carpeta local) | — | El AWQ de 4 bits; el método se detecta solo |
| `--max-model-len` | Contexto máximo por conversación: prompt más respuesta | el del `config.json` del modelo | 8,192, el tope de la ficha |
| `--max-num-seqs` | Cuántas conversaciones a lo mucho van en el [[batch\|batch]] | 256 en GPUs de menos de 70 GiB, como la L40S (1,024 en una H100) | 8, el número de diseño de la ficha |
| `--served-model-name` | El nombre que verán los clientes en `/v1/models` | el nombre del modelo | `qwen3-32b`, corto y estable |
| `--api-key` | La clave que debe traer cada petición (`Authorization: Bearer …`); también `VLLM_API_KEY` | ninguna | Una sola clave, para el [[gateway-de-llm\|gateway]] |
| `--reasoning-parser qwen3` | **Separa** el razonamiento en un campo aparte (`reasoning`) | ninguno | Por si alguna petición lo prende |
| `--default-chat-template-kwargs` | Valores por omisión para la [[plantilla-de-chat\|plantilla de chat]] en todas las peticiones | ninguno | `enable_thinking: false`: **apaga** el razonamiento |
| `--enable-prefix-caching` | [[prefix-caching\|Prefix caching]] | **prendido** | No hace falta ponerlo |
| `--gpu-memory-utilization` | Qué fracción de la memoria **total** de la GPU puede usar vLLM | **1.0** con el KV cache extensible | No se pone (abajo) |

Tres detalles que muerden:

**El razonamiento.** La documentación de vLLM lo dice tal cual: en Qwen3 está prendido por omisión, y se apaga con `enable_thinking=False` en los `chat_template_kwargs`, por petición o, como arriba, para todo el servidor. `--reasoning-parser qwen3` **no lo apaga**: solo pone el texto del razonamiento en su propio campo. Y la ficha de Hugging Face de `Qwen3-32B-AWQ` todavía muestra un comando con `--enable-reasoning`: ese flag ya no existe en el código de la 0.34.0. Además, el campo cambió de nombre (antes `reasoning_content`, ahora `reasoning`), y un cliente viejo lo lee vacío sin avisar.

**`--max-num-seqs`.** El tope por omisión, 256, es mucho más de lo que cabe. El despacho lo fija en **8**, las conversaciones a la vez con que dimensionó la memoria de cada L40S (con 0.90 caben 10 al tope, abajo). Ojo: 8 no es lo que una L40S atiende **a buena velocidad**. [De requisitos a hardware](/requisitos-hardware/) calcula ≈ 2 a ≥ 20 tokens por segundo con los prefills del despacho; por eso son 3 copias para las ≈ 5.6 a la vez de la hora pico, y en un día normal el tope ni se toca. Sirve para las ráfagas: si una copia junta 8, cada persona baja a ≈ 11–19 tokens por segundo (según cuántos prompts lea la GPU a la vez), pero nadie espera para empezar; con un tope de 2, las otras 6 esperarían en la fila hasta ≈ 27 s, lo que dura una respuesta. El número final lo da la prueba de carga del piloto.

**La [[clave-de-api|clave]].** `--api-key` es **una** clave para todos: no sabe quién es quién, no pone cuotas y no deja registro. Sirve para que nadie de la red le hable directo al motor salvo el gateway. Lo de las personas va delante.

### Cuánta memoria le queda al KV cache

`--gpu-memory-utilization` es el flag que más se copia mal. Según el código de vLLM 0.34.0, es una fracción de la memoria **total** de la GPU, no de la libre, e **incluye** todo lo que usa esa copia: pesos, activaciones, grabaciones de CUDA graphs y KV cache. Lo que queda después de lo demás es el KV cache.

:::formula El KV cache que deja `--gpu-memory-utilization`
M_{pedida} = f × V
M_{KV} = M_{pedida} − W − O
T = frac{M_{KV}}{m_{token}}
c = frac{T}{N}
- V: la VRAM de la GPU, en bytes
- f: el valor de `--gpu-memory-utilization`, entre 0 y 1
- M_{pedida}: lo más que esta copia de vLLM puede usar, en bytes
- W: los [[pesos]] del modelo, en bytes
- O: el [[overhead|overhead]]: activaciones del paso más grande, grabaciones de CUDA graphs y lo que reserva CUDA, en bytes
- M_{KV}: lo que queda para el [[kv-cache|KV cache]], en bytes
- m_{token}: el KV cache de un token, en bytes
- T: los tokens de KV cache que caben (vLLM los redondea a bloques enteros de 64)
- N: el contexto máximo por conversación, `--max-model-len`
- c: cuántas conversaciones **al tope** caben a la vez; con conversaciones más cortas caben más
:::

:::cuenta El despacho con `--gpu-memory-utilization 0.90` en una L40S
\(M_{pedida}\) // \(f\) = 0.90, \(V\) = 48 GB | 0.90 × 48 | 43.20 GB
\(M_{KV}\) // \(W\) = 19.32 GB, \(O\) = 2 GB, el «programa» de la herramienta de VRAM | 43.20 − 19.32 − 2 | 21.88 GB
\(m_{token}\) // 2 (K y V) × 64 capas × 8 cabezas KV × 128 números × 2 bytes | 262,144 bytes | 256 KiB
\(T\) // redondeado hacia abajo a bloques de 64 | 21.88 × 10⁹ ÷ 262,144 | 83,456 tokens
\(c\) // \(N\) = 8,192 | 83,456 ÷ 8,192 | ≈ 10.19 → 10
Con el largo típico // ≈ 6,500 tokens por conversación | 83,456 ÷ 6,500 | ≈ 12.8 → 12
= Con 0.90 caben 10 conversaciones al tope y 12 de largo típico: más que las 8 de diseño. Con 0.80 serían 7 al tope: ya no caben las 8.
:::

Cada 0.05 de fracción son 2.4 GB en una L40S: ≈ 1.1 conversaciones de 8,192 tokens. Por eso bajar «por si acaso» de 0.90 a 0.80 cuesta 3 conversaciones.

:::calculadora stack-serving-kv
Empieza con el despacho: L40S, 0.90, pesos de 19.32 GB y 2 GB de overhead. Baja a 0.80 y mira cómo las 8 de diseño dejan de caber. Cambia a la RTX PRO 6000 (el catálogo trae la Workstation Edition; la Server Edition que se cotiza también tiene 96 GB). La última fila hace la cuenta como TensorRT-LLM, con la fracción de la memoria **libre**.
:::

La misma cuenta, para varias fracciones a la vez:

```python
import math

V = 48e9                          # L40S: 48 GB de VRAM (gpus.json)
W, O = 19.32e9, 2e9               # pesos de Qwen3 32B en INT4 de AWQ y programa (overhead)
KV_TOKEN = 2 * 64 * 8 * 128 * 2   # bytes de KV por token: K y V, 64 capas, 8 cabezas KV, 128 números, 2 bytes
BLOQUE = 64                       # tokens por bloque de KV en vLLM 0.34

print(" f    pedido GB  KV GB  tokens   de 8,192  de 6,500")
for f in (0.80, 0.85, 0.90, 0.95, 1.00):
    pedido = math.ceil(V * f)                       # vLLM: fracción de la memoria TOTAL
    kv = pedido - W - O                             # lo que queda para el KV cache
    tokens = math.floor(kv / KV_TOKEN / BLOQUE) * BLOQUE
    print(f"{f:.2f}  {pedido/1e9:8.2f}  {kv/1e9:5.2f}  {tokens:7,}  {tokens//8192:6}  {tokens//6500:8}")

libre = V - W - O                                   # TensorRT-LLM: fracción de la memoria LIBRE
print(f"TRT-LLM 0.90 de lo libre: {0.9*libre/1e9:.2f} GB de KV")
```

```salida
 f    pedido GB  KV GB  tokens   de 8,192  de 6,500
0.80     38.40  17.08   65,152       7        10
0.85     40.80  19.48   74,304       9        11
0.90     43.20  21.88   83,456      10        12
0.95     45.60  24.28   92,608      11        14
1.00     48.00  26.68  101,760      12        15
TRT-LLM 0.90 de lo libre: 24.01 GB de KV
```

### Por qué el comando del despacho no lo pone

Aquí está el cambio de 2026 que más tutoriales deja viejos. Durante años el valor por omisión fue **0.9**, y todo el mundo lo copió (la herramienta de VRAM de esta app usa ese 10 % de margen); en la v0.20 (abril de 2026) subió a 0.92. En la **v0.34.0**, vLLM prendió por omisión el **KV cache extensible**: mide la memoria que de verdad quedó libre después de arrancar y dimensiona el KV cache con eso, y `--gpu-memory-utilization` pasó a valer **1.0** (0.92 cuando no se usa el modo extensible). Las notas de la versión dicen que, en la mayoría de los casos, **hay que quitar el flag** de las configuraciones; un valor explícito entre 0.8 y 1.0 que deje fuera al menos 1 GiB produce un aviso.

:::profundo El precio del KV cache extensible
Las notas de la versión dicen que el [[tpot|TPOT]] sube de 6 a 18 % en algunos modelos en H200 con 128 a la vez; se regresa al modo de antes con `--gpu-memory-utilization 0.9` o `--no-enable-extensible-kv-cache`. Y un valor explícito sigue sirviendo para dejarle memoria a lo que vLLM no mide: otro programa en la misma GPU, o una máquina de memoria unificada donde el sistema operativo comparte la memoria.
:::

Para el despacho, con una copia por GPU y nada más en ella, se recomienda no ponerlo; la cuenta de arriba sirve para entender qué se reparte. Y no se promete el número: al arrancar, vLLM imprime cuánta memoria quedó para el KV cache (en **GiB**: 21.88 GB son ≈ 20.38 GiB) y cuántos tokens caben, en una línea como la que leíste en [Batching continuo y PagedAttention](/batching/). Esa línea, guardada con la versión, es el dato.

### Tres copias y una prueba

El despacho tiene 3 L40S y el modelo cabe en una: lo natural son **3 [[replica|copias]] independientes**, una por GPU, cada una en su puerto, con un balanceador delante (por qué copias y no repartir un modelo entre las tres es tema de [Varias GPUs: tensor y pipeline parallel](/varias-gpus/)). Para arrancarlas, a cada proceso se le dice qué GPU ve con la variable `CUDA_VISIBLE_DEVICES`, como en la guía de vLLM:

```bash
CUDA_VISIBLE_DEVICES=0 vllm serve Qwen/Qwen3-32B-AWQ --port 8000 ...   # el resto de los flags, igual
CUDA_VISIBLE_DEVICES=1 vllm serve Qwen/Qwen3-32B-AWQ --port 8001 ...
CUDA_VISIBLE_DEVICES=2 vllm serve Qwen/Qwen3-32B-AWQ --port 8002 ...
```

En la práctica cada una va en su contenedor de Docker ([Empaquetado con Docker](https://sensei.trueml.app/e07-empaquetado/)), y delante va el gateway, que reparte entre las tres ([la lección de gateway](/gateway/)). Para comprobar que una copia contesta (vLLM escucha en el puerto 8000 por omisión), pregúntale qué modelos sirve:

```bash
curl http://localhost:8000/v1/models -H "Authorization: Bearer $VLLM_CLAVE"
```

Si responde con `qwen3-32b`, el motor está arriba. Que esté arriba no es que aguante: eso lo dice la prueba de carga.

## SGLang y TensorRT-LLM: los otros dos de servidor {SGLang and TensorRT-LLM: the other two server engines} [extra]

Los dos de servidor que el despacho no eligió, pero que vas a oír siempre. Cada uno tiene una idea propia que vale la pena entender.

### SGLang: RadixAttention y salida estructurada

**[[sglang|SGLang]]** es el otro gran motor de servidor abierto. Nació con el paper «SGLang: Efficient Execution of Structured Language Model Programs» (Zheng y otros, 2023) y lo hospeda LMSYS, una organización sin fines de lucro que incuba proyectos abiertos (Chatbot Arena fue otro de ellos); el código vive en `sgl-project`, con licencia Apache 2.0. Su README dice que está optimizado para agentes, servicio a gran escala y entrenamiento con refuerzo. La versión al 26 de noviembre de 2026 es la **v0.5.23** (2 de noviembre).

Corre en mucho hardware: NVIDIA desde las RTX 30 hasta las B300, AMD Instinct, TPU, Intel, Apple. La L40S aparece en su guía de instalación entre las GPUs que soporta FlashInfer, su kernel de atención por omisión.

:::ojo SGLang 0.5.23 pide CUDA 13
La guía de instalación de la 0.5.23 dice que SGLang requiere **[[cuda|CUDA]] 13** (y un driver de NVIDIA compatible con CUDA 13) y PyTorch 2.14; las imágenes de Docker para CUDA 12 terminaron en la v0.5.19. Si el servidor trae un driver viejo, no corre hasta actualizarlo. Para un TI que nunca ha operado una GPU, es una tarde de trabajo que hay que planear.
:::

Sus dos ideas de nombre propio:

### RadixAttention: el KV cache como árbol de prefijos

Ya conoces el [[prefix-caching|prefix caching]] de vLLM: cada bloque lleno del KV cache se guarda con una llave (un hash de sus tokens y de los anteriores) y se reutiliza si una pregunta nueva empieza igual. **[[radixattention|RadixAttention]]** guarda lo mismo en otra estructura: un **árbol radix**, o árbol de prefijos. Cada rama es una secuencia de tokens: dos peticiones que empiezan igual comparten las ramas de su principio y se separan donde dejan de coincidir. Guarda prompts **y** respuestas, y cuando falta memoria tira primero las hojas que llevan más tiempo sin usarse.

:::figura stack-serving-radix
El árbol de prefijos del despacho en una mañana: las instrucciones de ≈ 400 tokens son el tronco común; cada pregunta con sus fragmentos es una rama; la repregunta reutiliza la primera pregunta entera y se separa donde la plantilla reescribe la respuesta anterior.
:::

Para el despacho, la ganancia es la misma que con el prefix caching de vLLM: los ≈ 400 tokens de instrucciones y la repregunta, que empieza con la primera pregunta entera. El árbol brilla con **muchísimo** prefijo común y ramificado: un agente que llama al modelo diez veces con el mismo historial creciente, una evaluación que hace cien preguntas con el mismo documento, un chat de varias vueltas. El paper reportó hasta **6.4 veces** más throughput que los sistemas de punta de entonces, en tareas como control de agentes, chat de varias vueltas y decodificación de JSON (versiones de 2023 y 2024, en otras GPUs).

### Salida estructurada: que la respuesta sea JSON válido

Muchas aplicaciones no quieren prosa: quieren un JSON con campos fijos («cliente», «fecha», «monto»). Pedirlo en el prompt funciona casi siempre, y «casi» rompe programas. La **[[salida-estructurada|salida estructurada]]** (*structured output*, también *constrained decoding*) lo garantiza: el motor convierte el esquema en una gramática y, **antes de cada token**, tacha todos los tokens que romperían el formato. El sampler solo puede elegir entre los permitidos. Si en un tramo solo hay una opción válida (la comilla que cierra, el nombre del siguiente campo), SGLang mete ese tramo completo en una sola pasada del modelo en vez de una pasada por token: es la «máquina de estados finitos comprimida» de su paper, que en su prueba de JSON dio 1.6 veces más throughput.

SGLang trae varios motores de gramática (`xgrammar`, `outlines`, `llguidance`). vLLM también hace salida estructurada, con `xgrammar` y `guidance`. El blog de la v0.4 de SGLang dijo que con xgrammar era «hasta 10 veces más rápido» en JSON que otras soluciones abiertas, sin decir contra cuáles; no hay una comparación oficial entre los dos con las mismas condiciones.

### Cómo se arranca SGLang

```bash
python -m sglang.launch_server --model-path Qwen/Qwen3-32B-AWQ \
  --context-length 8192 --reasoning-parser qwen3 --port 30000
```

(La 0.5.23 también acepta `sglang serve`.) Los equivalentes de vLLM: `--context-length` es el contexto; `--mem-fraction-static`, la fracción de la memoria para pesos y KV cache (sin definir, la calcula sola); `--api-key` y `--served-model-name`, lo mismo; RadixAttention viene **prendido** (`--disable-radix-cache` lo apaga); el razonamiento de Qwen3 se apaga igual, con `enable_thinking`. Trae su propio balanceador para varias copias. ¿Corre el [[awq|AWQ]] del despacho en una L40S? Su lista de métodos incluye `awq` y `awq_marlin`, y la ficha de Qwen pide SGLang 0.4.6.post1 o más; qué kernel usa en una L40S no está escrito en lo que revisamos: se confirma probando.

**En qué es bueno:** cargas con mucho prefijo compartido (agentes, chats largos, evaluaciones), salida estructurada, servicio a gran escala con su balanceador. **En qué no:** pide un stack de CUDA muy reciente; menos documentación y menos respuestas resueltas en internet que vLLM.

### TensorRT-LLM: lo de NVIDIA, ya sin engines

**[[tensorrt-llm|TensorRT-LLM]]** es la biblioteca abierta de NVIDIA para acelerar LLMs en sus GPUs. Licencia Apache 2.0, Python con un núcleo en C++ y CUDA. La v1.0.0 salió el 24 de septiembre de 2025; al 26 de noviembre de 2026 va en la **v1.3.0** (20 de noviembre). Corre **solo en NVIDIA y en Linux**; su lista de hardware incluye Blackwell, Hopper, Ampere (A100) y, en Ada, la L40 y la **L40S**.

### El engine compilado, y por qué ya no

Si lees sobre TensorRT-LLM de antes de su v1.0 (septiembre de 2025), vas a encontrar **[[engine-compilado|engines]]**. El flujo era: 1) convertir el checkpoint del modelo al formato de TensorRT-LLM; 2) con la herramienta `trtllm-build`, **compilarlo** a un *engine* de TensorRT, un programa hecho a la medida de **una GPU, una versión del software y una configuración** (tamaño máximo de batch, largos máximos de entrada y salida); 3) servir ese engine. Era rapidísimo y frágil: cambiar de GPU, de versión o de contexto máximo era recompilar; un engine de una H100 no servía en una L40S.

:::analogia El traje a la medida
Un engine era un traje a la medida: perfecto para ti, hoy. Si engordas dos kilos, o se lo prestas a tu hermano, hay que volver al sastre.

Dónde se rompe: un traje lo puedes ajustar un poco; un engine no aceptaba ni un token más de contexto del que se compiló.
:::

La documentación de la v1.3.0 dice que **el backend antiguo de TensorRT se quitó** y que los proyectos nuevos usen `trtllm-serve` o su API de Python. TensorRT-LLM está «construido sobre PyTorch»: el modelo de Hugging Face se sirve directo, sin compilar (entre sus comandos ya no hay `trtllm-build`: solo `serve`, `bench` y `eval`). Su guía rápida:

```bash
trtllm-serve "nvidia/Qwen3-8B-FP8"
```

`trtllm-serve` trae la [[api-compatible-openai|API compatible con OpenAI]], `/health`, `/metrics` y flags para varias GPUs (`--tp_size`, `--pp_size`, `--ep_size`).

### En una L40S, y su «0.9» que no es el de vLLM

La tabla de cuantización de la v1.3.0 dice que en **Ada** se soportan FP8 y **AWQ de 4 bits con activaciones de 16 ([[solo-pesos|W4A16]])**, y [[fp4|NVFP4]] y MXFP4 **no** (la L40S no tiene hardware de FP4). La fila de Qwen3 también marca W4A16 AWQ. Pero la documentación habla de modelos cuantizados con las recetas de NVIDIA (ModelOpt), no del AWQ de Qwen: que ese archivo corra tal cual no está comprobado.

Un detalle que confunde a quien viene de vLLM: TensorRT-LLM también tiene una fracción de **0.9** por omisión, `free_gpu_memory_fraction`, pero es la de la memoria **libre** (después de cargar el modelo) que va al KV cache, no la del total.

:::cuenta El mismo «0.9», dos cuentas distintas
vLLM con 0.90 // fracción del total, menos pesos y overhead | 0.90 × 48 − 19.32 − 2 | 21.88 GB de KV
Memoria libre después de cargar // supuesto: el mismo overhead de 2 GB | 48 − 19.32 − 2 | 26.68 GB
TensorRT-LLM con 0.90 // fracción de lo libre | 0.90 × 26.68 | ≈ 24.01 GB de KV
Diferencia | 24.01 − 21.88 | ≈ 2.1 GB ≈ 1 conversación de 8,192 tokens
= El mismo número en dos programas no significa lo mismo. Lee siempre de qué es fracción.
:::

### Qué publica NVIDIA

La página de rendimiento de su documentación (v1.3.0) mide con `trtllm-bench` en modo *throughput*: todas las peticiones en la fila de golpe, sin concurrencia fija, longitudes fijas, pesos en FP8 o FP4 cuantizados por NVIDIA y tokens de **salida por segundo por GPU**. Con 1,000 tokens de entrada y 1,000 de salida: Llama 3.3 70B en dos H100 con FP8, ≈ **2,209** tokens/s por GPU; en dos H200, ≈ 2,587; en una B200 con FP4, ≈ 6,920. No hay filas de L40S ni de Qwen3 32B. Sí trae la RTX PRO 6000 Blackwell Server Edition, la alternativa que se cotiza, pero con Llama 3.3 70B y los MoE de Qwen3.

**En qué es bueno:** sacar lo último de una GPU de NVIDIA de gama alta (H100, H200, Blackwell), sobre todo con FP8 y FP4; NVIDIA lo afina para cada GPU nueva. **En qué no:** solo NVIDIA; menos modelos y formatos el día uno que vLLM; menos gente a quién preguntar.

## Benchmarks publicados y los demás programas {Published benchmarks and the other programs} [extra]

Cada proyecto publica números. Juntos en una tabla parecen una competencia; no lo son:

| Quién lo publicó | Fecha | GPU | Modelo y formato | Carga | Lo que dice |
|---|---|---|---|---|---|
| vLLM (blog) | 2023-06 | A10G y A100 de 40 GB | LLaMA 7B y 13B, 16 bits | Largos de ShareGPT (chats reales compartidos) | hasta 24× sobre Hugging Face y 3.5× sobre TGI |
| SGLang (blog de LMSYS) | 2024-07 | A100 y H100 | Llama 3 8B y 70B, BF16 y FP8 | Sintética y ShareGPT, prefix caching apagado | hasta 3.1× sobre vLLM 0.5.2 en 70B |
| TensorRT-LLM (página de rendimiento) | 2026-11 | H100, H200, B200 | Llama 3.3 70B, GPT-OSS, Qwen3 MoE; FP8 y [[fp4\|FP4]] | Todo de golpe, largos fijos | tokens de salida/s por GPU |
| llama.cpp (hilo de GitHub) | 2026-11 | RTX, H100, A100, L40 | Llama 2 7B, Q4_0 | **Una** conversación | tokens/s al leer 512 y al escribir 128 |

De fila a fila cambian la GPU, el modelo, el formato, los largos, el tipo de carga, la versión del rival (vLLM 0.5.2 es de 2024) y quién mide (cada proyecto afina mejor su propio motor). **Ninguna fila es en una L40S con Qwen3 32B en [[awq|AWQ]].** Lo más cercano en la GPU del despacho es la curva de NIM con Llama 3.1 8B que viste en [Concurrencia](/concurrencia/): otro modelo.

Los benchmarks publicados sirven para saber que un motor está en la conversación, no para decidir entre dos. Eso se decide midiendo **tu** modelo en **tu** GPU, con **tus** prompts y **tu** concurrencia, con los mismos ajustes para los dos. Cómo se hace una prueba así sin engañarte es el tema de la lección «Pruebas de carga y benchmarks honestos».

### Los demás que vas a oír

- **TGI** (Text Generation Inference, de Hugging Face): en **modo de mantenimiento** según su README, que recomienda vLLM, SGLang, llama.cpp o [[mlx|MLX]]; el repositorio está archivado (última versión, diciembre de 2025). Un tutorial que lo usa está viejo.
- **LMDeploy** (del grupo InternLM): servidor con motor propio en C++/CUDA (TurboMind) y otro en PyTorch, Apache 2.0, activo (v0.18.0, septiembre de 2026).
- **NVIDIA Dynamo** (v1.7.0, 24 de noviembre de 2026, Apache 2.0): no es un motor; **orquesta** motores (vLLM, SGLang, TensorRT-LLM) en clústeres, con el prefill y el decode en máquinas distintas. Para 3 GPUs sobra.
- **NVIDIA NIM**: contenedores de NVIDIA con un modelo curado y un motor adentro (su documentación v2.1.7 nombra vLLM y SGLang). Su licencia y precio no los revisamos aquí.
- **MLX-LM** (de Apple, MIT, v0.32.2): para generar texto con MLX en las Mac con chips de Apple.

## Cómo elegir: el árbol de decisión {How to choose: the decision tree}

La elección sale de cinco preguntas, en este orden: las primeras descartan más.

:::pasos
1. ¿Cuántas personas a la vez?
Una persona o un puñado (tú, tu equipo, una demo): los locales bastan y son más fáciles. Decenas o cientos a la vez, o un objetivo de latencia ([[slo|SLO]]) que alguien va a medir: un motor de servidor.

2. ¿Qué hardware y qué sistema operativo?
Mac: llama.cpp, [[mlx|MLX]]-LM u Ollama (que usa MLX). Solo CPU o una GPU que no es de NVIDIA ni de AMD: llama.cpp. GPU de NVIDIA o AMD en Linux: los de servidor. Solo NVIDIA y de gama alta: TensorRT-LLM entra a la lista. Windows sin Linux: los locales (o WSL para probar).

3. ¿En qué formato está tu modelo?
[[gguf|GGUF]]: llama.cpp u Ollama. [[awq|AWQ]], [[gptq|GPTQ]], FP8 o [[fp4|FP4]] en safetensors: vLLM, SGLang o TensorRT-LLM, si el motor tiene kernel para ese formato **en tu GPU**. Si cambias de motor, cambias de archivo, y el examen se repite.

4. ¿Qué pide la carga?
Chat general con un prompt fijo: vLLM. Mucho prefijo compartido y ramificado (agentes, evaluaciones, chats largos) o salida JSON pesada: SGLang merece una prueba. Latencia mínima en H100 o Blackwell con FP8 o FP4: TensorRT-LLM merece una prueba.

5. ¿Quién lo va a operar?
El mejor motor es el que tu equipo puede actualizar, leer y arreglar un lunes a las 8 de la mañana. La documentación y cuántas veces alguien ya resolvió tu error cuentan tanto como el benchmark.
:::

:::diagrama stack-serving-arbol
El árbol de decisión, de la primera pregunta a un motor. Recorre el camino del despacho: muchas personas, NVIDIA en Linux, un AWQ, chat con prompt fijo, un equipo que empieza.
:::

### La decisión del despacho

- **En el servidor: vLLM 0.34.0**, una copia por L40S (tres), en Linux, con el comando de arriba. Razones: atiende a muchos a la vez; sirve el AWQ del despacho con el kernel Marlin (según su código); trae la [[api-compatible-openai|API compatible con OpenAI]] que espera el [[gateway-de-llm|gateway]]; y es el de más documentación y comunidad para un equipo que empieza. Si el despacho cotiza la alternativa de **2 RTX PRO 6000 Blackwell Server Edition**, el motor y el comando son los mismos; cambian cuántas conversaciones caben en cada copia y el tope de `--max-num-seqs`.
- **En la laptop y en las demos: Ollama** (o llama.cpp), con el contexto fijado a mano (`OLLAMA_CONTEXT_LENGTH=8192`) y `think: false`. Para probar ideas de prompt en minutos; no para medir velocidad ni aprobar la calidad, que se hace con el AWQ en vLLM.
- **Delante de todo: el gateway**, que es el que autentica, reparte entre las 3 copias y registra ([la lección de gateway](/gateway/)).
- **La versión se fija y se anota.** vLLM saca versión cada 2 a 4 semanas, y la 0.34.0 cambió valores por omisión importantes. El piloto se corre con una versión, y se actualiza a propósito, repitiendo la prueba de carga y el examen, no porque salió una nueva.
- **El TI aprende Linux.** Los tres motores de servidor son de Linux: es parte del plan del piloto, no un detalle.

:::profundo ¿Y SGLang para el despacho?
El despacho tiene justo el tipo de prefijo que SGLang aprovecha: instrucciones fijas y repreguntas. Pero vLLM también lo reutiliza con su prefix caching, y la diferencia (árbol contra bloques con hash) se nota sobre todo con mucho prefijo ramificado, que el despacho no tiene. Y SGLang 0.5.23 pide [[cuda|CUDA]] 13 y tiene menos camino recorrido para el TI. Es buena segunda opción para el piloto, con la misma prueba de carga, si sobra una semana; no la primera.
:::

## Errores comunes {Common mistakes}

1. **Aprobar la calidad con el archivo de la laptop.** «En Ollama contestó bien, ya está». Era un [[gguf|GGUF]]; el servidor sirve un [[awq|AWQ]], otra cuantización. **Cómo evitarlo:** el examen del despacho se pasa con el archivo y el motor que van a producción.
2. **Dejar Ollama con sus valores por omisión en un servidor compartido.** Una petición a la vez, contexto según la VRAM, descarga a los 5 minutos, sin clave. **Cómo evitarlo:** para unas cuantas personas, fija `OLLAMA_NUM_PARALLEL`, `OLLAMA_CONTEXT_LENGTH` y `OLLAMA_KEEP_ALIVE`, ponle un [[gateway-de-llm|gateway]] delante y mira `ollama ps`; para cientos, un motor de servidor.
3. **Copiar el comando de un blog viejo.** El puerto 8080 de `llama-server` (desde octubre de 2026, 9931), el 0.9 de `--gpu-memory-utilization` (hoy 1.0 y se recomienda quitarlo), el `--enable-reasoning` de vLLM (ya no existe), el `trtllm-build` de TensorRT-LLM (ya no existe). **Cómo evitarlo:** lee la documentación de tu versión, corre `--help` y anota la versión junto al comando.
4. **Creer que `--reasoning-parser` apaga el razonamiento.** Solo lo separa en otro campo; el modelo sigue pensando y gastando segundos. **Cómo evitarlo:** `enable_thinking: false` en la plantilla (`--default-chat-template-kwargs` o por petición), y comprueba que la respuesta no trae razonamiento.
5. **Leer una fracción de memoria sin saber de qué es fracción.** El 0.9 de vLLM es del total e incluye los pesos; el de TensorRT-LLM es de lo libre. **Cómo evitarlo:** no prometas el KV cache con la cuenta: léelo en el log de arranque y anótalo.
6. **Elegir motor con benchmarks de otros.** Una tabla con otra GPU, otro modelo y otra versión no decide nada en la tuya. **Cómo evitarlo:** prueba los candidatos en tu GPU, con tu modelo, tus prompts y la misma carga.
7. **Exponer el puerto del motor a toda la red.** Ollama no tiene clave y la de vLLM es una para todos. **Cómo evitarlo:** el motor escucha solo al gateway, y las personas entran por él.

## En la vida real {In real life}

**El despacho.** La laptop con Ollama sirvió para ver que Qwen3 entiende sus contratos. El servidor son tres copias de vLLM 0.34.0, una por L40S, en Linux: el [[awq|AWQ]], contexto de 8,192, a lo más 8 conversaciones por copia, sin razonamiento y con una clave que solo conoce el [[gateway-de-llm|gateway]]. Con Ollama tal cual, una L40S atendería ≈ 179 preguntas por hora contra 750.

**Una persona con una Mac de 64 GB.** Supuesto del ejemplo: una consultora quiere un asistente privado en su Mac mini con M5 Pro de 64 GB de memoria unificada (307 GB/s, del catálogo). Aquí ganan los locales: Ollama (que en Mac usa [[mlx|MLX]]), llama.cpp con Metal o MLX-LM. Qwen3 32B en Q4_K_M pesa ≈ 20 GB y cabe con holgura. Con la eficiencia supuesta de 0.7, cada token lee ≈ 20 GB a ≈ 215 GB/s efectivos: **≈ 10 a 11 tokens por segundo** para ella sola, legible y suficiente. No hay offload porque hay una sola memoria, la [[memoria-unificada|memoria unificada]]. vLLM ni se considera.

**Una empresa que extrae datos de facturas en JSON.** Supuesto del ejemplo: una aseguradora manda miles de facturas al día a un modelo que debe devolver un JSON con 15 campos fijos, y un programa lo lee sin humanos. Un JSON roto es un reclamo atorado: la [[salida-estructurada|salida estructurada]] no es lujo, y el prompt (instrucciones y esquema) es el mismo en todas: prefijo compartido. SGLang, con su árbol de prefijos y su motor de gramáticas, es candidato natural; vLLM, con `structured_outputs`, también. Se prueban los dos con mil facturas reales y se elige por errores y por throughput.

**Un equipo con H100 que exprime la latencia.** Supuesto del ejemplo: un producto de voz necesita el primer token en menos de 300 ms con un modelo grande en FP8, en un servidor con 8 H100. El equipo tiene ingenieros de GPU y solo usa NVIDIA. TensorRT-LLM es candidato serio: NVIDIA lo afina para cada GPU nueva y ya no hay engines que recompilar. Lo ponen a competir con vLLM en su propia prueba de carga.

## Ejercicios {Exercises}

:::ejercicios
? [facil] El despacho prueba Ollama en una laptop cuya GPU tiene 8 GB de VRAM, sin cambiar nada. ¿Qué contexto usa Ollama 0.40.18 por omisión y qué pasa con una pregunta de 6,000 tokens?
Menos de 24 GiB de VRAM → **4k** (4,096 tokens): 8 GB son ≈ 7.5 GiB. La pregunta de ≈ 6,000 tokens no cabe en 4,096 y el modelo no ve todo el prompt (las versiones viejas de Ollama lo recortaban sin avisar; con la tuya, compruébalo con `prompt_eval_count`, los tokens de prompt que reporta la respuesta). **Arreglo:** `OLLAMA_CONTEXT_LENGTH=8192` (o `num_ctx 8192`) y comprobar con `ollama ps`. Ojo: con 8 GB de VRAM, los ≈ 20 GB de `qwen3:32b` tampoco caben: casi todo iría a la RAM.
? [facil] Son las 9:00 y la primera abogada del día pregunta algo al Ollama del servidor de pruebas, que nadie usó desde ayer a las 19:00. ¿Por qué tarda mucho más que las preguntas de las 10:00, y qué variable lo evita?
Por el [[keep-alive|keep-alive]]: tras **5 minutos** sin peticiones (`OLLAMA_KEEP_ALIVE` por omisión), Ollama sacó el modelo de la VRAM, y la primera pregunta paga la carga de ≈ 20 GB desde el disco. Con `OLLAMA_KEEP_ALIVE=-1` (o `keep_alive: -1` en la petición) se queda cargado siempre.
? [facil] De los cinco motores, ¿cuáles pueden servir el archivo `Qwen/Qwen3-32B-AWQ` tal cual, y cuáles no?
**vLLM sí** (su código lo manda al kernel Marlin en GPUs con capability 7.5 o más, como la L40S). **SGLang, probablemente** ([[awq|AWQ]] está en su lista de métodos y la ficha de Qwen pide SGLang ≥ 0.4.6.post1). **TensorRT-LLM, según su documentación** ([[solo-pesos|W4A16]] AWQ en Ada y para Qwen3), sin comprobar con ese archivo. **llama.cpp y Ollama, no**: usan [[gguf|GGUF]], otra cuantización del mismo modelo.
? [facil] Con vLLM 0.34.0, ¿cuál es la diferencia entre `--reasoning-parser qwen3` y `--default-chat-template-kwargs '{"enable_thinking": false}'`?
El primero **separa** el razonamiento en el campo `reasoning`; el modelo sigue pensando. El segundo lo **apaga** en la plantilla de chat de todas las peticiones (salvo que una pida otra cosa). El despacho quiere el segundo; el primero no estorba.
? [medio] Con `--gpu-memory-utilization 0.85` en una L40S (48 GB), pesos de 19.32 GB y 2 GB de overhead, ¿cuánta memoria queda para el KV cache, cuántos tokens caben (bloques de 64) y cuántas conversaciones de 8,192?
\(M_{pedida}\) = 0.85 × 48 = 40.80 GB. \(M_{KV}\) = 40.80 − 19.32 − 2 = **19.48 GB**. \(T\) = 19.48 × 10⁹ ÷ 262,144 ≈ 74,311 → a bloques de 64: 1,161 × 64 = **74,304 tokens**. \(c\) = 74,304 ÷ 8,192 ≈ 9.07 → **9 conversaciones** al tope (11 de 6,500). Sí caben las 8 de diseño, con menos holgura que con 0.90.
? [medio] Alguien propone «arreglar» Ollama corriendo una copia en cada una de las 3 L40S, cada una con una petición a la vez. Con el tiempo de servicio de la cuenta (≈ 20.1 s por pregunta), ¿alcanza para las 750 preguntas de la hora pico?
Cada copia atiende 3,600 ÷ 20.1 ≈ 179 por hora; tres, ≈ **537**. Llegan 750: \(ρ\) = 750 ÷ 537 ≈ **1.4**, todavía arriba de 1. La fila crece toda la hora y la espera llega a minutos. Copiar el servidor no arregla atender una a la vez: hace falta batching de verdad (o subir `OLLAMA_NUM_PARALLEL`, con su costo de memoria).
? [medio] Qwen3 32B en Q4_K_M pesa ≈ 20 GB en 64 capas. En una RTX 4090 (24 GB, 1,008 GB/s) caben 56 capas con su KV cache; las otras 8 van a una RAM de 89.6 GB/s (supuesto). Con \(η_m\) = 0.7, ¿cuántos tokens por segundo da, y cuántos daría con todo en la GPU?
Por capa: 20.0 ÷ 64 ≈ 0.313 GB. GPU: 56 × 0.313 ≈ 17.5 GB ÷ (0.7 × 1,008) ≈ **24.8 ms**. CPU: 8 × 0.313 ≈ 2.5 GB ÷ (0.7 × 89.6) ≈ **39.9 ms**. \(t_{token}\) ≈ 64.7 ms → **≈ 15.4 tokens/s**. Todo en la GPU: 20.0 ÷ 705.6 ≈ 28.4 ms → **≈ 35 tokens/s**. Solo 1 de cada 8 capas en la RAM, y la velocidad baja a menos de la mitad.
? [medio] El despacho cotiza la RTX PRO 6000 (96 GB; el catálogo trae la Workstation Edition y la Server Edition tiene la misma memoria). Con el mismo modelo y overhead, compara el KV cache con 0.90 en vLLM y con 0.90 en TensorRT-LLM, y cuántas conversaciones de 8,192 caben en cada uno.
vLLM, fracción del total: 0.90 × 96 − 19.32 − 2 = **65.08 GB** → 65.08 × 10⁹ ÷ 262,144 ≈ 248,260 → 248,256 tokens en bloques de 64 → **30** conversaciones. TensorRT-LLM, fracción de lo libre: 0.90 × (96 − 21.32) = 0.90 × 74.68 ≈ **67.21 GB** → ≈ 256,393 tokens → **31**. El mismo «0.9» da ≈ 2.1 GB de diferencia, igual que en la L40S: la resta es siempre 0.1 × (19.32 + 2) ≈ 2.1 GB, así que depende del modelo y del overhead, no de la GPU.
? [reto] Un compañero de TI propone: «Ollama con `OLLAMA_NUM_PARALLEL=8` y `OLLAMA_CONTEXT_LENGTH=8192` en cada L40S, y listo». ¿Cabe en memoria? ¿Qué problemas resuelve y cuáles no?
Memoria: la documentación dice que el contexto se multiplica por las peticiones en paralelo: 8 × 8,192 = 65,536 tokens × 256 KiB ≈ **17.2 GB** de KV, más ≈ 20 GB de pesos ≈ 37.2 GB de 48: **cabe**. Resuelve: la fila de una a la vez (llama-server por dentro hace batching continuo) y el contexto. **No resuelve:** (1) el archivo es GGUF, no el AWQ aprobado: el examen se repite; (2) sigue sin autenticación; (3) el keep-alive de 5 minutos, salvo que también fije `OLLAMA_KEEP_ALIVE=-1`; (4) no hay mediciones publicadas de Ollama con muchas personas en esta GPU: la velocidad por persona hay que medirla; (5) es una capa más encima de llama.cpp, con su propia versión fijada. Puede servir para un piloto chico; para 200 personas, la apuesta con más camino recorrido es vLLM.
? [reto] Al arrancar, una copia de vLLM del despacho imprime que quedaron **20.38 GiB** para el KV cache. (a) ¿Cuántos GB son y cuántos tokens caben en bloques de 64? (b) ¿Cuántas conversaciones de 8,192 y de 6,500? (c) ¿Con qué valor de `--gpu-memory-utilization` y overhead de la cuenta coincide, y qué le dirías a quien diga «solo caben 10 personas»?
(a) 20.38 × 2³⁰ ≈ **21.88 GB**; 21.88 × 10⁹ ÷ 262,144 ≈ 83,476 → 1,304 bloques × 64 = **83,456 tokens**. (b) 83,456 ÷ 8,192 ≈ 10.19 → **10** al tope; 83,456 ÷ 6,500 ≈ 12.8 → **12** de largo típico. (c) Coincide con **0.90** y 2 GB de overhead. «10 personas» confunde dos cosas: son 10 conversaciones **al tope** de contexto (más si son cortas), y conversaciones a la vez no son personas: 200 abogados generan ≈ 5.6 a la vez en la hora pico. Y caber no es atenderse bien: cuántas van a ≥ 20 tokens por segundo lo dice la cuenta de velocidad.
:::

## Lo que sigue {What comes next}

- **[Gateway, API compatible con OpenAI, autenticación y varios modelos](/gateway/)**, la siguiente, pone delante de las tres copias lo que el motor no hace: la cuenta de cada abogado, las cuotas en tokens, el reparto entre copias y modelos, y el registro de quién preguntó qué; y explica a fondo la API que aquí solo usaste.
- **[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)** explica por qué el despacho pone una copia por GPU y qué cambia en el comando de vLLM cuando el modelo no cabe en una.
- **[De requisitos a hardware](/requisitos-hardware/)** dice cuántas conversaciones aguanta cada GPU a la velocidad que se pide, el número contra el que se compara `--max-num-seqs`.
- **«Pruebas de carga y benchmarks honestos»** enseña a comparar dos motores en tu GPU sin engañarte; **«Observabilidad de GPUs e inferencia»**, a leer las métricas que vLLM publica en producción.
- Si te quedaron dudas de lo que esta lección dio por sabido: [Batching continuo y PagedAttention](/batching/) y [Formatos de cuantización en la práctica](/formatos-cuantizacion/) aquí; en Sensei, [APIs: REST, JSON, gRPC y streaming](https://sensei.trueml.app/apis/), [Balanceadores, proxies y gateways](https://sensei.trueml.app/balanceo/) y [Empaquetado con Docker](https://sensei.trueml.app/e07-empaquetado/).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
motor-de-inferencia plantilla-de-chat cuda-graph llama-cpp offload-a-cpu ollama modelfile keep-alive vllm sglang radixattention salida-estructurada tensorrt-llm engine-compilado
:::

## Chequeo {Check}

:::chequeo
? ¿Qué demostró la prueba de Ollama en la laptop del despacho, y qué no?
Que Qwen3 entiende sus documentos y que el TI sabe correr un modelo. No que aguante 750 preguntas en la hora pico (Ollama atiende una a la vez por omisión), ni la calidad del [[awq|AWQ]] que se va a servir (la laptop corrió un [[gguf|GGUF]]), ni nada de autenticación.
? ¿Qué hace un motor de inferencia entre que llega el JSON y sale el primer token?
Aplica la plantilla de chat, tokeniza, el scheduler mete la petición en un batch con bloques de KV cache (reutilizando el prefijo si ya existe), la GPU corre los kernels del prefill y el sampler elige el primer token, que sale por streaming.
? ¿Por qué Ollama tiene los mismos límites de velocidad que llama.cpp?
Porque por dentro **es** llama.cpp: sirve cada GGUF con un subproceso de `llama-server` (y usa [[mlx|MLX]] en Mac). Ollama agrega la descarga, los nombres, la carga automática y la API.
? ¿Qué cuenta exactamente `--gpu-memory-utilization` en vLLM 0.34.0, y por qué el despacho no lo pone?
La fracción de la memoria **total** de la GPU que puede usar esa copia, pesos incluidos. En la 0.34.0 vale 1.0 con el KV cache extensible, que mide la memoria libre al arrancar, y las notas recomiendan quitarlo si nada más usa la GPU. El KV cache que quedó se lee en el log de arranque.
? ¿Qué es RadixAttention y en qué carga gana más?
Guardar el KV cache de prompts y respuestas en un árbol de prefijos para reutilizar cualquier principio común. Gana más con mucho prefijo compartido y ramificado: agentes, evaluaciones, chats de muchas vueltas.
? ¿Qué era un engine compilado de TensorRT-LLM y por qué ya no hace falta?
Un programa compilado con `trtllm-build` a la medida de una GPU, una versión y una configuración (batch y largos máximos). TensorRT-LLM hoy se construye sobre PyTorch, quitó ese backend y `trtllm-serve` carga el modelo de Hugging Face directo.
:::
