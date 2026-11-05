---
titulo: Una foto, vista por un modelo
en: A photo, as a model sees it
subtitulo: Cómo una foto (o un video) se convierte en una tabla de números, cuánto pesa en cada paso, qué la deja lista para el modelo y por qué esa preparación tiene que ser idéntica al entrenar y al servir.
pregunta: Si un modelo solo entiende números, ¿qué le llega exactamente cuando Ana sube la foto de sus tenis?
requisitos: modelo
---

:::idea
Para un modelo, una foto es una cuadrícula de números: tres por cada píxel. Antes de entrar se decodifica, se gira, se achica, se recorta y se normaliza hasta quedar en una tabla de 150,528 números de forma [1, 3, 224, 224], que se llama tensor. Si esa preparación cambia en un detalle entre el entrenamiento y la producción, nada truena: el modelo simplemente acierta menos.
:::

## Una foto es una cuadrícula de números {A photo is a grid of numbers}

En la lección anterior viste que el modelo de C01 recibe 150,528 números. ¿De dónde salen, si Ana subió una foto?

Acércate mucho a cualquier foto en tu celular, haciendo zoom hasta que ya no se pueda más. En algún momento dejas de ver tenis y empiezas a ver cuadritos, cada uno de un solo color. Cada cuadrito es un [[pixel|píxel]] (de *picture element*, «elemento de imagen»). Una foto digital no es otra cosa: una cuadrícula de píxeles, tantos de ancho por tantos de alto.

Cuántos píxeles tiene es su [[resolucion|resolución]], y se dice como ancho × alto. Muchos celulares toman fotos de 4032 × 3024:

`4032 × 3024 = 12,192,768 píxeles`

Un **megapíxel** (MP) es un millón de píxeles, así que esa foto tiene ≈ 12.2 MP. Es el número que anuncian las cámaras de los celulares.

Más píxeles quiere decir más detalle, pero también más números que guardar y que procesar. Esa tensión aparece en todo C01: la cámara de Ana toma 12 MP, y el modelo solo necesita 224 × 224 = 50,176 píxeles. De cada 243 píxeles de la foto original, el modelo termina usando el equivalente a uno (12,192,768 ÷ 50,176 = 243). Para reconocer unos tenis alcanza. Para encontrar una grieta de 0.2 mm en una pieza de metal no alcanza, y al final de la lección vas a ver por qué.

### Tres números por píxel: RGB

¿Cómo se guarda el color de un píxel? Con tres números: cuánta luz **roja**, cuánta **verde** y cuánta **azul** tiene. Por las iniciales en inglés (*red, green, blue*) se le llama [[rgb|RGB]]. Mezclando esas tres luces en distintas cantidades sale cualquier color de la pantalla, que es justo como funciona: cada píxel de tu pantalla son tres lucecitas, una roja, una verde y una azul.

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

- Una foto en **blanco y negro** (escala de grises) tiene uno solo: qué tan claro es cada píxel.
- Una imagen con **transparencia** tiene cuatro: RGBA. La A (*alpha*) dice qué tan opaco es cada píxel.

El modelo de C01 espera exactamente tres. Por eso, antes de nada, toda imagen se convierte a RGB: a la de blanco y negro se le copia su único canal tres veces, y a la RGBA se le quita la transparencia.

### Cuánto ocupa una foto abierta

Ya puedes calcular cuánta memoria ocupa la foto de 12 MP cuando está abierta, como cuadrícula de píxeles:

:::cuenta La foto de Ana, abierta
Píxeles | 4032 × 3024 | 12,192,768
Números // tres por píxel: R, G y B | 12,192,768 × 3 | 36,578,304
Bytes // uint8: un byte por número | 36,578,304 × 1 B | ≈ 36.6 MB
El archivo en su celular // depende de la foto y de la calidad | comprimido en JPEG | ≈ 3 MB
= Abierta ocupa unas **12 veces** lo que pesa su archivo (36.6 ÷ 3 ≈ 12). La siguiente sección explica de dónde sale esa diferencia.
:::

## Del archivo a la cuadrícula: decodificar {From file to grid: decoding}

Si una foto abierta ocupa 36.6 MB, ¿por qué el archivo pesa unos 3 MB? Porque el archivo no guarda la cuadrícula tal cual: guarda una versión comprimida. Convertir ese archivo comprimido de vuelta en la cuadrícula de píxeles se llama [[decodificar]] (*decode*).

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

JPEG divide la imagen en bloques de 8 × 8 píxeles y en cada uno se queda con lo importante. Cuanto más se comprime, más se notan esos bloques: es la foto «pixeleada» que se ve cuadriculada cuando alguien la reenvió muchas veces. Por eso dos JPEG de la misma escena, guardados con distinta calidad, no dan los mismos píxeles. Lo vas a necesitar cuando veas el *skew*.

:::ojo La foto que llega no es la que tomó la cámara
En C01, la app del celular achica la foto antes de mandarla, a 1024 píxeles de lado largo como máximo, así que llega pesando ≈ 150 a 250 KB. Desde la computadora se puede subir el original, hasta 10 MB y 40 MP (los límites del servicio). El modelo tiene que funcionar con las dos.
:::

### Decodificar cuesta

Decodificar no es gratis. Una foto de 12 MP hay que reconstruirla píxel por píxel en el procesador principal de la computadora, la [[cpu|CPU]], y luego ocupa 36.6 MB de memoria. El modelo, en cambio, corre en una [[gpu|GPU]]: un chip hecho para hacer miles de cuentas sencillas a la vez. En C01, decodificar y preparar una foto toma unos 6 ms de CPU en promedio: tanto o más de lo que tarda el propio modelo en la GPU (≈ 3 a 6 ms). Lo vas a ver en la lección «CPU y GPU».

Y un archivo chiquito puede estar hecho a propósito para decodificarse en una imagen gigantesca que se coma la memoria del servidor: una [[bomba-descompresion|bomba de descompresión]]. La sección «Archivos que explotan» cuenta cómo se defiende C01.

### Lo que la foto trae escondido: EXIF

Además de los píxeles, un JPEG suele traer datos escondidos que se llaman [[exif|EXIF]]: qué teléfono la tomó, la fecha y la hora, la exposición, cómo estaba girado el teléfono y, muchas veces, las coordenadas GPS de dónde se tomó. Importan por dos razones.

**La orientación.** Muchos teléfonos guardan los píxeles siempre «acostados», como los ve el sensor, y anotan en el EXIF cómo hay que girarlos. Si Ana tomó la foto con el celular de pie, el archivo trae 4032 × 3024 píxeles acostados y una nota: orientación 6, «gira 90° a la derecha para verla bien». Tu galería aplica esa nota sin que te des cuenta, y por eso tú la ves derecha. Pero una librería que solo lee los píxeles la entrega de lado. Pillow, la librería de imágenes más común en Python, no la gira a menos que se lo pidas; OpenCV, en sus versiones actuales, la gira sola al leer, a menos que le pidas que no. Si un lado gira y el otro no, el modelo ve tenis acostados.

**La privacidad.** Con las coordenadas GPS de la foto de unos tenis tomada en la sala de Ana, cualquiera podría saber dónde vive. Por eso en C01 ni la foto ni su EXIF se guardan en los registros, y las pocas fotos que se copian para que una persona las etiquete (≈ 5,000 al mes) se guardan sin EXIF. Lo ves a fondo en la lección «Datos personales y la ley».

## Preparar la foto para el modelo {Preprocessing for ResNet-50}

Ya tienes la cuadrícula de píxeles, derecha y en RGB. Todavía no se la puedes dar al modelo: la ResNet-50 de C01 espera una entrada de un tamaño exacto, con números de cierto tipo y en cierta escala. Todos los pasos que convierten la foto cruda en esa entrada exacta se llaman [[preprocesamiento]] (*preprocessing*).

Sigamos la foto de 12 MP de Ana, ya girada: 3024 de ancho × 4032 de alto.

:::pasos
1. Resize: el lado corto a 256
Se achica la foto sin deformarla, hasta que su lado más corto mida 256. El ancho pasa de 3024 a 256, y el alto se achica en la misma proporción: 4032 × 256 ÷ 3024 = 341.3, que se redondea a 341. Queda de 256 × 341. A eso se le llama [[resize]]. Al achicar, cada píxel nuevo se calcula mezclando varios de los viejos; la regla para mezclarlos es la [[interpolacion|interpolación]], y C01 usa la *bilinear* con antialias (la sección 5 la explica con números).
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

Lo mismo en Python. Se copia y se corre tal cual, sin instalar nada:

```python
MEDIA = (0.485, 0.456, 0.406)   # R, G y B, las de ImageNet
DESV = (0.229, 0.224, 0.225)

def normaliza(pixel):
    # de 0–255 a 0–1, y luego (valor − media) ÷ desviación, canal por canal
    return [round((v / 255 - m) / d, 2) for v, m, d in zip(pixel, MEDIA, DESV)]

print("naranja:", normaliza((236, 106, 63)))
print("negro:  ", normaliza((0, 0, 0)))
print("blanco: ", normaliza((255, 255, 255)))
```

```salida
naranja: [1.92, -0.18, -0.71]
negro:   [-2.12, -2.04, -1.8]
blanco:  [2.25, 2.43, 2.64]
```

¿Para qué tanta vuelta? Porque las cuentas del entrenamiento funcionan mucho mejor con números chicos alrededor de 0 que con números de 0 a 255 (lo vas a entender en la lección «Cómo aprende un modelo»). Y una vez que el modelo aprendió con números preparados así, **solo sabe interpretar números preparados así**.

### Así se ve con PyTorch

Así lo escribe la Ronda en M07, con PyTorch (la librería de Python más usada para redes neuronales). Es una ilustración: necesita PyTorch y una foto, así que no lleva salida. No hace falta entender cada línea: fíjate en que cada paso de arriba es una línea.

```python
from PIL import Image, ImageOps
import torch
from torchvision.transforms import v2 as T

TF = T.Compose([
    T.ToImage(),                           # de Pillow a tensor (orden CHW), todavía uint8
    T.Resize(256),                         # el lado corto a 256 (bilinear con antialias)
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

:::cuenta El tensor de la foto de Ana, en bytes
Números | 1 × 3 × 224 × 224 | 150,528
En uint8 // 1 byte cada uno; en KiB, 150,528 ÷ 1,024 = 147 | 150,528 × 1 B = 150,528 B | ≈ 151 KB
En float32 // 4 bytes cada uno; en KiB, 602,112 ÷ 1,024 = 588 | 150,528 × 4 B = 602,112 B | ≈ 602 KB
Un batch de 32 | 32 × 602,112 B = 19,267,584 B | ≈ 19.3 MB
Lo que regresa el modelo // 500 logits en float32 | 500 × 4 B = 2,000 B | ≈ 2 KB
= El tensor pesa **3 veces** el JPEG del celular (602 KB contra ≈ 200 KB): el JPEG venía comprimido; el tensor no, y además cada número pasó de 1 byte a 4.
:::

Y no viaja solo. Cuando llegan 500 fotos por segundo, esos 602 KB por foto se vuelven ≈ 2.4 gigabits por segundo en la red de C01: la sección 6 hace la cuenta.

:::nota El 1 que no aparece
En la configuración del servidor de modelos de C01 (Triton) verás `dims: [ 3, 224, 224 ]`, sin el 1. No es un error: como ahí mismo se declara cuántas fotos puede juntar (`max_batch_size: 32`), Triton agrega él solo la dimensión del batch.
:::

## Mismas fotos, otros números: interpolación y orden de colores {Same photo, different numbers: interpolation and color order} [extra]

Dos librerías pueden abrir y achicar la misma foto y entregar tensores distintos. A simple vista las dos imágenes se ven iguales; los números no lo son. Esta sección cuenta de dónde salen esas diferencias, porque son la materia prima del *training-serving skew* de la sección 8.

### Interpolación: cómo se inventan los píxeles nuevos

Al cambiar el tamaño de una imagen, casi ningún píxel nuevo cae exactamente encima de uno viejo. Hay que calcular su valor a partir de los vecinos, y la regla para hacerlo es la [[interpolacion|interpolación]] (*interpolation*). Las dos más sencillas:

- **Nearest** (*nearest neighbor*, el vecino más cercano): copia el valor del píxel viejo más cercano. Es la más rápida y da bloques.
- **Bilinear** (bilineal): mezcla los 4 píxeles viejos que rodean al nuevo, con más peso para los que están más cerca. Da transiciones suaves.

Se ve mejor agrandando una imagen chiquita. Toma una de 2 × 2 en escala de grises (un solo canal; 0 es negro) y llévala a 4 × 4:

:::figura imagenes-interpolacion
Arriba, la imagen de 2 × 2. Abajo, las dos formas de llevarla a 4 × 4: nearest repite cada píxel en un bloque de 2 × 2; bilinear hace un degradado. El píxel marcado se calcula paso a paso en la cuenta de abajo.
:::

¿De dónde salen los pesos? Cada píxel nuevo tiene su centro. Al agrandar una fila de 2 píxeles a 4, los centros de los píxeles nuevos 1 y 2 caen a un cuarto del camino entre los dos viejos, uno de cada lado. Los de las orillas (0 y 3) caen afuera de la imagen vieja y se quedan con el valor de la orilla. Por eso, en una fila, los pesos de los cuatro píxeles nuevos son (1, 0), (0.75, 0.25), (0.25, 0.75) y (0, 1): el que está más cerca pesa más. En dos dimensiones se hace lo mismo dos veces: primero a lo ancho, luego a lo alto.

:::cuenta Un píxel nuevo, con bilinear
Dónde cae // el píxel marcado, fila 1 y columna 1 | a un cuarto del camino, a lo alto y a lo ancho | pesos 0.75 y 0.25
Mezcla de arriba // entre 0 y 160 | 0 × 0.75 + 160 × 0.25 | 40
Mezcla de abajo // entre 80 y 240 | 80 × 0.75 + 240 × 0.25 | 120
Entre arriba y abajo | 40 × 0.75 + 120 × 0.25 | 60
= El píxel nuevo vale **60**, un gris oscuro intermedio. Con nearest valdría 0: copiaría al vecino de la esquina.
:::

Y en Python, las 16 posiciones de las dos formas:

```python
img = [[0, 160],
       [80, 240]]                # una imagen de 2 × 2 en gris (0 = negro)

def vecinos(i, n, k=2):
    # en qué parte de la imagen vieja cae el centro del píxel nuevo i (sin salirse de la orilla)
    x = min(max((i + 0.5) * k / n - 0.5, 0), k - 1)
    a = int(x)
    return a, min(a + 1, k - 1), x - a   # un vecino, el otro, y cuánto pesa el segundo

def bilinear(img, n):
    out = []
    for i in range(n):
        y0, y1, py = vecinos(i, n)
        fila = []
        for j in range(n):
            x0, x1, px = vecinos(j, n)
            arriba = img[y0][x0] * (1 - px) + img[y0][x1] * px
            abajo = img[y1][x0] * (1 - px) + img[y1][x1] * px
            fila.append(round(arriba * (1 - py) + abajo * py))
        out.append(fila)
    return out

nearest = [[img[i // 2][j // 2] for j in range(4)] for i in range(4)]   # copia el más cercano
for nombre, grid in (("nearest", nearest), ("bilinear", bilinear(img, 4))):
    print(nombre, *grid, sep="\n  ")
```

```salida
nearest
  [0, 0, 160, 160]
  [0, 0, 160, 160]
  [80, 80, 240, 240]
  [80, 80, 240, 240]
bilinear
  [0, 40, 120, 160]
  [20, 60, 140, 180]
  [60, 100, 180, 220]
  [80, 120, 200, 240]
```

### Al achicar: el antialias

Agrandar inventa píxeles; achicar tiene que **resumirlos**. Cuando la foto de 12 MP baja a 256 de lado corto, cada píxel nuevo resume unos 140 píxeles viejos: 3024 ÷ 256 ≈ 11.8 por lado, y 11.8 × 11.8 ≈ 140. Bilinear, tal cual, solo mira los 4 más cercanos a su centro: los demás no cuentan. Un detalle delgado puede caer justo entre los que mira y desaparecer, o aparecer en unas fotos sí y en otras no.

La solución es el **antialias**: tomar en cuenta todos los píxeles viejos que caen debajo del nuevo, promediados con pesos.

:::ejemplo Una raya de 1 píxel, achicada 4 veces
Una fila de 8 píxeles, blanca con una raya negra: `255 255 255 0 255 255 255 255`. Se achica a 2 píxeles; el primero resume a los 4 primeros.

- **Bilinear sin antialias** (lo que hace `cv2.resize` de OpenCV si no le dices otra cosa): el centro del primer píxel nuevo cae entre el segundo y el tercero de los viejos, los dos blancos: (255 + 255) ÷ 2 = **255**. La raya desaparece.
- **Promediando los 4 que caen debajo** (el modo `INTER_AREA` de OpenCV): (255 + 255 + 255 + 0) ÷ 4 ≈ **191**. La raya sobrevive como un gris.
:::

Para unos tenis no importa mucho. Para una costura fina, el texto de una etiqueta o una grieta, sí.

### Cada librería, su costumbre

El problema práctico es que «haz resize a 256» no dice cómo. Cada librería tiene su interpolación por defecto, y no coinciden:

| Librería | Si no le dices nada |
|---|---|
| Pillow, `Image.resize` | Bicubic (mezcla 16 vecinos en vez de 4).\nCon antialias al achicar. |
| OpenCV, `cv2.resize` | Bilinear.\nSin antialias: para eso está el modo `INTER_AREA`. |
| torchvision, `Resize` | Bilinear.\nCon antialias al achicar. |

C01 lo deja escrito: resize bilinear **con** antialias, en un solo archivo de código. Y hay una trampa más. Algunos PNG no guardan RGB por píxel sino una **paleta**: una lista de colores, y cada píxel dice qué número de la lista usa. Si achicas esa imagen antes de convertirla a RGB, Pillow usa nearest sin avisar, porque no tiene sentido promediar posiciones de una lista. Por eso el orden es primero convertir a RGB y después achicar.

### RGB o BGR

La otra diferencia es el orden de los colores. OpenCV, una de las librerías de imágenes más usadas, entrega los tres números de cada píxel al revés: azul, verde y rojo. Es [[bgr|BGR]], una costumbre que viene de sus primeras versiones. Pillow y PyTorch usan RGB.

Los bytes son los mismos; lo que cambia es qué canal es cuál. Si el modelo aprendió con RGB y le llega BGR, lee el azul como si fuera rojo:

:::ejemplo El naranja, leído al revés
El píxel naranja es (236, 106, 63) en RGB. OpenCV lo entrega como (63, 106, 236). Si nadie lo convierte, el modelo lee **R = 63** y **B = 236**: un azul. Normalizado:

- Lo que debía recibir: **1.92, −0.18, −0.71**.
- Lo que recibe: en R, (63 ÷ 255 − 0.485) ÷ 0.229 ≈ **−1.04**; en G, el mismo −0.18; en B, (236 ÷ 255 − 0.406) ÷ 0.225 ≈ **2.31**.

El verde no cambia, porque está en medio en los dos órdenes. Los otros dos se mueven ≈ 3 unidades, en una escala que va de −2 a +3.
:::

Para un modelo de categorías, unos tenis naranjas convertidos en tenis azules pueden seguir siendo tenis: el error no se nota en cada foto. Pero en todas las fotos donde el color importa (un vestido rojo, una fruta madura, una mancha de óxido) el modelo recibe otra cosa. La regla: convertir explícitamente, en un solo lugar, justo después de leer (`cv2.cvtColor(img, cv2.COLOR_BGR2RGB)`), y tener en las pruebas una foto de color conocido.

### Draft mode y versiones

Dos cosas más cambian los píxeles sin que se note a simple vista:

- **El draft mode de JPEG.** Como JPEG trabaja por bloques de 8 × 8, un decodificador puede reconstruir la foto directamente a la mitad, a la cuarta o a la octava parte del tamaño, sin calcular todos los píxeles. Es mucho más rápido cuando de todos modos vas a achicar a 256: en la Ronda, la foto de 12 MP bajó de ≈ 40 a ≈ 18 ms. C01 lo usa (Pillow lo llama *draft mode*), sin bajar de 512 píxeles. Pero el resultado no es idéntico a decodificar completo y luego achicar, así que si se usa en producción hay que usarlo también al entrenar.
- **Las versiones.** Dos librerías que decodifican JPEG, o dos versiones de la misma, pueden dar píxeles que difieren en una o dos unidades para el mismo archivo.

## Muchas imágenes por segundo: la red y el video {Many images per second: the network and video} [extra]

Hasta aquí seguiste una foto. En producción no llega una: llegan cientos por segundo, y lo que pesa cada una se multiplica. Esta sección hace dos cuentas que la Ronda hace en voz alta: cuánto ocupan los tensores de C01 en la red y cuánto video llega a un sitio de C02.

### Los tensores de C01, en la red

En C01, el programa que prepara las fotos (el *gateway*) y el servidor del modelo (Triton) corren en máquinas distintas: el tensor viaja por la red interna. Para saber cuánto es, hay que multiplicar por cuántas fotos llegan por segundo y pasar de bytes a bits, porque la red se mide en bits por segundo. Un byte son 8 bits, y por eso **Mb/s** (megabits por segundo, con b chica) no es lo mismo que **MB/s** (megabytes, con B grande).

```python
valores = 1 * 3 * 224 * 224              # el shape [1, 3, 224, 224]
print(f"números por foto: {valores:,}")

for tipo, b in (("uint8", 1), ("float16", 2), ("float32", 4)):
    por_foto = valores * b               # bytes de una foto
    red = por_foto * 500 * 8 / 1e9       # 500 fotos por segundo, 8 bits por byte
    print(f"{tipo:8} {por_foto:>9,} B por foto · {red:.2f} Gb/s a 500 fotos/s")

print(f"batch de 32 en float32: {32 * valores * 4:,} B")
```

```salida
números por foto: 150,528
uint8      150,528 B por foto · 0.60 Gb/s a 500 fotos/s
float16    301,056 B por foto · 1.20 Gb/s a 500 fotos/s
float32    602,112 B por foto · 2.41 Gb/s a 500 fotos/s
batch de 32 en float32: 19,267,584 B
```

A 500 fotos por segundo, el pico para el que está diseñado C01, son ≈ 2.4 Gb/s de puros tensores. Ese número es el [[ancho-banda|ancho de banda]] que pide el sistema, y es tanto que la Ronda deja anotada una mejora para cuando la red se apriete: mandar el tensor en uint8 (4 veces menos bytes) y hacer la normalización ya dentro del servidor del modelo.

:::calculadora imagenes-tensor
La línea que importa en la entrevista es la última: a 500 fotos por segundo, 602 KB por foto son ≈ 2.4 Gb/s.
:::

### Un video es una fila de fotos

Un video es una sucesión de fotos que pasan tan rápido que el ojo las ve como movimiento. Cada foto se llama [[frame]] (cuadro). Cuántos frames hay en cada segundo es la tasa de cuadros, en [[fps]] (*frames per second*). El tiempo entre un frame y el siguiente es 1,000 ÷ fps milisegundos:

| fps | Un frame cada | Dónde lo ves |
|---|---|---|
| 30 | 33.3 ms | Video del celular |
| 15 | 66.7 ms | Muchas cámaras de seguridad |
| 5 | 200 ms | Lo que analiza C02 |

Para un modelo, cada frame es una foto como la de Ana: una cuadrícula de píxeles RGB que se decodifica, se achica y se normaliza. Lo que cambia es el ritmo: decenas de frames por segundo, de cada cámara, todo el día.

### C02: mil cámaras

El caso C02 de la Ronda es justo eso: una empresa de logística con 25 centros de distribución y 40 cámaras en cada uno, 1,000 en total, que quiere detectar personas y vehículos en zonas prohibidas y avisar en segundos a un centro de monitoreo. Cada cámara manda video 1080p (1920 × 1080) a 15 fps.

Primera cuenta: si analizaras todo, serían 1,000 × 15 = **15,000 frames por segundo**, las 24 horas. Cada uno, una foto de ≈ 2.07 MP que hay que decodificar.

### Comprimido cabe; crudo, no

Las cámaras no mandan los frames crudos: los comprimen con un **códec** (un programa que comprime y descomprime video), casi siempre H.264. El truco del video es que un frame se parece mucho al anterior. H.264 guarda un frame completo cada tanto (el *I-frame*) y, del resto, solo lo que cambió. Por eso el video se comprime mucho más que las fotos sueltas, y por eso lo que pesa depende de la escena: con la misma calidad, una bodega quieta pesa menos que un patio con lluvia.

:::cuenta Una cámara de C02, cruda y comprimida
Píxeles por frame // 1080p | 1920 × 1080 = 2,073,600 | ≈ 2.07 MP
Un frame decodificado // RGB, un byte por número | 2,073,600 × 3 B | ≈ 6.2 MB
Cruda, a 5 fps // 8 bits por byte | 6.2 MB × 5 × 8 | ≈ 249 Mb/s
Comprimida con H.264 // el stream de 5 fps de C02 | un supuesto de la Ronda | ≈ 1.5 Mb/s
Lo que comprime el códec | 249 ÷ 1.5 | ≈ 166 veces
Un sitio de 40 cámaras | 40 × 1.5 Mb/s | ≈ 60 Mb/s
= Comprimido, un sitio manda ≈ 60 Mb/s; crudo serían ≈ 10 Gb/s. Y aun comprimido no cabe en un enlace a internet de 20 a 50 Mb/s: por eso C02 analiza el video **en el sitio** y solo sube los eventos.
:::

### Menos frames, misma alerta

C02 no analiza el stream de 15 fps. Las cámaras pueden mandar un segundo stream más ligero, y C02 lo configura a 1080p y **5 fps** (≈ 1.5 Mb/s). Son 200 frames por segundo por sitio en vez de 600: el cómputo baja a la tercera parte.

¿Alcanza con 5? A 5 fps pasan 200 ms entre frames, y una persona que camina a 1.4 m/s avanza 1.4 × 0.2 ≈ 0.3 m: nadie cruza un pasillo sin salir en varios frames. ¿Y por qué no bajar también la resolución? Porque una persona a 40 m de la cámara ocupa pocas decenas de píxeles en 1080p; en 360p casi desaparece. Los fps y la resolución son dos perillas distintas: una dice cada cuánto miras; la otra, cuánto detalle ves cada vez.

Decodificar video también cuesta. Un frame 1080p decodificado en RGB ocupa ≈ 6.2 MB; a 200 frames por segundo son ≈ 1.2 GB por segundo de copias en la memoria. Por eso C02 decodifica en un circuito de la propia GPU que solo hace eso (NVDEC, el decodificador de video de NVIDIA), y los frames ya no vuelven a la CPU.

Y su detector no recibe 224 × 224 sino 640 × 640, porque busca objetos chicos dentro de un frame grande. Para llegar ahí sin deformar el frame, se achica conservando la proporción (1920 × 1080 → 640 × 360) y se rellena lo que falta con un color fijo. A eso se le llama *letterbox*, y se hace igual que en el entrenamiento.

:::calculadora imagenes-video
Los fps mueven dos cosas a la vez: cuántos frames hay que analizar y cada cuánto ve el modelo la escena. Prueba también una cámara 4K (3840 × 2160).
:::

## Archivos que explotan: bombas de descompresión {Files that explode: decompression bombs} [extra]

Una foto de 3 MB ocupa 36.6 MB al abrirla: 12 veces más. Esa proporción depende de qué tan fácil de comprimir es la imagen, y una imagen de un solo color es lo más fácil del mundo: «diez mil filas iguales de puro negro» se escribe en muy pocos bytes. Alguien puede aprovecharlo a propósito y fabricar un archivo de unos KB que, al decodificarse, pida cientos de MB o varios GB. Es una [[bomba-descompresion|bomba de descompresión]] (*decompression bomb*). Si el servidor la abre sin revisar, se queda sin memoria y se cae, junto con todas las peticiones que estaba atendiendo.

### Fabricar una con la biblioteca estándar

Con `struct` y `zlib`, que vienen con Python, se puede escribir un PNG válido de 10,000 × 10,000 píxeles, todo negro, guardado con 1 bit por píxel:

```python
import struct, zlib

def png_negro(ancho, alto):
    # un PNG de 1 bit por píxel, todo negro: puros ceros, que se comprimen muchísimo
    fila = b"\x00" + bytes((ancho + 7) // 8)          # 1 byte de filtro + la fila en bits
    def trozo(tipo, datos):                           # cada trozo de un PNG: largo, tipo, datos, CRC
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))
    ihdr = struct.pack(">IIBBBBB", ancho, alto, 1, 0, 0, 0, 0)   # 1 bit, escala de grises
    return (b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", ihdr)
            + trozo(b"IDAT", zlib.compress(fila * alto, 9)) + trozo(b"IEND", b""))

archivo = png_negro(10_000, 10_000)
ancho, alto = struct.unpack(">II", archivo[16:24])  # el tamaño viene en el encabezado
mp = ancho * alto / 1e6
print(f"el archivo pesa {len(archivo):,} bytes")
print(f"el encabezado dice {ancho:,} × {alto:,} = {mp:.0f} MP")
print(f"abierto en RGB ocuparía {ancho * alto * 3 / 1e6:,.0f} MB")
print("¿pasa la guarda de 40 MP?", mp <= 40)
```

```salida
el archivo pesa 12,227 bytes
el encabezado dice 10,000 × 10,000 = 100 MP
abierto en RGB ocuparía 300 MB
¿pasa la guarda de 40 MP? False
```

Un archivo de 12 KB que, abierto en RGB, pide 300 MB: ≈ 25,000 veces su tamaño. Y fíjate en cómo se leyó el tamaño: **sin decodificar nada**. Todo PNG y todo JPEG dicen cuánto miden en su encabezado, antes de los datos comprimidos. Leerlo cuesta microsegundos.

### La guarda: lo barato primero

De ahí sale la defensa de C01. Antes de decodificar, el gateway hace tres revisiones, de la más barata a la más cara:

:::diagrama imagenes-guardas
Cada revisión puede rechazar la foto antes de abrirla. Usa los recorridos para seguir una foto normal, un archivo enorme, una bomba y un PDF disfrazado de foto.
:::

1. **El peso del archivo.** La petición anuncia cuántos bytes trae (`Content-Length`). Si son más de 10 MB, el gateway responde **413** («demasiado grande», en HTTP) sin leer el cuerpo.
2. **El tipo.** Los primeros bytes dicen qué formato es de verdad, sin importar cómo se llame el archivo: un JPEG empieza con `FF D8`; un PNG, con `89 50 4E 47`. Si no es JPEG, PNG ni WebP, responde **415** («tipo no soportado»).
3. **Los píxeles.** El ancho y el alto del encabezado. Si pasan de 40 MP, otro **413**.

¿Por qué 40 MP? Porque cada decodificación vive en la memoria del servidor, y el costo crece con los píxeles, no con el peso del archivo. Una foto de 40 MP en RGB ocupa 40 M × 3 = 120 MB, y un PNG de 40 MP con transparencia y 16 bits por canal (PNG lo permite) llega a 40 M × 4 canales × 2 bytes = 320 MB. Cada copia del gateway de C01 tiene 1 GiB de memoria, así que decodifica como máximo 2 fotos a la vez, con un tiempo límite.

Con la CPU pasa lo mismo. Una foto de la app, de 1024 × 768, tiene 786,432 píxeles: unas 15 veces menos que una de 12 MP. En la Ronda, decodificar una de 12 MP tardó ≈ 40 ms en una laptop, contra los ≈ 6 ms del promedio. Por eso unas cuantas fotos grandes de la computadora pueden comerse una buena parte de la CPU, aunque sean pocas.

Pillow trae su propia guarda: avisa si una imagen pasa de 89,478,485 píxeles (≈ 89 MP) y se niega a abrirla si pasa del doble (≈ 179 MP). Es una red de seguridad, no una política: con sus 100 MP, la bomba de arriba solo dispararía el aviso. Por eso C01 pone su límite explícito, mucho más abajo.

Queda una bomba más sutil, que no explota al decodificar sino al achicar:

:::cuenta Una imagen de 1 × 4,000 que «se achica»
El archivo // un PNG de 1 píxel de ancho y 4,000 de alto | 1 bit por píxel | 85 bytes
¿Pasa la guarda de 40 MP? | 1 × 4,000 | 4,000 píxeles: pasa
El resize lleva el lado corto a 256 | el largo crece igual: 4,000 × 256 | 1,024,000 de alto
La imagen «achicada» | 256 × 1,024,000 × 3 B | ≈ 786 MB
Y en float32 | × 4 | ≈ 3.1 GB
= Un archivo de 85 bytes pide casi 1 GB al «achicarse». Por eso C01 también rechaza las proporciones de más de 1 a 8.
:::

## El mismo preprocesamiento en los dos momentos {Training-serving skew}

Recuerda los dos momentos de un modelo: entrenar y usar. Las fotos pasan por el preprocesamiento en los dos. Al entrenar, cada una de los millones de fotos del [[dataset]]; en producción, cada foto que sube Ana. Y aquí está la regla más importante de esta lección:

**El preprocesamiento tiene que ser idéntico en los dos momentos.**

:::diagrama imagenes-mismo-preproceso
Arriba, la foto de Ana en producción; abajo, las fotos del entrenamiento. Las dos pasan por el mismo código.
:::

El modelo aprendió con fotos preparadas de cierta forma. Sus perillas están ajustadas a esos números. Si en producción la foto se prepara distinto, el modelo recibe números que nunca vio, y lo peor es cómo falla: **no hay ningún error**. El servicio contesta rápido, con su top-5 y su porcentaje. Solo que acierta menos, y nadie se entera hasta que alguien mide.

La Ronda lo cuenta así en M09. El modelo de C01 saca 85 % de top-1 en su examen. Se despliega, y los vendedores aceptan sus sugerencias menos de lo esperado. Alguien manda fotos ya etiquetadas por el gateway real, y el top-1 da 80 %. En los registros no hay un solo error.

Esa diferencia tiene nombre: [[training-serving-skew|training-serving skew]] (desfase entre entrenamiento y servicio). El modelo ve en producción entradas preparadas distinto de las que aprendió **por culpa de tu sistema**, no porque el mundo haya cambiado.

### Las causas

Todas tienen la misma forma: dos caminos de código que «hacen lo mismo» y no lo hacen.

| Qué cambió | Ejemplo, y lo que recibe el modelo |
|---|---|
| El orden de los colores | El entrenamiento leyó con Pillow (RGB); el servicio, con OpenCV (BGR).\n→ El naranja (236, 106, 63) llega como (63, 106, 236): tenis azules. |
| La librería o la interpolación del resize | Bilinear con antialias al entrenar; `cv2.resize` sin antialias al servir.\n→ Bordes y texturas un poco distintos en toda la foto. |
| Cómo se llega a 224 | Resize a 256 y recorte del centro al entrenar; resize directo a 224 × 224 al servir.\n→ Fotos deformadas: en una foto de pie, los tenis se ven más anchos. |
| La orientación EXIF | Un lado gira la foto según su EXIF y el otro no.\n→ Fotos de celular de lado. |
| La escala o la normalización | Se olvidó el ÷ 255, o se usaron otras medias.\n→ En vez de 1.92, ≈ 1,028. |
| La calidad del JPEG o el draft mode | El dataset guardó miniaturas recomprimidas y el servicio recibe el JPEG de la app; o hay draft mode en un solo lado.\n→ Otros artefactos de compresión: píxeles un poco distintos. |
| Las versiones de las librerías | Otra versión de Pillow en el contenedor del servicio.\n→ Píxeles que difieren en una o dos unidades. |

:::ojo Skew no es drift
El [[drift]] es otra cosa: el mundo cambió (llegan fotos de una categoría nueva, la gente cambia de celular) y el modelo envejece. El skew está desde el primer día del despliegue, o desde un cambio de código, y se arregla en el código. El drift se arregla con datos nuevos y [[reentrenamiento]].
:::

:::ojo Lo que sí cambia al entrenar
Al entrenar se le meten a propósito variaciones al azar a las fotos: recortes en otro lugar, voltearlas como en un espejo, cambiarles un poco el brillo. Se llama [[augmentation]] y sirve para que el modelo aprenda a tolerarlas. Eso no es skew: al evaluar y en producción se apaga y se usa la versión fija (resize 256 y recorte del centro). Lo que nunca puede cambiar es lo demás: cómo se decodifica, el orden de los colores, la escala y la normalización.
:::

### Cómo se evita

Con tres medidas que vas a ver en la Ronda:

1. **Un solo código.** El preprocesamiento vive en un solo archivo, y lo importan el entrenamiento, la evaluación y el servicio. En C01 se llama `preprocess.py`. No dos copias «iguales» que alguien un día cambia en un solo lado.
2. **Las mismas versiones.** La misma librería de imágenes, en la misma versión, en los dos lados.
3. **Una prueba de paridad.** Unas cuantas fotos fijas (C01 usa 20) pasan por el preprocesamiento en cada cambio de código, y el tensor que sale se compara número por número con el del otro camino y con uno guardado. Es una [[prueba-paridad|prueba de paridad]] (*parity test*): si alguien cambia algo sin querer, falla antes de llegar a producción.

:::diagrama imagenes-paridad
La prueba corre en CI, el proceso automático que revisa cada cambio de código antes de aceptarlo. Recorre una prueba que pasa y dos que fallan.
:::

¿Qué tan grande tiene que ser una diferencia para que la prueba falle? Con el mismo código y las mismas versiones, la diferencia es **exactamente 0**. Si no es 0, algo cambió. Y los errores de la tabla se ven enormes en el tensor:

:::cuenta Cuánto mueve cada error al tensor
Un decoder que difiere en 1 unidad // canal R | 1 ÷ 255 ÷ 0.229 | ≈ 0.017
Leer BGR en vez de RGB // el naranja, canal R | 1.92 − (−1.04) | ≈ 2.96
Olvidar el ÷ 255 // el naranja, canal R | 1,028 − 1.92 | ≈ 1,026
= Una prueba que exige diferencia 0 atrapa los tres. Solo se acepta una tolerancia chica cuando se elige a propósito una diferencia conocida, como decodificar en la GPU, y entonces se mide su efecto en las predicciones.
:::

:::analogia La receta y la báscula
Un pastelero aprendió una receta pesando la harina en gramos. Si un día, en otra sucursal, alguien la pesa en onzas y usa el mismo número, el pastel sale, se ve como pastel y nadie recibe un aviso. Solo sabe peor.

**Dónde se rompe la analogía:** el pastelero probaría el pastel y notaría que algo anda mal. El modelo no prueba nada: entrega su respuesta con la misma confianza de siempre. La única forma de enterarse es medir, por eso el preprocesamiento se prueba con fotos fijas.
:::

## Errores comunes {Common mistakes}

:::pasos
1. Convertir a float32 antes de achicar
La foto de 12 MP en float32 ocupa ≈ 146 MB, solo para tirar casi todo un paso después. **Cómo evitarlo:** achica primero, en uint8, y convierte al final, cuando ya son 224 × 224.
2. Leer con OpenCV y olvidar que entrega BGR
El modelo recibe el rojo y el azul cambiados, sin ningún error. **Cómo evitarlo:** convierte a RGB justo después de leer, dentro del archivo de preprocesamiento, y ten en las pruebas una foto de color conocido.
3. Dividir entre 255 dos veces, o ninguna
`ToDtype(..., scale=True)` ya divide entre 255; si además divides tú, todo queda casi en 0. Si nadie divide, los valores llegan a ≈ 1,000. **Cómo evitarlo:** una sola función hace la escala y la normalización, y la prueba de paridad la vigila.
4. Confundir ancho × alto con el orden del shape
Las fotos se dicen ancho × alto; los tensores, alto primero. Confundirlos voltea o deforma la foto. **Cómo evitarlo:** escribe el orden en un comentario junto a cada shape y prueba con una foto que no sea cuadrada.
5. Achicar un PNG con paleta antes de convertirlo a RGB
Pillow usa nearest sin avisar y la foto sale escalonada. **Cómo evitarlo:** primero `convert("RGB")`, después el resize.
6. Calcular la memoria con el peso del archivo
Un archivo de 12 KB puede pedir 300 MB. Lo que ocupa en memoria depende de los píxeles, no del archivo. **Cómo evitarlo:** lee el ancho y el alto del encabezado y calcula ancho × alto × canales × bytes antes de decodificar.
7. «Arreglar» el skew reentrenando
Si reentrenas con fotos que pasaron por un servicio que lee BGR, el modelo nuevo aprende BGR... hasta que alguien arregla el servicio y todo empeora. Es convertir un error en una dependencia. **Cómo evitarlo:** el skew se corrige en el código, con una prueba que impida que vuelva.
:::

## En la vida real {In real life} [extra]

Todo lo de esta lección se repite en cualquier sistema con imágenes. Lo que cambia de un caso a otro es **cuánta resolución hace falta** y **cuánta se puede pagar**.

### C01: una foto, 150,528 números

Para sugerir la categoría de unos tenis, 224 × 224 alcanza: lo que distingue unos tenis de unas botas se ve en una foto chica. Aquí el riesgo no está en la resolución sino en el skew: que la foto se prepare igual al entrenar y al servir.

### C02: video en tiempo real

La sección 6 lo contó con números: 5 fps porque alcanzan para ver a alguien cruzar una zona, y 1080p porque una persona a 40 m mide pocas decenas de píxeles. Con video, lo que manda es el ancho de banda y el costo de decodificar, no el modelo.

### C03: grietas de 0.2 mm en una línea de producción

En C03 una cámara fotografía cada pieza metálica que pasa por una banda, para detectar defectos antes de que lleguen al cliente. Las grietas que importan miden ≈ 0.2 mm. La cámara es de 5 MP (2,448 × 2,048), en blanco y negro: un solo canal de 8 bits, ≈ 5.0 MB por imagen. En la Ronda se supone que ve 150 mm de pieza a lo largo.

:::figura imagenes-tiles
Arriba, la imagen de la cámara partida en 20 tiles. Abajo, la misma grieta vista de cerca a tres resoluciones: a la de la cámara mide 3.3 píxeles; achicada a 224, un tercio de píxel.
:::

Cada píxel cubre 150 ÷ 2,448 ≈ 0.061 mm, así que una grieta de 0.2 mm mide ≈ 3.3 píxeles de ancho. Si la imagen se achicara a 224 como en C01, cada píxel cubriría 0.67 mm y la grieta mediría 0.3 píxeles: un gris apenas más oscuro que el metal, perdido. Por eso C03 **no achica**: parte la imagen en 20 recortes de 512 × 512 (5 a lo ancho y 4 a lo alto, con un poco de traslape para no cortar una grieta en la orilla) y los procesa juntos, como un batch. A esos recortes se les llama *tiles* (mosaicos). Fíjate en otro detalle: esta cámara manda la imagen cruda, sin JPEG. No hay nada que decodificar, y no hay compresión que borre una grieta.

### C04: imágenes que no caben en la memoria

En C04 un laboratorio digitaliza láminas de patología: cortes de tejido que se ven al microscopio. Cada lámina se escanea a 0.25 µm por píxel (una micra, µm, es la milésima parte de un milímetro). Un corte de 1.5 cm² de tejido, a esa resolución, son ≈ 2,400 millones de píxeles: ≈ 7.2 GB en RGB sin comprimir. El archivo pesa ≈ 1 GB porque viene comprimido en pedazos.

Esa imagen nunca se abre completa. Se lee por regiones, a la mitad de resolución (0.5 µm por píxel, la que usa el modelo), en tiles de 512 × 512 que se traslapan 64 píxeles para que no se noten las costuras: ≈ 3,000 tiles por lámina. El traslape cuesta ≈ 31 % más cómputo, porque cada tile solo avanza 448 píxeles: (512 ÷ 448)² ≈ 1.31. Al final, los resultados de los tiles se vuelven a coser en un mapa de toda la lámina.

### C05: documentos y DPI

En C05 una financiera recibe fotos de credenciales y escaneos de documentos para leer sus datos con OCR. Ahí la resolución se mide en **DPI** (*dots per inch*, puntos por pulgada): cuántos píxeles caben en una pulgada (25.4 mm) de papel. Una hoja carta, de 8.5 × 11 pulgadas, escaneada a 300 DPI son 2,550 × 3,300 píxeles: ≈ 8.4 MP. A 200 DPI, cada píxel cubre 0.127 mm.

C05 rechaza al momento la foto de una credencial que no llegue a ≈ 200 DPI, porque el OCR necesita que cada letra mida unos 15 píxeles de alto. Una letra de texto normal mide ≈ 2.5 mm, unos 30 píxeles a 300 DPI. Si la hoja se achicara a 224 de alto, como la foto de Ana, mediría ≈ 2 píxeles: ilegible. Por eso los modelos de documentos trabajan con imágenes mucho más grandes que 224.

### Fuera de ML

- Cuando imprimes una foto, la tienda pregunta los DPI. Tu foto de 4032 × 3024 a 300 DPI sale de ≈ 34 × 26 cm; más grande, se empiezan a ver los píxeles.
- Las capturas de pantalla suelen guardarse en PNG: tienen texto y bordes nítidos, y JPEG les pondría manchas alrededor de las letras.
- Una videollamada baja la resolución y los fps cuando tu internet se pone lento: es la cuenta de ancho de banda de C02, hecha sola, cada pocos segundos.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los números son los de la lección.

:::ejercicios
? [facil] Una imagen RGB mide 640 × 480. ¿Cuántos números son, cuántos bytes ocupa en uint8 y cuántos en float32?
Píxeles: 640 × 480 = 307,200. Números: 307,200 × 3 canales = **921,600**.

- En uint8, un byte por número: 921,600 B ≈ **922 KB** (921,600 ÷ 1,024 = 900 KiB).
- En float32, cuatro bytes por número: 921,600 × 4 = 3,686,400 B ≈ **3.7 MB**.
? [facil] Normaliza un píxel gris medio, (128, 128, 128), con las medias y desviaciones de ImageNet. ¿Por qué no quedan iguales los tres canales?
Primero, 128 ÷ 255 ≈ 0.502 en los tres canales. Después, cada uno con su media y su desviación:

- R: (0.502 − 0.485) ÷ 0.229 ≈ **0.07**
- G: (0.502 − 0.456) ÷ 0.224 ≈ **0.21**
- B: (0.502 − 0.406) ÷ 0.225 ≈ **0.43**

No quedan iguales porque cada canal tiene su propia media: en las fotos de ImageNet hay, en promedio, más rojo que azul (0.485 contra 0.406). Comparado con lo que el modelo suele ver, este gris tiene «de más» sobre todo en el azul.
? [facil] Una cámara graba a 25 fps. ¿Cada cuántos milisegundos llega un frame y cuántos frames manda en un minuto? ¿Y una de C02, a 5 fps?
A 25 fps: 1,000 ÷ 25 = **40 ms** entre frames, y 25 × 60 = **1,500 frames** por minuto.

A 5 fps: 1,000 ÷ 5 = **200 ms**, y 5 × 60 = **300 frames** por minuto: cinco veces menos trabajo para el detector.
? [facil] El servidor de modelos junta 8 fotos de C01. ¿Qué shape tiene el tensor y cuánto pesa en float32?
**[8, 3, 224, 224]**: 8 fotos, 3 canales, 224 de alto y 224 de ancho. Son 8 × 150,528 = 1,204,224 números, por 4 bytes = 4,816,896 B ≈ **4.8 MB**.
? [medio] Una fila de dos píxeles, [40, 200], se agranda a 4 píxeles. ¿Qué da con nearest y qué da con bilinear?
**Nearest** copia el vecino más cercano: **[40, 40, 200, 200]**.

**Bilinear** usa los pesos de una fila, (1, 0), (0.75, 0.25), (0.25, 0.75) y (0, 1):

- Píxel 0: **40**.
- Píxel 1: 40 × 0.75 + 200 × 0.25 = 30 + 50 = **80**.
- Píxel 2: 40 × 0.25 + 200 × 0.75 = 10 + 150 = **160**.
- Píxel 3: **200**.

Nearest da un escalón; bilinear, una rampa.
? [medio] Un píxel rojo, (200, 30, 30), se lee con OpenCV y nadie lo convierte a RGB. ¿Qué número recibe el modelo en el canal R, y cuál debía recibir?
OpenCV lo entrega como (30, 30, 200), así que al canal R le llega 30:

- Recibe: (30 ÷ 255 − 0.485) ÷ 0.229 = (0.118 − 0.485) ÷ 0.229 ≈ **−1.60**.
- Debía recibir: (200 ÷ 255 − 0.485) ÷ 0.229 = (0.784 − 0.485) ÷ 0.229 ≈ **1.31**.

Una diferencia de ≈ 2.9 en una escala que va de −2 a +3: para el modelo, la cosa roja es azul. Ningún error lo avisa.
? [medio] El tráfico de C01 crece 10 veces: 5,000 fotos por segundo. ¿Cuántos Gb/s de tensores viajan del gateway a la GPU en float32, en float16 y en uint8?
Cada foto son 150,528 números. A 5,000 por segundo y 8 bits por byte:

- float32: 150,528 × 4 B × 5,000 × 8 ≈ **24.1 Gb/s**.
- float16: la mitad, ≈ **12.0 Gb/s**.
- uint8: la cuarta parte, ≈ **6.0 Gb/s**.

Por eso, si C01 crece, la primera palanca de la Ronda es mandar uint8 y normalizar dentro del servidor del modelo: la red baja 4 veces sin tocar la GPU.
? [medio] Un sitio de C02 tiene 40 cámaras y un enlace a internet de 50 Mb/s. ¿Cabe el video si manda el stream principal (15 fps, ≈ 4 Mb/s por cámara)? ¿Y el de 5 fps (≈ 1.5 Mb/s)?
- Principal: 40 × 4 = **160 Mb/s**, más de 3 veces el enlace.
- 5 fps: 40 × 1.5 = **60 Mb/s**: tampoco cabe, y se comería el enlace entero.

Ninguno cabe. Por eso C02 analiza el video **en el sitio** y solo sube los eventos: unas fotos y un clip corto cuando pasa algo.
? [reto] El encabezado de un PNG dice 30,000 × 30,000. ¿Cuántos megapíxeles son y cuánta memoria pediría en RGB uint8 y en float32? ¿Qué hace con él la guarda de C01, y qué haría Pillow sin configurar?
- Píxeles: 30,000 × 30,000 = 900,000,000 = **900 MP**.
- En RGB uint8: 900 M × 3 B = **2.7 GB**. En float32: × 4 = **10.8 GB**.
- La guarda de C01 lo rechaza con un 413 en cuanto lee el encabezado: 900 MP es más de 22 veces el límite de 40 MP. No se decodifica ni un píxel.
- Pillow, sin configurar, también se negaría: 900 MP pasa del doble de su límite de ≈ 89 MP. Pero con un PNG de 100 MP solo avisaría, y por eso C01 no depende de ese default.
? [reto] En C03, la cámara ve 150 mm de pieza en 2,448 píxeles. ¿Cuántos píxeles mide una grieta de 0.2 mm? ¿Y si la imagen se achicara a 224 de ancho? ¿Cuántos tiles de 512 × 512 hacen falta para cubrir la imagen de 2,448 × 2,048?
- Cada píxel cubre 150 ÷ 2,448 ≈ 0.061 mm. La grieta: 0.2 ÷ 0.061 ≈ **3.3 píxeles**.
- A 224 de ancho, cada píxel cubre 150 ÷ 224 ≈ 0.67 mm, y la grieta mide 0.2 ÷ 0.67 ≈ **0.3 píxeles**: se mezcla con el metal de alrededor y desaparece.
- Tiles: a lo ancho, 2,448 ÷ 512 ≈ 4.8, así que hacen falta **5**; a lo alto, 2,048 ÷ 512 = **4**. En total, 5 × 4 = **20**. Cinco tiles miden 2,560 píxeles y la imagen 2,448, así que se traslapan un poco, y eso ayuda a no cortar una grieta justo en la orilla de un tile.
:::

## Lo que sigue {What comes next}

En la Ronda:

- **M01 · El mapa y la entrevista:** la caja de preprocesamiento («decodificar, rotar según EXIF, redimensionar, normalizar»), con la advertencia de que tiene que ser idéntica en training y en serving, y el ejemplo de alguien que reescribe el preprocesamiento con OpenCV.
- **M07 · Servidores de modelos:** el gateway decodifica y normaliza en ≈ 6 ms con el mismo paquete que el entrenamiento, y manda a Triton el tensor de 602 KB en binario. En JSON, el mismo tensor pesaría ≈ 3.1 MB.
- **M09 · Datos y features:** la tabla completa de causas del *training-serving skew*, cómo se detecta y en qué se distingue del drift.
- **C01:** la cuenta de red (≈ 2.4 Gb/s a 500 fotos por segundo), la mejora de mandar uint8, los límites de 10 MB y 40 MP, el draft mode y la prueba con 20 fotos de referencia.
- **C02, C03 y C04:** frames por segundo y ancho de banda; resolución y tiles; imágenes que no caben en la memoria.
- **M15 · Seguridad y confiabilidad:** el EXIF con GPS como dato personal, y por qué una foto de 40 MP pesa tanto en la CPU (decenas de ms de decodificar, hasta ≈ 320 MB de memoria) que C01 limita cuántas se decodifican a la vez.

En el Dojo, la estación 1 (Datos y etiquetas) quita el EXIF de las fotos antes de mandarlas a etiquetar. Las estaciones 5 (Export, engine y paridad) y 6 (Código de serving), cuando estén, prueban la paridad que viste aquí.

En Sensei sigue «Datos, ejemplos, features y etiquetas», donde la foto ya preparada se vuelve un ejemplo con su etiqueta. Más adelante, «Redes neuronales y CNNs» muestra qué hace el modelo con los 150,528 números, «Números grandes, unidades y estimaciones» practica bits, bytes y Gb/s, y «Cómo guarda números una computadora» explica por dentro uint8, float16 y float32.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección.

:::conceptos
pixel resolucion rgb uint8 canal decodificar jpeg png exif preprocesamiento resize crop normalizacion float32 tensor shape chw interpolacion bgr frame fps bomba-descompresion training-serving-skew prueba-paridad
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué un JPEG de ≈ 3 MB ocupa 36.6 MB cuando se abre?
Porque el archivo guarda una versión comprimida: JPEG descarta detalle que el ojo casi no nota. Abierta, la foto es la cuadrícula completa: 4032 × 3024 píxeles × 3 números × 1 byte = 36.6 MB.
? ¿Por qué se achica la foto antes de convertirla a float32 y no al revés?
Porque la foto de 12 MP completa ocupa 36.6 MB en uint8 y 146 MB en float32. Achicar primero ahorra memoria y tiempo: la conversión se hace solo sobre los 150,528 números que de verdad llegan al modelo.
? El modelo se entrenó leyendo las fotos con Pillow, y el servicio nuevo las lee con OpenCV. ¿Qué pasa?
OpenCV entrega los colores como BGR, así que el rojo y el azul llegan intercambiados: los tenis naranjas parecen azules. No sale ningún error; el modelo solo acierta menos. Es training-serving skew, y una prueba de paridad que compare los tensores de unas fotos fijas lo atrapa antes de producción.
? Los vendedores empiezan a subir fotos de una categoría nueva y el modelo acierta menos. ¿Es training-serving skew?
No: es drift. Cambió el mundo, no tu código, y se arregla con datos nuevos y reentrenando. El skew aparece cuando tu propio sistema prepara las fotos distinto al entrenar y al servir, y se arregla en el código.
? ¿Por qué C01 lee el tamaño de la foto en su encabezado antes de decodificarla?
Para defenderse de las bombas de descompresión: un archivo de unos KB puede pedir cientos de MB al abrirse. El encabezado dice el ancho y el alto sin decodificar nada; si pasan de 40 MP, la foto se rechaza con un 413.
? ¿Por qué hay que leer el EXIF de una foto, y por qué después hay que quitarlo?
Hay que leerlo para aplicar la orientación: muchos teléfonos guardan los píxeles acostados y anotan en el EXIF cómo girarlos. Si no se aplica, el modelo ve la foto de lado. Y hay que quitarlo de lo que se guarda porque puede traer las coordenadas GPS de dónde se tomó: es un dato personal.
:::
