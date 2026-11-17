"""Arma content/estaciones/c01-entrenamiento.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e3 && bash probar-fallas.sh /tmp/e3     # deja /tmp/e3.log y /tmp/e3-fallas.log
    python3 contenido.py /tmp/e3                                 # escribe el JSON con esas salidas

Ninguna salida se copia a mano: cada `salida` sale de una sección «### nombre» de los logs.
"""
import json
import re
import sys
from pathlib import Path

CARPETA = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 contenido.py <carpeta de probar.sh>")
SOL = Path(__file__).resolve().parent
APP = SOL.parent.parent
LOG = Path(f"{CARPETA}.log").read_text()
LOGF = Path(f"{CARPETA}-fallas.log").read_text() if Path(f"{CARPETA}-fallas.log").exists() else ""
RUTA = str(CARPETA)


def L(nombre: str, log: str = None, filtro=None, max_lineas=None, quitar=None) -> str:
    log = LOG if log is None else log
    m = re.search(r"^### " + re.escape(nombre) + r"\n(.*?)(?=^### |\Z)", log, re.S | re.M)
    if not m:
        sys.exit(f"no está la sección «{nombre}»")
    lineas = m.group(1).rstrip("\n").replace(RUTA, "~/c01-entrenamiento").splitlines()
    lineas = [l for l in lineas if "View run" not in l and "View experiment" not in l and "mlflow.store.model_registry" not in l]
    if filtro:
        lineas = [l for l in lineas if re.search(filtro, l)]
    if quitar:
        lineas = [l for l in lineas if not re.search(quitar, l)]
    if max_lineas:
        lineas = lineas[:max_lineas]
    return "\n".join(lineas).rstrip()


def F(nombre, **kw):
    return L(nombre, LOGF, **kw)


def code(rel: str) -> str:
    return (SOL / rel).read_text().rstrip("\n")


def trozo(rel: str, desde: str, hasta: str | None = None) -> str:
    """Las líneas de un archivo de la solución entre la que empieza con `desde` y la anterior a la que empieza con `hasta`."""
    lineas = code(rel).splitlines()
    i = next(k for k, l in enumerate(lineas) if l.startswith(desde))
    j = next((k for k, l in enumerate(lineas) if k > i and hasta and l.startswith(hasta)), len(lineas))
    return "\n".join(lineas[i:j]).rstrip()


def cmd(code_, salida, nota="", donde="mac"):
    return {"code": code_, "nota": nota, "donde": donde, "salida": salida}


def num(nombre: str, rx: str, log: str = None) -> str:
    m = re.search(rx, L(nombre, log))
    if not m:
        sys.exit(f"no encuentro {rx} en «{nombre}»")
    return m.group(1)


V = "python verificar.py"
E = "python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1"

# Números que el texto cita, sacados de los logs
VAL_CHAMPION = num("p0 crear", r"@champion · val_top1 (\S+)")
VAL_A1 = num("p3 entrenar", r"✓ a-mano-1 · val_top1 (\S+)")
VAL_CERO = num("p4 desde cero", r"✓ desde-cero · val_top1 (\S+)")
EPOCA_S = num("p3 entrenar", r"época 1/3 .*· (\d+\.\d) s")
PARAMS = num("pc pesos", r"^([\d,]+) parámetros")
CKPT_KB = num("p5 checkpoint", r"^(\d+) kB")
SIGMA = num("p7 ruido", r"σ de 5 semillas = (\S+)")
TAU = num("p7 ruido", r"τ = 3σ = (\S+)")
DESDE_CAIDA = num("p5 reanudar", r"desde el paso (\d+)")
DESDE_ORQ = num("p6 orquestador", r"reanudo wf-\S+ desde el paso (\d+)")

e = {
    "id": "entrenamiento", "patron": "sincrono", "caso": "c01", "num": 3,
    "titulo": "Entrenamiento", "nav": "Entrenamiento",
    "pregunta": "¿Cómo se vuelve tu notebook de fine-tuning un job que corre solo cada mes y se puede reproducir?",
    "version": "2026-11-17",
}

e["mapa"] = {
    "resumen": "La estación 2 deja el snapshot <code>ds-2026-09-01</code>. Esta lo convierte en un <b>checkpoint candidato</b> con su corrida anotada en MLflow. No es «correr un notebook»: es un <b>job</b> que lanza el orquestador cada mes en una GPU que se prende y se apaga, que arranca de los pesos del modelo en producción (el champion), que guarda su estado cada tanto para sobrevivir a la caída de su máquina y que deja escrito todo lo necesario para repetirlo: el snapshot, el commit, la receta, el entorno y la semilla. Antes de gastar GPU, una prueba de un minuto confirma que el código aprende. Y al final hay una regla para saber si una diferencia contra otra corrida es una regresión o es ruido. La estación 4 decide si el candidato es mejor.",
    "entra": [
        "el id del snapshot, <code>ds-2026-09-01</code>, como parámetro (nunca «el más nuevo»)",
        "el champion: el modelo que hoy está en producción, por su número de versión en el registro",
        "la receta del entrenamiento (<code>receta.yaml</code>) y el código, en un commit",
        "el preprocess del gateway y su versión de Pillow (en C01, además, la imagen de entrenamiento por su digest)",
    ],
    "sale": [
        "el checkpoint candidato: los pesos y su <code>labels.json</code>, como artefactos de una corrida de MLflow",
        "la corrida en MLflow: parámetros, la curva de <code>val_top1</code> por época y los punteros (snapshot, commit, entorno, champion, receta)",
        "checkpoints intermedios en S3, para reanudar si se cae la máquina",
        "el ruido entre semillas medido, y una regla escrita para comparar corridas",
    ],
    "escala": [
        {"que": "Fotos de entrenamiento", "c01": "1,840,211 de train y 92,417 de validación", "taller": "6,999 de train y 1,524 de validación (las 10,000 de prueba de Fashion-MNIST, menos el golden set y lo posterior al corte)"},
        {"que": "La red", "c01": "ResNet-50 de torchvision, ≈ 25.6 millones de parámetros, 500 categorías", "taller": f"Una ResNet chica (<code>mundo/arquitectura.py</code>), {PARAMS} parámetros, 10 categorías"},
        {"que": "Dónde corre", "c01": "1 GPU A10G on-demand (g5.xlarge) en un pod de EKS, que se apaga al terminar", "taller": "La CPU de tu Mac"},
        {"que": "Cuánto tarda", "c01": "≈ 3–4 horas", "taller": f"≈ 25 segundos (≈ {EPOCA_S} s por época, más cargar las fotos y evaluar)"},
        {"que": "Checkpoint", "c01": "≈ 300 MB (pesos + Adam) cada 15 minutos en S3", "taller": f"≈ {CKPT_KB} kB cada 25 pasos en el S3 local (RustFS)"},
        {"que": "Registro", "c01": "MLflow con Postgres (metadatos) y S3 (archivos)", "taller": "MLflow en Docker, con SQLite y un volumen"},
        {"que": "Quién lo lanza", "c01": "El orquestador (Argo Workflows, Kubeflow o Airflow), cada mes", "taller": "<code>mundo/orquestador.py</code>, cuando tú lo corres"},
    ],
    "hoja": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento",
}

e["precalculos"] = {
    "intro": "Antes de escribir el job, las cuentas de servilleta del entrenamiento: cuántos pasos tiene una corrida, cuánto tarda, cuánto cuesta, qué pérdida esperas al empezar, cuánto pesa un checkpoint, cada cuánto guardarlo y cuánto se puede mover una métrica por puro azar. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "pasos", "pregunta": "¿Cuántos pasos tiene una corrida?",
            "formula": "pasos por época = fotos de train ÷ batch (redondeado hacia arriba); pasos = pasos por época × épocas",
            "c01": {"cuenta": "1,840,211 ÷ 64 = 28,754 pasos por época × 8 épocas", "valor": "≈ 230,000 pasos"},
            "taller": {"cuenta": "6,999 ÷ 64 = 110 pasos por época × 3 épocas", "valor": "330 pasos"},
            "decide": "Los pasos son el reloj del entrenamiento: el programador del learning rate (OneCycle) necesita el total de antemano, y «cada cuántos pasos guardo un checkpoint» se mide contra ese total.",
            "conceptos": ["receta"],
            "comprueba": cmd("python -c \"\nimport math, sys; sys.path.insert(0, '.')\nfrom mundo.comun import receta, s3, tarjeta\nn, r = tarjeta(s3(), 'ds-2026-09-01')['counts']['train'], receta()\np = math.ceil(n / r['batch'])\nprint(f\\\"{n} fotos de train ÷ batch {r['batch']} = {p} pasos por época · × {r['epocas']} épocas = {p * r['epocas']} pasos\\\")\"", L("pc pasos")),
        },
        {
            "id": "tiempo", "pregunta": "¿Cuánto tarda una corrida?",
            "formula": "tiempo = fotos de train × épocas ÷ fotos por segundo",
            "c01": {"cuenta": "1,840,211 × 8 ÷ ≈ 1,000–1,400 fotos/s (una A10G con precisión mixta)", "valor": "≈ 3–4 horas"},
            "taller": {"cuenta": f"6,999 × 3 ÷ ≈ {round(6999 / float(EPOCA_S)):,} fotos/s (la CPU de tu Mac, medida en el paso 3)", "valor": f"≈ {3 * float(EPOCA_S):.0f} s de entrenar, ≈ 25 s con cargar las fotos y evaluar"},
            "decide": "Horas de GPU no se gastan para descubrir un error de código: por eso va primero la prueba de humo, que cuesta segundos. Y en 4 horas la máquina se puede caer: por eso hay checkpoints.",
            "conceptos": ["job", "gpu-efimera"],
            "confirma": f"el paso 3: cada época tarda ≈ {EPOCA_S} s en tu Mac.",
        },
        {
            "id": "costo", "pregunta": "¿Cuánto cuesta una corrida?",
            "formula": "costo = (horas de entrenar + horas de evaluar) × precio de la máquina por hora",
            "c01": {"cuenta": "(3 a 4 h + ≈ 0.25 h) × US$1.006 por hora (g5.xlarge on-demand)", "valor": "≈ US$3.3–4.3 por corrida"},
            "taller": {"cuenta": "≈ 1 minuto de la CPU de tu Mac", "valor": "US$0"},
            "decide": "Entrenar es de lo más barato del sistema: unos pocos dólares al mes, contra cientos de dólares de las GPUs que sirven. Lo caro es una corrida que no sirve (código roto, datos equivocados) y la persona que la revisa. Ahorrar la mitad con máquinas spot no compensa la complejidad a esta escala.",
            "conceptos": ["gpu-efimera"],
            "confirma": "el paso 6: el orquestador pide la GPU solo para el paso de entrenar, y la libera al terminar.",
        },
        {
            "id": "l0", "pregunta": "¿Qué pérdida esperas en el primer paso, antes de aprender nada?",
            "formula": "pérdida inicial ≈ ln(K), con K = número de categorías (la red reparte la probabilidad casi igual entre todas)",
            "c01": {"cuenta": "ln(500)", "valor": "≈ 6.21"},
            "taller": {"cuenta": "ln(10)", "valor": "≈ 2.30"},
            "decide": "Es una revisión gratis del primer paso. Si sale mucho menor, la etiqueta se coló en la entrada. Si sale mucho mayor, algo está mal en la escala de la cabeza. Es aproximada: sirve para atrapar errores grandes.",
            "conceptos": ["perdida-inicial", "prueba-humo"],
            "comprueba": cmd("python -c \"import math; print(f'ln(500) = {math.log(500):.2f} · ln(10) = {math.log(10):.2f}')\"", L("pc l0")),
            "confirma": "el paso 2: la prueba de humo arranca con pérdida 2.311.",
        },
        {
            "id": "peso-ckpt", "pregunta": "¿Cuánto pesa un checkpoint?",
            "formula": "pesos = parámetros × 4 bytes (float32); con Adam se guardan además 2 promedios por parámetro: ≈ parámetros × 12 bytes",
            "c01": {"cuenta": "≈ 25.6 M × 4 B = ≈ 100 MB de pesos, × 3 con Adam", "valor": "≈ 300 MB"},
            "taller": {"cuenta": f"{PARAMS} × 12 B, más los BatchNorm, el estado del azar y el orden de las fotos de la época", "valor": f"≈ {CKPT_KB} kB medidos"},
            "decide": "Un checkpoint no son solo los pesos: sin los promedios de Adam, el programador y el azar, reanudar es empezar otra corrida parecida. A 300 MB, escribirlo a S3 tarda unos segundos.",
            "conceptos": ["checkpoint"],
            "comprueba": cmd("python -c \"\nimport sys; sys.path.insert(0, '.')\nfrom mundo.arquitectura import construir_modelo\nn = sum(p.numel() for p in construir_modelo(10).parameters())\nprint(f'{n:,} parámetros × 4 bytes = {n * 4 / 1e3:.0f} kB de pesos · más los 2 promedios de Adam = {n * 12 / 1e3:.0f} kB')\"", L("pc pesos")),
            "confirma": f"el paso 5: el checkpoint en S3 pesa {CKPT_KB} kB.",
        },
        {
            "id": "cada-cuanto", "pregunta": "¿Cada cuánto guardar un checkpoint?",
            "formula": "lo que pierdes en una caída ≤ el intervalo; lo que te cuesta = checkpoints × segundos por checkpoint",
            "c01": {"cuenta": "cada 15 min de ≈ 240 min: 16 checkpoints × ≈ 3 s (300 MB a ≈ 100 MB/s)", "valor": "pierdes ≤ 15 min (≈ 6 %) y gastas ≈ 0.3 % del tiempo en guardar"},
            "taller": {"cuenta": "cada 25 pasos de 330: 13 checkpoints de ≈ 640 kB", "valor": f"pierdes ≤ 25 pasos (≈ 8 %, ≈ {25 * float(EPOCA_S) / 110:.1f} s) y guardar casi no se nota"},
            "decide": "<code>ckpt_cada_pasos: 25</code> en la receta. Guardar muy seguido frena el entrenamiento; guardar muy poco vuelve cada caída una corrida perdida. <code>verificar.py</code> pide perder a lo más el 20 %.",
            "conceptos": ["checkpoint", "reanudar"],
            "confirma": f"el paso 5: una caída a los 15 s reanuda desde el paso {DESDE_CAIDA}.",
        },
        {
            "id": "ruido", "pregunta": "¿Cuánto se mueve la exactitud de validación solo por qué fotos tocaron en el examen?",
            "formula": "ε = 1.96 × √(a × (1 − a) ÷ G), con a = exactitud como fracción y G = fotos del examen (95 % de confianza)",
            "c01": {"cuenta": "1.96 × √(0.85 × 0.15 ÷ 92,417)", "valor": "± 0.23 puntos"},
            "taller": {"cuenta": "1.96 × √(0.85 × 0.15 ÷ 1,524)", "valor": "± 1.79 puntos"},
            "decide": "Con un examen chico, una diferencia de medio punto no dice nada. Además del ruido del examen está el del entrenamiento (otra semilla, otro modelo): ese se mide entrenando varias veces, en el paso 7.",
            "conceptos": ["ruido-evaluacion", "ruido-semillas"],
            "comprueba": cmd("python -c \"\nimport math\nfor nombre, a, G in [('C01, val de 92,417', 0.85, 92417), ('dojo, val de 1,524', 0.85, 1524)]:\n    print(f'{nombre}: ε = 1.96 × √({a} × {1 - a:.2f} ÷ {G:,}) = ± {196 * math.sqrt(a * (1 - a) / G):.2f} puntos')\"", L("pc ruido")),
            "confirma": f"el paso 7: entre 5 semillas, σ = {SIGMA} puntos.",
        },
    ],
}

conceptos = [
    {"id": "job", "termino": "Job de entrenamiento", "en": "training job",
     "def": "Un programa que arranca, entrena y termina solo, en una máquina que existe mientras dura, lanzado por el pipeline y no por una persona.",
     "analogia": "Un notebook es la cocina de tu casa: pruebas, ajustas, nadie más lo repite. Un job es la receta impresa de un restaurante: cualquiera la sigue igual cada vez.",
     "importa": "Lo que va a producción tiene que salir de algo que se puede repetir: código en un commit, datos por id y una receta escrita. Un notebook tiene celdas fuera de orden y archivos locales.",
     "trampa": "«El mejor modelo salió de mi notebook». Si nadie lo puede repetir, no es candidato: los candidatos salen solo del pipeline."},
    {"id": "receta", "termino": "La receta", "en": "training config",
     "def": "El archivo con los números que deciden el entrenamiento: arranque, épocas, batch, learning rate, semilla y cada cuánto guardar. Vive en el repo y va en cada commit.",
     "analogia": "La ficha técnica de un platillo: gramos, tiempos y temperatura. Si alguien la cambia, cambia el platillo, aunque la cocina sea la misma.",
     "importa": "Cambiar la receta es cambiar el modelo. Por eso la corrida anota su huella (<code>receta_sha256</code>) y el código la lee del archivo, sin números copiados en los scripts.",
     "trampa": "Probar «solo un número» editando el archivo y entrenando sin commit. El linaje diría «commit tal», y ese commit tiene otra receta."},
    {"id": "skew", "termino": "Training-serving skew", "en": "training-serving skew",
     "def": "Cuando el modelo ve las fotos de una forma al entrenar y de otra en producción: otro resize, otra normalización u otra versión de la librería que decodifica.",
     "analogia": "Estudiar para el examen con lentes y presentarlo sin ellos: sabes lo mismo, pero ves distinto.",
     "importa": "No da ningún error: la exactitud en producción sale unos puntos más baja que la de validación, y nadie sabe por qué. Se evita por construcción: el entrenamiento importa el mismo <code>preprocess.py</code> del gateway y usa la misma versión de Pillow.",
     "trampa": "Copiar el preprocess «igualito» en el código de entrenamiento. Dos copias se separan con el tiempo; la única forma segura es importar la misma."},
    {"id": "prueba-humo", "termino": "Prueba de humo: sobreajustar un batch", "en": "overfit one batch",
     "def": "Entrenar una y otra vez con un solo batch de 32 fotos: un código sano las memoriza (pérdida casi cero, 32 de 32). Si no, algo está roto.",
     "analogia": "Antes de un viaje largo, prendes el coche y das una vuelta a la cuadra. Si no arranca, no sales a carretera.",
     "importa": "Un optimizador que no recibe los pesos, un learning rate en cero o etiquetas desalineadas no tiran el programa: corre horas y no aprende. Esta prueba lo ve en segundos, antes de pedir la GPU.",
     "trampa": "Usar un learning rate fijo en la prueba en vez del de la receta: así no atrapa una receta rota."},
    {"id": "perdida-inicial", "termino": "La pérdida al empezar", "en": "initial loss ≈ ln K",
     "def": "Con pesos al azar, la red reparte la probabilidad casi igual entre las K categorías, y la entropía cruzada del primer paso sale ≈ ln(K).",
     "analogia": "Un examen de opción múltiple contestado al azar: con 4 opciones aciertas ≈ 1 de 4. Si alguien que no estudió saca 10, vio las respuestas.",
     "importa": "Es una revisión gratis: con 10 categorías esperas ≈ 2.30. Mucho menos sugiere que la etiqueta se coló en la entrada; mucho más, un problema en la escala de la cabeza.",
     "trampa": "Tomarla como regla exacta. Es aproximada: sirve para errores grandes."},
    {"id": "semilla", "termino": "Semilla y determinismo", "en": "seed, deterministic algorithms",
     "def": "La semilla fija todo el azar del entrenamiento (pesos iniciales, orden de las fotos, augmentation). Con algoritmos deterministas, mismos ingredientes dan los mismos pesos, bit por bit.",
     "analogia": "Barajar con la misma «mano» siempre: si sabes cómo empezó, sabes cómo termina.",
     "importa": "En la CPU de tu Mac, dos corridas iguales dan la misma huella de pesos: así compruebas que reanudar no cambió nada. En la GPU de C01 no pasa (cuDNN y las sumas en paralelo cambian los últimos bits): ahí reproducible es «mismo resultado dentro del ruido».",
     "trampa": "«Fijé la semilla, así que es reproducible». Hacen falta los cinco ingredientes, y en GPU ni así es bit a bit."},
    {"id": "warm-start", "termino": "Arrancar del champion", "en": "warm start",
     "def": "Empezar el entrenamiento con los pesos del modelo que hoy está en producción (el champion) en lugar de pesos al azar.",
     "analogia": "Para la edición nueva de un libro no lo escribes desde cero: partes de la anterior y corriges.",
     "importa": "El modelo ya sabe casi todo y bastan pocas épocas: es lo que hace C01 cada mes. El costo: el modelo de octubre depende también del de septiembre, así que la corrida anota de qué versión arrancó.",
     "trampa": "Arrancar de un champion cuyas categorías están en otro orden. La salida 0 dejó de ser «playeras» y no truena nada: por eso se compara su <code>labels.json</code> antes."},
    {"id": "alias-version", "termino": "Alias y versión en el registro", "en": "model registry alias vs version",
     "def": "Cada modelo registrado tiene versiones con número fijo (v1, v2…) y aliases que se mueven (<code>@champion</code>). El orquestador resuelve el alias una vez y el job recibe el número.",
     "analogia": "«El gerente» es un alias; «Ana López» es la persona. Si el gerente cambia a media junta, la junta sigue con Ana.",
     "importa": "Si cada reintento resolviera <code>@champion</code>, un alias que se movió a media corrida mezclaría dos modelos en la misma corrida. Con el número, la corrida sabe exactamente de dónde arrancó.",
     "trampa": "Pasar <code>@champion</code> o «latest» al job: por eso <code>entrenar.py</code> exige un número."},
    {"id": "tracking", "termino": "Registro de experimentos", "en": "experiment tracking (MLflow)",
     "def": "Un servidor donde cada entrenamiento deja su corrida: parámetros, métricas por época, archivos (artefactos) y etiquetas (tags) con sus punteros.",
     "analogia": "La bitácora de un laboratorio, compartida y con buscador: qué se probó, con qué, y qué salió.",
     "importa": "Meses después contesta «¿con qué se entrenó?» y «¿por qué este salió distinto?» sin preguntarle a nadie. En C01 es MLflow con Postgres y S3; aquí, el mismo MLflow en Docker.",
     "trampa": "Anotar solo la métrica final. Sin la curva por época, los punteros y el archivo de pesos, la corrida no se puede auditar ni repetir."},
    {"id": "cinco-ingredientes", "termino": "Los cinco ingredientes", "en": "reproducibility: code, data, config, environment, seed",
     "def": "Para repetir un entrenamiento hacen falta cinco cosas fijas: el código (commit), los datos (snapshot y su huella), la receta, el entorno (en C01 el digest de la imagen) y la semilla.",
     "analogia": "Un pastel sale igual si repites la receta, los ingredientes, el horno, el molde y el tiempo. Cambias uno y ya es otro pastel.",
     "importa": "Cada corrida los anota como tags. Si dos corridas con la «misma receta» difieren más que el ruido, comparas sus cinco ingredientes y casi siempre aparece la diferencia.",
     "trampa": "Entrenar con cambios sin commit: el commit anotado no es el código que corrió."},
    {"id": "amp", "termino": "Precisión mixta", "en": "AMP, automatic mixed precision",
     "def": "Hacer la mayoría de las cuentas en números de 16 bits en vez de 32, que la GPU procesa mucho más rápido, guardando los pesos en 32.",
     "analogia": "Hacer las cuentas de borrador con dos decimales y pasar en limpio solo el resultado.",
     "importa": "En la A10G de C01 casi duplica la velocidad y baja la memoria. En la CPU de tu Mac no acelera, por eso la receta del dojo trae <code>amp: false</code>.",
     "trampa": "Prenderla sin su GradScaler en float16: los gradientes muy chicos se vuelven cero y el modelo deja de aprender sin avisar."},
    {"id": "checkpoint", "termino": "Checkpoint completo", "en": "training checkpoint",
     "def": "Un archivo con todo el estado del entrenamiento en un momento: pesos, estado del optimizador (los promedios de Adam), programador del learning rate, época, paso y el estado del azar.",
     "analogia": "Guardar la partida de un videojuego: no solo dónde estás, también tu inventario y la hora del día. Si solo guardaras la posición, volverías sin nada.",
     "importa": "Es lo que vuelve un reintento una continuación. En C01 pesa ≈ 300 MB y se guarda cada 15 minutos en S3, en una ruta con el nombre de la corrida.",
     "trampa": "Guardar solo los pesos. Reanudar «funciona», pero sale otro modelo: Adam empieza de cero, el learning rate vuelve al inicio y el orden de las fotos cambia."},
    {"id": "reanudar", "termino": "Reanudar la misma corrida", "en": "resume from checkpoint",
     "def": "Cuando el job vuelve a arrancar con el mismo id de corrida, busca su checkpoint, carga todo y sigue desde el paso siguiente, en la misma corrida de MLflow.",
     "analogia": "Retomar un libro en la página donde dejaste el separador, no en la que crees que ibas.",
     "importa": "Una caída en la hora 3 cuesta minutos, no horas. Y en CPU puedes comprobarlo: la corrida reanudada termina con los mismos pesos, bit por bit, que una sin caída.",
     "trampa": "Reanudar un checkpoint de otra receta u otro snapshot. Por eso el checkpoint guarda sus ingredientes y el job los compara antes de cargarlo."},
    {"id": "orquestador", "termino": "Orquestador de pipelines", "en": "pipeline orchestrator (Argo Workflows, Kubeflow, Airflow)",
     "def": "Un sistema que corre una receta de pasos en orden (un DAG), cada uno en su contenedor, con parámetros, reintentos e historial, por calendario o por evento.",
     "analogia": "El supervisor de una línea de producción: arranca cada estación en orden, si una falla la repite y lo anota todo.",
     "importa": "Tú escribes la definición (<code>pipeline.yaml</code>); él la ejecuta cada mes sin que nadie lance nada a mano. Aquí <code>mundo/orquestador.py</code> hace lo mismo en chico.",
     "trampa": "Creer que el orquestador «arregla» un job que no reanuda: si el job no guarda checkpoints, cada reintento empieza de cero."},
    {"id": "reintento", "termino": "Reintentos con el mismo id", "en": "retry policy",
     "def": "Si un paso falla, el orquestador espera y lo vuelve a lanzar, hasta N veces, con los mismos parámetros y el mismo id de corrida.",
     "analogia": "Si se cae la llamada, vuelves a marcar el mismo número; no llamas a otra persona.",
     "importa": "Una máquina perdida, un error de red o un S3 que falla una vez no tiran el pipeline del mes. En C01: hasta 3 reintentos, 120 s entre cada uno.",
     "trampa": "Un reintento con un id nuevo: no encuentra su checkpoint y empieza de cero, o deja dos corridas a medias en MLflow."},
    {"id": "gpu-efimera", "termino": "GPU que se prende y se apaga", "en": "on-demand GPU node",
     "def": "La máquina con GPU existe solo mientras dura el paso de entrenar: el orquestador la pide, el contenedor corre y se libera al terminar.",
     "analogia": "Rentar un taladro el día que lo usas en vez de tenerlo en la casa todo el año.",
     "importa": "Nadie deja una GPU de entrenamiento prendida «por si acaso». Las de producción (las que sirven) no se usan para entrenar: tienen trabajo y son más lentas para esto.",
     "trampa": "Usar máquinas spot (más baratas, pero se las pueden llevar) sin checkpoints: cada interrupción es una corrida perdida."},
    {"id": "ruido-semillas", "termino": "Ruido entre semillas", "en": "seed variance",
     "def": "Cuánto cambia la métrica de la misma receta cuando solo cambia la semilla. Se mide entrenando varias veces y sacando la desviación estándar (σ).",
     "analogia": "Tirar el mismo dado varias veces: no siempre sale igual, y eso no quiere decir que el dado cambió.",
     "importa": "Con σ medida, la regla es: una diferencia de más de 3σ (τ) probablemente es real; menos que eso, es azar. Así no celebras una mejora de ruido ni detienes nada por una caída de ruido.",
     "trampa": "Medir σ con una receta y usarla para otra: si cambias el batch, el learning rate o la red, se vuelve a medir."},
    {"id": "ruido-evaluacion", "termino": "Ruido del examen", "en": "evaluation noise (confidence interval)",
     "def": "Cuánto se movería la exactitud medida solo por qué fotos tocaron en la validación: ε = 1.96 × √(a(1 − a)/G).",
     "analogia": "Una encuesta de 1,500 personas tiene más margen de error que una de 90,000.",
     "importa": "Con 92,417 fotos de validación (C01), ε ≈ ± 0.23 puntos; con 1,524 (el dojo), ≈ ± 1.8. Una diferencia más chica que eso no se puede leer.",
     "trampa": "Comparar dos modelos en exámenes distintos: el ruido se suma y la comparación no vale. El examen fijo es la estación 4."},
]
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 el 1 de octubre de 2026, a las 03:00 UTC, cuando arranca el pipeline del mes. En el S3 local están las fotos (las 10,000 de prueba de Fashion-MNIST, como fotos del marketplace) y los snapshots de agosto y septiembre que dejó la estación 2. En MLflow está el champion de septiembre, ya registrado. Tú escribes el job: leer el snapshot, la prueba de humo, el entrenamiento con checkpoints y su registro, el pipeline para el orquestador y la comparación entre corridas. Todo corre con un entorno virtual de Python y dos contenedores.",
    "trae": [
        {"que": "El S3 local y MLflow (compose.yaml)", "detalle": "RustFS en el puerto 9400 (buckets <code>fotos</code>, <code>ml-datos</code> y <code>ml-ckpt</code>) y el servidor de MLflow en el 5400, con su interfaz."},
        {"que": "mundo/crear.py", "detalle": f"Crea todo en ≈ 1 minuto: baja Fashion-MNIST (≈ 4.4 MB), sube las 10,000 fotos, publica <code>ds-2026-08-01</code> y <code>ds-2026-09-01</code> y entrena el champion de septiembre ({VAL_CHAMPION} en validación), registrado como <code>classifier</code> v1 <code>@champion</code>."},
        {"que": "mundo/gateway/", "detalle": "El <code>preprocess.py</code> del gateway (la estación 6), sus versiones (<code>requirements.txt</code>) y <code>paridad.json</code>: la huella del tensor que saca el gateway para 16 fotos."},
        {"que": "mundo/arquitectura.py", "detalle": f"La red: una ResNet chica de {PARAMS} parámetros. En C01 viene de torchvision; aquí, de este archivo."},
        {"que": "mundo/orquestador.py", "detalle": "Corre tu <code>pipeline.yaml</code> como DAG: resuelve <code>@champion</code> una vez, pide la «GPU», reintenta y anota en <code>historial/</code>. Con <code>--apagon</code> simula que se pierde la máquina."},
        {"que": "mundo/modelos.py y mundo/s3.py", "detalle": "Mirar y reparar el registro de modelos (versiones, aliases, corridas) y mirar el S3 (llaves, tarjetas, checkpoints)."},
        {"que": "receta.yaml", "detalle": "La receta del equipo: arranque desde el champion, 3 épocas, batch 64, lr 0.003, semilla 17, checkpoint cada 25 pasos."},
        {"que": "verificar.py y romper.py", "detalle": "12 checks con los criterios de «listo» y 6 fallas en el mundo, la configuración, el entorno o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/datos.py", "hace": "Leer un snapshot por id, comprobando cada huella, y pasar cada foto por el preprocess del gateway."},
        {"archivo": "pipeline/humo.py", "hace": "La prueba de humo: memorizar 32 fotos con la receta de verdad."},
        {"archivo": "pipeline/entrenar.py", "hace": "El job: árbol limpio, champion por versión, semilla, checkpoints, reanudar y la corrida en MLflow."},
        {"archivo": "pipeline.yaml", "hace": "El pipeline como DAG para el orquestador: humo → entrenar, con GPU y reintentos."},
        {"archivo": "pipeline/comparar.py", "hace": "¿Regresión o ruido? Δ contra 3σ de las semillas."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 700 MB libres para las imágenes de RustFS y MLflow",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 1.1 GB para el entorno virtual (PyTorch)",
        "git (con tu nombre y correo configurados)",
        "Internet la primera vez (los paquetes, las imágenes y Fashion-MNIST)",
        "Los puertos 9400, 9401 y 5400 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "Una GPU A10G on-demand (g5.xlarge) en un nodo de EKS", "local": "La CPU de tu Mac", "diferencia": "Más lenta, pero determinista: dos corridas iguales dan los mismos pesos, bit por bit. En GPU no pasa (cuDNN), y reproducible quiere decir «dentro del ruido»."},
        {"nube": "ResNet-50 de torchvision (≈ 25.6 M parámetros)", "local": f"La ResNet chica de <code>mundo/arquitectura.py</code> ({PARAMS} parámetros)", "diferencia": "La misma idea (tallo, bloques con atajo, cabeza), con fotos de 32×32 en vez de 224×224, para que una época tarde segundos."},
        {"nube": "Argo Workflows o Kubeflow Pipelines", "local": "<code>mundo/orquestador.py</code>", "diferencia": "Los dos corren tu DAG con parámetros, reintentos e historial, y resuelven el alias una vez. El de verdad vive en el clúster, corre por calendario y pone cada paso en su contenedor; el del dojo corre en tu Mac cuando tú lo llamas."},
        {"nube": "MLflow con Postgres y S3", "local": "MLflow en Docker, con SQLite y un volumen", "diferencia": "La misma API y la misma interfaz; solo cambia dónde guarda los metadatos y los archivos."},
        {"nube": "Amazon S3", "local": "RustFS en localhost:9400", "diferencia": "La misma API. En C01, los checkpoints intermedios llevan una regla de vencimiento: el que importa queda en MLflow."},
        {"nube": "El digest de la imagen de entrenamiento", "local": "<code>huella_entorno()</code>: sha256 de los paquetes instalados", "diferencia": "El digest fija todo el contenedor (sistema, CUDA, drivers); la huella de paquetes solo fija las versiones de Python."},
        {"nube": "Precisión mixta (AMP) en la GPU", "local": "<code>amp: false</code>", "diferencia": "En la CPU no acelera; en la A10G casi duplica la velocidad."},
    ],
    "arranque": "unzip c01-entrenamiento.zip && cd c01-entrenamiento\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait\npython mundo/crear.py\ngit init && git add -A && git commit -m \"kit recién descomprimido\"\npython verificar.py mundo",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 local y MLflow arriba, el mundo creado y la carpeta como repositorio de git.",
    conceptos=["tracking"],
    explica="El mundo vive en dos servicios: el S3 local (fotos, snapshots y checkpoints) y MLflow (el registro de corridas y de modelos). <code>mundo/crear.py</code> los llena igual cada vez: las fotos, los dos snapshots que dejó la estación 2 y el <b>champion</b>, el modelo de septiembre que hoy está en producción. La carpeta tiene que ser un repositorio de git desde el inicio: el commit es uno de los ingredientes que anota cada corrida.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Tarda unos minutos la primera vez (PyTorch pesa ≈ 1 GB). Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("docker compose up -d --wait\npython mundo/crear.py", L("p0 up") + "\n" + L("p0 crear"), "La interfaz de MLflow queda en http://localhost:5400: ahí está la corrida del equipo y el modelo <code>classifier</code>."),
        cmd("git init && git add -A && git commit -m \"kit recién descomprimido\"\ngit log --oneline", L("p0 git"), "Los ids de commit cambian en cada máquina."),
        cmd(f"{V} mundo", L("p0 verificar")),
    ],
    verifica="<code>verificar.py mundo</code> en verde: los tres buckets, los dos snapshots, <code>classifier@champion</code>, git y torch.",
    ojo="El 5000 lo ocupa AirPlay en macOS: por eso MLflow está en el 5400."))

G.append(dict(n=1, id="datos", titulo="Leer el snapshot como lo ve el gateway", objetivo="Del id <code>ds-2026-09-01</code> a tensores, comprobando cada huella y con el mismo preprocess que producción.",
    conceptos=["skew"],
    explica="El entrenamiento no elige datos: lee los que dice el id. Primero la tarjeta y la huella de las filas (si alguien las reescribió, se detiene), después cada foto con su huella. Cada foto se baja una vez a <code>data/cache/</code>, con su huella como nombre: si cambiara, sería otro archivo. Y cada foto pasa por <code>preprocess()</code>, <b>importado</b> del gateway: no una copia. Al final se compara con <code>paridad.json</code>, la huella del tensor que saca el gateway de verdad, y con su versión de Pillow.",
    codigo=[{"lang": "python", "path": "pipeline/datos.py", "code": code("pipeline/datos.py"), "nota": "El orden de los tensores es el de <code>rows.parquet</code>: el mismo snapshot da siempre lo mismo, en el mismo orden. Sin eso, la semilla no bastaría para repetir una corrida."}],
    comandos=[
        cmd("python pipeline/datos.py ds-2026-09-01", L("p1 datos"), "La primera vez baja las 8,523 fotos del S3."),
        cmd("du -sh data/cache; ls data/cache | wc -l\ntime python pipeline/datos.py ds-2026-09-01", L("p1 otra vez"), "La segunda vez lee de la caché."),
        cmd("python pipeline/datos.py latest", L("p1 latest"), "Un nombre que cambia de contenido no se acepta."),
        cmd(f"{V} datos paridad", L("p1 verificar")),
    ],
    verifica="6,999 fotos de train y 1,524 de validación en el orden del snapshot, y los 16 tensores idénticos a los del gateway con la misma Pillow.",
    ojo="Si reescribes el resize «igualito» (por ejemplo con OpenCV, o con otro filtro), la paridad falla aunque las fotos se vean iguales: los números no lo son."))

G.append(dict(n=2, id="humo", titulo="La prueba de humo", objetivo="Antes de gastar GPU, comprobar en segundos que el código aprende: memorizar 32 fotos.",
    conceptos=["prueba-humo", "perdida-inicial"],
    explica="Una red con decenas de miles de parámetros y solo 32 fotos <b>tiene que</b> memorizarlas. Si no lo logra, algo está roto: el optimizador no mueve los pesos, el learning rate es cero, las etiquetas no corresponden. Ninguno de esos errores tira el programa; todos se ven aquí. De paso revisas la pérdida del primer paso contra ln(10). La prueba usa el learning rate de la receta: se prueba la receta de verdad. Y sale con código 1 si falla, para que el orquestador no siga.",
    codigo=[{"lang": "python", "path": "pipeline/humo.py", "code": code("pipeline/humo.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/humo.py --snapshot ds-2026-09-01", L("p2 humo")),
        cmd("python pipeline/humo.py --snapshot ds-2026-09-01 --lr 0", L("p2 lr0"), "Lo que pasaría con un optimizador que no recibe los pesos: la pérdida no se mueve."),
        cmd(f"{V} humo", L("p2 verificar")),
    ],
    verifica="Pasa con la receta (pérdida &lt; 0.05 y 32/32) y falla con <code>--lr 0</code>.",
    ojo="En C01 esta prueba corre en el CI en cada commit al código de entrenamiento, además de ir antes del fine-tune en el pipeline."))

G.append(dict(n=3, id="job", titulo="El job: receta, semilla y MLflow", objetivo="Entrenar con un commit limpio, arrancando del champion, y dejar la corrida completa en MLflow.",
    conceptos=["job", "receta", "semilla", "tracking", "cinco-ingredientes", "amp"],
    explica="Es el archivo grande de la estación, y se lee por bloques (los números del código). <b>1</b>: si hay cambios sin commit, se niega: la corrida diría «commit tal» y no sería cierto. <b>2</b>: MLflow y el champion antes que nada, para fallar en segundos y no después de una hora (lo ves en el paso 4). <b>3 y 4</b>: los datos, la red con la semilla y algoritmos deterministas, AdamW y el programador OneCycle. <b>5</b>: los checkpoints (paso 5). <b>6</b>: la corrida en MLflow, con sus parámetros, sus punteros (los cinco ingredientes) y una métrica por época; al final, los pesos y su <code>labels.json</code> como artefactos y la huella de los pesos. Escríbelo completo en este paso; los bloques 2 y 5 los pruebas en los pasos 4 y 5.",
    codigo=[{"lang": "python", "path": "pipeline/entrenar.py", "code": code("pipeline/entrenar.py"), "nota": "<code>--champion</code> es un número de versión; <code>--corrida</code> es el id de la corrida: un reintento usa el mismo."}],
    comandos=[
        cmd(f"{E} --corrida a-mano-1", L("p3 sucio"), "Primero sin commit: se niega."),
        cmd(f"git add -A && git commit -m \"pipeline: datos, humo y entrenar\"\necho \"# una prueba\" >> receta.yaml\n{E} --corrida a-mano-1", L("p3 receta sucia"), "Un cambio a la receta sin commit también cuenta."),
        cmd(f"git restore receta.yaml\n{E} --corrida a-mano-1", L("p3 entrenar"), "≈ 25 s. Abre la corrida en MLflow: parámetros, la curva de <code>val_top1</code>, los tags y <code>modelo/</code>."),
        cmd(f"{E} --corrida a-mano-1", L("p3 otra vez"), "Una corrida terminada no se vuelve a escribir: una nueva lleva otro id."),
        cmd("python mundo/modelos.py corridas", L("p3 corridas")),
        cmd(f"{V} mlflow punteros limpio", L("p3 verificar")),
    ],
    verifica=f"Una corrida terminada con la receta y el champion como parámetros, <code>val_top1</code> por época, los punteros como tags y los pesos como artefacto. Arrancó del champion ({VAL_CHAMPION}) y llegó a {VAL_A1}.",
    ojo="MLflow imprime el enlace a la corrida al terminar. Si no abre, revisa que el contenedor <code>mlflow</code> esté arriba (<code>docker compose ps</code>)."))

G.append(dict(n=4, id="champion", titulo="Arrancar del champion, por su número", objetivo="Comprobar qué gana el arranque desde el champion, y por qué el job recibe una versión y no el alias.",
    conceptos=["warm-start", "alias-version"],
    explica="El bloque 2 del job baja la versión que le pasan, compara su <code>labels.json</code> con las categorías (si están en otro orden, la salida 0 dejó de ser «playeras») y carga sus pesos de forma estricta. Aquí lo pruebas: primero ves qué versiones hay, después intentas pasar el alias (se niega) y al final entrenas una vez desde cero, cambiando la receta en un commit, para comparar la curva con la de <code>a-mano-1</code>. Ese commit se deshace con <code>git revert</code>: la historia queda, la receta vuelve.",
    codigo=[{"lang": "python", "path": "pipeline/entrenar.py", "code": trozo("pipeline/entrenar.py", "# 2 ·", "# 3 ·"), "nota": "El bloque 2. Y en el 4, la línea que carga los pesos del champion: <code>if r[\"arranque\"] == \"champion\": modelo.load_state_dict(pesos_champion)</code>."}],
    comandos=[
        cmd("python mundo/modelos.py versiones", L("p4 versiones")),
        cmd("python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion @champion --corrida a-mano-2", L("p4 alias")),
        cmd(f"sed -i '' 's/^arranque: champion /arranque: cero     /' receta.yaml\ngit commit -am \"receta: arranque desde cero (prueba)\"\n{E} --corrida desde-cero", L("p4 desde cero"), "≈ 25 s. Compara en MLflow las dos curvas de <code>val_top1</code>: <code>a-mano-1</code> contra <code>desde-cero</code>."),
        cmd("git revert --no-edit HEAD\ngit log --oneline -3; grep \"^arranque\" receta.yaml", L("p4 revert")),
        cmd(f"{V} champion", L("p4 verificar")),
    ],
    verifica=f"Con las mismas 3 épocas, desde el champion llega a {VAL_A1} y desde cero a {VAL_CERO}. El job rechaza el alias.",
    ojo="Arrancar del champion encadena los meses: el modelo de octubre depende también del de septiembre. Por eso la corrida anota <code>champion_version</code>. Hay equipos que arrancan siempre desde los pesos base para que cada modelo dependa solo de su snapshot, su commit y su imagen."))

G.append(dict(n=5, id="reanudar", titulo="Checkpoints y una caída a media corrida", objetivo="Matar el job a media corrida, volverlo a lanzar con el mismo id y terminar con los mismos pesos que sin caída.",
    conceptos=["checkpoint", "reanudar"],
    explica="El bloque 5 del job: cada 25 pasos guarda en <code>s3://ml-ckpt/c01/&lt;snapshot&gt;/&lt;corrida&gt;/ultimo.pt</code> <b>todo</b> el estado (pesos, Adam, programador, generador de azar, época, paso, el orden de las fotos de la época y la pérdida acumulada) y sus ingredientes. Al arrancar, si hay checkpoint de su corrida y es de los mismos ingredientes, sigue desde ahí y en la misma corrida de MLflow. Como en CPU todo es determinista, la prueba es dura: la corrida reanudada tiene que terminar con la misma huella de pesos que <code>a-mano-1</code>.",
    codigo=[{"lang": "python", "path": "pipeline/entrenar.py", "code": trozo("pipeline/entrenar.py", "# 5 ·", "def evaluar"), "nota": "Y en el loop: <code>if paso % r[\"ckpt_cada_pasos\"] == 0: guardar()</code>."}],
    comandos=[
        cmd("python mundo/s3.py checkpoint ds-2026-09-01 a-mano-1", L("p5 checkpoint"), "El último checkpoint de <code>a-mano-1</code> y lo que trae."),
        cmd(f"{E} --corrida con-caida & sleep 15; kill -9 $!", L("p5 caida"), "<code>kill -9</code> mata el proceso sin aviso, como una máquina que desaparece. Tiene que morir después de la época 1 y antes de terminar: si tu Mac es más lenta o más rápida, ajusta el 15."),
        cmd(f"{E} --corrida con-caida", L("p5 reanudar"), "El mismo comando, el mismo id: reanuda."),
        cmd("python mundo/modelos.py corridas | grep -E \"a-mano-1|con-caida\"", L("p5 comparar"), "La misma huella de pesos: reanudar no agregó ninguna diferencia."),
        cmd(f"{V} checkpoints reanudar", L("p5 verificar")),
    ],
    verifica=f"<code>con-caida</code> reanudó en el paso {DESDE_CAIDA} y terminó con la misma huella de pesos que <code>a-mano-1</code>.",
    ojo="Si al reanudar no restauras el generador de azar o el orden de las fotos, el entrenamiento «funciona» y la huella sale distinta: es otro modelo, aunque se parezca. En GPU no puedes comprobarlo bit a bit; por eso vale tanto hacerlo aquí."))

G.append(dict(n=6, id="pipeline", titulo="El pipeline en el orquestador", objetivo="Escribir el DAG humo → entrenar y que sobreviva a la pérdida de la máquina sin que nadie haga nada.",
    conceptos=["orquestador", "reintento", "gpu-efimera"],
    explica="<code>pipeline.yaml</code> es la definición: parámetros (el snapshot por id y el champion como <code>@champion</code>) y pasos con su comando. Entrenar depende de humo: si el código está roto, no se pide la GPU. Entrenar pide <code>gpu: 1</code> y tiene <code>reintentos: 2</code>. El orquestador resuelve el alias una vez, le pone a la corrida un id (<code>wf-…</code>) y se lo pasa a cada intento: por eso un reintento encuentra su checkpoint. Con <code>--apagon 15</code> se pierde la máquina a los 30 s del primer intento.",
    codigo=[{"lang": "yaml", "path": "pipeline.yaml", "code": code("pipeline.yaml"), "nota": ""}],
    comandos=[
        cmd("git add -A && git commit -m \"pipeline.yaml: humo → entrenar\"\npython mundo/orquestador.py pipeline.yaml --apagon 15", L("p6 orquestador"), "≈ 1 minuto. Nadie relanzó nada: el orquestador reintentó y el job reanudó."),
        cmd("python -c \"\nimport json, glob\nr = json.load(open(sorted(glob.glob('historial/wf-*.json'))[-1]))\nprint('corrida:', r['corrida'], '· parámetros:', r['parametros'], '→', r['resueltos'])\nfor p in r['pasos']:\n    for i in p['intentos']:\n        print(f\\\"  {p['id']} intento {i['n']}: {i['segundos']} s · código {i['codigo']} · {i['motivo']}\\\")\"", L("p6 historial"), "Lo que anotó el orquestador: el alias resuelto y cada intento."),
        cmd(f"{V} pipeline", L("p6 verificar")),
    ],
    verifica=f"La corrida del orquestador quedó en verde: perdió la máquina, reintentó con el mismo id y reanudó en el paso {DESDE_ORQ}.",
    ojo="En C01 el pipeline mensual tiene ocho pasos: snapshot → validar → fine-tune → evaluar → gate → engine → paridad → registrar. Esta estación es el fine-tune; los demás llegan en las estaciones 4 y 5."))

G.append(dict(n=7, id="ruido", titulo="¿Regresión o ruido?", objetivo="Medir el ruido entre semillas y escribir la regla que dice si una diferencia es real.",
    conceptos=["ruido-semillas", "ruido-evaluacion"],
    explica="Dos corridas de la misma receta con otra semilla no dan lo mismo. Antes de decir «salió peor», mides cuánto varía sin que nada cambie: la receta con 5 semillas. Su desviación estándar es σ, y la regla es τ = 3σ: si la diferencia |Δ| entre dos corridas pasa de τ, algo más que el azar cambió y se comparan sus ingredientes; si no, es ruido. <code>comparar.py</code> toma como semillas las corridas con los mismos ingredientes que la primera (snapshot, receta, champion y entorno) y lista lo que cambia entre las dos.",
    codigo=[{"lang": "python", "path": "pipeline/comparar.py", "code": code("pipeline/comparar.py"), "nota": ""}],
    comandos=[
        cmd("git add -A && git commit -m \"comparar corridas\"\npython pipeline/comparar.py a-mano-1 desde-cero", L("p7 pocas"), "Con una sola semilla no hay σ."),
        cmd(f"for s in 18 19 20 21; do\n  {E} --corrida semilla-$s --semilla $s | grep '✓'\ndone", "\n".join(L(f"p7 semilla {s}") for s in (18, 19, 20, 21)), "≈ 2 minutos: cuatro corridas más, con la semilla 17 de <code>a-mano-1</code> son cinco."),
        cmd("python pipeline/comparar.py a-mano-1 semilla-19", L("p7 ruido")),
        cmd("python pipeline/comparar.py a-mano-1 desde-cero", L("p7 revisar"), "Aquí sí cambió algo: la receta (y el commit)."),
        cmd(f"{V} ruido", L("p7 verificar")),
    ],
    verifica=f"5 semillas, σ = {SIGMA} y τ = {TAU} puntos; una semilla distinta es ruido y arrancar desde cero es «revisar».",
    ojo="σ se midió con esta receta. Si cambias el batch, el learning rate o la red, se vuelve a medir. Y con un examen chico (1,524 fotos), el propio examen ya se mueve ± 1.8 puntos (el precálculo «ruido»): la comparación de verdad, foto por foto contra el champion, es de la estación 4."))

# en la página, qué conceptos y precálculos van dentro de cada paso
REPARTO = {1: (["skew"], []), 2: (["prueba-humo", "perdida-inicial"], ["l0"]),
           3: (["job", "receta", "semilla", "tracking", "cinco-ingredientes", "amp"], ["pasos", "tiempo"]),
           4: (["warm-start", "alias-version"], []), 5: (["checkpoint", "reanudar"], ["peso-ckpt", "cada-cuanto"]),
           6: (["orquestador", "reintento", "gpu-efimera"], ["costo"]), 7: (["ruido-semillas", "ruido-evaluacion"], ["ruido"])}
for g in G:
    if g["n"] in REPARTO:
        c, p = REPARTO[g["n"]]
        g["en_pagina"] = {"conceptos": c, "precalculos": p}
e["guiado"] = G

e["solo"] = {
    "reglas": [
        "Empieza con <code>python mundo/reiniciar.py --pipeline</code> y haz commit del esqueleto.",
        "Sin <code>GUION.md</code>: solo estos objetivos y el contrato arriba de cada archivo.",
        "Cada objetivo tiene su check; corre <code>python verificar.py &lt;check&gt;</code> cuando creas que quedó.",
        "Todo entrenamiento, desde un commit limpio. Cada corrida nueva lleva su propio <code>--corrida</code>.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 local y MLflow arriba, el mundo creado y la carpeta en git.", "check": "mundo"},
        {"n": 2, "objetivo": "<code>cargar(id)</code> devuelve train y val en el orden del snapshot, comprobando cada huella, y se detiene con «latest».", "check": "datos"},
        {"n": 3, "objetivo": "Tus tensores son idénticos a los del gateway, con la misma versión de Pillow.", "check": "paridad", "pista": "¿Escribiste el preprocess o lo importaste?"},
        {"n": 4, "objetivo": "La prueba de humo pasa con la receta y falla con <code>--lr 0</code>.", "check": "humo"},
        {"n": 5, "objetivo": "Una corrida terminada en MLflow con los parámetros de la receta, una métrica por época y los pesos con su <code>labels.json</code>.", "check": "mlflow"},
        {"n": 6, "objetivo": "La corrida guarda sus punteros: snapshot y su huella, commit, entorno, preprocess, Pillow, champion, receta y la huella de los pesos.", "check": "punteros"},
        {"n": 7, "objetivo": "Tu código y tu receta sin cambios pendientes, y todas tus corridas desde un commit limpio.", "check": "limpio"},
        {"n": 8, "objetivo": "Una corrida que arrancó del champion por su número de versión, con las categorías en el mismo orden.", "check": "champion"},
        {"n": 9, "objetivo": "El checkpoint de tu última corrida en S3, con pesos, Adam, programador, azar, época, paso e ingredientes.", "check": "checkpoints", "pista": "¿Qué necesitas para que el paso siguiente sea el mismo que habría sido?"},
        {"n": 10, "objetivo": "Una corrida que se cayó a media corrida, se reanudó y terminó con los mismos pesos que una sin caída.", "check": "reanudar"},
        {"n": 11, "objetivo": "<code>pipeline.yaml</code>: humo → entrenar con GPU y reintentos, y una corrida del orquestador que sobrevivió a <code>--apagon</code>.", "check": "pipeline", "pista": "¿Qué id recibe el segundo intento?"},
        {"n": 12, "objetivo": "Cinco semillas de la misma receta y <code>comparar.py</code> con Δ, σ, τ = 3σ y el veredicto.", "check": "ruido"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("lr-roto", "Una corrida de 4 horas que no aprendió nada", "config",
          "El pipeline de anoche ni siquiera pidió la GPU: se detuvo en el primer paso. En el canal del equipo alguien escribió «¿quién movió algo?».",
          "<code>verificar.py</code>: <code>humo</code> falla. " + F("f1 detecta", filtro=r"^✗"),
          ["Alguien cambió la receta.", "Cambió tu código de entrenamiento.", "Los datos llegaron mal."],
          "git log -1 --format=\"%h %an · %s\" -- receta.yaml\ngit show HEAD -- receta.yaml | grep \"^[-+]lr\"", F("f1 confirma"),
          "Un commit del equipo dejó <code>lr: 0.0</code>: con eso, AdamW no mueve ningún peso. Deshazlo con <code>git revert --no-edit HEAD</code> (la historia queda, la receta vuelve a <code>lr: 0.003</code>). La prueba de humo lo atrapó en segundos; sin ella, la corrida habría gastado la GPU completa. Congelar capas se hace con otra receta, no con lr 0.",
          "prueba-humo", "humo")
    falla("ckpt-espaciado", "Menos escrituras a S3", "config",
          "Finanzas preguntó por qué el bucket de checkpoints tiene tantas escrituras. Alguien subió un cambio a la receta para «ahorrar» y avisó en el canal.",
          "<code>verificar.py</code>: <code>reanudar</code> falla. " + F("f2 detecta", filtro=r"^✗") + " Y si se pierde la máquina, el reintento empieza de cero.",
          ["Alguien cambió cada cuánto se guarda.", "El bucket de checkpoints no existe.", "El reintento usa otro id de corrida."],
          "git show HEAD -- receta.yaml | grep \"^[-+]ckpt\"\npython mundo/orquestador.py pipeline.yaml --apagon 15", F("f2 confirma") + "\n" + F("f2 apagon"),
          "Con <code>ckpt_cada_pasos: 1000</code> y 330 pasos por corrida nunca se guarda nada: el segundo intento no dice «reanudo» y repite todo. El ahorro es ridículo (en C01, 16 PUT de 300 MB al mes son centavos y ≈ 0.3 % del tiempo). Deshazlo con <code>git revert --no-edit HEAD</code>: vuelve <code>ckpt_cada_pasos: 25</code>, el número del precálculo.",
          "checkpoint", "reanudar")
    falla("champion-otro-orden", "El champion cambió de un día para otro", "mundo",
          "El equipo de búsqueda presumió que su modelo «ya está en producción, con 86 %». El pipeline de esta noche se detuvo antes de entrenar.",
          "<code>verificar.py</code>: <code>champion</code> falla. " + F("f3 detecta", filtro=r"^✗") + " El pipeline se detiene en cada intento antes de entrenar.",
          ["Alguien movió el alias champion.", "El champion de siempre se borró.", "Cambiaron las categorías del snapshot."],
          "python mundo/modelos.py versiones\npython mundo/orquestador.py pipeline.yaml", F("f3 confirma") + "\n" + F("f3 entrenar", filtro=r"✗|resuelve|versión|intento|rojo"),
          "Alguien registró a mano una versión nueva de <code>classifier</code> (salió de un notebook) y le movió <code>@champion</code>. Sus categorías están en orden alfabético: la salida 0 ya no es «playeras». Devuelve el alias: <code>python mundo/modelos.py alias champion 1</code>. En C01 el alias lo mueve solo el pipeline de CD, después del gate y del canary, y nadie registra modelos desde un notebook.",
          "alias-version", "champion")
    falla("pillow-distinto", "Serving cambió de versión de Pillow", "entorno",
          "El equipo de serving publicó en su canal: «Fijamos Pillow 12.3.0 en el gateway por un problema con algunos JPEG». Nadie de entrenamiento lo leyó.",
          "<code>verificar.py</code>: <code>paridad</code> falla. " + F("f4 detecta", filtro=r"^✗"),
          ["El gateway cambió una versión.", "Tu preprocess cambió.", "Las fotos del snapshot cambiaron."],
          "pip show pillow | sed -n 1,2p\ngrep -i \"^pillow\" mundo/gateway/requirements.txt requirements.txt", F("f4 confirma"),
          "El gateway fija Pillow 12.3.0 y tu entorno de entrenamiento sigue con 13.0.0. Pillow decodifica el JPEG y hace el resize: con otra versión, la misma foto puede dar otros números. Esta vez los 16 tensores salen iguales; la garantía no es que coincidan hoy, es usar la misma. Arreglo: <code>pip install pillow==12.3.0</code> y el mismo pin en <code>requirements.txt</code>, para que el entorno se pueda reconstruir. En C01, la imagen de entrenamiento toma su Pillow de la del gateway.",
          "skew", "paridad")
    falla("mlflow-caido", "El job murió a los dos segundos", "infra",
          "El pipeline de anoche quedó en rojo y el entrenamiento ni siquiera empezó. La persona de guardia vio la alarma en la mañana.",
          "<code>verificar.py</code>: casi todo falla. " + F("f5 detecta", filtro=r"^✗ mundo"),
          ["Se cayó MLflow.", "Se cayó el S3.", "Cambió la red de Docker."],
          "docker compose ps -a --format \"{{.Service}}: {{.State}} · {{.Status}}\"\npython pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida prueba-mlflow", F("f5 confirma") + "\n" + F("f5 entrenar"),
          "El contenedor de MLflow está detenido. El job lo comprueba antes de bajar datos o entrenar y se detiene en segundos: sin registro no se entrena, porque un modelo sin su corrida no tiene linaje. Arreglo: <code>docker compose up -d --wait mlflow</code>. En C01 MLflow lo opera plataforma; si se cae, el reintento del orquestador espera y vuelve a intentar.",
          "tracking", "mundo")
    falla("receta-sin-commit", "Una prueba rápida en la máquina del pipeline", "config",
          "Alguien entró a la máquina donde corre el pipeline «para una prueba rápida» y se fue de vacaciones. El pipeline de esta noche no arrancó.",
          "<code>verificar.py</code>: <code>limpio</code> falla. " + F("f6 detecta", filtro=r"^✗"),
          ["Hay un cambio sin commit.", "Alguien cambió la receta en un commit.", "Cambió el snapshot."],
          "git status --short\ngit diff receta.yaml | grep \"^[-+]epocas\"\npython pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida prueba-limpio", F("f6 confirma", quitar=r" (romper|verificar)\.py$") + "\n" + F("f6 entrenar"),
          "<code>receta.yaml</code> tiene <code>epocas: 5</code> sin commit. Una corrida desde aquí diría «commit tal», y ese commit tiene 3 épocas: el linaje mentiría. Como nadie lo aprobó: <code>git restore receta.yaml</code>. Si de verdad se quiere probar 5 épocas, va en un commit con su porqué, y es otra receta: sus semillas se vuelven a medir.",
          "cinco-ingredientes", "limpio")
e["fallas"] = FAL

e["listo"] = [
    "La corrida salió del pipeline, desde un commit limpio, no de una laptop ni de un notebook.",
    "Antes de pedir la GPU, la prueba de humo comprobó que el código aprende con la receta de verdad.",
    "El entrenamiento leyó el snapshot por su id, comprobó cada huella y vio las fotos igual que el gateway (mismo preprocess, misma Pillow).",
    "Arrancó del champion por su número de versión, con las categorías en el mismo orden.",
    "MLflow tiene los parámetros, la curva de <code>val_top1</code> por época, los pesos y los punteros: snapshot, commit, entorno, champion y receta.",
    "Si se cae la máquina, el reintento reanuda del checkpoint con el mismo id y termina en el mismo modelo.",
    "Hay un ruido entre semillas medido y una regla escrita para decir si una diferencia es regresión o ruido.",
]

e["repaso"] = {
    "memo": "<b>El notebook explora, el pipeline produce.</b> Lo que va a producción sale de un job que lanza el orquestador: lee el snapshot por id, prueba en segundos que el código aprende, arranca del champion por su número, guarda todo su estado cada tanto para reanudar con el mismo id y deja en MLflow los cinco ingredientes (código, datos, receta, entorno y semilla). Y una diferencia contra otra corrida se lee contra 3σ de las semillas antes de decir «salió peor».",
    "trampa": "«Fijé la semilla, así que es reproducible». Sin el commit limpio, el snapshot por id, la receta y el entorno, la semilla sola no repite nada; y en GPU, cuDNN cambia los últimos bits aunque todo esté fijo. Reproducible en C01 quiere decir «mismo resultado dentro del ruido», con los cinco ingredientes anotados.",
    "entrevista": [
        {"q": "¿Cómo conviertes un notebook de fine-tuning en algo que corre cada mes?", "a": "Saco el código a un script versionado que lee la receta de un archivo en el repo y los datos por id de snapshot. Lo corre el orquestador en un contenedor fijado por digest, en una GPU que se pide para ese paso y se libera al terminar. Antes va una prueba de humo; durante, checkpoints para reanudar; y todo queda en MLflow con sus punteros. Los candidatos salen solo de ahí, desde un commit limpio."},
        {"q": "El entrenamiento murió en la hora 2 de 4. ¿Qué pasa?", "a": "El orquestador reintenta el paso con el mismo id de corrida. El job busca su último checkpoint en S3 (pesos, estado de Adam, programador, azar, época y paso), comprueba que sea de los mismos ingredientes y sigue desde ahí, en la misma corrida de MLflow. Con checkpoints cada 15 minutos se pierden a lo más 15 minutos. Sin checkpoints, el reintento empieza de cero y la corrida tarda el doble."},
        {"q": "¿Qué guardas en un checkpoint y por qué no bastan los pesos?", "a": "Pesos, los dos promedios de Adam, el programador del learning rate, época y paso, el estado de los generadores de azar (y el GradScaler si hay precisión mixta). Con solo los pesos, Adam empieza en cero, el learning rate vuelve al inicio y el orden de las fotos cambia: sale otro modelo. En la ResNet-50 son ≈ 300 MB, tres veces los pesos."},
        {"q": "Dos corridas con la misma configuración dan 85.3 % y 85.1 %. ¿Hay una regresión?", "a": "Primero mido el ruido: la misma receta con varias semillas, y su desviación estándar σ. Si |Δ| ≤ 3σ, es ruido: no celebro ni detengo nada. Si pasa de 3σ con la misma receta, comparo los cinco ingredientes en MLflow (snapshot y su huella, commit, digest, receta, tipo de GPU); casi siempre aparece la diferencia. Y considero el ruido del examen: con un examen chico, 0.2 puntos no se pueden leer."},
        {"q": "¿Cómo evitas el training-serving skew en el preprocesamiento?", "a": "Por construcción: el entrenamiento importa el mismo preprocess.py que usa el gateway, no una copia, y la imagen de entrenamiento usa la misma versión de Pillow. Lo compruebo con paridad: la huella del tensor que saca el gateway para unas fotos fijas tiene que ser igual a la del entrenamiento. Y después, la paridad end-to-end por el gateway real."},
        {"q": "¿Por qué el job recibe la versión del champion y no el alias?", "a": "Porque el alias se mueve. Si cada reintento resolviera @champion y alguien lo movió a media corrida, la corrida mezclaría dos modelos. El orquestador lo resuelve una vez al arrancar y pasa el número; la corrida lo anota, y el linaje dice exactamente de dónde arrancó."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-entrenamiento/CLAUDE.md",
    "guiado": "content/estaciones/c01-entrenamiento/prompts/guiado.md",
    "solo": "content/estaciones/c01-entrenamiento/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-entrenamiento/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-entrenamiento/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-entrenamiento.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· fallas:", len(FAL))
