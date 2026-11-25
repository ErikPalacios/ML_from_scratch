---
titulo: Catálogo de hardware
en: hardware catalog
subtitulo: GPUs y equipos para servir LLMs, de la Mac de escritorio al servidor de 8 GPUs, con VRAM, ancho de banda, consumo y precio de compra de referencia, cada número con su fecha y su fuente.
pregunta: ¿Qué hardware existe para correr un modelo abierto en la empresa, qué tiene cada uno y cuánto cuesta?
sensei: cpu-gpu, maquinas
---

:::idea
Para servir un LLM, de una GPU importan pocas cosas: **cuánta memoria tiene** (decide qué modelo cabe), **qué tan rápido la lee** (decide cuántos tokens por segundo escribe), **cuánto calcula** (decide cuánto tardas en leer un prompt largo), **cuánto consume** (luz y calor) y **cuánto cuesta**. Este catálogo pone esas cinco columnas lado a lado para NVIDIA, AMD y Apple, filtra por lo que necesitas y dice de dónde salió cada número.
:::

## Cómo leer la tabla {How to read the table}

Comprar una GPU para IA se parece a comprar un camión de reparto. Importa cuánta carga le cabe (la VRAM), qué tan rápido va (el ancho de banda), qué tanta fuerza tiene para subir una pendiente (el cálculo), cuánta gasolina gasta (el consumo) y cuánto cuesta. Un camión enorme y lento no sirve para entregas rápidas; uno rápido y chico no carga los muebles. Cada columna de la tabla es una de esas preguntas.

- **VRAM.** La memoria de la tarjeta, la [[vram|VRAM]], en GB (10⁹ bytes). Tiene que caber el modelo con su [[kv-cache|KV cache]]; la cuenta está en «¿Cabe en la GPU?». En las Mac y en la DGX Spark es [[memoria-unificada|memoria unificada]]: la comparten la CPU y la GPU, y el sistema operativo se queda con una parte.
- **Ancho de banda.** Cuántos GB por segundo pasan de esa memoria a los núcleos, el [[ancho-de-banda|ancho de banda]]. Es la columna que más se parece a la velocidad del [[decode]].
- **Consumo máximo.** Los watts que la tarjeta (o el equipo entero, en las Mac y la DGX Spark) puede llegar a pedir. Sirve para la luz, el enfriamiento y saber si cabe en el contacto de la oficina.
- **FP16 y FP8 densos.** El [[pico-de-calculo|pico de cálculo]] en esos formatos, en TFLOPS, **sin sparsity**. Decide el [[prefill]]. Apple no publica el suyo, y la DGX Spark solo publica su cifra en FP4 con sparsity: por eso esas celdas dicen «—».
- **Techo de decode.** Una columna calculada: el ancho de banda entre 5.73 GB, lo que pesa Llama 3.1 8B en INT4 de AWQ. Son los tokens por segundo de una conversación si la memoria trabajara al 100 %. No es una medición: sirve para comparar equipos con una sola regla. Para una estimación real, multiplica por la eficiencia de «Qué tan rápido contesta» (≈ 0.7 en un servidor de producción, ≈ 0.5 en una Mac).
- **Compra de referencia.** Un precio de compra por tarjeta o equipo, en dólares, sin impuestos, del día que dice debajo. Las notas al final de la tabla dicen qué se vio y en dónde.
- **GB de VRAM por cada US$1,000.** Otra columna calculada: cuánta memoria compras con mil dólares. Las Mac y las Radeon ganan aquí; las GPUs de centro de datos, no.
- **Renta más barata por hora.** La renta por GPU más barata que trae el archivo de datos, con su proveedor y su fecha. Viene de la lección «Máquinas, GPUs y cómo se cobran» de Sensei.

:::ojo
Los precios de compra de este catálogo son **referencias, no cotizaciones**. Muchas tiendas solo dan precio al cotizar; varias de las que lo publican bloquearon la consulta automática; algunas tarjetas solo se consiguen usadas o reacondicionadas, y el mercado de GPUs sube y baja mucho en semanas. Usa estos números para comparar y para el primer cálculo de un proyecto; para venderle a un cliente, pide cotización con fecha.
:::

## El catálogo {The catalog}

:::catalogo
:::

## Por qué algunas no tienen precio de tarjeta {Why some have no card price}

Las GPUs más grandes de NVIDIA (H100 SXM, H200, B200) usan un formato llamado SXM: no son tarjetas que se conectan a una ranura, sino módulos soldados en una placa de 8 GPUs (HGX) que va dentro de un servidor hecho para ella. Nadie las vende sueltas. El precio que aparece en la tabla es el de un servidor completo de 8 GPUs **dividido entre 8**: incluye la CPU, la RAM, los discos, la red y las fuentes de poder. Por eso no hay que sumarle «el resto del servidor» en la herramienta de TCO.

Lo mismo pasa con las AMD Instinct (formato OAM): se venden en servidores de 8 y por cotización. No encontré un precio público verificable para ninguna.

En cambio, la L4, la L40S, las H100 PCIe y NVL y las RTX sí son tarjetas PCIe: se compran sueltas y se meten en un servidor o una workstation. Ahí sí hay que sumar el resto del equipo.

:::cuenta Lo que cuesta una H100 SXM dentro de su servidor
Servidor de 8 H100 SXM // Exxact TensorEX 6U, configurador, nivel Essential, 2026-11-25 | US$306,152 | —
Por GPU | 306,152 ÷ 8 | **≈ US$38,269**
Una H100 PCIe suelta // IT Creations, nueva en empaque OEM, 2026-11-25 | US$28,995 | más el servidor
= La SXM sale más cara por GPU, pero trae su servidor y una red NVLink entre las 8 que la PCIe no tiene. No se comparan tarjeta contra tarjeta.
:::

## Qué conviene, según para qué {What fits, by use} [extra]

No hay una GPU «mejor»: depende de qué modelo, cuántas personas y cuánto dinero. Tres patrones que se ven en la tabla:

- **Para una persona o un equipo chico, con modelos grandes: memoria unificada.** Una Mac Studio con 256 GB o una DGX Spark con 128 GB cargan modelos que no caben en ninguna tarjeta de escritorio. Pero su ancho de banda es bajo para su tamaño (la DGX Spark lee 273 GB/s): escriben despacio y aguantan pocas conversaciones a la vez. Son para probar y para pocos usuarios.
- **Para una oficina, con modelos medianos: tarjetas PCIe de workstation o L40S.** Una RTX PRO 6000 Blackwell (96 GB, 1,792 GB/s) o una L40S (48 GB, 864 GB/s) caben en un servidor normal, se enfrían con aire y atienden a decenas de personas con un modelo de 8B a 32B cuantizado. La herramienta de sizing dice cuántas.
- **Para cientos de usuarios o modelos de 70B en adelante: servidores de 8 GPUs.** H100, H200 o B200 en su servidor, unidas por NVLink. Cuestan cientos de miles de dólares, consumen como 10 kW o más y piden un cuarto con enfriamiento serio, o rentarlas.

Las tarjetas de jugador (RTX 4090 y 5090) tienen mucho ancho de banda por dólar, pero poca memoria, sin el ECC con reporte y registro de las de centro de datos, con licencias de NVIDIA que limitan su uso en centros de datos y precios muy por encima de su lanzamiento. Sirven para un laboratorio; para un cliente, con cuidado.

## Errores comunes {Common mistakes}

1. **Comparar por TFLOPS.** El pico de cálculo es la cifra más grande de la hoja de datos y la que menos dice de la velocidad de un chat. **Cómo evitarlo:** para tokens por segundo, ordena por ancho de banda; para prompts largos, mira el cálculo.
2. **Leer la cifra con sparsity.** NVIDIA suele anunciar el doble del pico que usan los servidores de LLMs. **Cómo evitarlo:** usa las columnas densas de este catálogo, o divide entre 2 la cifra con asterisco.
3. **Tomar la memoria unificada como VRAM.** Una Mac de 128 GB no deja 128 GB para el modelo: macOS se queda con una parte. **Cómo evitarlo:** deja ≈ 25 % libre al dimensionar una Mac.
4. **Sumar «el resto del servidor» a una GPU SXM.** Su precio de referencia ya es el de un servidor entre 8. **Cómo evitarlo:** en la herramienta de TCO, pon el resto del servidor en 0 para H100 SXM, H200 y B200.
5. **Cotizar con un precio de hace meses.** Las RTX 4090 y 5090 cuestan hoy el doble o más de su precio de lanzamiento. **Cómo evitarlo:** mira la fecha de cada precio y vuelve a consultarlo antes de comprometerte.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Con la columna de techo de decode, ¿cuántas veces más rápido escribe una H200 que una L40S, con el mismo modelo y una conversación?
H200: 4,800 GB/s; L40S: 864 GB/s. 4,800 ÷ 864 ≈ **5.6 veces**. El techo de la tabla da lo mismo: ≈ 838 contra ≈ 151 tokens por segundo.
? [facil] ¿Cuántos GB de VRAM compras con US$10,000 en una L40S, a su precio de referencia de US$9,005?
Con una tarjeta te alcanza: 48 GB por US$9,005, o sea ≈ 5.3 GB por cada US$1,000. Con US$10,000, **una L40S, 48 GB**, y te sobran ≈ US$1,000 para el resto del servidor, que no alcanza.
? [medio] Llama 3.3 70B en INT4 de AWQ pesa ≈ 39.8 GB (la cuenta de «¿Cabe en la GPU?»). ¿Cabe en una DGX Spark de 128 GB, y a cuántos tokens por segundo escribiría con una conversación, si su eficiencia de memoria es 0.5?
Cabe de sobra: 39.8 GB más KV cache contra 128 GB compartidos. Techo: 273 GB/s ÷ 39.8 GB ≈ 6.9 tokens por segundo; con \(η_m\) = 0.5, **≈ 3.4 tokens por segundo**. Más lento de lo que una persona lee cómoda: cabe, pero no sirve para un chat.
? [reto] Un cliente dice: «compremos 4 RTX 5090 en vez de una H100, salen más baratas y suman más VRAM». ¿Qué le contestas con la tabla?
4 RTX 5090: 128 GB y 4 × 1,792 GB/s ≈ 7,170 GB/s en total, por ≈ 4 × US$7,350 = US$29,400 solo en tarjetas, a su precio de escasez de hoy (su mediana de los últimos 3 meses fue ≈ US$2,000). Una H100 SXM: 80 GB y 3,350 GB/s, ≈ US$38,269 con su servidor. En números, las 5090 ganan. Pero: se conectan por PCIe, sin NVLink, así que repartir un modelo entre las 4 pierde mucho en cada paso; consumen 4 × 575 = 2,300 W; su memoria corrige errores sola, pero no los reporta ni registra como una GPU de centro de datos; la licencia de su driver no permite usarlas en un centro de datos; y su precio es casi 4 veces el de lanzamiento. **Para un laboratorio, sí; para producción en un cliente, es un riesgo que hay que explicarle.**
:::

## Palabras que vas a oír {Words you'll hear}

:::conceptos
memoria-unificada sxm sparsity
:::
