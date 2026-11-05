---
titulo: Una foto, vista por un modelo
en: A photo, as a model sees it
subtitulo: Cómo una foto se convierte en una tabla de números, qué pasos la dejan lista para el modelo y por qué esos pasos tienen que ser idénticos al entrenar y al servir.
pregunta: Si un modelo solo entiende números, ¿qué le llega exactamente cuando Ana sube la foto de sus tenis?
minutos: 30
requisitos: modelo
---

:::idea
Para un modelo, una foto es una cuadrícula de números: tres por cada píxel. Antes de entrar se decodifica, se gira, se achica, se recorta y se normaliza hasta quedar en una tabla de 150,528 números de forma [1, 3, 224, 224], que se llama tensor. Si esa preparación cambia en un detalle entre el entrenamiento y la producción, nada truena: el modelo simplemente acierta menos.
:::

## Una foto es una cuadrícula {A photo is a grid}

En la lección anterior viste que el modelo de C01 recibe 150,528 números. ¿De dónde salen, si Ana subió una foto?

Acércate mucho a cualquier foto en tu celular, haciendo zoom hasta que ya no se pueda más. En algún momento dejas de ver tenis y empiezas a ver cuadritos, cada uno de un solo color. Cada cuadrito es un [[pixel|píxel]] (de *picture element*, «elemento de imagen»). Una foto digital no es otra cosa: una cuadrícula de píxeles, tantos de ancho por tantos de alto.

Cuántos píxeles tiene es su [[resolucion|resolución]], y se dice como ancho × alto. Muchos celulares toman fotos de 4032 × 3024:

`4032 × 3024 = 12,192,768 píxeles`

Un **megapíxel** (MP) es un millón de píxeles, así que esa foto tiene ≈ 12.2 MP. Es el número que anuncian las cámaras de los celulares.

Más píxeles quiere decir más detalle, pero también más números que guardar y que procesar. Esa tensión aparece en todo C01: la cámara de Ana toma 12 MP, y el modelo solo necesita 224 × 224 = 50,176 píxeles. Es decir, de cada 243 píxeles de la foto original, el modelo termina usando el equivalente a uno (12,192,768 ÷ 50,176 = 243).

## Tres números por píxel: RGB {Three numbers per pixel: RGB}

¿Y cómo se guarda el color de un píxel? Con tres números: cuánta luz **roja**, cuánta **verde** y cuánta **azul** tiene. Por las iniciales en inglés (*red, green, blue*) se le llama [[rgb|RGB]]. Mezclando esas tres luces en distintas cantidades sale cualquier color de la pantalla, que es justo como funciona: cada píxel de tu pantalla son tres lucecitas, una roja, una verde y una azul.

### Del 0 al 255

Cada uno de los tres números va de 0 (nada de esa luz) a 255 (toda):

| Color | R | G | B |
|---|---|---|---|
| Negro | 0 | 0 | 0 |
| Blanco | 255 | 255 | 255 |
| Rojo puro | 255 | 0 | 0 |
| Gris medio | 128 | 128 | 128 |
| El naranja de los tenis de la figura | 236 | 106 | 63 |

¿Por qué 255? Por cómo guarda números una computadora. Su unidad mínima es el **bit**, que solo puede valer 0 o 1. Ocho bits forman un **byte**. Con 8 bits hay 2 × 2 × 2 × 2 × 2 × 2 × 2 × 2 = 2⁸ = 256 combinaciones posibles, así que un byte puede guardar los enteros del 0 al 255. A ese tipo de número se le llama [[uint8]]: *unsigned* (sin signo, es decir, sin negativos), *int* (entero) y 8 (bits).

Con tres canales de 256 valores cada uno hay 256 × 256 × 256 = 16,777,216 colores posibles. Por eso se dice que las pantallas muestran «16.7 millones de colores».

:::figura imagenes-pixeles
Arriba, la foto y un acercamiento a la orilla de la suela: 9 píxeles. Abajo, los mismos 9 píxeles como los ve el modelo: tres cuadrículas de números, una por color. El primer píxel está marcado en las cuatro cuadrículas.
:::

### Los canales

Fíjate en la parte de abajo de la figura. En vez de pensar en «9 píxeles con 3 números cada uno», puedes pensar en «3 cuadrículas de 9 números»: la de los rojos, la de los verdes y la de los azules. Cada una de esas cuadrículas se llama [[canal]]. Es la misma información, acomodada de otra forma, y es justo la forma en que la recibe el modelo de C01.

No todas las imágenes tienen tres canales:

- Una foto en **blanco y negro** tiene uno solo: qué tan claro es cada píxel.
- Una imagen con **transparencia** tiene cuatro: RGBA. La A (*alpha*) dice qué tan opaco es cada píxel.

El modelo de C01 espera exactamente tres. Por eso, antes de nada, toda imagen se convierte a RGB: a la de blanco y negro se le copia su único canal tres veces, y a la RGBA se le quita la transparencia.

### Cuánto ocupa una foto «abierta»

Ya puedes calcular cuánta memoria ocupa la foto de 12 MP como píxeles:

`4032 × 3024 píxeles × 3 canales × 1 byte = 36,578,304 bytes ≈ 36.6 MB`

Unos 36.6 megabytes, y eso que cada número ocupa un solo byte. Guarda este número: en un momento vas a ver que el archivo que manda el celular pesa mucho menos.

## Del archivo a la cuadrícula: decodificar {From file to grid: decoding}

Si una foto abierta ocupa 36.6 MB, ¿por qué el archivo en tu celular pesa unos 3 MB (más o menos, según la foto y la calidad con que se guardó)? Porque el archivo no guarda la cuadrícula tal cual: guarda una versión comprimida. Convertir ese archivo comprimido de vuelta en la cuadrícula de píxeles se llama [[decodificar]] (*decode*).

Antes de decodificar, la foto de Ana es una ristra de bytes que no se parece en nada a una cuadrícula. No se le puede preguntar «¿de qué color es el píxel 10?» sin decodificarla primero.

### JPEG y PNG

Hay muchos formatos de archivo de imagen. C01 acepta tres: JPEG, PNG y WebP. Los dos que más vas a ver:

| | [[jpeg\|JPEG]] | [[png\|PNG]] |
|---|---|---|
| Cómo comprime | **Con pérdida:** descarta detalle fino que el ojo casi no nota | **Sin pérdida:** al decodificar salen exactamente los mismos píxeles |
| Para qué es bueno | Fotos | Capturas de pantalla, logos, dibujos |
| Transparencia | No | Sí (puede traer 4 canales) |
| Tamaño de una foto de 12 MP | Unos 3 MB | Bastante más que el JPEG |
| Metadatos EXIF | Casi siempre | Rara vez |

JPEG divide la imagen en bloques de 8 × 8 píxeles y en cada uno se queda con lo importante. Cuanto más se comprime, más se notan esos bloques: es la foto «pixeleada» que se ve cuadriculada cuando alguien la reenvió muchas veces. De 36.6 MB a 3 MB es una compresión de más de 10 veces.

:::ojo La foto que llega no es la que tomó la cámara
En C01, la app del celular suele achicar la foto antes de mandarla: las fotos móviles llegan pesando unos 200 KB. Las que suben desde la computadora pueden pesar hasta 10 MB (el límite del servicio). El modelo tiene que funcionar con las dos.
:::

### Decodificar cuesta

Decodificar no es gratis. Una foto de 12 MP hay que reconstruirla píxel por píxel en el procesador principal de la computadora (la CPU), y luego ocupa 36.6 MB de memoria. El modelo, en cambio, corre en una GPU: un chip hecho para hacer miles de cuentas sencillas a la vez. En C01, decodificar y preparar una foto toma unos 6 ms de CPU en promedio: tanto o más de lo que tarda el propio modelo en la GPU (≈ 3 a 6 ms). Lo vas a ver en la lección «CPU y GPU».

También es un riesgo. Un archivo chiquito puede estar hecho para decodificarse en una imagen gigantesca que se coma toda la memoria del servidor (se llama *decompression bomb*, bomba de descompresión). Por eso C01 lee primero el tamaño que dice el encabezado del archivo, sin decodificar, y rechaza cualquier foto de más de 40 MP. Una de 40 MP abierta ya ocupa 40,000,000 × 3 = 120 MB en RGB, y un PNG de 40 MP con transparencia y 16 bits por canal (PNG lo permite) llega a 40,000,000 × 4 canales × 2 bytes = 320 MB.

:::ojo El mismo archivo, píxeles un poco distintos
Dos librerías que decodifican JPEG, o dos versiones de la misma, pueden dar píxeles que difieren en una o dos unidades. Y algunas los entregan en otro orden: OpenCV, una librería muy usada, da los colores como BGR (azul, verde, rojo) en vez de RGB. Si no lo sabes, el naranja (236, 106, 63) llega al modelo como (63, 106, 236): un azul. Vuelve a aparecer en la última sección.
:::

### Lo que la foto trae escondido: EXIF

Además de los píxeles, un JPEG suele traer datos escondidos que se llaman [[exif|EXIF]]: qué teléfono la tomó, la fecha y la hora, la exposición, cómo estaba girado el teléfono y, muchas veces, las coordenadas GPS de dónde se tomó. Importan por dos razones.

**La orientación.** Muchos teléfonos guardan los píxeles siempre «acostados», como los ve el sensor, y anotan en el EXIF cómo hay que girarlos. Si Ana tomó la foto con el celular de pie, el archivo trae 4032 × 3024 píxeles acostados y una nota: orientación 6, «gira 90° a la derecha para verla bien». Tu galería aplica esa nota sin que te des cuenta, y por eso tú la ves derecha. Pero una librería que solo lee los píxeles la entrega de lado. Pillow, la librería de imágenes más común en Python, no la gira a menos que se lo pidas; OpenCV, en sus versiones actuales, la gira sola al leer, a menos que le pidas que no. Si un lado gira y el otro no, el modelo ve tenis acostados.

**La privacidad.** Con las coordenadas GPS de la foto de unos tenis tomada en la sala de Ana, cualquiera podría saber dónde vive. Por eso en C01 ni la foto ni su EXIF se guardan en los registros, y las pocas fotos que se copian para que una persona las etiquete (≈ 5,000 al mes) se guardan sin EXIF. Lo ves a fondo en la lección «Datos personales y la ley».

:::profundo Decodificar «a la mitad»: el draft mode de JPEG
Como JPEG trabaja por bloques de 8 × 8, un decodificador puede reconstruir la foto directamente a la mitad, a la cuarta o a la octava parte del tamaño, sin calcular todos los píxeles. Es mucho más rápido cuando de todos modos vas a achicar la foto a 256. C01 lo usa (Pillow lo llama *draft mode*). Pero el resultado no es idéntico a decodificar completo y luego achicar, así que si se usa en producción hay que usarlo también al entrenar.
:::

## Preparar la foto para el modelo {Preprocessing for ResNet-50}

Ya tienes la cuadrícula de píxeles, derecha y en RGB. Todavía no se la puedes dar al modelo: la ResNet-50 de C01 espera una entrada de un tamaño exacto, con números de cierto tipo y en cierta escala. Todos los pasos que convierten la foto cruda en esa entrada exacta se llaman [[preprocesamiento]] (*preprocessing*).

Sigamos la foto de 12 MP de Ana, ya girada: 3024 de ancho × 4032 de alto.

:::pasos
1. Resize: el lado corto a 256
Se achica la foto sin deformarla, hasta que su lado más corto mida 256. El ancho pasa de 3024 a 256, y el alto se achica en la misma proporción: 4032 × 256 ÷ 3024 = 341.3, que se redondea a 341. Queda de 256 × 341. A eso se le llama [[resize]]. Al achicar, cada píxel nuevo se calcula mezclando varios de los viejos; la forma de mezclarlos se llama interpolación, y hay varias (C01 usa la *bilinear*).
2. Center crop: el cuadro del centro
El modelo espera un cuadrado de 224 × 224, así que se recorta el cuadro del centro: es el [[crop]]. A lo ancho sobran 256 − 224 = 32 píxeles, 16 de cada lado. A lo alto sobran 341 − 224 = 117, unos 58 arriba y 59 abajo. ¿Por qué 256 y luego 224, y no directo a 224? Porque así se entrenó la ResNet-50 original: el recorte se queda con el centro y descarta un poco de orilla.
3. A float32 y entre 255
Hasta aquí cada número es un uint8 de 0 a 255. Se convierte a [[float32]], un número con decimales que ocupa 4 bytes, y se divide entre 255: ahora cada número va de 0 a 1. El naranja 236 queda en 236 ÷ 255 = 0.925.
4. Normalizar
A cada número se le resta un promedio y se divide entre una desviación, distintos para cada canal. Es la [[normalizacion|normalización]], y la vemos con números abajo.
5. Reordenar y agrupar
Se acomodan los números en el orden que espera el modelo, primero por canal, y se les agrega una dimensión más al frente. Queda el [[tensor]] [1, 3, 224, 224], que es la siguiente sección.
:::

:::figura imagenes-preproceso
El camino completo de la foto de 12 MP, con su tamaño en cada paso. El orden exacto de algunos pasos cambia según la librería, pero el resultado es el mismo.
:::

:::ojo Primero achicar, luego convertir
Si conviertes la foto completa a float32 antes de achicarla, ocupa 36.6 MB × 4 = 146 MB en memoria, solo para tirar casi todo un paso después. Por eso se achica primero, en uint8, y se convierte al final, cuando ya son 224 × 224.
:::

:::ojo El recorte del centro puede cortar lo importante
De la foto de pie, el center crop se queda con 224 de 341 píxeles de alto: el 66 %. Si Ana tomó los tenis pegados a la parte de arriba de la foto, una parte puede quedarse fuera. El preprocesamiento asume que lo importante está en medio, y casi siempre es cierto, pero no siempre.
:::

### La normalización, con números

Después de dividir entre 255, cada número va de 0 a 1. La normalización lo mueve para que quede alrededor de 0:

`valor normalizado = (valor − media del canal) ÷ desviación del canal`

Para los modelos entrenados con **ImageNet** (un dataset famoso de ≈ 1.28 millones de fotos en 1,000 clases, con el que se entrenó la ResNet-50 original), los números son estos:

| Canal | Media | Desviación |
|---|---|---|
| R | 0.485 | 0.229 |
| G | 0.456 | 0.224 |
| B | 0.406 | 0.225 |

Son el promedio y la desviación estándar (qué tanto se alejan los valores de su promedio) de cada canal en las fotos de ImageNet. Lo normal es partir de un modelo ya entrenado con ImageNet y ajustarlo a tus categorías (eso es el [[transfer-learning]]), y entonces se conservan sus números. C01 los usa: en la Ronda verás «normalización ImageNet».

:::ejemplo El píxel naranja, normalizado
El píxel (236, 106, 63), canal por canal:

- **R:** 236 ÷ 255 = 0.925 → (0.925 − 0.485) ÷ 0.229 = 0.440 ÷ 0.229 ≈ **1.92**
- **G:** 106 ÷ 255 = 0.416 → (0.416 − 0.456) ÷ 0.224 = −0.040 ÷ 0.224 ≈ **−0.18**
- **B:** 63 ÷ 255 = 0.247 → (0.247 − 0.406) ÷ 0.225 = −0.159 ÷ 0.225 ≈ **−0.71**

El modelo no recibe «236, 106, 63», sino «1.92, −0.18, −0.71». Un negro puro (0, 0, 0) queda en −2.12, −2.04 y −1.80; un blanco puro, en 2.25, 2.43 y 2.64. Todo cae, más o menos, entre −2 y +3.
:::

¿Para qué tanta vuelta? Porque las cuentas del entrenamiento funcionan mucho mejor con números chicos alrededor de 0 que con números de 0 a 255 (lo vas a entender en la lección «Cómo aprende un modelo»). Y una vez que el modelo aprendió con números preparados así, **solo sabe interpretar números preparados así**.

### Así se ve en código

Esto es casi exactamente lo que trae la Ronda en M07, con PyTorch (la librería de Python más usada para entrenar y correr redes neuronales). No necesitas entender cada línea todavía: fíjate en que cada paso de arriba es una línea.

```python
from PIL import Image, ImageOps
import torch
from torchvision.transforms import v2 as T

TF = T.Compose([
    T.ToImage(),                           # de Pillow a tensor (orden CHW), todavía uint8
    T.Resize(256),                         # el lado corto a 256
    T.CenterCrop(224),                     # el cuadro del centro, 224 × 224
    T.ToDtype(torch.float32, scale=True),  # a float32 y ÷ 255
    T.Normalize([0.485, 0.456, 0.406],     # la media de R, G y B
                [0.229, 0.224, 0.225]),    # la desviación de R, G y B
])

img = Image.open("tenis.jpg")              # abre el archivo
img = ImageOps.exif_transpose(img)         # lo gira según su EXIF
x = TF(img.convert("RGB")).unsqueeze(0)    # a RGB, preprocesa y agrega el batch
print(x.shape)                             # torch.Size([1, 3, 224, 224])
```

## El tensor: [1, 3, 224, 224] {The tensor and its shape}

Lo que sale del preprocesamiento es un [[tensor]]: una tabla de números con cualquier cantidad de dimensiones, todos del mismo tipo. La palabra asusta más de lo que es:

| Dimensiones | Qué es | Ejemplo |
|---|---|---|
| 0 | un número | 0.925 |
| 1 | una lista | los 500 logits |
| 2 | una tabla | un canal: 224 × 224 |
| 3 | varias tablas | una foto: 3 canales de 224 × 224 |
| 4 | varias fotos | un grupo de fotos: [1, 3, 224, 224] |

Cuántos números hay en cada dimensión, en orden, es su [[shape]] (su «forma»). El de la foto de Ana es **[1, 3, 224, 224]**. Número por número:

- **1:** cuántas fotos van juntas. Los modelos casi siempre procesan las entradas en grupos, que se llaman [[batch|batches]], porque calcular varias a la vez sale más barato que una por una. Una sola foto es un batch de 1. El servidor de modelos de C01 junta hasta 32 fotos que llegan casi al mismo tiempo, y entonces el shape es [32, 3, 224, 224].
- **3:** los canales: rojo, verde y azul.
- **224:** el alto, en píxeles.
- **224:** el ancho, en píxeles.

Multiplica todo: 1 × 3 × 224 × 224 = **150,528** números. Esos son los 150,528 de la lección anterior.

### CHW: primero los canales

El orden [canales, alto, ancho] se llama [[chw|CHW]] (*channels, height, width*). Las librerías de imágenes, como Pillow, entregan otro orden: HWC, alto, ancho y los tres números de cada píxel juntos. Son los mismos 150,528 números, acomodados distinto:

- En **HWC** (224, 224, 3), los primeros tres números en la memoria son el R, el G y el B del primer píxel.
- En **CHW** (3, 224, 224), los primeros 50,176 números son todos los rojos; luego vienen todos los verdes y luego todos los azules: las tres cuadrículas de la figura de arriba, una tras otra.

PyTorch y el modelo de C01 esperan CHW. Con el batch al frente se escribe NCHW: N es cuántas fotos.

:::ojo Ancho × alto, pero alto primero
Las fotos se describen como ancho × alto («4032 × 3024»). Los shapes, en cambio, se escriben con el alto primero. La misma foto acostada es (3024, 4032, 3) en HWC: 3024 filas de 4032 píxeles. Con 224 × 224 no se nota porque es cuadrada, pero en una foto rectangular confundirlos la voltea.
:::

### Cuánto pesa el tensor

Aquí hay que tener cuidado con las unidades. Un **KB** (kilobyte) son 1,000 bytes. Un **KiB** (kibibyte) son 1,024 bytes, porque a las computadoras les acomodan las potencias de 2. Se parecen, pero no son lo mismo, y muchos programas escriben «KB» cuando quieren decir KiB.

:::ejemplo El tensor de la foto de Ana, en bytes
- Números: 224 × 224 × 3 = **150,528**.
- Como uint8 (1 byte cada uno): 150,528 bytes ≈ **151 KB**. En KiB: 150,528 ÷ 1,024 = **147 KiB** exactos.
- Como float32 (4 bytes cada uno): 150,528 × 4 = 602,112 bytes ≈ **602 KB**. En KiB: 602,112 ÷ 1,024 = **588 KiB**.
- Un batch de 32: 32 × 602,112 = 19,267,584 bytes ≈ **19.3 MB**.
- Para comparar, lo que regresa el modelo: 500 logits × 4 bytes = 2,000 bytes ≈ **2 KB**.
:::

Lo curioso: la foto móvil llega pesando ≈ 200 KB, y el tensor que se manda al modelo pesa 602 KB, tres veces más. El JPEG estaba comprimido; el tensor no, y además cada número pasó de 1 byte a 4.

Eso tiene consecuencias. En la Ronda, el programa que prepara las fotos le manda los tensores al servidor del modelo por la red interna. A 500 fotos por segundo son 602 KB × 500 = 301 MB por segundo, y como un byte son 8 bits, ≈ 2.4 gigabits por segundo. Es tanto que la Ronda deja anotada una mejora para cuando la red se apriete: mandar el tensor en uint8 (4 veces menos bytes) y hacer la normalización ya dentro del servidor del modelo.

:::nota El 1 que no aparece
En la configuración del servidor de modelos de C01 (Triton) verás `dims: [ 3, 224, 224 ]`, sin el 1. No es un error: como ahí mismo se declara cuántas fotos puede juntar (`max_batch_size: 32`), Triton agrega él solo la dimensión del batch.
:::

## El mismo preprocesamiento en los dos momentos {Same preprocessing in training and serving}

Recuerda los dos momentos de un modelo: entrenar y usar. Las fotos pasan por el preprocesamiento en los dos. Al entrenar, cada una de los millones de fotos del [[dataset]]; en producción, cada foto que sube Ana. Y aquí está la regla más importante de esta lección:

**El preprocesamiento tiene que ser idéntico en los dos momentos.**

:::diagrama imagenes-mismo-preproceso
Arriba, la foto de Ana en producción; abajo, las fotos del entrenamiento. Las dos pasan por el mismo código.
:::

El modelo aprendió con fotos preparadas de cierta forma. Sus perillas están ajustadas a esos números. Si en producción la foto se prepara distinto, el modelo recibe números que nunca vio, y lo peor es cómo falla: **no hay ningún error**. El servicio contesta rápido, con su top-5 y su porcentaje. Solo que acierta menos, y nadie se entera hasta que alguien mide.

Estos son errores reales, del tipo que la Ronda describe:

| Qué cambió entre entrenar y servir | Qué recibe el modelo |
|---|---|
| Un lado lee con Pillow (RGB) y el otro con OpenCV (BGR) | El naranja (236, 106, 63) llega como (63, 106, 236): tenis azules |
| Se olvidó dividir entre 255 | En vez de 1.92, (236 − 0.485) ÷ 0.229 ≈ 1,028 |
| Otra interpolación al hacer el resize | Bordes y texturas un poco distintos en toda la foto |
| Un lado gira según EXIF y el otro no | Una parte de las fotos llega de lado |
| *Draft mode* en un lado y no en el otro, u otra versión de la librería | Píxeles que difieren en una o dos unidades |

A este problema la Ronda le llama **training-serving skew**: una diferencia entre cómo se preparan los datos al entrenar y al servir. Ahí lo vas a ver a fondo, junto con sus otras causas.

:::ojo Lo que sí cambia al entrenar
Al entrenar se le meten a propósito variaciones al azar a las fotos: recortes en otro lugar, voltearlas como en un espejo, cambiarles un poco el brillo. Se llama [[augmentation]] y sirve para que el modelo aprenda a tolerarlas. Eso no es skew: al evaluar y en producción se apaga y se usa la versión fija (resize 256 y recorte del centro). Lo que nunca puede cambiar es lo demás: cómo se decodifica, el orden de los colores, la escala y la normalización.
:::

¿Cómo se evita? Con tres medidas que vas a ver en la Ronda:

1. **Un solo código.** El preprocesamiento vive en un solo archivo, y lo importan tanto el entrenamiento como el servicio. No dos copias «iguales» que alguien un día cambia en un solo lado.
2. **Las mismas versiones.** La misma librería de imágenes, en la misma versión, en los dos lados.
3. **Una prueba con fotos fijas.** Unas cuantas fotos de referencia pasan por el preprocesamiento en cada cambio de código, y el tensor que sale se compara número por número con uno guardado. Si alguien cambia algo sin querer, la prueba falla antes de llegar a producción.

:::analogia La receta y la báscula
Un pastelero aprendió una receta pesando la harina en gramos. Si un día, en otra sucursal, alguien la pesa en onzas y usa el mismo número, el pastel sale, se ve como pastel y nadie recibe un aviso. Solo sabe peor.

**Dónde se rompe la analogía:** el pastelero probaría el pastel y notaría que algo anda mal. El modelo no prueba nada: entrega su respuesta con la misma confianza de siempre. La única forma de enterarse es medir, por eso el preprocesamiento se prueba con fotos fijas.
:::

## Lo que sigue en la Ronda {Where the Ronda picks it up}

- **M01 · El mapa y la entrevista:** en la arquitectura de referencia, entre la API y el modelo hay una caja de preprocesamiento («decodificar, rotar según EXIF, redimensionar, normalizar») con una advertencia: tiene que ser idéntico en training y en serving.
- **M07 · Servidores de modelos:** el programa que está frente al modelo decodifica, redimensiona y normaliza con el mismo paquete que el entrenamiento (≈ 6 ms de CPU), y manda a Triton el tensor [1, 3, 224, 224] en FP32 (así le dice la Ronda a float32), de 602 KB.
- **M09 · Datos y features:** el *training-serving skew* a fondo, y por qué un solo módulo de preprocesamiento compartido lo elimina por construcción.
- **C01:** la cuenta de red (602 KB × 500 por segundo ≈ 2.4 Gb/s), la idea de mandar uint8 para dividirla entre 4, el límite de 10 MB y 40 MP por foto, y las fotos sin EXIF en los datos que se guardan.
- **M15 · Seguridad y confiabilidad:** el EXIF con GPS como dato personal, y por qué una foto de 40 MP pesa tanto en la CPU (decenas de ms de decodificar, hasta ≈ 320 MB de memoria) que C01 limita cuántas se decodifican a la vez.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
pixel rgb canal resolucion uint8 decodificar jpeg png exif preprocesamiento resize crop normalizacion float32 tensor shape chw
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? Una imagen RGB de 640 × 480. ¿Cuántos números son y cuánto ocupan en uint8?
640 × 480 = 307,200 píxeles, por 3 canales = 921,600 números. En uint8, un byte cada uno: 921,600 bytes ≈ 922 KB, que son 921,600 ÷ 1,024 = 900 KiB.
? El servidor de modelos junta 8 fotos de C01. ¿Qué shape tiene el tensor y cuánto pesa en float32?
[8, 3, 224, 224]: 8 fotos, 3 canales, 224 de alto y 224 de ancho. Son 8 × 150,528 = 1,204,224 números, por 4 bytes = 4,816,896 bytes ≈ 4.8 MB.
? ¿En qué número queda el canal R de un píxel blanco después de normalizar?
255 ÷ 255 = 1, y (1 − 0.485) ÷ 0.229 = 0.515 ÷ 0.229 ≈ 2.25.
? El modelo se entrenó leyendo las fotos con Pillow, y el servicio nuevo las lee con OpenCV. ¿Qué pasa?
OpenCV entrega los colores como BGR, así que el rojo y el azul llegan intercambiados: los tenis naranjas parecen azules. No sale ningún error; el modelo solo acierta menos. Es un caso de training-serving skew, y una prueba que compare los tensores de unas fotos fijas contra unos guardados lo atrapa antes de producción.
? ¿Por qué hay que leer el EXIF de una foto, y por qué después hay que quitarlo?
Hay que leerlo para aplicar la orientación: muchos teléfonos guardan los píxeles acostados y anotan en el EXIF cómo girarlos. Si no se aplica, el modelo ve la foto de lado. Y hay que quitarlo de lo que se guarda porque puede traer las coordenadas GPS de dónde se tomó: es un dato personal.
? ¿Por qué se achica la foto antes de convertirla a float32 y no al revés?
Porque la foto de 12 MP completa ocupa 36.6 MB en uint8 y 146 MB en float32. Achicar primero ahorra memoria y tiempo: la conversión se hace solo sobre los 150,528 números que de verdad llegan al modelo.
:::
