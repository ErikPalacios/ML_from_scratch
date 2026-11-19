"""Arma content/estaciones/c01-export.json con las salidas reales de probar.sh y probar-fallas.sh.

    bash probar.sh /tmp/e5 && bash probar-fallas.sh /tmp/e5     # deja /tmp/e5.log y /tmp/e5-fallas.log
    python3 contenido.py /tmp/e5                                 # escribe el JSON con esas salidas

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
    lineas = m.group(1).rstrip("\n").replace(RUTA, "~/c01-export").splitlines()
    lineas = [re.sub(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ Python\[\d+:\d+\] \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+ ", "", l) for l in lineas
              if "View run" not in l and "View experiment" not in l and "mlflow.store.model_registry" not in l]
    lineas = [re.sub(r"^W\d{4} \S+ \d+ \S+\] ", "[aviso de PyTorch] ", l) for l in lineas]
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
CREAR_S = num("p0 crear", r"(?m)^real (\d+)")
D_EXPORT = num("p2 exportar", r"batch 32: .*diferencia máxima (\S+)")
A1 = num("p4 paridad", r"a1 = (\S+)%")
O5 = num("p4 paridad", r"o5 = (\S+)%")
D16 = num("p4 paridad", r"d = (\S+)")
A1_8 = num("p4 int8 paridad", r"a1 = (\S+)%")
CAMBIAN_8 = num("p4 int8 paridad", r"cambian (\d+)")
D8 = num("p4 int8 paridad", r"d = (\S+)")
X_CH = num("p5 latencia", r"challenger ([\d,]+) fotos/s").replace(",", "")
X_CHAMP = num("p5 latencia", r"champion ([\d,]+) fotos/s").replace(",", "")
X8 = None
P600 = re.search(r"600 peticiones/s .*p99 champion (\S+) ms · challenger (\S+) ms · límite (\S+) ms", L("p5 latencia"))
P1200 = re.search(r"1200 peticiones/s .*p99 champion (\S+) ms · challenger (\S+) ms · límite (\S+) ms", L("p5 latencia"))
LAT_S = num("p5 latencia", r"(?m)^real (\d+)")
KB_ONNX = num("p2 exportar", r"· (\d+) kB")
KB16 = num("p3 construir", r"fp16: (\d+) kB")
KB_ENG = num("p3 construir", r"engine.onnx: (\d+) kB")
KB8 = num("p4 int8 construir", r"int8: (\d+) kB")
PARAMS = num("pc pesos", r"MiniResNet: ([\d,]+) parámetros")

e = {
    "id": "export", "patron": "sincrono", "caso": "c01", "num": 5,
    "titulo": "Export, engine y paridad", "nav": "Export y engine",
    "pregunta": "El gate aprobó un modelo, pero lo que se sirve es otro archivo, con otros números por dentro. ¿Cómo lo fabricas y cómo sabes que responde lo mismo y no es más lento?",
    "version": "2026-11-17",
}

e["mapa"] = {
    "resumen": "La estación 4 dejó a <code>classifier</code> v4 aprobado y con el alias <code>challenger</code>. Pero el servidor no corre ese checkpoint de PyTorch: corre un <b>engine</b>, el mismo modelo compilado para la máquina y el runtime que lo van a servir, con los pesos en menos bits. Esta estación lo fabrica en dos pasos (primero un <b>ONNX</b>, el modelo como archivo neutral, y después el engine) y lo examina dos veces: que responda lo mismo que el checkpoint que aprobó el gate (<b>paridad</b>) y que no sea más lento que el engine que hoy sirve producción (<b>gate de latencia</b>). Solo con las dos en verde queda en el registro, con las huellas de todo lo que se usó para fabricarlo. Si cualquiera falla, no se registra nada y el champion sigue atendiendo.",
    "entra": [
        "el checkpoint aprobado: <code>classifier</code> v4, por número, con la huella de sus pesos",
        "la receta y los umbrales (<code>engine.yaml</code>), revisados en un PR antes de la corrida",
        "el contrato del servidor (nombres, tipos y formas, el batch más grande) y la versión de su runtime",
        "el golden set congelado, y el engine del champion como referencia de latencia",
    ],
    "sale": [
        "<code>model.onnx</code>: la entrega neutral, revisada con tres chequeos",
        "<code>engine.onnx</code>: lo que de verdad corre el servidor, atado a esta máquina y a este runtime",
        "los reportes de paridad y de latencia, y las huellas del build",
        "la versión v4 con <code>engine=listo</code>, sus archivos y sus tags; ningún alias se mueve",
    ],
    "escala": [
        {"que": "El modelo", "c01": "ResNet-50, ≈ 24.5 M de parámetros (≈ 98 MB en FP32)", "taller": f"MiniResNet, {PARAMS} parámetros (≈ {KB_ONNX} kB en ONNX FP32)"},
        {"que": "El engine", "c01": "<code>model.plan</code> de TensorRT, FP16, compilado en una T4", "taller": "<code>engine.onnx</code> de ONNX Runtime: pesos en FP16 y el grafo optimizado para la CPU de tu Mac"},
        {"que": "El contrato con el servidor", "c01": "<code>config.pbtxt</code> de Triton: <code>input</code> [3, 224, 224] → <code>logits</code> [500], batch hasta 16", "taller": "<code>mundo/servidor/classifier.yaml</code>: <code>input</code> [3, 32, 32] → <code>logits</code> [10], batch hasta 32"},
        {"que": "El examen de paridad", "c01": "≈ 10,000 fotos del golden set, contra Triton en la T4", "taller": "las 1,000 de <code>golden-v1</code>, contra el engine abierto como lo abre el servidor"},
        {"que": "La latencia", "c01": "<code>perf_analyzer</code> contra Triton a 250 y 500 peticiones/s; holgura 10 %", "taller": "carga abierta dentro del proceso a 600 y 1,200 peticiones/s; holgura 15 %"},
        {"que": "Dónde corre", "c01": "un runner de CI con una T4 (g4dn.xlarge), ≈ 20–30 min", "taller": f"la CPU de tu Mac: ≈ 15 s todo menos la latencia (≈ {LAT_S} s)"},
    ],
    "hoja": "https://hojas.trueml.app/recorrido/#est-export",
}

e["precalculos"] = {
    "intro": "Antes de exportar, las cuentas de servilleta: cuánto pesa el modelo en cada formato, cuánto se mueve un número al pasarlo a FP16, de qué tamaño tiene que ser el examen para separar un engine sano de uno roto, qué tanto de la máquina usa la prueba de latencia y por qué la holgura del dojo es 15 % y no 10 %. Cada cuenta va en las dos escalas: C01 y el dojo.",
    "cuentas": [
        {
            "id": "pesos", "pregunta": "¿Cuánto pesa el modelo en FP32 y en FP16?",
            "formula": "tamaño = parámetros × bytes por número (FP32: 4 B; FP16: 2 B)",
            "c01": {"cuenta": "24.5 M × 4 B y × 2 B", "valor": "≈ 98 MB en FP32 · ≈ 49 MB en FP16"},
            "taller": {"cuenta": f"{PARAMS} × 4 B y × 2 B", "valor": f"≈ {int(PARAMS.replace(',', '')) * 4 / 1e3:.0f} kB en FP32 · ≈ {int(PARAMS.replace(',', '')) * 2 / 1e3:.0f} kB en FP16"},
            "decide": "FP16 parte el archivo a la mitad, y en una GPU también acelera las cuentas. El dojo solo aprovecha lo primero: en la CPU de tu Mac, ONNX Runtime vuelve los pesos a FP32 para hacer las cuentas.",
            "conceptos": ["fp16", "engine"],
            "comprueba": cmd("python -c \"\nfrom mundo.arquitectura import construir_modelo\nn = sum(p.numel() for p in construir_modelo(10).parameters())\nfor nombre, p in [('C01, ResNet-50', 24_500_000), ('dojo, MiniResNet', n)]:\n    print(f'{nombre}: {p:,} parámetros × 4 B = {p * 4 / 1e6:.3f} MB en FP32 · × 2 B = {p * 2 / 1e6:.3f} MB en FP16')\"", L("pc pesos")),
            "confirma": f"el paso 3: el ONNX FP32 pesa {KB_ONNX} kB y el FP16, {KB16} kB.",
        },
        {
            "id": "redondeo", "pregunta": "¿Cuánto se mueve un logit al pasar los pesos a FP16?",
            "formula": "FP16 guarda 10 bits de mantisa: entre 2 y 4, los números van de 2⁻⁹ ≈ 0.002 en 0.002; cada peso se mueve a lo más ≈ 0.05 % de su valor",
            "c01": {"cuenta": "logits de ≈ 10, con 50 capas que suman errores chicos", "valor": "d ≈ 0.01 en un FP16 sano; 1 o más en uno roto"},
            "taller": {"cuenta": "logits de ≈ 10, 9 convoluciones con pesos redondeados", "valor": "d del orden de 0.01"},
            "decide": "El umbral d ≤ 0.5 queda muy arriba de un FP16 sano y muy abajo de uno roto: no da falsas alarmas. Y un empate de 0.001 entre dos categorías puede deshacerse: por eso a1 no se pide del 100 %.",
            "conceptos": ["fp16", "tres-numeros"],
            "comprueba": cmd("python -c \"\nimport numpy as np\nfor x in (1.0, 2.3, 10.0):\n    print(f'cerca de {x}: el siguiente FP16 está a {float(np.spacing(np.float16(x))):.5f}')\nprint('2.301 y 2.300 en FP16:', float(np.float16(2.301)), float(np.float16(2.300)), '· el mayor FP16:', float(np.finfo(np.float16).max))\"", L("pc fp16")),
            "confirma": f"el paso 4: el engine FP16 da d = {D16} sobre las 1,000 fotos.",
        },
        {
            "id": "examen", "pregunta": "¿Con cuántas fotos el examen separa un engine sano de uno roto?",
            "formula": "L = (1 − a_min) × N cambios permitidos; un engine que cambia una fracción f espera N × f, con σ = √(N × f × (1 − f)); margen D = (L − N × f) ÷ σ",
            "c01": {"cuenta": "N = 10,000, L = 50: sano (f = 0.2 %) espera 20, σ ≈ 4.5; roto (f = 1 %) espera 100, σ ≈ 9.9", "valor": "D ≈ +6.7 el sano · ≈ −5.0 el roto"},
            "taller": {"cuenta": "N = 1,000, L = 5: sano espera 2, σ ≈ 1.4; roto espera 10, σ ≈ 3.1", "valor": "D ≈ +2.1 el sano · ≈ −1.6 el roto"},
            "decide": "Con 1,000 fotos el examen todavía separa, pero con poco margen: un engine con un bug chico podría pasar por suerte. Por eso C01 usa 10,000. Con las 512 del chequeo del export no alcanzaría para FP16, y no hace falta: FP32 contra FP32 no cambia ninguna respuesta.",
            "conceptos": ["examen-ruido", "tres-numeros"],
            "comprueba": cmd("python -c \"\nimport math\nfor nombre, N in [('C01, 10,000 fotos', 10000), ('dojo, golden-v1', 1000), ('chequeo del export', 512)]:\n    L = (1 - 0.995) * N\n    for f in (0.002, 0.01):\n        s = math.sqrt(N * f * (1 - f))\n        print(f'{nombre}: L = {L:.1f} · f = {f:.1%}: espera {N * f:.1f} cambios, σ = {s:.2f}, D = {(L - N * f) / s:+.1f}')\"", L("pc examen")),
        },
        {
            "id": "uso", "pregunta": "¿Qué tanto de la máquina usa la prueba de latencia?",
            "formula": "ρ = λ ÷ X: la tasa de la prueba entre el máximo de fotos por segundo",
            "c01": {"cuenta": "una T4 da X ≈ 1,200 fotos/s: 250 ÷ 1,200 y 500 ÷ 1,200", "valor": "ρ ≈ 21 % y ≈ 42 %"},
            "taller": {"cuenta": f"un hilo de tu Mac da X ≈ {int(X_CH):,} fotos/s: 600 ÷ {int(X_CH):,} y 1,200 ÷ {int(X_CH):,}", "valor": f"ρ ≈ {600 / int(X_CH):.0%} y ≈ {1200 / int(X_CH):.0%}"},
            "decide": "Se mide a dos cargas porque la cola de la latencia crece más rápido que el centro cuando la fila se llena. El dojo elige sus tasas para quedar en el mismo lugar de la curva que C01: un cuarto y la mitad de la máquina.",
            "conceptos": ["carga-abierta", "gate-latencia"],
            "comprueba": cmd("python -c \"\nfor nombre, X, tasas in [('C01, una T4 con el engine FP16', 1200, (250, 500)), ('dojo, un hilo de tu Mac', 2390, (600, 1200))]:\n    print(nombre + ': ' + ' · '.join(f'{t}/s → ρ = {t / X:.0%}' for t in tasas))\"", L("pc uso")),
            "confirma": f"el paso 5: latencia.py mide el máximo antes de empezar ({int(X_CH):,} fotos/s el challenger).",
        },
        {
            "id": "holgura", "pregunta": "¿Por qué la holgura del dojo es 15 % y no 10 %?",
            "formula": "la holgura tiene que quedar arriba del ruido de medir dos veces lo mismo: dos engines de la misma red, medidos igual",
            "c01": {"cuenta": "runner dedicado con su T4 y perf_analyzer con miles de peticiones: el ruido entre corridas es de pocos %", "valor": "holgura 10 %"},
            "taller": {"cuenta": "tu Mac, con otras cosas abiertas: dos engines de la misma red, medidos igual, se separaron hasta ≈ 8 % al probar el kit", "valor": "holgura 15 %, con la mediana de 5 rondas alternadas"},
            "decide": "Una holgura más chica que el ruido frenaría engines sanos por suerte; una mucho más grande dejaría pasar engines lentos. Por eso el gate compara contra el champion medido igual, en la misma máquina y en rondas alternadas: lo que no es el modelo se cancela.",
            "conceptos": ["gate-latencia"],
            "confirma": f"el paso 5: con la misma red, el challenger queda a {float(P600.group(2)) / float(P600.group(1)) - 1:+.1%} del champion a 600/s y a {float(P1200.group(2)) / float(P1200.group(1)) - 1:+.1%} a 1,200/s.",
        },
    ],
}

conceptos = [
    {"id": "export", "termino": "Export", "en": "model export",
     "def": "Convertir el modelo de PyTorch (código + pesos) en un archivo que solo describe las cuentas: qué operaciones, en qué orden y con qué pesos.",
     "analogia": "Pasar una receta que vive en la cabeza de un chef a una tarjeta escrita: cualquier cocina la puede seguir sin el chef.",
     "importa": "El servidor no necesita Python ni el código de entrenamiento, y no abre un pickle (abrir un pickle puede correr código). Necesita un archivo que diga qué cuentas hacer.",
     "trampa": "Exportar en modo train: la BatchNorm usa las estadísticas de cada lote y el archivo es otro modelo."},
    {"id": "onnx", "termino": "ONNX", "en": "Open Neural Network Exchange",
     "def": "Un formato abierto para modelos: un grafo de operadores estándar (Conv, Relu, Gemm…) con sus pesos y una firma: nombres, tipos y formas de la entrada y la salida.",
     "analogia": "El PDF de los modelos: lo genera una herramienta y lo leen muchas otras.",
     "importa": "Es la entrega entre entrenamiento y serving. De él sale el engine (TensorRT en C01, ONNX Runtime en el dojo), y sirve para comparar en CPU antes de gastar GPU.",
     "trampa": "Creer que un ONNX válido es un ONNX correcto: el checker revisa que el grafo esté bien formado, no que responda lo mismo."},
    {"id": "opset", "termino": "Opset", "en": "operator set version",
     "def": "La versión del conjunto de operadores que usa un archivo ONNX. Cada archivo la declara, y quien lo lee tiene que conocerla.",
     "analogia": "La edición de un diccionario: la misma palabra puede cambiar de significado entre ediciones.",
     "importa": "El opset es parte del contrato: si el runtime no lo conoce, no carga; si cambia sin que nadie lo pida, un operador puede significar otra cosa. Se fija en la receta y se lee del archivo después de exportar.",
     "trampa": "Confiar en el parámetro que pasaste: el exportador nuevo de PyTorch, al pedirle 17, deja el archivo en 18 con solo un aviso."},
    {"id": "eje-batch", "termino": "Eje de batch dinámico", "en": "dynamic batch axis",
     "def": "Declarar que la dimensión 0 de la entrada y de la salida tiene un nombre («batch») en vez de un número: el archivo acepta 1 foto o varias juntas.",
     "analogia": "Una charola con espacios ajustables en vez de una con exactamente 4 huecos.",
     "importa": "El servidor junta peticiones en un lote (batching dinámico). Si el archivo solo acepta batch 1, eso no funciona. Por eso el chequeo prueba las dos orillas: batch 1 y el máximo.",
     "trampa": "Probar solo con batch 1: un eje fijo por error pasa esa prueba y truena con el primer lote en producción."},
    {"id": "exportador", "termino": "Exportador clásico y exportador nuevo", "en": "TorchScript-based exporter / dynamo exporter",
     "def": "El clásico (dynamo=False) corre el modelo una vez y graba las operaciones que pasaron (trazar). El nuevo (dynamo=True, el de omisión desde PyTorch 2.9) lo captura con torch.export.",
     "analogia": "Grabar a alguien cocinando una vez contra copiar su libreta: casi siempre sale la misma receta, pero no siempre escrita igual.",
     "importa": "Cambiar de exportador cambia el archivo (aquí, de 180 kB a 48 kB y de opset 17 a 18). Es un cambio aparte, con su propia paridad, nunca de pasada.",
     "trampa": "Actualizar PyTorch y que el exportador por omisión cambie sin que nadie lo note."},
    {"id": "engine", "termino": "Engine", "en": "inference engine",
     "def": "El modelo ya compilado para una máquina y un runtime concretos: capas fusionadas, el formato de memoria que más le conviene a ese chip y, casi siempre, menos bits por número.",
     "analogia": "Una traducción hecha para un público concreto: dice lo mismo, con las palabras que ese público lee más rápido.",
     "importa": "Es lo que de verdad atiende a la gente. En C01, un model.plan de TensorRT en FP16 en la T4; en el dojo, un engine.onnx de ONNX Runtime para la CPU de tu Mac.",
     "trampa": "Tratarlo como un archivo portátil: un engine de otra GPU o de otra versión del runtime no carga, o carga y da otros números."},
    {"id": "fp16", "termino": "FP16", "en": "half precision",
     "def": "Números de 16 bits: la mitad de memoria que FP32, con 3 a 4 cifras significativas y un máximo de 65,504.",
     "analogia": "Medir con una regla de milímetros en vez de una de décimas de milímetro: casi siempre basta, y pesa la mitad.",
     "importa": "Parte el modelo a la mitad y, en una GPU, acelera las cuentas. Mueve los logits ≈ 0.01: casi ninguna respuesta cambia, salvo las casi empatadas.",
     "trampa": "Una capa cuyos números pasan de 65,504 se vuelve infinito: ese engine ya no es el modelo, y solo la paridad lo delata."},
    {"id": "int8", "termino": "INT8 y calibración", "en": "INT8 quantization / calibration",
     "def": "Guardar y calcular con enteros de 8 bits. Cada capa necesita una escala, que se elige viendo cómo se mueven sus números con fotos de ejemplo: la calibración.",
     "analogia": "Describir colores con solo 256 tonos: hay que elegir bien qué rango cubren, mirando fotos de verdad.",
     "importa": f"Es más chico y más rápido (aquí, {KB8} kB y casi el doble de fotos por segundo), pero mueve mucho más los números. Con una red que no se entrenó pensando en int8, la paridad puede no pasar.",
     "trampa": "Calibrar con el golden set: es otra forma de verle las respuestas al examen."},
    {"id": "guardia-build", "termino": "La guardia del build", "en": "build guard / pinned runtime",
     "def": "Construir el engine con exactamente el runtime que lo va a servir, en ese tipo de máquina, y anotar los dos en sus huellas. Si no coinciden, el build se detiene.",
     "analogia": "Una llave hecha para una cerradura: puede entrar en otra parecida y no girar.",
     "importa": "En C01, el .plan va atado a la compute capability de la T4 y a la release de NGC de Triton. Una actualización del servidor va en el mismo PR que reconstruye y vuelve a medir el engine.",
     "trampa": "«Es la misma API»: el engine probablemente carga con otro runtime, y por eso nadie nota que nunca se midió con él."},
    {"id": "contrato", "termino": "Contrato con el servidor", "en": "model configuration / signature",
     "def": "Cómo espera el servidor al modelo: el nombre, el tipo y la forma de la entrada y de la salida, y el batch más grande que va a juntar.",
     "analogia": "El enchufe y el voltaje: un aparato perfecto con otra clavija no se puede conectar.",
     "importa": "En C01 es el config.pbtxt de Triton. Si el engine no lo cumple, el servidor no carga el modelo o rechaza cada petición: se revisa antes de registrar, no en el despliegue.",
     "trampa": "Cambiar el contrato del lado del servidor sin reconstruir el engine en el mismo cambio."},
    {"id": "paridad", "termino": "Paridad del engine", "en": "engine parity",
     "def": "Comparar, foto por foto, lo que responde el engine con lo que responde el checkpoint aprobado en PyTorch FP32. No mide si el modelo es bueno: mide si es el mismo.",
     "analogia": "La prueba de imprenta: antes de imprimir 10,000 libros se revisa que el impreso diga lo que dice el original.",
     "importa": "Sin ella, lo que midió el gate (por categoría y por pedazo) no vale para lo que se sirve. Con ella, el gate aprobó el modelo y la paridad dice que lo servido es ese modelo.",
     "trampa": "Confundirla con la prueba de paridad del preprocesamiento (misma foto, mismos números en entrenamiento y serving): son dos exámenes distintos con el mismo apellido."},
    {"id": "tres-numeros", "termino": "Acuerdo top-1, solapamiento top-5 y diferencia máxima", "en": "top-1 agreement / top-5 overlap / max logit diff",
     "def": "a1: fracción de fotos con la misma primera categoría. o5: fracción promedio de las 5 sugerencias que coinciden. d: la mayor diferencia entre un logit de la referencia y el del engine.",
     "analogia": "Dos traducciones: ¿dicen lo mismo en el título (a1), en el resumen (o5), y cuál es la palabra que más se aleja (d)?",
     "importa": "a1 es lo que ve quien vende; o5, las sugerencias de abajo; d delata un bug antes de que cambie una respuesta. Umbrales: a1 ≥ 99.5 %, o5 ≥ 99 %, d ≤ 0.5.",
     "trampa": "Mirar solo a1: un engine con una capa desbordada puede acertar casi todo el top-1 con logits deformes, y d lo atrapa."},
    {"id": "examen-ruido", "termino": "El ruido del examen", "en": "test-set size and noise",
     "def": "Cuántas respuestas cambia un engine sano es un volado repetido N veces: alrededor de N × f, a veces más, a veces menos. El examen necesita lugar para eso sin confundirlo con un bug.",
     "analogia": "Una báscula que oscila ± 50 g no sirve para decidir si un paquete pesa 1,010 o 1,000 g.",
     "importa": "Con pocas fotos, el examen reprueba engines sanos por mala suerte y deja pasar rotos por buena. Con miles, los separa con varias desviaciones de margen.",
     "trampa": "Bajar el examen a unas cuantas fotos «para que corra más rápido»."},
    {"id": "gate-latencia", "termino": "Gate de latencia", "en": "latency regression gate",
     "def": "El p99 del engine nuevo, medido como lo vería un cliente, no puede pasar de (1 + holgura) × el p99 del champion medido igual, a cada tasa de la prueba.",
     "analogia": "Un corredor nuevo para el relevo: no tiene que ganar, pero no puede ser mucho más lento que el que ya corre, en la misma pista y el mismo día.",
     "importa": "Cada mes el engine se construye de nuevo: el build pudo elegir otras tácticas o cambiar la release. Comparar contra el champion, y no contra un número fijo, cancela todo lo que no es el modelo.",
     "trampa": "Pasar por default cuando no hay referencia: sin el engine del champion no hay gate, y el paso tiene que fallar."},
    {"id": "carga-abierta", "termino": "Carga abierta", "en": "open-loop load",
     "def": "Las peticiones llegan a su hora, aunque la anterior no haya terminado; la latencia de cada una cuenta desde que llegó, con la espera en la fila incluida.",
     "analogia": "Los clientes de un banco llegan cuando llegan, no cuando el cajero se desocupa.",
     "importa": "Así llega el tráfico real. Una carga cerrada (mandar la siguiente cuando vuelve la anterior) nunca forma fila y esconde la cola de la latencia.",
     "trampa": "Medir latencia mandando una petición tras otra y llamar a eso «el p99 del servidor»."},
    {"id": "huellas", "termino": "Huellas del build y build reproducible", "en": "build provenance / reproducible build",
     "def": "Guardar con la versión el sha256 de cada archivo (pesos, ONNX, engine, receta), con qué runtime y en qué máquina. Con lo mismo, el build da el mismo archivo byte por byte.",
     "analogia": "El número de lote de un medicamento: dice de qué ingredientes y de qué línea salió cada caja.",
     "importa": "La guardia de las 3 de la mañana pregunta «¿qué engine sirve y de qué salió?». Y si alguien sobrescribe un archivo, la huella lo delata y el build reproducible permite rehacerlo idéntico.",
     "trampa": "Registrar el engine sin las huellas de su ONNX y de sus pesos: después nadie puede probar de qué checkpoint salió."},
]
e["conceptos"] = conceptos

e["mundo"] = {
    "resumen": "El kit trae el marketplace de C01 el 1 de octubre de 2026, a las 07:00 UTC: el gate de la estación 4 aprobó al candidato de octubre y lo dejó como <code>classifier</code> v4 con el alias <code>challenger</code> y <code>engine=pendiente</code>. En el S3 local están el examen congelado <code>golden-v1</code>, el set de calibración y los checkpoints; en MLflow, el registro de v1 a v4, y v3 (<code>@champion</code>) con el engine que hoy sirve producción. Tú fabricas el engine de v4, lo examinas y lo registras.",
    "trae": [
        {"que": "El S3 local y MLflow (compose.yaml)", "detalle": "RustFS en el puerto 9600 (buckets <code>ml-datos</code> y <code>ml-ckpt</code>, los dos con versionado) y MLflow en el 5600, con su interfaz."},
        {"que": "mundo/crear.py", "detalle": f"Crea todo en ≈ {round(int(CREAR_S) / 60)} minutos: baja Fashion-MNIST, congela <code>golden-v1</code> (el mismo examen de la estación 4), publica el set de calibración <code>cal-2026-09</code>, entrena <code>classifier</code> v1 a v4 con la receta de la estación 3, guarda sus checkpoints y construye el engine del champion."},
        {"que": "engine.yaml y mundo/revisiones.json", "detalle": "La receta (opset, exportador, precisión, optimización, calibración) y los umbrales de paridad y latencia, y el registro de sus versiones revisadas: el sustituto del historial de PR."},
        {"que": "mundo/servidor/", "detalle": "Lo que el servidor de modelos espera: <code>classifier.yaml</code> (el contrato, como el config.pbtxt de Triton) y <code>requirements.txt</code> (su versión de onnxruntime, como la release de Triton)."},
        {"que": "corrida.yaml", "detalle": "Los parámetros de esta noche, ya resueltos: challenger = 4 y champion = 3."},
        {"que": "mundo/modelos.py y mundo/s3.py", "detalle": "Mirar y reparar el registro (versiones, el engine de cada una, alias, pesos desde su checkpoint, reconstruir un engine) y el S3 (el examen, la calibración, versiones)."},
        {"que": "verificar.py y romper.py", "detalle": "10 checks con los criterios de «listo» y 6 fallas en el mundo, la configuración o la infraestructura, nunca en lo que escribes."},
    ],
    "tu_pipeline": [
        {"archivo": "pipeline/exportar.py", "hace": "El checkpoint de v4, por número y con su huella, a ONNX con opset fijo y batch dinámico, y los tres chequeos: checker, opset leído del archivo y FP32 contra FP32 en batch 1 y 32."},
        {"archivo": "pipeline/construir.py", "hace": "La guardia del build (el runtime del servidor), los pesos a FP16 (o int8 calibrado) y el grafo optimizado para esta máquina: engine.onnx con sus huellas."},
        {"archivo": "pipeline/paridad.py", "hace": "El contrato con el servidor y los tres números contra PyTorch FP32 sobre las 1,000 fotos del examen. Si no pasa, en rojo."},
        {"archivo": "pipeline/latencia.py", "hace": "Carga abierta a dos tasas, champion y challenger alternados, la mediana de los p99 y la regla de la holgura. Sin el engine del champion, en rojo."},
        {"archivo": "pipeline/registrar.py", "hace": "Solo con todo en verde y del mismo engine: los archivos y las huellas en la versión v4, engine=listo. Ningún alias se mueve."},
    ],
    "requisitos": [
        "Docker Desktop corriendo, con ≈ 700 MB libres para las imágenes de RustFS y MLflow",
        "Python 3.11 o más nuevo (se probó con 3.14.3) y ≈ 1.2 GB para el entorno virtual (PyTorch y ONNX Runtime)",
        "Una Mac con Apple Silicon (el engine se optimiza para la máquina donde se construye)",
        "git (con tu nombre y correo configurados)",
        "Internet la primera vez (los paquetes, las imágenes y Fashion-MNIST)",
        "Los puertos 9600, 9601 y 5600 libres en tu Mac",
    ],
    "sustituciones": [
        {"nube": "TensorRT en una T4: <code>model.plan</code> en FP16", "local": "ONNX Runtime en la CPU de tu Mac: <code>engine.onnx</code> con pesos FP16", "diferencia": "Los dos fusionan capas, eligen el formato para su chip y quedan atados a él y a su versión. TensorRT hace las cuentas en FP16 en la GPU; ONNX Runtime en la CPU guarda los pesos en FP16 y los vuelve a FP32 para calcular. El redondeo de los pesos mueve los logits del mismo orden (≈ 0.01)."},
        {"nube": "El config.pbtxt de Triton en el model repository", "local": "<code>mundo/servidor/classifier.yaml</code>", "diferencia": "Los dos dicen nombres, tipos, formas y el batch más grande. Triton se niega a cargar un modelo que no cumple; aquí lo revisan paridad.py y verificar.py."},
        {"nube": "La release de NGC de Triton (fija la versión de TensorRT)", "local": "<code>mundo/servidor/requirements.txt</code> (fija onnxruntime)", "diferencia": "Con TensorRT, un engine de otra versión no carga; con ONNX Runtime, probablemente sí, y por eso la guardia del build tiene que revisarlo a propósito."},
        {"nube": "<code>perf_analyzer</code> contra Triton en la T4, 250 y 500 peticiones/s, holgura 10 %", "local": "<code>latencia.py</code>: carga abierta dentro del proceso, 600 y 1,200 peticiones/s, holgura 15 %", "diferencia": "La misma regla contra el champion, sin red ni servidor de por medio. Las tasas quedan en el mismo uso de la máquina (≈ 25 y 50 %); la holgura es más grande porque tu Mac mide con más ruido que un runner dedicado."},
        {"nube": "≈ 10,000 fotos del golden set para la paridad", "local": "las 1,000 de <code>golden-v1</code>", "diferencia": "El mismo umbral (99.5 %) deja 5 cambios en lugar de 50: el examen separa con menos margen (lo calcula el precálculo «examen»)."},
        {"nube": "El historial de PR de <code>ml-catalogo</code>; los parámetros de Argo", "local": "<code>mundo/revisiones.json</code>; <code>corrida.yaml</code>", "diferencia": "La receta revisada se comprueba por su huella; las versiones llegan ya resueltas a números."},
        {"nube": "MLflow con Postgres y S3; Amazon S3", "local": "MLflow con SQLite; RustFS en localhost:9600", "diferencia": "La misma API y la misma interfaz."},
    ],
    "arranque": "unzip c01-export.zip && cd c01-export\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d --wait\npython mundo/crear.py\ngit init && git add -A && git commit -m \"kit recién descomprimido\"\npython verificar.py mundo",
    "python": "python",
}

G = []
G.append(dict(n=0, id="mundo", titulo="Levantar el mundo", objetivo="El S3 local y MLflow arriba, el mundo creado y la carpeta como repositorio de git.",
    conceptos=["engine"],
    explica="El mundo vive en dos servicios: el S3 local (el examen, la calibración y los checkpoints) y MLflow (el registro de modelos). <code>mundo/crear.py</code> los llena igual cada vez: entrena los cuatro modelos del registro con la receta de la estación 3 y construye el engine del champion, por eso tarda unos minutos.",
    codigo=[],
    comandos=[
        cmd("python3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt", L("p0 venv"), "Tarda unos minutos la primera vez (PyTorch pesa ≈ 1 GB). Desde aquí, cada terminal nueva necesita <code>source .venv/bin/activate</code>."),
        cmd("docker compose up -d --wait\npython mundo/crear.py", L("p0 up") + "\n" + L("p0 crear", quitar=r"^(real|user|sys) "), "La interfaz de MLflow queda en http://localhost:5600: ahí están las corridas y el modelo <code>classifier</code>."),
        cmd("git init && git add -A && git commit -m \"kit recién descomprimido\"\ngit log --oneline", L("p0 git"), "Los ids de commit cambian en cada máquina."),
        cmd(f"{V} mundo", L("p0 verificar")),
    ],
    verifica="<code>verificar.py mundo</code> en verde: los buckets, el examen, la calibración, <code>classifier</code> v1–v4 con <code>@champion</code> = v3 (con su engine) y <code>@challenger</code> = v4, y git.",
    ojo="El 5000 lo ocupa AirPlay en macOS: por eso MLflow está en el 5600 (y el S3 en 9600, para no chocar con las estaciones anteriores)."))

G.append(dict(n=1, id="reglas", titulo="Qué se va a servir y con qué reglas", objetivo="Saber, antes de escribir código, qué versión se exporta, contra qué engine se compara, qué espera el servidor y cuáles son los umbrales.",
    conceptos=["engine", "contrato", "guardia-build"],
    explica="La estación no decide si el modelo es bueno: eso ya lo decidió el gate. Decide dos cosas: si lo que se va a servir <b>es</b> ese modelo y si <b>cabe en el tiempo</b>. <code>corrida.yaml</code> trae las versiones por número; <code>engine.yaml</code>, la receta y los umbrales, revisados antes; y <code>mundo/servidor/</code>, lo que el servidor espera: el contrato y su versión del runtime. El engine del champion (v3) ya está en MLflow con su huella: es la referencia de la latencia.",
    codigo=[{"lang": "yaml", "path": "engine.yaml", "code": (APP / "kits/c01-export/engine.yaml").read_text().rstrip(), "nota": "Del equipo. Sus versiones revisadas están en <code>mundo/revisiones.json</code>: cada paso comprueba que la de hoy sea una de ellas."}],
    comandos=[
        cmd("grep -v \"^#\" corrida.yaml", L("p1 corrida")),
        cmd("python mundo/modelos.py versiones", L("p1 versiones"), "v4 tiene <code>gate=passed</code> pero <code>engine=pendiente</code>: eso es lo que esta estación completa."),
        cmd("python mundo/modelos.py engine 3", L("p1 engine champion"), "El engine que hoy sirve producción, con sus huellas. Es lo que vas a fabricar para v4."),
        cmd("grep -v \"^#\" mundo/servidor/classifier.yaml\ngrep -v \"^#\" mundo/servidor/requirements.txt", L("p1 servidor")),
    ],
    verifica="Puedes decir en voz alta: exporto v4 con opset 17 a un engine FP16, construido con onnxruntime 1.32.0; el servidor espera <code>input</code> [batch, 3, 32, 32] → <code>logits</code> [batch, 10] y lotes de hasta 32; paridad a1 ≥ 99.5 %; latencia ≤ 1.15 × la del engine de v3.",
    ojo="«Paridad no es calidad»: una paridad de 100 % dice que el engine se porta como el checkpoint, no que el checkpoint sea bueno. Eso lo dijo el gate."))

G.append(dict(n=2, id="exportar", titulo="Exportar a ONNX, con tres chequeos", objetivo="El checkpoint de v4 como model.onnx: opset 17 leído del archivo, batch dinámico y las mismas respuestas que PyTorch en FP32.",
    conceptos=["export", "onnx", "opset", "eje-batch", "exportador"],
    explica="Antes de exportar se comprueba que lo que se exporta es lo que aprobó el gate: la versión por número, <code>gate=passed</code>, su <code>labels.json</code> y la huella de sus pesos contra el tag de la versión. El export va en <code>eval()</code>, con los nombres del contrato y el eje 0 dinámico. Después, tres chequeos: <code>onnx.checker</code> con <code>full_check</code> (el grafo está bien formado), el opset <b>escrito en el archivo</b> (no el que pediste) y ONNX Runtime contra PyTorch, FP32 contra FP32, en batch 1 y en batch 32: las dos orillas de la firma. FP32 contra FP32 solo puede diferir en los últimos decimales.",
    codigo=[{"lang": "python", "path": "pipeline/exportar.py", "code": code("pipeline/exportar.py"), "nota": "Cada <code>sys.exit</code> es una razón para no seguir: una receta sin revisar, unos pesos que no son los aprobados, un opset que cambió o un archivo que no responde como el checkpoint."}],
    comandos=[
        cmd("python pipeline/exportar.py", L("p2 exportar")),
        cmd("python pipeline/exportar.py --exportador dynamo     # una prueba: va a artefactos/v4-dynamo/", L("p2 dynamo"), "El exportador nuevo, el de omisión desde PyTorch 2.9. Pediste opset 17 y el archivo dice 18: sin el chequeo 2, ese cambio de contrato pasaría con un aviso que nadie lee."),
        cmd(f"{V} receta pesos export", L("p2 verificar")),
    ],
    verifica=f"<code>artefactos/v4/model.onnx</code> con opset 17, entrada <code>input['batch', 3, 32, 32]</code> y las mismas 512 respuestas que PyTorch en batch 1 y 32 (diferencia máxima {D_EXPORT}).",
    ojo="El exportador nuevo dejó un archivo de 48 kB en lugar de 180: otro grafo. Puede que responda igual, pero cambiar de exportador es un PR aparte con su propia paridad."))

G.append(dict(n=3, id="construir", titulo="Construir el engine", objetivo="Del model.onnx que pasó sus chequeos a engine.onnx en FP16, construido con el runtime del servidor, para esta máquina, con sus huellas.",
    conceptos=["engine", "fp16", "guardia-build", "huellas"],
    explica="Primero la guardia: el onnxruntime con que construyes tiene que ser el del servidor; si no, el build se detiene. Después, los pesos a FP16 dejando la entrada y la salida en FP32 (lo que pide el contrato). Al final, ONNX Runtime optimiza el grafo para esta máquina (fusiona cada Conv con su ReLU, elige el formato de memoria) y guarda el resultado: ese archivo es el engine. ONNX Runtime mismo avisa que el archivo optimizado solo debe usarse en el mismo entorno. Las huellas (pesos, ONNX, engine, receta), el runtime y la CPU quedan en <code>engine.json</code>.",
    codigo=[{"lang": "python", "path": "pipeline/construir.py", "code": code("pipeline/construir.py"), "nota": "La rama int8 se usa en el paso 4, como prueba."}],
    comandos=[
        cmd("python pipeline/construir.py", L("p3 construir"), "El aviso de ONNX Runtime es real y es la idea del paso: un engine es para la máquina y el runtime donde se construyó."),
        cmd("ls -l artefactos/v4/*.onnx\npython -c \"…cuenta los operadores de model.onnx y de engine.onnx…\"", L("p3 tamanos"), "Las 9 convoluciones y 7 ReLU del ONNX quedaron en 7 FusedConv + 2 Conv. Los 2 Cast pasan la entrada a FP16 y la salida a FP32. En la CPU, los pesos FP16 se volvieron FP32 al optimizar (ya redondeados): por eso engine.onnx pesa casi lo mismo que el ONNX FP32."),
        cmd(f"{V} engine firma", L("p3 verificar")),
    ],
    verifica="<code>engine.onnx</code> con su <code>engine.json</code>: sale del model.onnx que pasó los chequeos, FP16, onnxruntime 1.32.0 (el del servidor), Darwin arm64; y su firma cumple <code>mundo/servidor/classifier.yaml</code> con 32 fotos juntas.",
    ojo="En C01, el build va en el runner de CI con la misma T4 que producción, nunca al arrancar el servidor: compilar un engine tarda minutos y no se hace con tráfico esperando."))

G.append(dict(n=4, id="paridad", titulo="La paridad, y el engine que no pasa", objetivo="El engine FP16 responde lo mismo que PyTorch FP32 en las 1,000 fotos del examen; uno int8, más chico y más rápido, no.",
    conceptos=["paridad", "tres-numeros", "examen-ruido", "int8", "contrato"],
    explica="La referencia es el checkpoint aprobado, en PyTorch FP32 y en <code>eval()</code>. El candidato es el engine, abierto como lo abre el servidor, después de revisar el contrato. Los dos responden las 1,000 fotos de <code>golden-v1</code> y se calculan tres números: a1 (misma primera categoría), o5 (cuántas de las 5 sugerencias coinciden) y d (la mayor diferencia entre logits). Después, la prueba: un engine int8 calibrado con fotos de train (nunca del examen) es más chico y más rápido, pero ¿es el mismo modelo?",
    codigo=[{"lang": "python", "path": "pipeline/paridad.py", "code": code("pipeline/paridad.py"), "nota": "Las fotos que cambian se guardan con el margen que tenían en FP32: un engine sano solo cambia las casi empatadas."}],
    comandos=[
        cmd("python pipeline/paridad.py", L("p4 paridad")),
        cmd("python pipeline/construir.py --precision int8", L("p4 int8 construir", quitar=r"Serializing optimized model")),
        cmd("python pipeline/paridad.py --prueba int8", L("p4 int8 paridad"), "Termina con código 1: en el pipeline, el paso se pone en rojo y no sigue."),
        cmd(f"{V} paridad frena", L("p4 verificar")),
    ],
    verifica=f"FP16: a1 = {A1} %, o5 = {O5} %, d = {D16}: pasa. Int8: a1 = {A1_8} % ({CAMBIAN_8} de 1,000 cambian, el límite deja 5) y d = {D8}: no pasa, y no se registra.",
    ojo="Varias fotos que el int8 cambió tenían un margen de 0.01 o menos en FP32: eran casi empates. Pero también cambió fotos con margen de 0.1, y d pasó de 0.5. No es redondeo: es otro modelo. Si de verdad conviene int8, va en su propio PR, quizás con un modelo entrenado para int8."))

G.append(dict(n=5, id="latencia", titulo="El gate de latencia", objetivo="El p99 del engine nuevo no pasa de 1.15 × el del engine del champion, a 600 y a 1,200 peticiones por segundo.",
    conceptos=["gate-latencia", "carga-abierta"],
    explica="Primero, la referencia: el engine de v3 desde MLflow, con su huella contra el tag de la versión. Sin él no hay gate. Después, la carga abierta: las peticiones llegan a su hora (Poisson, con la misma semilla para los dos) aunque la anterior no haya terminado, y cada latencia cuenta desde que llegó, con la fila. A cada tasa, cinco rondas alternadas (champion, challenger, champion…): se queda la mediana de los cinco p99 de cada uno, para que una ronda con ruido no decida.",
    codigo=[{"lang": "python", "path": "pipeline/latencia.py", "code": code("pipeline/latencia.py"), "nota": "La espera activa (<code>while … pass</code>) hace que cada petición llegue a su hora con precisión de microsegundos; un <code>sleep</code> se despierta tarde."}],
    comandos=[
        cmd("python pipeline/latencia.py", L("p5 latencia", quitar=r"^(user|sys) "), "No corras nada pesado mientras mide: tu Mac es el runner."),
        cmd("python -c \"…los p99 de cada ronda…\"", L("p5 rondas"), "Entre rondas del mismo engine, el p99 se mueve varios %: por eso la mediana, y por eso la holgura de 15 %."),
        cmd(f"{V} latencia", L("p5 verificar")),
    ],
    verifica=f"A 600/s: {P600.group(2)} ms contra {P600.group(1)} (límite {P600.group(3)}). A 1,200/s: {P1200.group(2)} ms contra {P1200.group(1)} (límite {P1200.group(3)}). Pasa a las dos, contra el engine del champion con su huella.",
    ojo="A 1,200/s el p99 casi se duplica aunque cada foto tarda lo mismo: la mitad de la máquina ocupada ya forma fila. Por eso se mide a dos cargas: un engine puede empatar a media carga y quedarse atrás con la carga doble."))

G.append(dict(n=6, id="registrar", titulo="Huellas y registro", objetivo="v4 con engine=listo, sus archivos en MLflow y las huellas de todo lo que se usó; ningún alias se mueve.",
    conceptos=["huellas", "guardia-build"],
    explica="Registrar no es «subir el engine»: es dejar escrito qué es y por qué se puede servir. <code>registrar.py</code> exige que los cuatro reportes sean del mismo engine (la huella del archivo) y de la misma receta, que la paridad y la latencia hayan pasado, que el runtime sea el del servidor y que los alias sigan donde los dejó el orquestador. Sube <code>model.onnx</code>, <code>engine.onnx</code> y los reportes a la corrida de v4 y pone los tags. <code>engine=listo</code> va al final: si algo falla a la mitad, la versión sigue «pendiente».",
    codigo=[{"lang": "python", "path": "pipeline/registrar.py", "code": code("pipeline/registrar.py"), "nota": ""}],
    comandos=[
        cmd("python pipeline/registrar.py", L("p6 registrar")),
        cmd("python pipeline/registrar.py", L("p6 otra vez"), "Otra vez: no cambia nada."),
        cmd("python mundo/modelos.py versiones", L("p6 versiones")),
        cmd("python mundo/modelos.py engine 4", L("p6 engine"), "Ábrelo también en MLflow: la versión 4 de <code>classifier</code>, sus tags y la carpeta <code>engine/</code> de su corrida."),
        cmd(f"{V} registro", L("p6 verificar")),
        cmd(V, L("final", filtro=r"en verde")),
    ],
    verifica="<code>classifier</code> v4 <code>@challenger</code> con <code>engine=listo</code>, la huella de su engine (el archivo en MLflow = el tag), FP16, onnxruntime 1.32.0 y los números de paridad y latencia; <code>@champion</code> sigue en v3; los 10 checks en verde.",
    ojo="Desde aquí, el despliegue (estaciones 8 a 10) toma el engine de la versión, no de tu carpeta: si alguien reemplaza el archivo, la huella lo delata."))

REPARTO = {
    1: (["contrato", "guardia-build"], ["uso"]),
    2: (["export", "onnx", "opset", "eje-batch", "exportador"], []),
    3: (["engine", "fp16", "huellas"], ["pesos", "redondeo"]),
    4: (["paridad", "tres-numeros", "examen-ruido", "int8"], ["examen"]),
    5: (["gate-latencia", "carga-abierta"], ["holgura"]),
    6: ([], []),
}
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
        "Las reglas no se tocan: <code>engine.yaml</code>, <code>corrida.yaml</code> y <code>mundo/servidor/</code> se quedan como vienen.",
    ],
    "objetivos": [
        {"n": 1, "objetivo": "El S3 local y MLflow arriba, el mundo creado y la carpeta en git.", "check": "mundo"},
        {"n": 2, "objetivo": "Trabajas con la receta revisada, en un commit y sin cambios pendientes.", "check": "receta", "pista": "¿Dónde dice cuáles versiones de engine.yaml están aprobadas?"},
        {"n": 3, "objetivo": "Exportas los pesos que aprobó el gate: los de v4, con su huella.", "check": "pesos"},
        {"n": 4, "objetivo": "model.onnx con el opset de la receta (leído del archivo), batch dinámico y las mismas respuestas que PyTorch en FP32 en batch 1 y 32.", "check": "export", "pista": "¿Qué dos tamaños de lote son las orillas de lo que promete la firma?"},
        {"n": 5, "objetivo": "engine.onnx en FP16, desde ese model.onnx, construido con el runtime del servidor en esta máquina, con sus huellas.", "check": "engine"},
        {"n": 6, "objetivo": "El engine cumple el contrato del servidor: nombres, tipos, formas y el batch más grande.", "check": "firma"},
        {"n": 7, "objetivo": "La paridad del engine FP16 sobre las 1,000 fotos: a1, o5 y d correctos, y pasa.", "check": "paridad"},
        {"n": 8, "objetivo": "Un engine int8 calibrado con fotos de train queda como NO pasa en su paridad, y no se registra.", "check": "frena", "pista": "¿Con qué fotos se calibra, y con cuáles nunca?"},
        {"n": 9, "objetivo": "El gate de latencia contra el engine del champion (con su huella), a las dos tasas, con rondas alternadas.", "check": "latencia", "pista": "¿Desde qué momento cuenta la latencia de una petición que llegó mientras otra se atendía?"},
        {"n": 10, "objetivo": "v4 con engine=listo, sus archivos y sus huellas en MLflow; ningún alias se movió.", "check": "registro"},
    ],
}

FAL = []


def falla(id_, titulo, tipo, historia, sintoma, hipotesis, confirma_code, confirma_salida, arreglo, concepto, check, nota=""):
    FAL.append(dict(id=id_, titulo=titulo, tipo=tipo, historia=historia, sintoma=sintoma, hipotesis=hipotesis,
                    confirma=cmd(confirma_code, confirma_salida, nota), arreglo=arreglo, concepto=concepto, check=check))


if LOGF:
    falla("receta-sin-revisar", "El engine 2× más rápido", "config",
          "El equipo de plataforma midió que un engine int8 sirve el doble de fotos por segundo. Subieron un commit a engine.yaml directo a main: «ya quedó, la paridad pasa con los umbrales nuevos».",
          "<code>verificar.py</code>: " + F("f1 detecta", filtro=r"^✗"),
          ["Alguien cambió la receta.", "Cambió el engine.", "Cambió el examen."],
          "git log -1 --format=\"%h %an · %s\" -- engine.yaml\ngit show HEAD -- engine.yaml | grep \"^[-+] \"\npython pipeline/paridad.py", F("f1 confirma") + "\n" + F("f1 paso"),
          "Un commit sin revisión dejó <code>precision: int8</code>, <code>a1_min: 0.98</code> y <code>d_max: 1.0</code>: con eso, el engine int8 del paso 4 pasaría. Es aflojar el examen hasta que el artefacto pase. Tus pasos se niegan a trabajar con una receta cuya huella no está en <code>mundo/revisiones.json</code>. Arreglo: <code>git revert --no-edit HEAD</code>. Si de verdad conviene int8, va en un PR propio, con su calibración y la paridad con los umbrales de siempre.",
          "huellas", "receta")
    falla("pesos-cambiados", "El checkpoint «que sí funcionaba»", "mundo",
          "Alguien del equipo de plataforma escribió en el canal: «los pesos de v4 se veían raros en mi notebook, les puse el último checkpoint que funcionaba».",
          "<code>verificar.py</code>: " + F("f2 detecta", filtro=r"^✗ pesos"),
          ["Cambiaron los pesos de v4 en MLflow.", "Cambió el engine.", "Cambió el examen."],
          "python verificar.py pesos\npython pipeline/exportar.py", F("f2 confirma", filtro=r"^✗|en verde") + "\n" + F("f2 paso"),
          "El <code>modelo/pesos.pt</code> de la corrida de v4 ahora son los pesos de v3: los artefactos de una corrida de MLflow se pueden reemplazar. La versión guarda <code>pesos_sha256</code> desde el gate, y la huella ya no cuadra: exportar así sería servir un modelo que nadie aprobó con el nombre de otro. Arreglo: <code>python mundo/modelos.py pesos 4</code>, que vuelve a subir el checkpoint original desde <code>s3://ml-ckpt</code> después de comprobar su huella. El engine que ya registraste sigue siendo el bueno.",
          "huellas", "pesos")
    falla("runtime-distinto", "La imagen base nueva", "config",
          "El equipo de serving actualizó la imagen del servidor a la release de este mes y avisó: «sin cambios para ustedes, es la misma API».",
          "<code>verificar.py</code>: " + F("f3 detecta", filtro=r"^✗", max_lineas=1),
          ["Cambió el runtime del servidor.", "Cambió tu entorno.", "Cambió el engine."],
          "git log -1 --format=\"%h %an · %s\" -- mundo/servidor/requirements.txt\ngit show HEAD -- mundo/servidor/requirements.txt | grep \"^[-+]onnx\"\npython pipeline/registrar.py", F("f3 confirma") + "\n" + F("f3 paso"),
          "El servidor ahora fija <code>onnxruntime==1.31.1</code> y el engine de v4 se construyó y se midió con 1.32.0. Con TensorRT, un engine de otra versión ni siquiera carga; aquí probablemente cargaría, y ese es el problema: nadie midió su paridad ni su latencia con ese runtime. Arreglo: <code>git revert --no-edit HEAD</code>, y que una actualización del runtime vaya en el mismo PR que reconstruye y vuelve a medir el engine.",
          "guardia-build", "engine")
    falla("engine-champion-cambiado", "El champion más rápido del mundo", "mundo",
          "Alguien de plataforma «comparó velocidades» con el engine del champion esta mañana. Desde entonces, el gate de latencia dice que el modelo nuevo es más del doble de lento.",
          "<code>verificar.py</code>: " + F("f4 detecta", filtro=r"^✗"),
          ["Cambió el engine del champion.", "Tu engine se volvió lento.", "La máquina está ocupada."],
          "python mundo/modelos.py engine 3 | grep -E \"engine_sha256|engine/engine.onnx\"\npython pipeline/latencia.py", F("f4 confirma") + "\n" + F("f4 paso"),
          "El <code>engine/engine.onnx</code> de v3 en MLflow es ahora un engine int8 que alguien subió encima del de producción. Contra esa referencia, cualquier engine FP16 sale «lento»: el gate fallaría por la razón equivocada (o pasaría a uno malo contra una referencia mala). Tu <code>latencia.py</code> compara su huella con el tag <code>engine_sha256</code> de v3 y se detiene. Arreglo: <code>python mundo/modelos.py reconstruir-engine 3</code>: la misma receta, con los mismos pesos y las mismas versiones en la misma máquina, da el mismo archivo byte por byte, y solo se sube si su huella es la del tag.",
          "huellas", "latencia")
    falla("firma-cambiada", "Como en los demás modelos", "config",
          "El equipo de serving estandarizó la configuración de todos los modelos del servidor: «lotes de hasta 64 y la entrada se llama images, como en los demás».",
          "<code>verificar.py</code>: " + F("f5 detecta", filtro=r"^✗"),
          ["Cambió el contrato del servidor.", "Cambió tu engine.", "Cambió el exportador."],
          "git log -1 --format=\"%h %an · %s\" -- mundo/servidor/classifier.yaml\ngit show HEAD -- mundo/servidor/classifier.yaml | grep \"^[-+][a-z]\"\npython pipeline/paridad.py", F("f5 confirma") + "\n" + F("f5 paso"),
          "<code>mundo/servidor/classifier.yaml</code> ahora espera una entrada <code>images</code> y lotes de hasta 64; el engine tiene <code>input</code> y se construyó para lotes de hasta 32. En producción, el servidor no cargaría el modelo o rechazaría cada petición. Arreglo: <code>git revert --no-edit HEAD</code>; si serving de verdad necesita otro nombre o lotes más grandes, va en el mismo PR que exporta, reconstruye y vuelve a medir el engine con ese contrato.",
          "contrato", "firma")
    falla("mlflow-caido", "El paso del engine no corrió", "infra",
          "El pipeline de anoche quedó en rojo en la estación del engine y el challenger sigue con engine=pendiente.",
          "<code>verificar.py</code>: casi todo falla. " + F("f6 detecta", filtro=r"^✗ mundo"),
          ["Se cayó MLflow.", "Se cayó el S3.", "Se borró la versión."],
          "docker compose ps -a --format \"{{.Service}}: {{.State}} · {{.Status}}\"\npython pipeline/exportar.py", F("f6 confirma") + "\n" + F("f6 paso"),
          "El contenedor de MLflow está detenido. Sin el registro no hay pesos de la versión, ni engine del champion para comparar, ni dónde registrar: tus pasos fallan en segundos, y está bien que fallen. Un paso que «pasa» porque no pudo medir es peor que uno en rojo. Arreglo: <code>docker compose up -d --wait mlflow</code> y <code>python verificar.py</code>. En C01, MLflow lo opera plataforma; si se cae, el orquestador reintenta el paso.",
          "gate-latencia", "mundo")
e["fallas"] = FAL

e["listo"] = [
    "model.onnx sale de los pesos que aprobó el gate (con su huella), con el opset de la receta leído del archivo, batch dinámico y las mismas respuestas que PyTorch en FP32.",
    "engine.onnx se construyó con el runtime del servidor, en esta máquina, desde ese model.onnx, y cumple el contrato del servidor.",
    "La paridad del engine sobre el examen congelado pasa los tres umbrales; un engine que no los pasa deja el paso en rojo y no se registra.",
    "El p99 del engine nuevo cabe en la holgura contra el engine del champion, a las dos tasas, medido igual.",
    "La versión tiene engine=listo, sus archivos y las huellas de todo; ningún alias se movió.",
    "Sabes de qué pesos, con qué receta, con qué runtime y en qué máquina salió el engine que se va a servir.",
]

e["repaso"] = {
    "memo": "<b>El gate aprueba un modelo; esta estación prueba que lo que se sirve es ese modelo.</b> Export a ONNX con opset fijo y batch dinámico, y tres chequeos (checker, opset leído del archivo, FP32 contra FP32 en batch 1 y el máximo). Engine con el runtime del servidor, para su máquina. Paridad con tres números sobre miles de fotos, latencia contra el champion medido igual, y las huellas de todo en el registro.",
    "trampa": "Aflojar los umbrales de paridad porque el engine nuevo es más rápido. Más rápido y distinto no es una mejora: es otro modelo que nadie aprobó.",
    "entrevista": [
        {"q": "¿Cómo pasas un modelo de PyTorch a producción en GPU?", "a": "Lo exporto a ONNX en eval(), con opset fijo y el eje de batch dinámico, y lo reviso: onnx.checker, el opset leído del archivo y ONNX Runtime contra PyTorch FP32 en batch 1 y el máximo. Después construyo el engine de TensorRT en FP16 en la misma GPU y la misma release de Triton que producción, en CI. Paridad del engine en Triton contra PyTorch FP32 con miles de fotos, gate de latencia con perf_analyzer contra el champion, y registro con las huellas."},
        {"q": "¿Cómo sabes que el engine FP16 es el mismo modelo?", "a": "Paridad foto por foto contra el checkpoint en FP32 sobre el golden set: acuerdo top-1 (≥ 99.5 %), solapamiento top-5 (≥ 99 %) y diferencia máxima de logits (≤ 0.5; un FP16 sano da ≈ 0.01). Con un examen grande, para que los pocos cambios de fotos casi empatadas no se confundan con un bug."},
        {"q": "Tu engine FP16 da 97 % de acuerdo top-1. ¿Qué haces?", "a": "No es redondeo, es un bug. Parto el camino: corro el mismo examen con el ONNX en ONNX Runtime en FP32. Si ahí ya da 97 %, el problema es el export (eval(), opset, exportador). Si el ONNX da ≈ 100 %, es el build: busco la capa que se desborda en FP16 comparando salidas intermedias y la dejo en FP32. Mientras, nada se registra."},
        {"q": "¿Por qué el engine se construye en CI y no al arrancar el servidor?", "a": "Porque va atado a la GPU (compute capability) y a la versión de TensorRT, tarda minutos y tiene que pasar paridad y latencia antes de servir. Se construye una vez en un runner con la misma GPU y la misma release, se le sacan huellas y se mete en la imagen. El servidor solo lo carga."},
        {"q": "¿Cómo haces un gate de latencia que no dé falsas alarmas?", "a": "Comparo contra el champion medido igual, en la misma máquina y con la misma herramienta, en vez de contra un número fijo; con carga abierta a tasas fijas (el pico y el doble), mirando el p99, y con varias rondas alternadas. La holgura queda arriba del ruido de medir dos veces lo mismo."},
        {"q": "¿Por qué no servir directamente el checkpoint de PyTorch?", "a": "Porque el servidor no necesita Python ni el código de entrenamiento, un pickle puede correr código al abrirse, y un engine compilado en FP16 es varias veces más rápido en la misma GPU. El costo es que el engine es otro archivo con otros números: por eso la paridad."},
    ],
}

e["prompts"] = {
    "claude_md": "kits/c01-export/CLAUDE.md",
    "guiado": "content/estaciones/c01-export/prompts/guiado.md",
    "solo": "content/estaciones/c01-export/prompts/solo.md",
    "romper_ayuda": "content/estaciones/c01-export/prompts/romper-ayuda.md",
    "romper_solo": "content/estaciones/c01-export/prompts/romper-solo.md",
}

(APP / "content/estaciones/c01-export.json").write_text(json.dumps(e, ensure_ascii=False, indent=2) + "\n")
print("ok", len(json.dumps(e, ensure_ascii=False)), "· fallas:", len(FAL))
