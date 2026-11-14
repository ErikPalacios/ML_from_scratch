---
titulo: Qué es la nube
en: What the cloud is
subtitulo: Qué rentas de verdad cuando «subes algo a la nube», cómo se cobra, quién cuida cada pieza, cómo se llaman las mismas cosas en AWS, Google Cloud y Azure, y cuándo conviene más tener máquinas propias.
pregunta: El clasificador de fotos de Alba, el marketplace que sigue el curso, corre «en AWS, us-east-1, con EKS y dos g4dn.xlarge». Ninguna de esas máquinas es de Alba. ¿De quién son, dónde están, cómo se cobran y qué tiene que cuidar el equipo de ML?
requisitos: camino-completo, sistema-operativo, red
---

:::idea
La nube es rentar computadoras, discos y servicios que viven en el centro de datos de otra empresa, pidiéndolos por software y pagando solo por el tiempo o los GB que usas. Cambias una compra grande por un gasto que sube y baja contigo. A cambio, pagas el margen del proveedor, te atas un poco a él y sigues siendo responsable de todo lo que pones encima.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace en línea: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles, con un modelo que corre en GPUs (≈ 10 millones de fotos al día). Su equipo describe dónde corre ese sistema en una línea: «AWS, `us-east-1`, Kubernetes gestionado (EKS), Triton en dos `g4dn.xlarge`, un ALB delante, los pesos en S3». Es la frase de alguien que diseña sistemas todos los días. Para quien empieza, casi cada palabra es una pregunta.

Ninguna de esas máquinas es de Alba. Nadie de su equipo las ha visto. Están en un edificio en el norte de Virginia, y Alba paga por ellas cada hora, como quien paga la luz. Si mañana el tráfico se duplica, piden más con un comando. Si el proyecto se cancela, las devuelven y dejan de pagar.

En esta lección vas a ver qué hay detrás de esa frase: qué se renta de verdad, cómo se cobra, qué cuida el proveedor y qué cuidas tú, cómo se llaman las mismas piezas en las tres nubes grandes y cuándo **no** conviene la nube. Las lecciones que siguen en este módulo entran al detalle: dónde está físicamente (regiones y zonas), qué máquinas hay y cuánto cuestan, cómo es su red y qué servicios te dan ya hechos.

## La nube: computadoras de alguien más, en edificios reales {The cloud: someone else's computers, in real buildings}

### Antes de la nube

Imagina que en 2004 quieres poner en línea una tienda. Necesitas un [[servidor]], una computadora que se queda prendida contestando [[request|requests]]. Para tenerla:

1. Eliges un modelo y lo pides. Llega en dos a seis semanas.
2. Le buscas lugar: un cuarto con aire acondicionado, electricidad que no se corte y una conexión a internet buena. O rentas un espacio en un edificio que se dedica a eso.
3. Lo instalas, le pones el [[sistema-operativo|sistema operativo]] y lo conectas.
4. Rezas para haber comprado bien. Si compraste de menos, la tienda se cae el día de las ofertas. Si compraste de más, pagaste máquinas que pasan el año casi dormidas.

Todo ese proceso es lento, caro por adelantado y difícil de deshacer.

### Lo que cambió

En 2006, Amazon empezó a rentar, por internet, almacenamiento (S3) y máquinas (EC2) de sus propios centros de datos. Ya no comprabas un servidor: lo pedías con un mensaje por internet a un programa de Amazon y en unos minutos tenías una máquina con [[linux|Linux]], lista para usar. Pagabas por hora. Cuando ya no la necesitabas, la devolvías y se acababa el cobro.

Eso es la **[[nube]]** (*cloud*): rentar computadoras, discos y servicios que viven en los centros de datos de otra empresa, pidiéndolos por software y pagando por lo que usas. La empresa que los renta es un **[[proveedor-nube|proveedor de nube]]** (*cloud provider*). Las tres grandes son AWS (de Amazon), Google Cloud y Microsoft Azure.

Tres cosas hacen que algo sea «nube» y no simplemente «una computadora rentada»:

- **Lo pides tú solo, por software, en minutos.** No hay vendedor ni contrato por cada máquina. Hay una [[api-nube|API]], un programa al que le mandas requests; contesta en segundos y la máquina queda lista en minutos.
- **Pagas por uso.** Por hora de máquina, por GB guardado al mes, por cada millón de requests. Es el [[pago-por-uso|pago por uso]].
- **Sale de un fondo enorme y compartido.** El proveedor tiene millones de máquinas y las reparte entre muchísimos clientes. Tú tomas un pedazo cuando lo necesitas y lo devuelves cuando acabas. A eso se le llama [[elasticidad]].

:::analogia La luz eléctrica
Hace un siglo, muchas fábricas tenían su propio generador de electricidad. Tenían que comprarlo, mantenerlo y tener a alguien que lo arreglara. Cuando llegó la red eléctrica, se conectaron y empezaron a pagar por kilowatt-hora (kWh: la energía que gasta un aparato de 1,000 watts prendido una hora). Pasaron de *tener* electricidad a *usarla*.

La nube hace lo mismo con las computadoras: el generador es el servidor propio; la red eléctrica es el proveedor; el kilowatt-hora es la hora de máquina o el GB al mes.

**Dónde se rompe:** la electricidad es igual en todos los enchufes; la nube no. Cada proveedor tiene sus propios servicios, nombres y formatos, y llevarte tus cosas a otro cuesta (eso es la [[dependencia-proveedor|dependencia del proveedor]]). Además, con la luz no dejas tus pertenencias en la planta eléctrica; en la nube, tus datos viven en el edificio del proveedor, y sacarlos se cobra.
:::

### Qué se renta

No solo máquinas. Casi todo lo que has visto en Sensei se puede rentar ya armado:

| Lo que necesitas | Lo que rentas en la nube | Dónde lo viste |
|---|---|---|
| Una computadora con GPU | Una máquina virtual (un pedazo de un servidor; la explicamos abajo), como una `g4dn.xlarge` con una T4 | [[gpu]], [[contenedor-vs-vm]] |
| Guardar millones de fotos | Un [[object-storage\|object storage]], como S3 | Almacenamiento |
| Una base de datos | Postgres operado por el proveedor | [[base-datos\|Bases de datos]] |
| Una cola | SQS, Pub/Sub o Service Bus | [[cola-mensajes\|Colas]] |
| Repartir el tráfico | Un [[balanceador]] | Balanceo |
| Correr contenedores en muchas máquinas | Kubernetes gestionado (el proveedor opera la parte difícil) | [[orquestacion\|Orquestación]] |
| Un modelo de lenguaje | Una API que cobra por millón de tokens | LLMs |

Hay un chiste viejo entre ingenieros: «La nube no existe; es la computadora de alguien más». Es exagerado, pero sirve para no olvidar que detrás de cada palabra bonita hay edificios, cables y discos que se rompen. Ahora vamos a entrar a uno de esos edificios.

:::profundo La definición formal
En 2011, el NIST, la agencia de estándares de Estados Unidos, publicó una definición de *cloud computing* que se sigue citando. Pide cinco características: **autoservicio bajo demanda** (lo pides tú, sin hablar con nadie), **acceso por la red**, **un fondo común de recursos** (*resource pooling*: muchas personas comparten las mismas máquinas sin saber cuáles), **elasticidad rápida** (crece y se encoge) y **servicio medido** (se mide y se cobra lo que usas). Las tres cosas de arriba son esas cinco, contadas en corto: la red se da por hecha y «fondo común» y «elasticidad» van juntos.
:::

### Por dentro: el centro de datos

La nube vive en **[[centro-de-datos|centros de datos]]** (*data centers*): edificios llenos de servidores. Por dentro son pasillos y pasillos de racks, unos estantes metálicos de unos dos metros de alto, cada uno con decenas de servidores atornillados uno encima de otro.

Un centro de datos grande resuelve tres problemas que tu casa no resuelve:

- **Electricidad que no se corta.** Llega por más de una línea. Si se va, unas baterías aguantan unos segundos o minutos, lo que tarda en arrancar un generador de diésel.
- **Calor.** Miles de servidores prendidos son, literalmente, miles de calentadores. Un servidor con 8 GPUs grandes gasta varios kilowatts, más que varias casas juntas. Sin enfriamiento se apagan solos en minutos.
- **Red.** Varios cables de fibra óptica, por caminos distintos, para que cortar uno no aísle el edificio.

Un proveedor agrupa sus centros de datos por lugar: en **[[zona-disponibilidad|zonas]]** (uno o más edificios con su propia luz y red) y en **[[region|regiones]]** (un área del mapa con varias zonas). Eso es el tema de la lección siguiente, «Regiones, zonas y disponibilidad». Aquí basta con saber que cuando dices «us-east-1», hablas de un grupo de edificios reales en el norte de Virginia.

### El servidor y lo que de verdad rentas

Un servidor de un centro de datos es una computadora como la tuya, pero más grande: dos CPUs con decenas de [[nucleo|núcleos]] cada una, cientos de GB de [[ram|RAM]], discos rápidos y, en algunos, de 1 a 8 GPUs.

Casi nunca rentas un servidor completo. Rentas un **pedazo**, que se comporta como una computadora entera: una **[[maquina-virtual|máquina virtual]]** (VM, *virtual machine*). En la lección del sistema operativo la viste junto al contenedor ([[contenedor-vs-vm]]): una computadora simulada por software, con su propio [[kernel]] y su propio sistema operativo.

El programa que parte el servidor en VMs es el **[[hipervisor]]** (*hypervisor*). Corre debajo de todas las VMs y le da a cada una sus [[vcpu|vCPU]], su memoria y su disco virtuales. Cada VM cree que tiene una computadora para ella sola. En AWS, el hipervisor se llama Nitro: parte del trabajo lo hacen tarjetas de hardware propias, para que casi toda la máquina quede para los clientes.

:::figura nube-servidor
Un servidor físico, partido por el hipervisor en tres máquinas virtuales de tres clientes distintos. Cada VM tiene su sistema operativo y su kernel; ninguna ve a las otras. En este servidor, la GPU no se parte: se le entrega completa a una sola VM, como en la `g4dn.xlarge` de Alba.
:::

### Por qué partirlo

El hipervisor resuelve tres problemas a la vez:

- **Reparto.** Un servidor con 96 vCPU se puede rentar como 24 VMs de 4 vCPU, a 24 clientes. Nadie tiene que comprar una máquina enorme para algo pequeño.
- **Aislamiento.** A cada uno de esos clientes se le llama *inquilino* (*tenant*), y la nube es *multi-inquilino* (*multi-tenant*): desconocidos comparten el mismo fierro (el mismo hardware). El hipervisor es la pared entre ellos. Para que una VM lea la memoria de otra, alguien tendría que encontrarle una falla al hipervisor o al procesador. El hipervisor está diseñado justo para impedirlo, y cuando aparece una falla así (ha pasado, con los procesadores), el proveedor la corrige con una actualización, un *parche*.
- **Rapidez.** Crear una VM es correr un programa, no mandar un camión. Por eso la tienes en minutos y no en semanas.

La `g4dn.xlarge` de Alba es una VM: 4 vCPU, 16 GiB de RAM y una GPU T4 completa. Cuando la apagas, ese pedazo del servidor vuelve al fondo y otro cliente lo puede usar en cuanto lo pida.

:::profundo El vecino ruidoso
Las VMs de un servidor comparten cosas que el hipervisor no parte perfecto: la red del servidor, sus [[cache-cpu|cachés]], a veces el disco. Si la VM de al lado se pone a trabajar a tope, la tuya puede ir un poco más lenta. Se le dice *noisy neighbor* (vecino ruidoso).

Con GPUs pesa menos. En la mayoría de las máquinas con GPU, como la `g4dn.xlarge`, la GPU se entrega completa a una VM. Hay excepciones: AWS y Google Cloud también rentan pedazos de una GPU, y la lección de máquinas los explica. Con máquinas chicas y compartidas, el vecino se nota más. Si de verdad te estorba, puedes rentar el servidor completo (en AWS, las instancias `.metal`), pero cuesta como el servidor completo.
:::

La lección de máquinas te va a enseñar a leer un nombre como `g4dn.xlarge` (la familia, la generación, el tamaño) y qué combinación de CPU, RAM y GPU trae cada una. Lo que importa aquí es la idea: **lo que rentas es una VM sobre un servidor de alguien más.**

## Comprar o rentar: CapEx, OpEx y on-premises {Buy or rent: capex, opex and on-premises}

### Las máquinas propias

Lo contrario de la nube tiene nombre: **[[on-premises]]** (*on-prem*, «en las instalaciones»). Son máquinas que la empresa compra y opera: en un cuarto de su edificio o en un espacio rentado dentro de un centro de datos ajeno (*colocation*), donde el edificio pone la luz y el aire y tú pones tus servidores.

On-prem no es anticuado. Los bancos, los hospitales y los gobiernos tienen mucho. Y en ML aparece cada vez más: una empresa que quiere correr un modelo de lenguaje sin que sus datos salgan del edificio compra sus propias GPUs. Las máquinas propias también ganan cuando el modelo tiene que correr junto a una cámara aunque se caiga internet, y cuando la empresa es tan grande que el margen del proveedor le cuesta más que operar sus propios centros de datos. La sección extra del final junta estos casos.

### Dos maneras de gastar

La diferencia de fondo es contable, y tiene nombre en inglés porque así la dicen los de finanzas: **[[capex-opex|CapEx contra OpEx]]**.

- **CapEx** (*capital expenditure*, inversión): una compra grande que se usa varios años. Un servidor de ≈ US$24,400 (el de la cuenta de abajo) que dura 3 años es CapEx. En los libros de contabilidad no se cuenta como gasto de un solo mes, sino que se reparte en esos años: US$24,400 ÷ 36 meses ≈ US$678 al mes. Repartirlo así se llama **amortizar**.
- **OpEx** (*operating expenditure*, gasto operativo): lo que pagas mes con mes para que todo funcione. La luz, el sueldo de quien opera y la renta de la nube son OpEx.

La nube convierte CapEx en OpEx. No pones el dinero por adelantado y no apuestas a cuánta capacidad vas a necesitar en tres años. Para una empresa que empieza, eso es enorme: puede probar una idea con US$50 en lugar de US$50,000.

Pero el servidor que compraste cuesta lo mismo lo uses o no, y el que rentas cuesta según lo uses. Esa es la pregunta: **¿cuántas horas al mes lo vas a usar de verdad?**

La cuenta pone las dos opciones en la misma unidad, US$ al mes, y busca cuántas horas de uso las igualan. Estas son las letras:

:::formula Comprar o rentar: el equilibrio
P = frac{K}{V} + O
R = c × h
h^{*} = frac{P}{c}
- K: lo que cuesta comprar el servidor, en US$
- V: los meses en que se amortiza la compra (36 = 3 años)
- O: lo que cuesta operarlo al mes (luz, espacio, red y mantenimiento), en US$
- P: lo que cuesta el servidor propio al mes, en US$; es el mismo lo uses o no
- c: el precio por hora de rentar una máquina en la nube (aquí, la misma GPU), en US$ por hora
- h: las horas al mes que usas la máquina (730 = todo el mes)
- R: lo que cuesta rentarla al mes, en US$
- h^{*}: el **equilibrio**: las horas de uso al mes en que \(R\) llega a \(P\)
:::

:::cuenta Un servidor con una GPU: comprarlo o rentarlo
Compra \(K\) // la GPU RTX PRO 6000 Blackwell ≈ US$16,399 en una tienda en línea (noviembre de 2026; el precio de estas tarjetas sube y baja mucho) + el resto del servidor, ≈ US$8,000 (supuesto) | 16,399 + 8,000 | ≈ US$24,400
Amortizada en \(V\) = 36 meses (3 años) | \(K ÷ V\) = 24,400 ÷ 36 | ≈ US$678 al mes
Luz // ≈ 1 kW prendido las 730 h del mes a US$0.15 por kWh (supuesto) | 1 kW × 730 h × 0.15 | ≈ US$110 al mes
Espacio, red y mantenimiento // supuesto | — | ≈ US$200 al mes
Operación \(O\) // luz + espacio, red y mantenimiento | 110 + 200 | ≈ US$310 al mes
Propio, al mes, \(P\) | \(P = K ÷ V + O\) = 678 + 310 | **≈ US$988**
Precio de la nube \(c\) // la misma GPU en Google Cloud, `g4-standard-48`, en us-central1 | — | ≈ US$4.50 por hora
Rentado las 24 horas, los 7 días (24/7), \(R\) // \(h\) = 730, todo el mes | \(R = c × h\) = 4.50 × 730 | **≈ US$3,285**
Equilibrio \(h^{*}\) // las horas de renta que suman lo mismo que el propio | \(h^{*} = P ÷ c\) = 988 ÷ 4.50 | ≈ 220 h al mes
Como fracción del mes | \(h^{*} ÷ 730\) = 220 ÷ 730 | ≈ 30 %
= Si lo vas a usar más de ≈ 30 % del tiempo durante tres años, comprar sale más barato en esta cuenta. Si lo usas 4 horas al día (4 × 30.4 días ≈ 122 h al mes, menos que las ≈ 220 del equilibrio), rentar gana por mucho.
:::

Esta cuenta deja fuera cosas que casi siempre cambian la respuesta, y conviene decirlas en voz alta:

- **Personas.** Alguien tiene que cambiar el disco que se rompe a las 3 de la mañana, actualizar el sistema y vigilar la temperatura. Esa persona cuesta más que la luz.
- **El tiempo.** Comprar tarda semanas; rentar, minutos. En un proyecto que todavía no sabe si va a funcionar, esas semanas valen mucho.
- **El pico.** Si compras, compras para el día más ocupado del año, y el resto del año sobra.
- **El riesgo.** Si la GPU se descompone, el problema es tuyo. En la nube, pides otra.
- **Los descuentos de la nube.** El precio de arriba es el de lista. Con compromisos de uno a tres años, la renta baja bastante (la lección de máquinas los explica).

:::profundo Por qué se amortiza en 3 años y no en 10
Un servidor puede seguir prendido diez años, pero en ML deja de valer mucho antes. Cada generación de GPUs hace bastante más trabajo por dólar y por watt que la anterior, así que una GPU de hace cinco años hace el mismo trabajo más lento y gastando más luz que una nueva del mismo precio. Por eso una cuenta prudente de compra de GPUs usa 3 años, a veces 4 o 5: no porque la máquina se rompa, sino porque a partir de ahí puede convenir más reemplazarla. No hay una regla única: en sus libros, los grandes proveedores reparten sus servidores en 5 o 6 años, y Amazon bajó una parte de los suyos de 6 a 5 años en 2025, justo porque la IA avanza rápido. Cuántos años dura de verdad una GPU es una discusión abierta. La nube tiene la misma presión, pero la absorbe el proveedor: cuando sale una GPU nueva, tú solo cambias el tipo de máquina que pides. Comprar es también apostar a que tu GPU seguirá siendo suficiente durante esos años.
:::

:::calculadora nube-comprar-rentar
Mueve las horas de uso al mes, \(h\): si quedan por debajo del equilibrio \(h^{*}\), gana rentar; si quedan arriba, comprar. Luego alarga la vida del servidor a 60 meses (5 años) y mira cómo bajan las horas del equilibrio. Los valores iniciales son los de la cuenta.
:::

:::ojo
«La nube es más cara» y «la nube es más barata» son las dos frases equivocadas. Depende de cuántas horas uses la máquina, cuántos años, cuánta gente necesitas para operarla y qué tan rápido cambia lo que necesitas. Haz la cuenta con tus horas.
:::

## Pago por uso, precio de lista y elasticidad {Pay-as-you-go, list price and elasticity}

### Todo tiene un medidor

En la nube, cada cosa que rentas tiene su unidad de cobro. Esto es el **pago por uso**. Las unidades más comunes:

| Qué | Unidad | Un ejemplo (≈, us-east-1, noviembre de 2026) |
|---|---|---|
| Una máquina | Hora encendida | `g4dn.xlarge`, ≈ US$0.526 por hora |
| Guardar archivos | GB al mes | S3 Standard, ≈ US$0.023 por GB al mes |
| Usar un servicio | Cada request o cada millón | S3: US$0.005 por cada 1,000 `PUT` (subir un archivo) |
| Datos que salen a internet | GB | ≈ US$0.09 por GB (subir datos no se cobra) |
| Kubernetes gestionado | Hora por cluster | EKS, US$0.10 por hora |
| Un modelo de lenguaje por API | Millón de tokens | Varía por modelo |

Las máquinas se cobran por hora encendida, pero para planear se habla de meses. Casi todo el que hace cuentas de nube usa un mes de **730 horas**; Alba también, para sus costos.

:::cuenta El mes de 730 horas y las T4 de Alba
Horas en un año | 365 × 24 | 8,760 h
Horas en un mes promedio | 8,760 ÷ 12 | **730 h**
Una `g4dn.xlarge` todo el mes // precio por hora \(c\) ≈ US$0.526 en us-east-1, noviembre de 2026; horas \(h\) = 730 | \(R = c × h\) = 0.526 × 730 | ≈ US$384
Las dos de Alba // una por zona | 2 × 384 | **≈ US$768 al mes**
= Para pasar de US$ por hora a US$ por mes, multiplica por 730: es la misma \(R = c × h\) de la cuenta de comprar o rentar, con la máquina prendida todo el mes. En una entrevista de diseño se dice así: «two g4dn.xlarge, about US$770 a month in GPUs».
:::

El número que usaste, US$0.526, es el **[[precio-lista|precio de lista]]** (*list price*): lo que el proveedor publica para cualquiera que pide la máquina sin compromiso, el precio [[on-demand]]. Es la base contra la que se miden todos los descuentos: capacidad sobrante que te pueden quitar ([[spot]]), compromisos de gasto de uno o tres años ([[savings-plan|Savings Plans]]). La lección de máquinas los compara.

Dos cosas del precio de lista que hay que saber desde ya:

- **Cambia por región.** La misma máquina cuesta distinto en Virginia que en São Paulo.
- **Cambia con el tiempo.** Los proveedores bajan precios, sacan máquinas nuevas y retiran viejas. Por eso un número de la nube se dice con «≈», con la región y con la fecha: «≈ US$0.53 por hora en us-east-1 (noviembre de 2026)». En una entrevista basta con el orden de magnitud; el número exacto se busca en la calculadora de precios del proveedor.

### Elasticidad: crecer y encogerse

La **elasticidad** (*elasticity*) es poder subir y bajar la capacidad según la demanda, en minutos, y pagar solo por lo que tuviste prendido.

Piensa en la API de una tienda en línea. De madrugada recibe 20 requests por segundo; a las 8 de la noche, 500. Con máquinas propias compras para las 500 y de madrugada casi todas duermen. En la nube puedes prender más máquinas cuando sube y apagarlas cuando baja.

El programa de abajo cuenta cuántas máquinas pide cada hora de un día y compara dos maneras de tenerlas: fijas para el pico, o elásticas. Mide el gasto en **máquina-horas**: una máquina prendida durante una hora. Tres máquinas prendidas dos horas son 6 máquina-horas. Los números de demanda son un supuesto.

```python
import math
# requests por segundo que recibe la API de una tienda en cada hora del día (supuesto)
demanda = [40, 30, 20, 20, 20, 30, 60, 120, 200, 260, 300, 320,
           340, 330, 300, 280, 300, 360, 420, 480, 500, 440, 300, 120]
por_maquina = 100     # requests por segundo que aguanta una máquina sin pasar de su tope
precio = 0.50         # US$ por hora de una máquina (supuesto redondo)

necesarias = [math.ceil(d / por_maquina) for d in demanda]  # ceil redondea hacia arriba: 1.2 → 2
fijo = max(necesarias) * 24      # las del pico, prendidas las 24 horas
elastico = sum(necesarias)       # cada hora, solo las que pide esa hora
print("máquinas por hora:", necesarias)
print(f"fijo:     {fijo} máquina-horas → US${fijo * precio:.2f} al día")
print(f"elástico: {elastico} máquina-horas → US${elastico * precio:.2f} al día")
print(f"la flota fija trabaja, en promedio, al {elastico / fijo:.0%}")
```

```salida
máquinas por hora: [1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 3, 3, 3, 4, 5, 5, 5, 5, 3, 2]
fijo:     120 máquina-horas → US$60.00 al día
elástico: 67 máquina-horas → US$33.50 al día
la flota fija trabaja, en promedio, al 56%
```

Con un pico diario suave, la elasticidad ahorra ≈ 44 %: de US$60 a US$33.50 al día, y 1 − 33.5 ÷ 60 ≈ 0.44. Con un pico raro y alto, como el Buen Fin, ahorra mucho más: el pico dura unos días (el Buen Fin de 2026 va del 13 al 17 de noviembre, cinco días) y el resto del mes te sobran máquinas. Pruébalo en la calculadora. Para un mes con una carga de base y un pico, la cuenta es esta:

:::formula Capacidad fija contra elástica, en un mes
F = m_p × 730 × c
E = m_b × 730 × c +
(m_p − m_b) × t_p × c
u = frac{E}{F}
- m_b: las máquinas que pide la carga de base, todo el mes
- m_p: las máquinas que pide el pico
- t_p: las horas que dura el pico en el mes
- c: el precio de una máquina, en US$ por hora (la misma \(c\) de comprar o rentar)
- F: lo que cuesta al mes la flota **fija**: las \(m_p\) máquinas del pico, prendidas las 730 h, en US$
- E: lo que cuesta al mes la flota **elástica**: la base todo el mes y las \(m_p − m_b\) de más solo durante el pico, en US$
- u: el uso promedio de la flota fija: qué fracción de lo que pagas se necesita de verdad
:::

:::calculadora nube-elasticidad
Un mes con una base de \(m_b\) = 2 máquinas y un pico de \(m_p\) = 10 que dura \(t_p\) = 96 horas (cuatro días de ofertas; el Buen Fin de 2026 dura cinco, 120 horas). Sube las horas de pico hasta 730 y mira cómo el ahorro desaparece: si el pico dura todo el mes, ya no es pico.
:::

### Lo que la elasticidad no es

La elasticidad es la *posibilidad* de crecer. Para que de verdad pase hacen falta tres cosas más:

- **Alguien que decida cuándo.** Un programa que mira la carga y pide máquinas: el [[autoscaling]]. La nube te da la palanca; el autoscaling la mueve.
- **Tiempo.** Una VM nueva tarda minutos en arrancar. Una con GPU, que además baja la [[imagen-contenedor|imagen del contenedor]] (el paquete con tu programa) y carga el modelo, tarda más: para Triton, el servidor de modelos de Alba, su equipo estima de 5 a 13 minutos hasta servir. Un pico que sube en segundos no se absorbe con máquinas nuevas: se absorbe con las que ya están prendidas.
- **Que haya.** El fondo es enorme, pero no infinito. Tu cuenta tiene un tope de máquinas por región, la [[cuota-servicio|cuota]], y a veces una zona se queda sin el tipo de GPU que pides ([[error-capacidad]]). Las dos cosas son de la lección de máquinas.

:::ojo
La elasticidad solo ahorra si **apagas**. Una máquina que nadie usa y nadie apaga se cobra igual que una que trabaja. Pago por uso significa «pagas lo que tienes prendido», no «pagas lo que aprovechas».
:::

## IaaS, PaaS y SaaS: quién opera cada capa {IaaS, PaaS and SaaS: who runs each layer}

### Las capas de un sistema

Para que el modelo de Alba conteste una foto, alguien tiene que encargarse de todas estas capas, de abajo hacia arriba:

1. El edificio: luz, aire, seguridad física.
2. El hardware: servidores, discos, red.
3. El hipervisor y las VMs.
4. El sistema operativo: instalarlo, ponerle los parches de seguridad.
5. El entorno donde corre tu programa (*runtime*): Python, el [[driver]] de la GPU, Triton.
6. Tu código y tu modelo.
7. Tus datos y quién puede verlos.

La pregunta es **cuántas de esas capas haces tú y cuántas el proveedor**. Las respuestas típicas tienen nombre: **[[iaas-paas-saas|IaaS, PaaS y SaaS]]**.

- **IaaS** (*Infrastructure as a Service*, infraestructura como servicio): rentas máquinas, discos y red. El proveedor cuida hasta el hipervisor; tú, del sistema operativo para arriba. Ejemplo: una VM de EC2.
- **PaaS** (*Platform as a Service*, plataforma como servicio): le das tu código o tu contenedor y el proveedor lo corre. Tú no ves la máquina ni el sistema operativo. Ejemplos: Cloud Run (de Google Cloud), un endpoint de SageMaker AI (la plataforma de ML de AWS).
- **SaaS** (*Software as a Service*, software como servicio): usas un producto terminado. No hay código tuyo; solo tu cuenta, tus datos y tu configuración. Ejemplos: Gmail, una API de un modelo de lenguaje, Textract (el servicio de AWS que lee el texto de documentos, un [[ocr|OCR]]).

Mientras más subes, menos operas y más pagas por unidad. A un servicio donde el proveedor opera la parte difícil se le dice [[servicio-gestionado|servicio gestionado]] (*managed service*), y es el tema de la última lección de este módulo.

:::analogia Comer pizza
Puedes hacer la pizza en tu cocina con tus ingredientes (on-prem), rentar una cocina equipada y llevar tus ingredientes (IaaS), mandar tu receta a una cocina que la prepara (PaaS) o pedirla a domicilio (SaaS). La cocina son las máquinas; la receta, tu código; los ingredientes, tus datos. En cada paso te encargas de menos y pagas más por pizza.

**Dónde se rompe:** en la nube las fronteras no son tan limpias. Muchos servicios son mezclas: en Kubernetes gestionado, el proveedor opera el cerebro del cluster (el programa que decide qué corre en cada máquina), pero las máquinas donde corren tus contenedores son VMs que parchas tú. Y con la pizza nadie te cobra por sacar tus ingredientes de la cocina rentada; en la nube, sí.
:::

### Responsabilidad compartida

Aquí está la trampa más peligrosa de la nube: creer que, como el proveedor cuida «la nube», también cuida lo tuyo. No. La regla se llama **[[responsabilidad-compartida|responsabilidad compartida]]** (*shared responsibility model*): el proveedor se encarga de la seguridad **de** la nube (edificios, hardware, hipervisor, sus servicios) y tú de la seguridad **en** la nube (lo que pones encima y cómo lo configuras).

:::figura nube-responsabilidad
Las siete capas, con tus datos arriba y el edificio abajo, en cuatro columnas. En on-prem todo es tuyo. En IaaS, el proveedor cuida hasta el hipervisor. En PaaS, también el sistema operativo y el runtime. En SaaS, casi todo, menos tus datos y quién tiene acceso: esa franja es tuya siempre.
:::

Unos ejemplos para ubicarla:

- Un disco del servidor se rompe en el centro de datos. Lo cambia el proveedor; tú ni te enteras.
- La VM de Triton tiene un Linux sin parches con un agujero de seguridad conocido. Es tuyo: en IaaS, el sistema operativo es tuyo.
- Alguien deja un [[bucket-objetos|bucket]] con las fotos de los usuarios abierto a todo internet. Es tuyo. S3 hizo exactamente lo que le pidieron.
- Borras por error la tabla de producción de una base de datos gestionada. Es tuyo: el proveedor guarda respaldos (en RDS, las bases de datos gestionadas de AWS, vienen prendidos de fábrica), pero cuántos días se guardan, si alguien los apagó y pedir la restauración son decisiones tuyas.

La franja de arriba, **tus datos y quién puede tocarlos**, nunca pasa al proveedor, ni en SaaS. Quién puede hacer qué en tu cuenta se controla con [[iam|IAM]], que también es de la lección de servicios gestionados.

## Los tres grandes y la tabla de equivalencias {The big three and the equivalence table}

### AWS, Google Cloud y Azure

Tres proveedores concentran la mayor parte del mercado:

- **AWS** (*Amazon Web Services*): la primera y la más grande. Alba corre en AWS, y es la nube que más aparece en entrevistas de diseño.
- **Google Cloud** (GCP, *Google Cloud Platform*): fuerte en datos (BigQuery, su [[data-warehouse]]) y en Kubernetes, que nació en Google. Tiene sus propios chips de IA, las TPU.
- **Microsoft Azure**: muy usada por empresas que ya viven en productos de Microsoft. Fue por años la única nube grande que rentaba los modelos comerciales de OpenAI (los GPT); desde abril de 2026 ya no es exclusiva (también llegaron a AWS), pero sigue siendo donde salen primero.

Por su tamaño se les dice **de hiperescala** (*hyperscalers*). Hay otras: Oracle Cloud, IBM Cloud, Alibaba Cloud, y proveedores más chicos y sencillos como DigitalOcean. Y hay una familia nueva, las **[[neocloud|neoclouds]]**: proveedores que rentan casi solo GPUs, más baratas por hora que en los tres grandes, pero con pocos servicios alrededor. La sección extra del final les pone números.

### Mismo bloque, tres nombres

La regla es: **cambian los nombres, no el diseño**. Una cola es una cola en las tres. Lo que cambia es cómo se llama y algunos detalles. Esta tabla es la que vas a usar todo el módulo (nombres de noviembre de 2026):

| Categoría | AWS | Google Cloud | Azure |
|---|---|---|---|
| Máquinas virtuales | EC2 | Compute Engine | Virtual Machines |
| Kubernetes gestionado | EKS | GKE | AKS |
| Object storage | S3 | Cloud Storage | Blob Storage |
| Disco de la VM | EBS | Persistent Disk · Hyperdisk | Managed Disks |
| Cola de mensajes | SQS | Pub/Sub | Service Bus · Queue Storage |
| SQL gestionado | RDS · Aurora | Cloud SQL · AlloyDB | Azure Database for PostgreSQL |
| Data warehouse | Redshift | BigQuery | Microsoft Fabric |
| Registro de imágenes de contenedor | ECR | Artifact Registry | Container Registry |
| Funciones | Lambda | Cloud Run functions | Azure Functions |
| Balanceador de HTTP | ALB | Cloud Load Balancing | Application Gateway |
| Monitoreo y logs | CloudWatch | Cloud Monitoring · Cloud Logging | Azure Monitor |
| Plataforma de ML | SageMaker AI | Agent Platform (antes Vertex AI) | Azure Machine Learning |

Casi todas las filas son piezas que ya viste en Sensei. Una es nueva: las **[[funcion-serverless|funciones]]** son pedazos de código que el proveedor corre solo cuando llega algo (una request, un archivo nuevo) y que se cobran por ejecución, sin que tengas una máquina prendida esperando. La lección de servicios gestionados las explica. Y la **plataforma de ML** es un servicio que junta entrenar, guardar y servir modelos en un solo lugar.

### Equivalente no es idéntico

La tabla empareja **categorías**, no comportamientos: dos servicios de la misma fila pueden funcionar distinto. La trampa clásica es esta: **Pub/Sub no es Kafka.** Pub/Sub hace de cola y de [[stream-eventos|stream]] a la vez, pero no te deja manejar [[particion-topico|particiones]] ni regresar a una posición exacta del registro (un [[offset]]) como Kafka.

:::profundo Dos trampas más
- **Lo más que regresa Pub/Sub** es a una fecha o a una foto guardada de la suscripción (un *snapshot*), no a un offset exacto.
- **Cloud Run no es Fargate.** Los dos corren contenedores sin que veas las máquinas (Cloud Run en Google Cloud, Fargate en AWS). Cloud Run escala solo, según las requests que llegan, y si no llega ninguna baja hasta cero copias; Fargate corre tareas y el escalado lo pones tú con otra pieza.
- **Event Hubs no es Service Bus.** Los dos son de Azure. El primero es un stream de eventos; el segundo, una cola de mensajes que aparta los que fallan una y otra vez (una [[dlq|dead-letter queue]]).
:::

Además, los nombres cambian: los proveedores renombran productos seguido (Vertex AI ahora es Agent Platform), y en una entrevista te pueden corregir si usas el viejo.

:::profundo La tabla de renombres

| Antes | Ahora | Desde |
|---|---|---|
| Amazon SageMaker (la parte de ML) | Amazon SageMaker AI | diciembre de 2024 |
| Cloud Functions | Cloud Run functions | agosto de 2024 |
| Vertex AI | Gemini Enterprise Agent Platform («Agent Platform») | abril de 2026 |
| Azure AI Foundry | Microsoft Foundry | noviembre de 2025 (en contratos, enero de 2026) |
:::

No vale la pena memorizar las tres columnas. Aprende la de la nube que usa tu empresa (o la de AWS, si no sabes) y para las otras di la categoría: «la cola gestionada de tu proveedor». Por eso la primera pregunta en una entrevista de diseño es **«¿en qué nube están?»**: la respuesta cambia los nombres, los precios y qué GPUs hay, aunque no cambie las cajas del diagrama.

## Cuenta, consola, CLI y API: cómo le hablas a la nube {Account, console, CLI and API: how you talk to the cloud}

### La cuenta

Todo lo que creas en la nube vive dentro de una **[[cuenta-nube|cuenta de la nube]]** (*cloud account*). La cuenta junta tres cosas:

- **Tus recursos**: las máquinas, buckets y bases de datos que creaste.
- **Tu factura**: todo lo que se cobra va a la cuenta, y la cuenta a una tarjeta o a un contrato.
- **Tus permisos**: quién puede crear, ver o borrar cosas en ella.

Cada proveedor la llama distinto. En AWS es una **cuenta**, con un número de 12 dígitos. En Google Cloud, la unidad es el **proyecto**, que cuelga de una cuenta de facturación. En Azure, la **suscripción**. Las empresas no usan una sola: tienen una cuenta para desarrollo, otra para producción, otra para datos sensibles. Así, un error en la de pruebas no toca producción, y la factura sale separada.

La cuenta tiene un usuario dueño, el que la creó con un correo y una tarjeta, que puede hacerlo todo, incluso cerrarla. Ese usuario se guarda bajo llave y no se usa para el trabajo diario: para eso se crean identidades (usuarios o programas, cada uno con su nombre) que solo pueden hacer lo que les toca. Eso se configura con [[iam|IAM]] (*Identity and Access Management*, manejo de identidades y accesos).

### Todo es una API

Aquí está la idea que explica cómo funciona la nube por dentro: **todo se pide por una [[api]]**. Crear una VM, subir una foto a S3, apagar una base de datos: cada cosa es una request [[http|HTTP]] a un [[endpoint]] del proveedor, firmada con tus credenciales. Tus credenciales son una llave secreta que te dio la nube; firmar es agregarle a la request un sello calculado con esa llave, que el proveedor puede comprobar sin que la llave viaje por la red. Así sabe quién pide. En AWS, las máquinas de us-east-1 se piden a `ec2.us-east-1.amazonaws.com`.

Encima de esa API hay tres maneras de hablarle. Juntas son la **[[api-nube|consola, CLI y API de la nube]]**:

- **La consola** (*console*): la página web del proveedor, con botones. Por dentro, cada botón manda una request a la misma API. Sirve para explorar y para ver; es mala para repetir, porque nadie recuerda qué botones apretó.
- **La CLI** (*command-line interface*, interfaz de línea de comandos): un programa que usas desde la [[terminal]]. En AWS se llama `aws`; en Google Cloud, `gcloud`; en Azure, `az`.
- **El SDK** (*software development kit*, kit para programadores): una biblioteca para pedir lo mismo desde tu programa. En Python, la de AWS se llama `boto3`.

Así se ve pedir, listar y apagar una máquina con la CLI de AWS. Es una ilustración: necesita una cuenta de AWS, la CLI instalada y credenciales, y la primera línea empieza a cobrar.

```
aws ec2 run-instances --region us-east-1 --instance-type g4dn.xlarge \
    --image-id ami-0abc1234example --count 1
aws ec2 describe-instances --region us-east-1 \
    --filters Name=instance-state-name,Values=running
aws ec2 terminate-instances --region us-east-1 --instance-ids i-0123456789abcdef0
```

La primera línea pide una máquina: `--instance-type` dice de qué tipo y `--image-id`, con qué disco de arranque (una *AMI*: un sistema operativo ya instalado, listo para copiar). La segunda lista las que están prendidas. La tercera apaga y borra una, nombrada por el id que AWS le puso al crearla (`i-…`).

En Google Cloud, el primero sería `gcloud compute instances create …`; en Azure, `az vm create …`. Distinto nombre, la misma petición.

:::diagrama nube-api
Lo que pasa entre «pido una máquina» y «ya está prendida», y dónde empieza a correr el medidor. Toca cada caja para ver qué hace.
:::

Que todo sea una API tiene una consecuencia enorme: **la infraestructura se puede escribir como código**. En lugar de apretar botones, escribes en un archivo qué máquinas, redes y buckets quieres, y una herramienta como Terraform hace las llamadas a la API por ti. Eso se llama infraestructura como código (*IaC*, *infrastructure as code*).

### El medidor

Cada request que crea algo prende un medidor, y cada request que lo borra lo apaga. El programa de abajo es una nube de juguete: guarda qué máquinas están prendidas y, al apagarlas, escribe un renglón de la factura. Usa dos máquinas, con su precio de lista en us-east-1: la `g4dn.xlarge` de Alba y una `p5.48xlarge`, una máquina para entrenar con 8 GPUs H100, de ≈ US$55 por hora. Las horas se cuentan desde el lunes a las 00:00.

```python
import itertools
PRECIO = {"g4dn.xlarge": 0.526, "p5.48xlarge": 55.04}  # US$ por hora, ≈ us-east-1
ids = itertools.count(1)   # da 1, 2, 3… para numerar las máquinas
encendidas = {}   # id → (tipo, hora en que se prendió)
factura = []      # renglones: (id, tipo, horas, US$)

def run_instances(tipo, hora):
    i = f"i-{next(ids):04d}"
    encendidas[i] = (tipo, hora)
    return i

def terminate(i, hora):
    tipo, inicio = encendidas.pop(i)
    horas = hora - inicio
    factura.append((i, tipo, horas, horas * PRECIO[tipo]))

a = run_instances("g4dn.xlarge", hora=0)    # lunes 00:00: el servidor de siempre
b = run_instances("p5.48xlarge", hora=9)    # lunes 09:00: una prueba de entrenamiento
terminate(b, hora=17)                       # ... que alguien apaga a las 17:00
c = run_instances("p5.48xlarge", hora=112)  # viernes 16:00: otra prueba, y nadie la apaga
for i in list(encendidas):
    terminate(i, hora=168)                  # domingo 24:00: se cierra la semana
for renglon in factura:
    print("%s  %-12s %4d h  US$%9.2f" % renglon)
print("total: US$%.2f" % sum(r[3] for r in factura))
```

```salida
i-0002  p5.48xlarge     8 h  US$   440.32
i-0001  g4dn.xlarge   168 h  US$    88.37
i-0003  p5.48xlarge    56 h  US$  3082.24
total: US$3610.93
```

La `p5.48xlarge` que nadie apagó el viernes es el **85 %** de la factura de la semana: 3,082 ÷ 3,611 ≈ 0.85. La nube no sabe si una máquina está trabajando o esperando: solo sabe que está prendida.

## La factura y quién la opera {The bill and who runs it}

### Qué trae la factura

La **[[factura-nube|factura de la nube]]** (*cloud bill*) llega cada mes con un renglón por cada servicio y cada unidad: horas de cada tipo de máquina, GB guardados, requests, GB que cruzaron de zona, GB de logs. Una empresa mediana puede tener miles de renglones.

Lo primero que sorprende es que **la factura de un sistema de ML rara vez es solo GPU**. Mira la de Alba:

:::cuenta La factura mensual de Alba
GPUs \(G\): 2 × `g4dn.xlarge` (Triton, una T4 cada una) // \(c\) = US$0.526 por hora, \(h\) = 730 | 2 × 0.526 × 730 | ≈ US$768
2 × `c6i.xlarge` (el gateway) // \(c\) ≈ US$0.17 por hora, \(h\) = 730 | 2 × 0.17 × 730 | ≈ US$248
EKS (el cluster de Kubernetes) // US$0.10 por hora, 730 h | 0.10 × 730 | ≈ US$73
ALB (el balanceador) // dato de la factura de Alba: cobra por los bytes que pasan, y las fotos van en el [[body]]; la cuenta está en la lección «Redes en la nube» | — | ≈ US$500
Logs, métricas y S3 // dato de la factura de Alba | — | ≈ US$100
Suma de estos cinco | 768 + 248 + 73 + 500 + 100 | ≈ US$1,689
Total \(T\): más NAT, IPv4, cruce de zona y endpoints // ≈ US$140; poco, porque cada llamada se queda en su zona (ruteo por zona). La cuenta, renglón por renglón, está en la lección «Redes en la nube» | 1,689 + 140 = 1,829 | **≈ US$1.8k al mes**
Parte de las GPUs | \(G ÷ T\) = 768 ÷ 1,829 | ≈ 42 %
Parte del balanceador | 500 ÷ 1,829 | ≈ 27 %
Predicciones al mes \(Q\) // ≈ 10 M al día, una por foto, × 30.4 días (el mes de 730 h) | 10,000,000 × 30.4 | ≈ 304 M
Por cada 1,000 predicciones | \(T ÷ Q × 1,000\) = 1,829 ÷ 304,000,000 × 1,000 | **≈ US$0.006**
= Las GPUs son menos de la mitad. El balanceador, él solo, es más de la cuarta parte.
:::

Todo lo que no es GPU son costos que nadie pidió como «una máquina», y por eso se escapan. Son de las otras lecciones del módulo: el balanceador cobra por bytes procesados; el [[nat|NAT]], la puerta por la que las máquinas sin dirección pública salen a internet, cobra por cada GB que pasa; los datos que cruzan de una zona a otra se cobran por GB, y los que salen a internet también (el [[egress]]). La lección de redes en la nube les pone número. Los logs, en el servicio de logs del proveedor, pueden costar mucho más que guardar el mismo GB en S3.

:::diagrama nube-factura
De dónde sale cada renglón de la factura de Alba: lo que se cobra por hora encendida, lo que se cobra por uso y cómo se junta en una sola cuenta.
:::

Para que la factura sirva para decidir, hay que poder decir «este modelo cuesta X al mes». Para eso se le pone a cada recurso una etiqueta, como `proyecto=clasificador-fotos`, y la factura se agrupa por etiqueta: es la [[etiqueta-costos|etiqueta de asignación de costos]], de la lección de máquinas. Y para no enterarse a fin de mes, se ponen alertas de presupuesto: «avísame si este mes vamos a pasar de US$2,500».

Así se dice un costo en una entrevista, con tres partes: **el servicio, por qué y el orden de magnitud con su supuesto**. «Dos g4dn.xlarge, una por zona por disponibilidad, unos US$770 al mes en GPUs, suponiendo precio on-demand en us-east-1.» «Por disponibilidad» quiere decir que la segunda máquina no está ahí por el tráfico, sino para que, si se cae una zona, la otra siga contestando.

### ¿Quién lo va a operar?

La factura de la nube es la mitad de la cuenta. La otra mitad son las personas. Cada pieza que corres tú (un cluster, una base de datos, un servidor de modelos) necesita a alguien que la actualice, la vigile y la arregle a las 3 de la mañana.

En las empresas medianas y grandes, eso lo hace un **[[equipo-plataforma|equipo de plataforma]]** (*platform team*): un equipo que opera la infraestructura común (los clusters de Kubernetes, las redes, el registro de imágenes, el monitoreo) para que los equipos de producto, como el de ML, la usen sin operarla.

Para elegir entre algo gestionado y algo propio hay varias preguntas (las ves en la lección «Servicios gestionados, serverless y permisos»), y la primera casi siempre decide: **¿quién lo va a operar?** Alba usa EKS porque ya tiene un equipo que opera EKS: agregar dos máquinas con GPU a un cluster que ya existe cuesta poco. Sin plataforma y con un equipo chico, SageMaker AI sería la respuesta pragmática, aunque cueste más por hora.

El sueldo de un ingeniero con experiencia es mayor que los ≈ US$1.8k al mes de toda la infraestructura del clasificador de Alba: en México, un ingeniero de software senior gana del orden de MX$95,000 al mes (≈ US$5k; mediana de Levels.fyi, noviembre de 2026), y en Estados Unidos, varias veces eso. Por eso **comparar solo la factura es comparar la mitad**. La cuenta completa de gestionado contra propio está en la lección de [[gestionado-vs-propio|servicios gestionados]].

## Lock-in, neoclouds y cuándo no conviene la nube {Lock-in, neoclouds and when the cloud is not the answer} [extra]

### La dependencia del proveedor

Mientras más usas los servicios propios de un proveedor, más cuesta irte. Esa es la **dependencia del proveedor** (*vendor lock-in*). Te atan cuatro cosas:

- **APIs propias.** Tu código llama a la API de SageMaker AI o de DynamoDB (una base de datos que solo existe en AWS), y esas APIs no existen en otra nube. Cambiar es reescribir.
- **Formatos y procesos.** Tus pipelines, tus permisos, tus alarmas y tus scripts de despliegue hablan el idioma de un proveedor.
- **Los datos y su salida.** Meter datos a la nube no se cobra; sacarlos sí. Esto se llama [[egress]]. Desde 2024, AWS, Google Cloud y Azure perdonan ese cobro si te vas por completo y lo pides, pero no cuando copias datos afuera y te quedas.
- **Los descuentos.** Un compromiso de gasto de tres años te ata por contrato.

Sacar datos a internet cuesta ≈ US$0.09 por GB en us-east-1, un poco menos mientras más sacas en el mes. Mover un dataset de 50 TB a otro proveedor cuesta ≈ **US$4.3k por copia**: los primeros 10 TB (10,000 GB) a US$0.09 y los otros 40,000 GB a ≈ US$0.085, 10,000 × 0.09 + 40,000 × 0.085 ≈ 4,300. Y cada vez que copias el dataset afuera, se vuelve a cobrar: si entrenas en otro lado cada mes, cada mes. La tarifa completa, por escalones, está en la lección de redes en la nube ([[egress]]).

El remedio es usar **piezas estándar** donde importa: contenedores, Kubernetes, MLflow para registrar modelos, [[parquet|Parquet]] para los datos, la API de S3 (que muchos otros almacenes imitan). Así, si un día te mudas, mueves las piezas y no las reescribes.

Pero cuidado con el extremo contrario. Ser 100 % portable también cuesta: renuncias a servicios gestionados que te ahorran gente y tiempo. La pregunta sensata no es «¿cómo evito todo lock-in?», sino «¿cuánto me costaría salir de esto, y lo voy a necesitar?».

### Neoclouds: GPUs más baratas, con letra chica

En los últimos años aparecieron proveedores especializados en rentar GPUs: Lambda, RunPod, CoreWeave y otros. Se les dice **[[neocloud|neoclouds]]**. Venden casi solo una cosa, [[gpu-hora|GPU-horas]] (una GPU prendida durante una hora), y la venden más barata que los tres grandes.

:::figura nube-h100
Lo que cuesta una hora de una GPU H100 SXM (la versión para servidores, que va montada directo en la tarjeta del servidor) según el proveedor, en noviembre de 2026: los tres grandes arriba, dos neoclouds abajo. La misma GPU cuesta casi el triple en un lado que en otro.
:::

¿Dónde está la letra chica?

- **Menos servicios alrededor.** Tienes la máquina con GPU, pero no la cola, la base de datos, el registro de imágenes y los permisos integrados de una nube grande.
- **Tus datos están en otro lado.** Si el dataset vive en S3, llevarlo a la neocloud cuesta egress cada vez (≈ US$4.3k por cada 50 TB, como viste arriba).
- **Capacidad y promesas distintas.** Algunas ofertas son más baratas porque te pueden quitar la máquina, o porque la disponibilidad y el soporte prometidos son menores.

Por eso conviene decirlo así: **no hay una nube barata, hay precios por GPU y por región**. Una neocloud puede ser la respuesta para un entrenamiento grande y aislado; casi nunca para servir un modelo que vive pegado al resto de tu sistema.

### Cuándo conviene más on-premises

La nube no es la respuesta a todo. Hay cuatro situaciones donde las máquinas propias suelen ganar:

1. **Uso alto, parejo y largo.** Si una GPU va a trabajar casi todo el día durante años, comprarla sale más barato, como viste en la cuenta de CapEx y OpEx. La elasticidad no te sirve si nunca bajas.
2. **Datos que no pueden salir.** Hay leyes y contratos que piden que ciertos datos (historias clínicas, datos de clientes de un banco) no salgan de las instalaciones de la empresa, o que nadie de afuera tenga acceso al hardware.
3. **El borde** (*edge*). Si el modelo tiene que contestar en milisegundos al lado de una cámara, o seguir funcionando cuando se cae internet, corre en una caja local. Es lo que hace un sistema de video en tiempo real con cámaras en 25 centros de distribución, el ejemplo de «En la vida real».
4. **Escala muy grande.** Con suficiente volumen, tener tus propios centros de datos puede costar menos que el margen del proveedor. Dropbox movió más del 90 % de los archivos de sus usuarios de AWS a su propia infraestructura entre 2015 y 2016 (para algunas regiones sigue usando AWS).

Muchas empresas terminan en un **híbrido**: lo estable y sensible en máquinas propias, lo que sube y baja en la nube. Llevar modelos a las máquinas propias de una empresa (qué GPUs comprar, cuántas, cómo operarlas) es un tema completo, con sus propias cuentas.

## Errores comunes {Common mistakes}

**1. Creer que la nube siempre es más barata, o siempre más cara.**
Las dos frases son falsas. La respuesta depende de cuántas horas usas la máquina, por cuántos años, cuánta gente necesitas para operarla y qué tan rápido cambia lo que necesitas.
*Cómo evitarlo:* haz la cuenta con tus horas y con las personas, como en la calculadora de comprar o rentar.

**2. Dejar máquinas prendidas.**
La nube cobra lo que está encendido, no lo que trabaja. Una máquina de entrenamiento olvidada un fin de semana puede costar más que un mes de todo un sistema.
*Cómo evitarlo:* alertas de presupuesto desde el primer día, etiquetas con el dueño de cada recurso y apagado automático de lo que es de prueba.

**3. Comparar solo el precio por hora.**
La GPU es la línea más visible, pero en Alba es menos de la mitad (768 ÷ 1,829 ≈ 42 % de su factura). El balanceador, los logs, el tráfico entre zonas y el egress pueden pesar tanto como ella. Y las personas no salen en la factura.
*Cómo evitarlo:* escribe la factura completa, renglón por renglón, y súmale quién lo opera.

**4. Creer que el proveedor cuida tu seguridad y tus datos.**
El proveedor cuida el edificio, el hardware y el hipervisor. El Linux de tu VM, tus permisos, tus buckets públicos y tus respaldos son tuyos.
*Cómo evitarlo:* para cada pieza, pregunta «¿esto es IaaS, PaaS o SaaS?» y ubica la línea de la responsabilidad compartida.

**5. Nombrar servicios sin porqué ni costo.**
En una entrevista, «uso SageMaker, Kinesis, DynamoDB y Lambda» sin explicar por qué abre una pregunta por cada nombre. A esto se le llama *name-dropping*.
*Cómo evitarlo:* di la categoría, el porqué y el orden de magnitud del costo; el nombre del servicio es un detalle.

**6. Tratar «equivalente» como «idéntico», o usar nombres viejos.**
Pub/Sub no es Kafka y Cloud Run no es Fargate. Y si dices «Vertex AI» en 2026, te pueden corregir.
*Cómo evitarlo:* usa la tabla para traducir categorías, no comportamientos, y revisa el nombre vigente del servicio de tu nube.

**7. Creer que la elasticidad es instantánea e infinita.**
Una VM con GPU tarda minutos en servir, tu cuenta tiene una cuota y una zona se puede quedar sin GPUs.
*Cómo evitarlo:* deja prendido lo que necesitas para el pico de segundos y usa la elasticidad para lo que cambia en horas o días.

## En la vida real {In real life} [extra]

**Alba · Clasificación de fotos.** AWS, `us-east-1`, en la misma región que el backend que lo llama. EKS, porque Alba ya tiene un equipo de plataforma que opera Kubernetes. La factura de infraestructura es ≈ US$1.8k al mes, de los cuales las GPUs son ≈ 42 %. El costo que reporta no es «tanto al mes» sino ≈ US$0.006 por 1,000 predicciones, que el negocio puede comparar con lo que gana por publicación.

**OCR de documentos.** Un sistema que lee el texto de ≈ 186,000 páginas al mes (supuesto del ejemplo) compara Textract, un servicio casi SaaS que cobra US$1.50 por 1,000 páginas (≈ US$279 al mes), contra correr un OCR propio en máquinas sin GPU (≈ US$248, sin contar a la persona que lo opera) o en 2 T4 (≈ US$768). Gana el gestionado: cuesta casi lo mismo que las máquinas de la opción propia más barata y nadie del equipo tiene que operarlo (con esa persona, el propio sube a ≈ US$548; lo ves en el último ejercicio). Además, el OCR es ≈ 3 % del costo del sistema.

**Moderación de contenido.** 10 máquinas `g6.xlarge` (con GPU L4) cuestan ≈ US$5.9k al mes. Pero el sistema tiene ≈ 600 moderadores humanos, ≈ US$900k al mes. Esas GPUs son menos del 1 % del costo, y toda la infraestructura junta, ≈ 2 %: optimizarla es lo último que hay que hacer.

**Un LLM propio.** ≈ 32 GPUs H100 en 4 máquinas `p5.48xlarge` cuestan ≈ US$160k al mes, contra ≈ US$442k al mes de pagar una API por tokens para el mismo tráfico. Aquí la nube como IaaS gana a la nube como SaaS, porque el volumen es enorme y estable.

**Video en tiempo real en centros de distribución.** Aquí manda lo híbrido. Cada uno de los 25 centros tiene su cámara y su caja de cómputo local, que detecta y alerta aunque se caiga internet. A la nube solo suben los clips. Una trampa común: decir «el problema es el egress». Subir datos a AWS no se cobra; lo que cuesta es el enlace de internet de cada sitio, el servicio que recibe el video y el cómputo.

**Pronóstico de demanda.** El entrenamiento corre de noche, unas horas, en máquinas spot (capacidad sobrante con descuento). Cada noche cuesta ≈ US$15–40, ≈ US$450–1,200 al mes. Es el uso ideal del pago por uso: nada prendido de día, y un trabajo que puede repetirse si le quitan la máquina.

**Fuera de ML.** Una tienda en línea mexicana tiene su pico en el Buen Fin y en el Hot Sale: elasticidad pura. Un hospital que guarda historias clínicas puede estar obligado a tenerlas en servidores propios. Netflix corre casi toda su plataforma en AWS; Dropbox sacó de AWS más del 90 % de los archivos de sus usuarios para guardarlos en máquinas propias. Las dos decisiones tienen sentido para cada empresa.

## Ejercicios {Exercises}

Usa precios de lista de us-east-1 (noviembre de 2026) y meses de 730 horas.

:::ejercicios
? [facil] El gateway de Alba corre en máquinas `c6i.xlarge` de ≈ US$0.17 por hora. ¿Cuánto cuesta una prendida todo el mes? ¿Y las dos? ¿Y una que solo prendes de 9:00 a 18:00 en 22 días hábiles?
- La ecuación es la de rentar: \(R = c × h\), con \(c\) = US$0.17 por hora.
- Una, todo el mes (\(h\) = 730): 0.17 × 730 ≈ **US$124.1**.
- Las dos: 2 × 124.1 ≈ **US$248**, el renglón del gateway en la factura de Alba.
- Solo en horario de oficina: \(h\) = 9 h × 22 días = 198 h; 0.17 × 198 ≈ **US$33.66**. Poco más de una cuarta parte, porque está prendida 198 ÷ 730 ≈ 27 % del mes. Sirve para una máquina de pruebas; no para el gateway, que atiende a toda hora.
? [facil] Clasifica como IaaS, PaaS o SaaS: (a) una VM de EC2; (b) Cloud Run, al que le das un contenedor; (c) una API de un modelo de lenguaje que cobra por token; (d) Gmail; (e) EKS.
- (a) **IaaS**: rentas la máquina y desde el sistema operativo para arriba es tuyo.
- (b) **PaaS**: das el contenedor y el proveedor lo corre; no ves la máquina.
- (c) **SaaS**: usas un producto terminado; solo mandas texto y recibes texto.
- (d) **SaaS**.
- (e) **Una mezcla**: el proveedor opera el plano de control (el «cerebro» del cluster), que es como PaaS; pero los nodos donde corren tus contenedores son VMs de EC2, IaaS, y sus parches son tuyos (salvo que uses las modalidades donde AWS también los opera).
? [facil] Con la responsabilidad compartida, ¿de quién es cada problema? (a) Se rompe un disco del servidor físico. (b) La VM de Triton tiene un Linux sin parchar. (c) Un bucket con fotos de usuarios queda público. (d) Se inunda el centro de datos.
- (a) **Del proveedor**: el hardware es suyo.
- (b) **Tuyo**: en IaaS, el sistema operativo es tuyo.
- (c) **Tuyo**: S3 hizo lo que le configuraron. Tus datos y quién los puede ver son tuyos siempre.
- (d) **Del proveedor** el edificio; **tuyo**, haber puesto réplicas en otra zona para seguir funcionando. Eso es la lección de regiones.
? [facil] Traduce las piezas de Alba a Google Cloud y a Azure: EKS, S3, ECR, ALB, CloudWatch y SQS (la cola del backfill).
- EKS → **GKE** / **AKS**.
- S3 → **Cloud Storage** / **Blob Storage**.
- ECR → **Artifact Registry** / **Azure Container Registry**.
- ALB → **Cloud Load Balancing** / **Application Gateway**.
- CloudWatch → **Cloud Monitoring y Cloud Logging** / **Azure Monitor**.
- SQS → **Pub/Sub** / **Service Bus** o **Queue Storage**.
- El diagrama de Alba no cambia; cambian los nombres. Lo que sí hay que revisar es qué GPUs hay en la región elegida.
? [medio] En la cuenta de comprar o rentar (servidor de ≈ US$24,400, 3 años, ≈ US$310 al mes de luz, espacio y mantenimiento), ¿cuántas horas al mes es el equilibrio si rentas la misma GPU en una neocloud a ≈ US$2.69 por hora (el *Secure Cloud* de RunPod), en vez de US$4.50? ¿Y si el servidor dura 5 años y rentas a US$4.50?
- Las ecuaciones son las de comprar o rentar: \(P = K ÷ V + O\) y \(h^{*} = P ÷ c\), con \(K\) = 24,400, \(V\) = 36 y \(O\) = 310.
- El propio sigue costando \(P\) = 24,400 ÷ 36 + 310 ≈ US$988 al mes.
- Neocloud, \(c\) = 2.69: \(h^{*}\) = 988 ÷ 2.69 ≈ **367 h al mes**; 367 ÷ 730 ≈ **50 %** del mes. Con una renta más barata, necesitas usar mucho más el servidor propio para que compense.
- A 5 años, \(V\) = 60 y \(c\) = 4.50: \(P\) = 24,400 ÷ 60 + 310 ≈ US$717 al mes; \(h^{*}\) = 717 ÷ 4.50 ≈ **159 h**; 159 ÷ 730 ≈ **22 %**. Si el servidor dura más, comprar gana antes. Pero en GPUs la vida útil es corta: en 5 años habrá GPUs mucho mejores por el mismo dinero.
? [medio] Una tienda necesita 2 máquinas de ≈ US$0.526 por hora todo el mes, y 10 durante 96 horas de ofertas (cuatro días). Compara tenerlas fijas para el pico con prenderlas solo cuando hacen falta. ¿Cuánto ahorras y a qué porcentaje trabaja en promedio la flota fija?
- Las ecuaciones son las de capacidad fija contra elástica, con \(m_b\) = 2, \(m_p\) = 10, \(t_p\) = 96 h y \(c\) = 0.526.
- Fijas para el pico: \(F = m_p × 730 × c\) = 10 × 730 × 0.526 ≈ **US$3,840**.
- Elásticas: \(E = m_b × 730 × c + (m_p − m_b) × t_p × c\) = (2 × 730 + 8 × 96) × 0.526 = 2,228 × 0.526 ≈ **US$1,172**.
- Ahorro: \(F − E\) = 3,840 − 1,172 ≈ **US$2,668** al mes; la fija cuesta 3,840 ÷ 1,172 ≈ 3.3 veces más.
- Uso promedio de la flota fija: \(u = E ÷ F\), que es lo mismo que 2,228 máquina-horas usadas ÷ 7,300 pagadas (10 × 730) ≈ **31 %**.
? [medio] Alguien prende una `p5.48xlarge` (≈ US$55.04 por hora) el viernes a las 18:00 para una prueba y se olvida de ella hasta el lunes a las 9:00. ¿Cuánto cuesta? ¿Cuántos meses de las dos T4 de Alba son?
- La ecuación es \(R = c × h\), con \(c\) = 55.04 y \(h\) las horas prendida.
- Del viernes 18:00 al lunes 9:00: 6 h del viernes (18:00 a 24:00) + 48 h del sábado y el domingo + 9 h del lunes = **63 h**.
- 55.04 × 63 ≈ **US$3,468**.
- Las dos T4 de Alba cuestan 2 × 0.526 × 730 ≈ US$768 al mes: 3,468 ÷ 768 ≈ **4.5 meses** de GPUs de Alba en un fin de semana.
- El remedio: alertas de presupuesto y apagado automático de lo que lleva la etiqueta de prueba.
? [medio] El equipo de Alba estudia bajar su factura (≈ US$1,829 al mes; ≈ US$768 de GPUs; ≈ 304 M predicciones al mes) mandando al modelo la llave de S3 de la foto (su nombre dentro del bucket) en vez de los bytes de la foto, para que el balanceador ya no cobre por ellos. Ahorra ≈ US$360 netos al mes (ya restado lo que cuesta leer cada foto de S3). ¿Cuánto queda la infraestructura? ¿Qué porcentaje son ahora las GPUs? ¿Cuánto cuesta cada 1,000 predicciones?
- Con las letras de la factura: el total nuevo es \(T − 360\), la parte de las GPUs es \(G ÷ T\) y el costo por 1,000 es \(T ÷ Q × 1,000\).
- Total nuevo: 1,829 − 360 = 1,469, **≈ US$1,470** al mes.
- GPUs: \(G ÷ T\) = 768 ÷ 1,469 ≈ **52 %**. La GPU pesa más en la factura sin que haya cambiado: bajó lo demás.
- Por 1,000 predicciones: \(T ÷ Q × 1,000\) = 1,469 ÷ 304,000,000 × 1,000 ≈ **US$0.0048**.
? [reto] Tu dataset de 50 TB vive en S3. Un entrenamiento usa 1,000 GPU-horas de H100. En AWS, la GPU-hora de H100 cuesta ≈ US$6.88; en una neocloud, ≈ US$4.39 (el *Secure Cloud* de RunPod). ¿Conviene llevar el entrenamiento a la neocloud? ¿Y si el dataset fuera de 5 TB?
- Las cuentas: costo de GPUs = GPU-horas × precio por GPU-hora; egress = GB que salen × ≈ US$0.09 por GB (un poco menos arriba de 10 TB); conviene si el ahorro en GPUs es mayor que el egress.
- En AWS: 1,000 × 6.88 = **US$6,880**. En la neocloud: 1,000 × 4.39 = **US$4,390**. Ahorro en GPUs: **US$2,490**.
- Sacar 50 TB de AWS: los primeros 10,000 GB a US$0.09 y los otros 40,000 a ≈ US$0.085, 10,000 × 0.09 + 40,000 × 0.085 ≈ **US$4.3k** por copia. Ahorro menos egress: 2,490 − 4,300 ≈ −1,810, pierdes ≈ US$1,810: **no conviene** para un solo entrenamiento.
- Con 5 TB, todo en el primer escalón: 5,000 × 0.09 ≈ **US$450** de egress. Ahorras 2,490 − 450 ≈ **US$2,040**: sí conviene, si los datos pueden salir y la neocloud tiene las GPUs cuando las necesitas.
- La lección general: el precio por GPU-hora no decide solo. Pesa dónde están los datos.
? [reto] Un sistema que procesa documentos con OCR lee ≈ 186,000 páginas al mes (supuesto del ejemplo). Textract cobra US$1.50 por 1,000 páginas. Un OCR propio, supón que en CPU, corre en 2 `c6i.xlarge` (≈ US$248 al mes) y pide ≈ 10 horas de una persona al mes para operarlo, a ≈ US$30 la hora (supuesto). ¿Cuál cuesta menos hoy? ¿A partir de cuántas páginas al mes ganaría el propio, si las dos máquinas alcanzan?
- Las cuentas: Textract = páginas × precio por página; propio = máquinas + horas de la persona × su tarifa, fijo; se igualan en páginas del equilibrio = propio ÷ precio por página.
- Textract: el precio por página es 1.50 ÷ 1,000 = US$0.0015; 186,000 × 0.0015 = **US$279** al mes.
- Propio: 248 + 10 × 30 = **US$548** al mes. Hoy gana Textract: 548 ÷ 279 ≈ 2, casi el doble.
- Equilibrio: 548 ÷ 0.0015 ≈ **365,000 páginas al mes**; 365,000 ÷ 186,000 ≈ 2 veces el volumen de hoy.
- Si el volumen crece más allá de eso, hay que volver a medir: quizá dos máquinas ya no alcancen, y entonces el propio sube de escalón.
:::

## Lo que sigue {What comes next} [extra]

La siguiente lección, «Regiones, zonas y disponibilidad», explica dónde están físicamente las máquinas de Alba y por qué hay dos. Después, «Máquinas, GPUs y cómo se cobran» explica qué es exactamente una `g4dn.xlarge` y todos los descuentos sobre el precio de lista; «Redes en la nube» le pone precio a cada GB que se mueve; y «Servicios gestionados, serverless y permisos» entra a lo que el proveedor opera por ti y a IAM.

## Palabras que vas a oír {Words you will hear}

:::conceptos
nube proveedor-nube centro-de-datos maquina-virtual hipervisor on-premises capex-opex pago-por-uso precio-lista elasticidad iaas-paas-saas responsabilidad-compartida cuenta-nube api-nube factura-nube equipo-plataforma dependencia-proveedor neocloud
:::

## Chequeo {Check}

:::chequeo
? ¿Qué tres cosas hacen que algo sea «nube» y no solo «una computadora rentada»?
Lo pides tú solo por software, en minutos (por una API); pagas por uso (hora, GB, request); y sale de un fondo enorme compartido que tomas y devuelves cuando quieres (elasticidad).
? ¿Qué rentas de verdad cuando pides una `g4dn.xlarge`?
Una máquina virtual: un pedazo de un servidor físico de AWS, partido por el hipervisor (Nitro), con 4 vCPU, 16 GiB de RAM y una GPU T4 completa.
? ¿Qué es CapEx, qué es OpEx y cuál de los dos es la nube?
CapEx es una compra grande que se usa años y se amortiza (un servidor). OpEx es el gasto que se paga mes con mes (la luz, la renta). La nube convierte CapEx en OpEx.
? ¿Cómo pasas de US$ por hora a US$ por mes? ¿Cuánto cuestan las dos T4 de Alba?
Multiplicas por 730 horas. 2 × 0.526 × 730 ≈ US$768 al mes.
? En IaaS, ¿de quién es parchar el sistema operativo de la VM? ¿Y en SaaS, de quién son tus datos?
En IaaS, tuyo. En SaaS, tus datos y quién puede verlos siguen siendo tuyos: esa franja nunca pasa al proveedor.
? ¿Por qué «comparar solo la factura es comparar la mitad»?
Porque lo que operas tú necesita personas (actualizar, vigilar, arreglar), y su costo no sale en la factura de la nube. La primera pregunta es: ¿quién lo va a operar?
? ¿Por qué una neocloud con la H100 más barata no siempre conviene?
Porque tus datos y el resto de tu sistema suelen estar en otra nube: sacarlos cuesta egress cada vez, y la neocloud tiene menos servicios alrededor y a veces promete menos.
:::
