---
titulo: PyTorch en lo que toca a producción
en: PyTorch for production
subtitulo: El clasificador de fotos de Alba, el marketplace que seguimos en todo el curso, se entrenó con PyTorch. Aquí ves qué partes de PyTorch importan cuando ese modelo ya no aprende sino que contesta requests: cargar los pesos bien, apagar lo que solo sirve para entrenar, medir el tiempo sin engañarte, no quedarte sin memoria de GPU y dejarlo listo para exportar.
pregunta: Ya tengo un modelo entrenado en PyTorch. ¿Qué tengo que saber de PyTorch para que conteste requests rápido, igual que en el entrenamiento y sin tronar?
requisitos: python-ecosistema, redes, cpu-gpu, numeros-maquina
---

:::idea
PyTorch está hecho para entrenar: anota cada cuenta para poder corregirla, se porta distinto en modo entrenamiento y deja que la GPU trabaje por su lado. Servir un modelo es saber qué de eso apagar, qué medir de otra forma y qué congelar antes de exportarlo.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Lo hace con una [[resnet|ResNet-50]] de ≈ 24.5 millones de parámetros, y su historia empieza con un `model.pt` que corre en una celda de Jupyter, el cuaderno donde se entrenó: una página en el navegador donde el código se escribe y se corre por pedazos, llamados celdas. El trabajo es convertir eso en un servicio confiable. Casi todo lo que falla en ese paso es PyTorch usado como si siguiera entrenando.

Esta lección recorre cinco trabajos, en orden:

1. **Cargar los pesos bien**: la arquitectura correcta, el archivo correcto y en el chip correcto.
2. **Apagar lo que solo sirve para entrenar**: la anotación de las cuentas y el modo entrenamiento de algunas capas.
3. **Medir el tiempo sin engañarte**, porque la GPU trabaja por su lado.
4. **No quedarte sin memoria de GPU**, y entender por qué parece llena aunque no lo esté.
5. **Prepararlo para exportar**: compilarlo, capturarlo completo y calentarlo antes de recibir tráfico.

## PyTorch y el device: en qué chip vive cada tensor {PyTorch and the device: which chip each tensor lives on}

[[pytorch|PyTorch]] es una biblioteca de Python para hacer cuentas con [[tensor|tensores]] y entrenar redes neuronales. Una biblioteca (o librería) es código que alguien más escribió para que tú lo uses. PyTorch la publicó en 2016 el laboratorio de IA de Facebook (hoy Meta), y desde 2022 la cuida la PyTorch Foundation. Hoy es la biblioteca más usada para entrenar modelos, en la industria y en la investigación.

Tiene tres partes, y las tres salen en esta lección:

- **Tensores** que pueden vivir en la CPU o en la GPU, cada uno con su [[dtype]].
- **Autograd**, la pieza que calcula los [[gradiente|gradientes]] sola (sección 3).
- **Módulos** (`torch.nn`): las [[capa|capas]] ya hechas y la forma de juntarlas en un modelo (sección 2).

### Eager: cada línea corre cuando llegas a ella

PyTorch trabaja en modo **eager** (ansioso): cada operación corre en el momento en que Python llega a esa línea, y el resultado ya existe en la siguiente. Es como una calculadora: escribes 2 × 3 y ves 6. Así es fácil de usar y de depurar, porque puedes imprimir cualquier cosa a la mitad. El precio es que entre una operación y la siguiente siempre pasa por Python, y eso cuesta tiempo. La sección 6 cuenta cómo se compila para quitarle ese costo.

### Instalarlo

PyTorch no viene con Python. Se instala con [[pip]], dentro de un [[entorno-virtual|entorno virtual]] (los dos están en la lección anterior), junto con torchvision, su parte de visión. Es una ilustración: el comando baja de cientos de MB a varios GB, porque en Linux la versión normal ya trae su propio CUDA.

```bash
pip install torch torchvision
```

Los bloques de esta lección que llevan salida se corrieron con PyTorch 2.15 y torchvision 0.29, en la CPU de una Mac, con Python 3.14. Las mediciones del equipo de Alba que cita la lección se hicieron con PyTorch 2.14. En otra versión, algún mensaje de error puede decir otra cosa.

### Device

Cada tensor vive en un **device** ([[device]], dispositivo): el chip en cuya memoria están sus números. Los tres que vas a ver:

| Device | Qué es | Dónde lo vas a ver |
|---|---|---|
| `cpu` | La [[ram\|RAM]] y la CPU | Por omisión: todo tensor nace aquí |
| `cuda` o `cuda:0` | La [[vram\|VRAM]] de una GPU de NVIDIA ([[cuda\|CUDA]]); `cuda:1` es la segunda | Entrenar y servir en la nube |
| `mps` | La GPU de las Mac con chip de Apple | Probar en una laptop |

Para cambiar de device se usa `.to(device)`. En un tensor, regresa una copia en ese device (o el mismo tensor, si ya estaba ahí). En un modelo, mueve todos sus pesos y regresa el mismo modelo.

La regla que más muerde: **una operación necesita todos sus tensores en el mismo device**. PyTorch no copia nada por su cuenta. Si el modelo está en la GPU y la foto en la CPU, truena con un mensaje que empieza así: `Expected all tensors to be on the same device, but found at least two devices, cuda:0 and cpu!`. Con los dtypes pasa algo parecido: una multiplicación de matrices (`@`) no mezcla un tensor en FP32 con uno en [[fp16|FP16]] sin convertir antes. En las cuentas de número por número, como `*` o `+`, PyTorch sí convierte solo al tipo más ancho. Esto sí corre en cualquier computadora:

```python
import torch

x = torch.tensor([[1.0, 2.0, 3.0]])     # una fila con tres números
print(x.shape, x.dtype, x.device)

y = x * 2 + 1                           # eager: esta línea ya corrió
print(y)

z = y.to("cpu")                         # ya estaba en la CPU: no copia nada
print(z.device, z is y)

w = torch.ones(3, dtype=torch.float16)
try:
    print(x @ w)                        # FP32 por FP16: no se mezclan solos
except RuntimeError as error:
    print("Error:", error)
```

```salida
torch.Size([1, 3]) torch.float32 cpu
tensor([[3., 5., 7.]])
cpu True
Error: addmv input tensors must have the same dtype, but got Half, Float, and Half
```

El `try` y el `except` atrapan el error para imprimirlo, en vez de que el programa se detenga ahí. `addmv` es el nombre interno de una multiplicación de matriz por vector, y `Half` y `Float` son los nombres viejos de FP16 y FP32 en PyTorch. En un servidor con GPU, el código lleva un device en una variable y lo usa en cada `.to()`. Es una ilustración, porque aquí no hay GPU:

```python
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"   # la línea típica de un servidor
modelo = modelo.to(DEVICE)              # los pesos, a la VRAM, una vez al arrancar
x = foto.to(DEVICE)                     # cada foto, en cada request
```

:::ojo
Esa primera línea tiene una trampa: si el contenedor arranca sin GPU, el servicio arranca feliz en la CPU, decenas de veces más lento, y nadie se entera hasta que el [[p99]] explota. En producción, si esperas una GPU, comprueba al arrancar que `torch.cuda.is_available()` dé `True` y termina el proceso si no.
:::

## nn.Module y state_dict: el modelo y sus pesos {nn.Module and state_dict: the model and its weights}

En PyTorch, un modelo es una **clase** de Python. Una clase es un molde: describe qué datos guarda cada objeto hecho con ella y qué sabe hacer. Los modelos se escriben **heredando** de [[nn-module|`nn.Module`]], la clase base de todas las capas y modelos de PyTorch: tu clase arranca con todo lo que `nn.Module` ya sabe hacer (guardar, mover de device, cambiar de modo) y tú solo le agregas lo tuyo. Un `nn.Module` tiene dos partes:

- **`__init__`**, que se corre una vez al crear el modelo: ahí se crean las capas y se cuelgan del objeto (`self.conv = …`, donde `self` es el objeto mismo). Así el módulo las registra y sabe cuáles son sus pesos.
- **`forward`**, que dice cómo pasa una entrada por esas capas: el [[forward-pass]].

Para usarlo se escribe `modelo(x)`, no `modelo.forward(x)`. Llamar al módulo corre `forward` y, además, los ganchos (*hooks*): funciones que tú u otras herramientas le cuelgan para correr antes o después de cada capa, por ejemplo para ver qué sale de ella. `modelo.forward(x)` se los salta.

### Parámetros y buffers

Un módulo guarda dos tipos de tensores:

- **Parámetros** (*parameters*): los pesos que el entrenamiento ajusta, las perillas de la lección «Cómo aprende un modelo». Tienen `requires_grad=True`: autograd les calcula el gradiente.
- **Buffers**: números que el módulo guarda y necesita, pero que no se aprenden con gradiente. El ejemplo de siempre es la [[batchnorm|BatchNorm]]: sus estadísticas acumuladas (`running_mean` y `running_var`, el promedio y la varianza de lo que ha visto) se van actualizando al entrenar, y al responder se usan en vez de las del batch.

Este módulo chiquito tiene una convolución, una BatchNorm y una capa final de 3 clases:

```python
import torch
from torch import nn

class Mini(nn.Module):
    def __init__(self, clases=3):
        super().__init__()                  # prepara el registro de capas
        self.conv = nn.Conv2d(3, 8, kernel_size=3)
        self.bn = nn.BatchNorm2d(8)
        self.fc = nn.Linear(8, clases)

    def forward(self, x):                   # lo que pasa en cada forward
        x = self.bn(self.conv(x)).relu()
        return self.fc(x.mean(dim=(2, 3)))  # promedia cada canal: 8 números

torch.manual_seed(0)
m = Mini()
print(m(torch.randn(2, 3, 16, 16)).shape)   # m(x) corre forward: 2 fotos, 3 logits

parametros = dict(m.named_parameters())
for nombre, t in m.state_dict().items():
    tipo = "parámetro" if nombre in parametros else "buffer"
    print(f"{nombre:<22} {str(tuple(t.shape)):<14} {tipo}")
print("números que se aprenden:", sum(p.numel() for p in m.parameters()))  # numel: cuántos números trae
```

```salida
torch.Size([2, 3])
conv.weight            (8, 3, 3, 3)   parámetro
conv.bias              (8,)           parámetro
bn.weight              (8,)           parámetro
bn.bias                (8,)           parámetro
bn.running_mean        (8,)           buffer
bn.running_var         (8,)           buffer
bn.num_batches_tracked ()             buffer
fc.weight              (3, 8)         parámetro
fc.bias                (3,)           parámetro
números que se aprenden: 267
```

### El state_dict: el diccionario de los pesos

Lo que imprimió el ciclo es el [[state-dict|state_dict]]: un diccionario de Python (una tabla de nombre → valor) con **un tensor por cada parámetro y cada buffer**. Los nombres siguen el camino de atributos: `bn.running_mean` es el `running_mean` de `self.bn`. En la ResNet-50 se ven así: `layer1.0.conv1.weight`, el peso de la primera convolución del primer bloque de la etapa 1.

:::figura pytorch-state-dict
El state_dict de la ResNet-50 de Alba: 320 tensores con nombre. 161 son parámetros, que el entrenamiento ajusta; 159 son buffers de las 53 BatchNorm, que se guardan pero no se aprenden. Los dos tipos viajan en el mismo archivo.
:::

El state_dict es lo que se guarda. No el objeto entero (`torch.save(modelo)`), por dos razones. Para cargar un objeto entero, Python necesita el código exacto de su clase, en la misma ruta de archivo: cambias de lugar un archivo y los pesos ya no cargan. Y un objeto entero exige el [[pickle]] completo, el que puede ejecutar código al cargarse. El state_dict son solo nombres y tensores: cabe en el modo seguro de PyTorch o en [[safetensors]], como viste en la lección de formatos.

### Cargarlo bien: tres piezas

1. **Primero la arquitectura, después los pesos.** El archivo no trae la receta del modelo: se crea vacío (`resnet50(num_classes=500)`) y se le cargan los números.
2. **`torch.load(ruta, map_location="cpu", weights_only=True)`.** `weights_only=True` usa el lector restringido que solo arma tensores y tipos básicos (desde PyTorch 2.6 es lo normal). `map_location="cpu"` lee los tensores a la RAM aunque se hayan guardado desde una GPU. Sin él, un archivo guardado en `cuda:0` intenta cargarse en `cuda:0`, y en una máquina sin GPU truena. Después, un `.to(DEVICE)` los manda a donde van.
3. **`load_state_dict(estado)`**, con `strict=True`, que es lo normal: revisa que cada nombre del archivo exista en el modelo, que no falte ninguno y que cada forma coincida. Si algo no cuadra, truena y dice qué.

```python
import os, tempfile, torch
from torchvision.models import resnet50

torch.manual_seed(0)
modelo = resnet50(weights=None, num_classes=500)   # la arquitectura de Alba, pesos al azar
estado = modelo.state_dict()
print("tensores en el state_dict:", len(estado))
print("fc.weight:", tuple(estado["fc.weight"].shape), estado["fc.weight"].dtype)
numeros = sum(t.numel() for t in modelo.parameters())
print(f"parámetros: {numeros:,} · en FP32: {numeros * 4 / 1e6:.1f} MB")

ruta = os.path.join(tempfile.mkdtemp(), "resnet50_500.pt")  # en una carpeta temporal
torch.save(estado, ruta)                           # solo el diccionario, no el objeto
cargado = torch.load(ruta, map_location="cpu", weights_only=True)

otro = resnet50(weights=None, num_classes=500)     # primero la arquitectura...
print(otro.load_state_dict(cargado))               # ...y luego los pesos
print("¿mismos pesos?", torch.equal(otro.fc.weight, modelo.fc.weight))

mil = resnet50(weights=None)                       # la de ImageNet: 1,000 clases
try:
    mil.load_state_dict(cargado)
except RuntimeError as error:
    print([linea.strip().split(":")[0] for linea in str(error).splitlines()[1:]])
```

```salida
tensores en el state_dict: 320
fc.weight: (500, 2048) torch.float32
parámetros: 24,532,532 · en FP32: 98.1 MB
<All keys matched successfully>
¿mismos pesos? True
['size mismatch for fc.weight', 'size mismatch for fc.bias']
```

El último intento falla bien: el archivo trae una capa final de 500 clases y el modelo espera 1,000. `strict=False` existe, y deja pasar los nombres que faltan o sobran sin tronar; una forma distinta, como esta, truena de todos modos. Úsalo solo a propósito, como al cambiar la [[cabeza]] (la capa final, la que da una puntuación por clase) para un [[fine-tuning]], y revisa lo que regresa: un modelo al que le faltó cargar algo arranca con esos pesos al azar y contesta basura sin ningún error.

:::cuenta Lo que pesa el state_dict de Alba
Parámetros // 161 tensores en FP32, 4 B cada número; los 24,532,532 que contó el bloque de arriba | 24,532,532 × 4 B | 98,130,128 B
Buffers en FP32 // running_mean y running_var de las 53 BatchNorm: 2 números por canal, y las 53 suman 26,560 canales | 2 × 26,560 = 53,120 números × 4 B | 212,480 B
Contadores // num_batches_tracked, un número en int64 (8 B) por BatchNorm | 53 × 8 B | 424 B
Todo // la suma de las tres filas | 98,130,128 + 212,480 + 424 | ≈ 98.34 MB
= Los buffers son 0.2 % del archivo (212,480 ÷ 98,343,032), pero sin ellos la BatchNorm no sabe normalizar al responder. El checkpoint de Alba pesa 98.4 MB: lo de más es el empaque, porque `torch.save` guarda un zip.
:::

:::profundo Cargar sin gastar el doble de RAM
Un `torch.load` normal lee el archivo completo a la RAM, y `load_state_dict` copia cada tensor a los pesos del modelo. Por un momento, los pesos existen dos veces. Con 98 MB da igual; con un LLM de 16 GB, no. `torch.load(ruta, mmap=True, weights_only=True)` abre el archivo con [[mmap]]: el sistema operativo trae del disco cada pedazo cuando se lee, y varios procesos que abren el mismo archivo comparten esas páginas en el [[page-cache]]. Es lo mismo que hace vLLM con sus safetensors, como viste en la lección de memoria.
:::

## Autograd y los dos interruptores de servir {Autograd and the two serving switches}

Para entrenar hace falta el gradiente de cada uno de los 24.5 millones de parámetros. Nadie lo programa a mano: lo hace [[autograd]] (*automatic differentiation*, derivación automática), la pieza de PyTorch que hace la [[backpropagation]] sola.

### Cada operación deja una nota

Cuando un tensor tiene `requires_grad=True`, cada operación que lo usa deja una nota: qué operación fue, con qué tensores y cómo se deriva. El resultado lleva esa nota en su atributo `grad_fn`. Las notas, unidas, forman una **gráfica** (en matemáticas, un *grafo*: puntos unidos por flechas) que va de los parámetros a la pérdida. Se arma sola durante el forward. `backward()` la recorre al revés, aplicando la [[regla-cadena|regla de la cadena]] en cada nota.

```python
import torch

w = torch.tensor(3.0, requires_grad=True)   # un parámetro: autograd lo vigila
y = w * w + 2 * w                           # el forward: 9 + 6 = 15
print(y, y.grad_fn.name())                  # la última operación anotada
y.backward()                                # recorre la gráfica al revés
print("dy/dw =", w.grad)                    # 2·w + 2 = 8

with torch.no_grad():                       # lo mismo, sin notas
    z = w * w + 2 * w
print(z, "· requires_grad:", z.requires_grad, "· grad_fn:", z.grad_fn)
```

```salida
tensor(15., grad_fn=<AddBackward0>) AddBackward0
dy/dw = tensor(8.)
tensor(15.) · requires_grad: False · grad_fn: None
```

### Lo que cuesta anotar

Para derivar después, muchas notas necesitan guardar sus entradas. La derivada de `w * w` es `2 * w`, así que esa nota se queda con `w`. En una red, eso son las **activaciones** de cada capa: lo que salió de cada una. Se quedan en memoria hasta el `backward()`. Al responder, el backward nunca llega, y esa memoria se gasta para nada.

¿Cuánto es? Este bloque le pregunta a autograd qué guarda en cada forward de la ResNet-50 de Alba, sin contar los pesos, que de todos modos están en memoria. No hace falta seguir cada línea: el truco es un gancho (`saved_tensors_hooks`) que autograd llama con cada tensor que guarda, y el bloque suma los bytes de cada uno. Tarda unos segundos:

```python
import torch
from torchvision.models import resnet50

modelo = resnet50(weights=None, num_classes=500).eval()
pesos = {p.data_ptr() for p in modelo.parameters()}
guardado = {}

def anotar(t):                     # autograd llama aquí con cada tensor que se guarda
    if t.data_ptr() not in pesos:  # los pesos ya estaban en memoria: no se cuentan
        guardado[t.data_ptr()] = t.untyped_storage().nbytes()
    return t

for nombre, modo in (("autograd prendido", torch.enable_grad), ("inference_mode", torch.inference_mode)):
    for fotos in (1, 8):
        guardado.clear()
        with modo(), torch.autograd.graph.saved_tensors_hooks(anotar, lambda t: t):
            logits = modelo(torch.randn(fotos, 3, 224, 224))
        print(f"{nombre:<17} · batch {fotos}: {sum(guardado.values()) / 1e6:6.1f} MB guardados · requires_grad={logits.requires_grad}")
```

```salida
autograd prendido · batch 1:   86.1 MB guardados · requires_grad=True
autograd prendido · batch 8:  687.5 MB guardados · requires_grad=True
inference_mode    · batch 1:    0.0 MB guardados · requires_grad=False
inference_mode    · batch 8:    0.0 MB guardados · requires_grad=False
```

:::cuenta Las notas de autograd en un batch de 32
Guardado por foto, \(a\) // medido arriba, en FP32: el batch de 8 guardó 687.5 MB | 687.5 MB ÷ 8 | ≈ 86 MB
Fotos por batch, \(k\) // el batch máximo de Alba | — | 32
Guardado por el batch // \(k × a\) | 32 × 86 MB | ≈ 2.75 GB
Lo mismo con inference_mode // el bloque midió 0.0 MB | — | 0
Los pesos de la ResNet-50, para comparar // ≈ 24.5 millones de parámetros × 4 B | 24.5 millones × 4 B | ≈ 98 MB
Veces lo que pesan los pesos // lo del batch (32 × 86 MB = 2,752 MB) entre los pesos | 2,752 MB ÷ 98 MB | ≈ 28
= Sin apagar autograd, un batch de 32 guarda ≈ 28 veces lo que pesan los pesos, para un backward que nunca llega.
:::

La lección «Cómo aprende un modelo» estimó ≈ 44 MB por foto en 16 bits: en FP32 son ≈ 88, casi lo mismo que midió el bloque.

### El primer interruptor: no_grad e inference_mode

[[no-grad|`torch.no_grad()`]] apaga las notas: lo que corre adentro no arma gráfica ni guarda activaciones. `torch.inference_mode()` hace lo mismo y un poco más: también se salta unas cuentas internas de PyTorch que solo sirven para autograd, así que es algo más rápido. A cambio, lo que sale de ahí no puede entrar después a una cuenta con gradiente. Para servir, eso da igual: se usa `inference_mode`. Los dos se usan con un `with`, la forma de Python de decir «lo que va dentro de este bloque corre con esto puesto, y al salir se quita solo». Valen para lo que está adentro, y solo en el [[hilo]] que abrió el bloque.

:::profundo Lo que inference_mode se salta, y su precio
Cada tensor normal lleva un contador de versión: un número que sube cada vez que alguien lo modifica en su lugar, es decir, cambiando sus números sin hacer una copia. Autograd lo revisa en el backward para saber si un tensor que guardó cambió después, porque entonces el gradiente saldría mal. `inference_mode` no lleva esos contadores, y por eso es algo más rápido. El precio: lo que nace ahí adentro queda marcado como «tensor de inferencia» y no puede entrar a una cuenta con gradiente. Lo que nace en `no_grad` sí puede.

```python
import torch

w = torch.tensor(2.0, requires_grad=True)          # un parámetro
with torch.no_grad():
    z = torch.ones(3)                               # nació con autograd apagado
with torch.inference_mode():
    x = torch.ones(3)                               # nació en inference_mode
print("¿tensores de inferencia?", z.is_inference(), x.is_inference())
(z * w).sum().backward()                            # z sí puede entrar a autograd
print("con el de no_grad, gradiente:", w.grad)
try:
    (x * w).sum().backward()
except RuntimeError as error:
    print("con el de inference_mode:", str(error).split(".")[0])
```

```salida
¿tensores de inferencia? False True
con el de no_grad, gradiente: tensor(3.)
con el de inference_mode: Inference tensors cannot be saved for backward
```

En un servidor nadie hace backward, así que el precio no se paga. En el entrenamiento, para evaluar a media época, se usa `no_grad`.
:::

### El segundo interruptor: eval

`no_grad` no toca el [[modo-eval|modo eval]]. Son dos interruptores distintos:

- **Autograd** (`no_grad`, `inference_mode`) decide si se anotan las cuentas. Es memoria y tiempo.
- **El modo** (`model.train()` y `model.eval()`) decide cómo se portan la BatchNorm y el [[dropout|Dropout]]. Son las respuestas.

En modo train, la BatchNorm normaliza con las estadísticas del batch y, además, actualiza sus buffers con cada batch que ve. El Dropout apaga neuronas al azar. Nada de eso depende de autograd. Este bloque lo demuestra con una red chiquita que tiene las dos capas:

```python
import torch
from torch import nn

torch.manual_seed(0)
red = nn.Sequential(nn.Linear(4, 8), nn.BatchNorm1d(8), nn.ReLU(), nn.Dropout(0.5), nn.Linear(8, 3))
foto = torch.randn(1, 4)                       # «la foto de Ana», ya convertida en 4 números
otras = torch.randn(3, 4)                      # otras fotos que llegaron en el mismo batch
antes = red[1].running_mean.clone()            # los buffers de la BatchNorm

with torch.no_grad():                          # autograd apagado, pero la red sigue en modo train
    a = red(torch.cat([foto, otras]))[0]       # cat junta las 4 en un batch; [0] es la de Ana
    b = red(torch.cat([foto, otras]))[0]
print("train + no_grad · ¿misma respuesta dos veces?", torch.allclose(a, b))
print("train + no_grad · ¿cambió la memoria de la BatchNorm?", not torch.equal(antes, red[1].running_mean))

red.eval()                                     # el otro interruptor
print("eval sin no_grad · requires_grad:", red(foto).requires_grad)
with torch.inference_mode():
    sola = red(foto)[0]
    en_grupo = red(torch.cat([foto, otras]))[0]
print("eval + inference_mode · ¿sola = en grupo?", torch.allclose(sola, en_grupo))
print("eval + inference_mode · requires_grad:", sola.requires_grad)
```

```salida
train + no_grad · ¿misma respuesta dos veces? False
train + no_grad · ¿cambió la memoria de la BatchNorm? True
eval sin no_grad · requires_grad: True
eval + inference_mode · ¿sola = en grupo? True
eval + inference_mode · requires_grad: False
```

Fíjate en la segunda línea: con `no_grad` y en modo train, cada request **cambia el modelo**. La BatchNorm mezcla en su memoria las estadísticas de los batches que le llegan, y el modelo se va desviando poco a poco del que se evaluó. La tercera muestra el otro lado: `eval()` solo no apaga autograd, y la salida todavía trae `requires_grad=True`. Con los dos interruptores puestos, la respuesta de la foto de Ana ya no depende de con quién llegó en el batch, y no se guarda ninguna nota.

:::figura pytorch-interruptores
Los dos interruptores y sus cuatro combinaciones. Solo la de abajo a la derecha sirve para responder: modo eval (las respuestas no cambian) y autograd apagado (sin memoria gastada).
:::

## DataLoader: alimentar al modelo por lotes {DataLoader: feeding the model in batches} [extra]

Al entrenar, la GPU necesita un [[batch]] nuevo cada pocos milisegundos. Abrir las fotos, decodificarlas, recortarlas, aplicarles **aumentaciones** (cambios al azar, como voltearlas o moverles el brillo, para que el modelo vea más variedad) y convertirlas en tensores es trabajo de CPU, y si lo hace el mismo proceso que entrena, la GPU se queda esperando. PyTorch separa ese trabajo en dos piezas.

### Dataset: qué ejemplos hay

Un `Dataset` es una clase con dos métodos (dos funciones que pertenecen a la clase):

- `__len__`: cuántos ejemplos hay.
- `__getitem__(i)`: el ejemplo número i, ya listo: la foto como tensor y su etiqueta.

El Dataset no carga todo al principio: carga cada ejemplo cuando se lo piden. Así un [[dataset]] de 2 millones de fotos no tiene que caber en la RAM.

### DataLoader: quién arma los batches

El [[dataloader|DataLoader]] le pide ejemplos al Dataset y los junta en batches. Sus opciones importantes:

- **`batch_size`**: cuántos ejemplos por batch (64 en el entrenamiento de Alba).
- **`shuffle=True`**: revuelve el orden en cada [[epoch|época]]. Con un `generator` con [[semilla]], el orden sale igual en cada corrida.
- **`num_workers`**: cuántos **procesos** aparte preparan batches mientras el entrenamiento corre. Son procesos y no hilos por el [[gil|GIL]]: decodificar con Python puro en hilos no avanzaría en paralelo (lo viste con el [[multiproceso]], en la lección del GIL). Con 0, que es lo que trae por omisión, todo lo hace el proceso principal.
- **`pin_memory=True`**: deja cada batch en RAM fijada, la que el sistema operativo promete no mover, para que la copia a la GPU sea más rápida y pueda ir en paralelo con el cálculo (lección «CPU y GPU»).

Los workers le pasan los batches al proceso principal por memoria compartida, que en Linux es la carpeta `/dev/shm`. Docker le da a cada contenedor solo 64 MiB ahí: con varios workers, el entrenamiento truena con un mensaje de *bus error* que culpa a la «*shared memory (shm)*», y se arregla con `--shm-size=1g`, una opción de `docker run` (lección «Memoria, caché y disco»).

```python
import torch
from torch.utils.data import Dataset, DataLoader, get_worker_info

class Fotos(Dataset):
    def __init__(self, n):
        self.n = n                                   # aquí irían las rutas de las fotos
    def __len__(self):
        return self.n                                # cuántos ejemplos hay
    def __getitem__(self, i):                        # el ejemplo i, ya preparado
        info = get_worker_info()                     # ¿qué worker lo preparó?
        return torch.full((3, 2, 2), float(i)), info.id if info else -1

if __name__ == "__main__":                           # necesario cuando hay workers
    datos = Fotos(10)
    print("ejemplos:", len(datos))
    g = torch.Generator().manual_seed(17)            # el mismo orden en cada corrida
    lotes = DataLoader(datos, batch_size=4, shuffle=True, generator=g, num_workers=2)
    for fotos, quien in lotes:
        print(tuple(fotos.shape), "fotos", fotos[:, 0, 0, 0].int().tolist(), "· worker", quien.tolist())
```

```salida
ejemplos: 10
(4, 3, 2, 2) fotos [1, 5, 8, 9] · worker [0, 0, 0, 0]
(4, 3, 2, 2) fotos [4, 2, 0, 7] · worker [1, 1, 1, 1]
(2, 3, 2, 2) fotos [6, 3] · worker [0, 0]
```

Tres cosas que muestra la salida. Los batches salen en orden aunque los arman dos workers: el 0 hace el primero, el 1 el segundo y el 0 otra vez el tercero. El último batch trae solo 2 fotos, porque 10 no se divide entre 4 (`drop_last=True` lo tiraría). Y la línea del `if __name__ == "__main__"`, que quiere decir «corre esto solo si este archivo es el programa que arrancaste, no si otro Python lo está leyendo», es obligatoria: en macOS y en Windows, y desde Python 3.14 también en Linux, los workers salen de un Python nuevo que vuelve a leer tu archivo (el método de arranque *spawn* o *forkserver*, no *fork*). Sin ese `if`, ese Python nuevo volvería a correr el DataLoader e intentaría crear sus propios workers, y el programa truena con un `RuntimeError`.

### ¿Cuántos workers?

Los suficientes para que la GPU nunca espere. Cada worker prepara fotos a un ritmo fijo, así que la cuenta es una división:

:::formula Workers que necesita el DataLoader
f_{worker} = frac{1000}{t_{foto}}
n_{workers} = frac{f_{GPU}}{f_{worker}}
- t_{foto}: los ms de CPU que tarda un worker en preparar una foto. El 1000 son los ms de un segundo
- f_{worker}: las fotos por segundo que prepara un worker
- f_{GPU}: las fotos por segundo que consume la GPU al entrenar
- n_{workers}: los workers necesarios; se redondea hacia arriba y se le da margen
:::

:::cuenta Los workers que pide el entrenamiento de Alba
Fotos por segundo que consume la GPU, \(f_{GPU}\) // supuesto para el ejemplo: ResNet-50 en precisión mixta, batches de 64 | — | ≈ 700
Tiempo de CPU por foto, \(t_{foto}\) // decodificar ≈ 6 ms (lo que mide el gateway de Alba, con fotos de 1024 px de lado largo) más ≈ 4 ms de recortar y las aumentaciones (supuesto) | ≈ 6 + 4 ms | ≈ 10 ms
Fotos por segundo de un worker, \(f_{worker}\) | \(1000 ÷ t_{foto}\) = 1,000 ÷ 10 | ≈ 100
Workers necesarios, \(n_{workers}\) | \(f_{GPU} ÷ f_{worker}\) = 700 ÷ 100 | 7
= Con margen, 8: el `num_workers=8` del DataLoader de Alba. Cada worker es un proceso que ocupa un núcleo de CPU, así que la máquina necesita al menos 8 núcleos, más el del proceso que entrena.
:::

Dos opciones más del DataLoader ayudan a que la GPU no espere: `persistent_workers=True` deja vivos los workers entre épocas, en vez de arrancarlos otra vez, y `prefetch_factor` dice cuántos batches tiene listos cada worker por adelantado (2, por omisión).

### También al servir, pero por lotes

En la inferencia en línea, la de cada request, no hay DataLoader: llega una foto y se responde. Pero el camino offline (calificar millones de fotos viejas de una vez, armar los [[embedding|embeddings]] de un catálogo, evaluar un modelo con su [[golden-set|golden set]]) es igual que entrenar sin backward: un Dataset que lee archivos, un DataLoader con workers y `shuffle=False`, y el modelo en eval con `inference_mode`. Ahí también la GPU espera si la CPU no alcanza.

:::ojo
La semilla del DataLoader no basta si cada worker usa su propio generador al azar para las aumentaciones. El entrenamiento de Alba le da a cada worker su semilla con `worker_init_fn`. Lo ves en «autocast y determinismo».
:::

## La GPU trabaja aparte: medir el tiempo y la memoria {The GPU works on its own: timing and memory}

En la lección «CPU y GPU» viste que la CPU **lanza** cada [[kernel-gpu|kernel]] (una función que corre en la GPU), lo deja en una fila de trabajo de la GPU y sigue con la siguiente línea, sin esperar a que termine. Eso tiene dos consecuencias en el código de PyTorch: el tiempo se mide mal sin darte cuenta, y la memoria se ve llena sin estarlo.

### Medir sin engañarte

`modelo(x)` en la GPU regresa en cuanto la CPU terminó de **dejar** los kernels en la fila, no cuando la GPU terminó de correrlos. Un reloj de Python alrededor de esa línea mide el lanzamiento.

Para medir bien hay que esperar a la GPU. Eso es la [[sincronizacion-cuda|sincronización]]: `torch.cuda.synchronize()` detiene a la CPU hasta que la fila se vacía. Es una ilustración: necesita una GPU de NVIDIA.

```python
import time, torch

x = torch.randn(32, 3, 224, 224, device="cuda")
with torch.inference_mode():
    for _ in range(10):
        modelo(x)                       # calentar: las primeras llamadas preparan cosas
    torch.cuda.synchronize()            # que la fila empiece vacía
    t0 = time.perf_counter()
    for _ in range(100):
        modelo(x)
    torch.cuda.synchronize()            # esperar a que la GPU acabe las 100
    ms = (time.perf_counter() - t0) / 100 * 1000
print(f"{ms:.1f} ms por batch de 32")
```

:::figura pytorch-fila
Arriba, la CPU deja los kernels en la fila en pocos milisegundos y para el reloj. Abajo, la GPU los corre uno tras otro y termina mucho después. Sin sincronizar, mides el tramo de arriba; con `synchronize()`, el de abajo.
:::

Las fotos por segundo salen de dividir: \(f = k ÷ t_{batch}\), con \(k\) las fotos del batch y \(t_{batch}\) los segundos que tarda el batch según el reloj.

:::cuenta Lo que mide un reloj sin sincronizar
Kernels de la ResNet-50 sin fusionar // uno por operación; la cuenta de la lección «CPU y GPU» | — | 174
CPU para dejarlos en la fila // supuesto: ≈ 10 µs (millonésimas de segundo) cada uno, con Python de por medio | 174 × 10 µs | ≈ 1.7 ms
GPU para correr un batch de 32 en FP32 // supuesto para el ejemplo | — | ≈ 60 ms
Fotos por segundo según el reloj sin sincronizar // \(t_{batch}\) = 1.7 ms, la fila de la CPU | \(f = k ÷ t_{batch}\) = 32 ÷ 0.0017 s | ≈ 18,800
Fotos por segundo de verdad // \(t_{batch}\) = 60 ms, la fila de la GPU | \(f = k ÷ t_{batch}\) = 32 ÷ 0.060 s | ≈ 530
Cuánto exagera // las dos fotos por segundo, divididas | 18,800 ÷ 530 | ≈ 35
= El reloj sin sincronizar exagera ≈ 35 veces. Los dos tiempos son supuestos; la lección es que sin `synchronize()` el número no significa nada.
:::

Hay sincronizaciones escondidas. `x.item()` (sacar un número de un tensor), `x.cpu()`, `print(x)` o un `if` que depende de un tensor necesitan el resultado, así que esperan a la GPU sin avisar. Si en medio de tu cálculo pones un `print`, la CPU espera ahí y deja de adelantarse: el código se vuelve más lento justo donde querías mirarlo.

:::nota El profiler, en una línea
Para saber en qué se va el tiempo kernel por kernel, PyTorch trae un medidor: `torch.profiler.profile`. Anota cuándo empezó y terminó cada operación en la CPU y en la GPU, y arma una tabla y una línea de tiempo como la de la figura.
:::

### La memoria que PyTorch se queda

Pedirle memoria al [[driver]] de la GPU es lento. Por eso PyTorch tiene un [[caching-allocator|*caching allocator*]] (un repartidor de memoria que se guarda lo que le sobra): cuando un tensor se borra, PyTorch no le devuelve su memoria al driver, sino que la aparta para el siguiente tensor que la necesite. Dos números lo describen:

- `torch.cuda.memory_allocated()`: lo que ocupan los tensores que existen ahora.
- `torch.cuda.memory_reserved()`: lo que PyTorch ya pidió al driver, ocupado o apartado.

`nvidia-smi`, la herramienta de NVIDIA que muestra en la terminal cuánta memoria usa cada proceso, no sabe nada de eso: ve la memoria reservada **más** el contexto de CUDA, lo que ocupan CUDA y sus bibliotecas en cuanto arrancan (de 0.3 a 0.8 GB en las T4 de Alba). Por eso una GPU que «está llena» en nvidia-smi puede tener casi todo libre por dentro.

:::figura pytorch-memoria
La memoria de una T4 de 16 GB con un servidor de PyTorch. nvidia-smi suma todo lo que el proceso tiene: el contexto de CUDA, los tensores vivos y lo que el allocator apartó. memory_allocated solo cuenta los tensores vivos.
:::

Si un tensor no cabe ni en lo apartado ni en lo libre, PyTorch truena con un [[oom|OOM]] de CUDA (*out of memory*, sin memoria): una excepción, la forma de Python de avisar un error, `torch.cuda.OutOfMemoryError`, con un mensaje que empieza con «CUDA out of memory. Tried to allocate…». No es el OOMKilled de Kubernetes, que es la RAM del contenedor: este es la VRAM, adentro del proceso, y el programa lo puede atrapar. Se arregla con un batch o una imagen más chicos, con menos procesos por GPU o con otra GPU.

`torch.cuda.empty_cache()` le devuelve al driver lo apartado que nadie usa. Sirve para que **otro proceso** pueda usar esa memoria, o para que nvidia-smi muestre el número real. No libera ni un byte de un tensor que siga vivo, así que no arregla un OOM de tu propio proceso: el siguiente batch pediría esa memoria otra vez.

:::profundo Cuánta VRAM pide de verdad un batch
Para elegir el batch más grande que cabe, no se adivina: se mide el pico. PyTorch guarda el máximo de `memory_allocated` desde la última vez que lo reiniciaste. Es una ilustración, sin salida, porque necesita una GPU:

```python
torch.cuda.reset_peak_memory_stats()                  # el pico vuelve a 0
with torch.inference_mode():
    modelo(torch.randn(32, 3, 224, 224, device="cuda"))
torch.cuda.synchronize()
print(torch.cuda.max_memory_allocated() / 1e9, "GB en el pico")   # pesos + activaciones vivas
```

El pico incluye los pesos y las activaciones que estuvieron vivas al mismo tiempo. A eso se le suma el contexto de CUDA y un margen, porque el allocator parte la memoria en bloques y no siempre cabe un tensor grande aunque la suma de huecos alcance (la *fragmentación*). El allocator se ajusta con una [[variable-entorno|variable de entorno]] (un valor con nombre que el proceso recibe al arrancar): `PYTORCH_ALLOC_CONF=expandable_segments:True` le deja agrandar un bloque en vez de pedir otro aparte, y suele bajar la fragmentación. En PyTorch 2.15 ese es el nombre principal; el viejo, `PYTORCH_CUDA_ALLOC_CONF`, que vas a ver en muchos tutoriales, sigue funcionando.
:::

Sin medir, la VRAM de un servidor se estima con una suma por proceso:

:::formula VRAM de un servidor de PyTorch
M_{proc} = c + w + k × a
M = P × M_{proc}
- c: el contexto de CUDA de cada proceso, en GB (de 0.3 a 0.8 GB en las T4 de Alba)
- w: los pesos de cada proceso, en GB: ≈ 0.098 GB para la ResNet-50 en FP32
- k: las fotos por batch
- a: lo que guarda cada foto, en GB: ≈ 0.086 con autograd prendido (lo midió el bloque de autograd); ≈ 0.010 con inference_mode, solo las activaciones vivas
- P: los procesos en la GPU
- M_{proc}: la VRAM de un proceso, en GB
- M: la VRAM de todos los procesos juntos, en GB
:::

:::calculadora pytorch-vram
Prueba prender autograd con los 4 procesos: el batch de 32 guarda ≈ 86 MB por foto y la T4 pasa del 80 %. Con un quinto proceso, ya no cabe.
:::

## Compilar y exportar: torch.compile, TorchScript y torch.export {Compiling and exporting: torch.compile, TorchScript and torch.export}

En eager, cada operación pasa por Python y lanza su propio kernel. Para quitarle ese costo, y para poder correr el modelo fuera de Python, primero hay que **capturarlo**: convertir el `forward` en una gráfica fija de operaciones. PyTorch tiene tres maneras.

### torch.compile: compilar en la primera llamada

[[torch-compile|`torch.compile(modelo)`]] (desde PyTorch 2.0, en 2023) regresa un modelo que se usa igual que el original. La primera vez que lo llamas, PyTorch lee el `forward` mientras corre, captura sus operaciones en una gráfica y la [[compilar|compila]]: junta varias operaciones en un solo kernel (las *fusiona*) y genera código para tu chip. Las siguientes llamadas usan ese código.

Ese código vale para ciertas condiciones, que PyTorch revisa en cada llamada con unas **guardas** (*guards*): las formas y los dtypes de la entrada. Si una guarda falla, por ejemplo porque llegó un batch de otro tamaño, **vuelve a compilar**. Este bloque usa un compilador de juguete que solo anota cuándo lo llaman, para ver las compilaciones sin esperarlas:

```python
import torch
from torch import nn

compilaciones = []
def contar(grafica, entradas):          # un «compilador» de juguete: anota y no optimiza
    dinamica = any(not isinstance(e, torch.Tensor) for e in entradas)
    compilaciones.append("batch variable" if dinamica else "batch fijo")
    return grafica.forward              # corre la gráfica capturada tal cual

torch.manual_seed(0)
red = nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 5)).eval()
compilada = torch.compile(red, backend=contar)

with torch.inference_mode():
    for batch in (1, 1, 8, 4, 32):
        compilada(torch.randn(batch, 16))
        print(f"batch {batch:>2} → compilaciones: {len(compilaciones)}")
    x = torch.randn(3, 16)
    print("¿da lo mismo que sin compilar?", torch.allclose(compilada(x), red(x)))
print(compilaciones)
```

```salida
batch  1 → compilaciones: 1
batch  1 → compilaciones: 1
batch  8 → compilaciones: 2
batch  4 → compilaciones: 2
batch 32 → compilaciones: 2
¿da lo mismo que sin compilar? True
['batch fijo', 'batch variable']
```

La primera compilación fue para batch 1 exacto. Con el 8 falló la guarda, y PyTorch recompiló con el batch como variable; en esta red chiquita, el 4 y el 32 ya cupieron. Con un modelo de verdad cada compilación tarda: el equipo de Alba midió su ResNet-50 en CPU y la primera llamada tardó **≈ 17 s**, el primer batch de 8 recompiló en ≈ 6 s, y el de 16 recompiló otra vez, porque la guarda de esa versión variable decía «batch de 2 a 15». Ya compilada, la ganancia fue modesta: ≈ 15 ms contra ≈ 16–19 ms en eager, de 1.1 a 1.2 veces. En GPU suele ganar más, pero depende del modelo y del batch: se mide.

`torch.compile` tiene tres modos. El normal fusiona operaciones. `mode="reduce-overhead"` además graba la secuencia de kernels con *CUDA graphs* para relanzarla de un jalón, lo que ayuda con batches chicos en GPU, donde lanzar cuesta más que calcular. Y `mode="max-autotune"` prueba varias versiones de cada kernel y se queda con la más rápida, a cambio de compilar mucho más lento.

### TorchScript: el camino viejo

[[torchscript|TorchScript]] fue la primera manera de sacar un modelo de Python. Tiene dos modos. `torch.jit.trace` corre el modelo una vez con una entrada de ejemplo y graba las operaciones que pasaron. `torch.jit.script` lee el código de Python y lo traduce, con todo y sus `if`. El resultado es un archivo que corre sin tu código de Python, y Triton, el servidor de modelos de Alba, todavía lo sabe cargar.

Hoy va de salida: desde 2025, la documentación de PyTorch lo marca como obsoleto (*deprecated*) y pide usar `torch.export`, y ya no recibe funciones nuevas. Con Python 3.14, PyTorch 2.15 avisa al usarlo que no está soportado en esa versión y que puede fallar.

:::profundo Trace contra script: el if que desaparece
`trace` graba lo que pasó con **esa** entrada. Si el `forward` tiene un `if` que depende de los datos, se graba solo el camino que se tomó, y el otro desaparece sin error:

```python
import warnings
import torch
from torch import nn
warnings.filterwarnings("ignore")                    # TorchScript avisa que va de salida

class Recorte(nn.Module):
    def forward(self, x):
        if x.sum() > 0:                              # un if que depende de los datos
            return x * 2
        return x - 100

m = Recorte()
positivo, negativo = torch.ones(3), -torch.ones(3)
trazado = torch.jit.trace(m, positivo)               # corre una vez y graba lo que pasó
escrito = torch.jit.script(m)                        # lee el código, con todo y el if
print("original:", m(negativo).tolist())
print("trace:   ", trazado(negativo).tolist())
print("script:  ", escrito(negativo).tolist())
```

```salida
original: [-101.0, -101.0, -101.0]
trace:    [-2.0, -2.0, -2.0]
script:   [-101.0, -101.0, -101.0]
```

El trazado multiplicó por 2 un número negativo, porque con el ejemplo positivo nunca vio la otra rama. Con el batch pasa una trampa parecida: si exportas con un ejemplo de batch 1, algunas herramientas fijan el 1 como constante. Por eso Alba exporta con un ejemplo de batch 2.
:::

### torch.export: la gráfica completa, con sus formas

[[torch-export|`torch.export.export`]] (desde PyTorch 2.1, en 2023) captura el modelo **completo** antes de correrlo en producción, y falla si no puede: no deja pedazos sueltos en Python. Le dices qué dimensiones pueden cambiar y entre qué valores, y regresa un programa con la gráfica, los pesos y esas formas declaradas.

```python
import torch
from torch import nn
from torch.export import Dim, export

torch.manual_seed(0)
red = nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 5)).eval()
batch = Dim("batch", min=1, max=32)                 # el rango que promete el contrato
programa = export(red, (torch.randn(2, 16),), dynamic_shapes=({0: batch},))

ops = [n.target.__name__ for n in programa.graph.nodes if n.op == "call_function"]
print("operaciones capturadas:", ops)
corre = programa.module()                           # se puede correr como un módulo
x = torch.randn(7, 16)
print("¿mismo resultado?", torch.allclose(corre(x), red(x)))
try:
    corre(torch.randn(40, 16))                      # 40 está fuera del rango declarado
except Exception as error:
    print(type(error).__name__, "·", str(error).splitlines()[0])
```

```salida
operaciones capturadas: ['linear.default', 'relu.default', 'linear.default']
¿mismo resultado? True
AssertionError · Guard failed: input.size()[0] <= 32
```

Ese programa es el punto de partida de lo nuevo. Desde PyTorch 2.9, `torch.onnx.export`, el exportador a [[onnx|ONNX]] (un formato de modelo que leen muchas herramientas, no solo PyTorch), parte de `torch.export` por omisión (`dynamo=True`). Alba todavía usa el exportador viejo, el que traza el modelo con TorchScript (lo corre una vez y graba lo que pasó) (`dynamo=False`, con un ejemplo de batch 2 y el batch declarado como dinámico), y su equipo tiene anotado el plan de pasarse al nuevo. De ese ONNX, Alba construye su [[engine-tensorrt|engine de TensorRT]]: el modelo compilado por la herramienta de NVIDIA para un tipo de GPU, la T4. Y AOTInductor compila el programa de `torch.export` por adelantado en un archivo `.pt2` que se carga sin compilar nada. Los dos caminos los ves a fondo en la lección «Export, engine y paridad».

:::diagrama pytorch-caminos
La línea ámbar es el camino de Alba hoy: TorchScript, ONNX, engine de TensorRT y Triton. Toca cada caja, o usa «Recorrer» para seguir ese camino, el de quedarse en PyTorch y el viejo.
:::

:::ojo
`torch.export` y `torch.compile` capturan el modelo **tal como está**. Si está en modo train, la BatchNorm se captura con las estadísticas del batch. Con la ResNet-50 de Alba, el modelo capturado en modo train tuvo 0 % de acuerdo con el modelo en eval. Antes de capturar o exportar, `model.eval()`.
:::

## autocast y determinismo {autocast and determinism} [extra]

Dos herramientas que cambian los números del modelo en el último decimal: una a propósito, para ir más rápido, y otra sin querer, por cómo suman las GPUs. Las dos explican por qué la [[prueba-paridad|prueba de paridad]] compara con tolerancia.

### autocast: 16 bits donde es seguro

En la lección «Cómo guarda números una computadora» viste la [[precision-mixta|precisión mixta]]. [[autocast|`torch.autocast`]] es la pieza que la hace (en PyTorch, la precisión mixta se llama AMP, de *automatic mixed precision*): dentro de su `with`, cada operación corre en el dtype que le conviene. Las multiplicaciones de matrices y las convoluciones van en FP16 o BF16; lo delicado, como la pérdida, se queda en FP32. **Los pesos no cambian**: siguen en FP32 y se convierten al vuelo, operación por operación.

Al servir, autocast es la forma de correr en 16 bits sin tocar el checkpoint. La otra es convertir el modelo entero con `modelo.half()`, que sí cambia los pesos a FP16 y ahorra su memoria. En CPU, autocast usa BF16. El bloque compara contra FP32 con `torch.allclose(a, b, atol=…)`, que responde `True` si cada número de `a` queda a menos de `atol` (la tolerancia) del de `b`:

```python
import torch
from torch import nn
import torch.nn.functional as F

torch.manual_seed(0)
capa = nn.Linear(64, 500).eval()               # una cabeza de 500 clases
x = torch.randn(8, 64)                         # 8 fotos, ya convertidas en 64 números

with torch.inference_mode():
    ref = capa(x)                              # FP32 de punta a punta
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        y = capa(x)                            # la multiplicación, en BF16
        perdida = F.cross_entropy(y, torch.zeros(8, dtype=torch.long))
print("pesos:", capa.weight.dtype, "· logits:", y.dtype, "· pérdida:", perdida.dtype)
print(f"diferencia máxima de logits: {(y.float() - ref).abs().max().item():.3f}")
print("fotos con el mismo top-1:", (y.argmax(-1) == ref.argmax(-1)).sum().item(), "de 8")
print("¿allclose con atol 0.0001?", torch.allclose(y.float(), ref, atol=1e-4))
print("¿allclose con atol 0.05?", torch.allclose(y.float(), ref, atol=5e-2))
```

```salida
pesos: torch.float32 · logits: torch.bfloat16 · pérdida: torch.float32
diferencia máxima de logits: 0.007
fotos con el mismo top-1: 7 de 8
¿allclose con atol 0.0001? False
¿allclose con atol 0.05? True
```

Con pesos al azar, los 500 logits salen muy parejos, así que un error de 0.007 basta para que una foto cambie de top-1. En un modelo entrenado, el logit ganador suele ir lejos del segundo y el acuerdo es mucho más alto. Por eso la paridad de Alba mide las dos cosas: la diferencia máxima de logits y el acuerdo del top-1 (99.5 % como mínimo).

### Determinismo: la misma entrada, ¿la misma salida?

Un programa es [[determinismo|determinista]] si la misma entrada da siempre exactamente la misma salida. Un modelo en eval es una función fija, así que uno esperaría que sí. Hay tres razones por las que no siempre pasa:

- **El azar.** Inicializar pesos, revolver el DataLoader, Dropout y las aumentaciones usan números al azar. `torch.manual_seed(17)` fija la [[semilla]] de PyTorch en la CPU y en todas las GPUs. El entrenamiento de Alba usa esa semilla, 17, y fija además la de Python y la de NumPy, y una por worker.
- **El orden de las sumas.** En punto flotante, (x + y) + z no siempre es igual a x + (y + z), porque cada suma redondea. Las GPUs suman en paralelo, y algunas operaciones no garantizan en qué orden. `torch.use_deterministic_algorithms(True)` obliga a usar la versión de orden fijo de cada operación, y truena si una no la tiene. En GPU, además hay que poner la variable `CUBLAS_WORKSPACE_CONFIG=":4096:8"`, que pide cuBLAS, la biblioteca de NVIDIA que multiplica matrices.
- **El algoritmo elegido.** cuDNN, la biblioteca de NVIDIA para convoluciones, tiene varios algoritmos para cada una. Con `torch.backends.cudnn.benchmark = True`, prueba varios al arrancar y se queda con el más rápido para tu GPU y tus formas. Corre más rápido, pero el ganador puede cambiar de una corrida a otra, y con él el último decimal.

```python
import torch

grande, uno = torch.tensor(1e8), torch.tensor(1.0)   # float32
print("(1e8 + 1) − 1e8 =", ((grande + uno) - grande).item())
print("(1e8 − 1e8) + 1 =", ((grande - grande) + uno).item())

torch.manual_seed(17)
x = torch.randn(10_000)
adelante = torch.zeros(())
for v in x:                                        # sumar en un orden...
    adelante += v
atras = torch.zeros(())
for v in x.flip(0):                                # ...y en el contrario
    atras += v
print(f"hacia adelante {adelante.item():.5f} · hacia atrás {atras.item():.5f}")
print("¿idénticas?", torch.equal(adelante, atras), "· ¿cercanas?", torch.allclose(adelante, atras, atol=1e-3))
```

```salida
(1e8 + 1) − 1e8 = 0.0
(1e8 − 1e8) + 1 = 1.0
hacia adelante 118.51544 · hacia atrás 118.51550
¿idénticas? False · ¿cercanas? True
```

Los mismos 10,000 números, sumados en dos órdenes, difieren desde el quinto decimal. Nadie se equivocó: es el [[redondeo]] de cada suma.

La documentación de PyTorch dice qué esperar: no garantiza resultados idénticos entre versiones, entre plataformas, ni entre CPU y GPU, aun con las mismas semillas. «Reproducible» quiere decir «el mismo resultado dentro del ruido», no bit a bit. Fija las semillas siempre, y prende el modo determinista cuando estés investigando una diferencia: es más lento. Así se ven las semillas del entrenamiento de Alba, con una por worker del DataLoader (ilustración: `train_ds` es el Dataset del entrenamiento):

```python
import random, numpy as np, torch
from torch.utils.data import DataLoader

def seed_worker(worker_id):                  # corre una vez en cada worker
    s = torch.initial_seed() % 2**32         # PyTorch ya le dio una semilla distinta a cada uno
    np.random.seed(s); random.seed(s)        # las aumentaciones con NumPy o random, también fijas

random.seed(17); np.random.seed(17); torch.manual_seed(17)
g = torch.Generator().manual_seed(17)
loader = DataLoader(train_ds, batch_size=64, shuffle=True, num_workers=8,
                    worker_init_fn=seed_worker, generator=g)
```

Por eso la paridad entre el modelo de PyTorch y el que se sirve nunca exige `==`. Compara con tolerancia: ≈ 0.0001 entre dos FP32 y ≈ 0.01 contra FP16.

### La paridad, en código

Con lo de esta sección ya se puede escribir una paridad de verdad, en chiquito. La referencia es el modelo en eval y FP32. Cada candidato pasa si su diferencia máxima de logits queda dentro de la tolerancia de su formato y si el top-1 coincide en al menos 99.5 % de las fotos, el umbral de Alba:

```python
import copy
import torch
from torch import nn
from torch.export import Dim, export

torch.manual_seed(0)
modelo = nn.Sequential(nn.Conv2d(3, 16, 3), nn.BatchNorm2d(16), nn.ReLU(),
                       nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Linear(16, 10)).eval()
fotos = torch.randn(64, 3, 32, 32)                 # 64 «fotos» de prueba

def en_bf16(x):                                    # el mismo modelo, con autocast
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        return modelo(x)

exportado = export(modelo, (fotos[:2],), dynamic_shapes=({0: Dim("batch", min=1, max=64)},)).module()

def paridad(nombre, candidato, tolerancia):
    with torch.inference_mode():
        ref, otro = modelo(fotos), candidato(fotos).float()
    dif = (ref - otro).abs().max().item()
    acuerdo = (ref.argmax(-1) == otro.argmax(-1)).float().mean().item()
    pasa = dif <= tolerancia and acuerdo >= 0.995
    print(f"{nombre:<10} diferencia máxima {dif:.0e} · top-1 igual {acuerdo:.1%} · ¿pasa? {pasa}")

paridad("exportado", exportado, 1e-4)
paridad("BF16", en_bf16, 1e-2)
paridad("sin eval()", copy.deepcopy(modelo).train(), 1e-4)
```

```salida
exportado  diferencia máxima 0e+00 · top-1 igual 100.0% · ¿pasa? True
BF16       diferencia máxima 1e-03 · top-1 igual 100.0% · ¿pasa? True
sin eval() diferencia máxima 2e-01 · top-1 igual 100.0% · ¿pasa? False
```

En la salida, `1e-03` es 0.001 (un 1 corrido tres lugares a la derecha del punto). El exportado da exactamente lo mismo porque, en la misma máquina, corre las mismas operaciones; un engine de TensorRT no las corre igual, y por eso su tolerancia es la de FP16. El BF16 se mueve en el tercer decimal y pasa. El tercero es el bug del modo train: el top-1 coincidió en las 64 fotos, y aun así la diferencia de logits lo delató. Por eso la paridad mira las dos cosas.

## torchvision y el warmup de inferencia {torchvision and inference warmup}

### torchvision: modelos con su receta

[[torchvision]] es la parte de PyTorch para imágenes. Entre otras cosas (datasets famosos, lectores de imágenes y video, operaciones de detección), trae tres que importan aquí: arquitecturas ya escritas (`resnet50`, `mobilenet_v3_large`…), pesos entrenados con ImageNet para cada una y las *transforms*, las funciones de [[preprocesamiento]] que viste en la lección de imágenes. Cada versión de pesos sabe con qué receta se evaluó. Este bloque la consulta sin descargar nada:

```python
from torchvision.models import ResNet50_Weights, resnet50

for pesos in ResNet50_Weights:                      # las dos versiones de pesos de ImageNet
    receta = pesos.transforms()                     # el preprocesamiento con que se evaluaron
    top1 = pesos.meta["_metrics"]["ImageNet-1K"]["acc@1"]
    print(f"{pesos.name}: resize {receta.resize_size} · crop {receta.crop_size} · top-1 {top1} %")
print("normalización:", receta.mean, receta.std)

modelo = resnet50(weights=None)                     # la arquitectura, sin descargar pesos
print(f"{sum(p.numel() for p in modelo.parameters()):,} parámetros · {modelo.fc.out_features} clases")
```

```salida
IMAGENET1K_V1: resize [256] · crop [224] · top-1 76.13 %
IMAGENET1K_V2: resize [232] · crop [224] · top-1 80.858 %
normalización: [0.485, 0.456, 0.406] [0.229, 0.224, 0.225]
25,557,032 parámetros · 1000 clases
```

Las dos versiones de la misma arquitectura se evaluaron con recetas distintas: la V2 achica a 232 y no a 256. La regla no es «usa la receta de torchvision», sino **«sirve con el mismo preprocesamiento con el que entrenaste»**. Alba entrena con `Resize(256)`, así que su gateway usa `Resize(256)`, aunque los pesos V2 de torchvision se hayan evaluado con 232. Un preprocesamiento distinto no da ningún error: da [[training-serving-skew]], y el modelo acierta menos.

### Warmup de inferencia: calentar antes de abrir

Las primeras requests de un servidor recién arrancado son lentas. En la primera llamada pasan cosas que después ya no: CUDA carga sus kernels en la GPU, el caching allocator pide su memoria al driver, cuDNN (la biblioteca de NVIDIA para convoluciones) elige algoritmos y, si usas torch.compile, se compila todo. En la CPU de la Mac donde se revisó esta lección, la primera foto de la ResNet-50 tardó ≈ 17 a 35 ms y las siguientes ≈ 15 a 16 ms: en la CPU, sin compilar, la diferencia es chica y cambia de una corrida a otra. En una GPU pesa más, porque la primera llamada además arranca CUDA y carga sus bibliotecas. Con torch.compile, son los ≈ 17 s de arriba.

El [[warmup-inferencia|warmup de inferencia]] es pagar eso antes de recibir tráfico: el servidor corre unas cuantas requests falsas al arrancar, con todos los tamaños de batch que va a ver, y solo después se declara listo en su [[health-check|*readiness*]], la pregunta con que Kubernetes decide si ya le manda tráfico. El primer servidor de Alba, uno de [[fastapi|FastAPI]] (la biblioteca de Python con que se escriben servidores web), mandaba una foto negra de 256 × 256 (`Image.new("RGB", (256, 256))`, que nace en ceros); el de hoy, Triton, corre tres batches de 32.

Un buen warmup tiene tres reglas. Usa **las mismas formas** que va a ver el tráfico: si el servidor arma batches de 1 a 32, cada tamaño que dispare una compilación o una elección de algoritmo nuevo tiene que pasar por ahí. No necesita fotos reales: unos tensores en ceros o una imagen negra bastan, porque lo que se calienta es el código, no la respuesta. Y la readiness depende de que termine, porque el warmup que corre mientras ya llega tráfico no protege a nadie.

:::profundo El warmup de Triton en Alba
En Triton, el warmup se declara en la configuración de cada modelo, el archivo `config.pbtxt`. Este es el de Alba: tres corridas con un batch de 32 en ceros antes de marcar el modelo como listo.

```
model_warmup [ { name: "warmup_max_batch", batch_size: 32, count: 3,
  inputs { key: "input", value: { data_type: TYPE_FP32, dims: [ 3, 224, 224 ], zero_data: true } } } ]
```

Triton no reporta el modelo como listo hasta terminar el warmup, así que su readiness ya lo toma en cuenta. Un engine de TensorRT no compila nada en el warmup, porque ya viene compilado: lo que se calienta es la memoria y el contexto de CUDA. El equipo de Alba estima que cargar el engine de la ResNet-50 y hacer el warmup toma ≈ 10 a 60 s.
:::

:::ojo
No lo confundas con el [[warmup]] de la lección «Cómo aprende un modelo»: subir poco a poco el learning rate en los primeros pasos del entrenamiento. Es la misma palabra para otra cosa. El de entrenar cuida que el modelo no dé saltos al empezar; el de inferencia, que un usuario no espere la preparación del servidor.
:::

Cuántas requests pierde un pod sin warmup se estima con una multiplicación: las que llegan por segundo, por los segundos que el servidor pasa ocupado preparándose.

:::formula Requests que fallan sin warmup
F ≈ r × (t_1 + n_{rec} × t_{rec})
- r: las requests por segundo que llegan al pod
- t_1: los segundos de la primera llamada
- n_{rec}: las recompilaciones que paga el tráfico
- t_{rec}: los segundos de cada recompilación
- F: las requests que fallan en el pod. Solo cuenta las esperas más largas que el timeout del gateway (0.15 s en Alba); una espera más corta no tira ninguna
:::

Si arrancan varios pods a la vez, se multiplica por cuántos son.

:::calculadora pytorch-warmup
Baja a 0 los segundos de la primera llamada y las recompilaciones: eso es lo que logra un warmup completo. Ningún usuario las paga.
:::

:::diagrama pytorch-arranque
Del archivo de pesos a la primera respuesta. Fíjate en que el archivo entra en `load_state_dict` y no en `build_model()`: primero la arquitectura, después los pesos. Usa «Recorrer» para seguir un arranque bien hecho y los tres errores más comunes.
:::

## Errores comunes {Common mistakes}

### 1. Olvidar model.eval()

Un modelo recién creado o cargado está en modo train. Responde, y responde distinto: la BatchNorm usa las estadísticas de cada batch y las mete en su memoria, y el Dropout apaga neuronas al azar. Nada truena.

**Cómo evitarlo:** una función que construya el modelo y regrese `model.eval()`, como el `build_model()` de Alba, usada en el servidor, en el export y en la referencia de la paridad. Y una prueba que mande la misma foto dos veces y exija la misma respuesta.

### 2. El inference_mode en el hilo equivocado

El modo de autograd vale por [[hilo]]. En un servidor [[async]], `with torch.inference_mode(): await run_in_threadpool(predecir, x)` lo prende en el hilo del [[event-loop|event loop]], pero el modelo corre en otro hilo del [[threadpool|pool de hilos]], con autograd prendido. Se nota en la salida: sale con `requires_grad=True`. Funciona, pero cada request guarda su gráfica.

**Cómo evitarlo:** el `with` va dentro de la función que corre el modelo. Una prueba barata: revisar que la salida tenga `requires_grad=False`.

### 3. Cargar con strict=False para callar un error

El checkpoint no carga y alguien pone `strict=False`. Ahora carga… sin las llaves que no coincidían. Un caso típico: un modelo entrenado con `nn.DataParallel`, una forma vieja de entrenar con varias GPUs a la vez, guarda cada nombre con `module.` adelante (`module.fc.weight`). Con `strict=False`, no carga **ni uno** de los 320 tensores, y el modelo responde con pesos al azar.

**Cómo evitarlo:** `strict=True` siempre en el servidor. Si los nombres traen un prefijo, quítalo a propósito: `{k.removeprefix("module."): v for k, v in estado.items()}` arma un diccionario nuevo con los mismos tensores y los nombres sin `module.`. Después vuelve a cargar con `strict=True`.

### 4. Medir la GPU sin sincronizar

`time.time()` alrededor de `modelo(x)` mide el lanzamiento, no el cálculo. Salen fotos por segundo de fantasía, y la [[prueba-carga|prueba de carga]] las desmiente.

**Cómo evitarlo:** `torch.cuda.synchronize()` antes de parar el reloj, varias llamadas para calentar antes de medir, y muchas repeticiones. O medir desde afuera, con requests de verdad.

### 5. Leer nvidia-smi como si fueran tus tensores

«nvidia-smi marca 14 GB: el modelo tiene una fuga de memoria.» Muchas veces es el allocator, que se quedó con lo que usó el batch más grande. Al revés también engaña: con `empty_cache()` en cada request, nvidia-smi se ve bonito y cada request paga pedir memoria otra vez.

**Cómo evitarlo:** vigilar `memory_allocated` y `max_memory_allocated` desde PyTorch, y nvidia-smi para saber cuánta memoria le queda a la GPU. Si hay OOM, bajar el batch o los procesos, no llamar a `empty_cache`.

### 6. Abrir el tráfico antes del warmup

El [[pod]] (cada copia del servidor que corre Kubernetes) pasa su readiness en cuanto carga los pesos. La primera request paga la compilación o la inicialización de CUDA; con un timeout de 0.15 s como el del gateway de Alba, todas las que lleguen en ese rato fallan. Pasa en cada pod nuevo, justo cuando el tráfico sube y el autoescalado agrega pods.

**Cómo evitarlo:** la readiness responde «listo» solo después del warmup, con todas las formas de batch que el servidor va a ver.

## En la vida real {In real life} [extra]

### Alba: del notebook al servicio

Alba recorre esta lección completa. El MVP, la primera versión, era un proceso de FastAPI con PyTorch adentro. Al arrancar, construye `resnet50(num_classes=500)`, carga el state_dict con `map_location="cpu"` y `weights_only=True`, lo pasa a eval y a la GPU, y corre una foto negra de warmup. En cada request, preprocesa con las mismas transforms del entrenamiento y llama al modelo dentro de `inference_mode`.

Funcionaba, pero no crecía: PyTorch en eager, en FP32 y de una foto a la vez, da del orden de 100 fotos por segundo por proceso en una T4. Para el pico de diseño de Alba, 500 requests por segundo, harían falta 500 ÷ 100 ≈ 5 GPUs. La versión final exporta: el modelo en eval, a ONNX con batch dinámico de 1 a 32, de ahí a un engine de TensorRT en FP16, servido con Triton a ≈ 1,200 fotos por segundo por T4. Antes de publicar, la paridad compara el engine con el modelo de PyTorch en FP32 sobre las mismas fotos: el top-1 tiene que coincidir en 99.5 % o más. Y Triton corre tres batches de 32 de warmup antes de declararse listo.

El entrenamiento mensual sí usa todo lo demás: un DataLoader con 8 workers y batches de 64, AMP con autocast, la semilla 17 y un checkpoint que guarda, además de los pesos, el estado del optimizador, del GradScaler (la pieza de la precisión mixta que escala la pérdida para que los gradientes en FP16 no se vuelvan cero) y de los generadores al azar. Sin ellos, reanudar no es seguir.

### Un servidor que se come la VRAM: varios workers

FastAPI tiene una trampa. [[uvicorn]] es el programa que corre un servidor de FastAPI, y puede arrancar varios [[worker|workers]]: cada uno es un proceso con su copia de los pesos y su propio contexto de CUDA. Con 4 workers en una T4, solo eso son 4 × (≈ 0.1 GB de pesos + 0.3 a 1 GB de contexto) ≈ 1.6 a 4.4 GB, antes de las activaciones. Aquí el contexto va con más margen que los 0.3 a 0.8 GB de las T4 de Alba, porque depende de qué bibliotecas de CUDA cargue cada proceso. Con un modelo chico, cabe. Con Llama 3 8B en BF16, ≈ 16.1 GB de pesos, dos workers ya son ≈ 32 GB: no caben en una L4 de 24 GB, y el segundo truena con un OOM de CUDA al arrancar. Por eso los LLMs se sirven con un solo proceso por GPU, como vLLM, que además aparta de entrada casi toda la memoria para su [[kv-cache|KV cache]].

### Un LLM propio que aparta la GPU entera

Un servicio que sirve su propio LLM, como el de este ejemplo, puede usar uno de ≈ 70,600 millones de parámetros con vLLM. vLLM es PyTorch por dentro, pero no deja que el caching allocator decida: al arrancar aparta el 90 % de la VRAM (`gpu_memory_utilization=0.9`), carga ahí los pesos y reparte lo que sobra en bloques fijos para el KV cache. Así, un OOM a media conversación casi no puede pasar: si no hay bloques libres, las requests nuevas esperan en la cola y, si hace falta, vLLM saca una conversación y la recalcula después, como viste en la lección de memoria. Conviene fijar ese 0.9 a mano, porque el valor por omisión cambió entre versiones.

Su arranque es el de esta lección, en grande: cargar ≈ 70.6 GB de pesos en FP8 desde safetensors con mmap, preparar los *CUDA graphs* (la secuencia de kernels grabada para relanzarla de un jalón) para varios tamaños de batch y solo entonces aceptar tráfico. Puede tardar minutos, y por eso un pod nuevo de ese servicio no recibe requests hasta pasar su readiness.

### Video de varias cámaras: exportar para la orilla

En un sistema que analiza en tiempo real el video de varias cámaras, como el de este ejemplo, cada centro de distribución tiene una caja con una GPU L4 que vigila 40 cámaras con un detector ligero en TensorRT FP16. Es la **orilla** (*edge*): la computadora está junto a las cámaras, no en la nube. Ahí no hay Python en el camino caliente, lo que corre con cada cuadro de video: el modelo se exporta desde PyTorch en eval, se convierte en engine para esa GPU y se valida con cuadros reales, de día y de noche. Lo que en Alba es un ahorro, en la orilla es obligatorio: la caja corre lejos, sin nadie que reinicie un proceso con autograd prendido.

### Calificar fotos viejas por lotes

Cuando Alba cambia de modelo, puede querer recalificar las ≈ 200 millones de fotos viejas de su catálogo. Eso no pasa por el gateway: es un trabajo offline que lee las fotos del [[object-storage|almacenamiento de objetos]], las pasa por un DataLoader con varios workers, `shuffle=False` y `pin_memory=True`, y corre el modelo en eval, con `inference_mode` y batches grandes. Ahí lo que importa es el [[throughput]], no la latencia, y el cuello de botella suele ser la CPU que decodifica.

### Fuera de ML: el cronómetro y la pizzería

Medir sin sincronizar es como medir cuánto tarda una pizzería con el reloj de la caja. La cajera toma tu orden en 20 segundos y la pasa a la cocina: si paras el cronómetro ahí, la pizzería «hace» 180 pizzas por hora. La pizza sale 15 minutos después. La cajera es la CPU, la cocina es la GPU, y `synchronize()` es esperar a que la pizza llegue a la mesa.

Dónde se rompe: la cocina de la GPU no hace una pizza a la vez, sino miles de cuentas en paralelo dentro de cada kernel. Y la cajera no espera a nadie: puede dejar cientos de órdenes en la fila antes de que salga la primera. Por eso, sin sincronizar, el error no es de unos segundos, sino de decenas de veces.

## Ejercicios {Exercises}

Resuélvelos con lápiz antes de abrir la solución. Los de memoria y warmup se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] La cabeza de Alba es `nn.Linear(2048, 500)`. ¿Cuántos parámetros tiene y cuántos MB pesa en FP32? ¿Por qué la ResNet-50 de ImageNet tiene 1,024,500 parámetros más que la de Alba?
- Una `nn.Linear` con \(n_{ent}\) números de entrada y \(n_{sal}\) de salida tiene \(n_{ent} × n_{sal}\) pesos y \(n_{sal}\) sesgos: \(n_{ent} × n_{sal} + n_{sal}\) parámetros. Aquí \(n_{ent}\) = 2,048 y \(n_{sal}\) = 500.
- Pesos: 2,048 × 500 = 1,024,000. Sesgos: 500. Total: **1,024,500**.
- En FP32, 4 B por parámetro: 1,024,500 × 4 B = 4,098,000 B ≈ **4.1 MB**.
- La de ImageNet tiene una cabeza de 1,000 clases, \(n_{sal}\) = 1,000: \(n_{ent} × n_{sal} + n_{sal}\) = 2,048 × 1,000 + 1,000 = 2,049,000. La diferencia es 2,049,000 − 1,024,500 = **1,024,500**: una cabeza de 500 más. Todo lo demás es igual: 25,557,032 − 24,532,532 = 1,024,500.
? [facil] Un servidor tiene el modelo en `cuda:0` y truena con «Expected all tensors to be on the same device, but found at least two devices, cuda:0 and cpu!». ¿Qué falta y dónde va?
- Falta mover la foto: el tensor nace en la CPU, y el modelo está en la GPU.
- Va en cada request, después de preprocesar: `x = x.to(DEVICE)`.
- El modelo se mueve una sola vez, al arrancar. La foto se mueve en cada request.
? [facil] Una `nn.BatchNorm2d(64)`: ¿qué entradas tiene en el state_dict, cuáles son parámetros y cuántos números guarda en total?
- Parámetros: `weight` y `bias`, de 64 números cada uno (uno por canal): 2 × 64 = **128**.
- Buffers: `running_mean` y `running_var`, de 64 cada uno, y `num_batches_tracked`, un solo número: 2 × 64 + 1 = **129**.
- Total: 5 entradas y 128 + 129 = **257** números. Solo 128 se aprenden con gradiente.
? [facil] ¿Cuál «warmup» es cada uno? (a) El learning rate sube de 0 a 0.0003 en los primeros 500 pasos. (b) Triton corre tres batches de 32 antes de marcar el modelo como listo. (c) Un pod con torch.compile manda batches de 1, 8 y 16 al arrancar.
- (a) Es el **warmup del entrenamiento**: cuida que el modelo no dé saltos al empezar.
- (b) y (c) son **warmup de inferencia**: pagar la preparación antes de que llegue el primer usuario.
? [medio] Con autograd prendido, la ResNet-50 guarda ≈ 86 MB por foto. Un servidor con 4 procesos en una T4 de 16 GB usa batches de 16; cada proceso tiene 0.5 GB de contexto de CUDA y 98 MB de pesos. ¿Cuánto usan los 4 procesos con autograd prendido? ¿Y con `inference_mode`, si las activaciones vivas son ≈ 10 MB por foto? (Es el centro del rango que mide Alba: activaciones y memoria de trabajo de ≈ 0.2 a 0.5 GB en un batch de 32, de ≈ 6 a 16 MB por foto.)
- Es la fórmula de la VRAM: \(M_{proc} = c + w + k × a\) y \(M = P × M_{proc}\), con \(c\) = 0.5 GB, \(w\) = 0.098 GB, \(k\) = 16 fotos y \(P\) = 4 procesos.
- Con autograd, \(a\) = 0.086 GB: \(M_{proc}\) = 0.5 + 0.098 + 16 × 0.086 = 0.5 + 0.098 + 1.376 ≈ **1.97 GB**. Los 4: \(M\) = 4 × 1.974 ≈ **7.9 GB**, la mitad de la T4.
- Con inference_mode, \(a\) = 0.010 GB: \(M_{proc}\) = 0.5 + 0.098 + 16 × 0.010 = 0.758 GB. Los 4: \(M\) = 4 × 0.758 ≈ **3.0 GB**.
- Apagar autograd libera 7.9 − 3.0 ≈ 4.9 GB. Con batches de 32, la diferencia se duplica.
? [medio] Un compañero mide su modelo en la GPU: sin `synchronize()`, 2 ms por batch de 32; con `synchronize()`, 25 ms. ¿Cuántas fotos por segundo dice cada medición? ¿Cuál usas para calcular cuántas GPUs hacen falta?
- Las dos salen de \(f = k ÷ t_{batch}\), con \(k\) = 32 fotos.
- Sin sincronizar, \(t_{batch}\) = 0.002 s: 32 ÷ 0.002 s = **16,000** fotos por segundo.
- Sincronizando, \(t_{batch}\) = 0.025 s: 32 ÷ 0.025 s = **1,280** fotos por segundo.
- La buena es la de 1,280: 2 ms es lo que tardó la CPU en dejar los kernels en la fila. Con la otra, comprarías 16,000 ÷ 1,280 = 12.5 veces menos GPUs de las necesarias.
? [medio] Un checkpoint viene de un entrenamiento con `nn.DataParallel`: sus llaves son `module.conv1.weight`, `module.fc.weight`… Con `strict=True` truena; con `strict=False`, «carga». ¿Qué cargó con `strict=False`? ¿Cómo lo arreglas?
- Ningún nombre coincide: los 320 del archivo sobran (*unexpected keys*) y los 320 del modelo faltan (*missing keys*). Se cargaron **cero** tensores: el modelo se quedó con sus pesos al azar.
- El arreglo: quitar el prefijo, `{k.removeprefix("module."): v for k, v in estado.items()}`, y cargar con `strict=True`, que ahora debe decir `<All keys matched successfully>`.
? [medio] nvidia-smi dice que el proceso usa 9.5 GB de la T4. Desde PyTorch, `memory_allocated` da 1.2 GB y `memory_reserved` da 8.8 GB. ¿Qué es cada pedazo? ¿Hay una fuga?
- Tensores vivos: **1.2 GB**.
- Apartado por el allocator y sin usar ahora, \(text{reservado} − text{vivo}\): 8.8 − 1.2 = **7.6 GB**. Seguramente lo usó un batch grande y se lo quedó para el siguiente.
- El resto de nvidia-smi, \(text{nvidia-smi} − text{reservado}\): 9.5 − 8.8 = **0.7 GB**, el contexto de CUDA y sus bibliotecas.
- No es fuga: una fuga se ve en `memory_allocated` creciendo request tras request. Para comprobarlo, se vigila `memory_allocated` a lo largo del tiempo.
? [reto] La paridad de un modelo servido con autocast en BF16 da una diferencia máxima de logits de 0.007 contra FP32, y 7 de 8 fotos con el mismo top-1, en una prueba con pesos al azar. Diseña la prueba que usarías antes de publicar: ¿qué entradas, qué tolerancia y qué umbral?
- Entradas: fotos reales, no al azar, como las 50,000 del golden set, con el preprocesamiento del gateway.
- Tolerancia de logits: la del formato. BF16 tiene ≈ 2 o 3 cifras, así que se espera una diferencia del orden de 0.01; una de 1 sería un bug. Se reporta la diferencia máxima, no se exige `==`.
- Umbral de decisión: el acuerdo del top-1, ≥ 99.5 % como en Alba, y el top-5 ≥ 99 %. Con pesos al azar los logits están casi empatados; con un modelo entrenado, el acuerdo sale mucho más alto.
- Y la calidad contra el golden set, por categoría y por slice, porque un promedio bueno puede esconder una categoría que empeoró.
? [reto] Un pod sirve la ResNet-50 con torch.compile y recibe 50 requests por segundo. La primera llamada tarda 17 s y hay 2 recompilaciones de ≈ 6 s cuando llegan batches nuevos. El gateway corta a los 0.15 s. Sin warmup, ¿cuántas requests fallan en ese pod? ¿Qué cambia con 10 pods que arrancan a la vez? Propón el arreglo.
- Es la fórmula del warmup: \(F ≈ r × (t_1 + n_{rec} × t_{rec})\), con \(r\) = 50 requests por segundo, \(t_1\) = 17 s, \(n_{rec}\) = 2 y \(t_{rec}\) = 6 s. Las dos esperas pasan de sobra los 0.15 s del timeout, así que cuentan.
- Primera llamada, \(r × t_1\): 50 × 17 = **850** requests esperan más de 0.15 s y fallan.
- Recompilaciones, \(r × n_{rec} × t_{rec}\): 50 × 2 × 6 = **600** más.
- Total: \(F\) = 850 + 600 = **1,450** por pod. Con 10 pods arrancando a la vez, por ejemplo en un autoescalado, son 10 × 1,450 = **14,500**, justo cuando el tráfico subió.
- Arreglo: warmup con todas las formas de batch (1, 2, 4, 8, 16 y 32) antes de la readiness; guardar el caché de compilación en la imagen o compilar por adelantado con AOTInductor. Con eso, cero requests pagan la compilación.
:::

## Lo que sigue {What comes next}

- La siguiente lección, **«Git: versiones del código»**, guarda el código que acabas de escribir; después, **«Pruebas y CI/CD»** convierte en pruebas automáticas lo de esta lección: la misma foto dos veces, `requires_grad=False` y la paridad.
- Más adelante, tres lecciones del sistema de Alba usan esto a fondo: **«Entrenamiento y experimentos»** (el DataLoader, autocast y las semillas), **«Export, engine y paridad»** (exportar en eval y correr la paridad) y **«Código de serving»** (cargar el state_dict, apagar autograd y hacer el warmup).

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
pytorch device nn-module state-dict autograd no-grad dataloader sincronizacion-cuda caching-allocator torch-compile torchscript torch-export autocast determinismo torchvision warmup-inferencia
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Por qué se guarda el state_dict y no el objeto del modelo?
Porque el state_dict son solo nombres y tensores: se carga con `weights_only=True` o se guarda en safetensors, sin ejecutar código. El objeto entero necesita el código exacto de su clase y un pickle completo, que puede ejecutar cualquier cosa.
? ¿Qué hace `no_grad` y qué hace `eval()`? ¿Por qué se necesitan los dos?
`no_grad` (o `inference_mode`) apaga las notas de autograd: ahorra memoria y tiempo. `eval()` cambia cómo se portan la BatchNorm y el Dropout: cambia las respuestas. Uno no hace lo del otro.
? Mides `modelo(x)` en la GPU con `time.time()` y te sale 1 ms. ¿Qué mediste?
Lo que tardó la CPU en dejar los kernels en la fila de la GPU. Para medir el cálculo hay que llamar a `torch.cuda.synchronize()` antes de parar el reloj.
? nvidia-smi dice que la GPU está casi llena. ¿Significa que tus tensores la llenan?
No necesariamente. El caching allocator se queda con la memoria que ya usó para reusarla, y nvidia-smi la cuenta junto con el contexto de CUDA. Lo que ocupan tus tensores es `memory_allocated`.
? ¿Por qué la primera request de un modelo con torch.compile tarda tanto, y qué se hace?
Porque torch.compile compila en la primera llamada, y otra vez con cada forma nueva: ≈ 17 s la primera en la medición del equipo de Alba. Se hace un warmup con todas las formas antes de declarar el pod listo.
? ¿En qué se diferencian el warmup de inferencia y el warmup del entrenamiento?
El de inferencia corre requests falsas al arrancar el servidor, para pagar la preparación antes del tráfico. El de entrenamiento sube poco a poco el learning rate en los primeros pasos.
:::
