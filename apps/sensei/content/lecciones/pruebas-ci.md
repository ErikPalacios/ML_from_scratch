---
titulo: Pruebas y CI/CD
en: Testing and CI/CD
subtitulo: Cómo se sabe, sin que nadie lo pruebe a mano, que un cambio de una línea no rompió el código, los datos ni el modelo, y cómo ese cambio llega solo, en minutos, del commit al clúster.
pregunta: Alguien cambia una línea del preprocesamiento del gateway de Alba. ¿Cómo se sabe, antes de que llegue a producción, que no rompió nada, y cómo llega ese cambio solo hasta el clúster?
requisitos: python-ecosistema, git
---

:::idea
Una prueba automática es un programa chico que revisa que otro programa haga lo que debe, y que corre solo cada vez que alguien cambia algo. CI corre todas las pruebas en una máquina limpia con cada cambio; CD lleva lo que pasó hasta producción por etapas, con una forma rápida de volver atrás. En ML se prueban tres cosas, no una: el código, los datos y el modelo.
:::

Alba, la empresa que seguimos en todo el curso, es un marketplace: recibe ≈ 2.5 millones de publicaciones al día y le sugiere a quien vende la categoría de cada foto, entre 500 posibles. Esa sugerencia la da una ResNet-50 que corre en Triton (el servidor del modelo), detrás de un gateway: el programa que recibe la foto y la prepara. En total, el gateway responde ≈ 10 millones de fotos al día: unas 3 por publicación, más las que piden otros equipos.

Imagina un martes. Alguien del equipo de Alba abre `preprocess.py`, el archivo que convierte la foto de Ana en el [[tensor]] que recibe la ResNet-50, y cambia una línea. Quería que el código se viera más limpio y quitó dos paréntesis «que sobraban». El programa arranca, no da ningún error y responde con su porcentaje de siempre.

Pero ahora cada número del tensor sale mal, y el modelo acierta mucho menos. Es el [[training-serving-skew|skew]] de la lección de imágenes: nada truena, solo empeora. Si nadie lo nota, a la mañana siguiente ≈ 2.5 millones de publicaciones reciben una categoría peor.

Esta lección es la respuesta a ese martes. Primero, las pruebas: qué es una, de qué tamaños hay y cuáles necesita un sistema con un modelo. Después, las máquinas que las corren solas en cada cambio (CI) y el camino que lleva el cambio aprobado hasta el clúster (CD), con lo que se hace cuando algo sale mal de todos modos. El **clúster** es el grupo de máquinas donde Kubernetes, el [[orquestacion|orquestador]] que usa Alba, corre el gateway y Triton.

## Pruebas unitarias con pytest {Unit tests with pytest}

Una **prueba automática** (*automated test*) es código que llama a tu código con una entrada conocida y revisa que la salida sea la esperada. Si coincide, la prueba **pasa**; si no, **falla** y dice qué esperaba y qué recibió. Lo valioso no es correrla una vez: es que se corre igual mil veces, sin que nadie se acuerde de hacerlo.

Cuando algo que funcionaba deja de funcionar por un cambio, se llama una **regresión** (*regression*). Es justo lo que pasó el martes, y es lo que una prueba vigila: una vez que la escribes, ese error ya no puede volver sin que alguien se entere.

:::ojo Dos «regresiones»
En ML, [[regresion|regresión]] también es la tarea de predecir un número, como un precio. No tiene nada que ver. Aquí, regresión es «retroceder»: algo que ya servía y se rompió.
:::

### Una función, sin red ni disco, en milisegundos

La prueba más chica es la [[prueba-unitaria|prueba unitaria]] (*unit test*): prueba **una** pieza, casi siempre una función, sola. No abre la red, no lee el disco, no habla con una base de datos ni con una GPU. Por eso tarda milisegundos, y por eso, cuando falla, sabes exactamente dónde buscar.

El primer paso del preprocesamiento de Alba lleva el lado corto de la foto a 256 y el largo en la misma proporción: todo se multiplica por la escala \(256 ÷ text{lado corto}\). La foto de Ana, de 3024 × 4032, se multiplica por 256 ÷ 3024 ≈ 0.0847 y queda de 256 × 341 (4032 × 0.0847 ≈ 341). Así se prueba con `unittest`, el módulo de pruebas que trae Python:

```python
import io, unittest

def resize_bien(ancho, alto, corto=256):        # el lado corto a 256, el largo en proporción
    escala = corto / min(ancho, alto)
    return round(ancho * escala), round(alto * escala)

def resize_cambiado(ancho, alto, corto=256):    # alguien cambió una línea: min por max
    escala = corto / max(ancho, alto)
    return round(ancho * escala), round(alto * escala)

class PruebasResize(unittest.TestCase):
    def test_vertical(self):                     # la foto de Ana: 3024 × 4032
        self.assertEqual(resize(3024, 4032), (256, 341))
    def test_acostada(self):
        self.assertEqual(resize(4032, 3024), (341, 256))
    def test_cuadrada(self):
        self.assertEqual(resize(500, 500), (256, 256))

for resize in (resize_bien, resize_cambiado):
    pruebas = unittest.defaultTestLoader.loadTestsFromTestCase(PruebasResize)
    r = unittest.TextTestRunner(stream=io.StringIO()).run(pruebas)
    print(f"{resize.__name__}: {r.testsRun} pruebas, {len(r.failures)} fallan")
    for prueba, detalle in r.failures:
        error = [l for l in detalle.splitlines() if l.startswith("AssertionError")][0]
        print("  ✗", prueba.id().split(".")[-1], "→", error)
```

```salida
resize_bien: 3 pruebas, 0 fallan
resize_cambiado: 3 pruebas, 2 fallan
  ✗ test_acostada → AssertionError: Tuples differ: (256, 192) != (341, 256)
  ✗ test_vertical → AssertionError: Tuples differ: (192, 256) != (256, 341)
```

Cómo se lee el código: cada función que empieza con `test_` es una prueba, y `assertEqual(a, b)` revisa que `a` sea igual a `b`. Las pruebas llaman a `resize`, y el `for` del final hace que ese nombre sea primero la versión buena y luego la cambiada; las líneas de adentro del `for` corren las tres pruebas e imprimen cuántas fallan. No hace falta entender cada una de esas líneas.

Las mismas tres pruebas, contra las dos versiones. Con la buena pasan; con la cambiada fallan dos y dicen el porqué: esperaban 256 × 341 y recibieron 192 × 256. Fíjate en la tercera: con una foto cuadrada, `min` y `max` dan lo mismo, y la prueba pasa con las dos. **Una prueba solo atrapa lo que mira.** Elegir buenos casos es la mitad del trabajo.

### pytest: lo mismo, con menos ceremonia

Casi todos los proyectos de Python usan [[pytest]], una herramienta que no viene con Python (se instala con [[pip]]) y que hace tres cosas por ti:

- **Encuentra las pruebas sola.** Busca archivos que se llamen `test_*.py` (o `*_test.py`) y, adentro, funciones cuyo nombre empiece con `test` (casi siempre `test_algo`), sueltas o dentro de una clase que empiece con `Test`. No hay que registrarlas en ningún lado.
- **Usa el `assert` de Python.** En vez de `self.assertEqual(a, b)`, escribes `assert a == b`. Si falla, pytest abre la expresión y muestra qué valía cada lado.
- **Repite una prueba con varios casos.** `@pytest.mark.parametrize` corre la misma función con cada fila de una tabla, y cada fila cuenta como una prueba aparte.

Este bloque corre en una terminal de Linux con pytest 8.4. Crea los dos archivos con `cat > archivo <<'EOF'` (todo lo que sigue, hasta la línea `EOF`, se escribe en el archivo), corre las pruebas, hace con `sed` el cambio del martes y las vuelve a correr. `sed -i 's|viejo|nuevo|' archivo` es un programa que busca un texto dentro del archivo y lo cambia por otro; el `grep` de en medio muestra cómo quedó la línea. `python -m pytest` corre pytest con ese Python (como `python -m pip` en la lección de Python), y `-q` le pide un resumen corto. pytest imprime cuánto tardó, algo que cambia en cada corrida; el `sed` del final de cada corrida lo borra. (Dos detalles son de Linux con bash: en una Mac, el `sed` de BSD pide `sed -i ''` en vez de `sed -i`, y `${PIPESTATUS[0]}`, el código de salida del primer programa de la tubería, en zsh se escribe `${pipestatus[1]}`.)

```bash
cat > preprocess.py <<'EOF'
MEDIA = (0.485, 0.456, 0.406)   # R, G y B, las de ImageNet
DESV = (0.229, 0.224, 0.225)

def normaliza(valor, canal):
    return (valor / 255 - MEDIA[canal]) / DESV[canal]
EOF
cat > test_preprocess.py <<'EOF'
import pytest
from preprocess import normaliza

@pytest.mark.parametrize("valor, canal, esperado", [
    (236, 0, 1.92), (106, 1, -0.18), (63, 2, -0.71),   # el naranja de los tenis
], ids=["R", "G", "B"])
def test_normaliza(valor, canal, esperado):
    assert normaliza(valor, canal) == pytest.approx(esperado, abs=0.01)

def test_negro_y_blanco():
    assert normaliza(0, 0) < -2 and normaliza(255, 0) > 2
EOF
export COLUMNS=60
python -m pytest -q -p no:cacheprovider | sed -E 's/ in [0-9.]+s//'
sed -i 's|(valor / 255 - MEDIA\[canal\]) / DESV\[canal\]|valor / 255 - MEDIA[canal] / DESV[canal]|' preprocess.py
grep "return" preprocess.py
python -m pytest -q -p no:cacheprovider --tb=line -rN | sed -E 's/ in [0-9.]+s//'
echo "código de salida: ${PIPESTATUS[0]}"
```

```salida
....                                                 [100%]
4 passed
    return valor / 255 - MEDIA[canal] / DESV[canal]
FFFF                                                 [100%]
========================= FAILURES =========================
/home/ana/trabajo/test_preprocess.py:8: assert -1.192413734052573 == 1.92 ± 0.01
/home/ana/trabajo/test_preprocess.py:8: assert -1.6200280112044816 == -0.18 ± 0.01
/home/ana/trabajo/test_preprocess.py:8: assert -1.5573856209150327 == -0.71 ± 0.01
/home/ana/trabajo/test_preprocess.py:11: assert (-2.1179039301310043 < -2 and -1.1179039301310043 > 2)
4 failed
código de salida: 1
```

Así se lee:

- **Cada punto es una prueba que pasó; cada F, una que falló.** La primera corrida da 4 puntos: las tres filas de la tabla y la del negro y el blanco.
- **Sin paréntesis, cambia el orden de las cuentas.** La normalización correcta es \(z = (v/255 − μ)/σ\): \(v\) es el valor del píxel, de 0 a 255; \(μ\) y \(σ\), la media y la desviación de ese canal (las `MEDIA` y `DESV` de ImageNet); y \(z\), el número que recibe el modelo. Para el rojo del naranja, \(z\) = (236 ÷ 255 − 0.485) ÷ 0.229 ≈ 1.92. Python divide antes de restar, así que la línea nueva calcula \(v/255 − μ/σ\) = 236 ÷ 255 − (0.485 ÷ 0.229) ≈ −1.19. Las cuatro pruebas fallan y cada una dice qué recibió.
- **El código de salida es 1.** pytest sale con 0 si todo pasó y con 1 si algo falló (y con 5 si no encontró ninguna prueba, para que un CI mal configurado no salga en verde sin probar nada). Es el [[codigo-salida|código de salida]] de la lección de programas: con ese número, una máquina decide sola si el cambio sigue adelante.

`pytest.approx(esperado, abs=0.01)` acepta una diferencia de hasta 0.01: los números con punto decimal se comparan con tolerancia, nunca con `==`, como viste en la lección de números. En la segunda corrida, `--tb=line` resume cada falla en una sola línea y `-rN` quita el resumen del final. `-p no:cacheprovider` solo evita que pytest guarde una carpeta de caché, y `COLUMNS=60` hace más angosta la salida.

:::nota Las tres partes de una buena prueba
*Prepara* los datos, *actúa* (llama a la función) y *revisa* con un `assert`. Si una prueba necesita diez líneas de preparación, la función probablemente hace demasiadas cosas.
:::

:::profundo Escribir la prueba primero
Hay equipos que escriben la prueba **antes** que el código. Se llama *test-driven development* (TDD), y la popularizó Kent Beck a principios de los 2000. El ciclo tiene tres pasos: escribes una prueba que falla porque la función todavía no existe (rojo); escribes lo mínimo para que pase (verde); y limpias el código sin cambiar lo que hace, con la prueba cuidándote (*refactor*). Obliga a pensar qué debe hacer la función antes de cómo. No hace falta seguirlo siempre, pero con un error hay un caso donde casi todos lo hacen: primero la prueba que lo reproduce, luego el arreglo.
:::

## Fixtures y mocks: preparar el escenario y fingir lo que falta {Fixtures and mocks}

Una prueba unitaria pura es fácil cuando la función solo hace cuentas. Pero el gateway de Alba lee fotos, habla con Triton por HTTP y escribe logs. Para probarlo sin una GPU y sin red hacen falta dos herramientas: una que prepara lo que la prueba necesita y otra que finge lo que no está.

### Fixture: lo que la prueba necesita, listo y limpio

Un [[fixture]] es una función que prepara algo para una prueba (un archivo, una carpeta, un modelo de juguete, una conexión) y lo limpia al terminar. En pytest se marca con `@pytest.fixture`, y una prueba lo pide poniendo su nombre como argumento. La preparación va antes del `yield` y la limpieza, después; la limpieza corre aunque la prueba falle.

pytest trae fixtures hechos. El más usado es `tmp_path`: una carpeta nueva y vacía para cada prueba, que nadie más toca. Así ninguna prueba ve los archivos que dejó otra.

Cada fixture tiene un **alcance** (*scope*): cuánto vive. Por omisión es `function`, uno nuevo para cada prueba. Con `module` se arma una vez por archivo, y con `session`, una vez por corrida completa. Algo caro de preparar, como cargar un modelo, conviene que se comparta; algo que las pruebas cambian, como una carpeta, conviene que sea nuevo cada vez. Los fixtures que usan varios archivos se ponen en `conftest.py`, un archivo que pytest lee solo.

```bash
cat > conftest.py <<'EOF'
import pytest

@pytest.fixture(scope="module")
def modelo():
    print("\n[carga el modelo de juguete: una vez por archivo]")
    yield {"tenis": 0.91, "botas": 0.06}
    print("\n[lo descarga al final]")

@pytest.fixture
def carpeta(tmp_path):
    (tmp_path / "foto.jpg").write_bytes(b"\xff\xd8 no es un JPEG de verdad")
    yield tmp_path
EOF
cat > test_fixtures.py <<'EOF'
def test_top1(modelo):
    assert max(modelo, key=modelo.get) == "tenis"

def test_foto_existe(modelo, carpeta):
    assert (carpeta / "foto.jpg").stat().st_size == 26

def test_carpeta_nueva(carpeta):
    assert len(list(carpeta.iterdir())) == 1
EOF
COLUMNS=60 python -m pytest -q -s -p no:cacheprovider | sed -E 's/ in [0-9.]+s//'
```

```salida

[carga el modelo de juguete: una vez por archivo]
...
[lo descarga al final]

3 passed
```

Dos pruebas piden el modelo y se carga una sola vez. La tercera encuentra su carpeta con un solo archivo: la de la prueba anterior no existe para ella. (`-s` deja ver lo que imprimen los fixtures; sin él, pytest lo esconde.)

### Mock: un doble que finge lo que no está

Un [[mock]] es un objeto falso que toma el lugar de algo lento, caro o externo (una GPU, un servicio, una API de pago) y responde lo que le digas. Además anota cómo lo llamaron, para que la prueba lo revise. Al grupo completo de impostores se le dice **dobles de prueba** (*test doubles*), como los dobles de las películas.

Python trae `unittest.mock`. Con `Mock()` haces un doble; con `return_value` le dices qué responder; con `side_effect`, que lance un error; y con `assert_called_once_with`, revisas que lo hayan llamado justo así:

```python
from unittest import mock

class ClienteTriton:                             # el cliente de verdad (aquí, solo su forma)
    def infer(self, tensor, timeout):
        raise RuntimeError("necesita un Triton corriendo")

def clasificar(tensor, cliente):                 # un pedazo del gateway
    try:
        logits = cliente.infer(tensor, timeout=0.15)
    except TimeoutError:
        return 504, None
    return 200, max(range(len(logits)), key=logits.__getitem__)  # la posición del logit más alto

falso = mock.Mock()                              # un doble: responde lo que le digas
falso.infer.return_value = [0.1, 3.2, -1.0]
print("respuesta:", clasificar("tensor", falso))
falso.infer.assert_called_once_with("tensor", timeout=0.15)
print("¿lo llamó una vez, con timeout=0.15? sí")

falso.infer.side_effect = TimeoutError           # ahora finge un Triton que no contesta
print("Triton lento:", clasificar("tensor", falso))

flojo = mock.Mock()                              # un Mock acepta cualquier cosa...
print("método que no existe:", type(flojo.infer_rapido()).__name__)
estricto = mock.create_autospec(ClienteTriton, instance=True)
try:
    estricto.infer_rapido()                      # ...uno con la forma del real, no
except AttributeError as e:
    print("con autospec:", e)
try:
    estricto.infer("tensor")                     # y revisa los argumentos
except TypeError as e:
    print("con autospec:", e)
```

```salida
respuesta: (200, 1)
¿lo llamó una vez, con timeout=0.15? sí
Triton lento: (504, None)
método que no existe: Mock
con autospec: Mock object has no attribute 'infer_rapido'
con autospec: missing a required argument: 'timeout'
```

Con el doble, la prueba revisa dos caminos que con un Triton real serían difíciles de provocar: la respuesta normal y el [[timeout]] que se convierte en un 504, el [[codigo-estado|código HTTP]] de «el servidor de atrás no contestó a tiempo». El de Alba espera a Triton a lo mucho 0.15 s, el `INFER_TIMEOUT_S` de su configuración.

:::profundo Cuando el código crea su propio cliente: mock.patch
Aquí el doble entra como argumento de `clasificar`. Cuando el código crea su cliente por dentro, se usa `mock.patch`, que cambia un nombre por un doble solo mientras dura la prueba y lo regresa al terminar. Tiene una trampa famosa: se cambia el nombre **donde se busca**, no donde se definió. Si `gateway/app.py` hace `from triton import ClienteTriton`, ese `import` copia el nombre `ClienteTriton` dentro de `app.py`. Hay que parchar `gateway.app.ClienteTriton`; parchar `triton.ClienteTriton` cambia el original, no la copia que ya tiene `app.py`, y la prueba sigue usando el real.
:::

### El riesgo: un doble que no se parece al real

Las últimas líneas muestran el peligro. Un `Mock()` simple acepta **cualquier** método, hasta uno que no existe, y devuelve otro Mock. Si alguien escribe mal el nombre del método o el cliente real cambia, la prueba sigue pasando y el error sale en producción.

`create_autospec` arma el doble con la forma del objeto real: rechaza los métodos que no existen y revisa los argumentos. Aun así, solo copia la forma. No sabe cuánto tarda el Triton de verdad, que se puede quedar sin memoria o que rechaza un tensor con otro [[dtype]]. Por eso el Triton falso de Alba respeta el contrato del cliente real y revisa el nombre, el dtype y el [[shape]] de lo que recibe. Y por eso los mocks no bastan: hace falta, más arriba, al menos una prueba contra la pieza de verdad.

## Integración, end-to-end y la pirámide {Integration, end-to-end and the pyramid}

Que cada pieza funcione sola no quiere decir que funcionen juntas. Las pruebas se clasifican por cuánto del sistema prenden a la vez.

### Integración: varias piezas juntas

Una [[prueba-integracion|prueba de integración]] (*integration test*) prueba varias piezas de verdad conectadas: el gateway completo, con su preprocesamiento, su validación y su cliente de Triton, pero con el Triton falso en vez del real. Ya no es una función: es el programa entero, que recibe una [[request]] HTTP y devuelve una respuesta.

El gateway de Alba tiene 26 pruebas así. Cada una manda una request y revisa la respuesta: 200 con el `top_k` que se pidió (las categorías con más score, tantas como se pidan), 415 si el archivo no es una imagen, 413 si es demasiado grande, 503 si Triton está caído, 504 si tarda demasiado, y que existan el [[health-check|health check]] y las métricas. Corren sin GPU; el equipo de Alba estima que, contando crear el entorno e instalar lo necesario, tardan ≈ 2 minutos.

:::diagrama pruebas-ci-integracion
Toca cada caja para ver qué es de verdad y qué es falso. Usa «Recorrer» para seguir una prueba que pasa, una que atrapa un contrato roto y lo que el falso no puede ver.
:::

### End-to-end: todo el camino, como un usuario

Una [[prueba-e2e|prueba end-to-end]] (*end-to-end test*, de punta a punta, «e2e») prende **todo**: la app, el backend, el gateway, el Triton de verdad con su GPU y su [[engine-tensorrt|engine]] (el modelo ya convertido para correr rápido en esa GPU), y manda una foto como lo haría Ana. Revisa lo que vería ella: que la sugerencia llegue, que sea una de las 500 categorías y que tarde lo que debe.

Es la única que prueba lo que todas las demás suponen: que las piezas de verdad se hablan bien, en las máquinas de verdad. Por eso no se puede quitar. Pero tiene tres problemas:

- **Es lenta.** Hay que levantar todo antes de la primera request: un [[pod]] nuevo de Triton (la unidad con la que Kubernetes corre un contenedor) tarda de ≈ 5 a 13 minutos en estar listo, según estima el equipo de Alba.
- **Es cara.** Necesita una GPU y un ambiente completo prendidos.
- **Cuando falla, no dice dónde.** «No llegó la sugerencia» puede ser la red, el backend, el gateway, el engine o el disco.

### La pirámide

Por eso las pruebas se reparten como una pirámide: muchas unitarias abajo, menos de integración en medio y unas pocas end-to-end arriba. La idea se le atribuye a Mike Cohn, que la popularizó en su libro *Succeeding with Agile*, de 2009; él la dibujó con otros nombres (unidad, servicio e interfaz gráfica), y hoy cada equipo pone los suyos.

:::figura pruebas-ci-piramide
Abajo, muchas pruebas baratas que corren en cada cambio; arriba, pocas caras que corren antes de producción. Al subir, cada prueba cubre más del sistema, pero tarda más, cuesta más y dice menos de dónde está el error.
:::

La razón es aritmética. Si corren una tras otra, el tiempo total es \(T = n × t_{una}\): el número de pruebas \(n\) por lo que tarda cada una, \(t_{una}\). Con tiempos supuestos pero realistas:

:::cuenta Las mismas 300 revisiones, en cada piso de la pirámide
300 pruebas unitarias // \(t_{una}\) ≈ 5 ms = 0.005 s cada una, un supuesto | \(T = n × t_{una}\) = 300 × 0.005 s | 1.5 s
300 pruebas de integración // \(t_{una}\) ≈ 0.5 s cada una: arrancan el gateway con el Triton falso | 300 × 0.5 s | 150 s = 2.5 min
300 pruebas end-to-end // \(t_{una}\) ≈ 30 s cada una: foto real, GPU real | 300 × 30 s | 9,000 s = 2.5 horas
= Con unitarias, la respuesta llega antes de que termines de leer el error anterior. Con end-to-end, una vez por tarde. Nadie espera 2.5 horas por cada cambio de una línea, así que esas pruebas se dejarían de correr.
:::

Una regla que usan muchos equipos lo dice al revés: un error que se escapa hasta una prueba de arriba, y que una de abajo pudo atrapar, es una prueba que falta abajo.

:::profundo Pirámide, trofeo y cono de helado
La pirámide es una guía, no una ley, y tiene críticos. Kent C. Dodds propuso un «trofeo», con el piso más ancho en las de integración: en una aplicación que casi solo conecta piezas, las unitarias prueban poco de lo que de verdad falla. Lo que nadie defiende es la forma contraria, el «cono de helado»: casi todo en pruebas end-to-end y a mano, y casi nada abajo.
:::

:::profundo Pruebas de contrato
Entre la integración y la end-to-end hay un tipo que en ML importa mucho: la **prueba de contrato** (*contract test*). Revisa que una pieza cumpla lo que promete a la otra, sin prender las dos. El gateway de Alba tiene dos contratos. Hacia sus clientes, el [[esquema-api|esquema]] de su respuesta: los mismos campos, los códigos 400, 413 y 415 y el `model_version` en cada respuesta, que revisa su archivo de pruebas `test_api.py`. Hacia Triton, el nombre, el dtype y el shape de la entrada que dice la configuración del modelo. Si alguien cambia un lado sin el otro, la prueba de contrato falla en CI, no en producción. Es la versión automática del [[versionado-api|versionado de una API]]: un cambio que rompe el contrato no puede pasar callado.
:::

## Pruebas de ML: los datos y el modelo {ML tests: data and model}

Todo lo anterior viene del software de siempre. Un sistema con un modelo tiene dos cosas más que se pueden romper sin tocar una línea de código: los datos y el modelo. El trabajo se reparte así: la validación de datos mira los datos; el *gate*, el examen que decide si un modelo nuevo puede salir (lo ves al final de esta sección), mira el modelo; y el [[monitoreo]] mira producción.

### Pruebas de datos

Una [[prueba-datos|prueba de datos]] (*data test*, también *validación de datos*) revisa un lote de datos antes de usarlo, como se revisa una entrega antes de firmarla. Lo que revisa:

- **El [[esquema-datos|esquema]]:** que estén las columnas que deben, con su tipo.
- **Rangos y formatos:** que cada `label_id` (el número de la categoría) esté entre 0 y 499, las 500 categorías, y que la huella de cada foto, su [[hash-criptografico|hash]] SHA-256, tenga sus 64 caracteres hexadecimales (los dígitos 0 a 9 y las letras a a f).
- **Nulos y repetidos:** que no falten etiquetas y que la misma foto no venga dos veces.
- **Volumen y frescura:** que haya entre 0.8 y 1.5 veces las filas del [[snapshot]] anterior, \(0.8 ≤ N_{ahora}/N_{antes} ≤ 1.5\), con \(N_{ahora}\) las filas de este snapshot y \(N_{antes}\) las del anterior; y que el dato más nuevo tenga menos de 48 horas. Esos números son ejemplos: se fijan mirando la historia de tus snapshots.

```python
import re

def revisar(filas, filas_antes):
    """Una prueba de datos: regresa la lista de problemas (vacía si todo está bien)."""
    mal = []
    if not 0.8 <= len(filas) / filas_antes <= 1.5:              # volumen contra el snapshot anterior
        mal.append(f"volumen: {len(filas)} filas, antes {filas_antes}")
    vistos = set()
    for i, f in enumerate(filas):
        if f.get("label_id") is None:
            mal.append(f"fila {i}: label_id vacío")
        elif not 0 <= f["label_id"] <= 499:                       # las 500 categorías de Alba
            mal.append(f"fila {i}: label_id {f['label_id']} fuera de 0–499")
        if not re.fullmatch(r"[0-9a-f]{64}", f.get("sha256") or ""):
            mal.append(f"fila {i}: sha256 no tiene 64 letras hexadecimales")
        elif f["sha256"] in vistos:
            mal.append(f"fila {i}: foto repetida")
        vistos.add(f.get("sha256"))
    return mal

h = lambda n: f"{n:064x}"                         # un hash de mentira, con 64 letras
buenas = [{"sha256": h(n), "label_id": n % 500} for n in range(5)]
print("snapshot bueno:", revisar(buenas, filas_antes=5) or "sin problemas")

rotas = buenas + [{"sha256": h(3), "label_id": 41},           # la misma foto otra vez
                  {"sha256": h(9), "label_id": 500},          # una categoría que no existe
                  {"sha256": "abc", "label_id": None}]        # hash cortado y sin etiqueta
for problema in revisar(rotas, filas_antes=5):
    print("  ✗", problema)
```

```salida
snapshot bueno: sin problemas
  ✗ volumen: 8 filas, antes 5
  ✗ fila 5: foto repetida
  ✗ fila 6: label_id 500 fuera de 0–499
  ✗ fila 7: label_id vacío
  ✗ fila 7: sha256 no tiene 64 letras hexadecimales
```

La función junta **todos** los problemas en vez de parar en el primero, para que quien la lea los arregle de una vez. En la práctica casi nunca se escribe a mano: herramientas como Great Expectations o Pandera dejan escribir esas reglas en pocas líneas y producen un reporte.

Cada regla se decide entre dos acciones. **Bloquea** lo que invalida el resultado sin discusión (una etiqueta fuera de rango). **Avisa** lo que merece que alguien lo mire pero puede ser real (un 30 % más de fotos en el Buen Fin). Conviene que una regla nueva empiece como aviso y pase a bloqueo cuando se vea que casi no da falsas alarmas: un pipeline que bloquea por ruido cada semana termina con alguien que desactiva la validación.

### Pruebas del modelo

Al modelo no se le puede pedir que acierte cada foto: ningún modelo lo hace. Se le prueba de otras tres maneras, y las tres ya las conoces:

1. **Que el preprocesamiento no cambió.** Es la [[prueba-paridad|prueba de paridad]] de la lección de imágenes: 20 fotos de referencia pasan por `preprocess.py` en cada cambio, y su tensor se compara número por número con uno guardado en el repositorio. Con el mismo código y las mismas versiones, la diferencia debe ser exactamente 0. **Esta es la prueba que atrapa el martes**: con los paréntesis quitados, el canal rojo del naranja da −1.19 en vez de 1.92, una diferencia de ≈ 3.1.
2. **Que el modelo que se sirve es el que se evaluó.** La otra paridad: el [[engine-tensorrt|engine de TensorRT]] en FP16 (el modelo convertido para la T4) contra el modelo de PyTorch en FP32, con ≈ 10,000 fotos del [[golden-set|golden set]]; tienen que coincidir en el top-1, la categoría con más score, al menos en 99.5 % de las fotos.
3. **Que el modelo nuevo no salió peor.** El examen completo, en el golden set, por categoría y por [[slice]], contra el modelo que está en producción.

El tercero tiene nombre: es el [[quality-gate|gate de calidad]] (*quality gate*), una lista de umbrales escrita antes de ver los resultados que decide si un modelo puede reemplazar al actual. Si lo aprueba, el modelo todavía no entra al registro: se convierte, se prueba que responde igual y solo entonces se registra como candidato (*challenger*), con su reporte, en el [[registro-modelos|registro de modelos]] (*model registry*). Los dos tienen su propia lección, «Gate de evaluación y registry»; aquí basta saber que son pruebas como las otras: si fallan, el camino se detiene.

## Pruebas que mienten: flaky y cobertura {Tests that lie: flaky tests and coverage} [extra]

Una prueba sirve si su respuesta es confiable: que pase quiera decir «está bien» y que falle quiera decir «algo se rompió». Hay dos formas comunes de que eso deje de ser cierto.

### Pruebas flaky: pasan o fallan sin que nada cambie

Una [[prueba-flaky|prueba flaky]] (*flaky test*, de *flaky*, «poco confiable») a veces pasa y a veces falla con exactamente el mismo código. Sus causas típicas:

- **Tiempos:** «la respuesta llega en menos de 150 ms» pasa en tu laptop y falla en una máquina de CI cargada.
- **Orden:** dos pruebas comparten algo (una variable global, un archivo, una caché) y el resultado depende de cuál corre primero.
- **La red o un servicio de afuera:** una descarga que a veces tarda o un servicio que a veces no contesta.
- **El azar:** números al azar sin una [[semilla]] fija, o el orden de las sumas en una GPU, que puede cambiar los últimos decimales.

La de orden es la más traicionera, porque se ve estable hasta que alguien corre las pruebas en paralelo o en otro orden:

```python
import io, unittest

CACHE = {}                                   # estado compartido: el origen del problema

class Pruebas(unittest.TestCase):
    def test_guarda_en_cache(self):
        CACHE["9f2c41d0"] = "tenis"
        self.assertEqual(len(CACHE), 1)
    def test_cache_empieza_vacia(self):
        self.assertEqual(len(CACHE), 0)

for orden in (["test_cache_empieza_vacia", "test_guarda_en_cache"],
              ["test_guarda_en_cache", "test_cache_empieza_vacia"]):
    CACHE.clear()
    suite = unittest.TestSuite(Pruebas(nombre) for nombre in orden)
    r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
    print(" → ".join(n[5:] for n in orden), ":", "pasan" if r.wasSuccessful() else f"{len(r.failures)} falla")
```

```salida
cache_empieza_vacia → guarda_en_cache : pasan
guarda_en_cache → cache_empieza_vacia : 1 falla
```

¿Por qué importa tanto una prueba que falla de vez en cuando? Porque son muchas, y la falsa alarma de una sola tumba la corrida completa. Si cada prueba pasa con probabilidad 0.999 y una no depende de otra, la probabilidad de que pasen **todas** es multiplicar 0.999 por sí mismo una vez por prueba, como en la lección de probabilidad: con 300 pruebas, 0.999³⁰⁰. Con letras:

:::formula Falsas alarmas de un CI con pruebas flaky
P_{verde} = (1 − f^k)^n
P_{rojo} = 1 − P_{verde}
A = c × P_{rojo}
- n: cuántas pruebas hay en el repositorio
- f: la probabilidad de que una prueba falle sin razón en un intento: 0.001 si falla 1 vez de cada 1,000
- k: los intentos que tiene cada prueba: 1 sin reintentos, 2 con un reintento. Para tumbar la corrida tiene que fallar en todos, y eso pasa con probabilidad \(f^k\)
- P_{verde}: la probabilidad de que la corrida salga en verde: que pasen las \(n\)
- P_{rojo}: la probabilidad de que salga en rojo sin ningún error de verdad
- c: las corridas del CI al día
- A: las falsas alarmas al día
:::

:::cuenta Un CI con pruebas un poquito flaky
Pruebas en el repositorio, \(n\) // un supuesto | — | 300
Falla sin razón de cada una, \(f\) // 1 de cada 1,000 corridas | — | 0.1 % = 0.001
Intentos por prueba, \(k\) // sin reintentos | — | 1
Probabilidad de que las 300 pasen, \(P_{verde}\) | \((1 − f^k)^n\) = 0.999³⁰⁰ | ≈ 74.1 %
Corridas en rojo sin ningún error de verdad, \(P_{rojo}\) | \(1 − P_{verde}\) = 1 − 0.741 | ≈ 25.9 %
Corridas del CI al día, \(c\) // un supuesto | — | 20
Falsas alarmas al día, \(A\) | \(c × P_{rojo}\) = 20 × 0.259 | ≈ 5
= Pruebas que casi nunca fallan, juntas, dan una falsa alarma en una de cada cuatro corridas. El equipo aprende que «rojo» no quiere decir nada.
:::

:::calculadora pruebas-ci-flaky
Prueba con \(n\) = 26, las pruebas del gateway: aun con \(f\) = 1 % de falla cada una, ¿qué tan seguido sale rojo? Después pon un reintento (\(k\) = 2) y mira cuánto baja.
:::

Dicho en una frase: una prueba flaky enseña al equipo a ignorar el CI. Qué se hace con ella:

1. **Se aparta** (*quarantine*, cuarentena): sale de las pruebas que bloquean, con un aviso y un responsable, para que no tape a las demás.
2. **Se arregla la causa:** una semilla fija, una carpeta propia con `tmp_path`, un doble en vez de la red, un tiempo medido con margen.
3. **El reintento automático, con cuidado.** Correrla otra vez si falla baja mucho las falsas alarmas, pero también esconde fallas reales que pasan a veces, como una *carrera* (*race condition*) entre dos [[hilo|hilos]]: un error que sale solo cuando uno de los dos llega primero. Si se reintenta, se cuenta cuántas veces hizo falta.

En las pruebas del modelo hay una versión propia de esto. Una prueba que exige que **cada** foto conserve su categoría después de recomprimir el JPEG falla todas las noches: siempre hay fotos en la frontera entre dos categorías. Las pruebas del modelo son estadísticas: un umbral sobre una muestra fija y con semillas fijas.

:::profundo Pruebas de comportamiento del modelo
Una idea útil viene de CheckList (Ribeiro y otros, 2020), escrita para texto y útil para imágenes, con tres tipos. **Funcionalidad mínima:** casos tan claros que cualquier modelo aceptable los resuelve, como una foto de estudio de una bicicleta que debe tener «bicicletas» en su top-5; estos sí van uno por uno, porque se eligen a mano. **Invariancia:** un cambio que no altera la respuesta correcta no debe alterar la predicción, como recomprimir el JPEG o voltear la foto como en un espejo; en Alba se pide que al menos 97 % de ≈ 2,000 fotos del golden set conserven su top-1. **Expectativa direccional:** un cambio debe mover el score hacia un lado conocido, como menos confianza con más desenfoque.
:::

### Cobertura: qué líneas corrieron

La [[cobertura]] (*coverage*, *code coverage*) mide qué parte del código corrió mientras corrían las pruebas. La más común cuenta líneas: cobertura = líneas que corrieron ÷ líneas en total. Si las pruebas pasaron por 45 de 50 líneas, la cobertura es 45 ÷ 50 = 0.9, el 90 %. La versión más exigente cuenta **ramas**: en cada `if`, que se haya probado el camino del sí y el del no. En Python se mide con la herramienta `coverage.py` (con `coverage run --branch` para contar ramas), o con `pytest --cov` si se instala el complemento `pytest-cov` (y `--cov-branch` para las ramas).

Sirve para encontrar lo que **ninguna** prueba toca: un `except` que nunca se probó o una rama para fotos chiquitas. Lo que no dice es si lo que corrió está bien. Este código mide la cobertura a mano con `sys.settrace`, una función de Python que avisa cada vez que se ejecuta una línea:

```python
import sys

def resize_cambiado(ancho, alto, corto=256):
    if min(ancho, alto) < 32:
        raise ValueError("foto demasiado chica")
    escala = corto / max(ancho, alto)            # el error del martes
    return round(ancho * escala), round(alto * escala)

def lineas_que_corren(prueba):
    vistas = set()
    def mirar(frame, evento, arg):
        if frame.f_code is resize_cambiado.__code__ and evento == "line":
            vistas.add(frame.f_lineno)
        return mirar
    sys.settrace(mirar); prueba(); sys.settrace(None)
    return vistas

total = 4                                        # las líneas de adentro de la función
cuadrada = lambda: resize_cambiado(500, 500) == (256, 256)
print("¿pasa la prueba de la foto cuadrada?", cuadrada())
print(f"cobertura: {len(lineas_que_corren(cuadrada))} de {total} líneas")

def chiquita():
    try: resize_cambiado(10, 10)
    except ValueError: pass
cubiertas = lineas_que_corren(cuadrada) | lineas_que_corren(chiquita)
print(f"con la foto chiquita: {len(cubiertas)} de {total} líneas, y el error sigue ahí")
```

```salida
¿pasa la prueba de la foto cuadrada? True
cobertura: 3 de 4 líneas
con la foto chiquita: 4 de 4 líneas, y el error sigue ahí
```

:::figura pruebas-ci-cobertura
Las dos pruebas juntas pasan por las cuatro líneas: 100 % de cobertura. La línea con el error corrió, y nadie revisó su resultado con una foto que no fuera cuadrada.
:::

Con 100 % de cobertura, el `max` del martes sigue ahí. **La cobertura dice qué no se probó; nunca dice que lo probado esté bien.** Por eso sirve como alarma («esta parte no tiene ni una prueba») y no como meta: un equipo al que le exigen 100 % termina escribiendo pruebas que corren líneas sin revisar nada.

## CI: cada cambio, probado en una máquina limpia {CI: every change tested on a clean machine}

Tener pruebas no sirve si alguien tiene que acordarse de correrlas. La [[ci|integración continua]] (*continuous integration*, CI) es la práctica de juntar (con un [[merge]]) los cambios de todos al código principal seguido, varias veces al día, y de correr **todas** las pruebas automáticamente con cada uno, en una máquina limpia.

En la lección de Git viste el [[commit]], la [[rama]] y el [[pull-request|pull request]] (PR): la propuesta de juntar los cambios de una rama con la principal, que otra persona revisa. CI se cuelga de ahí:

:::pasos
1. Subes tu rama
Con `git push` mandas tu rama, con el cambio del martes, al repositorio compartido (el [[remoto-git|remoto]], en GitHub) y abres el PR.
2. Una máquina limpia arranca sola
Un servicio de CI ve el cambio y prende una máquina nueva. Baja el código, instala las [[dependencia|dependencias]] exactas del [[lock-file|lock file]] y corre los pasos que el repositorio le dice.
3. Corre todo, en orden
Primero lo más rápido, el linter; luego las pruebas unitarias y de integración, la paridad del preprocesamiento y lo demás que diga el repositorio.
4. Pone la palomita o la cruz en el PR
Si todos los pasos salen con código 0, el PR queda en verde; si alguno sale con otro número, en rojo, con el registro de qué falló. La regla del equipo: un PR en rojo no se junta.
:::

El martes termina aquí: las pruebas salen en rojo en el PR, a los pocos minutos, y el cambio nunca llega a la rama principal.

### Por qué una máquina limpia

«En mi máquina sí funciona» es la frase que CI existe para borrar. Tu laptop tiene paquetes que instalaste hace meses, archivos que no están en el repositorio y [[variable-entorno|variables de entorno]] que pusiste un día y olvidaste. La máquina de CI arranca vacía cada vez, así que lo que pasa ahí es lo que de verdad está en el repositorio. La máquina que corre el trabajo se llama [[runner-ci|runner]]: puede ser una que renta el servicio o una propia, por ejemplo con GPU.

El servicio de CI más usado con GitHub es [[github-actions|GitHub Actions]]: los pasos se escriben en un archivo [[yaml|YAML]] dentro del mismo repositorio. La sección extra que sigue lo abre línea por línea.

### Linter, formateador y tipos: lo primero que corre

Antes de las pruebas, CI corre revisiones que ni siquiera ejecutan el código:

- Un [[linter]] lee el código y marca errores probables y malas prácticas: una variable que no existe, un `import` que no se usa, una comparación con `== None`. En Python, hoy el más popular es **ruff**, de la empresa Astral. Está escrito en Rust, un lenguaje que se [[compilar|compila]] y corre mucho más rápido que Python. Revisa un repositorio entero en una fracción de segundo y reemplaza a varias herramientas de antes, como flake8 e isort (con sus reglas de `import`, también los ordena).
- Un **formateador** (*formatter*) reescribe el código con un estilo fijo: espacios, comillas, largo de línea. **black** fue el estándar; `ruff format` hace casi lo mismo. Así nadie discute de estilo en una revisión, y un PR muestra solo lo que cambió de verdad.
- Un **revisor de tipos** como **mypy** lee las [[type-hints|anotaciones de tipo]] de la lección de Python y avisa, sin correr nada, si una función que espera un `float` recibe un texto.

Tardan segundos y atrapan muchos errores tontos antes de gastar minutos en las pruebas. Por eso van primero. Ojo: ninguno habría atrapado el martes, porque `valor / 255 - MEDIA[canal] / DESV[canal]` es código perfectamente válido. Lo atrapan las pruebas.

### Lo que va en CI y lo que no

CI tiene que ser rápido: si tarda una hora, la gente junta cambios grandes para esperar menos, y cada cambio grande es más difícil de revisar y de revertir. En ML hay un límite claro: entrenar el modelo completo en cada PR suena riguroso, pero son horas de GPU por cada cambio de una línea, y el resultado varía con la semilla. El CI de código corre en minutos (unitarias, una prueba chica del entrenamiento, que corre unos pasos con un puñado de fotos para ver que el código no truena, y el contrato del gateway). Entrenar es trabajo de otro pipeline, con su propio disparador.

## GitHub Actions por dentro {GitHub Actions, inside} [extra]

[[github-actions|GitHub Actions]] es el servicio de CI de GitHub. Cada **workflow** (flujo de trabajo) es un archivo YAML en la carpeta `.github/workflows/` del repositorio. Como vive junto al código, cambia en un PR, se revisa como el código y su historia queda en Git.

Sus partes:

- **`on`**: qué lo dispara. Un `push` a una rama, un `pull_request`, un horario o un botón.
- **`jobs`**: los trabajos. Cada uno corre en su propio [[runner-ci|runner]] limpio y, si no dices otra cosa, al mismo tiempo que los demás. `needs` hace que uno espere a otros.
- **`runs-on`**: en qué tipo de runner corre el job.
- **`steps`**: los pasos de un job, en orden. Un paso es `run` (un [[comando]] de la terminal) o `uses` (una acción ya hecha, como bajar el código o instalar Python).

Este sería el CI del gateway de Alba. Es una ilustración: solo corre dentro de GitHub, y las versiones de las acciones (`@v7`) son las más nuevas en noviembre de 2026. Cada `#` explica su línea.

```yaml
# .github/workflows/gateway.yml
name: CI del gateway
on:
  pull_request:                       # cada PR que toque el gateway
    paths: ["gateway/**"]
  push:
    branches: [main]                  # y cada cambio que ya se juntó a main
    paths: ["gateway/**"]

jobs:
  lint:                               # segundos: lo primero que puede fallar
    runs-on: ubuntu-latest            # un runner de GitHub, limpio, con Linux
    steps:
      - uses: actions/checkout@v7     # baja el código del commit
      - uses: actions/setup-python@v7
        with:
          python-version: "3.13"
          cache: pip
          cache-dependency-path: gateway/requirements-dev.txt
      - run: pip install -r gateway/requirements-dev.txt   # versiones fijas:
                                      # ruff, mypy, pytest y lo que importa el gateway
      - run: ruff check gateway/      # el linter
      - run: ruff format --check gateway/    # ¿está formateado? (no reescribe)
      - run: mypy gateway/app         # los tipos (necesita lo que el código importa)

  pruebas:                            # corre al mismo tiempo que lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.13"
          cache: pip
          cache-dependency-path: gateway/requirements-dev.txt
      - run: pip install -r gateway/requirements-dev.txt
      - run: pytest gateway/tests -q  # las unitarias, las 26 con el Triton falso
                                      # y los tensores de las 20 fotos de referencia

  imagen:                             # solo si los dos anteriores salieron con 0
    needs: [lint, pruebas]
    if: github.ref == 'refs/heads/main'   # y solo en main, no en los PR
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: docker build -t classifier-gateway:${{ github.sha }} gateway/   # arma la imagen
      - run: ./ci/humo.sh classifier-gateway:${{ github.sha }}   # un script: prueba de humo contra la imagen
      # aquí falta subir la imagen a un registro: sin eso,
      # el job de paridad no la encuentra

  paridad:                            # en una máquina propia, con la GPU de producción
    needs: imagen
    runs-on: [self-hosted, gpu-t4]
    steps:
      - uses: actions/checkout@v7
      - run: ./ci/paridad_e2e.sh classifier-gateway:${{ github.sha }}
```

Tres cosas para fijarse. `lint` y `pruebas` corren a la vez, cada uno en su máquina, y `imagen` espera a los dos. `${{ github.sha }}` es el identificador del commit, así que la imagen queda nombrada por el código exacto que la produjo. Y el último job no corre en una máquina de GitHub. Por eso la imagen tiene que viajar por un registro: el runner de `imagen` se borra al terminar, y la imagen con él. Ese paso, subirla, falta a propósito; lo cuenta la lección «CI/CD y registro de imágenes». (`cache-dependency-path` le dice a `setup-python` de qué archivo sacar la llave de la caché: si no se lo dices, busca un `requirements.txt` o un `pyproject.toml`, y aquí el archivo se llama de otra forma.)

### Lo que queda de cada corrida

Cuando un job termina, su máquina se borra. Lo que queda es lo que guardaste a propósito:

- **El registro** (*log*) de cada paso, con lo que imprimió: ahí está el `FFFF` de pytest y la línea que falló. El PR enlaza a él.
- **Los artefactos de la corrida.** La acción `actions/upload-artifact` guarda archivos que se pueden bajar después: el reporte de las pruebas, el de cobertura, un wheel. GitHub los borra solos después de un tiempo: por omisión, 90 días, y cada paso puede pedir menos con `retention-days`.
- **La caché.** `cache: pip` guarda los paquetes ya bajados para la siguiente corrida, con una llave que sale del archivo de dependencias: si las dependencias no cambiaron, la instalación tarda segundos.

Dos detalles más que ahorran tiempo. Con `concurrency` y `cancel-in-progress: true`, un push nuevo al mismo PR cancela la corrida vieja, que ya no le importa a nadie (sin esa segunda línea, la nueva espera a que termine la vieja; y si ya había otra esperando, esa se cancela). Y con `timeout-minutes`, un job que se atora muere a los minutos que digas en lugar de esperar horas: por omisión son 360 minutos, 6 horas, que en los runners de GitHub es además el máximo por job.

### El runner: de GitHub o propio

Un [[runner-ci|runner]] es la máquina que corre un job. Los de GitHub (`ubuntu-latest`) nacen limpios para cada job y se borran al terminar; no hay que mantenerlos, pero los estándar no traen GPU ni ven tu red privada. GitHub también renta runners más grandes, incluso uno con una T4, que se pagan por minuto (el de GPU, a US$0.052 el minuto en la lista de precios de GitHub de noviembre de 2026: 0.052 × 60 ≈ US$3.1 la hora, unas 6 veces los US$0.526 la hora de la máquina de la cuenta de abajo) y solo existen en sus planes de pago para organizaciones (Team y Enterprise). Un runner propio (*self-hosted*) es una máquina tuya con un programa de GitHub instalado que pide trabajo; los jobs lo eligen por sus etiquetas, como `[self-hosted, gpu-t4]`. Ese no nace limpio solo: si no se configura para usarse en un único job y apagarse, como el de Alba, cada job hereda lo que dejó el anterior.

Alba usa uno propio por una razón que viste en la lección de números: el engine de TensorRT se construye y se prueba en el mismo tipo de GPU en el que se sirve, una T4. Al job le agrega una guardia: aborta si la GPU del runner no es una T4. Y la máquina se prende solo mientras corre el job. Lo que cuesta al mes es una multiplicación: costo = precio por hora × horas prendida.

:::cuenta El runner con T4: prendido solo cuando trabaja
Precio de una T4 en la nube // una g4dn.xlarge de AWS bajo demanda, en us-east-1, el precio que paga Alba | — | ≈ US$0.526 por hora
Prendida todo el mes // un mes de costos tiene 730 h (30.4 días × 24) | 0.526 × 730 h | ≈ US$384
Prendida solo en los jobs // un supuesto: 10 horas de builds y paridades al mes | 0.526 × 10 h | ≈ US$5.3
Cuántas veces más cuesta prendida todo el mes // el precio por hora se cancela | 730 h ÷ 10 h | 73
= El equipo de Alba estima el runner efímero en menos de US$10 al mes. Pagar 73 veces más por tenerlo esperando no compra nada.
:::

Un runner propio tiene un riesgo: si el código de un PR corre en tu máquina, el de un PR malicioso también. Por eso los runners propios se usan en repositorios privados, o solo para la rama principal. Las credenciales que un job necesita (para subir una imagen, por ejemplo) se guardan como secretos del repositorio, nunca en el YAML; la lección de configuración lo explica.

## CD: del artefacto al clúster {CD: from artifact to cluster}

CI responde «¿este cambio está bien?». Falta la otra mitad: llevarlo a producción sin que nadie copie archivos a mano. Eso es [[cd|CD]], y la sigla quiere decir dos cosas parecidas:

- **Entrega continua** (*continuous delivery*): cada cambio que pasa el CI queda **listo** para producción, probado en una copia del sistema parecida a producción, y desplegarlo es apretar un botón. Una persona decide cuándo.
- **Despliegue continuo** (*continuous deployment*): lo mismo, sin botón. Lo que pasa todas las pruebas llega solo a producción.

La idea de la entrega continua la fijó el libro *Continuous Delivery* de Jez Humble y David Farley, de 2010: el software siempre está en un estado que se puede liberar, y liberarlo es una decisión de negocio, no una hazaña técnica.

:::figura pruebas-ci-entrega
Las dos CD hacen todo igual hasta staging. La diferencia es el último paso: en la entrega continua lo da una persona; en el despliegue continuo, el pipeline.
:::

El despliegue continuo exige más confianza en las pruebas y en el freno de producción. Pero con esos dos, no es más arriesgada: los cambios llegan chicos y de uno en uno, y uno chico es fácil de revisar y de revertir.

### El artefacto: se construye una vez

Un [[artefacto]] (*artifact*) es lo que produce un pipeline y se guarda para usarlo después: un reporte de pruebas, un [[wheel]] de Python, el engine de TensorRT o, sobre todo, la [[imagen-contenedor|imagen del contenedor]] del gateway (el paquete con el programa y todo lo que necesita; cómo se construye lo cuenta la lección «Empaquetado con Docker»). Las imágenes se guardan en un [[registro-imagenes|registro de imágenes]], el tema de la lección «CI/CD y registro de imágenes».

La regla más importante de CD: **el artefacto se construye una sola vez, en CI, y es ese mismo el que pasa por cada etapa.** Reconstruir «lo mismo» para producción produce otra imagen, con otras versiones de algo, y entonces lo que probaste no es lo que corre. Por eso la imagen se nombra con el commit que la produjo y se identifica por su [[digest-imagen|digest]]: un [[hash-criptografico|hash]] de su contenido, que cambia si cambia un solo byte.

### Ambientes: mismas piezas, distinta configuración

Un [[ambiente]] (*environment*) es una copia completa del sistema para un propósito: **dev** (desarrollo, donde se prueba sin miedo), **staging** (el ensayo general, lo más parecido a producción) y **prod** (producción, la que usa Ana). Corren la misma imagen; lo que cambia es la configuración: a qué Triton apuntan, cuántas copias hay, qué datos ven. El staging de Alba tiene una T4 prendida 60 horas por semana: a US$0.526 la hora, 0.526 × 60 h × 52 semanas ÷ 12 meses ≈ US$137 al mes. La lección de configuración explica cómo se le da a cada ambiente lo suyo sin tocar la imagen.

### La prueba de humo: ¿arrancó?

Una [[prueba-humo|prueba de humo]] (*smoke test*) es lo mínimo para saber que algo arrancó y responde. El nombre viene de dos oficios. En la electrónica, prendes el aparato y, si sale humo, ya no hace falta revisar lo demás; en la plomería, se llena la tubería de humo antes que de agua, para ver por dónde se fuga. No mide si el modelo es bueno; mide si está vivo y contesta con sentido. En Alba, después de cada despliegue: el [[health-check|health check]] (`GET /healthz` responde 200) y una request con una foto conocida, que debe regresar una categoría con un score entre 0 y 1 y su `model_version`.

¿Por qué las dos? Porque `/healthz`, como viste en la lección de balanceo, solo dice que el programa responde; no pregunta por el modelo. Un gateway puede contestar 200 en `/healthz` y no poder clasificar nada. El código de abajo arma en tu máquina un gateway de juguete que contesta como el real y le hace la prueba de humo dos veces: con el modelo cargado y sin él. Fíjate en que, sin modelo, el health check pasa, y es la foto la que falla.

```python
import json, threading, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def gateway_falso(modelo_listo):                 # un gateway de juguete, en tu máquina
    class Atiende(BaseHTTPRequestHandler):
        def log_message(self, *args): pass        # sin ruido en la pantalla
        def responder(self, codigo, datos):
            self.send_response(codigo); self.end_headers()
            self.wfile.write(json.dumps(datos).encode())
        def do_GET(self):                         # GET /healthz: solo «estoy vivo»
            self.responder(200, {"vivo": True})
        def do_POST(self):                        # POST /v1/classify
            self.rfile.read(int(self.headers["Content-Length"]))
            if not modelo_listo:                  # vivo, pero sin modelo: no puede clasificar
                return self.responder(503, {"error": "modelo sin cargar"})
            self.responder(200, {"top": [{"categoria": "tenis", "score": 0.91}],
                                 "model_version": "resnet50-2026-10-01"})
    return ThreadingHTTPServer(("127.0.0.1", 0), Atiende)   # puerto 0: el que esté libre

def prueba_de_humo(url):
    vio = []
    try:
        vio.append(f"healthz {urllib.request.urlopen(url + '/healthz', timeout=2).status}")
        r = urllib.request.urlopen(url + "/v1/classify", data=b"\xff\xd8 foto", timeout=2)
        top = json.load(r)["top"][0]
        assert 0 <= top["score"] <= 1, "score fuera de 0–1"
        vio.append(f"pasa: {top['categoria']} ({top['score']})")
    except (urllib.error.URLError, AssertionError) as e:
        vio.append(f"falla: {e}")
    return " · ".join(vio)

for listo in (True, False):
    servidor = gateway_falso(listo)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    print("modelo cargado" if listo else "modelo sin cargar", "→",
          prueba_de_humo(f"http://127.0.0.1:{servidor.server_port}"))
    servidor.shutdown()
```

```salida
modelo cargado → healthz 200 · pasa: tenis (0.91)
modelo sin cargar → healthz 200 · falla: HTTP Error 503: Service Unavailable
```

Las dos veces, `/healthz` respondió 200. Solo la foto descubrió que el segundo no tenía modelo. Todo pasa dentro de tu máquina, por [[localhost]]: nada sale a la red. En el pipeline, una falla de humo detiene el despliegue antes de que la versión nueva atienda a nadie.

### Rollback: volver a la versión anterior

Un [[rollback]] es regresar a la versión que funcionaba. Es el seguro de todo lo anterior, porque ninguna prueba atrapa todo. La regla: **primero revertir, después investigar.** Si las alertas empezaron con el despliegue, se revierte sin esperar a entender por qué; se entiende después, con calma.

Funciona solo si se preparó antes:

- **La versión anterior sigue disponible.** Su imagen sigue en el registro, nombrada por su digest y no por una etiqueta que mañana puede apuntar a otra cosa. Alba deja la anterior viva de 24 a 48 horas después de cada *release* (cada versión que sale a producción).
- **Es rápido.** Alba se pone como meta revertir en ≤ 5 minutos. Si la versión vieja sigue prendida, es mover el tráfico: segundos. Si hay que volver a levantar pods de Triton en nodos con GPU (las máquinas del clúster que tienen una T4), de ≈ 5 a 20 minutos.
- **Se ensayó.** Un rollback que nunca se probó no es un plan; se practica en staging.

En Kubernetes, `kubectl` es el comando de la terminal con el que se le dan órdenes al clúster, y `kubectl rollout undo deployment/gateway` regresa un despliegue a su versión anterior (es una ilustración: necesita un clúster). Para no tener que revertir todo de golpe, las versiones nuevas reciben primero una parte chica del tráfico, el [[canary]], o se preparan completas al lado de la vieja y el tráfico se cambia de una vez, el [[blue-green|blue-green]]. Las dos las cuenta a fondo la lección «Rollout seguro».

:::profundo GitOps: desplegar con un pull request
En la lección de Git viste [[gitops|GitOps]]: el estado que debe tener el clúster vive en un repositorio, y una herramienta como Argo CD o Flux hace que el clúster se parezca a lo que dice ese repositorio. Con GitOps, el último paso de CD no ejecuta comandos contra el clúster: abre un PR que cambia el digest de la imagen en un archivo. Juntarlo es desplegar, y el rollback es revertir ese commit. La ventaja: la historia de Git dice qué versión servía producción en cada momento y quién la pidió. Lo que no hace sola es promover de staging a producción ni el canary: eso lo hace tu pipeline, o herramientas como Argo Rollouts.
:::

### El camino completo de Alba

Así llega el cambio del martes, ya arreglado, del commit al clúster. Los tiempos de lint, paridad, staging y producción son supuestos razonables para un gateway sin GPU; los de pruebas e imagen son estimaciones del equipo de Alba. La regla para sumar: lo que corre a la vez cuenta solo lo que tarda el más lento, \(max(t_{lint}, t_{pruebas})\); lo que corre uno tras otro se suma.

:::cuenta Del commit a producción: el gateway de Alba
Lint, formato y tipos, \(t_{lint}\) // al mismo tiempo que las pruebas | ruff y mypy | ≈ 1 min
Pruebas unitarias y de integración, \(t_{pruebas}\) // las 26 del gateway | pytest | ≈ 2 min
Construir la imagen // de 30 a 60 s desde cero | docker build | ≈ 1 min
Paridad de punta a punta // las 20 fotos por el gateway real; el examen, sin contar prender la T4 | runner con T4 | ≈ 1 min
Desplegar en staging y prueba de humo // ≈ 3 min de pods nuevos + ≈ 30 s de humo | pods nuevos, health check y una foto | ≈ 3.5 min
Desplegar en producción // de pod en pod, sin apagar el servicio | rollout | ≈ 5 min
Total, con lint y pruebas a la vez // \(max(t_{lint}, t_{pruebas})\) + imagen + paridad + staging + producción | max(1, 2) + 1 + 1 + 3.5 + 5 | ≈ 12.5 min
= Unos 12 minutos después del merge, la versión nueva está en el clúster, y nadie copió un archivo. Desde ahí, el canary decide en horas cuándo recibe todo el tráfico. Es la cuenta de un camino con la máquina ya prendida y sin subir la imagen: con el push y los ≈ 4 min de prender la T4 y bajar las imágenes, son ≈ 17.5 min; la lección «CI/CD y registro de imágenes» la rehace completa.
:::

:::diagrama pruebas-ci-pipeline
Recorre el camino de un cambio que pasa, el del martes que se queda en el PR y uno que pasa todo pero falla en producción.
:::

Un despliegue malo se mide en requests dañadas: cuántas llegan a la versión nueva antes de que alguien la quite. Y se compara con el [[error-budget|presupuesto de error]] de la lección de probabilidad: si el [[slo|SLO]] promete que 99.9 % de las requests salen bien, el 0.1 % restante es lo que el mes puede fallar, ni una más. La cuenta tiene tres pasos:

:::formula Lo que cuesta un despliegue malo
t_{mala} = 60 × (t_d + t_r)
D = R × w × t_{mala}
B = (1 − S) × M
G = frac{D}{B}
- t_d: los minutos para **detectar** el problema
- t_r: los minutos para **revertir** (hacer el rollback)
- t_{mala}: los segundos que la versión mala atiende tráfico
- R: las requests por segundo que llegan al servicio
- w: el **peso** de la versión nueva: la parte del tráfico que le llega, como fracción: 1 si va todo, 0.05 en un canary al 5 %
- D: las requests dañadas
- S: el SLO, como fracción: 0.999 para 99.9 %
- M: las requests de todo el mes; para el SLO, un mes de 30 días
- B: el presupuesto de error del mes: cuántas requests pueden fallar
- G: la parte del presupuesto que se **gasta** este despliegue (1 = todo el mes)
:::

Para Alba, el servicio responde ≈ 10 millones de fotos al día, una request por foto. Con su promedio de requests por segundo, 10 minutos para detectar y 5 para revertir:

:::cuenta Lo que cuesta un despliegue malo
Requests por segundo, \(R\) // el promedio de Alba: 10 M al día entre los 86,400 segundos del día | 10,000,000 ÷ 86,400 | ≈ 116
Tiempo con la versión mala, \(t_{mala}\) // \(t_d\) = 10 min para detectar y \(t_r\) = 5 para revertir | \(60 × (t_d + t_r)\) = 60 × (10 + 5) | 900 s
Requests dañadas, con todo el tráfico, \(D\) // \(w\) = 1 | \(R × w × t_{mala}\) = 116 × 1 × 900 | ≈ 104,000
Requests del mes, \(M\) // 10 M al día × 30 días | 10,000,000 × 30 | 300 M
Presupuesto de error del mes, \(B\) // [[slo\|SLO]] \(S\) = 0.999, de la lección de probabilidad | \((1 − S) × M\) = 0.001 × 300 M | 300,000
Parte del presupuesto que se comió, \(G\) | \(D ÷ B\) = 104,000 ÷ 300,000 | ≈ 35 %
Con un canary al 5 % // \(w\) = 0.05 | 116 × 0.05 × 900 ≈ 5,200; 5,200 ÷ 300,000 | ≈ 5,200: ≈ 1.7 %
= Un solo despliegue malo con todo el tráfico se come un tercio del mes. El mismo, en un canary al 5 %, menos del 2 %. Detectar y revertir rápido rinde tanto como probar más.
:::

:::calculadora pruebas-ci-danio
Sube \(R\) a 500 requests por segundo, el pico de diseño de Alba (el tráfico para el que compra sus máquinas): ¿cuánto del presupuesto se va con todo el tráfico? Luego baja los minutos para revertir, \(t_r\), a 1.
:::

## Errores comunes {Common mistakes}

### 1. «Lo probé a mano»

Abrir la app, subir una foto y ver que salió «Tenis» prueba una foto, una vez, en tu máquina. El martes, esa foto habría salido con alguna categoría y nadie habría visto que el tensor estaba mal.

**Cómo evitarlo:** cada error que encuentras se convierte en una prueba automática antes de arreglarlo. Así no regresa.

### 2. Un mock que miente

El Triton falso responde perfecto, las pruebas pasan, y en producción el Triton real rechaza el tensor porque alguien cambió el nombre de la entrada o el dtype.

**Cómo evitarlo:** dobles con la forma del real (`create_autospec`), que revisen el contrato (nombre, dtype, shape), y al menos una prueba de punta a punta o de humo contra la pieza de verdad.

### 3. Convivir con pruebas flaky

«Esa siempre falla, dale reintentar.» Al mes nadie mira el rojo, y un día el rojo era de verdad.

**Cómo evitarlo:** apartar la prueba flaky con un responsable, arreglar su causa (semilla, carpeta propia, tiempos con margen, sin red) y contar los reintentos.

### 4. Perseguir 100 % de cobertura

La meta se cumple con pruebas que corren líneas sin revisar nada. El `max` del martes pasó con 100 %.

**Cómo evitarlo:** usar la cobertura para encontrar código sin pruebas, y juzgar una prueba por si falla cuando el código está mal.

### 5. Construir otra vez para producción

«Staging pasó; ahora construyo la imagen de producción.» Esa imagen es otra: otro momento, otras versiones de lo que no estaba fijo. O peor: se construyó en una laptop con Apple Silicon (los chips de Apple, arm64) y salió para otra [[arquitectura-cpu|arquitectura]] que la de los nodos del clúster (amd64).

**Cómo evitarlo:** construir una vez en CI, para la plataforma de los nodos, y promover ese mismo digest por staging y producción.

### 6. Un rollback que solo existe en papel

La versión anterior ya se borró del registro, nadie sabe el comando, o volver tarda 20 minutos porque hay que levantar nodos con GPU.

**Cómo evitarlo:** dejar viva la versión anterior durante el *bake*, el tiempo de observación después de cada *release* (de 24 a 48 horas en Alba), desplegar por digest y ensayar el rollback en staging.

## En la vida real {In real life} [extra]

### Alba: el cambio del martes, completo

El cambio de una línea llega en un PR. GitHub Actions corre ruff y mypy (pasan: el código es válido) y pytest. Las pruebas de normalización y la de los tensores de las 20 fotos de referencia fallan, el PR queda en rojo y el cambio nunca llega a `main`. Quien lo escribió ve el error en minutos, en su PR, y no en las métricas de aceptación de la semana siguiente.

Lo que sí se junta sigue el camino de la cuenta de arriba: imagen nombrada por el commit, paridad por el gateway real en el runner con T4, staging, humo y producción. Un modelo nuevo pasa además por el gate y por el registro (la lección «Gate de evaluación y registry») y, ya servido, por *shadow* (recibe una copia del tráfico sin responderle a nadie) de 1 a 2 días y por un canary de 5 % → 25 % → 100 %, con rollback automático si los errores 5xx (los códigos del 500 al 599, las fallas del servidor) pasan de 0.5 % o el [[p99]] de 200 ms (la lección «Rollout seguro»).

### Video con varias cámaras: rollback sin balanceador, en cada sitio

En un sistema de video en tiempo real con varias cámaras, cada sitio (por ejemplo, un centro de distribución) tiene su propia caja con una GPU que vigila sus cámaras. No hay un balanceador que mueva el tráfico: cada caja tiene que poder volver sola. Guarda cada versión del modelo en su propia carpeta, y un enlace llamado `current` (un archivo que solo apunta a otra carpeta) dice cuál corre. Volver es apuntar el enlace a la versión anterior, que sigue en el disco, y reiniciar el contenedor. Si durante una ola de actualizaciones un sitio empeora contra su semana anterior, la ola se detiene y ese sitio vuelve.

### Un LLM propio: un prompt nuevo es un cambio de código

En un sistema con un LLM, cambiar las instrucciones que se le dan al modelo (el *prompt*) cambia sus respuestas tanto como cambiar el modelo. Un servicio que sirve su propio LLM lo trata igual: cada revisión candidata (un modelo nuevo, una cuantización nueva o un prompt nuevo) corre el golden set de cada producto, que revisa, por ejemplo, que el JSON salga válido o que un juez calibrado contra personas la califique igual o mejor. Solo si no empeora más allá del margen se registra, y luego pasa por un canary. Es CI con otra clase de prueba.

### Moderación de contenido: 126 pruebas en ≈ 5 segundos, y pruebas para las alertas

Un sistema de moderación de contenido decide qué publicaciones se quedan, se revisan o se bajan. Una implementación de ejemplo de ese sistema trae 126 pruebas que corren en ≈ 5 segundos, sin GPU, sin Triton y sin Kafka, su [[cola-mensajes|cola de mensajes]]: los modelos y la cola van con dobles. Es la base de la pirámide funcionando: se pueden correr cada vez que guardas un archivo.

Trae algo más que vale la pena copiar: **pruebas para las alertas**. Las reglas que deciden cuándo despertar a alguien se escriben en un archivo, y `promtool test rules`, de Prometheus (el sistema que junta las métricas y dispara las alertas), las prueba con series de métricas inventadas: simula hasta 33 días de datos en ≈ 1 a 2 minutos y revisa que la alerta suene cuando debe y se calle cuando no. Una alerta que nunca se probó es como un rollback que nunca se ensayó: no sabes si funciona hasta el peor momento.

### Knight Capital, 2012: el servidor que nadie actualizó

El 1 de agosto de 2012, la casa de bolsa Knight Capital instaló código nuevo a mano en 8 servidores, y en uno se quedó el viejo. Ese servidor reactivó una función abandonada años antes y empezó a mandar órdenes de compra y venta sin parar. En ≈ 45 minutos la empresa perdió más de US$460 millones, según la SEC (el regulador de la bolsa de Estados Unidos; el primer estimado de la empresa fue de ≈ US$440 millones), y tuvo que ser rescatada por inversionistas. Un despliegue automático, igual en todas las máquinas y con una forma probada de volver, era justo lo que faltó.

### CrowdStrike, 2024: sin canary

El 19 de julio de 2024, CrowdStrike mandó una actualización de configuración de su programa de seguridad a todas las computadoras con Windows que lo usaban y estaban prendidas, en una sola ola. Un error en ese archivo las hizo caer: Microsoft estimó ≈ 8.5 millones de máquinas, con aeropuertos, bancos y hospitales detenidos. Entre lo que la empresa prometió cambiar estaba mandar esas actualizaciones por etapas, empezando por pocas máquinas. Es la cuenta del despliegue malo a escala mundial: el mismo error con el 5 % de las máquinas habría sido un susto.

## Ejercicios {Exercises}

Intenta cada uno antes de abrir la solución. El de flaky y el del despliegue malo se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] ¿Qué tipo de prueba es cada una: unitaria, de integración, end-to-end o de datos? (a) Llamar a `normaliza(236, 0)` y revisar que dé ≈ 1.92. (b) Mandarle al gateway, con un Triton falso, un PDF en vez de una foto y revisar que responda 415. (c) Subir una foto desde la app en staging y revisar que llegue una sugerencia en menos de 1 segundo. (d) Revisar que ningún `label_id` del snapshot de este mes pase de 499.
- (a) **Unitaria**: una función sola, sin red ni disco.
- (b) **De integración**: el gateway completo, con un doble en lugar de Triton.
- (c) **End-to-end**: todo el camino de verdad, como un usuario.
- (d) **De datos**: revisa un lote de datos, no código.
? [facil] pytest imprime `..F.F` y sale con código 1. ¿Cuántas pruebas corrieron, cuántas fallaron y qué hace CI con ese resultado?
- Cada carácter es una prueba: **corrieron 5**. Cada F es una que falló: **fallaron 2**, la tercera y la quinta.
- El código 1 dice que algo falló. CI marca el paso en rojo, se detiene ahí (no construye la imagen ni despliega) y el PR no se junta hasta que pase.
? [facil] ¿Por qué las pruebas del gateway usan un Triton falso en vez del real? Nombra dos cosas que el falso nunca va a atrapar.
- Porque el real necesita una GPU, un engine y minutos para arrancar, y las pruebas tienen que correr en segundos, en cualquier máquina. Con el falso, además, se provocan a propósito los casos difíciles: Triton caído (503) o lento (504).
- No atrapa, por ejemplo: que el engine real responda distinto (otra versión de TensorRT), que el Triton real se quede sin memoria de la GPU o tarde más de lo esperado, o un cambio en su configuración que el falso no copió. Para eso están la paridad de punta a punta y la prueba de humo.
? [facil] El equipo A despliega a producción cuando alguien aprieta un botón, después de que staging pasa. El equipo B despliega solo todo lo que pasa las pruebas. ¿Qué hace cada uno?
- A hace **entrega continua**: todo queda listo y probado, y una persona decide cuándo.
- B hace **despliegue continuo**: sin botón.
- Los dos son CD. Lo que comparten, y lo más importante, es que el artefacto se construye una vez y pasa por las mismas pruebas.
? [medio] Un repositorio tiene 150 pruebas y cada una falla sin razón el 0.2 % de las corridas. (a) ¿Qué fracción de las corridas sale en rojo sin ningún error? (b) Si cada prueba que falla se reintenta una vez, ¿cuánto queda? (c) ¿Qué riesgo trae el reintento?
- Se usa la fórmula de las falsas alarmas: \(P_{verde} = (1 − f^k)^n\) y \(P_{rojo} = 1 − P_{verde}\), con \(n\) = 150 pruebas y \(f\) = 0.2 % = 0.002.
- (a) Sin reintentos, \(k\) = 1: \(P_{verde}\) = (1 − 0.002)¹⁵⁰ = 0.998¹⁵⁰ ≈ 0.741. En rojo: \(P_{rojo}\) = 1 − 0.741 ≈ **25.9 %**, una de cada cuatro.
- (b) Con un reintento, \(k\) = 2: una prueba solo tumba la corrida si falla dos veces seguidas, \(f^k\) = 0.002² = 0.000004. \(P_{verde}\) = (1 − 0.000004)¹⁵⁰ ≈ 0.9994: en rojo, \(P_{rojo}\) ≈ **0.06 %**.
- (c) Que también esconde fallas reales que pasan a veces, como una carrera entre dos hilos. Por eso se cuentan los reintentos y las pruebas flaky se arreglan.
? [medio] ¿Qué etapa del pipeline de Alba atrapa cada error? (a) El preprocesamiento lee los colores como BGR (azul, verde, rojo: al revés de RGB). (b) Alguien cambió el nombre de la entrada en la configuración de Triton y no en el gateway. (c) La imagen se construyó en una Mac y salió para arm64. (d) Llega un snapshot con 40 % de las fotos repetidas.
- (a) La **paridad del preprocesamiento**: el tensor de las 20 fotos ya no coincide con el guardado (en el canal rojo del naranja, ≈ 2.96 de diferencia, según la lección de imágenes).
- (b) Las **pruebas de integración**, si el Triton falso revisa el nombre de la entrada; si no, la **paridad de punta a punta** o la **prueba de humo**, que hablan con el Triton real.
- (c) **Construir en CI** para `linux/amd64` lo evita; si se cuela, el pod no arranca en staging y la **prueba de humo** falla.
- (d) La **prueba de datos** del snapshot, antes de entrenar: el modelo nunca lo ve.
? [medio] Esta función tiene un `if`. Las pruebas solo la llaman con `precio(100, False)`. ¿Qué cobertura de líneas da? Si alguien agrega una prueba con `precio(100, True)` que solo revisa que no truene, ¿la cobertura llega a 100 %? ¿Ya está probada?

```python
def precio(base, con_envio):
    total = base
    if con_envio:
        total = total + 990       # el error: debía ser 99
    return total
```

- Cobertura = líneas que corrieron ÷ líneas en total. Las líneas de adentro son 4. Con `precio(100, False)` corren 3: `total = base`, el `if` y el `return`. Cobertura: 3 ÷ 4 = **75 %**.
- Con la segunda prueba corre también la del envío: 4 ÷ 4 = **100 %**.
- No está probada: esa prueba no revisa el resultado, y el 990 pasa. Una que sí lo revise, `assert precio(100, True) == 199`, falla y atrapa el error.
? [medio] Repite la cuenta del despliegue malo en el pico de diseño de Alba, 500 requests por segundo, con todo el tráfico, 10 minutos para detectar y 5 para revertir. ¿Cuánto del presupuesto de 300,000 se come? ¿Y con un canary al 5 %?
- Se usa la fórmula del despliegue malo: \(t_{mala} = 60 × (t_d + t_r)\), \(D = R × w × t_{mala}\) y \(G = D ÷ B\), con \(R\) = 500 y \(B\) = 300,000.
- Tiempo con la versión mala: \(t_{mala}\) = 60 × (10 + 5) = 900 s.
- Todo el tráfico, \(w\) = 1: \(D\) = 500 × 1 × 900 = **450,000** requests. \(G\) = 450,000 ÷ 300,000 = 1.5: el **150 %** del presupuesto del mes, en un solo despliegue.
- Canary al 5 %, \(w\) = 0.05: \(D\) = 500 × 0.05 × 900 = **22,500**. \(G\) = 22,500 ÷ 300,000 = 0.075: el **7.5 %**.
- En el pico, el rollback rápido y el canary dejan de ser lujos.
? [reto] Diseña el CI de Alba con un límite: el PR tiene que tener respuesta en menos de 10 minutos. Tienes linter (1 min), unitarias (0.5 min), las 26 de integración (2 min), la paridad del preprocesamiento (0.5 min), construir la imagen (1 min), la paridad de punta a punta en la T4 (1 min, más ≈ 5 min si hay que prender la máquina) y una prueba de humo (0.5 min). ¿Qué corre en cada PR, qué solo en `main` y cuánto tarda cada uno?
- La regla para sumar tiempos: los jobs que corren a la vez cuentan lo que tarda el más lento, \(max(t_{lint}, t_{pruebas})\); los que corren uno tras otro se suman.
- Las 26 de integración tardan ≈ 2 min; aquí se suman las unitarias y la paridad del preprocesamiento.
- **En cada PR**, lo que no necesita GPU, en dos jobs a la vez: el linter, \(t_{lint}\) = 1 min, y las pruebas, \(t_{pruebas}\) = unitarias + integración + paridad del preprocesamiento = 0.5 + 2 + 0.5 = 3 min. Tarda max(1, 3) = **3 min**.
- **En `main`**, después: la imagen (1 min) y el humo contra la imagen (0.5 min), y luego la paridad de punta a punta en la T4: 1 + 5 = 6 min si la máquina estaba apagada. Desde el merge: 3 + 1 + 0.5 + 6 = **10.5 min**.
- Si el equipo quiere avisar antes del merge, ya tiene en el PR la paridad del preprocesamiento (en CPU, 0.5 min). La de punta a punta en la T4 se queda en `main`, como en Alba, porque el runner con GPU tiene permisos en AWS y no debe correr código de un PR.
- Lo que nunca entra: entrenar el modelo. Eso es otro pipeline.
? [reto] Un snapshot de ejemplo (no el de Alba) tiene este mes 1.2 millones de filas, y el anterior tenía 1.0 millones. El 85 % de las etiquetas son débiles (salen de lo que eligió quien vende, sin revisar), y el tope acordado es 80 %. (El de septiembre de Alba tiene 1,932,628 fotos, y el 72 % de sus etiquetas sale de lo que eligió quien vende, ya filtrado.) (a) ¿Pasa la regla de volumen? ¿Y si tuviera 0.7 millones? (b) ¿La regla de etiquetas débiles debería bloquear o avisar? (c) ¿Qué pasa con el modelo en producción si la prueba bloquea?
- (a) La regla de volumen pide \(0.8 ≤ N_{ahora}/N_{antes} ≤ 1.5\). Con \(N_{ahora}\) = 1.2 y \(N_{antes}\) = 1.0 millones: 1.2 ÷ 1.0 = 1.2, dentro de 0.8 a 1.5: **pasa**. Con 0.7 millones, 0.7 ÷ 1.0 = 0.7 < 0.8: **falla**. Puede ser un job que se cortó a medias.
- (b) Si el tope se fijó con la historia de los snapshots y casi no da falsas alarmas, **bloquea**: entrenar con más ruido del permitido invalida el resultado. Si es una regla nueva, empieza como **aviso** y se promueve después.
- (c) **Nada malo**: ese mes no hay entrenamiento y el modelo que está en producción sigue sirviendo. Bloquear antes de entrenar es barato; descubrirlo después del canary, no.
:::

## Lo que sigue {What comes next}

**En Sensei:** la siguiente lección, «Configuración: YAML, variables de entorno y secretos», explica cómo la misma imagen se porta distinto en dev, staging y producción, y dónde se guardan las credenciales que un pipeline necesita.

Más adelante, cuatro lecciones toman esta y la llevan al sistema de Alba: «Gate de evaluación y registry», la prueba del modelo; «Export, engine y paridad», la paridad del engine; «CI/CD y registro de imágenes», este pipeline hecho con GitHub Actions; y «Rollout seguro», el canary y el rollback.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
prueba-unitaria prueba-integracion prueba-e2e pytest fixture mock cobertura prueba-humo prueba-datos prueba-flaky linter ci cd github-actions runner-ci artefacto ambiente rollback
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Qué diferencia hay entre una prueba unitaria, una de integración y una end-to-end?
Cuánto del sistema prenden. La unitaria prueba una función sola, sin red ni disco, en milisegundos. La de integración, varias piezas juntas, a veces con un doble en lugar de lo externo (el gateway con un Triton falso). La end-to-end, todo el camino de verdad, como un usuario: la más completa y la más lenta.
? ¿Por qué la pirámide tiene muchas pruebas abajo y pocas arriba?
Porque las de abajo son rápidas, baratas y dicen exactamente dónde está el error, así que pueden correr en cada cambio. Las de arriba tardan minutos, necesitan el sistema completo y no dicen dónde falló: se corren pocas, antes de producción.
? ¿Qué es un mock y cuál es su riesgo?
Un doble que reemplaza algo lento o externo y responde lo que le digas. Su riesgo es que no se parezca al real: la prueba pasa y producción falla. Se reduce con dobles que copian la forma del real y con pruebas contra la pieza de verdad.
? ¿Qué atrapa una prueba de datos que una prueba de código no puede atrapar?
Un lote malo con el código intacto: etiquetas fuera de rango, fotos repetidas, nulos, la mitad de las filas que faltan. Se corre en cada snapshot, antes de entrenar.
? ¿Por qué 100 % de cobertura no quiere decir que el código esté bien?
Porque la cobertura cuenta qué líneas corrieron, no si alguien revisó lo que salió. El `max` del martes corrió con 100 % y pasó.
? ¿Qué diferencia hay entre entrega continua y despliegue continuo?
En la entrega continua, todo lo que pasa queda listo y una persona decide cuándo sale a producción. En el despliegue continuo sale solo.
? ¿Qué hace falta para que un rollback funcione?
Que la versión anterior siga disponible (su imagen por digest, o viva durante el bake), que volver tome minutos o segundos, y que se haya ensayado. Y la regla: primero revertir, después investigar.
:::
