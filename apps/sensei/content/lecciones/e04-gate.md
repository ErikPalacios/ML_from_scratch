---
titulo: Gate de evaluación y registry
en: Evaluation gate and model registry
subtitulo: El examen automático que decide si el modelo nuevo de Alba puede salir a probarse, con reglas escritas antes, comparado foto por foto contra el que está y contra el de hace 3 meses, y el registro donde cada versión queda guardada con su nombre, sus punteros y quién la movió.
pregunta: El 1 de noviembre el pipeline de Alba termina de entrenar un modelo nuevo. Saca 0.04 puntos menos que el actual en el examen. ¿Se queda fuera, o sale? ¿Quién lo decide, con qué regla, y dónde queda escrito?
requisitos: aprendio, ruido, e02-versionado, e03-entrenamiento
---

:::idea
El gate es la decisión de calidad escrita **antes** de ver los resultados: el modelo nuevo responde las mismas 50,000 fotos que el actual, y pasa solo si, comparado foto por foto, no es peor que él por más de un margen que se fijó con el ruido del examen. El registry guarda cada modelo que pasa como una versión que nunca cambia, y dos nombres que se mueven, `champion` y `challenger`, dicen cuál sirve y cuál se prueba.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones nuevas al día, con ≈ 3 fotos cada una, y sugiere la categoría de cada foto entre 500. Lo hace con una [[resnet|ResNet-50]] (una red neuronal para fotos, de ≈ 24.5 millones de parámetros) que responde desde dos [[gpu|GPUs]] T4, unas tarjetas de NVIDIA. Ana, por ejemplo, sube la foto de unos tenis y recibe «Calzado › Tenis». El modelo se vuelve a entrenar cada mes, y su examen es el [[golden-set|golden set]] `golden-v3`: 50,000 fotos etiquetadas con cuidado por dos personas, congeladas, que nunca se usan para entrenar. En ese examen el modelo actual saca ≈ 85 % de top-1 (la primera sugerencia es la correcta) y ≈ 96 % de top-5 (la correcta está entre las cinco).

A cada paso del [[pipeline]] mensual que arma el modelo le decimos **estación**, como en una línea de producción. La estación anterior, «Entrenamiento y experimentos», dejó un [[checkpoint]] nuevo (el archivo con los pesos del modelo): `resnet50-2026-11-01`, entrenado el 1 de noviembre de 2026 con el [[snapshot]] de octubre, la lista fija de fotos y etiquetas de ese mes. Su [[corrida]], el registro de con qué datos, código y parámetros se entrenó y qué métricas dio, quedó guardada en [[mlflow|MLflow]], la herramienta donde Alba anota cada entrenamiento. Esta lección es la estación 4: decide si ese checkpoint puede reemplazar al que hoy atiende a Ana, y explica dónde vive cada modelo que pasa.

Las piezas ya las conoces y aquí solo se recuerdan:

- El [[recall]] de una categoría es, de las fotos que de verdad son de esa categoría, la fracción que el modelo reconoce. El [[macro-promedio|macro-recall]] promedia el recall de varias categorías, cada una con el mismo peso. El [[ece|ECE]] mide qué tan lejos está la confianza del modelo de lo que acierta. Las tres están en «¿Aprendió de verdad?».
- Un [[slice]] es un pedazo de los datos que se mide aparte, como las fotos con poca luz. El [[long-tail|long tail]] (cola larga) son las muchas categorías con pocas fotos cada una. Los dos están en «Datos, ejemplos, features y etiquetas».
- Una [[prueba-pareada|prueba pareada]] compara dos modelos **foto por foto** en el mismo examen, y la [[mcnemar|prueba de McNemar]] es la que mira solo las fotos donde uno acierta y el otro no. Una diferencia es «significativa» cuando es muy poco probable que salga solo por azar. La [[comparaciones-multiples|corrección por comparaciones múltiples]] (la de Holm) hace muy poco probable que, de tantas pruebas, alguna salga significativa por puro azar. Todo eso lo deriva «Ruido, muestras y pruebas A/B».

Aquí no se vuelve a derivar nada de eso: se usa. Esta lección es el **sistema** que lo junta: qué regla, contra quién, con qué pares, qué pasa si falla, quién puede saltarla y dónde queda escrito.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

Un [[quality-gate|gate de calidad]] (*quality gate*, la compuerta) es una lista de reglas con sus umbrales, escrita antes de ver los resultados, que decide sola si un modelo nuevo puede reemplazar al actual. Es una prueba como las de «Pruebas y CI/CD»: si falla, el camino se detiene.

### Lo que entra

Cuatro cosas, y cada una tiene que llegar fija:

- **El candidato.** El checkpoint de la corrida `resnet50-2026-11-01`, con sus tres punteros, que dicen de dónde salió: el snapshot `ds-2026-10-01`, el [[commit]] del código y la huella (*digest*) de la imagen de [[contenedor]] donde corrió el entrenamiento, el paquete con el programa y sus librerías.
- **El champion, como versión fija.** Al modelo que hoy atiende a la gente se le dice *champion* (el campeón), y al que lo reta, *challenger*. Ese par, [[champion-challenger|champion y challenger]], organiza todo lo que sigue. El gate no pregunta «¿quién es el champion ahora?» a la mitad del examen: lo lee **una vez** al empezar y lo pasa como un número fijo. Hoy es la versión 14 del registro de modelos (el catálogo de modelos aprobados que explica la sección «El registry»), `resnet50-2026-10-01`.
- **El modelo de hace 3 meses.** `resnet50-2026-08-01`, la versión 12. Por qué también contra él lo ves en la sección de la erosión.
- **El examen.** `golden-v3`, las 50,000 fotos, y el archivo de reglas `gate.yaml` (escrito en [[yaml|YAML]], un formato de texto para configuración), que vive en el [[repositorio]] del código de Alba.

### Lo que sale

- **Un veredicto por regla**, y uno global: pasa o no pasa.
- **El [[reporte-gate|reporte del gate]]**: las predicciones de los tres modelos foto por foto, las métricas globales, por categoría y por slice, y el veredicto de cada regla con sus números.
- **Si pasa:** el «checkpoint aprobado por el gate», que recibe la estación siguiente, «Export, engine y paridad».
- **Si no pasa:** el paso termina en rojo, avisa a la persona de guardia (la que ese día atiende las alarmas) y el champion sigue atendiendo como si nada.

### Lo que se decide

:::pasos
1. Contra quién se compara
El champion, como versión fija, y el modelo de hace 3 meses, con los pares de predicciones guardados.
2. Cuánto puede perder sin que importe
El margen de no inferioridad: −0.3 [[punto-porcentual|puntos porcentuales]] de top-1 y de top-5 (de 85.0 % a 84.7 %, por ejemplo), del tamaño del ruido del golden set. En toda la lección, «puntos» quiere decir puntos porcentuales.
3. Dónde más puede romperse
Las 100 categorías con más tráfico, la cola larga, cuatro slices y la calibración (que la confianza del modelo diga la verdad).
4. Quién puede saltarse una regla
Nadie, para las reglas principales; dos personas con firma, para unas pocas.
5. Dónde queda
El reporte, en la corrida; la versión, en el registro de modelos, al final de la estación siguiente.
:::

:::diagrama e04-gate-estacion
La estación 4 completa, de los tres modelos y el golden set al veredicto. Toca cada caja; los recorridos siguen un mes que pasa y uno que no.
:::

Una advertencia de orden, porque el título de la estación junta dos cosas. El gate **aprueba** el checkpoint; no lo registra. La versión 15 nace en el [[registro-modelos|registro de modelos]] al final de la estación siguiente, cuando ya existe el modelo convertido para correr rápido en la T4 y se comprobó que responde igual que el original. A veces se resume como «solo el que pasa el gate se guarda en el registro»: es cierto, pero el registro lo hace la estación 5 con el artefacto ya probado.

Los tiempos, en el pipeline mensual de Alba: el paso de evaluar corre en la misma GPU del entrenamiento, una A10G (otra tarjeta de NVIDIA, la que se renta para entrenar), y tarda ≈ 15 min; el gate, que solo lee predicciones y hace cuentas, tarda menos de 1 min.

## Reglas escritas antes, contra un champion fijo {Rules written in advance, against a pinned champion}

Imagina que el gate se decide **después**. El modelo nuevo sale con el slice de poca luz 2 puntos abajo, y alguien propone: «el límite era 1.6, pero 2 no es tanto; lo subimos a 2.5». Suena razonable, y siempre lo va a sonar. Cada mes habrá un argumento para aprobar, y el gate deja de medir: solo justifica lo que ya se quería.

### Los umbrales viven en el repositorio

Por eso los [[umbrales-gate|umbrales del gate]] se escriben antes y se guardan en `gate.yaml`, en el repositorio `ml-catalogo`. Cambian **solo** en un [[pull-request|pull request]] (PR) propio, una propuesta de cambio que otra persona revisa, con su motivo y antes de la corrida siguiente. Así, quien revisa el cambio no sabe todavía si va a ayudar a un modelo en particular, y el historial de [[git|Git]] dice quién movió cada número y por qué.

Así se ve el archivo (es una ilustración: el formato lo define el equipo de Alba, no una herramienta):

```yaml
# gate.yaml · reglas del gate mensual (solo cambian en un PR propio)
examen: golden-v3                # 50,000 fotos; su manifest y su huella se comprueban
comparar_contra: [champion, hace_3_meses]
top1_top5:
  margen_puntos: 0.3             # no inferioridad pareada, extremo de abajo del 95 %
categorias_top:
  cuantas: 100                   # las 100 con más tráfico
  caida_max_puntos: 5            # y además significativa: McNemar por categoría + Holm
  alfa: 0.05
cola_larga: macro_recall_no_empeora
slices: [celular, web, poca_luz, fotos_chicas]   # cada uno, dentro de su intervalo
ece_max: 0.05                    # en el golden set, después de temperature scaling
```

Fíjate en que el archivo no dice «el top-1 debe ser 85 %». Dice **contra quién** y **cuánto puede moverse**. Un número absoluto envejece: cuando el catálogo cambia, el mismo modelo saca otro número. Una comparación contra el que ya está sigue teniendo sentido cada mes.

### El champion entra como número, no como pregunta

El gate tiene que saber contra quién compara, y ese dato puede cambiar mientras el pipeline corre: el despliegue de otro modelo podría mover el nombre `champion` justo a la mitad. Si el gate preguntara «¿quién es el champion?» al empezar a evaluar y otra vez al decidir, podría comparar las predicciones de un modelo con el veredicto de otro.

La regla de Alba: el champion **se lee una sola vez** al empezar y entra al paso como un número fijo, `champion_version=14`. El reporte guarda ese número y la [[hash-criptografico|huella SHA-256]] del archivo del modelo (un resumen de sus bytes que cambia si cambia un solo byte), y el paso falla si no coinciden con lo que dice el registro. Y si el champion cambia de un mes a otro, el [[orquestador-pipelines|orquestador]] (el programa que corre los pasos del pipeline) lo nota solo: vuelve a correr un paso cuando cambia alguna de sus entradas. Es la [[cache-pipeline|caché de pasos]] de «Versionado y linaje».

### Los pares, guardados

La comparación es foto por foto. Para eso no basta con guardar «el nuevo sacó 85.02 % y el champion 85.06 %»: dos promedios no dicen en **qué** fotos discrepan. El paso de evaluar guarda, para cada una de las 50,000 fotos, las 5 sugerencias de cada uno de los tres modelos: 3 × 50,000 = 150,000 filas, ≈ 5–10 MB en [[parquet|Parquet]] (un formato compacto para tablas). Con esa tabla, cualquier regla se puede recalcular después, y cualquier persona puede abrir las fotos donde el modelo nuevo falla y el viejo no.

:::ojo
El gate mide el modelo **en PyTorch**, el checkpoint tal como salió del entrenamiento. Que el modelo convertido para la T4 (el *engine*, una versión del modelo optimizada para esa tarjeta) responda igual es otro examen, la [[paridad-engine|paridad del engine]], y lo corre la estación 5 con un artefacto que todavía no existe aquí. Son dos exámenes distintos: este dice si el modelo es **bueno**; el otro, si lo que se sirve **es** ese modelo.
:::

## No inferioridad: el margen de −0.3 puntos {Non-inferiority: the −0.3-point margin}

Ahora la regla principal. El reentrenamiento mensual de Alba no busca ganar: busca **no quedarse atrás** mientras el catálogo cambia, con productos nuevos y fotos de otros celulares. Un modelo nuevo que saca lo mismo que el actual es un éxito, porque está al día.

### Tres reglas posibles, y por qué dos fallan

- **«Que sea mejor de forma significativa.»** Exige que el modelo nuevo gane, con una prueba que descarte el azar. Casi ningún mes un modelo entrenado con la misma receta gana por mucho, así que esta regla bloquearía casi todos los reentrenamientos. El modelo envejecería esperando.
- **«Que su top-1 sea ≥ el del champion.»** Parece justa, pero decide con ruido: dos modelos igual de buenos salen uno arriba del otro por azar, la mitad de las veces de cada lado. La mitad de los meses se bloquearía a un modelo que estaba bien.
- **«Que no sea peor por más de un margen.»** Es la [[no-inferioridad|no inferioridad]] (*non-inferiority*): el modelo nuevo pasa si, con buena seguridad, no pierde más de un margen fijo contra el actual. Es la que usa Alba.

:::analogia Un tratamiento nuevo, más barato
Para aprobar un tratamiento nuevo que es más barato o tiene menos efectos secundarios, no se le pide que cure más que el estándar: en un estudio de no inferioridad se le pide que no cure menos por más de un margen chico, decidido antes del estudio. Si cura igual, sirve, porque además trae su otra ventaja. El modelo nuevo de Alba es ese tratamiento: si acierta igual que el champion pero ya conoce los productos de octubre, sirve.

Donde se rompe: un tratamiento se aprueba una vez. El modelo de Alba se examina cada mes, y cada mes puede perder un poco dentro del margen. Esa suma es el problema de la erosión, y tiene su propia regla.
:::

### La ecuación

La cuenta pareada de «Ruido, muestras y pruebas A/B» da, con las fotos donde los modelos discrepan, la diferencia y su error estándar. La no inferioridad le agrega una sola cosa: mirar el **extremo de abajo** del intervalo y compararlo con el margen.

:::formula Prueba de no inferioridad pareada
Δ = frac{b − c}{N} × 100
SE_Δ = frac{sqrt{b + c}}{N} × 100
Δ_{min} = Δ − 1.96 × SE_Δ
text{pasa si } Δ_{min} ≥ −m
- b: fotos del golden set donde solo acierta el modelo nuevo
- c: fotos donde solo acierta el otro (el champion, o el de hace 3 meses)
- N: fotos del examen; en `golden-v3`, 50,000
- Δ: la diferencia pareada de exactitud, el nuevo menos el otro, en puntos porcentuales (por eso el × 100)
- SE_Δ: su [[error-estandar|error estándar]], en puntos: cuánto se movería \(Δ\) por puro azar si el examen tuviera otras fotos
- Δ_{min}: el extremo de abajo del [[intervalo-confianza|intervalo de 95 %]] de Δ, en puntos: lo peor que la diferencia podría ser, con buena seguridad
- m: el [[margen-no-inferioridad|margen de no inferioridad]], en puntos; en Alba, 0.3
:::

El 1.96 es el de siempre: el 95 % de una campana queda a menos de 1.96 errores estándar de su centro. La regla no pide que el modelo nuevo sea mejor ni igual: pide que, aun en el peor caso razonable, no esté más de \(m\) puntos abajo.

### De dónde sale el 0.3

El margen no se elige al gusto. Alba lo fijó del tamaño del ruido de su examen: lo que el golden set ni siquiera puede distinguir al medir **un** modelo solo. Ese ruido sale de la fórmula del margen de error de una muestra, la de «Ruido, muestras y pruebas A/B»:

:::formula El margen de error de un modelo solo
SE_q = sqrt{frac{q × (1 − q)}{N}} × 100
E = 1.96 × SE_q
- q: la fracción de aciertos que se mide, de 0 a 1 (top-1, top-5 o el recall de una categoría)
- N: cuántas fotos entran en esa medida; en todo `golden-v3`, 50,000
- SE_q: el error estándar de esa medida, en puntos
- E: su margen de error de 95 %, en puntos: la medida real queda a ± \(E\) de la que salió
:::

:::cuenta El margen, del ruido del golden set
Fracción de aciertos de top-1 del champion \(q\) // en el golden set | ficha de Alba | 0.85
Fotos del examen \(N\) | `golden-v3` | 50,000
Varianza de una foto \(q × (1 − q)\) | 0.85 × 0.15 | 0.1275
Error estándar de un modelo solo \(SE_q\) | √(0.1275 ÷ 50,000) × 100 | ≈ 0.16 puntos
Margen de error de un modelo solo \(E\) | 1.96 × 0.16 | ≈ 0.31 puntos
Margen de no inferioridad \(m\) // \(E\) redondeado | se fija en `gate.yaml` | **0.3 puntos**
= Perder menos de 0.3 puntos es perder menos de lo que el examen puede medir de un modelo. Alba acepta esa pérdida a cambio de tener un modelo al día.
:::

:::profundo ¿Por qué la comparación pareada es más fina que el margen?
El ruido de un modelo solo (± 0.31) es más grande que el de la comparación pareada: con 2,000 discrepancias, \(SE_Δ\) = √2,000 ÷ 50,000 × 100 ≈ 0.09 y su intervalo es ± 1.96 × 0.09 ≈ ± 0.18. ¿Por qué? Al medir un modelo solo, cuenta la suerte de qué fotos tocaron: más fotos fáciles, más aciertos. En la comparación pareada, las fotos fáciles que los dos aciertan y las difíciles que los dos fallan no mueven la diferencia; solo cuentan las que discrepan. Por eso el gate puede distinguir pérdidas más chicas que el margen.

El margen tampoco es la tolerancia de reproducción de la estación anterior (≈ 0.26): aquella mide cuánto se mueve la misma receta; esta, cuánto no distingue el examen. Es casualidad que sean parecidas.
:::

:::ojo
El margen es una decisión de negocio vestida de estadística. Alba recibe ≈ 7.5 millones de fotos al día (2.5 millones de publicaciones × 3 fotos), así que 0.3 puntos de top-1 son 0.003 × 7.5 millones ≈ 22,500 fotos diarias más con la primera sugerencia equivocada. Alba decidió que eso vale lo que cuesta no reentrenar. Otro sistema, con otro costo por error, elegiría otro margen. Lo que no se vale es elegirlo después de ver el resultado.
:::

### El candidato de noviembre

Ahora con el candidato `resnet50-2026-11-01`. El paso de evaluar dejó los pares, y el gate cuenta las discrepancias de top-1 contra el champion, la versión 14 (los números son ilustrativos):

:::cuenta El candidato de noviembre contra el champion, en top-1 (ilustrativo)
Solo el nuevo acierta \(b\) // de los pares guardados | conteo | 1,040 fotos
Solo el champion acierta \(c\) | conteo | 1,060 fotos
Discrepancias \(b + c\) // de 50,000; en las otras 47,900 empatan | 1,040 + 1,060 | 2,100
Diferencia \(Δ\) | \(Δ = (b − c) ÷ N × 100\) = −20 ÷ 50,000 × 100 | −0.04 puntos
Error estándar \(SE_Δ\) | \(√(b + c) ÷ N × 100\) = √2,100 ÷ 50,000 × 100 | ≈ 0.092 puntos
Extremo de abajo \(Δ_{min}\) | \(Δ − 1.96 × SE_Δ\) = −0.04 − 1.96 × 0.092 | ≈ −0.22 puntos
Regla \(Δ_{min} ≥ −m\) // \(m\) = 0.3 | −0.22 ≥ −0.3 | **pasa**
= El nuevo acierta 20 fotos menos de 50,000 y aun así pasa, con 0.08 puntos de holgura (lo que le sobra hasta la raya: \(Δ_{min} + m\) = −0.22 + 0.3). Con «que sea mejor de forma significativa» se habría bloqueado; con «que sea ≥ el champion», también.
:::

La misma cuenta se repite para el top-5 y contra el modelo de hace 3 meses. Contra la versión 12, con \(b\) = 1,150 y \(c\) = 1,180, sale \(Δ\) = −0.06 y \(Δ_{min}\) ≈ −0.25: también pasa.

:::figura e04-gate-margen
Tres candidatos contra la misma raya de −0.3 puntos. Lo que decide es dónde queda el extremo de abajo de cada intervalo, no el punto del centro.
:::

:::calculadora e04-gate-pareada
Empieza con el candidato de noviembre. Baja \(b\) a 1,000 y sube \(c\) a 1,100: la diferencia es −0.2 puntos y el extremo de abajo cruza la raya. Luego deja la diferencia igual y baja las discrepancias a 200 y 300: con menos fotos en desacuerdo, el intervalo se estrecha y vuelve a pasar.
:::

### La erosión: por qué también contra el de hace 3 meses

La no inferioridad tiene un hueco. Cada mes, el modelo nuevo se compara con el del mes anterior. Si cada uno pierde un poco, siempre dentro del margen, cada comparación pasa y nadie ve el total. Eso es la [[erosion-calidad|erosión de calidad]] (*slow regression*).

Con números: un modelo que pierde 0.2 puntos cada mes. Si el nuevo y el champion discrepan en pocas fotos, por ejemplo 500, el error estándar es √500 ÷ 50,000 × 100 ≈ 0.045 puntos y el extremo de abajo queda en −0.2 − 1.96 × 0.045 ≈ −0.29: pasa. Al mes siguiente pasa igual, y al otro. En 12 meses son 12 × 0.2 = **2.4 puntos** perdidos, ocho veces el margen, sin que ningún gate se haya puesto en rojo.

La defensa de Alba es una segunda comparación con la misma regla: el candidato tampoco puede ser peor que el **modelo de hace 3 meses** por más de 0.3 puntos. Contra él se suman hasta tres meses de pérdida: 3 × 0.2 = 0.6 puntos, y eso no cabe en el margen. De hecho, el gate se pone en rojo desde el segundo mes de erosión: contra el modelo de hace 3 meses, que todavía no había perdido nada, la suma ya es 2 × 0.2 = 0.4 puntos, y su extremo de abajo, −0.4 − 1.96 × 0.045 ≈ −0.49, queda fuera.

:::cuenta Cuánta erosión se cuela, con y sin la segunda comparación
Pérdida por mes \(r\), el ritmo de la erosión // el ejemplo de arriba | supuesto | 0.2 puntos
Pérdida acumulada contra el champion, en 12 meses // cada mes pasa si las discrepancias son ≈ 500 | 12 × \(r\) = 12 × 0.2 | 2.4 puntos
Contra el de hace 3 meses, la diferencia \(Δ\) // tres meses de pérdida juntos | −3 × \(r\) = −3 × 0.2 | −0.6 puntos
Su extremo de abajo \(Δ_{min}\) // con \(SE_Δ\) = √500 ÷ 50,000 × 100 ≈ 0.045 puntos | −0.6 − 1.96 × 0.045 | ≈ −0.69 puntos
Regla \(Δ_{min} ≥ −m\) | −0.69 ≥ −0.3 | **no pasa**
Erosión más grande que se cuela, \(r\) // despejada de 3 × \(r\) + 1.96 × \(SE_Δ\) ≤ \(m\) | (0.3 − 1.96 × 0.045) ÷ 3 = (0.3 − 0.088) ÷ 3 | ≈ 0.07 puntos al mes
Esa erosión en un año // sin redondear, \(r\) ≈ 0.071 | 12 × 0.071 | ≈ 0.85 puntos
= Sin la segunda comparación, el gate deja perder 2.4 puntos al año. Con ella, lo más que se cuela son ≈ 0.07 puntos al mes, ≈ 0.85 al año, y con más discrepancias, menos todavía.
:::

:::profundo Un 0.088 que no es el de antes
El 0.088 de la cuenta (1.96 × 0.045) coincide con el σ de la estación anterior solo por casualidad: aquello es el ruido entre semillas; esto es la mitad del ancho del intervalo pareado.
:::

:::figura e04-gate-erosion
La misma erosión de 0.2 puntos al mes, vista contra el champion (cada escalón pasa) y contra el modelo de hace 3 meses (tres escalones juntos, 0.6 puntos, no caben en el margen; desde el segundo mes, dos escalones, 0.4, ya tampoco).
:::

:::profundo Juega con la erosión
:::calculadora e04-gate-erosion
Empieza con 0.2 puntos al mes y 500 discrepancias. Sube las discrepancias a 2,000: el intervalo se ensancha y la erosión que se cuela baja. Vuelve a 500 discrepancias y pon la pérdida en 0.05: contra el champion pasa siempre, y contra el de hace 3 meses también; es una erosión que el gate no ve, y para eso existe el monitoreo.
:::
:::

## Categorías, cola larga, slices y calibración {Categories, long tail, slices and calibration}

Un promedio que no baja puede esconder una categoría rota. Si el modelo nuevo mejora un poco en 400 categorías y se rompe en «Zapatos de vestir», el top-1 global apenas se mueve, pero quien vende zapatos de vestir recibe sugerencias malas todos los días. Por eso el gate revisa también por pedazos, cada uno con su regla.

### Las 100 categorías con más tráfico

Alba vigila una por una las 100 categorías con más publicaciones. La regla tiene **dos** condiciones, y una categoría falla solo si cumple las dos:

1. **Su recall cae más de 5 puntos.** Es la parte que importa al negocio: una caída chica en una categoría no se nota.
2. **La caída es significativa**, con McNemar sobre las fotos de esa categoría y la corrección de Holm sobre las 100.

¿Por qué no basta la primera? Porque una categoría tiene pocas fotos. En el golden set, una categoría del puesto 50 al 100 tiene del orden de 60 a 150 fotos, y una con 60 fotos mide su recall con ± 9 puntos (es \(E\), con \(q\) = 0.85 y \(N\) = 60). Una caída de 5 puntos en ella puede ser puro ruido. Y con 100 categorías, alguna va a caer 5 puntos por azar casi cada mes: una regla de «ninguna cae más de 5» sin prueba daría falsas alarmas todos los meses, y alguien terminaría por apagarla.

¿Y por qué no basta la segunda? Porque una categoría enorme, con 1,500 fotos, puede caer 2 puntos de forma muy significativa. Es real, pero chica, y Alba decidió que no bloquea: se anota en el reporte para mirarla.

:::formula La regla de una categoría
Δ_k = frac{b_k − c_k}{N_k} × 100
text{falla si } Δ_k < −5 text{ puntos}
text{y además } p_k ≤ frac{α}{K − i + 1}
- k: una de las categorías vigiladas
- N_k: fotos del golden set cuya categoría real es \(k\)
- b_k, c_k: de esas fotos, en cuántas solo el nuevo reconoce la categoría, y en cuántas solo el otro
- Δ_k: el cambio de recall de la categoría \(k\), en puntos
- p_k: el [[p-value]] de McNemar con \(b_k\) y \(c_k\): qué tan probable sería un reparto así de desbalanceado si los dos modelos fueran igual de buenos (sin unidad, de 0 a 1)
- K: cuántas categorías se prueban; en Alba, 100
- i: el lugar de \(p_k\) al ordenar los \(K\) p-values de menor a mayor (1 es el más chico)
- α: la [[significancia]], 0.05: la probabilidad de falsa alarma que se acepta en todo el grupo de pruebas
:::

La segunda condición es Holm: el p-value más chico se compara contra α ÷ 100, el segundo contra α ÷ 99, y así, hasta el primero que no pasa; ese y todos los que siguen se cuentan como ruido.

:::cuenta Una categoría que falla: «Zapatos de vestir» (ilustrativo)
Fotos de la categoría \(N_k\) | golden-v3 | 400
Solo el nuevo la reconoce \(b_k\) | conteo | 6
Solo el champion la reconoce \(c_k\) | conteo | 30
Cambio de recall \(Δ_k\) | (6 − 30) ÷ 400 × 100 | −6 puntos
Condición 1: \(Δ_k < −5\) | −6 < −5 | sí
p-value de McNemar \(p_k\) // la versión exacta, contando volados, con 36 discrepancias | 30 de 36 a favor del champion | ≈ 7 × 10⁻⁵
Su lugar \(i\) // en la simulación plegada abajo sale el segundo más chico | ordenando los 100 | 2
Corte de Holm \(α ÷ (K − i + 1)\) | 0.05 ÷ 99 | ≈ 5.1 × 10⁻⁴
Condición 2: \(p_k\) ≤ corte | 7 × 10⁻⁵ ≤ 5.1 × 10⁻⁴ | sí
= Cumple las dos: el gate se pone en rojo por «Zapatos de vestir». Con una caída parecida en una categoría de 80 fotos, como «Lámparas» en esa simulación (2 contra 7, −6.25 puntos), McNemar daría ≈ 0.18 y no fallaría.
:::

Se puede comprobar con una simulación de 100 categorías donde solo «Zapatos de vestir» se rompió de verdad: la regla «cae más de 5 puntos» sonaría 4 veces, 3 de ellas por puro ruido; «cae y p < 0.05», sin Holm, 3 veces. La regla completa suena una sola vez, por la categoría rota. El código está plegado abajo.

:::profundo Cien categorías de juguete, en código
El código arma 100 categorías de juguete: 97 donde nada cambió de verdad (cada discrepancia es un volado) y tres con nombre. Calcula el p-value exacto de McNemar de cada una, aplica Holm y decide.

```python
import math, random

def p_mcnemar(b, c):        # exacto: si fueran igual de buenos, cada discrepancia es un volado
    total, menor = b + c, min(b, c)
    return min(1.0, 2 * sum(math.comb(total, x) for x in range(menor + 1)) / 2 ** total)

random.seed(6)
cats = {}                                   # categoría → (N_k fotos, b_k, c_k)
for j in range(97):                         # 97 categorías donde nada cambió de verdad
    n_k = random.randint(60, 1500)
    disc = sum(random.random() < 0.12 for _ in range(n_k))   # ≈ 12 % discrepan
    b_k = sum(random.random() < 0.5 for _ in range(disc))    # un volado por cada una
    cats[f"cat-{j:02d}"] = (n_k, b_k, disc - b_k)
cats.update({"Zapatos de vestir": (400, 6, 30), "Lámparas": (80, 2, 7), "Tenis": (1500, 20, 55)})

K, ALFA = len(cats), 0.05
filas = sorted((p_mcnemar(b, c), nom, (b - c) / n_k * 100) for nom, (n_k, b, c) in cats.items())
signif = set()
for i, (p, nom, _) in enumerate(filas, start=1):   # Holm: la i-ésima contra α / (K − i + 1)
    if p > ALFA / (K - i + 1):
        break                                      # la primera que no pasa corta la fila
    signif.add(nom)
for p, nom, caida in filas:
    if caida < -5 or nom in signif:
        veredicto = "FALLA" if caida < -5 and nom in signif else "no falla"
        estado = "significativa" if nom in signif else "ruido"
        print(f"{nom:17} Δ_k = {caida:+5.2f}  p = {p:.1e}  {estado:13} → {veredicto}")
print("solo «cae más de 5 puntos»:", sum(c < -5 for _, _, c in filas), "alarmas")
print("cae y p < 0.05, sin Holm:", sum(p < ALFA and c < 0 for p, _, c in filas), "alarmas")
```

```salida
Tenis             Δ_k = -2.33  p = 6.5e-05  significativa → no falla
Zapatos de vestir Δ_k = -6.00  p = 7.0e-05  significativa → FALLA
cat-48            Δ_k = -5.36  p = 2.7e-02  ruido         → no falla
cat-45            Δ_k = -5.23  p = 6.4e-02  ruido         → no falla
Lámparas          Δ_k = -6.25  p = 1.8e-01  ruido         → no falla
solo «cae más de 5 puntos»: 4 alarmas
cae y p < 0.05, sin Holm: 3 alarmas
```

Mira las dos últimas líneas. Con solo «cae más de 5 puntos», el gate habría sonado 4 veces, y 3 de esas alarmas eran ruido. Con «cae y p < 0.05» sin corregir, 3 veces: entre ellas «cat-48», que cayó 5.36 puntos por azar con p ≈ 0.027. La regla completa suena una sola vez, por la categoría que de verdad se rompió. Y «Tenis», con una caída real de 2.3 puntos, queda en el reporte sin bloquear.

**Volados exactos.** Con pocas discrepancias, como las 9 de «Lámparas», la aproximación de la campana de McNemar (\(z = (b − c)/√(b + c)\)) se equivoca. El código usa la versión exacta: cuenta, entre todos los resultados posibles de \(b + c\) volados, qué fracción es tan desbalanceada como la que salió. Es la misma intuición de «Ruido, muestras y pruebas A/B», sin la campana.
:::

### La cola larga, en grupo

Las otras 400 categorías tienen tan pocas fotos que una prueba por categoría no ve nada. Se vigilan **juntas**: el macro-recall de la cola larga del modelo nuevo no puede empeorar contra el del champion, más allá de su intervalo. Una categoría chica que se rompe sola no se ve aquí; si se rompen muchas un poco, sí. Para lo demás, el monitoreo agrupa las categorías por su categoría padre (como «Calzado» para «Tenis»), las ≈ 30 que tiene el árbol de categorías de Alba.

### Los slices

El gate mide aparte cuatro slices: fotos de celular, fotos de la web, fotos con poca luz y fotos chicas. Cada uno puede moverse **lo que mide su propio intervalo**, ≈ 1–2 puntos según su tamaño: el de poca luz, con ≈ 2,500 fotos (el 5 % del golden set) y 77.4 % de exactitud, mide con ± 1.6 puntos. Un slice que cae más que eso falla.

:::profundo Detrás de un slice puede haber personas
Detrás de un slice puede haber un grupo de personas. Las fotos con poca luz suelen venir de celulares baratos, y un modelo que les falla más castiga a quien tiene un celular barato. En Alba eso cuesta una sugerencia mala; en un sistema que decide sobre personas, como un crédito, medir por grupo es obligatorio: es la [[equidad]] de «¿Aprendió de verdad?».
:::

### La calibración

La última regla: [[ece|ECE]] ≤ 0.05 en el golden set (en promedio, la confianza y el acierto se separan a lo más 5 puntos), después de [[temperature-scaling|temperature scaling]] (dividir todos los [[logit|logits]], los números crudos que salen del modelo antes de volverse probabilidades, entre un número \(T\) para que la confianza diga la verdad). Importa porque Alba usa la confianza: una foto cuya primera sugerencia tiene confianza menor a 0.3 (30 %) se manda a la [[cola-etiquetado|cola de etiquetado]], donde una persona le pone su categoría. Si la confianza miente, se mandan las fotos equivocadas.

:::profundo Qué quiere decir un ECE de 0.05
Un ECE de 0.05 quiere decir que, en promedio sobre todos los niveles de confianza (pesando cada nivel por cuántas fotos caen en él), la confianza y el acierto se separan 5 puntos: cuando el modelo dice «90 %», lo típico es que acierte entre ≈ 85 y 95 % de las veces, aunque un nivel con pocas fotos puede quedar más lejos.
:::

## El veredicto, el reporte y los overrides {The verdict, the report and overrides}

Con todas las reglas calculadas, el gate da un veredicto. Lo que importa aquí es qué **hace** con él.

### Qué pasa si falla

Cuatro cosas, en este orden: el motivo queda escrito en la corrida (qué regla, con qué números), el paso termina con error y el pipeline se pone en rojo, se avisa a la persona de guardia (en Alba, Marta) y el champion sigue atendiendo. Nada se apaga: el modelo nuevo simplemente no sigue.

El detalle que más se rompe en la práctica: un gate que solo **regresa** `False` no detiene nada. El orquestador ve que el paso terminó sin error, lo pinta de verde y sigue con el siguiente; el `False` se queda en un log (el texto que el programa va dejando escrito) que nadie lee. El gate tiene que **fallar** como programa. Todo programa, al terminar, le regresa un número a quien lo lanzó, su código de salida: 0 quiere decir «todo bien» y cualquier otro, «fallé». El gate tiene que salir con un código distinto de 0.

```python
import math

REGLAS = {"margen_m": 0.3, "ece_max": 0.05}           # lo que dice gate.yaml, en puntos y en ECE
N = 50_000                                            # fotos de golden-v3

def no_inferior(b, c):
    delta = (b - c) / N * 100                         # Δ, en puntos
    se = math.sqrt(b + c) / N * 100                   # SE_Δ, en puntos
    d_min = delta - 1.96 * se                         # extremo de abajo del intervalo de 95 %
    return d_min >= -REGLAS["margen_m"], f"Δ = {delta:+.2f}, Δ_min = {d_min:+.2f}"

def gate(pares, ece):
    veredictos = {nombre: no_inferior(b, c) for nombre, (b, c) in pares.items()}
    veredictos["ECE"] = (ece <= REGLAS["ece_max"], f"ECE = {ece:.3f}")
    for regla, (paso, detalle) in veredictos.items():
        print(f"{'pasa ' if paso else 'FALLA'} {regla:26} {detalle}")
    rotas = [r for r, (paso, _) in veredictos.items() if not paso]
    if rotas:                                         # no basta con regresar False
        raise SystemExit(f"gate en rojo: {', '.join(rotas)}")

gate({"top-1 vs champion (14)": (1040, 1060), "top-1 vs hace 3 meses (12)": (1150, 1180)}, ece=0.031)
print("---")
gate({"top-1 vs champion (14)": (1000, 1100), "top-1 vs hace 3 meses (12)": (1090, 1210)}, ece=0.031)
```

```salida
pasa  top-1 vs champion (14)     Δ = -0.04, Δ_min = -0.22
pasa  top-1 vs hace 3 meses (12) Δ = -0.06, Δ_min = -0.25
pasa  ECE                        ECE = 0.031
---
FALLA top-1 vs champion (14)     Δ = -0.20, Δ_min = -0.38
FALLA top-1 vs hace 3 meses (12) Δ = -0.24, Δ_min = -0.43
pasa  ECE                        ECE = 0.031
gate en rojo: top-1 vs champion (14), top-1 vs hace 3 meses (12)
```

El primer candidato es el de noviembre. El segundo, con 100 fotos netas a favor del champion, pierde 0.2 puntos y su extremo de abajo queda en −0.38: no pasa. `SystemExit` termina el programa con un código distinto de 0, y eso es lo que el orquestador entiende como «falló». El gate de verdad hace lo mismo con el top-5, las 100 categorías, la cola larga y los slices; el ECE de 0.031 es de ejemplo.

### Lo que el gate revisa antes de todo: la integridad del examen

Antes de calcular una sola regla, el gate comprueba que el examen es el examen. Tres cosas:

- **El golden set está completo:** son las 50,000 fotos de `golden-v3`, y la huella de su [[manifest]] (la lista de sus fotos, cada una con su huella) es la registrada.
- **El `labels.json` es el correcto:** el archivo que dice qué categoría es cada salida del modelo tiene la huella registrada.
- **Ninguna foto del golden set entró al entrenamiento:** sus huellas SHA-256 se cruzan con las del snapshot. «Datos y etiquetas» hace el mismo cruce antes de guardar los labels de cada mes.

Si una falla, no hay veredicto: un examen roto no aprueba ni reprueba.

### El reporte

El reporte del gate es lo que queda para quien pregunte después: las 150,000 filas de predicciones (3 modelos × 50,000 fotos), las métricas globales, por categoría y por slice de los tres modelos, el veredicto de cada regla con sus números, la versión y la huella del champion contra el que se comparó, y la versión de `gate.yaml`. Queda en la corrida de MLflow. Si el modelo pasa y llega a registrarse, sus números principales se copian como tags de la versión (etiquetas de texto pegadas a ella, que explica la sección del registry).

### Overrides: quién puede saltarse una regla

A veces una regla falla por algo que el equipo entiende y acepta. Ejemplo: el negocio movió las fundas de celular de «Accesorios» a «Celulares», el modelo nuevo ya aprendió la regla nueva, y el slice de fotos chicas cae 2 puntos porque las etiquetas del golden set todavía siguen la vieja. El modelo es bueno; el examen se quedó atrás. Para eso existe el [[override-gate|override del gate]]: saltarse una regla, con permiso y por escrito.

Las reglas de Alba:

| Regla | ¿Admite override? | Quién firma |
|---|---|---|
| Un slice, el ECE, la comparación contra el modelo de hace 3 meses | Sí | La persona dueña del clasificador **y** la de producto del flujo de publicar: dos firmas |
| Top-1 y top-5 contra el champion | **No** | Nadie |
| Recall de una de las 100 categorías o macro-recall de la cola larga | **No** | Nadie: si una categoría cayó de verdad, es un problema del modelo; si el golden quedó atrasado, se corrige el golden en su propio PR |
| Integridad del examen (golden completo, `labels.json` correcto, sin fotos del golden en el entrenamiento) | **No** | Nadie |

Un override deja un [[tag-modelo|tag]] con quién lo firmó, el motivo y el número del ticket, y se revisa en la reunión mensual del equipo. Si pasa muy seguido con la misma regla, el problema es la regla: se cambia en un PR propio, como cualquier umbral.

¿Y en una emergencia? Si el modelo en producción empieza a fallar un sábado en la noche, la tentación es «saltarse el gate y subir el candidato que ya está listo». La regla de Alba es la contraria: en una emergencia se **vuelve a la versión anterior**, que ya pasó su gate y su canary (la prueba con una parte chica del tráfico real), y nunca se sube un modelo sin gate. Volver atrás es mover un nombre en el registro, como verás en la sección que sigue.

:::profundo Reglas sin override
En una inspección de piezas en una fábrica, un defecto que se escapa puede lastimar a alguien. Ahí el gate exige, por ejemplo, recall ≥ 99.5 % en cada tipo de defecto, y esa regla no tiene override: ninguna firma la salta, porque es de seguridad. En Alba, el equivalente son las reglas principales y la integridad del examen.
:::

## El registry: versiones, alias y tags {The registry: versions, aliases and tags}

El gate dijo que el modelo de noviembre es bueno, y la estación 5 lo convierte y comprueba que responde igual. ¿Dónde queda guardado? ¿Y cómo sabe el despliegue cuál de todos los modelos guardados es el que debe servir?

El [[registro-modelos|registro de modelos]] (*model registry*) es el catálogo de los modelos que pasaron sus exámenes: cada uno con un número, sus archivos, sus punteros y nombres que dicen para qué se usa. En Alba es el mismo servidor de MLflow donde se registran las corridas. Tiene cuatro piezas.

### El modelo registrado

Un nombre por **problema**, no por experimento: `classifier`, el clasificador de categorías. Todas las versiones que han atendido a Ana viven bajo ese nombre.

### La versión, que nunca cambia

Una [[version-modelo|versión de modelo]] es un modelo concreto dentro de `classifier`, con un número que MLflow asigna en orden: 1, 2, 3… En Alba, la versión 14 es `resnet50-2026-10-01` y la 15 será `resnet50-2026-11-01`; el nombre con la fecha va en un tag. Una versión es **inmutable**: sus archivos no se reemplazan nunca. Si alguien quiere cambiar algo, aunque sea el `labels.json`, es otra versión. Así, «la versión 14» quiere decir lo mismo hoy y dentro de un año. Y cada versión apunta a la corrida que la produjo, que guarda el snapshot, el commit y la imagen: es la cadena del [[linaje]] de «Versionado y linaje», empezando por el registro.

### El alias, que se mueve

Un [[alias-modelo|alias]] es un nombre que señala a una versión y que se puede mover. Alba usa dos: `champion`, la versión que atiende a la gente, y `challenger`, la que se está probando. Hoy `champion → 14`. Cuando la versión 15 termine la estación 5, quedará `challenger → 15`; cuando termine su canary (dar el modelo nuevo a una parte chica del tráfico real, que cuenta «Rollout seguro»), el pipeline de despliegue moverá `champion → 15`.

Promover un modelo es **mover un alias**. Volver atrás también: si la versión 15 falla en producción, se mueve `champion` de regreso a 14 y se despliega la imagen de la 14, que sigue guardada. Nada se borra ni se reentrena.

:::analogia El platillo del día
En una cocina, cada receta tiene su número y no se edita: si cambias la sal, es otra receta. En la entrada hay un pizarrón: «Platillo del día: receta 14». Cambiar el platillo es borrar el 14 y escribir 15; las recetas siguen todas en el libro.

Donde se rompe: cambiar el pizarrón no cambia lo que ya está en las ollas. Los servidores de Alba no leen el alias a cada rato: el modelo va metido en la imagen del servidor, y el pipeline de despliegue lee `champion` **una vez**, arma y despliega. Mover el alias solo no cambia nada en producción hasta que el despliegue corre. Eso es a propósito, y abajo ves por qué.
:::

### Los tags

Un [[tag-modelo|tag]] es una etiqueta de texto pegada a una versión: una llave y un valor (aquí no es la etiqueta de una foto). Dicen en qué estado está y quién hizo qué: `gate=passed`, `name=resnet50-2026-11-01`, `approved_by=…`, el ticket de un override, la GPU para la que se construyó el engine.

:::figura e04-gate-alias
El registro de Alba en noviembre: tres versiones que no cambian, dos alias que se mueven y los tags de cada una.
:::

:::profundo Los stages, que ya no se usan
Si lees documentación vieja de MLflow vas a encontrar *stages*: cada versión estaba en `Staging`, `Production` o `Archived`, y «promover» era cambiarle el stage. MLflow los marcó como obsoletos (*deprecated*) desde su versión 2.9, a finales de 2023, en favor de los alias y los tags. Un stage era un estado fijo con nombres que MLflow imponía; un alias es un puntero con el nombre que tú elijas, y una versión puede tener varios. Alba no usa stages: «lo paso a Production» es vocabulario viejo.
:::

:::profundo El registro, en código
Así registra la estación 5 la versión, con la [[api|API]] de MLflow para Python (lo que un programa le puede pedir a otro). Es una **ilustración** (MLflow no está instalado aquí); los nombres de las funciones son los de su cliente:

```python
from mlflow import MlflowClient

cliente = MlflowClient()
run = cliente.get_run(run_id)                                  # la corrida resnet50-2026-11-01
# la estación 5 subió los archivos a la corrida, en la carpeta model/ (con log_artifacts);
# si se usara log_model de MLflow 3, la dirección sería la que él devuelve (models:/…)
v = cliente.create_model_version("classifier", source=f"{run.info.artifact_uri}/model",
                           run_id=run.info.run_id)       # apunta a su corrida: el linaje
cliente.set_model_version_tag("classifier", v.version, "gate", "passed")
cliente.set_model_version_tag("classifier", v.version, "name", "resnet50-2026-11-01")
cliente.set_registered_model_alias("classifier", "challenger", v.version)    # final de la estación 5
# ...semanas después, al terminar el canary, lo hace el pipeline de despliegue:
cliente.set_registered_model_alias("classifier", "champion", v.version)
# la pregunta de la guardia a las 3 de la mañana: ¿quién está sirviendo?
print(cliente.get_model_version_by_alias("classifier", "champion").version)
```

Fíjate en el `run_id`: es lo que hace que la versión apunte a su corrida, el primer eslabón del linaje.
:::

### Quién mueve `champion`, y por qué los servidores no lo leen

En Alba, `champion` lo mueve **el pipeline de despliegue**, al terminar el canary. Una persona puede moverlo a mano solo con una aprobación registrada. Por eso el registro también funciona como [[registro-auditoria|registro de auditoría]]: cada versión dice de qué corrida salió, quién la aprobó y con qué reporte; el pipeline de despliegue deja escrito cuándo movió cada alias y por qué.

Y la trampa que se evita: si cada servidor leyera `models:/classifier@champion` (la dirección de MLflow para «la versión que señala `champion`») al arrancar, un servidor que se reinicia después de mover el alias cargaría el modelo nuevo, y el que no se reinició seguiría con el viejo. Dos modelos detrás del mismo servicio, sin canary, sin que nadie lo decidiera. Alba evita eso con una regla: el pipeline de despliegue lee el alias **una vez**, mete esa versión en la imagen del servidor y despliega la imagen. Un servidor nunca pregunta por el alias. Cómo se mete el modelo en la imagen lo cuenta «Empaquetado con Docker».

:::diagrama e04-gate-registro
La vida de una versión en el registro de Alba: del candidato al champion, y de vuelta si algo sale mal. Toca cada caja y sigue los dos recorridos.
:::

## Qué guarda una versión: labels.json y la ficha del modelo {What a version keeps: labels.json and the model card} [extra]

Una versión del registro no es solo un archivo de pesos. Es todo lo que hace falta para servir el modelo, saber de dónde salió y entender para qué sirve.

### El contenido

| Qué | Para qué |
|---|---|
| El modelo en ONNX (un formato estándar para guardar redes) y el engine para la T4 | Lo que se sirve; el engine con tags de su GPU (T4, cuyo código de generación es sm_75) y de la versión del software de NVIDIA con que se construyó (24.08) |
| `labels.json`, con su huella | Qué categoría es cada salida |
| La versión del preprocesamiento (1.4.0) | Cómo se prepara cada foto antes de entrar |
| La firma de entrada y salida | Entra una foto de 3 × 224 × 224 números; salen 500 logits |
| El reporte del gate y el resultado de la paridad | Por qué se aprobó |
| Los punteros de la corrida | Snapshot, commit e imagen de entrenamiento: el linaje |

Pesa ≈ 150–250 MB: el modelo en ONNX ocupa ≈ 98 MB y el engine, ≈ 50–150 MB. Doce versiones al año son, en el caso más pesado, 12 × 250 MB ≈ 3 GB, que en [[object-storage|almacenamiento de objetos]] cuestan centavos al mes. Guardar todas las versiones es barato; perder la que sirve hoy, no.

### labels.json: el orden es parte del modelo

El modelo no responde «Tenis». Responde 500 números, los [[logit|logits]], uno por categoría, y el que tiene el número más alto es la sugerencia. Qué categoría es la salida 0, cuál la 1 y cuál la 499 lo dice [[labels-json|`labels.json`]]: la lista de las 500 categorías **en el orden** de las salidas.

Si alguien reordena esa lista (por ejemplo, la ordena alfabéticamente al agregar una categoría) y no reentrena, el modelo sigue pensando lo mismo, pero cada número se traduce al nombre equivocado. Ana sube sus tenis, el modelo está 94 % seguro de la salida que significa «Tenis», y la pantalla dice «Botas» con 94 % de confianza. Ninguna prueba del servicio lo nota: responde rápido, sin errores, con una confianza alta.

Por eso `labels.json` vive **dentro** de la versión, con su huella. El servidor, al arrancar, comprueba dos cosas: que la lista tiene tantos nombres como logits salen del modelo (500) y que su huella es la registrada. El código lo muestra con 4 categorías:

```python
import hashlib, json

labels = ["Calzado › Tenis", "Calzado › Botas", "Calzado › Sandalias", "Hogar › Lámparas"]
registrado = hashlib.sha256(json.dumps(labels, ensure_ascii=False).encode()).hexdigest()

def revisar(archivo, n_logits, huella):
    h = hashlib.sha256(json.dumps(archivo, ensure_ascii=False).encode()).hexdigest()
    if len(archivo) != n_logits:
        return f"✗ {len(archivo)} nombres para {n_logits} logits"
    if h != huella:
        return f"✗ huella {h[:12]}… no es la registrada {huella[:12]}…"
    return f"✓ {n_logits} nombres, huella {h[:12]}…"

logits = [3.1, 0.2, -0.4, 1.0]                     # el modelo cree que es la clase 0: tenis
movido = sorted(labels)                            # alguien la ordenó alfabéticamente
for nombre, archivo in [("el registrado", labels), ("reordenado", movido)]:
    top1 = archivo[max(range(4), key=lambda i: logits[i])]
    print(f"{nombre:13} → «{top1}»  {revisar(archivo, len(logits), registrado)}")
print(f"{'uno de más':13} →  {revisar(labels + ['Bolsas'], len(logits), registrado)}")
```

```salida
el registrado → «Calzado › Tenis»  ✓ 4 nombres, huella 1222c00f309f…
reordenado    → «Calzado › Botas»  ✗ huella d7fe2a93f6ea… no es la registrada 1222c00f309f…
uno de más    →  ✗ 5 nombres para 4 logits
```

Con la lista ordenada alfabéticamente, la misma salida del modelo se vuelve «Botas», y solo la huella lo delata: el conteo sigue dando 4 nombres para 4 logits. Con un nombre de más, la cuenta no cuadra. Las dos son fallas que un servidor debe convertir en «no arranco», nunca en sugerencias malas.

### La ficha del modelo

Todo lo de arriba es para máquinas. Para personas hay una [[model-card|ficha del modelo]] (*model card*): un documento corto por versión que dice para qué sirve el modelo y **para qué no**, con qué datos se entrenó, cómo le va en general y por slice, qué limitaciones se conocen y quién es su dueña. La idea viene de un artículo de 2019 de un grupo de investigadores, casi todos de Google, y hoy la piden muchos equipos antes de publicar un modelo.

La de la versión 15 de Alba se vería así (ilustración; el formato lo elige el equipo):

```json
{
  "modelo": "classifier", "version": 15, "nombre": "resnet50-2026-11-01",
  "para_que": "sugiere 5 categorías para la foto de una publicación nueva",
  "para_que_no": "no está validado para moderar publicaciones sin revisión humana",
  "datos": {"snapshot": "ds-2026-10-01", "examen": "golden-v3"},
  "metricas": {"top1": "≈ 85 %", "top5": "≈ 96 %", "ece": "≤ 0.05"},
  "limitaciones": ["fotos con poca luz: ≈ 8 puntos menos de top-1", "categorías con < 50 fotos sin medir una por una"],
  "duena": "equipo de ML de Alba"
}
```

La línea más importante es «para qué no». Moderación podría querer usar el mismo modelo para decidir solo qué publicaciones se bajan. La ficha dice que no está validado para eso: un modelo que acierta 85 % de las veces sugiere bien, pero bajaría miles de publicaciones legítimas al día. Usarlo así sería otro sistema, con su propio gate.

## El gate es la primera mitad {The gate is only the first half} [extra]

El gate dice si el modelo nuevo es **seguro de probar** con gente real. No dice si se va a **quedar**. Por eso a este examen se le llama [[gate-offline|gate offline]]: se hace con fotos guardadas, antes de que el modelo le responda a nadie.

### Lo que el golden set no puede ver

- **El presente.** `golden-v3` es una foto del pasado. Si en octubre se pusieron de moda unos tenis que no estaban en él, el gate no sabe si el modelo los reconoce. El [[drift]], el mundo que se aleja del examen, lo vigila «Monitoreo, drift y reentrenamiento».
- **Lo que hace la gente.** El gate mide top-5; el negocio quiere que la gente publique. La cadena de métricas de «¿Aprendió de verdad?» (la del modelo empuja la del producto, y esa la del negocio) se puede romper: un modelo que gana en los lugares 4 y 5 de la lista y pierde un poco en el 1 sube su top-5 y baja la tasa de aceptación (la fracción de sugerencias que la gente acepta), porque casi todos eligen la primera o la segunda sugerencia.
- **El servidor de verdad.** La latencia, la memoria, que el modelo convertido responda igual: eso lo miden la estación 5 y el despliegue.

### La segunda mitad

Después del gate y de la estación 5, el challenger pasa por la sombra (*shadow*): recibe una copia de las fotos 1 o 2 días sin que nadie vea sus respuestas. Luego, el canary: 5 %, 25 % y 100 % del tráfico, con la versión anterior viva 24–48 h por si hay que volver. Si el cambio es grande, una [[ab-test|prueba A/B]] mide la tasa de aceptación con ≈ 33,000 publicaciones por brazo (cada uno de los dos grupos que se comparan) en 1–2 semanas. Eso lo cuenta «Rollout seguro». Una frase lo resume: **el gate decide si vale la pena probar; el canary, si se queda.**

### Por qué el gate mensual no puede vigilar solo

El gate corre una vez al mes, contra un examen fijo. Entre gates, el modelo puede empeorar poco a poco sin que el golden set cambie. Alba etiqueta cada mes ≈ 1,250 fotos al azar del tráfico real, y con ellas mide el top-5 con ± 1.1 puntos (es \(E\), con \(q\) ≈ 0.96 y \(N\) = 1,250). Una caída de 0.4 puntos al mes no se ve de un mes a otro: hacen falta varios meses juntos, o señales que no necesitan labels, como la distribución de la confianza. Ese es el trabajo del monitoreo, no del gate.

### Pruebas de comportamiento

Un complemento barato del golden set son las **pruebas de comportamiento** (*behavioral tests*): en vez de medir aciertos, revisan que el modelo se porte como debe ante cambios que no deberían importar. Por ejemplo, que la misma foto, recomprimida o reflejada como en un espejo, dé el mismo top-1 en ≥ 97 % de 2,000 fotos (umbral de ejemplo), o que un puñado de fotos «obvias» de cada categoría grande tenga su categoría en el top-5. Se exige un umbral sobre todas, nunca foto por foto: un modelo bueno falla alguna.

## Errores comunes {Common mistakes}

- **Mover los umbrales después de ver el resultado.** «El slice cayó 2 puntos, subamos el límite a 2.5.» El gate deja de medir y empieza a justificar. *Cómo evitarlo:* los umbrales viven en `gate.yaml` y cambian solo en un PR propio, antes de la corrida siguiente.
- **Exigir «≥ champion» exacto, o una mejora significativa.** Lo primero decide con ruido y bloquea la mitad de los meses a modelos igual de buenos; lo segundo bloquea casi todos. *Cómo evitarlo:* no inferioridad pareada con un margen fijado con el ruido del examen, −0.3 puntos en Alba.
- **Comparar dos promedios en vez de pares.** Con 85.02 % contra 85.06 % y dos intervalos de ± 0.3, todo parece ruido, y no se sabe en qué fotos discrepan. *Cómo evitarlo:* guardar las predicciones foto por foto de los tres modelos y calcular sobre las discrepancias.
- **Leer `champion` dos veces.** Si el alias se mueve a la mitad, se compara contra un modelo y se decide contra otro. *Cómo evitarlo:* leerlo una vez, pasarlo como versión fija y comprobar su huella en el reporte.
- **Un umbral por categoría sin prueba.** «Ninguna de las 100 cae más de 5 puntos» suena cada mes por ruido, y alguien termina por apagarlo. *Cómo evitarlo:* caída de más de 5 puntos **y** significativa con McNemar y Holm.
- **Un gate que regresa `False`.** El orquestador ve un paso sin error y sigue. *Cómo evitarlo:* el gate sale con error; el pipeline se pone en rojo y avisa.
- **Servidores que leen `@champion` al arrancar.** Dos modelos detrás del mismo servicio sin que nadie lo decida. *Cómo evitarlo:* el despliegue resuelve el alias una vez y despliega una imagen con el modelo adentro.

## En la vida real {In real life} [extra]

**Alba, el 1 de noviembre de 2026.** El pipeline arranca a las 03:00 [[utc|UTC]] (la hora de referencia mundial), arma el snapshot de octubre y entrena `resnet50-2026-11-01` en ≈ 3–4 h. El paso de evaluar lee `champion_version=14`, corre los tres modelos sobre `golden-v3` en ≈ 15 min y deja 150,000 filas de predicciones. El gate tarda menos de 1 min: top-1 contra el champion con \(Δ_{min}\) ≈ −0.22, contra el de hace 3 meses ≈ −0.25, ninguna de las 100 categorías falla, los slices y el ECE dentro de su regla. El checkpoint pasa a la estación 5, que en ≈ 20–30 min lo convierte, comprueba que responde igual y lo registra: versión 15, `challenger → 15`. `champion` sigue en 14 hasta que termine el canary.

**Inspección de piezas en una fábrica.** Un modelo de visión busca defectos en piezas metálicas. El gate pide el recall de **cada tipo de defecto** por separado (≥ 99.5 %, un supuesto del ejemplo) y esa regla no admite override: una grieta que se escapa puede romper una máquina. Aquí exigir mucho es lo correcto, porque el costo de un error es muy desigual.

**Segmentación de imágenes médicas.** Un modelo que marca el contorno de un tumor en tomografías se compara foto por foto contra el que está, **por slice**: por hospital, por modelo de escáner y por tipo de estudio. Ningún slice puede quedar peor que el modelo en producción por más que su propio intervalo. Un promedio que sube con un escáner roto no pasa.

**OCR de documentos.** Un sistema que lee campos de facturas (el total, la fecha, el número fiscal) pone un umbral por campo con el intervalo de Wilson (uno que funciona bien con pocas muestras, de «Ruido, muestras y pruebas A/B»), más estricto en los campos críticos. Es la misma idea de las categorías de Alba: pocas muestras por pedazo piden una prueba que respete su ruido.

**Pronóstico de demanda.** Un modelo que cada noche pronostica cuántas unidades se venderán mañana pasa por un gate antes de publicar su pronóstico. Si no pasa, el sistema publica el pronóstico de ayer. Es el «sigue el champion» de Alba, en versión diaria.

**Fuera de ML.** Los estudios de no inferioridad son comunes en medicina: un tratamiento nuevo, más barato o con menos efectos secundarios, se aprueba si no es peor que el estándar por más de un margen fijado **antes** del estudio. Y el registro con alias se parece a un repositorio de software con versiones publicadas: la 2.3.1 nunca cambia, y «latest» es un nombre que se mueve.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(b\), \(c\), \(N\), \(Δ\), \(SE_Δ\), \(Δ_{min}\) y \(m\) (no inferioridad); \(q\), \(SE_q\) y \(E\) (margen de error de un modelo solo); \(r\) (erosión por mes); \(N_k\), \(b_k\), \(c_k\), \(Δ_k\), \(p_k\), \(K\), \(i\) y \(α\) (categorías). Las diferencias van en puntos porcentuales.

:::ejercicios
? [facil] Un candidato y el champion discrepan en 1,800 fotos del golden set de Alba (\(N\) = 50,000): en 880 solo acierta el candidato y en 920 solo el champion. ¿Pasa la regla de no inferioridad de top-1, con \(m\) = 0.3 puntos?
- \(Δ = (b − c)/N × 100\) = (880 − 920) ÷ 50,000 × 100 = −40 ÷ 50,000 × 100 = **−0.08 puntos**.
- \(SE_Δ = √(b + c)/N × 100\) = √1,800 ÷ 50,000 × 100 ≈ 42.4 ÷ 50,000 × 100 ≈ **0.085 puntos**.
- \(Δ_{min} = Δ − 1.96 × SE_Δ\) = −0.08 − 0.166 ≈ **−0.25 puntos**.
- −0.25 ≥ −0.3: **pasa**, con 0.05 puntos de holgura.
? [facil] ¿Por qué el gate de Alba no usa la regla «el top-1 del candidato debe ser ≥ el del champion»? Responde con lo que pasaría con dos modelos igual de buenos.
- Si los dos son igual de buenos, el número de cada uno sube o baja un poco por azar, según qué fotos del examen le salen bien.
- La mitad de las veces el candidato sale un poco abajo, y la regla lo bloquea sin que haya nada malo.
- Con esa regla, el modelo de Alba se quedaría sin reentrenar la mitad de los meses, y envejecería mientras cambia el catálogo.
? [facil] El gate de noviembre leyó `champion` al empezar a evaluar (versión 14) y otra vez al escribir el veredicto (versión 13, porque a la mitad de la corrida la guardia regresó `champion` a la 13 por un problema en producción). ¿Qué salió mal y qué regla de Alba lo evita?
- Las predicciones guardadas son del champion 14, pero el reporte dice que se comparó contra el 13. El veredicto mezcla dos modelos.
- Alba lee el champion **una vez** y lo pasa como número fijo (`champion_version`). El reporte guarda la versión y la huella del modelo, y el paso falla si no coinciden con el registro.
? [facil] Una versión del registry ocupa ≈ 150–250 MB. ¿Cuánto ocupan las 12 versiones de un año, en el caso más pesado? ¿Por qué Alba no borra las viejas?
- Total = versiones × tamaño = 12 × 250 MB = 3,000 MB = **≈ 3 GB**.
- Guardarlas cuesta centavos al mes. Borrarlas impediría volver atrás (un rollback es mover `champion` a una versión anterior y desplegar su imagen) y responder después con qué modelo se hizo una sugerencia.
? [medio] Un modelo nuevo pierde 0.1 puntos cada mes (\(r\) = 0.1), y con el champion discrepa en ≈ 500 fotos de las 50,000 del golden set; el margen es \(m\) = 0.3. (a) ¿Pasa cada mes la comparación contra el champion? (b) ¿Y contra el modelo de hace 3 meses? (c) ¿Cuánto se pierde en un año si solo existiera la primera comparación?
- \(SE_Δ = √(b + c)/N × 100\) = √500 ÷ 50,000 × 100 ≈ 0.045 puntos; 1.96 × 0.045 ≈ 0.088.
- (a) \(Δ_{min} = Δ − 1.96 × SE_Δ\) = −0.1 − 0.088 ≈ −0.19 ≥ −0.3: **pasa**.
- (b) Contra el de hace 3 meses, \(Δ\) = −3 × 0.1 = −0.3 y \(Δ_{min}\) ≈ −0.3 − 0.088 = −0.39 < −0.3: **no pasa**. (Se supone el mismo número de discrepancias contra él; en la práctica suelen ser más, y el intervalo, más ancho.)
- (c) 12 × \(r\) = 12 × 0.1 = **1.2 puntos** en un año.
? [medio] En la categoría «Bicicletas», con 240 fotos en el golden set, solo el candidato reconoce 3 y solo el champion 17. El p-value de McNemar es ≈ 0.0026 y es el tercero más chico de los 100 (\(K\) = 100, \(α\) = 0.05). ¿Falla la categoría?
- \(Δ_k = (b_k − c_k)/N_k × 100\) = (3 − 17) ÷ 240 × 100 = −14 ÷ 240 × 100 ≈ **−5.8 puntos**: cae más de 5. Primera condición, sí.
- Corte de Holm para \(i\) = 3: \(α ÷ (K − i + 1)\) = 0.05 ÷ 98 ≈ **5.1 × 10⁻⁴**.
- 0.0026 > 5.1 × 10⁻⁴: **no es significativa** con Holm. Y como Holm corta en el primero que no pasa, todas las que siguen tampoco.
- **No falla.** Queda en el reporte: una caída de casi 6 puntos con 20 discrepancias merece que alguien abra esas 17 fotos.
? [medio] La categoría «Tenis» tiene 1,500 fotos; su recall cae 2.3 puntos con p ≈ 6.5 × 10⁻⁵, el más chico de los 100 (\(K\) = 100, \(α\) = 0.05). ¿Falla? ¿Qué harías con ese dato?
- Primera condición, \(Δ_k < −5\): −2.3 no es menor que −5. No se cumple.
- Segunda condición, \(p_k ≤ α ÷ (K − i + 1)\): para \(i\) = 1, el corte es 0.05 ÷ 100 = 5 × 10⁻⁴, y 6.5 × 10⁻⁵ es menor: **es significativa**.
- Hacen falta las dos, así que **no falla**.
- Es una caída real pero chica. Se anota en el reporte y se mira qué fotos de tenis se perdieron (¿tenis de un estilo nuevo?, ¿confundidos con zapatos de vestir?). Si se repite varios meses, es un tema para la receta o para los datos.
? [medio] Alguien propone, para no bloquear nunca un mes, override para todas las reglas con una sola firma. ¿Qué dos reglas de Alba no admiten override y por qué?
- **Top-1 y top-5 contra el champion:** son la razón de ser del gate. Si se pueden saltar, el gate no protege nada.
- **La integridad del examen** (golden completo, `labels.json` correcto, sin fotos del golden en el entrenamiento): con un examen roto, ningún número significa algo.
- Además, las que sí admiten override piden **dos** firmas (la dueña del clasificador y la de producto), con motivo y ticket, y se revisan cada mes. Una firma sola es una persona decidiendo con prisa.
? [reto] Con los números de Alba (\(q\) = 0.85, \(N\) = 50,000), ¿cuántas fotos necesitaría el golden set para que el margen de un modelo solo fuera ± 0.15 puntos? Si el margen del gate se fijara igual a ese ruido, ¿qué le pasaría a un candidato con \(Δ\) = −0.04 y 2,100 discrepancias, con el golden actual?
- Parte de \(E = 1.96 × √(q(1 − q)/N) × 100\) = 0.15 puntos, que es 0.0015 sin el × 100. Despeja \(N\): \(N = 1.96^2 × q(1 − q) ÷ 0.0015^2\) = 1.96² × 0.1275 ÷ 0.0015² = 3.8416 × 0.1275 ÷ 0.00000225 ≈ **217,700 fotos**, más de 4 veces el golden actual (para la mitad de margen, 4 veces las fotos).
- Con el golden actual, \(SE_Δ = √(b + c)/N × 100\) = √2,100 ÷ 50,000 × 100 ≈ 0.092 y \(Δ_{min} = Δ − 1.96 × SE_Δ\) ≈ −0.04 − 0.18 = −0.22.
- La regla es \(Δ_{min} ≥ −m\). Con \(m\) = 0.15: −0.22 < −0.15, **no pasaría**. Un margen más estricto que lo que el examen puede resolver bloquea modelos igual de buenos; para usarlo habría que pagar un golden set 4 veces más grande.
? [reto] Producto reordena alfabéticamente las 500 categorías de `labels.json` para la versión 15, sin reentrenar, y lo sube como un archivo nuevo dentro de la misma versión. (a) ¿Qué regla del registry se rompió? (b) ¿Qué le pasa a Ana? (c) ¿Qué dos chequeos lo detienen antes de que llegue a ella?
- (a) Una versión es **inmutable**: sus archivos no se reemplazan. Un `labels.json` distinto es otra versión, con su propio gate.
- (b) El modelo sigue diciendo la salida que significa «Tenis», pero el nombre de esa posición ahora es otro: Ana ve otra categoría con la misma confianza alta, 94 %.
- (c) Las dos huellas. El servidor, al arrancar, compara la huella de `labels.json` con la registrada: no coincide y no arranca, así que el despliegue se detiene antes de llegar a Ana. Y el gate, la próxima vez que use esa versión (por ejemplo, como champion del mes siguiente), revisa la **integridad del examen**: la huella no es la registrada y no hay veredicto. El conteo de 500 nombres para 500 logits no lo atrapa: reordenar no cambia cuántos son.
:::

## Lo que sigue {What comes next}

- «Export, engine y paridad» recibe el checkpoint aprobado: lo exporta a ONNX, construye el engine para la T4, comprueba que responde igual que el modelo que pasó el gate y registra la versión 15 como `challenger`, con sus huellas.
- «Empaquetado con Docker» mete la versión que señala `champion` dentro de la imagen del servidor, para que ningún servidor tenga que leer el alias.
- «Rollout seguro» hace la segunda mitad: shadow, canary y, si hace falta, A/B; al terminar, el pipeline de despliegue mueve `champion`. Ahí también se vuelve atrás moviendo el alias.
- «Monitoreo, drift y reentrenamiento» vigila lo que el gate no puede ver entre un mes y otro, y decide cuándo adelantar el reentrenamiento.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
quality-gate umbrales-gate gate-offline champion-challenger no-inferioridad margen-no-inferioridad mcnemar erosion-calidad reporte-gate override-gate registro-modelos version-modelo alias-modelo tag-modelo labels-json model-card
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué los umbrales del gate se escriben antes de ver los resultados, y dónde viven en Alba?
Porque decididos después siempre se acomodan al modelo que se quería aprobar. Viven en `gate.yaml`, en el repositorio, y cambian solo en un PR propio antes de la corrida siguiente.
? ¿Qué pide la regla de no inferioridad, y de dónde sale el −0.3?
Que el extremo de abajo del intervalo de 95 % de la diferencia pareada no baje de −0.3 puntos. El 0.3 es el ruido de medir un modelo solo con las 50,000 fotos: 1.96 × √(0.85 × 0.15 ÷ 50,000) × 100 ≈ 0.31.
? ¿Para qué se compara también contra el modelo de hace 3 meses?
Para atrapar la erosión: pérdidas chicas que pasan cada mes y se suman. 0.2 puntos al mes son 2.4 al año; contra el de hace 3 meses se ven juntas, 0.6, y no caben en el margen.
? ¿Cuándo falla una de las 100 categorías vigiladas?
Cuando su recall cae más de 5 puntos **y** la caída es significativa con McNemar, corregida con Holm sobre las 100.
? ¿Qué diferencia hay entre una versión y un alias en el registry?
La versión es un modelo con número que nunca cambia (la 14 es `resnet50-2026-10-01`). El alias es un nombre que se mueve (`champion`, `challenger`): promover o volver atrás es moverlo.
? ¿Quién mueve `champion` en Alba, y por qué los servidores no lo leen al arrancar?
El pipeline de despliegue, al terminar el canary; una persona, solo con aprobación registrada. Si cada servidor lo leyera al arrancar, unos cargarían el modelo nuevo y otros el viejo, sin canary.
? ¿Por qué `labels.json` es parte de la versión, con su huella?
Porque el orden de las 500 categorías es lo que traduce cada logit a un nombre. Reordenarlo sin reentrenar da categorías equivocadas con confianza alta, y ninguna prueba del servicio lo nota.
:::
