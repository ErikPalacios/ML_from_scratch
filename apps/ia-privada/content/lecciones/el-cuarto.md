---
titulo: El cuarto: energía, enfriamiento y red
en: The room: power, cooling and network
subtitulo: Cuántos watts jala un servidor con GPUs, cómo se vuelven amperes y calor, qué circuito, qué UPS y qué aire hacen falta en una oficina de la Ciudad de México, cuánto cuesta la luz con la tarifa de CFE, qué red necesita y cuándo conviene llevarlo a un centro de datos.
pregunta: El despacho no tiene centro de datos: tiene un cuarto de TI con un minisplit y contactos de pared. ¿Cabe ahí un servidor de 4 GPUs, qué hay que cambiar, cuánto cuesta tenerlo prendido y cuándo es mejor rentar un rack en otro lado?
sensei: cpu-gpu, maquinas
---

:::idea
Un [[servidor-gpu|servidor con GPUs]] es, para el edificio, una **plancha prendida todo el día**: jala del orden de 2.5 kW, y cada uno de esos watts termina como calor en el cuarto. La luz que entra pide un **circuito propio a 220 V**, porque a 127 V los amperes no caben en un contacto normal. Para la luz que se va hace falta un **UPS**, que da minutos para apagar bien, no horas. El calor que sale pide un aire que funcione 24 horas y que no sea el único. La red, en cambio, casi no pesa para los usuarios; lo delicado es el puerto de gestión del servidor. Y si el cuarto no da para todo eso, existe la opción de rentar un rack en un centro de datos.
:::

## El cuarto del despacho {The despacho's room}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus 30,000 expedientes con un LLM sin que un solo documento salga de su red. Lo usarían 200 abogados y asistentes, de 9:00 a 19:00. Su modelo es **Qwen3 32B en INT4 de [[awq|AWQ]]** y su sizing pide **3 × NVIDIA L40S**, y 4 si quiere que las 8 conversaciones de diseño vayan todas a 20 tokens por segundo o más. Su equipo de TI son 2 personas que saben de redes y Windows y nunca han operado una GPU.

Esas GPUs viven en un servidor de 4U, la altura de cuatro [[unidad-de-rack|unidades de rack]] (un rack es el mueble estándar donde se atornillan los servidores; cada unidad mide 1.75 pulgadas). El de referencia es el Exxact de 4 L40S de `equipos.json`, que cuesta ≈ US$76,101 sin impuestos a noviembre de 2026. Qué servidor se compra y por qué lo ve la lección «[Comprar hardware: de la workstation al rack](/comprar-hardware/)». Aquí la pregunta es otra: **¿dónde se pone?**

El despacho tiene un cuarto de TI. Para esta lección se suponen estos datos del ejemplo:

- Mide ≈ 3 × 3 m (9 m²) y 2.5 m de alto, sin ventanas, en el mismo piso que las oficinas.
- Hoy tiene un rack con el switch, el firewall, un NAS (un disco en red para archivos) y un servidor de archivos: ≈ 500 W en total.
- Solo tiene contactos de pared de **127 V y 15 A**. El edificio recibe servicio trifásico de 220/127 V, y en el tablero del piso hay lugar para interruptores nuevos.
- El aire central del edificio se apaga de noche y en fines de semana. El cuarto tiene un **minisplit de confort de 1 tonelada**, el mismo tipo de aparato que se pone en una recámara.
- El edificio tiene planta de emergencia solo para elevadores y áreas comunes.

### Volts, amperes y watts

Antes de hacer cuentas, tres palabras. La **[[potencia-electrica|potencia eléctrica]]** (*electrical power*) es cuánta energía por segundo consume un aparato. Se mide en **watts** (W): un watt es un joule por segundo. Un foco LED jala ≈ 10 W; una plancha, ≈ 1,000 W; el servidor del despacho, ≈ 2,500 W. Un **kilowatt-hora** (kWh) es la energía de jalar 1,000 W durante una hora: es lo que cobra CFE.

La potencia sale de dos cosas que se miden en el cable. El **voltaje** (V, en volts) es el «empuje» con que la red mueve la electricidad. La **corriente** (I, en amperes, A) es cuánta electricidad pasa por segundo. Cada cable y cada interruptor aguantan cierta corriente antes de calentarse: por eso los amperes son lo que limita una instalación, no los watts.

:::analogia La manguera
Piensa en una manguera. El voltaje es la presión del agua; los amperes, cuánta agua pasa por segundo; los watts, el trabajo que hace el chorro. Con más presión, la misma potencia necesita menos agua: por eso un aparato de 2,500 W pide casi el doble de amperes a 127 V que a 220 V. Y una manguera delgada (un cable delgado) revienta si le metes demasiada agua, sin importar la presión.

Dónde se rompe: el agua se acaba y la electricidad no se «gasta» en el cable. Lo que se consume es energía, y toda termina como calor. Además, en corriente alterna el voltaje y la corriente suben y bajan 60 veces por segundo, y no siempre van parejos: de eso sale el factor de potencia de abajo.
:::

:::formula Potencia de un aparato en corriente alterna
P = V × I × f_p
- P: la potencia real que consume, en watts (W)
- V: el voltaje, en volts (V): 127 o 220 en una oficina de México
- I: la corriente, en amperes (A)
- f_p: el [[factor-de-potencia|factor de potencia]], entre 0 y 1: qué parte de lo que viaja por el cable se vuelve trabajo. Las fuentes de servidor modernas andan en 0.9 o más
:::

El **[[factor-de-potencia|factor de potencia]]** existe porque algunos aparatos jalan corriente a destiempo del voltaje. El cable carga esa corriente aunque no haga trabajo. Lo que viaja por el cable se mide en **volt-amperes** (VA, \( V × I \)); lo que se consume de verdad, en watts. Una fuente vieja de PC andaba en ≈ 0.6–0.75; las de servidor con corrección de factor de potencia (PFC), en 0.9 o más. Esta lección usa **0.95**, la cifra que NVIDIA da para sus DGX (sus propios servidores de 8 GPUs), como supuesto para el servidor del despacho.

## Cuánta potencia jala el servidor {How much power the server draws}

Un servidor no trae una etiqueta de «consumo». Trae piezas, y cada pieza tiene un tope. El de una GPU es su **[[tdp|TDP]]** (*thermal design power*): la potencia máxima que el fabricante diseñó para que la tarjeta disipe trabajando a fondo. La TDP de cada GPU está en `gpus.json`; la de la L40S es **350 W** según la hoja de NVIDIA. La L40S, además, es una tarjeta **[[tarjeta-pasiva|pasiva]]**: no trae ventilador propio y depende del aire que empujen los ventiladores del chasis. Eso importa en la sección del calor.

El resto del servidor también jala:

- **La CPU.** El Exxact trae 2 AMD EPYC 9124 de 16 núcleos. AMD les da un TDP por omisión de ≈ 200 W cada uno (configurable a 240 W).
- **Todo lo demás.** 384 GB de RAM, discos, tarjetas de red y, sobre todo, ventiladores que giran rapidísimo para empujar aire por las GPUs pasivas. Exxact no publica cuánto suma. Una estimación razonable es **400–700 W**; aquí se usa el extremo alto, 700 W, porque para dimensionar conviene equivocarse hacia arriba.

:::formula Pico de papel de un servidor
P_{pico} = n × T_{GPU} + P_{CPU} + P_{resto}
- n: las GPUs del servidor
- T_{GPU}: el TDP de cada GPU, en W (de `gpus.json`)
- P_{CPU}: el TDP de las CPUs juntas, en W
- P_{resto}: RAM, discos, red y ventiladores, en W (estimado)
- P_{pico}: lo más que jalaría con todo a fondo, en W
:::

:::cuenta El servidor del despacho, lleno
GPUs, \(n × T_{GPU}\) // 4 L40S de 350 W | 4 × 350 | 1,400 W
CPUs, \(P_{CPU}\) // 2 EPYC 9124 de ≈ 200 W | 2 × 200 | 400 W
Resto, \(P_{resto}\) // estimado, el extremo alto | 700 | 700 W
Pico de papel, \(P_{pico}\) | 1,400 + 400 + 700 | **2,500 W**
Con 3 GPUs | 1,050 + 400 + 700 | 2,150 W
= El cuarto se diseña para 2.5 kW: el servidor con sus 4 GPUs. Si arranca con 3, sobran ≈ 350 W de margen, y meter la cuarta no obliga a rehacer el circuito.
:::

Ojo con lo que es ese número: **2,500 W es una estimación derivada**, la suma de las hojas de las piezas más un resto supuesto. Exxact no publica la potencia máxima de este servidor, y nadie la ha medido aquí. Sirve para dimensionar porque se equivoca hacia arriba; el número de verdad sale de medir (abajo).

¿Por qué diseñar para 4 si la ficha dice 3? Porque la cuarta es la que pide la [[prueba-de-carga|prueba de carga]] para que las 8 conversaciones de diseño vayan a 20 tokens por segundo, y porque cambiar un circuito o un UPS después cuesta más que hacerlo una vez.

La lección «[Comprar hardware: de la workstation al rack](/comprar-hardware/)» pide cotizar también **2 RTX PRO 6000 Server Edition** (TDP configurable de 400 a 600 W) en vez de las L40S. Al tope y con el mismo resto: 2 × 600 + 400 + 700 = 2,300 W, abajo de 2,500 W, así que el circuito, el UPS y el aire de esta lección le quedan con algo más de margen. Si ese servidor trae otras CPUs o fuentes, se rehace la cuenta con sus hojas.

### Lo que jala de verdad: menos que el pico, casi nunca el pico

El TDP es un techo, no un consumo. Una medición de 2026 (Golden y otros, «The xPU-athalon», con Llama 3.1 8B en servidores DGX) encontró que el [[prefill|prefill]] consume del 75 al 100 % del TDP de la GPU, que el [[decode|decode]] en A100 y H100 se queda en ≈ 50–60 %, y que en reposo la GPU jala ≈ 20 %. Tiene sentido con lo que sabes: el prefill es cálculo puro y prende todos los núcleos, mientras que el decode pasa casi todo el tiempo esperando a la memoria. Ojo: **no hay una medición publicada de una L40S sirviendo un LLM**. Usar esos porcentajes en la L40S es un supuesto.

:::figura el-cuarto-potencia
Los tres consumos del servidor del despacho, en barras. Arriba, el pico de papel: 2,500 W con las 4 GPUs al tope. En medio, una hora de oficina con las GPUs al 60 % de su TDP (supuesto): ≈ 1,640 W. Abajo, la noche, con las GPUs en reposo: ≈ 830 W. El circuito se dimensiona con la barra de arriba; la luz se paga con las de abajo.
:::

De ahí sale la regla de la lección: **el circuito, el UPS y el aire se dimensionan para el pico; la luz se paga con el promedio**. Si un día todos los abogados preguntan a la vez y el servidor hace prefills sin parar, va a jalar cerca del pico, y el interruptor no puede botarse ese día.

:::ojo
Las **fuentes de poder** del servidor no dicen lo que consume. El Exxact trae 4 fuentes de 3,000 W, y eso no significa que jale 12,000 W. Es la capacidad que el fabricante pone para la configuración más cargada que admite el chasis, con fuentes de sobra por si una falla. El consumo lo deciden las piezas que lleva adentro.
:::

La forma honesta de saber cuánto jala es **medirlo**. Cada GPU reporta su potencia en `nvidia-smi` (lo ves en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/)), el controlador de gestión del servidor (el BMC de la sección de red) da la del equipo entero, y una regleta con medidor (PDU con medición), la del enchufe. Una semana de mediciones con tráfico real vale más que cualquier hoja de datos.

## De watts a amperes: el circuito {From watts to amps: the circuit}

En México, la norma de instalaciones eléctricas es la **NOM-001-SEDE-2012**, que a la fecha sigue siendo la vigente según el registro oficial (su actualización de 2018 nunca entró en vigor). Su artículo 110-4 lista las tensiones que se usan, entre ellas 127 y 220Y/127 V, a 60 Hz. En una oficina: **127 V** entre una fase y el neutro, lo que da un contacto de pared, y **220 V** entre dos fases, lo que usa un minisplit grande. Un servicio trifásico de 220Y/127 da los dos.

Con la fórmula de la potencia despejada se sacan los amperes:

:::formula Corriente que jala un aparato
I = frac{P}{V × f_p}
- I: la corriente, en A
- P: la potencia, en W (para dimensionar, \(P_{pico}\))
- V: el voltaje del circuito, en V
- f_p: el factor de potencia (0.95 en el despacho, supuesto)
:::

### La regla del 125 %

Un interruptor termomagnético (la «pastilla» del tablero) se bota cuando pasa más corriente de la que aguanta el cable. Pero un cable que carga mucha corriente durante horas se calienta más que uno que la carga un rato. Por eso la NOM-001-SEDE-2012 pide, en sus artículos 210-19(a)(1) y 210-20(a), que cuando un circuito alimenta una **carga continua**, el conductor y el interruptor aguanten al menos **el 125 % de esa carga**. Dicho al revés: la carga continua no debe pasar del 80 % del interruptor (1 ÷ 1.25 = 0.8). Es la «regla del 80 %» que repiten los electricistas. Un servidor prendido 24 horas al día es el caso más claro de carga continua que hay.

:::formula Interruptor que pide una carga continua
I_{int} ≥ 1.25 × I
- I_{int}: la corriente nominal del interruptor (15, 20, 30 A…)
- I: la corriente de la carga, de la fórmula de arriba
- 1.25: el 125 % de la NOM-001-SEDE-2012 para cargas continuas
:::

:::cuenta El servidor del despacho a 127 V y a 220 V
Corriente a 127 V, \(I\) // \(P\) = 2,500 W, \(f_p\) = 0.95 | 2,500 ÷ (127 × 0.95) | ≈ 20.7 A
Interruptor a 127 V, \(1.25 × I\) | 1.25 × 20.7 | ≈ 25.9 A
Corriente a 220 V, \(I\) | 2,500 ÷ (220 × 0.95) | ≈ 11.96 A
Interruptor a 220 V, \(1.25 × I\) | 1.25 × 11.96 | ≈ 14.95 A
= A 127 V no cabe ni en un circuito de 20 A. A 220 V, en papel, cabe en uno de 15 A por 0.05 A; en la práctica eso es no caber. El circuito del despacho es de **20 A a 220 V**.
:::

¿Qué tan ridículo es ese margen? 0.05 A en el interruptor son 0.05 ÷ 1.25 = 0.04 A de carga; a 220 V con \(f_p\) = 0.95, ≈ 8 W: menos que un foco LED. El pico es una estimación y el factor de potencia un supuesto, y cualquiera de los dos se mueve más que 8 W.

Un circuito de 15 A a 127 V, como el de los contactos del cuarto, aguanta como carga continua ≈ 1.45 kW con el factor de potencia de 0.95. El servidor pide 2.5 kW. **No se enchufa a la pared.**

### Un circuito dedicado

Un **[[circuito-dedicado|circuito dedicado]]** (*dedicated circuit*) es uno que sale del tablero con su propio interruptor y alimenta un solo equipo. Nada más va colgado de él. Parece un lujo y no lo es. Si el servidor comparte circuito con los contactos, basta que alguien conecte una aspiradora para que el interruptor se bote y el servidor se apague a media respuesta.

El enchufe también cambia. Los servidores traen una entrada estándar IEC 60320: la chica, la misma de una PC, en los equipos chicos y medianos, y la **C20** en los grandes. El cable se escoge por el otro extremo. El más común va a un enchufe NEMA 5-15 de 15 A, el de un contacto de pared de 127 V. A 220 V se usan cables C19 a enchufes de bloqueo como el L6-20, que no entran en un contacto normal. Esa incompatibilidad es a propósito: nadie conecta por error un equipo de 220 V a 127 V.

### Fuentes redundantes y dos circuitos

El Exxact trae 4 fuentes de poder en arreglo **3+1**: con 3 alcanza y la cuarta está de sobra. Es una **[[fuente-redundante|fuente redundante]]** (*redundant power supply*): si una fuente se quema, las otras siguen y el servidor ni se entera. Se cambia en caliente, sin apagarlo.

Las fuentes tienen un detalle que decide el voltaje. Según el configurador de Exxact, cada una da **2,600 W a 200–220 V**, pero **solo 1,000 W a 100–127 V**. Con 3 activas, eso es ≈ 7,800 W a 220 V o ≈ 3,000 W a 127 V.

Las fuentes redundantes protegen mejor si cuelgan de **dos circuitos distintos**, el A y el B: dos fuentes en cada uno. Si un circuito se cae (se bota su interruptor, alguien lo desconecta), el otro sigue. Pero ahí aparece la trampa: con un circuito caído quedan **2 fuentes**.

:::cuenta ¿Aguanta el servidor si se cae un circuito?
A 127 V, con 2 fuentes // 1,000 W cada una | 2 × 1,000 | 2,000 W
Contra el pico | 2,000 − 2,500 | **−500 W: se apaga**
A 220 V, con 2 fuentes // 2,600 W cada una | 2 × 2,600 | 5,200 W
Contra el pico | 5,200 − 2,500 | **+2,700 W: sigue**
= A 127 V, la redundancia es de mentira: en cuanto falla un circuito, las fuentes que quedan no alcanzan. Es la segunda razón, además de los amperes, para conectar el servidor a 220 V.
:::

Cada circuito del par se dimensiona para cargar **todo** el servidor solo, porque así trabaja cuando el otro falla: los dos son de 20 A a 220 V.

:::diagrama el-cuarto-energia
El camino de la luz, de CFE a las cuatro fuentes del servidor, con el UPS de la sección que sigue. Sigue los recorridos: un día normal, un apagón y el mismo diseño a 127 V.
:::

Lo instala un electricista con la norma en la mano. Esta lección te dice qué pedir y por qué, no reemplaza al electricista.

## El UPS: minutos para apagar bien {The UPS: minutes to shut down properly}

Cuando se va la luz, un servidor se apaga de golpe. En el mejor caso se pierden las respuestas a medias. En el peor, se corrompe un disco a media escritura o la base de datos de vectores queda en un estado raro. Un **[[ups|UPS]]** (*uninterruptible power supply*, «no-break» en México) es una batería con electrónica que alimenta al equipo cuando la red falla.

Hay dos diseños que importan aquí:

- **Interactivo** (*line-interactive*). Normalmente pasa la luz de la red al equipo y corrige el voltaje cuando sube o baja (AVR). Cuando la red falla, cambia a la batería en unos milisegundos.
- **En línea de doble conversión** (*online double-conversion*). Siempre convierte la luz de la red a corriente directa y otra vez a alterna. El equipo siempre se alimenta del **inversor**, el circuito que hace esa segunda conversión, de directa (la de la batería) a alterna: cuando la red falla no hay cambio que notar, y lo que llega al servidor siempre es limpio.

Por debajo de ≈ 5 kVA se venden de los dos tipos. Las fuentes de servidor modernas aguantan bien el cambio de un interactivo; el de doble conversión cuesta más y protege mejor contra una red sucia, con picos y caídas.

### Cuánto UPS: VA, no watts

Los UPS se venden en **VA** (o kVA), y ahí está el factor de potencia otra vez. En los Smart-UPS de APC menores de 6 kVA, los watts que dan son menos que sus VA; en los de 6 kVA o más, son iguales. Por ejemplo, el APC SMT3000RMI2U es de 3 kVA y su potencia activa es ≈ 2.7 kW.

:::formula Tamaño del UPS
S_{UPS} ≥ frac{P_{pico}}{f_p} × (1 + h)
- S_{UPS}: la capacidad del UPS, en VA
- P_{pico}: el pico del equipo que alimenta, en W
- f_p: el factor de potencia del equipo
- h: la holgura, como fracción (0.25 = 25 %), para no trabajar al tope y que la batería dure
:::

:::cuenta El UPS del despacho
Potencia aparente // \(P_{pico}\) = 2,500 W, \(f_p\) = 0.95 | 2,500 ÷ 0.95 | ≈ 2,632 VA
Con holgura, \(S_{UPS}\) // \(h\) = 0.25, criterio de diseño | 2,632 × 1.25 | ≈ 3,290 VA
Un UPS de 3 kVA // 2.7 kW de potencia activa | 2,700 − 2,500 | solo 200 W de margen
= Uno de 3 kVA queda al tope en el pico. El despacho necesita uno de **5–6 kVA**, de doble conversión, a 230 V.
:::

La holgura del 25 % es un criterio de diseño, no una cifra del fabricante. APC da una regla más conservadora: que la carga en VA no pase del 60 % de los VA del UPS. Con ella saldrían ≈ 4,390 VA, y la conclusión es la misma: un UPS de 5–6 kVA.

El voltaje también tiene que coincidir: un UPS de 230 V no sirve en un contacto de 127 V sin transformador. El del despacho va en el circuito de 220 V.

Los precios, como referencia y en tiendas de EE. UU., sin impuestos, a noviembre de 2026: el SMT3000RMI2U de 3 kVA, interactivo, ≈ **US$3,510** en PC Nation (sin existencias ese día). Uno de 6 kVA de doble conversión, el SRT6KRMXLI, aparece entre ≈ US$7,800 y 9,600 en distintas tiendas. En México no se encontró un precio publicado con fecha: se cotiza.

### Lo que el UPS no hace

Con una carga alta, un UPS chico aguanta **minutos**, no horas. Su trabajo no es que el despacho siga trabajando durante un apagón; es que el servidor **se apague bien**. Para eso se conecta al servidor por red o USB, y un programa escucha: cuando la batería baja de cierto nivel, cierra el servidor de modelos y apaga el sistema operativo. Sin esa conexión, solo retrasa el apagón.

Para seguir trabajando durante horas hace falta una **planta de emergencia** (un generador). La del edificio del despacho no alimenta su cuarto, así que el plan es apagar bien, no aguantar.

:::ojo
El minisplit **no** va en el UPS: jala demasiado y la batería duraría nada. Eso significa que durante un apagón el servidor sigue calentando el cuarto con el aire apagado. Otra razón para que el apagado automático sea rápido.
:::

:::profundo ¿Qué tan rápido se calienta el cuarto sin aire?
Una cuenta de física de prepa da el orden de magnitud. El aire del cuarto pesa ≈ 1.2 kg por metro cúbico, y calentar un kilogramo de aire un grado cuesta ≈ 1,005 joules. El cuarto del despacho tiene 3 × 3 × 2.5 = 22.5 m³ de aire. Si **solo** el aire absorbiera los 2,500 W del servidor, la temperatura subiría ≈ 5.5 °C por minuto:

```python
rho, cp = 1.2, 1005            # aire: kg por m³ y joules por kg y por °C
vol = 3 * 3 * 2.5              # el cuarto del despacho, en m³
C = vol * rho * cp             # joules para subir 1 °C todo el aire
for P in (2500, 3000):         # el servidor solo, y con los 500 W que ya había
    sube = P / C * 60          # °C por minuto
    print(f"{P} W: {sube:.1f} °C por minuto; de 24 a 32 °C en {8 / sube:.1f} min")
```

```salida
2500 W: 5.5 °C por minuto; de 24 a 32 °C en 1.4 min
3000 W: 6.6 °C por minuto; de 24 a 32 °C en 1.2 min
```

En la realidad sube bastante más lento, porque las paredes, el piso y los equipos absorben calor; cuánto, solo se sabe midiendo. Pero el mensaje se queda: un cuarto chico con 3 kW y el aire apagado pasa de cómodo a peligroso en **minutos o decenas de minutos**, no en horas. Un sensor con alerta y un apagado automático por temperatura son baratos al lado de lo que protegen.
:::

## Calor: cada watt que entra sale como un watt de calor {Heat: every watt in leaves as a watt of heat}

Aquí está la idea más útil de la lección. Un servidor no «guarda» energía: las respuestas que escribe son bits, y los bits no se llevan energía que valga la pena contar. **Todo** lo que jala de la pared termina como calor en el cuarto, watt por watt. Un servidor de 2.5 kW es, para el aire del cuarto, un calefactor de 2.5 kW.

Ese calor se mide, en el mundo del aire acondicionado, en otras unidades. Un **BTU** (*British thermal unit*) es una cantidad de energía, y los aires acondicionados se anuncian por los **BTU por hora** que pueden sacar. La **[[tonelada-de-refrigeracion|tonelada de refrigeración]]** son 12,000 BTU/h. El nombre viene de la época del hielo: es, más o menos, el calor que absorbe una tonelada corta de hielo al derretirse en un día. Un minisplit «de 1 tonelada» saca, en teoría, 12,000 BTU/h.

:::formula De watts a BTU por hora y a toneladas
Q_{BTU} = P × 3.41214
Q_{t} = frac{P}{3,516.853}
- P: la potencia que se vuelve calor, en W
- Q_{BTU}: el mismo calor, en BTU por hora
- Q_{t}: el mismo calor, en toneladas de refrigeración
- 3.41214 y 3,516.853: las conversiones del NIST (1 tonelada = 12,000 BTU/h = 3,516.853 W)
:::

### La carga térmica del cuarto

La **[[carga-termica|carga térmica]]** (*heat load*) de un cuarto es todo el calor que hay que sacarle para que no suba su temperatura. En un cuarto de TI sin ventanas, casi toda viene de los equipos. Las personas (≈ 100 W cada una mientras están adentro), las luces y el calor que entra por las paredes suman algo más. En un cuarto interior y casi siempre vacío, como el del despacho, se pueden dejar fuera de la primera cuenta; en uno con ventana al poniente, no.

:::cuenta La carga térmica del cuarto del despacho
Servidor nuevo, en el pico | \(P_{pico}\) | 2,500 W
Lo que ya había // switch, firewall, NAS y servidor de archivos | dato del ejemplo | 500 W
Carga térmica, \(P\) | 2,500 + 500 | 3,000 W
En BTU por hora, \(Q_{BTU}\) | 3,000 × 3.41214 | ≈ 10,236 BTU/h
En toneladas, \(Q_{t}\) | 3,000 ÷ 3,516.853 | ≈ 0.85 t
= En papel, el minisplit de 1 tonelada (12,000 BTU/h) alcanza. La sección que sigue explica por qué en la práctica no.
:::

### A qué temperatura debe estar

La referencia es ASHRAE, la asociación de ingenieros de aire acondicionado de EE. UU. Su guía térmica para centros de datos (4.ª edición, 2015) da un rango **recomendado de 18 a 27 °C** para el aire que **entra** a los equipos, con un punto de rocío entre −9 y 15 °C y a lo más 60 % de humedad relativa. Hay rangos «permitidos» más anchos (de 15 a 32 °C en la clase A1, la más estricta), para ratos, no para vivir ahí. La edición de 2021 cambió el esquema de humedad; aquí se usan las cifras de 2015.

Dos detalles prácticos. Primero, la temperatura que importa es la del aire **al frente del servidor**, por donde entra, no la del termostato del minisplit ni la del pasillo. Un sensor pegado al frente del rack te dice la verdad. Segundo, no hace falta enfriar de más: un cuarto a 18 °C cuesta más luz que uno a 24 °C y el servidor no vive más.

¿Y si se pasa? Las GPUs se protegen solas: cuando se calientan, bajan su reloj (el *throttling* que ves en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/)). El servidor sigue contestando, pero más lento, y nadie se entera hasta que los abogados se quejan. Si sigue el calor, se apaga para no dañarse. Con la L40S, que no trae ventilador propio, todo depende de que el aire del chasis llegue frío.

## ¿Basta un minisplit de oficina? {Is an office mini-split enough?}

Los aparatos de aire se dividen en dos familias, y la diferencia explica casi todo.

Un **aire de confort**, como un minisplit, está hecho para personas. Las personas sudan y respiran: sueltan calor y humedad. Por eso un aire de confort gasta buena parte de su capacidad en **quitar humedad** (calor latente) y el resto en bajar la temperatura (calor sensible). Los equipos, en cambio, sueltan calor seco: puro calor sensible. Según un documento de Vertiv, un fabricante de aire de precisión (y por eso parte interesada), un aire de confort dedica ≈ **60 %** de su capacidad al calor sensible, y uno de precisión ≈ **95 %**. El otro 40 % del minisplit se va en secar un aire que ya estaba seco, y un cuarto demasiado seco junta electricidad estática.

Además, un aire de precisión está hecho para trabajar 24 horas, los 365 días; un minisplit, para unas horas al día. Y Vertiv mismo admite que, desde que ASHRAE ensanchó sus rangos, la precisión estricta ya no siempre es indispensable. Para un cuarto chico con un solo servidor, un minisplit **bien escogido y bien configurado** puede servir. El de 1 tonelada que ya está, no.

:::formula Minisplit que hace falta
C_{nom} ≥ frac{P}{k}
- C_{nom}: la capacidad nominal del minisplit, la que dice su caja, en W (o en toneladas, ÷ 3,516.853)
- P: la carga térmica del cuarto, en W
- k: la parte de su capacidad que da como calor sensible (≈ 0.6 en un aire de confort, según Vertiv)
:::

:::cuenta ¿Alcanza el minisplit de 1 tonelada?
Lo que de verdad saca // 1 t = 3,516.853 W, \(k\) = 0.6 | 0.6 × 3,516.853 | ≈ 2,110 W
Contra la carga térmica | 2,110 − 3,000 | **−890 W: no alcanza**
Capacidad nominal que hace falta, \(C_{nom}\) | 3,000 ÷ 0.6 | 5,000 W ≈ 1.42 t
El tamaño con margen // 1.5 t daría 3,165 W útiles: 165 W de sobra | redondear hacia arriba | **2 t** (24,000 BTU/h)
= Hace falta un minisplit de 2 toneladas. Y como uno solo es un punto único de falla, **dos** de 2 toneladas que se turnan.
:::

### Uno no basta: N+1

Un minisplit se descompone, se le acaba el gas o necesita mantenimiento. Si es el único, ese día el servidor se apaga por calor. La regla es la misma que en la [[redundancia|redundancia]] de las GPUs: si hace falta N, se ponen N+1. Para el despacho, dos equipos de 2 toneladas, cada uno capaz de cargar el cuarto solo, que se turnan para que los dos tengan horas parejas.

La configuración importa tanto como el tamaño (son criterios de diseño, no cifras de un fabricante de minisplits):

- **Temperatura fija** dentro del rango de ASHRAE, por ejemplo 24 °C, sin modo «ahorro» ni «dormir», que suben la temperatura de noche.
- **Arranque automático** después de un apagón. Muchos minisplits vuelven apagados cuando regresa la luz, y el servidor ya volvió prendido.
- **Desagüe del condensado** que no gotee sobre el rack.
- **Alimentación propia**, en su propio circuito, no en el del servidor.
- **El aire del edificio no cuenta.** El aire central se apaga de noche y en fines de semana, justo cuando nadie está para darse cuenta.

:::figura el-cuarto-plano
El cuarto del despacho visto desde arriba. A la izquierda, mal: el rack con la espalda pegada a la pared y el minisplit soplando al costado; el aire caliente que sale por atrás no tiene a dónde ir y vuelve por arriba al frente. A la derecha, bien: el frente del rack mira hacia donde sopla el aire frío, atrás queda espacio, y el aire caliente sube y regresa a la toma del minisplit.
:::

### El ruido

Un [[servidor-gpu|servidor con GPUs]] [[tarjeta-pasiva|pasivas]] hace ruido de verdad. Lenovo declara, para uno de sus servidores 2U con muchas GPUs, ≈ **68 dBA** trabajando, y Dell da cifras del orden de 76 dB a carga máxima para uno de 4 GPUs. Del 4U del despacho no hay dato publicado. Pero el orden de magnitud basta: es mucho más ruido del que se aguanta junto a un escritorio todo el día. **No va junto a los escritorios**; va en el cuarto, con la puerta cerrada.

:::calculadora el-cuarto-circuito
Arranca con el servidor del despacho: 4 L40S, 220 V, interruptor de 20 A y el minisplit de 1 tonelada que ya está. Cambia a 127 V y mira el veredicto del interruptor. Luego sube el minisplit a 2 toneladas. Prueba también a elegir la H100 SXM y poner 8 GPUs: aun sin tocar la CPU ni el resto, ni el circuito ni el aire de una oficina alcanzan.
:::

## Pasillo frío y pasillo caliente {Cold aisle and hot aisle} [extra]

Los servidores respiran en una sola dirección: **entran aire por el frente y lo sacan caliente por atrás**. Los ventiladores del chasis lo empujan así siempre. En un centro de datos con decenas de racks, eso define cómo se acomodan.

Las filas de racks se ponen **frente con frente** y **espalda con espalda**. Entre dos frentes queda un **pasillo frío**, adonde llega el aire frío y de donde todos los servidores lo toman. Entre dos espaldas queda un **[[pasillo-caliente|pasillo caliente]]** (*hot aisle*), adonde todos sueltan su aire caliente y de donde el aire acondicionado lo recoge. Así el aire caliente de un rack nunca entra al frente de otro.

Sin ese orden aparece la **recirculación**: el aire caliente da la vuelta y vuelve a entrar por el frente, y el servidor respira su propio escape aunque el termostato marque 22 °C. La solución es la **contención**: cerrar un pasillo con techos y puertas, y tapar con placas ciegas los huecos vacíos del rack, por donde el aire caliente se cuela al frente.

En el cuarto del despacho no hay pasillos: hay un rack. Pero la física es la misma, y las reglas se reducen a tres:

1. **El frente del rack mira al aire frío.** El minisplit sopla hacia el frente, no hacia la espalda.
2. **Atrás queda espacio.** La espalda no va pegada a la pared, para que el aire caliente salga y suba, y para poder trabajar en los cables.
3. **El aire caliente regresa a la toma del minisplit** sin pasar por el frente del servidor. Un minisplit de pared toma aire por arriba y lo suelta frío por abajo: el caliente, que sube solo, es justo lo que debe tomar, como en un centro de datos el pasillo caliente regresa al aire acondicionado. Lo que no debe pasar es lo contrario: que el chorro frío del minisplit se meta directo a su propia toma sin pasar por el frente del rack, o que el escape del servidor dé vuelta hacia su propio frente.

Un detalle que confunde: el termostato del minisplit mide el aire que **toma**, que es el caliente. Por eso marca más que lo que respira el servidor, y la temperatura que manda es la del sensor al frente del rack, no la del control remoto.

### Cuánto aire necesita un servidor

Para sacar el calor, el servidor necesita que le llegue suficiente aire frío. Cuánto sale de la misma física de antes: el aire se lleva el calor al calentarse, y cuanto más se calienta al pasar, menos aire hace falta.

:::formula Aire que necesita un servidor
F = frac{P}{ρ × c_p × ΔT}
- F: el aire que tiene que pasar por el servidor, en m³ por segundo
- P: la potencia que se vuelve calor, en W
- ρ: la densidad del aire, ≈ 1.2 kg por m³
- c_p: lo que cuesta calentar un kg de aire 1 °C, ≈ 1,005 J
- ΔT: cuánto se calienta el aire entre el frente y la espalda, en °C
:::

```python
rho, cp, P = 1.2, 1005, 2500         # aire y el pico del servidor del despacho
for dT in (10, 12, 15):              # cuánto se calienta el aire al pasar, en °C
    F = P / (rho * cp * dT)          # m³ por segundo
    print(f"ΔT = {dT} °C: {F * 60:5.1f} m³/min = {F * 2118.88:3.0f} cfm")
print(f"Regla de NVIDIA para el DGX H100: {4.445 * P / 1000:.1f} m³/min = {157 * P / 1000:.0f} cfm")
```

```salida
ΔT = 10 °C:  12.4 m³/min = 439 cfm
ΔT = 12 °C:  10.4 m³/min = 366 cfm
ΔT = 15 °C:   8.3 m³/min = 293 cfm
Regla de NVIDIA para el DGX H100: 11.1 m³/min = 392 cfm
```

La guía de diseño de NVIDIA para sus DGX H100 pide como mínimo 4.445 m³ por minuto por cada kW (157 *cfm*, pies cúbicos por minuto, por kW), y la cuenta de física con un aire que se calienta ≈ 11 °C da lo mismo. Para el servidor del despacho son ≈ 11 m³ por minuto: el aire del cuarto entero, 22.5 m³, pasa por él cada dos minutos. Por eso importa que sea aire frío y no el escape de hace un minuto.

## Cuando el aire ya no alcanza: enfriamiento líquido {When air is not enough: liquid cooling} [extra]

El despacho tiene un problema de cuarto, no de densidad. Su servidor de 2.5 kW es un rack de muy baja densidad comparado con lo que se ve en un centro de datos. La **densidad** es cuántos kW se meten en un rack, y es la cifra que decide si el aire alcanza.

Las encuestas de Uptime Institute, que sigue la industria de centros de datos, dan el contexto: el rack promedio estaba por debajo de 8 kW en 2024; en 2025, ≈ 7.5 kW; en 2026, ≈ **7.8 kW**, con 11 kW como el valor más común. Más del 80 % de los operadores dice que su rack más denso queda abajo de 30 kW.

Ahora mira los equipos de IA grandes, con cifras de NVIDIA:

- Un **DGX H100** (8 H100 SXM) jala hasta **10.2 kW** y suelta hasta ≈ 34,800 BTU/h: casi 3 toneladas de calor él solo. NVIDIA recomienda no más de 4 por rack «por razones térmicas»: ≈ 41 kW por rack.
- Un **DGX B200** (8 B200) jala hasta ≈ **14.3 kW**.
- Un rack **GB200 NVL72** (72 GPUs Blackwell y 36 CPUs Grace en 18 bandejas) jala **≈ 120 kW**, con ocho estantes de fuentes de 33 kW. Eso son ≈ 34 toneladas de calor en un solo rack.

:::figura el-cuarto-escalera
La escalera de la potencia por equipo o por rack, en kW. Abajo, el servidor del despacho (2.5 kW). Luego, el rack promedio de 2026 según Uptime (7.8 kW), un DGX H100 (10.2 kW), un DGX B200 (14.3 kW) y un rack con los 4 DGX H100 que NVIDIA recomienda como máximo (≈ 41 kW). Una franja marca dónde se acaba el aire, entre ≈ 20 y 40 kW por rack según quién lo diga: ese rack de 41 kW ya queda arriba de ella. Arriba de todo, el GB200 NVL72, ≈ 120 kW, que ya va con líquido.
:::

El aire tiene un techo porque mover calor con aire es caro: el aire carga poco calor por litro. Para sacar 120 kW de un rack habría que meterle un huracán. Con un líquido, que carga muchísimo más calor por litro, basta un tubo. Eso es el **[[enfriamiento-liquido|enfriamiento líquido]]** directo al chip (*direct-to-chip liquid cooling*): una placa de metal pegada a cada GPU y cada CPU (una **placa fría**) por la que corre un líquido que se lleva el calor fuera del rack. El NVL72 enfría así sus CPUs y GPUs, y deja aire solo para la red y el almacenamiento.

¿Dónde empieza a hacer falta? No hay un umbral único publicado. Según resúmenes de informes de la industria, la mayoría cree que a más de ≈ 20 kW por rack el líquido directo es necesario; otros ponen el techo del aire entre 30 y 40 kW, y alguno lo estira a ≈ 50 kW. Lo seguro: un rack de 120 kW va con líquido, y uno de 2.5 kW no lo necesita ni de chiste.

:::cuenta Un servidor HGX B200 en el cuarto del despacho
Corriente a 220 V // \(P\) = 14.3 kW, \(f_p\) = 0.95 | 14,300 ÷ (220 × 0.95) | ≈ 68 A
Interruptor, \(1.25 × I\) | 1.25 × 68 | ≈ 86 A
Calor, \(Q_{t}\) | 14,300 ÷ 3,516.853 | ≈ 4.1 t
= Más de 4 veces el servidor del despacho. Un equipo así pide alimentación trifásica, varios aires de precisión y casi seguro otro edificio: es el caso para un centro de datos.
:::

([[hgx|HGX]] es la placa con 8 GPUs SXM que NVIDIA vende a los fabricantes para sus propios servidores; la cuenta supone los 14.3 kW del DGX B200.) Para el despacho, el enfriamiento líquido no es su problema. Pero si algún día quisiera un modelo de cientos de miles de millones de parámetros en 8 GPUs SXM, el cuarto de la oficina deja de ser opción.

## Lo que cuesta la luz {What electricity costs}

En México, la mayoría de los negocios compra la luz a CFE con las tarifas del **Suministro Básico**, que publica el Diario Oficial. Las más recientes que se encontraron rigen **a partir del 1 de octubre de 2026** y hasta que se sustituyan; el oficio dice que el factor de ajuste de ese mes es 0 %. Si CFE publica otro cuadro en diciembre, cambian. Todos los precios de esta sección son **en pesos y antes de IVA**.

Las tarifas cambian según la **división** de CFE. La Ciudad de México no es una «región Central»: cae en las divisiones **Valle de México Centro, Norte o Sur**, según la colonia, y la que te toca la dice tu recibo. Aquí se usa Valle de México Centro.

Y cambian según el contrato. Tres que importan aquí:

- **PDBT**: pequeña demanda en baja tensión (la luz llega a 220/127 V), para negocios con demanda de hasta ≈ 25 kW. Cobra por kWh y un cargo fijo.
- **GDBT**: gran demanda en baja tensión, para los que pasan de ≈ 25 kW. Cobra menos por kWh, pero además cobra **por kW de demanda**: por lo más que jalaste en el mes.
- **GDMTO**: gran demanda en media tensión, para quien recibe la luz en alta (más de 1,000 V) y la baja con su propia subestación. Cobra todavía menos por kWh y por kW.

Cada tarifa se arma de varios cobros (transmisión, distribución, operación, generación…). Sumados para Valle de México Centro:

| Tarifa (Valle de México Centro, oct-2026, antes de IVA) | Por kWh | Por kW de demanda, al mes | Cargo fijo, al mes |
|---|---|---|---|
| PDBT | ≈ $3.565 | — | $54.05 |
| GDBT | ≈ $1.942 | ≈ $542.70 | $540.49 |
| GDMTO | ≈ $1.542 | ≈ $395.29 | $540.49 |

Una oficina de 200 personas, con sus luces, computadoras y aire, razonablemente pasa de 25 kW, así que no cabría en PDBT. Y el despacho recibe la luz a 220/127 V, en baja tensión: la media tensión sería del edificio, si tuviera subestación. Para el ejemplo se supone **GDBT**; su recibo lo diría.

¿Qué kW cobra? No exactamente «lo más que jalaste». La **demanda máxima medida** es el promedio de los 15 minutos de mayor consumo del mes. CFE factura, a grandes rasgos, la menor de dos cifras: esa demanda medida y una calculada con la energía, los kWh del mes ÷ (24 × días × un **factor de carga** que fija la regulación; en GDMTO es 0.55, según las guías del sector). Cuál de las dos manda depende de toda la oficina, y lo dice el recibo. Aquí se aproxima con lo que el servidor y su aire suman en horas de oficina, que es cuando la oficina jala más.

### Cuánta energía, de verdad

Para la luz no se usa el pico. Se usan las horas. El despacho trabaja 10 horas al día; con 22 días hábiles al mes (supuesto del ejemplo) son **220 horas de uso** de las 730 que tiene un mes, y **510 horas de reposo**. En uso, las GPUs al 60 % de su [[tdp|TDP]] (supuesto, entre el decode y el prefill de la medición de arriba) y el resto del servidor en ≈ 800 W. En reposo, las GPUs al 20 % y el resto en ≈ 550 W.

Y aquí entra la **[[pue|PUE]]**: lo que gasta el cuarto entero ÷ lo que gastan solo los equipos. Cada watt del servidor pide más watts del minisplit para sacarlo. Para un clóset de servidores sin enfriamiento dedicado, el Laboratorio Nacional Lawrence Berkeley supuso, en su informe de 2016, una PUE de **2.0**; para un cuarto de servidores más grande, 2.5. El promedio de los centros de datos del mundo, según Uptime, era **1.56** en 2024, y los nuevos andan en ≈ 1.3 o menos. Para el cuarto del despacho se usa 2.0: un watt para el servidor, otro para sacarlo.

:::formula Lo que cuesta al mes
E = (P_{uso} × h_{uso} + P_{rep} × h_{rep}) × PUE
C = E × p + P_{uso} × PUE × d
- P_{uso}, P_{rep}: lo que jala el servidor en horas de uso y en reposo, en kW
- h_{uso}, h_{rep}: las horas de cada una en el mes (suman 730)
- PUE: lo que gasta el cuarto ÷ lo que gasta el servidor
- E: la energía del mes, servidor y aire juntos, en kWh
- p: el precio por kWh de la tarifa, en pesos
- d: el precio por kW de demanda al mes (0 en PDBT), en pesos
- C: el costo del mes, en pesos antes de IVA (sin el cargo fijo, que el despacho ya paga)
:::

:::cuenta La luz del servidor del despacho, al mes
En uso, \(P_{uso}\) // 4 × 350 W × 0.6 + 800 W del resto | 840 + 800 | 1.64 kW
En reposo, \(P_{rep}\) // 4 × 350 W × 0.2 + 550 W | 280 + 550 | 0.83 kW
Energía del servidor // \(h_{uso}\) = 220, \(h_{rep}\) = 510 | 1.64 × 220 + 0.83 × 510 | ≈ 784 kWh
Con el aire, \(E\) // PUE = 2.0 | 784 × 2.0 | ≈ 1,568 kWh
Energía, \(E × p\) // GDBT, \(p\) = $1.942 | 1,568 × 1.942 | ≈ $3,045
Demanda, \(P_{uso} × PUE × d\) // \(d\) = $542.70 | 1.64 × 2.0 × 542.70 | ≈ $1,780
Al mes, \(C\) | 3,045 + 1,780 | **≈ $4,825**
Por pregunta // 3,000 al día × 22 días = 66,000 | 4,825 ÷ 66,000 | ≈ 7 centavos
= Con tarifa PDBT serían ≈ $5,591 al mes. Y en el peor caso, el servidor al pico las 730 horas con PDBT y PUE 2.0, ≈ $13,066 con el cargo fijo.
:::

Al lado del servidor, ≈ US$76,101, la luz de un año es una fracción chica de la compra con cualquier tipo de cambio razonable. No decide si conviene tener servidor propio; sí muestra que el cuarto con PUE 2.0 gasta casi el doble que un centro de datos eficiente. La comparación completa contra rentar GPUs o pagar una API es del [costo total](/herramientas/tco/): ahí la luz es un renglón más.

```python
h_uso, h_rep = 10 * 22, 730 - 10 * 22        # horas de uso y de reposo al mes
P_uso = 4 * 350 * 0.6 + 800                  # W: GPUs al 60 % de su TDP + resto
P_rep = 4 * 350 * 0.2 + 550                  # W: GPUs en reposo + resto
kwh = (P_uso * h_uso + P_rep * h_rep) / 1000 # kWh del servidor solo
for pue in (1.0, 1.56, 2.0):
    E = kwh * pue
    pdbt = E * 3.565
    gdbt = E * 1.9416 + P_uso / 1000 * pue * 542.70
    print(f"PUE {pue}: {E:6.0f} kWh  PDBT ${pdbt:6,.0f}  GDBT ${gdbt:6,.0f}")
```

```salida
PUE 1.0:    784 kWh  PDBT $ 2,795  GDBT $ 2,412
PUE 1.56:   1223 kWh  PDBT $ 4,361  GDBT $ 3,763
PUE 2.0:   1568 kWh  PDBT $ 5,591  GDBT $ 4,825
```

:::calculadora el-cuarto-luz
Arranca con el despacho: GDBT, PUE 2.0, 220 horas de uso. Cambia a PDBT y mira cuánto sube. Baja la PUE a 1.56, el promedio de los centros de datos: es lo que ahorraría el mismo servidor en un sitio eficiente. Sube las horas de uso a 730: es un servidor que trabaja de noche, por ejemplo resumiendo expedientes en lote.
:::

## La red: lo que mueve y lo que no {The network: what it carries and what it doesn't}

En una lección de hardware, la red asusta más de lo que pesa. Hay que separarla en tres redes distintas, con necesidades que no se parecen en nada.

:::diagrama el-cuarto-redes
Las tres redes del servidor del despacho. Toca cada caja para ver por qué está ahí, y sigue los recorridos: una pregunta, una noche de mantenimiento y lo que no debe pasar nunca.
:::

### La red de los usuarios: casi nada

Un LLM recibe texto y devuelve texto. Con ≈ 4 bytes de texto por token, una aproximación, una pregunta del despacho con su respuesta son ≈ 6,500 tokens: ≈ 26 kB.

:::cuenta El tráfico de los abogados
Bytes por hora, en promedio // 300 preguntas/h × 6,500 tokens × 4 bytes | 300 × 6,500 × 4 | 7.8 MB por hora
Por segundo | 7.8 × 10⁶ × 8 bits ÷ 3,600 s | ≈ 17 kbit/s
En la hora pico // 750 preguntas | 750 × 6,500 × 4 × 8 ÷ 3,600 | ≈ 43 kbit/s
Contra un enlace de 1 GbE // 10⁹ bits por segundo | 17,333 ÷ 10⁹ | ≈ 0.002 %
= Los abogados no se notan en la red. Un enlace de 1 gigabit los llevaría con el 99.998 % libre.
:::

(En el despacho, los fragmentos de expediente que acompañan cada pregunta salen de su base de vectores. Si vive en el mismo servidor, ni siquiera cruzan la red.)

Lo que sí mueve bytes en serio son las tareas de vez en cuando. Bajar los pesos del modelo, 19.32 GB, tarda ≈ 2.6 minutos a 1 Gb/s y ≈ 15 segundos a 10 Gb/s, en el mejor caso. Copiar los 30,000 expedientes para indexarlos, o un respaldo, pesa más. Por eso un servidor como el del despacho trae puertos de **10 o 25 GbE** (Ethernet de 10 o 25 gigabits por segundo): no por los usuarios, sino por esas tareas. Para el despacho, un puerto de 10 GbE hacia el switch de la oficina sobra. Cómo viaja un mensaje por IP y puertos lo ves en [Cómo viaja un mensaje](https://sensei.trueml.app/red/).

### Dentro del servidor: PCIe, sin NVLink

Las 4 L40S se conectan a las CPUs por **PCIe Gen4 x16**, que da 64 GB/s sumando los dos sentidos. La L40S **no tiene NVLink**, la conexión directa entre GPUs que tienen las [[sxm|SXM]]. Qué es cada uno y cuánto da lo ves en [CPU y GPU](https://sensei.trueml.app/cpu-gpu/).

Para el despacho eso no importa: el modelo **cabe en la memoria de una L40S** (pesos de 19.32 GB más el KV cache de sus conversaciones, en 48 GB). Cada GPU tiene su propia [[copia-del-servidor|copia del modelo]] y atiende sus conversaciones sola; un balanceador (un programa que manda cada pregunta a la GPU menos ocupada) las reparte. Cuando un modelo no cabe en una GPU y hay que partirlo entre varias, que se pasan resultados en cada capa, la conexión entre GPUs sí manda. Eso es el *tensor parallel*, el tema de la lección «[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)».

### Entre servidores: RDMA e InfiniBand

Si un modelo no cabe ni en un servidor entero, se parte entre **varios servidores**, y la red entre ellos entra en cada paso de cálculo. Ahí la Ethernet normal estorba: cada mensaje pasa por la CPU y el sistema operativo de los dos lados.

La salida es **[[rdma|RDMA]]** (*Remote Direct Memory Access*): la tarjeta de red copia memoria de un servidor a otro sin pasar por la CPU ni por el sistema operativo. Con GPUDirect RDMA, la copia va directo de la memoria de una GPU a la de otra GPU en otro servidor. Hay dos formas de tenerlo:

- **[[infiniband|InfiniBand]]**: una red propia, con sus switches y cables, que trae RDMA de nacimiento. La generación NDR de NVIDIA da ≈ 400 Gb/s por puerto.
- **RoCE** (*RDMA over Converged Ethernet*): RDMA encima de Ethernet, con switches de Ethernet bien configurados.

Es la red de los clústeres de entrenamiento y de los modelos gigantes. **El despacho no la necesita**: tiene un servidor, y su modelo cabe en una GPU.

### La red de gestión y el BMC

Aquí sí hay que poner atención. Cada servidor trae un **[[bmc|BMC]]** (*baseboard management controller*): una computadita aparte, en la tarjeta madre, con su propio puerto de red. Funciona aunque el servidor esté apagado o el sistema operativo esté colgado. Desde ahí se enciende y apaga el servidor, se ve su pantalla, se instala el sistema operativo y se actualiza el **firmware** (el programa grabado en las piezas del equipo, que corre antes que el sistema operativo), todo por red. Cada marca le pone su nombre: iDRAC en Dell, iLO en HPE; el protocolo clásico es IPMI.

Para 2 personas de TI que no viven junto al servidor, el BMC es una maravilla. También es la puerta más peligrosa del equipo. Un BMC da control **por debajo** del sistema operativo: quien entra ahí puede apagar el servidor, montar un disco falso o reinstalar todo, y ningún antivirus del sistema operativo lo ve. La agencia de ciberseguridad de EE. UU. (CISA) lo advirtió desde 2013: IPMI guarda contraseñas sin cifrar, muchos BMC vienen con contraseñas de fábrica o sin ninguna, y hay que encerrarlos en una red de gestión aparte. En 2023, CISA y la NSA publicaron juntas una guía para endurecer BMCs. Y no es teoría. Desde junio de 2025 hay una falla de BMC (la [[cve|CVE]]-2024-54085, en el firmware MegaRAC de AMI) en el catálogo de vulnerabilidades que CISA sabe explotadas. Y en julio de 2026 una investigación contó ≈ 24,650 BMCs expuestos en internet que entregan, antes de pedir contraseña, datos derivados de ella con los que se puede adivinar la contraseña probando, fuera de línea.

Para el despacho, cuyos expedientes son secreto profesional, un BMC expuesto equivale a regalar la consola del servidor. Las reglas:

1. **El puerto del BMC va en una red de gestión aparte** (una VLAN de gestión: una red separada dentro del mismo switch), sin salida a internet.
2. **Se entra solo por VPN** (una conexión cifrada que mete a una máquina de fuera en esa red) o desde una máquina de administración dentro de ella.
3. **Contraseña propia, larga y distinta** a todas, cambiada el primer día. Nada de la de fábrica.
4. **Firmware al día** y los accesos anónimos apagados.

## Colocation: rentar el cuarto de alguien más {Colocation: renting someone else's room} [extra]

Si el cuarto del despacho no da (el edificio no deja meter otro circuito, el casero no permite otro minisplit, o nadie quiere ser responsable de la temperatura un domingo), existe otra opción. **[[colocation|Colocation]]** es rentar espacio, luz, enfriamiento y conexión en un centro de datos para **tu propio** hardware. El servidor sigue siendo del despacho; el cuarto es de alguien más. Se renta por unidad de rack, por medio rack o rack completo, y sobre todo **por kW contratado**: cuánta potencia te garantizan.

En México, **Querétaro** concentra la mayor parte de la capacidad de centros de datos del país, más del 60 % según un informe de la industria. Ahí están, por ejemplo, **Equinix MX1 y MX2, en El Marqués, Querétaro**, aunque la página de Equinix los agrupa como «Mexico City»; varios operadores más tienen sitios en la zona. En la Ciudad de México también hay sitios, por ejemplo los de KIO.

¿Cuánto cuesta? **Ningún operador publica precios**: todo es «cotización». Pídela bien, preguntando por:

- **kW por rack** garantizados, con aire o con líquido, y **dos alimentaciones** (A y B), cada una capaz de cargar todo.
- **Contrato** (suelen ser anuales o más), cómo sube el precio, y el **enlace** con la oficina.
- **Manos remotas** (*remote hands*): técnicos del sitio que cambian un disco o reinician un equipo por ti.
- Quién entra al rack y cómo queda registrado, y la **certificación**: qué Tier y de qué tipo.

### Los niveles Tier

Uptime Institute clasifica los centros de datos por **Tier**, según la redundancia de su luz y su enfriamiento. Cada nivel trae un objetivo de disponibilidad:

| Tier | Disponibilidad | Paro al año | Lo que significa |
|---|---|---|---|
| I | 99.671 % | ≈ 28.8 h | Sin redundancia |
| II | 99.741 % | ≈ 22.7 h | Redundancia parcial (N+1 en algunas piezas) |
| III | 99.982 % | ≈ 1.6 h | N+1, y se le da mantenimiento sin apagar |
| IV | 99.995 % | ≈ 0.4 h | Tolerante a fallas |

Dos letras chicas. Esas cifras son objetivos de diseño de **las instalaciones**, no del servidor que tú metes: si tu servidor tiene una sola fuente, el Tier IV no lo salva. Y Uptime certifica por separado el diseño, la construcción y la operación: «Tier III» en un folleto puede ser solo el diseño. Se confirma en el directorio de Uptime.

### Lo que gana y lo que cuesta

Gana en **PUE** (≈ 1.3–1.56 contra ≈ 2.0 de un cuarto de oficina) y en todo lo que esta lección le pidió al cuarto: circuitos A y B, UPS grandes, planta de emergencia y aire de precisión redundante.

Cuesta en otras cosas. El servidor queda a ≈ 200 km de la oficina, si está en Querétaro. Para un LLM eso casi no importa: la luz en fibra recorre esa distancia en ≈ 1 ms, y el primer token tarda ≈ 2 s. Lo que sí cuesta es el **enlace** privado con el sitio, y que cada visita sea un viaje. Y cuesta en confianza: los expedientes salen físicamente de la oficina, aunque no de máquinas del despacho. La [[soberania-de-datos|soberanía de los datos]] se conserva (el hardware y las llaves son tuyos, los discos van cifrados), pero hay que revisar que los contratos con los clientes del despacho lo permitan y documentar quién puede tocar el rack. Esa revisión, y la de mantener el servidor aislado de internet, es de la lección «[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)».

## Errores comunes {Common mistakes}

1. **Conectar el servidor a un contacto de pared.** «Trae su cable y entra en el contacto». Un circuito de 15 A a 127 V aguanta ≈ 1.45 kW continuos y el servidor pide 2.5 kW. Funciona en la prueba con el servidor en reposo y se bota el día que todos preguntan. **Cómo evitarlo:** calcula \(I = P_{pico} ÷ (V × f_p)\), aplica el 125 % de la NOM y pide un [[circuito-dedicado|circuito dedicado]] a 220 V.
2. **Dimensionar el aire con la caja del minisplit.** «Son 10,236 BTU/h y el minisplit es de 12,000: sobra». Un aire de confort da ≈ 60 % de su capacidad como calor sensible. **Cómo evitarlo:** divide la [[carga-termica|carga térmica]] entre 0.6 y pon N+1.
3. **Contar con el aire del edificio.** Se apaga de noche y en fines de semana, justo cuando nadie mira. **Cómo evitarlo:** el cuarto tiene su propio aire, con arranque automático después de un apagón y una alerta de temperatura.
4. **Pensar que el UPS es para seguir trabajando.** Con un servidor de 2.5 kW, un UPS da minutos. **Cómo evitarlo:** conecta el UPS al servidor para que se apague solo, y si de verdad necesitas horas, eso es una planta de emergencia.
5. **Comprar red cara para los usuarios.** El tráfico de 200 abogados cabe en 0.002 % de un enlace de 1 GbE. InfiniBand es para partir un modelo entre servidores. **Cómo evitarlo:** 10 GbE para el servidor, y gasta en lo que sí importa: el aire, el UPS y la red de gestión.
6. **Dejar el BMC en la red de la oficina con la contraseña de fábrica.** Es la consola del servidor, por debajo del sistema operativo. **Cómo evitarlo:** VLAN de gestión sin internet, VPN, contraseña propia y firmware al día, el primer día.

## En la vida real {In real life}

**El despacho.** El plan para su cuarto de 9 m² queda así. Dos circuitos dedicados de **20 A a 220 V**, A y B, con dos fuentes del servidor en cada uno. Un **UPS de 5–6 kVA de doble conversión** en el circuito A, conectado al servidor para que se apague solo; el switch también va en el UPS, para que el aviso de apagado viaje por la red. Los 500 W que ya había siguen en su circuito. **Dos minisplits de 2 toneladas** que se turnan, en circuitos propios, a 24 °C fijos y con arranque automático, más un sensor de temperatura al frente del rack que mande alertas. El rack con el frente hacia el aire frío y espacio atrás. Un puerto de 10 GbE al switch de la oficina, y el BMC en una VLAN de gestión sin internet. La luz: ≈ $4,800 al mes antes de IVA con GDBT y PUE 2.0, ≈ 7 centavos por pregunta. Y una pregunta abierta para la dirección: si el edificio no deja hacer las obras, la alternativa es un rack en colocation, con su cotización, su enlace y la revisión de los contratos con los clientes.

**Una clínica con una [[workstation]].** Supuesto del ejemplo: una clínica quiere un asistente de notas médicas en una workstation de torre con una RTX PRO 6000 Blackwell Workstation Edition (600 W según `gpus.json`; es la que trae ventilador, para torre), en total ≈ 1,000 W en el pico. A 127 V son ≈ 8.3 A, y con el 125 %, ≈ 10.4 A: **sí cabe** en un circuito de 15 A, siempre que sea dedicado (nada de compartirlo con el esterilizador). El calor, ≈ 3,400 BTU/h, lo saca el aire del consultorio si está prendido; de noche, la workstation se apaga o se va a un cuarto con aire. Si la clínica pone **dos** de esas GPUs (≈ 1,600 W), son ≈ 16.6 A con el 125 %: ya no cabe en 15 A. El salto de una a dos GPUs es el salto de «se enchufa» a «llama al electricista».

**Una fábrica con un modelo en la planta.** Supuesto del ejemplo: una planta quiere un LLM junto a la línea de producción, sin depender de internet. El problema no es la potencia sino el ambiente: en una nave sin aire puede hacer 35 °C, en el borde del rango «permitido» de ASHRAE para la clase A2, con polvo y vibración. Ahí la respuesta es un gabinete cerrado con su propio aire, o un servidor hecho para ese ambiente (cada fabricante publica su rango).

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un servidor jala 1,800 W en el pico, con factor de potencia 0.95. ¿Cuántos amperes jala a 127 V y a 220 V, y qué interruptor mínimo pide cada uno con la regla del 125 %?
A 127 V: \(I\) = 1,800 ÷ (127 × 0.95) ≈ **14.9 A**; × 1.25 ≈ **18.7 A** → un interruptor de 20 A. A 220 V: \(I\) = 1,800 ÷ (220 × 0.95) ≈ **8.6 A**; × 1.25 ≈ **10.8 A** → cabe en 15 A con margen.
? [facil] ¿Cuántos BTU por hora y cuántas toneladas de refrigeración son los 10.2 kW de un DGX H100?
\(Q_{BTU}\) = 10,200 × 3.41214 ≈ **34,804 BTU/h** (la misma cifra que da NVIDIA). \(Q_{t}\) = 10,200 ÷ 3,516.853 ≈ **2.9 toneladas**: con el 60 % de calor sensible, casi cinco minisplits de 1 tonelada.
? [facil] Un servidor de 2,000 W con factor de potencia 0.95. ¿Qué UPS mínimo pide con 25 % de holgura?
2,000 ÷ 0.95 ≈ 2,105 VA; × 1.25 ≈ **2,632 VA**. Un UPS de 3 kVA alcanza, siempre que sus watts (≈ 2.7 kW en el de APC) también pasen de 2,000 W, y pasan.
? [facil] Con la tarifa PDBT de Valle de México Centro (≈ $3.565 por kWh, antes de IVA), ¿cuánto cuesta al mes un equipo que jala 1 kW parejo las 730 horas, sin contar el aire?
1 kW × 730 h = 730 kWh; 730 × 3.565 ≈ **$2,602 al mes**, antes de IVA. Con una PUE de 2.0, el doble: ≈ $5,205.
? [medio] El despacho arranca con 3 L40S en vez de 4. Recalcula el pico de papel, la corriente a 220 V, el interruptor mínimo y la carga térmica del cuarto con los 500 W que ya había. ¿Cambia alguna decisión?
Pico: 3 × 350 + 400 + 700 = **2,150 W**. A 220 V: 2,150 ÷ (220 × 0.95) ≈ 10.3 A; × 1.25 ≈ **12.9 A**: cabe en 15 A con algo de margen. Carga térmica: 2,150 + 500 = 2,650 W ≈ 9,042 BTU/h ≈ 0.75 t; minisplit nominal: 2,650 ÷ 0.6 ≈ 4,417 W ≈ 1.26 t. Con 3 GPUs, un circuito de 15 A y un minisplit de 1.5 t (3,165 W útiles) alcanzan con margen. Con la cuarta quedan al filo: el de 15 A por 0.05 A (≈ 8 W de carga) y el de 1.5 t por 165 W. En papel caben; en la práctica no, porque el pico es una estimación. Por eso se diseña para 4: **no cambia nada** si ya se hizo para el servidor lleno (20 A y 2 t); si se hubiera hecho para 3, la cuarta obligaría a cambiar interruptor y aire.
? [medio] Con 220 V y el servidor del despacho de 2,500 W, el electricista propone un interruptor de 15 A «porque la cuenta da 14.95 A». ¿Qué le contestas?
Que la cuenta da 14.95 A con un factor de potencia supuesto de 0.95 y un resto del servidor estimado. Si el factor real es 0.92, \(I\) = 2,500 ÷ (220 × 0.92) ≈ 12.4 A y × 1.25 ≈ **15.4 A**: ya no cabe. Y si el resto jala 100 W más, tampoco. Un diseño que cabe por 0.05 A no tiene margen para ningún supuesto. Se pone de **20 A**, que cabe con ≈ 5 A de sobra.
? [medio] Un cuarto de TI tiene 1,200 W de equipos. Le van a meter un servidor de 2,500 W. ¿Qué minisplit nominal hace falta con \(k\) = 0.6, y cuántos con N+1?
Carga térmica: 1,200 + 2,500 = 3,700 W. Nominal: 3,700 ÷ 0.6 ≈ 6,167 W ≈ **1.75 t** → el tamaño comercial siguiente, 2 t (24,000 BTU/h ≈ 7,034 W nominales; × 0.6 ≈ 4,220 W útiles ≥ 3,700). Con N+1: **dos de 2 t**, cada uno capaz de cargar el cuarto solo.
? [medio] El servidor del despacho se lleva a colocation con PUE 1.56, y ahí el sitio le cobra la luz a ≈ $3.565 por kWh (supuesto). Con 784 kWh al mes del servidor, ¿cuánto pagaría de luz contra ≈ $5,591 en su oficina con PDBT y PUE 2.0?
784 × 1.56 ≈ 1,223 kWh; × 3.565 ≈ **$4,361**. Ahorra ≈ $1,230 al mes en luz, ≈ 22 %. Pero un colocation cobra sobre todo por kW contratado y espacio, y esos precios no se publican: decide la cotización completa, no la luz.
? [reto] Las 4 fuentes del Exxact están repartidas en dos circuitos, dos en cada uno. ¿Hasta qué pico aguanta el servidor la caída de un circuito a 127 V y a 220 V? Con el pico de 2,500 W, ¿cuánta capacidad le sobra o le falta en cada caso?
Con un circuito caído quedan 2 fuentes. A 127 V: 2 × 1,000 = **2,000 W** de tope; contra 2,500 W **faltan 500 W**: el servidor se apaga, o la redundancia solo funciona si el servidor jala menos de 2 kW. A 220 V: 2 × 2,600 = **5,200 W**; contra 2,500 W **sobran 2,700 W**. Incluso con una sola fuente viva (2,600 W) aguantaría el pico, por 100 W. A 127 V la redundancia es de mentira; a 220 V es de verdad.
? [reto] El servidor del despacho trabaja de noche resumiendo expedientes en lote: ahora pasa las 730 horas al ritmo de uso (1.64 kW). Con GDBT y PUE 2.0, ¿cuánto cuesta la luz al mes? ¿Cuánto más que con el horario de oficina? ¿Cambia la demanda?
Energía: 1.64 × 730 ≈ 1,197 kWh; × 2.0 ≈ 2,394 kWh; × 1.942 ≈ **$4,649**. Demanda, con la aproximación de la lección: 1.64 × 2.0 × 542.70 ≈ **$1,780**, igual que antes. Total ≈ **$6,429**, ≈ $1,604 más que los ≈ $4,825 del horario de oficina. Si en el recibo manda la demanda máxima medida, no cambia: cuenta los 15 minutos de más consumo, no cuánto rato, y el servidor ya jalaba 1.64 kW de día. Entonces trabajar de noche solo paga energía, y es la forma barata de usar más el servidor. Si manda la cifra calculada con los kWh del mes, esos kWh de más también suben la demanda cobrada; lo dice el recibo.
? [reto] Un despacho más grande quiere un servidor [[hgx|HGX]] B200 de 8 GPUs (≈ 14.3 kW, como el DGX B200) en su cuarto de oficina. Con lo de esta lección, haz la lista de lo que cambia: corriente a 220 V monofásica, interruptor, calor en toneladas, minisplits con \(k\) = 0.6 y N+1, UPS con 25 % de holgura y factor de potencia 0.95.
Corriente: 14,300 ÷ (220 × 0.95) ≈ **68 A**; × 1.25 ≈ **86 A**: fuera de cualquier circuito de oficina, pide alimentación trifásica y un tablero propio. Calor: 14,300 W ≈ 48,794 BTU/h ≈ **4.1 t**; nominal: 14,300 ÷ 0.6 ≈ 23,833 W ≈ **6.8 t** de minisplits, más otro tanto por N+1: es un aire de precisión, no minisplits. UPS: 14,300 ÷ 0.95 × 1.25 ≈ **18.8 kVA**. Ruido y peso (el DGX H100 pesa ≈ 130 kg) también cambian. Conclusión: es un equipo para un centro de datos.
:::

## Lo que sigue {What comes next}

- **«[Comprar hardware: de la workstation al rack](/comprar-hardware/)»** decide qué servidor entra al cuarto; su [[tdp|TDP]] y sus fuentes son los números de entrada de esta lección.
- **«[Varias GPUs: tensor y pipeline parallel](/varias-gpus/)»**: cuándo un modelo se parte entre GPUs, y por qué ahí sí importan NVLink, RDMA e InfiniBand.
- **«[Observabilidad de GPUs e inferencia](/observabilidad/)»** vigila lo que aquí se pide medir: potencia, temperatura y reloj.
- **«[Seguridad: aislamiento, sin internet y actualizaciones](/seguridad/)»** sigue con la red de gestión, el BMC y lo que cambia si el servidor se va a colocation.
- **«[TCO: API, nube o servidor propio](/costo-total/)»** mete la luz, el UPS y el aire en la comparación completa; mientras, usa la [herramienta de costo total](/herramientas/tco/).
- **«[Cotizar, proponer y dar soporte](/cotizar/)»** ve cómo se cotiza todo esto en México, incluida la importación del hardware.
- En Sensei: [CPU y GPU](https://sensei.trueml.app/cpu-gpu/) tiene PCIe, NVLink y el throttling; [Máquinas, GPUs y cómo se cobran](https://sensei.trueml.app/maquinas/), lo que cuesta rentar en vez de tener cuarto.

## Palabras que vas a oír {Words you'll hear}

:::conceptos
potencia-electrica factor-de-potencia circuito-dedicado fuente-redundante ups carga-termica tonelada-de-refrigeracion pasillo-caliente enfriamiento-liquido rdma infiniband bmc colocation
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué el servidor del despacho va a 220 V y no a 127 V?
A 127 V jala ≈ 20.7 A y con el 125 % de la NOM pide ≈ 26 A, más que un circuito de 20 A. Y sus fuentes dan solo 1,000 W cada una a 127 V: con un circuito caído, las 2 que quedan dan 2,000 W, menos que el pico de 2,500 W.
? ¿Qué dice la regla del 125 % de la NOM-001-SEDE-2012?
Que para una carga continua, como un servidor prendido 24 horas, el cable y el interruptor deben aguantar al menos el 125 % de la corriente de la carga. Dicho al revés: la carga no pasa del 80 % del interruptor.
? ¿Por qué un minisplit de 1 tonelada no alcanza para 0.85 toneladas de calor?
Porque un aire de confort gasta ≈ 40 % de su capacidad en quitar humedad, y da como calor sensible ≈ 60 % de lo que dice su caja: ≈ 2,110 W contra 3,000 W de carga.
? ¿Para qué sirve el UPS del despacho, si solo da minutos?
Para que el servidor se apague bien: el UPS le avisa por red o USB y un programa cierra el servidor de modelos y el sistema operativo antes de que se acabe la batería. Para seguir trabajando haría falta una planta de emergencia.
? ¿Cuánto ancho de banda necesitan los 200 abogados del despacho?
Casi nada: ≈ 17 kbit/s en promedio y ≈ 43 kbit/s en la hora pico, ≈ 0.002 % de un enlace de 1 GbE. El 10 GbE del servidor es para bajar modelos, indexar y respaldar.
? ¿Qué es el BMC y por qué va en una red aparte?
Un controlador independiente del sistema operativo que enciende, apaga y administra el servidor por red, aunque esté apagado. Da control por debajo del sistema operativo, así que se encierra en una VLAN de gestión sin internet, con VPN y contraseña propia.
? ¿Qué gana el despacho con colocation y qué pierde?
Gana una PUE de ≈ 1.3–1.56 en vez de ≈ 2.0, y circuitos, UPS, planta y aire redundantes que no cuida él. Pierde cercanía: un enlace que pagar, viajes, y que los expedientes salgan físicamente de la oficina, lo que hay que revisar contra sus contratos.
:::
