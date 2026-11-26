---
titulo: Speculative decoding y contexto largo
en: Speculative decoding and long context
subtitulo: Cómo un modelo grande escribe varios tokens por cada lectura de sus pesos sin cambiar la respuesta, cuándo ese truco ayuda y cuándo estorba, y qué cuesta de verdad meterle a un LLM un expediente de 50 páginas.
pregunta: Si el decode se la pasa esperando a la memoria, ¿puedo sacar varios tokens de cada lectura de los pesos sin que la respuesta cambie? ¿Y qué hago cuando el despacho quiere resumir un expediente que no cabe en 8,192 tokens?
sensei: llms, latencia, numeros-maquina
---

:::idea
En el [[decode|decode]] la GPU tiene cálculo de sobra: lee todos los pesos para escribir **un** token. El [[speculative-decoding|speculative decoding]] aprovecha ese sobrante: algo barato propone los siguientes tokens y el modelo grande los revisa todos en una sola pasada, con una regla que deja la respuesta **igual** que sin el truco. Rinde con pocas conversaciones a la vez y se desvanece cuando el batch ya ocupa el cálculo. La otra mitad de la lección es el contexto largo: un expediente de 50 páginas son del orden de 33–40 mil tokens (una estimación gruesa), cuesta memoria que crece en línea recta y un prefill que crece al cuadrado, y que el modelo lo acepte no quiere decir que lo use bien.
:::

## Varios tokens por cada lectura de los pesos {Several tokens per read of the weights}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México, con 200 abogados y asistentes, que quiere preguntarle a sus expedientes con un LLM sin que un documento salga de su red. Su modelo es **Qwen3 32B en INT4 de [[awq|AWQ]]** (sus pesos guardados en 4 bits ocupan ≈ 19.32 GB) y lo sirve en **3 GPUs NVIDIA L40S** de 48 GB. Cada pregunta trae ≈ 6,000 tokens de entrada, la respuesta tiene ≈ 500, y cada conversación tiene un tope de 8,192 tokens. Se pide que cada persona vea al menos **20 tokens por segundo** y su primer token en **2 segundos** o menos. Además, el despacho quiere **resumir expedientes completos**, de ≈ 50 páginas cada uno.

Tres cosas que se explican a fondo en otro lado y aquí solo se recuerdan:

- Un LLM contesta en dos fases. En el [[prefill|prefill]] lee el prompt completo de golpe; en el [[decode|decode]] escribe un token a la vez, y cada token es una pasada completa por la red, porque el siguiente depende del anterior. Lo ves en [Transformers y LLMs](https://sensei.trueml.app/llms/).
- Cada pasada del decode lee de la memoria **todos** los pesos y el [[kv-cache|KV cache]] de la conversación (lo que el modelo recuerda de cada token anterior). Con una sola conversación, el paso está [[memory-bound|limitado por memoria]]: la GPU espera los bytes, no las cuentas.
- Juntar varias conversaciones en un [[batch|batch]] aprovecha la misma lectura de los pesos para todas. Lo viste en la lección de [batching](/batching/).

### La GPU calcula de más en el prefill y de menos en el decode

Mira lo raro. En el prefill, el modelo lee los pesos una vez y hace las cuentas de 6,000 tokens. En el decode, para cada token nuevo lee los mismos pesos y hace las cuentas de **uno**. La diferencia no es que el modelo no pueda calcular varios tokens a la vez: puede, lo hace en el prefill. La diferencia es que en el decode **no sabe todavía** cuáles son los tokens siguientes. Cada uno depende del anterior.

Ahora piensa al revés. Si alguien le diera al modelo grande una **propuesta** de los siguientes 3 tokens, el modelo podría calificarlos todos en una pasada, como un prefill chiquito de 3 tokens. Esa pasada lee los mismos pesos que un paso normal. Si las propuestas son buenas, salen 3 tokens por el precio de uno. Esa es toda la idea del [[speculative-decoding|speculative decoding]] (decodificación especulativa).

Antes de creerla, comprueba que calificar varios tokens cuesta lo mismo que escribir uno, con los dos relojes del paso: el de la memoria y el del cálculo.

:::formula El paso que califica \(k\) tokens por conversación
t_{mem} = frac{W + b × K}{η_m × B_W}
t_{cálc}(k) = frac{2 × P × b × k}{η_c × F}
t_{paso}(k) = max(t_{mem}, t_{cálc}(k))
- W: los bytes de los pesos (19.32 GB en el despacho)
- K: los bytes del KV cache que lee cada conversación en el paso
- b: las conversaciones del batch
- k: los tokens que se calculan por conversación en el paso (1 en un paso normal)
- P: los parámetros del modelo (32,762 millones en Qwen3 32B)
- B_W: el [[ancho-de-banda|ancho de banda]] de la GPU, en bytes por segundo
- F: el [[pico-de-calculo|pico de cálculo]] denso de la GPU, en FLOPs por segundo
- η_m, η_c: las [[eficiencia|eficiencias]] de la memoria y del cálculo (0.7 y 0.5 en el despacho, supuestas)
- t_{paso}(k): lo que dura el paso: el mayor de los dos relojes, en segundos
:::

Los bytes no dependen de \(k\): los pesos se leen una vez y el KV cache de cada conversación también. Solo el cálculo crece con \(k\). Mientras \(t_{cálc}(k)\) siga debajo de \(t_{mem}\), calificar \(k\) tokens sale gratis.

:::cuenta El despacho: ¿cuánto cuesta calificar 4 tokens con una conversación?
KV de la conversación, \(K\) // a media respuesta: ≈ 6,000 de entrada + 250 escritos; 256 KiB por token en BF16 | 6,250 × 262,144 bytes | ≈ 1.64 GB
Reloj de la memoria, \(t_{mem}\) // \(b\) = 1; L40S: \(B_W\) = 864 GB/s (gpus.json, a noviembre de 2026), \(η_m\) = 0.7 | (19.32 + 1.64) GB ÷ (0.7 × 864 GB/s) | ≈ 34.7 ms
Cálculo de 1 token, \(t_{cálc}(1)\) // \(F\) = 362.05 TFLOPS densos en FP16, \(η_c\) = 0.5 | 2 × 32.762 × 10⁹ ÷ (0.5 × 362.05 × 10¹²) | ≈ 0.36 ms
Cálculo de 4 tokens, \(t_{cálc}(4)\) // \(k\) = 4 | 4 × 0.36 ms | ≈ 1.45 ms
Paso con 4 tokens, \(t_{paso}(4)\) | max(34.7, 1.45) | **≈ 34.7 ms**
= Calificar 4 tokens tarda lo mismo que escribir uno: el reloj de la memoria manda por ≈ 24 veces. En ese paso, la GPU pasa más del 95 % del tiempo esperando bytes.
:::

### Borrador y verificación

El método tiene dos piezas y una regla:

- El **[[modelo-borrador|borrador]]** (*draft model*) propone los siguientes \(γ\) tokens (la letra griega gamma; vLLM llama a ese número `num_speculative_tokens`). Tiene que ser mucho más barato que el modelo grande: un modelo chico, unas cabezas extra o, como vas a ver, ni siquiera un modelo.
- El **modelo grande** hace una [[verificacion-en-paralelo|verificación en paralelo]]: una pasada sobre las \(γ\) propuestas que le da, para cada posición, la distribución de probabilidad del siguiente token. Salen \(γ + 1\) distribuciones: una por cada propuesta y una más, de regalo, para la posición que sigue a la última.
- La **regla de aceptación** recorre las propuestas en orden. Acepta mientras el grande esté de acuerdo; en el primer desacuerdo, tira esa propuesta y todas las que siguen, y en su lugar pone un token que sale del grande. Si acepta todas, agrega el token de regalo.

En cada ciclo salen **al menos 1** token (si rechaza el primero, el grande escribe ese) y **a lo más \(γ + 1\)**. Nunca sale menos que en un paso normal; lo que se arriesga es el tiempo del borrador.

:::figura speculative-pasos
Tres tokens del despacho escritos de dos formas. Arriba, tres pasadas completas del modelo grande. Abajo, tres pasos chiquitos del borrador y una sola pasada del grande que acepta dos propuestas, rechaza la tercera y escribe la buena. Salen los mismos tokens en ≈ 40 ms en vez de ≈ 104.
:::

:::analogia La socia y la pasante
Una socia del despacho dicta un escrito, palabra por palabra. Cada palabra le cuesta lo mismo: tiene que repasar mentalmente el expediente entero. Una pasante que la conoce bien se adelanta y escribe las siguientes tres palabras en un papelito. La socia lee el papelito de un vistazo, con el expediente ya en la cabeza: «la», sí; «cláusula», sí; «15», no, es la 14. Tacha desde ahí, dice «14» y sigue. Revisar tres palabras le costó lo mismo que dictar una.

Dónde se rompe: la socia no revisa «a ojo» ni acepta lo que «suena bien». Acepta solo lo que ella habría dicho, con una regla precisa, y por eso el escrito final es **el mismo** que si hubiera dictado sola. Y revisar es gratis solo mientras ella tenga atención de sobra: si ya está dictando diez escritos a la vez (un batch grande), cada papelito le quita tiempo de verdad.
:::

:::diagrama speculative-ciclo
Un ciclo completo con las tres propuestas de la figura. Toca cada caja para ver qué hace, o sigue el recorrido.
:::

Con la regla más simple, la de la decodificación *greedy* (siempre el token más probable), la aceptación es obvia: se acepta la propuesta si es justo el token que el grande habría elegido. El texto sale idéntico, token por token. Con muestreo (cuando el modelo escoge al azar según sus probabilidades, con temperatura), la regla es más fina, y es la que explica la siguiente sección.

:::ojo
Speculative decoding **no** hace más rápido el [[prefill|prefill]]. El prefill ya calcula todos los tokens del prompt en una pasada y está limitado por cálculo, no por memoria. El tiempo al primer token ([[ttft|TTFT]]) del despacho, ≈ 2.2–2.4 s en una L40S, se queda igual. Lo que acelera es lo que viene después: los tokens por segundo de la respuesta.
:::

## Por qué la respuesta no cambia {Why the output doesn't change} [extra]

Esta es la parte que hace al truco aceptable en producción. Un acelerador que cambia las respuestas obligaría a volver a pasar el examen de calidad. Este no: Leviathan y otros (Google, 2023) demuestran que el muestreo especulativo da **la misma distribución de salida** que el modelo grande solo, con cualquier borrador. Chen y otros (DeepMind, 2023) llegan a lo mismo y lo dicen con un matiz honesto: la distribución se preserva «dentro de la numérica del hardware».

### La regla, con muestreo

Llama \(p\) a la distribución del modelo grande para la siguiente posición y \(q\) a la del borrador. El borrador ya muestreó su propuesta \(x\) de \(q\). La regla es un muestreo por rechazo modificado:

:::pasos
1. Aceptar con probabilidad min(1, p ÷ q)
Si el grande le da a \(x\) al menos tanta probabilidad como el borrador (\(p(x) ≥ q(x)\)), se acepta siempre. Si le da menos, se acepta con probabilidad \(p(x) ÷ q(x)\): el borrador «se emocionó» con ese token y hay que corregir el exceso.
2. Si se rechaza, muestrear del residuo
Se arma la distribución \(max(0, p − q)\), normalizada para que sume 1: los tokens que el grande quería **más** que el borrador. De ahí sale el token que se escribe. El residuo llena justo lo que al borrador le faltó.
3. Seguir solo si se aceptó
Si la propuesta se rechazó, las que venían detrás se tiran: estaban condicionadas a un token que no se quedó.
:::

La cuenta de por qué cuadra es corta. La probabilidad de que salga \(x\) es la de que el borrador lo proponga y se acepte, \(q(x) × min(1, p(x) ÷ q(x)) = min(q(x), p(x))\), más la de que se rechace algo y el residuo dé \(x\). Las dos partes suman exactamente \(p(x)\). Y de paso sale la probabilidad de aceptar en una posición: \(sum min(p, q)\), qué tanto se enciman las dos distribuciones. Es la [[tasa-de-aceptacion|tasa de aceptación]] de esa posición.

### Compruébalo en tu computadora

El código simula 100,000 veces una posición de la respuesta del despacho: el grande quiere «la» con 50 %, el borrador la propone con 70 %, y así. Si la regla funciona, lo que sale debe seguir \(p\), no \(q\).

```python
import random
random.seed(7)
tokens = ["la", "esta", "dicha", "otra"]
p = [0.50, 0.30, 0.15, 0.05]   # modelo grande: lo que de verdad escribiría
q = [0.70, 0.10, 0.10, 0.10]   # borrador: se parece, pero no es igual

def un_token():
    x = random.choices(range(4), weights=q)[0]          # el borrador propone
    if random.random() < min(1, p[x] / q[x]):           # aceptar con min(1, p/q)
        return x, True
    resto = [max(0, pi - qi) for pi, qi in zip(p, q)]   # si no, muestrear del residuo
    return random.choices(range(4), weights=resto)[0], False

N = 100_000
cuenta, aceptados = [0] * 4, 0
for _ in range(N):
    x, ok = un_token()
    cuenta[x] += 1
    aceptados += ok
for t, pi, c in zip(tokens, p, cuenta):
    print(f"{t:>6}: p = {pi:.2f}   sale {c / N:.3f}")
print(f"aceptados: {aceptados / N:.3f}   suma de min(p, q): {sum(map(min, p, q)):.2f}")
```

```salida
    la: p = 0.50   sale 0.502
  esta: p = 0.30   sale 0.298
 dicha: p = 0.15   sale 0.150
  otra: p = 0.05   sale 0.050
aceptados: 0.750   suma de min(p, q): 0.75
```

Lo que sale sigue a \(p\), aunque las propuestas vinieron de \(q\), que estaba bastante lejos (70 % contra 50 % en «la»). El borrador malo no ensucia la respuesta: solo baja la aceptación. Aquí se acepta el 75 % de las veces, justo \(sum min(p, q)\) = 0.50 + 0.10 + 0.10 + 0.05.

:::profundo «Dentro de la numérica del hardware»: cuándo sí cambia algo
La igualdad es matemática. En una GPU, la pasada que verifica 4 tokens no hace las sumas en el mismo orden que 4 pasadas de un token, y con números de punto flotante el orden cambia los últimos dígitos. La documentación de vLLM lo dice: con tamaños de lote distintos puede haber variaciones en los *logprobs* (las probabilidades que el modelo le da a cada token). La de llama.cpp agrega que, con muestreo al azar, los resultados pueden diferir entre CPU, bibliotecas de cálculo (*backends*) y dispositivos aunque fijes la semilla; para igualdad exacta recomienda *greedy*. En la práctica, para el examen del despacho esto pesa lo mismo que cambiar de versión del servidor: nada que se note en la calidad, pero sí en una prueba que compare textos carácter por carácter.

Ojo con una excepción que sí cambia la distribución: vLLM ofrece variantes de verificación que **aceptan de más** a cambio de velocidad (la documentación marca su método `fly` como con pérdida). Si las usas, ya no es el mismo modelo y el examen se vuelve a correr.
:::

## Cuánto acelera: α, γ y c {How much faster: α, γ and c}

La velocidad depende de tres números. Los tres tienen nombre en el paper de Leviathan y otros:

- **\(α\)**, la [[tasa-de-aceptacion|tasa de aceptación]]: la probabilidad de que el grande acepte una propuesta. Depende de qué tan bien el borrador imita al grande **en tus textos**.
- **\(γ\)**: cuántos tokens propone el borrador por ciclo.
- **\(c\)**, el coeficiente de costo: lo que tarda un paso del borrador entre lo que tarda un paso del grande. Un borrador que tarda 5 % de un paso del grande tiene \(c\) = 0.05.

Suponiendo que cada propuesta se acepta con la misma probabilidad \(α\), sin importar las anteriores, los tokens que salen en promedio por ciclo son una suma geométrica: sale el primero siempre, el segundo si se aceptó el primero (\(α\)), el tercero si se aceptaron dos (\(α^2\)), y así hasta \(γ + 1\).

:::formula Tokens por ciclo y aceleración (Leviathan y otros, 2023)
E = frac{1 − α^{γ+1}}{1 − α}
S = frac{E}{γ × c + 1}
- α: la tasa de aceptación, entre 0 y 1 (sin unidad)
- γ: los tokens que propone el borrador por ciclo
- c: el costo de un paso del borrador entre el de un paso del grande (sin unidad)
- E: los tokens que salen en promedio por ciclo, entre 1 y γ + 1
- γ × c + 1: lo que dura un ciclo, medido en pasos del grande: γ pasos del borrador y una verificación
- S: cuántas veces más rápido sale la respuesta que sin borrador
:::

El denominador de \(S\) esconde el supuesto importante: la verificación de \(γ + 1\) tokens cuesta **un** paso del grande. El paper lo dice así: supone que puede correr las \(γ + 1\) evaluaciones en paralelo sin que crezca el tiempo, porque hay cálculo de sobra, y advierte que sin ese cálculo de sobra el método no ayuda. Es lo que comprobaste con la cuenta de la sección anterior, y lo que deja de valer con un batch grande.

:::cuenta El ejemplo del paper y una estimación para el despacho
Tokens por ciclo con un buen borrador, \(E\) // \(α\) = 0.8, \(γ\) = 3 | (1 − 0.8⁴) ÷ (1 − 0.8) = 0.5904 ÷ 0.2 | ≈ 2.95
Lo que dura el ciclo // \(c\) = 0.05 | 3 × 0.05 + 1 | 1.15 pasos
Aceleración, \(S\) | 2.95 ÷ 1.15 | **≈ 2.57×**
Tokens por ciclo con un borrador más modesto, \(E\) // \(α\) = 0.6 (la que sale de una medición con Qwen3 32B, abajo), \(γ\) = 3 | (1 − 0.6⁴) ÷ (1 − 0.6) = 0.8704 ÷ 0.4 | ≈ 2.18
Aceleración, \(S\) | 2.18 ÷ 1.15 | **≈ 1.89×**
Despacho con una conversación // sin borrador, 1 ÷ 34.7 ms | 28.9 × 1.89 | ≈ 54.6 tokens/s
= Con una sola conversación, un abogado vería su respuesta escribirse ≈ 1.9 veces más rápido: de ≈ 29 a ≈ 55 tokens por segundo, en la cuenta de techo. Bajar \(α\) de 0.8 a 0.6 se come casi la mitad de la ganancia.
:::

¿De dónde sale el 0.6? Red Hat publicó un borrador EAGLE-3 para Qwen3 32B y midió su **longitud de aceptación** en una prueba de resumen de noticias (80 textos de CNN/DailyMail), con 2 GPUs A100, vLLM 0.11 y temperatura 0.6. Con \(γ\) = 3 obtuvo 2.15. La tarjeta no define esa longitud, pero Red Hat, en su artículo sobre EAGLE-3, la describe como los tokens que salen por cada pasada del verificador, y vLLM la calcula como 1 + aceptados ÷ ciclos: cuenta el token que el grande siempre pone. Es la \(E\) de la fórmula. Despejando \(1 + α + α^2 + α^3\) = 2.15 sale \(α\) ≈ 0.59, y la lección redondea a 0.6.

Ojo: la fórmula supone que todas las posiciones se aceptan igual, y en la realidad la primera se acepta más que la tercera (el artículo de Red Hat lo advierte). Con \(γ\) = 1 la tabla da 1.62: la primera propuesta pasa ≈ 62 % de las veces. El 0.59 es un **α equivalente**, el número fijo que reproduce la medición con \(γ\) = 3.

:::figura speculative-aceptacion
Las barras son lo que midió Red Hat con su EAGLE-3 para Qwen3 32B al subir γ de 1 a 7. Los puntos son la fórmula con α = 0.59. Hasta γ = 3 casi coinciden; de ahí en adelante la medición queda un poco abajo, porque las propuestas lejanas se aceptan menos de lo que supone una α fija. Las dos se aplanan: de γ = 3 a γ = 7 apenas se ganan 0.18 tokens por verificación.
:::

### Subir γ ayuda cada vez menos

La figura enseña la regla práctica. Proponer más tokens solo sirve si los anteriores se aceptaron: con \(α\) = 0.6, la quinta propuesta se usa apenas si se aceptaron las cuatro primeras, \(0.6^4\) ≈ 13 % de las veces. Mientras tanto, cada propuesta cuesta un paso de borrador. Hay un \(γ\) mejor, y es chico.

```python
def tokens_por_paso(a, g):            # Leviathan: (1 − α^(γ+1)) ÷ (1 − α)
    return (1 - a ** (g + 1)) / (1 - a)

def aceleracion(a, g, c):             # ... ÷ (γc + 1)
    return tokens_por_paso(a, g) / (g * c + 1)

c = 0.05                              # el borrador cuesta 5 % de un paso del grande (supuesto)
print(" γ   α=0.6: tok/paso  veces   α=0.8: tok/paso  veces")
for g in (1, 2, 3, 4, 5, 7, 10):
    print(f"{g:>2}   {tokens_por_paso(0.6, g):>14.2f}  {aceleracion(0.6, g, c):>5.2f}"
          f"   {tokens_por_paso(0.8, g):>14.2f}  {aceleracion(0.8, g, c):>5.2f}")
```

```salida
 γ   α=0.6: tok/paso  veces   α=0.8: tok/paso  veces
 1             1.60   1.52             1.80   1.71
 2             1.96   1.78             2.44   2.22
 3             2.18   1.89             2.95   2.57
 4             2.31   1.92             3.36   2.80
 5             2.38   1.91             3.69   2.95
 7             2.46   1.82             4.16   3.08
10             2.49   1.66             4.57   3.05
```

Con \(α\) = 0.6, lo mejor está en \(γ\) = 4 y casi da igual 3 o 5; con 10 ya se pierde. Con \(α\) = 0.8 el óptimo se va a \(γ\) ≈ 7–10, porque las propuestas largas sí se usan. El límite cuando \(α\) llega a 1 es \((γ + 1) ÷ (γ × c + 1)\): ni con un borrador perfecto pasas de ahí. Por eso las configuraciones típicas usan 3 a 5 (la tarjeta de Red Hat usa 3; llama.cpp propone 3 por omisión con `--spec-draft-n-max`).

:::calculadora speculative-aceleracion
Arranca con el despacho fuera de la hora pico: una conversación, α = 0.6, γ = 3. Sube α a 0.8 y mira cómo pasa de ≈ 1.9× a ≈ 2.6×. Luego elige el escenario de la hora pico y el del clasificador de correos: la sección «Cuándo deja de ayudar» explica por qué uno se sostiene y el otro frena.
:::

:::profundo Las cifras que reportan los papers
Cada método publica la suya, medida con su modelo, su GPU y sus textos. Sirven para saber el orden de magnitud, no para prometerle un número a un cliente:

| Método | Modelo de la prueba | Aceleración reportada |
|---|---|---|
| Speculative decoding (Leviathan y otros) | T5-XXL | 2–3× |
| Speculative sampling (Chen y otros) | Chinchilla, 70 mil millones | 2–2.5× |
| [[eagle\|EAGLE]] | LLaMA2-Chat 70B | 2.7–3.5× |
| EAGLE-2 | tres familias, seis tareas | 3.05–4.26× |
| EAGLE-3 | varios | hasta 6.5× |
| EAGLE-3 de AngelSlim | **Qwen3 32B**, una H20, una conversación | 43.3 → 74.1 tokens/s ≈ 1.71× |

Nota la distancia entre «hasta 6.5×» y el 1.71× medido con el modelo del despacho. Las cifras de los papers son de sus mejores casos; el número que importa es el de tu modelo con tus textos.
:::

## De dónde sale el borrador {Where the draft comes from}

El borrador es lo que más cambia de un método a otro. Hay cinco familias, de la más vieja a la más barata.

### Un modelo chico de la misma familia

La forma original: un modelo pequeño que comparte el **tokenizador** con el grande (si no, sus tokens no significan lo mismo y no se pueden comparar). Leviathan y otros usaron T5-small, T5-base y T5-large (de 77 a 800 millones de parámetros) como borradores de T5-XXL; el más chico dio la mayor aceleración en casi todas sus pruebas. Es fácil de armar, pero el borrador tiene sus propios pesos y su propio [[kv-cache|KV cache]] en la [[vram|VRAM]], y su \(c\) es la proporción de tamaños más el costo de llamarlo. Para Qwen3 32B, el candidato natural es uno de los Qwen3 chicos, como el de 0.6 o el de 1.7 mil millones de parámetros: según el informe técnico de Qwen3, toda la familia usa el mismo tokenizador. No encontramos una medición publicada de qué tan bien acierta con el 32B.

### Cabezas extra: Medusa y EAGLE

En vez de un modelo aparte, se le agregan al grande unas piezas chicas que miran **lo que el grande ya calculó** para adivinar lo que sigue.

- **Medusa** (2024) le pone varias cabezas de decodificación, cada una adivina un token más adelante, y verifica las combinaciones como un árbol. Sus autores reportan más de 2.2× con las cabezas entrenadas sobre el modelo congelado.
- **[[eagle|EAGLE]]** (Li y otros, 2024) entrena una capa chica que predice sobre las representaciones internas de la penúltima capa (*features*), no sobre tokens, y le pasa al borrador el token del paso siguiente para quitarle dudas. EAGLE-2 arma un árbol de candidatos que cambia según el contexto, usando la confianza del borrador. EAGLE-3 (2025) vuelve a predecir tokens directamente, junta features de varias capas y se entrena simulando cómo se va a usar.

Las dos tienen el mismo precio: hay que **entrenarlas para cada modelo**. Un EAGLE de Llama no sirve para Qwen. Para Qwen3 32B hay al menos dos publicados: el de Red Hat (`RedHatAI/Qwen3-32B-speculator.eagle3`, Apache 2.0, entrenado con conversaciones generales de ShareGPT y UltraChat) y el de AngelSlim de Tencent (`AngelSlim/Qwen3-32B_eagle3`), los dos con mediciones publicadas. En Hugging Face hay otros de la comunidad, pero a noviembre de 2026 ni Qwen ni NVIDIA publican uno para Qwen3 32B.

### MTP: el modelo ya trae su borrador

La predicción de varios tokens ([[mtp|MTP]], *multi-token prediction*) es primero una forma de **entrenar**: además del siguiente token, unos módulos extra aprenden a predecir los que siguen. DeepSeek-V3 la usa así, y al servir puede tirar esos módulos o usarlos de borrador. DeepSeek reporta que su segundo token predicho se acepta entre 85 % y 90 % de las veces, y que eso da ≈ 1.8 veces los tokens por segundo. Atina tanto porque viene del mismo entrenamiento que el modelo. Pero solo existe si el modelo lo trae: la model card de Qwen3 32B no menciona módulos MTP.

### Prompt lookup: el borrador es tu propio prompt

El más simple de todos. El [[prompt-lookup|prompt lookup]] (también llamado *n-gram*) no usa ningún modelo: busca si los últimos tokens escritos ya aparecen en el prompt y, si sí, propone los que les siguen ahí. Su costo es una búsqueda de texto, \(c\) ≈ 0.

Su autor, Apoorv Saxena, lo pensó para las tareas donde la salida **copia** de la entrada: resumir, contestar sobre un documento, conversar con historial, editar código. Reporta 2–4× en esas tareas, y un promedio de 2.4× en resumen y preguntas sobre un contexto con un modelo de 7 mil millones de parámetros. El blog de vLLM midió hasta 2.8× con n-gram en resumen de noticias, con Llama 3 70B en 4 H100 y poca carga. Con texto nuevo (escribir una carta desde cero) casi nunca atina.

:::ejemplo Prompt lookup en un resumen del despacho
El expediente dice, en la página 12: «…conforme a lo dispuesto en la cláusula décima segunda del contrato de arrendamiento celebrado el…». El resumen va escribiendo: «El arrendador incumplió lo dispuesto en la cláusula». Los últimos tokens, «dispuesto en la cláusula», aparecen tal cual en el prompt. El servidor propone los que siguen allá: «décima», «segunda», «del», «contrato». El modelo grande los verifica en una pasada. Si quería citar la cláusula igual, salen 5 tokens (las 4 propuestas y la de regalo) en lo que costaba uno.

Es justo el caso favorable: un resumen jurídico copia nombres, fechas, montos y citas de cláusulas. Qué tan seguido atina en español jurídico no está medido en público; es de lo primero que el despacho mediría.
:::

:::profundo Qué se configura en el servidor
En vLLM todo pasa por una opción, `--speculative-config`, con un JSON. Sus campos principales: `method` (`ngram`, `draft_model`, `eagle3`, `mtp` y otros), `model` (el borrador, si hay), `num_speculative_tokens` (la \(γ\)) y, para n-gram, `prompt_lookup_min` y `prompt_lookup_max` (el largo mínimo y máximo del pedazo de texto a buscar). Los dos ejemplos que vienen en la documentación y en la tarjeta de Red Hat:

```text
# n-gram, de la documentación de vLLM
--speculative-config '{"method":"ngram","num_speculative_tokens":4,"prompt_lookup_min":2,"prompt_lookup_max":5}'

# EAGLE-3 para Qwen3 32B, de la tarjeta de Red Hat
--speculative-config '{"model":"RedHatAI/Qwen3-32B-speculator.eagle3","num_speculative_tokens":3,"method":"eagle3"}'
```

La documentación de vLLM resume la diferencia: los métodos con modelo (EAGLE, MTP, borrador) dan la mayor reducción de latencia, y los simples (n-gram, y *suffix decoding*, que busca también en respuestas anteriores) dan aceleraciones modestas. llama.cpp tiene su propio juego de opciones (`--spec-type` con borrador aparte, EAGLE-3, MTP o varias formas de n-gram); los servidores se comparan a fondo en la lección «[Del laptop al servidor](/stack-serving/)».
:::

:::ojo
Dos cosas que nadie ha medido para el despacho y que hay que medir antes de prometer: (1) los EAGLE-3 de Qwen3 32B se entrenaron sobre los pesos en BF16, y el despacho sirve el modelo en INT4 de [[awq|AWQ]]; si su tasa de aceptación se sostiene con el modelo cuantizado no está publicado. (2) Se entrenaron con conversaciones generales, no con escritos jurídicos en español. Las dos cosas pueden bajar \(α\). Se mide con el examen y con los registros del servidor, que reportan la aceptación.
:::

## Cuándo deja de ayudar: el batch {When it stops helping: the batch}

Toda la cuenta de la aceleración descansa en un supuesto: que verificar \(γ + 1\) tokens cuesta lo mismo que escribir uno, porque sobra cálculo. Con una conversación sobra muchísimo. Con un [[batch|batch]] grande, el cálculo del paso crece con cada conversación y el sobrante se acaba. Cuando ya no sobra, verificar cuesta \(γ + 1\) veces más, y los tokens rechazados son cálculo tirado.

La forma honesta de verlo es meter los dos relojes del paso dentro de la fórmula de la aceleración. Esto **no** está en el paper de Leviathan: es un modelo simplificado de esta lección. Supone que el paso dura lo que el mayor de los dos relojes, que \(α\) no cambia con el batch, que todas las conversaciones especulan y que un paso del borrador cuesta \(c\) pasos normales con ese batch. No cuenta la atención extra de verificar, el [[kv-cache|KV cache]] del borrador ni los prefills que comparten la GPU. Da la tendencia y el orden de magnitud; la cifra se mide.

:::formula La aceleración con un batch (modelo simplificado de esta lección)
t_{1} = max(t_{mem}, t_{cálc}(1))
t_{ver} = max(t_{mem}, (γ + 1) × t_{cálc}(1))
S_{b} = frac{E × t_{1}}{t_{ver} + γ × c × t_{1}}
- t_{1}: un paso normal del grande, con \(b\) conversaciones, en segundos
- t_{ver}: un paso de verificación: los mismos bytes, pero γ + 1 tokens de cálculo por conversación
- t_{mem}, t_{cálc}(1): los relojes de la memoria y del cálculo de un token, de la primera fórmula
- E, γ, c: como en la fórmula de Leviathan
- S_{b}: cuántas veces más rápido sale cada respuesta con ese batch, según este modelo
:::

Si \(t_{ver} = t_{1}\) (la memoria manda en los dos), la fórmula vuelve a ser la de Leviathan. Si el cálculo manda, \(t_{ver}\) crece y \(S_{b}\) cae, y puede bajar de 1: el truco **frena**.

:::cuenta El peor caso del despacho: las 8 conversaciones de diseño en una sola L40S
Reloj de la memoria, \(t_{mem}\) // \(b\) = 8 (le caben por memoria), \(K\) = 1.64 GB cada una | (19.32 + 8 × 1.64) GB ÷ 604.8 GB/s | ≈ 53.6 ms
Cálculo de 1 token por conversación, \(t_{cálc}(1)\) | 8 × 0.36 ms | ≈ 2.9 ms
Cálculo de la verificación // \(γ\) + 1 = 4 | 4 × 2.9 ms | ≈ 11.6 ms
Paso de verificación, \(t_{ver}\) | max(53.6, 11.6) | ≈ 53.6 ms
Aceleración, \(S_{b}\) // \(t_{ver} = t_{1}\): vuelve la de Leviathan con \(α\) = 0.6 | 2.18 × 53.6 ÷ (53.6 + 0.15 × 53.6) | ≈ 1.89×
Cada abogado // sin borrador 1 ÷ 53.6 ms = 18.65 | 18.65 × 1.89 | ≈ 35 tokens/s
= En la cuenta de techo, el truco sobrevive aun con las 8 conversaciones de diseño juntas en una GPU: el KV cache de prompts tan largos pesa tanto que la memoria sigue mandando por ≈ 4.6 veces. Es una buena noticia con letra chiquita: esta cuenta no incluye el cálculo de los prefills que comparten la GPU, ni la atención extra de verificar, y nadie ha medido el borrador con el modelo en INT4.
:::

Ahora un caso donde no sobrevive. Supuesto del ejemplo: **un clasificador de correos** que usa el mismo Qwen3 32B en una L40S, con prompts cortos de ≈ 300 tokens y muchas peticiones a la vez. Con contextos cortos el KV cache casi no pesa, el cálculo crece con cada conversación y alcanza al reloj de la memoria.

:::cuenta Un clasificador de correos: 64 conversaciones de 300 tokens
KV por conversación, \(K\) | 300 × 262,144 bytes | ≈ 0.079 GB
Reloj de la memoria, \(t_{mem}\) // \(b\) = 64 | (19.32 + 64 × 0.079) GB ÷ 604.8 GB/s | ≈ 40.3 ms
Cálculo de 1 token, \(t_{cálc}(1)\) | 64 × 0.36 ms | ≈ 23.2 ms
Paso normal, \(t_{1}\) | max(40.3, 23.2) | ≈ 40.3 ms
Paso de verificación, \(t_{ver}\) // 4 tokens por conversación | max(40.3, 4 × 23.2) | ≈ 92.7 ms
Aceleración, \(S_{b}\) // \(E\) = 2.18, \(c\) = 0.05 | 2.18 × 40.3 ÷ (92.7 + 0.15 × 40.3) | **≈ 0.89×**
= Con 64 a la vez, el speculative decoding hace cada respuesta ≈ 11 % **más lenta**. Con 32 todavía ayuda (≈ 1.5×); el punto donde se cruza está en ≈ 55 conversaciones. Verificar deja de ser gratis desde ≈ 24, y de ahí la ganancia baja poco a poco.
:::

:::profundo Lo que se ha medido: la misma historia
- **vLLM**, en su blog de octubre de 2024: mejoras grandes con pocas peticiones por segundo; con muchas, el cálculo extra frena a un sistema ya limitado por cálculo. Sus gráficas muestran respuestas **1.4×** y **1.8× más lentas** con Llama 3 70B en 4 H100 con carga alta. Su documentación actual lo resume: ayuda con cargas bajas a medianas, limitadas por memoria, y la ganancia depende del modelo, el tráfico, el hardware y el muestreo.
- **EAGLE-3**, en SGLang: con un batch de 64 todavía da **1.38×** de [[throughput-de-tokens|throughput]] (tokens por segundo de toda la GPU). Menos que con una conversación, pero positivo.
- **MagicDec** (ICLR 2025) contradice la idea de que solo sirve con batches chicos, con el argumento de la cuenta del despacho: con secuencias largas el cuello es el KV cache, no los pesos, y un borrador que lee un KV cache recortado da hasta 2.51× con batches de 32 a 256 (con Llama 3.1 8B). El matiz es importante: es un borrador especial, para secuencias largas.
- **TurboSpec** muestra que agregado sin cuidado puede empeorar el servicio, y propone ajustar cuánto se especula según el [[goodput|goodput]]. vLLM ya tiene una opción parecida: la especulación dinámica, que ajusta según la carga.
:::

:::nota Por qué el despacho cae del lado bueno
El despacho tiene dos cosas a su favor: prompts largos (el KV cache pesa ≈ 13 GB por paso con 8 conversaciones, dos tercios de los pesos) y poca gente a la vez casi todo el día. 3,000 preguntas en 10 horas son 300 por hora, ≈ 0.083 por segundo; con ≈ 27 s por respuesta, la [[ley-de-little|ley de Little]] da 0.083 × 27 ≈ **2.25 conversaciones a la vez en promedio** en todo el despacho, menos de una por GPU. Solo en la hora pico llegan a ≈ 5.6. La mayor parte del día cada GPU atiende a una conversación o a ninguna: el escenario donde el truco rinde más.
:::

Una última cosa que el speculative decoding no arregla: el sizing del despacho. Su problema de fondo es el [[prefill|prefill]] de 6,000 tokens, que en una L40S tarda ≈ 2.2–2.4 s y ya rompe el objetivo de 2 s al primer token. Ese tiempo no cambia con ningún borrador. Por eso siguen siendo **3 L40S**, y el borrador, si se mide bien, es una mejora de la velocidad de escritura, no un ahorro de GPUs.

## El expediente que no cabe {The case file that doesn't fit}

La segunda tarea que pide el despacho es **resumir un expediente completo**. Antes de pensar cómo, hay que saber cuánto mide en tokens.

Un recordatorio de [Transformers y LLMs](https://sensei.trueml.app/llms/): un token es un pedazo de texto (una palabra corta, parte de una larga, un signo). El [[contexto|contexto]] es todo lo que el modelo ve de una vez: instrucciones, documento y lo que lleva escrito. La regla de OpenAI para inglés es ≈ 1.33 tokens por palabra (1 token ≈ ¾ de palabra). Para español no hay un buen dato público. Lo único a la mano es una medición de blog sobre un solo pasaje de 107 palabras: dio 1.61 tokens por palabra con el tokenizador de GPT-4 y 1.34 con el más nuevo de OpenAI (el de GPT-4o y GPT-5). Para el tokenizador de Qwen3 no encontramos ninguna. Así que la lección usa el rango **≈ 1.3 a 1.6** como estimación gruesa, y todo lo que sale de él (los tokens del expediente, su KV cache, su prefill) es aproximado. El número de verdad se saca en una tarde: pasar una docena de expedientes reales por el tokenizador del modelo y contar.

:::formula Los tokens de un documento
n = pág × pal × τ
- pág: las páginas del documento
- pal: las palabras por página (≈ 500 a espacio sencillo y letra de 12 puntos; ≈ 250 a doble espacio; es una regla aproximada)
- τ: los tokens por palabra del tokenizador (la letra griega tau; ≈ 1.3–1.6 en español, estimación gruesa)
- n: los tokens del documento
:::

:::cuenta Un expediente del despacho
Palabras // ≈ 50 páginas por expediente (la ficha), 500 por página | 50 × 500 | 25,000 palabras
Tokens en la parte baja del rango, \(n\) // \(τ\) = 1.33, la regla de inglés (el tokenizador nuevo de OpenAI dio 1.34 en español) | 25,000 × 1.33 | ≈ 33,250
Tokens con la medición en español más alta, \(n\) // \(τ\) = 1.61 | 25,000 × 1.61 | ≈ 40,250
Contra el tope de cada conversación // 8,192 tokens | 33,250 ÷ 8,192 a 40,250 ÷ 8,192 | ≈ 4.1 a 4.9 veces
Contra el contexto nativo de Qwen3 32B // 32,768 tokens | 33,250 y 40,250 contra 32,768 | ninguno cabe, aunque el bajo apenas se pasa
= A grandes rasgos, un expediente son **≈ 33–40 mil tokens**: cuatro a cinco veces el tope de una conversación del despacho, y un poco más que lo que el modelo lee de forma nativa. Con el número medido podría caber o quedar más lejos: por eso se mide. A doble espacio sería la mitad, ≈ 17–20 mil, y sí cabría en el modelo. Para diseñar, la lección usa el caso pesado: ≈ 40,250.
:::

### Dos topes distintos

En esa cuenta hay dos límites que se confunden seguido:

- **El tope del servidor**: 8,192 tokens por conversación. Lo eligió el despacho para que en la memoria cupieran 8 conversaciones a la vez. Es una perilla (`--max-model-len` en vLLM) y se puede subir.
- **El tope del modelo**: lo que el modelo aprendió a leer. Según su model card, Qwen3 32B lee **32,768 tokens de forma nativa**, y está validado hasta **131,072** con un método llamado [[yarn|YaRN]]. Pasarse de ahí no es cuestión de perillas: el modelo nunca vio esas distancias.

El expediente pesado no cabe en ninguno de los dos. Para meterlo entero, hay que subir el tope del servidor (y pagar la memoria) **y** estirar el contexto del modelo (y pagar algo de calidad). La sección siguiente explica lo segundo; aquí va lo primero.

### Lo que cuesta en memoria: lineal

El [[kv-cache|KV cache]] guarda, por cada token del contexto, una K y una V en cada capa. Su tamaño crece en línea recta con los tokens. Para Qwen3 32B, con 64 capas y 8 juegos de K y V de 128 números ([[gqa|GQA]]), en BF16 son 2 × 64 × 8 × 128 × 2 bytes = **256 KiB por token** (la cuenta completa está en la [herramienta de VRAM](/herramientas/vram/)).

:::formula La memoria de una petición larga
KV = (n + T_{ins} + T_{sal}) × m
- n: los tokens del documento
- T_{ins}: los tokens de las instrucciones (≈ 400 en el despacho)
- T_{sal}: los tokens que va a escribir (≈ 500 para un resumen, supuesto)
- m: los bytes de KV por token (262,144 = 256 KiB en Qwen3 32B con KV en BF16)
- KV: los bytes de KV cache de esa petición
:::

:::cuenta El KV cache de un expediente en una L40S
Tokens de la petición // 40,250 del expediente + 400 + 500 | 40,250 + 400 + 500 | 41,150
KV de la petición, \(KV\) // \(m\) = 262,144 bytes | 41,150 × 262,144 | ≈ 10.8 GB
Libre para KV en una L40S // 90 % de 48 GB, menos 19.32 de pesos y 2 del programa (la herramienta de VRAM) | 43.2 − 19.32 − 2 | 21.88 GB
Lo que queda para las demás // cada conversación normal, 1.64 GB | (21.88 − 10.8) ÷ 1.64 | ≈ 6.8 → 6 conversaciones
= Un solo expediente ocupa la mitad del KV cache de una GPU: lo mismo que 6 o 7 conversaciones normales del despacho. Con 131,072 tokens serían ≈ 34 GB, más de lo que le queda libre a una L40S: no cabría en una sola.
:::

Una salida que estudia la lección «[Formatos de cuantización en la práctica](/formatos-cuantizacion/)»: guardar el [[cuantizar-kv-cache|KV cache en FP8]] (1 byte por número en vez de 2) lo deja en la mitad, ≈ 5.4 GB para este expediente, a cambio de algo de precisión que hay que medir.

### Lo que cuesta en cálculo: cuadrático

El [[prefill|prefill]] tiene dos partes. Las capas lineales (las proyecciones y la red de cada bloque) cuestan ≈ 2 FLOPs por parámetro por token: crecen **en línea recta** con los tokens. La atención compara cada token con todos los anteriores: con \(N\) tokens son ≈ \(N^2\) comparaciones por capa, y crece **al cuadrado**. Con prompts de 6,000 tokens casi no se nota; con 40 mil, ya pesa.

:::formula El prefill con la atención
t_{pre} = frac{2 × P × N + 2 × N^2 × d × L}{η_c × F}
- N: los tokens del prompt (documento e instrucciones)
- P: los parámetros del modelo
- 2 × P × N: los FLOPs de las capas lineales
- d: el ancho de la atención: cabezas de consulta × su tamaño (64 × 128 = 8,192 en Qwen3 32B)
- L: las capas (64)
- 2 × N^2 × d × L: los FLOPs de la atención: QKᵀ y la suma con V, 4 × N² × d por capa, entre 2 porque cada token solo mira a los anteriores (la máscara causal)
- η_c × F: el cálculo efectivo de la GPU, en FLOPs por segundo
- t_{pre}: lo que tarda el prefill sin fila, en segundos: el TTFT de esa petición
:::

La fórmula de la atención es una aproximación hecha para esta lección; no cuenta el softmax (la normalización de los puntajes de la atención) ni otros detalles chicos. Una forma de saber que va bien: con los 6,000 tokens de una pregunta normal del despacho da 2.38 s, lo mismo que la herramienta de sizing.

:::cuenta El prefill de un expediente en una L40S
Tokens del prompt, \(N\) // 40,250 + 400 de instrucciones | 40,250 + 400 | 40,650
Parte lineal // \(P\) = 32.762 × 10⁹ | 2 × 32.762 × 10⁹ × 40,650 | ≈ 2.66 × 10¹⁵ FLOPs
Atención // \(d\) = 8,192, \(L\) = 64 | 2 × 40,650² × 8,192 × 64 | ≈ 1.73 × 10¹⁵ FLOPs
Cálculo efectivo // \(η_c\) = 0.5, \(F\) = 362.05 TFLOPS | 0.5 × 362.05 × 10¹² | ≈ 1.81 × 10¹⁴ FLOPs/s
Prefill, \(t_{pre}\) | (2.66 + 1.73) × 10¹⁵ ÷ 1.81 × 10¹⁴ | **≈ 24.3 s**
Parte que es atención | 1.73 ÷ (2.66 + 1.73) | ≈ 39 %
= Antes de escribir una sola palabra del resumen, la GPU trabaja ≈ 24 s. En una pregunta normal la atención es ≈ 9 % del prefill; aquí ya es ≈ 39 %, y al doblar el largo se cuadruplica mientras lo demás solo se duplica.
:::

:::calculadora speculative-expediente
Arranca con el expediente pesado del despacho. Baja τ a 1.33 y mira cómo cambia todo. Sube a 160 páginas: el KV cache ya no cabe en una L40S y el prefill pasa de dos minutos. Cambia la GPU por una con más TFLOPS y mira que el prefill baja, pero el KV cache pesa lo mismo.
:::

### Lo que les hace a los demás

Para quien pidió el resumen, 24 s de prefill no son una tragedia: espera medio minuto por un trabajo de una hora. El problema es para los demás que comparten esa GPU. Con [[chunked-prefill|chunked prefill]], el servidor reparte el prefill largo en trozos, digamos de 2,048 tokens por paso, y mete el decode de los demás en cada paso. Cada paso con un trozo dura al menos 2 × 32.762 × 10⁹ × 2,048 ÷ 1.81 × 10¹⁴ ≈ **0.74 s**, y en cada paso cada conversación recibe un token: **≈ 1.3 tokens por segundo** durante ≈ 24 s, cuando se les prometieron 20. Sin chunked prefill sería peor: 24 s sin un solo token.

La consecuencia práctica para el despacho no es técnica sino de operación: los resúmenes de expedientes enteros van **en otra fila**, fuera de la hora pico, o en una GPU apartada para ellos. No se mezcla una tarea pesada de lotes con el tráfico interactivo.

## Estirar el contexto: RoPE, interpolación y YaRN {Stretching the context: RoPE, interpolation and YaRN} [extra]

¿Por qué un modelo tiene un tope de contexto, si la atención funciona con cualquier número de tokens? Porque el modelo aprendió a leer las **posiciones** hasta cierta distancia, y más allá ve algo que nunca vio.

### Lo que ya sabes de RoPE, y un poco más

En [Transformers y LLMs](https://sensei.trueml.app/llms/) viste la idea: [[rope|RoPE]] (*rotary position embedding*) gira los vectores Q y K de cada cabeza un ángulo que crece con la posición del token; al comparar una Q con una K, lo que queda es cuánto se giró una respecto de la otra, la distancia entre los dos. Lo nuevo aquí es **cómo** se reparte ese giro, porque de eso depende todo lo que se hace para estirar el contexto.

Cada cabeza tiene \(D\) números (128 en Qwen3 32B), agrupados en \(D ÷ 2\) = 64 pares. Cada par gira como la aguja de un reloj, cada uno a su propia velocidad: los primeros pares giran rapidísimo, los últimos casi no se mueven.

:::formula La velocidad de cada par de RoPE
ω_i = θ^{−2i/D}
λ_i = frac{2π}{ω_i} = 2π × θ^{2i/D}
- i: el número del par, de 0 a D ÷ 2 − 1
- D: los números por cabeza (128 en Qwen3 32B)
- θ: la base de RoPE (`rope_theta` en el config.json: 1,000,000 en Qwen3 32B)
- ω_i: el ángulo que gira el par \(i\) por cada token, en radianes
- λ_i: la longitud de onda del par: cuántos tokens tarda en dar una vuelta completa
:::

```python
import math
theta, D, L = 1_000_000, 128, 32_768      # Qwen3 32B: rope_theta, head_dim y contexto nativo
for i in (0, 8, 16, 24, 32, 40, 48, 63):  # 64 pares de números por cabeza; aquí 8 de ellos
    lam = 2 * math.pi * theta ** (2 * i / D)  # tokens que tarda ese par en dar una vuelta
    print(f"par {i:>2}: una vuelta cada {lam:>12,.0f} tokens · {L / lam:>8,.2f} vueltas en 32,768")
lams = [2 * math.pi * theta ** (2 * i / D) for i in range(D // 2)]
print("pares que no completan ni una vuelta en 32,768:", sum(l > L for l in lams))
s = 4                                      # el factor de YaRN que pide la model card para 131,072
print(f"temperatura de YaRN: raíz(1/t) = 0.1·ln({s}) + 1 = {0.1 * math.log(s) + 1:.3f}")
```

```salida
par  0: una vuelta cada            6 tokens · 5,215.19 vueltas en 32,768
par  8: una vuelta cada           35 tokens ·   927.41 vueltas en 32,768
par 16: una vuelta cada          199 tokens ·   164.92 vueltas en 32,768
par 24: una vuelta cada        1,117 tokens ·    29.33 vueltas en 32,768
par 32: una vuelta cada        6,283 tokens ·     5.22 vueltas en 32,768
par 40: una vuelta cada       35,333 tokens ·     0.93 vueltas en 32,768
par 48: una vuelta cada      198,692 tokens ·     0.16 vueltas en 32,768
par 63: una vuelta cada    5,063,256 tokens ·     0.01 vueltas en 32,768
pares que no completan ni una vuelta en 32,768: 24
temperatura de YaRN: raíz(1/t) = 0.1·ln(4) + 1 = 1.139
```

Los pares rápidos distinguen el orden cercano: el par 0 da una vuelta cada 6 tokens, así que separa «el token de junto» del «de tres más allá». Los lentos distinguen lo lejano: el par 48 tarda casi 200 mil tokens en dar una vuelta. En el entrenamiento, los pares rápidos ya vieron **todos** sus ángulos miles de veces. Los lentos, no: **24 de los 64** no completaron ni una vuelta en 32,768 tokens. Si le das al modelo la posición 100,000, esos pares llegan a ángulos que el modelo nunca vio. Ahí está el problema.

:::analogia El reloj con agujas de muchas velocidades
Imagina un reloj con 64 agujas: una da la vuelta cada segundo, otra cada minuto, otra cada hora, otra cada semana. Aprendiste a leer la hora mirando el reloj durante un mes. Las agujas rápidas las conoces en todas sus posiciones. Pero la aguja de «cada año» solo la viste recorrer un doceavo de su vuelta. Si alguien te muestra el reloj en diciembre, esa aguja está donde nunca la viste y no sabes qué significa.

Dónde se rompe: el modelo no «lee la hora» de cada aguja por separado, combina todas a la vez en sus cuentas de atención, y por eso un ángulo nuevo no falla limpio: confunde a las demás. Y a diferencia del reloj, aquí se puede **mover la escala** de las agujas lentas, que es lo que hacen los métodos de abajo.
:::

### Tres maneras de estirarlo

Las técnicas para lograrlo se llaman [[extension-de-contexto|extensión de contexto]] (*context extension*, o *RoPE scaling* en las opciones de los servidores). Hay tres que vas a oír:

- **Interpolación de posiciones** (Chen y otros, 2023). En vez de dejar que las posiciones nuevas lleguen a ángulos nuevos, **comprime** todas por un factor \(s\): la posición 131,072 se trata como la 32,768. Ningún ángulo es nuevo. Con hasta ≈ 1,000 pasos de ajuste fino, llevaron modelos LLaMA de 7 mil a 65 mil millones de parámetros hasta 32,768 tokens. El precio: los pares rápidos también se comprimen, y con ellos se borra el detalle del orden cercano.
- **NTK-aware**: estirar **poco** los pares rápidos y **mucho** los lentos. Se logra cambiando la base de RoPE: \(θ' = θ × s^{D/(D−2)}\). Para Qwen3 con \(s\) = 4, la base pasaría de 1,000,000 a ≈ 4.09 millones.
- **[[yarn|YaRN]]** (Peng y otros, 2023) lo hace por partes. Cuenta cuántas vueltas da cada par en el contexto original, \(r = L ÷ λ\). Los que dan muchas (más de 32, con los valores que el paper propone para Llama) no se tocan: ya vieron todo. Los que no dan ni una se estiran por el factor completo. Los de en medio siguen una rampa. Además ajusta la «temperatura» de la atención, \(sqrt{1/t} = 0.1 × ln(s) + 1\), que con \(s\) = 4 da ≈ 1.139. Según sus autores necesita ≈ 10 veces menos tokens y ≈ 2.5 veces menos pasos de entrenamiento que los métodos anteriores.

:::figura speculative-rope
Cuatro de los 64 pares de RoPE en Qwen3 32B, con lo que les hace YaRN con factor 4. Los rápidos no se tocan, los lentos se estiran. La barra de abajo cuenta los 64 pares, con los mismos umbrales que el paper propone para Llama (aplicarlos tal cual a Qwen es un supuesto de la figura).
:::

### Qwen3 32B: cómo se activa y cuándo no

La model card de Qwen3 32B da la receta: en el `config.json`, o como opción del servidor, agregar `"rope_scaling": {"rope_type": "yarn", "factor": 4.0, "original_max_position_embeddings": 32768}`. En vLLM:

```text
--rope-scaling '{"rope_type":"yarn","factor":4.0,"original_max_position_embeddings":32768}' --max-model-len 131072
```

Y da tres advertencias que vale la pena tomarse en serio:

1. **Los servidores abiertos aplican YaRN estático**: el mismo factor para todos los textos, cortos o largos. Eso, dice la card, puede empeorar los textos cortos. El despacho tiene 3,000 preguntas cortas al día y unos cuantos resúmenes largos: prenderlo para todo castigaría lo que más se usa.
2. **Prenderlo solo si hace falta**, y si el contexto promedio no pasa de 32,768, no prenderlo.
3. **Ajustar el factor al largo real**: para contextos típicos de 65,536, la card recomienda factor **2**, no 4.

Para el despacho: el expediente pesado, con instrucciones y resumen, son ≈ 41,150 tokens. Pide factor 2 (hasta 65,536). Lo sensato es un **segundo servidor** (o un segundo proceso en la GPU apartada para lotes) con YaRN factor 2 y tope de 65,536, y dejar el servidor de las preguntas como está: sin YaRN y con su tope de 8,192.

:::profundo El 40,960 del config.json
Si abres el `config.json` de Qwen3 32B, verás `"max_position_embeddings": 40960`, no 32,768. La model card, en cambio, dice 32,768 nativos y usa ese número como `original_max_position_embeddings` de YaRN. Para planear, quédate con lo que dice la card: es lo que el fabricante validó. vLLM, si no le das `--max-model-len`, toma el tope del config, así que conviene fijar `--max-model-len` a mano y no depender del número que trae el archivo. (Alibaba, en su propia API, usa YaRN dinámico, que cambia el factor según el largo; los servidores abiertos, no.)
:::

## Contexto anunciado contra contexto efectivo {Advertised vs effective context}

Supón que ya pagaste todo: subiste el tope, activaste YaRN, apartaste la memoria y esperas los 24 s de prefill. El modelo acepta los 40 mil tokens. ¿Los **usa**?

No necesariamente. El contexto anunciado es cuántos tokens acepta el modelo; el [[contexto-efectivo|contexto efectivo]] es con cuántos sigue contestando bien. Las mediciones públicas dicen que el segundo suele ser bastante menor:

- **RULER** (NVIDIA, 2024) probó 17 modelos de contexto largo. Todos anunciaban 32 mil tokens o más; solo **la mitad** mantenía un desempeño satisfactorio a 32 mil. RULER es una prueba sintética más exigente que la clásica «aguja en el pajar» (esconder una frase en un texto largo y preguntar por ella).
- **NoLiMa** (2025) quitó el atajo de esas pruebas: la pregunta no comparte palabras con la respuesta escondida, así que el modelo no puede encontrarla por coincidencia literal. De 13 modelos que anunciaban 128 mil tokens o más, a 32 mil **11 bajaron de la mitad** de lo que lograban con textos cortos. GPT-4o, uno de los mejores, bajó de 99.3 % a 69.7 %.
- **Lost in the middle** (Liu y otros, 2023): el desempeño suele ser mejor cuando la información relevante está al **principio o al final** del contexto, y empeora bastante cuando está **en medio**. La curva tiene forma de U. Es el fenómeno de [[lost-in-the-middle|lost in the middle]].

Para Qwen3 32B no hay una cifra publicada en RULER ni en NoLiMa. El despacho no puede leer su contexto efectivo en una tabla: lo tiene que **medir**.

:::ojo
Un resumen de un expediente de 40 mil tokens pone casi todo el documento «en medio». La cláusula de penalización de la página 25 cae justo en el fondo de la U. Un resumen puede omitirla aunque el modelo «la vio», y en un despacho eso no es un detalle: es la cláusula por la que el cliente pregunta.
:::

### Cómo lo mide el despacho

El despacho ya tiene su examen: 200 preguntas reales escritas por los abogados, con su respuesta y su cita, y un [[criterio-de-aceptacion|criterio de aceptación]] de al menos 85 % bien. Para el contexto largo se le agrega una parte, con la misma idea que RULER pero con sus documentos:

1. Elegir una docena de expedientes largos y, para cada uno, unas preguntas cuya respuesta está en una página conocida: principio, mitad y final.
2. Correr cada pregunta con el expediente entero (el camino largo) y con el camino corto que se vaya a usar en su lugar.
3. Comparar el porcentaje de aciertos **por posición**. Si la mitad del expediente se cae, el resumen de una sola llamada no es confiable para ese uso.

Cuántas preguntas hacen falta para que la diferencia no sea ruido lo viste en la lección [Elegir un modelo para la tarea](/elegir-modelo/), con el [[error-estandar|error estándar]].

### La alternativa: no meterlo todo

Si el expediente no cabe, o cabe pero se usa mal, la otra salida es partirlo. El patrón se llama **[[map-reduce|map-reduce]]**: se resume cada trozo por separado (el *map*), se juntan los resúmenes y se resume eso (el *reduce*); si los resúmenes juntos tampoco caben, se repite por grupos. Es la descomposición que OpenAI usó para resumir libros enteros (Wu y otros, 2021), y la que traen hechas las bibliotecas de orquestación de LLMs.

:::diagrama speculative-expediente
Los dos caminos para resumir el expediente pesado del despacho, con sus tiempos en una L40S. Toca cada caja o sigue los dos recorridos.
:::

¿Es más rápido partirlo? Parece que sí, porque la atención con trozos cortos casi no pesa. Pero map-reduce escribe más: 8 resúmenes intermedios además del final. La cuenta completa, con los relojes de la lección:

```python
P, W = 32.762e9, 19.32e9            # Qwen3 32B: parámetros y bytes de pesos (INT4 de AWQ)
L, d, kv = 64, 8192, 262_144        # capas, 64 cabezas × 128, bytes de KV por token
F, B = 0.5 * 362.05e12, 0.7 * 864e9 # L40S con η_c = 0.5 y η_m = 0.7

def prefill(n):                     # segundos: parte lineal + atención con máscara causal
    return (2 * P * n + 2 * n * n * d * L) / F

def decode(pasos, b, n):            # segundos de escribir con b a la vez y n tokens de KV c/u
    return pasos * (W + b * n * kv) / B

n = 40_250                          # el expediente: 50 págs × 500 palabras × 1.61
una = prefill(n + 400) + decode(500, 1, n + 650)
trozo = n // 8 + 400                # 8 trozos con sus instrucciones
mapa = 8 * prefill(trozo) + decode(400, 8, trozo + 200)
junta = 8 * 400 + 400               # los 8 resúmenes de 400 tokens y las instrucciones
reduce = prefill(junta) + decode(500, 1, junta + 250)
print(f"una sola llamada: prefill {prefill(n + 400):5.1f} s · total {una:5.1f} s")
print(f"map-reduce: 8 trozos de {trozo:,} tokens · total {mapa + reduce:5.1f} s")
print(f"  map {mapa:5.1f} s (prefills {8 * prefill(trozo):4.1f} s) · reduce {reduce:4.1f} s")
```

```salida
una sola llamada: prefill  24.3 s · total  49.1 s
map-reduce: 8 trozos de 5,431 tokens · total  55.9 s
  map  37.7 s (prefills 17.1 s) · reduce 18.2 s
```

Los resúmenes intermedios de 400 tokens son un supuesto del ejemplo; el decode usa la cuenta de memoria (cuando la memoria manda) y el de los 8 trozos se hace junto, en un batch. Lee el resultado con cuidado. Map-reduce **no** es más rápido: ahorra ≈ 7 s de prefill y gasta más que eso escribiendo resúmenes intermedios. Lo que sí gana:

- **Cabe sin tocar nada.** Cada trozo pide 5,431 tokens y su resumen 400: entra en el tope de 8,192 del servidor de siempre, sin YaRN y sin apartar 10.8 GB de memoria para una sola petición.
- **Cada trozo es corto**, y con 5 mil tokens no hay mucho «en medio» donde perderse.

Y lo que pierde: **la vista de conjunto**. Si la cláusula de la página 3 dice que la penalización de la página 40 no aplica, ningún trozo ve las dos. El resumen final solo ve lo que cada resumen intermedio decidió contar.

Para **preguntar** algo del expediente (no resumirlo entero) hay una tercera vía, la que el despacho ya usa en sus preguntas diarias: buscar los fragmentos que importan y dárselos al modelo, como sus 5 fragmentos de ≈ 1,000 tokens. Eso es RAG, y lo ve la lección «RAG privado: embeddings y vector DB locales».

## Errores comunes {Common mistakes}

1. **Creer que el speculative decoding cambia o empeora las respuestas.** Con la regla de aceptación de Leviathan y otros, la distribución de salida es la del modelo grande: un borrador malo baja la velocidad, no la calidad. **Cómo evitarlo:** úsalo con la verificación estándar, no con las variantes que aceptan de más (como `fly` en vLLM), y si comparas textos carácter por carácter, usa *greedy*: con muestreo, la numérica del hardware cambia los últimos dígitos.
2. **Esperar que baje el tiempo al primer token.** El borrador acelera el [[decode|decode]], no el [[prefill|prefill]]. **Cómo evitarlo:** si el problema es el [[ttft|TTFT]], como en el despacho (≈ 2.2–2.4 s de prefill contra un objetivo de 2 s), busca más cálculo o prompts más cortos; el speculative decoding no lo toca.
3. **Prenderlo con un batch grande sin medir.** Con muchas conversaciones cortas el cálculo deja de sobrar y verificar \(γ + 1\) tokens cuesta \(γ + 1\) veces: en el clasificador de correos, 64 a la vez lo vuelven ≈ 11 % más lento. **Cómo evitarlo:** haz la cuenta de los dos relojes, mide con tu tráfico real y, si la carga varía, usa la especulación dinámica.
4. **Subir \(γ\) para «sacar más tokens».** La quinta propuesta solo sirve si se aceptaron las cuatro anteriores. **Cómo evitarlo:** empieza con 3, mide la longitud de aceptación que reporta el servidor y sube solo si las propuestas largas se están usando.
5. **Activar YaRN con factor 4 para todo.** Los servidores lo aplican estático, y con textos cortos puede empeorar el modelo. **Cómo evitarlo:** actívalo solo en el servidor que de verdad recibe textos largos, con el factor más chico que cubra tu largo (2 para ≈ 65 mil en Qwen3 32B).
6. **Confundir el contexto anunciado con el efectivo.** Que el modelo acepte 131,072 tokens no dice que use bien la página 25 de 50. **Cómo evitarlo:** mide con tu examen, con preguntas cuya respuesta esté al principio, a la mitad y al final del documento.
7. **Olvidar lo que una petición larga les hace a las demás.** Un expediente de 40 mil tokens ocupa ≈ 10.8 GB de KV cache y ≈ 24 s de cálculo: lo mismo que 6 conversaciones, y deja a las demás en ≈ 1.3 tokens por segundo mientras dura su prefill. **Cómo evitarlo:** manda los trabajos largos a otra fila u otra GPU, fuera de la hora pico.

## En la vida real {In real life}

**El despacho.** Qwen3 32B en INT4 de [[awq|AWQ]] en 3 L40S, con preguntas de ≈ 6,000 tokens y respuestas de ≈ 500. Casi todo el día hay ≈ 2.25 conversaciones a la vez en todo el despacho, menos de una por GPU: es el escenario donde el speculative decoding rinde. Con un EAGLE-3 de Qwen3 32B y una aceptación como la medida en resumen (\(α\) ≈ 0.6), la cuenta de techo da ≈ 1.9×: de ≈ 29 a ≈ 55 tokens por segundo con una conversación, y en el modelo simplificado sobrevive aun con las 8 conversaciones de diseño juntas en una GPU, porque sus prompts son largos. Las tres decisiones que salen de aquí: (1) **probar** el EAGLE-3 y el n-gram con el modelo en INT4 y con su examen, midiendo la aceptación y la velocidad con el tráfico real, antes de dejarlo prendido; (2) **no contar** con él para el TTFT ni para ahorrar GPUs: siguen siendo 3 L40S; (3) los **resúmenes de expedientes completos** (≈ 33–40 mil tokens) van en un servidor aparte, con YaRN factor 2 y tope de 65,536, en una fila de trabajos fuera de la hora pico, y se comparan contra map-reduce con preguntas de distintas páginas antes de elegir uno.

**Un asistente de código para un equipo de desarrollo.** Supuesto del ejemplo: los programadores piden cambios a un archivo que ya está en el prompt, y la respuesta es el archivo casi igual con unas líneas cambiadas. Es el caso ideal del [[prompt-lookup|prompt lookup]]: casi todo lo que el modelo escribe ya está en la entrada, así que las propuestas por n-gram se aceptan en tramos largos sin entrenar ningún borrador. Aquí conviene una \(γ\) más alta, porque cuando atina, atina en serie.

**Una clasificación masiva de correos.** Supuesto del ejemplo: una empresa clasifica cada noche cientos de miles de correos con prompts de ≈ 300 tokens y respuestas de unas cuantas palabras, con el mayor batch posible para terminar rápido. Aquí el speculative decoding estorba: con 64 conversaciones cortas a la vez, verificar ya no es gratis y la cuenta da ≈ 0.89×. Lo que importa en ese trabajo es el [[throughput-de-tokens|throughput]] total, no la velocidad que ve cada correo, y el batch ya lo da.

**Un centro de atención que resume llamadas de una hora.** Supuesto del ejemplo: una llamada de una hora transcrita son ≈ 9,000 palabras, ≈ 12–14 mil tokens con los mismos 1.33–1.61 por palabra. Cabe en los 32,768 nativos sin YaRN, pero los acuerdos suelen estar a la mitad, donde el modelo atiende peor. Les sirve poner al final del prompt una instrucción que pida buscar los acuerdos en toda la llamada, y medir con llamadas reales cuántos se pierden.


## Ejercicios {Exercises}

:::ejercicios
? [facil] Un borrador tiene \(α\) = 0.7 y propone \(γ\) = 2 tokens, con \(c\) = 0.05. ¿Cuántos tokens salen en promedio por ciclo y cuántas veces más rápido es?
\(E = (1 − α^{γ+1}) ÷ (1 − α)\) = (1 − 0.7³) ÷ 0.3 = (1 − 0.343) ÷ 0.3 = 0.657 ÷ 0.3 ≈ **2.19 tokens**. El ciclo dura \(γ × c + 1\) = 2 × 0.05 + 1 = 1.1 pasos. \(S\) = 2.19 ÷ 1.1 ≈ **1.99×**.
? [facil] Un expediente corto tiene 30 páginas de 500 palabras. Con \(τ\) = 1.61, ¿cuántos tokens son? ¿Cabe en el tope de 8,192 del despacho? ¿Y en los 32,768 nativos de Qwen3 32B?
\(n\) = 30 × 500 × 1.61 = **24,150 tokens**. Contra 8,192: 24,150 ÷ 8,192 ≈ 2.9 veces, **no cabe**. Contra 32,768 **sí cabe**, con ≈ 8,600 tokens de sobra para instrucciones y resumen: se puede resumir en una llamada subiendo el tope del servidor, sin YaRN.
? [facil] ¿Cuánto KV cache ocupa ese expediente de 24,150 tokens en Qwen3 32B, con KV en BF16 y con KV en FP8?
BF16: 24,150 × 262,144 bytes ≈ **6.33 GB**. FP8 (la mitad, 128 KiB por token): ≈ **3.17 GB**. Con los 21.88 GB libres de una L40S, en BF16 deja ≈ 15.5 GB para las demás, ≈ 9 conversaciones normales de 1.64 GB.
? [facil] ¿En cuál de estas tareas esperarías que el prompt lookup ayude más, y en cuál menos? (a) Resumir un contrato. (b) Escribir un correo de felicitación a un cliente. (c) Contestar «¿qué dice la cláusula 7?» con el contrato en el prompt.
Más en **(c)**: la respuesta copia la cláusula casi palabra por palabra, así que los n-gramas del prompt atinan en tramos largos. Luego **(a)**: un resumen copia nombres, fechas, montos y citas, pero también parafrasea. Menos en **(b)**: el texto es nuevo y casi nada está en el prompt; las propuestas se rechazan y el truco no gana, aunque tampoco cuesta casi nada porque \(c\) ≈ 0.
? [medio] Red Hat midió una longitud de aceptación de 2.15 con \(γ\) = 3 para su EAGLE-3 de Qwen3 32B. Esa longitud es la \(E\) de la fórmula (vLLM la calcula como 1 + aceptados ÷ ciclos). ¿Qué \(α\) equivalente le corresponde? ¿Qué aceleración daría con \(c\) = 0.05?
Hay que despejar \(α\) de (1 − α⁴) ÷ (1 − α) = 2.15, que es 1 + α + α² + α³ = 2.15. Probando: α = 0.6 da 1 + 0.6 + 0.36 + 0.216 = 2.176, un poco de más; α = 0.59 da 1 + 0.59 + 0.348 + 0.205 ≈ 2.143, un poco de menos. **α ≈ 0.59**. Aceleración: \(S\) = 2.15 ÷ (3 × 0.05 + 1) = 2.15 ÷ 1.15 ≈ **1.87×**. Es un α equivalente, no el de cada posición: con \(γ\) = 1 la misma tabla da 1.62, o sea que la primera propuesta se acepta ≈ 62 % de las veces y las siguientes, menos.
? [medio] En el clasificador de correos (Qwen3 32B en una L40S, prompts de 300 tokens, \(η_m\) = 0.7, \(η_c\) = 0.5), ¿hasta cuántas conversaciones a la vez sigue siendo gratis verificar 4 tokens por conversación?
Gratis mientras \((γ + 1) × t_{cálc}(1) ≤ t_{mem}\). Memoria: 19.32 GB ÷ 604.8 GB/s ≈ 31.94 ms de pesos más, por conversación, 300 × 262,144 bytes ÷ 604.8 GB/s ≈ 0.130 ms. Cálculo de un token por conversación: ≈ 0.362 ms; cuatro, ≈ 1.448 ms. Condición: 1.448 × \(b\) ≤ 31.94 + 0.130 × \(b\), o sea \(b\) ≤ 31.94 ÷ (1.448 − 0.130) ≈ 24.2. **Hasta 24 conversaciones.** Más allá, verificar empieza a costar, pero la ganancia todavía es positiva hasta ≈ 54; con 55 el truco ya frena.
? [medio] El prefill de un expediente de 33,250 tokens (sin instrucciones) en una L40S: ¿cuánto es la parte lineal, cuánto la atención y cuánto tarda (\(η_c\) = 0.5)? ¿Y si el expediente midiera el doble?
Lineal: 2 × 32.762 × 10⁹ × 33,250 ≈ **2.18 × 10¹⁵**. Atención: 2 × 33,250² × 8,192 × 64 ≈ **1.16 × 10¹⁵**. Total 3.34 × 10¹⁵ ÷ 1.81 × 10¹⁴ ≈ **18.4 s**. Con 66,500 tokens: la lineal se duplica (≈ 4.36 × 10¹⁵) y la atención se cuadruplica (≈ 4.64 × 10¹⁵); total ≈ 9.0 × 10¹⁵ ÷ 1.81 × 10¹⁴ ≈ **49.7 s**, 2.7 veces más por el doble de texto. Ahí la atención ya es más de la mitad.
? [medio] En Qwen3 32B (\(θ\) = 1,000,000, \(D\) = 128), ¿cada cuántos tokens da una vuelta el par 36? ¿Cuántas vueltas da en los 32,768 tokens nativos, y qué le haría YaRN con los umbrales del paper (más de 32 vueltas: no se toca; menos de 1: se estira por completo)?
\(λ_{36} = 2π × θ^{2 × 36/128}\) = 2π × 10^{6 × 0.5625} = 2π × 10^{3.375} ≈ 2π × 2,371 ≈ **14,900 tokens**. Vueltas: 32,768 ÷ 14,900 ≈ **2.2**. Está entre 1 y 32: cae en la **rampa** de YaRN y se estira una parte del factor, no completo.
? [reto] AngelSlim midió su EAGLE-3 para Qwen3 32B con \(γ\) = 2 y una conversación: pasó de 43.32 a 74.10 tokens por segundo en promedio, con longitudes de aceptación de 2.01, 1.90, 1.86 y 1.86 en cuatro pruebas (medidas con vLLM, que las cuenta como arriba). Con la fórmula de Leviathan, ¿qué costo efectivo \(c\) del borrador explica ese resultado? ¿Qué te dice?
Aceleración medida: 74.10 ÷ 43.32 ≈ **1.71×**. Longitud promedio: (2.01 + 1.90 + 1.86 + 1.86) ÷ 4 ≈ 1.91 tokens, que hacemos \(E\). De \(S = E ÷ (γ × c + 1)\): γ × c + 1 = 1.91 ÷ 1.71 ≈ 1.115, así que \(c\) ≈ 0.115 ÷ 2 ≈ **0.058**. Te dice dos cosas. Una, que el supuesto de la lección (\(c\) = 0.05) es razonable para un EAGLE-3. Dos, que ese \(c\) «efectivo» junta todo lo que la fórmula no ve: el borrador, la verificación con su atención extra, el programa que arma los ciclos. Es una forma de calibrar la fórmula con una medición, no una medición del borrador solo.
? [reto] El despacho debe elegir cómo resumir sus expedientes pesados (≈ 40,250 tokens): una llamada larga con YaRN factor 2 o map-reduce en 8 trozos. Con los números de la lección, arma el argumento para cada lado y di qué medirías para decidir.
Llamada larga: ≈ 49 s en una L40S (≈ 24 s de prefill), ≈ 10.8 GB de KV para una petición, un servidor aparte con YaRN y tope de 65,536, y el modelo ve todo el expediente junto, así que puede relacionar la página 3 con la 40. Riesgos: lo que está en medio se usa peor, y Qwen3 32B no tiene cifras publicadas de contexto efectivo. Map-reduce: ≈ 56 s, no es más rápido; cada trozo de 5,431 tokens cabe en el servidor de siempre, sin YaRN y sin apartar memoria, y no hay «en medio» largo. Riesgo: pierde las relaciones entre trozos. Qué medir: un juego de expedientes reales con preguntas cuya respuesta está al principio, a la mitad y al final, y otras que exigen **juntar** dos partes lejanas del documento. Si la llamada larga se cae a la mitad, map-reduce gana; si map-reduce se cae en las preguntas que juntan partes, gana la llamada larga. Y en cualquiera de los dos, los resúmenes van en una fila fuera de la hora pico.
? [reto] Un compañero propone: «con speculative decoding, en la hora pico cada abogado vería ≈ 35 tokens por segundo con 8 conversaciones por GPU; entonces una sola L40S alcanza para las 8 y nos ahorramos dos». ¿Qué tiene de bueno y de malo el argumento?
De bueno: la cuenta de techo es correcta. Con 8 conversaciones de 6,250 tokens, la memoria tarda ≈ 53.6 ms por paso y verificar 4 tokens por conversación ≈ 11.6 ms de cálculo, así que la verificación sale gratis y \(S\) ≈ 1.89 lleva a cada persona de ≈ 18.65 a ≈ 35 tokens por segundo. De malo, tres cosas. (1) El [[prefill|prefill]]: cada pregunta de 6,000 tokens tarda ≈ 2.2–2.4 s en una L40S, ya fuera del objetivo de 2 s, y el speculative decoding no lo toca; con 0.21 preguntas por segundo en la hora pico, casi la mitad del tiempo de una sola GPU se va en prefills, y ahí el cálculo no sobra. (2) \(α\) ≈ 0.6 es un supuesto: nadie ha medido el EAGLE-3 con el modelo en INT4 ni con textos jurídicos en español. (3) La cuenta no incluye la atención extra de verificar ni el KV cache del borrador. Conclusión: siguen siendo **3 L40S**; el borrador, si se mide bien, mejora la velocidad de escritura, no el número de GPUs.
:::

## Lo que sigue {What comes next}

- **«[Formatos de cuantización en la práctica](/formatos-cuantizacion/)»**, la otra lección de este módulo, explica de dónde salen los 19.32 GB del INT4 de [[awq|AWQ]] y cómo se guarda el [[cuantizar-kv-cache|KV cache en FP8]]: la mitad de memoria para un expediente largo, a cambio de una pérdida que se mide.
- **«[De requisitos a hardware](/requisitos-hardware/)»** junta todo lo que pesa en el sizing: prefills largos, decode, KV cache y, ahora, las peticiones largas que conviene apartar.
- **«[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)»** explica cómo repartir un modelo entre GPUs, la salida cuando un contexto de 131 mil tokens no cabe en una sola.
- **«[Del laptop al servidor: llama.cpp, Ollama, vLLM, SGLang y TensorRT-LLM](/stack-serving/)»** compara qué servidor soporta qué borrador, YaRN y chunked prefill.
- **«RAG privado: embeddings y vector DB locales»** es la vía para preguntar sobre un expediente sin meterlo entero, y **«Demostrar que el modelo abierto sirve»** arma el examen que mide el contexto efectivo.
- En Sensei: [Transformers y LLMs](https://sensei.trueml.app/llms/) tiene el prefill, el decode, la atención y RoPE desde cero, y [Latencia y throughput](https://sensei.trueml.app/latencia/) explica por qué una tarea larga en la misma fila hace esperar a todos.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
speculative-decoding modelo-borrador tasa-de-aceptacion verificacion-en-paralelo eagle mtp prompt-lookup rope extension-de-contexto yarn contexto-efectivo lost-in-the-middle map-reduce
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué verificar 4 tokens cuesta casi lo mismo que escribir uno?
Porque el paso de [[decode|decode]] con pocas conversaciones está [[memory-bound|limitado por memoria]]: lo que tarda es leer los pesos y el KV cache, y esos bytes se leen una vez, sean 1 o 4 los tokens que se califican. En el despacho, 4 tokens de cálculo son ≈ 1.45 ms contra ≈ 34.7 ms de memoria.
? ¿Qué garantiza la regla de aceptación min(1, p ÷ q) con el residuo?
Que los tokens salgan con la misma distribución que daría el modelo grande solo, con cualquier borrador. Un borrador malo solo baja la tasa de aceptación y, con ella, la velocidad.
? Con \(α\) = 0.8, \(γ\) = 3 y \(c\) = 0.05, ¿cuánto acelera?
\(E\) = (1 − 0.8⁴) ÷ 0.2 ≈ 2.95 tokens por ciclo; \(S\) = 2.95 ÷ 1.15 ≈ 2.57×.
? ¿Cuándo deja de ayudar el speculative decoding?
Cuando el batch es tan grande que el cálculo ya no sobra: verificar \(γ + 1\) tokens por conversación cuesta \(γ + 1\) veces el cálculo y los rechazados son trabajo tirado. Pasa antes con contextos cortos, porque el KV cache pesa poco y el cálculo alcanza a la memoria.
? ¿Cuántos tokens tiene un expediente de 50 páginas y por qué no cabe en el despacho?
Del orden de 33–40 mil (50 × 500 palabras × 1.33–1.61, una estimación gruesa). No cabe en el tope de 8,192 del servidor ni en los 32,768 nativos de Qwen3 32B: hay que subir el tope y activar YaRN (factor 2), o partirlo.
? ¿Qué crece en línea recta y qué al cuadrado con el largo del contexto?
El KV cache crece en línea recta (256 KiB por token en Qwen3 32B). La atención del prefill crece al cuadrado: en el expediente pesado ya es ≈ 39 % del prefill de ≈ 24 s.
? ¿Qué es lost in the middle y cómo lo mide el despacho?
Que el modelo usa mejor lo que está al principio y al final de un contexto largo que lo de en medio. El despacho lo mide con preguntas de su examen cuya respuesta está en páginas conocidas del principio, la mitad y el final de expedientes reales.
:::
