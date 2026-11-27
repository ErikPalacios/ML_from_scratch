---
titulo: Startup SaaS
en: Sizing case: a multi-tenant SaaS startup
subtitulo: Una startup de Monterrey vende a 45 despachos contables un asistente sobre sus documentos y quiere dejar la API para correr su propio modelo en un rack de Querétaro. Cómo se separa a cada cliente en cada capa, cómo se reparte el servidor sin que un vecino ruidoso frene a los demás, qué firma la startup como encargada y cuánto margen deja cada plan.
pregunta: «Queremos prometerles a los despachos que sus documentos no salen a un tercero ni los ve otro cliente, sin que el servidor nos coma el margen.» ¿Qué se les propone, cómo se demuestra que ningún despacho ve lo de otro y cuándo hace falta el segundo servidor?
requisitos: recorrido, requisitos-hardware, gateway, rag-privado, batching, seguridad, evals, cotizar, costo-total
sensei: privacidad, colas, ataques, identidad
---

:::idea
En los otros casos el servidor era de una sola empresa. Aquí lo comparten **45 clientes**, y la capacidad es lo fácil: una sola tarjeta aguanta el pico. Lo difícil son tres cosas que los otros casos no tenían. Que ningún despacho reciba nada de otro (un fragmento, un bloque del caché, una línea del registro) en **ninguna** capa. Que el despacho que sube 5,000 documentos a las 8:30 no haga esperar a los demás. Y que la economía cuadre: la misma carga por API cuesta ≈ 60 veces menos, así que el servidor propio **es** el producto, y el SLA que se vende decide cuándo llega el segundo servidor.
:::

## La startup y lo que pide {The startup and what it asks for}

Llaman la directora y el CTO de una **startup de Monterrey, Nuevo León**. Es ficticia y aquí se llama «la startup»; sus números viven en una ficha, `content/saas.json`, y lo que viene del mundo real lleva su fuente y su fecha.

Venden a despachos contables un asistente: cada despacho sube lo de sus clientes (facturas electrónicas o **CFDI** en XML, estados de cuenta, constancias de situación fiscal, declaraciones, contratos) y sus contadores preguntan. Cada documento trae el **RFC** (la clave fiscal de cada contribuyente) de quien lo emite y de quien lo recibe. Cada respuesta cita el documento. El asistente lee y contesta; no timbra (certifica) facturas ni presenta nada al SAT, la autoridad de impuestos.

La directora: «Hoy corremos sobre la API de un tercero y funciona. Pero tres de nuestros cinco despachos grandes nos piden por contrato que sus documentos no salgan a un tercero, y dos prospectos con clientes bancarios no firman sin eso.» El CTO: «Tendría que ser en servidores nuestros, y no podemos prometer que un despacho no ve lo de otro si no sabemos demostrarlo.»

| Dato | Valor | De dónde sale |
|---|---|---|
| Clientes | 45 despachos: 25 Básico, 15 Pro, 5 Empresa | Supuesto |
| Usuarios por despacho | 3 / 8 / 25 → **320** en total | Supuesto, con el DENUE (abajo) |
| Preguntas por usuario al día | 10 / 15 / 20 | Supuesto |
| Precio por usuario al mes | $349 / $549 / $790, antes de IVA | Supuesto, con el mercado (abajo) |
| Horario | 22 días, de 8:00 a 18:00, pico de 2.5 × | Supuesto (el del despacho de abogados) |
| Servidores | En colocation, en Querétaro | Decisión de la startup |

Los tamaños salen del DENUE y los precios, de lo que un despacho ya paga:

:::profundo El mercado, para ubicarse
El DENUE (el directorio de negocios del INEGI) de mayo de 2026 cuenta **16,924** unidades de servicios de contabilidad y auditoría; **el 90.0 % tiene 10 personas o menos** y el 9.2 %, de 11 a 50 (Secretaría de Economía, consultado el 27-nov-2026). De ahí los tamaños: el Básico es el despacho chico; el Empresa, uno de los de 11 a 50. Un despacho ya paga por su contabilidad: Contalink cobra de $590 a $990 al mes por usuario, y de $290 a $990 por usuario extra (contalink.com, 27-nov-2026). Microsoft 365 Copilot, un asistente genérico, cuesta US$18 al mes por usuario con pago anual (≈ $355) y US$25.20 con renovación mensual (≈ $497; microsoft.com/es-mx, mismo día). Los precios de la startup caen entre los dos.
:::

### Muchos clientes, un servidor

Un sistema **[[multi-tenant]]** atiende a varios clientes con el mismo servidor, el mismo modelo y la misma base, y le promete a cada uno que sus datos solo los ve él. A cada cliente se le dice *tenant*, «inquilino» (no el de Microsoft Entra de la lección [Gateway](/gateway/), que es el directorio de una empresa).

:::analogia Un edificio de departamentos
El elevador, la cisterna y el cuarto de máquinas son de todos; cada departamento tiene su llave y su medidor. Así se reparte un servidor: la GPU, el modelo y la base son de todos; cada despacho tiene su llave en el gateway, su filtro en la base y su parte del caché.

Dónde se rompe: en un edificio ves la puerta forzada. Una fuga entre clientes de un servidor no deja marca: el despacho B recibe un fragmento de A y nadie se entera. Por eso se prueba a propósito, con un examen que solo acepta cero.
:::

:::ojo La sorpresa: no es por dinero
Con los precios de `apis.json` (25-nov-2026), las 111,100 preguntas al mes cuestan **US$68.88** con Qwen3 32B en DeepInfra: un centavo por pregunta. El servidor propio cuesta ≈ **60 veces** más. No se justifica por ahorro: se justifica porque **es lo que la startup vende**.
:::

## Requisitos y perfil de carga {Requirements and load profile}

:::intenta ¿Cuántas preguntas a la vez en el pico?
De la tabla de arriba: 25 despachos Básico de 3 usuarios con 10 preguntas al día, 15 Pro de 8 con 15, 5 Empresa de 25 con 20; 22 días al mes, 10 horas al día y un pico de 2.5 veces el promedio. Cada pregunta lee ≈ 6,000 tokens (el prefill tarda ≈ 0.68 s en una RTX PRO 6000 Server Edition) y escribe ≈ 500 a 20 tokens por segundo. ¿Cuántas preguntas hay al mes y al día? ¿Cuántas abiertas a la vez en el pico, con la [[ley-de-little|ley de Little]]?
???
1. Al mes: 25 × 3 × 10 × 22 = 16,500; 15 × 8 × 15 × 22 = 39,600; 5 × 25 × 20 × 22 = 55,000. Suman **111,100**: **5,050 al día**.
2. Llegadas en el pico: 5,050 ÷ (10 × 3,600) × 2.5 ≈ **0.351 por segundo**.
3. Lo que dura cada una: 0.68 + 500 ÷ 20 = **25.68 s**.
4. Little: 0.351 × 25.68 ≈ **9.0 a la vez**. La [herramienta de sizing con los números de la startup](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=320&r=15.78125&Np=6000&No=500&h=10&pk=2.5&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) da 9.01 con 320 usuarios de 15.78125 preguntas, el promedio ponderado (5,050 ÷ 320).
:::

Nueve a la vez es poco. Lo que importa es **de quién**: los 5 despachos Empresa son el 11 % de los clientes y hacen **el 49.5 % de las preguntas**.

### Lo que hace y qué tan bien

Funcionales: contestar sobre los documentos de **su** despacho, con cita; cargar documentos en lote (el cierre del ejercicio); y que cada despacho vea su consumo. Lo que **no** hace: aprender de un despacho para contestarle a otro.

| [[requisito-no-funcional\|Requisito]] | Valor | Por qué |
|---|---|---|
| Entrada / salida | ≈ 6,000 / ≈ 500 tokens; tope de 8,192 | Los del despacho de abogados |
| [[ttft\|TTFT]] p95 en el pico | ≤ 3 s | El prefill solo tarda 0.68 s; el resto es fila |
| Velocidad | ≥ 20 tokens/s | El criterio de [De requisitos a hardware](/requisitos-hardware/) |
| Fugas entre clientes | **0**, en cada versión | Es la promesa que se vende |
| Un lote de 5,000 documentos | No sube el p95 de los demás | El cierre de uno no es problema de los otros 44 |
| Disponibilidad | Básico sin SLA; Pro 99.5 %; Empresa 99.5 %, y 99.9 % con dos servidores | La sección de hardware |
| Al terminar un contrato | Respaldo al despacho y borrado en 30 días | La sección de la ley |

:::nota Lo que falta preguntar
Cuántos tokens pesa un CFDI en XML (se mide con documentos sintéticos); cuándo suben los despachos sus lotes; el pico de los días de declaraciones, que puede ser el doble; si los Empresa quieren conectar sus sistemas por API, y la latencia de Monterrey a Querétaro, no medida (contra 25 s de respuesta no decide).
:::

## Memoria, velocidad y cuántas GPUs {Memory, speed and how many GPUs}

:::intenta ¿Cabe el pico en una sola tarjeta?
La herramienta de sizing dice que, con preguntas de 6,000 tokens de entrada y 500 de salida, cada **RTX PRO 6000 Server Edition** sostiene **13 conversaciones** a ≥ 20 tokens por segundo (con los 12,000 tokens de la clínica eran 7). En el pico hay 9.0 a la vez. ¿Cuántas tarjetas pide el pico? Si el servidor trae dos y una falla, ¿sigue el servicio? Y con la misma mezcla de planes, ¿hasta cuántos despachos aguanta una sola?
???
1. 9.0 ≤ 13: **una tarjeta** aguanta el pico.
2. Con dos, si falla una, la otra tiene 13 lugares para 9.0: el servicio sigue (más lento en la fila: la sección del vecino lo mide). Es un [[n-mas-1|N+1]] de capacidad dentro del servidor.
3. Cada usuario aporta 9.0 ÷ 320 ≈ 0.0281 conversaciones en el pico. 13 ÷ 0.0281 ≈ 462 usuarios, ≈ **65 despachos** con la misma mezcla. La herramienta da 12.81 con 455 usuarios (64 despachos) y 13.00 con 462: desde el 65, el pico pide las dos tarjetas.
:::

El modelo es el de la clínica: **Qwen3.8 27B** (5-ago-2026, [[apache-2|Apache 2.0]], 27.78 mil millones de parámetros) en FP8 y sin razonamiento, con **Qwen3-Embedding-0.6B** (Apache 2.0) para los vectores. Por qué ese modelo lo cuenta el [caso de la clínica](/casos/clinica/); aquí importa que su licencia deja venderlo como servicio sin condiciones.

### Memoria y velocidad

La memoria no limita: con la [herramienta de VRAM](/herramientas/vram/?V=rtx-pro-6000-blackwell-server&P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=8192&u=13), 13 conversaciones al tope de 8,192 tokens ocupan 39.30 de 86.40 GB útiles.

:::profundo La cuenta de la memoria
:::cuenta La memoria de una Server Edition con 13 conversaciones
Pesos en FP8, \(W\) // la cuenta de la clínica | (27.78 − 2.543) × 1 + 2.543 × 2 | 30.32 GB
KV por token, \(m_{token}\) // solo 16 de 64 bloques guardan KV | 2 × 16 × 4 × 256 × 2 bytes | 64 KiB
KV de las 13 al tope | 13 × 65,536 × 8,192 | 6.98 GB
Lo que necesitas // pesos + KV + 2 GB de programa | 30.32 + 6.98 + 2 | 39.30 GB
Lo que tienes, \(M_{útil}\) | 96 × 0.9 | 86.40 GB
= Sobran 47 GB: al tope cabrían 100 conversaciones. La memoria no limita; limita la velocidad.
:::
:::

La [herramienta de velocidad](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=6000&No=500&b=1) da **36.4 tokens/s** con una conversación; una [L40S en FP8](/herramientas/velocidad/?p1=l40s&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=6000&No=500&b=1), **19.68**: no llega a 20 ni sola. En [INT4 de AWQ](/herramientas/sizing/?p1=l40s&U=320&r=15.78125&Np=6000&No=500&h=10&pk=2.5&v=20&P=27.78&A=27.78&Et=2.543&bits=4.15625&L=16&g=4&d=256&q=24&bkv=2) sí: 4 por tarjeta.

| Opción | Lugares por tarjeta a ≥ 20 tokens/s | Tarjetas para el pico | Con N+1 |
|---|---|---|---|
| L40S, FP8 | 0 | ninguna llega | — |
| L40S, INT4 de AWQ | 4 | 3 (pico de 9.4: su prefill tarda 1.88 s) | 4 |
| RTX PRO 6000 Server Edition, FP8 | **13** | **1** | **2** |

:::profundo Por qué 13 lugares y no 7
:::formula Los lugares que sostienen la velocidad
c = λ × (t_{pre} + frac{N_o}{v})
- λ: preguntas por segundo en el pico
- t_{pre}: el prefill de una pregunta, en segundos (el tiempo al primer token sin fila)
- N_o: tokens de la respuesta
- v: la velocidad objetivo, en tokens por segundo
- c: conversaciones a la vez; cada tarjeta sostiene un número fijo de ellas, el que deja cada paso del decode en 1 ÷ v segundos contando el tiempo que se va en los prefills nuevos
:::

La herramienta de sizing reparte el tiempo de la tarjeta: cada paso del [[decode]] lee los pesos una vez para todas las conversaciones, y cada pregunta nueva le quita su [[prefill]]. Con 6,000 tokens el prefill cuesta la mitad que con los 12,000 de la clínica, y el KV de cada conversación es la mitad: caben **13** en vez de 7. Por eso los «lugares por tarjeta» nunca se copian de otro caso.
:::

:::cuenta Cuánto crece la startup con una tarjeta
Conversaciones por usuario en el pico // 9.0 ÷ 320 | 9.006 ÷ 320 | 0.0281
Usuarios que llenan una tarjeta // 13 lugares | 13 ÷ 0.0281 | ≈ 462
Despachos con la misma mezcla // 462 ÷ 320 × 45 | ≈ 65.0 | ≈ 65
Con el 30 % de [[holgura]] en el servidor // 26 × 0.7 = 18.2 lugares | 18.2 ÷ 0.0281 ÷ 320 × 45 | ≈ 91
= Hasta 64 despachos, una tarjeta sola aguanta el pico y la otra es repuesto. Desde el 65, las dos trabajan en el pico y una falla deja el servicio corto.
:::

Pero la mezcla no crece pareja: 5 despachos Empresa **más** (10 en total) ya ponen 13.5 a la vez en el pico (la calculadora de margen, en la sección de costo). El N+1 se pierde con 50 despachos, no con 65. **La capacidad la mueven los grandes.**

## La propuesta de hardware {The hardware proposal}

:::intenta ¿Uno o dos servidores?
Un servidor con dos Server Edition aguanta el pico con una tarjeta caída. Pero tiene **un** chasis, **una** red y **una** alimentación del rack: si falla cualquiera, se caen los 45 despachos. En un mes de 30 días ([Cotizar](/cotizar/)), 99.5 % permite 216 minutos de caída; 99.9 %, **43.2**. Cambiar una pieza en colocation pide que alguien llegue con ella. Un servidor más cuesta ≈ US$2,237 al mes; una tercera tarjeta en el chasis, ≈ US$531 (depreciación y 0.6 kW de rack). ¿Qué SLA se promete con uno? ¿Cuándo se compra el segundo, y qué se compra cuando la startup pase de 65 despachos?
???
1. Una sola falla de la máquina (reiniciar, revisar, confirmar) se come buena parte de 43.2 minutos; una pieza que tarda un día, varios meses. **99.9 % no se sostiene con uno**; 99.5 % sí.
2. El segundo servidor lo pide **el SLA**, no la GPU: cuando un despacho compre 99.9 % o cuando un cliente pague su propia copia.
3. Pasar de ≈ 65 despachos pide **lugares**, no otra máquina: una tercera tarjeta devuelve el N+1 (39 lugares, 26 con una caída) por la cuarta parte de un servidor. La [herramienta de TCO con 3 tarjetas](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=320&r=15.78125&Np=6000&No=500&D=22&G=3&gs=4&S=40461.3&V=36&res=0.2&kwh=0&oe=725&op=1883&tc=19.7203) da US$4,651 al mes, ≈ MXN 91,721.
:::

### Tres opciones

| | A) 1 servidor, 2 × Server Edition | B) 1 servidor, 4 × L40S en INT4 | C) 2 servidores, 2 × Server Edition cada uno |
|---|---|---|---|
| Lugares a ≥ 20 tokens/s | 26 | 16 | 52 |
| Si falla una tarjeta | sigue: 13 contra 9.0 | sigue: 12 contra 9.4 | sigue |
| Si falla el servidor | se caen todos | se caen todos | sigue con el otro |
| SLA que se puede prometer | 99.5 % | 99.5 % | 99.9 % |
| Formato | FP8 | INT4 | FP8 |
| Compra (US$) | 74,779.28 | 76,101.30 | 149,558.56 |
| Al mes, herramienta de TCO (US$) | 4,120 | 4,199 | 6,357 |
| Margen bruto con los 45 de hoy | 57.4 % | 56.6 % | 34.3 % |

:::profundo De dónde salen los precios
Precios de `equipos.json`: la Server Edition a **US$17,158.99** (CDW, 26-nov-2026, sin existencias) y el chasis Exxact a **US$40,461.30** (25-nov-2026), sin impuestos ni importación; las L40S, a US$8,910 cada una. Que el chasis acepte la Server Edition, y una tercera, se confirma con Exxact (su configurador lista 10 ranuras).
:::

**La decisión: A ahora, una tercera tarjeta cuando falten lugares, C cuando lo pida el SLA.** El N+1 de tarjeta alcanza (13 lugares contra 9.0); FP8 y no INT4, porque la falla grave de este examen es un RFC o un monto cambiado ([Formatos de cuantización](/formatos-cuantizacion/)); 10 lugares más que B por US$79 menos al mes. Y el segundo servidor cuesta **23 puntos de margen**: comprarlo «por si acaso», sin nadie que pague 99.9 %, deja a la startup en 34 %.

:::ojo La trampa: vender 99.9 % «porque todos lo venden»
Microsoft 365 promete 99.9 % al mes por servicio y devuelve 25 %, 50 % o 100 % de lo que se paga ese mes por el servicio caído bajo 99.9 %, 99 % o 95 %, si el cliente lo reclama (el ejemplo de Microsoft Learn, 27-nov-2026; el texto que obliga es el SLA de Microsoft Online Services de cada edición). Copiar ese número con un solo servidor es firmar créditos que se van a pagar.
:::

### Dónde viven: el rack en Querétaro

El [caso del despacho](/casos/despacho/) comparó cuarto propio y [[colocation]]. Una startup no tiene cuarto y sus clientes llegan por internet: va a un rack en Querétaro, donde está más del 60 % de la capacidad de centros de datos de México ([El cuarto](/el-cuarto/)).

:::profundo Lo que se contrata y lo que falta cotizar
- **Potencia**: 2.3 kW por servidor (el pico estimado de `equipos.json`). La energía va dentro del precio por kW.
- **Precio**: el único dato primario es mayorista: **US$250–270 por kW al mes**, en bloques de 250 a 500 kW (CBRE, 1T 2026, en la ficha del despacho). Un cliente de 2.3 kW no lo consigue. El caso usa US$250 como **cota baja** (US$575 al mes) y el doble, US$500, como escenario alto (US$1,150): un supuesto hasta tener dos cotizaciones.
- **Lo que no está en la cuenta**: el tránsito de internet del sitio, los cruces de fibra y la IP fija. Se cotizan con el mismo operador.
- **Las [[manos-remotas|manos remotas]]**: quién del sitio mete una pieza a las 3:00 y cuánto cobra por hora. Con un solo servidor, eso decide el tiempo de una caída.
- **Discos cifrados** ([[cifrado-en-reposo|en reposo]]), con la llave fuera del rack: así el operador del colocation solo aloja una caja cerrada y no ve datos. Si los viera, sería un subencargado (la sección de la ley).
- **El segundo servidor**, cuando llegue, va en **otro rack** (mejor, otro sitio u otro operador), con su propia fuente y su propia red: dos servidores en el mismo rack comparten la falla que más importa.
:::

## Aislamiento, capa por capa {Isolation, layer by layer}

:::intenta ¿Por dónde se puede filtrar un despacho a otro?
La pila: la app con la sesión, el gateway (LiteLLM), la búsqueda (una base de vectores con los fragmentos de los 45 despachos), el motor (vLLM, que reusa los bloques de KV de un prefijo que ya calculó) y los registros. Para cada capa, ¿cómo podría un despacho recibir algo de otro, y qué lo impide?
???
1. **App**: un id que manda el navegador se cambia. Sale de la **sesión**.
2. **Gateway**: una clave compartida mezcla cuotas y gasto. **Un equipo por despacho**.
3. **Búsqueda**: una consulta sin filtro trae de todos. El filtro lo pone **el servicio**, siempre.
4. **Motor**: el caché compartido deja medir por el tiempo si otro mandó un prefijo. **Una sal secreta por despacho**.
5. **Registros**: **por despacho y sin texto**.
6. Y **un examen** que intenta todo lo anterior en cada versión.
:::

La regla que las une: **una sola fuente de verdad**. El id sale de la sesión y **un solo servicio** lo convierte en el equipo del gateway, la sal, el filtro y la etiqueta del registro. Ninguna pieza confía en un id de la petición (lo piden las guías de vLLM y de Qdrant, 27-nov-2026).

:::diagrama caso-saas-camino
Toca cada caja para ver qué hace con el id del despacho. «Una pregunta del despacho A» sigue el camino normal; «El lote de 5,000 documentos», al vecino ruidoso; «Un intento de fuga», a alguien que cambia el id.
:::

:::profundo La app es propia, no Open WebUI
Open WebUI, la interfaz del despacho de abogados, no sirve: la licencia de su versión 0.13.5 (25-nov-2026) prohíbe quitar su marca con más de **50 usuarios finales** en 30 días, salvo permiso o licencia enterprise, y la startup tiene 320 y su propia marca.
:::

### El gateway: un equipo por despacho

LiteLLM 1.111.0 (25-nov-2026) ordena todo en organización → equipo → usuario → [[clave-de-api|clave]] y bloquea una petición si **cualquier** nivel pasó su presupuesto. Equipos y claves son de código abierto, así que cada despacho es un **equipo**, con los límites de [Gateway](/gateway/) según su plan:

| Plan | Requests a la vez | Tokens por minuto | Preguntas al mes | SLA |
|---|---|---|---|---|
| Básico | 2 | 20,000 | 1,500 | sin SLA |
| Pro | 4 | 60,000 | 6,000 | 99.5 % |
| Empresa | 6 | 100,000 | 25,000 | 99.5 % (99.9 % con dos servidores) |

En el pico, un Básico tiene 0.05 preguntas abiertas en promedio y un Empresa 0.89; 20,000 tokens por minuto son ≈ 3 preguntas de 6,500, y los topes al mes, ≈ 2.3 veces el uso típico. Lo que protege a los demás es la primera columna: **ningún despacho ocupa más de 6 de los 26 lugares**.

:::profundo Lo que es de pago y lo que no sirve para 45
- **De pago** (verificado en el código de 1.111.0): nombrar administradores de equipo (sin eso, la startup administra todos los equipos, que es lo que se quiere), el presupuesto por modelo de un equipo y los *tiers* de presupuesto. Nada de eso hace falta.
- **El «Customer Management» nuevo** de la 1.111.0 parece hecho para esto (organización-cliente, equipo y miembro con cabeceras), pero sin licencia permite **5** organizaciones-cliente. Para 45, los equipos normales.
- **«Multi-tenant» en la documentación de LiteLLM** quiere decir otra cosa: equipos **dentro** de una empresa, aislados en acceso y gasto, no en datos ni en caché.
- **`upperbound_key_generate_params`** rechaza con un 400 una clave pedida con más límite que el tope: si algún día un despacho crea sus propias claves, no se da más de lo que paga.
- **El TPM (tokens por minuto) cuenta entrada y salida** y se reserva antes de la llamada; si la petición no trae `max_tokens`, usa una estimación (`default_estimated_output_tokens`). Por eso el servicio manda `max_tokens: 600` siempre.
- **«Preguntas al mes» se cuentan en dinero.** El presupuesto de LiteLLM (`max_budget` con `budget_duration`) suma pesos o dólares, no preguntas. Para un modelo propio se le pone un precio interno por token en `model_info` (`input_cost_per_token`, `output_cost_per_token`; su página de precios propios, 27-nov-2026), y el tope del plan es ese precio por las preguntas incluidas.
- **La llave del lote va en un equipo aparte** («despacho A · lotes»). Los límites de un equipo valen para la suma de sus llaves, y 4 documentos a la vez son ≈ 96,000 tokens por minuto (4 × 60 ÷ 10.45 × 4,200): en el mismo equipo, el lote se comería los 6 lugares y los 100,000 tokens por minuto del Empresa.
:::

### La búsqueda: el filtro lo pone el servicio

La lección [RAG privado](/rag-privado/) ya pone el permiso **dentro** de la búsqueda ([[prefiltro]]). Aquí el permiso es de despacho, y Qdrant 1.20.2 (16-nov-2026) tiene su receta: **una sola colección** con el id del despacho en cada punto y un índice `keyword` con `is_tenant: true`, que guarda juntos los vectores de cada cliente. Pero su propia guía avisa que ese índice **no autoriza**: «A client with unrestricted credentials can omit the filter and access other tenants' points.» Y sus permisos (llaves firmadas, JWT) son por colección, no por filtro. Así que el filtro va en **cada** consulta, actualización y borrado, lo pone el servicio con el id de la sesión, y nadie fuera del servicio tiene la clave de Qdrant.

:::profundo Los despachos grandes y las estadísticas mezcladas
- **Una pieza propia para cada Empresa.** Desde la 1.16, Qdrant tiene *multitenancy* por niveles: los despachos chicos comparten una pieza (*shard*) de respaldo y uno grande se **promueve** a la suya sin dejar de leer ni escribir. Pide crear la colección con *sharding* personalizado desde el principio (no se cambia después), y el filtro sigue haciendo falta en la pieza compartida. Los 5 Empresa tienen ≈ 120,000 documentos cada uno (supuesto): van en la suya.
- **BM25 comparte estadísticas.** En la búsqueda por palabras ([[bm25|BM25]]), el peso de una palabra rara (su IDF) se calcula con el corpus de **todos** los despachos: una fuga de *relevancia*, no de contenido. Desde la 1.19, Qdrant tiene el parámetro de búsqueda `idf` para calcularlas solo con los documentos de un cliente (por omisión, `global`); en una pieza propia ya salen solo de lo suyo. Es chica, pero un cliente con auditor la pregunta.
- **La forma, en una línea** (ilustración, no se corre aquí): el índice se crea una vez con `{"field_name": "despacho", "field_schema": {"type": "keyword", "is_tenant": true}}`, y cada búsqueda lleva `{"must": [{"key": "despacho", "match": {"value": <id de la sesión>}}]}`.
:::

### El motor: el caché que habla

El [[prefix-caching|prefix caching]] de vLLM viene **prendido** por omisión ([Batching](/batching/) explica cómo: cada bloque de KV se guarda con el hash de sus tokens y de todos los anteriores). Con 45 clientes es un **[[canal-lateral|canal lateral]]**: una fuga que no pasa por la respuesta, sino por el tiempo.

:::figura caso-saas-cache
Arriba, sin sal: B manda el mismo principio que A, sus bloques tienen las mismas llaves y el primer token llega más rápido. Abajo, con una sal por despacho: las llaves no coinciden y B no aprende nada.
:::

Un usuario de B escribe el principio de un texto que cree que A tiene («Estado de cuenta de Grupo X…») y mide el TTFT: si llega más rápido que con un texto nuevo, B sabe quién es cliente de A. vLLM lo registra como **CVE-2025-46570**. Su defensa es la **[[cache-salt|sal del caché]]** (`cache_salt`): se mezcla en el hash del primer bloque y solo comparten bloques las peticiones con la **misma** sal. Tres reglas de su guía: la sal es **secreta** (256 bits al azar por despacho, nunca su id), va en **cada** petición y **no la pone el cliente** (el gateway borra la que llegue).

:::ojo La sal no es una frontera
La guía de vLLM: «vLLM does not provide isolation between tenants that share the same server process.» La sal cierra un canal; para aislar recomienda **una instancia por cliente**. El caso da capas a todos y una copia propia a quien la pague.
:::

:::profundo El motor, flag por flag
```bash
vllm serve Qwen/Qwen3.8-27B --quantization fp8 --max-model-len 8192 --max-num-seqs 14 \
  --served-model-name asistente --api-key "$VLLM_CLAVE" --enable-prefix-caching \
  --reasoning-parser qwen3 --default-chat-template-kwargs '{"enable_thinking": false}'
```

El comando de la clínica, con dos cambios: el tope de 8,192 tokens y `--max-num-seqs 14`, uno más que los 13 lugares (en el pico, la conversación 14 va un poco más lenta en vez de esperar). El prefix caching se deja prendido y con su hash por omisión, **sha256**: la documentación de vLLM avisa que el `xxhash`, más rápido, puede filtrar información entre clientes por colisiones. Una copia así en cada tarjeta, y el gateway reparte entre las dos.
:::

:::profundo Cómo se pone la sal, y los avisos de seguridad de 2026
**LiteLLM 1.111.0 no conoce `cache_salt`**: no aparece ni una vez en su código. Se pone con un *hook* propio, `async_pre_call_hook`, que corre antes de cada llamada con los datos del equipo a la mano. La forma (ilustración, no probada; la firma y el `team_id` son los de la documentación de LiteLLM, 27-nov-2026):

```python
from litellm.integrations.custom_logger import CustomLogger

class SalPorDespacho(CustomLogger):
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        data.pop("cache_salt", None)                     # nada que mande el cliente
        sal = SALES[user_api_key_dict.team_id]           # 256 bits por despacho, de un almacén de secretos
        data.setdefault("extra_body", {})["cache_salt"] = sal
        return data
```

Que LiteLLM **reenvíe** ese campo a vLLM tampoco está verificado: es la primera prueba del piloto (se manda una petición con sal y se revisa en vLLM que llegó).

**Los avisos de vLLM.** En 2026, cinco avisos de seguridad tocaron el aislamiento entre clientes: una sal sin largo máximo (una de 100 MB traba el planificador para todos), una validación laxa de la sal que tumbaba el motor con LMCache, una ruta de herramientas que perdía la sal, un DoS entre clientes con `prompt_logprobs` (pedir las probabilidades de los tokens del prompt; severidad alta) y una fuga de tokens entre usuarios con planificación asíncrona y paralelismo de pipeline (de la 0.16.0 a la 0.20.2). La 0.34.0 es posterior a todos (avisos de GitHub, 27-nov-2026). La regla de [Seguridad](/seguridad/) se queda: lo alcanzable y explotado se parcha ese día. Y se le suma una: un aviso de **aislamiento entre clientes** se parcha a más tardar **esa semana** aunque nadie lo esté explotando, porque cualquier despacho alcanza el motor, y el examen de fugas corre antes de subir la versión.
:::

:::profundo Registros por despacho
Las métricas de vLLM no traen etiqueta de cliente: el gasto, los tiempos y los errores **por despacho** los anota el gateway, **sin el texto** ([Gateway](/gateway/)). De ahí salen la factura y el SLA de cada uno.
:::

:::profundo Un adaptador LoRA por despacho
Un despacho Empresa puede pedir que el asistente escriba con su vocabulario. Un [[adaptador-lora|adaptador LoRA]] es un archivo chico de pesos que se suma al modelo; vLLM sirve varios y cada uno se pide como si fuera otro modelo. Tres cuidados:

- **Aísla el comportamiento, no los datos.** Los documentos siguen en la base compartida, con su filtro.
- **El adaptador es dato del cliente**: se entrenó con lo suyo. Solo sus llaves lo piden y se borra con su contrato.
- **No caben todos a la vez**: `--max-loras` dice cuántos entran en un mismo lote (1 por omisión). La tabla de vLLM 0.34.0 marca LoRA para la arquitectura de Qwen3.8; que funcione con los pesos en FP8 y cuánto cuesta en velocidad no se verificó. Se prueba antes de venderlo.
:::

## Cuotas y el vecino ruidoso {Quotas and the noisy neighbor}

:::intenta ¿Cuánto espera todo el mundo?
A las 8:30, un despacho Empresa sube **5,000 documentos** del cierre. El modelo saca la ficha de cada uno (tipo, RFC, periodo, montos) con ≈ 4,000 tokens de entrada y 200 de salida: ocupa un lugar ≈ **10.45 s** ([herramienta de velocidad](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=4000&No=200&b=1): 0.45 s de prefill + 200 ÷ 20). El servidor tiene 26 lugares. Si los 5,000 entran a la misma fila que las preguntas, ¿cuánto espera una pregunta que llega a las 8:31? ¿Y si el lote solo puede tener 4 a la vez?
???
1. Delante tiene ≈ 5,000 documentos × 10.45 s ÷ 26 lugares ≈ **2,010 s ≈ 33 minutos**.
2. Con un tope de 4: el lote ocupa 4 lugares y deja **22** para las 9.0 conversaciones de los demás. La pregunta casi no espera.
3. El costo lo paga el lote: 5,000 × 10.45 ÷ 4 ≈ 13,060 s ≈ **3.63 h**. Termina hacia las 12:08.
:::

El despacho del lote no hace nada prohibido. Es un **[[vecino-ruidoso|vecino ruidoso]]**: su pico, en una fila compartida, se vuelve la espera de todos ([Colas](https://sensei.trueml.app/colas/), en Sensei).

:::analogia El vecino que llena la alberca a mediodía
Si un vecino llena su alberca el sábado a mediodía, nadie en el edificio tiene presión en la regadera. No se le prohíbe la alberca: se le pide que la llene de noche o con una llave más chica.

Dónde se rompe: el agua se reparte sola por la tubería. Una fila de un servidor no reparte: atiende en orden, y el primero que llega con 5,000 cubetas las forma todas delante de ti.
:::

:::formula El lote con tope
T = frac{N × t_d}{k}
q = R − k
- N: documentos del lote
- t_d: lo que ocupa cada documento un lugar, en segundos
- k: el tope, documentos a la vez (el `max_parallel_requests` de la llave del lote)
- T: lo que tarda el lote, en segundos
- R: lugares del servidor a ≥ 20 tokens por segundo
- q: lugares que les quedan a los demás, contra sus c conversaciones del pico
:::

:::cuenta El lote de las 8:30 con tope de 4
Lo que tarda, \(T\) // \(N\) = 5,000; \(t_d\) = 10.45 s; \(k\) = 4 | 5,000 × 10.45 ÷ 4 | 13,063 s ≈ 3.63 h
Lugares que quedan, \(q\) // \(R\) = 26 | 26 − 4 | 22
Lo que usan los demás en el pico, \(c\) // herramienta de sizing | 0.351 × 25.68 | 9.0
Holgura de los demás | 22 ÷ 9.0 | 2.4 ×
Si una tarjeta está caída // \(R\) = 13 | 13 − 4 | 9, contra 9.0
= De día, el tope deja de sobra. Con una tarjeta caída, deja **justo** lo que usan los demás: ahí el lote se pausa.
:::

### Lo que dice la simulación

Little da promedios; el p95 sale de simular: llegadas al azar a 0.351 por segundo durante 2 horas, una **sola fila en orden de llegada** (así atiende vLLM por omisión) y el gateway, que deja entrar a lo más \(k\) documentos a la vez.

:::figura caso-saas-vecino
La espera en la fila de las preguntas de los demás, en el p95. Los 5,000 de golpe les cuestan ≈ 29 minutos; un tope de 4 los deja en cero; con una tarjeta caída, hasta el tope de 4 pesa.
:::

:::profundo La simulación, en Python
```python
import heapq, random
def p95(k, lugares=26, semilla=0, lam=0.3507, preg=25.68, doc=10.45, docs=5000):
    r = random.Random(semilla); t, ev = 0.0, []
    while (t := t + r.expovariate(lam)) < 7200:       # 2 h del pico: 0.351 preguntas por segundo
        ev.append((t, "p"))
    ev += [(1800.0, "d")] * min(k, docs)               # 8:30: entran los primeros k documentos
    heapq.heapify(ev); faltan, libres, fila, esperas = docs - min(k, docs), lugares, [], []
    while ev:
        t, que = heapq.heappop(ev)
        if que in ("fp", "fd"): libres += 1            # termina una pregunta o un documento
        else: fila.append((t, que))
        if que == "fd" and faltan: faltan -= 1; fila.append((t, "d"))   # entra el siguiente
        while libres and fila:                          # una sola fila, en orden (vLLM en fcfs)
            llego, tipo = fila.pop(0); libres -= 1
            if tipo == "p":
                esperas.append(t - llego)
                heapq.heappush(ev, (t + preg * r.lognormvariate(0, 0.35) / 1.063, "fp"))
            else: heapq.heappush(ev, (t + doc, "fd"))
    esperas.sort(); return esperas[int(0.95 * len(esperas))]
for nombre, k, lug in [("sin vecino", 0, 26), ("5,000 de golpe", 5000, 26), ("tope de 4", 4, 26),
                       ("tope de 20", 20, 26), ("una tarjeta, sin lote", 0, 13), ("una tarjeta, tope de 4", 4, 13)]:
    v = sorted(p95(k, lug, s) for s in range(100))
    print(f"{nombre:22} espera p95 de los demás: {v[50]:7.1f} s")
```

```salida
sin vecino             espera p95 de los demás:     0.0 s
5,000 de golpe         espera p95 de los demás:  1766.5 s
tope de 4              espera p95 de los demás:     0.0 s
tope de 20             espera p95 de los demás:     5.1 s
una tarjeta, sin lote  espera p95 de los demás:     4.9 s
una tarjeta, tope de 4 espera p95 de los demás:    13.4 s
```

Es un modelo de **lugares**, no vLLM: supone que cada tarjeta sostiene 13 conversaciones a 20 tokens por segundo (lo que dice la herramienta) y no modela cómo se frena el decode cuando el lote es grande. Además, un documento pesa más que una pregunta: con 4,000 + 200 tokens su prefill es una parte mayor de su tiempo, y la [herramienta de sizing con los documentos](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=5000&r=1&Np=4000&No=200&h=1&pk=1&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) da **9** por tarjeta, no 13. Cada documento ocupa ≈ 1.4 lugares de pregunta (13 ÷ 9): con el tope de 4 quedan ≈ 20 de 26, y con una tarjeta caída ≈ 7, menos que las 9.0 de los demás. Los 33 minutos y los números de la simulación son cotas bajas; la [[prueba-de-carga|prueba de carga]] los reemplaza.
:::

Tres lecturas. **Los 5,000 de golpe** dejan el p95 de las dos horas en ≈ **29 minutos**: la pregunta de las 8:31 espera ≈ 33, y las que llegan después, menos. **Un tope de 4** deja la espera en 0.0 s; uno de 20 ya no (6 lugares para 9.0 conversaciones: 5.1 s). Y **con una tarjeta caída**, aun sin lote, la espera es 4.9 s: el primer token llega en ≈ 5.6 s y el servicio sigue, pero **degradado** ([Cotizar](/cotizar/) separa «caído» de «degradado»); con el lote encima, 13.4 s. Por eso, cuando cae una tarjeta, **el lote se pone en 0**. De noche, con 13 a la vez, tarda 1.12 h y no estorba a nadie.

:::profundo Juega con el tope
:::calculadora caso-saas-lote
Mueve el tope y los lugares. El veredicto es en promedio; la simulación de arriba dice cuándo ya se siente en el p95.
:::
:::

### Tres límites juntos

LiteLLM limita **a la entrada**; vLLM solo **ordena** (por llegada o por prioridad), y una [[cola-justa|cola justa]], con turnos por cliente, no la trae ninguna pieza. La defensa es la barata, todo junto: **requests a la vez por despacho**, **tokens por minuto** por plan, una **llave y una fila aparte para los lotes** (4 de día, 13 de noche, 0 si falta una tarjeta). Los tokens por minuto solos no bastan: dejan pasar la ráfaga.

:::profundo La prioridad y la cola justa, a noviembre de 2026
- **La prioridad de LiteLLM** (campo `priority` o cabecera `x-litellm-priority`) alimenta una cola de su *router*; su página la marca **BETA** «para probar» y solo la leen `/v1/chat/completions` y `/v1/completions`. La cabecera la puede mandar cualquiera: el gateway la fija según el plan.
- **vLLM** acepta `--scheduling-policy priority` (menor valor, antes); con memoria escasa expulsa a la de menor prioridad. Que LiteLLM le reenvíe el campo `priority` no está verificado: se prueba en el piloto antes de usarlo para poner las preguntas delante de los lotes.
- **Colas justas publicadas**: VTC (*Virtual Token Counter*, OSDI 2024) atiende primero al cliente al que se le han servido menos tokens, con una cota demostrada de 2× entre dos; Cohere describe en su blog (2026) un *Deficit Round Robin* con una fila por cliente. Hay un RFC abierto en vLLM para planificadores propios. Hoy sería código de la startup.
:::

## La startup como persona encargada {The startup as data processor}

:::intenta ¿Qué contesta la startup a cada pregunta del cliente?
Un despacho Empresa pregunta antes de firmar: a) «¿Quién más ve mis documentos?» b) «¿Qué pasa con ellos si me voy?» c) «¿Entrenan su modelo con mis datos?» d) «¿Qué pasa si hay una brecha?» e) «¿Tienen SOC 2 o ISO 27001?» f) «¿Cómo sé que otro despacho no ve lo mío?» Para cada una, ¿qué documento o qué control la contesta?
???
1. **a)** La lista de **subencargados** del contrato, autorizada por el despacho.
2. **b)** La cláusula de **borrado**: respaldo completo al despacho y borrado en 30 días (los 5 años del Código Fiscal los guarda el despacho).
3. **c)** El contrato: los datos solo sirven para contestarle a ese despacho.
4. **d)** El aviso al despacho en 24 horas (plazo del contrato); el despacho avisa a sus titulares.
5. **e)** El plan honesto: SOC 2 Tipo II a 12–18 meses; mientras, el cuestionario contestado.
6. **f)** El **examen de fugas** de la versión en producción: 0.
:::

La ley de datos la explica la lección de Sensei [Privacidad](https://sensei.trueml.app/privacidad/), y el [caso de la clínica](/casos/clinica/) la aplica artículo por artículo. Aquí cambia el papel: la clínica era **responsable** de los datos de sus pacientes; la startup no es responsable de nada que suba un despacho. Es su **[[encargado-de-datos|persona encargada]]**: la LFPDPPP vigente (DOF, 20-mar-2025; última reforma, 14-nov-2025) llama así a quien «trate datos personales por cuenta del responsable» (art. 2-XII). Y casi no dice más. El detalle sigue en el **Reglamento de 2011**, que la Cámara todavía publica como vigente (qué tanto lo sigue con la ley nueva no se pudo confirmar, como en la clínica). Es la lectura del caso, no asesoría.

:::profundo Lo que dicen la ley y el Reglamento del encargado
La ley de 2025 menciona a la persona encargada al definir la transferencia (art. 2-XX: comunicar datos a alguien **distinto** del titular, del responsable o de la persona encargada) y en el art. 35; no tiene un artículo de obligaciones del encargado ni de subcontratación. Sí obliga a todos en dos cosas que la startup hereda: medidas de seguridad **según el riesgo, la sensibilidad de los datos y el desarrollo tecnológico** (art. 18) y confidencialidad aun después de terminar la relación (art. 20). Las multas van de 100 a 320,000 UMA (art. 59; la UMA es la unidad en pesos con que las leyes fijan multas, y cambia cada año).

| Reglamento de 2011 | Lo que dice | En el contrato de la startup |
|---|---|---|
| Art. 50 | Tratar solo según instrucciones; no usar para otra finalidad; medidas de seguridad; confidencialidad; **suprimir al terminar**; no transferir | Cada uno es una cláusula |
| Art. 51 | La relación se acredita con cláusulas contractuales u otro instrumento | El contrato, firmado con cada despacho |
| Art. 54 | Toda subcontratación la **autoriza el responsable** y el subcontratado asume las mismas obligaciones | La lista de subencargados |
| Art. 55 | Basta que el contrato prevea las subcontrataciones | La lista va en un anexo, y se avisa antes de cambiarla |
:::

### El contrato de encargo y el borrado

El **[[contrato-de-encargo|contrato de encargo]]** (en inglés, DPA) dice qué datos y para qué (solo dar el asistente a ese despacho), las medidas de seguridad, la confidencialidad, el borrado al terminar, que no se transfieren y la lista de **[[subencargado|subencargados]]**: el respaldo cifrado fuera del sitio y el correo de avisos. El colocation no va en la lista mientras solo aloje una caja con discos cifrados y la llave fuera.

**El borrado choca con el Código Fiscal, y se resuelve en el orden.** La contabilidad se conserva **5 años** desde que se presentaron las declaraciones (Código Fiscal de la Federación, art. 30; última reforma, DOF 9-abr-2026), pero esa obligación es del despacho, no de la startup. Así que al terminar la startup **entrega primero** un respaldo completo y **borra después**, en 30 días: documentos, vectores, adaptador, sal y registros con contenido.

### SOC 2 y ISO 27001, con su precio

Un despacho chico no pide nada de esto. Uno con clientes bancarios pide además cifrado en reposo y en tránsito, la promesa de no entrenar con sus datos, el aviso de brechas y un informe **[[soc-2|SOC 2]] Tipo II** o la certificación **[[iso-27001|ISO/IEC 27001]]** (lista del caso, no de una fuente).

:::cuenta Lo que pesa un SOC 2 en una startup de este tamaño
Ingreso al año // ficha: MXN 190,805 × 12 ÷ 19.7203 | 2,289,660 ÷ 19.7203 | ≈ US$116,100
Primer año de SOC 2 Tipo II // cifras de vendedores (Drata, 2026) | 25,000 a 50,000 | US$
Como parte del ingreso | 25,000 ÷ 116,100 … 50,000 ÷ 116,100 | 22 % a 43 %
= Entre un quinto y casi la mitad del ingreso de un año. Se hace con el alcance más chico (el servicio y quien lo opera) y cuando un contrato lo pague: meta a 12–18 meses.
:::

:::profundo Plazos y la ISO
La auditoría Tipo II observa los controles de 3 a 12 meses; con preparación, de 6 a 18 meses desde cero (vendedores, fuente secundaria). La ISO/IEC 27001 vigente es la de 2022 (la transición desde la de 2013 terminó el 31-oct-2025) y en México no tiene tarifa pública: se cotiza con un organismo de certificación. Mientras tanto, la startup contesta el cuestionario de seguridad con lo que ya tiene: el contrato, la lista, el cifrado y el examen de fugas.
:::

## Evals y riesgos {Evals and risks}

:::intenta ¿Cuántas preguntas cruzadas para «a lo más 1 %»?
La lección [Demostrar que el modelo abierto sirve](/evals/) da la cota cuando no hay fallas: si en \(n\) pruebas no aparece ninguna, con 95 % de confianza la tasa real es a lo más \(1 − 0.05^{1/n}\) (≈ 3 ÷ \(n\)). El examen de fugas hace preguntas del despacho de prueba A que no deben traer nada de B, y al revés. ¿Cuántas, para demostrar que una fuga pasa en menos de 1 % de las preguntas? ¿Basta con eso?
???
1. Con 300 sin ninguna fuga: 1 − 0.05^(1/300) ≈ **0.99 %**; con 300 en cada dirección (600), ≈ **0.50 %**.
2. **No basta.** Una sola fuga es el fin de un contrato, y el aislamiento no se rompe con el uso sino con un **cambio** (una versión, una consulta nueva sin filtro). Por eso el criterio es **0** y el examen corre **en cada despliegue**.
:::

### El examen de fugas

El **[[examen-de-fugas|examen de fugas]]** usa dos despachos de prueba con documentos sintéticos que traen una **marca**, una frase inventada que solo existe en los suyos. Tres partes: **300 preguntas cruzadas** en cada dirección (ninguna respuesta, fragmento ni cita con una marca ajena); **100 intentos de quitar o cambiar el id**, como pide la guía de Qdrant (el id de A en el cuerpo de una petición de B, una petición sin id, una llave de B pidiendo el adaptador de A); y **la prueba de tiempo del caché** (ejercicio 6). Una sola marca detiene el despliegue: es un [[gate-de-calidad|gate]] con criterio de cero.

### El examen de calidad y la prueba del vecino

**Uno común, no uno por despacho.** El [[golden-set|examen]] de calidad usa un despacho **sintético** (los documentos de un cliente no se leen para esto): 200 preguntas, con el criterio del despacho de abogados (≥ 85 % bien y con cita, ≤ 2 % de [[cita-inventada|citas inventadas]]) más uno propio: **0 montos o RFC cambiados**. Un Empresa puede agregar preguntas suyas, que corren dentro de su espacio, con su filtro y su sal.

**La prueba de carga con un vecino** ([Pruebas de carga](/pruebas-carga/)), abierta a 0.351 por segundo, con un despacho de prueba que sube 5,000 documentos a la mitad: TTFT p95 de los demás ≤ 3 s con el lote a 4, y con **una tarjeta apagada**, el lote en pausa y el servicio arriba. **El piloto**: 6 semanas con 6 despachos (3 Básico, 2 Pro, 1 Empresa), que además mide el tamaño real de los prompts y si LiteLLM reenvía la sal a vLLM.

### Riesgos

Por lo que cuestan: **una fuga entre clientes** (termina con la confianza, que es el producto); **una caída que pega a todos**, con créditos de SLA; **un cliente grande que se come la GPU**; **el costo que no cuadra** y **un aviso de seguridad** que rompe el aislamiento.

:::profundo La tabla de riesgos completa

| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| **Fuga entre clientes** | B recibe un fragmento, una cita o una pista de tiempo de A | Id de la sesión en un solo servicio; filtro en cada consulta; sal secreta; registros sin texto; examen de fugas en cada despliegue | El CTO, con firma |
| Caída del servidor | Los 45 sin servicio a la vez | SLA de 99.5 % escrito tal cual; manos remotas contratadas; el 2.º servidor en otro rack cuando se venda 99.9 % | SRE |
| Vecino ruidoso | El p95 de todos sube con el lote de uno | Tope por despacho; llave y fila de lotes; lote en 0 con una tarjeta caída; prueba de carga con vecino | SRE |
| El grande que crece | Un Empresa más (o cinco) deja sin N+1 | Calculadora de margen y capacidad al firmar cada Empresa; disparador escrito de la 3.ª tarjeta | Dirección |
| El costo no cuadra | Empresa con 99.9 % al precio de hoy | Precio o cuota base que pague el 2.º servidor (sección de costo) | Dirección |
| Aviso de seguridad | Un CVE de aislamiento en vLLM o LiteLLM | Parche esa semana; el examen de fugas antes de subir la versión | CTO |
| El adaptador de otro | Una llave pide el LoRA de otro despacho | Modelos permitidos por equipo en el gateway; prueba en el examen | CTO |
| El despacho se va | Pide borrar y que le entreguen todo | Respaldo y borrado en 30 días, con constancia | Operación |
| La promesa en el papel | El contrato dice «no sale a un tercero» y un respaldo va a una nube | Lista de subencargados al día; revisión antes de cada proveedor nuevo | Jurídico |
:::

:::ojo El riesgo que no sale en la tabla
Que la startup crezca bien y se le olvide por qué existe: un día, para ahorrar, alguien manda el lote de noche a la API «porque cuesta un centavo». Es exactamente lo que el contrato prohíbe. La promesa se escribe en el contrato **y** en la configuración: el servidor no tiene ruta de salida a ninguna API externa.
:::

## Costo: margen por plan y el segundo servidor {Cost: margin per plan and the second server}

:::intenta ¿Cuánto cuesta al mes y cuánto margen deja?
De la ficha: el servidor cuesta **US$74,779.28** y se deprecia en **36 meses** con **20 %** de reventa. El rack: 2.3 kW a **US$250 por kW** con la energía incluida. Media persona de SRE: **MXN 37,125** al mes (≈ US$1,883). Tipo de cambio **19.7203**. El ingreso es **MXN 190,805** al mes y se hacen 111,100 preguntas. ¿Cuánto cuesta el mes, qué margen deja y cuánto cuesta cada pregunta? ¿Y con dos servidores?
???
1. Depreciación: 74,779.28 × 0.8 ÷ 36 = **US$1,661.76**. Rack: 2.3 × 250 = **US$575**.
2. Mes: 1,661.76 + 575 + 1,883 ≈ **US$4,120 ≈ MXN 81,243**. La [herramienta de TCO con los números de la startup](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=320&r=15.78125&Np=6000&No=500&D=22&G=2&gs=4&S=40461.3&V=36&res=0.2&kwh=0&oe=575&op=1883&tc=19.7203) da lo mismo (la luz en 0 porque va en el rack).
3. Margen: 1 − 81,243 ÷ 190,805 = **57.4 %**. Por pregunta: 81,243 ÷ 111,100 ≈ **MXN 0.73**.
4. Con [dos servidores](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=320&r=15.78125&Np=6000&No=500&D=22&G=4&gs=2&S=40461.3&V=36&res=0.2&kwh=0&oe=1150&op=1883&tc=19.7203): US$6,357 ≈ **MXN 125,353**, margen **34.3 %**, MXN 1.13 por pregunta.
:::

El **[[margen-bruto|margen bruto]]** es lo que queda de cada peso cobrado después de pagar lo que cuesta dar el servicio. Con servidores propios ese costo es casi todo **fijo**: el margen sube con cada despacho hasta que hace falta otro servidor, y ahí cae de golpe.

:::formula El margen bruto
m = 1 − frac{C}{I}
C = s × C_s + C_p
- I: el ingreso del mes, la suma de despachos × usuarios × precio de cada plan (pesos)
- s: servidores
- C_s: lo que cuesta cada servidor al mes, depreciación y rack (pesos)
- C_p: las personas que lo operan (pesos)
- C: el costo del mes (pesos)
- m: el margen bruto, como fracción del ingreso
:::

| Escenario | Al mes (MXN) | Margen | Por pregunta (MXN) |
|---|---|---|---|
| **1 servidor, rack a US$250/kW** | **81,243** | **57.4 %** | **0.73** |
| 1 servidor, rack a US$500/kW (supuesto) | 92,582 | 51.5 % | 0.83 |
| 2 servidores, US$250/kW | 125,353 | 34.3 % | 1.13 |
| 2 servidores, US$500/kW | 148,031 | 22.4 % | 1.33 |

### Por plan, y quién paga el segundo servidor

Repartido por preguntas, con un servidor: Básico **53.9 %**, Pro **56.0 %**, Empresa **59.3 %** (un despacho Básico cuesta ≈ MXN 483 al mes y paga 1,047; uno Empresa, 8,044 contra 19,750). La pregunta de verdad es **quién paga el segundo servidor**. Lo pide el Empresa, por el 99.9 % y porque mueve la capacidad. Si se le carga solo a él:

:::cuenta El Empresa con el segundo servidor
Su parte del costo de hoy // 49.5 % de 81,243 | 0.495 × 81,243 | MXN 40,219
El segundo servidor completo // depreciación + rack, \(C_s\) | (1,661.76 + 575) × 19.7203 | MXN 44,110
Su costo | 40,219 + 44,110 | MXN 84,329
Su ingreso // 5 × 25 × 790 | 98,750 | MXN 98,750
Su margen | 1 − 84,329 ÷ 98,750 | **14.6 %**
Para volver a 57 % // 84,329 ÷ 0.43 ÷ 125 usuarios | 196,114 ÷ 125 | ≈ MXN 1,569 por usuario
= El 99.9 % cuesta el doble del precio de hoy, o una cuota base de ≈ MXN 19,500 al mes por despacho Empresa. Venderlo a $790 por usuario es regalar el segundo servidor.
:::

:::profundo Juega con el margen y la capacidad
:::calculadora caso-saas-margen
Mueve los despachos, los precios y los servidores. Abajo, la misma ley de Little dice cuántos lugares se usan en el pico y si una tarjeta sola aguanta si falla la otra.
:::
:::

:::figura caso-saas-escalera
El costo con servidores propios es una escalera; el ingreso, una recta. El equilibrio llega en ≈ 20 despachos con un servidor y en ≈ 30 con dos; a los 65 una tarjeta ya no aguanta el pico y llega un escalón chico, la tercera tarjeta. El escalón grande, el segundo servidor, lo decide el SLA.
:::

Con la mezcla de hoy cada despacho deja MXN 4,240 al mes: un servidor se paga con **≈ 20 despachos** (81,243 ÷ 4,240) y dos con **≈ 30**.

**Lo que cuesta la promesa.** MXN 0.73 por pregunta contra **MXN 0.012** con Qwen3 32B por API (MXN 0.13 con GPT-5.4 Mini, 0.34 con Claude Sonnet 5.5; `apis.json`, 25-nov-2026). Para la junta: **mantener la promesa cuesta ≈ MXN 80,000 al mes**, y lo paga el precio.

:::profundo Lo que mueve el número, y la etapa de la startup
- **El rack** minorista al doble quita 6 puntos de margen con un servidor y 12 con dos.
- **Media persona de SRE** es casi la mitad del mes (MXN 37,125 de 81,243): sin ella el margen subiría, pero nadie contestaría una alerta.
- **No incluye** el tránsito de internet del sitio, impuestos ni importación (≈ 7 % más, lección «Cotizar»), el SOC 2, el soporte a los despachos ni el desarrollo del producto: es el margen **bruto**.
- **La etapa.** Con 45 despachos, el ingreso es ≈ US$116 mil al año. Una guía de EE. UU. de 2026 pone la ronda semilla de software B2B en US$300–500 mil al año con 10 a 20 clientes de pago (fuente secundaria; no se encontró el dato de México). Esta startup está antes de eso: cada decisión de arriba (un servidor, el SOC 2 cuando lo pague un contrato, el 99.9 % con su precio) es de una empresa que todavía no puede gastar por adelantado.
:::

## La propuesta en una página {The proposal on one page} [extra]

**Lo que hace.** Un asistente para despachos contables que contesta sobre los documentos de **cada** despacho, con cita, y carga lotes del cierre sin frenar a nadie. Nada sale a un tercero y ningún despacho ve lo de otro.

**Dónde corre.** Un servidor 4U con **2 × RTX PRO 6000 Blackwell Server Edition** en un rack de colocation en Querétaro: una copia de **Qwen3.8 27B** (Apache 2.0) en FP8 por tarjeta, con vLLM 0.34.0, LiteLLM 1.111.0 y Qdrant 1.20.2. Una tarjeta sola aguanta el pico (13 lugares contra 9.0). Una tercera tarjeta cuando la startup pase de ≈ 65 despachos (antes, si los nuevos son Empresa); el segundo servidor, en otro rack, cuando se venda 99.9 %.

**Cómo se separa a cada despacho.** El id sale de la sesión y un solo servicio lo convierte en el equipo del gateway, el filtro de Qdrant, la sal del caché (un secreto de 256 bits) y la etiqueta del registro. Topes por plan (2, 4 o 6 a la vez). Los lotes, por su llave y su fila: 4 a la vez de día, 13 de noche, 0 si falta una tarjeta.

**Qué promete.** TTFT ≤ 3 s en el p95 del pico, ≥ 20 tokens por segundo, 0 fugas en cada versión. Básico sin SLA; Pro y Empresa 99.5 %; Empresa 99.9 % con el segundo servidor y su precio.

**Qué firma.** Un contrato de encargo con cada despacho: solo para su asistente, sin entrenar con sus datos, lista de subencargados, aviso de brechas en 24 horas, respaldo y borrado en 30 días al terminar. SOC 2 Tipo II como meta a 12–18 meses.

**Cómo se demuestra.** El examen de fugas (600 preguntas cruzadas, 100 intentos de cambiar el id y la prueba de tiempo del caché, criterio 0) en cada despliegue; un examen común de 200 preguntas; una prueba de carga con un vecino de 5,000 documentos y otra con una tarjeta apagada; un piloto de 6 semanas con 6 despachos.

**Cuánto cuesta.** US$74,779 de servidor (sin impuestos ni importación) y ≈ **MXN 81,243 al mes**: **MXN 0.73 por pregunta** y **57.4 %** de margen bruto con los 45 de hoy. Con dos servidores, MXN 125,353 y 34.3 %.

**Lo que se confirma antes de comprar.** Dos cotizaciones de colocation con el tránsito de internet; que LiteLLM reenvíe la sal y la prioridad a vLLM; el precio y el plazo de la Server Edition, y que el chasis la acepte (y una tercera); con el abogado, el contrato de encargo y la vigencia del Reglamento de 2011.

## Errores comunes {Common mistakes}

1. **Sacar el id del despacho de un campo de la petición.** Cualquiera lo cambia. **Cómo evitarlo:** de la sesión, en un solo servicio, y el examen de fugas intenta cambiarlo.
2. **Creer que el índice de cliente de la base protege.** El `is_tenant` de Qdrant ordena, no autoriza. **Cómo evitarlo:** el filtro en cada consulta, puesto por el servicio, y la clave de la base fuera del alcance de los clientes.
3. **Dejar el prefix cache compartido entre clientes.** Viene prendido y sin sal por omisión. **Cómo evitarlo:** una sal secreta por despacho en cada petición, puesta por el gateway, nunca por el cliente.
4. **Poner solo un límite de tokens por minuto.** Deja pasar la ráfaga de 5,000 documentos. **Cómo evitarlo:** tope de requests a la vez por despacho, llave y fila aparte para los lotes, y lote en pausa si falta una tarjeta.
5. **Vender 99.9 % con un servidor, o comprar el segundo sin que nadie lo pague.** Lo primero se paga en créditos; lo segundo, en 23 puntos de margen. **Cómo evitarlo:** el SLA con lo que hay, y el segundo servidor con su precio.
6. **Copiar los «lugares por tarjeta» de otro caso.** Con 12,000 tokens eran 7; con 6,000 son 13. **Cómo evitarlo:** la herramienta de sizing con los tokens de **este** producto.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un despacho Pro tiene 8 usuarios con 15 preguntas al día, 22 días al mes, y paga $549 por usuario. ¿Cuántas preguntas hace al mes, cuánto paga y cuánto cuesta atenderlo a MXN 0.73 por pregunta?
Preguntas: 8 × 15 × 22 = **2,640**. Paga 8 × 549 = **MXN 4,392**. Cuesta ≈ 2,640 × 0.7313 ≈ **MXN 1,931**: deja ≈ 56 %.
? [facil] ¿Cuántos minutos se puede caer el servicio al mes con 99.5 % y con 99.9 %, en un mes de 30 días?
\(M\) = 24 × 30 × 60 = 43,200 minutos. Con 99.5 %: 0.005 × 43,200 = **216 min**. Con 99.9 %: 0.001 × 43,200 = **43.2 min**.
? [medio] En los días de declaraciones el pico se duplica (factor 5 en vez de 2.5). ¿Cuántas conversaciones hay a la vez? ¿Aguanta una tarjeta? ¿Qué haces con los lotes ese día?
Little: 0.351 × 2 × 25.68 ≈ **18.0** (la [herramienta de sizing con pico de 5](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=320&r=15.78125&Np=6000&No=500&h=10&pk=5&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) da 18.01 y 2 tarjetas). Una sola (13) **no aguanta**: ese día no hay N+1. Con el tope de 4 quedan 22 lugares para 18, muy justo: ese día los lotes van solo de noche.
? [medio] Un despacho Empresa nuevo (25 usuarios, 20 preguntas al día) quiere firmar. ¿Cuánto sube la carga del pico y cuánto el margen con un servidor?
Sus preguntas: 25 × 20 = 500 al día. Pico: 500 ÷ 36,000 × 2.5 × 25.68 ≈ **0.89** conversaciones más (9.0 → 9.9). Ingreso: 25 × 790 = MXN 19,750 más; el costo no cambia: m = 1 − 81,243 ÷ 210,555 ≈ **61.4 %**. Con el sexto, sigue el N+1; con el décimo Empresa, ya no (13.5 a la vez).
? [reto] Un despacho Empresa pide su propia copia de vLLM, como recomienda la guía de vLLM para aislar de verdad. Con el servidor de hoy, ¿qué le pasa a los otros 44, y qué tendría que cobrarse?
Darle una tarjeta deja a los demás con **13** lugares para ≈ 8.1 conversaciones (9.0 − 0.89): caben, pero **sin N+1**, y su copia tampoco tiene repuesto. Lo honesto es una tarjeta **más**, en otro servidor. Si ese servidor fuera solo para él, costaría 44,110 + su parte de hoy (8,044) ≈ **MXN 52,150** al mes contra 19,750 que paga: pierde. Se cotiza aparte, con una cuota mensual por la copia dedicada.
? [reto] Diseña la prueba de tiempo del examen de fugas: ¿qué se manda, cuántas veces y qué tiene que salir?
1. A manda 50 prefijos distintos de ≈ 500 tokens y espera a que se guarden en caché.
2. B manda esos mismos 50 prefijos (con la sal del servicio, la de B) y 50 prefijos nuevos del mismo tamaño, intercalados y en orden al azar.
3. Se compara el TTFT de los dos grupos: con la sal bien puesta, **no hay diferencia** más allá del ruido. Como control, la misma prueba **sin sal**, en un ambiente de pruebas, debe mostrarla: si no, la prueba no mide nada.
:::

## Qué cambiaría si… {What would change if…} [extra]

**…un despacho pidiera su propia copia.** Es lo que recomienda vLLM para aislar de verdad. Con dos tarjetas, regalarle una deja a todos sin repuesto: se cotiza como una tarjeta **más**, con su cuota mensual, y su copia corre sin sal compartida con nadie.

**…los 45 fueran Básico.** Con 45 despachos de 3 usuarios y 10 preguntas, el pico baja a ≈ 2.4 a la vez y el ingreso a MXN 47,115: el servidor no se paga (equilibrio en ≈ 78 despachos Básico). Un SaaS de despachos chicos con servidor propio solo cierra con muchos más clientes, o con una API y otra promesa.

**…el producto fuera para pymes en general.** Cambian el documento (menos CFDI, más contratos) y el tamaño del mercado, no el diseño del aislamiento: las seis capas son las mismas.

**…un cliente exigiera el servidor en su propia oficina.** Ya no es un SaaS compartido: es el [caso del despacho](/casos/despacho/), con la startup como integradora.

**…la startup vendiera 99.9 % a todos.** Dos servidores desde el primer día, 34 % de margen con los precios de hoy, y el equilibrio en ≈ 30 despachos. Es posible, pero con otros precios.

### Lo que sigue {What comes next}

Este es el último de los seis casos. El **despacho** puso el método (requisitos, cálculos, opciones, decisión), la **clínica** lo llevó a datos sensibles y 24 × 7, la **fábrica** a una red de planta y a la seguridad de quien sigue un procedimiento, la **financiera** a trabajo por lote en una ventana, el **gobierno** a una red sin internet de principio a fin, y este a **muchos clientes en el mismo servidor**. Lo que queda es hacerlo con las manos: levantar el gateway con un equipo por cliente, poner la sal, correr el examen de fugas y ver cómo cambia el p95 con un vecino ruidoso. Para repasar lo que este caso aplicó: [Gateway](/gateway/), [RAG privado](/rag-privado/), [Batching](/batching/), [Pruebas de carga](/pruebas-carga/), [Cotizar](/cotizar/) y [TCO](/costo-total/).

:::conceptos
multi-tenant vecino-ruidoso cola-justa canal-lateral cache-salt examen-de-fugas adaptador-lora contrato-de-encargo subencargado soc-2 iso-27001 margen-bruto
:::

:::chequeo
? ¿Por qué la startup necesita servidor propio si la API cuesta 60 veces menos?
Porque lo que vende es la promesa de que los documentos no salen a un tercero; varios despachos la piden por contrato. El costo es el precio de esa promesa, ≈ MXN 80,000 al mes.
? ¿De dónde sale el id del despacho y por qué importa?
De la sesión autenticada, en un solo servicio que fija el equipo del gateway, el filtro de la base, la sal del caché y la etiqueta del registro. Un id que venga en la petición se puede cambiar.
? ¿Qué hace la sal del caché y qué no hace?
Hace que solo compartan bloques del prefix cache las peticiones de un mismo despacho, y así cierra el canal lateral del tiempo. No aísla: los clientes siguen compartiendo el proceso, la memoria y la fila.
? Un despacho sube 5,000 documentos a las 8:30. ¿Qué evita que los demás esperen 29 minutos?
Que el lote vaya por su propia llave y su propia fila, con un tope de 4 a la vez: deja 22 de 26 lugares para las 9.0 conversaciones de los demás. Y si falta una tarjeta, el lote se pausa.
? ¿Por qué el criterio del examen de fugas es 0 y no «menos de 1 %»?
Porque una sola fuga rompe el producto, y porque el aislamiento se rompe con un cambio, no con el uso: el examen corre en cada despliegue y se detiene con una marca ajena.
? ¿Cuándo se compra el segundo servidor?
Cuando un despacho compre 99.9 % (con su precio) o cuando un cliente pague su propia copia. Pasar de ≈ 65 despachos con esta mezcla (antes, si los nuevos son Empresa) pide una tercera tarjeta, no otro servidor. No por si acaso: el segundo servidor cuesta 23 puntos de margen.
:::
