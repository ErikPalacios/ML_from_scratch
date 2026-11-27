---
titulo: Cotizar, proponer y dar soporte
en: Quoting, proposing and supporting
subtitulo: Qué lleva una propuesta de IA privada, cuánto se cobra y por qué, qué se puede prometer en un SLA sin mentir, qué debe decir el contrato y qué pasa con el servidor en la aduana mexicana.
pregunta: El despacho dijo que sí al piloto. Ahora hay que mandarle una propuesta con precio, firmar un contrato, traer el servidor a México y prometer un soporte que un equipo chico pueda cumplir. ¿Qué lleva la propuesta, cuánto se cobra y por qué, qué se puede prometer en un SLA sin mentir, y qué pasa con el hardware en la aduana?
sensei: privacidad, nube, regiones
---

:::idea
Vender IA privada es vender **promesas medibles**: un piloto con [[criterio-de-aceptacion|criterios de aceptación]], un precio que sale de horas contadas, un [[sla|SLA]] que el hardware y el equipo de verdad pueden cumplir, y un contrato que dice quién hace qué con los datos. El servidor es lo de menos: se compra al [[integrador]], se importa con un [[agente-aduanal|agente aduanal]] y su costo se calcula. Lo difícil es no prometer lo que una sola caja y dos personas no pueden sostener.
:::

## El despacho dijo que sí {The despacho said yes}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Son **200 personas** y **30,000 expedientes**; el equipo de TI son **2 personas** que saben de redes y Windows y nunca han operado una GPU. Lo decidido hasta aquí: Qwen3 32B en INT4 de [[awq|AWQ]] servido con [[vllm|vLLM]] 0.34.0 en **3 L40S**, una copia en cada una, dentro de un servidor Exxact TensorEX 4U con la cuarta ranura libre (**US$67,191.30** en el configurador de Exxact, el 25 de noviembre de 2026, sin impuestos). La alternativa a cotizar son **2 RTX PRO 6000 Blackwell Server Edition**. Antes de comprar, un [[prueba-piloto|piloto]] de **8 semanas** con **20 abogados** en una GPU rentada de la semana 2 a la 7.

En las lecciones anteriores tú eras el ingeniero que hace cuentas. En esta eres **quien vende**: el integrador o consultor que le lleva IA privada a una empresa. El socio director dijo «adelante con el piloto», y eso abre cuatro papeles:

1. **La propuesta**: qué harás, qué no, cuándo, cómo se sabe que funcionó y cuánto cuesta.
2. **El contrato**: quién responde, quién es dueño de lo construido y qué pasa con los datos.
3. **La importación**: si el servidor viene de Estados Unidos, alguien lo cruza y paga sus impuestos.
4. **El soporte**: qué se promete después, a qué horas, y qué pasa el día que falla una tarjeta.

El plan de esta app lo dice sin rodeos: el negocio **no** es revender servidores (margen bajo, capital inmovilizado, GPUs que pierden valor rápido). Es dimensionar, montar el stack, demostrar con [[eval|evals]] que sirve y mantenerlo funcionando. Todos los precios de esta lección salen de esa idea.

:::diagrama cotizar-camino
El camino de una venta de IA privada, del descubrimiento al soporte. Toca cada caja para ver qué papel sale de ahí, o sigue el recorrido del despacho.
:::

Tres cosas que Sensei explica a fondo y aquí solo se recuerdan:

- Un proveedor que trata datos personales **por cuenta** de una empresa es su **encargado**; mandarle los datos es una **remisión**, que no pide el consentimiento de las personas pero sí un contrato. Lo ves en [Datos personales y la ley](https://sensei.trueml.app/privacidad/).
- Comprar hardware es gasto de capital (*CapEx*) y rentarlo es gasto de operación (*OpEx*): pagar todo hoy contra pagar cada mes. Lo ves en [Qué es la nube](https://sensei.trueml.app/nube/).
- Un SLA de la nube promete **créditos**, no minutos, y cubre su pieza, no tu cadena. Lo ves en [Regiones, zonas y disponibilidad](https://sensei.trueml.app/regiones/).

:::ojo
Lo legal y lo fiscal de esta lección es **orientación**, con su fuente oficial y su fecha (noviembre de 2026). Las leyes mexicanas cambiaron mucho en 2025 y 2026, y varias reglas dependen de detalles de cada caso. Cada sección termina igual: **confírmalo con tu contador, tu abogado o tu agente aduanal**. Lo que sí es tuyo, y no se delega, son las cuentas.
:::

## La propuesta: un documento que se puede aceptar {The proposal: a document someone can accept}

Una [[propuesta]] (*proposal*) es el documento que le dice al cliente qué problema le vas a resolver, cómo, cuándo, por cuánto y cómo sabrán los dos que quedó resuelto. Si el cliente la firma, se vuelve la base del contrato. Una buena propuesta se puede **aceptar o rechazar punto por punto**: cada promesa tiene un número o una fecha.

:::analogia El presupuesto del carpintero
Un carpintero que va a hacer un clóset te deja un presupuesto: medidas, material, color, lo que incluye (puertas, cajones), lo que no (pintar la pared), cuándo lo entrega, cuánto de anticipo. Si al final el clóset mide lo que dice y abre como dice, se paga; si no, se corrige. Dónde se rompe: un clóset se ve terminado y se mide con un flexómetro. Un sistema de IA no: «contesta bien» no se ve a simple vista. Por eso la propuesta de IA lleva algo que el carpintero no necesita: un examen y una prueba de carga que dicen, con números, si quedó.
:::

### Las diez partes

1. **El problema, en palabras del cliente.** No «implementar un LLM con RAG», sino «algunos abogados pegan contratos en chatbots públicos y eso viola el secreto profesional». Si el cliente no se reconoce en el primer párrafo, no lee el resto.
2. **El [[alcance]]** (*scope*): la lista de lo que **sí** vas a hacer. Y, con el mismo cuidado, lo que **no**.
3. **Los [[entregable|entregables]]** (*deliverables*): las cosas concretas que el cliente recibe y puede revisar: un sistema funcionando, un informe, un manual, una capacitación.
4. **El calendario**, semana por semana, con lo que toca a cada lado.
5. **Los [[criterio-de-aceptacion|criterios de aceptación]]**: los números que dan el trabajo por terminado.
6. **Los supuestos**: si cambian, cambia el precio.
7. **Los riesgos**, y qué harías.
8. **El precio y la forma de pago.**
9. **Las opciones**, cada una con su precio y su consecuencia.
10. **La vigencia**: hasta qué fecha vale el precio.

La parte que más protege a los dos es el **«no incluye»**. Un alcance vago crece solo: «ya que estás, conéctalo al sistema documental». Cada «ya que estás» son horas sin cobrar; escrito antes, permite decir «es un cambio de alcance, te mando su precio».

### La propuesta del piloto del despacho

Todo lo de esta tabla sale de la ficha del despacho y de las lecciones anteriores; los precios, de la sección siguiente, con sus supuestos.

| Parte | Lo que dice para el despacho |
|---|---|
| Problema | 200 abogados y 30,000 expedientes (≈ 1.5 millones de páginas). Secreto profesional y la ley de datos personales; algunos clientes prohíben por contrato mandar sus documentos a terceros. Hoy hay abogados pegando contratos en chatbots públicos ([[shadow-ai]]). |
| Alcance | Piloto de 8 semanas con 20 abogados. Qwen3 32B AWQ en vLLM 0.34.0; LiteLLM 1.111.0 y Open WebUI 0.13.5 con [[sso\|SSO]] de [[entra-id\|Entra ID]]; [[rag\|RAG]] con Qwen3-Embedding-0.6B, reranker y Qdrant 1.20.2, con la [[acl-por-chunk\|ACL copiada en cada fragmento]]; examen de 200 preguntas y [[gate-de-calidad\|gate]]; [[prueba-de-carga\|prueba de carga]]; [[sizing]] rehecho con lo medido y cotización de hardware con fecha. |
| **No incluye** | El servidor. Las obras del cuarto (circuitos, UPS, aire: línea aparte, ver [El cuarto](/el-cuarto/)). Licencias de Microsoft 365 o de Entra ID. NVIDIA AI Enterprise. Escribir las 200 preguntas (≈ 133 h de los abogados). Limpiar el OCR de escaneos malos. Conectar el sistema documental del despacho. El agente de 3 tools (fase posterior). La importación. |
| Entregables | Sistema funcionando en la GPU rentada; resultados del examen de 200; informe de la prueba de carga; sizing final con lo medido; manual de operación y capacitación al TI; cotización del servidor. |
| Calendario | El de [El recorrido](/recorrido/): semana 1 descubrimiento, 2 servidor rentado y primer RAG, 3 examen, 4 prueba de carga, 5–6 uso real, 7 sizing e informe, 8 decisión. |
| Aceptación | **Calidad**: ≥ 170 de las 200 bien y con la cita correcta, y ≤ 4 con una cita inventada. **Permisos**: 0 fugas en las 20 preguntas de permisos. **Velocidad**: [[ttft\|TTFT]] p95 ≤ 2 s en carga abierta a 0.21 por segundo y [[tpot\|TPOT]] p95 ≤ 50 ms con 8 a la vez, sin errores 5xx (fallas del servidor) ni 429 (peticiones rechazadas por exceso). |
| Supuestos | 15 preguntas por persona al día, pico de 2.5 veces, ≈ 6,000 tokens de entrada y ≈ 500 de salida; un abogado enlace con 4 h a la semana; acceso a los documentos desde la semana 1; la GPU rentada en una nube con contrato de [[encargado-de-datos\|encargado]]. |
| Riesgos | La calidad del OCR; permisos mal mapeados en el sistema documental; el precio de la Server Edition (no tiene precio publicado); el [[tipo-de-cambio\|tipo de cambio]]; las reglas de exportación de chips de Estados Unidos. |
| Precio | Piloto ≈ US$27,600 + IVA en tres pagos por hito; GPU rentada aparte, a costo (≈ US$327 a 1,876 según dónde y cuántas horas); soporte mensual tras la aceptación, ≈ US$2,165 + IVA. |
| Opciones | A: 3 L40S (US$67,191.30, sin repuesto). B: 4 L40S (US$76,101.30, con repuesto, [[n-mas-1\|N+1]]). C: 1 RTX PRO 6000 Server Edition (sin repuesto; la descarta el caso). D: 2 RTX PRO 6000 Server Edition (a cotizar; ≈ US$74,779 con la tarjeta a precio de CDW). Las letras son las de [el caso del despacho](/casos/despacho/), que elige D con condiciones. |
| Vigencia | 10 días naturales, por el tipo de cambio. |

### Un criterio que la opción A no pasa

Mira la fila de aceptación con cuidado. Las cuentas de [De requisitos a hardware](/requisitos-hardware/) dicen que con las L40S el TTFT de 2 s **no se cumple**: solo el [[prefill]] de 6,000 tokens tarda ≈ 2.38 s sin nadie delante, y con la fila de la hora pico el p95 simulado sube a ≈ 3.3–4.2 s. La Server Edition, en la misma cuenta, da ≈ 1.77 s viendo la fila, y ≈ 1.94 s sumando la red y la búsqueda: cumple, pero en el filo.

La tentación es esconderlo: poner «TTFT ≤ 3 s» para que pase lo que ya cotizaste, o no poner TTFT. Las dos cosas son vender mal. La propuesta honesta dice: **el criterio es el que necesitan los abogados; con la opción A la cuenta dice que no se cumple; el piloto lo mide y decide entre A, B, C y D**. Si al final el despacho acepta 3 s porque la L40S es más barata, que sea una decisión suya, firmada, y no un número que tú bajaste para cerrar la venta.

La lección [Pruebas de carga y benchmarks honestos](/pruebas-carga/) dejó otra promesa para este papel: la propuesta final lleva **[[costo-por-pregunta|cuánto cuesta cada pregunta que cumple]]**. El [[goodput]] esperado de 3 L40S a TTFT de 2 s y TPOT de 50 ms es ≈ 0.06 por segundo, el ≈ 29 % de las 0.21 de la hora pico: en esa hora, ≈ 3 de cada 10 preguntas cumplirían la promesa completa. El costo del mes entre las que cumplen es el que se compara entre opciones; cómo se arma ese costo está en [TCO: API, nube o servidor propio](/costo-total/).

## Cuánto cobrar: el costo de una hora {What to charge: the cost of an hour}

No hay una tabla pública de tarifas de consultoría de IA en México que se pueda citar. Hay un **método**: cuánto te cuesta una hora, cuánto margen quieres y cuántas horas lleva cada parte. Los números de abajo son **supuestos del ejemplo**.

### El costo de una hora

Una persona cuesta más que su sueldo: en México, el aguinaldo es de al menos 15 días (Ley Federal del Trabajo, art. 87), las vacaciones empiezan en 12 días con prima de al menos 25 % (arts. 76 y 80), y encima van IMSS, Infonavit, retiro e impuesto sobre nómina (aquí, un supuesto de **25 %**; tu contador te da la tuya). Y no todas las horas se cobran: ventas, propuestas perdidas, administración. La fracción que sí es la **tasa facturable**; aquí, **65 %**.

:::formula El costo de una hora de trabajo
C_a = (12 S + frac{15}{30} S + frac{12}{30} S × 0.25) × (1 + c)
c_h = frac{C_a}{52 × 40 × u}
p_h = frac{c_h}{1 − m}
- S: sueldo bruto mensual, en pesos
- 15/30 S: el aguinaldo de 15 días; 12/30 S × 0.25: la prima vacacional de 25 % sobre 12 días
- c: cargas del patrón, como fracción de sueldo y prestaciones (0.25 = 25 %, supuesto)
- C_a: costo anual de la persona, cargado, en pesos
- u: tasa facturable, la fracción de las 40 horas de cada semana que se cobran
- c_h: costo de una hora cobrable, en pesos
- m: margen sobre el precio (0.40 = de cada peso cobrado, 40 centavos son ganancia)
- p_h: precio de la hora, en pesos
:::

:::cuenta El costo y el precio de una hora (supuestos del ejemplo)
Sueldo bruto mensual, \(S\) // ingeniero senior de ML o DevOps en la Ciudad de México, supuesto | — | $90,000
Sueldo, aguinaldo y prima del año // \(12 S + 15/30 S + 12/30 S × 0.25\) | 1,080,000 + 45,000 + 9,000 | $1,134,000
Costo anual cargado, \(C_a\) // cargas \(c\) = 25 %, supuesto | 1,134,000 × 1.25 | $1,417,500
Horas cobrables al año // 52 semanas × 40 h × \(u\) = 0.65 | 52 × 40 × 0.65 | 1,352 h
Costo de la hora, \(c_h\) | 1,417,500 ÷ 1,352 | ≈ $1,048 (≈ US$54)
Precio de la hora, \(p_h\) // margen \(m\) = 40 % | 1,048.45 ÷ (1 − 0.40) | **≈ $1,747 (≈ US$90)**
= Con estos supuestos, cada hora cobrada cuesta ≈ $1,048 y se vende en ≈ $1,747. Los dólares son al [[tipo-de-cambio|tipo de cambio]] de 19.3668 pesos por dólar (el de Banxico para pagos del 26 de noviembre de 2026; lo explica la sección del hardware).
:::

:::ojo
**Margen no es lo mismo que sobreprecio.** Un margen de 40 % **sobre el precio** quiere decir que de $1,747 cobrados, $699 son ganancia: precio = costo ÷ (1 − 0.40). Si en vez de eso le sumas 40 % al costo (1,048 × 1.40 = $1,468), tu margen real es de 1 − 1,048 ÷ 1,468 ≈ 29 %. Para tener 40 % de margen, el sobreprecio es de ≈ 67 %. Mucha gente confunde los dos y gana menos de lo que cree.
:::

### Las horas del piloto

El siguiente paso es contar. Las horas de cada fase son supuestos razonables para un caso así, siguiendo el calendario de 8 semanas; lo que importa es que cada una esté escrita, para que el cliente vea de dónde sale el precio y para que tú, al terminar, compares con lo que de verdad tardaste.

| Fase | Semana | Horas |
|---|---|---|
| Descubrimiento: reuniones, hoja de descubrimiento, criterio firmado | 1 | 24 |
| Sizing y cotización del hardware | 1 y 7 | 16 |
| Montar la GPU rentada y el primer RAG | 2 | 60 |
| El examen: herramientas, juez y acompañar a los abogados | 3 | 30 |
| Prueba de carga y ajuste del servidor | 4 | 24 |
| Acompañar el uso de los 20 abogados y medir | 5–6 | 24 |
| Rehacer el sizing, informe y reunión de decisión | 7–8 | 24 |
| Gestión: una reunión a la semana, reportes, correos | 1–8 | 64 |
| **Total** | | **266** |

:::cuenta El precio del piloto
Horas del piloto, \(H\) // la tabla de arriba | — | 266 h
Costo, \(H × c_h\) | 266 × 1,048.45 | ≈ $278,887
Precio, \(H × p_h\) // margen de 40 % | 266 × 1,747.41 | ≈ $464,811 ≈ US$24,000
Colchón de riesgo, \(r\) // 15 %, supuesto: lo que suele salir de más en un primer proyecto | 464,811 × 1.15 | ≈ $534,533 ≈ **US$27,600**
Pagos por hito, 30 / 40 / 30 // firma, examen aprobado, entrega del informe | 0.30 / 0.40 / 0.30 × 27,600 | US$8,280 · 11,040 · 8,280
IVA de 16 % // se suma a cada pago | 0.16 × 27,600 | US$4,416
= El piloto se cotiza en ≈ US$27,600 más IVA. La GPU rentada va aparte, a lo que cobre la nube. Las ≈ 167 h de los abogados (escribir, calibrar y calificar el examen) son del despacho y no están en ese precio.
:::

### Por proyecto, por hora o iguala

Hay tres formas de cobrar, y cada una sirve para algo distinto:

- **[[precio-por-proyecto|Precio por proyecto]]** (*fixed price*): un precio cerrado por un alcance cerrado. Sirve cuando el resultado se puede medir, como el piloto con sus criterios. El riesgo de tardar más es tuyo; por eso lleva colchón.
- **Por hora, con tope** (*time and materials*): el cliente paga las horas que de verdad se usan, hasta un máximo. Sirve cuando el alcance no se puede fijar: «conecta el sistema documental» depende de un sistema que nadie ha visto por dentro.
- **[[iguala|Iguala]]** (*retainer*): una cuota fija al mes por un servicio recurrente, con un número de horas o de casos incluidos. Sirve para el soporte después de la aceptación. Es la que sostiene el negocio: el piloto se cobra una vez; la iguala, cada mes.

El anticipo y los pagos por hito protegen a los dos. Sin anticipo, tú financias el proyecto; con todo por adelantado, el cliente no tiene cómo presionar si no cumples. Atar cada pago a un hito medible (contrato firmado, examen aprobado, informe entregado) hace que cobrar y entregar sean la misma conversación.

## Tus números, el hardware y el tipo de cambio {Your numbers, the hardware and the exchange rate} [extra]

Antes de lo demás, pon tus propios supuestos en la cuenta del precio: tu sueldo, tus cargas, tu tasa facturable, tu margen y las horas.

:::calculadora cotizar-precio
Arranca con el piloto y la iguala del despacho.
:::

### Por qué no revender el servidor

Parece dinero fácil: el servidor cuesta US$67,191.30; le pones 10 % y ganas ≈ US$6,700 sin trabajar. Las cuentas de la aduana, más abajo, dicen lo que cuesta de verdad:

- **Capital inmovilizado.** Para revenderlo tienes que pagarlo antes de cobrarlo: ≈ $1.3 millones de pesos más el IVA de importación de ≈ $218,729. Ese IVA lo recuperas después: lo **acreditas** (lo restas del IVA que cobras) en tu declaración del mes, y si no te alcanza, pides la devolución, que tarda más. Mientras tanto, es dinero tuyo detenido.
- **Riesgo de cambio.** Si compras en dólares y vendes en pesos, una semana mala del peso se come tu margen (abajo, con números).
- **La garantía y la culpa.** Si tú lo vendes, tú eres el primer teléfono cuando falla una fuente, aunque no tengas la pieza.
- **Margen bajo.** Un integrador que arma servidores vive de volumen; tú no.

Lo que conviene: que **el cliente le compre directo al [[integrador]]** con su factura, su garantía y su envío, y que tú cobres por lo que sí sabes hacer: especificar el equipo, comparar las cotizaciones, revisar que lo que llegó sea lo que se pidió y ponerlo a funcionar. Esas horas ya están en la tabla del piloto («sizing y cotización del hardware») y en la instalación. Si un integrador te ofrece una comisión por traerle al cliente, dilo en la propuesta: el cliente tiene que saber a quién le conviene cada recomendación. Cómo se factura una comisión es pregunta para tu contador.

### Pesos o dólares

El servidor se cotiza en dólares; tus horas, en lo que tú decidas. Lo que hay que saber es cómo se paga una deuda en dólares en México. La Ley Monetaria (art. 8) dice que una obligación en moneda extranjera que se paga en México se puede saldar **entregando el equivalente en pesos al [[tipo-de-cambio|tipo de cambio]] del lugar y la fecha del pago**. Ese tipo lo fija el Banco de México: cada día hábil calcula el **FIX**, lo publica en el *Diario Oficial* al día hábil siguiente, y el publicado sirve para pagar al día hábil después. El tipo «para pagos» del 26 de noviembre de 2026 fue **19.3668** (el FIX del 24). Para los impuestos de comercio exterior, el Código Fiscal (art. 20) usa el publicado el día anterior a que se causan.

Consecuencia práctica: un precio en dólares **no queda fijo en pesos** el día que se firma. Y el peso se mueve. Del 20 al 26 de noviembre de 2026, el FIX pasó de **19.0228** a **19.7203** pesos por dólar.

:::cuenta Una semana del peso sobre el piloto
FIX del 20 de noviembre de 2026 | — | 19.0228
FIX del 26 de noviembre de 2026 | — | 19.7203
Cambio en la semana | 19.7203 ÷ 19.0228 − 1 | ≈ 3.67 %
Piloto a 19.0228 // US$27,600 | 27,600 × 19.0228 | ≈ $525,029
Piloto a 19.7203 | 27,600 × 19.7203 | ≈ $544,280
Diferencia | 544,280 − 525,029 | **≈ $19,251**
= En cuatro días hábiles, el mismo piloto en dólares costó ≈ $19 mil pesos más. Sobre el servidor de US$67,191.30, el mismo movimiento son ≈ $47 mil.
:::

Las opciones honestas son dos, y la propuesta dice cuál:

1. **Precio en dólares**, pagadero en pesos al FIX publicado el día hábil anterior al pago. El riesgo del tipo de cambio es del cliente; es lo normal cuando lo que se compra (el servidor, la GPU rentada) se paga en dólares.
2. **Precio en pesos**, con un tipo de cambio fijo y una **vigencia corta** (10 días es razonable) y una regla para después: «si el FIX del día del pago se mueve más de 3 % del de la cotización, el precio se actualiza». El riesgo es tuyo dentro de ese margen.

Para tus horas, cotizar en pesos suele ser más claro: tu costo (los sueldos) está en pesos. Para el hardware y la nube, en dólares, porque es lo que pagarás.

:::nota Las licencias también son en dólares
NVIDIA AI Enterprise, opcional para el despacho, cuesta US$18,000 por GPU por 5 años de lista: con 3 L40S, US$54,000. Si el cliente la quiere, va en la propuesta como línea aparte, en dólares, comprada por él. Lo ves en [Comprar hardware](/comprar-hardware/).
:::

## El SLA desde cero {The SLA from scratch}

Un [[sla|SLA]] (*service level agreement*, acuerdo de nivel de servicio) es la parte del contrato que dice **qué tan bien** va a funcionar el servicio, **cómo se mide** y **qué pasa si no se cumple**. Esa última parte es la que lo hace SLA. El libro de SRE de Google (*site reliability engineering*, la disciplina de mantener vivos servicios grandes) lo pone como prueba: pregúntate «¿qué pasa si no se cumple?»; si la respuesta es «nada», no es un SLA, es una meta.

:::analogia La paquetería que promete «mañana»
Una paquetería que vende «entrega al día siguiente» no promete que nunca se retrase. Promete qué pasa si se retrasa (te devuelve el costo del envío) y dice qué no cuenta (una dirección mal escrita, una carretera cerrada). Dónde se rompe: a la paquetería le sobran camiones para cubrir uno descompuesto; a ti, con un solo servidor y dos personas, no. Por eso tu SLA se escribe con lo que de verdad tienes.
:::

Las tres siglas, en una línea cada una (las ves a fondo en [Promedios, medianas y percentiles](https://sensei.trueml.app/percentiles/) y en [Monitoreo, drift y reentrenamiento](https://sensei.trueml.app/e12-monitoreo/)):

- **SLI**: lo que se mide. «Fracción de minutos del horario en que el servicio contestó».
- **[[slo|SLO]]**: la meta interna. «99.5 % de esos minutos».
- **SLA**: la promesa al cliente, con consecuencias. «99 % de esos minutos; si no, un descuento». Se pone **más laxa** que el SLO: tu equipo apunta al 99.5 % para que el 99 % casi nunca se rompa.

En la nube tú eras el cliente y el SLA era el del proveedor. Aquí **tú eres el proveedor**, y la pregunta cambia de «¿qué me devuelven?» a «¿qué puedo cumplir?».

### La disponibilidad, en minutos

La [[disponibilidad]] (*availability*) es la fracción del tiempo prometido en que el servicio funciona. Dicha en porcentaje no se siente; dicha en minutos sí. Lo que una disponibilidad permite caer se llama **presupuesto de error** (*error budget*).

:::formula Minutos de caída que permite una disponibilidad
M = h × d × 60
E = (1 − A) × M
- h: horas del día en que rige la promesa (10 en horario de oficina; 24 en 24 × 7)
- d: días del mes en que rige (22 hábiles; 30 en 24 × 7)
- M: minutos prometidos al mes
- A: disponibilidad prometida, como fracción (0.99 = 99 %)
- E: presupuesto de error, los minutos que se puede caer al mes sin romper el SLA
:::

:::cuenta El presupuesto del despacho, en horario y en 24 × 7
Minutos del horario, \(M\) // 9:00 a 19:00, 22 días hábiles | 10 × 22 × 60 | 13,200 min
Con 99 %, \(E\) | 0.01 × 13,200 | 132 min ≈ 2.2 h
Con 99.5 % | 0.005 × 13,200 | 66 min
Con 99.9 % | 0.001 × 13,200 | 13.2 min
Minutos de un mes 24 × 7, \(M\) // 30 días | 24 × 30 × 60 | 43,200 min
Con 99.9 % en 24 × 7 | 0.001 × 43,200 | 43.2 min
Una mañana sin servidor // 4 h de un día hábil | 4 × 60 | 240 min
Contra el 99.5 % en horario | 240 ÷ 66 | ≈ 3.6 presupuestos
= Una sola mañana de 4 horas sin servicio se come más de tres meses de presupuesto de un 99.5 % en horario. Los «nueves» se ven parecidos y no lo son: cada nueve de más divide los minutos entre diez.
:::

:::figura cotizar-nueves
Los minutos que se puede caer el servicio al mes con cada disponibilidad, en el horario del despacho (13,200 minutos) y en 24 × 7 (43,200). La línea punteada es una mañana de 4 horas sin servidor: rompe cualquier promesa en horario.
:::

Dos cosas. **El horario importa tanto como el porcentaje**: prometer solo de 9:00 a 19:00 no es trampa, es prometer lo que el cliente usa y dejar las noches para mantenimiento. Y **un 99.9 % no se cumple con reflejos**: 13 minutos no alcanzan para ver la [[alerta|alerta]], entrar y reiniciar; pide que el servicio se arregle solo, con réplicas que toman el lugar de la que cae.

:::calculadora cotizar-sla
Elige el horario, mueve la disponibilidad y la duración de una caída típica, y mira cuántas caben en un mes.
:::

### Qué cuenta como «caído»

Un SLA sin definición de «caído» es una pelea esperando a pasar. «El servidor está prendido» no le sirve a nadie: el servidor puede estar prendido y vLLM colgado. La definición útil se mide **desde donde está el abogado**. Para eso, al [[tablero|tablero]] de la lección [Observabilidad de GPUs e inferencia](/observabilidad/), que ya mide el TTFT p95, se le suma una **pregunta de prueba** (*synthetic check*): un programa pequeño que cada minuto manda la misma pregunta corta por el gateway, como si fuera un abogado, y anota si llegó la respuesta.

- **Caído**: un minuto del horario en que la pregunta de prueba no recibe respuesta. Cuenta para la disponibilidad. Cómo se arma esa pregunta, con sus alertas, está en [el caso del despacho](/casos/despacho/).
- **Degradado**: el servicio contesta, pero el TTFT p95 de los últimos 10 minutos pasa el umbral acordado. No cuenta como caído; tiene su propia severidad y su tiempo de respuesta.

El umbral de «degradado» **no puede ser 2 s con la opción A**, porque la cuenta dice que las L40S no lo cumplen ni en un día normal. Se fija con lo que el piloto midió: si el p95 medido en la hora pico fue de 3.4 s, el umbral razonable es algo arriba de eso. Si el despacho exige 2 s, la respuesta honesta es la opción D, no un SLA que sabes que vas a romper.

## Qué se puede prometer con un solo servidor {What one server can honestly promise}

Un SLA es una promesa sobre el futuro, y el futuro de un servidor trae fallas. La pregunta no es si se va a descomponer algo, sino **qué pasa ese día**.

### Cuántas veces falla una GPU

No hay una cifra publicada de fallas de la L40S en inferencia de oficina. Con la cota más cercana, el entrenamiento de Llama 3 de Meta, sale ≈ 0.11 fallas por GPU y por año: con 3 L40S, ≈ **63 %** de probabilidad de que al menos una falle en 3 años. Es una cota alta, pero dice lo importante: **espera una falla de tarjeta en la vida del servidor**, y la pregunta es si, cuando falla una, el servicio sigue.

:::profundo De dónde sale el 63 %
Lo más cercano a una cifra es el reporte de Meta sobre el entrenamiento de Llama 3 (*The Llama 3 Herd of Models*, 2024): en 54 días con hasta 16,384 GPUs H100 hubo **268 interrupciones atribuidas a la GPU** (tarjeta mala, memoria HBM3, SRAM y otras). Es una **cota alta**: GPUs de 700 W a plena carga día y noche, contra una L40S de 350 W que en la oficina trabaja a ratos. Sirve para el orden de magnitud, no como dato.

:::formula La probabilidad de al menos una falla
λ = frac{F}{N × D ÷ 365}
P = 1 − e^{−n λ T}
- F: fallas contadas (268); N: GPUs (16,384); D: días observados (54)
- λ: fallas por GPU y por año
- n: GPUs del servidor; T: años que se miran
- P: probabilidad de que falle al menos una en ese tiempo (fallas al azar, independientes)
:::

:::cuenta ¿Va a fallar una tarjeta del despacho?
Fallas por GPU y año, \(λ\) // la cota de Llama 3 | 268 ÷ (16,384 × 54 ÷ 365) | ≈ 0.11
Con 3 L40S, en 3 años, \(P\) | \(1 − e^{−3 × 0.11 × 3}\) | ≈ 63 %
Con 4 L40S | \(1 − e^{−4 × 0.11 × 3}\) | ≈ 73 %
Con 2 Server Edition | \(1 − e^{−2 × 0.11 × 3}\) | ≈ 48 %
= Con la cota alta, lo más probable es que **una tarjeta falle** en la vida del servidor. Más tarjetas fallan más seguido; la pregunta que importa es si, cuando falla una, el servicio sigue.
:::
:::

### El día que falla una tarjeta

Con las cuentas de la ficha: cada L40S sostiene **2 conversaciones** a ≥ 20 tokens por segundo, y en la hora pico hay **≈ 5.7 a la vez**. En una hora promedio hay ≈ 2.25.

:::figura cotizar-falla
Qué queda cuando falla una tarjeta, en lugares (conversaciones a ≥ 20 tokens/s) contra las ≈ 5.7 de la hora pico. Con 3 L40S quedan 4: degradado en la hora pico. Con 4 L40S quedan 6: mismo servicio. Con 2 Server Edition queda una con ≈ 6, en el filo.
:::

- **Opción A, 3 L40S sin repuesto.** Quedan 2 [[replica|réplicas]], 4 lugares contra 5.7: en la hora pico el servicio se **degrada** (fila, TTFT que se dispara), aunque no se cae. En una hora normal alcanza: con 4 lugares y respuestas de ≈ 27 s caben, por la [[ley-de-little|ley de Little]], 4 ÷ 27 × 3,600 ≈ 533 preguntas por hora, 1.8 veces el promedio de 300 (la hora pico trae 750). Se aguanta días, no semanas.
- **Opción B, 4 L40S.** Quedan 3 réplicas, 6 lugares ≥ 5.7: el abogado no se entera. Es el [[n-mas-1|N+1]] de la ficha y cuesta **US$8,910** más (US$76,101.30 − 67,191.30).
- **Opción D, 2 Server Edition.** Queda una con ≈ 6 lugares: alcanza, sin [[holgura]], con toda la fila de prefill en una GPU. No está simulado; se mide en el piloto apagando una.

Y hay fallas que ninguna opción cubre: la tarjeta madre, el disco del sistema. **Un servidor es un solo punto de falla.** Por eso el SLA de un servidor único **excluye** la falla de hardware mientras el fabricante repone la pieza: lo que prometes es diagnosticar a tiempo y mover el reemplazo.

### Lo que dice la garantía, y lo que no

Tu promesa no puede ser mejor que la del fabricante. A noviembre de 2026:

- **Supermicro** publica su garantía estándar de servidores y sistemas de GPU: **3 años de mano de obra, 1 año de piezas y 1 año de reemplazo adelantado** (*advance cross-ship*: te mandan la pieza antes de que devuelvas la mala, que tiene que llegarles en 30 días). Si no tienen la pieza en 30 días, pueden reparar o dar una equivalente o reacondicionada. La página no habla de servicio en sitio ni de envíos fuera de Estados Unidos.
- **Exxact**, el vendedor de la cotización del despacho: según el resumen de su página de garantía que da un buscador (la página no abrió), una garantía limitada de 3 años desde el envío para el hardware **de marca Exxact**. No dice si eso incluye a las tarjetas de NVIDIA dentro del TensorEX 4U ni cómo funciona fuera de Estados Unidos. Es la primera pregunta por escrito.

:::profundo Lo que publican Exxact y un OEM grande
**Exxact**, en el mismo resumen, describe un reemplazo adelantado tras un diagnóstico remoto (el cliente instala la pieza y devuelve la mala en 15 días), algunas piezas excluidas, y los productos de otras marcas fuera de su garantía. Los términos completos van en el contrato de compra.

**Lenovo**, como ejemplo de un [[oem|OEM]]: la L40S y la RTX PRO 6000 Server Edition traen 1 año de garantía como tarjeta suelta y, instaladas en un servidor suyo, heredan la garantía del servidor. La garantía de la tarjeta depende de quién la vende dentro del servidor, no de NVIDIA.
:::

La lección [Comprar hardware](/comprar-hardware/) dejó cinco preguntas para el integrador; la quinta era si la garantía sigue si el equipo se importa. La respuesta honesta, con lo publicado: **no se sabe hasta que lo pongan por escrito**, y hay un detalle que casi nadie piensa. La pieza de reemplazo que viene de Estados Unidos **también cruza la aduana**, con su propio trámite y sus días. Un *cross-ship* «en días» dentro de Estados Unidos puede tardar bastante más hasta la Ciudad de México; no hay cifras publicadas. Pregunta: «¿quién importa la pieza de reemplazo, quién paga ese trámite y cuántos días hábiles tarda hasta el despacho?».

### Tiempos de respuesta por severidad

El [[tiempo-de-respuesta|tiempo de respuesta]] es lo que tarda tu equipo en **empezar** a atender un problema reportado; el tiempo de solución, lo que tarda en **resolverlo** o en dar un plan. No son lo mismo, y el SLA dice los dos por severidad.

| Severidad | Qué es | Respuesta | Solución o plan |
|---|---|---|---|
| 1 · caído | Nadie puede preguntar | 1 h hábil | Servicio de vuelta en 2 h hábiles (si es hardware, plan y pieza pedida) |
| 2 · degradado | Contesta lento, o falta una réplica | 4 h hábiles | Siguiente día hábil |
| 3 · una parte | Una persona, una función o un expediente | Siguiente día hábil | 5 días hábiles |
| 4 · consulta | Una pregunta o un cambio menor | 2 días hábiles | En la siguiente ventana mensual |

Los números tienen que **cuadrar entre sí**. Con 99 % en horario, el presupuesto es de 132 minutos al mes; si la severidad 1 se resolviera en 4 horas, un solo incidente de software rompería el SLA, y el contrato se contradiría solo. Por eso el despacho tiene 2 horas para la severidad 1: cabe **un** incidente al mes, y el reinicio de un proceso o un regreso a la versión anterior tardan menos.

Con el servidor [[firewall-de-salida|sin salida a internet]] hay un detalle más: tu equipo no puede entrar cuando quiere (abajo, en el contrato). El tiempo de respuesta corre **desde el aviso**; el de solución se detiene mientras el cliente no abre el acceso.

### Exclusiones y créditos

Todo SLA dice qué **no** cuenta (el de las máquinas de AWS excluye, entre otras cosas, lo que haga el cliente y su propio equipo). El del despacho excluye:

- La luz, el aire y la red del edificio (el UPS da minutos, no horas).
- El [[ventana-de-mantenimiento|mantenimiento programado]] y avisado, fuera del horario: las actualizaciones mensuales van de noche.
- La falla de hardware mientras el fabricante repone la pieza, siempre que tú hayas diagnosticado y pedido el reemplazo a tiempo.
- Lo que haga el cliente: un cambio de permisos en Entra ID, un cable desconectado.

Si no se cumple, la [[penalizacion|penalización]] habitual son **créditos**: un descuento en la siguiente factura, escalonado, con tope y con un plazo para reclamar. El de las máquinas de AWS devuelve 10 %, 30 % o 100 % según cuánto se quedó abajo. El del despacho: **10 % de la iguala del mes** si la disponibilidad cae abajo de 99 % (pero no de 98 %), **25 %** si cae abajo de 98 %, con tope de 25 %, reclamado en los 30 días siguientes.

:::profundo Un mes malo, en pesos
:::cuenta Un mes malo
Iguala del mes // la sección del soporte | — | ≈ $41,938
Minutos caídos en el mes | — | 185 min
Disponibilidad del mes, \(A\) | 1 − 185 ÷ 13,200 | ≈ 98.6 %
¿Cumplió el 99 %? | 98.6 < 99 | No
Crédito // entre 98 % y 99 %: 10 % | 0.10 × 41,938 | **≈ $4,194**
= Un mes con poco más de 3 horas caídas cuesta ≈ $4,194 de descuento. El crédito no paga lo que perdió el despacho; dice que la promesa importa.
:::
:::

En México, un crédito pactado funciona como una pena convencional, con reglas que cambian cómo se escribe.

:::profundo La pena convencional y el tope de responsabilidad
Un crédito pactado funciona como una **pena convencional** (cláusula penal). Qué código rige el contrato (el Civil Federal, el de la Ciudad de México o el de Comercio) lo dice tu abogado; estas reglas son las del Código Civil Federal. Tres que cambian cómo se escribe: si se pacta la pena, no se pueden reclamar además daños y perjuicios (art. 1840); la pena **no puede ser mayor** que la obligación principal (art. 1843); y la responsabilidad por **dolo** (hacer daño a propósito) no se puede renunciar (art. 2106). Un tope de responsabilidad («a lo más, 12 meses de iguala») es una cláusula normal, pero no te protege si hubo dolo, y quien presta servicios profesionales responde por negligencia o impericia (art. 2615). Confírmalo con tu abogado.
:::

:::ojo
**Un equipo de 1 o 2 personas no puede prometer 24 × 7.** No es actitud: es aritmética de horas, y en México además es ley laboral (en la sección «En la vida real», el caso de una clínica). Promete horario de oficina, deja las noches para mantenimiento y, si el cliente necesita más, cotiza lo que de verdad cuesta.
:::

## El contrato {The contract}

La propuesta dice qué vas a hacer; el [[contrato-de-servicios|contrato de servicios]] (*services agreement*) dice qué pasa si algo sale distinto: quién responde, quién es dueño de qué, qué se hace con los datos y cómo se termina. Casi siempre la propuesta firmada va como anexo. Lo que sigue es la lista de cláusulas que no pueden faltar en uno de IA privada, no texto legal: **la redacción es de tu abogado**.

### Lo que el contrato no puede dejar fuera

- **Objeto y anexos**: la propuesta, el SLA y el plan de soporte, con su versión.
- **Confidencialidad**: todo lo que veas del despacho (expedientes, clientes, estrategia) es secreto, también para tu personal y tus subcontratistas, y **sigue siéndolo al terminar**. Para los datos personales, la ley ya lo pide (art. 20 de la ley de 2025); para el resto, lo dice el contrato.
- **Propiedad, datos personales y acceso para soporte**, abajo.
- **Responsabilidad**: un tope razonable (por ejemplo, lo pagado en los últimos 12 meses) y los créditos del SLA como pena convencional, con las reglas de la sección anterior.
- **Terminación y entrega**: con cuánto aviso se termina la iguala (30 a 90 días es un rango razonable; no hay regla), y qué entregas al final: claves, configuración, manual y la constancia de que borraste lo que tenías.

### Quién es dueño de lo que se construye

En un proyecto así se construyen cosas de dos tipos. Unas son **del cliente**, hechas para él: su configuración, sus prompts, su examen de 200 preguntas, su manual. Otras son **tuyas**, y las vuelves a usar con cada cliente: tus scripts de instalación, tu plantilla de examen, tus [[tablero|tableros]]. El contrato tiene que separarlas. Escribe qué se **cede** al despacho y qué se le **licencia**, por escrito y con precio.

:::profundo Lo que dice la ley de derechos de autor
La Ley Federal del Derecho de Autor (última reforma de mayo de 2026) da las reglas de fondo: quien **encarga** una obra tiene sus derechos patrimoniales salvo pacto en contrario (art. 83), pero los términos del encargo tienen que ser claros, porque **en caso de duda gana el autor** (art. 83 bis); y toda transmisión de derechos es por escrito o es nula (art. 30). Por eso la separación va por escrito. El modelo, Qwen3 32B, no es de nadie del contrato: viaja con su licencia Apache 2.0 ([Licencias](/licencias/)).
:::

### Tú, la persona encargada de los datos

Para la ley de datos personales, el despacho es el **responsable**: decide para qué se usan los datos de sus clientes. Tú, que los tocas para instalar, probar y dar soporte, eres el [[encargado-de-datos|encargado]]: la ley de 2025 te llama **persona encargada**, «la persona física o jurídica que sola o conjuntamente con otras trate datos personales por cuenta del responsable» (art. 2, fracción XII).

Lo sorprendente, a noviembre de 2026: la ley nueva **define** a la persona encargada, pero **sus obligaciones** no están ahí. Siguen en el **Reglamento de 2011** (arts. 49 a 55), que el Congreso sigue publicando como vigente; no se encontró un reglamento nuevo. Lo que el reglamento le pide al encargado, y por eso al contrato:

1. Tratar los datos **solo según las instrucciones** del responsable, y para ninguna otra finalidad (art. 50, I y II).
2. Tener **medidas de seguridad** (art. 50, III): las de la lección [Seguridad](/seguridad/).
3. **Confidencialidad** (art. 50, IV).
4. **Suprimir** los datos al terminar la relación o cuando el responsable lo pida (art. 50, V).
5. **No transferir** los datos salvo que lo diga el responsable (art. 50, VI).
6. Toda **subcontratación** que toque datos, autorizada por el responsable, con las mismas obligaciones; y **tú** tienes que poder probar que la autorizaron (arts. 54 y 55).

Dos consecuencias prácticas para el despacho. La primera es el piloto: la GPU rentada está en una nube, a veces en Virginia (`us-east-1`). Con contrato, mandar ahí los documentos es una **remisión** a un subencargado, que no pide avisarle a cada cliente del despacho (art. 53); la nube va **nombrada** en el contrato. La segunda es la que más se olvida: si usas los expedientes para algo tuyo (entrenar un modelo para otro cliente, un benchmark, una demo), dejas de ser encargado y pasas a ser **responsable**, con todas sus obligaciones (art. 53). Escríbelo como prohibición expresa.

Y si algo se filtra: el **responsable** tiene que avisar «de forma inmediata» a las personas afectadas cuando la vulneración afecta de forma significativa sus derechos (art. 19 de la ley), así que el contrato te obliga a avisarle al despacho **en cuanto lo descubras**.

:::profundo Lo que te puede pasar a ti
Las multas de la ley son para el responsable, pero tu exposición es real: el contrato, y el delito del art. 62, de 3 meses a 3 años de prisión para quien, estando autorizado a tratar datos y con ánimo de lucro, provoque una vulneración de las bases de datos a su cargo (penas al doble con datos sensibles, art. 64). Qué datos del despacho cuentan como sensibles lo dice su abogado.
:::

### Soporte sin internet

El servidor de modelos del despacho [[aislamiento|no sale a internet]] ([Seguridad](/seguridad/)). Entonces, ¿cómo entras a arreglarlo? Con una puerta que **abre el cliente**, cada vez. El control MA-4 de NIST (SP 800-53, revisión 5), una referencia de seguridad para mantenimiento remoto, pide aprobar y vigilar cada sesión, autenticación fuerte, registro de lo que se hizo y cerrar todo al terminar. En el contrato:

- Una VPN o un servidor de salto (*jump host*: una máquina intermedia por la que se entra, y que registra todo) **del despacho**, no tuyos.
- Una cuenta con nombre por persona de tu equipo, con segundo factor, **desactivada por omisión**.
- El TI del despacho la activa para cada ventana y la desactiva al terminar.
- Cada sesión queda en una bitácora.

Si el despacho no quiere ni eso: visitas, o que su TI teclee los comandos mientras tú le dictas por llamada. Las dos cuestan horas, y se cotizan.

## Importar el servidor {Importing the server}

[[importacion|Importar]] es meter legalmente una mercancía a México: declararla en la aduana, pagar sus impuestos y cumplir los requisitos que no son impuestos. Lo primero es decidir **si** se importa.

### Comprar en México o importar

Hay dos formas de que el servidor llegue al cuarto del despacho:

1. **Comprarlo a un integrador o mayorista en México.** Factura en pesos, garantía local, y el problema de la aduana es de él. Lo que pagas de más por eso, si pagas de más, es la pregunta.
2. **Importarlo**: comprarlo a Exxact (o a otro) en Estados Unidos y cruzarlo uno mismo.

No hay una fuente que compare las dos. Se piden **dos cotizaciones**, una puesta en la Ciudad de México y otra en Estados Unidos, y se ponen lado a lado con la cuenta de abajo.

### Quién importa y cómo

Si se importa, alguien es el **importador**: el que aparece en los papeles y paga. Por lo dicho del hardware, conviene que sea **el despacho** (o el integrador mexicano), no tú. Lo que pide la Ley Aduanera (texto con reforma del 23 de octubre de 2026):

- Estar inscrito en el **Padrón de Importadores** del SAT y en el RFC (el registro de contribuyentes), al corriente de sus impuestos (art. 59, IV).
- Hacer el trámite por medio de un [[agente-aduanal|agente aduanal]]: un profesional con patente del gobierno que despacha en nombre del importador (art. 40). Una empresa puede hacerlo sin agente, con un representante legal acreditado ante el SAT, pero para una sola compra casi nunca conviene.
- Entregarle al agente la **manifestación de valor**, el precio pagado, «bajo protesta de decir verdad» (art. 59, III).

El agente arma el [[pedimento]]: la declaración de la importación ante la aduana, con qué es la mercancía, cuánto vale, de dónde viene, qué impuestos se pagan y quién los paga. Se paga y se presenta al cruzar; sin pedimento pagado, la mercancía no sale de la aduana.

### El arancel: cero, por ahora

El [[arancel]] (el impuesto general de importación, IGI) es un porcentaje que se cobra sobre el valor de la mercancía. Depende de su **fracción arancelaria**: el número de la tarifa que dice qué es. A noviembre de 2026, en la tarifa vigente:

- Las máquinas de tratamiento de datos (partida 84.71), entre ellas **8471.50.01**, «unidades de proceso», donde suele ir un servidor completo, están **exentas**.
- Las partes de esas máquinas (**8473.30.04**), donde podría ir una tarjeta suelta, también.

¿Y el aumento de aranceles de 2026 a países sin tratado comercial? El decreto se publicó el 29 de diciembre de 2025 y está vigente desde el 1 de enero de 2026: sube 1,463 fracciones (textiles, acero, autos, muebles…), y en la tarifa ya reformada la 8471.50.01 y la 8473.30.04 **siguen exentas**. Sí subieron cosas cercanas al cuarto: ventiladores domésticos (a 25–30 %), refrigeradores y las partes de compresores y ventiladores (a 25 %); el minisplit (8415.10.01) sigue exento. Lo del cuarto (aire, UPS) conviene comprarlo a un proveedor en México, con factura en pesos, y que la aduana sea problema suyo.

Dos cautelas. La fracción la decide el agente, y con otra clasificación el arancel cambia (la cuenta de abajo muestra cuánto). Y estas tarifas se modifican seguido: confírmalo con tu agente aduanal el día que compres.

:::diagrama cotizar-aduana
El viaje del servidor de la fábrica al cuarto del despacho, con la aduana en medio. Toca cada caja para ver quién hace qué; los dos recorridos comparan importarlo con un Incoterm DAP contra comprarlo en México.
:::

### Incoterms: quién paga cada tramo

Un [[incoterm]] es una regla de tres letras, de la Cámara de Comercio Internacional (ICC), que dice en una compra internacional **quién paga cada tramo del viaje y en qué punto pasa el riesgo** del vendedor al comprador. La edición vigente es **Incoterms® 2020**; el contrato lo dice así: «DAP Ciudad de México, Incoterms® 2020». Los tres que vas a ver:

- **EXW** (*ex works*, en fábrica): el vendedor lo deja en su bodega y ya. El comprador hace todo, hasta el trámite de exportación en Estados Unidos. La propia ICC dice que es para comercio dentro de un país.
- **DAP** (*delivered at place*, entregado en un lugar): el vendedor paga y arriesga el viaje hasta el lugar acordado, sin descargar. **La importación y sus impuestos son del comprador.**
- **DDP** (*delivered duty paid*, entregado con impuestos pagados): el vendedor hace también la importación y paga los impuestos. La ICC advierte que en algunos países un extranjero no puede hacer el trámite; en México el importador necesita RFC y padrón, así que pregúntale al vendedor quién sería el importador.

:::figura cotizar-incoterms
Quién paga cada tramo con EXW, DAP y DDP, de la bodega del vendedor al cuarto del despacho. Con DAP, el que más se usa en un caso así, el vendedor paga el viaje y el despacho, la aduana.
:::

## La cuenta de la aduana {The customs math}

Con el arancel en cero, ¿cuánto cuesta cruzar el servidor? Hay que saber sobre qué se cobra cada cosa. Todo empieza en el [[valor-en-aduana|valor en aduana]]: el precio pagado **más** el flete, el seguro y los gastos hasta el punto de entrada, si los paga el comprador (Ley Aduanera, art. 65). Con EXW se suman; con DAP ya vienen en el precio.

Sobre ese valor se cobran el arancel y el [[dta|DTA]], el derecho de trámite aduanero: **8 al millar** (0.8 %) del valor, también con mercancías exentas de arancel, o una **cuota fija de $461.61** por operación (2026) si un tratado, como el T-MEC (el de México, Estados Unidos y Canadá), dice que no se cobren cargos sobre el valor (Ley Federal de Derechos, art. 49). Y el IVA de importación, 16 %, se cobra sobre el valor **más** el arancel **más** el DTA (Ley del IVA, art. 27).

:::formula El costo de poner el servidor en el despacho
V = (P + F + s P) × T
I = a V
D = 0.008 V  text{ o }  461.61
IVA = 0.16 (V + I + D)
C = V + I + D + IVA + H + O
- P: precio de la factura, en US$; F: flete y embalaje, en US$; s: seguro, como fracción de P
- T: [[tipo-de-cambio|tipo de cambio]], en pesos por dólar
- V: valor en aduana, en pesos
- a: arancel, como fracción (0 para 8471.50.01); I: el arancel en pesos
- D: el DTA, en pesos
- H: honorarios del agente aduanal; O: maniobras, almacenaje y flete en México, en pesos
- C: el costo puesto en el despacho, con el IVA
:::

:::cuenta Traer el servidor del despacho (3 L40S, supuestos declarados)
Precio, \(P\) // Exxact, 25-nov-2026, sin impuestos | — | US$67,191.30
Flete y embalaje aéreo, \(F\) // supuesto, cobrado aparte (como en EXW); con DAP vendría dentro de la factura | — | US$2,500
Seguro, \(s P\) // 0.5 %, supuesto | 0.005 × 67,191.30 | US$335.96
Valor en aduana, \(V\) // al tipo de 19.3668 | 70,027.26 × 19.3668 | $1,356,204
Arancel, \(I\) // 8471.50.01 exenta | 0 × 1,356,204 | $0
DTA, \(D\) // 0.8 %, sin acreditar origen | 0.008 × 1,356,204 | $10,850
IVA de importación // sobre \(V + I + D\) | 0.16 × 1,367,053 | $218,729
Agente, \(H\), y maniobras, \(O\) // supuestos | 12,000 + 15,000 | $27,000
Total puesto, \(C\) | suma | **$1,612,782**
Sin el IVA, que se acredita | 1,612,782 − 218,729 | $1,394,054 ≈ US$71,982
Sobre el precio en pesos | 1,394,054 ÷ (67,191.30 × 19.3668) − 1 | **≈ 7.1 %**
= Importar le agrega ≈ 7 % al precio de lista. El IVA, ≈ $219 mil, no es un costo: se paga en la aduana y se acredita después. Es dinero que hay que tener ese día.
:::

Tres cosas que salen de la cuenta:

- **El DTA tiene dos tarifas.** Con un certificado de origen del T-MEC que el agente acepte, el DTA baja de $10,850 a $461.61: ≈ $10,388 menos. Si un servidor armado en Estados Unidos con chips hechos en Taiwán califica como originario es una pregunta para el agente; la diferencia es de ≈ $10 mil, no de cientos de miles.
- **El tipo de cambio mueve más que el DTA.** La misma cuenta al FIX de 19.7203 sube ≈ $25 mil sin IVA.
- **La clasificación es lo que más mueve.** Si alguien clasificara el servidor en una fracción con 15 % de arancel (no es el caso), el total subiría ≈ $236 mil.

:::profundo La cuenta en Python
```python
def puesto(precio, flete, seguro, arancel, tc, honorarios, otros, tmec=False):
    valor = (precio + flete + seguro * precio) * tc      # valor en aduana, pesos
    igi = arancel * valor
    dta = 461.61 if tmec else 0.008 * valor              # cuota fija o 8 al millar
    iva = 0.16 * (valor + igi + dta)                     # se paga y se acredita
    total = valor + igi + dta + iva + honorarios + otros
    return valor, igi, dta, iva, total

for nombre, usd in [("3 L40S", 67191.30), ("4 L40S", 76101.30)]:
    v, igi, dta, iva, tot = puesto(usd, 2500, 0.005, 0.0, 19.3668, 12000, 15000)
    sin_iva = tot - iva
    print(f"{nombre}: valor ${v:,.0f}  DTA ${dta:,.0f}  IVA ${iva:,.0f}  "
          f"sin IVA ${sin_iva:,.0f} (+{sin_iva / (usd * 19.3668) - 1:.1%})")

for a in (99, 99.5, 99.9):
    print(f"{a}%: {(1 - a/100) * 10*22*60:6.1f} min/mes en horario, "
          f"{(1 - a/100) * 24*30*60:6.1f} en 24x7")
```

```salida
3 L40S: valor $1,356,204  DTA $10,850  IVA $218,729  sin IVA $1,394,054 (+7.1%)
4 L40S: valor $1,529,625  DTA $12,237  IVA $246,698  sin IVA $1,568,862 (+6.4%)
99%:  132.0 min/mes en horario,  432.0 en 24x7
99.5%:   66.0 min/mes en horario,  216.0 en 24x7
99.9%:   13.2 min/mes en horario,   43.2 en 24x7
```

El programa repite la cuenta para las opciones A y B y, al final, los minutos de caída de tres SLA. Con 4 L40S, el sobrecosto baja a 6.4 % porque los gastos fijos (agente, maniobras) se reparten en un precio mayor.
:::

:::calculadora cotizar-importar
Mueve el precio, el flete, el arancel, el tipo de cambio y si se acredita el origen. Arranca con los supuestos del despacho.
:::

:::ojo
Declara el precio **real** de la factura. Una reforma de la Ley Aduanera de octubre de 2026, en vigor desde el 1 de enero de 2027, endurece el **embargo precautorio** (la aduana retiene la mercancía): procede cuando el valor declarado es menor que el de mercancías idénticas o similares, para las mercancías y con el procedimiento que publique la autoridad. Bajar el valor para pagar menos DTA e IVA ahorra unos miles y arriesga el servidor entero.
:::

## Controles de exportación y otras letras chicas {Export controls and other fine print} [extra]

**Estados Unidos controla la exportación de chips avanzados.** Las reglas cambian seguido y en los blogs abundan versiones viejas. A noviembre de 2026:

- La regla que más se cita, la «AI Diffusion Rule», **ya no existe**: una regla final interina del Departamento de Comercio del 19 de noviembre de 2026 (*Addressing Remote Access to Advanced Semiconductors*, en el *Federal Register*, el diario oficial de Estados Unidos) la rescindió formalmente, y agregó licencias para cinco países (Indonesia, Malasia, Singapur, Tailandia y Brasil) y controles sobre centros de datos que den cómputo a empresas con sede en ciertos países.
- **México no está** en esa lista, ni en los grupos de países (D:1, D:4, D:5) que piden licencia para estos chips: está en los grupos A:1, A:3, A:4 y A:6.
- Dos cautelas: la regla mira también **la sede del comprador** (si la matriz del cliente estuviera en un país restringido, aplica igual) y **el uso final**, y el vendedor puede pedir una declaración de usuario final. Lenovo marca la L40S y la RTX PRO 6000 Server Edition como «controladas», sin publicar su clasificación (ECCN).

Qué decirle al cliente: «hoy México no pide licencia por destino; el vendedor hace su propio análisis; las reglas cambiaron el 19 de noviembre y pueden volver a cambiar». Confírmalo con el vendedor y con asesoría de comercio exterior.

**Las NOM.** Las normas oficiales mexicanas de seguridad y etiquetado que se revisan en la aduana están en un anexo de la Secretaría de Economía. Según una fuente secundaria, las fracciones de servidores salieron de ese anexo en 2016, pero el anexo se modificó el 28 de septiembre de 2026: pregúntale al agente si la fracción está hoy en el anexo.

**El T-MEC.** En la revisión del 1 de julio de 2026, Estados Unidos no aceptó renovarlo en su forma actual; el mismo comunicado de su oficina comercial (USTR) dice que el tratado sigue en vigor. Según análisis de despachos internacionales, sin renovación dura hasta 2036 con revisiones anuales, y las preferencias no cambian hoy. Para el servidor solo importa por el DTA.

**Los tiempos.** No hay cifras publicadas de cuánto tarda una importación así: depende del modo (aéreo o terrestre) y de si a la mercancía le toca reconocimiento (revisión física). Pídele al agente un presupuesto por escrito con honorarios, maniobras, almacenaje, flete nacional y días. Mientras tanto, el piloto sigue en la GPU rentada.

## El soporte del día a día {Day-to-day support}

Después de la aceptación empieza lo que dura años: la iguala. Lo que incluye tiene que estar escrito en horas, para que el cliente sepa qué compra y tú sepas cuándo te pasaste.

| Lo que incluye la iguala del despacho | Horas al mes |
|---|---|
| Revisar el [[tablero\|tablero]] y las [[alerta\|alertas]] una vez a la semana | 4 |
| La actualización mensual: [[parche\|parches]], examen de 200 y prueba de carga corta antes de pasar el [[gate-de-calidad\|gate]] | 10 |
| Un incidente al mes | 4 |
| Reunión mensual y reporte (disponibilidad, uso, lo que se cambió) | 3 |
| Bolsa de cambios menores | 3 |
| **Total** | **24** |

Con el precio de la hora de arriba: 24 × $1,747 ≈ **$41,938 al mes ≈ US$2,165 + IVA**, ≈ US$25,985 al año (el 38.7 % del precio del servidor de la opción A). Repartida entre las ≈ 66,000 preguntas al mes del despacho (3,000 al día × 22 días), la iguala son **≈ 64 centavos por pregunta**, contra ≈ 7 de la luz. Un mes con dos incidentes graves (16 horas más) cuesta ≈ US$3,609: la iguala dice qué pasa con las horas de más (se cobran aparte, a la tarifa de la hora, o se descuentan del mes siguiente).

**El manual y la escalación.** El TI del despacho no ha operado una GPU, pero puede seguir un manual: «si el tablero dice que una réplica no contesta, reinicia ese contenedor con este comando; si no vuelve en 10 minutos, abre la ventana de acceso y llama». Cada problema sube por tres escalones: el TI del despacho (lo que está en el manual), tu equipo (lo demás), el fabricante (el hardware). El contrato dice quién llama a quién y con qué datos.

**Un viaje.** Si tu equipo está en otra ciudad, una visita al despacho cuesta (supuestos) vuelo $4,500, dos noches $3,600 y traslados $800, más 16 horas de tiempo a $1,747: ≈ **$36,859**. La iguala no incluye visitas: se cotizan aparte, y el manual existe para que lo común no las necesite.

**Cuándo renovar el hardware.** La garantía de piezas dice el primer plazo: si son 3 años, al cuarto cada falla se paga completa. El segundo lo dice el tablero: si el uso de la hora pico se acerca a lo que el servidor da (hoy, el 86.8 % de la capacidad de salida), hay que crecer antes de que llegue la fila. Cuánto vale el servidor viejo ([[valor-de-reventa|reventa]]) y cuándo conviene cambiarlo ([[vida-util|vida útil]]) es la cuenta de [TCO: API, nube o servidor propio](/costo-total/).

## Errores comunes {Common mistakes}

1. **Prometer el criterio que el hardware no da.** Firmar TTFT ≤ 2 s con 3 L40S, que la cuenta dice que no lo cumplen. **Cómo evitarlo:** el criterio es del cliente; la opción que lo cumple se mide en el piloto, y si se acepta otro número, lo decide y lo firma el cliente.
2. **Un alcance sin «no incluye».** Cada «ya que estás» son horas sin cobrar. **Cómo evitarlo:** una lista de exclusiones tan cuidada como la de lo incluido, y un precio por hora para los cambios.
3. **Un SLA que se contradice solo.** 99.5 % en horario (66 minutos al mes) con 4 horas para resolver un caído. **Cómo evitarlo:** saca el presupuesto en minutos y revisa que el tiempo de solución de la severidad 1 quepa.
4. **Prometer 24 × 7 con dos personas.** **Cómo evitarlo:** cuenta las horas: cubrir 168 horas a la semana pide ≈ 4 personas; promete horario hábil o cotiza la guardia.
5. **Revender el servidor por el margen.** **Cómo evitarlo:** que el cliente compre directo al integrador y tú cobres por especificar, revisar e instalar.
6. **Cotizar en dólares sin decir con qué [[tipo-de-cambio|tipo de cambio]] ni hasta cuándo.** **Cómo evitarlo:** FIX del día hábil anterior al pago, o pesos con vigencia de 10 días y una regla si el peso se mueve más de 3 %.
7. **Usar los datos del cliente para algo tuyo.** Una demo, un benchmark, un modelo para otro cliente. **Cómo evitarlo:** prohibición expresa en el contrato; si lo haces, dejas de ser encargado y pasas a responsable.

## En la vida real {In real life} [extra]

**El despacho.** La propuesta sale con tres opciones de hardware y un solo criterio: el de los abogados. El piloto cuesta ≈ US$27,600 + IVA en tres pagos; la iguala, ≈ US$2,165 al mes, con un SLA de 99 % en horario hábil (132 minutos al mes), severidad 1 en 2 horas y créditos de 10 a 25 %. El servidor lo compra el despacho directo al integrador; si se importa, el importador es el despacho, con su agente aduanal, y cuesta ≈ 7 % más que el precio de lista, sin contar el IVA que se acredita.

**Una clínica que pide 24 × 7.** Los médicos de guardia también preguntan de noche. Prometerlo de verdad es otra cosa: con la reforma laboral publicada el 1 de mayo de 2026, la jornada máxima baja de 48 horas a la semana en 2026 a 40 en 2030, un año a la vez, y las horas extra se pagan al doble (art. 66) o al triple pasado cierto límite (art. 68). Cubrir 168 horas a la semana con una persona despierta, a 46 horas en 2027, son 168 ÷ 46 ≈ 3.65 personas, y con vacaciones e incapacidades (supuesto) ≈ 4.1. Encima, el hardware: con un 99.9 % en 24 × 7 hay 43.2 minutos al mes, que un reemplazo de tarjeta por mensajería rompe si no hay N+1. Y los expedientes clínicos tienen normas propias: eso, con su abogado sanitario. [La clínica](/casos/clinica/) propone una guardia en espera en vez de 4.1 personas.

**Una dependencia de gobierno.** Compra por licitación, con la Ley de Adquisiciones nueva (publicada el 16 de abril de 2025). Lo que cambia la propuesta: los plazos para presentar proposiciones son de al menos 15 días naturales en una licitación nacional y 20 en una internacional (art. 42); la dependencia acepta lo entregado en hasta 10 días hábiles (art. 72) y paga en **hasta 17 días hábiles** desde que la factura se envía y se verifica en su plataforma (art. 73), y si se atrasa, el proveedor puede pedir gastos financieros. Mucha gente dice «el gobierno paga a 60–90 días»; la ley no dice eso, aunque en la práctica puede tardar más por el trámite. [La dependencia de gobierno](/casos/gobierno/) pone el calendario completo, los topes de la invitación y el fraccionamiento. Los anticipos se pactan en el contrato y no pasan de 50 % del monto. Y el proveedor tiene que estar al corriente de sus impuestos para participar.

**Fuera de la IA.** El contrato de mantenimiento de un elevador tiene las mismas piezas: visitas programadas (la iguala), tiempos de respuesta por gravedad (gente atrapada contra un ruido raro), exclusiones (la luz del edificio) y la pieza que depende del fabricante. Nadie promete que un elevador nunca se detenga; se promete qué tan rápido llega el técnico.

## Ejercicios {Exercises}

:::ejercicios
? [facil] ¿Cuántos minutos al mes se puede caer un servicio con 99.5 % en el horario del despacho (10 h × 22 días) y en 24 × 7 (30 días)?
\(M\) en horario = 10 × 22 × 60 = 13,200; \(E = (1 − A) × M\) = 0.005 × 13,200 = **66 min**. En 24 × 7: \(M\) = 43,200; 0.005 × 43,200 = **216 min**.
? [facil] Tu hora cuesta $1,048. Si le sumas 40 % al costo, ¿a cuánto la vendes y cuál es tu margen real sobre el precio? ¿A cuánto tendrías que venderla para un margen de 40 %?
Sobreprecio: 1,048 × 1.40 ≈ **$1,468**; margen = 1 − 1,048 ÷ 1,468 ≈ **28.6 %**. Para 40 % de margen: \(p_h = c_h ÷ (1 − m)\) = 1,048 ÷ 0.60 ≈ **$1,747**.
? [facil] Un vendedor cotiza un equipo EXW en US$50,000; el flete es de US$2,000 y el seguro de 0.5 %. ¿Cuál es el valor en aduana al tipo de 19.3668, y cuánto son el DTA de 0.8 % y el IVA, con arancel 0?
\(V\) = (50,000 + 2,000 + 250) × 19.3668 = 52,250 × 19.3668 ≈ **$1,011,915**. DTA = 0.008 × 1,011,915 ≈ **$8,095**. IVA = 0.16 × (1,011,915 + 0 + 8,095) ≈ **$163,202**.
? [medio] En un mes, el servicio del despacho estuvo caído 300 minutos del horario. ¿Qué disponibilidad tuvo y qué crédito le toca, con la tabla del despacho?
\(A\) = 1 − 300 ÷ 13,200 ≈ **97.7 %**: abajo de 98 %. Crédito de **25 %** de la iguala: 0.25 × 41,938 ≈ **$10,484** (el escalón más alto; el tope es ese mismo 25 %).
? [medio] Falla una L40S un martes. ¿Cuántos lugares quedan con la opción A y con la B, contra las ≈ 5.7 conversaciones de la hora pico? ¿Cuántas preguntas por hora aguanta la opción A con una tarjeta menos, si cada respuesta tarda ≈ 27 s?
A: 2 réplicas × 2 = **4** lugares, menos que 5.7: degradado en el pico. B: 3 × 2 = **6** ≥ 5.7: mismo servicio. Por Little, 4 lugares ÷ 27 s × 3,600 ≈ **533** preguntas por hora: 1.8 veces el promedio de 300, menos que las 750 del pico.
? [medio] A la mitad del piloto, el despacho pide conectar su sistema documental. Lo estimas en 80 horas. ¿Cómo lo cobras y cuánto es?
Es un **cambio de alcance** (está en el «no incluye»): por hora con tope, aparte del precio cerrado. 80 × $1,747.41 ≈ **$139,793 ≈ US$7,218** + IVA, con el tope por escrito y su efecto en el calendario.
? [reto] La clínica quiere 24 × 7 con alguien despierto siempre. Con 46 horas a la semana (2027) y un factor de 1.12 por vacaciones e incapacidades, ¿cuántas personas son? Con el costo cargado de $118,125 al mes por persona, ¿cuánto cuesta la guardia al mes y cuántas igualas del despacho son?
168 ÷ 46 × 1.12 ≈ **4.1 personas**. 4.09 × 118,125 ≈ **$483,183 al mes ≈ US$24,949**, ≈ **11.5** igualas de $41,938. Por eso un 24 × 7 se cotiza aparte, o con una guardia remota pagada, nunca dentro de una iguala de horario.
? [reto] Un cliente quiere 99.5 % en horario (10 h × 22 días). ¿Cuánto puede durar cada incidente si esperas dos al mes? ¿Qué te obliga a diseñar?
\(E\) = 66 min; entre 2, **33 min** por incidente: menos de lo que tarda alguien en ver la [[alerta|alerta]], pedir el acceso y arreglar. Obliga a que el sistema se recupere **solo**: réplicas de sobra que tomen el lugar de la que cae, reinicio automático, y el humano para después.
:::

## Lo que sigue {What comes next} [extra]

- **Los seis casos** (el índice está en [los casos](/casos/)): [el despacho](/casos/despacho/) decide el hardware y arma la pregunta de prueba del SLA, [la clínica](/casos/clinica/) lleva todo a datos de salud, [la fábrica](/casos/fabrica/) a una planta sin internet, [la financiera](/casos/financiera/) a un lote nocturno de llamadas, [la dependencia de gobierno](/casos/gobierno/) a una red sin ninguna conexión y a la compra pública, y [la startup SaaS](/casos/saas/) a varios clientes sobre el mismo servidor; cada uno termina en una propuesta.
- **[TCO: API, nube o servidor propio](/costo-total/)** suma lo que esta lección cotiza (piloto, iguala, importación) con la depreciación y la luz, y dice cuánto cuesta cada pregunta en cada opción.
- **[Observabilidad de GPUs e inferencia](/observabilidad/)** construye el [[tablero|tablero]] de donde sale el SLA: el TTFT p95 y las [[alerta|alertas]], al que se le suma la pregunta de prueba de cada minuto (su diseño completo, con el panel y las alertas que se agregan, está en [el caso del despacho](/casos/despacho/)).
- **[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)** es la mitad técnica del contrato: las medidas que promete el encargado y la ventana de acceso para soporte.
- De esta app: [El recorrido](/recorrido/) tiene el calendario del piloto; [Comprar hardware](/comprar-hardware/), la cadena de vendedores y las preguntas de garantía; [Demostrar que el modelo abierto sirve](/evals/) y [Pruebas de carga](/pruebas-carga/), los criterios de aceptación.
- En Sensei: [Datos personales y la ley](https://sensei.trueml.app/privacidad/), [Qué es la nube](https://sensei.trueml.app/nube/) y [Regiones, zonas y disponibilidad](https://sensei.trueml.app/regiones/).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
propuesta alcance entregable precio-por-proyecto iguala sla disponibilidad tiempo-de-respuesta penalizacion contrato-de-servicios encargado-de-datos importacion pedimento agente-aduanal arancel incoterm valor-en-aduana dta
:::

## Chequeo {Check}

:::chequeo
? ¿Qué hace que una promesa de servicio sea un SLA y no un SLO?
Que tiene una consecuencia explícita si no se cumple (créditos, una pena). Sin consecuencia, es una meta interna.
? ¿Cuántos minutos al mes da un 99 % en el horario del despacho?
132: 1 % de 13,200 minutos (10 h × 22 días).
? ¿Por qué la opción A no es N+1 y la B sí?
Con 3 L40S y una caída quedan 4 lugares, menos que las ≈ 5.7 conversaciones del pico; con 4, quedan 6.
? ¿Dónde están las obligaciones de la persona encargada, a noviembre de 2026?
En el Reglamento de 2011 (arts. 49 a 55): la ley de 2025 la define pero no le pone obligaciones.
? ¿Cuánto arancel paga el servidor del despacho y por qué el DTA no es cero?
Cero: 8471.50.01 está exenta y el aumento de 2026 no la tocó. El DTA se cobra por el trámite: 0.8 % del valor, o $461.61 si se acredita origen T-MEC.
? ¿Por qué el IVA de importación no es un costo, pero sí un problema?
Porque se acredita después; pero hay que pagarlo en la aduana (≈ $219 mil para la opción A).
:::
