---
titulo: Monitoreo, drift y reentrenamiento
en: Monitoring, drift and retraining
subtitulo: El último paso del sistema de Alba: vigilar el servicio y el modelo en cinco capas, alertar solo cuando alguien puede y debe actuar, notar cuándo el mundo se movió y convertir esa señal en una decisión, con diagnóstico, antes de reentrenar.
pregunta: Todo contesta 200 OK, en 20 milisegundos, y el modelo empeora sin que nadie lo note. ¿Cómo se entera Alba, quién se despierta y quién no, y cuándo se manda a entrenar el modelo siguiente?
requisitos: e11-request, probabilidad, distribuciones, ruido, e01-datos, e10-rollout
---

:::idea
Un modelo roto no deja de contestar: contesta igual de rápido y con la misma seguridad aparente, pero peor. Por eso se vigila en cinco capas, de la más rápida a la más lenta; solo despierta a alguien lo que afecta a los usuarios ahora y tiene arreglo ahora; lo demás abre un ticket. Y ninguna señal reentrena sola: primero se descarta el error propio, y después una persona decide.
:::

Imagina un martes cualquiera. El servicio contesta todo con 200 OK, el código de «todo bien». El [[p99]] (el tiempo que deja abajo al 99 % de las requests) de cada pod del gateway (cada copia del programa que recibe las fotos) no pasa de ≈ 69 ms ni con el tráfico más alto para el que se diseñó. Los errores están en su nivel de siempre. Pero desde el viernes una versión nueva de la app del celular manda las fotos más comprimidas, y el modelo acierta un poco menos en esas fotos. Nadie lo ve en el dashboard (la página de gráficas) del servicio, porque para el servicio no pasó nada. Esta lección trata de cómo se nota eso, quién se entera, cuándo, y qué se hace con la señal.

## Lo que entra, lo que sale y lo que se decide {In, out and what gets decided}

Alba es la empresa del curso: un marketplace en línea que recibe ≈ 2.5 millones de publicaciones nuevas al día y sugiere la categoría de cada foto entre 500 (el árbol tiene 501 desde que el 1 de octubre se agregó «bolsas», que el modelo en producción todavía no conoce). Con las fotos que piden otros equipos de Alba (moderación y búsqueda) son ≈ 10 millones de [[request|requests]] al día, una foto por request: ≈ 116 por segundo en promedio, ≈ 350 en el pico del día y 500 en su *pico de diseño*, el tráfico para el que se compraron las máquinas. La sugerencia la hace una ResNet-50 compilada como [[engine-tensorrt|engine de TensorRT]] y servida por [[triton|Triton]], el servidor de modelos de NVIDIA, en Kubernetes, en AWS (us-east-1). Delante de Triton está el **gateway**, el programa en Python que recibe la foto, la prepara y le pide la respuesta a Triton; corre en varios [[pod|pods]], copias iguales del mismo programa. En noviembre de 2026 atiende la [[release-par|release]] 14 (en Alba, una release es un par: un gateway y un Triton de la misma versión): el modelo `resnet50-2026-10-01`, con el alias `champion` (el [[champion-challenger|champion]] es el modelo que atiende a la gente), en `triton-v14`, dos pods con una GPU T4 cada uno. El modelo se reentrena cada mes. Lo opera un equipo de 5 personas.

Alba promete dos cosas, sus [[slo|SLO]] (*service level objectives*, las metas medibles del servicio): p99 ≤ 200 ms del lado del servidor (lo que tarda dentro de Alba, sin la red del usuario), y 99.9 % de las requests sin error del servidor en cada ventana de 30 días. Ese 0.1 % que sobra es su [[error-budget|presupuesto de error]]: el 0.1 % de los ≈ 300 millones de requests de 30 días (10 millones × 30), ≈ 300,000 requests al mes; o, contado en tiempo, el 0.1 % de los 43,200 minutos del mes, 43.2 minutos.

### Lo que entra

Lo que dejó «La request en vivo» y lo que llega después:

- **El log de cada request**: una línea de ≈ 300 bytes por foto, con su [[request-id|`request_id`]], el `model_version`, el `source` (de dónde viene la foto: `mobile`, la app del celular; `web`; `internal`, otro sistema de Alba; la métrica suma `other`), el top-5 (las 5 categorías más probables) con sus scores (la probabilidad que el modelo le da a cada una), los milisegundos de cada tramo, los bytes de la foto y el código de respuesta. Son ≈ 3 GB al día (300 bytes × 10 millones) que llegan a S3 por el [[pipeline-logs|camino del log]] y quedan en Parquet (tablas guardadas por columnas), partidos por día (`dt`) y por `model_version`: ≈ 0.5 GB al día, guardados 90 días.
- **Las [[metrica|métricas]]**: los números con nombre que lleva cada pod, como `classifier_requests_total`, y que [[prometheus|Prometheus]] lee cada 15 segundos.
- **Las [[traza-distribuida|trazas]]** del ≈ 1 % de las requests (el recorrido de una request por cada programa, con lo que tardó en cada uno), y lo que mide el [[alb|ALB]] (el balanceador de la entrada) en [[cloudwatch|CloudWatch]], el servicio de métricas de AWS.
- **Los eventos del backend de publicaciones**, el programa que llama al clasificador: `suggestion_shown` (la pantalla pintó las 5 sugerencias) y `category_selected` (qué categoría quedó y por qué vía).
- **Las correcciones de moderación**, cuando una persona de Alba cambia la categoría de una publicación ya hecha.
- **El [[holdout-sin-sugerencias|holdout]]**: el ≈ 1 % de las cuentas de vendedor que nunca ve sugerencias y elige la categoría a mano.

### Lo que sale

- **Alertas con dueño y [[runbook]]**: cada una dice quién la recibe y qué hacer.
- **Tickets** cuando una señal del modelo se mueve: trabajo de la semana, no de las 3 de la mañana.
- **Un [[disparador-reentrenamiento|disparador de reentrenamiento]]**: una corrida adelantada del pipeline mensual, que solo lanza una persona después de un diagnóstico.
- **Muestras para etiquetar**: la [[cola-etiquetado|cola del mes]], ≈ 5,000 fotos que etiquetan personas pagadas, y, si un ticket lo pide, una tanda extra de un [[slice]] (un pedazo del tráfico que se mide por separado, como las fotos de un solo `source`). Con eso el ciclo vuelve a la estación 1.

### Lo que se decide

:::pasos
1. Qué se vigila y con qué retraso
Unas señales llegan en segundos y otras en semanas.
2. Qué despierta a alguien
Un *page* despierta a la guardia, la persona de turno; un *warning* espera al horario; un *ticket* es trabajo de la semana.
3. Cómo se alerta con el presupuesto
Con qué tan rápido se gasta el presupuesto del mes, no con «más de 1 % de errores».
4. Contra qué se compara el modelo
Qué referencia, qué ventana y cuánto tiempo sostenido.
5. Qué se descarta antes de reentrenar, y quién decide
Un error propio no se arregla reentrenando, y nada se despliega solo.
:::

## Las fallas silenciosas y las cinco capas {Silent failures and the five layers}

Un servidor web roto se nota: deja de contestar, o contesta 500. Un modelo roto sigue contestando con la misma latencia y la misma confianza aparente. Eso es una [[falla-silenciosa|falla silenciosa]] (*silent failure*): todo responde 200 OK mientras las predicciones empeoran.

Y casi nunca cambió el modelo. El engine de la release 14 es el mismo archivo que pasó el [[quality-gate|gate]] (el examen automático que decide si un modelo entra) en octubre; sus pesos no se mueven. Lo que cambió es **el mundo que lo alimenta**: las fotos, la gente, lo que se vende. Eso es el [[drift]]. A veces cambia lo que entra (una cámara nueva, la luz de noviembre); a veces cambia la relación entre lo que entra y la respuesta correcta, el [[concept-drift|concept drift]] (una categoría nueva que parte a otra en dos). Las dos cosas las ves a fondo en «Comparar distribuciones: cómo se mide el drift».

### Cinco capas, de la más rápida a la más lenta

Para notar lo que no truena, Alba vigila cinco [[capas-monitoreo|capas]], cada una con sus señales y su retraso:

| Capa | Qué mira en Alba | Cuánto tarda en avisar |
|---|---|---|
| Infraestructura | nodos, GPU, pods listos | segundos |
| Servicio | p99, errores 5xx, fila de Triton | segundos a minutos |
| Datos | bytes de las fotos por `source`, tasas de 400, 413 y 415 | minutos |
| Modelo | score top-1, tasa de baja confianza, PSI de las categorías | minutos a 1 día |
| Negocio | aceptación, recategorización de moderación, holdout | horas a semanas |

Los 400, 413 y 415 son los códigos con que el gateway rechaza una foto: mal formada, demasiado grande o que no es imagen. El score top-1, la baja confianza y el PSI se explican en «El modelo sin labels».

Las dos capas de arriba existen en cualquier servicio. Las tres de abajo son de ML. Y la regla que las ordena es incómoda: **cuanto más abajo, más lenta la señal y más cerca de lo que importa**. Lo que de verdad importa es si la sugerencia fue correcta, y eso solo lo dice un label (la categoría correcta), que llega tarde.

:::figura e12-monitoreo-capas
Las cinco capas de Alba. Arriba, señales que llegan en segundos y no saben nada de calidad; abajo, señales que dicen la verdad pero tardan días o semanas.
:::

### La app nueva: una falla silenciosa con números

El caso del martes, con números de ejemplo. El viernes sale una versión nueva de la app del celular que procesa distinto las fotos: más compresión y un filtro de contraste. El backend la sigue mandando con `source=mobile`. Así se ve en cada capa:

| Capa | Lo que se ve | ¿Suena algo? |
|---|---|---|
| Infraestructura | nada | no |
| Servicio | el p99 de un pod del gateway, ≈ 69 ms en el pico de diseño, y 0.1 % de 5xx: como siempre | no |
| Datos | las fotos de `mobile` bajan de ≈ 210 KB a ≈ 140 KB de mediana, en minutos | no hay alerta: se ve en el dashboard, si alguien mira |
| Modelo | la tasa de baja confianza (las fotos en que el modelo duda: su probabilidad más alta queda abajo de 0.3) sube de 4 % a 5.5 % del total | no: la alerta pide el doble, ≈ 8 % |
| Negocio | 6 días después, la aceptación de `mobile` (cuántas veces quien vende elige una de las sugerencias) cae de 70.1 % a 66.2 % semana contra semana | **sí**: un ticket |

La señal rápida (los bytes) estaba ahí desde el primer minuto, pero no prueba nada: una foto más chica no tiene por qué ser peor. La señal lenta (la aceptación) sí prueba que algo empeoró, pero tardó casi una semana. Monitorear un modelo es vivir entre esas dos: usar las rápidas para sospechar y las lentas para confirmar.

Y fíjate qué **no** se debe hacer con ese ticket: reentrenar. El modelo no tiene la culpa; la tiene un cambio en quien llama. Reentrenar le enseñaría a convivir con un bug que se arregla en la app. Lo verás en «Del aviso a la decisión».

## Las señales de servicio de Alba {Alba's service signals}

Las dos capas de arriba se vigilan como cualquier servicio web, con recetas conocidas.

### Señales doradas, RED y USE

Las [[senales-doradas|señales doradas]] (*golden signals*), del libro de SRE de Google (*Site Reliability Engineering*, la disciplina de mantener servicios en pie), son cuatro preguntas para cualquier servicio:

- **Latencia**: cuánto tarda. En Alba, el p99 del [[histograma-prometheus|histograma]] `classifier_request_latency_seconds` («latencia de cada request del clasificador, en segundos»), contra los 200 ms del SLO.
- **Tráfico**: cuánto le piden. Las requests por segundo, ≈ 116 en promedio y ≈ 350 en el pico.
- **Errores**: cuántas fallan. La fracción de 5xx (los códigos de error del servidor) sobre las requests que no son 4xx (los 4xx son culpa de quien llama: no cuentan).
- **Saturación**: qué tan lleno está: qué tan cerca del punto en que empieza a hacer esperar.

Dos recetas más cortas dicen lo mismo desde dos ángulos. **RED** (*rate, errors, duration*: tasa, errores, duración) es para cada servicio: el gateway y Triton tienen cada uno su tasa, sus errores y su latencia. **USE** (*utilization, saturation, errors*: utilización, saturación, errores) es para cada recurso: cada GPU, cada nodo, cada disco.

### Saturación: la fila, no el porcentaje

La tentación es medir la saturación con la [[utilizacion-gpu|utilización de la GPU]]: «está al 100 %, está llena». No es así. La utilización dice qué fracción del tiempo la GPU tuvo algo que hacer, no si alguien esperaba. Lo viste en «Qué tan rápido y cuánto: latencia y throughput»: la [[saturacion|saturación]] se nota en el [[tiempo-en-cola|tiempo de espera en la fila]].

Por eso la señal de saturación de Alba es la **espera media en la fila de Triton**. Triton lleva dos [[contador-prometheus|contadores]] (números que solo suben): los microsegundos que todas sus requests pasaron en la fila, acumulados, y cuántas requests terminó bien. La espera media en una ventana es el cociente de lo que creció cada uno:

:::formula Espera media en la fila de Triton
W = frac{D_q}{N_{ok}} ÷ 1,000
- D_q: los microsegundos que las requests pasaron en la fila durante la ventana: lo que creció el contador `nv_inference_queue_duration_us`, en µs
- N_{ok}: las requests que Triton terminó bien en la misma ventana: lo que creció `nv_inference_request_success`, en requests
- ÷ 1,000: pasa de µs a ms
- W: la espera media en la fila, en ms
:::

Un minuto del pico, con números de ejemplo: el contador de la fila crece \(D_q\) = 42,000,000 µs y el de éxitos \(N_{ok}\) = 21,000 (350 por segundo × 60). La espera media es 42,000,000 ÷ 21,000 = 2,000 µs = **2 ms**. Tranquilo.

Con esa misma espera trabaja [[keda|KEDA]], el programa que escala Triton: busca que la espera media de los últimos 2 minutos quede en 10 ms, con 2 réplicas (copias de Triton) como mínimo y 4 como máximo. Si la espera pasa de **20 ms durante 10 minutos**, el doble de su objetivo, salta el warning `TritonQueueTimeHigh` («la espera en la fila de Triton está alta»): KEDA no está alcanzando. La utilización tiene su propio warning, `GPUSaturated` («GPU saturada»), si una GPU pasa de 85 % durante 15 minutos. Se mide **por GPU, sin sumar**: el promedio de una al 100 % y otra al 40 % da un 70 % tranquilo que esconde a la que se ahoga.

:::ojo La utilización y la fila no dicen lo mismo
Si la GPU está al 95 % y la fila en 2 ms, todo bien: la GPU trabaja mucho y nadie espera. Si la GPU está al 60 % y la fila en 30 ms, algo raro pasa (batches chicos, un paso lento antes de la GPU). Mira la fila para saber si hay problema; mira la utilización para saber por qué.
:::

## Una alerta bien hecha {A well-made alert}

Una [[alerta]] es una regla que Prometheus evalúa cada cierto tiempo: si una expresión da verdadero el tiempo suficiente, avisa a alguien. Escribirla es fácil. Escribirla bien es lo que separa a una guardia que duerme de una que deja de creer en sus alertas.

### La anatomía

Cada alerta de Alba lleva seis cosas:

1. **Un nombre que es el síntoma**: `ClassifierHighP99Latency` («el p99 de la latencia del clasificador está alto») dice qué siente el usuario, no qué pieza falló. Se alerta por síntomas; las causas se buscan después.
2. **Una condición y una ventana**, que salen del SLO: «p99 > 200 ms».
3. **Un `for`**: cuánto tiempo debe sostenerse la condición antes de disparar.
4. **Una [[severidad-alerta|severidad]]**: page, warning o ticket.
5. **Un dueño**: una rotación de personas, nunca «el equipo».
6. **Un runbook**: el documento que dice qué revisar y qué hacer, enlazado en la alerta misma.

Y una prueba: **si no hay acción posible, no es un page**.

### Las tres severidades

| Severidad | Qué significa en Alba | A quién le llega |
|---|---|---|
| **page** | el usuario está afectado ahora y alguien puede arreglarlo ahora | a la persona de [[guardia]], que la reconoce en ≤ 5 minutos, de día o de noche |
| **warning** | una causa que anticipa un page | al canal del equipo, en horario de trabajo |
| **ticket** | la calidad del modelo y las tendencias | a la cola del equipo de ML; se revisa en la semana |

La guardia es una rotación semanal entre las 5 personas del equipo; en los ejemplos, la que está de guardia es Marta. Fíjate en lo que la tabla deja fuera de su teléfono: la calidad del modelo. Nadie debería despertarse a las 3 de la mañana porque subió el PSI. Un cambio en el modelo se entiende mirando muestras y datos, con calma, y en Alba el usuario tiene un respaldo: si no hay sugerencia, Ana, la vendedora de los ejemplos, elige la categoría en el selector manual.

### Las alertas de Alba

| Severidad | Alerta | Condición |
|---|---|---|
| page | `ClassifierHighP99Latency`\n(p99 alto) | p99 > 200 ms durante 10 min |
| page | `ClassifierErrorBudgetFastBurn`\n(el presupuesto se quema rápido) | el presupuesto se gasta 14.4× más rápido de lo permitido, en 1 h y en 5 min |
| page | `TritonNotReady`\n(Triton no está listo) | menos de 2 pods listos del Triton de la release vigente (`triton-v14` hoy) durante 5 min |
| page | `ALB5xx`\n(5xx del ALB) | los 5xx que pone el propio ALB pasan de 0.5 % del total en 5 min (`RequestCount` más esos 5xx; en CloudWatch) |
| warning | `TritonQueueTimeHigh`\n(fila de Triton alta) | espera en la fila > 20 ms durante 10 min |
| warning | `GPUSaturated`\n(GPU saturada) | una GPU > 85 % durante 15 min |
| warning | `LogsStale`\n(logs atrasados) | no llega un archivo de log nuevo a S3 en 30 min |
| ticket | `ClassifierErrorBudgetSlowBurn`\n(el presupuesto se quema lento) | 6× en 6 h y en 30 min |
| ticket | `ClassifierLowConfidenceSpike`\n(pico de baja confianza) | la baja confianza pasa del doble de su promedio de 7 días durante 30 min |
| ticket | drift de categorías | PSI > 0.2 tres días seguidos |
| ticket | caída de aceptación | > 3 puntos semana contra semana |
| ticket | `MonitoringJobStale`\n(job de monitoreo atrasado) | el job diario no publica en 26 h |

La alerta del p99 y sus 10 minutos ya los viste en «Promedios, medianas y percentiles». Las de errores van por burn rate, lo que sigue.

### `for`: que dure antes de sonar

Sin `for`, una regla dispara en la primera evaluación que da verdadero. Un deploy reinicia un pod, un minuto sale lento, y suena. Con `for: 10m` (`10m` es «10 minutos» en la notación de Prometheus), la alerta queda *pendiente* mientras la condición se cumple y solo dispara si sigue cumpliéndose 10 minutos después. Si en medio una evaluación da falso, el reloj vuelve a cero. El costo: 10 minutos más tarde en avisar. Por eso el `for` se elige con el SLO: el p99 de Alba se vigila en ventanas de 5 minutos, y dos ventanas seguidas malas ya no son un pico.

### Tráfico bajo: un error no es una tasa

A las 4 de la mañana, en un minuto pueden llegar unas pocas decenas de requests. Si en una ventana hay 20 requests y una falla, la tasa es 5 %, cincuenta veces el 0.1 % permitido. Una regla que solo mira la fracción despertaría a Marta por una sola request. La defensa es pedir volumen además de fracción: la alerta de baja confianza de Alba exige **más de 1 request por segundo** en su ventana. Es la misma idea del canary de «Rollout seguro» (la versión nueva recibe primero una parte chica del tráfico): no se juzga hasta que junta un mínimo de requests.

### La serie que no está

Si un pod del gateway muere, sus métricas **desaparecen**: no valen cero, simplemente no hay serie. Y una regla que divide errores entre requests no da «verdadero» ni «falso» sobre una serie que no existe: no da nada, y no dispara. El servicio caído tiene el dashboard más tranquilo del mundo.

Tres defensas:

- **Mirar si se pudo leer**: Prometheus guarda para cada pod que lee la serie `up`, que vale 1 si la lectura funcionó y 0 si no. `up == 0` sí da resultado cuando el pod no contesta, mientras Prometheus lo siga teniendo en su lista. Si el pod desaparece del todo (Kubernetes lo borra y ya no aparece en el Service, el objeto que lista los pods que reciben tráfico), su `up` también desaparece: por eso hacen falta las otras dos defensas.
- **Preguntar por la ausencia**: `absent(serie)` da 1 justo cuando la serie no existe.
- **Alertar desde quien espera**: `TritonNotReady` no le pregunta a Triton si está bien. Cuenta, desde Kubernetes (con kube-state-metrics, el programa que publica el estado de los objetos del clúster como métricas), cuántos pods de `triton-v14` están listos. Y `ALB5xx` mira desde el ALB: si todos los gateways salen del balanceador, el ALB contesta 503 él mismo y el gateway no cuenta nada, porque nadie le llegó. Lo viste en «La request en vivo».

### Reglas de grabación: precalcular lo caro

Algunas expresiones son caras: la tasa de errores de las últimas 6 horas suma millones de muestras. Si cada alerta la recalcula en cada evaluación, Prometheus trabaja de más. Una [[regla-grabacion|regla de grabación]] (*recording rule*) la calcula cada cierto tiempo (en Alba, cada minuto) y guarda el resultado como una serie nueva, con un nombre propio. Alba graba la tasa de errores en cuatro ventanas (`classifier:error_ratio:rate5m`, `…rate30m`, `…rate1h` y `…rate6h`) y la tasa de baja confianza en 30 minutos. El nombre sigue una costumbre de tres partes: nivel (`classifier`), métrica (`error_ratio`) y operación (`rate1h`).

### Alertmanager: de la alerta a la persona

Prometheus decide que una alerta suena. Quién se entera y cómo lo decide el [[alertmanager|Alertmanager]], un programa aparte que en Alba vive en el namespace `monitoring` (el espacio con nombre del clúster donde corre todo el monitoreo). Hace cuatro cosas:

- **Agrupa**: las alertas de un mismo incidente llegan en una sola notificación. Alba agrupa por nombre de alerta y por namespace.
- **Deduplica**: si hay dos Prometheus iguales por seguridad, la misma alerta llega dos veces; Alertmanager manda una.
- **Inhibe**: calla las alertas que son consecuencia de otra. Si `TritonNotReady` está sonando, los warning de la fila de Triton se callan: claro que la fila está mal, si no hay Triton.
- **Silencia**: durante un mantenimiento anunciado, alguien pone un silencio con hora de fin.

:::diagrama e12-monitoreo-alertas
El camino de una señal en Alba: de la métrica del pod a la persona que se entera. Toca cada caja; los recorridos siguen un incidente de errores de noche y un PSI que sube.
:::

:::profundo La regla, como la escribe Alba
Las reglas viven en el repositorio de despliegue, como objetos `PrometheusRule` que carga el operador de Prometheus (el programa que instala y configura Prometheus en Kubernetes): cambiar una alerta es un [[pull-request|PR]] que otra persona revisa. Por eso `TritonNotReady` cambia en el mismo PR que la release: cuando entre la 15, mirará `triton-v15`.

Una parte de la `PrometheusRule` de Alba, como ilustración (necesita Prometheus): la regla de grabación de 1 hora y la alerta rápida de errores.

```yaml
groups:
  - name: classifier-slo
    rules:
      - record: classifier:error_ratio:rate1h      # 5xx ÷ requests sin 4xx, en 1 h
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[1h]))
            / sum(rate(classifier_requests_total{status!~"4.."}[1h]))
      - alert: ClassifierErrorBudgetFastBurn
        expr: |
          classifier:error_ratio:rate1h > (14.4 * 0.001)
          and classifier:error_ratio:rate5m > (14.4 * 0.001)
        labels:                                       # etiquetas de la alerta, no labels de entrenamiento
          severity: page
        annotations:
          summary: "El presupuesto de errores se gasta 14.4× más rápido de lo permitido"
          runbook_url: "https://runbooks.alba.example/classifier/error-budget-burn"
```
:::

## Burn rate: alertar con el presupuesto {Burn rate: alerting with the budget}

¿Cuántos errores son demasiados? La respuesta ingenua es un umbral fijo: «más de 1 % de 5xx en 5 minutos». Tiene dos problemas. Cinco minutos al 1.1 % se comen una parte diminuta del mes (≈ 0.13 % del presupuesto, con la fórmula de abajo) y despiertan a alguien igual. Y un 0.5 % sostenido toda una semana nunca dispara, aunque se coma todo el presupuesto del mes y un poco más: 0.5 % es 5 veces el 0.1 % permitido, y una semana es 168 de las 720 horas del mes, así que gasta 5 × 168 ÷ 720 ≈ 117 % del presupuesto. El umbral fijo no sabe cuánto daño hace un error; el presupuesto sí.

### La fórmula

El [[burn-rate|burn rate]] (velocidad de gasto) es qué tan rápido se gasta el presupuesto comparado con el ritmo que lo agotaría justo al final de los 30 días. En «Probabilidad para sistemas que fallan» lo calculaste para un deploy malo: con 5 % de errores contra un presupuesto de 0.1 %, se gasta 50 veces más rápido. Aquí van las mismas letras de esa lección (\(S\), \(p\), \(R\), \(B\), \(F\), \(f\)), con un cambio: las horas de la ventana son \(t\), y no \(h\), para no confundirlas con la unidad.

:::formula Burn rate y lo que gasta una ventana
β = frac{p}{1 − S}
f = frac{β × t}{V}
t_a = frac{V}{β}
- S: el SLO de disponibilidad, como fracción: 0.999 en Alba
- 1 − S: el presupuesto como fracción de las requests: 0.001
- p: la fracción de requests con error del servidor en la ventana (5xx ÷ requests sin 4xx), como fracción
- β: el burn rate, en veces: 1× gasta el presupuesto justo en los 30 días
- t: la duración de la ventana de la alerta, en horas
- V: la ventana del SLO, en horas: 30 días = 720 h
- f: la fracción del presupuesto del mes que se gasta en esas \(t\) horas
- t_a: las horas que tardaría en agotarse el presupuesto completo a ese ritmo
- R: las requests al día: ≈ 10,000,000 en Alba
- B: el presupuesto del mes, en requests: \(B = (1 − S) × R × 30\) = 300,000 (es una letra de la cuenta, no la B de bytes)
- F: las requests con error en la ventana, \(F = R ÷ 24 × t × p\). No la confundas con \(f\): \(F\) cuenta requests y \(f\) es la fracción del presupuesto, \(f = F ÷ B\)
:::

Las tres líneas dicen lo mismo de tres formas. Si \(β\) = 1, la fracción \(p\) es justo el 0.1 % y el presupuesto dura las 720 horas. Si \(β\) = 2, dura la mitad. Y en una ventana de \(t\) horas se gasta la parte \(t ÷ V\) del mes, multiplicada por \(β\).

:::analogia El plan de datos del celular
Piensa en un plan de 30 GB al mes. Gastar 1 GB al día lo acaba justo el día 30: es el ritmo 1×. Un día de 14.4 GB va a 14.4×: a ese ritmo el plan duraría poco más de dos días (30 ÷ 14.4 ≈ 2.1), como las 50 horas del page de Alba. Lo que preocupa no es cuánto gastaste hoy, sino a qué ritmo.

Dónde se rompe: los datos los gastas porque quieres; los errores llegan sin que nadie los pida, y el presupuesto no se recarga pagando: si se acaba, Alba ya rompió su promesa.
:::

### De dónde salen 14.4× y 6×

Los números de Alba vienen del libro de trabajo de SRE de Google (*The Site Reliability Workbook*), y salen al revés: primero se decide cuánto presupuesto se tolera perder antes de avisar, y de ahí se despeja \(β\). Despejando la segunda línea, \(β = f × V ÷ t\):

- **Page**: perder 2 % del presupuesto en 1 hora. \(β\) = 0.02 × 720 ÷ 1 = **14.4**.
- **Ticket**: perder 5 % en 6 horas. \(β\) = 0.05 × 720 ÷ 6 = **6**.

:::cuenta Las dos alertas de errores de Alba
Presupuesto como fracción, \(1 − S\) // \(S\) = 0.999 | 1 − 0.999 | 0.001
Requests por hora, \(R ÷ 24\) // \(R\) ≈ 10,000,000 al día | 10,000,000 ÷ 24 | ≈ 416,667
Presupuesto del mes, \(B = (1 − S) × R × 30\) | 0.001 × 10,000,000 × 30 | 300,000
Fracción de errores del page, \(p = β × (1 − S)\) // \(β\) = 14.4 | 14.4 × 0.001 | 1.44 %
Errores en la hora, \(F = R ÷ 24 × t × p\) // \(t\) = 1 h | 416,667 × 1 × 0.0144 | ≈ 6,000
Presupuesto gastado, \(f = β × t ÷ V\) // \(V\) = 720 h | 14.4 × 1 ÷ 720 (= 6,000 ÷ 300,000) | 2 %
Se agotaría en, \(t_a = V ÷ β\) | 720 ÷ 14.4 | 50 h
Fracción de errores del ticket, \(p\) // \(β\) = 6 | 6 × 0.001 | 0.6 %
Errores en 6 horas, \(F\) // \(t\) = 6 h | 416,667 × 6 × 0.006 | ≈ 15,000
Presupuesto gastado, \(f\) | 6 × 6 ÷ 720 (= 15,000 ÷ 300,000) | 5 %
Se agotaría en, \(t_a\) | 720 ÷ 6 | 120 h = 5 días
= El page suena cuando una hora entera va al 1.44 % de errores: ≈ 6,000 requests sin sugerencia, 2 % del mes, y a ese ritmo el mes se acaba en 50 horas. El ticket, cuando 6 horas van al 0.6 %.
:::

El libro de SRE pone el de 6× como page. Alba lo manda a ticket porque tiene un respaldo: si el clasificador falla, Ana elige la categoría en el selector manual. Un 0.6 % de errores durante 6 horas se arregla en horario; un servicio sin respaldo, como un pago, lo dejaría en page. El libro tiene además un tercer nivel, 1× en 3 días (ticket), que Alba no usa. Sin él, el goteo de 0.5 % de toda una semana (5×) no llega al 6× y ninguna alerta de Alba lo ve. El último ejercicio lo calcula.

### Dos ventanas: la larga confirma, la corta apaga

Cada alerta de burn rate mira **dos ventanas a la vez**, y dispara solo si las dos pasan el umbral: 1 hora y 5 minutos para el page, 6 horas y 30 minutos para el ticket. La corta mide siempre 1/12 de la larga, la proporción que recomienda el libro: lo bastante corta para bajar en minutos. Es una [[alerta-multiventana|alerta multiventana]] (*multiwindow, multi-burn-rate alert*).

¿Para qué dos? La ventana larga es la que **confirma**: un pico de 2 minutos no mueve el promedio de una hora, así que no despierta a nadie. Pero tiene memoria: después del arreglo, la hora siguiente sigue cargando los errores de antes, y la alerta seguiría sonando media hora con el servicio ya sano. La ventana corta es la que **apaga**: 5 minutos después del arreglo vuelve a la normalidad, y como la regla pide las dos, la alerta se calla.

:::figura e12-monitoreo-multiventana
Un incidente de ejemplo: 3 % de errores (\(β\) = 30) durante 40 minutos, con el 0.1 % normal antes y después. La ventana de 1 hora cruza 14.4× en el minuto 27 y, sola, seguiría arriba hasta el 72; la de 5 minutos baja enseguida. El page suena mientras las dos están arriba: del minuto 27 al 42.
:::

:::profundo El mismo incidente, minuto a minuto
Supone el mismo número de requests cada minuto, así que la fracción de una ventana es el promedio de sus minutos:

```python
S = 0.999                        # el SLO: 99.9 % sin error del servidor
p = [0.001] * 150                # fracción con error, minuto a minuto
for minuto in range(60, 100):    # un incidente: 3 % de errores por 40 min
    p[minuto] = 0.03

def burn(fin, largo):            # β de la ventana de `largo` minutos que acaba en `fin`
    ventana = p[fin - largo + 1 : fin + 1]
    return sum(ventana) / largo / (1 - S)

sonando = False
for minuto in range(60, 150):
    larga, corta = burn(minuto, 60), burn(minuto, 5)
    ahora = larga > 14.4 and corta > 14.4
    if ahora != sonando:
        estado = "SUENA" if ahora else "se apaga"
        print(f"min {minuto - 60:>2}: {estado:8}  1 h = {larga:4.1f}×  5 min = {corta:4.1f}×")
        sonando = ahora
print(f"solo con la de 1 h se apagaría en el min {next(m - 60 for m in range(100, 150) if burn(m, 60) <= 14.4)}")
```

```salida
min 27: SUENA     1 h = 14.5×  5 min = 30.0×
min 42: se apaga  1 h = 20.3×  5 min = 12.6×
solo con la de 1 h se apagaría en el min 72
```

Suena en el minuto 27 y se apaga en el 42, 2 minutos después del arreglo (el incidente ocupa los minutos 0 a 39), con la ventana de 1 hora todavía en 20×. Son los mismos minutos de la figura. Sin la ventana corta, Marta vería la alerta sonar media hora más con todo ya bien.

¿Y si el incidente es peor? Con \(p\) = 100 % (todo falla), \(β\) = 1 ÷ 0.001 = 1,000, y la ventana de 1 hora cruza 14.4× en 14.4 ÷ 1,000 = 0.0144 horas: ≈ 0.9 minutos de errores. En la práctica suena en uno o dos minutos, porque Prometheus lee cada 15 segundos y las reglas se evalúan cada minuto. La alerta se adapta sola: cuanto más grave, más rápido suena.
:::

:::calculadora e12-monitoreo-burn
Arranca con el page de Alba: 1.44 % de errores en 1 hora. Sube \(p\) a 5 % (el deploy malo de «Probabilidad para sistemas que fallan») y mira cómo el mes se agota en 14.4 horas. Luego pon \(p\) = 0.6 % y \(t\) = 6 h: es el ticket.
:::

## El modelo sin labels: baja confianza, score y PSI {The model without labels: low confidence, score and PSI}

En el momento de la request nadie sabe si la sugerencia fue correcta. Lo que sí se sabe es lo que el modelo contestó y cómo venía la foto. Con eso se arman los [[proxy-calidad|proxies de calidad]] (*proxy metrics*): señales sin labels que avisan «algo cambió» en minutos. Ninguna prueba que el modelo empeoró. Sirven para sospechar, abrir un ticket, mirar muestras y mandar a etiquetar.

Alba tiene tres:

- **El score top-1**: la probabilidad de la categoría que quedó en primer lugar. El histograma `classifier_top1_score` («score top-1 del clasificador») lo cuenta por `model_version`, con 10 bordes (0.1, 0.2, …, 1.0): para cada borde, cuántas fotos tuvieron un top-1 menor o igual.
- **La [[tasa-baja-confianza|tasa de baja confianza]]**: qué fracción de las fotos tiene top-1 menor que 0.3.
- **El PSI de las categorías**: qué tanto cambió la mezcla de categorías predichas.

### La tasa de baja confianza

Alba llama «foto dudosa» a la que tiene top-1 < 0.3, el umbral que viste en «Qué es un modelo». En un día normal son ≈ 4 % de las fotos: ≈ 400 mil de los ≈ 10 millones. La tasa sale de dos contadores del histograma del score, en una ventana de 30 minutos:

:::formula Tasa de baja confianza
c = frac{N_{baja}}{N_{total}}
text{ticket si } c > 2 × c_7
- N_{baja}: las requests de la ventana con top-1 menor que 0.3: lo que creció el bucket `le="0.3"` del histograma del score (`le` es *less or equal*, «menor o igual»: cuenta también las de 0.3 exacto, una diferencia que no se nota)
- N_{total}: todas las requests de la ventana: lo que creció el total del histograma (`_count`)
- c: la tasa de baja confianza, como fracción
- c_7: el promedio de \(c\) en los últimos 7 días, como fracción
:::

La alerta `ClassifierLowConfidenceSpike` abre un ticket si \(c\) > 2 × \(c_7\) durante 30 minutos y además llega más de 1 request por segundo. Se compara contra su propio promedio, no contra un número fijo, porque la tasa normal se mueve con las temporadas: una campaña de bicicletas la sube un poco y eso no es una falla.

:::cuenta La baja confianza en media hora de tráfico promedio
Requests en 30 min, \(N_{total}\) // ≈ 116 por segundo × 1,800 segundos | 116 × 1,800 | 208,800
Fotos dudosas en un día normal, \(N_{baja}\) // tasa normal ≈ 4 % | 208,800 × 0.04 | ≈ 8,352
Tasa, \(c = N_{baja} ÷ N_{total}\) | 8,352 ÷ 208,800 | 4 %
Promedio de 7 días, \(c_7\) // 7 días normales como este | = la tasa normal | ≈ 4 %
Umbral, \(2 × c_7\) | 2 × 0.04 | ≈ 8 %
Fotos dudosas para disparar // más que \(2 × c_7 × N_{total}\) | 0.08 × 208,800 | > 16,704
Volumen mínimo // más de 1 request por segundo en 30 min | 1 × 1,800 | > 1,800 requests
= En media hora normal hay ≈ 8 mil fotos dudosas; el ticket pide más de ≈ 16.7 mil, sostenido 30 minutos. Con 208,800 requests, el azar mueve la tasa apenas ± 0.08 puntos (es el margen de una tasa de «Cuánto ruido tiene una tasa», más abajo: 1.96 × √(0.04 × 0.96 ÷ 208,800)): un salto al doble no es ruido.
:::

La tasa se calcula con una **regla de grabación**, `classifier:low_confidence_share:rate30m` («la fracción de baja confianza en 30 minutos»), cada minuto.

:::profundo Por qué se graba, y la expresión
¿Por qué grabarla? Porque la alerta la compara con su promedio de 7 días. Promediar 7 días de la expresión cruda en cada evaluación obligaría a Prometheus a releer una semana de buckets cada vez; promediar la serie grabada, una muestra por minuto, es barato. Por eso Prometheus guarda 15 días en Alba: la alerta necesita al menos 7.

Así se ve, como ilustración, la expresión que graba esa regla (es PromQL, el lenguaje de consultas de Prometheus que presenta «La request en vivo»):

```promql
sum(rate(classifier_top1_score_bucket{le="0.3"}[30m]))
  / sum(rate(classifier_top1_score_count[30m]))
```
:::

:::ojo Confianza no es exactitud
Un modelo puede estar seguro y equivocado. Si el modelo pone «Calzado › Tenis» a unos zapatos de vestir con 0.9 de score, la tasa de baja confianza no se mueve. Es lo que mide la [[calibracion|calibración]] («¿Aprendió de verdad?»): si el modelo dice 90 %, ¿acierta 90 de cada 100? La baja confianza ve las dudas, no los errores seguros. Por eso no basta sola.
:::

### El PSI del día, contra qué y cuánto tiempo

El [[psi|PSI]] (*Population Stability Index*, índice de estabilidad de la población) mide qué tanto se movió una distribución. Parte los datos en bins (las casillas de un histograma; aquí, cada bin es una categoría padre) y suma, bin por bin, la diferencia entre la proporción de hoy y la de la referencia, multiplicada por el logaritmo de su cociente. La cuenta completa y cómo se lee están en «Comparar distribuciones: cómo se mide el drift»; aquí importa lo operativo.

Alba lo calcula una vez al día sobre la mezcla de categorías **predichas**, agrupadas en sus ≈ 30 categorías padre (las ramas de arriba del árbol, como «Calzado», que contiene a «Calzado › Tenis»). Así lo hace también el [[canary]] de «Rollout seguro», que mide el PSI de cada hora mientras entra una versión nueva: allí, con 500 bins y una hora de datos, el puro azar daba un PSI alto. Con un día entero de fotos ese ruido es chico, pero agrupar igual hace que las dos cuentas se lean igual y que un slice chico no se infle de azar.

En una semana normal, el PSI de cada día sale ≈ 0.002. La lectura de costumbre: menos de 0.1 es estable; de 0.1 a 0.25, un cambio moderado; más de 0.25, uno grande. Alba pone su umbral en 0.2.

La pregunta difícil es **contra qué** se compara. Es la [[referencia-drift|referencia del drift]], y cada opción ve una cosa y se pierde otra («Comparar distribuciones: cómo se mide el drift» las compara todas):

| Referencia | Qué pregunta responde | Qué se pierde |
|---|---|---|
| El mes con que se entrenó el champion (su [[snapshot]], la copia congelada de los datos: `ds-2026-09-01` para la 14) | ¿ve algo que no aprendió? | si el mundo se movió para siempre, suena sin parar |
| Las 4 semanas previas | ¿cambió de golpe? | un cambio lento nunca se ve: cada semana se parece a la anterior |

Alba usa las dos: las 4 semanas previas para la alerta, y el mes del snapshot del champion para el reporte mensual, que ve los cambios lentos.

Y el **cuánto tiempo**: el ticket se abre si el PSI pasa de 0.2 **tres días seguidos**. Un solo día raro (un festivo, una campaña) no basta. En «Comparar distribuciones: cómo se mide el drift», en «Chi-cuadrado y las falsas alarmas», viste cuánto rinde pedir que dure: si una prueba da falsa alarma el 5 % de los días y los días fueran independientes, tres seguidos pasan 1 vez de cada 8,000 (0.05 × 0.05 × 0.05 = 1 ÷ 8,000). Allí también está por qué Alba usa el PSI y no un [[p-value]] (la probabilidad de ver un cambio así por puro azar): con millones de fotos, la [[prueba-ks|prueba KS]] da p ≈ 0 por cualquier cambio diminuto.

:::profundo La regla de los tres días, en Python
La regla, día por día:

```python
psi = {                          # PSI diario de las 30 categorías padre
    "11-03": 0.002, "11-04": 0.24, "11-05": 0.003, "11-06": 0.21,
    "11-07": 0.23, "11-08": 0.004, "11-09": 0.22, "11-10": 0.26,
    "11-11": 0.29, "11-12": 0.31,
}
UMBRAL, DIAS = 0.2, 3            # la regla de Alba: > 0.2 tres días seguidos

racha = 0
for dia, valor in psi.items():
    racha = racha + 1 if valor > UMBRAL else 0
    marca = "  <- ticket" if racha == DIAS else ""
    print(f"{dia}  PSI {valor:.3f}  racha {racha}{marca}")
```

```salida
11-03  PSI 0.002  racha 0
11-04  PSI 0.240  racha 1
11-05  PSI 0.003  racha 0
11-06  PSI 0.210  racha 1
11-07  PSI 0.230  racha 2
11-08  PSI 0.004  racha 0
11-09  PSI 0.220  racha 1
11-10  PSI 0.260  racha 2
11-11  PSI 0.290  racha 3  <- ticket
11-12  PSI 0.310  racha 4
```

Dos días sueltos arriba de 0.2 no abren nada; tres seguidos, sí, y abren un solo ticket aunque la racha siga.
:::

:::nota Drift no es «peor»
Un PSI alto dice que el modelo **ve** otra mezcla de fotos, no que se equivoque más. En noviembre suben los abrigos y bajan los trajes de baño, y el modelo puede acertar igual de bien en los dos. El drift abre una investigación; deciden los labels.
:::

## Los labels que llegan tarde {Labels that arrive late}

La pregunta que de verdad importa, «¿acertó?», solo la contesta un label. En Alba los labels llegan de tres fuentes, cada una con su retraso y su trampa. Son [[label-demorado|labels demorados]], como viste en «Datos y etiquetas».

### Tres fuentes, tres retrasos

| Fuente | Qué es | Retraso | Su trampa |
|---|---|---|---|
| **Aceptación** | si quien vende eligió una de las 5 sugerencias | minutos a horas | está sesgada por lo que el modelo mostró |
| **Moderación** | cuando un moderador recategoriza una publicación ya hecha | días | solo mira lo que alguien reportó o revisó |
| **Holdout** | la categoría que eligió a mano el ≈ 1 % que nunca ve sugerencias | 1 a 2 meses (madura a los 30 días) | la sugerencia no la sesga, pero tarda |

:::figura e12-monitoreo-labels
Cuándo llega cada label de una foto subida hoy. La aceptación llega primero y es la más sesgada; el holdout llega al final y es la medida limpia.
:::

### La aceptación, y por qué no basta

La [[tasa-aceptacion|tasa de aceptación]] es, de las publicaciones donde la pantalla pintó las sugerencias, la fracción cuya categoría se eligió por la vía «sugerencia». Su base es ≈ 70 %, y la mide el backend con `suggestion_shown` y `category_selected` (la vía puede ser sugerencia, búsqueda o el árbol de categorías).

:::ojo La aceptación no se mide con el log del servidor
El gateway sabe qué contestó, pero no sabe si la pantalla de Ana alcanzó a pintar la sugerencia: quizá la app se cerró, o la respuesta llegó tarde y se mostró el selector manual. Por eso la aceptación se mide con los eventos del backend, unidos al log por el `request_id`.
:::

La aceptación es la señal más rápida de negocio, pero miente un poco. Quien vende tiende a aceptar lo que le pusieron enfrente: si el modelo sugiere «Calzado › Tenis» para unos zapatos de vestir, mucha gente lo deja. Es el [[feedback-loop|feedback loop]] de «Datos y etiquetas»: contra lo que elige quien vende, el modelo parece acertar ≈ 95 %, cuando de verdad acierta ≈ 85 %. Diez puntos de optimismo.

### El holdout: la medida limpia

La defensa es una muestra que no depende del modelo: el holdout, ≈ 1 % de las cuentas de vendedor (elegidas por el hash de su `seller_id`, como viste en «Datos y etiquetas») que nunca ve sugerencias: ≈ 25 mil publicaciones al día, ≈ 750 mil al mes. Ahí la persona elige sola, así que comparar contra su elección el top-1 del champion da la exactitud sin la huella de la sugerencia (quien vende también se equivoca: eso lo mide la muestra al azar): ≈ 85 %, con ± 0.1 punto de ruido. La que dice el examen fijo del gate, el [[golden-set|golden set]], también es ≈ 85 %: la [[brecha-offline-online|brecha offline–online]] de Alba hoy es casi cero. Si un mes el holdout cae a 82 % y el golden set sigue en 85 %, el mundo ya no se parece al examen.

El precio del holdout es el tiempo: un label se cree hasta que pasan 30 días sin corrección de moderación (la [[regla-maduracion|regla de maduración]]), así que la medida limpia de este mes llega en uno o dos meses.

### Cuánto ruido tiene una tasa

Una caída de 3 puntos en la aceptación, ¿es real o es azar? Depende de cuántas publicaciones la midieron. Es el [[intervalo-confianza|intervalo de confianza]] de «Ruido, muestras y pruebas A/B», aplicado a una tasa:

:::formula Margen de una tasa y n mínimo
m = z × sqrt{frac{a × (1 − a)}{n}}
n_{min} = frac{z^2 × a × (1 − a)}{m^2}
- a: la tasa medida, como fracción: 0.70 para la aceptación de Alba
- n: cuántas publicaciones entraron en la medida (el slice en la ventana)
- z: cuántos errores estándar abarca el intervalo, sin unidad: 1.96 para uno de 95 %
- m: el margen: la tasa verdadera está en \(a ± m\) con 95 % de confianza; como fracción (× 100 para puntos)
- n_{min}: cuántas publicaciones hacen falta para que el margen quede en \(m\)
:::

:::cuenta El ruido de la aceptación, del total a un slice
Publicaciones de una semana, \(n\) // 2.5 M al día × 0.99 (sin el holdout) × 7 | 2,500,000 × 0.99 × 7 | ≈ 17.3 M
Margen del total, \(m\) // \(a\) = 0.70, \(z\) = 1.96 | 1.96 × √(0.70 × 0.30 ÷ 17,300,000) | ± 0.02 puntos
Margen de un slice de 5,000, \(m\) // 0.21 = 0.70 × 0.30 | 1.96 × √(0.21 ÷ 5,000) | ± 1.3 puntos
Margen de un slice de 500, \(m\) | 1.96 × √(0.21 ÷ 500) | ± 4.0 puntos
n mínimo para ± 1.3 puntos, \(n_{min}\) // \(m\) = 0.013; Alba lo redondea a 5,000 | 1.96² × 0.21 ÷ 0.013² | ≈ 4,774
= Con 17 millones a la semana, 3 puntos es un cambio real sin discusión. Con 5,000 en un slice, el ruido es ± 1.3 puntos (± 1.8 al comparar dos semanas, como explica el recuadro de abajo) y 3 puntos todavía se distinguen. Con 500, el ruido (± 4) es más grande que lo que buscas.
:::

De ahí sale la regla de Alba para los [[slice|slices]] (los pedazos del tráfico que se miden por separado: por `source`, por las ≈ 30 categorías padre y por `model_version`): **un slice solo alerta si tiene al menos 5,000 publicaciones en su ventana**. Abajo de eso, se mira en el reporte, pero no se abre ticket.

:::profundo Comparar dos semanas tiene más ruido
El disparador compara esta semana contra la anterior, y las dos tienen ruido. El margen de una diferencia de dos tasas independientes con el mismo \(n\) es \(z × sqrt{2 × a × (1 − a) ÷ n}\): √2 veces el de una sola. Con 5,000 por semana: 1.96 × √(2 × 0.21 ÷ 5,000) ≈ ± 1.8 puntos. La caída de 3 puntos sigue fuera del ruido, pero con menos holgura de la que parecía. Con 2,500 por semana serían ± 2.5 puntos: casi el umbral.
:::

:::profundo Tres slices de una semana, en Python
Tres slices de una semana, con números de ejemplo: los dos `source` más grandes y una categoría padre chica.

```python
import math

Z, N_MIN, CAIDA = 1.96, 5_000, 0.03   # 95 %, n mínimo y el disparador (3 puntos)
slices = {                     # slice: (n esta semana, a esta semana, a la anterior)
    "source=mobile":      (10_400_000, 0.662, 0.701),
    "source=web":         ( 6_100_000, 0.703, 0.699),
    "padre=Instrumentos": (     3_100, 0.640, 0.690),
}
for nombre, (n, a, a_antes) in slices.items():
    m = Z * math.sqrt(a * (1 - a) / n)          # margen al 95 %
    if n < N_MIN:
        veredicto = "n chico: no alerta"
    elif a_antes - a > CAIDA:
        veredicto = "ticket"
    else:
        veredicto = "estable"
    print(f"{nombre:19} a = {a:.1%} ± {m * 100:.2f} pts  "
          f"cambio {(a - a_antes) * 100:+.1f} pts  {veredicto}")
```

```salida
source=mobile       a = 66.2% ± 0.03 pts  cambio -3.9 pts  ticket
source=web          a = 70.3% ± 0.04 pts  cambio +0.4 pts  estable
padre=Instrumentos  a = 64.0% ± 1.69 pts  cambio -5.0 pts  n chico: no alerta
```

`mobile` es el caso de la app nueva: cayó 3.9 puntos con un ruido de centésimas, y abre ticket. La categoría chica cayó más, 5 puntos, y quizá sea real, pero con 3,100 publicaciones no llega al n mínimo: queda en el reporte, donde alguien la mira con calma. Con ≈ 30 categorías padre y varios `source`, docenas de slices chicos se moverían cada semana por azar; el n mínimo evita que cada uno abra un ticket.
:::

:::calculadora e12-monitoreo-intervalo
Arranca con un slice de 5,000 y la aceptación de 70 %. Baja \(n\) a 500 y mira cómo el margen pasa los 3 puntos del disparador. Luego mueve el margen que quieres: con ± 1 punto, el n mínimo ya es ≈ 8 mil.
:::

## Del aviso a la decisión: diagnosticar antes de reentrenar {From the alert to the decision: diagnose before retraining}

Ya hay un ticket. La tentación es reentrenar: «el modelo empeoró, que aprenda lo nuevo». A veces es lo correcto. Muchas veces no: reentrenar sobre un bug propio le enseña el bug al modelo.

### Tres cosas que se descartan primero

Antes de tocar el modelo, quien recibe el ticket descarta, en este orden:

:::pasos
1. Un deploy propio
¿El cambio empezó justo cuando entró una release, del modelo o del gateway? Si coincide, es nuestro: se hace rollback con el [[runbook-rollback|runbook de rollback]] de «Rollout seguro», no se reentrena.
2. Datos rotos del lado de quien llama
¿El cambio está en un solo `source`, o empezó con una versión nueva de la app? Se avisa al dueño de ese cambio. Es el caso de la app nueva.
3. Training-serving skew
¿Prepara el gateway la foto igual que el entrenamiento? El [[training-serving-skew|training-serving skew]] de «Una foto, vista por un modelo» se ve como drift, pero es un bug: si empeoró desde el día de un deploy, es tu código. Se corre la [[prueba-paridad|prueba de paridad]] de punta a punta: las mismas fotos por el camino del entrenamiento y por el del gateway, y se compara lo que sale.
:::

Solo si cambió el mundo, y los labels lo confirman, se adelanta el reentrenamiento.

### De la señal a la acción

| Lo que se ve | Lo que se hace |
|---|---|
| Cambió justo tras un deploy propio | rollback; no reentrenar |
| Un input raro en un solo `source` | avisar al dueño; no reentrenar |
| PSI alto, labels estables | etiquetar una muestra; por ahora, nada más |
| PSI alto y labels peores en el mismo slice | tanda extra de ese slice y reentrenar |
| Labels peores en todos lados, inputs estables | concept drift o cambio de criterio: revisar la guía de etiquetado y reetiquetar |
| Un cambio anunciado (una categoría nueva) | no esperar a la alerta: planearlo |
| Nada raro | el calendario mensual |

### Los disparadores, y quién aprieta el botón

En Alba, un reentrenamiento se dispara por cuatro caminos:

- **El calendario**: la corrida `reentreno-mensual`, el día 1 de cada mes a las 03:00 UTC, que viste en «Versionado y linaje». Tarda ≈ 4–5 horas y cuesta ≈ US$3–4 de GPU.
- **El PSI** > 0.2 tres días seguidos.
- **La aceptación**, si cae más de 3 puntos semana contra semana.
- **Una [[categoria-nueva|categoría nueva]]** en el árbol, como «bolsas» el 1 de octubre (el árbol pasó de 500 a 501 categorías). Esta es planeada: se sabe antes y no espera a ninguna alerta.

Ninguno de los cuatro reentrena solo. **Un disparador abre un ticket**, y después del diagnóstico una persona del equipo decide. Si decide adelantar, lanza la corrida a partir del mismo CronWorkflow, la tarea programada de Argo Workflows (el programa que corre los pipelines de Alba dentro de Kubernetes) que lanza `reentreno-mensual` cada mes:

```bash
argo submit --from cronwf/reentreno-mensual
```

Es un comando de ilustración: necesita el clúster de Alba. La corrida adelantada arma un snapshot extra con la fecha del día de corte, por ejemplo `ds-2026-11-18` si se lanza el 18 de noviembre, con los labels vigentes ese día. La corrida del día 1 sigue igual.

Y si el ticket lo pide, la persona también encarga una **tanda extra de etiquetado**: ≈ 500 fotos del slice afectado, elegidas al azar dentro del slice del log, encima de la cola normal de ≈ 5,000. A 5–10 centavos de dólar por foto son ≈ US$25–50, y tardan ≈ 5 días hábiles. Sin labels nuevos del slice que falla, el modelo nuevo no tiene de dónde aprender lo que cambió.

:::ojo No reentrenes con los labels de tu propio modelo
Si la aceptación cayó en `mobile` y reentrenas con lo que eligió quien vende esa semana, entrenas con elecciones que el modelo mismo empujó. El modelo aprende a imitar sus sugerencias. Los labels que corrigen un drift salen de la cola humana, de moderación o del holdout, no de la aceptación cruda.
:::

### El modelo nuevo sube la misma escalera

Que el disparo sea urgente no salta ningún paso: el mismo gate contra el champion, la paridad del engine, el [[shadow]] de 1–2 días (contesta copias de requests reales sin que nadie vea su respuesta) y el canary de 5 % y 25 % del tráfico, 4 horas cada uno, y luego 100 %, con 24–48 horas de [[bake]] (la versión anterior sigue prendida, para volver a ella con solo cambiar el ruteo). La política en una frase: **un reentrenamiento que arranca solo está bien; uno que llega a producción sin gate ni canary, no**.

### El ciclo se cierra

Con esto la estación 12 entrega lo que la estación 1 necesita: qué fotos etiquetar (la cola del mes, y la tanda extra si hubo ticket) y cuándo armar el snapshot siguiente. Las fotos dudosas que mide la baja confianza son las mismas que la cola elige por incertidumbre. El sistema es un círculo: los datos entrenan un modelo, el modelo atiende, el monitoreo mira cómo atiende, y lo que ve decide qué datos siguen.

:::diagrama e12-monitoreo-decision
De la señal a la decisión. Toca cada caja; los tres recorridos siguen el ticket de la app nueva (no se reentrena), un drift real (se adelanta la corrida) y un deploy propio (rollback).
:::

## Vigilar al que vigila: el job diario y su frescura {Watching the watcher: the daily job and its freshness} [extra]

El PSI del día, la aceptación por slice y los bytes por `source` no salen de ningún pod con métricas: los calcula un job que corre y termina. En Alba es el CronWorkflow `monitoreo-diario` de Argo Workflows, a las 01:00 UTC, sobre el día UTC anterior. Tarda ≈ 20 minutos y hace cinco cosas:

1. Pasa el log crudo de S3 a Parquet, partido por `dt` y `model_version`.
2. Calcula el PSI de las ≈ 30 categorías padre contra las 4 semanas previas.
3. Calcula la aceptación por día y por slice (une el log con los eventos del backend por `request_id`).
4. Cuenta bytes y tasas de 4xx por `source`.
5. Publica cada resultado como [[gauge-prometheus|gauge]] (una métrica que sube y baja) en el **Pushgateway**.

### Por qué un Pushgateway

Prometheus lee métricas de quien está vivo: cada 15 segundos hace un [[scrape]], va y pregunta. Un job de 20 minutos tiene sus resultados hasta el final, justo antes de terminar a las 01:20: ningún scrape los alcanza con seguridad, y después ya no hay a quién preguntar. El Pushgateway es un programa que se queda prendido: el job le **empuja** sus resultados al terminar, y Prometheus los lee de ahí como de cualquier pod.

### La trampa: el Pushgateway nunca olvida

El Pushgateway guarda el último valor de cada serie hasta que alguien lo borre: no tiene caducidad. (Solo lo pierde si se reinicia sin guardar a disco.) Si el job deja de correr (un cambio de permisos en S3, una imagen que ya no existe), el último PSI se queda publicado para siempre: 0.002, estable, día tras día. El dashboard se ve perfecto, y nada se está midiendo.

La defensa es medir la [[frescura-job|frescura del job]]: cuánto hace que publicó por última vez. El Pushgateway guarda, para cada grupo de métricas, la serie `push_time_seconds`: la hora del último envío, en segundos desde 1970. La alerta `MonitoringJobStale` abre un ticket si `time() - push_time_seconds` pasa de 26 horas. ¿Por qué 26 y no 24? El job corre cada 24 horas y tarda ≈ 20 minutos; con 2 horas de margen, un día en que tarde un poco más no abre un ticket, y uno en que no corre sí.

Es la misma idea de `LogsStale`: si no llega un archivo nuevo de log a S3 en 30 minutos, algo se rompió en el camino aunque nadie se queje. **Un monitor que puede morir en silencio necesita su propio monitor.**

:::nota Tres jobs que no se confunden
El job horario del canary calcula el PSI cada hora por `model_version` mientras dura un rollout («Rollout seguro»). El `reentreno-mensual` arma el snapshot y entrena. Y `monitoreo-diario` vigila al champion todos los días. Tres jobs, tres preguntas.
:::

## La guardia: dashboards, runbooks, fatiga y postmortems {On-call: dashboards, runbooks, fatigue and postmortems} [extra]

### Un dashboard por audiencia

Un [[dashboard]] es una página de gráficas en vivo; Alba los arma en Grafana, que consulta a Prometheus. Tiene cuatro, porque cada audiencia hace otra pregunta:

| Dashboard | Para quién | Qué tiene |
|---|---|---|
| Servicio | la guardia | arriba, el SLO y el presupuesto que queda; abajo, tasa, errores y latencia por tramo, con marcas de cada deploy |
| Triton y GPU | la guardia y el equipo | fila contra cómputo, batch promedio, réplicas contra el tope de KEDA |
| Modelo | el equipo de ML | score top-1, baja confianza, las 20 categorías más grandes contra su línea base; todo por `model_version` |
| Negocio | producto | diario: aceptación, recategorización, publicaciones completadas |

Un dashboard que sirve a los tres no le sirve a ninguno: la guardia a las 3 de la mañana necesita ver en 10 segundos si el SLO está en peligro, no buscarlo entre 40 gráficas de categorías.

### El runbook del p99

Un runbook es la receta de qué hacer cuando suena una alerta, escrita en calma para usarse con prisa. El de `ClassifierHighP99Latency`, en el orden en que Marta lo sigue:

:::pasos
1. ¿Qué tramo subió?
El preproceso, la fila de Triton o el cómputo. El dashboard de servicio los muestra por separado.
2. ¿Hubo deploy?
Si el salto coincide con una release, rollback con el runbook de «Rollout seguro».
3. ¿KEDA está en su tope de 4 réplicas?
Si la fila crece y ya no hay más réplicas, falta GPU: se sube el tope o se agrega capacidad.
4. ¿Un cliente manda de más?
Si un solo cliente duplicó su tráfico, se aplica su cuota.
5. Escalar
Si en 30 minutos no mejora, Marta llama a otra persona del equipo.
:::

La regla de fondo: **mitigar primero, entender después**. A las 3 de la mañana, volver a la versión anterior y entender mañana es mejor que entender ahora con el SLO ardiendo.

### Fatiga de alertas

Si una alerta suena seguido y nunca pasa nada, la gente deja de mirarla, y la vez que importa también la ignora. Eso es la [[fatiga-alertas|fatiga de alertas]]. Se mide así: **qué fracción de los pages terminó en una acción**. Con números de ejemplo: si en un mes hubo 12 pages y en 9 alguien hizo algo, 75 %; los 3 restantes son candidatos a borrar o a bajar a warning. Una alerta que nadie atendió en un mes no protege nada: estorba.

### Postmortem sin culpables

Después de todo page con impacto en los usuarios, Alba escribe un [[postmortem]] en ≤ 5 días hábiles. Es **sin culpables** (*blameless*): no busca quién se equivocó, sino qué dejó que el error llegara a producción. Lleva línea de tiempo, impacto, con qué señal se detectó y acciones con dueño y fecha.

En ML la pregunta clave es otra: **¿qué señal lo habría detectado antes?** Si a la app nueva la descubrió la aceptación 6 días después, la acción puede ser una alerta de datos: un aviso si la mediana de bytes de un `source` cae más de un cuarto en un día. Si lo encontró un usuario, falta una métrica. Si lo encontró una alerta tres semanas tarde, falta una señal más rápida.

## Errores comunes {Common mistakes}

:::ojo Un dashboard verde con el modelo empeorando
El servicio contesta 200 OK en 20 ms y nadie mira más abajo. **Cómo evitarlo:** vigila las cinco capas, con al menos una señal del modelo (baja confianza, PSI) y una de negocio (aceptación, holdout).
:::

:::ojo Despertar a alguien por el PSI
Un page a las 3 de la mañana porque cambió la mezcla de categorías. Nadie puede hacer nada útil a esa hora, y a la tercera vez la guardia deja de creerles a sus alertas. **Cómo evitarlo:** page solo para lo que afecta al usuario ahora y tiene arreglo ahora; la calidad del modelo va a ticket.
:::

:::ojo Una alerta sin `for` ni volumen mínimo
Suena con cada deploy y cada madrugada con 20 requests. **Cómo evitarlo:** pide que la condición dure (`for`), y que haya tráfico suficiente en la ventana para que la fracción signifique algo.
:::

:::ojo Confiar en una regla sobre una serie que puede desaparecer
Si el servicio muere, sus métricas no existen y la regla no evalúa: el dashboard se ve tranquilo. **Cómo evitarlo:** alerta también con `up == 0`, `absent()` o desde quien espera la señal (Kubernetes, el ALB).
:::

:::ojo Reentrenar sobre un bug propio
El PSI subió y se lanza el reentrenamiento sin mirar. Si la causa era un deploy, la app nueva o un skew, el modelo nuevo aprende el error. **Cómo evitarlo:** descarta deploy, datos de quien llama y skew antes de adelantar nada; un disparador abre un ticket, no un deploy.
:::

:::ojo Medir la calidad con lo que el modelo mismo sugirió
La aceptación dice ≈ 95 % de acierto cuando el real es ≈ 85 %. **Cómo evitarlo:** mide la exactitud con el holdout, que no ve sugerencias, y entrena con labels que el modelo no empujó.
:::

## En la vida real {In real life} [extra]

**Alba.** Todo lo de esta lección corre todos los días: 12 alertas con su severidad, un job diario que publica el PSI y la aceptación por slice, una guardia de 5 personas y una política que no deja que nada se despliegue solo.

**Inspección industrial.** Un modelo que rechaza piezas defectuosas solo recibe labels de las que rechazó, porque esas las revisa una persona. Se ve cuántos rechazos eran falsos (la precisión), pero no cuántas piezas malas pasaron (el recall). La defensa es la idea del holdout: piezas patrón con defectos conocidos y una muestra de aprobadas que se revisa a mano.

**Un sistema con cola de mensajes.** Si un sistema procesa trabajos de una [[cola-mensajes|cola]], su saturación no es cuántos mensajes hay, sino la edad del más viejo: mil mensajes que salen en un segundo no preocupan; uno que lleva una hora, sí. Y los mensajes que siempre fallan terminan en la [[dlq|DLQ]], que tiene su propia alerta.

**Fraude y recomendación.** En fraude, solo se sabe que una transacción lo era cuando alguien reclama, semanas después, y solo de las que el modelo dejó pasar. En recomendación, solo se sabe si gustó lo que se mostró. En los dos, como en la aceptación de Alba, el label está filtrado por el modelo, y hace falta una muestra chica al azar que no lo esté.

**Un LLM o el asistente con RAG.** Un [[llm|LLM]] genera texto token por token (pedazos de palabra); con [[rag|RAG]] (*retrieval-augmented generation*), antes de contestar busca y lee los documentos que sirven. El asistente interno de Alba responde así ≈ 25 mil preguntas al día con los documentos de la empresa. Su latencia se vigila por token (el tiempo hasta el primer token y entre tokens), y su calidad, con muestras de respuestas que califica una persona u otro modelo: ahí no hay «aceptación» automática.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Usa las letras de la lección: \(S\), \(p\), \(β\), \(t\), \(V\), \(f\), \(t_a\), \(R\), \(B\), \(F\) (burn rate); \(c\), \(c_7\), \(N_{baja}\), \(N_{total}\) (baja confianza); \(a\), \(n\), \(z\), \(m\), \(n_{min}\) (el ruido de una tasa); \(W\), \(D_q\), \(N_{ok}\) (la fila de Triton).

:::ejercicios
? [facil] Un deploy malo hace fallar 2 % de las requests de Alba. ¿Cuál es su burn rate? ¿Suena el page si dura una hora? ¿En cuántas horas se acabaría el presupuesto del mes?
- \(β = p ÷ (1 − S)\) = 0.02 ÷ 0.001 = **20×**.
- La ventana de 5 minutos pasa 14.4× casi enseguida. La de 1 hora promedia 20× por la fracción de la hora que lleva el deploy, así que llega a 14.4× cuando esa fracción es 14.4 ÷ 20: a los 14.4 ÷ 20 × 60 ≈ 43 minutos. Si dura una hora, **sí suena**.
- \(t_a = V ÷ β\) = 720 ÷ 20 = **36 horas**.
? [facil] Clasifica cada alerta en page, warning o ticket, como Alba: (a) la fila de Triton en 25 ms durante 15 minutos; (b) la baja confianza en 9 % durante una hora; (c) el ALB contesta 503 a todo; (d) el PSI en 0.23 un solo día.
- (a) **Warning** (`TritonQueueTimeHigh`): anticipa un page, pero el usuario todavía no está afectado.
- (b) **Ticket** (`ClassifierLowConfidenceSpike`): es calidad del modelo; si la base es ≈ 4 %, 9 % pasa el doble.
- (c) **Page** (`ALB5xx`): todos los usuarios están afectados ahora.
- (d) **Nada todavía**: la regla pide más de 0.2 tres días seguidos.
? [facil] En un minuto del pico, el contador de la fila de Triton crece \(D_q\) = 1,470,000,000 µs y el de éxitos \(N_{ok}\) = 21,000. ¿Cuánto es \(W\)? ¿Suena algo si dura así 10 minutos?
- \(W = D_q ÷ N_{ok} ÷ 1,000\) = 1,470,000,000 ÷ 21,000 ÷ 1,000 = 70,000 ÷ 1,000 = **70 ms**.
- Pasa los 20 ms: tras 10 minutos, **warning** `TritonQueueTimeHigh`. Con 70 ms de fila, la request típica de 20 ms ya va en ≈ 90, y el p99 se acerca a los 200: es probable que pronto también suene el page del p99.
? [facil] La aceptación de un slice es 70 % con \(n\) = 2,000 publicaciones. ¿Cuánto es su margen? ¿Puede alertar en Alba?
- \(m = z × √(a × (1 − a) ÷ n)\) = 1.96 × √(0.21 ÷ 2,000) = 1.96 × 0.0102 ≈ **± 2.0 puntos**.
- **No alerta**: tiene menos de 5,000. Se ve en el reporte.
? [medio] El PSI del día sale 0.25 el martes, el miércoles y el jueves. Ese martes entró la release del gateway que cambió cómo se decodifica WebP. La aceptación no se movió. ¿Qué se hace?
- Se abre el ticket (tres días seguidos arriba de 0.2), pero el diagnóstico va primero.
- **Deploy propio**: el cambio empezó el día de la release. Es lo primero que se descarta, y aquí coincide. Se compara el PSI por formato de foto; si el salto está en las WebP, es el código.
- Acción: **rollback** del gateway o un arreglo, y una prueba de paridad que incluya WebP. **No se reentrena**: el modelo aprendería a convivir con una decodificación rota.
:::

:::profundo Cinco ejercicios más, para la segunda pasada
:::ejercicios
? [medio] Durante 6 horas, Alba falla 0.8 % de las requests y en la última media hora sigue igual. ¿Qué alerta suena? ¿Cuántas requests fallaron y qué parte del presupuesto se fue?
- \(β = p ÷ (1 − S)\) = 0.008 ÷ 0.001 = **8×**: pasa 6× en 6 h y en 30 min, pero no 14.4×. Suena el **ticket** `ClassifierErrorBudgetSlowBurn`, no el page.
- \(F = R ÷ 24 × t × p\) = 416,667 × 6 × 0.008 ≈ **20,000** requests.
- \(f = β × t ÷ V\) = 8 × 6 ÷ 720 ≈ **6.7 %** del mes (= 20,000 ÷ 300,000).
? [medio] A las 4 de la mañana llegan 25 requests por segundo. En media hora, ¿cuántas fotos dudosas dispararían `ClassifierLowConfidenceSpike` si \(c_7\) = 4 %? ¿Y si el tráfico fuera de 0.5 requests por segundo?
- \(N_{total}\) = requests por segundo × 1,800 s = 25 × 1,800 = 45,000. El ticket pide \(N_{baja} > 2 × c_7 × N_{total}\) = 0.08 × 45,000 = **3,600** fotos dudosas, sostenido 30 minutos.
- Con 0.5 por segundo no llega al volumen mínimo (más de 1 por segundo): **no dispara**, por más alta que sea la tasa. Con 900 requests en la media hora, 18 fotos dudosas de más moverían la tasa 2 puntos.
? [medio] Una persona propone cambiar `MonitoringJobStale` de 26 a 48 horas «para que haga menos ruido». ¿Qué se pierde? Supón que el job deja de correr el lunes a las 01:00 UTC, justo después de su última corrida buena del domingo.
- Con 26 h: la última publicación fue el domingo ≈ 01:20; el ticket se abre el lunes ≈ 03:20, **≈ 2 horas** después de la corrida que faltó.
- Con 48 h: se abre el martes ≈ 01:20. Un día entero más con el PSI y la aceptación congelados en el valor del domingo.
- Si en esos días empieza un drift real, la regla de «3 días seguidos» tarda un día más en contar. El ruido que se ahorra es casi cero: el job corre una vez al día.
? [reto] Diseña la señal que habría detectado la app nueva antes que la aceptación. Tienes el histograma `classifier_image_bytes` (los bytes de cada foto) por `source`. La mediana de `mobile` bajó de ≈ 210 KB a ≈ 140 KB. Propón una regla con su severidad, su ventana y su defensa contra falsas alarmas, y di por qué no debe ser un page.
- Una regla que compara la mediana (el p50 estimado desde los buckets) de bytes de cada `source` contra su promedio de 7 días: aviso si cae más de 25 % durante 2 horas. 140 ÷ 210 ≈ 0.67: una caída de ≈ 33 %, que la pasa.
- Defensas: volumen mínimo por `source` (que `internal`, con poco tráfico, no dispare solo), `for` de 2 horas y comparar cada `source` contra sí mismo, no contra el total.
- Severidad: **ticket**. Una foto más chica no prueba que el modelo falle; abre una investigación (¿hubo una versión nueva de la app?) y le gana 6 días a la aceptación. No es page porque el usuario no está afectado de forma medible ahora y la guardia no puede arreglar la app de madrugada.
? [reto] Alba quiere un tercer nivel de burn rate, como el del libro de SRE: perder 10 % del presupuesto en 3 días. ¿Qué \(β\) le toca, qué ventana corta y qué fracción de errores? ¿Qué severidad le pondrías?
- \(β = f × V ÷ t\) = 0.10 × 720 ÷ 72 = **1×**: gastar el presupuesto justo al ritmo que lo acaba en el mes.
- Ventana corta: 1/12 de 72 h = **6 horas**.
- \(p = β × (1 − S)\) = **0.1 %**: el ritmo normal permitido, sostenido 3 días.
- Severidad: **ticket**. A ese ritmo el mes alcanza justo; no hay emergencia, pero conviene saberlo antes de gastar el resto en deploys.
:::
:::

## Lo que sigue {What comes next}

Esta es la última estación, y no termina: devuelve el sistema a donde empezó.

- «Datos y etiquetas» recibe la cola del mes, las tandas extra y las fotos dudosas; relee «El feedback loop y el holdout» con lo que ahora sabes de la aceptación.
- «Versionado y linaje» arma el snapshot siguiente, del calendario o de una corrida adelantada, y el pipeline mensual lo entrena («El pipeline mensual como DAG»).
- Y el modelo nuevo vuelve a subir «Gate de evaluación y registry» y «Rollout seguro».

Para repasar las bases: «Probabilidad para sistemas que fallan» (el presupuesto de error), «Ruido, muestras y pruebas A/B» (el intervalo), «Comparar distribuciones: cómo se mide el drift» (el PSI y la trampa del n enorme), «Promedios, medianas y percentiles» (el p99) y «La request en vivo» (las métricas).

## Palabras que vas a oír {Words you will hear}

Los conceptos que presentó esta lección, cada uno con su tarjeta:

:::conceptos
falla-silenciosa capas-monitoreo senales-doradas proxy-calidad tasa-baja-confianza tasa-aceptacion referencia-drift alerta severidad-alerta alertmanager regla-grabacion burn-rate alerta-multiventana dashboard guardia runbook fatiga-alertas postmortem frescura-job disparador-reentrenamiento brecha-offline-online
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un modelo puede fallar sin que el dashboard del servicio lo note?
Porque sigue contestando 200 OK con la misma latencia y la misma confianza aparente. Cambió el mundo que lo alimenta, no el servicio.
? ¿Qué decide si una alerta es page, warning o ticket?
Si el usuario está afectado ahora y alguien puede arreglarlo ahora (page), si es una causa que anticipa un page (warning) o si es calidad del modelo y tendencias (ticket).
? ¿Qué es un burn rate de 14.4× y por qué Alba lo usa en vez de «más de 1 % de errores»?
Gastar el presupuesto 14.4 veces más rápido de lo que lo agota en 30 días: 2 % del mes en una hora. Mide el daño contra el presupuesto; un umbral fijo no sabe cuánto daño hace un error.
? ¿Para qué sirve la ventana corta de una alerta multiventana?
Para que la alerta se apague pronto cuando el incidente se arregla. La larga confirma que es real; la corta tiene poca memoria.
? ¿Por qué la aceptación no basta para medir la exactitud real?
Porque quien vende tiende a aceptar lo que le mostraron: está sesgada por el modelo. La medida limpia es el holdout, que no ve sugerencias.
? ¿Qué hace en Alba un disparador de reentrenamiento?
Abre un ticket. Después del diagnóstico, una persona decide si adelanta la corrida; el modelo nuevo sube igual el gate, el shadow y el canary.
:::
