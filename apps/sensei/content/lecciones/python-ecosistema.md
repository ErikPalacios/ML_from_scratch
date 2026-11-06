---
titulo: Python, paquetes y entornos
en: Python, packages and environments
subtitulo: De dónde saca Python el código que importa, cómo se instala el código de otros, cómo se fija la versión exacta que llega a producción y por qué una imagen con PyTorch pesa gigas.
pregunta: El gateway de C01 funciona en la laptop de quien lo escribió y en el contenedor truena con «ModuleNotFoundError», o corre con otra versión de NumPy. ¿De dónde saca Python el código que importa y cómo se asegura que a producción llegue exactamente lo que probaste?
requisitos: terminal, programa-proceso
---

:::idea
Un programa de Python casi nunca está solo: importa la biblioteca estándar y decenas de paquetes ajenos, cada uno con su versión y, muchas veces, con código compilado para una sola plataforma. Para que producción corra lo mismo que probaste, se escribe la lista exacta de todo (el *lock file*), se instala en una carpeta aislada (el entorno virtual) y esa carpeta viaja dentro de la imagen.
:::

Imagina al equipo de C01 el día que arma el [[contenedor]] del gateway. En la laptop de quien lo escribió, `uvicorn app.main:app`, el comando que arranca su servidor, funciona sin problema. En el contenedor, la primera línea falla:

```text
ModuleNotFoundError: No module named 'numpy'
```

NumPy es la librería de Python para arreglos de números, y el gateway la usa para armar el tensor de la foto. El error dice que, dentro del contenedor, Python no la encuentra.

O peor: arranca, responde, y las categorías salen un poco distintas a las de la laptop, sin un solo error. Detrás de las dos fallas hay las mismas cuatro preguntas: ¿de dónde saca Python el código que importa? ¿Cómo se instala el código de otros? ¿Cómo se fija qué versión exacta va a producción? ¿Y por qué una imagen con PyTorch pesa gigas mientras la del gateway pesa menos de 100 MB? (La imagen es el paquete congelado del que nace cada contenedor; la sección de entornos virtuales la abre por dentro.)

En la lección de la terminal viste el [[path-shell|PATH]] y las [[variable-entorno|variables de entorno]]; en «Programas y procesos», que Python es un [[interprete|intérprete]]. Con eso basta para empezar.

## Módulos, paquetes e import {Modules, packages and import}

Python lee tu archivo `.py` y lo ejecuta línea por línea. Cuando tu programa crece, lo partes en varios archivos, y cada uno puede usar lo que definen los otros con `import`.

Un [[modulo-python|módulo]] (*module*) es un archivo `.py`. Su nombre es el del archivo sin la extensión: `preprocess.py` es el módulo `preprocess`, y otro archivo lo usa con `import preprocess`.

Un [[paquete-python|paquete]] (*package*) es una carpeta de módulos, normalmente con un archivo `__init__.py` adentro. El gateway de C01 es uno:

```text
gateway/
  app/
    __init__.py      ← hace de app un paquete
    main.py          ← el módulo app.main: crea el servidor
    preprocess.py    ← el módulo app.preprocess: decodifica y redimensiona
```

Los puntos del nombre son carpetas: `from app.preprocess import preprocess` quiere decir «en la carpeta `app`, el archivo `preprocess.py`, la función `preprocess`». Por eso el gateway arranca con `uvicorn app.main:app`: «del módulo `app.main`, el objeto `app`».

### Qué hace import

`import json` hace tres cosas:

:::pasos
1. Busca
Recorre una lista de carpetas, en orden, hasta encontrar un `json.py` o una carpeta `json/` con su `__init__.py`.
2. Ejecuta
Corre ese archivo de arriba abajo, una sola vez. Todo lo que define (funciones, constantes) queda en un objeto módulo.
3. Recuerda
Guarda el módulo en `sys.modules`, un diccionario de los módulos ya cargados. Si otro archivo vuelve a importar `json`, recibe el mismo objeto sin volver a correrlo.
:::

Si recorre toda la lista sin encontrarlo, truena con `ModuleNotFoundError`. Es la falla del contenedor de arriba: NumPy no estaba en ninguna de esas carpetas.

La primera vez que importas un módulo, Python además guarda una versión ya traducida en un archivo `.pyc`, dentro de una carpeta `__pycache__`, para arrancar más rápido la próxima vez. Si ves esas carpetas junto a tu código, no las escribiste tú: si las borras, se vuelven a crear solas.

### Correr un módulo por su nombre

`python -m nombre` busca el módulo `nombre` igual que `import`, en las mismas carpetas, y lo corre como programa. Lo vas a ver en toda la lección: `python -m pip`, `python -m venv`, `python -m zipfile`. También sirve con la biblioteca estándar: `python -m json.tool datos.json` imprime un JSON con sangría, fácil de leer.

¿Cómo sabe un archivo si lo importaron o si lo corrieron? Python le pone a cada módulo su nombre en la variable `__name__`: el del módulo si lo importaron, y `"__main__"` si es el programa que arrancó. Por eso muchos archivos terminan con `if __name__ == "__main__":`. Lo de adentro corre solo cuando el archivo es el programa, no cuando otro lo importa.

### sys.path: la lista de carpetas

La lista está en `sys.path`, y su orden importa porque **gana el primero que aparece**:

1. **La carpeta del script** que corriste (o la carpeta actual, si escribes en la consola o usas `python -c`).
2. Las carpetas de la variable `PYTHONPATH`, si existe.
3. **La biblioteca estándar**, lo que trae Python, con su carpeta `lib-dynload` de piezas compiladas.
4. **`site-packages`**, donde se instalan los paquetes de otros.

Así se ve en un contenedor con la imagen oficial de Python 3.13, la misma familia que usa el gateway. Son tres comandos. El primero imprime `sys.path`, una carpeta por línea. El segundo le pasa a `python -` (el guion quiere decir «lee el programa de la entrada») un programa de varias líneas, con el *heredoc* `<<'PY'` de la lección de la terminal; ese programa pregunta dónde encontraría `import` cinco módulos, sin ejecutarlos. El tercero intenta importar NumPy y deja solo la última línea del error:

```bash
python -c "import sys; print(*sys.path[1:], sep='\n')"     # el [0] es '': la carpeta actual
python - <<'PY'
import importlib.util
for nombre in ("sys", "json", "math", "pytest", "numpy"):
    spec = importlib.util.find_spec(nombre)                # busca como import, sin ejecutar
    print(f"{nombre:>6}:", spec.origin if spec else "no está en ninguna carpeta")
PY
python -c "import numpy" 2>&1 | tail -1
```

```salida
/usr/local/lib/python313.zip
/usr/local/lib/python3.13
/usr/local/lib/python3.13/lib-dynload
/usr/local/lib/python3.13/site-packages
   sys: built-in
  json: /usr/local/lib/python3.13/json/__init__.py
  math: /usr/local/lib/python3.13/lib-dynload/math.cpython-313-aarch64-linux-gnu.so
pytest: /usr/local/lib/python3.13/site-packages/pytest/__init__.py
 numpy: no está en ninguna carpeta
ModuleNotFoundError: No module named 'numpy'
```

`sys` viene dentro del intérprete mismo (*built-in*). `json` es una carpeta de la biblioteca estándar. `math` es un archivo `.so`: código compilado, como verás en la sección de wheels; el `aarch64` dice que este contenedor corrió en un chip ARM, y en una máquina Intel o AMD diría `x86_64`. `pytest` está en `site-packages` porque alguien lo instaló. Y `numpy` no está.

:::figura python-ecosistema-syspath
`import json` recorre las carpetas de sys.path de arriba abajo y se queda con el primer json que encuentra. Si tu carpeta tiene un json.py, ese gana y el de la biblioteca estándar nunca se lee.
:::

### Un archivo tuyo puede tapar a uno de Python

Como la carpeta del script va primero, un archivo tuyo llamado `json.py`, `random.py` o `torch.py` **tapa** al de verdad: `import json` carga el tuyo. El programa no falla al importar; falla después, cuando busca algo que tu archivo no tiene.

El modo aislado de Python, `python -I`, no pone la carpeta del script en `sys.path` (e ignora `PYTHONPATH`). Todos los bloques de Python de este curso se comprueban así, para que un archivo suelto no se meta. Este código arma una carpeta temporal con un `json.py` falso y corre el mismo programa de las dos maneras:

```python
import subprocess, sys, tempfile
from pathlib import Path

carpeta = Path(tempfile.mkdtemp())
(carpeta / "json.py").write_text('print("  (se ejecutó el json.py de tu carpeta)")\n')
(carpeta / "app.py").write_text(
    "import json\n"
    "origen = 'tu carpeta' if json.__file__.endswith('json.py') else 'la biblioteca estándar'\n"
    "print('  json viene de', origen, '· ¿tiene dumps?', hasattr(json, 'dumps'))\n")

for modo in ([], ["-I"]):
    print("python", *modo, "app.py", flush=True)
    subprocess.run([sys.executable, *modo, "app.py"], cwd=carpeta)
```

```salida
python app.py
  (se ejecutó el json.py de tu carpeta)
  json viene de tu carpeta · ¿tiene dumps? False
python -I app.py
  json viene de la biblioteca estándar · ¿tiene dumps? True
```

Sin `-I`, cualquier `json.dumps` del programa fallaría con un `AttributeError` (el error de «este objeto no tiene nada con ese nombre»), que no menciona el archivo culpable. La regla: no le pongas a tus archivos el nombre de un módulo que uses, y cuando algo raro pase, imprime `modulo.__file__` para ver de dónde salió.

## La biblioteca estándar, PyPI y pip {The standard library, PyPI and pip}

### Lo que trae Python sin instalar nada

Una biblioteca (*library*; en México también se dice librería) es código que otros escribieron para que tu programa lo use. Python trae la suya: la [[biblioteca-estandar|biblioteca estándar]] (*standard library*), ≈ 200 módulos que llegan con cualquier instalación. Python 3.13 enumera 192 nombres públicos, sin contar los internos que empiezan con guion bajo. Por eso se dice que Python viene «con pilas incluidas» (*batteries included*).

Ya usaste muchos en este curso: `json`, `math`, `struct`, `hashlib`, `sqlite3`, `asyncio`, `http.server`. Casi todos los ejemplos del curso se quedan ahí a propósito: así los corres sin instalar nada.

Lo demás se instala aparte: NumPy (arreglos de números), Pillow (imágenes), FastAPI (el servidor web del gateway), PyTorch. Son paquetes de terceros: no los escribió el equipo de Python, y cada uno tiene su propio ritmo de versiones.

### PyPI: el índice público

Un índice de paquetes (*package index*) es un servidor que guarda paquetes para que un instalador los baje. [[pypi|PyPI]] (*Python Package Index*, en pypi.org) es el índice público de Python: un servidor con cientos de miles de proyectos (≈ 935,000 en noviembre de 2026), cada uno con todas sus versiones y sus archivos. Cualquiera puede crear una cuenta y subir un paquete: eso lo hace enorme y también riesgoso, porque un paquete con un nombre parecido al de uno famoso puede traer código malicioso. Ese riesgo es parte de la [[cadena-suministro|cadena de suministro]], que tiene su lección más adelante.

### pip: el instalador

[[pip]] es el programa que baja paquetes de PyPI y los copia en `site-packages`. Viene con Python. Sus [[comando|comandos]] de todos los días:

| Comando | Qué hace |
|---|---|
| `pip install pillow==12.3.0` | Baja esa versión exacta y lo que ella pida |
| `pip install -r requirements.txt` | Instala todo lo que dice un archivo, una línea por paquete |
| `pip list` | Lista lo instalado, en una tabla |
| `pip freeze` | Lo mismo, como `nombre==versión`: el formato de `requirements.txt` |
| `pip show pillow` | La ficha de un paquete: versión, qué pide, dónde quedó |
| `pip uninstall pillow` | Lo quita |

En una máquina puede haber varios Pythons: el del sistema operativo, uno de Homebrew (un instalador de programas para la Mac), el de cada entorno virtual. El comando `pip` es el primero que la shell encuentra en el PATH, y puede ser de **otro** Python que el que corre tu programa. El paquete se instala, `import` falla, y nada lo explica. Por eso se recomienda `python -m pip`: corre el pip **de ese Python**, el mismo que luego hará el `import`.

```bash
which python pip
python -m pip --version
python -m pip list
```

```salida
/usr/local/bin/python
/usr/local/bin/pip
pip 26.2.2 from /usr/local/lib/python3.13/site-packages/pip (python 3.13)
Package   Version
--------- -------
iniconfig 2.3.1
packaging 26.3
pip       26.2.2
pluggy    1.7.0
Pygments  2.21.0
pytest    8.4.2
PyYAML    6.0.3
```

`which` dice qué programa corre la shell para cada nombre, y `--version` dice de qué Python es ese pip: `(python 3.13)`. Los bloques `bash` de esta lección corren en un contenedor de prueba sin red; en la siguiente sección instalamos de una carpeta local.

### «Paquete» quiere decir dos cosas

Lo que **se instala** de PyPI también se llama paquete (más exacto: *distribución*), y su nombre no siempre es el del paquete que **se importa**:

| Se instala con pip | Se importa con |
|---|---|
| `pillow` | `import PIL` |
| `scikit-learn` | `import sklearn` |
| `opencv-python` | `import cv2` |
| `PyYAML` | `import yaml` |
| `tritonclient[http]` | `import tritonclient.http` |

Por eso `pip install PIL` no sirve y `import pillow` da `ModuleNotFoundError`. Lo de los corchetes, `[http]`, es un *extra*: una parte opcional del paquete que trae sus propias dependencias.

pip le pregunta a PyPI si no le dices otra cosa. Muchas empresas le dan, en cambio, su propio índice: un **espejo** (*mirror*) con copias revisadas de PyPI.

:::profundo No todo sale de PyPI: espejos y confusión de dependencias
pip pregunta por omisión a PyPI, pero se le puede dar otro índice con `--index-url`, o uno más con `--extra-index-url`. Las empresas suelen tener un índice propio: un **espejo** (*mirror*) que guarda copias revisadas de lo que se usa de PyPI, más los paquetes internos que no son públicos. Así la construcción de la imagen no depende de que PyPI responda, y nadie instala nada sin revisar.

Mezclar índices tiene una trampa. Si tu empresa tiene un paquete interno llamado `c01-utils` y alguien publica en PyPI otro `c01-utils` con una versión más alta, pip con `--extra-index-url` puede preferir el público. Se llama **confusión de dependencias** (*dependency confusion*), y la Ronda la pone en M15 junto al *typosquatting*, el de los nombres casi iguales a los famosos.
:::

## Wheels y extensiones nativas {Wheels and native extensions}

¿Qué baja pip, exactamente? Un archivo por paquete, de una de dos clases.

### La wheel: un zip ya armado

Una [[wheel]] (archivo `.whl`, «rueda») es un zip (un archivo comprimido que guarda muchos archivos adentro) con los archivos del paquete ya listos para copiar a `site-packages`, más una carpeta `.dist-info` con su ficha: el nombre, la versión y lo que pide. Instalarla es, en lo esencial, descomprimirla: no hace falta ningún compilador.

La otra clase es el **sdist** (*source distribution*, un `.tar.gz` con el código fuente). Para instalarlo, pip tiene que **construirlo** primero: correr la herramienta de empaquetado del proyecto y, si trae código en C, un [[compilar|compilador]] como `gcc`. Es lento, pide herramientas que una imagen chica no tiene y puede fallar a la mitad. Por eso el [[dockerfile|Dockerfile]] del gateway (la receta con que se arma su imagen) instala con `--only-binary=:all:`: si a algún paquete le falta su wheel, el *build* (el proceso que arma la imagen) falla ahí, en vez de compilar en silencio.

Como una wheel es solo un zip, se puede armar a mano. Este bloque crea dos paquetes de juguete, `recorte` y `colores` (recorte pide `colores` 2.0 o más nuevo), mira uno por dentro y los instala desde una carpeta local, sin internet. El script `rueda.py` recibe como argumentos el nombre, la versión y lo que pide, y escribe un zip con los cuatro archivos mínimos de una wheel. `cut -c1-40` solo recorta cada línea a 40 letras:

```bash
mkdir ruedas
cat > rueda.py <<'PY'
import sys, zipfile                     # arma una wheel de juguete: python rueda.py NOMBRE VERSION [LO QUE PIDE...]
nombre, version, *pide = sys.argv[1:]
info = f"{nombre}-{version}.dist-info"
meta = f"Metadata-Version: 2.1\nName: {nombre}\nVersion: {version}\n"
meta += "".join(f"Requires-Dist: {p}\n" for p in pide)
archivos = {f"{nombre}/__init__.py": f"VERSION = '{version}'\n", f"{info}/METADATA": meta,
            f"{info}/WHEEL": "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n", f"{info}/RECORD": ""}
with zipfile.ZipFile(f"ruedas/{nombre}-{version}-py3-none-any.whl", "w") as z:
    for ruta, texto in archivos.items():
        z.writestr(zipfile.ZipInfo(ruta, (2026, 1, 1, 0, 0, 0)), texto)
PY
python rueda.py recorte 1.0.0 "colores>=2.0"
python rueda.py colores 2.1.0
python -m zipfile -l ruedas/recorte-1.0.0-py3-none-any.whl | cut -c1-40
python -m venv .venv && source .venv/bin/activate         # un entorno limpio (sección 6)
python -m pip install --no-index --find-links ruedas recorte
python -m pip freeze
```

```salida
File Name
recorte/__init__.py
recorte-1.0.0.dist-info/METADATA
recorte-1.0.0.dist-info/WHEEL
recorte-1.0.0.dist-info/RECORD
Looking in links: ruedas
Processing ./ruedas/recorte-1.0.0-py3-none-any.whl
Processing ./ruedas/colores-2.1.0-py3-none-any.whl (from recorte)
Installing collected packages: colores, recorte

Successfully installed colores-2.1.0 recorte-1.0.0
colores==2.1.0
recorte==1.0.0
```

Pediste un paquete y llegaron dos: pip leyó el `Requires-Dist` de `recorte` y fue por `colores`. `--no-index` le prohíbe ir a PyPI y `--find-links` le dice dónde buscar. Las wheels de verdad traen además, en `RECORD`, el [[hash-criptografico|hash]] de cada archivo: su huella, que cambia si cambia un solo byte.

### El nombre de una wheel dice dónde sirve

El nombre de una wheel no es libre: dice para qué Python y qué máquina se armó.

:::figura python-ecosistema-rueda
Las cinco partes del nombre de una wheel de NumPy. Las tres últimas son la etiqueta: con qué Python se compiló, con qué interfaz binaria y para qué sistema y chip. Una wheel de puro Python dice py3-none-any: sirve en cualquier lado.
:::

- **`py3-none-any`**: puro Python. Sirve en cualquier Python 3, cualquier sistema y cualquier chip. FastAPI es así.
- **`cp313-cp313`**: compilada para CPython 3.13 (CPython es el intérprete normal de Python, el escrito en C). El primer `cp313` dice con qué Python; el segundo, con qué **interfaz binaria** (*ABI*, *application binary interface*): las reglas de cómo el código ya compilado se conecta con el intérprete que está corriendo, qué funciones suyas llama y cómo acomoda los datos en memoria. Esas reglas cambian entre la 3.12 y la 3.13, así que esta wheel no sirve en la 3.12.
- **`manylinux_2_28_x86_64`**: para Linux con glibc 2.28 o más nueva en un chip x86_64. glibc es la biblioteca básica de C de casi todas las distribuciones de Linux: la que usa cualquier programa compilado para abrir archivos o pedir memoria. Las imágenes `python:3.13-slim` son Debian y tienen glibc.
- **`macosx_14_0_arm64`**: para macOS 14 o más nuevo en un chip de Apple, como el de una MacBook.
- **`musllinux_1_2_x86_64`**: para Linux con musl, otra biblioteca de C más chica, en vez de glibc. La usa Alpine, una distribución de Linux mínima, popular en contenedores. Muchos paquetes de ML, PyTorch entre ellos, no publican estas.

El chip es la [[arquitectura-cpu|arquitectura de CPU]] de «El sistema operativo». pip compara cada etiqueta con la de tu máquina y escoge la más específica que sirva:

```python
ruedas = [
    "fastapi-0.141.1-py3-none-any.whl",
    "numpy-2.5.3-cp313-cp313-manylinux_2_28_x86_64.whl",
    "numpy-2.5.3-cp313-cp313-macosx_14_0_arm64.whl",
    "numpy-2.5.3-cp312-cp312-manylinux_2_28_x86_64.whl",
    "numpy-2.5.3-cp313-cp313-musllinux_1_2_x86_64.whl",
]

def sirve(rueda, python="cp313", plataforma=("manylinux", "x86_64")):
    nombre, version, py, abi, plat = rueda.removesuffix(".whl").split("-")
    if plat == "any":                             # puro Python: sirve en todos lados
        return py.startswith("py3")
    return py == python and all(p in plat for p in plataforma)

print("En el contenedor del gateway (Linux x86_64 con glibc, Python 3.13):")
for r in ruedas:
    print(f"  {'sí' if sirve(r) else 'no'}  {r}")
```

```salida
En el contenedor del gateway (Linux x86_64 con glibc, Python 3.13):
  sí  fastapi-0.141.1-py3-none-any.whl
  sí  numpy-2.5.3-cp313-cp313-manylinux_2_28_x86_64.whl
  no  numpy-2.5.3-cp313-cp313-macosx_14_0_arm64.whl
  no  numpy-2.5.3-cp312-cp312-manylinux_2_28_x86_64.whl
  no  numpy-2.5.3-cp313-cp313-musllinux_1_2_x86_64.whl
```

Es una versión simplificada: pip también acepta wheels de glibc más viejas que la tuya, entre otros detalles.

### Extensiones nativas: código compilado dentro de un paquete

¿Por qué NumPy necesita una wheel por plataforma y FastAPI no? Porque NumPy trae una [[extension-nativa|extensión nativa]] (*native extension*): un módulo escrito en C, C++, Rust o CUDA y ya compilado a instrucciones de una CPU, en un archivo `.so` en Linux y macOS o `.pyd` en Windows. Python lo importa como a cualquier módulo, pero adentro no hay Python: es el `math.cpython-313-aarch64-linux-gnu.so` que viste arriba.

Existen por velocidad. En «CPU y GPU» viste que Python puro hace las cuentas de una en una; NumPy, Pillow y PyTorch hacen el trabajo pesado en C y C++, y pueden soltar el [[gil|GIL]] mientras tanto. Pillow trae además librerías de imágenes compiladas, como las de JPEG; `pydantic_core`, el corazón de pydantic (una librería que revisa datos; la verás en la sección de type hints), está escrito en Rust, otro lenguaje que se compila; PyTorch trae C++ y kernels de [[cuda|CUDA]]. De los 37 paquetes que instala el gateway (los vas a contar en la sección que sigue), 17 traen código compilado en su wheel de Linux.

El precio: el mismo `numpy==2.5.3` son archivos distintos en tu Mac y en el contenedor. Casi siempre se portan igual, pero no son el mismo binario, y a veces se nota.

### PyTorch: el paquete que pesa gigas

PyTorch es el caso extremo. En Linux, `pip install torch` baja de PyPI una wheel que trae CUDA como dependencias: unos quince paquetes `nvidia-*` con las librerías de NVIDIA, más `triton`, un compilador de kernels (nada que ver con el servidor Triton de C01). Para torch 2.14 (septiembre de 2026) en Linux x86_64, la wheel de solo CPU pesa ≈ 196 MB; la de PyPI, ≈ 555 MB, y con sus librerías de CUDA, ≈ 3 GB, como mide la Ronda. Por eso una imagen con PyTorch y CUDA pesa gigas.

Las wheels `nvidia-*` dicen `py3-none-manylinux…`: traen código compilado, pero no se atan a ningún Python (`none`), así que una sirve en cualquier 3.x.

PyTorch tiene además su propio índice, con una variante por versión de CUDA: torch 2.14 ofrece CUDA 12.6, 13.0 y 13.2. Es una ilustración, sin salida, porque necesita internet:

```bash
pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cu126   # con CUDA 12.6
pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cpu     # solo CPU
```

El CUDA de la wheel tiene que ser compatible con el [[driver]] de la máquina: la torch 2.14 de PyPI trae CUDA 13.0, que pide un driver 580 o más nuevo. Si el driver es más viejo, `torch.cuda.is_available()`, la función que pregunta si hay una GPU que PyTorch pueda usar, dice `False` y todo corre en CPU, con apenas un aviso (*warning*) que es fácil no ver.

:::diagrama python-ecosistema-instalar
Lo que pasa entre `pip install` y un import que funciona. Toca cada caja o usa «Recorrer» para seguir una instalación normal, una sin wheel y una con lock y hashes.
:::

## Dependencias y versiones {Dependencies and versions}

### Lo que pides y lo que eso pide

Una [[dependencia]] (*dependency*) es un paquete que tu código necesita para correr. El gateway importa FastAPI: FastAPI es su dependencia. Pero FastAPI, a su vez, necesita Starlette (la parte que habla HTTP) y Pydantic (la que valida datos), y Pydantic necesita `pydantic_core`. Esas son [[dependencia-transitiva|dependencias transitivas]] (*transitive dependencies*): las que llegan porque las pide algo que tú pediste, en cualquier nivel.

:::cuenta Los paquetes del gateway de C01
Directas // las que importa app/: fastapi, uvicorn, uvloop, httptools, pillow, numpy, tritonclient, aiohttp, prometheus-client | — | 9
Transitivas // las que llegaron solas: starlette, pydantic, anyio, h11, yarl… | 37 − 9 | 28
Total en el requirements.txt | 9 + 28 | 37
Transitivas por cada directa | 28 ÷ 9 | ≈ 3.1
= Tres de cada cuatro paquetes del gateway (28 de 37, ≈ 76 %) nadie los pidió por su nombre. Igual corren en producción, y cualquiera puede cambiar.
:::

:::figura python-ecosistema-arbol
Una parte del árbol del gateway. En azul, cuatro de las 9 que el equipo pidió; colgando de cada una, algunas de las 28 que llegaron solas. Los de naranja, idna y multidict, cuelgan de dos ramas, pero en site-packages, a la derecha, cada paquete aparece una sola vez.
:::

Cada paquete instalado guarda su ficha en su carpeta `.dist-info`, y la biblioteca estándar la lee con `importlib.metadata`. Este programa recorre el árbol de pytest en el contenedor de prueba. Usa `packaging`, la librería que pip usa por dentro para leer versiones; aquí ya viene, porque pytest la pide:

```bash
python - <<'PY'
from importlib.metadata import requires, version
from packaging.requirements import Requirement

print([t for t in requires("pytest") if "win32" in t])      # una dependencia con condición

def arbol(nombre, nivel=0):
    print("  " * nivel + f"{nombre} {version(nombre)}")
    for texto in requires(nombre) or []:
        r = Requirement(texto)
        if r.marker is None or r.marker.evaluate({"extra": ""}):   # solo lo que aplica aquí
            arbol(r.name, nivel + 1)

arbol("pytest")
PY
```

```salida
['colorama>=0.4; sys_platform == "win32"']
pytest 8.4.2
  iniconfig 2.3.1
  packaging 26.3
  pluggy 1.7.0
  pygments 2.21.0
```

Lo que va después del `;` es una condición (*marker*): pytest pide colorama solo en Windows. Por eso el árbol cambia según la plataforma, y una lista hecha en una Mac puede no servir tal cual en Linux.

### Cuando dos paquetes no se ponen de acuerdo

En un `site-packages` cabe **una** versión de cada paquete. Si una dependencia pide `colores>=2.0` y otra `colores<2`, no hay versión que deje contentas a las dos: es un **conflicto de dependencias**. pip lo detecta antes de instalar:

```bash
mkdir ruedas
cat > rueda.py <<'PY'
import sys, zipfile                     # el mismo rueda.py de la sección de wheels
nombre, version, *pide = sys.argv[1:]
info = f"{nombre}-{version}.dist-info"
meta = f"Metadata-Version: 2.1\nName: {nombre}\nVersion: {version}\n"
meta += "".join(f"Requires-Dist: {p}\n" for p in pide)
archivos = {f"{nombre}/__init__.py": f"VERSION = '{version}'\n", f"{info}/METADATA": meta,
            f"{info}/WHEEL": "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n", f"{info}/RECORD": ""}
with zipfile.ZipFile(f"ruedas/{nombre}-{version}-py3-none-any.whl", "w") as z:
    for ruta, texto in archivos.items():
        z.writestr(zipfile.ZipInfo(ruta, (2026, 1, 1, 0, 0, 0)), texto)
PY
python rueda.py recorte 1.0.0 "colores>=2.0"
python rueda.py marco 3.2.0 "colores<2"
python rueda.py colores 2.1.0
python rueda.py colores 1.4.0
python -m venv .venv && source .venv/bin/activate
pip install --no-index --find-links ruedas recorte marco 2>&1 | grep "caused\|depends\|ResolutionImpossible" | cut -c1-55
```

```salida
The conflict is caused by:
    recorte 1.0.0 depends on colores>=2.0
    marco 3.2.0 depends on colores<2
ERROR: ResolutionImpossible: for help visit https://pip
```

La parte de pip que busca una combinación que cumpla todo se llama **resolvedor** (*resolver*); el de ahora llegó con pip 20.3, en 2020. Empieza por la versión más nueva de cada paquete que cabe en lo pedido; si más abajo del árbol eso choca con otra regla, regresa y prueba una versión anterior (*backtracking*). Con árboles grandes eso puede tardar minutos, y pip avisa «This could take a while».

Aquí se rinde, y hace bien: instalar cualquiera de las dos versiones de `colores` rompería a alguien. La salida es aflojar un rango, cambiar la versión de `recorte` o de `marco`, o quitar uno de los dos.

### Qué promete cada número

Casi todos los paquetes numeran sus versiones con la idea del [[version-semantica|versionado semántico]] (*semantic versioning*, o *semver*): **MAYOR.MENOR.PARCHE**, como 2.5.3.

| Sube… | Promete | De 2.5.3 a… |
|---|---|---|
| PARCHE | Solo arregla errores; nada cambia por fuera | 2.5.4 |
| MENOR | Agrega cosas sin romper lo que había | 2.6.0 |
| MAYOR | Puede romper: algo que funcionaba deja de funcionar | 3.0.0 |

¿Qué tanto se cumple? Es una promesa, no una regla que alguien revise:

- **Las 0.x no prometen nada.** En semver, una versión 0.algo puede romper en cualquier subida. FastAPI lleva años en 0.x: el gateway usa la 0.141.
- **No todos usan semver.** pip (26.2), certifi (2026.7.22) y attrs (26.1.0) numeran por fecha: el primer número es el año.
- **Una MAYOR rompe de verdad.** NumPy 2.0 (2024) cambió su interfaz binaria: las extensiones compiladas contra NumPy 1.x dejaron de cargar con NumPy 2, con un error que empieza con «A module that was compiled using NumPy 1.x cannot be run in NumPy 2…».
- **Un arreglo también cambia resultados.** La Ronda lo advierte: otra versión de Pillow puede redimensionar un poco distinto, y el [[accuracy]] baja un par de puntos sin un solo error. Es el [[training-serving-skew|training-serving skew]] de la lección de imágenes.

### Cómo se escribe qué versiones aceptas

Las reglas para pedir versiones salen del PEP 440 (los PEP son los documentos donde la comunidad de Python acuerda cada cambio):

- `==2.5.3`: exactamente esa.
- `>=2.5`: esa o cualquiera más nueva, **incluida la 3.0**.
- `<3` o `!=2.5.0`: un tope o una versión vetada; se combinan con coma: `>=2,<3`.
- `~=2.5.3`: «compatible»: 2.5.3 o más nueva, pero sin salir de la 2.5. `~=2.5` no sale de la 2.

```bash
python - <<'PY'
from packaging.specifiers import SpecifierSet
versiones = ["1.26.4", "2.0.0", "2.5.2", "2.5.3", "2.5.4", "2.6.0", "3.0.0"]
for regla in ["==2.5.3", ">=2.5", "~=2.5.3", "~=2.5", ">=2,<3"]:
    print(f"{regla:>8} acepta:", ", ".join(SpecifierSet(regla).filter(versiones)))
PY
```

```salida
 ==2.5.3 acepta: 2.5.3
   >=2.5 acepta: 2.5.2, 2.5.3, 2.5.4, 2.6.0, 3.0.0
 ~=2.5.3 acepta: 2.5.3, 2.5.4
   ~=2.5 acepta: 2.5.2, 2.5.3, 2.5.4, 2.6.0
  >=2,<3 acepta: 2.0.0, 2.5.2, 2.5.3, 2.5.4, 2.6.0
```

Fíjate en `>=2.5`: acepta la 3.0.0, la que puede romper. Un rango sin tope es una apuesta a que nadie publique una MAYOR.

## Lo que pides y lo que instalas: pyproject.toml y el lock file {What you ask for and what you install: pyproject.toml and the lock file}

Hay dos listas distintas, y confundirlas causa la mitad de los «en mi máquina sí funciona».

### pyproject.toml: lo que pides

[[pyproject|`pyproject.toml`]] es la ficha de un proyecto de Python, en la raíz de su carpeta. Está escrito en TOML, un formato de texto de llaves y valores parecido al [[yaml|YAML]], y la biblioteca estándar lo lee con `tomllib`. Dice cómo se llama el proyecto, su versión, qué Python necesita, de qué depende y cómo se configuran sus herramientas, como pytest. Este es un `pyproject.toml` de ejemplo para el gateway (el de la Ronda usa solo `requirements.txt`):

```python
import tomllib                       # lee TOML; viene con Python desde la 3.11

pyproject = tomllib.loads('''
[project]
name = "gateway-c01"
version = "1.4.0"
requires-python = ">=3.13"
dependencies = ["fastapi>=0.141", "uvicorn>=0.54", "pillow==12.3.0", "numpy>=2.5,<3"]

[project.optional-dependencies]
dev = ["pytest>=9.1"]
''')

proyecto = pyproject["project"]
print(proyecto["name"], proyecto["version"], "· Python", proyecto["requires-python"])
for dep in proyecto["dependencies"]:
    print("  pide:", dep)
print("  y para los tests:", *proyecto["optional-dependencies"]["dev"])
```

```salida
gateway-c01 1.4.0 · Python >=3.13
  pide: fastapi>=0.141
  pide: uvicorn>=0.54
  pide: pillow==12.3.0
  pide: numpy>=2.5,<3
  y para los tests: pytest>=9.1
```

Son solo las directas, y casi todas con rango: «cualquier FastAPI 0.141 o más nueva». Pillow va fija porque el preprocesamiento del entrenamiento depende de ella. El rango es lo correcto aquí: dice qué versiones **aceptas**. Pero no dice cuáles **vas a recibir**: el resolvedor escoge, el día que instalas, las más nuevas que quepan. Mañana pueden ser otras.

¿Qué tan seguido pasa? Piensa en reconstruir la imagen del mismo *commit* (una versión guardada del código; la lección de Git lo presenta) un mes después. Si cada paquete tiene 90 % de quedarse igual, que se queden igual los 37 a la vez es multiplicar 0.9 por sí mismo 37 veces, suponiendo que cada uno cambia por su lado:

:::cuenta Reconstruir el mismo commit sin lock, un mes después
Paquetes en el árbol // las 37 del gateway | — | 37
Probabilidad de que un paquete saque, en un mes, una versión nueva que cabe en su rango // un supuesto para el ejemplo | — | 10 %
Probabilidad de que no cambie ninguno // 0.9 × 0.9 × … 37 veces | 0.9³⁷ | ≈ 2 %
Probabilidad de que cambie al menos uno | 1 − 0.9³⁷ | ≈ 98 %
= Con solo rangos, reconstruir el mismo código un mes después casi seguro instala algo distinto. Con un lock, la probabilidad es 0: se instalan los mismos archivos, con el mismo hash.
:::

:::calculadora python-ecosistema-rebuild
Prueba con 150 paquetes, una cifra común en un proyecto con PyTorch, y mira la última línea: cuántos builds sin lock harías, en promedio, para que uno saliera idéntico al primero.
:::

### El lock file: lo que instalas

Un [[lock-file|lock file]] (archivo de bloqueo) es la lista exacta de **todo** el árbol: cada paquete, directo o transitivo, con su versión exacta y, en los buenos, el hash de cada archivo. Se genera una vez, se guarda junto al código y se instala igual en todos lados. Viene de *lock*, «candado»: deja las versiones bajo llave. Tiene varias formas:

- **Un `requirements.txt` fijado**: una línea `nombre==versión` por paquete. El del gateway tiene las 37. Puede salir de un `pip freeze` de un entorno limpio, o mejor, de `pip-compile` (de la herramienta pip-tools) o de `uv pip compile`, que lo resuelven desde la lista de directas y pueden agregar los hashes.
- **`uv.lock`**, el de uv, y **`poetry.lock`**, el de Poetry: dos gestores que leen el `pyproject.toml` y escriben el lock solos.
- **`pylock.toml`**: el formato estándar que acordó el PEP 751 (2025), para que cualquier herramienta lea el lock de otra. uv lo escribe con `uv export`, y pip, con `pip lock`, que en pip 26 todavía es experimental.

¿Por qué no basta `pip freeze`? Porque copia lo que hay en **ese** entorno, en **esa** máquina. Si un día instalaste a mano una herramienta para probar algo, entra al lock. Si el entorno es de una Mac, la lista trae lo que necesitó la Mac, que puede no ser lo de Linux. Y no trae hashes. `pip-compile` y uv parten de la lista de lo que pides (un `requirements.in` o el `pyproject.toml`), resuelven desde cero y escriben solo lo necesario.

Una línea con hash se ve así (el hash, recortado):

```text
pillow==12.3.0 \
    --hash=sha256:3f1a…
```

El hash es el [[hash-criptografico|hash criptográfico]] de la lección de tiempo y hashes: la huella del archivo. Si alguien cambia un solo byte de la wheel, el hash cambia. Con `--require-hashes`, pip se niega a instalar cualquier archivo cuyo hash no sea el del lock:

```bash
mkdir ruedas
python - <<'PY'
import hashlib, zipfile                           # una wheel de juguete y su línea en el lock
ruta, info = "ruedas/colores-2.1.0-py3-none-any.whl", "colores-2.1.0.dist-info"
with zipfile.ZipFile(ruta, "w") as z:
    for nombre, texto in {"colores/__init__.py": "VERSION = '2.1.0'\n",
                          f"{info}/METADATA": "Metadata-Version: 2.1\nName: colores\nVersion: 2.1.0\n",
                          f"{info}/WHEEL": "Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
                          f"{info}/RECORD": ""}.items():
        z.writestr(zipfile.ZipInfo(nombre, (2026, 1, 1, 0, 0, 0)), texto)
h = hashlib.sha256(open(ruta, "rb").read()).hexdigest()
open("requirements.txt", "w").write(f"colores==2.1.0 --hash=sha256:{h}\n")
PY
cut -c1-46 requirements.txt
python -m venv .venv && source .venv/bin/activate
pip install -q --no-index --find-links ruedas --require-hashes -r requirements.txt && echo "instaló: el hash coincide"
pip uninstall -q -y colores
python - <<'PY'
import zipfile                                    # alguien mete un archivo más en la wheel
with zipfile.ZipFile("ruedas/colores-2.1.0-py3-none-any.whl", "a") as z:
    z.writestr(zipfile.ZipInfo("colores/extra.py", (2026, 1, 1, 0, 0, 0)), "print('hola')\n")
PY
pip install -q --no-index --find-links ruedas --require-hashes -r requirements.txt 2>&1 | cut -c1-60
```

```salida
colores==2.1.0 --hash=sha256:91d3d94a49f03a53b
instaló: el hash coincide
ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUI
    colores==2.1.0 from file:///home/ana/trabajo/ruedas/colo
        Expected sha256 91d3d94a49f03a53b140a64b98b23b82e251
             Got        4ac4c9cf0b00c33413a558ed955313941000
```

Misma versión, mismo nombre de archivo, otro contenido: pip lo rechaza. Así se defiende producción de un archivo cambiado en el camino.

### Las reglas

- **El `pyproject.toml` dice lo que aceptas; el lock, lo que instalas.** Los dos se guardan en el [[repositorio]] del código, la carpeta del proyecto con la historia de sus versiones que vas a ver en la lección de Git.
- **Producción instala del lock, nunca de los rangos.** El build de la imagen corre `pip install -r requirements.txt` (o `uv sync --frozen`, lo mismo con uv, otro gestor que verás más adelante), nunca `pip install fastapi`.
- **Fijado no es congelado.** El mismo lock trae las mismas versiones con las mismas fallas de seguridad conocidas. Los locks se actualizan a propósito: herramientas como Dependabot o Renovate revisan seguido si hay versiones nuevas y proponen el cambio, las pruebas corren y alguien lo revisa.

## Entornos virtuales {Virtual environments}

Un Python tiene un solo `site-packages`, y en él cabe una versión de cada paquete. Si un proyecto necesita NumPy 1.26 y otro NumPy 2.5, no pueden compartirlo. Y el Python del sistema operativo es del sistema: sus herramientas dependen de los paquetes que trae, y si les cambias uno, algo del sistema puede dejar de funcionar.

### Una carpeta con su propio site-packages

Un [[entorno-virtual|entorno virtual]] (*virtual environment*, o *venv*) es una carpeta con su propio `site-packages` y un `python` que es un enlace al Python de base. Se crea con el módulo `venv`, que está en la biblioteca estándar desde Python 3.3 (2012): `python -m venv .venv`.

Adentro quedan tres cosas importantes:

- **`.venv/bin/python`**: en Linux y macOS, un enlace simbólico al Python de base, como viste en «El sistema operativo». No es otra copia de Python.
- **`.venv/lib/python3.13/site-packages`**: vacío, salvo por pip.
- **`.venv/pyvenv.cfg`**: un archivo de texto que le dice a Python «eres un entorno virtual, tu base está en tal lugar».

Cuando Python arranca desde `.venv/bin/python`, lee ese archivo y pone en `sys.path` el `site-packages` del entorno en vez del de base. La biblioteca estándar sigue siendo la del Python de base.

### Activar es solo cambiar el PATH

`source .venv/bin/activate` no hace nada mágico: pone `.venv/bin` al principio del PATH, para que `python` y `pip` sean los del entorno (y agrega `(.venv)` al prompt, para que sepas que está activo). `deactivate` lo regresa. Activar ni siquiera es obligatorio: correr `.venv/bin/python` directamente es lo mismo.

El bloque crea un entorno y lo mira por dentro: `head -3` muestra las primeras tres líneas de `pyvenv.cfg`, `readlink` dice a dónde apunta el enlace `python` y `which python` dice cuál `python` correría la shell, antes y después de activar. Al final se sale con `deactivate`: En Windows la carpeta se llama `Scripts` en vez de `bin`, y se activa con `.venv\Scripts\activate`.

```bash
python -m venv .venv
head -3 .venv/pyvenv.cfg
readlink .venv/bin/python
which python
source .venv/bin/activate
which python
echo "$PATH" | cut -d: -f1-2
python -m pip list
python -c "import pytest" 2>&1 | tail -1
deactivate
python -c "import pytest; print('afuera sí está pytest', pytest.__version__)"
```

```salida
home = /usr/local/bin
include-system-site-packages = false
version = 3.13.18
/usr/local/bin/python
/usr/local/bin/python
/home/ana/trabajo/.venv/bin/python
/home/ana/trabajo/.venv/bin:/usr/local/bin
Package Version
------- -------
pip     26.2.2
ModuleNotFoundError: No module named 'pytest'
afuera sí está pytest 8.4.2
```

El entorno nuevo solo tiene pip, y **no ve** el pytest instalado afuera: `include-system-site-packages = false`. Es justo lo que se quiere. Y es la historia del gateway: en la laptop, NumPy estaba instalado en el Python de siempre, y nadie lo anotó; en el entorno limpio del contenedor, no estaba.

:::figura python-ecosistema-venv
El mismo comando, python, antes y después de activar el entorno. La shell recorre el PATH de izquierda a derecha y corre el primer python que encuentra. Activar solo pone la carpeta .venv/bin al principio.
:::

### Un entorno no se mueve de lugar

Los programas que pip instala en `.venv/bin`, como el propio `pip`, son [[script-shell|scripts]] cuya primera línea, el [[shebang]], dice con qué Python correrlos, con la **ruta completa** de la carpeta donde se creó el entorno. Si mueves la carpeta, esa ruta ya no existe:

```bash
python -m venv .venv
head -1 .venv/bin/pip
mv .venv otra-carpeta
./otra-carpeta/bin/pip --version
```

```salida
#!/home/ana/trabajo/.venv/bin/python
bash: line 4: ./otra-carpeta/bin/pip: cannot execute: required file not found
```

Un entorno no se copia de una máquina a otra ni se cambia de carpeta: se vuelve a crear desde el lock. Por eso el gateway lo crea en `/opt/venv` y lo copia a `/opt/venv`, la misma ruta, como vas a ver ahora.

### El /opt/venv del gateway

Dentro de un contenedor solo corre una aplicación. ¿Para qué un entorno virtual? Por cómo se arma la imagen. La [[imagen-contenedor|imagen]] es el paquete congelado del que nace cada contenedor, y su receta es el [[dockerfile|Dockerfile]]; las dos se presentan a fondo en la estación de empaquetado. Para leer la receta basta saber cuatro palabras: `FROM` dice de qué imagen parte, `RUN` corre un comando, `ENV` fija una [[variable-entorno|variable de entorno]] y `COPY` copia archivos adentro. La del gateway tiene dos etapas, y cada `FROM` empieza una. Es una ilustración, recortada:

```text
FROM python:3.13-slim AS builder
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --only-binary=:all: -r requirements.txt

FROM python:3.13-slim AS runtime
ENV PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
COPY --from=builder /opt/venv /opt/venv
COPY app/ ./app/
```

La primera etapa crea el entorno en `/opt/venv`, lo «activa» con el PATH (sin `activate`) e instala las 37 del lock. La segunda parte de una imagen limpia y copia **solo esa carpeta** y el código: pip, sus caches y cualquier herramienta de la primera etapa se quedan atrás. Su `PYTHONUNBUFFERED=1` es el de la lección del sistema operativo: que Python escriba cada línea de log al instante. El enlace `python` del entorno apunta a `/usr/local/bin/python`, que existe en las dos etapas porque ambas parten de `python:3.13-slim`.

:::cuenta Lo que pesa la imagen del gateway, comprimida
Python y Debian // la imagen base python:3.13-slim | — | ≈ 43 MB
El entorno /opt/venv // las 37 dependencias; ≈ 160 MB descomprimido en disco | — | ≈ 44 MB
El código, app/ | — | ≈ 0.048 MB
Total | 43 + 44 + 0.048 | ≈ 87 MB
= La mitad de la imagen son las dependencias, y el código del equipo es una parte en ≈ 1,800. La imagen completa python:3.13, sin slim, pesaría ≈ 0.4 GB, unas 10 veces la base slim (cifras de Docker Hub para amd64, otro nombre de x86_64, en noviembre de 2026).
:::

:::diagrama python-ecosistema-entornos
Dos caminos de la laptop a producción. Usa «Recorrer» para ver el que truena y el que llega igual.
:::

:::profundo «externally-managed-environment»
Si en Debian 12, en Ubuntu reciente o con el Python de Homebrew escribes `pip install requests` fuera de un entorno virtual, pip se niega con el error `externally-managed-environment`. No es un bug: es el PEP 668. El sistema marca su Python como «manejado por otro», el gestor de paquetes del sistema operativo (la marca es un archivo llamado `EXTERNALLY-MANAGED` junto a su biblioteca estándar), para que pip no le cambie una librería de la que depende alguna herramienta. La salida correcta es un entorno virtual. Existe la opción `--break-system-packages`, y su nombre dice lo que hace. Las imágenes oficiales `python:3.13` no traen esa marca: su Python vive en `/usr/local`, aparte del de Debian.
:::

## uv y conda: otros gestores {uv and conda: other managers} [extra]

pip y venv vienen con Python y alcanzan para todo lo de esta lección. Pero no son los únicos, y en la Ronda y en el trabajo vas a ver otros dos muy seguido.

### uv: pip, venv y el lock en uno

[[uv]] es un gestor de paquetes y proyectos de Python escrito en Rust por la empresa Astral, publicado en 2024 (en marzo de 2026, OpenAI anunció que compraría Astral; uv sigue siendo de código abierto). Hace en un solo programa lo de pip, venv, pip-tools (el lock), pipx y pyenv (las dos, al final de esta sección) y más, y es mucho más rápido: Astral dice que entre 10 y 100 veces más que pip, sobre todo cuando ya tiene los archivos en su cache. Resuelve y baja en paralelo, y guarda un cache global del que copia (o enlaza) los archivos en vez de bajarlos otra vez.

Tiene dos maneras de usarse. La primera imita a pip, para proyectos con `requirements.txt`:

```bash
uv venv                                            # como python -m venv .venv
uv pip install -r requirements.txt                 # como pip install, mucho más rápido
uv pip compile requirements.in --generate-hashes -o requirements.txt   # el lock, desde las directas
```

La segunda maneja el proyecto completo desde el `pyproject.toml`:

```bash
uv add fastapi              # lo agrega al pyproject.toml y actualiza uv.lock
uv lock                     # resuelve todo el árbol y escribe uv.lock
uv sync --frozen            # deja .venv igual al lock, sin volver a resolver
uv run pytest               # corre un comando dentro del entorno, sin activarlo
```

Son ilustraciones, sin salida: uv no viene con Python. El comentario del `requirements.txt` del gateway lo dice: en un proyecto real, ese lock se genera con `uv pip compile` o con `pip-compile --generate-hashes`.

Una diferencia importante con `pip freeze`: `uv.lock` es **universal**. Resuelve el árbol para todas las plataformas a la vez y anota qué wheel va en cada una. El mismo archivo sirve en la Mac del equipo y en el Linux del contenedor; un `pip freeze` sale de una sola máquina, con lo que esa máquina necesitó.

Poetry hace algo parecido desde hace más años, con su `poetry.lock`; pip-tools es la opción mínima: solo resuelve y escribe el `requirements.txt` fijado.

uv también instala **versiones de Python**: `uv python install 3.13` baja un Python completo sin tocar el del sistema. Es lo que hace pyenv, otra herramienta que vas a ver en muchos tutoriales. Así, cada proyecto puede fijar no solo sus paquetes sino su intérprete, como el `requires-python` del `pyproject.toml`.

### conda: cuando lo que falta no es Python

[[conda]] es otro gestor de paquetes y entornos, nacido en el mundo científico. Su diferencia de fondo: sus paquetes no son solo de Python. conda instala también compiladores, las librerías matemáticas de Intel (MKL), el toolkit de CUDA (lo que hace falta para compilar código de GPU), ffmpeg (para audio y video), librerías de mapas como GDAL, el lenguaje de estadística R… y el propio Python. Cada entorno de conda es una carpeta con todo eso adentro.

Los paquetes salen de **canales**: el de Anaconda, la empresa que creó conda, y **conda-forge**, uno comunitario y abierto con decenas de miles de paquetes. Hay versiones más rápidas del mismo programa, como mamba y micromamba.

¿Cuándo conviene?

- **Sí:** cuando necesitas piezas que no son Python y pip no da, o que darían guerra compilar: una librería de mapas, un toolkit de CUDA completo para compilar, un clúster de investigación (las computadoras compartidas de un laboratorio) donde no eres [[root]] y no puedes instalar nada en el sistema.
- **Casi nunca:** en la imagen de un servicio como el gateway. Las wheels ya traen su código compilado (PyTorch trae su CUDA), y la imagen slim con pip o uv es más chica y más simple.

Una trampa clásica: mezclar `conda install` y `pip install` en el mismo entorno. conda no sabe lo que pip cambió y puede pisarlo. Si no hay otra, primero todo lo de conda y pip al final. Y revisa las licencias: según los términos de servicio de Anaconda (julio de 2025), una empresa de más de 200 personas, contando contratistas, necesita una licencia de pago para usar su canal; conda-forge es libre, y Miniforge es un instalador de conda que ya viene apuntando a él.

| Herramienta | Instala paquetes | Crea entornos | Escribe un lock | Trae lo que no es Python |
|---|---|---|---|---|
| pip + venv | Sí, de PyPI | Sí, con `venv` | No: `pip freeze` es una foto | No |
| pip-tools | Usa pip | No | Sí: `requirements.txt` con hashes | No |
| Poetry | Sí | Sí | Sí: `poetry.lock` | No |
| uv | Sí, muy rápido | Sí | Sí: `uv.lock`, universal | Solo el propio Python |
| conda | Sí, de sus canales | Sí | Con herramientas extra | Sí: CUDA, compiladores, R |

:::nota pipx, para herramientas
Para programas de línea de comandos escritos en Python (como una herramienta que da formato al código), existen pipx y `uv tool install`: instalan cada herramienta en su propio entorno escondido y ponen su comando en el PATH. Así no ensucian ningún proyecto.
:::

## Type hints y pydantic: tipos que se revisan y que no {Type hints and pydantic: types that are checked and types that are not} [extra]

### Type hints: anotaciones que Python no revisa

Puedes anotar qué tipo espera cada parámetro y qué tipo regresa una función. Son los [[type-hints]] (*type hints*, «pistas de tipo»). La sintaxis existe desde Python 3.0, pero fue el PEP 484 (Python 3.5, 2015) el que acordó usarla para tipos y trajo el módulo `typing`:

```python
def bytes_tensor(ancho: int, alto: int) -> int:
    """Bytes de un tensor RGB en float32: 3 canales × 4 bytes."""
    return 3 * ancho * alto * 4

print(bytes_tensor(224, 224))
r = bytes_tensor("224", 1)            # el tipo está mal, y Python ni lo nota
print(r[:12], "…", type(r).__name__, "de", len(r), "letras")
print(bytes_tensor.__annotations__)
```

```salida
602112
224224224224 … str de 36 letras
{'ancho': <class 'int'>, 'alto': <class 'int'>, 'return': <class 'int'>}
```

El 602,112 es el tensor de la foto de Ana en float32. Pero con `"224"`, un texto, la función no se queja: `3 * "224"` repite el texto, y regresa 36 letras donde prometía un entero. Python guarda las anotaciones en `__annotations__` y **no las revisa al correr**. Son documentación.

¿Quién las revisa? Programas aparte, **antes** de correr: mypy y pyright (el que va dentro de Pylance, la extensión de Python del editor VS Code) leen tu código, siguen los tipos y avisan del error sin ejecutar nada. Con mypy, la línea de arriba daría algo como esto (es una ilustración):

```text
error: Argument 1 to "bytes_tensor" has incompatible type "str"; expected "int"
```

Se corren en la [[ci|integración continua]] (*CI*, el proceso automático que revisa cada cambio al código; lo ves en «Pruebas y CI/CD»), junto con las pruebas: cada cambio al código pasa por ellos antes de llegar a producción. El editor también usa los tipos para autocompletar y para avisarte mientras escribes. La Ronda los usa mucho: `def seed_everything(seed: int, deterministic: bool = False) -> torch.Generator:` dice, sin leer el cuerpo, qué entra y qué sale.

Los tipos se combinan. Los cuatro que más vas a leer:

| Anotación | Quiere decir |
|---|---|
| `list[int]` | Una lista de enteros |
| `dict[str, float]` | Un diccionario de texto a número, como `{"tenis": 0.93}` |
| `str \| None` | Un texto, o nada (`None`): el valor puede faltar |
| `int = 5` | Un entero que, si no lo pasas, vale 5 |

La barra `|` se lee «o». Un revisor como mypy te obliga a manejar el caso `None` antes de usar el valor como texto: atrapa justo el error de «este campo a veces no viene».

En código más viejo vas a leer lo mismo escrito de otra manera, con nombres del módulo `typing`: `List[int]` en vez de `list[int]` (la forma corta sirve desde Python 3.9) y `Optional[str]` en vez de `str | None` (la barra sirve desde la 3.10). Quieren decir exactamente lo mismo.

### pydantic: los mismos tipos, revisados al correr

Hay datos que ningún revisor ve antes de correr: lo que llega por la red. El [[body]] de una request puede traer cualquier cosa. [[pydantic]] es una librería que usa las mismas anotaciones para **revisar datos mientras el programa corre**. Describes la forma de un mensaje como una clase, y pydantic revisa cada dato que la llena.

La idea cabe en unas líneas de la biblioteca estándar. Una `dataclass` es una clase que solo guarda campos con sus tipos; no revisa nada. Esta función de juguete lee esos tipos y convierte o rechaza cada valor, que es lo que hace pydantic, mucho más completo y rápido:

```python
from dataclasses import dataclass, fields

@dataclass
class Prediccion:
    label: str
    score: float

def validar(clase, datos):
    """Un pydantic de juguete: revisa y convierte cada campo según su tipo."""
    limpio = {}
    for campo in fields(clase):
        valor = datos[campo.name]
        try:
            limpio[campo.name] = campo.type(valor)        # str("tenis"), float("0.93")
        except (TypeError, ValueError):
            raise ValueError(f"{campo.name}: {valor!r} no es {campo.type.__name__}") from None
    return clase(**limpio)

print(validar(Prediccion, {"label": "tenis", "score": "0.93"}))
try:
    validar(Prediccion, {"label": "tenis", "score": "mucho"})
except ValueError as e:
    print("rechazado →", e)
print(Prediccion(label="tenis", score="mucho"))   # sin validar, la clase acepta lo que sea
```

```salida
Prediccion(label='tenis', score=0.93)
rechazado → score: 'mucho' no es float
Prediccion(label='tenis', score='mucho')
```

La última línea es el punto: sin alguien que revise, `score` queda como el texto `'mucho'` y el error sale después, lejos de donde entró. El juguete tiene huecos (convertiría cualquier número en texto con `str`, y no sabe de rangos ni de listas); pydantic los cubre.

Así se ve el de verdad. Es una ilustración, sin salida, porque pydantic no viene con Python (`pip install pydantic`). Lo que imprime está en los comentarios:

```python
from pydantic import BaseModel, Field, ValidationError

class Prediccion(BaseModel):
    label: str
    score: float = Field(ge=0, le=1)          # entre 0 y 1

p = Prediccion(label="tenis", score="0.93")   # el texto "0.93" se convierte a 0.93
print(p.score, type(p.score))                 # 0.93 <class 'float'>

try:
    Prediccion(label="tenis", score=1.7)
except ValidationError as e:
    print(e.errors()[0]["msg"])               # Input should be less than or equal to 1
```

Fíjate en el `"0.93"`: por omisión, pydantic **convierte** lo que se puede convertir sin perder nada (un texto con un número, a float) y rechaza lo demás. Si quieres que no convierta nada, tiene un modo estricto (`strict=True`). Desde su versión 2 (2023), el corazón de pydantic es `pydantic_core`, escrito en Rust: una de las extensiones nativas del gateway.

Ese cambio de MAYOR también rompió cosas, como promete el semver. La versión 2 renombró los métodos de siempre: `.dict()` pasó a ser `.model_dump()`, `.json()` pasó a `.model_dump_json()` y `parse_obj()` pasó a `model_validate()`. Los nombres viejos siguen ahí, con un aviso de que se van a quitar, así que un tutorial de antes de 2023 casi corre, pero no del todo. Fíjate en qué versión de pydantic supone un ejemplo antes de copiarlo.

Su uso más famoso es [[fastapi|FastAPI]], el *framework* (un armazón de código listo para escribir servidores) con que está escrito el gateway de C01, que se presenta en la estación de serving del Dojo. FastAPI lee los tipos de cada parámetro y del body, valida cada request con pydantic y, si algo no cumple, responde **422** sin llegar a tu función, como viste en la lección de APIs. En la lección de configuración vas a ver pydantic-settings, que hace lo mismo con las variables de entorno: `INFER_TIMEOUT_S=0.15` llega como texto y sale como un número revisado.

## Errores comunes {Common mistakes}

### 1. Instalar con el pip de otro Python

`pip install pillow` dice «Successfully installed», y `import PIL` falla. El `pip` que corriste era de otro Python, o de otro entorno.

**Cómo evitarlo:** usa `python -m pip`, y ante la duda, `which python`, `python -m pip --version` y `python -c "import sys; print(sys.prefix)"` (la carpeta del Python o del entorno que corre): los tres deben hablar del mismo lugar.

### 2. pip install sin versiones

Un *notebook* (un cuaderno de Jupyter, donde se mezclan código y texto) con `pip install torch fastapi pillow` funciona hoy. En tres meses, el mismo notebook instala otras versiones, y el modelo que entrenaste ya no se puede reproducir. La Ronda lo pone como antipatrón del Dockerfile y como trampa de seguridad.

**Cómo evitarlo:** las directas en el `pyproject.toml`, todo el árbol en un lock con hashes, y producción instalando solo del lock.

### 3. Un archivo con el nombre de un módulo

Tu `json.py`, `random.py` o `torch.py` tapa al de verdad, y el error que sale (`AttributeError: module 'json' has no attribute 'dumps'`) no menciona tu archivo.

**Cómo evitarlo:** nombres propios para tus archivos (`mi_json.py`, `preprocess.py`), y ante algo raro, `print(modulo.__file__)`. El `.pyc` viejo que queda en `__pycache__` al renombrarlo no estorba: Python ignora un `.pyc` de esa carpeta cuyo `.py` ya no existe.

### 4. Una wheel de otra plataforma

En la Mac, todo instala en segundos. En el contenedor, pip intenta compilar un paquete y falla por falta de `gcc`; o en una imagen Alpine, PyTorch ni siquiera tiene wheel.

**Cómo evitarlo:** imágenes slim con glibc, no Alpine, para ML; `--only-binary=:all:` para que una wheel que falta se note al construir; y un lock que conozca la plataforma de producción (uno universal, o uno generado en Linux).

### 5. Instalar fuera del entorno

`sudo pip install` en el Python del sistema, o `--break-system-packages` para callar el error del PEP 668. Funciona hasta que una herramienta del sistema se rompe, o hasta que nadie sabe qué hay instalado.

**Cómo evitarlo:** un entorno virtual por proyecto, siempre. Es una carpeta: si se ensucia, se borra y se vuelve a crear desde el lock en segundos.

### 6. PyTorch con CUDA donde no hay GPU

Un servicio que corre en CPU instala `torch` desde PyPI «por si acaso» y la imagen sube de ≈ 0.09 GB a más de 3. O al revés: la imagen trae un CUDA más nuevo que el que acepta el driver del nodo (la máquina del clúster donde corre), y el modelo corre en CPU casi sin avisar.

**Cómo evitarlo:** el índice `/whl/cpu` donde no hay GPU, y donde sí, revisar la versión de CUDA de la wheel contra el driver (`torch.version.cuda`, y `torch.cuda.is_available()` al arrancar, con un error si da `False`).

## En la vida real {In real life} [extra]

### C01: la imagen del gateway y la Pillow que no se mueve

El gateway de C01 es el ejemplo de esta lección completa. Su `requirements.txt` fija las 37 dependencias con `==`, transitivas incluidas, y un comentario dice por qué: sin lock, reconstruir el mismo commit puede traer otra Starlette u otro NumPy y cambiar el comportamiento sin que nadie toque el código. La imagen se arma en dos etapas con `/opt/venv`, solo con wheels, y pesa ≈ 87 MB comprimida.

La dependencia más vigilada es Pillow. El gateway decodifica y redimensiona cada foto con Pillow, y el entrenamiento también. Si las dos versiones difieren, el resize puede dar píxeles un poco distintos y el modelo recibe fotos que no son como las que vio al entrenar. Por eso `pillow==12.3.0` aparece igual en el entorno del gateway y en el del job que exporta el modelo, y el preprocesamiento es un solo módulo, `app/preprocess.py`, que importan el entrenamiento, la evaluación y el gateway.

Las pruebas usan las mismas versiones que producción: el `requirements-dev.txt` empieza con `-r requirements.txt` (incluye el lock de producción) y solo agrega pytest y un cliente HTTP con sus transitivas. Y el job de exportación fija `torch==2.14.0` a propósito: según la Ronda, el exportador de modelos cambia entre versiones.

:::calculadora python-ecosistema-imagen
Arranca con la imagen del gateway. Prueba agregar torch solo para CPU (1) y con CUDA (2), y mira cuánto tarda cada nodo en bajarla.
:::

### Por qué el gateway no importa torch

Fíjate en lo que **no** está entre las 37: PyTorch. El gateway prepara el tensor y se lo manda a Triton, el servidor de modelos de NVIDIA, que corre el modelo en la GPU. Esa separación también es una decisión de paquetes:

:::cuenta Si el gateway importara torch con CUDA
Imagen actual // base, entorno y código | 43 + 44 + 0.048 | ≈ 87 MB
torch con CUDA y sus librerías // la cifra de la Ronda para torch 2.14 | — | ≈ 3,000 MB
Imagen con torch | 87 + 3,000 | ≈ 3,087 MB
Veces más grande | 3,087 ÷ 87 | ≈ 35.5
Bajarla en un nodo nuevo, a 100 MB/s // un supuesto de red | 3,087 ÷ 100 | ≈ 31 s
= Con torch, cada réplica nueva tardaría ≈ 31 s solo en bajar la imagen, contra menos de 1 s hoy. El peso de PyTorch y CUDA lo carga una sola imagen, la de Triton: la Ronda la pone en ≈ 9.2 GB comprimida, la release 24.08 de NGC para x86_64.
:::

Esa espera es parte del arranque en frío (*cold start*) que la Ronda mide en M05: cuando llega un pico y el sistema agrega réplicas, cada una empieza por bajar su imagen. Un gateway liviano escala en segundos.

### LiteLLM: un día sin lock

La Ronda registra un caso de 2026: las versiones 1.82.7 y 1.82.8 de LiteLLM, una librería muy usada para hablar con LLMs, salieron comprometidas en PyPI el 24 de marzo. Quien corrió `pip install litellm` sin versión en las pocas horas que estuvieron publicadas recibió el código malicioso. La 1.82.8 traía además un archivo `.pth` en `site-packages`, de los que Python lee cada vez que arranca: el código corría aunque nadie importara litellm. Quien instalaba de un lock con hashes, hecho antes, no recibió nada: pip habría rechazado cualquier archivo distinto al revisado. Es el ejemplo de por qué la Ronda pide, en M15, índices revisados y versiones fijadas con hash.

En los sistemas con LLMs (C10, C11) el problema se agranda: la pila cambia cada mes, las imágenes con vLLM y CUDA pesan varios GB, y la Ronda repite el consejo en su referencia de herramientas: fija versiones.

### En el edge: otro chip, otras wheels

En C02, cada centro de distribución tiene su propia caja con una GPU que vigila las cámaras. Si una caja así fuera un equipo ARM, como los Jetson de NVIDIA, el mismo `requirements.txt` del servidor no serviría: pip buscaría wheels `aarch64` y, para PyTorch con CUDA en esos equipos, NVIDIA publica sus propias wheels, atadas a la versión de su sistema (JetPack). El lock del edge es otro lock, armado y probado en esa plataforma. Es la sección de wheels llevada al extremo: el nombre del archivo decide dónde corre.

### Reproducir un modelo meses después

En M10, la Ronda cuenta los ingredientes para reproducir un entrenamiento. Uno es el entorno: la imagen identificada por su huella (su *digest*) y las dependencias fijadas. Uno de sus ejemplos de por qué: un valor por omisión cambió entre dos versiones de una librería, y el mismo código entrenó otra cosa.

### Fuera de ML: once líneas que rompieron internet

En marzo de 2016, un programador quitó de npm, el índice de paquetes de JavaScript, un paquete de once líneas llamado left-pad, que rellenaba un texto con espacios a la izquierda. Miles de proyectos dependían de él sin saberlo, como dependencia transitiva de herramientas famosas, y sus builds empezaron a fallar en todo el mundo. npm terminó cambiando sus reglas para que un paquete usado por otros no se pudiera borrar así.

Cada lenguaje resolvió lo mismo con su propio lock: `package-lock.json` en JavaScript, `Cargo.lock` en Rust, `Gemfile.lock` en Ruby, `go.mod` con `go.sum` en Go. La idea es la de esta lección: lo que pides cabe en un rango; lo que instalas tiene que ser exacto.

## Ejercicios {Exercises}

Resuélvelos antes de abrir la solución. Los de tamaños y probabilidades se pueden comprobar con las calculadoras.

:::ejercicios
? [facil] Tu carpeta tiene `app.py` y un `random.py` tuyo con una sola función. `app.py` hace `import random` y llama `random.randint(1, 6)`. ¿Qué pasa con `python app.py`? ¿Y con `python -I app.py`?
- Con `python app.py`, la carpeta del script va primero en `sys.path`: `import random` carga **tu** `random.py`. Como no tiene `randint`, sale `AttributeError: module 'random' has no attribute 'randint'`.
- Con `python -I app.py`, la carpeta del script no entra a `sys.path`: se carga el `random` de la biblioteca estándar y funciona.
- El arreglo de verdad no es `-I`, es renombrar tu archivo.
? [facil] El gateway corre en Linux x86_64 con Python 3.13. ¿Cuáles de estas wheels puede usar? `pillow-12.3.0-cp313-cp313-macosx_11_0_arm64.whl`, `pillow-12.3.0-cp313-cp313-manylinux_2_28_x86_64.whl` y `starlette-1.7.0-py3-none-any.whl`.
- La de macOS, **no**: es para una Mac con chip de Apple.
- La `manylinux_2_28_x86_64`, **sí**: Linux con glibc 2.28 o más nueva en x86_64, compilada para CPython 3.13 (`cp313`). Debian, la base de `python:3.13-slim`, tiene glibc.
- La de Starlette, **sí**: `py3-none-any` es puro Python y sirve en cualquier lado.
? [facil] Alguien escribe `pip install PIL` y, después de instalar bien, `import pillow`. Los dos fallan. ¿Por qué, y qué se escribe?
- El nombre que **se instala** no es el que **se importa**. En PyPI el paquete se llama `pillow`; adentro trae el paquete de import `PIL`.
- Se escribe `python -m pip install pillow` y, en el código, `from PIL import Image`.
? [facil] ¿Qué versiones de esta lista acepta `numpy~=2.5.0`: 2.4.9, 2.5.0, 2.5.7, 2.6.0 y 3.0.0? ¿Y `numpy>=2.5`?
- `~=2.5.0` quiere decir «2.5.0 o más nueva, sin salir de la 2.5»: acepta **2.5.0 y 2.5.7**.
- `>=2.5` acepta **2.5.0, 2.5.7, 2.6.0 y 3.0.0**. La 3.0.0 es una MAYOR: puede romper. Por eso los rangos sin tope son una apuesta.
? [medio] El entorno de pruebas del gateway instala `requirements-dev.txt`: todo el `requirements.txt` (37 paquetes) más pytest y un cliente HTTP, que traen 6 transitivas. ¿Cuántos paquetes tiene el entorno de pruebas? ¿Cuántos de ellos no llegan a la imagen de producción?
- Entorno de pruebas: 37 + 2 + 6 = **45 paquetes**.
- No llegan a producción: 2 + 6 = **8**. La imagen se construye solo con `requirements.txt`.
- Lo importante es lo que sí comparten: las 37 de producción, con las mismas versiones. Así, lo que pasó las pruebas es lo que corre.
? [medio] En una laptop corres `source .venv/bin/activate` y luego `/usr/bin/python3 -m pip install requests`. ¿Dónde se instala requests? ¿Lo ve `python -c "import requests"`?
- Activar solo cambió el PATH. Pero escribiste la ruta completa `/usr/bin/python3`: la shell no busca en el PATH, corre ese Python, el del sistema. Su pip instala **fuera del entorno**: en el Python del sistema, o en tu carpeta de usuario si el del sistema no se deja escribir. Eso, si el PEP 668 lo deja: en Debian, Ubuntu o Homebrew, se niega.
- `python`, con el entorno activado, es `.venv/bin/python`: ve solo el `site-packages` del entorno. **No ve** requests: `ModuleNotFoundError`.
- Con `python -m pip install requests`, sin ruta, se habría instalado en el entorno.
? [medio] Un servicio en CPU tiene una imagen de ≈ 87 MB. Alguien agrega `torch` desde PyPI, con CUDA (≈ 3,000 MB), para una función auxiliar. ¿Cuánto pesa la imagen ahora? Si 10 nodos nuevos la bajan, ¿cuántos GB viajan por la red? ¿Y si usara la wheel de CPU (≈ 196 MB)?
- Con CUDA: 87 + 3,000 ≈ **3,087 MB**, ≈ 35.5 veces más. Diez nodos: 10 × 3.087 GB ≈ **30.9 GB**.
- Con la wheel de CPU: 87 + 196 ≈ **283 MB**; diez nodos, ≈ 2.8 GB.
- Y la pregunta de fondo: si la función auxiliar no necesita la GPU, quizá tampoco necesita torch.
? [medio] Con la calculadora del rebuild: un proyecto tiene 37 paquetes, y cada uno saca en un mes una versión nueva dentro de su rango con probabilidad de 5 % (un supuesto). ¿Qué tan probable es que reconstruir sin lock, un mes después, instale algo distinto? ¿Y con un lock con hashes?
- Que no cambie ninguno: 0.95³⁷ ≈ 0.15. Que cambie al menos uno: 1 − 0.15 ≈ **85 %**.
- Con lock y hashes: **0 %**. Se instalan los mismos archivos; si uno cambiara, pip lo rechazaría.
- Aun con un supuesto bajo, sin lock lo normal es que algo cambie.
? [reto] El gateway funciona en la Mac de quien lo escribió. En el contenedor arranca con un error que empieza así: «A module that was compiled using NumPy 1.x cannot be run in NumPy 2.5.3». ¿Qué pasó, y en qué orden lo revisas?
- El mensaje dice que una **extensión nativa** se compiló contra NumPy 1.x y ahora encontró NumPy 2: la MAYOR que cambió la interfaz binaria. Alguna dependencia trae una wheel vieja, o pide un rango que dejó entrar a NumPy 2.
- Primero, qué hay instalado de verdad: `python -m pip freeze` dentro del contenedor, y `importlib.metadata.requires()` del sospechoso, para ver qué rango de NumPy pide.
- Segundo, comparar con la laptop: si allá hay NumPy 1.26, el entorno de la laptop no salió del lock (alguien instaló a mano).
- El arreglo: elegir la combinación que funciona (subir el paquete que se compiló contra 1.x, o fijar `numpy<2` si aún no hay versión nueva), regenerar el lock, correr las pruebas y construir la imagen desde el lock. Nunca «arreglarlo» con un `pip install` dentro del contenedor que está corriendo.
? [reto] El job de entrenamiento de C01 necesita torch con CUDA; el gateway, no. Los dos usan el mismo preprocesamiento con Pillow. ¿Cómo organizas sus dependencias, sus locks y sus imágenes para que el resize sea idéntico y cada imagen pese lo justo?
- **Dos entornos, dos locks, dos imágenes.** El del entrenamiento lleva torch con CUDA (gigas); el del gateway, solo lo que importa `app/` (≈ 87 MB).
- **Lo compartido, fijado igual en los dos:** `pillow==12.3.0` y NumPy con la misma versión, y el preprocesamiento como un solo módulo que los dos importan.
- **Una prueba que lo vigile:** una [[prueba-paridad|prueba de paridad]] del preprocesamiento: las mismas fotos, por los dos entornos, deben dar tensores iguales dentro de una tolerancia. Si alguien sube Pillow en un lock y no en el otro, la prueba falla antes de llegar a producción.
- Cada lock se actualiza a propósito, con su propia revisión.
:::

## Lo que sigue {What comes next}

**En la Ronda:**

- **M05 · Contenedores** arma la imagen del gateway: el entorno en `/opt/venv` con las 37 dependencias, `--only-binary`, slim contra Alpine (musl), torch de CPU contra CUDA y por qué un requirements sin lock no reproduce nada.
- **M07 · Servidores de modelos** escribe el servicio con FastAPI y pydantic, y anota con qué versiones se probó cada pieza: «FastAPI 0.141, Starlette 1.7 y torch 2.14». Esas versiones son parte del resultado.
- **M10 · MLOps** pide, para reproducir un modelo, dependencias fijadas e imagen por digest, y cuenta el caso del valor por omisión que cambió entre dos versiones.
- **M15 · Seguridad** vuelve al lock con hashes como defensa de la cadena de suministro.

**En el Dojo:** la estación 7, «Empaquetado (Docker)», construye la imagen del gateway con este mismo `/opt/venv`; ahí vas a ver sus capas y lo que pesa cada una. La estación 6, «Código de serving», usa FastAPI y pydantic.

**En Sensei:** la siguiente lección, «PyTorch en lo que toca a producción», instala torch y lo usa de verdad. Después vienen «Git: versiones del código», donde se guardan el `pyproject.toml` y el lock; «Pruebas y CI/CD», donde pytest corre sobre el entorno instalado del lock; y «Configuración: YAML, variables de entorno y secretos», con pydantic-settings.

## Palabras que vas a oír {Words you will hear}

Estos son los conceptos que presentó esta lección. Cada uno tiene su tarjeta con la definición completa.

:::conceptos
modulo-python paquete-python biblioteca-estandar pip pypi wheel extension-nativa dependencia dependencia-transitiva version-semantica lock-file entorno-virtual conda uv pyproject type-hints pydantic
:::

## Chequeo {Check}

Intenta responder en tu cabeza antes de abrir cada respuesta.

:::chequeo
? ¿Dónde busca Python un módulo cuando haces import, y por qué un json.py tuyo le gana al de la biblioteca estándar?
En las carpetas de `sys.path`, en orden: la del script, las de `PYTHONPATH`, la biblioteca estándar y `site-packages`. Gana la primera que lo tenga. `python -I` deja fuera la del script.
? ¿Qué diferencia hay entre una wheel y un sdist?
La wheel es un zip ya armado: instalarla es copiar. El sdist es el código fuente: pip tiene que construirlo, a veces con un compilador. Una wheel con código compilado sirve solo para la plataforma de su nombre.
? ¿Por qué el mismo numpy==2.5.3 son archivos distintos en una Mac y en el contenedor?
Porque NumPy trae una extensión nativa: código compilado para un sistema, un chip y una versión de Python. La Mac baja la wheel macosx_arm64 y el contenedor, la manylinux_x86_64.
? ¿Qué es una dependencia transitiva? Da un número del gateway.
Un paquete que llega porque lo pide algo que tú pediste. El gateway pide 9 y le llegan 37: 28 son transitivas, como Starlette y pydantic.
? ¿Qué dice el pyproject.toml y qué dice el lock file?
El pyproject dice lo que aceptas: las directas, con rangos. El lock dice lo que instalas: todo el árbol, versiones exactas y hashes. Producción instala del lock.
? ¿Qué hace de verdad «activar» un entorno virtual?
Pone su carpeta bin al principio del PATH, para que python y pip sean los del entorno. El entorno es una carpeta con su site-packages y un enlace al Python de base.
? ¿Por qué una imagen con PyTorch pesa gigas y la del gateway menos de 100 MB?
torch con CUDA trae las librerías de NVIDIA: ≈ 3 GB de wheels, contra ≈ 196 MB solo para CPU. El gateway no importa torch: manda el tensor a Triton, y su imagen es la base slim más 37 dependencias, ≈ 87 MB.
:::
