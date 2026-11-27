---
titulo: TCO: API, nube o servidor propio
en: TCO: API, cloud or your own server
subtitulo: Cómo se suma el costo total de tener un LLM durante 3 años (compra, cuarto, luz, personas, depreciación, impuestos y tipo de cambio), en qué uso cambia la respuesta y cómo se le dice a un cliente que, en dinero, la API gana.
pregunta: El socio director pregunta «¿cuánto nos va a costar esto al año de verdad, y no nos saldría más barato pagarle a OpenAI?». ¿Cómo se suma el costo total de cada opción con depreciación, luz, personas y tipo de cambio, en qué volumen cambia la respuesta, y cómo se le contesta con honestidad a un cliente para el que, en dinero, la API gana?
sensei: nube, maquinas
---

:::idea
El [[tco|costo total]] de una opción es **todo** lo que se paga por ella mientras dura: la compra repartida en su [[vida-util|vida útil]], menos lo que se recupera al venderla, más la luz, el cuarto, las personas y lo que cuesta decidir. Sumado con honestidad, al despacho de esta lección su servidor le cuesta ≈ MXN 54 mil al mes, y el mismo modelo por API costaría ≈ MXN 800. **En dinero, la API gana por goleada.** Lo que el despacho paga con su servidor es que ningún expediente salga de su red; la cuenta sirve para saber cuánto cuesta eso, con qué supuestos y qué supuesto la mueve.
:::

## «¿No nos saldría más barato pagarle a OpenAI?» {“Wouldn't it be cheaper to just pay OpenAI?”}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Lo usarían **200 personas**, ≈ **15 preguntas al día** cada una, 22 días al mes: **66,000 preguntas al mes**. Cada pregunta lleva ≈ **6,000 tokens** de entrada y la respuesta ≈ **500**. El modelo es Qwen3 32B en INT4 de AWQ; el servidor, un Exxact de 4U con **3 L40S** (US$67,191.30 en el configurador, el 25 de noviembre de 2026), en el cuarto de TI del despacho. El equipo de TI son **2 personas** que saben de redes y Windows y nunca han operado una GPU.

Las lecciones anteriores dejaron cada pieza con su precio: [Comprar hardware](/comprar-hardware/), la caja; [El cuarto](/el-cuarto/), la luz (≈ MXN 4,825 al mes) y el plan del UPS y del aire; [Pruebas de carga](/pruebas-carga/), lo que cuesta medir. Falta juntarlas. El socio director no pregunta por piezas: pregunta **cuánto al año** y **contra qué**.

Dos cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Una compra grande que dura años (*CapEx*) se reparte en esos años; lo que se paga mes con mes (*OpEx*) no. Comprar o rentar se iguala en un número de horas de uso al mes, \(h^{*} = P ÷ c\). Lo ves en [Qué es la nube](https://sensei.trueml.app/nube/).
- Una GPU rentada se cobra por hora prendida, trabaje o no; los compromisos de 1 a 3 años bajan la tarifa a cambio de un plazo. Lo ves en [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/).

Y de esta app, la herramienta [API, nube o servidor propio](/herramientas/tco/) ya tiene las tres fórmulas (la API por token, la renta por hora, el propio con [[depreciacion|depreciación]] y [[pue|PUE]]) y los tres [[punto-de-equilibrio|puntos de equilibrio]]. Esta lección las usa y va más a fondo en lo que la herramienta solo nombra: **qué vida útil, qué reventa, qué impuestos, qué tipo de cambio, cuántas personas** y cuál de todos esos supuestos decide.

:::ojo
La herramienta hace la cuenta del despacho con la base del Exxact (US$40,461) más las tarjetas sueltas a US$9,005: US$67,476 de compra y ≈ US$2,869 al mes. La cotización real del Exxact con 3 L40S es **US$67,191.30** (US$8,910 por tarjeta). Esta lección usa la cotización y suma lo que la herramienta deja fuera: el UPS, la obra del cuarto, la luz de «El cuarto» y las horas de TI en pesos; por eso sus números son otros.
:::

## Las piezas del costo total {The pieces of the total cost}

El [[tco|TCO]] (*total cost of ownership*, costo total de propiedad) de una opción se arma con una lista. La regla es que **todas las opciones se comparan con la misma lista**: lo que una no paga, se escribe en cero, no se borra.

Para el servidor propio del despacho la lista tiene siete piezas, en tres grupos:

- **Lo que se paga al comprar.** El servidor con sus GPUs; el [[ups|UPS]] de 6 kVA; la obra del cuarto (los dos circuitos de 220 V y los dos minisplits de 2 toneladas del plan del cuarto).
- **Lo que se paga cada mes.** La luz y las personas que lo operan.
- **Lo que pasa una vez, al principio o al final.** Lo que cuesta decidir (el piloto, la prueba de carga, el examen) y lo que se recupera al vender el servidor.

:::diagrama costo-total-piezas
De dónde sale el TCO de 3 años del despacho, con el peso de cada pieza sobre la suma bruta (antes de restar la reventa). Toca cada caja para ver de dónde sale su número, o sigue el recorrido.
:::

:::formula El costo total en V meses
TCO_V = K + U + O − v_r × K + V × (L + H) + D
- K: la compra del servidor con sus GPUs, en US$
- U: el UPS; O: la obra del cuarto (circuitos y aire)
- v_r: la reventa al final, como parte de \(K\) (0.20 = 20 %)
- V: los meses de la cuenta (36 = 3 años)
- L: la luz al mes; H: lo que cuestan al mes las personas que lo operan
- D: lo que cuesta decidir: piloto, prueba de carga y examen
- TCO_V: el costo total de la opción en esos \(V\) meses
:::

Cada pieza, con su origen:

:::cuenta El TCO de 3 años del despacho, 3 L40S
Servidor, \(K\) // Exxact 4U con 3 L40S, configurador del 2026-11-25 | — | US$67,191
UPS, \(U\) // 6 kVA de doble conversión; precios vistos de US$8,428 a 9,684 (secundaria) | supuesto | US$9,000
Obra y aire, \(O\) // 2 circuitos ≈ MXN 60,000 + 2 minisplits instalados ≈ MXN 70,000 (supuestos), a 19.7203 pesos por dólar | 130,000 ÷ 19.7203 | US$6,592
Reventa, \(v_r × K\) // 20 % del servidor al mes 36 (supuesto) | −0.20 × 67,191 | −US$13,438
Luz, \(V × L\) // la cuenta de la ficha con la tarifa GDBT y PUE de 2.0 | 36 × 4,825 ÷ 19.7203 | US$8,808
Personas, \(V × H\) // 52 horas al mes a MXN 218.1 la hora (supuestos de la sección de personas) | 36 × 52 × 218.1 ÷ 19.7203 | US$20,705
Decidir, \(D\) // examen ≈ 16,700 + piloto ≈ 1,099 + prueba de carga ≈ 504 | 16,700 + 1,099 + 504 | US$18,302
TCO de 36 meses | suma de las filas | **US$117,161**
En pesos | 117,161 × 19.7203 | ≈ MXN 2.31 millones
Al mes, sin lo de decidir | (117,161 − 18,302) ÷ 36 | **≈ US$2,746**
= Tres años de servidor propio cuestan ≈ MXN 2.31 millones. El número que se compara cada mes con las otras opciones es ≈ US$2,746 (≈ MXN 54,154), porque lo de decidir se paga igual elija lo que elija.
:::

Fíjate en tres cosas de la cuenta.

**La compra es casi dos tercios.** Servidor, UPS y obra suman ≈ US$82,783, el 63 % de la suma bruta (US$130,600). Lo demás, en 36 meses, apenas pasa de un tercio.

**Las personas pesan más del doble que la luz.** US$20,705 contra US$8,808. Una cuenta que pone la luz con tres decimales y las personas en cero está mal hecha.

**Lo de decidir no es poca cosa.** El examen solo (≈ 167 horas de abogados a US$100 la hora, supuesto de la ficha) cuesta más que el UPS, el piloto y la prueba de carga juntos (≈ US$10,600). No cambia qué opción gana, porque cualquier opción necesita su examen; sí cambia el presupuesto del proyecto.

### Las otras dos configuraciones

La ficha pide cotizar dos cajas, y la promesa de velocidad pide pensar en una tercera:

| Configuración | Compra | Al mes, sin decidir | TCO 36 meses | En pesos |
|---|---|---|---|---|
| 3 L40S (la base) | US$67,191 | US$2,746 | US$117,161 | MXN 2.31 M |
| 4 L40S ([[n-mas-1\|N+1]], las 8 de diseño) | US$76,101 | US$2,944 | US$124,289 | MXN 2.45 M |
| 2 RTX PRO 6000 Server Edition (hipótesis; con la tarjeta a precio de CDW, abajo) | ≈ US$68,621 | ≈ US$2,778 | ≈ US$118,305 | ≈ MXN 2.33 M |

La Server Edition **no tiene precio de lista** ni de NVIDIA ni en el configurador de Exxact: el número es una hipótesis (la base del Exxact más ≈ US$14,080 por tarjeta) hasta que llegue la cotización. Para ubicarla: a noviembre de 2026, CDW la lista en US$17,158.99 y sin existencias (26 de noviembre, un revendedor, fuente secundaria), y con ese precio las 2 Server Edition salen en ≈ US$74,779 de compra y ≈ US$2,943 al mes, no los ≈ US$2,778 de la hipótesis: [el caso del despacho](/casos/despacho/) hace la cuenta. Y una advertencia que viene de la ficha: con 3 L40S, el [[ttft|TTFT]] p95 simulado en la hora pico es ≈ 4.2 s, contra la promesa de 2 s. **El propio que cumple la promesa puede ser el de 4 L40S o el de 2 Server Edition, no el de 3.** La cuarta L40S también deja actualizar una réplica a cualquier hora sin quedarse corto ([Seguridad](/seguridad/)). Por eso la propuesta se da como rango (≈ US$2,746 a 2,944 al mes), y el piloto lo cierra.

:::nota Lo que esta cuenta no trae
La compra está en precio de EE. UU., sin impuestos ni [[importacion|importación]]: el flete, el [[arancel|arancel]] y el [[agente-aduanal|agente aduanal]] los cuenta [Cotizar, proponer y dar soporte](/cotizar/). La licencia de NVIDIA AI Enterprise (US$18,000 por GPU por 5 años) es opcional y no entra. Y el cálculo supone que la garantía del integrador cubre las piezas en los 36 meses, así que no hay renglón de refacciones: Exxact publica una garantía limitada de 3 años para su hardware de marca, y si cubre las tarjetas de NVIDIA y cómo funciona fuera de EE. UU. está por confirmar.
:::

## La depreciación a fondo: vida útil y reventa {Depreciation in depth: useful life and resale}

La [[depreciacion|depreciación]] reparte la compra en los meses que el equipo sirve. Tiene dos supuestos, y los dos están entre los que más mueven la cuenta: **cuántos meses** y **cuánto vale al final**.

### Tres vidas distintas

«Vida útil» suena a una sola cosa y son tres:

- **La vida contable**: los meses en que el despacho reparte la compra en sus libros, para que el costo de cada mes sea honesto. La elige el despacho (con su contador). Aquí, 36 meses.
- **La vida fiscal**: la que la ley deja usar para **deducir** la compra de los impuestos. En México la fija la Ley del ISR, y no es la misma (la sección de impuestos).
- **La vida económica**: los meses en que conviene **seguir usándolo** en vez de reemplazarlo. Es la que importa para decidir, y nadie la sabe por adelantado.

:::analogia El celular
Un celular puede prender 7 años. A los 3 o 4, las apps nuevas ya no corren bien, la batería dura medio día y la marca deja de mandar actualizaciones de seguridad: deja de convenir antes de romperse. Esa es la vida económica. Dónde se rompe: un celular viejo casi no vale nada, y una GPU de centro de datos de 3 años todavía se vende cara; y el celular lo cambias tú cuando quieres, mientras que un servidor se cambia cuando la carga, la garantía y el presupuesto lo dicen.
:::

¿Por qué 36 meses para una GPU? Sensei lo cuenta en [Qué es la nube](https://sensei.trueml.app/nube/): cada generación hace más trabajo por dólar y por watt, y la gente que vende nube reparte sus servidores en 5 o 6 años.

:::profundo Lo que cuesta cambiar la vida útil
Sensei cuenta que Amazon acortó la vida de sus servidores; el número dice cuánto pesa eso. Amazon bajó la vida contable de una parte de sus servidores y equipo de red **de seis a cinco años** desde el 1 de enero de 2025, y su informe anual a la SEC (el regulador de la bolsa de EE. UU.), presentado en febrero de 2026, dice que eso le sumó **US$1.4 mil millones** de depreciación en 2025 y le quitó US$1.0 mil millones de utilidad. Un año menos de vida es más costo por mes, sin que haya cambiado ni un tornillo.
:::

Para el despacho hay una razón más concreta: **la garantía limitada de Exxact es de 3 años** (qué cubre, por confirmar). Del mes 37 en adelante, una L40S que falla la paga el despacho. El servidor puede seguir trabajando, pero el riesgo cambia de dueño.

### Lineal o acelerada

Hay dos formas comunes de repartir la compra:

- **Lineal** (*straight-line*): lo mismo cada mes. Es la de la herramienta y la de esta lección.
- **[[depreciacion-acelerada|Acelerada]]** (*accelerated*): más al principio y menos al final. La versión más usada, el **saldo doble decreciente** (*double declining balance*), cobra cada año el doble de la tasa lineal sobre **lo que queda** en libros, sin bajar de la reventa.

:::formula Depreciación lineal y de saldo doble
D_{lin} = frac{K × (1 − v_r)}{n}
D_t = min(frac{2}{n} × B_{t−1}, B_{t−1} − v_r × K)
- K: la compra, en US$; v_r: la reventa, como parte de \(K\)
- n: la vida contable, en años (3)
- D_{lin}: la depreciación lineal de cada año
- B_{t−1}: lo que vale en libros al empezar el año \(t\) (\(B_0 = K\))
- D_t: la depreciación de saldo doble del año \(t\); el \(min\) impide bajar de la reventa
:::

:::cuenta Las dos depreciaciones del servidor de 3 L40S
Lineal, cada año, \(D_{lin}\) // \(K\) = 67,191; \(v_r\) = 0.20; \(n\) = 3 | 67,191 × 0.8 ÷ 3 | US$17,918 (≈ US$1,493 al mes)
Saldo doble, año 1, \(D_1\) // 2 ÷ 3 de \(B_0\) = 67,191 | 2 ÷ 3 × 67,191 | US$44,794
En libros tras el año 1, \(B_1\) | 67,191 − 44,794 | US$22,397
Saldo doble, año 2, \(D_2\) // 2 ÷ 3 de 22,397 = 14,931 pasaría de la reventa; el tope es \(B_1 − v_r × K\) | 22,397 − 13,438 | US$8,959
Saldo doble, año 3, \(D_3\) // ya está en la reventa | — | US$0
= Las dos suman lo mismo en 3 años, US$53,753. La acelerada carga 2.5 veces más el primer año: un primer año caro y dos baratos. Para decidir entre comprar y rentar se usa la lineal, porque compara meses iguales con meses iguales.
:::

:::figura costo-total-libros
Lo que vale el servidor de 3 L40S en los libros con cada forma de repartirlo. La acelerada lo baja rápido; la lineal, parejo hasta la reventa; la fiscal (la sección de impuestos), un poco más rápido que la lineal porque no resta reventa, y termina en el año 4. El punto aparte es el mercado de hoy para una tarjeta de 2023.
:::

### El valor de reventa

El [[valor-de-reventa|valor de reventa]] es lo que el despacho recupera al vender el servidor al final. La herramienta supone 20 %. ¿Es razonable?

Lo único que se puede mirar es el mercado de hoy. Un sitio que rastrea precios (fuente secundaria) da para noviembre de 2026 un promedio de **≈ US$7,600** para las tres L40S usadas más baratas en eBay (el 26 de noviembre, ≈ US$8,263). Una nueva comprada por volumen (*bulk*, en caja de varias, sin la caja de tienda) cuesta US$9,005 y una reacondicionada US$6,420 (`gpus.json`, 2026-11-25). Una L40S de 2023 vale hoy ≈ **84 %** de una nueva, y la misma página muestra que el precio de las usadas **subió** en los últimos meses (≈ 10 % contra los tres meses anteriores). El 20 % de la herramienta parece muy conservador.

Pero es un dato de **hoy**, no un pronóstico. Las GPUs usadas valen tanto porque hoy faltan GPUs. Si en 2029 sobran, o si sale una tarjeta que hace el trabajo de tres L40S por el mismo precio, la reventa cae. Y el resto del servidor (CPUs, memoria, chasis) no tiene un mercado tan claro. Por eso la lección deja el 20 % y lo pone en el análisis de sensibilidad: si la reventa fuera 50 %, el propio bajaría de ≈ US$2,746 a ≈ US$2,186 al mes; si fuera 0 %, subiría a ≈ US$3,119.

:::ojo
Una reventa alta se cobra **solo si se vende**. Si el despacho decide quedarse el servidor 5 años, la reventa al mes 36 no existe: lo que existe es una vida útil más larga (otra fila del análisis de sensibilidad). No sumes las dos cosas.
:::

## Impuestos en México: deducir no es depreciar {Taxes in Mexico: deducting is not depreciating} [extra]

Lo que sigue es **orientación**, no asesoría fiscal: el régimen exacto del despacho lo confirma su contador. Pero hay que saberlo para no prometer de más.

### La deducción de la compra

La [[deduccion-fiscal|deducción fiscal]] es la parte de una compra que la ley deja restar de los ingresos antes de calcular el impuesto. Una persona moral (una empresa o sociedad, no una persona) en el régimen general paga ISR de **30 %** sobre su resultado fiscal, la utilidad que cuenta para el impuesto (artículo 9 de la LISR). Lo que se deduce baja ese resultado, y por eso baja el impuesto.

Un servidor no se deduce de golpe. El artículo 34, fracción VII, de la LISR fija **30 % al año** como el máximo para «servidores» y computadoras (consulta del 26 de noviembre de 2026; la reforma a la LISR del 13 de noviembre de 2026 no toca ese artículo). Es decir, una vida fiscal de 3.33 años: 30 % en cada uno de los años 1, 2 y 3, y el 10 % que falta en el año 4. Eso es lo que dibuja la línea verde de la figura de arriba.

Hay que separar las tres vidas. El despacho puede repartir la compra en **36 meses en sus libros** (vida contable), deducirla en **3.33 años** ante el SAT (vida fiscal) y usarla **5 años** si le conviene (vida económica). No se contradicen: responden preguntas distintas.

### El escudo fiscal: cuánto vale deducir

El [[escudo-fiscal|escudo fiscal]] (*tax shield*) es el impuesto que el despacho deja de pagar gracias a una deducción: la deducción por la tasa del impuesto. Como llega en varios años, se cuenta con su valor presente (la sección del valor del dinero).

:::formula El escudo fiscal de una compra
E = sum_{k=1}^{n} frac{t × d_k × K}{(1 + i)^k}
- K: la compra, en pesos
- d_k: la parte de \(K\) que se deduce en el año \(k\) (0.30, 0.30, 0.30 y 0.10)
- t: la tasa del ISR (0.30)
- i: la tasa de descuento anual
- E: el valor presente del impuesto que se deja de pagar
:::

:::cuenta El escudo del servidor de 3 L40S
Compra en pesos, \(K\) // US$67,191.30 al tipo de cambio de trabajo | 67,191.30 × 19.7203 | MXN 1,325,033
Escudo de cada año 1 a 3 // \(t × d_k × K\) | 0.30 × 0.30 × 1,325,033 | MXN 119,253
Escudo del año 4 // el 10 % que falta | 0.30 × 0.10 × 1,325,033 | MXN 39,751
Escudo sin descontar | 3 × 119,253 + 39,751 | MXN 397,510 (el 30 % de \(K\))
Valor presente, \(E\) // \(i\) = 6.25 % | suma de cada año ÷ 1.0625^k | **MXN 348,487** (26.3 % de \(K\))
Si todo se dedujera el año 1 // la referencia | 397,510 ÷ 1.0625 | MXN 374,127 (28.2 %)
= Deducir en 4 años en vez de 1 le cuesta al despacho ≈ MXN 25,640 (≈ US$1,300) de valor presente: poco junto a un servidor de 1.3 millones. Recupera ≈ 26 centavos de cada peso, el mismo orden que si fuera un gasto de renta, que también se deduce.
:::

Esa última frase es la importante: **los impuestos casi no cambian qué opción gana**. La renta de GPUs y la API también se deducen (y en el mes en que se pagan). Por eso la lección compara antes de impuestos: el orden se mantiene, y la cuenta se puede revisar sin un contador.

### Lo que circula y no aplica (o no solo así)

A noviembre de 2026 hay tres noticias fiscales que un cliente puede traer, y conviene saber qué dicen:

- **«El equipo de cómputo ya se deduce al 100 %.»** Es del artículo 209 (el régimen simplificado de confianza de personas morales, RESICO), que el decreto del 13 de noviembre de 2026 sube de 50 % a 100 % desde el 1 de enero de 2027. Solo aplica a personas morales formadas solo por personas físicas con ingresos de hasta MXN 50 millones. El artículo 34 del régimen general no se reformó: sigue en 30 %.
- **«Hay deducción inmediata de 85 %.»** Existe: el decreto del Plan México (DOF, 21 de enero de 2025) da deducción inmediata de **bienes nuevos** de cómputo de 88 % en 2025–2026 y de 85 % en 2027–2030 (el decreto del 13 de noviembre de 2026 la extiende). Pero exige presentar un proyecto de inversión, obtener una **constancia de un Comité de Evaluación**, mantener el bien en uso al menos los 2 años siguientes, y el dinero del estímulo tiene tope para todo el país (MXN 28,500 millones para esta deducción en el decreto de 2025). No es automática. Con la constancia y una compra de 2027 (85 %), y si el 15 % que falta se dedujera en el año 4 al vender el servidor (supuesto), el valor presente del escudo subiría de MXN 348,487 a ≈ MXN 364,795 a 6.25 %: unos MXN 16 mil.
- **«Desde 2027 hay un límite a las deducciones.»** Para personas morales con ingresos de más de MXN 50 millones, los artículos 78-A a 78-F nuevos dejan deducir el **99 %** de las deducciones del año (si no pasan del 96.67 % de los ingresos); el resto se difiere. Toca todo el gasto del despacho, no solo el servidor.

### El IVA

La compra paga IVA de **16 %**: ≈ MXN 212,005 sobre el servidor. Si la compra es estrictamente indispensable para la actividad (deducible para ISR), ese IVA es [[iva-acreditable|acreditable]] (artículo 5 de la LIVA): el despacho lo resta del IVA que cobra a sus clientes. **No es un costo, es dinero que sale y regresa**; lo que importa es el mes en que sale. Para el TCO se cuenta sin IVA, igual que la renta y la API.

:::nota Lo que queda para el contador
Si el despacho es persona moral en el régimen general (el supuesto de esta lección); en qué mes empieza a deducir y cómo se prorratea el primer año; si califica al estímulo del Plan México; el IVA de un servicio de nube de un proveedor extranjero. Ninguna de esas cuatro respuestas cambia qué opción gana; sí cambian el flujo del primer año.
:::

## Personas y tipo de cambio: lo que se paga en pesos {People and exchange rate: what gets paid in pesos}

Dos piezas que la herramienta deja como un número suelto en dólares y que, para un despacho en México, se pagan de otra forma.

### Lo que cuesta una hora de TI

Las personas son la pieza más subestimada. Un servidor propio pide alguien que lo opere: lo actualiza, lo vigila, atiende la [[alerta|alerta]], cambia la pieza, revisa el respaldo. En el despacho son las 2 personas de TI, que ya existen; lo que se cuenta es **la parte de su tiempo** que el servidor les quita.

:::formula El costo de las personas al mes
w = frac{s × f}{h_{mes}}
H = h_{op} × w
- s: el sueldo bruto mensual, en pesos
- f: el factor de costo patronal: lo que cuesta de más cada peso de sueldo (prestaciones y cuotas)
- h_{mes}: las horas de trabajo al mes; 40 horas a la semana son 40 × 52 ÷ 12 ≈ 173.3 (supuesto)
- w: lo que cuesta una hora de trabajo, en pesos
- h_{op}: las horas al mes que el servidor pide
- H: lo que cuestan las personas al mes, en pesos
:::

Ningún número de esta fórmula es exacto. La lección usa un sueldo de **MXN 28,000** al mes, un factor de **1.35** y **52 horas al mes** (12 a la semana); los tres son supuestos, y de dónde sale cada uno está aquí abajo.

:::profundo De dónde sale cada número
- **El sueldo**: las vacantes de administrador de sistemas e infraestructura en la Ciudad de México piden de MXN 25,000 a 32,000 al mes (OCC, noviembre de 2026; el promedio nacional de Indeed para administrador de sistemas es MXN 13,928, actualizado el 14 de noviembre de 2026). Ninguna es fuente oficial. Se usa **MXN 28,000** como supuesto.
- **El factor**: la Ley Federal del Trabajo pide al menos 15 días de aguinaldo (artículo 87) y una prima vacacional de 25 % sobre al menos 12 días de vacaciones (artículos 76 y 80): eso solo ya es ≈ 4.9 % más que el sueldo. Faltan IMSS, Infonavit, el SAR y el reparto de utilidades, que no se verificaron. **1.35 es un supuesto.**
- **La semana**: 40 horas es un supuesto de oficina, no la ley. La reforma a la Ley Federal del Trabajo del 1 de mayo de 2026 baja la jornada máxima de 48 horas a la semana a 40 en 2030, dos horas cada año (46 en 2027). Con 46 horas, la hora saldría ≈ 13 % más barata; la cuenta se queda con 40.
- **Las horas**: 12 a la semana, ≈ **52 al mes**, para un TI que nunca operó una GPU: unas 4 de vigilar y revisar, 4 de actualizar (las ≈ 16 al mes que cuenta [Seguridad](/seguridad/)), 3 de fallas y guardias y 1 de respaldos (supuesto). Las lecciones de [observabilidad](/observabilidad/) y [seguridad](/seguridad/) dicen qué hay que hacer en esas horas.
:::

:::cuenta Lo que cuesta el TI del servidor
Una hora, \(w\) // \(s\) = 28,000; \(f\) = 1.35; \(h_{mes}\) = 173.3 | 28,000 × 1.35 ÷ 173.3 | MXN 218.1 (≈ US$11.06)
Con el propio, \(H\) // \(h_{op}\) = 52 | 52 × 218.1 | MXN 11,341 al mes (≈ US$575)
Con la renta // 40 h: sin hardware que cambiar, pero el mismo motor | 40 × 218.1 | MXN 8,724 (≈ US$442)
Con la API // 8 h: claves, cuotas, revisar facturas | 8 × 218.1 | MXN 1,745 (≈ US$88)
Una persona completa // por si hay que contratar | 28,000 × 1.35 | MXN 37,800 (≈ US$1,917)
= Las 52 horas son el 21 % del costo mensual del propio. Si el despacho tuviera que contratar a alguien de tiempo completo solo para el servidor, el propio subiría de ≈ US$2,746 a ≈ US$4,088 al mes: 49 % más.
:::

La alternativa a las horas propias es pagarle a alguien de fuera: un [[contrato-de-servicios|contrato de soporte]] con un integrador. Exxact da una garantía limitada de 3 años a su hardware de marca (si incluye las tarjetas de NVIDIA, por confirmar), pero eso **no** es operar el modelo. Qué incluye un contrato de operación, cuánto se cobra y cómo se escribe es la lección [Cotizar, proponer y dar soporte](/cotizar/).

### El tipo de cambio: la compra lo fija, la renta lo paga cada mes

El [[tipo-de-cambio|tipo de cambio]] es cuántos pesos cuesta un dólar. El de referencia en México es el **FIX** que publica el Banco de México cada día hábil. El de esta lección es el del 26 de noviembre de 2026: **19.7203 pesos por dólar**. Siete días hábiles antes, el 17 de noviembre, el FIX fue 18.4677 (el aviso de Banxico en el Diario Oficial): en poco más de una semana el dólar subió ≈ 6.8 % (dicho al revés, el peso perdió ≈ 6.4 % de su valor en dólares).

En el TCO del despacho conviven dos monedas:

- **En dólares**: el servidor, el UPS, la reventa, la renta de GPUs, la API.
- **En pesos**: la obra, la luz, las personas.

La diferencia de fondo entre comprar y rentar es **cuándo** se cambia la moneda. Al comprar, el despacho cambia ≈ US$76 mil un día, a un tipo de cambio, y ya: los 36 meses siguientes paga en pesos. Al rentar, cambia ≈ US$2,400 **cada mes**, al tipo de cambio de ese mes.

En una frase: el dólar 10 % más caro sube el propio de 36 meses ≈ 6.3 % en pesos y la renta ≈ 8.4 %.

:::profundo El dólar a ± 10 %, en pesos
Con 19.7203 pesos por dólar, el propio cuesta ≈ MXN 54,153 al mes y la renta de las 3 L40S prendidas todo el mes, ≈ MXN 55,798. Si el dólar baja a 17.75 (−10 %), quedan en ≈ MXN 50,715 y 51,091; si sube a 21.69 (+10 %), en ≈ MXN 57,590 y **60,506**. En 36 meses, el propio va de MXN 1.83 a 2.07 millones (± 6.3 %), porque ≈ 63 % de su costo está ligado al dólar; la renta va de MXN 1.84 a 2.18 millones (± 8.4 %), porque ≈ 84 % del suyo lo está. Un peso débil castiga más a quien renta, y la compra lo castiga una sola vez: el día que se paga.
:::

Para una cotización eso tiene dos consecuencias. La primera: **cada precio en dólares lleva el tipo de cambio y la fecha con que se convirtió**. La segunda: un rango de ± 10 % del tipo de cambio mueve el total del propio ≈ ± 6 %, menos que la vida útil o las horas de TI (la sección de sensibilidad). El tipo de cambio asusta mucho y mueve poco.

## Las opciones de verdad: no hay API pública {The real options: no public API}

La herramienta compara contra la API, y en dinero la API gana. Pero para el despacho **la API pública no es una opción**: tiene secreto profesional con sus clientes, datos personales protegidos por la Ley Federal de Protección de Datos Personales en Posesión de los Particulares y clientes que lo prohíben por contrato. Hoy algunos abogados pegan contratos en chatbots públicos, y ese riesgo es el que dispara el proyecto. La comparación honesta no es «servidor contra OpenAI»: es contra lo que sí cumple, o casi.

### a) Un modelo abierto en una nube con región en México

La idea es buena: un contrato con un proveedor grande, los datos en el país. A noviembre de 2026, en la práctica casi no existe: AWS y Google no tienen GPUs en su región mexicana, Azure tiene un solo tipo de máquina con GPUs para LLMs de este tamaño (8 H200 juntas), y el servicio de modelos por token de AWS en México no trae ni Qwen3 ni Llama.

:::profundo La nube con región en México, proveedor por proveedor
- **AWS** tiene región en México (`mx-central-1`), pero su lista de precios del 24 de noviembre de 2026 **no trae ninguna instancia con GPU**: solo de CPU y de almacenamiento.
- **Google Cloud** tiene región en Querétaro, pero su tabla de GPUs por zona (consultada el 26 de noviembre de 2026) **no incluye ninguna zona de México**.
- **Azure México Central** tiene **un solo** tipo de máquina con GPUs de centro de datos para LLMs: 8 × H200 a **US$93.28 la hora** (≈ US$68,094 al mes prendida; con la reserva de 3 años, ≈ US$33,904 al mes, ≈ 50 % de descuento). Lo demás son máquinas de gráficos con A10 de 24 GB, enteras o en fracciones. Es precio de lista (API de precios de Azure, 26 de noviembre de 2026): no dice si hay cuota ni capacidad.
- **Bedrock** (los modelos por token de AWS) en su región de México ofrece solo Grok 4.7, Grok 4.6, Kimi K3 y Nova 2.0 Omni (lista de precios del 25 de noviembre de 2026): **ni Qwen3 ni Llama**. Kimi K3 cuesta US$3.30 por millón de tokens de entrada y US$16.50 de salida con el precio «regional» estándar; el «global» es 10 % más barato, pero puede mandar la petición fuera de México. Hay un nivel «flex» a la mitad, para peticiones que pueden esperar.
- **Kimi K3** es un modelo de pesos abiertos de Moonshot AI (julio de 2026) con licencia propia, la *Kimi K3 License*: parecida a MIT, con condiciones solo para quien venda el modelo como servicio a terceros con más de US$20 millones de ingresos al año, o lo ponga en productos de más de 100 millones de usuarios al mes (archivo LICENSE de su repositorio, consultado el 26 de noviembre de 2026). El uso interno del despacho no las toca.
:::

Para el despacho, la opción (a) se reduce a dos cosas: **un modelo distinto** (Kimi K3, ≈ US$1,851 al mes con el tráfico del despacho, ≈ 0.67 veces el propio; habría que pasarlo por el [[eval|examen]]) o **una máquina que cuesta 12 veces el propio**, con mucho más de lo que necesita.

### b) GPUs dedicadas rentadas

Rentar las mismas 3 L40S, dedicadas, en un *neocloud* (una nube que casi solo renta GPUs; Sensei los presenta en [Qué es la nube](https://sensei.trueml.app/nube/)): en RunPod (Secure Cloud), US$1.09 por GPU y hora (página del 12 de noviembre de 2026). Prendidas todo el mes, con 40 horas de TI: **≈ US$2,830 al mes**, casi lo mismo que el propio. Pero son servidores en EE. UU.: los expedientes salen del país, y la versión «Community» más barata (US$0.79) corre en máquinas de terceros que alquilan su hardware a través de RunPod, no en sus centros de datos (documentación de RunPod). Sirve para el piloto con datos de prueba, para la prueba de carga y como puente mientras llega el servidor; no para producción.

### c) El servidor propio

≈ US$2,746 al mes con 3 L40S. Los datos no salen de la red del despacho, que es lo que pidió.

| Opción | Al mes (US$) | Al mes (MXN) | ¿Los datos se quedan? |
|---|---|---|---|
| Qwen3 32B por API (DeepInfra) | 41 | ≈ 807 | No: EE. UU. |
| Qwen3 32B por API (Bedrock, EE. UU.) | 79 | ≈ 1,562 | No |
| Claude Sonnet 5.5 (referencia) | 1,122 | ≈ 22,126 | No |
| Kimi K3, Bedrock México (regional) | 1,851 | ≈ 36,508 | En México, en la nube; otro modelo |
| 3 L40S en RunPod, 24/7, con TI | 2,830 | ≈ 55,798 | No: EE. UU. |
| **Propio, 3 L40S** | **2,746** | **≈ 54,153** | **Sí, en su red** |
| 8 H200 en Azure México, reserva de 3 años | 33,904 | ≈ 668,600 | En México, en la nube |

Las APIs no incluyen sus 8 horas de TI ni las rentas sin TI salvo donde se dice; la tabla es para ver órdenes de magnitud. Todas cuentan los mismos tokens de Qwen3; los modelos de Claude cuentan ≈ 30 % más tokens para el mismo texto (documentación de precios de Anthropic, noviembre de 2026), así que Sonnet costaría algo más y cruzaría un poco antes. Las rentas tampoco traen el servidor de CPU donde corren la base de vectores, el gateway y la interfaz: en el propio vienen en los 384 GB de RAM del mismo Exxact.

:::ojo
El «precio regional» de Bedrock y la reserva de Azure **no** garantizan lo que el despacho necesita. Que los datos se procesen en México no es lo mismo que no salgan de su red: siguen en máquinas de un tercero, bajo un contrato. Para algunos clientes del despacho eso basta; para los que lo prohíben por contrato, no. Es una pregunta legal antes que de precio ([[soberania-de-datos|soberanía de datos]]).
:::

## El costo por pregunta {The cost per question}

El socio entiende mejor un número chico que uno grande. El [[costo-por-pregunta|costo por pregunta]] es el costo de un mes dividido entre las preguntas que se hicieron ese mes. Pone opciones con estructuras distintas (una que cobra por token, otra por hora, otra por mes) en la misma unidad.

:::formula Costo por pregunta y utilización
c_q = frac{C}{Q}
Q_{max} = frac{G × n_c × v × 3,600}{N_o} × h_u
u = frac{Q}{Q_{max}}
- C: el costo de la opción en un mes, en pesos
- Q: las preguntas que se hicieron ese mes
- c_q: el costo por pregunta, en pesos
- G: las GPUs; n_c: las conversaciones que cada una atiende a la velocidad prometida (2 por L40S, la ficha)
- v: la velocidad prometida, en tokens/s (20); N_o: los tokens de una respuesta (500)
- h_u: las horas de uso al mes (220 = 10 h × 22 días)
- Q_{max}: las preguntas que caben en el mes a la velocidad prometida
- u: la [[utilizacion-del-servidor|utilización del servidor]], la parte de su capacidad que se usa
:::

:::cuenta El despacho, pregunta por pregunta
Propio, \(c_q\) // \(C\) ≈ MXN 54,153; \(Q\) = 66,000 | 54,153 ÷ 66,000 | **≈ MXN 0.82**
Solo la luz del propio // la cuenta de la ficha | 4,825 ÷ 66,000 | ≈ MXN 0.07
API de Qwen3 32B // ≈ MXN 807 al mes | 807 ÷ 66,000 | ≈ MXN 0.012
Capacidad, \(Q_{max}\) // \(G\) = 3, \(n_c\) = 2, \(v\) = 20, \(N_o\) = 500, \(h_u\) = 220 | 3 × 2 × 20 × 3,600 ÷ 500 × 220 | 190,080 preguntas
Utilización, \(u\) | 66,000 ÷ 190,080 | ≈ 35 %
Propio lleno, \(C ÷ Q_{max}\) | 54,153 ÷ 190,080 | ≈ MXN 0.28
= Cada pregunta del propio cuesta ≈ 82 centavos, ≈ 67 veces la API del mismo modelo. Lleno en horario costaría ≈ 28 centavos: todavía 23 veces la API. El propio cuesta casi lo mismo con cualquier uso; lo que baja con el uso es lo que cuesta cada pregunta.
:::

Dos notas sobre esa cuenta.

**La utilización baja no es un error de diseño.** El servidor se dimensiona para la **hora pico** (2.5 veces el promedio), no para el promedio del día; fuera de la pico sobra. Y el 35 % es contra el horario de oficina: contra las 730 horas del mes, sería ≈ 10 %. Una GPU propia prendida de noche sin trabajo no cuesta casi nada de más (algo de luz); una rentada prendida de noche, sí.

**El costo que de verdad importa es por pregunta que cumple.** [Pruebas de carga](/pruebas-carga/) definió el [[goodput]]: las preguntas que llegan a tiempo, con TTFT ≤ 2 s y ≥ 20 tokens/s. Una pregunta que llega tarde se pagó igual. La cuenta ilustrativa de esa lección da, con 3 L40S en la hora pico, un goodput de ≈ 0.06 por segundo de las 0.21 que llegan: ≈ 29 %. Si solo cumpliera esa parte, cada pregunta que cumple costaría ≈ MXN 0.82 ÷ 0.286 ≈ **MXN 2.87**. Es una cota pesimista (fuera de la hora pico hay menos fila y cumplen más), pero muestra lo que importa: **el propio de 3 L40S es barato por pregunta y caro por promesa cumplida.** El de 4 L40S cuesta ≈ MXN 0.88 por pregunta y, si la prueba confirma que cumple, puede salir más barato por pregunta que cumple. El número que va a la propuesta sale de la prueba medida, no de esta cuenta.

:::calculadora costo-total-pregunta
Arranca con el despacho: 3 L40S, 66,000 preguntas al mes, Qwen3 32B por API. La calculadora le suma a la API sus 8 horas de TI, así que el propio sale ≈ 21 veces la API y no las ≈ 67 de arriba, que comparan solo los tokens; pon las horas de TI de la API en 0 y vuelven las 67. Cambia la API a Claude Sonnet 5.5 y sube las preguntas hasta que el propio salga más barato. Pon 730 horas de uso para ver una fábrica que trabaja todo el día.
:::

## El punto de equilibrio con las opciones de verdad {Break-even against the real options}

El [[punto-de-equilibrio|punto de equilibrio]] es el uso, o el mes, en que dos opciones cuestan lo mismo. La herramienta tiene las tres fórmulas; aquí se aplican a los números del despacho y se leen.

:::formula Los tres equilibrios
Q^{*} = Q × frac{P}{A}
m^{*} = frac{K_{tot}}{R − O_{mes}}
h^{*} = frac{P − H}{G × c}
- Q: las preguntas al mes de hoy; P: el propio al mes; A: la API al mes con \(Q\)
- Q^{*}: las preguntas al mes en que la API cuesta lo mismo que el propio
- K_{tot}: lo que se paga al comprar (servidor, UPS y obra)
- R: la renta al mes; O_{mes}: lo que el propio paga cada mes (luz y personas)
- m^{*}: los meses en que lo que el propio ahorra de renta paga la compra; si \(R ≤ O_{mes}\), nunca
- H: las personas al mes del propio; G: las GPUs; c: la renta por GPU y hora
- h^{*}: las horas de renta al mes a partir de las que comprar sale más barato
:::

:::cuenta Los equilibrios del despacho, en US$
Contra Qwen3 32B por API, \(Q^{*}\) // \(P\) = 2,746; \(A\) = 40.9 | 66,000 × 2,746 ÷ 40.9 | ≈ 4.4 millones de preguntas al mes (67×)
Lo que haría falta para atenderlas // contra 190,080 en horario o 630,720 las 24 horas | 4,430,000 ÷ 630,720 a 4,430,000 ÷ 190,080 | de 7 a 23 servidores
Contra Kimi K3 en México, \(Q^{*}\) // \(A\) = 1,851 | 66,000 × 2,746 ÷ 1,851 | ≈ 98 mil (1.5×)
Contra Sonnet 5.5, \(Q^{*}\) // \(A\) = 1,122 | 66,000 × 2,746 ÷ 1,122 | ≈ 161.5 mil (2.45×)
Contra la renta de 3 L40S 24/7, \(m^{*}\) // \(K_{tot}\) = 82,783; \(R\) = 2,830; \(O_{mes}\) = 820 | 82,783 ÷ (2,830 − 820) | ≈ 41.2 meses
Horas de renta del equilibrio, \(h^{*}\) // \(H\) = 575, \(c\) = 1.09 | (2,746 − 575) ÷ (3 × 1.09) | ≈ 664 h (91 % del mes)
= Contra el mismo modelo por API, el propio no se cruza nunca: haría falta 67 veces el uso y, para atenderlo, de 7 a 23 servidores, cada uno con su costo. Contra modelos caros cruza entre 1.5 y 2.45 veces el uso de hoy. Contra rentar lo mismo, la compra se paga en el mes 42: después de su vida contable.
:::

:::figura costo-total-curvas
Las opciones como curvas de costo contra uso. El propio y la renta 24/7 son casi planos; las APIs son rectas que salen de cero, con pendiente según su precio. El despacho, a 66 mil preguntas, está a la izquierda de todos los cruces.
:::

Tres lecturas de la figura.

**Contra el mismo modelo, no hay cruce que buscar.** La API de Qwen3 32B cuesta US$41 al mes; el propio paga solo de luz y personas ≈ US$820. Aunque el servidor fuera gratis, perdería. Por eso \(m^{*}\) frente a esa API es «nunca».

**Contra un modelo caro, el cruce existe, pero el despacho no está ahí.** Con un modelo cerrado como Sonnet, el uso tendría que crecer 2.45 veces. Y ojo con el tope: el servidor de 3 L40S atiende ≈ 190 mil preguntas al mes en horario, así que el cruce con Sonnet (≈ 161.5 mil) queda apenas antes de que haga falta otro servidor.

**Contra rentar lo mismo, casi empatan, y el tiempo decide.** El propio ahorra ≈ US$2,010 al mes de renta (2,830 − 820), y la compra de ≈ US$82,783 tarda ≈ 41 meses en pagarse. Si el servidor dura 36, rentar gana por poco; si dura 5 años, comprar gana por bastante. Con 4 L40S contra 4 rentadas, la compra se paga antes, en ≈ 33 meses: cada GPU rentada de más cuesta ≈ US$796 al mes y comprada, ≈ US$8,910 una vez.

:::diagrama costo-total-cruces
El servidor propio en el centro y, a cada lado, contra qué se compara. Cada flecha dice dónde se cruzan: en preguntas al mes (las APIs) o en meses (las rentas). Sigue el recorrido.
:::

## Qué supuesto mueve más: el análisis de sensibilidad {Which assumption moves the answer: sensitivity analysis}

Cada número de este TCO tiene un supuesto detrás. El [[analisis-de-sensibilidad|análisis de sensibilidad]] mueve **uno a la vez**, a un valor bajo y a uno alto razonables, y mide cuánto cambia el resultado. Los que más lo mueven son los que hay que cotizar, medir o discutir con el cliente; los que casi no lo mueven se pueden dejar como están.

:::analogia El presupuesto de una boda
Antes de firmar el salón, te preguntas: ¿y si vienen 50 invitados más?, ¿y si el banquete sube 10 %?, ¿y si llueve y hay que rentar carpa? Cambias una cosa a la vez y ves cuál revienta el presupuesto: casi siempre son los invitados, no las flores. Dónde se rompe: en una boda, invitados y banquete se mueven juntos (más gente, más platos), y en un TCO también hay supuestos que se mueven juntos; el tornado los mueve por separado (el recuadro de abajo dice qué hacer).
:::

El resultado que se mide aquí es la diferencia al mes entre el propio y la renta de las mismas 3 L40S todo el mes: la comparación más pareja que hay. En la base, el propio sale **US$83 al mes** más barato (−83).

| # | Supuesto (bajo / alto) | Diferencia con el bajo | Con el alto | Rango |
|---|---|---|---|---|
| 1 | Vida útil: 24 / 60 meses | +880 | −854 | **1,734** |
| 2 | Reventa: 0 % / 50 % | +290 | −643 | 933 |
| 3 | Horas de TI del propio: 104 / 26 al mes | +492 | −371 | 863 |
| 4 | Precio del hardware: +15 % / −15 % | +141 | −307 | 448 |
| 5 | Personas en las dos: ×2 / ×0.5 | +49 | −150 | 199 |
| 6 | Luz: +25 % / −25 % | −22 | −145 | 122 |
| 7 | Dólar: 17.75 / 21.69 pesos | −21 | −134 | 113 |

:::figura costo-total-tornado
La misma tabla como gráfica de tornado: una barra por supuesto, ordenadas de la más larga a la más corta. Azul, hacia donde comprar sale más barato; naranja, hacia donde rentar sale más barato. La línea punteada es la base.
:::

La forma le da el nombre: ordenadas de mayor a menor, las barras parecen un tornado. Se lee así:

- **Las tres primeras pesan de 7 a 15 veces más que la luz o el dólar.** Vida útil, reventa y horas de TI deciden la comparación. Las tres son supuestos, no precios: ninguna se cotiza, todas se discuten.
- **El precio del hardware está en medio.** Una cotización 15 % mejor mueve ≈ US$224 al mes en promedio: vale la pena negociar, pero no decide.
- **La luz y el dólar casi no mueven la comparación**, por mucho que preocupen. La luz es chica; el dólar mueve las dos opciones en la misma dirección.
- **Una fila no está en la tabla porque no es del mismo tamaño**: apagar la renta fuera de horario (220 horas en vez de 730) baja la renta a ≈ US$1,162 al mes y deja al propio US$1,584 más caro. Rentar en horario gana por mucho, si se pudiera hacer: prender un modelo de 32 mil millones tarda minutos, la GPU puede no estar disponible al día siguiente, y la base de vectores y los pesos se vuelven a cargar.

Y falta el supuesto más grande de todos, el que no cabe en un tornado porque no mueve al propio: **el uso**. El propio cuesta casi lo mismo con 20 mil preguntas que con 190 mil; la API cuesta exactamente proporcional. Si el uso real del despacho resulta la mitad de lo previsto, el propio sigue costando ≈ US$2,746 y cada pregunta cuesta el doble.

:::calculadora costo-total-sensibilidad
Arranca con la vida útil a −33 % (≈ 24 meses, la punta derecha de la barra de arriba del tornado): la compra no se paga antes de que termine su vida. Súbela a +50 % (54 meses) y la respuesta cambia. Luego elige otro supuesto y arma tus propias barras con −20 % y +20 %.
:::

:::ojo
Mover los supuestos **uno a la vez** subestima el riesgo cuando se mueven juntos. Una vida útil corta suele venir con una reventa baja (salió una GPU mucho mejor): las dos barras malas a la vez dejan al propio ≈ US$1,440 al mes más caro que la renta. El tornado dice cuáles importan; el peor caso se arma con las que se mueven juntas.
:::

## El valor del dinero en el tiempo {The time value of money} [extra]

Hasta aquí se sumaron pesos de meses distintos como si valieran lo mismo. No valen lo mismo: un peso hoy vale más que un peso dentro de un año, porque hoy se puede invertir, o pagar una deuda, o hacer crecer el negocio. Comprar el servidor es pagar casi todo **hoy**; rentarlo es pagar **después**. Para compararlos bien hay que llevar los pagos al mismo momento.

:::analogia Meses sin intereses
Una tienda ofrece una laptop de MXN 36,000 de contado o en 12 meses sin intereses de MXN 3,000. Suman lo mismo, pero casi todos prefieren los meses: el dinero que no pagas hoy se queda en tu cuenta, o paga otra cosa, mientras tanto. A la tienda le conviene igual porque ella cobra el interés por otro lado. Rentar GPUs es pagar a meses; comprar es pagar de contado. Dónde se rompe: los meses sin intereses fijan el pago; la renta de una GPU puede subir o bajar cada mes, y el tipo de cambio también.
:::

La [[tasa-de-descuento|tasa de descuento]] es cuánto vale para el despacho tener el dinero un año antes: el rendimiento que dejaría de ganar, o el interés que dejaría de ahorrarse. El [[valor-presente|valor presente]] de un pago futuro es ese pago traído a hoy con la tasa.

:::formula Valor presente de una serie de pagos
r_m = (1 + r)^{1/12} − 1
VP = sum_{t=0}^{n} frac{f_t}{(1 + r_m)^t}
- r: la tasa de descuento anual
- r_m: la misma tasa, por mes
- f_t: lo que se paga en el mes \(t\) (\(t\) = 0 es hoy)
- n: los meses de la cuenta
- VP: lo que vale hoy toda la serie de pagos
:::

¿Qué tasa? Hay tres referencias, y cada una responde una pregunta distinta:

- **La tasa sin riesgo**: lo que pagaría un instrumento del gobierno. El Banco de México bajó su tasa objetivo a **6.25 %** el 5 de noviembre de 2026 (vigente desde el 6); la TIIE a 28 días (la tasa de referencia de los préstamos entre bancos, que usan muchos créditos) estaba en **6.5147 %** el 13 de noviembre de 2026.
- **La tasa real**: descontando la inflación (3.62 % general en la primera quincena de octubre de 2026), ≈ 2.5–2.8 %. Es la que se usa si toda la cuenta está en pesos de hoy, sin inflación.
- **El [[costo-de-oportunidad|costo de oportunidad]]**: lo que el despacho ganaría si en vez de comprar un servidor de US$83 mil lo pusiera en su negocio (contratar a un asociado, abrir una oficina). Suele ser más que la tasa sin riesgo. Esta lección usa **10 % y 15 % como supuestos**, para ver la sensibilidad, no como datos.

:::cuenta Comprar o rentar, en valor presente (US$, 36 meses)
Tasa mensual, \(r_m\) // \(r\) = 10 % anual | 1.10^(1/12) − 1 | 0.797 % al mes
Renta del mes 1, traída a hoy // US$2,830 | 2,830 ÷ 1.00797 | US$2,808
Renta del mes 36, traída a hoy | 2,830 ÷ 1.00797^36 | US$2,126
Propio sin descontar // compra el mes 0, luz y TI cada mes, reventa el mes 36 | 82,783 + 36 × 820 − 13,438 | US$98,859
Renta sin descontar | 36 × 2,830 | US$101,863
Propio en valor presente, \(VP\) // casi todo se pagó en el mes 0 | suma con \(r_m\) | US$98,255
Renta en valor presente, \(VP\) | suma con \(r_m\) | US$88,243
= Sin descontar, el propio gana por US$3,004. A 10 %, la renta gana por US$10,012. El propio paga ≈ 74 % de lo suyo (antes de la reventa) el día uno, así que descontar casi no lo toca; la renta se paga en 36 partes, y descontar la abarata.
:::

| Tasa anual | Propio (VP) | Renta 24/7 (VP) | Gana | El propio alcanza a la renta en el mes |
|---|---|---|---|---|
| 0 % | US$98,859 | US$101,863 | Propio, por 3,004 | 42 |
| 6.25 % (Banxico) | US$98,497 | US$92,902 | Renta, por 5,596 | 47 |
| 10 % (supuesto) | US$98,255 | US$88,243 | Renta, por 10,012 | 51 |
| 15 % (supuesto) | US$97,915 | US$82,721 | Renta, por 15,194 | 57 |

La última columna cuenta sin reventa, como si el servidor se quedara a trabajar: el mes en que el acumulado del propio, descontado, deja de ser mayor que el de la renta. A cualquier tasa razonable, **comprar solo gana si el servidor trabaja bastante más de 3 años**. Con la reventa incluida, a 0 % el propio queda por debajo de la renta justo en el mes 36, el mes en que se vende. El despacho no compra para ahorrar contra la renta: compra porque la renta saca sus expedientes del país. El valor presente le dice cuánto cuesta esa decisión: entre US$5,600 y 15,200 en 3 años, según la tasa.

El programa hace las tres opciones mes a mes, en pesos, con el tipo de cambio, la tasa y la reventa, y busca el mes en que el propio alcanza a la renta. Solo usa la biblioteca estándar de Python:

```python
FX = 19.7203                    # pesos por dólar (FIX de Banxico, 26-nov-2026)
TASA = 0.10                     # tasa de descuento anual (supuesto)
r = (1 + TASA) ** (1 / 12) - 1  # la misma tasa, por mes
HORA_TI = 218.1                 # pesos por hora de TI (supuesto)

def propio(meses, reventa=0.20):            # pesos de cada mes; el mes 0 es la compra
    f = [(67_191.30 + 9_000) * FX + 130_000]   # servidor, UPS y obra del cuarto
    f += [4_825 + 52 * HORA_TI] * meses        # luz y 52 h de TI al mes
    f[meses] -= 67_191.30 * FX * reventa       # al final se vende el servidor
    return f

def renta(meses):                            # 3 L40S rentadas 24/7 y 40 h de TI
    return [0] + [3 * 1.09 * 730 * FX + 40 * HORA_TI] * meses

def api(meses):                              # Qwen3 32B por API y 8 h de TI
    return [0] + [40.9 * FX + 8 * HORA_TI] * meses

def vp(flujo):                               # valor presente acumulado, mes a mes
    total, curva = 0.0, []
    for t, f in enumerate(flujo):
        total += f / (1 + r) ** t
        curva.append(total)
    return curva

for nombre, opcion in (("propio", propio), ("renta", renta), ("API", api)):
    print(f"{nombre:>6}: VP a 36 meses = {vp(opcion(36))[-1]:>12,.0f} pesos")
p, q = vp(propio(60, 0.0)), vp(renta(60))     # 60 meses, sin vender
print("el propio alcanza a la renta en el mes", next((t for t in range(61) if p[t] <= q[t]), "nunca"))
```

```salida
propio: VP a 36 meses =    1,937,578 pesos
 renta: VP a 36 meses =    1,740,152 pesos
   API: VP a 36 meses =       79,568 pesos
el propio alcanza a la renta en el mes 51
```

Fíjate que el programa **no tiene depreciación**: mira el dinero que sale cada mes (el flujo de caja), y la compra sale entera el mes 0. La depreciación es la forma contable de repartir esa misma compra; las dos cuentas llegan al mismo total sin descontar, y el valor presente solo tiene sentido sobre el flujo. Cambia `TASA` a `0.0625` o a `0.0` y mira cómo el mes de cruce baja a 47 y a 42.

## Cómo se le dice al cliente {How to tell the client}

La cuenta está hecha. Falta decirla, y es donde más se equivoca quien vende servidores: escondiendo que la API gana.

### Si en dinero la API gana, se dice

Al socio director se le contesta con su pregunta, en este orden:

1. **Cuánto cuesta al año de verdad.** ≈ MXN 650 mil al año (≈ US$33 mil) con 3 L40S: compra repartida, cuarto, luz y personas, antes de impuestos; ≈ MXN 2.31 millones en 3 años con el piloto, la prueba y el examen. Con 4 L40S, ≈ MXN 2.45 millones. Como rango, con la fecha y el tipo de cambio.
2. **Si le saldría más barato pagarle a un tercero.** Sí. El mismo modelo por API costaría ≈ MXN 800 al mes. Si su único criterio fuera el costo, no debería comprar.
3. **Qué paga con la diferencia.** Que ningún expediente salga de su red: ≈ MXN 53 mil al mes, ≈ 81 centavos por pregunta. Es lo que vale para él cumplir el secreto profesional, la ley de datos personales y los contratos de los clientes que lo prohíben. Esa decisión es suya, no del proveedor.
4. **Por qué no la nube en México.** AWS y Google no tienen GPUs en su región mexicana; Azure tiene un solo tipo de máquina para esto, de 8 H200, a ≈ US$34 mil al mes con reserva. Rentar GPUs en EE. UU. saca los datos del país y cuesta casi lo mismo que comprar.
5. **Qué supuestos mueven la cuenta.** Vida útil, reventa y horas de TI. El tipo de cambio, que tanto preocupa, mueve ≈ ± 6 % del total.

Decir «la API gana» no debilita la propuesta: la hace creíble. Un cliente que descubre solo que le escondieron la cuenta de la API ya no cree ninguna otra cifra.

### Cuándo NO conviene IA privada

Lo honesto es también saber cuándo decir que no. Con los números de esta lección:

- **Sin obligación de privacidad.** Si los datos pueden salir, el mismo modelo por API cuesta ≈ 67 veces menos. No hay cuenta que lo voltee.
- **Uso bajo.** Contra un modelo cerrado caro, el propio empieza a ganar cerca de ≈ 100–160 mil preguntas al mes con preguntas como las del despacho. Con 10 mil preguntas al mes, cada pregunta del propio costaría ≈ MXN 5.4.
- **Sin TI.** Si nadie puede darle ≈ 12 horas a la semana y hay que contratar una persona completa, el propio sube ≈ 49 %. Si tampoco hay presupuesto para un contrato de operación, el proyecto falla después de instalado, no antes.
- **Plazo corto o incierto.** Si el uso se va a decidir en 6 meses, rentar como puente (12 semanas de L40S ≈ US$6,592, la cuenta de [Comprar hardware](/comprar-hardware/)) es más barato que comprar y vender.
- **Vida útil esperada menor a 3 años**, o precios de GPU bajando rápido: la primera barra del tornado se va en contra.

## Errores comunes {Common mistakes}

1. **Esconder que la API gana.** Comparar el propio contra un modelo cerrado caro, o contra la nube más cara, para que salga ganando. **Cómo evitarlo:** el competidor justo en dinero es el mismo modelo por API; pon su número en la primera página y explica por qué no sirve.
2. **Poner solo la tarjeta.** «3 L40S son US$27 mil» deja fuera la base del servidor (US$40,461), el UPS y la obra: el propio parece la mitad de caro. **Cómo evitarlo:** la cotización completa del integrador, más el cuarto, más lo de decidir.
3. **Personas en cero.** «El TI ya está pagado.» Sus horas ya no hacen otra cosa. **Cómo evitarlo:** horas al mes × costo de la hora con prestaciones; si no hay quién, el costo de una persona o de un contrato.
4. **Confundir deducir con no pagar.** «Se deduce, así que sale gratis.» El escudo recupera ≈ 26–28 centavos de cada peso, no el peso, y la renta también se deduce. **Cómo evitarlo:** compara antes de impuestos y deja la deducción como nota para el contador.
5. **Mezclar la vida fiscal, la contable y la económica.** Depreciar 3.33 años porque «así dice la ley», o 5 porque «aguanta». **Cómo evitarlo:** 36 meses en la cuenta, la vida fiscal para el escudo, y la vida económica en el análisis de sensibilidad.
6. **Dividir entre la capacidad, no entre el uso.** «El propio sale a 28 centavos por pregunta» es lleno; el despacho lo usa al 35 %. **Cómo evitarlo:** costo del mes entre las preguntas que de verdad se hacen, y después entre las que cumplen la promesa.
7. **Un solo número, sin fecha ni tipo de cambio.** Los precios de GPU y de API cambian cada pocas semanas, y el dólar subió 6.8 % en poco más de una. **Cómo evitarlo:** rango, fecha de cada precio y tipo de cambio de la conversión, en la misma tabla.

## En la vida real {In real life} [extra]

**El despacho.** Servidor propio de 3 L40S: ≈ US$2,746 al mes (≈ MXN 54 mil), ≈ MXN 2.31 millones en 3 años con lo de decidir, ≈ MXN 0.82 por pregunta; con 4 L40S, ≈ US$2,944 y MXN 0.88. La API del mismo modelo costaría US$41 al mes y no se cruza nunca; contra rentar las mismas GPUs en EE. UU. casi empata, y a cualquier tasa de descuento razonable la renta gana en 3 años. Compra porque sus expedientes no pueden salir de su red. La propuesta lleva el rango, la fecha de cada precio, el tipo de cambio, los tres supuestos que mueven la cuenta y la nota fiscal.

**Una startup cuyo uso crece 10 % al mes.** Supuesto del ejemplo: una empresa con un asistente propio, con preguntas como las del despacho, usa hoy un modelo cerrado tipo Sonnet y crece 10 % cada mes. Un servidor como el del despacho empata con esa API a ≈ 161.5 mil preguntas al mes. Si hoy hace 10 mil, llega ahí en ≈ 29 meses (\(log(16.15) ÷ log(1.1)\)), y a la capacidad del servidor en horario (≈ 190 mil) en ≈ 31: apenas empata y ya le falta servidor. Si hace 20 mil, llega en ≈ 22 meses. La regla: **comprar cuando el uso ya pasó el equilibrio y se ve estable**, no cuando se espera que llegue; mientras, API o renta. Y si un modelo abierto le basta, por API nunca le conviene comprar.

**Una fábrica que trabaja las 24 horas.** Supuesto del ejemplo: un asistente para los turnos de una planta, con preguntas del mismo tamaño, que llena el servidor todo el día: 864 preguntas por hora × 730 horas ≈ 630 mil al mes. El mismo servidor sale a ≈ US$0.0044 por pregunta (la luz real sería algo mayor, porque la de la ficha cuenta 510 horas de reposo). Contra un modelo cerrado a US$0.017 por pregunta, el propio gana fácil: ≈ 3.9 veces menos. Contra Qwen3 32B por API, US$0.00062, todavía pierde por ≈ 7 veces. Aun lleno, el propio gana contra modelos caros, no contra el mismo modelo abierto.

**Fuera de las computadoras: la copiadora de la oficina.** Muchas oficinas no compran su copiadora: la rentan con un costo por página, que incluye el tóner y el técnico. Comprarla conviene si imprimes mucho y tienes quién la arregle; rentarla, si imprimes poco o no quieres saber nada de rodillos. Es la misma cuenta: costo fijo contra costo por unidad, con las personas adentro. Dónde se rompe: una copiadora no guarda los secretos del cliente ni se vuelve obsoleta en 3 años, y nadie le pregunta a la copiadora si la página sale del país.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Con 4 L40S, el propio cuesta ≈ US$2,944 al mes. ¿Cuánto cuesta cada pregunta del despacho, en pesos, al tipo de cambio de 19.7203?
\(c_q = C ÷ Q\) = 2,944 × 19.7203 ÷ 66,000 ≈ **MXN 0.88** por pregunta, 6 centavos más que con 3 L40S. Si la cuarta L40S es la que hace que el TTFT cumpla, esos 6 centavos compran la promesa.
? [facil] ¿Cuánto es la depreciación lineal al mes del servidor de 4 L40S (US$76,101.30), con 36 meses y 20 % de reventa?
\(D = K × (1 − v_r) ÷ V\) = 76,101.30 × 0.8 ÷ 36 ≈ **US$1,691 al mes**, US$198 más que con 3 L40S (≈ US$1,493): la cuarta tarjeta, sin el UPS ni la obra.
? [facil] Si el sueldo del TI fuera MXN 32,000 (el tope de las vacantes), ¿cuánto costaría una hora con el factor de 1.35, y cuánto las 52 horas al mes, en pesos y en dólares?
\(w = s × f ÷ h_{mes}\) = 32,000 × 1.35 ÷ 173.3 ≈ **MXN 249.3** la hora. 52 h × 249.3 ≈ **MXN 12,962** al mes ≈ US$657, contra US$575 con el sueldo de 28,000: US$82 más al mes.
? [facil] ¿Cuánto se deduce del servidor de 3 L40S cada año con el 30 % del artículo 34 de la LISR, y cuánto ISR deja de pagar el despacho cada año, si tributa al 30 %?
Compra en pesos: 67,191.30 × 19.7203 = MXN 1,325,033. Deducción de los años 1 a 3: 0.30 × 1,325,033 = **MXN 397,510** cada año (y 132,503 en el año 4). ISR que deja de pagar: 0.30 × 397,510 = **MXN 119,253** al año (39,751 en el año 4).
? [medio] El dólar sube 10 %, de 19.7203 a 21.69, justo antes de pagar el servidor. ¿Cuántos pesos más cuesta la compra del servidor? ¿Y la renta de las 3 L40S en un año, si el dólar se queda ahí?
Compra: 67,191.30 × (21.69 − 19.7203) ≈ **MXN 132,347** más (≈ 1.46 millones en vez de 1.33). Renta: 3 × 1.09 × 730 = US$2,387.1 al mes; × 12 × (21.69 − 19.7203) ≈ **MXN 56,422** más en un año, y cada año siguiente otro tanto. En 3 años la renta pierde ≈ MXN 169 mil por el mismo 10 %: más que la compra, porque paga el dólar caro 36 veces.
? [medio] El despacho cambia la comparación a Claude Haiku 5.5 (US$0.10 por millón de entrada y US$0.50 de salida, 2026-11-25). ¿Cuánto cuesta la API al mes con sus 396 y 33 millones de tokens? ¿A qué uso se cruzaría con el propio? ¿Se recupera alguna vez la compra?
\(A\) = 396 × 0.10 + 33 × 0.50 = 39.6 + 16.5 = **US$56.1** al mes. \(Q^{*} = Q × P ÷ A\) = 66,000 × 2,746 ÷ 56.1 ≈ 3.2 millones de preguntas al mes (≈ 49×), muy por arriba de lo que cabe en un servidor. La compra **nunca** se recupera: US$56.1 no paga ni la luz y las personas del propio (≈ US$820).
? [medio] Si el despacho rentara las 3 L40S solo 220 horas al mes (en horario), con sus 40 horas de TI, ¿cuánto pagaría al mes y cuánto más caro sale el propio? ¿Por qué la lección no toma esa opción?
\(R\) = 3 × 1.09 × 220 + 40 × 11.06 ≈ 719 + 442 = **US$1,162** al mes. El propio (US$2,746) sale **≈ US$1,584 más caro**. No se toma porque prender y apagar un modelo de 32 mil millones tarda minutos, la GPU puede no estar disponible al día siguiente, hay que volver a cargar los pesos y la base de vectores, y los expedientes salen del país de todos modos.
? [medio] La renta de las 3 L40S en pesos es ≈ MXN 55,798 al mes. ¿Cuánto valen hoy 36 de esos pagos con una tasa de 10 % anual? ¿Cuánto «se ahorra» contra pagarlos sin descontar?
\(r_m\) = 1.10^(1/12) − 1 ≈ 0.797 %. \(VP = f × (1 − (1 + r_m)^{−36}) ÷ r_m\) = 55,798 × (1 − 1.00797^−36) ÷ 0.00797 ≈ **MXN 1,740,152**, contra 36 × 55,798 ≈ MXN 2,008,740 sin descontar: ≈ **MXN 268,600** menos, el 13 %. Es el número que sale en el programa de la lección para la renta.
? [reto] Una startup hace hoy 10,000 preguntas al mes, como las del despacho, con un modelo cerrado tipo Sonnet, y crece 10 % al mes. ¿En qué mes cruza el equilibrio de ≈ 161,534 preguntas? ¿En qué mes llena un servidor de 3 L40S en horario (190,080)? ¿Cuándo le recomendarías comprar?
Crece como \(Q_t = Q_0 × 1.1^t\). Equilibrio: \(t = log(161,534 ÷ 10,000) ÷ log(1.1)\) ≈ **29.2 meses**. Capacidad: \(log(190,080 ÷ 10,000) ÷ log(1.1)\) ≈ **30.9 meses**. Entre cruzar y llenarlo hay menos de 2 meses: si compra en el equilibrio, en dos meses necesita otro servidor. Recomendación: seguir con API (o con renta) hasta que el uso se estabilice arriba del equilibrio, y comprar para el uso de ese momento con margen, no para el de hoy. Y si un modelo abierto le basta, por API nunca le conviene comprar.
? [reto] El despacho consigue la constancia del Plan México: deduce 85 % el año 1 y el 15 % que falta en el año 4. Con tasa de 10 %, ¿cuánto vale el escudo comparado con el 30 % anual (MXN 323,715 a esa tasa)? ¿Vale la pena el trámite?
Año 1: 0.30 × 0.85 × 1,325,033 ÷ 1.10 ≈ MXN 307,167. Año 4: 0.30 × 0.15 × 1,325,033 ÷ 1.10⁴ ≈ MXN 40,725. Total ≈ **MXN 347,892** (≈ 26.3 % de la compra), contra 323,715: **≈ MXN 24,200 más** (≈ US$1,226). Vale la pena solo si el trámite (proyecto de inversión, constancia del Comité, mantenerlo 2 años) cuesta menos que eso en horas del contador y del despacho. No cambia qué opción gana.
:::

## Lo que sigue {What comes next} [extra]

- **[Cotizar, proponer y dar soporte](/cotizar/)** convierte esta cuenta en una propuesta: el rango de costo con su fecha y tipo de cambio, lo que se cobra por instalar y operar, el [[contrato-de-servicios|contrato de soporte]] que reemplaza o complementa las 52 horas de TI, y lo que esta cuenta dejó fuera de la compra: el flete, el [[arancel|arancel]] y la [[importacion|importación]] del servidor a México.
- **[Observabilidad de GPUs e inferencia](/observabilidad/)** y **[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)** dicen qué hace el TI en sus horas al mes: vigilar la GPU y el motor, aplicar [[parche|parches]] en [[ventana-de-mantenimiento|ventanas de mantenimiento]]. Si esas lecciones piden más horas que las 52 supuestas, la tercera barra del tornado se mueve.
- De esta app: la herramienta [API, nube o servidor propio](/herramientas/tco/) para hacer la cuenta rápida con otros números; [Comprar hardware](/comprar-hardware/), la cotización del servidor y el puente de renta; [El cuarto](/el-cuarto/), la luz y el plan del UPS y del aire; [Pruebas de carga](/pruebas-carga/), el goodput que convierte el costo por pregunta en costo por pregunta que cumple; [Demostrar que el modelo abierto sirve](/evals/), el examen que decide si Kimi K3 u otro modelo serían una opción de verdad.
- En Sensei: [Qué es la nube](https://sensei.trueml.app/nube/) (comprar o rentar, CapEx y OpEx) y [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/) (GPU-hora, spot y compromisos, que bajan la renta si el despacho la usara como puente largo).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
vida-util valor-de-reventa depreciacion-acelerada deduccion-fiscal escudo-fiscal iva-acreditable tipo-de-cambio costo-por-pregunta utilizacion-del-servidor analisis-de-sensibilidad tasa-de-descuento valor-presente costo-de-oportunidad
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué el servidor del despacho cuesta ≈ US$2,746 al mes y no los ≈ US$2,303 de la herramienta?
Porque la herramienta usa un servidor supuesto de US$15,000 y esta lección la cotización real del Exxact (US$67,191.30 con 3 L40S), y además suma el UPS, la obra del cuarto, la luz con la tarifa de CFE y 52 horas de TI en pesos.
? ¿Cuáles son las tres vidas de un servidor y cuál usa la cuenta?
La contable (36 meses en los libros, la de la cuenta), la fiscal (30 % al año por la LISR, ≈ 3.33 años, para el escudo) y la económica (cuándo conviene reemplazarlo, que va al análisis de sensibilidad).
? ¿Por qué los impuestos casi no cambian qué opción gana?
Porque la renta y la API también se deducen. El escudo del servidor recupera ≈ 26–28 centavos de cada peso según la tasa, el mismo orden que el de un gasto mensual; diferir la deducción le cuesta al despacho ≈ MXN 25,640 de valor presente.
? Contra el mismo modelo por API, ¿en qué uso se cruza el propio, y por qué la respuesta es «nunca»?
Haría falta ≈ 67 veces el uso de hoy (≈ 4.4 millones de preguntas al mes), que pide de 7 a 23 servidores; y con el uso de hoy, la API (US$41) no paga ni la luz y las personas del propio (≈ US$820), así que la compra no se recupera.
? ¿Qué tres supuestos mueven más la comparación entre comprar y rentar, y cuáles casi no?
La vida útil, la reventa y las horas de TI (rangos de US$863 a 1,734 al mes); la luz y el tipo de cambio casi no (≈ US$113–122).
? ¿Por qué a una tasa de descuento de 10 % gana la renta, si sin descontar gana el propio?
Porque el propio paga ≈ 74 % de lo suyo el día uno y la renta lo reparte en 36 meses: descontar abarata los pagos futuros de la renta y casi no toca la compra.
? Si en dinero la API gana, ¿qué se le dice al cliente?
Que gana, con su número (≈ MXN 800 al mes contra ≈ MXN 54 mil), y que la diferencia es lo que cuesta que ningún expediente salga de su red; la decisión de pagarla es suya.
:::
