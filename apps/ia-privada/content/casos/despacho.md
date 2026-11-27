---
titulo: Despacho de abogados
en: Sizing case: a law firm
subtitulo: Un despacho de 200 personas en la Ciudad de México, resuelto de punta a punta: de la llamada del socio a la compra de 2 RTX PRO 6000 Server Edition, el cuarto donde viven, la pregunta de prueba que mide el SLA cada minuto y lo que cuesta cada respuesta.
pregunta: «Somos 200, queremos preguntarle a nuestros expedientes y no puede salir ni un documento»: ¿qué servidor compramos, dónde lo ponemos, cómo sabemos que funciona y cuánto nos cuesta?
requisitos: recorrido, requisitos-hardware, concurrencia, comprar-hardware, el-cuarto, rag-privado, evals, pruebas-carga, observabilidad, seguridad, costo-total, cotizar
sensei: privacidad, percentiles, colas, redes-nube
---

:::idea
Las lecciones ya hicieron casi todas las cuentas del despacho, cada una por su lado. Este caso las junta en una historia y **decide** lo que quedó abierto: comprar **2 RTX PRO 6000 Blackwell Server Edition** (si el piloto confirma su prefill y la cotización llega a tiempo), dejar el servidor en **el cuarto propio** y no en colocation, y medir el SLA con una **pregunta de prueba cada minuto** que recorre el mismo camino que la pregunta de un abogado. Cada paso abre con un ejercicio: inténtalo antes de ver la solución.
:::

## El despacho y lo que pide {The firm and what it asks for}

### La llamada

Un martes llama el socio director de un despacho de abogados de la Ciudad de México: «Somos 200. Queremos preguntarle a nuestros expedientes y que nos conteste con la página. Y no puede salir ni un documento de aquí».

El despacho y sus números son ficticios, **supuestos del ejemplo** que comparten todas las lecciones y viven en una ficha. Lo del mundo real (precios, versiones, leyes, lugares) va con su fecha y su fuente.

| Dato | Valor |
|---|---|
| Personas | 200 abogados y asistentes |
| Expedientes | 30,000 (≈ 1.5 millones de páginas), en español y algunos contratos en inglés |
| Lo que piden | 1) preguntar con cita del documento y la página ([[rag\|RAG]]), 2) resumir un expediente, 3) encontrar cláusulas parecidas; la 1 primero |
| Uso | 15 preguntas por persona al día, de 9:00 a 19:00; la hora pico trae 2.5 veces el promedio |
| Cada pregunta | ≈ 6,000 tokens de entrada (instrucciones, pregunta y 5 fragmentos de ≈ 1,000) y ≈ 500 de salida |
| La promesa | primer token en ≤ 2 s en el p95 y ≥ 20 tokens por segundo por persona |
| TI | 2 personas: saben de redes y Windows, nunca han operado una GPU |
| Modelo | Qwen3 32B en INT4 de [[awq\|AWQ]] (Apache 2.0), con el razonamiento apagado |

### Por qué privado

Hoy algunos abogados pegan contratos en chatbots públicos: es el [[shadow-ai|uso a escondidas]] que dispara el proyecto. Una API de afuera sería más barata (la [[tco|TCO]] lo midió), pero el despacho tiene dos razones para no usarla. Una es la [ley de datos personales de 2025](https://sensei.trueml.app/privacidad/), que Sensei explica completa. La otra es propia de este cliente y pesa más: el [[secreto-profesional|secreto profesional]].

:::analogia El secreto profesional, como el de un médico
Un abogado sabe de su cliente lo que nadie más debe saber, como un médico. El Código Penal Federal castiga a quien, sin justa causa, con perjuicio de alguien y sin su consentimiento, revela un secreto que conoció por su empleo o cargo (art. 210), y sube la sanción a **1 a 5 años**, con multa y suspensión de la profesión, si lo revela quien presta servicios profesionales o técnicos (art. 211; texto vigente del Código, cuya última reforma es del 13 de noviembre de 2026, consultado el 2026-11-27). Eso alcanza al TI y al integrador. Y algunos clientes lo prohíben por contrato. Es orientación, no consejo legal: el alcance lo confirma el abogado del despacho.

Dónde se rompe: el secreto del médico se rompe hablando; el del despacho, sin que nadie hable, con un archivo que viaja solo a un servidor de otro. Por eso el requisito no es «que nadie lo cuente» sino **«que el servidor que lee los expedientes no tenga ruta a internet»**: una propiedad de la red, que se puede revisar.
:::

### Lo que este caso decide

Las lecciones dejaron tres preguntas abiertas para resolverlas aquí:

1. **¿3 L40S o RTX PRO 6000 Server Edition?** El [[sizing]] dio 3 L40S, pero su [[prefill]] solo ya pasa los 2 s. La alternativa se cotizó sin precio.
2. **¿El cuarto propio o [[colocation]]?** «El cuarto» dejó el plan de obras y, si el edificio no deja, la otra opción.
3. **¿Cómo se mide que el servicio «está arriba»?** El [[sla|SLA]] de «Cotizar» define «caído» con una pregunta de prueba cada minuto que nadie diseñó.

## Requisitos y perfil de carga {Requirements and load profile}

Los requisitos funcionales salen de la llamada: contestar **citando documento y página**, sin mostrarle a nadie lo que no le toca (la [[muralla-etica|muralla ética]] entre equipos del despacho) y decir «no está» cuando no está. Los [[requisito-no-funcional|no funcionales]] deciden el hardware: TTFT ≤ 2 s en el p95 de la hora pico, ≥ 20 tokens por segundo, días hábiles de 9:00 a 19:00 (de noche se puede apagar y parchar), el servidor sin ruta a internet y 99 % de disponibilidad en horario.

El [[perfil-de-carga|perfil de carga]] traduce «200 personas» a lo que llega al servidor por segundo, con la [[ley-de-little|ley de Little]] de «De requisitos a hardware».

:::formula Llegadas en la hora pico y conversaciones a la vez
λ = frac{U × r}{H × 3,600} × k_{pico}
c = λ × (t_{pre} + frac{N_o}{v})
- λ: preguntas por segundo en la hora pico
- U: personas; r: preguntas por persona al día; H: horas del día con tráfico
- k_{pico}: la hora más cargada ÷ el promedio
- c: conversaciones abiertas a la vez, en promedio, en la hora pico
- t_{pre}: el TTFT sin fila (el prefill), en s; N_o: tokens de la respuesta; v: tokens por segundo de cada conversación
:::

:::intenta ¿Cuántas conversaciones hay a la vez en la hora pico?
Con la ficha (200 personas, 15 preguntas al día de 9:00 a 19:00, pico de 2.5, respuestas de 500 tokens a 20 tokens por segundo) y un prefill de 2.38 s en la L40S, calcula \(λ\) y \(c\). ¿Por qué la ficha diseña la memoria para **8** conversaciones y no para el promedio?
???
1. 200 × 15 = 3,000 preguntas al día; ÷ 10 h = 300 por hora; × 2.5 = **750** en la hora pico, ≈ **0.208 por segundo**.
2. Cada respuesta dura 2.38 + 500 ÷ 20 = 27.4 s. Little: 0.208 × 27.4 ≈ **5.70 conversaciones**.
3. Es un promedio: las preguntas llegan al azar y a ratos hay 8 o más. Con 8, la memoria cubre ≈ 88 % del tiempo de la hora pico (la cuenta de [Concurrencia](/concurrencia/)); las demás esperan. Compruébalo en la [herramienta de sizing con el despacho](/herramientas/sizing/?p1=l40s&U=200&r=15&Np=6000&No=500&h=10&pk=2.5&v=20) (salidas 1 y 2).
:::

\(c\) depende del hardware: en la RTX PRO 6000 Server Edition, con un prefill de 1.72 s, la herramienta da 5.57. La diferencia es chica porque los 25 s de escritura pesan más que el prefill.

:::cuenta El perfil de carga del despacho
Preguntas al día // \(U × r\), la ficha | 200 × 15 | 3,000
Hora pico // ÷ \(H\) = 10 h, × \(k_{pico}\) = 2.5 | 3,000 ÷ 10 × 2.5 | 750 por hora
Llegadas, \(λ\) | 750 ÷ 3,600 | ≈ 0.208 por segundo
Duración de una respuesta // \(t_{pre}\) = 2.38 s (L40S) + \(N_o ÷ v\) | 2.38 + 500 ÷ 20 | ≈ 27.4 s
Conversaciones a la vez, \(c\) | 0.208 × 27.4 | ≈ 5.70
Tokens de entrada por segundo // \(λ × N_p\) | 0.208 × 6,000 | ≈ 1,250
= En la hora pico llegan ≈ 0.21 preguntas por segundo con ≈ 5.7 conversaciones abiertas. Es poco en preguntas y **mucho en prefill**: ≈ 1,250 tokens por leer cada segundo. Ese dato decide el hardware.
:::

### Lo que falta preguntar

La hoja de [[descubrimiento]] necesita cinco respuestas que el socio no dio:

- **¿El pico es de 2.5 o más?** Un día de cierre puede traer 3.5 (lo ves en «Qué cambiaría si…»).
- **¿Cuántos fragmentos necesita una buena respuesta?** Con 3 en vez de 5, el prompt baja a ≈ 3,500 tokens. Lo decide el examen.
- **¿Cuántas páginas son escaneos?** Decide las noches de ingesta.
- **¿Qué dicen los contratos con los clientes?** Si alguno exige que sus documentos no salgan de la oficina física, colocation queda fuera.
- **¿El edificio deja hacer obras en el cuarto?** Sin permiso, no hay cuarto propio.

## Memoria, velocidad y la fila de la hora pico {Memory, speed and the peak-hour queue}

### ¿Cabe y qué tan rápido?

La [herramienta de VRAM](/herramientas/vram/?p0=4&bits=4.15625&N=8192&u=8&V=l40s) da en la L40S: pesos ≈ **19.32 GB**, [[kv-cache|KV cache]] de 8 conversaciones de 8,192 tokens ≈ **17.18 GB** y 2 GB de programa: **38.50 de 43.2 GB útiles**, caben 10. En la [Server Edition](/herramientas/vram/?p0=4&bits=4.15625&N=8192&u=8&V=rtx-pro-6000-blackwell-server), con 96 GB, caben **30**. La memoria no es el problema en ninguna.

La [herramienta de velocidad](/herramientas/velocidad/?p0=3&p1=l40s&bits=4.15625&Np=6000&No=500&b=8) da en la L40S ≈ **18.6 tokens por segundo** a cada una de 8 conversaciones en [[decode]], y **2.38 s** para leer el prompt con la GPU libre. Pero en la hora pico cada pregunta nueva **interrumpe** a las que escriben.

:::intenta ¿Cuántas L40S hacen falta, y cuántas Server Edition?
La herramienta de sizing cuenta lo que aguanta **una** GPU a ≥ 20 tokens por segundo con el tiempo de los prefills: **2** conversaciones por L40S y **6** por Server Edition (1,597 GB/s, ≈ 500 TFLOPS densos en FP16, derivados). Con ≈ 5.7 conversaciones en el pico, ¿cuántas tarjetas pide el promedio? ¿Y si una puede fallar?
???
1. L40S: ⌈5.70 ÷ 2⌉ = **3** ([sizing con la L40S](/herramientas/sizing/?p1=l40s)): 6 lugares para 5.7, [[holgura]] de 1.05×. Si una falla quedan 4: para el [[n-mas-1|N+1]], **4 L40S**.
2. Server Edition: ⌈5.57 ÷ 6⌉ = **1** ([sizing con la Server Edition](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server)): 1.08×. Si falla no queda nada; con **2**, una sola sostiene el promedio, en el filo.
:::

**La memoria dice cuántas caben (10 o 30); el cómputo y el [[ancho-de-banda|ancho de banda]], cuántas se atienden bien (2 o 6).**

:::figura caso-despacho-lugares
Lugares a ≥ 20 tokens por segundo en cada opción, contra las ≈ 5.7 conversaciones de la hora pico, y lo que queda si falla una tarjeta. Solo B y D siguen arriba de la línea con una tarjeta menos; C se queda en cero.
:::

### La fila de la hora pico

Los lugares cuentan la escritura. El TTFT es otra cosa: quien llega mientras otro prompt se está leyendo **espera**. Ese [[ttft-con-cola|TTFT con fila]] es el que siente el abogado número 95 de cada 100, y es el que se prometió. «De requisitos a hardware» lo simuló para 3 L40S y 2 Server Edition; aquí se agregan 4 L40S y **una** Server Edition, repartiendo al azar o por turno (una pregunta a cada GPU, en orden).

| Opción | TTFT sin fila | p95 al azar | p95 por turno |
|---|---|---|---|
| A · 3 L40S | 2.38 s | 4.24 s | 2.38 s |
| B · 4 L40S | 2.38 s | 3.94 s | 2.38 s |
| C · 1 Server Edition | 1.72 s | 4.07 s | 4.06 s |
| D · 2 Server Edition | 1.72 s | 3.13 s | **1.77 s** |

:::profundo La simulación, en Python
Llegadas al azar a 0.208 por segundo, una fila de prefill por GPU, el prefill de la herramienta de sizing como tiempo fijo, sin red ni búsqueda: el modelo de «De requisitos a hardware», que reproduce sus cifras de 3 L40S y 2 Server Edition.

```python
import random

def p95_ttft(gpus, prefill, reparto, n=200_000, seed=7):
    lam = 200 * 15 / (10 * 3600) * 2.5           # preguntas por segundo en la hora pico
    rnd = random.Random(seed)
    libre = [0.0] * gpus                         # cuándo termina cada GPU su último prefill
    reloj, turno, ttft = 0.0, 0, []
    for _ in range(n):
        reloj += rnd.expovariate(lam)            # llegadas al azar (Poisson)
        if reparto == "azar":
            g = rnd.randrange(gpus)
        else:                                    # por turno
            g, turno = turno % gpus, turno + 1
        inicio = max(libre[g], reloj)
        libre[g] = inicio + prefill
        ttft.append(libre[g] - reloj)            # espera + prefill
    return sorted(ttft)[int(0.95 * n)]

for nombre, gpus, prefill in [("A · 3 L40S", 3, 2.38), ("B · 4 L40S", 4, 2.38),
                              ("C · 1 Server Edition", 1, 1.724), ("D · 2 Server Edition", 2, 1.724)]:
    print(f"{nombre:22} azar {p95_ttft(gpus, prefill, 'azar'):.2f} s · por turno {p95_ttft(gpus, prefill, 'turno'):.2f} s")
```

```salida
A · 3 L40S             azar 4.24 s · por turno 2.38 s
B · 4 L40S             azar 3.94 s · por turno 2.38 s
C · 1 Server Edition   azar 4.07 s · por turno 4.06 s
D · 2 Server Edition   azar 3.13 s · por turno 1.77 s
```
:::

La sorpresa es **C**: lee un prompt en 1.72 s y su p95 es ≈ 4.1 s con cualquier reparto. Está leyendo prompts \(ρ = λ × t_{pre}\) = 0.208 × 1.724 ≈ **36 %** del tiempo, y con una sola GPU hay una sola fila: si dos preguntas llegan con menos de 1.72 s de diferencia, la segunda espera completa a la primera. Con 2 tarjetas, cada una lee ≈ 18 % del tiempo y dos preguntas casi juntas caen en GPUs distintas. **El prefill sin fila no es el p95.**

- **Ninguna cumple al azar**, que es lo que hace LiteLLM por omisión (`simple-shuffle`); su `least-busy` da ≈ 3.3 s con 3 L40S y ≈ 2.7 s con 2 Server Edition (la ficha). La palanca más barata es el **reparto**.
- **La L40S tiene un piso de 2.38 s**: con 5 fragmentos, ninguna cantidad de L40S cumple.
- **D es la única que cumple**: 1.77 s por turno o [[menos-pendientes|viendo la fila]], ≈ 1.94 s con los ≈ 170 ms de red y búsqueda del [[presupuesto-de-latencia|presupuesto]]. En el filo, y con un prefill que es una cuenta.

:::figura caso-despacho-p95
El TTFT p95 simulado de cada opción en la hora pico, al azar y por turno, contra la promesa de 2 s. Solo D por turno queda abajo; la L40S no baja de su prefill de 2.38 s.
:::

:::profundo Lo que publican de la Server Edition no mide esto
**[[mlperf|MLPerf]] Inference v6.0**, la prueba de rendimiento estándar de la industria (HPE ProLiant DL385 Gen11 con 2 Server Edition de 600 W, TensorRT y pesos FP4; resultado válido, consultado el 2026-11-26) da con **Llama 2 70B** un TTFT p95 de **0.852 s** y ≈ 3,477 tokens por segundo por tarjeta. Pero sus entradas son de **1,024 tokens o menos**, con otro modelo, otro formato y otro motor. Un blog de un proveedor de nube (2026-10-05) mide **Qwen3-32B** en la tarjeta con vLLM 0.24.0, con conversaciones cortas (el conjunto ShareGPT). Ninguno lee un prompt de 6,000 tokens, que es lo que decide el TTFT del despacho: son [[condiciones-del-benchmark|otras condiciones]]. Sirven de contexto, no de prueba.
:::

## Las cuatro opciones y la decisión {The four options and the decision}

:::nota Las letras de este caso
A 3 L40S · B 4 L40S · C 1 Server Edition · D 2 Server Edition. La propuesta de «Cotizar» llamaba «C» a las 2 Server Edition: aquí es la **D**, porque se agrega la de una tarjeta.
:::

La compra sale del configurador de Exxact (TensorEX 4U con 2 EPYC 9124: US$40,461.30 la base y US$8,910 por L40S, 2026-11-25). La Server Edition **no tiene precio de lista**: CDW (EE. UU.) la tenía el 2026-11-26 en **US$17,158.99 y sin existencias** («Item Backordered»). Se usa ese precio, el más alto visto; según la prensa, NVIDIA subió la Workstation, su hermana con ventilador, a US$16,000 en agosto de 2026 por la escasez de memoria. El costo al mes es el de la [herramienta de TCO](/herramientas/tco/) con lo que la ficha supone para todas: 36 meses, 20 % de reventa, PUE 2.0, UPS y obra repartidos (US$433 al mes) y 52 h de TI (US$575).

| | A · 3 L40S | B · 4 L40S | C · 1 Server Edition | D · 2 Server Edition |
|---|---|---|---|---|
| Lugares a ≥ 20 tokens/s | 6 (1.05×) | 8 (1.40×) | 6 (1.08×) | 12 (2.15×) |
| p95 al azar · por turno | 4.24 · 2.38 s | 3.94 · 2.38 s | 4.07 · 4.06 s | 3.13 · 1.77 s |
| ¿Cumple ≤ 2 s? | No | No | No | Sí, en el filo |
| Si falla una tarjeta | 4 lugares: degradado | 6: igual | 0: sin servicio | 6, p95 ≈ 4.1 s |
| Compra | US$67,191 | US$76,101 | ≈ US$57,620 | ≈ US$74,779 |
| Al mes | [US$2,753](/herramientas/tco/?p1=l40s&G=3&K=8910&Wg=350&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203) | [US$3,000](/herramientas/tco/?p1=l40s&G=4&K=8910&Wg=350&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203) | [US$2,478](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&G=1&K=17159&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203) | [US$2,943](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&G=2&K=17159&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203) |
| Por pregunta | MXN 0.82 | MXN 0.90 | MXN 0.74 | MXN 0.88 |

La herramienta da US$2,753 para A y US$3,000 para B; la ficha, ≈ 2,746 y ≈ 2,944. La diferencia es la luz: la herramienta la sube con cada tarjeta y la ficha usó la misma para A y B. C y D suponen el mismo chasis con tarjetas PCIe Gen5, **sin verificar**: lo confirma el integrador.

:::intenta ¿Cuál compras?
Con la tabla: la promesa firmada es TTFT ≤ 2 s en el p95 y 20 tokens por segundo, y el TI son 2 personas sin guardia de noche. Elige una opción y defiéndela en tres frases: qué gana, qué arriesga y qué la haría cambiar.
???
1. **A y C se descartan.** A no cumple con ningún reparto y una falla la deja en 4 lugares. C es la más barata, pero su p95 es ≈ 4.1 s y si su tarjeta falla no hay servicio.
2. **B y D cuestan casi lo mismo**: US$76,101 contra ≈ 74,779 de compra, US$3,000 contra 2,943 al mes. B tiene N+1 de verdad, pero su piso es 2.38 s.
3. **D cumple con 5 fragmentos**, tiene el doble de lugares que el pico y es N+1 del promedio. Arriesga un prefill que nadie ha medido, una tarjeta sin existencias y quedarse con una sola si falla una.
4. **La cambiaría** un prefill medido más lento, una cotización tardía o más cara que B, o un examen que acepte 3 fragmentos.
:::

### La decisión: D, 2 RTX PRO 6000 Blackwell Server Edition

Se recomienda **D**, por cuatro razones:

1. **Es la única que cumple lo que el despacho pidió** sin cambiar la pregunta: ≈ 1.77 s por turno, ≈ 1.94 s con red y búsqueda.
2. **Cuesta lo mismo que la alternativa con repuesto**: contra B, ≈ US$1,300 menos de compra y ≈ US$57 menos al mes. Contra A, ≈ US$7,600 más de compra y ≈ US$190 más al mes, ≈ MXN 0.06 por pregunta.
3. **Crece sin comprar**: 2.15× de holgura contra 1.40× de B.
4. **Le sobra memoria**: 30 conversaciones por tarjeta; el [[reranker]] y los embeddings caben sin tocar el KV cache del chat.

No es una compra a ciegas: entra con tres condiciones, y si una falla, cambia la opción.

| Condición | Cómo se mide | Si no se cumple |
|---|---|---|
| Prefill de 6,000 tokens ≤ ≈ 1.75 s | Rentar la misma tarjeta con los flags de producción: Google Cloud renta la Server Edition (máquina g4-standard-48, ≈ US$4.50 por hora en us-central1: ≈ US$216 por 48 h); la Workstation en RunPod sale en ≈ US$129 por 48 h | B con reparto por turno y un TTFT firmado más alto, o 3 fragmentos |
| Cotización de D ≤ B (US$76,101), con entrega en ≈ 3 meses | Dos integradores, con número de parte y fecha | B, que se entrega hoy |
| El examen pasa con 5 fragmentos | ≥ 170 de 200 con cita, ≤ 4 inventadas, 0 fugas | Ninguna GPU lo arregla: se revisa el RAG |

:::profundo Por qué 1.75 s, y en qué tarjeta se mide
El 1.75 s es el **límite**, no una meta: es el prefill más lento con el que D todavía llega a la promesa. Con 1.72 s (la herramienta), la simulación da un p95 por turno de 1.77 s; con 1.75 s, de ≈ 1.83 s, porque la fila crece más rápido que el prefill. Con los ≈ 0.17 s de red y búsqueda: ≈ 1.94 s y ≈ 2.00 s. Arriba de 1.75 s, D ya no cumple. Y lo que se firma no es esta cuenta: es el p95 medido en la prueba de carga.

Lo mejor es medir en la Server Edition misma: Google Cloud la renta desde octubre de 2025 (sus máquinas G4; g4-standard-48 trae una, ≈ US$4.50 por hora en us-central1, consultado el 2026-11-27; `gpus.json` aún no la tiene). La Workstation en RunPod es más barata y sirve de aproximación: misma memoria y ≈ el mismo cómputo, con más ancho de banda (1,792 contra 1,597 GB/s), que en el prefill importa poco.
:::

**Si el examen acepta 3 fragmentos, la cuenta da la vuelta.** Con ≈ 3,500 tokens, la L40S lee en **1.34 s** y atiende 4 conversaciones ([sizing con 3,500 tokens](/herramientas/sizing/?p1=l40s&Np=3500)). Con **3 L40S** hay 12 lugares, N+1, y ≈ 1.74 s con el reranker de 232 ms, la red y la búsqueda: la más barata que cumple, se entrega hoy y no depende de una tarjeta escasa. Un matiz: los 6,000 tokens son 5,500 redondeados hacia arriba; con el mismo redondeo, 3 fragmentos son ≈ 4,000 tokens, la L40S lee en [≈ 1.54 s](/herramientas/sizing/?p1=l40s&Np=4000) y el total queda en ≈ 1.94 s: también en el filo. El piloto mide el prompt real. Por eso la [[prueba-pareada|prueba pareada]] de 3 contra 5 fragmentos corre primero.

La regla, para la ficha: **D si el examen necesita 5 fragmentos y el piloto confirma su prefill; A con 3 fragmentos si el examen los acepta; B si la Server Edition no llega o sale más cara que B.**

:::diagrama caso-despacho-decision
La decisión de hardware como un árbol: qué mide el piloto y qué opción sale de cada resultado. Toca cada caja para ver su regla, o usa «Recorrer» para seguir el camino que lleva a D y los dos que se apartan de ella.
:::

## Dónde vive el servidor: cuarto propio o colocation {Where the server lives: own room or colocation}

[[colocation|Colocation]] es rentar espacio, luz, enfriamiento y conexión en un centro de datos para **tu propio** hardware. El otro lado es el plan de la ficha para el cuarto de 9 m²: 2 [[circuito-dedicado|circuitos dedicados]] de 20 A a 220 V, un [[ups|UPS]] de 5–6 kVA de doble conversión, 2 minisplits de 2 toneladas (N+1), 10 GbE y el [[bmc|BMC]] en una VLAN de gestión. D no cambia el plan: su pico es ≈ **2,300 W** (2 × 600 W de tarjetas + 400 W de CPUs + 700 W del resto, la cuenta que dio 2,500 W con 4 L40S), ≈ 13.8 A con el 125 % de la norma en un circuito de 20 A a 220 V.

### Lo que hay, y lo que cuesta

**Ningún operador de la Ciudad de México publica precio**: KIO, Triara, Scala, ATC, MTP y Servnet piden cotización. Y no todo lo que dice «Mexico City» está aquí.

:::profundo Los sitios, con su dirección (PeeringDB, 2026-11-26)
PeeringDB es un registro que llenan los operadores: dice **dónde** está cada sitio, no si le renta a una empresa de 2.5 kW.

- **Dentro de la CDMX:** KIO MEX1 y MEX2 (Prolongación Paseo de la Reforma, Cuajimalpa), KIO MEX3 (Santa Fe), Triara (Azcapotzalco), MTP Santa Fe y los sitios «edge» de ATC.
- **Zona metropolitana:** KIO MEX4 (Interlomas) y MEX5 (Tultitlán), Scala (Tepotzotlán).
- **Querétaro:** Equinix MX1 y MX2 están en **El Marqués, Querétaro**, a ≈ 200 km, aunque Equinix los agrupa como «Mexico City».

Un listado secundario describe KIO MEX2 como diseño Tier IV (la clase de redundancia más alta que certifica el Uptime Institute); no se confirmó. El Tier se revisa en el directorio de Uptime antes de firmar.
:::

El único dato con fuente primaria es **mayorista y de Querétaro**: CBRE reporta **US$250–270 por kW al mes** en bloques de 250 a 500 kW (1T 2026). Es una cota baja: un cliente de 2.5 kW paga más por kW. El único precio público de rack en México es de Guadalajara (HostDime: 4U en US$300 al mes, con 1 A a 208 V, que no alcanza para este servidor).

Con el servidor fuera, cada pregunta viaja de la oficina al sitio. Hay dos caminos:

- Un [[enlace-dedicado|enlace dedicado]], un circuito privado de un operador con SLA. Telmex publica el suyo (simétrico, 99.5 %, **36 meses mínimo**) **sin precio**; un solo blog de un proveedor (2026-10-05) da de $5,900 a $30,000 al mes por 100–200 Mb/s, más $5,000–20,000 de instalación: rango, no precio.
- Una [[vpn-sitio-a-sitio|VPN de sitio a sitio]]: un túnel cifrado entre dos firewalls sobre el internet de negocio de la oficina (100–150 Mb/s en $399–449 al mes con IVA, fuente secundaria).

El tráfico es ≈ **0.05 Mb/s** en la hora pico: se paga el SLA y la ruta, no el ancho de banda. La latencia no pesa: del orden de 1–5 ms dentro de la zona metropolitana (estimación, no medida) contra 1,700 ms de prefill.

:::formula Lo que cada opción le suma al mes
C_{cuarto} = L + frac{O + U × t}{V}
C_{colo} = k × p_{kW} × t + E + C_{enl} + frac{I}{V} + n_v × h_v × c_h
- C_{cuarto}: lo que el cuarto le agrega al mes, en pesos (el servidor es el mismo en los dos lados y no entra)
- L: la luz del servidor en el cuarto, al mes; O: la obra y el aire, en pesos; U: el UPS, en dólares
- t: el tipo de cambio; V: los meses en que se reparte lo que se paga una vez
- C_{colo}: el colocation al mes, en pesos; k: los kW contratados; p_{kW}: el precio por kW al mes, en dólares
- E: la energía, si va aparte (0 si va incluida); C_{enl}: el enlace al mes; I: su instalación
- n_v: visitas al mes; h_v: horas de TI por visita; c_h: costo de una hora de TI
:::

:::intenta ¿Cuánto cuesta cada lado al mes?
Cuarto: luz $4,825 al mes, obra y aire $130,000, UPS US$9,000, a 36 meses y 19.7203 pesos por dólar. Colocation: 2.5 kW a la cota baja de US$250 con la energía incluida, enlace dedicado de $15,000 al mes con $10,000 de instalación, y una visita al mes de 3 h de TI a $218.1. ¿Cuál sale más barato? ¿Y con una VPN de $450?
???
1. Cuarto: (130,000 + 9,000 × 19.7203) ÷ 36 = $8,541; + luz = **$13,366 al mes**.
2. Colocation: 2.5 × 250 × 19.7203 = $12,325 de renta; + 15,000 + 278 + 654 = **$28,257 al mes**. El enlace solo cuesta más que todo el cuarto.
3. Con VPN: 12,325 + 450 + 654 = **$13,429**: casi un empate, a la tarifa mayorista. La cuenta completa, abajo.
:::

:::profundo La cuenta completa, cuarto propio contra colocation

:::cuenta Cuarto propio contra colocation, al mes
Cuarto: obra y UPS repartidos // (\(O\) + \(U × t\)) ÷ \(V\) | (130,000 + 9,000 × 19.7203) ÷ 36 | $8,541
Cuarto al mes, \(C_{cuarto}\) // + la luz \(L\) | 4,825 + 8,541 | **$13,366** (≈ US$678)
Colocation: renta // \(k × p_{kW} × t\) | 2.5 × 250 × 19.7203 | $12,325
Colocation: enlace, instalación y visita // \(C_{enl}\) + \(I ÷ V\) + \(n_v × h_v × c_h\) | 15,000 + 10,000 ÷ 36 + 3 × 218.1 | $15,932
Colocation al mes, \(C_{colo}\) | 12,325 + 15,932 | **$28,257** (≈ US$1,433)
Con VPN en vez de enlace // \(C_{enl}\) = 450, sin instalación | 12,325 + 450 + 654 | $13,429
= El cuarto sale ≈ $14,891 más barato que colocation con enlace dedicado. Con VPN casi empatan, y eso a la tarifa mayorista, que el despacho no va a conseguir.
:::
:::

:::calculadora caso-despacho-colocation
Arranca con la cota baja y un enlace dedicado de $15,000. Baja el enlace a 450 para ver la VPN; sube el precio por kW a 400 para ver un minorista plausible. El precio en que empatan dice qué cotización le ganaría al cuarto.
:::

:::figura caso-despacho-mes
Lo que cada lado le suma al mes, en pesos: el cuarto propio contra colocation a tarifa mayorista con enlace dedicado y con VPN. Solo con VPN y a precio mayorista empatan.
:::

### ¿Sigue siendo «su red»?

La regla es «ningún documento sale de su red». Con el servidor en Santa Fe, ¿se rompe? Ninguna fuente lo decide: es un criterio y hay que escribirlo. El que propone este caso tiene cuatro partes que se pueden revisar:

1. **El hardware es del despacho** y los discos van cifrados, y su llave solo se reconstruye al arrancar hablando con Tang (el servidor chico de [Seguridad](/seguridad/) que ayuda a abrir el disco sin guardar la llave), que se queda **en la oficina**.
2. **El servidor no tiene ruta a internet**, igual que en el cuarto.
3. **El único camino** a la oficina es un enlace que el despacho controla en los dos extremos.
4. **Quién toca el rack queda registrado**: las [[manos-remotas|manos remotas]] del sitio entran con ticket.

Con enlace dedicado se cumplen las cuatro: el circuito es de un operador, pero no es internet. Con VPN, la tercera a medias: el túnel va cifrado, pero **viaja por internet**. Y hay algo que ningún criterio arregla: los expedientes salen **físicamente** de la oficina. Si un contrato dice «en las instalaciones del despacho», colocation no se puede.

### La decisión: el cuarto propio

**El servidor va al cuarto**, con el plan de obras de la ficha: ≈ $13,366 al mes contra ≈ $19,000–43,000 de colocation con enlace dedicado (según el enlace, a tarifa mayorista), sin sacar los expedientes de la oficina ni agregar un enlace que se puede caer.

Colocation queda como plan B si el edificio no deja, con tres reglas: **en la Ciudad de México** (KIO, Triara o MTP, a cotizar), no en Querétaro; **con enlace dedicado**, no VPN, y redundante si el SLA lo pide (si cae, Tang no le da la llave a un servidor que reinicia); y **el SLA dice de quién es el enlace**, que ya no es «la red del edificio».

:::profundo Lo que se le pregunta al operador
kW garantizados con dos alimentaciones (A y B); si la energía va incluida o aparte y con qué [[pue|PUE]]; el mínimo de contrato; si aguanta un 4U de ≈ 80 cm de fondo; si el cliente puede entrar 24 × 7 o solo con ticket, y cómo se registra quién entra; el cross-connect (el cable del rack al operador del enlace) y su costo; las manos remotas por hora; y qué operadores de telecomunicaciones están en el sitio.
:::

## El stack y la pregunta de prueba del SLA {The stack and the SLA synthetic check}

### Lo que cambia con D

El stack es el de las lecciones (vLLM 0.34.0, LiteLLM 1.111.0, Open WebUI 0.13.5, Qdrant 1.20.2, en las zonas de «Seguridad»). Con D cambian cuatro cosas:

:::profundo Las cuatro cosas que cambian con D

- **El motor:** 2 copias de [[vllm|vLLM]], una por tarjeta, con `--max-num-seqs 8`.
- **El reparto:** **por turno o viendo la fila**, nunca al azar: decide si D cumple. LiteLLM no trae uno por turno: su documentación (consultada el 2026-11-27) da `simple-shuffle` (al azar, con pesos; la de omisión), `least-busy` (menos llamadas abiertas: ≈ 2.7 s con D), por latencia, por uso y por costo, y deja escribir una propia. Para D: una estrategia propia por turno, o un balanceador por turno entre el gateway y las 2 copias (se pierde la afinidad por conversación: se mide en el piloto).
- **El formato:** se queda AWQ. Los tensores de [[fp4|FP4]] de Blackwell podrían bajar el prefill, pero cambian la calidad: pasarían por el [[gate-de-calidad|gate]].
- **El mantenimiento:** con una tarjeta fuera, la otra queda sola (p95 ≈ 4.1 s): se parcha de noche, y la alerta 4 pasa a `sum(up{job="vllm-chat"}) < 2`.
:::

### El hueco: «caído» sin medidor

El SLA promete **99 % en horario hábil**: 22 días de 9:00 a 19:00 son 13,200 minutos y el 1 % son **132 minutos de caída al mes**. «Caído» es un minuto del horario en que la pregunta de prueba no recibe respuesta. Ni el [[tablero]] ni las [[alerta|alertas]] de «Observabilidad» la traen.

Una [[sonda-sintetica|pregunta de prueba]] (*synthetic check*) se hace pasar por un usuario: cada minuto manda la misma pregunta por el mismo camino y anota si llegó bien. Ve **lo que vería el abogado**, no lo que dice el motor.

:::analogia El cliente fantasma
Una cadena de restaurantes manda «clientes fantasma» que piden un platillo y anotan si llegó bien y a tiempo. No miran la cocina: miran el plato.

Dónde se rompe: el cliente fantasma pide un platillo real; la sonda no puede preguntar por un expediente real, porque su respuesta quedaría en registros que no son de nadie. Pregunta por un **documento falso** puesto a propósito en el índice.
:::

### El diseño

- **Qué pregunta.** En el índice vive un documento sintético, `PRUEBA-0001`, con la frase «El código de verificación de la sonda es GIRASOL-7» y una ACL propia, `sonda`: la cuenta de la sonda solo ve ese documento. Pregunta por el código; si la respuesta trae `GIRASOL-7` **y** `PRUEBA-0001`, funcionaron la búsqueda con su filtro de permisos, el gateway, el motor y la cita.
- **Con qué.** [[blackbox-exporter|blackbox_exporter]] (v0.29.1, 2026-10-21, Apache 2.0), el [[exporter]] de Prometheus para sondear desde afuera: hace un POST, revisa el código HTTP y la respuesta con expresiones regulares y expone `probe_success` (1 o 0). Con `stream: false`, hasta 32 tokens y un plazo de 10 s.
- **Desde dónde.** En la zona de gestión, junto a Prometheus, contra el mismo servicio que arma las preguntas de los abogados; nunca dentro del servidor de modelos, que no vería el gateway ni la búsqueda. No cruza la red de la oficina, igual que el SLA, que la excluye. Open WebUI lleva un sondeo aparte de su página de entrada, solo para el tablero.
- **Cuánto pesa.** Supuesto: ≈ 1,500 tokens por sonda, ≈ 0.97 s la respuesta en la Server Edition ([herramienta de velocidad](/herramientas/velocidad/?p0=3&p1=rtx-pro-6000-blackwell-server&bits=4.15625&Np=1500&No=32&b=1)) y ≈ 2 % de los tokens de entrada de la hora pico (60 × 1,500 contra 750 × 6,000). Con su propia [[clave-de-api|clave]] se filtra del registro (si no, ≈ 130 mil filas más en 90 días) y de los conteos de calidad.

:::profundo El módulo y el scrape, escritos (no ejecutados: se prueban en el piloto)
Sintaxis de la documentación de blackbox_exporter v0.29.1 (`CONFIGURATION.md`, `example.yml`). La dirección del servicio que arma las preguntas depende de cómo se monte el RAG: aquí es un ejemplo.

```yaml
# blackbox.yml
modules:
  pregunta_despacho:
    prober: http
    timeout: 10s
    http:
      method: POST
      preferred_ip_protocol: ip4          # por omisión intenta IPv6
      headers:
        Content-Type: application/json
      authorization:
        type: Bearer
        credentials_file: /etc/blackbox/llave-sonda
      body: '{"model":"chat-grande","stream":false,"max_tokens":32,"temperature":0,"messages":[{"role":"user","content":"¿Cuál es el código de verificación de la sonda? Responde solo con el código y la cita."}]}'
      valid_status_codes: [200]
      fail_if_body_not_matches_regexp:
        - 'GIRASOL-7'
        - 'PRUEBA-0001'
```

```yaml
# prometheus.yml (la parte de la sonda)
scrape_configs:
  - job_name: sonda-despacho
    metrics_path: /probe
    scrape_interval: 60s
    scrape_timeout: 15s
    params: { module: [pregunta_despacho] }
    static_configs:
      - targets: ['https://busqueda.despacho.interno/v1/chat/completions']
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115       # blackbox_exporter, en la misma máquina
```

El plazo de cada sondeo es el menor entre el `scrape_timeout` de Prometheus (un poco recortado) y el `timeout` del módulo: aquí, 10 s. Prometheus no deja que el `scrape_timeout` pase del intervalo: 15 s contra 60 s.

**Por qué no un script con Pushgateway.** El Pushgateway (v1.11.4) guarda el último valor hasta que alguien lo borra: si el script muere, `probe_success` se queda en 1 y el tablero dice «arriba» con la sonda muerta. Su documentación lo reserva para trabajos por lotes que terminan, y una sonda cada minuto no lo es. Y Grafana Cloud Synthetic Monitoring queda fuera sin hacer cuentas: sus sondas públicas corren en los sitios de Grafana (el gateway tendría que verse desde internet), y las privadas, aunque corren en la red del despacho, escriben sus resultados en la nube de Grafana: una tercera salida a internet.
:::

`probe_success` dice **caído o no**. **No mide el TTFT**: el tiempo al primer byte que reporta blackbox, con `stream: false`, llega con la respuesta completa. El TTFT de la promesa sigue saliendo del [[histograma]] de vLLM (panel 2) y la alerta de «degradado» sigue siendo la 1.

### Contar los minutos y avisar

Dos reglas marcan qué minutos son hábiles y cuáles fallaron. La Ciudad de México está en **UTC−6 todo el año** (Ley de los Husos Horarios de 2022) y Prometheus cuenta las horas en UTC: basta con restar 6 horas. Los festivos se descuentan a mano.

:::profundo Las reglas, escritas (Prometheus 3.16.0; no ejecutadas: correr promtool check rules)
```yaml
groups:
  - name: sonda-despacho
    interval: 1m
    rules:
      # 1 dentro del horario hábil (lunes a viernes, 9:00–19:00 en la CDMX); sin serie fuera
      - record: despacho:horario_habil
        expr: >
          vector(1) and on()
          ( (hour(vector(time() - 21600)) >= 9 < 19)
            and (day_of_week(vector(time() - 21600)) >= 1 <= 5) )

      # 1 por cada minuto hábil en que la pregunta de prueba falló (0 si pasó)
      - record: despacho:minuto_caido
        expr: (1 - probe_success{job="sonda-despacho"}) and on() despacho:horario_habil

      # Alerta 7: la pregunta de prueba falla (dos o más fallas en 5 minutos)
      - alert: SondaPreguntaCaida
        expr: >
          avg_over_time(probe_success{job="sonda-despacho"}[5m]) < 0.8
          and on() despacho:horario_habil
        for: 1m
        labels: { nivel: ahora }
        annotations:
          resumen: "La pregunta de prueba falla: el servicio está «caído» según el SLA"
          runbook: "1) panel 9 y panel 8 (réplicas vivas) 2) ¿responde el gateway? ¿la búsqueda? 3) abre el incidente de severidad 1"

      # Alerta 8: la sonda dejó de medir (una sonda muerta parece un servicio sano)
      - alert: SondaSinDatos
        expr: absent_over_time(probe_success{job="sonda-despacho"}[3m])
        labels: { nivel: ahora }
```

En Grafana, un panel de estadística con el rango «este mes»: `sum_over_time(despacho:minuto_caido[$__range])` da los minutos caídos, y `1 - sum_over_time(despacho:minuto_caido[$__range]) / sum_over_time(despacho:horario_habil[$__range])`, la disponibilidad.
:::

:::intenta ¿Cuándo suena la alerta?
La alerta 7 promedia las últimas 5 sondas, se prende si el promedio baja de 0.8 y espera 1 minuto más (`for: 1m`). Si el gateway se cae justo después de la sonda de las 11:00, ¿a qué minuto llega el aviso? ¿Y si solo falla una sonda suelta?
???
1. Una falla en 5 da 4 ÷ 5 = 0.8, que **no** es menor que 0.8: una sonda suelta no suena.
2. La primera falla es la de las 11:01. La de las 11:02 deja el promedio en 0.6: se cumple la condición. Con `for: 1m`, el aviso sale a las **11:03**, en el tercer minuto de la caída.
:::

:::figura caso-despacho-minutos
Una caída minuto a minuto: cada cuadro es una sonda. La alerta 7 se cumple con la segunda falla y avisa un minuto después; cada cuadro naranja en horario cuenta contra los 132 minutos del mes.
:::

:::formula Disponibilidad del mes, en minutos
A = 1 − frac{m_{caídos}}{M}
E = (1 − A_{SLA}) × M
- A: la disponibilidad medida en el horario hábil del mes
- m_{caídos}: minutos hábiles en que la pregunta de prueba falló
- M: minutos hábiles del mes; A_{SLA}: la prometida (0.99); E: los minutos de caída que permite
:::

:::cuenta Un mes con dos caídas
Minutos hábiles, \(M\) // 22 días × 10 h × 60 | 22 × 10 × 60 | 13,200
Presupuesto, \(E\) // \((1 − 0.99) × M\) | 0.01 × 13,200 | 132 minutos
Minutos caídos, \(m_{caídos}\) // dos caídas de 25 y 12 minutos (supuesto) | 25 + 12 | 37
Disponibilidad, \(A\) | 1 − 37 ÷ 13,200 | ≈ 99.72 %
Lo que queda del presupuesto | 132 − 37 | 95 minutos
= Se cumplió: 99.72 % contra 99 %, sin créditos para el despacho.
:::

:::ojo Un minuto sin medición
Si Prometheus o blackbox se caen, esos minutos no tienen muestra y **no cuentan** como caídos: un SLA que no lo dice invita a apagar el medidor. La propuesta: un minuto hábil sin medición **cuenta como caído**, salvo que el registro del gateway demuestre que hubo respuesta. Y si Prometheus entero se cae, ninguna alerta suena: para eso es un correo diario de «sigo vivo».
:::

:::diagrama caso-despacho-sonda
El camino de la pregunta de prueba cada minuto, de blackbox_exporter en la zona de gestión a la búsqueda, el gateway y el motor, y de regreso a Prometheus, al panel 9 y al correo. Usa «Recorrer» para seguir un minuto normal y uno caído.
:::

Lo que se agrega: el **panel 9, «La pregunta de prueba»**, arriba junto a los paneles 1 a 3 (minutos caídos del mes contra la línea de 132, la disponibilidad, la última respuesta y su duración); la **alerta 7, `SondaPreguntaCaida`** (nivel ahora; abre un incidente de severidad 1) y la **alerta 8, `SondaSinDatos`** (sin muestras en 3 minutos, nivel ahora).

## Evals, piloto y riesgos {Evals, pilot and risks}

El [[eval|examen]] es el de la ficha: 200 preguntas de los abogados con su respuesta y su [[cita]], y el [[criterio-de-aceptacion|criterio]] de **≥ 170 bien con la cita correcta, ≤ 4 [[cita-inventada|citas inventadas]] y 0 fugas**. El caso le agrega un uso: el examen decide cuántos fragmentos, y los fragmentos deciden la GPU.

:::intenta Diseña la prueba de 3 contra 5 fragmentos
Con el examen de 200 y el gate de la ficha (invariantes: 0 fugas y 0 citas inventadas nuevas; una prueba pareada que se detiene si la cota de una cola del 95 % de la diferencia cae debajo de −6 puntos o si lo observado cae 3 o más), ¿cómo decides si el despacho puede pasar a 3 fragmentos con reranker? ¿Qué tiene que salir para que la compra cambie de D a A?
???
1. Las dos configuraciones corren **las mismas 200 preguntas**, con el mismo modelo y el mismo juez: 5 fragmentos (la referencia) y 3 con el reranker sobre 20 candidatos.
2. Primero los invariantes: si la de 3 filtra algo prohibido o inventa una cita nueva, se descarta sin mirar el porcentaje.
3. Luego la prueba pareada: pasa si la cota queda arriba de −6 puntos y lo observado no cae 3 o más; y la de 3 tiene que pasar sola el criterio (≥ 170, ≤ 4 inventadas).
4. Se leen todos los [[flips]] (las preguntas que pasan de bien a mal o al revés), sobre todo en las de cláusulas, donde 3 fragmentos puede quedarse corto.
5. Si pasa todo, la compra cambia a **A con 3 fragmentos**. Si no, **D**.
:::

### El piloto, semana a semana

El de «El recorrido» (8 semanas, 20 abogados, GPU rentada de la semana 2 a la 7), con lo que cierra de este caso:

| Semana | Lo que se mide | Lo que decide |
|---|---|---|
| 2 | Primer RAG en la L40S rentada; la sonda corre desde el primer día | Que la sonda funciona antes de que importe |
| 3 | Examen con 5 fragmentos y prueba pareada contra 3 | D o A |
| 4 | [[prueba-de-carga\|Prueba de carga]] a 0.21 por segundo en 4 L40S rentadas (≈ US$500 por 48 h); prefill en una Server Edition rentada (G4 de Google Cloud, ≈ US$216 por 48 h); reparto por turno contra al azar | El prefill real y el p95 de cada opción |
| 5–6 | Uso real; minutos caídos de la sonda; cotizaciones con fecha | Si D llega a tiempo y a precio |
| 7–8 | [[sizing]] con lo medido; firma | La compra |

Lo que **no** mide (el chasis con dos tarjetas, su potencia real) lo responde el integrador por escrito.

### Riesgos

| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| El prefill real sale más lento que 1.72 s | D no cumple los 2 s | Medirlo en la semana 4; regla de ≤ ≈ 1.75 s | Responsable técnico |
| La Server Edition no llega (plazos de 3 a 7 meses vistos en marzo de 2026) | Meses de espera | Dos cotizaciones con fecha; B como salida | Integrador y socio |
| El precio sube antes de comprar | B sale más barata | Cotización con vigencia de 10 días; regla «D si cuesta ≤ B» | Quien cotiza |
| El gateway reparte al azar | El p95 de D sube a ≈ 3.1 s | Reparto por turno o viendo la fila, probado en la semana 4 | TI, con el tablero |
| Falla una Server Edition | Una sola: p95 ≈ 4.1 s | Garantía con reposición; alerta 4 en `< 2` | TI y proveedor |
| El examen no pasa ni con 5 fragmentos | Ninguna GPU lo arregla | Revisar chunks, reranker y OCR antes de comprar | Responsable técnico y abogado enlace |
| La sonda se cae y nadie se entera | El SLA se cuenta mal | Alerta 8 y el correo de «sigo vivo» | TI |
| El edificio no deja hacer las obras | No hay cuarto propio | Pedir el permiso en la semana 1; plan B de colocation | Socio y TI |

## Costo: tres años y cada pregunta {Cost: three years and each question}

:::formula El costo al mes del servidor propio
P = frac{K × (1 − v_r)}{V} + L_{kWh} + O_{esp} + H
- P: el servidor propio al mes, en US$
- K: la compra; v_r: la reventa al final, como parte de K (0.20); V: la vida en meses (36)
- L_{kWh}: la luz al mes; O_{esp}: UPS y obra repartidos; H: las personas que lo operan
:::

:::intenta ¿Cuánto cuesta D al mes y cada pregunta?
Con la compra de D (≈ US$74,779), 20 % de reventa en 36 meses, ≈ US$273 de luz (la herramienta, con 2 tarjetas de 600 W), US$433 de UPS y obra y US$575 de TI: ¿cuánto al mes, en dólares y en pesos, y cuánto cada una de las 66,000 preguntas del mes?
???
74,779 × 0.8 ÷ 36 ≈ 1,662; + 273 + 433 + 575 ≈ **US$2,943** al mes ≈ **MXN 58,038**; ÷ 66,000 ≈ **MXN 0.88** por pregunta. La cuenta completa, abajo; ábrela en la [herramienta de TCO con D](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&G=2&K=17159&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203).
:::

:::cuenta El costo de D: al mes y en tres años
Compra, \(K\) // chasis Exxact US$40,461.30 + 2 × US$17,158.99 (CDW, 2026-11-26) | 40,461.30 + 34,317.98 | ≈ US$74,779
Depreciación // \(K × (1 − v_r) ÷ V\) | 74,779 × 0.8 ÷ 36 | ≈ US$1,662
Luz, \(L_{kWh}\) // (2 × 600 W × 0.6 + 450 W) × PUE 2.0 × 730 h × US$0.16 | 1.17 × 2 × 730 × 0.16 | ≈ US$273
UPS y obra, \(O_{esp}\) // (US$9,000 + MXN 130,000 ÷ 19.7203) ÷ 36 | 15,592 ÷ 36 | ≈ US$433
TI, \(H\) // 52 h × MXN 218.1 ÷ 19.7203 | 11,341 ÷ 19.7203 | ≈ US$575
Al mes, \(P\) | 1,662 + 273 + 433 + 575 | **≈ US$2,943**
En pesos | 2,943 × 19.7203 | ≈ MXN 58,038
Por pregunta // 66,000 al mes | 58,038 ÷ 66,000 | ≈ MXN 0.88
TCO de 36 meses // + US$18,302 de decidir (examen, piloto y prueba de carga, la ficha) | 2,943 × 36 + 18,302 | ≈ US$124,253 ≈ MXN 2.45 millones
= D cuesta ≈ MXN 0.88 por pregunta: ≈ MXN 0.06 más que A, por cumplir la promesa con repuesto, y ≈ US$57 al mes menos que B.
:::

No trae impuestos ni [[importacion|importación]] (≈ 7 % más si el despacho importa, «Cotizar»). Lo que más la mueve es el precio de la tarjeta: a US$13,000, D baja a ≈ [US$2,758 al mes](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&G=2&K=13000&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.6&pue=2&kwh=0.16&oe=433&op=575&tc=19.7203), casi lo de A. La API del mismo modelo costaría ≈ US$41 al mes, ≈ 72 veces menos, y no cumple el requisito: los expedientes saldrían de la red.

## La propuesta en una página {The one-page proposal} [extra]

Todo lo de arriba, en lo que el socio lee y firma.

| | |
|---|---|
| **El problema** | 200 abogados, 30,000 expedientes, secreto profesional y la ley de datos personales. Hoy hay contratos en chatbots públicos. |
| **Lo que se propone** | Un asistente que contesta sobre los expedientes citando documento y página, en un servidor propio sin ruta a internet. |
| **El servidor** | 2 RTX PRO 6000 Blackwell Server Edition en un 4U de integrador certificado (≈ US$74,779 a precio de tienda de EE. UU., sin impuestos; a cotizar): la única opción que cumple ≤ 2 s con 5 fragmentos y tiene repuesto del promedio. |
| **Las condiciones** | El piloto mide un prefill ≤ ≈ 1.75 s; la cotización llega con entrega en ≈ 3 meses y no cuesta más que 4 L40S (US$76,101). Si el examen acepta 3 fragmentos, 3 L40S (US$67,191). |
| **Dónde** | En el cuarto de TI, con 2 circuitos de 20 A a 220 V, UPS de 5–6 kVA y 2 minisplits (≈ MXN 130,000 de obra). Colocation en la CDMX con enlace dedicado solo si el edificio no deja. |
| **Cómo se sabe que funciona** | El examen de 200 en cada cambio; un tablero de 9 paneles y 8 alertas; una pregunta de prueba cada minuto que cuenta los minutos del SLA de 99 %. |
| **Costo** | ≈ US$2,943 al mes (≈ MXN 58 mil), ≈ MXN 0.88 por pregunta; ≈ MXN 2.45 millones en 3 años con piloto y examen. Piloto ≈ US$27,600 + IVA; soporte ≈ US$2,165 + IVA al mes. |
| **No incluye** | Impuestos e importación, NVIDIA AI Enterprise, escribir las 200 preguntas (≈ 133 h de los abogados), conectar el sistema documental. |
| **Riesgos** | El prefill medido, la escasez de la tarjeta, el reparto del gateway, una tarjeta caída. |
| **Vigencia** | 10 días naturales, por el tipo de cambio (19.7203, el FIX del 2026-11-26, el [[tipo-de-cambio|tipo de cambio]] oficial del Banco de México). |

## Qué cambiaría si… {What would change if…} [extra]

**…el pico fuera de 3.5** (un día de cierre). Llegan ≈ 0.29 preguntas por segundo, ≈ 8 conversaciones a la vez. La [sizing con pico de 3.5](/herramientas/sizing/?p1=l40s&pk=3.5) pide 4 L40S, y [con la Server Edition](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&pk=3.5), 2: D lo aguanta, sin repuesto ese día.

**…fueran 300 personas.** ≈ 8.6 conversaciones con L40S y ≈ 8.4 con Server Edition: 5 L40S o 2 Server Edition ([L40S](/herramientas/sizing/?p1=l40s&U=300), [Server Edition](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=300)). Con 400, 6 L40S (no caben en un chasis de 4 ranuras) o todavía 2 Server Edition, ya sin repuesto. La holgura de D compra ese crecimiento.

**…el despacho firmara 3 s de TTFT.** Firmado por el despacho, no bajado por quien vende. A cumple por turno (≈ 2.55 s con red y búsqueda) y es la más barata, pero sin repuesto: con una tarjeta menos, el p95 sube a ≈ 3.2 s y la escritura baja de 20 tokens por segundo. B lo arregla por ≈ US$250 más al mes.

**…se usara tensor parallel en pares de L40S.** Con una cuarta L40S, 2 copias de 2 tarjetas: [Varias GPUs](/varias-gpus/) calcula ≈ 1.34 s de prefill (1.09 de cálculo y 0.25 de PCIe 4.0, con una latencia supuesta). Cumpliría, pero sin NVLink la comunicación es una estimación: se mide si D no llega.

**…fuera una sola Server Edition con 3 fragmentos.** Con ≈ 3,500 tokens, la [Server Edition sola](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&Np=3500) lee en ≈ 0.97 s, atiende 11 conversaciones y su p95 simulado baja a ≈ 1.8 s, con una sola fila. Pero 3 fragmentos piden el reranker: con sus 232 ms, la red y la búsqueda, ≈ 2.2 s (≈ 2.07 con el reranker de 97 ms). **No cumple**, y además no tiene repuesto: con 2 personas de TI y un SLA de 99 %, no se recomienda.

## Errores comunes {Common mistakes}

1. **Elegir la GPU por el TTFT sin fila.** «La Server Edition lee en 1.72 s: con una alcanza». Una sola tiene una sola fila y su p95 es ≈ 4.1 s. **Cómo evitarlo:** simula la fila con las llegadas de la hora pico; el p95 es lo que se promete.
2. **Comprar hardware para arreglar el reparto.** Una cuarta L40S baja el p95 al azar de 4.24 a 3.94 s; repartir por turno, a 2.38 sin comprar nada. **Cómo evitarlo:** revisa qué hace el gateway por omisión antes de cotizar.
3. **Comparar precios de fechas distintas.** La ficha decía US$12–14 mil por Server Edition; el día del caso, la tienda grande pedía 17,159 y no tenía. **Cómo evitarlo:** cada precio con su fecha y su fuente, y la cotización con vigencia.
4. **Dar por hecho que colocation es más barato.** A tarifa mayorista empata con el cuarto, y el enlace dedicado solo cuesta más que todo el cuarto. **Cómo evitarlo:** suma enlace, instalación y visitas, no solo el kW.
5. **Medir «arriba» con `up` del motor.** El motor puede estar arriba y la búsqueda caída. **Cómo evitarlo:** una pregunta de prueba que recorra todo el camino y revise la cita, con un documento falso.
6. **Una sonda que no avisa cuando se muere.** Con un Pushgateway, el último 1 se queda para siempre. **Cómo evitarlo:** blackbox_exporter, una alerta de ausencia y un correo diario de «sigo vivo».

## Ejercicios {Exercises}

:::ejercicios
? [facil] Con 2 Server Edition de 6 lugares cada una, ¿cuánta holgura hay contra las 5.57 conversaciones de la hora pico? ¿Y con una tarjeta caída?
Con las dos: 12 ÷ 5.57 ≈ **2.15×**. Con una: 6 ÷ 5.57 ≈ **1.08×**, arriba del promedio, pero el p95 sube a ≈ 4.1 s porque queda una sola fila.
? [facil] El SLA promete 99 % en 13,200 minutos hábiles. Un mes hubo caídas de 40, 50 y 60 minutos. ¿Se cumplió? ¿Qué crédito toca?
Caídos: 150. Disponibilidad: 1 − 150 ÷ 13,200 ≈ **98.86 %**: debajo de 99 % y arriba de 98 %, toca el crédito de **10 % de la [[iguala]]** (≈ $4,194 de $41,938).
? [medio] Con la alerta 7 (`avg_over_time(probe_success[5m]) < 0.8`, `for: 1m`), las sondas de 10:00 a 10:09 salen 1 1 0 1 1 1 0 1 0 1. ¿Cuándo suena? ¿Y con una ventana de 3 minutos y `< 0.7`?
Fallan 10:02, 10:06 y 10:08. Las ventanas de 5 que terminan de 10:04 a 10:09 promedian 0.8, 0.8, 0.6, 0.8, 0.6 y 0.6: se cumple en 10:06, se rompe en 10:07 (el `for` vuelve a cero) y se cumple en 10:08 y 10:09: **suena a las 10:09**. Con 3 minutos y `< 0.7`, una falla en 3 da 0.67: se cumple desde 10:02 y suena a las **10:03**. Ventana corta y umbral alto suenan con cada tropiezo.
? [medio] Si el piloto mide un prefill de 1.95 s en la RTX PRO 6000 a 6,000 tokens, ¿qué recomiendas?
El p95 de D por turno quedaría ≈ 2.25 s (la fila crece más rápido que el prefill) y con red y búsqueda ≈ 2.42 s: **ya no cumple**. Ninguna opción cumple con 5 fragmentos, y B tiene N+1 de verdad y se entrega hoy. Recomiendas **B** si el despacho firma un TTFT más alto, o **A con 3 fragmentos** si el examen los acepta.
? [medio] El enlace dedicado cotizado cuesta $8,000 al mes con $15,000 de instalación, y el rack, US$320 por kW con 2.5 kW, energía incluida. Con una visita al mes de 3 horas, ¿cuál sale más barato?
Renta: 2.5 × 320 × 19.7203 ≈ $15,776. Instalación: 15,000 ÷ 36 ≈ $417. Visita: 3 × 218.1 ≈ $654. Colocation: 15,776 + 8,000 + 417 + 654 ≈ **$24,847** al mes contra **$13,366** del cuarto: el cuarto gana por ≈ $11,481. Repítelo en la calculadora del caso.
? [reto] El despacho crece a 300 personas con 5 fragmentos. Compara D con B (4 L40S) en lugares, holgura y repuesto.
Con 300, \(λ\) ≈ 0.3125 por segundo. L40S: \(c\) ≈ 8.56 y 2 por tarjeta; 4 L40S dan 8 lugares, **menos que 8.56**: B ya no alcanza ni sin fallas. Server Edition: \(c\) ≈ 8.35 y 6 por tarjeta; 2 dan 12 (1.44×), pero una caída deja 6, debajo de 8.35: **sin repuesto**. D aguanta mejor; para recuperar el N+1 necesita una tercera tarjeta, si el chasis tiene la ranura.
:::

## Lo que sigue {What comes next} [extra]

El despacho pasa a la ficha con sus decisiones: el hardware (D con sus condiciones), el lugar (el cuarto propio) y la sonda del SLA. Las lecciones que lo prepararon:

- **[De requisitos a hardware](/requisitos-hardware/)** y **[Concurrencia](/concurrencia/)**: el perfil de carga, los techos de una GPU y la fila.
- **[El cuarto](/el-cuarto/)** y **[Seguridad](/seguridad/)**: el plan de obras y lo que cambia en colocation.
- **[Observabilidad](/observabilidad/)** y **[Cotizar](/cotizar/)**: el tablero, las alertas y el SLA al que este caso les sumó la pregunta de prueba.
- **[Demostrar que el modelo abierto sirve](/evals/)** y **[Pruebas de carga](/pruebas-carga/)**: el examen y la prueba que deciden en el piloto.
- En Sensei: [Colas](https://sensei.trueml.app/colas/) y [Redes en la nube](https://sensei.trueml.app/redes-nube/).

El siguiente caso cambia lo que pesa: en una clínica, los datos son de salud y el servicio no se apaga de noche.

:::conceptos
secreto-profesional sonda-sintetica blackbox-exporter enlace-dedicado vpn-sitio-a-sitio manos-remotas
:::

:::chequeo
? ¿Por qué D y no B, si cuestan casi lo mismo?
Porque D es la única que cumple el TTFT ≤ 2 s en el p95 con 5 fragmentos (≈ 1.77 s por turno); B no baja de 2.38 s, el prefill de la L40S. Y D tiene más holgura (2.15× contra 1.40×).
? ¿Qué tendría que pasar en el piloto para comprar 3 L40S?
Que el examen con 3 fragmentos y reranker pase el gate contra el de 5. Con ≈ 3,500 tokens, 3 L40S dan 12 lugares, N+1 y ≈ 1.74 s.
? ¿Por qué una sola Server Edition tiene un p95 de ≈ 4.1 s si lee un prompt en 1.72 s?
Porque hay una sola fila: lee prompts ≈ 36 % del tiempo y las preguntas que llegan juntas se esperan. Con dos, por turno, caen en GPUs distintas.
? ¿Por qué el servidor se queda en el cuarto propio?
Porque cuesta ≈ $13,366 al mes contra ≈ $19,000–43,000 de colocation con enlace dedicado aun a precio mayorista, y los expedientes no salen de la oficina. Colocation es el plan B si el edificio no deja.
? ¿Qué mide la pregunta de prueba y qué no?
Si el servicio está arriba como lo vería un abogado: código 200, `GIRASOL-7` y la cita `PRUEBA-0001` en menos de 10 s. No mide el TTFT: eso sale del histograma de vLLM.
? ¿Por qué no un script con Pushgateway?
Porque guarda el último valor: si el script muere, el tablero sigue diciendo «arriba». Con blackbox_exporter, la falta de datos se alerta.
:::
