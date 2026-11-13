---
titulo: Ruido, muestras y pruebas A/B
en: Noise, samples and A/B tests
subtitulo: Por qué un 85 % medido con 1,000 fotos podría haber salido 83 u 87, cómo se calcula cuánto se mueve un número así y cómo se decide con una prueba A/B si un modelo nuevo de verdad es mejor o solo tuvo suerte.
pregunta: El modelo nuevo saca 0.2 puntos más que el actual. ¿Es mejor de verdad o fue suerte?
requisitos: probabilidad
---

:::idea
Todo número que se mide con una muestra trae ruido: con otras fotos al azar habría salido un poco distinto. La estadística dice cuánto (el error estándar, que baja con la raíz del número de datos) y da reglas para no confundir ese ruido con una mejora: intervalos de confianza, pruebas A/B y p-values bien leídos.
:::

## Muestra, población y dispersión {Sample, population and spread}

Empecemos con una escena de Alba, la empresa que seguimos en todo el curso. Alba es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y, para cada foto, le sugiere a quien vende la categoría, entre 500 posibles. El equipo entrena un modelo nuevo, lo examina con 1,000 fotos etiquetadas por personas y el modelo acierta en 850: una [[accuracy]] de 85 %. Alguien pregunta en la junta: «¿entonces el modelo acierta el 85 %?».

La respuesta honesta es «más o menos». Con otras 1,000 fotos al azar habría salido 84 %, 86 % u 85.4 %, con exactamente el mismo modelo: solo cambian las fotos que tocaron. Esta lección trata de esa diferencia: de dónde sale, cuánto mide y cómo decidir sin que te engañe.

Una convención para todo lo que sigue: cuando un porcentaje cambia, la diferencia se cuenta en [[punto-porcentual|puntos porcentuales]], o simplemente «puntos». De 85 % a 86 % hay 1 punto. Y «±» se lee «más o menos».

### La población y la muestra

Lo que de verdad quieres saber es qué tan bien le va al modelo con **todas** las fotos que van a subir los vendedores. Ese conjunto completo es la [[poblacion|población]] (*population*), y tiene una accuracy exacta, un número fijo. Pero nadie la puede medir: son millones de fotos, siguen llegando, y etiquetar cada una cuesta dinero y tiempo de una persona.

Por eso se mide una parte, una [[muestra]] (*sample*). Las 1,000 fotos del examen son una muestra, y su 85 % es una **estimación** del número de la población. Para que una muestra sirva, una regla manda sobre todas: que se elija **al azar**, con la misma oportunidad de entrar para cada foto.

Si la muestra es al azar, su error es puro ruido: a veces de más, a veces de menos, y con más fotos se achica. Si se eligió con un criterio que tiene que ver con lo que mides, el error es un **sesgo**: empuja siempre hacia el mismo lado y no se arregla con más fotos.

| Qué fotos | Qué error trae | ¿Más fotos lo arreglan? |
|---|---|---|
| Al azar, de todas | Ruido: de más o de menos | Sí: con 4 veces más fotos, la mitad del ruido |
| Solo de la web | Sesgo: el celular puede ir peor | No |
| Solo las que el vendedor aceptó | Sesgo: justo las que el modelo acertó | No |

:::ojo
**Más datos no arreglan una muestra sesgada.** Millones de respuestas sesgadas pierden contra unos miles elegidas al azar. El caso más famoso, una encuesta de 1936 con 2.4 millones de respuestas, está en «En la vida real».
:::

### Cinco exámenes, cinco números

Hagamos el experimento que en la vida real nadie hace, porque cuesta mucho: examinar al mismo modelo cinco veces, cada vez con 100 fotos distintas al azar. Supón que en toda la población acierta exactamente el 85 %. Los cinco exámenes dan 81 %, 89 %, 85 %, 82 % y 88 %. (Son números inventados, pero del tamaño que de verdad salen; en la siguiente sección lo comprueba una simulación.)

:::figura ruido-muestras
Arriba, la población: todas las fotos, y el 85 % que el modelo acierta. Abajo, cinco exámenes de 100 fotos al azar. Cada uno da otro número, aunque el modelo es el mismo.
:::

Ninguno de los cinco está mal: cada uno midió bien **sus** 100 fotos. La variación entre ellos es lo que aquí llamamos **ruido** (*noise*): la parte del resultado que depende de qué fotos te tocaron y no del modelo. ¿Cuánto se dispersan? Para eso hay una cuenta.

### Varianza y desviación estándar

Primero, el [[promedio]] de los cinco: (81 + 89 + 85 + 82 + 88) ÷ 5 = 425 ÷ 5 = 85. Después, qué tan lejos queda cada uno del promedio: −4, +4, 0, −3 y +3.

Si promedias esas distancias tal cual, da 0, porque las de arriba y las de abajo se cancelan: el promedio está justo en medio, siempre. Por eso se elevan al cuadrado. Así todas quedan positivas, y una distancia grande pesa más que dos chicas (4² = 16, mientras que 2² + 2² = 8). El promedio de los cuadrados es la [[varianza]] (*variance*). Su raíz es la [[desviacion-estandar|desviación estándar]] (*standard deviation*), que regresa a las unidades originales: puntos de accuracy, no «puntos al cuadrado».

:::formula Promedio, varianza y desviación estándar
μ = frac{x_1 + x_2 + … + x_n}{n}
σ^2 = frac{(x_1 − μ)^2 + … + (x_n − μ)^2}{n}
σ = sqrt{σ^2}
- x_1, …, x_n: los números que mides; aquí, los resultados de los cinco exámenes, en %
- n: cuántos números son; aquí, 5
- μ: su promedio (la letra griega mu), en %
- σ^2: la varianza: el promedio de las distancias al promedio, elevadas al cuadrado, en puntos²
- σ: la desviación estándar (la letra griega sigma), en puntos
:::

:::cuenta Qué tanto se dispersan cinco exámenes
Promedio \(μ\) // la suma entre \(n\) = 5 | (81 + 89 + 85 + 82 + 88) ÷ 5 = 425 ÷ 5 | 85
Distancias al promedio \(x_i − μ\) | 81 − 85, 89 − 85, 85 − 85, 82 − 85, 88 − 85 | −4, +4, 0, −3, +3
Al cuadrado \((x_i − μ)^2\) | (−4)², 4², 0², (−3)², 3² | 16, 16, 0, 9, 9
Varianza \(σ^2\) // el promedio de los cuadrados | (16 + 16 + 0 + 9 + 9) ÷ 5 = 50 ÷ 5 | 10 puntos²
Desviación estándar \(σ\) // de vuelta a puntos | \(σ = sqrt{σ^2}\) = √10 | **≈ 3.2 puntos**
= Un examen de 100 fotos suele caer a unos 3 puntos del promedio. Si mañana sale 82 %, eso no dice que el modelo empeoró: es una distancia normal.
:::

La desviación estándar se escribe σ (sigma) y se lee como «la distancia típica al promedio». Con ella ya contestas mejor en la junta: «85 %, y un examen de 100 fotos se mueve unos 3 puntos».

¿Por qué cuadrados y no las distancias sin signo? Por una propiedad que vas a usar en toda la lección: **las varianzas de cosas independientes se suman**. Si dos números se mueven cada uno por su lado (son [[independencia|independientes]]: lo que sale en uno no cambia el otro), la varianza de su suma, y también la de su resta, es la suma de sus varianzas. Con las distancias sin signo eso no pasa. Gracias a eso, en la siguiente sección se calcula el ruido de un examen sin repetirlo.

:::nota Ya la viste
En «Datos, ejemplos, features y etiquetas», estandarizar un monto era restarle el promedio y dividir entre la desviación estándar: allá decía qué tan raro es un pago; aquí, qué tan raro es el resultado de un examen.
:::

:::profundo ¿Entre 5 o entre 4?
Hay dos versiones de la varianza. La de arriba divide entre n, el número de datos: 50 ÷ 5 = 10. Muchas calculadoras, y Python, dividen entre n − 1: 50 ÷ 4 = 12.5, con desviación √12.5 ≈ 3.54.

¿Por qué? Las distancias se midieron contra el promedio de **estos mismos cinco** números, que por construcción queda justo en medio de ellos. Contra el promedio verdadero de la población, que no conoces, serían en general un poco más grandes. Dividir entre n − 1 compensa eso; se llama corrección de Bessel. Con 5 datos la diferencia se nota; con miles desaparece.

La regla práctica: si tus números son **toda** la población, divide entre n; si son una muestra y quieres estimar la dispersión de la población, divide entre n − 1. En Python:

```python
import statistics

examenes = [81, 89, 85, 82, 88]          # % de aciertos en 5 exámenes de 100 fotos
print("promedio:", statistics.mean(examenes))
print("entre n:    ", statistics.pvariance(examenes), round(statistics.pstdev(examenes), 2))
print("entre n − 1:", statistics.variance(examenes), round(statistics.stdev(examenes), 2))
```

```salida
promedio: 85
entre n:     10 3.16
entre n − 1: 12.5 3.54
```
:::

## La campana y el error estándar {The bell curve and the standard error}

¿Y si repites el examen no cinco veces, sino mil? Con una computadora se puede: se simula un modelo que acierta el 85 % y se le toman muchos exámenes con fotos al azar. Con exámenes de 1,000 fotos, los resultados se amontonan cerca de 85 y se vuelven raros hacia los lados, con una forma muy particular.

:::figura ruido-campana
Arriba, cómo se reparten muchos exámenes de 1,000 fotos: una campana centrada en 85 %. Abajo, el ancho de lo que puede salir por azar con cuatro tamaños de examen.
:::

### La forma que toman los promedios

Esa forma se llama [[distribucion-normal|distribución normal]] (*normal distribution*), o campana de Gauss. Una [[distribucion]] dice cómo se reparten unos valores: cuáles salen seguido y cuáles casi nunca. La normal queda definida por dos números: su centro (el promedio) y su ancho (la desviación estándar).

¿Por qué aparece? El resultado de un examen es el promedio de 1,000 piezas chiquitas: cada foto vale 1 si el modelo acierta y 0 si falla, y cada una se eligió sin importar las demás. Cuando muchas piezas pequeñas e independientes se suman, los golpes de suerte para arriba y para abajo se compensan, y lo más común es quedar cerca del centro; para irse a una orilla, casi todas tendrían que salir del mismo lado. Que esa suma tome justo la forma de campana, sin importar cómo se reparta cada pieza, es el **teorema del límite central**. Por él, casi todo lo que se mide como promedio de muchos datos (una accuracy, una tasa de aceptación, la diferencia entre dos grupos) tiene forma de campana.

:::ojo
**Lo que se vuelve campana es el promedio, no cada dato.** Una foto suelta vale 0 o 1: nada que ver con una campana. Las latencias de un servidor tampoco: tienen una cola larga hacia la derecha, como viste en la lección de percentiles. Por eso esta lección habla siempre del resultado de un examen, no de cada foto.
:::

### La regla 68–95–99.7

En cualquier campana, lo que cae cerca del centro se cuenta en desviaciones estándar, y siempre da lo mismo:

| A cuántas desviaciones del centro | Qué parte de los resultados cae ahí |
|---|---|
| 1 | ≈ 68 %: dos de cada tres |
| 2 | ≈ 95 %: 19 de cada 20 |
| 3 | ≈ 99.7 %: casi todo |

Para ser exactos, el 95 % queda a 1.96 desviaciones (a 2 hay 95.4 %); en la práctica se usan los dos. Con exámenes de 1,000 fotos la desviación es de 1.1 puntos (ahorita la calculamos), así que dos de cada tres exámenes caen entre 83.9 % y 86.1 %, y 19 de cada 20, entre 82.7 % y 87.3 %. Un examen que diera 80 % quedaría a más de 4 desviaciones del 85: eso ya no es mala suerte, algo cambió.

### El error estándar

La desviación estándar del **resultado** de un examen (no de cada foto) tiene nombre propio, porque se usa muchísimo: [[error-estandar|error estándar]] (*standard error*, SE). Contesta «¿cuánto se movería este número si repitiera la medición con otra muestra?», y no hace falta repetir el examen para saberlo: sale de una cuenta en tres pasos.

:::pasos
1. Una foto
Vale 1 con probabilidad p = 0.85 y 0 con probabilidad 0.15. Su promedio es 0.85, y su varianza es p × (1 − p) = 0.85 × 0.15 = 0.1275. Compruébalo con la definición: el 85 % de las veces la distancia al promedio es 0.15, y el 15 % de las veces, −0.85. Entonces 0.85 × 0.15² + 0.15 × 0.85² = 0.0191 + 0.1084 = 0.1275.
2. La suma de n fotos
Las fotos se eligieron independientes, así que sus varianzas se suman: la cantidad de aciertos tiene varianza n × 0.1275.
3. El promedio
El resultado del examen es esa cantidad dividida entre n. Dividir todos los números entre n divide las distancias entre n, y sus cuadrados entre n², así que la varianza queda en n × 0.1275 ÷ n² = 0.1275 ÷ n.
:::

La raíz de eso es el error estándar de una proporción. Y como el 95 % de una campana cae a menos de 1.96 desviaciones del centro, el margen de 95 % mide 1.96 errores estándar:

:::formula Error estándar y margen de una proporción
SE = sqrt{frac{p × (1 − p)}{n}}
m = 1.96 × SE
- p: la proporción medida, como fracción de 0 a 1: 0.85 para 85 %
- n: cuántos datos tiene la muestra; aquí, las fotos del examen
- SE: el error estándar (*standard error*), como fracción: 0.0113 son 1.13 puntos
- m: el margen de 95 %, como fracción: en 19 de cada 20 muestras, el resultado cae a menos de \(m\) del valor verdadero
:::

En la vida real no conoces el p verdadero, así que pones el que mediste. Con cientos de fotos, el que mediste está lo bastante cerca para que la cuenta casi no cambie.

:::cuenta El ruido de un 85 % medido con 1,000 fotos
Varianza de una foto \(p × (1 − p)\) // vale 1 o 0; \(p\) = 0.85 | 0.85 × 0.15 | 0.1275
Varianza del resultado \(p × (1 − p) ÷ n\) // \(n\) = 1,000 fotos | 0.1275 ÷ 1,000 | 0.0001275
Error estándar \(SE\) // la raíz de la fila de arriba | √0.0001275 ≈ 0.0113 | **≈ 1.1 puntos**
Margen de 95 % \(m\) | \(m = 1.96 × SE\) = 1.96 × 1.13 | **≈ ±2.2 puntos**
= El 85 % de la junta en realidad dice «entre 82.8 % y 87.2 %». Un modelo que diera 84 % con otras 1,000 fotos podría ser exactamente el mismo.
:::

### El ruido baja con la raíz de n

Fíjate dónde quedó n: adentro de una raíz. Eso tiene una consecuencia enorme: **el ruido baja con la raíz del número de datos**. Para la mitad del ruido necesitas 4 veces las fotos; para la décima parte, 100 veces.

| Fotos en el examen, \(n\) | Error estándar \(SE\), con \(p\) = 0.85 | Margen de 95 %, \(m = 1.96 × SE\) |
|---|---|---|
| 100 | 3.6 puntos | ± 7.0 |
| 1,000 | 1.1 | ± 2.2 |
| 4,000 | 0.56 | ± 1.1 |
| 50,000 (el [[golden-set\|golden set]] de Alba, su examen fijo de fotos etiquetadas) | 0.16 | ± 0.3 |

Mira la primera fila: con 100 fotos, la fórmula dice 3.6 puntos. Los cinco exámenes de la sección anterior, inventados de ese tamaño a propósito, se dispersaron 3.5 (dividiendo entre n − 1). La fórmula da ese número sin repetir nada.

Comprobémoslo en Python. El código simula 2,000 exámenes de cada tamaño con un modelo que acierta 85 % y mide cuánto se dispersan los resultados:

```python
import random, statistics

random.seed(7)
P = 0.85                 # lo que de verdad acierta el modelo (en la vida real no lo sabes)

def examen(n):
    """Toma n fotos al azar y devuelve el % de aciertos."""
    aciertos = sum(random.random() < P for _ in range(n))
    return 100 * aciertos / n

for n in [100, 1000, 4000]:
    resultados = [examen(n) for _ in range(2000)]      # 2,000 exámenes distintos
    de = statistics.stdev(resultados)
    dentro = sum(abs(r - 85) <= 2 * de for r in resultados) / len(resultados)
    print(f"n = {n:5}  promedio = {statistics.mean(resultados):.2f} %"
          f"  desviación = {de:.2f} puntos  a menos de 2 desviaciones: {dentro:.1%}")
print("la fórmula:", [round(100 * (P * (1 - P) / n) ** 0.5, 2) for n in [100, 1000, 4000]])
```

```salida
n =   100  promedio = 84.99 %  desviación = 3.62 puntos  a menos de 2 desviaciones: 95.9%
n =  1000  promedio = 84.96 %  desviación = 1.14 puntos  a menos de 2 desviaciones: 94.9%
n =  4000  promedio = 85.02 %  desviación = 0.57 puntos  a menos de 2 desviaciones: 95.1%
la fórmula: [3.57, 1.13, 0.56]
```

La dispersión simulada coincide con la fórmula, y en los tres tamaños ≈ 95 % de los exámenes caen a menos de dos desviaciones del 85: la regla 68–95–99.7 en acción. (Con 100 fotos sale un poco más, 95.9 %, porque los resultados solo pueden ser números enteros: 81, 82, 83…)

:::calculadora ruido-proporcion
Empieza en el examen de la junta: 85 % con 1,000 fotos. Pon 4,000 y el margen baja a la mitad.
:::

## Intervalos de confianza {Confidence intervals}

Decir «85 %» a secas esconde el ruido. Decir «85 % ± 2.2» lo muestra. Ese rango, de 82.8 % a 87.2 %, es un [[intervalo-confianza|intervalo de confianza]] (*confidence interval*) de 95 %, y se arma con la receta de la sección anterior: lo que mediste, más y menos el margen.

**\(p ± m\)**, con \(m = 1.96 × SE\) (≈ ±2 errores estándar). Aquí: 85 ± 2.2, de 85 − 2.2 = 82.8 % a 85 + 2.2 = 87.2 %.

En la lección «¿Aprendió de verdad?» viste que el gate de Alba (el examen que decide si un modelo nuevo reemplaza al actual) no le pide al modelo nuevo «sacar más» que el actual, sino «no sacar menos» por más de 0.3 puntos. De aquí sale ese 0.3: es el margen de un examen de 50,000 fotos. Exigir «más que el actual» al décimo de punto sería decidir con ruido.

### Lo que sí significa

El 95 % no es una propiedad de un intervalo en particular: **es de la receta**. Si sacaras 20 muestras distintas y armaras un intervalo con cada una, ≈ 19 atraparían el valor verdadero y ≈ 1 no. Con tu única muestra no sabes si te tocó uno de los 19 o el 1; sabes que la receta acierta 19 de cada 20 veces.

:::figura ruido-intervalos
Veinte muestras simuladas de 1,000 fotos de un modelo que acierta 85 %, cada una con su intervalo de 95 %. Todos se mueven; uno no alcanza a cruzar el valor verdadero.
:::

### Lo que no significa

Las lecturas equivocadas más comunes, de la más grave a la más fina:

1. **«El modelo va a dar entre 82.8 % y 87.2 % en producción.»** No. El intervalo solo cubre el azar de qué fotos entraron a la muestra. Si en producción llegan otras fotos (es temporada de regreso a clases y suben mochilas), la población cambió: es [[drift]], y el intervalo no dice nada de eso.
2. **«El intervalo cubre todos los errores.»** No. Si la muestra está sesgada (solo fotos de web) o las etiquetas tienen errores ([[ruido-etiquetas|ruido en las etiquetas]]), el intervalo sale igual de angosto y está mal. Solo mide el ruido; el sesgo hay que buscarlo aparte.
3. **«El 95 % de las fotos están entre 82.8 % y 87.2 %.»** No tiene sentido: cada foto es acierto o fallo. El intervalo habla del promedio, no de las fotos.
4. **«Si los intervalos de dos modelos se enciman, no hay diferencia.»** No necesariamente. Comparar dos intervalos no es la forma correcta de comparar dos modelos, y menos si los examinaron con las mismas fotos; eso lo arregla la prueba pareada, en la sección extra «¿Es real una mejora de 0.2 puntos?».
5. **«Hay 95 % de probabilidad de que el valor verdadero esté en este intervalo.»** En sentido estricto, tampoco. El valor verdadero no se mueve: está adentro o afuera de tu intervalo, y no lo sabes. El 95 % habla de la receta, como en la figura. Mucha gente lo dice así sin causar daño; los que sí lo causan son los cuatro de arriba.

## La prueba A/B {The A/B test}

Hasta aquí medimos al modelo con fotos etiquetadas, sin que nadie lo use: es lo que hace el gate de Alba. Pero al negocio le importa que los vendedores **acepten** las sugerencias: la **tasa de aceptación**, la fracción de publicaciones en que el vendedor eligió una de las categorías sugeridas, hoy ≈ 70 %. Eso solo se ve con gente real. En la lección «¿Aprendió de verdad?» viste un ejemplo con los números de Alba: un modelo nuevo gana 1.5 puntos de [[top-k-accuracy|top-5]] en el golden set y, con vendedores reales, la tasa de aceptación **baja** 0.4 puntos.

### ¿Por qué no comparar antes y después?

Lo obvio sería poner el modelo nuevo el lunes y comparar la aceptación de esta semana con la de la pasada. Pero entre una semana y otra cambian muchas cosas además del modelo: empieza el regreso a clases o el Buen Fin, sale una campaña, la app cambia un botón, cae un puente. Si la aceptación sube, no hay forma de saber cuánto fue el modelo.

### Dos grupos al mismo tiempo, repartidos al azar

Una [[ab-test|prueba A/B]] (*A/B test*) reparte al azar a los usuarios en dos grupos, que funcionan **al mismo tiempo**:

- **A, el control:** recibe lo de siempre, el modelo actual.
- **B, el tratamiento:** recibe el cambio, el modelo nuevo.

Cada grupo se llama **brazo** (*arm*). Como los dos corren la misma semana, el regreso a clases y la campaña les tocan a los dos. Y como el reparto es al azar, todo lo demás (vendedores grandes y chicos, de celular y de web, de Monterrey y de Mérida) queda repartido parejo, incluso lo que no se te ocurrió medir. La única diferencia sistemática entre A y B es el modelo. Por eso, si B acepta más, el modelo **causó** la diferencia, y no solo coincidió con ella. Lo que queda es el ruido, y de eso se encarga la siguiente sección.

## Hipótesis nula, p-value y significancia {Null hypothesis, p-value and significance}

Supón que el A/B de Alba junta 33,000 publicaciones por brazo, el mínimo que pide su cuenta de tamaño (la ves en la siguiente sección). En A, los vendedores aceptaron la sugerencia en 23,100 (70.0 %); en B, en 23,430 (71.0 %). Un punto de diferencia. ¿Es el modelo, o es ruido?

### Suponer que no pasó nada

La estadística contesta con un truco que parece al revés. En lugar de demostrar que B es mejor, supone lo contrario: que los dos modelos son igual de buenos y el punto de diferencia salió por azar. Esa suposición es la [[hipotesis-nula|hipótesis nula]] (*null hypothesis*), y se escribe H0 («hache cero»). Después pregunta: **si H0 fuera cierta, ¿qué tan raro sería ver una diferencia así de grande?** Si sería rarísimo, se descarta H0: la diferencia es real.

:::analogia Un juicio
En un juicio, el acusado es inocente hasta que se demuestre lo contrario: la inocencia es la hipótesis nula. Solo se le declara culpable si la evidencia sería muy difícil de explicar siendo inocente. Si no alcanza, sale «no culpable», que no es lo mismo que «inocente»: puede que faltaran pruebas. Con H0 pasa igual: no rechazarla no demuestra que no haya efecto.

**Dónde se rompe:** un jurado no calcula una probabilidad ni fija de antemano cuánta duda acepta; una prueba sí, y lo escribe antes de ver los datos. Y un jurado pesa toda la evidencia, mientras que la prueba solo mira un número: no sabe si el experimento estuvo mal hecho, por ejemplo con un reparto roto.
:::

### La cuenta: cuántos errores estándar mide la diferencia

Si H0 fuera cierta, los dos brazos tendrían la misma tasa, y su mejor estimación es juntarlos: 70.5 %. La tasa de cada brazo es un promedio de 33,000 publicaciones, con varianza p × (1 − p) ÷ n, y como los brazos son independientes, la varianza de su **diferencia** es la suma de las dos. La diferencia dividida entre su error estándar se llama **z**: cuántos errores estándar mide.

:::formula Prueba z de dos proporciones
p_0 = frac{a_A + a_B}{2n}
SE_d = sqrt{2 × frac{p_0 × (1 − p_0)}{n}}
z = frac{p_B − p_A}{SE_d}
- n: unidades en cada brazo; aquí, 33,000 publicaciones
- a_A, a_B: cuántas unidades de cada brazo hicieron lo que mides (sus «aciertos»); aquí, cuántos vendedores aceptaron la sugerencia
- p_A, p_B: la tasa de cada brazo: \(p_A = a_A ÷ n\) y \(p_B = a_B ÷ n\)
- p_0: la tasa con los dos brazos juntos: la que tendrían los dos si H0 fuera cierta
- SE_d: el error estándar de la diferencia \(p_B − p_A\): la suma de las dos varianzas, bajo la raíz
- z: cuántos errores estándar mide la diferencia. El p-value es la parte de la campana que queda más lejos que \(z\) del centro, de los dos lados
:::

:::cuenta ¿El punto de diferencia es ruido?
Tasa de cada brazo \(p_A\) y \(p_B\) | 23,100 ÷ 33,000 y 23,430 ÷ 33,000 | 70.0 % y 71.0 %
Diferencia \(p_B − p_A\) | 71.0 − 70.0 | 1.0 punto
Tasa juntando los brazos \(p_0\) // la que tendrían los dos si H0 fuera cierta | (23,100 + 23,430) ÷ 66,000 | 0.705
Varianza de un brazo \(p_0 × (1 − p_0) ÷ n\) | 0.705 × 0.295 ÷ 33,000 | 0.0000063
Error estándar de la diferencia \(SE_d\) // las varianzas de los dos brazos se suman | √(2 × 0.0000063) ≈ 0.00355 | 0.355 puntos
z // cuántos errores estándar mide la diferencia | \(z = (p_B − p_A) ÷ SE_d\) = 1.0 ÷ 0.355 | **≈ 2.8**
p-value // las dos orillas de la campana; se lee en una tabla de la normal o con `NormalDist` de Python | lo que queda a más de 2.8 desviaciones del centro | **≈ 0.005**
= Si los dos modelos fueran iguales, una diferencia de un punto o más, para cualquier lado, saldría ≈ 1 vez de cada 200 experimentos como este. Lo más razonable es que no sea ruido.
:::

### Qué es el p-value, y qué no

Ese último número es el [[p-value]] (*p-value*, o valor p): **si no hubiera ningún efecto, la probabilidad de ver una diferencia al menos tan grande como la que viste, solo por azar.** Se cuentan las dos orillas de la campana porque, antes de ver los datos, B podía salir mejor o peor; a eso se le llama una prueba de **dos colas**.

El p-value es una de las ideas que más se leen mal en todo el oficio. Con p-value = 0.005:

- **No** es «hay 0.5 % de probabilidad de que B no sirva», ni «hay 99.5 % de probabilidad de que B sea mejor».
- **No** es la probabilidad de que H0 sea cierta, ni la de que «el resultado sea por azar».
- **No** dice qué tan grande es el efecto. Un efecto diminuto, con muchísimos datos, da un p-value chiquito.

Lo que sí dice es qué tan **sorprendentes** serían los datos si no pasara nada. ¿Por qué no es lo mismo que «la probabilidad de que B funcione»? Porque eso depende también de qué tan probable era que B funcionara antes de probarlo.

:::ejemplo Por qué un p-value < 0.05 no quiere decir «95 % de seguridad»
Un equipo prueba 100 ideas en un año. Supón que solo 10 de verdad mejoran algo y las otras 90 no hacen nada. Con [[potencia]] de 80 % (la siguiente sección), de las 10 buenas detecta 8. De las 90 inútiles, el 5 % sale «significativa» por azar: 4.5 en promedio. En total, ≈ 12.5 ideas salen «significativas», y 4.5 de ellas son falsas alarmas: **36 %**, aunque cada una tuvo p-value < 0.05.
:::

### La significancia: el corte se fija antes

Falta decidir qué tan chico tiene que ser el p-value. Ese corte es la [[significancia]] (*significance level*), se escribe α (alfa) y casi siempre vale 0.05. Si el p-value queda abajo, el resultado es **estadísticamente significativo** y se rechaza H0. Con 0.005 < 0.05, B le gana a A.

α es también la tasa de falsas alarmas que aceptas. Si no hay ningún efecto, el 5 % de los experimentos lo «encuentra» de todas formas. Pasa hasta en un **A/A**, con el mismo modelo en los dos brazos. Una prueba es, en el fondo, un clasificador de experimentos: dice «hay efecto» o «no hay efecto», y se equivoca de las dos formas que ya conoces de la lección «¿Aprendió de verdad?». Declarar un efecto que no existe es un [[falso-positivo]] (en estadística, **error tipo I**); no ver uno que sí existe, un [[falso-negativo]] (**error tipo II**).

:::diagrama ruido-prueba
La lógica de una prueba, en tres recorridos: un A/B con efecto, un A/A donde no hay nada, y un A/B demasiado chico. Toca cada caja para leer su nota.
:::

:::ojo
**Significativo no es importante.** Con 10 millones de publicaciones por brazo, una diferencia de 0.05 puntos de aceptación da p-value ≈ 0.015: significativa, y casi seguro inútil para el negocio. Decide con el tamaño del efecto y su intervalo, no solo con el p-value.
:::

## Diseñar el A/B: cuántos, a quién y cuánto tiempo {Designing the A/B test: how many, whom and how long} [extra]

Un A/B se diseña antes de prenderlo, y el diseño contesta tres preguntas: **cuántas** unidades hacen falta, **a quién** se sortea y **cuánto tiempo** corre.

### El mismo punto, con menos datos

Ahora imagina que alguien se saltó la cuenta de tamaño y corrió el A/B con 5,000 publicaciones por brazo: 70.0 % contra 71.0 %, el mismo punto de diferencia. Con las mismas fórmulas, el error estándar de la diferencia crece a \(SE_d\) = √(2 × 0.705 × 0.295 ÷ 5,000) ≈ 0.91 puntos, \(z\) = 1.0 ÷ 0.91 ≈ 1.1, y p-value ≈ 0.27. No es significativo.

¿Quiere decir que B no sirve? No: quiere decir que **con estos datos no se distingue del ruido**. «No significativo» no es «no hay efecto». Cuánta muestra hace falta para no quedarse ciego es lo que sigue.

### Cuántos: potencia y efecto mínimo

Una prueba se puede equivocar de dos formas, y las dos importan:

| | No hay efecto de verdad | Sí hay efecto |
|---|---|---|
| La prueba dice «hay efecto» | Falsa alarma (α, error tipo I) | Bien: lo viste |
| La prueba dice «no se ve» | Bien | Se escapó (β, error tipo II) |

α lo eliges tú: 5 %. El otro error depende de cuántos datos tienes y de qué tan grande es el efecto. La probabilidad de **ver** un efecto que sí existe se llama [[potencia]] (*statistical power*), y la convención es pedir 80 %: de cada cinco efectos reales de ese tamaño, ves cuatro.

¿«De ese tamaño» cuál? Un efecto de 10 puntos se ve con pocos datos; uno de 0.1 puntos casi nunca. Por eso, antes de empezar, se decide el [[mde|efecto mínimo detectable]] (*minimum detectable effect*, MDE): el efecto más chico que vale la pena detectar. No sale de una fórmula: es una decisión de negocio. En Alba es **1 punto** de aceptación sobre el 70 % de hoy.

### La raya y las dos campanas

:::figura ruido-potencia
Dos mundos posibles para la diferencia entre B y A: sin efecto (izquierda) o con el efecto mínimo de +1 punto (derecha). La raya está donde la prueba empieza a decir «significativo».
:::

Si no hay efecto, la diferencia entre los brazos se reparte como una campana centrada en 0, con un error estándar de 0.36 puntos. La raya de significancia queda a 1.96 errores estándar, en +0.70 puntos (y en −0.70 del otro lado). Las dos colitas naranjas que la cruzan son el 5 % de falsas alarmas.

Si B de verdad sube la aceptación 1 punto, la diferencia se reparte como **otra** campana del mismo ancho, centrada en +1. La parte que cruza la raya (el 80 %) es la potencia; la que se queda corta (el 20 %), los efectos que se escapan por mala suerte.

¿Cuándo queda justo el 80 % del lado bueno? En cualquier campana, el 80 % queda a la derecha del punto que está 0.84 desviaciones abajo del centro. Así que el centro de la segunda campana tiene que estar 0.84 errores estándar a la derecha de la raya. Sumando: el MDE tiene que medir 1.96 + 0.84 = **2.80 errores estándar**. Y el error estándar de la diferencia es √(2 × p × (1 − p) ÷ n), con n publicaciones por brazo. Si despejas n de «MDE = 2.80 × √(2 × p × (1 − p) ÷ n)»:

:::formula Tamaño de muestra de un A/B, regla de bolsillo
n ≈ frac{2(z_α + z_β)^2 × p(1 − p)}{δ^2}
n ≈ frac{16 × p × (1 − p)}{δ^2}
- n: unidades en cada brazo; aquí, publicaciones
- p: la tasa del control, la de hoy, como fracción: 0.70
- δ: el MDE (la letra griega delta), como fracción: 1 punto = 0.01
- z_α: dónde queda la raya de significancia, en errores estándar: 1.96 para α = 0.05 de dos colas
- z_β: cuánto tiene que pasar la segunda campana esa raya para que la potencia sea 80 %: 0.84 errores estándar. β = 20 % es lo que se escapa
:::

El 16 sale de redondear 2 × (1.96 + 0.84)² = 2 × 2.80² ≈ 15.7. Es la regla de bolsillo para calcular el [[tamano-muestra|tamaño de muestra]] (*sample size*) de un A/B con α = 0.05 y potencia de 80 %.

La regla usa la misma varianza \(p × (1 − p)\) en los dos brazos. La fórmula completa le da a cada brazo la suya, \(p_1\) para el control y \(p_2 = p_1 + δ\) para el tratamiento, y usa su promedio \(p_m\) para la raya:

:::formula Tamaño de muestra, fórmula completa de dos proporciones
s_α = z_α × sqrt{2 × p_m × (1 − p_m)}
v = p_1 × (1 − p_1) + p_2 × (1 − p_2)
s_β = z_β × sqrt{v}
n = frac{(s_α + s_β)^2}{(p_2 − p_1)^2}
- p_1, p_2: la tasa del control y la del tratamiento si el efecto es justo el MDE: 0.70 y 0.71
- p_m: su promedio, \((p_1 + p_2) ÷ 2\)
- v: la suma de las varianzas de una unidad en cada brazo, si el efecto es el MDE
- s_α, s_β: los dos pedazos del numerador; \(z_α\) y \(z_β\) son los de la regla de bolsillo, sin redondear: 1.95996 y 0.84162
- n: unidades en cada brazo, redondeado hacia arriba
:::

:::cuenta Cuántas publicaciones necesita el A/B de Alba
Varianza de una publicación \(p × (1 − p)\) // acepta o no acepta; \(p\) = 0.70 | 0.70 × 0.30 | 0.21
MDE al cuadrado \(δ^2\) // \(δ\) = 1 punto = 0.01 | 0.01² | 0.0001
Factor de α y potencia \((z_α + z_β)^2\) | (1.96 + 0.84)² | 7.84
Regla de bolsillo \(n ≈ 16 × p × (1 − p) ÷ δ^2\) // 2 × 7.84 ≈ 16 | 16 × 0.21 ÷ 0.0001 | 33,600
Promedio de las dos tasas \(p_m\) | (0.70 + 0.71) ÷ 2 | 0.705
\(s_α\) // con \(z_α\) sin redondear | 1.95996 × √(2 × 0.705 × 0.295) | ≈ 1.26406
\(s_β = z_β × √v\) // \(v\) = 0.21 + 0.2059 = 0.4159 | 0.84162 × √(0.70 × 0.30 + 0.71 × 0.29) | ≈ 0.54276
Fórmula completa \(n = (s_α + s_β)^2 ÷ (p_2 − p_1)^2\) // redondeado hacia arriba; es `n_por_brazo(0.70, 0.71)` en el código de abajo | 1.80683² ÷ 0.01² ≈ 32,646.3 | 32,647
= **≈ 33,000 publicaciones por brazo**, el número con el que Alba planea su A/B. La regla de bolsillo queda a 3 % de la fórmula completa.
:::

### n crece con 1 ÷ efecto²

El MDE está al cuadrado en el denominador. Pedir la mitad de efecto cuesta **cuatro veces** la muestra:

| MDE \(δ\) sobre 70 % | Publicaciones por brazo \(n\), fórmula completa |
|---|---|
| 2 puntos | ≈ 8,100 |
| 1 punto | ≈ 32,650 |
| 0.5 puntos | ≈ 131,200 |

La fórmula completa, para dos proporciones distintas, cabe en unas líneas de Python:

```python
from math import ceil, sqrt
from statistics import NormalDist

Z = NormalDist().inv_cdf                 # el z que deja cierta probabilidad a su izquierda

def n_por_brazo(p1, p2, alpha=0.05, potencia=0.80):
    """Cuántas unidades por brazo para distinguir p1 de p2 (prueba de dos colas)."""
    za, zb = Z(1 - alpha / 2), Z(potencia)          # 1.96 y 0.84
    pm = (p1 + p2) / 2
    arriba = za * sqrt(2 * pm * (1 - pm)) + zb * sqrt(p1 * (1 - p1) + p2 * (1 - p2))
    return ceil(arriba ** 2 / (p2 - p1) ** 2)

for mde in [0.02, 0.01, 0.005]:                     # el efecto más chico que quieres ver
    exacta = n_por_brazo(0.70, 0.70 + mde)
    rapida = 16 * 0.70 * 0.30 / mde ** 2            # la regla de bolsillo
    print(f"MDE {mde * 100:.1f} puntos: {exacta:>7,} por brazo (regla rápida: {rapida:>7,.0f})")
print(f"con potencia 90 %: {n_por_brazo(0.70, 0.71, potencia=0.90):,} por brazo")
```

```salida
MDE 2.0 puntos:   8,080 por brazo (regla rápida:   8,400)
MDE 1.0 puntos:  32,647 por brazo (regla rápida:  33,600)
MDE 0.5 puntos: 131,229 por brazo (regla rápida: 134,400)
con potencia 90 %: 43,704 por brazo
```

:::calculadora ruido-muestra
Sube la potencia a 90 % o baja α a 1 % y mira cuánto cuesta cada exigencia. Con una tasa de 20 % y 2 puntos de MDE tienes uno de los ejercicios.
:::

Con estos números, el A/B demasiado chico del principio de esta sección se entiende mejor: con 5,000 publicaciones por brazo, la potencia para un efecto de 1 punto es ≈ 20 %. Cuatro de cada cinco veces, un modelo que sí sube la aceptación 1 punto habría salido «no significativo».

### A quién: la unidad de aleatorización

La [[unidad-aleatorizacion|unidad de aleatorización]] (*randomization unit*) es lo que se sortea entre los brazos. En Alba hay al menos dos opciones:

- **Por request.** Cada foto que llega se sortea por separado. Ana sube tres fotos de sus tenis y dos reciben sugerencias del modelo A y una del modelo B: una experiencia incoherente, y las respuestas de los dos modelos se mezclan en la misma publicación.
- **Por vendedor.** Se sortea a Ana una vez y para todo el experimento. Ve siempre el mismo modelo.

Alba sortea por **vendedor**. El sorteo es un hash: `hash(sal + seller_id) mod 100` convierte el id de Ana en un número de 0 a 99 que parece al azar, pero que siempre sale igual para ella. De 0 a 49 va a A; de 50 a 99, a B. La sal es un texto que cambia en cada experimento: sin ella, los mismos vendedores caerían en el tratamiento de todos los experimentos, y arrastrarían efectos de uno al siguiente.

### Una métrica que decide y varias que cuidan

Antes de empezar se escribe **una** métrica primaria, la que decide. En Alba es la **tasa de aceptación**. También se fijan los **guardrails** (barandales): métricas que no tienen que mejorar, pero no pueden empeorar. En Alba son el [[p99]] de latencia, la tasa de errores, el porcentaje de publicaciones que un moderador recategoriza después (aceptar más una sugerencia equivocada sería una mejora falsa) y el tiempo para llenar el formulario.

:::diagrama ruido-ab
El A/B de Alba: cada vendedor cae siempre en el mismo brazo; al final se revisa el reparto y luego la métrica primaria y los guardrails. Toca cada caja o recorre los pasos.
:::

### Cuánto tiempo: semanas, aunque la muestra se junte en horas

Alba recibe ≈ 2.5 millones de publicaciones al día: 2,500,000 ÷ 24 ≈ 104,000 por hora. Repartiendo 50/50, las ≈ 65,000 que hacen falta entre los dos brazos (2 × 32,647) se juntan en menos de una hora: 65,000 ÷ 104,000 ≈ 0.6 horas. Con solo 5 % del tráfico en el tratamiento, ese brazo recibe 0.05 × 104,000 ≈ 5,200 por hora y llega a sus ≈ 33,000 en 33,000 ÷ 5,200 ≈ 6 horas. Aun así, el A/B de Alba corre **una o dos semanas completas** (y termina con mucha más muestra que el mínimo, lo que solo ayuda). Hay tres razones:

1. **El ciclo de la semana.** Quien vende el domingo no es quien vende el martes: otros productos, otro tipo de vendedor. Una semana completa los incluye a todos, en la proporción de siempre.
2. **El efecto novedad.** Un cambio visible altera el comportamiento los primeros días: hay curiosidad, o rechazo, y luego la gente se acomoda. Por eso se mira el efecto día por día: si se va achicando, hay que esperar.
3. **Métricas que tardan.** Una recategorización de un moderador llega días después de la publicación. Un guardrail que llega tarde necesita que el experimento dure lo suficiente para verlo.

### Antes de leer el resultado

Al terminar, lo primero no es la aceptación: es revisar que cada brazo recibió la parte que le tocaba. Si el 50/50 salió chueco, algo pierde publicaciones en un brazo, y el resultado no se lee hasta entenderlo (la cuenta está en la sección siguiente). Y para probar la máquina antes de usarla se corre un **A/A**, como el de abajo.

### Compruébalo con un A/A

Si α es la tasa de falsas alarmas, un A/A debería salir «significativo» el 5 % de las veces. Este código corre 2,000 A/A con 2,000 publicaciones por brazo y la misma aceptación de 70 % en los dos:

```python
import math, random
from statistics import NormalDist

random.seed(2026)
P, N, PRUEBAS = 0.70, 2000, 2000      # misma tasa en los dos brazos, 2,000 por brazo, 2,000 A/A

def p_value(a, b, n):
    """Prueba z de dos proporciones: a y b aceptaciones de n cada brazo."""
    p = (a + b) / (2 * n)                       # la tasa con los dos brazos juntos
    error = math.sqrt(p * (1 - p) * 2 / n)      # error estándar de la diferencia
    z = (b - a) / n / error
    return 2 * (1 - NormalDist().cdf(abs(z)))   # las dos colas

pvalues = []
for _ in range(PRUEBAS):
    a = sum(random.random() < P for _ in range(N))    # control
    b = sum(random.random() < P for _ in range(N))    # «tratamiento»: idéntico
    pvalues.append(p_value(a, b, N))

alarmas = sum(p < 0.05 for p in pvalues)
print(f"{alarmas} de {PRUEBAS} A/A salieron «significativos»: {alarmas / PRUEBAS:.1%}")
for i in range(5):                                    # cómo se reparten los p-values
    k = sum(i / 5 <= p < (i + 1) / 5 for p in pvalues)
    print(f"p entre {i / 5:.1f} y {(i + 1) / 5:.1f}: {k / PRUEBAS:.0%}")
```

```salida
102 de 2000 A/A salieron «significativos»: 5.1%
p entre 0.0 y 0.2: 21%
p entre 0.2 y 0.4: 18%
p entre 0.4 y 0.6: 20%
p entre 0.6 y 0.8: 20%
p entre 0.8 y 1.0: 21%
```

Las falsas alarmas salen ≈ 5 %, justo α. Y cuando no hay efecto, los p-values se reparten **parejo** entre 0 y 1: en un A/A, un p-value de 0.03 es tan normal como uno de 0.6. Un p-value abajo de 0.05, solo, no prueba nada: sale 1 de cada 20 veces sin que haya nada.

## Trampas: mirar antes, comparar de más y repartir mal {Pitfalls: peeking, multiple comparisons and broken splits} [extra]

Las trampas más comunes de un A/B no están en la fórmula: están en cómo se usa. Las dos primeras tienen la misma raíz: el 5 % de falsas alarmas vale para **una** prueba, y cada prueba de más es otra oportunidad para que el ruido cruce la raya. Las otras dos rompen una suposición de la cuenta: que el reparto fue al azar y que las unidades son independientes.

### Peeking: parar cuando se ve bien

El [[peeking]] (*mirar antes de tiempo*) es revisar el A/B todos los días y pararlo el primer día que el p-value baje de 0.05. Suena razonable: ¿para qué esperar si ya ganó? Mira lo que pasa con 2,000 A/A de 14 días, donde nunca hay nada que encontrar:

```python
import math, random
from statistics import NormalDist

random.seed(14)
P, POR_DIA, DIAS, PRUEBAS = 0.70, 300, 14, 2000      # A/A: los dos brazos son idénticos

def p_value(a, b, n):
    p = (a + b) / (2 * n)
    z = (b - a) / n / math.sqrt(p * (1 - p) * 2 / n)
    return 2 * (1 - NormalDist().cdf(abs(z)))

al_final = mirando = 0
for _ in range(PRUEBAS):
    a = b = n = 0
    vio_alarma = False
    for dia in range(DIAS):                           # cada día llegan 300 más a cada brazo
        a += sum(random.random() < P for _ in range(POR_DIA))
        b += sum(random.random() < P for _ in range(POR_DIA))
        n += POR_DIA
        if p_value(a, b, n) < 0.05:                   # mirar el resultado de hoy
            vio_alarma = True                         # quien mira cada día ya habría parado
    al_final += p_value(a, b, n) < 0.05               # quien solo mira el día 14
    mirando += vio_alarma
print(f"mirando solo al final:   {al_final / PRUEBAS:.1%} de falsas alarmas")
print(f"mirando los {DIAS} días:    {mirando / PRUEBAS:.1%} de falsas alarmas")
```

```salida
mirando solo al final:   5.2% de falsas alarmas
mirando los 14 días:    22.9% de falsas alarmas
```

Mirando solo al final, 5 %, como promete α. Mirando cada día, **más de cuatro veces más**. La razón: día con día, la diferencia entre los brazos sube y baja al azar, y z hace un camino zigzagueante. La raya de 1.96 está pensada para mirar ese camino **una vez**; si lo miras 14 veces, basta con que lo cruce en cualquiera de ellas.

Una simulación más grande, con 20,000 A/A y 2,400 publicaciones por brazo al día, da ≈ 22 %. Nuestro 22.9 % con 2,000 A/A no la contradice: una proporción medida con 2,000 pruebas tiene su propio error estándar, \(SE\) = √(0.22 × 0.78 ÷ 2,000) ≈ 0.9 puntos (la fórmula de siempre, con \(p\) = 0.22 y \(n\) = 2,000), así que la diferencia cabe en el ruido de la simulación. La lección se aplica a sí misma.

Hay dos salidas:

- **La simple:** fijar la muestra y la duración antes, y decidir solo al final. Los guardrails sí se miran a diario, para **detener un daño**; lo que no se vale es **declarar victoria** antes.
- **La flexible:** una prueba secuencial, diseñada para mirar muchas veces sin inflar el error (con *alpha spending*, o con p-values «siempre válidos»). Varias plataformas de experimentos traen alguna; a cambio, si llegas hasta el final, suelen pedir más muestra que una prueba fija.

### Comparaciones múltiples: 20 métricas, una ganadora

La otra trampa es mirar muchas métricas, o muchos slices, y fijarse en la que salió. Son las [[comparaciones-multiples|comparaciones múltiples]] (*multiple comparisons*). Supón un A/B donde el modelo nuevo no cambia nada, y en el dashboard hay 20 métricas, cada una con su prueba a 0.05. Las cuentas usan la [[regla-producto|regla del producto]] y el [[complemento]] de la lección de probabilidad:

:::formula Falsas alarmas con k pruebas sin efecto
P = 1 − (1 − α)^k
E = k × α
- k: cuántas pruebas corres, independientes entre sí
- α: la significancia de cada prueba: 0.05
- P: la probabilidad de que al menos una salga «significativa» por puro azar
- E: cuántas falsas alarmas esperas, en promedio
:::

:::cuenta Veinte pruebas sin ningún efecto
Una prueba no da falsa alarma \(1 − α\) | 1 − 0.05 | 0.95
Ninguna de las 20 la da \((1 − α)^k\) // independientes: se multiplican; \(k\) = 20 | 0.95²⁰ | ≈ 0.358
Al menos una la da \(P = 1 − (1 − α)^k\) // el complemento | 1 − 0.358 | **≈ 64 %**
Falsas alarmas esperadas \(E = k × α\) | 20 × 0.05 | **1**
= Con 20 métricas sin ningún efecto real, lo más probable es que alguna salga «significativa». Celebrar esa es celebrar el ruido.
:::

Con 10 métricas, la probabilidad de al menos una falsa alarma es \(P\) = 1 − 0.95¹⁰ ≈ 40 %; con las 100 categorías que revisa el gate de Alba, si cada una se probara a 0.05 sin corregir, serían \(E\) = 100 × 0.05 = 5 falsas alarmas esperadas en cada gate. Las defensas, de la más importante a la más técnica:

1. **Una métrica primaria, escrita antes.** Es la que decide. Las demás se leen como pistas para entender, no como trofeos.
2. **Corregir el corte.** La corrección de **Bonferroni** usa \(α_B = α ÷ k\) en cada prueba: con 20 pruebas, 0.05 ÷ 20 = 0.0025. Así la probabilidad de al menos una falsa alarma vuelve a ≈ 5 %. El precio es menos potencia en cada prueba.
3. **Una corrección menos estricta.** La de **Holm** ordena los p-values de menor a mayor y compara el primero contra α ÷ k, el segundo contra α ÷ (k − 1), y así hasta el primero que no pase. Controla lo mismo que Bonferroni y pierde menos potencia. Es la que usa el gate de Alba sobre sus 100 categorías.

:::calculadora ruido-multiples
Prueba con 12 pruebas al día: un sistema de patología digital que revisa 4 estadísticas de drift en cada uno de sus 3 laboratorios corre 4 × 3 = 12, y le da ≈ 46 % de probabilidad de al menos una falsa alarma cada día.
:::

### Un reparto que no es 50/50

Si configuraste 50/50 y llegaron 50,600 publicaciones a A y 49,400 a B, ¿es azar? A recibió 50.6 % de 100,000. Si el reparto funcionara, esa proporción sería 50 %, con un error estándar de \(SE\) = √(0.5 × 0.5 ÷ 100,000) ≈ 0.16 puntos (la fórmula de una proporción, con \(p\) = 0.5 y \(n\) = 100,000). La diferencia, 0.6 puntos, son \(z\) = 0.6 ÷ 0.158 ≈ 3.8 errores estándar: más allá de la zona del 99.7 %, con p-value ≈ 0.00015. No es azar. Algo pierde o agrega publicaciones en un brazo: el modelo nuevo es más lento y más requests se cortan antes de quedar en el log, o un filtro de bots se porta distinto en cada brazo. Y lo que se pierde no es al azar, así que sesga la métrica. Se llama *sample ratio mismatch* (SRM), y la regla es dura: **no se lee el resultado hasta entenderlo**. En cambio, 50,150 contra 49,850 está a 0.15 ÷ 0.158 ≈ 0.95 errores estándar: normal.

### Se sortean vendedores, pero se cuentan publicaciones

La cuenta de tamaño de muestra supone que las publicaciones son independientes. Pero se sortearon vendedores, y un vendedor que publica tres veces tiende a aceptar o rechazar las tres de forma parecida. Esa correlación hace que la varianza real sea mayor que la de la fórmula: si no la tomas en cuenta, el error estándar sale chico y aparecen «ganadores» de más. El factor que la corrige se llama *design effect*: \(D = 1 + (g − 1) × ρ\), con \(g\) publicaciones por vendedor y \(ρ\) (rho) la correlación entre las publicaciones de un mismo vendedor. Con \(g\) = 3 y \(ρ\) = 0.2, el factor es 1 + 2 × 0.2 = 1.4: hacen falta 32,647 × 1.4 ≈ 45,700 publicaciones por brazo, no 32,647, y el análisis calcula la varianza agrupando por vendedor. En una entrevista suma decirlo así: «the randomization unit is the seller, so I compute the variance at the seller level».

## ¿Es real una mejora de 0.2 puntos? {Is a 0.2-point improvement real?} [extra]

Volvamos a la pregunta del principio, con un caso concreto: entrenas dos veces con la misma configuración y el golden set dice 85.3 % y 85.1 % de [[top-k-accuracy|top-1]]. ¿El segundo es peor, o es ruido? Y si un modelo nuevo saca 0.2 puntos más que el actual, ¿es mejor de verdad?

### Dos ruidos distintos

En esa pregunta se mezclan dos ruidos, y conviene separarlos.

**El ruido del entrenamiento.** Entrenar tiene azar: la [[semilla]], el orden de los batches, hasta el orden de las sumas en la GPU. La misma receta entrenada con 5 semillas da, en un ejemplo con el modelo de Alba, 85.21 %, 85.34 %, 85.12 %, 85.29 % y 85.18 %. El promedio es \(μ\) = 426.14 ÷ 5 ≈ 85.23 % y la desviación estándar \(σ\) (con la fórmula del principio, pero dividiendo entre n − 1 = 4, porque son una muestra de todas las semillas posibles) es ≈ 0.09 puntos, con 0.22 puntos entre el mejor y el peor. Una diferencia de 0.2 puntos entre dos corridas cabe en este ruido: no dice nada de la receta.

**El ruido de la evaluación.** El golden set tiene 50,000 fotos, no infinitas. Una accuracy medida con él trae ±0.3 puntos.

### Dos modelos, las mismas fotos

La idea obvia es comparar los dos intervalos. El actual saca 85.0 % ± 0.3 y el nuevo 85.2 % ± 0.3: se enciman casi por completo. Con la cuenta de dos brazos independientes, el error estándar de la diferencia es √(2 × 0.85 × 0.15 ÷ 50,000) ≈ 0.23 puntos, z ≈ 0.89 y p-value ≈ 0.38: «no se distingue».

Pero los dos exámenes no son muestras independientes: **son las mismas 50,000 fotos**. Una foto fácil es fácil para los dos modelos; una borrosa, difícil para los dos. El ruido de «qué fotos tocaron» es el mismo en los dos exámenes y se cancela en la diferencia. Hay que comparar foto por foto: es una [[prueba-pareada|prueba pareada]] (*paired test*).

:::figura ruido-pareado
Las mismas 50,000 fotos calificadas por los dos modelos. Donde los dos aciertan o los dos fallan, empatan; toda la información está en las 2,000 donde discrepan.
:::

### La intuición de McNemar: volados

En 48,000 de las 50,000 fotos los dos modelos dicen lo mismo: aciertan los dos o fallan los dos. Esas fotos no dicen nada de quién es mejor. Quedan 2,000 donde discrepan: en 1,050 solo acierta el nuevo, y en 950 solo el actual.

Ahora la hipótesis nula: si los dos modelos fueran igual de buenos, cada foto donde discrepan sería un **volado**, 50 % para cada lado. En 2,000 volados lo esperado es 1,000 para cada uno, con una desviación de √(2,000 × 0.5 × 0.5) ≈ 22.4 (la fórmula del error estándar, contada en volados). Salieron 1,050: 50 de más, 50 ÷ 22.4 ≈ 2.2 desviaciones. El p-value queda en ≈ 0.025.

Esa es la prueba de **McNemar**. Con la misma idea salen también la diferencia entre los modelos y su error estándar:

:::formula Prueba pareada de McNemar
z = frac{b − c}{sqrt{b + c}}
Δ = frac{b − c}{N}
SE_Δ = frac{sqrt{b + c}}{N}
- b: fotos donde solo acierta el modelo nuevo
- c: fotos donde solo acierta el actual
- N: fotos del examen; en el golden set, 50,000
- z: a cuántas desviaciones del empate quedó el conteo
- Δ: la diferencia de accuracy entre los dos modelos (la letra griega delta mayúscula), como fracción
- SE_Δ: su error estándar; el intervalo de 95 % es \(Δ ± 1.96 × SE_Δ\)
:::

Aquí, z = (1,050 − 950) ÷ √(1,050 + 950) = 100 ÷ √2,000 ≈ 2.24. (Su versión «oficial» usa χ², chi-cuadrado, que es z al cuadrado: 100² ÷ 2,000 = 5. La [[chi-cuadrado|prueba chi-cuadrado]] la ves en la lección siguiente.)

La misma cuenta, con otros números ilustrativos:

:::cuenta El nuevo contra el actual en el golden set de Alba (números ilustrativos)
Solo el nuevo acierta | \(b\) | 1,100 fotos
Solo el actual acierta | \(c\) | 900 fotos
Diferencia de top-1 \(Δ\) | \(Δ = (b − c) ÷ N\) = 200 ÷ 50,000 | +0.4 puntos
Prueba pareada (McNemar) // \(z\) = 200 ÷ √2,000 ≈ 4.47, y χ² = z² = 20 | (b − c)² ÷ (b + c) = 200² ÷ 2,000 | p-value ≈ 8 × 10⁻⁶
Error estándar de la diferencia pareada \(SE_Δ\) | \(SE_Δ = √(b + c) ÷ N\) = √2,000 ÷ 50,000 | ≈ 0.089 puntos
Intervalo de 95 % | \(Δ ± 1.96 × SE_Δ\) = 0.4 ± 1.96 × 0.089 = 0.4 ± 0.18 | +0.22 a +0.58
Si se tratan como muestras independientes // \(SE_d\) de la prueba z, con \(p\) = 0.85; z = 0.4 ÷ 0.226 ≈ 1.8 | 0.4 ÷ √(2 × 0.85 × 0.15 ÷ 50,000) = 0.4 ÷ 0.226 | p-value ≈ 0.08
= La misma diferencia de 0.4 puntos es clarísima comparando foto por foto y «no significativa» comparando por separado.
:::

### Depende de en cuántas discrepan

La prueba pareada no mira solo la diferencia: mira también cuántas discrepancias hay. Con la misma mejora de 0.2 puntos (100 fotos netas a favor del nuevo):

| Fotos donde discrepan | A favor del nuevo · del actual | z | p-value |
|---|---|---|---|
| 2,000 | 1,050 · 950 | 2.24 | ≈ 0.025 |
| 6,000 | 3,050 · 2,950 | 1.29 | ≈ 0.20 |

Dos modelos que casi siempre dicen lo mismo se distinguen con poca diferencia; dos que discrepan muchísimo necesitan una más grande.

### Cuántas fotos para un margen

¿Y por qué 50,000 fotos? La cuenta del intervalo también se puede hacer al revés: eliges el margen \(m\) que necesitas y despejas n de \(m = 1.96 × √(p × (1 − p) ÷ n)\):

\(n = 1.96^2 × p × (1 − p) ÷ m^2\)

Para medir una accuracy de 85 % con ±1 punto (\(p\) = 0.85, \(m\) = 0.01): 3.84 × 0.1275 ÷ 0.01² ≈ 4,900 fotos. Con ±0.5 puntos, cuatro veces más: ≈ 19,600. Es la cuenta que decide de qué tamaño se hace un golden set, o cuántas fotos al azar hay que etiquetar cada mes para vigilar al modelo.

Y esto se paga en dinero. El [[golden-set|golden set]] de Alba tiene 50,000 fotos etiquetadas por dos personas cada una y cuesta del orden de US$5–10 mil. Bajar su ruido de ±0.3 a ±0.15 puntos pediría 200,000 fotos: cuatro veces el costo.

### El golden set por pedazos: cada slice trae su ruido

El margen de ±0.3 es del golden set completo. Un [[slice]] (*rebanada*, un pedazo de los datos que se mide aparte) tiene menos fotos, y por lo tanto más ruido:

| Qué se mide | Fotos | Margen de 95 % |
|---|---|---|
| Todo el golden set, con 85 % | 50,000 | ± 0.3 puntos |
| Las fotos con poca luz, el 5 %, con 77.4 % | 2,500 | ± 1.6 |
| Una categoría chica, con 85 % | 60 | ± 9 |

Por eso el gate de Alba le permite a cada slice moverse lo que mide su propio intervalo (≈ 1–2 puntos). A cada una de las 100 categorías con más tráfico la frena solo si su [[recall]] cae más de 5 puntos **y** la caída es significativa (McNemar por categoría, con la corrección de Holm); las categorías chicas se vigilan juntas, con el [[macro-promedio|macro-recall]] del [[long-tail|long tail]]. Exigir «ninguna categoría baja más de 5 puntos» sin mirar su ruido daría falsas alarmas cada mes.

:::profundo Cuando ±2 errores estándar no alcanza: Wilson y bootstrap
La receta de ±1.96 errores estándar supone una campana simétrica, lejos de los límites de 0 % y 100 %. Con pocos datos o proporciones extremas, falla:

- **57 aciertos de 60 fotos (95 %).** La receta da 95 ± 5.5: de 89.5 % a **100.5 %**. Una accuracy no puede pasar de 100.
- **50 aciertos de 50.** El error estándar sale 0, y la receta dice «100 % ± 0», como si fuera seguro con solo 50 fotos.

El intervalo de **Wilson** lo corrige con una fórmula un poco más larga, que traen las bibliotecas de estadística: para los dos casos da de 86.3 % a 98.3 % y de 92.9 % a 100 %. La receta de ±2 funciona bien cuando hay al menos unos 10 aciertos y unos 10 fallos.

¿Y si la métrica no es una proporción, como el p99 de latencia o el F1? Entonces se usa el **bootstrap**: de tus n datos sacas n al azar **con reemplazo** (un dato puede salir dos veces y otro ninguna), recalculas la métrica y repites miles de veces. El 95 % de en medio de esos valores es el intervalo. También sirve para comparar dos modelos sobre el golden set: en cada vuelta se sortean las fotos y se recalcula la diferencia entre los dos con esas mismas fotos (bootstrap pareado).
:::

### Entonces, ¿es real?

La pregunta tiene tres respuestas, según qué quieras decir con «real»:

1. **¿Este modelo nuevo acierta más que el actual, en fotos como las del golden set?** Depende de las discrepancias. Con 1,050 contra 950, probablemente sí (p-value ≈ 0.025).
2. **¿La receta nueva es mejor que la vieja?** Con una corrida de cada una, no se sabe: el ruido de la semilla (0.09 puntos de desviación, 0.22 de rango) es del tamaño de la mejora. Hay que entrenar varias semillas de cada receta.
3. **¿Pasa el gate de Alba?** Aquí no se pregunta si mejoró: el reentrenamiento mensual busca no quedarse atrás mientras el catálogo cambia. El gate pide **no inferioridad**: que el extremo de abajo del intervalo pareado no baje de −0.3 puntos. Con 1,050 contra 950, \(Δ\) = 100 ÷ 50,000 = 0.2 puntos y \(SE_Δ\) = √2,000 ÷ 50,000 ≈ 0.089 puntos, así que el intervalo, 0.2 ± 1.96 × 0.089, va de +0.02 a +0.38: pasa con holgura. Exigir una mejora significativa bloquearía casi todos los reentrenamientos, y el modelo envejecería.

El riesgo de la no inferioridad es la erosión: perder 0.2 puntos cada mes, siempre «dentro del margen», son 2.4 puntos en un año. Por eso el gate de Alba compara también contra el modelo de hace 3 meses.

## Errores comunes {Common mistakes}

Ninguno de estos errores truena: la cuenta corre y el número sale. El daño es una decisión equivocada, tomada con mucha seguridad.

### Leer el p-value como «la probabilidad de que funcione»

**Qué pasa:** el A/B da p-value = 0.03 y alguien reporta «97 % de seguridad de que el modelo nuevo es mejor». El p-value se calculó **suponiendo que no hay efecto**; no dice qué tan probable es que lo haya. Si casi ninguna idea funciona, buena parte de las «ganadoras» son falsas alarmas.

**Cómo evitarlo:** dilo completo: «si no hubiera diferencia, una así de grande saldría 3 % de las veces». Reporta el efecto con su intervalo, no solo el p-value.

### Parar el A/B cuando se ve bien

**Qué pasa:** se revisa el experimento cada mañana y se para el día que el p-value baja de 0.05: es el [[peeking]]. Con 14 miradas, las falsas alarmas pasan de 5 % a más de 20 %.

**Cómo evitarlo:** fija la muestra y la duración antes, con la cuenta de potencia, y decide solo al final. Los guardrails (las métricas que no pueden empeorar, como la latencia) se miran a diario para detener un daño, nunca para declarar victoria.

### Medir 20 métricas y quedarte con la que salió

**Qué pasa:** la métrica primaria no se movió, pero «el tiempo en la página subió en celulares Android de noche». Son [[comparaciones-multiples|comparaciones múltiples]]. Con 20 métricas sin efecto, lo raro sería que ninguna saliera: hay 64 % de probabilidad de al menos una.

**Cómo evitarlo:** una métrica primaria escrita antes, que es la que decide. Las demás son pistas que se confirman con otro experimento. Si decides con varias, corrige el corte (Bonferroni o Holm).

### Sortear por request cuando la unidad es el vendedor

**Qué pasa:** el experimento reparte cada request al azar. Ana ve sugerencias de dos modelos en la misma publicación y su comportamiento mezcla los dos. Y si se sortean vendedores pero se analizan publicaciones como independientes, la varianza sale más chica de lo que es y aparecen «ganadores» que no existen.

**Cómo evitarlo:** sortea por la [[unidad-aleatorizacion|unidad]] que vive la experiencia (en Alba, el vendedor), con un sorteo que siempre da lo mismo para cada vendedor y cambia en cada experimento, y calcula la varianza agrupando por esa unidad.

### Correr tres días e ignorar el efecto novedad

**Qué pasa:** la muestra se juntó en horas, el efecto se ve enorme y se lanza. A las dos semanas desaparece: era curiosidad por lo nuevo, o era un martes.

**Cómo evitarlo:** semanas completas (en Alba, una o dos), aunque la muestra se junte antes. Mira el efecto día por día: si se va achicando, espera a que se estabilice.

### Leer «no significativo» como «no hay efecto»

**Qué pasa:** un A/B con 5,000 publicaciones por brazo sale con p-value = 0.27 y se concluye «el modelo nuevo no sirve». Con esa muestra, la [[potencia]] para un efecto de 1 punto era ≈ 20 %: el experimento casi no podía ver nada.

**Cómo evitarlo:** haz la cuenta de potencia antes. Si no se rechaza H0, reporta el intervalo del efecto: «entre −0.8 y +2.8 puntos» dice mucho más que «no significativo».

### Comparar dos intervalos cuando las fotos son las mismas

**Qué pasa:** el modelo nuevo saca 85.2 % ± 0.3 y el actual 85.0 % ± 0.3 en el mismo golden set. Los intervalos se enciman y se concluye «empate». Pero son las mismas fotos, y foto por foto pueden ser claramente distintos.

**Cómo evitarlo:** compara foto por foto con una [[prueba-pareada|prueba pareada]] (McNemar o bootstrap pareado), que es lo que hace el gate de Alba.

## En la vida real {In real life} [extra]

Las mismas cuentas aparecen en cualquier lugar donde se decide con datos que no son infinitos.

**Alba · El gate y el A/B.** Cada modelo nuevo se compara foto por foto contra el actual en las 50,000 fotos del golden set, con una prueba pareada y un margen de no inferioridad de −0.3 puntos; los slices, con su propio intervalo de ≈ 1–2 puntos; las 100 categorías con más tráfico, con McNemar y la corrección de Holm. Si el cambio es grande, sigue un A/B por vendedor: ≈ 33,000 publicaciones por brazo para ver 1 punto sobre 70 %, una o dos semanas completas y el reparto revisado antes que nada. Y ≈ 1 % de los vendedores no ve sugerencias durante meses: un control de largo plazo que mide cuánto vale todo el sistema.

**Anuncios.** Un medio de noticias con ≈ 300 millones de impresiones de anuncios al día y un CTR (*click-through rate*, la fracción de impresiones con clic) de ≈ 0.35 % quiere subir su ingreso por cada 1,000 páginas vistas. La unidad es la persona, y el ingreso por persona es muy disparejo: la mayoría genera casi nada y unos pocos lectores mucho, con una desviación de ≈ 3 veces el promedio (un supuesto que se mide con un mes de logs). Ver un cambio de 1 % en el ingreso por persona (1 % de su valor, no un punto) pide ≈ 1.41 millones de personas por brazo; uno de 2 %, ≈ 353,000: 1 ÷ efecto² otra vez. Como los brazos comparten el presupuesto de cada anunciante y se lo pueden robar, el presupuesto se parte por brazo. Y un anuncio nuevo, en sus primeras 10,000 impresiones, espera ≈ 35 clics: su CTR trae un ruido de ≈ 1 ÷ √35 ≈ 17 %.

**Monitoreo.** En un sistema de patología digital con laminillas de 3 laboratorios se revisan 4 estadísticas de drift por laboratorio cada día: 12 pruebas diarias a α = 0.05. Sin que nada cambie, son \(E = k × α\) = 12 × 0.05 = 0.6 falsas alarmas al día: ≈ 18 en un mes de 30 días. Así nace la fatiga de alertas: si la alarma suena siempre, nadie la oye.

**Medicina.** Los ensayos clínicos son pruebas A/B con más reglas: pacientes repartidos al azar, un grupo de control con placebo o con el tratamiento de siempre, a veces sin que ni el paciente ni el médico sepan quién recibe qué (doble ciego), y la métrica primaria registrada antes de empezar. El ensayo de estreptomicina contra la tuberculosis del Medical Research Council británico, publicado en 1948, suele contarse como el primer ensayo aleatorizado moderno: murieron 4 de 55 pacientes con estreptomicina y 14 de 52 en el control. El placebo existe porque recibir algo, solo por recibirlo, ya cambia el resultado, un primo del efecto novedad: dárselo también al control hace que ese efecto les toque a los dos grupos.

**Encuestas.** Una encuesta de 1,000 personas al azar mide una intención de voto con un margen de ≈ ±3 puntos: 1.96 × √(0.5 × 0.5 ÷ 1,000) ≈ 3.1. Es el «margen de error» de las noticias, y no cubre el sesgo. En 1936, la revista estadounidense *Literary Digest* mandó más de 10 millones de boletas para adivinar la elección presidencial y le regresaron ≈ 2.4 millones. Predijo que Alf Landon ganaría con ≈ 57 % de los votos; ganó Franklin Roosevelt con ≈ 61 %. Sus listas salían de directorios telefónicos y registros de autos, en plena crisis económica, y contestó una de cada cuatro personas: ni las listas ni quienes contestaron se parecían al país. Una muestra sesgada puede tener un margen chiquito y estar mal.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los primeros cuatro son directos; los dos últimos piden juntar varias ideas.

:::ejercicios
? [facil] Calcula la varianza y la desviación estándar de 4, 8, 6, 5 y 7, primero dividiendo entre n y después entre n − 1.
Usa las fórmulas de la sección «Varianza y desviación estándar»: \(μ\) = suma ÷ \(n\); \(σ^2\) = suma de los \((x_i − μ)^2\) ÷ \(n\) (o ÷ \((n − 1)\)); \(σ = √σ^2\). Aquí \(n\) = 5.

Promedio: \(μ\) = (4 + 8 + 6 + 5 + 7) ÷ 5 = 30 ÷ 5 = 6. Distancias \(x_i − μ\): −2, 2, 0, −1 y 1. Cuadrados: 4, 4, 0, 1 y 1, que suman 10.

- Entre n: \(σ^2\) = 10 ÷ 5 = **2**, y la desviación es \(σ\) = √2 ≈ **1.41**.
- Entre n − 1: 10 ÷ 4 = **2.5**, y la desviación es √2.5 ≈ **1.58**.
? [facil] Un modelo acierta 90 % en un examen de 400 fotos. ¿Cuál es el error estándar y cuál el intervalo de 95 %?
Usa \(SE = √(p × (1 − p) ÷ n)\) y \(m = 1.96 × SE\), con \(p\) = 0.9 y \(n\) = 400.

Varianza de una foto: \(p × (1 − p)\) = 0.9 × 0.1 = 0.09. Entre n: 0.09 ÷ 400 = 0.000225. Raíz: \(SE\) = √0.000225 = 0.015, o sea **1.5 puntos**.

Margen de 95 %: \(m\) = 1.96 × 1.5 ≈ 2.9 puntos. Intervalo \(p ± m\): de 90 − 2.9 = **87.1 %** a 90 + 2.9 = **92.9 %**.
? [facil] Un examen de 2,500 fotos da un margen de ±1.4 puntos. ¿Cuántas fotos necesitas para ±0.7? ¿Y para ±0.35?
El margen baja con la raíz de n, \(m = 1.96 × √(p × (1 − p) ÷ n)\), así que con la misma \(p\): \(n_{nuevo} = n × (m ÷ m_{nuevo})^2\). Para la mitad del margen hacen falta 2² = 4 veces las fotos.

- ±0.7 es la mitad de ±1.4: 2,500 × (1.4 ÷ 0.7)² = 4 × 2,500 = **10,000 fotos**.
- ±0.35 es la mitad otra vez: 2,500 × (1.4 ÷ 0.35)² = 16 × 2,500 = **40,000 fotos**, 16 veces el examen original.
? [facil] El dashboard de un A/B muestra 8 métricas, cada una con su prueba a α = 0.05, y el modelo nuevo no cambia nada. ¿Cuántas falsas alarmas esperas? ¿Qué probabilidad hay de al menos una? ¿Qué corte usarías con Bonferroni?
Usa \(E = k × α\), \(P = 1 − (1 − α)^k\) y \(α_B = α ÷ k\), con \(k\) = 8 y \(α\) = 0.05.

- Falsas alarmas esperadas: \(E\) = 8 × 0.05 = **0.4**.
- Ninguna falsa alarma: \((1 − α)^k\) = 0.95⁸ ≈ 0.663. Al menos una: \(P\) = 1 − 0.663 ≈ **34 %**, una de cada tres veces.
- Bonferroni: \(α_B\) = 0.05 ÷ 8 = **0.00625** en cada métrica.
? [medio] Un A/B termina con 2,000 usuarios por brazo. En A aceptan 1,400 (70 %) y en B 1,460 (73 %). ¿Es significativo a α = 0.05? ¿Qué tan grande puede ser el efecto?
Usa la prueba z de dos proporciones: \(p_0 = (a_A + a_B) ÷ 2n\), \(SE_d = √(2 × p_0 × (1 − p_0) ÷ n)\) y \(z = (p_B − p_A) ÷ SE_d\), con \(n\) = 2,000, \(a_A\) = 1,400 y \(a_B\) = 1,460.

:::cuenta ¿Los 3 puntos son ruido?
Diferencia \(p_B − p_A\) | 73 − 70 | 3 puntos
Tasa juntando los brazos \(p_0\) | (1,400 + 1,460) ÷ 4,000 = 2,860 ÷ 4,000 | 0.715
Error estándar de la diferencia \(SE_d\) | √(2 × 0.715 × 0.285 ÷ 2,000) ≈ 0.0143 | 1.43 puntos
z | \(z = (p_B − p_A) ÷ SE_d\) = 3 ÷ 1.43 | ≈ 2.1
p-value | dos colas, más allá de 2.1 | ≈ 0.036
= p-value < 0.05: es significativo, aunque no por mucho.
:::
El intervalo de 95 % del efecto es \((p_B − p_A) ± 1.96 × SE_d\) = 3 ± 1.96 × 1.43 ≈ 3 ± 2.8: de **+0.2 a +5.8 puntos**. B es mejor, pero no se sabe si por casi nada o por mucho. Si al negocio solo le sirve una mejora de 2 puntos o más, todavía no está claro que la tenga.
? [medio] Configuraste un A/B con 10 % del tráfico en el tratamiento. De 200,000 publicaciones, al tratamiento llegaron 19,400. ¿Es azar? ¿Qué haces?
Usa el error estándar de una proporción con la fracción configurada, \(SE = √(p × (1 − p) ÷ n)\), y mide la diferencia en errores estándar: \(z\) = (fracción que llegó − \(p\)) ÷ \(SE\). Aquí \(p\) = 0.10 y \(n\) = 200,000.

Al tratamiento llegó 19,400 ÷ 200,000 = 9.7 %. Si el reparto funcionara, sería 10 %, con un error estándar de \(SE\) = √(0.1 × 0.9 ÷ 200,000) ≈ 0.00067, o 0.067 puntos.

La diferencia, 10 − 9.7 = 0.3 puntos, son \(z\) = 0.3 ÷ 0.067 ≈ **4.5 errores estándar**: p-value ≈ 0.00001. No es azar, aunque 9.7 % parezca casi 10 %.

Es un *sample ratio mismatch*: algo pierde publicaciones del tratamiento (por ejemplo, el modelo nuevo es más lento y más requests se cortan antes de quedar en el log). Las que se pierden no son al azar, así que la métrica primaria no se lee hasta encontrar la causa.
? [medio] Un A/B da p-value = 0.03. ¿Cuáles de estas frases son correctas? (a) Hay 3 % de probabilidad de que el modelo nuevo no sirva. (b) Hay 97 % de probabilidad de que el modelo nuevo sea mejor. (c) Si no hubiera ninguna diferencia, una al menos así de grande saldría ≈ 3 % de las veces. (d) El efecto es grande.
Solo la **(c)** es correcta: es la definición del p-value.

- (a) y (b) dan la vuelta a la pregunta. El p-value se calcula suponiendo que no hay efecto; no dice qué tan probable es que lo haya, y eso depende también de qué tan probable era antes de probar.
- (d) No: el p-value mezcla el tamaño del efecto con la cantidad de datos. Con millones de usuarios, un efecto diminuto da un p-value chiquito. El tamaño se lee en la diferencia y su intervalo.
? [medio] Una página de registro convierte 20 % de las visitas. Quieres detectar una subida a 22 % con α = 0.05 y potencia de 80 %. ¿Cuántas visitas por brazo pide la regla de bolsillo? ¿Y para ver de 20 % a 21 %?
Usa la regla de bolsillo \(n ≈ 16 × p × (1 − p) ÷ δ^2\), con \(p\) = 0.20.

Varianza de una visita: \(p × (1 − p)\) = 0.20 × 0.80 = 0.16. MDE: \(δ\) = 2 puntos = 0.02, al cuadrado 0.0004.

Regla de bolsillo: 16 × 0.16 ÷ 0.0004 = **6,400 visitas por brazo** (la fórmula completa, con \(p_1\) = 0.20 y \(p_2\) = 0.22, da 6,510).

Para 20 % → 21 %, \(δ\) = 0.01 es la mitad, así que la muestra es 4 veces más: 16 × 0.16 ÷ 0.01² = 16 × 0.16 ÷ 0.0001 = **25,600 por brazo** (la completa, 25,583).
? [reto] En el golden set de 50,000 fotos, el modelo nuevo acierta solo él en 600 fotos y el actual solo él en 500. ¿Cuánto mejora el nuevo? ¿Es significativo con una prueba pareada? ¿Pasa el gate de Alba, que pide que el extremo de abajo del intervalo pareado no baje de −0.3 puntos? Compáralo con el caso de 1,050 contra 950.
Usa las fórmulas de McNemar: \(z = (b − c) ÷ √(b + c)\), \(Δ = (b − c) ÷ N\) y \(SE_Δ = √(b + c) ÷ N\), con \(b\) = 600, \(c\) = 500 y \(N\) = 50,000.

La mejora es \(Δ\) = (600 − 500) ÷ 50,000 = 100 ÷ 50,000 = **+0.2 puntos**, igual que en el caso de 1,050 contra 950.

:::cuenta McNemar con 1,100 discrepancias
Discrepancias \(b + c\) | 600 + 500 | 1,100
z | \(z = (b − c) ÷ √(b + c)\) = (600 − 500) ÷ √1,100 = 100 ÷ 33.2 | ≈ 3.0
p-value | dos colas, más allá de 3.0 | ≈ 0.003
Error estándar de la diferencia \(SE_Δ\) | √1,100 ÷ 50,000 | ≈ 0.066 puntos
Intervalo de 95 % | \(Δ ± 1.96 × SE_Δ\) = 0.2 ± 1.96 × 0.066 = 0.2 ± 0.13 | +0.07 a +0.33
= Significativo, y el extremo de abajo, +0.07, queda muy por encima de −0.3: pasa el gate.
:::
Con 1,050 contra 950 la mejora era la misma, pero con 2,000 discrepancias: z ≈ 2.24 y p-value ≈ 0.025. Con casi la mitad de discrepancias, la misma diferencia se distingue mejor. Comparadas como muestras independientes (con accuracies de ≈ 85 %), las dos darían el mismo z ≈ 0.89 y p-value ≈ 0.38.
? [reto] Tu jefa quiere un A/B de Alba que vea 0.5 puntos de mejora sobre la aceptación de 70 % (α = 0.05, potencia de 80 %), con solo 10 % del tráfico en el tratamiento, y propone lanzar el modelo la primera mañana que el p-value baje de 0.05. (a) ¿Cuántas publicaciones por brazo pide la fórmula, sin y con el *design effect* de 1.4 de la sección de trampas? (b) ¿En cuánto tiempo las junta el tratamiento? (c) ¿Qué le contestas sobre revisarlo cada mañana, y cuánto debe durar?
**(a)** Usa la fórmula completa de dos proporciones, \(n = (s_α + s_β)^2 ÷ (p_2 − p_1)^2\), con \(p_1\) = 0.70 y \(p_2\) = 0.705, y luego multiplica por el *design effect* \(D\) = 1.4. Con MDE de 0.5 puntos, la fórmula completa da **131,229** publicaciones por brazo (la regla de bolsillo, 16 × 0.21 ÷ 0.005² = 134,400). Con el *design effect*: 131,229 × 1.4 ≈ **183,700**.

Esa fórmula supone brazos iguales. Con un control \(r\) = 9 veces más grande, su ruido casi no pesa y al tratamiento le basta algo más de la mitad. La varianza de la diferencia es la suma de las dos, \(σ^2 ÷ n_T + σ^2 ÷ (r × n_T)\); igualarla a la de dos brazos iguales, \(2σ^2 ÷ n\), da \(n_T = n × (1 + 1/r) ÷ 2\) = 131,229 × (1 + 1/9) ÷ 2 ≈ 73,000 (183,700 × 0.556 ≈ 102,000 con el *design effect*). Usar el número de brazos iguales es ir a la segura.

**(b)** Tiempo = publicaciones que necesita el brazo ÷ publicaciones que recibe al día. El tratamiento recibe 10 % de ≈ 2.5 M publicaciones al día: 0.10 × 2,500,000 = 250,000. 131,229 ÷ 250,000 ≈ 0.52 días ≈ **12.6 horas**; con el *design effect*, 183,700 ÷ 250,000 ≈ 0.73 días ≈ **18 horas**. Con brazos desiguales, 73,000 ÷ 250,000 × 24 ≈ 7 y 102,000 ÷ 250,000 × 24 ≈ 10 horas. El control, con 90 % del tráfico, termina antes.

**(c)** Parar en el primer p-value < 0.05 es peeking: con 14 miradas, las falsas alarmas pasan de 5 % a más de 20 %. La propuesta: fijar desde hoy **dos semanas completas**, aunque la muestra se junte en un día, por el ciclo semanal, el efecto novedad y las recategorizaciones que llegan tarde. Cada mañana sí se miran el reparto y los guardrails, para detener un daño, no para declarar victoria.
:::

## Lo que sigue {What comes next}

- La siguiente lección, «Comparar distribuciones: cómo se mide el drift», usa la prueba chi-cuadrado y otras parecidas para decidir si las fotos de hoy se parecen a las de antes, y explica por qué en monitoreo se alerta por el tamaño del cambio y no por el p-value.
- Después, las lecciones «Gate de evaluación y registry» y «Rollout seguro» lo llevan a la práctica con Alba: la primera arma la comparación pareada sobre el golden set, y la segunda, el camino de shadow, canary y A/B.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
muestra poblacion varianza desviacion-estandar distribucion-normal error-estandar intervalo-confianza ab-test unidad-aleatorizacion hipotesis-nula p-value significancia potencia mde tamano-muestra peeking comparaciones-multiples prueba-pareada
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Un modelo saca 85 % en 1,000 fotos. ¿Por qué con otras 1,000 podría haber sacado 83 %?
Porque son una muestra, y otra muestra trae otras fotos fáciles y difíciles. El error estándar es √(0.85 × 0.15 ÷ 1,000) ≈ 1.1 puntos: un resultado a 2 puntos del 85 cabe en el ±2.2 del intervalo de 95 %.
? Quieres medir con la mitad de ruido. ¿Cuántas fotos más necesitas?
Cuatro veces las fotos, porque el ruido baja con la raíz de n: √4 = 2.
? ¿Qué dice un p-value de 0.03?
Que si no hubiera ninguna diferencia, una al menos así de grande saldría ≈ 3 % de las veces, solo por azar. No es la probabilidad de que el tratamiento funcione, ni dice qué tan grande es el efecto.
? ¿Por qué el A/B de Alba sortea vendedores y no requests?
Para que cada vendedor vea siempre el mismo modelo: por request, Ana vería sugerencias de dos modelos en la misma publicación. Además, el análisis tiene que tomar en cuenta que las publicaciones de un mismo vendedor se parecen entre sí.
? ¿Por qué no se para el A/B el primer día que el p-value baja de 0.05?
Porque cada mirada es otra oportunidad de que el ruido cruce la raya. Mirando 14 días, las falsas alarmas pasan de 5 % a más de 20 %. La duración se fija antes y se decide al final.
? Con 20 métricas a α = 0.05 y ningún efecto real, ¿cuántas falsas alarmas esperas?
Una (20 × 0.05), y hay ≈ 64 % de probabilidad de ver al menos una (1 − 0.95²⁰). Por eso decide una métrica primaria fijada antes.
? ¿Por qué el gate de Alba compara los modelos foto por foto y no con dos intervalos?
Porque los dos modelos se examinan con las mismas fotos, y el ruido de qué fotos tocaron se cancela en la diferencia. Solo cuentan las fotos donde discrepan. Así, 0.4 puntos dan p-value ≈ 8 × 10⁻⁶ pareados y p-value ≈ 0.08 por separado.
:::
