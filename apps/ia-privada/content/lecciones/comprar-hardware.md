---
titulo: Comprar hardware: de la workstation al rack
en: Buying hardware: from the workstation to the rack
subtitulo: Qué se compra en concreto cuando el sizing dice «3 L40S»: tarjetas sueltas o un servidor armado, en qué formato, de quién, con qué software y con qué garantía, y cuándo conviene otra GPU, AMD o una Mac.
pregunta: El sizing dice 3 × L40S. ¿Qué pido exactamente, a quién, en qué caja, y cómo sé que no me conviene otra cosa?
sensei: cpu-gpu, maquinas
---

:::idea
Una GPU no se compra sola: se compra **metida en una caja** que le da corriente, aire y una CPU que le mande trabajo. Esa caja decide casi todo lo demás: dónde vive el equipo (una oficina o un rack), qué tarjetas acepta (con ventilador propio o sin él), cuántas caben, quién te lo arma y quién te lo repara. Elegir hardware es leer la hoja de datos en orden (memoria, ancho de banda, cálculo, potencia, formato y software), poner precio por lo que de verdad necesitas, y recordar que el equipo más barato en papel puede ser el que no cabe, no se enfría o no corre tu programa.
:::

## Del sizing a una orden de compra {From the sizing to a purchase order}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México con 200 personas que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Su modelo candidato es **Qwen3 32B en [[cuantizacion|INT4 de AWQ]]** (≈ 19.32 GB de [[pesos]]). Cada pregunta trae ≈ 6,000 tokens de entrada y la respuesta ≈ 500; el despacho quiere el primer token en **2 s o menos** ([[ttft|TTFT]]) y al menos **20 tokens por segundo** por persona. Su equipo de TI son **2 personas** que saben de redes y Windows y nunca han operado una GPU.

El [[sizing]] ya está hecho, con la [herramienta de sizing](/herramientas/sizing/): pide **3 GPUs NVIDIA L40S**. Una sola no basta: leer una pregunta de 6,000 tokens, el [[prefill]], le toma ≈ 2.2–2.4 s, más que el objetivo. Con tres se atienden las ≈ 5.6 conversaciones que hay a la vez en promedio en la hora pico; para que las 8 de diseño vayan todas a 20 tokens por segundo harían falta 4. Ese es el punto de partida.

Y aquí empieza un problema que el sizing no contesta. «3 L40S» no es algo que se pueda pedir. Una L40S es una **tarjeta**: una placa de 10.5 pulgadas de largo, sin ventilador, que necesita una computadora alrededor. Para que funcione hacen falta:

- **Una ranura PCIe** de su tamaño (ocupa dos ranuras de ancho) por cada tarjeta, y espacio entre ellas.
- **Corriente**: hasta 350 W por tarjeta, por un conector propio.
- **Aire**: alguien tiene que empujar aire a través de sus aletas.
- **Una CPU, RAM y discos** que carguen el modelo, corran el servidor de inferencia y hablen con la red.
- **Alguien que responda** cuando algo se descomponga.

Antes de seguir, dos cosas que Sensei explica a fondo y aquí solo se recuerdan. Una GPU tiene su propia memoria, la [[vram|VRAM]], y la lee a un [[ancho-de-banda|ancho de banda]] que decide qué tan rápido escribe tokens el [[decode]]; la memoria de las GPUs grandes es HBM, apilada junto al chip. Y una GPU habla con la CPU por **PCIe**, el bus de las ranuras de la tarjeta madre, y con otras GPUs por PCIe o por **NVLink**, un cable propio de NVIDIA mucho más rápido. Lo ves en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/). Qué GPUs se rentan en la nube y a cuánto está en [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/). Aquí la pregunta es otra: **qué se compra, para tenerlo en casa**.

:::analogia Comprar un motor no es comprar un coche
Pedir «3 L40S» es como ir a una agencia y pedir «tres motores V8». Un motor no anda solo: necesita chasis, transmisión, radiador, tanque y alguien que te lo arregle en garantía. Puedes comprar los motores en una refaccionaria y armar el coche en tu cochera, o comprar el coche hecho. Casi nadie arma su coche, y casi nadie debería armar su servidor.

Dónde se rompe: un coche hecho trae un solo motor que no cambias. Un servidor trae ranuras: puedes comprarlo con 3 tarjetas y ponerle la cuarta el año que viene, o cambiar las tarjetas por otras más nuevas sin tirar la caja.
:::

El resto de la lección responde, en orden, las preguntas que hay entre el sizing y la orden de compra: qué leer en la hoja de datos, cuánta potencia y aire pide cada tarjeta, en qué caja va (torre, servidor de rack o una placa de 8 GPUs), quién la vende, cuánto cuesta armada, qué software corre, cuándo conviene otra GPU y qué garantía trae. Al final, la decisión del despacho con sus razones.

## La hoja de datos: qué mirar y en qué orden {The spec sheet: what to look at, in what order}

Una hoja de datos (*datasheet*) de GPU trae decenas de cifras. Para servir un LLM importan pocas, y en este orden:

1. **VRAM, en GB.** Decide si el modelo y su [[kv-cache|KV cache]] caben. Si no caben, nada más importa. Lo calculas con [¿Cabe en la GPU?](/herramientas/vram/).
2. **Ancho de banda de memoria, en GB/s.** Decide los tokens por segundo del decode, que está [[memory-bound|limitado por memoria]]: cada token lee todos los pesos.
3. **Cálculo denso en FP16 y FP8, en TFLOPS.** Decide el prefill, y con él el TTFT. Ojo con la cifra de la portada: casi siempre es **con *[[sparsity]]***, el doble de la útil. La densa es la mitad.
4. **Potencia máxima (TDP), en watts.** Decide la fuente, el enfriamiento y la luz. Va en la siguiente sección.
5. **Formato.** Tarjeta PCIe de una o dos ranuras, con o sin ventilador, o módulo [[sxm|SXM]] que no se vende suelto.
6. **Interconexión.** Si la tarjeta tiene NVLink o solo PCIe. Importa cuando un modelo se reparte entre varias GPUs (la lección «[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)» lo ve a fondo).
7. **Formatos de número.** Si calcula en FP8 o en [[fp4|FP4]] con hardware propio. Una GPU sin FP8 no acelera un modelo guardado en FP8.
8. **Software.** CUDA, ROCm o Metal. Tiene su propia sección: puede decidir más que todo lo de arriba.

El [catálogo de hardware](/herramientas/catalogo/) pone las cinco primeras columnas lado a lado para 26 equipos de NVIDIA, AMD y Apple, cada número con su fuente y su fecha. Úsalo como hoja de datos de todas las tarjetas a la vez; aquí no se repite la tabla.

### Poner precio a lo que necesitas

Una vez que sabes qué cifra te limita, la comparación honesta es **cuánto cuesta cada unidad de esa cifra**. Si te limita la memoria (quieres meter un modelo grande), importa cuántos dólares pagas por GB de VRAM. Si te limita la velocidad de escritura, cuántos dólares por cada GB/s de ancho de banda.

:::formula Precio por GB y por GB/s
c_M = frac{K}{M}
c_B = frac{K}{B}
- K: el precio de compra de referencia de una tarjeta, en US$ (sin impuestos)
- M: la VRAM de la tarjeta, en GB
- B: el ancho de banda de la tarjeta, en GB/s
- c_M: lo que pagas por cada GB de memoria, en US$/GB
- c_B: lo que pagas por cada GB/s de ancho de banda, en US$ por GB/s
:::

:::cuenta L40S contra RTX PRO 6000 Blackwell, a noviembre de 2026
Precio de la L40S, \(K\) // nueva en empaque OEM: US$9,005.40 en IT Creations, que gpus.json redondea (2026-11-25) | | US$9,005
Memoria y ancho de banda de la L40S, \(M\) y \(B\) // hoja de NVIDIA, gpus.json | | 48 GB · 864 GB/s
L40S por GB, \(c_M\) | 9,005 ÷ 48 | ≈ US$187.6 por GB
L40S por GB/s, \(c_B\) | 9,005 ÷ 864 | ≈ US$10.42 por GB/s
Precio de la RTX PRO 6000, \(K\) // Workstation Edition, la variante de torre: Newegg vía BuildCores, gpus.json (2026-11-13) | | US$16,399
Memoria y ancho de banda de la PRO 6000, \(M\) y \(B\) // Workstation Edition, gpus.json | | 96 GB · 1,792 GB/s
PRO 6000 por GB, \(c_M\) | 16,399 ÷ 96 | ≈ US$170.8 por GB
PRO 6000 por GB/s, \(c_B\) | 16,399 ÷ 1,792 | ≈ US$9.15 por GB/s
= La PRO 6000 cuesta 1.8 veces más por tarjeta, pero es **más barata por GB y por GB/s**: trae el doble de memoria y 2.07 veces el ancho de banda.
:::

:::figura comprar-hardware-precio
Dólares por GB de VRAM de ocho opciones, con su ancho de banda al lado. Las más baratas por GB fallan en otra cifra: las dos Radeon tienen mucho menos cálculo que la L40S (y la R9700, menos ancho de banda), y la Mac Studio, que es un equipo completo, tiene buen ancho de banda (1,200 GB/s) pero un prefill lento. Las H100 son las más caras por GB porque pagas ancho de banda y cálculo, no memoria.
:::

Dos advertencias antes de usar estos números. Primero, **son precios de referencia con fecha**, de revendedores y agregadores, no de lista: las GPUs cambian de precio cada pocas semanas (la RTX PRO 6000 salió a ≈ US$8,500 y hoy ronda los US$16,000). Segundo, **no todos son lo mismo**: el precio de una H100 SXM es el de un servidor de 8 entre 8 (incluye CPUs, RAM y chasis), el de una Mac Studio es un equipo entero, y el de una L40S es solo la tarjeta. Comparar la tarjeta sola contra un equipo completo engaña a favor del equipo.

:::calculadora comprar-hardware-precio
Empieza con la L40S y 144 GB, lo que dan las 3 del despacho: 3 tarjetas, ≈ US$27,015. Cambia a la RTX PRO 6000 (precio y cifras de la Workstation Edition, la de gpus.json): bastan 2 tarjetas para 192 GB, ≈ US$5,783 más que las 3 L40S, y el prefill del despacho baja de 2 s. La tabla de abajo ordena todas las GPUs de gpus.json que tienen precio, de la más barata a la más cara por GB.
:::

La calculadora también da el prefill de una pregunta del despacho en cada tarjeta, con la cuenta que verás en la sección de alternativas. Fíjate en que la columna más barata por GB casi nunca es la más rápida: son dos compras distintas.

## La potencia y el aire: TDP, tarjetas pasivas y activas {Power and air: TDP, passive and active cards}

Cada tarjeta trae en su hoja una potencia máxima. NVIDIA la llama *max power consumption* o TGP; AMD, *total board power*; casi todo el mundo dice [[tdp|TDP]] (*thermal design power*, potencia de diseño térmico): los watts que la tarjeta puede llegar a pedir sostenidamente, y por lo tanto los que hay que sacar en forma de calor. La L40S tiene 350 W; la RTX PRO 6000 Workstation Edition, 600 W; una H100 SXM, hasta 700 W; una B200, hasta 1,000 W.

El TDP importa tres veces:

- **La fuente de poder** del equipo tiene que entregar la suma de los TDP más lo del resto: CPUs, RAM, discos y ventiladores.
- **El enfriamiento** tiene que sacar ese mismo calor. Toda la energía que entra sale como calor: un servidor de 1,800 W es un calentador de 1,800 W.
- **La luz y el circuito** del cuarto. Eso es tema de la lección «[El cuarto: energía, enfriamiento y red](/el-cuarto/)», que hace las cuentas de amperes, aire acondicionado y recibo.

:::formula Lo que pide el equipo y lo que aguanta la fuente
P_{eq} = n × P_{GPU} + P_{resto}
u = frac{P_{eq}}{P_{fuente}}
- n: las tarjetas del equipo
- P_{GPU}: el TDP de cada tarjeta, en W (gpus.json)
- P_{resto}: CPUs, RAM, discos y ventiladores, en W (un supuesto si el fabricante no lo publica)
- P_{eq}: lo que puede pedir el equipo entero, en W
- P_{fuente}: lo que entrega la fuente de poder (o las fuentes que trabajan), en W
- u: la carga de la fuente; una regla prudente es no pasar de ≈ 0.8 con carga sostenida (supuesto)
:::

:::cuenta Dos RTX PRO 6000 en una torre de oficina
Fuente de la torre, \(P_{fuente}\) // supuesto: una fuente de escritorio de 1,600 W | | 1,600 W
Resto del equipo, \(P_{resto}\) // supuesto: una CPU de workstation, RAM, discos y ventiladores | | 350 W
Con dos Workstation Edition, \(P_{eq}\) // \(P_{GPU}\) = 600 W | 2 × 600 + 350 | 1,550 W
Carga, \(u\) | 1,550 ÷ 1,600 | ≈ 0.97
Con dos Max-Q, \(P_{eq}\) // la variante de 300 W de la misma tarjeta | 2 × 300 + 350 | 950 W
Carga, \(u\) | 950 ÷ 1,600 | ≈ 0.59
= Con dos tarjetas de 600 W la fuente queda al 97 %: un pico de consumo puede dispararla y apagar el equipo. Por eso existe la Max-Q de 300 W, pensada para meter varias en una torre.
:::

La Max-Q tiene la misma memoria (96 GB) y el mismo ancho de banda; pierde algo de cálculo: 438.9 TFLOPS densos en FP16 contra 503.8 de la Workstation Edition, según el whitepaper de NVIDIA (los dos en gpus.json). Para un decode que espera a la memoria, casi no se nota; en el prefill, ≈ 13 % menos.

### Quién mueve el aire

Aquí aparece la diferencia más práctica entre tarjetas, y la que más se olvida. Una tarjeta **activa** trae sus propios ventiladores: jala aire del gabinete, lo pasa por sus aletas y lo saca. Funciona en cualquier torre con un poco de ventilación. Una [[tarjeta-pasiva|tarjeta pasiva]] no trae ventilador: solo aletas. Depende de que **el chasis del servidor** empuje una corriente fuerte de aire de adelante hacia atrás a través de ella, con ventiladores que en un servidor de GPUs giran a miles de revoluciones y hacen el ruido de una aspiradora.

:::figura comprar-hardware-aire
Arriba: una torre con tarjetas activas; cada una mueve su propio aire. Abajo: un servidor de rack con tarjetas pasivas; los ventiladores del frente empujan el aire por todas las aletas en un solo sentido y lo sacan por atrás.
:::

La L40S es pasiva: su hoja de NVIDIA lo dice con esa palabra. Una L40S en una torre de oficina, sin esa corriente de aire, se calienta hasta bajar su velocidad para protegerse o apagarse. Por eso **la L40S se compra dentro de un servidor hecho para ella**, no suelta para una torre. La RTX PRO 6000 viene en tres variantes, y la diferencia es justo esta:

| Variante | Potencia | Enfriamiento | Ancho de banda | Para |
|---|---|---|---|---|
| Server Edition | 400–600 W, configurable | Pasiva | 1,597 GB/s | Servidor de rack |
| Workstation Edition | 600 W | Activa (ventiladores propios) | 1,792 GB/s | Torre |
| Max-Q Workstation Edition | 300 W | Activa | 1,792 GB/s | Torre con varias tarjetas |

Las tres traen 96 GB (fichas de NVIDIA, noviembre de 2026). Pedir «una RTX PRO 6000» sin decir cuál es pedir mal: la Server Edition en una torre se sobrecalienta, y la Workstation Edition no está hecha para el flujo de aire de un chasis de rack.

:::ojo
La tarjeta que va en el servidor del despacho es la **Server Edition**, pero el precio de gpus.json y del catálogo es el de la **Workstation Edition**, la tarjeta de torre; la Server Edition tiene su propia ficha, sin precio. La página de NVIDIA de la Server Edition (noviembre de 2026) da **1,597 GB/s**, ≈ 11 % menos ancho de banda que la Workstation, y «1 PFLOP» en FP16 sin decir si es con *sparsity*; como coincide con la cifra con *sparsity* de la Workstation (1,007.6 TFLOPS), su cálculo denso sería el mismo, ≈ 500 TFLOPS. Su potencia se configura entre 400 y 600 W, y existe una variante con [[enfriamiento-liquido|enfriamiento líquido]] de una sola ranura. En esta lección, cuando una cuenta usa «la PRO 6000», dice cuál.
:::

## La escalera: workstation y servidor de rack {The ladder: workstation and rack server}

El hardware para servir LLMs se ordena como una escalera, de la oficina al centro de datos. Cada escalón cambia dónde vive el equipo, quién lo opera y cuántas GPUs caben.

:::figura comprar-hardware-escala
Los escalones a la misma escala de altura: una torre al lado de un rack de 42U con un servidor de 8U con una placa HGX, uno de 4U y uno de 2U. Cada «U» mide 44.45 mm.
:::

### La workstation: 1 a 4 GPUs bajo el escritorio

Una [[workstation]] es una computadora de torre potente, hecha para una persona o un equipo chico: cabe bajo un escritorio, se conecta a un contacto normal y hace un ruido tolerable. Las de IA aceptan de 1 a 4 tarjetas de doble ranura **activas**. Ejemplos con datos públicos al 25 de noviembre de 2026:

- **Exxact**: una torre de 560 × 240 × 580 mm con seis ranuras PCIe 5.0 x16 (de 16 carriles, el ancho completo), soporte para 4 tarjetas de doble ancho y 3 años de garantía en piezas y mano de obra. El configurador suma US$14,080 por cada RTX PRO 6000.
- **Bizon X5500 G2**: hasta 2 RTX 5090 o 4 RTX PRO 6000 (Max-Q o Workstation), hasta 384 GB de VRAM con 4; precio «desde» US$9,076 sin GPU profesional.
- **Lambda Vector Pro**: hasta 4 GPUs de doble ranura, por cotización.

La workstation es el escalón correcto para un equipo de desarrollo, un piloto que se queda en casa o una oficina sin cuarto de servidores. Su límite es físico: la corriente de un contacto, la fuente de escritorio y el aire de una torre. Dos tarjetas de 600 W ya lo llenan: por eso las torres de 4 usan la Max-Q de 300 W.

### El servidor de rack: 4 a 10 GPUs PCIe

Un [[servidor-gpu|servidor con GPUs]] es una computadora hecha para un **rack**: un mueble de metal de 19 pulgadas de ancho donde los equipos se atornillan uno encima de otro. La altura se mide en [[unidad-de-rack|unidades de rack]]: **1U = 1.75 pulgadas = 44.45 mm**, y un rack típico completo tiene **42U**, ≈ 1.87 m de alto útil. Los servidores de GPUs suelen ser de 2U o 4U: más altos que un servidor normal de 1U porque las tarjetas y su aire necesitan espacio.

Ejemplos con sus fichas oficiales:

- **Supermicro SYS-221GE-NR** (2U, 2 CPUs Xeon de Intel): hasta 4 GPUs de doble ancho, entre ellas L40S, H100 y H100 NVL; 3 fuentes de 2,000 W redundantes; insignia de sistema certificado por NVIDIA.
- **Dell PowerEdge R760xa** (2U, 2 Xeon): hasta 4 GPUs de doble ancho; fuentes de 2,400 o 2,800 W; sin precio publicado.
- **Supermicro SYS-421GE-TNRT** (4U): hasta 10 GPUs de doble ancho, entre ellas la L40S; 4 fuentes de 2,700 W redundantes.
- **Exxact TensorEX 4U con 4 L40S** (2 CPUs AMD EPYC 9124, 384 GB de RAM): US$76,101.30, el único servidor de L40S con precio verificado en el catálogo (lo calculas en la sección de tarjetas sueltas).
- **HPE ProLiant DL380a Gen12** (4U, Xeon 6): hasta 8 RTX PRO 6000 Server Edition, con aire o con [[enfriamiento-liquido|enfriamiento líquido]] directo.

Un servidor de rack trae cosas que una torre no: **[[fuente-redundante|fuentes redundantes]]** (dos o más fuentes, de modo que si una falla las otras cargan con todo y el equipo sigue), ventiladores fuertes para las tarjetas pasivas, y una **[[bmc|tarjeta de gestión remota]]**, un pequeño computador propio que deja prender, apagar y ver el equipo por la red aunque el sistema operativo esté colgado. Las dos ideas se ven a fondo en la lección «[El cuarto: energía, enfriamiento y red](/el-cuarto/)».

Las fuentes de un servidor tienen un detalle que pega directo en México: **entregan menos a 127 V que a 220 V**. Las del servidor Exxact de 4 L40S son 4 de 3,000 W en «3 + 1» (tres trabajan y una sobra por si falla otra), pero cada una entrega 2,600 W a 200–220 V y solo **1,000 W a 100–127 V** (equipos.json).

:::formula Lo que entregan las fuentes redundantes
P_{fuente} = (N_f − N_r) × P_f(V)
- N_f: las fuentes del equipo
- N_r: las que sobran por redundancia (1 en «3 + 1»)
- P_f(V): lo que entrega cada fuente al voltaje del contacto, en W
- P_{fuente}: lo que el equipo puede pedir sin depender de la fuente de repuesto, en W
:::

:::cuenta El servidor de 4 L40S a 127 V y a 220 V
Fuentes que trabajan, \(N_f − N_r\) // 4 fuentes en 3 + 1 | 4 − 1 | 3
A 127 V, \(P_{fuente}\) // \(P_f\) = 1,000 W por fuente | 3 × 1,000 | 3,000 W
A 220 V, \(P_{fuente}\) // \(P_f\) = 2,600 W por fuente | 3 × 2,600 | 7,800 W
Con 4 L40S, \(P_{eq}\) // \(P_{GPU}\) = 350 W; \(P_{resto}\) = 400 W, el supuesto de la herramienta de TCO | 4 × 350 + 400 | 1,800 W
Carga a 127 V, \(u\) | 1,800 ÷ 3,000 | 0.60
Con 4 PRO 6000 Server a 600 W, \(P_{eq}\) | 4 × 600 + 400 | 2,800 W
Carga a 127 V, \(u\) | 2,800 ÷ 3,000 | ≈ 0.93
= Cuatro L40S caben con holgura aun a 127 V. Cuatro tarjetas de 600 W, no: a 127 V pasan de 0.8 y hace falta un contacto de 220 V. Pregúntale al integrador a qué voltaje vale su número de fuentes.
:::

## Cuando ya no es una caja: HGX y el rack completo {When it is no longer a box: HGX and the full rack} [extra]

El siguiente escalón ya no usa tarjetas. Las GPUs más grandes de NVIDIA, como la H100 SXM, la H200 y la B200, vienen en formato [[sxm|SXM]]: módulos sin ranura PCIe que se atornillan, de 8 en 8, sobre una placa base que NVIDIA llama [[hgx|HGX]]. La placa trae las 8 GPUs unidas entre sí por NVLink (en la HGX B200, de quinta generación: 1.8 TB/s de GPU a GPU), y NVIDIA la vende a los fabricantes de servidores, no al público. Por eso **una H100 SXM no se compra suelta**: se compra un servidor de 8.

Los números de los servidores HGX con precio en el catálogo, a noviembre de 2026:

| Servidor | GPUs | US$ sin impuestos | Fuentes |
|---|---|---|---|
| Exxact TensorEX 6U | 8 × H100 SXM 80 GB | 306,152 | 8 × 3,000 W |
| Supermicro SYS-821GE-TNHR (8U) | 8 × H200 141 GB | 320,528.23 | 6 × 3,000 W |
| Exxact TensorEX 8U | 8 × B200 180 GB | 447,238 | 12 × 3,002.4 W |

Solo las 8 GPUs de la B200 suman 8 × 1,000 = 8,000 W de TDP. Eso ya no se enchufa en un cuarto de oficina: pide circuitos de 220 V dedicados. NVIDIA publica ≈ 14.3 kW como máximo para su propio servidor de 8 B200 (la DGX B200), así que un rack con cuatro pasa de 50 kW; a esas densidades enfriar se vuelve un proyecto de centro de datos, y muchos pasan al [[enfriamiento-liquido|enfriamiento líquido]]. Es el tema del cuarto, no de la compra.

AMD tiene el mismo esquema con otro nombre. Sus Instinct MI300X, MI325X y MI355X vienen en módulos [[oam|OAM]] (*OCP Accelerator Module*, un formato abierto de la industria), de 8 en 8 sobre una placa base que el mismo proyecto llama UBB (*universal baseboard*). La ficha de AMD de la plataforma MI300X dice que se vende **a través de socios**: Dell (PowerEdge XE9680), Lenovo (ThinkSystem SR685a V3) y Supermicro, entre otros. No se encontró ninguna MI300X, MI325X ni MI355X a la venta suelta, y ninguna tiene precio en gpus.json: se cotizan.

El último escalón es **el rack completo** como unidad: sistemas como la GB200 NVL72 de NVIDIA, 72 GPUs unidas por NVLink en un rack entero, con enfriamiento líquido y su propia red. Están fuera de lo que una empresa mediana compra para servir un modelo, y se mencionan solo para que sepas que la escalera sigue.

:::nota ¿Le sirve un HGX al despacho?
Con la herramienta de sizing, una sola H100 SXM aguanta ≈ 17 conversaciones del despacho a 20 tokens por segundo, y el despacho tiene ≈ 5.4 a la vez en la hora pico (menos que las 5.6 de la L40S, porque con la H100 cada respuesta empieza antes). Un servidor de 8 H100 tendría capacidad para ≈ 136: usaría ≈ 4 % de lo que paga. El HGX es para modelos que no caben en una GPU, o para miles de usuarios.
:::

## Quién te lo vende: fabricante, OEM e integrador {Who sells it: chipmaker, OEM and integrator}

Entre el chip y tu cuarto hay una cadena, y cada eslabón agrega algo y cobra algo.

:::diagrama comprar-hardware-cadena
Toca cada caja para ver qué pone ese eslabón. El recorrido sigue la compra del despacho y lo que pasa cuando una tarjeta falla.
:::

- **El fabricante del chip** (NVIDIA, AMD, Apple) diseña la GPU y vende tarjetas, placas HGX u OAM, o equipos completos (Apple, la DGX de NVIDIA). Casi nunca le vende directo a una empresa mediana.
- **El [[oem|OEM]]** (*original equipment manufacturer*, fabricante del equipo original): Dell, HPE, Lenovo y Supermicro diseñan el servidor alrededor de la GPU: tarjeta madre, chasis, fuentes, ventiladores y *firmware* (el programa que arranca el equipo y controla sus piezas). Su nombre va en el equipo y su garantía cubre todo.
- **El [[integrador]]** (Exxact, Bizon, Lambda, Puget Systems, y en cada país, distribuidores locales): toma chasis de un OEM o propios, los configura con las tarjetas, la RAM y los discos que pides, instala el sistema operativo y los drivers, suele probarlos encendidos antes de enviarlos, y te da una sola garantía y un solo teléfono.
- **El revendedor**: tiendas como IT Creations, Newegg o un mayorista. Venden tarjetas y servidores, nuevos o reacondicionados, casi siempre sin integración.

Para el despacho, lo que importa del integrador no es el precio (ya verás que la tarjeta cuesta casi lo mismo), sino tres cosas que un equipo de TI de 2 personas sin experiencia en GPUs no tiene: **que el equipo llegue probado** con las tarjetas puestas, **que alguien conteste** cuando algo falla, y **que la combinación de chasis y tarjetas sea una que el fabricante ya validó**.

:::profundo Sistemas certificados
Esa última idea tiene nombre. Un [[sistema-certificado|sistema certificado por NVIDIA]] (*NVIDIA-Certified System*) es un modelo de servidor que un socio de NVIDIA probó con una GPU concreta y que NVIDIA validó: cargas reales de IA (entrenamiento, inferencia, ciencia de datos) con una y varias GPUs, seguridad (un chip TPM que guarda llaves y comprueba el arranque), gestión remota, y pruebas físicas **térmicas, mecánicas, de potencia y de integridad de señal**. Es decir: que esa tarjeta en ese chasis no se calienta, no hace mal contacto y recibe la corriente que pide. Hay niveles (Foundation, Enterprise y NVIDIA Cloud Partner), y el programa ya cubre workstations y equipos de borde. Supermicro marca sus SYS-221GE-NR y SYS-421GE-TNRT con la insignia.
:::

:::profundo La licencia de NVIDIA AI Enterprise, por GPU
NVIDIA vende aparte un paquete de software con soporte, **NVIDIA AI Enterprise**: sus contenedores, bibliotecas y servidores de inferencia mantenidos, con alguien que contesta. Se licencia **por GPU**. Los precios de lista para sistemas propios, a noviembre de 2026: US$4,500 por GPU por 1 año, US$13,500 por 3 años, US$18,000 por 5 años («cinco años por el precio de cuatro») y US$22,500 una licencia perpetua con 5 años de soporte. Los revendedores cobran distinto.

Tres detalles. La prueba gratis de 90 días **exige un servidor certificado**. La H100 NVL (y la H100 PCIe, la H200 NVL y la A800 PCIe, según la página de precios) **trae la suscripción de 5 años incluida**, que se activa con el número de serie de la GPU. Y para la L40S y la RTX PRO 6000 no se encontró que venga incluida.

Para el despacho, la cuenta asusta: 3 L40S × US$18,000 = **US$54,000 en 5 años**, casi lo mismo que el servidor. Pero no es obligatoria: el driver de NVIDIA y CUDA se descargan sin costo, y un servidor de inferencia de código abierto como vLLM corre sin esa licencia. Lo que compras con ella es soporte y software mantenido, no el permiso de usar la GPU.
:::

## Tarjetas sueltas o servidor armado: la cuenta {Loose cards or a built server: the math}

Con todo lo anterior, el despacho tiene dos caminos para sus 3 L40S:

- **Armarlo**: comprar 3 tarjetas a un revendedor y un servidor sin GPUs, y montarlas.
- **Pedirlo armado**: un servidor de un integrador con las tarjetas puestas.

:::formula Lo que cuesta el equipo
C = S + n × K + n × L × a
- S: el servidor sin GPUs (chasis, CPUs, RAM, discos y fuentes), en US$
- n: las tarjetas
- K: lo que cuesta cada tarjeta (suelta, o lo que el integrador suma por cada una), en US$
- L: la licencia de software por GPU y año, en US$ (0 si no la compras)
- a: los años de licencia
- C: lo que cuesta el equipo, en US$ sin impuestos ni envío
:::

:::cuenta El despacho: armado por Exxact o con tarjetas sueltas
Servidor sin GPUs, \(S\) // Exxact TensorEX 4U, configuración Essential sin GPU (2× EPYC 9124, 384 GB), equipos.json | | US$40,461.30
Lo que Exxact suma por L40S, \(K\) // su configurador, 2026-11-25 | | US$8,910
Armado con 3, \(C\) // \(n\) = 3, sin licencia | 40,461.30 + 3 × 8,910 | US$67,191.30
Armado con 4, \(C\) // \(n\) = 4: el servidor de equipos.json | 40,461.30 + 4 × 8,910 | US$76,101.30
Con 3 sueltas, \(C\) // \(K\) = US$9,005, nueva en IT Creations (gpus.json) | 40,461.30 + 3 × 9,005 | US$67,476.30
Diferencia sueltas − armado, con 3 | 67,476.30 − 67,191.30 | ≈ US$285 más caro suelto
Con licencia de 5 años, \(C\) // \(L × a\) = US$18,000 por GPU | 67,191.30 + 3 × 18,000 | US$121,191.30
= Comprar las tarjetas sueltas **no ahorra**: el integrador cobra por tarjeta casi lo mismo que la tienda. Lo que sí cambia el precio es la licencia de software, y esa es opcional.
:::

La cuenta muestra algo que sorprende la primera vez: **el margen del integrador no está en las tarjetas**. Está en el servidor base, que pagas igual en los dos caminos. Comprar suelto solo tiene sentido si ya tienes el servidor, o si una tarjeta reacondicionada te sale mucho más barata (en gpus.json hay L40S reacondicionadas desde US$6,420), aceptando su garantía corta.

Lo que se pierde al armarlo uno mismo no sale en la cuenta: la prueba encendida antes del envío, la garantía única (si una tarjeta falla, ¿la culpa es de la tarjeta, de la ranura o de la fuente?), la combinación certificada y el tiempo de un equipo de TI que nunca ha instalado una GPU.

:::calculadora comprar-hardware-caja
Arranca con el servidor de 4U a 127 V y 3 L40S (al precio de tienda de gpus.json, por eso sale ≈ US$285 arriba del armado de Exxact). Sube a 4 tarjetas: sale ≈ US$380 arriba del servidor de equipos.json (US$76,101.30), por la misma razón, y la fuente queda al 60 %. Cambia la GPU a la RTX PRO 6000 con 4 tarjetas: a 127 V la carga pasa de 0.8. Pasa a 220 V y vuelve a caber. Elige la torre con 2 PRO 6000 y mira cómo la fuente de escritorio queda al límite.
:::

### La cuarta ranura

Las fichas de los servidores de 2U y 4U aceptan 4 o más tarjetas, y el despacho pide 3. La ranura libre no es desperdicio: el mismo sizing dice que para que las 8 conversaciones de diseño vayan todas a 20 tokens por segundo hacen falta 4, y que con 3 se cubre el promedio. Comprar un servidor de 4 ranuras con 3 tarjetas deja la cuarta como **crecimiento**: si la [[prueba-de-carga|prueba de carga]] del piloto pide la cuarta, se agrega sin cambiar de caja. Es la forma más barata de crecer, y si la cuarta se compra sirve también de [[redundancia]]: si una tarjeta falla, las otras tres siguen atendiendo.

## El software manda: CUDA, ROCm y MLX {Software rules: CUDA, ROCm and MLX}

Una GPU sin el software que la sabe usar es un calentador caro. Este es el punto donde más se equivocan las compras guiadas por la tabla de precios.

[[cuda|CUDA]] es la plataforma de NVIDIA para programar sus GPUs, desde 2007: compilador, *runtime* y bibliotecas (cuBLAS, cuDNN, NCCL, TensorRT). Lo ves a fondo en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/). Lo que importa para comprar: **casi todo el software de inferencia se escribe primero para CUDA**. vLLM, SGLang y TensorRT-LLM tienen sus mejores *kernels* (las rutinas que corren en la GPU) en CUDA; un formato nuevo de cuantización suele llegar primero a CUDA; los ejemplos, los errores resueltos en internet y la gente que sabe operar una GPU, también. Comprar NVIDIA es comprar el camino más transitado.

[[rocm|ROCm]] es la plataforma equivalente de AMD, de código abierto. Funciona, y con las Instinct grandes (MI300X y sucesoras) hay despliegues serios. Pero el camino es más estrecho, y hay que mirarlo antes de comprar:

- **Qué GPUs soporta cada versión.** La matriz de compatibilidad de ROCm 10.2.0, la versión que AMD publicó el 18 de noviembre de 2026, lista las Instinct MI355X, MI350X, MI325X, MI300X, MI250 y MI210, y las Radeon AI PRO R9700 y la serie PRO W7000 (la W7900 incluida), entre otras. Una tarjeta fuera de la lista puede funcionar a medias o no funcionar.
- **Qué sistemas operativos.** Versiones concretas de Ubuntu, RHEL, Debian y SLES; Windows solo para las Radeon (y los Ryzen con gráficos integrados), nunca para las Instinct.
- **Qué soporta el servidor de inferencia.** vLLM corre en ROCm con las Instinct MI200, MI300 y MI350, y con Radeon RX 7900 y RX 9000, con paquetes de Python ya compilados (*wheels*) e imágenes de Docker propias. Funciona, pero con una ventana de versiones y de GPUs más estrecha que en CUDA.

ROCm cambia de versión cada pocos meses, y sus páginas no siempre se actualizan juntas: el 25 de noviembre de 2026 la página de requisitos del sistema todavía hablaba de la 7.14.0 mientras las notas de versión y la matriz ya iban en la 10.2.0. La regla no es aprenderse un número: **antes de comprar una GPU de AMD, abre la matriz de compatibilidad de la versión que vas a instalar y busca tu tarjeta, tu sistema operativo y tu servidor de inferencia en la misma fila**.

[[mlx|MLX]] es el marco de Apple para sus chips: una biblioteca de arreglos con una API de Python parecida a NumPy, que aprovecha que en una Mac la CPU y la GPU comparten la memoria (sin copiar datos de una a otra). Junto con llama.cpp, que usa Metal (la interfaz gráfica de Apple), es como se corren LLMs en una Mac. Lo que **no** hay en una Mac: CUDA, ni el vLLM oficial de GPU. vLLM tiene un soporte experimental para macOS que solo usa la CPU; para la GPU existe un complemento de la comunidad («vllm-metal») sobre MLX.

:::analogia Comprar un coche eléctrico antes de que haya cargadores
Un coche eléctrico puede ser mejor que uno de gasolina en todo, y aun así no servirte si en tu carretera no hay dónde cargarlo. CUDA son las gasolineras de cada esquina; ROCm, una red de cargadores que crece y que ya cubre las autopistas principales; MLX, el cargador de tu casa: perfecto para ti, inútil para una flotilla.

Dónde se rompe: los cargadores no dependen de ti, pero el software sí puedes probarlo antes. Renta una hora de la GPU de AMD en la nube y corre tu modelo con tu servidor de inferencia antes de firmar la compra.
:::

:::ojo
La pregunta no es «¿corre en AMD?», es «¿corre **mi** modelo, en **mi** formato de cuantización, con **mi** servidor de inferencia, a la velocidad que necesito, en esta tarjeta?». El despacho usa INT4 de [[awq|AWQ]] en vLLM: hay que comprobar esa combinación exacta en la GPU que se vaya a comprar.
:::

## Las alternativas, una por una {The alternatives, one by one}

El sizing del despacho se hizo con L40S porque era el primer candidato por memoria. Con la misma herramienta de sizing y otras GPUs de gpus.json, el cuadro cambia. La cuenta que más pesa es la del prefill, porque es la que deja a la L40S fuera del objetivo de 2 s.

:::formula Lo que tarda el prefill de una pregunta
t_{pre} = frac{2 × P × N_p}{η_c × F}
- P: los parámetros del modelo (32,762 millones en Qwen3 32B)
- N_p: los tokens de la pregunta (≈ 6,000 en el despacho)
- 2 × P × N_p: los FLOPs del prefill en las capas lineales (2 por parámetro por token)
- F: el pico denso de la GPU en FP16, en FLOPs por segundo (los pesos en INT4 se calculan en 16 bits)
- η_c: la eficiencia del cálculo (0.5 en el despacho, supuesta)
- t_{pre}: el prefill, en segundos; la herramienta de sizing le suma la atención y da un poco más
:::

:::cuenta El prefill del despacho en tres tarjetas PCIe
FLOPs del prefill, \(2 × P × N_p\) | 2 × 32.762 × 10⁹ × 6,000 | ≈ 3.93 × 10¹⁴
L40S, \(t_{pre}\) // \(F\) = 362.05 TFLOPS | 3.93 × 10¹⁴ ÷ (0.5 × 362.05 × 10¹²) | ≈ 2.17 s (la herramienta: 2.38 s)
RTX PRO 6000, \(t_{pre}\) // \(F\) = 503.8 TFLOPS, Workstation Edition; la Server Edition sería ≈ la misma | 3.93 × 10¹⁴ ÷ (0.5 × 503.8 × 10¹²) | ≈ 1.56 s (la herramienta: 1.71 s)
H100 PCIe, \(t_{pre}\) // \(F\) = 756.5 TFLOPS | 3.93 × 10¹⁴ ÷ (0.5 × 756.5 × 10¹²) | ≈ 1.04 s (la herramienta: 1.14 s)
= La L40S no cumple los 2 s ni con la GPU vacía. La PRO 6000 y la H100 PCIe sí, con margen para la fila de la hora pico.
:::

### NVIDIA RTX PRO 6000 Blackwell: la alternativa fuerte

Es la tarjeta que más cambia la decisión del despacho. La Workstation Edition, la de gpus.json, trae 96 GB, 1,792 GB/s, 503.8 TFLOPS en FP16 y [[fp4|FP4]] con hardware propio, a ≈ US$16,399. Con la herramienta de sizing y los números del despacho, **una sola** aguanta ≈ 7 conversaciones a 20 tokens por segundo con un TTFT de ≈ 1.7 s, y el despacho tiene ≈ 5.6 a la vez: la herramienta pide 1 GPU, donde con L40S pide 3. La que va en el rack es la Server Edition: con sus 1,597 GB/s y ≈ 500 TFLOPS, la misma herramienta da ≈ 6 conversaciones por tarjeta y el mismo TTFT, ≈ 1.7 s, y sigue pidiendo 1. Para las 8 de diseño, y para tener una de repuesto, serían 2 de cualquiera de las dos.

Las cautelas son tres. La Server Edition no tiene precio publicado en el catálogo: el de US$16,399 es de la Workstation, y la de rack hay que cotizarla. Las cifras de cálculo salen de NVIDIA (el whitepaper de la Workstation y la página de la Server Edition), no de una medición con el modelo del despacho. Y la arquitectura es más nueva que la de la L40S: hay que comprobar que el formato y el servidor de inferencia del despacho le saquen todo. Por eso es **una alternativa para el piloto**, no una compra a ciegas: gpus.json trae una renta de ≈ US$2.69 por hora en RunPod, así que el despacho puede medirla una semana antes de decidir.

### H100 PCIe, H100 NVL y H200

La H100 PCIe (80 GB, 2,000 GB/s, 350 W) cumple el TTFT con holgura y cuesta ≈ US$28,995 por tarjeta. La H100 NVL (94 GB, 3,900 GB/s) se une de dos en dos con puentes NVLink y trae 5 años de NVIDIA AI Enterprise incluidos, pero cuesta ≈ US$59,500 en revendedor. La H200 del catálogo es la SXM, así que es un servidor HGX (existe una H200 NVL en tarjeta PCIe, que no está en gpus.json). Para el despacho, cualquiera de estas sobra: son para modelos más grandes (un 70B en FP8) o para muchos más usuarios.

### AMD: Instinct y Radeon

Las Instinct (MI300X de 192 GB, MI325X de 256 GB, MI355X de 288 GB) son las GPUs con más memoria por chip del catálogo, pero solo vienen en plataformas de 8 por cotización: para el despacho son un HGX con otro nombre. Las Radeon PRO W7900 (48 GB, 295 W, US$3,999) y la Radeon AI PRO R9700 (32 GB, 300 W, US$1,900) son tarjetas de torre baratísimas por GB, pero con mucho menos cálculo: el prefill del despacho en una W7900 tardaría ≈ 6.4 s y en la R9700, ≈ 4.1 s. Sirven para desarrollo, modelos chicos o un piloto barato; no para el TTFT del despacho.

:::profundo La misma comparación, en Python
```python
P, Np, ec, em = 32.762e9, 6000, 0.5, 0.7     # Qwen3 32B, tokens por pregunta, eficiencias
W = 19.32                                     # GB de pesos en INT4 de AWQ
gpus = {  # nombre: (US$, GB, GB/s, TFLOPS FP16 densos), de gpus.json a nov-2026
    "L40S":         (9005,    48,  864, 362.05),
    "PRO 6000 WS":  (16399,   96, 1792, 503.8),   # Workstation Edition
    "H100 PCIe":    (28995,   80, 2000, 756.5),
    "Radeon W7900": (3999,    48,  864, 123),
    "RTX 5090":     (7350,    32, 1792, 209.5),
}
print(f"{'GPU':13}{'US$/GB':>8}{'US$/GB/s':>10}{'prefill s':>10}{'tok/s 1':>9}")
for n, (K, M, B, F) in gpus.items():
    pre = 2 * P * Np / (ec * F * 1e12)       # segundos de prefill
    v1 = em * B / W                           # tokens/s de una conversación sola
    print(f"{n:13}{K/M:>8.0f}{K/B:>10.2f}{pre:>10.2f}{v1:>9.0f}")
```

```salida
GPU            US$/GB  US$/GB/s prefill s  tok/s 1
L40S              188     10.42      2.17       31
PRO 6000 WS       171      9.15      1.56       65
H100 PCIe         362     14.50      1.04       72
Radeon W7900       83      4.63      6.39       31
RTX 5090          230      4.10      3.75       65
```

Lee la tabla por columnas. La W7900 es la más barata por GB y por GB/s, y la más lenta en el prefill. La RTX 5090 escribe tan rápido como la PRO 6000 Workstation (mismo ancho de banda), pero su prefill no cumple y, como verás en la sección de garantía, su licencia no la deja ir a un centro de datos. La columna de «tok/s 1» es una conversación sola, sin las demás: el techo con \(η_m\) = 0.7, no lo que ve cada persona con 8 a la vez.
:::

## En el escritorio: Mac Studio, DGX Spark y DGX Station {On the desk: Mac Studio, DGX Spark and DGX Station} [extra]

Hay una cuarta familia que no es ni torre con tarjetas ni servidor: **computadoras de escritorio completas con [[memoria-unificada|memoria unificada]]**, donde la CPU y la GPU comparten una sola memoria grande. Son la forma más barata de tener cientos de GB al alcance de la GPU.

- **Mac Studio con M5 Ultra**: 256 o 512 GB de memoria unificada a 1,200 GB/s, 480 W máximo continuo, ≈ US$10,799 con 256 GB y ≈ US$22,299 con 512 GB (estimados de gpus.json; Apple no publica TFLOPS). Por GB está entre lo más barato del catálogo: ≈ US$42 por GB (la Mac Studio M5 Max de 128 GB, ≈ US$40).
- **NVIDIA DGX Spark**: 128 GB unificados a 273 GB/s, una fuente de 240 W, US$6,950 tras la subida de octubre de 2026. Corre CUDA.
- **NVIDIA DGX Station (GB300)**: una GPU Blackwell Ultra y una CPU Grace, 252 GB de HBM3e (la memoria rápida junto a la GPU) más 496 GB de LPDDR5X (la de la CPU), 748 GB coherentes según NVIDIA, 1,600 W y un circuito de 20 amperes. NVIDIA no publica precio; un listado de Supermicro la mostraba en ≈ US$92,887 en septiembre de 2026, sin fecha de entrega.

¿Le sirve una Mac Studio al despacho? La memoria sobra. El decode se puede acotar: el techo de una conversación es el ancho de banda entre los pesos, 1,200 ÷ 19.32 ≈ 62 tokens por segundo, ≈ 43 con \(η_m\) = 0.7. El problema es el prefill. Apple no publica su cálculo, pero el benchmark oficial de llama.cpp en Apple Silicon da para un M5 Ultra ≈ 4,945 tokens por segundo de prefill con Llama 2 7B (6.74 mil millones de parámetros) en Q4_0, un formato de 4 bits de llama.cpp. Con un modelo ≈ 4.9 veces más grande, una extrapolación burda da ≈ 1,000 tokens por segundo: **≈ 6 s** para las 6,000 tokens de una pregunta, tres veces el objetivo. No es un dato medido, es una cuenta para ver el orden de magnitud, y apunta lejos de los 2 s.

Además, una Mac no es un servidor de rack: no tiene [[fuente-redundante|fuentes redundantes]] ni [[bmc|tarjeta de gestión remota]], y montarla en un rack pide un soporte de terceros (hay de 3U para una o dos Mac Studio; revisa que sea para tu modelo). Es una máquina excelente para un desarrollador que prueba modelos grandes en su escritorio, o para una oficina chica con pocas personas y prompts cortos. La DGX Spark juega el mismo papel con CUDA: un laboratorio personal, con poco ancho de banda (273 GB/s) para servir a 200 personas.

## Garantía, entrega y refacciones {Warranty, lead time and spares}

La ficha técnica dice qué hace el equipo el día que llega. Tres cosas que no vienen en ella dicen qué pasa los siguientes cinco años.

### La garantía: leer qué cubre y por cuánto

La [[garantia-de-hardware|garantía de hardware]] es el compromiso del vendedor de reparar o cambiar lo que falle, por un plazo. «3 años» puede querer decir cosas muy distintas. La garantía estándar de Supermicro para sus servidores de GPU, por ejemplo, es **3 años de mano de obra, 1 año de piezas y 1 año de *cross-ship* avanzado**. *Cross-ship* avanzado quiere decir que te mandan la pieza de reemplazo **antes** de que devuelvas la descompuesta: el equipo vuelve a funcionar en días, no en semanas. Del segundo año en adelante, la pieza la pagas tú. La de la workstation de Exxact, en cambio, dice 3 años en piezas y mano de obra. Los OEM grandes venden contratos de servicio aparte: técnico en sitio al siguiente día hábil, soporte 24 × 7, un gerente técnico de cuenta.

Las preguntas que el despacho debe hacer, por escrito, antes de comprar:

1. ¿Cuántos años de **piezas**, no solo de mano de obra?
2. ¿Las GPUs las cubre el integrador o hay que reclamarle al fabricante?
3. ¿Mandan la pieza antes (*cross-ship*) o hay que enviar la descompuesta primero?
4. ¿Hay técnico en sitio en la Ciudad de México, o el equipo viaja?
5. ¿La garantía sigue vigente si el equipo se importa? (La importación y la aduana las ve la lección «Cotizar, proponer y dar soporte».)

### El tiempo de entrega

El [[tiempo-de-entrega|tiempo de entrega]] de una GPU depende de cuál. Para los sistemas más grandes de 2026 ha sido de muchos meses: un artículo que cita el reporte trimestral de NVIDIA de abril de 2026 dice que la empresa «ha experimentado» plazos extendidos de más de 12 meses, y que la capacidad de sistemas Blackwell grandes estaba reservada hasta mediados de año. En el otro extremo, el 25 de noviembre de 2026 la tienda de Supermicro mostraba un servidor de 4U con 4 RTX PRO 6000 «en stock» y con envío en 24 horas. Las tarjetas PCIe de un escalón abajo se consiguen; las placas HGX de la generación más nueva se esperan.

Para el despacho, el tiempo de entrega no frena el proyecto: la prueba piloto corre en una GPU rentada, y puede seguir rentada mientras llega el equipo. Tres L40S rentadas a US$1.09 la hora cada una (la más barata de gpus.json) cuestan ≈ US$2,387 al mes las 730 horas: un puente caro si dura un año, barato si dura seis semanas.

:::profundo Refacciones y segunda mano
Además de las GPUs, en un servidor fallan las piezas que se mueven o se desgastan: ventiladores, fuentes y discos. Con [[fuente-redundante|fuentes redundantes]] y un par de discos en espejo, una falla no tumba el servicio, pero hay que reponer la pieza. Un equipo de TI chico debería tener **en el cuarto** una fuente y un ventilador de repuesto, o un contrato que los traiga al día siguiente.

El mercado de reacondicionados (*refurbished*) es real: en gpus.json hay L40S reacondicionadas desde US$6,420 y A100 descontinuadas que solo existen así. Ahorran dinero a cambio de una garantía corta y de no saber cuántas horas trae la tarjeta. Para un servicio que 200 personas usan a diario, el ahorro rara vez compensa.
:::

:::ojo
Las GeForce (RTX 4090, RTX 5090) están entre las tarjetas más baratas por GB/s del catálogo, y por eso tientan. Pero la licencia del software de GeForce de NVIDIA (el driver) dice que **no tiene licencia para uso en centro de datos** (*«not licensed for datacenter deployment»*), salvo minería de criptomonedas. La cláusula es sobre el software, no la tarjeta, y no define qué es un centro de datos. Un servidor en un rack que atiende a toda una empresa se parece mucho a uno. Si tu cliente es una empresa, usa tarjetas profesionales o de centro de datos.
:::

## La decisión del despacho {The despacho's decision}

Con todo junto, el despacho puede pasar de «3 L40S» a una orden de compra. El diagrama de abajo es el camino de preguntas, en el orden en que conviene hacerlas.

:::diagrama comprar-hardware-decision
Toca cada pregunta para ver qué la decide. El recorrido sigue al despacho; los otros caminos llevan a una workstation, a una Mac o a un HGX.
:::

La decisión, con sus razones:

1. **Un servidor de rack, no una torre.** El servicio es para 200 personas, todos los días, en un cuarto de TI: necesita [[fuente-redundante|fuentes redundantes]], gestión remota y el flujo de aire que piden las tarjetas pasivas. Una torre es para un equipo de desarrollo, no para un servicio.
2. **Un servidor de 2U o 4U con al menos 4 ranuras de doble ancho, certificado por NVIDIA y armado por un integrador.** Las 2 personas de TI no han operado una GPU: el equipo debe llegar probado, con una sola garantía y alguien que conteste. Comprar las tarjetas sueltas no ahorra.
3. **NVIDIA, por el software.** El despacho sirve Qwen3 32B en INT4 de [[awq|AWQ]] con vLLM; el camino más transitado para esa combinación es CUDA. AMD tendría sentido con un modelo mucho más grande y alguien en el equipo que ya opere ROCm.
4. **Dos cotizaciones para las tarjetas, y que decida el piloto.** Una con 3 L40S y la cuarta ranura libre (≈ US$67,191 en el configurador de Exxact; el sizing de la ficha). Otra con 2 RTX PRO 6000 Server Edition, la variante pasiva para rack, que en la cuenta cumple el TTFT de 2 s que la L40S no cumple y trae 192 GB en vez de 144 (su precio no está en el catálogo: se cotiza). La PRO 6000 se renta: una semana del piloto en ella dice si la cuenta se cumple con el modelo y el examen del despacho.
5. **Garantía de piezas por escrito.** Al menos 3 años de piezas en las GPUs y las fuentes, o un contrato que lo cubra, y una fuente y un ventilador de repuesto en el cuarto.
6. **La licencia de software, opcional.** NVIDIA AI Enterprise cuesta US$18,000 por GPU por 5 años; el despacho puede empezar con el software de código abierto y comprarla si necesita soporte del fabricante.

Lo que falta para cerrar la compra ya no es de esta lección: si el cuarto de TI aguanta la potencia y el calor del servidor (lección «[El cuarto: energía, enfriamiento y red](/el-cuarto/)»), cuánto cuesta al año con luz, personas y depreciación ([[tco|TCO]], en la herramienta [API, nube o servidor propio](/herramientas/tco/)), y cómo se cotiza, se importa y se le da soporte («Cotizar, proponer y dar soporte»).

## Errores comunes {Common mistakes}

1. **Comprar una tarjeta pasiva para una torre.** La L40S y la RTX PRO 6000 Server Edition no traen ventilador: en una torre de oficina se calientan hasta frenarse. **Cómo evitarlo:** mira la columna de enfriamiento de la hoja; pasiva va en un servidor hecho para ella, activa en una torre.
2. **Comparar la cifra de la portada.** Los TFLOPS «con sparsity» son el doble de los útiles, y un precio de SXM incluye un servidor entero. **Cómo evitarlo:** usa los TFLOPS densos y compara tarjeta con tarjeta o equipo con equipo, como hace el [catálogo](/herramientas/catalogo/).
3. **Sumar los TDP y olvidar el voltaje.** Una fuente de servidor de 2,600 W a 220 V entrega 1,000 W a 127 V. Cuatro tarjetas de 600 W no caben a 127 V en un servidor que sí las aguanta a 220 V. **Cómo evitarlo:** pide al integrador la capacidad de las fuentes **al voltaje de tu contacto** y calcula \(u = P_{eq} ÷ P_{fuente}\).
4. **Leer «3 años de garantía» como 3 años de piezas.** La estándar de Supermicro es 3 de mano de obra y 1 de piezas. **Cómo evitarlo:** pregunta por escrito años de piezas, quién cubre las GPUs y si mandan el reemplazo antes.
5. **Comprar AMD o Apple por el precio por GB, sin probar el software.** Una GPU fuera de la matriz de ROCm, o un servidor de inferencia que no corre en Metal, deja el equipo parado. **Cómo evitarlo:** renta una hora o pide una demo, y corre **tu** modelo, en **tu** formato, con **tu** servidor de inferencia antes de comprar.
6. **Poner GeForce en el rack de una empresa.** La licencia del driver de GeForce no cubre centros de datos. **Cómo evitarlo:** para un servicio de empresa, tarjetas profesionales (RTX PRO) o de centro de datos (L40S, H100).
7. **Comprar justo lo del sizing, sin ranura de más.** Si la [[prueba-de-carga|prueba de carga]] pide una tarjeta más, toca cambiar de caja. **Cómo evitarlo:** un servidor con una ranura libre cuesta lo mismo que uno lleno a la medida.

## En la vida real {In real life}

**El despacho.** Pasa de «3 L40S» a pedir dos cotizaciones de un servidor de rack de 2U o 4U, certificado, armado por un integrador, con al menos 4 ranuras: una con 3 L40S (≈ US$67,191 en el configurador de Exxact, con la cuarta ranura libre) y otra con 2 RTX PRO 6000 Server Edition. El piloto en GPU rentada decide entre las dos: la L40S es la opción del sizing; la PRO 6000 cumple en la cuenta el TTFT de 2 s que la L40S no alcanza. Las 2 personas de TI reciben el equipo probado, con una sola garantía de piezas por escrito y repuestos de fuente y ventilador en el cuarto.

**Un equipo de investigación de una universidad.** Supuesto del ejemplo: cinco investigadores que prueban modelos de 70 mil millones de parámetros y los ajustan. No dan servicio a nadie más, trabajan de día y no tienen cuarto de servidores. Su compra es una **workstation** con 2 RTX PRO 6000 Max-Q (192 GB, 600 W de GPUs, una fuente de escritorio con holgura) o una Mac Studio de 512 GB si solo prueban inferencia. Aquí la torre es correcta: una sola máquina, gente que la tiene a la mano, y un apagón que no deja sin servicio a nadie.

**Un proveedor de IA privada para muchos clientes.** Supuesto del ejemplo: una empresa que sirve un modelo de 70 mil millones en FP8 a varios cientos de usuarios de distintos clientes, en un centro de datos. Aquí el escalón es un **HGX de 8 H100 o H200**: el modelo se reparte entre varias GPUs unidas por NVLink, y el costo por GPU del servidor (≈ US$38,269 en el de 8 H100 de Exxact) se paga con muchos usuarios. Este cliente sí necesita el contrato de soporte del fabricante y probablemente la licencia de software, porque una caída le cuesta clientes.

**Una fábrica con visión y un asistente para mantenimiento.** Supuesto del ejemplo: un modelo chico (8 mil millones) que contesta preguntas de los manuales a 30 técnicos, en una planta sin cuarto de TI con aire acondicionado. Una o dos tarjetas de 48 GB activas en una torre industrial, o una L4 de 72 W en un servidor chico, bastan: lo que manda aquí es el calor y el polvo, no los TFLOPS.

**Fuera de las computadoras: el horno de una panadería.** Una panadería no compra «tres resistencias de horno»: compra un horno, con su ventilación, su conexión de gas o de 220 V, su garantía y un técnico que vaya cuando falle. El horno de una casa no sirve para hornear 2,000 bolillos al día, y el industrial no cabe en la cocina de una casa. La resistencia es la GPU; el horno es el servidor; la cocina es el cuarto.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una Radeon PRO W7900 cuesta US$3,999, tiene 48 GB y 864 GB/s. ¿Cuánto cuesta por GB y por GB/s? Compárala con la L40S (US$187.6 por GB y US$10.42 por GB/s).
\(c_M = K ÷ M\) = 3,999 ÷ 48 ≈ **US$83.3 por GB**. \(c_B = K ÷ B\) = 3,999 ÷ 864 ≈ **US$4.63 por GB/s**. Es ≈ 2.3 veces más barata que la L40S en las dos cifras, con la misma memoria y el mismo ancho de banda. Lo que no sale en esas dos cifras: tiene ≈ 123 TFLOPS en FP16 contra 362.05, así que su prefill es casi 3 veces más lento, y corre en ROCm, no en CUDA.
? [facil] Un rack de 42U, ¿cuántos servidores de 4U le caben, y cuántas U sobran? ¿Qué altura útil tiene en metros?
⌊42 ÷ 4⌋ = **10 servidores**, que ocupan 40U; sobran **2U** (por ejemplo, para un switch de red de 1U y una charola). Altura útil: 42 × 44.45 mm = 1,866.9 mm ≈ **1.87 m**.
? [facil] ¿Cuánto suma el TDP de las GPUs en el servidor de 4 L40S, en uno de 8 H100 SXM y en uno de 8 B200?
4 × 350 = **1,400 W**; 8 × 700 = **5,600 W**; 8 × 1,000 = **8,000 W**. Solo las GPUs: falta sumar CPUs, RAM, discos y ventiladores. El salto de 1,400 a 8,000 W es la razón por la que el HGX no se enchufa en un cuarto de oficina.
? [facil] El despacho quiere NVIDIA AI Enterprise para sus 3 L40S. ¿Cuánto cuesta por 1 año y por 5 años, con los precios de lista?
1 año: 3 × US$4,500 = **US$13,500**. 5 años: 3 × US$18,000 = **US$54,000**, «cinco por el precio de cuatro» (5 años sueltos serían 5 × 13,500 = 67,500). Con 4 L40S serían 4 × 18,000 = US$72,000. Es opcional: vLLM y el driver corren sin ella.
? [medio] Una torre con fuente de 1,600 W y 350 W para el resto del equipo. ¿Caben 2 RTX PRO 6000 Workstation Edition (600 W)? ¿Y 3 Max-Q (300 W)? Usa \(u ≤ 0.8\).
Dos Workstation: \(P_{eq}\) = 2 × 600 + 350 = 1,550 W; \(u\) = 1,550 ÷ 1,600 ≈ **0.97**: no, se pasa de 0.8. Tres Max-Q: \(P_{eq}\) = 3 × 300 + 350 = 1,250 W; \(u\) = 1,250 ÷ 1,600 ≈ **0.78**: sí, justo debajo. Tres Max-Q dan 288 GB de VRAM con menos potencia que dos Workstation Edition (192 GB).
? [medio] El servidor 4U de Exxact tiene 4 fuentes de 3,000 W en «3 + 1», que entregan 1,000 W cada una a 127 V y 2,600 W a 220 V. Con 400 W para el resto, ¿cuántas L40S como máximo aguanta a 127 V con \(u ≤ 0.8\)?
A 127 V: \(P_{fuente}\) = (4 − 1) × 1,000 = 3,000 W; el límite es 0.8 × 3,000 = 2,400 W. Para las GPUs quedan 2,400 − 400 = 2,000 W; 2,000 ÷ 350 ≈ 5.7 → **5 L40S**. A 220 V: 0.8 × 7,800 − 400 = 5,840 W → 16 por potencia, así que manda el número de ranuras del chasis (equipos.json anota hasta 10, sin verificar el tope). El voltaje del contacto decide cuántas tarjetas aguanta el mismo servidor.
? [medio] Con el servidor Exxact (base US$40,461.30, US$8,910 por L40S), compara 3 L40S contra 4. ¿Cuánto cuesta cada una y cuánto cuesta cada GB de VRAM del equipo completo?
3: 40,461.30 + 3 × 8,910 = **US$67,191.30** para 144 GB → ≈ **US$466.6 por GB**. 4: 40,461.30 + 4 × 8,910 = **US$76,101.30** para 192 GB → ≈ **US$396.4 por GB**. El servidor base se reparte entre más tarjetas: la cuarta cuesta 13 % más en total y baja el costo por GB 15 %. Fíjate en que por GB el equipo completo cuesta más del doble que la tarjeta sola (US$187.6): el servidor no es gratis.
? [medio] Calcula el prefill de una pregunta del despacho (6,000 tokens, Qwen3 32B, \(η_c\) = 0.5) en una RTX 5090 (209.5 TFLOPS) y en una H100 NVL (835.5 TFLOPS). ¿Cuál cumple el TTFT de 2 s?
FLOPs: 2 × 32.762 × 10⁹ × 6,000 ≈ 3.93 × 10¹⁴. RTX 5090: 3.93 × 10¹⁴ ÷ (0.5 × 209.5 × 10¹²) ≈ **3.75 s**: no cumple. H100 NVL: 3.93 × 10¹⁴ ÷ (0.5 × 835.5 × 10¹²) ≈ **0.94 s**: cumple con mucho margen. Y aunque la 5090 cumpliera, su licencia de GeForce no la deja ir a un centro de datos.
? [reto] Una Mac Studio M5 Ultra (1,200 GB/s) sirve Qwen3 32B en INT4 de [[awq|AWQ]] (19.32 GB). (a) ¿Cuál es el techo de tokens por segundo de una conversación sola con \(η_m\) = 0.7? (b) llama.cpp mide ≈ 4,945 tokens por segundo de prefill con un modelo de 6.74 mil millones en Q4_0. Suponiendo que el prefill escala con los parámetros, ¿cuánto tardaría la pregunta de 6,000 tokens? (c) ¿Le sirve al despacho?
(a) 0.7 × 1,200 ÷ 19.32 ≈ **43 tokens/s**: más de los 20 que pide el despacho, con una conversación. (b) El modelo es 32.762 ÷ 6.74 ≈ 4.86 veces más grande: 4,945 ÷ 4.86 ≈ 1,017 tokens/s; 6,000 ÷ 1,017 ≈ **5.9 s** (optimista: con 6,000 tokens la atención pesa más que con 512). (c) No para el objetivo de 2 s: el prefill tarda ≈ 3 veces de más, y eso con una sola pregunta. La memoria sobra; el cálculo no alcanza. Es una extrapolación, no una medición: lo honesto es medirla.
? [reto] El servidor del despacho tarda 12 semanas en llegar. El piloto terminó y los abogados ya lo usan en 3 L40S rentadas a US$1.09 la hora cada una. ¿Cuánto cuesta el puente, y qué fracción del servidor de US$67,191.30 es? ¿Y si tardara 12 meses?
12 semanas ≈ 12 × 7 × 24 = 2,016 horas; 3 × 1.09 × 2,016 ≈ **US$6,592**, ≈ **9.8 %** del servidor. 12 meses: 3 × 1.09 × 730 × 12 ≈ **US$28,646**, ≈ 43 % del servidor. Con plazos cortos, rentar mientras llega es barato; con plazos de un año, el tiempo de entrega pesa en la decisión y conviene elegir un equipo que esté en stock.
? [reto] Con la herramienta de sizing, una RTX PRO 6000 Workstation atiende ≈ 7 conversaciones del despacho a 20 tokens por segundo, una Server Edition ≈ 6 y una L40S ≈ 2. Compara el costo de las tarjetas para cubrir las 8 conversaciones de diseño, con los precios de gpus.json (US$16,399 la PRO 6000 Workstation, US$9,005 la L40S). ¿Qué falta en la cuenta para decidir?
PRO 6000: ⌈8 ÷ 7⌉ = **2 tarjetas**, y con la Server Edition ⌈8 ÷ 6⌉ = 2 también; 2 × 16,399 = **US$32,798**. L40S: ⌈8 ÷ 2⌉ = **4 tarjetas** = 4 × 9,005 = **US$36,020**. La PRO 6000 sale ≈ US$3,222 más barata en tarjetas, con TTFT bajo 2 s y la misma memoria (192 GB en los dos casos). Falta: el precio real de la **Server Edition** (el de gpus.json es de la Workstation), el del servidor que la acepte, que el formato y el servidor de inferencia del despacho le saquen su cálculo (se mide en el piloto), la garantía y el tiempo de entrega. La cuenta dice qué cotizar, no qué comprar.
:::

## Lo que sigue {What comes next}

- **«[El cuarto: energía, enfriamiento y red](/el-cuarto/)»**, la siguiente lección de este módulo, toma el servidor que elegiste aquí y pregunta si el cuarto de TI del despacho lo aguanta: los watts se vuelven amperes, BTU por hora y toneladas de aire acondicionado, y la red se vuelve cables.
- **«[De requisitos a hardware](/requisitos-hardware/)»** hace el sizing completo, del que aquí solo se usó el resultado, con picos, colas y márgenes.
- **«[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)»** explica qué pasa cuando un modelo no cabe en una tarjeta y se reparte entre varias, y por qué ahí NVLink pesa tanto.
- **«TCO: API, nube o servidor propio»** convierte el precio del servidor en un costo mensual con luz, personas y depreciación; mientras tanto, la herramienta [API, nube o servidor propio](/herramientas/tco/) ya hace la cuenta.
- **«Cotizar, proponer y dar soporte»** ve la importación, la aduana y cómo se le presenta todo esto a un cliente.
- En Sensei: [CPU y GPU](https://sensei.trueml.app/cpu-gpu/) tiene la memoria HBM, PCIe, NVLink, CUDA y el driver por dentro; [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/), la otra mitad de la decisión: rentar en vez de comprar.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
workstation servidor-gpu unidad-de-rack tdp tarjeta-pasiva hgx oam integrador oem sistema-certificado cuda rocm mlx garantia-de-hardware
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué «3 L40S» no es algo que se pueda pedir tal cual?
Porque una L40S es una tarjeta: necesita un servidor que le dé ranura PCIe, corriente, aire, CPU, RAM y discos, y alguien que dé garantía del conjunto. Lo que se pide es un servidor con 3 L40S.
? ¿Qué diferencia hay entre una tarjeta pasiva y una activa, y dónde va cada una?
La activa trae sus propios ventiladores y va en una torre. La [[tarjeta-pasiva|pasiva]] solo tiene aletas y depende del flujo de aire del chasis de un servidor; en una torre se sobrecalienta. La L40S es pasiva.
? ¿Qué es un HGX y por qué una H100 SXM no se compra suelta?
Una placa base con 8 GPUs SXM unidas por NVLink, que NVIDIA vende a los fabricantes de servidores. La SXM no tiene ranura PCIe: solo existe montada en esa placa, dentro de un servidor de 8.
? ¿Por qué comprar las L40S sueltas no le ahorra dinero al despacho?
Porque el integrador cobra por tarjeta casi lo mismo que la tienda (US$8,910 contra ≈ US$9,005), y el servidor base se paga igual en los dos caminos. Lo que se pierde suelto es la prueba, la garantía única y la combinación certificada.
? ¿Qué hay que revisar antes de comprar una GPU de AMD?
La matriz de compatibilidad de la versión de ROCm que vas a instalar: que estén tu tarjeta, tu sistema operativo y tu servidor de inferencia, y probar tu modelo en tu formato antes de comprar.
? ¿Qué quiere decir «3 años de mano de obra, 1 año de piezas»?
Que durante 3 años el fabricante pone el trabajo de la reparación, pero solo el primer año paga la pieza; del segundo en adelante, la pieza la pagas tú.
? ¿Por qué la RTX PRO 6000 es una alternativa seria para el despacho?
Porque es más barata por GB y por GB/s que la L40S, y su cálculo hace el prefill de una pregunta en ≈ 1.6 s, dentro de los 2 s que la L40S no cumple. Falta medirla en el piloto y cotizar la Server Edition.
:::
