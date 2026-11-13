---
titulo: Comparar distribuciones: cómo se mide el drift
en: Comparing distributions: how drift is measured
subtitulo: Por qué un promedio no basta para saber si cambiaron los datos, cómo se resume en un solo número la diferencia entre dos histogramas (PSI, KL, KS y chi-cuadrado) y cómo se decide si ese número merece una alerta.
pregunta: ¿Cómo se entera un sistema de que las fotos de hoy ya no se parecen a las del entrenamiento, si nadie las ha etiquetado todavía?
requisitos: ruido
---

:::idea
Para saber si los datos de hoy se parecen a los de antes se comparan sus distribuciones completas contra una referencia, y la diferencia se resume en un número como el PSI. Lo que decide una alerta es qué tan grande es el cambio, no si es «significativo»: con millones de datos, casi todo lo es.
:::

## Por qué no basta el promedio {Why the average is not enough}

Alba, la empresa que seguimos en todo el curso, es un marketplace: cuando alguien publica lo que vende, un modelo le sugiere la categoría de cada foto, entre 500 posibles. A ese modelo le llegan ≈ 10 M fotos al día: ≈ 2.5 M publicaciones nuevas con ≈ 3 fotos cada una (≈ 7.5 M), más ≈ 2.5 M que piden otros equipos, como moderación y búsqueda. El modelo, una ResNet-50, aprendió con fotos del pasado. Las [[etiqueta|etiquetas]] buenas de las fotos de hoy (las correcciones de moderadores, las fotos revisadas a mano) llegan días o semanas después.

Mientras tanto, hay una pregunta que no puede esperar: **¿las fotos de hoy se parecen a las de antes?** Si no se parecen, el modelo puede estar fallando más sin que salga un solo error. Es el [[drift]] de la primera lección. Esta lección trata de cómo se mide.

La primera idea es comparar promedios: el brillo promedio de las fotos de hoy contra el de octubre. Es barato. Y no basta.

### Mismo promedio, grupos distintos

Piensa en dos grupos de la prepa con el mismo [[promedio]], 7, en el mismo examen. En el primero, todos sacaron entre 6 y 8. En el segundo, la mitad sacó 4 y la otra mitad 10. El promedio es idéntico y los grupos no se parecen en nada: al maestro del segundo le urge hacer algo, y el promedio no se lo dice.

Lo que hay que comparar es la [[distribucion|distribución]]: qué valores aparecen y qué tan seguido. La forma más simple de verla es un [[histograma]]. Partes los valores posibles en intervalos, que se llaman *bins* (en Prometheus, el programa que guarda las métricas, les dicen [[bucket|buckets]]), y cuentas cuántos datos caen en cada uno.

Para las fotos de Alba, un número fácil de sacar es el **brillo**: el promedio de todos los píxeles de la foto, de 0 (negro) a 255 (blanco). Con 5 bins de ≈ 51 niveles cada uno queda así:

| Bin | Brillo | Qué fotos caen ahí |
|---|---|---|
| 1 | 0 a 50 | Muy oscuras: de noche, sin luz |
| 2 | 51 a 101 | Oscuras |
| 3 | 102 a 152 | Medias |
| 4 | 153 a 203 | Claras |
| 5 | 204 a 255 | Muy claras: con flash, a pleno sol, fondo blanco |

Un detalle importa. No todos los días llega la misma cantidad de fotos (un día pueden ser 10 M y otro la mitad), así que no se comparan conteos: cada conteo se divide entre el total del día. Quedan **proporciones** que suman 1 (o 100 %). Un histograma en proporciones ya es una distribución, y dos distribuciones se comparan bin por bin aunque una tenga el doble de datos.

:::figura distribuciones-mismo-promedio
Arriba, el brillo de octubre: casi todo en medio. Abajo, una semana inventada para el ejemplo, con muchas fotos de noche y muchas con flash. El promedio es el mismo, ≈ 128; la forma no se parece en nada.
:::

Para el modelo, una foto muy oscura y una casi blanca son dos problemas distintos, y en la semana de abajo son el 60 % de todo lo que llega. El promedio dice que todo sigue igual. La [[desviacion-estandar|desviación estándar]] ayuda un poco (pasa de ≈ 56 a ≈ 84 niveles), pero hay distribuciones muy distintas con el mismo promedio y la misma desviación.

La salida general es comparar **los histogramas completos**, bin por bin, y resumir la diferencia en un solo número. Toda esta lección trata de ese número: cómo se calcula, qué tan grande tiene que ser para preocuparse y qué hacer cuando lo es.

### Qué se compara en Alba

Nada de esto necesita etiquetas. Se compara lo que ya tienes en el momento:

- **Lo que entra.** Estadísticas de cada foto: brillo, tamaño en bytes, resolución, formato. Cambian cuando cambia cómo se toman o se suben las fotos.
- **Lo que sale.** La categoría que predice el modelo y su [[confianza]] (el score top-1). Cambian cuando cambia lo que la gente vende, o cuando el modelo empieza a dudar.
- **Lo que el modelo «ve».** Los [[embedding|embeddings]], los 2,048 números que la ResNet-50 calcula antes de su última capa. Atrapan cambios de contenido que el brillo no ve. Hay una sección extra al final.
- **Las etiquetas, cuando llegan.** Son lo único que prueba que el modelo empeoró. Las demás señales son alarmas tempranas.

### La referencia y la ventana actual

Comparar siempre es comparar dos cosas. La [[referencia]] es una muestra de datos «normales»: los datos con los que se entrenó el modelo, o un periodo reciente que se portó bien. La **ventana actual** es el pedazo de datos que revisas ahora: el día de ayer, la última semana, la última hora.

Alba lo hace con un *job* (un programa que corre, termina y se apaga) una vez al día:

:::diagrama distribuciones-job
El job de drift de Alba. Arriba, el camino de cada request, que el job no toca; en medio, la comparación diaria; abajo, lo que pasa cuando la regla se cumple. Toca cada caja o recorre los dos días.
:::

Fíjate en tres decisiones del diagrama, porque se repiten en todo el monitoreo:

1. **El job no está en el camino de Ana.** Lee los registros después, en lote. Medir no puede volver lenta la respuesta.
2. **La alerta pide tres días seguidos.** Un día raro (una campaña, un día festivo) no basta. En una sección extra ves con números por qué esto quita casi todas las falsas alarmas.
3. **La alerta es un ticket, no una llamada a medianoche.** Un histograma movido no tumba el servicio; se analiza con calma.

Elegir la ventana es un intercambio (un *trade-off*). Una ventana corta (una hora) avisa rápido, pero tiene pocos datos y mucho ruido. Una larga (una semana) es estable, pero avisa tarde. Eso, la estacionalidad y la elección de los bins están en una sección extra, con números.

## Logaritmos: la cuenta de los cocientes {Logarithms: the arithmetic of ratios}

Casi todas las medidas de esta lección llevan un logaritmo adentro. Ya los viste de pasada en el [[logit]] y en la [[entropia-cruzada|entropía cruzada]]. Aquí van desde cero, porque sin ellos el PSI es una fórmula mágica.

### Una potencia al revés

Una potencia repite una multiplicación: 2³ = 2 × 2 × 2 = 8. El [[logaritmo]] hace la pregunta al revés: **¿cuántas veces hay que multiplicar el 2 para llegar a 8?** Tres. Se escribe log2 8 = 3 y se lee «logaritmo base 2 de 8».

- log2 1,024 = 10, porque 2¹⁰ = 1,024. En base 2, el logaritmo cuenta duplicaciones.
- log10 1,000 = 3, porque 10³ = 1,000. En base 10, cuenta ceros.
- ln es el logaritmo **natural**, en base e ≈ 2.718, el número que usa el softmax. ln 2 ≈ 0.693 y ln 10 ≈ 2.303. Es el de casi todas las fórmulas de ML y el de la tecla «ln» de la calculadora.

### Las cinco reglas que vas a usar

1. **El logaritmo de 1 es 0**, en cualquier base (ln 1 = 0, log2 1 = 0): para llegar a 1 hay que multiplicar cero veces.
2. **Un número entre 0 y 1 tiene logaritmo negativo.** log2 0.5 = −1: para ir de 1 a 0.5 no multiplicas por 2, divides entre 2 una vez. Con ln pasa lo mismo: ln 0.5 = −0.693.
3. **ln 0 no existe.** Por más veces que dividas, nunca llegas a 0; el logaritmo de un número cada vez más cercano a 0 baja sin fondo, hacia menos infinito. Va a importar con los bins vacíos.
4. **Productos en sumas y cocientes en restas.** ln(a × b) = ln a + ln b, y ln(a ÷ b) = ln a − ln b. Por eso ln(b ÷ a) = −ln(a ÷ b): voltear el cociente solo cambia el signo.
5. **Cambiar de base es dividir.** log2 x = ln x ÷ ln 2.

### Por qué un logaritmo mide cocientes

Piensa en la proporción de fotos de un bin. Si pasa de 10 % a 20 %, se duplicó; si pasa de 20 % a 40 %, también. Las diferencias son de 10 y de 20 puntos, pero los dos cocientes valen 2 y los dos logaritmos valen ln 2 = 0.693. Y si regresa de 20 % a 10 %, el logaritmo da −0.693: el mismo tamaño, con el signo contrario.

Eso es justo lo que necesitamos para comparar distribuciones. Cuatro puntos de diferencia no significan lo mismo en todos lados:

- Una categoría que pasa de 1 % a 5 % se **quintuplicó**: ln 5 = 1.609.
- Una que pasa de 40 % a 44 % creció **10 %**: ln 1.1 = 0.095.

Los mismos 4 puntos, y el logaritmo le da 17 veces más peso al primero. Una categoría rara que se quintuplica es una noticia; una grande que crece un poco, no tanto.

:::cuenta Los logaritmos del resto de la lección
Duplicar // de 10 % a 20 %, o de 20 % a 40 % | ln 2 | 0.693
Partir a la mitad // de 20 % a 10 % | ln 0.5 = −ln 2 | −0.693
Subir de 10 % a 14 % | ln(0.14 ÷ 0.10) = ln 1.4 | 0.336
Bajar de 14 % a 10 % | ln(0.10 ÷ 0.14) = −ln 1.4 | −0.336
Quintuplicar // de 1 % a 5 % | ln 5 | 1.609
Crecer 10 % // de 40 % a 44 % | ln 1.1 | 0.095
Un dado, en bits // cambio de base | log2 6 = ln 6 ÷ ln 2 = 1.792 ÷ 0.693 | 2.585
= Duplicar siempre suma 0.693, venga de donde venga; partir a la mitad siempre resta 0.693. El logaritmo no mira cuántos puntos se movió algo, sino cuántas veces se multiplicó.
:::

:::ojo
**«log» a secas no siempre es lo mismo.** En Python (`math.log`), en NumPy y en casi todos los artículos de ML, «log» es ln. En muchas calculadoras de bolsillo, la tecla «log» es base 10. Revisa cuál es antes de copiar una fórmula: ln 10 = 2.303 y log10 10 = 1.
:::

## Entropía y divergencia KL: medir la sorpresa {Entropy and KL divergence: measuring surprise} [extra]

Esta sección explica de dónde sale la idea del PSI. Si vas en la primera pasada, puedes saltar a la siguiente: el PSI se entiende solo con los logaritmos.

### La sorpresa de un resultado

Cuando te avisan cómo salió algo incierto, el aviso trae más o menos información según qué tan esperado era. «Hoy amaneció» no te dice nada. «Nevó en Cancún» te dice mucho. La teoría de la información, que Claude Shannon publicó en 1948, lo mide así: un resultado con probabilidad \(p\) trae \(log_2(1/p)\) [[bit|bits]] de sorpresa.

- Un volado: p = 1/2, y log2 2 = **1 bit**. Un bit es la sorpresa de una pregunta de sí o no con las dos respuestas igual de probables.
- Una cara de un dado: p = 1/6, y log2 6 ≈ **2.585 bits**.
- Algo con probabilidad 1/1,024: **10 bits**.
- Algo seguro: p = 1, y log2 1 = **0 bits**. No sorprende.

### La entropía: la sorpresa promedio

La [[entropia|entropía]] es la sorpresa que esperas en promedio: cada resultado pesa según qué tan seguido sale. Se suma, sobre todos los resultados, la probabilidad por la sorpresa:

:::formula Entropía
H = sum_{i} p_i × log_2 frac{1}{p_i}
- p_i: la probabilidad del resultado \(i\), como fracción (0.9 si sale el 90 % de las veces)
- log_2(1/p_i): la sorpresa de ese resultado, en bits
- H: la entropía, la sorpresa promedio, en bits
:::

:::cuenta La entropía de una moneda cargada 90/10
Águila // sale 90 % de las veces: \(p\) = 0.9 | \(p × log_2(1/p)\) = 0.9 × log2(1 ÷ 0.9) = 0.9 × 0.152 | 0.137
Sol // sale 10 % de las veces: \(p\) = 0.1 | 0.1 × log2(1 ÷ 0.1) = 0.1 × 3.322 | 0.332
Entropía \(H\) // la suma de los dos resultados | 0.137 + 0.332 | **0.469 bits**
= Menos de la mitad que una moneda justa (1 bit). Casi siempre sabes qué va a salir, así que cada volado trae poca información. El sol, cuando sale, sorprende mucho (3.3 bits), pero sale poco.
:::

Dos reglas para leerla:

- **Es máxima cuando todo es igual de probable.** Con \(K\) resultados parejos, cada uno con \(p = 1/K\), vale \(H = log_2 K\): 1 bit la moneda, 2.585 el dado, ≈ 8.97 bits si las 500 categorías de Alba fueran igual de probables.
- **Vale 0 cuando un resultado es seguro.**

Un truco útil: **2 elevado a la entropía**, \(2^H\), dice «esto es como elegir al azar entre tantas opciones parejas». La moneda 90/10 tiene \(2^{0.469}\) ≈ 1.38: es casi como no tener opciones.

En Alba la entropía tiene un uso directo: medir qué tan indeciso está el modelo con una foto. Su [[softmax]] reparte la probabilidad entre las categorías, y la entropía de ese reparto resume la duda en un número.

- Una foto segura, con (0.94, 0.03, 0.02, 0.01) en sus cuatro primeras categorías: **0.41 bits**, como dudar entre 1.33 opciones.
- Una foto dudosa, con (0.40, 0.35, 0.15, 0.10): **1.80 bits**, como dudar entre 3.5.

Sirve para elegir qué fotos etiquetar: el [[active-learning]] (mandar a etiquetar primero las fotos que más le enseñan al modelo) busca las inciertas. También sirve de señal temprana, como la tasa de fotos con baja confianza (top-1 menor que 0.3) que vigila Alba: si la entropía promedio de las predicciones sube, el modelo duda más de lo normal. (Para no cargar la cuenta, aquí solo cuentan las 4 primeras categorías; el reparto real tiene 500.)

:::calculadora distribuciones-entropia
:::

```python
import math

def entropia(p):
    """Sorpresa promedio, en bits: la suma de p × log2(1/p)."""
    return sum(x * math.log2(1 / x) for x in p if x > 0)

casos = {
    "moneda justa": [0.5, 0.5],
    "moneda 90/10": [0.9, 0.1],
    "dado": [1 / 6] * 6,
    "500 categorías parejas": [1 / 500] * 500,
    "foto segura (Alba)": [0.94, 0.03, 0.02, 0.01],
    "foto dudosa (Alba)": [0.40, 0.35, 0.15, 0.10],
}
for nombre, p in casos.items():
    h = entropia(p)
    print(f"{nombre:23} {h:5.3f} bits   ≈ {2 ** h:6.2f} opciones parejas")
```

```salida
moneda justa            1.000 bits   ≈   2.00 opciones parejas
moneda 90/10            0.469 bits   ≈   1.38 opciones parejas
dado                    2.585 bits   ≈   6.00 opciones parejas
500 categorías parejas  8.966 bits   ≈ 500.00 opciones parejas
foto segura (Alba)      0.415 bits   ≈   1.33 opciones parejas
foto dudosa (Alba)      1.802 bits   ≈   3.49 opciones parejas
```

### La divergencia KL: la sorpresa de más

Ahora son dos distribuciones. P es lo que de verdad pasa. Q es lo que esperabas: tu referencia. Si te preparaste para Q, cada resultado te sorprende \(ln(1/q)\) en vez de \(ln(1/p)\). La diferencia es \(ln(p/q)\), y su promedio con el peso de P es la [[divergencia-kl|divergencia KL]] (de Kullback y Leibler, que la publicaron en 1951):

:::formula Divergencia KL
text{KL}(P ‖ Q) = sum_{i} p_i × ln frac{p_i}{q_i}
- p_i: la probabilidad del resultado \(i\) en P, lo que de verdad pasa, como fracción
- q_i: la probabilidad del mismo resultado en Q, lo que esperabas, como fracción
- ln(p_i/q_i): la sorpresa de más que te llevas con ese resultado, en nats
:::

Se lee «KL de P contra Q». Aquí usamos ln, y la unidad se llama *nat* (1 nat ≈ 1.44 bits): es la misma cuenta que con log2, en otra unidad, como kilómetros y millas. Vale 0 solo si P y Q son iguales, y nunca es negativa.

Un ejemplo con la mezcla de categorías de Alba, con números inventados para la cuenta: en octubre, 60 % de las fotos son ropa, 39 % calzado y 1 % juguetes. En diciembre, 55 %, 35 % y 10 %.

:::cuenta La KL de diciembre contra octubre
Ropa // \(p\) = 0.55 en diciembre, \(q\) = 0.60 en octubre | \(p × ln(p/q)\) = 0.55 × ln(0.55 ÷ 0.60) | −0.0479
Calzado // \(p\) = 0.35, \(q\) = 0.39 | 0.35 × ln(0.35 ÷ 0.39) | −0.0379
Juguetes // \(p\) = 0.10, \(q\) = 0.01 | 0.10 × ln(0.10 ÷ 0.01) = 0.10 × 2.303 | 0.2303
KL(dic ‖ oct) // la suma de los tres | −0.0479 − 0.0379 + 0.2303 | **0.1445**
KL(oct ‖ dic) // al revés: ahora \(p\) es octubre y \(q\) diciembre | 0.60 × ln(0.60 ÷ 0.55) + 0.39 × ln(0.39 ÷ 0.35) + 0.01 × ln(0.01 ÷ 0.10) | **0.0714**
= Cambiar el orden cambia el número: **la KL no es simétrica**. Algunos términos salen negativos; el total nunca.
:::

¿Por qué no es simétrica? Porque pesa con las probabilidades del primero. En KL(dic ‖ oct) lo que más cuenta es lo que en diciembre pasa seguido y octubre creía raro: los juguetes, que aportan 0.23 de los 0.14 totales (los otros dos términos restan). Al revés, los juguetes pesan con el 1 % de octubre y casi no cuentan.

Y si la referencia dice que algo **nunca** pasa (q = 0) y pasa, la KL es infinita: ln(p ÷ 0) no existe. Es el problema de los bins vacíos, que vuelve a salir en el PSI.

El PSI de la sección siguiente es, de hecho, **una KL de ida y vuelta**: \(text{PSI} = text{KL}(P ‖ Q) + text{KL}(Q ‖ P)\), con P la ventana actual y Q la referencia. Con los juguetes, 0.1445 + 0.0714 ≈ 0.216; en la semana de noche de esa sección, 0.1168 + 0.1084 = 0.2252. Por eso el PSI sí es simétrico: da lo mismo cuál histograma llames «referencia». Y por eso hereda el problema del cero.

:::nota La entropía cruzada era una KL
En la lección de cómo aprende un modelo viste la [[entropia-cruzada]]: el promedio de ln(1 ÷ q) cuando la realidad es P. Es exactamente la entropía de P más la KL: \(text{entropía cruzada} = H(P) + text{KL}(P ‖ Q)\). En el ejemplo de los juguetes, con ln en vez de log2: \(H(P)\) = 0.55 × ln(1 ÷ 0.55) + 0.35 × ln(1 ÷ 0.35) + 0.10 × ln(1 ÷ 0.10) ≈ 0.927, y 0.927 + 0.145 = 1.071 nats. Como H(P) no depende del modelo, entrenar un clasificador con entropía cruzada es bajar la KL entre lo que de verdad pasa y lo que el modelo predice.
:::

### Jensen–Shannon: la prima simétrica

Hay una versión simétrica, la divergencia de **Jensen–Shannon**. Promedias las dos distribuciones y mides cada una contra ese promedio:

:::formula Divergencia de Jensen–Shannon
M = frac{P + Q}{2}
text{JS} = frac{1}{2} text{KL}(P ‖ M) + frac{1}{2} text{KL}(Q ‖ M)
- P, Q: las dos distribuciones que comparas
- M: su promedio, resultado por resultado
- text{JS}: la divergencia, en nats
:::

Tiene tres ventajas:

- **Es simétrica**: da lo mismo P contra Q que Q contra P.
- **Nunca es infinita**, porque M tiene algo donde P o Q tengan algo. Un bin vacío no la rompe.
- **Tiene techo**: no pasa de ln 2 ≈ 0.693 nats (1 bit), que es lo que da cuando P y Q no comparten nada.

En el ejemplo de los juguetes, M = ((0.55 + 0.60) ÷ 2, (0.35 + 0.39) ÷ 2, (0.10 + 0.01) ÷ 2) = (0.575, 0.37, 0.055). Con la fórmula de la KL, KL(P ‖ M) ≈ 0.0159 y KL(Q ‖ M) ≈ 0.0290, así que JS ≈ ½ × 0.0159 + ½ × 0.0290 ≈ 0.022 nats. Herramientas de monitoreo como Evidently la usan para columnas de categorías. Ojo: algunas reportan su raíz cuadrada, que se llama distancia de Jensen–Shannon (aquí, √0.022 ≈ 0.15 con ln, o ≈ 0.18 si se mide en bits). Antes de copiar un umbral, revisa cuál de las dos te dan y en qué unidad.

## El PSI paso a paso {PSI step by step}

El [[psi|PSI]] (*Population Stability Index*, índice de estabilidad de la población) es una de las medidas de drift más usadas en la industria. Viene de los bancos: lo usan para vigilar si la gente que pide un crédito hoy se parece a aquella con la que se construyó el modelo de riesgo. Su fórmula es una suma, bin por bin:

:::formula PSI
text{PSI} = sum_{i} (a_i − e_i) × ln frac{a_i}{e_i}
- e_i: la proporción **esperada** del bin \(i\): la de la referencia, como fracción (0.10 para 10 %)
- a_i: la proporción **actual** del bin \(i\): la de la ventana actual, como fracción
- text{PSI}: la suma de lo que aporta cada bin; sin unidad
:::

Cada término tiene dos piezas:

- **La diferencia**, \(a_i − e_i\): cuántos puntos se movió el bin.
- **El logaritmo del cociente**, \(ln(a_i/e_i)\): cuántas veces se multiplicó.

Las dos tienen siempre el mismo signo. Si el bin creció, las dos son positivas. Si se encogió, las dos son negativas, y negativo por negativo es positivo. Por eso **cada bin aporta algo mayor o igual a 0**, crezca o se encoja, y el PSI solo vale 0 si los dos histogramas son idénticos.

### Una semana de fotos de noche

Llega noviembre. Oscurece más temprano y muchos vendedores toman la foto en casa, de noche. Nadie tocó el modelo. El brillo de esta semana contra el de octubre (los porcentajes son de ejemplo):

| Bin | Esperado (octubre) | Actual (esta semana) |
|---|---|---|
| 1 · muy oscuras | 10 % | 22 % |
| 2 · oscuras | 20 % | 30 % |
| 3 · medias | 40 % | 30 % |
| 4 · claras | 20 % | 12 % |
| 5 · muy claras | 10 % | 6 % |

:::cuenta El PSI de la semana de noche
Bin 1 · muy oscuras // \(e\) = 0.10, \(a\) = 0.22 | \((a − e) × ln(a/e)\) = (0.22 − 0.10) × ln(0.22 ÷ 0.10) = 0.12 × 0.789 | 0.0946
Bin 2 · oscuras // \(e\) = 0.20, \(a\) = 0.30 | (0.30 − 0.20) × ln(0.30 ÷ 0.20) = 0.10 × ln 1.5 = 0.10 × 0.405 | 0.0405
Bin 3 · medias // \(e\) = 0.40, \(a\) = 0.30 | (0.30 − 0.40) × ln(0.30 ÷ 0.40) = (−0.10) × ln 0.75 = (−0.10) × (−0.288) | 0.0288
Bin 4 · claras // \(e\) = 0.20, \(a\) = 0.12 | (0.12 − 0.20) × ln(0.12 ÷ 0.20) = (−0.08) × ln 0.6 = (−0.08) × (−0.511) | 0.0409
Bin 5 · muy claras // \(e\) = 0.10, \(a\) = 0.06 | (0.06 − 0.10) × ln(0.06 ÷ 0.10) = (−0.04) × ln 0.6 = (−0.04) × (−0.511) | 0.0204
PSI // la suma de los cinco bins | 0.0946 + 0.0405 + 0.0288 + 0.0409 + 0.0204 | **0.2252**
= PSI ≈ 0.23: un cambio moderado. Alba actúa cuando su PSI pasa de 0.2 tres días seguidos, y este lo pasa. Una semana normal da ≈ 0.002.
:::

:::figura distribuciones-psi
Arriba, los dos histogramas. Abajo, lo que aporta cada bin. El de las muy oscuras aporta más que ningún otro: más que se duplicó.
:::

Mira los bins 4 y 5. Los dos se encogieron a 0.6 veces lo que eran (el mismo logaritmo, −0.511), pero el 4 aporta el doble porque perdió el doble de puntos. **El logaritmo pone el peso por cociente; la diferencia, por tamaño.** El PSI necesita las dos cosas para que un bin grande que se mueve poco y uno chico que se dispara cuenten lo que deben.

### Cómo se lee un PSI

| PSI | Lectura habitual |
|---|---|
| Menos de 0.1 | Estable: ruido normal |
| De 0.1 a 0.25 | Cambio moderado: hay que mirar |
| Más de 0.25 | Cambio grande |

Estos cortes son **costumbre, no ley**: vienen de la práctica de los bancos y se repiten como punto de partida. Muchos equipos actúan desde 0.2, como Alba: más de 0.2 tres días seguidos abre un ticket. Lo correcto es calibrarlo: mirar cuánto se mueve el PSI en semanas normales y poner el umbral arriba de eso. El número también depende de cuántos bins uses y de cuántos datos tengas, así que un umbral no se copia de un sistema a otro.

Para las categorías se hace igual: cada categoría es un bin. Alba calcula cada día el PSI de la mezcla de categorías que predice. Si «Celulares» era el 10 % de las predicciones (\(e\) = 0.10) y hoy es el 14 % (\(a\) = 0.14), ese bin aporta \((a − e) × ln(a/e)\) = (0.14 − 0.10) × ln 1.4 = 0.04 × 0.336 ≈ **0.013**.

:::calculadora distribuciones-psi
:::

### En Python

```python
import math

def psi(esperado, actual, eps=1e-4):
    """PSI de dos histogramas, cada uno en proporciones que suman 1."""
    total = 0.0
    for e, a in zip(esperado, actual):
        e, a = max(e, eps), max(a, eps)   # un bin en 0 haría ln(0)
        total += (a - e) * math.log(a / e)
    return total

ref    = [0.10, 0.20, 0.40, 0.20, 0.10]   # brillo: 4 semanas de octubre
normal = [0.11, 0.19, 0.41, 0.19, 0.10]   # una semana cualquiera
noche  = [0.22, 0.30, 0.30, 0.12, 0.06]   # una semana de noviembre
print("semana normal:  ", round(psi(ref, normal), 4))
print("semana de noche:", round(psi(ref, noche), 4))

vacio = [0.00, 0.25, 0.45, 0.20, 0.10]    # nadie cayó en el bin 1
for eps in [1e-3, 1e-4, 1e-6]:
    print(f"bin vacío con eps = {eps:g}:", round(psi(ref, vacio, eps), 2))
```

```salida
semana normal:   0.0022
semana de noche: 0.2252
bin vacío con eps = 0.001: 0.47
bin vacío con eps = 0.0001: 0.71
bin vacío con eps = 1e-06: 1.17
```

Mira las últimas tres líneas. Con un bin vacío, el PSI depende del piso que elegiste para no calcular ln(0): **0.47, 0.71 o 1.17**, con los mismos datos. Ese número dice más de qué tan chico pusiste el piso que de qué tanto cambió el mundo. Cómo se evita está en «Errores comunes».

## La prueba KS y la trampa del n enorme {The KS test and the huge-n trap}

El PSI mide **cuánto** cambió. Las pruebas estadísticas de la lección de ruido responden otra pregunta: **¿hay evidencia de que** cambió? Para un número como el brillo, la que más vas a oír en monitoreo es la prueba KS. Sirve, y tiene una trampa que hay que conocer antes de colgarle una alerta.

### La curva acumulada

Para un número como el brillo hay una forma de comparar sin elegir bins: la **curva acumulada** (en inglés, *CDF*, de *cumulative distribution function*). Para cada valor \(x\), dice qué fracción de los datos es menor o igual a \(x\): \(F(x)\) = (cuántos datos valen \(x\) o menos) ÷ \(n\), con \(n\) datos en la muestra. Empieza en 0, termina en 1 y sube un escalón por cada dato.

Con 5 fotos de la referencia, de brillo 60, 95, 120, 140 y 175: hasta 59 vale 0, porque ninguna foto tiene ese brillo o menos. En 60 sube a 0.2 (1 de 5). En 95, a 0.4. En 120, a 0.6. En 140, a 0.8. En 175, a 1: ya pasaron todas. Cada dato es su propio escalón; no hay bins que elegir.

### La prueba KS: la distancia más grande

La [[prueba-ks|prueba de Kolmogorov–Smirnov]] (KS) pone juntas dos curvas acumuladas, la de la referencia y la de la ventana actual, y busca dónde se separan más. Esa distancia vertical máxima se llama **D**:

:::formula Distancia KS
D = max_{x} |F_{ref}(x) − F_{act}(x)|
- x: cada valor que aparece en alguna de las dos muestras (aquí, un brillo de 0 a 255)
- F_{ref}(x): la curva acumulada de la referencia en \(x\): la fracción de sus datos que valen \(x\) o menos, de 0 a 1
- F_{act}(x): lo mismo para la ventana actual
- D: la diferencia más grande, sin signo, entre las dos curvas
:::

D va de 0 (curvas idénticas) a 1 (todos los datos de una muestra quedan antes que todos los de la otra).

Las 5 fotos de esta semana tienen brillo 20, 40, 55, 100 y 125: son más oscuras. Basta revisar cada valor que aparece en alguna de las dos muestras, porque entre dos valores seguidos ninguna curva cambia.

:::cuenta D con cinco fotos por lado
En 20 // \(F_{ref}\) y \(F_{act}\): fotos con ese brillo o menos, de 5 en cada lado; el resultado es su diferencia, sin signo | 0 de 5 y 1 de 5 | 0.2
En 40 | 0 de 5 y 2 de 5 | 0.4
En 55 | 0 de 5 y 3 de 5 | **0.6**
En 60 | 1 de 5 y 3 de 5 | 0.4
En 95 | 2 de 5 y 3 de 5 | 0.2
En 100 | 2 de 5 y 4 de 5 | 0.4
En 120 | 3 de 5 y 4 de 5 | 0.2
En 125 | 3 de 5 y 5 de 5 | 0.4
En 140 | 4 de 5 y 5 de 5 | 0.2
En 175 | 5 de 5 y 5 de 5 | 0
= D = 0.6, la diferencia más grande de la tabla, en un brillo de 55: ahí ya pasaron 3 de las 5 fotos de esta semana y ninguna de la referencia.
:::

:::figura distribuciones-ks
Las dos curvas acumuladas. La de esta semana (punteada) sube antes porque sus fotos son más oscuras. La distancia vertical más grande, D = 0.6, está en un brillo de 55.
:::

¿Una D de 0.6 es mucho? Con 5 fotos por lado, no tanto. La prueba pregunta: si las dos muestras salieran de la misma distribución, ¿qué tan seguido saldría una D así de grande por pura suerte? Con muestras chicas se puede contar. Hay 252 formas de repartir 10 fotos en dos grupos de 5 (10 × 9 × 8 × 7 × 6 ÷ (5 × 4 × 3 × 2 × 1) = 252), todas igual de probables si nada cambió; si las revisas una por una, 90 dan D ≥ 0.6. El [[p-value]] es 90 ÷ 252 ≈ **0.36**: pasa más de una vez de cada tres sin que nada cambie. Con 5 por lado, solo una separación total (D = 1, que sale en 2 de las 252 formas, p ≈ 0.008) pasaría el corte de 0.05 de la lección de ruido.

### La trampa del n enorme

Con muestras grandes no se cuenta: hay una fórmula. La D mínima para que la prueba diga «significativo» al 5 % es \(D_{min} ≈ 1.36 × sqrt{2/n}\), con \(n\) datos en cada lado. Por ejemplo, con \(n\) = 1,000: 1.36 × √(2 ÷ 1,000) = 1.36 × 0.0447 ≈ 0.061.

| Datos por lado \(n\) | D mínima para «significativo», \(D_{min}\) |
|---|---|
| 5 | ≈ 0.86 (con n tan chico, la cuenta exacta pide D = 1) |
| 1,000 | 0.061 |
| 1,000,000 | 0.0019 |
| 10,000,000 | 0.0006 |

El umbral se encoge como \(1/sqrt{n}\): cien veces más datos, un umbral diez veces más chico. Y Alba recibe ≈ 10 M fotos al día.

Con 1 millón de fotos por lado, una corrida del promedio de 0.02 desviaciones estándar (en el brillo, ≈ 1 nivel de 255: nadie lo notaría, y al modelo no le hace nada) da D ≈ 0.008, cuatro veces el umbral, con un p-value de ≈ 8 × 10⁻²⁹. **Significativo e irrelevante.** Con 1,000 por lado, la misma corrida da D ≈ 0.045, debajo del umbral de 0.061: ruido.

```python
import math, random

def ks(a, b):
    """D: la distancia vertical más grande entre las dos curvas acumuladas."""
    a, b = sorted(a), sorted(b)
    i = j = 0
    d = 0.0
    while i < len(a) and j < len(b):
        x = min(a[i], b[j])                    # el siguiente valor, de cualquiera de las dos
        while i < len(a) and a[i] <= x: i += 1
        while j < len(b) and b[j] <= x: j += 1
        d = max(d, abs(i / len(a) - j / len(b)))
    return d

print("5 fotos contra 5:", ks([60, 95, 120, 140, 175], [20, 40, 55, 100, 125]))

random.seed(7)
for n in [1_000, 1_000_000]:
    ref = [random.gauss(0, 1) for _ in range(n)]
    hoy = [random.gauss(0.02, 1) for _ in range(n)]   # la media se corre 0.02 σ: nada
    umbral = 1.36 * math.sqrt(2 / n)                  # D mínima para «significativo»
    print(f"n = {n:>9,}   D = {ks(ref, hoy):.4f}   umbral = {umbral:.4f}")
```

```salida
5 fotos contra 5: 0.6
n =     1,000   D = 0.0450   umbral = 0.0608
n = 1,000,000   D = 0.0081   umbral = 0.0019
```

El [[p-value]] mide cuánta evidencia tienes de que **hay** una diferencia, y con n enorme casi siempre la hay: el mundo nunca es idéntico de un día a otro. Lo que importa para decidir es **cuánto** cambió. Por eso en monitoreo se usa D (o el PSI) como tamaño del cambio, con un umbral calibrado en semanas normales, y no el p-value.

:::calculadora distribuciones-ks
:::

Las categorías tienen su propia prueba, la chi-cuadrado, con la misma trampa. Y hacer muchas pruebas a la vez trae otra: falsas alarmas todos los días. Las dos están en la sección extra que sigue; para la primera pasada basta la regla de esta: **se alerta por el tamaño del cambio, no por el p-value.**

## Chi-cuadrado y las falsas alarmas {Chi-square and false alarms} [extra]

Esta sección completa la anterior con dos cosas: la prueba para categorías y lo que pasa cuando haces muchas pruebas a la vez.

### Chi-cuadrado para categorías

La categoría que predice el modelo no tiene curva acumulada: «Ropa» no es menor ni mayor que «Calzado». Para categorías se usa la [[chi-cuadrado|prueba chi-cuadrado]] (se escribe χ², con la letra griega ji, que en estadística se lee «chi»; la propuso Karl Pearson en 1900). Compara los conteos de hoy contra los que esperarías si nada hubiera cambiado:

:::formula Chi-cuadrado
E_i = n × e_i
χ^2 = sum_{i} frac{(O_i − E_i)^2}{E_i}
- n: cuántas predicciones hay hoy
- e_i: la proporción de la categoría \(i\) en la referencia, como fracción (la misma \(e_i\) del PSI)
- E_i: cuántas predicciones **esperabas** en la categoría \(i\) si nada hubiera cambiado
- O_i: cuántas **observaste** hoy en esa categoría
- χ^2: el total, que se compara con un **valor crítico**
:::

El valor crítico sale de una tabla. Con \(K\) categorías se busca con \(K − 1\) «grados de libertad»: con 5 categorías son 4, y el corte al 5 % es 9.49.

Para monitorear, Alba agrupa sus 500 categorías en ≈ 30 categorías padre, para no pelear con 500 bins. Un ejemplo con 5 de ellas: en la referencia, Ropa 30 %, Calzado 20 %, Hogar 20 %, Electrónica 20 % y Juguetes 10 %. Hoy, Ropa baja a 29 % y Juguetes sube a 11 %. Un punto de diferencia en dos categorías: nada que importe.

:::cuenta El mismo cambio, con 1,000 y con 100,000 predicciones
Ropa, con \(n\) = 1,000 // \(E\) = 1,000 × 0.30 = 300; \(O\) = 1,000 × 0.29 = 290 | \((O − E)^2/E\) = (290 − 300)² ÷ 300 | 0.33
Juguetes, con \(n\) = 1,000 // \(E\) = 1,000 × 0.10 = 100; \(O\) = 1,000 × 0.11 = 110 | (110 − 100)² ÷ 100 | 1.00
Las otras tres // \(O = E\): llegaron justo las esperadas | 0 | 0
\(χ^2\) con \(n\) = 1,000 // la suma | 0.33 + 1.00 + 0 | **1.33**
\(χ^2\) con \(n\) = 100,000 // Ropa: \(E\) = 30,000, \(O\) = 29,000. Juguetes: \(E\) = 10,000, \(O\) = 11,000 | (29,000 − 30,000)² ÷ 30,000 + (11,000 − 10,000)² ÷ 10,000 = 33.3 + 100 | **133.3**
PSI, en los dos casos // no depende de \(n\); Ropa \(e\) = 0.30, \(a\) = 0.29; Juguetes \(e\) = 0.10, \(a\) = 0.11 | (0.29 − 0.30) × ln(0.29 ÷ 0.30) + (0.11 − 0.10) × ln(0.11 ÷ 0.10) | 0.0013
= Contra el corte de 9.49: con 1,000 predicciones, 1.33 no llega (p ≈ 0.86, nada). Con 100,000, 133 lo rebasa por mucho (p ≈ 8 × 10⁻²⁸). El cambio es el mismo, y diminuto.
:::

Fíjate en una coincidencia que no lo es: 1.33 ÷ 1,000 = 0.00133, casi el PSI. Para cambios chicos, **chi-cuadrado ≈ n × PSI**: \(χ^2 ≈ n × text{PSI}\). El PSI es el tamaño del cambio; el chi-cuadrado es el tamaño del cambio por la cantidad de datos. Con las ≈ 10 M predicciones diarias de Alba, este mismo cambio de un punto daría un chi-cuadrado de ≈ 10,000,000 × 0.00133 ≈ 13,000.

:::profundo Por qué chi-cuadrado ≈ n × PSI
Cuando un bin cambia poco, el actual es el esperado más un pedacito: a = e + d. Y el logaritmo de algo muy cercano a 1 es casi lo que le sobra: ln 1.1 ≈ 0.095, casi 0.1; ln 1.01 ≈ 0.00995, casi 0.01. Así que ln(a ÷ e) = ln(1 + d ÷ e) ≈ d ÷ e, y cada término del PSI, d × ln(a ÷ e), vale ≈ d² ÷ e. La suma de d² ÷ e es justo lo que suma el chi-cuadrado, pero con proporciones en vez de conteos. Pasar de proporciones a conteos multiplica cada término por n. Con los juguetes del ejemplo: 0.01² ÷ 0.10 = 0.001, contra el término exacto del PSI, 0.01 × ln 1.1 ≈ 0.00095.
:::

### Muchas pruebas, muchas falsas alarmas

Hay una segunda trampa, y la viste en la lección de ruido con otro nombre: las [[comparaciones-multiples|comparaciones múltiples]]. Supón que un sistema hace \(k\) pruebas al día, cada una con probabilidad \(α\) de dar falsa alarma. Aunque nada cambie, esperas \(k × α\) falsas alarmas al día, y la probabilidad de al menos una en un día es \(1 − (1 − α)^k\) (uno menos la probabilidad de que ninguna suene). Con números de ejemplo, \(k\) = 12 pruebas (3 fuentes de datos × 4 estadísticas) y \(α\) = 0.05:

- Esperas 12 × 0.05 = 0.6 falsas alarmas al día; en un mes de 30 días, 0.6 × 30 = **≈ 18 al mes**.
- La probabilidad de al menos una en un día es 1 − 0.95¹² ≈ **46 %**.

Así nace la **fatiga de alertas**: después de la décima falsa alarma, nadie mira la undécima, que puede ser la buena. Las defensas habituales:

1. **Umbrales de tamaño del cambio** (PSI, D, una distancia) en vez de p-values.
2. **Exigir que el cambio se sostenga**, como los 3 días seguidos que pide Alba: un día raro no basta.
3. **Corregir por comparaciones múltiples** si de todos modos usas p-values.
4. **Agrupar**: una alerta por fuente con todas sus estadísticas, no doce alertas sueltas.

Pedir 3 días seguidos rinde mucho. Si una prueba da falsa alarma el 5 % de los días y los días fueran independientes, que dé falsa alarma 3 días seguidos pasaría \(α^3\) = 0.05³ = 0.000125, 1 vez de cada 8,000. Con 12 pruebas durante 30 días, eso es 12 × 30 × 0.000125 ≈ 0.045 falsas alarmas al mes en vez de 18: una cada 1 ÷ 0.045 ≈ 22 meses, casi dos años. En la vida real los días no son del todo independientes (comparten la referencia y las mismas modas), así que la ganancia es menor, pero sigue siendo enorme.

Las herramientas maduras ya vienen así. Evidently, una librería abierta de monitoreo, usa la prueba KS solo con muestras de hasta 1,000 datos; con más, usa una distancia con umbral fijo (la de Wasserstein: cuánta masa hay que mover, y qué tan lejos, para convertir un histograma en el otro).

## Qué cambió: cuatro diagnósticos {What changed: four diagnoses} [extra]

En la primera lección le llamamos [[drift]] a todo cambio del mundo. Para operar un modelo conviene partirlo en piezas, porque cada una se detecta distinto y se arregla distinto. Primero, una notación de tres piezas, que es toda la que hace falta:

- **x** es la entrada: la foto; en un sistema que detecta fraude en pagos con tarjeta, el pago con sus [[feature|features]].
- **y** es la respuesta correcta: la categoría; en el de fraude, si fue fraude o no.
- **p(x)** dice qué tan seguido llega cada tipo de entrada. **p(y)**, qué tan seguido es cada respuesta. **p(y | x)** (la barra se lee «dado») dice, para una entrada, qué tan probable es cada respuesta: es **la regla** que el modelo aprendió.

### Data drift: cambian las entradas

Cambia p(x) y la regla no. También se le dice *covariate shift*. Es el drift de la primera lección.

- **Alba:** la semana de noche. O un celular muy popular que toma fotos con otros colores. Los tenis siguen siendo tenis; se ven distinto.
- **Fraude en pagos:** el Buen Fin trae tickets más altos, muchas tarjetas nuevas y más compras por comercio. Las entradas se mueven, pero un fraude sigue pareciéndose a un fraude.

Se detecta comparando las entradas contra la referencia (PSI, KS, embeddings). No necesitas etiquetas para verlo; sí para saber si dañó.

### Label shift: cambia cuánto hay de cada clase

Cambia p(y), y cómo se ve cada clase no cambia. Es el [[label-shift]] (*prior shift*).

- **Alba:** supón que en diciembre «Juguetes» pasa de 1 % a 10 % de las fotos. Cada juguete se ve como un juguete de octubre; solo hay más.
- **Fraude en pagos:** una ola de ataques sube la proporción de pagos fraudulentos, aunque cada fraude se vea como los de siempre.

Se sospecha viendo la mezcla de predicciones y se confirma con etiquetas. Lo que más afecta son los [[umbral|umbrales]] y la [[calibracion]]: un modelo que aprendió que los juguetes son el 1 % les da menos probabilidad de la que merecen cuando son el 10 %.

### Concept drift: cambia la regla

Cambia p(y | x): la misma entrada ahora merece otra respuesta. Es el [[concept-drift]].

- **Alba:** moderación decide que las fundas de celular ya no van en «Celulares», sino en «Accesorios para celular». La foto es idéntica; la respuesta correcta cambió.
- **Fraude en pagos:** los defraudadores aprenden tus cortes. Si el sistema se pone estricto desde US$100, compran a US$95–99; si bloquea desde 5 intentos por minuto, mandan 4. La compra se ve normal y ahora es fraude más seguido.

Aquí está lo incómodo: en un concept drift puro **las entradas no se mueven**, así que el PSI puede quedarse en 0 mientras el modelo empeora. Solo se ve con etiquetas (la métrica cae) o con señales indirectas, como más correcciones de personas. En la detección de fraude, las etiquetas buenas (los contracargos: cuando el dueño de la tarjeta reclama un cargo que no hizo) tardan hasta 90 días en llegar; por eso se vigila lo que llega antes, como las tasas de rechazo por segmento y la acumulación de compras justo debajo de cada corte. Lo natural es que una distribución se mueva entera; lo de un adversario es que se amontone en un borde.

### Training-serving skew: cambió tu código

No cambió el mundo: tu sistema prepara los datos distinto al servir que al entrenar. Es el [[training-serving-skew]] de [la lección de imágenes](/imagenes/).

- **Alba:** una versión nueva del gateway (el servicio que recibe la foto y se la pasa al modelo) lee las fotos en orden [[bgr|BGR]]. El modelo baja de 85 % a 80 % de aciertos y en los registros no hay un solo error.
- **Fraude en pagos:** cuando al servicio en línea se le acaba el tiempo para leer una feature, manda 0, y en el entrenamiento ese hueco tenía otro valor. O cuenta el pago actual dentro de sus propios conteos en un lado y no en el otro, y todos los conteos quedan corridos en 1.

Un detector de drift lo reporta igual que un drift de verdad, y reentrenar no lo arregla: lo esconde. Se separa pasando los mismos ejemplos por los dos caminos ([[prueba-paridad]]). Suele empezar justo con un [[deploy]].

### Los cuatro, lado a lado

| | Data drift | Label shift | Concept drift | Skew |
|---|---|---|---|---|
| Qué cambia | p(x): las entradas | p(y): la mezcla de clases | p(y \| x): la regla | Tu código |
| Cómo se ve | PSI o KS de las entradas, embeddings | La mezcla de predicciones | La métrica cae y las entradas no se mueven | La paridad falla; suele empezar con un deploy |
| ¿Etiquetas? | Para verlo no; para saber si dañó, sí | Para sospecharlo no; para confirmarlo, sí | Sí, siempre | No |
| Qué haces | Etiquetar lo nuevo y, si dañó, reentrenar | Revisar umbrales y calibración | Reetiquetar con la regla nueva y reentrenar | Arreglar el código y agregar una prueba |

:::diagrama distribuciones-diagnostico
Cuando algo se mueve, se revisa en este orden: primero tu propio código, luego las entradas, luego la mezcla de predicciones y al final las etiquetas. Recorre los cuatro casos.
:::

:::ojo
**Drift no quiere decir que el modelo empeoró.** Un detector de drift compara distribuciones; no sabe nada de tu [[accuracy]]. Si los vendedores de Alba empiezan a subir fotos mejor iluminadas, el PSI del brillo sube y el modelo probablemente acierta **más**. Y al revés: un concept drift puro deja el PSI en 0 mientras la accuracy cae. Por eso nunca se reentrena «porque hubo drift»: el drift abre una investigación, y la decisión la toman las etiquetas.
:::

Y una **categoría nueva** no es ninguno de los cuatro (en Alba, el 1 de octubre el negocio agrega «bolsas»): el modelo ni siquiera tiene esa respuesta. Ninguna medida de drift lo arregla. Hace falta reentrenar con la clase nueva, y mientras tanto el modelo elige la categoría más parecida que conoce.

## Ventanas, estacionalidad, bins y embeddings {Windows, seasonality, bins and embeddings} [extra]

El PSI es una cuenta de cinco renglones. Lo difícil es decidir **contra qué** se compara, **qué tamaño** de cambio importa, **cuántos datos** entran en cada ventana, **qué bins** se usan y, con fotos, **qué representación** se compara. Esas decisiones cambian el número más que la fórmula.

### Tres referencias, tres preguntas

| Referencia | Responde | Trampa |
|---|---|---|
| Los datos de entrenamiento del modelo | ¿El modelo está viendo algo que no aprendió? | Avisa de todo lo que cambió desde que se entrenó, también de lo inofensivo |
| Una ventana reciente (Alba: las 4 semanas previas) | ¿Cambió algo de golpe? | Un drift lento nunca se ve: cada semana se parece a la anterior |
| La misma franja de antes (el mismo periodo del año pasado, la misma hora de la semana pasada) | ¿Esto es raro para este momento? | Necesita historia suficiente de cada franja |

La regla práctica es usar dos a la vez: contra el entrenamiento, para saber qué tan lejos está el modelo de lo que conoce, y contra una ventana reciente, para ver lo que cambió de golpe. La referencia de entrenamiento se **versiona con el modelo**: si el modelo nuevo se entrenó con fotos de noviembre, su referencia también las trae.

### El drift lento

Supón que cada semana el bin de fotos muy oscuras gana 1 punto y el de medias pierde 1: de 10 % a 30 % en 20 semanas.

:::figura distribuciones-lento
Contra la semana anterior, el PSI se queda pegado a 0. Contra la referencia de entrenamiento, cruza 0.1 en la semana 11 y 0.2 en la 15.
:::

Contra la semana anterior, el PSI nunca pasa de 0.0012: todo «estable», veinte semanas seguidas. Contra el entrenamiento, cruza 0.1 en la semana 11, 0.2 en la 15 y llega a 0.36 en la 20. Por ejemplo, en la semana 20 el bin 1 pasa de \(e\) = 0.10 a \(a\) = 0.30 y el 3 de \(e\) = 0.40 a \(a\) = 0.20: \(text{PSI}\) = (0.30 − 0.10) × ln 3 + (0.20 − 0.40) × ln 0.5 = 0.20 × 1.099 + (−0.20) × (−0.693) ≈ 0.36. Si solo comparas contra lo reciente, el modelo envejece sin que nadie se entere.

### Estacionalidad

Muchos cambios se repiten cada año, cada semana o cada día. En el pronóstico de demanda de una cadena de supermercados, diciembre nunca se parece a noviembre: Navidad, aguinaldo, vacaciones. Y cada quincena, los días 15 y último del mes, la gente compra más. Comparar diciembre contra las 4 semanas previas daría alarma todos los años.

Hay dos formas de vivir con eso:

- **Que el modelo aprenda la estacionalidad.** Ese pronóstico de demanda, por ejemplo, entrena con las últimas 52 semanas (un año completo: Buen Fin, Navidad, Semana Santa) y usa como features el calendario y lo que pasó en el mismo evento del año anterior.
- **Comparar contra la franja correcta.** La pregunta útil en diciembre es «¿este diciembre es raro para un diciembre?», no «¿se parece a noviembre?». En un sistema de fraude en pagos, la alerta de rechazos se compara contra la misma hora de la semana pasada, y en el Buen Fin dispararía aunque nada estuviera roto: en los días de evento, la línea base es el evento anterior.

### Qué tan grande es un PSI de 0.25

Una regla para darle tamaño: si una variable tiene forma de campana (una [[distribucion-normal|distribución normal]]) y su promedio se corre \(δ\) desviaciones estándar (\(δ\) = cuánto se corrió el promedio ÷ la desviación estándar), el PSI vale \(text{PSI} ≈ δ^2\) (con bins finos). Al revés, \(δ ≈ sqrt{text{PSI}}\). Así:

- PSI 0.1 es una corrida de ≈ 0.3 desviaciones estándar (√0.1 ≈ 0.32).
- PSI 0.25 es una corrida de 0.5 (√0.25 = 0.5).

El brillo de octubre tiene una desviación de ≈ 56 niveles, así que un PSI de 0.25 equivale a que el promedio se corra 0.5 × 56 ≈ 28 niveles. En la semana de noche, el promedio bajó de ≈ 128 a ≈ 102: \(δ\) = (128 − 102) ÷ 56 ≈ 0.46 desviaciones, y 0.46² ≈ 0.21, cerca del 0.23 que dio la cuenta. La regla es aproximada: supone una campana que solo se corre. Con 5 bins por cuantiles (cada uno con el 20 % de la referencia), el PSI sale un poco por debajo de δ² (0.22 en vez de 0.25 para media desviación); con más bins se acerca.

### Cuántos datos por ventana

Una ventana chica tiene ruido aunque nada cambie. Cuando la referencia es mucho más grande que la ventana, el PSI de pura suerte sale, en promedio, \(text{PSI}_{ruido} ≈ (K − 1)/n\), con \(K\) bins (o categorías) y \(n\) datos en la ventana.

:::cuenta El PSI que sale sin que nada pase
\(K\) = 500 categorías, \(n\) = 3,600 predicciones // una hora de un canary chico | \((K − 1)/n\) = 499 ÷ 3,600 | ≈ 0.14
\(K\) = 500, \(n\) = 5,000 | 499 ÷ 5,000 | ≈ 0.10
\(K\) = 30 categorías padre, \(n\) = 3,600 | 29 ÷ 3,600 | ≈ 0.008
\(K\) = 5 bins de brillo, \(n\) = 1,000 fotos | 4 ÷ 1,000 | 0.004
= Con 500 categorías y una hora de datos, el ruido solo ya pasa el umbral de 0.1 que usa Alba para su canary. Con 30 categorías padre, queda muy por debajo.
:::

Por eso el *canary* de Alba (una versión nueva que recibe solo una parte del tráfico mientras se prueba) compara la mezcla de las ≈ 30 categorías padre contra la versión estable, con umbral 0.1, y solo cuando junta al menos 5,000 predicciones en la ventana. Sin eso, el canary se regresaría por azar.

### Cómo elegir los bins

- **Bordes por cuantiles de la referencia.** Cada bin agarra la misma fracción de la referencia: con 10 bins, el 10 % cada uno. Así ningún bin queda vacío del lado de la referencia.
- **Bordes fijos.** Se calculan una vez, con la referencia, y no se recalculan con la ventana de hoy. Si los bordes se mueven, comparas cosas distintas.
- **Agrupar lo raro.** Categorías con pocos datos se juntan (500 → ≈ 30 padres) o van a un bin de «otros».
- **Un piso fijo y anotado.** Si algún bin queda en 0, el epsilon se fija una vez y se documenta, para que el número de hoy se compare con el de ayer.
- **¿Cuántos?** Diez es lo más común. Más bins ven más detalle (con una corrida de 0.5 desviaciones, 5 bins dan 0.22; 10, 0.24; 50, 0.25), pero cada bin extra suma ruido: \((K − 1)/n\).

### Drift en embeddings

El brillo, el tamaño y la resolución atrapan cambios en **cómo** se toman las fotos. No atrapan cambios en **qué** se fotografía. Si se pone de moda un tipo de producto nuevo, sus fotos pueden tener el mismo brillo, el mismo tamaño y la misma resolución que todo lo demás. Para eso sirven los [[embedding|embeddings]] de [la lección de embeddings](/embeddings/).

La ResNet-50 de Alba calcula, justo antes de su última capa, un vector de 2,048 números por foto, y fotos parecidas reciben vectores cercanos. Si el contenido cambia, la nube de vectores de hoy se mueve respecto a la de la referencia. Hay tres formas de medirlo, de la más simple a la más potente:

1. **La distancia entre los promedios.** Se promedian los vectores de la referencia, se promedian los de hoy y se comparan los dos promedios con la [[similitud-coseno]] o con una distancia. Es trivial de calcular y de guardar. Pero solo ve que se movió el centro: si la nube cambia de forma sin mover su centro, no lo ve.
2. **MMD** (*maximum mean discrepancy*). Compara las dos nubes completas. Su umbral sale de una prueba por permutaciones: se revuelven al azar las etiquetas «referencia» y «hoy» muchas veces, para ver qué tan grande sale la medida por pura suerte. Su costo crece con el cuadrado de n, así que se usa con muestras de miles, no de millones.
3. **Un clasificador de dominio.** Se entrena un clasificador chico que intenta distinguir los vectores de la referencia de los de hoy. Si no puede (su [[auc|AUC]] es ≈ 0.5, como tirar una moneda), las dos nubes no se distinguen. Si puede, algo cambió, y las fotos que más seguro separa te enseñan **qué**. Evidently lo usa por omisión para embeddings: marca drift si el AUC pasa de 0.55 con más de 1,000 muestras.

No hace falta guardar el vector de cada foto:

:::cuenta Guardar embeddings: todos o una muestra
Un vector // 2,048 números en [[float32]], de 4 bytes cada uno | 2,048 × 4 bytes | 8,192 bytes
Todos los de un día // las ≈ 10 M fotos diarias de Alba | 10,000,000 × 8,192 bytes | ≈ 81.9 GB
Una muestra al azar de 1 % // 1 % de 10,000,000 = 100,000 vectores | 100,000 × 8,192 bytes | ≈ 819 MB
= Para comparar dos distribuciones bastan miles de vectores elegidos al azar. Guardarlos todos casi no mejora la medida, y sí multiplica por 100 el almacenamiento.
:::

Una advertencia: con n enorme, un clasificador que saca AUC 0.6 puede ser «significativo» y aun así irrelevante. Es la misma trampa de la sección de KS: lo que se calibra es el tamaño del cambio, no la evidencia de que existe.

## Errores comunes {Common mistakes}

Casi todos tienen algo en común: el número sale, con decimales y todo, y no significa lo que crees.

### Alertar por significancia estadística con n enorme

**Qué pasa:** se pone una alerta «si el p-value de KS es menor que 0.05». Con ≈ 10 M fotos al día, el p-value sale minúsculo casi todos los días, porque el mundo nunca es idéntico de un día a otro. La alerta suena siempre y el equipo la silencia.

**Cómo evitarlo:** alerta por el tamaño del cambio (PSI, D, una distancia) con un umbral calibrado mirando semanas normales. Si quieres un p-value, calcúlalo sobre una muestra de unos miles, no sobre todo el día.

### Bins con cero

**Qué pasa:** un bin de la ventana actual queda vacío, ln(0) no existe y el código truena, o le pone un piso cualquiera y el PSI sale 0.47, 0.71 o 1.17 según el piso. Y si el que queda vacío es un bin de la referencia, cualquier dato que hoy caiga ahí vuelve la cuenta infinita.

**Cómo evitarlo:** bordes por cuantiles de la referencia (los cortes que la parten en pedazos con la misma cantidad de datos, como los [[percentil|percentiles]]; así ninguno queda vacío de ese lado), agrupar los bins raros, y un epsilon fijo y anotado para el lado actual. Para categorías, la divergencia de Jensen–Shannon (la prima simétrica de la KL, en la sección extra) no se rompe con ceros.

### Comparar contra una referencia vieja o equivocada

**Qué pasa:** la referencia se armó con los datos del primer modelo, hace un año. Desde entonces se reentrenó tres veces con datos nuevos, y el PSI sale alto todos los días contra un mundo que ya no existe. O pasa lo contrario: solo se compara contra la semana anterior y un drift lento no se ve nunca.

**Cómo evitarlo:** versiona la referencia de entrenamiento con el modelo (modelo nuevo, referencia nueva) y usa dos referencias: la del entrenamiento y una ventana reciente.

### Tratar una categoría nueva como drift

**Qué pasa:** el negocio agrega «bolsas», el modelo las manda a la categoría más parecida que conoce, el PSI de las predicciones sube y alguien reentrena con las fotos de siempre. No sirve: el modelo sigue sin tener esa respuesta.

**Cómo evitarlo:** una categoría nueva es un cambio en las respuestas posibles, no un drift. Se etiquetan ejemplos de la clase nueva, se reentrena con ella y se crea una referencia nueva que la incluya.

### Recalcular los bordes de los bins cada día

**Qué pasa:** el job arma los bins con los cuantiles de los datos de hoy. Cada día los bordes son otros y el PSI compara cosas distintas; un cambio real puede quedar escondido porque los bins se movieron con él.

**Cómo evitarlo:** los bordes se calculan una vez, con la referencia, y se guardan junto con ella.

### Muchos bins con pocos datos

**Qué pasa:** se calcula el PSI de las 500 categorías con una hora de datos. El ruido solo ya da ≈ 0.14, arriba del umbral, y el canary (la versión nueva que recibe una parte del tráfico) se revierte de noche por azar.

**Cómo evitarlo:** agrupa (500 → ≈ 30 categorías padre), exige un mínimo de datos por ventana (Alba pide 5,000 predicciones) y revisa el ruido esperado: \(text{PSI}_{ruido} ≈ (K − 1)/n\), con \(K\) bins y \(n\) datos.

### Reentrenar «porque hubo drift»

**Qué pasa:** el PSI pasa de 0.2 y se lanza un reentrenamiento automático. Pero el cambio era skew (un bug que el modelo nuevo aprende a tolerar hasta que alguien lo arregla) o era inofensivo (fotos mejor iluminadas).

**Cómo evitarlo:** el drift abre un ticket, no un deploy. Primero se descarta el skew con la paridad, luego se etiqueta una muestra, y el modelo nuevo pasa por el mismo examen que cualquier otro.

## En la vida real {In real life} [extra]

**Alba · Clasificación de fotos.** El job diario calcula el PSI de la mezcla de categorías predichas contra las 4 semanas previas, junto con la tasa de aceptación de las sugerencias y las correcciones de los moderadores. Las estadísticas de las fotos (brillo, tamaño, resolución) atrapan las noches de invierno y los celulares nuevos; la tasa de fotos con baja confianza (top-1 menor que 0.3) atrapa al modelo que empieza a dudar. Nada de eso prueba que empeoró: para eso, cada semana se etiqueta una muestra al azar de fotos recientes y se mide la accuracy de verdad.

**Fraude en pagos con tarjeta.** El patrón del fraude cambia en días, porque del otro lado hay alguien adaptándose a ti, y la etiqueta fuerte, el contracargo, tarda hasta 90 días en llegar. Por eso el monitoreo vive de señales tempranas: la distribución de los scores y de cada feature contra su línea base, las tasas de rechazo por segmento contra la misma hora de la semana pasada y la acumulación justo debajo de cada corte. Y tiene su calendario: en el Buen Fin, la línea base es el Buen Fin anterior.

**Pronóstico de demanda.** Diciembre siempre se ve distinto, y cada quincena también. El modelo aprende ese calendario y el monitoreo vigila el sesgo del pronóstico por categoría. Una regla útil para leerlo: si el sesgo aparece de golpe, suele ser un dato (un precio o una promoción mal capturados); si crece semana tras semana, es drift. Un cambio de hábitos, como pasarse a marcas propias, es concept drift: con los mismos precios relativos, otra demanda.

**Fuera del ML.** El PSI nació en los bancos, para vigilar si quienes piden crédito hoy se parecen a quienes sirvieron para construir el modelo de riesgo. Y la entropía es la base de la compresión: una moneda justa no se puede comprimir (cada volado necesita 1 bit), pero los volados de una moneda 90/10 se pueden guardar, agrupándolos, con casi 0.47 bits cada uno. Los archivos ZIP usan parte de esta idea: a lo que se repite mucho le dan códigos más cortos que a lo raro.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los cuatro primeros son directos; los dos últimos juntan varias ideas.

:::ejercicios
? [facil] Calcula sin calculadora, con ln 2 ≈ 0.693 y ln 3 ≈ 1.099: (a) log2 16, (b) log2 (1/4), (c) ln(0.3 ÷ 0.1) y (d) ln(0.1 ÷ 0.3).
**(a)** 2 × 2 × 2 × 2 = 16: cuatro multiplicaciones, así que log2 16 = **4**.

**(b)** 1/4 es dividir dos veces entre 2, así que log2 (1/4) = **−2**.

**(c)** ln(0.3 ÷ 0.1) = ln 3 ≈ **1.099**.

**(d)** Es el cociente al revés: −ln 3 ≈ **−1.099**. Triplicar y dividir entre 3 miden lo mismo con signo contrario.
? [facil] Una moneda cae águila el 75 % de las veces. ¿Cuál es su entropía? ¿Es más o menos que la de una moneda justa, y por qué? (La entropía es la suma de p × log2(1 ÷ p); log2 (1/0.75) ≈ 0.415 y log2 4 = 2.)
Usa \(H = sum p × log_2(1/p)\), con \(p\) = 0.75 para águila y \(p\) = 0.25 para sol:
:::cuenta Entropía de la moneda 75/25
Águila // \(p\) = 0.75 | \(p × log_2(1/p)\) = 0.75 × log2(1 ÷ 0.75) = 0.75 × 0.415 | 0.311
Sol // \(p\) = 0.25; 1 ÷ 0.25 = 4 | 0.25 × log2(1 ÷ 0.25) = 0.25 × log2 4 = 0.25 × 2 | 0.500
Entropía \(H\) // la suma de los dos | 0.311 + 0.500 | **0.811 bits**
:::
Es menos que 1 bit, el de la moneda justa. Como el águila sale más seguido, el resultado es más predecible y cada volado trae menos sorpresa. La entropía es máxima cuando los resultados son parejos.
? [facil] En Alba, «Celulares» era el 10 % de las predicciones en la referencia. ¿Cuánto aporta al PSI si hoy es el 14 %? ¿Y si fuera el 6 %? ¿Por qué no aportan lo mismo, si en los dos casos se movió 4 puntos? (ln 1.4 ≈ 0.336; ln 0.6 ≈ −0.511.)
Cada bin aporta \((a − e) × ln(a/e)\), con \(e\) = 0.10 la referencia y \(a\) la proporción de hoy.

Subir a 14 % (\(a\) = 0.14): (0.14 − 0.10) × ln(0.14 ÷ 0.10) = 0.04 × 0.336 ≈ **0.013**.

Bajar a 6 % (\(a\) = 0.06): (0.06 − 0.10) × ln(0.06 ÷ 0.10) = (−0.04) × (−0.511) ≈ **0.020**.

Los dos movieron 4 puntos, pero no se multiplicaron igual: subir a 14 % es × 1.4, y bajar a 6 % es × 0.6, que como cociente es más grande (al revés, 10 ÷ 6 ≈ 1.67). El logaritmo mide cocientes, así que bajar a 6 % pesa más.
? [facil] La referencia tiene los valores 10, 20, 30 y 40; la ventana actual, 25, 35, 45 y 55. Calcula D, la distancia más grande entre las dos curvas acumuladas.
Usa \(D = max_{x} |F_{ref}(x) − F_{act}(x)|\): en cada valor \(x\) que aparece en alguna de las dos, cuenta cuántos de 4 valen \(x\) o menos en cada lado y resta, sin signo:

- En 10: referencia 1 de 4, actual 0 de 4 → 0.25.
- En 20: 2 de 4 y 0 → **0.5**.
- En 25: 2 y 1 → 0.25.
- En 30: 3 y 1 → **0.5**.
- En 35: 3 y 2 → 0.25.
- En 40: 4 y 2 → **0.5**.
- En 45: 4 y 3 → 0.25.
- En 55: 4 y 4 → 0.

**D = 0.5**, y se alcanza en tres lugares (20, 30 y 40). Los valores de la ventana actual son 15 más altos, así que su curva acumulada sube más tarde.
? [medio] La referencia reparte 25 % en cada uno de 4 bins. Esta semana: 40 %, 30 %, 20 % y 10 %. Calcula el PSI. ¿Qué dice la tabla de lectura, y qué haría Alba, que abre un ticket si el PSI pasa de 0.2 tres días seguidos? (ln 1.6 ≈ 0.470, ln 1.2 ≈ 0.182, ln 0.8 ≈ −0.223, ln 0.4 ≈ −0.916.)
Usa \(text{PSI} = sum (a_i − e_i) × ln(a_i/e_i)\), con \(e_i\) = 0.25 en todos los bins:
:::cuenta PSI con cuatro bins
Bin 1 // \(e\) = 0.25, \(a\) = 0.40; 0.40 ÷ 0.25 = 1.6 | \((a − e) × ln(a/e)\) = 0.15 × ln 1.6 = 0.15 × 0.470 | 0.0705
Bin 2 // \(a\) = 0.30; 0.30 ÷ 0.25 = 1.2 | 0.05 × ln 1.2 = 0.05 × 0.182 | 0.0091
Bin 3 // \(a\) = 0.20; 0.20 ÷ 0.25 = 0.8 | (−0.05) × ln 0.8 = (−0.05) × (−0.223) | 0.0112
Bin 4 // \(a\) = 0.10; 0.10 ÷ 0.25 = 0.4 | (−0.15) × ln 0.4 = (−0.15) × (−0.916) | 0.1374
PSI // la suma de los cuatro | 0.0705 + 0.0091 + 0.0112 + 0.1374 | **0.2282**
:::
Entre 0.1 y 0.25: cambio moderado, hay que mirar. Pasa de 0.2, así que si se sostiene 3 días, Alba abre un ticket. El bin que más aporta es el 4, que cayó a menos de la mitad. Compáralo con el 1: los dos se movieron 15 puntos, pero el 1 se multiplicó por 1.6 (aporta 0.071) y el 4 por 0.4 (aporta 0.137). Encogerse a menos de la mitad es un cociente más grande que crecer 60 %.
? [medio] P es una moneda justa (0.5, 0.5) y Q una cargada (0.9, 0.1). Calcula KL(P ‖ Q) y KL(Q ‖ P) con ln, y el PSI entre las dos. (KL(P ‖ Q) es la suma de p × ln(p ÷ q); ln(5/9) ≈ −0.588, ln 5 ≈ 1.609.)
Usa \(text{KL}(P ‖ Q) = sum p_i × ln(p_i/q_i)\) y, para el PSI, \(text{PSI} = text{KL}(P ‖ Q) + text{KL}(Q ‖ P)\). Fíjate que ln(0.9 ÷ 0.5) = −ln(5/9) ≈ 0.588 y ln(0.1 ÷ 0.5) = −ln 5 ≈ −1.609:
:::cuenta Las dos KL de las monedas
KL(P ‖ Q) // \(p\) = (0.5, 0.5), \(q\) = (0.9, 0.1) | 0.5 × ln(0.5 ÷ 0.9) + 0.5 × ln(0.5 ÷ 0.1) = 0.5 × (−0.588) + 0.5 × 1.609 | **0.511**
KL(Q ‖ P) // al revés: los pesos son los de Q | 0.9 × ln(0.9 ÷ 0.5) + 0.1 × ln(0.1 ÷ 0.5) = 0.9 × 0.588 + 0.1 × (−1.609) | **0.368**
PSI // la suma de las dos | 0.511 + 0.368 | **0.879**
:::
No son iguales. KL(P ‖ Q) es más grande: si de verdad la moneda es justa y te preparaste para una que casi siempre cae águila, cada sol te sorprende mucho, y con la moneda justa el sol sale la mitad de las veces. Al revés, el sol solo sale 10 % y la sorpresa pesa poco. El PSI suma las dos, así que no depende de cuál llames referencia.
? [medio] En la semana rara de la primera figura, el brillo de octubre era 10, 20, 40, 20 y 10 % y el de esa semana 30, 15, 10, 15 y 30 %. Los dos tienen el mismo promedio. ¿El PSI también lo deja pasar? (ln 3 ≈ 1.099, ln 0.75 ≈ −0.288, ln 0.25 ≈ −1.386.)
Usa \(text{PSI} = sum (a_i − e_i) × ln(a_i/e_i)\). Los bins 1 y 5 se mueven igual, y el 2 y el 4 también, así que cada pareja se calcula una vez y se multiplica por 2:
:::cuenta El PSI de la semana con el mismo promedio
Bin 1 y bin 5 // \(e\) = 0.10, \(a\) = 0.30 cada uno | 2 × \((a − e) × ln(a/e)\) = 2 × 0.20 × ln 3 = 2 × 0.20 × 1.099 | 0.4394
Bin 2 y bin 4 // \(e\) = 0.20, \(a\) = 0.15 cada uno; 0.15 ÷ 0.20 = 0.75 | 2 × (−0.05) × ln 0.75 = 2 × (−0.05) × (−0.288) | 0.0288
Bin 3 // \(e\) = 0.40, \(a\) = 0.10; 0.10 ÷ 0.40 = 0.25 | (−0.30) × ln 0.25 = (−0.30) × (−1.386) | 0.4159
PSI // la suma | 0.4394 + 0.0288 + 0.4159 | **0.884**
:::
No: el PSI sale ≈ 0.88, más de tres veces el corte de «cambio grande». El promedio no ve nada porque los cambios de los dos extremos se compensan; el PSI no compensa nada, porque cada bin suma algo positivo. Para eso se comparan distribuciones completas.
? [medio] ¿Qué tipo de cambio es cada uno: data drift, label shift, concept drift, skew o ninguno? (a) En el Buen Fin, en un sistema que detecta fraude en pagos con tarjeta, los tickets son más altos y hay muchas tarjetas nuevas, pero la proporción de fraude por tipo de compra no cambió. (b) En Alba, desde el deploy del lunes la accuracy de la muestra etiquetada baja y la prueba de paridad falla. (c) En diciembre, en Alba, «Juguetes» pasa de 1 % a 10 % de las predicciones y cada categoría se ve como siempre. (d) Moderación decide que las fundas de celular van en otra categoría. (e) El negocio agrega la categoría «bolsas».
- **(a) Data drift.** Cambiaron las entradas, p(x); la regla que separa fraude de no fraude es la misma.
- **(b) Skew.** Empezó con un deploy y la paridad falla: tu código prepara los datos distinto. Se arregla el código, no se reentrena.
- **(c) Label shift.** Cambió p(y), cuánto hay de cada clase, y no cómo se ve cada una. Se revisan umbrales y calibración.
- **(d) Concept drift.** La misma foto ahora tiene otra respuesta correcta: cambió p(y | x). Se reetiqueta y se reentrena.
- **(e) Ninguno.** Es una respuesta nueva que el modelo no tiene. Hace falta reentrenar con la clase nueva.
? [reto] La referencia de brillo es 10, 20, 40, 20 y 10 %, y esta semana nadie cayó en el bin 1: 0, 25, 45, 20 y 10 %. (a) Calcula lo que aporta el bin 1 si reemplazas el 0 por un piso de 0.001, y luego por 0.000001. (b) Los otros cuatro bins suman 0.017. ¿Qué PSI sale en cada caso? (c) ¿Qué harías para que el número signifique algo? (ln 0.01 ≈ −4.605, ln 0.00001 ≈ −11.513.)
El bin 1 aporta \((a − e) × ln(a/e)\), con \(e\) = 0.10 y, en lugar del 0, \(a\) igual al piso.

**(a)** Con piso 0.001: (0.001 − 0.10) × ln(0.001 ÷ 0.10) = (−0.099) × ln 0.01 = (−0.099) × (−4.605) ≈ **0.456**.

Con piso 0.000001: (0.000001 − 0.10) × ln(0.000001 ÷ 0.10) = (−0.099999) × ln 0.00001 ≈ (−0.1) × (−11.513) ≈ **1.151**.

**(b)** PSI ≈ 0.456 + 0.017 ≈ **0.47**, o ≈ 1.151 + 0.017 ≈ **1.17**. Son los mismos datos: el «cambio» depende de un número que elegiste tú. (El código de la lección da 0.47 y 1.17.)

**(c)** Arma los bordes con cuantiles de la referencia: con 5 bins, cada uno guarda el 20 % de ella, así que nunca queda vacío de ese lado y es más difícil que se vacíe el de hoy. Agrupa el bin 1 con el 2 si se vacía seguido. Fija un epsilon, anótalo y no lo cambies, para que el número de hoy se compare con el de ayer. Y si es una variable de categorías, considera la divergencia de Jensen–Shannon, que no se rompe con ceros.
? [reto] El canary de Alba (la versión nueva que recibe solo una parte del tráfico mientras se prueba) compara la mezcla de categorías predichas contra la versión estable, con umbral 0.1. (a) Con las 500 categorías y 3,600 predicciones en una hora, ¿qué PSI esperas de pura suerte? (b) ¿Y con 5,000? (c) ¿Y con las ≈ 30 categorías padre y 3,600? (d) Explica por qué Alba compara categorías padre y pide al menos 5,000 predicciones. Usa PSI de ruido ≈ (K − 1) ÷ n.
Con \(text{PSI}_{ruido} ≈ (K − 1)/n\), \(K\) categorías y \(n\) predicciones:

**(a)** \(K\) = 500, \(n\) = 3,600: 499 ÷ 3,600 ≈ **0.14**: arriba del umbral de 0.1 sin que nada cambie.

**(b)** \(K\) = 500, \(n\) = 5,000: 499 ÷ 5,000 ≈ **0.10**: justo en el umbral. El puro ruido lo rozaría cada hora y sonaría muy seguido.

**(c)** \(K\) = 30, \(n\) = 3,600: 29 ÷ 3,600 ≈ **0.008**: más de diez veces por debajo del umbral.

**(d)** Con 500 categorías, la mayoría tiene pocas predicciones por hora, y cada bin chico mete ruido. El canary se revertiría por azar, sobre todo de noche, cuando hay menos tráfico. Agrupar en ≈ 30 padres baja el ruido a casi nada, y pedir un mínimo de 5,000 predicciones evita decidir con una ventana demasiado chica. Las categorías finas se revisan después, con más datos, en el job diario.
:::

## Lo que sigue {What comes next}

- La siguiente lección, «Cómo guarda números una computadora», explica float32 e int8, y por qué un número en float32 ocupa 4 bytes.
- Más adelante, la lección «Monitoreo, drift y reentrenamiento» junta esta lección con las alertas, las guías de qué hacer cuando una suena (*runbooks*) y la decisión de reentrenar.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
referencia psi prueba-ks logaritmo entropia divergencia-kl chi-cuadrado concept-drift label-shift
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué no basta comparar el promedio de hoy contra el de la referencia?
Porque dos distribuciones muy distintas pueden tener el mismo promedio: una con todo en medio y otra con todo en los extremos. Los cambios de un lado y del otro se compensan en el promedio. Hay que comparar los histogramas completos, bin por bin.
? Un PSI da 0.05; otro, 0.15; otro, 0.30. ¿Qué dice cada uno?
0.05: estable, ruido normal. 0.15: cambio moderado, hay que mirar. 0.30: cambio grande. Son convenciones, no leyes: el umbral real se calibra con semanas normales. Alba, por ejemplo, actúa cuando el PSI pasa de 0.2 tres días seguidos.
? ¿Por qué con 10 M predicciones al día casi cualquier prueba sale «significativa»?
Porque el umbral de la prueba se encoge con la cantidad de datos (en KS, como 1 ÷ √n), y el mundo nunca es idéntico de un día a otro. Con millones de datos, hasta un cambio que nadie notaría tiene un p-value minúsculo. Por eso se alerta por el tamaño del cambio, no por el p-value.
? ¿Qué es la D de la prueba KS?
La distancia vertical más grande entre las curvas acumuladas de las dos muestras. Va de 0 (iguales) a 1 (todos los datos de una quedan antes que todos los de la otra).
? Las entradas no se movieron y la mezcla de predicciones tampoco, pero la muestra etiquetada dice que el modelo acierta menos. ¿Qué tipo de cambio es y qué haces?
Concept drift: cambió la regla, p(y | x), y la misma entrada ahora tiene otra respuesta correcta. Las etiquetas viejas quedan mal: se reetiqueta con la regla nueva y se reentrena. (Antes conviene descartar el skew con una prueba de paridad.)
? ¿Por qué un bin vacío rompe el PSI?
Porque el PSI usa ln(actual ÷ esperado), y ln 0 no existe. Con un piso, el resultado depende del piso que elegiste (0.47 o 1.17 con los mismos datos). Se evita con bins por cuantiles de la referencia, agrupando bins raros y con un epsilon fijo.
? ¿Contra qué referencia compararías las ventas de diciembre en el pronóstico de demanda de una cadena de supermercados?
Contra diciembres anteriores, no contra noviembre: diciembre siempre se ve distinto por Navidad y el aguinaldo. La pregunta útil es «¿este diciembre es raro para un diciembre?». Y además, contra los datos de entrenamiento, para saber si el modelo está viendo algo que no aprendió.
:::
