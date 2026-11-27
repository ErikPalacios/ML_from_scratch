---
titulo: Fábrica
en: Sizing case: an auto-parts plant
subtitulo: Una planta de autopartes en Silao quiere que sus técnicos de mantenimiento le pregunten a los manuales de 220 máquinas desde una tablet, en cuatro idiomas, sin internet en la red de planta y sin que el asistente invente nunca un torque.
pregunta: El gerente de mantenimiento pregunta «¿qué necesito para que mis técnicos encuentren el dato del manual en la línea, a cualquier hora, sin conectar la planta a internet y sin que nadie se lastime por una respuesta equivocada?». ¿Qué modelo, qué GPU, dónde va el servidor, cómo se prueba y cuánto cuesta?
requisitos: recorrido, requisitos-hardware, elegir-modelo, rag-privado, seguridad, el-cuarto, evals, costo-total
sensei: redes-nube, probabilidad, ataques
---

:::idea
En esta planta la capacidad no es el problema: 30 técnicos usan ≈ 1 % de una sola GPU. Deciden otras tres cosas: **dónde puede vivir el servidor** (una red de planta sin internet y una nave a 35 °C con polvo metálico), **qué modelo lee bien una tabla de torques escaneada** en alemán o en japonés, y **una regla de seguridad**: ningún valor ni ningún paso de bloqueo sale de la memoria del modelo; todo sale del manual, con su página y el recorte de la tabla. El caso cotiza dos servidores, firma antes del examen la regla para elegir entre ellos, y muestra que cada pregunta sale cara y aun así el servidor se paga con diez minutos de línea parada al mes.
:::

## La llamada de la planta {The plant's call}

El gerente de mantenimiento de **la planta** llama un martes. Es un proveedor de autopartes (Tier 1: le vende directo a las armadoras) en **Silao, Guanajuato**, el estado con más unidades que fabrican partes para vehículos en el directorio de empresas del INEGI de mayo de 2026: 233 de 2,208. La planta y sus números son ficticios; los del mundo real (normas, modelos, precios) llevan su fecha.

- **220 máquinas de 25 fabricantes** (prensas, soldadoras, robots, centros de maquinado, inyectoras), ≈ 60 modelos, con **3,000 manuales** de ≈ 200 páginas.
- **Cuatro idiomas**: inglés (40 %), alemán (20 %), japonés (15 %) y español (25 %). Los técnicos preguntan en español.
- **El 40 % son escaneos**, algunos de los años noventa, con tablas de torques y diagramas eléctricos.
- **Tres turnos** (7–15, 15–22 y 22–7 h) y **30 técnicos de mantenimiento**: 12, 12 y 6. De noche no hay nadie de TI.
- **La red de planta no tiene internet**, por regla. La de oficina sí.

El problema, dicho por él: «Cuando una prensa se para a las 2 de la mañana, el técnico pierde media hora buscando en qué manual, en qué página y en qué idioma está el dato. Y a veces se lo pregunta al de al lado, que se acuerda mal».

La ficha de la planta (`content/fabrica.json`) junta sus números. Los que más usa el caso:

| Dato | Valor |
|---|---|
| Técnicos | 30 (12 + 12 + 6 por turno) |
| Preguntas | 8 por técnico y turno: 240 al día, 6,240 al mes (26 días) |
| Manuales | 600,000 páginas, ≈ 540 M de tokens; 40 % escaneadas |
| Red | OT sin internet; el site de TI, con aire, está en oficinas, a ≈ 300 m de la nave |
| Nave | ≈ 35 °C, picos de 40 °C en verano, polvo metálico y neblina de aceite |
| Quién opera | 3 personas de TI y 1 ingeniero de automatización; nadie ha operado una GPU |

**Por qué privado.** El despacho de [El recorrido](/recorrido/) quería un modelo propio por el secreto profesional. Aquí la razón es más dura: la red de planta no sale a internet, así que una API pública no es una opción técnica. Se suman la licencia de cada manual y la confidencialidad de los procedimientos y los planos.

**La pregunta honesta** de «Cuándo NO conviene», en el recorrido: ¿vale la pena una GPU para ≈ 10 preguntas por hora? Sí, porque la red no deja otra opción y una hora de línea parada cuesta más que el servidor. Pero cambia lo que se compra: **no se compra por carga, sino por disponibilidad y por calidad**.

## Requisitos: lo que pide la línea {Requirements: what the line needs}

:::intenta ¿Cuántas conversaciones hay a la vez en la hora pico?
La hora pico es la primera del turno 1: supuesto de 30 preguntas, un [[factor-de-pico|factor de pico]] de 3. Las respuestas son de 300 tokens a 15 tokens por segundo y el primer token tarda ≈ 0.5 s. Con la [[ley-de-little|ley de Little]], ¿cuántas conversaciones hay abiertas a la vez en promedio? ¿Alcanza ese número para diseñar?
???
1. Llegadas: 30 en 3,600 s = 0.0083 por segundo (lo mismo que 30 técnicos × 8 ÷ 86,400 s × 3).
2. Duración: ≈ 0.54 s + 300 ÷ 15 = 20 s ≈ 20.5 s.
3. Little: 0.0083 × 20.5 ≈ **0.17 conversaciones**. La herramienta de sizing da lo mismo: [ábrela con los números de la planta](/herramientas/sizing/?p1=l40s&U=30&r=8&Np=3500&No=300&h=24&pk=3&v=15&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3).
4. **No alcanza**: es un promedio, y en un paro las preguntas no llegan al azar (abajo).
:::

**Funcionales.** Contestar sobre los manuales de **la máquina que el técnico tiene enfrente**, con manual y página. Si es un **valor** (torque, presión, holgura), mostrarlo con su unidad **y el recorte de la tabla** que lo sostiene. Si es un **bloqueo de energía**, mostrar el procedimiento **de la planta** para esa máquina. Si no lo encuentra, decirlo y a quién preguntar.

**No funcionales** ([[requisito-no-funcional|requisitos no funcionales]]): el valor y su cita, el «primer renglón» de ≈ 40 tokens, en ≤ 5 s en el p95; el primer token en ≤ 3 s; ≥ 15 tokens por segundo por técnico; 24/7 sin nadie de TI de noche; sin internet y sin tocar ninguna máquina.

¿Por qué 15 y no los 20 del despacho? El técnico lee el valor, que va al principio, y baja la vista a la máquina; la respuesta completa termina en ≤ 3 + 300 ÷ 15 = **23 s**. Es un criterio que firma la planta, no un dato.

### El perfil de carga

8 preguntas por técnico y turno: 96 + 96 + 48 = **240 al día**, ≈ 10 por hora. Cada pregunta lleva ≈ **3,500 tokens**: instrucciones (≈ 400), la pregunta (≈ 50), 5 fragmentos de ≈ 400 (2,000) y **la imagen de la página de la tabla**, ≈ 1,000. Ese último es un supuesto: cuántos tokens cuesta una página depende del modelo y de la resolución, y nadie lo publica para manuales técnicos. La respuesta, ≈ **300 tokens**; el tope de contexto, **8,192**.

:::formula Conversaciones a la vez (ley de Little)
c = λ × (T_{ttft} + frac{N_o}{v})
- c: conversaciones abiertas a la vez, en promedio
- λ: preguntas por segundo en la hora pico
- T_{ttft}: tiempo al primer token, en s
- N_o: tokens de cada respuesta; v: tokens por segundo de cada conversación
:::

:::cuenta El pico de la planta
Llegadas, \(λ\) // 240 al día ÷ 86,400 s × el factor de pico de 3 | 240 ÷ 86,400 × 3 | 0.0083 por s
Duración, \(T_{ttft} + N_o ÷ v\) // primer token de la herramienta de sizing + 300 tokens a 15 por s | 0.54 + 300 ÷ 15 | 20.54 s
Conversaciones, \(c\) | 0.0083 × 20.54 | 0.17
Si llegaran al azar, ¿qué tan seguido habría 4 a la vez? // Poisson con media 0.17 | P(≥ 4) | ≈ 3 de cada 100,000 instantes
= En promedio hay 0.17 conversaciones: la GPU casi siempre espera. Al azar, cuatro a la vez casi nunca pasan. En un paro pasan siempre.
:::

**El paro rompe el supuesto.** El «3 de cada 100,000» supone llegadas independientes (Poisson, el de [Probabilidad](https://sensei.trueml.app/probabilidad/)). Cuando la línea 3 se para, los cuatro técnicos de esa celda (el grupo de máquinas que trabajan juntas en un tramo de la línea) preguntan **lo mismo, al mismo tiempo**: las llegadas vienen en ráfaga. Por eso el número de diseño es **4 conversaciones a la vez**, el mismo papel que tuvieron las 8 del despacho.

### Lo nuevo: la seguridad de la persona

Un técnico con un torque equivocado puede romper una máquina o lastimarse. Y una tarea es de vida o muerte: el **[[bloqueo-y-etiquetado|bloqueo y etiquetado]]** (*lockout/tagout*, LOTO), cortar todas las energías de una máquina antes de meterle las manos. Lo pide la **NOM-004-STPS-1999** (vigente): lo hace el encargado del mantenimiento, con **tarjetas de aviso y candados**, y **quien pone las tarjetas es quien las quita**; lo eléctrico, la **NOM-029-STPS-2011** (también vigente). La norma no trae el procedimiento de cada máquina: exige que la planta tenga el suyo. Por eso el asistente no «sabe» cómo se bloquea la prensa 7: solo **muestra la hoja de la planta**. (Estados de las dos normas en el catálogo de la Secretaría de Economía, consultado el 2026-11-27. Es orientación para diseñar el asistente, no asesoría: lo que la planta debe cumplir lo confirma su responsable de seguridad e higiene.)

:::profundo Lo que dice la norma, con más detalle
El apartado 7 de la NOM-004-STPS-1999, en su parte de mantenimiento, pide además avisar antes a los trabajadores involucrados, identificar interruptores, válvulas y puntos a inmovilizar, asegurar que el bloqueo se hizo y avisar al retirarlo; el registro del mantenimiento preventivo y correctivo se guarda al menos 12 meses. La NOM-029-STPS-2011 (vigente desde el 29 de marzo de 2012) agrega para lo eléctrico verificar la ausencia de tensión, poner a tierra y retirar los candados al final, y admite tarjetas de libranza (quién realiza, quién autoriza, cuándo empieza y termina).

Un dato de calendario: el proyecto de modificación, PROY-NOM-004-STPS-2020 (fechado en diciembre de 2020 y publicado en el DOF el 8 de febrero de 2021), cambiaría «tarjetas **y** candados» por «tarjetas **o** candados». Casi seis años después sigue siendo proyecto: no se cita como vigente. Al asistente no le cambia nada: muestra la hoja de la planta, sea cual sea la norma.
:::

:::profundo Lo que falta preguntar
Del [[descubrimiento]] quedan preguntas que cambian el diseño: ¿qué temperatura hay de verdad en la nave (el 35 °C es un supuesto; se mide con un registrador en el mes más caliente)? ¿Se maquina aluminio o magnesio (sus polvos son combustibles y cambian dónde puede ir un equipo eléctrico)? ¿Qué dice la licencia de cada manual (decide qué entra a un piloto fuera de la planta)? ¿Existe una tabla de números de serie con el modelo, la revisión y el manual de cada máquina? ¿Quién firma la entrada de un equipo nuevo a la red de planta? ¿Hay WiFi de planta y tablets? (Supuesto del caso: sí, una WiFi de planta como zona aparte y tablets compartidas por celda.)
:::

## Cálculos: memoria, velocidad y cuántas GPUs {Calculations: memory, speed and how many GPUs}

En noviembre de 2026 los modelos abiertos de uso general ya leen imágenes: son [[vlm|modelos de visión y lenguaje]]. La lección [Elegir un modelo](/elegir-modelo/) explica cómo se filtra; aquí pasan dos de la misma familia, los dos [[apache-2|Apache 2.0]] (fechas de Hugging Face: 2026-11-07 el grande y 2026-03-02 el chico):

| | Qwen3.8-27B (el grande) | Qwen3.5-9B (el chico) |
|---|---|---|
| Parámetros | 27.8 mil millones, denso | 9.65 mil millones |
| Bloques | 64, solo 16 con atención completa | 32, solo 8 con atención completa |
| K y V por bloque | 4 juegos de 256 números | 4 juegos de 256 |
| Archivos | 30.87 GB en FP8 (repo oficial) | 19.31 GB en BF16 |
| Formato en el caso | FP8 oficial | [[fp8-dinamico\|FP8 dinámico]] (vLLM lo cuantiza al cargar) |

No hace falta un modelo «industrial»: la regla de seguridad le **prohíbe** usar lo que sabe para los números; tiene que **leer** bien la página. Dos huecos: ninguna tarjeta de Qwen nombra el alemán ni el japonés, y **ningún benchmark público** mide si un modelo copia bien un torque escaneado. Los mide el examen.

**Una arquitectura que ahorra memoria.** Solo 1 de cada 4 bloques tiene atención completa y guarda su [[kv-cache|KV cache]]; los otros guardan un resumen de tamaño fijo (≈ 154 MB por conversación en el de 27B, la cuenta de «Elegir un modelo»). En las herramientas eso se escribe con **L = 16** (los bloques que guardan KV) y **3 GB** de programa (2 del programa + 1 de margen para el resumen). El KV por token: \( 2 × 16 × 4 × 256 × 2 \) bytes = **64 KiB**, la cuarta parte de lo que pide Qwen3 32B en el despacho.

:::intenta ¿Cabe el 27B en FP8 con 4 conversaciones de 8,192 tokens? ¿En qué GPU?
Con P = 27.78 mil millones, tablas de tokens E = 2.543 mil millones (se quedan en 16 bits), FP8 de 1 byte, 64 KiB por token, 4 conversaciones de 8,192 tokens y 3 GB de programa, calcula la memoria total. ¿Cabe en una L4 de 24 GB? ¿En una L40S de 48 GB, con 10 % de margen?
???
1. Pesos: (27.78 − 2.543) × 1 + 2.543 × 2 = **30.32 GB** (el archivo pesa 30.87: la diferencia es la parte de visión, que la fórmula no separa).
2. KV: 65,536 bytes × 8,192 × 4 = **2.15 GB**. Total: 30.32 + 2.15 + 3 = **35.47 GB**.
3. L4: 0.9 × 24 = 21.6 GB útiles: **no cabe**, ni los pesos solos.
4. L40S: 43.2 GB útiles: **cabe**, al 82 %, y caben 18 conversaciones de 8,192. [Ábrelo en la herramienta de VRAM](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=8192&u=4&V=l40s&prog=3).
:::

:::formula La memoria de una copia
M = W + m_{token} × N × u + M_{prog}
- M: lo que necesita la copia, en GB
- W: los pesos, \((P − E) × b ÷ 8 + E × 2\), en GB
- m_{token}: KV cache por token, \(2 × L × g × d × b_{kv}\), en bytes
- N: tokens por conversación; u: conversaciones a la vez
- M_{prog}: el programa, aquí con el resumen fijo de los bloques sin atención completa, en GB
:::

:::cuenta Las tres combinaciones que importan
27B en FP8 en una L40S | 30.32 + 2.15 + 3 | 35.47 de 43.2 GB · cabe (82 %)
9B en FP8 en una L4 // P 9.65, E 2.034, L = 8: 32 KiB por token | 11.68 + 1.07 + 3 | 15.76 de 21.6 GB · cabe (73 %)
27B en INT4 de AWQ en una L4 // 4.156 bits por peso | 18.20 + 2.15 + 3 | 23.34 de 21.6 GB · no cabe
= El grande pide una tarjeta de 48 GB. El chico cabe en una L4 de 24 GB, con lugar para 25 conversaciones. El grande no entra en una L4 ni a 4 bits.
:::

El 9B en la L4, [en la herramienta](/herramientas/vram/?P=9.65&Et=2.034&bits=8&L=8&g=4&d=256&bkv=2&N=8192&u=4&V=l4&prog=3); el 27B a 4 bits en la L4, [aquí](/herramientas/vram/?P=27.78&Et=2.543&bits=4.15625&L=16&g=4&d=256&bkv=2&N=8192&u=4&V=l4&prog=3) (4.156 bits por peso es el [[awq|AWQ]] de [Formatos y cuantización](/formatos-cuantizacion/)). Las tablas de tokens del 9B (E = 2.034) son dos, de entrada y de salida, de 248,320 × 4,096: el vocabulario y el ancho salen de su `config.json` en Hugging Face (consultado el 2026-11-27).

### La velocidad, con 4 técnicos a la vez

Escribir lo manda leer los pesos en cada paso ([[memory-bound]], como en [Requisitos de hardware](/requisitos-hardware/)). Con las eficiencias de las herramientas (\(η_m\) = 0.7, \(η_c\) = 0.5):

| Combinación | Tokens/s por técnico | Primer token | Primer renglón | ¿Pasa? |
|---|---|---|---|---|
| 27B FP8 en L40S | ≈ 19.3 | ≈ 0.54 s | ≈ 2.6 s | sí |
| 9B FP8 en L4 | ≈ 17.3 | ≈ 0.56 s | ≈ 2.9 s | sí |
| 27B INT4 de AWQ en L4 | ≈ 11.0 | ≈ 3.25 s | ≈ 6.9 s | no (y no cabe) |

De la herramienta de velocidad: [27B en L40S](/herramientas/velocidad/?p1=l40s&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=3500&No=300&b=4), [9B en L4](/herramientas/velocidad/?p1=l4&P=9.65&A=9.65&Et=2.034&L=8&g=4&d=256&q=16&bits=8&cf=2&Np=3500&No=300&b=4), [27B a 4 bits en L4](/herramientas/velocidad/?p1=l4&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=4.15625&cf=1&Np=3500&No=300&b=4). No cuentan la cola, la red ni el codificador de imagen: por eso el piloto mide.

:::profundo Dos detalles de la tabla
Las cabezas de atención (24 para el 27B y 16 para el 9B) salen del `config.json` de cada modelo en Hugging Face (consultado el 2026-11-27); en un prompt de 3,500 tokens pesan ≈ 1 % del primer token. Y el AWQ sale lento en el primer token porque calcula en 16 bits: la L4 tiene 121 billones de operaciones por segundo en FP16 y el doble en FP8, así que el 9B en FP8 lee lo mismo en ≈ 0.56 s.
:::

### Cuántas GPUs

Por carga, **una**: la herramienta de sizing da una copia ([27B en L40S](/herramientas/sizing/?p1=l40s&U=30&r=8&Np=3500&No=300&h=24&pk=3&v=15&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3), [9B en L4](/herramientas/sizing/?p1=l4&U=30&r=8&Np=3500&No=300&h=24&pk=3&v=15&P=9.65&A=9.65&Et=2.034&L=8&g=4&d=256&q=16&bits=8&prog=3)). A 15 tokens por segundo, la L40S mantiene 7 conversaciones con el 27B y la L4 justo 4 con el 9B: el paro cabe. Pero si la única GPU falla a las 3:00, la línea se queda sin asistente hasta el día siguiente. Por eso son **2 GPUs con una copia completa cada una**, la [[n-mas-1|N+1]]: se dimensiona por disponibilidad, como adelantó [Requisitos de hardware](/requisitos-hardware/). Una L40S atiende ≈ 1,227 preguntas por hora (7 × 3,600 ÷ 20.54 s) y la planta hace 240 al día: una GPU trabaja **≈ 0.8 % del día**, la [[utilizacion-del-servidor|utilización]] más baja de la app, y la correcta.

## Dónde vive: la red de planta y el lugar {Where it lives: the plant network and the place}

Este paso no existe en una oficina. Hay que decidir dos cosas que se confunden: **en qué zona de la red** vive el asistente y **en qué lugar físico** está la caja.

### La red OT y sus niveles

La planta tiene dos redes: la de oficina, **IT** (correo, ERP, laptops), y la **[[red-ot|red OT]]**, que une los controladores (PLCs, las computadoras industriales que mueven cada máquina), los robots y los servidores que vigilan la producción. En OT las prioridades se invierten: primero la **disponibilidad** y la seguridad de las personas. Los equipos duran 15 o 20 años, no se parchan sin parar la línea y hablan protocolos sin contraseña: por eso viven separados y sin internet.

:::analogia La cocina y el comedor
En un restaurante, el comedor atiende a la gente; en la cocina hay fuego y cuchillos, entra solo el personal y los platos pasan por una ventanilla. La red de oficina es el comedor; la red OT, la cocina; la ventanilla, un conducto con reglas.

Dónde se rompe: en la cocina un error se ve y se huele. En OT, un comando mal dado por la red puede mover una prensa sin que nadie esté mirando, y por eso la ventanilla es mucho más estrecha.
:::

Una planta se ordena por capas con el **[[modelo-purdue|modelo de Purdue]]**: nivel 0 los sensores y motores; 1 los controladores; 2 la supervisión de cada línea; 3 las operaciones del sitio (el MES, el sistema que lleva la producción, y el historiador, la base de datos que guarda las lecturas de cada sensor); 4 y 5 la empresa. Entre 3 y 4, la **[[dmz-industrial|DMZ industrial]]** («3.5»): lo que IT y OT comparten se deja ahí, y ninguna habla directo con la otra. La guía de referencia es **NIST SP 800-82 Rev. 3** (septiembre de 2023): dejar pasar solo entre niveles vecinos.

El vocabulario para decidir es el de **[[iec-62443|ISA/IEC 62443]]**, la serie de normas de ciberseguridad de los sistemas de control industrial: **[[zona-y-conducto|zonas y conductos]]**. Una zona agrupa equipos con necesidades de seguridad parecidas; un conducto es el único camino, con nombre y reglas, entre dos zonas. Es la [[segmentacion-de-red|segmentación]] de [Seguridad](/seguridad/) con el idioma de la industria, y a cada zona se le fija un **[[nivel-de-seguridad|nivel de seguridad]] objetivo** (SL-T), del 1 (errores accidentales) al 4 (atacantes con recursos extremos).

:::intenta ¿En qué zona va el asistente y qué conductos necesita?
El asistente lee manuales y contesta a tablets en la WiFi de planta; no controla ninguna máquina. Los manuales nuevos los aprueba ingeniería, en la red de oficina. El servidor necesita actualizaciones. ¿En qué nivel va? ¿Qué conductos abre, y en qué sentido? ¿Qué conducto **no** abre?
???
1. **Nivel**: no es 0, 1 ni 2, porque no controla nada. Va en una **zona propia pegada a la DMZ industrial**.
2. **Conducto 1, las tablets**: de la WiFi de planta al gateway, solo HTTPS al 443.
3. **Conducto 2, los manuales**: ingeniería deja el PDF en una carpeta revisada de la DMZ y la ingesta lo recoge **desde la zona** del asistente: la conexión la abre la zona, nunca la oficina.
4. **Conducto 3, la gestión**: el ingeniero de automatización entra desde OT por la DMZ; las actualizaciones llegan como los manuales, por la [[maquina-puente|máquina puente]] de la DMZ.
5. **Lo que no se abre**: nada hacia los PLCs, los robots ni el MES, y ninguna ruta a internet.
:::

:::figura caso-fabrica-zonas
La planta por niveles y la zona del asistente. Los tres conductos están numerados; lo que no tiene flecha no existe. La zona es de seguridad, no de edificio.
:::

**Lo que no se promete**: que el servidor «cumple IEC 62443». Lo defendible es «la zona está diseñada para un **SL-T 2** con estas contramedidas».

:::profundo Las partes de IEC 62443, el diodo y quién entra
La certificación es de productos y procesos, por organismos acreditados, y un servidor armado con piezas comerciales no declara su capacidad (SL-C): por eso no se promete. El SL-T 2 es un supuesto de diseño que la planta revisa con su integrador.

La serie no es una norma sino varias partes, y a cada quien le toca la suya (ediciones según ISA, consultado el 2026-11-26): la 2-1 (2024; la de 2010 se retiró el 7 de agosto de 2024) es el programa de seguridad del dueño de la planta; la 3-2 (2020), cómo el dueño y su integrador evalúan el riesgo y parten en zonas y conductos; la 3-3 (2013, estable hasta 2027) y la 4-2 (2018), los requisitos que el dueño exige a lo que compra; la 2-4 y la 4-1 (2018), las del integrador y del fabricante. Un nivel de seguridad es en realidad un vector de siete valores, uno por requisito fundamental (identificación, control de uso, integridad, confidencialidad, flujo restringido de datos, respuesta a eventos y disponibilidad), con tres sabores: objetivo (SL-T), capacidad del componente (SL-C) y logrado (SL-A).

La guía del NIST (§5.2.3.1) pide además caracterizar, segmentar y aislar IT y OT, que nada del nivel 4 hable directo con el 2, el 1 o el 0, considerar una DMZ como frontera y reglas de salida tan estrictas como las de entrada. Menciona como alternativa al firewall el **[[diodo-de-datos|diodo de datos]]**, que deja pasar en un solo sentido por construcción. Los manuales podrían entrar por uno; el caso no lo exige (su precio no está en los datos): la carpeta revisada con firewall basta para un SL-T 2. Y un dato de calendario: el NIST tiene en consulta el borrador de la **Rev. 4** de la SP 800-82, con comentarios hasta el 30 de noviembre de 2026.

**Quién entra.** En el despacho, cada abogada entraba con su cuenta de Microsoft (SSO con [[entra-id|Entra ID]]), que necesita hablar con `login.microsoftonline.com`. En una zona sin internet eso no existe: las cuentas son **locales**, con el número de empleado, y las da de alta el supervisor de mantenimiento; las tablets, compartidas por celda, cierran la sesión a los 15 minutos sin uso. Si la planta tiene un directorio de usuarios propio en la DMZ, el asistente lo consulta por LDAP (el protocolo estándar de esos directorios). Lo que no cambia: cada pregunta queda en el [[registro-de-auditoria|registro]] con quién la hizo.
:::

### El lugar: el servidor no tiene que estar junto a la línea

El primer impulso es poner el servidor «donde se usa», en el gabinete de OT junto a la línea 3. Pero **lo que tiene que estar en la línea es la tablet, no el servidor**: la pregunta viaja por la red en milisegundos. La cuestión es qué lugar aguanta al servidor.

- **Un servidor común** está hecho para la clase A2 de ASHRAE: 10 a 35 °C a la entrada del aire. En la nave queda en el borde, y en verano fuera.
- **Un [[servidor-de-borde|servidor de borde]]** como el Lenovo ThinkEdge SE455 V3 opera de −5 a 55 °C con tarjetas de ancho sencillo, como la L4 (72 W), pero **limita las GPUs de ancho doble a 40 °C**. La L40S (350 W, [[tarjeta-pasiva|pasiva]], ancho doble) no tiene margen.
- **El polvo**: los filtros de esos servidores son de calidad de oficina: MERV 2 o 4, en una escala de filtros de aire que llega a 16. Con polvo metálico y neblina de aceite haría falta, además, un gabinete cerrado con su propio aire.

:::figura caso-fabrica-temperaturas
Rangos de operación contra la nave. Solo un servidor de borde con tarjetas de ancho sencillo (la L4) deja margen sobre los 40 °C del verano; una GPU de ancho doble se queda justo en el pico.
:::

Con el 27B (L40S), el site de TI es el único lugar; con el 9B (L4), también es lo más simple, y la nave solo si la temperatura medida lo permite. Esto afina la fábrica «sin cuarto de TI con aire» de [Comprar hardware](/comprar-hardware/): esta planta sí tiene uno, y el modelo grande pide 48 GB y aire.

:::profundo El grado IP, el polvo combustible y la norma eléctrica
**El [[grado-ip|grado IP]] no basta.** La IEC 60529 (versión consolidada 2.2, de 2013) define dos dígitos: polvo y agua. IP5X es protegido contra polvo; IP6X, hermético. Un servidor de rack no publica ningún grado, y el IP **no cubre aceite ni taladrina** (el refrigerante con aceite de las máquinas de corte): hay que preguntar por el fluido.

**El polvo combustible cambia el lugar, no el grado.** Si la planta maquina aluminio o magnesio, esos polvos están en la clasificación de áreas peligrosas de la NOM-001-SEDE-2012 (Artículo 500 y siguientes): ningún equipo eléctrico va ahí sin la envolvente adecuada.

**El site como sala de TI.** La misma NOM-001-SEDE-2012 (vigente; la viste en [El cuarto](/el-cuarto/)) tiene un Artículo 645 para las salas de equipos de TI: si el site se declara así, pide desconectar de una vez todo el equipo y su aire, aire dedicado, acceso solo del personal necesario y paredes resistentes al fuego; los UPS de adentro también se desconectan. Un gabinete en la línea no es una sala: ahí el 645 no aplica y valen las reglas generales.
:::

### Las opciones de hardware

Entran cuatro candidatas y dos se descartan rápido (abajo, por qué). Quedan **A** (2 × L4 con el 9B) y **B** (2 × L40S con el 27B), y no las separa la velocidad: las separa **qué modelo lee bien la tabla de torques**.

:::profundo Las dos que se descartan
**C**, una RTX PRO 6000 Server Edition (96 GB), pasa de sobra (≈ 35.7 tokens por segundo con 4 a la vez, [en la herramienta de velocidad](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=3500&No=300&b=4)), pero con una tarjeta no hay N+1 y no tiene precio de lista. **D**, un kit de desarrollo Jetson AGX Thor (128 GB a 273 GB/s, desde US$3,499 según NVIDIA, agosto de 2025), tiene un techo de ≈ 9 tokens por segundo con el 27B en FP8 (273 GB/s ÷ 30.87 GB), y un kit de desarrollo no es un equipo de planta.
:::


| | A · 2 × L4 + Qwen3.5-9B | B · 2 × L40S + Qwen3.8-27B |
|---|---|---|
| Servidor | de entrada (≈ US$8,000, supuesto) o de borde (sin precio publicado) | Exxact TensorEX 4U, 2 × EPYC 9124, 384 GB |
| Compra | ≈ US$15,248 (supuesto) | US$58,281.30 (calculado, 2026-11-25) |
| Por GPU a 15 tokens/s | 4 conversaciones | 7 |
| Consumo de las GPUs | 2 × 72 W | 2 × 350 W |
| Dónde | site (o la nave, si la temperatura medida lo permite) | solo el site |
| Riesgo | que el chico lea mal las tablas escaneadas | pagar de más si el chico bastaba |

:::profundo De dónde salen los precios
El de A es un supuesto: ≈ US$8,000 por un servidor de entrada (la cifra que trae la herramienta de TCO) más 2 L4 a US$3,624 (los datos de la app, mercado secundario). El Supermicro SYS-111E-FDWTR (1U, hasta 2 L4) aparece a US$3,279 sin GPU en una tienda (fuente secundaria), pero trae **fuentes de corriente continua**, que una planta con 127/220 V de alterna no tiene; el SE455 V3 no publica precio. El de B sale del configurador de Exxact: base de US$40,461.30 más US$8,910 por L40S. Está sobrado (10 ranuras, dos procesadores), pero es el único servidor con precio publicado en los datos de la app; un 2U de un integrador local probablemente sale más barato.
:::

**La decisión: se presupuesta B y se celebra A.** Se cotizan las dos y la regla se firma **antes** del examen: si el 9B pasa los tres criterios de aceptación en el examen y en la prueba en sitio, se compra A; si no, B. Al gerente se le presupuesta B: un cliente nunca debe llevarse una sorpresa hacia arriba. Las dos van **en el site de TI, en la zona del asistente**: una fibra propia hasta el firewall de la DMZ industrial y ningún cable al switch de oficina.

## El stack: lo que cambia en la planta {The stack: what changes at the plant}

Casi todas las piezas son las del despacho. Aquí solo lo que cambia.

:::intenta ¿Traducir los manuales al español antes de indexarlos?
Una idea que siempre aparece: «traduzcamos los 540 M de tokens al español una vez, y así todo se busca en un idioma». Con la herramienta de velocidad, una L40S escribe ≈ 341 tokens por segundo con 18 conversaciones a la vez (el 27B en FP8, páginas de 900 tokens). ¿Cuánto tardarían las dos GPUs? ¿Qué le pasa a un torque traducido?
???
1. Las dos L40S: ≈ 682 tokens por segundo. 540,000,000 ÷ 682 ≈ 792,000 s ≈ **9.2 días** solo en eso.
2. Lo grave no es el tiempo: cada traducción es un lugar más donde un número cambia (la coma decimal alemana, «1,5», que se vuelve 15; una unidad que se pierde). La regla pide citar **el original**.
3. Mejor: una búsqueda que cruce idiomas y que el modelo conteste en español citando la página original, con su recorte.
:::

### Leer 600,000 páginas, con tablas

Como avisó [RAG privado](/rag-privado/): «la RAM sobra; el problema es leer». Las páginas con texto las lee el [[parser-de-documentos|parser]]; los escaneos pasan por [[ocr|OCR]]; de las figuras se guarda **la imagen de la página**, que el modelo lee **al contestar**. Como cada valor se muestra con su recorte, la imagen de cada página se guarda junto a su texto.

El parser es **Docling 2.154.0** (26 de noviembre de 2026, MIT); en el estrato de tablas del examen se compara con **MinerU 4.2.3**.

:::profundo Por qué comparar MinerU, y sus licencias
En las tablas de OmniDocBench v1.6, un parser especializado de ≈ 1.2 mil millones de parámetros (MinerU-2.5) saca más que un modelo de visión general de 235 mil millones (fuente secundaria). Orienta, no decide: ese benchmark tiene ≈ 12 % de errores de anotación, y ninguna de sus páginas es un manual escaneado con tablas de torque.

Sus licencias no son una sola. El código es Apache 2.0 con términos adicionales: licencia comercial arriba de 100 millones de usuarios al mes o US$20 millones de ingreso mensual, y atribución si se ofrece como servicio a terceros. El umbral de ingreso se cuenta **con todas sus filiales**: la planta sola (≈ US$8 M al mes con el supuesto de US$100 M al año) queda abajo, pero si es parte de un grupo que factura más de US$240 M al año, necesita la licencia comercial o se queda con Docling. Lo confirma su área jurídica con el texto vigente de la licencia (consultado el 2026-11-27). Los pesos de la versión 4 son Apache 2.0, pero los del modelo anterior, MinerU2.5-2509, son **AGPL-3.0**. Se fija la versión y la huella de los pesos que baja, como cualquier pieza en [Seguridad](/seguridad/). Docling es MIT, sin esas condiciones.
:::

:::diagrama caso-fabrica-ingesta
El camino de un manual nuevo: de ingeniería a la carpeta de la DMZ y, recogido desde adentro, al parser, al OCR y al índice. Toca cada caja o sigue el recorrido.
:::

Leer las 600,000 páginas toma ≈ 79 horas de GPU; embeber los fragmentos, menos de una. Con el servidor casi vacío, la ingesta corre de día también: ≈ 3.3 días seguidos. Lo real se mide antes con 200 páginas de la planta.

:::profundo De dónde salen las 79 horas
:::cuenta Cuánto tarda la ingesta inicial
Leer, Docling // 2.1 páginas por segundo, medición de Datalab en una GPU (lección RAG privado) | 600,000 ÷ (2.1 × 3,600) | ≈ 79 h
Fragmentos // 540 M de tokens, de 400 con traslape de 60 | 540,000,000 ÷ (400 − 60) | ≈ 1.59 M
Embeddings, Qwen3-Embedding-0.6B en una L40S // \(η_c × F ÷ (2 × P_a)\) = 0.5 × 362.05 × 10¹² ÷ (2 × 440.5 × 10⁶) ≈ 205,500 tokens/s | 540,000,000 ÷ 205,500 | ≈ 0.73 h
= Leer se lleva ≈ 79 horas; embeber, menos de una. Con el servidor casi vacío, la ingesta corre también de día: ≈ 3.3 días seguidos. Lo real se mide antes con 200 páginas de la planta.
:::
:::

### Buscar en la máquina correcta

El error más caro es contestar con **el torque correcto de otra variante**: la prensa de 400 toneladas y la de 250 comparten la mitad del manual. La solución es un **[[filtro-por-maquina|filtro por máquina]]**: cada fragmento lleva fabricante, modelo y revisión; el técnico escanea el **QR de la placa** y la búsqueda solo mira esa máquina y su hoja de bloqueo. Es un [[prefiltro]], como la ACL del despacho, y pide a la planta su **tabla de números de serie**.

La búsqueda es la del despacho (Qwen3-Embedding-0.6B, [[bm25|BM25]] y vectores con [[rrf|RRF]] en Qdrant 1.20.2), pero **BM25 pesa más**: un código de falla («E-1042») se escribe igual en cualquier idioma, y un vector puede confundirlo con E-1024. El vector une la pregunta en español con el manual en inglés; si cruza bien al alemán y al japonés, lo dice el examen.

:::diagrama caso-fabrica-pregunta
Una pregunta en la línea, del QR de la placa a la respuesta con el recorte de la tabla, y qué pasa cuando algo falla de noche. Toca cada caja o sigue los dos recorridos.
:::

### La respuesta, con su recorte

:::figura caso-fabrica-respuesta
Las tres formas de respuesta, con valores de ejemplo: un valor con su cita y el recorte de la tabla; un bloqueo, que muestra la hoja de la planta en vez de escribir pasos; y «no lo encontré», con a quién preguntar.
:::

Las reglas van en las instrucciones del modelo **y** se revisan con código al salir:

1. **Solo con [[cita]]**: manual, página y el recorte de la tabla. Sin cita, «no lo encontré».
2. **Ningún valor de torque, presión u holgura ni ningún paso de bloqueo sale del conocimiento del modelo.** Si el número de la respuesta no está en el fragmento citado, la respuesta no sale (un programa lo busca en el texto).
3. **El bloqueo es el de la planta**: se muestra la hoja, no se resume.
4. **El asistente consulta; la persona verifica en el manual y bloquea con su candado.** Una respuesta no es una autorización de trabajo.

### Motor, gateway y lo que se vigila

Las piezas son las del despacho, con cuentas locales, la temperatura en el tablero y una biblioteca de PDFs como respaldo: si todo cae, la tablet abre el PDF de la máquina. Se pierde el atajo, no el manual.

:::profundo Las piezas, una por una
- **Motor**: vLLM 0.34.0 (16 de noviembre de 2026, Apache 2.0), una copia por GPU, desde una carpeta local: `--max-model-len 8192 --max-num-seqs 4` (el 4 del paro) y el razonamiento apagado, como en el despacho. El 9B lleva además `--quantization fp8`.
- **Gateway e interfaz**: LiteLLM 1.111.0 y Open WebUI 0.13.5 (25 de noviembre de 2026), con cuentas locales. Para producción, la planta decide con los técnicos si hace falta una pantalla propia con botones grandes para guantes.
- **Si todo cae**: la biblioteca de archivos que la planta ya tiene en la DMZ, por el camino que la WiFi de planta ya usa para llegar a ella; no pasa por la zona del asistente.
- **Lo que se vigila**: lo de [Observabilidad](/observabilidad/) más la temperatura de la GPU, el margen hasta el freno y los segundos de [[throttling]] por calor. Sin salida a internet, las alertas van a una pantalla de la oficina de mantenimiento y al correo interno.
- **Actualizaciones**: mensuales, por la máquina puente de la DMZ, con el ciclo de [Seguridad](/seguridad/) y la firma del ingeniero de automatización. Con 2 GPUs, una copia a la vez.
:::

## Evals: el examen de los técnicos {Evals: the technicians' exam}

El examen sigue a [Evals](/evals/): un [[golden-set|golden set]] fijo y [[estratificar|estratificado]], escrito por quienes saben la respuesta. **200 preguntas de órdenes de mantenimiento reales**, cada una con su respuesta y su cita, del estilo de «¿cuál es el torque de los tornillos de la placa de la prensa 7?», «¿qué significa el código E-1042 del robot de la celda 4?» o «¿cuál es el procedimiento de bloqueo de la prensa 7?».

| Estrato | Preguntas | Qué prueba |
|---|---|---|
| Valor numérico | 60 | copiar el número y su unidad sin un error |
| Código de falla | 30 | BM25 y los idiomas |
| Tabla o programa (lubricante, intervalos) | 30 | leer tablas |
| Figura o diagrama | 20 | el modelo de visión |
| Bloqueo | 20 | mostrar la hoja de la planta, no escribir pasos |
| Sin respuesta | 30 | decir «no lo encontré» |
| Otra variante | 10 | el filtro por máquina |

En cada estrato, los cuatro idiomas en la proporción de los manuales y una tercera parte de escaneos. El [[criterio-de-aceptacion|criterio]] tiene tres partes, y las dos primeras son de cero:

1. **0 valores equivocados** en las 60 («bien» es el valor y la unidad exactos con su cita, o «no lo encontré»).
2. **0 pasos de bloqueo inventados** en las 20.
3. **≥ 85 % de las 200 bien y con la cita correcta** (170 o más).

Califican **dos técnicos con antigüedad** cada respuesta numérica y de bloqueo; un [[llm-as-judge|juez LLM]] solo ayuda con el resto. Son ≈ 70 horas de técnicos: ≈ 50 escribiendo y ≈ 20 calificando (200 × 2 × 3 min).

:::intenta ¿Qué demuestran 0 errores en 60?
El 27B saca 0 valores equivocados en las 60 numéricas. ¿Puedes decir que nunca se equivoca en un valor? Si no, ¿qué puedes decir con 95 % de confianza? ¿Cuántas preguntas sin un error harían falta para demostrar menos de 1 %? (Pista: la «regla de tres» y la cota exacta de [Evals](/evals/).)
???
1. No: 60 preguntas son una muestra; no haber fallado en 60 no dice nada de la 61.
2. La cota exacta de una cola al 95 %: si el error fuera \(p\), ver 0 en 60 tendría probabilidad \((1 − p)^{60}\); el \(p\) más grande con el que eso todavía pasa al menos 5 % de las veces es \(1 − 0.05^{1/60}\) ≈ **4.87 %** (la «regla de tres», 3 ÷ 60, da 5 %).
3. Para ≤ 1 %: \(0.99^n ≤ 0.05\), o sea \(n ≥ ln 0.05 ÷ ln 0.99\) ≈ **299 preguntas** sin un error.
:::

:::profundo La cota, con su fórmula y en Python
:::formula La cota con cero errores
p_{max} = 1 − α^{1/n}
- p_{max}: la tasa de error más grande compatible con ver 0 errores, con confianza \(1 − α\)
- α: 0.05 para 95 % de confianza
- n: preguntas del estrato
:::

:::cuenta Lo que demuestra el examen de la planta
Valores, 0 de 60 | \(1 − 0.05^{1/60}\) | ≤ 4.87 %
Bloqueo, 0 de 20 | \(1 − 0.05^{1/20}\) | ≤ 13.91 %
Para demostrar ≤ 1 % en valores | ln 0.05 ÷ ln 0.99 | 299 preguntas
= El examen no puede demostrar que el asistente es seguro. El bloqueo lo hace seguro el diseño (no escribe pasos: muestra la hoja), y los valores, la revisión con código y el recorte que el técnico ve.
:::

```python
import math

# Cota exacta de una cola al 95 % con 0 errores en n preguntas:
# el error más grande que todavía haría «probable» (≥ 5 %) ver 0 errores.
for n in (20, 60, 149, 299):
    p = 1 - 0.05 ** (1 / n)
    print(f"0 errores en {n:3}: error ≤ {p:.2%}   (regla de tres: {3/n:.2%})")

# ¿Cuántas preguntas sin un error hacen falta para demostrar ≤ 1 %?
print("para ≤ 1 %:", math.ceil(math.log(0.05) / math.log(0.99)), "preguntas")
```

```salida
0 errores en  20: error ≤ 13.91%   (regla de tres: 15.00%)
0 errores en  60: error ≤ 4.87%   (regla de tres: 5.00%)
0 errores en 149: error ≤ 1.99%   (regla de tres: 2.01%)
0 errores en 299: error ≤ 1.00%   (regla de tres: 1.00%)
para ≤ 1 %: 299 preguntas
```
:::

**Un invariante de cero no se demuestra con un examen: se diseña y se vigila.** Por eso los dos primeros criterios se repiten en cada cambio (el [[gate-de-calidad|gate]] de la lección) y, en producción, cada respuesta con un número guarda su recorte para revisión.

**El piloto, en dos tiempos.** Primero, 6 semanas **fuera de la planta**: los dos modelos en una L40S rentada (≈ 240 horas a US$1.09 en RunPod, el precio de los datos de la app) con **los manuales que su licencia deja procesar fuera**, y el 9B en una L4 rentada (≈ 40 horas) para medir su velocidad real. Después, con el servidor instalado, la **[[prueba-en-sitio|prueba de aceptación en sitio]]** (SAT), el vocabulario que la planta ya usa con sus proveedores de máquinas: ahí entran el estrato de bloqueo con las hojas de la planta y los manuales confidenciales, que nunca salen. En el camino se mide lo que el caso dejó como supuesto: la temperatura de la nave, los tokens por página y **cuántos minutos tarda hoy un técnico en encontrar un dato**, la línea base del ahorro.

## Riesgos {Risks}

:::intenta Antes de ver la tabla
Escribe los tres riesgos que más te preocuparían si fueras el gerente de mantenimiento: qué pasaría, cómo se reduce y quién lo vigila. Piensa en la persona frente a la máquina, en las 3:00 y en la red.
???
1. **Un valor equivocado**: daña la máquina o lastima. Solo con cita, revisión con código y recorte a la vista; lo vigila el supervisor de mantenimiento.
2. **Un bloqueo mal hecho**: el más grave. Por diseño el asistente no escribe pasos, muestra la hoja; lo vigila el responsable de seguridad.
3. **Un camino nuevo a la red OT**: el servidor como puerta. La zona, sus tres conductos y la puente; lo vigila el ingeniero de automatización.
:::

| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| Valor equivocado | un torque mal copiado; una máquina dañada o una persona lastimada | solo con cita; el número debe estar en el fragmento; recorte a la vista; 0 de 60 en cada cambio | supervisor de mantenimiento |
| Bloqueo inventado | alguien mete las manos con energía | no escribe pasos: muestra la hoja de la planta o dice que no la encontró | responsable de seguridad e higiene |
| Sesgo de automatización | el técnico deja de verificar porque «la tablet nunca falla» | el recorte obliga a mirar la tabla; «verifica en el manual»; capacitación | supervisor de mantenimiento |
| Otra variante | el torque correcto de la máquina hermana | filtro por máquina con el QR; tabla de números de serie; 10 preguntas trampa | ingeniería de mantenimiento |
| Falla de noche | a las 3:00 cae una GPU o el servidor | N+1; el gateway manda todo a la otra copia; la biblioteca de PDFs | TI de la planta |
| Camino nuevo a OT | el servidor se vuelve la puerta de un atacante | zona propia, tres conductos, nada a los PLCs ni a internet, actualizaciones firmadas | ingeniero de automatización |

:::profundo Cuatro riesgos más
| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| Manual viejo | cambió una pieza o una revisión | solo entra lo que ingeniería aprueba, con su revisión | ingeniería de mantenimiento |
| OCR malo | un 7 que se lee 1 en una tabla de los noventa | estrato de escaneos; MinerU en tablas; el recorte | integrador, en el piloto |
| Calor | la GPU se frena y a las 15:00 contesta más lento que a las 7:00 | site con aire; alerta de temperatura y throttling | TI de la planta |
| Licencia de un manual | un fabricante prohíbe copiar o indexar su manual | revisar cada licencia antes de indexar | jurídico de la planta |
:::

El tercer riesgo es el más difícil, porque crece cuando el sistema funciona bien: mientras más acierta, menos se revisa. [Ataques](https://sensei.trueml.app/ataques/) lo cuenta del lado de las personas; aquí la defensa es de diseño: la respuesta **siempre** muestra el recorte.

## Costo: caro por pregunta, barato contra el paro {Cost: expensive per question, cheap against downtime}

:::intenta ¿Cuánto cuesta al mes la opción B, y cuántos minutos de paro la pagan?
B cuesta US$58,281.30, se deprecia en 36 meses con 20 % de reventa y al mes suma ≈ US$67 de luz, US$200 de espacio y red y US$450 de personas. La planta hace 6,240 preguntas al mes y una hora de línea parada le cuesta US$12,000 (supuesto). ¿Cuánto cuesta al mes? ¿Por pregunta? ¿Cuántos minutos de paro al mes la pagan?
???
1. Depreciación: 58,281.30 × (1 − 0.20) ÷ 36 ≈ **US$1,295**.
2. Al mes: 1,295 + 67 + 200 + 450 ≈ **US$2,012** (≈ MXN 39,683 a 19.7203). [Ábrelo en la herramienta de TCO](/herramientas/tco/?p1=l40s&U=30&r=8&Np=3500&No=300&D=26&G=2&K=8910&gs=4&S=40461.3&V=36&res=0.2&Wg=350&Wb=400&u=0.25&pue=2&kwh=0.08&oe=200&op=450&tc=19.7203&hr=730).
3. Por pregunta: 39,683 ÷ 6,240 ≈ **MXN 6.36**.
4. Paro: 2,012 ÷ 12,000 × 60 ≈ **10 minutos al mes**.
:::

La herramienta [API, nube o servidor propio](/herramientas/tco/) hace las dos con los mismos supuestos (la A, [aquí](/herramientas/tco/?p1=l4&U=30&r=8&Np=3500&No=300&D=26&G=2&K=3624&gs=2&S=8000&V=36&res=0.2&Wg=72&Wb=250&u=0.25&pue=2&kwh=0.08&oe=200&op=450&tc=19.7203&hr=730)):

| | A · 2 × L4 | B · 2 × L40S |
|---|---|---|
| Compra | ≈ US$15,248 (supuesto) | US$58,281.30 |
| Al mes, todo | **≈ US$1,022** (≈ MXN 20,159) | **≈ US$2,012** (≈ MXN 39,683) |
| TCO de 36 meses | ≈ US$36,801 (≈ MXN 726 mil) | ≈ US$72,443 (≈ MXN 1.43 M) |
| Por pregunta | ≈ MXN 3.23 | ≈ MXN 6.36 |
| Minutos de paro que lo pagan | ≈ 5 al mes | ≈ 10 al mes |

No incluyen impuestos, flete ni importación ([Cotizar](/cotizar/)), ni las horas del integrador.

:::profundo Los supuestos, y lo que cuesta decidir
36 meses con 20 % de reventa; las GPUs al 25 % de su consumo en promedio (casi siempre esperan); PUE de 2.0 en el site; la luz a US$0.08 por kWh (la energía de media tensión de la ficha del despacho: la tarifa horaria del Bajío no está verificada, y con menos de 1 kW no mueve nada); US$200 al mes de espacio y red; y US$450 al mes de personas, ≈ 41 horas de TI a MXN 218.1, por las actualizaciones a mano y la vigilancia 24/7.

**Decidir** cuesta poco aquí: ≈ 70 horas de técnicos (≈ US$470, con un sueldo supuesto de MXN 17,000 al mes, el punto medio de un anuncio de Silao) más las GPUs rentadas del piloto (≈ US$290): **≈ US$760**. En el despacho, solo el examen costaba ≈ US$16,700, porque una hora de abogado vale mucho más.
:::

**El costo por pregunta, con honestidad.** MXN 6.36 es ≈ 8 veces lo del despacho (≈ MXN 0.82), y Qwen3 32B por API haría el mes entero por ≈ **US$2.27**. No decide: la API no es opción (sin internet), no es el mismo modelo, y **el costo por pregunta mide la cosa equivocada**. El servidor no está para contestar barato, sino para que la línea vuelva a andar antes.

### Contra el paro

Una hora de línea parada le cuesta a la planta **US$12,000** (supuesto: US$100 millones de ingreso al año entre 8,000 horas productivas da US$12,500, redondeado). Tiene ≈ **25 horas** de paro no planeado al mes, y la meta es quitar el **5 %**, ≈ 1.25 horas: el tiempo que hoy se va en buscar el dato.

:::formula Los minutos que pagan el asistente
m^{*} = frac{P}{c_p} × 60
- m^{*}: minutos de línea parada que el asistente tiene que ahorrar al mes para pagarse
- P: el costo del asistente al mes, en US$ (de la herramienta de TCO)
- c_p: el [[costo-del-paro|costo de una hora de paro]], en US$
:::

:::cuenta El paro contra el servidor
Opción B, \(m^{*}\) | 2,012 ÷ 12,000 × 60 | ≈ 10.1 min al mes
Opción A, \(m^{*}\) | 1,022 ÷ 12,000 × 60 | ≈ 5.1 min al mes
Ahorro que se busca, \(A = H_p × s × c_p\) // 25 h de paro, 5 % | 25 × 0.05 × 12,000 | US$15,000 al mes
B: ahorro ÷ costo | 15,000 ÷ 2,012 | ≈ 7.5×
Con la cifra de Siemens // US$2.3 M por hora, plantas automotrices grandes | 2,300,000 ÷ 12,000 | ≈ 192 veces más
= Con diez minutos de línea parada menos al mes, B se paga. La cifra de Siemens haría ver el proyecto ≈ 192 veces mejor; por eso no se usa: es de otra planta.
:::

:::calculadora caso-fabrica-paro
Mueve el costo de la hora de paro y la parte que se ahorra. Prueba la cifra de Siemens para ver por qué no se copia, y baja el ahorro a medio por ciento para ver dónde deja de pagarse cada opción.
:::

## La propuesta en una página {The proposal on one page}

**Para** el gerente de mantenimiento y el ingeniero de automatización. **Qué**: un asistente que contesta con cita sobre los manuales de las 220 máquinas, en la tablet, a cualquier hora, sin internet en la red de planta.

1. **Hace**: contesta en español sobre los manuales (en cuatro idiomas) de la máquina del QR; da el valor con su unidad, su cita y el recorte; para un bloqueo muestra la hoja de la planta; si no encuentra, lo dice.
2. **Nunca**: da un valor o un paso de bloqueo de memoria, toca una máquina ni sale a internet.
3. **Hardware**: A, 2 × L4 con Qwen3.5-9B en FP8 (≈ US$15,248, supuesto); B, 2 × L40S con Qwen3.8-27B en FP8 (US$58,281.30, Exxact, 2026-11-25, sin impuestos). N+1 en las dos: una GPU aguanta ≈ 40 veces la hora pico (1,227 ÷ 30); la segunda es para las 3:00.
4. **Dónde**: en el site de TI, en una zona propia pegada a la DMZ industrial, con tres conductos; diseñada para un SL-T 2 de IEC 62443, sin prometer certificación.
5. **Software**: vLLM 0.34.0, LiteLLM 1.111.0, Open WebUI 0.13.5 con cuentas locales, Qdrant 1.20.2, Docling 2.154.0 (MinerU 4.2.3 a comparar).
6. **Examen**: 200 preguntas de órdenes de mantenimiento. Criterio: 0 valores equivocados en 60, 0 pasos de bloqueo inventados en 20, ≥ 85 % de las 200.
7. **Decisión**, firmada antes del examen: si el 9B pasa todo en el examen y en sitio, A; si no, B. **Se presupuesta B.**
8. **Piloto**: 6 semanas fuera con los manuales que la licencia permite; la prueba en sitio con lo confidencial.
9. **Costo**: B ≈ US$2,012 al mes (≈ MXN 39,683), ≈ US$72,443 en 3 años; A ≈ US$1,022 al mes. Se pagan con ≈ 10 y ≈ 5 minutos de paro al mes, a US$12,000 la hora (supuesto).
10. **Lo que no sabemos todavía**: si el 9B lee bien tablas escaneadas en alemán y japonés, los tokens por página, la temperatura de la nave y la licencia de cada manual.

## Qué cambiaría si… {What would change if…} [extra]

**…piden 20 tokens por segundo, como el despacho.** A 20, ni la L40S con el 27B ni la L4 con el 9B llegan: la herramienta de sizing dice «No llega» ([la L40S a 20](/herramientas/sizing/?p1=l40s&U=30&r=8&Np=3500&No=300&h=24&pk=3&v=20&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3)). Tres salidas: la **RTX 6000 Ada** (960 GB/s) llega con el 27B, 2 conversaciones por tarjeta a ≈ 21.8 tokens/s ([ábrela](/herramientas/sizing/?p1=rtx-6000-ada&U=30&r=8&Np=3500&No=300&h=24&pk=3&v=20&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3)), pero con 4 técnicos a la vez se usan las dos tarjetas y en el paro se pierde la N+1; el 27B en **INT4 de AWQ en la L40S** escribe a ≈ 31.6, pero hay que cuantizarlo y volver a pasar el examen ([Formatos y cuantización](/formatos-cuantizacion/)); o la **RTX PRO 6000 Server Edition**, sin precio de lista.

**…no hubiera site con aire.** El lugar decide el modelo: solo A, en un servidor de borde con tarjetas de ancho sencillo, como el ThinkEdge SE455 V3 (sin precio publicado), dentro de un gabinete que aguante el polvo y la neblina, con la temperatura medida. Ojo con la lista: el Lenovo ThinkEdge SE360 V2 se retiró de venta el 30 de junio de 2026 (fuente secundaria), y los equipos sin ventilador con grado IP67 y GPU que aparecen en catálogos no publican precio: se cotizan, no se suponen.

**…el 27B tampoco lee bien las tablas escaneadas.** No se cambia de GPU: se cambia la ingesta. MinerU contra Docling en ese estrato, más resolución en la imagen (la L40S tiene lugar para 18 conversaciones de 8,192) y, si aun así falla, esos manuales se reescanean o se piden en digital al fabricante.

**…quieren también a los 300 operarios de línea.** Supuesto: 6 preguntas por operario al día, con un pico más suave (1.5), porque no preguntan todos al empezar el turno. Son 1,800 preguntas al día y ≈ 0.64 conversaciones a la vez ([en la herramienta de sizing](/herramientas/sizing/?p1=l40s&U=300&r=6&Np=3500&No=300&h=24&pk=1.5&v=15&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3)), más las 0.17 de los técnicos: sigue cabiendo en una GPU. Cambia el permiso: un operario no debería recibir los procedimientos de mantenimiento ni de bloqueo, y hace falta una [[acl-por-chunk|ACL por fragmento]] por rol.

**…quieren voz.** Hay modelos abiertos: Whisper large-v3-turbo (0.81 mil millones de parámetros, MIT), Qwen3-ASR (Apache 2.0) y Gemma 4 12B, que recibe audio. Pero **no hay ninguna medición de su error en ruido de planta**: lo más cercano es ≈ 6.91 % de error por palabra en grabaciones limpias en español (fuente secundaria). La voz va como extra, medida en el piloto con un micrófono con supresión de ruido; el QR y el teclado resuelven casi todo.

**…el asistente quiere leer el MES o crear órdenes de trabajo.** Ya no es un asistente sobre manuales: es un [[agente]] con [[tool|herramientas]] que tocan el nivel 3. Hace falta un conducto nuevo, otro análisis de riesgo de la zona y, para escribir, [[aprobacion-humana|aprobación humana]] por acción, como en [Agentes](/agentes/).

## Errores comunes {Common mistakes}

1. **Poner el servidor junto a la línea «porque ahí se usa».** Lo que va en la línea es la tablet. **Cómo evitarlo:** decidir primero la zona (lógica) y luego el lugar (físico), sin confundirlos.
2. **Dejar que el modelo dé torques o pasos de bloqueo de memoria.** Un modelo grande «sabe» torques típicos y escribe procedimientos que suenan bien. **Cómo evitarlo:** solo con cita, el número revisado contra el fragmento, el recorte a la vista y, para el bloqueo, la hoja de la planta o nada.
3. **Copiar el costo del paro de un informe.** Los US$2.3 millones por hora son de plantas grandes. **Cómo evitarlo:** la cuenta con el ingreso de la planta, dicha como supuesto, y los minutos medidos en el piloto.
4. **Dimensionar por el promedio.** 0.17 conversaciones invitan a comprar una sola GPU chica. **Cómo evitarlo:** diseñar para el paro (llegadas en ráfaga) y para las 3:00 (N+1).
5. **Prometer «cumple IEC 62443».** **Cómo evitarlo:** decir para qué nivel objetivo se diseñó la zona y con qué contramedidas.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Si cada técnico hiciera 16 preguntas por turno en vez de 8, ¿cuántas conversaciones habría a la vez en la hora pico? ¿Cambia cuántas GPUs compras?
1. Las llegadas se duplican: 0.0167 por segundo; la duración no cambia, ≈ 20.5 s.
2. \(c\) = 0.0167 × 20.54 ≈ **0.34**.
3. No cambia: siguen siendo 2 GPUs, por la N+1 y el paro, no por la carga.

? [facil] Con el 27B en FP8 en una L40S, ¿caben 4 conversaciones de 32,768 tokens (para meter varias páginas como imagen)?
1. KV: 65,536 bytes × 32,768 = 2.15 GB por conversación; por 4, **8.59 GB**.
2. Total: 30.32 + 8.59 + 3 = **41.91 GB** contra 43.2 útiles: **cabe**, con ≈ 1.3 GB de sobra ([compruébalo](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=32768&u=4&V=l40s&prog=3)). Con los 256 KiB por token de Qwen3 32B no cabría ni una.

? [medio] El estrato «sin respuesta» tiene 30 preguntas y el asistente no inventa ninguna cita. ¿Qué tasa de citas inventadas descartas con 95 % de confianza?
1. \(p_{max} = 1 − 0.05^{1/30}\); \(0.05^{1/30}\) = \(e^{ln 0.05 ÷ 30}\) = \(e^{−0.0999}\) ≈ 0.905.
2. \(p_{max}\) ≈ **9.5 %**: con 30 solo se descarta que invente en una de cada diez (la regla de tres da 10 %).

? [medio] Si la hora de paro valiera US$3,000 y no 12,000, ¿cuántos minutos al mes pagarían cada opción?
1. B: 2,012 ÷ 3,000 × 60 ≈ **40 minutos**; A: 1,022 ÷ 3,000 × 60 ≈ **20 minutos**.
2. Con 25 horas de paro, B pide ahorrar ≈ 2.7 % del paro y A ≈ 1.4 %. Sigue siendo razonable, pero A gana peso. Muévelo en la calculadora de arriba.

? [medio] Un integrador propone repartir el 27B en FP8 entre las dos L4 ([[tensor-parallel]]). ¿Cabe? ¿Pasa la velocidad? ¿Qué se pierde?
1. Memoria: 2 × 24 × 0.9 = 43.2 GB útiles contra 35.47: **cabe**.
2. Velocidad: con la herramienta, 2 GPUs en la misma copia, ≈ **13.4 tokens/s** y ≈ 0.81 s al primer token ([ábrela](/herramientas/velocidad/?p1=l4&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=3500&No=300&b=4&n=2)), sin contar la comunicación entre tarjetas: **no pasa** los 15.
3. Y se pierde la N+1: las dos GPUs son una sola copia.

? [reto] Escribe la regla de decisión entre A y B para que la firmen el gerente y el ingeniero de automatización antes del examen: qué se mide, con qué umbral y qué pasa en cada caso, empate incluido.
1. Los dos modelos con el mismo examen, los mismos fragmentos y la misma imagen por página.
2. Un modelo **pasa** si: 0 valores equivocados en las 60; 0 pasos de bloqueo inventados en las 20 (en sitio); ≥ 170 de 200 bien y con cita; y el primer renglón medido en ≤ 5 s en el p95 con 4 a la vez.
3. Si pasan los dos: **A** (la mitad al mes y ≈ un cuarto de la compra). Si solo el 27B: **B**. Si ninguno: no se compra; se revisa la ingesta y se repite.
4. No hay empate posible en los dos primeros criterios: son de cero. Mientras tanto, se presupuesta B.
:::

## Lo que sigue {What comes next} [extra]

Este caso usó casi todas las lecciones: [El recorrido](/recorrido/), la pregunta de «cuándo no conviene»; [Requisitos de hardware](/requisitos-hardware/), dimensionar por disponibilidad; [Elegir un modelo](/elegir-modelo/) y [Formatos y cuantización](/formatos-cuantizacion/), los candidatos y el FP8; [RAG privado](/rag-privado/), la ingesta y el prefiltro; [Seguridad](/seguridad/), las zonas y la puente; [El cuarto](/el-cuarto/), el lugar y la norma eléctrica; [Evals](/evals/), el examen y sus cotas; [TCO](/costo-total/), el costo.

Lo distinto: el despacho y la clínica son oficinas o consultorios con **datos personales**, y su pregunta central es de privacidad. Aquí la pregunta es de **seguridad de la persona** y de **red OT**. Los casos que vienen mueven otra variable: muchas más preguntas, una red sin ninguna conexión (ni por una DMZ) o varios clientes sobre el mismo servidor.

:::conceptos
red-ot modelo-purdue iec-62443 zona-y-conducto dmz-industrial nivel-de-seguridad diodo-de-datos bloqueo-y-etiquetado grado-ip servidor-de-borde vlm parser-de-documentos filtro-por-maquina costo-del-paro prueba-en-sitio
:::

:::chequeo
? ¿Por qué la planta compra 2 GPUs si una aguanta ≈ 40 veces su hora pico?
Por disponibilidad: a las 3:00 no hay nadie de TI, y si la única GPU falla la línea se queda sin el asistente hasta el día siguiente. Es la N+1, no la carga.
? ¿Qué decide entre A (2 × L4, 9B) y B (2 × L40S, 27B)?
Qué modelo lee bien las tablas de torques escaneadas sin equivocar un valor. Lo dice el examen, con una regla firmada antes. Las dos pasan la velocidad.
? ¿Por qué el servidor no va junto a la línea?
Porque lo que va en la línea es la tablet. La nave a 35–40 °C con polvo metálico no aguanta un servidor común ni una GPU de ancho doble; el site tiene aire, UPS y acceso controlado, y la zona de red es la misma.
? ¿Qué demuestran 0 valores equivocados en 60 preguntas?
Que, con 95 % de confianza, el error es ≤ 4.87 %, no que sea cero; demostrar ≤ 1 % pediría ≈ 299 sin un error. Por eso la seguridad de los valores se diseña y se vigila.
? ¿Por qué el asistente no escribe los pasos de un bloqueo?
Porque la NOM-004-STPS-1999 deja el procedimiento de cada máquina a la planta, y un paso inventado puede costar una mano. Muestra la hoja de la planta o dice que no la encontró; la persona bloquea con su candado.
? ¿Por qué no se usa la cifra de Siemens de US$2.3 millones por hora?
Porque es de plantas automotrices grandes. Para esta planta inflaría el valor ≈ 192 veces; lo honesto es su propio ingreso por hora (≈ US$12,000, supuesto) y medir los minutos en el piloto.
:::
