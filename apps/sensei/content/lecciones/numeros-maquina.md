---
titulo: Cómo guarda números una computadora
en: How a computer stores numbers
subtitulo: Bits, enteros y números con punto decimal, por dentro: por qué un píxel llega hasta 255, por qué 0.1 + 0.2 no da 0.3 y cómo un modelo cabe en la mitad o en la cuarta parte de la memoria sin olvidar lo que aprendió.
pregunta: ¿Cómo guarda una computadora un número, qué se pierde al guardarlo con menos bits y por qué eso decide cuánta memoria y cuánta GPU pide un modelo?
requisitos: unidades
---

:::idea
Todo número vive en la computadora como una fila de bits, y cada formato los reparte distinto. Los enteros cuentan exacto, pero tienen tope; los de punto flotante abarcan de lo diminuto a lo enorme a cambio de redondear. Elegir el formato de un modelo (FP32, FP16, BF16, INT8, INT4) es elegir cuánta memoria ocupa, qué tan rápido corre y cuánto cambian sus respuestas.
:::

## Bits y enteros: contar con ceros y unos {Bits and integers: counting with zeros and ones}

En la lección de imágenes viste que cada color de un píxel es un número del 0 al 255. En la de unidades, que un [[byte]] son 8 [[bit|bits]]. Aquí vamos a abrir ese byte: cómo se escribe un número con ceros y unos, por qué el tope es 255 y qué pasa cuando un número no cabe.

### Contar en binario

Piensa en cómo escribes el 236. Cada posición vale 10 veces la de su derecha: 236 = 2 × 100 + 3 × 10 + 6 × 1. Hay diez dígitos, del 0 al 9, porque contamos en base 10.

Un bit solo tiene dos estados, que se escriben 0 y 1 (en el chip son, por ejemplo, un voltaje bajo o uno alto). Por eso la computadora cuenta en base 2, el sistema [[binario]]: solo hay dos dígitos y cada posición vale **el doble** que la de su derecha. De derecha a izquierda, las posiciones de un byte valen 1, 2, 4, 8, 16, 32, 64 y 128.

Para escribir un número en binario, recorre las posiciones de la más grande a la más chica. Si su valor cabe en lo que te queda, pones un 1 y lo restas; si no, pones un 0.

:::cuenta El 236 en binario: el rojo del naranja de los tenis
Posición de 128 // cabe en 236: un 1 | 236 − 128 | quedan 108
Posición de 64 // cabe: un 1 | 108 − 64 | quedan 44
Posición de 32 // cabe: un 1 | 44 − 32 | quedan 12
Posición de 16 // no cabe en 12: un 0 | — | quedan 12
Posición de 8 // cabe: un 1 | 12 − 8 | quedan 4
Posición de 4 // cabe: un 1 | 4 − 4 | quedan 0
Posiciones de 2 y de 1 // ya no queda nada | — | 0 y 0
= 236 = 1110 1100 en binario, porque 128 + 64 + 32 + 8 + 4 = 236.
:::

¿Cuántos números distintos caben en n bits? Cada bit que agregas duplica las combinaciones: con 1 bit hay 2 (0 y 1); con 2, cuatro (00, 01, 10 y 11); con 8, 2⁸ = 256. Por eso un byte guarda del 0 al 255: son 256 valores y el primero es el 0. Es la misma cuenta de potencias de 2 de la lección de unidades, donde 1 KiB son 2¹⁰ = 1,024 bytes.

```python
for n in (5, 13, 236, 255):
    print(f"{n:>3} en binario es {n:08b}")

bits = "11101100"
sin_signo = int(bits, 2)                       # uint8: cada bit suma su valor
con_signo = sin_signo - 256 if bits[0] == "1" else sin_signo   # int8: el primero vale −128
print(bits, "como uint8 vale", sin_signo, "y como int8 vale", con_signo)

print("valores posibles con 1 a 8 bits:", [2**b for b in range(1, 9)])
```

```salida
  5 en binario es 00000101
 13 en binario es 00001101
236 en binario es 11101100
255 en binario es 11111111
11101100 como uint8 vale 236 y como int8 vale -20
valores posibles con 1 a 8 bits: [2, 4, 8, 16, 32, 64, 128, 256]
```

:::nota Hexadecimal: los bits de 4 en 4
Escribir 32 ceros y unos es incómodo, así que los programadores agrupan los bits de 4 en 4. Cada grupo tiene 16 combinaciones y se escribe con un solo símbolo: del 0 al 9 y de la A (10) a la F (15). Es el sistema **hexadecimal**, y se marca con `0x`: 1110 1100 es `0xEC` y 255 es `0xFF`. Lo vas a ver en mensajes de error y en los colores de las páginas web: el naranja de los tenis, con rojo 236, verde 106 y azul 63, se escribe `#EC6A3F`.
:::

### Enteros sin signo y con signo

Un [[entero]] (*integer*) es un número sin decimales. En la computadora cada entero tiene un tamaño fijo en bits, y el tamaño decide su rango.

Si todos los bits suman, el entero es **sin signo** (*unsigned*): es el [[uint8]] de los píxeles, del 0 al 255.

Para tener negativos, todas las computadoras de hoy usan el mismo truco, el **complemento a dos** (*two's complement*): el primer bit, el de la izquierda, vale negativo. En un int8 vale −128 en lugar de 128:

- 0111 1111 = 64 + 32 + 16 + 8 + 4 + 2 + 1 = **127**, el más grande.
- 1000 0000 = **−128**, el más chico.
- 1111 1111 = −128 + 127 = **−1**.
- 1110 1100 = −128 + 64 + 32 + 8 + 4 = **−20**.

:::figura numeros-maquina-byte
Los mismos 8 bits, leídos de dos maneras. Arriba, sin signo: cada bit suma su posición y salen 236. Abajo, con signo: el primer bit vale −128 en vez de 128 y salen −20.
:::

Fíjate en el último: son los mismos bits que el 236. **Los bits no dicen qué número son; lo dice el tipo de dato.** Si un programa escribe un uint8 y otro lo lee como int8, el 236 se vuelve −20 sin ningún error. Por eso cada [[tensor]] lleva escrito su tipo, como verás más adelante.

¿Por qué ese truco y no un bit de signo aparte? Porque así sumar es igual con signo o sin signo, y el chip usa el mismo circuito para las dos cosas. Prueba −1 + 1: 1111 1111 + 0000 0001 = 1 0000 0000. El noveno bit no cabe en el byte y se pierde; quedan 0000 0000 = 0. Correcto.

| Tipo | Bits | Bytes | Rango | Dónde lo vas a ver |
|---|---|---|---|---|
| uint8 | 8 | 1 | 0 a 255 | Los píxeles de una foto |
| int8 | 8 | 1 | −128 a 127 | Los pesos de un modelo cuantizado (INT8) |
| int4 | 4 | 0.5 | −8 a 7 | Los pesos de un LLM cuantizado (INT4) |
| int16 | 16 | 2 | −32,768 a 32,767 | El audio: cada muestra de un WAV de 16 bits |
| int32 | 32 | 4 | −2,147,483,648 a 2,147,483,647 | Contadores e índices |
| int64 | 64 | 8 | ≈ −9.2 × 10¹⁸ a 9.2 × 10¹⁸ | Etiquetas e ids de tokens: es el entero por omisión de PyTorch |

La regla general: con n bits, un entero sin signo va de 0 a 2ⁿ − 1, y uno con signo, de −2ⁿ⁻¹ a 2ⁿ⁻¹ − 1. Pruébala.

:::calculadora numeros-maquina-rango
Un reto: ¿cuántos bits necesitas, como mínimo, para guardar 40,000 sin signo? ¿Y con signo?
:::

### Overflow: cuando el número no cabe

¿Qué pasa con 255 + 1 en un uint8? El resultado, 256, necesita 9 bits: 1 0000 0000. El noveno se pierde y queda 0. Eso es un [[overflow]] (desbordamiento): el resultado no cabe en el tipo de dato.

Hay dos maneras de manejarlo:

- **Dar la vuelta** (*wraparound*): se pierde lo que no cabe y el número reaparece del otro lado. En uint8, 255 + 1 = 0 y 250 + 10 = 4. En int8, 127 + 1 = −128: del más grande al más negativo.
- **Saturarse** (*saturation*): el número se queda en la orilla. 250 + 10 = 255.

Los arreglos de enteros de NumPy y de PyTorch dan la vuelta, y en silencio: no hay error ni aviso. La función `cv2.add` de OpenCV, en cambio, se satura. Los enteros propios de Python no se desbordan nunca: crecen lo que haga falta. Por eso el código de abajo imita el uint8 con `% 256`, el residuo de dividir entre 256.

:::figura numeros-maquina-vuelta
Los 256 valores de un byte, en un círculo. Por fuera, como uint8: después del 255 viene el 0, y 250 + 10 cae en el 4. Por dentro, los mismos bits como int8: ahí el salto está abajo, de 127 a −128.
:::

:::analogia El cuentakilómetros
Un cuentakilómetros de 6 dígitos marca 999,999 y, con un kilómetro más, vuelve a 000,000. El uint8 hace lo mismo con 8 bits: después del 255 viene el 0.

**Dónde se rompe:** el cuentakilómetros lo ves; el overflow de la computadora no avisa. Y en los enteros con signo no se vuelve a cero: se salta del más grande al más negativo.
:::

Esto muerde de verdad al trabajar con fotos. Si quieres aclarar una foto sumándole 10 a cada píxel en uint8, un blanco de 250 queda en 4: casi negro. Si promedias dos fotos sumando primero, (200 + 100) ÷ 2 da 22 en vez de 150, porque la suma ya había dado la vuelta.

```python
def uint8(x):                  # como un arreglo uint8 de NumPy o PyTorch: da la vuelta
    return x % 256

def saturar(x):                # como cv2.add de OpenCV: se queda en la orilla
    return max(0, min(255, x))

for a, b in ((250, 10), (200, 100), (10, -20)):
    print(f"{a} {'+' if b > 0 else '-'} {abs(b)}: da la vuelta → {uint8(a + b):>3} · se satura → {saturar(a + b)}")

print("promedio de 200 y 100 sumando en uint8:", uint8(200 + 100) // 2)
print("promedio de 200 y 100 con un int de Python:", (200 + 100) // 2)

maximo = 2**31 - 1             # el int32 más grande
print(f"un contador int32 llega a {maximo:,}: a 116 fotos por segundo, en {maximo / 116 / 86400:.0f} días")
```

```salida
250 + 10: da la vuelta →   4 · se satura → 255
200 + 100: da la vuelta →  44 · se satura → 255
10 - 20: da la vuelta → 246 · se satura → 0
promedio de 200 y 100 sumando en uint8: 22
promedio de 200 y 100 con un int de Python: 150
un contador int32 llega a 2,147,483,647: a 116 fotos por segundo, en 214 días
```

La salida es convertir a un tipo más grande antes de hacer cuentas (int32 o float32) y, al final, recortar a 0–255 antes de volver a uint8.

Los contadores también dan la vuelta. Mira un contador int32 de las fotos de C01:

:::cuenta Un contador int32 de las fotos de C01
Fotos por segundo, en promedio // ≈ 10 millones al día: ≈ 2.5 M publicaciones con ≈ 3 fotos, más otros equipos | 10,000,000 ÷ 86,400 s | ≈ 116
El int32 más grande | 2³¹ − 1 | 2,147,483,647
Días hasta llegar | 2,147,483,647 ÷ 116 ÷ 86,400 | ≈ 214 días
Con uint32 // sin signo: el doble | 4,294,967,295 ÷ 116 ÷ 86,400 | ≈ 429 días
Con int64 | 9.2 × 10¹⁸ ÷ 116 | ≈ 2,500 millones de años
= En unos 7 meses, el contador int32 salta a −2,147,483,648 y la gráfica muestra fotos negativas. Con int64 no pasa nunca: por eso los contadores se guardan en 64 bits.
:::

No es teoría. En diciembre de 2014, el video *Gangnam Style* pasó de 2,147,483,647 vistas en YouTube, el tope de un int32, y YouTube tuvo que cambiar su contador a 64 bits. En 1996, el primer cohete Ariane 5 se autodestruyó unos 40 segundos después de despegar: su software convirtió un número con decimales en un entero de 16 bits con signo (tope: 32,767), el número no cabía y el programa de navegación se detuvo. Y muchos sistemas cuentan el tiempo en segundos desde el 1 de enero de 1970 con un int32: ese contador se llena el 19 de enero de 2038 a las 03:14:07 (hora UTC), el «problema del año 2038».

Los números con decimales también se desbordan, pero de otra forma: se vuelven *infinito*. Lo ves en la siguiente sección.

## Punto flotante: notación científica en base 2 {Floating point: scientific notation in base 2}

Los números de un modelo casi nunca son enteros: un peso vale 0.0213 o −1.7, un [[logit]] 3.0, un [[gradiente]] 0.000004, la pérdida 2.3. Y en el mismo cálculo conviven números enormes y diminutos.

¿Y si guardamos siempre, digamos, 4 decimales? No alcanza: 0.000004 quedaría en 0.0000, y los decimales sobran cuando el número es 150,528. Lo que sirve es la [[notacion-cientifica|notación científica]] de la lección de unidades: 150,528 = 1.50528 × 10⁵ y 0.000004 = 4 × 10⁻⁶. Se guardan dos cosas: los dígitos (1.50528) y el exponente (5), que dice dónde va el punto. Como el punto se mueve según el exponente, el formato se llama [[punto-flotante|punto flotante]] (*floating point*).

La computadora hace lo mismo, pero en base 2: escribe cada número como «1.algo» por una potencia de 2. Para eso necesita las posiciones del binario **después del punto**, que valen 1/2, 1/4, 1/8, 1/16… Así, 0.101 en binario es 1/2 + 1/8 = 0.625. Para no confundirlos con los decimales, a los números en binario les pongo un ₂ chiquito: 0.101₂ = 0.625.

Un número de punto flotante se guarda en tres partes:

:::pasos
1. El signo
Un bit: 0 si es positivo, 1 si es negativo.
2. El exponente
Unos bits que dicen a qué potencia se eleva el 2: dónde va el punto. Se guarda sumándole un número fijo, el **sesgo** (*bias*), para no necesitar otro signo: en FP32, el exponente 2 se guarda como 2 + 127 = 129.
3. La mantisa
Los dígitos que van después del «1.». El 1 de adelante no se guarda: en binario, el primer dígito distinto de cero siempre es 1, así que se da por hecho y es un bit gratis.
:::

El valor es: **(−1)^signo × 1.mantisa × 2^(exponente guardado − sesgo)**.

:::cuenta El 6.5 en FP32, bit por bit
En binario // 6 = 110₂ y 0.5 = 0.1₂ | 4 + 2 + 1/2 | 110.1₂
En notación científica // el punto se mueve 2 lugares | 110.1₂ = 1.101₂ × 2² | exponente 2
Signo // positivo | — | 0
Exponente guardado // 8 bits, con un sesgo de 127 | 2 + 127 = 129 | 1000 0001
Mantisa // lo de después del «1.», con ceros hasta llegar a 23 bits | .101₂ | 101 y 20 ceros
= Los 32 bits: 0 · 10000001 · 10100000000000000000000. De vuelta: 1.101₂ = 1 + 1/2 + 1/8 = 1.625, y 1.625 × 2² = 6.5. Exacto, porque 6.5 se escribe en binario con pocos dígitos.
:::

### Los números de punto flotante no están parejos

En FP32, con 23 bits de mantisa, entre 1 y 2 caben 2²³ = 8,388,608 números, todos a la misma distancia: ≈ 0.00000012. Entre 2 y 4 caben **otros tantos**, así que quedan al doble de distancia. Entre 1,024 y 2,048, a ≈ 0.000122. Cada vez que el número se duplica, la separación también.

Eso es justo lo que se busca: el error es **relativo**. Un número cercano a 1 se guarda con un error menor que una diezmillonésima; uno cercano a un millón, con un error de centésimas; y los dos están igual de bien guardados para su tamaño: a menos de 0.000006 % de su valor. La figura lo muestra con un formato de 8 bits, donde se pueden dibujar todos los números que existen.

:::figura numeros-maquina-recta
Todos los números de FP8 E5M2, un formato de 8 bits con 2 de mantisa, entre 0 y 16. En cada tramo (de 1 a 2, de 2 a 4, de 4 a 8 y de 8 a 16) hay exactamente 4. La separación se duplica de tramo en tramo, pero el error relativo es el mismo.
:::

### Infinito y NaN

Algunas combinaciones de bits están reservadas. Con el exponente todo en unos, el número es **infinito** (`inf`) o **NaN** (*not a number*, «no es un número»):

- `inf` aparece cuando un resultado es demasiado grande para el formato: es el overflow de los números con decimales. También sale al dividir entre cero en NumPy o en PyTorch (Python, en cambio, da un error).
- `NaN` aparece con cuentas que no tienen respuesta: 0 ÷ 0, infinito menos infinito, o un `inf` multiplicado por 0.

NaN contagia: cualquier cuenta con un NaN da NaN. Y NaN es distinto de todo, hasta de sí mismo: `x == x` es falso si `x` es NaN. Basta un NaN en la [[loss|pérdida]] para que la [[backpropagation]] llene de NaN todos los gradientes, y el siguiente paso, todos los pesos. Por eso «loss = nan» es la falla de entrenamiento más famosa, y muchas veces empieza con un overflow.

:::profundo Los subnormales y el −0
Con el exponente todo en ceros, el 1 de adelante se vuelve 0 y la mantisa sigue contando hacia abajo: son los números **subnormales**, que llenan el hueco entre el normal más chico y el 0, con menos cifras. En FP32 llegan hasta ≈ 1.4 × 10⁻⁴⁵; en FP16, hasta ≈ 6 × 10⁻⁸. Algunas GPUs los convierten en 0 para ir más rápido (*flush to zero*). Ese mismo exponente en ceros con la mantisa en ceros es el 0, que puede tener signo: existe un −0, que al compararlo es igual a 0.
:::

## FP32, FP16 y BF16: el mismo truco con distintos bits {FP32, FP16 and BF16: the same trick with different bits}

Todos los formatos de punto flotante hacen lo mismo; lo que cambia es cuántos bits le tocan al exponente y cuántos a la mantisa. La regla para recordarlos: **los bits de exponente dan el rango** (qué tan grande o qué tan chico puede ser el número) **y los de mantisa dan la precisión** (cuántas cifras guarda).

:::figura numeros-maquina-formatos
Cómo reparte sus bits cada formato. BF16 es la primera mitad de FP32: el mismo signo y el mismo exponente, con la mantisa recortada. FP16 cambia exponente por mantisa: más cifras que BF16, pero con tope en 65,504.
:::

| Formato | Signo · exponente · mantisa | Bytes | El más grande | Cifras | Separación junto al 1 |
|---|---|---|---|---|---|
| FP64 (float64) | 1 · 11 · 52 | 8 | ≈ 1.8 × 10³⁰⁸ | ≈ 16 | ≈ 2 × 10⁻¹⁶ |
| FP32 (float32) | 1 · 8 · 23 | 4 | ≈ 3.4 × 10³⁸ | ≈ 7 | ≈ 0.00000012 |
| FP16 (float16) | 1 · 5 · 10 | 2 | 65,504 | ≈ 3 | ≈ 0.001 |
| BF16 (bfloat16) | 1 · 8 · 7 | 2 | ≈ 3.4 × 10³⁸ | ≈ 2 | ≈ 0.008 |

¿De dónde salen las cifras? FP32 tiene 24 bits de dígitos (23 de mantisa más el 1 gratis), y 2²⁴ ≈ 16.8 millones: unas 7 cifras decimales. FP16 tiene 11 bits, y 2¹¹ = 2,048: unas 3. BF16 tiene 8, y 2⁸ = 256: entre 2 y 3.

### FP32: la referencia

Es el [[float32]] de la lección de imágenes. Con él se entrena por omisión, es el tipo que PyTorch usa si no le pides otro, y contra él se compara cualquier otro formato. Guarda ≈ 7 cifras y llega hasta ≈ 3.4 × 10³⁸: para casi todo, sobra. Su problema es el tamaño: 4 bytes por número.

FP64, el doble de grande, casi no se usa en ML (las GPUs lo calculan mucho más lento), pero te lo vas a encontrar en un lugar: los números con decimales de Python son FP64, igual que los arreglos de NumPy si no le dices otra cosa.

### FP16: la mitad de memoria y un techo de 65,504

[[fp16|FP16]] (*half precision*, media precisión) usa 2 bytes. Con 5 bits de exponente, su potencia más grande es 2¹⁵, y el número más grande que guarda es (2 − 2⁻¹⁰) × 2¹⁵ = **65,504**. Lo que pase de ahí se vuelve `inf`. Por abajo, el normal más chico es ≈ 0.000061 y los subnormales llegan a ≈ 0.00000006; lo que sea más chico se vuelve 0.

Con 10 bits de mantisa guarda ≈ 3 cifras: junto al 1, la separación es 2⁻¹⁰ ≈ 0.001, así que 1.0001 no existe y se guarda como 1.

En una CNN como la de C01, los números se quedan lejos del techo, y FP16 es la elección normal para servir: el engine de C01 es TensorRT en FP16. En un [[transformer]] es otra historia. Dos ejemplos:

- **Exponenciales.** e¹¹ ≈ 59,874 cabe, pero e¹² ≈ 162,755 ya no. Un [[softmax]] hecho sin cuidado en FP16 da `inf` con cualquier logit mayor que ≈ 11.09, que es el logaritmo natural de 65,504. Por eso las librerías le restan a todos los logits el más alto, el truco de la lección «Qué es un modelo».
- **Cuadrados.** 255² = 65,025 cabe; 256² = 65,536 ya no. Medir el tamaño de un vector de activaciones suma cuadrados, y basta un valor de 256 para que el resultado sea `inf`.

La Ronda, en M04, lo resume: las activaciones de un transformer tienen valores atípicos que pueden pasar de 65,504, y en FP16 se vuelven `inf` y después NaN.

### BF16: el rango de FP32 con menos precisión

[[bf16|BF16]] (*bfloat16*, de *brain floating point*: se inventó en Google Brain) también usa 2 bytes, pero los reparte al revés que FP16: **8 bits de exponente, los mismos de FP32**, y solo 7 de mantisa. De hecho, un BF16 son los primeros 16 bits de un FP32: para convertir, se redondea y se tira la segunda mitad.

El resultado es el rango de FP32 (hasta ≈ 3.4 × 10³⁸) con 2 o 3 cifras. Compara los tres con los mismos números:

| Número | En FP32 | En FP16 | En BF16 |
|---|---|---|---|
| 0.1 | 0.100000001 | 0.0999756 | 0.1000977 |
| 1000.3 | 1000.29999 | 1000.5 | 1000 |
| 70,000 | 70,000 | `inf` | 70,144 |
| 0.00000001 (10⁻⁸) | 1.0 × 10⁻⁸ | 0 | ≈ 1.001 × 10⁻⁸ |

BF16 se equivoca más en cada número, pero nunca se desborda donde FP32 no lo haría. Y resulta que las redes neuronales toleran muy bien la imprecisión (el ruido del entrenamiento es mucho más grande que ese error), pero no el overflow. Por eso los LLMs se entrenan y se sirven en BF16, y por eso la Ronda (M04) dice que BF16 «le ganó» a FP16 en los LLMs.

Un detalle de hardware que la Ronda subraya: BF16 existe en las GPUs desde la generación Ampere (la A100 y la A10G) en adelante, pero **no en la T4**. Servir en una T4 un LLM entrenado en BF16 obliga a FP16, con riesgo de overflow, o a FP32, con el doble de memoria y sin los núcleos rápidos.

:::nota TF32, en una línea
TF32 no es un formato para guardar: es un modo de cálculo de las GPUs desde Ampere, que multiplica con el exponente de FP32 y la mantisa de FP16 (10 bits) mientras los tensores se siguen guardando como FP32. Acelera las cuentas «en FP32» sin cambiar el código, pero no ahorra memoria.
:::

Con Python puedes ver los bits de verdad. El módulo `struct` convierte un número en los bytes de un FP32 (`"f"`) o de un FP16 (`"e"`):

```python
import struct

def bits_fp32(x):              # los 4 bytes de un float32, como texto de 0 y 1
    b = f'{struct.unpack(">I", struct.pack(">f", x))[0]:032b}'
    return f"{b[0]} {b[1:9]} {b[9:]}"

def bits_fp16(x):              # los 2 bytes de un float16 ("e" en struct)
    b = f'{struct.unpack(">H", struct.pack(">e", x))[0]:016b}'
    return f"{b[0]} {b[1:6]} {b[6:]}"

for x in (6.5, -2.75, 0.1, 65504.0):
    print(f"{x:>8}  FP32 {bits_fp32(x)}")
    print(f"{'':>8}  FP16 {bits_fp16(x)}")

try:
    bits_fp16(70000.0)
except OverflowError as error:
    print("70000 en FP16:", error)
```

```salida
     6.5  FP32 0 10000001 10100000000000000000000
          FP16 0 10001 1010000000
   -2.75  FP32 1 10000000 01100000000000000000000
          FP16 1 10000 0110000000
     0.1  FP32 0 01111011 10011001100110011001101
          FP16 0 01011 1001100110
 65504.0  FP32 0 10001110 11111111110000000000000
          FP16 0 11110 1111111111
70000 en FP16: float too large to pack with e format
```

Fíjate en el 0.1: su mantisa es «1001» repetido hasta que se acaban los bits, y en FP32 el último está redondeado hacia arriba. Y el 65,504 en FP16 tiene la mantisa toda en unos y el exponente en 11110: es el último número antes del infinito, que usa el exponente 11111.

### En PyTorch: el dtype de cada tensor

Cada tensor de PyTorch guarda todos sus números en el mismo formato, y ese formato es su [[dtype]] (*data type*, tipo de dato). El dtype decide cuántos bytes ocupa cada número y cómo se leen sus bits.

| En PyTorch | Formato | Bytes por número |
|---|---|---|
| `torch.float32` o `torch.float` | FP32 | 4 |
| `torch.float16` o `torch.half` | FP16 | 2 |
| `torch.bfloat16` | BF16 | 2 |
| `torch.float64` o `torch.double` | FP64 | 8 |
| `torch.uint8` | uint8 | 1 |
| `torch.int8` | int8 | 1 |
| `torch.int64` o `torch.long` | int64 | 8 |
| `torch.bool` | verdadero o falso | 1 |

Lo que PyTorch elige solo: un tensor con decimales nace en float32; uno con enteros, en int64. La memoria de un tensor es su cantidad de números por los bytes de su dtype. El tensor de la foto de Ana, de [[shape]] [1, 3, 224, 224], tiene 150,528 números: ocupa 602,112 bytes (≈ 602 KB) en float32, la mitad en float16 y ≈ 151 KB en uint8.

Así se ve en código. Es una ilustración: necesita PyTorch, que no viene con Python, y por eso no lleva su salida; lo que imprime está en los comentarios.

```python
import torch

x = torch.tensor([0.1, 2.5])          # con decimales: nace en float32
print(x.dtype, x.element_size())      # torch.float32 4  (4 bytes por número)
x16 = x.to(torch.float16)             # una copia en FP16, con la mitad de bytes
etiquetas = torch.tensor([3, 41])     # enteros: nacen en int64
print(etiquetas.dtype)                # torch.int64
foto = torch.zeros(1, 3, 224, 224, dtype=torch.uint8)
print(foto.float().div(255).dtype)    # torch.float32: así se convierte la foto
```

## Redondeo: por qué 0.1 + 0.2 no da 0.3 {Rounding: why 0.1 + 0.2 is not 0.3}

Casi ningún número cabe exacto en los bits. La computadora guarda el más cercano que sí existe, y la diferencia es el error de [[redondeo]] (*rounding error*).

Piensa en 1/3 en decimal: es 0.3333…, con treses que no se acaban. En binario, 1/10 hace lo mismo: 0.1 = 0.000110011001100110011…₂, con «0011» repetido para siempre. FP32 lo corta a los 24 bits de dígitos y guarda 0.100000001490116…; FP64 lo corta a los 53 y guarda 0.1000000000000000055…

Por eso, en Python, que usa FP64, 0.1 + 0.2 da **0.30000000000000004**, y `0.1 + 0.2 == 0.3` es falso. No es un error de Python: pasa en JavaScript, en C y en cualquier lenguaje que use estos formatos. En FP32, de pura suerte, 0.1 + 0.2 sí da el mismo número que 0.3, porque los dos errores se compensan; en FP16 vuelve a fallar. Que dos cuentas de punto flotante den exactamente lo mismo es cuestión de suerte.

¿Qué tan grande es el error? A lo mucho, media separación. En proporción al número:

| Formato | Error máximo al guardar cada número |
|---|---|
| FP32 | ≈ 0.000006 % |
| FP16 | ≈ 0.05 % |
| BF16 | ≈ 0.4 % |

### La regla: nunca compares con ==

Para comparar números de punto flotante se pregunta si están **cerca**: si la diferencia es menor que una tolerancia. En Python, `math.isclose(a, b)`; en PyTorch, `torch.allclose(a, b, rtol=…, atol=…)`. La tolerancia depende del formato: en la prueba de paridad de la Ronda (M08), la diferencia máxima normal entre los logits de dos versiones del modelo es de ≈ 0.0001 en FP32 y de ≈ 0.01 en FP16. Si sale órdenes de magnitud más grande, es un bug.

### Los enteros grandes también se redondean

Un FP32 guarda exacto cualquier entero hasta 2²⁴ = 16,777,216. Arriba de eso la separación ya es 2: el 16,777,217 no existe, y **16,777,216 + 1 = 16,777,216**. FP16 se atora mucho antes, en 2,048 (2,048 + 1 = 2,048), y BF16 en 256.

:::cuenta Un contador de fotos guardado en float32
Fotos por segundo // el promedio de C01 | 10,000,000 ÷ 86,400 | ≈ 116
El último entero seguro de FP32 | 2²⁴ | 16,777,216
Horas hasta llegar | 16,777,216 ÷ 116 ÷ 3,600 | ≈ 40 horas
Una foto más // ya no se mueve | 16,777,216 + 1 | 16,777,216
Años hasta atorarse en FP64 // como los contadores de Prometheus: 53 bits de dígitos | 2⁵³ ÷ 116 ÷ 86,400 ÷ 365 | ≈ 2.5 millones
= Un contador en float32 se atora en menos de dos días, sin ningún error. Contar es trabajo de enteros, o de FP64.
:::

### Los errores se acumulan

Cada suma redondea. Si sumas un número chiquito a uno grande, puede perderse completo: en FP16, 1 + 0.0001 da 1, porque 0.0001 es menos de media separación (≈ 0.0005). Sumar un millón de veces 0.0001 a un 1 en FP16 deja… el 1.

Por eso las GPUs, aunque multipliquen en FP16, **acumulan las sumas en FP32**: una multiplicación de matrices junta miles de productos, y en FP16 los últimos ya no moverían el total.

```python
import math, struct

def fp32(x):                   # redondea x a float32 y lo regresa como float de Python
    return struct.unpack(">f", struct.pack(">f", x))[0]

def fp16(x):
    return struct.unpack(">e", struct.pack(">e", x))[0]

print(0.1 + 0.2, "· ¿igual a 0.3?", 0.1 + 0.2 == 0.3)   # Python usa FP64
print(f"0.1 guardado en FP32: {fp32(0.1):.20f}")
print("FP32: 16,777,216 + 1 =", fp32(16_777_216 + 1))
print("FP16: 2,048 + 1 =", fp16(2048 + 1))
print("FP16: 1 + 0.0001 =", fp16(1 + 0.0001))
print("FP16: 1 + 0.001 =", fp16(1 + 0.001))
print("¿cerca de 0.3?", math.isclose(0.1 + 0.2, 0.3))
```

```salida
0.30000000000000004 · ¿igual a 0.3? False
0.1 guardado en FP32: 0.10000000149011611938
FP32: 16,777,216 + 1 = 16777216.0
FP16: 2,048 + 1 = 2048.0
FP16: 1 + 0.0001 = 1.0
FP16: 1 + 0.001 = 1.0009765625
¿cerca de 0.3? True
```

El 1 + 0.001 sí se mueve en FP16, pero no a 1.001: al número de FP16 más cercano, 1.0009765625, que es 1 + 2⁻¹⁰.

:::ejemplo El reloj del Patriot
En febrero de 1991, en Dhahran, Arabia Saudita, una batería de misiles antiaéreos Patriot llevaba ≈ 100 horas encendida. Su reloj contaba el tiempo en décimas de segundo y lo convertía multiplicando por 0.1, guardado en un registro de 24 bits. Ese 0.1 tenía un error de ≈ 0.000000095.

En 100 horas hay 3,600,000 décimas de segundo, y el error se sumó en cada una: 3,600,000 × 0.000000095 ≈ **0.34 segundos** de atraso. Un misil Scud recorre más de medio kilómetro en ese tiempo. El sistema lo buscó en el lugar equivocado, no lo interceptó, y el ataque mató a 28 soldados estadounidenses. El error de cada décima era diminuto; lo grave fue acumularlo.
:::

## Precisión mixta: entrenar en 16 bits sin perder lo importante {Mixed precision: training in 16 bits without losing what matters}

Entrenar en 16 bits tiene dos premios. Las activaciones ocupan la mitad de memoria. Y las GPUs tienen núcleos especiales para multiplicar matrices en 16 bits, los [[tensor-core|*tensor cores*]], muchísimo más rápidos: una T4 hace ≈ 65 billones (65 × 10¹²) de operaciones por segundo en FP16 contra ≈ 8.1 billones en FP32 (M04): 8 veces menos.

Pero entrenar todo en FP16 falla de tres maneras:

1. **Los cambios chicos se pierden.** Con un [[learning-rate|learning rate]] de 0.001 y un gradiente de 0.1, el paso es de 0.0001. Un peso que vale 1 debería quedar en 1.0001, pero en FP16 queda en 1: el cambio es menor que media separación. El modelo deja de aprender sin ningún error.
2. **Los gradientes diminutos se vuelven 0.** FP16 no baja de ≈ 6 × 10⁻⁸. Un gradiente de 10⁻⁸ se guarda como 0, y esa parte del modelo deja de aprender.
3. **Lo grande se desborda.** Lo que pase de 65,504 es `inf`, y de ahí viene el NaN.

La [[precision-mixta|precisión mixta]] (*mixed precision*; en PyTorch se llama AMP, de *automatic mixed precision*) resuelve las tres con tres ideas, publicadas en 2018 por investigadores de NVIDIA y de Baidu:

:::pasos
1. Una copia maestra en FP32
Los pesos de verdad viven en FP32. En cada paso se hace una copia en FP16 para las cuentas, y el cambio se le suma a la copia en FP32, donde 1 + 0.0001 sí da 1.0001.
2. Lo pesado en FP16, lo delicado en FP32
Las convoluciones y las multiplicaciones de matrices, que son casi todo el trabajo, van en FP16 en los tensor cores, acumulando en FP32. El softmax, la pérdida, las normalizaciones y las sumas largas van en FP32. En PyTorch, `torch.autocast` lo decide operación por operación.
3. Una escala para la pérdida
Antes de la backpropagation, la pérdida se multiplica por un número grande: al principio, 65,536 (2¹⁶). Por la [[regla-cadena|regla de la cadena]], todos los gradientes salen multiplicados por lo mismo y se alejan de la zona donde serían 0. Antes de actualizar, se dividen entre la escala, ya en FP32.
:::

:::cuenta Un gradiente que se salva con la escala
Gradiente real | 0.00000001 | 10⁻⁸
En FP16, sin escala // el más chico de FP16 es ≈ 6 × 10⁻⁸: se perdió | 10⁻⁸ se redondea | 0
Con la escala // la pérdida × 65,536: el gradiente sale multiplicado igual, y esto sí cabe en FP16 | 10⁻⁸ × 65,536 | ≈ 0.000655
De vuelta, en FP32 // se divide antes de actualizar | 0.000655 ÷ 65,536 | ≈ 0.9997 × 10⁻⁸
= Sin escala, el gradiente se pierde. Con escala, llega con un error de 0.03 %.
:::

```python
import struct

def fp16(x):
    try:
        return struct.unpack(">e", struct.pack(">e", x))[0]
    except OverflowError:
        return float("inf")                    # en la GPU, lo que no cabe se vuelve inf

gradiente = 1e-8                               # un gradiente chiquito, calculado en FP16
print("sin escala:", fp16(gradiente))
escala = 65_536                                # la escala inicial de GradScaler
g16 = fp16(gradiente * escala)                 # la pérdida se multiplicó antes del backward
print("con escala, en FP16:", g16)
print("de vuelta, dividido entre la escala:", g16 / escala)

grande = 4.0                                   # un gradiente normalito
print("4 × 65,536 en FP16:", fp16(grande * escala), "→ se salta el paso y la escala baja a 32,768")
```

```salida
sin escala: 0.0
con escala, en FP16: 0.0006551742553710938
de vuelta, dividido entre la escala: 9.997165761888027e-09
4 × 65,536 en FP16: inf → se salta el paso y la escala baja a 32,768
```

La última línea es el otro lado de la escala: si es demasiado grande, un gradiente normal se desborda. Lo vigila una pieza de PyTorch llamada **GradScaler**: si algún gradiente sale `inf` o NaN, se salta ese paso (no toca los pesos) y baja la escala a la mitad. Si pasan 2,000 pasos sin problemas, la vuelve a duplicar. Así la escala se ajusta sola, tan alta como se pueda sin desbordar.

:::diagrama numeros-maquina-amp
Toca cada caja para ver por qué está ahí, o usa «Recorrer» para seguir un paso completo y uno que se desborda.
:::

Con BF16 la historia es más corta. Tiene el exponente de FP32, así que un gradiente de 10⁻⁸ cabe y no hace falta la escala. La copia maestra en FP32 sí hace falta: en BF16, ni siquiera 1 + 0.001 mueve el 1. Así se entrenan los LLMs: precisión mixta con BF16 y sin GradScaler.

¿Ahorra memoria? Menos de lo que parece. En la lección «Cómo aprende un modelo» viste que, con [[adam|Adam]] en precisión mixta, cada parámetro ocupa ≈ 16 bytes: 2 del peso en 16 bits, 2 de su gradiente, 4 de la copia maestra y 8 de los dos promedios de Adam. Lo que baja a la mitad son las activaciones; el premio grande es la velocidad. C01 hace así su fine-tune mensual, con AMP.

En código, la precisión mixta son pocas líneas. Es una ilustración, sin salida, porque pide PyTorch y una GPU:

```python
scaler = torch.amp.GradScaler("cuda")            # la escala empieza en 65,536
for fotos, etiquetas in datos:
    optimizador.zero_grad()
    with torch.autocast(device_type="cuda", dtype=torch.float16):
        perdida = criterio(modelo(fotos), etiquetas)   # convs en FP16; la pérdida, en FP32
    scaler.scale(perdida).backward()           # pérdida × escala, y la backpropagation
    scaler.step(optimizador)                   # divide entre la escala; con inf o NaN, se salta el paso
    scaler.update()                            # ajusta la escala para el siguiente paso
```

Si se entrena en BF16, el `autocast` lleva `dtype=torch.bfloat16` y el `scaler` sobra.

## FP8: un byte que conserva un exponente {FP8: one byte that keeps an exponent} [extra]

¿Se puede bajar a 8 bits sin dejar de ser punto flotante? Sí: es [[fp8|FP8]], que existe en dos versiones, propuestas en 2022 por investigadores de NVIDIA, Arm e Intel:

| Versión | Signo · exponente · mantisa | El más grande | Separación entre 1 y 2 | Para qué |
|---|---|---|---|---|
| E4M3 | 1 · 4 · 3 | 448 | 0.125 | Pesos y activaciones |
| E5M2 | 1 · 5 · 2 | 57,344 | 0.25 | Gradientes, que necesitan más rango |

El nombre dice el reparto: E4M3 es «exponente de 4 bits, mantisa de 3». La figura de los números que no están parejos era justo E5M2.

:::cuenta El número más grande de E4M3
Exponente más grande // 4 bits en unos = 15, menos el sesgo de 7 | 15 − 7 | 8
Mantisa más grande // la 111 se reserva para NaN | 1.110₂ = 1 + 1/2 + 1/4 | 1.75
El más grande | 1.75 × 2⁸ | 448
= Con 3 bits de mantisa, entre 1 y 2 solo hay 8 números: 1, 1.125, 1.25… hasta 1.875. Es ≈ 1 cifra decimal.
:::

Con un rango tan corto, FP8 casi nunca se usa solo: cada tensor lleva una **escala**, un número en FP32 que lo agranda o lo achica para que su valor más grande caiga cerca del máximo antes de convertirlo. Es la misma idea de la cuantización, que viene en la siguiente sección. La diferencia con INT8 es que FP8 conserva un exponente: sus escalones son finos cerca del 0 y gruesos lejos de él, así que aguanta mejor los valores atípicos (M08).

¿Dónde existe? En las GPUs Ada (L4, L40S) y Hopper (H100), y no en la A100, la A10G ni la T4 (M04). La generación Blackwell (B200) ya agrega FP4. En la Ronda, C10 sirve su LLM de 70,600 millones de parámetros con los pesos en FP8, y M14 explica que el [[kv-cache|KV cache]] también puede ir en FP8: de 320 KiB por token baja a 160 KiB, y caben el doble de conversaciones a la vez.

## Cuantización: enteros con una escala {Quantization: integers with a scale}

FP16 corta los bytes a la mitad. Para bajar a la cuarta parte o menos se usan enteros. Guardar los números de un modelo con menos bits se llama [[cuantizacion|cuantización]] (*quantization*), y la versión más común es [[int8|INT8]]: cada número se guarda como un entero de 8 bits, más una **escala** que comparte todo el grupo.

**valor ≈ escala × entero**

Para un grupo de números, por ejemplo los pesos de una capa:

:::pasos
1. Elige la escala
Que el valor más grande del grupo, sin importar el signo, caiga en el entero más grande: escala = máximo ÷ 127. Se llama cuantización **simétrica**, porque usa los enteros de −127 a 127.
2. Cuantiza
Divide cada número entre la escala y redondea al entero más cercano: entero = redondear(valor ÷ escala).
3. Para usarlo, descuantiza
Multiplica de vuelta: valor ≈ entero × escala. Si el número estaba dentro del rango, el error es, a lo mucho, medio escalón: escala ÷ 2.
:::

:::ejemplo Cinco pesos en INT8, de ida y de vuelta
Cinco pesos de una capa: 0.1, −0.73, 1.26, 2.04 y −2.5. El más grande sin signo es 2.5 (es el rango del ejemplo de la Ronda en M08).

Escala = 2.5 ÷ 127 ≈ **0.019685**.

| Peso | Peso ÷ escala | Entero guardado | De vuelta: entero × escala | Error |
|---|---|---|---|---|
| 0.1 | 5.08 | 5 | 0.0984 | 0.0016 (1.6 %) |
| −0.73 | −37.08 | −37 | −0.7283 | 0.0017 (0.23 %) |
| 1.26 | 64.01 | 64 | 1.2598 | 0.0002 (0.01 %) |
| 2.04 | 103.63 | 104 | 2.0472 | 0.0072 (0.36 %) |
| −2.5 | −127 | −127 | −2.5 | 0 |

Cada peso ocupa ahora 1 byte en vez de 4, y la escala (4 bytes) la comparten todos los pesos de la capa. El error más grande, 0.0072, es menor que medio escalón: 0.019685 ÷ 2 ≈ 0.0098.
:::

:::figura numeros-maquina-escala
Arriba, los cinco pesos sobre los 255 escalones de la capa. En medio, un acercamiento entre 0 y 0.2: el 0.1 cae en el escalón 5. Abajo, la misma capa con un peso de 25: los escalones son 10 veces más anchos y el 0.1 brinca al escalón 1, que vale 0.197.
:::

### Un solo valor atípico arruina la escala

Ahora agrega a esa capa un solo peso de 25. La escala pasa a 25 ÷ 127 ≈ 0.197: diez veces más gruesa. El mismo 0.1 se guarda como redondear(0.508) = 1 y vuelve como **0.197**, con un error de 97 %. Un valor extremo le quitó resolución a todos los demás. Casi todo el arte de cuantizar es elegir escalas que no desperdicien los 8 bits:

- **Una escala por canal** (*per-channel*): en una convolución, cada filtro tiene sus propios pesos y su propia escala, en vez de una sola para toda la capa. Es lo normal para los pesos.
- **Recortar los extremos:** elegir el rango con un percentil en vez del máximo, y aceptar que los poquísimos valores de afuera se saturen.
- **Dejar sin cuantizar las capas delicadas:** a menudo, la primera y la última, que se quedan en FP16.

### El punto cero, para rangos que no están centrados

Si los números no están repartidos alrededor del 0, la versión simétrica desperdicia enteros. Después de una [[relu|ReLU]] todo es positivo: con un rango de 0 a 6, la escala simétrica es 6 ÷ 127 ≈ 0.047 y la mitad negativa de los enteros nunca se usa. La cuantización **asimétrica** usa todos los enteros para el rango real, del mínimo al máximo, y agrega un **punto cero** (*zero point*): el entero que representa al 0 de verdad.

**valor ≈ escala × (entero − punto cero)**

:::ejemplo Un rango de −1 a 3, en uint8 (de 0 a 255)
- Escala = (3 − (−1)) ÷ 255 = 4 ÷ 255 ≈ 0.01569. Con el rango de la ReLU, de 0 a 6, sería 6 ÷ 255 ≈ 0.024: la mitad que la simétrica.
- Punto cero = redondear(1 ÷ 0.01569) = redondear(63.75) = **64**. El 0 real se guarda como 64, exacto. Importa, porque el 0 es de los números más comunes dentro de una red.
- El 2.2 se guarda como redondear(2.2 ÷ 0.01569) + 64 = 140 + 64 = **204**, y vuelve como 0.01569 × (204 − 64) ≈ 2.1961.
- El −0.5 se guarda como redondear(−31.875) + 64 = −32 + 64 = **32**, y vuelve como 0.01569 × (32 − 64) ≈ −0.5020.
:::

:::calculadora numeros-maquina-cuantizar
Prueba también los otros pesos del ejemplo (−0.73, 1.26 y 2.04): con el rango en 2.5, ninguno queda a más de medio escalón.
:::

### Calibrar: medir los rangos antes de cuantizar

Los pesos están fijos, así que su rango se mide una vez. Las activaciones cambian con cada foto. Para elegir sus escalas se **calibra**: se pasan por el modelo unos cientos de ejemplos reales y se anota el rango de cada capa. M08 pide de unos cientos a ≈ 1,000 (la guía de NVIDIA, al menos 500 para CNNs), sacados del tráfico reciente de producción, de todos los slices y con el mismo preprocesamiento del servidor.

:::ojo
«Calibrar» aquí no es la [[calibracion|calibración]] de la lección «¿Aprendió de verdad?», la de que un 90 % de confianza acierte 90 de cada 100. Es la misma palabra para otra cosa: aquí, medir rangos para elegir escalas. En la Ronda vas a ver las dos.
:::

Hay dos maneras de llegar a un modelo cuantizado:

- **PTQ** (*post-training quantization*, cuantización después del entrenamiento): cuantizas el modelo ya entrenado, con la calibración. Tarda de minutos a horas.
- **QAT** (*quantization-aware training*, entrenamiento que sabe que lo van a cuantizar): entrenas o haces fine-tuning simulando el redondeo en el forward, para que el modelo aprenda a tolerarlo. Da mejor calidad, pero son días de trabajo y un pipeline más que mantener.

La regla de la Ronda: primero PTQ, siempre. QAT, solo si PTQ no pasa el examen y el INT8 de verdad compra algo.

### INT4: dieciséis valores y una escala por grupo

[[int4|INT4]] usa 4 bits: solo 16 enteros, de −8 a 7 (la versión simétrica usa de −7 a 7). Es medio byte por número, y con una sola escala por capa no alcanza. En la capa del ejemplo, la escala sería 2.5 ÷ 7 ≈ 0.357, y el 0.1 se guardaría como redondear(0.28) = **0**: desaparece.

La solución es una escala para cada **grupo** chico de pesos seguidos, por ejemplo cada 128: en un grupo chico el rango es más angosto y los escalones, más finos. Cuesta algo: si cada escala ocupa 2 bytes (en FP16), son 16 bits por cada 128 pesos, 0.125 bits más por peso: **4.125 bits por peso** en vez de 4.

En los LLMs, INT4 casi siempre es *weight-only* («solo pesos»): los pesos se guardan en INT4 y se convierten de vuelta a BF16 al vuelo, justo antes de multiplicar. Los métodos más usados se llaman AWQ y GPTQ (M14).

```python
pesos = [0.1, -0.73, 1.26, 2.04, -2.5]

def cuantizar(xs, bits=8):
    qmax = 2 ** (bits - 1) - 1                 # 127 en INT8, 7 en INT4
    escala = max(abs(x) for x in xs) / qmax    # simétrica: el más grande cae en ±qmax
    enteros = [round(x / escala) for x in xs]
    return escala, enteros, [q * escala for q in enteros]

for nombre, xs, bits in (("INT8", pesos, 8), ("INT8 con un 25", pesos + [25.0], 8), ("INT4", pesos, 4)):
    escala, enteros, vuelta = cuantizar(xs, bits)
    error = max(abs(v - x) for v, x in zip(vuelta, xs))
    print(f"{nombre}: escala {escala:.4f} · enteros {enteros}")
    print(f"   de vuelta {[round(v, 4) for v in vuelta]}")
    print(f"   error máximo {error:.4f} · el 0.1 quedó en {vuelta[0]:.4f}")
```

```salida
INT8: escala 0.0197 · enteros [5, -37, 64, 104, -127]
   de vuelta [0.0984, -0.7283, 1.2598, 2.0472, -2.5]
   error máximo 0.0072 · el 0.1 quedó en 0.0984
INT8 con un 25: escala 0.1969 · enteros [1, -4, 6, 10, -13, 127]
   de vuelta [0.1969, -0.7874, 1.1811, 1.9685, -2.5591, 25.0]
   error máximo 0.0969 · el 0.1 quedó en 0.1969
INT4: escala 0.3571 · enteros [0, -2, 4, 6, -7]
   de vuelta [0.0, -0.7143, 1.4286, 2.1429, -2.5]
   error máximo 0.1686 · el 0.1 quedó en 0.0000
```

## Memoria del modelo y el precio de cuantizar {Model memory and the price of quantization}

La cuenta que más vas a hacer en la Ronda es una multiplicación:

**memoria de los pesos = [[parametro|parámetros]] × bytes por parámetro**

:::cuenta La ResNet-50 de C01, en cada formato
Parámetros // con su capa final de 500 categorías | 24,532,532 | ≈ 24.5 M
FP32 | 24.5 M × 4 B | ≈ 98 MB
FP16 o BF16 | 24.5 M × 2 B | ≈ 49 MB
INT8 // más las escalas | 24.5 M × 1 B | ≈ 24.5 MB
INT4 | 24.5 M × 0.5 B | ≈ 12 MB
Lo que midió la Ronda // M08: el archivo ONNX en FP32 contra INT8 | 98 MB → 25.1 MB | ≈ 3.9 veces menos
= En una T4 de 16 GB, hasta en FP32 la ResNet-50 ocupa 0.6 % de la memoria. En una CNN, la memoria de los pesos casi nunca es el problema.
:::

En un [[llm|LLM]] es lo contrario. Un modelo de 70B (70 mil millones de parámetros) pesa 280 GB en FP32, **140 GB en FP16 o BF16**, 70 GB en INT8 o FP8 y 35 GB en INT4. Con los 70,600 millones de Llama 3 70B, el que usa la Ronda, son ≈ 141 GB en BF16 y ≈ 70.6 GB en FP8. Una H100 tiene 80 GB: en BF16 no cabe; en FP8 caben los pesos, pero casi no queda lugar para el KV cache; en INT4 (≈ 35 GB, más ≈ 1.1 GB de escalas por grupo) sobra espacio.

:::calculadora numeros-maquina-memoria
Prueba también Llama 3 8B (8030) en una L4 de 24 GB: en BF16, los pesos solos ya ocupan dos terceras partes.
:::

### Menos bytes, ¿más velocidad?

A veces. En una CNN, lo que más tarda son las cuentas, no leer los pesos, así que el techo lo pone cuántas operaciones INT8 por segundo hace el chip contra las de FP16: en la T4, 130 billones contra 65 billones, el doble como máximo. La Ronda (M08) lo midió con la ResNet-50 de C01 en CPU, de FP32 a INT8, con 4 veces menos bytes: fue ≈ 2 veces más rápida con una foto a la vez y ≈ 3.5 veces con 8, no 4. Además, no todo se cuantiza, cada cambio entre INT8 y FP16 cuesta una conversión, y el preprocesamiento y la red siguen igual.

En un LLM que genera texto pasa otra cosa. Para cada [[token]] nuevo, la GPU relee todos los pesos, y casi todo el tiempo se va en leer, no en calcular: está limitado por la memoria ([[memory-bound]]), como explica la lección de FLOPs. Ahí, menos bytes son casi directo más tokens: Llama 3 8B en una L4, que lee 300 GB por segundo, no pasa de ≈ 19 tokens por segundo en BF16 (16 GB de pesos), ≈ 37 en INT8 y ≈ 52 en INT4 (≈ 5.7 GB), según M04.

### Lo que cuesta: las respuestas cambian

Cada cambio de formato mueve un poco cada número, y miles de millones de cuentas encadenadas mueven los resultados. En la lección «Qué es un modelo» viste que pasar a FP16 cambia los logits del orden de 0.01: en una foto casi empatada, con Tenis 2.31 y Botas 2.30, eso basta para que cambie el [[argmax]].

Por eso la Ronda (M08) no deja pasar un modelo convertido sin un examen. En C01, el engine de TensorRT en FP16 y el modelo original de PyTorch en FP32 responden las mismas ≈ 10,000 fotos del [[golden-set|golden set]], con el preprocesamiento del gateway:

:::cuenta El examen del engine FP16 de C01
Fotos del examen // del golden set | — | ≈ 10,000
Acuerdo mínimo del top-1 // que los dos den la misma categoría | 99.5 % de 10,000 | 9,950 fotos
Fotos que pueden cambiar su top-1 | 10,000 − 9,950 | ≤ 50
Acuerdo mínimo del top-5 | — | 99 %
Diferencia máxima de logits // se reporta; entre dos FP32 sería ≈ 0.0001, y órdenes de magnitud más es un bug | engine FP16 contra PyTorch FP32 | ≈ 0.01
Calidad // top-1 y top-5 en el golden set, contra el modelo actual | diferencia con el actual | ≥ −0.3 puntos
= La [[prueba-paridad|paridad]] dice que el engine se porta como el modelo que evaluaste. La calidad, medida por categoría y por slice, dice que nadie salió perdiendo.
:::

Para INT8 el acuerdo esperado es menor, y su umbral se fija con datos. Y ahí el promedio engaña. M08 lo muestra con un ejemplo ilustrativo: si el 80 % de las fotos (las categorías grandes) pierde 0.1 puntos y el 20 % de la [[long-tail|cola larga]] pierde 1.1, el total baja 0.8 × 0.1 + 0.2 × 1.1 = 0.3 puntos, justo en la orilla del examen, aunque la cola perdió 11 veces más. Una categoría chica, con ≈ 60 fotos en el golden set, puede perder 5 puntos sin mover el total. Por eso el examen de INT8 mira el [[recall]] por categoría y por [[slice]], no solo el promedio.

:::diagrama numeros-maquina-c01
Del checkpoint a la respuesta: qué formato tiene cada cosa. Usa «Recorrer» para seguir los pesos, la foto de Ana o una cuantización a INT8.
:::

## Errores comunes {Common mistakes}

### 1. El overflow de FP16

Un modelo que funciona en FP32 da `inf` o NaN en FP16: un softmax sin restar el máximo, una suma de cuadrados, una activación atípica de un transformer. Nada avisa hasta que la pérdida sale `nan` o las respuestas se vuelven basura.

**Cómo evitarlo:** para entrenar, precisión mixta con `autocast` (que deja en FP32 lo delicado) o BF16. Para servir, una prueba de paridad contra FP32 antes de publicar, y revisar que las salidas no traigan `inf` ni NaN. Un LLM entrenado en BF16 no se pasa a FP16 sin probarlo con el golden set.

### 2. Comparar números de punto flotante con ==

`0.1 + 0.2 == 0.3` es falso, y una prueba que exige logits idénticos entre dos versiones del modelo falla siempre, o pasa por suerte.

**Cómo evitarlo:** comparar con tolerancia (`math.isclose`, `torch.allclose`), con una tolerancia que corresponda al formato: ≈ 0.0001 en FP32, ≈ 0.01 en FP16. Y para decidir si dos modelos «responden igual», medir el acuerdo del top-1, como la paridad de M08.

### 3. Olvidar que cuantizar cambia las salidas

«Es el mismo modelo, solo que en INT8.» No: cada respuesta cambia un poco, algunas cambian de categoría y la confianza de todas se mueve, y con ella cualquier umbral, como el de C01 que manda a etiquetar las fotos cuyo top-1 queda debajo de 0.3. La Ronda señala una trampa: `trtexec --int8` sin datos de calibración arma un engine que corre rápido, pero con escalas de relleno; sus predicciones no valen nada.

**Cómo evitarlo:** calibrar con datos reales de producción y pasar el mismo examen que un modelo nuevo: paridad, calidad por categoría y por slice, y la [[ece|ECE]].

### 4. Confundir bits y bytes, o parámetros y bytes

INT4 son 4 **bits**: medio byte, no 4 bytes. Un modelo «8B» tiene 8 mil millones de **parámetros**: en BF16 pesa ≈ 16 GB, no 8. Y la red se mide en bits por segundo (Gb/s) y la memoria en bytes (GB): un factor de 8 que se pierde fácil.

**Cómo evitarlo:** escribir las unidades en cada paso de la cuenta (parámetros × bytes por parámetro = bytes) y revisar que la b chica sea bit y la B grande, byte.

### 5. Hacer cuentas con píxeles en uint8

Sumar, restar o promediar fotos en uint8 da la vuelta sin avisar: 250 + 10 = 4 y 10 − 20 = 246. Las fotos salen con manchas negras en lo blanco y blancas en lo negro.

**Cómo evitarlo:** convertir a float32 (o a int32) antes de operar, recortar a 0–255 al final y solo entonces volver a uint8. O usar funciones que se saturan, como `cv2.add`.

### 6. Mezclar dtypes sin darte cuenta

Un arreglo de NumPy nace en float64. Si lo conviertes en tensor y se lo pasas a un modelo en float32, PyTorch se queja de que los tipos no coinciden; si para callarlo conviertes todo a float64, ocupas el doble de memoria sin ganar nada. Al revés también muerde: las etiquetas de la [[entropia-cruzada|entropía cruzada]], cuando son números de categoría, tienen que ser int64.

**Cómo evitarlo:** revisar `x.dtype` en la frontera entre NumPy y PyTorch, convertir a propósito (`.float()`, `.long()`) y fijar el dtype en el contrato del servidor. En C01, la configuración de Triton dice `TYPE_FP32` para la entrada y para la salida.

## En la vida real {In real life} [extra]

### C01: un engine FP16 en una T4

El modelo de C01 se entrena con precisión mixta, se guarda y se exporta en FP32 (el ONNX pesa ≈ 98 MB) y se sirve como un engine de TensorRT en FP16: ≈ 49 MB de pesos en una T4 de 16 GB, cuyos tensor cores hacen ≈ 65 billones de operaciones por segundo en FP16. La entrada que manda el gateway es un tensor float32 de 602 KB, y la salida, 500 logits en float32.

La Ronda deja anotadas dos mejoras que son de esta lección. Una: mandar la entrada en uint8 (150,528 bytes en vez de 602,112) y normalizar dentro del modelo, para que el tráfico de red entre el gateway y la GPU baje 4 veces, de ≈ 2.4 Gb/s a ≈ 0.6 Gb/s en el pico de diseño de 500 fotos por segundo. Dos: medir la ResNet-50 en INT8 en CPU, porque la GPU está al ≈ 5 % en promedio. Si diera ≈ 15 ms por imagen por [[vcpu|vCPU]] (un núcleo virtual de la nube) sin perder más de 0.5 puntos en el golden set, podría salir más barata que las dos T4 (≈ US$768 al mes). Es una medición pendiente, no un hecho.

### C10: un LLM de 70B en FP8, y por qué no INT4

C10 sirve un modelo de ≈ 70,600 millones de parámetros a varios equipos de una empresa. En BF16 pesaría ≈ 141 GB, y cada réplica necesitaría 4 H100 para tener lugar para el KV cache. En FP8 pesa ≈ 70.6 GB y cada réplica usa 2 H100: de los 144 GB que usa vLLM (el 90 % de 160), quedan ≈ 68 GB para el KV cache, ≈ 93 conversaciones de 2,250 tokens a la vez. Con 16 réplicas, son 32 H100.

¿Por qué no INT4, con ≈ 35 a 40 GB de pesos en una sola H100 por réplica? La Ronda lo descarta: le dejaría ≈ 30 GB de KV a cada GPU, menos conversaciones por réplica, y INT4 arriesga más calidad que FP8 cuando la memoria ya no es el límite. Y nada de esto lo decide el formato solo: cada versión cuantizada corre los golden sets de cada producto contra la versión en BF16.

### C02 y el teléfono: modelos en el edge

En C02, cada centro de distribución tiene su propia caja con una GPU L4 que vigila 40 cámaras con un detector ligero (≈ 10 a 30 millones de parámetros) en TensorRT FP16: un engine de ≈ 50 a 150 MB. Si algún día pasa a INT8, la Ronda pide calibrar con frames reales de día y de noche, porque las escalas se ajustan a lo que ven. En los equipos más chicos, como los Jetson de NVIDIA, algunos modelos traen además un acelerador que solo corre capas de CNN en INT8 o FP16 (M04).

En un teléfono, el límite es todavía más duro: lo que pesa la app y lo que aguanta la batería. Los chips de IA de los teléfonos (las NPU) trabajan sobre todo en FP16 e INT8, con herramientas como Core ML, de Apple, o LiteRT (antes TensorFlow Lite), de Google. Un modelo de 20 millones de parámetros pesa 40 MB en FP16 y 20 MB en INT8: a veces, cuantizar es lo que decide si cabe.

### C07 y C08: los embeddings en int8

Cuantizar no es solo para pesos. En la lección de embeddings viste que C07 guarda 100 millones de vectores de 512 números: ≈ 205 GB en float32 y ≈ 51.2 GB en int8. C08, con vectores de 128, baja a 12.8 GB. Para el orden final, C07 recalcula la distancia de sus mejores candidatos con los vectores completos: el int8 sirve para buscar rápido, y la precisión se recupera donde importa.

### Fuera de ML: el dinero, la hoja de cálculo y Pac-Man

Los bancos y las tiendas no guardan el dinero en punto flotante: 0.1 + 0.2 pesos no puede dar 0.30000000000000004. Lo guardan en centavos, con enteros, o con tipos decimales exactos. Las hojas de cálculo como Excel guardan los números en FP64 y conservan a lo mucho 15 cifras: si escribes como número una tarjeta de 16 dígitos, el último se vuelve 0. Y en el *Pac-Man* original, el nivel 256 sale con media pantalla de basura: el contador del nivel es un solo byte, y ahí se desborda.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de rangos, cuantización y memoria se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Escribe 77 en binario, con 8 bits. Después: ¿qué número es 1010 1010 como uint8 y como int8?
- 77: la posición de 64 cabe (quedan 13); 32 y 16 no; 8 cabe (quedan 5); 4 cabe (queda 1); 2 no; 1 sí. **0100 1101**. Comprueba: 64 + 8 + 4 + 1 = 77.
- 1010 1010 como uint8: 128 + 32 + 8 + 2 = **170**.
- Como int8, el primer bit vale −128: −128 + 32 + 8 + 2 = **−86**. Es lo mismo que 170 − 256.
? [facil] ¿Cabe 40,000 en un int16? ¿Y en un uint16? ¿Cuánto ocupa un millón de números int16?
- int16 va de −32,768 a 32,767: **no cabe**. En un arreglo de NumPy daría la vuelta: 40,000 − 65,536 = −25,536.
- uint16 va de 0 a 65,535: **sí cabe**.
- Un millón de int16: 1,000,000 × 2 bytes = **2 MB**.
? [facil] En uint8, ¿cuánto da 200 + 70? ¿Y 30 − 50? ¿Qué darían si se saturaran?
- 200 + 70 = 270, que no cabe: 270 − 256 = **14**. Saturado: **255**.
- 30 − 50 = −20, que tampoco: −20 + 256 = **236**. Saturado: **0**.
- Por eso las cuentas con píxeles se hacen en float32 o en int32, y se recorta al final.
? [facil] El detector YOLOv8m tiene ≈ 25.9 millones de parámetros. ¿Cuánto pesan sus pesos en FP32, en FP16 y en INT8?
- FP32: 25.9 M × 4 B ≈ **103.6 MB**.
- FP16: 25.9 M × 2 B ≈ **51.8 MB**; la Ronda (M04) dice ≈ 52 MB.
- INT8: 25.9 M × 1 B ≈ **25.9 MB**, más las escalas. Del tamaño de la ResNet-50.
? [medio] Estos 16 bits son un FP16: 0 10010 0101000000. ¿Qué número es?
- Signo 0: positivo.
- Exponente: 10010₂ = 16 + 2 = 18. Menos el sesgo de FP16, que es 15: **3**.
- Mantisa: 1.0101₂ = 1 + 1/4 + 1/16 = **1.3125**.
- Valor: 1.3125 × 2³ = 1.3125 × 8 = **10.5**.
? [medio] Una capa tiene pesos entre −4 y 4. Con INT8 simétrico, ¿cuál es la escala? ¿Cómo se guardan 1.0 y 0.03, cómo vuelven y qué error tiene cada uno en proporción?
- Escala: 4 ÷ 127 ≈ **0.0315**.
- 1.0 ÷ 0.0315 = 31.75 → **32**; de vuelta, 32 × 0.0315 ≈ 1.0079: error de 0.0079, **0.8 %**.
- 0.03 ÷ 0.0315 = 0.95 → **1**; de vuelta, ≈ 0.0315: error de 0.0015, **5 %**.
- El error de los dos está debajo de media escala (≈ 0.0157), pero en proporción el número chico sale mucho peor. Por eso importan las escalas por canal o por grupo.
? [medio] Con la escala de pérdida en 65,536, un gradiente real de 3 sale escalado en el backward en FP16. ¿Qué pasa? Si el mismo gradiente se repitiera, ¿cuántos pasos se saltaría GradScaler antes de que quepa?
- 3 × 65,536 = 196,608, más que 65,504: **`inf`**. GradScaler salta el paso y baja la escala a 32,768.
- 3 × 32,768 = 98,304: otra vez `inf`. Salta otro paso; la escala baja a 16,384.
- 3 × 16,384 = 49,152: **cabe**. Se saltaron **2 pasos**, y los pesos no se tocaron en ninguno.
? [medio] Llama 3 8B tiene ≈ 8.03 mil millones de parámetros. ¿Cuánto pesa en BF16? Una L4 lee 300 GB por segundo de su memoria y, para cada token nuevo, relee todos los pesos: ¿cuántos tokens por segundo da como máximo? ¿Y en INT8?
- BF16: 8.03 × 10⁹ × 2 B ≈ **16.06 GB**.
- Máximo: 300 ÷ 16.06 ≈ **18.7**, unos 19 tokens por segundo por conversación.
- INT8: 8.03 GB, y 300 ÷ 8.03 ≈ **37** tokens por segundo: el doble, porque se leen la mitad de bytes. Son los números de M04.
? [reto] Un LLM de 70,600 millones de parámetros va en INT4, con grupos de 128 pesos y una escala FP16 por grupo. (a) ¿Cuántos bits ocupa cada peso, contando su parte de la escala? (b) ¿Cuántos GB pesan los pesos? (c) ¿Caben en una H100 de 80 GB, si vLLM usa el 90 % de la memoria? ¿Y en BF16?
- (a) 4 bits + 16 bits ÷ 128 = 4 + 0.125 = **4.125 bits**, es decir, 0.515625 bytes.
- (b) 70.6 × 10⁹ × 0.515625 B ≈ **36.4 GB**.
- (c) vLLM usa 0.9 × 80 = 72 GB; quedan 72 − 36.4 ≈ **35.6 GB** para el runtime y el KV cache: **sí cabe**, con margen. En BF16 son ≈ 141 GB: no caben ni en una ni, dejando lugar para el KV cache, en dos.
? [reto] Diseña el contador de fotos de C01. Al pico de diseño, 500 fotos por segundo sin parar: ¿en cuántos días da la vuelta un int32? ¿Y un uint32? ¿En cuántas horas se atora un float32? ¿Qué tipo eliges?
- int32: 2,147,483,647 ÷ 500 ÷ 86,400 ≈ **49.7 días**.
- uint32: 4,294,967,295 ÷ 500 ÷ 86,400 ≈ **99.4 días**.
- float32: 16,777,216 ÷ 500 ≈ 33,554 segundos ≈ **9.3 horas**.
- Elijo **int64**: 9.2 × 10¹⁸ ÷ 500 da ≈ 585 millones de años. O FP64, como Prometheus: 2⁵³ ÷ 500 da ≈ 570,000 años de enteros exactos.
? [reto] La paridad del engine FP16 de C01 da 99.2 % de acuerdo en el top-1, con 10,000 fotos. ¿Cuántas fotos cambiaron? ¿Pasa el examen? ¿Qué revisas, y en qué orden?
- Cambiaron 0.8 % de 10,000 = **80 fotos**. El examen permite 50: **no pasa**.
- FP16 en una CNN suele pasar el 99.5 % con holgura, así que sospecha de un bug, no del formato. Primero, el ONNX en FP32 con ONNX Runtime: si ahí ya falla, el problema está en el export (preprocesamiento distinto, una capa mal convertida, el orden de las categorías).
- Si el ONNX pasa y el engine no, busca la capa cuyas salidas se separan comparando las intermedias, y déjala en FP32: puede ser un overflow de FP16. Revisa también si la diferencia máxima de logits es ≈ 0.01 o mucho más.
- Lo que nunca se hace: bajar el umbral para que pase.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M01 · El mapa y la entrevista** trae la primera tabla de bytes y avisa que la precisión (FP16 o INT8) mueve la factura más que la arquitectura del modelo.
- **M04 · Hardware para inferencia** arranca con «parámetros × bytes por parámetro» y su tabla de dtypes, con la GPU que soporta cada uno, explica por qué BF16 le ganó a FP16 en los LLMs y suma las activaciones y el KV cache a la memoria de la GPU.
- **M08 · Optimización de modelos** cuantiza la ResNet-50 de C01 (98 MB → 25.1 MB), explica la escala por canal, el punto cero, la calibración, PTQ y QAT, y arma el examen: paridad, slices y latencia.
- **M14 · Sistemas con LLMs** elige el formato de un LLM en producción: BF16, FP8, INT8 o INT4 *weight-only* (AWQ, GPTQ), y el KV cache en FP8.
- **Los casos.** C01 (engine FP16, entrada en uint8 como mejora, INT8 en CPU por medir), C10 (70B en FP8 sobre 2 H100) y C02 (FP16 en el edge, INT8 calibrado con frames de día y de noche).

**En el Dojo:** la estación 5, «Export, engine y paridad», es esta lección hecha código: exportar la ResNet-50 a ONNX en FP32, construir el engine FP16 y correr la prueba de paridad. Cuando abra, ahí la vas a practicar. La estación 7, «Empaquetado», ya usa la cuenta de los pesos en FP16 para decidir que el modelo puede ir dentro de la imagen de Docker.

**En Sensei:** la siguiente lección, «Matrices, FLOPs y qué tan rápido calcula una GPU», usa los bytes de esta lección para saber si un modelo está limitado por las cuentas o por la memoria. Después, «Memoria, caché y disco» y «CPU y GPU» abren la máquina donde viven estos bytes, y «PyTorch en lo que toca a producción» vuelve a los dtypes, a `autocast` y a la paridad con código de verdad.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
binario entero overflow punto-flotante fp16 bf16 dtype redondeo precision-mixta fp8 cuantizacion int8 int4
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un uint8 llega hasta 255 y un int8 solo hasta 127?
Con 8 bits hay 2⁸ = 256 combinaciones. Sin signo van del 0 al 255. Con signo, el primer bit vale −128, y quedan de −128 a 127.
? ¿Qué da 250 + 10 en un arreglo uint8 de NumPy, y por qué?
4. El resultado, 260, no cabe en 8 bits: se pierde el noveno bit y queda 260 − 256 = 4. NumPy da la vuelta sin avisar.
? Si FP16 y BF16 ocupan 2 bytes, ¿en qué se diferencian?
FP16 tiene 5 bits de exponente y 10 de mantisa: ≈ 3 cifras, pero su máximo es 65,504. BF16 tiene 8 y 7: el rango de FP32 con 2 o 3 cifras. BF16 no se desborda donde FP32 no lo haría, y por eso es el formato de los LLMs.
? ¿Por qué 0.1 + 0.2 no da exactamente 0.3 en Python?
Porque 0.1 y 0.2 no tienen una escritura finita en binario: se guardan redondeados y los errores se suman. Python usa FP64 y da 0.30000000000000004. Los números de punto flotante se comparan con tolerancia, no con ==.
? En la precisión mixta, ¿para qué sirven la copia maestra en FP32 y la escala de la pérdida?
La copia maestra evita que los cambios chicos se pierdan (en FP16, 1 + 0.0001 da 1). La escala evita que los gradientes diminutos se vuelvan 0: se multiplica la pérdida por 65,536 y los gradientes se dividen antes de actualizar.
? Una capa tiene pesos de −2.5 a 2.5. ¿Cómo se guarda 0.1 en INT8, y qué pasa si aparece un peso de 25?
Con escala 2.5 ÷ 127 ≈ 0.0197, el 0.1 se guarda como 5 y vuelve como 0.0984. Con un 25, la escala sube a ≈ 0.197: el 0.1 se guarda como 1 y vuelve como 0.197, con 97 % de error. Por eso hay escalas por canal o por grupo.
? ¿Cuánto pesan los pesos de un modelo de 70B en FP16, en INT8 y en INT4? ¿Cabe en una H100 de 80 GB?
140 GB, 70 GB y 35 GB. En FP16 no cabe; en INT8 o FP8 caben los pesos, pero casi no queda lugar para el KV cache; en INT4 sobra espacio.
:::
